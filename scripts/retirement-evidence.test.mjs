import test from "node:test";
import assert from "node:assert/strict";
import {execFileSync} from "node:child_process";
import {readFileSync} from "node:fs";
import {retirementTrust,validateRetainedHolds,validateRetirementEvidence,retirementReadProgram,retirementCurrentReadProgram,retentionPackageFiles,expectedRetentionPackage,installedRetentionProgram,attestInstalledRetentionPackage,bindInstalledRetentionPackage,collectCurrentRetirementEvidence,validateCurrentRetainedHolds} from "./retirement-evidence.mjs";
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
test("current reader adds bounded raw upgrade evidence without changing the historical reader",()=>{
 execFileSync("/usr/bin/python3",["-I","-B","-c","import ast,sys; ast.parse(sys.stdin.read())"],{input:retirementCurrentReadProgram,env:{PATH:"/usr/bin:/bin",HOME:"/nonexistent"}});
 assert(retirementReadProgram.includes("binding['policyCodeSha256']==config['package']['sha256']==trusted['policyCodeSha256']"));
 assert(!retirementReadProgram.includes("result['lifecycleEvidence']"));
 for(const required of ["trusted['currentPackageSha256']","trusted['retirementSourceConfig']","range(16)","len(lifecycle_rows)<=100","verified.json","prior-state.json"])assert(retirementCurrentReadProgram.includes(required));
 assert(!/\b(?:unlink|rmtree|chmod|chown|rename|write_text|write_bytes)\s*\(/u.test(retirementCurrentReadProgram));
 assert.throws(()=>collectCurrentRetirementEvidence(trusted(),{}),/Authenticated current package/);
 assert.throws(()=>validateCurrentRetainedHolds(trusted(),{},{}),/Authenticated current package/);
});

test("current JS package inventory exactly matches the committed installer scope and canonical Python manifest",()=>{
 const installer=new URL("../deploy/ui-retention/install_lifecycle.py",import.meta.url);
 const root=new URL("../",import.meta.url);
 const program=String.raw`import ast,hashlib,json,pathlib,sys
root=pathlib.Path(sys.argv[1]);tree=ast.parse(pathlib.Path(sys.argv[2]).read_text())
assignments=[n for n in tree.body if isinstance(n,ast.Assign) and any(isinstance(t,ast.Name) and t.id=='FILES' for t in n.targets)]
assert len(assignments)==1
paths=ast.literal_eval(assignments[0].value)
assert len(paths)==len(set(paths))==17
files={}
for name in paths:
 raw=(root/name).read_bytes()
 files[name]={'bytes':len(raw),'sha256':hashlib.sha256(raw).hexdigest()}
manifest={'schema':'pow-ui-retention-package-v1','sourceCommit':'a'*40,'sourceTree':'b'*40,'files':files}
raw=(json.dumps(manifest,sort_keys=True,separators=(',',':'))+'\n').encode()
print(json.dumps({'paths':paths,'manifest':manifest,'raw':raw.decode(),'sha256':hashlib.sha256(raw).hexdigest()}))`;
 const observed=JSON.parse(execFileSync("/usr/bin/python3",["-I","-B","-c",program,root.pathname,installer.pathname],{encoding:"utf8",timeout:15000}));
 assert.deepEqual(retentionPackageFiles,observed.paths);
 const added=["failed_prepare_repair.py","failed_prepare_review.py","reconcile_failed_prepare.py"].map(name=>"deploy/ui-retention/"+name);
 assert.deepEqual(retentionPackageFiles.slice(-3),added);
 const operator={commit:"a".repeat(40),tree:"b".repeat(40)};
 const blobs=Object.fromEntries(retentionPackageFiles.map(path=>[path,readFileSync(new URL(path,root))]));
 const expected=expectedRetentionPackage(operator,blobs);
 assert.deepEqual(expected.manifest,observed.manifest);
 assert.equal(expected.manifestRaw,observed.raw);
 assert.equal(expected.sha256,observed.sha256);
 for(const path of added) {
  const missing={...blobs};delete missing[path];assert.throws(()=>expectedRetentionPackage(operator,missing));
  const changed={...blobs,[path]:Buffer.concat([blobs[path],Buffer.from("\n# changed fixture bytes\n")])};
  assert.notEqual(expectedRetentionPackage(operator,changed).sha256,expected.sha256);
 }
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
 const life={configSha256:"a".repeat(64),verifiedRetirementPolicyCodeSha256:expected.sha256,verifiedRetiredPayloads:{policyCodeSha256:expected.sha256},pair:{current:"064b6991ae2a-20261114T020148Z"}};
 const att={mode:"operator-retirement-package",configSha256:life.configSha256,policyCodeSha256:expected.sha256,currentPackageSha256:expected.sha256,retirementSourceConfig:null};
 bindInstalledRetentionPackage(life,att);assert.equal(life.pair.current,"064b6991ae2a-20261114T020148Z");
 assert.throws(()=>bindInstalledRetentionPackage({...life,verifiedRetirementPolicyCodeSha256:"f".repeat(64)},att));
 assert.throws(()=>bindInstalledRetentionPackage(life,{...att,mode:"legacy-in-place"}));
});
test("current package attestation preserves the original retirement policy and requires its own status binding",()=>{
 const original="d".repeat(64),current="e".repeat(64),anchor={path:"/var/backups/proofofwork-ui/cleanup-evidence/older-backup-retirement-6fd05dc1e04e/successor-config.json",sha256:"c".repeat(64)};
 const life={configSha256:"a".repeat(64),verifiedRetirementPolicyCodeSha256:original,verifiedCurrentPackageSha256:current,verifiedRetirementSourceConfig:anchor,verifiedRetiredPayloads:{policyCodeSha256:original}};
 const att={mode:"operator-retirement-package",configSha256:life.configSha256,policyCodeSha256:original,currentPackageSha256:current,retirementSourceConfig:anchor};
 bindInstalledRetentionPackage(life,att);
 for(const change of [v=>delete v.verifiedCurrentPackageSha256,v=>v.verifiedCurrentPackageSha256=original,v=>v.verifiedRetirementPolicyCodeSha256=current,v=>v.verifiedRetiredPayloads.policyCodeSha256=current,v=>v.verifiedRetirementSourceConfig.sha256="f".repeat(64),v=>delete v.verifiedRetirementSourceConfig]) {
  const copy=structuredClone(life);change(copy);assert.throws(()=>bindInstalledRetentionPackage(copy,att));
 }
});
function runProtectedPackageFixture(nonRootRejection = false) {
 const operator={commit:"a".repeat(40),tree:"b".repeat(40)};
 const expected=expectedRetentionPackage(operator,Object.fromEntries(retentionPackageFiles.map(p=>[p,Buffer.from(p+"\n")])));
 const program=String.raw`
import contextlib,io,json,os,pathlib,sys,tempfile
r=json.load(sys.stdin)
for case in (('valid',) if r['nonRootRejection'] else ('valid','commit','tree','hash','extra','bytes','path','pending','symlink','duplicate','legacy','successor','source-path','source-hash','source-policy','source-binding','source-transition','source-missing','missing-anchor')):
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
  anchor=root/'successor-config.json';transition=root/'transition-completed.json'
  if case=='successor' or case.startswith('source-') or case=='missing-anchor':
   config['payloadRetirement'].update(policyCodeSha256='d'*64,receipt={'path':'/fixture/completed.json','sha256':'e'*64})
   original={'package':{'sha256':'d'*64},'payloadRetirement':dict(config['payloadRetirement'])}
   if case=='source-policy':original['package']['sha256']='f'*64
   if case=='source-binding':original['payloadRetirement']['receipt']={'path':'/fixture/foreign.json','sha256':'f'*64}
   anchor.write_text(json.dumps(original));anchor.chmod(0o600)
   config['payloadRetirementSourceConfig']={'path':str(anchor),'sha256':__import__('hashlib').sha256(anchor.read_bytes()).hexdigest()}
   transition.write_text(json.dumps({'schema':'pow-exact-payload-retirement-state-transition-v1','successorConfigSha256':config['payloadRetirementSourceConfig']['sha256'],'terminalReceipt':config['payloadRetirement']['receipt']}));transition.chmod(0o600)
   if case=='source-path':config['payloadRetirementSourceConfig']['path']=str(root/'foreign.json')
   if case=='source-hash':config['payloadRetirementSourceConfig']['sha256']='f'*64
   if case=='source-transition':transition.write_text('{}')
   if case=='source-missing':anchor.unlink()
   if case=='missing-anchor':del config['payloadRetirementSourceConfig']
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
  code=code.replace('/var/backups/proofofwork-ui/cleanup-evidence/older-backup-retirement-6fd05dc1e04e/successor-config.json',str(anchor)).replace('/var/backups/proofofwork-ui/cleanup-evidence/older-backup-retirement-6fd05dc1e04e/transition-completed.json',str(transition))
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
  assert failed==(r['nonRootRejection'] or case not in ('valid','legacy','successor')),case
  if not failed:
   result=json.loads(output.getvalue());assert result['mode']==('legacy-in-place' if case=='legacy' else 'operator-retirement-package')
   if case!='legacy':
    assert result['currentPackageSha256']==expected['sha256']
    assert result['policyCodeSha256']==('d'*64 if case=='successor' else expected['sha256'])
    assert result['retirementSourceConfig']==config.get('payloadRetirementSourceConfig')
`;
 execFileSync("/usr/bin/python3",["-I","-B","-c",program],{input:JSON.stringify({program:installedRetentionProgram,expected,nonRootRejection}),timeout:15000});
}
const protectedFixtureIsRoot = process.getuid?.() === 0 && process.getgid?.() === 0;
test("fixture UID/GID namespace validates original/successor/legacy packages and rejects package and retirement-origin mutations", () => runProtectedPackageFixture());
test("unprivileged installed package fixture is rejected by the unchanged root-ownership guard", {
 skip: protectedFixtureIsRoot ? "Run as an unprivileged user to exercise actual ownership rejection" : false,
}, () => runProtectedPackageFixture(true));


test("historical fourteen-file package remains exact and separate from current seventeen-file scope",async()=>{
 const {historicalRetentionOperatorPackagePaths:historical}=await import("./release-identity-proof.mjs");
 assert(Object.isFrozen(historical));assert.equal(historical.length,14);
 assert.deepEqual(historical,retentionPackageFiles.slice(0,14));
 const operator={commit:"a".repeat(40),tree:"b".repeat(40)};
 const old=Object.fromEntries(historical.map(path=>[path,Buffer.from(path+"\n")]));
 const current=Object.fromEntries(retentionPackageFiles.map(path=>[path,Buffer.from(path+"\n")]));
 const expected=expectedRetentionPackage(operator,old,"historical");
 assert.deepEqual(Object.keys(expected.manifest.files),historical);
 assert.throws(()=>expectedRetentionPackage(operator,old));
 assert.throws(()=>expectedRetentionPackage(operator,current,"historical"));
 assert.throws(()=>expectedRetentionPackage(operator,old,"unknown"));
 const source=readFileSync(new URL("./retirement-evidence.mjs",import.meta.url),"utf8");
 const historicalAttestation=source.slice(source.indexOf("export function attestInstalledRetentionPackage("),source.indexOf("function currentSource("));
 assert(historicalAttestation.includes("for(const path of historicalRetentionOperatorPackagePaths)"));
 assert(historicalAttestation.includes('expectedRetentionPackage(proof.operator,blobs,"historical")'));
 const proofSource=readFileSync(new URL("./release-identity-proof.mjs",import.meta.url),"utf8");
 const allowlist=proofSource.slice(proofSource.indexOf("const operatorPaths ="),proofSource.indexOf("const closurePaths ="));
 for(const path of retentionPackageFiles.slice(14))assert(!allowlist.includes(path));
});

test("historical package constructor preserves the pre-repair committed installer manifest",()=>{
 const repository=new URL("../",import.meta.url).pathname,commit="c22e585baa9ddb60aa3ce38a8a117d04a4815fe1";
 const program=String.raw`import ast,hashlib,json,subprocess,sys
root,commit=sys.argv[1:]
def git(*args): return subprocess.check_output(['/usr/bin/git','-C',root,*args])
tree=git('rev-parse',commit+'^{tree}').decode().strip()
source=ast.parse(git('show',commit+':deploy/ui-retention/install_lifecycle.py'))
paths=next(ast.literal_eval(n.value) for n in source.body if isinstance(n,ast.Assign) and any(isinstance(t,ast.Name) and t.id=='FILES' for t in n.targets))
assert len(paths)==len(set(paths))==14
blobs={p:git('show',commit+':'+p) for p in paths}
manifest={'schema':'pow-ui-retention-package-v1','sourceCommit':commit,'sourceTree':tree,'files':{p:{'bytes':len(raw),'sha256':hashlib.sha256(raw).hexdigest()} for p,raw in blobs.items()}}
raw=json.dumps(manifest,sort_keys=True,separators=(',',':'))+'\n'
print(json.dumps({'tree':tree,'blobs':{p:b.hex() for p,b in blobs.items()},'raw':raw,'sha256':hashlib.sha256(raw.encode()).hexdigest()}))
`;
 const result=JSON.parse(execFileSync("/usr/bin/python3",["-I","-B","-c",program,repository,commit],{encoding:"utf8",timeout:15000,maxBuffer:8*1024**2}));
 const blobs=Object.fromEntries(Object.entries(result.blobs).map(([path,hex])=>[path,Buffer.from(hex,"hex")]));
 const historical=expectedRetentionPackage({commit,tree:result.tree},blobs,"historical");
 assert.equal(historical.manifestRaw,result.raw);assert.equal(historical.sha256,result.sha256);
 assert.throws(()=>expectedRetentionPackage({commit,tree:result.tree},blobs));
});
