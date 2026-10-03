#!/usr/bin/python3 -I
"""Narrow creation-only adaptation of accepted stream bootstrap capture helpers.
Completes the retained sample; no body redo/new schema/source7 start/live change.
"""
import base64,datetime as dt,hashlib,json,os,pwd,re,selectors,signal,stat,subprocess,sys,time,types
from pathlib import Path
APPROVAL='6821c987b9a5d110fbe9fb2820955b7cbc26dda9faddb67667fc49e892f5c820'
BASE=Path('/usr/local/lib/proofofwork-audit30-stream-completion')
OLD=Path('/usr/local/lib/proofofwork-audit30-transition-stream/20261003T030000Z')
SOURCE=Path('/data/proofofwork-audit30-restore-20261002T234651Z')
JOB=Path('/data/proofofwork-audit30-inspect-20261003T014100Z')
CONTROLLER_SHA='ecb2b237b93ebd0bde96e5d7d690abbda5b9fa92aaeb0fea47c23e169acf4e8e'
PINS={'restore-latest-logical.py':'26c7656b2e751c6de50122c65f8af73686c2d2674bee8be86a3c5648b7fcc80e','original-plan.json':'1305543f3749c8e2bd7232d9d494f23896e7153c2c761bf23f1ee552425952fe','sealed-logical-inventory.json':'f30301ca4f4769cfbbd995dc7627580be543e6cddfc1f5b3ff4aba033a48f572'}
SHA=re.compile(r'[0-9a-f]{64}');RUN=re.compile(r'[0-9]{8}T[0-9]{6}Z');META={'device','inode','mode','uid','gid','bytes','mtimeNs','ctimeNs','nlink'}
class BootstrapInterrupted(RuntimeError):pass
class NotReady(RuntimeError):pass
def pairs(rows):
 d={}
 for k,v in rows:
  if k in d:raise ValueError('Duplicate JSON key')
  d[k]=v
 return d
def encoded(v):return json.dumps(v,sort_keys=True,separators=(',',':')).encode()
def metadata(p):
 s=Path(p).lstat();return dict(device=s.st_dev,inode=s.st_ino,mode=stat.S_IMODE(s.st_mode),uid=s.st_uid,gid=s.st_gid,bytes=s.st_size,mtimeNs=s.st_mtime_ns,ctimeNs=s.st_ctime_ns,nlink=s.st_nlink)
def canonical(p):
 p=Path(p)
 if not p.is_absolute() or p.resolve(strict=True)!=p:raise ValueError('Noncanonical input')
 return p
def read_bound(p,m,sha,limit,uid=0,gid=0,mode=0o600):
 p=canonical(p)
 if set(m)!=META or m['uid']!=uid or m['gid']!=gid or m['mode']!=mode or m['nlink']!=1 or m['bytes']>limit or metadata(p)!=m or not stat.S_ISREG(p.lstat().st_mode) or os.listxattr(p,follow_symlinks=False) or not SHA.fullmatch(sha):raise ValueError('Unsafe bound immutable input')
 raw=p.read_bytes()
 if metadata(p)!=m or hashlib.sha256(raw).hexdigest()!=sha:raise ValueError('Input drift')
 return raw
def fsyncdir(p):
 fd=os.open(p,os.O_RDONLY|os.O_DIRECTORY|os.O_NOFOLLOW)
 try:os.fsync(fd)
 finally:os.close(fd)
def create(p,raw,mode,gid,uid=0):
 fd=os.open(p,os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW,mode)
 with os.fdopen(fd,'wb') as f:f.write(raw);f.flush();os.fchown(f.fileno(),uid,gid);os.fchmod(f.fileno(),mode);os.fsync(f.fileno())
 fsyncdir(Path(p).parent)
def newdir(p,uid,gid,mode):
 Path(p).mkdir(mode=mode);os.chown(p,uid,gid);os.chmod(p,mode);fsyncdir(Path(p).parent)
def unit_new(unit):
 r=subprocess.run(['/usr/bin/systemctl','show',unit,'-p','LoadState','--value'],capture_output=True,text=True,timeout=10)
 if r.returncode or r.stderr or r.stdout.strip()!='not-found':raise ValueError('Unit exists or cannot be established absent')
def capacity(copy=False):
 data=os.statvfs('/data');root=os.statvfs('/')
 if data.f_bavail*data.f_frsize < (100+(80 if copy else 0))*1024**3 or root.f_bavail*root.f_frsize<10*1024**3:raise ValueError('Restore reserve insufficient')

def capture_unit(cmd,target,unit,timeout,maximum,expected_argv):
 # Stream to exclusive root600 evidence; bound both channels and wall time.
 outfd=os.open(target,os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW,0o600);errpath=Path(str(target)+'.stderr');errfd=os.open(errpath,os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW,0o600)
 proc=None;owned=None;floor=int(time.monotonic()*1000000);selectors_=selectors.DefaultSelector();counts={'out':0,'err':0};deadline=time.monotonic()+timeout
 try:
  proc=subprocess.Popen(cmd,stdin=subprocess.DEVNULL,stdout=subprocess.PIPE,stderr=subprocess.PIPE,start_new_session=True)
  for label,pipe in [('out',proc.stdout),('err',proc.stderr)]:os.set_blocking(pipe.fileno(),False);selectors_.register(pipe,selectors.EVENT_READ,label)
  while selectors_.get_map():
   if time.monotonic()>deadline:raise TimeoutError('Private unit capture deadline')
   if owned is None:
    try:owned=owned_unit(unit,expected_argv,floor,None)
    except NotReady:pass
   for key,_ in selectors_.select(.25):
    raw=os.read(key.fileobj.fileno(),65536)
    if not raw:selectors_.unregister(key.fileobj);continue
    label=key.data;counts[label]+=len(raw)
    if counts[label]>(maximum if label=='out' else 8*1024**2):raise ValueError('Private unit capture bound')
    fd=outfd if label=='out' else errfd
    view=memoryview(raw)
    while view:view=view[os.write(fd,view):]
  code=proc.wait(timeout=max(1,deadline-time.monotonic()))
  os.fsync(outfd);os.fsync(errfd);fsyncdir(Path(target).parent)
  if code or counts['err']:raise RuntimeError('Private unit refused; exact capture preserved')
  terminal=terminal_unit(unit,owned)
  return dict(channels=counts,observedInvocation=owned,systemdWaitExitCode=code,rootWaitSucceeded=True,terminal=terminal,unitStoppedAtEndpoint=True,privateClusterStoppedCertifiedByCapture=False)
 except BaseException as first_error:
  for sig in(signal.SIGINT,signal.SIGTERM,signal.SIGHUP):signal.signal(sig,signal.SIG_IGN)
  # Preserve cleanup outcome; never turn the first failure into success.
  cleanup={'attempted':False,'errors':[],'terminal':None,'unitStoppedAtEndpoint':False}
  try:
   if owned is None:owned=owned_unit(unit,expected_argv,floor,None)
   owned_unit(unit,expected_argv,floor,owned);cleanup['attempted']=True
   stop=subprocess.run(['/usr/bin/systemctl','stop',unit],timeout=95,capture_output=True)
   if stop.returncode:raise RuntimeError('Owned unit stop refused')
   cleanup['terminal']=terminal_unit(unit,owned);cleanup['unitStoppedAtEndpoint']=True
  except BaseException as cleanup_error:cleanup['errors'].append({'phase':'owned-unit-stop','errorClass':type(cleanup_error).__name__})
  if proc and proc.poll() is None:
   try:os.killpg(proc.pid,signal.SIGKILL)
   except ProcessLookupError:pass
   try:proc.wait(timeout=10)
   except BaseException as client_error:cleanup['errors'].append({'phase':'owned-client-reap','errorClass':type(client_error).__name__})
  failure=dict(schema='pow-audit30-retained-completion-root-capture-failed-v1',status='failed',firstErrorClass=type(first_error).__name__,firstReasonSha256=hashlib.sha256(str(first_error).encode()).hexdigest(),observedInvocation=owned,cleanup=cleanup,channels=counts,automaticRetry=False,privateClusterStoppedCertifiedByCapture=False)
  try:
   os.fsync(outfd);os.fsync(errfd);fsyncdir(Path(target).parent);record(Path(str(target)+'.failed.json'),failure)
  except BaseException as receipt_error:raise RuntimeError('Root capture failure receipt unavailable: '+type(first_error).__name__+'/'+type(receipt_error).__name__)from first_error
  raise
 finally:
  selectors_.close()
  if proc:
   if proc.stdout:proc.stdout.close()
   if proc.stderr:proc.stderr.close()
  os.close(outfd);os.close(errfd)


def fixed_command(args):
 r=subprocess.run(args,capture_output=True,timeout=10,env={'PATH':'/usr/bin:/bin','LC_ALL':'C'})
 if r.returncode or len(r.stdout)>65536 or len(r.stderr)>65536:raise NotReady('Typed unit not ready')
 return r.stdout

def owned_unit(unit,argv,floor,owned):
 fields=['LoadState','User','Group','Type','Transient','MainPID','InvocationID','ControlGroup']
 d=dict(x.split('=',1)for x in fixed_command(['/usr/bin/systemctl','show',unit,*sum((['-p',x]for x in fields),[])]).decode().splitlines())
 if d.get('LoadState')!='loaded' or not re.fullmatch('[0-9a-f]{32}',d.get('InvocationID','')):raise NotReady('No loaded invocation')
 if d.get('User')!='postgres' or d.get('Group')!='postgres' or d.get('Type')!='exec' or d.get('Transient')!='yes' or (owned is not None and d['InvocationID']!=owned):raise ValueError('Wrong unit owner/invocation')
 path='/org/freedesktop/systemd1/unit/'+''.join(c if c.isascii()and c.isalnum()else '_'+format(ord(c),'02x')for c in unit)
 o=json.loads(fixed_command(['/usr/bin/busctl','--system','--json=short','call','org.freedesktop.systemd1','/org/freedesktop/systemd1','org.freedesktop.systemd1.Manager','GetUnit','s',unit]),object_pairs_hook=pairs)
 if o!={'type':'o','data':[path]}:raise ValueError('Exact typed unit object differs')
 t=json.loads(fixed_command(['/usr/bin/busctl','--system','--json=short','get-property','org.freedesktop.systemd1',path,'org.freedesktop.systemd1.Service','ExecStart']),object_pairs_hook=pairs)
 if t.get('type')!='a(sasbttttuii)' or not isinstance(t.get('data'),list)or len(t['data'])!=1:raise ValueError('Typed ExecStart shape')
 e=t['data'][0]
 if not isinstance(e,list)or len(e)!=10 or e[0]!=argv[0]or e[1]!=argv or e[2]is not False or any(type(n)is not int for n in e[3:]):raise ValueError('Exact typed command differs')
 if e[4]==0:raise NotReady('Command not started')
 if e[4]<floor:raise ValueError('Unit start predates admitted launch')
 if d.get('MainPID','').isdigit()and int(d['MainPID'])>0 and d['ControlGroup']!='/system.slice/'+unit:raise ValueError('Live command cgroup differs')
 return d['InvocationID']

def record(path,value):
 raw=encoded(value);fd=os.open(path,os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW,0o600)
 with os.fdopen(fd,'wb')as f:f.write(raw);f.flush();os.fsync(f.fileno())
 fsyncdir(path.parent)

def terminal_unit(unit,owned):
 if not isinstance(owned,str)or not re.fullmatch('[0-9a-f]{32}',owned):raise ValueError('No independently observed invocation')
 fields=['LoadState','ActiveState','SubState','MainPID','InvocationID','User','Group','Type','Transient']
 d=dict(x.split('=',1)for x in fixed_command(['/usr/bin/systemctl','show',unit,*sum((['-p',x]for x in fields),[])]).decode().splitlines())
 gc=(d.get('LoadState')=='not-found'and d.get('MainPID')=='0'and d.get('InvocationID')==''and d.get('ActiveState')=='inactive'and d.get('SubState')=='dead')
 retained=(d.get('LoadState')=='loaded'and d.get('MainPID')=='0'and d.get('InvocationID')==owned and d.get('ActiveState')in('inactive','failed')and d.get('User')=='postgres'and d.get('Group')=='postgres'and d.get('Type')=='exec'and d.get('Transient')=='yes')
 if not gc and not retained:raise ValueError('Owned unit endpoint not stopped')
 return dict(properties=d,qualifiedGarbageCollected=gc,observedInvocation=owned,continuousExclusionCertified=False)

def decode_request(v):
 keys={'schema','approvalSha256','mode','runId','host','controllerBase64','planBase64','planSha256'}
 if not isinstance(v,dict)or set(v)!=keys or v['schema']!='pow-audit30-retained-completion-bootstrap-request-v1'or v['approvalSha256']!=APPROVAL or v['mode']not in('prepare','run')or v['host']!='pow-bitcoin-01':raise ValueError('Exact completion request')
 rid=v['runId']
 if not isinstance(rid,str)or not RUN.fullmatch(rid)or dt.datetime.strptime(rid,'%Y%m%dT%H%M%SZ').strftime('%Y%m%dT%H%M%SZ')!=rid:raise ValueError('Calendar run ID')
 code=base64.b64decode(v['controllerBase64'],validate=True);raw=base64.b64decode(v['planBase64'],validate=True)
 if len(code)!=26605 or hashlib.sha256(code).hexdigest()!=CONTROLLER_SHA or len(raw)>65536 or not SHA.fullmatch(v['planSha256'])or hashlib.sha256(raw).hexdigest()!=v['planSha256']:raise ValueError('Exact source/plan bytes')
 p=json.loads(raw,object_pairs_hook=pairs)
 if encoded(p)!=raw or p.get('runId')!=rid or p.get('host')!=v['host']or p.get('controllerSha256')!=CONTROLLER_SHA or p.get('unit')!='proofofwork-audit30-stream-completion-'+rid+'.service'or p.get('approvalSha256')!=APPROVAL:raise ValueError('Canonical fixed plan identity')
 compile(code,'controller.py','exec');return code,raw,p

def load(package):
 raw=read_bound(package/'controller.py',metadata(package/'controller.py'),CONTROLLER_SHA,65536,0,112,0o440);m=types.ModuleType('retained_completion');m.__file__=str(package/'controller.py');exec(compile(raw,m.__file__,'exec'),m.__dict__);m.load();return m

def properties(package):
 return dict(Type='exec',Restart='no',CPUQuota='100%',CPUWeight='10',MemoryHigh=str(6*1024**3),MemoryMax=str(8*1024**3),TasksMax='64',IOWeight='10',Nice='15',RuntimeMaxSec='15min',TimeoutStopSec='90s',KillMode='control-group',UMask='0077',NoNewPrivileges='yes',PrivateNetwork='yes',PrivateTmp='yes',PrivateIPC='yes',PrivateDevices='yes',ProtectSystem='strict',ProtectHome='yes',ProtectKernelTunables='yes',ProtectKernelModules='yes',ProtectControlGroups='yes',RestrictAddressFamilies='AF_UNIX',CapabilityBoundingSet='',AmbientCapabilities='',ReadWritePaths=str(JOB),ReadOnlyPaths='/data/proofofwork-postgres-backups/logical '+str(SOURCE),InaccessiblePaths='/var/lib/postgresql /run/postgresql /data/proofofwork-postgres-tablespaces -/data/proofofwork-postgres-backups/physical /etc/proofofwork-api '+str(SOURCE/'socket'),LoadCredential='completion-plan:'+str(package/'reviewed-plan.json'))

def command(unit,package,h):
 argv=['/usr/bin/python3','-I','-B',str(package/'controller.py'),'--plan','/run/credentials/'+unit+'/completion-plan','--plan-sha256',h]
 cmd=['/usr/bin/systemd-run','--unit='+unit.removesuffix('.service'),'--description=Audit30 retained private sample completion','--wait','--pipe','--quiet','--uid=postgres','--gid=postgres',*['--property='+k+'='+v for k,v in properties(package).items()],*argv]
 return cmd,argv

def main():
 if os.geteuid()!=0 or not sys.flags.isolated or os.uname().nodename!='pow-bitcoin-01':raise ValueError('Root isolated fixed-host admission only')
 os.umask(0o077);raw=sys.stdin.buffer.read(262145)
 if len(raw)>262144:raise ValueError('Typed request bound')
 v=json.loads(raw,object_pairs_hook=pairs);code,planraw,p=decode_request(v);package=BASE/v['runId'];unit=p['unit'];pg=pwd.getpwnam('postgres')
 if(pg.pw_uid,pg.pw_gid)!=(108,112):raise ValueError('Exact PG role identity')
 capacity(False);unit_new(unit)
 if v['mode']=='prepare':
  if os.path.lexists(package):raise ValueError('New completion package already exists')
  if not BASE.exists():newdir(BASE,0,112,0o750)
  bm=metadata(canonical(BASE))
  if bm['uid']!=0 or bm['gid']!=112 or bm['mode']!=0o750 or not BASE.is_dir()or os.listxattr(BASE,follow_symlinks=False):raise ValueError('Canonical private package parent')
  members={'controller.py':code}
  for name,h in PINS.items():
   src=OLD/('reviewed-plan.json'if name=='original-plan.json'else name);m=metadata(src);members[name]=read_bound(src,m,h,1024**2,0,0 if name=='original-plan.json'else 112,0o600 if name=='original-plan.json'else 0o440)
  newdir(package,0,112,0o750)
  for name,b in members.items():create(package/name,b,0o440,112)
  create(package/'reviewed-plan.json',planraw,0o600,0)
  mod=load(package);mod.validate(p);mod.package(p);mod.previous(mod.package(p)[0]);mod.previous_completion();mod.inputs(p);mod.S.check_window(p);mod.G.check_live(p)
  result=dict(schema='pow-audit30-retained-completion-package-prepared-v1',mode='prepare',package=str(package),planSha256=v['planSha256'],controllerSha256=CONTROLLER_SHA,nativeUnitLaunched=False,productionMutation=False)
 else:
  mod=load(package);mod.validate(p);mod.package(p);rootplan=read_bound(package/'reviewed-plan.json',metadata(package/'reviewed-plan.json'),v['planSha256'],65536)
  if rootplan!=planraw:raise ValueError('Prepared reviewed plan differs')
  mod.S.check_window(p);mod.G.check_live(p);mod.previous(mod.package(p)[0]);mod.previous_completion();mod.inputs(p);capacity(False)
  cmd,argv=command(unit,package,v['planSha256']);capture=capture_unit(cmd,package/'completion-run-capture.json',unit,1050,1024**2,argv)
  mod.S.check_window(p);mod.G.check_live(p);mod.package(p);mod.previous_completion()
  result=dict(schema='pow-audit30-retained-completion-root-run-v1',mode='run',package=str(package),unit=unit,planSha256=v['planSha256'],rootCapturePassed=True,capture=capture,productionMutation=False,originalFailedAttemptPreserved=True)
 print(json.dumps(result,sort_keys=True),flush=True)
if __name__=='__main__':
 old={s:signal.signal(s,lambda *_:(_ for _ in()).throw(BootstrapInterrupted('Root admission interrupted')))for s in(signal.SIGTERM,signal.SIGINT,signal.SIGHUP)}
 try:main()
 except BaseException as e:print(json.dumps(dict(status='refused',errorClass=type(e).__name__,rawDetailsSuppressed=True,creationOnlyEvidenceRetained=True,automaticRetry=False),sort_keys=True),file=sys.stderr);sys.exit(1)
 finally:
  for sig,handler in old.items():signal.signal(sig,handler)
