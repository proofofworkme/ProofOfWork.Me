import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as bitcoin from 'bitcoinjs-lib';
import { encodeJobRecord, JOBS_ACTIVATION_HEIGHT, JOBS_ACTIVATION_PREVIOUS_BLOCK_HASH, JOBS_V2_ACTIVATION_HEIGHT,
  JOBS_V2_ACTIVATION_PREVIOUS_BLOCK_HASH, JOBS_WORK_TOKEN_ID, JOBS_WORK_REGISTRY_ADDRESS } from '../../src/shared/protocol/jobs.mjs';
import { codeTransactionFromRow } from './code-reader.mjs';
import { readJobsSnapshot, readJobsWorkSettlementEvidence } from './jobs-reader.mjs';
import { JOBS_DISCOVERY_MODEL, JOBS_DISCOVERY_EMPTY_SHA256, advanceJobsCandidateDigest, jobsPayload,
  verifyJobsTransaction, verifyJobsWorkSettlement } from '../jobs.mjs';
import { decodeCanonicalOpReturnOutput, canonicalRawProtocolRecordSetFromTransaction } from '../canonical-op-return.mjs';
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

test('v2 admission independently verifies its immutable parent and complete original discovery coverage',async()=>{
  for(const mismatch of ['', 'indexed-parent', 'core-parent', 'duplicate-parent']){
    const fixtureValue=fixture({indexedThroughBlock:JOBS_V2_ACTIVATION_HEIGHT,indexedThroughBlockHash:hash}), original=fixtureValue.client.query;
    fixtureValue.client.query=async(sql,args)=>{
      if(sql.includes('jobs_v2_activation_parent')){
        assert.deepEqual(args,['livenet',JOBS_V2_ACTIVATION_HEIGHT-1]);
        return {rows:mismatch==='duplicate-parent'?[{block_hash:JOBS_V2_ACTIVATION_PREVIOUS_BLOCK_HASH},{block_hash:hash}]:
          [{block_hash:mismatch==='indexed-parent'?hash:JOBS_V2_ACTIVATION_PREVIOUS_BLOCK_HASH}]};
      }
      if(sql.includes('SELECT height,block_hash'))return {rows:[{height:JOBS_V2_ACTIVATION_HEIGHT,block_hash:hash}]};
      return original(sql,args);
    };
    const verifyCheckpoint=async height=>height===JOBS_ACTIVATION_HEIGHT-1?JOBS_ACTIVATION_PREVIOUS_BLOCK_HASH:
      height===JOBS_V2_ACTIVATION_HEIGHT-1?(mismatch==='core-parent'?hash:JOBS_V2_ACTIVATION_PREVIOUS_BLOCK_HASH):hash;
    if(mismatch)await assert.rejects(()=>readJobsSnapshot(fixtureValue.client,'livenet',new URLSearchParams(),{verifyCheckpoint}),/version-two activation parent/);
    else {
      const state=await readJobsSnapshot(fixtureValue.client,'livenet',new URLSearchParams(),{verifyCheckpoint});
      assert.equal(jobsPayload(state).versions.v2Ready,true);
      assert.equal(state.jobs[0].reward.asset,'proofs');
    }
  }
  const {client}=fixture();
  const earlier=await readJobsSnapshot(client,'livenet',new URLSearchParams(),{verifyCheckpoint:async height=>height===JOBS_ACTIVATION_HEIGHT-1?JOBS_ACTIVATION_PREVIOUS_BLOCK_HASH:hash});
  assert.equal(jobsPayload(earlier).versions.v2Ready,false);
});

function settlementCandidate(confirmed=true){
  const pay=(address,value)=>({scriptpubkey:Buffer.from(bitcoin.address.toOutputScript(address)).toString('hex'),scriptpubkey_address:address,value});
  return {txid,status:confirmed?{confirmed:true,block_height:JOBS_V2_ACTIVATION_HEIGHT,block_hash:hash}:{confirmed:false},blockTransactionIndex:1,
    vin:[{prevout:pay(owner,'2000')}],vout:[pay(owner,'546'),{scriptpubkey:op('pwm1:m:'+encodeJobRecord('accept',{v:2,job:'1'.repeat(64),delivery:'2'.repeat(64)})),value:'0'},
      pay(JOBS_WORK_REGISTRY_ADDRESS,'546'),{scriptpubkey:op(`pwt1:send3:${JOBS_WORK_TOKEN_ID}:1:${owner}`),value:'0'}]};
}
function settlementEvidence(valid=true){
  const transaction=settlementCandidate(),event=verifyJobsTransaction(transaction);
  const parts=canonicalRawProtocolRecordSetFromTransaction(transaction).records;
  const position={blockHeight:JOBS_V2_ACTIVATION_HEIGHT,blockHash:hash,blockTransactionIndex:1,protocolVout:3,recordOrdinal:0};
  const rawWitness={rawRecordParts:parts.find(item=>item.protocol==='pwt1').rawRecordParts};
  const outcome={valid,kind:valid?'pwt1-valid':'pwt1-invalid',reasonCode:valid?'':'work-amo-v5-raw-transfer-state-invalid'};
  const witness={txid,protocol:'pwt1',position,rawCandidate:true,rawWitness,outcome,output:valid?{projection:{}}:null};
  const trace={txid,kind:'protocol-record',position,rawWitness,valid,reasonCode:outcome.reasonCode,output:witness.output};
  const mailWitness={txid,protocol:'pwm1',position:{...position,protocolVout:event.protocolVout},rawCandidate:true,
    rawWitness:{rawRecordParts:parts.find(item=>item.protocol==='pwm1').rawRecordParts},outcome:{valid:true}};
  const mailTrace={...mailWitness,kind:'protocol-record',valid:true};
  return {txid,status:'confirmed',valid,transition:{complete:true,block_atomic:true,fee_once:true,invalid_zero:true,
    payload:{replayRecords:[mailWitness,witness],traces:[mailTrace,trace]}}};
}
test('WORK reads use the exact native accessor signature or complete inline witness source',async()=>{
  for(const native of [false,true]){
    const transaction=settlementCandidate(),queries=[];
    const row=settlementEvidence();
    const client={async query(sql,args){queries.push(sql);
      if(sql.includes('jobs_transition_storage_accessor')){
        assert.match(sql,/to_regprocedure\('proof_indexer\.read_work_transition_payload_v1\(text,integer,text,jsonb\)'\)/);
        return {rows:[{present:native}]};
      }
      assert.match(sql,/jobs_canonical_work_settlement/);assert.deepEqual(args,['livenet',[txid]]);
      assert.equal(sql.includes("witness.payload->'replayRecords'"),native);
      assert.equal(sql.includes('read_work_transition_payload_v1(transition.network'),native);
      assert.match(sql,/transition\.previous_block_hash=block\.previous_block_hash/);
      assert.match(sql,/block\.canonical=true/);assert.match(sql,/e\.txid=ANY\(\$2::text\[\]\)/);
      return {rows:[row]};
    }};
    await readJobsWorkSettlementEvidence(client,'livenet',[transaction]);
    assert.deepEqual(transaction._jobsWorkSettlementEvidence,[row]);assert.equal(queries.length,2);
  }
});
test('missing or incomplete WORK settlement witnesses make reads unavailable rather than asserting zero paid',async()=>{
  for(const rows of [[],[{txid,status:'pending'}],[{txid,status:'confirmed',transition:{complete:false}}],
    [{txid,status:'confirmed',transition:{complete:true,block_atomic:true,fee_once:true,invalid_zero:true,payload:{replayRecords:[]}}}],
    [{txid,status:'confirmed'},{txid,status:'confirmed'}]]){
    const client={async query(sql){return {rows:sql.includes('jobs_transition_storage_accessor')?[{present:false}]:rows};}};
    await assert.rejects(()=>readJobsWorkSettlementEvidence(client,'livenet',[settlementCandidate()]),error=>error.details?.code==='JOBS_WORK_SETTLEMENT_UNAVAILABLE');
  }
  const client={async query(){throw new Error('Pending work must never query accepted settlement evidence.');}};
  await readJobsWorkSettlementEvidence(client,'livenet',[settlementCandidate(false)]);
  const old=settlementCandidate();old.status.block_height=JOBS_V2_ACTIVATION_HEIGHT-1;
  await readJobsWorkSettlementEvidence(client,'livenet',[old]);
});
test('PWM entries cannot hide absent or ambiguous PWT source witnesses and traces',async()=>{
  const mutations=[
    row=>{row.transition.payload.replayRecords.pop();},
    row=>{row.transition.payload.traces.pop();},
    row=>{row.transition.payload.replayRecords[1].position={...row.transition.payload.replayRecords[1].position,protocolVout:2};},
    row=>{row.transition.payload.traces[1].position={...row.transition.payload.traces[1].position,recordOrdinal:1};},
    row=>{row.transition.payload.replayRecords.push(structuredClone(row.transition.payload.replayRecords[1]));},
    row=>{row.transition.payload.traces.push(structuredClone(row.transition.payload.traces[1]));},
    row=>{delete row.transition.payload.replayRecords[1].rawWitness;},
    row=>{row.transition.payload.traces[1].rawWitness={rawRecordParts:[]};},
    row=>{delete row.transition.payload.replayRecords[1].outcome;},
    row=>{delete row.transition.payload.traces[1].valid;},
  ];
  for(const mutate of mutations){
    const row=settlementEvidence();mutate(row);
    assert(row.transition.payload.replayRecords.length>0&&row.transition.payload.traces.length>0);
    const client={async query(sql){return {rows:sql.includes('jobs_transition_storage_accessor')?[{present:false}]:[row]};}};
    await assert.rejects(()=>readJobsWorkSettlementEvidence(client,'livenet',[settlementCandidate()]),
      error=>error.statusCode===503&&error.details?.code==='JOBS_WORK_SETTLEMENT_UNAVAILABLE');
  }
});
test('complete confirmed invalid WORK replay remains available as unpaid rejection evidence',async()=>{
  const row=settlementEvidence(false),transaction=settlementCandidate();
  const client={async query(sql){return {rows:sql.includes('jobs_transition_storage_accessor')?[{present:false}]:[row]};}};
  await readJobsWorkSettlementEvidence(client,'livenet',[transaction]);
  assert.equal(transaction._jobsWorkSettlementEvidence[0].transition.payload.replayRecords[1].outcome.valid,false);
  assert.equal(transaction._jobsWorkSettlementEvidence[0].transition.payload.replayRecords[1].output,null);
  assert.equal(verifyJobsWorkSettlement(transaction,verifyJobsTransaction(transaction),owner,
    {asset:'WORK',token:JOBS_WORK_TOKEN_ID,amountSubatoms:'1'}).valid,false);
});
