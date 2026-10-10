import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createHash } from 'node:crypto';
import * as bitcoin from 'bitcoinjs-lib';
import { createPermissionDiscovery, permissionCandidates, permissionCoreBlockWitness, assertPermissionRawBlockCoverage } from './permission-discovery.mjs';
import { createPermissionIndexDiscovery } from './db/permission-reader.mjs';
import { workAmoV5CanonicalPayloadCommitment as commit, WORK_AMO_V5_BLOCK_SEQUENCER_MODEL } from './work-amo-v5.mjs';
import { workAmoV5RawBlockDiscoveryEnvelope } from './work-amo-v5-raw.mjs';
const parent = 'a'.repeat(64), hash = 'b'.repeat(64), txid = 'c'.repeat(64), height = 970492;
const digest = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
// Independent fixture encoding of the existing public witness and private
// compact-index chain; production's exported helpers are not used here.
function witnessStep(witness, row) {
  return digest([witness, Number(row.height), row.block_hash,
    row.payload?.blockDescriptorCommitment, row.payload?.replayDescriptorCommitment]);
}
function indexStep(witness, row) {
  return digest([witness, Number(row.height), row.block_hash, row.previous_block_hash, row.model,
    row.complete, row.block_atomic, row.fee_once, row.invalid_zero, Number(row.protocol_record_count),
    Number(row.raw_protocol_candidate_count), row.storage_commitment ?? null,
    row.payload?.blockDescriptorCommitment, row.payload?.replayDescriptorCommitment]);
}
async function replayRows(options, rows, beforeRow = () => {}) {
  let witnessSha256 = options.verifiedPrefix?.witnessSha256 ?? digest(['permission-block-witness-chain-v1',
    'livenet', options.activationHeight, options.activationPreviousBlockHash]);
  let indexWitnessSha256 = options.verifiedPrefix?.indexWitnessSha256 ?? digest(['permission-index-prefix-witness-chain-v1',
    'livenet', options.activationHeight, options.activationPreviousBlockHash]);
  for (const row of rows.filter(row => row.height >= (options.fromHeight ?? options.activationHeight) && row.height <= options.expectedHeight)) {
    await beforeRow(row);
    witnessSha256 = witnessStep(witnessSha256, row); indexWitnessSha256 = indexStep(indexWitnessSha256, row);
    await options.onBlock(row, { height: row.height, blockHash: row.block_hash, witnessSha256, indexWitnessSha256 });
  }
  return { complete: true, activationHeight: options.activationHeight,
    activationPreviousBlockHash: options.activationPreviousBlockHash, indexedThroughBlock: options.expectedHeight,
    checkpointHash: options.expectedHash, blockCount: options.expectedHeight - options.activationHeight + 1,
    witnessSha256, indexWitnessSha256 };
}
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
      return { ...await replayRows(options, [row]), pendingTxids: ['e'.repeat(64)] };
    } });
  for (let index = 0; index < 2; index += 1) {
    const result = await discovery('livenet', { height, blockHash: hash }, height, parent);
    assert.deepEqual(result.transactions, [tx]); assert.equal(result.coverage.complete, true); assert.equal(result.pendingWarnings.length, 1);
  }
  assert.equal(coreReads, 1);
  await assert.rejects(() => discovery('livenet', { height, blockHash: 'f'.repeat(64) }, height, parent), /canonical/);
});
test('pending hydration cannot return authority after the admission deadline and retries reuse only verified confirmed progress', async () => {
  const { row, core, tx } = fixture(); let clock = 0, pendingReads = 0;
  const pendingTxid = 'e'.repeat(64), starts = [];
  const discovery = createPermissionDiscovery({ now: () => clock, readBudgetMs: 10,
    readCoreHash: async observed => observed === height - 1 ? parent : hash,
    readCoreBlock: async () => core,
    readIndex: async (_network, options) => { starts.push(options.fromHeight ?? height);
      return { ...await replayRows(options, [row]), pendingTxids: [pendingTxid] };
    },
    hydratePending: async () => { pendingReads += 1; if (pendingReads === 1) clock = 11;
      return [{ txid: pendingTxid, status: { confirmed: false } }]; } });
  await assert.rejects(() => discovery('livenet', { height, blockHash: hash }, height, parent), /read budget/);
  const result = await discovery('livenet', { height, blockHash: hash }, height, parent);
  assert.deepEqual(starts, [height, height + 1]);
  assert.deepEqual(result.transactions, [tx, { txid: pendingTxid, status: { confirmed: false } }]);
  assert.equal(result.coverage.complete, true);
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
    readIndex: async (_network, options) => replayRows(options, []), hydratePending: async () => [] });
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

function feeBoundaryDiscovery({ observedFeeParent = hash, changeFeeParent = false } = {}) {
  const { row, core } = fixture(), tipHash = 'e'.repeat(64), tipHeight = height + 1;
  const descriptor = commit({ emptyCompleteCoreBlock: tipHeight });
  const finalCore = { descriptor, rawProtocolCandidateCount: 0, rawRecords: [], transactions: [] };
  const finalRow = { ...row, height: tipHeight, block_hash: tipHash, previous_block_hash: hash,
    protocol_record_count: 0, raw_protocol_candidate_count: 0,
    payload: { replayRecords: [], replayDescriptorCommitment: commit([]), blockDescriptorCommitment: descriptor, rawProtocolCandidateCount: 0 } };
  let feeReads = 0, blockReads = 0;
  const discovery = createPermissionDiscovery({ feeRateActivationHeight: height + 1, feeRateActivationPreviousBlockHash: hash,
    readCoreHash: async observed => {
      if (observed === height - 1) return parent;
      if (observed === tipHeight) return tipHash;
      assert.equal(observed, height); feeReads += 1;
      return changeFeeParent && feeReads > 1 ? 'f'.repeat(64) : observedFeeParent;
    },
    readCoreBlock: async observed => { blockReads += 1; return Number(observed.height) === height ? core : finalCore; },
    hydratePending: async () => [],
    readIndex: async (_network, options) => replayRows(options, [row, finalRow]),
  });
  return { discovery, checkpoint: { height: tipHeight, blockHash: tipHash }, feeReads: () => feeReads, blockReads: () => blockReads };
}

test('v2 parent is independently fenced before and after discovery, including cached reads', async () => {
  const { discovery, checkpoint, feeReads, blockReads } = feeBoundaryDiscovery();
  for (let index = 0; index < 2; index += 1) {
    const result = await discovery('livenet', checkpoint, height, parent);
    assert.equal(result.coverage.feeRateAdmissionVerified, true);
    assert.equal(result.coverage.feeRateActivationHeight, height + 1);
    assert.equal(result.coverage.feeRateActivationPreviousBlockHash, hash);
  }
  assert.equal(feeReads(), 4); assert.equal(blockReads(), 2);
  for (const observedFeeParent of [null, 'f'.repeat(64)]) {
    const unavailable = feeBoundaryDiscovery({ observedFeeParent });
    await assert.rejects(() => unavailable.discovery('livenet', unavailable.checkpoint, height, parent), /fee-rate activation parent/);
    assert.equal(unavailable.blockReads(), 0);
  }
  const changing = feeBoundaryDiscovery({ changeFeeParent: true });
  await assert.rejects(() => changing.discovery('livenet', changing.checkpoint, height, parent), error =>
    error.statusCode === 409 && error.details.code === 'PERMISSION_CHECKPOINT_REORG' && /fee-rate activation parent/.test(error.message));
});

test('v1 coverage below the new parent stays available without requesting future Core hashes', async () => {
  const { row, core } = fixture(), observed = [];
  const discovery = createPermissionDiscovery({ feeRateActivationHeight: height + 2, feeRateActivationPreviousBlockHash: 'e'.repeat(64),
    readCoreHash: async requested => { observed.push(requested); assert.ok(requested <= height); return requested === height - 1 ? parent : hash; },
    readCoreBlock: async () => core, hydratePending: async () => [],
    readIndex: async (_network, options) => replayRows(options, [row]),
  });
  const result = await discovery('livenet', { height, blockHash: hash }, height, parent);
  assert.equal(result.coverage.complete, true); assert.equal(result.coverage.feeRateAdmissionVerified, false);
  assert.equal(result.transactions.length, 1); assert.deepEqual(observed, [height - 1, height, height - 1, height]);
});

test('the v2 parent at the exact checkpoint reuses its independently read hash', async () => {
  const { row, core } = fixture(), observed = [];
  const discovery = createPermissionDiscovery({ feeRateActivationHeight: height + 1, feeRateActivationPreviousBlockHash: hash,
    readCoreHash: async requested => { observed.push(requested); return requested === height - 1 ? parent : hash; },
    readCoreBlock: async () => core, hydratePending: async () => [],
    readIndex: async (_network, options) => replayRows(options, [row]),
  });
  const result = await discovery('livenet', { height, blockHash: hash }, height, parent);
  assert.equal(result.coverage.feeRateAdmissionVerified, true);
  assert.deepEqual(observed, [height - 1, height, height - 1, height]);
});

function chain(count = 4) {
  const rows = [], cores = new Map(), transactions = [];
  for (let index = 0; index < count; index += 1) {
    const current = fixture(), blockHeight = height + index;
    const blockHash = createHash('sha256').update(`permission-block-${index}`).digest('hex');
    const id = createHash('sha256').update(`permission-carrier-${index}`).digest('hex');
    current.raw.txid = id;
    current.tx.txid = id; current.tx.status = { confirmed: true, block_height: blockHeight, block_hash: blockHash };
    const record = current.row.payload.replayRecords[0]; record.txid = id;
    record.position.blockHeight = blockHeight; record.position.blockHash = blockHash;
    current.row.height = blockHeight; current.row.block_hash = blockHash;
    current.row.previous_block_hash = rows.at(-1)?.block_hash ?? parent;
    current.row.payload.blockDescriptorCommitment = commit({ completeFullCoreBlock: true, records: [current.raw] });
    current.row.payload.replayDescriptorCommitment = commit([record]);
    current.core.descriptor = current.row.payload.blockDescriptorCommitment;
    current.core.rawRecords[0].key = `${id}:1:0`;
    rows.push(current.row); cores.set(blockHash, current.core); transactions.push(current.tx);
  }
  return { rows, cores, transactions, checkpoint: { height: rows.at(-1).height, blockHash: rows.at(-1).block_hash },
    coreHash: async observed => observed === height - 1 ? parent : rows.find(row => row.height === observed)?.block_hash };
}

test('budget-failed requests resume verified whole blocks without exposing partial authority or duplicating carriers', async () => {
  const f = chain(), starts = [], served = [], coreReads = [];
  let clock = 0;
  const discovery = createPermissionDiscovery({ readBudgetMs: 7, now: () => clock,
    readCoreHash: f.coreHash, hydratePending: async () => [],
    readCoreBlock: async row => { coreReads.push(row.height); clock += 1; return f.cores.get(row.block_hash); },
    readIndex: async (_network, options) => {
      starts.push(options.fromHeight ?? height);
      assert.equal(options.maxPrefixBytes, 64 * 1024 * 1024);
      return replayRows(options, f.rows, row => { served.push(row.height); clock += 3; });
    } });
  for (let index = 0; index < 2; index += 1) await assert.rejects(
    () => discovery('livenet', f.checkpoint, height, parent), error => error.statusCode === 503 && /read budget/.test(error.message));
  const result = await discovery('livenet', f.checkpoint, height, parent);
  assert.deepEqual(starts, [height, height + 1, height + 3]);
  assert.deepEqual(coreReads, [height, height + 1, height + 2, height + 3]);
  assert.deepEqual(result.transactions, f.transactions);
  assert.equal(new Set(result.transactions.map(tx => tx.txid)).size, 4);
  assert.equal(result.coverage.complete, true);
  assert.equal(result.coverage.indexWitnessSha256, undefined);
  const full = await replayRows({ activationHeight: height, activationPreviousBlockHash: parent,
    expectedHeight: f.checkpoint.height, expectedHash: f.checkpoint.blockHash, onBlock: async () => {} }, f.rows);
  assert.equal(result.coverage.witnessSha256, full.witnessSha256);
  assert.equal(served.filter(observed => observed === height).length, 1);
});

test('a late Core result does not advance tentative progress and returned transactions cannot mutate the cache', async () => {
  const f = chain(1), starts = []; let clock = 0, reads = 0;
  const discovery = createPermissionDiscovery({ readBudgetMs: 10, now: () => clock, readCoreHash: f.coreHash,
    hydratePending: async () => [], readCoreBlock: async row => { reads += 1; clock = 11; return f.cores.get(row.block_hash); },
    readIndex: async (_network, options) => { starts.push(options.fromHeight ?? height); return replayRows(options, f.rows); } });
  await assert.rejects(() => discovery('livenet', f.checkpoint, height, parent), /read budget/);
  const result = await discovery('livenet', f.checkpoint, height, parent);
  assert.deepEqual(starts, [height, height]); assert.equal(reads, 1);
  result.transactions[0].txid = 'f'.repeat(64); result.transactions[0].status.confirmed = false;
  const next = await discovery('livenet', f.checkpoint, height, parent);
  assert.deepEqual(next.transactions, f.transactions);
  assert.equal(starts.at(-1), height + 1);
});

test('forged progress and final witness chains cannot manufacture complete discovery', async () => {
  const f = chain(1);
  for (const change of [{ height: height + 1 }, { blockHash: 'f'.repeat(64) },
    { witnessSha256: 'f'.repeat(64) }, { indexWitnessSha256: 'f'.repeat(64) }]) {
    let calls = 0;
    const discovery = createPermissionDiscovery({ readCoreHash: f.coreHash, readCoreBlock: async row => f.cores.get(row.block_hash),
      hydratePending: async () => [], readIndex: async (_network, options) => {
        calls += 1; assert.equal(options.verifiedPrefix, undefined);
        return replayRows({ ...options, onBlock: (row, progress) => options.onBlock(row, { ...progress, ...change }) }, f.rows);
      } });
    for (let attempt = 0; attempt < 2; attempt += 1) await assert.rejects(
      () => discovery('livenet', f.checkpoint, height, parent), /verified progress/);
    assert.equal(calls, 2);
  }
  for (const field of ['witnessSha256', 'indexWitnessSha256']) {
    const discovery = createPermissionDiscovery({ readCoreHash: f.coreHash, readCoreBlock: async row => f.cores.get(row.block_hash),
      hydratePending: async () => [], readIndex: async (_network, options) => ({ ...await replayRows(options, f.rows), [field]: 'f'.repeat(64) }) });
    await assert.rejects(() => discovery('livenet', f.checkpoint, height, parent), /complete exact checkpoint/);
  }
});

test('reorged prefix and regressing queued targets cannot silently retain or replace another branch', async () => {
  const f = chain(2), starts = []; let changed = false;
  const originalHash = f.rows[0].block_hash;
  const discovery = createPermissionDiscovery({ readCoreHash: async observed => f.coreHash(observed),
    readCoreBlock: async row => f.cores.get(row.block_hash), hydratePending: async () => [],
    readIndex: async (_network, options) => { starts.push(options.fromHeight ?? height); return replayRows(options, f.rows); } });
  await discovery('livenet', f.checkpoint, height, parent);
  const oldCore = structuredClone(f.cores.get(originalHash));
  // Replace the complete branch, including all committed positions.
  for (const row of f.rows) {
    const replacement = createHash('sha256').update(`fork-${row.height}`).digest('hex');
    const core = structuredClone(f.cores.get(row.block_hash));
    row.block_hash = replacement; row.previous_block_hash = changed ? f.rows[0].block_hash : parent; changed = true;
    row.payload.replayRecords[0].position.blockHash = replacement;
    row.payload.replayDescriptorCommitment = commit(row.payload.replayRecords);
    core.transactions[0].status.block_hash = replacement;
    f.cores.set(replacement, core);
  }
  f.checkpoint.blockHash = f.rows.at(-1).block_hash;
  await discovery('livenet', f.checkpoint, height, parent);
  assert.deepEqual(starts, [height, height]);
  assert.equal(oldCore.transactions[0].status.block_hash, originalHash);
  // Reading an older target does not downgrade the private newer prefix.
  await discovery('livenet', { height, blockHash: f.rows[0].block_hash }, height, parent);
  await discovery('livenet', f.checkpoint, height, parent);
  assert.deepEqual(starts.slice(-2), [height, height + 2]);
});

test('same-checkpoint callers coalesce while different checkpoints serialize inside their original read deadline', async () => {
  const f = chain(2); let release, entered;
  const gate = new Promise(resolve => { release = resolve; });
  const opened = new Promise(resolve => { entered = resolve; });
  let clock = 0, active = 0, peak = 0, indexReads = 0, hashReads = 0;
  const discovery = createPermissionDiscovery({ readBudgetMs: 10, now: () => clock,
    readCoreHash: async observed => { hashReads += 1; return f.coreHash(observed); },
    readCoreBlock: async row => f.cores.get(row.block_hash), hydratePending: async () => [],
    readIndex: async (_network, options) => {
      indexReads += 1; active += 1; peak = Math.max(peak, active); entered();
      try { await gate; return await replayRows(options, f.rows); } finally { active -= 1; }
    } });
  const firstTip = { height, blockHash: f.rows[0].block_hash };
  const first = discovery('livenet', firstTip, height, parent);
  const same = discovery('livenet', { ...firstTip }, height, parent);
  const second = discovery('livenet', f.checkpoint, height, parent);
  const results = Promise.allSettled([first, same, second]);
  await opened; assert.equal(indexReads, 1); assert.equal(hashReads, 2);
  clock = 11; release();
  for (const result of await results) { assert.equal(result.status, 'rejected'); assert.match(result.reason.message, /read budget/); }
  assert.equal(indexReads, 1); assert.equal(hashReads, 2); assert.equal(peak, 1);
  const successful = await discovery('livenet', f.checkpoint, height, parent);
  assert.deepEqual(successful.transactions, f.transactions); assert.equal(indexReads, 2);
});

test('projection and immutable Core byte caps never publish an over-budget prefix', async () => {
  const f = chain(1);
  for (const limits of [{ maxProjectionBytes: 1 }, { maxCacheBytes: 1 }]) {
    const starts = [];
    const discovery = createPermissionDiscovery({ ...limits, readCoreHash: f.coreHash,
      readCoreBlock: async row => f.cores.get(row.block_hash), hydratePending: async () => [],
      readIndex: async (_network, options) => { starts.push(options.fromHeight ?? height); return replayRows(options, f.rows); } });
    for (let attempt = 0; attempt < 2; attempt += 1) await assert.rejects(
      () => discovery('livenet', f.checkpoint, height, parent), /byte budget/);
    assert.deepEqual(starts, [height, height]);
  }
});
