import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { runInNewContext } from "node:vm";

import {
  BoundedResponseCache,
  BoundedTtlValueCache,
  LatestValueWriteCoordinator,
  ReadAdmissionController,
  ReadSingleFlight,
  acquireReadAdmissionBeforeGate,
  settleBoundedCachePlaceholder,
} from "./api-runtime-guards.mjs";
import {
  canonicalSnapshotContentSha256,
  coherentCanonicalSnapshotAtBoundary,
  coherentFullCanonicalSnapshot,
  fullCanonicalSnapshotClaimed,
  transformFullCanonicalSnapshot,
  withFullCanonicalSnapshot,
} from "./canonical-snapshot.mjs";
import {
  exactCoreNodeAuthority,
  lifecycleInputOutpointsFromTransaction,
  mailMessageWithTxLifecycle,
  reconcileLivenetTxLifecycle,
  replacementDispositionFromSpenderEvidence,
  replacementDispositionFromTxOutEvidence,
  verifiedReplacementLifecycle,
  withCanonicalMailAttachedCredits,
} from "./tx-lifecycle.mjs";
import {
  WORKER_PENDING_DEGRADED_ONCE_CODE,
  authoritativeReplacedStatusEvidence,
  updateTransactionStatus,
  workerInternalVerifierHeaders,
  workerPendingDegradedOnceError,
  workerReadJson,
} from "../scripts/run-proof-indexer-worker.mjs";

function tokenSnapshotFixture(overrides = {}) {
  return {
    closedListings: [],
    holders: [],
    indexedAt: "2026-08-05T12:00:00.000Z",
    indexedThroughBlock: 123,
    indexedThroughBlockHash: "a".repeat(64),
    invalidEvents: [],
    listings: [],
    mints: [],
    network: "livenet",
    sales: [],
    snapshotId: "source-scan-123",
    source: "proof-indexer-token-state-tables",
    stats: { confirmedTokens: 1 },
    tokens: [{ confirmed: true, tokenId: "token" }],
    transfers: [],
    ...overrides,
  };
}

test("full canonical snapshot identity changes for same-tip pending removals", () => {
  const pendingTxid = "b".repeat(64);
  const withPending = withFullCanonicalSnapshot(
    tokenSnapshotFixture({
      listings: [{ confirmed: false, listingId: pendingTxid, txid: pendingTxid }],
    }),
    "token-state",
  );
  const withoutPending = withFullCanonicalSnapshot(
    tokenSnapshotFixture(),
    "token-state",
  );

  assert.ok(coherentFullCanonicalSnapshot(withPending, "token-state"));
  assert.ok(coherentFullCanonicalSnapshot(withoutPending, "token-state"));
  assert.equal(withPending.sourceSnapshotId, withoutPending.sourceSnapshotId);
  assert.equal(withPending.indexedAt, withoutPending.indexedAt);
  assert.notEqual(withPending.snapshotId, withoutPending.snapshotId);
});

test("nested provenance IDs participate in full snapshot identity", () => {
  const first = withFullCanonicalSnapshot(
    tokenSnapshotFixture({
      workTransferValueProjection: {
        canonicalSnapshot: { contentSha256: "old-envelope" },
        snapshotId: "projection-one",
      },
    }),
    "token-state",
  );
  const second = withFullCanonicalSnapshot(
    tokenSnapshotFixture({
      workTransferValueProjection: {
        canonicalSnapshot: { contentSha256: "new-envelope" },
        snapshotId: "projection-two",
      },
    }),
    "token-state",
  );

  assert.notEqual(first.snapshotId, second.snapshotId);
  assert.ok(coherentFullCanonicalSnapshot(first, "token-state"));
  assert.ok(coherentFullCanonicalSnapshot(second, "token-state"));
  const envelopeOnlyChange = withFullCanonicalSnapshot(
    tokenSnapshotFixture({
      workTransferValueProjection: {
        canonicalSnapshot: { contentSha256: "different-envelope" },
        snapshotId: "projection-one",
      },
    }),
    "token-state",
  );
  assert.equal(first.snapshotId, envelopeOnlyChange.snapshotId);
  const roundTripped = JSON.parse(JSON.stringify(first));
  assert.ok(coherentFullCanonicalSnapshot(roundTripped, "token-state"));
  assert.ok(coherentFullCanonicalSnapshot(roundTripped, "token-state"));
  assert.equal(Object.isFrozen(roundTripped), true);
  const mutatedRoundTrip = JSON.parse(JSON.stringify(first));
  mutatedRoundTrip.workTransferValueProjection.snapshotId = "mutated";
  assert.equal(
    coherentFullCanonicalSnapshot(mutatedRoundTrip, "token-state"),
    null,
  );
  assert.equal(
    coherentFullCanonicalSnapshot(
      { ...first, listings: [{ listingId: "mutated" }] },
      "token-state",
    ),
    null,
  );
});

test("canonical snapshot hashing remains byte-for-byte compatible", () => {
  const snapshot = withFullCanonicalSnapshot(
    tokenSnapshotFixture({
      transfers: [
        {
          amount: 1,
          detail: "line\nquote\"é😀",
          txid: "b".repeat(64),
        },
      ],
      workTransferValueProjection: {
        canonicalSnapshot: { contentSha256: "ignored-envelope" },
        snapshotId: "nested-provenance",
        value: "é😀",
      },
    }),
    "token-state",
  );

  assert.equal(
    snapshot.snapshotId,
    "88645d3e3f4263c073b25b26a571cc63ed3ca1ef144965f664e992ac69b38641",
  );
  assert.ok(coherentFullCanonicalSnapshot(snapshot, "token-state"));
});

test("canonical snapshot rewrap freezes only retained input containers", () => {
  const removedEnvelopeChild = { value: "remains-mutable" };
  const removedEnvelope = { child: removedEnvelopeChild };
  const snapshot = withFullCanonicalSnapshot(
    tokenSnapshotFixture({ canonicalSnapshot: removedEnvelope }),
    "token-state",
  );

  assert.notEqual(snapshot.canonicalSnapshot, removedEnvelope);
  assert.equal(Object.isFrozen(removedEnvelope), false);
  assert.equal(Object.isFrozen(removedEnvelopeChild), false);
  removedEnvelopeChild.value = "still-mutable";
  assert.equal(removedEnvelopeChild.value, "still-mutable");

  const retainedEnvelopeChild = { value: "must-freeze" };
  const retainedEnvelope = { child: retainedEnvelopeChild };
  const aliasedSnapshot = withFullCanonicalSnapshot(
    tokenSnapshotFixture({
      canonicalSnapshot: retainedEnvelope,
      retainedEnvelope,
    }),
    "token-state",
  );

  assert.equal(aliasedSnapshot.retainedEnvelope, retainedEnvelope);
  assert.equal(Object.isFrozen(retainedEnvelope), true);
  assert.equal(Object.isFrozen(retainedEnvelopeChild), true);
  assert.throws(() => {
    retainedEnvelopeChild.value = "mutated";
  }, TypeError);
});

test("canonical snapshot creation deep-freezes shallow-frozen subtrees", () => {
  const mutableGrandchild = { value: "before" };
  const shallowFrozenSubtree = Object.freeze({
    mutableGrandchild,
  });
  const snapshot = withFullCanonicalSnapshot(
    tokenSnapshotFixture({ shallowFrozenSubtree }),
    "token-state",
  );
  const digestBefore = canonicalSnapshotContentSha256(
    snapshot,
    "token-state",
  );

  assert.equal(Object.isFrozen(shallowFrozenSubtree), true);
  assert.equal(Object.isFrozen(mutableGrandchild), true);
  assert.equal(Object.getOwnPropertySymbols(snapshot).length, 0);
  assert.throws(() => {
    mutableGrandchild.value = "after";
  }, TypeError);
  assert.equal(mutableGrandchild.value, "before");
  assert.equal(
    canonicalSnapshotContentSha256(snapshot, "token-state"),
    digestBefore,
  );
  assert.equal(snapshot.snapshotId, digestBefore);
  assert.ok(coherentFullCanonicalSnapshot(snapshot, "token-state"));
  assert.ok(coherentFullCanonicalSnapshot(snapshot, "token-state"));
});

test("canonical snapshot authentication is private and exact-root bound", () => {
  const snapshot = withFullCanonicalSnapshot(
    tokenSnapshotFixture(),
    "token-state",
  );
  assert.ok(coherentFullCanonicalSnapshot(snapshot, "token-state"));
  assert.equal(Object.getOwnPropertySymbols(snapshot).length, 0);

  const copiedRoot = {
    ...snapshot,
    tokens: [{ confirmed: true, tokenId: "forged-copy" }],
  };
  assert.equal(
    coherentFullCanonicalSnapshot(copiedRoot, "token-state"),
    null,
  );

  const inheritedRoot = Object.create(snapshot);
  assert.equal(
    coherentFullCanonicalSnapshot(inheritedRoot, "token-state"),
    null,
  );
  assert.deepEqual(
    coherentCanonicalSnapshotAtBoundary(inheritedRoot, "token-state"),
    {},
  );
});

test("canonical snapshots reject accessors, exotics, cycles, and non-JSON values", () => {
  let accessorReads = 0;
  const accessorPayload = tokenSnapshotFixture();
  Object.defineProperty(accessorPayload, "unsafe", {
    enumerable: true,
    get() {
      accessorReads += 1;
      return "getter-result";
    },
  });
  assert.throws(
    () => withFullCanonicalSnapshot(accessorPayload, "token-state"),
    /strict JSON tree/u,
  );
  assert.equal(accessorReads, 0);

  const accessorClaim = { safe: "retained" };
  Object.defineProperty(accessorClaim, "canonicalSnapshot", {
    enumerable: true,
    get() {
      accessorReads += 1;
      return { full: true };
    },
  });
  const strippedAccessorClaim = coherentCanonicalSnapshotAtBoundary(
    accessorClaim,
    "token-state",
  );
  assert.deepEqual(strippedAccessorClaim, { safe: "retained" });
  assert.equal(fullCanonicalSnapshotClaimed(strippedAccessorClaim), false);
  assert.equal(accessorReads, 0);

  const customPrototype = Object.create({ inherited: true });
  customPrototype.value = "custom";
  const cyclic = {};
  cyclic.self = cyclic;
  const sparse = [];
  sparse.length = 1;
  for (const invalid of [
    new Date("2026-08-05T12:00:00.000Z"),
    new Map([["key", "value"]]),
    new Set(["value"]),
    customPrototype,
    cyclic,
    sparse,
    undefined,
    1n,
    Number.NaN,
    Symbol("unsafe"),
    () => "unsafe",
  ]) {
    assert.throws(
      () =>
        withFullCanonicalSnapshot(
          tokenSnapshotFixture({ unsafe: invalid }),
          "token-state",
        ),
      /strict JSON tree/u,
    );
  }

  let proxyReads = 0;
  const proxied = new Proxy(
    { value: "unsafe" },
    {
      get(target, key, receiver) {
        proxyReads += 1;
        return Reflect.get(target, key, receiver);
      },
    },
  );
  assert.throws(
    () =>
      withFullCanonicalSnapshot(
        tokenSnapshotFixture({ unsafe: proxied }),
        "token-state",
      ),
    /strict JSON tree/u,
  );
  assert.equal(proxyReads, 0);
});

test("canonical snapshots accept only native plain containers across realms", () => {
  const crossRealmJson = runInNewContext(
    '({ nested: [{ value: "cross-realm" }] })',
  );
  const snapshot = withFullCanonicalSnapshot(
    tokenSnapshotFixture({ crossRealmJson }),
    "token-state",
  );
  assert.ok(coherentFullCanonicalSnapshot(snapshot, "token-state"));
  assert.equal(Object.isFrozen(crossRealmJson), true);
  assert.equal(Object.isFrozen(crossRealmJson.nested), true);
  assert.equal(Object.isFrozen(crossRealmJson.nested[0]), true);

  const fakePrototype = Object.create(null);
  const fakeObjectConstructor = function Object() {
    return "[native code]";
  };
  fakeObjectConstructor.prototype = fakePrototype;
  Object.defineProperty(fakePrototype, "constructor", {
    configurable: true,
    value: fakeObjectConstructor,
    writable: true,
  });
  const spoofed = Object.create(fakePrototype);
  spoofed.value = "custom";
  assert.throws(
    () =>
      withFullCanonicalSnapshot(
        tokenSnapshotFixture({ spoofed }),
        "token-state",
      ),
    /strict JSON tree/u,
  );
});

test("persisted canonical snapshots validate once, deep-freeze, and reject exotic substitution", () => {
  const canonical = withFullCanonicalSnapshot(
    tokenSnapshotFixture({
      tokens: [{ confirmed: true, metadata: { rank: 1 }, tokenId: "token" }],
    }),
    "token-state",
  );
  const persisted = JSON.parse(JSON.stringify(canonical));
  assert.ok(coherentFullCanonicalSnapshot(persisted, "token-state"));
  assert.equal(Object.isFrozen(persisted), true);
  assert.equal(Object.isFrozen(persisted.tokens), true);
  assert.equal(Object.isFrozen(persisted.tokens[0]), true);
  assert.equal(Object.isFrozen(persisted.tokens[0].metadata), true);
  assert.ok(coherentFullCanonicalSnapshot(persisted, "token-state"));

  for (const exotic of [
    new Date("2026-08-05T12:00:00.000Z"),
    new Map([["key", "value"]]),
    new Set(["value"]),
  ]) {
    const substituted = JSON.parse(JSON.stringify(canonical));
    substituted.tokens[0].metadata = exotic;
    assert.equal(
      coherentFullCanonicalSnapshot(substituted, "token-state"),
      null,
    );
  }

  const accessorSubstitution = JSON.parse(JSON.stringify(canonical));
  let accessorReads = 0;
  Object.defineProperty(accessorSubstitution.tokens[0], "metadata", {
    enumerable: true,
    get() {
      accessorReads += 1;
      return { rank: 2 };
    },
  });
  assert.equal(
    coherentFullCanonicalSnapshot(accessorSubstitution, "token-state"),
    null,
  );
  assert.equal(accessorReads, 0);
});

test("canonical response transforms rewrap while local overlays downgrade", () => {
  const canonical = withFullCanonicalSnapshot(
    tokenSnapshotFixture(),
    "token-state",
  );
  const enriched = transformFullCanonicalSnapshot(
    canonical,
    "token-state",
    (payload) => ({
      ...payload,
      workAmoV8: { ready: true },
    }),
  );
  assert.ok(coherentFullCanonicalSnapshot(enriched, "token-state"));
  assert.notEqual(enriched.snapshotId, canonical.snapshotId);

  const spendable = transformFullCanonicalSnapshot(
    enriched,
    "token-state",
    (payload) => ({
      ...payload,
      listings: [{ confirmed: true, listingId: "c".repeat(64) }],
    }),
  );
  assert.ok(coherentFullCanonicalSnapshot(spendable, "token-state"));
  assert.notEqual(spendable.snapshotId, enriched.snapshotId);

  const persisted = JSON.parse(JSON.stringify(spendable));
  assert.ok(coherentFullCanonicalSnapshot(persisted, "token-state"));
  assert.equal(Object.isFrozen(persisted), true);

  const staleCopy = {
    ...spendable,
    listings: [],
  };
  assert.equal(coherentFullCanonicalSnapshot(staleCopy, "token-state"), null);
  const boundaryPayload = coherentCanonicalSnapshotAtBoundary(
    staleCopy,
    "token-state",
  );
  assert.equal(fullCanonicalSnapshotClaimed(boundaryPayload), false);
  assert.equal(boundaryPayload.snapshotId, undefined);

  const localOverlay = transformFullCanonicalSnapshot(
    spendable,
    "token-state",
    (payload) => ({
      ...payload,
      workAmoV8: { ready: false, reasonCode: "retained-cache" },
    }),
    { preserveCanonicalClaim: false },
  );
  assert.equal(fullCanonicalSnapshotClaimed(localOverlay), false);
});

test("100k-row full snapshot fingerprinting stays within Phase A bounds", () => {
  const transfers = Array.from({ length: 100_000 }, (_unused, index) => ({
    amount: index + 1,
    detail: "canonical-transfer".repeat(10),
    recipientAddress: `bc1q${String(index).padStart(38, "0")}`,
    snapshotId: `nested-provenance-${index}`,
    txid: index.toString(16).padStart(64, "0"),
  }));
  const maxRssBeforeKb = process.resourceUsage().maxRSS;
  const startedAt = performance.now();
  const snapshot = withFullCanonicalSnapshot(
    tokenSnapshotFixture({ transfers }),
    "token-state",
  );
  for (let index = 0; index < 5; index += 1) {
    assert.ok(coherentFullCanonicalSnapshot(snapshot, "token-state"));
  }
  const elapsedMs = performance.now() - startedAt;
  const maxRssGrowthKb = process.resourceUsage().maxRSS - maxRssBeforeKb;

  assert.ok(elapsedMs < 4_000, `snapshot validation took ${elapsedMs}ms`);
  if (process.platform === "linux") {
    assert.ok(
      maxRssGrowthKb < 224 * 1024,
      `snapshot validation grew max RSS by ${maxRssGrowthKb} KiB`,
    );
  }
});

test("bounded cache measures large payloads exactly and enforces byte/entry ceilings", () => {
  const cache = new BoundedResponseCache({
    maxBytes: 2 * 1024 * 1024,
    maxEntries: 3,
  });
  const largePayload = Array.from({ length: 5_000 }, (_, index) => ({
    index,
    value: "canonical-value",
  }));
  cache.set("large", {
    expiresAt: Date.now() + 60_000,
    payload: largePayload,
    staleUntil: Date.now() + 120_000,
  });
  assert.equal(cache.get("large")?.payload, largePayload);

  cache.set("body-a", {
    body: "a".repeat(950_000),
    staleUntil: Date.now() + 120_000,
  });
  cache.set("body-b", {
    body: "b".repeat(950_000),
    staleUntil: Date.now() + 120_000,
  });
  const stats = cache.stats();
  assert.ok(stats.entries <= stats.maxEntries);
  assert.ok(stats.estimatedBytes <= stats.maxBytes);
  assert.ok(stats.evicted > 0);
  assert.equal(
    stats.byteAccounting,
    "exact-json-serialized-content-v1",
  );
  assert.equal(stats.serializedBytes, stats.estimatedBytes);
});

test("bounded cache rejects a wide object that exceeds its exact JSON byte ceiling", () => {
  const cache = new BoundedResponseCache({
    maxBytes: 1024 * 1024,
    maxEntries: 4,
  });
  const payload = Object.fromEntries(
    Array.from({ length: 10_000 }, (_unused, index) => [
      `k${index}`,
      "x".repeat(1_000),
    ]),
  );
  const entry = { payload, staleUntil: Date.now() + 120_000 };
  const serializedBytes = Buffer.byteLength(JSON.stringify(entry), "utf8");
  const outcome = cache.setWithOutcome("wide", entry);

  assert.ok(serializedBytes > 10_000_000);
  assert.deepEqual(outcome, { reason: "oversized", stored: false });
  assert.equal(cache.peek("wide"), undefined);
  assert.equal(cache.stats().oversized, 1);
  assert.equal(cache.stats().serializedBytes, 0);
});

test("bounded cache replaces payload and JSON entries atomically", () => {
  const cache = new BoundedResponseCache({ maxBytes: 1_024, maxEntries: 4 });
  const priorPayload = {
    payload: { snapshotId: "last-good" },
    staleUntil: Date.now() + 120_000,
  };
  const priorJson = {
    body: '{"snapshotId":"last-good"}',
    staleUntil: Date.now() + 120_000,
  };
  assert.equal(
    cache.setManyWithOutcome([
      ["payload:summary", priorPayload],
      ["json:summary", priorJson],
    ]).stored,
    true,
  );

  const refused = cache.setManyWithOutcome([
    [
      "payload:summary",
      {
        payload: { value: "p".repeat(650) },
        staleUntil: Date.now() + 120_000,
      },
    ],
    [
      "json:summary",
      {
        body: "j".repeat(650),
        staleUntil: Date.now() + 120_000,
      },
    ],
  ]);

  assert.deepEqual(refused, { reason: "capacity", stored: false });
  assert.equal(cache.peek("payload:summary"), priorPayload);
  assert.equal(cache.peek("json:summary"), priorJson);
  assert.equal(cache.stats().evicted, 0);
});

test("bounded cache accounts and freezes a successful related-entry commit", () => {
  const cache = new BoundedResponseCache({ maxBytes: 8_192, maxEntries: 4 });
  const payloadEntry = {
    payload: { rows: [{ txid: "a".repeat(64) }] },
    staleUntil: Date.now() + 120_000,
  };
  const jsonEntry = {
    body: JSON.stringify(payloadEntry.payload),
    staleUntil: Date.now() + 120_000,
  };
  const expectedBytes =
    Buffer.byteLength(JSON.stringify(payloadEntry), "utf8") +
    Buffer.byteLength(JSON.stringify(jsonEntry), "utf8");
  const outcome = cache.setManyWithOutcome([
    ["payload:summary", payloadEntry],
    ["json:summary", jsonEntry],
  ]);

  assert.deepEqual(outcome, {
    bytes: expectedBytes,
    reason: "stored",
    stored: true,
  });
  assert.equal(cache.stats().serializedBytes, expectedBytes);
  assert.equal(Object.isFrozen(payloadEntry.payload.rows[0]), true);
  assert.equal(Object.isFrozen(jsonEntry), true);
});

test("bounded exact-tip cache sweeps TTLs and refuses unbounded scopes", () => {
  const cache = new BoundedResponseCache({ maxBytes: 8_192, maxEntries: 2 });
  const now = Date.now();
  assert.equal(
    cache.setWithOutcome("token:livenet:one", {
      payload: { token: "one" },
      staleUntil: now - 1,
      validatedUntil: now - 1,
    }).stored,
    true,
  );
  assert.equal(cache.get("token:livenet:one"), undefined);
  for (const scope of ["two", "three", "four"]) {
    cache.setWithOutcome(`token:livenet:${scope}`, {
      payload: { token: scope },
      staleUntil: now + 120_000,
      validatedUntil: now + 120_000,
    });
  }
  assert.equal(cache.size, 2);
  assert.equal(cache.peek("token:livenet:two"), undefined);
  assert.ok(cache.stats().serializedBytes <= cache.stats().maxBytes);
});

test("transaction-value cache has exact byte, entry, and TTL ceilings", async () => {
  const cache = new BoundedTtlValueCache({
    maxBytes: 1_024,
    maxEntries: 2,
    ttlMs: 5,
  });
  const first = { txid: "a".repeat(64), vin: [], vout: [] };
  assert.equal(cache.setWithOutcome("first", first).stored, true);
  assert.equal(Object.isFrozen(first), true);
  assert.equal(cache.get("first"), first);

  assert.deepEqual(
    cache.setWithOutcome("oversized", {
      hex: "f".repeat(2_048),
      txid: "b".repeat(64),
    }),
    { reason: "oversized", stored: false },
  );
  assert.equal(cache.get("first"), first);

  await new Promise((resolve) => setTimeout(resolve, 10));
  assert.equal(cache.get("first"), undefined);
  for (const key of ["second", "third", "fourth"]) {
    cache.set(key, { txid: key, vin: [], vout: [] });
  }
  assert.equal(cache.size, 2);
  assert.equal(cache.get("second"), undefined);
  assert.ok(cache.stats().serializedBytes <= cache.stats().maxBytes);
  assert.equal(cache.stats().ttlMs, 5);
});

test("persisted writes serialize a delayed rename and coalesce to the newest body", async () => {
  const coordinator = new LatestValueWriteCoordinator();
  let releaseFirstRename;
  let signalFirstRename;
  const firstRenameStarted = new Promise((resolve) => {
    signalFirstRename = resolve;
  });
  const firstRenameRelease = new Promise((resolve) => {
    releaseFirstRename = resolve;
  });
  const renamedBodies = [];
  let diskBody = "";
  const renameBody = async (body) => {
    if (body === "old") {
      signalFirstRename();
      await firstRenameRelease;
    }
    renamedBodies.push(body);
    diskBody = body;
    return true;
  };

  const oldWrite = coordinator.run("json:token:livenet:work", "old", renameBody);
  await firstRenameStarted;
  const middleWrite = coordinator.run(
    "json:token:livenet:work",
    "middle",
    renameBody,
  );
  const newestWrite = coordinator.run(
    "json:token:livenet:work",
    "newest",
    renameBody,
  );

  assert.strictEqual(middleWrite, oldWrite);
  assert.strictEqual(newestWrite, oldWrite);
  assert.equal(coordinator.size, 1);
  assert.deepEqual(renamedBodies, []);
  releaseFirstRename();
  assert.deepEqual(await Promise.all([oldWrite, middleWrite, newestWrite]), [
    true,
    true,
    true,
  ]);
  assert.deepEqual(renamedBodies, ["old", "newest"]);
  assert.equal(diskBody, "newest");
  assert.equal(coordinator.size, 0);
});

test("bounded cache rejects BigInt and cyclic content without replacing last-good", () => {
  const cache = new BoundedResponseCache({ maxBytes: 4_096, maxEntries: 4 });
  const lastGood = {
    body: "canonical-last-good",
    staleUntil: Date.now() + 120_000,
  };
  cache.set("summary", lastGood);

  assert.deepEqual(
    cache.setWithOutcome("summary", {
      payload: { amount: 1n },
      staleUntil: Date.now() + 120_000,
    }),
    { reason: "unserializable", stored: false },
  );
  assert.equal(cache.peek("summary"), lastGood);

  const cyclic = {};
  cyclic.self = cyclic;
  assert.deepEqual(cache.setWithOutcome("cyclic", cyclic), {
    reason: "unserializable",
    stored: false,
  });
  assert.equal(cache.peek("cyclic"), undefined);
  assert.equal(cache.stats().unserializable, 2);
});

test("bounded cache freezes admitted trees so exact UTF-8 bytes cannot grow", () => {
  const cache = new BoundedResponseCache({ maxBytes: 4_096, maxEntries: 4 });
  const entry = {
    body: "proofs 🛡️ élite",
    payload: {
      rows: [{ detail: "canonical" }],
    },
    staleUntil: Date.now() + 120_000,
  };
  const expectedBytes = Buffer.byteLength(JSON.stringify(entry), "utf8");
  const outcome = cache.setWithOutcome("immutable", entry);

  assert.deepEqual(outcome, {
    bytes: expectedBytes,
    reason: "stored",
    stored: true,
  });
  assert.equal(Object.isFrozen(entry), true);
  assert.equal(Object.isFrozen(entry.payload), true);
  assert.equal(Object.isFrozen(entry.payload.rows), true);
  assert.equal(Object.isFrozen(entry.payload.rows[0]), true);
  assert.throws(() => {
    entry.payload.rows[0].detail = "x".repeat(10_000);
  }, TypeError);
  assert.equal(
    Buffer.byteLength(JSON.stringify(cache.peek("immutable")), "utf8"),
    expectedBytes,
  );
  assert.equal(cache.stats().serializedBytes, expectedBytes);

  const crossRealmEntry = runInNewContext(
    '({ payload: { rows: [{ detail: "cross-realm" }] } })',
  );
  crossRealmEntry.staleUntil = Date.now() + 120_000;
  assert.equal(
    cache.setWithOutcome("cross-realm", crossRealmEntry).stored,
    true,
  );
  assert.equal(Object.isFrozen(crossRealmEntry), true);
  assert.equal(Object.isFrozen(crossRealmEntry.payload), true);
  assert.equal(Object.isFrozen(crossRealmEntry.payload.rows), true);
  assert.equal(Object.isFrozen(crossRealmEntry.payload.rows[0]), true);
});

test("bounded cache rejects accessors, exotics, and mutable JSON ambiguities", () => {
  const cache = new BoundedResponseCache({ maxBytes: 8_192, maxEntries: 32 });
  const lastGood = {
    body: "canonical-last-good",
    staleUntil: Date.now() + 120_000,
  };
  assert.equal(cache.setWithOutcome("summary", lastGood).stored, true);

  const customPrototype = Object.create({ inherited: true });
  customPrototype.value = "custom";
  const sparse = [];
  sparse.length = 1;
  const nestedPromise = Promise.resolve("nested");
  const invalidValues = [
    new Date("2026-08-05T12:00:00.000Z"),
    new Map([["key", "value"]]),
    new Set(["value"]),
    customPrototype,
    sparse,
    Number.POSITIVE_INFINITY,
    Symbol("unsafe"),
    () => "unsafe",
    { promise: nestedPromise },
  ];
  for (const [index, invalid] of invalidValues.entries()) {
    assert.deepEqual(
      cache.setWithOutcome(`invalid-${index}`, {
        payload: invalid,
        staleUntil: Date.now() + 120_000,
      }),
      { reason: "unserializable", stored: false },
    );
  }

  let accessorReads = 0;
  const accessorEntry = { staleUntil: Date.now() + 120_000 };
  Object.defineProperty(accessorEntry, "payload", {
    enumerable: true,
    get() {
      accessorReads += 1;
      return "unsafe";
    },
  });
  assert.deepEqual(cache.setWithOutcome("accessor", accessorEntry), {
    reason: "unserializable",
    stored: false,
  });
  assert.equal(accessorReads, 0);

  let proxyReads = 0;
  const proxyEntry = {
    payload: new Proxy(
      { value: "unsafe" },
      {
        get(target, key, receiver) {
          proxyReads += 1;
          return Reflect.get(target, key, receiver);
        },
      },
    ),
    staleUntil: Date.now() + 120_000,
  };
  assert.deepEqual(cache.setWithOutcome("proxy", proxyEntry), {
    reason: "unserializable",
    stored: false,
  });
  assert.equal(proxyReads, 0);
  assert.deepEqual(
    cache.setWithOutcome("fake-placeholder", {
      promise: {},
      staleUntil: Date.now() + 120_000,
    }),
    { reason: "unserializable", stored: false },
  );
  assert.deepEqual(
    cache.setWithOutcome("invalid-deadline", {
      payload: "unsafe",
      staleUntil: {},
    }),
    { reason: "unserializable", stored: false },
  );
  assert.equal(cache.peek("summary"), lastGood);
});

test("bounded cache keeps native Promise placeholders immutable and settleable", async () => {
  const cache = new BoundedResponseCache({ maxBytes: 4_096, maxEntries: 4 });
  const promise = Promise.resolve({ body: "settled" });
  const placeholder = {
    expiresAt: Date.now() + 60_000,
    payload: undefined,
    promise,
    staleUntil: Date.now() + 120_000,
  };
  const placeholderBytes = Buffer.byteLength(
    JSON.stringify(placeholder),
    "utf8",
  );
  const admitted = cache.setWithOutcome("pending", placeholder);
  assert.equal(admitted.stored, true);
  assert.equal(admitted.bytes, placeholderBytes);
  assert.equal(Object.isFrozen(placeholder), true);
  assert.equal(Object.isFrozen(promise), true);
  assert.deepEqual(await promise, { body: "settled" });

  const settled = {
    body: "settled",
    expiresAt: Date.now() + 60_000,
    staleUntil: Date.now() + 120_000,
  };
  assert.equal(
    settleBoundedCachePlaceholder(
      cache,
      "pending",
      placeholder,
      settled,
    ).stored,
    true,
  );
  assert.equal(cache.peek("pending"), settled);
  assert.equal(Object.isFrozen(settled), true);
  assert.equal(cache.peek("pending")?.promise, undefined);
});

test("bounded cache accepts a null settled marker and expires it normally", () => {
  const cache = new BoundedResponseCache({ maxBytes: 4_096, maxEntries: 4 });
  const promise = Promise.resolve({ body: "settled" });
  const placeholder = {
    expiresAt: Date.now() - 1,
    payload: { body: "canonical-ledger" },
    promise,
    staleUntil: Date.now() + 60_000,
  };
  assert.equal(cache.setWithOutcome("ledger", placeholder).stored, true);

  const settled = {
    ...cache.peek("ledger"),
    promise: null,
    staleUntil: Date.now() - 1,
  };
  const outcome = cache.setWithOutcome("ledger", settled);

  assert.equal(outcome.stored, true);
  assert.equal(cache.peek("ledger"), settled);
  assert.equal(cache.get("ledger"), undefined);
  assert.equal(cache.stats().expired, 1);
});

test("worker verifier credentials fail closed before a non-loopback fetch", async () => {
  const token = "v".repeat(64);
  for (const base of [
    "http://127.0.0.1:8081/api/v1/tx/status",
    "http://[::1]:8081/api/v1/tx/status",
    "http://localhost:8081/api/v1/tx/status",
  ]) {
    assert.deepEqual(workerInternalVerifierHeaders(new URL(base), token), {
      "x-pow-internal-verifier": token,
    });
  }
  assert.deepEqual(
    workerInternalVerifierHeaders(
      new URL("https://computer.proofofwork.me/api/v1/tx/status"),
      "",
    ),
    {},
  );

  for (const base of [
    "https://127.0.0.1:8081/api/v1/tx/status",
    "http://127.0.0.2:8081/api/v1/tx/status",
    "http://localhost.example:8081/api/v1/tx/status",
    "https://computer.proofofwork.me/api/v1/tx/status",
  ]) {
    let fetchCalls = 0;
    await assert.rejects(
      workerReadJson(new URL(base), 1_000, {
        fetchImplementation: async () => {
          fetchCalls += 1;
          throw new Error("fetch must not run");
        },
        internalVerifierToken: token,
      }),
      (error) => {
        assert.equal(error.code, "POW_INTERNAL_VERIFIER_TRANSPORT_UNSAFE");
        assert.doesNotMatch(error.message, new RegExp(token, "u"));
        return true;
      },
    );
    assert.equal(fetchCalls, 0);
  }

  const loopbackUrl = new URL("http://127.0.0.1:8081/api/v1/tx/status");
  const payload = await workerReadJson(loopbackUrl, 1_000, {
    fetchImplementation: async (requestedUrl, options) => {
      assert.equal(requestedUrl, loopbackUrl);
      assert.equal(options.redirect, "error");
      assert.deepEqual(options.headers, {
        "x-pow-internal-verifier": token,
      });
      return {
        json: async () => ({ canonical: true }),
        ok: true,
        status: 200,
      };
    },
    internalVerifierToken: token,
  });
  assert.deepEqual(payload, { canonical: true });
});

test("bounded cache never exceeds its entry ceiling with only in-flight values", () => {
  const cache = new BoundedResponseCache({ maxBytes: 10_000, maxEntries: 2 });
  const never = new Promise(() => {});
  for (const key of ["one", "two", "three"]) {
    cache.set(key, {
      expiresAt: Date.now() + 60_000,
      promise: never,
      staleUntil: Date.now() + 120_000,
    });
  }
  assert.equal(cache.stats().entries, 2);
  assert.equal(cache.stats().refused, 1);
  assert.equal(cache.get("one")?.promise, never);
  assert.equal(cache.get("two")?.promise, never);
});

test("an oversized replacement preserves the prior last-good cache entry", () => {
  const cache = new BoundedResponseCache({ maxBytes: 2_048, maxEntries: 2 });
  const lastGood = {
    body: "canonical-last-good",
    staleUntil: Date.now() + 120_000,
  };
  cache.set("summary", lastGood);
  cache.set("summary", {
    body: "x".repeat(4_096),
    staleUntil: Date.now() + 120_000,
  });
  assert.equal(cache.get("summary"), lastGood);
  assert.equal(cache.stats().oversized, 1);
});

test("an oversized cold settlement removes its in-flight placeholder", () => {
  const cache = new BoundedResponseCache({ maxBytes: 2_048, maxEntries: 2 });
  const promise = Promise.resolve("oversized");
  const placeholder = {
    expiresAt: Date.now() + 60_000,
    promise,
    staleUntil: Date.now() + 120_000,
  };
  assert.equal(cache.setWithOutcome("cold", placeholder).stored, true);

  const outcome = settleBoundedCachePlaceholder(
    cache,
    "cold",
    placeholder,
    {
      body: "x".repeat(4_096),
      expiresAt: Date.now() + 60_000,
      staleUntil: Date.now() + 120_000,
    },
  );

  assert.equal(outcome.stored, false);
  assert.equal(outcome.reason, "oversized");
  assert.equal(cache.peek("cold"), undefined);
  assert.ok(cache.stats().estimatedBytes <= cache.stats().maxBytes);
});

test("an oversized stale settlement restores immutable last-good data", async () => {
  const cache = new BoundedResponseCache({ maxBytes: 2_048, maxEntries: 2 });
  const lastGood = {
    body: "canonical-last-good",
    expiresAt: Date.now() - 1,
    staleUntil: Date.now() + 20,
  };
  cache.set("stale", lastGood);
  const placeholder = {
    ...lastGood,
    promise: Promise.resolve("oversized"),
  };
  assert.equal(cache.setWithOutcome("stale", placeholder).stored, true);

  const outcome = settleBoundedCachePlaceholder(
    cache,
    "stale",
    placeholder,
    {
      body: "x".repeat(4_096),
      expiresAt: Date.now() + 60_000,
      staleUntil: Date.now() + 120_000,
    },
    lastGood,
  );

  assert.equal(outcome.stored, false);
  assert.equal(outcome.fallbackStored, true);
  assert.equal(cache.peek("stale"), lastGood);
  assert.equal(cache.peek("stale")?.promise, undefined);
  await new Promise((resolve) => setTimeout(resolve, 25));
  assert.equal(cache.get("stale"), undefined);
  assert.ok(cache.stats().estimatedBytes <= cache.stats().maxBytes);
});

test("identical expensive reads share one producer while distinct keys do not", async () => {
  const flights = new ReadSingleFlight({ maxKeys: 4 });
  let resolveShared;
  let calls = 0;
  const producer = () => {
    calls += 1;
    return new Promise((resolve) => {
      resolveShared = resolve;
    });
  };
  const first = flights.run("same-snapshot", producer);
  const second = flights.run("same-snapshot", producer);
  assert.equal(calls, 0);
  await Promise.resolve();
  assert.equal(calls, 1);
  resolveShared({ snapshotId: "snapshot-1" });
  assert.deepEqual(await Promise.all([first, second]), [
    { snapshotId: "snapshot-1" },
    { snapshotId: "snapshot-1" },
  ]);
  assert.equal(flights.stats().inFlight, 0);
});

test("read admission caps active and queued work", async () => {
  const admission = new ReadAdmissionController({
    admissionClass: "test",
    maxActive: 1,
    maxQueued: 1,
    waitMs: 1_000,
  });
  const releaseFirst = await admission.acquire();
  const queued = admission.acquire();
  await assert.rejects(admission.acquire(), (error) => {
    assert.equal(error.statusCode, 429);
    assert.equal(error.details?.reason, "queue-full");
    return true;
  });
  releaseFirst();
  const releaseSecond = await queued;
  assert.equal(admission.stats().active, 1);
  releaseSecond();
  assert.equal(admission.stats().active, 0);
});

test("fresh-read rejection happens before a coalesced canonical gate", async () => {
  const admission = new ReadAdmissionController({
    admissionClass: "fresh",
    maxActive: 2,
    maxQueued: 1,
    waitMs: 1_000,
  });
  const flights = new ReadSingleFlight({ maxKeys: 2 });
  let gateCalls = 0;
  let maximumGateCalls = 0;
  let activeGateCalls = 0;
  let resolveGate;
  const gateBarrier = new Promise((resolve) => {
    resolveGate = resolve;
  });
  const gate = () =>
    flights.run("livenet:canonical-gate", () => {
      gateCalls += 1;
      activeGateCalls += 1;
      maximumGateCalls = Math.max(maximumGateCalls, activeGateCalls);
      return gateBarrier.finally(() => {
          activeGateCalls -= 1;
      });
    });
  const attempts = Array.from({ length: 12 }, () =>
    acquireReadAdmissionBeforeGate({ admission, gate })
      .then(({ release, value }) => {
        release();
        return value;
      })
      .catch((error) => error),
  );
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(gateCalls, 1);
  assert.equal(maximumGateCalls, 1);
  assert.equal(admission.stats().active, 2);
  assert.equal(admission.stats().queued, 1);

  let rejectedGateCalls = 0;
  await assert.rejects(
    acquireReadAdmissionBeforeGate({
      admission,
      beforeAdmission: () => {
        const error = new Error("rate limited");
        error.statusCode = 429;
        throw error;
      },
      gate: async () => {
        rejectedGateCalls += 1;
      },
    }),
    (error) => error.statusCode === 429,
  );
  assert.equal(rejectedGateCalls, 0);

  resolveGate({ ok: true });
  const outcomes = await Promise.all(attempts);
  assert.ok(
    outcomes.filter((outcome) => outcome?.statusCode === 429).length >= 9,
  );
  assert.ok(gateCalls <= 2);
  assert.equal(maximumGateCalls, 1);
  assert.equal(admission.stats().active, 0);
});

test("a distinct transaction storm cannot exceed Core admission concurrency", async () => {
  const configuredConcurrency = 3;
  const admission = new ReadAdmissionController({
    admissionClass: "core-tx-status",
    maxActive: configuredConcurrency,
    maxQueued: 32,
    waitMs: 1_000,
  });
  let active = 0;
  let maximumActive = 0;
  const tasks = Array.from({ length: 20 }, async () => {
    const release = await admission.acquire();
    active += 1;
    maximumActive = Math.max(maximumActive, active);
    await new Promise((resolve) => setImmediate(resolve));
    active -= 1;
    release();
  });
  await Promise.all(tasks);
  assert.equal(maximumActive, configuredConcurrency);
  assert.equal(admission.stats().active, 0);
});

test("one-shot workers fail after recording a pending-degraded cycle", () => {
  assert.equal(workerPendingDegradedOnceError({ pendingDegraded: true }, false), null);
  assert.equal(workerPendingDegradedOnceError({ pendingDegraded: false }, true), null);
  const error = workerPendingDegradedOnceError(
    { pendingDegraded: true },
    true,
  );
  assert.equal(error?.code, WORKER_PENDING_DEGRADED_ONCE_CODE);
});

test("Core absence authority requires one exact unpruned mainnet tip and txindex", () => {
  const blockHash = "a".repeat(64);
  const exactChain = {
    ok: true,
    result: {
      bestblockhash: blockHash,
      blocks: 100,
      chain: "main",
      headers: 100,
      initialblockdownload: false,
      pruned: false,
      verificationprogress: 0.9999,
    },
  };
  const exactIndex = {
    ok: true,
    result: {
      txindex: {
        best_block_height: 100,
        synced: true,
      },
    },
  };
  assert.deepEqual(exactCoreNodeAuthority(exactChain, exactIndex), {
    blockHash,
    height: 100,
    txindexHeight: 100,
    verificationProgress: 0.9999,
  });

  const invalidChains = [
    { ...exactChain.result, pruned: undefined },
    { ...exactChain.result, initialblockdownload: undefined },
    { ...exactChain.result, headers: 101 },
    { ...exactChain.result, headers: 99 },
    { ...exactChain.result, bestblockhash: undefined },
    { ...exactChain.result, verificationprogress: 0.998 },
  ];
  for (const result of invalidChains) {
    assert.equal(exactCoreNodeAuthority({ ok: true, result }, exactIndex), null);
  }
  assert.equal(
    exactCoreNodeAuthority(exactChain, {
      ok: true,
      result: { txindex: { best_block_height: 99, synced: true } },
    }),
    null,
  );
  assert.equal(
    exactCoreNodeAuthority(exactChain, {
      ok: true,
      result: { txindex: { best_block_height: 100, synced: false } },
    }),
    null,
  );
});

test("mail lifecycle preserves only canonically proven confirmed credit attachments", () => {
  const txid = "f".repeat(64);
  const attachedCredits = [
    {
      amountAtoms: "100000000",
      recipientAddress: "bc1qexample",
      ticker: "WORK",
      tokenId: "d".repeat(64),
    },
  ];
  const lifecycle = {
    blockTime: "2026-08-05T12:00:00.000Z",
    observedAt: "2026-08-05T12:01:00.000Z",
    status: "confirmed",
  };

  const unproven = mailMessageWithTxLifecycle(
    { attachedCredits, confirmed: false, status: "pending", txid },
    lifecycle,
  );
  assert.equal(unproven.status, "confirmed");
  assert.equal(unproven.attachedCredits, undefined);

  const canonical = withCanonicalMailAttachedCredits({
    attachedCredits,
    confirmed: true,
    status: "confirmed",
    txid,
  });
  const proven = mailMessageWithTxLifecycle(canonical, lifecycle);
  assert.deepEqual(proven.attachedCredits, attachedCredits);
  assert.equal(Object.getOwnPropertySymbols(proven).length, 0);

  const dropped = mailMessageWithTxLifecycle(canonical, {
    observedAt: "2026-08-05T12:02:00.000Z",
    status: "dropped",
  });
  assert.equal(dropped.attachedCredits, undefined);
});

test("full-node evidence wins over stale indexed transaction lifecycle", () => {
  const txid = "1".repeat(64);
  const observedAt = "2026-08-05T12:00:00.000Z";
  const coreAbsence = {
    absenceProven: true,
    observedAt,
    sources: ["bitcoin-core:getrawtransaction"],
    status: "dropped",
  };
  const neverSeen = reconcileLivenetTxLifecycle({
    coreStatus: coreAbsence,
    txid,
  });
  assert.equal(neverSeen.status, "unknown");
  assert.equal(neverSeen.previouslySeen, false);

  const awaitingDrop = reconcileLivenetTxLifecycle({
    coreStatus: coreAbsence,
    indexedStatus: { status: "pending" },
    txid,
  });
  assert.equal(awaitingDrop.status, "unknown");
  assert.match(awaitingDrop.reason, /awaiting-durable-drop-threshold/u);

  const dropped = reconcileLivenetTxLifecycle({
    coreStatus: coreAbsence,
    indexedStatus: {
      absenceCount: 2,
      droppedAt: observedAt,
      status: "dropped",
    },
    txid,
  });
  assert.equal(dropped.status, "dropped");
  assert.equal(dropped.absenceCount, 2);

  const replacementTxid = "2".repeat(64);
  const replaced = reconcileLivenetTxLifecycle({
    coreStatus: coreAbsence,
    indexedStatus: { replacementTxid, status: "replaced" },
    txid,
  });
  assert.equal(replaced.status, "replaced");
  assert.equal(replaced.replacementTxid, replacementTxid);

  const replacementAwaitingRevalidation = reconcileLivenetTxLifecycle({
    coreStatus: {
      ...coreAbsence,
      replacementCheck: {
        model: "proof-of-work-tx-replacement-check-v1",
        reason: "no-current-input-spender",
        status: "complete",
      },
    },
    indexedStatus: { replacementTxid, status: "replaced" },
    txid,
  });
  assert.equal(replacementAwaitingRevalidation.status, "unknown");
  assert.equal(
    replacementAwaitingRevalidation.reason,
    "previous-replacement-awaiting-durable-revalidation",
  );

  const staleConfirmation = reconcileLivenetTxLifecycle({
    coreStatus: coreAbsence,
    indexedStatus: {
      blockHash: "a".repeat(64),
      blockHeight: 100,
      status: "confirmed",
    },
    txid,
  });
  assert.equal(staleConfirmation.status, "unknown");
  assert.equal(staleConfirmation.lifecycleTransition, "confirmed-to-unknown");

  const revived = reconcileLivenetTxLifecycle({
    coreStatus: {
      mempoolFirstSeenAt: observedAt,
      observedAt,
      status: "pending",
    },
    indexedStatus: { status: "dropped" },
    txid,
  });
  assert.equal(revived.status, "pending");
  assert.equal(revived.previousStatus, "dropped");

  const revivedMail = mailMessageWithTxLifecycle(
    {
      confirmed: false,
      droppedAt: "2026-08-05T11:00:00.000Z",
      failedAt: "2026-08-05T11:00:00.000Z",
      reason: "stale-terminal-reason",
      replacementTxid,
      status: "dropped",
      txid,
    },
    revived,
  );
  assert.equal(revivedMail.status, "pending");
  assert.equal(revivedMail.confirmed, false);
  assert.equal(revivedMail.droppedAt, undefined);
  assert.equal(revivedMail.failedAt, undefined);
  assert.equal(revivedMail.replacementTxid, undefined);
  assert.equal(revivedMail.reason, undefined);
});

test("replacement evidence is exact, bounded, and never guesses ambiguity", () => {
  const originalTxid = "1".repeat(64);
  const replacementTxid = "2".repeat(64);
  const otherReplacementTxid = "3".repeat(64);
  const inputEvidence = lifecycleInputOutpointsFromTransaction({
    vin: [
      { txid: "a".repeat(64), vout: 0 },
      { txid: "b".repeat(64), vout: 1 },
    ],
  });
  assert.equal(inputEvidence.complete, true);
  assert.equal(inputEvidence.inputCount, 2);

  const exact = replacementDispositionFromSpenderEvidence({
    inputEvidence,
    originalTxid,
    spendingPrevouts: [
      { spendingtxid: replacementTxid, txid: "a".repeat(64), vout: 0 },
      { txid: "b".repeat(64), vout: 1 },
    ],
  });
  assert.equal(exact.kind, "replacement");
  assert.equal(exact.replacementTxid, replacementTxid);

  const ambiguous = replacementDispositionFromSpenderEvidence({
    inputEvidence,
    originalTxid,
    spendingPrevouts: [
      { spendingtxid: replacementTxid, txid: "a".repeat(64), vout: 0 },
      {
        spendingtxid: otherReplacementTxid,
        txid: "b".repeat(64),
        vout: 1,
      },
    ],
  });
  assert.equal(ambiguous.kind, "unknown");
  assert.equal(ambiguous.reason, "ambiguous-current-input-spenders");

  const malformed = replacementDispositionFromSpenderEvidence({
    inputEvidence,
    originalTxid,
    spendingPrevouts: [
      { spendingtxid: replacementTxid, txid: "a".repeat(64), vout: 0 },
    ],
  });
  assert.equal(malformed.kind, "unknown");

  const nonProtocolConfirmedSpend =
    replacementDispositionFromTxOutEvidence({
      inputEvidence,
      txOutEvidence: [
        { txid: "a".repeat(64), unspent: true, vout: 0 },
        { txid: "b".repeat(64), unspent: false, vout: 1 },
      ],
    });
  assert.equal(nonProtocolConfirmedSpend.kind, "unknown");
  assert.equal(
    nonProtocolConfirmedSpend.reason,
    "full-node-input-spent-without-exact-replacement-txid",
  );

  const noSpend = replacementDispositionFromTxOutEvidence({
    inputEvidence,
    txOutEvidence: [
      { txid: "a".repeat(64), unspent: true, vout: 0 },
      { txid: "b".repeat(64), unspent: true, vout: 1 },
    ],
  });
  assert.equal(noSpend.kind, "none");

  const oversized = lifecycleInputOutpointsFromTransaction({
    vin: Array.from({ length: 33 }, (_, index) => ({
      txid: index.toString(16).padStart(64, "0"),
      vout: index,
    })),
  });
  assert.equal(oversized.complete, false);
  assert.equal(oversized.outpoints.length, 32);
});

test("the API replacement envelope persists idempotently through the worker", async () => {
  const originalTxid = "4".repeat(64);
  const replacementTxid = "5".repeat(64);
  const observedAt = new Date().toISOString();
  const inputEvidence = lifecycleInputOutpointsFromTransaction({
    vin: [{ txid: "c".repeat(64), vout: 2 }],
  });
  const envelope = verifiedReplacementLifecycle({
    candidateSource: "bitcoin-core-mempool-spender",
    coreAbsence: {
      absenceProven: true,
      confirmed: false,
      contract: "proof-of-work-tx-status-v2",
      network: "livenet",
      observedAt,
      reason:
        "absent-from-synced-unpruned-mainnet-bitcoin-core-txindex-and-mempool",
      sources: [
        "bitcoin-core:getrawtransaction",
        "bitcoin-core:getmempoolentry",
        "bitcoin-core:getblockchaininfo",
        "bitcoin-core:getindexinfo:txindex",
      ],
      status: "dropped",
      txid: originalTxid,
    },
    inputEvidence,
    originalTxid,
    replacementStatus: {
      sources: [
        "bitcoin-core:getrawtransaction",
        "bitcoin-core:getmempoolentry",
      ],
      status: "pending",
    },
    replacementTxid,
  });
  assert.equal(
    authoritativeReplacedStatusEvidence(envelope, originalTxid),
    true,
  );

  const statements = [];
  const client = {
    async query(sql, params) {
      statements.push({ params, sql: String(sql) });
      if (/SELECT status, raw_tx, replaced_by_txid/iu.test(sql)) {
        return { rows: [{ raw_tx: {}, status: "pending" }] };
      }
      return { rowCount: 1, rows: [] };
    },
  };
  const outcome = await updateTransactionStatus(
    client,
    originalTxid,
    "replaced",
    envelope,
  );
  assert.deepEqual(outcome, {
    applied: true,
    reason: "full-node-verified-replacement",
  });
  const transactionWrite = statements.find(({ sql }) =>
    /SET\s+status = 'dropped'/iu.test(sql),
  );
  assert.equal(transactionWrite.params[5], replacementTxid);
  const storedObservation = JSON.parse(transactionWrite.params[2]);
  assert.equal(storedObservation.status, "replaced");
  assert.equal(storedObservation.replacementTxid, replacementTxid);
  const eventWrite = statements.find(({ sql }) =>
    /UPDATE proof_indexer\.events/iu.test(sql),
  );
  assert.match(eventWrite.sql, /'status', 'dropped'/u);
  assert.match(eventWrite.sql, /'lifecycleStatus', \$3::text/u);
  assert.equal(eventWrite.params[3], replacementTxid);

  const idempotentStatements = [];
  const idempotent = await updateTransactionStatus(
    {
      async query(sql, params) {
        idempotentStatements.push({ params, sql: String(sql) });
        if (/FOR UPDATE/u.test(sql)) {
          return {
            rows: [
              {
                raw_tx: { statusObservation: storedObservation },
                replaced_by_txid: replacementTxid,
                status: "dropped",
              },
            ],
          };
        }
        return { rowCount: 1, rows: [] };
      },
    },
    originalTxid,
    "replaced",
    envelope,
  );
  assert.equal(idempotent.applied, false);
  assert.equal(idempotent.reason, "replacement-already-recorded");
  assert.equal(idempotentStatements.length, 2);
  assert.match(idempotentStatements[1].sql, /updated_at = now\(\)/u);
  assert.match(idempotentStatements[1].sql, /replaced_by_txid = \$4/u);

  const confirmedEnvelope = verifiedReplacementLifecycle({
    candidateSource: "canonical-confirmed-input-index-and-bitcoin-core",
    coreAbsence: {
      absenceProven: true,
      confirmed: false,
      contract: "proof-of-work-tx-status-v2",
      network: "livenet",
      observedAt,
      reason:
        "absent-from-synced-unpruned-mainnet-bitcoin-core-txindex-and-mempool",
      sources: [
        "bitcoin-core:getrawtransaction",
        "bitcoin-core:getmempoolentry",
        "bitcoin-core:getblockchaininfo",
        "bitcoin-core:getindexinfo:txindex",
        "proof-indexer-canonical-confirmed-tx-input",
      ],
      status: "dropped",
      txid: originalTxid,
    },
    inputEvidence,
    originalTxid,
    replacementStatus: {
      sources: [
        "bitcoin-core:getrawtransaction",
        "bitcoin-core:getblockheader",
        "bitcoin-core:getblock",
        "bitcoin-core:getblockhash",
      ],
      status: "confirmed",
    },
    replacementTxid,
  });
  const transitionStatements = [];
  const transition = await updateTransactionStatus(
    {
      async query(sql, params) {
        transitionStatements.push({ params, sql: String(sql) });
        if (/FOR UPDATE/u.test(sql)) {
          return {
            rows: [
              {
                raw_tx: { statusObservation: storedObservation },
                replaced_by_txid: replacementTxid,
                status: "dropped",
              },
            ],
          };
        }
        return { rowCount: 1, rows: [] };
      },
    },
    originalTxid,
    "replaced",
    confirmedEnvelope,
  );
  assert.deepEqual(transition, {
    applied: true,
    reason: "replacement-evidence-advanced",
  });
  const advancedObservation = JSON.parse(transitionStatements[1].params[2]);
  assert.equal(advancedObservation.replacementStatus, "confirmed");
  assert.equal(
    advancedObservation.replacementEvidence.candidateSource,
    "canonical-confirmed-input-index-and-bitcoin-core",
  );
});

test("Core absence needs a repeated five-minute observation and preserves replacement-check evidence", async () => {
  const txid = "6".repeat(64);
  const firstObservedAt = new Date(Date.now() - 6 * 60_000).toISOString();
  const replacementCheck = {
    model: "proof-of-work-tx-replacement-check-v1",
    reason: "original-input-outpoint-evidence-incomplete",
    status: "inconclusive",
  };
  const envelope = (observedAt) => ({
    absenceProven: true,
    confirmed: false,
    contract: "proof-of-work-tx-status-v2",
    network: "livenet",
    observedAt,
    reason:
      "absent-from-synced-unpruned-mainnet-bitcoin-core-txindex-and-mempool",
    replacementCheck,
    sources: [
      "bitcoin-core:getrawtransaction",
      "bitcoin-core:getmempoolentry",
      "bitcoin-core:getblockchaininfo",
      "bitcoin-core:getindexinfo:txindex",
    ],
    status: "dropped",
    txid,
  });
  const firstStatements = [];
  const first = await updateTransactionStatus(
    {
      async query(sql, params) {
        firstStatements.push({ params, sql: String(sql) });
        if (/SELECT status, raw_tx, replaced_by_txid/iu.test(sql)) {
          return { rows: [{ raw_tx: {}, status: "pending" }] };
        }
        return { rowCount: 1, rows: [] };
      },
    },
    txid,
    "dropped",
    envelope(firstObservedAt),
  );
  assert.deepEqual(first, {
    applied: false,
    reason: "repeat-absence-required",
  });
  assert.equal(firstStatements.length, 2);
  const firstObservation = JSON.parse(firstStatements[1].params[2]);
  assert.equal(firstObservation.absenceCount, 1);
  assert.equal(firstObservation.awaitingDropConfirmation, true);
  assert.deepEqual(firstObservation.replacementCheck, replacementCheck);

  const secondStatements = [];
  const second = await updateTransactionStatus(
    {
      async query(sql, params) {
        secondStatements.push({ params, sql: String(sql) });
        if (/SELECT status, raw_tx, replaced_by_txid/iu.test(sql)) {
          return {
            rows: [
              {
                raw_tx: { statusObservation: firstObservation },
                status: "pending",
              },
            ],
          };
        }
        return { rowCount: 1, rows: [] };
      },
    },
    txid,
    "dropped",
    envelope(new Date().toISOString()),
  );
  assert.deepEqual(second, {
    applied: true,
    reason: "repeated-core-absence",
  });
  const transactionWrite = secondStatements.find(({ sql }) =>
    /SET\s+status = 'dropped'/iu.test(sql),
  );
  assert.match(
    transactionWrite.sql,
    /WHEN status = 'dropped' AND dropped_at IS NOT NULL[\s\S]*THEN dropped_at/u,
  );
  const finalObservation = JSON.parse(transactionWrite.params[2]);
  assert.equal(finalObservation.absenceCount, 2);
  assert.equal(finalObservation.awaitingDropConfirmation, false);
  assert.deepEqual(finalObservation.replacementCheck, replacementCheck);
  const eventWrite = secondStatements.find(({ sql }) =>
    /UPDATE proof_indexer\.events/iu.test(sql),
  );
  assert.deepEqual(JSON.parse(eventWrite.params[4]), replacementCheck);
});

test("a durable replacement revival waits for authoritative mempool projection", async () => {
  const txid = "7".repeat(64);
  const replacementTxid = "8".repeat(64);
  const mempoolFirstSeenAt = new Date().toISOString();
  const statements = [];
  const client = {
    async query(sql, params) {
      statements.push({ params, sql: String(sql) });
      if (/SELECT status, raw_tx, replaced_by_txid/iu.test(sql)) {
        return {
          rows: [
            {
              raw_tx: {
                statusObservation: {
                  replacementTxid,
                  status: "replaced",
                },
              },
              replaced_by_txid: replacementTxid,
              status: "dropped",
            },
          ],
        };
      }
      return { rowCount: 1, rows: [] };
    },
  };
  const outcome = await updateTransactionStatus(client, txid, "pending", {
    confirmed: false,
    contract: "proof-of-work-tx-status-v2",
    mempoolFirstSeenAt,
    mempoolSeen: true,
    network: "livenet",
    observedAt: mempoolFirstSeenAt,
    sources: [
      "bitcoin-core:getrawtransaction",
      "bitcoin-core:getmempoolentry",
    ],
    status: "pending",
    txid,
  });
  assert.deepEqual(outcome, {
    applied: false,
    reason: "mempool-backfill-revival-required",
  });
  const transactionWrite = statements.find(({ sql }) =>
    /UPDATE proof_indexer\.transactions[\s\S]*statusObservation/u.test(sql),
  );
  assert.deepEqual(transactionWrite.params.slice(0, 2), ["livenet", txid]);
  assert.equal(JSON.parse(transactionWrite.params[2]).status, "pending");
  assert.match(transactionWrite.sql, /status = 'dropped'/u);
  assert.equal(statements.length, 2);
});

test("Q16-era terminal revival stays owned by the staged pending witness", async () => {
  const txid = "9".repeat(64);
  const observedAt = new Date().toISOString();
  const statements = [];
  const outcome = await updateTransactionStatus(
    {
      async query(sql, params) {
        statements.push({ params, sql: String(sql) });
        if (/SELECT status, raw_tx, replaced_by_txid/iu.test(sql)) {
          return {
            rows: [
              {
                raw_tx: {},
                replaced_by_txid: "a".repeat(64),
                status: "dropped",
              },
            ],
          };
        }
        return { rowCount: 1, rows: [] };
      },
    },
    txid,
    "pending",
    {
      confirmed: false,
      contract: "proof-of-work-tx-status-v2",
      mempoolFirstSeenAt: observedAt,
      mempoolSeen: true,
      network: "livenet",
      observedAt,
      sources: [
        "bitcoin-core:getrawtransaction",
        "bitcoin-core:getmempoolentry",
      ],
      status: "pending",
      txid,
    },
    { q16Active: true },
  );
  assert.deepEqual(outcome, {
    applied: false,
    reason: "q16-staged-revival-required",
  });
  assert.equal(statements.length, 3);
  assert.match(statements[0].sql, /LOCK TABLE proof_indexer\.transactions/u);
  assert.match(statements[1].sql, /FOR UPDATE/u);
  assert.match(statements[2].sql, /status = 'dropped'/u);
});

test("Phase A source integration keeps staged reads off and liveness cheap", async () => {
  const [api, backfill, reader, worker] = await Promise.all([
    readFile(new URL("./proof-api.mjs", import.meta.url), "utf8"),
    readFile(
      new URL("../scripts/backfill-proof-indexer.mjs", import.meta.url),
      "utf8",
    ),
    readFile(new URL("./db/proof-index-reader.mjs", import.meta.url), "utf8"),
    readFile(
      new URL("../scripts/run-proof-indexer-worker.mjs", import.meta.url),
      "utf8",
    ),
  ]);
  assert.match(
    api,
    /POW_RUSH_PUBLIC_READS_ENABLED \?\? ""[\s\S]*if \(url\.pathname === "\/api\/v1\/rush" && !PUBLIC_RUSH_READS_ENABLED\)/u,
  );
  assert.ok((api.match(/code: "RUSH_PUBLIC_DISABLED"/gu) ?? []).length >= 2);
  assert.doesNotMatch(api, /function publicPayloadWithoutDisabledRush/u);
  assert.match(
    api,
    /if \(livenessRead\) \{[\s\S]*jsonResponse\(response, 200, processLivenessPayload\(\), "no-store"\);[\s\S]*return;[\s\S]*const payload = await healthPayload/u,
  );
  assert.doesNotMatch(api, /await healthPayload\(\{ force: true \}\)/u);
  assert.match(
    api,
    /healthPayloadCache[\s\S]*!healthPayloadCache\.settled[\s\S]*options\.force !== true/u,
  );
  assert.match(
    api,
    /const derivedOffset = page \* limit;[\s\S]*derivedOffset > HISTORY_MAX_OFFSET/u,
  );
  assert.match(
    api,
    /const EXACT_TIP_TOKEN_CACHE = new BoundedResponseCache\([\s\S]*maxBytes: EXACT_TIP_TOKEN_CACHE_MAX_BYTES[\s\S]*maxEntries: EXACT_TIP_TOKEN_CACHE_MAX_ENTRIES/u,
  );
  assert.match(
    api,
    /const TRANSACTION_CACHE = new BoundedTtlValueCache\([\s\S]*maxBytes: MAX_TRANSACTION_CACHE_BYTES[\s\S]*maxEntries: MAX_TRANSACTION_CACHE_SIZE[\s\S]*ttlMs: TRANSACTION_CACHE_TTL_MS/u,
  );
  assert.doesNotMatch(
    api,
    /TRANSACTION_CACHE\.size > MAX_TRANSACTION_CACHE_SIZE/u,
  );
  assert.match(
    api,
    /function cachePayloadAndJson\([\s\S]*RESPONSE_CACHE\.setManyWithOutcome\([\s\S]*payloadKey[\s\S]*jsonKey/u,
  );
  assert.match(
    api,
    /function persistAcceptedJsonCache\([\s\S]*cached\?\.outcome\?\.stored === true[\s\S]*shouldPersistJsonCache\(cacheKey, payload\)[\s\S]*writePersistedJsonCache/u,
  );
  assert.match(
    api,
    /function cacheTokenPayload\([\s\S]*if \(!cached\.outcome\.stored\) \{[\s\S]*return false;[\s\S]*EXACT_TIP_TOKEN_CACHE\.setWithOutcome/u,
  );
  assert.match(
    api,
    /const PERSISTED_CACHE_WRITE_COORDINATOR = new LatestValueWriteCoordinator\(\)[\s\S]*function writePersistedJsonCache\(jsonKey, body\)[\s\S]*PERSISTED_CACHE_WRITE_COORDINATOR\.run\([\s\S]*writePersistedJsonCacheFile/u,
  );
  assert.match(
    backfill,
    /classification: boundedDeferral[\s\S]*"bounded-incomplete"[\s\S]*if \(boundedDeferral\) \{[\s\S]*continue;/u,
  );
  assert.match(
    backfill,
    /async function readJson\([\s\S]*await fetch\(url, \{[\s\S]*redirect: "error"/u,
  );
  assert.match(
    worker,
    /phase: "worker-pending-readiness-degraded"[\s\S]*writesFailClosed: true[\s\S]*state: "pending-degraded"/u,
  );
  assert.match(
    worker,
    /pendingDegraded: true[\s\S]*workerPendingDegradedOnceError\(cycle, ONCE\)[\s\S]*WORKER_PENDING_DEGRADED_ONCE_CODE/u,
  );
  assert.match(
    worker,
    /endpoint\(`\/api\/v1\/tx\/\$\{txid\}\/status`, \{ observation: "1" \}\)/u,
  );
  assert.match(
    api,
    /path\.startsWith\("\/api\/v1\/tx\/"\)/u,
  );
  assert.match(
    api,
    /function coalescedBitcoinCoreTxStatusPayload[\s\S]*CORE_TX_STATUS_ADMISSION\.acquire\(\)[\s\S]*bitcoinCoreTxStatusPayload/u,
  );
  assert.match(
    api,
    /async function bitcoinCoreTxStatusPayload[\s\S]*const coreAuthority = exactCoreNodeAuthority\([\s\S]*!coreAuthority/u,
  );
  assert.match(
    api,
    /path === "\/api\/v1\/prices\/btc-usd"[\s\S]*freshRead \? "fresh"/u,
  );
  assert.match(
    api,
    /"btc-usd-price"[\s\S]*btcUsdPricePayload/u,
  );
  assert.match(
    api,
    /"block-txids"[\s\S]*fetchCoreBlockTxidIndex/u,
  );
  assert.match(
    api,
    /index \+= concurrency[\s\S]*slice\(index, index \+ concurrency\)[\s\S]*txStatusPayload\(txid, network\)/u,
  );
  assert.match(
    backfill,
    /lifecycleInputOutpointsFromTransaction\(hydrated\)/u,
  );
  assert.match(
    backfill,
    /persistCanonicalRawTransaction[\s\S]*dropped_at = NULL[\s\S]*dropped_reason = NULL[\s\S]*replaced_by_txid = NULL/u,
  );
  assert.match(
    backfill,
    /EXCLUDED\.status IN \('pending', 'confirmed'\)[\s\S]*proof_indexer\.events\.payload[\s\S]*- 'lifecycleStatus'[\s\S]*- 'replacementCheck'/u,
  );
  assert.match(
    backfill,
    /INSERT INTO proof_indexer\.credit_listings[\s\S]*EXCLUDED\.status <> 'dropped'[\s\S]*- 'lifecycleStatus'[\s\S]*- 'replacementCheck'/u,
  );
  assert.match(
    worker,
    /replaced_by_txid = \$6[\s\S]*'lifecycleStatus', \$3::text/u,
  );
  assert.match(
    worker,
    /status === "unknown"[\s\S]*summary\.unknown \+= 1[\s\S]*continue;/u,
  );
  assert.match(
    worker,
    /replaced_by_txid IS NOT NULL[\s\S]*statusObservation,replacementCheck,status[\s\S]*'inconclusive'/u,
  );
  assert.match(
    worker,
    /statusObservation,replacementCheck,status[\s\S]*'inconclusive'[\s\S]*lifecycleInputOutpoints,complete/u,
  );
  assert.match(
    worker,
    /statusObservation,awaitingDropConfirmation[\s\S]*PENDING_DROP_CONFIRMATION_MS \+ PENDING_MIN_AGE_MS/u,
  );
  assert.doesNotMatch(api, /pendingStatusUnknown === 0/u);
  assert.match(
    reader,
    /candidate_input\.prev_txid = requested\.txid/u,
  );
  assert.match(
    reader,
    /lifecycleStatus: status/u,
  );
  assert.match(
    reader,
    /durableLifecycleStatus[\s\S]*status: durableLifecycleStatus/u,
  );
  assert.ok(
    (reader.match(/message: withCanonicalMailAttachedCredits\(\{/gu) ?? [])
      .length >= 2,
  );
  assert.match(
    reader,
    /revivedTerminalLifecyclePayload[\s\S]*lifecycleStatus: revivedTerminalLifecyclePayload[\s\S]*replacementCheck: revivedTerminalLifecyclePayload/u,
  );
  assert.match(
    reader,
    /payloadHasReplacementMetadata[\s\S]*hasOwnProperty\.call\(payload, key\)[\s\S]*revivedTerminalLifecyclePayload/u,
  );
  assert.doesNotMatch(
    api,
    /return reconcileLivenetTxLifecycle\(\{[\s\S]{0,400}indexedStatus,[\s\S]{0,200}\}\);/u,
  );
  assert.match(
    api,
    /function transformCanonicalSnapshotPayload\([\s\S]*transformFullCanonicalSnapshot\([\s\S]*markAuthenticatedFullCanonicalSnapshot\(/u,
  );
  assert.match(
    api,
    /async function withWorkMarketplaceV4Metadata\([\s\S]*return transformCanonicalSnapshotPayload\([\s\S]*"token-state"/u,
  );
  assert.match(
    api,
    /async function spendableTokenListingsPayload\([\s\S]*return transformCanonicalSnapshotPayload\([\s\S]*"token-state"/u,
  );
  assert.match(
    api,
    /function retainedExactTipTokenPayloadForRead\([\s\S]*transformCanonicalSnapshotPayload\([\s\S]*preserveCanonicalClaim: false/u,
  );
  assert.match(
    api,
    /function ledgerWithHistoricalWorkFloorChart\([\s\S]*transformCanonicalSnapshotPayload\([\s\S]*"canonical-ledger"/u,
  );
  assert.match(
    api,
    /if \(url\.pathname === "\/api\/v1\/token"\)[\s\S]*coherentCanonicalSnapshotAtBoundary\([\s\S]*"token-state"/u,
  );
  assert.match(
    api,
    /function cachedJsonPayload\(jsonKey, canonicalSurface = ""\)[\s\S]*fullCanonicalSnapshotClaimed\(payload\)[\s\S]*coherentFullCanonicalSnapshot\(payload, canonicalSurface\)[\s\S]*RESPONSE_CACHE\.delete\(jsonKey\)/u,
  );
  assert.match(
    api,
    /async function canonicalLedgerPayload\([\s\S]*restoreCacheAfterRefusedSettlement\([\s\S]*payloadKey[\s\S]*placeholder[\s\S]*lastGood/u,
  );
  assert.match(
    api,
    /persistedPayloadForCache\([\s\S]*"registry-state"[\s\S]*persistedPayloadForCache\([\s\S]*"token-state"[\s\S]*persistedPayloadForCache\([\s\S]*"canonical-ledger"/u,
  );
});
