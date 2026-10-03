#!/usr/bin/python3 -I
import ast,base64,contextlib,hashlib,io,json,types,unittest
from pathlib import Path
from unittest.mock import patch
BASE='/tmp/pow-audit30-retained-repair-dependency-bridge-'
def module(p):
 m=types.ModuleType('fixture_'+p.name);m.__file__=str(p);exec(compile(p.read_bytes(),str(p),'exec'),m.__dict__);return m
C=module(Path(BASE+'transport-preparation-v3.py'));B=module(Path(BASE+'v3.py'));T=module(Path(BASE+'v3.test.py'))
class CallerTests(unittest.TestCase):
 def test_bootstrap_decodes_exact_frozen_bridge(self):
  tree=ast.parse(C.B.read_bytes());assigns={n.targets[0].id:ast.literal_eval(n.value)for n in tree.body if isinstance(n,ast.Assign)and isinstance(n.value,ast.Constant)};raw=base64.b64decode(assigns['CODE'],validate=True);self.assertEqual(raw,C.N.read_bytes());self.assertEqual(hashlib.sha256(raw).hexdigest(),assigns['SHA']);self.assertEqual(assigns['SHA'],C.NP)
 def test_null_template_cannot_admit(self):
  r=Path(BASE+'request-template-v3.json').read_bytes();self.assertLess(len(r),131072)
  with self.assertRaisesRegex(ValueError,'FRESH_ORIGINAL'):B.decode(r)
 def test_unbound_caller_refuses_before_helper(self):
  with patch.object(C,'transport',side_effect=AssertionError('called')):
   with self.assertRaisesRegex(ValueError,'request remains absent'):C.main()
 def test_actual_stdin_bad_role_refusal_no_creation(self):
  import subprocess,sys
  r=subprocess.run([sys.executable,'-I','-B',str(C.B),'a'*64],input=b'{}',capture_output=True,timeout=3);self.assertEqual(r.returncode,1);self.assertEqual(r.stdout,b'');v=json.loads(r.stderr);self.assertFalse(v['productionMutation']);self.assertEqual(v['errorClass'],'ValueError')
 def test_bound_caller_uses_only_original_owned_transport(self):
  raw=B.encoded(T.request());rp=hashlib.sha256(raw).hexdigest();seen=[]
  def bound(p,pin,cap):
   seen.append(('bound',str(p),pin,cap));return raw if p==C.R else p.read_bytes()
  def execute(args,r,prefix,seconds,**kw):
   self.assertEqual(args,['fixed-ssh',C.B.read_bytes(),rp]);self.assertEqual(r,raw);self.assertEqual(seconds,90);self.assertEqual(kw['stdout_cap'],65536);self.assertEqual(kw['stderr_cap'],65536);self.assertFalse(kw['bindings']['sqlExecuted']);self.assertFalse(kw['bindings']['retirementAdmissionClaimed']);self.assertEqual(prefix,BASE+'native-v3');return dict(exitCode=0,failure=None)
  m=types.SimpleNamespace(bound=bound,remote_command=lambda b,h:['fixed-ssh',b,h],execute=execute)
  with patch.object(C,'RP',rp),patch.object(C,'transport',return_value=m),contextlib.redirect_stdout(io.StringIO()):self.assertEqual(C.main(),0)
  self.assertEqual(len(seen),3);self.assertEqual(seen[1][-1],131072)
 def test_retirement_bridge_preserves_original_dependency_source(self):
  raw=C.N.read_bytes();self.assertIn(b'R.dependency_context()',raw);self.assertIn(b'I.verify_pg_dependencies(m.C.OLD',raw);self.assertNotIn(b'R.main(',raw);self.assertNotIn(b'C.previous(',raw);self.assertNotIn(b'S.clone_stopped(',raw);self.assertNotIn(b'I.verify_source(',raw);self.assertIn(b'M.command=metadata_command',raw)
if __name__=='__main__':unittest.main()
