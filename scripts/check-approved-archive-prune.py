import hashlib
import importlib.util
from pathlib import Path
import tempfile
import time
import tarfile
import unittest
import sys

sys.dont_write_bytecode = True
spec = importlib.util.spec_from_file_location('approved_archive_prune',
    Path(__file__).resolve().parents[1] / 'deploy/proofofwork-ui-approved-archive-prune.py')
helper = importlib.util.module_from_spec(spec)
spec.loader.exec_module(helper)


class ApprovedArchiveValidation(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory(prefix='pow-approved-archive-test-')
        self.root = Path(self.temporary.name)
        self.stem = 'transport-fixture'
        self.kept = self.root / self.stem
        self.kept.mkdir(mode=0o700)
        self.payload = self.kept / 'payload.txt'
        self.payload.write_bytes(b'exact retained payload\n')
        self.payload.chmod(0o600)
        self.archive = self.root / (self.stem + '.tgz')
        with tarfile.open(self.archive, 'w:gz') as archive:
            archive.add(self.kept, arcname=self.stem)
        self.refresh_expected()

    def refresh_expected(self):
        self.archive.chmod(0o600)
        digest = hashlib.sha256(self.archive.read_bytes()).hexdigest()
        checksum = Path(str(self.archive) + '.sha256')
        checksum.write_text(digest + '  ' + self.archive.name + '\n')
        checksum.chmod(0o600)
        self.approved = (self.stem, self.archive.stat().st_size, digest, 1, 23)

    def tearDown(self):
        self.temporary.cleanup()

    def validate(self):
        return helper.validate_archive(self.root, self.approved, time.monotonic() + 10)

    def test_exact_copy_is_read_only(self):
        self.approved = (*self.approved[:4], self.payload.stat().st_size)
        result = self.validate()
        self.assertEqual(result['comparedRegularFiles'], 1)
        self.assertTrue(self.archive.exists())
        self.assertTrue(self.payload.exists())

    def test_retained_bytes_changed(self):
        self.payload.write_bytes(b'different retained data\n')
        with self.assertRaises(ValueError): self.validate()

    def test_retained_symlink_is_rejected(self):
        outside = self.root / 'outside.txt'
        outside.write_bytes(self.payload.read_bytes())
        self.payload.unlink()
        self.payload.symlink_to(outside)
        with self.assertRaises(ValueError): self.validate()

    def test_changed_archive_hash_is_rejected(self):
        data = bytearray(self.archive.read_bytes())
        data[-1] ^= 1
        self.archive.write_bytes(data)
        with self.assertRaisesRegex(ValueError, 'digest'): self.validate()

    def test_foreign_archive_root_is_rejected(self):
        with tarfile.open(self.archive, 'w:gz') as archive:
            archive.add(self.payload, arcname='other/payload.txt')
        self.refresh_expected()
        with self.assertRaisesRegex(ValueError, 'unexpected'): self.validate()


if __name__ == '__main__':
    unittest.main()
