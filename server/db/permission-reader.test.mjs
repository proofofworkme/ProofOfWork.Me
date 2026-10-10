import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createPermissionIndexDiscovery } from './permission-reader.mjs';
import { WORK_AMO_V8_BLOCK_SEQUENCER_MODEL } from '../work-amo-v8.mjs';
const height = 970492, hash = 'b'.repeat(64), parent = 'c'.repeat(64);
function fixture({ native = false, changes = {}, finalChanges = {}, rows, prefixRows, anchor = parent,
  tipHeight = height, tipHash = hash } = {}) {
  const queries = [], block = { height, block_hash: hash, previous_block_hash: parent, canonical_height_count: 1,
    complete: true, block_atomic: true, fee_once: true, invalid_zero: true, model: WORK_AMO_V8_BLOCK_SEQUENCER_MODEL,
    protocol_record_count: 0, raw_protocol_candidate_count: 0, storage_commitment: null,
    payload: { replayRecords: [], replayDescriptorCommitment: {}, blockDescriptorCommitment: {}, rawProtocolCandidateCount: 0 } };
  let released = false, scanCount = 0;
  const client = { async query(sql) {
    queries.push(sql);
    if (sql.includes('permission_transition_storage_accessor')) return { rows: [{ present: native }] };
    if (sql.includes('permission_verified_prefix_anchor')) return { rows: [{ block_hash: anchor }] };
    if (sql.includes('permission_verified_prefix_coverage')) return { rows: prefixRows ?? [block] };
    if (sql.includes('permission_raw_block_coverage')) return { rows: rows ?? [block] };
    if (sql.includes('permission_pending_candidates')) return { rows: [] };
    return { rows: [] };
  }, release() { released = true; } };
  const pool = { connect: async () => client };
  const readScan = async () => ({ payload: { complete: true, tipHeight, indexedThroughBlockHash: tipHash }, indexed_through_block: tipHeight,
    consistency: { ok: true, status: 'block-scan-current' }, ...changes, ...(scanCount++ > 0 ? finalChanges : {}) });
  return { block, queries, readIndex: createPermissionIndexDiscovery({ pool, readScan }), released: () => released };
}
const options = { activationHeight: height, activationPreviousBlockHash: parent, expectedHeight: height, expectedHash: hash, onBlock: async () => {} };
test('stock and accepted native transition storage use their complete witness source', async () => {
  for (const native of [false, true]) {
    const { readIndex, queries, released } = fixture({ native });
    const result = await readIndex('livenet', options);
    assert.equal(result.complete, true); assert.equal(result.blockCount, 1); assert.equal(released(), true);
    assert.ok(queries[0].includes('REPEATABLE READ READ ONLY'));
    const sql = queries.find(query => query.includes('permission_raw_block_coverage'));
    assert.equal(sql.includes('read_work_transition_payload_v1('), native);
    assert.equal(sql.includes("witness.payload->'replayRecords'"), native);
    assert.ok(queries.includes('COMMIT'));
    assert.equal(queries.some(query => /\b(?:INSERT|UPDATE|DELETE)\b/u.test(query)), false);
  }
});
test('partial or changing scan checkpoints fail closed and release the SQL connection', async () => {
  for (const change of [{ consistency: { ok: false } }, { indexed_through_block: height - 1 }, { payload: { complete: true, tipHeight: height, indexedThroughBlockHash: parent } }]) {
    const { readIndex, released } = fixture({ changes: change });
    await assert.rejects(() => readIndex('livenet', options), /exact Core checkpoint/); assert.equal(released(), true);
    const changing = fixture({ finalChanges: change });
    await assert.rejects(() => changing.readIndex('livenet', options), /changed during/); assert.equal(changing.released(), true);
  }
});
test('gaps, forked parents, incomplete transitions and unsupported models cannot authorize an empty corpus', async () => {
  const gap = fixture({ rows: [] }); await assert.rejects(() => gap.readIndex('livenet', options), /gap/);
  const anchor = fixture({ anchor: hash }); await assert.rejects(() => anchor.readIndex('livenet', options), /parent/);
  for (const field of ['complete', 'block_atomic', 'fee_once', 'invalid_zero']) {
    const value = fixture(); value.block[field] = false; await assert.rejects(() => value.readIndex('livenet', options), /incomplete/);
  }
  const wrongModel = fixture(); wrongModel.block.model = 'invented'; await assert.rejects(() => wrongModel.readIndex('livenet', options), /incomplete/);
  const fork = fixture(); fork.block.previous_block_hash = hash; await assert.rejects(() => fork.readIndex('livenet', options), /noncontiguous/);
});

const digest = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
function prefixProof(row) {
  const witness = digest(['permission-block-witness-chain-v1', 'livenet', height, parent]);
  const indexWitness = digest(['permission-index-prefix-witness-chain-v1', 'livenet', height, parent]);
  return { height: Number(row.height), blockHash: row.block_hash,
    witnessSha256: digest([witness, Number(row.height), row.block_hash,
      row.payload.blockDescriptorCommitment, row.payload.replayDescriptorCommitment]),
    indexWitnessSha256: digest([indexWitness, Number(row.height), row.block_hash, row.previous_block_hash, row.model,
      row.complete, row.block_atomic, row.fee_once, row.invalid_zero, Number(row.protocol_record_count),
      Number(row.raw_protocol_candidate_count), row.storage_commitment ?? null,
      row.payload.blockDescriptorCommitment, row.payload.replayDescriptorCommitment]) };
}

test('each accepted callback receives exact independent rolling witnesses before complete coverage', async () => {
  const f = fixture(); let callback;
  const expected = prefixProof(f.block);
  const result = await f.readIndex('livenet', { ...options, onBlock: async (row, progress) => {
    assert.equal(row, f.block); callback = progress; assert.equal(f.queries.includes('COMMIT'), false);
  } });
  assert.deepEqual(callback, expected);
  assert.equal(result.witnessSha256, expected.witnessSha256);
  assert.equal(result.indexWitnessSha256, expected.indexWitnessSha256);
});

test('resumption reauthenticates the complete compact prefix without reconstructing prior native bodies', async () => {
  for (const native of [false, true]) {
    const f = fixture({ native, anchor: hash });
    if (native) f.block.storage_commitment = { model: 'proof-indexer-native-transition-chunks-v1', sha256: 'd'.repeat(64) };
    const proof = prefixProof(f.block);
    const result = await f.readIndex('livenet', { ...options, fromHeight: height + 1, verifiedPrefix: proof,
      onBlock: async () => { throw new Error('Already verified prefix must not repeat raw comparisons.'); } });
    assert.equal(result.complete, true); assert.equal(result.witnessSha256, proof.witnessSha256);
    assert.equal(result.indexWitnessSha256, proof.indexWitnessSha256);
    const sql = f.queries.find(sql => sql.includes('permission_verified_prefix_coverage'));
    assert.ok(sql.includes("transition.payload->'__powNativeStorage'"));
    assert.ok(sql.includes("transition.payload->'replayDescriptorCommitment'"));
    assert.equal(sql.includes('read_work_transition_payload_v1'), false);
    assert.equal(sql.includes('replayRecords'), false);
    assert.equal(f.queries.some(sql => sql.includes('permission_raw_block_coverage')), false);
    assert.equal(f.released(), true);
  }
});

test('accepted externalized native shape preserves the same descriptors in reconstructed and compact rows', async () => {
  // Bind this shape fixture to the accepted native contract, rather than
  // presenting the same full payload as both accessor and compact SQL rows.
  // Immutable test-only snapshot of the accepted audit31 native storage SQL;
  // its original deployment-candidate annotation is retained as historical evidence.
  const nativeSql = readFileSync(new URL('./fixtures/native-runtime-storage-v2.sql', import.meta.url), 'utf8');
  assert.equal(createHash('sha256').update(nativeSql).digest('hex'),
    '01a95d76c606dad1dc9c3f40b9ea6002f7e8ad408c984536b8eb90b8594f9c16');
  const metadata = nativeSql.match(/CREATE FUNCTION proof_indexer\.work_transition_metadata_v1\(p jsonb\)[\s\S]*?p-ARRAY\[([^\]]+)\]/u);
  assert.ok(metadata);
  const removed = [...metadata[1].matchAll(/'([^']+)'/gu)].map(match => match[1]);
  assert.deepEqual(removed, ['openingSufficientState', 'closingSufficientState', 'closingTokenState',
    'closingIdState', 'closingGenericTokenState', 'closingWorkProjection']);
  assert.ok(nativeSql.includes("work_transition_metadata_v1(original) IS DISTINCT FROM p-'__powNativeStorage'"));
  const original = { blockDescriptorCommitment: { model: 'fixture-block', sha256: '1'.repeat(64) },
    replayDescriptorCommitment: { model: 'fixture-replay', sha256: '2'.repeat(64) },
    replayRecords: [{ fixtureRawBody: 'Retained in the reconstructed witness, omitted by compact projection.' }],
    rawProtocolCandidateCount: 0,
    ...Object.fromEntries(removed.map(field => [field, { fixtureState: field }])) };
  const inline = { ...original };
  for (const field of removed) delete inline[field];
  inline.__powNativeStorage = { model: 'proof-indexer-native-transition-chunks-v1', sha256: 'd'.repeat(64) };
  assert.equal(Object.hasOwn(inline, 'openingSufficientState'), false);
  assert.deepEqual(inline.blockDescriptorCommitment, original.blockDescriptorCommitment);
  assert.deepEqual(inline.replayDescriptorCommitment, original.replayDescriptorCommitment);
  const common = fixture().block;
  const rawRow = { ...common, storage_commitment: inline.__powNativeStorage,
    payload: { replayRecords: original.replayRecords, rawProtocolCandidateCount: original.rawProtocolCandidateCount,
      blockDescriptorCommitment: original.blockDescriptorCommitment, replayDescriptorCommitment: original.replayDescriptorCommitment } };
  const compactRow = { ...common, storage_commitment: inline.__powNativeStorage,
    payload: { blockDescriptorCommitment: inline.blockDescriptorCommitment, replayDescriptorCommitment: inline.replayDescriptorCommitment } };
  assert.notDeepEqual(rawRow.payload, compactRow.payload);
  const initial = fixture({ native: true, rows: [rawRow] }); let progress;
  await initial.readIndex('livenet', { ...options, onBlock: async (row, value) => {
    assert.deepEqual(row.payload.replayRecords, original.replayRecords); progress = value;
  } });
  const resumed = fixture({ native: true, anchor: hash, prefixRows: [compactRow] });
  const result = await resumed.readIndex('livenet', { ...options, fromHeight: height + 1,
    verifiedPrefix: progress, onBlock: async () => { throw new Error('Native body must not be reconstructed on compact retry.'); } });
  assert.equal(result.witnessSha256, progress.witnessSha256);
  assert.equal(result.indexWitnessSha256, progress.indexWitnessSha256);
  assert.equal(resumed.queries.some(sql => sql.includes('permission_raw_block_coverage')), false);
});

test('changed prefix descriptor, native commitment, count or canonical anchor fails before a tail callback', async () => {
  for (const mutate of [
    row => { row.payload.blockDescriptorCommitment = { changed: true }; },
    row => { row.payload.replayDescriptorCommitment = { changed: true }; },
    row => { row.storage_commitment = { model: 'proof-indexer-native-transition-chunks-v1', sha256: 'f'.repeat(64) }; },
    row => { row.protocol_record_count = 1; },
    row => { row.raw_protocol_candidate_count = 1; },
    row => { row.complete = false; },
    row => { row.previous_block_hash = 'e'.repeat(64); },
  ]) {
    const f = fixture({ anchor: hash }), proof = prefixProof(f.block); mutate(f.block);
    await assert.rejects(() => f.readIndex('livenet', { ...options, fromHeight: height + 1, verifiedPrefix: proof,
      onBlock: async () => { throw new Error('Must refuse before tail.'); } }), /prefix witness|incomplete or noncontiguous/);
    assert.equal(f.released(), true); assert.ok(f.queries.includes('ROLLBACK')); assert.equal(f.queries.includes('COMMIT'), false);
  }
  const f = fixture(), proof = prefixProof(f.block);
  await assert.rejects(() => f.readIndex('livenet', { ...options, fromHeight: height + 1, verifiedPrefix: proof }), /parent\/prefix/);
});

test('prefix gaps, forged hashes and missing private witness cannot bypass verification', async () => {
  const f = fixture({ anchor: hash }), proof = prefixProof(f.block);
  for (const field of ['witnessSha256', 'indexWitnessSha256']) {
    await assert.rejects(() => f.readIndex('livenet', { ...options, fromHeight: height + 1,
      verifiedPrefix: { ...proof, [field]: 'f'.repeat(64) } }), /prefix witness/);
  }
  const missing = { ...proof }; delete missing.indexWitnessSha256;
  await assert.rejects(() => f.readIndex('livenet', { ...options, fromHeight: height + 1, verifiedPrefix: missing }), /exact canonical coverage/);
  const gap = fixture({ anchor: hash, prefixRows: [] });
  await assert.rejects(() => gap.readIndex('livenet', { ...options, fromHeight: height + 1, verifiedPrefix: proof }), /prefix has a gap/);
});

test('prefix metadata byte and deadline limits refuse, roll back and release before authority', async () => {
  const f = fixture({ anchor: hash }), proof = prefixProof(f.block);
  await assert.rejects(() => f.readIndex('livenet', { ...options, fromHeight: height + 1, verifiedPrefix: proof,
    maxPrefixBytes: 1 }), /metadata reached its byte budget/);
  assert.equal(f.released(), true); assert.ok(f.queries.includes('ROLLBACK'));
  const expired = fixture({ anchor: hash });
  await assert.rejects(() => expired.readIndex('livenet', { ...options, fromHeight: height + 1, verifiedPrefix: proof,
    checkBudget() { if (expired.queries.some(sql => sql.includes('permission_verified_prefix_coverage'))) throw new Error('Fixture read deadline'); } }), /read deadline/);
  assert.equal(expired.released(), true); assert.ok(expired.queries.includes('ROLLBACK'));
  assert.equal(expired.queries.includes('COMMIT'), false);
});

test('a rejected callback never returns complete coverage and leaves the read-only connection released', async () => {
  const f = fixture();
  await assert.rejects(() => f.readIndex('livenet', { ...options, onBlock: async () => { throw new Error('Fixture catch-up budget'); } }), /catch-up budget/);
  assert.equal(f.released(), true); assert.ok(f.queries.includes('ROLLBACK'));
  assert.equal(f.queries.includes('COMMIT'), false);
});
