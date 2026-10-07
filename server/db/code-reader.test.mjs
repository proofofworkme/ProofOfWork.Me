import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as bitcoin from 'bitcoinjs-lib';
import { encodeCodeRepository } from '../../src/shared/protocol/codeRepository.mjs';
import { codeTransactionFromRow, readCodeSnapshot } from './code-reader.mjs';
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
