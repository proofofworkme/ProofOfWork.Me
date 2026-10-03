import ast,base64,hashlib,importlib.util,json,subprocess,types,unittest
from pathlib import Path
from unittest.mock import patch
P=Path('/tmp/pow-audit30-production-physical-sizing-transport-preparation-v2.py');s=importlib.util.spec_from_file_location('C',P);C=importlib.util.module_from_spec(s);s.loader.exec_module(C)
s=importlib.util.spec_from_file_location('T','/tmp/pow-audit30-production-physical-sizing-native-v2.test.py');T=importlib.util.module_from_spec(s);s.loader.exec_module(T)
class Tests(unittest.TestCase):
 def test_caller_preparation_is_unexecutable_without_fresh_request(self):
  with patch.object(C.sys,'argv',['source']),patch.object(C.Path,'read_bytes')as read,self.assertRaisesRegex(ValueError,'request remains absent'):C.main()
  read.assert_not_called()
 def test_bootstrap_embeds_exact_frozen_root_bytes_no_request_rewrite(self):
  tree=ast.parse(C.B.read_bytes());names={n.targets[0].id:ast.literal_eval(n.value)for n in tree.body if isinstance(n,ast.Assign)and isinstance(n.targets[0],ast.Name)and n.targets[0].id in('CODE','SHA')};raw=base64.b64decode(names['CODE'],validate=True);self.assertEqual(raw,C.N.read_bytes());self.assertEqual(hashlib.sha256(raw).hexdigest(),C.NP);self.assertEqual(names['SHA'],C.NP);self.assertNotIn('stdin',C.B.read_text());self.assertLess(C.B.stat().st_size,32768)
 def test_actual_isolated_bad_request_cli_refuses_without_external_commands(self):
  r=subprocess.run(['/usr/bin/python3','-I','-B',str(C.B),'0'*64],input=b'{}',capture_output=True,timeout=3)
  self.assertEqual(r.returncode,1);self.assertEqual(r.stdout,b'');v=json.loads(r.stderr);self.assertEqual(set(v),{'schema','errorClass','reasonSha256','productionMutation'});self.assertFalse(v['productionMutation']);self.assertEqual(v['errorClass'],'ValueError')
 def test_null_request_template_fails_actual_definition_validator(self):
  n=types.ModuleType('reviewed_root');exec(compile(C.N.read_bytes(),str(C.N),'exec'),n.__dict__)
  with self.assertRaisesRegex(ValueError,'FRESH_CHOSEN_FIVE'):n.decode(Path('/tmp/pow-audit30-production-physical-sizing-request-template-v2.json').read_bytes())
 def test_exact_local_input_binding_and_shared_capture_deadline_once(self):
  request=T.N.encoded(T.request());rp=hashlib.sha256(request).hexdigest();m=types.ModuleType('fixture_transport');seen=[]
  def bound(path,pin,cap):
   seen.append((path,pin,cap));return request if path==C.R else path.read_bytes()
  m.bound=bound;m.remote_command=lambda b,r:['fixed',r];m.execute=unittest.mock.Mock(return_value={'exitCode':0,'failure':None})
  original=compile;factory=types.ModuleType
  with patch.object(C,'RP',rp),patch.object(C.sys,'argv',['source']),patch.object(C.types,'ModuleType',side_effect=lambda name:m if name=='reviewed_owned_transport'else factory(name)):
   # Prevent the imported reviewed transport definitions from replacing our recorder.
   with patch('builtins.compile',side_effect=lambda raw,path,mode:original(b'pass'if path==str(C.H)else raw,path,mode)):
    self.assertEqual(C.main(),0)
  self.assertEqual(seen,[(C.B,C.BP,32768),(C.R,rp,65536),(C.N,C.NP,16384)]);m.execute.assert_called_once();args=m.execute.call_args.args;self.assertEqual(args[1],request);self.assertEqual(args[2],'/tmp/pow-audit30-production-physical-sizing-native-v2');self.assertEqual(args[3],600);self.assertTrue(m.execute.call_args.kwargs['bindings']['clientUnitCapsDoNotConstrainProductionBackends'])
 def test_shared_transport_hash_drift_refuses_before_binding_or_network(self):
  with patch.object(C,'RP','0'*64),patch.object(C.sys,'argv',['source']),patch.object(C.Path,'read_bytes',return_value=b'changed'),self.assertRaisesRegex(ValueError,'shared'):C.main()
if __name__=='__main__':unittest.main()
