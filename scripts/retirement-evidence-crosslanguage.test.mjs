// Synthetic cross-language wiring only. Never a production retirement receipt.
// Pin substitutions exist solely in the spawned test Python process.
import test from "node:test";
import assert from "node:assert/strict";
import childProcess from "node:child_process";
import {syncBuiltinESMExports} from "node:module";
import {fileURLToPath} from "node:url";
const realExec=childProcess.execFileSync;
const fixturePath=fileURLToPath(new URL("../deploy/linked-publish/qualification.test.py",import.meta.url));
const validatorPath=fileURLToPath(new URL("../deploy/linked-publish/qualification.py",import.meta.url));
const fixture=JSON.parse(realExec("/usr/bin/python3",["-I","-B","-c",
 "import json,runpy,sys; m=runpy.run_path(sys.argv[1]); b,t,p=m['RetirementConsumer']().fixture(); g=m['M']['validate_dual_retirement_evidence'].__globals__; g.update(p); result=m['M']['validate_dual_retirement_evidence'](b,t); print(json.dumps({'bundle':b,'trusted':t,'pins':p,'result':result}))",fixturePath],
 {encoding:"utf8",env:{PATH:"/usr/bin:/bin",HOME:"/nonexistent"},maxBuffer:4*1024**2}));
const expectedScript="import json,runpy,sys; m=runpy.run_path(sys.argv[1]); r=json.load(sys.stdin); print(json.dumps(m['validate_dual_retirement_evidence'](r['bundle'],r['trusted'])))";
const lifecycle=()=>({
 publicationHealthy:true,retentionComplete:true,pending:null,unfinishedIntents:[],
 pair:fixture.trusted.verifiedCurrentPair,
 configSha256:fixture.trusted.configSha256,stateSha256:fixture.trusted.stateSha256,
 index:{path:fixture.bundle.currentIndex.path,sha256:fixture.trusted.currentIndexSha256},
 verifiedRetirementPolicyCodeSha256:fixture.trusted.policyCodeSha256,
 verifiedRetiredPayloads:fixture.result.proof,
 verifiedRetirementCurrentPair:fixture.result.verifiedCurrentPair,
 binding:{
  config:{path:fixture.bundle.config.path,sha256:fixture.trusted.configSha256},
  state:{path:fixture.bundle.state.path,sha256:fixture.trusted.stateSha256},
  pair:fixture.trusted.verifiedCurrentPair,
 },
});
test("synthetic JS-to-real-Python retirement wiring; no production readiness claim",async()=>{
 let calls=0;
 childProcess.execFileSync=(command,args,options)=>{
  assert.equal(command,"/usr/bin/python3","No network/other command permitted in this test");
  assert.deepEqual(args,["-I","-B","-c",expectedScript,validatorPath]);
  assert.deepEqual(options.env,{PATH:"/usr/bin:/bin",HOME:"/nonexistent"});
  calls++;
  const script=expectedScript.replace("r=json.load(sys.stdin);",
   "m['validate_dual_retirement_evidence'].__globals__.update(json.loads(sys.argv[2])); r=json.load(sys.stdin);");
  return realExec(command,["-I","-B","-c",script,validatorPath,JSON.stringify(fixture.pins)],{...options,stdio:["pipe","pipe","pipe"]});
 };
 syncBuiltinESMExports();
 try {
  const {validateRetainedHolds}=await import("./retirement-evidence.mjs");
  const result=validateRetainedHolds(lifecycle(),fixture.bundle);
  assert.equal(result.ok,true);assert.equal(result.filesystemVerified,false);assert.equal(result.activationAllowed,false);
  assert.deepEqual(result.proof,fixture.result.proof);assert.deepEqual(result.verifiedCurrentPair,fixture.trusted.verifiedCurrentPair);
  for(const mutate of [
   b=>b.terminal.base64="e30=",
   b=>b.sidecars.pop(),
   b=>b.finalProofs={},
   b=>b.state.sha256="f".repeat(64),
   b=>b.currentIndex.path="/tmp/forged.json",
  ]) {
   const bundle=structuredClone(fixture.bundle);mutate(bundle);
   assert.throws(()=>validateRetainedHolds(lifecycle(),bundle));
  }
  const changed=lifecycle();changed.verifiedRetiredPayloads={...changed.verifiedRetiredPayloads,journalHeadSha256:"f".repeat(64)};
  assert.throws(()=>validateRetainedHolds(changed,fixture.bundle));
  assert.equal(calls,7);
 } finally {
  childProcess.execFileSync=realExec;syncBuiltinESMExports();
 }
 // Production pins in a new untouched Python process must reject this fixture.
 const raw=JSON.stringify({bundle:fixture.bundle,trusted:fixture.trusted});
 assert.throws(()=>realExec("/usr/bin/python3",["-I","-B","-c",expectedScript,validatorPath],
  {input:raw,encoding:"utf8",env:{PATH:"/usr/bin:/bin",HOME:"/nonexistent"},stdio:["pipe","pipe","pipe"]}));
});
