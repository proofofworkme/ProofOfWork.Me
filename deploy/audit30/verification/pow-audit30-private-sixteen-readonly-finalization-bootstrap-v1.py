#!/usr/bin/python3 -I
"""Narrow creation-only adaptation of accepted stream bootstrap capture helpers.
Private014100 READ ONLY finalization; no writer or production/source7 start.
"""
import base64,datetime as dt,hashlib,json,os,pwd,re,selectors,signal,stat,subprocess,sys,time,types
from pathlib import Path
APPROVAL='6821c987b9a5d110fbe9fb2820955b7cbc26dda9faddb67667fc49e892f5c820'
BASE=Path('/usr/local/lib/proofofwork-audit30-private-sixteen')
OLD=Path('/usr/local/lib/proofofwork-audit30-transition-stream/20261003T030000Z')
SOURCE=Path('/data/proofofwork-audit30-restore-20261002T234651Z')
JOB=Path('/data/proofofwork-audit30-inspect-20261003T014100Z')
MATH_DIR=JOB/'stream-completion-v2'/'onhost-math-completion-v2'
CONTROLLER_SHA='526444998a823cdc889473238642f42ea6355bb699027d014fab3951de45834b'
PINS={'restore-latest-logical.py':'26c7656b2e751c6de50122c65f8af73686c2d2674bee8be86a3c5648b7fcc80e','pow-audit30-mail-body-repair-rehearsal-v2.mjs':'ea5614fddc0ef7fb696d0159a141b25116fbd6ba2c4b309db171a548b7f8b70c','original-transaction-engine.mjs':'09b3240e45d76278a67053f5fba6009cccce36b00c1b098d38d7435da978dc58','phase4-private-plan.json':'4ac3a8d9b4b79befd36abc590731b1bc8f2e6c83919d5f6427c34c58a6ddba00'}
ADAPTER_SHA='4e569cfba47b82ead715a2fba8b9f84c5c113f12dbbbb4986dc5fd8921adc498'
LIBRARY_SHA='2e9a7fb67616e46b3b14d1074dc5206eb280df6868cc249943645b8d8ab685da'
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
  failure=dict(schema='pow-audit30-private-sixteen-readonly-finalization-root-capture-failed-v1',status='failed',firstErrorClass=type(first_error).__name__,firstReasonSha256=hashlib.sha256(str(first_error).encode()).hexdigest(),observedInvocation=owned,cleanup=cleanup,channels=counts,automaticRetry=False,privateClusterStoppedCertifiedByCapture=False)
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
 keys={'schema','approvalSha256','mode','runId','host','controllerBase64','adapterBase64','libraryBase64','privateAdmissionBase64','planBase64','planSha256'}
 if not isinstance(v,dict)or set(v)!=keys or v['schema']!='pow-audit30-private-sixteen-readonly-finalization-bootstrap-request-v1'or v['approvalSha256']!=APPROVAL or v['mode']not in('prepare','run')or v['host']!='pow-bitcoin-01':raise ValueError('Exact completion request')
 rid=v['runId']
 if not isinstance(rid,str)or not RUN.fullmatch(rid)or dt.datetime.strptime(rid,'%Y%m%dT%H%M%SZ').strftime('%Y%m%dT%H%M%SZ')!=rid:raise ValueError('Calendar run ID')
 code=base64.b64decode(v['controllerBase64'],validate=True);raw=base64.b64decode(v['planBase64'],validate=True)
 if len(code)!=34143 or hashlib.sha256(code).hexdigest()!=CONTROLLER_SHA or len(raw)>65536 or not SHA.fullmatch(v['planSha256'])or hashlib.sha256(raw).hexdigest()!=v['planSha256']:raise ValueError('Exact source/plan bytes')
 p=json.loads(raw,object_pairs_hook=pairs)
 if encoded(p)!=raw or p.get('runId')!=rid or p.get('host')!=v['host']or p.get('controllerSha256')!=CONTROLLER_SHA or p.get('unit')!='proofofwork-audit30-private-sixteen-'+rid+'.service'or p.get('approvalSha256')!=APPROVAL:raise ValueError('Canonical fixed plan identity')
 members={}
 for key,name,h,limit in [('adapterBase64','adapter.mjs',ADAPTER_SHA,16384),('libraryBase64','pow-audit30-mail-body-exact-sixteen-write-candidate-v1.mjs',LIBRARY_SHA,32768)]:
  b=base64.b64decode(v[key],validate=True)
  if len(b)>limit or hashlib.sha256(b).hexdigest()!=h:raise ValueError('Exact private adapter/library bytes')
  members[name]=b
 admission=base64.b64decode(v['privateAdmissionBase64'],validate=True)
 if len(admission)>32768 or hashlib.sha256(admission).hexdigest()!=p.get('adapterAdmissionSha256'):raise ValueError('Private admission raw SHA')
 if encoded(json.loads(admission,object_pairs_hook=pairs))!=admission:raise ValueError('Private admission canonical bytes')
 members['private-sixteen-write-admission.json']=admission
 compile(code,'controller.py','exec');return code,raw,p,members

def load(package):
 raw=read_bound(package/'controller.py',metadata(package/'controller.py'),CONTROLLER_SHA,65536,0,112,0o440);m=types.ModuleType('retained_completion');m.__file__=str(package/'controller.py');exec(compile(raw,m.__file__,'exec'),m.__dict__);m.load();return m

def properties(package):
 return dict(Type='exec',Restart='no',CPUQuota='100%',CPUWeight='10',MemoryHigh=str(6*1024**3),MemoryMax=str(8*1024**3),TasksMax='64',IOWeight='10',Nice='15',RuntimeMaxSec='15min',TimeoutStopSec='90s',KillMode='control-group',UMask='0077',NoNewPrivileges='yes',PrivateNetwork='yes',PrivateTmp='yes',PrivateIPC='yes',PrivateDevices='yes',ProtectSystem='strict',ProtectHome='yes',ProtectKernelTunables='yes',ProtectKernelModules='yes',ProtectControlGroups='yes',RestrictAddressFamilies='AF_UNIX',CapabilityBoundingSet='',AmbientCapabilities='',ReadWritePaths=str(JOB),ReadOnlyPaths='/data/proofofwork-postgres-backups/logical '+str(SOURCE)+' '+str(MATH_DIR),InaccessiblePaths='/var/lib/postgresql /run/postgresql /data/proofofwork-postgres-tablespaces -/data/proofofwork-postgres-backups/physical /etc/proofofwork-api '+str(SOURCE/'socket'),LoadCredential='private-sixteen-plan:'+str(package/'reviewed-plan.json'))

def command(unit,package,h):
 argv=['/usr/bin/python3','-I','-B',str(package/'controller.py'),'--plan','/run/credentials/'+unit+'/private-sixteen-plan','--plan-sha256',h]
 cmd=['/usr/bin/systemd-run','--unit='+unit.removesuffix('.service'),'--description=Audit30 private read-only receipt/fence/offline finalization','--wait','--pipe','--quiet','--uid=postgres','--gid=postgres',*['--property='+k+'='+v for k,v in properties(package).items()],*argv]
 return cmd,argv

def copy_dependencies(mod,package,original):
 # Only the original exact172 public-code dependency members, no private state.
 expected=mod.I.verify_pg_dependencies(OLD,original['phase4'])
 if expected['entries']!=172 or expected['regularBytes']!=443205:raise ValueError('Exact original dependency closure')
 for row in expected['records']:
  rel=row['path'];target=package/'pg-dependencies'if rel=='.'else package/'pg-dependencies'/rel
  if row['kind']=='directory':newdir(target,0,112,0o750)
  else:
   source=OLD/'pg-dependencies'/rel;raw=read_bound(source,row['metadata'],row['sha256'],64*1024**2,0,112,0o440);create(target,raw,0o440,112)
 if mod.I.verify_pg_dependencies(OLD,original['phase4'])!=expected:raise ValueError('Original dependency source changed during copy')
 mod.dependency_fence(package,original)

MATH_OBSERVER_BASE64='IyEvdXNyL2Jpbi9weXRob24zIC1JCiIiIkZpeGVkIHJvb3QtcHJpdmF0ZSBtYXRoIGV2aWRlbmNlIGFsbG9jYXRpb24vY3VzdG9keTsgbm8gY29udGVudCBleHBvcnRlZC4iIiIKaW1wb3J0IGhhc2hsaWIsanNvbixvcyxzaWduYWwsc3RhdCxzeXMsdGltZQpmcm9tIHBhdGhsaWIgaW1wb3J0IFBhdGgKUk9PVD1QYXRoKCcvZGF0YS9wcm9vZm9md29yay1hdWRpdDMwLWluc3BlY3QtMjAyNjEwMDNUMDE0MTAwWi9zdHJlYW0tY29tcGxldGlvbi12Mi9vbmhvc3QtbWF0aC1jb21wbGV0aW9uLXYyJykKUFJPT0Y9JzNkNjVmOThlMDNhYTM0MWVlZDg0OWQxNTA2MzM5Y2NkNjZhZjQ0M2Q2ZmNmOWNmMzNlNzk0Y2Q0MDczZWRjYWYnCmRlZiBlbmModik6cmV0dXJuIGpzb24uZHVtcHModixzb3J0X2tleXM9VHJ1ZSxzZXBhcmF0b3JzPSgnLCcsJzonKSkuZW5jb2RlKCkKZGVmIG1ldGEocyk6cmV0dXJuIGRpY3QoZGV2aWNlPXMuc3RfZGV2LGlub2RlPXMuc3RfaW5vLHVpZD1zLnN0X3VpZCxnaWQ9cy5zdF9naWQsbW9kZT1zdGF0LlNfSU1PREUocy5zdF9tb2RlKSxubGluaz1zLnN0X25saW5rLGJ5dGVzPXMuc3Rfc2l6ZSxtdGltZU5zPXMuc3RfbXRpbWVfbnMsY3RpbWVOcz1zLnN0X2N0aW1lX25zLGFsbG9jYXRlZEJ5dGVzPXMuc3RfYmxvY2tzKjUxMikKZGVmIG1vdW50cygpOgogcm93cz1bXQogZm9yIGxpbmUgaW4gUGF0aCgnL3Byb2Mvc2VsZi9tb3VudGluZm8nKS5yZWFkX3RleHQoKS5zcGxpdGxpbmVzKCk6CiAgdG9rZW49bGluZS5zcGxpdCgpWzRdCiAgaWYgdG9rZW49PXN0cihST09UKW9yIHRva2VuLnN0YXJ0c3dpdGgoc3RyKFJPT1QpKycvJyk6cm93cy5hcHBlbmQodG9rZW4pCiByZXR1cm4gcm93cwpkZWYgaW52ZW50b3J5KCk6CiBpZiBST09ULnJlc29sdmUoc3RyaWN0PVRydWUpIT1ST09UIG9yIG1vdW50cygpOnJhaXNlIFZhbHVlRXJyb3IoJ0Nhbm9uaWNhbCB1bm1vdW50ZWQgcm9vdC1wcml2YXRlIHRyZWUgcmVxdWlyZWQnKQogc3RhcnRlZD10aW1lLm1vbm90b25pYygpO3Jvd3M9W107dG90YWw9MDthbGxvY2F0ZWQ9MDtwcm9vZj1Ob25lCiBkZWYgd2FsayhwYXRoLHJlbCk6CiAgbm9ubG9jYWwgdG90YWwsYWxsb2NhdGVkLHByb29mCiAgaWYgdGltZS5tb25vdG9uaWMoKS1zdGFydGVkPjQ1IG9yIGxlbihyb3dzKT49MjU2OnJhaXNlIFZhbHVlRXJyb3IoJ0JvdW5kZWQgcHJpdmF0ZSBtYXRoIHRyZWUnKQogIHM9cGF0aC5sc3RhdCgpO209bWV0YShzKQogIGlmIHBhdGgucmVzb2x2ZShzdHJpY3Q9VHJ1ZSkhPXBhdGggb3IgbVsndWlkJ10hPTAgb3IgbVsnZ2lkJ10hPTAgb3Igb3MubGlzdHhhdHRyKHBhdGgsZm9sbG93X3N5bWxpbmtzPUZhbHNlKTpyYWlzZSBWYWx1ZUVycm9yKCdQcml2YXRlIHJvb3QgaWRlbnRpdHkgb3IgeGF0dHIgZHJpZnQnKQogIGtpbmQ9J2RpcmVjdG9yeScgaWYgc3RhdC5TX0lTRElSKHMuc3RfbW9kZSkgZWxzZSAnZmlsZScgaWYgc3RhdC5TX0lTUkVHKHMuc3RfbW9kZSkgZWxzZSBOb25lCiAgaWYga2luZCBpcyBOb25lIG9yKGtpbmQ9PSdkaXJlY3RvcnknYW5kIG1bJ21vZGUnXSE9MG83MDApb3Ioa2luZD09J2ZpbGUnYW5kKG1bJ21vZGUnXW5vdCBpbigwbzQwMCwwbzYwMClvciBtWydubGluayddIT0xKSk6cmFpc2UgVmFsdWVFcnJvcignRXhhY3Qgcm9vdC1wcml2YXRlIG5vLWFsaWFzIGN1c3RvZHknKQogIHJvdz1kaWN0KHBhdGg9cmVsLGtpbmQ9a2luZCxtZXRhZGF0YT1tKTtyb3dzLmFwcGVuZChyb3cpO2FsbG9jYXRlZCs9bVsnYWxsb2NhdGVkQnl0ZXMnXQogIGlmIGtpbmQ9PSdkaXJlY3RvcnknOgogICBmb3IgbmFtZSBpbiBzb3J0ZWQob3MubGlzdGRpcihwYXRoKSk6d2FsayhwYXRoL25hbWUsbmFtZSBpZiByZWw9PScuJ2Vsc2UgcmVsKycvJytuYW1lKQogICBpZiBtZXRhKHBhdGgubHN0YXQoKSkhPW06cmFpc2UgVmFsdWVFcnJvcignRGlyZWN0b3J5IGNoYW5nZWQgZHVyaW5nIGNlbnN1cycpCiAgZWxzZToKICAgdG90YWwrPW1bJ2J5dGVzJ10KICAgaWYgdG90YWw+NjQqMTAyNCoqMjpyYWlzZSBWYWx1ZUVycm9yKCdQcml2YXRlIGV2aWRlbmNlIGhhc2ggYnl0ZSBjYXAnKQogICBoPWhhc2hsaWIuc2hhMjU2KCk7ZmQ9b3Mub3BlbihwYXRoLG9zLk9fUkRPTkxZfG9zLk9fTk9GT0xMT1d8b3MuT19OT0FUSU1FKQogICB3aXRoIG9zLmZkb3BlbihmZCwncmInKWFzIGY6CiAgICBpZiBtZXRhKG9zLmZzdGF0KGYuZmlsZW5vKCkpKSE9bTpyYWlzZSBWYWx1ZUVycm9yKCdSb290IGV2aWRlbmNlIEZEIGRyaWZ0JykKICAgIGNvdW50PTAKICAgIHdoaWxlIGI6PWYucmVhZCgxMDI0KioyKToKICAgICBjb3VudCs9bGVuKGIpO2gudXBkYXRlKGIpCiAgICAgaWYgY291bnQ+bVsnYnl0ZXMnXW9yIHRpbWUubW9ub3RvbmljKCktc3RhcnRlZD40NTpyYWlzZSBWYWx1ZUVycm9yKCdSb290IGV2aWRlbmNlIGJvdW5kZWQgcmVhZCcpCiAgICBpZiBjb3VudCE9bVsnYnl0ZXMnXW9yIG1ldGEob3MuZnN0YXQoZi5maWxlbm8oKSkpIT1tIG9yIG1ldGEocGF0aC5sc3RhdCgpKSE9bTpyYWlzZSBWYWx1ZUVycm9yKCdSb290IGV2aWRlbmNlIGNoYW5nZWQgZHVyaW5nIGhhc2gnKQogICByb3dbJ3NoYTI1NiddPWguaGV4ZGlnZXN0KCkKICAgaWYgcmVsPT0nY29tcGxldGVkLmpzb24nOnByb29mPXJvdwogd2FsayhST09ULCcuJykKIGlmIG5vdCBwcm9vZiBvciBwcm9vZlsnc2hhMjU2J10hPVBST09GIG9yIHByb29mWydtZXRhZGF0YSddWydieXRlcyddIT0xMTc3NCBvciBwcm9vZlsnbWV0YWRhdGEnXVsnbW9kZSddIT0wbzYwMDpyYWlzZSBWYWx1ZUVycm9yKCdTYW1lIHZlcmlmaWVkIGFyaXRobWV0aWMgY29tcGxldGlvbiByZXF1aXJlZCcpCiBpZiBtb3VudHMoKTpyYWlzZSBWYWx1ZUVycm9yKCdNb3VudCBjaGFuZ2VkIGR1cmluZyBjZW5zdXMnKQogcmV0dXJuIGRpY3QocGF0aD1zdHIoUk9PVCksbWV0YWRhdGE9cm93c1swXVsnbWV0YWRhdGEnXSxlbnRyaWVzPWxlbihyb3dzKSxyZWd1bGFyQnl0ZXM9dG90YWwsYWxsb2NhdGVkQnl0ZXM9YWxsb2NhdGVkLHRyZWVTaGEyNTY9aGFzaGxpYi5zaGEyNTYoZW5jKHJvd3MpKS5oZXhkaWdlc3QoKSxjb21wbGV0ZWRTaGEyNTY9UFJPT0YsY29tcGxldGVkTWV0YWRhdGE9cHJvb2ZbJ21ldGFkYXRhJ10sbmVzdGVkTW91bnRzPTAsbm9TeW1saW5rcz1UcnVlLG5vSGFyZGxpbmtlZEZpbGVzPVRydWUsbm9YYXR0cnM9VHJ1ZSxyb290UHJpdmF0ZU9ubHk9VHJ1ZSkKZGVmIG1haW4oKToKIGlmIG5vdCBzeXMuZmxhZ3MuaXNvbGF0ZWQgb3Iob3MuZ2V0ZXVpZCgpLG9zLmdldGVnaWQoKSkhPSgwLDApb3Igb3MudW5hbWUoKS5ub2RlbmFtZSE9J3Bvdy1iaXRjb2luLTAxJyBvciBsZW4oc3lzLmFyZ3YpIT0xOnJhaXNlIFZhbHVlRXJyb3IoJ0ZpeGVkIHJvb3QgaGFzaC1vbmx5IG9ic2VydmVyJykKIHNpZ25hbC5zaWduYWwoc2lnbmFsLlNJR0FMUk0sbGFtYmRhICpfOihfIGZvciBfIGluKCkpLnRocm93KFJ1bnRpbWVFcnJvcignTWF0aCBhbGxvY2F0aW9uIGNlbnN1cyBkZWFkbGluZScpKSk7c2lnbmFsLmFsYXJtKDEwMCkKIGZpcnN0PWludmVudG9yeSgpO3NlY29uZD1pbnZlbnRvcnkoKQogaWYgZmlyc3QhPXNlY29uZDpyYWlzZSBWYWx1ZUVycm9yKCdXaG9sZSByb290LXByaXZhdGUgZXZpZGVuY2UgY2hhbmdlZCBiZXR3ZWVuIGNlbnN1c2VzJykKIHNpZ25hbC5hbGFybSgwKQogcHJpbnQoanNvbi5kdW1wcyhkaWN0KHNjaGVtYT0ncG93LWF1ZGl0MzAtcHJpdmF0ZS1zaXh0ZWVuLXJvb3QtbWF0aC1hbGxvY2F0aW9uLWNlbnN1cy12MScsc3RhdHVzPSdwYXNzZWQnLHJvb3RBY2NvdW50aW5nPWZpcnN0LHdob2xlVHJlZUhhc2hBbmRJZGVudGl0eUNoZWNrZWRUd2ljZT1UcnVlLHVucHJpdmlsZWdlZDEwOFRyYXZlcnNhbERlbmllZEJ5Um9vdDcwMD1UcnVlLHByaXZhY3lVbmNoYW5nZWQ9VHJ1ZSxleGNsdWRlZEZyb21CdWRnZXQ9RmFsc2UscHJvZHVjdGlvbk11dGF0aW9uPUZhbHNlLHJhd1ByaXZhdGVEYXRhRXhwb3J0ZWQ9RmFsc2UscG9zdGdyZXNTdGFydGVkPUZhbHNlLHNxbEV4ZWN1dGVkPUZhbHNlKSxzb3J0X2tleXM9VHJ1ZSkpCmlmIF9fbmFtZV9fPT0nX19tYWluX18nOm1haW4oKQo='
MATH_ACCOUNTING={'allocatedBytes': 28672, 'completedMetadata': {'allocatedBytes': 12288, 'bytes': 11774, 'ctimeNs': 1791011380067192039, 'device': 64514, 'gid': 0, 'inode': 11142836, 'mode': 384, 'mtimeNs': 1791011380067192039, 'nlink': 1, 'uid': 0}, 'completedSha256': '3d65f98e03aa341eed849d1506339ccd66af443d6fcf9cf33e794cd4073edcaf', 'entries': 5, 'metadata': {'allocatedBytes': 4096, 'bytes': 4096, 'ctimeNs': 1791011380067192039, 'device': 64514, 'gid': 0, 'inode': 11142816, 'mode': 448, 'mtimeNs': 1791011380067192039, 'nlink': 2, 'uid': 0}, 'nestedMounts': 0, 'noHardlinkedFiles': True, 'noSymlinks': True, 'noXattrs': True, 'path': '/data/proofofwork-audit30-inspect-20261003T014100Z/stream-completion-v2/onhost-math-completion-v2', 'regularBytes': 20813, 'rootPrivateOnly': True, 'treeSha256': 'b50a31503907f52ebde1e8b383e0cbef8cc58e528367767c6db31fa7560fc10e'}
def math_allocation_fence(p):
 if p.get('mathAccounting')!=MATH_ACCOUNTING:raise ValueError('Exact full root-private accounting authority')
 raw=base64.b64decode(MATH_OBSERVER_BASE64,validate=True)
 if hashlib.sha256(raw).hexdigest()!='1d6945a049e881980cfffe6e1c4575568b4598d939c80fac0ddc414de5dd08ab':raise ValueError('Exact root accounting census source')
 m=types.ModuleType('frozen_root_math_census');exec(compile(raw,'frozen-root-math-census.py','exec'),m.__dict__)
 if m.inventory()!=MATH_ACCOUNTING or m.inventory()!=MATH_ACCOUNTING:raise ValueError('Full private math tree changed')
 return MATH_ACCOUNTING
def math_source(mod,p):
 # The actual managed producer's PUBLIC completion, never raw COPY or marker.
 r=p['mathProof']
 if r['path']!=str(mod.MATH):raise ValueError('Exact public arithmetic evidence path')
 return read_bound(mod.MATH,r['metadata'],r['sha256'],1024**2,0,0,0o600)

def main():
 if os.geteuid()!=0 or not sys.flags.isolated or os.uname().nodename!='pow-bitcoin-01':raise ValueError('Root isolated fixed-host admission only')
 os.umask(0o077);raw=sys.stdin.buffer.read(262145)
 if len(raw)>262144:raise ValueError('Typed request bound')
 v=json.loads(raw,object_pairs_hook=pairs);code,planraw,p,newmembers=decode_request(v);package=BASE/v['runId'];unit=p['unit'];pg=pwd.getpwnam('postgres')
 if(pg.pw_uid,pg.pw_gid)!=(108,112):raise ValueError('Exact PG role identity')
 capacity(False);unit_new(unit);math_allocation_fence(p)
 if v['mode']=='prepare':
  if os.path.lexists(package):raise ValueError('New completion package already exists')
  if not BASE.exists():newdir(BASE,0,112,0o750)
  bm=metadata(canonical(BASE))
  if bm['uid']!=0 or bm['gid']!=112 or bm['mode']!=0o750 or not BASE.is_dir()or os.listxattr(BASE,follow_symlinks=False):raise ValueError('Canonical private package parent')
  members={'controller.py':code,**newmembers}
  for name,h in PINS.items():
   src=OLD/name;m=metadata(src);members[name]=read_bound(src,m,h,16*1024**2,0,112,0o440)
  newdir(package,0,112,0o750)
  for name,b in members.items():create(package/name,b,0o440,112)
  create(package/'reviewed-plan.json',planraw,0o600,0)
  mod=load(package);oldp=mod.completed_lineage();mod.validate(p);mathraw=math_source(mod,p);create(package/'sample-math-completed.json',mathraw,0o440,112);original=mod.C.package(oldp)[0];copy_dependencies(mod,package,original);mod.package(p,original);mod.C.previous(original);mod.C.previous_completion();mod.C.inputs(oldp);mod.math_proof(p);mod.saved_proof(p,package);mod.S.check_window(p);mod.G.check_live(p)
  math_allocation_fence(p)
  if math_source(mod,p)!=mathraw:raise ValueError('Original public arithmetic evidence changed during prepare')
  result=dict(schema='pow-audit30-private-sixteen-readonly-finalization-package-prepared-v1',mode='prepare',package=str(package),planSha256=v['planSha256'],controllerSha256=CONTROLLER_SHA,nativeUnitLaunched=False,productionMutation=False)
 else:
  mod=load(package);oldp=mod.completed_lineage();mod.validate(p);original=mod.C.package(oldp)[0];mod.package(p,original);rootplan=read_bound(package/'reviewed-plan.json',metadata(package/'reviewed-plan.json'),v['planSha256'],65536)
  if rootplan!=planraw:raise ValueError('Prepared reviewed plan differs')
  mod.S.check_window(p);mod.G.check_live(p);mod.C.previous(original);mod.C.previous_completion();mod.C.inputs(oldp);mod.math_proof(p);mod.saved_proof(p,package);mathraw=math_source(mod,p);capacity(False)
  cmd,argv=command(unit,package,v['planSha256'])
  try:capture=capture_unit(cmd,package/'readonly-finalization-run-capture.json',unit,1050,1024**2,argv)
  except BaseException as first:
   try:math_allocation_fence(p)
   except BaseException as after:raise RuntimeError('Private failure plus root math custody refusal:'+type(first).__name__+'/'+type(after).__name__)from first
   raise
  math_allocation_fence(p)
  mod.S.check_window(p);mod.G.check_live(p);mod.package(p,original);mod.C.previous_completion();mod.math_proof(p);mod.saved_proof(p,package)
  if math_source(mod,p)!=mathraw:raise ValueError('Original public arithmetic evidence changed during run')
  result=dict(schema='pow-audit30-private-sixteen-readonly-finalization-root-run-v1',mode='run',package=str(package),unit=unit,planSha256=v['planSha256'],rootCapturePassed=True,capture=capture,productionMutation=False,originalFailedAttemptPreserved=True,rootPrivateMathTreePreserved=True,rootPrivateMathFullAllocatedBytesCharged=MATH_ACCOUNTING['allocatedBytes'])
 print(json.dumps(result,sort_keys=True),flush=True)
if __name__=='__main__':
 old={s:signal.signal(s,lambda *_:(_ for _ in()).throw(BootstrapInterrupted('Root admission interrupted')))for s in(signal.SIGTERM,signal.SIGINT,signal.SIGHUP)}
 try:main()
 except BaseException as e:print(json.dumps(dict(status='refused',errorClass=type(e).__name__,rawDetailsSuppressed=True,creationOnlyEvidenceRetained=True,automaticRetry=False),sort_keys=True),file=sys.stderr);sys.exit(1)
 finally:
  for sig,handler in old.items():signal.signal(sig,handler)
