#!/usr/bin/python3 -I
"""Private launcher fixtures only; no production paths, services or credentials."""
import datetime as dt
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import pwd
import subprocess
import sys
import tempfile
import time
import unittest
from unittest.mock import patch

BASE = Path(__file__).resolve().parent
spec = importlib.util.spec_from_file_location('audit29_private', BASE / 'private-verify.py')
launch = importlib.util.module_from_spec(spec); spec.loader.exec_module(launch)
private = {'__file__': str(BASE.parent / 'audit5/private-env.py'), '__name__': 'private_fixture'}
raw = (BASE.parent / 'audit5/private-env.py').read_bytes()
assert hashlib.sha256(raw).hexdigest() == launch.PRIVATE_PIN
exec(compile(raw, private['__file__'], 'exec'), private)
RELEASE = 'a' * 12 + '-20261001T060000Z'
SHA = 'b' * 64
IDENTITY = {'unit': 'api.service', 'pid': 120, 'startTicks': 100, 'uid': 1001}


def capture():
    return {'format': 'private-audit5-environments-v1', 'releaseId': RELEASE,
            'capturedAt': '2026-10-01T06:00:00+00:00', 'processes': {'api': {
                'environmentSha256': SHA, 'identityBefore': IDENTITY.copy(),
                'identityAfter': IDENTITY.copy(), 'identityFinal': IDENTITY.copy()}}}


class PrivateVerifier(unittest.TestCase):
    def test_roles_refuse_live_receipt_for_shadow_and_staged_production(self):
        self.assertEqual(str(launch.role('shadow', RELEASE, 'http://127.0.0.1:18081')[0]),
                         '/opt/proofofwork-api-stage-' + RELEASE)
        self.assertEqual(launch.role('production', RELEASE, 'https://api.proofofwork.me')[1],
                         'http://127.0.0.1:8081')
        for mode, base in [('shadow', 'http://127.0.0.1:8081'),
                           ('production', 'http://127.0.0.1:18081'),
                           ('production', 'https://api.proofofwork.me?secret=x'),
                           ('production', 'https://api.proofofwork.me.evil.test'),
                           ('production', 'https://user:secret@api.proofofwork.me')]:
            with self.assertRaises(RuntimeError): launch.role(mode, RELEASE, base)

    def test_fresh_capture_requires_exact_env_hash_and_process_start_identity(self):
        now = dt.datetime(2026, 10, 1, 6, 1, tzinfo=dt.timezone.utc)
        launch.verify_capture(capture(), RELEASE, SHA, IDENTITY, now)
        for sha, identity, at in [('c' * 64, IDENTITY, now),
                                  (SHA, {**IDENTITY, 'startTicks': 101}, now),
                                  (SHA, IDENTITY, now + dt.timedelta(seconds=61)),
                                  (SHA, IDENTITY, now - dt.timedelta(seconds=61))]:
            with self.assertRaises(RuntimeError): launch.verify_capture(capture(), RELEASE, sha, identity, at)
        wrong = capture(); wrong['processes']['api']['identityFinal']['pid'] = 121
        with self.assertRaises(RuntimeError): launch.verify_capture(wrong, RELEASE, SHA, IDENTITY, now)

    def test_original_capture_scrub_and_readonly_contract_are_retained(self):
        original = {b'POW_INDEX_DATABASE_URL': b'postgresql://fixture:private@127.0.0.1/proof_indexer?options=-c+default_transaction_read_only%3Doff',
                    b'POW_INTERNAL_VERIFIER_TOKEN': b'x' * 40, b'LISTEN_FDS': b'3',
                    b'POW_INDEX_WORK_ATOMIC_EVENT_REPAIR_APPLY': b'1', b'NODE_OPTIONS': b'--max-old-space-size=8192'}
        env = launch.readonly_plan(private, original, RELEASE, Path('/opt/proofofwork-api'), 'http://127.0.0.1:8081')
        url = launch.urllib.parse.urlsplit(os.fsdecode(env[b'POW_INDEX_DATABASE_URL']))
        options = dict(launch.urllib.parse.parse_qsl(url.query))['options']
        self.assertTrue(options.endswith('-c default_transaction_read_only=on -c statement_timeout=30000 -c lock_timeout=5000 -c idle_in_transaction_session_timeout=30000'))
        self.assertEqual(env[b'POW_INDEX_DB_POOL_MAX'], b'1')
        self.assertEqual(env[b'POW_ID_AUDIT_WRITE_REPORTS'], b'0')
        self.assertEqual(env[b'POW_INDEX_PARITY_STRICT'], b'1')
        self.assertEqual(env[b'PROOF_INDEX_DATABASE_URL'], b'')
        self.assertEqual(env[b'DATABASE_URL'], b'')
        for key in (b'LISTEN_FDS', b'NODE_OPTIONS', b'POW_INDEX_WORK_ATOMIC_EVENT_REPAIR_APPLY'):
            self.assertNotIn(key, env)
        for key, value in [(b'NODE_OPTIONS', b'--require=evil.mjs'), (b'LD_PRELOAD', b'evil.so'),
                           (b'LD_LIBRARY_PATH', b'/tmp/evil')]:
            with self.assertRaises(Exception):
                launch.readonly_plan(private, {**original, key: value}, RELEASE, Path('/opt/proofofwork-api'), 'http://127.0.0.1:8081')
        with self.assertRaises(RuntimeError):
            launch.readonly_plan(private, {**original, b'POW_INDEX_DATABASE_URL': b'postgres://x/other'}, RELEASE,
                                 Path('/opt/proofofwork-api'), 'http://127.0.0.1:8081')

    def test_unit_requires_exact_own_pid_finite_lifetime_and_cgroup(self):
        unit = 'test.service'; fields = {'ActiveState': 'active', 'MainPID': '122',
            'KillMode': 'control-group', 'RuntimeMaxUSec': '20min', 'ControlGroup': '/system.slice/test.service'}
        launch.managed(fields, unit, 122, '0::/system.slice/test.service\n')
        for field, value in [('MainPID', '123'), ('RuntimeMaxUSec', 'infinity'),
                             ('KillMode', 'process'), ('ActiveState', 'inactive'), ('ControlGroup', '/wrong.service')]:
            with self.assertRaises(RuntimeError): launch.managed({**fields, field: value}, unit, 122, '0::/system.slice/test.service\n')
        with self.assertRaises(RuntimeError): launch.managed(fields, unit, 122, '0::/another.service\n')

    def test_recovery_reserve_refuses_exhausted_normal_budget(self):
        with patch.object(launch.time, 'monotonic', return_value=1050):
            with self.assertRaises(RuntimeError): launch.remaining(1050, 900)
            self.assertEqual(launch.remaining(1140, 180, reserve=45), 45)
            with self.assertRaises(RuntimeError): launch.remaining(1095, 180, reserve=45)

    def test_shared_ops_lock_refuses_competing_mutation_and_releases_on_failure(self):
        with tempfile.TemporaryDirectory() as folder:
            path = Path(folder) / 'ops.lock'; path.write_bytes(b''); path.chmod(0o600)
            competing = os.open(path, os.O_RDONLY)
            launch.fcntl.flock(competing, launch.fcntl.LOCK_EX | launch.fcntl.LOCK_NB)
            # Only fixture ownership validation is mocked; flock uses real FDs.
            with patch.object(launch, 'OPS_LOCK', path), patch.object(launch, 'read', return_value=b''):
                with self.assertRaises(BlockingIOError):
                    with launch.operations_lock(): self.fail('Competing lock was admitted')
                os.close(competing)
                with self.assertRaisesRegex(ValueError, 'private fixture'):
                    with launch.operations_lock(): raise ValueError('private fixture')
                with launch.operations_lock(): pass

    def process(self, argv, timeout):
        actual = subprocess.Popen
        def private_spawn(*args, **kwargs):
            # The fixture runs as the current user; production still performs
            # the exact powadmin UID/GID/empty supplementary-group transition.
            for key in ('user', 'group', 'extra_groups'): kwargs.pop(key)
            return actual(*args, **kwargs)
        with patch.object(launch.subprocess, 'Popen', private_spawn):
            return launch.stream_child(argv, '/', {'PATH': '/usr/bin:/bin'}, pwd.getpwuid(os.getuid()), timeout)

    def test_child_output_is_hashed_and_discarded_including_private_errors(self):
        secret = 'PRIVATE_FIXTURE_SENTINEL'
        result = self.process([sys.executable, '-I', '-c',
            "import sys; sys.stdout.write('" + secret + "'); sys.stderr.write('" + secret + "')"], 3)
        self.assertEqual(result['exitCode'], 0)
        self.assertNotIn(secret, json.dumps(result))
        for name in ('stdout', 'stderr'):
            self.assertEqual(result[name], {'bytes': len(secret), 'sha256': hashlib.sha256(secret.encode()).hexdigest()})

    def test_failure_still_kills_descendants_after_leader_already_exited(self):
        with tempfile.TemporaryDirectory() as folder:
            childfile = Path(folder) / 'child.pid'
            code = "import os,time,pathlib; p=os.fork(); " + \
                   "pathlib.Path(" + repr(str(childfile)) + ").write_text(str(p)) if p else None; " + \
                   "os._exit(0) if p else time.sleep(30)"
            started = time.monotonic()
            with self.assertRaises(launch.ChildFailure) as failure:
                self.process([sys.executable, '-I', '-c', code], 0.4)
            self.assertLess(time.monotonic() - started, 3)
            self.assertEqual(failure.exception.result['errorClass'], 'RuntimeError')
            pid = int(childfile.read_text())
            for _ in range(30):
                status = Path('/proc') / str(pid) / 'stat'
                try:
                    if status.read_text().split(') ', 1)[1][0] == 'Z': break
                except (FileNotFoundError, ProcessLookupError):
                    break  # Successful termination may disappear during the read.
                time.sleep(0.01)
            else: self.fail('Private descendant survived process-group termination')

    def test_oversized_child_output_is_bounded_without_raw_output_persistence(self):
        with self.assertRaises(launch.ChildFailure) as failure:
            self.process([sys.executable, '-I', '-c', "import os; os.write(1,b'x'*2097152)"], 3)
        self.assertGreater(failure.exception.result['stdout']['bytes'], 1024**2)
        self.assertLessEqual(failure.exception.result['stdout']['bytes'], 1024**2 + 65536)
        self.assertNotIn('xxxxx', json.dumps(failure.exception.result))


if __name__ == '__main__': unittest.main(verbosity=2)
