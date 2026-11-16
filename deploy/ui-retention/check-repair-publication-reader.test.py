import importlib.util,os,pathlib,tempfile,unittest,hashlib
from unittest.mock import patch
p=pathlib.Path(__file__).with_name("retirement_receipt.py");sp=importlib.util.spec_from_file_location("RR",p);R=importlib.util.module_from_spec(sp);sp.loader.exec_module(R)
class ReaderTests(unittest.TestCase):
 def setUp(self):
  self.t=tempfile.TemporaryDirectory(prefix=".retirement-test-tmp-reader-",dir="/var/tmp");self.root=pathlib.Path(self.t.name);self.d=self.root/"publication";self.d.mkdir(mode=0o700);self.p=self.d/"receipt.json";self.raw=b"{\n  \"ok\": true\n}\n";self.p.write_bytes(self.raw);self.p.chmod(0o600);self.h=hashlib.sha256(self.raw).hexdigest();self.patch=patch.multiple(R,_REPAIR_PUBLICATION_ROOT=self.root,_REPAIR_PUBLICATION_FILES={str(self.p):(self.h,len(self.raw))});self.patch.start()
 def tearDown(self):self.patch.stop();self.t.cleanup()
 def read(self):return R.read_repair_publication_bound(self.p,self.h)
 def test_original_raw_preserved(self):self.assertEqual(self.read(),self.raw)
 def test_general_reader_still_refuses_sticky(self):
  with self.assertRaises(ValueError):R.read_bound(self.p,self.h)
 def test_unbound_refused(self):
  with self.assertRaises(ValueError):R.read_repair_publication_bound(self.p,None)
 def test_wrong_expected_refused(self):
  with self.assertRaises(ValueError):R.read_repair_publication_bound(self.p,"0"*64)
 def test_unknown_path_refused(self):
  with self.assertRaises(ValueError):R.read_repair_publication_bound(self.d/"other.json",self.h)
 def test_altered_bytes_refused(self):
  self.p.write_bytes(self.raw.replace(b"true",b"null"))
  with self.assertRaises(ValueError):self.read()
 def test_size_refused(self):
  self.p.write_bytes(self.raw+b" ")
  with self.assertRaises(ValueError):self.read()
 def test_leaf_mode_refused(self):
  self.p.chmod(0o640)
  with self.assertRaises(ValueError):self.read()
 def test_private_parent_mode_refused(self):
  self.d.chmod(0o755)
  with self.assertRaises(ValueError):self.read()
 def test_leaf_group_refused(self):
  os.chown(self.p,0,1)
  with self.assertRaises(ValueError):self.read()
 def test_hardlink_refused(self):
  os.link(self.p,self.d/"hard")
  with self.assertRaises(ValueError):self.read()
 def test_symlink_refused(self):
  q=self.d/"real";self.p.rename(q);self.p.symlink_to(q)
  with self.assertRaises(ValueError):self.read()
 def test_ancestor_drift_refused(self):
  original=os.fstat;count=0
  def changed(fd):
   nonlocal count
   count+=1
   if count==2:self.d.chmod(0o755)
   return original(fd)
  with patch.object(R.os,"fstat",side_effect=changed):
   with self.assertRaises(ValueError):self.read()
class FixedScope(unittest.TestCase):
 def test_exact_two_production_bindings(self):
  self.assertEqual(len(R._REPAIR_PUBLICATION_FILES),2)
  self.assertEqual(sorted(x[1] for x in R._REPAIR_PUBLICATION_FILES.values()),[3239,50534])
  self.assertEqual(str(R._REPAIR_PUBLICATION_ROOT),"/var/tmp/proofofwork-deploy")
if __name__=="__main__":
 assert os.geteuid()==0,"Root-owned isolated filesystem fixtures required"
 unittest.main()
