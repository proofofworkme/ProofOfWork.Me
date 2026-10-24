import assert from "node:assert/strict";
import test from "node:test";
import { createHash } from "node:crypto";
import { resolveWorkBatchReadConfiguration } from "../work-batch-runtime.mjs";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import { payments, script } from "bitcoinjs-lib";
import { buildWorkBatchPayload, parseWorkBatchPayload, WORK_BATCH_TOKEN_ID } from "../../src/shared/protocol/workBatch.mjs";
import { workBatchDeclarationCommitment, WORK_BATCH_MIN_DECLARATION_BLOCK_HEIGHT, normalizeWorkBatchDeclarationPins, WORK_BATCH_DECLARATION_COMMITMENT_MODEL, workBatchActivationMarkerFromTransition } from "../work-batch-declaration.mjs";
import { readWorkBatchDiscoveryCheckpoint, assertCanonicalWorkBatchChild, verifiedWorkBatchEventIds, readWorkBatchDeclarationCandidates, readWorkBatchActivationMarker, assertNoSealedWorkBatchAuthority } from "./work-batch-reader.mjs";

function fixture() {
  const receiver = n => payments.p2pkh({ hash: Buffer.alloc(20, n) }).address;
  const senderAddress = receiver(3), txid = "a".repeat(64);
  const wire = buildWorkBatchPayload([[receiver(1), "1"], [receiver(2), "20000000000000001"]]);
  const batch = parseWorkBatchPayload(wire);
  const parentPosition = { blockHeight: 1_000_001, blockHash: "b".repeat(64), blockTransactionIndex: 3, protocolVout: 1, recordOrdinal: 0 };
  const commitment = { model: "canonical-work-amo-raw-transition-chain-sha256-v1", payloadBytes: 100, sha256: "c".repeat(64) };
  const batchPayloadCommitment = { model: "canonical-work-amo-v5-payload-sha256-v1", payloadBytes: wire.length, sha256: "d".repeat(64) };
  const derived = batch.recipients.map((recipient, index) => ({
    ...recipient, senderAddress, tokenId: WORK_BATCH_TOKEN_ID, amountStorageModel: "work-subatoms-v2",
    amountVersion: "batch1", transferVersion: "batch1", batchRecipientIndex: index,
    batchRecipientCount: batch.recipientCount, batchTotalAmountSubatoms: batch.totalAmountSubatoms,
    batchPayloadCommitment, kind: "token-transfer", paidSats: 0, registryMutationFeeSats: 0,
    chargesTransactionFee: false, claimsEconomicOutputs: false, economicDelta: false, rawCandidate: false,
    containerPosition: parentPosition, projectionPosition: { ...parentPosition, recordOrdinal: index + 1 },
    parentTransitionChainCommitmentAfter: commitment, derivedId: txid + ":" + (index + 1), derivedIndex: index,
  }));
  const output = { amountSubatoms: batch.totalAmountSubatoms, totalAmountSubatoms: batch.totalAmountSubatoms,
    recipientCount: batch.recipientCount, recipients: batch.recipients, batchPayloadCommitment,
    projection: { kind: "token-transfer-batch" } };
  const record = { derived, rawCandidate: true, outcome: { kind: "pwt1-valid", semanticKind: "token-transfer-batch", valid: true },
    output, position: parentPosition, txid, transitionChainCommitmentAfter: commitment };
  const parent = { kind: "token-transfer-batch", protocol: "pwt1", valid: true, confirmed: true,
    _workAmoV5ReplayBound: true, workAmoV5RawCandidate: true, payload: wire, senderAddress, txid,
    workAmoV5ReplayOutput: output };
  const children = derived.map((descriptor, index) => ({ ...descriptor,
    position: descriptor.projectionPosition, derived: true, txid, protocol: "pwt1",
    valid: true, confirmed: true, _workAmoV5ReplayBound: true, workAmoV5RawCandidate: false,
    workAmoV5ReplayOutcome: { kind: "pwt1-valid", valid: true },
    workAmoV5ReplayRawWitness: { model: "canonical-work-amo-v5-derived-child-v1", descriptor,
      parentPosition, parentProtocol: "pwt1" },
  }));
  const evidence = { parent_event_id: "10", parent_payload: parent, parent_records: [record],
    carrier_output: { value: 0, scriptpubkey: Buffer.from(script.compile([106, Buffer.from(wire)])).toString("hex") },
    siblings: children.map((payload, index) => ({ event_id: String(11 + index), payload, position: payload.position })),
  };
  return { parent, children, evidence, rows: children.map((payload, index) => ({ event_id: 11 + index, payload })) };
}

test("confirmed batch receipts require exact accepted descriptor, position and zero economic delta", () => {
  const f = fixture();
  assert.equal(assertCanonicalWorkBatchChild(f.children[0], { ...f.evidence, child_position: f.children[0].position }), true);
  for (const mutate of [
    item => { item.amountSubatoms = "2"; }, item => { item.batchRecipientIndex = 1; },
    item => { item.rawCandidate = true; }, item => { item.economicDelta = true; },
    item => { item.paidSats = 546; }, item => { item.minerFeeSats = 1; },
    item => { item.parentTransitionChainCommitmentAfter.sha256 = "e".repeat(64); },
    item => { item.position.recordOrdinal = 2; }, item => { item.workAmoV5ReplayRawWitness.descriptor.amountSubatoms = "2"; },
  ]) {
    const child = structuredClone(f.children[0]); mutate(child);
    assert.throws(() => assertCanonicalWorkBatchChild(child, { ...f.evidence, child_position: f.children[0].position }));
  }
  const wrongEvidence = structuredClone(f.evidence); wrongEvidence.parent_records[0].output.recipients[0].amountSubatoms = "2";
  assert.throws(() => assertCanonicalWorkBatchChild(f.children[0], { ...wrongEvidence, child_position: f.children[0].position }));
});

test("read qualification verifies every sibling even when only the parent or one recipient is requested", async () => {
  const f = fixture();
  const pool = { query: async (sql, params) => {
    assert.match(sql, /canonical_work_batch_parent_evidence/u);
    assert.equal(params[0], "livenet");
    return { rows: [f.evidence] };
  } };
  assert.deepEqual([...await verifiedWorkBatchEventIds(pool, f.rows, "livenet")], [11, 12]);
  assert.deepEqual([...await verifiedWorkBatchEventIds(pool, [{ event_id: 10, payload: f.parent }], "livenet")], [10]);
  for (const mutate of [
    evidence => { evidence.siblings.pop(); }, evidence => { evidence.siblings = []; },
    evidence => { evidence.siblings[1].payload.batchRecipientIndex = 0; },
    evidence => { evidence.siblings[1].position.recordOrdinal = 1; },
  ]) {
    const evidence = structuredClone(f.evidence); mutate(evidence);
    await assert.rejects(() => verifiedWorkBatchEventIds({ query: async () => ({ rows: [evidence] }) }, f.rows.slice(0, 1), "livenet"));
  }
  await assert.rejects(() => verifiedWorkBatchEventIds({ query: async () => ({ rows: [] }) }, f.rows, "livenet"));
  await assert.rejects(() => verifiedWorkBatchEventIds(pool, f.rows, "testnet"));
});

test("declaration discovery uses complete historical coverage and reports truncation", async () => {
  const hash = "b".repeat(64), commitment = workBatchDeclarationCommitment();
  const f = discoveryFixture({ coverageHeight: 1_000_050 });
  const base = f.row;
  let calls = 0;
  const pool = { query: async (sql, params) => {
    if (sql.includes("work_batch_discovery_state")) return { rows: [f.state] };
    calls++;
    assert.match(sql, /checkpoint.height <= coverage.height/u);
    assert.doesNotMatch(sql, /JOIN proof_indexer.tx_inputs/u);
    assert.equal(params[1], commitment.protocolRecord);
    assert.equal(params[4], Buffer.from(commitment.protocolRecord).toString("hex"));
    assert.equal(params[6], 2);
    assert.equal(params[15], WORK_BATCH_MIN_DECLARATION_BLOCK_HEIGHT);
    assert.match(sql, /tx.block_height >= \$16/u);
    return { rows: [0, 1].map(index => ({ ...base, txid: String(index + 1).repeat(64), block_height: 1_000_000,
      block_hash: hash, block_index: index, protocol_vout: 1, record_ordinal: 0, registry_payment_vout: 0 })) };
  } };
  const result = await readWorkBatchDeclarationCandidates(pool, "livenet", { expectedTipHeight: 1_000_000, expectedTipHash: hash, limit: 1 });
  assert.equal(result.complete, false); assert.equal(result.overflow, true); assert.equal(result.candidates.length, 1);
  assert.equal(result.scan.indexedThroughBlock, 1_000_000); assert.equal(result.scan.coverageIndexedThroughBlock, 1_000_050);
  assert.equal(await readWorkBatchDeclarationCandidates(pool, "testnet", { expectedTipHeight: 1_000_000, expectedTipHash: hash }), null);
  assert.equal(calls, 1);
});

test("activation marker absence differs from corrupt, orphaned or unsealed persisted authority", async () => {
  const declaration = normalizeWorkBatchDeclarationPins({ txid: "a".repeat(64), blockHeight: 1_000_000,
    blockHash: "b".repeat(64), blockTransactionIndex: 1, protocolVout: 1, recordOrdinal: 0,
    registryPaymentVout: 0, activationHeight: 1_000_001 });
  const context = { activationHeight: declaration.activationHeight, declaration,
    evidenceCommitment: { model: WORK_BATCH_DECLARATION_COMMITMENT_MODEL, payloadBytes: 100, sha256: "c".repeat(64) } };
  const transition = { network: "livenet", complete: true, blockAtomic: true, feeOnce: true, invalidZero: true,
    blockHeight: declaration.activationHeight, blockHash: "d".repeat(64), previousBlockHash: declaration.blockHash,
    transitionChainCommitment: { model: "canonical-work-amo-raw-transition-chain-sha256-v1", payloadBytes: 100, sha256: "e".repeat(64) },
    workBatchV1: context };
  const value = workBatchActivationMarkerFromTransition(transition);
  const row = { value, canonical_block_hash: transition.blockHash, transition_chain_commitment: transition.transitionChainCommitment, batch_context: context };
  assert.deepEqual(await readWorkBatchActivationMarker({ query: async () => ({ rows: [row] }) }, "livenet"), value);
  assert.equal(await readWorkBatchActivationMarker({ query: async () => ({ rows: [] }) }, "livenet"), null);
  await assert.rejects(() => readWorkBatchActivationMarker(null, "livenet"));
  for (const mutate of [
    item => { item.canonical_block_hash = null; }, item => { item.transition_chain_commitment = null; },
    item => { item.batch_context = null; }, item => { item.value.activationHeight++; },
  ]) { const item = structuredClone(row); mutate(item);
    await assert.rejects(() => readWorkBatchActivationMarker({ query: async () => ({ rows: [item] }) }, "livenet")); }
});

test("declaration discovery pages beyond public memo copies without hiding a later authority candidate", async () => {
  const hash = "b".repeat(64);
  const f = discoveryFixture({ coverageHeight: 1_000_050 });
  const base = f.row;
  const records = Array.from({ length: 65 }, (_, index) => ({ ...base, txid: (index + 1).toString(16).padStart(64, "0"),
    block_height: 1_000_000, block_hash: hash, block_index: index, protocol_vout: 1, record_ordinal: 0, registry_payment_vout: 0 }));
  let calls = 0;
  const pool = { query: async (sql, params) => {
    if (sql.includes("work_batch_discovery_state")) return { rows: [f.state] };
    calls++;
    assert.match(sql, /SELECT DISTINCT ON \(tx.txid\)/u);
    assert.match(sql, /tx.block_height, COALESCE\(tx.block_index, -1\), tx.txid/u);
    const cursor = params[9];
    return { rows: records.filter(row => cursor === null || row.block_index > cursor).slice(0, params[6]) };
  } };
  const seen = [];
  let after = null;
  for (let page = 0; page < 3; page++) {
    const result = await readWorkBatchDeclarationCandidates(pool, "livenet", { expectedTipHeight: 1_000_000, expectedTipHash: hash, limit: 32, after });
    seen.push(...result.candidates.map(item => item.txid));
    assert.equal(result.scan.complete, true);
    if (page < 2) {
      assert.equal(result.complete, false); assert.equal(result.overflow, true);
      assert.deepEqual(result.nextCursor, { blockHeight: 1_000_000, blockTransactionIndex: (page + 1) * 32 - 1, txid: seen.at(-1) });
      after = result.nextCursor;
    } else { assert.equal(result.complete, true); assert.equal(result.nextCursor, null); }
  }
  assert.deepEqual(seen, records.map(item => item.txid));
  for (const cursor of [
    { ...after, txid: "A".repeat(64) }, { ...after, blockHeight: 1_000_001 },
    { ...after, blockTransactionIndex: -1 }, { ...after, blockTransactionIndex: 2147483648 }, { ...after, unexpected: true },
  ]) assert.equal(await readWorkBatchDeclarationCandidates(pool, "livenet", { expectedTipHeight: 1_000_000, expectedTipHash: hash, after: cursor }), null);
  assert.equal(calls, 3);
});


function sealedHead(overrides = {}) {
  return { block_height: 1_000_002, block_hash: "f".repeat(64), canonical_block_hash: "f".repeat(64),
    complete: true, block_atomic: true, fee_once: true, invalid_zero: true,
    has_batch_context: false, ...overrides };
}

test("missing marker distinguishes a prebatch seal from established or unavailable authority", async () => {
  const check = rows => readWorkBatchActivationMarker({ query: async sql =>
    ({ rows: sql.includes("work_batch_missing_marker_sealed_head") ? rows : [] }) }, "livenet");
  assert.equal(await check([]), null);
  assert.equal(await check([sealedHead()]), null);
  for (const row of [
    sealedHead({ has_batch_context: true }),
    sealedHead({ canonical_block_hash: null }), sealedHead({ complete: false }),
    sealedHead({ block_atomic: false }), sealedHead({ fee_once: false }),
    sealedHead({ invalid_zero: false }), sealedHead({ has_batch_context: null }),
  ]) await assert.rejects(() => check([row]), /marker.*(?:missing|unavailable|orphaned)/u);
  await assert.rejects(() => check([sealedHead(), sealedHead()]), /unavailable/u);
});

test("marker-loss guard bounds the indexed seal before filtering canonical or batch state", async () => {
  let calls = 0;
  const pool = { query: async (sql, parameters) => {
    calls++;
    const head = sql.slice(sql.indexOf("WITH latest AS MATERIALIZED"), sql.indexOf("SELECT latest.*"));
    assert.match(head, /ORDER BY transition.block_height DESC\s+LIMIT 1/u);
    assert.match(head, /transition.block_height < \$2/u);
    assert.doesNotMatch(head, /AND (?:transition\.)?(?:complete|canonical|has_batch_context)/u);
    assert.match(sql, /LEFT JOIN proof_indexer.blocks canonical/u);
    assert.deepEqual(parameters, ["livenet", 1_000_003]);
    return { rows: [sealedHead({ has_batch_context: true })] };
  } };
  await assert.rejects(() => assertNoSealedWorkBatchAuthority(pool, "livenet", { beforeBlockHeight: 1_000_003 }), /marker is missing/u);
  assert.equal(calls, 1);
  await assert.rejects(() => assertNoSealedWorkBatchAuthority(pool, "livenet", { beforeBlockHeight: 0 }), /boundary/u);
  assert.equal(calls, 1);
});

test("cleared process pins cannot erase read authority when the activation marker is deleted", async () => {
  const source = readFileSync(new URL("../proof-api.mjs", import.meta.url), "utf8");
  const start = source.indexOf("async function workBatchReadConfiguration(");
  const end = source.indexOf("\nasync function workBatchReplayContext(", start);
  assert.ok(start > 0 && end > start);
  const configuration = { requested: false, pins: null, writesEnabled: false };
  let latest = sealedHead({ has_batch_context: true });
  const pool = { query: async sql => ({ rows: sql.includes("work_batch_missing_marker_sealed_head") ? [latest] : [] }) };
  const read = new vm.Script(`${source.slice(start, end)}\nworkBatchReadConfiguration`)
    .runInContext(vm.createContext({ WORK_BATCH_CONFIGURATION: configuration,
      proofIndexWorkBatchActivationMarker: network => readWorkBatchActivationMarker(pool, network),
      resolveWorkBatchReadConfiguration, workBatchDiscoverDeclaration: async () => null }));
  await assert.rejects(() => read("livenet"), /marker is missing/u);
  latest = sealedHead();
  const unconfigured = await read("livenet");
  assert.equal(unconfigured.pins, null); assert.equal(unconfigured.writesEnabled, false);
});


test("native metadata stripping retains the batch era without reconstructing large state", async () => {
  const source = readFileSync(new URL("./fixtures/native-runtime-storage-v2.sql", import.meta.url), "utf8");
  const start = source.indexOf("CREATE FUNCTION proof_indexer.work_transition_metadata_v1(");
  const end = source.indexOf("$$;", start);
  const implementation = source.slice(start, end);
  const removed = implementation.slice(implementation.indexOf("p-ARRAY[") + 8,
    implementation.indexOf("]::text[]")).split(",").map(value => value.trim().slice(1, -1));
  assert.equal(removed.length, 6);
  const payload = { workBatchV1: { activationHeight: 1_000_001 },
    replayRecords: [], transitionChainCommitment: { sha256: "a".repeat(64) },
    ...Object.fromEntries(removed.map(key => [key, { large: "fixture" }])) };
  const metadata = Object.fromEntries(Object.entries(payload).filter(([key]) => !removed.includes(key)));
  assert.ok(Object.hasOwn(metadata, "workBatchV1"));
  assert.ok(Object.hasOwn(metadata, "replayRecords"));
  let calls = 0;
  const pool = { query: async sql => {
    calls++;
    assert.doesNotMatch(sql, /read_work_transition_payload|canonical_work_transition_payload/u);
    return { rows: sql.includes("work_batch_missing_marker_sealed_head") ?
      [sealedHead({ has_batch_context: Object.hasOwn(metadata, "workBatchV1") })] : [] };
  } };
  await assert.rejects(() => readWorkBatchActivationMarker(pool, "livenet"), /marker is missing/u);
  assert.equal(calls, 2);
});


function discoveryFixture({ height = 1_000_000, coverageHeight = height, hash = "b".repeat(64),
  coverageHash = coverageHeight === height ? hash : "c".repeat(64) } = {}) {
  const rebuild = { network: "livenet", status: "active", active: true, complete: false,
    transactionNormalization: "canonical-raw-tx-only", fromHeight: 948_000,
    bootstrapHeight: 947_999, bootstrapHash: "a".repeat(64),
    indexedThroughBlock: coverageHeight, indexedThroughBlockHash: coverageHash };
  const snapshotId = createHash("sha256").update(JSON.stringify({
    indexedThroughBlock: coverageHeight, indexedThroughBlockHash: coverageHash,
    network: "livenet", source: "block-scan",
  })).digest("hex").slice(0, 24);
  return { rebuild, state: { rebuild, fault: null, requested_hash: hash },
    row: { snapshot_id: snapshotId, checkpoint_height: height, checkpoint_hash: hash,
      coverage_height: coverageHeight, coverage_hash: coverageHash } };
}

test("discovery checkpoint uses an exact partial scan and sealed prefix, independently of node tip", async () => {
  const f = discoveryFixture({ coverageHeight: 1_000_050 });
  let calls = 0;
  const pool = { query: async (sql, params) => {
    calls++;
    if (sql.includes("work_batch_discovery_state")) return { rows: [f.state] };
    assert.match(sql, /scan.snapshot_id = \$3/u);
    assert.match(sql, /state.value = \$2::jsonb/u);
    assert.match(sql, /scan.payload->'complete' = 'false'::jsonb/u);
    assert.match(sql, /block-scan-partial/u);
    assert.match(sql, /checkpoint_seal.opening_state_sha256 = checkpoint_parent.closing_state_sha256/u);
    assert.doesNotMatch(sql, /WITH RECURSIVE|count\(\*\)|ORDER BY|read_work_transition_payload/u);
    assert.deepEqual(params.slice(1), [JSON.stringify(f.rebuild), f.row.snapshot_id,
      1_000_050, "c".repeat(64), 1_000_000, "b".repeat(64), null]);
    return { rows: [f.row] };
  } };
  assert.deepEqual(await readWorkBatchDiscoveryCheckpoint(pool, "livenet", { maximumBlockHeight: 1_000_000 }),
    { blockHeight: 1_000_000, blockHash: "b".repeat(64), complete: true,
      source: "proof-indexer-work-batch-discovery-checkpoint" });
  assert.equal(calls, 2);
});

test("discovery cannot turn missing, malformed, faulted or replaced prefix evidence into an empty result", async () => {
  const f = discoveryFixture();
  for (const mutate of [
    value => { value.rebuild = null; },
    value => { value.rebuild.fromHeight = WORK_BATCH_MIN_DECLARATION_BLOCK_HEIGHT + 1; },
    value => { value.rebuild.bootstrapHeight++; },
    value => { value.rebuild.indexedThroughBlock = "1000000"; },
    value => { value.rebuild.indexedThroughBlockHash = "A".repeat(64); },
    value => { value.rebuild.complete = true; },
    value => { value.rebuild.transactionNormalization = "legacy"; },
    value => { value.fault = { network: "livenet", active: true }; },
    value => { value.fault = { network: "livenet" }; },
    value => { value.rebuild.mode = "pwt-range-replay"; value.rebuild.rangeReplayFromHeight = value.rebuild.indexedThroughBlock + 2; },
  ]) {
    const state = structuredClone(f.state); mutate(state);
    let queries = 0;
    await assert.rejects(() => readWorkBatchDiscoveryCheckpoint({ query: async () => {
      queries++; return { rows: [state] };
    } }, "livenet"), /prefix is unavailable/u);
    assert.equal(queries, 1);
  }
  for (const rows of [[], [{ ...f.row, checkpoint_hash: "d".repeat(64) }], [f.row, f.row]]) {
    const pool = { query: async sql => ({ rows: sql.includes("work_batch_discovery_state") ? [f.state] : rows }) };
    await assert.rejects(() => readWorkBatchDiscoveryCheckpoint(pool, "livenet"), /prefix is unavailable/u);
  }
  await assert.rejects(() => readWorkBatchDiscoveryCheckpoint(null, "livenet"), /prefix is unavailable/u);
});

test("discovery floor has an explicit predeclaration boundary and historical range replay retains original coverage", async () => {
  const height = WORK_BATCH_MIN_DECLARATION_BLOCK_HEIGHT - 1;
  const f = discoveryFixture({ height });
  f.rebuild.mode = "pwt-range-replay"; f.rebuild.rangeReplayFromHeight = 958_383;
  f.rebuild.status = "complete"; f.rebuild.active = false; f.rebuild.complete = true;
  const pool = { query: async sql => ({ rows: sql.includes("work_batch_discovery_state") ? [f.state] : [f.row] }) };
  assert.equal((await readWorkBatchDiscoveryCheckpoint(pool, "livenet")).blockHeight, height);
  await assert.rejects(() => readWorkBatchDiscoveryCheckpoint(pool, "livenet", { maximumBlockHeight: height - 1 }), /prefix is unavailable/u);
  assert.equal(await readWorkBatchDiscoveryCheckpoint(pool, "testnet"), null);
});

test("PostgreSQL reader qualifies partial and historical prefixes and rejects missing or reorged anchors",
  { skip: process.env.WORK_BATCH_SQL_FIXTURE_TEST !== "1" }, async () => {
  const { default: pg } = await import("pg");
  const client = new pg.Client({ connectionString: process.env.POW_INDEX_DATABASE_URL,
    connectionTimeoutMillis: 5000, query_timeout: 6500,
    options: "-c default_transaction_read_only=on -c statement_timeout=5000 -c lock_timeout=1000" });
  const floor = WORK_BATCH_MIN_DECLARATION_BLOCK_HEIGHT;
  const blockHash = height => height.toString(16).padStart(64, "0");
  const stateHash = height => (height + 1_000_000).toString(16).padStart(64, "0");
  const schemas = {
    meta: "key text,value jsonb",
    blocks: "network text,height integer,block_hash text,previous_block_hash text,canonical boolean",
    ledger_snapshots: "network text,snapshot_id text,indexed_through_block integer,source_hashes jsonb,metrics jsonb,consistency jsonb,payload jsonb",
    work_amo_block_transitions: "network text,block_height integer,block_hash text,previous_block_hash text,complete boolean,block_atomic boolean,fee_once boolean,invalid_zero boolean,state_commitment_model text,opening_state_sha256 text,closing_state_sha256 text,payload jsonb",
    op_returns: "network text,txid text,protocol text,payload_text text,payload_hex text,data_bytes integer,vout integer,output_index integer",
    transactions: "network text,txid text,block_hash text,block_height integer,block_index integer,status text",
    tx_outputs: "network text,txid text,address text,value_sats numeric,vout integer",
  };
  function rowsFor(coverageHeight = floor) {
    const hash = blockHash(coverageHeight);
    const f = discoveryFixture({ height: floor, hash: blockHash(floor), coverageHeight, coverageHash: hash });
    const data = Object.fromEntries(Object.keys(schemas).map(name => [name, []]));
    data.meta.push({ key: "canonical:rebuild", value: f.rebuild });
    const checkpoint = { complete: false, indexedThroughBlock: coverageHeight, indexedThroughBlockHash: hash,
      tipHeight: coverageHeight + 20 };
    data.ledger_snapshots.push({ network: "livenet", snapshot_id: f.row.snapshot_id,
      indexed_through_block: coverageHeight, source_hashes: { blockScan: hash },
      metrics: { ...checkpoint }, consistency: { ok: false, status: "block-scan-partial" },
      payload: { ...checkpoint, source: "proof-indexer-block-scan", network: "livenet",
        snapshotId: f.row.snapshot_id, rebuild: f.rebuild } });
    for (let height = floor - 1; height <= coverageHeight; height++) {
      data.blocks.push({ network: "livenet", height, block_hash: blockHash(height),
        previous_block_hash: blockHash(height - 1), canonical: true });
      data.work_amo_block_transitions.push({ network: "livenet", block_height: height,
        block_hash: blockHash(height), previous_block_hash: blockHash(height - 1),
        complete: true, block_atomic: true, fee_once: true, invalid_zero: true,
        state_commitment_model: "canonical-work-amo-sufficient-state-sha256-v1",
        opening_state_sha256: stateHash(height - 1), closing_state_sha256: stateHash(height),
        payload: { transitionChainModel: "canonical-work-amo-raw-transition-chain-sha256-v1",
          transitionChainCommitment: { model: "canonical-work-amo-raw-transition-chain-sha256-v1",
            payloadBytes: 100, sha256: stateHash(height) } } });
    }
    const declaration = workBatchDeclarationCommitment();
    for (const height of [floor - 1, floor]) {
      const txid = stateHash(height);
      data.transactions.push({ network: "livenet", txid, block_hash: blockHash(height),
        block_height: height, block_index: 1, status: "confirmed" });
      data.op_returns.push({ network: "livenet", txid, protocol: "pwm1",
        payload_text: declaration.protocolRecord, payload_hex: Buffer.from(declaration.protocolRecord).toString("hex"),
        data_bytes: declaration.protocolRecordBytes, vout: 1, output_index: 0 });
      data.tx_outputs.push({ network: "livenet", txid, address: "1638Vn6KtmK8p5r4oGvAXq9nmZb1emU1DV",
        value_sats: 546, vout: 0 });
    }
    return data;
  }
  function fixturePool(data, beforeQualification = () => {}) {
    return { query: async (sql, parameters) => {
      if (!sql.includes("work_batch_discovery_state")) beforeQualification(data);
      const ctes = [], values = [...parameters];
      for (const [name, columns] of Object.entries(schemas)) {
        values.push(JSON.stringify(data[name]));
        ctes.push(`fixture_${name} AS MATERIALIZED (SELECT * FROM jsonb_to_recordset($${values.length}::jsonb) AS row(${columns}))`);
        sql = sql.replaceAll(`proof_indexer.${name}`, `fixture_${name}`);
      }
      sql = /\bWITH\b/u.test(sql)
        ? sql.replace(/\bWITH\b/u, `WITH ${ctes.join(",")},`) : `WITH ${ctes.join(",")} ${sql}`;
      return client.query(sql, values);
    } };
  }
  try {
    await client.connect(); await client.query("BEGIN READ ONLY");
    for (const coverage of [floor, floor + 2]) {
      const pool = fixturePool(rowsFor(coverage));
      const checkpoint = await readWorkBatchDiscoveryCheckpoint(pool, "livenet", { maximumBlockHeight: floor });
      assert.equal(checkpoint.blockHeight, floor);
      const page = await readWorkBatchDeclarationCandidates(pool, "livenet", {
        expectedTipHeight: floor, expectedTipHash: blockHash(floor) });
      assert.deepEqual(page.candidates.map(row => row.blockHeight), [floor]);
      assert.equal(page.scan.coverageIndexedThroughBlock, coverage);
      const empty = await readWorkBatchDeclarationCandidates(pool, "livenet", {
        expectedTipHeight: floor, expectedTipHash: blockHash(floor),
        after: { blockHeight: floor, blockTransactionIndex: 2147483647, txid: "f".repeat(64) } });
      assert.equal(empty.complete, true); assert.deepEqual(empty.candidates, []);
    }

    // A retained base, rather than the numerical replay start alone, proves
    // coverage when a later suffix replay retains an earlier declaration.
    for (const complete of [false, true]) {
      for (const coverage of [floor + 1, floor + 3]) {
        const data = rowsFor(coverage);
        const rebuild = data.meta[0].value;
        Object.assign(rebuild, { mode: "pwt-range-replay", rangeReplayFromHeight: floor + 2,
          active: !complete, complete, status: complete ? "complete" : "active" });
        const pool = fixturePool(data);
        assert.equal((await readWorkBatchDiscoveryCheckpoint(pool, "livenet")).blockHeight, coverage);
        const page = await readWorkBatchDeclarationCandidates(pool, "livenet", {
          expectedTipHeight: floor, expectedTipHash: blockHash(floor) });
        assert.deepEqual(page.candidates.map(row => row.blockHeight), [floor]);
      }
    }
    for (const mutate of [
      data => { data.work_amo_block_transitions = data.work_amo_block_transitions.filter(row => row.block_height !== floor + 1); },
      data => { data.work_amo_block_transitions.find(row => row.block_height === floor + 2).opening_state_sha256 = "a".repeat(64); },
      data => { data.blocks.find(row => row.height === floor + 1).canonical = false; },
    ]) {
      const data = rowsFor(floor + 4);
      Object.assign(data.meta[0].value, { mode: "pwt-range-replay", rangeReplayFromHeight: floor + 2 });
      mutate(data);
      await assert.rejects(() => readWorkBatchDiscoveryCheckpoint(fixturePool(data), "livenet"), /prefix is unavailable/u);
    }
    const invalid = [
      data => { data.ledger_snapshots = []; },
      data => { data.ledger_snapshots[0].payload.complete = true; },
      data => { data.ledger_snapshots[0].payload.tipHeight = floor - 1; data.ledger_snapshots[0].metrics.tipHeight = floor - 1; },
      data => { data.work_amo_block_transitions = data.work_amo_block_transitions.filter(row => row.block_height !== floor - 1); },
      data => { data.work_amo_block_transitions[0].closing_state_sha256 = "a".repeat(64); },
      data => { data.blocks.at(-1).canonical = false; },
      data => { data.work_amo_block_transitions.at(-1).complete = false; },
      data => { data.work_amo_block_transitions.at(-1).payload.transitionChainCommitment = null; },
      data => { data.meta = []; },
      data => { data.meta.push({ key: "canonical:fault", value: {} }); },
      data => { data.meta[0].value.indexedThroughBlock++; },
    ];
    for (const [index, mutate] of invalid.entries()) {
      const pool = fixturePool(rowsFor(), mutate);
      await assert.rejects(() => readWorkBatchDiscoveryCheckpoint(pool, "livenet"), /prefix is unavailable/u, "invalid SQL anchor " + index);
    }
    const historical = rowsFor(floor + 2);
    historical.blocks.find(row => row.height === floor).canonical = false;
    await assert.rejects(() => readWorkBatchDeclarationCandidates(fixturePool(historical), "livenet",
      { expectedTipHeight: floor, expectedTipHash: blockHash(floor) }), /prefix is unavailable/u);
    await client.query("ROLLBACK");
  } finally {
    await client.query("ROLLBACK").catch(() => {});
    await client.end().catch(() => {});
  }
});
