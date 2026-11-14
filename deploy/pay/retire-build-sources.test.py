#!/usr/bin/python3
"""Synthetic fixtures only; run on the VPS with its bounded task TMPDIR."""
import importlib.util
import os
from pathlib import Path
import tarfile
import tempfile
import unittest

spec = importlib.util.spec_from_file_location('pay_retire', Path(__file__).with_name('retire-build-sources.py'))
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)

class ArchiveEqualityTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory(prefix='pay-retirement-fixture-')
        self.base = Path(self.tmp.name)
        self.root = self.base / 'source'
        self.root.mkdir()
        (self.root / 'file').write_bytes(b'exact source\n')
        (self.root / 'bin').mkdir()
        (self.root / 'bin' / 'tool').symlink_to('../file')
        self.archive = self.base / 'source.tgz'
        self.capture()

    def tearDown(self):
        self.tmp.cleanup()

    def capture(self):
        with tarfile.open(self.archive, 'w:gz') as archive:
            archive.add(self.root, arcname='source')

    def test_verified_source_remains_untouched(self):
        result = module.archive_equivalence(self.root, self.archive)
        self.assertEqual(result['entries'], 4)
        self.assertEqual((self.root / 'file').read_bytes(), b'exact source\n')
        self.assertTrue(self.archive.exists())

    def test_changed_file_extra_file_and_symlink_are_refused(self):
        for kind in ('bytes', 'extra', 'link'):
            with self.subTest(kind=kind):
                if kind == 'bytes': (self.root / 'file').write_bytes(b'other source\n')
                elif kind == 'extra': (self.root / 'extra').write_bytes(b'extra')
                else:
                    (self.root / 'bin' / 'tool').unlink()
                    (self.root / 'bin' / 'tool').symlink_to('../../outside')
                with self.assertRaises(ValueError): module.archive_equivalence(self.root, self.archive)
                (self.root / 'file').write_bytes(b'exact source\n')
                if (self.root / 'extra').exists(): (self.root / 'extra').unlink()
                if kind == 'link':
                    (self.root / 'bin' / 'tool').unlink()
                    (self.root / 'bin' / 'tool').symlink_to('../file')

    def test_external_hardlink_refused_even_when_bytes_match(self):
        os.link(self.root / 'file', self.base / 'outside')
        with self.assertRaisesRegex(ValueError, 'hardlink'): module.archive_equivalence(self.root, self.archive)

    def test_no_general_or_protected_cleanup_targets(self):
        self.assertEqual(len(module.TARGETS), 3)
        for run, source, archive_sha, receipt_sha, inode in module.TARGETS:
            self.assertTrue(run.startswith('audit-remediation-'))
            self.assertTrue(source.startswith('proofofwork-ui-source-'))
            self.assertEqual(len(archive_sha), 64)
            self.assertEqual(len(receipt_sha), 64)
            self.assertGreater(inode, 0)
            self.assertNotIn('064b6991', source)
            self.assertNotIn('e2669bc1', source)
            self.assertNotIn('1042', source)
            self.assertNotIn('c3969', source)

if __name__ == '__main__':
    unittest.main()
