#!/usr/bin/python3 -I -B
"""Pure passive refusal-reader source/privacy fixtures; no remote paths read."""
import ast,base64,hashlib,importlib.util,json
from pathlib import Path
import unittest
SOURCE=Path('/tmp/pow-audit30-item2-ui-restage-v2-current-task-census-read-v1.py')
s=importlib.util.spec_from_file_location('_ui_refusal_reader_fixture',SOURCE);m=importlib.util.module_from_spec(s);s.loader.exec_module(m)
class Reader(unittest.TestCase):
 def record(self):return {'errorClass':'AssertionError','reasonSha256':'a'*64,'inputAlreadyPreserved':True,'stagerEntered':True,'recognizedInputInversePerformed':False,'automaticRetry':False,'productionPublished':False,'historicalDeletion':False}
 def test_full_frozen_owner_source_binding(self):
  raw=base64.b64decode(m.OWNER_BASE64,validate=True);self.assertEqual(hashlib.sha256(raw).hexdigest(),m.OWNER_SHA);self.assertEqual(raw,Path('/tmp/pow-audit30-item2-ui-preserved-continuation-v2.py').read_bytes())
 def test_actual_post_stager_refusal_is_recognized(self):self.assertEqual(m.failure(self.record()),self.record())
 def test_inverse_retry_cleanup_or_unsafe_shape_refuses(self):
  for key in('recognizedInputInversePerformed','automaticRetry','productionPublished','historicalDeletion'):
   value=self.record();value[key]=True
   with self.assertRaises(ValueError):m.failure(value)
  for key in('inputAlreadyPreserved','stagerEntered'):
   value=self.record();value[key]=False
   with self.assertRaises(ValueError):m.failure(value)
  value=self.record();value['automaticRetry']={'private':'not-exported'}
  with self.assertRaises(ValueError):m.failure(value)
 def test_public_asset_log_exact_and_nonprintable_or_long_hash_only(self):
  public=b'Missing prior asset: /var/www/proofofwork-computer/assets/app-abc.js'
  result=m.log_projection(public+b'\n'+b'unsafe\x00content\n'+b'a'*4097)
  self.assertEqual(result['firstLines'][0]['publicAssetMessage'],public.decode());self.assertNotIn('publicAssetMessage',result['firstLines'][1]);self.assertNotIn('publicAssetMessage',result['firstLines'][2])
  self.assertEqual(result['firstLines'][2]['sha256'],hashlib.sha256(b'a'*4097).hexdigest())
 def test_log_line_and_size_bounds(self):
  row=m.log_projection(b'x\n'*100);self.assertEqual(row['lineCount'],100);self.assertEqual(len(row['firstLines']),32)
  with self.assertRaises(ValueError):m.log_projection(b'x'*(4*1024**2+1))
 def test_observer_has_no_service_control_or_inverse_call(self):
  tree=ast.parse(SOURCE.read_bytes());calls=[ast.unparse(n.func)for n in ast.walk(tree)if isinstance(n,ast.Call)]
  for forbidden in('owner.rename_new','owner.preserve_stage','owner.main','os.unlink','os.rename','subprocess.Popen'):self.assertNotIn(forbidden,calls)
  self.assertIn('owner.payload_fingerprint',calls);self.assertIn('owner.inode_witness',calls)
  self.assertIn('fcntl.LOCK_SH|fcntl.LOCK_NB',SOURCE.read_text())

 def test_exact_actual_capacity_log_binding(self):
  line=b'UI deployment scratch review required {"additionalBytes": 453701632, "allocatedBytes": 4933701632, "cleanupApproved": false, "maximumBytes": 5368709120, "path": "/var/tmp/proofofwork-deploy", "phase": "stage-private-root"}\n'
  self.assertEqual(hashlib.sha256(line).hexdigest(),m.KNOWN_LOG_SHA);self.assertEqual(len(line),223)
 def test_quiet_loaded_failed_and_not_found_only(self):
  self.assertTrue(m.quiet({'MainPID':'0','ActiveState':'failed','LoadState':'loaded'}))
  self.assertTrue(m.quiet({'MainPID':'0','ActiveState':'inactive','LoadState':'not-found'}))
  for value in({'MainPID':'3','ActiveState':'failed','LoadState':'loaded'},{'MainPID':'0','ActiveState':'active','LoadState':'loaded'},{'MainPID':'0','ActiveState':'inactive','LoadState':'masked'}):self.assertFalse(m.quiet(value))
 def test_inventory_is_fixed_current_release_and_metadata_only(self):
  text=SOURCE.read_text();tree=ast.parse(text)
  body=ast.unparse(next(n for n in tree.body if isinstance(n,ast.FunctionDef)and n.name=='inventory'))
  self.assertNotIn('open(',body);self.assertNotIn('read',body);self.assertIn('s.st_blocks * 512',body)
  self.assertIn("owner.BASE.glob('.proofofwork-ui-stage-'+owner.RELEASE+'.*')",text)
  self.assertNotIn("owner.BASE.iterdir()",text);self.assertIn("'olderArtifactInspection':False",text)
 def test_original_package7_and_readonly_capacity_calls(self):
  tree=ast.parse(SOURCE.read_bytes());calls=[ast.unparse(n.func)for n in ast.walk(tree)if isinstance(n,ast.Call)]
  self.assertIn('owner.check_package',calls);self.assertIn("cap_namespace['check_deploy_scratch']",calls);self.assertIn("cap_namespace['tree_bound']",calls)
  for forbidden in('owner.install_capacity','owner.restage','owner.receive_source','owner.capacity','owner.durable_json','os.chmod','Path.mkdir'):self.assertNotIn(forbidden,calls)

if __name__=='__main__':unittest.main()
