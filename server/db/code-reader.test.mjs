import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createHash } from 'node:crypto';
import * as bitcoin from 'bitcoinjs-lib';
import { encodeCodeRepository, encodeCodeReferenceCommit, CODE_REFERENCE_ACTIVATION_HEIGHT, CODE_REFERENCE_ACTIVATION_PARENT_HEIGHT, CODE_REFERENCE_ACTIVATION_PARENT_HASH } from '../../src/shared/protocol/codeRepository.mjs';
import { codeTransactionFromRow, readCodeSnapshot, readCodePageSource, codeReferenceSourceFromCore } from './code-reader.mjs';
import { CODE_DISCOVERY_MODEL, CODE_DISCOVERY_EMPTY_SHA256, advanceCodeCandidateDigest, codeCandidateEventClosure } from '../code-repositories.mjs';
import { decodeCanonicalOpReturnOutput } from '../canonical-op-return.mjs';
const hash = 'b'.repeat(64), txid = 'a'.repeat(64), owner = '1F1p9UEHuH5KTFR7Zsx93Khdrqhj6t5nFv';
const payScript = Buffer.from(bitcoin.address.toOutputScript(owner)).toString('hex');
function op(text) {
  const bytes = Buffer.from(text);
  return Buffer.concat([Buffer.from([0x6a, 0x4d, bytes.length & 255, bytes.length >> 8]), bytes]).toString('hex');
}
function row() {
  const vout = [{ scriptpubkey: payScript, value: 546 }, { scriptpubkey: op('pwm1:m:Code'), value: 0 },
    { scriptpubkey: op(encodeCodeRepository({ v: 1, name: 'source', description: '' })), value: 0 }];
  const serialized = new bitcoin.Transaction(); serialized.version = 2;
  serialized.addInput(Buffer.from(txid,'hex').reverse(),0,0xffffffff,Buffer.alloc(0));
  for(const output of vout) serialized.addOutput(Buffer.from(output.scriptpubkey,'hex'),BigInt(output.value));
  const actualTxid=serialized.getId();
  return { txid:actualTxid, status: 'confirmed', block_height: 7, block_hash: hash, block_index: 1,
    raw_tx: { txid:actualTxid,version:2,locktime:0,hex:serialized.toHex(),vin: [{txid,vout:0,sequence:0xffffffff,prevout: { scriptpubkey: payScript, value: 1000 } }], vout,
      canonicalBlockScan: { height: 7, blockHash: hash, blockIndex: 1 } },
    outputs: vout.map((output, index) => ({ vout: index, value_sats: String(output.value), scriptpubkey: output.scriptpubkey })) };
}
function fixture(changes = {}) {
  const raw = row();
  const normalized = codeTransactionFromRow(raw, 'livenet');
  const marker = { model: CODE_DISCOVERY_MODEL, network: 'livenet', fromHeight: 1, complete: true,
    indexedThroughBlock: 7, indexedThroughBlockHash: hash, candidateCount: 1,
    candidateSha256: advanceCodeCandidateDigest(CODE_DISCOVERY_EMPTY_SHA256, normalized), ...changes };
  return { raw, marker, client: { async query(sql) {
    if (sql.includes('SELECT value FROM')) return { rows: [{ value: marker }] };
    if (sql.includes('SELECT height,block_hash')) return { rows: [{ height: 7, block_hash: hash }] };
    if (sql.includes('count(*)::text')) return { rows: [{ count: '1' }] };
    if (sql.includes('SELECT t.*')) return { rows: [raw] };
    throw new Error(`Unexpected query: ${sql}`);
  } } };
}
test('complete discovery corpus opens canonical reads and resumes only its exact source witness', async () => {
  const { client } = fixture();
  const state = await readCodeSnapshot(client, 'livenet', new URLSearchParams(), { verifyCheckpoint: async () => hash });
  assert.equal(state.repositories.length, 1);
  assert.equal(state.snapshot.checkpointHeight, 7);
  assert.equal(state.repositories[0].ownerAddress, owner);
  await assert.rejects(() => readCodeSnapshot(client, 'livenet', new URLSearchParams(), { verifyCheckpoint: async () => 'c'.repeat(64) }), /canonical node/);
});
test('missing, partial or altered discovery coverage fails closed', async () => {
  for (const changes of [{ complete: false }, { fromHeight: 4 }, { candidateCount: 0 }, { candidateSha256: 'c'.repeat(64) }]) {
    const { client } = fixture(changes);
    await assert.rejects(() => readCodeSnapshot(client, 'livenet', new URLSearchParams(), { verifyCheckpoint: async () => hash }), /discovery|corpus/i);
  }
});
test('an active bootstrap preserves explicitly identified last-good canonical coverage', async () => {
  const ready = fixture().marker;
  const { client } = fixture({ complete: false, lastGood: ready, indexedThroughBlock: 8, indexedThroughBlockHash: 'c'.repeat(64) });
  const state = await readCodeSnapshot(client, 'livenet', new URLSearchParams(), { verifyCheckpoint: async () => hash });
  assert.equal(state.snapshot.checkpointHeight, 7);
  assert.equal(state.snapshot.checkpointHash, hash);
});
test('raw output and block witness parity are required before source or ownership projection', () => {
  const raw = row();
  raw.outputs[0].value_sats = '545';
  assert.throws(() => codeTransactionFromRow(raw, 'livenet'), /output evidence/);
  const wrongBlock = row(); wrongBlock.raw_tx.canonicalBlockScan.blockIndex = 2;
  assert.throws(() => codeTransactionFromRow(wrongBlock, 'livenet'), /canonical block witness/);
  const changedId = row(); changedId.txid = 'c'.repeat(64);
  assert.throws(() => codeTransactionFromRow(changedId, 'livenet'), /transaction ID/);
  const noHex = row(); delete noHex.raw_tx.hex;
  assert.equal(codeTransactionFromRow(noHex, 'livenet').txid, noHex.txid);
  noHex.raw_tx.vin[0].scriptSig = { hex: '51' };
  assert.throws(() => codeTransactionFromRow(noHex, 'livenet'), /transaction ID/);
});
test('incomplete pending gossip warns without changing complete confirmed coverage', async () => {
  const { client }=fixture(),query=client.query;
  client.query=async sql=>sql.includes('SELECT t.*')?{rows:[row(),{...row(),txid:'d'.repeat(64),status:'pending',raw_tx:{}}]}:query(sql);
  const state=await readCodeSnapshot(client,'livenet',new URLSearchParams(),{verifyCheckpoint:async()=>hash});
  assert.equal(state.repositories.length,1);
  assert.equal(state.pendingEvents.length,0);
  assert.deepEqual(state.pendingWarnings,[{txid:'d'.repeat(64),reason:'pending-raw-evidence-unavailable'}]);
});
test('post-V5 discovery admits every exact candidate event and sealed replay witness', () => {
  const tx = row().raw_tx;
  tx.vout.push({ value: 0, scriptpubkey: op('pwc1:commit:malformed') });
  const position = { blockHeight: 7, blockHash: hash, blockTransactionIndex: 1 };
  const candidates = tx.vout.map((output, vout) => ({ vout, decoded: decodeCanonicalOpReturnOutput(output) })).filter(item => item.decoded.prefix === 'pwc1:');
  const events = candidates.map(({ vout, decoded }) => ({ txid:tx.txid, protocol: 'pwc1', status: 'confirmed', block_height: 7,
    block_index: 1, op_return_vout: vout, record_ordinal: 0, raw_payload: decoded.text, valid: false,
    payload: { _workAmoV5ReplayBound: true, workAmoV5RawCandidate: true,
      workAmoV5RawScriptWitness: { scriptPubKeyHex: decoded.scriptPubKeyHex }, workAmoV5ReplayOutcome: { valid: false, kind: 'pwc1-invalid' } } }));
  const witnesses = candidates.map(({ vout, decoded }) => ({ txid:tx.txid, protocol: 'pwc1', rawCandidate: true,
    position: { ...position, protocolVout: vout, recordOrdinal: 0 }, outcome: { valid: false, kind: 'pwc1-invalid' },
    rawWitness: { rawRecordParts: [{ scriptPubKeyHex: decoded.scriptPubKeyHex }] } }));
  const transition = { block_height: 7, block_hash: hash, payload: { replayRecords: witnesses } };
  assert.equal(codeCandidateEventClosure(tx, events, position, transition), true);
  assert.equal(codeCandidateEventClosure(tx, events.slice(0, 1), position, transition), false);
  assert.equal(codeCandidateEventClosure(tx, events, position, { ...transition, payload: { replayRecords: witnesses.slice(0, 1) } }), false);
  events[1].payload.workAmoV5RawScriptWitness.scriptPubKeyHex = '6a';
  assert.equal(codeCandidateEventClosure(tx, events, position, transition), false);
});

const pageHash = 'c'.repeat(64);
const sourceHtml = '\ufeff<!doctype html>\r\n<html>exact page</html>\r\n';
const sha256 = value => createHash('sha256').update(value).digest('hex');
function referenceRow(messages, height, index) {
  const vout = [{ scriptpubkey: payScript, value: 546 }, ...messages.map(text => ({ scriptpubkey: op(text), value: 0 }))];
  const serialized = new bitcoin.Transaction(); serialized.version = 2;
  serialized.addInput(Buffer.from(txid, 'hex').reverse(), index, 0xffffffff, Buffer.alloc(0));
  for (const output of vout) serialized.addOutput(Buffer.from(output.scriptpubkey, 'hex'), BigInt(output.value));
  const actualTxid = serialized.getId(), blockHash = height === CODE_REFERENCE_ACTIVATION_HEIGHT ? hash : pageHash;
  return { txid: actualTxid, status: 'confirmed', block_height: height, block_hash: blockHash, block_index: index, source_canonical: true,
    raw_tx: { txid: actualTxid, version: 2, locktime: 0, hex: serialized.toHex(),
      vin: [{ txid, vout: index, sequence: 0xffffffff, prevout: { scriptpubkey: payScript, value: 1000 } }], vout,
      canonicalBlockScan: { height, blockHash, blockIndex: index } },
    outputs: vout.map((output, vout) => ({ vout, value_sats: String(output.value), scriptpubkey: output.scriptpubkey })) };
}
function referenceFixture({ sourceChanges = {}, metadataChanges = {}, checkpointHeight = CODE_REFERENCE_ACTIVATION_HEIGHT } = {}) {
  const page = { ...referenceRow([`pwm1:m:${sourceHtml}`], CODE_REFERENCE_ACTIVATION_HEIGHT - 2, 1), ...sourceChanges };
  const root = referenceRow(['pwm1:m:Code', encodeCodeRepository({ v: 1, name: 'pages', description: '' })], CODE_REFERENCE_ACTIVATION_HEIGHT - 2, 2);
  const metadata = { v: 2, repo: root.txid, parent: root.txid, op: 'reference', path: 'pages/index.html', message: 'Reference Page',
    sourceTxid: page.txid, sourceKind: 'body', sourceVout: 1, sha256: sha256(Buffer.from(sourceHtml)), size: Buffer.byteLength(sourceHtml), ...metadataChanges };
  const commit = referenceRow(['pwm1:m:Code', encodeCodeReferenceCommit(metadata)], CODE_REFERENCE_ACTIVATION_HEIGHT, 1);
  const codeRows = [root, commit];
  const marker = { model: CODE_DISCOVERY_MODEL, network: 'livenet', fromHeight: 1, complete: true,
    indexedThroughBlock: checkpointHeight, indexedThroughBlockHash: hash, candidateCount: 2,
    candidateSha256: codeRows.map(row => codeTransactionFromRow(row, 'livenet')).reduce(advanceCodeCandidateDigest, CODE_DISCOVERY_EMPTY_SHA256) };
  const calls = [];
  const client = { async query(sql, args) {
    calls.push({ sql, args });
    if (sql.includes('SELECT value FROM')) return { rows: [{ value: marker }] };
    if (sql.includes('SELECT height,block_hash')) return { rows: [
      { height: checkpointHeight, block_hash: hash }, { height: CODE_REFERENCE_ACTIVATION_PARENT_HEIGHT, block_hash: CODE_REFERENCE_ACTIVATION_PARENT_HASH }] };
    if (sql.includes('count(*)::text')) return { rows: [{ count: '2' }] };
    if (sql.includes('source_canonical')) return { rows: [page].filter(row => args[1].includes(row.txid)) };
    if (sql.includes('SELECT t.*')) return { rows: codeRows };
    throw new Error(`Unexpected query: ${sql}`);
  } };
  const verifyCheckpoint = async height => height === CODE_REFERENCE_ACTIVATION_PARENT_HEIGHT ? CODE_REFERENCE_ACTIVATION_PARENT_HASH
    : height === checkpointHeight ? hash : pageHash;
  const coreCalls = [], coreOverrides = new Map();
  const rpc = async (method, args) => {
    coreCalls.push({ method, args });
    if (coreOverrides.has(method)) return coreOverrides.get(method)(args);
    if (method === 'getrawtransaction') return args[0] === page.txid ? { ok: true, result: { ...page.raw_tx,
      ...(page.status === 'confirmed' ? { blockhash: page.block_hash } : {}) } } : { ok: false, error: { code: -5 } };
    if (method === 'getblock') return { ok: true, result: { hash: page.block_hash, height: page.block_height,
      tx: ['f'.repeat(64), page.txid], confirmations: page.source_canonical === false ? -1 : 3 } };
    if (method === 'getblockhash') return { ok: true, result: args[0] === page.block_height && page.source_canonical === false
      ? 'e'.repeat(64) : await verifyCheckpoint(args[0]) };
    if (method === 'getblockchaininfo') return { ok: true, result: { chain: 'main', pruned: false, initialblockdownload: false,
      blocks: checkpointHeight, bestblockhash: hash } };
    if (method === 'getindexinfo') return { ok: true, result: { txindex: { synced: true, best_block_height: checkpointHeight } } };
    if (method === 'getmempoolentry') return { ok: false, error: { code: -5 } };
    throw new Error(`Unexpected Core RPC: ${method}`);
  };
  const resolveReferenceSource = request => codeReferenceSourceFromCore(request, rpc);
  return { page, root, commit, marker, client, calls, verifyCheckpoint, coreCalls, coreOverrides, rpc, resolveReferenceSource };
}
test('page endpoint exposes exact source at a pinned active canonical checkpoint', async () => {
  const f = referenceFixture();
  const value = await readCodePageSource(f.client, 'livenet', new URLSearchParams({ txid: f.page.txid }), f);
  assert.equal(value.referenceEnabled, true); assert.equal(value.sourceTxid, f.page.txid);
  assert.equal(value.snapshot.checkpointHeight, CODE_REFERENCE_ACTIVATION_HEIGHT);
  assert.deepEqual(value.sources, [{ kind: 'body', vout: 1, name: 'message-body.html', sha256: sha256(Buffer.from(sourceHtml)),
    size: Buffer.byteLength(sourceHtml), content: sourceHtml, contentBase64: Buffer.from(sourceHtml).toString('base64') }]);
});
test('reference dependencies remain outside Code candidate discovery and hydrate historical replay', async () => {
  const f = referenceFixture();
  const state = await readCodeSnapshot(f.client, 'livenet', new URLSearchParams(), f);
  assert.equal(state.repositories[0].headTxid, f.commit.txid);
  assert.equal(state.transactions.size, 2); assert.equal(state.referenceSources.size, 1);
  const { codeRepositoryPayload } = await import('../code-repositories.mjs');
  const detail = codeRepositoryPayload(state, new URLSearchParams({ repo: f.root.txid, version: f.commit.txid, path: 'pages/index.html' }));
  assert.equal(detail.file.txid, f.commit.txid); assert.equal(detail.file.sourceTxid, f.page.txid);
  assert.equal(detail.file.content, sourceHtml); assert.equal(detail.file.evidence.txid, f.commit.txid);
  assert.equal(detail.file.sourceEvidence.txid, f.page.txid);
  assert.equal(codeRepositoryPayload(state, new URLSearchParams({ repo: f.root.txid, version: f.root.txid })).files.length, 0);
});
test('source reads refuse missing, unconfirmed, reorged or tampered source evidence', async () => {
  for (const changes of [{ source_canonical: false }, { status: 'pending' }, { block_height: CODE_REFERENCE_ACTIVATION_HEIGHT + 1 }]) {
    const f = referenceFixture({ sourceChanges: changes });
    await assert.rejects(() => readCodePageSource(f.client, 'livenet', new URLSearchParams({ txid: f.page.txid }), f), /canonical|confirmed/);
  }
  const changed = referenceFixture(); changed.page.raw_tx.vout[1].scriptpubkey = op('pwm1:m:changed');
  await assert.rejects(() => readCodePageSource(changed.client, 'livenet', new URLSearchParams({ txid: changed.page.txid }), changed), /transaction ID/);
  const reorg = referenceFixture();
  reorg.coreOverrides.set('getblockhash', async args => ({ ok: true, result: args[0] === reorg.page.block_height ? 'd'.repeat(64) : await reorg.verifyCheckpoint(args[0]) }));
  await assert.rejects(() => readCodePageSource(reorg.client, 'livenet', new URLSearchParams({ txid: reorg.page.txid }), reorg), /unavailable/);
});
test('reference endpoint requires activation height and its exact pinned canonical parent', async () => {
  const f = referenceFixture();
  await assert.rejects(() => readCodePageSource(f.client, 'livenet', new URLSearchParams({ txid: f.page.txid }),
    { verifyCheckpoint: async height => height === CODE_REFERENCE_ACTIVATION_PARENT_HEIGHT ? 'd'.repeat(64) : f.verifyCheckpoint(height) }), /pinned parent/);
  const before = referenceFixture({ checkpointHeight: CODE_REFERENCE_ACTIVATION_HEIGHT - 2 });
  await assert.rejects(() => readCodePageSource(before.client, 'livenet', new URLSearchParams({ txid: before.page.txid }), before), /not active/);
});

test('authenticated source lookup uses Core for an old Page absent from indexed transaction rows', async () => {
  const f = referenceFixture();
  const state = await readCodeSnapshot(f.client, 'livenet', new URLSearchParams(), f);
  assert.equal(state.repositories[0].headTxid, f.commit.txid);
  assert.ok(f.coreCalls.some(call => call.method === 'getrawtransaction' && call.args[0] === f.page.txid));
  assert.ok(f.coreCalls.some(call => call.method === 'getblock' && call.args[0] === f.page.block_hash));
  assert.ok(!f.calls.some(call => call.sql.includes('source_canonical')));
});
test('complete Core absence rejects a random reference without blocking canonical Code reads', async () => {
  const f = referenceFixture({ metadataChanges: { sourceTxid: 'd'.repeat(64) } });
  const state = await readCodeSnapshot(f.client, 'livenet', new URLSearchParams(), f);
  assert.equal(state.repositories[0].headTxid, f.root.txid);
  assert.ok(state.events.find(event => event.txid === f.commit.txid).validationErrors.includes('code-reference-source-absent'));
  assert.equal(state.referenceSources.get('d'.repeat(64)).checkpointHash, hash);
  assert.equal(state.transactions.size, 2);
});
test('Core read failures and incomplete txindex never become negative source witnesses', async () => {
  for (const [method, response] of [
    ['getrawtransaction', { ok: false, error: { code: -28 } }],
    ['getindexinfo', { ok: true, result: { txindex: { synced: false, best_block_height: CODE_REFERENCE_ACTIVATION_HEIGHT } } }],
    ['getblockchaininfo', { ok: true, result: { chain: 'main', pruned: true, initialblockdownload: false,
      blocks: CODE_REFERENCE_ACTIVATION_HEIGHT, bestblockhash: hash } }],
    ['getmempoolentry', { ok: false, error: { code: -28 } }],
  ]) {
    const f = referenceFixture({ metadataChanges: { sourceTxid: 'd'.repeat(64) } });
    f.coreOverrides.set(method, async () => response);
    await assert.rejects(() => readCodeSnapshot(f.client, 'livenet', new URLSearchParams(), f), /unavailable/);
  }
});
test('Core source confirmation requires exact transaction membership, not matching block metadata alone', async () => {
  const f = referenceFixture();
  f.coreOverrides.set('getblock', async () => ({ ok: true, result: { hash: f.page.block_hash, height: f.page.block_height,
    tx: ['f'.repeat(64)], confirmations: 3 } }));
  await assert.rejects(() => readCodeSnapshot(f.client, 'livenet', new URLSearchParams(), f), /unavailable/);
});
test('confirmed replay fences the checkpoint after dependency hydration', async () => {
  const f = referenceFixture(); let checks = 0;
  const verifyCheckpoint = async height => height === CODE_REFERENCE_ACTIVATION_HEIGHT && ++checks > 1
    ? 'd'.repeat(64) : f.verifyCheckpoint(height);
  await assert.rejects(() => readCodeSnapshot(f.client, 'livenet', new URLSearchParams(), { ...f, verifyCheckpoint }), /checkpoint changed/);
});
