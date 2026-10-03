#!/usr/bin/python3 -I
"""Creation-only Audit30 private mail census/build launcher; read-only live SQL/Core.
Run under reviewed root stdin custody, then an exact private-write-path systemd
unit. Never updates PostgreSQL, Git, services, timers, source or old evidence.
"""
import argparse,base64,datetime as dt,hashlib,json,os,pathlib,pwd,re,selectors,stat,subprocess,sys,time,signal
PINS={'private-census.py':'37cb62d6440f21f18f4a0f561a0561fb063156f9cb447d172884142056d77f41','repair-plan.py':'f8547277a0b11d1db8863276c1186b9bf5a764805047a251d5c529d8023928bb','mail-body-census.py':'818aaf4207ac5f5c627211eec21ed3991f6fd3a8400cce909c64c6be053ce61c','rehearsal-engine.mjs':'09b3240e45d76278a67053f5fba6009cccce36b00c1b098d38d7435da978dc58'}
APPROVAL='6821c987b9a5d110fbe9fb2820955b7cbc26dda9faddb67667fc49e892f5c820'
PACKAGE_PARENT='/usr/local/lib/proofofwork-audit30-mail-body';EVIDENCE_PARENT='/data/proofofwork-release-backups'
SERVICES=('bitcoind.service','electrs.service','postgresql@16-main.service','proofofwork-api.service','proofofwork-indexer-worker.service')
BINARIES={'python':'/usr/bin/python3','runuser':'/usr/sbin/runuser','psql-wrapper':'/usr/bin/psql','psql16':'/usr/lib/postgresql/16/bin/psql','pg-control16':'/usr/lib/postgresql/16/bin/pg_controldata','core-cli':'/usr/local/bin/bitcoin-cli'}
PROOFS=('completed.json','intent.json','table-row-parity.json','offline-page-check.json','saved-snapshot-fence.json')
SHA=re.compile('[0-9a-f]{64}\\Z');RUN=re.compile('[0-9]{8}T[0-9]{6}Z\\Z')
ENV={'PATH':'/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin','LC_ALL':'C','LANG':'C','TZ':'UTC','PGHOST':'/run/postgresql','PGPORT':'5432','PGCONNECT_TIMEOUT':'5','PGAPPNAME':'audit30-mail-census-readonly','PGOPTIONS':'-c default_transaction_read_only=on -c statement_timeout=60000 -c lock_timeout=3000 -c idle_in_transaction_session_timeout=30000'}
DATA_FLOOR=100*1024**3;ROOT_FLOOR=10*1024**3;MEM_FLOOR=8*1024**3
REQUEST_MAX=1024**2;INPUT_SOURCE_MAX=80*1024;PROOF_MAX=8*1024**2
PRIVATE_MAX=500*1024**2

def need(ok,code):
 if not ok:raise ValueError(code)
def sha(b):return hashlib.sha256(b).hexdigest()
def encoded(o):return json.dumps(o,sort_keys=True,separators=(',',':'),ensure_ascii=True).encode()
def pairs(p):
 d={}
 for k,v in p:need(k not in d,'DUPLICATE_JSON_KEY');d[k]=v
 return d
def parse(b):return json.loads(b,object_pairs_hook=pairs)
def meta(s):return {k:(stat.S_IMODE(s.st_mode) if k=='mode' else getattr(s,'st_'+v)) for k,v in [('device','dev'),('inode','ino'),('mode','mode'),('uid','uid'),('gid','gid'),('nlink','nlink'),('bytes','size'),('mtimeNs','mtime_ns'),('ctimeNs','ctime_ns')]}
def utc():return dt.datetime.now(dt.timezone.utc).isoformat()
def canonical(p,existing=True):
 p=pathlib.Path(p);need(p.is_absolute() and str(p)==str(p) and '..' not in p.parts,'PATH_NOT_CANONICAL')
 for q in [p if existing else p.parent,*p.parents]:need(not q.is_symlink(),'PATH_SYMLINK');need(q.exists(),'PATH_MISSING')
 need((p if existing else p.parent).resolve(strict=True)==(p if existing else p.parent),'PATH_NOT_CANONICAL');return p

def stable_read(p,limit,expected_sha=None,expected_meta=None,uid=None,gid=None,mode=None):
 p=canonical(p);s=p.lstat();m=meta(s);need(stat.S_ISREG(s.st_mode) and s.st_nlink==1 and s.st_size<=limit,'BOUNDED_FILE_SHAPE')
 if uid is not None:need(s.st_uid==uid,'FILE_OWNER')
 if gid is not None:need(s.st_gid==gid,'FILE_GROUP')
 if mode is not None:need(stat.S_IMODE(s.st_mode)==mode,'FILE_MODE')
 if expected_meta is not None:need(m==expected_meta,'FROZEN_FILE_IDENTITY')
 fd=os.open(p,os.O_RDONLY|os.O_NOFOLLOW|os.O_NOATIME)
 try:
  with os.fdopen(fd,'rb',closefd=False) as f:b=f.read(limit+1)
  need(len(b)==s.st_size and meta(os.fstat(fd))==m==meta(p.lstat()),'FROZEN_FILE_CHANGED')
 finally:os.close(fd)
 if expected_sha:need(sha(b)==expected_sha,'FROZEN_FILE_HASH')
 return b,m

def sync_dir(p):
 p=canonical(p);s=p.lstat();need(stat.S_ISDIR(s.st_mode),'DIRECTORY_SHAPE');fd=os.open(p,os.O_DIRECTORY|os.O_RDONLY|os.O_NOFOLLOW)
 try:need(meta(os.fstat(fd))==meta(s)==meta(p.lstat()),'DIR_DESCRIPTOR_IDENTITY');os.fsync(fd)
 finally:os.close(fd)
def new_dir(p,mode=0o700):
 p=canonical(p,False);need(not os.path.lexists(p),'NEW_DIRECTORY_COLLISION');parent=p.parent.lstat();need(parent.st_uid==0 and not stat.S_IMODE(parent.st_mode)&0o022,'UNSAFE_PARENT');p.mkdir(mode=mode);os.chmod(p,mode);sync_dir(p.parent);need(p.stat().st_uid==p.stat().st_gid==0 and stat.S_IMODE(p.stat().st_mode)==mode,'NEW_DIRECTORY_OWNER');return p

def durable(p,value,raw=False):
 p=canonical(p,False);parent=p.parent.stat();need(parent.st_uid==parent.st_gid==0 and stat.S_IMODE(parent.st_mode)==0o700,'PRIVATE_OUTPUT_PARENT');b=value if raw else encoded(value);need(len(b)<=REQUEST_MAX if p.name in ('reviewed-request.json','controller.py') else len(b)<=64*1024**2,'PRIVATE_OUTPUT_BOUND');fd=os.open(p,os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW,0o600)
 try:
  os.fchmod(fd,0o600);pos=0
  while pos<len(b):pos+=os.write(fd,b[pos:])
  os.fsync(fd);s=os.fstat(fd);need(meta(s)==meta(p.stat()) and s.st_uid==s.st_gid==0 and stat.S_IMODE(s.st_mode)==0o600 and s.st_nlink==1 and s.st_size==len(b),'PRIVATE_OUTPUT_IDENTITY')
 finally:os.close(fd)
 sync_dir(p.parent)

def bounded(argv,seconds=10,limit=65536,allow_status_stderr=False):
 p=subprocess.Popen(argv,stdout=subprocess.PIPE,stderr=subprocess.PIPE,env=ENV,start_new_session=True);out=bytearray();err=0;beg=time.monotonic();sel=selectors.DefaultSelector();sel.register(p.stdout,selectors.EVENT_READ,'out');sel.register(p.stderr,selectors.EVENT_READ,'err')
 try:
  while sel.get_map():
   need(time.monotonic()-beg<seconds,'COMMAND_DEADLINE')
   for key,_ in sel.select(.1):
    b=os.read(key.fileobj.fileno(),65536)
    if not b:sel.unregister(key.fileobj);continue
    if key.data=='out':out.extend(b);need(len(out)<=limit,'COMMAND_OUTPUT_BOUND')
    else:err+=len(b);need(err<=8192,'COMMAND_ERROR_BOUND')
  need(p.wait(timeout=3)==0 and (err==0 or allow_status_stderr),'COMMAND_REFUSED');return bytes(out)
 finally:
  if p.poll() is None:os.killpg(p.pid,9);p.wait(timeout=3)
  p.stdout.close();p.stderr.close();sel.close()

def props(unit,names):
 b=bounded(['/usr/bin/systemctl','show',unit,*['--property='+n for n in names]],5)
 d={}
 for line in b.decode().splitlines():k,v=line.split('=',1);need(k not in d,'DUPLICATE_UNIT_PROPERTY');d[k]=v
 need(set(d)==set(names),'UNIT_PROPERTY_SHAPE');return d

def validate(r):
 keys={'schema','approvalSha256','runId','host','bootstrapSHA256','bootstrapBase64','sources','liveServices','binaries','phase7','backupWindow'}
 need(set(r)==keys and r['schema']=='pow-audit30-private-mail-census-root-request-v1' and r['approvalSha256']==APPROVAL,'REQUEST_AUTHORITY');rid=r['runId'];need(type(rid) is str and RUN.fullmatch(rid),'RUN_ID');dt.datetime.strptime(rid,'%Y%m%dT%H%M%SZ');need(re.fullmatch('[A-Za-z0-9.-]+',r['host']) and SHA.fullmatch(r['bootstrapSHA256']),'REQUEST_HOST_SHA')
 need(set(r['sources'])==set(PINS),'SOURCE_SET')
 for n,x in r['sources'].items():need(set(x)=={'sha256','base64'} and x['sha256']==PINS[n] and sha(base64.b64decode(x['base64'],validate=True))==PINS[n] and len(base64.b64decode(x['base64'],validate=True))<=INPUT_SOURCE_MAX,'SOURCE_BYTES')
 need(sha(base64.b64decode(r['bootstrapBase64'],validate=True))==r['bootstrapSHA256'] and len(base64.b64decode(r['bootstrapBase64'],validate=True))<=INPUT_SOURCE_MAX,'BOOTSTRAP_BYTES')
 need(set(r['liveServices'])==set(SERVICES),'LIVE_SET')
 for x in r['liveServices'].values():need(set(x)=={'MainPID','InvocationID'} and str(x['MainPID']).isdigit() and int(x['MainPID'])>0 and re.fullmatch('[0-9a-f]{32}',x['InvocationID']),'LIVE_REFERENCE')
 need(set(r['binaries'])==set(BINARIES),'BINARY_SET')
 for n,x in r['binaries'].items():need(set(x)=={'path','realPath','metadata','sha256'} and x['path']==BINARIES[n] and str(pathlib.Path(x['realPath'])).startswith(('/usr/','/opt/')) and SHA.fullmatch(x['sha256']),'BINARY_REFERENCE')
 phase=r['phase7'];need(set(phase)=={'job','unit','proofs'} and re.fullmatch('/data/proofofwork-audit30-restore-[0-9]{8}T[0-9]{6}Z',phase['job']) and phase['unit']=='proofofwork-audit30-logical-restore-'+phase['job'].rsplit('-',1)[1]+'.service' and set(phase['proofs'])==set(PROOFS),'PHASE7_SCOPE')
 for x in phase['proofs'].values():need(set(x)=={'sha256','metadata'} and SHA.fullmatch(x['sha256']),'PHASE7_PROOF')
 need(set(r['backupWindow'])=={'capturedAtUtc','nextScheduledAtUtc'},'WINDOW_SHAPE')
 for v in r['backupWindow'].values():need(dt.datetime.fromisoformat(v).utcoffset()==dt.timedelta(0),'WINDOW_UTC')
 return r

def capacity(job=None):
 d=os.statvfs('/data');r=os.statvfs('/');m={k:int(v.split()[0])*1024 for k,v in [line.split(':',1) for line in pathlib.Path('/proc/meminfo').read_text().splitlines() if ':' in line]}
 need(d.f_bavail*d.f_frsize>=DATA_FLOOR+(PRIVATE_MAX if job is None else 0) and r.f_bavail*r.f_frsize>=ROOT_FLOOR and m['MemAvailable']>=MEM_FLOOR,'RESOURCE_RESERVE')
 if job:
  count=0;total=0
  for p in pathlib.Path(job).iterdir():
   s=p.lstat();need(stat.S_ISREG(s.st_mode) and s.st_nlink==1 and s.st_uid==s.st_gid==0 and stat.S_IMODE(s.st_mode)==0o600,'PRIVATE_JOB_FILE');count+=1;total+=s.st_blocks*512
  need(count<=16 and total<=PRIVATE_MAX,'PRIVATE_ALLOCATION_BOUND')
 return dict(dataAvailableBytes=d.f_bavail*d.f_frsize,rootAvailableBytes=r.f_bavail*r.f_frsize,memAvailableBytes=m['MemAvailable'])

def admission(r,fresh=True):
 need(os.geteuid()==os.getegid()==0 and os.uname().nodename==r['host'],'ROOT_HOST')
 for u,x in r['liveServices'].items():need(props(u,['ActiveState','MainPID','InvocationID'])==dict(ActiveState='active',**{k:str(v) for k,v in x.items()}),'LIVE_SERVICE_DRIFT')
 for n,x in r['binaries'].items():
  need(str(pathlib.Path(x['path']).resolve(strict=True))==x['realPath'],'EXECUTABLE_RESOLUTION_CHANGED');b,m=stable_read(x['realPath'],64*1024**2,x['sha256'],x['metadata'],uid=0);need(m['mode']&0o111 and not m['mode']&0o022,'EXECUTABLE_MODE')
 need(bounded([BINARIES['psql16'],'--version'],5).decode().startswith('psql (PostgreSQL) 16.'),'PG16_VERSION');need(bounded([BINARIES['python'],'-I','-B','-c','import sys;print(sys.version_info.major)'],5).strip()==b'3','PYTHON_VERSION');need(bounded([BINARIES['core-cli'],'-version'],5).decode().startswith('Bitcoin Core RPC client version v'),'CORE_CLI_VERSION')
 phase=r['phase7'];job=canonical(phase['job']);who=pwd.getpwnam('postgres');j=job.stat();need(j.st_uid==who.pw_uid and j.st_gid==who.pw_gid and stat.S_IMODE(j.st_mode)==0o700,'PHASE7_JOB_OWNER');values={}
 for n,x in phase['proofs'].items():values[n]=parse(stable_read(job/n,PROOF_MAX,x['sha256'],x['metadata'],who.pw_uid,who.pw_gid,0o600)[0])
 done=values['completed.json'];need(done.get('schema')=='pow-audit30-isolated-logical-restore-completed-v1' and done.get('status')=='passed' and done.get('productionDatabaseMutation') is False and all(done.get(k) is True for k in ['allTableRowHashParity','amcheckPassed','offlinePrivatePageChecksPassed','privateClusterStopped','liveServicesUnchanged']),'PHASE7_NOT_COMPLETE')
 need(values['table-row-parity.json'].get('allMatched') is True and values['offline-page-check.json'].get('returnCode')==0,'PHASE7_TABLE_PAGE_PROOF');p=props(phase['unit'],['LoadState','ActiveState','SubState','MainPID']);need(p in [dict(LoadState=x,ActiveState='inactive',SubState='dead',MainPID='0') for x in ('loaded','not-found')],'PHASE7_UNIT_NOT_STOPPED')
 for p in [job/'cluster'/'postmaster.pid',job/'socket'/'.s.PGSQL.55432']:need(not os.path.lexists(p),'PHASE7_PID_SOCKET_PRESENT')
 control=bounded([BINARIES['pg-control16'],str(job/'cluster')],10).decode();fields={k.strip():v.strip() for line in control.splitlines() if ':' in line for k,v in [line.split(':',1)]};need(fields.get('Database cluster state')=='shut down' and fields.get('Data page checksum version')=='1','PHASE7_CONTROL_NOT_STOPPED')
 intent=values['intent.json'];need(intent.get('schema')=='pow-audit30-isolated-restore-intent-v1' and intent.get('productionDatabaseMutation') is False and done.get('planSha256')==intent.get('planSha256') and intent.get('plan',{}).get('controllerSha256')=='26c7656b2e751c6de50122c65f8af73686c2d2674bee8be86a3c5648b7fcc80e','PHASE7_INTENT_BINDING')
 need(intent['plan']['liveServices']==r['liveServices'] and intent['plan'].get('job')==phase['job'] and intent['plan'].get('unit')==phase['unit'] and intent['plan'].get('host')==r['host'] and intent['plan'].get('approvalSha256')==APPROVAL,'PHASE7_LIVE_BASELINE')
 now=dt.datetime.now(dt.timezone.utc);captured=dt.datetime.fromisoformat(r['backupWindow']['capturedAtUtc']);deadline=dt.datetime.fromisoformat(r['backupWindow']['nextScheduledAtUtc']);need((not fresh or 0<=(now-captured).total_seconds()<=900) and (deadline-now).total_seconds()>=(1200 if fresh else 60),'BACKUP_CLEAR_WINDOW')
 need(props('proofofwork-postgres-logical-backup.service',['ActiveState','SubState','MainPID'])==dict(ActiveState='inactive',SubState='dead',MainPID='0'),'BACKUP_NOT_QUIET');timer=props('proofofwork-postgres-logical-backup.timer',['ActiveState','NextElapseUSecRealtime']);need(timer['ActiveState']=='active' and dt.datetime.strptime(timer['NextElapseUSecRealtime'],'%a %Y-%m-%d %H:%M:%S %Z').replace(tzinfo=dt.timezone.utc)==deadline,'BACKUP_TIMER_DRIFT')
 for proc in pathlib.Path('/proc').iterdir():
  if proc.name.isdigit():
   try:name=(proc/'comm').read_text().strip()
   except (FileNotFoundError,ProcessLookupError):continue
   need(name not in ('pg_dump','pg_basebackup'),'BACKUP_WRITER_EXISTS')
 return dict(atUtc=utc(),liveServices=r['liveServices'],phase7ProofSHA256={n:x['sha256'] for n,x in phase['proofs'].items()},phase7UnitStopped=True,phase7ControlOutputSHA256=sha(control.encode()),capacity=capacity())

def locations(r):
 return pathlib.Path(PACKAGE_PARENT)/(r['runId']+'-'+r['bootstrapSHA256'][:12]),pathlib.Path(EVIDENCE_PARENT)/('audit30-mail-body-census-'+r['runId'])

def install(r,raw):
 validate(r);before=admission(r);package,job=locations(r)
 need(not os.path.lexists(package) and not os.path.lexists(job),'SCOPE_ALREADY_EXISTS');parent=pathlib.Path(PACKAGE_PARENT)
 if not parent.exists():new_dir(parent)
 else:canonical(parent);s=parent.stat();need(s.st_uid==s.st_gid==0 and stat.S_IMODE(s.st_mode)==0o700,'PACKAGE_PARENT_UNSAFE')
 new_dir(package);new_dir(job)
 try:
  for n,x in r['sources'].items():durable(package/n,base64.b64decode(x['base64'],validate=True),True)
  durable(package/'controller.py',base64.b64decode(r['bootstrapBase64'],validate=True),True);durable(package/'reviewed-request.json',raw,True);durable(job/'bootstrap-intent.json',dict(schema='pow-audit30-mail-root-bootstrap-intent-v1',atUtc=utc(),requestSHA256=sha(raw),bootstrapSHA256=r['bootstrapSHA256'],package=str(package),job=str(job),sources=PINS,admission=before,productionDataMutation=False))
  unit='proofofwork-audit30-mail-census-'+r['runId']+'.service'
  argv=['/usr/bin/systemd-run','--unit='+unit,'--service-type=exec','--property=User=root','--property=Group=root','--property=UMask=0077','--property=RuntimeMaxSec=930s','--property=TimeoutStopSec=30s','--property=MemoryMax=2G','--property=MemorySwapMax=0','--property=CPUQuota=50%','--property=TasksMax=64','--property=KillMode=control-group','--property=ProtectSystem=strict','--property=ProtectHome=yes','--property=PrivateTmp=yes','--property=PrivateDevices=yes','--property=PrivateIPC=yes','--property=NoNewPrivileges=yes','--property=ReadWritePaths='+str(job),'/usr/bin/python3','-I','-B',str(package/'controller.py'),'run','--request',str(package/'reviewed-request.json'),'--request-sha256',sha(raw)]
  # systemd-run is nonblocking; root separately observes exact unit/evidence.
  bounded(argv,15,allow_status_stderr=True);durable(job/'bootstrap-launched.json',dict(schema='pow-audit30-mail-root-bootstrap-launched-v1',atUtc=utc(),unit=unit,requestSHA256=sha(raw),package=str(package),job=str(job),productionDataMutation=False));return dict(status='launched',unit=unit,package=str(package),job=str(job),requestSHA256=sha(raw),productionDataMutation=False)
 except BaseException as e:
  durable(job/'bootstrap-failed.json',dict(schema='pow-audit30-mail-root-bootstrap-failed-v1',atUtc=utc(),errorClass=type(e).__name__,requestSHA256=sha(raw),productionDataMutation=False,allFilesRetained=True));raise

def checked_runtime(r):
 package,job=locations(r);unit='proofofwork-audit30-mail-census-'+r['runId']+'.service';need(any(x.split(':',2)[-1]=='/system.slice/'+unit for x in pathlib.Path('/proc/self/cgroup').read_text().splitlines()),'UNMANAGED_CGROUP')
 wanted=dict(User='root',Group='root',UMask='0077',RuntimeMaxUSec='15min 30s',MemoryMax=str(2*1024**3),MemorySwapMax='0',CPUQuotaPerSecUSec='500ms',TasksMax='64',KillMode='control-group',ProtectSystem='strict',ProtectHome='yes',PrivateTmp='yes',PrivateDevices='yes',PrivateIPC='yes',PrivateNetwork='no',NoNewPrivileges='yes',ReadWritePaths=str(job))
 need(props(unit,list(wanted))==wanted,'UNIT_SHAPE')
 need(pathlib.Path(__file__)==package/'controller.py','CONTROLLER_PATH');stable_read(__file__,INPUT_SOURCE_MAX,r['bootstrapSHA256'],uid=0,gid=0,mode=0o600)
 for n,h in PINS.items():stable_read(package/n,INPUT_SOURCE_MAX,h,uid=0,gid=0,mode=0o600)
 for p in [package,job]:s=canonical(p).stat();need(s.st_uid==s.st_gid==0 and stat.S_IMODE(s.st_mode)==0o700,'ROOT_PRIVATE_PATH_MODE')
 need(os.statvfs(package).f_flag&os.ST_RDONLY and not os.statvfs(job).f_flag&os.ST_RDONLY,'PRIVATE_MOUNT_BOUNDARY');return package,job

def file_child(argv,job,stem,seconds,started,monitor=None):
 out=job/(stem+'.json');err=job/(stem+'.stderr');fds=[os.open(p,os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW,0o600) for p in (out,err)]
 try:
  p=subprocess.Popen(argv,stdout=fds[0],stderr=fds[1],env=ENV,start_new_session=True);end=time.monotonic()+seconds;last_monitor=time.monotonic()-6
  try:
   while p.poll() is None:
    need(time.monotonic()<end and time.monotonic()-started<915,'WHOLE_CHILD_DEADLINE');capacity(job)
    if monitor and time.monotonic()-last_monitor>=5:monitor();last_monitor=time.monotonic()
    time.sleep(.2)
   need(p.returncode==0,'CHILD_REFUSED')
  finally:
   if p.poll() is None:os.killpg(p.pid,9);p.wait(timeout=5)
  for fd in fds:os.fsync(fd)
 finally:
  for fd in fds:os.close(fd)
 sync_dir(job);need(err.stat().st_size==0,'CHILD_ERROR_OUTPUT');b,m=stable_read(out,64*1024**2,uid=0,gid=0,mode=0o600);return parse(b),dict(path=str(out),sha256=sha(b),bytes=len(b))

def watch_window(r):
 deadline=dt.datetime.fromisoformat(r['backupWindow']['nextScheduledAtUtc']);need((deadline-dt.datetime.now(dt.timezone.utc)).total_seconds()>=60,'BACKUP_RUNTIME_WINDOW')
 need(props('proofofwork-postgres-logical-backup.service',['ActiveState','SubState','MainPID'])==dict(ActiveState='inactive',SubState='dead',MainPID='0'),'BACKUP_NOT_QUIET')
 timer=props('proofofwork-postgres-logical-backup.timer',['ActiveState','NextElapseUSecRealtime']);need(timer['ActiveState']=='active' and dt.datetime.strptime(timer['NextElapseUSecRealtime'],'%a %Y-%m-%d %H:%M:%S %Z').replace(tzinfo=dt.timezone.utc)==deadline,'BACKUP_TIMER_DRIFT')

def stop_native_sql(r,package,job):
 p=package/'private-census.py';source,_=stable_read(p,INPUT_SOURCE_MAX,PINS['private-census.py'],uid=0,gid=0,mode=0o600);namespace={'__file__':str(p),'__name__':'_reviewed_native_mail_sql_cleanup'};exec(compile(source,str(p),'exec'),namespace)
 proof=namespace['cleanup_native_sql'](str(job/'preimages.jsonl'));need(proof.get('unit')=='proofofwork-audit30-mail-sql-'+r['runId']+'.service' and proof.get('stopped') is True,'SQL_SUBUNIT_STOP_NOT_PROVEN');return proof

def run(r,raw):
 package,job=checked_runtime(r);before=admission(r);started=time.monotonic();phase='census';sql_stopped=False
 def interrupted(*_):raise InterruptedError('RUN_INTERRUPTED')
 previous={q:signal.signal(q,interrupted) for q in (signal.SIGTERM,signal.SIGINT,signal.SIGHUP)}
 try:
  durable(job/'run-intent.json',dict(schema='pow-audit30-mail-root-run-intent-v1',atUtc=utc(),requestSHA256=sha(raw),admission=before,productionDataMutation=False))
  public,census_binding=file_child([BINARIES['python'],'-I','-B',str(package/'private-census.py'),'--private-preimages',str(job/'preimages.jsonl'),'--census-source',str(package/'mail-body-census.py'),'--core-cli',BINARIES['core-cli'],'--core-datadir','/data/bitcoin','--core-conf','/etc/bitcoin/bitcoin.conf'],job,'public-census',850,started,lambda:watch_window(r))
  need(public.get('ok') is True and public.get('coreVerified') is True and public.get('privateCapture',{}).get('complete') is True,'CENSUS_NOT_COMPLETE');capture=public['privateCapture'];need(capture.get('path')==str(job/'preimages.jsonl') and capture.get('bytes')<=360*1024**2 and SHA.fullmatch(capture.get('sha256','')),'CAPTURE_OUTPUT_SCOPE');stable_read(job/'preimages.jsonl',360*1024**2,capture['sha256'],uid=0,gid=0,mode=0o600)
  phase='build';custody,build_binding=file_child([BINARIES['python'],'-I','-B',str(package/'repair-plan.py'),'--capture',str(job/'preimages.jsonl'),'--capture-sha256',capture['sha256'],'--census-source',str(package/'mail-body-census.py'),'--wrapper-sha256',PINS['private-census.py'],'--engine-sha256',PINS['rehearsal-engine.mjs'],'--private-plan',str(job/'phase4-private-plan.json'),'--public-manifest',str(job/'proposed-body-only-manifest.json')],job,'plan-custody',60,started,lambda:watch_window(r))
  pbytes,_=stable_read(job/'phase4-private-plan.json',360*1024**2,custody.get('privatePlanSHA256'),uid=0,gid=0,mode=0o600);manifest,m=stable_read(job/'proposed-body-only-manifest.json',64*1024**2,custody.get('publicManifestSHA256'),uid=0,gid=0,mode=0o600);need(parse(manifest).get('productionApplyApproved') is False and parse(pbytes)['manifestSHA256']==custody['publicManifestSHA256'],'PROPOSED_MANIFEST_ONLY')
  phase='sql-stop';sql_proof=stop_native_sql(r,package,job);durable(job/'sql-subunit-final.json',sql_proof);sql_stopped=True
  phase='final';after=admission(r,False);checked_runtime(r);cap=capacity(job);durable(job/'completed.json',dict(schema='pow-audit30-mail-root-census-build-completed-v1',status='passed',atUtc=utc(),requestSHA256=sha(raw),bootstrapSHA256=r['bootstrapSHA256'],sources=PINS,nativeSqlSubunitStopped=True,sqlSubunitProofSHA256=sha(encoded(sql_proof)),censusReceipt=census_binding,buildReceipt=build_binding,privateCaptureSHA256=capture['sha256'],privatePlanSHA256=custody['privatePlanSHA256'],publicManifestSHA256=custody['publicManifestSHA256'],candidateCount=custody['targetCount'],liveServicesUnchanged=True,phase7StillStopped=True,productionDataMutation=False,productionApplyApproved=False,allPrivatePreimagesRetained=True,elapsedSeconds=time.monotonic()-started,capacity=cap));return dict(status='passed',job=str(job),candidateCount=custody['targetCount'],publicManifestSHA256=custody['publicManifestSHA256'],productionDataMutation=False)
 except BaseException as e:
  for q in previous:signal.signal(q,signal.SIG_IGN)
  durable(job/'failed.json',dict(schema='pow-audit30-mail-root-census-build-failed-v1',status='failed',atUtc=utc(),phase=phase,errorClass=type(e).__name__,code=str(e) if re.fullmatch('[A-Z0-9_]+',str(e)) else 'DETAIL_REDACTED',productionDataMutation=False,allFilesRetained=True,automaticRetry=False));raise
 finally:
  try:
   if not sql_stopped:
    try:sql_proof=stop_native_sql(r,package,job);durable(job/'sql-subunit-final.json',sql_proof)
    except BaseException as e:
     durable(job/'sql-subunit-stop-failed.json',dict(schema='pow-audit30-mail-sql-stop-failed-v1',errorClass=type(e).__name__,stopped=False,automaticRetry=False,productionDataMutation=False));raise
  finally:
   for q,v in previous.items():signal.signal(q,v)

def main(argv=None):
 os.umask(0o077);a=argparse.ArgumentParser();a.add_argument('mode',choices=['install','run','validate-request']);a.add_argument('--request');a.add_argument('--request-sha256',required=True);o=a.parse_args(argv);need(SHA.fullmatch(o.request_sha256),'REQUEST_SHA')
 raw=sys.stdin.buffer.read(REQUEST_MAX+1) if o.mode in ('install','validate-request') else stable_read(o.request,REQUEST_MAX,o.request_sha256,uid=0,gid=0,mode=0o600)[0];need(len(raw)<=REQUEST_MAX and sha(raw)==o.request_sha256,'REQUEST_RAW_SHA');r=validate(parse(raw));result=dict(status='valid',requestSHA256=sha(raw),productionDataMutation=False,productionExecuted=False) if o.mode=='validate-request' else (install(r,raw) if o.mode=='install' else run(r,raw));sys.stdout.buffer.write(encoded(result));return 0
if __name__=='__main__':
 code=0
 try:code=main()
 except BaseException as e:
  sys.stdout.write(json.dumps(dict(status='refused',errorClass=type(e).__name__,code=str(e) if re.fullmatch('[A-Z0-9_]+',str(e)) else 'DETAIL_REDACTED',productionDataMutation=False,automaticRetry=False)));code=1
 sys.exit(code)
