#!/usr/bin/python3 -I
"""Proposed private014100-only acknowledged apply and separate inverse proof.
Reuses frozen26c and accepted completion lineage. No live repair entrypoint.
"""
import argparse,hashlib,json,os,pwd,re,signal,stat,sys,time
from pathlib import Path
APPROVAL='6821c987b9a5d110fbe9fb2820955b7cbc26dda9faddb67667fc49e892f5c820'
JOB=Path('/data/proofofwork-audit30-inspect-20261003T014100Z')
SOURCE=Path('/data/proofofwork-audit30-restore-20261002T234651Z')
BASE=Path('/usr/local/lib/proofofwork-audit30-private-sixteen')
COMPLETION_PACKAGE=Path('/usr/local/lib/proofofwork-audit30-stream-completion/20261003T064500Z')
COMPLETION_SHA='ecb2b237b93ebd0bde96e5d7d690abbda5b9fa92aaeb0fea47c23e169acf4e8e'
COMPLETION_PLAN_SHA='66a9ea0b9045df377fa5d6c00d83f4556f9b90bff357cf80ace5cc9210472dac'
COMPLETION_PINS={'completed.json':'974e16cfb288e19e7320fa87687d32cff65b2a58296b4e94893ddbdfaea3c841','intent.json':'121d96aaf3af0eae662e1d602b304d54e3db4c5185059e8386164e540d1cf8f3'}
GUARD_SHA='26c7656b2e751c6de50122c65f8af73686c2d2674bee8be86a3c5648b7fcc80e'
ADAPTER_SHA='4e569cfba47b82ead715a2fba8b9f84c5c113f12dbbbb4986dc5fd8921adc498'
LIBRARY_SHA='2e9a7fb67616e46b3b14d1074dc5206eb280df6868cc249943645b8d8ab685da'
BODY_SHA='ea5614fddc0ef7fb696d0159a141b25116fbd6ba2c4b309db171a548b7f8b70c'
ORIGINAL_ENGINE_SHA='09b3240e45d76278a67053f5fba6009cccce36b00c1b098d38d7435da978dc58'
PRIVATE_PLAN_SHA='4ac3a8d9b4b79befd36abc590731b1bc8f2e6c83919d5f6427c34c58a6ddba00'
MANIFEST_SHA='8d5d347aea2d398d75e69631f90b3efdd1c3254cfdbf3864015199b078699c50'
CLOSURE_SHA='6ff26ebf45fd6471e3124929128b06ca3cf20c53fdf03b12255029faca62e670'
TARGETS_SHA='1815490ac19cb744738be9bd9cd2a500233abef737eb810c04c38cd47beca48f'
SOURCE_FENCE_SHA='d9c08752be9e8e7c8d9ce4409b20496783901f116becbb26e205904dc676564b'
SOURCE_COPY_MANIFEST_SHA='e904b0379dd6c80f68eebbb556b5bd5caa8619aa79df89f03ed16ebbeb6db977'
SCHEMA='pow-audit30-private-sixteen-supervision-plan-v1'
WORK=JOB/'exact-sixteen-write-proof-v1'
MATH=JOB/'stream-completion-v2'/'onhost-math-completion-v2'/'completed.json'
C=G=I=S=None
class PrivateProofInterrupted(RuntimeError):pass
def need(v,m):
 if not v:raise ValueError(m)
def encoded(v):return json.dumps(v,sort_keys=True,separators=(',',':')).encode()
def sha(b):return hashlib.sha256(b).hexdigest()
def load():
 global C,G,I,S
 import types
 path=COMPLETION_PACKAGE/'controller.py';s=path.lstat()
 need(path.resolve(strict=True)==path and stat.S_ISREG(s.st_mode)and(s.st_uid,s.st_gid,stat.S_IMODE(s.st_mode),s.st_nlink)==(0,112,0o440,1)and s.st_size<=65536,'Immutable completion helper')
 stamp=lambda x:(x.st_dev,x.st_ino,x.st_mode,x.st_uid,x.st_gid,x.st_nlink,x.st_size,x.st_mtime_ns,x.st_ctime_ns)
 fd=os.open(path,os.O_RDONLY|os.O_NOFOLLOW)
 with os.fdopen(fd,'rb')as f:
  need(stamp(os.fstat(f.fileno()))==stamp(s),'Helper FD changed');raw=f.read(65537);need(stamp(os.fstat(f.fileno()))==stamp(s),'Helper read changed')
 need(stamp(path.lstat())==stamp(s)and sha(raw)==COMPLETION_SHA,'Helper bytes/path changed')
 C=types.ModuleType('completion');C.__file__=str(path);exec(compile(raw,str(path),'exec'),C.__dict__);C.load()
 G=C.module(Path(__file__).parent/'restore-latest-logical.py',GUARD_SHA);I=C.I;S=C.S;C.G=G;I.G=G;S.G=G
def validate(p):
 keys={'schema','approvalSha256','controllerSha256','host','runId','unit','job','sealedSource','backupLock','backupWindow','liveServices','node','adapterAdmissionSha256','mathProof'}
 need(isinstance(p,dict)and set(p)==keys and p['schema']==SCHEMA and p['approvalSha256']==APPROVAL and S.SHA.fullmatch(p['controllerSha256']),'Exact private proof authority');S.calendar(p['runId'])
 need(p['host']=='pow-bitcoin-01'and p['unit']=='proofofwork-audit30-private-sixteen-'+p['runId']+'.service'and p['job']==str(JOB)and p['sealedSource']==str(SOURCE),'Only admitted014100 private clone')
 # Use the accepted field validators without widening their scope.
 old=dict(schema=C.SCHEMA,approvalSha256=APPROVAL,controllerSha256=COMPLETION_SHA,host=p['host'],runId=p['runId'],unit='proofofwork-audit30-stream-completion-'+p['runId']+'.service',job=p['job'],sealedSource=p['sealedSource'],backupLock=p['backupLock'],backupWindow=p['backupWindow'],liveServices=p['liveServices'],inputBindings=COMPLETION_PLAN['inputBindings'])
 C.validate(old)
 n=p['node'];need(set(n)=={'metadata','sha256'}and set(n['metadata'])==I.META_KEYS and all(type(x)is int and x>=0 for x in n['metadata'].values())and n['metadata']['uid']==0 and n['metadata']['mode']==0o755 and n['metadata']['nlink']==1 and S.SHA.fullmatch(n['sha256']),'Exact existing Node authority')
 need(S.SHA.fullmatch(p['adapterAdmissionSha256']),'Private admission SHA required')
 r=p['mathProof'];need(set(r)=={'path','metadata','sha256'}and r['path']==str(MATH)and set(r['metadata'])==I.META_KEYS and all(type(x)is int and x>=0 for x in r['metadata'].values())and r['metadata']['uid']==0 and r['metadata']['gid']==0 and r['metadata']['mode']==0o600 and r['metadata']['nlink']==1 and r['metadata']['bytes']<=1024**2 and S.SHA.fullmatch(r['sha256']),'Actual stopped arithmetic proof required');return p
COMPLETION_PLAN=None
def completed_lineage():
 global COMPLETION_PLAN
 v={n:I.read_json(JOB/'stream-completion-v2'/n,h,limit=65536)[0]for n,h in COMPLETION_PINS.items()};d=v['completed.json'];intent=v['intent.json'];p=intent.get('plan',{})
 need(intent.get('planSha256')==d.get('planSha256')==COMPLETION_PLAN_SHA and sha(encoded(p))==COMPLETION_PLAN_SHA and p.get('controllerSha256')==COMPLETION_SHA,'Canonical completed lineage')
 need(d.get('schema')=='pow-audit30-complete-retained-private-stream-completed-v1'and d.get('status')=='passed'and all(d.get(k)is True for k in ('originalAttemptRemainsFailed','priorCompletionRemainsFailed','bodyAll16Accepted','freshCurrentSideByteEquality','fullNativeByteEquality','privateClusterStopped','liveServicesUnchanged','sealedSourceFullHashVerifiedBeforeStart','sealedSourceFullHashVerifiedAtStop','backupWindowRecheckedAtStop'))and all(d.get(k)is False for k in ('bodyRedo','newSchemaWrite','productionMutation','sealedSourceStarted','mathAccepted','allHistoricalReplay')),'Actual byte completion and private stop required')
 C.validate(p);COMPLETION_PLAN=p;return p
def math_proof(p):
 # The original root600/root700 producer evidence stays root-private. Root
 # admission copies only its public result into this immutable readable package
 # and independently rechecks the original source before/after the unit.
 r=p['mathProof'];path=G.canonical_path(Path(__file__).parent/'sample-math-completed.json');m=G.metadata(path);need(stat.S_ISREG(path.lstat().st_mode)and m['uid']==0 and m['gid']==112 and m['mode']==0o440 and m['nlink']==1 and m['bytes']==r['metadata']['bytes'],'Readable immutable public arithmetic receipt');v,_=I.read_json(path,r['sha256'],limit=1024**2,root_authority=True)
 need(v.get('schema')=='pow-audit30-onhost-math-managed-completed-completion-v2'and v.get('status')=='passed'and v.get('cleanup',{}).get('verified')is True and all(v.get(k)is True for k in ('wholeCandidateUnchanged','privateClusterStillStopped'))and all(v.get(k)is False for k in ('productionMutation','privatePayloadExported')),'Arithmetic runtime and stopped proof')
 q=v.get('result',{});flags=('sourceCopyFullyVerifiedBeforeAndAfter','allColumnBytesExact','storedDeclarationAndMarkerBound','exactV6ToV8SoleTokenOpeningRebind','holderConversionBigIntExact','markerBeforeAfterAndRelicCommitmentsExact','publicOutputContainsOnlyCountsHashesNumbersAndFixedEnums')
 need(q.get('schema')=='pow-audit30-onhost-sampled-historical-math-result-v1'and q.get('status')=='passed'and q.get('rows')==3 and q.get('sampleHeights')==[960600,960601,969526]and q.get('nativeUid')==108 and q.get('nativeGid')==112 and q.get('sourceFenceSHA256')==SOURCE_FENCE_SHA and q.get('sourceCopyManifestSHA256')==SOURCE_COPY_MANIFEST_SHA and q.get('productionMutation')is False and q.get('sourceSha256')==q.get('reconstructedSha256')==C.SOURCE_SHA and all(q.get(k)is True for k in flags),'Sample arithmetic not accepted')
 rows=q.get('numericVerification');need(isinstance(rows,list)and len(rows)==3 and [r.get('height')for r in rows]==[960600,960601,969526],'Exact three numeric verification rows');return v
def portable(m):
 return [dict(path=r['path'],kind=r['kind'],mode=r['metadata']['mode'],**({'bytes':r['metadata']['bytes'],'sha256':r['sha256']}if r['kind']=='file'else{}))for r in m['records']]
def dependency_fence(base,original):
 expected=I.verify_pg_dependencies(C.OLD,original['phase4']);actual=I.collect_pg_dependencies(base/'pg-dependencies')
 need(actual['entries']==expected['entries']==172 and actual['regularBytes']==expected['regularBytes']==443205 and portable(actual)==portable(expected),'Exact original172 dependency closure');return sha(encoded(actual))
def private_admission(a,targets):
 wanted=dict(schema='pow-audit30-exact-sixteen-write-admission-v1',environment='privateclone',operation='apply',originalPlanSHA256=PRIVATE_PLAN_SHA,manifestSHA256=MANIFEST_SHA,engineSHA256=LIBRARY_SHA,readinessClosureSHA256=CLOSURE_SHA,targetTxidSetSHA256=TARGETS_SHA,expectedDatabaseIdentity=dict(dataDirectory=str(JOB/'cluster'),socket=str(JOB/'socket'),listenAddresses='',port='55432',readOnly='on',checksums='on',user='postgres',database='proof_indexer',serverAddress=None),approvalReceiptSHA256=None,productionApplyApproved=False,priorAcknowledgedApplyReceiptSHA256=None)
 need(a==wanted and sha(encoded([t['txid']for t in targets]))==TARGETS_SHA and len(targets)==16,'Exact private admission and ordered targetset');return a
def package(p,original):
 base=G.canonical_path(Path(__file__).parent);m=G.metadata(base);need(base==BASE/p['runId']and Path(__file__).name=='controller.py'and m['uid']==0 and m['gid']==112 and m['mode']==0o750,'New immutable private proof package')
 pins={'controller.py':p['controllerSha256'],'restore-latest-logical.py':GUARD_SHA,'adapter.mjs':ADAPTER_SHA,'pow-audit30-mail-body-exact-sixteen-write-candidate-v1.mjs':LIBRARY_SHA,'pow-audit30-mail-body-repair-rehearsal-v2.mjs':BODY_SHA,'original-transaction-engine.mjs':ORIGINAL_ENGINE_SHA,'phase4-private-plan.json':PRIVATE_PLAN_SHA,'private-sixteen-write-admission.json':p['adapterAdmissionSha256'],'sample-math-completed.json':p['mathProof']['sha256']}
 for name,h in pins.items():
  f=G.canonical_path(base/name);m=G.metadata(f);need(stat.S_ISREG(f.lstat().st_mode)and m['uid']==0 and m['gid']==112 and m['mode']==0o440 and m['nlink']==1 and m['bytes']<=16*1024**2,'Immutable exact proof member');G.hash_file(f,m|{'sha256':h},16*1024**2,no_atime=False)
 rawplan,_=I.read_json(base/'phase4-private-plan.json',PRIVATE_PLAN_SHA,limit=16*1024**2,root_authority=True);a,_=I.read_json(base/'private-sixteen-write-admission.json',p['adapterAdmissionSha256'],limit=32768,root_authority=True);private_admission(a,rawplan['targets'])
 n=p['node'];need(G.metadata(I.NODE)==n['metadata']and G.hash_file(I.NODE,n['metadata']|{'sha256':n['sha256']},256*1024**2,no_atime=False)==n['sha256'],'Node executable changed')
 return base,dependency_fence(base,original)
def runtime(p):
 need(os.geteuid()==108 and os.getegid()==112 and os.uname().nodename==p['host']and any(x.split(':',2)[-1]=='/system.slice/'+p['unit']for x in Path('/proc/self/cgroup').read_text().splitlines()),'Managed private postgres identity')
 wanted={**G.UNIT_PROPERTIES,'RuntimeMaxUSec':'15min','ReadWritePaths':str(JOB)};actual=G.system_properties(p['unit'],[*wanted,'ReadOnlyPaths','InaccessiblePaths']);need(all(actual.get(k)==v for k,v in wanted.items())and set(actual['ReadOnlyPaths'].split())=={str(G.BACKUPS),str(SOURCE)}and set(actual['InaccessiblePaths'].split())==set(G.UNIT_INACCESSIBLE)|{str(SOURCE/'socket')},'Exact private proof hardening');need(os.statvfs(SOURCE).f_flag&os.ST_RDONLY,'Sealed original RO mount')
 for x in [*G.INACCESSIBLE,str(SOURCE/'socket')]:
  try:os.listdir(x)
  except(PermissionError,FileNotFoundError):continue
  raise ValueError('Forbidden live/sealed socket accessible')
def proof_result(v,p,base):
 expected=dict(schema='pow-audit30-private-exact-sixteen-commit-inverse-proof-v1',status='passed',privateJob=str(JOB),originalPlanSHA256=PRIVATE_PLAN_SHA,manifestSHA256=MANIFEST_SHA,librarySHA256=LIBRARY_SHA,ea56SHA256=BODY_SHA,originalEngineSHA256=ORIGINAL_ENGINE_SHA,admissionSHA256=p['adapterAdmissionSha256'],targetCount=16,forwardCommitAcknowledged=True,separateInverseCommitAcknowledged=True,bodyPreimagesRestored=True,nonbodyNontargetUnchangedInEachTransaction=True,readinessInvalidationPerCommittedTransaction=True,operationalEpochRewind=False,source7Accessed=False,productionMutation=False,productionApplyApproved=False,liveApproval=False,newCoreReplayClaimed=False,automaticRetry=False)
 need(set(v)==set(expected)|{'applyReceiptSHA256','inverseReceiptSHA256'}and all(v.get(k)==x and type(v.get(k))is type(x)for k,x in expected.items())and all(S.SHA.fullmatch(v[k])for k in ('applyReceiptSHA256','inverseReceiptSHA256')),'Both acknowledged private commits and inverse required')
 persisted,_=I.read_json(WORK/'proof-completed.json',sha(encoded(v)),limit=65536);need(persisted==v,'Adapter stdout and durable proof differ')
 observed=[]
 for operation,k in [('apply','applyReceiptSHA256'),('inverse','inverseReceiptSHA256')]:
  r,_=I.read_json(WORK/(operation+'-completed.json'),v[k],limit=65536);need(r.get('schema')=='pow-audit30-exact-sixteen-write-completed-v1'and r.get('status')=='committed'and r.get('operation')==operation and r.get('environment')=='privateclone'and r.get('originalPlanSHA256')==PRIVATE_PLAN_SHA and r.get('manifestSHA256')==MANIFEST_SHA and r.get('engineSHA256')==LIBRARY_SHA and r.get('targetCount')==16 and all(r.get(n)is True for n in ('bodyOnly','allTransactionNonbodyAndNontargetRowsUnchanged','commitAcknowledged','queueFlushedBeforeCommit'))and all(r.get(n)is False for n in ('productionMutation','automaticRetry','operationalEpochRewind')),'Exact acknowledged transaction receipt')
  private,_=I.read_json(base/'phase4-private-plan.json',PRIVATE_PLAN_SHA,limit=16*1024**2,root_authority=True);need(r.get('orderedTargetTxids')==[t['txid']for t in private['targets']],'Transaction exact targetset');need(r.get('expectedDatabaseIdentity')==private_admission(I.read_json(base/'private-sixteen-write-admission.json',p['adapterAdmissionSha256'],limit=32768,root_authority=True)[0],private['targets'])['expectedDatabaseIdentity'],'Same private database identity')
  need(isinstance(r.get('transactionId'),str)and re.fullmatch('[1-9][0-9]*',r['transactionId'])and type(r.get('operationalShard'))is int and r['operationalShard']==int(r['transactionId'])%64 and isinstance(r.get('operationalEpochBefore'),str)and re.fullmatch('[1-9][0-9]*',r['operationalEpochBefore'])and r.get('operationalEpochAfter')==str(int(r['operationalEpochBefore'])+1),'One legitimate readiness invalidation each commit');observed.append(r)
 need(observed[0]['admissionSHA256']==p['adapterAdmissionSha256'],'Acknowledged apply admission drift')
 admission,_=I.read_json(base/'private-sixteen-write-admission.json',p['adapterAdmissionSha256'],limit=32768,root_authority=True);inverse_admission=admission|{'operation':'inverse','priorAcknowledgedApplyReceiptSHA256':v['applyReceiptSHA256']}
 need(observed[1]['admissionSHA256']==sha(encoded(inverse_admission)),'Inverse lacks exact acknowledged apply binding')
 need(int(observed[1]['transactionId'])>int(observed[0]['transactionId']),'Separate later inverse transaction')
 journal=[]
 for index,operation in enumerate(('apply','inverse')):
  path=WORK/(operation+'-commit-intent.json');m=G.metadata(path);need(m['uid']==108 and m['gid']==112 and m['mode']==0o600 and m['nlink']==1 and m['bytes']<=65536,'Exact private commit-intent custody');digest=G.hash_file(path,m,65536);r,_=I.read_json(path,digest,limit=65536)
  need(r.get('schema')=='pow-audit30-exact-sixteen-write-commit-intent-v1'and r.get('environment')=='privateclone'and r.get('operation')==operation and r.get('manifestSHA256')==MANIFEST_SHA and r.get('targetCount')==16 and r.get('transactionId')==observed[index]['transactionId']and r.get('automaticRetry')is False,'Bound acknowledged commit intent');journal.append(r)
 need(journal[0].get('beforeMail')==journal[1].get('afterMail')and journal[0].get('afterMail')==journal[1].get('beforeMail'),'Full all-network mailbox fingerprint not restored across two commits')
 for r in journal:
  for n in('beforeMail','afterMail'):
   f=r[n];need(set(f)=={'count','logical_bytes','sha256'}and type(f['count'])is int and 0<=f['count']<=20000 and isinstance(f['logical_bytes'],str)and re.fullmatch('0|[1-9][0-9]*',f['logical_bytes'])and int(f['logical_bytes'])<=256*1024**2 and S.SHA.fullmatch(f['sha256']),'Exact full mailbox fingerprint shape')
 return v
def execute(p,h):
 runtime(p);oldp=completed_lineage();validate(p);original,inv,sealed=C.package(oldp);C.previous(original);C.previous_completion();C.inputs(oldp);math_proof(p);base,deps=package(p,original);control=S.clone_stopped(JOB,inv['previousUnit'],True);S.unchanged(inv);S.check_window(p);G.check_live(p);G.storage_sample(JOB)
 need(not os.path.lexists(WORK)and not os.path.lexists(JOB/'exact-sixteen-write-proof-v1-postgres.log'),'New exact-sixteen evidence required');lock=I.acquire_backup_lock(p['backupLock'],pwd.getpwnam('postgres'));watch=pid=None;start=False;phase='admission';started=time.monotonic();oldhandlers={s:signal.signal(s,lambda *_:(_ for _ in()).throw(PrivateProofInterrupted('Private exact-sixteen proof interrupted')))for s in(signal.SIGINT,signal.SIGTERM,signal.SIGHUP)}
 try:
  WORK.mkdir(mode=0o700);C.N.C.sync_parent(WORK);watch=G.Watchdog(WORK,sample=lambda _:G.storage_sample(JOB));watch.start();runner=I.DeadlineRunner(I.BoundedRunner(WORK,watch,started),900)
  def heartbeat():watch.assert_alive();need(time.monotonic()-started<=900,'Private proof15min deadline')
  I.verify_source(sealed,heartbeat,rehash=True);runtime(p);G.check_live(p);S.check_window(p);math_proof(p);need(package(p,original)[1]==deps,'Dependencies before private start changed');G.durable(WORK/'supervisor-intent.json',dict(schema=SCHEMA,plan=p,planSha256=h,streamCompletedSha256=COMPLETION_PINS['completed.json'],mathCompletedSha256=p['mathProof']['sha256'],sealedSourceFullHashVerifiedBeforeStart=True,productionMutation=False,sealedSourceStartAllowed=False))
  phase='private-start';start=True;runner.run([str(G.BIN/'pg_ctl'),'-D',str(JOB/'cluster'),'-o','-c config_file='+str(JOB/'inspection-postgresql.conf'),'-l',str(JOB/'exact-sixteen-write-proof-v1-postgres.log'),'-w','-t','30','start'],phase,timeout=40);pid=G.private_postmaster(JOB)
  need(G.query(runner,JOB,I.FENCE_SQL,'exact-sixteen-fence-before')==inv['snapshot'],'Saved snapshot fence before write changed');before=G.allocation(JOB);native_started=time.monotonic();phase='acknowledged-apply-and-separate-inverse';raw=I.DeadlineRunner(runner,120).run([str(I.NODE),'--max-old-space-size=128',str(base/'adapter.mjs'),ADAPTER_SHA,p['adapterAdmissionSha256'],original['phase4']['pgEntrySha256']],phase,maximum=65536);v=proof_result(json.loads(raw,object_pairs_hook=I.pairs),p,base);need(time.monotonic()-native_started<=120 and 0<=G.allocation(JOB)-before<=512*1024**2,'Private writer time/allocation bound');need(G.query(runner,JOB,I.FENCE_SQL,'exact-sixteen-fence-after')==inv['snapshot'],'Immutable saved snapshot after inverse changed')
  phase='private-stop';G.stop_private(JOB,pid);pid=None;stopped=S.clone_stopped(JOB,inv['previousUnit'],True);need(stopped['systemIdentifier']==control['systemIdentifier'],'Private stopped system ID changed');phase='offline-private-page-check';runner.run([str(G.BIN/'pg_checksums'),'--check','-D',str(JOB/'cluster')],phase,timeout=120,maximum=65536)
  phase='sealed-source-final-hash';I.verify_source(sealed,heartbeat,rehash=True);completed_lineage();C.previous(original);C.previous_completion();C.inputs(oldp);math_proof(p);S.unchanged(inv);G.check_live(p);runtime(p);need(package(p,original)[1]==deps and G.metadata(G.LOCK)==p['backupLock'],'Final code/dependency/lock drift');S.check_window(p);heartbeat();storage=G.storage_sample(JOB);watch.stop();watch=None
  G.durable(WORK/'supervisor-completed.json',dict(schema='pow-audit30-private-sixteen-supervision-completed-v1',status='passed',planSha256=h,adapterProof=v,crossTransactionFullMailFingerprintRestored=True,streamCompletedSha256=COMPLETION_PINS['completed.json'],mathCompletedSha256=p['mathProof']['sha256'],sealedSourceFullHashVerifiedBeforeStart=True,sealedSourceFullHashVerifiedAtStop=True,privateClusterStopped=True,offlinePrivatePagesChecked=True,liveServicesUnchanged=True,backupWindowRecheckedAtStop=True,productionMutation=False,sealedSourceStarted=False,sourceAndAllEvidenceRetained=True,automaticRetry=False,operationalReadinessTwoLegitimateInvalidations=True,operationalEpochRewind=False,wholeSeconds=time.monotonic()-started,storage=storage))
 except BaseException as exc:
  for s in oldhandlers:signal.signal(s,signal.SIG_IGN)
  errors=[];stopped=not start
  if start:
   try:G.stop_private(JOB,pid);stopped=True
   except BaseException as e:errors.append(dict(phase='private-stop',errorClass=type(e).__name__))
  if watch:
   try:watch.stop()
   except BaseException as e:errors.append(dict(phase='watchdog-stop',errorClass=type(e).__name__))
  if WORK.is_dir():
   try:G.durable(WORK/'supervisor-failed.json',dict(schema='pow-audit30-private-sixteen-supervision-failed-v1',status='failed',phase=phase,errorClass=type(exc).__name__,privateStopVerified=stopped,cleanupErrors=errors,productionMutation=False,automaticRetry=False,acknowledgedApplyMayRemain=True,unknownCommitRequiresExplicitReconciliation=True))
   except BaseException as r:raise RuntimeError('Private proof failure receipt unavailable: '+type(exc).__name__+'/'+type(r).__name__)from exc
  raise
 finally:
  os.close(lock)
  for s,handler in oldhandlers.items():signal.signal(s,handler)
def main():
 os.umask(0o077);load();completed_lineage();a=argparse.ArgumentParser();a.add_argument('--plan',required=True);a.add_argument('--plan-sha256',required=True);args=a.parse_args();path=G.canonical_path(args.plan);m=G.metadata(path);need(m['uid']==0 and m['mode']==0o440 and m['nlink']==1 and m['bytes']<=65536,'Managed private credential custody');raw=path.read_bytes();need(G.metadata(path)==m and sha(raw)==args.plan_sha256,'Credential bytes changed');p=validate(json.loads(raw,object_pairs_hook=I.pairs));G.validate_managed_credential(path,p['unit'],'private-sixteen-plan',Path(__file__).parent/'reviewed-plan.json');need(G.metadata(path)==m and sha(path.read_bytes())==args.plan_sha256,'Credential namespace drift');execute(p,args.plan_sha256)
if __name__=='__main__':
 try:main()
 except BaseException as e:print(json.dumps(dict(status='refused',errorClass=type(e).__name__,rawDetailsSuppressed=True,productionMutation=False,automaticRetry=False),sort_keys=True),file=sys.stderr);sys.exit(1)
