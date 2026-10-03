import hashlib,importlib.util,types,unittest
from pathlib import Path
from unittest.mock import patch
P=Path('/tmp/pow-audit30-body-worker-guard-readonly-diagnostic-v1.py');s=importlib.util.spec_from_file_location('O',P);O=importlib.util.module_from_spec(s);s.loader.exec_module(O);RAW=Path('/tmp/pow-audit30-body-run-envelope-20261003T145500Z-v1.json').read_bytes()
INV='a'*32
class Tests(unittest.TestCase):
 def f(self,loaded=False,cg='',failure=None):
  g,B,c=O.load(RAW);g.state=lambda n:{'ActiveState':'active','MainPID':O.FIVE[n][0],'InvocationID':O.FIVE[n][1]};sql=g.SQL
  def execute(rid):
   self.assertEqual(rid,O.RUN);g.subprocess.run(['/usr/bin/systemd-run','--unit='+O.UNIT,'/usr/bin/env','-i','/usr/lib/postgresql/16/bin/psql'],input=sql.encode(),env=g.ENV,capture_output=True,timeout=40)
   if failure:raise ValueError(failure)
   return {'ok':True,'productionDataMutation':False}
  g.execute=execute;B.owned_unit=lambda *args:INV;B.terminal_unit=lambda *args:None
  fields={'LoadState':'loaded'if loaded else'not-found','ActiveState':'inactive','SubState':'dead','MainPID':'0','InvocationID':INV if loaded else'','ControlGroup':cg,'User':'postgres'if loaded else'','Group':'postgres'if loaded else'','Type':'exec'if loaded else'','Transient':'yes'if loaded else'no'}
  def run(argv,*a,**kw):
   if argv[0]=='/usr/bin/systemd-run':return types.SimpleNamespace(returncode=0,stdout=b'public',stderr=b'')
   self.assertEqual(argv[0:3],['/usr/bin/systemctl','show',O.UNIT]);return types.SimpleNamespace(returncode=0,stderr=b'',stdout=('\n'.join(k+'='+v for k,v in fields.items())+'\n').encode())
  return g,B,c,run
 def test_actual_sources_inert_and_exact(self):
  g,B,c=O.load(RAW);self.assertIn('SQL_READ_FAILED',c);self.assertIn('CORE_TIP_CHANGED',c)
  with self.assertRaisesRegex(RuntimeError,'MUTATION_FORBIDDEN'):B.capture_unit()
  with self.assertRaisesRegex(RuntimeError,'MUTATION_FORBIDDEN'):B.record()
  self.assertIn('READ ONLY',g.SQL);self.assertEqual(g.MAX_TARGET_HEIGHT,962933)
 def test_known_guard_and_gc_unresolved(self):
  g,B,c,r=self.f(failure='SQL_READ_FAILED')
  with patch.object(O.subprocess,'run',side_effect=r):v=O.diagnostic(g,B,c)
  self.assertEqual(v['currentClosedFailure']['closedOriginalGuard'],'SQL_READ_FAILED');self.assertTrue(v['qualifiedGarbageCollected']);self.assertTrue(v['invocationOwnershipUnresolved']);self.assertFalse(v['exactOwnedStopped']);self.assertTrue(v['liveFiveUnchangedAndOriginal'])
 def test_loaded_exact_owned_stopped(self):
  g,B,c,r=self.f(loaded=True)
  with patch.object(O.subprocess,'run',side_effect=r):v=O.diagnostic(g,B,c)
  self.assertTrue(v['exactOwnedStopped']);self.assertEqual(v['observedInvocation'],INV)
 def test_lingering_cgroup_never_stopped(self):
  g,B,c,r=self.f(loaded=True,cg='/system.slice/lingering')
  with patch.object(O.subprocess,'run',side_effect=r):v=O.diagnostic(g,B,c)
  self.assertFalse(v['exactOwnedStopped']);self.assertFalse(v['endpointAbsentOrExactOwnedStopped'])
 def test_unknown_reason_never_exported(self):
  g,B,c,r=self.f(failure='private database detail')
  with patch.object(O.subprocess,'run',side_effect=r):v=O.diagnostic(g,B,c)
  self.assertIsNone(v['currentClosedFailure']['closedOriginalGuard']);self.assertNotIn('private database detail',str(v))
 def test_deadline_interrupt_has_no_endpoint_continuation(self):
  g,B,c,r=self.f();g.execute=lambda *_:(_ for _ in()).throw(O.Interrupted('deadline'))
  with patch.object(O.subprocess,'run',side_effect=r) as command:
   with self.assertRaises(O.Interrupted):O.diagnostic(g,B,c)
   command.assert_not_called()
 def test_bad_source_request_refuses(self):
  with self.assertRaisesRegex(ValueError,'EXACT_AUTHENTIC_SOURCE_ENVELOPE'):O.load(RAW+b' ')
 def test_original_subprocess_kwargs_forwarded_exactly(self):
  g,B,c,r=self.f();calls=[]
  def checked(argv,*a,**kw):calls.append((argv,a,kw));return r(argv,*a,**kw)
  with patch.object(O.subprocess,'run',side_effect=checked):O.diagnostic(g,B,c)
  first=calls[0];self.assertEqual(first[2],{'input':g.SQL.encode(),'env':g.ENV,'capture_output':True,'timeout':40});self.assertEqual(first[0][1],'--unit='+O.UNIT)
if __name__=='__main__':unittest.main()
