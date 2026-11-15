// Synthetic Git/SSH transport only. The protected-filesystem fixture separately
// exercises actual package blobs, installed Runtime, raw collection and replay.
import test from "node:test";
import assert from "node:assert/strict";
import childProcess from "node:child_process";
import {syncBuiltinESMExports} from "node:module";
import {fileURLToPath} from "node:url";
import {realpathSync} from "node:fs";

test("current authority requires clean exact source, independent package attestation and branded collection",async()=>{
 const original=childProcess.execFileSync,repository=realpathSync(fileURLToPath(new URL("../",import.meta.url)));
 const commit="a".repeat(40),tree="b".repeat(40),historical="c".repeat(64),anchor={path:"/var/backups/proofofwork-ui/cleanup-evidence/older-backup-retirement-6fd05dc1e04e/successor-config.json",sha256:"d".repeat(64)};
 let mutation="",packageHash,collections=0,validations=0;
 childProcess.execFileSync=(command,args,options)=>{
  if(command==="/usr/bin/git") {
   const index=args.indexOf(repository);assert(index>=0);const op=args.slice(index+1);
   if(op[0]==="rev-parse")return op[1]==="HEAD"?(mutation==="head"?"f".repeat(40):commit):op[1]==="HEAD^{tree}"?tree:"false";
   if(op[0]==="status")return mutation==="dirty"?" M scripts/retirement-evidence.mjs":"";
   if(op[0]==="ls-tree")return (mutation==="untracked-validator"&&op.at(-1)==="scripts/retirement-current-evidence.py")?"":`100644 blob ${"e".repeat(40)}\t${op.at(-1)}\n`;
   if(op[0]==="show")return Buffer.from(op[1]+"\n");
   throw new Error("Unexpected Git operation");
  }
  if(command==="/usr/bin/ssh") {
   assert(args.includes("StrictHostKeyChecking=yes"));assert(args.includes("root@77.42.91.106"));
   const request=JSON.parse(options.input);
   if(request.expected) {
    packageHash=request.expected.sha256;
    return JSON.stringify({mode:"operator-retirement-package",configSha256:"1".repeat(64),currentPackageSha256:mutation==="package"?historical:packageHash,policyCodeSha256:historical,retirementSourceConfig:mutation==="anchor"?{...anchor,path:"/tmp/untrusted.json"}:anchor,operator:{commit,tree}});
   }
   collections++;assert.equal(request.trusted.currentPackageSha256,packageHash);assert.equal(request.trusted.policyCodeSha256,historical);
   assert.deepEqual(request.trusted.retirementSourceConfig,anchor);assert(args.at(-1).includes("lifecycleEvidence"));
   return JSON.stringify({synthetic:"current raw evidence"});
  }
  assert.equal(command,"/usr/bin/python3");assert.deepEqual(args,["-I","-B",fileURLToPath(new URL("./retirement-current-evidence.py",import.meta.url))]);
  const request=JSON.parse(options.input);assert.deepEqual(request.bundle,{synthetic:"current raw evidence"});
  validations++;return JSON.stringify({proof:life.verifiedRetiredPayloads,verifiedCurrentPair:life.pair,filesystemVerified:false,activationAllowed:false});
 };
 syncBuiltinESMExports();
 let life;
 try {
  const api=await import("./retirement-evidence.mjs");
  for(mutation of ["dirty","head","untracked-validator","package","anchor"])assert.throws(()=>api.attestCurrentRetentionPackage({repository,commit,tree}));
  mutation="";const attestation=api.attestCurrentRetentionPackage({repository,commit,tree});
  assert(Object.isFrozen(attestation)&&Object.isFrozen(attestation.operator)&&Object.isFrozen(attestation.retirementSourceConfig));
  assert.notEqual(attestation.currentPackageSha256,attestation.policyCodeSha256);
  const pair={current:"aaaaaaaaaaaa-20261114T000000Z",previous:"bbbbbbbbbbbb-20261113T000000Z"};
  life={publicationHealthy:true,retentionComplete:true,pending:null,unfinishedIntents:[],pair,
   configSha256:attestation.configSha256,stateSha256:"2".repeat(64),index:{path:"/var/backups/proofofwork-ui/cleanup-evidence/audit30-policy-admission-index-test.json",sha256:"3".repeat(64)},
   verifiedRetirementPolicyCodeSha256:historical,verifiedCurrentPackageSha256:packageHash,verifiedRetirementSourceConfig:anchor,
   verifiedRetiredPayloads:{model:"intentionally-retired-payloads-retained-evidence-v1",policyCodeSha256:historical},verifiedRetirementCurrentPair:pair,
   binding:{config:{path:"/etc/proofofwork-retention/ui-lifecycle.json",sha256:attestation.configSha256},state:{path:"/var/lib/proofofwork-ui-retention/state.json",sha256:"2".repeat(64)},pair}};
  assert.throws(()=>api.collectCurrentRetirementEvidence(life,{...attestation}),/Authenticated current package/);
  assert.deepEqual(api.collectCurrentRetirementEvidence(life,attestation),{synthetic:"current raw evidence"});
  assert.equal(collections,1);assert.equal(validations,1);
  mutation="dirty";assert.throws(()=>api.collectCurrentRetirementEvidence(life,attestation));assert.equal(collections,1);
 }finally{childProcess.execFileSync=original;syncBuiltinESMExports()}
});
