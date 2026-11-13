import assert from "node:assert/strict";
import test from "node:test";
import {readFileSync} from "node:fs";
import {timingSafeEqual} from "node:crypto";
import {runInNewContext} from "node:vm";
import {publishCheckConfiguration,assertPublishPreactivation,runPublishLinkedLiveCheck} from "./check-publish-linked-live.mjs";
const hash="a".repeat(64),token="private-fixture-token-".repeat(3);
function ready(){
 const checkpoint={height:5,hash},model="linked-publish-content-search-v1";
 return {model:"publish-linked-preactivation-v1",network:"livenet",ready:true,enabled:false,writesEnabled:false,reason:null,
  serverTime:new Date().toISOString(),elapsedMs:10,readerVersion:2,indexerVersion:2,checkpoint,
  sourceIdentity:{model:"publish-linked-source-closure-v1",sha256:hash,files:"100",bytes:"20000"},
  search:{model,indexVersion:"proof-search-v6-linked-publish-content",ready:true,fullBodySearch:true,parserIdentity:hash,checkpoint,
   storage:{model,retainedBytes:0,maxRetainedBytes:8*1024**3,physicalBytes:0,maxPhysicalBytes:12*1024**3,
    minFreeBytes:100*1024**3,freeBytes:String(200*1024**3)}}};
}
test("preactivation credentials never target nonliteral loopback or active public origin",()=>{
 assert.equal(publishCheckConfiguration({}).mode,"active");
 assert.deepEqual(publishCheckConfiguration({POW_INTERNAL_VERIFIER_TOKEN:token}).headers,{});
 for(const origin of ["https://publish.proofofwork.me","http://localhost:8081","http://127.0.0.1:8081/path","http://user@127.0.0.1:8081","http://127.0.0.1:8081/?x=1"])
  assert.throws(()=>publishCheckConfiguration({POW_PUBLISH_CHECK_MODE:"preactivation",POW_PUBLISH_CHECK_ORIGIN:origin,POW_INTERNAL_VERIFIER_TOKEN:token}));
 assert.throws(()=>publishCheckConfiguration({POW_PUBLISH_CHECK_MODE:"preactivation"}));
 assert.equal(publishCheckConfiguration({POW_PUBLISH_CHECK_MODE:"preactivation",POW_INTERNAL_VERIFIER_TOKEN:token}).origin,"http://127.0.0.1:8081");
});
test("preactivation requires actual full evidence, freshness, capacity reserve and disabled writes",()=>{
 assert.equal(assertPublishPreactivation(ready()).ready,true);
 for(const mutate of [
  x=>{x.ready=false},x=>{x.enabled=true},x=>{x.writesEnabled=true},x=>{x.sourceIdentity=null},
  x=>{x.search=null},x=>{x.search.fullBodySearch=false},x=>{x.search.checkpoint={height:4,hash}},
  x=>{x.search.parserIdentity=""},x=>{x.elapsedMs=6000},x=>{x.serverTime=new Date(Date.now()-61000).toISOString()},
  x=>{x.search.storage.retainedBytes=x.search.storage.maxRetainedBytes-1},
  x=>{x.search.storage.physicalBytes=x.search.storage.maxPhysicalBytes-1},
  x=>{x.search.storage.freeBytes=String(x.search.storage.minFreeBytes)}
 ]) {const receipt=ready();mutate(receipt);assert.throws(()=>assertPublishPreactivation(receipt));}
 assert.throws(()=>assertPublishPreactivation({model:"publish-linked-capability-v2",enabled:false}));
});
test("script preactivation measures entire request, keeps token private, and verifies public writer stays off",async()=>{
 const requests=[],env={POW_PUBLISH_CHECK_MODE:"preactivation",POW_INTERNAL_VERIFIER_TOKEN:token};
 const fetchImpl=async(url,options)=>{
  requests.push({url,options});let body;
  if(url.includes("/internal/")) {await new Promise(r=>setTimeout(r,20));body=ready();}
  else if(url.includes("capabilities="))body={model:"publish-linked-capability-v2",network:"livenet",enabled:false};
  else body={complete:true,network:"livenet",items:[]};
  return new Response(JSON.stringify(body),{status:200});
 };
 const result=await runPublishLinkedLiveCheck({env,fetchImpl});
 assert.equal(result.error,undefined);assert.equal(result.newLinkedWriteVerified,false);
 assert.ok(result.checks[0].requestElapsedMs>=20);assert.equal(result.checks[0].probeElapsedMs,10);
 assert.equal(requests[0].options.headers["x-pow-internal-verifier"],token);
 assert.deepEqual(requests[1].options.headers,{});assert.ok(!JSON.stringify(result).includes(token));
 const changed=await runPublishLinkedLiveCheck({env,fetchImpl:async(url)=>new Response(JSON.stringify(
  url.includes("/internal/")?ready():{model:"publish-linked-capability-v2",network:"livenet",enabled:true}))});
 assert.match(changed.error,/remain disabled/);
});
test("active smoke retains active-capability validation and reports no fabricated article proof",async()=>{
 const capability={model:"publish-linked-capability-v2",network:"livenet",enabled:true,readerVersion:2,indexerVersion:2,
  checkpoint:{height:5,hash},serverTime:new Date().toISOString()};
 const result=await runPublishLinkedLiveCheck({env:{},fetchImpl:async url=>new Response(JSON.stringify(
  url.includes("capabilities=")?capability:{complete:true,network:"livenet",items:[]}))});
 assert.equal(result.error,undefined);assert.equal(result.checks.at(-1).pass,null);
 const disabled=await runPublishLinkedLiveCheck({env:{},fetchImpl:async()=>new Response(JSON.stringify({...capability,enabled:false}))});
 assert.ok(disabled.error);
});
test("production diagnostic route retains GET, token, loopback socket and loopback Host guards",()=>{
 const source=readFileSync(new URL("../server/proof-api.mjs",import.meta.url),"utf8");
 const start=source.indexOf("function internalVerifierRequestAllowed(request) {"),end=source.indexOf("\nfunction txidSetSha256",start);
 assert.ok(start>0&&end>start);
 const allowed=runInNewContext("("+source.slice(start,end)+")",{Buffer,timingSafeEqual,INTERNAL_VERIFIER_TOKEN:token});
 const request=(host="127.0.0.1:8081",remoteAddress="127.0.0.1",presented=token)=>({headers:{host,"x-pow-internal-verifier":presented},socket:{remoteAddress}});
 assert.equal(allowed(request()),true);
 assert.equal(allowed(request("publish.proofofwork.me")),false);
 assert.equal(allowed(request("127.0.0.1:8081","203.0.113.1")),false);
 assert.equal(allowed(request("127.0.0.1:8081","127.0.0.1","wrong")),false);
 const route=source.slice(source.indexOf('if (url.pathname === "/api/v1/internal/publish-linked-readiness")'),source.indexOf('if (url.pathname === "/api/v1/internal/pending-discovery-hints")'));
 assert.match(route,/request.method !== "GET" \|\| !internalVerifierRequestAllowed\(request\)/);
 assert.match(route,/endpoint|linkedWriterCapabilityEndpoint\.preactivation/);
 assert.match(route,/"no-store"/);
 assert.doesNotMatch(route,/PUBLISH_LINKED_WRITES_ENABLED\s*=/);
});
