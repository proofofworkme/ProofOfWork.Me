#!/usr/bin/python3 -I
"""Creation-only typed admission for the reviewed Audit30 isolated inspector.
Root executes. No SSH, live PostgreSQL connection, generic command/SQL, cleanup,
source-cluster writes, overwrite, Git, package installation or live restarts.
"""
import base64,datetime as dt,hashlib,json,os,pwd,re,selectors,signal,stat,subprocess,sys,time,types
from pathlib import Path
APPROVAL='6821c987b9a5d110fbe9fb2820955b7cbc26dda9faddb67667fc49e892f5c820'
BASE=Path('/usr/local/lib/proofofwork-audit30-snapshot-inspect')
STAGEBASE='/data/proofofwork-audit30-inspect-inputs-'
SOURCE=Path('/data/proofofwork-audit30-restore-20261002T234651Z')
PINS={'controller.py':'f923766a2dffcfaabd45b3bf4fc4cf975435f2713388ec7930b4d3057fad98ad','restore-latest-logical.py':'26c7656b2e751c6de50122c65f8af73686c2d2674bee8be86a3c5648b7fcc80e','id-before.sql':'b1ccffd27b8330a36f3b072a38c3d66300b31efedde85cdb70b3cb707722d2c0','id-after.sql':'f983ca088f07faeb29d23c46be0e8004ec843f2ed47718fecab0788bb6a1aa47','relational.sql':'635d81afcfdb31c9ad491e32bbaa32607d75f23707d7634ab4d4a7dde9971caa','pow-audit30-transition-private-sql-v3.py':'86e69c9cd6f0b9efe5699d969e197f2e0afcd2efc9e414799baf8cb65ef64cc6','pow-audit30-transition-chunk-prototype.py':'4c08151c0d3cfb5757c0056fef8facf578e57e023bc1bc29f49fdaf7c5e34e9a','pow-audit30-mail-body-repair-rehearsal.mjs':'09b3240e45d76278a67053f5fba6009cccce36b00c1b098d38d7435da978dc58'}
PROOFS={'completed.json':'47ec15376cab23ec705e494195d7b836fa2674450e5ee9f7d761e7f6dbb709dd','table-row-parity.json':'abd70cf572c37cb9d39ef8e26df6bf197b3f9862c58f4ed78fd934134872bcd2','offline-page-check.json':'617941865701c62045a343ce92b4d1d6427edc7c40c634426fbc6daa6db4529c','saved-snapshot-fence.json':'a299d498d31f5709e92621e9b97f3c1b732f2cad6bd1f523048f0f3f92556b10'}
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
def decode_source(name,row):
 if name not in PINS or set(row)!={'base64','sha256'} or row['sha256']!=PINS[name]:raise ValueError('Unreviewed source')
 raw=base64.b64decode(row['base64'],validate=True)
 if len(raw)>1024**2 or hashlib.sha256(raw).hexdigest()!=PINS[name]:raise ValueError('Source bytes differ')
 if name.endswith('.py'):compile(raw,name,'exec')
 return raw
def validate_request(v):
 common={'schema','approvalSha256','mode','runId','host','sources'}
 additional={'inventory':set(),'prepare':{'privatePlan','dependencySource'},'run':{'planBase64','planSha256'}}
 if not isinstance(v,dict) or v.get('schema')!='pow-audit30-snapshot-inspect-bootstrap-v1' or v.get('approvalSha256')!=APPROVAL or v.get('mode') not in additional or set(v)!=common|additional[v['mode']]:raise ValueError('Bootstrap scope mismatch')
 rid=v['runId']
 if not isinstance(rid,str) or not RUN.fullmatch(rid):raise ValueError('Run identifier')
 dt.datetime.strptime(rid,'%Y%m%dT%H%M%SZ')
 if not isinstance(v['host'],str) or not re.fullmatch(r'[A-Za-z0-9.-]+',v['host']):raise ValueError('Host identifier')
 expected={'controller.py','restore-latest-logical.py'} if v['mode']=='inventory' else set(PINS)-{'controller.py','restore-latest-logical.py'} if v['mode']=='prepare' else set()
 if not isinstance(v['sources'],dict) or set(v['sources'])!=expected:raise ValueError('Source inventory scope mismatch')
 decoded={n:decode_source(n,r) for n,r in v['sources'].items()}
 if v['mode']=='run':
  raw=base64.b64decode(v['planBase64'],validate=True)
  if len(raw)>65536 or not SHA.fullmatch(v['planSha256']) or hashlib.sha256(raw).hexdigest()!=v['planSha256']:raise ValueError('Plan raw binding')
  plan=json.loads(raw,object_pairs_hook=pairs)
  if plan.get('runId')!=rid or plan.get('host')!=v['host'] or plan.get('source')!=str(SOURCE) or plan.get('controllerSha256')!=PINS['controller.py'] or plan.get('guardSha256')!=PINS['restore-latest-logical.py'] or plan.get('approvalSha256')!=APPROVAL:raise ValueError('Plan scope/source mismatch')
 return decoded

def authority(package,pg):
 p=canonical(package);m=metadata(p)
 if m['uid']!=0 or m['gid']!=pg.pw_gid or m['mode']!=0o750 or not stat.S_ISDIR(p.lstat().st_mode) or os.listxattr(p,follow_symlinks=False):raise ValueError('Package privacy changed')
 raw=read_bound(p/'controller.py',metadata(p/'controller.py'),PINS['controller.py'],1024**2,0,pg.pw_gid,0o440)
 read_bound(p/'restore-latest-logical.py',metadata(p/'restore-latest-logical.py'),PINS['restore-latest-logical.py'],1024**2,0,pg.pw_gid,0o440)
 mod=types.ModuleType('audit30_inspector');mod.__file__=str(p/'controller.py');exec(compile(raw,mod.__file__,'exec'),mod.__dict__);mod.load_guard();return mod

def properties(mode,job=None,package=None):
 p=dict(Type='exec',CPUQuota='25%' if mode=='inventory' else '100%',CPUWeight='10',MemoryHigh=str(768*1024**2 if mode=='inventory' else 6*1024**3),MemoryMax=str(1024**3 if mode=='inventory' else 8*1024**3),TasksMax='32' if mode=='inventory' else '64',IOWeight='10',Nice='15',RuntimeMaxSec='15min' if mode=='inventory' else '60min',TimeoutStopSec='90s',KillMode='control-group',UMask='0077',NoNewPrivileges='yes',PrivateNetwork='yes',PrivateTmp='yes',PrivateIPC='yes',PrivateDevices='yes',ProtectSystem='strict',ProtectHome='yes',ProtectKernelTunables='yes',ProtectKernelModules='yes',ProtectControlGroups='yes',RestrictAddressFamilies='AF_UNIX',CapabilityBoundingSet='',AmbientCapabilities='',ReadWritePaths='' if mode=='inventory' else str(job),ReadOnlyPaths='/data/proofofwork-postgres-backups/logical '+str(SOURCE),InaccessiblePaths='/var/lib/postgresql /run/postgresql /data/proofofwork-postgres-tablespaces -/data/proofofwork-postgres-backups/physical /etc/proofofwork-api '+str(SOURCE/'socket'))
 if mode=='run':p['LoadCredential']='inspect-plan:'+str(package/'reviewed-plan.json')
 return p

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

def command(unit,p,args):return ['/usr/bin/systemd-run','--unit='+unit.removesuffix('.service'),'--description=Audit30 private saved snapshot '+('inventory' if 'inventory-' in unit else 'inspection'),'--wait','--pipe','--quiet','--uid=postgres','--gid=postgres',*['--property='+k+'='+val for k,val in p.items()],'/usr/bin/python3','-I','-B',*args]

def prepare_inputs(v,package,pg,mod):
 stage=canonical(STAGEBASE+v['runId']);sm=metadata(stage)
 if sm['uid']!=0 or sm['gid']!=0 or sm['mode']!=0o700 or not stat.S_ISDIR(stage.lstat().st_mode) or os.listxattr(stage,follow_symlinks=False):raise ValueError('Input staging authority')
 row=v['privatePlan']
 if set(row)!={'path','metadata','sha256'} or row['path']!=str(stage/'phase4-private-plan.json'):raise ValueError('Private plan staging scope')
 raw=read_bound(row['path'],row['metadata'],row['sha256'],360*1024**2);value=json.loads(raw,object_pairs_hook=pairs)
 if value.get('schema')!='pow-audit30-mail-body-private-rehearsal-plan-v1':raise ValueError('Private input plan kind')
 dep=v['dependencySource']
 if set(dep)!={'path','records','recordsSha256'} or dep['path']!=str(stage/'pg-dependencies') or not isinstance(dep['records'],list) or not 1<=len(dep['records'])<=10000 or hashlib.sha256(encoded(dep['records'])).hexdigest()!=dep['recordsSha256']:raise ValueError('Dependency input binding')
 records=dep['records'];by={};total=0;base=canonical(dep['path'])
 if records!=sorted(records,key=lambda r:r['path']) or len({r['path'] for r in records})!=len(records):raise ValueError('Dependency input order/duplicate')
 for r in records:
  rel=mod.safe_rel(r['path']);p=base if rel=='.' else base/rel;kind=r.get('kind');m=r.get('metadata',{})
  if kind not in ('file','directory') or set(r)!=({'path','kind','metadata','sha256'} if kind=='file' else {'path','kind','metadata'}) or set(m)!=META or m['uid']!=0 or m['gid']!=0 or m['mode']!=(0o600 if kind=='file' else 0o700) or metadata(canonical(p))!=m or m['device']!=base.stat().st_dev or os.listxattr(p,follow_symlinks=False) or not (stat.S_ISREG(p.lstat().st_mode) if kind=='file' else stat.S_ISDIR(p.lstat().st_mode)):raise ValueError('Unsafe dependency input')
  if kind=='file':
   total+=m['bytes']
   if total>64*1024**2:raise ValueError('Dependency closure bound')
   read_bound(p,m,r['sha256'],64*1024**2)
  by[rel]=r
 if by.get('.',{}).get('kind')!='directory' or by.get('pg/lib/index.js',{}).get('kind')!='file':raise ValueError('Fixed entry/root absent')
 for rel,r in by.items():
  p=base if rel=='.' else base/rel
  if rel!='.' and by.get(str(Path(rel).parent),{}).get('kind')!='directory':raise ValueError('Input parent missing')
  if r['kind']=='directory' and set(os.listdir(p))!={Path(x).name for x in by if x!='.' and str(Path(x).parent)==rel}:raise ValueError('Unlisted input dependency')
  if metadata(p)!=r['metadata']:raise ValueError('Input dependency drift')
 # All expected destination absences before any creation; exact leftovers refused.
 destinations=[package/n for n in v['sources']]+[package/'phase4-private-plan.json',package/'pg-dependencies',package/'phase4-pg-dependency-inventory.json']
 if any(os.path.lexists(p) for p in destinations):raise ValueError('Prepared input already exists')
 for n,r in v['sources'].items():create(package/n,decode_source(n,r),0o440,pg.pw_gid)
 create(package/'phase4-private-plan.json',raw,0o440,pg.pw_gid)
 destination=package/'pg-dependencies'
 for r in records:
  rel=r['path'];p=destination if rel=='.' else destination/rel;original=base if rel=='.' else base/rel
  if r['kind']=='directory':newdir(p,0,pg.pw_gid,0o750)
  else:create(p,read_bound(original,r['metadata'],r['sha256'],64*1024**2),0o440,pg.pw_gid)
 for r in records:
  p=base if r['path']=='.' else base/r['path']
  if metadata(p)!=r['metadata']:raise ValueError('Whole original dependency changed during copy')
 if read_bound(row['path'],row['metadata'],row['sha256'],360*1024**2)!=raw:raise ValueError('Private plan changed during copy')
 inventory=mod.collect_pg_dependencies(destination);inraw=encoded(inventory);create(package/'phase4-pg-dependency-inventory.json',inraw,0o440,pg.pw_gid)
 return dict(privatePlanSha256=row['sha256'],dependencyInventorySha256=hashlib.sha256(inraw).hexdigest(),pgEntrySha256=by['pg/lib/index.js']['sha256'],dependencyEntries=len(records),dependencyRegularBytes=total)

def main():
 if os.geteuid()!=0 or not sys.flags.isolated:raise ValueError('Root isolated bootstrap only')
 os.umask(0o077);raw=sys.stdin.buffer.read(8*1024**2+1)
 if len(raw)>8*1024**2:raise ValueError('Typed bootstrap request bound')
 v=json.loads(raw,object_pairs_hook=pairs);decoded=validate_request(v)
 if v['host']!=os.uname().nodename:raise ValueError('Host differs')
 rid=v['runId'];package=BASE/rid;pg=pwd.getpwnam('postgres');capacity(v['mode']=='run')
 if v['mode']=='inventory':
  unit='proofofwork-audit30-snapshot-inventory-'+rid+'.service';unit_new(unit)
  if os.path.lexists(package):raise ValueError('Inventory package exists')
  if not BASE.exists():
   if canonical(BASE.parent)!=BASE.parent:raise ValueError('Package parent changed')
   newdir(BASE,0,0,0o755)
  bm=metadata(canonical(BASE))
  if bm['uid']!=0 or bm['mode']&0o7022 or not stat.S_ISDIR(BASE.lstat().st_mode):raise ValueError('Package parent unsafe')
  newdir(package,0,pg.pw_gid,0o750)
  for n,b in decoded.items():create(package/n,b,0o440,pg.pw_gid)
  mod=authority(package,pg);args=[str(package/'controller.py'),'inventory','--source',str(SOURCE),'--unit',unit,'--host',v['host'],'--completed-sha256',PROOFS['completed.json'],'--parity-sha256',PROOFS['table-row-parity.json'],'--page-check-sha256',PROOFS['offline-page-check.json'],'--fence-sha256',PROOFS['saved-snapshot-fence.json']]
  captured=package/'inventory-capture.json';capture_unit(command(unit,properties('inventory'),args),captured,unit,930,64*1024**2)
  raw=captured.read_bytes();inv=mod.validate_inventory(json.loads(raw,object_pairs_hook=pairs))
  if inv['sourceJob']!=str(SOURCE) or any(inv['receiptBindings'][n]['sha256']!=sha for n,sha in PROOFS.items()):raise ValueError('Inventory source proof differs')
  create(package/'cluster-inventory.json',raw,0o440,pg.pw_gid)
  result=dict(mode='inventory',package=str(package),unit=unit,inventorySha256=hashlib.sha256(raw).hexdigest(),entries=inv['entries'],regularBytes=inv['regularBytes'],productionMutation=False,sourceUnchanged=True)
 elif v['mode']=='prepare':
  mod=authority(package,pg);result=prepare_inputs(v,package,pg,mod)|dict(mode='prepare',package=str(package),productionMutation=False)
 else:
  unit='proofofwork-audit30-snapshot-inspect-'+rid+'.service';unit_new(unit);mod=authority(package,pg);planraw=base64.b64decode(v['planBase64'],validate=True);plan=mod.validate_plan(json.loads(planraw,object_pairs_hook=pairs));job=Path(plan['job'])
  if plan['unit']!=unit or job!=Path('/data/proofofwork-audit30-inspect-'+rid) or canonical(job.parent)!=job.parent or os.path.lexists(job) or os.path.lexists(package/'reviewed-plan.json'):raise ValueError('New job/plan scope or absence changed')
  mod.checked_package(plan);mod.check_window(plan);mod.G.check_live(plan);capacity(True)
  create(package/'reviewed-plan.json',planraw,0o600,0);newdir(job,pg.pw_uid,pg.pw_gid,0o700)
  args=[str(package/'controller.py'),'run','--plan','/run/credentials/'+unit+'/inspect-plan','--plan-sha256',v['planSha256']]
  capture_unit(command(unit,properties('run',job,package),args),package/'inspection-capture.json',unit,3750,8*1024**2)
  result=dict(mode='run',package=str(package),job=str(job),unit=unit,planSha256=v['planSha256'],productionMutation=False,retainedAllFiles=True)
 print(json.dumps(result,sort_keys=True),flush=True)
if __name__=='__main__':
 try:main()
 except BaseException as e:
  print(json.dumps(dict(status='refused',errorClass=type(e).__name__,reason='Exact isolated bootstrap refused; all created files and private unit evidence retained'),sort_keys=True),file=sys.stderr);sys.exit(1)
