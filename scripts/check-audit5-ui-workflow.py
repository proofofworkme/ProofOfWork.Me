#!/usr/bin/python3
"""Temporary-only behavior fixtures for the audit-5 UI transport/capacity path."""
import hashlib
import importlib.util
import io
import json
import os
from pathlib import Path
import subprocess
import sys
import tarfile
import tempfile
import unittest
from unittest import mock

ROOT = Path(__file__).resolve().parents[1]


def load(name, relative):
    spec = importlib.util.spec_from_file_location(name, ROOT / relative)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


stream = load('audit5_stream', 'deploy/audit5/stream-ui-bundle.py')
capacity = load('audit5_capacity', 'deploy/audit5/ui-capacity.py')
RELEASE = 'abcdef012345-20260905T000000Z'


def archive_bytes(mode='surfaces', entries=None):
    top = f'proofofwork-ui-{mode}-{RELEASE}'
    output = io.BytesIO()
    with tarfile.open(fileobj=output, mode='w:gz') as archive:
        member = tarfile.TarInfo(top)
        member.type, member.mode = tarfile.DIRTYPE, 0o755
        archive.addfile(member)
        for name, kind, value, mode_bits in entries or [('index.html', 'file', b'accepted', 0o644)]:
            member = tarfile.TarInfo(top + '/' + name)
            member.mode = mode_bits
            if kind == 'link':
                member.type, member.linkname = tarfile.SYMTYPE, value
            elif kind == 'hardlink':
                member.type, member.linkname = tarfile.LNKTYPE, top + '/' + value
            else:
                member.size = len(value)
            archive.addfile(member, io.BytesIO(value) if member.isfile() else None)
    return output.getvalue()


class TransportTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory(prefix='pow-audit5-ui-test-')
        self.parent = Path(self.temporary.name)
        self.lock = self.parent / 'deploy.lock'
        self.lock.touch(mode=0o600)
        self.old = self.parent / 'preserved-live-and-rollback'
        self.old.write_bytes(b'untouched')

    def tearDown(self):
        self.assertEqual(self.old.read_bytes(), b'untouched')
        self.temporary.cleanup()

    def receive(self, data, mode='surfaces', **options):
        return stream.receive(mode, RELEASE, options.pop('length', len(data)),
                              options.pop('digest', hashlib.sha256(data).hexdigest()),
                              io.BytesIO(data), self.parent, self.lock,
                              owner=os.getuid(), floor=0, **options)

    def test_success_pins_digest_bytes_and_new_root(self):
        data = archive_bytes()
        receipt = self.receive(data)
        root = Path(receipt['extractedRoot'])
        self.assertEqual((root / 'index.html').read_bytes(), b'accepted')
        self.assertEqual(receipt['archiveSha256'], hashlib.sha256(data).hexdigest())
        self.assertEqual(receipt['compressedBytes'], len(data))
        self.assertEqual(receipt, json.loads((self.parent / f'audit5-stream-surfaces-{RELEASE}.json').read_text()))

    def test_bad_digest_does_not_publish(self):
        with self.assertRaisesRegex(RuntimeError, 'digest mismatch'):
            self.receive(archive_bytes(), digest='0' * 64)
        self.assertFalse((self.parent / f'proofofwork-ui-surfaces-{RELEASE}').exists())

    def test_truncation_and_extra_transport_bytes_fail(self):
        data = archive_bytes()
        with self.assertRaises(Exception):
            self.receive(data[:-9], length=len(data))
        # Each failure's newly created scratch is retained; use a separate release.
        with tempfile.TemporaryDirectory(prefix='pow-extra-stream-') as other:
            parent = Path(other); lock = parent / 'lock'; lock.touch(mode=0o600)
            with self.assertRaisesRegex(RuntimeError, 'Extra transport bytes'):
                stream.receive('surfaces', RELEASE, len(data), hashlib.sha256(data).hexdigest(),
                               io.BytesIO(data + b'extra'), parent, lock, owner=os.getuid(), floor=0)

    def test_unsafe_paths_links_and_modes_fail(self):
        cases = [('../escape', 'file', b'x', 0o644),
                 ('unsafe', 'link', '/etc/passwd', 0o777),
                 ('unsafe', 'hardlink', 'index.html', 0o644),
                 ('unsafe', 'file', b'x', 0o666)]
        for entry in cases:
            with self.subTest(entry=entry), tempfile.TemporaryDirectory(prefix='pow-bad-stream-') as other:
                parent = Path(other); lock = parent / 'lock'; lock.touch(mode=0o600)
                data = archive_bytes(entries=[entry])
                with self.assertRaises(Exception):
                    stream.receive('surfaces', RELEASE, len(data), hashlib.sha256(data).hexdigest(),
                                   io.BytesIO(data), parent, lock, owner=os.getuid(), floor=0)
                self.assertFalse((parent / f'proofofwork-ui-surfaces-{RELEASE}').exists())

    def test_source_internal_0777_symlink_preserved(self):
        receipt = self.receive(archive_bytes('source', [('target', 'file', b'program', 0o755),
                                                       ('command', 'link', 'target', 0o777)]), 'source')
        root = Path(receipt['extractedRoot'])
        self.assertTrue((root / 'command').is_symlink())
        self.assertEqual(os.readlink(root / 'command'), 'target')
        self.assertEqual((root / 'command').read_bytes(), b'program')

    def test_source_escaping_symlink_refused(self):
        with self.assertRaisesRegex(RuntimeError, 'leaves checkout'):
            self.receive(archive_bytes('source', [('escape', 'link', '../outside', 0o777)]), 'source')

    def test_duplicate_member_refused(self):
        with self.assertRaisesRegex(RuntimeError, 'Duplicate archive path'):
            self.receive(archive_bytes(entries=[('same', 'file', b'one', 0o644),
                                               ('same', 'file', b'two', 0o644)]))

    def test_existing_release_is_not_replaced(self):
        root = self.parent / f'proofofwork-ui-surfaces-{RELEASE}'
        root.mkdir(); (root / 'sentinel').write_bytes(b'prior')
        with self.assertRaisesRegex(RuntimeError, 'already exists'):
            self.receive(archive_bytes())
        self.assertEqual((root / 'sentinel').read_bytes(), b'prior')

    def test_concurrent_destination_is_not_replaced(self):
        real = stream.ctypes.CDLL(None, use_errno=True)
        class Concurrent:
            def renameat2(_self, fd, source, target_fd, target, flags):
                root = Path(os.fsdecode(target)); root.mkdir()
                (root / 'sentinel').write_bytes(b'concurrent')
                return real.renameat2(fd, source, target_fd, target, flags)
        with mock.patch.object(stream.ctypes, 'CDLL', return_value=Concurrent()):
            with self.assertRaises(OSError):
                self.receive(archive_bytes())
        root = self.parent / f'proofofwork-ui-surfaces-{RELEASE}'
        self.assertEqual((root / 'sentinel').read_bytes(), b'concurrent')

    def test_disk_floor_fails_before_publication(self):
        data = archive_bytes()
        with self.assertRaisesRegex(RuntimeError, 'free-space reserve'):
            stream.receive('surfaces', RELEASE, len(data), hashlib.sha256(data).hexdigest(),
                           io.BytesIO(data), self.parent, self.lock, owner=os.getuid(), floor=10**30)
        self.assertFalse((self.parent / f'proofofwork-ui-surfaces-{RELEASE}').exists())

    def test_cli_requires_isolation_before_local_imports(self):
        entry = self.parent / 'receive.py'
        entry.write_bytes((ROOT / 'deploy/audit5/stream-ui-bundle.py').read_bytes())
        (self.parent / 'ctypes.py').write_text("raise RuntimeError('POISONED_LOCAL_IMPORT')\n")
        ordinary = subprocess.run([sys.executable, str(entry)], capture_output=True, text=True)
        self.assertNotEqual(ordinary.returncode, 0)
        self.assertIn('python3 -I', ordinary.stderr)
        self.assertNotIn('POISONED_LOCAL_IMPORT', ordinary.stderr)
        isolated = subprocess.run([sys.executable, '-I', str(entry)], capture_output=True, text=True)
        self.assertNotEqual(isolated.returncode, 0)  # No production arguments supplied.
        self.assertNotIn('POISONED_LOCAL_IMPORT', isolated.stderr)
        self.assertTrue('Run receiver as root' in isolated.stderr or 'Usage:' in isolated.stderr)


class CapacityTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory(prefix='pow-ui-capacity-test-')
        self.root = Path(self.temporary.name)
        for name in capacity.SURFACES:
            surface = self.root / name; surface.mkdir(mode=0o755)
            (surface / 'bundle.js').write_bytes(b'common-bundle')
            (surface / 'bundle.js').chmod(0o644)

    def tearDown(self):
        self.temporary.cleanup()

    def test_duplicate_budget_ignores_timestamp_but_keeps_metadata(self):
        os.utime(self.root / 'boost/bundle.js', ns=(1000000000, 1000000000))
        result = capacity.tree_budget(self.root, owner=os.getuid())
        self.assertEqual(result['uniqueIncomingBytes'], os.statvfs(self.root).f_frsize)
        self.assertGreater(result['incomingMetadataBytes'], 0)
        self.assertGreater(result['largestSurfaceCopyBytes'], result['uniqueIncomingBytes'])

    def test_distinct_bytes_modes_and_xattrs_are_not_deduped(self):
        (self.root / 'boost/bundle.js').write_bytes(b'different')
        (self.root / 'computer/bundle.js').chmod(0o640)
        result = capacity.tree_budget(self.root, owner=os.getuid())
        self.assertEqual(result['uniqueIncomingBytes'], 3 * os.statvfs(self.root).f_frsize)
        os.setxattr(self.root / 'desktop/bundle.js', 'user.audit5-fixture', b'distinct')
        result = capacity.tree_budget(self.root, owner=os.getuid())
        self.assertEqual(result['uniqueIncomingBytes'], 4 * os.statvfs(self.root).f_frsize)

    def test_links_and_preexisting_hardlinks_are_refused(self):
        target = self.root / 'boost/bundle.js'; target.unlink()
        target.symlink_to('../computer/bundle.js')
        with self.assertRaises(ValueError):
            capacity.tree_budget(self.root, owner=os.getuid())
        target.unlink(); os.link(self.root / 'computer/bundle.js', target)
        with self.assertRaisesRegex(ValueError, 'independent regular copies'):
            capacity.tree_budget(self.root, owner=os.getuid())

    def test_candidate_bound_includes_new_assets_compatibility_and_copy_peak(self):
        result = capacity.tree_budget(self.root, owner=os.getuid())
        live = 400 * 1024**2
        required = live + result['uniqueIncomingBytes'] + result['incomingMetadataBytes'] + result['largestSurfaceCopyBytes']
        self.assertGreater(required, live + result['largestSurfaceCopyBytes'])

    def test_portable_archive_dereferences_candidate_links_and_fits_bound(self):
        stage = self.root / 'stage'; stage.mkdir()
        previous = None
        for name in capacity.SURFACES:
            surface = stage / ('proofofwork-' + name); surface.mkdir(mode=0o755)
            target = surface / 'bundle.js'
            if previous is None:
                target.write_bytes(os.urandom(20000)); target.chmod(0o644); previous = target
            else:
                os.link(previous, target)
        budget = capacity.tree_budget(stage, owner=os.getuid(), managed=True)
        base = self.root / 'base'; (base / 'surfaces').mkdir(parents=True)
        archive = self.root / 'portable.tgz'
        command = ['tar', '--sort=name', '--create', '--gzip', '--hard-dereference', '--file', str(archive),
                   '--transform=s|^proofofwork-|surfaces/|', '--directory', str(base), 'surfaces',
                   '--directory', str(stage), *['proofofwork-' + n for n in capacity.SURFACES]]
        subprocess.run(command, check=True, capture_output=True)
        self.assertLessEqual(archive.stat().st_size, budget['archiveUpperBoundBytes'])
        restored = self.root / 'restore'; restored.mkdir()
        with tarfile.open(archive) as payload:
            self.assertTrue(all(m.isdir() or m.isfile() for m in payload))
            payload.extractall(restored, filter='data')
        targets = [restored / 'surfaces' / n / 'bundle.js' for n in capacity.SURFACES]
        self.assertEqual(len({p.stat().st_ino for p in targets}), len(targets))
        self.assertTrue(all(p.read_bytes() == previous.read_bytes() for p in targets))
        self.assertTrue(all(p.stat().st_ino != previous.stat().st_ino for p in targets))


if __name__ == '__main__':
    unittest.main(verbosity=2)
