import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';
import * as bitcoin from 'bitcoinjs-lib';
import * as client from './workMailBatchClient.mjs';
import {validateWorkMailBatchV1RawTransaction} from '../../../server/work-mail-batch-transaction.mjs';
import {verifyOwnerOutputCommitment} from '../../shared/protocol/ownerOutputCommitment.mjs';
import {parseWorkMailBatchPayload,WORK_MAIL_BATCH_TOKEN_ID,WORK_MAIL_BATCH_REGISTRY_ADDRESS} from '../../shared/protocol/workMailBatch.mjs';
import {createOwnerOutputCommitmentFixture,signOwnerOutputCommitmentPsbt} from '../../../tests/fixtures/ownerOutputCommitment.mjs';
const root=new URL('../../../',import.meta.url);
function loadTs(path,imports={}){const exports={};vm.runInNewContext(ts.transpileModule(readFileSync(new URL(path,root),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{exports,Buffer,require:name=>{assert.ok(Object.hasOwn(imports,name),name);return imports[name];}});return exports;}
const recovery=loadTs('src/shared/wallet/actionRecovery.ts');
const hold=loadTs('src/shared/work/workBatchRecovery.ts',{'../wallet/actionRecovery':recovery});
const payment=loadTs('src/shared/wallet/paymentReview.ts',{'bitcoinjs-lib':bitcoin,buffer:{Buffer}});
const app=readFileSync(new URL('src/App.tsx',root),'utf8'),ast=ts.createSourceFile('App.tsx',app,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX),functions=new Map();
function visit(node){if(ts.isFunctionDeclaration(node)&&node.name)functions.set(node.name.text,node.getText(ast));ts.forEachChild(node,visit);}visit(ast);
const names=['psbtUnsignedTransactionIntent','rawUnsignedTransactionIntent','assertSignedTransactionIntent','ownerOutputEvidenceFromPreparedPayment','signAndBroadcastPsbtDetailed','signAndBroadcastPsbt','sendOpReturn'];
const compiled=ts.transpileModule(names.map(x=>functions.get(x)).join('\n'),{compilerOptions:{module:ts.ModuleKind.None,target:ts.ScriptTarget.ES2022}}).outputText;
const owner=createOwnerOutputCommitmentFixture({spendPath:'p2wpkh'}).ownerAddress;
const status={protocol:'work-mail-batch-v1',network:'livenet',active:true,writeEnabled:true,ready:true,reasonCode:null,declarationTxid:'a'.repeat(64),activationHeight:100,checkedTipHeight:101,checkedTipHash:'b'.repeat(64),registryFeeProofs:546,limits:{minRecipients:1,maxRecipients:256,maxPayloadBytes:65536}};
function fixture({count=78,contextChange=false,unknown=false,weak=false,storageFails=false,capacityChange=false,statusChange=false,routeChange=false,lateContextChange=false}={}){
 const values=new Map();const storage={getItem:key=>values.get(key)??null,setItem:(key,value)=>{if(storageFails&&key===recovery.ACTION_RECEIPTS_KEY)throw new Error('storage full');values.set(key,value);}};
 const recipientAddresses=Array.from({length:count},(_,i)=>bitcoin.payments.p2wpkh({hash:Buffer.from((i+1).toString(16).padStart(40,'0'),'hex')}).address);
 // Include sender and registry as ordinary recipients; the dedicated fee is still after PWM.
 if(count>2){recipientAddresses[0]=owner;recipientAddresses[1]=WORK_MAIL_BATCH_REGISTRY_ADDRESS;}
 const resolutions=recipientAddresses.map((address,i)=>({paymentAddress:address,isId:i===2,id:i===2?'alice.pow':undefined,displayRecipient:i===2?'alice.pow':address}));
 const to=resolutions.slice(0,Math.ceil(count/2)),cc=[to[0],...resolutions.slice(Math.ceil(count/2))];
 const routes=client.canonicalMailRecipients(to,cc),planned=client.planWorkMailAttachment({recipients:routes,amountSubatoms:'1',status});
 const funding=new bitcoin.Transaction();funding.addInput(Buffer.alloc(32,9),0);const script=bitcoin.address.toOutputScript(owner);funding.addOutput(script,1000000n);
 let signCalls=0,broadcastCalls=0,capacityChecks=0,statusCalls=0,anchorChecks=0;const statuses=[],reviews=[],capacityTxids=[],pendingTransfers=[];
 const wallet={signPsbt:async(hex,options)=>{signCalls++;assert.equal(options.toSignInputs[0].sighashTypes[0],1);const signed=signOwnerOutputCommitmentPsbt(hex,{spendPath:'p2wpkh',hashType:weak?2:1});if(contextChange)context.mailReviewContextRef.current='changed';return signed;}};
 const allSentRef={current:[]},mailReviewResolverRef={current:null};
 const context=vm.createContext({...client,...payment,...recovery,...hold,bitcoin,Buffer,verifyOwnerOutputCommitment,localStorage:storage,
  window:{unisat:wallet},document:{activeElement:null},HTMLElement:class {},address:owner,network:'livenet',feeRate:1,
  mailSendInFlightRef:{current:false},mailSendBusy:false,uncertainMailBroadcast:false,mailReviewReturnFocusRef:{current:null},mailReviewContextRef:{current:'draft'},mailWalletRevisionRef:{current:1},mailReviewResolverRef,
  composeDataCarrierBytes:100,MAX_DATA_CARRIER_BYTES:100000,messageWorkAmountInvalid:false,boostComposeReason:'',socialMode:false,
  recipient:'alice.pow',ccRecipient:'cc',recipientResolution:{recipients:to},ccRecipientResolution:{recipients:cc},registryAddress:'registry',
  amountSats:546,messageWorkAmountValue:1e-16,messageWorkAmountAtoms:1n,workAttachmentSpendableAtoms:10000n,
  mailWorkAttachmentPreview:{plan:planned},tokenListings:[],tokenClosedListings:[],tokenTransfers:[],tokenSales:[],
  WORK_TOKEN_ID:WORK_MAIL_BATCH_TOKEN_ID,WORK_TOKEN_TICKER:'WORK',WORK_TOKEN_DEFINITION:{},WORK_TOKEN_REGISTRY_ADDRESS:WORK_MAIL_BATCH_REGISTRY_ADDRESS,TOKEN_MIN_MUTATION_PRICE_SATS:546,
  protocolPayloads:['pwm1:s:U3ViamVjdA','pwm1:m:hello'],subject:'Subject',memo:'hello',attachment:undefined,replyParentTxid:undefined,
  accountUtxosLoaded:false,accountUtxos:[],allSentRef,
  setMailSendBusy(){},setStatus:value=>statuses.push(value),setIdRegistry(){},setIdListings(){},setIdPendingEvents(){},setIdSales(){},
  needsRegistryResolution:()=>true,fetchIdRegistry:async()=>[],resolveRecipientInputs:(input)=>({recipients:input==='alice.pow'?(routeChange&&signCalls?to.map((r,i)=>i===2?{...r,paymentAddress:owner}:r):to):cc}),
  ensureWalletNetwork:async()=>{},fetchIdRegistryState:async()=>({records:[],listings:[],pendingEvents:[],sales:[]}),activeListingAnchorOutpointsForAddress:()=>[],
  canAttachWorkToMessages:()=>true,fetchFreshWalletWorkState:async()=>({listings:[]}),tokenSpendabilityForWallet:()=>({spendableBalanceSubatoms:'10000'}),
  workAtomsFromIntegerString:value=>BigInt(value),workDecimalFromAtoms:value=>String(value),formatWorkAmount:value=>String(value),freshWorkWriteMode:async()=>({mode:'native-q16'}),
  loadWorkMailBatchStatus:async()=>{statusCalls++;return statusChange&&signCalls?{...status,ready:false,reasonCode:'paused'}:status;},setMailWorkBatchStatus(){},
  buildTokenSendPayload:()=>{throw new Error('Batch must not encode independent send3');},dataCarrierBytesForPayloads:rows=>rows.reduce((n,x)=>n+x.length,0),dataCarrierBytesForPayload:x=>x.length,
  activeTokenListingAnchorOutpointsForAddress:()=>[],bitcoinNetwork:()=>bitcoin.networks.bitcoin,networkLabel:()=> 'Mainnet',bytesToHex:value=>Buffer.from(value).toString('hex'),
  buildPaymentPsbt:async(options)=>{
   assert.equal(options.strictOwnerOutputCommitment,true);assert.equal(options.payments.length,count);assert.equal(options.postProtocolPayments.length,1);assert.equal(options.postProtocolPayments[0].amountSats,546);
   const psbt=new bitcoin.Psbt();psbt.addInput({hash:funding.getId(),index:0,witnessUtxo:{script,value:1000000n},sighashType:1});
   options.payments.forEach(row=>psbt.addOutput({address:row.address,value:BigInt(row.amountSats)}));
   options.protocolPayloads.forEach(value=>psbt.addOutput({script:bitcoin.script.compile([bitcoin.opcodes.OP_RETURN,Buffer.from(value)]),value:0n}));
   options.postProtocolPayments.forEach(row=>psbt.addOutput({address:row.address,value:BigInt(row.amountSats)}));
   options.postProtocolPayloads.forEach(value=>psbt.addOutput({script:bitcoin.script.compile([bitcoin.opcodes.OP_RETURN,Buffer.from(value)]),value:0n}));
   const change=1000000-count*546-546-1000;psbt.addOutput({address:owner,value:BigInt(change)});
   return {psbtHex:psbt.toHex(),inputCount:1,outputCount:psbt.txOutputs.length,feeSats:1000,changeSats:change,dustFeeSats:0,strictOwnerOutputCommitment:true};
  },
  assertTransactionIntentDoesNotSpendReservedListingAnchors:async()=>{anchorChecks++;if(lateContextChange&&anchorChecks===3)context.mailReviewContextRef.current='changed-after-last-check';},
  setMailReview:value=>{reviews.push(value);mailReviewResolverRef.current(true);},normalizeSubject:value=>value,
  fetchAddressApiUtxos:async()=>[{txid:funding.getId(),vout:0,value:1000000,status:{confirmed:true}}],
  requireFreshWorkCapacityBeforeBroadcast:async(...args)=>{capacityChecks++;capacityTxids.push(args[8]);hold.assertNoUnresolvedWorkBatch(storage,owner,args[8]);if(capacityChange&&signCalls)throw new Error('Capacity changed');},
  recipientSummary:()=> 'recipients',totalRecipientSats:rows=>rows.reduce((sum,r)=>sum+r.amountSats,0),setActionReceipts(){},setActionRecoveryError(){},
  saveSentMessages:rows=>{allSentRef.current=rows;},setAllSent:rows=>{allSentRef.current=typeof rows==='function'?rows(allSentRef.current):rows;},
  broadcastSignedRawTransaction:async raw=>{broadcastCalls++;
   const tx=bitcoin.Transaction.fromHex(raw),vout=tx.outs.map(output=>({scriptpubkey:Buffer.from(output.script).toString('hex'),value:output.value.toString()}));
   const validation=validateWorkMailBatchV1RawTransaction({transaction:{txid:tx.getId(),hex:raw,vout,vin:[{txid:funding.getId(),vout:0,prevout:{scriptpubkey:Buffer.from(script).toString('hex'),value:'1000000'}}]},protocolVout:count+3});
   assert.equal(validation.valid,true,validation.reasonCode);
   const receipt=recovery.readActionReceipts(storage)[0];assert.equal(receipt.status,'unknown');assert.equal(receipt.txid,bitcoin.Transaction.fromHex(raw).getId());assert.ok(allSentRef.current.some(x=>x.txid===receipt.txid));if(unknown)throw new Error('network outcome unknown');return{txid:receipt.txid,opReturnCount:3};},
  samePaymentAddress:(a,b)=>a===b,clearDraft(){},setSavedDraft(){},setTokenTransfers:value=>pendingTransfers.push(value),setInbox(){},setActiveFolder(){},setComposeOpen(){},setAttachment(){},setSubject(){},setMemo(){},setSocialMode(){},setReplyParentTxid(){},setSelectedKey(){},
  shortAddress:x=>x,attachedCreditLabel:()=> 'WORK',goodBroadcastStatus:text=>({tone:'good',text}),refreshToken:async()=>{},errorMessage:(e,f)=>e?.message||f,txStatusLink:txid=>({txid}),
 });
 vm.runInContext(compiled+'\nthis.run=sendOpReturn;',context);
 return {run:()=>context.run({preventDefault(){}}),storage,statuses,reviews,capacityTxids,pendingTransfers,allSentRef,counts:()=>({signCalls,broadcastCalls,capacityChecks,statusCalls}),planned};
}
test('actual Mail handler signs 78 recipients once, reviews one fee and holds one transaction',async()=>{
 const x=fixture();await x.run();assert.equal(x.counts().broadcastCalls,1,JSON.stringify(x.statuses));assert.equal(x.counts().signCalls,1);
 assert.equal(x.reviews[0].recipients.length,78);assert.equal(x.reviews[0].registry.proofs,'546');assert.equal(x.reviews[0].totalWork,'78');assert.equal(x.reviews[0].recipients[39].role,'CC');
 assert.equal(parseWorkMailBatchPayload(x.planned.payloads[0]).recipientCount,78);assert.equal(x.pendingTransfers.length,0);
 const receipt=recovery.readActionReceipts(x.storage)[0];assert.equal(receipt.status,'pending');assert.equal(x.capacityTxids[0],undefined);assert.equal(x.capacityTxids[1],receipt.txid);
 assert.throws(()=>hold.assertNoUnresolvedWorkBatch(x.storage,owner),/full batch/);hold.assertNoUnresolvedWorkBatch(x.storage,owner,receipt.txid);
});
for(const [name,options] of Object.entries({walletChanged:{contextChange:true},activationPaused:{statusChange:true},capacityChanged:{capacityChange:true},routeChanged:{routeChange:true},lastAwaitChanged:{lateContextChange:true}}))test(`signed Mail ${name} retains recovery and never broadcasts`,async()=>{
 const x=fixture(options);await x.run();assert.equal(x.counts().signCalls,1,JSON.stringify(x.statuses));assert.equal(x.counts().broadcastCalls,0);assert.equal(recovery.readActionReceipts(x.storage)[0]?.status,'unknown',JSON.stringify(x.statuses));assert.throws(()=>hold.assertNoUnresolvedWorkBatch(x.storage,owner),/full batch/);
});
test('unknown broadcast keeps the whole Mail batch and original draft evidence',async()=>{const x=fixture({unknown:true});await x.run();assert.equal(x.counts().broadcastCalls,1,JSON.stringify(x.statuses));assert.equal(recovery.readActionReceipts(x.storage)[0].status,'unknown');assert.equal(x.allSentRef.current[0].memo,'hello');assert.equal(x.pendingTransfers.length,0);});
for(const [name,options] of Object.entries({weakSignature:{weak:true},storageFailure:{storageFails:true}}))test(`${name} cannot reach Mail broadcast`,async()=>{const x=fixture(options);await x.run();assert.equal(x.counts().signCalls,1,JSON.stringify(x.statuses));assert.equal(x.counts().broadcastCalls,0);});
