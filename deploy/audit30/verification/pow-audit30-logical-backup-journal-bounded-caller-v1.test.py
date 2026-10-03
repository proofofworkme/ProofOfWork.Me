#!/usr/bin/python3 -I
import ast,hashlib,json,sys,tempfile,types,unittest
from pathlib import Path
from unittest.mock import patch
P=Path('/tmp/pow-audit30-logical-backup-journal-bounded-caller-v1.py')
C=types.ModuleType('fixture');C.__file__=str(P);exec(compile(P.read_bytes(),str(P),'exec'),C.__dict__)
class CallerTests(unittest.TestCase):
 def test_exact_source_request_and_transport_pins(self):
  for p,h in((C.S,C.SP),(C.R,C.RP),(C.H,C.HP)):self.assertEqual(hashlib.sha256(p.read_bytes()).hexdigest(),h)
  self.assertLess(len(C.S.read_bytes()),32768);self.assertLess(len(C.R.read_bytes()),65536)
 def test_bad_request_hash_refuses_before_ssh(self):
  with tempfile.NamedTemporaryFile(prefix='pow-audit30-journal-caller-refusal-',dir='/tmp')as f:
   f.write(b'{}');f.flush()
   with patch.object(C,'R',Path(f.name)),patch.object(C.sys,'argv',['fixed-caller']):
    with self.assertRaisesRegex(ValueError,'Local input path/hash drift'):C.main()
 def test_unchanged_owned_capture_closed_budgets(self):
  tree=ast.parse(P.read_bytes());f=next(n for n in tree.body if isinstance(n,ast.FunctionDef)and n.name=='main');execute=next(n for n in ast.walk(f)if isinstance(n,ast.Call)and ast.unparse(n.func)=='m.execute');self.assertEqual(ast.literal_eval(execute.args[2]),'/tmp/pow-audit30-logical-backup-journal-bounded-native-v1');self.assertEqual(ast.literal_eval(execute.args[3]),120);kw={n.arg:n.value for n in execute.keywords};self.assertEqual(ast.literal_eval(kw['stdout_cap']),65536);self.assertEqual(ast.literal_eval(kw['stderr_cap']),65536);self.assertEqual(ast.unparse(execute.args[0]),'m.remote_command(source, RP)');self.assertEqual(ast.unparse(execute.args[1]),'request')
if __name__=='__main__':unittest.main()
