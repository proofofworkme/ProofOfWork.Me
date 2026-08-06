import { types as nodeTypes } from "node:util";

function positiveInteger(value, fallback, { maximum = Number.MAX_SAFE_INTEGER } = {}) {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0
    ? Math.min(parsed, maximum)
    : fallback;
}

function invalidCacheValue(reason) {
  return new TypeError(
    `Response cache values must be immutable JSON-compatible trees (${reason}).`,
  );
}

function nativeConstructorOwnsPrototype(prototype, name) {
  const constructorProperty = Object.getOwnPropertyDescriptor(
    prototype,
    "constructor",
  );
  const constructor = constructorProperty?.value;
  return (
    typeof constructor === "function" &&
    constructor.name === name &&
    constructor.prototype === prototype &&
    Function.prototype.toString.call(constructor) ===
      `function ${name}() { [native code] }`
  );
}

function intrinsicObjectPrototype(prototype) {
  return (
    prototype === Object.prototype ||
    (prototype !== null &&
      Object.getPrototypeOf(prototype) === null &&
      nativeConstructorOwnsPrototype(prototype, "Object"))
  );
}

function intrinsicArrayPrototype(prototype) {
  return (
    prototype === Array.prototype ||
    (Array.isArray(prototype) &&
      intrinsicObjectPrototype(Object.getPrototypeOf(prototype)) &&
      nativeConstructorOwnsPrototype(prototype, "Array"))
  );
}

function inspectedCacheValue(value) {
  const containers = [];
  const states = new WeakMap();
  const stack = [
    {
      allowPromise: false,
      allowUndefined: false,
      exiting: false,
      root: true,
      value,
    },
  ];

  while (stack.length > 0) {
    const frame = stack.pop();
    const current = frame.value;
    if (frame.exiting) {
      states.set(current, 2);
      continue;
    }
    if (frame.allowPromise) {
      if (current === undefined || current === null) {
        continue;
      }
      if (!nodeTypes.isPromise(current)) {
        throw invalidCacheValue("non-Promise root placeholder");
      }
    }
    if (current === null) {
      continue;
    }
    const currentType = typeof current;
    if (currentType === "undefined" && frame.allowUndefined) {
      continue;
    }
    if (currentType === "string" || currentType === "boolean") {
      continue;
    }
    if (currentType === "number") {
      if (!Number.isFinite(current)) {
        throw invalidCacheValue("non-finite number");
      }
      continue;
    }
    if (currentType !== "object") {
      throw invalidCacheValue(`unsupported ${currentType} value`);
    }
    if (nodeTypes.isProxy(current)) {
      throw invalidCacheValue("Proxy objects are not allowed");
    }

    if (nodeTypes.isPromise(current)) {
      if (
        !frame.allowPromise ||
        Object.getPrototypeOf(current) !== Promise.prototype
      ) {
        throw invalidCacheValue("Promise outside a root placeholder");
      }
      for (const key of Reflect.ownKeys(current)) {
        const property = Object.getOwnPropertyDescriptor(current, key);
        if (
          !property ||
          !("value" in property) ||
          (typeof key === "string" && property.enumerable)
        ) {
          throw invalidCacheValue("Promise has serialized or accessor state");
        }
      }
      if (!states.has(current)) {
        states.set(current, 2);
        containers.push(current);
      }
      continue;
    }

    const state = states.get(current);
    if (state === 1) {
      throw invalidCacheValue("cycle detected");
    }
    if (state === 2) {
      continue;
    }

    const isArray = Array.isArray(current);
    const prototype = Object.getPrototypeOf(current);
    if (
      (isArray && !intrinsicArrayPrototype(prototype)) ||
      (!isArray &&
        prototype !== null &&
        !intrinsicObjectPrototype(prototype))
    ) {
      throw invalidCacheValue("custom or exotic object prototype");
    }

    const children = [];
    const ownKeys = Reflect.ownKeys(current);
    if (isArray) {
      let indexedProperties = 0;
      for (const key of ownKeys) {
        if (key === "length") {
          continue;
        }
        if (
          typeof key !== "string" ||
          !/^(?:0|[1-9][0-9]*)$/u.test(key)
        ) {
          throw invalidCacheValue("array has a non-index property");
        }
        const index = Number(key);
        if (
          !Number.isSafeInteger(index) ||
          index < 0 ||
          index >= current.length ||
          String(index) !== key
        ) {
          throw invalidCacheValue("array index is invalid");
        }
        const property = Object.getOwnPropertyDescriptor(current, key);
        if (!property || !("value" in property) || !property.enumerable) {
          throw invalidCacheValue("array accessor or hidden value");
        }
        indexedProperties += 1;
        children.push({
          allowPromise: false,
          allowUndefined: false,
          value: property.value,
        });
      }
      if (indexedProperties !== current.length) {
        throw invalidCacheValue("sparse array");
      }
    } else {
      for (const key of ownKeys) {
        if (typeof key !== "string") {
          throw invalidCacheValue("symbol property");
        }
        const property = Object.getOwnPropertyDescriptor(current, key);
        if (!property || !("value" in property) || !property.enumerable) {
          throw invalidCacheValue("accessor or hidden property");
        }
        if (
          frame.root &&
          (key === "expiresAt" || key === "staleUntil") &&
          property.value !== undefined &&
          (typeof property.value !== "number" ||
            !Number.isFinite(property.value))
        ) {
          throw invalidCacheValue("invalid cache deadline");
        }
        children.push({
          allowPromise: frame.root && key === "promise",
          allowUndefined: true,
          value: property.value,
        });
      }
    }

    states.set(current, 1);
    containers.push(current);
    stack.push({ exiting: true, value: current });
    for (let index = children.length - 1; index >= 0; index -= 1) {
      stack.push({
        ...children[index],
        exiting: false,
        root: false,
      });
    }
  }

  return containers;
}

function freezeInspectedCacheValue(containers) {
  for (let index = containers.length - 1; index >= 0; index -= 1) {
    const value = containers[index];
    if (!Object.isFrozen(value)) {
      Object.freeze(value);
    }
  }
}

function exactSerializedValueBytes(value) {
  try {
    const serialized = JSON.stringify(value, (_key, current) => {
      if (typeof current === "bigint") {
        throw new TypeError("BigInt cache values are not JSON serializable.");
      }
      return current;
    });
    return typeof serialized === "string"
      ? Buffer.byteLength(serialized, "utf8")
      : null;
  } catch {
    // Cycles, BigInts, throwing accessors, and other values that cannot be
    // measured as JSON are never admitted to a response cache.
    return null;
  }
}

/**
 * A small Map-compatible cache with observable entry and byte ceilings.
 * Existing proof-api cache callers can keep using get/set/delete/keys while
 * oversized and expired values are removed centrally.
 */
export class BoundedResponseCache {
  constructor({ maxBytes = 256 * 1024 * 1024, maxEntries = 512 } = {}) {
    this.maxBytes = positiveInteger(maxBytes, 256 * 1024 * 1024, {
      maximum: 2 * 1024 * 1024 * 1024,
    });
    this.maxEntries = positiveInteger(maxEntries, 512, { maximum: 100_000 });
    this.values = new Map();
    this.metadata = new Map();
    this.totalBytes = 0;
    this.sequence = 0;
    this.evicted = 0;
    this.expired = 0;
    this.oversized = 0;
    this.refused = 0;
    this.unserializable = 0;
  }

  get size() {
    return this.values.size;
  }

  clear() {
    this.values.clear();
    this.metadata.clear();
    this.totalBytes = 0;
  }

  delete(key) {
    const metadata = this.metadata.get(key);
    if (metadata) {
      this.totalBytes = Math.max(0, this.totalBytes - metadata.bytes);
      this.metadata.delete(key);
    }
    return this.values.delete(key);
  }

  get(key) {
    const value = this.values.get(key);
    if (value === undefined) {
      return undefined;
    }
    const staleUntil = Number(value?.staleUntil);
    if (
      !value?.promise &&
      Number.isFinite(staleUntil) &&
      staleUntil <= Date.now()
    ) {
      this.expired += 1;
      this.delete(key);
      return undefined;
    }
    const metadata = this.metadata.get(key);
    if (metadata) {
      metadata.touched = ++this.sequence;
    }
    return value;
  }

  has(key) {
    return this.get(key) !== undefined;
  }

  peek(key) {
    return this.values.get(key);
  }

  keys() {
    return this.values.keys();
  }

  set(key, value) {
    this.setWithOutcome(key, value);
    return this;
  }

  setWithOutcome(key, value) {
    return this.setManyWithOutcome([[key, value]]);
  }

  /**
   * Atomically replaces a related group of cache entries. Validation, byte
   * admission, and eviction planning all complete before any live entry is
   * replaced, so callers cannot publish a payload without its exact JSON body
   * (or overwrite one half of a prior last-good pair on refusal).
   */
  setManyWithOutcome(entries) {
    const replacements = new Map(entries);
    if (replacements.size === 0) {
      this.unserializable += 1;
      return { reason: "unserializable", stored: false };
    }

    const prepared = [];
    let replacementBytes = 0;
    try {
      for (const [key, value] of replacements) {
        const inspected = inspectedCacheValue(value);
        const bytes = exactSerializedValueBytes(value);
        if (!Number.isSafeInteger(bytes) || bytes < 1) {
          this.unserializable += 1;
          return { reason: "unserializable", stored: false };
        }
        if (bytes > this.maxBytes) {
          this.oversized += 1;
          return { reason: "oversized", stored: false };
        }
        prepared.push({ bytes, inspected, key, value });
        replacementBytes += bytes;
      }
    } catch {
      this.unserializable += 1;
      return { reason: "unserializable", stored: false };
    }

    this.prune();
    const replacementKeys = new Set(replacements.keys());
    let existingBytes = 0;
    let existingEntries = 0;
    for (const key of replacementKeys) {
      const metadata = this.metadata.get(key);
      if (metadata) {
        existingBytes += metadata.bytes;
      }
      if (this.values.has(key)) {
        existingEntries += 1;
      }
    }
    let projectedBytes = this.totalBytes - existingBytes + replacementBytes;
    let projectedEntries =
      this.values.size - existingEntries + replacements.size;
    const evictionCandidates = [...this.metadata.entries()]
      .filter(
        ([candidateKey]) =>
          !replacementKeys.has(candidateKey) &&
          !this.values.get(candidateKey)?.promise,
      )
      .sort(([, left], [, right]) => left.touched - right.touched);
    const evictionKeys = [];
    for (const [candidateKey, metadata] of evictionCandidates) {
      if (
        projectedEntries <= this.maxEntries &&
        projectedBytes <= this.maxBytes
      ) {
        break;
      }
      evictionKeys.push(candidateKey);
      projectedEntries -= 1;
      projectedBytes -= metadata.bytes;
    }
    if (
      projectedEntries > this.maxEntries ||
      projectedBytes > this.maxBytes
    ) {
      this.refused += 1;
      return { reason: "capacity", stored: false };
    }

    try {
      for (const entry of prepared) {
        freezeInspectedCacheValue(entry.inspected);
      }
    } catch {
      this.unserializable += 1;
      return { reason: "unserializable", stored: false };
    }

    for (const evictionKey of evictionKeys) {
      this.delete(evictionKey);
      this.evicted += 1;
    }
    for (const key of replacementKeys) {
      this.delete(key);
    }
    for (const { bytes, key, value } of prepared) {
      this.values.set(key, value);
      this.metadata.set(key, { bytes, touched: ++this.sequence });
      this.totalBytes += bytes;
    }
    return { bytes: replacementBytes, reason: "stored", stored: true };
  }

  evictOldestSettled() {
    let oldestKey;
    let oldestTouched = Number.POSITIVE_INFINITY;
    for (const [key, metadata] of this.metadata) {
      if (this.values.get(key)?.promise) {
        continue;
      }
      if (metadata.touched < oldestTouched) {
        oldestKey = key;
        oldestTouched = metadata.touched;
      }
    }
    if (oldestKey === undefined) {
      return false;
    }
    this.delete(oldestKey);
    this.evicted += 1;
    return true;
  }

  prune(nowMs = Date.now()) {
    for (const [key, value] of this.values) {
      const staleUntil = Number(value?.staleUntil);
      if (
        !value?.promise &&
        Number.isFinite(staleUntil) &&
        staleUntil <= nowMs
      ) {
        this.expired += 1;
        this.delete(key);
      }
    }
    while (
      this.values.size > this.maxEntries ||
      this.totalBytes > this.maxBytes
    ) {
      if (!this.evictOldestSettled()) {
        break;
      }
    }
  }

  stats() {
    return {
      byteAccounting: "exact-json-serialized-content-v1",
      estimatedBytes: this.totalBytes,
      entries: this.values.size,
      evicted: this.evicted,
      expired: this.expired,
      maxBytes: this.maxBytes,
      maxEntries: this.maxEntries,
      oversized: this.oversized,
      refused: this.refused,
      serializedBytes: this.totalBytes,
      unserializable: this.unserializable,
    };
  }

  [Symbol.iterator]() {
    return this.values[Symbol.iterator]();
  }
}

/** A Map-like exact-byte LRU for immutable values with one mandatory TTL. */
export class BoundedTtlValueCache {
  constructor({ maxBytes, maxEntries, ttlMs = 6 * 60 * 60_000 } = {}) {
    this.ttlMs = positiveInteger(ttlMs, 6 * 60 * 60_000, {
      maximum: 30 * 24 * 60 * 60_000,
    });
    this.cache = new BoundedResponseCache({ maxBytes, maxEntries });
  }

  get size() {
    return this.cache.size;
  }

  clear() {
    this.cache.clear();
  }

  delete(key) {
    return this.cache.delete(key);
  }

  get(key) {
    return this.cache.get(key)?.value;
  }

  has(key) {
    return this.get(key) !== undefined;
  }

  set(key, value) {
    this.setWithOutcome(key, value);
    return this;
  }

  setWithOutcome(key, value) {
    return this.cache.setWithOutcome(key, {
      staleUntil: Date.now() + this.ttlMs,
      value,
    });
  }

  stats() {
    return { ...this.cache.stats(), ttlMs: this.ttlMs };
  }
}

/**
 * Serializes writes per key while retaining only the newest value waiting
 * behind an active write. Once the returned drain promise settles, the newest
 * submitted value has completed last for that key.
 */
export class LatestValueWriteCoordinator {
  constructor() {
    this.states = new Map();
  }

  get size() {
    return this.states.size;
  }

  run(key, value, writer) {
    if (typeof writer !== "function") {
      throw new TypeError("Latest-value writer must be a function.");
    }

    const active = this.states.get(key);
    if (active) {
      active.pending = { value, writer };
      return active.promise;
    }

    const state = {
      pending: { value, writer },
      promise: null,
    };
    this.states.set(key, state);
    state.promise = Promise.resolve().then(() => this.drain(key, state));
    return state.promise;
  }

  async drain(key, state) {
    let latestError = null;
    let latestResult;
    try {
      while (state.pending) {
        const pending = state.pending;
        state.pending = null;
        try {
          latestResult = await pending.writer(pending.value);
          latestError = null;
        } catch (error) {
          latestError = error;
        }
      }
      if (latestError) {
        throw latestError;
      }
      return latestResult;
    } finally {
      if (this.states.get(key) === state) {
        this.states.delete(key);
      }
    }
  }
}

export function settleBoundedCachePlaceholder(
  cache,
  key,
  placeholder,
  value,
  fallback = null,
) {
  if (cache?.peek(key) !== placeholder) {
    return { reason: "superseded", stored: false };
  }
  const outcome = cache.setWithOutcome(key, value);
  if (outcome.stored) {
    return outcome;
  }
  if (cache.peek(key) === placeholder) {
    cache.delete(key);
    if (fallback) {
      const restored = cache.setWithOutcome(key, fallback);
      return { ...outcome, fallbackStored: restored.stored === true };
    }
  }
  return outcome;
}

function admissionError(admissionClass, controller, reason) {
  const error = new Error("Read capacity is temporarily exhausted.");
  error.statusCode = 429;
  error.details = {
    active: controller.active,
    admissionClass,
    code: "READ_CAPACITY_EXCEEDED",
    maxActive: controller.maxActive,
    maxQueued: controller.maxQueued,
    queued: controller.queue.length,
    reason,
    retryAfterSeconds: 1,
  };
  return error;
}

/** A bounded FIFO semaphore for expensive public reads. */
export class ReadAdmissionController {
  constructor({ admissionClass, maxActive, maxQueued, waitMs } = {}) {
    this.admissionClass = String(admissionClass ?? "heavy");
    this.maxActive = positiveInteger(maxActive, 4, { maximum: 1_024 });
    this.maxQueued = positiveInteger(maxQueued, 16, { maximum: 10_000 });
    this.waitMs = positiveInteger(waitMs, 1_000, { maximum: 60_000 });
    this.active = 0;
    this.queue = [];
  }

  async acquire() {
    if (this.active < this.maxActive) {
      this.active += 1;
      return this.releaseHandle();
    }
    if (this.queue.length >= this.maxQueued) {
      throw admissionError(this.admissionClass, this, "queue-full");
    }

    return new Promise((resolve, reject) => {
      const queued = { reject, resolve, timer: null };
      queued.timer = setTimeout(() => {
        const index = this.queue.indexOf(queued);
        if (index >= 0) {
          this.queue.splice(index, 1);
        }
        reject(admissionError(this.admissionClass, this, "queue-timeout"));
      }, this.waitMs);
      queued.timer.unref?.();
      this.queue.push(queued);
    });
  }

  releaseHandle() {
    let released = false;
    return () => {
      if (released) {
        return;
      }
      released = true;
      this.active = Math.max(0, this.active - 1);
      this.drain();
    };
  }

  drain() {
    while (this.active < this.maxActive && this.queue.length > 0) {
      const queued = this.queue.shift();
      clearTimeout(queued.timer);
      this.active += 1;
      queued.resolve(this.releaseHandle());
    }
  }

  stats() {
    return {
      active: this.active,
      admissionClass: this.admissionClass,
      maxActive: this.maxActive,
      maxQueued: this.maxQueued,
      queued: this.queue.length,
      waitMs: this.waitMs,
    };
  }
}

export async function acquireReadAdmissionBeforeGate({
  admission,
  beforeAdmission,
  gate,
}) {
  beforeAdmission?.();
  const release = await admission.acquire();
  try {
    return {
      release,
      value: typeof gate === "function" ? await gate() : null,
    };
  } catch (error) {
    release();
    throw error;
  }
}

export class ReadSingleFlight {
  constructor({ maxKeys = 128 } = {}) {
    this.maxKeys = positiveInteger(maxKeys, 128, { maximum: 10_000 });
    this.inFlight = new Map();
  }

  run(key, producer) {
    const normalizedKey = String(key);
    const current = this.inFlight.get(normalizedKey);
    if (current) {
      return current;
    }
    if (this.inFlight.size >= this.maxKeys) {
      const error = new Error("Read single-flight capacity is exhausted.");
      error.statusCode = 429;
      error.details = {
        admissionClass: "single-flight",
        code: "READ_CAPACITY_EXCEEDED",
        retryAfterSeconds: 1,
      };
      throw error;
    }
    const pending = Promise.resolve()
      .then(producer)
      .finally(() => {
        if (this.inFlight.get(normalizedKey) === pending) {
          this.inFlight.delete(normalizedKey);
        }
      });
    this.inFlight.set(normalizedKey, pending);
    return pending;
  }

  stats() {
    return { inFlight: this.inFlight.size, maxKeys: this.maxKeys };
  }
}
