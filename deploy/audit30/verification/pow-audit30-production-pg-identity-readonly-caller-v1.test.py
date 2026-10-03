import ast,hashlib,sys,types,unittest
from pathlib import Path
P=Path('/tmp/pow-audit30-production-pg-identity-readonly-caller-v1.py');D=types.ModuleType('caller_test');exec(compile(P.read_bytes(),str(P),'exec'),D.__dict__)
class Tests(unittest.TestCase):
 def test_exact_pins(self):
  for p,h in((D.H,D.HP),(D.S,D.SP),(D.R,D.RP)):self.assertEqual(hashlib.sha256(p.read_bytes()).hexdigest(),h)
 def test_exact_request_inert(self):
  s=types.ModuleType('definitions');exec(compile(D.S.read_bytes(),str(D.S),'exec'),s.__dict__);s.decode(D.R.read_bytes())
 def test_unchanged_limits_and_no_stop(self):
  s=P.read_text();self.assertIn('90,stdout_cap=65536,stderr_cap=65536',s);self.assertIn("'rootWholeSeconds':60",s);self.assertIn("'unitCreationOrControl':False",s);self.assertNotIn('systemctl',s)
 def test_directargv_refuses(self):
  from unittest.mock import patch
  with patch.object(sys,'argv',['caller','extra']):
   with self.assertRaisesRegex(ValueError,'Fixed isolated'):D.main()
if __name__=='__main__':unittest.main()
