import ast,hashlib,io,json,pathlib,signal,time,types,unittest,urllib.request,urllib.error
P=pathlib.Path('/tmp/pow-audit30-node-shadow-prepare-38ac-v2.py');S=P.read_text();T=ast.parse(S);R=next(n.value.value for n in T.body if isinstance(n,ast.Assign)and any(isinstance(k,ast.Name)and k.id=='REMOTE'for k in n.targets));tree=ast.parse(R)
NAMES={'need','stop_owned','value','sanitize','health_timeout','record_health','health_observations','probe_health'}
VARS={'BOOL_PATHS','NUMBER_PATHS','HASH_PATHS','REASON_PATHS','ENUMS','HEALTH_BODY_CAP','HEALTH_REQUEST_MAX_SECONDS','HEALTH_WHOLE_SECONDS','HEALTH_RESPONSE_SAMPLES','HEALTH_RESPONSE_COUNT','HEALTH_STATUS_COUNTS','HEALTH_ERROR_COUNTS'}
F=ast.Module(body=[n for n in tree.body if isinstance(n,ast.FunctionDef)and n.name in NAMES or isinstance(n,ast.Assign)and any(isinstance(k,ast.Name)and k.id in VARS for k in n.targets)or isinstance(n,ast.ClassDef)and n.name=='NoRedirect'],type_ignores=[])
class FakeSignal:
 SIGALRM=14;ITIMER_REAL=0
 def __init__(self):self.old='old-handler';self.calls=[]
 def signal(self,s,h):self.calls.append(('signal',s,h));return self.old
 def setitimer(self,t,s):self.calls.append(('timer',t,s))
class Response:
 def __init__(self,status,body):self.status=status;self.body=io.BytesIO(body)
 def read(self,size):return self.body.read(size)
 def __enter__(self):return self
 def __exit__(self,*a):self.body.close()
class Tests(unittest.TestCase):
 def namespace(self,status=200,payload=None,error=None,body=None):
  signal=FakeSignal();open_calls=[];response=Response(status,body if body is not None else json.dumps(payload if payload is not None else {'ready':True,'available':True}).encode())
  class Opener:
   def open(self,url,timeout):
    open_calls.append((url,timeout))
    if error:raise error
    return response
  request=types.SimpleNamespace(HTTPRedirectHandler=urllib.request.HTTPRedirectHandler,ProxyHandler=urllib.request.ProxyHandler,build_opener=lambda *a:Opener())
  ns=dict(json=json,hashlib=hashlib,re=__import__('re'),datetime=__import__('datetime'),time=time,signal=signal,urllib=types.SimpleNamespace(request=request,error=urllib.error));exec(compile(F,'actual-readiness-functions','exec'),ns);return ns,signal,open_calls
 def stop_fixture(self,inv='a'*32,command=True,missing=False,stopped=True):
  calls=[];unit='fixed-shadow.service';tools=pathlib.Path('/var/tmp/proofofwork-deploy/audit29-tools');states=[{'LoadState':'not-found'}if missing else {'LoadState':'loaded','InvocationID':inv,'ExecStart':str(tools/'private-env.py')if command else'foreign-source'}, {'MainPID':'0'if stopped else'7'}];ns,_,_=self.namespace();ns.update(UNIT=unit,TOOLS=tools,state=lambda u:states.pop(0),call=lambda a,t:calls.append((a,t)));return ns,calls
 def test_exact_stage_and_unique_namespace(self):
  r=json.loads(pathlib.Path('/tmp/pow-audit30-node-candidate-stage-38ac-native-v2.json').read_bytes())['result'];self.assertIn(r['candidateAttestationSha256'],R);self.assertIn('38ac6e2bff2a-20261003T042000Z',R);self.assertFalse(r['cutover']);self.assertNotIn('38ac6e2bff2a-20261003T040230Z',R)
 def test_ready_true_http200_required(self):
  ns,_,_=self.namespace();self.assertTrue(ns['probe_health'](120)['readyPassed'])
 def test_http200_readyfalse_rejected(self):
  ns,_,_=self.namespace(payload={'ready':False});self.assertFalse(ns['probe_health'](120)['readyPassed'])
 def test_http503_readytrue_rejected(self):
  ns,_,_=self.namespace(status=503);self.assertFalse(ns['probe_health'](120)['readyPassed'])
 def test_503_exact_predicates_private_fields_omitted(self):
  ns,_,_=self.namespace(status=503,payload={'ready':False,'checks':{'worker':{'ok':False,'error':'private-sensitive-error'}},'body':'private-sensitive-body'});r=ns['probe_health'](120);self.assertEqual(r['status'],503);self.assertFalse(r['predicates']['booleans']['checks.worker.ok']);self.assertNotIn('private-sensitive',json.dumps(r))
 def test_http_error_body_classified_without_ready(self):
  err=urllib.error.HTTPError('http://127.0.0.1:18081/health',503,'failure',{},io.BytesIO(b'{"ready":false}'));ns,_,_=self.namespace(error=err);r=ns['probe_health'](120);self.assertEqual(r['status'],503);self.assertFalse(r['readyPassed'])
 def test_request_alarm_respects_remaining_wholedeadline(self):
  ns,s,c=self.namespace();ns['probe_health'](.15);self.assertIn(('timer',0,.15),s.calls);self.assertEqual(c,[('http://127.0.0.1:18081/health',.15)]);self.assertIn(('timer',0,0),s.calls)
 def test_request_alarm_max30(self):
  ns,s,c=self.namespace();ns['probe_health'](120);self.assertIn(('timer',0,30),s.calls);self.assertEqual(c[0][1],30)
 def test_expired_wholedeadline_refuses_before_request(self):
  ns,_,c=self.namespace();self.assertRaisesRegex(ValueError,'HEALTH_DEADLINE',ns['probe_health'],0);self.assertEqual(c,[])
 def test_sockettimeout_classified_and_alarm_restored(self):
  ns,s,_=self.namespace(error=TimeoutError('private'));r=ns['probe_health'](120);self.assertEqual(r['errorClass'],'TimeoutError');self.assertFalse(r['readyPassed']);self.assertIn(('timer',0,0),s.calls)
 def test_parent_signal_propagates_not_swallowed(self):
  ns,s,_=self.namespace(error=RuntimeError('SHADOW_PREPARE_SIGNAL'));self.assertRaisesRegex(RuntimeError,'PREPARE_SIGNAL',ns['probe_health'],120);self.assertIn(('timer',0,0),s.calls)
 def test_body_cap_cannot_admit_large_response(self):
  ns,_,_=self.namespace(body=b'x'*65537);r=ns['probe_health'](120);self.assertEqual(r['errorClass'],'ValueError');self.assertFalse(r['readyPassed'])
 def test_malformed_json_cannot_admit(self):
  ns,_,_=self.namespace(body=b'private');r=ns['probe_health'](120);self.assertEqual(r['errorClass'],'JSONDecodeError');self.assertFalse(r['readyPassed'])
 def test_strict_field_type_cannot_admit(self):
  ns,_,_=self.namespace(payload={'ready':'true'});r=ns['probe_health'](120);self.assertEqual(r['errorClass'],'AssertionError');self.assertFalse(r['readyPassed'])
 def test_first_last_samples_and_all_counts_bounded(self):
  ns,_,_=self.namespace()
  for i in range(100):ns['record_health']({'status':503,'readyPassed':False,'errorClass':'TimeoutError'})
  r=ns['health_observations']();self.assertEqual(r['totalCount'],100);self.assertEqual(r['statusCounts'],{'503':100});self.assertEqual(r['errorCounts'],{'TimeoutError':100});self.assertEqual([x['sequence']for x in r['samples']],list(range(1,11))+list(range(91,101)))
 def test_owned_stop_only_exact_unit(self):
  ns,c=self.stop_fixture();ns['stop_owned']('a'*32);self.assertEqual(c,[(['/usr/bin/systemctl','stop','fixed-shadow.service'],40)])
 def test_changed_invocation_not_stopped(self):
  ns,c=self.stop_fixture(inv='b'*32);self.assertRaisesRegex(ValueError,'IDENTITY_DRIFT',ns['stop_owned'],'a'*32);self.assertEqual(c,[])
 def test_changed_command_not_stopped(self):
  ns,c=self.stop_fixture(command=False);self.assertRaisesRegex(ValueError,'IDENTITY_DRIFT',ns['stop_owned'],'a'*32);self.assertEqual(c,[])
 def test_missing_unit_no_stop(self):
  ns,c=self.stop_fixture(missing=True);ns['stop_owned']('a'*32);self.assertEqual(c,[])
 def test_stop_failure_refuses(self):
  ns,c=self.stop_fixture(stopped=False);self.assertRaisesRegex(ValueError,'STOP_REFUSED',ns['stop_owned'],'a'*32);self.assertEqual(len(c),1)
 def test_old_private_controls_preserved(self):
  for k in ['RuntimeMaxSec=45min','MemoryMax=4G','CPUQuota=100%','TasksMax=128','readonly-shadow','OPS_LOCK_AFTER_ACQUISITION','LIVE_IDENTITY_CHANGED',"HEALTH_WHOLE_SECONDS=120","HEALTH_REQUEST_MAX_SECONDS=30","signal.signal(signal.SIGTERM,signal.SIG_IGN)","write('shadow-health-observations.json',health_observations())"]:self.assertIn(k,R)
  self.assertNotIn('unlink(',R);self.assertNotIn('rmtree(',R);self.assertIn('ProxyHandler({})',R);self.assertIn('NoRedirect()',R)
if __name__=='__main__':unittest.main()
