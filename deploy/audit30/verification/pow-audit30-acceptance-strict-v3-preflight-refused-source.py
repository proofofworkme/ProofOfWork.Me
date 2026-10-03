#!/usr/bin/env python3
"""Approved acceptance: fresh capture and installed strict verifier, with owned timer restoration."""
import contextlib,datetime,hashlib,io,json,os,pathlib,pwd,re,signal,stat,subprocess,time
RELEASE='38ac6e2bff2a-20261003T042000Z';ROOT=pathlib.Path('/data/proofofwork-release-backups/audit30-node-release-'+RELEASE);TOOLS=pathlib.Path('/var/tmp/proofofwork-deploy/audit29-tools')
UNIT='proofofwork-audit29-verify-'+RELEASE+'-shadow-strict-v3.service';SHADOW='proofofwork-audit29-shadow-'+RELEASE+'-lease-v3.service';SHADOW_PID='';SHADOW_INV=''
E={'PATH':'/usr/bin:/bin','LC_ALL':'C','GIT_OPTIONAL_LOCKS':'0'}
PINS={'private-verify.py':'8a569828272b10abc8848dd01678a1a3b45002acd489802f89b6e056de3e0c1e','private-env.py':'99cbe9cd118c63b08480efd28c2ae7c059b5204daef8db08b896a38fc791d515','attest-node.py':'4bec20fa1e5931636e3bfc84f617f005a7b1b71e752dc7f7c9b8bea23014be38','install-ops.py':'f8dcc8489537a3ddefa392cb586857fdab88874e6b3c7a2f61a69ec45b0b7c25'}
LIVE={'bitcoind.service':('1324302','64e1fa7be2e2442d8c7f5763f60b85fb'),'electrs.service':('1324320','72418b1c7ab245e4a37685ed868a1084'),'postgresql@16-main.service':('1537429','e0bf545f0ad944e89fe1005577e61b9c'),'proofofwork-api.service':('2103747','208f8bcbecc54afbb7166754f12065c2'),'proofofwork-indexer-worker.service':('2103760','33b3ee25490749db89e0d55fd29d0afb')}
CAPTURE_PIN='62e8c972a492fd22ebfb90a64396bec1a38466279aadbeb9439dbbb879d1ef68';WHOLE=1320;OUTPUT_CAP=65536
PRIOR_DRIVER=pathlib.Path('/data/proofofwork-audit29-verify-output-'+RELEASE+'-shadow-strict-v2/attempt/receipt.json')
PRIOR_LAUNCH=pathlib.Path('/data/proofofwork-audit29-verify-launch-'+RELEASE+'-shadow-strict-v2')
OBSERVATION_PIN='38dc163338f1122ff458eecee2ed7169d5fd5e7945b4e8edf6a7856ee01a804c'
EXTRA_QUIET=['proofofwork-audit30-mail-api-baseline-20261003T050300Z.service','proofofwork-audit30-candidate-bond-pages-38ac-v2.service','proofofwork-audit30-candidate-full-ids-'+RELEASE+'-fence-diagnostic-v3.service']
def need(v,m):
 if not v:raise ValueError(m)
def stamp(s):return(s.st_dev,s.st_ino,s.st_mode,s.st_uid,s.st_gid,s.st_nlink,s.st_size,s.st_mtime_ns,s.st_ctime_ns)
def read(p,cap=2*1024**2,expected=None,owner=0,group=0):
 p=pathlib.Path(p);s=p.lstat();need(p.resolve()==p and stat.S_ISREG(s.st_mode)and s.st_uid==owner and s.st_gid==group and stat.S_IMODE(s.st_mode)==0o600 and s.st_nlink==1 and 0<s.st_size<=cap,'PRIVATE_SHAPE');fd=os.open(p,os.O_RDONLY|os.O_NOFOLLOW|os.O_NOATIME)
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
 rows={u:state(u)for u in LIVE};need(all(r['ActiveState']=='active'and(r['MainPID'],r['InvocationID'])==LIVE[u]for u,r in rows.items()),'LIVE_FIVE_CHANGED');return rows
def timer_shape():return{k:v for k,v in state('proofofwork-postgres-logical-backup.timer').items()if k in ['LoadState','ActiveState','SubState','UnitFileState']}
def bind_shadow(raw):
 p=json.loads(raw);need(p.get('schema')=='pow-audit30-node-readonly-shadow-prepared-v1'and p.get('ok')is True and p.get('unit')==SHADOW and type(p.get('mainPID'))is int and p['mainPID']>0 and re.fullmatch('[0-9a-f]{32}',str(p.get('invocationID','')))and p.get('liveServicesUnchanged')is True and p.get('productionDataMutation')is False and p.get('productionStop')is False and p.get('timerChanges')is False,'FRESH_SHADOW_PREPARED_BINDING');return str(p['mainPID']),p['invocationID']
def shadow_fit(seconds):
 s=state(SHADOW);need(s['ActiveState']=='active'and s['MainPID']==SHADOW_PID and s['InvocationID']==SHADOW_INV and s['RuntimeMaxUSec']=='45min','SHADOW_CHANGED');started=int(s['ExecMainStartTimestampMonotonic'])/1e6;now=time.monotonic();need(0<started<=now and 2700-(now-started)>=seconds,'SHADOW_LEASE_TOO_SHORT');return s

def record(kind,v):
 p=ROOT/('strict-native-v3-'+kind+'.json');fd=os.open(p,os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW,0o600)
 with os.fdopen(fd,'wb')as f:f.write((json.dumps(v,sort_keys=True)+'\n').encode());f.flush();os.fsync(f.fileno())
 fd=os.open(ROOT,os.O_RDONLY|os.O_DIRECTORY|os.O_NOFOLLOW)
 try:os.fsync(fd)
 finally:os.close(fd)
def owned(st,inv):
 command=st.get('ExecStart','')
 return st.get('LoadState')=='loaded'and st.get('InvocationID')==inv and st.get('User')==st.get('Group')=='root'and st.get('Restart')=='no'and str(TOOLS/'private-verify.py')in command and '--release-id '+RELEASE+' --capture-id 'in command and '--attempt strict-v3 --base-url http://127.0.0.1:18081'in command and st.get('KillMode')=='control-group'and st.get('RuntimeMaxUSec')=='20min'
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
def interrupted(s,f):raise RuntimeError('STRICT_NATIVE_SIGNAL')
def build_argv(capture):
 need(re.fullmatch('[0-9a-f]{12}-[0-9]{8}T[0-9]{6}Z',capture['captureId'])and capture['captureId'].startswith('38ac6e2bff2a-')and capture['apiEnvironSHA256']=='327427c12f187d5b200a9a2323025bd659688e72c3e10faac24545fc514fdb5c','CAPTURE_BINDING')
 args=['/usr/bin/python3','-I','-B',str(TOOLS/'private-verify.py'),'--private-env-sha256',PINS['private-env.py'],'verify','--mode','shadow','--release-id',RELEASE,'--capture-id',capture['captureId'],'--api-environ-sha256',capture['apiEnvironSHA256'],'--candidate-commit','38ac6e2bff2ac16890724e5213346ef8a3ebd186','--candidate-tree','8b9b5e3cd47aa8e4204da717350a629176e30da6','--runtime-sha256','13035b6d1fbca1be9c03b1833f3abe578d4ae28331a341b3dea4301cc72b535c','--script-sha256','bbded71fa88cfc108c611b3beddd3a6c693b38477c356b682caed8985976abda','--source-commit','d4d888757a1c44aab3b9690f79e1917935930f0f','--source-api-sha256','7b44409d1b12335119d157adafd1f6c67ab28950f495f01c50109963c9201b79','--attestor-sha256',PINS['attest-node.py'],'--ops-installer-sha256',PINS['install-ops.py'],'--attempt','strict-v3','--base-url','http://127.0.0.1:18081','--wallet-address','18hkqE81wQuq75UEBKhB4JjAuQg47jN7Aa']
 return ['/usr/bin/systemd-run','--quiet','--wait','--pipe','--unit='+UNIT,'--service-type=exec','--property=User=root','--property=Group=root','--property=RuntimeMaxSec=20min','--property=TimeoutStopSec=30s','--property=KillMode=control-group','--property=MemoryMax=4G','--property=MemorySwapMax=0','--property=CPUQuota=100%','--property=TasksMax=128','--property=UMask=0077','/usr/bin/env','-i','PATH=/usr/bin:/bin','LC_ALL=C',*args]
def checkpoint(v):
 need(type(v)is dict and type(v.get('height'))is int and 0<=v['height']<=9007199254740991 and re.fullmatch('[0-9a-f]{64}',str(v.get('hash',''))),'PRIOR_CHECKPOINT_SHAPE');return {'height':v['height'],'hash':v['hash']}
def prior_failed_evidence():
 # Fixed protected receipts only. Child stdout and private launcher environments are never exported.
 account=pwd.getpwnam('powadmin');need(account.pw_uid>0 and account.pw_gid>0,'PRIOR_DRIVER_OWNER');raw=read(PRIOR_DRIVER,4*1024**2,'0f77ed860b40e4762f4ad0962dbc66faded888d6db865bd44e542842eff5689c',owner=account.pw_uid,group=account.pw_gid);v=json.loads(raw)
 need(v.get('ok')is False and v.get('failure')=='STRICT_GATE_FAILED'and v.get('gates')=={'ids':True,'events':True,'parity':False},'PRIOR_FAILED_DRIVER_BINDING')
 before=checkpoint(v['checkpointBefore']);after=checkpoint(v['checkpointAfter']);need(before==after,'PRIOR_MOVING_CHECKPOINT')
 gates={}
 for name in ['ids','events','parity']:
  g=v['gateReceipts'][name];b=checkpoint(g['before']);a=checkpoint(g['after']);need(g.get('checkpointStable')is True and b==a==before and g['exitCode']==(1 if name=='parity'else 0),'PRIOR_GATE_BINDING')
  need(all(type(g[k])is int and 0<=g[k]<=128*1024**2 for k in ['stdoutBytes','stderrBytes'])and re.fullmatch('[0-9a-f]{64}',str(g.get('stdoutSha256','')))and re.fullmatch('[0-9a-f]{64}',str(g.get('scriptSha256',''))),'PRIOR_GATE_DIGEST')
  need(all(isinstance(g.get(k),str)and re.fullmatch('[0-9TZ:.+-]+',g[k])for k in ['startedAt','completedAt']),'PRIOR_GATE_DATE')
  public={k:g[k]for k in ['exitCode','stdoutBytes','stderrBytes','stdoutSha256','scriptSha256','startedAt','completedAt','checkpointStable']};public.update(before=b,after=a)
  if name=='ids':
   counts=g.get('counts');need(counts=={'Fetched transactions':587,'Confirmed winners':508,'Pending candidates':20,'Covered confirmed registry transactions':565,'Covered pending registry transactions':22},'PRIOR_ID_COUNTS');public['counts']=counts
  else:
   checks=g.get('checks');need(type(checks)is list and len(checks)==g.get('checkCount')==(102 if name=='parity'else 49),'PRIOR_CHECK_COUNT')
   need(all(type(c)is dict and re.fullmatch('[a-z0-9-]{1,128}',str(c.get('name','')))and type(c.get('ok'))is bool and c.get('severity')in ['error','warning']for c in checks),'PRIOR_CHECK_SHAPE')
   failed=[{'name':c['name'],'ok':False,'severity':c['severity']}for c in checks if c['ok']is False]
   expected=[{'name':'work-token-state-current-relational','ok':False,'severity':'error'},{'name':'work-amo-v5-migration','ok':False,'severity':'warning'},{'name':'work-amo-v5-usd-quote-head','ok':False,'severity':'warning'}]if name=='parity'else[]
   need(sorted(failed,key=lambda c:c['name'])==sorted(expected,key=lambda c:c['name']),'PRIOR_FAILED_CHECKS');public.update(checkCount=len(checks),failedChecks=failed)
  gates[name]=public
 final_raw=read(PRIOR_LAUNCH/'launcher-final.json',expected='e6d1c1cc45880ee6f086f2919f1292f77b8dda2277d7d2886e501700711cfdef');final=json.loads(final_raw);need(final.get('ok')is False and final.get('errorClass')=='RuntimeError','PRIOR_LAUNCHER_BINDING')
 failed_raw=read(ROOT/'strict-native-v2-failed.json',expected='34be3fcd5727cca1a8c7aa97167e036b8fba84371d632368d8403e024b0d9c6e');failed=json.loads(failed_raw);need(failed.get('timerRestored')is True and failed.get('cleanupErrors')==[] and failed.get('automaticRetry')is False,'PRIOR_CLEANUP_BINDING')
 restores=list(PRIOR_LAUNCH.glob('backup-window-*.restored.json'));need(len(restores)==1,'PRIOR_TIMER_RECEIPT_COUNT');restore_raw=read(restores[0],65536,'7f9dc2e814ac2d8b016816be71a83e71dac1c1adaa809e63943903eb8b44b308');restore=json.loads(restore_raw);need(restore.get('restored')is True and restore.get('before')==restore.get('after'),'PRIOR_TIMER_RESTORATION')
 prior_unit='proofofwork-audit29-verify-'+RELEASE+'-shadow-strict-v2.service';st=state(prior_unit);need(st.get('MainPID')=='0'and st.get('InvocationID')=='3fe0b89885a64594a3feaaca0a8a1219'and st.get('ActiveState')=='failed','PRIOR_STRICT_NOT_STOPPED')
 return dict(schema='audit30-strict-v2-bounded-failure-evidence-v1',driverReceiptPath=str(PRIOR_DRIVER),driverReceiptSHA256=hashlib.sha256(raw).hexdigest(),ok=False,failure='STRICT_GATE_FAILED',gates={'ids':True,'events':True,'parity':False},gateReceipts=gates,checkpointBefore=before,checkpointAfter=after,launcherFinalSHA256=hashlib.sha256(final_raw).hexdigest(),nativeFailureSHA256=hashlib.sha256(failed_raw).hexdigest(),timerRestoredReceiptPath=str(restores[0]),timerRestoredReceiptSHA256=hashlib.sha256(restore_raw).hexdigest(),timerRestored=True,unitStopped=True,privateContentsExported=False,rawChildOutputExported=False)
def bind_readonly_observation(raw):
 need(hashlib.sha256(raw).hexdigest()==OBSERVATION_PIN,'READONLY_OBSERVATION_PIN');v=json.loads(raw);r=v.get('result',{});work=r.get('work',{});summary=r.get('summary',{});ready=r.get('readiness',{})
 need(v.get('schema')=='audit30-strict-v2-narrow-work-predicate-read-v1'and v.get('actualApiIdentityUnchanged')is True and v.get('productionMutation')is False and v.get('sourceReaderSHA256')=='9278b81473c23a2c9d06c6b1306268c360539f833cdd7967b73fd99a35275b87','READONLY_OBSERVATION_BINDING')
 need(r.get('sqlReadOnly')=={'default_read_only':'on','read_only':'on'}and r.get('directDatabaseWrites')is False and r.get('apiRequests')==r.get('coreRequests')==0 and r.get('readinessReturned')is True and all(ready.get(k)is True for k in ['ready','active','evidenceComplete','parityReady','pendingReady','replayReady'])and ready.get('pendingReadinessDiagnostics',{}).get('failedCategories')==[],'READONLY_OBSERVATION_READINESS')
 need(work.get('returned')is True and work.get('source')=='proof-indexer-token-state-tables'and type(work.get('tokens'))is int and work['tokens']>0 and type(work.get('indexedThroughBlock'))is int and work['indexedThroughBlock']>=summary.get('indexedThroughBlock',9007199254740991),'READONLY_OBSERVATION_WORK_PREDICATE')
 return dict(sha256=OBSERVATION_PIN,sourceReaderSHA256=v['sourceReaderSHA256'],observedWorkPredicateSatisfied=True,observedReadinessAllTrue=True,checkpoint={'height':work['indexedThroughBlock'],'hash':work['indexedThroughBlockHash']},pendingValidThrough=ready['pendingValidThrough'],qualification='preceding-read-only-observation-only; this-attempt-must-pass-all-original-strict-gates')
def main(capture_source,readonly_observation):
 global SHADOW_PID,SHADOW_INV
 need(os.getuid()==os.geteuid()==os.getgid()==os.getegid()==0,'ROOT');os.umask(0o077);start=time.monotonic();deadline=start+WHOLE
 s=ROOT.lstat();need(ROOT.resolve()==ROOT and stat.S_ISDIR(s.st_mode)and s.st_uid==s.st_gid==0 and stat.S_IMODE(s.st_mode)==0o700,'ROOT_DIR')
 prior_failure=prior_failed_evidence();observation=bind_readonly_observation(readonly_observation)
 for suffix in ['intent','completed','failed']:need(not os.path.lexists(ROOT/('strict-native-v3-'+suffix+'.json')),'EVIDENCE_EXISTS')
 for prefix in ['proofofwork-audit29-verify-launch-','proofofwork-audit29-verify-output-']:need(not os.path.lexists('/data/'+prefix+RELEASE+'-shadow-strict-v3'),'VERIFY_PATH_EXISTS')
 SHADOW_PID,SHADOW_INV=bind_shadow(read(ROOT/'shadow-lease-v3-prepared.json',65536))
 need(state(UNIT)['LoadState']=='not-found','STRICT_UNIT_EXISTS');before=live();shadow_fit(WHOLE+30);backup=state('proofofwork-postgres-logical-backup.service');need(backup['ActiveState']=='inactive'and backup['MainPID']=='0'and backup['Result']=='success','BACKUP_ACTIVE');timer=timer_shape()
 for unit in EXTRA_QUIET:need(state(unit).get('MainPID','0')=='0'and state(unit).get('ActiveState')in ['inactive','failed'],'AUDIT_LANE_BUSY')
 for name,pin in PINS.items():read(TOOLS/name,expected=pin)
 read(ROOT/'candidate.tsv',65536,'98343f1ecff80e2b203355a2272df966cc108b0a89890c9d3fabfd5b0b8e084d');read(ROOT/'old-live.tsv',65536,'ecb2f2b7dde7253af35252109aab003666dca54b51ff6c81f719315fb2dc6bf6')
 need(hashlib.sha256(capture_source).hexdigest()==CAPTURE_PIN,'CAPTURE_SOURCE_PIN');n={'__name__':'_frozen_fresh_capture','__file__':'reviewed-fresh-capture.py'};exec(compile(capture_source,n['__file__'],'exec'),n)
 buf=io.StringIO()
 with contextlib.redirect_stdout(buf):n['main']()
 capture=json.loads(buf.getvalue());need(capture['liveFiveUnchanged']is True and capture['privateContentsExported']is False,'CAPTURE_REFUSED');at=datetime.datetime.fromisoformat(capture['capturedAt']);need(0<=(datetime.datetime.now(datetime.timezone.utc)-at).total_seconds()<=120,'CAPTURE_AGE');before_after_capture=live();need(before_after_capture==before,'CAPTURE_LIVE_DRIFT');shadow_fit(WHOLE-(time.monotonic()-start)+30)
 argv=build_argv(capture);record('intent',dict(schema='pow-audit30-strict-native-intent-v1',unit=UNIT,capture=capture,argv=argv,priorFailedAttempt=prior_failure,precedingReadOnlyObservation=observation,innerDriverNormalSeconds=1050,innerDriverHardSeconds=1140,innerMaximumChildSeconds=900,managedUnitMaximumSeconds=1200,wholeSupervisorSeconds=WHOLE,productionStop=False,directDatabaseWrites=False))
 p=None;inv='';clean=[];signal.signal(signal.SIGTERM,interrupted);signal.signal(signal.SIGINT,interrupted)
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
  need(p.returncode==0 and not stderr,'STRICT_DRIVER_REFUSED');root=pathlib.Path('/data/proofofwork-audit29-verify-launch-'+RELEASE+'-shadow-strict-v3');accepted=read(root/'accepted-receipt.json',4*1024**2);r=json.loads(accepted);need(r['ok']is True and r['mode']=='shadow'and r['candidate']==dict(commit='38ac6e2bff2ac16890724e5213346ef8a3ebd186',tree='8b9b5e3cd47aa8e4204da717350a629176e30da6',runtimeSha256='13035b6d1fbca1be9c03b1833f3abe578d4ae28331a341b3dea4301cc72b535c'),'ACCEPTED_BINDING');need(r.get('base')==r.get('authority')=='http://127.0.0.1:18081'and r.get('network')=='livenet'and all(r.get('gates',{}).get(k)is True for k in ['ids','events','parity']),'STRICT_GATES');fence=r.get('stableCheckpoint',{});need(type(fence.get('height'))is int and 0<=fence['height']<=9007199254740991 and re.fullmatch('[0-9a-f]{64}',str(fence.get('hash',''))),'STRICT_FENCE');launcher=r.get('privateLauncher',{});need(launcher.get('unit')==UNIT and launcher.get('captureId')==capture['captureId']and launcher.get('captureApiSha256')==capture['apiEnvironSHA256']and launcher.get('scriptSha256')=='bbded71fa88cfc108c611b3beddd3a6c693b38477c356b682caed8985976abda','STRICT_LAUNCHER_BINDING')
  finals=json.loads(read(root/'launcher-final.json'));need(finals['ok']is True and finals['errorClass']is None,'LAUNCHER_NOT_ACCEPTED');files=list(root.glob('backup-window-*.restored.json'));need(len(files)==1,'TIMER_RESTORED_EVIDENCE');restored_raw=read(files[0],65536);restored=json.loads(restored_raw);need(restored['restored']is True and restored['before']==restored['after'],'TIMER_NOT_RESTORED');need(live()==before and timer_shape()==timer,'LIVE_OR_TIMER_CHANGED');shadow_fit(1)
  report=dict(schema='pow-audit30-strict-native-completed-v1',atUtc=datetime.datetime.now(datetime.timezone.utc).isoformat(),unit=UNIT,invocationID=inv,priorFailedAttempt=prior_failure,precedingReadOnlyObservation=observation,returncode=p.returncode,stopped=True,capture=capture,acceptedReceiptPath=str(root/'accepted-receipt.json'),acceptedReceiptSHA256=hashlib.sha256(accepted).hexdigest(),timerRestoredReceiptSHA256=hashlib.sha256(restored_raw).hexdigest(),timerRestored=True,liveFiveUnchanged=True,shadowUnchanged=True,stdoutBytes=len(stdout),stdoutSHA256=hashlib.sha256(stdout).hexdigest(),stderrBytes=len(stderr),stderrSHA256=hashlib.sha256(stderr).hexdigest(),seconds=round(time.monotonic()-start,3),productionStop=False,directDatabaseWrites=False);record('completed',report);return report
 except BaseException as error:
  signal.signal(signal.SIGTERM,signal.SIG_IGN);signal.signal(signal.SIGINT,signal.SIG_IGN)
  clean=cleanup_owned_transport(p,inv)
  observed_timer=None;timer_observation_error=None
  try:observed_timer=timer_shape()
  except BaseException as c:timer_observation_error=type(c).__name__
  record('failed',dict(timerBefore=timer,timerAfterFailure=observed_timer,timerRestored=observed_timer==timer,timerObservationErrorClass=timer_observation_error,schema='pow-audit30-strict-native-failed-v1',unit=UNIT,invocationID=inv,priorFailedAttempt=prior_failure,precedingReadOnlyObservation=observation,errorClass=type(error).__name__,cleanupErrors=clean,automaticRetry=False,productionStop=False,directDatabaseWrites=False));raise
 finally:
  if p is not None:
   if p.stdout is not None:p.stdout.close()
   if p.stderr is not None:p.stderr.close()
