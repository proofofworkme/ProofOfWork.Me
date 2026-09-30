import importlib.util
from pathlib import Path
import subprocess
import tempfile
import unittest

spec = importlib.util.spec_from_file_location('audit28_cleanup', 'deploy/audit28/cleanup-manifest.py')
cleanup = importlib.util.module_from_spec(spec)
spec.loader.exec_module(cleanup)

class Preparation(unittest.TestCase):
    def test_content_drift_and_symlink_targets_change_fingerprint_without_following_targets(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            file = root / 'file'; file.write_text('canonical')
            first = cleanup.fingerprint(root)
            file.write_text('changed')
            self.assertNotEqual(first['sha256'], cleanup.fingerprint(root)['sha256'])
            link = root / 'link'; link.symlink_to('/unreadable-outside-candidate')
            before = cleanup.fingerprint(root)
            link.unlink(); link.symlink_to('/different-outside-candidate')
            self.assertNotEqual(before['sha256'], cleanup.fingerprint(root)['sha256'])
    def test_publisher_deferral_skips_only_post_publish_retention(self):
        source = Path('deploy/proofofwork-ui-release-publish.sh').read_text()
        start = source.rindex('if [[ "${allow_test_roots}" != "1" ]]')
        end = source.index('\nfi', start) + 3
        branch = source[start:end]
        with tempfile.TemporaryDirectory() as directory:
            helper = Path(directory) / 'retention.py'
            helper.write_text("print('retention-called')\n")
            for deferred in [0, 1]:
                setup = f'allow_test_roots=; defer_verified_retention={deferred}; deploy_lock_fd=0; verified_retention={helper}\n'
                result = subprocess.run(['bash', '-c', setup + branch], capture_output=True, text=True, check=True)
                self.assertEqual('retention-called' in result.stdout, deferred == 0)
    def test_restore_plan_is_pinned_and_socket_only(self):
        result = subprocess.run(['bash','deploy/audit28/restore-logical.sh','--plan','20260929T213000Z'], capture_output=True,text=True,check=True)
        self.assertIn('20260929T031853Z.dumpset', result.stdout)
        self.assertIn('listen_addresses=none',result.stdout)
        self.assertIn('maximum_job_bytes=85899345920',result.stdout)
    def test_invalid_restore_arguments_refuse_before_any_database_action(self):
        for args in [['--apply','bad'],['--unknown','20260929T213000Z']]:
            result=subprocess.run(['bash','deploy/audit28/restore-logical.sh',*args],capture_output=True)
            self.assertEqual(result.returncode,64)
    def test_cleanup_apply_refuses_unapproved_hash_before_production_access(self):
        result=subprocess.run(['python3','-B','deploy/audit28/cleanup-manifest.py',
            'audits/2026-09-29-audit28-followup-cleanup.manifest.json','--apply',
            '--approved-manifest-sha256','unapproved'],capture_output=True,text=True)
        self.assertNotEqual(result.returncode,0)
        self.assertIn('exact separately approved manifest hash',result.stderr)

if __name__ == '__main__': unittest.main()
