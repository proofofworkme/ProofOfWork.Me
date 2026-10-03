#!/usr/bin/python3 -I
import contextlib,hashlib,importlib.util,io,json,stat,types,unittest
from pathlib import Path
from unittest.mock import patch
sp=importlib.util.spec_from_file_location('candidate','/tmp/pow-audit30-retention-protection-oct2-candidate-v1.py');P=importlib.util.module_from_spec(sp);sp.loader.exec_module(P)
class Tests(unittest.TestCase):
 def test_exact_only_two_expected_identity_lines_changed(self):
  old=Path('/home/sixer/ProofOfWork.Me/scripts/check-retention-protection.py').read_bytes();new=Path(P.__file__).read_bytes();self.assertEqual(hashlib.sha256(old).hexdigest(),'da5d1336ce857acc571ba0849c2b0150ef5fc6dfdacf80e65b9f1d3611c48e8a');self.assertEqual(new.replace(b"EXPECTED_LOGICAL_PIN = 'proof_indexer-20261002T031851Z.dumpset'",b"EXPECTED_LOGICAL_PIN = 'proof_indexer-20260929T031853Z.dumpset'").replace(b"dump.get('bytes')==20525963614",b"dump.get('bytes')==19363782935"),old)
 def run_node(self,pins=None,dumpbytes=20525963614,uid=108,directorymode=0o700,symlink=False):
  pins=P.EXPECTED_LOGICAL_PIN if pins is None else pins;seen=[]
  def facts(path):
   seen.append(str(path));base=dict(exists=True,regular=True,symlink=False,canonical=True,uid=0,mode=0o644,bytes=40)
   if str(path).endswith('/proofofwork-postgres-logical-backup'):return base|{'mode':0o755,'bytes':1}
   if str(path).endswith('/proof_indexer.dump'):return base|dict(uid=uid,mode=0o600,bytes=dumpbytes,symlink=symlink)
   if '.dumpset' in str(path):return base|dict(regular=False,uid=108,mode=directorymode,bytes=4096)
   return base
  fake=types.SimpleNamespace(st_mode=stat.S_IFREG|0o600,st_uid=0)
  def st(path):return fake if str(path).endswith('/audit28.hold')else types.SimpleNamespace(st_mode=stat.S_IFLNK|0o777,st_uid=0)
  with patch.object(P,'file_facts',side_effect=facts),patch.object(P,'EXPECTED_LOGICAL_BACKUP_TOOL_SHA256',hashlib.sha256(b'x').hexdigest()),patch.object(P.pwd,'getpwnam',return_value=types.SimpleNamespace(pw_uid=108)),patch.object(Path,'lstat',st),patch.object(Path,'readlink',return_value=Path('/dev/null')),patch.object(Path,'read_text',return_value=pins+'\n'),patch.object(Path,'read_bytes',return_value=b'x'),patch.object(P.subprocess,'run',return_value=types.SimpleNamespace(stdout='LoadState=masked\nActiveState=inactive\n')),patch.object(P,'check_held_paths',return_value={'ok':True}),patch.object(P,'scratch_namespace_evidence',return_value={'qualified':True}),patch('sys.argv',[P.__file__,'--role','node']),contextlib.redirect_stdout(io.StringIO())as out:
   code=P.main();v=json.loads(out.getvalue())
  return code,v,seen
 def test_oct2_exact_stat_identity_accepted_by_actual_main(self):
  code,v,seen=self.run_node();self.assertEqual(code,0);self.assertTrue(v['ok']);self.assertIn('/data/proofofwork-postgres-backups/logical/proof_indexer-20261002T031851Z.dumpset/proof_indexer.dump',seen)
 def test_old_sep29_pin_refused_by_actual_main(self):
  code,v,_=self.run_node(pins='proof_indexer-20260929T031853Z.dumpset');self.assertEqual(code,1);self.assertIn('pinned-logical-restore-backup-not-protected',v['issues'])
 def test_unrestored_oct3_pin_refused(self):self.assertEqual(self.run_node(pins='proof_indexer-20261003T031852Z.dumpset')[0],1)
 def test_multiple_pin_lines_refuse(self):self.assertEqual(self.run_node(pins=P.EXPECTED_LOGICAL_PIN+'\nproof_indexer-20260929T031853Z.dumpset')[0],1)
 def test_old_or_changed_dump_size_refuses(self):
  for n in(19363782935,20525963613,20525963615):
   with self.subTest(n=n):self.assertEqual(self.run_node(dumpbytes=n)[0],1)
 def test_dump_owner_symlink_or_weak_directory_refuses(self):
  for args in[dict(uid=0),dict(directorymode=0o755),dict(symlink=True)]:
   with self.subTest(args=args):self.assertEqual(self.run_node(**args)[0],1)
 def test_holds_masks_and_backup_tool_hash_unchanged(self):
  safe=dict(exists=True,regular=True,symlink=False,canonical=True,uid=0,mode=0o644,bytes=40);tool=safe|{'mode':0o755};self.assertTrue(P.logical_pin_protection_is_valid(safe,[P.EXPECTED_LOGICAL_PIN],tool,P.EXPECTED_LOGICAL_BACKUP_TOOL_SHA256));self.assertFalse(P.logical_pin_protection_is_valid(safe,[P.EXPECTED_LOGICAL_PIN],tool,'0'*64));self.assertFalse(P.evaluate('node',safe,{'prune':dict(LoadState='masked',ActiveState='active',persistentMask=True)},True)['ok']);self.assertFalse(P.evaluate('node',safe,{'prune':dict(LoadState='masked',ActiveState='inactive',persistentMask=False)},True)['ok'])
if __name__=='__main__':unittest.main()
