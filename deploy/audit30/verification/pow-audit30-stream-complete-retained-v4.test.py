#!/usr/bin/python3 -I
import copy,datetime as dt,hashlib,importlib.util,json,os,signal,struct,subprocess,sys,tempfile,time,types,unittest
from contextlib import ExitStack
from pathlib import Path
from unittest.mock import patch
P=Path('/tmp/pow-audit30-stream-complete-retained-v4.py');sp=importlib.util.spec_from_file_location('completion',P);C=importlib.util.module_from_spec(sp);sp.loader.exec_module(C)
class Tests(unittest.TestCase):
 @classmethod
 def setUpClass(cls):
  cls.libs=tempfile.TemporaryDirectory();base=Path(cls.libs.name);cls.S=types.ModuleType('streamold');cls.S.__file__=str(base/'controller-v7.py');exec(compile(Path('/tmp/pow-audit30-transition-stream-controller-v7.py').read_bytes(),cls.S.__file__,'exec'),cls.S.__dict__)
  for n,h in cls.S.PINS.items():
   p=Path('/home/sixer/ProofOfWork.Me/deploy/audit30')/n if n=='restore-latest-logical.py' else Path('/tmp')/n
   raw=p.read_bytes();assert hashlib.sha256(raw).hexdigest()==h
   (base/n).write_bytes(raw);(base/n).chmod(0o600)
  cls.S.load();C.S=cls.S;C.I=cls.S.I;C.G=cls.S.G;C.N=cls.S.N
 @classmethod
 def tearDownClass(cls):cls.libs.cleanup()
 def setUp(self):self.tmp=tempfile.TemporaryDirectory();self.base=Path(self.tmp.name)
 def tearDown(self):self.tmp.cleanup()
 def plan(self):
  now=dt.datetime.now(dt.timezone.utc);m=dict(device=1,inode=2,mode=0o600,uid=108,gid=112,bytes=1,mtimeNs=1,ctimeNs=1,nlink=1)
  inputs={n:dict(metadata=copy.deepcopy(m),sha256='a'*64)for n in C.INPUTS};inputs['stream-transitions-source.copy'].update(sha256=C.SOURCE_SHA,metadata=m|{'bytes':C.SOURCE_BYTES})
  return dict(schema=C.SCHEMA,approvalSha256=C.APPROVAL,controllerSha256='a'*64,host='pow-bitcoin-01',runId='20261003T061500Z',unit='proofofwork-audit30-stream-completion-20261003T061500Z.service',job=str(C.JOB),sealedSource=str(C.SOURCE),backupLock=m|{'bytes':0},backupWindow=dict(preflightAtUtc=now.isoformat(),nextScheduledAtUtc=(now+dt.timedelta(hours=8)).isoformat()),liveServices={n:dict(MainPID='123',InvocationID='b'*32)for n in C.G.SERVICES},inputBindings=inputs)
 def test_exact_plan_has_no_live_body_or_schema_write_authority(self):
  self.assertIs(C.validate(self.plan()),C.validate(self.plan())) if False else C.validate(self.plan())
  for k,v in [('job','/var/lib/postgresql/16/main'),('sealedSource',str(C.JOB)),('approvalSha256','0'*64),('unit','postgresql@16-main.service'),('host','other')]:
   p=self.plan();p[k]=v
   with self.subTest(k=k),self.assertRaises(ValueError):C.validate(p)
  p=self.plan();p['extra']=True
  with self.assertRaises(ValueError):C.validate(p)
 def test_every_metadata_value_is_strict_nonnegative_integer(self):
  for key in C.I.META_KEYS:
   for value in [True,-1,'1',1.0,None]:
    p=self.plan();p['inputBindings']['stream-parts.copy']['metadata'][key]=value
    with self.subTest(key=key,value=value),self.assertRaises(ValueError):C.validate(p)
 def test_missing_input_weakmode_link_wronghash_or_changed_source_refuse(self):
  for key,value in [('mode',0o644),('uid',0),('gid',0),('nlink',2),('bytes',145*1024**2)]:
   p=self.plan();p['inputBindings']['stream-parts.copy']['metadata'][key]=value
   with self.subTest(key=key),self.assertRaises(ValueError):C.validate(p)
  p=self.plan();p['inputBindings'].pop('stream-chunks.sqlite')
  with self.assertRaises(ValueError):C.validate(p)
  for key,value in [('sha256','0'*64),('metadata',p['backupLock'])]:
   p=self.plan();p['inputBindings']['stream-transitions-source.copy'][key]=value
   with self.assertRaises(ValueError):C.validate(p)
 def measurements(self):
  rows=[dict(name=n,heapBytes=8192,indexesBytes=8192,tableWithToastBytes=8192,totalBytes=16384)for n in ['capture','chunks','parts']]
  return dict(sourceSha256=C.SOURCE_SHA,sourceBytes=C.SOURCE_BYTES,partCount=123,chunkCount=100,uniqueChunkBytes=123456,schemaTotalBytes=49152,relations=rows,fullSourceHashVerifiedExternally=False)
 def run_measurement(self,r):
  calls=[]
  class Runner:
   def run(_,a,n,**kw):calls.append((a,n,kw));return json.dumps(r).encode()
  proto={};sql='\\set ON_ERROR_STOP on\nBEGIN TRANSACTION READ ONLY;\nSELECT public_counter;\nCOMMIT;\n'
  with patch.object(C.N,'measurements_sql',return_value=sql):result=C.measurement(Runner(),proto,{'meta':{'partCount':123}})
  return result,calls,sql
 def test_actual_measurement_argv_f_stdin_never_c_and_unchanged_sql(self):
  (v,h),calls,sql=self.run_measurement(self.measurements());a,n,k=calls[0];self.assertEqual(a,[*C.G.psql(C.JOB),'-f','-']);self.assertNotIn('-c',a);self.assertEqual(k['stdin'],sql.encode());self.assertEqual(h,hashlib.sha256(sql.encode()).hexdigest());self.assertEqual(v,self.measurements())
 def test_measurement_wrong_capture_boolean_count_or_extra_fields_refuse(self):
  for k,v in [('sourceSha256','0'*64),('sourceBytes',C.SOURCE_BYTES-1),('partCount',124),('chunkCount',124),('uniqueChunkBytes',True),('schemaTotalBytes',129*1024**2),('fullSourceHashVerifiedExternally',True)]:
   r=self.measurements();r[k]=v
   with self.subTest(k=k),self.assertRaises(ValueError):self.run_measurement(r)
  r=self.measurements();r['unknown']=0
  with self.assertRaises(ValueError):self.run_measurement(r)
 def test_physical_relation_inventory_totals_types_and_order_refuse(self):
  for variant in ['order','extra','name','negative','bool','sum','indexsum','heap']:
   r=self.measurements()
   if variant=='order':r['relations'].reverse()
   elif variant=='extra':r['relations'].append(r['relations'][0])
   elif variant=='name':r['relations'][0]['name']='unknown'
   elif variant=='negative':r['relations'][0]['heapBytes']=-1
   elif variant=='bool':r['relations'][0]['indexesBytes']=False
   elif variant=='sum':r['schemaTotalBytes']+=1
   elif variant=='indexsum':r['relations'][0]['indexesBytes']+=1
   else:r['relations'][0]['heapBytes']=16384
   with self.subTest(v=variant),self.assertRaises(ValueError):self.run_measurement(r)
 def test_budget_includes_exact_512MiB_and_120sec_but_refuses_overflow(self):
  with patch.object(C.G,'allocation',return_value=512*1024**2),patch.object(C.time,'monotonic',return_value=120):self.assertEqual(C.budget(0,0),dict(incrementalAllocatedBytes=512*1024**2,seconds=120))
  for allocation,seconds in [(512*1024**2+1,1),(1,120.01),(-1,1),(1,-1)]:
   with patch.object(C.G,'allocation',return_value=allocation),patch.object(C.time,'monotonic',return_value=seconds),self.assertRaises(ValueError):C.budget(0,0)
 def test_default_only_inputs_rehash_and_changed_profile_refuse(self):
  p=self.plan();proto=dict(admission=None,profileBinding=None,base=dict(privateJob=str(C.JOB)));spools={'meta':{'sourceSha256':C.SOURCE_SHA,'sourceBytes':C.SOURCE_BYTES}}
  def meta(path):return p['inputBindings'][Path(path).name]['metadata']
  def digest(path,*args,**kw):return p['inputBindings'][Path(path).name]['sha256']
  with patch.object(C.G,'metadata',side_effect=meta),patch.object(C.G,'hash_file',side_effect=digest),patch.object(C.N.C,'small_json',side_effect=lambda p,*a:(proto if Path(p).name=='stream-prototype-plan.json'else spools,{})),patch.object(C.N,'validate',return_value=(proto['base'],b'cols',b'cp',b'rows',C.N.C.DEFAULT,None,None)),patch.object(C.N,'validate_spools',return_value=spools['meta']):
   self.assertEqual(C.inputs(p),(proto,spools,b'cols'))
   proto['admission']={}
   with self.assertRaises(ValueError):C.inputs(p)
   proto['admission']=None;proto['profileBinding']={}
   with self.assertRaises(ValueError):C.inputs(p)
   proto['profileBinding']=None
   with patch.object(C.G,'hash_file',return_value='0'*64),self.assertRaises(ValueError):C.inputs(p)
 def previous_fixture(self):
  p={};ids=[f'{i:064x}'for i in range(16)];body=dict(schema='pow-audit30-private-mail-body-rehearsal-completed-v2',status='passed',manifestSHA256=C.S.MANIFEST_SHA,engineSHA256=C.S.PHASE4_ENGINE_SHA,originalPlanSHA256=C.S.PRIVATE_PLAN_SHA,admissionSHA256='d'*64,canonicalReadinessClosureSHA256=C.S.CLOSURE_SHA,manifestTargetCount=16,selectedCloneTargetCount=16,missingCloneCandidateCount=0,missingCloneCandidateTxids=[],selectedTxids=ids,exactInverseBodySqlExercised=True,allFourNativeFingerprintsRestored=True,rollbackAcknowledged=True,privateOriginalRowsRestored=True,allCloneNonbodyAndNontargetRowsUnchanged=True,namedDeferredConstraintExercised=True,singleQueuedTransactionObserved=True,exactOneShardIncrementObserved=True,productionMutation=False,productionApplyApproved=False,readinessEpochBefore='0',readinessEpochAfter='1',baselineNativeFingerprints={n:{}for n in ['mail','meta','queue','shards']})
  p={'phase4':{'readinessAdmissionSha256':'d'*64}};f=dict(schema='pow-audit30-private-stream-followup-failed-v1',status='failed',phase='stream-native-prototype',errorClass='RuntimeError',cleanupErrors=[],privateStopVerified=True,intentCreated=True,productionDatabaseMutation=False,automaticRetry=False);i={'plan':p,'planSha256':C.OLD_PLAN_SHA,'sealedSourceFullHashVerified':True};return p,{'intent.json':i,'failed.json':f,'phase4-body-rehearsal-v2-completed.json':body},ids
 def test_exact_prior_failed_attempt_all16_rollback_only_required(self):
  p,proofs,ids=self.previous_fixture()
  with patch.object(C.I,'read_json',side_effect=lambda path,*a,**k:(proofs[Path(path).name],{})),patch.object(C.S,'body_authority',return_value=({'targets':[{'txid':x}for x in ids]},{})):
   self.assertEqual(C.previous(p),proofs['phase4-body-rehearsal-v2-completed.json'])
   for name,k,v in [('failed.json','phase','admission'),('failed.json','privateStopVerified',False),('failed.json','cleanupErrors',[{}]),('intent.json','sealedSourceFullHashVerified',False),('phase4-body-rehearsal-v2-completed.json','selectedCloneTargetCount',15),('phase4-body-rehearsal-v2-completed.json','rollbackAcknowledged',False),('phase4-body-rehearsal-v2-completed.json','allFourNativeFingerprintsRestored',False),('phase4-body-rehearsal-v2-completed.json','readinessEpochAfter','2')]:
    old=proofs[name][k];proofs[name][k]=v
    with self.subTest(k=k),self.assertRaises(ValueError):C.previous(p)
    proofs[name][k]=old
 def execution(self,signal_kind=None,cleanup_errors=False,final_timer_fail=False):
  job=self.base/'job';job.mkdir(mode=0o700);lock=self.base/'lock';lock.touch(mode=0o600);p=self.plan();p['backupLock']=C.G.metadata(lock);proto={'base':{'columns':[],'sampleRows':[],'precisionMarkerJsonbSendSha256':'a'*64},'originalTriggers':[]};ctx=dict(columns=[],sampleRows=[],markerSha256='a'*64,originalTriggers=[]);inv={'previousUnit':'prior.service','snapshot':{'fence':'saved'}};calls=[];children=[];killers=[]
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
    calls.append(phase)
    if phase=='retained-local-byte-equivalence':return json.dumps(dict(byteForByteSourceCompared=True,sourceSha256=C.SOURCE_SHA,sourceBytes=C.SOURCE_BYTES)).encode()
    if phase=='private-start'and signal_kind:
     marker=self.base/'ready';pidfile=self.base/'pid';code='import os,time;from pathlib import Path;Path('+repr(str(pidfile))+').write_text(str(os.getpid()));Path('+repr(str(marker))+').write_text("ready");time.sleep(30)';killer_code='import os,time,signal;from pathlib import Path;p=Path('+repr(str(marker))+');end=time.monotonic()+3\nwhile not p.exists() and time.monotonic()<end:time.sleep(.005)\nassert p.exists();os.kill('+str(os.getpid())+','+str(signal_kind)+')';killer=subprocess.Popen([sys.executable,'-I','-B','-c',killer_code]);killers.append(killer)
     try:return C.G.Runner(job/'stream-completion-v1',Watch(),time.monotonic()).run([sys.executable,'-I','-B','-c',code],phase,timeout=5)
     finally:
      if pidfile.exists():children.append(int(pidfile.read_text()))
    if phase=='fresh-side-export':return b'{"status":"private-stream-captured","stderrBytes":0}'
    if phase=='fresh-side-byte-equivalence':return json.dumps(dict(fullByteEquality=True,sourceSha256=C.SOURCE_SHA,sourceBytes=C.SOURCE_BYTES,mathAccepted=False)).encode()
    return b''
  def stop(*a):
   calls.append('private-stop')
   if cleanup_errors:os.kill(os.getpid(),signal.SIGINT);raise ValueError('private-cleanup')
  realmeta=C.G.metadata
  def meta(path):return realmeta(path)|({'uid':108,'gid':112}if Path(path)==job else {})
  def window(*a):
   calls.append('window')
   if final_timer_fail and calls.count('window')==3:raise ValueError('timer-drift')
  with ExitStack()as st:
   for target,name,value in [(C,'JOB',job),(C,'runtime',lambda *_:None),(C,'package',lambda *_:({},inv,{})),(C,'previous',lambda *_:{}),(C,'inputs',lambda *_:(proto,{'meta':{'partCount':1}},b'cols')),(C,'measurement',lambda *_:(self.measurements(),'a'*64)),(C,'oracle_artifacts',lambda *_:{'bindings':[]}),(C.S,'check_window',window),(C.S,'clone_stopped',lambda *_:{'systemIdentifier':'one'}),(C.S,'unchanged',lambda *_:None),(C.G,'check_live',lambda *_:None),(C.G,'LOCK',lock),(C.G,'metadata',meta),(C.G,'system_properties',lambda *_:dict(LoadState='loaded',ActiveState='failed',MainPID='0',InvocationID=C.OLD_INV)),(C.G,'storage_sample',lambda *_:{}),(C.G,'allocation',lambda *_:100),(C.G,'Watchdog',Watch),(C.G,'private_postmaster',lambda *_:'pid'),(C.G,'stop_private',stop),(C.G,'query',lambda runner,job,sql,phase:ctx if 'context'in phase else inv['snapshot']),(C.I,'verify_source',lambda *a,**k:calls.append('source-full')),(C.I,'acquire_backup_lock',lambda *_:os.open(lock,os.O_RDONLY)),(C.I,'BoundedRunner',Runner),(C.pwd,'getpwnam',lambda *_:types.SimpleNamespace(pw_uid=os.getuid(),pw_gid=os.getgid()))]:st.enter_context(patch.object(target,name,value))
   old=signal.getsignal(signal.SIGTERM)
   if signal_kind:
    with self.assertRaises(C.CompletionInterrupted):C.execute(p,'a'*64)
   elif final_timer_fail:
    with self.assertRaisesRegex(ValueError,'timer-drift'):C.execute(p,'a'*64)
   else:C.execute(p,'a'*64)
   self.assertEqual(signal.getsignal(signal.SIGTERM),old)
  for killer in killers:self.assertEqual(killer.wait(timeout=2),0)
  for pid in children:
   with self.assertRaises(ProcessLookupError):os.kill(pid,0)
  return job/'stream-completion-v1',calls
 def test_success_records_final_timer_source_full_and_no_body_redo(self):
  work,calls=self.execution();r=json.loads((work/'completed.json').read_bytes());self.assertTrue(r['backupWindowRecheckedAtStop']);self.assertTrue(r['fullNativeByteEquality']);self.assertTrue(r['sealedSourceFullHashVerifiedAtStop']);self.assertFalse(r['bodyRedo']);self.assertFalse(r['newSchemaWrite']);self.assertFalse(r['mathAccepted']);self.assertFalse(r['allHistoricalReplay']);self.assertEqual(calls.count('source-full'),2);self.assertEqual(calls.count('window'),3);self.assertFalse((work/'failed.json').exists());self.assertNotIn('phase4',calls)
 def test_final_timer_drift_preserves_new_failure_and_never_completion(self):
  work,calls=self.execution(final_timer_fail=True);self.assertTrue((work/'intent.json').exists());self.assertTrue((work/'failed.json').exists());self.assertFalse((work/'completed.json').exists())
 def test_actual_sigterm_selectors_refuse_reap_and_preserve_first_failure(self):
  work,calls=self.execution(signal.SIGTERM);r=json.loads((work/'failed.json').read_bytes());self.assertEqual(r['errorClass'],'CompletionInterrupted');self.assertTrue(r['privateStopVerified']);self.assertFalse(r['automaticRetry']);self.assertFalse((work/'completed.json').exists())
 def test_actual_sigint_and_repeated_cleanup_signals_do_not_skip_receipt(self):
  work,calls=self.execution(signal.SIGINT,cleanup_errors=True);r=json.loads((work/'failed.json').read_bytes());self.assertEqual(r['errorClass'],'CompletionInterrupted');self.assertEqual([x['phase']for x in r['cleanupErrors']],['private-stop','watchdog-stop']);self.assertFalse(r['privateStopVerified']);self.assertEqual(calls[-2:],['private-stop','watch-stop'])
 def test_fresh_export_has_f_guarded_readonly_original_sql_and_exact_output(self):
  job=self.base/'export';job.mkdir(mode=0o700);work=job/'stream-completion-v1';work.mkdir(mode=0o700);p=self.plan();proto={};spools={'meta':{'partCount':9}};calls=[];m=C.G.metadata(work)|{'uid':108,'gid':112}
  with patch.object(C,'JOB',job),patch.object(C,'runtime'),patch.object(C,'package',return_value=({}, {}, {})),patch.object(C,'previous'),patch.object(C,'inputs',return_value=(proto,spools,b'')),patch.object(C.G,'metadata',return_value=m),patch.object(C.N,'export_sql',return_value='BEGIN READ ONLY;\n\\copy fixed\nCOMMIT;\n'),patch.object(C.N,'stream_child',side_effect=lambda *a:calls.append(a)or {'status':'ok'}):self.assertEqual(C.export_side(p),{'status':'ok'})
  argv,sql,path,maximum,seconds=calls[0];self.assertEqual(argv,[*C.G.psql(job),'-f','-']);self.assertEqual(path,work/'current-side-ordered-export.copy');self.assertEqual(maximum,C.SOURCE_BYTES+22*9+21);self.assertEqual(seconds,120);self.assertIn(b'BEGIN READ ONLY',sql)
 def test_seven_oracle_artifacts_reuse_final_inode_and_exact_interface(self):
  work=self.base/'oracle';work.mkdir(mode=0o700);source=self.base/'source';source.write_bytes(b'full-source-bytes');source.chmod(0o600);reconstructed=work/'native.reconstructed.copy';reconstructed.write_bytes(source.read_bytes());reconstructed.chmod(0o600);inode=reconstructed.stat().st_ino;digest=hashlib.sha256(source.read_bytes()).hexdigest();value=b'{"status":"complete"}';jsonb=b'\x01'+value;marker=b'PGCOPY\n\xff\r\n\x00'+struct.pack('!ii',0,0)+struct.pack('!h',3)
  for raw in [b'workPrecisionV2Migration:livenet',jsonb,b'\x00'*8]:marker+=struct.pack('!i',len(raw))+raw
  marker+=struct.pack('!h',-1);cp={'height':969526,'hash':'a'*64,'transitionHeight':969526,'transitionHash':'a'*64};rows=[{'height':960600,'hash':'b'*64},{'height':960601,'hash':'c'*64},{'height':969526,'hash':'a'*64}];plan={'base':{'checkpoint':cp,'sourceFenceSha256':'d'*64},'envelope':C.N.C.DEFAULT};ctx={'sampleRows':rows,'columns':[],'markerSha256':hashlib.sha256(jsonb).hexdigest()};real=C.G.metadata
  class Runner:
   def run(_,a,n,**k):self.assertEqual(a,[*C.G.psql(C.JOB),'-f','-']);self.assertIn(b'COPY(SELECT key,value,updated_at',k['stdin']);return marker
  with patch.object(C,'SOURCE_BYTES',source.stat().st_size),patch.object(C,'SOURCE_SHA',digest),patch.object(C.G,'metadata',side_effect=lambda path:real(path)|{'uid':108,'gid':112}),patch.object(C.N,'sql_guard',return_value='BEGIN READ ONLY;\n'):
   result=C.oracle_artifacts(Runner(),work,plan,ctx,{},source,reconstructed,b'[]')
  self.assertEqual(reconstructed.stat().st_ino,inode);self.assertEqual(reconstructed.read_bytes(),source.read_bytes());self.assertEqual(set(x.name for x in work.iterdir()),{'native.copy','native.reconstructed.copy','native.columns.json','native.checkpoint.json','native.marker.copy','native.marker-value.json','native.context.json'});record=json.loads((work/'native.context.json').read_bytes());self.assertEqual(len(record['bindings']),6);self.assertEqual(record['basePlan'],plan['base']);self.assertEqual(record['sourceSha256'],digest);self.assertEqual(record['reconstructedSha256'],digest);self.assertFalse(record['mathAccepted']);self.assertEqual(record['sampleRows'],rows);self.assertEqual(result['contextBinding']['fileName'],'native.context.json');self.assertEqual((work/'native.marker-value.json').read_bytes(),value)
 def test_exact_fresh_verify_argv_targets_final_reconstruction_no_third_copy(self):
  source=P.read_text();self.assertIn("out=work/'native.reconstructed.copy'",source);self.assertNotIn('current-native-byte-recheck.copy',source);self.assertNotIn('S.oracle_artifacts(',source);self.assertIn('I.DeadlineRunner(I.BoundedRunner(work,watch,started),900)',source)
if __name__=='__main__':unittest.main()
