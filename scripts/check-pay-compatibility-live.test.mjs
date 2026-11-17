import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const source=readFileSync(new URL('./check-pay-compatibility-live.mjs',import.meta.url),'utf8');
test('composition invokes real current activity, linked, Growth and Pay',()=>{for(const value of ['await runPayLive','check-publish-linked-live.mjs','check-current-growth-live.mjs','await runActivityFeeFactorLive({currentVerifierProof:proof})','publicVerificationEnvironment(env)','timeout:600000','child.error||child.signal||child.status!==0'])assert(source.includes(value),value);});
test('composition never self-approves or claims stock CLI passed',()=>{for(const value of ['rootReviewed:false','stockR3CliPassed:false','stockReleaseSyncPassed:false','nativeGateValidatesDualIdentity:false','realSignedPaymentExercised:false'])assert(source.includes(value));assert(!source.includes('rootReviewed:true'));});
test('final authentic proof fence is after successful actual Pay result',()=>assert(source.indexOf('const identity=publicCurrentVerifierProof(proof)')>source.indexOf('assert.equal(result.ok,true)')));
test('entry rejects caller environment before any checker runs',async()=>{const {runPayCompatibilityLive}=await import('./check-pay-compatibility-live.mjs');for(const name of ['NODE_OPTIONS','NODE_PATH','POW_INTERNAL_VERIFIER_TOKEN','POW_PUBLISH_CHECK_ORIGIN','POW_PUBLISH_CHECK_NODE_SOURCE','POW_PUBLISH_CHECK_MODE','POW_API_BASE']){const before=process.env[name];process.env[name]='fixture-unapproved';try{await assert.rejects(runPayCompatibilityLive({verifierRepository:process.cwd()}),/Unapproved|override|must remain|execution flags/);}finally{if(before===undefined)delete process.env[name];else process.env[name]=before;}}});
test('Activity rejects mixed current and historical identities without reads',async()=>{const {runActivityFeeFactorLive}=await import('./check-activity-fee-factor-live.mjs');await assert.rejects(runActivityFeeFactorLive({currentVerifierProof:{},identityProof:{}}),/cannot mix/);await assert.rejects(runActivityFeeFactorLive({currentVerifierProof:{},lifecycleWitness:{}}),/cannot mix/);await assert.rejects(runActivityFeeFactorLive({currentVerifierProof:{}}),/Authentic/);});

test('spec bytes must match separately reviewed hash before parsing',async()=>{const {parseReviewedVerifierSpec}=await import('./check-pay-compatibility-live.mjs');const {createHash}=await import('node:crypto');const raw=Buffer.from('{"artifactRepository":"fixture"}');const hash=createHash('sha256').update(raw).digest('hex');assert.deepEqual(parseReviewedVerifierSpec(raw,hash),{artifactRepository:'fixture'});assert.throws(()=>parseReviewedVerifierSpec(Buffer.concat([raw,Buffer.from(' ')]),hash),/bytes changed/);assert.throws(()=>parseReviewedVerifierSpec(raw,'0'.repeat(64)),/bytes changed/);assert.throws(()=>parseReviewedVerifierSpec(raw,'invalid'),/SHA256/);assert.throws(()=>parseReviewedVerifierSpec(Buffer.alloc(65537),hash),/Bounded/);});

test('unchanged Growth provenance uses artifact script and cwd despite distinct verifier HEAD',async()=>{
 const {artifactChildInvocation}=await import('./check-pay-compatibility-live.mjs');
 const {mkdtempSync,mkdirSync,writeFileSync,rmSync}=await import('node:fs');
 const {tmpdir}=await import('node:os');const {join}=await import('node:path');
 const {execFileSync,spawnSync}=await import('node:child_process');
 const base=mkdtempSync(join(tmpdir(),'pay-artifact-route-')),artifact=join(base,'artifact'),verifier=join(base,'verifier');
 const gitEnv={PATH:'/usr/bin:/bin',HOME:'/nonexistent',GIT_CONFIG_NOSYSTEM:'1',GIT_CONFIG_GLOBAL:'/dev/null'};
 const git=(root,...args)=>execFileSync('/usr/bin/git',['-C',root,...args],{env:gitEnv,encoding:'utf8'}).trim();
 try{
  mkdirSync(artifact);mkdirSync(join(artifact,'scripts'));
  const original=readFileSync(new URL('./check-current-growth-live.mjs',import.meta.url));
  writeFileSync(join(artifact,'scripts/check-current-growth-live.mjs'),original);
  git(artifact,'init','-q');git(artifact,'add','.');git(artifact,'-c','user.name=Fixture','-c','user.email=fixture@example.invalid','commit','-qm','artifact');
  const artifactCommit=git(artifact,'rev-parse','HEAD');
  execFileSync('/usr/bin/git',['clone','-q',artifact,verifier],{env:gitEnv});
  writeFileSync(join(verifier,'verifier-only.txt'),'separate verifier identity');git(verifier,'add','.');git(verifier,'-c','user.name=Fixture','-c','user.email=fixture@example.invalid','commit','-qm','verifier');
  const verifierCommit=git(verifier,'rev-parse','HEAD');assert.notEqual(verifierCommit,artifactCommit);
  const preload=join(base,'fixture-fetch.mjs');
  function serve(commit){writeFileSync(preload,`globalThis.fetch=async input=>{const p=new URL(input).pathname;let body;if(p==='/source-provenance.json')body=JSON.stringify({commit:${JSON.stringify(commit)},trackedDirty:false});else if(p==='/')body='<script type="module" src="/assets/index-test.js"></script>';else if(p==='/assets/index-test.js')body="'./App-test.js'";else if(p==='/assets/App-test.js')body='2026-11-12-products-v2 Current products October comparison Illustrative fee rate historical assumption was 0.00001';else if(p==='/api/v1/growth-summary'||p==='/api/v1/work-floor')body=JSON.stringify({snapshotId:'fixture',indexedThroughBlockHash:'fixture-hash',actualValue:{liveNetworkValueQ8:'1',liveTotalQ8:'2'}});else throw new Error('Unexpected fixture request '+p);return new Response(body,{status:200});};`);}
  serve(artifactCommit);
  const invocation=artifactChildInvocation({artifact:{repository:artifact}},'check-current-growth-live.mjs',gitEnv);
  assert.equal(invocation.args[0],join(artifact,'scripts/check-current-growth-live.mjs'));assert.equal(invocation.options.cwd,artifact);
  assert.deepEqual(readFileSync(invocation.args[0]),original,'Actual Growth script bytes must stay unchanged');
  const execute=(options=invocation.options)=>spawnSync(invocation.command,['--import',preload,...invocation.args],options);
  const good=execute();assert.equal(good.status,0,good.stderr.toString());assert.equal(JSON.parse(good.stdout).commit,artifactCommit);
  const wrongCwd=execute({...invocation.options,cwd:verifier});assert.notEqual(wrongCwd.status,0);assert.match(wrongCwd.stderr.toString(),/AssertionError/);
  serve(verifierCommit);const wrongServed=execute();assert.notEqual(wrongServed.status,0);assert.match(wrongServed.stderr.toString(),/AssertionError/);
 }finally{rmSync(base,{recursive:true,force:true});}
});
test('failed child retains bounded actual diagnostics and hashes without raw history dump',async()=>{
 const {artifactChildInvocation,requireSuccessfulArtifactChild}=await import('./check-pay-compatibility-live.mjs');const {createHash}=await import('node:crypto');
 const call=artifactChildInvocation({artifact:{repository:'/fixture/artifact'}},'check-current-growth-live.mjs',{});
 const stderr=Buffer.from('x'.repeat(10000)+'exact fixture assertion'),stdout=Buffer.from('private prior output');
 assert.throws(()=>requireSuccessfulArtifactChild('check-current-growth-live.mjs',{status:1,signal:null,stdout,stderr},call),error=>{const r=error.failureReport;assert.equal(r.ok,false);assert.equal(r.rootReviewed,false);assert.equal(r.cwd,'/fixture/artifact');assert.equal(r.stderr.sha256,createHash('sha256').update(stderr).digest('hex'));assert.equal(Buffer.from(r.stderr.tailBase64,'base64').length,8192);assert.equal(r.stderr.truncated,true);assert(!Object.hasOwn(r.stdout,'base64'));assert(Buffer.from(r.stderr.tailBase64,'base64').toString().endsWith('exact fixture assertion'));return true;});
 for(const child of [{status:null,signal:'SIGTERM'},{status:null,error:{code:'ETIMEDOUT'}}])assert.throws(()=>requireSuccessfulArtifactChild('check-current-growth-live.mjs',child,call),/incomplete/);
});
