import hashlib,os,pathlib,runpy,tempfile,types,unittest,unittest.mock as M
D=runpy.run_path('/tmp/pow-audit30-strict-fresh-capture-root-v1.py')
class Tests(unittest.TestCase):
 def test_metadata_stamp_excludes_atime_but_preserves_source_fields(self):
  with tempfile.TemporaryDirectory()as td:
   p=pathlib.Path(td)/'p';p.write_bytes(b'fixed');p.chmod(0o600);a=p.stat();os.utime(p,ns=(1,a.st_mtime_ns));b=p.stat();self.assertEqual(D['stamp'](a)[:8],D['stamp'](b)[:8]);self.assertEqual(len(D['stamp'](a)),9)
 def test_no_timer_service_control_or_arbitrary_cli_input(self):
  s=pathlib.Path('/tmp/pow-audit30-strict-fresh-capture-root-v1.py').read_text();self.assertNotIn('sys.argv',s);self.assertNotIn("'stop'",s);self.assertNotIn("'start'",s);self.assertIn("'capture','--capture-id',capture",s);self.assertIn('assert not os.path.lexists(directory)',s)
 def test_exact_installed_helper_pins(self):
  self.assertEqual(D['PINS']['private-verify.py'],'8a569828272b10abc8848dd01678a1a3b45002acd489802f89b6e056de3e0c1e');self.assertEqual(D['PINS']['private-env.py'],'99cbe9cd118c63b08480efd28c2ae7c059b5204daef8db08b896a38fc791d515')
 def test_metadata_content_export_boundaries(self):
  s=pathlib.Path('/tmp/pow-audit30-strict-fresh-capture-root-v1.py').read_text();self.assertIn('privateContentsExported=False',s);self.assertIn("print(json.dumps(dict(schema='pow-audit30-strict-fresh-private-capture-v1'",s);self.assertIn("result['apiEnvironSha256']=='327427",s)

class RootReads(unittest.TestCase):
 def fake_root(self,s):
  names=['st_dev','st_ino','st_mode','st_uid','st_gid','st_nlink','st_size','st_mtime_ns','st_ctime_ns'];v={k:getattr(s,k)for k in names};v.update(st_uid=0,st_gid=0);return types.SimpleNamespace(**v)
 def read(self,p,limit=64):
  original_stat=os.fstat;original_named=pathlib.Path.lstat
  with M.patch.object(os,'fstat',side_effect=lambda fd:self.fake_root(original_stat(fd))),M.patch.object(pathlib.Path,'lstat',side_effect=lambda q:self.fake_root(original_named(q)),autospec=True):return D['root_read'](p,limit)
 def test_actual_fd_valid_read_is_same_bytes(self):
  with tempfile.TemporaryDirectory()as td:
   p=pathlib.Path(td)/'p';p.write_bytes(b'exact');p.chmod(0o600);self.assertEqual(self.read(p),b'exact')
 def test_actual_symlink_rejected(self):
  with tempfile.TemporaryDirectory()as td:
   p=pathlib.Path(td)/'p';p.write_bytes(b'exact');p.chmod(0o600);q=pathlib.Path(td)/'q';q.symlink_to(p);self.assertRaises(AssertionError,self.read,q)
 def test_actual_wrong_mode_rejected(self):
  with tempfile.TemporaryDirectory()as td:
   p=pathlib.Path(td)/'p';p.write_bytes(b'exact');p.chmod(0o640);self.assertRaises(AssertionError,self.read,p)
 def test_actual_hardlink_rejected(self):
  with tempfile.TemporaryDirectory()as td:
   p=pathlib.Path(td)/'p';p.write_bytes(b'exact');p.chmod(0o600);os.link(p,pathlib.Path(td)/'q');self.assertRaises(AssertionError,self.read,p)
 def test_actual_byte_limit_rejected(self):
  with tempfile.TemporaryDirectory()as td:
   p=pathlib.Path(td)/'p';p.write_bytes(b'x'*65);p.chmod(0o600);self.assertRaises(AssertionError,self.read,p)
 def test_same_inode_same_length_content_drift_rejected(self):
  with tempfile.TemporaryDirectory()as td:
   p=pathlib.Path(td)/'p';p.write_bytes(b'exact');p.chmod(0o600);original=os.read;done=False
   def change(fd,limit):
    nonlocal done
    b=original(fd,limit)
    if not done:done=True;p.write_bytes(b'other')
    return b
   with M.patch.object(os,'read',side_effect=change):self.assertRaises(AssertionError,self.read,p)
if __name__=='__main__':unittest.main()
