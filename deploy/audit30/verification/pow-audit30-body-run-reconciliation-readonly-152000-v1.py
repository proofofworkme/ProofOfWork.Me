#!/usr/bin/python3 -I -B
"""Fixed152000 public receipts and inert package fences only. No retry/start/stop/SQL/Core."""
import ast,base64,datetime,hashlib,json,os,re,resource,signal,stat,subprocess,sys,types
from pathlib import Path
RUN='20261003T152000Z';REQUEST_SHA='f97ce8dbd4cdc00ad4f591a02aee4ec99478cb2e4fb9e96742d43802e5a95b31';ROOT_SHA='b989a3f2395e7cbf13cb2d3dbd2d258a3fd21867131e41644c094772aba11168'
PACKAGE=Path('/usr/local/lib/proofofwork-audit30-production-sixteen')/RUN
EVIDENCE=Path('/data/proofofwork-release-backups')/('audit30-mail-body-production-'+RUN+'-apply')
UNIT='proofofwork-audit30-production-sixteen-'+RUN+'-apply.service'
FIVE={'bitcoind.service':('1324302','64e1fa7be2e2442d8c7f5763f60b85fb'),'electrs.service':('1324320','72418b1c7ab245e4a37685ed868a1084'),'postgresql@16-main.service':('1537429','e0bf545f0ad944e89fe1005577e61b9c'),'proofofwork-api.service':('2103747','208f8bcbecc54afbb7166754f12065c2'),'proofofwork-indexer-worker.service':('2103760','33b3ee25490749db89e0d55fd29d0afb')}
ENV={'PATH':'/usr/sbin:/usr/bin:/sbin:/bin','LC_ALL':'C','TZ':'UTC'}
TIMER='proofofwork-postgres-logical-backup.timer'
TIMER_FIELDS=('LoadState','ActiveState','SubState','InvocationID','UnitFileState','NextElapseUSecRealtime')
FIELDS=('LoadState','ActiveState','SubState','MainPID','InvocationID','ControlGroup','Result','ExecMainStatus','User','Group','Type','Transient')
ROOT_FILES=('prepared.json','prepared-request.json','root-intent.json','root-worker-before.json','root-native-capture.json','root-native-capture.json.stderr','root-native-capture.json.failed.json','root-failed.json','root-completed.json')
NATIVE_FILES=('intent.json','commit-intent.json','completed.json','failed.json')
PUBLIC_TEXT={'schema','status','operation','environment','errorClass','firstErrorClass','code','errorCode','phase','commitOutcome'}
PUBLIC_BOOL={'productionUnitLaunched','productionMutation','productionDataMutation','productionCommitOutcomeMustBeReconciled','productionCommitOutcomeRequiresReceiptReconciliation','privateDetailsSuppressed','automaticRetry','automaticInverse','commitAcknowledged','bodyOnly','allTransactionNonbodyAndNontargetRowsUnchanged','operationalEpochRewind','queueFlushedBeforeCommit','unknownCommitRequiresExplicitReconciliation','rollbackAcknowledged','liveFiveUnchanged','sourceApprovalProofsUnchanged','strictRerunStillRequired','ok','liveServicesUnchanged','unitStoppedAtEndpoint','rootWaitSucceeded','rootPostCoreWorkerObservationStillRequired'}
PUBLIC_HASH={'pgEntrySHA256','generatedWriterSHA256','approvalSHA256','approvalReceiptSHA256','humanApprovalSHA256','rootControlSHA256','workerBeforeSHA256','workerBeforeReceiptSHA256','acknowledgedReceiptSHA256','manifestSHA256','admissionSHA256','originalPlanSHA256','engineSHA256','firstReasonSha256'}
class Interrupted(RuntimeError):pass
def need(v,c):
 if not v:raise ValueError(c)
def sha(b):return hashlib.sha256(b).hexdigest()
def safe(v):
 need(isinstance(v,dict),'PUBLIC_OBJECT');o={}
 for k in PUBLIC_TEXT&v.keys():need(isinstance(v[k],str)and re.fullmatch('[A-Za-z0-9:_-]{1,160}',v[k]),'PUBLIC_ENUM');o[k]=v[k]
 for k in PUBLIC_BOOL&v.keys():need(type(v[k])is bool,'PUBLIC_BOOL');o[k]=v[k]
 for k in PUBLIC_HASH&v.keys():need(isinstance(v[k],str)and re.fullmatch('[0-9a-f]{64}',v[k]),'PUBLIC_HASH');o[k]=v[k]
 for k in {'targetCount','wholeMilliseconds','systemdWaitExitCode','readinessInvalidationPerCommittedTransaction'}&v.keys():need(type(v[k])is int and 0<=v[k]<=10**12,'PUBLIC_COUNT');o[k]=v[k]
 return o

def load(raw):
 need(len(raw)<=196608 and sha(raw)==REQUEST_SHA,'EXACT_FAILED_RUN_ENVELOPE');e=json.loads(raw);need(set(e)=={'schema','rootControlBase64','request'}and e['schema']=='pow-audit30-production-sixteen-root-envelope-v1','EXACT_ENVELOPE');source=base64.b64decode(e['rootControlBase64'],validate=True);need(len(source)<=49152 and sha(source)==ROOT_SHA,'EXACT_ROOT_SOURCE');R=types.ModuleType('inert_approved_root');R.__file__='/reviewed/root.py';exec(compile(source,R.__file__,'exec'),R.__dict__);v=e['request'];helper,guard,_=R.decode(v);need(v['mode']=='run'and v['operation']=='apply'and v['runId']==RUN,'EXACT_FAILED_RUN');R.ROOT_SOURCE_SHA256=ROOT_SHA
 blocked=lambda *_a,**_k:(_ for _ in()).throw(RuntimeError('FORBIDDEN_ENTRY'))
 for n in('main','acquire_ops','dependency_copy','generated'):setattr(R,n,blocked)
 codes={n.args[1].value for n in ast.walk(ast.parse(source))if isinstance(n,ast.Call)and isinstance(n.func,ast.Name)and n.func.id=='need'and len(n.args)>1 and isinstance(n.args[1],ast.Constant)and isinstance(n.args[1].value,str)}
 return R,v,codes

def receipt(R,p,uid,gid,mode,cap,parse=True):
 if not os.path.lexists(p):return {'exists':False},None
 b,m=R.immutable(p,cap,uid,gid,mode);out={'exists':True,'metadata':m,'sha256':sha(b)};v=None
 if parse and len(b)<=65536 and b:
  try:v=R.json_read(b)
  except(ValueError,UnicodeError):out['closedJSON']=False
  else:out['closedJSON']=True;out['publicFields']=safe(v)
 return out,v

def directory(R,p,uid,gid,mode):
 if not os.path.lexists(p):return {'exists':False}
 s=p.lstat();need(p.resolve(strict=True)==p and stat.S_ISDIR(s.st_mode)and(s.st_uid,s.st_gid,stat.S_IMODE(s.st_mode))==(uid,gid,mode)and not os.listxattr(p,follow_symlinks=False),'FIXED_DIRECTORY');return {'exists':True,'metadata':R.smeta(s)}
def unit(name):
 fields=TIMER_FIELDS if name==TIMER else FIELDS
 p=None
 try:
  p=subprocess.Popen(['/usr/bin/systemctl','show',name,*['--property='+x for x in fields]],stdin=0,stdout=subprocess.PIPE,stderr=subprocess.PIPE,env=ENV,start_new_session=True);out,err=p.communicate(timeout=5);need(p.returncode==0 and not err and len(out)<=16384,'FIXED_UNIT_READ');d={}
  for line in out.decode('ascii').splitlines():
   k,sep,v=line.partition('=');need(sep and k in fields and k not in d,'FIXED_UNIT_FIELDS');d[k]=v
  required={'LoadState','ActiveState','SubState','InvocationID','UnitFileState','NextElapseUSecRealtime'} if name==TIMER else {'LoadState','ActiveState','SubState','MainPID','InvocationID','ControlGroup'}
  need(required<=d.keys(),'FIXED_UNIT_FIELDS');return d
 finally:
  if p and p.poll()is None:
   saved={s:signal.signal(s,signal.SIG_IGN)for s in(signal.SIGINT,signal.SIGTERM,signal.SIGHUP)}
   try:
    try:os.killpg(p.pid,signal.SIGKILL)
    except ProcessLookupError:pass
    p.wait(timeout=2)
   finally:
    for s,h in saved.items():signal.signal(s,h)
  if p:
   if p.stdout:p.stdout.close()
   if p.stderr:p.stderr.close()

def fence(label,fn,codes):
 try:fn()
 except BaseException as e:
  if isinstance(e,(Interrupted,TimeoutError,KeyboardInterrupt)):raise
  code=str(e);return {'stage':label,'passed':False,'errorClass':type(e).__name__,'closedSourceGuard':code if code in codes else None,'reasonSHA256':sha(code.encode())}
 return {'stage':label,'passed':True}

def observe(R,v,codes):
 pkg=directory(R,PACKAGE,0,112,0o750);ev=directory(R,EVIDENCE,108,112,0o700);rows={};values={};specs={}
 for n in ROOT_FILES:specs['package/'+n]=(PACKAGE/n,0,112 if n=='root-worker-before.json'else 0,0o440 if n=='root-worker-before.json'else 0o600,262144 if n=='prepared-request.json'else 8*1024**2 if n=='root-native-capture.json.stderr'else 65536,n!='prepared-request.json')
 for n in NATIVE_FILES:specs['evidence/'+n]=(EVIDENCE/n,108,112,0o600,65536,True)
 for n,args in specs.items():rows[n],values[n]=receipt(R,*args)
 names=(UNIT,'proofofwork-audit30-worker-mail-guard-v3-'+RUN+'.service','proofofwork-audit30-worker-mail-guard-v3-20261003T152001Z.service',*FIVE,'proofofwork-postgres-logical-backup.service','proofofwork-postgres-logical-backup.timer');units={n:unit(n)for n in names};same=all(units[n]['ActiveState']=='active'and(units[n]['MainPID'],units[n]['InvocationID'])==x for n,x in FIVE.items())
 checks=[fence('prepared-contract-current',lambda:R.prepared_read(PACKAGE,v),codes)]
 if checks[-1]['passed']:checks.append(fence('immutable-package-fence-current',lambda:R.package_fence(v,PACKAGE,R.prepared_read(PACKAGE,v)),codes))
 old=values.get('package/root-native-capture.json.failed.json');known=old.get('observedInvocation')if isinstance(old,dict)else None;u=units[UNIT]
 gc=u['LoadState']=='not-found'and u['MainPID']=='0'and u['ActiveState']=='inactive'and not u['InvocationID']and not u['ControlGroup'];owned=u['LoadState']=='loaded'and u['MainPID']=='0'and not u['ControlGroup']and re.fullmatch('[0-9a-f]{32}',str(known))is not None and u['InvocationID']==known and u['ActiveState']in('inactive','failed')and u.get('User')=='postgres'and u.get('Group')=='postgres'
 for n,args in specs.items():need(receipt(R,*args)[0]==rows[n],'PUBLIC_RECEIPT_DRIFT')
 need(directory(R,PACKAGE,0,112,0o750)==pkg and directory(R,EVIDENCE,108,112,0o700)==ev,'DIRECTORY_ENDPOINT_DRIFT')
 return {'schema':'pow-audit30-body-run-readonly-reconciliation-v1','atUtc':datetime.datetime.now(datetime.timezone.utc).isoformat(),'failedRunRequestSHA256':REQUEST_SHA,'rootControlSHA256':ROOT_SHA,'package':pkg,'evidenceDirectory':ev,'receipts':rows,'privateSelectedPreimagesExistsOnly':os.path.lexists(EVIDENCE/'selected-preimages.json'),'units':units,'qualifiedGarbageCollected':gc,'exactOwnedStopped':owned,'endpointAbsentOrExactOwnedStopped':gc or owned,'observedInvocation':known,'liveFiveUnchanged':same,'currentInertSourceFences':checks,'sameAttemptDiscardedReasonRecovered':False,'observerSqlCoreApiCalls':False,'observerProductionMutation':False,'observerUnitControlCalls':False,'automaticRetry':False,'automaticInverse':False,'commitOutcomeCertified':False}

def main():
 need(sys.flags.isolated and os.getuid()==os.geteuid()==os.getgid()==os.getegid()==0 and os.uname().nodename=='pow-bitcoin-01','FIXED_ROOT_HOST');os.environ.clear();os.environ.update(ENV);signal.alarm(75);resource.setrlimit(resource.RLIMIT_AS,(256*1024**2,256*1024**2));resource.setrlimit(resource.RLIMIT_CPU,(45,45));R,v,codes=load(sys.stdin.buffer.read(196609));out=observe(R,v,codes);b=(json.dumps(out,sort_keys=True)+'\n').encode();need(len(b)<=65536,'CLOSED_OUTPUT_BOUND');sys.stdout.buffer.write(b)
if __name__=='__main__':
 for s in(signal.SIGINT,signal.SIGTERM,signal.SIGHUP,signal.SIGALRM):signal.signal(s,lambda *_:(_ for _ in()).throw(Interrupted('Readonly reconciliation interrupted')))
 try:main()
 except BaseException as e:print(json.dumps({'status':'refused','errorClass':type(e).__name__,'reasonSHA256':sha(str(e).encode()),'privateDetailsSuppressed':True,'observerOnly':True,'automaticRetry':False},sort_keys=True),file=sys.stderr);sys.exit(1)
