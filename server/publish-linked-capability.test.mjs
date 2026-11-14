import assert from "node:assert/strict";
import test from "node:test";
import {publishLinkedWriterCapability,recordPublishLinkedCapability,publishLinkedSourceIdentity,
  PUBLISH_LINKED_INDEXER_MODEL} from "./publish-linked.mjs";
const hash="a".repeat(64);
function ready(){
 const source={indexer:"b".repeat(64),reader:"c".repeat(64)};
 return {network:"livenet",fresh:true,enabled:true,nowMs:1_800_000_000_000,source,sourceUnchanged:true,
  marker:{model:PUBLISH_LINKED_INDEXER_MODEL,version:2,network:"livenet",checkpoint:{height:5,hash},sourceIdentity:{reader:source.reader,indexer:source.indexer}},
  health:{ready:true,checks:{index:{ok:true,indexedThroughBlock:5,checkpointHash:hash},
    node:{chain:"main",tipHeight:5,bestBlockHash:hash,txindexHeight:5}}}};
}
test("writer capability binds exact fresh paired source and canonical checkpoint, with JSONB key order independence",()=>{
 const result=publishLinkedWriterCapability(ready());
 assert.equal(result.enabled,true);assert.equal(result.model,"publish-linked-capability-v2");
 assert.deepEqual(result.checkpoint,{height:5,hash});assert.equal(result.serverTime,new Date(1_800_000_000_000).toISOString());
});
test("old API/indexer, disabled writer, rollback, stale source, reorg and unavailable txindex fail closed",()=>{
 for(const change of [
  o=>{o.enabled=false},o=>{o.fresh=false},o=>{o.network="testnet"},o=>{o.sourceUnchanged=false},
  o=>{o.marker=null},o=>{o.marker.model="old"},o=>{o.marker.version=1},o=>{o.marker.sourceIdentity.indexer="d".repeat(64)},
  o=>{o.marker.checkpoint.height=4},o=>{o.health.ready=false},o=>{o.health.checks.index.ok=false},
  o=>{o.health.checks.index.checkpointHash="d".repeat(64)},o=>{o.health.checks.node.chain="regtest"},
  o=>{o.health.checks.node.txindexHeight=4},o=>{delete o.health.checks.node.txindexHeight}
 ]){const value=ready();change(value);const result=publishLinkedWriterCapability(value);assert.equal(result.enabled,false);assert.ok(result.reason);}
});
test("operational marker is reconstructible metadata only, not ledger or historical event mutation",async()=>{
 const calls=[];
 await recordPublishLinkedCapability({query:async(...args)=>calls.push(args)},{network:"livenet",height:5,blockHash:hash});
 assert.equal(calls.length,1);assert.match(calls[0][0],/INSERT INTO proof_indexer\.meta/u);
 assert.doesNotMatch(calls[0][0],/events|ledger|balances/u);
 const marker=JSON.parse(calls[0][1][1]);assert.deepEqual(marker.sourceIdentity,publishLinkedSourceIdentity());
 assert.equal("enabled" in marker,false,"writer runtime switch is never a consensus field");
});

import {mkdtempSync,mkdirSync,writeFileSync,rmSync,symlinkSync} from "node:fs";
import {tmpdir} from "node:os";
import {join,dirname} from "node:path";
import {linkedSourceClosure,LINKED_SOURCE_FILES} from "./publish-linked-source.mjs";
test("runtime closure binds every relevant consumer, future Search modules and schemas, not import spelling",()=>{
 const root=mkdtempSync(join(tmpdir(),"linked-source-test-"));
 try {
  const paths=[...LINKED_SOURCE_FILES,"server/canonical-op-return.mjs","server/boost-growth.mjs",
   "server/db/boost-growth-reader.mjs","server/search-projection.mjs","server/db/search-reader.mjs",
   "server/sql/proof-search-v1.sql","src/shared/protocol/powcat1.mjs","src/shared/protocol/powcatMail.mjs"];
  for(const path of paths){mkdirSync(dirname(join(root,path)),{recursive:true});writeFileSync(join(root,path),path);}
  const initial=linkedSourceClosure(root),value=ready();value.source=initial;value.marker.sourceIdentity={...initial};
  assert.equal(publishLinkedWriterCapability(value).enabled,true);
  for(const path of paths){writeFileSync(join(root,path),path+" changed");value.source=linkedSourceClosure(root);
   assert.equal(publishLinkedWriterCapability(value).enabled,false,path);writeFileSync(join(root,path),path);}
  writeFileSync(join(root,"server/search-linked-content.mjs"),"new consumer");
  assert.notDeepEqual(linkedSourceClosure(root),initial);rmSync(join(root,"server/search-linked-content.mjs"));
  assert.deepEqual(linkedSourceClosure(root),initial);
  symlinkSync(join(root,"package.json"),join(root,"server/escaped.mjs"));assert.throws(()=>linkedSourceClosure(root),/symlink/u);
  rmSync(join(root,"server/escaped.mjs"));rmSync(join(root,"package-lock.json"));assert.throws(()=>linkedSourceClosure(root),/ENOENT/u);
 } finally {rmSync(root,{recursive:true,force:true});}
});

import {lstatSync,readdirSync,readFileSync,renameSync} from "node:fs";
import {linkedSourceClosureAsync,createBoundedCapabilityProbe} from "./publish-linked-source.mjs";
function sourceFixture(){
 const root=mkdtempSync(join(tmpdir(),"linked-race-test-"));
 for(const path of [...LINKED_SOURCE_FILES,"server/consumer.mjs","src/shared/value.mjs"]){mkdirSync(dirname(join(root,path)),{recursive:true});writeFileSync(join(root,path),"aaaa");}
 return root;
}
test("source scan rejects equal-size edits, inode replacement and directory additions during reads",()=>{
 for(const mutate of [
  (root,path)=>writeFileSync(path,"bbbb"),
  (root,path)=>{writeFileSync(path+".new","aaaa");renameSync(path+".new",path);},
  root=>writeFileSync(join(root,"server/new-module.mjs"),"new")
 ]){
  const root=sourceFixture();let fired=false;
  try {assert.throws(()=>linkedSourceClosure(root,{stat:path=>lstatSync(path,{bigint:true}),names:readdirSync,
   read:path=>{const value=readFileSync(path);if(!fired && path.endsWith("consumer.mjs")){fired=true;mutate(root,path);}return value;}}),/changed/u);}
  finally{rmSync(root,{recursive:true,force:true});}
 }
});
test("async source scan agrees and rejects a symlinked root or ancestor",async()=>{
 const root=sourceFixture(),alias=root+"-alias";
 try{assert.deepEqual(await linkedSourceClosureAsync(root),linkedSourceClosure(root));
  symlinkSync(root,alias);assert.throws(()=>linkedSourceClosure(alias),/symlink/u);
  await assert.rejects(linkedSourceClosureAsync(alias),/symlink/u);
 }finally{rmSync(alias,{force:true});rmSync(root,{recursive:true,force:true});}
});
test("concurrent readiness requests share one fresh probe with finite waiters, no completed answer cache",async()=>{
 let calls=0,release;const probe=createBoundedCapabilityProbe(()=>{calls++;return new Promise(resolve=>release=resolve);},{minIntervalMs:1});
 const pending=Array.from({length:100},()=>probe());const observed=Promise.allSettled(pending);
 await new Promise(resolve=>setTimeout(resolve,2));assert.equal(calls,1);release({enabled:true});
 const result=await observed;assert.equal(result.filter(x=>x.status==="fulfilled").length,16);assert.equal(result.filter(x=>x.status==="rejected").length,84);
 const next=probe();await Promise.resolve();assert.equal(calls,2);release({enabled:false});assert.deepEqual(await next,{enabled:false});
});
test("timeout retains occupied work and never reuses enabled readiness",async()=>{
 let calls=0,release;
 const probe=createBoundedCapabilityProbe(()=>{calls++;return new Promise(resolve=>release=resolve);},{timeoutMs:5,minIntervalMs:1000});
 await assert.rejects(probe(),/timed out/u);await assert.rejects(probe(),/timed out/u);assert.equal(calls,1);
 release({enabled:true});await new Promise(resolve=>setTimeout(resolve,1));assert.equal(calls,1);
});

test("permanently hanging probe has a finite deadline and retains its only work slot",async()=>{
 let calls=0;const probe=createBoundedCapabilityProbe(()=>{calls++;return new Promise(()=>{});},{timeoutMs:5,minIntervalMs:1});
 const results=await Promise.allSettled(Array.from({length:100},()=>probe()));assert.ok(results.every(x=>x.status==="rejected"));
 await new Promise(resolve=>setTimeout(resolve,2));await assert.rejects(probe(),/timed out/u);assert.equal(calls,1);
});
test("source edit during health/chain work cannot reuse an earlier enabled fingerprint",async()=>{
 const root=sourceFixture();let healthDone;
 try {
  const initial=linkedSourceClosure(root),probe=createBoundedCapabilityProbe(async()=>{
   await new Promise(resolve=>healthDone=resolve);
   const source=await linkedSourceClosureAsync(root),value=ready();value.source=source;value.marker.sourceIdentity=initial;
   return publishLinkedWriterCapability(value);
  });
  const pending=probe();await Promise.resolve();writeFileSync(join(root,"server/consumer.mjs"),"bbbb");healthDone();
  assert.equal((await pending).enabled,false);
 }finally{rmSync(root,{recursive:true,force:true});}
});

import {assertLinkedPublishCapability} from "../src/shared/protocol/publishLinkedCapability.mjs";
test("fast upload/sign/broadcast cadence waits for fresh slots instead of false unavailability",async()=>{
 const starts=[],actions=[];let changed=false;
 const endpoint=createBoundedCapabilityProbe(async()=>{
  starts.push(Date.now());const value=ready();value.nowMs=Date.now();value.sourceUnchanged=!changed;
  return publishLinkedWriterCapability(value);
 },{minIntervalMs:20});
 // Exactly the UI capability validator is called immediately before every step.
 for(const action of ["upload","prepare","sign","broadcast"]){
  assertLinkedPublishCapability(await endpoint(),"livenet");actions.push(action);
 }
 assert.deepEqual(actions,["upload","prepare","sign","broadcast"]);
 assert.equal(starts.length,4);for(let i=1;i<starts.length;i++)assert.ok(starts[i]-starts[i-1]>=19);
 // A signed transaction receipt already exists. A later source drift must stop
 // broadcast without erasing that receipt or trusting the previous enabled read.
 const receipt={signedTransactionHex:"retained-by-existing-recovery-flow"};changed=true;
 const disabled=await endpoint();assert.equal(disabled.enabled,false);
 assert.throws(()=>assertLinkedPublishCapability(disabled,"livenet"));
 assert.equal(receipt.signedTransactionHex,"retained-by-existing-recovery-flow");
});

import {createServer} from "node:http";
import {createLinkedWriterCapabilityEndpoint} from "./publish-linked.mjs";
test("actual endpoint adapter supports rapid HTTP wallet phases and preserves a signed receipt on drift",async()=>{
 const source={model:"fixture",sha256:"a".repeat(64)},starts=[];let changed=false;
 const value=ready();value.marker.sourceIdentity=source;
 const endpoint=createLinkedWriterCapabilityEndpoint({readSearch:async checkpoint=>readySearch(checkpoint),searchContract,readMarker:async()=>{starts.push(Date.now());return value.marker;},readHealth:async()=>value.health,
  blockHashAtHeight:async()=>hash,enabled:()=>true,loadedSource:()=>source,
  // Measure probe entry, not the source fence after variable awaited work.
  readSource:async()=>changed?{...source,sha256:"b".repeat(64)}:source});
 const server=createServer(async(request,response)=>{
  const url=new URL(request.url,"http://localhost");
  assert.equal(url.pathname,"/api/v1/boost");assert.equal(url.searchParams.get("capabilities"),"linked-articles-v2");
  const result=await endpoint({network:"livenet",fresh:url.searchParams.get("fresh")==="1"});
  response.setHeader("Content-Type","application/json");response.setHeader("Cache-Control","no-store");response.end(JSON.stringify(result));
 });
 await new Promise(resolve=>server.listen(0,"127.0.0.1",resolve));
 const url=`http://127.0.0.1:${server.address().port}/api/v1/boost?capabilities=linked-articles-v2&fresh=1`;
 const actions=[],receipt={};
 try {
  for(const action of ["upload","prepare","sign"]){const response=await fetch(url);assert.equal(response.headers.get("cache-control"),"no-store");assertLinkedPublishCapability(await response.json(),"livenet");actions.push(action);if(action==="sign")receipt.hex="signed-and-preserved";}
  changed=true;const response=await fetch(url);
  const disabled=await response.json();assert.equal(disabled.enabled,false);assert.throws(()=>assertLinkedPublishCapability(disabled,"livenet"));
  assert.deepEqual(actions,["upload","prepare","sign"]);assert.equal(receipt.hex,"signed-and-preserved");assert.equal(starts.length,4);for(let i=1;i<starts.length;i++)assert.ok(starts[i]-starts[i-1]>=999);
 }finally{await new Promise(resolve=>server.close(resolve));}
});

test("scheduler spacing binds probe entry, not a late source fence after variable health latency",async(t)=>{
 t.mock.timers.enable({apis:["Date","setTimeout"],now:1_800_000_000_000});
 const starts=[],fences=[],source={model:"fixture",sha256:"a".repeat(64)},value=ready();
 value.marker.sourceIdentity=source;
 let releaseHealth,changed=false;
 const flush=async()=>{for(let i=0;i<12;i++)await Promise.resolve();};
 const endpoint=createLinkedWriterCapabilityEndpoint({searchContract,enabled:()=>true,loadedSource:()=>source,
  readMarker:async()=>{starts.push(Date.now());return value.marker;},
  readHealth:async()=>{if(starts.length===1)await new Promise(resolve=>releaseHealth=resolve);return value.health;},
  readSearch:async checkpoint=>readySearch(checkpoint),blockHashAtHeight:async()=>hash,
  readSource:async()=>{fences.push(Date.now());return changed?{...source,sha256:"b".repeat(64)}:source;}});
 const first=endpoint({network:"livenet",fresh:true});await flush();assert.equal(starts.length,1);
 t.mock.timers.tick(250);releaseHealth();assert.equal((await first).enabled,true);
 const second=endpoint({network:"livenet",fresh:true});await flush();
 t.mock.timers.tick(749);await flush();assert.equal(starts.length,1,"must not start before the full production interval");
 t.mock.timers.tick(1);assert.equal((await second).enabled,true);
 assert.equal(starts[1]-starts[0],1000,"actual probe starts retain the full production interval");
 assert.equal(fences[1]-fences[0],750,"late source observations are not scheduler start times");
 const receipt={hex:"signed-and-preserved"};changed=true;
 const third=endpoint({network:"livenet",fresh:true});await flush();t.mock.timers.tick(999);await flush();
 assert.equal(starts.length,2,"source drift does not bypass scheduler admission");
 t.mock.timers.tick(1);const disabled=await third;assert.equal(disabled.enabled,false);
 assert.throws(()=>assertLinkedPublishCapability(disabled,"livenet"));assert.equal(receipt.hex,"signed-and-preserved");
 assert.equal(starts[2]-starts[1],1000);
});

const searchContract={model:"linked-publish-content-search-v1",indexVersion:"proof-search-v6-linked-publish-content"};
function readySearch(checkpoint){return {...searchContract,ready:true,fullBodySearch:true,checkpoint,
 parserIdentity:"c".repeat(64),storage:{model:searchContract.model,retainedBytes:100,maxRetainedBytes:10000,
 physicalBytes:200,maxPhysicalBytes:20000,minFreeBytes:1000,freeBytes:"100000"}};}
test("writer requires freshly qualified complete Search, not its version flag",async()=>{
 const value=ready(),source=value.source,order=[];
 const baseline={readMarker:async()=>value.marker,readHealth:async()=>{order.push("health");return value.health;},
  blockHashAtHeight:async()=>{order.push("chain");return hash;},enabled:()=>true,loadedSource:()=>source,
  readSource:async()=>{order.push("source");return source;},searchContract,
  readSearch:async checkpoint=>{order.push("search");return readySearch(checkpoint);}};
 assert.equal((await createLinkedWriterCapabilityEndpoint(baseline)({network:"livenet",fresh:true})).enabled,true);
 assert.deepEqual(order,["health","search","chain","source"]);
 for(const change of [
  x=>{x.ready=false},x=>{x.fullBodySearch=false},x=>{x.model="old"},x=>{x.indexVersion="old"},
  x=>{x.checkpoint={height:4,hash}},x=>{x.checkpoint={height:5,hash:"b".repeat(64)}},
  x=>{x.parserIdentity=null},x=>{x.storage=null},x=>{x.storage.retainedBytes=x.storage.maxRetainedBytes},
  x=>{x.storage.physicalBytes=x.storage.maxPhysicalBytes},x=>{x.storage.freeBytes="0"}
 ]){
  const result=await createLinkedWriterCapabilityEndpoint({...baseline,readSearch:async checkpoint=>{const search=readySearch(checkpoint);change(search);return search;}})({network:"livenet",fresh:true});
  assert.equal(result.enabled,false);
 }
 // These are failure receipts thrown by the actual Search helper. The adapter
 // cannot turn an incomplete native proof into writer authority.
 for(const code of ["SEARCH_UNAVAILABLE","SEARCH_LINKED_NOT_CURRENT","SEARCH_LINKED_COVERAGE_CHANGED",
  "SEARCH_LINKED_CAPACITY","SEARCH_LINKED_PHYSICAL_CAPACITY","SEARCH_CHECKPOINT_CHANGED","SEARCH_PARSER_CHANGED","SEARCH_COVERAGE_CHANGED"]){
  const result=await createLinkedWriterCapabilityEndpoint({...baseline,readSearch:async()=>{throw Object.assign(new Error(code),{code});}})({network:"livenet",fresh:true});assert.equal(result.enabled,false,code);
 }
 assert.equal((await createLinkedWriterCapabilityEndpoint({...baseline,readSearch:undefined})({network:"livenet",fresh:true})).enabled,false);
 assert.equal((await createLinkedWriterCapabilityEndpoint({...baseline,blockHashAtHeight:async()=>"b".repeat(64)})({network:"livenet",fresh:true})).enabled,false);
});

test("100 callers coalesce the entire readiness evaluation including Search and Core",async(t)=>{
 const counts={marker:0,health:0,search:0,core:0,source:0};let release;
 const value=ready(),source=value.source;
 const endpoint=createLinkedWriterCapabilityEndpoint({searchContract,enabled:()=>true,loadedSource:()=>source,
  readMarker:async()=>{counts.marker++;return value.marker;},readHealth:async()=>{counts.health++;await new Promise(resolve=>release=resolve);return value.health;},
  readSearch:async checkpoint=>{counts.search++;return readySearch(checkpoint);},
  blockHashAtHeight:async()=>{counts.core++;return hash;},readSource:async()=>{counts.source++;return source;}});
 const pending=Array.from({length:100},()=>endpoint({network:"livenet",fresh:true}));
 await Promise.resolve();await Promise.resolve();assert.equal(counts.health,1);release();
 const results=await Promise.all(pending);assert.equal(results.filter(x=>x.enabled).length,16);
 assert.deepEqual(counts,{marker:1,health:1,search:1,core:1,source:1});t.diagnostic(JSON.stringify({requests:100,enabled:16,disabled:84,calls:counts}));
});
test("Search outage bounds100 full endpoint callers at the production five-second deadline",async(t)=>{
 const counts={marker:0,health:0,search:0,core:0,source:0},value=ready(),source=value.source;
 const endpoint=createLinkedWriterCapabilityEndpoint({searchContract,enabled:()=>true,loadedSource:()=>source,
  readMarker:async()=>{counts.marker++;return value.marker;},readHealth:async()=>{counts.health++;return value.health;},
  readSearch:async()=>{counts.search++;return new Promise(()=>{});},
  blockHashAtHeight:async()=>{counts.core++;return hash;},readSource:async()=>{counts.source++;return source;}});
 const start=Date.now();const results=await Promise.all(Array.from({length:100},()=>endpoint({network:"livenet",fresh:true})));
 const elapsed=Date.now()-start;assert.ok(elapsed>=4900&&elapsed<6000,`elapsed ${elapsed}ms`);assert.ok(results.every(x=>!x.enabled));
 assert.deepEqual(counts,{marker:1,health:1,search:1,core:0,source:0});t.diagnostic(JSON.stringify({requests:100,enabled:0,elapsedMs:elapsed,calls:counts}));
 assert.equal((await endpoint({network:"livenet",fresh:true})).enabled,false);assert.equal(counts.search,1);
});

test("operator preactivation proves identical readiness while public capability stays disabled",async()=>{
 const value=ready(),source=value.source;let writes=false,calls=0;
 const endpoint=createLinkedWriterCapabilityEndpoint({searchContract,enabled:()=>writes,loadedSource:()=>source,
  readMarker:async()=>{calls++;return value.marker;},readHealth:async()=>value.health,
  readSearch:async checkpoint=>readySearch(checkpoint),blockHashAtHeight:async()=>hash,readSource:async()=>source});
 assert.equal((await endpoint({network:"livenet",fresh:true})).enabled,false);assert.equal(calls,0);
 const receipt=await endpoint.preactivation({network:"livenet",fresh:true});
 assert.equal(receipt.model,"publish-linked-preactivation-v1");assert.equal(receipt.ready,true);
 assert.equal(receipt.enabled,false);assert.equal(receipt.writesEnabled,false);assert.equal(calls,1);
 assert.equal(receipt.search.fullBodySearch,true);assert.deepEqual(receipt.sourceIdentity,source);
 assert.ok(receipt.elapsedMs>=0);assert.throws(()=>assertLinkedPublishCapability(receipt,"livenet"));
 assert.equal((await endpoint({network:"livenet",fresh:true})).enabled,false);assert.equal(calls,1);
 writes=true;const refusal=await endpoint.preactivation({network:"livenet",fresh:true});
 assert.equal(refusal.ready,false);assert.equal(refusal.writesEnabled,true);assert.equal(calls,1);
});
test("operator preactivation fails closed for missing evidence, bad network, source changes and switch races",async()=>{
 const value=ready(),source=value.source;
 const baseline={searchContract,enabled:()=>false,loadedSource:()=>source,readMarker:async()=>value.marker,
  readHealth:async()=>value.health,readSearch:async checkpoint=>readySearch(checkpoint),
  blockHashAtHeight:async()=>hash,readSource:async()=>source,probeOptions:{timeoutMs:20,minIntervalMs:1}};
 for(const options of [
  {readSearch:async()=>null},{readSource:async()=>({...source,indexer:"d".repeat(64)})},
  {readMarker:async()=>null},{blockHashAtHeight:async()=>"d".repeat(64)},
  {readSearch:async()=>new Promise(()=>{})}
 ]) {const result=await createLinkedWriterCapabilityEndpoint({...baseline,...options}).preactivation({network:"livenet",fresh:true});
  assert.equal(result.ready,false);assert.equal(result.enabled,false);}
 for(const request of [{network:"testnet",fresh:true},{network:"livenet",fresh:false}]) {
  const result=await createLinkedWriterCapabilityEndpoint({...baseline,readMarker:async()=>assert.fail("no probe")}).preactivation(request);
  assert.equal(result.ready,false);
 }
 let writes=false;
 const raced=createLinkedWriterCapabilityEndpoint({...baseline,enabled:()=>writes,readSource:async()=>{writes=true;return source;}});
 const result=await raced.preactivation({network:"livenet",fresh:true});
 assert.equal(result.ready,false);assert.equal(result.enabled,false);assert.equal(result.writesEnabled,true);
});


test("unrelated ancestor churn is allowed but ancestor identity and source changes fail closed",async()=>{
  const root=sourceFixture(),ancestor=dirname(root);
  try {
    const initial=linkedSourceClosure(root);
    for(const asyncMode of [false,true])for(const targetPath of [ancestor,root,join(root,"server")])
    for(const field of ["mtimeNs","ctimeNs","size","ino","mode","uid","gid","symlink","type"]) {
      let seen=0;
      const operations={
        stat:path=>{
          const actual=lstatSync(path,{bigint:true});
          if(path!==targetPath || ++seen===1)return actual;
          return new Proxy(actual,{get(target,key){
            if(field==="symlink" && key==="isSymbolicLink")return ()=>true;
            if(field==="type" && key==="mode")return target.mode ^ 0o040000n;
            if(key===field)return target[key]+1n;
            const value=target[key];return typeof value==="function"?value.bind(target):value;
          }});
        },
        names:readdirSync,read:readFileSync,
      };
      const benign=targetPath===ancestor && ["mtimeNs","ctimeNs","size"].includes(field);
      // Ownership was not part of the original in-tree identity contract.
      if(targetPath!==ancestor && ["uid","gid"].includes(field))continue;
      if(asyncMode) {
        if(benign)assert.deepEqual(await linkedSourceClosureAsync(root,operations),initial,field);
        else await assert.rejects(()=>linkedSourceClosureAsync(root,operations),/changed|symlink/u,field);
      } else {
        if(benign)assert.deepEqual(linkedSourceClosure(root,operations),initial,field);
        else assert.throws(()=>linkedSourceClosure(root,operations),/changed|symlink/u,field);
      }
    }
  } finally {rmSync(root,{recursive:true,force:true});}
});
