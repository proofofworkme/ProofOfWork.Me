#!/usr/bin/python3 -I
"""Synthetic filesystem/reference exclusion tests; never delete app resources."""
import fcntl
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest

sys.dont_write_bytecode = True
ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('cleanup_guard', ROOT / 'deploy/audit6/ui-cleanup-guard.py')
guard = importlib.util.module_from_spec(spec)
spec.loader.exec_module(guard)

class ReferenceTests(unittest.TestCase):
    def setUp(self):
        os.umask(0o022)
        self.temp = tempfile.TemporaryDirectory(prefix='pow-audit6-references-',dir='/tmp')
        self.root = Path(self.temp.name)
        self.c = {key: str(self.root / key) for key in ('state','www','stage','archives','rollbacks')}
        self.c['lock'] = str(self.root / 'deploy.lock')
        for key in ('state','www','stage','archives','rollbacks'):
            Path(self.c[key]).mkdir()
        self.release = 'fixture'
        self.old_archive = 'proofofwork-ui-release-old.tgz'
        self.manifest = Path(self.c['www']) / '.proofofwork-ui-release'
        self.manifest.write_text('format=proofofwork-ui-rollback-evidence-v1\narchive_name=' + self.old_archive + '\n')
        self.candidate = Path(self.c['stage']) / 'proofofwork-www-stage-fixture'
        self.candidate.mkdir()
        self.source = Path(self.c['stage']) / 'proofofwork-ui-source-fixture'
        self.source.mkdir()
        self.job = {'model': 'proofofwork-ui-durable-publication-v1', 'release': self.release, 'phase': 'prepared',
            'priorIdentity': guard.identity(self.c['www']),
            'priorFingerprint': {'manifestSha256': hashlib.sha256(self.manifest.read_bytes()).hexdigest()}}
        self.jobpath = Path(self.c['state']) / 'fixture.json'
        self.save()
        self.fd,self.owned = guard.lock(self.c)

    def tearDown(self):
        if self.owned: os.close(self.fd)
        self.temp.cleanup()

    def save(self):
        self.jobpath.write_text(json.dumps(self.job)); self.jobpath.chmod(0o600)

    def test_unfinished_refs_cover_source_roots_and_archive_families(self):
        paths = {x['path'] for x in guard.references(self.c,self.fd)['protected']}
        suffix = hashlib.sha256(self.release.encode()).hexdigest()[:32]
        expected = [self.source, self.candidate,
            Path(self.c['rollbacks'])/'proofofwork-www-pre-fixture',
            Path(self.c['rollbacks'])/('proofofwork-www-pre-original-'+suffix),
            Path(self.c['stage'])/('proofofwork-www-stage-recovery-'+suffix)]
        for path in expected: self.assertIn(str(path),paths)
        for name in (self.old_archive,'proofofwork-ui-release-fixture.tgz','proofofwork-ui-release-recovery-'+suffix+'.tgz'):
            for extension in ('','.sha256','.provenance'):
                self.assertIn(str(Path(self.c['archives'])/(name+extension)),paths)

    def test_ancestor_and_descendant_deletion_candidates_are_refused(self):
        for path in (self.source,self.source/'node_modules',Path(self.c['stage']),Path(self.c['archives'])/self.old_archive):
            with self.assertRaisesRegex(RuntimeError,'protected reference'):
                guard.assert_removable(self.c,self.fd,[str(path)])
        guard.assert_removable(self.c,self.fd,[str(Path(self.c['archives'])/'proofofwork-ui-release-unrelated.tgz')])

    def test_killed_publisher_layout_still_protects_original_archive(self):
        displaced = self.root/'displaced-candidate'
        self.candidate.rename(displaced)
        Path(self.c['www']).rename(self.candidate)
        displaced.rename(self.c['www'])
        (Path(self.c['www'])/'.proofofwork-ui-release').write_text('archive_name=proofofwork-ui-release-fixture.tgz\n')
        self.job['phase']='armed'; self.save()
        with self.assertRaisesRegex(RuntimeError,'protected reference'):
            guard.assert_removable(self.c,self.fd,[str(Path(self.c['archives'])/self.old_archive)])

    def test_prepublished_union_preserves_distinct_original_reference(self):
        suffix=hashlib.sha256(self.release.encode()).hexdigest()[:32]
        original=Path(self.c['rollbacks'])/('proofofwork-www-pre-original-'+suffix)
        Path(self.c['www']).rename(original)
        Path(self.c['www']).mkdir()
        (Path(self.c['www'])/'.proofofwork-ui-release').write_text(
            'archive_name=proofofwork-ui-release-recovery-'+suffix+'.tgz\n')
        self.job.update(phase='prepublishing-union',originalRoot=str(original));self.save()
        for path in (original,original/'.proofofwork-ui-release',Path(self.c['archives'])/self.old_archive):
            with self.assertRaisesRegex(RuntimeError,'protected reference'):
                guard.assert_removable(self.c,self.fd,[str(path)])
        self.job['originalRoot']=str(original)+'-unrecognized';self.save()
        with self.assertRaisesRegex(RuntimeError,'Unexpected original'):
            guard.assert_removable(self.c,self.fd,[str(self.root/'unrelated')])

    def test_terminal_job_releases_nonactive_candidate_reference_only(self):
        self.job['phase']='committed';self.save()
        guard.assert_removable(self.c,self.fd,[str(self.source)])
        with self.assertRaisesRegex(RuntimeError,'protected reference'):
            guard.assert_removable(self.c,self.fd,[str(Path(self.c['archives'])/self.old_archive)])

    def test_unknown_state_or_missing_prior_refuses_all_cleanup(self):
        self.job['phase']='unknown';self.save()
        with self.assertRaisesRegex(RuntimeError,'Unrecognized'):
            guard.assert_removable(self.c,self.fd,[str(self.root/'unrelated')])
        self.job['phase']='armed';self.job['priorIdentity'][1]+=100000;self.save()
        with self.assertRaisesRegex(RuntimeError,'not uniquely'):
            guard.assert_removable(self.c,self.fd,[str(self.root/'unrelated')])

    def test_manifest_drift_refuses_all_cleanup(self):
        self.manifest.write_text('archive_name=proofofwork-ui-release-mutated.tgz\n')
        with self.assertRaisesRegex(RuntimeError,'manifest changed'):
            guard.assert_removable(self.c,self.fd,[str(self.root/'unrelated')])

    def test_reference_check_keeps_lock_for_callers_following_operation(self):
        guard.assert_removable(self.c,self.fd,[str(self.root/'unrelated')])
        script='import fcntl,sys; f=open(sys.argv[1],"r+"); fcntl.flock(f,fcntl.LOCK_EX|fcntl.LOCK_NB)'
        blocked=subprocess.run([sys.executable,'-I','-c',script,self.c['lock']],capture_output=True)
        self.assertNotEqual(blocked.returncode,0)
        self.assertIn(b'BlockingIOError',blocked.stderr)

    def test_lock_and_ancestors_are_protected(self):
        for path in (self.c['lock'], self.root):
            with self.assertRaisesRegex(RuntimeError, 'protected reference'):
                guard.assert_removable(self.c,self.fd,[str(path)])

    def test_explicit_retained_roots_and_archive_families_are_protected(self):
        root = Path(self.c['rollbacks'])/'proofofwork-www-pre-retained'
        root.mkdir()
        manifest = root/'.proofofwork-ui-release'
        manifest.write_text('archive_name=proofofwork-ui-release-retained.tgz\n')
        record = root.name + ':' + hashlib.sha256(manifest.read_bytes()).hexdigest() + ':' + 'a'*64
        self.job['retained'] = [record]; self.save()
        for path in [root] + [Path(self.c['archives'])/('proofofwork-ui-release-retained.tgz'+suffix)
                              for suffix in ('','.sha256','.provenance')]:
            with self.assertRaisesRegex(RuntimeError,'protected reference'):
                guard.assert_removable(self.c,self.fd,[str(path)])
        self.job['retained'] = [record,record]; self.save()
        with self.assertRaisesRegex(RuntimeError,'duplicate retained'):
            guard.assert_removable(self.c,self.fd,[str(self.root/'unrelated')])
        self.job['retained'] = [record]; self.save()
        manifest.write_text('archive_name=proofofwork-ui-release-mutated.tgz\n')
        with self.assertRaisesRegex(RuntimeError,'manifest changed'):
            guard.assert_removable(self.c,self.fd,[str(self.root/'unrelated')])

if __name__=='__main__':
    unittest.main(verbosity=2)
