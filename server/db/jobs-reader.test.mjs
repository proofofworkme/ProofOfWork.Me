import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as bitcoin from 'bitcoinjs-lib';
import { encodeJobRecord, JOBS_ACTIVATION_HEIGHT, JOBS_ACTIVATION_PREVIOUS_BLOCK_HASH } from '../../src/shared/protocol/jobs.mjs';
import { codeTransactionFromRow } from './code-reader.mjs';
import { readJobsSnapshot } from './jobs-reader.mjs';
import { JOBS_DISCOVERY_MODEL, JOBS_DISCOVERY_EMPTY_SHA256, advanceJobsCandidateDigest, jobsPayload } from '../jobs.mjs';
import { decodeCanonicalOpReturnOutput } from '../canonical-op-return.mjs';
const hash = 'b'.repeat(64), txid = 'a'.repeat(64), owner = '1F1p9UEHuH5KTFR7Zsx93Khdrqhj6t5nFv';
const payScript = Buffer.from(bitcoin.address.toOutputScript(owner)).toString('hex');
function op(text) {
  const bytes = Buffer.from(text);
  return Buffer.concat([Buffer.from([0x6a, 0x4d, bytes.length & 255, bytes.length >> 8]), bytes]).toString('hex');
}
function row() {
  const vout = [{ scriptpubkey: payScript, value: 546 }, { scriptpubkey: op('pwm1:m:' + encodeJobRecord('brief', { v: 1, title: 'source', scope: 'Scoped work', rewardSats: '1000' })), value: 0 }];
  const serialized = new bitcoin.Transaction(); serialized.version = 2;
  serialized.addInput(Buffer.from(txid,'hex').reverse(),0,0xffffffff,Buffer.alloc(0));
  for(const output of vout) serialized.addOutput(Buffer.from(output.scriptpubkey,'hex'),BigInt(output.value));
  const actualTxid=serialized.getId();
  return { txid:actualTxid, status: 'confirmed', block_height: JOBS_ACTIVATION_HEIGHT, block_hash: hash, block_index: 1,
    raw_tx: { txid:actualTxid,version:2,locktime:0,hex:serialized.toHex(),vin: [{txid,vout:0,sequence:0xffffffff,prevout: { scriptpubkey: payScript, value: 1000 } }], vout,
      canonicalBlockScan: { height: JOBS_ACTIVATION_HEIGHT, blockHash: hash, blockIndex: 1 } },
    outputs: vout.map((output, index) => ({ vout: index, value_sats: String(output.value), scriptpubkey: output.scriptpubkey })) };
}
function fixture(changes = {}) {
  const raw = row();
  const normalized = codeTransactionFromRow(raw, 'livenet');
  const marker = { model: JOBS_DISCOVERY_MODEL, network: 'livenet', fromHeight: JOBS_ACTIVATION_HEIGHT, complete: true,
    indexedThroughBlock: JOBS_ACTIVATION_HEIGHT, indexedThroughBlockHash: hash, candidateCount: 1,
    candidateSha256: advanceJobsCandidateDigest(JOBS_DISCOVERY_EMPTY_SHA256, normalized), ...changes };
  return { raw, marker, client: { async query(sql) {
    if (sql.includes('SELECT value FROM')) return { rows: [{ value: marker }] };
    if (sql.includes('SELECT height,block_hash')) return { rows: [{ height: JOBS_ACTIVATION_HEIGHT, block_hash: hash }] };
    if (sql.includes('count(*)::text')) return { rows: [{ count: '1' }] };
    if (sql.includes('SELECT t.*')) return { rows: [raw] };
    throw new Error(`Unexpected query: ${sql}`);
  } } };
}
test('complete discovery corpus opens canonical reads and resumes only its exact source witness', async () => {
  const { client } = fixture();
  const state = await readJobsSnapshot(client, 'livenet', new URLSearchParams(), { verifyCheckpoint: async height => height === JOBS_ACTIVATION_HEIGHT - 1 ? JOBS_ACTIVATION_PREVIOUS_BLOCK_HASH : hash });
  assert.equal(state.jobs.length, 1);
  assert.equal(state.snapshot.checkpointHeight, JOBS_ACTIVATION_HEIGHT);
  assert.equal(state.jobs[0].requesterAddress, owner);
  await assert.rejects(() => readJobsSnapshot(client, 'livenet', new URLSearchParams(), { verifyCheckpoint: async () => 'c'.repeat(64) }), /canonical node|activation parent/);
});
test('missing, partial or altered discovery coverage fails closed', async () => {
  for (const changes of [{ complete: false }, { fromHeight: 4 }, { candidateCount: 0 }, { candidateSha256: 'c'.repeat(64) }]) {
    const { client } = fixture(changes);
    await assert.rejects(() => readJobsSnapshot(client, 'livenet', new URLSearchParams(), { verifyCheckpoint: async height => height === JOBS_ACTIVATION_HEIGHT - 1 ? JOBS_ACTIVATION_PREVIOUS_BLOCK_HASH : hash }), /discovery|corpus/i);
  }
});
test('an active bootstrap preserves explicitly identified last-good canonical coverage', async () => {
  const ready = fixture().marker;
  const { client } = fixture({ complete: false, lastGood: ready, indexedThroughBlock: JOBS_ACTIVATION_HEIGHT + 1, indexedThroughBlockHash: 'c'.repeat(64) });
  const state = await readJobsSnapshot(client, 'livenet', new URLSearchParams(), { verifyCheckpoint: async height => height === JOBS_ACTIVATION_HEIGHT - 1 ? JOBS_ACTIVATION_PREVIOUS_BLOCK_HASH : hash });
  assert.equal(state.snapshot.checkpointHeight, JOBS_ACTIVATION_HEIGHT);
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
  const state=await readJobsSnapshot(client,'livenet',new URLSearchParams(),{verifyCheckpoint:async height => height === JOBS_ACTIVATION_HEIGHT - 1 ? JOBS_ACTIVATION_PREVIOUS_BLOCK_HASH : hash});
  assert.equal(state.jobs.length,1);
  assert.equal(state.pendingEvents.length,0);
  assert.deepEqual(state.pendingWarnings,[{txid:'d'.repeat(64),reason:'pending-raw-evidence-unavailable'}]);
});

test('pinned parent yields zero authoritative jobs and rejects every earlier checkpoint', async () => {
  const marker = { model: JOBS_DISCOVERY_MODEL, network: 'livenet', fromHeight: JOBS_ACTIVATION_HEIGHT, complete: true,
    indexedThroughBlock: JOBS_ACTIVATION_HEIGHT - 1, indexedThroughBlockHash: JOBS_ACTIVATION_PREVIOUS_BLOCK_HASH,
    candidateCount: 0, candidateSha256: JOBS_DISCOVERY_EMPTY_SHA256 };
  const client = { async query(sql) {
    if (sql.includes('SELECT value FROM')) return { rows: [{ value: marker }] };
    if (sql.includes('SELECT height,block_hash')) return { rows: [{ height: marker.indexedThroughBlock, block_hash: marker.indexedThroughBlockHash }] };
    if (sql.includes('count(*)::text')) return { rows: [{ count: '0' }] };
    if (sql.includes('SELECT t.*')) return { rows: [] };
    throw new Error(`Unexpected query: ${sql}`);
  } };
  const state = await readJobsSnapshot(client, 'livenet', new URLSearchParams(), { verifyCheckpoint: async () => JOBS_ACTIVATION_PREVIOUS_BLOCK_HASH });
  const payload = jobsPayload(state);
  assert.equal(payload.complete, true); assert.equal(payload.jobs.length, 0); assert.equal(payload.stats.jobs, 0);
  assert.equal(payload.activationHeight, JOBS_ACTIVATION_HEIGHT);
  const earlier = Buffer.from(JSON.stringify({ model: state.snapshot.model, network: 'livenet', checkpointHeight: JOBS_ACTIVATION_HEIGHT - 2, checkpointHash: hash })).toString('base64url');
  await assert.rejects(() => readJobsSnapshot(client, 'livenet', new URLSearchParams({ snapshot: earlier }), { verifyCheckpoint: async () => JOBS_ACTIVATION_PREVIOUS_BLOCK_HASH }), /first-admission boundary/);
  marker.candidateCount = 1;
  await assert.rejects(() => readJobsSnapshot(client, 'livenet', new URLSearchParams(), { verifyCheckpoint: async () => JOBS_ACTIVATION_PREVIOUS_BLOCK_HASH }), /discovery is incomplete/);
});
