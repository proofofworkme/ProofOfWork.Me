import assert from "node:assert/strict";
import net from "node:net";
import {
  ElectrumClientClosedError,
  ElectrumDeadlineError,
  ElectrumProtocolError,
  ElectrumQueueFullError,
  ElectrumRpcError,
  ElectrumTransportError,
  createElectrumClient,
} from "../server/electrum-client.mjs";

let assertions = 0;

function equal(actual, expected, message) {
  assert.equal(actual, expected, message);
  assertions += 1;
}

function deepEqual(actual, expected, message) {
  assert.deepEqual(actual, expected, message);
  assertions += 1;
}

function ok(value, message) {
  assert.ok(value, message);
  assertions += 1;
}

async function rejects(promise, expected, message) {
  await assert.rejects(promise, expected, message);
  assertions += 1;
}

function nextTurn() {
  return new Promise((resolve) => setImmediate(resolve));
}

async function eventually(predicate, timeoutMs = 2_000) {
  const deadline = Date.now() + timeoutMs;
  while (!predicate()) {
    if (Date.now() >= deadline) {
      throw new Error(`Test condition timed out after ${timeoutMs} ms.`);
    }
    await nextTurn();
  }
}

function within(promise, timeoutMs = 2_000) {
  let timer;
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      timer = setTimeout(
        () => reject(new Error(`Test fixture timed out after ${timeoutMs} ms.`)),
        timeoutMs,
      );
    }),
  ]).finally(() => clearTimeout(timer));
}

class ManualClock {
  constructor() {
    this.current = 0;
    this.nextId = 1;
    this.timers = new Map();
  }

  hooks() {
    return {
      clearTimeout: (id) => this.timers.delete(id),
      now: () => this.current,
      setTimeout: (callback, delay) => {
        const id = this.nextId;
        this.nextId += 1;
        this.timers.set(id, {
          callback,
          dueAt: this.current + Number(delay),
          id,
        });
        return id;
      },
    };
  }

  advance(milliseconds) {
    const target = this.current + milliseconds;
    for (;;) {
      const due = [...this.timers.values()]
        .filter((timer) => timer.dueAt <= target)
        .sort((left, right) => left.dueAt - right.dueAt || left.id - right.id)[0];
      if (!due) {
        break;
      }
      this.current = due.dueAt;
      this.timers.delete(due.id);
      due.callback();
    }
    this.current = target;
  }
}

async function createFakeElectrumServer() {
  const sockets = new Set();
  const requests = [];
  const waiters = [];
  let connectionSequence = 0;

  function publish(record) {
    requests.push(record);
    const waiterIndex = waiters.findIndex((waiter) =>
      waiter.predicate(record),
    );
    if (waiterIndex !== -1) {
      const [waiter] = waiters.splice(waiterIndex, 1);
      record.claimed = true;
      waiter.resolve(record);
      return;
    }
  }

  const server = net.createServer((socket) => {
    connectionSequence += 1;
    const connectionId = connectionSequence;
    sockets.add(socket);
    socket.on("error", () => {});
    socket.on("close", () => sockets.delete(socket));
    let buffered = "";
    socket.on("data", (chunk) => {
      buffered += chunk.toString("utf8");
      for (;;) {
        const newlineIndex = buffered.indexOf("\n");
        if (newlineIndex === -1) {
          break;
        }
        const line = buffered.slice(0, newlineIndex);
        buffered = buffered.slice(newlineIndex + 1);
        if (!line) {
          continue;
        }
        const payload = JSON.parse(line);
        publish({
          claimed: false,
          connectionId,
          drop() {
            socket.destroy();
          },
          payload,
          raw(value) {
            socket.write(value);
          },
          reply(result) {
            socket.write(`${JSON.stringify({ id: payload.id, result })}\n`);
          },
          rpcError(error) {
            socket.write(`${JSON.stringify({ error, id: payload.id })}\n`);
          },
          socket,
        });
      }
    });
  });

  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("Fake Electrum server did not expose a TCP address.");
  }

  return {
    connectionCount() {
      return connectionSequence;
    },
    count(predicate = () => true) {
      return requests.filter(predicate).length;
    },
    async close() {
      for (const waiter of waiters.splice(0)) {
        waiter.reject(new Error("Fake Electrum server closed."));
      }
      for (const socket of sockets) {
        socket.destroy();
      }
      await new Promise((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      });
    },
    host: "127.0.0.1",
    nextRequest(predicate = () => true) {
      const existing = requests.find(
        (record) => !record.claimed && predicate(record),
      );
      if (existing) {
        existing.claimed = true;
        return Promise.resolve(existing);
      }
      return new Promise((resolve, reject) => {
        waiters.push({ predicate, reject, resolve });
      });
    },
    port: address.port,
    requests,
  };
}

const fake = await createFakeElectrumServer();
const clients = [];
function client(options = {}) {
  const instance = createElectrumClient({
    host: fake.host,
    port: fake.port,
    ...options,
  });
  clients.push(instance);
  return instance;
}

try {
  const multiplexed = client({ maxInFlight: 3, maxQueue: 3 });
  const firstPromise = multiplexed.request("test.multiplex", ["first"], 1_000);
  const secondPromise = multiplexed.request(
    "test.multiplex",
    ["second"],
    1_000,
  );
  const firstRequest = await within(
    fake.nextRequest(
      (record) => record.payload.params[0] === "first",
    ),
  );
  const secondRequest = await within(
    fake.nextRequest(
      (record) => record.payload.params[0] === "second",
    ),
  );
  equal(
    firstRequest.connectionId,
    secondRequest.connectionId,
    "concurrent requests share one socket",
  );
  secondRequest.reply("second-result");
  firstRequest.reply("first-result");
  deepEqual(
    await Promise.all([firstPromise, secondPromise]),
    ["first-result", "second-result"],
    "multiplexed responses are matched by id",
  );
  equal(multiplexed.snapshot().stats.connections, 1, "socket stays persistent");

  const joinedOne = multiplexed.request("test.singleflight", [7], 1_000);
  const joinedTwo = multiplexed.request("test.singleflight", [7], 1_000);
  const joinedRequest = await within(
    fake.nextRequest(
      (record) =>
        record.payload.method === "test.singleflight" &&
        record.payload.params[0] === 7,
    ),
  );
  await nextTurn();
  equal(
    fake.requests.filter(
      (record) =>
        record.connectionId === joinedRequest.connectionId &&
        record.payload.method === "test.singleflight",
    ).length,
    1,
    "identical concurrent calls emit one wire request",
  );
  joinedRequest.reply({ value: 7 });
  deepEqual(
    await Promise.all([joinedOne, joinedTwo]),
    [{ value: 7 }, { value: 7 }],
    "singleflight callers share the result",
  );
  equal(
    multiplexed.snapshot().stats.requestsJoined,
    1,
    "singleflight join is observable",
  );

  const uncachedPromise = multiplexed.request(
    "test.singleflight",
    [7],
    1_000,
  );
  const uncachedRequest = await within(
    fake.nextRequest(
      (record) =>
        record.payload.method === "test.singleflight" &&
        record.payload.params[0] === 7,
    ),
  );
  ok(
    uncachedRequest.payload.id !== joinedRequest.payload.id,
    "a settled result is never cached",
  );
  uncachedRequest.reply({ value: 8 });
  deepEqual(await uncachedPromise, { value: 8 }, "post-settlement call is fresh");

  const rpcFailurePromise = multiplexed.request("test.rpc-error", [], 1_000);
  const rpcFailureRequest = await within(
    fake.nextRequest((record) => record.payload.method === "test.rpc-error"),
  );
  rpcFailureRequest.rpcError({ code: 123, message: "fixture rejection" });
  await rejects(rpcFailurePromise, ElectrumRpcError, "RPC errors are scoped");
  const afterRpcPromise = multiplexed.request("test.after-rpc", [], 1_000);
  const afterRpcRequest = await within(
    fake.nextRequest((record) => record.payload.method === "test.after-rpc"),
  );
  equal(
    afterRpcRequest.connectionId,
    rpcFailureRequest.connectionId,
    "RPC errors do not reset a healthy transport",
  );
  afterRpcRequest.reply("ok");
  equal(await afterRpcPromise, "ok", "socket remains usable after RPC error");

  const clock = new ManualClock();
  const bounded = client({
    expiredOperationGraceMs: 50,
    maxInFlight: 1,
    maxQueue: 1,
    testHooks: clock.hooks(),
  });
  const holderPromise = bounded.request("test.holder", [], 1_000);
  const holderRequest = await within(
    fake.nextRequest((record) => record.payload.method === "test.holder"),
  );
  const deadlinePromise = bounded.request("test.deadline", [], 100);
  clock.advance(60);
  holderRequest.reply("released");
  equal(await holderPromise, "released", "in-flight request completes");
  const deadlineRequest = await within(
    fake.nextRequest((record) => record.payload.method === "test.deadline"),
  );
  clock.advance(39);
  equal(
    bounded.snapshot().expiredInFlight,
    0,
    "dispatch does not restart the total deadline",
  );
  const deadlineRejection = rejects(
    deadlinePromise,
    (error) =>
      error instanceof ElectrumDeadlineError &&
      error.phase === "response" &&
      error.timeoutMs === 100,
    "queue time counts toward the request deadline",
  );
  clock.advance(1);
  await deadlineRejection;
  equal(
    bounded.snapshot().expiredInFlight,
    1,
    "expired wire work retains its bounded slot",
  );
  deadlineRequest.reply("late");
  await eventually(() => bounded.snapshot().inFlight === 0);
  equal(bounded.snapshot().inFlight, 0, "late response releases the wire slot");
  equal(
    bounded.snapshot().stats.lateResponses,
    1,
    "late response is observed but not delivered",
  );
  const resetsAfterLateResponse = bounded.snapshot().stats.resets;
  clock.advance(50);
  equal(
    bounded.snapshot().stats.resets,
    resetsAfterLateResponse,
    "a late response inside the grace cancels its transport watchdog",
  );

  const queueDeadlineHolderPromise = bounded.request(
    "test.queue-deadline-holder",
    [],
    1_000,
  );
  const queueDeadlineHolderRequest = await within(
    fake.nextRequest(
      (record) => record.payload.method === "test.queue-deadline-holder",
    ),
  );
  const neverSentPromise = bounded.request("test.queue-deadline", [], 50);
  const neverSentRejection = rejects(
    neverSentPromise,
    (error) =>
      error instanceof ElectrumDeadlineError && error.phase === "queue",
    "a request can expire while waiting for wire capacity",
  );
  clock.advance(50);
  await neverSentRejection;
  equal(bounded.snapshot().queued, 0, "expired queued work is removed");
  equal(
    fake.count(
      (record) => record.payload.method === "test.queue-deadline",
    ),
    0,
    "queue-expired work is never written",
  );
  queueDeadlineHolderRequest.reply("queue-holder-done");
  equal(
    await queueDeadlineHolderPromise,
    "queue-holder-done",
    "queue deadline does not disturb the active request",
  );

  const capacityHolderPromise = bounded.request(
    "test.capacity-holder",
    [],
    1_000,
  );
  const capacityHolderRequest = await within(
    fake.nextRequest(
      (record) => record.payload.method === "test.capacity-holder",
    ),
  );
  const queuedPromise = bounded.request("test.capacity-queued", [], 1_000);
  await rejects(
    bounded.request("test.capacity-overflow", [], 1_000),
    ElectrumQueueFullError,
    "bounded queue rejects excess unique work",
  );
  capacityHolderRequest.reply("holder-done");
  equal(await capacityHolderPromise, "holder-done", "capacity holder completes");
  const queuedRequest = await within(
    fake.nextRequest(
      (record) => record.payload.method === "test.capacity-queued",
    ),
  );
  queuedRequest.reply("queued-done");
  equal(await queuedPromise, "queued-done", "queued work drains after capacity");

  const watchdogClock = new ManualClock();
  const watchdog = client({
    expiredOperationGraceMs: 25,
    maxInFlight: 1,
    maxQueue: 1,
    testHooks: watchdogClock.hooks(),
  });
  const silentPromise = watchdog.request("test.silent-wire", [], 100);
  const silentRequest = await within(
    fake.nextRequest((record) => record.payload.method === "test.silent-wire"),
  );
  const blockedPromise = watchdog.request("test.after-silent", [], 1_000);
  const silentRejection = rejects(
    silentPromise,
    (error) =>
      error instanceof ElectrumDeadlineError && error.phase === "response",
    "a silent wire request first rejects with its own deadline",
  );
  watchdogClock.advance(100);
  await silentRejection;
  equal(
    watchdog.snapshot().expiredInFlight,
    1,
    "silent expired wire work retains its slot during the grace",
  );
  watchdogClock.advance(24);
  equal(
    watchdog.snapshot().inFlight,
    1,
    "the transport remains available for a bounded late-response grace",
  );
  const blockedRejection = rejects(
    blockedPromise,
    (error) =>
      error instanceof ElectrumTransportError &&
      /timed-out request remained unanswered/u.test(error.message),
    "the watchdog rejects work trapped behind a silent wire request",
  );
  watchdogClock.advance(1);
  await blockedRejection;
  deepEqual(
    {
      inFlight: watchdog.snapshot().inFlight,
      queued: watchdog.snapshot().queued,
      singleflight: watchdog.snapshot().singleflight,
    },
    { inFlight: 0, queued: 0, singleflight: 0 },
    "the grace watchdog releases every occupied transport slot",
  );
  equal(
    watchdog.snapshot().stats.deadlineResets,
    1,
    "deadline-triggered transport resets are observable",
  );
  const watchdogRecoveryPromise = watchdog.request(
    "test.watchdog-recovery",
    [],
    1_000,
  );
  const watchdogRecoveryRequest = await within(
    fake.nextRequest(
      (record) => record.payload.method === "test.watchdog-recovery",
    ),
  );
  ok(
    watchdogRecoveryRequest.connectionId !== silentRequest.connectionId,
    "watchdog recovery uses a fresh socket",
  );
  watchdogRecoveryRequest.reply("watchdog-recovered");
  equal(
    await watchdogRecoveryPromise,
    "watchdog-recovered",
    "future work succeeds after a silent-peer reset",
  );

  const capped = client({
    maxInFlight: 2,
    maxQueue: 2,
    maxResponseBytes: 256,
  });
  const oversizedPromise = capped.request("test.oversized", [], 1_000);
  const peerPromise = capped.request("test.oversized-peer", [], 1_000);
  const oversizedRequest = await within(
    fake.nextRequest((record) => record.payload.method === "test.oversized"),
  );
  await within(
    fake.nextRequest(
      (record) => record.payload.method === "test.oversized-peer",
    ),
  );
  const oversizedRejection = rejects(
    oversizedPromise,
    ElectrumProtocolError,
    "oversized response resets the transport",
  );
  const peerRejection = rejects(
    peerPromise,
    ElectrumProtocolError,
    "protocol reset rejects every peer request",
  );
  oversizedRequest.raw(
    `${JSON.stringify({
      id: oversizedRequest.payload.id,
      result: "x".repeat(400),
    })}\n`,
  );
  await Promise.all([oversizedRejection, peerRejection]);
  equal(capped.snapshot().connected, false, "oversized transport is discarded");
  const cappedConnections = capped.snapshot().stats.connections;
  const capRecoveryPromise = capped.request("test.cap-recovery", [], 1_000);
  const capRecoveryRequest = await within(
    fake.nextRequest((record) => record.payload.method === "test.cap-recovery"),
  );
  capRecoveryRequest.reply("recovered");
  equal(await capRecoveryPromise, "recovered", "client reconnects after reset");
  equal(
    capped.snapshot().stats.connections,
    cappedConnections + 1,
    "recovery creates exactly one replacement socket",
  );

  const fragile = client({ maxInFlight: 1, maxQueue: 1 });
  const wireFailurePromise = fragile.request("test.drop-wire", [], 1_000);
  const wireFailureRequest = await within(
    fake.nextRequest((record) => record.payload.method === "test.drop-wire"),
  );
  const queuedFailurePromise = fragile.request("test.drop-queued", [], 1_000);
  const wireRejection = rejects(
    wireFailurePromise,
    ElectrumTransportError,
    "socket failure rejects in-flight work",
  );
  const queueRejection = rejects(
    queuedFailurePromise,
    ElectrumTransportError,
    "socket failure rejects queued work",
  );
  wireFailureRequest.drop();
  await Promise.all([wireRejection, queueRejection]);
  deepEqual(
    {
      inFlight: fragile.snapshot().inFlight,
      queued: fragile.snapshot().queued,
      singleflight: fragile.snapshot().singleflight,
    },
    { inFlight: 0, queued: 0, singleflight: 0 },
    "transport reset clears all operation state",
  );
  const reconnectPromise = fragile.request("test.reconnect", [], 1_000);
  const reconnectRequest = await within(
    fake.nextRequest((record) => record.payload.method === "test.reconnect"),
  );
  reconnectRequest.reply("fresh-socket");
  equal(await reconnectPromise, "fresh-socket", "future calls reconnect cleanly");

  fragile.close();
  await rejects(
    fragile.request("test.after-close", [], 1_000),
    ElectrumClientClosedError,
    "closed client rejects future requests",
  );

  console.log(`Electrum client checks passed (${assertions} assertions).`);
} finally {
  for (const instance of clients) {
    instance.close();
  }
  await fake.close();
}
