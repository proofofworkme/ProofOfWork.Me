#!/usr/bin/env python3
import pathlib,subprocess,tempfile,unittest
SOURCE=(pathlib.Path(__file__).resolve().parents[1]/'deploy/proofofwork-postgres-logical-backup.sh').read_text()
def function(name):
    start=SOURCE.index(name+'() {');end=SOURCE.index('\n}',start)+2;return SOURCE[start:end]
class Pins(unittest.TestCase):
    def fixture(self,contents=None,mode=0o644,owner=0,symlink=False):
        with tempfile.TemporaryDirectory() as tmp:
            p=pathlib.Path(tmp)/'pins'
            if contents is not None:p.write_text(contents);p.chmod(mode)
            if symlink:
                q=pathlib.Path(tmp)/'link';q.symlink_to(p);p=q
            script='set -Eeuo pipefail\nlogical_backup_pin_file='+repr(str(p))+'\npinned_logical_backups=()\nstat() { if [[ "$1" == --format=%u ]]; then echo '+str(owner)+'; else /usr/bin/stat "$@"; fi; }\n'+function('read_logical_backup_pin_policy')+'\n'+function('logical_backup_is_pinned')+'\nread_logical_backup_pin_policy\nlogical_backup_is_pinned proof_indexer-20260929T031853Z.dumpset'
            return subprocess.run(['bash','-c',script],capture_output=True,text=True,timeout=2)
    def test_exact_pin_is_protected(self):self.assertEqual(self.fixture('proof_indexer-20260929T031853Z.dumpset\n').returncode,0)
    def test_missing_policy_fails_closed(self):self.assertNotEqual(self.fixture().returncode,0)
    def test_symlink_policy_is_refused(self):self.assertNotEqual(self.fixture('proof_indexer-20260929T031853Z.dumpset\n',symlink=True).returncode,0)
    def test_writable_or_nonroot_policy_is_refused(self):
        self.assertNotEqual(self.fixture('proof_indexer-20260929T031853Z.dumpset\n',mode=0o666).returncode,0)
        self.assertNotEqual(self.fixture('proof_indexer-20260929T031853Z.dumpset\n',owner=1000).returncode,0)
    def test_malformed_path_cannot_be_a_pin(self):self.assertNotEqual(self.fixture('../../live-database\n').returncode,0)
    def test_unpinned_set_remains_subject_to_existing_retention(self):self.assertNotEqual(self.fixture('proof_indexer-20260930T031853Z.dumpset\n').returncode,0)
    def test_too_many_pins_is_refused(self):self.assertNotEqual(self.fixture('proof_indexer-20260929T031853Z.dumpset\n'*17).returncode,0)
    def test_emergency_fallback_keeps_old_sets_and_still_verifies_current(self):
        fallback=(pathlib.Path(__file__).resolve().parents[1]/'deploy/audit28/logical-backup-retention-held.sh').read_text()
        loop=fallback[fallback.index('retained_current_set=false\n'):fallback.index('if [[ "${retained_current_set}" != true ]]')]
        script='set -Eeuo pipefail\nbackup_root=/fixture\nfinal_set=/fixture/proof_indexer-20260930T031853Z.dumpset\nbackups=("1 proof_indexer-20260929T031853Z.dumpset" "2 proof_indexer-20260930T031853Z.dumpset")\nverify_complete_backup_set() { echo "verified $1"; backup_candidate_bytes=1; }\n'+loop
        r=subprocess.run(['bash','-c',script],capture_output=True,text=True,timeout=2)
        self.assertEqual(r.returncode,0,r.stderr);self.assertIn('audit28-emergency-retention-hold',r.stdout)
        self.assertIn('verified /fixture/proof_indexer-20260930T031853Z.dumpset',r.stdout)
        self.assertNotIn('verified /fixture/proof_indexer-20260929',r.stdout)
if __name__=='__main__':unittest.main()
