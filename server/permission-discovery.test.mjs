import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createHash } from 'node:crypto';
import * as bitcoin from 'bitcoinjs-lib';
import { createPermissionDiscovery, permissionCandidates, permissionCoreBlockWitness, assertPermissionRawBlockCoverage } from './permission-discovery.mjs';
import { createPermissionIndexDiscovery } from './db/permission-reader.mjs';
import { workAmoV5CanonicalPayloadCommitment as commit, WORK_AMO_V5_BLOCK_SEQUENCER_MODEL } from './work-amo-v5.mjs';
import { workAmoV5RawBlockDiscoveryEnvelope } from './work-amo-v5-raw.mjs';
const parent = 'a'.repeat(64), hash = 'b'.repeat(64), txid = 'c'.repeat(64), height = 970492;
function fixture() {
  const part = { payloadHex: Buffer.from('pwm1:m:pwperm1:malformed').toString('hex'), text: 'pwm1:m:pwperm1:malformed', decodeValid: true, protocolVout: 1, scriptPubKeyHex: '6a00' };
  const raw = { txid, protocol: 'pwm1', protocolVout: 1, recordOrdinal: 0, blockTransactionIndex: 2,
    rawRecordParts: [part], payload: { model: 'canonical-raw-protocol-record-v1', rawRecordParts: [part] } };
  const record = { txid, rawCandidate: true, protocol: 'pwm1', position: { blockHeight: height, blockHash: hash, blockTransactionIndex: 2, protocolVout: 1, recordOrdinal: 0 }, rawWitness: raw.payload };
  const descriptor = commit({ completeFullCoreBlock: true, records: [raw] });
  const row = { height, block_hash: hash, previous_block_hash: parent, canonical_height_count: 1,
    complete: true, block_atomic: true, fee_once: true, invalid_zero: true, model: WORK_AMO_V5_BLOCK_SEQUENCER_MODEL,
    protocol_record_count: 1, raw_protocol_candidate_count: 1,
    payload: { replayRecords: [record], replayDescriptorCommitment: commit([record]), blockDescriptorCommitment: descriptor, rawProtocolCandidateCount: 1 } };
  const tx = { txid, blockTransactionIndex: 2, status: { confirmed: true, block_height: height, block_hash: hash } };
  const core = { descriptor, rawProtocolCandidateCount: 1, rawRecords: [{ key: `${txid}:1:0`, protocol: 'pwm1', txIndex: 2, rawWitness: commit(raw.payload) }], transactions: [tx] };
  return { row, raw, core, tx };
}
test('independent block closure includes malformed Permission and every companion ledger record', () => {
  const { row, raw, core, tx } = fixture();
  assert.equal(permissionCandidates([raw]).length, 1);
  assert.deepEqual(assertPermissionRawBlockCoverage(row, core), [tx]);
  for (const mutate of [
    value => { value.payload.replayRecords = []; value.payload.replayDescriptorCommitment = commit([]); value.protocol_record_count = 0; },
    value => { value.payload.replayRecords[0].rawWitness.rawRecordParts[0].text = 'different'; value.payload.replayDescriptorCommitment = commit(value.payload.replayRecords); },
    value => { value.payload.blockDescriptorCommitment = commit({ invented: true }); },
    value => { value.payload.replayRecords[0].position.blockTransactionIndex = 3; value.payload.replayDescriptorCommitment = commit(value.payload.replayRecords); },
    value => { value.raw_protocol_candidate_count = 0; },
  ]) { const changed = structuredClone(row); mutate(changed); assert.throws(() => assertPermissionRawBlockCoverage(changed, core), /Permission/); }
});
test('complete raw serialized envelope binds each physical candidate to the hydrated transaction', () => {
  const transaction = new bitcoin.Transaction();
  const coinbase = Buffer.from('0401020304', 'hex'); transaction.addInput(Buffer.alloc(32), 0xffffffff, 0xffffffff, coinbase);
  const script = bitcoin.script.compile([bitcoin.opcodes.OP_RETURN, Buffer.from('pwm1:m:pwperm1:malformed')]);
  transaction.addOutput(Buffer.from('51', 'hex'), 0n); transaction.addOutput(script, 0n);
  const raw = { txid: transaction.getId(), hex: transaction.toHex(), vin: [{ coinbase: coinbase.toString('hex') }],
    vout: [{ scriptpubkey: '51', value: 0 }, { scriptpubkey: Buffer.from(script).toString('hex'), value: 0 }] };
  const header = Buffer.alloc(80); header.writeInt32LE(1); Buffer.from(parent, 'hex').reverse().copy(header, 4);
  Buffer.from(raw.txid, 'hex').reverse().copy(header, 36); header.writeUInt32LE(1700000000, 68); header.writeUInt32LE(0x1d00ffff, 72);
  const blockHash = Buffer.from(createHash('sha256').update(createHash('sha256').update(header).digest()).digest()).reverse().toString('hex');
  const envelope = workAmoV5RawBlockDiscoveryEnvelope({ blockTransactions: [raw], blockHeaderHex: header.toString('hex'), blockHash, blockHeight: height, previousBlockHash: parent });
  const normalized = { ...raw, status: { confirmed: true, block_height: height, block_hash: blockHash }, blockTransactionIndex: 0 };
  const witness = permissionCoreBlockWitness(envelope, [normalized], { blockHeight: height, blockHash });
  assert.equal(witness.transactions.length, 1); assert.equal(witness.rawRecords.length, 1);
  assert.throws(() => permissionCoreBlockWitness(envelope, [], { blockHeight: height, blockHash }), /incomplete/);
  const changed = structuredClone(normalized); changed.vout[1].scriptpubkey += '51';
  assert.throws(() => permissionCoreBlockWitness(envelope, [changed], { blockHeight: height, blockHash }), /incomplete/);
});
test('discovery checks parent, exact checkpoint, complete rows and caches immutable Core witnesses', async () => {
  const { row, core, tx } = fixture(); let coreReads = 0;
  const discovery = createPermissionDiscovery({ readCoreHash: async observed => observed === height - 1 ? parent : hash,
    readCoreBlock: async () => { coreReads += 1; return core; }, hydratePending: async () => { throw new Error('missing'); },
    readIndex: async (_network, options) => {
      if (!options.verifiedPrefix) await options.onBlock(row);
      return { complete: true, activationHeight: height, activationPreviousBlockHash: parent, indexedThroughBlock: height,
        checkpointHash: hash, blockCount: 1, witnessSha256: 'd'.repeat(64), pendingTxids: ['e'.repeat(64)] };
    } });
  for (let index = 0; index < 2; index += 1) {
    const result = await discovery('livenet', { height, blockHash: hash }, height, parent);
    assert.deepEqual(result.transactions, [tx]); assert.equal(result.coverage.complete, true); assert.equal(result.pendingWarnings.length, 1);
  }
  assert.equal(coreReads, 1);
  await assert.rejects(() => discovery('livenet', { height, blockHash: 'f'.repeat(64) }, height, parent), /canonical/);
});
test('no callback row or a skipped block cannot manufacture complete discovery', async () => {
  for (const skipRow of [true, false]) {
    const { row, core } = fixture();
    const discovery = createPermissionDiscovery({ readCoreHash: async observed => observed === height - 1 ? parent : hash,
      readCoreBlock: async () => core, hydratePending: async () => [], readIndex: async (_network, options) => {
        if (!skipRow) await options.onBlock({ ...row, height: height + 1 });
        return { complete: true, activationHeight: height, activationPreviousBlockHash: parent, indexedThroughBlock: height,
          checkpointHash: hash, blockCount: 1, witnessSha256: 'd'.repeat(64) };
      } });
    await assert.rejects(() => discovery('livenet', { height, blockHash: hash }, height, parent), /coverage|gap/);
  }
});
test('verified parent is a complete zero-grant boundary without scanning before first admission', async () => {
  const discovery = createPermissionDiscovery({ readCoreHash: async () => parent, readCoreBlock: async () => { throw new Error('must not scan'); },
    readIndex: async () => ({ complete: true, activationHeight: height, activationPreviousBlockHash: parent,
      indexedThroughBlock: height - 1, checkpointHash: parent, blockCount: 0, witnessSha256: 'd'.repeat(64) }), hydratePending: async () => [] });
  const result = await discovery('livenet', { height: height - 1, blockHash: parent }, height, parent);
  assert.deepEqual(result.transactions, []); assert.equal(result.coverage.blockCount, 0);
});
test('database discovery is read-only, exact-tip fenced and rejects incomplete transitions', async () => {
  const { row } = fixture(); let released = false;
  const client = { async query(sql) {
    if (sql.includes('permission_verified_prefix_anchor')) return { rows: [{ block_hash: parent }] };
    if (sql.includes('permission_raw_block_coverage')) return { rows: [row] };
    if (sql.includes('permission_pending_candidates')) return { rows: [] };
    return { rows: [] };
  }, release() { released = true; } };
  const pool = { connect: async () => client };
  const readScan = async () => ({ payload: { complete: true, tipHeight: height, indexedThroughBlockHash: hash }, indexed_through_block: height,
    consistency: { ok: true, status: 'block-scan-current' } });
  const readIndex = createPermissionIndexDiscovery({ pool, readScan }); let observed = 0;
  const options = { activationHeight: height, activationPreviousBlockHash: parent, expectedHeight: height, expectedHash: hash,
    onBlock: async () => { observed += 1; } };
  const result = await readIndex('livenet', options);
  assert.equal(result.complete, true); assert.equal(observed, 1); assert.equal(released, true);
  row.complete = false; await assert.rejects(() => readIndex('livenet', options), /incomplete/);
});
