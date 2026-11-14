import assert from "node:assert/strict";
import {createHash} from "node:crypto";
import {requireIdentityProof,createIdentityProof,retentionOperatorPackagePaths} from "./release-identity-proof.mjs";
import {execFileSync} from "node:child_process";
import {fileURLToPath} from "node:url";
const env={PATH:"/usr/bin:/bin",HOME:"/nonexistent"};
const SHA=/^[a-f0-9]{64}$/u;
const configPath="/etc/proofofwork-retention/ui-lifecycle.json";
const statePath="/var/lib/proofofwork-ui-retention/state.json";
export function retirementTrust(lifecycle) {
 assert.equal(lifecycle.publicationHealthy,true);assert.equal(lifecycle.retentionComplete,true);
 assert.deepEqual(lifecycle.unfinishedIntents,[]);assert.equal(lifecycle.pending,null);
 assert.equal(lifecycle.binding?.config?.path,configPath);assert.equal(lifecycle.binding?.state?.path,statePath);
 assert.equal(lifecycle.configSha256,lifecycle.binding.config.sha256);
 assert.equal(lifecycle.stateSha256,lifecycle.binding.state.sha256);
 assert.deepEqual(lifecycle.pair,lifecycle.binding.pair);
 const result={configSha256:lifecycle.configSha256,stateSha256:lifecycle.stateSha256,
  currentIndexSha256:lifecycle.index?.sha256,policyCodeSha256:lifecycle.verifiedRetirementPolicyCodeSha256,
  verifiedCurrentPair:lifecycle.pair};
 for(const key of ["configSha256","stateSha256","currentIndexSha256","policyCodeSha256"])assert(SHA.test(result[key]),"Missing authenticated retirement binding: "+key);
 assert.equal(lifecycle.verifiedRetiredPayloads?.model,"intentionally-retired-payloads-retained-evidence-v1");
 return result;
}
export function validateRetirementEvidence(bundle,lifecycle) {
 const trusted=retirementTrust(lifecycle),raw=JSON.stringify({bundle,trusted});
 assert(Buffer.byteLength(raw)<=16*1024**2,"Retirement evidence exceeds bound");
 const validator=fileURLToPath(new URL("../deploy/linked-publish/qualification.py",import.meta.url));
 const output=execFileSync("/usr/bin/python3",["-I","-B","-c","import json,runpy,sys; m=runpy.run_path(sys.argv[1]); r=json.load(sys.stdin); print(json.dumps(m['validate_dual_retirement_evidence'](r['bundle'],r['trusted'])))",validator],{input:raw,encoding:"utf8",env,timeout:30000,maxBuffer:1024**2});
 return JSON.parse(output);
}
export const retirementReadProgram=String.raw`import base64,hashlib,json,os,pathlib,re,stat,sys
r=json.load(sys.stdin);trusted=r['trusted'];root='/var/backups/proofofwork-ui/cleanup-evidence/';base=root+'older-backup-retirement-6fd05dc1e04e/'
seen={};ancestor_seen={};encoded_budget=0
def charge(path,size):
 global encoded_budget
 encoded_budget+=4*((size+2)//3)+len(str(path).encode())+256
 assert encoded_budget<=16*1024**2,'Cumulative evidence allocation bound exceeded'
def ancestor(path,info):
 value=(info.st_dev,info.st_ino,info.st_uid,info.st_gid,info.st_mode)
 if str(path) in ancestor_seen:assert ancestor_seen[str(path)]==value,'Evidence ancestor changed'
 ancestor_seen[str(path)]=value
def policy_path(path,prefix):
 p=pathlib.Path(path);assert p.parent==pathlib.Path(root) and re.fullmatch(re.escape(prefix)+r'[A-Za-z0-9._-]+\.json',p.name),'Unapproved admission path'
def parse(raw):
 def pairs(items):
  out={}
  for key,value in items:
   assert key not in out,'Duplicate evidence key';out[key]=value
  return out
 return json.loads(raw,object_pairs_hook=pairs)
def read(path,expected):
 p=pathlib.Path(path);assert p.is_absolute() and p.resolve(strict=True)==p
 for parent in p.parents:
  s=parent.lstat();assert stat.S_ISDIR(s.st_mode) and s.st_uid==s.st_gid==0 and not s.st_mode&0o022;ancestor(parent,s)
 before=p.lstat();assert stat.S_ISREG(before.st_mode) and before.st_uid==before.st_gid==0 and before.st_nlink==1 and not before.st_mode&0o022 and 0<before.st_size<=16*1024**2
 charge(p,before.st_size)
 fd=os.open(p,os.O_RDONLY|os.O_NOFOLLOW|os.O_NOATIME)
 try:
  assert os.fstat(fd)==before
  with os.fdopen(os.dup(fd),'rb') as stream:raw=stream.read(16*1024**2+1)
  assert len(raw)==before.st_size and os.fstat(fd)==before and p.lstat()==before
 finally:os.close(fd)
 digest=hashlib.sha256(raw).hexdigest();assert digest==expected
 seen[path]=before
 return {'path':path,'base64':base64.b64encode(raw).decode(),'sha256':digest},parse(raw)
def jsonrow(path,sha):return read(path,sha)
result={}
result['config'],config=read('/etc/proofofwork-retention/ui-lifecycle.json',trusted['configSha256'])
result['state'],state=read('/var/lib/proofofwork-ui-retention/state.json',trusted['stateSha256'])
binding=config['payloadRetirement'];assert binding['mode']=='complete' and binding['policyCodeSha256']==config['package']['sha256']==trusted['policyCodeSha256']
assert binding['receipt']['path']==base+'completed.json'
result['terminal'],terminal=read(base+'completed.json',binding['receipt']['sha256'])
result['ownerApproval'],approval=read(base+'owner-approval.json',terminal['approvalSha256'])
result['proposal'],proposal=read(base+'proposal.json','6fd05dc1e04e6fbcab293683c5a0d10d184ff0bd83039a66d7f2c7ec53161004')
result['inventory'],inventory=read(base+'inventory.json','dcf09bd3ec9453230ece39ce67ccf9f39716388ad26bc609ad09d1fe5c308107')
result['staticRestore'],restore=read(base+'static-restore.json','d83a52bef8bb3bca179e970a41d2300a9b7e1f688e53ac27342e2a8273766278')
source_path=root+'audit30-policy-admission-index-ordinary-064b6991ae2a-20261114T020148Z.json'
result['sourceIndex'],source=read(source_path,'5a7b025d95cd55a2b40f2a69b0189b74d75484ff237bac327f920a6b2a231c54')
current=state['index'];assert current==r['index'] and current['sha256']==trusted['currentIndexSha256']
policy_path(current['path'],'audit30-policy-admission-index-')
result['currentIndex'],index=read(current['path'],current['sha256'])
assert index['admissions'][:len(source['admissions'])]==source['admissions']
extra=index['admissions'][len(source['admissions']):];assert len(index['admissions'])<=256
result['appendedAdmissions']=[]
for item in extra:
 policy_path(item['path'],'audit30-policy-admission-')
 row,_=read(item['path'],item['sha256']);result['appendedAdmissions'].append(row)
result['sidecars']=[]
expected=[ '/var/backups/proofofwork-ui/releases/proofofwork-ui-release-'+release+'.tgz'+suffix for release in ('1042efea2aa1-20261112T074918Z','c3969c39c2b2-20261101T051206Z') for suffix in ('.sha256','.provenance')]
assert [x['path'] for x in proposal['sidecarsKeep']]==expected
for item in proposal['sidecarsKeep']:
 # Sidecars are not JSON; the protected byte reader still enforces exact hashes.
 p=pathlib.Path(item['path']);before=p.lstat();assert p.resolve(strict=True)==p and stat.S_ISREG(before.st_mode) and before.st_uid==before.st_gid==0 and before.st_nlink==1 and not before.st_mode&0o022 and before.st_size<=65536
 for parent in p.parents:
  s=parent.lstat();assert stat.S_ISDIR(s.st_mode) and s.st_uid==s.st_gid==0 and not s.st_mode&0o022;ancestor(parent,s)
 charge(p,before.st_size)
 fd=os.open(p,os.O_RDONLY|os.O_NOFOLLOW|os.O_NOATIME)
 try:
  assert os.fstat(fd)==before;raw=os.read(fd,65537);assert os.fstat(fd)==before and p.lstat()==before and len(raw)==before.st_size
 finally:os.close(fd)
 assert hashlib.sha256(raw).hexdigest()==item['sha256'];seen[str(p)]=before
 result['sidecars'].append({'path':str(p),'base64':base64.b64encode(raw).decode(),'sha256':item['sha256']})
result['finalProofs']={};final=terminal['journal'][-1]['data']
for key,name in [('finalFenceSha256','final-fence.json'),('retainedPairProofSha256','retained-pair-proof.json'),('sidecarsProofSha256','sidecars-proof.json'),('historicalEvidenceProofSha256','historical-evidence-proof.json')]:
 result['finalProofs'][key],_=read(base+name,final[key])
for path,before in seen.items():assert pathlib.Path(path).resolve(strict=True)==pathlib.Path(path) and pathlib.Path(path).lstat()==before,'Evidence changed during collection'
for path,before in list(ancestor_seen.items()):
 p=pathlib.Path(path);assert p.resolve(strict=True)==p;ancestor(p,p.lstat())
raw=json.dumps(result);assert len(raw.encode())<=16*1024**2;print(raw)
`;
export function collectRetirementEvidence(lifecycle) {
 const trusted=retirementTrust(lifecycle),quote=s=>"'"+s.replaceAll("'","'\\''")+"'";
 const raw=execFileSync("/usr/bin/ssh",["-i","/home/sixer/.ssh/proofofwork_me_ed25519","-o","BatchMode=yes","-o","IdentitiesOnly=yes","-o","StrictHostKeyChecking=yes","-o","ConnectTimeout=15","root@77.42.91.106","/usr/bin/python3 -I -B -c "+quote(retirementReadProgram)],{input:JSON.stringify({trusted,index:lifecycle.index}),encoding:"utf8",env,timeout:90000,maxBuffer:16*1024**2});
 const bundle=JSON.parse(raw);validateRetirementEvidence(bundle,lifecycle);return bundle;
}

export function validateRetainedHolds(lifecycle,bundle) {
 const old=lifecycle.verifiedPreservedRelease1042?.releaseId==="1042efea2aa1-20261112T074918Z" && lifecycle.verifiedPreservedFallback?.releaseId==="c3969c39c2b2-20261101T051206Z";
 if(old) {
  assert(lifecycle.verifiedRetiredPayloads==null&&bundle===undefined,"Conflicting in-place and retired evidence");
  return {mode:"verified-in-place-holds"};
 }
 assert(lifecycle.verifiedPreservedRelease1042==null&&lifecycle.verifiedPreservedFallback==null,"Partial hold/retirement evidence");
 const result=validateRetirementEvidence(bundle,lifecycle);
 assert.deepEqual(lifecycle.verifiedRetiredPayloads,result.proof);
 assert.deepEqual(lifecycle.verifiedRetirementCurrentPair,result.verifiedCurrentPair);
 assert.deepEqual(lifecycle.pair,result.verifiedCurrentPair);
 return result;
}

export const retentionPackageFiles=retentionOperatorPackagePaths;
const packageSha=raw=>createHash("sha256").update(raw).digest("hex");
const canonicalPackage=value=>JSON.stringify(value,(_key,item)=>item&&typeof item==="object"&&!Array.isArray(item)?Object.fromEntries(Object.keys(item).sort().map(k=>[k,item[k]])):item)+"\n";
// Pure construction grants no authority. Collection requires a branded proof.
export function expectedRetentionPackage(operator,blobs) {
 assert.deepEqual(Object.keys(operator).sort(),["commit","tree"]);
 for(const value of Object.values(operator))assert(/^[0-9a-f]{40}$/u.test(value));
 assert.deepEqual(Object.keys(blobs).sort(),[...retentionPackageFiles].sort());
 const files={};
 for(const path of retentionPackageFiles) {
  const raw=blobs[path];assert(Buffer.isBuffer(raw)&&raw.length>0&&raw.length<=2*1024**2);
  files[path]={bytes:raw.length,sha256:packageSha(raw)};
 }
 const manifest={schema:"pow-ui-retention-package-v1",sourceCommit:operator.commit,sourceTree:operator.tree,files};
 const manifestRaw=canonicalPackage(manifest),sha256=packageSha(manifestRaw);
 return {manifest,manifestRaw,sha256,path:"/var/backups/proofofwork-ui/cleanup-evidence/ui-lifecycle-tools-"+sha256};
}
export const installedRetentionProgram=String.raw`import hashlib,json,os,pathlib,stat,sys
r=json.load(sys.stdin);expected=r['expected'];seen={};ancestors={}
def parse(raw):
 def pairs(rows):
  value={}
  for key,item in rows:
   assert key not in value,'Duplicate package key';value[key]=item
  return value
 return json.loads(raw,object_pairs_hook=pairs)
def read(path,limit):
 p=pathlib.Path(path);assert p.is_absolute() and p.resolve(strict=True)==p
 for parent in p.parents:
  info=parent.lstat()
  assert stat.S_ISDIR(info.st_mode) and info.st_uid==info.st_gid==0 and not info.st_mode&0o022
  key=(info.st_dev,info.st_ino,info.st_mode,info.st_uid,info.st_gid)
  if str(parent) in ancestors:assert ancestors[str(parent)]==key
  ancestors[str(parent)]=key
 before=p.lstat()
 assert stat.S_ISREG(before.st_mode) and before.st_uid==before.st_gid==0 and before.st_nlink==1 and not before.st_mode&0o7022 and 0<before.st_size<=limit
 fd=os.open(p,os.O_RDONLY|os.O_NOFOLLOW|os.O_NOATIME)
 try:
  assert os.fstat(fd)==before
  with os.fdopen(os.dup(fd),'rb') as stream:raw=stream.read(limit+1)
  assert len(raw)==before.st_size and os.fstat(fd)==before and p.lstat()==before
 finally:os.close(fd)
 seen[str(p)]=before
 return raw
def finish():
 for path,before in seen.items():
  p=pathlib.Path(path);assert p.resolve(strict=True)==p and p.lstat()==before
 for path,before in ancestors.items():
  p=pathlib.Path(path);v=p.lstat()
  assert p.resolve(strict=True)==p and (v.st_dev,v.st_ino,v.st_mode,v.st_uid,v.st_gid)==before
configRaw=read('/etc/proofofwork-retention/ui-lifecycle.json',65536);config=parse(configRaw)
assert config['schema']=='pow-ui-retention-lifecycle-config-v1'
configSha=hashlib.sha256(configRaw).hexdigest()
if config.get('payloadRetirement') is None:
 finish()
 print(json.dumps({'mode':'legacy-in-place','configSha256':configSha}))
 sys.exit(0)
assert config['payloadRetirement']['mode']=='complete','Retirement is not complete'
assert config['sourceCommit']==expected['manifest']['sourceCommit'] and config['sourceTree']==expected['manifest']['sourceTree']
assert config['package']=={'path':expected['path'],'sha256':expected['sha256']}
root=pathlib.Path(expected['path'])
manifestRaw=read(root/'package.json',65536)
assert manifestRaw.decode()==expected['manifestRaw']
assert hashlib.sha256(manifestRaw).hexdigest()==expected['sha256']
manifest=parse(manifestRaw);assert manifest==expected['manifest']
assert config['controller']=={'path':str(root/'deploy/ui-retention/lifecycle_remote.py'),'sha256':manifest['files']['deploy/ui-retention/lifecycle_remote.py']['sha256']}
assert config['payloadRetirement']['policyCodeSha256']==expected['sha256']
wanted=set(manifest['files'])|{'package.json'};actual=set();directory_states={}
for directory,dirs,files in os.walk(root,followlinks=False):
 directory_states[directory]=pathlib.Path(directory).lstat()
 for name in dirs:
  p=pathlib.Path(directory)/name;info=p.lstat()
  assert p.resolve(strict=True)==p and stat.S_ISDIR(info.st_mode) and info.st_uid==info.st_gid==0 and not info.st_mode&0o022
  assert any(x.startswith(str(p.relative_to(root))+'/') for x in wanted),'Unexpected package directory'
 for name in files:actual.add(str((pathlib.Path(directory)/name).relative_to(root)))
assert actual==wanted,'Unexpected package file scope'
for path,item in manifest['files'].items():
 raw=read(root/path,2*1024**2)
 assert len(raw)==item['bytes'] and hashlib.sha256(raw).hexdigest()==item['sha256']
for directory,before in directory_states.items():assert pathlib.Path(directory).lstat()==before,'Package directory changed'
finish()
print(json.dumps({'mode':'operator-retirement-package','configSha256':configSha,'policyCodeSha256':expected['sha256'],'operator':{'commit':manifest['sourceCommit'],'tree':manifest['sourceTree']}}))
`;

export function attestInstalledRetentionPackage(identityProof) {
 const proof=requireIdentityProof(identityProof);
 const before=createIdentityProof({repository:proof.repository});
 for(const key of ["artifact","baselineOperator","backend","operator","digests"])assert.deepEqual(before[key],proof[key],"Operator source changed before package attestation");
 const gitEnv={PATH:"/usr/bin:/bin",HOME:"/nonexistent",GIT_CONFIG_NOSYSTEM:"1",GIT_CONFIG_GLOBAL:"/dev/null",GIT_NO_REPLACE_OBJECTS:"1",GIT_GRAFT_FILE:"/dev/null",GIT_OPTIONAL_LOCKS:"0"};
 const blobs={};
 for(const path of retentionPackageFiles) {
  const args=["--no-replace-objects","-c","core.fsmonitor=false","-C",proof.repository];
  const entry=execFileSync("/usr/bin/git",[...args,"ls-tree",proof.operator.commit,"--",path],{env:gitEnv,encoding:"utf8",timeout:15000,maxBuffer:4096});
  const match=/^(100644|100755) blob ([0-9a-f]{40})\t([^\n]+)\n$/u.exec(entry);
  assert(match&&match[3]===path,"Package path is not a committed regular blob");
  blobs[path]=execFileSync("/usr/bin/git",[...args,"show",proof.operator.commit+":"+path],{env:gitEnv,timeout:15000,maxBuffer:2*1024**2});
 }
 const expected=expectedRetentionPackage(proof.operator,blobs),quote=s=>"'"+s.replaceAll("'","'\\''")+"'";
 const raw=execFileSync("/usr/bin/ssh",["-i","/home/sixer/.ssh/proofofwork_me_ed25519","-o","BatchMode=yes","-o","IdentitiesOnly=yes","-o","StrictHostKeyChecking=yes","-o","ConnectTimeout=15","root@77.42.91.106","/usr/bin/python3 -I -B -c "+quote(installedRetentionProgram)],{input:JSON.stringify({expected}),encoding:"utf8",env,timeout:90000,maxBuffer:65536});
 const value=JSON.parse(raw);
 const after=createIdentityProof({repository:proof.repository});
 for(const key of ["artifact","baselineOperator","backend","operator","digests"])assert.deepEqual(after[key],proof[key],"Operator source changed after package attestation");
 assert(SHA.test(value.configSha256));
 if(value.mode==="operator-retirement-package") {
  assert.deepEqual(Object.keys(value).sort(),["configSha256","mode","operator","policyCodeSha256"]);
  assert.deepEqual(value.operator,proof.operator);assert.equal(value.policyCodeSha256,expected.sha256);
 } else {assert.equal(value.mode,"legacy-in-place");assert.deepEqual(Object.keys(value).sort(),["configSha256","mode"]);}
 return Object.freeze(value);
}
export function bindInstalledRetentionPackage(lifecycle,attestation) {
 assert.equal(lifecycle.configSha256,attestation.configSha256,"Installed configuration changed");
 if(attestation.mode==="operator-retirement-package") {
  assert.equal(lifecycle.verifiedRetirementPolicyCodeSha256,attestation.policyCodeSha256,"Untrusted retirement policy code");
  assert(lifecycle.verifiedRetiredPayloads,"Operator package lacks completed retirement proof");
 } else assert(lifecycle.verifiedRetiredPayloads==null,"Legacy package cannot authorize retirement");
}
