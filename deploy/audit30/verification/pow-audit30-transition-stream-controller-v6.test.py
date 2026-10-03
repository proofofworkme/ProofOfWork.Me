#!/usr/bin/python3 -I
import copy,datetime as dt,hashlib,importlib.util,json,os,pwd,signal,struct,tempfile,time,unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch
P=Path('/tmp/pow-audit30-transition-stream-controller-v6.py');s=importlib.util.spec_from_file_location('streamfollowup',P);S=importlib.util.module_from_spec(s);s.loader.exec_module(S)
class Tests(unittest.TestCase):
 def setUp(self):
  self.tmp=tempfile.TemporaryDirectory();self.base=Path(self.tmp.name);self.uid=os.getuid();self.gid=os.getgid();self.who=SimpleNamespace(pw_uid=self.uid,pw_gid=self.gid)
  for name,h in S.PINS.items():
   original=Path('/home/sixer/ProofOfWork.Me/deploy/audit30')/name if name=='restore-latest-logical.py' else Path('/tmp')/name
   target=self.base/name;target.write_bytes(original.read_bytes());target.chmod(0o600);self.assertEqual(hashlib.sha256(target.read_bytes()).hexdigest(),h)
  self.modulepath=patch.object(S,'__file__',str(self.base/'controller.py'));self.modulepath.start();self.addCleanup(self.modulepath.stop);S.load()
 def tearDown(self):self.tmp.cleanup()
 def plan(self):
  now=dt.datetime.now(dt.timezone.utc);lock=self.base/'backup.lock'
  if not lock.exists():lock.touch(mode=0o600)
  return dict(schema=S.SCHEMA,approvalSha256=S.APPROVAL,controllerSha256='a'*64,host='node',runId='20261003T020000Z',unit='proofofwork-audit30-transition-stream-20261003T020000Z.service',job='/data/proofofwork-audit30-inspect-20261003T014100Z',sealedSource='/data/proofofwork-audit30-restore-20261002T234651Z',inventory=dict(fileName='stopped-clone-inventory.json',sha256='a'*64),backupLock=S.G.metadata(lock),backupWindow=dict(preflightAtUtc=now.isoformat(),nextScheduledAtUtc=(now+dt.timedelta(minutes=90)).isoformat()),liveServices={n:dict(MainPID='5',InvocationID='b'*32)for n in S.G.SERVICES},envelope=S.N.C.DEFAULT,priorAdmission=dict(kind='exact-before-mail-write-trigger-refusal',fileName='prior-clone-admission.json',sha256='e'*64),phase4=dict(privatePlanSha256=S.PRIVATE_PLAN_SHA,dependencyInventorySha256='f'*64,pgEntrySha256='a'*64,node={'metadata':{},'sha256':'b'*64},readinessAdmissionSha256='c'*64))
 def proofs(self,change=None):
  job=self.base/'oldjob';job.mkdir(mode=0o700);original=dict(job=str(job),unit='proofofwork-audit30-snapshot-inspect-20261003T014100Z.service',controllerSha256=S.PINS['pow-audit30-saved-snapshot-inspect-v2.py'],source=self.plan()['sealedSource']);digest=S.I.digest(original);cp=dict(canonicalBlock=dict(height=969526,hash='a'*64),transitionMaxHeight=969526,transitionMaxHash='a'*64,precisionMarkerStatus='complete',precisionActivationHeight='960601');v={'intent.json':dict(plan=original,planSha256=digest),'completed.json':dict(schema='pow-audit30-private-inspection-completed-v1',status='passed',planSha256=digest,privateClusterStopped=True,sourceClusterUnchanged=True,liveServicesUnchanged=True,sourceAndJobRetained=True,productionDatabaseMutation=False),'query-captures.json':dict(phase4BodyRehearsal=dict(rollbackOnly=True),phase5Prototype=dict(completeSampleByteReconstruction=True)),'phase4-rehearsal-adapter.json':dict(rollbackOnly=True),'phase4-before-prototype.json':dict(savedFenceUnchanged=True),'phase5-native-prototype.json':dict(completeSampleByteReconstruction=True),'saved-snapshot-fence.json':dict(snapshot=cp,sourceEqualsCopy=True)}
  v['completed.json']['queryCapturesSha256']=hashlib.sha256(S.I.encoded(v['query-captures.json'])+b'\n').hexdigest()
  # G.durable has a known independent serializer; derive its actual emitted hash.
  for name,value in v.items():S.G.durable(job/name,value)
  qsha=S.G.hash_file(job/'query-captures.json');v['completed.json']['queryCapturesSha256']=qsha;(job/'completed.json').unlink();S.G.durable(job/'completed.json',v['completed.json'])
  if change:
   name,key,value=change;v[name][key]=value;(job/name).unlink();S.G.durable(job/name,v[name])
  for name,raw in S.configuration(job).items():(job/name).write_bytes(raw);(job/name).chmod(0o600)
  pins={n:S.G.hash_file(job/n)for n in S.PROOFS}
  with patch.object(S.pwd,'getpwnam',return_value=self.who),patch.object(S,'job_identity',return_value='20261003T014100Z'),patch.object(S.I,'validate_plan',side_effect=lambda x:x):result=S.files(job,pins)
  return job,pins,result
 def test_exact_default_clone_plan_never_live_or_restore(self):
  self.assertEqual(S.validate_plan(self.plan())['envelope'],S.N.C.DEFAULT)
  for key,value in [('job','/var/lib/postgresql/16/main'),('job','/data/proofofwork-audit30-restore-20261002T234651Z'),('sealedSource',self.plan()['job']),('unit','postgresql@16-main.service'),('approvalSha256','0'*64)]:
   p=self.plan();p[key]=value
   with self.subTest(key=key),self.assertRaises(ValueError):S.validate_plan(p)
  p=self.plan();p['envelope']=p['envelope']|{'sourceBytes':128*1024**2}
  with self.assertRaisesRegex(ValueError,'DEFAULT'):S.validate_plan(p)
 def test_partial_failed_currentlive_or_missing_phase_is_not_reusable(self):
  for item in [('completed.json','status','partial'),('completed.json','privateClusterStopped',False),('completed.json','sourceClusterUnchanged',False),('completed.json','productionDatabaseMutation',True),('completed.json','planSha256','0'*64),('phase4-rehearsal-adapter.json','rollbackOnly',False),('phase5-native-prototype.json','completeSampleByteReconstruction',False)]:
   with self.subTest(item=item),self.assertRaises(ValueError):self.proofs(item)
   (self.base/'oldjob').rename(self.base/('retained-'+item[0]+item[1]+str(item[2])))
 def test_completed_proof_config_and_originalsource_bound(self):
  job,pins,(rows,cp,sealed)=self.proofs();self.assertEqual(set(rows),set(S.PROOFS)|set(S.CONFIGS));self.assertEqual(sealed,self.plan()['sealedSource']);self.assertEqual(cp['transitionMaxHeight'],969526)
  with patch.object(S.pwd,'getpwnam',return_value=self.who),patch.object(S,'job_identity',return_value='20261003T014100Z'),patch.object(S.I,'validate_plan',side_effect=lambda x:x):
   for name in S.CONFIGS:
    old=(job/name).read_bytes();(job/name).write_bytes(old+b'listen_addresses = \'*\'\n')
    with self.assertRaises(ValueError):S.files(job,pins)
    (job/name).write_bytes(old)
   (job/'saved-snapshot-fence.json').write_bytes(b'{}')
   with self.assertRaises(ValueError):S.files(job,pins)
 def test_weak_symlink_hardlink_and_wrongowner_proof_refuse(self):
  job,pins,_=self.proofs();p=job/'phase4-before-prototype.json';old=p.read_bytes();p.chmod(0o644)
  with patch.object(S.pwd,'getpwnam',return_value=self.who),patch.object(S,'job_identity',return_value='20261003T014100Z'),patch.object(S.I,'validate_plan',side_effect=lambda x:x),self.assertRaises(ValueError):S.files(job,pins)
  p.chmod(0o600);outside=self.base/'outside';outside.write_bytes(old);p.unlink();p.symlink_to(outside)
  with self.assertRaises(ValueError):S.I.read_json(p,pins[p.name])
 def test_pinned_module_tamper_and_atime_only(self):
  p=self.base/'pow-audit30-transition-stream-native-v2.py';os.utime(p,ns=(1,p.stat().st_mtime_ns));S.module(p.name);p.write_text('raise RuntimeError("sentinel")')
  with self.assertRaisesRegex(ValueError,'source mismatch'):S.module(p.name)
 def test_exact_managed_unit_unchanged_hardening_and_sealedmount(self):
  p=self.plan();p['host']=os.uname().nodename;wanted={**S.G.UNIT_PROPERTIES,'RuntimeMaxUSec':'15min','ReadWritePaths':p['job'],'ReadOnlyPaths':str(S.G.BACKUPS)+' '+p['sealedSource'],'InaccessiblePaths':' '.join([*S.G.UNIT_INACCESSIBLE,p['sealedSource']+'/socket'])};read=Path.read_text
  def text(path,*args,**kwargs):return '0::/system.slice/'+p['unit'] if path==Path('/proc/self/cgroup')else read(path,*args,**kwargs)
  with patch.object(S.pwd,'getpwnam',return_value=self.who),patch.object(Path,'read_text',text),patch.object(S.os,'listdir',side_effect=PermissionError),patch.object(S.os,'statvfs',return_value=SimpleNamespace(f_flag=os.ST_RDONLY)):
   with patch.object(S.G,'system_properties',return_value=wanted):S.runtime(p)
   for key,value in [('PrivateNetwork','no'),('MemoryMax','17179869184'),('ReadWritePaths',p['job']+' '+p['sealedSource']),('ReadOnlyPaths',str(S.G.BACKUPS)),('RuntimeMaxUSec','2h')]:
    with self.subTest(key=key),patch.object(S.G,'system_properties',return_value=wanted|{key:value}),self.assertRaises(ValueError):S.runtime(p)
   with patch.object(S.G,'system_properties',return_value=wanted),patch.object(S.os,'statvfs',return_value=SimpleNamespace(f_flag=0)),self.assertRaises(ValueError):S.runtime(p)
 def failure_case(self,when,existing=False):
  p=self.plan();job=self.base/'runjob';job.mkdir(mode=0o700);p['job']=str(job);p['backupLock']=S.G.metadata(self.base/'backup.lock');calls=[];inv={'previousUnit':'old-inspection.service','priorAdmission':{'kind':'exact-before-mail-write-trigger-refusal','priorBodyInverseAccepted':False,'priorEagerPrototypeAccepted':False}}
  if existing:(job/'stream-existing').write_bytes(b'custody')
  class Watch:
   def __init__(self,*a,**k):pass
   def start(self):calls.append('watch-start')
   def assert_alive(self):pass
   def stop(self):calls.append('watch-stop');os.kill(os.getpid(),signal.SIGTERM);raise RuntimeError('watch cleanup refusal')
  class Runner:
   def __init__(self,*a,**k):pass
   def run(self,*a,**k):calls.append('start');raise ValueError('private start refused')
  def stop(*a):calls.append('private-stop');os.kill(os.getpid(),signal.SIGTERM);os.kill(os.getpid(),signal.SIGHUP);raise ValueError('stop failure')
  def unchanged(*a,**k):
   if when=='admission':raise ValueError('full clone fingerprint refusal')
  with patch.object(S,'checked_package',return_value=self.base),patch.object(S,'runtime'),patch.object(S,'check_window'),patch.object(S.G,'check_live'),patch.object(S.I,'read_json',return_value=(inv,{})),patch.object(S,'validate_inventory'),patch.object(S.G,'storage_sample',return_value={}),patch.object(S.pwd,'getpwnam',return_value=self.who),patch.object(S,'unchanged',side_effect=unchanged),patch.object(S.I,'acquire_backup_lock',side_effect=lambda *a:os.open(self.base/'backup.lock',os.O_RDONLY)),patch.object(S.G,'Watchdog',Watch),patch.object(S.I,'BoundedRunner',Runner),patch.object(S.G,'stop_private',side_effect=stop):
   before=signal.getsignal(signal.SIGTERM)
   with self.assertRaises(ValueError):S.execute(p,'a'*64)
   self.assertEqual(signal.getsignal(signal.SIGTERM),before)
  return job,calls
 def test_failed_full_admission_never_stops_preexisting_postmaster(self):
  job,calls=self.failure_case('admission');self.assertNotIn('private-stop',calls);self.assertNotIn('start',calls);result=json.loads((job/'stream-followup-v1/failed.json').read_bytes());self.assertFalse(result['intentCreated']);self.assertFalse(result['privateStopVerified']);self.assertFalse((job/'stream-followup-v1/completed.json').exists())
 def test_private_start_failure_cleanup_survives_repeated_signals(self):
  job,calls=self.failure_case('start');self.assertEqual(calls,['watch-start','start','private-stop','watch-stop']);result=json.loads((job/'stream-followup-v1/failed.json').read_bytes());self.assertTrue(result['intentCreated']);self.assertEqual(len(result['cleanupErrors']),2);self.assertFalse(result['privateStopVerified']);self.assertTrue((job/'stream-followup-v1/intent.json').exists());self.assertFalse((job/'stream-followup-v1/completed.json').exists())
 def test_existing_stream_evidence_refuses_before_lock_or_cleanup(self):
  job,calls=self.failure_case('admission',existing=True);self.assertEqual(calls,[]);self.assertEqual((job/'stream-existing').read_bytes(),b'custody');self.assertFalse((job/'stream-followup-v1').exists())
 def test_metadata_only_source_statement_is_fixed_full26_layout(self):
  self.assertIn("'typeOid',atttypid::integer",S.I.PROTOTYPE_CONTEXT_SQL);self.assertEqual(S.INCREMENTAL,512*1024**2);self.assertEqual(S.PROTO_RUNTIME,120);self.assertEqual(S.N.C.DEFAULT['sourceBytes'],64*1024**2)
 def failed_fixture(self,change=None):
  job=self.base/'failed-clone';job.mkdir(mode=0o700);original=dict(job=str(job),source=self.plan()['sealedSource'],controllerSha256=S.PINS['pow-audit30-saved-snapshot-inspect-v2.py'],inventory={'sha256':S.SOURCE_INV_SHA});si=dict(records=[],recordsSha256=S.I.digest([]),regularBytes=100,entries=1,snapshot=dict(transitionMaxHeight=969526),sourceControl={'systemIdentifier':'12345'})
  value={'intent.json':dict(plan=original,planSha256=S.I.digest(original)),'failed.json':dict(schema='pow-audit30-private-inspection-failed-v1',status='failed',phase='phase4-mail-body-rehearsal',errorClass='RuntimeError',planSha256=S.I.digest(original),cleanupErrors=[],privateStopVerified=True,productionDatabaseMutation=False,sourceUnchangedFullHashVerified=False,automaticRetry=False),'phase4-body-rehearsal-v1-failed.json':dict(schema='pow-audit30-private-mail-body-rehearsal-failed-v1',status='failed',phase='private-identity',errorCode='MAIL_WRITE_TRIGGER_REFUSED',rollbackAcknowledged=True,productionMutation=False,automaticRetry=False,manifestSHA256='c'*64),'phase4-body-rehearsal-v1-intent.json':dict(schema='pow-audit30-private-mail-rehearsal-intent-v1',privateJob=str(job),rollbackOnly=True,productionMutation=False,manifestSHA256='c'*64),'pre-start-copy-equivalence.json':dict(sourceInventorySha256=S.SOURCE_INV_SHA,sourceRecordsSha256=si['recordsSha256'],sourceRegularBytes=100,entries=1,fullCopyContentTypeModeOwnerMtimeEquality=True,sourceReadOnly=True,xattrsEmpty=True,copyEquivalenceSha256=S.I.copy_equivalence([],[])),'private-start-identity.json':dict(settings=dict(systemIdentifier='12345',dataDirectory=str(job/'cluster'),listenAddresses='',readOnly='on',checksums='on',socket=str(job/'socket'),port='55432')),'saved-snapshot-fence.json':dict(sourceEqualsCopy=True,snapshot=si['snapshot']),'phase5-row-size-preflight.json':dict(eligibleForExactFullSample=True),'id-before-capture.json':{},'id-after-capture.json':{},'relational-capture.json':{}}
  if change:value[change[0]][change[1]]=change[2]
  for name,v in value.items():S.G.durable(job/name,v)
  for name,raw in S.configuration(job).items():(job/name).write_bytes(raw);(job/name).chmod(0o600)
  review=dict(schema=S.REVIEW_SCHEMA,kind='exact-before-mail-write-trigger-refusal',approvalSha256=S.APPROVAL,job=str(job),sealedSource=original['source'],proofBindings={n:S.G.hash_file(job/n)for n in S.FAILED_PROOFS},sealedSourceInventorySha256=S.SOURCE_INV_SHA,priorBodyInverseAccepted=False,priorEagerPrototypeAccepted=False)
  with patch.object(S.pwd,'getpwnam',return_value=self.who),patch.object(S,'job_identity',return_value='20261003T014100Z'),patch.object(S.I,'validate_plan',side_effect=lambda x:x):result=S.failed_files(job,review,si)
  return job,review,si,result
 def test_exact_failed_before_write_refusal_admitted_as_failed_only(self):
  job,review,si,(proofs,cp,sealed)=self.failed_fixture();self.assertEqual(set(proofs),set(S.FAILED_PROOFS)|set(S.CONFIGS));self.assertEqual(cp,si['snapshot']);self.assertFalse(review['priorBodyInverseAccepted']);self.assertFalse(review['priorEagerPrototypeAccepted']);self.assertEqual(sealed,self.plan()['sealedSource'])
 def test_any_later_failed_phase_rollback_loss_cleanup_or_copy_drift_refuses(self):
  for i,x in enumerate([('phase4-body-rehearsal-v1-failed.json','phase','body-only-update'),('phase4-body-rehearsal-v1-failed.json','rollbackAcknowledged',False),('phase4-body-rehearsal-v1-failed.json','errorCode','UNREVIEWED_ERROR'),('failed.json','phase','phase5-native-prototype'),('failed.json','privateStopVerified',False),('failed.json','cleanupErrors',[{'error':'x'}]),('failed.json','sourceUnchangedFullHashVerified',True),('pre-start-copy-equivalence.json','sourceInventorySha256','0'*64),('pre-start-copy-equivalence.json','fullCopyContentTypeModeOwnerMtimeEquality',False),('saved-snapshot-fence.json','sourceEqualsCopy',False),('private-start-identity.json','settings',{'listenAddresses':'*'})]):
   with self.subTest(change=x),self.assertRaises(ValueError):self.failed_fixture(x)
   (self.base/'failed-clone').rename(self.base/('retained-failure-'+str(i)))
 def test_failure_admission_cannot_claim_prior_pass_or_unbound_source(self):
  job,review,si,result=self.failed_fixture()
  for key,value in [('priorBodyInverseAccepted',True),('priorEagerPrototypeAccepted',True),('sealedSourceInventorySha256','0'*64),('kind','generic-failed-clone'),('approvalSha256','0'*64)]:
   with self.subTest(key=key),patch.object(S,'job_identity',return_value='20261003T014100Z'),self.assertRaises(ValueError):S.admission(review|{key:value})
 def test_fresh_sealed_source_full_hash_runs_before_stopped_clone_hash(self):
  p=self.plan();v={'job':str(self.base/'clone'),'priorAdmission':{'kind':'x'},'sourceControl':{},'previousUnit':'old','postgresUid':self.uid,'postgresGid':self.gid,'records':[],'recordsSha256':'a'*64,'previousProofs':{},'snapshot':{},'sealedSource':p['sealedSource'],'physicalChangesSinceInitialCopy':S.physical_copy_changes([],[])};calls=[]
  with patch.object(S.I,'read_json',return_value=({'source':'sealed','records':[]},{})),patch.object(S,'outcome_files',return_value=({}, {},p['sealedSource'])),patch.object(S.I,'verify_source',side_effect=lambda *a,**k:calls.append(('sealed',k.get('rehash')))),patch.object(S,'clone_stopped',return_value={}),patch.object(S.I,'inventory_tree',side_effect=lambda *a,**k:(calls.append(('clone',True))or {'recordsSha256':'a'*64})):
   S.unchanged(v,full=True)
  self.assertEqual(calls,[('sealed',True),('clone',True)])

 def test_post_start_physical_changes_keep_runtime_separate_from_heap_drift(self):
  def row(path,h):return dict(path=path,kind='file',sha256=h,metadata=dict(mode=0o600,uid=108,gid=112,mtimeNs=1,bytes=8192))
  a=[row('global/pg_control','a'*64),row('base/123/456','b'*64)]
  b=[row('global/pg_control','c'*64),row('base/123/456','b'*64)]
  v=S.physical_copy_changes(a,b);self.assertEqual(v['unexplainedChangeCount'],0);self.assertFalse(v['currentCloneBytesEqualOriginalSource']);self.assertEqual(v['changes'][0]['classification'],'known-pg-runtime-file')
  b[1]['sha256']='d'*64;v=S.physical_copy_changes(a,b);self.assertEqual(v['unexplainedChangeCount'],1);self.assertEqual(v['changes'][0]['classification'],'unexplained-data-or-identity-change')
 def test_physical_type_mode_owner_drift_never_waived(self):
  a=[dict(path='base/123/456',kind='file',sha256='a'*64,metadata=dict(mode=0o600,uid=108,gid=112,mtimeNs=1,bytes=8192))]
  for change in [dict(uid=0),dict(mode=0o644),dict(bytes=100)]:
   b=copy.deepcopy(a);b[0]['metadata'].update(change);self.assertEqual(S.physical_copy_changes(a,b)['unexplainedChangeCount'],1)
  a[0]['path']='global/pg_control';b=copy.deepcopy(a);b[0]['metadata']['uid']=0;self.assertEqual(S.physical_copy_changes(a,b)['unexplainedChangeCount'],1)

 def test_exact_sixteen_body_plan_and_actual_closure_admission(self):
  p=self.plan();private=dict(schema='pow-audit30-mail-body-private-rehearsal-plan-v1',manifestSHA256=S.MANIFEST_SHA,targets=[{'txid':f'{i:064x}'}for i in range(1,17)])
  a=json.loads(Path('/tmp/pow-audit30-mail-readiness-admission-v2-template.json').read_bytes());p['phase4']['readinessAdmissionSha256']=S.sha(S.encoded(a))
  with patch.object(S.I,'read_json',side_effect=lambda path,*args,**kw:(private if Path(path).name=='phase4-private-plan.json'else a,{})):
   self.assertEqual(S.body_authority(self.base,p),(private,a))
   for k,v in [('closureSHA256','f'*64),('canonicalAssertionAccepted',False),('productionApplyApproved',True),('evidenceDirectory',p['job']),('originalEngineSHA256',S.PHASE4_ENGINE_SHA)]:
    bad=a|{k:v};q=copy.deepcopy(p);q['phase4']['readinessAdmissionSha256']=S.sha(S.encoded(bad))
    with self.subTest(key=k),patch.object(S.I,'read_json',side_effect=lambda path,*args,**kw:(private if Path(path).name=='phase4-private-plan.json'else bad,{})),self.assertRaises(ValueError):S.body_authority(self.base,q)
  q=copy.deepcopy(p);q['phase4']['privatePlanSha256']='0'*64
  with self.assertRaises(ValueError):S.validate_plan(q)
 def body_fixture(self,changes=None):
  p=self.plan();job=self.base/'body-job';job.mkdir(mode=0o700);work=job/'stream-followup-v1';work.mkdir(mode=0o700);p['job']=str(job);private=dict(manifestSHA256=S.MANIFEST_SHA,targets=[dict(txid=f'{i:064x}')for i in range(1,17)]);a={};cp={'snapshot':'saved'};v={'snapshot':cp}
  r=dict(schema='pow-audit30-private-mail-body-rehearsal-completed-v2',status='passed',originalPlanSHA256=p['phase4']['privatePlanSha256'],originalEngineSHA256=S.ORIGINAL_ENGINE_SHA,engineSHA256=S.PHASE4_ENGINE_SHA,admissionSHA256=p['phase4']['readinessAdmissionSha256'],canonicalReadinessClosureSHA256=S.CLOSURE_SHA,manifestSHA256=S.MANIFEST_SHA,manifestTargetCount=16,selectedCloneTargetCount=16,selectedTxids=[t['txid']for t in private['targets']],missingCloneCandidateCount=0,missingCloneCandidateTxids=[],exactInverseBodySqlExercised=True,allFourNativeFingerprintsRestored=True,rollbackAcknowledged=True,privateOriginalRowsRestored=True,allCloneNonbodyAndNontargetRowsUnchanged=True,productionMutation=False,productionApplyApproved=False,cloneSubsetQualified=True,sourceCoreProofConsumedFromCapture=True,newCoreReplayClaimed=False,namedDeferredConstraintExercised=True,singleQueuedTransactionObserved=True,exactOneShardIncrementObserved=True,readinessAffectedShard=3,readinessEpochBefore='999999999999999',readinessEpochAfter='1000000000000000',baselineNativeFingerprints={k:dict(count=0 if k=='queue' else 64 if k=='shards' else 100,logical_bytes='1000',sha256='e'*64)for k in ['mail','meta','queue','shards']})
  if changes:r.update(changes)
  S.G.durable(work/'phase4-body-rehearsal-v2-completed.json',r)
  class Runner:
   def __init__(self):self.calls=[]
   def run(self,*args,**kw):self.calls.append(args);return b''
  runner=Runner()
  with patch.object(S,'checked_package',return_value=self.base),patch.object(S,'body_authority',return_value=(private,a)),patch.object(S.G,'allocation',return_value=100),patch.object(S.G,'query',return_value=cp):out=S.body_rehearsal(runner,job,self.base,p,work,v)
  return out,runner.calls,job
 def test_body_accepts_actual_all_sixteen_and_named_flush_then_rollback(self):
  r,calls,job=self.body_fixture();self.assertEqual(r['selected'],16);self.assertEqual(r['missing'],0);self.assertTrue(r['allFourNativeFingerprintsRestored']);argv=calls[0][0];self.assertEqual(argv[-1],str(job/'stream-followup-v1'));self.assertEqual(argv[-4],'phase4-body-rehearsal-v2');self.assertTrue((job/'stream-followup-v1/phase4-before-stream-prototype.json').exists())
 def test_body_false_invariant_unknown_partition_and_closure_never_green(self):
  variants=[dict(rollbackAcknowledged=False),dict(exactInverseBodySqlExercised=False),dict(allFourNativeFingerprintsRestored=False),dict(namedDeferredConstraintExercised=False),dict(singleQueuedTransactionObserved=False),dict(exactOneShardIncrementObserved=False),dict(productionMutation=True),dict(canonicalReadinessClosureSHA256='f'*64),dict(readinessEpochAfter='1000000000000001'),dict(selectedCloneTargetCount=0,selectedTxids=[]),dict(missingCloneCandidateCount=1,missingCloneCandidateTxids=['f'*64])]
  for i,change in enumerate(variants):
   with self.subTest(change=change),self.assertRaises(ValueError):self.body_fixture(change)
   (self.base/'body-job').rename(self.base/('failed-body-'+str(i)))
 def marker(self,values=None):
  values=values or[b'workPrecisionV2Migration:livenet',b'\x01{"status": "complete", "activationHeight": 960601}',struct.pack('!q',1)]
  return b'PGCOPY\n\xff\r\n\x00'+struct.pack('!ii',0,0)+struct.pack('!h',3)+b''.join(struct.pack('!i',len(v))+v for v in values)+struct.pack('!h',-1),S.sha(values[1])
 def test_marker_full_binary_jsonb_send_and_raw_value(self):
  raw,h=self.marker();self.assertEqual(json.loads(S.decode_marker(raw,h)),{'status':'complete','activationHeight':960601})
 def test_marker_truncated_extra_row_wrongkey_null_version_and_digest_refuse(self):
  raw,h=self.marker()
  for bad in [raw[:-1],raw+b'junk',raw[:19]+struct.pack('!h',26)+raw[21:],raw.replace(b'workPrecisionV2Migration',b'workPrecisionX2Migration',1),raw.replace(b'\x01{"status"',b'\x02{"status"',1),raw[:21]+struct.pack('!i',-1)+raw[25:]]:
   with self.subTest(length=len(bad)),self.assertRaises(ValueError):S.decode_marker(bad,h)
  with self.assertRaises(ValueError):S.decode_marker(raw,'a'*64)
 def artifacts(self,bad_source=False):
  job=self.base/'oracle-job';job.mkdir(mode=0o700);work=job/'stream-followup-v1';work.mkdir(mode=0o700);source=job/'source.copy';source.write_bytes(b'\x00\xffcomplete-source-copy');source.chmod(0o600);reconstructed=job/'reconstructed.copy';reconstructed.write_bytes(source.read_bytes());reconstructed.chmod(0o600);source_sha=S.sha(source.read_bytes());raw,marker_sha=self.marker()
  rows=[dict(height=960600,hash='a'*64),dict(height=960601,hash='b'*64),dict(height=969526,hash='c'*64)];cp=dict(height=969526,hash='c'*64,transitionHeight=969526,transitionHash='c'*64);base=dict(schema='pow-audit30-private-transition-prototype-plan-v1',privateJob=str(job),privateSocket=str(job/'socket'),privatePort=55432,sourceDatabase='proof_indexer',network='livenet',checkpoint=cp,sourceFenceSha256='d'*64,sampleRows=rows,columns=[dict(name='payload',typeOid=3802,typeName='jsonb')],precisionMarkerJsonbSendSha256=marker_sha);plan=dict(base=base,envelope=S.N.C.DEFAULT);context=dict(sampleRows=rows,columns=base['columns'],markerSha256=marker_sha)
  class Runner:
   def run(self,*args,**kwargs):return raw
  if bad_source:reconstructed.write_bytes(b'changed-copy')
  with patch.object(S.N,'sql_guard',return_value='FIXED READONLY GUARD\n'):result=S.oracle_artifacts(Runner(),job,work,plan,context,{},source,reconstructed,source_sha,S.encoded(base['columns']))
  return work,base,result,source_sha
 def test_oracle_full_copy_marker_checkpoint_order_and_exact_base_plan(self):
  work,base,result,source_sha=self.artifacts();v=json.loads((work/'native.context.json').read_bytes());self.assertEqual(v['basePlan'],base);self.assertEqual(v['envelope'],S.N.C.DEFAULT);self.assertFalse(v['mathAccepted']);self.assertEqual(v['sourceSha256'],source_sha);self.assertEqual(S.sha((work/'native.reconstructed.copy').read_bytes()),source_sha);self.assertEqual(list(json.loads((work/'native.checkpoint.json').read_bytes())),['network','height','hash','sourceFenceSha256','sampleRowKeysSha256']);self.assertEqual((work/'native.marker-value.json').read_bytes(),b'{"status": "complete", "activationHeight": 960601}')
  for b in result['bindings']:
   p=work/b['fileName'];self.assertEqual(p.stat().st_size,b['bytes']);self.assertEqual(S.sha(p.read_bytes()),b['sha256'])
  self.assertEqual(result['contextBinding']['fileName'],'native.context.json')
 def test_oracle_reconstructed_hash_drift_never_accepted(self):
  with self.assertRaisesRegex(ValueError,'copy differs'):self.artifacts(True)
 def test_oracle_outputs_creation_only(self):
  work,base,result,source_sha=self.artifacts();p=work/'native.copy';before=p.read_bytes()
  with self.assertRaises(FileExistsError):S.N.new_file(p)
  self.assertEqual(p.read_bytes(),before)

 def test_stricter_fifteen_minute_runtime_thirty_minute_backup_window(self):
  self.assertEqual(S.RUNTIME,900);p=self.plan();now=dt.datetime.now(dt.timezone.utc);deadline=now+dt.timedelta(minutes=31);p['backupWindow']=dict(preflightAtUtc=now.isoformat(),nextScheduledAtUtc=deadline.isoformat())
  def props(name,keys):return dict(ActiveState='inactive')if name.endswith('.service')else dict(ActiveState='active',NextElapseUSecRealtime=deadline.strftime('%a %Y-%m-%d %H:%M:%S UTC'))
  # systemd reports seconds; plans bind that exact published timer precision.
  deadline=deadline.replace(microsecond=0);p['backupWindow']['nextScheduledAtUtc']=deadline.isoformat()
  with patch.object(S.G,'system_properties',side_effect=props):S.check_window(p,now)
  for change in [('preflightAtUtc',(now-dt.timedelta(minutes=16)).isoformat()),('nextScheduledAtUtc',(now+dt.timedelta(minutes=29)).isoformat())]:
   q=copy.deepcopy(p);q['backupWindow'][change[0]]=change[1]
   with self.subTest(change=change),patch.object(S.G,'system_properties',side_effect=props),self.assertRaises(ValueError):S.check_window(q,now)
  with patch.object(S.G,'system_properties',return_value={'ActiveState':'active'}),self.assertRaises(ValueError):S.check_window(p,now)
 def test_zero_readiness_epoch_is_valid_exact_one_increment(self):
  r,calls,job=self.body_fixture(dict(readinessEpochBefore='0',readinessEpochAfter='1'));self.assertEqual(r['selected'],16);self.assertTrue(r['allFourNativeFingerprintsRestored'])
 def clone_stop_fixture(self,props,qualified=True,change=None):
  job=self.base/'stopped-job';job.mkdir(mode=0o700);cluster=job/'cluster';cluster.mkdir(mode=0o700);(cluster/'pg_tblspc').mkdir(mode=0o700);(cluster/'PG_VERSION').write_bytes(b'16\n');(cluster/'postgresql.auto.conf').write_bytes(b'# no overrides\n')
  if change=='pid':(cluster/'postmaster.pid').write_bytes(b'123')
  if change=='override':(cluster/'postgresql.auto.conf').write_bytes(b"listen_addresses='*'\n")
  output=b'Database cluster state: shut down\nData page checksum version: 1\nDatabase system identifier: 12345\n';it=Path.iterdir
  def dirs(p):return iter([])if p==Path('/proc')else it(p)
  with patch.object(S,'job_identity',return_value='20261003T014100Z'),patch.object(S.G,'system_properties',return_value=props),patch.object(S.G,'command',return_value=output),patch.object(Path,'iterdir',dirs):return S.clone_stopped(job,'proofofwork-audit30-snapshot-inspect-20261003T014100Z.service',qualified)
 def test_exact_prior_failed_zero_pid_is_qualified_without_reset_or_source_helper_change(self):
  props=dict(LoadState='loaded',ActiveState='failed',MainPID='0',SubState='failed');v=self.clone_stop_fixture(props);self.assertEqual(v['unit'],props);self.assertTrue(v['qualifiedPriorFailedUnit']);self.assertEqual(v['state'],'shut down');self.assertEqual(v['checksums'],'1')
 def test_failed_unit_requires_exact_admission_and_all_original_physical_stop_gates(self):
  props=dict(LoadState='loaded',ActiveState='failed',MainPID='0',SubState='failed')
  variants=[(props,False,None),(props|{'MainPID':'123'},True,None),(props|{'ActiveState':'active','SubState':'running'},True,None),(props|{'LoadState':'masked'},True,None),(props,True,'pid'),(props,True,'override')]
  for j,(p,q,c)in enumerate(variants):
   with self.subTest(props=p,qualified=q,change=c),self.assertRaises(ValueError):self.clone_stop_fixture(p,q,c)
   (self.base/'stopped-job').rename(self.base/('retained-stop-'+str(j)))
if __name__=='__main__':unittest.main(verbosity=2)
