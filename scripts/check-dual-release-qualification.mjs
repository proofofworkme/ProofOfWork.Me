#!/usr/bin/env node
// Explicit evidence qualification, NOT exact-HEAD deployment or writer authorization.
import assert from "node:assert/strict";
import {createHash} from "node:crypto";
import {readFileSync,realpathSync,lstatSync} from "node:fs";
import {execFileSync} from "node:child_process";
import {resolve} from "node:path";
import {fileURLToPath,pathToFileURL} from "node:url";
import {createIdentityProof,requireIdentityProof,publicIdentityProof} from "./release-identity-proof.mjs";
import {collectDualReleaseEvidence,requireLiveCollection,validateArchivalObservation} from "./collect-dual-release-evidence.mjs";
import {validateRetainedHolds} from "./retirement-evidence.mjs";
const sha=raw=>createHash("sha256").update(raw).digest("hex");
const HASH=/^[a-f0-9]{64}$/u;
export const surfaces=Object.freeze("activity boost browser code computer desktop dns growth id inception infinity jobs landing marketplace nft pages permission publish search token wallet work".split(" "));
const rendererFiles=["server/publish-render/reader.mjs","server/publish-render/document.mjs","server/publish-render/handler.mjs","server/publish-render/server.mjs","src/app/seoMetadata.mjs","src/app/publishArticleSeo.mjs","src/shared/protocol/publishArticleMetadata.mjs","src/shared/protocol/boostText.mjs","src/shared/protocol/powcatLimits.mjs","src/shared/protocol/publishReaderPage.mjs"];
const checkerFiles=["scripts/check-publish-linked-live.mjs","src/shared/protocol/publishLinkedCapability.mjs","src/shared/protocol/publishArticleMetadata.mjs","src/shared/protocol/powcatLimits.mjs","package.json","package-lock.json"];
const roles=Object.freeze({primary:"operator",build:"artifact",uiManifest:"artifact",sourceProvenance:"artifact",renderer:"artifact",runtime:"backend",lifecycle:"artifact",preactivation:"artifact",activity:"artifact",growth:"artifact",nativeV2:"backend",browserV2:"backend"});
export function identitiesOf(proof) {
 const p=requireIdentityProof(proof);
 return Object.fromEntries(["artifact","baselineOperator","backend","operator"].map(k=>[k,{commit:p[k].commit,tree:p[k].tree}]));
}
function exactKeys(value,keys,label) {assert(value&&typeof value==="object"&&!Array.isArray(value),label);assert.deepEqual(Object.keys(value).sort(),[...keys].sort(),label);}
function time(value,now,maxAge,label) {assert.equal(typeof value,"string",label);const t=Date.parse(value);assert(Number.isFinite(t)&&new Date(t).toISOString()===value,label);assert(t<=now&&now-t<=maxAge,label+" is future or stale");return t;}
export function parseReleaseManifest(raw) {
 assert.equal(typeof raw,"string");assert(Buffer.byteLength(raw)<128*1024);
 const pairs=raw.trim().split("\n").map(line=>{const i=line.indexOf("=");assert(i>0,"Malformed UI manifest");return [line.slice(0,i),line.slice(i+1)];});
 assert.equal(new Set(pairs.map(([k])=>k)).size,pairs.length,"Duplicate UI manifest fields");
 return Object.fromEntries(pairs);
}
// Pure validation helper deliberately returns no admission/qualification object.
// Trusted bindings are derived from the branded Git proof in the public entrypoint.
export function validateEvidenceContents(bundle,ids,bindings,{now=Date.now(),validateTest=()=>{throw new Error("Native/browser evidence validator missing");}}={}) {
 assert(Number.isSafeInteger(now));
 exactKeys(bundle,["format","identities","evidence"],"Evidence envelope");
 assert.equal(bundle.format,"proof-of-work-dual-evidence-v1");assert.deepEqual(bundle.identities,ids);
 exactKeys(bundle.evidence,Object.keys(roles),"Exact evidence inventory");
 const data={},testExecutions={};
 for(const [name,role] of Object.entries(roles)) {
  const row=bundle.evidence[name];exactKeys(row,["subject","observedAt","raw","sha256"],name);
  assert.deepEqual(row.subject,{role,...ids[role]},name+" subject differs");
  time(row.observedAt,now,900000,name);assert.equal(typeof row.raw,"string");assert(Buffer.byteLength(row.raw)<=16*1024**2);
  assert(HASH.test(row.sha256)&&sha(row.raw)===row.sha256,name+" bytes differ");
  data[name]=name==="uiManifest"?parseReleaseManifest(row.raw):JSON.parse(row.raw);
 }
 const a=ids.artifact,o=ids.operator,b=ids.backend;
 const primary=data.primary;
 assert.equal(primary.branch,"main");assert.equal(primary.trackedDirty,false);
 assert.equal(primary.commit,o.commit);assert.equal(primary.tree,o.tree);assert.equal(primary.gitHubCommit,o.commit);
 assert.deepEqual(primary.preview,{format:"proof-of-work-ui-source-v1",...a,trackedDirty:false});
 const build=data.build;
 assert.equal(build.receipt.commit,a.commit);assert.equal(build.receipt.tree,a.tree);
 assert.equal(build.receipt.releaseId,"064b6991ae2a-20261114T020148Z");
 assert.equal(build.receipt.sourceCheckout,"/data/proofofwork-ui-builds/stock-064b699-20261114/proofofwork-ui-source-064b6991ae2a-20261114T020148Z");
 assert.equal(build.receipt.bundles.source.sha256,"50ca4454f99523ab9368c84ca5c7ddca20493e694c0e9f346530d18adfe54dc0");
 assert.equal(build.receipt.bundles.surfaces.sha256,"afa185cde402e1f904ec45dab0c61dd04eda3a8719c5d45377215243f85dfd1f");
 assert.equal(build.sourceArchiveSha256,build.receipt.bundles.source.sha256);
 assert.equal(build.surfacesArchiveSha256,build.receipt.bundles.surfaces.sha256);
 assert.equal(build.sourceCommit,a.commit);assert.equal(build.sourceTree,a.tree);assert.equal(build.sourceClean,true);
 assert.equal(sha(bundle.evidence.uiManifest.raw),bindings.manifestSha256,"Original deployed manifest changed");
 const manifest=data.uiManifest;
 assert.equal(manifest.format,"proofofwork-ui-release-v5");assert.equal(manifest.commit,a.commit);assert.equal(manifest.source_tree,a.tree);
 assert.equal(manifest.release_id,build.receipt.releaseId);
 assert.deepEqual(Object.keys(manifest).flatMap(k=>/^surface\.([^.]+)\.sha256$/u.exec(k)?.slice(1)||[]).sort(),[...surfaces].sort());
 exactKeys(data.sourceProvenance,surfaces,"All22 public surfaces");
 for(const s of surfaces){assert(HASH.test(manifest["surface."+s+".sha256"]));const row=data.sourceProvenance[s];
  assert.deepEqual(row.provenance,{format:"proof-of-work-ui-source-v1",...a,trackedDirty:false});
  assert.equal(row.inventorySha256,manifest["surface."+s+".sha256"],s+" current inventory differs");
 }
 const renderer=data.renderer;
 assert.equal(renderer.format,"proof-of-work-publish-render-source-v1");assert.equal(renderer.ok,true);assert.equal(renderer.commit,a.commit);assert.equal(renderer.tree,a.tree);
 assert.deepEqual(renderer.ui,{format:"proof-of-work-ui-source-v1",...a,trackedDirty:false});
 assert.deepEqual(renderer.files,bindings.rendererFiles);
 assert.equal(data.runtime.sourceCommit,b.commit);assert.deepEqual(data.runtime.runtimeAfter,bindings.runtimeAfter);
 assert.equal(data.runtime.writerEnabled,false);assert(HASH.test(data.runtime.archiveSha256));
 const lifecycle=data.lifecycle;
 assert.equal(lifecycle.publicationHealthy,true);assert.equal(lifecycle.retentionComplete,true);
 assert.equal(lifecycle.pair.current,manifest.release_id);assert.deepEqual(lifecycle.unfinishedIntents,[]);
 validateRetainedHolds(lifecycle,lifecycle.retirementEvidence);
 assert.equal(lifecycle.verifiedCapacityFloor?.rootReserveBytes,8*1024**3);
 assert.equal(lifecycle.verifiedCapacityFloor?.growthReserveBytes,64*1024**2);
 const probe=data.preactivation;
 assert.equal(probe.format,"publish-linked-dual-preactivation-v1");
 for(const name of ["artifact","baselineOperator","operator"])assert.deepEqual(probe[name],ids[name]);
 const remote=probe.remoteReceipt;
 assert.equal(remote.format,"publish-linked-remote-preactivation-v1");assert.equal(remote.ok,true);
 assert.equal(remote.commit,a.commit);assert.equal(remote.tree,a.tree);assert.equal(remote.source,build.receipt.sourceCheckout);
 assert.deepEqual(remote.checkerHashes,bindings.checkerHashes);
 assert.equal(remote.exitCode,0);assert.equal(remote.cgroupAbsent,true);assert.equal(remote.noTokenTransferred,true);assert.equal(remote.productionMutation,false);
 assert.equal(sha(remote.rawResult),remote.rawResultSha256);
 const live=JSON.parse(remote.rawResult);assert.equal(live.mode,"preactivation");assert.equal(live.newLinkedWriteVerified,false);assert(!live.error);
 for(const name of ["disabled-writer reader/indexer/Search/capacity readiness","public writer remains disabled","complete article feed"])assert.equal(live.checks?.find(x=>x.name===name)?.pass,true);
 assert.deepEqual(data.activity.qualificationSubject,a);assert.equal(data.activity.ok,true);assert.equal(data.activity.retentionComplete,true);assert.deepEqual(data.activity.pair,lifecycle.pair);
 if(lifecycle.retirementEvidence)assert.equal(data.activity.retirementReceiptSha256,lifecycle.verifiedRetiredPayloads.receiptSha256);
 assert.equal(data.growth.ok,true);assert.equal(data.growth.commit,a.commit);assert.equal(data.growth.canonicalParity,true);assert.deepEqual(data.growth.verified,["growth","computer"]);
 for(const name of ["nativeV2","browserV2"]) {
  const value=data[name],role=roles[name];
  const originalRaw=validateArchivalObservation(name,value,ids);
  validateTest(name,originalRaw);
  testExecutions[name]={subject:ids[role],executedAt:null,executionTimeUnknown:true,
   observedAt:bundle.evidence[name].observedAt,historicalOriginalExecution:true,
   originalSha256:value.originalSha256,qualificationSha256:value.qualificationSha256,
   planSha256:value.planSha256,backendArtifactDeltaSha256:value.backendArtifactDeltaSha256,
   freshnessClaim:false};
 }
 return {validatedEvidence:bundle.evidence,testExecutions};
}
function git(root,...args){return execFileSync("/usr/bin/git",["--no-replace-objects","-c","core.fsmonitor=false","-C",root,...args],{encoding:"utf8",env:{PATH:"/usr/bin:/bin",HOME:"/nonexistent",LC_ALL:"C",GIT_CONFIG_NOSYSTEM:"1",GIT_CONFIG_GLOBAL:"/dev/null",GIT_OPTIONAL_LOCKS:"0"},timeout:30000});}
export function validatePinnedDualEvidence({proof,rawBundle,expectedSha256,now=Date.now()}) {
 const p=requireIdentityProof(proof);assert(HASH.test(expectedSha256));assert.equal(typeof rawBundle,"string");
 assert(Buffer.byteLength(rawBundle)<=32*1024**2);assert.equal(sha(rawBundle),expectedSha256,"Independently pinned evidence bundle differs");
 const ids=identitiesOf(proof),root=p.repository;
 const read=name=>git(root,"show",p.artifact.commit+":"+name);
 const runtimeAfter=JSON.parse(execFileSync("/usr/bin/python3",["-I","-B","-c","import ast,json,sys; m=ast.parse(sys.stdin.read()); a=[n for n in m.body if isinstance(n,ast.Assign) and any(isinstance(t,ast.Name) and t.id=='AFTER' for t in n.targets)]; assert len(a)==1; print(json.dumps(ast.literal_eval(a[0].value)))"],{input:read("deploy/linked-publish/profile.py"),encoding:"utf8",env:{PATH:"/usr/bin:/bin",HOME:"/nonexistent"},timeout:15000}));
 const bindings={manifestSha256:"8dfdd08748108ea23438644ed43707502c7e29ecf9d939c5f7a98114e7137bca",rendererFiles:Object.fromEntries(rendererFiles.map(f=>[f,sha(read(f))])),checkerHashes:Object.fromEntries(checkerFiles.map(f=>[f,sha(read(f))])),runtimeAfter};
 const validateTest=(name,raw)=>execFileSync("/usr/bin/python3",["-I","-B","-c","import runpy,sys; m=runpy.run_path(sys.argv[1]); m[sys.argv[2]](sys.stdin.buffer.read())",resolve(root,"deploy/linked-publish/qualification.py"),name==="nativeV2"?"validate_native_evidence":"validate_browser_evidence"],{input:raw,encoding:"utf8",env:{PATH:"/usr/bin:/bin",HOME:"/nonexistent"},timeout:30000});
 const validated=validateEvidenceContents(JSON.parse(rawBundle),ids,bindings,{now,validateTest});
 const after=createIdentityProof({repository:root,now});
 for(const role of Object.keys(ids))assert.deepEqual(identitiesOf(after)[role],ids[role],"Source changed during qualification");
 return {format:"proof-of-work-dual-qualification-v1",mode:"offline-evidence-validation",liveCollectionVerified:false,collectionMethod:"offline-pinned-evidence-only",identities:ids,identityProof:publicIdentityProof(proof),issuedAt:new Date(now).toISOString(),
  evidenceBundleSha256:expectedSha256,evidence:validated.validatedEvidence,testExecutions:validated.testExecutions,
  exactHeadDeployment:false,activationAllowed:false,writerEnabled:false,liveNewWriteVerified:false,
  scope:"Offline evidence consistency only; live collection and independent qualification authority are still required. Not deployment or writer authorization."};
}
// Only the hardwired collector can mint this in-process authority. Offline JSON
// and matching caller-supplied hashes cannot be promoted to live qualification.
export function qualifyLiveDualEvidence({proof,collection,now=Date.now()}) {
 const p=requireIdentityProof(proof),live=requireLiveCollection(collection);
 assert.deepEqual(live.identities,identitiesOf(proof),"Collection identity mismatch");
 time(live.collectedAt,now,900000,"Live collection");
 const report=validatePinnedDualEvidence({proof,rawBundle:live.rawBundle,expectedSha256:live.sha256,now});
 return {...report,mode:"verification-only",liveCollectionVerified:true,
  collectionMethod:"hardwired-live-read-v1",collectedAt:live.collectedAt,
  scope:"Fresh read-only collection with separately identified archival tests. Not exact-HEAD deployment or writer authorization."};
}
export function readPinnedEvidence(path,expected) {
 const p=resolve(path),before=lstatSync(p);assert.equal(realpathSync(p),p);assert(before.isFile()&&before.nlink===1&&!(before.mode&0o022)&&before.size<=32*1024**2);
 const raw=readFileSync(p,"utf8"),after=lstatSync(p);
 for(const key of ["dev","ino","size","mtimeMs","ctimeMs"])assert.equal(after[key],before[key],"Evidence changed");
 assert.equal(sha(raw),expected);return raw;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href) {
 try {
  const args=process.argv.slice(2);
  if(args.length===3&&args[0]==="--repository"&&args[2]==="--live") {
   const proof=createIdentityProof({repository:args[1]});
   const collection=await collectDualReleaseEvidence({proof});
   console.log(JSON.stringify(qualifyLiveDualEvidence({proof,collection})));
  } else {
   assert(args.length===6&&args[0]==="--repository"&&args[2]==="--evidence"&&args[4]==="--sha256","Explicit --repository PATH --live OR --repository PATH --evidence FILE --sha256 TRUSTED_DIGEST required");
   const proof=createIdentityProof({repository:args[1]});
   console.log(JSON.stringify(validatePinnedDualEvidence({proof,rawBundle:readPinnedEvidence(args[3],args[5]),expectedSha256:args[5]})));
  }
 }catch(error){console.error(error.message);process.exitCode=1;}
}
