#!/usr/bin/python3 -I
import ast,base64,hashlib,importlib.util,json,subprocess,sys,unittest
from pathlib import Path
from unittest.mock import patch
C=Path('/tmp/pow-audit30-coupled-pin-checker-package-transport-preparation-v1.py')
S=Path('/tmp/pow-audit30-coupled-pin-checker-package-creator-v1.py')
B=Path('/tmp/pow-audit30-coupled-pin-checker-package-bootstrap-v1.py')
T=Path('/tmp/pow-audit30-coupled-pin-checker-package-request-template-v1.json')
def module(name,p):
 spec=importlib.util.spec_from_file_location(name,p);m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m);return m
def constants(path):return{n.targets[0].id:ast.literal_eval(n.value)for n in ast.parse(path.read_bytes()).body if isinstance(n,ast.Assign)and len(n.targets)==1 and isinstance(n.targets[0],ast.Name)and isinstance(n.value,ast.Constant)}
class Tests(unittest.TestCase):
 def test_bootstrap_exact_creator_and_caller_raw_pins(self):
  b=constants(B);c=constants(C);self.assertEqual(base64.b64decode(b['CODE'],validate=True),S.read_bytes());self.assertEqual(b['SHA'],hashlib.sha256(S.read_bytes()).hexdigest());self.assertEqual(c['BP'],hashlib.sha256(B.read_bytes()).hexdigest());self.assertEqual(c['SP'],b['SHA']);self.assertEqual(c['HP'],hashlib.sha256(Path('/tmp/pow-audit30-readonly-owned-transport-v3.py').read_bytes()).hexdigest())
 def test_null_caller_refuses_before_any_read_or_transport(self):
  m=module('caller',C);self.assertIsNone(m.RP)
  with patch.object(m.sys,'argv',[str(C)]),patch.object(Path,'read_bytes',side_effect=AssertionError('no file read before approval')),self.assertRaisesRegex(ValueError,'Actual human'):m.main()
 def test_template_only_reviewed_code_payloads_no_approval_or_plan(self):
  p=module('creator',S);v=json.loads(T.read_bytes());self.assertEqual(set(v['files']),set(p.CAPS));self.assertIsNone(v['planSha256'])
  for name,(size,h)in p.FIXED.items():
   r=v['files'][name];b=base64.b64decode(r['base64'],validate=True);self.assertEqual((len(b),hashlib.sha256(b).hexdigest()),(size,h))
  for name in('approval.json','human-approval-message.txt','plan.json'):self.assertIsNone(v['files'][name])
  with self.assertRaises(ValueError):p.decode(T.read_bytes())
 def test_no_concrete_request_created_and_fixed_transport_only(self):
  self.assertFalse(Path('/tmp/pow-audit30-coupled-pin-checker-package-request-v1.json').exists());s=C.read_text();self.assertIn("'/tmp/pow-audit30-coupled-pin-checker-package-native-v1',150",s);self.assertIn('stdout_cap=65536,stderr_cap=65536',s);self.assertIn('c.decode(request)',s);self.assertNotIn('c.create(',s);self.assertNotIn('c.main(',s)
 def test_input_alarm_and_limits_precede_typed_stdin(self):
  s=S.read_text();main=s[s.index('def main():'):];self.assertLess(main.index('signal.setitimer(signal.ITIMER_REAL,120)'),main.index('sys.stdin.buffer.read'));self.assertIn('128*1024**2',main);self.assertIn('resource.RLIMIT_CPU,(60,60)',main);self.assertIn("sourceMessageSha256",s)
 def test_actual_null_caller_process_never_reaches_remote(self):
  r=subprocess.run([sys.executable,'-I','-B',str(C)],capture_output=True,timeout=5);self.assertEqual(r.returncode,1);self.assertEqual(r.stdout,b'');self.assertIn(b'Actual human-approved package request remains absent',r.stderr)
if __name__=='__main__':unittest.main()
