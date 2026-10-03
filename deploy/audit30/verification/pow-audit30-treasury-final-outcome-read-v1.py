#!/usr/bin/python3 -I
"""Fixed saved final treasury outcome reader. No RPC/SQL/control/raw export."""
import base64,datetime as dt,hashlib,json,os,re,resource,signal,stat,sys,time,types
from pathlib import Path
RUN='20261003T090000Z'
E=Path('/data/proofofwork-release-backups/audit30-treasury-final-closure-'+RUN)
PACKAGE=Path('/usr/local/lib/proofofwork-audit30-treasury-final-closure')/RUN
UNIT='proofofwork-audit30-treasury-final-closure-'+RUN+'.service'
UTILITY_SHA='78e0a05c9875f30542ab013307cc9bb05eeb4f637a8518c2ba0951bef2bb2b54'
UTILITY_BYTES=35454
SHA=re.compile('[0-9a-f]{64}')
TRUE_FLAGS=('parentValuesComplete','targetCanonicalMembershipComplete','knownHistoryFeeAndDirectSpendCoverageAccepted','derivedUnspentCoreChecksComplete','knownHistoryBalanceComparisonAccepted')
FALSE_FLAGS=('productionMutation','financialReconciliationComplete','obligationReconciliationComplete','independentWholeChainAddressHistoryComplete','signingEligibilityVerified','automaticNextChunk','automaticRetry','nextChunkAuthorized','may9TransactionIDsRequested')
class ReadInterrupted(RuntimeError):pass
def need(v,c):
 if not v:raise ValueError(c)
def sha(v):return hashlib.sha256(v).hexdigest()
def pairs(rows):
 d={}
 for k,v in rows:need(k not in d,'DUPLICATE_JSON');d[k]=v
 return d
def stamp(s):return[s.st_dev,s.st_ino,s.st_mode,s.st_uid,s.st_gid,s.st_nlink,s.st_size,s.st_mtime_ns,s.st_ctime_ns]
def stable(p,h,n,expected=None):
 need(isinstance(h,str)and SHA.fullmatch(h)and type(n)is int and 0<=n<=256*1024**2,'BOUNDED_FILE_AUTHORITY');s=p.lstat();m=stamp(s)
 need(p.resolve(strict=True)==p and stat.S_ISREG(s.st_mode)and(s.st_uid,s.st_gid,stat.S_IMODE(s.st_mode),s.st_nlink,s.st_size)==(0,0,0o600,1,n)and not os.listxattr(p,follow_symlinks=False),'ROOT_CAPTURE_CUSTODY')
 if expected is not None:need(m==expected,'ROOT_CAPTURE_METADATA')
 fd=os.open(p,os.O_RDONLY|os.O_NOFOLLOW|os.O_NOATIME)
 with os.fdopen(fd,'rb')as f:
  need(stamp(os.fstat(f.fileno()))==m and not os.listxattr(f.fileno()),'ROOT_CAPTURE_FD');raw=f.read(n+1);need(stamp(os.fstat(f.fileno()))==m and not os.listxattr(f.fileno()),'ROOT_CAPTURE_READ_DRIFT')
 need(stamp(p.lstat())==m and len(raw)==n and sha(raw)==h,'ROOT_CAPTURE_PATH_BYTES');return raw,dict(path=str(p),sha256=h,bytes=n,metadata=m)
def validate_request(v):
 need(isinstance(v,dict)and set(v)=={'schema','runId','outcomeName','outcomeSha256','outcomeBytes','utilityRawBase64'}and v['schema']=='pow-audit30-treasury-final-outcome-read-request-v1'and v['runId']==RUN and v['outcomeName']in('completed.json','failed.json')and SHA.fullmatch(v['outcomeSha256']or'')and type(v['outcomeBytes'])is int and 0<v['outcomeBytes']<=1024**2,'EXACT_TYPED_READ_REQUEST')
 if v['outcomeName']=='completed.json':need((v['outcomeSha256'],v['outcomeBytes'])==('a850e98deb0600c5943b6f4baeee699d49868f9b65a46ce9ca1759d4868ad50c',138003),'ACTUAL_COMPLETED_RAW_BINDING')
 raw=base64.b64decode(v['utilityRawBase64'],validate=True);need((len(raw),sha(raw))==(UTILITY_BYTES,UTILITY_SHA),'FROZEN_78E_DEFINITIONS');m=types.ModuleType('frozen78e_definitions');m.__file__='byte-pinned-inert78e';exec(compile(raw,m.__file__,'exec'),m.__dict__);return m
def live_valid(v,m):
 m.validate_live_authority({'liveServices':v});return v
def outcome(v,m,completed):
 need(v.get('schema')=='pow-audit30-treasury-native-outcome-v1'and v.get('runId')==RUN and v.get('retainedUnitProbeSha256')==m.RETAINED_PROBE_SHA and v.get('outputPropertyProbeSha256')==m.OUTPUT_PROPERTY_PROBE_SHA,'EXACT_PRODUCER_OUTCOME')
 need(all(v.get(k)is False for k in('futureChunksAuthorized','productionDataMutation','financialReconciliationComplete','may9TransactionIDsRequested','automaticNextChunk','autoRetry')),'FALSE_SCOPE_FLAGS');live_valid(v['liveBefore'],m);need(v['liveBefore']==v['liveAfter'],'SAVED_FIVE_UNCHANGED');cl=v.get('cleanup');need(isinstance(cl,dict)and cl.get('attempted')is True,'SAVED_OWNED_STOP')
 b,a=cl.get('before'),cl.get('after');need(isinstance(b,dict)and isinstance(a,dict),'SAVED_STOP_SHAPE');o=m.Observer(UNIT,E,time.monotonic()+90,m.fixed_argv(PACKAGE));inv=o.identity(b,False);o.owned=inv;need(b['MainPID']=='0','SAVED_STOP_ZERO_PID');typed=cl.get('typedExecStart');argv=o.expected_argv;need(isinstance(typed,dict)and typed.get('argvSha256')==sha(json.dumps(argv,separators=(',',':')).encode())and typed.get('fixedCodeSha256')==sha(argv[-1].encode()),'SAVED_FIXED_COMMAND')
 need((a.get('LoadState')=='not-found'and a.get('MainPID')=='0'and a.get('InvocationID')=='')or(a.get('InvocationID')==inv and a.get('MainPID')=='0'and a.get('ActiveState')in('inactive','failed')),'SAVED_STOP_CLOSURE')
 if not completed:
  need(v.get('transportAccepted')is False and isinstance(v.get('failure'),dict),'FAILED_REMAINS_FAILED');return o,None
 need(v.get('transportAccepted')is True and v.get('failure')is None and v.get('originalFailedCorpusAndPriorPackageUnchanged')is True and v.get('inputRawDeltaOriginalUnchanged')is True and v.get('inputRawDeltaSha256')==m.SEED_SHA and v.get('selectedParentCount')==2569 and v.get('selectedParentSetSha256')=='608eed04fff7e8e28c6396fc743dd15834219adebfc2c8fef7e03efe8251dbff'and v.get('remainingParentsAfterComplete')==0,'SAVED_COMPLETE_AUTHORITY')
 need(b['Result']=='success'and b['ExecMainStatus']=='0','SAVED_SUCCESS');r=v['result'];need(r.get('status')=='discovered-history-closure-complete-with-closing-fences'and r.get('closingFencesAccepted')is True and set(r.get('scopedVerification',{}))==set(TRUE_FLAGS)and all(r['scopedVerification'][k]is True for k in TRUE_FLAGS),'SAVED_SCOPED_CLOSURE')
 c=r['coverage'];need(all(type(c.get(k))is int for k in('requestedParents','acquiredParents','remainingParents','targetCount','canonicalTargetProofs','blockGroups','batchProofs','derivedUnspentCount','coreCalls','coreBytes','electrsCalls','electrsBytes'))and(c['requestedParents'],c['acquiredParents'],c['remainingParents'],c['targetCount'],c['canonicalTargetProofs'],c['blockGroups'],c['batchProofs'])==(2569,2569,0,10232,10232,567,644)and 0<=c['derivedUnspentCount']and c['coreCalls']==6132+2*c['derivedUnspentCount']<=10000 and 0<=c['coreBytes']<=256*1024**2 and c['electrsCalls']==20 and 0<=c['electrsBytes']<=32*1024**2 and c.get('openingPrefixCoreCalls')==3 and c.get('closingReservedCoreCalls')==571,'SAVED_COMPLETE_COUNTS')
 for name,path in(('stdout','corpus.json'),('stderr','stderr.log')):
  need(r[name]==v['captureFiles'][path]and r[name]['path']==str(E/path),'SAVED_CAPTURE_BINDING')
 need(r['stderr']['bytes']==0 and r['stderr']['sha256']==sha(b''),'SAVED_ZERO_STDERR');snapshots=v.get('unitSnapshots');need(isinstance(snapshots,list)and 0<len(snapshots)<=1600,'SAVED_NATIVE_SNAPSHOTS')
 for s in snapshots:
  d=s['properties'];need(d['InvocationID']==inv,'SAVED_SAME_INVOCATION');m.validate_properties(d,E);need(s['typedExecStart']['argvSha256']==typed['argvSha256'],'SAVED_COMMAND_SNAPSHOTS')
 return o,r
def current(o,m,expected):
 five=m.live_snapshot(o);need(five==expected,'CURRENT_FIVE_DRIFT');d=o.show();gc=d.get('LoadState')=='not-found'and d.get('MainPID')=='0'and d.get('InvocationID')==''and d.get('ActiveState')=='inactive'and d.get('SubState')=='dead'
 typed=None
 if not gc:
  need(d.get('LoadState')=='loaded'and d.get('MainPID')=='0'and d.get('InvocationID')==o.owned and d.get('ActiveState')in('inactive','failed')and d.get('User')==d.get('Group')=='bitcoin'and d.get('Type')=='exec'and d.get('Transient')==d.get('RemainAfterExit')=='yes'and d.get('ControlGroup')in('','/system.slice/'+UNIT),'CURRENT_SAME_OWNED_STOPPED');typed=o.typed_start()
 return dict(liveFive=five,ownedUnit={k:d[k]for k in('LoadState','ActiveState','SubState','MainPID','InvocationID')},ownedStopped=True,qualifiedTransientGc=gc,typedExecStart=typed,freshMetadataObservationOnly=True)
def execute(v,m):
 raw,proof=stable(E/v['outcomeName'],v['outcomeSha256'],v['outcomeBytes']);value=json.loads(raw,object_pairs_hook=pairs);completed=v['outcomeName']=='completed.json';o,r=outcome(value,m,completed);before=current(o,m,value['liveBefore']);after=current(o,m,value['liveBefore']);need(before==after,'CURRENT_ENDPOINT_CONTEXT_DRIFT');window=value['backupWindowAfter'];next_=dt.datetime.strptime(window['timer']['NextElapseUSecRealtime'],'%a %Y-%m-%d %H:%M:%S %Z').replace(tzinfo=dt.timezone.utc).isoformat();fresh_window=m.check_window(o,{'backupWindow':dict(observedAtUtc=window['observedAtUtc'],nextBackupUtc=next_)},False)
 again,proof2=stable(E/v['outcomeName'],v['outcomeSha256'],v['outcomeBytes'],proof['metadata']);need(again==raw and proof2==proof,'OUTCOME_FINAL_CUSTODY')
 return dict(schema='pow-audit30-treasury-final-public-outcome-read-v1',atUtc=dt.datetime.now(dt.timezone.utc).isoformat(),outcomeFile=proof,status='completed'if completed else'preserved-failed',sourceNativeControllerSha256=UTILITY_SHA,result=r and {k:r[k]for k in('status','closingFencesAccepted','coverage','feeSummary','scopedVerification')},corpusSavedMetadata=r and r['stdout'],stderrSavedMetadata=r and r['stderr'],storedLiveBefore=value['liveBefore'],storedLiveAfter=value['liveAfter'],storedBackupWindowBefore=value['backupWindowBefore'],storedBackupWindowAfter=window,storedOwnedCleanup={k:value['cleanup'][k]for k in('attempted','before','after','typedExecStart')},savedUnitSnapshotCount=len(value.get('unitSnapshots',[])),currentContextBefore=before,currentContextAfter=after,currentBackupWindow=fresh_window,financialReconciliationComplete=False,obligationReconciliationComplete=False,independentWholeChainAddressHistoryComplete=False,may9TransactionIDsRequested=False,productionMutation=False,rpcCalls=0,sqlExecuted=False,serviceControlPerformed=False,rawTransactionsExported=False,privateCorpusRehashed=False,automaticRetry=False,automaticNextChunk=False,qualification='Saved source-bound discovered10232-target scope and observed stopped endpoints only. Captured corpus metadata is from the SHA-bound public completed receipt; no private corpus read/rehash/export or independent full-address history, obligations, signing or continuous/future-reader claim.')

def main():
 need(sys.flags.isolated and len(sys.argv)==1 and os.geteuid()==os.getegid()==0 and os.uname().nodename=='pow-bitcoin-01','ISOLATED_FIXED_ROOT_HOST');resource.setrlimit(resource.RLIMIT_AS,(512*1024**2,512*1024**2));resource.setrlimit(resource.RLIMIT_CPU,(60,60));old={}
 def interrupted(n,f):raise ReadInterrupted('read-interrupted-'+str(n))
 for n in(signal.SIGINT,signal.SIGTERM,signal.SIGHUP,signal.SIGALRM):old[n]=signal.signal(n,interrupted)
 signal.alarm(90)
 try:
  raw=sys.stdin.buffer.read(131073);need(len(raw)<=131072,'TYPED_INPUT_CAP');v=json.loads(raw,object_pairs_hook=pairs);m=validate_request(v);print(json.dumps(execute(v,m),sort_keys=True,separators=(',',':')))
 finally:
  signal.alarm(0)
  for n,h in old.items():signal.signal(n,h)
if __name__=='__main__':
 try:main()
 except BaseException as e:print(json.dumps(dict(schema='pow-audit30-final-outcome-read-refused-v1',errorClass=type(e).__name__,reasonSha256=sha(str(e).encode()),productionMutation=False,rpcCalls=0,sqlExecuted=False,automaticRetry=False)),file=sys.stderr);raise SystemExit(1)
