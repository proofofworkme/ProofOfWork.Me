import hashlib,importlib.util,os,tempfile,unittest
from pathlib import Path
from unittest.mock import patch
P='/tmp/pow-audit30-private-sixteen-math-allocation-observer-v1.py';s=importlib.util.spec_from_file_location('observer',P);M=importlib.util.module_from_spec(s);s.loader.exec_module(M)
class Tests(unittest.TestCase):
 def setUp(self):
  self.t=tempfile.TemporaryDirectory();self.root=Path(self.t.name);os.chmod(self.root,0o700);self.raw=b'x'*11774;(self.root/'completed.json').write_bytes(self.raw);os.chmod(self.root/'completed.json',0o600)
  original=M.meta;self.patches=[patch.object(M,'ROOT',self.root),patch.object(M,'PROOF',hashlib.sha256(self.raw).hexdigest()),patch.object(M,'mounts',return_value=[]),patch.object(M,'meta',side_effect=lambda s:original(s)|{'uid':0,'gid':0})]
  for p in self.patches:p.start()
 def tearDown(self):
  for p in reversed(self.patches):p.stop()
  self.t.cleanup()
 def test_full_blocks_identity_hash_and_proof_twice(self):
  a=M.inventory();b=M.inventory();self.assertEqual(a,b);self.assertEqual(a['entries'],2);self.assertEqual(a['regularBytes'],11774);self.assertEqual(a['allocatedBytes'],(self.root.stat().st_blocks+(self.root/'completed.json').stat().st_blocks)*512)
 def test_same_size_content_change_changes_tree_hash(self):
  a=M.inventory();(self.root/'completed.json').write_bytes(b'y'*11774)
  with self.assertRaises(ValueError):M.inventory()
 def test_symlink_and_hardlink_refuse(self):
  (self.root/'alias').symlink_to('completed.json')
  with self.assertRaises(ValueError):M.inventory()
  (self.root/'alias').unlink();os.link(self.root/'completed.json',self.root/'alias')
  with self.assertRaises(ValueError):M.inventory()
 def test_root_visibility_and_mount_refuse(self):
  os.chmod(self.root,0o750)
  with self.assertRaises(ValueError):M.inventory()
  os.chmod(self.root,0o700)
  with patch.object(M,'mounts',return_value=[str(self.root/'nested')]):
   with self.assertRaises(ValueError):M.inventory()
 def test_xattr_and_unknown_file_mode_refuse(self):
  with patch.object(M.os,'listxattr',return_value=['user.bad']):
   with self.assertRaises(ValueError):M.inventory()
  os.chmod(self.root/'completed.json',0o644)
  with self.assertRaises(ValueError):M.inventory()
if __name__=='__main__':unittest.main()
