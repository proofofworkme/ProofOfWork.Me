import base64,hashlib,json,os,pathlib,shlex,subprocess,sys
BINDING=pathlib.Path('/tmp/pow-audit30-id-pin-branch-source-binding-v1.json').read_bytes();assert hashlib.sha256(BINDING).hexdigest()=='bf3788f74049c262c9e58f8a290fae1903c78b0be47f2755fc1c9e90650cce43'
CODE=r'''
import base64,datetime,hashlib,json,os,pathlib,pwd,stat,subprocess
B=json.loads(BINDING);ROOT=pathlib.Path('/opt/proofofwork-api-stage-04e685a4c7ea-20261003T025240Z');CAP=pathlib.Path('/run/proofofwork-audit5-04e685a4c7ea-20261003T025240Z');uid=pwd.getpwnam('powadmin').pw_uid
E={'PATH':'/usr/bin:/bin','LC_ALL':'C','TZ':'UTC','GIT_OPTIONAL_LOCKS':'0'}
def stamp(s):return (s.st_dev,s.st_ino,s.st_mode,s.st_uid,s.st_gid,s.st_nlink,s.st_size,s.st_mtime_ns,s.st_ctime_ns)
def read(p,owner,sha,cap,mode=None):
 m=p.lstat();assert p.resolve()==p and stat.S_ISREG(m.st_mode)and m.st_uid==owner and m.st_nlink==1 and m.st_size<=cap and not stat.S_IMODE(m.st_mode)&0o022 and(mode is None or stat.S_IMODE(m.st_mode)==mode)
 fd=os.open(p,os.O_RDONLY|os.O_NOFOLLOW|os.O_NOATIME)
 try:
  assert stamp(os.fstat(fd))==stamp(m);out=bytearray()
  while c:=os.read(fd,65536):out.extend(c);assert len(out)<=cap
  assert len(out)==m.st_size and stamp(os.fstat(fd))==stamp(m)==stamp(p.lstat())and hashlib.sha256(out).hexdigest()==sha
  return bytes(out)
 finally:os.close(fd)
assert CAP.resolve()==CAP and CAP.lstat().st_uid==CAP.lstat().st_gid==0 and stat.S_IMODE(CAP.lstat().st_mode)==0o700
raw=read(CAP/'api.environ',0,'327427c12f187d5b200a9a2323025bd659688e72c3e10faac24545fc514fdb5c',1024**2,0o600)
source=read(ROOT/'server/proof-api.mjs',uid,B['apiSHA256'],8*1024**2);snippet=base64.b64decode(B['snippetBase64'],validate=True);a,b=B['apiByteOffsets'];assert source[a:b]==snippet and hashlib.sha256(snippet).hexdigest()==B['snippetSHA256']
for name,pin in B['declarationDependencyHashes'].items():read(ROOT/name,uid,pin,8*1024**2)
node='/opt/node-v24.18.0-linux-x64/bin/node';read(pathlib.Path(node),0,'41a74efb34cbde5c7632cdac0cf8bd1a14d0b8d73dc1e82755014d9a9ce70f5c',128*1024**2)
keys=['WORK_AMO_V8_WRITES_ENABLED','WORK_AMO_V8_DECLARATION_TXID','WORK_AMO_V8_DECLARATION_HEIGHT','WORK_AMO_V8_DECLARATION_BLOCK_HASH','WORK_AMO_V8_DECLARATION_BLOCK_INDEX','WORK_AMO_V8_DECLARATION_MEMO_SHA256','WORK_AMO_V8_DECLARATION_MEMO_BYTES','WORK_AMO_V8_DECLARATION_PROTOCOL_VOUT','WORK_AMO_V8_DECLARATION_RECORD_ORDINAL','WORK_AMO_V8_DECLARATION_REGISTRY_PAYMENT_VOUT','WORK_AMO_V8_ACTIVATION_HEIGHT']
env=dict(E)
for pair in raw.split(b'\0'):
 if b'='not in pair:continue
 key,value=pair.split(b'=',1);name=key.decode('ascii','strict')
 if name in keys:assert len(value)<512;env[name]=value.decode('ascii','strict')
program='const workAmoV8DeclarationCommitment=()=>Object.freeze('+json.dumps(B['expectedCommitment'],sort_keys=True)+');\n'+snippet.decode()+'\nconsole.log(JSON.stringify({pinsConfigured:WORK_AMO_V8_DECLARATION_PINS_CONFIGURED,pinState:WORK_AMO_V8_DECLARATION_PIN_STATE,writesConfigured:WORK_AMO_V8_WRITES_CONFIGURED,activationHeight:WORK_AMO_V8_ACTIVATION_HEIGHT,configuredActivationSafe:Number.isSafeInteger(WORK_AMO_V8_ACTIVATION_HEIGHT)&&WORK_AMO_V8_ACTIVATION_HEIGHT>=2,currentOnlyBranchConfigured:WORK_AMO_V8_DECLARATION_PINS_CONFIGURED&&Number.isSafeInteger(WORK_AMO_V8_ACTIVATION_HEIGHT)&&WORK_AMO_V8_ACTIVATION_HEIGHT>=2,fieldsPresent:'+json.dumps({k:k in env and bool(env[k])for k in keys})+'}));'
r=subprocess.run([node,'--max-old-space-size=64','--input-type=module','--eval',program],env=env,capture_output=True,timeout=15);assert r.returncode==0 and not r.stderr and len(r.stdout)<65536
assert read(CAP/'api.environ',0,'327427c12f187d5b200a9a2323025bd659688e72c3e10faac24545fc514fdb5c',1024**2,0o600)==raw
print(json.dumps(dict(schema='pow-audit30-id-configured-fast-branch-native-v1',atUtc=datetime.datetime.now(datetime.timezone.utc).isoformat(),sourceBindingSHA256=hashlib.sha256(BINDING).hexdigest(),apiSHA256=B['apiSHA256'],captureEnvironSHA256=hashlib.sha256(raw).hexdigest(),declarationDependencyCount=len(B['declarationDependencyHashes']),actualConfiguredConstants=json.loads(r.stdout),productionMutation=False,timerChanges=False,apiCalls=0,sqlCalls=0,qualification='Exact contiguous API config AST declarations evaluated with ONLY hash-bound captured V8 config keys and the two exact canonical commitment scalars from an independently source-hashed pure dependency closure. No raw environment, declaration memo, authentication token or key exported. This proves branch configuration, not that an audit request reached a particular phase.'),sort_keys=True))
'''
def main():
 p=pathlib.Path('/tmp/pow-audit30-id-pin-branch-native-v1.json');assert not any(os.path.lexists(str(p)+x)for x in ['', '.stdout','.stderr'])
 ssh=['ssh','-i','/home/sixer/.ssh/proofofwork_node_ed25519','-o','BatchMode=yes','-o','IdentitiesOnly=yes','-o','StrictHostKeyChecking=yes','-o','ConnectTimeout=10','powadmin@65.108.122.87',shlex.join(['sudo','-n','/usr/bin/python3','-I','-B','-'])];r=subprocess.run(ssh,input=('BINDING='+repr(BINDING)+'\n'+CODE).encode(),capture_output=True,timeout=90)
 for ext,b in [('.stdout',r.stdout),('.stderr',r.stderr)]:
  with pathlib.Path(str(p)+ext).open('xb')as f:f.write(b);f.flush();os.fsync(f.fileno())
 out=dict(schema='pow-audit30-id-configured-fast-branch-transport-v1',returncode=r.returncode,sourceSHA256=hashlib.sha256(pathlib.Path(__file__).read_bytes()).hexdigest(),stdoutBytes=len(r.stdout),stdoutSHA256=hashlib.sha256(r.stdout).hexdigest(),stderrBytes=len(r.stderr),stderrSHA256=hashlib.sha256(r.stderr).hexdigest(),result=json.loads(r.stdout)if r.returncode==0 else None)
 with p.open('xb')as f:f.write((json.dumps(out,sort_keys=True,indent=2)+'\n').encode());f.flush();os.fsync(f.fileno())
 print(json.dumps(out,sort_keys=True));return r.returncode
if __name__=='__main__':sys.exit(main())
