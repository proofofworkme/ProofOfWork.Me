#!/usr/bin/python3 -I
"""Private Audit29 installer fault fixtures; no production actions or root needed."""
import importlib.util
import json
import os
from pathlib import Path
import sys
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('audit29_install', ROOT / 'deploy/audit29/install-ops.py')
installer = importlib.util.module_from_spec(spec)
spec.loader.exec_module(installer)


class InstallerFaults(unittest.TestCase):
    def private_read(self, path):
        return Path(path).read_bytes(), Path(path).lstat()

    def test_main_arms_rollback_before_post_rename_fsync_fault(self):
        with tempfile.TemporaryDirectory() as root:
            base = Path(root)
            source = base / 'source'; source.mkdir()
            (source / 'fixture.py').write_bytes(b'new')
            targets = base / 'targets'; targets.mkdir()
            target = targets / 'helper'; target.write_bytes(b'old'); target.chmod(0o700)
            receipts = base / 'receipts'; receipts.mkdir()
            lock = base / 'lock'; lock.write_bytes(b'')
            manifest = base / 'manifest.json'
            manifest.write_text(json.dumps({'schema': 'proof-of-work-audit29-ops-install-v1',
                'role': 'ui', 'files': {'fixture.py': installer.digest(b'new')}}))
            bound = installer.digest(manifest.read_bytes())
            real_open, real_replace, real_fsync = os.open, os.replace, os.fsync
            fault = {'renamed': False, 'raised': False}
            def opened(path, *args, **kwargs):
                if str(path) == '/run/proofofwork-ui/deploy.lock': path = lock
                return real_open(path, *args, **kwargs)
            def renamed(src, dst):
                real_replace(src, dst)
                if Path(dst) == target: fault['renamed'] = True
            def fsync(fd):
                if fault['renamed'] and not fault['raised'] and Path(os.readlink('/proc/self/fd/' + str(fd))) == targets:
                    fault['raised'] = True
                    raise OSError('post-rename destination-parent fsync fault')
                return real_fsync(fd)
            def read(path, limit=2*1024**2):
                if str(path) == '/etc/proofofwork-retention/audit28.hold':
                    return b'held', lock.lstat()
                if str(path) == '/run/proofofwork-ui/deploy.lock': path = lock
                return self.private_read(path)
            def states(names):
                return {name: {'LoadState': 'masked' if name.endswith('.timer') else 'loaded',
                               'ActiveState': 'inactive' if name.endswith('.timer') else 'active',
                               'MainPID': '0', 'UnitFileState': 'masked' if name.endswith('.timer') else 'enabled'}
                        for name in names}
            argv = ['install-ops.py', '--role', 'ui', '--source', str(source), '--manifest', str(manifest),
                    '--manifest-sha256', bound, '--receipt-root', str(receipts)]
            with patch.object(installer, 'COMMON', {'fixture.py': str(target)}), \
                 patch.object(installer, 'ROLE', {'ui': {}}), patch.object(installer, 'directory'), \
                 patch.object(installer, 'read_safe', read), patch.object(installer, 'states', states), \
                 patch.object(installer, 'run', return_value=''), patch.object(installer.os, 'geteuid', return_value=0), \
                 patch.object(installer.os, 'open', opened), patch.object(installer.os, 'replace', renamed), \
                 patch.object(installer.os, 'fsync', fsync), patch.object(sys, 'argv', argv):
                with self.assertRaisesRegex(OSError, 'post-rename'):
                    installer.main()
            self.assertTrue(fault['raised'])
            self.assertEqual(target.read_bytes(), b'old')
            self.assertEqual(target.stat().st_mode & 0o777, 0o700)
            failure = json.loads(next(receipts.rglob('failure.json')).read_text())
            self.assertEqual(failure['installed'], [str(target)])
            self.assertFalse(list(receipts.rglob('completed.json')))

    def test_post_rename_fsync_failure_restores_prior_bytes_and_mode(self):
        with tempfile.TemporaryDirectory() as root:
            target = Path(root) / 'helper'; target.write_bytes(b'old'); target.chmod(0o700)
            before = {str(target): {'bytes': b'old', 'mode': 0o700}}
            new = {str(target): {'bytes': b'new', 'mode': 0o755}}
            installed = [str(target)]  # main arms this before replace.
            real_fsync = installer.os.fsync
            count = 0
            def fault(fd):
                nonlocal count
                count += 1
                if count == 3:  # temp file + parent, then destination parent AFTER rename.
                    raise OSError('injected post-rename parent-fsync failure')
                return real_fsync(fd)
            with patch.object(installer.os, 'fsync', fault):
                with self.assertRaises(OSError):
                    installer.replace(target, b'new', 0o755, 'fixture')
            self.assertEqual(target.read_bytes(), b'new', 'failure occurred after actual rename')
            with patch.object(installer, 'read_safe', self.private_read):
                installer.reconcile_install_failure(installed, before, new, 'fixture')
            self.assertEqual(target.read_bytes(), b'old')
            self.assertEqual(target.stat().st_mode & 0o777, 0o700)

    def test_unknown_changed_destination_is_preserved_and_refused(self):
        with tempfile.TemporaryDirectory() as root:
            target = Path(root) / 'helper'; target.write_bytes(b'unknown')
            with patch.object(installer, 'read_safe', self.private_read):
                with self.assertRaisesRegex(AssertionError, 'Unknown installed state'):
                    installer.reconcile_install_failure([str(target)],
                        {str(target): {'bytes': b'old', 'mode': 0o700}},
                        {str(target): {'bytes': b'new', 'mode': 0o755}}, 'fixture')
            self.assertEqual(target.read_bytes(), b'unknown')

    def test_new_metadata_on_failure_remains_evidence(self):
        with tempfile.TemporaryDirectory() as root:
            target = Path(root) / 'new-metadata'; target.write_bytes(b'new')
            with patch.object(installer, 'read_safe', self.private_read):
                installer.reconcile_install_failure([str(target)],
                    {str(target): {'bytes': None, 'mode': None}},
                    {str(target): {'bytes': b'new', 'mode': 0o644}}, 'fixture')
            self.assertEqual(target.read_bytes(), b'new')

    def window(self, active, busy=False, body_fails=False):
        timer = 'proofofwork-postgres-logical-backup.timer'
        prior = {'LoadState': 'loaded', 'ActiveState': active, 'MainPID': '0', 'UnitFileState': 'enabled'}
        state = prior.copy(); actions = []; receipts = []; yielded = False
        def states(names):
            return {name: state.copy() for name in names}
        def run(argv):
            actions.append(argv)
            if argv[1] == 'stop': state['ActiveState'] = 'inactive'
            if argv[1] == 'start': state['ActiveState'] = 'active'
            return ''
        fake_details = SimpleNamespace(st_mode=0o100600)
        lock = '/data/proofofwork-postgres-backups/logical/.proofofwork-postgres-logical-backup.lock'
        def lstat(path):
            self.assertEqual(str(path), lock)
            return fake_details
        def quiet():
            if busy: raise AssertionError('Backup must be quiet')
        with patch.object(installer, 'states', states), patch.object(installer, 'run', run), \
             patch.object(installer, 'exclusive', lambda path, raw: receipts.append(json.loads(raw))), \
             patch.object(installer.Path, 'lstat', lstat), patch.object(installer.Path, 'resolve', lambda p: p), \
             patch.object(installer.os, 'open', return_value=99), patch.object(installer.os, 'close'), \
             patch.object(installer.fcntl, 'flock'), patch.object(installer, 'assert_backup_quiet', quiet):
            try:
                with installer.backup_install_window(Path('/private-fixture')):
                    yielded = True
                    if body_fails: raise OSError('installation fault')
            except (AssertionError, OSError):
                pass
        self.assertEqual(state, prior)
        self.assertEqual(receipts[-1]['restored'], True)
        if active == 'active':
            self.assertEqual([row[1] for row in actions], ['stop', 'start'])
        else:
            self.assertEqual(actions, [], 'previously inactive timer must never start')
        return yielded

    def test_active_timer_restored_after_install_fault(self):
        self.assertTrue(self.window('active', body_fails=True))

    def test_inactive_timer_remains_inactive_after_install_fault(self):
        self.assertTrue(self.window('inactive', body_fails=True))

    def test_busy_writer_refuses_before_install_and_restores_timer(self):
        self.assertFalse(self.window('active', busy=True))

    def test_active_backup_even_with_zero_pid_refuses(self):
        with patch.object(installer, 'states', return_value={
                'proofofwork-postgres-logical-backup.service': {'ActiveState': 'activating', 'MainPID': '0'}}):
            with self.assertRaisesRegex(AssertionError, 'Backup must be quiet'):
                installer.assert_backup_quiet()


if __name__ == '__main__':
    unittest.main(verbosity=2)
