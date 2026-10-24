import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";

const apiSource = readFileSync(
  process.env.POW_METADATA_TEST_API_SOURCE ?? new URL("./proof-api.mjs", import.meta.url),
  "utf8",
);

// Extract complete top-level functions, not rewritten copies of their branches.
// These functions use the source's column-zero closing-brace convention; parsing
// the extracted program in vm also rejects an incomplete extraction.
function sourceFunction(name) {
  const match = new RegExp(`^(?:async )?function ${name}\\(`, "mu").exec(apiSource);
  assert.ok(match, `Missing source function: ${name}`);
  const end = apiSource.indexOf("\n}\n", match.index);
  assert.ok(end > match.index, `Missing source function end: ${name}`);
  return apiSource.slice(match.index, end + 2);
}

const functions = [
  "workAmoV8MigrationReadinessIdentity",
  "workAmoV8StatusCacheKey",
  "workAmoV8MetadataSingleFlight",
  "deepFreezeWorkAmoV8StatusSnapshot",
  "workQ16MempoolSnapshot",
  "workQ16PendingMembershipSnapshotReady",
  "workAmoV8ExactLiveProbeKey",
  "workAmoV8ExactReadinessSweep",
  "workAmoV8Metadata",
].map(sourceFunction).join("\n\n");

const hash = (value) => createHash("sha256").update(value).digest("hex");
const hex = (value) => value.repeat(64);
const NOW = Date.parse("2026-10-25T12:00:00Z");
const DECLARATION = Object.freeze({
  activationHeight: 100,
  authorityScriptPubKey: "51",
  blockHash: hex("b"),
  blockHeight: 90,
  blockTransactionIndex: 1,
  minimumPaymentSats: 546,
  payloadBytes: 80,
  payloadSha256: hex("c"),
  protocolVout: 0,
  recordOrdinal: 0,
  registryAddress: "fixture-registry",
  registryPaymentVout: 1,
  txid: hex("d"),
});

function membership(txids = []) {
  const sorted = [...txids].sort();
  return {
    count: sorted.length,
    model: "canonical-work-q16-pending-membership-v2",
    sha256: hash(`ProofOfWork.Me/WORK-Q16-PENDING-MEMBERSHIP/v1\n${JSON.stringify(sorted)}`),
    txids: sorted,
  };
}

function mempool(txids = []) {
  const sorted = [...txids].sort();
  return {
    count: sorted.length,
    model: "canonical-core-mempool-txid-set-v1",
    sha256: hash(`ProofOfWork.Me/WORK-Q16-PENDING-MEMPOOL/v1\n${JSON.stringify(sorted)}`),
  };
}

function probe(overrides = {}) {
  return {
    liveMempoolSnapshot: mempool(),
    liveMempoolTxids: [],
    tipHash: hex("a"),
    tipHeight: 110,
    workerReadiness: {
      era: "work-q16",
      finishedAt: "2026-10-25T12:00:00Z",
      mempoolCount: 0,
      mempoolSha256: mempool().sha256,
      pendingMembershipCount: 0,
      pendingMembershipSha256: membership().sha256,
      pendingProjectionSha256: hex("e"),
      proofSource: "fixture-worker",
      ready: true,
      state: "ready",
      tipHash: hex("a"),
      tipHeight: 110,
    },
    ...overrides,
  };
}

function readiness(overrides = {}) {
  return {
    activationHeight: 100,
    canonical: true,
    confirmed: true,
    confirmedReplayReady: true,
    constraintsReady: true,
    declarationIndexReady: true,
    definitionReady: true,
    evidenceComplete: true,
    exactTipReady: true,
    legacyProjectionReady: true,
    markerReady: true,
    openingReady: true,
    parityReady: true,
    replayReady: true,
    marker: { status: "complete", relicCutover: { fixture: "verified" } },
    pendingReady: true,
    pendingValidThrough: new Date(NOW + 60_000).toISOString(),
    pendingWitness: { membershipSnapshot: membership() },
    tipHash: hex("a"),
    tipHeight: 110,
    ...overrides,
  };
}

function harness(options = {}) {
  const state = { now: NOW, ...options };
  const calls = { reads: [], probes: 0, identities: 0, keys: 0, discovery: [], errors: [] };
  const stableReadiness = readiness();
  // Only I/O and protocol-module boundaries are fixtures. The tested metadata,
  // final sweep, probe keys, pending membership/expiry and single-flight are real.
  // Reader fixture epochs model results of the reader's own independent fences;
  // these tests do not replace or claim to exercise those database fences.
  const context = vm.createContext({
    Buffer,
    Date: class extends Date { static now() { return state.now; } },
    calls,
    compareCanonicalUtf8: (a, b) => Buffer.compare(Buffer.from(a), Buffer.from(b)),
    sha256Hex: hash,
    console: { error: (value) => calls.errors.push(String(value)) },
    errorSummary: (error) => error.message,
    freshDataUnavailableError: (message) => new Error(message),
    configuredWorkAmoV8Declaration: () => state.noDeclaration ? null : DECLARATION,
    proofIndexWorkAmoV8ActivationLatch: async () => null,
    workAmoV8DeclarationsEqual: (a, b) => JSON.stringify(a) === JSON.stringify(b),
    discoverExactWorkAmoV8Declaration: async (network, opts) => {
      calls.discovery.push({ network, ...opts });
      if (state.discoveryFailureAt === calls.discovery.length) {
        throw new Error("fixture discovery unavailable");
      }
      return { checked: true, declaration: state.noDeclaration ? null : DECLARATION };
    },
    canonicalWorkMarketOracleNetworkValueQ8: () => "123",
    workAmoV8Estimates: () => ({}),
    workAmoV8PersistentDeclarationEvidence: () => null,
    workAmoV8StatusFromEvidence: ({ evidence, indexedThroughBlock, precisionMigrationReady }) => ({
      activation: {},
      ready: Boolean(evidence?.confirmed && evidence?.evidenceComplete &&
        indexedThroughBlock >= DECLARATION.activationHeight && precisionMigrationReady),
    }),
    validateWorkAmoV8DeclarationEvidence: (evidence) => ({
      valid: evidence?.confirmed === true && evidence?.evidenceComplete === true,
    }),
    proofIndexWorkPrecisionV2MigrationReadiness: async (network, declaration, opts) => {
      const entry = { number: calls.reads.length + 1, network, declaration, ...opts };
      calls.reads.push(entry);
      return state.onRead ? state.onRead(entry, state, stableReadiness) : stableReadiness;
    },
    workAmoV8ExactLiveProbe: async () => {
      calls.probes += 1;
      const value = state.onProbe ? await state.onProbe(calls.probes, state) : probe();
      return value === null ? null : structuredClone(value);
    },
    fetchTransactionFromBitcoinRpc: async () => {
      if (state.declarationError) throw new Error("fixture declaration RPC unavailable");
      return { blockHash: DECLARATION.blockHash };
    },
    bitcoinRpc: async (method) => {
      assert.equal(method, "getblockhash");
      return { ok: true, result: DECLARATION.blockHash };
    },
    transactionBlockHash: (transaction) => transaction?.blockHash ?? "",
    fetchCoreBlockTxidIndex: async () => new Map([[DECLARATION.txid, DECLARATION.blockTransactionIndex]]),
    workAmoV8DeclarationEvidenceFromTransaction: (_transaction, _index, canonical) => ({
      confirmed: canonical,
      evidenceComplete: canonical,
    }),
    WORK_AMO_V5_DECLARATION_AUTHORITY_SCRIPT_PUBKEY: DECLARATION.authorityScriptPubKey,
    WORK_AMO_V5_DECLARATION_MIN_PAYMENT_SATS: DECLARATION.minimumPaymentSats,
    WORK_AMO_V5_DECLARATION_REGISTRY_ADDRESS: DECLARATION.registryAddress,
    WORK_AMO_V8_DECLARATION_PIN_STATE: "valid",
    WORK_AMO_V8_DECLARATION_PINS_REQUESTED: true,
    WORK_AMO_V8_WRITES_CONFIGURED: true,
  });
  vm.runInContext(`
    let workAmoV8ReachedLatch = ${state.reached === true};
    let workAmoV8DeclarationEmbargoLatch = false;
    let workAmoV8DiscoveredDeclaration = null;
    const workAmoV8MetadataInFlight = new Map();
    const workAmoV8MigrationReadinessIdentities = new WeakMap();
    let workAmoV8MigrationReadinessIdentitySequence = 0;
    ${functions}
    const actualIdentity = workAmoV8MigrationReadinessIdentity;
    workAmoV8MigrationReadinessIdentity = (...args) => {
      calls.identities += 1; return actualIdentity(...args);
    };
    const actualKey = workAmoV8StatusCacheKey;
    workAmoV8StatusCacheKey = (...args) => {
      calls.keys += 1; return actualKey(...args);
    };
    globalThis.runMetadata = workAmoV8Metadata;
    globalThis.flightCount = () => workAmoV8MetadataInFlight.size;
  `, context, { timeout: 1000 });
  return {
    calls,
    state,
    run: (opts = {}, network = "livenet") => context.runMetadata(network, opts),
    flights: context.flightCount,
  };
}

test("healthy recursive owner reads outer identity and final proof exactly once each", async () => {
  const h = harness({ onRead: ({ number }) => readiness({ auditEpoch: number }) });
  const result = await h.run();
  assert.equal(result.ready, true);
  assert.equal(result.indexReady, true);
  assert.equal(result.pendingWitnessReady, true);
  assert.equal(result.migrationReadiness.auditEpoch, 2);
  assert.equal(h.calls.reads.length, 2);
  assert.equal(h.calls.identities, 1);
  assert.equal(h.calls.keys, 1);
  assert.equal(h.calls.probes, 3);
  assert.equal(h.flights(), 0);
  assert.equal("txids" in result.migrationReadiness.pendingWitness.membershipSnapshot, false);
});

test("explicit owner bypass retains the reached latch and only performs the final audit", async () => {
  const h = harness();
  const result = await h.run({ exactReadinessProbe: probe(), singleFlightBypass: true });
  assert.equal(result.ready, true);
  assert.equal(result.activation.reached, true);
  assert.equal(h.calls.reads.length, 1);
  assert.equal(h.calls.probes, 2);
  assert.equal(h.calls.identities, 0);
  assert.equal(h.calls.keys, 0);
});

test("only literal true bypasses preliminary reads and key construction", async () => {
  for (const singleFlightBypass of [false, 1, "true"]) {
    const h = harness();
    assert.equal((await h.run({ singleFlightBypass })).ready, true);
    assert.equal(h.calls.reads.length, 2);
    assert.equal(h.calls.identities, 1);
    assert.equal(h.calls.keys, 1);
  }
});

test("final reader null, rejection, or incomplete proof never reuses outer positive evidence", async () => {
  for (const mode of ["null", "rejection", "incomplete"]) {
    const h = harness({ onRead: ({ number }) => {
      if (number === 1) return readiness({ auditEpoch: "outer" });
      if (mode === "rejection") throw new Error("fixture final audit unavailable");
      return mode === "null" ? null : readiness({ exactTipReady: false, auditEpoch: "changed" });
    } });
    const result = await h.run();
    assert.equal(result.indexReady, false, mode);
    assert.equal(result.ready, false, mode);
    assert.notEqual(result.migrationReadiness?.auditEpoch, "outer");
    assert.equal(h.calls.reads.length, 2);
    assert.equal(h.flights(), 0);
  }
});

test("a rejected preliminary read still allows independently valid final evidence", async () => {
  const h = harness({ onRead: ({ number }) => {
    if (number === 1) throw new Error("fixture preliminary read unavailable");
    return readiness({ auditEpoch: "final" });
  } });
  const result = await h.run();
  assert.equal(result.ready, true);
  assert.equal(result.migrationReadiness.auditEpoch, "final");
  assert.equal(h.calls.reads.length, 2);
  assert.equal(h.calls.discovery.length, 1);
});

test("final probe unavailable or throwing clears readiness rather than retaining preliminary proof", async () => {
  for (const [failureAt, throwing] of [[2, false], [2, true], [3, false], [3, true]]) {
    const h = harness({ onProbe: (number) => {
      if (number !== failureAt) return probe();
      if (throwing) throw new Error("fixture final Core probe unavailable");
      return null;
    } });
    const result = await h.run();
    assert.equal(result.indexReady, false);
    assert.equal(result.activation.tipVerified, false);
    assert.equal(result.migrationReadiness, null);
    assert.equal(result.workerReadiness.state, "exact-readiness-sweep-unavailable");
  }
});

test("actual final sweep rejects changed Core tip and worker authority during an audit", async () => {
  const mutations = [
    (p) => { p.tipHeight += 1; },
    (p) => { p.tipHash = hex("f"); },
    (p) => { p.workerReadiness.ready = false; },
    (p) => { p.workerReadiness.era = "different-era"; },
    (p) => { p.workerReadiness.tipHash = hex("f"); },
    (p) => { p.workerReadiness.tipHeight += 1; },
    (p) => { p.workerReadiness.pendingMembershipSha256 = hex("f"); },
    (p) => { p.workerReadiness.pendingProjectionSha256 = hex("f"); },
  ];
  for (const mutate of mutations) {
    const h = harness({ onProbe: (number) => {
      const value = probe();
      if (number === 3) mutate(value);
      return value;
    } });
    const result = await h.run();
    assert.equal(h.calls.reads.length, 2);
    assert.equal(result.indexReady, false);
    assert.equal(result.activation.tipVerified, false);
    assert.equal(result.migrationReadiness, null);
  }
});

test("an epoch invalidation during the necessary final audit cannot fall back to the outer epoch", async () => {
  const h = harness({ onRead: ({ number }) => number === 1
    ? readiness({ auditEpoch: "before" })
    : readiness({ auditEpoch: "after", constraintsReady: false, confirmedReplayReady: false }) });
  const result = await h.run();
  assert.equal(result.migrationReadiness.auditEpoch, "after");
  assert.equal(result.indexReady, false);
  assert.equal(result.ready, false);
});

test("final exact tip must match final reader proof even when the live sweep is stable", async () => {
  for (const mismatch of [{ tipHeight: 109 }, { tipHash: hex("f") }]) {
    const h = harness({ onRead: ({ number }) => readiness(number === 1 ? {} : mismatch) });
    const result = await h.run();
    assert.equal(result.activation.tipVerified, true);
    assert.equal(result.indexReady, false);
    assert.equal(result.ready, false);
  }
});

test("unrelated mempool and worker publication churn does not alter existing final sweep policy", async () => {
  const h = harness({ onProbe: (number) => {
    const value = probe();
    if (number === 3) {
      value.liveMempoolTxids = [hex("f")];
      value.liveMempoolSnapshot = mempool(value.liveMempoolTxids);
      Object.assign(value.workerReadiness, {
        finishedAt: "2026-10-25T12:00:01Z", proofSource: "next-publication",
        state: "republished", mempoolCount: 1, mempoolSha256: value.liveMempoolSnapshot.sha256,
      });
    }
    return value;
  } });
  const result = await h.run();
  assert.equal(result.indexReady, true);
  assert.equal(result.pendingWitnessReady, true);
  assert.equal(result.liveMempoolSnapshot.count, 1);
});

test("pending expiry is evaluated after the final audit without revoking separate confirmed evidence", async () => {
  const h = harness({ onRead: ({ number }, state, stable) => {
    if (number === 2) state.now = NOW + 60_001;
    return stable;
  } });
  const result = await h.run();
  assert.equal(result.indexReady, true);
  assert.equal(result.pendingMembershipLive, true);
  assert.equal(result.pendingWitnessReady, false);
});

test("pending membership must still be included in the final live mempool", async () => {
  const h = harness({ onRead: () => readiness({
    pendingWitness: { membershipSnapshot: membership([hex("f")]) },
  }) });
  const result = await h.run();
  assert.equal(result.indexReady, true);
  assert.equal(result.pendingMembershipLive, false);
  assert.equal(result.pendingWitnessReady, false);
});

test("force retains its independent forced final audit with and without recursive bypass", async () => {
  for (const singleFlightBypass of [false, true]) {
    const h = harness();
    const result = await h.run({ force: true, singleFlightBypass });
    assert.equal(result.ready, true);
    assert.equal(h.calls.reads.length, 1);
    assert.equal(h.calls.reads[0].force, true);
    assert.equal(h.calls.discovery[0].force, true);
    assert.equal(h.calls.discovery.length, 1);
    assert.equal(h.calls.keys, singleFlightBypass ? 0 : 1);
  }
});

test("below activation does not audit until reached, while an existing reached latch still requires final proof", async () => {
  for (const reached of [false, true]) {
    const h = harness({ reached,
      onProbe: () => probe({ tipHeight: 99 }),
      onRead: () => readiness({ tipHeight: 99, exactTipReady: false }),
    });
    const result = await h.run({ singleFlightBypass: true });
    assert.equal(result.indexReady, false);
    assert.equal(h.calls.reads.length, reached ? 1 : 0);
    assert.equal(result.activation.reached, reached);
  }
});

test("non-livenet and missing declaration remain early non-authoritative returns", async () => {
  for (const [options, network] of [[{}, "testnet"], [{ noDeclaration: true }, "livenet"]]) {
    const h = harness(options);
    const result = await h.run({}, network);
    assert.equal(result.indexReady, false);
    assert.equal(result.activation.tipVerified, false);
    assert.equal(h.calls.reads.length, 0);
    assert.equal(h.calls.probes, 0);
    assert.equal(h.calls.keys, 0);
  }
});

test("declaration RPC failure cannot skip the final sweep after the owner reaches activation", async () => {
  const h = harness({ declarationError: true });
  const result = await h.run({ singleFlightBypass: true });
  assert.equal(result.activation.reached, true);
  assert.equal(h.calls.reads.length, 1);
  assert.equal(h.calls.probes, 3);
  assert.equal(h.calls.errors.length, 1);
  assert.equal(result.ready, false);
  assert.equal(result.activation.tipVerified, true);
});

test("identical concurrent outer callers share one recursive owner and final audit", { timeout: 2000 }, async () => {
  let release;
  let entered;
  const gate = new Promise((resolve) => { release = resolve; });
  const started = new Promise((resolve) => { entered = resolve; });
  const h = harness({ onRead: async ({ number }, _state, stable) => {
    if (number === 3) { entered(); await gate; }
    return stable;
  } });
  const first = h.run();
  const second = h.run();
  await started;
  assert.equal(h.flights(), 1);
  release();
  const results = await Promise.all([first, second]);
  assert.equal(results[0].ready, true);
  assert.equal(results[1].ready, true);
  assert.equal(h.calls.reads.length, 3);
  assert.equal(h.calls.identities, 2);
  assert.equal(h.calls.keys, 2);
  assert.equal(h.flights(), 0);
});

test("a rejected recursive owner clears its single-flight entry and later calls can recover", async () => {
  const h = harness({ discoveryFailureAt: 2 });
  await assert.rejects(h.run(), /fixture discovery unavailable/u);
  assert.equal(h.flights(), 0);
  h.state.discoveryFailureAt = null;
  const result = await h.run();
  assert.equal(result.ready, true);
  assert.equal(h.flights(), 0);
});
