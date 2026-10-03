#!/usr/bin/python3 -I
"""Creation-only root admission for a separately reviewed stopped NEW-clone follow-up.
No SSH, live SQL, source-cluster start/write, deletion, overwrite or generic command.
Inventory is read-only; run writes only private-clone audit side schema and evidence.
"""
import base64,datetime as dt,hashlib,json,os,pwd,re,selectors,signal,stat,subprocess,sys,time,types
from pathlib import Path
APPROVAL='6821c987b9a5d110fbe9fb2820955b7cbc26dda9faddb67667fc49e892f5c820'
BASE=Path('/usr/local/lib/proofofwork-audit30-transition-stream')
SOURCE=Path('/data/proofofwork-audit30-restore-20261002T234651Z')
JOB=Path('/data/proofofwork-audit30-inspect-20261003T014100Z')
OLDPACKAGE=Path('/usr/local/lib/proofofwork-audit30-snapshot-inspect/20261003T014100Z')
PINS={'controller-v6.py':'2483419dbb9dc2fa72af4b9bb0db28f9440b40f2fd557cb41bcc781c191e1867','controller.py':'2483419dbb9dc2fa72af4b9bb0db28f9440b40f2fd557cb41bcc781c191e1867','pow-audit30-saved-snapshot-inspect-v2.py':'f923766a2dffcfaabd45b3bf4fc4cf975435f2713388ec7930b4d3057fad98ad','restore-latest-logical.py':'26c7656b2e751c6de50122c65f8af73686c2d2674bee8be86a3c5648b7fcc80e','pow-audit30-transition-stream-codec-v2.py':'3fe9dd87f9f5638b02be858b44c535c1431b1af1e8e4f9d60a1afe295f5179f0','pow-audit30-transition-stream-native-v2.py':'523342d30599c793a3503ba1d554fc096fce0be554ae232397c8ea4bcadbbe23','pow-audit30-mail-body-repair-rehearsal-v2.mjs':'ea5614fddc0ef7fb696d0159a141b25116fbd6ba2c4b309db171a548b7f8b70c','phase4-readiness-admission-v2.json':'a27b614620d29f9142957be064361a0d3b489e87ce4d866c2f0a07c907a59839'}
UTILITY=set(PINS)-{'controller-v6.py','pow-audit30-mail-body-repair-rehearsal-v2.mjs','phase4-readiness-admission-v2.json'}
SOURCE_INVENTORY_SHA='f30301ca4f4769cfbbd995dc7627580be543e6cddfc1f5b3ff4aba033a48f572'
PRIVATE_PLAN_SHA='4ac3a8d9b4b79befd36abc590731b1bc8f2e6c83919d5f6427c34c58a6ddba00'
ORIGINAL_ENGINE_SHA='09b3240e45d76278a67053f5fba6009cccce36b00c1b098d38d7435da978dc58'
SHA=re.compile(r'[0-9a-f]{64}');RUN=re.compile(r'[0-9]{8}T[0-9]{6}Z');META={'device','inode','mode','uid','gid','bytes','mtimeNs','ctimeNs','nlink'}
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

def capture_unit(cmd,target,unit,timeout,maximum):
 # Stream to exclusive root600 evidence; bound both channels and wall time.
 outfd=os.open(target,os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW,0o600);errpath=Path(str(target)+'.stderr');errfd=os.open(errpath,os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW,0o600)
 proc=None;selectors_=selectors.DefaultSelector();counts={'out':0,'err':0};deadline=time.monotonic()+timeout
 try:
  proc=subprocess.Popen(cmd,stdin=subprocess.DEVNULL,stdout=subprocess.PIPE,stderr=subprocess.PIPE,start_new_session=True)
  for label,pipe in [('out',proc.stdout),('err',proc.stderr)]:os.set_blocking(pipe.fileno(),False);selectors_.register(pipe,selectors.EVENT_READ,label)
  while selectors_.get_map():
   if time.monotonic()>deadline:raise TimeoutError('Private unit capture deadline')
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
  return counts
 except BaseException:
  # Exact freshly admitted private unit only; never a production service.
  try:subprocess.run(['/usr/bin/systemctl','stop',unit],timeout=95,capture_output=True)
  except BaseException:pass
  if proc and proc.poll() is None:
   try:os.killpg(proc.pid,signal.SIGKILL)
   except ProcessLookupError:pass
   proc.wait(timeout=10)
  raise
 finally:
  selectors_.close()
  if proc:
   if proc.stdout:proc.stdout.close()
   if proc.stderr:proc.stderr.close()
  os.close(outfd);os.close(errfd)


def decode(name,row):
 if name not in PINS or not isinstance(row,dict)or set(row)!={'base64','sha256'}or row['sha256']!=PINS[name]:raise ValueError('Unreviewed source')
 raw=base64.b64decode(row['base64'],validate=True)
 if len(raw)>1024**2 or hashlib.sha256(raw).hexdigest()!=PINS[name]:raise ValueError('Source bytes differ')
 if name.endswith('.py'):compile(raw,name,'exec')
 return raw

def validate_request(v):
 common={'schema','approvalSha256','mode','runId','host','sources'};extras={'inventory':{'sealedInventoryBase64','priorAdmissionBase64','priorAdmissionSha256'},'prepare':{'inventorySha256'},'run':{'planBase64','planSha256'}}
 if not isinstance(v,dict)or v.get('schema')!='pow-audit30-private-stream-bootstrap-v4'or v.get('approvalSha256')!=APPROVAL or v.get('mode')not in extras or set(v)!=common|extras[v['mode']]:raise ValueError('Exact bootstrap scope')
 rid=v['runId']
 if not isinstance(rid,str)or not RUN.fullmatch(rid)or dt.datetime.strptime(rid,'%Y%m%dT%H%M%SZ').strftime('%Y%m%dT%H%M%SZ')!=rid or not isinstance(v['host'],str)or not re.fullmatch('[A-Za-z0-9.-]+',v['host']):raise ValueError('Calendar/host scope')
 expected=UTILITY if v['mode']=='inventory'else set(PINS)-UTILITY if v['mode']=='prepare'else set()
 if not isinstance(v['sources'],dict)or set(v['sources'])!=expected:raise ValueError('Source scope differs')
 decoded={n:decode(n,r)for n,r in v['sources'].items()}
 if v['mode']=='inventory':
  raw=base64.b64decode(v['sealedInventoryBase64'],validate=True)
  if len(raw)>64*1024**2 or hashlib.sha256(raw).hexdigest()!=SOURCE_INVENTORY_SHA:raise ValueError('Original inventory pin')
  review=base64.b64decode(v['priorAdmissionBase64'],validate=True)
  if len(review)>65536 or not SHA.fullmatch(v['priorAdmissionSha256'])or hashlib.sha256(review).hexdigest()!=v['priorAdmissionSha256']or encoded(json.loads(review,object_pairs_hook=pairs))!=review:raise ValueError('Canonical explicit failed admission pin')
 elif v['mode']=='prepare':
  if not isinstance(v['inventorySha256'],str)or not SHA.fullmatch(v['inventorySha256']):raise ValueError('Exact reviewed inventory hash')
 elif v['mode']=='run':
  raw=base64.b64decode(v['planBase64'],validate=True)
  if len(raw)>65536 or not SHA.fullmatch(v['planSha256'])or hashlib.sha256(raw).hexdigest()!=v['planSha256']or encoded(json.loads(raw,object_pairs_hook=pairs))!=raw:raise ValueError('Canonical plan binding')
 return decoded

def authority(package,pg,ready=False):
 p=canonical(package);m=metadata(p)
 if m['uid']!=0 or m['gid']!=pg.pw_gid or m['mode']!=0o750 or not stat.S_ISDIR(p.lstat().st_mode)or os.listxattr(p,follow_symlinks=False):raise ValueError('Package privacy differs')
 for n in UTILITY:raw=read_bound(p/n,metadata(p/n),PINS[n],1024**2,0,pg.pw_gid,0o440)
 name='controller-v6.py'if ready else'controller.py';raw=read_bound(p/name,metadata(p/name),PINS[name],1024**2,0,pg.pw_gid,0o440);m=types.ModuleType('audit30_stream');m.__file__=str(p/name);exec(compile(raw,m.__file__,'exec'),m.__dict__);m.load();return m

def properties(mode,package=None):
 p=dict(Type='exec',CPUQuota='25%'if mode=='inventory'else'100%',CPUWeight='10',MemoryHigh=str(768*1024**2 if mode=='inventory'else 6*1024**3),MemoryMax=str(1024**3 if mode=='inventory'else 8*1024**3),TasksMax='32'if mode=='inventory'else'64',IOWeight='10',Nice='15',RuntimeMaxSec='15min',TimeoutStopSec='90s',KillMode='control-group',UMask='0077',NoNewPrivileges='yes',PrivateNetwork='yes',PrivateTmp='yes',PrivateIPC='yes',PrivateDevices='yes',ProtectSystem='strict',ProtectHome='yes',ProtectKernelTunables='yes',ProtectKernelModules='yes',ProtectControlGroups='yes',RestrictAddressFamilies='AF_UNIX',CapabilityBoundingSet='',AmbientCapabilities='',ReadWritePaths=''if mode=='inventory'else str(JOB),ReadOnlyPaths='/data/proofofwork-postgres-backups/logical '+str(SOURCE)+(' '+str(JOB)if mode=='inventory'else''),InaccessiblePaths='/var/lib/postgresql /run/postgresql /data/proofofwork-postgres-tablespaces -/data/proofofwork-postgres-backups/physical /etc/proofofwork-api '+str(SOURCE/'socket')+(' '+str(JOB/'socket')if mode=='inventory'else''))
 if mode=='run':p['LoadCredential']='stream-plan:'+str(package/'reviewed-plan.json')
 return p

def command(unit,p,args):return ['/usr/bin/systemd-run','--unit='+unit.removesuffix('.service'),'--description=Audit30 private-clone streaming follow-up','--wait','--pipe','--quiet','--uid=postgres','--gid=postgres',*['--property='+k+'='+val for k,val in p.items()],'/usr/bin/python3','-I','-B',*args]

def prepare(package,pg,mod,decoded):
 old=canonical(OLDPACKAGE);om=metadata(old)
 if om['uid']!=0 or om['gid']!=pg.pw_gid or om['mode']!=0o750 or not stat.S_ISDIR(old.lstat().st_mode)or os.listxattr(old,follow_symlinks=False):raise ValueError('Old immutable source package changed')
 planmeta=metadata(old/'phase4-private-plan.json');raw=read_bound(old/'phase4-private-plan.json',planmeta,PRIVATE_PLAN_SHA,360*1024**2,0,pg.pw_gid,0o440)
 engine_meta=metadata(old/'pow-audit30-mail-body-repair-rehearsal.mjs');engine=read_bound(old/'pow-audit30-mail-body-repair-rehearsal.mjs',engine_meta,ORIGINAL_ENGINE_SHA,1024**2,0,pg.pw_gid,0o440)
 source=mod.I.collect_pg_dependencies(old/'pg-dependencies');rows=source['records'];paths=[package/n for n in decoded]+[package/n for n in ('phase4-private-plan.json','original-transaction-engine.mjs','pg-dependencies','phase4-pg-dependency-inventory.json')]
 if any(os.path.lexists(p)for p in paths):raise ValueError('Prepared destination already exists')
 for n,b in decoded.items():create(package/n,b,0o440,pg.pw_gid)
 create(package/'phase4-private-plan.json',raw,0o440,pg.pw_gid);create(package/'original-transaction-engine.mjs',engine,0o440,pg.pw_gid)
 dst=package/'pg-dependencies'
 for r in rows:
  rel=r['path'];p=dst if rel=='.'else dst/rel;src=old/'pg-dependencies'if rel=='.'else old/'pg-dependencies'/rel
  if r['kind']=='directory':newdir(p,0,pg.pw_gid,0o750)
  else:create(p,read_bound(src,r['metadata'],r['sha256'],64*1024**2,0,pg.pw_gid,0o440),0o440,pg.pw_gid)
 if mod.I.collect_pg_dependencies(old/'pg-dependencies')!=source or read_bound(old/'phase4-private-plan.json',planmeta,PRIVATE_PLAN_SHA,360*1024**2,0,pg.pw_gid,0o440)!=raw or read_bound(old/'pow-audit30-mail-body-repair-rehearsal.mjs',engine_meta,ORIGINAL_ENGINE_SHA,1024**2,0,pg.pw_gid,0o440)!=engine or metadata(old)!=om:raise ValueError('Whole original inputs changed during copy')
 result=mod.I.collect_pg_dependencies(dst);rawdep=encoded(result);create(package/'phase4-pg-dependency-inventory.json',rawdep,0o440,pg.pw_gid);node=mod.G.metadata(mod.I.NODE);node_sha=mod.G.hash_file(mod.I.NODE,limit=256*1024**2,no_atime=False)
 return dict(privatePlanSha256=PRIVATE_PLAN_SHA,dependencyInventorySha256=hashlib.sha256(rawdep).hexdigest(),pgEntrySha256=next(r['sha256']for r in rows if r['path']=='pg/lib/index.js'),node=dict(metadata=node,sha256=node_sha),readinessAdmissionSha256=PINS['phase4-readiness-admission-v2.json'],dependencyEntries=result['entries'],dependencyRegularBytes=result['regularBytes'],sourcePackage=str(old),sourcePackageUnchanged=True)

def main():
 if os.geteuid()!=0 or not sys.flags.isolated:raise ValueError('Root isolated admission only')
 os.umask(0o077);raw=sys.stdin.buffer.read(8*1024**2+1)
 if len(raw)>8*1024**2:raise ValueError('Typed request bound')
 v=json.loads(raw,object_pairs_hook=pairs);decoded=validate_request(v)
 if v['host']!=os.uname().nodename:raise ValueError('Host differs')
 rid=v['runId'];package=BASE/rid;pg=pwd.getpwnam('postgres');capacity(False)
 if v['mode']=='inventory':
  unit='proofofwork-audit30-stream-inventory-'+rid+'.service';unit_new(unit)
  if os.path.lexists(package):raise ValueError('Inventory package exists')
  if not BASE.exists():
   if canonical(BASE.parent)!=BASE.parent:raise ValueError('Package parent changed')
   newdir(BASE,0,0,0o755)
  bm=metadata(canonical(BASE))
  if bm['uid']!=0 or bm['mode']&0o7022 or not stat.S_ISDIR(BASE.lstat().st_mode):raise ValueError('Package parent unsafe')
  newdir(package,0,pg.pw_gid,0o750)
  for n,b in decoded.items():create(package/n,b,0o440,pg.pw_gid)
  create(package/'sealed-logical-inventory.json',base64.b64decode(v['sealedInventoryBase64'],validate=True),0o440,pg.pw_gid);create(package/'prior-clone-admission.json',base64.b64decode(v['priorAdmissionBase64'],validate=True),0o440,pg.pw_gid)
  mod=authority(package,pg);review,_=mod.I.read_json(package/'prior-clone-admission.json',v['priorAdmissionSha256'],root_authority=True);mod.admission(review)
  if review['job']!=str(JOB)or review['sealedSource']!=str(SOURCE)or review['kind']!='exact-before-mail-write-trigger-refusal':raise ValueError('Only exact current before-write failure admitted')
  args=[str(package/'controller.py'),'inventory','--job',str(JOB),'--bindings',str(package/'prior-clone-admission.json'),'--bindings-sha256',v['priorAdmissionSha256'],'--unit',unit,'--host',v['host']];captured=package/'inventory-capture.json';capture_unit(command(unit,properties('inventory'),args),captured,unit,930,64*1024**2)
  invraw=captured.read_bytes();inv=json.loads(invraw,object_pairs_hook=pairs)
  if inv.get('schema')!=mod.INVENTORY or inv.get('job')!=str(JOB)or inv.get('sealedSource')!=str(SOURCE)or inv.get('priorAdmission')!=review or inv.get('sealedSourceFullHashVerified')is not True or inv.get('recordsSha256')!=mod.I.digest(inv.get('records')):raise ValueError('Inventory source/output binding differs')
  create(package/'stopped-clone-inventory.json',invraw,0o440,pg.pw_gid)
  result=dict(mode='inventory',package=str(package),unit=unit,inventorySha256=hashlib.sha256(invraw).hexdigest(),entries=inv['entries'],regularBytes=inv['regularBytes'],physicalChangesSha256=inv['physicalChangesSinceInitialCopy']['changesSha256'],unexplainedChangeCount=inv['physicalChangesSinceInitialCopy']['unexplainedChangeCount'],previousInspectionStatus='failed',productionMutation=False,sealedSourceUnchangedFullHashVerified=True)
 elif v['mode']=='prepare':
  mod=authority(package,pg);ip=package/'stopped-clone-inventory.json';im=metadata(ip);iraw=read_bound(ip,im,v['inventorySha256'],64*1024**2,0,pg.pw_gid,0o440);iv=json.loads(iraw,object_pairs_hook=pairs);mod.validate_inventory(iv,dict(job=str(JOB),sealedSource=str(SOURCE),priorAdmission=dict(kind='exact-before-mail-write-trigger-refusal',sha256=hashlib.sha256(encoded(iv['priorAdmission'])).hexdigest())));result=prepare(package,pg,mod,decoded)|dict(mode='prepare',package=str(package),productionMutation=False,controllerFileName='controller-v6.py',controllerSha256=PINS['controller-v6.py'],reviewedInventorySha256=v['inventorySha256']);read_bound(ip,im,v['inventorySha256'],64*1024**2,0,pg.pw_gid,0o440)
 else:
  mod=authority(package,pg,ready=True);unit='proofofwork-audit30-transition-stream-'+rid+'.service';unit_new(unit);raw=base64.b64decode(v['planBase64'],validate=True);plan=mod.validate_plan(json.loads(raw,object_pairs_hook=pairs))
  if plan['job']!=str(JOB)or plan['sealedSource']!=str(SOURCE)or plan['host']!=v['host']or plan['runId']!=rid or plan['unit']!=unit or plan['controllerSha256']!=PINS['controller-v6.py']or os.path.lexists(package/'reviewed-plan.json'):raise ValueError('Exact NEW clone run scope/plan absence')
  mod.checked_package(plan);mod.check_window(plan);mod.G.check_live(plan);capacity(False);create(package/'reviewed-plan.json',raw,0o600,0);args=[str(package/'controller-v6.py'),'run','--plan','/run/credentials/'+unit+'/stream-plan','--plan-sha256',v['planSha256']];capture_unit(command(unit,properties('run',package),args),package/'stream-run-capture.json',unit,1050,8*1024**2)
  result=dict(mode='run',package=str(package),job=str(JOB),unit=unit,planSha256=v['planSha256'],productionMutation=False,allOriginalFilesRetained=True)
 print(json.dumps(result,sort_keys=True),flush=True)
if __name__=='__main__':
 try:main()
 except BaseException as e:print(json.dumps(dict(status='refused',errorClass=type(e).__name__,reason='Exact private-clone admission refused; all creation-only evidence retained'),sort_keys=True),file=sys.stderr);sys.exit(1)
