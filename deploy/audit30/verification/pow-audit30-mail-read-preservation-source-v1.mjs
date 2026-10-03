#!/usr/bin/env node
// Source-only read projection fixtures: no API/SQL/Core/native calls or source edits.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import ts from '/home/sixer/ProofOfWork.Me/node_modules/typescript/lib/typescript.js';
const ROOT='/home/sixer/ProofOfWork.Me/';
const api='server/proof-api.mjs',reader='server/db/proof-index-reader.mjs';
const pins={[api]:'9ab92c0fe3cb358fcaacccd62915eabc4c9ee75e42d29c6c989259b1305436f4',[reader]:'9278b81473c23a2c9d06c6b1306268c360539f833cdd7967b73fd99a35275b87','scripts/backfill-proof-indexer.mjs':'fab9f9540d2e59cb76fba915ed7ac8ef962df6a38c3b2a5d24773cd4e4b08c15'};
const src={},trees={};for(const[file,sha]of Object.entries(pins)){const raw=readFileSync(ROOT+file);assert.equal(createHash('sha256').update(raw).digest('hex'),sha);src[file]=raw.toString();trees[file]=ts.createSourceFile(file,src[file],ts.ScriptTarget.Latest,true,ts.ScriptKind.JS);}
function node(file,name){const tree=trees[file],n=tree.statements.find(v=>ts.isFunctionDeclaration(v)&&v.name?.text===name);assert.ok(n,name);return n;}
function load(file,name,bindings){return new Function(...Object.keys(bindings),`"use strict"; return (${node(file,name).getText(trees[file]).replace(/^export /u,'')});`)(...Object.values(bindings));}
const names=[];async function check(name,fn){await fn();names.push(name);}
function freeze(v){if(v&&typeof v==='object'){Object.freeze(v);for(const x of Object.values(v))freeze(x);}return v;}
const subject=load(reader,'subjectOnlyMailBody',{}),memo=load(reader,'mailMemoFromEvent',{subjectOnlyMailBody:subject});
for(const[title,row,payload,expected]of[
 ['payload exact whitespace before stored trimmed body',{body_text:'hello'},{body:' \thello\n '},' \thello\n '],
 ['stored exact bytes when payload empty',{body_text:' \tstored\n '},{body:''},' \tstored\n '],
 ['raw detail preserves tabs/newlines',{body_text:null},{detail:'\t raw detail \n'},'\t raw detail \n'],
 ['whitespace-only payload retained',{body_text:'stored'},{body:' \t\n'},' \t\n'],
 ['empty and null do not synthesize body',{body_text:null},{body:''},''],
 ['subject-only placeholder remains filtered',{body_text:'Subject: hi'},{body:''},''],
])await check(title,()=>{const before=JSON.stringify({row,payload});freeze(row);freeze(payload);assert.equal(memo(row,payload),expected);assert.equal(JSON.stringify({row,payload}),before);});
const tx='a'.repeat(64),original=freeze({address:'fixture',network:'livenet',inboxMessages:[{txid:tx,memo:'trimmed',confirmed:true,subject:'S'}],sentMessages:[]});
function payloadHarness({fresh=false,requires=true,enrich=false,indexed=original}={}){
 const calls=[];
 const functions={
  indexedMailPayload:async()=>{calls.push('indexed-select');return indexed;},livenetAddressMailRequiresProofIndex:()=>requires,MAIL_INDEXED_REQUEST_NODE_ENRICH_ENABLED:enrich,
  payloadWithFallbackAfterMs:async(p)=>p,MAIL_INDEXED_ENRICH_WAIT_MS:2500,
  mailPayloadWithIndexedEventOverlay:async p=>{calls.push('read-only-event-overlay');return p;},
  mailPayloadWithPendingRecentOverlay:async p=>{calls.push('pending-response-overlay');return p;},
  reconcileMailPayloadStatuses:async p=>{calls.push('response-status');return p;},
  repairPendingMailWorkAttachments:async p=>{calls.push('response-pending-attachment');return p;},
  mailPayloadWithRecentOverlay:async p=>{calls.push('raw-response-overlay');return p;},
  repairMailPayloadBodies:async p=>{calls.push('raw-response-body');return {...p,inboxMessages:p.inboxMessages.map(m=>({...m,memo:' \thello\n '}))};},
  freshDataUnavailableError:message=>new Error(message),mailPayloadHasMessages:p=>p.inboxMessages?.length>0,
  MAIL_ADDRESS_TX_PAGES:8,MAIL_INDEXED_RECENT_TX_PAGES:4,
  nodeMailPayload:async()=>{calls.push('raw-read');return original;},
  mergeMailPayloads:(a,b)=>({...a,...b}),errorSummary:e=>e.message,console:{error:()=>{}},
 };
 return{fn:load(api,'mailPayload',functions),calls,opts:{fresh}};
}
for(const fresh of[false,true])await check(`indexed-only ${fresh?'fresh':'cached'} request never invokes raw body repair`,async()=>{const h=payloadHarness({fresh});const result=await h.fn('fixture','livenet',h.opts);assert.equal(result,original);assert.deepEqual(h.calls,['indexed-select','read-only-event-overlay','pending-response-overlay','response-status','response-pending-attachment']);});
for(const fresh of[false,true])await check(`optional enrichment ${fresh?'fresh':'cached'} changes response, not frozen stored input`,async()=>{const h=payloadHarness({fresh,enrich:true});const result=await h.fn('fixture','livenet',h.opts);assert.equal(result.inboxMessages[0].memo,' \thello\n ');assert.equal(original.inboxMessages[0].memo,'trimmed');assert.ok(h.calls.includes('raw-response-body'));assert.equal(h.calls.includes('raw-read'),false);});
await check('required indexed-mail missing refuses without raw fallback or writes',async()=>{const h=payloadHarness({fresh:true,indexed:null});await assert.rejects(h.fn('fixture','livenet',h.opts),/Current indexed mailbox is unavailable/u);assert.deepEqual(h.calls,['indexed-select']);});
await check('unindexed raw fallback computes response without changing source input',async()=>{const h=payloadHarness({fresh:true,requires:false,indexed:null});const result=await h.fn('fixture','livenet',h.opts);assert.ok(h.calls.includes('raw-read'));assert.ok(h.calls.includes('raw-response-body'));assert.equal(result.inboxMessages[0].memo,' \thello\n ');assert.equal(original.inboxMessages[0].memo,'trimmed');});
const bodyRepair=load(api,'repairMailPayloadBodies',{
 MAIL_BODY_REPAIR_MAX_TXS:12,mailMessageNeedsContentRepair:()=>true,compareMailContentRepairPriority:()=>0,
 fetchTransactionWithSourceFallback:async()=>({txid:tx}),inboxMessagesFromTransactions:()=>[{txid:tx,memo:' \t raw body\n '}],sentMessagesFromTransactions:()=>[],
 mailMessageHasRealBody:message=>!!message?.memo,mergeRepairedMailMessage:(message,recovered)=>({...message,...recovered}),mergedSourceLabel:(a,b)=>[a,b].filter(Boolean).join('+'),console:{error:()=>{}},errorSummary:e=>e.message,
});
await check('actual raw-body repair returns new objects and leaves old rows immutable',async()=>{const input=freeze({inboxMessages:[{txid:tx,memo:'',confirmed:true}],sentMessages:[]});const output=await bodyRepair(input,'fixture','livenet');assert.equal(input.inboxMessages[0].memo,'');assert.equal(output.inboxMessages[0].memo,' \t raw body\n ');assert.notEqual(output,input);});
await check('API source imports no DB writer/worker and issues no query calls',()=>{
 const apiTree=trees[api];let queryCalls=0;
 function visit(n){if(ts.isCallExpression(n)&&ts.isPropertyAccessExpression(n.expression)&&n.expression.name.text==='query')queryCalls++;ts.forEachChild(n,visit);}visit(apiTree);assert.equal(queryCalls,0);
 const imports=apiTree.statements.filter(ts.isImportDeclaration).map(n=>n.moduleSpecifier.text);assert.ok(imports.includes('./db/proof-index-reader.mjs'));assert.equal(imports.some(n=>/backfill-proof-indexer|run-proof-indexer-worker|proof-index-writer/u.test(n)),false);
});
await check('indexed mail function query arguments are SELECT-only closed source',()=>{
 const queries=[];function visit(n){if(ts.isCallExpression(n)&&ts.isPropertyAccessExpression(n.expression)&&n.expression.name.text==='query')queries.push(n.arguments[0].getText(trees[reader]));ts.forEachChild(n,visit);}visit(node(reader,'proofIndexAddressMailPayload'));assert.equal(queries.length,2);
 assert.match(queries[0],/WITH candidate_events AS/u);assert.match(queries[1],/SELECT txid, first_seen_at/u);for(const q of queries)assert.doesNotMatch(q,/\b(?:INSERT|UPDATE|DELETE|TRUNCATE|CALL)\b/u);
});
await check('API event history overlay enters a read-only RR transaction',()=>assert.match(node(reader,'proofIndexEventHistoryPayload').getText(trees[reader]),/BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY/u));
await check('historical writer remains separate backfill body UPSERT',()=>{
 assert.match(src['scripts/backfill-proof-indexer.mjs'],/INSERT INTO proof_indexer\.mail_items[\s\S]*body_text = EXCLUDED\.body_text/u);
 for(const f of['mailPayload','repairMailPayloadBodies','mailPayloadWithIndexedEventOverlay','reconcileMailPayloadStatuses','fetchTransactionWithSourceFallback'])assert.doesNotMatch(node(api,f).getText(trees[api]),/upsertEvent|proofIndexCanonicalMailProjectionRows|repairCanonicalMailProjection|INSERT INTO|UPDATE proof_indexer/u);
});
console.log(JSON.stringify({schema:'pow-audit30-mail-read-preservation-source-fixtures-v1',passed:names.length,cases:names,sourcePins:pins,nativeCalls:0,sourceEdits:false,qualification:'Function fixtures use fake retrieval callbacks. Source reachability does not attest runtime credentials, other processes, or future repairs; worker/backfill remains write-capable under separately guarded scope.'}));
