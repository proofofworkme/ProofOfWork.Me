import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, existsSync, symlinkSync, renameSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve, dirname, posix } from "node:path";
import { fileURLToPath } from "node:url";
import { publishCheckerFiles, validateNodeBuildSource, localPublishSource, publicVerificationEnvironment,
  remotePreactivationProgram, runRemotePublishPreactivation, assertPublishCheckerClosure } from "./check-publish-linked-remote.mjs";
const sha=raw=>createHash("sha256").update(raw).digest("hex");
const source="/data/proofofwork-ui-builds/candidate/proofofwork-ui-source-123456789abc-20261113T160000Z";
const env={PATH:"/bin",POW_PUBLISH_CHECK_MODE:"preactivation",POW_PUBLISH_CHECK_NODE_SOURCE:source};
const binding={commit:"a".repeat(40),tree:"b".repeat(40),hashes:Object.fromEntries(publishCheckerFiles.map(n=>[n,"c".repeat(64)]))};
function reply(input) {
 const request=JSON.parse(input),rawResult=JSON.stringify({mode:"preactivation",newLinkedWriteVerified:false,checks:[
  {name:"disabled-writer reader/indexer/Search/capacity readiness",pass:true},
  {name:"public writer remains disabled",pass:true},{name:"complete article feed",pass:true}]});
 return {format:"publish-linked-remote-preactivation-v1",ok:true,...binding,checkerHashes:binding.hashes,source,
  unit:request.unit,exitCode:0,cgroupAbsent:true,noTokenTransferred:true,productionMutation:false,rawResult,rawResultSha256:sha(rawResult)};
}
function execute(change=()=>{},options={}) {
 return runRemotePublishPreactivation({env,collect:()=>binding,nonce:()=>"d".repeat(12),run:(_exe,_args,opts)=>{
  const response=reply(opts.input);change(response);return {status:0,stdout:JSON.stringify(response)};
 },...options});
}
test("remote mode uses fixed SSH identity and bounded secret-free source request",()=>{
 let call;
 const value=execute(()=>{},{run:(exe,args,opts)=>{call={exe,args,opts};return {status:0,stdout:JSON.stringify(reply(opts.input))};}});
 assert.equal(value.ok,true);assert.equal(call.exe,"ssh");assert.ok(call.args.includes("powadmin@65.108.122.87"));
 assert.ok(call.args.includes("/home/sixer/.ssh/proofofwork_node_ed25519"));
 assert.match(call.args.at(-1),/^sudo -n \/usr\/bin\/python3 -I -B -c /u);
 assert.equal(call.opts.timeout,360000);assert.equal(call.opts.maxBuffer,2*1024**2);
 assert.deepEqual(call.opts.env,{PATH:"/bin",GIT_OPTIONAL_LOCKS:"0"});
 assert.deepEqual(Object.keys(JSON.parse(call.opts.input)).sort(),["commit","hashes","source","tree","unit"]);
 assert.equal(JSON.parse(value.rawResult).newLinkedWriteVerified,false);
});
for(const path of [undefined,"/tmp/checkout",source+"/..",source+";touch /tmp/bad",source.replace("/candidate/","/../"),source.replace("/candidate/","/bad space/")])
 test("rejects unsafe/nonbuild source "+String(path),()=>assert.throws(()=>validateNodeBuildSource(path)));
for(const key of ["POW_INTERNAL_VERIFIER_TOKEN","POW_PUBLISH_CHECK_ORIGIN"])
 test("rejects local private override without sending it "+key,()=>{
  let ran=false;assert.throws(()=>execute(()=>{},{env:{...env,[key]:"synthetic-sensitive-value"},run:()=>{ran=true;}}),/protected node/);
  assert.equal(ran,false);
 });
test("private settings are stripped without mutating caller environment",()=>{
 const input={...env,POW_INTERNAL_VERIFIER_TOKEN:"synthetic",POW_PUBLISH_CHECK_ORIGIN:"http://127.0.0.1:8081"};
 assert.deepEqual(publicVerificationEnvironment(input),{PATH:"/bin",GIT_OPTIONAL_LOCKS:"0"});
 assert.equal(input.POW_INTERNAL_VERIFIER_TOKEN,"synthetic");
});
for(const failure of [{status:1},{status:null,signal:"SIGTERM"},{error:new Error("transport")},{}])
 test("transport/child uncertainty fails closed "+JSON.stringify(failure),()=>assert.throws(()=>execute(()=>{},{run:()=>failure}),/reconcile pow-linked-verify-/));
for(const [name,mutate] of [
 ["wrong commit",v=>v.commit="e".repeat(40)],["wrong tree",v=>v.tree="e".repeat(40)],
 ["wrong source",v=>v.source="/data/wrong"],["wrong unit",v=>v.unit="other"],
 ["changed closure",v=>v.checkerHashes={}],["not stopped",v=>v.cgroupAbsent=false],
 ["changed raw",v=>v.rawResult+=" "],["token transfer claim",v=>v.noTokenTransferred=false],
 ["wrong mode",v=>{const raw=JSON.parse(v.rawResult);raw.mode="active";v.rawResult=JSON.stringify(raw);v.rawResultSha256=sha(v.rawResult);}],
 ["failed semantic check",v=>{const raw=JSON.parse(v.rawResult);raw.checks[0].pass=false;v.rawResult=JSON.stringify(raw);v.rawResultSha256=sha(v.rawResult);}],
 ]) test("rejects "+name,()=>assert.throws(()=>execute(mutate)));
test("local identity is fenced after remote execution",()=>{
 let calls=0;assert.throws(()=>execute(()=>{},{collect:()=>++calls===1?binding:{...binding,tree:"e".repeat(40)}}),/Local source changed/);
});
test("remote program compiles; uses inherited protected environment, not token reads",()=>{
 execFileSync("python3",["-I","-B","-c","import sys;compile(sys.stdin.read(),'<remote>','exec')"],{input:remotePreactivationProgram});
 assert.ok(remotePreactivationProgram.includes("--property=EnvironmentFile=/etc/proofofwork-api/internal-verifier.env"));
 assert.ok(!remotePreactivationProgram.includes("POW_INTERNAL_VERIFIER_TOKEN"));
 assert.ok(remotePreactivationProgram.includes('"GIT_OPTIONAL_LOCKS":"0"'));
 assert.ok(remotePreactivationProgram.includes("--property=RuntimeMaxSec=300"));
 assert.ok(!remotePreactivationProgram.includes("write_bytes"));
});
test("declared source closure covers every relative checker import",()=>{
 const root=fileURLToPath(new URL("../",import.meta.url)),todo=["scripts/check-publish-linked-live.mjs"],seen=new Set();
 while(todo.length){const name=todo.pop();if(seen.has(name))continue;seen.add(name);
  assert.ok(publishCheckerFiles.includes(name),name);
  for(const match of readFileSync(resolve(root,name),"utf8").matchAll(/^(?:import|export).*?from\s+["'](\.[^"']+)["']/gmu))
   todo.push(posix.normalize(posix.join(posix.dirname(name),match[1])));
 }
 assert.ok(publishCheckerFiles.includes("package-lock.json"));assert.ok(publishCheckerFiles.includes("package.json"));
});
test("real local git collection rejects dirty tracked source",()=>{
 const root=mkdtempSync(resolve(tmpdir(),"pow-remote-source-test-"));
 try {
  const git=(...args)=>execFileSync("git",args,{cwd:root,env:{...process.env,GIT_OPTIONAL_LOCKS:"0"},stdio:"pipe"});
  git("init","-q");git("config","user.name","Fixture");git("config","user.email","fixture@example.invalid");
  for(const name of publishCheckerFiles){mkdirSync(dirname(resolve(root,name)),{recursive:true});writeFileSync(resolve(root,name),readFileSync(new URL("../"+name,import.meta.url)));}
  git("add",".");git("commit","-qm","fixture");
  const captured=localPublishSource(root,{});assert.equal(Object.keys(captured.hashes).length,publishCheckerFiles.length);
  writeFileSync(resolve(root,publishCheckerFiles[0]),"changed");assert.throws(()=>localPublishSource(root,{}),/must be clean/);
 } finally {rmSync(root,{recursive:true,force:true});}
});

test("checker direct metadata import retains exact re-exported function identity and behavior",async()=>{
 const direct=await import("../src/shared/protocol/publishArticleMetadata.mjs");
 const prior=await import("../src/shared/protocol/publishArticle.mjs");
 for(const name of ["normalizePublishArticleMetadata","publishArticleVerification","publishArticleBodyBytes"])
  assert.equal(direct[name],prior[name],name);
 for(const sample of [null,{}, {v:1,title:"Fixture",size:3,sha256:"a".repeat(64)}])
  assert.deepEqual(direct.normalizePublishArticleMetadata(sample),prior.normalizePublishArticleMetadata(sample));
 assert.deepEqual(direct.publishArticleBodyBytes("A\r\n🌍"),prior.publishArticleBodyBytes("A\r\n🌍"));
 const checker=readFileSync(new URL("./check-publish-linked-live.mjs",import.meta.url),"utf8");
 assert.match(checker,/from "\.\.\/src\/shared\/protocol\/publishArticleMetadata\.mjs"/u);
 assert.doesNotMatch(checker,/from "\.\.\/src\/shared\/protocol\/publishArticle\.mjs"/u);
});
test("checker runs active and preactivation fixtures without any node_modules",()=>{
 const root=mkdtempSync(resolve(tmpdir(),"pow-no-dependencies-")),repo=fileURLToPath(new URL("../",import.meta.url));
 try {
  for(const name of publishCheckerFiles){mkdirSync(dirname(resolve(root,name)),{recursive:true});writeFileSync(resolve(root,name),readFileSync(resolve(repo,name)));}
  const script=`import assert from "node:assert/strict";
import {runPublishLinkedLiveCheck} from ${JSON.stringify(new URL("file://"+resolve(root,"scripts/check-publish-linked-live.mjs")).href)};
const hash="a".repeat(64),checkpoint={height:5,hash},model="linked-publish-content-search-v1";
const ready={model:"publish-linked-preactivation-v1",network:"livenet",ready:true,enabled:false,writesEnabled:false,reason:null,serverTime:new Date().toISOString(),elapsedMs:10,readerVersion:2,indexerVersion:2,checkpoint,sourceIdentity:{model:"publish-linked-source-closure-v1",sha256:hash,files:"4",bytes:"20000"},search:{model,indexVersion:"proof-search-v6-linked-publish-content",ready:true,fullBodySearch:true,parserIdentity:hash,checkpoint,storage:{model,retainedBytes:0,maxRetainedBytes:8*1024**3,physicalBytes:0,maxPhysicalBytes:12*1024**3,minFreeBytes:100*1024**3,freeBytes:String(200*1024**3)}}};
const capability={model:"publish-linked-capability-v2",network:"livenet",enabled:true,readerVersion:2,indexerVersion:2,checkpoint,serverTime:new Date().toISOString()};
const fetchImpl=async url=>new Response(JSON.stringify(url.includes("/internal/")?ready:url.includes("capabilities=")?capability:{complete:true,network:"livenet",items:[]}));
const active=await runPublishLinkedLiveCheck({env:{},fetchImpl});assert.equal(active.error,undefined);
capability.enabled=false;
const blocked=await runPublishLinkedLiveCheck({env:{},fetchImpl});assert.ok(blocked.error);
const pre=await runPublishLinkedLiveCheck({env:{POW_PUBLISH_CHECK_MODE:"preactivation",POW_INTERNAL_VERIFIER_TOKEN:"synthetic-fixture-token-".repeat(3)},fetchImpl});assert.equal(pre.error,undefined);assert.equal(pre.newLinkedWriteVerified,false);
console.log("dependency-free-checker-fixtures-passed");`;
  const environment={...process.env};delete environment.NODE_OPTIONS;delete environment.NODE_PATH;
  const result=execFileSync(process.execPath,["--input-type=module"],{input:script,cwd:root,env:environment,encoding:"utf8"});
  assert.match(result,/dependency-free-checker-fixtures-passed/);
  assert.ok(!readFileSync(resolve(root,"scripts/check-publish-linked-live.mjs"),"utf8").includes("bitcoinjs"));
 } finally {rmSync(root,{recursive:true,force:true});}
});
test("token-bearing transient service clears executable preloads and checks ownership/fully clean source",()=>{
 assert.ok(remotePreactivationProgram.includes("--property=UnsetEnvironment=NODE_OPTIONS NODE_PATH"));
 assert.ok(remotePreactivationProgram.includes("info.st_uid in allowed_owners"));
 assert.ok(remotePreactivationProgram.includes("--untracked-files=all"));
 assert.equal(publishCheckerFiles.filter(name=>name.endsWith(".mjs")).length,4);
 assert.ok(!publishCheckerFiles.some(name=>name.endsWith("powcat1.mjs")||name.endsWith("publishArticle.mjs")));
});

function withSourceFixture(check) {
 const root=mkdtempSync(resolve(tmpdir(),"pow-local-closure-"));
 try {
  const git=(...args)=>execFileSync("git",args,{cwd:root,env:{...process.env,GIT_OPTIONAL_LOCKS:"0"},stdio:"pipe"});
  git("init","-q");git("config","user.name","Fixture");git("config","user.email","fixture@example.invalid");
  for(const name of publishCheckerFiles){mkdirSync(dirname(resolve(root,name)),{recursive:true});writeFileSync(resolve(root,name),readFileSync(new URL("../"+name,import.meta.url)));}
  git("add",".");git("commit","-qm","fixture");
  check(root,git);
 } finally {rmSync(root,{recursive:true,force:true});rmSync(root+"-alias",{force:true});}
}
test("unrelated untracked evidence and modules remain untouched and cannot execute",()=>withSourceFixture(root=>{
 const before=localPublishSource(root,{}),marker=resolve(root,"executed");
 const files=["audits/old-receipt.json","scripts/untracked.mjs","node_modules/untracked/index.js"];
 for(const name of files){mkdirSync(dirname(resolve(root,name)),{recursive:true});writeFileSync(resolve(root,name),`throw new Error("must never execute"); /* ${marker} */`);}
 const contents=files.map(name=>readFileSync(resolve(root,name)));
 assert.deepEqual(localPublishSource(root,{}),before);assert.equal(existsSync(marker),false);
 files.forEach((name,index)=>assert.deepEqual(readFileSync(resolve(root,name)),contents[index]));
}));
for(const name of publishCheckerFiles) test("committed-byte fence rejects hidden change to "+name,()=>withSourceFixture((root,git)=>{
 git("update-index","--assume-unchanged",name);writeFileSync(resolve(root,name),readFileSync(resolve(root,name))+"\nchanged");
 assert.throws(()=>localPublishSource(root,{}),/differs from commit/);
}));
for(const [label,addition] of [
 ["static",'\nimport "./untracked.mjs";'],
 ["dynamic",'\nawait import("./untracked.mjs");'],
 ["comment-split dynamic",'\nawait import/* split */("./untracked.mjs");'],
 ["re-export",'\nexport/**/{x} from "./untracked.mjs";'],
 ["loader",'\nconst loader = createRequire(import.meta.url);'],
 ["computed loader","\n"+String.raw`globalThis["ev"+"al"]("im"+"port(\"./untracked.mjs\")");`],
]) test("committed unexpected "+label+" loading is outside the fixed closure",()=>withSourceFixture((root,git)=>{
 execFileSync(process.execPath,["--check","--input-type=module"],{input:addition,stdio:["pipe","pipe","pipe"]});
 const name=publishCheckerFiles[0];writeFileSync(resolve(root,name),readFileSync(resolve(root,name))+addition);
 git("add",name);git("commit","-qm","changed checker fixture");
 assert.throws(()=>localPublishSource(root,{}),/Reviewed checker closure bytes differ/);
}));
test("canonical local fence rejects a byte-identical checker symlink",()=>withSourceFixture((root,git)=>{
 const name=publishCheckerFiles[0],target=resolve(root,"copy.mjs");writeFileSync(target,readFileSync(resolve(root,name)));
 git("update-index","--assume-unchanged",name);rmSync(resolve(root,name));symlinkSync(target,resolve(root,name));
 assert.throws(()=>localPublishSource(root,{}),/symlinks/);
}));
test("canonical local fence rejects a symlinked checker ancestor",()=>withSourceFixture((root,git)=>{
 git("update-index","--assume-unchanged",publishCheckerFiles[0]);renameSync(resolve(root,"scripts"),resolve(root,"scripts-copy"));symlinkSync(resolve(root,"scripts-copy"),resolve(root,"scripts"));
 assert.throws(()=>localPublishSource(root,{}),/symlinks/);
}));
test("canonical local fence rejects a symlinked repository root",()=>withSourceFixture(root=>{
 symlinkSync(root,root+"-alias");assert.throws(()=>localPublishSource(root+"-alias",{}),/canonical/);
}));
test("actual fixed checker closure validates without resolving node_modules",()=>{
 const files=new Map(publishCheckerFiles.map(name=>[name,readFileSync(new URL("../"+name,import.meta.url))]));
 assert.doesNotThrow(()=>assertPublishCheckerClosure(files));
 const changed=new Map(files);changed.set(publishCheckerFiles[0],Buffer.from(files.get(publishCheckerFiles[0]).toString().replace('from "node:crypto"','from "untracked-package"')));
 assert.throws(()=>assertPublishCheckerClosure(changed),/Reviewed checker closure bytes differ/);
});


for (const identityProof of [null, {}, Object.freeze({artifact:binding,operator:binding}),
  {format:"release-identity-proof-v1",repository:"/tmp",artifact:binding,operator:binding}])
 test("dual mode refuses unbranded proof "+JSON.stringify(identityProof),()=>{
  let ran=false;
  assert.throws(()=>execute(()=>{},{identityProof,run:()=>{ran=true;}}));
  assert.equal(ran,false);
 });
// Positive proof branding must come from the exact committed qualification source.
// This opt-in suite never invokes SSH; the actual proof and local byte collection run.
test("committed dual identity proof preserves artifact receipts and every remote fence", {
 skip: !process.env.POW_IDENTITY_TEST_REPOSITORY && "requires final committed qualification repository",
}, async t=>{
 const {createIdentityProof,publicIdentityProof}=await import("./release-identity-proof.mjs");
 const root=process.env.POW_IDENTITY_TEST_REPOSITORY;
 const identityProof=createIdentityProof({repository:root});
 const local=localPublishSource(root,env);
 const invoke=(mutate=()=>{},options={})=>runRemotePublishPreactivation({root,env,identityProof,
  nonce:()=>"d".repeat(12),run:(_exe,_args,opts)=>{
   const request=JSON.parse(opts.input);
   assert.equal(request.commit,identityProof.artifact.commit);
   assert.equal(request.tree,identityProof.artifact.tree);
   assert.deepEqual(request.hashes,local.hashes);
   assert.deepEqual(opts.env,{PATH:"/usr/bin:/bin",GIT_OPTIONAL_LOCKS:"0"});
   const response={...reply(opts.input),commit:request.commit,tree:request.tree,checkerHashes:request.hashes};
   mutate(response);return {status:0,stdout:JSON.stringify(response)};
  },...options});
 await t.test("honest dual wrapper retains original artifact identity",()=>{
  const value=invoke();
  assert.equal(value.format,"publish-linked-dual-preactivation-v1");
  assert.deepEqual(value.baselineOperator,identityProof.baselineOperator);
  assert.deepEqual(value.artifact,identityProof.artifact);
  assert.deepEqual(value.operator,identityProof.operator);
  assert.equal(value.remoteReceipt.format,"publish-linked-remote-preactivation-v1");
  assert.equal(value.remoteReceipt.commit,identityProof.artifact.commit);
  assert.equal(value.remoteReceipt.tree,identityProof.artifact.tree);
 });
 for(const [name,mutate] of [
  ["wrong artifact commit",v=>v.commit="f".repeat(40)],
  ["operator mislabeled as artifact",v=>v.commit=identityProof.operator.commit],
  ["wrong artifact tree",v=>v.tree="f".repeat(40)],
  ["changed remote closure",v=>v.checkerHashes={}],
  ["token transfer",v=>v.noTokenTransferred=false],
 ]) await t.test(name,()=>assert.throws(()=>invoke(mutate)));
 await t.test("public clone cannot authorize identity mode",()=>assert.throws(()=>invoke(()=>{},{identityProof:publicIdentityProof(identityProof)})));
 await t.test("wrong repository refuses before transport",()=>{
  let ran=false;assert.throws(()=>invoke(()=>{},{root:"/tmp",run:()=>{ran=true;}}));assert.equal(ran,false);
 });
 await t.test("wrong operator refuses before transport",()=>{
  let ran=false;assert.throws(()=>invoke(()=>{},{collect:()=>({...local,commit:"f".repeat(40)}),run:()=>{ran=true;}}));assert.equal(ran,false);
 });
 await t.test("typed local collection discards Git and PATH injection",()=>{
  let calls=0;
  invoke(()=>{},{env:{...env,PATH:"/untrusted",GIT_DIR:"/wrong",GIT_WORK_TREE:"/wrong",GIT_CONFIG_COUNT:"99",GIT_CONFIG_KEY_0:"alias.status"},collect:(_root,received)=>{
   calls++;assert.equal(received.PATH,"/usr/bin:/bin");assert.equal(received.GIT_DIR,undefined);assert.equal(received.GIT_WORK_TREE,undefined);
   assert.equal(received.GIT_NO_REPLACE_OBJECTS,"1");assert.equal(received.GIT_CONFIG_COUNT,"2");assert.equal(received.GIT_CONFIG_KEY_0,"core.fsmonitor");
   return local;
  },run:(_exe,_args,opts)=>{const request=JSON.parse(opts.input);return {status:0,stdout:JSON.stringify({...reply(opts.input),commit:request.commit,tree:request.tree,checkerHashes:request.hashes})};}});
  assert.equal(calls,2);
 });
 await t.test("local changes after transport refuse",()=>{
  let calls=0;assert.throws(()=>invoke(()=>{},{collect:()=>++calls===1?local:{...local,hashes:{}}}),/Local source changed/);
 });
 await t.test("protected environment override refuses before transport",()=>{
  let ran=false;assert.throws(()=>invoke(()=>{},{env:{...env,POW_INTERNAL_VERIFIER_TOKEN:"synthetic"},run:()=>{ran=true;}}));assert.equal(ran,false);
 });
});
