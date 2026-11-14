// Isolated synthetic transport/identity harness. Never performs a live status.
import test from "node:test";
import assert from "node:assert/strict";
import childProcess from "node:child_process";
import {registerHooks,syncBuiltinESMExports} from "node:module";
import {fileURLToPath} from "node:url";
import {performance} from "node:perf_hooks";
const repository=fileURLToPath(new URL("../",import.meta.url)).replace(/\/$/u,"");
const retirementURL=new URL("./retirement-evidence.mjs",import.meta.url).href;
const identityURL=new URL("./release-identity-proof.mjs",import.meta.url).href;
const brands=new WeakSet();
const fixed={repository,artifact:{commit:"064b6991ae2a48e2069baedc767cd918d28ba052",tree:"a".repeat(40)},operator:{commit:"b".repeat(40),tree:"c".repeat(40)},digests:{source:"d".repeat(64)}};
const frozen=v=>{if(v&&typeof v==="object"){Object.values(v).forEach(frozen);Object.freeze(v);}return v;};
let source=fixed;
function proof() {const value=frozen({...structuredClone(fixed),verifiedAt:new Date().toISOString()});brands.add(value);return value;}
globalThis.__stockWitnessTest={
 require:p=>{assert(brands.has(p),"test identity brand");return p;},
 create:()=>{const p=frozen({...structuredClone(source),verifiedAt:new Date().toISOString()});brands.add(p);return p;},
 public:p=>{assert(brands.has(p));return structuredClone(p);},
};
const hook=registerHooks({load(url,context,next){
 if(url===identityURL)return {format:"module",shortCircuit:true,source:"export const requireIdentityProof=p=>globalThis.__stockWitnessTest.require(p); export const createIdentityProof=()=>globalThis.__stockWitnessTest.create(); export const publicIdentityProof=p=>globalThis.__stockWitnessTest.public(p);"};
 if(url===retirementURL)return {format:"module",shortCircuit:true,source:"export const attestInstalledRetentionPackage=p=>globalThis.__stockRetentionTest.attest(p); export const bindInstalledRetentionPackage=(s,a)=>globalThis.__stockRetentionTest.bind(s,a); export const collectRetirementEvidence=s=>globalThis.__stockRetentionTest.collect(s); export const validateRetainedHolds=(s,b)=>globalThis.__stockRetentionTest.validate(s,b);"};
 return next(url,context);
}});
const realExec=childProcess.execFileSync;
const realFetch=globalThis.fetch;
let statusCalls=0,finalMutation,failStatus=false,standalone=false;
let events=[],retired=false,missingEvidence=false,badProof=false,attestationFailure=false,bindFailure=false,packageVersion="original";
globalThis.__stockRetentionTest={
 attest:p=>{assert(brands.has(p));events.push("attest");if(attestationFailure)throw Error("untrusted installed package");return {mode:retired?"operator-retirement-package":"legacy-in-place",configSha256:"1".repeat(64),version:packageVersion};},
 bind:(s,a)=>{events.push("bind");if(bindFailure)throw Error("package lifecycle mismatch");assert.equal(s.configSha256,a.configSha256);},
 collect:s=>{events.push("retirement-read");assert(s.verifiedRetiredPayloads);if(missingEvidence)throw Error("missing terminal evidence");return {synthetic:true,receipt:s.verifiedRetiredPayloads.receiptSha256};},
 validate:(s,b)=>{events.push("validate-holds");
  if(s.verifiedRetiredPayloads){assert.equal(s.verifiedRetiredPayloads.model,"intentionally-retired-payloads-retained-evidence-v1");assert.equal(s.verifiedPreservedRelease1042,null);assert.equal(s.verifiedPreservedFallback,null);assert.deepEqual(b,{synthetic:true,receipt:s.verifiedRetiredPayloads.receiptSha256});}
  else{assert.equal(s.verifiedPreservedRelease1042.releaseId,"1042efea2aa1-20261112T074918Z");assert.equal(s.verifiedPreservedFallback.releaseId,"c3969c39c2b2-20261101T051206Z");assert.equal(b,undefined);}
 }
};
function status() {
 const pair={current:fixed.artifact.commit.slice(0,12)+"-20261114T020148Z",previous:"e2669bc1fd32-20261112T163804Z"};
 const floor={rootReserveBytes:8*1024**3,growthReserveBytes:64*1024**2,installedSha256:"e".repeat(64)};
 return {ok:true,initialized:true,publicationHealthy:true,retentionComplete:true,pending:null,unfinishedIntents:[],
  pair,configSha256:"1".repeat(64),stateSha256:"2".repeat(64),index:{path:"/index",sha256:"3".repeat(64)},
  context:{pair,manifests:{current:"4".repeat(64)},guards:{heldCensus:[{inode:7}]}},
  binding:{config:{path:"/etc/proofofwork-retention/ui-lifecycle.json",sha256:"1".repeat(64)},state:{path:"/var/lib/proofofwork-ui-retention/state.json",sha256:"2".repeat(64)},pair,capacityFloor:floor,controller:{path:"/installed/controller",sha256:"5".repeat(64)}},
  verifiedPreservedRelease1042:{releaseId:"1042efea2aa1-20261112T074918Z",snapshotSha256:{x:"6".repeat(64)}},
  verifiedPreservedFallback:{releaseId:"c3969c39c2b2-20261101T051206Z"},
  verifiedCapacityFloor:floor,verifiedHistoricalBulkPreservation:{receipt:"7".repeat(64)},verifiedBootLogRotation:{bootId:"original"},
  retentionPolicy:"vps-current-and-one-prior-v1",historicalBulkPreserved:true,offHostCustodyRoot:null};
}
childProcess.execFileSync=(command,args,options)=>{
 if(args.includes("deploy/ui-retention/lifecycle.py")){
  assert.equal(command,standalone?"python3":"/usr/bin/python3");assert.deepEqual(args,["-I","-B","deploy/ui-retention/lifecycle.py","status","--require-complete"]);
  if(!standalone)assert.deepEqual(options.env,{PATH:"/usr/bin:/bin",HOME:"/nonexistent"});assert.equal(options.timeout,480000);
  events.push("status");statusCalls++;if(failStatus)throw new Error("synthetic full status failure");
  const value=status();if(retired){value.verifiedPreservedRelease1042=null;value.verifiedPreservedFallback=null;value.verifiedRetiredPayloads={model:badProof?"fake":"intentionally-retired-payloads-retained-evidence-v1",receiptSha256:"9".repeat(64)};}
  if(finalMutation)finalMutation(value);return JSON.stringify(value);
 }
 if(command==="/usr/bin/git")return standalone?fixed.artifact.commit:fixed.operator.commit;
 if(command==="python3"||command==="/usr/bin/python3")return JSON.stringify(Object.fromEntries(["a","b","c","d","e","f"].map(k=>[k,"0".repeat(64)])));
 if(command==="ssh"||command==="/usr/bin/ssh")return JSON.stringify({runtimeFiles:6,monitorExit:0});
 throw new Error("Unexpected command in isolated fixture: "+command);
};
syncBuiltinESMExports();
const height=1,hash="8".repeat(64),address="1447TsdXtFSnVrWawSamyyQKPDNW4ALtBT",tokenId="d4e5ebf11d104d6a63fb74e42094364b25a5f7199a09e5c0e71408972466a8b8";
globalThis.fetch=async url=>{
 assert.equal(url.origin,"https://computer.proofofwork.me");
 const common={indexedThroughBlock:height,indexedThroughBlockHash:hash};
 const body=url.pathname==="/health"?{ready:true,checks:{node:{tipHeight:height,bestBlockHash:hash}}}:
 url.pathname==="/api/v1/registry-summary"?common:{...common,
 canonicalWorkCapacities:[{...common,model:"canonical-work-wallet-capacity-v1",address,tokenId,confirmedBalanceSubatoms:"10",reservedBalanceSubatoms:"0",transferableBalanceSubatoms:"10",tokenStateCommitment:{sha256:hash}}],
 holders:[{address,tokenId,amountStorageModel:"work-subatoms-v2",balanceSubatoms:"10"}]};
 return new Response(JSON.stringify(body));
};
const witness=await import("./lifecycle-status-witness.mjs");
const activity=await import("./check-activity-fee-factor-live.mjs");
const reset=()=>{statusCalls=0;finalMutation=undefined;failStatus=false;standalone=false;source=fixed;events=[];retired=false;missingEvidence=false;badProof=false;attestationFailure=false;bindFailure=false;packageVersion="original";};
test("two full scans with actual activity in between; no synthetic production qualification",async t=>{
 try {
 await t.test("exactly two hardwired full statuses, middle activity consumes immutable witness",async()=>{
  reset();const p=proof(),pass=witness.beginLifecycleCollection(p);
  assert(Object.isFrozen(pass.status.context.guards));assert.throws(()=>{pass.status.context.guards.changed=true;});
  const activityResult=await activity.runActivityFeeFactorLive({identityProof:p,lifecycleWitness:pass.witness});
  assert.equal(activityResult.ok,true);assert.deepEqual(activityResult.lifecycleEvidence,{mode:"same-collection-before-full-scan",finalIndependentFullScanRequired:true});
  assert.equal(statusCalls,1);witness.finishLifecycleCollection(pass.witness,p);assert.equal(statusCalls,2);
  assert.throws(()=>witness.consumeActivityLifecycle(pass.witness,p));assert.throws(()=>witness.finishLifecycleCollection(pass.witness,p));
 });
 await t.test("retired branch verifies package before each full status and keeps middle activity provisional",async()=>{
  reset();retired=true;const p=proof(),pass=witness.beginLifecycleCollection(p);
  assert.deepEqual(events,["attest","status","bind","retirement-read","validate-holds"]);
  const result=await activity.runActivityFeeFactorLive({identityProof:p,lifecycleWitness:pass.witness});
  assert.equal(statusCalls,1);assert.equal(result.lifecycleEvidence.finalIndependentFullScanRequired,true);
  witness.finishLifecycleCollection(pass.witness,p);
  assert.equal(statusCalls,2);assert.equal(events.filter(x=>x==="attest").length,2);
  assert.deepEqual(events.slice(-5),["attest","status","bind","retirement-read","validate-holds"]);
 });
 await t.test("missing or unknown retirement evidence cannot mint reusable witness",()=>{
  for(const bad of ["missing","unknown"]){reset();retired=true;missingEvidence=bad==="missing";badProof=bad==="unknown";
   assert.throws(()=>witness.beginLifecycleCollection(proof()));assert.equal(statusCalls,1);}
 });
 await t.test("untrusted package refuses before any installed policy execution",()=>{
  reset();attestationFailure=true;assert.throws(()=>witness.beginLifecycleCollection(proof()),/untrusted/);assert.equal(statusCalls,0);
  reset();bindFailure=true;assert.throws(()=>witness.beginLifecycleCollection(proof()),/mismatch/);assert.equal(statusCalls,1);assert(!events.includes("retirement-read"));
 });
 await t.test("final package must match first package even if lifecycle JSON unchanged",()=>{
  reset();const p=proof(),pass=witness.beginLifecycleCollection(p);witness.consumeActivityLifecycle(pass.witness,p);packageVersion="changed";
  assert.throws(()=>witness.finishLifecycleCollection(pass.witness,p),/package changed/);
 });
 await t.test("standalone typed activity still performs own full status",async()=>{
  reset();await activity.runActivityFeeFactorLive({identityProof:proof()});assert.equal(statusCalls,1);
 });
 await t.test("default activity performs own full status",async()=>{
  reset();standalone=true;await activity.runActivityFeeFactorLive();assert.equal(statusCalls,1);
 });
 await t.test("JSON, copied handle, different proof object and different collection refuse",()=>{
  reset();const p=proof(),pass=witness.beginLifecycleCollection(p),other=witness.beginLifecycleCollection(p);
  for(const fake of [{},structuredClone(pass.witness)])assert.throws(()=>witness.consumeActivityLifecycle(fake,p));
  assert.throws(()=>witness.consumeActivityLifecycle(pass.witness,proof()));
  assert.throws(()=>witness.consumeActivityLifecycle(pass.witness,p));assert.throws(()=>witness.finishLifecycleCollection(other.witness,p));
  witness.consumeActivityLifecycle(other.witness,p);witness.finishLifecycleCollection(other.witness,p);
  assert.throws(()=>witness.consumeActivityLifecycle(pass.witness,p));
 });
 await t.test("stale witness and backward wall clock refuse before activity",()=>{
  for(const delta of [900001,-1000]){
   reset();const p=proof(),pass=witness.beginLifecycleCollection(p),realNow=Date.now,now=realNow();
   Date.now=()=>now+delta;try{assert.throws(()=>witness.consumeActivityLifecycle(pass.witness,p),/expired|regressed/);}finally{Date.now=realNow;}
  }
 });
 await t.test("strict stock response parser rejects escaped duplicates, deep nesting and oversize",()=>{
  for(const raw of ['{"ok":true,"\\u006fk":false}','{"nested":{"x":1,"x":2}}','{"x":'+"[".repeat(130)+"0"+"]".repeat(130)+"}"," ".repeat(8*1024**2+1),"[]"])
   assert.throws(()=>witness.parseStockStatus(raw));
 });
 await t.test("final full scan crossing budget refuses after read and cannot retry",()=>{
  reset();const p=proof(),pass=witness.beginLifecycleCollection(p);witness.consumeActivityLifecycle(pass.witness,p);
  const realNow=Date.now,start=realNow();finalMutation=()=>{Date.now=()=>start+900001;};
  try{assert.throws(()=>witness.finishLifecycleCollection(pass.witness,p),/expired/);}finally{Date.now=realNow;}
  assert.equal(statusCalls,2);assert.throws(()=>witness.finishLifecycleCollection(pass.witness,p));
 });
 await t.test("monotonic expiry rejects even with unchanged wall clock",()=>{
  reset();const p=proof(),pass=witness.beginLifecycleCollection(p);
  const old=Object.getOwnPropertyDescriptor(performance,"now"),realNow=performance.now.bind(performance),start=realNow();
  Object.defineProperty(performance,"now",{configurable:true,value:()=>start+900001});
  try{assert.throws(()=>witness.consumeActivityLifecycle(pass.witness,p),/expired/);}
  finally{if(old)Object.defineProperty(performance,"now",old);else delete performance.now;}
 });
 await t.test("source changes burn consumed witness",()=>{
  reset();const p=proof(),pass=witness.beginLifecycleCollection(p);source={...fixed,digests:{source:"f".repeat(64)}};
  assert.throws(()=>witness.consumeActivityLifecycle(pass.witness,p),/source proof changed/);
  source=fixed;assert.throws(()=>witness.consumeActivityLifecycle(pass.witness,p));
 });
 await t.test("final full status failure cannot retry or qualify",()=>{
  reset();const p=proof(),pass=witness.beginLifecycleCollection(p);witness.consumeActivityLifecycle(pass.witness,p);failStatus=true;
  assert.throws(()=>witness.finishLifecycleCollection(pass.witness,p),/full status failure/);
  failStatus=false;assert.throws(()=>witness.finishLifecycleCollection(pass.witness,p));assert.equal(statusCalls,2);
 });
 for(const [name,mutate] of [
  ["config",v=>v.configSha256="a".repeat(64)],["state",v=>v.stateSha256="a".repeat(64)],
  ["index",v=>v.index.sha256="a".repeat(64)],["pair",v=>v.pair.previous="other"],
  ["package/controller",v=>v.binding.controller.sha256="a".repeat(64)],
  ["context manifests",v=>v.context.manifests.current="a".repeat(64)],["guards",v=>v.context.guards.heldCensus[0].inode++],
  ["holds",v=>v.verifiedPreservedRelease1042.snapshotSha256.x="a".repeat(64)],
  ["capacity authority",v=>v.verifiedCapacityFloor.installedSha256="a".repeat(64)],
  ["completion history",v=>v.verifiedHistoricalBulkPreservation.receipt="a".repeat(64)],
  ["boot rotation",v=>v.verifiedBootLogRotation.bootId="other"],["unknown new field",v=>v.newField=true],
  ["not healthy",v=>v.publicationHealthy=false],["pending",v=>v.pending={}],
 ])await t.test("final independent scan rejects changed "+name,()=>{
  reset();const p=proof(),pass=witness.beginLifecycleCollection(p);witness.consumeActivityLifecycle(pass.witness,p);finalMutation=mutate;
  assert.throws(()=>witness.finishLifecycleCollection(pass.witness,p));
 });
 } finally {childProcess.execFileSync=realExec;syncBuiltinESMExports();globalThis.fetch=realFetch;hook.deregister();delete globalThis.__stockWitnessTest;delete globalThis.__stockRetentionTest;}
});
