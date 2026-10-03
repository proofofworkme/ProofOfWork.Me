import ast,base64,hashlib,json,re,types,unittest
from pathlib import Path
OLD='20261003T145500Z';NEW='20261003T152000Z'
T=Path('/tmp/pow-audit30-readonly-owned-transport-v3.py');assert hashlib.sha256(T.read_bytes()).hexdigest()=='1dedef0a6c7021d114017e711ad74f9cfed4e461fc047a2be2c49e590f3da18e';f=next(x for x in ast.parse(T.read_bytes()).body if isinstance(x,ast.FunctionDef)and x.name=='execute');prefix_code=compile(ast.Module(body=f.body[:2],type_ignores=[]),str(T),'exec')
def need(v,c):
 if not v:raise ValueError(c)
class Tests(unittest.TestCase):
 def test_envelope_exact_single_runid_reversal(self):
  for mode in ('prepare','run'):
   old=Path('/tmp/pow-audit30-body-'+mode+'-envelope-'+OLD+'-v1.json').read_bytes();new=Path('/tmp/pow-audit30-body-'+mode+'-envelope-'+NEW+'-v1.json').read_bytes();self.assertEqual(new.count(NEW.encode()),1);self.assertEqual(new.replace(NEW.encode(),OLD.encode()),old)
 def test_exact_native_source_decode_and_approved_authority(self):
  for mode in ('prepare','run'):
   x=json.loads(Path('/tmp/pow-audit30-body-'+mode+'-envelope-'+NEW+'-v1.json').read_bytes());b=base64.b64decode(x['rootControlBase64'],validate=True);self.assertEqual(hashlib.sha256(b).hexdigest(),'b989a3f2395e7cbf13cb2d3dbd2d258a3fd21867131e41644c094772aba11168');R=types.ModuleType('inert');R.__file__='/reviewed/root.py';exec(compile(b,R.__file__,'exec'),R.__dict__);R.decode(x['request']);self.assertEqual(x['request']['approval']['sha256'],'f37e16a1d9b8c6f52081a7c44d01d8a5142051770d7d16aafe9fcaa9e5354c42');self.assertEqual(x['request']['runId'],NEW)
 def test_prepare_run_mode_only(self):
  p=json.loads(Path('/tmp/pow-audit30-body-prepare-envelope-'+NEW+'-v1.json').read_bytes());r=json.loads(Path('/tmp/pow-audit30-body-run-envelope-'+NEW+'-v1.json').read_bytes());p['request']['mode']='run';self.assertEqual(p,r)
 def test_callers_exact_namespace_hash_reversal(self):
  for mode in ('prepare','run'):
   old=Path('/tmp/pow-audit30-body-'+mode+'-owned-caller-v2.py').read_bytes();new=Path('/tmp/pow-audit30-body-'+mode+'-owned-caller-152000-v1.py').read_bytes();oldp='/tmp/pow-audit30-body-'+mode+'-envelope-'+OLD+'-v1.json';newp=oldp.replace(OLD,NEW);oldsha=hashlib.sha256(Path(oldp).read_bytes()).hexdigest();newsha=hashlib.sha256(Path(newp).read_bytes()).hexdigest();self.assertEqual(new.replace(newp.encode(),oldp.encode()).replace(newsha.encode(),oldsha.encode()).replace(NEW.lower().encode(),OLD.lower().encode()),old)
 def test_actual_frozen_capture_prefix_predicate(self):
  for mode in ('prepare','run'):
   p='/tmp/pow-audit30-body-'+mode+'-native-'+NEW.lower()+'-v1';exec(prefix_code,{'Path':Path,'re':re,'need':need,'prefix':p})
   with self.assertRaisesRegex(ValueError,'Fixed exclusive local capture prefix'):exec(prefix_code,{'Path':Path,'re':re,'need':need,'prefix':p.replace(NEW.lower(),NEW)})
if __name__=='__main__':unittest.main()
