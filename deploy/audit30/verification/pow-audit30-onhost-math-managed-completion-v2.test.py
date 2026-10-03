import base64,copy,hashlib,importlib.util,json,pathlib,types,unittest
from unittest.mock import patch
sp=importlib.util.spec_from_file_location('M','/tmp/pow-audit30-onhost-math-managed-completion-v2.py');M=importlib.util.module_from_spec(sp);sp.loader.exec_module(M)
def plan():
 return {'schema':'pow-audit30-saved-transition-onhost-math-plan-v2','operatorSHA256':M.OPERATOR_SHA,'privateJob':str(M.JOB),'evidenceDirectory':str(M.STREAM),'sourceCopyManifestSHA256':'a'*64,'inputs':{s:{'bytes':2,'sha256':'b'*64}for s in M.INPUT_SUFFIXES},'historicalPlan':{'sourceFenceSha256':M.SOURCE_FENCE_SHA}}
def request():
 p=M.encoded(plan());u=pathlib.Path('/tmp/pow-audit30-onhost-math-source-copy-v3.py').read_bytes()
 return {'schema':'pow-audit30-onhost-math-managed-request-completion-v2','utilityBase64':base64.b64encode(u).decode(),'sourceCopyCompletionSha256':'c'*64,'sourceCopyManifestSha256':'a'*64,'streamCompletedSha256':'d'*64,'streamIntentSha256':'e'*64,'outputPropertyProbeSha256':M.OUTPUT_PROBE_SHA,'mathPlanBase64':base64.b64encode(p).decode(),'mathPlanSha256':M.sha(p),'nodeMetadata':{},'attestorMetadata':{},'publisherMetadata':{},'liveFive':{k:{'MainPID':'1','InvocationID':'a'*32}for k in M.LIVE}}
def stream():
 p={'schema':'pow-audit30-complete-retained-private-stream-plan-v1','job':str(M.JOB),'sealedSource':'/data/proofofwork-audit30-restore-20261002T234651Z','controllerSha256':M.STREAM_CONTROLLER_SHA,'host':'pow-bitcoin-01','runId':'20261003T062000Z','unit':'proofofwork-audit30-stream-completion-20261003T062000Z.service'};h=M.digest(p)
 i={'schema':p['schema'],'plan':p,'planSha256':h,'priorFailureSha256':M.PRIOR_PINS['failed.json'],'priorBodySha256':M.PRIOR_PINS['phase4-body-rehearsal-v2-completed.json'],'sealedSourceFullHashVerifiedBeforeStart':True,'bodyRedo':False,'newSchemaWrite':False,'productionMutation':False}
 v={'schema':'pow-audit30-complete-retained-private-stream-completed-v1','status':'passed','planSha256':h,'priorFailureSha256':M.PRIOR_PINS['failed.json'],'priorIntentSha256':M.PRIOR_PINS['intent.json'],'priorBodySha256':M.PRIOR_PINS['phase4-body-rehearsal-v2-completed.json'],'byteEquivalence':{'fullByteEquality':True,'sourceSha256':M.SAMPLE_SOURCE_SHA,'sourceBytes':M.SAMPLE_SOURCE_BYTES,'mathAccepted':False},'incrementalAllocatedBytes':512*1024**2,'nativeSeconds':120,'wholeSeconds':900}
 for k in ('originalAttemptRemainsFailed','bodyAll16Accepted','freshCurrentSideByteEquality','fullNativeByteEquality','privateClusterStopped','liveServicesUnchanged','sealedSourceFullHashVerifiedBeforeStart','sealedSourceFullHashVerifiedAtStop','backupWindowRecheckedAtStop'):v[k]=True
 for k in ('bodyRedo','newSchemaWrite','productionMutation','sealedSourceStarted','mathAccepted','allHistoricalReplay'):v[k]=False
 v.update(priorCompletionRemainsFailed=True,priorCompletionFailureSha256=M.PREVIOUS_COMPLETION_PINS['failed.json'],priorCompletionIntentSha256=M.PREVIOUS_COMPLETION_PINS['intent.json']);i.update(priorCompletionFailureSha256=M.PREVIOUS_COMPLETION_PINS['failed.json'],priorCompletionIntentSha256=M.PREVIOUS_COMPLETION_PINS['intent.json'])
 return v,i

def prior():
 p=json.loads(pathlib.Path('/tmp/pow-audit30-stream-run-030000-before-private-45-v1.plan.json').read_bytes());assert M.digest(p)==M.PRIOR_PLAN_SHA
 raw=pathlib.Path('/tmp/pow-audit30-body-public-prototype-diagnostic-native-v1.stdout').read_bytes();assert M.sha(raw)=='25e031f6b6ab22d684880a61d3f6e6da098b59e4353e9aa7fb401401279c1100';body=json.loads(raw)['bodyPublicReceipt']
 return {'intent.json':{'plan':p,'planSha256':M.PRIOR_PLAN_SHA,'sealedSourceFullHashVerified':True},'failed.json':dict(schema='pow-audit30-private-stream-followup-failed-v1',status='failed',phase='stream-native-prototype',errorClass='RuntimeError',cleanupErrors=[],privateStopVerified=True,intentCreated=True,productionDatabaseMutation=False,automaticRetry=False),'phase4-body-rehearsal-v2-completed.json':body}

def unit():return dict(LoadState='loaded',Type='exec',Transient='yes',RemainAfterExit='yes',User='postgres',Group='postgres',InvocationID='a'*32,MainPID='1',ControlGroup='/system.slice/'+M.UNIT,ActiveState='active',SubState='running',Result='success',ExecMainStatus='0')
class Tests(unittest.TestCase):
 def test_fixed_operator_node_argv_no_sql_or_pg_start(self):
  a=M.command('a'*64);self.assertEqual(a[:3],['/usr/bin/env','-i','PATH=/usr/bin:/bin']);self.assertEqual(a[-2:], [str(M.PACKAGE/'math-plan-completion-v2.json'),'a'*64]);self.assertEqual(a[-3],str(M.PACKAGE/'operator-completion-v2.mjs'))
  for forbidden in ('psql','pg_ctl','bitcoin-cli','--loop','proof-api.mjs'):self.assertNotIn(forbidden,' '.join(a))
 def test_native_resources_network_and_livepg_blocked(self):
  p=M.properties();self.assertEqual(p['MemoryMax'],'2G');self.assertEqual(p['CPUQuota'],'50%');self.assertEqual(p['RuntimeMaxSec'],'120s');self.assertEqual(p['CapabilityBoundingSet'],'');self.assertEqual(p['PrivateNetwork'],'yes');self.assertIn('/run/postgresql',p['InaccessiblePaths']);self.assertEqual(p['ReadWritePaths'],'')
 def test_request_sourcebytes_and_plan_canonical(self):
  u,p,v=M.request(request());self.assertEqual(M.sha(u),M.UTILITY_SHA);self.assertEqual(M.encoded(v),p)
 def test_request_extra_or_missing_fields_refuse(self):
  for r in (request()|{'extra':True},{k:v for k,v in request().items()if k!='liveFive'}):self.assertRaises(M.Refused,M.request,r)
 def test_wrong_operator_or_live_unit_refuses(self):
  for p in (plan()|{'operatorSHA256':'0'*64},plan()|{'privateJob':'/tmp/other'}):
   r=request();raw=M.encoded(p);r.update(mathPlanBase64=base64.b64encode(raw).decode(),mathPlanSha256=M.sha(raw));self.assertRaises(M.Refused,M.request,r)
  r=request();r['liveFive'][M.LIVE[0]]['MainPID']='0';self.assertRaises(M.Refused,M.request,r)
 def test_noncanonical_plan_lf_refuses(self):
  r=request();p=base64.b64decode(r['mathPlanBase64'])+b'\n';r.update(mathPlanBase64=base64.b64encode(p).decode(),mathPlanSha256=M.sha(p));self.assertRaises(M.Refused,M.request,r)
 def test_caps_null_and_boolean_integer_refuse(self):
  for bad in ({'bytes':True,'sha256':'b'*64},{'bytes':64*1024**2+1,'sha256':'b'*64},{'bytes':0,'sha256':'b'*64}):
   p=plan();p['inputs']['.copy']=bad;r=request();raw=M.encoded(p);r.update(mathPlanBase64=base64.b64encode(raw).decode(),mathPlanSha256=M.sha(raw));self.assertRaises(M.Refused,M.request,r)
 def test_source_copy_success_exact_receipt(self):
  v=dict(schema='pow-audit30-source-copy-finalize-completed-v3',status='completed',sourceCopyManifestSHA256='a'*64,priorAttemptRemainsFailed=True,sourceTreeNotModified=True,candidateUnchanged=True,productionMutation=False,privateRawStateCopied=False,outputPropertyProbeSHA256=M.OUTPUT_PROBE_SHA,nativeReadability={'ownedStop':{'unitStopVerified':True},'receipt':{'uid':108,'gid':112,'entries':6141,'allSourceAndDependenciesReadable':True}});M.validate_source_completion(v,request())
  for k in ('sourceTreeNotModified','candidateUnchanged','priorAttemptRemainsFailed'):
   with self.subTest(k=k):self.assertRaises(M.Refused,M.validate_source_completion,v|{k:False},request())
 def test_failed_source_copy_not_promoted(self):
  self.assertRaises(M.Refused,M.validate_source_completion,{'status':'failed'},request())
 def test_stream_green_stopped_originalfailure_qualified(self):
  v,i=stream();M.validate_stream(v,i)
 def test_each_stream_gate_false_or_missing_refuses(self):
  v,i=stream()
  for k in ('originalAttemptRemainsFailed','bodyAll16Accepted','freshCurrentSideByteEquality','fullNativeByteEquality','privateClusterStopped','liveServicesUnchanged','sealedSourceFullHashVerifiedBeforeStart','sealedSourceFullHashVerifiedAtStop','backupWindowRecheckedAtStop'):
   with self.subTest(k=k):self.assertRaises(M.Refused,M.validate_stream,v|{k:False},i)
  for k in ('bodyRedo','newSchemaWrite','productionMutation','sealedSourceStarted','mathAccepted','allHistoricalReplay'):
   with self.subTest(k=k):self.assertRaises(M.Refused,M.validate_stream,v|{k:True},i)
 def test_changed_canonical_intent_refuses(self):
  v,i=stream();i['plan']['controllerSha256']='f'*64;self.assertRaises(M.Refused,M.validate_stream,v,i)
 def test_body_subset_or_inverse_refuses(self):
  original=prior();M.validate_prior(original)
  for k,bad in [('allFourNativeFingerprintsRestored',False),('rollbackAcknowledged',False),('productionApplyApproved',True),('selectedCloneTargetCount',15),('missingCloneCandidateCount',1)]:
   with self.subTest(k=k):r=copy.deepcopy(original);r['phase4-body-rehearsal-v2-completed.json'][k]=bad;self.assertRaises(M.Refused,M.validate_prior,r)
 def test_only_successful_retained_empty_cgroup(self):
  M.OWNED=None;M.identity(unit());M.identity(unit()|dict(MainPID='0',ControlGroup='',SubState='exited'))
  for d in (unit()|{'ControlGroup':''},unit()|dict(MainPID='0',ControlGroup='',ActiveState='failed',SubState='failed'),unit()|{'User':'root'}):self.assertRaises(M.Refused,M.identity,d)
 def test_existing_invocation_changed_refuses(self):
  M.OWNED='b'*32;self.assertRaises(M.Refused,M.identity,unit());M.OWNED=None
 def test_actual_output_mode_enum_not_config_path(self):
  p=M.properties();d=dict(MemoryMax=str(2*1024**3),MemorySwapMax='0',CPUQuotaPerSecUSec='500ms',TasksMax='32',RuntimeMaxUSec='2min',TimeoutStopUSec='10s',Restart='no',KillMode='control-group',NoNewPrivileges='yes',PrivateNetwork='yes',PrivateTmp='yes',PrivateDevices='yes',PrivateIPC='yes',RestrictAddressFamilies='AF_UNIX',ProtectSystem='strict',ProtectHome='yes',CapabilityBoundingSet='',AmbientCapabilities='',StandardInput='null',StandardOutput='file',StandardError='file',UMask='0077',LimitFSIZE='65536',ReadOnlyPaths=p['ReadOnlyPaths'],ReadWritePaths='',InaccessiblePaths=p['InaccessiblePaths']);M.actual(d)
  self.assertRaises(M.Refused,M.actual,d|{'StandardOutput':p['StandardOutput']})
  for k in d:
   with self.subTest(k=k):self.assertRaises(M.Refused,M.actual,d|{k:'wrong'})
 def test_typed_exact_source_plan_program(self):
  m={'type':'o','data':['/org/freedesktop/systemd1/unit/math']};a=M.command('b'*64);e={'type':'a(sasbttttuii)','data':[[a[0],a,False,0,0,0,0,0,0,0]]};M.C=types.SimpleNamespace(run_checked=lambda *args:M.encoded(m)if'call'in args[0]else M.encoded(e))
  self.assertIn('argvSha256',M.typed('b'*64));e['data'][0][1]=['/bin/sh'];self.assertRaises(M.Refused,M.typed,'b'*64)
 def test_cleanup_only_command_restriction(self):
  self.assertRaises(M.Refused,M.cleanup_read,['/bin/sh','-c','anything'])
 def test_collision_before_work_directory_or_plan_creation(self):
  M.C=types.SimpleNamespace();M.WORK_CREATED=False
  with patch.object(M,'fence',return_value={}),patch.object(M,'show',return_value={}),patch.object(M,'no_unit',side_effect=M.Refused('collision')),patch.object(M.os,'mkdir')as mkdir:self.assertRaises(M.Refused,M.execute,request(),b'',plan())
  mkdir.assert_not_called();self.assertFalse(M.WORK_CREATED)
 def test_duplicate_json_request_refuses(self):self.assertRaises(M.Refused,M.parse,b'{"schema":1,"schema":2}')
 def test_owned_failed_empty_cgroup_cleanup_only(self):
  M.OWNED='a'*32;failed=unit()|dict(MainPID='0',ControlGroup='',ActiveState='failed',SubState='failed',Result='exit-code',ExecMainStatus='1')
  M.identity(failed,True);self.assertRaises(M.Refused,M.identity,failed)
 def test_failed_cgroup_never_adopted_unknown_or_other_invocation(self):
  failed=unit()|dict(MainPID='0',ControlGroup='',ActiveState='failed',SubState='failed')
  for owned in (None,'b'*32):
   M.OWNED=owned;self.assertRaises(M.Refused,M.identity,failed,True)
 def test_known_failed_cleanup_still_typed_exact_command_before_stop(self):
  M.OWNED='a'*32;failed=unit()|dict(MainPID='0',ControlGroup='',ActiveState='failed',SubState='failed');M.C=types.SimpleNamespace(cleanup_capture=lambda args:b'')
  with patch.object(M,'show',side_effect=[failed,dict(MainPID='0',LoadState='not-found',InvocationID='')]),patch.object(M,'typed',return_value={'known':True})as typed:
   self.assertTrue(M.stop('a'*64)['verified']);typed.assert_called_once_with('a'*64,True)
 def test_foreign_typed_command_in_failed_cleanup_never_stops(self):
  M.OWNED='a'*32;failed=unit()|dict(MainPID='0',ControlGroup='',ActiveState='failed',SubState='failed');calls=[];M.C=types.SimpleNamespace(cleanup_capture=lambda a:calls.append(a))
  with patch.object(M,'show',return_value=failed),patch.object(M,'typed',side_effect=M.Refused('wrong argv')):self.assertRaises(M.Refused,M.stop,'a'*64)
  self.assertEqual(calls,[])
 def test_startup_waits_without_claiming_success(self):
  M.OWNED=None;starting=unit()|dict(ActiveState='activating',SubState='start')
  M.identity(starting);self.assertEqual(M.node_state(starting),'waiting');self.assertEqual(M.node_state(unit()),'waiting')
  self.assertEqual(M.node_state(unit()|dict(MainPID='0',ControlGroup='',SubState='exited')),'completed')
 def test_startup_zero_pid_or_foreign_cgroup_or_state_refuses(self):
  for d in (unit()|dict(ActiveState='activating',SubState='start',MainPID='0'),unit()|dict(ActiveState='activating',SubState='start',ControlGroup=''),unit()|dict(ActiveState='activating',SubState='start-post'),unit()|dict(ActiveState='failed',SubState='failed'),unit()|dict(MainPID='0',SubState='exited',Result='exit-code',ExecMainStatus='1')):
   with self.subTest(d=d):self.assertRaises(M.Refused,M.node_state,d)
 def test_actual_execution_waits_start_then_running_then_retained_checks_all(self):
  M.OWNED=None;M.LAUNCHED=False;M.WORK_CREATED=False;M.REQUEST_SHA='c'*64;M.PROBE_SHA=M.OUTPUT_PROBE_SHA
  rows=[{},unit()|dict(ActiveState='activating',SubState='start'),unit(),unit()|dict(MainPID='0',ControlGroup='',SubState='exited')];writes=[]
  stamp={k:0 for k in('dev','ino','uid','gid','mode','nlink')}
  M.C=types.SimpleNamespace(newfile=lambda *a:writes.append(a),stamp=lambda s:stamp,run_checked=lambda *a:b'',guard=lambda:None)
  with patch.object(M,'fence',return_value={'unchanged':True}),patch.object(M,'show',side_effect=rows),patch.object(M,'no_unit'),patch.object(M,'absent',return_value=True),patch.object(M.os,'mkdir'),patch.object(M.os,'open',return_value=1),patch.object(M.os,'fsync'),patch.object(M.os,'close'),patch.object(pathlib.Path,'lstat',return_value=None),patch.object(M,'typed',return_value={'fixed':True})as typed,patch.object(M,'actual')as actual,patch.object(M,'output_fragment',return_value={'fixed':True})as fragment,patch.object(M.time,'sleep')as sleep,patch.object(M,'read',side_effect=[b'{}',b'',b'plan']),patch.object(M,'validate_result',return_value={'math':True}),patch.object(M,'stop',return_value={'verified':True}):
   done=M.execute(request(),b'plan',plan())
  self.assertEqual(done['status'],'passed');self.assertEqual(typed.call_count,3);self.assertEqual(actual.call_count,3);self.assertEqual(fragment.call_count,3);self.assertEqual(sleep.call_count,2)
  self.assertEqual(M.OWNED,'a'*32);self.assertEqual(len([a for a in writes if a[0].name=='completed.json']),1)
 def test_startup_never_bypasses_resource_or_typed_checks(self):
  M.OWNED=None;M.WORK_CREATED=False;M.LAUNCHED=False;M.C=types.SimpleNamespace(newfile=lambda *a:None,stamp=lambda s:{},run_checked=lambda *a:b'',guard=lambda:None)
  for gate in ('typed','actual'):
   with self.subTest(gate=gate):
    M.OWNED=None
    with patch.object(M,'fence',return_value={}),patch.object(M,'show',side_effect=[{},unit()|dict(ActiveState='activating',SubState='start')]),patch.object(M,'no_unit'),patch.object(M,'absent',return_value=True),patch.object(M.os,'mkdir'),patch.object(M.os,'open',return_value=1),patch.object(M.os,'fsync'),patch.object(M.os,'close'),patch.object(pathlib.Path,'lstat',return_value=None),patch.object(M,'typed',side_effect=M.Refused('typed')if gate=='typed'else None),patch.object(M,'actual',side_effect=M.Refused('resource')if gate=='actual'else None),patch.object(M,'output_fragment')as fragment,patch.object(M.time,'sleep')as sleep:
     self.assertRaises(M.Refused,M.execute,request(),b'plan',plan())
    fragment.assert_not_called();sleep.assert_not_called()
class CompletionProvenance(unittest.TestCase):
 def test_exact_old_failed_proofs_stay_separate(self):
  p=prior();self.assertEqual(M.validate_prior(p),M.PRIOR_PINS)
  for name,k,bad in [('failed.json','status','passed'),('failed.json','phase','admission'),('failed.json','cleanupErrors',[{}]),('failed.json','privateStopVerified',False),('intent.json','planSha256','f'*64),('intent.json','sealedSourceFullHashVerified',False),('phase4-body-rehearsal-v2-completed.json','readinessEpochAfter','0')]:
   with self.subTest(name=name,k=k):q=copy.deepcopy(p);q[name][k]=bad;self.assertRaises(M.Refused,M.validate_prior,q)
 def test_original_completed_only_contract_is_not_used(self):
  v,i=stream();v['schema']='pow-audit30-private-stream-followup-completed-v1';self.assertRaises(M.Refused,M.validate_stream,v,i)
 def test_each_prior_hash_and_intent_no_redo_guard_refuses(self):
  for k in ('priorIntentSha256','priorFailureSha256','priorBodySha256'):
   v,i=stream();v[k]='0'*64;self.assertRaises(M.Refused,M.validate_stream,v,i)
  for k in ('bodyRedo','newSchemaWrite','productionMutation'):
   v,i=stream();i[k]=True;self.assertRaises(M.Refused,M.validate_stream,v,i)
 def test_fresh_side_equality_false_hash_count_math_refuses(self):
  for k,bad in [('fullByteEquality',False),('sourceSha256','f'*64),('sourceBytes',M.SAMPLE_SOURCE_BYTES-1),('sourceBytes',True),('mathAccepted',True)]:
   v,i=stream();v['byteEquivalence'][k]=bad;self.assertRaises(M.Refused,M.validate_stream,v,i)
 def test_completed_resource_caps_and_types_cannot_expand(self):
  for k,bad in [('incrementalAllocatedBytes',True),('incrementalAllocatedBytes',512*1024**2+1),('nativeSeconds',120.1),('nativeSeconds',True),('wholeSeconds',900.1),('wholeSeconds',True)]:
   v,i=stream();v[k]=bad;self.assertRaises(M.Refused,M.validate_stream,v,i)
 def test_read_prior_pins_before_validation(self):
  q=prior();calls=[]
  with patch.object(M,'metadata_dir'),patch.object(M,'read',side_effect=lambda p,h,*a:calls.append((p.name,h))or M.encoded(q[p.name])):
   self.assertEqual(M.prior_fence(),M.PRIOR_PINS)
  self.assertEqual(calls,list(M.PRIOR_PINS.items()))
 def test_namespace_paths_do_not_reuse_old_artifacts(self):
  self.assertEqual(M.STREAM,M.JOB/'stream-completion-v2');self.assertEqual(M.WORK,M.STREAM/'onhost-math-completion-v2');self.assertIn('completion-v2',M.UNIT)
  self.assertIn('operator-completion-v2.mjs',M.command('a'*64)[-3]);self.assertIn('math-plan-completion-v2.json',M.command('a'*64)[-2])
 def test_signal_exception_is_runtimeerror_not_selector_interruptederror(self):
  self.assertTrue(issubclass(M.MathInterrupted,RuntimeError));self.assertFalse(issubclass(M.MathInterrupted,InterruptedError))

class RealSignal(unittest.TestCase):
 def exercise(self,sig):
  import io,os,signal,subprocess,sys,tempfile,time
  with tempfile.TemporaryDirectory()as td:
   root=pathlib.Path(td);ready=root/'ready';pidfile=root/'pid';failed=[];r=request();raw=M.encoded(r);digest=M.sha(raw);childs=[];killers=[];before={s:signal.getsignal(s)for s in(signal.SIGINT,signal.SIGTERM,signal.SIGHUP,signal.SIGALRM)}
   def execute(*a):
    M.LAUNCHED=True;M.WORK_CREATED=True
    code='import os,time;from pathlib import Path;Path('+repr(str(pidfile))+').write_text(str(os.getpid()));Path('+repr(str(ready))+').write_text("ready");time.sleep(30)'
    killer='import os,time,signal;from pathlib import Path;p=Path('+repr(str(ready))+');end=time.monotonic()+3\nwhile not p.exists()and time.monotonic()<end:time.sleep(.005)\nassert p.exists();os.kill('+str(os.getpid())+','+str(sig)+')'
    killers.append(subprocess.Popen([sys.executable,'-I','-B','-c',killer]))
    M.C.run_checked([sys.executable,'-I','-B','-c',code],5,65536)
   def utility(b):
    c=M.load_utility_original(b);c.newfile=lambda p,raw,*a:failed.append(json.loads(raw));return c
   def cleanup(*a):os.kill(os.getpid(),signal.SIGINT);return {'verified':True,'ownMockUnit':True}
   M.load_utility_original=M.load_utility;M.LAUNCHED=False;M.WORK_CREATED=False
   with patch.object(M,'execute',side_effect=execute),patch.object(M,'load_utility',side_effect=utility),patch.object(M,'stop',side_effect=cleanup),patch.object(M.os,'geteuid',return_value=0),patch.object(M.os,'getegid',return_value=0),patch.object(M.os,'uname',return_value=types.SimpleNamespace(nodename='pow-bitcoin-01')),patch.object(sys,'argv',['managed',digest]),patch.object(sys,'stdin',types.SimpleNamespace(buffer=io.BytesIO(raw))):
    with self.assertRaises(M.MathInterrupted):M.main()
   for p in killers:self.assertEqual(p.wait(timeout=2),0)
   pid=int(pidfile.read_text());self.assertRaises(ProcessLookupError,os.kill,pid,0);self.assertEqual({s:signal.getsignal(s)for s in before},before);self.assertEqual(len(failed),1);self.assertEqual(failed[0]['errorClass'],'MathInterrupted');self.assertFalse(failed[0]['automaticRetry']);self.assertTrue(failed[0]['cleanup']['verified'])
 def test_actual_sigterm_blocked_selector_reaps_and_durable_failure(self):
  import signal;self.exercise(signal.SIGTERM)
 def test_actual_sigint_blocked_selector_repeated_cleanup_masked(self):
  import signal;self.exercise(signal.SIGINT)

def previous_completion():
 p=json.loads(pathlib.Path('/tmp/pow-audit30-retained-completion-plan-063000-v1.json').read_bytes());assert M.digest(p)==M.PREVIOUS_COMPLETION_PLAN_SHA
 return {'failed.json':dict(schema='pow-audit30-complete-retained-private-stream-failed-v1',status='failed',phase='fresh-side-export',errorClass='RuntimeError',privateStopVerified=True,cleanupErrors=[],productionMutation=False,automaticRetry=False,originalAttemptRemainsFailed=True),'intent.json':dict(schema='pow-audit30-complete-retained-private-stream-plan-v1',plan=p,planSha256=M.PREVIOUS_COMPLETION_PLAN_SHA,sealedSourceFullHashVerifiedBeforeStart=True,bodyRedo=False,newSchemaWrite=False,productionMutation=False)}
class PreviousFailedCompletion(unittest.TestCase):
 def test_actual_prior_plan_canonical_and_failure_qualified(self):
  self.assertEqual(M.validate_previous_completion(previous_completion()),M.PREVIOUS_COMPLETION_PINS)
 def test_prior_failure_never_promoted_or_expanded(self):
  for k,bad in [('status','passed'),('phase','completed'),('privateStopVerified',False),('automaticRetry',True),('cleanupErrors',['unsafe']),('productionMutation',True),('originalAttemptRemainsFailed',False)]:
   with self.subTest(k=k):p=previous_completion();p['failed.json'][k]=bad;self.assertRaises(M.Refused,M.validate_previous_completion,p)
 def test_prior_canonical_controller_unit_plan_and_flags_bound(self):
  for k,bad in [('planSha256','f'*64),('sealedSourceFullHashVerifiedBeforeStart',False),('bodyRedo',True),('newSchemaWrite',True),('productionMutation',True)]:
   with self.subTest(k=k):p=previous_completion();p['intent.json'][k]=bad;self.assertRaises(M.Refused,M.validate_previous_completion,p)
  for k in ('controllerSha256','unit','job','sealedSource'):
   p=previous_completion();p['intent.json']['plan'][k]='foreign';self.assertRaises(M.Refused,M.validate_previous_completion,p)
 def test_previous_proof_scope_cannot_drop_or_add(self):
  p=previous_completion();self.assertRaises(M.Refused,M.validate_previous_completion,{k:v for k,v in p.items()if k!='failed.json'});self.assertRaises(M.Refused,M.validate_previous_completion,p|{'completed.json':{}})
 def test_new_completed_and_intent_preserve_both_failed063000_pins(self):
  for record in (0,1):
   for k in ('priorCompletionFailureSha256','priorCompletionIntentSha256'):
    v,i=stream();(v if record==0 else i)[k]='f'*64;self.assertRaises(M.Refused,M.validate_stream,v,i)
  v,i=stream();v['priorCompletionRemainsFailed']=False;self.assertRaises(M.Refused,M.validate_stream,v,i)
 def test_both_prior_rawhashes_read_from_original_namespace(self):
  q=previous_completion();calls=[]
  with patch.object(M,'metadata_dir'),patch.object(M,'read',side_effect=lambda p,h,*a:calls.append((p.parent,p.name,h))or M.encoded(q[p.name])):self.assertEqual(M.previous_completion_fence(),M.PREVIOUS_COMPLETION_PINS)
  self.assertEqual(calls,[(M.JOB/'stream-completion-v1',k,v)for k,v in M.PREVIOUS_COMPLETION_PINS.items()])
 def test_ecb_controller_only_and_v1_math_source_preserved(self):
  self.assertEqual(M.STREAM_CONTROLLER_SHA,'ecb2b237b93ebd0bde96e5d7d690abbda5b9fa92aaeb0fea47c23e169acf4e8e')
  self.assertEqual(M.sha(pathlib.Path('/tmp/pow-audit30-onhost-math-managed-completion-v1.py').read_bytes()),'897cbacdf763975407e6f583044e9e2f5f1e4c2ba7606d2bc975dd11b19f7995')
  v,i=stream();i['plan']['controllerSha256']=M.PREVIOUS_COMPLETION_CONTROLLER_SHA;v['planSha256']=i['planSha256']=M.digest(i['plan']);self.assertRaises(M.Refused,M.validate_stream,v,i)

if __name__=='__main__':unittest.main()
