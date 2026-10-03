import importlib.util,json,types,unittest
from unittest.mock import patch
sp=importlib.util.spec_from_file_location('P','/tmp/pow-audit30-retained-unit-codeonly-probe-v1.py');P=importlib.util.module_from_spec(sp);sp.loader.exec_module(P)
class Tests(unittest.TestCase):
 def test_fixed_literal_probe_is_isolated_small_resources_no_core_db_app_files(self):
  self.assertEqual(P.ARGV[:4],['/usr/bin/python3','-I','-B','-c']);self.assertIn('audit30CodeOnlyProbe',P.CODE)
  for forbidden in ('bitcoin-cli','psql','/data/','/etc/','open(','socket','urllib','requests'):
   self.assertNotIn(forbidden,P.CODE)
 def test_actual_typed_shape_matches_exact_argv_refuses_mutations(self):
  manager={'type':'o','data':['/org/freedesktop/systemd1/unit/fixed']};value={'type':'a(sasbttttuii)','data':[[P.ARGV[0],P.ARGV,False,0,0,0,0,0,0,0]]}
  with patch.object(P,'cmd',side_effect=[json.dumps(manager).encode(),json.dumps(value).encode()]):self.assertIn('argvSha256',P.typed())
  for bad in (value|{'type':'s'},value|{'data':[]},value|{'data':[['/bin/sh',P.ARGV,False,0,0,0,0,0,0,0]]},value|{'data':[[P.ARGV[0],['bad'],False,0,0,0,0,0,0,0]]}):
   with self.subTest(bad=bad),patch.object(P,'cmd',side_effect=[json.dumps(manager).encode(),json.dumps(bad).encode()]),self.assertRaises(ValueError):P.typed()
 def test_identity_retains_metadata_for_empty_zero_pid_cgroup_without_certifying_target(self):
  d=dict(LoadState='loaded',Type='exec',Transient='yes',RemainAfterExit='yes',User='bitcoin',Group='bitcoin',InvocationID='a'*32,MainPID='0',ControlGroup='')
  with patch.object(P,'typed',return_value={'exact':True}):self.assertTrue(P.identity(d)['exact'])
  for k,v in [('User','root'),('Group','root'),('Type','simple'),('Transient','no'),('InvocationID','b')]:
   with self.subTest(k=k),patch.object(P,'typed'),self.assertRaises(ValueError):P.identity(d|{k:v})
 def test_nonowned_invocation_refuses(self):
  d=dict(LoadState='loaded',Type='exec',Transient='yes',RemainAfterExit='yes',User='bitcoin',Group='bitcoin',InvocationID='a'*32)
  with patch.object(P,'typed'),self.assertRaises(ValueError):P.identity(d,'b'*32)
 def test_missing_or_duplicate_property_refuses(self):
  for raw in (b'LoadState=not-found\n',b'LoadState=loaded\nLoadState=loaded\n'):
   with patch.object(P,'cmd',return_value=raw),self.assertRaises(ValueError):P.props()
 def test_preexisting_unit_refuses_without_launch_or_stop(self):
  with patch.object(P.os,'geteuid',return_value=0),patch.object(P.os,'uname',return_value=types.SimpleNamespace(nodename='pow-bitcoin-01')),patch.object(P.sys,'argv',['probe']),patch.object(P,'props',return_value={'LoadState':'loaded','MainPID':'1','InvocationID':'a'*32}),patch.object(P,'cmd')as cmd,self.assertRaises(ValueError):P.main()
  cmd.assert_not_called()
if __name__=='__main__':unittest.main()
