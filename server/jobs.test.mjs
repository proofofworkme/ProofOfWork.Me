import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createHash } from 'node:crypto';
import * as bitcoin from 'bitcoinjs-lib';
import { encodeJobRecord, parseJobBody, JOBS_ACTIVATION_HEIGHT } from '../src/shared/protocol/jobs.mjs';
import { verifyJobsTransaction, replayJobsTransactions, createJobsSnapshot, jobsPayload, jobPayload,
  jobsCandidateParts, jobsCandidateEventClosure, qualifyJobsLogPayload, isJobsCandidatePart } from './jobs.mjs';
import { canonicalRawProtocolRecordSetFromTransaction } from './canonical-op-return.mjs';
import { prefilterCodeRawBlock, assertCodeRawBlockCandidatesMatch } from './code-repositories.mjs';
const hash = 'f'.repeat(64), requester = 'requester', worker = 'worker', foreign = 'foreign';
const id = n => n.toString(16).padStart(64, '0');
function op(body) { const bytes = Buffer.from(body); return Buffer.concat([Buffer.from([0x6a, 0x4d, bytes.length & 255, bytes.length >> 8]), bytes]).toString('hex'); }
function tx(n, author, target, amount, action, metadata) {
  return { txid: id(n), status: { confirmed: true, block_height: JOBS_ACTIVATION_HEIGHT, block_hash: hash }, blockTransactionIndex: n, timestamp: 1700000000,
    vin: [{ prevout: { scriptpubkey_address: author } }],
    vout: [{ scriptpubkey: '51', scriptpubkey_address: target, value: amount }, { scriptpubkey: op(`pwm1:m:${encodeJobRecord(action, metadata)}`), value: 0 }] };
}
function lifecycle() {
  return [tx(1,requester,requester,'546','brief',{v:1,title:'Fix parser',scope:'Initial brief\n',rewardSats:'1000'}),
    tx(2,worker,requester,'546','propose',{v:1,job:id(1),scope:'Agreed scope\n',rewardSats:'1200'}),
    tx(3,requester,worker,'546','assign',{v:1,job:id(1),proposal:id(2)}),
    tx(4,worker,requester,'546','deliver',{v:1,job:id(1),assignment:id(3),text:'Delivery\n',artifacts:[id(50)]}),
    tx(5,requester,worker,'1200','accept',{v:1,job:id(1),delivery:id(4)})];
}
test('closed canonical codec preserves scope bytes and rejects alternate/unsafe metadata encodings', () => {
  const body = encodeJobRecord('brief', {v:1,title:'Exact scope',scope:'é\r\n\t',rewardSats:'546'});
  assert.equal(parseJobBody(body).metadata.scope,'é\r\n\t');
  const encode = text => `pwj1:brief:${Buffer.from(text).toString('base64url')}`;
  for (const json of ['{"title":"x","v":1,"scope":"x","rewardSats":"546"}', '{"v":1,"title":"x","scope":"x","rewardSats":"546","x":0}',
    '{"v":1,"v":1,"title":"x","scope":"x","rewardSats":"546"}', '{"v":1,"title":"x","scope":"x","rewardSats":546}',
    '{"v":2,"title":"x","scope":"x","rewardSats":"546"}']) assert.equal(parseJobBody(encode(json)),null);
  assert.equal(parseJobBody(body+'='),null);
  assert.throws(()=>encodeJobRecord('brief',{v:1,title:'x',scope:'x',rewardSats:'0546'}));
  assert.throws(()=>encodeJobRecord('brief',{v:1,title:'x',scope:'\ud800',rewardSats:'546'}));
  assert.throws(()=>encodeJobRecord('deliver',{v:1,job:id(1),assignment:id(3),text:'x',artifacts:[id(4),id(4)]}));
  assert.throws(()=>encodeJobRecord('propose',{v:1,job:[id(1)],scope:'x',rewardSats:'546'}));
  assert.throws(()=>encodeJobRecord('deliver',{v:1,job:id(1),assignment:id(3),text:'x',artifacts:[[id(4)]]}));
});
test('confirmed lifecycle freezes proposal roles/terms and exact acceptance payment once', () => {
  const records = lifecycle(), state = replayJobsTransactions(records.reverse());
  assert.equal(state.jobs[0].status,'paid'); assert.equal(state.jobs[0].requesterAddress,requester);
  assert.equal(state.jobs[0].workerAddress,worker); assert.equal(state.jobs[0].rewardSats,'1200');
  assert.equal(state.jobs[0].offeredRewardSats,'1000'); assert.equal(state.jobs[0].scope,'Agreed scope\n');
  assert.equal(state.jobs[0].paymentTxid,id(5)); assert.equal(state.events.filter(event=>event.applied).length,5);
  const snapshot = createJobsSnapshot({network:'livenet',checkpointHeight:JOBS_ACTIVATION_HEIGHT,checkpointHash:hash,transactions:records});
  assert.deepEqual(jobsPayload(snapshot).stats,{jobs:1,open:0,assigned:0,delivered:0,paid:1,cancelled:0,proposals:1,deliveries:1,acceptedPayments:1,paidProofs:'1200',events:5,invalidEvents:0});
  assert.equal(jobPayload(snapshot,new URLSearchParams({job:id(1)})).proposalsComplete,true);
});
test('wrong roles, target, changed reward and change outputs cannot claim payment', () => {
  for (const mutate of [t=>t.vin[0].prevout.scriptpubkey_address=foreign,t=>t.vout[0].scriptpubkey_address=requester,
    t=>t.vout[0].value='1199',t=>t.vout[0].value='1201',t=>{t.vout.push(t.vout.shift());}]) {
    const records=lifecycle(); mutate(records[4]); const state=replayJobsTransactions(records);
    assert.equal(state.jobs[0].status,'delivered'); assert.equal(state.jobs[0].paidSats,'0'); assert.equal(state.events[4].applied,false);
  }
  const records=lifecycle(); records[1].vin[0].prevout.scriptpubkey_address=requester;
  assert.equal(replayJobsTransactions(records).events[1].validationErrors.includes('jobs-proposal-not-allowed'),true);
});
test('pending evidence and stale deliveries/assignments do not alter confirmed authority', () => {
  const records=lifecycle(); records[4].status={confirmed:false};
  assert.equal(replayJobsTransactions(records).jobs[0].status,'delivered');
  const newer=tx(6,worker,requester,'546','deliver',{v:1,job:id(1),assignment:id(3),text:'New evidence',artifacts:[]});
  const stale=tx(7,requester,worker,'1200','accept',{v:1,job:id(1),delivery:id(4)});
  const state=replayJobsTransactions([...lifecycle().slice(0,4),newer,stale]);
  assert.equal(state.jobs[0].deliveryTxid,id(6)); assert.equal(state.jobs[0].status,'delivered');
  assert.equal(state.events.at(-1).validationErrors.includes('jobs-delivery-stale'),true);
  const cancel=tx(8,requester,requester,'546','cancel',{v:1,job:id(1),reason:'Withdraw offer'});
  assert.equal(replayJobsTransactions([lifecycle()[0],cancel]).jobs[0].status,'cancelled');
});
test('raw scripts, complete authority, exact positions and unambiguous Mail body are required', () => {
  for (const mutate of [t=>delete t.vin[0].prevout,t=>t.vin.push({prevout:{scriptpubkey_address:foreign}}),t=>t.vin[0].coinbase='00',
    t=>delete t.blockTransactionIndex,t=>t.vout[1].value=1,t=>t.vout.push({value:0,scriptpubkey:op('pwb1:like:'+id(4))}),
    t=>t.vout.push({value:0,scriptpubkey:op('pwm1:m:extra')}),t=>t.vout[1].scriptpubkey += '51']) {
    const record=lifecycle()[0]; mutate(record); assert.equal(verifyJobsTransaction(record).valid,false);
  }
  assert.throws(()=>replayJobsTransactions([lifecycle()[0],lifecycle()[0]]),/duplicate/);
  const records=lifecycle().slice(0,2);records[1].blockTransactionIndex=1; assert.throws(()=>replayJobsTransactions(records),/ambiguous/);
  records[1].blockTransactionIndex=2;records[1].status.block_hash=id(99);assert.throws(()=>replayJobsTransactions(records),/ambiguous/);
});
test('delivery Files bytes are independently verified; references remain statements', () => {
  const delivery=lifecycle()[3],bytes=Buffer.from('work\r\n'),hash=createHash('sha256').update(bytes).digest('hex');
  const payload=`pwm1:a:${Buffer.from('text/plain').toString('base64url')}:${Buffer.from('proof.txt').toString('base64url')}:${bytes.length}:${hash}:0/1:${bytes.toString('base64url')}`;
  delivery.vout.push({value:0,scriptpubkey:op(payload)});
  assert.equal(verifyJobsTransaction(delivery).attachment.sha256,hash);
  delivery.vout.at(-1).scriptpubkey=op(payload.replace(hash,id(99)));
  assert.equal(verifyJobsTransaction(delivery).valid,false);
});
test('Log association preserves underlying Mail economics and only adds qualified Jobs authority',()=>{
  const state=replayJobsTransactions(lifecycle()); const original={txid:id(5),protocol:'pwm1',kind:'reply',amountSats:'1200',valid:true,memo:lifecycle()[4].vout[1]};
  const payload=qualifyJobsLogPayload({items:[original]},state.events,{checkpointHeight:JOBS_ACTIVATION_HEIGHT,checkpointHash:hash});
  assert.equal(payload.items[0].kind,'reply');assert.equal(payload.items[0].amountSats,'1200');assert.equal(payload.items[0].valid,true);
  assert.equal(payload.items[0].jobs.applied,true);
});
test('raw Core walker covers malformed Jobs bodies at exact script boundaries and leaves Code defaults intact',()=>{
  const coinbase=new bitcoin.Transaction();coinbase.addInput(Buffer.alloc(32),0xffffffff,0xffffffff,Buffer.from('0101','hex'));coinbase.addOutput(Buffer.from('76a914'+'00'.repeat(20)+'88ac','hex'),546n);
  const candidate=new bitcoin.Transaction();candidate.addInput(Buffer.from(id(9),'hex'),0,0xffffffff,Buffer.alloc(0));candidate.addOutput(Buffer.from(op('pwm1:m:pwj1:malformed')+'51','hex'),0n);
  const block=new bitcoin.Block();block.version=1;block.prevHash=Buffer.from(hash,'hex').reverse();block.merkleRoot=Buffer.alloc(32);block.timestamp=1700000000;block.bits=0;block.nonce=0;block.transactions=[coinbase,candidate];
  const blockHash=Buffer.from(block.getHash()).reverse().toString('hex');
  const options={blockHash,previousBlockHash:hash,candidatePredicate:isJobsCandidatePart};
  const found=prefilterCodeRawBlock(block.toHex(),options);
  assert.equal(found.candidates.length,1);assert.equal(found.candidates[0].txid,candidate.getId());
  assert.equal(prefilterCodeRawBlock(block.toHex(),{blockHash,previousBlockHash:hash}).candidates.length,0);
  assertCodeRawBlockCandidatesMatch(found,{hash:blockHash,previousblockhash:hash,time:block.timestamp,nTx:2,tx:[{txid:coinbase.getId(),vout:[]},{txid:candidate.getId(),vout:[{scriptpubkey:Buffer.from(candidate.outs[0].script).toString('hex')}]}]},isJobsCandidatePart);
});
test('Jobs discovery closes one exact existing PWM event and complete raw replay witness',()=>{
  const transaction=lifecycle()[0],record=canonicalRawProtocolRecordSetFromTransaction(transaction).records[0];
  const position={blockHeight:JOBS_ACTIVATION_HEIGHT,blockHash:hash,blockTransactionIndex:1};
  const rows=[{txid:transaction.txid,protocol:'pwm1',status:'confirmed',block_height:JOBS_ACTIVATION_HEIGHT,block_index:1,op_return_vout:1,record_ordinal:0,raw_payload:record.message,valid:true,payload:{_workAmoV5ReplayBound:true,workAmoV5RawCandidate:true}}];
  const transition={block_height:JOBS_ACTIVATION_HEIGHT,block_hash:hash,payload:{replayRecords:[{txid:transaction.txid,protocol:'pwm1',rawCandidate:true,position:{...position,protocolVout:1,recordOrdinal:0},outcome:{valid:true},rawWitness:{rawRecordParts:record.rawRecordParts}}]}};
  assert.equal(jobsCandidateEventClosure(transaction,rows,position,transition),true);
  assert.equal(jobsCandidateEventClosure(transaction,[],position,transition),false);
  transition.payload.replayRecords[0].rawWitness.rawRecordParts=[];assert.equal(jobsCandidateEventClosure(transaction,rows,position,transition),false);
  assert.equal(jobsCandidateParts(transaction).length,1);
});
test('first-release activation does not reinterpret earlier Jobs-shaped Mail as lifecycle authority',()=>{
  const transaction=lifecycle()[0];transaction.status.block_height=JOBS_ACTIVATION_HEIGHT-1;
  const state=replayJobsTransactions([transaction]);assert.equal(state.jobs.length,0);
  assert.equal(state.events[0].validationErrors.includes('jobs-before-activation'),true);
});
