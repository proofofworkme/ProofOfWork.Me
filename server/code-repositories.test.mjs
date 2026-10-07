import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import * as bitcoin from 'bitcoinjs-lib';
import { encodeCodeRepository, encodeCodeCommit, CODE_EMPTY_SHA256 } from '../src/shared/protocol/codeRepository.mjs';
import { createCodeSnapshot, codeRepositoriesPayload, codeRepositoryPayload, qualifyCodeLogPayload, exactCodeOutputProofs,
  CODE_DISCOVERY_EMPTY_SHA256, advanceCodeCandidateDigest, CODE_DISCOVERY_MODEL,
  prefilterCodeRawBlock, assertCodeRawBlockCandidatesMatch } from './code-repositories.mjs';
import { canonicalProtocolCandidateFromOutput, decodeCanonicalOpReturnOutput } from './canonical-op-return.mjs';

const owner = '1F1p9UEHuH5KTFR7Zsx93Khdrqhj6t5nFv', hash = 'b'.repeat(64);
const script = Buffer.from(bitcoin.address.toOutputScript(owner)).toString('hex');
const id = value => value.toString(16).padStart(64, '0');
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
function op(text) {
  const bytes = Buffer.from(text);
  const push = bytes.length < 76 ? Buffer.from([bytes.length]) : Buffer.from([0x4d, bytes.length & 255, bytes.length >> 8]);
  return { value: 0, scriptpubkey: Buffer.concat([Buffer.from([0x6a]), push, bytes]).toString('hex') };
}
function tx(index, text, carriers = []) {
  return { txid: id(index), status: { confirmed: true, block_height: 7, block_hash: hash }, blockTransactionIndex: index,
    vin: [{ prevout: { scriptpubkey_address: owner, scriptpubkey: script, value: 546 } }],
    vout: [{ value: 546, scriptpubkey_address: owner, scriptpubkey: script }, op('pwm1:m:Code'), ...carriers.map(op), op(text)] };
}
function repo() { return tx(1, encodeCodeRepository({ v: 1, name: 'source', description: 'exact source' })); }
function commit(index, parent, path = 'file.txt', content = '') {
  const bytes = Buffer.from(content), sha256 = digest(bytes);
  const attachment = content ? [`pwm1:a:${Buffer.from('text/plain').toString('base64url')}:${Buffer.from('source.txt').toString('base64url')}:${bytes.length}:${sha256}:0/1:${bytes.toString('base64url')}`] : [];
  return tx(index, encodeCodeCommit({ v: 1, repo: id(1), parent: id(parent), op: 'put', path, message: `commit ${index}`, sha256, size: bytes.length }), attachment);
}
function snapshot(transactions) { return createCodeSnapshot({ network: 'livenet', checkpointHeight: 7, checkpointHash: hash, transactions }); }

test('repository history has no arbitrary ceiling and cursor binds query and revision', () => {
  const transactions = [repo(), ...Array.from({ length: 237 }, (_, offset) => commit(offset + 2, offset + 1))];
  const state = snapshot(transactions);
  const first = codeRepositoryPayload(state, new URLSearchParams({ repo: id(1), limit: '200' }));
  assert.equal(first.commits.length, 200);
  assert.equal(first.pagination.total, 238);
  const last = codeRepositoryPayload(state, new URLSearchParams({ repo: id(1), limit: '200', cursor: first.pagination.nextCursor }));
  assert.equal(last.commits.length, 38);
  assert.equal(last.pagination.hasMore, false);
  assert.equal(last.snapshot.id, first.snapshot.id);
  assert.throws(() => codeRepositoryPayload(state, new URLSearchParams({ repo: id(1), version: id(2), cursor: first.pagination.nextCursor })), /another query/);
  const list = codeRepositoriesPayload(state);
  assert.deepEqual(list.stats, { repositories: 1, acceptedCommits: 237, unappliedCommits: 0, files: 1 });
});
test('source and historical trees retain exact UTF-8 bytes including BOM and CRLF', () => {
  const content = '\ufefffirst\r\nsecond\n';
  const state = snapshot([repo(), commit(2, 1, 'README.md', content), commit(3, 2, 'README.md', '')]);
  const historical = codeRepositoryPayload(state, new URLSearchParams({ repo: id(1), version: id(2), path: 'README.md' }));
  assert.equal(historical.file.content, content);
  assert.equal(Buffer.from(historical.file.contentBase64, 'base64').toString('utf8'), content);
  assert.equal(historical.file.verified, true);
  assert.ok(historical.file.evidence.outputs.some(output => output.prefix === 'pwc1:'));
  const head = codeRepositoryPayload(state, new URLSearchParams({ repo: id(1), path: 'README.md' }));
  assert.equal(head.file.size, 0);
  assert.equal(head.file.sha256, CODE_EMPTY_SHA256);
  assert.equal(head.file.contentBase64, '');
  assert.equal(codeRepositoryPayload(state, new URLSearchParams({ repo: id(1), version: id(1), path: 'README.md' })).file, null);
});
test('stale and malformed candidates remain visible while pending never mutates confirmed files', () => {
  const pending = commit(5, 2, 'pending.txt', 'pending'); pending.status = { confirmed: false };
  const state = snapshot([repo(), commit(2, 1), commit(3, 1), tx(4, 'pwc1:commit:broken'), pending]);
  const detail = codeRepositoryPayload(state, new URLSearchParams({ repo: id(1) }));
  assert.equal(detail.repository.headTxid, id(2));
  assert.equal(detail.commits.find(event => event.txid === id(3)).applied, false);
  assert.equal(detail.pendingEvents.length, 1);
  assert.equal(detail.files.some(file => file.path === 'pending.txt'), false);
  assert.equal(codeRepositoriesPayload(state).invalidEvents[0].txid, id(4));
  const qualified = qualifyCodeLogPayload({ items: [{ txid: id(3), protocol: 'pwc1', valid: true }] }, state.events, state.snapshot);
  assert.equal(qualified.items[0].structuralValid, true);
  assert.equal(qualified.items[0].valid, false);
  assert.equal(qualified.items[0].codeAuthority.ready, true);
});
test('discovery commitment binds malformed script candidates and canonical position', () => {
  const malformed = tx(4, 'pwc1:commit:broken');
  const first = advanceCodeCandidateDigest(CODE_DISCOVERY_EMPTY_SHA256, malformed);
  assert.notEqual(first, CODE_DISCOVERY_EMPTY_SHA256);
  assert.notEqual(first, advanceCodeCandidateDigest(CODE_DISCOVERY_EMPTY_SHA256, { ...malformed, blockTransactionIndex: 5 }));
});
test('Code proof conversion handles Core decimals exactly and rejects fractional proofs', () => {
  assert.equal(exactCodeOutputProofs({ value: 0.00000546, scriptPubKey: {} }), '546');
  assert.equal(exactCodeOutputProofs({ value: 1e-8, scriptPubKey: {} }), '1');
  assert.equal(exactCodeOutputProofs({ value: '0.30000000', scriptPubKey: {} }), '30000000');
  assert.equal(exactCodeOutputProofs({ value: 0.1 + 0.2, scriptPubKey: {} }), null);
  assert.equal(exactCodeOutputProofs({ value: 1e-9, scriptPubKey: {} }), null);
  assert.equal(exactCodeOutputProofs({ value: Number.MAX_SAFE_INTEGER + 1 }), null);
});

const discoveryParent = '22'.repeat(32);
function discoveryFixture(scripts = ['51'], { witness = false, previous = discoveryParent, height = 1, nonce = 0 } = {}) {
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

test('Core raw discovery preserves every split prefix and malformed physical candidate', () => {
  const prefix = Buffer.from('pwc1:');
  const scripts = [];
  for (let mask = 0; mask < 16; mask++) {
    const pieces = []; let start = 0;
    for (let i = 1; i <= prefix.length; i++) if (i === prefix.length || (mask & (1 << (i - 1)))) {
      const bytes = prefix.subarray(start, i); pieces.push(Buffer.from([bytes.length]), bytes, Buffer.from([0])); start = i;
    }
    scripts.push(Buffer.concat([Buffer.from([0x6a]), ...pieces]).toString('hex'));
  }
  scripts.push('6a4c05707763313a', '6a4d0500707763313a', '6a4e05000000707763313a', '6a05707763313aac',
    '6a06707763313aff', '6a06707763313a00', '6a4c06707763313a', '6a4effffffff707763313a');
  for (const scriptPubKeyHex of scripts) {
    assert.equal(decodeCanonicalOpReturnOutput({ scriptPubKey: { hex: scriptPubKeyHex } }).prefix, 'pwc1:');
    for (const witness of [false, true]) {
      const fixture = discoveryFixture([scriptPubKeyHex], { witness }); const summary = discoverySummary(fixture);
      assert.equal(summary.noCodeCandidates, false); assert.equal(summary.candidates.length, 1);
      assert.deepEqual(summary.candidates[0], { transactionIndex: 1, vout: 0, scriptPubKeyHex, txid: fixture.decoded.tx[1].txid });
      assertCodeRawBlockCandidatesMatch(summary, fixture.decoded);
    }
  }
  const split = discoveryFixture(['6a0170017701630131013a']);
  assert.equal(split.raw.includes(prefix.toString('hex')), false);
  assert.equal(discoverySummary(split).noCodeCandidates, false);
  const multiple = discoverySummary(discoveryFixture([scripts[0], scripts[1], '51']));
  assert.deepEqual(multiple.candidates.map(row => row.vout), [0, 1]);
});

test('negative Core admission consumes all legacy/witness bytes and rejects malformed framing', () => {
  for (const witness of [false, true]) {
    const fixture = discoveryFixture(['51707763313a'], { witness }); const summary = discoverySummary(fixture);
    assert.equal(summary.noCodeCandidates, true); assert.equal(summary.transactionCount, 2);
    assert.equal(summary.bodyAuthority, 'authenticated-first-party-core'); assert.equal(summary.transactionRootsVerified, false);
    for (let end = 0; end < fixture.raw.length; end += 2) assert.throws(() => prefilterCodeRawBlock(fixture.raw.slice(0, end), fixture));
    assert.throws(() => prefilterCodeRawBlock(fixture.raw + '00', fixture), /trailing/);
    assert.throws(() => prefilterCodeRawBlock(fixture.raw.toUpperCase(), fixture), /hex/);
    assert.throws(() => prefilterCodeRawBlock(fixture.raw + '0', fixture), /hex/);
    assert.throws(() => prefilterCodeRawBlock(fixture.raw, { ...fixture, blockHash: '11'.repeat(32) }), /header hash/);
    assert.throws(() => prefilterCodeRawBlock(fixture.raw, { ...fixture, previousBlockHash: '11'.repeat(32) }), /parent/);
    assert.throws(() => prefilterCodeRawBlock(fixture.raw.slice(0, 160) + 'fd0200' + fixture.raw.slice(162), fixture), /CompactSize/);
    assert.throws(() => prefilterCodeRawBlock(fixture.raw.slice(0, 160) + 'ff0000000001000000', fixture), /count/);
  }
  const fixture = discoveryFixture(['51']); const raw = Buffer.from(fixture.raw, 'hex');
  assert.throws(() => prefilterCodeRawBlock(Buffer.concat([raw.subarray(0, 85), Buffer.from('fd0100', 'hex'), raw.subarray(86)]).toString('hex'), fixture), /CompactSize/);
  assert.throws(() => prefilterCodeRawBlock('00'.repeat(8_000_001), fixture), /oversized/);
});

test('positive Core JSON must match every candidate script, txid, position and block envelope', () => {
  const fixture = discoveryFixture(['6a0170017701630131013a', '6a05707763313aac'], { witness: true });
  const summary = discoverySummary(fixture); assertCodeRawBlockCandidatesMatch(summary, fixture.decoded);
  const mutations = [block => block.tx[1].vout.pop(), block => block.tx[1].vout.reverse(),
    block => block.tx[1].vout[0].scriptPubKey.hex = '6a05707763313a', block => block.tx[1].txid = 'ff'.repeat(32),
    block => block.nTx++, block => block.time++, block => block.previousblockhash = '11'.repeat(32), block => block.hash = '11'.repeat(32)];
  for (const mutate of mutations) { const block = structuredClone(fixture.decoded); mutate(block); assert.throws(() => assertCodeRawBlockCandidatesMatch(summary, block), /differs|differ/); }
});

// Execute the actual bootstrap function with a mock Core/database boundary;
// importing the executable indexer would launch its real CLI and is forbidden.
const discoveryIndexerSource = readFileSync(new URL('../scripts/backfill-proof-indexer.mjs', import.meta.url), 'utf8');
function indexerFunction(start, next) { return discoveryIndexerSource.slice(discoveryIndexerSource.indexOf(start), discoveryIndexerSource.indexOf(next)); }
const actualBootstrapFunctions = [
  indexerFunction('function assertCanonicalBlockEnvelope(', '\nfunction protocolMessagesFromTx('),
  indexerFunction('function protocolMessagesFromTx(', '\nfunction protocolMessagesContainInceptionBond('),
  indexerFunction('async function bootstrapCodeCandidates(', '\nasync function latestBlockScanCheckpoint('),
].join('\n');
function discoveryHarness(fixtures, { budget = 1000, sealClosed = true, reorg = false, mutateDecoded } = {}) {
  const state = { marker: null, stored: [], calls: [], hydrated: [], sealed: [], raw: [], blocks: [], hashReads: new Map(), budget, sealClosed, reorg };
  const target = fixtures.at(-1); let pendingMarker;
  const client = { query: async (sql, params) => {
    state.calls.push(['sql', sql]);
    if (sql.includes('pg_try_advisory_lock')) return { rows: [{ locked: true }] };
    if (sql.startsWith('SELECT txid,raw_tx')) return { rows: state.raw.map(tx => ({ txid: tx.txid, raw_tx: tx,
      block_height: tx.height, block_hash: tx._powBlockHash, block_index: tx._powBlockIndex })) };
    if (sql === 'COMMIT') { if (pendingMarker) { state.marker = pendingMarker; state.stored.push(pendingMarker); } pendingMarker = undefined; }
    if (sql === 'ROLLBACK') pendingMarker = undefined;
    return { rows: [] };
  } };
  const context = {
    process: { env: { POW_INDEX_CODE_BOOTSTRAP_MAX_BLOCKS: String(budget) } }, NETWORK: 'livenet',
    WORK_AMO_V5_ACTIVATION_HEIGHT: 1, CODE_DISCOVERY_META_KEY: 'code:candidate-discovery', CODE_DISCOVERY_MODEL,
    CODE_DISCOVERY_EMPTY_SHA256, advanceCodeCandidateDigest, prefilterCodeRawBlock, assertCodeRawBlockCandidatesMatch,
    canonicalProtocolCandidateFromOutput, isHexTxid: value => /^[0-9a-f]{64}$/u.test(value),
    latestBlockScanCheckpoint: async () => ({ height: target.decoded.height, blockHash: target.blockHash }),
    proofIndexerMetaValue: async () => state.marker,
    storeProofIndexerMeta: async (_client, _key, marker) => { pendingMarker = marker; },
    bitcoinRpc: async (method, params) => {
      state.calls.push([method, ...params]);
      if (method === 'getblockhash') {
        const height = params[0]; const reads = (state.hashReads.get(height) ?? 0) + 1; state.hashReads.set(height, reads);
        if (height === 0) return discoveryParent;
        const fixture = fixtures.find(row => row.decoded.height === height);
        return state.reorg && height === 1 && reads > 1 ? 'ff'.repeat(32) : fixture.blockHash;
      }
      if (method === 'getblock') {
        const fixture = fixtures.find(row => row.blockHash === params[0]);
        if (params[1] === 0) return fixture.raw;
        const block = structuredClone(fixture.decoded); mutateDecoded?.(block); return block;
      }
      throw new Error('Unexpected RPC');
    },
    transactionWithInputPrevouts: async tx => { state.hydrated.push(tx); return tx; },
    storedCodeCandidateEventClosure: async (_client, tx, position) => { state.sealed.push({ tx, position }); return state.sealClosed; },
    persistCanonicalBlock: async (_client, block) => state.blocks.push(block),
    persistCanonicalRawTransaction: async (_client, tx) => state.raw.push(tx),
    persistPreparedProtocolItems: async () => {}, protocolItemsFromTx: () => [],
  };
  const bootstrap = runInNewContext(actualBootstrapFunctions + '\nbootstrapCodeCandidates;', context);
  return { state, run: () => bootstrap(client) };
}

test('actual discovery negatives skip only getblock2 and retain canonical hash recheck/marker', async () => {
  const fixture = discoveryFixture(['51'], { witness: true }); const harness = discoveryHarness([fixture]);
  const result = await harness.run();
  assert.deepEqual(harness.state.calls.filter(row => row[0] === 'getblock'), [['getblock', fixture.blockHash, 0]]);
  assert.equal(harness.state.hashReads.get(1), 2); assert.equal(harness.state.hydrated.length, 0);
  assert.equal(harness.state.blocks.length, 0); assert.equal(harness.state.stored.length, 1);
  assert.equal(result.candidateCount, 0); assert.equal(result.candidateSha256, CODE_DISCOVERY_EMPTY_SHA256);
  assert.equal(result.complete, true); assert.equal(result.fromHeight, 1); assert.equal(result.indexedThroughBlockHash, fixture.blockHash);
});

test('actual positive discovery keeps getblock2 hydration, all malformed outputs and exact sealed positions', async () => {
  const fixture = discoveryFixture(['6a0170017701630131013a', '6a05707763313aac'], { witness: true });
  const harness = discoveryHarness([fixture]); const result = await harness.run();
  assert.deepEqual(harness.state.calls.filter(row => row[0] === 'getblock'), [['getblock', fixture.blockHash, 0], ['getblock', fixture.blockHash, 2]]);
  assert.equal(harness.state.hydrated.length, 1); assert.equal(harness.state.sealed.length, 1);
  assert.equal(harness.state.sealed[0].position.blockTransactionIndex, 1);
  assert.equal(harness.state.raw[0]._powBlockHash, fixture.blockHash); assert.equal(result.candidateCount, 1);
  assert.equal(result.candidateSha256, advanceCodeCandidateDigest(CODE_DISCOVERY_EMPTY_SHA256, harness.state.raw[0]));
  assert.equal(result.complete, true);
});

test('actual bootstrap refuses inconsistent positives and malformed raw bodies before hydration or marker writes', async () => {
  for (const mutation of ['decoded', 'raw', 'parent']) {
    const fixture = discoveryFixture(['6a05707763313a'], { previous: mutation === 'parent' ? '11'.repeat(32) : discoveryParent });
    if (mutation === 'raw') fixture.raw += '00';
    const harness = discoveryHarness([fixture], { mutateDecoded: mutation === 'decoded' ? block => { block.tx[1].vout[0].scriptPubKey.hex = '51'; } : undefined });
    await assert.rejects(harness.run());
    assert.equal(harness.state.hydrated.length, 0); assert.equal(harness.state.stored.length, 0);
    assert.equal(harness.state.calls.some(row => row[0] === 'sql' && row[1] === 'BEGIN'), false);
  }
});

test('actual discovery reorg never persists a marker; unclosed history remains blocked', async () => {
  for (const scripts of [['51'], ['6a05707763313a']]) {
    const harness = discoveryHarness([discoveryFixture(scripts)], { reorg: true });
    await assert.rejects(harness.run(), /changed before witness/); assert.equal(harness.state.stored.length, 0);
  }
  const fixture = discoveryFixture(['6a05707763313a']); const harness = discoveryHarness([fixture], { sealClosed: false });
  const result = await harness.run(); assert.equal(result.complete, false);
  assert.deepEqual(Array.from(result.blockedCandidates), [fixture.decoded.tx[1].txid]);
  assert.equal(result.reason, 'historical-code-amo-closure-requires-supervised-canonical-replay');
});

test('actual discovery bounded resumption connects every historical predecessor without changing commitment model', async () => {
  const first = discoveryFixture(['51']); const second = discoveryFixture(['51'], { height: 2, previous: first.blockHash, nonce: 1 });
  const harness = discoveryHarness([first, second], { budget: 1 }); const partial = await harness.run();
  assert.equal(partial.complete, false); assert.equal(partial.indexedThroughBlock, 1); assert.equal(partial.scannedBlocks, 1);
  const completed = await harness.run(); assert.equal(completed.complete, true); assert.equal(completed.indexedThroughBlock, 2);
  assert.equal(completed.model, CODE_DISCOVERY_MODEL); assert.equal(completed.fromHeight, 1);
  assert.equal(completed.candidateSha256, CODE_DISCOVERY_EMPTY_SHA256); assert.equal(harness.state.stored.length, 2);
  assert.deepEqual(harness.state.calls.filter(row => row[0] === 'getblock'), [['getblock', first.blockHash, 0], ['getblock', second.blockHash, 0]]);
});
