#!/usr/bin/env node
// Explicit verifier-only qualification, never stock R3 release-sync evidence.
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {runPayLive} from './check-pay-live.mjs';
import {runActivityFeeFactorLive} from './check-activity-fee-factor-live.mjs';
import {publicVerificationEnvironment} from './check-publish-linked-remote.mjs';
import {createCurrentVerifierProof,validateCurrentVerifierProof,publicCurrentVerifierProof} from './current-verifier-proof.mjs';
const root=fileURLToPath(new URL('../',import.meta.url)).replace(/\/$/u,'');
export function parseReviewedVerifierSpec(raw,expectedSha256){
 assert(Buffer.isBuffer(raw)&&raw.length<=65536,'Bounded verifier spec bytes required');
 assert(/^[a-f0-9]{64}$/.test(expectedSha256),'Exact reviewed spec SHA256 required');
 assert.equal(createHash('sha256').update(raw).digest('hex'),expectedSha256,'Reviewed verifier spec bytes changed');
 return JSON.parse(raw.toString('utf8'));
}
export async function runPayCompatibilityLive(spec){
 assert.equal(process.cwd(),root);assert.equal(spec.verifierRepository,root);
 assert.deepEqual(process.execArgv,[],'No preload, loader or execution flags allowed');
 for(const name of ['NODE_OPTIONS','NODE_PATH','POW_INTERNAL_VERIFIER_TOKEN','POW_PUBLISH_CHECK_ORIGIN','POW_PUBLISH_CHECK_NODE_SOURCE'])assert(!process.env[name],'Unapproved verifier environment: '+name);
 assert.equal(process.env.POW_PUBLISH_CHECK_MODE,undefined,'Existing linked writer must remain released');
 assert.equal(process.env.POW_API_BASE,undefined,'Public origin cannot be overridden');
 const proof=createCurrentVerifierProof(spec),coverage=[];
 const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
 const env={...process.env,POW_PAY_CHECK_MODE:'preactivation'};
 const result=await runPayLive({env,retained:async()=>{
  validateCurrentVerifierProof(proof);
  for(const script of ['check-publish-linked-live.mjs','check-current-growth-live.mjs']){
   const childEnv=script==='check-publish-linked-live.mjs'?{...env,GIT_OPTIONAL_LOCKS:'0'}:publicVerificationEnvironment(env);
   const child=spawnSync(process.execPath,['scripts/'+script],{cwd:root,env:childEnv,stdio:['ignore','pipe','pipe'],timeout:600000,maxBuffer:1024*1024});
   assert(!child.error&&!child.signal&&child.status===0,script+' failed; compatibility qualification incomplete');coverage.push({script,exitStatus:child.status,stdout:{bytes:child.stdout.length,sha256:hash(child.stdout),base64:child.stdout.toString('base64')},stderr:{bytes:child.stderr.length,sha256:hash(child.stderr),base64:child.stderr.toString('base64')}});
  }
  // All current runtime checks and complete native lifecycle verification run.
  // There is no injected no-op or historical six-file identity mode.
  const activity=await runActivityFeeFactorLive({currentVerifierProof:proof});
  assert.equal(activity.ok,true);assert.equal(activity.retentionComplete,true);coverage.push({script:'current-activity-full-runtime-and-lifecycle',result:activity});
 }});
 assert.equal(result.ok,true);assert.equal(result.mode,'preactivation');assert.equal(result.signingExercised,false);
 const identity=publicCurrentVerifierProof(proof);
 const report={format:'pay-verifier-compatibility-report-v1',verificationMethod:'reviewed-verifier-only-repaired-history-v1',
  sourceCommit:identity.artifact.commit,identity,coverage,result,rootReviewed:false,
  limitations:{stockR3CliPassed:false,stockReleaseSyncPassed:false,nativeGateValidatesDualIdentity:false,realSignedPaymentExercised:false}};
 assert(Buffer.byteLength(JSON.stringify(report))<=1024*1024,'Compatibility report exceeds evidence limit');return report;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 try{assert.equal(process.argv.length,4,'Supply reviewed verifier identity JSON path and exact SHA256');const raw=readFileSync(process.argv[2]);const spec=parseReviewedVerifierSpec(raw,process.argv[3]);console.log(JSON.stringify(await runPayCompatibilityLive(spec)));}
 catch(error){console.error(error.message);process.exitCode=1;}
}
