#!/usr/bin/env python3
"""Start only an isolated read-only shadow; no production stop or timer changes."""
import hashlib,json,os,pathlib,shlex,subprocess,sys
RELEASE='38ac6e2bff2a-20261003T040230Z'
REMOTE=r'''
import datetime,fcntl,hashlib,json,os,pathlib,pwd,signal,stat,subprocess,time,urllib.request
RELEASE='38ac6e2bff2a-20261003T040230Z';ROOT=pathlib.Path('/data/proofofwork-release-backups/audit30-node-release-'+RELEASE);TOOLS=pathlib.Path('/var/tmp/proofofwork-deploy/audit29-tools');UNIT='proofofwork-audit29-shadow-'+RELEASE+'.service';ENV={'PATH':'/usr/sbin:/usr/bin:/sbin:/bin','LC_ALL':'C','GIT_OPTIONAL_LOCKS':'0','GIT_CONFIG_NOSYSTEM':'1','GIT_CONFIG_GLOBAL':'/dev/null'}
PINS={'private-env.py':'99cbe9cd118c63b08480efd28c2ae7c059b5204daef8db08b896a38fc791d515','shadow-entry.mjs':'48da4605178d43d1cfbf7b33aeb45c1a64e9474913d8e51d1513904dd8d4bf4d','attest-node.py':'4bec20fa1e5931636e3bfc84f617f005a7b1b71e752dc7f7c9b8bea23014be38'}
def need(v,m):
 if not v:raise ValueError(m)
def stamp(s):return (s.st_dev,s.st_ino,s.st_mode,s.st_uid,s.st_gid,s.st_nlink,s.st_size,s.st_mtime_ns,s.st_ctime_ns)
def read(p,cap=1024*1024,expected=None):
 p=pathlib.Path(p);s=p.lstat();need(p.resolve()==p and stat.S_ISREG(s.st_mode)and s.st_uid==s.st_gid==0 and stat.S_IMODE(s.st_mode)==0o600 and s.st_nlink==1 and s.st_size<=cap,'PRIVATE_FILE_SHAPE');fd=os.open(p,os.O_RDONLY|os.O_NOFOLLOW|os.O_NOATIME)
 try:
  b=os.read(fd,cap+1);need(len(b)==s.st_size and stamp(os.fstat(fd))==stamp(s)==stamp(p.lstat()),'PRIVATE_FILE_DRIFT');need(expected is None or hashlib.sha256(b).hexdigest()==expected,'PRIVATE_FILE_SHA');return b
 finally:os.close(fd)
def write(name,value):
 fd=os.open(ROOT/name,os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW,0o600)
 with os.fdopen(fd,'wb')as f:f.write((json.dumps(value,sort_keys=True)+'\n').encode());f.flush();os.fsync(f.fileno())
 d=os.open(ROOT,os.O_RDONLY|os.O_DIRECTORY|os.O_NOFOLLOW)
 try:os.fsync(d)
 finally:os.close(d)
def call(argv,timeout=20):
 r=subprocess.run(argv,env=ENV,capture_output=True,timeout=timeout);need(r.returncode==0 and not r.stderr and len(r.stdout)<=65536,'REVIEWED_COMMAND_REFUSED');return r.stdout
KEYS=['LoadState','ActiveState','SubState','MainPID','InvocationID','User','Group','KillMode','RuntimeMaxUSec','ControlGroup','ExecStart']
def state(u):return dict(x.split('=',1)for x in call(['/usr/bin/systemctl','show',u,*['--property='+k for k in KEYS]]).decode().splitlines()if '='in x)
def stop_owned(inv):
 shape=state(UNIT)
 if shape.get('LoadState')=='not-found':return
 need(inv and shape.get('InvocationID')==inv and str(TOOLS/'private-env.py')in shape.get('ExecStart',''),'OWNED_SHADOW_IDENTITY_DRIFT');call(['/usr/bin/systemctl','stop',UNIT],40);need(state(UNIT).get('MainPID','0')=='0','SHADOW_STOP_REFUSED')
def interrupted(s,f):raise RuntimeError('SHADOW_PREPARE_SIGNAL')
need(os.geteuid()==os.getegid()==0,'ROOT');s=ROOT.lstat();need(ROOT.resolve()==ROOT and s.st_uid==s.st_gid==0 and stat.S_IMODE(s.st_mode)==0o700,'RELEASE_ROOT')
lock=pathlib.Path('/run/proofofwork-audit29-ops.lock');ls=lock.lstat();need(lock.resolve()==lock and stat.S_ISREG(ls.st_mode)and ls.st_uid==ls.st_gid==0 and stat.S_IMODE(ls.st_mode)==0o600 and ls.st_nlink==1,'OPS_LOCK_SHAPE');lfd=os.open(lock,os.O_RDWR|os.O_NOFOLLOW);need(stamp(os.fstat(lfd))==stamp(ls),'OPS_LOCK_OPEN');fcntl.flock(lfd,fcntl.LOCK_EX|fcntl.LOCK_NB);need(stamp(os.fstat(lfd))==stamp(ls)==stamp(lock.lstat()),'OPS_LOCK_AFTER_ACQUISITION')
for name,pin in PINS.items():read(TOOLS/name,2*1024**2,pin)
candidate=read(ROOT/'candidate.tsv',65536,'98343f1ecff80e2b203355a2272df966cc108b0a89890c9d3fabfd5b0b8e084d');old=read(ROOT/'old-live.tsv',65536,'ecb2f2b7dde7253af35252109aab003666dca54b51ff6c81f719315fb2dc6bf6');attestor=['/usr/bin/python3','-I','-B',str(TOOLS/'attest-node.py')];need(call(attestor+['/opt/proofofwork-api'],180)==old and call(attestor+['/opt/proofofwork-api-stage-'+RELEASE],180)==candidate,'FULL_ATTESTATION_DRIFT')
live=['bitcoind.service','electrs.service','postgresql@16-main.service','proofofwork-api.service','proofofwork-indexer-worker.service'];before={u:{k:v for k,v in state(u).items()if k in ['LoadState','ActiveState','SubState','MainPID','InvocationID']}for u in live};need(all(v['ActiveState']=='active'and int(v['MainPID'])>0 for v in before.values()),'LIVE_SERVICES');need(state(UNIT)['LoadState']=='not-found','SHADOW_UNIT_EXISTS');need(not os.path.lexists('/run/proofofwork-audit5-'+RELEASE)and not os.path.lexists('/data/proofofwork-api-cache-shadow-'+RELEASE),'SHADOW_PRIVATE_PATH_EXISTS')
signal.signal(signal.SIGTERM,interrupted);signal.signal(signal.SIGINT,interrupted);inv=''
try:
 write('shadow-preparation-intent.json',dict(schema='pow-audit30-node-readonly-shadow-intent-v1',unit=UNIT,candidateAttestationSha256=hashlib.sha256(candidate).hexdigest(),oldAttestationSha256=hashlib.sha256(old).hexdigest(),productionDataMutation=False,productionStop=False,timerChanges=False))
 capture=call(['/usr/bin/python3','-I','-B',str(TOOLS/'private-env.py'),'capture','--release-id',RELEASE],30);cache=call(['/usr/bin/python3','-I','-B',str(TOOLS/'private-env.py'),'prepare-shadow-cache','--release-id',RELEASE],30)
 argv=['/usr/bin/systemd-run','--quiet','--unit='+UNIT,'--service-type=exec','--property=User=root','--property=Group=root','--property=KillMode=control-group','--property=RuntimeMaxSec=45min','--property=TimeoutStopSec=30s','--property=MemoryMax=4G','--property=MemorySwapMax=0','--property=CPUQuota=100%','--property=TasksMax=128','--property=UMask=0077','/usr/bin/python3','-I','-B',str(TOOLS/'private-env.py'),'launch','--release-id',RELEASE,'--mode','readonly-shadow','--source','api'];call(argv,30)
 initial=state(UNIT);inv=initial.get('InvocationID','');need(inv and initial.get('KillMode')=='control-group'and initial.get('RuntimeMaxUSec')=='45min','SHADOW_MANAGED_UNIT');health=None;start=time.monotonic()
 while time.monotonic()-start<120:
  current=state(UNIT);need(current.get('InvocationID')==inv and current.get('ActiveState')=='active','SHADOW_STOPPED')
  try:
   with urllib.request.urlopen('http://127.0.0.1:18081/health',timeout=3)as response:
    data=response.read(65537);need(len(data)<=65536 and response.status==200,'SHADOW_HEALTH_BOUND');health=dict(status=response.status,bytes=len(data),sha256=hashlib.sha256(data).hexdigest());break
  except (OSError,TimeoutError):time.sleep(.5)
 need(health is not None,'SHADOW_HEALTH_DEADLINE');pid=int(current['MainPID']);account=pwd.getpwnam('powadmin');p=pathlib.Path('/proc')/str(pid);status=dict(x.split(':',1)for x in (p/'status').read_text().splitlines()if ':'in x);need([int(x)for x in status['Uid'].split()]==[account.pw_uid]*4 and os.readlink(p/'exe')=='/opt/node-v24.18.0-linux-x64/bin/node'and os.readlink(p/'cwd')=='/opt/proofofwork-api-stage-'+RELEASE,'SHADOW_PROCESS_IDENTITY')
 after={u:{k:v for k,v in state(u).items()if k in ['LoadState','ActiveState','SubState','MainPID','InvocationID']}for u in live};need(before==after and call(attestor+['/opt/proofofwork-api'],180)==old,'LIVE_IDENTITY_CHANGED');manifest=json.loads(read('/run/proofofwork-audit5-'+RELEASE+'/capture.json'))
 report=dict(schema='pow-audit30-node-readonly-shadow-prepared-v1',atUtc=datetime.datetime.now(datetime.timezone.utc).isoformat(),ok=True,unit=UNIT,invocationID=inv,mainPID=pid,health=health,readonlyEntrypointSha256=PINS['shadow-entry.mjs'],candidateAttestationSha256=hashlib.sha256(candidate).hexdigest(),oldAttestationSha256=hashlib.sha256(old).hexdigest(),environmentCapturePath='/run/proofofwork-audit5-'+RELEASE,environmentApiSHA256=manifest['processes']['api']['environmentSha256'],liveServices=before,liveServicesUnchanged=True,productionDataMutation=False,productionStop=False,timerChanges=False,strictVerifierPassed=False)
 write('shadow-prepared.json',report);print(json.dumps(report,sort_keys=True))
except BaseException as e:
 signal.signal(signal.SIGTERM,signal.SIG_IGN);signal.signal(signal.SIGINT,signal.SIG_IGN);cleanup=[]
 try:
  if not inv:inv=state(UNIT).get('InvocationID','')
  stop_owned(inv)
 except BaseException as c:cleanup.append(type(c).__name__)
 write('shadow-preparation-failed.json',dict(schema='pow-audit30-node-readonly-shadow-failed-v1',errorClass=type(e).__name__,cleanupErrors=cleanup,productionStop=False,timerChanges=False));raise
finally:os.close(lfd)
'''
def main(out):
 ssh=['ssh','-i','/home/sixer/.ssh/proofofwork_node_ed25519','-o','BatchMode=yes','-o','IdentitiesOnly=yes','-o','StrictHostKeyChecking=yes','-o','ConnectTimeout=10','powadmin@65.108.122.87',shlex.join(['sudo','-n','/usr/bin/python3','-I','-B','-c',REMOTE])];r=subprocess.run(ssh,capture_output=True,timeout=600)
 for suffix,raw in [('.stdout',r.stdout),('.stderr',r.stderr)]:
  with pathlib.Path(str(out)+suffix).open('xb')as f:f.write(raw);f.flush();os.fsync(f.fileno())
 receipt=dict(schema='pow-audit30-node-readonly-shadow-transport-v1',returncode=r.returncode,sourceSHA256=hashlib.sha256(pathlib.Path(__file__).read_bytes()).hexdigest(),stdoutSHA256=hashlib.sha256(r.stdout).hexdigest(),stderrSHA256=hashlib.sha256(r.stderr).hexdigest(),result=json.loads(r.stdout)if r.returncode==0 else None)
 with out.open('xb')as f:f.write((json.dumps(receipt,indent=2)+'\n').encode());f.flush();os.fsync(f.fileno())
 print(json.dumps({k:v for k,v in receipt.items()if k!='result'}));return r.returncode
if __name__=='__main__':sys.exit(main(pathlib.Path(sys.argv[1])))
