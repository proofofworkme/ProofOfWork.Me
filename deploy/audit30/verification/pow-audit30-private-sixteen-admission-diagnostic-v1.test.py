import hashlib,importlib.util,json,types,unittest
from pathlib import Path
from unittest.mock import patch
S='/tmp/pow-audit30-private-sixteen-admission-diagnostic-v1.py'
spec=importlib.util.spec_from_file_location('diagnostic',S);D=importlib.util.module_from_spec(spec);spec.loader.exec_module(D)
C=types.ModuleType('child');exec(compile(D.CHILD,'child','exec'),C.__dict__)
RAW=Path('/tmp/pow-audit30-private-sixteen-supervision-plan-071500-v2.json').read_bytes();PLAN=json.loads(RAW)
class Tests(unittest.TestCase):
 def fake(self,fail=None):
  calls=[]
  def call(n,value=None):
   def f(*args,**kw):
    calls.append((n,args,kw))
    if fail==n:raise ValueError('PRIVATE-SENTINEL-MUST-NOT-BE-PRINTED')
    return value
   return f
  G=types.SimpleNamespace(metadata=call('metadata',dict(uid=0,gid=0,mode=0o440,nlink=1,bytes=len(RAW))),validate_managed_credential=call('managed'),check_live=call('live'),storage_sample=call('capacity'))
  inv={'previousUnit':'previous.service'};oldp={'old':True}
  P=types.SimpleNamespace(load=call('load'),completed_lineage=call('lineage',oldp),G=G,I=types.SimpleNamespace(pairs=D.module(__import__('base64').b64decode(D.BOOTSTRAP_BASE64)).pairs),validate=call('validate',PLAN),runtime=call('runtime'),C=types.SimpleNamespace(package=call('completed-package',({},inv,{})),previous=call('previous'),previous_completion=call('previous-completion'),inputs=call('inputs')),math_proof=call('math'),package=call('package'),S=types.SimpleNamespace(clone_stopped=call('stopped'),unchanged=call('unchanged')),JOB=Path('/data/proofofwork-audit30-inspect-20261003T014100Z'))
  return P,calls
 def test_exact_credential_original_plan_and_runtime_context_only(self):
  P,calls=self.fake()
  with patch.object(Path,'read_bytes',return_value=RAW):r=C.run_stages(P)
  self.assertEqual(r['status'],'read-only-stages-passed');self.assertEqual(len(r['passedStages']),14)
  runtime=next(x for x in calls if x[0]=='runtime')[1][0]
  self.assertEqual(runtime,PLAN|{'unit':D.UNIT});self.assertEqual(PLAN['unit'],'proofofwork-audit30-private-sixteen-20261003T071500Z.service')
  package=next(x for x in calls if x[0]=='package')[1][0];self.assertEqual(package,PLAN)
  managed=next(x for x in calls if x[0]=='managed')[1];self.assertEqual(managed[1:],(D.UNIT,'private-sixteen-diagnostic-plan',D.OLD/'reviewed-plan.json'))
 def test_closed_guard_and_private_reason_hash_only(self):
  for n,stage in [('load','frozen-load'),('runtime','same-hardening-runtime'),('math','public-math-proof'),('package','original-private-package'),('stopped','current-clone-stopped')]:
   P,calls=self.fake(n)
   with patch.object(Path,'read_bytes',return_value=RAW):r=C.run_stages(P)
   self.assertEqual(r['status'],'read-only-guard-refused');self.assertEqual(r['failedStage'],stage);self.assertEqual(r['errorClass'],'ValueError');self.assertEqual(r['errorReasonSha256'],hashlib.sha256(b'PRIVATE-SENTINEL-MUST-NOT-BE-PRINTED').hexdigest());self.assertNotIn('SENTINEL',json.dumps(r))
 def test_original_raw_plan_tamper_refuses_before_runtime(self):
  P,calls=self.fake()
  with patch.object(Path,'read_bytes',return_value=RAW+b' '):r=C.run_stages(P)
  self.assertEqual(r['failedStage'],'original-plan-and-managed-credential');self.assertFalse(any(x[0]=='runtime'for x in calls))
 def test_frozen_bootstrap_pin_and_no_operational_calls(self):
  raw=__import__('base64').b64decode(D.BOOTSTRAP_BASE64);self.assertEqual(hashlib.sha256(raw).hexdigest(),D.BOOTSTRAP_SHA)
  with self.assertRaises(ValueError):D.module(raw+b' ')
  P,calls=self.fake()
  with patch.object(Path,'read_bytes',return_value=RAW):r=C.run_stages(P)
  self.assertEqual([x[0]for x in calls if x[0]in('pg_ctl','flock','source-full-hash','query','work-mkdir')],[])
  self.assertNotIn('check_window',D.CHILD);self.assertNotIn('verify_source',D.CHILD)
if __name__=='__main__':unittest.main()
