#!/usr/bin/env python3
"""Approved creation-only sealed 04e685 node staging; never cuts over or stops live apps."""
import base64,hashlib,json,os,pathlib,shlex,subprocess,sys
ROOT=pathlib.Path('/home/sixer/ProofOfWork.Me');BUNDLE=pathlib.Path('/tmp/pow-audit30-release-04e685a4c7ea-source.bundle');RELEASE='04e685a4c7ea-20261003T025240Z';COMMIT='04e685a4c7eaacaaad97c7f1700a25e84be834ca';TREE='790c71d91f11e53a00ae9a7b271337d2d1d5119a'
SSH=['ssh','-i','/home/sixer/.ssh/proofofwork_node_ed25519','-o','BatchMode=yes','-o','IdentitiesOnly=yes','-o','StrictHostKeyChecking=yes','-o','ConnectTimeout=10','powadmin@65.108.122.87']
REMOTE=r'''
import base64,datetime as dt,fcntl,hashlib,json,os,pathlib,selectors,signal,stat,subprocess,sys,time
s=json.loads(sys.argv[1]);assert os.geteuid()==os.getegid()==0;release=s['releaseId'];assert release=='04e685a4c7ea-20261003T025240Z' and s['commit']=='04e685a4c7eaacaaad97c7f1700a25e84be834ca' and s['tree']=='790c71d91f11e53a00ae9a7b271337d2d1d5119a'
ENV={'PATH':'/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin','LC_ALL':'C','GIT_OPTIONAL_LOCKS':'0','GIT_CONFIG_NOSYSTEM':'1','GIT_CONFIG_GLOBAL':'/dev/null'}
def interrupted(signum,frame):raise RuntimeError('STAGE_PARENT_SIGNAL')
signal.signal(signal.SIGTERM,interrupted);signal.signal(signal.SIGINT,interrupted)
root=pathlib.Path('/data/proofofwork-release-backups/audit30-node-release-'+release);tools=pathlib.Path('/var/tmp/proofofwork-deploy/audit29-tools');bundle=pathlib.Path('/var/tmp/proofofwork-deploy/proofofwork-audit5-source-'+release+'.bundle')
def stamp(v):return (v.st_dev,v.st_ino,v.st_mode,v.st_uid,v.st_gid,v.st_nlink,v.st_size,v.st_mtime_ns,v.st_ctime_ns)
def checked(path,expected,owner=0):
 p=pathlib.Path(path);v=p.lstat();assert p.resolve()==p and stat.S_ISREG(v.st_mode)and v.st_uid==owner and not v.st_mode&0o7022 and v.st_nlink==1;fd=os.open(p,os.O_RDONLY|os.O_NOFOLLOW|os.O_NOATIME);sha=hashlib.sha256()
 try:
  assert stamp(os.fstat(fd))==stamp(v)
  while True:
   b=os.read(fd,1024*1024)
   if not b:break
   sha.update(b)
  assert stamp(os.fstat(fd))==stamp(v)==stamp(p.lstat())and sha.hexdigest()==expected
 finally:os.close(fd)
def sync(p):
 fd=os.open(p,os.O_RDONLY|os.O_DIRECTORY|os.O_NOFOLLOW)
 try:os.fsync(fd)
 finally:os.close(fd)
def write(p,b):
 fd=os.open(p,os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW,0o600)
 with os.fdopen(fd,'wb')as f:f.write(b);f.flush();os.fsync(f.fileno())
 sync(p.parent)
def attest(path):
 r=subprocess.run(['/usr/bin/python3','-I','-B',str(tools/'attest-node.py'),str(path)],env=ENV,capture_output=True,timeout=180);assert r.returncode==0 and not r.stderr;return r.stdout
def unit_shape(unit):
 r=subprocess.run(['/usr/bin/systemctl','show',unit,'--property=LoadState,User,Group,InvocationID,ExecStart,MainPID'],env=ENV,capture_output=True,timeout=10);assert r.returncode==0 and len(r.stdout)<65536 and not r.stderr
 return dict(line.split('=',1)for line in r.stdout.decode().splitlines()if '='in line)
def stop_owned(unit,invocation):
 shape=unit_shape(unit)
 if shape.get('LoadState')=='not-found':return
 assert invocation and shape.get('InvocationID')==invocation and shape.get('User')=='root' and shape.get('Group')=='root' and str(root/'stage.sh')in shape.get('ExecStart',''),'STAGE_UNIT_IDENTITY_CHANGED'
 r=subprocess.run(['/usr/bin/systemctl','stop',unit],env=ENV,capture_output=True,timeout=40);assert r.returncode==0 and len(r.stdout)+len(r.stderr)<65536
 assert unit_shape(unit).get('MainPID','0')=='0','STAGE_UNIT_STILL_RUNNING'
def bounded_stage(argv,paths,unit,limit=4*1024*1024,timeout=930):
 assert unit_shape(unit).get('LoadState')=='not-found','STAGE_UNIT_ALREADY_EXISTS'
 fds=[os.open(p,os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW,0o600)for p in paths];counts=[0,0];owned='';proc=None;sel=selectors.DefaultSelector();start=time.monotonic()
 try:
  proc=subprocess.Popen(argv,env=ENV,stdout=subprocess.PIPE,stderr=subprocess.PIPE)
  for i,stream in enumerate([proc.stdout,proc.stderr]):sel.register(stream,selectors.EVENT_READ,i)
  while sel.get_map():
   assert time.monotonic()-start<=timeout,'STAGE_TRANSPORT_DEADLINE'
   if not owned:
    shape=unit_shape(unit)
    if shape.get('InvocationID'):
     assert shape.get('User')=='root'and shape.get('Group')=='root'and str(root/'stage.sh')in shape.get('ExecStart',''),'STAGE_UNIT_IDENTITY_CHANGED';owned=shape['InvocationID']
   for key,_ in sel.select(0.25):
    b=os.read(key.fileobj.fileno(),65536)
    if not b:sel.unregister(key.fileobj);key.fileobj.close();continue
    i=key.data;counts[i]+=len(b);assert counts[i]<=limit,'STAGE_LOG_CAP';view=memoryview(b)
    while view:view=view[os.write(fds[i],view):]
  status=proc.wait(timeout=10)
  if status:stop_owned(unit,owned)
  return status,counts,owned
 except BaseException:
  signal.signal(signal.SIGTERM,signal.SIG_IGN);signal.signal(signal.SIGINT,signal.SIG_IGN)
  if proc is not None:
   try:
    if not owned:
     shape=unit_shape(unit)
     if shape.get('InvocationID'):owned=shape['InvocationID']
    stop_owned(unit,owned)
   except BaseException as cleanup:cleanup_errors.append(dict(action='owned-unit-stop',errorClass=type(cleanup).__name__))
   try:
    if proc.poll()is None:proc.terminate()
    try:proc.wait(timeout=5)
    except subprocess.TimeoutExpired:proc.kill();proc.wait(timeout=5)
   except BaseException as cleanup:cleanup_errors.append(dict(action='owned-transport-reap',errorClass=type(cleanup).__name__))
  raise
 finally:
  sel.close()
  if proc is not None:
   for stream in [proc.stdout,proc.stderr]:
    if stream is not None and not stream.closed:stream.close()
  for f in fds:os.fsync(f);os.close(f)
  sync(root)
lock=pathlib.Path('/run/proofofwork-audit29-ops.lock');v=lock.lstat();assert lock.resolve()==lock and stat.S_ISREG(v.st_mode)and stat.S_IMODE(v.st_mode)==0o600 and v.st_uid==v.st_gid==0 and v.st_nlink==1;fd=os.open(lock,os.O_RDWR|os.O_NOFOLLOW);assert stamp(os.fstat(fd))==stamp(v);fcntl.flock(fd,fcntl.LOCK_EX|fcntl.LOCK_NB);assert stamp(os.fstat(fd))==stamp(v)==stamp(lock.lstat()),'LOCK_PATH_CHANGED_AFTER_ACQUISITION'
for key,row in s['helpers'].items():checked(row['path'],row['sha256'])
old=attest('/opt/proofofwork-api');assert old.decode().strip().split()==s['oldFields'] and hashlib.sha256(old).hexdigest()==s['oldRawSHA256'];checked(s['recovery']['archive']['path'],s['recovery']['archive']['sha256']);checked(s['recovery']['provenance']['path'],s['recovery']['provenance']['sha256'])
for path in [root,bundle,pathlib.Path('/opt/proofofwork-api-stage-'+release),pathlib.Path('/opt/proofofwork-audit5-node-work-'+release)]:assert not os.path.lexists(path)
assert root.parent.resolve()==root.parent and root.parent.stat().st_uid==0 and not root.parent.stat().st_mode&0o7022;assert bundle.parent.resolve()==bundle.parent and bundle.parent.stat().st_uid==0 and stat.S_IMODE(bundle.parent.stat().st_mode)==0o700
assert os.statvfs('/opt').f_bavail*os.statvfs('/opt').f_frsize>=11*1024**3
os.umask(0o077);root.mkdir(mode=0o700);sync(root.parent);cleanup_errors=[]
try:
 assert set(s['sources'])=={'stage.sh','attest-node.py','release.py'}
 assert {k:v['sha256']for k,v in s['sources'].items()}=={'stage.sh':'4733a2c7d5d4cee4a957b7acb1569a9dfc5fa85022fab4988f50049436b101e8','attest-node.py':'4bec20fa1e5931636e3bfc84f617f005a7b1b71e752dc7f7c9b8bea23014be38','release.py':'09afe5ddd243a796ea9c830b0041924747eb77a3803a3cfe56a3279cd24bf670'}
 for name,row in s['sources'].items():
  raw=base64.b64decode(row['base64'],validate=True);assert hashlib.sha256(raw).hexdigest()==row['sha256'];write(root/name,raw)
 write(root/'old-live.tsv',old);write(root/'stage-intent.json',(json.dumps(s,sort_keys=True)+'\n').encode());f=os.open(bundle,os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW,0o600);size=0;d=hashlib.sha256()
 with os.fdopen(f,'wb')as out:
  while True:
   b=sys.stdin.buffer.read(1024*1024)
   if not b:break
   size+=len(b);assert size<=s['bundleBytes'];d.update(b);out.write(b)
  out.flush();os.fsync(out.fileno())
 sync(bundle.parent);assert size==s['bundleBytes']and d.hexdigest()==s['bundleSHA256']
 unit='proofofwork-audit30-node-stage-'+release+'.service';argv=['/usr/bin/systemd-run','--quiet','--wait','--pipe','--unit='+unit,'--service-type=exec','--property=User=root','--property=Group=root','--property=KillMode=control-group','--property=RuntimeMaxSec=15min','--property=TimeoutStopSec=30s','--property=MemoryMax=4G','--property=MemorySwapMax=0','--property=CPUQuota=100%','--property=TasksMax=128','--property=UMask=0077','/usr/bin/bash',str(root/'stage.sh'),release,s['commit'],s['bundleSHA256']]
 status,logcounts,invocation=bounded_stage(argv,[root/'stage.stdout',root/'stage.stderr'],unit)
 assert status==0,'STAGE_UNIT_REFUSED';new=pathlib.Path('/opt/proofofwork-audit5-node-work-'+release+'/candidate-attestation.tsv').read_bytes();parts=new.decode().strip().split();assert len(parts)==5 and parts[:2]==[s['commit'],s['tree']];write(root/'candidate.tsv',new)
 assert attest('/opt/proofofwork-api')==old and attest('/opt/proofofwork-api-stage-'+release)==new
 report=dict(schema='pow-audit30-node-staged-candidate-v1',atUtc=dt.datetime.now(dt.timezone.utc).isoformat(),status='staged',releaseId=release,root=str(root),candidateFields=parts,candidateAttestationSha256=hashlib.sha256(new).hexdigest(),oldFields=s['oldFields'],oldAttestationSha256=s['oldRawSHA256'],bundleSha256=s['bundleSHA256'],recovery=s['recovery'],sourceApiSha256=s['sourceApiSha256'],stageScriptSha256=s['sources']['stage.sh']['sha256'],stageInvocationID=invocation,logBytes=logcounts,logCapEachBytes=4*1024*1024,liveSourceUnchanged=True,productionDataMutation=False,cutover=False)
 write(root/'staged.json',(json.dumps(report,sort_keys=True)+'\n').encode());print(json.dumps(report,sort_keys=True))
except BaseException as e:
 signal.signal(signal.SIGTERM,signal.SIG_IGN);signal.signal(signal.SIGINT,signal.SIG_IGN)
 write(root/'stage-failed.json',(json.dumps(dict(schema='pow-audit30-node-stage-failed-v1',errorClass=type(e).__name__,cleanupErrors=cleanup_errors,productionDataMutation=False,cutover=False,allNewEvidenceRetained=True))+'\n').encode());raise
finally:os.close(fd)
'''
def main():
 p=json.loads(pathlib.Path('/tmp/pow-audit30-node-release-read-only-preflight-v4.json').read_bytes())['preflight'];stage=pathlib.Path('/tmp/audit28-stage-node.sh').read_bytes();assert hashlib.sha256(stage).hexdigest()=='bfa59cca9f18d0ba43b4972cf5de38a3abb43aa188f3f7772e2c0c012bb2575a';stage=stage.decode().replace('proofofwork-audit28-source-','proofofwork-audit5-source-').replace('proofofwork-audit28-node-work-','proofofwork-audit5-node-work-').encode()
 sources={'stage.sh':stage,'attest-node.py':(ROOT/'deploy/audit5/attest-node.py').read_bytes(),'release.py':(ROOT/'deploy/audit29/release.py').read_bytes()}
 with BUNDLE.open('rb')as f:bundle_sha=hashlib.file_digest(f,'sha256').hexdigest()
 assert BUNDLE.stat().st_size==34168754 and bundle_sha=='098bdd8466eb29749f7d266abf544c460060f4dfe2bd9c4532814fdefd170745'
 s=dict(releaseId=RELEASE,commit=COMMIT,tree=TREE,helpers=p['helpers'],oldFields=p['oldAttestation']['fields'],oldRawSHA256=p['oldAttestation']['sha256'],recovery=p['recovery'],sourceApiSha256=p['sourceApi']['sha256'],sources={k:dict(base64=base64.b64encode(v).decode(),sha256=hashlib.sha256(v).hexdigest())for k,v in sources.items()},bundleBytes=BUNDLE.stat().st_size,bundleSHA256=bundle_sha)
 output=pathlib.Path(sys.argv[1]);assert str(output).startswith('/tmp/')and output.resolve()==output
 request=output.with_suffix('.request.json');fd=os.open(request,os.O_WRONLY|os.O_CREAT|os.O_EXCL,0o600)
 with os.fdopen(fd,'wb')as f:f.write((json.dumps(s,sort_keys=True)+'\n').encode());f.flush();os.fsync(f.fileno())
 with BUNDLE.open('rb')as incoming:r=subprocess.run(SSH+[shlex.join(['sudo','-n','/usr/bin/python3','-I','-B','-c',REMOTE,json.dumps(s,sort_keys=True)])],stdin=incoming,capture_output=True,timeout=1200)
 for suffix,raw in [('.stdout',r.stdout),('.stderr',r.stderr)]:
  fd=os.open(str(output)+suffix,os.O_WRONLY|os.O_CREAT|os.O_EXCL,0o600)
  with os.fdopen(fd,'wb')as f:f.write(raw);f.flush();os.fsync(f.fileno())
 result=dict(schema='pow-audit30-node-stage-transport-v1',returncode=r.returncode,sourceSha256=hashlib.sha256(pathlib.Path(__file__).read_bytes()).hexdigest(),stdoutSha256=hashlib.sha256(r.stdout).hexdigest(),stderrSha256=hashlib.sha256(r.stderr).hexdigest(),result=json.loads(r.stdout)if r.returncode==0 else None)
 fd=os.open(output,os.O_WRONLY|os.O_CREAT|os.O_EXCL,0o600)
 with os.fdopen(fd,'wb')as f:f.write((json.dumps(result,indent=2)+'\n').encode());f.flush();os.fsync(f.fileno())
 print(json.dumps({k:v for k,v in result.items()if k!='result'}));return r.returncode
if __name__=='__main__':sys.exit(main())
