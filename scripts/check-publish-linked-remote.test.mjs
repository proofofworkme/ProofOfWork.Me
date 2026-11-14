import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, existsSync, symlinkSync, renameSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve, dirname, posix } from "node:path";
import { fileURLToPath } from "node:url";
import { publishCheckerFiles, validateNodeBuildSource, localPublishSource, publicVerificationEnvironment,
  remotePreactivationProgram, runRemotePublishPreactivation, assertPublishCheckerClosure, validateRemoteFailure } from "./check-publish-linked-remote.mjs";
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

const canonical=value=>JSON.stringify(value,function(_key,item){return item&&typeof item==="object"&&!Array.isArray(item)?Object.fromEntries(Object.keys(item).sort().map(k=>[k,item[k]])):item;});
function diagnostic(request,changes={}) {
 return {format:"publish-linked-remote-failure-v1",ok:false,unit:request.unit,commit:request.commit,tree:request.tree,source:request.source,
 outcome:"failed",code:"READINESS_NOT_VERIFIED",checkerExitCode:1,
 terminal:{loadState:"not-found",activeState:"inactive",mainPid:0,cgroupAbsent:true,verified:true},
 checks:[],unknownCheckCount:0,stdoutStatus:"valid",httpStatus:null,sourceFenceVerified:true,...changes};
}
test("nonzero child safe diagnostic survives CLI message without becoming success",()=>{
 let error;
 try{execute(()=>{},{run:(_exe,_args,opts)=>({status:1,stdout:canonical(diagnostic(JSON.parse(opts.input))),stderr:"SECRET_NOT_FOR_OUTPUT"})});}catch(e){error=e;}
 assert.equal(error.name,"RemotePreactivationFailure");assert.equal(error.diagnostic.code,"READINESS_NOT_VERIFIED");
 assert(error.message.includes('"checks":[]'));assert(!error.message.includes("SECRET_NOT_FOR_OUTPUT"));
 assert.match(error.message,/reconcile pow-linked-verify-/);
});
for(const [name,change] of [
 ["wrong unit",d=>d.unit="other"],["wrong commit",d=>d.commit="f".repeat(40)],
 ["freeform error",d=>d.error="SECRET"],["unknown check",d=>d.checks=[{name:"SECRET",pass:false}]],
 ["duplicate check",d=>d.checks=Array(2).fill({name:"complete article feed",pass:true})],
 ["bad exit",d=>d.checkerExitCode="SECRET"],["unsafe terminal",d=>d.terminal.activeState="SECRET"],
 ["false stopped",d=>d.terminal.mainPid=5],["bad code",d=>d.code="SECRET"],
 ["bad HTTP",d=>d.httpStatus=999],["bad count",d=>d.unknownCheckCount=9],
])test("untrusted failure diagnostic refuses "+name,()=>{
 assert.throws(()=>execute(()=>{},{run:(_exe,_args,opts)=>{const d=diagnostic(JSON.parse(opts.input));change(d);return {status:1,stdout:canonical(d),stderr:"SECRET"};}}),e=>e.name!=="RemotePreactivationFailure"&&!e.message.includes("SECRET"));
});
test("duplicate JSON fields, truncation and oversized failures never echo input",()=>{
 const req={unit:"unit",commit:binding.commit,tree:binding.tree,source},raw=canonical(diagnostic(req));
 for(const text of [raw.replace('"ok":false','"ok":true,"ok":false'),raw.slice(0,-1),"SECRET".repeat(4000),"null","true","false","[]","42",'"text"',raw.replace('"ok":false','"ok":true,"\\u006fk":false')])
  assert.throws(()=>validateRemoteFailure(text,req));
 for(const transport of [{error:new Error("SECRET")},{signal:"SIGTERM"}])
  assert.throws(()=>execute(()=>{},{run:(_e,_a,o)=>({status:1,stdout:canonical(diagnostic(JSON.parse(o.input))),...transport})}),e=>e.name!=="RemotePreactivationFailure"&&!e.message.includes("SECRET"));
});
test("known false/null statuses preserved; missing checks never fabricated",()=>{
 const req={unit:"unit",commit:binding.commit,tree:binding.tree,source};
 const d=diagnostic(req,{checks:[{name:"complete article feed",pass:false},{name:"existing article detail",pass:null}],unknownCheckCount:1});
 assert.deepEqual(validateRemoteFailure(canonical(d),req).checks,d.checks);
});
test("node diagnostic sanitizer, terminal paths and bounded capture use no live services",()=>{
 const program=String.raw`
import ast,contextlib,hashlib,io,json,os,pathlib,re,subprocess,sys,unittest
source=sys.stdin.read();nodes=ast.parse(source).body
selected=[n for n in nodes if isinstance(n,ast.FunctionDef) and n.name in ('sanitize_failure','capture_probe','terminal_state') or isinstance(n,ast.Assign) and any(isinstance(t,ast.Name) and t.id in ('CHECK_NAMES','ERROR_CODES') for t in n.targets)]
scope=dict(globals());exec(compile(ast.Module(body=selected,type_ignores=[]),'<diagnostics>','exec'),scope)
safe=scope['sanitize_failure']
def payload(error='Disabled-writer preactivation readiness is not fully verified.',checks=None):
 return json.dumps(dict(mode='preactivation',newLinkedWriteVerified=False,checks=[] if checks is None else checks,error=error)).encode()
secret='SYNTHETIC_SECRET_DO_NOT_EMIT'
for bad in (b'{',b'[]',b'null',b'true',b'false',b'42',b'"text"',b'\xff',b'{"mode":"x","mode":"preactivation"}',b'{"mode":"x","\\u006dode":"preactivation"}'):
 assert safe(bad)[0]['stdoutStatus']=='invalid'
for checks in ([{'name':'complete article feed','pass':True}]*2,[{'name':'complete article feed','pass':1}]):
 assert safe(payload(checks=checks))[0]['stdoutStatus']=='invalid'
v,_=safe(payload(secret,[{'name':secret,'pass':False},{'name':'complete article feed','pass':False}]))
assert secret not in json.dumps(v) and v['unknownCheckCount']==1 and v['checks']==[{'name':'complete article feed','pass':False}]
assert safe(payload('Read unavailable: 503'))[0]['httpStatus']==503
assert safe(payload('Read unavailable: 503 '+secret))[0]['httpStatus'] is None
assert safe(payload())[0]['checkerCode']=='READINESS_NOT_VERIFIED'
assert safe(b'x'*(2*1024**2+1))[0]['stdoutStatus']=='oversized'
assert safe(b'')[0]['stdoutStatus']=='missing'
capture=scope['capture_probe']
code,raw,overflow,timed=capture([sys.executable,'-I','-c','import sys;sys.stdout.write("x"*(3*1024**2));sys.stderr.write("'+secret+'");sys.exit(1)'],{'PATH':'/usr/bin:/bin'},5)
assert code==1 and len(raw)==2*1024**2 and overflow and not timed and secret.encode() not in raw
code,raw,overflow,timed=capture([sys.executable,'-I','-c','import time;time.sleep(5)'],{'PATH':'/usr/bin:/bin'},0.05)
assert timed and code is not None
# Execute actual remote result-handling block with only in-memory fixture services.
start=next(i for i,n in enumerate(nodes) if isinstance(n,ast.Try) and any(isinstance(x,ast.Assign) and isinstance(x.value,ast.Call) and isinstance(x.value.func,ast.Name) and x.value.func.id=='capture_probe' for x in n.body))
tail=compile(ast.Module(body=nodes[start:],type_ignores=[]),'<result>','exec')
terminal=dict(loadState='not-found',activeState='inactive',mainPid=0,cgroupAbsent=True,verified=True)
request=dict(unit='pow-linked-verify-'+('a'*12)+'-'+('b'*12)+'.service',commit='a'*40,tree='b'*40,source='/fixture',hashes={})
for exit_code,stdout,timeout,endstate,sourceok,expected in [
 (1,payload(),False,terminal,True,'READINESS_NOT_VERIFIED'),
 (1,b'{',False,terminal,True,'CHECKER_OUTPUT_INVALID'),
 (1,b'',False,terminal,True,'CHECKER_OUTPUT_MISSING'),
 (0,payload(secret),False,terminal,True,'CHECKER_REPORTED_ERROR'),
 (1,payload(),True,terminal,True,'PROBE_TIMEOUT'),
 (1,payload(),False,{**terminal,'verified':False,'activeState':'active','mainPid':123},True,'TERMINAL_UNVERIFIED'),
 (0,json.dumps(dict(mode='preactivation',checks=[],newLinkedWriteVerified=False)).encode(),False,terminal,False,'SOURCE_FENCE_FAILED'),
]:
 def fence():
  if not sourceok:raise ValueError(secret)
 local={**scope,'capture_probe':lambda *a:(exit_code,stdout,False,timeout),'terminal_state':lambda:endstate,'argv':[],'environment':{},'unit':request['unit'],'source':pathlib.Path('/fixture'),'request':request,'receipt_raw':b'fixed','read':lambda p:b'fixed','fence':fence,'need':lambda ok,msg:None if ok else (_ for _ in ()).throw(ValueError(msg))}
 out=io.StringIO()
 with contextlib.redirect_stdout(out):
  try:exec(tail,local)
  except SystemExit as e:assert e.code==1
  else:raise AssertionError('failure returned success')
 result=json.loads(out.getvalue());assert result['code']==expected and result['ok'] is False
 assert secret not in out.getvalue() and len(out.getvalue())<16384
 assert result['terminal']==endstate
# A launch error never leaks its message; terminal uncertainty remains explicit.
def launch_error(*args):raise OSError(secret)
local={**scope,'capture_probe':launch_error,'terminal_state':lambda:{**terminal,'verified':False,'activeState':'unknown','mainPid':None},'argv':[],'environment':{},'unit':request['unit'],'source':pathlib.Path('/fixture'),'request':request}
out=io.StringIO()
with contextlib.redirect_stdout(out):
 try:exec(tail,local)
 except SystemExit as e:assert e.code==1
 else:raise AssertionError('launch failure returned success')
result=json.loads(out.getvalue())
assert result['outcome']=='uncertain' and result['code']=='TERMINAL_UNVERIFIED'
assert result['stdoutStatus']=='missing' and result['checkerExitCode'] is None and result['sourceFenceVerified'] is False
assert secret not in out.getvalue()
# Terminal helper handles failed/active/unknown states without leaking raw fields.
from unittest.mock import patch
scope['unit']=request['unit']
for text,present,verified in [
 ('LoadState=not-found\nActiveState=inactive\nMainPID=0\n',False,True),
 ('LoadState=loaded\nActiveState=active\nMainPID=42\n',True,False),
 ('LoadState='+secret+'\nActiveState='+secret+'\nMainPID='+secret+'\n',False,False),
]:
 with patch.object(subprocess,'check_output',return_value=text),patch.object(pathlib.Path,'exists',return_value=present):
  state=scope['terminal_state']();assert state['verified']==verified and secret not in json.dumps(state)
with patch.object(subprocess,'check_output',side_effect=subprocess.TimeoutExpired('fixture',15)):
 assert scope['terminal_state']()['verified'] is False
# Successful path preserves the old receipt format and exact original checker stdout.
good=json.dumps(dict(mode='preactivation',checks=[{'name':'complete article feed','pass':True}],newLinkedWriteVerified=False)).encode()
local={**scope,'capture_probe':lambda *a:(0,good,False,False),'terminal_state':lambda:terminal,'argv':[],'environment':{},'unit':request['unit'],'source':pathlib.Path('/fixture'),'request':request,'receipt_raw':b'fixed','read':lambda p:b'fixed','fence':lambda:None,'need':lambda ok,msg:None if ok else (_ for _ in ()).throw(ValueError(msg)),'digest':lambda raw:hashlib.sha256(raw).hexdigest()}
out=io.StringIO()
with contextlib.redirect_stdout(out):exec(tail,local)
result=json.loads(out.getvalue());assert result['format']=='publish-linked-remote-preactivation-v1' and result['ok'] is True and result['rawResult']==good.decode()
print('sanitizer, bounded capture, terminal, success and failure branches passed')
`;
 execFileSync("python3",["-I","-B","-c",program],{input:remotePreactivationProgram,timeout:15000});
});
