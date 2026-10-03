#!/usr/bin/python3 -I -B
"""Pure local transport admission/dispatch fixtures; never opens SSH."""
import ast
import base64
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import subprocess
import tempfile
import types
import unittest
from unittest.mock import patch
SOURCE=Path('/tmp/pow-audit30-item2-ui-preserved-transport-v3.py')

def load():
 spec=importlib.util.spec_from_file_location('_preserved_ui_transport_fixture',SOURCE)
 m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m);return m

class Transport(unittest.TestCase):
 def test_current_owner_pin_and_typed_request_pass(self):
  m=load();raw,owner=m.owner();self.assertEqual(hashlib.sha256(raw).hexdigest(),m.OWNER_SHA)
  for phase,name in [('restage','restage'),('source','source')]:
   request=Path('/tmp/pow-audit30-item2-ui-preserved-'+name+'-request-v2.json').read_bytes();owner.request(request[:-1],phase)
 def test_request_creation_only_collision_preserves_first_bytes(self):
  m=load()
  with tempfile.TemporaryDirectory(prefix='pow-ui-transport-test-') as d:
   target=Path(d)/'request.json';report=m.assemble('restage',target);before=target.read_bytes()
   self.assertEqual(report['nativeInvocations'],0)
   with self.assertRaises(FileExistsError):m.assemble('restage',target)
   self.assertEqual(target.read_bytes(),before)
 def test_absent_unit_bootstrap_delegates_exact_owned_resources_once(self):
  m=load();code,_=m.owner();bootstrap=m.bootstrap(code,'restage','a'*64);ast.parse(bootstrap)
  fields='LoadState=not-found\nActiveState=inactive\nMainPID=0\n'
  with patch.object(os,'geteuid',return_value=0),patch.object(os,'getegid',return_value=0),patch.object(subprocess,'check_output',return_value=fields),patch.object(subprocess,'run',return_value=types.SimpleNamespace(returncode=0)) as run:
   with self.assertRaises(SystemExit) as end:exec(compile(bootstrap,'_bootstrap_fixture','exec'),{})
   self.assertEqual(end.exception.code,0);self.assertEqual(run.call_count,1)
   argv=run.call_args.args[0]
   for flag in ('--property=RuntimeMaxSec=20min','--property=MemoryMax=4G','--property=MemorySwapMax=0','--property=TasksMax=128','--property=KillMode=control-group'):self.assertIn(flag,argv)
   self.assertEqual(argv[-3],code.decode());self.assertEqual(argv[-2:],['restage','a'*64])
 def test_occupied_unit_prevents_native_dispatch(self):
  m=load();code,_=m.owner();bootstrap=m.bootstrap(code,'restage','a'*64)
  with patch.object(os,'geteuid',return_value=0),patch.object(os,'getegid',return_value=0),patch.object(subprocess,'check_output',return_value='LoadState=loaded\nActiveState=failed\nMainPID=0\n'),patch.object(subprocess,'run') as run:
   with self.assertRaisesRegex(AssertionError,'namespace occupied'):exec(compile(bootstrap,'_bootstrap_fixture','exec'),{})
   run.assert_not_called()
 def test_local_capture_collision_prevents_ssh(self):
  m=load()
  with tempfile.TemporaryDirectory(prefix='pow-ui-transport-test-') as d:
   stem=Path(d)/'capture';Path(str(stem)+'.stdout').write_text('prior immutable bytes')
   with patch.object(subprocess,'Popen') as process:
    with self.assertRaises(AssertionError):m.run('restage',Path('/tmp/pow-audit30-item2-ui-preserved-restage-request-v2.json'),stem)
    process.assert_not_called()
   self.assertEqual(Path(str(stem)+'.stdout').read_text(),'prior immutable bytes')
 def test_read_ignores_atime_but_keeps_descriptor_identity_and_digest(self):
  m=load()
  with tempfile.TemporaryDirectory(prefix='pow-ui-transport-test-') as d:
   p=Path(d)/'data';p.write_bytes(b'pinned');sha=hashlib.sha256(b'pinned').hexdigest()
   self.assertEqual(m.read(p,sha,64),b'pinned')
   p.write_bytes(b'changed')
   with self.assertRaises(AssertionError):m.read(p,sha,64)
   stat=p.stat();atime_only=types.SimpleNamespace(**{key:getattr(stat,key) for key in ('st_dev','st_ino','st_mode','st_uid','st_gid','st_nlink','st_size','st_mtime_ns','st_ctime_ns')},st_atime_ns=1)
   self.assertEqual(m.identity(stat),m.identity(atime_only))

if __name__=='__main__':unittest.main()
