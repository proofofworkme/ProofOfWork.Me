import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import { createServer, request as httpRequest } from "node:http";
import * as bitcoin from "bitcoinjs-lib";
import { canonicalProtocolCandidateFromOutput, decodeCanonicalOpReturnOutput } from "../server/canonical-op-return.mjs";
import { acceptedHintTxids, pendingDiscoverySeen, planPendingDiscovery, finishPendingDiscovery } from "../server/pending-mempool-discovery.mjs";

const source = readFileSync(new URL("./backfill-proof-indexer.mjs", import.meta.url), "utf8");
function fromWorker(name, globals = {}) {
  const match = new RegExp(`^(?:async )?function ${name}\\([\\s\\S]*?^}`, "m").exec(source);
  assert.ok(match, name);
  return vm.runInNewContext(`(${match[0]})`, { Buffer, URL, AbortSignal, console, ...globals });
}
const id = n => n.toString(16).padStart(64,"0");
const cmp = (a,b) => a < b ? -1 : a > b ? 1 : 0;
const isHexTxid = x => typeof x === "string" && /^[0-9a-f]{64}$/u.test(x);
const anchor = fromWorker("normalizedMempoolScanCursor", { isHexTxid });
const after = fromWorker("mempoolEntriesAfterCursor", { normalizedMempoolScanCursor: anchor, compareCanonicalUtf8: cmp });
const legacyPlan = fromWorker("plannedMempoolScanCandidates", { isHexTxid, mempoolEntriesAfterCursor:after });
const byTime = (a,b) => b[1].time - a[1].time || cmp(a[0],b[0]);
function plan(entries, state, { now = 50000, limit = 500, hints = [], priority = [], seenLimit = 10000 } = {}) {
  const sorted = [...entries].sort(byTime);
  return planPendingDiscovery({ entries:sorted, state, priorityTxids:priority, hintTxids:hints,
    limit, seenLimit, sampledAtMs: now*1000, legacyPlan });
}
const seen = () => ({processedTxids:new Set()});
const plain = x => JSON.parse(JSON.stringify(x));

test("a Mail overtaken by sustained arrivals and recovery work progresses in bounded passes", () => {
  const initial = Array.from({length:10000},(_,i)=>[id(i+1),{time:10000+i}]);
  const target = initial[5200][0];
  const state = seen();
  let found = false;
  for (let cycle=0;cycle<32;cycle++) {
    for (let i=0;i<600;i++) initial.push([id(50000+cycle*600+i),{time:25000+cycle}]);
    const p = plan(initial,state,{now:30000+cycle,priority:initial.slice(0,400).map(x=>x[0])});
    const ids = p.candidates.map(x=>x.entry[0]);
    assert.equal(ids.length,500);assert.equal(new Set(ids).size,500);
    assert.ok(p.candidates.some(x=>x.lane==="cursor"));assert.ok(p.candidates.some(x=>x.lane==="priority"));
    const attempted=new Set(ids);
    if (p.candidates.find(x=>x.entry[0]===target && x.lane==="arrival")) found=true;
    ids.forEach(x=>state.processedTxids.add(x));
    state.discovery=finishPendingDiscovery(p,attempted,state.processedTxids,new Set());
    if (found) break;
  }
  assert.ok(found,"chronological progress is independent of a never-empty newest lane");
});

test("closed-second cutoff, equal-second order, anchor eviction, interrupts and round trips", () => {
  const state=seen(), one=[id(9),{time:100}], two=[id(10),{time:100}], late=[id(7),{time:101}];
  const first=plan([one,two,late],state,{now:101,limit:2});
  assert.deepEqual(first.arrivalPage,[{time:100,txid:one[0]}]);
  const idle=finishPendingDiscovery(first,new Set(),new Set(),new Set());
  assert.deepEqual(idle.arrivalCursor,first.cursor);
  state.discovery=plain(finishPendingDiscovery(first,new Set([one[0]]),new Set([one[0]]),new Set()));
  const next=plan([two,late,[id(1),{time:101}]],state,{now:101,limit:8});
  assert.deepEqual(next.arrivalPage,[{time:100,txid:two[0]}]);
  state.discovery=finishPendingDiscovery(next,new Set([two[0]]),new Set([two[0]]),new Set());
  const closed=plan([two,late,[id(1),{time:101}]],state,{now:102,limit:8});
  assert.deepEqual(closed.arrivalPage.map(x=>x.txid),[id(1),late[0]]);
  const marker=finishPendingDiscovery(closed,new Set([late[0]]),new Set([late[0]]),new Set());
  assert.deepEqual(marker.arrivalCursor,state.discovery.arrivalCursor,"an unvisited predecessor fences commit");
});

test("unresolved candidates rotate, cannot silently overflow the retry set, and eviction releases capacity", () => {
  const entries=Array.from({length:300},(_,i)=>[id(i+1),{time:i+1}]);
  const state=seen(), p=plan(entries,state), attempted=new Set(p.candidates.map(x=>x.entry[0]));
  state.discovery=finishPendingDiscovery(p,attempted,new Set(),new Set());
  assert.equal(state.discovery.retry.length,128);assert.equal(state.discovery.arrivalCursor.txid,id(128));
  assert.equal(state.discovery.retrySaturated,true);
  const next=plan(entries,state), retries=next.candidates.filter(x=>x.lane==="retry");
  assert.equal(retries.length,16);
  const marker=finishPendingDiscovery(next,new Set(retries.map(x=>x.entry[0])),new Set(),new Set());
  assert.deepEqual(marker.retry.slice(0,2),[id(17),id(18)]);
  const recovered=new Set([id(17)]),departed=new Set([id(18)]);
  state.discovery=finishPendingDiscovery(plan(entries,{...state,discovery:marker}),new Set(),recovered,departed);
  assert.equal(state.discovery.retry.length,126);
  const afterRemoval=plan(entries.slice(128),state);
  assert.equal(afterRemoval.retries.length,0);
  assert.equal(afterRemoval.arrivalPage[0].txid,id(129));
});

test("only well-formed current Core members qualify for hints; the hint lane cannot take over", () => {
  const ids=Array.from({length:256},(_,i)=>id(i+1)), entries=ids.map(txid=>[txid,{time:10}]);
  const wire={model:"accepted-broadcast-txid-hints-v1",network:"livenet",txids:ids};
  assert.deepEqual(acceptedHintTxids(wire,"livenet"),ids);
  for (const bad of [null,{...wire,model:"other"},{...wire,network:"testnet"},{...wire,txids:[id(1),id(1)]},
    {...wire,txids:[...ids,id(257)]},{...wire,txids:["invalid"]}]) assert.deepEqual(acceptedHintTxids(bad,"livenet"),[]);
  const state=seen(), p=plan(entries.slice(1),state,{hints:ids});
  const hinted=p.candidates.filter(x=>x.lane==="hint").map(x=>x.entry[0]);
  assert.equal(hinted.length,16);assert.equal(hinted[0],ids[1]);assert.ok(!p.hintSet.has(ids[0]));
  state.discovery=finishPendingDiscovery(p,new Set(hinted),new Set(hinted.slice(1)),new Set());
  const next=plan(entries.slice(1),state,{hints:ids});
  assert.ok(next.hintPage.every(x=>!hinted.includes(x)));assert.ok(next.candidates.some(x=>x.lane==="arrival"));
  const reentered=entries.map(([x,d])=>[x,{time:hinted.includes(x)?55:d.time}]);
  const wrap=plan(reentered,{...state,discovery:{...state.discovery,hintCursor:ids.at(-1)}},{hints:ids});
  assert.ok(wrap.hintPage.includes(hinted[1]),"old admission epoch cannot certify re-entry");
  assert.equal(pendingDiscoverySeen({processedTxids:new Set([id(1)]),discovery:{model:"pending-arrival-discovery-v1",sampleSecond:10}}, {[id(1)]:{time:10}}).size,0);
});

test("a one-slot or prematurely truncated pass rotates between candidate lanes", () => {
  const entries=Array.from({length:20},(_,i)=>[id(i+1),{time:50+i}]);
  const state=seen(), lanes=new Set();
  for (let i=0;i<8;i++) {
    const p=plan(entries,state,{limit:1,hints:[id(20)]});
    assert.equal(p.candidates.length,1);
    const chosen=p.candidates[0];lanes.add(chosen.lane);
    state.discovery=finishPendingDiscovery(p,new Set([chosen.entry[0]]),new Set(),new Set());
  }
  assert.ok(lanes.has("cursor"));assert.ok(lanes.has("arrival"));assert.ok(lanes.has("hint"));assert.ok(lanes.has("retry"));
  assert.equal(plan(entries,state,{limit:0,hints:[id(20)]}).candidates.length,0);
});

test("an unavailable or non-loopback hint reader cannot send the token or block discovery", async () => {
  const read = (base,fetch) => fromWorker("readPendingBroadcastHints",{ NETWORK:"livenet",INTERNAL_VERIFIER_TOKEN:"s".repeat(32),
    API_BASE:base, readCanonicalSummaryJsonViaLoopbackHttp:fetch,acceptedHintTxids })();
  let called=0;
  for (const base of ["https://other.example", "http://localhost:8081", "http://127.0.0.1:0", "http://user@127.0.0.1:8081"]) {
    assert.deepEqual(plain(await read(base,()=>{called++;})),[]);
  }
  assert.equal(called,0);
  assert.deepEqual(plain(await read("http://127.0.0.1:8081",(url,opts)=>{
    assert.equal(url.pathname,"/api/v1/internal/pending-discovery-hints");assert.equal(opts.maxBytes,24576);
    assert.equal(opts.headers["X-PoW-Internal-Verifier"],"s".repeat(32));throw Error("temporarily unavailable");
  })),[]);
});

// Verified Core bytes from block 974414. Only tests reference this txid.
const MAIL_TXID = "f2a4543e7a18ce1a6ed232c35a3ac03d99be05e603b738c2daf9865b01adb3f3";
const MAIL_HEX = "02000000012530bb7c6350e9cd5c5d4887cdba8707180b7dd62e02573e9feca10266b06680000000006a473044022062fa85160babf81b942d143990dd43b728b5eed538a9dc433fd22612cd1408bf02202366d3f0b875df2d8b0c2f570b16c78b5546669b2a1cd316947603c4ed8c3eec012103381daa7a1dbd0bfe55a6c1222b1b6779605c0ecc05b4e105477605c9029e31faffffffff0d0a040000000000002251208138ae5b81ec3380c9f9e566d57d2800537fffde3f890dae2c75e5504ce751130a04000000000000225120f139d44ee372c1288e0ef6632b8664096aa0dd30f369776b2e13c0c20538971f0a040000000000002251206fe3593c1ecc1dbf3a049441e2c15d1c4a176146f3f1f2b5393fe25ef77534860a040000000000001600147a8acd60f2a009f83dacba746fe9266193ff4f6d0a04000000000000160014d56bdf4b5ee88aa62bf4f0cc202ceb86735778090a04000000000000225120905ecfe968ef67d2f10f47540f787c9a5df1be0ac1c3e87feed36228c102e8d20a04000000000000225120af94eab0291686999d430cba442c02d76a1a9af50d1c9ae2923be986f05d686d0a04000000000000225120aaaa2fa43f03c517fae67cb7720bc2fce342169b487704dbb16a1c70618335c60a040000000000001600144a3b467db86bf0eaab76faa819aee4fff6813ee00a04000000000000160014d80f3b992f768ba2484fd989fc890d22bec73acf0a040000000000001600140753f1ed534358d5636a940ad465faa9f84336a700000000000000000b6a0970776d313a6d3a7266726f0000000000001976a914f0991bf16fe3667b4fb4523a20cdf83eed8501fc88ac00000000";
function historicalMail() {
  const tx = bitcoin.Transaction.fromHex(MAIL_HEX);
  assert.equal(tx.getId(),MAIL_TXID);
  return { txid: tx.getId(), hex: MAIL_HEX,
    vin:tx.ins.map(x=>({txid:Buffer.from(x.hash).reverse().toString("hex"),vout:x.index,sequence:x.sequence})),
    vout:tx.outs.map((x,n)=>({n,value:Number(x.value)/1e8,scriptPubKey:{hex:Buffer.from(x.script).toString("hex")}})) };
}
const messagesFromRaw = fromWorker("protocolMessagesFromTx",{canonicalProtocolCandidateFromOutput,decodeCanonicalOpReturnOutput,
  powcatCarrierKind:()=>null});

test("the reported public Mail has one exact carrier and eleven original payments; hints cannot alter them",async()=>{
  const raw=historicalMail(), messages=messagesFromRaw(raw,[]);
  assert.equal(raw.vout.filter(o=>Math.round(o.value*1e8)===1034).length,11);
  assert.equal(messages.length,1);assert.equal(messages[0].text,"pwm1:m:rf");assert.equal(messages[0].voutIndex,11);
  let time=1793725368;
  const verify=fromWorker("verifyHintedMempoolTransaction",{bitcoin,bitcoinRpc:async(method,[id])=>{
    assert.equal(method,"getmempoolentry");assert.equal(id,MAIL_TXID);return {time};}});
  await verify(MAIL_TXID,time,raw);
  for (const alter of [tx=>tx.vout[0].value+=0.000001,tx=>tx.vout[11].scriptPubKey.hex="6a",
    tx=>tx.vin[0].sequence--,tx=>tx.vin[0].vout++,tx=>tx.vin[0].txid=id(1),tx=>tx.hex=tx.hex.slice(4)]) {
    const changed=structuredClone(raw);alter(changed);await assert.rejects(verify(MAIL_TXID,time,changed));
  }
  await assert.rejects(verify(id(23),time,raw));
  time++;await assert.rejects(verify(MAIL_TXID,time-1,raw),/admission epoch/);
});

test("the measured November 3 position deterministically crosses the chronological bootstrap frontier",()=>{
  // 17:11:22 UTC census: rank 4638 / 42245, outside the 100 newest by the first pass.
  const source=Array.from({length:42245},(_,i)=>[id(i+1),{time:1793725368+4637-i}]);
  source[4637][0]=MAIL_TXID;
  const state=seen();state.cursor={time:source[15742][1].time,txid:source[15742][0]};
  const original=legacyPlan(source,state,[],{candidateLimit:500,seenLimit:10000});
  assert.ok(original.every(c=>c.entry[0]!==MAIL_TXID));
  let pass;
  for(pass=1;pass<=40;pass++) {
    const p=plan(source,state,{now:1793732000+pass});
    if(p.candidates.some(c=>c.lane==="arrival" && c.entry[0]===MAIL_TXID))break;
    const ids=new Set(p.candidates.map(c=>c.entry[0]));
    for(const txid of ids)state.processedTxids.add(txid);
    state.discovery=finishPendingDiscovery(p,ids,state.processedTxids,new Set());
  }
  assert.ok(pass<=23);
});

test("the actual worker rechecks hinted raw bytes/Core membership before committing, defers confirmation, and rolls back replacement",async()=>{
  const epoch=1793725368;
  for(const outcome of ["pending","confirmed-before-write","confirmed-before-commit","evicted-before-commit","absent"]) {
    const tx=historicalMail(), core={...tx,confirmations:1,blockhash:"0".repeat(58)+"abc123"};
    let reads=0, checks=0, indexAttempts=0;
    let state;
    const stmts=[];
    const mempool=outcome==="absent"?{}:{[MAIL_TXID]:{time:epoch}};
    const bitcoinRpc=async(method)=> {
      if(method==="getrawmempool")return mempool;
      assert.equal(method,"getmempoolentry");checks++;
      if(outcome==="evicted-before-commit" && checks===2)throw Error("not in mempool");
      return {time:epoch};
    };
    const verifyHintedMempoolTransaction=fromWorker("verifyHintedMempoolTransaction",{bitcoin,bitcoinRpc});
    const call=fromWorker("backfillMempoolScanSource",{
      NETWORK:"livenet",BITCOIN_RPC_URL:"http://127.0.0.1:8332",MEMPOOL_REVERIFY_ID_TXIDS:[],
      WORK_AMO_V8_DECLARATION_PINS_CONFIGURED:false,MEMPOOL_SCAN_MAX_TXIDS:500,MEMPOOL_SCAN_SEEN_LIMIT:10000,
      MEMPOOL_SCAN_MAX_PROTOCOL_TXIDS:250,MEMPOOL_SCAN_BUDGET_MS:540000,PENDING_ONLY_BACKFILL:false,
      canonicalMempoolTxidSnapshot:v=>v,reconcilePowcatPending:async()=>{},pendingIdReverificationTargets:async()=>new Map(),
      mempoolScanState:async()=>({...seen(),key:"mempoolScan:livenet"}),isHexTxid,compareCanonicalUtf8:cmp,
      knownMempoolRecoveryTxids:async()=>[],pendingDiscoverySeen,planPendingDiscovery,finishPendingDiscovery,
      readPendingBroadcastHints:async()=>[MAIL_TXID],plannedMempoolScanCandidates:legacyPlan,
      mempoolScanTimeBudgetReached:()=>false,mempoolScanCursorForEntry:([id,meta])=>({time:meta.time,txid:id}),bitcoinRpc,
      freshRawTransactionFromCore:async()=> {
        reads++;
        return outcome==="confirmed-before-write" && reads===2 || outcome==="confirmed-before-commit" && reads===3 ? core:tx;
      },
      transactionHasConfirmedBlockEvidence:raw=>raw.confirmations>0,verifyHintedMempoolTransaction,protocolMessagesFromTx:messagesFromRaw,
      pendingWorkMintAttemptCount:()=>0,storePendingWorkMintAttemptPreinspection:async()=>0,pendingCoreMarketplaceVerifierNeeded:()=>false,
      transactionWithInputPrevouts:async v=>v,preparedProtocolItemsForTx:async(raw,messages)=>{
        assert.equal(raw.txid,MAIL_TXID);assert.equal(messages.length,1);assert.equal(messages[0].text,"pwm1:m:rf");
        return [{item:{txid:MAIL_TXID,protocol:"pwm1",kind:"mail",protocolVout:11,recordOrdinal:0,valid:true}}];},
      pendingWorkMintDecision:()=>null,pendingWorkMintVerifierResolved:()=>false,pendingTransactionWriteItem:items=>items[0].item,
      upsertTransaction:async()=>{},lockedCanonicalTransactionForMempool:async()=>false,storePendingWorkMintInspection:async()=>{},
      reconcilePendingWorkMintDecision:async()=>({persistInvalid:false}),persistPreparedProtocolItems:async(_c,items)=>{
        assert.equal(items.length,1);indexAttempts++;return {indexed:1,skipped:0};},
      storeMempoolScanState:async(...args)=>{state=args[5];return true;},
      console:{error(){}},
    });
    const r=await call({query:async sql=>{stmts.push(sql.trim());return {rows:[]};}},{label:"mempool-scan"});
    assert.ok(state);
    assert.equal(r.indexed,outcome==="pending"?1:0,outcome);
    assert.equal(stmts.includes("COMMIT"),outcome==="pending",outcome);
    assert.equal(r.canonicalDeferred,outcome.startsWith("confirmed-")?1:0);
    if(outcome==="absent"){assert.equal(reads,0);assert.equal(indexAttempts,0);}
    if(outcome==="evicted-before-commit"){assert.ok(stmts.includes("ROLLBACK"));assert.equal(state.settledHints.length,0);}
  }
});


test("the actual bounded HTTP hint reader rejects a redirect without following it", async () => {
  let hintRequests = 0, redirects = 0;
  const server = createServer((req, res) => {
    if (req.url.startsWith("/api/v1/internal/pending-discovery-hints?")) {
      hintRequests++; assert.equal(req.headers["x-pow-internal-verifier"], "t".repeat(32));
      res.writeHead(302, {location:"/must-not-follow"}); res.end();
    } else { redirects++; res.end("{}"); }
  });
  await new Promise(resolve=>server.listen(0,"127.0.0.1",resolve));
  try {
    const bounded = fromWorker("readCanonicalSummaryJsonViaLoopbackHttp",{httpRequest});
    const read = fromWorker("readPendingBroadcastHints",{ NETWORK:"livenet", INTERNAL_VERIFIER_TOKEN:"t".repeat(32),
      API_BASE:"http://127.0.0.1:"+server.address().port,readCanonicalSummaryJsonViaLoopbackHttp:bounded,acceptedHintTxids });
    assert.deepEqual(plain(await read()),[]);assert.equal(hintRequests,1);assert.equal(redirects,0);
  } finally { await new Promise(resolve=>server.close(resolve)); }
});

test("cursor persistence cannot overwrite a concurrent scan or resurrect a marker removed by replay", async () => {
  const save=fromWorker("storeMempoolScanState",{normalizedMempoolScanCursor:anchor});
  let row=null,version=0;
  const client={query:async(sql,[key,raw,expected])=>{
    assert.equal(key,"mempoolScan:livenet");
    if (sql.startsWith("INSERT")) {
      assert.match(sql,/ON CONFLICT \(key\) DO NOTHING/u);
      if (row) return {rowCount:0};
    } else {
      assert.match(sql,/WHERE key = \$1 AND xmin::text = \$3/u);
      if (!row || row.version!==expected) return {rowCount:0};
    }
    row={version:String(++version),payload:JSON.parse(raw)};
    return {rowCount:1};
  }};
  const write=(v,idValue)=>save(client,"mempoolScan:livenet",[id(idValue)],null,null,{model:"pending-arrival-discovery-v1"},v);
  assert.equal(await write(null,1),true);
  assert.equal(await write(null,2),false);
  assert.equal(await write("1",3),true);
  assert.equal(await write("1",4),false);
  assert.deepEqual(row.payload.processedTxids,[id(3)]);
  row=null;
  assert.equal(await write("2",5),false);
  assert.equal(row,null);
});
