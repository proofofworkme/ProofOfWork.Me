#!/usr/bin/python3 -I -B
"""Pure publication dispatch/namespace tests; no SSH or UI mutation."""
import hashlib,importlib.util,os
from pathlib import Path
import subprocess,tempfile,types,unittest
from unittest.mock import patch
P=Path('/tmp/pow-audit30-item2-ui-preserved-publish-transport-v1.py')
def load():
 spec=importlib.util.spec_from_file_location('_publication_transport_fixture',P);m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m);return m
class Publication(unittest.TestCase):
 def test_exact_owner_and_plan_pins(self):
  m=load();self.assertEqual(hashlib.sha256(m.read(m.OWNER,m.OWNER_SHA,65536)).hexdigest(),m.OWNER_SHA);self.assertEqual(hashlib.sha256(m.read(m.PLAN,m.PLAN_SHA,65536)).hexdigest(),m.PLAN_SHA)
 def test_bootstrap_one_dispatch_full_original_resources_and_bound_args(self):
  m=load();owner=m.read(m.OWNER,m.OWNER_SHA,65536);bootstrap=m.bootstrap(owner)
  with patch.object(os,'geteuid',return_value=0),patch.object(os,'getegid',return_value=0),patch.object(subprocess,'check_output',return_value='LoadState=not-found\nActiveState=inactive\nMainPID=0\n'),patch.object(subprocess,'run',return_value=types.SimpleNamespace(returncode=0))as run:
   with self.assertRaises(SystemExit)as result:exec(compile(bootstrap,'_publication_bootstrap_fixture','exec'),{})
   self.assertEqual(result.exception.code,0);self.assertEqual(run.call_count,1);argv=run.call_args.args[0]
   for prop in('--property=RuntimeMaxSec=30min','--property=MemoryMax=4G','--property=MemorySwapMax=0','--property=TasksMax=128','--property=KillMode=control-group'):self.assertIn(prop,argv)
   self.assertEqual(argv[-6],owner.decode());self.assertEqual(argv[-5:],[f'/var/tmp/proofofwork-deploy/recovery-plan-{m.RELEASE}-{m.ATTEMPT}.json',m.PLAN_SHA,m.COMMIT,m.TREE,m.ATTEMPT])
 def test_prior_unit_occupancy_refuses_without_any_dispatch(self):
  m=load();bootstrap=m.bootstrap(m.read(m.OWNER,m.OWNER_SHA,65536))
  with patch.object(os,'geteuid',return_value=0),patch.object(os,'getegid',return_value=0),patch.object(subprocess,'check_output',return_value='LoadState=loaded\nActiveState=failed\nMainPID=0\n'),patch.object(subprocess,'run')as run:
   with self.assertRaisesRegex(AssertionError,'namespace occupied'):exec(compile(bootstrap,'_publication_bootstrap_fixture','exec'),{})
   run.assert_not_called()
 def test_local_output_collision_prevents_ssh(self):
  m=load()
  with tempfile.TemporaryDirectory(prefix='pow-ui-publication-test-')as d:
   stem=Path(d)/'output';Path(str(stem)+'.stderr').write_text('preserved')
   with patch.object(subprocess,'Popen')as process:
    with self.assertRaises(AssertionError):m.run(stem)
    process.assert_not_called()
   self.assertEqual(Path(str(stem)+'.stderr').read_text(),'preserved')
if __name__=='__main__':unittest.main()
