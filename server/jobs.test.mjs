import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createHash } from 'node:crypto';
import * as bitcoin from 'bitcoinjs-lib';
import { encodeJobRecord, parseJobBody, JOBS_ACTIVATION_HEIGHT, JOBS_V2_ACTIVATION_HEIGHT, JOBS_V2_ACTIVATION_PREVIOUS_BLOCK_HASH,
  JOBS_WORK_TOKEN_ID, JOBS_WORK_REGISTRY_ADDRESS, JOBS_WORK_MAX_SUBATOMS, jobRewardFromMetadata, normalizeJobReward,
  parseJobWorkDecimal, formatJobWorkSubatoms, formatJobReward } from '../src/shared/protocol/jobs.mjs';
import { verifyJobsTransaction, verifyJobsWorkSettlement, replayJobsTransactions, createJobsSnapshot, jobsPayload, jobPayload,
  jobsCandidateParts, jobsCandidateEventClosure, qualifyJobsLogPayload, isJobsCandidatePart } from './jobs.mjs';
import { canonicalRawProtocolRecordSetFromTransaction } from './canonical-op-return.mjs';
import { prefilterCodeRawBlock, assertCodeRawBlockCandidatesMatch } from './code-repositories.mjs';
import { WORK_AMO_V5_STATE_COMMITMENT_MODEL, WORK_AMO_V5_EVENT_SET_COMMITMENT_MODEL,
  WORK_AMO_V5_NETWORK_ACCUMULATOR_MODEL, WORK_AMO_V5_BASE_STATE_FIELDS } from './work-amo-v5.mjs';
import { WORK_AMO_V8_BLOCK_SEQUENCER_MODEL, workAmoV8CanonicalTokenStateCommitment } from './work-amo-v8.mjs';
import { WORK_AMO_V5_RAW_TRANSITION_CHAIN_MODEL, replayWorkAmoV5RawBlock, normalizeWorkAmoV5RawGenericState,
  normalizeWorkAmoV5RawIdState, normalizeWorkAmoV5RawWorkState, workAmoV5RawGenericStateCommitment,
  workAmoV5RawIdStateCommitment } from './work-amo-v5-raw.mjs';
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
  assert.deepEqual(jobsPayload(snapshot).stats,{jobs:1,open:0,assigned:0,delivered:0,paid:1,cancelled:0,proposals:1,deliveries:1,acceptedPayments:1,paidProofs:'1200',paidWorkSubatoms:'0',events:5,invalidEvents:0});
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

const workReward = (amountSubatoms = '10000000000000001') => ({ asset: 'WORK', token: JOBS_WORK_TOKEN_ID, amountSubatoms });
function workLifecycle() {
  // The worker may offer a different currency from the initial proof brief.
  const records = lifecycle();
  records[1] = tx(2,worker,requester,'546','propose',{v:2,job:id(1),scope:'Exact WORK agreement',reward:workReward()});
  records[2] = tx(3,requester,worker,'546','assign',{v:2,job:id(1),proposal:id(2)});
  records[3] = tx(4,worker,requester,'546','deliver',{v:2,job:id(1),assignment:id(3),text:'Delivered WORK task',artifacts:[]});
  records[4] = tx(5,requester,worker,'546','accept',{v:2,job:id(1),delivery:id(4)});
  for (const record of records) record.status.block_height = JOBS_V2_ACTIVATION_HEIGHT;
  const acceptance = records[4], text = `pwt1:send3:${JOBS_WORK_TOKEN_ID}:${workReward().amountSubatoms}:${worker}`;
  acceptance.vout.push({ scriptpubkey:'51',scriptpubkey_address:JOBS_WORK_REGISTRY_ADDRESS,value:'546' }, {scriptpubkey:op(text),value:0});
  attachWorkEvidence(acceptance);
  return records;
}
function attachWorkEvidence(transaction) {
  const raw = canonicalRawProtocolRecordSetFromTransaction(transaction).records;
  const record = raw.find(item=>item.protocol==='pwt1'), mail = raw.find(item=>item.protocol==='pwm1');
  const parts = record.message.split(':'), amountSubatoms = parts[3], recipientAddress = parts[4];
  const position = { blockHeight:transaction.status.block_height,blockHash:transaction.status.block_hash,
    blockTransactionIndex:transaction.blockTransactionIndex,protocolVout:record.protocolVout,recordOrdinal:0 };
  const commitment = {model:WORK_AMO_V5_RAW_TRANSITION_CHAIN_MODEL,payloadBytes:100,sha256:id(70)};
  const projection = {txid:transaction.txid,protocol:'pwt1',kind:'token-transfer',valid:true,position,
    senderAddress:requester,recipientAddress,tokenId:JOBS_WORK_TOKEN_ID,amountSubatoms,
    parsed:{kind:'send',amountVersion:'send3',tokenId:JOBS_WORK_TOKEN_ID,amountSubatoms,recipientAddress,payload:record.message}};
  const stateDelta = {baseContributions:[{field:'tokenTransferFlowSats',value:'546'}],creditFixedSats:'546',
    economicOutputs:[{address:JOBS_WORK_REGISTRY_ADDRESS,attributedSats:'546',outputSats:'546',role:'pwt-token-registry',vout:2}],
    movement:{amountStorageModel:'work-subatoms-v2',amountSubatoms,identity:`transfer:${transaction.txid}:3:0`}};
  const witness={txid:transaction.txid,protocol:'pwt1',rawCandidate:true,position,outcome:{valid:true,kind:'pwt1-valid',reasonCode:''},
    output:{amountSubatoms,senderAddress:requester,recipientAddress,tokenId:JOBS_WORK_TOKEN_ID,projection},
    rawWitness:{model:'canonical-raw-protocol-record-v1',rawRecordParts:record.rawRecordParts},stateDelta,transitionChainCommitmentAfter:commitment};
  const mailWitness={txid:transaction.txid,protocol:'pwm1',rawCandidate:true,
    position:{...position,protocolVout:mail.protocolVout},outcome:{valid:true},rawWitness:{rawRecordParts:mail.rawRecordParts}};
  const trace={txid:transaction.txid,kind:'protocol-record',position,valid:true,reasonCode:'',output:witness.output,
    rawWitness:witness.rawWitness,stateDelta,transitionChainCommitmentAfter:commitment};
  const mailEvents=[{txid:transaction.txid,protocol:'pwm1',status:'confirmed',valid:true,block_height:position.blockHeight,
    block_index:position.blockTransactionIndex,op_return_vout:mail.protocolVout,record_ordinal:0,raw_payload:mail.message,
    payload:{_workAmoV5ReplayBound:true,workAmoV5RawCandidate:true}}];
  transaction._jobsWorkSettlementEvidence=[{network:'livenet',txid:transaction.txid,protocol:'pwt1',kind:'token-transfer',status:'confirmed',valid:true,
    block_height:position.blockHeight,block_hash:position.blockHash,block_index:position.blockTransactionIndex,op_return_vout:record.protocolVout,
    record_ordinal:0,raw_payload:record.message,payload:{confirmed:true,valid:true,_workAmoV5ReplayBound:true,workAmoV5RawCandidate:true,
      workAmoV5ReplayOutcome:witness.outcome,workAmoV5ReplayOutput:witness.output,workAmoV5ReplayRawWitness:witness.rawWitness},mailEvents,
    transition:{block_height:position.blockHeight,block_hash:position.blockHash,model:WORK_AMO_V8_BLOCK_SEQUENCER_MODEL,
      state_commitment_model:WORK_AMO_V5_STATE_COMMITMENT_MODEL,event_set_model:WORK_AMO_V5_EVENT_SET_COMMITMENT_MODEL,
      complete:true,block_atomic:true,fee_once:true,invalid_zero:true,payload:{transitionChainModel:WORK_AMO_V5_RAW_TRANSITION_CHAIN_MODEL,
        transitionChainCommitment:commitment,replayRecords:[mailWitness,witness],traces:[trace]}}}];
}

test('v2 closed rewards preserve canonical WORK subatoms and reject aliases without rewriting v1 bytes',()=>{
  const reward=workReward('1'), metadata={v:2,title:'Exact work',scope:'Preserve\r\n',reward};
  const body=encodeJobRecord('brief',metadata);
  assert.deepEqual(parseJobBody(body),{action:'brief',metadata});
  assert.deepEqual(jobRewardFromMetadata({v:1,rewardSats:'1200'}),{asset:'proofs',amountSats:'1200'});
  assert.equal(parseJobWorkDecimal('0.0000000000000001'),'1');
  assert.equal(parseJobWorkDecimal('21000000'),JOBS_WORK_MAX_SUBATOMS);
  assert.equal(parseJobWorkDecimal('1.0000000000000001'),'10000000000000001');
  assert.equal(formatJobReward(workReward()),'1.0000000000000001 WORK');
  assert.equal(formatJobWorkSubatoms('0'),'0');
  assert.equal(formatJobWorkSubatoms((BigInt(JOBS_WORK_MAX_SUBATOMS)*2n).toString()),'42000000');
  for(const invalid of ['0','-1','01','1e2','1,000',' 1','1.00000000000000001','21000000.0000000000000001']) assert.equal(parseJobWorkDecimal(invalid),null);
  for(const reward of [{...workReward(),token:id(90)},{...workReward(),asset:'work'},workReward('0'),workReward('01'),workReward('1.1'),
    workReward((BigInt(JOBS_WORK_MAX_SUBATOMS)+1n).toString()),{...workReward(),extra:true},{asset:'proofs',amountSats:'545'},
    {asset:'proofs',amountSats:546}]) assert.equal(normalizeJobReward(reward),null);
  const encode=json=>`pwj1:brief:${Buffer.from(json).toString('base64url')}`;
  for(const json of [JSON.stringify({...metadata,reward:{token:JOBS_WORK_TOKEN_ID,asset:'WORK',amountSubatoms:'1'}}),
    JSON.stringify({...metadata,reward:{...reward,amountSubatoms:1}}),JSON.stringify({...metadata,rewardSats:'546'})]) assert.equal(parseJobBody(encode(json)),null);
  assert.throws(()=>encodeJobRecord('brief',{...metadata,v:1}));
  assert.throws(()=>encodeJobRecord('brief',{v:2,title:'x',scope:'x',rewardSats:'546'}));
});
test('WORK assignment freezes the selected asset and worker and exact confirmed replay pays it once',()=>{
  const records=workLifecycle(),state=replayJobsTransactions(records);
  assert.equal(state.jobs[0].status,'paid');
  assert.deepEqual(state.jobs[0].offeredReward,{asset:'proofs',amountSats:'1000'});
  assert.deepEqual(state.jobs[0].reward,workReward());
  assert.deepEqual(state.jobs[0].paidReward,workReward());
  assert.equal(state.jobs[0].workerAddress,worker);assert.equal(state.jobs[0].paidSats,'0');assert.equal(state.jobs[0].rewardSats,'0');
  const snapshot=createJobsSnapshot({network:'livenet',checkpointHeight:JOBS_V2_ACTIVATION_HEIGHT,checkpointHash:hash,transactions:records,v2Ready:true});
  assert.equal(jobsPayload(snapshot).stats.paidProofs,'0');assert.equal(jobsPayload(snapshot).stats.paidWorkSubatoms,workReward().amountSubatoms);
  assert.equal(jobPayload(snapshot,new URLSearchParams({job:id(1)})).job.workSettlement.paymentTxid,id(5));
  assert.equal(jobsPayload(snapshot).versions.v2ActivationPreviousBlockHash,JOBS_V2_ACTIVATION_PREVIOUS_BLOCK_HASH);
  assert.equal(jobsPayload(snapshot).versions.v2Ready,true);
  const original={txid:id(5),protocol:'pwm1',kind:'message',amountSats:'546',paidSats:'546',minerFeeSats:'42'};
  const qualified=qualifyJobsLogPayload({items:[original]},snapshot.events,snapshot.snapshot).items[0];
  assert.equal(qualified.amountSats,'546');assert.equal(qualified.paidSats,'546');assert.equal(qualified.minerFeeSats,'42');
});
test('WORK payment intent fails closed on absent, invalid, duplicate or divergent canonical settlement',()=>{
  const mutations=[
    t=>delete t._jobsWorkSettlementEvidence,
    t=>t._jobsWorkSettlementEvidence.push(structuredClone(t._jobsWorkSettlementEvidence[0])),
    t=>{t._jobsWorkSettlementEvidence[0].valid=false;},
    t=>{t._jobsWorkSettlementEvidence[0].payload.workAmoV5ReplayOutcome.valid=false;},
    t=>{t._jobsWorkSettlementEvidence[0].transition.payload.replayRecords[1].outcome.reasonCode='insufficient-work-balance';},
    t=>{t._jobsWorkSettlementEvidence[0].transition.complete=false;},
    t=>{t._jobsWorkSettlementEvidence[0].transition.fee_once=false;},
    t=>{t._jobsWorkSettlementEvidence[0].op_return_vout=2;},
    t=>{t._jobsWorkSettlementEvidence[0].payload.workAmoV5ReplayRawWitness.rawRecordParts[0].text='changed';},
    t=>{t._jobsWorkSettlementEvidence[0].transition.payload.replayRecords[1].output.projection.senderAddress=foreign;},
    t=>{t._jobsWorkSettlementEvidence[0].transition.payload.replayRecords[1].output.projection.recipientAddress=foreign;},
    t=>{t._jobsWorkSettlementEvidence[0].transition.payload.replayRecords[1].stateDelta.movement.amountSubatoms='1';},
    t=>{t._jobsWorkSettlementEvidence[0].transition.payload.replayRecords[1].stateDelta.economicOutputs[0].vout=0;},
    t=>{t._jobsWorkSettlementEvidence[0].transition.payload.replayRecords[1].stateDelta.baseContributions[0].value='1092';},
    t=>{t._jobsWorkSettlementEvidence[0].transition.payload.traces=[];},
    t=>{t._jobsWorkSettlementEvidence[0].mailEvents[0].valid=false;},
    t=>{t.vout[3].scriptpubkey=op(`pwt1:send3:${id(90)}:${workReward().amountSubatoms}:${worker}`);},
    t=>{t.vout[3].scriptpubkey=op(`pwt1:send3:${JOBS_WORK_TOKEN_ID}:1:${worker}`);},
    t=>{t.vout[3].scriptpubkey=op(`pwt1:send3:${JOBS_WORK_TOKEN_ID}:${workReward().amountSubatoms}:${foreign}`);},
    t=>{t.vout[2].value='545';},
    t=>{t.vout[2].value='547';},
    t=>{t.vout[2].scriptpubkey_address=foreign;},
    t=>{t.vout[0].value='545';},
    t=>{[t.vout[1],t.vout[2]]=[t.vout[2],t.vout[1]];},
    t=>{t.status={confirmed:false};},
  ];
  for(const mutate of mutations){const records=workLifecycle();mutate(records[4]);const state=replayJobsTransactions(records);
    assert.equal(state.jobs[0].status,'delivered',String(mutate));assert.equal(state.jobs[0].paidReward,null);assert.equal(state.jobs[0].paidSats,'0');}
});
test('version and carrier boundaries preserve legacy proofs while a WORK promise alone never becomes paid',()=>{
  const records=workLifecycle();
  for(const record of records) record.status.block_height=JOBS_V2_ACTIVATION_HEIGHT-1;
  const earlier=replayJobsTransactions(records);assert.equal(earlier.jobs[0].status,'open');
  assert.ok(earlier.events.slice(1).every(event=>event.validationErrors.includes('jobs-v2-before-activation')));
  const brief=tx(9,requester,requester,'546','brief',{v:2,title:'WORK brief',scope:'Exact work',reward:workReward('1')});
  brief.status.block_height=JOBS_V2_ACTIVATION_HEIGHT;
  const promised=replayJobsTransactions([brief]).jobs[0];assert.equal(promised.status,'open');assert.equal(promised.offeredRewardSats,'0');assert.equal(promised.paidReward,null);
  const legacy=lifecycle();legacy[4].vout.push(...workLifecycle()[4].vout.slice(2));
  assert.equal(replayJobsTransactions(legacy).jobs[0].status,'delivered');
  const v1Assignment=workLifecycle();v1Assignment[2].vout[1].scriptpubkey=op('pwm1:m:'+encodeJobRecord('assign',{v:1,job:id(1),proposal:id(2)}));
  assert.equal(replayJobsTransactions(v1Assignment).events[2].validationErrors.includes('jobs-work-version-required'),true);
  const proofs=lifecycle();for(const record of proofs)record.status.block_height=JOBS_V2_ACTIVATION_HEIGHT;
  proofs[0].vout[1].scriptpubkey=op('pwm1:m:'+encodeJobRecord('brief',{v:2,title:'Proof v2',scope:'Still exact',reward:{asset:'proofs',amountSats:'1000'}}));
  assert.equal(replayJobsTransactions(proofs).jobs[0].status,'paid');
});

test('actual Q16 raw canonical engine evidence settles the exact WORK job without economic reconstruction',()=>{
  const client='1F1p9UEHuH5KTFR7Zsx93Khdrqhj6t5nFv',workerAddress='1H1arP2xpam6MZmHt6k1tB83stqVdH6ANK';
  const amount=workReward().amountSubatoms,serial=new bitcoin.Transaction();serial.version=2;
  serial.addInput(Buffer.from(id(99),'hex').reverse(),0,0xffffffff,Buffer.alloc(0));
  const values=[{address:workerAddress,value:'546'},
    {script:op('pwm1:m:'+encodeJobRecord('accept',{v:2,job:id(1),delivery:id(4)})),value:'0'},
    {address:JOBS_WORK_REGISTRY_ADDRESS,value:'546'},
    {script:op(`pwt1:send3:${JOBS_WORK_TOKEN_ID}:${amount}:${workerAddress}`),value:'0'}];
  const outputs=values.map(value=>({value:value.value,scriptpubkey:value.script??Buffer.from(bitcoin.address.toOutputScript(value.address)).toString('hex'),
    ...(value.address?{scriptpubkey_address:value.address}:{})}));
  for(const output of outputs)serial.addOutput(Buffer.from(output.scriptpubkey,'hex'),BigInt(output.value));
  const acceptance={txid:serial.getId(),hex:serial.toHex(),version:2,locktime:0,
    vin:[{txid:id(99),vout:0,sequence:0xffffffff,prevout:{value:'1192',scriptpubkey_address:client,
      scriptpubkey:Buffer.from(bitcoin.address.toOutputScript(client)).toString('hex')}}],vout:outputs,
    blockTransactionIndex:1,_powBlockIndex:1,status:{confirmed:true,block_height:JOBS_V2_ACTIVATION_HEIGHT,block_hash:hash}};
  const coinbase=new bitcoin.Transaction();coinbase.version=2;coinbase.addInput(Buffer.alloc(32),0xffffffff,0xffffffff,Buffer.from('0401010101','hex'));
  coinbase.addOutput(Buffer.from('51','hex'),0n);
  const coinbaseEnvelope={txid:coinbase.getId(),hex:coinbase.toHex(),version:2,locktime:0,_powBlockIndex:0,
    vin:[{coinbase:'0401010101',sequence:0xffffffff}],vout:[{scriptpubkey:'51',value:'0'}]};
  const block=new bitcoin.Block();block.version=1;block.prevHash=Buffer.from(JOBS_V2_ACTIVATION_PREVIOUS_BLOCK_HASH,'hex').reverse();
  block.merkleRoot=bitcoin.Block.calculateMerkleRoot([coinbase,serial]);block.timestamp=1700000000;block.bits=0x1d00ffff;block.nonce=0;
  const blockHash=Buffer.from(block.getHash()).reverse().toString('hex');acceptance.status.block_hash=blockHash;
  const raw=canonicalRawProtocolRecordSetFromTransaction(acceptance).records;
  const canonicalRecords=raw.map(record=>({...record,position:{blockHeight:JOBS_V2_ACTIVATION_HEIGHT,blockHash,blockTransactionIndex:1,
    protocolVout:record.protocolVout,recordOrdinal:record.recordOrdinal},transactionMinerFeeSats:'100',transactionProtocolRecordCount:raw.length,
    rawPayloadHex:record.rawRecordParts.map(part=>part.payloadHex).join(''),rawScriptPubKeyHex:record.rawRecordParts[0].scriptPubKeyHex,
    tx:acceptance,txid:acceptance.txid}));
  const openingGenericState=normalizeWorkAmoV5RawGenericState({holders:[],listings:[],tokens:[]});
  const openingIdState=normalizeWorkAmoV5RawIdState({records:[],listings:[]});
  const openingWorkState=normalizeWorkAmoV5RawWorkState({amountStorageModel:'work-subatoms-v2',confirmedSupplySubatoms:amount,
    holders:[{address:client,balanceSubatoms:amount}],listings:[]});
  const replayOptions={blockHeaderHex:block.toHex(true),blockTransactions:[coinbaseEnvelope,acceptance],expectedBlockHash:blockHash,
    expectedBlockHeight:JOBS_V2_ACTIVATION_HEIGHT,expectedPreviousBlockHash:JOBS_V2_ACTIVATION_PREVIOUS_BLOCK_HASH,records:canonicalRecords,
    openingGenericState,openingIdState,openingWorkState,workAmoV8:{activationHeight:960601},
    openingEconomicState:{model:WORK_AMO_V5_NETWORK_ACCUMULATOR_MODEL,network:'livenet',baseState:Object.fromEntries(WORK_AMO_V5_BASE_STATE_FIELDS.map(field=>[field,'0'])),
      creditFixedQ8:'1000000000',creditMovementFrozenValueQ8:'0',movements:[],networkValueQ8:'1000000000',quoteHead:null,
      throughBlockHeight:JOBS_V2_ACTIVATION_HEIGHT-1,throughBlockHash:JOBS_V2_ACTIVATION_PREVIOUS_BLOCK_HASH,
      genericTokenStateCommitment:workAmoV5RawGenericStateCommitment(openingGenericState),idStateCommitment:workAmoV5RawIdStateCommitment(openingIdState),
      tokenStateCommitment:workAmoV8CanonicalTokenStateCommitment(openingWorkState)}};
  const replay=replayWorkAmoV5RawBlock(replayOptions);
  assert.ok(replay.events.every(event=>event.valid));
  const witnesses=replay.events.map(event=>({txid:event.txid,protocol:event.protocol,rawCandidate:true,position:event.position,
    outcome:{valid:event.valid,kind:`${event.protocol}-valid`,reasonCode:event.reasonCode},output:event.output,
    rawWitness:canonicalRecords.find(record=>record.protocol===event.protocol).payload,stateDelta:event.stateDelta,
    transitionChainCommitmentAfter:event.transitionChainCommitmentAfter}));
  const traces=witnesses.map(witness=>({...witness,kind:'protocol-record',valid:true,reasonCode:''}));
  const transfer=witnesses.find(item=>item.protocol==='pwt1');
  const mailRecord=raw.find(item=>item.protocol==='pwm1'),workRecord=raw.find(item=>item.protocol==='pwt1');
  acceptance._jobsWorkSettlementEvidence=[{network:'livenet',txid:acceptance.txid,protocol:'pwt1',kind:'token-transfer',status:'confirmed',valid:true,
    block_height:JOBS_V2_ACTIVATION_HEIGHT,block_hash:blockHash,block_index:1,op_return_vout:3,record_ordinal:0,raw_payload:workRecord.message,
    payload:{confirmed:true,valid:true,_workAmoV5ReplayBound:true,workAmoV5RawCandidate:true,workAmoV5ReplayOutcome:transfer.outcome,
      workAmoV5ReplayOutput:transfer.output,workAmoV5ReplayRawWitness:transfer.rawWitness},
    mailEvents:[{txid:acceptance.txid,protocol:'pwm1',status:'confirmed',valid:true,block_height:JOBS_V2_ACTIVATION_HEIGHT,block_index:1,
      op_return_vout:1,record_ordinal:0,raw_payload:mailRecord.message,payload:{_workAmoV5ReplayBound:true,workAmoV5RawCandidate:true}}],
    transition:{block_height:JOBS_V2_ACTIVATION_HEIGHT,block_hash:blockHash,model:WORK_AMO_V8_BLOCK_SEQUENCER_MODEL,
      state_commitment_model:WORK_AMO_V5_STATE_COMMITMENT_MODEL,event_set_model:WORK_AMO_V5_EVENT_SET_COMMITMENT_MODEL,
      complete:true,block_atomic:true,fee_once:true,invalid_zero:true,payload:{transitionChainModel:replay.transitionChainModel,
        transitionChainCommitment:replay.transitionChainCommitment,replayRecords:witnesses,traces}}}];
  const event=verifyJobsTransaction(acceptance);
  assert.equal(event.valid,true);
  const settled=verifyJobsWorkSettlement(acceptance,event,workerAddress,workReward());
  assert.equal(settled.valid,true,settled.reason);
  assert.equal(replay.workState.holders.find(holder=>holder.address===workerAddress).balanceSubatoms,amount);
  assert.deepEqual(settled.transitionChainCommitment,transfer.transitionChainCommitmentAfter);
  const emptyWork=normalizeWorkAmoV5RawWorkState({amountStorageModel:'work-subatoms-v2',confirmedSupplySubatoms:'0',holders:[],listings:[]});
  const rejected=replayWorkAmoV5RawBlock({...replayOptions,openingWorkState:emptyWork,
    openingEconomicState:{...replayOptions.openingEconomicState,tokenStateCommitment:workAmoV8CanonicalTokenStateCommitment(emptyWork)}}).events.find(event=>event.protocol==='pwt1');
  assert.equal(rejected.valid,false);assert.equal(rejected.reasonCode,'work-amo-v5-raw-transfer-state-invalid');
  acceptance._jobsWorkSettlementEvidence[0].payload.workAmoV5ReplayOutcome={kind:'pwt1-invalid',valid:rejected.valid,reasonCode:rejected.reasonCode};
  assert.equal(verifyJobsWorkSettlement(acceptance,event,workerAddress,workReward()).valid,false);
});
