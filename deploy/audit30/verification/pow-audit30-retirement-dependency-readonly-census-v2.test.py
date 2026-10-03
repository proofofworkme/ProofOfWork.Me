import importlib.util,json,os,tempfile,time,unittest
from pathlib import Path
from unittest.mock import patch
s=importlib.util.spec_from_file_location('C','/tmp/pow-audit30-retirement-dependency-readonly-census-v2.py');C=importlib.util.module_from_spec(s);s.loader.exec_module(C)
class Tests(unittest.TestCase):
 def setUp(self):C.CONSUMED=0;C.COUNT=0;C.ROOT_PROGRESS=[];C.ACTIVE_ROOT=None;C.DEADLINE=time.monotonic()+75
 def test_fixed_application_roots_exclude_generated_whole_tree(self):
  with tempfile.TemporaryDirectory()as t:
   app=Path(t)/'application';app.mkdir()
   for n in ('server','scripts','deploy','dist','node_modules','artifacts','audits'): (app/n).mkdir()
   (app/'README.md').write_text('canonical');roots,skips=C.selected_roots([], [app]);self.assertNotIn(app,roots)
   for n in ('server','scripts','deploy',*C.DOCS):self.assertIn(app/n,roots)
   for n in ('dist','node_modules','artifacts','audits'):self.assertNotIn(app/n,roots);self.assertIn(str(app/n),[v['path']for v in skips])
 def test_application_symlink_is_pointer_only_no_followed_children(self):
  with tempfile.TemporaryDirectory()as t:
   app=Path(t)/'real';app.mkdir();alias=Path(t)/'alias';alias.symlink_to(app);roots,skips=C.selected_roots([], [alias]);self.assertIn(alias,roots);self.assertNotIn(alias/'server',roots)
 def test_fixed_corpus_matches_all_literal_tokens(self):
  for token in C.TOKENS:self.assertIn(token,C.matched(('prefix:'+token+'/suffix').encode()))
  self.assertEqual(C.matched(b'no reference'),[])
 def test_narrow_scan_reads_code_but_not_generated_private_plan_or_catalog(self):
  with tempfile.TemporaryDirectory()as t:
   root=Path(t);(root/'server').mkdir();p=root/'server'/'operator.py';p.write_text('SOURCE='+repr(C.OLD));p.chmod(0o600)
   (root/'dist').mkdir();(root/'dist'/'bundle.js').write_text('secret-dist')
   for n in ('reviewed-plan.json','phase4-private-plan.json','catalog-private.py','globals.sql'):(root/n).write_text('secret-private')
   def selected(a,b):return [root],[]
   with patch.object(C,'selected_roots',selected):r=C.operator_scan()
   self.assertEqual([v['path']for v in r['regularFiles']],[str(p)]);self.assertIn(C.OLD,r['regularFiles'][0]['targets']);self.assertNotIn('secret-private',json.dumps(r));self.assertNotIn('secret-dist',json.dumps(r));self.assertEqual(r['consumedBytes'],p.stat().st_size);self.assertEqual(r['rootProgress'][0]['root'],str(root));self.assertFalse(r['universalDependencyCompleteness'])
 def test_cumulative_cap_remains192_mib_and_small_fixture_refuses(self):
  self.assertEqual(C.MAX_BYTES,192*1024**2)
  with tempfile.TemporaryDirectory()as t:
   p=Path(t)/'file.py';p.write_bytes(b'abc');p.chmod(0o600)
   with patch.object(C,'MAX_BYTES',2),self.assertRaises(ValueError):C.read(p,4)
   self.assertEqual(C.CONSUMED,3)
 def test_noatime_stable_read_and_per_file_refusal(self):
  with tempfile.TemporaryDirectory()as t:
   p=Path(t)/'file.py';p.write_bytes(b'abc');p.chmod(0o600);os.utime(p,ns=(1,p.stat().st_mtime_ns));raw,m=C.read(p,3);self.assertEqual(raw,b'abc');self.assertEqual(p.stat().st_atime_ns,1)
   with self.assertRaises(ValueError):C.read(p,2)
 def test_changed_path_fence_refuses(self):
  with tempfile.TemporaryDirectory()as t:
   p=Path(t)/'file.py';p.write_bytes(b'abc');p.chmod(0o600);real=C.meta(p);changed=real|{'ctimeNs':real['ctimeNs']+1}
   with patch.object(C,'meta',side_effect=[real,changed]),self.assertRaises(ValueError):C.read(p,4)
 def test_symlink_content_never_opened(self):
  with tempfile.TemporaryDirectory()as t:
   p=Path(t)/'link.py';p.symlink_to('/missing/'+C.OLD)
   with patch.object(C,'selected_roots',return_value=([p],[])),patch.object(C,'read',side_effect=AssertionError('must not follow')):r=C.operator_scan()
   self.assertEqual(len(r['matchingSymlinkPointers']),1);self.assertEqual(r['consumedBytes'],0)
 def test_deadline_and_entry_bounds_refuse(self):
  C.DEADLINE=0
  with self.assertRaises(ValueError):C.tick()
  C.DEADLINE=time.monotonic()+75
  with tempfile.TemporaryDirectory()as t,patch.object(C,'selected_roots',return_value=([Path(t)],[])),patch.object(C,'MAX_ENTRIES',0),self.assertRaises(ValueError):C.operator_scan()
 def test_no_private_environment_sql_or_stop_operation(self):
  src=Path(C.__file__).read_text();self.assertNotIn("'environ'",src);self.assertNotIn('psql',src);self.assertNotIn("'stop'",src);self.assertNotIn("'start'",src);self.assertEqual(C.UNITS[1],'proofofwork-audit30-snapshot-inspect-20261003T005512Z.service');self.assertEqual(C.UNITS[2],'proofofwork-audit30-snapshot-inspect-20261003T014100Z.service')
if __name__=='__main__':unittest.main()
