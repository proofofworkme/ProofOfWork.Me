import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";
import * as bitcoin from "bitcoinjs-lib";
const ast = ts.createSourceFile("api.mjs", readFileSync("server/proof-api.mjs", "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
const names = ["bitcoinRpcHydrationProducer", "bitcoinRpcHydrationAdmissionCause", "bitcoinRpcHydrationUnavailable", "bitcoinRpcHydrationRelease", "bitcoinRpcAcquireHydrationSlot", "mapWithConcurrencyStopAndDrain", "mapWithConcurrency", "transactionInputsHavePrevouts", "transactionHasCompleteCanonicalPrevouts", "fetchTransactionFromBitcoinRpc", "fetchFixedAmoDeclarationTransaction"];
const state = () => ({ active: 0, activeByProducer: { "transaction-read": 0, "pending-verifier": 0, "declaration-read": 0 }, lastGrantedProducer: "transaction-read", queue: [] });
function fixture(overrides = {}) {
  const admission = state(), logs = [], cache = new Map(); const declarationFlights = new Map();
  const globals = { Buffer, bitcoin, structuredClone, declarationHydrationAuthority: Symbol("test-declaration"), WORK_AMO_V5_DECLARATION_TXID: "5".repeat(64), WORK_AMO_V6_DECLARATION_TXID: "6".repeat(64), setTimeout, clearTimeout, console: { warn: (s) => logs.push(JSON.parse(s)), error: () => {} }, declarationHydrationInFlight: declarationFlights, bitcoinRpcHydrationAdmission: admission, bitcoinRpcHydrationDiagnostics: { nextLogAt: 0, counts: Object.create(null) }, bitcoinRpcGetRawTransactionAdmission: { active: 0, queue: [] }, BITCOIN_RPC_GETRAWTRANSACTION_MAX_IN_FLIGHT: 1, BITCOIN_RPC_GETRAWTRANSACTION_MAX_QUEUE: 14, BITCOIN_RPC_GETRAWTRANSACTION_QUEUE_WAIT_MS: 1000, TRANSACTION_CACHE: cache, MAX_TRANSACTION_CACHE_SIZE: 100, TX_FETCH_CONCURRENCY: 2, errorSummary: (e) => String(e?.code), coreVoutToMempoolVout: (o) => ({ scriptpubkey: o.scriptPubKey.hex, value: Math.round(o.value * 100_000_000) }), ...overrides };
  const source = names.map((name) => { const nodes = ast.statements.filter((n) => ts.isFunctionDeclaration(n) && n.name?.text === name); assert.equal(nodes.length, 1, name); return nodes[0].getText(ast); }).join("\n");
  const api = new vm.Script(`${source}\n({${names.join(",")}})`).runInContext(vm.createContext(globals));
  return { ...api, admission, logs, cache, declarationFlights, authority: globals.declarationHydrationAuthority };
}
const defer = () => { let resolve, reject; const promise = new Promise((a,b) => { resolve=a; reject=b; }); return {promise,resolve,reject}; };
const tick = () => new Promise((r) => setImmediate(r));

test("mixed cold load reserves verifier headroom, alternates classes and drains without leaks", async () => {
  const f = fixture(); const first = await f.bitcoinRpcAcquireHydrationSlot("transaction-read");
  const ordinary = Array.from({length:4}, () => f.bitcoinRpcAcquireHydrationSlot("transaction-read"));
  await assert.rejects(f.bitcoinRpcAcquireHydrationSlot("transaction-read"), { code: "POW_BITCOIN_RPC_HYDRATION_QUEUE_FULL" });
  const verifier = Array.from({length:8}, () => f.bitcoinRpcAcquireHydrationSlot("pending-verifier"));
  await assert.rejects(f.bitcoinRpcAcquireHydrationSlot("pending-verifier"), { code: "POW_BITCOIN_RPC_HYDRATION_QUEUE_FULL" });
  assert.equal(f.admission.queue.length,12); first(); first();
  (await verifier[0])(); (await ordinary[0])(); (await verifier[1])(); (await ordinary[1])(); (await verifier[2])(); (await ordinary[2])(); (await verifier[3])(); (await ordinary[3])();
  for (const p of verifier.slice(4)) (await p)();
  assert.equal(f.admission.active,0); assert.equal(f.admission.queue.length,0);
  assert.equal(Object.values(f.admission.activeByProducer).reduce((a,b)=>a+b),0);
});
test("timed-out queue entries never consume a later permit", async () => {
  const f=fixture(); const release=await f.bitcoinRpcAcquireHydrationSlot("pending-verifier");
  await assert.rejects(f.bitcoinRpcAcquireHydrationSlot("pending-verifier", {queueWaitMs:5}), {code:"POW_BITCOIN_RPC_HYDRATION_QUEUE_TIMEOUT"});
  assert.equal(f.admission.queue.length,0); release(); const next=await f.bitcoinRpcAcquireHydrationSlot("transaction-read"); next(); assert.equal(f.admission.active,0);
});
test("failed verifier batch stops scheduling and waits for admitted work; success retains order", async () => {
  const f=fixture(), held=defer(), started=[]; const fault=new Error("admission unavailable"); let settled=false;
  const batch=f.mapWithConcurrencyStopAndDrain([0,1,2,3],2,async (n)=>{started.push(n); if(n===0) throw fault; await held.promise;});
  const outcome=batch.catch((e)=>{settled=true;assert.equal(e,fault);}); await tick(); assert.deepEqual(started,[0,1]); assert.equal(settled,false); held.resolve(); await outcome;
  assert.deepEqual(Array.from(await f.mapWithConcurrencyStopAndDrain([3,2,1],2,async n=>n*2)),[6,4,2]);
});
test("diagnostics accept fixed causes/classes, are rate limited and cannot change errors",()=>{
  const f=fixture(); assert.equal(f.bitcoinRpcHydrationAdmissionCause({code:-5}),null);
  for(let n=0;n<20;n++) { const e=f.bitcoinRpcHydrationUnavailable("POW_BITCOIN_RPC_RAW_QUEUE_FULL","private-address"); assert.equal(e.rpcAdmission.producer,"transaction-read"); }
  assert.equal(f.logs.length,1); assert.equal(JSON.stringify(f.logs).includes("private-address"),false);
  const broken=fixture({console:{warn:()=>{throw new Error("observer");},error:()=>{}}}); assert.equal(broken.bitcoinRpcHydrationUnavailable("POW_BITCOIN_RPC_RAW_QUEUE_TIMEOUT","pending-verifier").code,"POW_BITCOIN_RPC_RAW_QUEUE_TIMEOUT");
});
const parentId="a".repeat(64), childId="b".repeat(64);
const parent={txid:parentId,confirmations:2,vin:[{coinbase:"00"}],vout:[{value:0.00002,scriptPubKey:{hex:"51"}}]};
const child={txid:childId,confirmations:1,vin:[{txid:parentId,vout:0}],vout:[{value:0.00001,scriptPubKey:{hex:"51"}}]};
test("nested parent reads bypass the held hydration permit; canonical values and cache fences survive",async()=>{
  let calls=0; const f=fixture({bitcoinRpc:async (_,[id])=>{calls++;return {ok:true,result:id===parentId?parent:child};}});
  const tx=await f.fetchTransactionFromBitcoinRpc(childId,"livenet",{requireCanonicalPrevouts:true}); assert.equal(tx.vin[0].prevout.value,2000); assert.equal(tx.vout[0].value,1000); assert.equal(f.admission.active,0);
  assert.equal(await f.fetchTransactionFromBitcoinRpc(childId,"livenet",{requireCanonicalPrevouts:true}),tx); assert.equal(calls,2);
  await f.fetchTransactionFromBitcoinRpc(childId,"livenet",{requireCanonicalPrevouts:true,bypassCache:true,cacheResult:false}); assert.equal(calls,4);
});
test("local raw admission retains cause and producer; genuine absence remains fail closed",async()=>{
  let code="POW_BITCOIN_RPC_RAW_QUEUE_FULL"; const f=fixture({bitcoinRpc:async()=>({ok:false,error:{code}})});
  await assert.rejects(f.fetchTransactionFromBitcoinRpc(childId,"livenet",{requireCanonicalPrevouts:true,rpcHydrationProducer:"pending-verifier"}),e=>e.code===code&&e.rpcAdmission.phase==="raw-rpc-admission"&&e.rpcAdmission.producer==="pending-verifier"); assert.equal(f.admission.active,0);
  code=-5; await assert.rejects(f.fetchTransactionFromBitcoinRpc(childId,"livenet",{requireCanonicalPrevouts:true}),/could not resolve canonical/); assert.equal(await f.fetchTransactionFromBitcoinRpc(childId,"livenet"),null); assert.equal(f.cache.size,0);
});
test("failed parent fanout holds its permit until remaining parents drain",async()=>{
  const held=defer(); let parentCalls=0,settled=false; const f=fixture({bitcoinRpc:async (_,[id])=>{
    if(id===childId)return {ok:true,result:{...child,vin:[{txid:parentId,vout:0},{txid:"c".repeat(64),vout:0}]}};
    parentCalls++; if(id===parentId)return {ok:false,error:{code:-28}}; await held.promise; return {ok:true,result:parent};
  }});
  const p=f.fetchTransactionFromBitcoinRpc(childId,"livenet",{requireCanonicalPrevouts:true}).catch(e=>{settled=true;assert.match(e.message,/could not resolve canonical/);}); await tick(); assert.equal(parentCalls,2);assert.equal(settled,false);assert.equal(f.admission.active,1);held.resolve();await p;assert.equal(f.admission.active,0);
});
test("malformed raw bytes and raw/verbose disagreement still reject without caching",async()=>{
  const raw=new bitcoin.Transaction(); raw.addInput(Buffer.from(parentId,"hex").reverse(),0); raw.addOutput(Buffer.from("51","hex"),1000n); const id=raw.getId();
  let hex="00", value=0.00001; const f=fixture({bitcoinRpc:async (_,[requested])=>({ok:true,result:requested===parentId?parent:{txid:id,hex,version:raw.version,locktime:raw.locktime,confirmations:1,vin:[{txid:parentId,vout:0,sequence:0xffffffff}],vout:[{value,scriptPubKey:{hex:"51"}}]}})});
  const opts={includeRawHex:true,requireCanonicalPrevouts:true,bypassCache:true,cacheResult:false};await assert.rejects(f.fetchTransactionFromBitcoinRpc(id,"livenet",opts),/do not bind/);hex=raw.toHex();value=0.00002;await assert.rejects(f.fetchTransactionFromBitcoinRpc(id,"livenet",opts),/disagree/);value=0.00001;assert.equal((await f.fetchTransactionFromBitcoinRpc(id,"livenet",opts)).txid,id);assert.equal(f.cache.size,0);assert.equal(f.admission.active,0);
});

test("combined background and verifier hydration uses actual raw admission within four slots",async()=>{
  let f, coreActive=0, peak=0, calls=0; const rawState={active:0,queue:[]};
  const rawNames=["bitcoinRpcRawAdmissionRelease","bitcoinRpcAcquireRawSlot","bitcoinRpcRawAdmissionFailureResponse","bitcoinRpcWithRawAdmission"];
  const rawSource=rawNames.map(name=>ast.statements.find(n=>ts.isFunctionDeclaration(n)&&n.name?.text===name).getText(ast)).join("\n");
  const raw=new vm.Script(`${rawSource}\n({${rawNames.join(",")}})`).runInContext(vm.createContext({setTimeout,clearTimeout,BITCOIN_RPC_GETRAWTRANSACTION_MAX_IN_FLIGHT:4,BITCOIN_RPC_GETRAWTRANSACTION_MAX_QUEUE:64,BITCOIN_RPC_GETRAWTRANSACTION_QUEUE_WAIT_MS:5000,bitcoinRpcGetRawTransactionAdmission:rawState}));
  const rpc=async(method,params)=>raw.bitcoinRpcWithRawAdmission(method,params,{request:async()=>{coreActive++;peak=Math.max(peak,coreActive);calls++;await new Promise(r=>setTimeout(r,2));coreActive--;return {ok:true,result:params[0]===parentId?parent:child};}});
  f=fixture({bitcoinRpc:rpc,BITCOIN_RPC_GETRAWTRANSACTION_MAX_IN_FLIGHT:4,BITCOIN_RPC_GETRAWTRANSACTION_MAX_QUEUE:64,BITCOIN_RPC_GETRAWTRANSACTION_QUEUE_WAIT_MS:5000});
  const opts={bypassCache:true,cacheResult:false,requireCanonicalPrevouts:true};
  const background=Array.from({length:20},()=>f.fetchTransactionFromBitcoinRpc(childId,"livenet",opts));
  const pending=f.mapWithConcurrencyStopAndDrain(Array.from({length:20},()=>childId),8,id=>f.fetchTransactionFromBitcoinRpc(id,"livenet",{...opts,rpcHydrationProducer:"pending-verifier"}));
  const result=await Promise.all([...background,pending]);assert.equal(result.length,21);assert.equal(calls,80);assert.ok(peak<=4);assert.equal(rawState.active,0);assert.equal(rawState.queue.length,0);assert.equal(f.admission.active,0);assert.equal(f.admission.queue.length,0);
});
test("stage separates local admission from malformed chain evidence without bypassing initial tip fence",async()=>{
  const node=ast.statements.find(n=>ts.isFunctionDeclaration(n)&&n.name?.text==="pendingWorkVerifierStagePayload");
  let cause="POW_BITCOIN_RPC_RAW_QUEUE_FULL", tipReady=true, fetched=0;const f=fixture();
  const globals={...f,TX_FETCH_CONCURRENCY:8,bitcoinRpc:async()=>({ok:true}),pendingWorkVerifierStageRequest:()=>({network:"livenet",absenceEvidence:{observations:[]},confirmedRemovalTxids:[],replayTxids:[childId]}),proofIndexOperationalStatusPayload:async()=>({}),proofIndexCanonicalStateMetaPayload:async()=>({}),proofIndexReadinessEpochCheckpoint:async()=>({}),exactCoreTipFromBlockchainInfo:()=>({height:1,blockHash:parentId}),proofIndexExactlyCoversCoreTip:()=>tipReady,pendingWorkVerifierStageCoreAuthority:()=>{},pendingWorkVerifierStageCoreMempool:()=>[],pendingWorkVerifierStageValidateMembership:()=>{},pendingWorkVerifierStageProveCoreAbsence:async()=>{},pendingWorkVerifierStageProveCoreConfirmedRemovals:async()=>{},proofIndexCanonicalSummaryTokenTablePayload:async()=>({}),pendingWorkVerifierStageConfirmedTransitionCommitment:async()=>({}),fetchTransactionFromBitcoinRpc:async(_id,_network,options)=>{fetched++;assert.equal(options.rpcHydrationProducer,"pending-verifier");assert.equal(options.bypassCache,true);assert.equal(options.cacheResult,false);throw Object.assign(new Error("bad hydration"),{code:cause,rpcAdmission:{producer:"pending-verifier"}});},pendingWorkVerifierStageError:(code,message,details)=>Object.assign(new Error(message),{code,details}),errorSummary:e=>e.message};
  const stage=new vm.Script(`${node.getText(ast)}\npendingWorkVerifierStagePayload`).runInContext(vm.createContext(globals));
  await assert.rejects(stage({}),e=>e.code==="PENDING_WORK_STAGE_RPC_ADMISSION_UNAVAILABLE"&&e.details.rpcAdmission.code===cause);
  cause="malformed";await assert.rejects(stage({}),e=>e.code==="PENDING_WORK_STAGE_TRANSACTION_HYDRATION_INVALID");tipReady=false;await assert.rejects(stage({}),e=>e.code==="PENDING_WORK_STAGE_EXACT_TIP_UNAVAILABLE");assert.equal(fetched,2);
});
test("pending transaction observations are re-read and never become confirmed cache entries",async()=>{
  let epoch=1,calls=0;const f=fixture({bitcoinRpc:async(method,[id])=>{calls++;if(method==="getmempoolentry")return {ok:true,result:{time:epoch}};return {ok:true,result:id===parentId?parent:{...child,confirmations:0}};}});
  const options={requireCanonicalPrevouts:true,bypassCache:true,cacheResult:false};assert.equal((await f.fetchTransactionFromBitcoinRpc(childId,"livenet",options)).status.mempool_time,1);epoch=2;assert.equal((await f.fetchTransactionFromBitcoinRpc(childId,"livenet",options)).status.mempool_time,2);assert.equal(calls,6);assert.equal(f.cache.size,0);assert.equal(f.admission.active,0);
});

test("three classes retain FIFO, rotate fairly, and reserve 8 + 2 within total64", async () => {
  const f = fixture({BITCOIN_RPC_GETRAWTRANSACTION_MAX_QUEUE:64});
  const held = await f.bitcoinRpcAcquireHydrationSlot("transaction-read");
  const observed=[];
  const enqueue=(producer,n)=>f.bitcoinRpcAcquireHydrationSlot(producer).then(release=>{observed.push(producer+":"+n);release();});
  const ordinary=Array.from({length:54},(_,n)=>enqueue("transaction-read",n));
  await assert.rejects(f.bitcoinRpcAcquireHydrationSlot("transaction-read"),{code:"POW_BITCOIN_RPC_HYDRATION_QUEUE_FULL"});
  const pending=Array.from({length:8},(_,n)=>enqueue("pending-verifier",n));
  await assert.rejects(f.bitcoinRpcAcquireHydrationSlot("pending-verifier"),{code:"POW_BITCOIN_RPC_HYDRATION_QUEUE_FULL"});
  const declarations=Array.from({length:2},(_,n)=>enqueue("declaration-read",n));
  assert.equal(f.admission.queue.length,64);
  await assert.rejects(f.bitcoinRpcAcquireHydrationSlot("declaration-read"),{code:"POW_BITCOIN_RPC_HYDRATION_QUEUE_FULL"});
  held(); await Promise.all([...ordinary,...pending,...declarations]);
  assert.deepEqual(observed.slice(0,6),["pending-verifier:0","declaration-read:0","transaction-read:0","pending-verifier:1","declaration-read:1","transaction-read:1"]);
  for(const [producer,count]of[["transaction-read",54],["pending-verifier",8],["declaration-read",2]])
    assert.deepEqual(observed.filter(x=>x.startsWith(producer)),Array.from({length:count},(_,n)=>producer+":"+n));
  assert.equal(f.admission.active,0); assert.equal(f.admission.queue.length,0);
});
test("reduced queue caps never enlarge total reservations and timed-out declarations leak no permit",async()=>{
  for(const cap of [0,1,2,3,8,9,10]) {
    const f=fixture({BITCOIN_RPC_GETRAWTRANSACTION_MAX_QUEUE:cap});
    const held=await f.bitcoinRpcAcquireHydrationSlot("transaction-read");
    const waits=[];
    for(let n=0;n<Math.max(0,cap-2);n++)waits.push(f.bitcoinRpcAcquireHydrationSlot("pending-verifier"));
    for(let n=0;n<Math.min(2,cap);n++)waits.push(f.bitcoinRpcAcquireHydrationSlot("declaration-read"));
    assert.equal(f.admission.queue.length,cap);
    await assert.rejects(f.bitcoinRpcAcquireHydrationSlot("declaration-read"),{code:"POW_BITCOIN_RPC_HYDRATION_QUEUE_FULL"});
    const completed=waits.map(p=>p.then(r=>r()));held();await Promise.all(completed);assert.equal(f.admission.active,0);
  }
  const f=fixture();const held=await f.bitcoinRpcAcquireHydrationSlot("transaction-read");
  await assert.rejects(f.bitcoinRpcAcquireHydrationSlot("declaration-read",{queueWaitMs:5}),{code:"POW_BITCOIN_RPC_HYDRATION_QUEUE_TIMEOUT"});
  assert.equal(f.admission.queue.length,0);held();assert.equal(f.admission.active,0);
});
test("fixed declarations share only overlapping hydration, clone all evidence, then re-read",async()=>{
  const gate=defer();let calls=0;const id="5".repeat(64);
  const f=fixture({bitcoinRpc:async(_,[txid])=>{calls++;if(txid===id)await gate.promise;return {ok:true,result:txid===parentId?parent:{...child,txid}};}});
  const a=f.fetchFixedAmoDeclarationTransaction(id,"livenet"),b=f.fetchFixedAmoDeclarationTransaction(id,"livenet");
  await tick();assert.equal(calls,1);assert.equal(f.declarationFlights.size,1);assert.equal(f.admission.activeByProducer["declaration-read"],1);
  gate.resolve();const[x,y]=await Promise.all([a,b]);assert.equal(calls,2);assert.deepEqual(x,y);assert.notEqual(x,y);x.vin[0].prevout.value=0;assert.equal(y.vin[0].prevout.value,2000);
  assert.equal(f.declarationFlights.size,0);assert.equal(f.cache.size,0);
  await f.fetchFixedAmoDeclarationTransaction(id,"livenet");assert.equal(calls,4);
});
test("distinct declarations have separate flights and fixed options cannot be downgraded",async()=>{
  const gate=defer();let calls=0;const f=fixture({BITCOIN_RPC_GETRAWTRANSACTION_MAX_IN_FLIGHT:4,bitcoinRpc:async(_,[txid])=>{calls++;if(txid!==parentId)await gate.promise;return {ok:true,result:txid===parentId?parent:{...child,txid}};}});
  const a=f.fetchFixedAmoDeclarationTransaction("5".repeat(64),"livenet",{includePrevouts:false});
  const b=f.fetchFixedAmoDeclarationTransaction("6".repeat(64),"livenet");await tick();assert.equal(f.declarationFlights.size,2);assert.equal(calls,2);gate.resolve();
  for(const tx of await Promise.all([a,b]))assert.equal(tx.vin[0].prevout.value,2000);
  assert.equal(calls,4);assert.equal(f.cache.size,0);
  await assert.rejects(f.fetchFixedAmoDeclarationTransaction(childId,"livenet"),/Unrecognized/);
  await assert.rejects(f.fetchFixedAmoDeclarationTransaction("5".repeat(64),"testnet"),/Unrecognized/);
  await assert.rejects(f.fetchFixedAmoDeclarationTransaction("","livenet"),/Unrecognized/);assert.equal(calls,4);
});
test("rejected declaration flights evict, preserve errors, and retry fresh",async()=>{
  let bad=true,calls=0;const f=fixture({bitcoinRpc:async(_,[txid])=>{calls++;return bad?{ok:false,error:{code:-28}}:{ok:true,result:txid===parentId?parent:{...child,txid}};}});
  const reads=[f.fetchFixedAmoDeclarationTransaction("5".repeat(64),"livenet"),f.fetchFixedAmoDeclarationTransaction("5".repeat(64),"livenet")];
  const result=await Promise.allSettled(reads);assert.equal(calls,1);assert.ok(result.every(r=>r.status==="rejected"));assert.equal(result[0].reason,result[1].reason);assert.equal(f.declarationFlights.size,0);assert.equal(f.admission.active,0);
  bad=false;assert.equal((await f.fetchFixedAmoDeclarationTransaction("5".repeat(64),"livenet")).vin[0].prevout.value,2000);assert.equal(calls,3);
});
test("generic caller cannot forge declaration admission with a label or foreign transaction",async()=>{
  const gate=defer();const f=fixture({bitcoinRpc:async(_,[id])=>{await gate.promise;return {ok:true,result:id===parentId?parent:{...child,txid:id}};}});
  const p=f.fetchTransactionFromBitcoinRpc("5".repeat(64),"livenet",{rpcHydrationProducer:"declaration-read",bypassCache:true,cacheResult:false,requireCanonicalPrevouts:true,includePrevouts:true,includeRawHex:false});
  await tick();assert.equal(f.admission.activeByProducer["transaction-read"],1);assert.equal(f.admission.activeByProducer["declaration-read"],0);gate.resolve();await p;
  const foreign=f.fetchTransactionFromBitcoinRpc(childId,"livenet",{[f.authority]:true,bypassCache:true,cacheResult:false,requireCanonicalPrevouts:true,includePrevouts:true,includeRawHex:false});
  await foreign;assert.equal(f.admission.lastGrantedProducer,"transaction-read");
});

test("shared hydration cannot share a caller's canonical block-position verdict",async()=>{
  const gate=defer(),id="5".repeat(64),hash="c".repeat(64);let rawCalls=0,positionChecks=0,tipChecks=0;
  const f=fixture({bitcoinRpc:async(_,[txid])=>{rawCalls++;if(txid===id)await gate.promise;return {ok:true,result:txid===parentId?parent:{...child,txid,blockhash:hash}};}});
  const node=ast.statements.find(n=>ts.isFunctionDeclaration(n)&&n.name?.text==="workAmoV5Metadata");
  const globals={...f,console:{error:()=>{}},WORK_AMO_V5_DECLARATION_TXID:id,WORK_AMO_V5_DECLARATION_HEIGHT:959620,WORK_AMO_V5_DECLARATION_BLOCK_HASH:hash,WORK_AMO_V5_DECLARATION_BLOCK_INDEX:141,WORK_AMO_V5_WRITES_CONFIGURED:false,WORK_AMO_V5_DECLARATION_PINS_CONFIGURED:true,workAmoV5StatusCache:{},canonicalWorkMarketOracleNetworkValueQ8:()=>"",baseWorkAmoV5Metadata:()=>({}),bitcoinRpc:async(method)=>{tipChecks++;return {ok:true,result:method==="getblockcount"?971329:hash};},transactionBlockHash:tx=>tx.status.block_hash,fetchCoreBlockTxidIndex:async()=>new Map([[id,++positionChecks===1?141:140]]),workAmoV5DeclarationEvidenceFromTransaction:(_tx,index,canonical)=>({blockTransactionIndex:index,canonical}),validateWorkAmoV5DeclarationEvidence:e=>({valid:e?.canonical===true&&e?.blockHeight===959620&&e?.blockTransactionIndex===141}),reusableWorkAmoV5StatusCache:()=>false,proofIndexWorkAmoV5Declaration:async()=>null,proofIndexWorkUsdQuoteHead:async()=>null,proofIndexWorkAmoReplayReadiness:async()=>null,workAmoV5StatusFromEvidence:e=>({active:Boolean(e),declarationConfirmed:Boolean(e),quoteReady:false,quoteHead:null}),workAmoV5QuotePublicationContext:()=>({}),errorSummary:e=>e.message};
  const metadata=new vm.Script(node.getText(ast)+"\nworkAmoV5Metadata").runInContext(vm.createContext(globals));
  const a=metadata("livenet",{force:true}),b=metadata("livenet",{force:true});await tick();assert.equal(rawCalls,1);gate.resolve();const results=await Promise.all([a,b]);
  assert.equal(positionChecks,2);assert.equal(tipChecks,6);assert.equal(rawCalls,2);assert.equal(results[0].declarationConfirmed,true);assert.equal(results[1].declarationConfirmed,false);
});
