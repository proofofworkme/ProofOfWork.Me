import hashlib
import importlib.util
import os
from pathlib import Path
import tempfile
import unittest

spec = importlib.util.spec_from_file_location('retention', Path(__file__).resolve().parents[1] / 'deploy/proofofwork-ui-verified-retention.py')
retention = importlib.util.module_from_spec(spec)
spec.loader.exec_module(retention)


class VerifiedRetention(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.root = Path(self.temporary.name)
        self.www = self.root / 'www'
        self.rollbacks = self.root / 'rollback-roots'
        self.archives = self.root / 'releases'
        self.rollbacks.mkdir(mode=0o755)
        self.archives.mkdir(mode=0o755)
        self.current = 'aaaaaaaaaaaa-20260929T200000Z'
        self.previous = 'bbbbbbbbbbbb-20260929T190000Z'
        self.latest = self.rollbacks / ('proofofwork-www-pre-' + self.current)
        self.release(self.www, self.current)
        self.release(self.latest, self.previous)

    def tearDown(self):
        self.temporary.cleanup()

    def release(self, root, release, surfaces=None, release_format='proofofwork-ui-release-v3'):
        root.mkdir(mode=0o755)
        fields = {'format': release_format, 'release_id': release,
                  'archive_name': 'proofofwork-ui-release-' + release + '.tgz'}
        archive = self.archives / fields['archive_name']
        archive.write_bytes(('archive-' + release).encode())
        archive.chmod(0o644)
        fields['archive_sha256'] = retention.sha256(archive)
        for surface in retention.SURFACES if surfaces is None else surfaces:
            directory = root / ('proofofwork-' + surface)
            directory.mkdir(mode=0o755)
            file = directory / 'index.html'
            file.write_text('verified ' + surface)
            file.chmod(0o644)
            preimage = b'index.html\0' + b'644\0' + retention.sha256(file).encode() + b'\n'
            fields['surface.' + surface + '.sha256'] = hashlib.sha256(preimage).hexdigest()
            fields['surface.' + surface + '.file_count'] = '1'
        (root / '.proofofwork-ui-release').write_text('\n'.join(key + '=' + value for key, value in fields.items()) + '\n')
        (root / '.proofofwork-ui-release').chmod(0o644)

    def test_preserves_exact_latest_and_classifies_redundant_root(self):
        old = self.rollbacks / 'proofofwork-www-pre-cccccccccccc-20260929T180000Z'
        self.release(old, 'dddddddddddd-20260929T170000Z')
        current, previous, plan = retention.rollback_plan(self.www, self.rollbacks, self.archives)
        self.assertEqual(current['release_id'], self.current)
        self.assertEqual(previous['release_id'], self.previous)
        self.assertEqual([row['path'] for row in plan], [str(old)])
        self.assertTrue(self.latest.exists())

    def test_historical_surface_families_remain_verifiable(self):
        self.assertEqual(sorted(map(len, retention.SURFACE_FAMILIES)), [14, 15, 16, 17, 18, 19, 20])
        self.assertEqual(len(retention.SURFACES), 20)
        self.assertIn(retention.SURFACES, retention.SURFACE_FAMILIES)
        for surfaces in retention.SURFACE_FAMILIES:
            root = self.root / ('family-' + str(len(surfaces)))
            release = ('c' * 12) + '-20260929T18000' + str(len(surfaces) - 14) + 'Z'
            self.release(root, release, surfaces)
            self.assertEqual(retention.verified_release(root, self.archives)['release_id'], release)
            if 'search' not in surfaces:
                (root / 'proofofwork-search').mkdir(mode=0o755)
                with self.assertRaisesRegex(ValueError, 'Undeclared'):
                    retention.verified_release(root, self.archives)
                (root / 'proofofwork-search').rmdir()
            if 'code' not in surfaces:
                (root / 'proofofwork-code').mkdir(mode=0o755)
                with self.assertRaisesRegex(ValueError, 'Undeclared release surface: code'):
                    retention.verified_release(root, self.archives)
                (root / 'proofofwork-code').rmdir()
            if 'jobs' not in surfaces:
                (root / 'proofofwork-jobs').mkdir(mode=0o755)
                with self.assertRaisesRegex(ValueError, 'Undeclared release surface: jobs'):
                    retention.verified_release(root, self.archives)

    def test_corrupt_current_bytes_refuse_plan(self):
        (self.www / 'proofofwork-dns/index.html').write_text('corrupt')
        with self.assertRaisesRegex(ValueError, 'fingerprint'):
            retention.rollback_plan(self.www, self.rollbacks, self.archives)

    def test_v4_pages_is_exact_and_v3_rollback_remains_verified(self):
        root = self.root / 'pages-v4'
        release = 'eeeeeeeeeeee-20261008T000000Z'
        self.release(root, release, retention.PAGES_SURFACES, 'proofofwork-ui-release-v4')
        self.assertEqual(retention.verified_release(root, self.archives)['format'], 'proofofwork-ui-release-v4')
        self.assertEqual(retention.verified_release(self.latest, self.archives)['format'], 'proofofwork-ui-release-v3')
        self.assertEqual(retention.passthrough_fingerprint(root), retention.passthrough_fingerprint(self.latest))
        manifest = root / '.proofofwork-ui-release'
        original = manifest.read_text()
        manifest.write_text(original.replace('proofofwork-ui-release-v4', 'proofofwork-ui-release-v3'))
        with self.assertRaisesRegex(ValueError, 'Incomplete release surface coverage'):
            retention.verified_release(root, self.archives)
        manifest.write_text('\n'.join(line for line in original.splitlines() if not line.startswith('surface.pages.')) + '\n')
        with self.assertRaisesRegex(ValueError, 'Incomplete release surface coverage'):
            retention.verified_release(root, self.archives)

    def test_v3_undeclared_pages_refuses_verification(self):
        (self.www / 'proofofwork-pages').mkdir(mode=0o755)
        with self.assertRaisesRegex(ValueError, 'Undeclared release surface: pages'):
            retention.verified_release(self.www, self.archives)

    def test_corrupt_latest_archive_refuses_plan(self):
        (self.archives / ('proofofwork-ui-release-' + self.previous + '.tgz')).write_bytes(b'corrupt')
        with self.assertRaisesRegex(ValueError, 'checksum'):
            retention.rollback_plan(self.www, self.rollbacks, self.archives)

    def test_missing_latest_refuses_plan(self):
        self.latest.rename(self.rollbacks / 'unclassified')
        with self.assertRaises((ValueError, FileNotFoundError)):
            retention.rollback_plan(self.www, self.rollbacks, self.archives)

    def test_symlink_in_verified_surface_refuses_plan(self):
        file = self.www / 'proofofwork-dns/index.html'
        file.unlink()
        file.symlink_to(self.archives / ('proofofwork-ui-release-' + self.current + '.tgz'))
        with self.assertRaisesRegex(ValueError, 'Unsafe'):
            retention.rollback_plan(self.www, self.rollbacks, self.archives)

    def test_live_process_reference_refuses_removal(self):
        with self.assertRaisesRegex(ValueError, 'references'):
            retention.referenced_paths([{'path': os.getcwd()}])

    def test_unique_non_release_recovery_content_refuses_removal(self):
        old = self.rollbacks / 'proofofwork-www-pre-cccccccccccc-20260929T180000Z'
        self.release(old, 'dddddddddddd-20260929T170000Z')
        evidence = old / 'incident-evidence.txt'
        evidence.write_text('Unique incident evidence must survive.')
        evidence.chmod(0o644)
        with self.assertRaisesRegex(ValueError, 'unique non-release'):
            retention.rollback_plan(self.www, self.rollbacks, self.archives)


if __name__ == '__main__':
    unittest.main()
