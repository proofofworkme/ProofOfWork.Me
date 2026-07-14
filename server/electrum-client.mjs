import net from "node:net";

const DEFAULT_TIMEOUT_MS = 30_000;
const DEFAULT_MAX_IN_FLIGHT = 8;
const DEFAULT_MAX_QUEUE = 256;
const DEFAULT_MAX_REQUEST_BYTES = 1_048_576;
const DEFAULT_MAX_RESPONSE_BYTES = 16_777_216;
const DEFAULT_KEEP_ALIVE_INITIAL_DELAY_MS = 1_000;
const DEFAULT_EXPIRED_OPERATION_GRACE_MS = 1_000;
const MAX_SAFE_TIMEOUT_MS = 600_000;

export class ElectrumClientError extends Error {
  constructor(message, code, options = {}) {
    super(message, options.cause ? { cause: options.cause } : undefined);
    this.name = new.target.name;
    this.code = code;
  }
}

export class ElectrumClientClosedError extends ElectrumClientError {
  constructor(message = "Electrum client is closed.") {
    super(message, "ELECTRUM_CLIENT_CLOSED");
  }
}

export class ElectrumDeadlineError extends ElectrumClientError {
  constructor(method, timeoutMs, phase) {
    super(
      `Electrum request timed out after ${timeoutMs} ms: ${method}`,
      "ELECTRUM_DEADLINE_EXCEEDED",
    );
    this.method = method;
    this.phase = phase;
    this.timeoutMs = timeoutMs;
  }
}

export class ElectrumQueueFullError extends ElectrumClientError {
  constructor(maxInFlight, maxQueue) {
    super(
      `Electrum request capacity is full (${maxInFlight} in flight, ${maxQueue} queued).`,
      "ELECTRUM_QUEUE_FULL",
    );
    this.maxInFlight = maxInFlight;
    this.maxQueue = maxQueue;
  }
}

export class ElectrumTransportError extends ElectrumClientError {
  constructor(message, options = {}) {
    super(message, "ELECTRUM_TRANSPORT_ERROR", options);
  }
}

export class ElectrumProtocolError extends ElectrumClientError {
  constructor(message, options = {}) {
    super(message, "ELECTRUM_PROTOCOL_ERROR", options);
  }
}

export class ElectrumRpcError extends ElectrumClientError {
  constructor(method, rpcError) {
    const rpcMessage =
      typeof rpcError?.message === "string" && rpcError.message
        ? rpcError.message
        : `Electrum RPC error for ${method}`;
    super(rpcMessage, "ELECTRUM_RPC_ERROR");
    this.method = method;
    this.rpcCode = rpcError?.code;
    this.rpcData = rpcError?.data;
  }
}

function boundedInteger(value, label, minimum, maximum) {
  if (
    !Number.isSafeInteger(value) ||
    value < minimum ||
    value > maximum
  ) {
    throw new TypeError(
      `${label} must be an integer from ${minimum} through ${maximum}.`,
    );
  }
  return value;
}

function requestTimeout(timeoutOrOptions, defaultTimeoutMs) {
  const timeoutMs =
    typeof timeoutOrOptions === "number"
      ? timeoutOrOptions
      : (timeoutOrOptions?.timeoutMs ?? defaultTimeoutMs);
  return boundedInteger(
    timeoutMs,
    "Electrum timeoutMs",
    1,
    MAX_SAFE_TIMEOUT_MS,
  );
}

function serializedParams(params) {
  if (!Array.isArray(params)) {
    throw new TypeError("Electrum request params must be an array.");
  }
  let json;
  try {
    json = JSON.stringify(params);
  } catch (error) {
    throw new TypeError("Electrum request params must be JSON serializable.", {
      cause: error,
    });
  }
  if (typeof json !== "string") {
    throw new TypeError("Electrum request params must be JSON serializable.");
  }
  return json;
}

function normalizedMethod(method) {
  if (
    typeof method !== "string" ||
    method.length < 1 ||
    method.length > 256 ||
    !/^[A-Za-z0-9_.-]+$/u.test(method)
  ) {
    throw new TypeError("Electrum method is invalid.");
  }
  return method;
}

function singleflightKey(method, paramsJson) {
  return `${method}\u0000${paramsJson}`;
}

function transportFailure(error, fallbackMessage) {
  if (error instanceof ElectrumClientError) {
    return error;
  }
  const detail = error instanceof Error ? error.message : String(error ?? "");
  return new ElectrumTransportError(
    detail ? `${fallbackMessage}: ${detail}` : fallbackMessage,
    error instanceof Error ? { cause: error } : {},
  );
}

/**
 * One persistent, multiplexed Electrum JSON-RPC connection.
 *
 * `request(method, params, timeoutMs)` intentionally matches the old helper's
 * call shape. An options object containing `timeoutMs` is accepted as the third
 * argument as well. Call `close()` during process shutdown.
 */
export class ElectrumClient {
  #bufferBytes = 0;
  #bufferChunks = [];
  #closed = false;
  #connected = false;
  #connecting = false;
  #eventHandler;
  #expiredOperationGraceMs;
  #host;
  #keepAliveInitialDelayMs;
  #maxInFlight;
  #maxQueue;
  #maxRequestBytes;
  #maxResponseBytes;
  #nextRequestId = 1;
  #operationsById = new Map();
  #port;
  #queue = [];
  #singleflight = new Map();
  #socket = null;
  #stats = {
    connections: 0,
    lateResponses: 0,
    deadlineResets: 0,
    queueRejected: 0,
    requestsJoined: 0,
    requestsSent: 0,
    resets: 0,
  };
  #testHooks;
  #writeBlocked = false;

  constructor(options = {}) {
    this.#host = String(options.host ?? "127.0.0.1");
    if (!this.#host) {
      throw new TypeError("Electrum host is required.");
    }
    this.#port = boundedInteger(
      Number(options.port ?? 50_001),
      "Electrum port",
      1,
      65_535,
    );
    this.defaultTimeoutMs = boundedInteger(
      Number(options.defaultTimeoutMs ?? DEFAULT_TIMEOUT_MS),
      "Electrum defaultTimeoutMs",
      1,
      MAX_SAFE_TIMEOUT_MS,
    );
    this.#maxInFlight = boundedInteger(
      Number(options.maxInFlight ?? DEFAULT_MAX_IN_FLIGHT),
      "Electrum maxInFlight",
      1,
      1_024,
    );
    this.#maxQueue = boundedInteger(
      Number(options.maxQueue ?? DEFAULT_MAX_QUEUE),
      "Electrum maxQueue",
      0,
      100_000,
    );
    this.#maxRequestBytes = boundedInteger(
      Number(options.maxRequestBytes ?? DEFAULT_MAX_REQUEST_BYTES),
      "Electrum maxRequestBytes",
      256,
      64 * 1024 * 1024,
    );
    this.#maxResponseBytes = boundedInteger(
      Number(options.maxResponseBytes ?? DEFAULT_MAX_RESPONSE_BYTES),
      "Electrum maxResponseBytes",
      256,
      256 * 1024 * 1024,
    );
    this.#keepAliveInitialDelayMs = boundedInteger(
      Number(
        options.keepAliveInitialDelayMs ??
          DEFAULT_KEEP_ALIVE_INITIAL_DELAY_MS,
      ),
      "Electrum keepAliveInitialDelayMs",
      0,
      MAX_SAFE_TIMEOUT_MS,
    );
    this.#expiredOperationGraceMs = boundedInteger(
      Number(
        options.expiredOperationGraceMs ??
          DEFAULT_EXPIRED_OPERATION_GRACE_MS,
      ),
      "Electrum expiredOperationGraceMs",
      1,
      MAX_SAFE_TIMEOUT_MS,
    );

    const testHooks = options.testHooks ?? {};
    this.#testHooks = {
      clearTimeout: testHooks.clearTimeout ?? clearTimeout,
      createConnection:
        testHooks.createConnection ??
        ((connectionOptions) => net.createConnection(connectionOptions)),
      now: testHooks.now ?? Date.now,
      setTimeout: testHooks.setTimeout ?? setTimeout,
    };
    for (const [name, hook] of Object.entries(this.#testHooks)) {
      if (typeof hook !== "function") {
        throw new TypeError(`Electrum test hook ${name} must be a function.`);
      }
    }
    this.#eventHandler =
      typeof options.onEvent === "function" ? options.onEvent : null;
  }

  request(method, params = [], timeoutOrOptions) {
    if (this.#closed) {
      return Promise.reject(new ElectrumClientClosedError());
    }

    let normalized;
    let paramsJson;
    let timeoutMs;
    try {
      normalized = normalizedMethod(method);
      paramsJson = serializedParams(params);
      timeoutMs = requestTimeout(timeoutOrOptions, this.defaultTimeoutMs);
    } catch (error) {
      return Promise.reject(error);
    }

    const key = singleflightKey(normalized, paramsJson);
    const shared = this.#singleflight.get(key);
    if (shared) {
      this.#stats.requestsJoined += 1;
      this.#emit("singleflight-join", { method: normalized });
      return this.#joinWithDeadline(shared.promise, normalized, timeoutMs);
    }

    if (
      this.#operationsById.size + this.#queue.length >=
      this.#maxInFlight + this.#maxQueue
    ) {
      this.#stats.queueRejected += 1;
      return Promise.reject(
        new ElectrumQueueFullError(this.#maxInFlight, this.#maxQueue),
      );
    }

    let resolveOperation;
    let rejectOperation;
    const promise = new Promise((resolve, reject) => {
      resolveOperation = resolve;
      rejectOperation = reject;
    });
    const startedAt = this.#testHooks.now();
    const operation = {
      deadlineAt: startedAt + timeoutMs,
      id: null,
      key,
      method: normalized,
      // Snapshot the exact JSON value used for singleflight so a caller cannot
      // mutate queued request data after admission.
      params: JSON.parse(paramsJson),
      paramsJson,
      phase: "queue",
      promise,
      reject: rejectOperation,
      resolve: resolveOperation,
      settled: false,
      startedAt,
      timeoutMs,
      timer: null,
      wireExpiryTimer: null,
    };
    operation.timer = this.#testHooks.setTimeout(
      () => this.#expireOperation(operation),
      timeoutMs,
    );
    this.#singleflight.set(key, operation);
    this.#queue.push(operation);
    this.#emit("queued", { method: normalized });
    this.#drain();
    return promise;
  }

  reset(reason = "Electrum client reset requested.") {
    if (this.#closed) {
      return;
    }
    this.#failTransport(new ElectrumTransportError(String(reason)));
  }

  close() {
    if (this.#closed) {
      return;
    }
    this.#closed = true;
    this.#failTransport(new ElectrumClientClosedError());
    this.#emit("closed");
  }

  snapshot() {
    let expiredInFlight = 0;
    for (const operation of this.#operationsById.values()) {
      if (operation.settled) {
        expiredInFlight += 1;
      }
    }
    return Object.freeze({
      closed: this.#closed,
      connected: this.#connected,
      connecting: this.#connecting,
      expiredInFlight,
      expiredOperationGraceMs: this.#expiredOperationGraceMs,
      inFlight: this.#operationsById.size,
      maxInFlight: this.#maxInFlight,
      maxQueue: this.#maxQueue,
      queued: this.#queue.length,
      singleflight: this.#singleflight.size,
      stats: Object.freeze({ ...this.#stats }),
      writeBlocked: this.#writeBlocked,
    });
  }

  #emit(type, details = {}) {
    if (!this.#eventHandler) {
      return;
    }
    try {
      this.#eventHandler(
        Object.freeze({
          ...details,
          at: this.#testHooks.now(),
          type,
        }),
      );
    } catch {
      // Observability must never affect transport correctness.
    }
  }

  #joinWithDeadline(promise, method, timeoutMs) {
    return new Promise((resolve, reject) => {
      let settled = false;
      const timer = this.#testHooks.setTimeout(() => {
        if (settled) {
          return;
        }
        settled = true;
        reject(new ElectrumDeadlineError(method, timeoutMs, "singleflight"));
      }, timeoutMs);
      promise.then(
        (value) => {
          if (settled) {
            return;
          }
          settled = true;
          this.#testHooks.clearTimeout(timer);
          resolve(value);
        },
        (error) => {
          if (settled) {
            return;
          }
          settled = true;
          this.#testHooks.clearTimeout(timer);
          reject(error);
        },
      );
    });
  }

  #expireOperation(operation) {
    if (operation.settled) {
      return;
    }
    const phase = operation.phase === "queue" ? "queue" : "response";
    if (operation.phase === "queue") {
      const queueIndex = this.#queue.indexOf(operation);
      if (queueIndex !== -1) {
        this.#queue.splice(queueIndex, 1);
      }
    }
    this.#settleOperation(
      operation,
      "reject",
      new ElectrumDeadlineError(
        operation.method,
        operation.timeoutMs,
        phase,
      ),
    );
    this.#emit("deadline", { method: operation.method, phase });

    // An expired wire request keeps its slot until Electrum responds or the
    // bounded grace expires. This prevents timeouts from creating unbounded
    // work behind the client's configured in-flight ceiling without allowing
    // a silent peer to occupy every slot indefinitely.
    if (phase === "response") {
      operation.wireExpiryTimer = this.#testHooks.setTimeout(
        () => this.#resetExpiredWireOperation(operation),
        this.#expiredOperationGraceMs,
      );
    }
    this.#drain();
    this.#discardUnusedConnectingSocket();
  }

  #resetExpiredWireOperation(operation) {
    operation.wireExpiryTimer = null;
    if (
      this.#closed ||
      operation.id === null ||
      !operation.settled ||
      this.#operationsById.get(String(operation.id)) !== operation
    ) {
      return;
    }
    this.#stats.deadlineResets += 1;
    this.#emit("deadline-reset", {
      graceMs: this.#expiredOperationGraceMs,
      id: operation.id,
      method: operation.method,
    });
    this.#failTransport(
      new ElectrumTransportError(
        `Electrum connection reset after timed-out request remained unanswered for ${this.#expiredOperationGraceMs} ms: ${operation.method}`,
      ),
    );
  }

  #clearWireExpiryTimer(operation) {
    if (operation.wireExpiryTimer === null) {
      return;
    }
    this.#testHooks.clearTimeout(operation.wireExpiryTimer);
    operation.wireExpiryTimer = null;
  }

  #settleOperation(operation, outcome, value) {
    if (operation.settled) {
      return false;
    }
    operation.settled = true;
    if (operation.timer !== null) {
      this.#testHooks.clearTimeout(operation.timer);
      operation.timer = null;
    }
    if (this.#singleflight.get(operation.key) === operation) {
      this.#singleflight.delete(operation.key);
    }
    if (outcome === "resolve") {
      operation.resolve(value);
    } else {
      operation.reject(value);
    }
    return true;
  }

  #drain() {
    if (this.#closed || this.#writeBlocked) {
      return;
    }
    if (!this.#socket) {
      if (this.#queue.length > 0) {
        this.#openSocket();
      }
      return;
    }
    if (!this.#connected) {
      return;
    }

    while (
      !this.#writeBlocked &&
      this.#operationsById.size < this.#maxInFlight &&
      this.#queue.length > 0
    ) {
      const operation = this.#queue.shift();
      if (!operation || operation.settled) {
        continue;
      }
      if (operation.deadlineAt <= this.#testHooks.now()) {
        this.#expireOperation(operation);
        continue;
      }
      this.#dispatch(operation);
    }
  }

  #openSocket() {
    if (this.#socket || this.#closed) {
      return;
    }

    let socket;
    try {
      socket = this.#testHooks.createConnection({
        host: this.#host,
        port: this.#port,
      });
    } catch (error) {
      this.#failTransport(
        transportFailure(error, "Electrum connection creation failed"),
      );
      return;
    }
    if (!socket || typeof socket.on !== "function") {
      this.#failTransport(
        new ElectrumTransportError(
          "Electrum connection factory did not return a socket.",
        ),
      );
      return;
    }

    this.#socket = socket;
    this.#connecting = true;
    this.#connected = false;
    this.#writeBlocked = false;
    this.#bufferBytes = 0;
    this.#bufferChunks = [];
    this.#stats.connections += 1;
    this.#emit("connecting");

    socket.setKeepAlive?.(true, this.#keepAliveInitialDelayMs);
    socket.setNoDelay?.(true);
    socket.once("connect", () => {
      if (socket !== this.#socket) {
        return;
      }
      this.#connecting = false;
      this.#connected = true;
      this.#emit("connected");
      this.#drain();
    });
    socket.on("data", (chunk) => {
      if (socket === this.#socket) {
        this.#handleData(chunk);
      }
    });
    socket.on("drain", () => {
      if (socket !== this.#socket) {
        return;
      }
      this.#writeBlocked = false;
      this.#drain();
    });
    socket.on("error", (error) => {
      if (socket === this.#socket) {
        this.#failTransport(
          transportFailure(error, "Electrum socket failed"),
          socket,
        );
      }
    });
    socket.on("end", () => {
      if (socket === this.#socket) {
        this.#failTransport(
          new ElectrumTransportError("Electrum socket ended unexpectedly."),
          socket,
        );
      }
    });
    socket.on("close", () => {
      if (socket === this.#socket) {
        this.#failTransport(
          new ElectrumTransportError("Electrum socket closed unexpectedly."),
          socket,
        );
      }
    });
  }

  #dispatch(operation) {
    const socket = this.#socket;
    if (!socket || !this.#connected) {
      this.#queue.unshift(operation);
      return;
    }

    const id = this.#allocateRequestId();
    let requestLine;
    try {
      requestLine = `${JSON.stringify({
        id,
        method: operation.method,
        params: operation.params,
      })}\n`;
    } catch (error) {
      this.#settleOperation(
        operation,
        "reject",
        new TypeError("Electrum request could not be serialized.", {
          cause: error,
        }),
      );
      return;
    }
    if (Buffer.byteLength(requestLine) > this.#maxRequestBytes) {
      this.#settleOperation(
        operation,
        "reject",
        new ElectrumProtocolError(
          `Electrum request exceeds ${this.#maxRequestBytes} bytes.`,
        ),
      );
      return;
    }

    operation.id = id;
    operation.phase = "response";
    this.#operationsById.set(String(id), operation);
    this.#stats.requestsSent += 1;
    this.#emit("sent", { id, method: operation.method });
    try {
      if (!socket.write(requestLine)) {
        this.#writeBlocked = true;
      }
    } catch (error) {
      this.#failTransport(
        transportFailure(error, "Electrum socket write failed"),
        socket,
      );
    }
  }

  #allocateRequestId() {
    for (;;) {
      const id = this.#nextRequestId;
      this.#nextRequestId =
        id >= Number.MAX_SAFE_INTEGER ? 1 : id + 1;
      if (!this.#operationsById.has(String(id))) {
        return id;
      }
    }
  }

  #handleData(chunk) {
    const incoming = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    let offset = 0;
    while (offset < incoming.length) {
      const newlineIndex = incoming.indexOf(0x0a, offset);
      if (newlineIndex === -1) {
        const remainder = incoming.subarray(offset);
        if (this.#bufferBytes + remainder.length > this.#maxResponseBytes) {
          this.#failTransport(
            new ElectrumProtocolError(
              `Electrum response exceeds ${this.#maxResponseBytes} bytes.`,
            ),
          );
          return;
        }
        if (remainder.length > 0) {
          this.#bufferChunks.push(remainder);
          this.#bufferBytes += remainder.length;
        }
        return;
      }

      const segment = incoming.subarray(offset, newlineIndex);
      const lineBytes = this.#bufferBytes + segment.length;
      if (lineBytes > this.#maxResponseBytes) {
        this.#failTransport(
          new ElectrumProtocolError(
            `Electrum response exceeds ${this.#maxResponseBytes} bytes.`,
          ),
        );
        return;
      }
      if (segment.length > 0) {
        this.#bufferChunks.push(segment);
      }
      const line =
        this.#bufferChunks.length === 0
          ? Buffer.alloc(0)
          : this.#bufferChunks.length === 1
            ? this.#bufferChunks[0]
            : Buffer.concat(this.#bufferChunks, lineBytes);
      this.#bufferBytes = 0;
      this.#bufferChunks = [];
      offset = newlineIndex + 1;
      if (line.length === 0) {
        continue;
      }
      if (!this.#handleLine(line)) {
        return;
      }
    }
  }

  #handleLine(line) {
    let response;
    try {
      response = JSON.parse(line.toString("utf8"));
    } catch (error) {
      this.#failTransport(
        new ElectrumProtocolError("Electrum returned invalid JSON.", {
          cause: error,
        }),
      );
      return false;
    }

    if (
      response &&
      typeof response === "object" &&
      !Array.isArray(response) &&
      response.id === undefined &&
      typeof response.method === "string"
    ) {
      this.#emit("notification", { method: response.method });
      return true;
    }
    if (
      !response ||
      typeof response !== "object" ||
      Array.isArray(response) ||
      response.id === undefined ||
      response.id === null
    ) {
      this.#failTransport(
        new ElectrumProtocolError("Electrum returned an invalid RPC envelope."),
      );
      return false;
    }

    const id = String(response.id);
    const operation = this.#operationsById.get(id);
    if (!operation) {
      this.#failTransport(
        new ElectrumProtocolError(
          `Electrum returned an unknown response id: ${id}`,
        ),
      );
      return false;
    }
    this.#clearWireExpiryTimer(operation);
    const hasRpcError =
      Object.hasOwn(response, "error") && response.error !== null;
    const hasResult = Object.hasOwn(response, "result");
    if (!hasRpcError && !hasResult) {
      this.#failTransport(
        new ElectrumProtocolError(
          `Electrum response ${id} has neither a result nor an error.`,
        ),
      );
      return false;
    }
    this.#operationsById.delete(id);

    if (operation.settled) {
      this.#stats.lateResponses += 1;
      this.#emit("late-response", { id: operation.id, method: operation.method });
      this.#drain();
      return true;
    }
    if (hasRpcError) {
      this.#settleOperation(
        operation,
        "reject",
        new ElectrumRpcError(operation.method, response.error),
      );
    } else if (hasResult) {
      this.#settleOperation(operation, "resolve", response.result);
    }
    this.#emit("settled", { id: operation.id, method: operation.method });
    this.#drain();
    return true;
  }

  #failTransport(error, expectedSocket = this.#socket) {
    if (expectedSocket && this.#socket && expectedSocket !== this.#socket) {
      return;
    }
    const failure = transportFailure(error, "Electrum transport failed");
    const socket = this.#socket;
    this.#socket = null;
    this.#connected = false;
    this.#connecting = false;
    this.#writeBlocked = false;
    this.#bufferBytes = 0;
    this.#bufferChunks = [];
    this.#stats.resets += 1;

    if (socket && !socket.destroyed) {
      socket.destroy();
    }

    const operations = new Set([
      ...this.#operationsById.values(),
      ...this.#queue,
    ]);
    this.#operationsById.clear();
    this.#queue = [];
    for (const operation of operations) {
      this.#clearWireExpiryTimer(operation);
      this.#settleOperation(operation, "reject", failure);
    }
    this.#singleflight.clear();
    this.#emit("reset", {
      code: failure.code,
      message: failure.message,
      rejected: operations.size,
    });
  }

  #discardUnusedConnectingSocket() {
    if (
      !this.#socket ||
      !this.#connecting ||
      this.#operationsById.size > 0 ||
      this.#queue.length > 0
    ) {
      return;
    }
    const socket = this.#socket;
    this.#socket = null;
    this.#connecting = false;
    this.#connected = false;
    this.#writeBlocked = false;
    this.#bufferBytes = 0;
    this.#bufferChunks = [];
    socket.destroy();
    this.#emit("unused-connection-cancelled");
  }
}

export function createElectrumClient(options) {
  return new ElectrumClient(options);
}

export const electrumClientTestHooks = Object.freeze({
  singleflightKey(method, params = []) {
    const normalized = normalizedMethod(method);
    return singleflightKey(normalized, serializedParams(params));
  },
});
