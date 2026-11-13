import assert from 'node:assert/strict';
import test from 'node:test';
import { parseWorkAmoV5PwmMessages } from '../../../server/work-amo-v5.mjs';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import * as bitcoin from 'bitcoinjs-lib';
import { canonicalMailRecipients, assertSameMailRoutes, planWorkMailAttachment, readWorkMailBatchStatus, workMailAttachmentMode, mailWorkBondKind } from './workMailBatchClient.mjs';
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
 for(const message of ['pwj1:anything','  pwj1:malformed'])assert.throws(()=>plan({message}),/Jobs or bond/);
 for(const extra of [{message:'hello'},{message:'powb',parentTxid:'c'.repeat(64)},{message:'incb',hasAttachment:true}])assert.equal(plan(extra).mode,'mailbatch1');
 assert.equal(plan({socialMode:true,status:undefined,recipients:routes(1),message:'powb'}).mode,'legacy');
});

test('bond Mail preserves individual WORK transfers regardless of ordinary batch readiness',()=>{
 for(const message of ['incb',' PoWb '])for(const status of [undefined,inactive,ready,{...ready,ready:false,writeEnabled:false}]){
  const value=plan({message,status,recipients:routes(1),amountSubatoms:'18000000000000000000000'});
  assert.equal(value.mode,'legacy');assert.deepEqual(value.payloads,['legacy:'+addresses[0]]);
  assert.equal(value.registryFeeProofs,546);assert.equal(value.totalAmountSubatoms,'18000000000000000000000');
  assert.match(value.feeLabel,/Bond WORK attachment/);assert.equal(value.status,undefined);
 }
 const multi=plan({message:'incb',recipients:routes(10)});
 assert.equal(multi.payloads.length,10);assert.equal(multi.registryFeeProofs,5460);
 assert.throws(()=>plan({message:'incb',recipients:routes(11)}),/at most 10/);
 assert.throws(()=>plan({message:'incb',legacyPayload:()=>''}),/admission is unavailable/);
});
test('bond routing is exact and does not turn ordinary batch failures into legacy fallback',()=>{
 for(const message of ['incb hello','hello incb','pwj1:incb',''])assert.equal(mailWorkBondKind({message}),null);
 assert.equal(mailWorkBondKind({message:' INCB '}),'inception');
 assert.equal(mailWorkBondKind({message:'powb'}),'infinity');
 for(const context of [{parentTxid:'a'.repeat(64)},{hasAttachment:true}]){
  assert.equal(mailWorkBondKind({message:'incb',...context}),null);
  assert.equal(plan({message:'incb',...context}).mode,'mailbatch1');
  assert.throws(()=>plan({message:'incb',status:undefined,...context}),/unavailable/);
 }
 assert.equal(mailWorkBondKind({message:'incb',socialMode:true}),null);
 assert.throws(()=>plan({message:'hello',status:undefined}),/unavailable/);
});

test('Mail bond selector matches canonical PWM classification without rewriting the body',()=>{
 for(const message of ['incb',' INCB \n','powb','PoWb','hello incb','pwj1:incb']) {
  for(const parentTxid of [undefined,'a'.repeat(64)]) {
   const parsed=parseWorkAmoV5PwmMessages([...(parentTxid?['pwm1:r:'+parentTxid]:[]),'pwm1:m:'+message]);
   const expected=parsed.kind==='inception-bond'?'inception':parsed.kind==='infinity-bond'?'infinity':null;
   assert.equal(mailWorkBondKind({message,parentTxid}),expected);assert.equal(parsed.memo,message);
  }
 }
});
test('Mail bond eligibility uses existing policy and retains fresh work and receipt fences',()=>{
 const source=readFileSync(new URL('../../App.tsx',import.meta.url),'utf8');
 const start=source.indexOf('function canUseLegacyWorkAttachmentSender(');
 const end=source.indexOf('function attachedWorkCreditsFromVout(',start);
 const js=ts.transpileModule(source.slice(start,end),{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText;
 const context=vm.createContext({WORK_ATTACHMENT_LEGACY_ALLOWED_SENDERS:new Set(['allowed'])});
 vm.runInContext(js,context);
 for(const holder of [false,true])for(const network of ['livenet','testnet'])for(const sender of ['allowed','other','']){
  assert.equal(context.canAttachWorkToBond({folder:'inception'},sender,network,holder),network==='livenet'&&Boolean(sender)&&holder);
  assert.equal(context.canAttachWorkToBond({folder:'infinity'},sender,network,holder),network==='livenet'&&sender==='allowed');
 }
 assert.match(source,/mailWorkAttachmentRequested && mailBondKind && !mailBondWorkAllowed/);
 assert.match(source,/mailBondKind && !canAttachWorkToBond\([\s\S]*?latestSpendability.confirmedBalanceSubatoms/);
 assert.match(source,/await freshWorkWriteMode\(preparedWorkAttachmentMode\);[\s\S]*?if \(!mailWorkUsesIndividualTransfers\)[\s\S]*?await requireFreshWorkCapacityBeforeBroadcast/);
 assert.match(source,/if \(!socialMode && \(!mailWorkAttachmentPreview.plan/);
});
