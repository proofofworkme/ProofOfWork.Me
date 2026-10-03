#!/usr/bin/env python3
"""Approved item 2: fresh production capture and unchanged installed strict verifier.

Call main with an exact {path, sha256} binding for the successful canonical
cutover final receipt. This source does not run merely by being imported.
"""
import datetime,hashlib,json,os,pathlib,pwd,re,signal,stat,subprocess,time
RELEASE='38ac6e2bff2a-20261003T042000Z'
ROOT=pathlib.Path('/data/proofofwork-release-backups/audit30-node-release-'+RELEASE)
TOOLS=pathlib.Path('/var/tmp/proofofwork-deploy/audit29-tools')
ATTEMPT='production-strict-v2'
UNIT='proofofwork-audit29-verify-'+RELEASE+'-production-'+ATTEMPT+'.service'
TOKEN=RELEASE+'-production-'+ATTEMPT
BASE='https://computer.proofofwork.me';AUTHORITY='http://127.0.0.1:8081'
CANDIDATE=dict(commit='38ac6e2bff2ac16890724e5213346ef8a3ebd186',tree='8b9b5e3cd47aa8e4204da717350a629176e30da6',runtimeSha256='13035b6d1fbca1be9c03b1833f3abe578d4ae28331a341b3dea4301cc72b535c')
API_SHA='9ab92c0fe3cb358fcaacccd62915eabc4c9ee75e42d29c6c989259b1305436f4'
DRIVER_SHA='bbded71fa88cfc108c611b3beddd3a6c693b38477c356b682caed8985976abda'
PINS={'private-verify.py':'8a569828272b10abc8848dd01678a1a3b45002acd489802f89b6e056de3e0c1e','private-env.py':'99cbe9cd118c63b08480efd28c2ae7c059b5204daef8db08b896a38fc791d515','attest-node.py':'4bec20fa1e5931636e3bfc84f617f005a7b1b71e752dc7f7c9b8bea23014be38','install-ops.py':'f8dcc8489537a3ddefa392cb586857fdab88874e6b3c7a2f61a69ec45b0b7c25'}
AUTHORITIES={'bitcoind.service':('1324302','64e1fa7be2e2442d8c7f5763f60b85fb'),'electrs.service':('1324320','72418b1c7ab245e4a37685ed868a1084'),'postgresql@16-main.service':('1537429','e0bf545f0ad944e89fe1005577e61b9c')}
APPS={'api':'proofofwork-api.service','worker':'proofofwork-indexer-worker.service'}
EXTRA_QUIET=['proofofwork-audit29-shadow-'+RELEASE+'.service','proofofwork-audit29-shadow-'+RELEASE+'-lease-v3.service','proofofwork-audit29-verify-'+RELEASE+'-shadow-strict-v2.service','proofofwork-audit29-verify-'+RELEASE+'-shadow-strict-v3.service','proofofwork-audit30-mail-api-baseline-20261003T050300Z.service','proofofwork-audit30-candidate-bond-pages-38ac-v2.service','proofofwork-audit30-candidate-full-ids-'+RELEASE+'-fence-diagnostic-v3.service']
E={'PATH':'/usr/bin:/bin','LC_ALL':'C','GIT_OPTIONAL_LOCKS':'0'}
WHOLE=1320;OUTPUT_CAP=65536
def need(v,m):
 if not v:raise ValueError(m)
def stamp(s):return(s.st_dev,s.st_ino,s.st_mode,s.st_uid,s.st_gid,s.st_nlink,s.st_size,s.st_mtime_ns,s.st_ctime_ns)
def read(p,cap=2*1024**2,expected=None):
 p=pathlib.Path(p);s=p.lstat();need(p.resolve()==p and stat.S_ISREG(s.st_mode)and s.st_uid==s.st_gid==0 and stat.S_IMODE(s.st_mode)==0o600 and s.st_nlink==1 and 0<s.st_size<=cap,'PRIVATE_SHAPE');fd=os.open(p,os.O_RDONLY|os.O_NOFOLLOW|os.O_NOATIME)
 try:
  raw=b''
  while True:
   b=os.read(fd,min(65536,cap+1-len(raw)))
   if not b:break
   raw+=b;need(len(raw)<=cap,'PRIVATE_CAP')
  need(len(raw)==s.st_size and stamp(os.fstat(fd))==stamp(s)==stamp(p.lstat())and(expected is None or hashlib.sha256(raw).hexdigest()==expected),'PRIVATE_DRIFT');return raw
 finally:os.close(fd)
def state(u):
 r=subprocess.run(['/usr/bin/systemctl','show',u,'--property=LoadState,ActiveState,SubState,MainPID,InvocationID,Result,ExecStart,User,Group,Restart,KillMode,RuntimeMaxUSec,ExecMainStartTimestampMonotonic,UnitFileState'],env=E,capture_output=True,timeout=10);need(r.returncode==0 and not r.stderr and len(r.stdout)<=65536,'STATE_REFUSED');return dict(x.split('=',1)for x in r.stdout.decode().splitlines()if '='in x)
def live():
 rows={u:state(u)for u in list(AUTHORITIES)+list(APPS.values())}
 need(all(rows[u].get('ActiveState')=='active'and(rows[u].get('MainPID'),rows[u].get('InvocationID'))==pair for u,pair in AUTHORITIES.items()),'ORIGINAL_AUTHORITIES_CHANGED')
 need(all(rows[u].get('ActiveState')=='active'and rows[u].get('SubState')=='running'and str(rows[u].get('MainPID','')).isdigit()and int(rows[u]['MainPID'])>1 and re.fullmatch('[0-9a-f]{32}',rows[u].get('InvocationID',''))for u in APPS.values()),'PRODUCTION_APPS_UNQUALIFIED')
 return rows
def timer_shape():return{k:v for k,v in state('proofofwork-postgres-logical-backup.timer').items()if k in ['LoadState','ActiveState','SubState','UnitFileState']}
def quiet(row):return row.get('MainPID','0')=='0'and(row.get('LoadState')=='not-found'or row.get('ActiveState')in ['inactive','failed'])
def validate_cutover(binding,receipt,at=None):
 need(type(binding)is dict and set(binding)=={'path','sha256'}and re.fullmatch('[0-9a-f]{64}',str(binding['sha256']))and re.fullmatch(re.escape('/data/proofofwork-audit29-cutover-'+RELEASE)+r'-[a-z0-9][a-z0-9-]{0,24}/[0-9]{3}-final\.json',str(binding['path'])),'CUTOVER_BINDING')
 need(receipt.get('ok')is True and receipt.get('phase')=='complete'and receipt.get('commit')==CANDIDATE['commit']and receipt.get('authorityServicesModified')is False and receipt.get('recoveryRemoved')is False,'CUTOVER_NOT_COMPLETE')
 date=datetime.datetime.fromisoformat(receipt['at'].replace('Z','+00:00'));need(date.tzinfo is not None and 0<=((at or datetime.datetime.now(datetime.timezone.utc))-date).total_seconds()<=1800,'CUTOVER_STALE')
def record(kind,v):
 p=ROOT/('production-strict-v2-'+kind+'.json');fd=os.open(p,os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW,0o600)
 with os.fdopen(fd,'wb')as f:f.write((json.dumps(v,sort_keys=True)+'\n').encode());f.flush();os.fsync(f.fileno())
 fd=os.open(ROOT,os.O_RDONLY|os.O_DIRECTORY|os.O_NOFOLLOW)
 try:os.fsync(fd)
 finally:os.close(fd)
def owned(st,inv):
 command=st.get('ExecStart','')
 return st.get('LoadState')=='loaded'and st.get('InvocationID')==inv and st.get('User')==st.get('Group')=='root'and st.get('Restart')=='no'and str(TOOLS/'private-verify.py')in command and '--mode production --release-id '+RELEASE+' --capture-id 'in command and '--attempt '+ATTEMPT+' --base-url '+BASE in command and st.get('KillMode')=='control-group'and st.get('RuntimeMaxUSec')=='20min'
def stop_owned(inv):
 s=state(UNIT)
 if s.get('LoadState')=='not-found'and s.get('MainPID','0')=='0':return
 need(inv and owned(s,inv),'STRICT_OWNERSHIP_CHANGED')
 if s.get('MainPID','0')!='0':
  r=subprocess.run(['/usr/bin/systemctl','stop',UNIT],env=E,capture_output=True,timeout=40);need(r.returncode==0 and not r.stderr,'STRICT_STOP_REFUSED')
 need(state(UNIT).get('MainPID','0')=='0','STRICT_NOT_STOPPED')
def cleanup_owned_transport(p,inv):
 clean=[];signal.signal(signal.SIGTERM,signal.SIG_IGN);signal.signal(signal.SIGINT,signal.SIG_IGN)
 try:stop_owned(inv)
 except BaseException as c:clean.append(type(c).__name__)
 try:
  if p is not None and p.poll()is None:os.killpg(p.pid,signal.SIGTERM);p.wait(timeout=3)
 except BaseException as c:
  clean.append(type(c).__name__)
  try:os.killpg(p.pid,signal.SIGKILL);p.wait(timeout=3)
  except BaseException as c:clean.append(type(c).__name__)
 return clean
def interrupted(s,f):raise RuntimeError('PRODUCTION_STRICT_SIGNAL')
def validate_capture(manifest,capture_id,api_sha,identities,at=None):
 need(manifest.get('format')=='private-audit5-environments-v1'and manifest.get('releaseId')==capture_id and set(manifest.get('processes',{}))==set(APPS)and re.fullmatch('[0-9a-f]{64}',str(api_sha)),'CAPTURE_SHAPE')
 date=datetime.datetime.fromisoformat(manifest['capturedAt']);need(date.tzinfo is not None and 0<=((at or datetime.datetime.now(datetime.timezone.utc))-date).total_seconds()<=120,'CAPTURE_AGE')
 for kind in APPS:
  row=manifest['processes'][kind];need(row['identityBefore']==row['identityAfter']==row['identityFinal']==identities[kind],'CAPTURE_PROCESS_CHANGED')
 need(manifest['processes']['api']['environmentSha256']==api_sha,'CAPTURE_ENVIRONMENT_CHANGED')
def fresh_capture(helper,before):
 account=pwd.getpwnam('powadmin');identities={kind:helper['proc_identity'](kind,account)for kind in APPS}
 need(all(str(identities[kind]['pid'])==before[unit]['MainPID']for kind,unit in APPS.items()),'CAPTURE_LIVE_PID_CHANGED')
 capture_id=CANDIDATE['commit'][:12]+'-'+datetime.datetime.now(datetime.timezone.utc).strftime('%Y%m%dT%H%M%SZ');directory=pathlib.Path(helper['runroot'](capture_id));need(not os.path.lexists(directory),'CAPTURE_EXISTS')
 argv=['/usr/bin/python3','-I','-B',str(TOOLS/'private-verify.py'),'--private-env-sha256',PINS['private-env.py'],'capture','--capture-id',capture_id]
 p=subprocess.run(argv,env=E,capture_output=True,timeout=30);need(p.returncode==0 and not p.stderr and len(p.stdout)<=OUTPUT_CAP,'FRESH_CAPTURE_REFUSED');result=json.loads(p.stdout)
 need(result.get('ok')is True and result.get('operation')=='capture'and result.get('directory')==str(directory),'FRESH_CAPTURE_BINDING')
 helper['check_root_dir'](str(directory));raw=read(directory/'capture.json',65536,result.get('manifestSha256'));manifest=json.loads(raw);validate_capture(manifest,capture_id,result.get('apiEnvironSha256'),identities)
 for kind in APPS:
  row=manifest['processes'][kind];blob=read(directory/(kind+'.environ'),2*1024**2,row['environmentSha256']);need(len(blob)==row['environmentBytes']and helper['proc_identity'](kind,account)==identities[kind],'CAPTURE_CONTENT_DRIFT')
 need(live()==before,'CAPTURE_LIVE_DRIFT')
 return dict(captureId=capture_id,capturedAt=manifest['capturedAt'],directory=str(directory),manifestSHA256=result['manifestSha256'],apiEnvironSHA256=result['apiEnvironSha256'],processes=identities,liveFiveUnchanged=True,privateContentsExported=False)
def build_argv(capture):
 need(re.fullmatch('[0-9a-f]{12}-[0-9]{8}T[0-9]{6}Z',capture['captureId'])and capture['captureId'].startswith(CANDIDATE['commit'][:12]+'-')and re.fullmatch('[0-9a-f]{64}',capture['apiEnvironSHA256']),'CAPTURE_BINDING')
 args=['/usr/bin/python3','-I','-B',str(TOOLS/'private-verify.py'),'--private-env-sha256',PINS['private-env.py'],'verify','--mode','production','--release-id',RELEASE,'--capture-id',capture['captureId'],'--api-environ-sha256',capture['apiEnvironSHA256'],'--candidate-commit',CANDIDATE['commit'],'--candidate-tree',CANDIDATE['tree'],'--runtime-sha256',CANDIDATE['runtimeSha256'],'--script-sha256',DRIVER_SHA,'--source-commit',CANDIDATE['commit'],'--source-api-sha256',API_SHA,'--attestor-sha256',PINS['attest-node.py'],'--ops-installer-sha256',PINS['install-ops.py'],'--attempt',ATTEMPT,'--base-url',BASE,'--wallet-address','18hkqE81wQuq75UEBKhB4JjAuQg47jN7Aa']
 return ['/usr/bin/systemd-run','--quiet','--wait','--pipe','--unit='+UNIT,'--service-type=exec','--property=User=root','--property=Group=root','--property=RuntimeMaxSec=20min','--property=TimeoutStopSec=30s','--property=KillMode=control-group','--property=MemoryMax=4G','--property=MemorySwapMax=0','--property=CPUQuota=100%','--property=TasksMax=128','--property=UMask=0077','/usr/bin/env','-i','PATH=/usr/bin:/bin','LC_ALL=C',*args]
def validate_acceptance(r,capture):
 need(r.get('ok')is True and r.get('mode')=='production'and r.get('candidate')==CANDIDATE,'ACCEPTED_BINDING')
 need(r.get('base')==BASE and r.get('authority')==AUTHORITY and r.get('network')=='livenet'and all(r.get('gates',{}).get(k)is True for k in ['ids','events','parity']),'STRICT_GATES')
 fence=r.get('stableCheckpoint',{});need(type(fence.get('height'))is int and 0<=fence['height']<=9007199254740991 and re.fullmatch('[0-9a-f]{64}',str(fence.get('hash',''))),'STRICT_FENCE')
 launcher=r.get('privateLauncher',{});need(launcher.get('unit')==UNIT and launcher.get('captureId')==capture['captureId']and launcher.get('captureApiSha256')==capture['apiEnvironSHA256']and launcher.get('scriptSha256')==DRIVER_SHA and launcher.get('sourceIdentity')==capture['processes']['api'],'STRICT_LAUNCHER_BINDING')
def main(cutover_binding):
 need(os.getuid()==os.geteuid()==os.getgid()==os.getegid()==0 and sys_isolated(),'ROOT_ISOLATED');os.umask(0o077);start=time.monotonic();deadline=start+WHOLE
 s=ROOT.lstat();need(ROOT.resolve()==ROOT and stat.S_ISDIR(s.st_mode)and s.st_uid==s.st_gid==0 and stat.S_IMODE(s.st_mode)==0o700,'ROOT_DIR')
 validate_cutover(cutover_binding,json.loads(read(cutover_binding['path'],65536,cutover_binding['sha256'])))
 for suffix in ['intent','completed','failed']:need(not os.path.lexists(ROOT/('production-strict-v2-'+suffix+'.json')),'EVIDENCE_EXISTS')
 for prefix in ['proofofwork-audit29-verify-launch-','proofofwork-audit29-verify-output-']:need(not os.path.lexists('/data/'+prefix+TOKEN),'VERIFY_PATH_EXISTS')
 need(state(UNIT)['LoadState']=='not-found','STRICT_UNIT_EXISTS');before=live();backup=state('proofofwork-postgres-logical-backup.service');need(backup['ActiveState']=='inactive'and backup['MainPID']=='0'and backup['Result']=='success','BACKUP_ACTIVE');timer=timer_shape()
 cutover_attempt=pathlib.Path(cutover_binding['path']).parent.name.removeprefix('proofofwork-audit29-cutover-'+RELEASE+'-')
 for unit in EXTRA_QUIET+['proofofwork-audit29-release-'+RELEASE+'-node-'+cutover_attempt+'.service']:
  need(quiet(state(unit)),'AUDIT_LANE_BUSY')
 for name,pin in PINS.items():read(TOOLS/name,expected=pin)
 expected=read(ROOT/'candidate.tsv',65536,'98343f1ecff80e2b203355a2272df966cc108b0a89890c9d3fabfd5b0b8e084d')
 p=subprocess.run(['/usr/bin/python3','-I','-B',str(TOOLS/'attest-node.py'),'/opt/proofofwork-api'],env=E,capture_output=True,timeout=180);need(p.returncode==0 and not p.stderr and p.stdout==expected,'LIVE_CANDIDATE_ATTESTATION')
 helper={'__name__':'_exact_production_private_env','__file__':str(TOOLS/'private-env.py')};exec(compile(read(TOOLS/'private-env.py',expected=PINS['private-env.py']),helper['__file__'],'exec'),helper)
 capture=fresh_capture(helper,before);argv=build_argv(capture);record('intent',dict(schema='pow-audit30-production-strict-intent-v1',unit=UNIT,cutoverFinal=cutover_binding,capture=capture,argv=argv,innerDriverNormalSeconds=1050,innerDriverHardSeconds=1140,innerMaximumChildSeconds=900,managedUnitMaximumSeconds=1200,wholeSupervisorSeconds=WHOLE,productionStop=False,directDatabaseWrites=False))
 p=None;inv='';signal.signal(signal.SIGTERM,interrupted);signal.signal(signal.SIGINT,interrupted)
 try:
  p=subprocess.Popen(argv,env=E,stdout=subprocess.PIPE,stderr=subprocess.PIPE,start_new_session=True)
  while True:
   st=state(UNIT)
   if st.get('LoadState')=='loaded'and st.get('InvocationID'):
    seen=st['InvocationID'];need(re.fullmatch('[0-9a-f]{32}',seen)and owned(st,seen)and(not inv or inv==seen),'STRICT_UNIT_CHANGED');inv=seen
   remaining=deadline-time.monotonic();need(remaining>0,'WHOLE_DEADLINE')
   try:stdout,stderr=p.communicate(timeout=min(1,remaining));break
   except subprocess.TimeoutExpired as e:need(len(e.output or b'')<=OUTPUT_CAP and len(e.stderr or b'')<=OUTPUT_CAP,'OUTPUT_CAP')
  need(len(stdout)<=OUTPUT_CAP and len(stderr)<=OUTPUT_CAP,'OUTPUT_CAP');st=state(UNIT);need(st.get('MainPID','0')=='0'and(st.get('LoadState')=='not-found'or inv and st.get('InvocationID')==inv),'STRICT_UNIT_NOT_STOPPED')
  need(p.returncode==0 and not stderr,'STRICT_DRIVER_REFUSED');root=pathlib.Path('/data/proofofwork-audit29-verify-launch-'+TOKEN);accepted=read(root/'accepted-receipt.json',4*1024**2);r=json.loads(accepted);validate_acceptance(r,capture)
  final=json.loads(read(root/'launcher-final.json'));need(final.get('ok')is True and final.get('errorClass')is None,'LAUNCHER_NOT_ACCEPTED');files=list(root.glob('backup-window-*.restored.json'));need(len(files)==1,'TIMER_RESTORED_EVIDENCE');restored_raw=read(files[0],65536);restored=json.loads(restored_raw);need(restored.get('restored')is True and restored.get('before')==restored.get('after'),'TIMER_NOT_RESTORED');need(live()==before and timer_shape()==timer,'LIVE_OR_TIMER_CHANGED')
  account=pwd.getpwnam('powadmin');need(all(helper['proc_identity'](kind,account)==identity for kind,identity in capture['processes'].items()),'POSTVERIFY_PROCESS_CHANGED');read(cutover_binding['path'],65536,cutover_binding['sha256'])
  report=dict(schema='pow-audit30-production-strict-completed-v1',atUtc=datetime.datetime.now(datetime.timezone.utc).isoformat(),unit=UNIT,invocationID=inv,returncode=p.returncode,stopped=True,cutoverFinal=cutover_binding,capture=capture,acceptedReceiptPath=str(root/'accepted-receipt.json'),acceptedReceiptSHA256=hashlib.sha256(accepted).hexdigest(),timerRestoredReceiptSHA256=hashlib.sha256(restored_raw).hexdigest(),timerRestored=True,liveFiveUnchanged=True,stdoutBytes=len(stdout),stdoutSHA256=hashlib.sha256(stdout).hexdigest(),stderrBytes=len(stderr),stderrSHA256=hashlib.sha256(stderr).hexdigest(),seconds=round(time.monotonic()-start,3),productionStop=False,directDatabaseWrites=False);record('completed',report);return report
 except BaseException as error:
  signal.signal(signal.SIGTERM,signal.SIG_IGN);signal.signal(signal.SIGINT,signal.SIG_IGN);clean=cleanup_owned_transport(p,inv);observed_timer=None;timer_error=None
  try:observed_timer=timer_shape()
  except BaseException as c:timer_error=type(c).__name__
  record('failed',dict(schema='pow-audit30-production-strict-failed-v1',unit=UNIT,invocationID=inv,cutoverFinal=cutover_binding,timerBefore=timer,timerAfterFailure=observed_timer,timerRestored=observed_timer==timer,timerObservationErrorClass=timer_error,errorClass=type(error).__name__,cleanupErrors=clean,automaticRetry=False,productionStop=False,directDatabaseWrites=False));raise
 finally:
  if p is not None:
   if p.stdout is not None:p.stdout.close()
   if p.stderr is not None:p.stderr.close()
def sys_isolated():
 import sys
 return bool(sys.flags.isolated)
