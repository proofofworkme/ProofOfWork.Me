import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";

const worker = readFileSync(new URL("./backfill-proof-indexer.mjs", import.meta.url), "utf8");
const api = readFileSync(new URL("../server/proof-api.mjs", import.meta.url), "utf8");
const checkpoint = { height: 974413, blockHash: "b".repeat(64) };
const mail = { event_id: 22, txid: "f2a4543e7a18ce1a6ed232c35a3ac03d99be05e603b738c2daf9865b01adb3f3",
  protocol: "pwm1", kind: "mail", status: "pending", valid: true, payload_hash: "1".repeat(32) };
const previousSnapshotId = "a".repeat(24);

function load(source, names, dependencies) {
  const scope = vm.createContext({ Buffer, URL, createHash, ...dependencies });
  for (const name of names) {
    const match = source.match(new RegExp("^(?:async )?function " + name + "\\([\\s\\S]*?^\\}", "mu"));
    assert.ok(match, name);
    vm.runInContext(match[0], scope);
  }
  return scope;
}

test("same-block publication detects additions, replacements and removals without rehashing confirmed history", async () => {
  const f = load(worker, ["publicLogRelationalFingerprint", "publicLogFingerprintsMatch", "storedSummaryCoversPendingLog"],
    { NETWORK: "livenet", PUBLIC_LOG_EVENT_KINDS: ["mail"] });
  let pending = [];
  const reads = [];
  const client = { query: async sql => {
    const pendingOnly = sql.includes("AND e.status = 'pending'");
    reads.push(pendingOnly);
    return { rows: pendingOnly ? pending : [{ ...mail, status: "confirmed", event_id: 11 }, ...pending] };
  } };
  const empty = await f.publicLogRelationalFingerprint(client);
  assert.equal(await f.storedSummaryCoversPendingLog(client, empty), true);
  assert.equal(reads.at(-1), true);
  pending = [mail];
  assert.equal(await f.storedSummaryCoversPendingLog(client, empty), false);
  const observed = await f.publicLogRelationalFingerprint(client);
  assert.equal(await f.storedSummaryCoversPendingLog(client, observed), true);
  const { pendingHash, ...legacy } = observed;
  assert.equal(await f.storedSummaryCoversPendingLog(client, legacy), true);
  assert.equal(reads.at(-1), false);
  pending = [{ ...mail, txid: "c".repeat(64) }];
  assert.equal(await f.storedSummaryCoversPendingLog(client, observed), false);
  pending = [];
  assert.equal(await f.storedSummaryCoversPendingLog(client, observed), false);
});

test("the hot publisher checks pending membership at an existing checkpoint while an H-1 barrier reuses its proof", async () => {
  let matches = false, pendingChecks = 0, requested;
  const digest = "d".repeat(64);
  const store = load(worker, ["storeCanonicalSummarySnapshot"], {
    NETWORK: "livenet", CANONICAL_SUMMARY_REFRESH_TIMEOUT_MS: 10,
    latestBlockScanCheckpoint: async () => checkpoint, objectPayload: value => value ?? null,
    workProjectionModelAtHeight: async () => "work-subatoms-v2",
    storedExactEligibleCanonicalSummarySnapshotPayload: async () => ({ snapshotId: previousSnapshotId, count: 1 }),
    storedLedgerSnapshotPayload: async () => ({ summaryRefresh: { publicLogFingerprint: {} } }),
    exactWorkQ16CanonicalSummaryState: async () => ({ ready: true }),
    canonicalSummarySnapshotStorageEligible: () => true, canonicalSummaryTransitionSourceCurrent: async () => true,
    storedSummaryCoversPendingLog: async () => { pendingChecks++; return matches; },
    storedEligibleCanonicalSummarySnapshotPayload: async () => null,
    publicLogRelationalFingerprint: async () => ({ pendingHash: digest }),
    unpagedEndpoint: path => new URL(path, "http://127.0.0.1"),
    readJson: async url => { requested = url; throw new Error("stop before bundle write"); },
    canonicalSummaryRefreshNotAtTip: () => false, canonicalSummaryRefreshCatchupDependency: () => null,
  }).storeCanonicalSummarySnapshot;
  const options = { requiredCheckpoint: checkpoint };
  assert.equal((await store({}, options)).snapshotId, previousSnapshotId);
  assert.equal(pendingChecks, 0);
  await assert.rejects(store({}, { ...options, refreshPendingLog: true }), /stop before bundle write/u);
  assert.equal(requested.searchParams.get("priorPendingSnapshot"), previousSnapshotId);
  assert.equal(requested.searchParams.get("pendingLogHash"), digest);
  matches = true;
  assert.equal((await store({}, { ...options, refreshPendingLog: true })).skipped, true);
  assert.equal(pendingChecks, 2);
});

test("a live observation has a distinct snapshot, preserves confirmed economics and rejects a moving tip", async () => {
  const floor = { networkValueQ8: "101", frozenNetworkValueQ8: "99", actualValue: { creditMinerFeeAccountingModel: "fees" },
    workNetworkValueAccountingModel: "model" };
  const metrics = { confirmedComputerActions: 9, indexedThroughBlock: checkpoint.height };
  const growth = { actualValue: { totalQ8: "101" } };
  let tip = checkpoint.blockHash;
  const attached = (payload, ledger) => ({ ...payload, snapshotId: ledger.snapshotId, indexedThroughBlock: checkpoint.height });
  const build = load(api, ["internalCanonicalSummaryPayload"], {
    exactCanonicalSummaryCheckpoint: async () => ({ indexedThroughBlock: checkpoint.height, tipHash: tip }),
    buildIndexedCanonicalLedgerPayload: async () => ({ snapshotId: "ledger", metrics, consistency: { ok: true }, workFloor: floor }),
    ledgerPayloadHasCurrentChecks: () => true, ledgerPayloadIndexedThroughBlock: () => checkpoint.height,
    sha256Hex: bytes => createHash("sha256").update(bytes).digest("hex"), canonicalSummarySnapshotIdOutsideScopedOracle: id => id,
    attachLedgerMetadata: attached, growthSummaryPayloadFromLedger: () => growth, inceptionSummaryPayloadFromLedger: () => ({}),
    infinitySummaryPayloadFromLedger: () => ({}), compactActivitySummaryPayload: () => ({}),
    marketplaceSummaryPayloadFromLedger: ledger => attached({}, ledger), ledgerTokenStateForScope: () => ({}),
    compactTokenDirectorySummaryPayload: () => ({}), internalCanonicalWorkSummaryPayload: ledger => attached({}, ledger),
    payloadSnapshotId: row => row.snapshotId, proofIndexPayloadIndexedThroughBlock: row => row.indexedThroughBlock,
    summaryPayloadHasFiniteNetworkValue: () => true, ledgerConsistencyPayloadFromLedger: ledger => ledger,
    freshDataUnavailableError: message => new Error(message),
  }).internalCanonicalSummaryPayload;
  const verify = load(worker, ["assertPendingLogSummaryRevision"], {}).assertPendingLogSummaryRevision;
  const prior = { snapshotId: previousSnapshotId, workFloor: floor, metrics, growthSummary: growth,
    workNetworkValueQ8: floor.networkValueQ8, workNetworkValueAccountingModel: floor.workNetworkValueAccountingModel };
  const options = { checkpointHeight: checkpoint.height, checkpointHash: checkpoint.blockHash,
    priorPendingSnapshot: previousSnapshotId, pendingLogHash: "d".repeat(64) };
  const first = await build("livenet", options);
  verify(prior, first, { pendingHash: options.pendingLogHash });
  const replacement = await build("livenet", { ...options, priorPendingSnapshot: first.snapshotId, pendingLogHash: "e".repeat(64) });
  assert.notEqual(first.snapshotId, replacement.snapshotId);
  assert.notEqual((await build("livenet")).snapshotId, first.snapshotId);
  assert.throws(() => verify({ ...prior, workNetworkValueQ8: "100" }, first, { pendingHash: options.pendingLogHash }), /economics/u);
  assert.throws(() => verify(prior, first, { pendingHash: "bad" }), /membership binding/u);
  tip = "f".repeat(64);
  await assert.rejects(build("livenet", options), /no longer at the live tip/u);
});
