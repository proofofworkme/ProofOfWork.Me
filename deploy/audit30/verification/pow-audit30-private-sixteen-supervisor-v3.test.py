#!/usr/bin/python3 -I
import copy,datetime as dt,hashlib,importlib.util,json,os,signal,subprocess,sys,tempfile,time,types,unittest
from pathlib import Path
from contextlib import ExitStack
from unittest.mock import patch
def imported(name,path):
 s=importlib.util.spec_from_file_location(name,path);m=importlib.util.module_from_spec(s);s.loader.exec_module(m);return m
P=imported('private_supervisor','/tmp/pow-audit30-private-sixteen-supervisor-v3.py')
T=imported('oldfixtures','/tmp/pow-audit30-stream-complete-retained-v5.test.py')
class Tests(unittest.TestCase):
 @classmethod
 def setUpClass(cls):
  T.Tests.setUpClass();P.C=T.C;P.S=T.C.S;P.I=T.C.I;P.G=T.C.G;P.COMPLETION_PLAN=json.loads(Path('/tmp/pow-audit30-retained-completion-plan-064500-v2.json').read_bytes())
 @classmethod
 def tearDownClass(cls):T.Tests.tearDownClass()
 def setUp(self):self.tmp=tempfile.TemporaryDirectory();self.base=Path(self.tmp.name)
 def tearDown(self):self.tmp.cleanup()
 def plan(self):
  old=copy.deepcopy(P.COMPLETION_PLAN);now=dt.datetime.now(dt.timezone.utc);m=old['backupLock']
  return dict(schema=P.SCHEMA,approvalSha256=P.APPROVAL,controllerSha256='a'*64,host='pow-bitcoin-01',runId='20261003T070000Z',unit='proofofwork-audit30-private-sixteen-20261003T070000Z.service',job=str(P.JOB),sealedSource=str(P.SOURCE),backupLock=m,backupWindow=dict(preflightAtUtc=now.isoformat(),nextScheduledAtUtc=(now+dt.timedelta(hours=8)).isoformat()),liveServices=old['liveServices'],node=dict(metadata=m|dict(mode=0o755,uid=0,bytes=10),sha256='a'*64),adapterAdmissionSha256='b'*64,mathProof=dict(path=str(P.MATH),metadata=m|dict(uid=0,gid=0,bytes=1),sha256='c'*64),mathAccounting=copy.deepcopy(P.MATH_ACCOUNTING))
 def test_only_exact_private_scope_and_fields(self):
  P.validate(self.plan())
  for k,v in [('job','/var/lib/postgresql/16/main'),('sealedSource',str(P.JOB)),('unit','postgresql@16-main.service'),('approvalSha256','0'*64),('host','other')]:
   p=self.plan();p[k]=v
   with self.subTest(k=k),self.assertRaises(ValueError):P.validate(p)
  p=self.plan();p['productionApplyApproved']=True
  with self.assertRaises(ValueError):P.validate(p)
 def test_pending_math_wrongpath_weakmode_and_link_refuse(self):
  for k,v in [('path','/tmp/fake'),('sha256','PENDING')]:
   p=self.plan();p['mathProof'][k]=v
   with self.subTest(k=k),self.assertRaises(ValueError):P.validate(p)
  for k,v in [('uid',108),('gid',112),('mode',0o644),('nlink',2),('bytes',1024**2+1),('inode',True)]:
   p=self.plan();p['mathProof']['metadata'][k]=v
   with self.subTest(k=k),self.assertRaises(ValueError):P.validate(p)
 def test_node_wrong_role_mode_link_or_negative_refuse(self):
  for k,v in [('uid',108),('mode',0o644),('nlink',2),('bytes',-1),('inode',True)]:
   p=self.plan();p['node']['metadata'][k]=v
   with self.subTest(k=k),self.assertRaises(ValueError):P.validate(p)
 def admission(self):
  a=json.loads(Path('/tmp/pow-audit30-private-sixteen-write-admission-template-v1.json').read_bytes());a['readinessClosureSHA256']=P.CLOSURE_SHA;return a
 def test_actual_template_requires_private_closure_and_identity(self):
  a=self.admission();targets=[dict(txid=f'{i:064x}')for i in range(16)];hashset=P.sha(P.encoded([t['txid']for t in targets]));a['targetTxidSetSHA256']=hashset
  # Fixture uses an explicit alternate immutable ordered targetset pin.
  with patch.object(P,'TARGETS_SHA',hashset):
   self.assertEqual(P.private_admission(a,targets),a)
   with self.assertRaises(ValueError):P.private_admission(a,list(reversed(targets)))
   for k,v in [('environment','production'),('operation','inverse'),('productionApplyApproved',True),('readinessClosureSHA256','0'*64),('approvalReceiptSHA256','a'*64),('priorAcknowledgedApplyReceiptSHA256','a'*64)]:
    b=copy.deepcopy(a);b[k]=v
    with self.subTest(k=k),self.assertRaises(ValueError):P.private_admission(b,targets)
 def test_portable_closure_ignores_only_relocation_metadata(self):
  a=dict(records=[dict(path='.',kind='directory',metadata=dict(mode=0o750,inode=1)),dict(path='pg/lib/index.js',kind='file',metadata=dict(mode=0o440,bytes=3,inode=2),sha256='a'*64)])
  b=copy.deepcopy(a);b['records'][0]['metadata']['inode']=42;b['records'][1]['metadata']['inode']=43
  self.assertEqual(P.portable(a),P.portable(b));b['records'][1]['sha256']='0'*64;self.assertNotEqual(P.portable(a),P.portable(b))
 def math(self):
  q=dict(schema='pow-audit30-onhost-sampled-historical-math-result-v1',status='passed',rows=3,sampleHeights=[960600,960601,969526],nativeUid=108,nativeGid=112,sourceFenceSHA256=P.SOURCE_FENCE_SHA,sourceCopyManifestSHA256=P.SOURCE_COPY_MANIFEST_SHA,numericVerification=[dict(height=h)for h in [960600,960601,969526]],productionMutation=False,sourceSha256=P.C.SOURCE_SHA,reconstructedSha256=P.C.SOURCE_SHA)
  for k in('sourceCopyFullyVerifiedBeforeAndAfter','allColumnBytesExact','storedDeclarationAndMarkerBound','exactV6ToV8SoleTokenOpeningRebind','holderConversionBigIntExact','markerBeforeAfterAndRelicCommitmentsExact','publicOutputContainsOnlyCountsHashesNumbersAndFixedEnums'):q[k]=True
  return dict(schema='pow-audit30-onhost-math-managed-completed-completion-v2',status='passed',cleanup=dict(verified=True),wholeCandidateUnchanged=True,privateClusterStillStopped=True,productionMutation=False,privatePayloadExported=False,result=q)
 def test_math_completion_flags_and_source_required(self):
  p=self.plan();v=self.math()
  readable=self.base/'sample-math-completed.json';readable.write_bytes(b'x');readable.chmod(0o440)
  with patch.object(P,'__file__',str(self.base/'controller.py')),patch.object(P.G,'canonical_path',side_effect=lambda p:p),patch.object(P.G,'metadata',return_value=p['mathProof']['metadata']|{'gid':112,'mode':0o440}),patch.object(P.I,'read_json',side_effect=lambda *a,**k:(v,{})):
   P.math_proof(p)
   for target,k,x in [(v,'privateClusterStillStopped',False),(v['cleanup'],'verified',False),(v,'productionMutation',True),(v['result'],'rows',2),(v['result'],'sourceSha256','0'*64),(v['result'],'holderConversionBigIntExact',False)]:
    old=target[k];target[k]=x
    with self.subTest(k=k),self.assertRaises(ValueError):P.math_proof(p)
    target[k]=old
 def test_actual_completion_rawhash_canonical_plan_and_stop_flags(self):
  p=copy.deepcopy(P.COMPLETION_PLAN);i=dict(plan=p,planSha256=P.COMPLETION_PLAN_SHA);d=dict(schema='pow-audit30-complete-retained-private-stream-completed-v1',status='passed',planSha256=P.COMPLETION_PLAN_SHA)
  for k in('originalAttemptRemainsFailed','priorCompletionRemainsFailed','bodyAll16Accepted','freshCurrentSideByteEquality','fullNativeByteEquality','privateClusterStopped','liveServicesUnchanged','sealedSourceFullHashVerifiedBeforeStart','sealedSourceFullHashVerifiedAtStop','backupWindowRecheckedAtStop'):d[k]=True
  for k in('bodyRedo','newSchemaWrite','productionMutation','sealedSourceStarted','mathAccepted','allHistoricalReplay'):d[k]=False
  proofs={'intent.json':i,'completed.json':d}
  with patch.object(P.I,'read_json',side_effect=lambda path,*a,**kw:(proofs[Path(path).name],{})):
   self.assertEqual(P.completed_lineage(),p)
   for k in('privateClusterStopped','sealedSourceFullHashVerifiedAtStop','fullNativeByteEquality'):
    d[k]=False
    with self.subTest(k=k),self.assertRaises(ValueError):P.completed_lineage()
    d[k]=True
   p['unit']='other.service'
   with self.assertRaises(ValueError):P.completed_lineage()
 def test_public_math_read_uses_staged_copy_not_root_private_origin(self):
  p=self.plan();v=self.math();readable=self.base/'sample-math-completed.json';readable.write_bytes(b'x');readable.chmod(0o440);calls=[]
  with patch.object(P,'__file__',str(self.base/'controller.py')),patch.object(P.G,'canonical_path',side_effect=lambda path:path),patch.object(P.G,'metadata',return_value=p['mathProof']['metadata']|{'gid':112,'mode':0o440}),patch.object(P.I,'read_json',side_effect=lambda path,*a,**k:calls.append(Path(path))or(v,{})):P.math_proof(p)
  self.assertEqual(calls,[readable]);self.assertNotIn(P.MATH,calls)
 def test_staged_math_wrong_permissions_owner_link_and_size_refuse_before_read(self):
  p=self.plan();readable=self.base/'sample-math-completed.json';readable.write_bytes(b'x');readable.chmod(0o440);good=p['mathProof']['metadata']|{'gid':112,'mode':0o440}
  for key,value in [('uid',108),('gid',0),('mode',0o600),('nlink',2),('bytes',2)]:
   with self.subTest(key=key),patch.object(P,'__file__',str(self.base/'controller.py')),patch.object(P.G,'canonical_path',side_effect=lambda path:path),patch.object(P.G,'metadata',return_value=good|{key:value}),patch.object(P.I,'read_json')as read,self.assertRaises(ValueError):P.math_proof(p)
   read.assert_not_called()
 def proof_fixture(self):
  targets=[dict(txid=f'{i:064x}')for i in range(16)];hashset=P.sha(P.encoded([t['txid']for t in targets]));a=self.admission();a['targetTxidSetSHA256']=hashset;p=self.plan();p['adapterAdmissionSha256']=P.sha(P.encoded(a));receipts={}
  make=lambda operation,xid:dict(schema='pow-audit30-exact-sixteen-write-completed-v1',status='committed',operation=operation,environment='privateclone',originalPlanSHA256=P.PRIVATE_PLAN_SHA,manifestSHA256=P.MANIFEST_SHA,engineSHA256=P.LIBRARY_SHA,targetCount=16,bodyOnly=True,allTransactionNonbodyAndNontargetRowsUnchanged=True,commitAcknowledged=True,queueFlushedBeforeCommit=True,productionMutation=False,automaticRetry=False,operationalEpochRewind=False,orderedTargetTxids=[t['txid']for t in targets],expectedDatabaseIdentity=a['expectedDatabaseIdentity'],transactionId=str(xid),operationalShard=xid%64,operationalEpochBefore='2',operationalEpochAfter='3')
  apply=make('apply',128001);apply['admissionSHA256']=p['adapterAdmissionSha256'];ah=P.sha(P.encoded(apply));inverse=make('inverse',128002);inverse['admissionSHA256']=P.sha(P.encoded(a|{'operation':'inverse','priorAcknowledgedApplyReceiptSHA256':ah}));ih=P.sha(P.encoded(inverse))
  receipts.update({'apply-completed.json':apply,'inverse-completed.json':inverse,'phase4-private-plan.json':{'targets':targets},'private-sixteen-write-admission.json':a})
  before=dict(count=619,logical_bytes='12000000',sha256='1'*64);after=before|{'sha256':'2'*64}
  for operation,r,b,f in [('apply',apply,before,after),('inverse',inverse,after,before)]:receipts[operation+'-commit-intent.json']=dict(schema='pow-audit30-exact-sixteen-write-commit-intent-v1',environment='privateclone',operation=operation,manifestSHA256=P.MANIFEST_SHA,targetCount=16,transactionId=r['transactionId'],automaticRetry=False,beforeMail=b,afterMail=f)
  v=dict(schema='pow-audit30-private-exact-sixteen-commit-inverse-proof-v1',status='passed',privateJob=str(P.JOB),originalPlanSHA256=P.PRIVATE_PLAN_SHA,manifestSHA256=P.MANIFEST_SHA,librarySHA256=P.LIBRARY_SHA,ea56SHA256=P.BODY_SHA,originalEngineSHA256=P.ORIGINAL_ENGINE_SHA,admissionSHA256=p['adapterAdmissionSha256'],targetCount=16,forwardCommitAcknowledged=True,separateInverseCommitAcknowledged=True,bodyPreimagesRestored=True,nonbodyNontargetUnchangedInEachTransaction=True,readinessInvalidationPerCommittedTransaction=True,operationalEpochRewind=False,source7Accessed=False,productionMutation=False,productionApplyApproved=False,liveApproval=False,newCoreReplayClaimed=False,automaticRetry=False,applyReceiptSHA256=ah,inverseReceiptSHA256=ih)
  receipts['proof-completed.json']=v
  return p,v,receipts,hashset
 def checked_proof(self,p,v,receipts,hashset):
  def read(path,h,**kw):
   name=Path(path).name;r=receipts[name]
   if name not in('phase4-private-plan.json',):self.assertEqual(P.sha(P.encoded(r)),h)
   return r,{}
  with patch.object(P,'TARGETS_SHA',hashset),patch.object(P.I,'read_json',side_effect=read),patch.object(P.G,'metadata',return_value=dict(uid=108,gid=112,mode=0o600,nlink=1,bytes=100)),patch.object(P.G,'hash_file',side_effect=lambda path,*a:P.sha(P.encoded(receipts[Path(path).name]))):return P.proof_result(v,p,self.base)
 def test_genuine_separate_acknowledged_receipts_and_full_mail_restore(self):
  p,v,r,h=self.proof_fixture();self.assertEqual(self.checked_proof(p,v,r,h),v)
 def test_missing_acknowledgement_wrong_identity_or_targetset_refuse(self):
  for key,new in [('commitAcknowledged',False),('productionMutation',True),('expectedDatabaseIdentity',{}),('orderedTargetTxids',[]),('operationalEpochAfter','4')]:
   p,v,r,h=self.proof_fixture();r['inverse-completed.json'][key]=new;v['inverseReceiptSHA256']=P.sha(P.encoded(r['inverse-completed.json']))
   with self.subTest(key=key),self.assertRaises(ValueError):self.checked_proof(p,v,r,h)
 def test_wrong_inverse_apply_binding_or_reusedtransaction_refuses(self):
  for key,new in [('admissionSHA256','0'*64),('transactionId','128001')]:
   p,v,r,h=self.proof_fixture();r['inverse-completed.json'][key]=new;v['inverseReceiptSHA256']=P.sha(P.encoded(r['inverse-completed.json']))
   with self.subTest(key=key),self.assertRaises(ValueError):self.checked_proof(p,v,r,h)
 def test_cross_transaction_nontarget_drift_refuses_despite_green_flags(self):
  p,v,r,h=self.proof_fixture();r['inverse-commit-intent.json']['afterMail']=r['inverse-commit-intent.json']['afterMail']|{'sha256':'3'*64}
  with self.assertRaisesRegex(ValueError,'not restored'):self.checked_proof(p,v,r,h)
 def test_invalid_full_fingerprint_bound_refuses(self):
  p,v,r,h=self.proof_fixture();r['inverse-commit-intent.json']['afterMail']['count']=True
  with self.assertRaises(ValueError):self.checked_proof(p,v,r,h)
 def execution(self,signal_kind=None,cleanup_errors=False,inverse_failure=False,timer_failure=False):
  job=self.base/'job';job.mkdir(mode=0o700);work=job/'exact-sixteen-write-proof-v1';lock=self.base/'lock';lock.touch(mode=0o600);p=self.plan();p['backupLock']=P.G.metadata(lock);inv=dict(previousUnit='prior.service',snapshot={'saved':True});calls=[];children=[];killers=[]
  class Watch:
   def __init__(self,*a,**kw):pass
   def start(self):calls.append('watch-start')
   def assert_alive(self):pass
   def stop(self):
    calls.append('watch-stop')
    if cleanup_errors:os.kill(os.getpid(),signal.SIGHUP);raise ValueError('watch-cleanup')
  class Runner:
   def __init__(self,*a):pass
   def run(_,argv,phase,**kw):
    calls.append((phase,argv,kw))
    if phase=='private-start'and signal_kind:
     ready=self.base/'ready';pidfile=self.base/'pid';code='import os,time;from pathlib import Path;Path('+repr(str(pidfile))+').write_text(str(os.getpid()));Path('+repr(str(ready))+').write_text("ready");time.sleep(30)';killer_code='import os,time,signal;from pathlib import Path;p=Path('+repr(str(ready))+');end=time.monotonic()+3\nwhile not p.exists() and time.monotonic()<end:time.sleep(.005)\nassert p.exists();os.kill('+str(os.getpid())+','+str(signal_kind)+')';killer=subprocess.Popen([sys.executable,'-I','-B','-c',killer_code]);killers.append(killer)
     try:return P.G.Runner(work,Watch(),time.monotonic()).run([sys.executable,'-I','-B','-c',code],phase,timeout=5)
     finally:
      if pidfile.exists():children.append(int(pidfile.read_text()))
    if phase=='acknowledged-apply-and-separate-inverse':
     if inverse_failure:raise RuntimeError('inverse-after-acknowledged-apply')
     return b'{}'
    return b''
  def stop(*a):
   calls.append('private-stop')
   if cleanup_errors:os.kill(os.getpid(),signal.SIGINT);raise ValueError('private-cleanup')
  def window(*a):
   calls.append('window')
   if timer_failure and calls.count('window')==3:raise ValueError('timer-drift')
  with ExitStack()as st:
   values=[(P,'JOB',job),(P,'WORK',work),(P,'runtime',lambda *_:None),(P,'completed_lineage',lambda *_:P.COMPLETION_PLAN),(P,'validate',lambda *_:None),(P,'math_proof',lambda *_:{}),(P,'package',lambda *_:(self.base,'deps')),(P,'proof_result',lambda v,*a:v),(P.C,'package',lambda *_:({'phase4':{'pgEntrySha256':'e'*64}},inv,{})),(P.C,'previous',lambda *_:None),(P.C,'previous_completion',lambda *_:None),(P.C,'inputs',lambda *_:None),(P.S,'clone_stopped',lambda *_:{'systemIdentifier':'one'}),(P.S,'unchanged',lambda *_:None),(P.S,'check_window',window),(P.G,'check_live',lambda *_:None),(P,'storage_sample',lambda *_:{}),(P.G,'LOCK',lock),(P,'allocation',lambda *_:100),(P.G,'Watchdog',Watch),(P.G,'private_postmaster',lambda *_:'pid'),(P.G,'stop_private',stop),(P.G,'query',lambda *_:inv['snapshot']),(P.I,'verify_source',lambda *a,**kw:calls.append('source-full')),(P.I,'acquire_backup_lock',lambda *_:os.open(lock,os.O_RDONLY)),(P.I,'BoundedRunner',Runner)]
   values.append((P.pwd,'getpwnam',lambda *_:types.SimpleNamespace(pw_uid=os.getuid(),pw_gid=os.getgid())))
   for target,name,value in values:st.enter_context(patch.object(target,name,value))
   old=signal.getsignal(signal.SIGTERM)
   if signal_kind:
    with self.assertRaises(P.PrivateProofInterrupted):P.execute(p,'a'*64)
   elif inverse_failure:
    with self.assertRaisesRegex(RuntimeError,'inverse-after'):P.execute(p,'a'*64)
   elif timer_failure:
    with self.assertRaisesRegex(ValueError,'timer-drift'):P.execute(p,'a'*64)
   else:P.execute(p,'a'*64)
   self.assertEqual(signal.getsignal(signal.SIGTERM),old)
  for killer in killers:self.assertEqual(killer.wait(timeout=2),0)
  for pid in children:
   with self.assertRaises(ProcessLookupError):os.kill(pid,0)
  return work,calls
 def test_success_requires_two_source_hashes_offline_pages_and_finalwindow(self):
  w,c=self.execution();v=json.loads((w/'supervisor-completed.json').read_bytes());self.assertTrue(v['crossTransactionFullMailFingerprintRestored']);self.assertTrue(v['offlinePrivatePagesChecked']);self.assertTrue(v['sealedSourceFullHashVerifiedAtStop']);self.assertFalse(v['productionMutation']);self.assertFalse(v['operationalEpochRewind']);self.assertEqual(c.count('source-full'),2);self.assertEqual(c.count('window'),3);argv=[r[1]for r in c if isinstance(r,tuple)and r[0]=='offline-private-page-check'][0];self.assertIn('--check',argv);self.assertIn(str(P.G.BIN/'pg_checksums'),argv)
 def test_inversefailure_preserves_acknowledged_apply_no_retry_or_autoinverse(self):
  w,c=self.execution(inverse_failure=True);v=json.loads((w/'supervisor-failed.json').read_bytes());self.assertTrue(v['acknowledgedApplyMayRemain']);self.assertTrue(v['unknownCommitRequiresExplicitReconciliation']);self.assertFalse(v['automaticRetry']);self.assertTrue(v['privateStopVerified']);self.assertFalse((w/'supervisor-completed.json').exists());self.assertEqual(sum(isinstance(r,tuple)and r[0]=='acknowledged-apply-and-separate-inverse'for r in c),1)
 def test_final_timer_drift_refuses_completion(self):
  w,c=self.execution(timer_failure=True);self.assertTrue((w/'supervisor-failed.json').exists());self.assertFalse((w/'supervisor-completed.json').exists())
 def test_actual_sigterm_blocking_frozenrunner_reaps_and_retainsfailure(self):
  w,c=self.execution(signal.SIGTERM);v=json.loads((w/'supervisor-failed.json').read_bytes());self.assertEqual(v['errorClass'],'PrivateProofInterrupted');self.assertTrue(v['privateStopVerified']);self.assertFalse(v['automaticRetry'])
 def test_actual_sigint_repeatedcleanup_signals_preserve_firstfailure(self):
  w,c=self.execution(signal.SIGINT,cleanup_errors=True);v=json.loads((w/'supervisor-failed.json').read_bytes());self.assertEqual(v['errorClass'],'PrivateProofInterrupted');self.assertEqual([r['phase']for r in v['cleanupErrors']],['private-stop','watchdog-stop']);self.assertFalse(v['privateStopVerified'])

 def test_exact_root_private_accounting_scope_cannot_change(self):
  p=self.plan();P.validate(p)
  for k,v in [('allocatedBytes',20813),('entries',4),('treeSha256','0'*64),('path','/data/other')]:
   p=self.plan();p['mathAccounting'][k]=v
   with self.subTest(k=k),self.assertRaises(ValueError):P.validate(p)
  p=self.plan();p['mathAccounting']['metadata']['inode']+=1
  with self.assertRaises(ValueError):P.validate(p)
 def test_real_gnu_du_exact_literal_plus_full_allocated_tree_includes_directories(self):
  job=self.base/'job';mathdir=job/'private-math';mathdir.mkdir(parents=True,mode=0o700);(mathdir/'completed').write_bytes(b'x'*8193);(mathdir/'empty-directory').mkdir();(job/'ordinary').write_bytes(b'y'*9000);near=job/'private-math-suffix';near.mkdir();(near/'included').write_bytes(b'z'*4097)
  amount=sum(x.lstat().st_blocks*512 for x in [mathdir,*mathdir.rglob('*')]);full=int(subprocess.check_output(['/usr/bin/du','-x','-s','-B1','--',str(job)]).split()[0]);commands=[]
  def command(argv,**kw):
   commands.append(argv);return subprocess.check_output(argv)
  with patch.object(P,'JOB',job),patch.object(P,'MATH_DIR',mathdir),patch.object(P,'MATH_ACCOUNTING',{'allocatedBytes':amount}),patch.object(P,'math_directory_fence'),patch.object(P.G,'command',side_effect=command):self.assertEqual(P.allocation(job),full)
  self.assertEqual(commands,[['/usr/bin/du','-x','-s','-B1','--exclude='+str(mathdir),'--',str(job)]]);self.assertGreater(amount,8193);self.assertGreater(amount,mathdir.lstat().st_blocks*512)
 def test_wrong_job_refuses_before_any_du(self):
  with patch.object(P.G,'command')as cmd,self.assertRaises(ValueError):P.allocation('/data/another-job')
  cmd.assert_not_called()
 def test_other_du_failure_not_ignored_and_same_three_attempts(self):
  with patch.object(P,'math_directory_fence'),patch.object(P.G,'command',side_effect=RuntimeError('another unreadable path'))as cmd,patch.object(P.time,'sleep'),self.assertRaisesRegex(ValueError,'repeatedly failed'):P.allocation(P.JOB)
  self.assertEqual(cmd.call_count,3)
 def test_du_malformed_wrong_path_extra_rows_and_negative_refuse(self):
  for raw in [b'-1\t'+str(P.JOB).encode()+b'\n',b'3\t/elsewhere\n',b'3\t'+str(P.JOB).encode()+b'\nextra\n',b'3']:
   with self.subTest(raw=raw),patch.object(P,'math_directory_fence'),patch.object(P.G,'command',return_value=raw),patch.object(P.time,'sleep'),self.assertRaises(ValueError):P.allocation(P.JOB)
 def directory_fence(self,changed=None,readonly=True,readable=False):
  m=copy.deepcopy(P.MATH_ACCOUNTING['metadata']);d={k:v for k,v in m.items()if k!='allocatedBytes'}
  if changed:d[changed]+=1
  st=types.SimpleNamespace(st_mode=0o40700,st_blocks=m['allocatedBytes']//512)
  with patch.object(P.G,'canonical_path',return_value=P.MATH_DIR),patch.object(P.G,'metadata',return_value=d),patch.object(Path,'lstat',return_value=st),patch.object(P.os,'listxattr',return_value=[]),patch.object(P.os,'statvfs',return_value=types.SimpleNamespace(f_flag=os.ST_RDONLY if readonly else 0)),patch.object(P.os,'listdir',side_effect=None if readable else PermissionError(),return_value=[]):P.math_directory_fence()
 def test_math_directory_readonly_inaccessible_metadata_fences(self):
  self.directory_fence()
  for args in [dict(changed='inode'),dict(changed='ctimeNs'),dict(readonly=False),dict(readable=True)]:
   with self.subTest(args=args),self.assertRaises(ValueError):self.directory_fence(**args)
 def test_charged_allocation_still_enforces_80g_and_full_volume_reserves(self):
  GIB100=100*1024**3;data=types.SimpleNamespace(f_bavail=GIB100,f_frsize=1);root=types.SimpleNamespace(f_bavail=10*1024**3,f_frsize=1)
  with patch.object(P.os,'listdir',side_effect=PermissionError()),patch.object(P.os,'statvfs',side_effect=lambda path:data if path=='/data'else root),patch.object(P,'allocation',return_value=P.G.MAXIMUM):self.assertEqual(P.storage_sample(P.JOB)['rootPrivateMathAllocatedBytes'],28672)
  for used,df,rf in [(P.G.MAXIMUM+1,GIB100,10*1024**3),(0,GIB100-1,10*1024**3),(0,GIB100,10*1024**3-1)]:
   data.f_bavail=df;root.f_bavail=rf
   with self.subTest(used=used,df=df,rf=rf),patch.object(P.os,'listdir',side_effect=PermissionError()),patch.object(P.os,'statvfs',side_effect=lambda path:data if path=='/data'else root),patch.object(P,'allocation',return_value=used),self.assertRaises(ValueError):P.storage_sample(P.JOB)
 def test_namespace_readability_still_refuses_before_du(self):
  with patch.object(P.os,'listdir',return_value=[]),patch.object(P,'allocation')as a,self.assertRaisesRegex(ValueError,'namespace'):P.storage_sample(P.JOB)
  a.assert_not_called()

if __name__=='__main__':unittest.main()
