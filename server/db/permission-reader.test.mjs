import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createPermissionIndexDiscovery } from './permission-reader.mjs';
import { WORK_AMO_V8_BLOCK_SEQUENCER_MODEL } from '../work-amo-v8.mjs';
const height = 970492, hash = 'b'.repeat(64), parent = 'c'.repeat(64);
function fixture({ native = false, changes = {}, finalChanges = {}, rows, anchor = parent } = {}) {
  const queries = [], block = { height, block_hash: hash, previous_block_hash: parent, canonical_height_count: 1,
    complete: true, block_atomic: true, fee_once: true, invalid_zero: true, model: WORK_AMO_V8_BLOCK_SEQUENCER_MODEL,
    payload: { replayRecords: [], replayDescriptorCommitment: {}, blockDescriptorCommitment: {}, rawProtocolCandidateCount: 0 } };
  let released = false, scanCount = 0;
  const client = { async query(sql) {
    queries.push(sql);
    if (sql.includes('permission_transition_storage_accessor')) return { rows: [{ present: native }] };
    if (sql.includes('permission_verified_prefix_anchor')) return { rows: [{ block_hash: anchor }] };
    if (sql.includes('permission_raw_block_coverage')) return { rows: rows ?? [block] };
    if (sql.includes('permission_pending_candidates')) return { rows: [] };
    return { rows: [] };
  }, release() { released = true; } };
  const pool = { connect: async () => client };
  const readScan = async () => ({ payload: { complete: true, tipHeight: height, indexedThroughBlockHash: hash }, indexed_through_block: height,
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
