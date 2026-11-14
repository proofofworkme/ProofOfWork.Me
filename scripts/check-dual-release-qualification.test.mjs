import test from "node:test";
import assert from "node:assert/strict";
import {createHash} from "node:crypto";
import {readFileSync} from "node:fs";
import {execFileSync} from "node:child_process";
import {validateEvidenceContents,validatePinnedDualEvidence,qualifyLiveDualEvidence,parseReleaseManifest,surfaces} from "./check-dual-release-qualification.mjs";
import {runActivityFeeFactorLive,validateActivityIdentity} from "./check-activity-fee-factor-live.mjs";
const sha=x=>createHash("sha256").update(x).digest("hex");
const now=Date.parse("2026-11-14T18:00:00.000Z");
const ids={artifact:{commit:"064b6991ae2a48e2069baedc767cd918d28ba052",tree:"e6f76332d26f88c3f7df98dc689d013193729c83"},baselineOperator:{commit:"c7cfa32ae01ae70042bac0539ddf74d816ae474a",tree:"fe7a2f82097c925235c1bfca3d3281584d3e7ab4"},backend:{commit:"609d5a10a07a83bb5f1e858e7f6c1d706e741ee1",tree:"cae54e036af5254698c5cd45020b382cb0982052"},operator:{commit:"d".repeat(40),tree:"e".repeat(40)}};
const roles={primary:"operator",build:"artifact",uiManifest:"artifact",sourceProvenance:"artifact",renderer:"artifact",runtime:"backend",lifecycle:"artifact",preactivation:"artifact",activity:"artifact",growth:"artifact",nativeV2:"backend",browserV2:"backend"};
function archival(name) {
 const originalRaw=readFileSync(new URL("./fixtures/dual-release/"+(name==="nativeV2"?"native609.json":"browser609.json"),import.meta.url),"utf8");
 return {format:"proof-of-work-archival-test-observation-v1",originalRaw,originalSha256:sha(originalRaw),subjectIdentity:ids.backend,
 executionTimeUnknown:true,executedAt:null,freshnessClaim:false,
 qualificationSha256:"342ea3e50e956edcaf5f57434cd6e51fec64d251def3832c9e43a9934f8e4bf1",
 planSha256:"6ca83113503039e2ef7a03f232cb1b59b80804da8cc7f068c6e4c83fe91a5483",
 applicableArtifact:ids.artifact,backendArtifactDeltaSha256:"39e886ad82b297c53922f5619c2ae70f06e44ba4d451630d01ca98417a844507"};
}
function fixture() {
 const release="064b6991ae2a-20261114T020148Z",source="/data/proofofwork-ui-builds/stock-064b699-20261114/proofofwork-ui-source-"+release;
 const provenance={format:"proof-of-work-ui-source-v1",...ids.artifact,trackedDirty:false};
 const manifest=["format=proofofwork-ui-release-v5","commit="+ids.artifact.commit,"source_tree="+ids.artifact.tree,"release_id="+release,...surfaces.map(s=>"surface."+s+".sha256="+"f".repeat(64))].join("\n")+"\n";
 const bindings={manifestSha256:sha(manifest),rendererFiles:{"file.mjs":"1".repeat(64)},checkerHashes:{"checker.mjs":"2".repeat(64)},runtimeAfter:{"server/api.mjs":"3".repeat(64)}};
 const live=JSON.stringify({mode:"preactivation",newLinkedWriteVerified:false,checks:["disabled-writer reader/indexer/Search/capacity readiness","public writer remains disabled","complete article feed"].map(name=>({name,pass:true}))});
 const lifecycle={publicationHealthy:true,retentionComplete:true,pair:{current:release,previous:"e2669bc1fd32-20261112T163804Z"},unfinishedIntents:[],verifiedPreservedRelease1042:{releaseId:"1042efea2aa1-20261112T074918Z"},verifiedPreservedFallback:{releaseId:"c3969c39c2b2-20261101T051206Z"},verifiedCapacityFloor:{rootReserveBytes:8*1024**3,growthReserveBytes:64*1024**2}};
 const values={
 primary:{branch:"main",trackedDirty:false,...ids.operator,gitHubCommit:ids.operator.commit,preview:{format:"proof-of-work-ui-source-v1",...ids.artifact,trackedDirty:false}},
 build:{receipt:{...ids.artifact,releaseId:release,sourceCheckout:source,bundles:{source:{sha256:"50ca4454f99523ab9368c84ca5c7ddca20493e694c0e9f346530d18adfe54dc0"},surfaces:{sha256:"afa185cde402e1f904ec45dab0c61dd04eda3a8719c5d45377215243f85dfd1f"}}},sourceArchiveSha256:"50ca4454f99523ab9368c84ca5c7ddca20493e694c0e9f346530d18adfe54dc0",surfacesArchiveSha256:"afa185cde402e1f904ec45dab0c61dd04eda3a8719c5d45377215243f85dfd1f",sourceCommit:ids.artifact.commit,sourceTree:ids.artifact.tree,sourceClean:true},
 uiManifest:manifest,sourceProvenance:Object.fromEntries(surfaces.map(s=>[s,{provenance,inventorySha256:"f".repeat(64)}])),
 renderer:{format:"proof-of-work-publish-render-source-v1",ok:true,...ids.artifact,ui:provenance,files:bindings.rendererFiles},
 runtime:{sourceCommit:ids.backend.commit,runtimeAfter:bindings.runtimeAfter,archiveSha256:"4".repeat(64),writerEnabled:false},
 lifecycle,
 preactivation:{format:"publish-linked-dual-preactivation-v1",artifact:ids.artifact,baselineOperator:ids.baselineOperator,operator:ids.operator,remoteReceipt:{format:"publish-linked-remote-preactivation-v1",ok:true,...ids.artifact,source,checkerHashes:bindings.checkerHashes,exitCode:0,cgroupAbsent:true,noTokenTransferred:true,productionMutation:false,rawResult:live,rawResultSha256:sha(live)}},
 activity:{qualificationSubject:ids.artifact,ok:true,retentionComplete:true,pair:lifecycle.pair},
 growth:{ok:true,commit:ids.artifact.commit,verified:["growth","computer"],canonicalParity:true},
 nativeV2:archival("nativeV2"),
 browserV2:archival("browserV2")
 };
 const bundle={format:"proof-of-work-dual-evidence-v1",identities:structuredClone(ids),evidence:{}};
 for(const [name,role]of Object.entries(roles)){const raw=name==="uiManifest"?values[name]:JSON.stringify(values[name]);bundle.evidence[name]={subject:{role,...ids[role]},observedAt:new Date(now-1000).toISOString(),raw,sha256:sha(raw)};}
 return {bundle,bindings};
}
function edit(f,name,mutate){const row=f.bundle.evidence[name],v=JSON.parse(row.raw);mutate(v);row.raw=JSON.stringify(v);row.sha256=sha(row.raw);}
function check(f,validateTest=()=>{}){return validateEvidenceContents(f.bundle,ids,f.bindings,{now,validateTest});}
test("offline consistency preserves artifact/baseline/current operator and unknown original test time",()=>{
 const f=fixture(),calls=[];const r=check(f,(name)=>calls.push(name));assert.deepEqual(calls,["nativeV2","browserV2"]);assert.equal(r.testExecutions.browserV2.executedAt,null);assert.equal(r.testExecutions.browserV2.executionTimeUnknown,true);assert.equal(r.testExecutions.browserV2.freshnessClaim,false);assert.equal(r.activationAllowed,undefined);
});
for(const [name,mutate] of [
 ["missing evidence",f=>delete f.bundle.evidence.runtime],
 ["extra evidence",f=>f.bundle.evidence.fake=f.bundle.evidence.runtime],
 ["stale observation",f=>f.bundle.evidence.primary.observedAt=new Date(now-900001).toISOString()],
 ["future observation",f=>f.bundle.evidence.primary.observedAt=new Date(now+1).toISOString()],
 ["raw digest",f=>f.bundle.evidence.runtime.raw+=" "],
 ["wrong subject",f=>f.bundle.evidence.runtime.subject.commit=ids.operator.commit],
 ["changed GitHub",f=>edit(f,"primary",v=>v.gitHubCommit="9".repeat(40))],
 ["dirty primary",f=>edit(f,"primary",v=>v.trackedDirty=true)],
 ["false artifact relabel",f=>edit(f,"build",v=>v.receipt.commit=ids.operator.commit)],
 ["archive mutation",f=>edit(f,"build",v=>v.sourceArchiveSha256="0".repeat(64))],
 ["missing public surface",f=>edit(f,"sourceProvenance",v=>delete v.boost)],
 ["stale UI bytes",f=>edit(f,"sourceProvenance",v=>v.boost.inventorySha256="0".repeat(64))],
 ["wrong UI provenance",f=>edit(f,"sourceProvenance",v=>v.boost.provenance.commit=ids.operator.commit)],
 ["renderer identity relabel",f=>edit(f,"renderer",v=>v.commit=ids.operator.commit)],
 ["wrong renderer",f=>edit(f,"renderer",v=>v.files["file.mjs"]="0".repeat(64))],
 ["writer enabled",f=>edit(f,"runtime",v=>v.writerEnabled=true)],
 ["runtime mutation",f=>edit(f,"runtime",v=>v.runtimeAfter["server/api.mjs"]="0".repeat(64))],
 ["incomplete lifecycle",f=>edit(f,"lifecycle",v=>v.retentionComplete=false)],
 ["unfinished intent",f=>edit(f,"lifecycle",v=>v.unfinishedIntents=["pending"])],
 ["missing historical hold",f=>edit(f,"lifecycle",v=>delete v.verifiedPreservedRelease1042)],
 ["reserve downgrade",f=>edit(f,"lifecycle",v=>v.verifiedCapacityFloor.rootReserveBytes=0)],
 ["probe artifact relabel",f=>edit(f,"preactivation",v=>v.remoteReceipt.commit=ids.operator.commit)],
 ["probe nonterminal",f=>edit(f,"preactivation",v=>v.remoteReceipt.cgroupAbsent=false)],
 ["probe token disclosure",f=>edit(f,"preactivation",v=>v.remoteReceipt.noTokenTransferred=false)],
 ["activity artifact relabel",f=>edit(f,"activity",v=>v.qualificationSubject=ids.operator)],
 ["different activity pair",f=>edit(f,"activity",v=>v.pair.current="wrong")],
 ["growth parity",f=>edit(f,"growth",v=>v.canonicalParity=false)],
 ["changed archived original",f=>edit(f,"nativeV2",v=>v.originalRaw+=" ")],
 ["wrong archived qualification",f=>edit(f,"nativeV2",v=>v.qualificationSha256="0".repeat(64))],
 ["wrong archive plan",f=>edit(f,"browserV2",v=>v.planSha256="0".repeat(64))],
 ["false freshness claim",f=>edit(f,"browserV2",v=>v.freshnessClaim=true)],
 ["missing unknown execution label",f=>edit(f,"nativeV2",v=>delete v.executionTimeUnknown)],
 ["wrong applicability",f=>edit(f,"browserV2",v=>v.applicableArtifact=ids.operator)],
 ["wrong unchanged product proof",f=>edit(f,"browserV2",v=>v.backendArtifactDeltaSha256="0".repeat(64))],
 ["legacy test missing subject",f=>edit(f,"nativeV2",v=>delete v.subjectIdentity)],
 ["relabeled original test",f=>edit(f,"browserV2",v=>v.subjectIdentity=ids.operator)],
 ["invented original execution",f=>edit(f,"browserV2",v=>v.executedAt=new Date(now-8*86400000).toISOString())],
 ["false execution time",f=>edit(f,"browserV2",v=>v.executedAt=new Date(now).toISOString())]
]) test("reject "+name,()=>{const f=fixture();mutate(f);assert.throws(()=>check(f));});
test("real native/browser validators cannot be replaced by passed wrapper",()=>assert.throws(()=>check(fixture(),()=>{throw new Error("actual test failed");}),/actual test failed/));
test("JSON identity proof cannot mint offline qualification",()=>assert.throws(()=>validatePinnedDualEvidence({proof:{},rawBundle:"{}",expectedSha256:sha("{}"),now})));
test("bad activity proof rejects before any network call",async()=>assert.rejects(runActivityFeeFactorLive({identityProof:{}})));
test("default exact-head release gate remains byte unchanged",()=>{
 const p=new URL("./check-release-sync.mjs",import.meta.url),actual=readFileSync(p);
 const baseline=execFileSync("git",["show","c7cfa32ae01ae70042bac0539ddf74d816ae474a:scripts/check-release-sync.mjs"],{cwd:new URL("../",import.meta.url)});
 assert.deepEqual(actual,baseline);
});
test("manifest rejects duplicates",()=>assert.throws(()=>parseReleaseManifest("commit=a\ncommit=b\n")));

test("offline or copied JSON cannot mint live qualification",()=>assert.throws(()=>qualifyLiveDualEvidence({proof:{},collection:{liveCollectionVerified:true},now})));

test("pinned original fixtures pass unchanged historical validators",()=>{
 const f=fixture();check(f,(name,raw)=>execFileSync("/usr/bin/python3",["-I","-B","-c","import runpy,sys; q=runpy.run_path(sys.argv[1]); q[sys.argv[2]](sys.stdin.buffer.read())",new URL("../deploy/linked-publish/qualification.py",import.meta.url).pathname,name==="nativeV2"?"validate_native_evidence":"validate_browser_evidence"],{input:raw,env:{PATH:"/usr/bin:/bin",HOME:"/nonexistent"}}));
});

test("committed current operator validates activity identity without network",{skip:!process.env.POW_IDENTITY_TEST_REPOSITORY},async()=>{
 const {createIdentityProof}=await import("./release-identity-proof.mjs");
 const proof=createIdentityProof({repository:process.env.POW_IDENTITY_TEST_REPOSITORY});
 assert.equal(validateActivityIdentity(proof),proof);
 assert.throws(()=>validateActivityIdentity(JSON.parse(JSON.stringify(proof))));
});
