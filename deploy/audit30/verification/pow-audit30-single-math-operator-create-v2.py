#!/usr/bin/python3 -I
"""One exact new code file using the existing reviewed custody helper; no runner."""
import base64,hashlib,json,os,pathlib,signal,stat,sys,time,types
P=pathlib.Path
PACKAGE=P('/usr/local/lib/proofofwork-audit30-onhost-math/v2')
TARGET=PACKAGE/'operator-completion-v2.mjs'
REQUEST_SHA='2ced7cc374032419d03931bc969fb5baa831b9600305a05d39d239db19c2e529'
ADMISSION_SHA='a2e5d0477e44ac2c930e548a1e4b9b47397b462dc86395722265345936aeac8f'
MATH_REQUEST_SHA='6e74ac51fe4ba250f578b6f2688f3e7af377b7407c286aefa0fa40f2a5eff339'
UTILITY_SHA='379b387e33d08b421e126edd261f63b801d8326bdf24477e6a1a8c012c0e1988'
OPERATOR_SHA='9faae94cebbedad8f02db55f2545e80dc2f7e0d937aa6cea149532577a7abee6'
def need(v,code):
 if not v:raise ValueError(code)
def sha(b):return hashlib.sha256(b).hexdigest()
def encoded(v):return json.dumps(v,sort_keys=True,separators=(',',':'),ensure_ascii=False).encode()
class StageInterrupted(RuntimeError):pass
def interrupted(s,f):
 for n in (signal.SIGINT,signal.SIGTERM,signal.SIGHUP):signal.signal(n,signal.SIG_IGN)
 raise StageInterrupted('OPERATOR_STAGE_INTERRUPTED')
def old_members(C):
 # A direct package-level snapshot, not a new recursive inventory algorithm.
 out={}
 for p in sorted(PACKAGE.iterdir()):
  need(p!=TARGET,'OPERATOR_STAGE_COLLISION');s=p.lstat();m=C.stamp(s);need(p.resolve()==p and not C.xattrs(p),'OPERATOR_STAGE_OLD_ALIAS')
  if stat.S_ISDIR(s.st_mode):need(p==C.DEST,'OPERATOR_STAGE_OLD_DIRECTORY');out[p.name]={'metadata':m}
  else:need(stat.S_ISREG(s.st_mode)and s.st_uid==0 and s.st_nlink==1 and not s.st_mode&0o022,'OPERATOR_STAGE_OLD_AUTHORITY');out[p.name]={'metadata':m,'sha256':sha(C.read_file(p,32*1024**2,metadata=m))}
 return out
def fence(C,r):
 C.check_tools(r);C.reserve();C.package_fence();need(sha(C.attest())==C.ATTESTATION,'OPERATOR_STAGE_CANDIDATE')
 m=json.loads(C.read_file(PACKAGE/'source-copy-manifest.json',32*1024**2,r['sourceCopyManifestSha256']))
 done=json.loads(C.read_file(PACKAGE/'source-copy-finalize-v3-completed.json',65536,r['sourceCopyCompletionSha256']))
 need(m['candidateAttestationSHA256']==C.ATTESTATION and m['sourceInventorySHA256']=='aae198d18b0f5b347f25022f4c141b546aebf5f62d32e21cd72443ede5edd642'and done['status']=='completed'and done['sourceCopyManifestSHA256']==r['sourceCopyManifestSha256']and done['sourceTreeNotModified']is True and done['candidateUnchanged']is True and done['priorAttemptRemainsFailed']is True,'OPERATOR_STAGE_COPY_CUSTODY')
 copied={k:m[k]for k in ('entries','entryCount','regularBytes')};need(C.inventory_tree(C.DEST)==copied,'OPERATOR_STAGE_COPIED_TREE');return sha(encoded(copied))
def main():
 need(sys.flags.isolated and len(sys.argv)==2 and sys.argv[1]==REQUEST_SHA and os.getuid()==os.geteuid()==os.getgid()==os.getegid()==0 and os.uname().nodename=='pow-bitcoin-01','OPERATOR_STAGE_IDENTITY')
 os.umask(0o077)
 for s in (signal.SIGINT,signal.SIGTERM,signal.SIGHUP,signal.SIGALRM):signal.signal(s,interrupted)
 signal.alarm(180);raw=sys.stdin.buffer.read(128*1024+1);need(len(raw)<=128*1024 and sha(raw)==REQUEST_SHA,'OPERATOR_STAGE_REQUEST_RAW');e=json.loads(raw);need(encoded(e)==raw and set(e)=={'schema','admission','managedRequest'}and e['schema']=='pow-audit30-single-math-operator-create-request-v2','OPERATOR_STAGE_ENVELOPE')
 a=e['admission'];r=e['managedRequest'];need(sha(encoded(a))==ADMISSION_SHA and sha(encoded(r))==MATH_REQUEST_SHA,'OPERATOR_STAGE_ADMISSION_PINS')
 b=base64.b64decode(a['operatorBase64'],validate=True);u=base64.b64decode(r['utilityBase64'],validate=True);need(sha(b)==OPERATOR_SHA and len(b)==27410 and sha(u)==UTILITY_SHA,'OPERATOR_STAGE_SOURCE_PINS')
 C=types.ModuleType('reviewed379b');exec(compile(u,'<reviewed379b>','exec'),C.__dict__);C.DEADLINE=time.monotonic()+180;need(C.PACKAGE==PACKAGE and C.PG_UID==108 and C.PG_GID==112,'OPERATOR_STAGE_HELPER_SCOPE')
 need(C.stamp(PACKAGE.lstat())==a['packageMetadata']and not os.path.lexists(TARGET)and not os.path.lexists(PACKAGE/'math-plan-completion-v2.json'),'OPERATOR_STAGE_PARENT_OR_COLLISION')
 before=fence(C,r);old=old_members(C);parent=C.stamp(PACKAGE.lstat());need(parent==a['packageMetadata'],'OPERATOR_STAGE_PARENT_CHANGED');C.guard()
 C.newfile(TARGET,b,0o440,0,112);s=TARGET.lstat();need(TARGET.resolve()==TARGET and (s.st_uid,s.st_gid,stat.S_IMODE(s.st_mode),s.st_nlink)==(0,112,0o440,1)and not C.xattrs(TARGET)and C.read_file(TARGET,65536,OPERATOR_SHA,C.stamp(s))==b,'OPERATOR_STAGE_NEW_FILE')
 # Exclude only the new target during the old-member reread; never waive old bytes.
 observed={}
 for name,row in old.items():
  p=PACKAGE/name;need(C.stamp(p.lstat())==row['metadata']and p.resolve()==p and not C.xattrs(p),'OPERATOR_STAGE_OLD_DRIFT')
  if 'sha256'in row:need(sha(C.read_file(p,32*1024**2,metadata=row['metadata']))==row['sha256'],'OPERATOR_STAGE_OLD_BYTES')
  observed[name]=row
 need(set(p.name for p in PACKAGE.iterdir())==set(old)|{TARGET.name},'OPERATOR_STAGE_EXTRA_MUTATION');after=fence(C,r);final=C.stamp(PACKAGE.lstat());need(before==after and all(final[k]==parent[k]for k in ('dev','ino','uid','gid','mode','nlink')),'OPERATOR_STAGE_FINAL_CLOSURE')
 signal.alarm(0);print(json.dumps({'schema':'pow-audit30-single-math-operator-created-v2','status':'created','requestSha256':REQUEST_SHA,'operatorSha256':OPERATOR_SHA,'bytes':len(b),'metadata':C.stamp(TARGET.lstat()),'oldMemberCount':len(old),'oldMembersUnchanged':True,'copiedTreeUnchanged':True,'candidateUnchanged':True,'parentIdentityUnchanged':True,'soleNewFile':str(TARGET),'arithmeticExecuted':False,'serviceActions':False,'productionMutation':False},sort_keys=True));return 0
if __name__=='__main__':
 try:code=main()
 except BaseException as e:
  for s in (signal.SIGINT,signal.SIGTERM,signal.SIGHUP):signal.signal(s,signal.SIG_IGN)
  signal.alarm(0);print(json.dumps({'status':'refused','errorClass':type(e).__name__,'partialNewFilePreserved':True,'automaticRetry':False,'arithmeticExecuted':False,'serviceActions':False}));code=1
 raise SystemExit(code)
