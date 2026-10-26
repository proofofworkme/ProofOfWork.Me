import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {isDeepStrictEqual} from 'node:util';
import vm from 'node:vm';
import test from 'node:test';
import * as bitcoin from 'bitcoinjs-lib';
import {ACTOR,REGISTRY,transaction,recipients} from '../tests/fixtures/workMailBatch.mjs';
import {parseWorkMailBatchPayload} from '../src/shared/protocol/workMailBatch.mjs';
import {canonicalRawProtocolRecordSetFromTransaction} from './canonical-op-return.mjs';
import {validateWorkMailBatchV1RawTransaction,validateWorkMailBatchV1PendingDecision} from './work-mail-batch-transaction.mjs';
import {workMailBatchDeclarationPaymentOrderValid,WORK_MAIL_BATCH_DECLARATION_COMMITMENT_MODEL} from './work-mail-batch-declaration.mjs';
import {workAmoV5CanonicalPayloadCommitment} from './work-amo-v5.mjs';
import {WORK_SUBATOM_PROJECTION_MODEL,WORK_TOKEN_ID} from './work-units.mjs';
const source=readFileSync(new URL('./proof-api.mjs',import.meta.url),'utf8');
const HEIGHT=1200000,NOW='2026-10-26T00:00:00.000Z';
const ACTIVE={canonical:true,confirmed:true,evidenceComplete:true,activationHeight:HEIGHT,
 declaration:{txid:'31'.repeat(32),blockHash:'21'.repeat(32),blockHeight:HEIGHT-1,blockTransactionIndex:1,protocolVout:1,recordOrdinal:0,registryPaymentVout:0},
 evidenceCommitment:{model:WORK_MAIL_BATCH_DECLARATION_COMMITMENT_MODEL,payloadBytes:1,sha256:'32'.repeat(32)}};
function apiFunctions(){
 const names=['workMailBatchReadContextActive','workBatchProjectionRecords','pendingWorkVerifierStageReplayState','pendingWorkVerifierStageCanonicalItem','mailAttachedCreditsFromRecord'];
 const definitions=names.map(name=>{const start=new RegExp(`^function ${name}\\(`,'m').exec(source)?.index;assert.ok(start>0,name);const next=/\n(?:async )?function \w+\(/u.exec(source.slice(start+1));return source.slice(start,next?start+1+next.index:source.length);}).join('\n');
 const context=vm.createContext({WORK_TOKEN_ID,WORK_SUBATOM_PROJECTION_MODEL,WORK_ATOMIC_PROJECTION_MODEL:'canonical-work-atoms-v1',WORK_TOKEN_DEFAULT_REGISTRY_ADDRESS:REGISTRY,WORK_TOKEN_TICKER:'WORK',TOKEN_MIN_MUTATION_PRICE_SATS:546,
  canonicalRawProtocolRecordSetFromTransaction,validateWorkMailBatchV1RawTransaction,parseTokenPayload:parseWorkMailBatchPayload,workAmoV5CanonicalPayloadCommitment,workMailBatchDeclarationPaymentOrderValid,isDeepStrictEqual,
  transactionTxid:tx=>tx.txid,transactionConfirmed:tx=>tx.status?.confirmed===true,transactionBlockHash:tx=>tx.status?.block_hash,transactionBlockHeight:tx=>tx.status?.block_height,transactionBlockIndex:tx=>tx._powBlockIndex,
  tokenTransactionTime:()=>1700000000000,transactionMinerFeeSats:tx=>Number(tx.feeSats),proofProtocolDataBytesForVout:()=>1,
  workAmountFieldsFromSubatoms:value=>({amountSubatoms:String(value),amountStorageModel:WORK_SUBATOM_PROJECTION_MODEL}),workBalanceFieldsFromSubatoms:value=>({balanceSubatoms:String(value),amountStorageModel:WORK_SUBATOM_PROJECTION_MODEL}),formatWorkSubatoms:String,tokenListingIsExpired:()=>false,
  pendingWorkVerifierStageCanonicalIso:value=>({value}),pendingWorkVerifierStageStableDecisionItem:item=>item,pendingWorkVerifierStageJsonClone:value=>JSON.parse(JSON.stringify(value)),pendingWorkVerifierStageError:(code,message)=>Object.assign(new Error(message),{code}),
  normalizeTokenTicker:value=>value.toUpperCase(),workRecordUsesSubatoms:credit=>Boolean(credit.amountSubatoms),tokenLedgerAmountFromRecord:(_token,credit)=>BigInt(credit.amountSubatoms),canonicalEventIdentityDetails:credit=>({txid:credit.txid,protocolVout:credit.protocolVout,recordOrdinal:credit.recordOrdinal}),tokenLedgerAmountFields:(_token,amount)=>({amountSubatoms:String(amount)}),numericValue:value=>Number(value)||0,isValidBitcoinAddress:address=>{try{bitcoin.address.toOutputScript(address);return true;}catch{return false;}},
 });
 return new vm.Script(`${definitions}\n({${names.join(',')}})`).runInContext(context);
}
const base=(balance='200000004')=>({amountStorageModel:WORK_SUBATOM_PROJECTION_MODEL,coverageHeight:HEIGHT,holders:[{address:ACTOR,tokenId:WORK_TOKEN_ID,balanceSubatoms:balance}],listings:[],transfers:[]});
test('pending Mail atomically stages 78 recipients with one parent fee and bound Mail envelope',()=>{
 const api=apiFunctions(),state=base('1000000'),vector=recipients(78,'100');vector[0].recipientAddress=ACTOR;vector[1].recipientAddress=REGISTRY;
 const tx=transaction({vector,mail:['pwm1:s:RXhhY3Qgc3ViamVjdA','pwm1:m:Hello']});
 assert.equal(api.pendingWorkVerifierStageReplayState(state,tx,'livenet',null,null),state);
 const result=api.pendingWorkVerifierStageReplayState(state,tx,'livenet',null,ACTIVE);
 assert.equal(state.holders[0].balanceSubatoms,'1000000');assert.equal(result.holders.find(row=>row.address===ACTOR).balanceSubatoms,'992300');
 assert.equal(result.transferBatches.length,1);assert.equal(result.transfers.length,78);assert.equal(result.transferBatches[0].paidSats,546);
 assert.equal(result.transferBatches[0].totalAmountSubatoms,'7800');assert.equal(result.transferBatches[0].movementAmountSubatoms,'7700');
 assert.equal(result.transferBatches[0].mailEnvelope.protocolVout,78);assert.equal(result.transferBatches[0].mailEnvelope.lastProtocolVout,79);
 assert.equal(result.holders.reduce((n,row)=>n+BigInt(row.balanceSubatoms),0n),1000000n);
 assert.ok(result.transfers.every(row=>row.paidSats===0&&row.minerFeeSats===0&&row.registryMutationFeeSats===0&&row.rawCandidate===false&&row.transferVersion==='mailbatch1'));
 assert.equal(api.pendingWorkVerifierStageReplayState(result,tx,'livenet',null,ACTIVE),result);
 const records=canonicalRawProtocolRecordSetFromTransaction(tx).records;
 const items=[...result.transferBatches,...result.transfers].map(item=>api.pendingWorkVerifierStageCanonicalItem({...item,valid:true},tx.txid,records,NOW));
 assert.equal(validateWorkMailBatchV1PendingDecision({transaction:tx,items}).valid,true);
 for(const bad of [items.slice(0,-1),[items[0],items[1],items[1],...items.slice(3)],items.slice(1)])assert.equal(validateWorkMailBatchV1PendingDecision({transaction:tx,items:bad}).valid,false);
});
test('self allocation still needs the full opening sum and listing-reserved capacity is unavailable',()=>{
 const api=apiFunctions(),vector=[{recipientAddress:ACTOR,amountSubatoms:'100'},...recipients(1,'100')],tx=transaction({vector});
 for(const state of [base('199'),{...base('300'),listings:[{tokenId:WORK_TOKEN_ID,sellerAddress:ACTOR,amountSubatoms:'101'}]}, {...base(),amountStorageModel:'canonical-work-atoms-v1'}])assert.equal(api.pendingWorkVerifierStageReplayState(state,tx,'livenet',null,ACTIVE),state);
 const state=base('200'),result=api.pendingWorkVerifierStageReplayState(state,tx,'livenet',null,ACTIVE);assert.equal(result.holders.find(row=>row.address===ACTOR).balanceSubatoms,'100');
});
test('pending child canonicalization rejects amount, recipient, fee, vector position and envelope drift',()=>{
 const api=apiFunctions(),tx=transaction(),result=api.pendingWorkVerifierStageReplayState(base(),tx,'livenet',null,ACTIVE),records=canonicalRawProtocolRecordSetFromTransaction(tx).records;
 const children=result.transfers.map(child=>({...child,valid:true})),parent={...result.transferBatches[0],valid:true};
 for(const mutation of [{amountSubatoms:'1'},{recipientAddress:ACTOR},{paidSats:546},{economicDelta:true},{batchRecipientIndex:1},{batchPayloadCommitment:null},{amountVersion:'batch1'}])assert.throws(()=>api.pendingWorkVerifierStageCanonicalItem({...children[0],...mutation},tx.txid,records,NOW),e=>e.code==='PENDING_WORK_STAGE_DECISION_INVALID');
 const items=[parent,...children].map(item=>api.pendingWorkVerifierStageCanonicalItem(item,tx.txid,records,NOW));
 const altered=structuredClone(items);altered[1].mailEnvelope.protocolVout++;
 assert.equal(validateWorkMailBatchV1PendingDecision({transaction:tx,items:altered}).valid,false);
});
test('Mail serializer preserves zero child fees and complete parent-bound envelope metadata',()=>{
 const api=apiFunctions(),tx=transaction(),result=api.pendingWorkVerifierStageReplayState(base(),tx,'livenet',null,ACTIVE);
 const output=api.mailAttachedCreditsFromRecord({attachedCredits:result.transfers},'livenet');
 assert.equal(output.length,2);assert.ok(output.every(row=>row.paidSats===0&&row.minerFeeSats===0&&row.registryMutationFeeSats===0));
 assert.deepEqual(JSON.parse(JSON.stringify(output[0].mailEnvelope)),JSON.parse(JSON.stringify(result.transferBatches[0].mailEnvelope)));
 assert.equal(output[0].batchRecipientIndex,0);assert.equal(output[0].batchRecipientCount,2);assert.equal(output[0].rawCandidate,false);
 const legacy=api.mailAttachedCreditsFromRecord({attachedCredits:[{...result.transfers[0],transferVersion:undefined,paidSats:undefined}]},'livenet');assert.equal(legacy[0].paidSats,546);
});
