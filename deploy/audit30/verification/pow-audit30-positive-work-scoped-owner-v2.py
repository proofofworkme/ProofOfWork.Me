#!/usr/bin/python3 -I -B
"""Local preparation; Root alone launches a uniquely owned bounded native checker.

Reuse reviewed 4eed production-supervisor custody and installed 8a569/99cbe
read-only environment/child helpers. No service deployment, data write, signing
or broadcast. Exact existing backup window restores the original timer.
"""
import base64,datetime,hashlib,json,os,pathlib,pwd,re,signal,stat,subprocess,sys,time
SUPERVISOR_SHA='24136b6787754a2f9958b2a48ede208fcf8c9b546dbef7a4fb9be2033f8df1a9'
LEAF_SHA='ba9d8f33b315e297dcf9239dffe943de275cc3dc2c2de67b5ae58ad02b14c18c'
RELEASE='38ac6e2bff2a-20261003T042000Z'
WHOLE=780
def need(value,code):
 if not value:raise ValueError(code)
def sha(raw):return hashlib.sha256(raw).hexdigest()
def bound(value):
 need(type(value)is dict and set(value)=={'path','sha256'}and re.fullmatch('[0-9a-f]{64}',str(value['sha256'])),'RECEIPT_BINDING');return value
def parse_request(value):
 need(type(value)is dict and set(value)=={'schema','mode','binding','supervisorBase64','leafBase64'}and value['schema']=='pow-audit30-positive-scoped-owner-request-v1'and value['mode']in ['shadow','production'],'REQUEST_SCOPE')
 source=base64.b64decode(value['supervisorBase64'],validate=True);leaf=base64.b64decode(value['leafBase64'],validate=True)
 need(len(source)<=65536 and sha(source)==SUPERVISOR_SHA and len(leaf)==37077 and sha(leaf)==LEAF_SHA,'REVIEWED_SOURCES_REQUIRED')
 b=value['binding'];need(type(b)is dict and set(b)==({'lease','strictAccepted'}if value['mode']=='shadow'else{'cutover'}),'MODE_BINDING')
 for row in b.values():bound(row)
 return source,leaf
def load(source):
 n={'__name__':'_reviewed_positive_scoped_custody','__file__':'/reviewed/postcutover-production-strict-v2.py'};exec(compile(source,n['__file__'],'exec'),n);return n
def validate_shadow(F,binding,seconds):
 expected=str(F['ROOT']/'shadow-lease-v3-prepared.json');need(binding['lease']['path']==expected,'LEASE_PATH')
 raw=F['read'](expected,65536,binding['lease']['sha256']);receipt=json.loads(raw)
 unit='proofofwork-audit29-shadow-'+RELEASE+'-lease-v3.service';row=F['state'](unit)
 need(receipt.get('schema')=='pow-audit30-node-readonly-shadow-prepared-v1'and receipt.get('ok')is True and receipt.get('unit')==unit and receipt.get('health',{}).get('ready')is True and receipt.get('liveServicesUnchanged')is True,'LEASE_RECEIPT')
 need(row.get('ActiveState')=='active'and row.get('SubState')=='running'and row.get('MainPID')==str(receipt['mainPID'])and row.get('InvocationID')==receipt['invocationID']and row.get('RuntimeMaxUSec')=='45min','SHADOW_CHANGED')
 started=int(row['ExecMainStartTimestampMonotonic'])/1e6;now=time.monotonic();need(0<started<=now and 2700-(now-started)>=seconds,'SHADOW_LEASE_TOO_SHORT')
 a=binding['strictAccepted'];need(a['path']=='/data/proofofwork-audit29-verify-launch-'+RELEASE+'-shadow-strict-v3/accepted-receipt.json','STRICT_ACCEPTED_PATH')
 accepted=json.loads(F['read'](a['path'],4*1024**2,a['sha256']))
 need(accepted.get('ok')is True and accepted.get('mode')=='shadow'and accepted.get('network')=='livenet'and accepted.get('base')==accepted.get('authority')=='http://127.0.0.1:18081'and accepted.get('candidate')==F['CANDIDATE']and all(accepted.get('gates',{}).get(k)is True for k in ['ids','events','parity']),'FRESH_STRICT_ACCEPTANCE')
 need(accepted.get('privateLauncher',{}).get('unit')=='proofofwork-audit29-verify-'+RELEASE+'-shadow-strict-v3.service'and accepted['privateLauncher'].get('scriptSha256')==F['DRIVER_SHA'],'STRICT_DRIVER_BINDING')
 fence=accepted.get('stableCheckpoint',{});need(type(fence.get('height'))is int and fence['height']>0 and re.fullmatch('[0-9a-f]{64}',str(fence.get('hash',''))),'STRICT_FENCE')
 at=datetime.datetime.fromisoformat(accepted['completedAt'].replace('Z','+00:00'));need(at.tzinfo is not None and 0<=(datetime.datetime.now(datetime.timezone.utc)-at).total_seconds()<=1800,'STRICT_AGE')
 return row
def validate_native(F,unit):
 row=F['state'](unit);need(row.get('ActiveState')=='active'and row.get('MainPID')==str(os.getpid())and row.get('User')==row.get('Group')=='root'and row.get('RuntimeMaxUSec')=='15min'and row.get('KillMode')=='control-group'and row.get('Restart')=='no'and re.fullmatch('[0-9a-f]{32}',row.get('InvocationID','')),'OWNED_CONTROLLER_REQUIRED')
 need(pathlib.Path('/proc/self/cgroup').read_text().strip()=='0::/system.slice/'+unit,'OWNED_CONTROLLER_CGROUP')
 p=subprocess.run(['/usr/bin/systemctl','show',unit,'--property=MemoryMax,MemorySwapMax,CPUQuotaPerSecUSec,TasksMax,TimeoutStopUSec,UMask'],env=F['E'],capture_output=True,timeout=10)
 need(p.returncode==0 and not p.stderr and len(p.stdout)<=4096,'CONTROLLER_RESOURCE_PROBE');properties=dict(x.split('=',1)for x in p.stdout.decode().splitlines()if '='in x)
 need(properties=={'MemoryMax':str(4*1024**3),'MemorySwapMax':'0','CPUQuotaPerSecUSec':'1s','TasksMax':'128','TimeoutStopUSec':'30s','UMask':'0077'},'CONTROLLER_RESOURCE_BOUNDS');return row
def save(helper,directory,name,value):
 helper['exclusive_write'](str(directory/name),(json.dumps(value,sort_keys=True)+'\n').encode());helper['fsync_dir'](str(directory))
def validate_leaf_result(report,mode,F):
 need(report.get('schema')=='pow-audit30-positive-work-complete-scoped-listings-v1'and report.get('ok')is True and report.get('candidate')==F['CANDIDATE']and report.get('mode')==mode and report.get('network')=='livenet'and report.get('productionMutation')is False and report.get('timerChanges')is False and report.get('privateContentsExported')is False,'LEAF_RESULT_BINDING')
 need(report.get('base')==('http://127.0.0.1:18081'if mode=='shadow'else F['BASE'])and report.get('authority')==('http://127.0.0.1:18081'if mode=='shadow'else F['AUTHORITY']),'LEAF_ORIGIN_BINDING')
 wallets=report.get('positiveWork',[]);need(len(wallets)==2 and all(w.get('status')==200 and all(w.get(k)is True for k in ['ready','balanceVerified','capacityVerified','positiveConfirmed'])and w.get('predicateCount')==16 and len(w.get('predicates',{}))==16 and all(v is True for v in w['predicates'].values())and re.fullmatch('[1-9][0-9]*',str(w.get('confirmedBalanceSubatoms','')))for w in wallets),'ALL_POSITIVE_Q16_REQUIRED')
 scopes=report.get('scopedListings',[]);need(len(scopes)==2 and {s.get('symbol')for s in scopes}=={'POWB','INCB'}and all(s.get('complete')is True and s.get('ready')is True and type(s.get('totalCount'))is int and s['totalCount']>=0 and s.get('pages')and s['pages'][-1].get('complete')is True and s['pages'][-1].get('verifiedThrough')==s['totalCount']for s in scopes),'ALL_COMPLETE_SCOPES_REQUIRED')
def main(value):
 need(os.getuid()==os.geteuid()==os.getgid()==os.getegid()==0 and sys.flags.isolated and os.uname().nodename=='pow-bitcoin-01','NATIVE_ROOT_REQUIRED');os.umask(0o077)
 source,leaf=parse_request(value);F=load(source);mode=value['mode'];binding=value['binding'];start=time.monotonic();deadline=start+WHOLE
 unit='proofofwork-audit30-positive-scoped-'+RELEASE+'-'+mode+('-v1.service'if mode=='shadow'else'-v2.service');controller=validate_native(F,unit)
 root='/opt/proofofwork-api-stage-'+RELEASE if mode=='shadow'else'/opt/proofofwork-api';authority='http://127.0.0.1:18081'if mode=='shadow'else F['AUTHORITY']
 token=RELEASE+'-'+mode+('-v1'if mode=='shadow'else'-v2');evidence=pathlib.Path('/data/proofofwork-audit30-positive-scoped-'+token);code=pathlib.Path('/data/proofofwork-audit30-positive-scoped-source-'+token);output=pathlib.Path('/data/proofofwork-audit30-positive-scoped-output-'+token)
 need(all(not os.path.lexists(path)for path in [evidence,code,output]),'NAMESPACE_EXISTS')
 before=F['live']();timer=F['timer_shape']();shadow=None
 if mode=='shadow':shadow=validate_shadow(F,binding,WHOLE)
 else:F['validate_cutover'](binding['cutover'],json.loads(F['read'](binding['cutover']['path'],65536,binding['cutover']['sha256'])))
 quiet=[u for u in F['EXTRA_QUIET']if not(mode=='shadow'and u=='proofofwork-audit29-shadow-'+RELEASE+'-lease-v3.service')]+[F['UNIT']]
 if mode=='production':
  attempt=pathlib.Path(binding['cutover']['path']).parent.name.removeprefix('proofofwork-audit29-cutover-'+RELEASE+'-');quiet.append('proofofwork-audit29-release-'+RELEASE+'-node-'+attempt+'.service')
 for u in quiet:need(F['quiet'](F['state'](u)),'AUDIT_LANE_BUSY')
 for name,pin in F['PINS'].items():F['read'](F['TOOLS']/name,expected=pin)
 V={'__name__':'_installed_readonly_leaf_child','__file__':str(F['TOOLS']/'private-verify.py')};exec(compile(F['read'](F['TOOLS']/'private-verify.py',expected=F['PINS']['private-verify.py']),V['__file__'],'exec'),V)
 helper=V['imported'](F['TOOLS']/'private-env.py',F['PINS']['private-env.py']);ops=V['imported'](F['TOOLS']/'install-ops.py',F['PINS']['install-ops.py'])
 account=pwd.getpwnam('powadmin');need(account.pw_uid>0 and account.pw_gid>0,'ACCOUNT_REQUIRED')
 expected=F['read'](F['ROOT']/'candidate.tsv',65536,'98343f1ecff80e2b203355a2272df966cc108b0a89890c9d3fabfd5b0b8e084d')
 need(V['checked'](['/usr/bin/python3','-I','-B',str(F['TOOLS']/'attest-node.py'),root],180).encode()+b'\n'==expected,'CANDIDATE_ATTESTATION')
 capacity=os.statvfs('/data');need(capacity.f_bavail*capacity.f_frsize>=1024**3+16*1024**2 and capacity.f_favail>=128,'EVIDENCE_CAPACITY')
 capture=F['fresh_capture'](helper,before);directory=pathlib.Path(capture['directory']);blob=F['read'](directory/'api.environ',2*1024**2,capture['apiEnvironSHA256']);env=V['readonly_plan'](helper,helper['parse_env'](blob),RELEASE,pathlib.Path(root),authority)
 need(time.monotonic()<deadline-540,'FULL_CHILD_AND_RESTORE_RESERVE_REQUIRED')
 evidence.mkdir(mode=0o700);code.mkdir(mode=0o755);os.chmod(code,0o755);output.mkdir(mode=0o700);os.chown(output,account.pw_uid,account.pw_gid)
 helper['exclusive_write'](str(code/'leaf.mjs'),leaf);os.chmod(code/'leaf.mjs',0o644);helper['fsync_dir'](str(code));helper['fsync_dir']('/data')
 report=dict(schema='pow-audit30-positive-scoped-owner-completed-v1',ok=False,mode=mode,unit=unit,invocationID=controller['InvocationID'],binding=binding,capture=capture,leafSourceSHA256=LEAF_SHA,custodySupervisorSHA256=SUPERVISOR_SHA,productionMutation=False,privateContentsExported=False,automaticRetry=False)
 save(helper,evidence,'intent.json',report);old={s:signal.getsignal(s)for s in [signal.SIGTERM,signal.SIGINT,signal.SIGHUP,signal.SIGALRM]}
 def interrupted(*_):raise RuntimeError('OWNED_COLLECTOR_SIGNAL_OR_DEADLINE')
 for s in old:signal.signal(s,interrupted)
 signal.setitimer(signal.ITIMER_REAL,max(.001,deadline-time.monotonic()));error=None;child=None;accepted=None;restored_sha=None
 try:
  with V['operations_lock'](),ops['backup_install_window'](evidence):
   need(F['live']()==before and F['timer_shape']().get('ActiveState')=='inactive','ADMISSION_LIVE_OR_BACKUP_WINDOW_CHANGED')
   if mode=='shadow':need(validate_shadow(F,binding,deadline-time.monotonic())==shadow,'SHADOW_CHANGED')
   at=datetime.datetime.fromisoformat(capture['capturedAt']);need(0<=(datetime.datetime.now(datetime.timezone.utc)-at).total_seconds()<=120,'FRESH_CAPTURE_AT_CHILD_REQUIRED')
   need(all(helper['proc_identity'](kind,account)==identity for kind,identity in capture['processes'].items()),'PROCESS_DRIFT_BEFORE_CHILD')
   V['read'](code/'leaf.mjs',expected=LEAF_SHA,mode=0o644)
   child=V['stream_child'](['/usr/bin/nice','-n','10',V['runtime_binary']()['path'],'--max-old-space-size=1024',str(code/'leaf.mjs'),'--mode',mode,'--output',str(output/'receipt.json')],pathlib.Path(root),env,account,330)
   save(helper,evidence,'child-result.json',child);need(child['exitCode']==0,'LEAF_REFUSED')
   accepted=V['read'](output/'receipt.json',account.pw_uid,mode=0o600,group=account.pw_gid);validate_leaf_result(json.loads(accepted),mode,F)
   need(all(helper['proc_identity'](kind,account)==identity for kind,identity in capture['processes'].items())and F['live']()==before,'PROCESS_DRIFT_AFTER_CHILD')
   remaining=deadline-time.monotonic();need(remaining>45,'RESTORE_RESERVE_REQUIRED')
   need(V['checked'](['/usr/bin/python3','-I','-B',str(F['TOOLS']/'attest-node.py'),root],min(180,remaining-45)).encode()+b'\n'==expected,'FINAL_CANDIDATE_ATTESTATION')
   V['read'](code/'leaf.mjs',expected=LEAF_SHA,mode=0o644)
  restore=list(evidence.glob('backup-window-*.restored.json'));need(len(restore)==1,'RESTORED_RECEIPT_REQUIRED');raw=F['read'](restore[0],65536);row=json.loads(raw);need(row.get('restored')is True and row.get('before')==row.get('after')and F['timer_shape']()==timer,'ORIGINAL_TIMER_RESTORED')
  restored_sha=sha(raw);need(F['live']()==before,'FINAL_LIVE_DRIFT');validate_native(F,unit)
  if mode=='shadow':need(validate_shadow(F,binding,1)==shadow,'FINAL_SHADOW_DRIFT')
  for row in binding.values():F['read'](row['path'],4*1024**2,row['sha256'])
  report.update(ok=True,receiptPath=str(output/'receipt.json'),receiptSHA256=sha(accepted),timerRestoredReceiptSHA256=restored_sha,timerRestored=True,liveFiveUnchanged=True,shadowUnchanged=True if mode=='shadow'else None,childResult=child)
 except BaseException as caught:
  error=type(caught).__name__;report.update(errorClass=error,childResult=child)
  if isinstance(caught,V['ChildFailure']):report['childResult']=caught.result
 finally:
  signal.setitimer(signal.ITIMER_REAL,0)
  for s,handler in old.items():signal.signal(s,handler)
  try:observed=F['timer_shape']();report.update(timerAfter=observed,timerRestored=observed==timer)
  except BaseException as caught:report['timerObservationErrorClass']=type(caught).__name__
  report.update(atUtc=datetime.datetime.now(datetime.timezone.utc).isoformat(),seconds=round(time.monotonic()-start,3),timerBefore=timer,automaticRetry=False)
  save(helper,evidence,'completed.json'if report['ok']else'failed.json',report)
 need(report['ok'],'OWNER_REFUSED');return report

if __name__=='__main__':
 need(len(sys.argv)==2 and re.fullmatch('[0-9a-f]{64}',sys.argv[1]),'REQUEST_HASH_ARGV');raw=sys.stdin.buffer.read(131073);need(len(raw)<=131072 and sha(raw)==sys.argv[1],'RAW_REQUEST_SHA');print(json.dumps(main(json.loads(raw)),sort_keys=True))
