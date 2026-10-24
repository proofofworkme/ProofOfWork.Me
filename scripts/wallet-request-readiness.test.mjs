import assert from "node:assert/strict";
import { AsyncLocalStorage } from "node:async_hooks";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";

// Run the actual pure reader functions. No service import or live database.
const readerText = readFileSync("server/db/proof-index-reader.mjs", "utf8");
const reader = ts.createSourceFile("reader.mjs", readerText, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
function source(name, required = true) {
  const found = reader.statements.filter((n) => ts.isFunctionDeclaration(n) && n.name?.text === name);
  if (!required && !found.length) return "";
  assert.equal(found.length, 1, name);
  return found[0].getText(reader).replace(/^export\s+/u, "");
}
const names = [
  "proofIndexWithWalletRequestReadiness", "walletRequestReadinessMap",
  "walletRequestReadinessCommittedSnapshot", "promoteWalletReadSnapshotReadiness",
  "exactCheckpointSingleFlight", "deepFreezeReadinessSnapshot",
  "reusableWorkPrecisionV2MigrationReadiness", "rememberWorkPrecisionV2MigrationReadiness",
  "workPrecisionV2MigrationReadinessResultIsReusablePositive",
  "workPrecisionV2MigrationReadinessWithCompactCheckpoint",
  "workPrecisionV2MigrationFullAuditWithBound",
];
const A = "a".repeat(64), B = "b".repeat(64), H = "c".repeat(64);
const cacheName = "workPrecisionV2MigrationReadinessReadyCache";
const now = Date.now();
const ready = (key = A, overrides = {}) => ({
  active: true, canonical: true, confirmed: true, evidenceComplete: true,
  exactTipReady: true, parityReady: true, pendingReady: true, replayReady: true,
  ready: true, tipHeight: 972950, tipHash: H, snapshotHash: H,
  pendingValidThrough: new Date(now + 60_000).toISOString(),
  auditedReadinessFingerprintKey: key, ...overrides,
});
function harness(extra = {}) {
  const context = vm.createContext({
    walletRequestReadiness: new AsyncLocalStorage(),
    walletRequestReadinessSnapshots: new WeakMap(),
    workPrecisionV2MigrationFullAuditTail: Promise.resolve(),
    measurePrivatePhase: (_name, read) => read(),
    normalizedLowerText: (s) => String(s ?? "").trim().toLowerCase(),
    WORK_PRECISION_V2_READINESS_CACHE_MAX_ENTRIES: 4,
    WORK_PRECISION_V2_READINESS_CACHE_TTL_MS: 30_000,
    ...extra,
  });
  return { context, ...new vm.Script(`${names.map((n) => source(n)).join("\n")}\n({${names.join(",")}})`).runInContext(context) };
}
function checks(h) {
  const shared = new Map();
  let epoch = A, postmaster = "start-A", full = 0, compact = 0;
  const options = (cache, overrides = {}) => ({
    inFlight: new Map(), readyCache: cache, bootstrapReadyCache: new Map(),
    requestKey: "livenet:pinned-declaration", now: () => now,
    loadCompact: async () => { compact++; return { key: epoch, positiveEligible: true, postmasterStartedAt: postmaster }; },
    loadCatalogAttestation: async () => true,
    loadFull: async () => { full++; return ready(epoch); }, ...overrides,
  });
  return {
    shared, options,
    async snapshot(overrides = {}) {
      const scope = { maps: new Map([[cacheName, new Map()]]) };
      return h.walletRequestReadinessCommittedSnapshot(async (register) => {
        register(scope);
        return h.workPrecisionV2MigrationReadinessWithCompactCheckpoint(options(scope.maps.get(cacheName), overrides));
      });
    },
    read: (overrides = {}) => h.workPrecisionV2MigrationReadinessWithCompactCheckpoint(
      options(h.walletRequestReadinessMap(cacheName, shared), overrides)),
    counts: () => ({ full, compact }),
    publish: () => { epoch = B; }, restart: () => { epoch = B; postmaster = "start-B"; },
  };
}

test("one committed audit serves repeated same-request reads, with a fresh compact fence each time", async () => {
  const h = harness(), c = checks(h);
  await h.proofIndexWithWalletRequestReadiness(async () => {
    const audited = await c.snapshot();
    assert.equal(await c.read(), audited);
    assert.equal(await c.read(), audited);
    assert.deepEqual(c.counts(), { full: 1, compact: 4 });
    assert.equal(c.shared.size, 0);
  });
  assert.equal(c.shared.size, 0);
});

test("epoch, database restart and force each require a new full audit", async () => {
  for (const change of ["publish", "restart", "force"]) {
    const h = harness(), c = checks(h);
    await h.proofIndexWithWalletRequestReadiness(async () => {
      await c.snapshot();
      if (change !== "force") c[change]();
      await c.read(change === "force" ? { force: true } : {});
      assert.equal(c.counts().full, 2, change);
    });
  }
});

test("expired, wrong-tip, unbound, negative and forged snapshot entries cannot be promoted", async () => {
  const cases = [
    { pendingValidThrough: new Date(now - 1).toISOString() },
    { snapshotHash: B }, { auditedReadinessFingerprintKey: B },
    { auditedReadinessFingerprintKey: null }, { ready: false }, { pendingReady: false },
    { evidenceComplete: false }, { tipHash: "invalid" },
  ];
  for (const overrides of cases) {
    const h = harness();
    await h.proofIndexWithWalletRequestReadiness(async () => {
      const entries = new Map();
      h.rememberWorkPrecisionV2MigrationReadiness(entries, A, ready(A, overrides), now + 20_000);
      await h.walletRequestReadinessCommittedSnapshot(async (register) => register({ maps: new Map([[cacheName, entries]]) }));
      assert.equal(h.walletRequestReadinessMap(cacheName, new Map()).size, 0);
    });
  }
  const h = harness();
  await h.proofIndexWithWalletRequestReadiness(async () => {
    const entries = new Map();
    h.rememberWorkPrecisionV2MigrationReadiness(entries, A, ready(), now + 20_000);
    h.promoteWalletReadSnapshotReadiness({ maps: new Map([[cacheName, entries]]) });
    assert.equal(h.walletRequestReadinessMap(cacheName, new Map()).size, 0, "unregistered payload is not a capability");
  });
});

test("promotion waits for COMMIT and does not export a rejected or aborted snapshot", async () => {
  for (const fail of [false, true]) {
    const h = harness();
    await h.proofIndexWithWalletRequestReadiness(async () => {
      const entries = new Map();
      h.rememberWorkPrecisionV2MigrationReadiness(entries, A, ready(), now + 20_000);
      let release, entered;
      const admitted = new Promise((r) => { entered = r; });
      const settled = new Promise((r) => { release = r; });
      const task = h.walletRequestReadinessCommittedSnapshot(async (register) => {
        register({ maps: new Map([[cacheName, entries]]) }); entered();
        await settled;
        if (fail) throw Error("COMMIT or snapshot failed");
        return "committed";
      });
      await admitted;
      assert.equal(h.walletRequestReadinessMap(cacheName, new Map()).size, 0);
      release();
      if (fail) await assert.rejects(task); else assert.equal(await task, "committed");
      assert.equal(h.walletRequestReadinessMap(cacheName, new Map()).size, fail ? 0 : 1);
    });
  }
});

test("separate callers and shared payload promises do not share request maps or admission promises", async () => {
  const h = harness(), c = checks(h), sharedPromise = Promise.resolve({ ready: true });
  let firstMap;
  await h.proofIndexWithWalletRequestReadiness(async () => {
    await c.snapshot(); firstMap = h.walletRequestReadinessMap(cacheName, c.shared);
    await h.proofIndexWithWalletRequestReadiness(async () => {
      await sharedPromise;
      assert.notEqual(h.walletRequestReadinessMap(cacheName, c.shared), firstMap);
      assert.equal(h.walletRequestReadinessMap(cacheName, c.shared).size, 0);
      const pending = new Map([["other-request", sharedPromise]]);
      assert.equal(h.walletRequestReadinessMap("testInFlight", pending).size, 0);
      await c.read();
    });
    assert.equal(firstMap.size, 1);
  });
  assert.equal(firstMap.size, 0);
  assert.equal(c.counts().full, 2);
});

test("concurrent same-epoch callers share only a full audit and keep their own compact fences", async () => {
  const h = harness(), c = checks(h), fullAuditInFlight = new Map();
  let release, entered, attempts = 0, full = 0;
  const bothAdmitted = new Promise((r) => { entered = r; });
  const auditMayFinish = new Promise((r) => { release = r; });
  const loadFull = async () => {
    if (++attempts === 2) entered();
    return h.workPrecisionV2MigrationFullAuditWithBound({
      inFlight: fullAuditInFlight, requestKey: `pins:${A}`,
      load: async () => { full++; await auditMayFinish; return ready(); },
    });
  };
  const a = h.proofIndexWithWalletRequestReadiness(() => c.read({ loadFull }));
  const b = h.proofIndexWithWalletRequestReadiness(() => c.read({ loadFull }));
  await bothAdmitted; release();
  const [first, second] = await Promise.all([a, b]);
  assert.equal(full, 1); assert.equal(c.counts().compact, 4);
  assert.notEqual(first, second); assert.equal(Object.isFrozen(first), true);
  assert.equal(Object.isFrozen(second), true); assert.equal(fullAuditInFlight.size, 0);
  assert.equal(c.shared.size, 0);
});

test("response completion clears maps and detached continuations cannot promote old proof", async () => {
  const h = harness(), c = checks(h);
  let release, continuation, privateMap;
  const later = new Promise((r) => { release = r; });
  await h.proofIndexWithWalletRequestReadiness(async () => {
    await c.snapshot(); privateMap = h.walletRequestReadinessMap(cacheName, c.shared);
    continuation = (async () => {
      await later;
      await c.snapshot();
      assert.equal(h.walletRequestReadinessMap(cacheName, c.shared), c.shared);
    })();
  });
  assert.equal(privateMap.size, 0); release(); await continuation;
  assert.equal(c.shared.size, 0);
});

test("promotion preserves the original expiry and only carries bounded positive readiness", async () => {
  const h = harness();
  await h.proofIndexWithWalletRequestReadiness(async () => {
    const entries = new Map();
    for (let i = 1; i <= 8; i++) {
      const key = String(i).repeat(64);
      h.rememberWorkPrecisionV2MigrationReadiness(entries, key, ready(key), now + 10_000, 16);
    }
    const snapshot = { maps: new Map([[cacheName, entries], ["testInFlight", new Map([[A, Promise.resolve()]])]]) };
    await h.walletRequestReadinessCommittedSnapshot(async (register) => register(snapshot));
    const map = h.walletRequestReadinessMap(cacheName, new Map());
    assert.equal(map.size, 4);
    for (const entry of map.values()) { assert.equal(entry.expiresAt, now + 10_000); assert.equal(Object.isFrozen(entry), true); }
    assert.equal(h.walletRequestReadinessMap("testInFlight", new Map()).size, 0);
  });
});

test("accepted runtime snapshot integration promotes only after the actual owner commits", async (t) => {
  const snapshotSource = source("proofIndexWithWalletReadSnapshot", false);
  if (!snapshotSource) {
    assert.notEqual(process.env.POW_WALLET_REQUEST_REQUIRE_SNAPSHOT_INTEGRATION, "1", "merged runtime lost its accepted snapshot wrapper");
    t.skip("canonical source; required again against the merged runtime candidate"); return;
  }
  const calls = [];
  const h = harness({ walletReadSnapshot: new AsyncLocalStorage(), proofIndexPool: () => ({}),
    withReadOnlySnapshot: async (_pool, read) => { const value = await read({}); calls.push("COMMIT"); return value; },
  });
  const run = new vm.Script(`${snapshotSource}\nproofIndexWithWalletReadSnapshot`).runInContext(h.context);
  await h.proofIndexWithWalletRequestReadiness(async () => {
    await run(async () => {
      const scope = h.context.walletReadSnapshot.getStore();
      const entries = new Map();
      h.rememberWorkPrecisionV2MigrationReadiness(entries, A, ready(), now + 10_000);
      scope.maps.set(cacheName, entries);
      assert.equal(h.walletRequestReadinessMap(cacheName, new Map()).size, 0);
    });
    assert.deepEqual(calls, ["COMMIT"]);
    assert.equal(h.walletRequestReadinessMap(cacheName, new Map()).size, 1);
  });
});

test("merged readiness wiring isolates owned snapshots and preserves outside full-audit sharing", async (t) => {
  const snapshotMapSource = source("walletSnapshotReadinessMap", false);
  if (!snapshotMapSource) {
    assert.notEqual(process.env.POW_WALLET_REQUEST_REQUIRE_SNAPSHOT_INTEGRATION, "1");
    t.skip("canonical source; required again against the merged runtime candidate"); return;
  }
  const globalMaps = Object.fromEntries([
    cacheName, "workPrecisionV2CanonicalBootstrapReadinessReadyCache",
    "workPrecisionV2MigrationReadinessRequestInFlight", "workPrecisionV2MigrationFullAuditInFlight",
    "workPrecisionV2ReadinessEpochContractInFlight", "workPrecisionV2ReadinessEpochContractReadyCache",
  ].map((name) => [name, new Map()]));
  const walletReadSnapshot = new AsyncLocalStorage();
  const h = harness({ ...globalMaps, walletReadSnapshot, proofIndexPool: () => ({}),
    normalizedWorkAmoV6ExpectedPins: (pins) => pins,
    workPrecisionV2ReadinessRequestKey: () => "pinned-declaration",
  });
  // Inspect the real wrapper's dependency injection, without invoking SQL.
  h.context.workPrecisionV2MigrationReadinessWithCompactCheckpoint = (options) => options;
  h.context.workPrecisionV2MigrationFullAuditWithBound = (options) => options;
  h.context.workPrecisionV2ReadinessEpochContractAttestationWithCache = (options) => options;
  const read = new vm.Script(`${snapshotMapSource}\n${source("proofIndexWorkPrecisionV2MigrationReadiness")}\nproofIndexWorkPrecisionV2MigrationReadiness`).runInContext(h.context);
  await h.proofIndexWithWalletRequestReadiness(async () => {
    const requestCache = h.walletRequestReadinessMap(cacheName, globalMaps[cacheName]);
    requestCache.set("request-only", { result: "must not enter another MVCC snapshot" });
    const outside = await read("livenet", {});
    assert.equal(outside.readyCache, requestCache);
    assert.equal(outside.loadFull({ key: A }).inFlight, globalMaps.workPrecisionV2MigrationFullAuditInFlight);
    const scope = { maps: new Map() };
    await walletReadSnapshot.run(scope, async () => {
      const owned = await read("livenet", {});
      assert.equal(owned.readyCache, scope.maps.get(cacheName));
      assert.notEqual(owned.readyCache, requestCache);
      assert.equal(owned.readyCache.has("request-only"), false);
      assert.notEqual(owned.inFlight, outside.inFlight);
      assert.equal(owned.loadFull({ key: A }).inFlight, scope.maps.get("workPrecisionV2MigrationFullAuditInFlight"));
      assert.notEqual(owned.loadFull({ key: A }).inFlight, globalMaps.workPrecisionV2MigrationFullAuditInFlight);
    });
  });
});
