import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import * as bitcoin from 'bitcoinjs-lib';
import { JOBS_ACTIVATION_HEIGHT, JOBS_ACTIVATION_PREVIOUS_BLOCK_HASH } from '../src/shared/protocol/jobs.mjs';
import { JOBS_DISCOVERY_MODEL, JOBS_DISCOVERY_EMPTY_SHA256, advanceJobsCandidateDigest, isJobsCandidatePart } from './jobs.mjs';
import { prefilterCodeRawBlock, assertCodeRawBlockCandidatesMatch } from './code-repositories.mjs';
import { canonicalProtocolCandidateFromOutput } from './canonical-op-return.mjs';
const marker = Buffer.from('pwm1:m:pwj1:');
const jobScript = Buffer.concat([Buffer.from([0x6a, marker.length]), marker]).toString('hex');
const discoveryParent = JOBS_ACTIVATION_PREVIOUS_BLOCK_HASH;
function discoveryFixture(scripts = ['51'], { witness = false, previous = discoveryParent, height = JOBS_ACTIVATION_HEIGHT, nonce = 0 } = {}) {
  const make = coinbase => {
    const tx = new bitcoin.Transaction(); tx.version = 2;
    tx.addInput(Buffer.alloc(32, coinbase ? 0 : 0x55), coinbase ? 0xffffffff : 0, undefined, Buffer.from([1, 1]));
    return tx;
  };
  const coinbase = make(true); coinbase.addOutput(Buffer.from('51', 'hex'), 0n);
  const source = make(false);
  for (const hex of scripts) source.addOutput(Buffer.from(hex, 'hex'), 0n);
  const transactions = [coinbase, source];
  if (witness) {
    coinbase.setWitness(0, [Buffer.alloc(32)]); source.setWitness(0, [Buffer.from('pwc1: witness noise')]);
    coinbase.addOutput(Buffer.concat([Buffer.from('6a24aa21a9ed', 'hex'), Buffer.from(bitcoin.Block.calculateMerkleRoot(transactions, true))]), 0n);
  }
  const block = new bitcoin.Block(); block.prevHash = Buffer.from(previous, 'hex').reverse();
  block.timestamp = 123456; block.bits = 0x1d00ffff; block.nonce = nonce; block.transactions = transactions;
  block.merkleRoot = bitcoin.Block.calculateMerkleRoot(transactions);
  const decoded = { hash: block.getId(), height, previousblockhash: previous, time: block.timestamp, nTx: transactions.length,
    tx: transactions.map(tx => ({ txid: tx.getId(), hex: tx.toHex(), vout: tx.outs.map(out => ({ value: 0, scriptPubKey: { hex: Buffer.from(out.script).toString('hex') } })) })) };
  return { raw: block.toHex(), blockHash: block.getId(), previousBlockHash: previous, decoded };
}
function discoverySummary(fixture) { return prefilterCodeRawBlock(fixture.raw, fixture); }

// Execute the actual bootstrap function with a mock Core/database boundary;
// importing the executable indexer would launch its real CLI and is forbidden.
const discoveryIndexerSource = readFileSync(new URL('../scripts/backfill-proof-indexer.mjs', import.meta.url), 'utf8');
function indexerFunction(start, next) { return discoveryIndexerSource.slice(discoveryIndexerSource.indexOf(start), discoveryIndexerSource.indexOf(next)); }
const actualBootstrapFunctions = [
  indexerFunction('function assertCanonicalBlockEnvelope(', '\nfunction protocolMessagesFromTx('),
  indexerFunction('function protocolMessagesFromTx(', '\nfunction protocolMessagesContainInceptionBond('),
  indexerFunction('async function bootstrapJobsCandidates(', '\nasync function latestBlockScanCheckpoint('),
].join('\n');
function discoveryHarness(fixtures, { budget = 1000, sealClosed = true, reorg = false, mutateDecoded, targetCheckpoint, canonicalTarget = true } = {}) {
  const state = { marker: null, stored: [], calls: [], hydrated: [], sealed: [], raw: [], blocks: [], hashReads: new Map(), budget, sealClosed, reorg };
  const target = fixtures.at(-1); let pendingMarker, inTransaction = false;
  const client = { query: async (sql, params) => {
    state.calls.push(['sql', sql]);
    if (sql.includes('pg_try_advisory_lock')) return { rows: [{ locked: true }] };
    if (sql.startsWith('SELECT height,block_hash')) {
      const checkpoint = targetCheckpoint ?? { height: target.decoded.height, blockHash: target.blockHash };
      return { rows: canonicalTarget ? [{ height: checkpoint.height, block_hash: checkpoint.blockHash }] : [] };
    }
    if (sql.startsWith('SELECT txid,raw_tx')) return { rows: state.raw.map(tx => ({ txid: tx.txid, raw_tx: tx,
      block_height: tx.height, block_hash: tx._powBlockHash, block_index: tx._powBlockIndex })) };
    if (sql === 'BEGIN') inTransaction = true;
    if (sql === 'COMMIT') { if (pendingMarker) { state.marker = pendingMarker; state.stored.push(pendingMarker); } pendingMarker = undefined; inTransaction = false; }
    if (sql === 'ROLLBACK') { pendingMarker = undefined; inTransaction = false; }
    return { rows: [] };
  } };
  const context = {
    process: { env: { POW_INDEX_JOBS_BOOTSTRAP_MAX_BLOCKS: String(budget) } }, NETWORK: 'livenet',
    WORK_AMO_V5_ACTIVATION_HEIGHT: 1, JOBS_DISCOVERY_META_KEY: 'jobs:candidate-discovery', JOBS_DISCOVERY_MODEL,
    JOBS_DISCOVERY_EMPTY_SHA256, advanceJobsCandidateDigest, prefilterCodeRawBlock, assertCodeRawBlockCandidatesMatch, isJobsCandidatePart,
    JOBS_ACTIVATION_HEIGHT, JOBS_ACTIVATION_PREVIOUS_BLOCK_HASH, Buffer,
    canonicalProtocolCandidateFromOutput, isHexTxid: value => /^[0-9a-f]{64}$/u.test(value),
    latestBlockScanCheckpoint: async () => targetCheckpoint ?? ({ height: target.decoded.height, blockHash: target.blockHash }),
    proofIndexerMetaValue: async () => state.marker,
    storeProofIndexerMeta: async (_client, _key, marker) => {
      if (inTransaction) pendingMarker = marker;
      else { state.marker = marker; state.stored.push(marker); }
    },
    bitcoinRpc: async (method, params) => {
      state.calls.push([method, ...params]);
      if (method === 'getblockhash') {
        const height = params[0]; const reads = (state.hashReads.get(height) ?? 0) + 1; state.hashReads.set(height, reads);
        if (height === JOBS_ACTIVATION_HEIGHT - 1) return discoveryParent;
        const fixture = fixtures.find(row => row.decoded.height === height);
        return state.reorg && height === JOBS_ACTIVATION_HEIGHT && reads > 2 ? 'ff'.repeat(32) : fixture.blockHash;
      }
      if (method === 'getblock') {
        const fixture = fixtures.find(row => row.blockHash === params[0]);
        if (params[1] === 0) return fixture.raw;
        const block = structuredClone(fixture.decoded); mutateDecoded?.(block); return block;
      }
      throw new Error('Unexpected RPC');
    },
    transactionWithInputPrevouts: async tx => { state.hydrated.push(tx); return tx; },
    storedJobsCandidateEventClosure: async (_client, tx, position) => { state.sealed.push({ tx, position }); return state.sealClosed; },
    persistCanonicalBlock: async (_client, block) => state.blocks.push(block),
    persistCanonicalRawTransaction: async (_client, tx) => state.raw.push(tx),
    persistPreparedProtocolItems: async () => {}, protocolItemsFromTx: () => [],
  };
  const bootstrap = runInNewContext(actualBootstrapFunctions + '\nbootstrapJobsCandidates;', context);
  return { state, run: () => bootstrap(client) };
}

test('actual discovery negatives skip only getblock2 and retain canonical hash recheck/marker', async () => {
  const fixture = discoveryFixture(['51'], { witness: true }); const harness = discoveryHarness([fixture]);
  const result = await harness.run();
  assert.deepEqual(harness.state.calls.filter(row => row[0] === 'getblock'), [['getblock', fixture.blockHash, 0]]);
  assert.equal(harness.state.hashReads.get(JOBS_ACTIVATION_HEIGHT), 3); assert.equal(harness.state.hydrated.length, 0);
  assert.equal(harness.state.blocks.length, 0); assert.equal(harness.state.stored.length, 1);
  assert.equal(result.candidateCount, 0); assert.equal(result.candidateSha256, JOBS_DISCOVERY_EMPTY_SHA256);
  assert.equal(result.complete, true); assert.equal(result.fromHeight, JOBS_ACTIVATION_HEIGHT); assert.equal(result.indexedThroughBlockHash, fixture.blockHash);
});

test('actual positive discovery keeps getblock2 hydration, all malformed outputs and exact sealed positions', async () => {
  const fixture = discoveryFixture([jobScript, jobScript + '51'], { witness: true });
  const harness = discoveryHarness([fixture]); const result = await harness.run();
  assert.deepEqual(harness.state.calls.filter(row => row[0] === 'getblock'), [['getblock', fixture.blockHash, 0], ['getblock', fixture.blockHash, 2]]);
  assert.equal(harness.state.hydrated.length, 1); assert.equal(harness.state.sealed.length, 1);
  assert.equal(harness.state.sealed[0].position.blockTransactionIndex, 1);
  assert.equal(harness.state.raw[0]._powBlockHash, fixture.blockHash); assert.equal(result.candidateCount, 1);
  assert.equal(result.candidateSha256, advanceJobsCandidateDigest(JOBS_DISCOVERY_EMPTY_SHA256, harness.state.raw[0]));
  assert.equal(result.complete, true);
});

test('actual bootstrap refuses inconsistent positives and malformed raw bodies before hydration or marker writes', async () => {
  for (const mutation of ['decoded', 'raw', 'parent']) {
    const fixture = discoveryFixture([jobScript], { previous: mutation === 'parent' ? '11'.repeat(32) : discoveryParent });
    if (mutation === 'raw') fixture.raw += '00';
    const harness = discoveryHarness([fixture], { mutateDecoded: mutation === 'decoded' ? block => { block.tx[1].vout[0].scriptPubKey.hex = '51'; } : undefined });
    await assert.rejects(harness.run());
    assert.equal(harness.state.hydrated.length, 0); assert.equal(harness.state.stored.length, 0);
    assert.equal(harness.state.calls.some(row => row[0] === 'sql' && row[1] === 'BEGIN'), false);
  }
});

test('actual discovery reorg never persists a marker; unclosed history remains blocked', async () => {
  for (const scripts of [['51'], [jobScript]]) {
    const harness = discoveryHarness([discoveryFixture(scripts)], { reorg: true });
    await assert.rejects(harness.run(), /changed before witness/); assert.equal(harness.state.stored.length, 0);
  }
  const fixture = discoveryFixture([jobScript]); const harness = discoveryHarness([fixture], { sealClosed: false });
  const result = await harness.run(); assert.equal(result.complete, false);
  assert.deepEqual(Array.from(result.blockedCandidates), [fixture.decoded.tx[1].txid]);
  assert.equal(result.reason, 'historical-jobs-amo-closure-requires-supervised-canonical-replay');
});

test('actual discovery bounded resumption connects every historical predecessor without changing commitment model', async () => {
  const first = discoveryFixture(['51']); const second = discoveryFixture(['51'], { height: JOBS_ACTIVATION_HEIGHT + 1, previous: first.blockHash, nonce: 1 });
  const harness = discoveryHarness([first, second], { budget: 1 }); const partial = await harness.run();
  assert.equal(partial.complete, false); assert.equal(partial.indexedThroughBlock, JOBS_ACTIVATION_HEIGHT); assert.equal(partial.scannedBlocks, 1);
  const completed = await harness.run(); assert.equal(completed.complete, true); assert.equal(completed.indexedThroughBlock, JOBS_ACTIVATION_HEIGHT + 1);
  assert.equal(completed.model, JOBS_DISCOVERY_MODEL); assert.equal(completed.fromHeight, JOBS_ACTIVATION_HEIGHT);
  assert.equal(completed.candidateSha256, JOBS_DISCOVERY_EMPTY_SHA256); assert.equal(harness.state.stored.length, 2);
  assert.deepEqual(harness.state.calls.filter(row => row[0] === 'getblock'), [['getblock', first.blockHash, 0], ['getblock', second.blockHash, 0]]);
});

test('exact pinned parent opens a complete empty interval and earlier or altered targets cannot', async () => {
  const parent = { height: JOBS_ACTIVATION_HEIGHT - 1, blockHash: discoveryParent };
  const harness = discoveryHarness([], { targetCheckpoint: parent });
  const result = await harness.run();
  assert.equal(result.complete, true); assert.equal(result.candidateCount, 0);
  assert.equal(result.indexedThroughBlock, parent.height); assert.equal(result.indexedThroughBlockHash, parent.blockHash);
  assert.equal(harness.state.stored.length, 1); assert.equal(harness.state.calls.some(row => row[0] === 'getblock'), false);
  for (const targetCheckpoint of [{ ...parent, height: parent.height - 1 }, { ...parent, blockHash: 'ff'.repeat(32) }]) {
    const invalid = discoveryHarness([], { targetCheckpoint });
    await assert.rejects(invalid.run(), /activation parent/); assert.equal(invalid.state.stored.length, 0);
  }
  const absent = discoveryHarness([], { targetCheckpoint: parent, canonicalTarget: false });
  await assert.rejects(absent.run(), /canonical database\/Core/); assert.equal(absent.state.stored.length, 0);
});

test('hot discovery locks before marker read and advances only a valid contiguous commitment', async () => {
  const advanceSource = indexerFunction('async function advanceJobsDiscoveryCheckpoint(', '\n/** Cold discovery');
  const sequence = [], stored = [];
  let current = { model: JOBS_DISCOVERY_MODEL, network: 'livenet', fromHeight: JOBS_ACTIVATION_HEIGHT, complete: true,
    indexedThroughBlock: JOBS_ACTIVATION_HEIGHT - 1, indexedThroughBlockHash: discoveryParent,
    candidateCount: 0, candidateSha256: JOBS_DISCOVERY_EMPTY_SHA256 };
  const advance = runInNewContext(advanceSource + '\nadvanceJobsDiscoveryCheckpoint;', {
    NETWORK: 'livenet', JOBS_DISCOVERY_META_KEY: 'jobs:candidate-discovery', JOBS_DISCOVERY_MODEL, JOBS_ACTIVATION_HEIGHT,
    advanceJobsCandidateDigest, proofIndexerMetaValue: async () => { sequence.push('read'); return current; },
    storeProofIndexerMeta: async (_client, _key, value) => { sequence.push('write'); stored.push(value); },
  });
  const client = { query: async sql => { assert.match(sql, /pg_advisory_xact_lock/); sequence.push('lock'); return { rows: [] }; } };
  const position = { height: JOBS_ACTIVATION_HEIGHT, blockHash: 'ab'.repeat(32), previousBlockHash: discoveryParent, candidates: [] };
  await advance(client, position);
  assert.deepEqual(sequence, ['lock', 'read', 'write']); assert.equal(stored[0].indexedThroughBlock, JOBS_ACTIVATION_HEIGHT);
  for (const changes of [{ complete: false }, { fromHeight: 1 }, { candidateCount: '0' }, { candidateSha256: 'x' }, { indexedThroughBlock: JOBS_ACTIVATION_HEIGHT }]) {
    current = { ...current, ...changes }; const count = stored.length; await advance(client, position); assert.equal(stored.length, count);
  }
});
