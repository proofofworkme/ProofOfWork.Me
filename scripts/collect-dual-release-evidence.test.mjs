import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {createHash} from "node:crypto";
import {collectDualReleaseEvidence,requireLiveCollection,parseCollectedJson,assembleCollectedEvidence,validateArchivalObservation,validatePrimaryObservation} from "./collect-dual-release-evidence.mjs";
const ids=Object.fromEntries(["artifact","baselineOperator","backend","operator"].map((k,i)=>[k,{commit:String(i).repeat(40),tree:String(i).repeat(40)}]));
const names=["primary","build","uiManifest","sourceProvenance","renderer","runtime","lifecycle","preactivation","activity","growth","nativeV2","browserV2"];
const raw=Object.fromEntries(names.map(n=>[n,"{}"])),times=Object.fromEntries(names.map(n=>[n,"2026-01-01T00:00:00.000Z"]));
test("JSON fake and copied collection never gain live authority",()=>{
 for(const value of [null,{},Object.freeze({rawBundle:"{}",sha256:"0".repeat(64),identities:ids}),JSON.parse('{"rawBundle":"{}"}')])
  assert.throws(()=>requireLiveCollection(value),/Authentic hardwired/);
});
test("unbranded proof refuses before any transport",async()=>{
 await assert.rejects(collectDualReleaseEvidence({proof:{},archivalEvidence:{planSha256:"0".repeat(64)}}),/Authentic in-process/);
});
test("parsers reject malformed, nonobject and oversized responses",()=>{
 for(const value of ["null","[]","false","{",3])assert.throws(()=>parseCollectedJson(value));
 assert.throws(()=>parseCollectedJson('{"a":1}',3),/Oversized/);
 assert.deepEqual(parseCollectedJson('{"a":1}'),{a:1});
});
test("pure assembly is bounded, hashes exact raw bytes and cannot mint brand",()=>{
 const bundle=assembleCollectedEvidence(ids,raw,times);
 assert.equal(bundle.evidence.browserV2.subject.role,"backend");
 assert.equal(bundle.evidence.nativeV2.sha256,createHash("sha256").update("{}").digest("hex"));
 assert.throws(()=>requireLiveCollection(bundle),/Authentic hardwired/);
 for(const bad of [{...raw,extra:"{}"},{...raw,primary:undefined},{...raw,primary:"x".repeat(16*1024**2+1)}])
  assert.throws(()=>assembleCollectedEvidence(ids,bad,times));
 assert.throws(()=>assembleCollectedEvidence(ids,raw,{...times,primary:"bad"}));
});
const actualIds={
 backend:{commit:"609d5a10a07a83bb5f1e858e7f6c1d706e741ee1",tree:"cae54e036af5254698c5cd45020b382cb0982052"},
 artifact:{commit:"064b6991ae2a48e2069baedc767cd918d28ba052",tree:"e6f76332d26f88c3f7df98dc689d013193729c83"},
};
function archivalFixture(name){
 const originalRaw=readFileSync(new URL("./fixtures/dual-release/"+(name==="nativeV2"?"native609.json":"browser609.json"),import.meta.url),"utf8");
 return {format:"proof-of-work-archival-test-observation-v1",originalRaw,
 originalSha256:name==="nativeV2"?"516b7712365a221bf64a6bb389db56f0b1d97fdf9bffccadabd0406df054bc68":"b344fbb4f069c8b92daaf314f7e68fdc0c68e93e0a3e3336ff42668f7b9c33c7",
 subjectIdentity:actualIds.backend,executionTimeUnknown:true,executedAt:null,freshnessClaim:false,
 qualificationSha256:"342ea3e50e956edcaf5f57434cd6e51fec64d251def3832c9e43a9934f8e4bf1",
 planSha256:"6ca83113503039e2ef7a03f232cb1b59b80804da8cc7f068c6e4c83fe91a5483",
 applicableArtifact:actualIds.artifact,backendArtifactDeltaSha256:"39e886ad82b297c53922f5619c2ae70f06e44ba4d451630d01ca98417a844507"};
}
test("original exact receipts remain unchanged with explicit unknown execution time",()=>{
 for(const name of ["nativeV2","browserV2"]){
  const value=archivalFixture(name),original=value.originalRaw;
  assert.equal(validateArchivalObservation(name,value,actualIds),original);
  assert.equal(value.originalRaw,original);assert.throws(()=>requireLiveCollection(value),/Authentic hardwired/);
  assert(!Object.hasOwn(JSON.parse(original),"executedAt"));
  for(const change of [
   {originalRaw:original+" "},{originalSha256:"0".repeat(64)},{freshnessClaim:true},
   {executionTimeUnknown:false},{executedAt:"2026-01-01T00:00:00.000Z"},
   {subjectIdentity:actualIds.artifact},{applicableArtifact:actualIds.backend},
   {backendArtifactDeltaSha256:"0".repeat(64)},{qualificationSha256:"0".repeat(64)},{planSha256:"0".repeat(64)},
   {extra:true},
  ])assert.throws(()=>validateArchivalObservation(name,{...value,...change},actualIds));
  assert.throws(()=>validateArchivalObservation("wrong",value,actualIds));
 }
});
test("transport contract has fixed origins, host keys, bounded calls and no injected runner",()=>{
 const code=readFileSync(new URL("./collect-dual-release-evidence.mjs",import.meta.url),"utf8");
 for(const text of ['StrictHostKeyChecking=yes','BatchMode=yes','IdentitiesOnly=yes','timeout:30000','maxBuffer:32*1024**2','Collection exceeded freshness budget','publish-render-provenance.json','scope[\'verified_release\']','scripts/check-current-growth-live.mjs','growthSha256','Archival receipts changed during collection'])
  assert(code.includes(text),text);
 assert(!/collectDualReleaseEvidence\(\{[^}]*\b(?:run|fetch|transport)\s*[,=]/u.test(code));
 assert(code.indexOf("validateOriginalArchiveCustody(archived")<code.indexOf("const primaryBefore="));
});

test("duplicate and deeply nested JSON cannot become ambiguous evidence",()=>{
 for(const value of ['{"ok":false,"ok":true}','{"a":{"x":1,"x":2}}','{"a":[{"x":1,"x":2}]}'])
  assert.throws(()=>parseCollectedJson(value),/Duplicate/);
 assert.throws(()=>parseCollectedJson('{"a":'+ '['.repeat(129)+'0'+']'.repeat(129)+'}'),/nesting/);
 const special={a:[{},[],{b:"brace } and quote "+String.fromCharCode(34)}]}; assert.deepEqual(parseCollectedJson(JSON.stringify(special)),special);
});

test("current operator main and product-artifact preview remain distinct",()=>{
 const value={branch:"main",trackedDirty:false,commit:ids.operator.commit,tree:ids.operator.tree,gitHubCommit:ids.operator.commit,
  preview:{format:"proof-of-work-ui-source-v1",...ids.artifact,trackedDirty:false}};
 assert.equal(validatePrimaryObservation(value,ids),value);
 for(const mutation of [{commit:ids.baselineOperator.commit},{gitHubCommit:ids.baselineOperator.commit},{tree:ids.artifact.tree},{branch:"candidate"},{trackedDirty:true},
  {preview:{format:"proof-of-work-ui-source-v1",...ids.operator,trackedDirty:false}}])
  assert.throws(()=>validatePrimaryObservation({...value,...mutation},ids));
});
