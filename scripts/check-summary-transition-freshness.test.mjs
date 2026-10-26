import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";

const source = readFileSync(new URL("./backfill-proof-indexer.mjs", import.meta.url), "utf8");
function functionSource(name) {
  const start = source.indexOf("async function " + name + "(");
  assert.ok(start >= 0, name);
  const tail = source.slice(start + 1);
  const end = tail.search(/\n(?:async )?function [A-Za-z_]/u);
  assert.ok(end >= 0, name + " end");
  return source.slice(start, start + 1 + end);
}
const H = 973104;
const HASH = "ab".repeat(32);
const C = {
  WORK_AMO_V5_ACTIVATION_HEIGHT: 948000,
  WORK_AMO_V5_BLOCK_SEQUENCER_MODEL: "canonical-work-amo-full-position-block-sequencer-v1",
  WORK_AMO_V8_BLOCK_SEQUENCER_MODEL: "canonical-work-amo-full-position-block-sequencer-v4",
  WORK_AMO_V5_STATE_COMMITMENT_MODEL: "canonical-work-amo-sufficient-state-sha256-v1",
  WORK_AMO_V5_EVENT_SET_COMMITMENT_MODEL: "canonical-work-amo-event-set-sha256-v1",
  WORK_AMO_V5_PAYLOAD_COMMITMENT_MODEL: "canonical-work-amo-payload-sha256-v1",
  WORK_AMO_V5_RAW_BLOCK_DESCRIPTOR_MODEL: "canonical-work-amo-raw-block-descriptor-v1",
  WORK_AMO_V5_RAW_TRANSITION_CHAIN_MODEL: "canonical-work-amo-raw-transition-chain-sha256-v1",
};
const commitment = (model, hex) => ({ model, payloadBytes: 73, sha256: hex.repeat(64) });
function fixture() {
  const row = {
    block_hash: HASH, block_height: H, model: C.WORK_AMO_V8_BLOCK_SEQUENCER_MODEL,
    state_commitment_model: C.WORK_AMO_V5_STATE_COMMITMENT_MODEL,
    closing_network_value_q8: "123456789",
    closing_state_sha256: "c".repeat(64), closing_state_payload_bytes: 73,
    event_set_model: C.WORK_AMO_V5_EVENT_SET_COMMITMENT_MODEL,
    event_set_sha256: "e".repeat(64), event_set_payload_bytes: 73, event_count: 0,
    block_descriptor: commitment(C.WORK_AMO_V5_PAYLOAD_COMMITMENT_MODEL, "b"),
    block_descriptor_model: C.WORK_AMO_V5_RAW_BLOCK_DESCRIPTOR_MODEL,
    block_transaction_count: 1,
    closing_commitment: commitment(C.WORK_AMO_V5_STATE_COMMITMENT_MODEL, "c"),
    event_set: { ...commitment(C.WORK_AMO_V5_EVENT_SET_COMMITMENT_MODEL, "e"), eventCount: 0 },
    transition_chain: commitment(C.WORK_AMO_V5_RAW_TRANSITION_CHAIN_MODEL, "d"),
    transition_chain_model: C.WORK_AMO_V5_RAW_TRANSITION_CHAIN_MODEL,
  };
  const evidence = {
    blockHash: HASH, blockHeight: H, blockDescriptorCommitment: row.block_descriptor,
    blockDescriptorModel: row.block_descriptor_model, blockTransactionCount: 1,
    closingStateCommitment: row.closing_commitment, eventSetCommitment: row.event_set,
    model: C.WORK_AMO_V5_BLOCK_SEQUENCER_MODEL, networkValueQ8: row.closing_network_value_q8,
    transitionChainCommitment: row.transition_chain, transitionChainModel: row.transition_chain_model,
  };
  row.stored_source = structuredClone(evidence);
  return { row, payload: { snapshotId: "old-summary", indexedThroughBlockHash: HASH,
    sourceHashes: { workAmoV5Transition: structuredClone(evidence) }, summaryPayloads: {} } };
}
function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === "object") return Object.fromEntries(
    Object.keys(value).sort().map(key => [key, stable(value[key])]));
  return value;
}
function harness({ row, payload, rows, generatorError = new Error("canonical-generator-requested"),
  notAtTip = false, canDefer = false } = fixture()) {
  const calls = { queries: [], generator: [] };
  const client = { async query(sql, params) {
    calls.queries.push({ sql, params });
    return { rows: rows ?? [row] };
  } };
  const objectPayload = value => value && typeof value === "object" && !Array.isArray(value) ? value : null;
  const context = vm.createContext({
    ...C, NETWORK: "livenet", URL, console: { error() {} }, objectPayload,
    canonicalJsonText: value => JSON.stringify(stable(value)),
    latestBlockScanCheckpoint: async () => ({ height: H, blockHash: HASH }),
    workProjectionModelAtHeight: async () => "work-subatoms-v2",
    storedExactEligibleCanonicalSummarySnapshotPayload: async () => ({ snapshotId: payload.snapshotId, count: 1 }),
    storedLedgerSnapshotPayload: async () => payload,
    exactWorkQ16CanonicalSummaryState: async () => ({ ready: true, required: true, state: { unchanged: true } }),
    canonicalSummarySnapshotStorageEligible: () => true,
    storedEligibleCanonicalSummarySnapshotPayload: async () => payload,
    canonicalSummaryCoverage: () => payload.indexedThroughBlock ?? H,
    publicLogRelationalFingerprint: async () => ({ hash: "unchanged" }),
    canonicalSummaryAccountingModelsCurrent: () => true,
    publicLogFingerprintsMatch: () => true,
    CANONICAL_SUMMARY_REFRESH_TIMEOUT_MS: 1000,
    unpagedEndpoint: pathname => new URL(pathname, "http://fixture.invalid"),
    readJson: async url => { calls.generator.push(url); throw generatorError; },
    canonicalSummaryRefreshNotAtTip: () => notAtTip,
    canonicalSummaryRefreshCatchupDependency: () => false,
    canonicalSummaryRefreshCanDefer: () => canDefer,
  });
  vm.runInContext(functionSource("canonicalSummaryTransitionSourceCurrent") + "\n" +
    functionSource("storeCanonicalSummarySnapshot"), context);
  return {
    calls,
    current: (height = H, hash = HASH) => context.canonicalSummaryTransitionSourceCurrent(client, payload, height, hash),
    run: exact => context.storeCanonicalSummarySnapshot(client, exact ? {
      requiredCheckpoint: { height: H, blockHash: HASH },
    } : {}),
  };
}
for (const exact of [false, true]) {
  const lane = exact ? "exact checkpoint" : "ordinary current";
  test(lane + ": unchanged transition reuses the existing snapshot", async () => {
    const h = harness();
    const result = await h.run(exact);
    assert.equal(result.skipped, true);
    assert.equal(result.snapshotId, "old-summary");
    assert.equal(result.reason, exact ? "already-current-exact-checkpoint" : "already-current");
    assert.equal(h.calls.generator.length, 0);
    assert.equal(h.calls.queries.length, 1);
  });
  for (const field of ["transition_chain", "event_set"]) {
    test(lane + ": same height/hash/state with changed " + field + " requests canonical generation", async () => {
      const data = fixture();
      data.row[field].sha256 = "f".repeat(64);
      if (field === "event_set") data.row.event_set_sha256 = "f".repeat(64);
      const h = harness(data);
      await assert.rejects(h.run(exact), /canonical-generator-requested/u);
      assert.equal(h.calls.generator.length, 1);
      assert.equal(h.calls.generator[0].pathname, "/api/v1/internal/canonical-summary");
      assert.equal(h.calls.generator[0].searchParams.has("storedExact"), false);
      if (exact) assert.equal(h.calls.generator[0].searchParams.get("checkpointHash"), HASH);
    });
  }
}
test("a mismatched relational source_hashes location cannot reuse matching payload metadata", async () => {
  const data = fixture();
  data.row.stored_source.transitionChainCommitment.sha256 = "f".repeat(64);
  assert.equal(await harness(data).current(), false);
});
test("missing and malformed current seal evidence fails closed", async () => {
  for (const rows of [[], [fixture().row, fixture().row]]) {
    assert.equal(await harness({ ...fixture(), rows }).current(), false);
  }
  for (const mutate of [
    row => { row.transition_chain.payloadBytes = 0; },
    row => { row.event_set_sha256 = "f".repeat(64); },
    row => { row.closing_state_sha256 = "f".repeat(64); },
    row => { row.block_hash = "f".repeat(64); },
    row => { row.block_height--; },
    row => { row.model = "unknown"; },
  ]) {
    const data = fixture(); mutate(data.row);
    assert.equal(await harness(data).current(), false);
  }
});
test("metadata query is one exact indexed checkpoint and preserves native inline reading", async () => {
  const h = harness(); assert.equal(await h.current(), true);
  const [{ sql, params }] = h.calls.queries;
  assert.deepEqual(Array.from(params), ["livenet", H, HASH, "old-summary"]);
  for (const predicate of [
    "transition.block_height = $2", "transition.block_hash = $3",
    "snapshot.snapshot_id = $4", "block.canonical = true",
    "transition.complete = true", "transition.block_atomic = true",
    "transition.fee_once = true", "transition.invalid_zero = true",
    "snapshot.source_hashes->'workAmoV5Transition'", "LIMIT 2",
  ]) assert.ok(sql.includes(predicate), predicate);
  assert.doesNotMatch(sql, /read_work_transition_payload|reconstruct_work_transition|SELECT\s+\*/u);
});
test("preactivation summaries retain historical reuse without a transition query", async () => {
  const h = harness();
  assert.equal(await h.current(C.WORK_AMO_V5_ACTIVATION_HEIGHT - 1), true);
  assert.equal(h.calls.queries.length, 0);
});
test("stale evidence is not returned as a deferred prior summary after a refresh failure", async () => {
  const data = fixture(); data.row.transition_chain.sha256 = "f".repeat(64);
  const h = harness({ ...data, canDefer: true });
  await assert.rejects(h.run(false), /canonical-generator-requested/u);
});
test("a not-at-tip deferral retains no stale summary ID", async () => {
  const data = fixture(); data.row.transition_chain.sha256 = "f".repeat(64);
  const h = harness({ ...data, canDefer: true, notAtTip: true });
  const result = await h.run(false);
  assert.equal(result.reason, "canonical-summary-deferred-until-tip");
  assert.equal(result.snapshotId, null);
});

test("valid older checkpoint retains its existing deferred-fallback behavior", async () => {
  const data = fixture();
  const hash = "12".repeat(32);
  data.row.block_height = H - 1;
  data.row.block_hash = hash;
  data.row.stored_source.blockHeight = H - 1;
  data.row.stored_source.blockHash = hash;
  data.payload.indexedThroughBlock = H - 1;
  data.payload.indexedThroughBlockHash = hash;
  data.payload.sourceHashes.workAmoV5Transition.blockHeight = H - 1;
  data.payload.sourceHashes.workAmoV5Transition.blockHash = hash;
  const h = harness({ ...data, canDefer: true });
  const result = await h.run(false);
  assert.equal(result.reason, "canonical-summary-deferred");
  assert.equal(result.snapshotId, "old-summary");
  assert.equal(result.indexedThroughBlock, H - 1);
  assert.equal(h.calls.generator.length, 1);
  assert.equal(h.calls.queries[0].params[1], H - 1);
  assert.equal(h.calls.queries[0].params[2], hash);
});
