import test from "node:test";
import assert from "node:assert/strict";
import {execFileSync} from "node:child_process";
import {readFileSync} from "node:fs";
import {retirementTrust,validateRetainedHolds,validateRetirementEvidence,retirementReadProgram,retentionPackageFiles,expectedRetentionPackage,installedRetentionProgram,attestInstalledRetentionPackage,bindInstalledRetentionPackage} from "./retirement-evidence.mjs";
const pair={current:"064b6991ae2a-20261114T020148Z",previous:"e2669bc1fd32-20261112T163804Z"};
const trusted=()=>({publicationHealthy:true,retentionComplete:true,pending:null,unfinishedIntents:[],pair,
 configSha256:"a".repeat(64),stateSha256:"b".repeat(64),index:{path:"/var/backups/proofofwork-ui/cleanup-evidence/index.json",sha256:"c".repeat(64)},
 verifiedRetirementPolicyCodeSha256:"d".repeat(64),verifiedRetiredPayloads:{model:"intentionally-retired-payloads-retained-evidence-v1"},
 binding:{config:{path:"/etc/proofofwork-retention/ui-lifecycle.json",sha256:"a".repeat(64)},state:{path:"/var/lib/proofofwork-ui-retention/state.json",sha256:"b".repeat(64)},pair}});
test("trust inputs bind fresh lifecycle config, state, index, code and pair without minting authority",()=>{
 const t=retirementTrust(trusted());assert.deepEqual(Object.keys(t).sort(),["configSha256","stateSha256","currentIndexSha256","policyCodeSha256","verifiedCurrentPair"].sort());assert.equal(t.activationAllowed,undefined);
});
for(const [name,change] of [
 ["pending",v=>v.pending={}],["unfinished",v=>v.unfinishedIntents=["x"]],["unhealthy",v=>v.publicationHealthy=false],
 ["incomplete",v=>v.retentionComplete=false],["fake code",v=>delete v.verifiedRetirementPolicyCodeSha256],
 ["config path",v=>v.binding.config.path="/tmp/config"],["state path",v=>v.binding.state.path="/tmp/state"],
 ["config mismatch",v=>v.configSha256="f".repeat(64)],["state mismatch",v=>v.stateSha256="f".repeat(64)],
 ["pair mismatch",v=>v.binding.pair={current:"wrong",previous:"wrong"}],["missing model",v=>delete v.verifiedRetiredPayloads],
])test("reject "+name,()=>{const v=trusted();change(v);assert.throws(()=>retirementTrust(v));});
test("in-place exact historical holds retain their original branch",()=>{
 const v={verifiedPreservedRelease1042:{releaseId:"1042efea2aa1-20261112T074918Z"},verifiedPreservedFallback:{releaseId:"c3969c39c2b2-20261101T051206Z"}};
 assert.deepEqual(validateRetainedHolds(v),{mode:"verified-in-place-holds"});
 assert.throws(()=>validateRetainedHolds({...v,verifiedRetiredPayloads:{model:"intentionally-retired-payloads-retained-evidence-v1"}}));
 assert.throws(()=>validateRetainedHolds(v,{}));
 for(const key of Object.keys(v)) {const missing={...v};delete missing[key];assert.throws(()=>validateRetainedHolds(missing));}
});
test("bare absence, boolean and fake raw evidence cannot become retirement proof",()=>{
 assert.throws(()=>validateRetainedHolds({}));assert.throws(()=>validateRetainedHolds({...trusted(),verifiedRetiredPayloads:true},{}));
 assert.throws(()=>validateRetirementEvidence({},trusted()));
});
test("raw evidence bounds checked before process validation",()=>assert.throws(()=>validateRetirementEvidence({excess:"x".repeat(16*1024**2)},trusted()),/bound/));
test("fixed reader is syntactically valid and has no write or injected destination operations",()=>{
 execFileSync("/usr/bin/python3",["-I","-B","-c","import ast,sys; ast.parse(sys.stdin.read())"],{input:retirementReadProgram,env:{PATH:"/usr/bin:/bin",HOME:"/nonexistent"}});
 for(const required of ["O_NOFOLLOW","O_NOATIME","before.st_nlink==1","before.st_uid==before.st_gid==0","state['index']","trusted['currentIndexSha256']","16*1024**2","Evidence changed during collection"])assert(retirementReadProgram.includes(required));
 assert(!/\b(?:unlink|rmtree|chmod|chown|rename|write_text|write_bytes)\s*\(/u.test(retirementReadProgram));
 const source=readFileSync(new URL("./retirement-evidence.mjs",import.meta.url),"utf8");
 assert(source.includes('"root@77.42.91.106"'));assert(source.includes('"StrictHostKeyChecking=yes"'));
});

test("exact operator package scope rejects foreign entries and fake capabilities",()=>{
 const operator={commit:"a".repeat(40),tree:"b".repeat(40)};
 const blobs=Object.fromEntries(retentionPackageFiles.map(p=>[p,Buffer.from(p+"\n")]));
 const expected=expectedRetentionPackage(operator,blobs);
 assert.equal(expected.manifest.sourceCommit,operator.commit);
 assert.equal(expected.manifest.sourceTree,operator.tree);
 for(const change of [b=>delete b[retentionPackageFiles[0]],b=>b["foreign.py"]=Buffer.from("x"),b=>b[retentionPackageFiles[0]]=Buffer.alloc(0)]) {
  const copy={...blobs};change(copy);assert.throws(()=>expectedRetentionPackage(operator,copy));
 }
 assert.throws(()=>attestInstalledRetentionPackage({operator,repository:"/tmp"}));
 const life={configSha256:"a".repeat(64),verifiedRetirementPolicyCodeSha256:expected.sha256,verifiedRetiredPayloads:{},pair:{current:"064b6991ae2a-20261114T020148Z"}};
 const att={mode:"operator-retirement-package",configSha256:life.configSha256,policyCodeSha256:expected.sha256};
 bindInstalledRetentionPackage(life,att);assert.equal(life.pair.current,"064b6991ae2a-20261114T020148Z");
 assert.throws(()=>bindInstalledRetentionPackage({...life,verifiedRetirementPolicyCodeSha256:"f".repeat(64)},att));
 assert.throws(()=>bindInstalledRetentionPackage(life,{...att,mode:"legacy-in-place"}));
});
function runProtectedPackageFixture(nonRootRejection = false) {
 const operator={commit:"a".repeat(40),tree:"b".repeat(40)};
 const expected=expectedRetentionPackage(operator,Object.fromEntries(retentionPackageFiles.map(p=>[p,Buffer.from(p+"\n")])));
 const program=String.raw`
import contextlib,io,json,os,pathlib,sys,tempfile
r=json.load(sys.stdin)
for case in (('valid',) if r['nonRootRejection'] else ('valid','commit','tree','hash','extra','bytes','path','pending','symlink','duplicate','legacy')):
 with tempfile.TemporaryDirectory(prefix='pow-package-fixture-') as tmp:
  root=pathlib.Path(tmp);root.chmod(0o700);package=root/'package';package.mkdir()
  expected={**r['expected'],'path':str(package)};manifest=expected['manifest'];cp=root/'config.json'
  for name in manifest['files']:
   p=package/name;p.parent.mkdir(parents=True,exist_ok=True);p.write_text(name+'\n');p.chmod(0o600)
  # Keep fixture permissions independent of the caller's umask.
  package.chmod(0o700)
  for directory in package.rglob('*'):
   if directory.is_dir():directory.chmod(0o700)
  (package/'package.json').write_text(expected['manifestRaw']);(package/'package.json').chmod(0o600)
  config={'schema':'pow-ui-retention-lifecycle-config-v1','sourceCommit':manifest['sourceCommit'],'sourceTree':manifest['sourceTree'],'package':{'path':str(package),'sha256':expected['sha256']},'controller':{'path':str(package/'deploy/ui-retention/lifecycle_remote.py'),'sha256':manifest['files']['deploy/ui-retention/lifecycle_remote.py']['sha256']},'payloadRetirement':{'mode':'complete','policyCodeSha256':expected['sha256']}}
  if case=='commit':config['sourceCommit']='c'*40
  if case=='tree':config['sourceTree']='c'*40
  if case=='hash':config['package']['sha256']='c'*64
  if case=='path':config['package']['path']=str(root/'foreign')
  if case=='pending':config['payloadRetirement']['mode']='pending'
  if case=='extra':(package/'foreign.py').write_text('do not execute')
  if case=='bytes':(package/'deploy/ui-retention/lifecycle.py').write_text('altered')
  if case=='symlink':
   p=package/'deploy/ui-retention/lifecycle.py';p.unlink();p.symlink_to(cp)
  if case=='legacy':del config['payloadRetirement']
  raw=json.dumps(config)
  if case=='duplicate':raw=raw.replace('"sourceCommit":','"sourceCommit":"c", "sourceCommit":')
  cp.write_text(raw);cp.chmod(0o600)
  code=r['program'].replace("'/etc/proofofwork-retention/ui-lifecycle.json'",repr(str(cp)))
  # Fixture-only filesystem boundary: /tmp itself is intentionally writable.
  code=code.replace('for parent in p.parents:', 'for parent in [x for x in p.parents if x == pathlib.Path('+repr(str(root))+') or pathlib.Path('+repr(str(root))+') in x.parents]:')
  if not r['nonRootRejection']:
   # Fixture-only UID/GID namespace mapping; this does not certify real root ownership.
   # The separate non-root case runs the unchanged production ownership checks.
   assert code.count('info.st_uid==info.st_gid==0')==2
   assert code.count('before.st_uid==before.st_gid==0')==1
   code=code.replace('info.st_uid==info.st_gid==0','info.st_uid==os.getuid() and info.st_gid==os.getgid()')
   code=code.replace('before.st_uid==before.st_gid==0','before.st_uid==os.getuid() and before.st_gid==os.getgid()')
  output=io.StringIO();old=sys.stdin;sys.stdin=io.StringIO(json.dumps({'expected':expected}));failed=False
  try:
   with contextlib.redirect_stdout(output):
    try:exec(compile(code,'<package-fixture>','exec'),{})
    except SystemExit as e:
     if e.code!=0:raise
  except (AssertionError,FileNotFoundError):failed=True
  finally:sys.stdin=old
  # The separate unprivileged case must fail the unmodified root-only ownership guard.
  assert failed==(r['nonRootRejection'] or case not in ('valid','legacy')),case
  if not failed:assert json.loads(output.getvalue())['mode']==('legacy-in-place' if case=='legacy' else 'operator-retirement-package')
`;
 execFileSync("/usr/bin/python3",["-I","-B","-c",program],{input:JSON.stringify({program:installedRetentionProgram,expected,nonRootRejection}),timeout:15000});
}
const protectedFixtureIsRoot = process.getuid?.() === 0 && process.getgid?.() === 0;
test("fixture UID/GID namespace validates valid/legacy packages and rejects nine mutations", () => runProtectedPackageFixture());
test("unprivileged installed package fixture is rejected by the unchanged root-ownership guard", {
 skip: protectedFixtureIsRoot ? "Run as an unprivileged user to exercise actual ownership rejection" : false,
}, () => runProtectedPackageFixture(true));
