import assert from 'node:assert/strict';
import test from 'node:test';
import * as bitcoin from 'bitcoinjs-lib';
import { canonicalMailRecipients, assertSameMailRoutes, planWorkMailAttachment, readWorkMailBatchStatus, workMailAttachmentMode } from './workMailBatchClient.mjs';
import { parseWorkMailBatchPayload, WORK_MAIL_BATCH_REGISTRY_ADDRESS } from '../../shared/protocol/workMailBatch.mjs';
const addresses = Array.from({length:257},(_,i)=>bitcoin.payments.p2wpkh({hash:Buffer.from(i.toString(16).padStart(40,'0'),'hex')}).address);
const resolution = (address,id) => ({paymentAddress:address,isId:Boolean(id),displayRecipient:id??address,...(id?{id}:{})});
const ready = {protocol:'work-mail-batch-v1',network:'livenet',active:true,writeEnabled:true,ready:true,reasonCode:null,declarationTxid:'a'.repeat(64),activationHeight:100,checkedTipHeight:101,checkedTipHash:'b'.repeat(64),registryFeeProofs:546,limits:{minRecipients:1,maxRecipients:256,maxPayloadBytes:65536}};
const inactive = {...ready,active:false,ready:false,writeEnabled:false,declarationTxid:null,activationHeight:null,reasonCode:'work-mail-batch-declaration-unconfigured'};
const routes = count => canonicalMailRecipients(addresses.slice(0,count).map(x=>resolution(x)),[]);
const plan = (options={}) => planWorkMailAttachment({recipients:routes(2),amountSubatoms:'10000000000000001',status:ready,legacyPayload:address=>'legacy:'+address,...options});

test('78 ordered To/CC recipients share one exact Q16 carrier and one registry payment',()=>{
 const recipients=canonicalMailRecipients(addresses.slice(0,40).map(x=>resolution(x)),addresses.slice(40,78).map(x=>resolution(x)));
 const result=plan({recipients}); const wire=parseWorkMailBatchPayload(result.payloads[0]);
 assert.equal(result.mode,'mailbatch1');assert.equal(result.registryFeeProofs,546);assert.equal(result.payloads.length,1);
 assert.equal(result.totalAmountSubatoms,'780000000000000078');assert.equal(wire.totalAmountSubatoms,result.totalAmountSubatoms);
 assert.deepEqual(wire.recipients.map(x=>x.recipientAddress),addresses.slice(0,78));assert.equal(recipients[40].role,'CC');
});
test('canonical To-first dedup handles IDs, uppercase Bech32, self and registry addresses',()=>{
 const result=canonicalMailRecipients([resolution(addresses[0].toUpperCase(),'alice.pow'),resolution(WORK_MAIL_BATCH_REGISTRY_ADDRESS)],
  [resolution(addresses[0]),resolution(addresses[1],'bob.pow'),resolution(WORK_MAIL_BATCH_REGISTRY_ADDRESS)]);
 assert.deepEqual(result.map(x=>[x.address,x.role]),[[addresses[0],'To'],[WORK_MAIL_BATCH_REGISTRY_ADDRESS,'To'],[addresses[1],'CC']]);
 assert.equal(plan({recipients:result}).registryFeeProofs,546);
 assertSameMailRoutes(result,structuredClone(result));
 assert.throws(()=>assertSameMailRoutes(result,result.map((x,i)=>i===0?{...x,address:addresses[9]}:x)),/route changed/);
 assert.throws(()=>assertSameMailRoutes(result,result.toReversed()),/route changed/);
});
test('only verified preactivation states permit explicit ≤10 legacy fees; zero WORK needs no capability',()=>{
 for(const status of [inactive,{...ready,active:false,ready:false,writeEnabled:false,checkedTipHeight:99,reasonCode:'work-mail-batch-activation-not-indexed'}]){
  const value=plan({status,recipients:routes(10)});assert.equal(value.mode,'legacy');assert.equal(value.payloads.length,10);assert.equal(value.registryFeeProofs,5460);assert.match(value.feeLabel,/Legacy.*per recipient/);
  assert.throws(()=>plan({status,recipients:routes(11)}),/at most 10/);
 }
 const none=plan({amountSubatoms:'0',status:undefined,recipients:routes(256)});assert.equal(none.mode,'none');assert.equal(none.registryFeeProofs,0);
});
test('unavailable, foreign, malformed, paused or regressed activation never silently falls back',()=>{
 for(const status of [undefined,null,{...inactive,reasonCode:'work-mail-batch-declaration-commitment-unconfigured'},
  {...inactive,checkedTipHash:null},{...ready,protocol:'work-batch-v1'},{...ready,network:'testnet'},
  {...ready,active:false},{...ready,registryFeeProofs:1092},{...ready,limits:{...ready.limits,maxRecipients:999}},
  {...ready,ready:false},{...ready,writeEnabled:false,ready:false}]) assert.throws(()=>plan({status}));
 assert.throws(()=>workMailAttachmentMode(inactive,ready),/activation.*changed/);
 assert.throws(()=>workMailAttachmentMode({...ready,checkedTipHeight:100},ready),/checkpoint changed/);
 assert.throws(()=>workMailAttachmentMode({...ready,checkedTipHash:'c'.repeat(64)},ready),/checkpoint changed/);
 assert.throws(()=>workMailAttachmentMode({...ready,declarationTxid:'c'.repeat(64)},ready),/changed/);
 assert.equal(readWorkMailBatchStatus(ready),ready);
});
test('1 and 256 batch recipients work; invalid counts and totals fail before a wallet request',()=>{
 for(const count of [1,256])assert.equal(plan({recipients:routes(count)}).recipientCount,count);
 assert.throws(()=>canonicalMailRecipients(addresses.map(x=>resolution(x)),[]),/1–256/);
 assert.throws(()=>plan({recipients:[]}),/1–256/);
 for(const amountSubatoms of ['-1','1.0','01','1e16','Infinity','9'.repeat(1000),'210000000000000000000000'])assert.throws(()=>plan({amountSubatoms}));
});
test('ordinary Mail guard preserves replies/files and keeps Jobs/bonds/Boost on their own paths',()=>{
 for(const message of ['pwj1:anything','  pwj1:malformed','powb','incb'])assert.throws(()=>plan({message}),/Jobs or bond/);
 for(const extra of [{message:'hello'},{message:'powb',parentTxid:'c'.repeat(64)},{message:'incb',hasAttachment:true}])assert.equal(plan(extra).mode,'mailbatch1');
 assert.equal(plan({socialMode:true,status:undefined,recipients:routes(1),message:'powb'}).mode,'legacy');
});
