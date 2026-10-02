#!/usr/bin/python3 -I
"""Private installer safety/fault fixtures; no production access or root needed."""
import contextlib
import copy
import importlib.util
import io
import json
import os
from pathlib import Path
import signal
import stat
import subprocess
import sys
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location('audit30_retention_install',
    Path(__file__).with_name('install-retention.py'))
installer = importlib.util.module_from_spec(spec)
spec.loader.exec_module(installer)


class PrivateInstall:
    def __init__(self, root, role='ui'):
        self.root = root
        self.role = role
        self.source = root / 'source'
        self.receipts = root / 'receipts'
        self.source.mkdir()
        self.receipts.mkdir()
        self.paths = installer.mapping(role)
        self.before = {}
        self.new = {}
        for index, (source, destination) in enumerate(self.paths.items()):
            blob = ('new-' + source).encode()
            if source.endswith('.service'):
                blob = (Path(__file__).resolve().parent.parent / Path(source).name).read_bytes()
                if role == 'ui':
                    blob = blob.replace(b'TimeoutStartSec=60s\n', b'TimeoutStartSec=20s\n')
            previous = ('prior-' + source).encode()
            mode = 0o700 if index == 0 else 0o600
            candidate = self.source / source
            candidate.parent.mkdir(parents=True, exist_ok=True)
            candidate.write_bytes(blob)
            target = self.translate(destination)
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_bytes(previous)
            target.chmod(mode)
            self.before[destination] = (previous, mode)
            self.new[destination] = blob
        self.hold = self.translate('/etc/proofofwork-retention/audit28.hold')
        self.hold.parent.mkdir(parents=True, exist_ok=True)
        self.hold.write_bytes(b'hold-authority-unchanged')
        lock_path = '/run/proofofwork-ui/deploy.lock' if role == 'ui' else '/run/proofofwork-audit29-ops.lock'
        self.lock = self.translate(lock_path)
        self.lock.parent.mkdir(parents=True, exist_ok=True)
        self.lock.write_bytes(b'')
        self.approval = root / 'human-approval.json'
        self.scope = root / 'reviewed-scope.json'
        self.approval.write_bytes(b'private approved fixture')
        self.scope.write_bytes(b'private reviewed proposal fixture')
        self.ui_deadline_approval = None
        self.manifest = {
            'schema': 'proof-of-work-audit30-retention-install-v1', 'role': role,
            'approvalSha256': installer.digest(self.approval.read_bytes()),
            'scopeSha256': installer.digest(self.scope.read_bytes()),
            'holdSha256': installer.digest(self.hold.read_bytes()),
            'files': {source: {'sha256': installer.digest(self.new[destination]),
                              'previousSha256': installer.digest(self.before[destination][0]),
                              'previousMode': self.before[destination][1]}
                      for source, destination in self.paths.items()},
        }
        self.manifest_file = root / 'install-manifest.json'
        self.write_manifest()
        self.commands = []
        self.state_queries = []
        self.stdout = io.StringIO()

    def translate(self, path):
        path = Path(path)
        return path if path.is_relative_to(self.root) else self.root / 'filesystem' / str(path).lstrip('/')

    def write_manifest(self):
        self.manifest_file.write_text(json.dumps(self.manifest))

    def ui_unit(self, raw):
        source = 'deploy/proofofwork-retention-protection-ui.service'
        (self.source / source).write_bytes(raw)
        self.new[self.paths[source]] = raw
        self.manifest['files'][source]['sha256'] = installer.digest(raw)
        self.write_manifest()

    def approve_ui_deadline(self):
        self.ui_deadline_approval = self.root / 'ui-deadline-approval.json'
        self.ui_deadline_approval.write_bytes((Path(__file__).resolve().parents[2] /
            'audits/2026-10-02-audit30-ui-monitor-deadline-approval.json').read_bytes())
        self.manifest['uiDeadlineApprovalSha256'] = installer.UI_DEADLINE_APPROVAL_SHA256
        self.write_manifest()

    def states(self, names):
        self.state_queries.append(list(names))
        result = {}
        for name in names:
            prune = name in ('proofofwork-ui-release-prune.timer',
                'proofofwork-ui-storage-prune.timer', 'proofofwork-node-release-prune.timer')
            inactive = prune or name in ('proofofwork-retention-protection.service', 'pg_receivewal@16-main.service')
            result[name] = {'LoadState': 'masked' if prune else 'loaded',
                'ActiveState': 'inactive' if inactive else 'active',
                'MainPID': '0' if name.endswith('.timer') or inactive else '42',
                'UnitFileState': 'masked' if prune else 'disabled' if name == 'pg_receivewal@16-main.service' else 'enabled'}
        return result

    def run(self, argv):
        self.commands.append(argv)
        assert argv == ['systemctl', 'daemon-reload'], 'Unreviewed operation reached fixture'
        return ''

    @staticmethod
    def private_read(path, limit=2 * 1024**2):
        path = Path(path)
        return path.read_bytes(), path.lstat()

    @contextlib.contextmanager
    def installed_context(self):
        argv = ['install-retention.py', '--role', self.role, '--source', str(self.source),
                '--manifest', str(self.manifest_file), '--manifest-sha256', installer.digest(self.manifest_file.read_bytes()),
                '--approval', str(self.approval), '--scope', str(self.scope), '--receipt-root', str(self.receipts)]
        if self.ui_deadline_approval is not None:
            argv += ['--ui-deadline-approval', str(self.ui_deadline_approval)]
        with contextlib.ExitStack() as stack:
            for mocked in (
                patch.object(installer, 'Path', self.translate),
                patch.object(installer, 'directory'),
                patch.object(installer, 'read_safe', self.private_read),
                patch.object(installer, 'states', self.states),
                patch.object(installer, 'run', self.run),
                patch.object(installer, 'APPROVAL_SHA256', self.manifest['approvalSha256']),
                patch.object(installer, 'SCOPE_SHA256', self.manifest['scopeSha256']),
                patch.object(installer.os, 'geteuid', return_value=0),
                patch.object(sys, 'flags', SimpleNamespace(isolated=1, optimize=0)),
                patch.object(sys, 'argv', argv),
                contextlib.redirect_stdout(self.stdout),
            ):
                stack.enter_context(mocked)
            yield

    def assert_restored(self, test):
        for destination, (previous, mode) in self.before.items():
            target = self.translate(destination)
            test.assertEqual(target.read_bytes(), previous)
            test.assertEqual(stat.S_IMODE(target.stat().st_mode), mode)


class RetentionInstallerTests(unittest.TestCase):
    @staticmethod
    def approved_ui_unit():
        return (Path(__file__).resolve().parent.parent /
            'proofofwork-retention-protection-ui.service').read_bytes()

    def test_exact_60_second_ui_unit_requires_exact_separate_approval(self):
        raw = self.approved_ui_unit()
        self.assertEqual(installer.digest(raw), installer.UI_60_SECOND_UNIT_SHA256)
        with tempfile.TemporaryDirectory() as root:
            env = PrivateInstall(Path(root))
            env.ui_unit(raw)
            env.approve_ui_deadline()
            with env.installed_context():
                installer.main()
            self.assertEqual(env.commands, [['systemctl', 'daemon-reload']])
            intent = json.loads(next(env.receipts.rglob('intent.json')).read_text())
            self.assertEqual(intent['uiDeadlineApprovalSha256'], installer.UI_DEADLINE_APPROVAL_SHA256)

    def test_ui_deadline_missing_tampered_or_wrong_approval_refuses_before_install(self):
        for fault in ('missingFile', 'missingManifestPin', 'wrongManifestPin', 'tamperedApproval'):
            with self.subTest(fault=fault), tempfile.TemporaryDirectory() as root:
                env = PrivateInstall(Path(root))
                env.ui_unit(self.approved_ui_unit())
                env.approve_ui_deadline()
                if fault == 'missingFile': env.ui_deadline_approval = None
                elif fault == 'missingManifestPin': del env.manifest['uiDeadlineApprovalSha256']
                elif fault == 'wrongManifestPin': env.manifest['uiDeadlineApprovalSha256'] = '0' * 64
                elif fault == 'tamperedApproval': env.ui_deadline_approval.write_bytes(b'changed unapproved deadline')
                env.write_manifest()
                with env.installed_context(), self.assertRaises(AssertionError):
                    installer.main()
                env.assert_restored(self)
                self.assertFalse(env.commands)
                self.assertFalse(list(env.receipts.iterdir()))

    def test_ui_deadline_preserves_exact_unit_and_original_20_needs_no_extra_approval(self):
        raw = self.approved_ui_unit()
        with tempfile.TemporaryDirectory() as root:
            env = PrivateInstall(Path(root))
            env.ui_unit(raw.replace(b'TimeoutStartSec=60s\n', b'TimeoutStartSec=20s\n'))
            with env.installed_context():
                installer.main()
            self.assertEqual(env.commands, [['systemctl', 'daemon-reload']])
        for fault in ('otherUnitBytes', 'alternate60', 'differentDeadline'):
            with self.subTest(fault=fault), tempfile.TemporaryDirectory() as root:
                env = PrivateInstall(Path(root))
                blob = raw.replace(b'MemoryMax=32M\n', b'MemoryMax=64M\n') if fault == 'otherUnitBytes' else \
                    raw.replace(b'TimeoutStartSec=60s\n', b'TimeoutStartSec=60\n' if fault == 'alternate60' else b'TimeoutStartSec=61s\n')
                env.ui_unit(blob)
                if fault == 'otherUnitBytes': env.approve_ui_deadline()
                with env.installed_context(), self.assertRaises(AssertionError):
                    installer.main()
                env.assert_restored(self)
                self.assertFalse(env.commands)
                self.assertFalse(list(env.receipts.iterdir()))

    def test_original_ui_and_node_reject_irrelevant_deadline_approval(self):
        for role in ('ui', 'node'):
            with self.subTest(role=role), tempfile.TemporaryDirectory() as root:
                env = PrivateInstall(Path(root), role)
                env.approve_ui_deadline()
                with env.installed_context(), self.assertRaises(AssertionError):
                    installer.main()
                env.assert_restored(self)
                self.assertFalse(env.commands)
                self.assertFalse(list(env.receipts.iterdir()))

    def test_node_preserves_exact_20_second_unit(self):
        with tempfile.TemporaryDirectory() as root:
            env = PrivateInstall(Path(root), 'node')
            source = 'deploy/proofofwork-retention-protection-node.service'
            unit = env.source / source
            self.assertEqual(installer.digest(unit.read_bytes()),
                '8f9c54b522961e26d8f02ed33ad065af70906f1e95ca2ad65edd322c8f758448')
            blob = unit.read_bytes().replace(b'TimeoutStartSec=20s\n', b'TimeoutStartSec=60s\n')
            unit.write_bytes(blob)
            env.manifest['files'][source]['sha256'] = installer.digest(blob)
            env.write_manifest()
            with env.installed_context(), self.assertRaises(AssertionError):
                installer.main()
            env.assert_restored(self)
            self.assertFalse(env.commands)
            self.assertFalse(list(env.receipts.iterdir()))

    def test_role_scope_is_exactly_checker_and_its_service(self):
        for role in ('ui', 'node'):
            mapping = installer.mapping(role)
            self.assertEqual(set(mapping.values()), {
                '/usr/local/sbin/proofofwork-retention-protection',
                '/etc/systemd/system/proofofwork-retention-protection.service'})
            self.assertEqual(set(mapping), {'scripts/check-retention-protection.py',
                'deploy/proofofwork-retention-protection-' + role + '.service'})

    def test_both_roles_preserve_previous_bytes_and_only_reload(self):
        for role in ('ui', 'node'):
            with self.subTest(role=role), tempfile.TemporaryDirectory() as root:
                env = PrivateInstall(Path(root), role)
                before_hold = env.hold.read_bytes(), installer.identity(env.hold.lstat())
                with env.installed_context():
                    installer.main()
                self.assertEqual(env.commands, [['systemctl', 'daemon-reload']])
                self.assertEqual((env.hold.read_bytes(), installer.identity(env.hold.lstat())), before_hold)
                for destination, blob in env.new.items():
                    target = env.translate(destination)
                    self.assertEqual(target.read_bytes(), blob)
                    self.assertEqual(stat.S_IMODE(target.stat().st_mode), 0o755 if destination.startswith('/usr/local/sbin/') else 0o644)
                intent = json.loads(next(env.receipts.rglob('intent.json')).read_text())
                self.assertFalse(intent['productionDataChanges'])
                for row in intent['previous']:
                    backup = next(env.receipts.rglob(row['backup']))
                    self.assertEqual(backup.read_bytes(), env.before[row['path']][0])
                    self.assertEqual(stat.S_IMODE(backup.stat().st_mode), 0o600)
                completed = json.loads(next(env.receipts.rglob('completed.json')).read_text())
                self.assertTrue(completed['authorityAndHoldUnchanged'])
                self.assertFalse(completed['monitorRunPerformed'])

    def test_bad_pins_and_expanded_scope_refuse_before_install(self):
        for mutation in ('previousHash', 'previousMode', 'newHash', 'holdHash', 'extraFile', 'wrongRole'):
            with self.subTest(mutation=mutation), tempfile.TemporaryDirectory() as root:
                env = PrivateInstall(Path(root))
                first = next(iter(env.manifest['files'].values()))
                if mutation == 'previousHash': first['previousSha256'] = '0' * 64
                elif mutation == 'previousMode': first['previousMode'] = 0o744
                elif mutation == 'newHash': first['sha256'] = '0' * 64
                elif mutation == 'holdHash': env.manifest['holdSha256'] = '0' * 64
                elif mutation == 'extraFile': env.manifest['files']['unapproved.py'] = copy.deepcopy(first)
                elif mutation == 'wrongRole': env.manifest['role'] = 'node'
                env.write_manifest()
                with env.installed_context(), self.assertRaises(AssertionError):
                    installer.main()
                env.assert_restored(self)
                self.assertFalse(list(env.receipts.iterdir()))
                self.assertFalse(env.commands)

    def test_human_approval_or_proposal_bytes_must_match(self):
        for file in ('approval', 'scope'):
            with self.subTest(file=file), tempfile.TemporaryDirectory() as root:
                env = PrivateInstall(Path(root))
                getattr(env, file).write_bytes(b'unapproved different bytes')
                with env.installed_context(), self.assertRaises(AssertionError):
                    installer.main()
                env.assert_restored(self)
                self.assertFalse(list(env.receipts.iterdir()))

    def test_active_monitor_and_unmasked_prune_refuse(self):
        for fault in ('monitor', 'prune'):
            with self.subTest(fault=fault), tempfile.TemporaryDirectory() as root:
                env = PrivateInstall(Path(root))
                def states(names):
                    result = env.states(names)
                    for name, row in result.items():
                        if fault == 'monitor' and name == 'proofofwork-retention-protection.service': row['MainPID'] = '123'
                        if fault == 'prune' and name.endswith('.timer'): row['LoadState'] = 'loaded'
                    return result
                with env.installed_context(), patch.object(installer, 'states', states), self.assertRaises(AssertionError):
                    installer.main()
                env.assert_restored(self)
                self.assertFalse(list(env.receipts.iterdir()))
                self.assertFalse(env.commands)

    def test_rollback_is_armed_before_actual_post_rename_fsync_fault(self):
        with tempfile.TemporaryDirectory() as root:
            env = PrivateInstall(Path(root))
            target = env.translate(next(iter(env.paths.values())))
            actual_replace, actual_fsync = os.replace, os.fsync
            fault = {'renamed': False, 'raised': False}
            def renamed(source, destination):
                actual_replace(source, destination)
                if Path(destination) == target: fault['renamed'] = True
            def fsync(descriptor):
                if fault['renamed'] and not fault['raised'] and Path(os.readlink('/proc/self/fd/' + str(descriptor))) == target.parent:
                    fault['raised'] = True
                    raise OSError('injected post-rename parent fsync failure')
                return actual_fsync(descriptor)
            with env.installed_context(), patch.object(installer.os, 'replace', renamed), \
                 patch.object(installer.os, 'fsync', fsync), self.assertRaisesRegex(OSError, 'post-rename'):
                installer.main()
            self.assertTrue(fault['raised'])
            env.assert_restored(self)
            failure = json.loads(next(env.receipts.rglob('failure.json')).read_text())
            self.assertEqual(failure['installed'], [next(iter(env.paths.values()))])
            self.assertFalse(list(env.receipts.rglob('completed.json')))

    def test_failure_receipt_error_cannot_prevent_rollback(self):
        with tempfile.TemporaryDirectory() as root:
            env = PrivateInstall(Path(root))
            actual_exclusive = installer.exclusive
            first = True
            def run(argv):
                nonlocal first
                env.run(argv)
                if first:
                    first = False
                    raise OSError('injected first daemon reload failure')
                return ''
            def exclusive(path, raw, mode=0o600):
                if Path(path).name == 'failure.json':
                    raise OSError('injected receipt storage full')
                return actual_exclusive(path, raw, mode)
            with env.installed_context(), patch.object(installer, 'run', run), \
                 patch.object(installer, 'exclusive', exclusive), self.assertRaises(OSError):
                installer.main()
            env.assert_restored(self)
            self.assertEqual(env.commands, [['systemctl', 'daemon-reload'], ['systemctl', 'daemon-reload']])

    def test_keyboard_interrupt_after_rename_restores_previous_bytes(self):
        with tempfile.TemporaryDirectory() as root:
            env = PrivateInstall(Path(root))
            target = env.translate(next(iter(env.paths.values())))
            actual_replace = os.replace
            raised = False
            def replaced(source, destination):
                nonlocal raised
                actual_replace(source, destination)
                if Path(destination) == target and not raised:
                    raised = True
                    raise KeyboardInterrupt('private interrupted rename')
            with env.installed_context(), patch.object(installer.os, 'replace', replaced), \
                 self.assertRaises(KeyboardInterrupt):
                installer.main()
            env.assert_restored(self)
            self.assertEqual(env.commands, [['systemctl', 'daemon-reload']])

    def test_sigterm_after_real_rename_uses_rollback(self):
        with tempfile.TemporaryDirectory() as root:
            process = subprocess.run([sys.executable, '-I', '-B', str(Path(__file__).resolve()),
                '--private-signal-fixture', root], capture_output=True, text=True, timeout=15)
            self.assertNotEqual(process.returncode, -signal.SIGTERM,
                'Default SIGTERM terminates Python before its armed rollback executes')
            self.assertNotEqual(process.returncode, 0, 'Interrupted install must not report success')
            fixture_root = Path(root)
            for source, destination in installer.mapping('ui').items():
                target = fixture_root / 'filesystem' / destination.lstrip('/')
                self.assertEqual(target.read_bytes(), ('prior-' + source).encode())
                self.assertEqual(stat.S_IMODE(target.stat().st_mode),
                    0o700 if destination.startswith('/usr/local/sbin/') else 0o600)
            self.assertFalse(list((fixture_root / 'receipts').rglob('completed.json')))

    def test_unhealthy_protected_authority_refuses_before_install(self):
        for pid, active in [('0', 'active'), ('42', 'inactive')]:
            with self.subTest(pid=pid, active=active), tempfile.TemporaryDirectory() as root:
                env = PrivateInstall(Path(root), 'node')
                def states(names):
                    result = env.states(names)
                    for name, row in result.items():
                        if name == 'proofofwork-api.service':
                            row['MainPID'] = pid
                            row['ActiveState'] = active
                    return result
                with env.installed_context(), patch.object(installer, 'states', states), \
                     self.assertRaisesRegex(AssertionError, 'Protected service is unhealthy'):
                    installer.main()
                env.assert_restored(self)
                self.assertFalse(list(env.receipts.iterdir()))
                self.assertFalse(env.commands)

    def test_node_inactive_wal_and_active_backup_are_preserved(self):
        with tempfile.TemporaryDirectory() as root:
            env = PrivateInstall(Path(root), 'node')
            with env.installed_context():
                installer.main()
            intent = json.loads(next(env.receipts.rglob('intent.json')).read_text())
            self.assertEqual(intent['baseline']['pg_receivewal@16-main.service'], {
                'LoadState': 'loaded', 'ActiveState': 'inactive', 'MainPID': '0', 'UnitFileState': 'disabled'})
            self.assertEqual(intent['baseline']['proofofwork-postgres-logical-backup.timer'], {
                'LoadState': 'loaded', 'ActiveState': 'active', 'MainPID': '0', 'UnitFileState': 'enabled'})
            self.assertEqual(env.commands, [['systemctl', 'daemon-reload']])

    def test_node_wal_or_backup_state_drift_rolls_back(self):
        for name in ('pg_receivewal@16-main.service', 'proofofwork-postgres-logical-backup.timer'):
            with self.subTest(name=name), tempfile.TemporaryDirectory() as root:
                env = PrivateInstall(Path(root), 'node')
                reloads = 0
                def run(argv):
                    nonlocal reloads
                    reloads += 1
                    return env.run(argv)
                def states(names):
                    result = env.states(names)
                    if reloads and name in result:
                        result[name]['UnitFileState'] = 'external-drift'
                    return result
                with env.installed_context(), patch.object(installer, 'run', run), \
                     patch.object(installer, 'states', states), self.assertRaisesRegex(AssertionError, 'Authority or prune state changed'):
                    installer.main()
                env.assert_restored(self)
                self.assertEqual(env.commands, [['systemctl', 'daemon-reload'], ['systemctl', 'daemon-reload']])

    def test_hold_or_authority_drift_rolls_back_without_mutating_them(self):
        for fault in ('hold', 'authority'):
            with self.subTest(fault=fault), tempfile.TemporaryDirectory() as root:
                env = PrivateInstall(Path(root))
                reloads = 0
                def run(argv):
                    nonlocal reloads
                    reloads += 1
                    env.run(argv)
                    if fault == 'hold' and reloads == 1: env.hold.write_bytes(b'external hold drift')
                    return ''
                def states(names):
                    result = env.states(names)
                    if fault == 'authority' and reloads:
                        for name, row in result.items():
                            if name == 'caddy.service': row['MainPID'] = '43'
                    return result
                with env.installed_context(), patch.object(installer, 'run', run), \
                     patch.object(installer, 'states', states), self.assertRaises(AssertionError):
                    installer.main()
                env.assert_restored(self)
                self.assertFalse(list(env.receipts.rglob('completed.json')))
                self.assertEqual(env.commands, [['systemctl', 'daemon-reload'], ['systemctl', 'daemon-reload']])
                if fault == 'hold': self.assertEqual(env.hold.read_bytes(), b'external hold drift')

    def test_unknown_destination_bytes_are_not_overwritten_during_recovery(self):
        with tempfile.TemporaryDirectory() as root:
            env = PrivateInstall(Path(root))
            destination = next(iter(env.paths.values()))
            target = env.translate(destination)
            target.write_bytes(b'external unreviewed replacement')
            before = {destination: {'bytes': env.before[destination][0], 'mode': env.before[destination][1]}}
            new = {destination: {'bytes': env.new[destination]}}
            with env.installed_context(), self.assertRaisesRegex(AssertionError, 'Unknown installed bytes'):
                installer.reconcile([destination], before, new, 'private')
            self.assertEqual(target.read_bytes(), b'external unreviewed replacement')


if __name__ == '__main__':
    if len(sys.argv) == 3 and sys.argv[1] == '--private-signal-fixture':
        env = PrivateInstall(Path(sys.argv[2]))
        target = env.translate(next(iter(env.paths.values())))
        actual_replace = os.replace
        raised = False
        def replaced(source, destination):
            global raised
            actual_replace(source, destination)
            if Path(destination) == target and not raised:
                raised = True
                os.kill(os.getpid(), signal.SIGTERM)
        with env.installed_context(), patch.object(installer.os, 'replace', replaced):
            installer.main()
    else:
        unittest.main()
