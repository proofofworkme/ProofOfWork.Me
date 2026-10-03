import base64,copy,hashlib,importlib.util,json,pathlib,types,unittest
from unittest.mock import patch
sp=importlib.util.spec_from_file_location('M','/tmp/pow-audit30-onhost-math-managed-v2.py');M=importlib.util.module_from_spec(sp);sp.loader.exec_module(M)
def plan():
 return {'schema':'pow-audit30-saved-transition-onhost-math-plan-v2','operatorSHA256':M.OPERATOR_SHA,'privateJob':str(M.JOB),'evidenceDirectory':str(M.STREAM),'sourceCopyManifestSHA256':'a'*64,'inputs':{s:{'bytes':2,'sha256':'b'*64}for s in M.INPUT_SUFFIXES},'historicalPlan':{'sourceFenceSha256':M.SOURCE_FENCE_SHA}}
def request():
 p=M.encoded(plan());u=pathlib.Path('/tmp/pow-audit30-onhost-math-source-copy-v3.py').read_bytes()
 return {'schema':'pow-audit30-onhost-math-managed-request-v2','utilityBase64':base64.b64encode(u).decode(),'sourceCopyCompletionSha256':'c'*64,'sourceCopyManifestSha256':'a'*64,'streamCompletedSha256':'d'*64,'streamIntentSha256':'e'*64,'outputPropertyProbeSha256':M.OUTPUT_PROBE_SHA,'mathPlanBase64':base64.b64encode(p).decode(),'mathPlanSha256':M.sha(p),'nodeMetadata':{},'attestorMetadata':{},'publisherMetadata':{},'liveFive':{k:{'MainPID':'1','InvocationID':'a'*32}for k in M.LIVE}}
def stream():
 p={'job':str(M.JOB),'controllerSha256':'e9801d372d05c94c40b609749e502ab1eb5e06f4f2561fa08d9c6a25c9313599'};h=M.digest(p);i={'plan':p,'planSha256':h};v={'schema':'pow-audit30-private-stream-followup-completed-v1','status':'passed','planSha256':h,'bodyRehearsal':{'rollbackOnly':True,'allFourNativeFingerprintsRestored':True,'productionApplyApproved':False,'selected':16,'missing':0}}
 for k in ('previousInspectionEvidenceUnchanged','sealedSourceFullHashVerifiedBeforeStart','sealedSourceFullHashVerifiedAtStop','sourceContextAndSavedFenceUnchanged','fullNativeByteEquality','privateClusterStopped','liveServicesUnchanged','bodyAccepted'):v[k]=True
 for k in ('productionDatabaseMutation','sealedSourceStarted','mathAccepted','allHistoricalReplay'):v[k]=False
 return v,i
def unit():return dict(LoadState='loaded',Type='exec',Transient='yes',RemainAfterExit='yes',User='postgres',Group='postgres',InvocationID='a'*32,MainPID='1',ControlGroup='/system.slice/'+M.UNIT,ActiveState='active',SubState='running',Result='success',ExecMainStatus='0')
class Tests(unittest.TestCase):
 def test_fixed_operator_node_argv_no_sql_or_pg_start(self):
  a=M.command('a'*64);self.assertEqual(a[:3],['/usr/bin/env','-i','PATH=/usr/bin:/bin']);self.assertEqual(a[-2:], [str(M.PACKAGE/'math-plan.json'),'a'*64]);self.assertEqual(a[-3],str(M.PACKAGE/'operator.mjs'))
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
  for k in ('previousInspectionEvidenceUnchanged','sealedSourceFullHashVerifiedBeforeStart','sealedSourceFullHashVerifiedAtStop','sourceContextAndSavedFenceUnchanged','fullNativeByteEquality','privateClusterStopped','liveServicesUnchanged','bodyAccepted'):
   with self.subTest(k=k):self.assertRaises(M.Refused,M.validate_stream,v|{k:False},i)
  for k in ('productionDatabaseMutation','sealedSourceStarted','mathAccepted','allHistoricalReplay'):
   with self.subTest(k=k):self.assertRaises(M.Refused,M.validate_stream,v|{k:True},i)
 def test_changed_canonical_intent_refuses(self):
  v,i=stream();i['plan']['controllerSha256']='f'*64;self.assertRaises(M.Refused,M.validate_stream,v,i)
 def test_body_subset_or_inverse_refuses(self):
  v,i=stream()
  for k,bad in [('rollbackOnly',False),('allFourNativeFingerprintsRestored',False),('productionApplyApproved',True),('selected',15),('missing',1)]:
   with self.subTest(k=k):r=copy.deepcopy(v);r['bodyRehearsal'][k]=bad;self.assertRaises(M.Refused,M.validate_stream,r,i)
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
if __name__=='__main__':unittest.main()
