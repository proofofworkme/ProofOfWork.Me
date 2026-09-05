#!/usr/bin/python3 -I
"""Mocked privilege-boundary tests; never launch root, Git, or an attestation."""
import contextlib
import hashlib
import importlib.util
from pathlib import Path
import stat
import sys
import types
import unittest
from unittest.mock import patch

sys.dont_write_bytecode = True
ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('audit5_node_attestor', ROOT / 'deploy/audit5/attest-node.py')
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)
TARGET = '/opt/proofofwork-api-stage-abcdef123456-20260905T160000Z'
ACCOUNT = types.SimpleNamespace(pw_uid=1000, pw_gid=1000)


@contextlib.contextmanager
def context(*, isolated=True, uid=0, mode=stat.S_IFDIR | 0o755,
            owner=1000, group=1000, canonical=TARGET, target=TARGET):
    details = types.SimpleNamespace(st_mode=mode, st_uid=owner, st_gid=group)
    with contextlib.ExitStack() as stack:
        for target_object, attribute, value in [
            (module.sys, 'flags', types.SimpleNamespace(isolated=isolated)),
            (module.sys, 'argv', ['attest-node.py', target]),
        ]:
            stack.enter_context(patch.object(target_object, attribute, value))
        stack.enter_context(patch.object(module.os, 'geteuid', return_value=uid))
        stack.enter_context(patch.object(module.os, 'lstat', return_value=details))
        stack.enter_context(patch.object(module.os.path, 'realpath', return_value=canonical))
        stack.enter_context(patch.object(module.pwd, 'getpwnam', return_value=ACCOUNT))
        read = stack.enter_context(patch.object(module, 'read_attestation_body', return_value=b'unchanged verified body'))
        privilege = stack.enter_context(patch.object(module, 'enable_no_new_privileges'))
        run = stack.enter_context(patch.object(module.subprocess, 'run', return_value=types.SimpleNamespace(returncode=17)))
        yield read, privilege, run


class NodeAttestorTests(unittest.TestCase):
    def test_publisher_pin_and_body_are_unchanged_and_tampering_is_rejected(self):
        source = (ROOT / 'deploy/proofofwork-node-release-publish.sh').read_bytes()
        self.assertEqual(hashlib.sha256(source).hexdigest(), module.PIN)
        body = module.attestation_body(source)
        self.assertEqual(len(body), 11239)
        self.assertEqual(hashlib.sha256(body).hexdigest(),
                         'a2f54f790fb604e004520e89fb4e097675d9ba9de0fb1322a59e51ba4fcbe9af')
        with self.assertRaises(ValueError):
            module.attestation_body(source + b'\n')

    def test_verified_body_runs_only_with_explicit_unprivileged_identity(self):
        calls = []
        with context() as (read, privilege, run):
            read.side_effect = lambda: calls.append('verified') or b'unchanged verified body'
            privilege.side_effect = lambda: calls.append('no-new-privileges')
            run.side_effect = lambda *args, **kwargs: calls.append('subprocess') or types.SimpleNamespace(returncode=17)
            self.assertEqual(module.main(), 17)
        self.assertEqual(calls, ['verified', 'no-new-privileges', 'subprocess'])
        argv = run.call_args.args[0]
        options = run.call_args.kwargs
        self.assertEqual(argv, ['/usr/bin/python3', '-I', '-', TARGET])
        self.assertEqual(options['input'], b'unchanged verified body')
        self.assertEqual((options['user'], options['group'], options['extra_groups']), (1000, 1000, []))
        self.assertEqual(options['cwd'], '/')
        self.assertTrue(options['close_fds'])
        self.assertEqual(options['timeout'], 180)
        self.assertEqual(options['env'], {'PATH': '/usr/sbin:/usr/bin:/sbin:/bin', 'LC_ALL': 'C',
                                         'GIT_OPTIONAL_LOCKS': '0', 'GIT_CONFIG_NOSYSTEM': '1',
                                         'GIT_CONFIG_GLOBAL': '/dev/null'})

    def test_invalid_privilege_path_or_candidate_is_rejected_before_publisher_read(self):
        for bad in [dict(isolated=False), dict(uid=1000), dict(owner=0), dict(group=0),
                    dict(mode=stat.S_IFDIR | 0o775), dict(mode=stat.S_IFLNK | 0o777),
                    dict(canonical='/tmp/elsewhere'), dict(target='/opt/arbitrary'),
                    dict(target=TARGET + '/child')]:
            with self.subTest(bad=bad), context(**bad) as (read, privilege, run):
                with self.assertRaises(ValueError):
                    module.main()
                read.assert_not_called()
                privilege.assert_not_called()
                run.assert_not_called()

    def test_failed_publisher_verification_never_launches_the_child(self):
        with context() as (read, privilege, run):
            read.side_effect = ValueError('Publisher changed')
            with self.assertRaises(ValueError):
                module.main()
            privilege.assert_not_called()
            run.assert_not_called()

    def test_no_new_privileges_is_required_before_child_launch(self):
        enable = module.enable_no_new_privileges
        with context() as (_, privilege, run), patch.object(module.ctypes, 'CDLL') as library, \
                patch.object(module.ctypes, 'get_errno', return_value=1):
            privilege.side_effect = enable
            library.return_value.prctl.return_value = -1
            with self.assertRaises(OSError):
                module.main()
            library.assert_called_once_with(None, use_errno=True)
            library.return_value.prctl.assert_called_once_with(38, 1, 0, 0, 0)
            run.assert_not_called()


if __name__ == '__main__':
    unittest.main(verbosity=2)
