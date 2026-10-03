#!/usr/bin/python3 -I -B
"""One exact original480 read-only observation. No writer or inverse, no automatic retry."""
import ast,base64,datetime,hashlib,json,os,re,resource,signal,subprocess,sys,time,types
RUN='20261003T150500Z';UNIT='proofofwork-audit30-worker-mail-guard-v3-'+RUN+'.service'
REQUEST_SHA='37b3d8e58fcca371ec952c12207efbe2b2a9feb58b755452b69616346fc252a6'
GUARD_SHA='48001283affb80b3b027dcc93831074aee872fbee649fb14482c32b00eb1c76c';HELPER_SHA='33c3c65c079901022850d4407c4df460b6924196d077061ba86d0d27ef385729'
FIVE={'bitcoind.service':('1324302','64e1fa7be2e2442d8c7f5763f60b85fb'),'electrs.service':('1324320','72418b1c7ab245e4a37685ed868a1084'),'postgresql@16-main.service':('1537429','e0bf545f0ad944e89fe1005577e61b9c'),'proofofwork-api.service':('2103747','208f8bcbecc54afbb7166754f12065c2'),'proofofwork-indexer-worker.service':('2103760','33b3ee25490749db89e0d55fd29d0afb')}
class Interrupted(RuntimeError):pass
def need(v,c):
 if not v:raise ValueError(c)
def sha(b):return hashlib.sha256(b).hexdigest()
def module(b,name):
 m=types.ModuleType(name);m.__file__='/reviewed/'+name+'.py';exec(compile(b,m.__file__,'exec'),m.__dict__);return m
def load(raw):
 need(len(raw)<=196608 and sha(raw)==REQUEST_SHA,'EXACT_AUTHENTIC_SOURCE_ENVELOPE');v=json.loads(raw)['request'];need(v['runId']=='20261003T145500Z'and v['operation']=='apply'and v['mode']=='run','EXACT_SOURCE_ENVELOPE_SCOPE');gb=base64.b64decode(v['guardBase64'],validate=True);hb=base64.b64decode(v['captureHelperBase64'],validate=True);need(len(gb)<=16384 and sha(gb)==GUARD_SHA and len(hb)<=32768 and sha(hb)==HELPER_SHA,'EXACT480_AND_33C_BYTES');g=module(gb,'original480');B=module(hb,'inert33c');codes={n.args[1].value for n in ast.walk(ast.parse(gb))if isinstance(n,ast.Call)and isinstance(n.func,ast.Name)and n.func.id=='need'and len(n.args)>1 and isinstance(n.args[1],ast.Constant)and isinstance(n.args[1].value,str)}
 forbidden=lambda *_a,**_k:(_ for _ in()).throw(RuntimeError('MUTATION_FORBIDDEN'))
 for n in('main','capture_unit','create','record','newdir','copy_dependencies'):setattr(B,n,forbidden)
 return g,B,codes

def diagnostic(g,B,codes):
 floor=int(time.monotonic()*1000000);captured={};original_run=subprocess.run
 def forward(argv,*args,**kwargs):
  # Observe original constructed public command without altering one argv/kwarg.
  if isinstance(argv,list)and argv and argv[0]=='/usr/bin/systemd-run':
   need(not captured and '--unit='+UNIT in argv and kwargs.get('input')==g.SQL.encode()and kwargs.get('timeout')==40 and kwargs.get('env')==g.ENV and kwargs.get('capture_output')is True,'EXACT_ORIGINAL_READONLY_SQL_CALL');captured['expectedArgv']=argv[argv.index('/usr/bin/env'):]
  return original_run(argv,*args,**kwargs)
 g.subprocess=types.SimpleNamespace(run=forward);result=None;failure=None;interrupted=False
 try:result=g.execute(RUN)
 except BaseException as e:
  if isinstance(e,(Interrupted,KeyboardInterrupt,TimeoutError,subprocess.TimeoutExpired)):raise
  interrupted=False;text=str(e);failure={'errorClass':type(e).__name__,'closedOriginalGuard':text if text in codes else None,'reasonSHA256':sha(text.encode())}
 # Fixed endpoint metadata; never stop/reset/kill a systemd service.
 p=subprocess.run(['/usr/bin/systemctl','show',UNIT,'--property=LoadState,ActiveState,SubState,MainPID,InvocationID,ControlGroup,User,Group,Type,Transient'],env=g.ENV,capture_output=True,timeout=5);need(p.returncode==0 and not p.stderr and len(p.stdout)<=16384,'FIXED_ENDPOINT_READ');u=dict(line.split('=',1)for line in p.stdout.decode('ascii').splitlines());need({'LoadState','ActiveState','SubState','MainPID','InvocationID','ControlGroup'}<=u.keys(),'FIXED_ENDPOINT_FIELDS')
 gc=u['LoadState']=='not-found'and u['MainPID']=='0'and not u['InvocationID']and not u['ControlGroup'];owned=False;inv=None;ownership_error=None
 if captured and u['LoadState']=='loaded'and not interrupted:
  try:inv=B.owned_unit(UNIT,captured['expectedArgv'],floor,None);B.terminal_unit(UNIT,inv);owned=u['MainPID']=='0'and not u['ControlGroup']and u['InvocationID']==inv
  except BaseException as e:
   if isinstance(e,(Interrupted,KeyboardInterrupt,TimeoutError,subprocess.TimeoutExpired)):raise
   ownership_error={'errorClass':type(e).__name__,'reasonSHA256':sha(str(e).encode())}
 live={n:g.state(n)for n in FIVE};same=all(r.get('ActiveState')=='active'and(r.get('MainPID'),r.get('InvocationID'))==FIVE[n]for n,r in live.items())
 return {'schema':'pow-audit30-original-worker-guard-readonly-diagnostic-v1','atUtc':datetime.datetime.now(datetime.timezone.utc).isoformat(),'runId':RUN,'originalGuardSHA256':GUARD_SHA,'sourceEnvelopeSHA256':REQUEST_SHA,'guardPassed':result is not None,'currentClosedFailure':failure,'originalPublicGuardResult':result,'sqlUnitCommandObserved':bool(captured),'unit':u,'observedInvocation':inv,'exactOwnedStopped':owned,'qualifiedGarbageCollected':gc,'endpointAbsentOrExactOwnedStopped':gc or owned,'invocationOwnershipUnresolved':gc and bool(captured),'ownershipObservationFailure':ownership_error,'liveFive':live,'liveFiveUnchangedAndOriginal':same,'sameAttemptDiscardedFailureRecovered':False,'productionMutation':False,'writerInvoked':False,'existingProductionServiceControlCalls':False,'ownedReadonlySqlUnitCreationAttempted':bool(captured),'automaticRetry':False,'automaticInverse':False,'transportCleanupDoesNotCertifyNativeStop':True}

def main():
 need(sys.flags.isolated and os.getuid()==os.geteuid()==os.getgid()==os.getegid()==0 and os.uname().nodename=='pow-bitcoin-01','FIXED_ROOT_HOST');signal.alarm(90);resource.setrlimit(resource.RLIMIT_AS,(256*1024**2,256*1024**2));resource.setrlimit(resource.RLIMIT_CPU,(45,45));os.environ.clear();os.environ.update({'PATH':'/usr/sbin:/usr/bin:/sbin:/bin','LC_ALL':'C','TZ':'UTC'});g,B,c=load(sys.stdin.buffer.read(196609));out=diagnostic(g,B,c);raw=(json.dumps(out,sort_keys=True)+'\n').encode();need(len(raw)<=65536,'PUBLIC_OUTPUT_BOUND');sys.stdout.buffer.write(raw)
if __name__=='__main__':
 for s in(signal.SIGINT,signal.SIGTERM,signal.SIGHUP,signal.SIGALRM):signal.signal(s,lambda *_:(_ for _ in()).throw(Interrupted('Readonly worker diagnostic interrupted')))
 try:main()
 except BaseException as e:print(json.dumps({'status':'refused','errorClass':type(e).__name__,'reasonSHA256':sha(str(e).encode()),'privateDetailsSuppressed':True,'readonlyOnly':True,'automaticRetry':False},sort_keys=True),file=sys.stderr);sys.exit(1)
