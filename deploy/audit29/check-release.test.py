#!/usr/bin/python3 -I
"""Private fixtures only: no production commands, services, archives or paths."""
import datetime as dt
import hashlib
import importlib.util
from pathlib import Path
import signal
import tempfile
import time
import sys
from types import SimpleNamespace
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location('audit29_release', Path(__file__).with_name('release.py'))
release = importlib.util.module_from_spec(spec)
spec.loader.exec_module(release)
C, T, H, OLD, NEW = 'a' * 40, 'b' * 40, 'c' * 64, [1, 2], [1, 3]


def proof():
    return {'ok': True, 'mode': 'shadow', 'network': 'livenet', 'completedAt': '2026-10-01T06:00:00Z',
            'base': 'http://127.0.0.1:18081', 'authority': 'http://127.0.0.1:18081',
            'candidate': {'commit': C, 'tree': T, 'runtimeSha256': H},
            'gates': {'ids': True, 'events': True, 'parity': True},
            'stableCheckpoint': {'height': 969395, 'hash': 'd' * 64}}


class FixtureController(release.Controller):
    def __init__(self, mode='node', position='exchanged'):
        args = SimpleNamespace(command=mode, release_id=C[:12] + '-20261001T060000Z', commit=C,
                               old_manifest_sha256='e' * 64, old_tree_sha256='f' * 64)
        super().__init__(args)
        self.position, self.receipts, self.operations = position, [], []
        self.current = {'live': OLD if position == 'unchanged' else NEW,
                        'stage': NEW if position == 'unchanged' else OLD}
        if position == 'uncertain':
            self.current['live'] = [1, 99]

    def setup(self):
        pass

    def node(self):
        self.old_identity, self.new_identity = OLD, NEW
        self.old_att, self.new_att = ['old'], ['new']
        self.before = {'timers': {}, 'authorities': {}, 'holds': {}, 'apps': {}}
        self.phase = 'exchange-uncertain'
        raise RuntimeError('Injected exchange helper failure after syscall')

    ui = node

    def save(self, name, value):
        self.receipts.append((name, value))

    def attest(self, root):
        return self.old_att if self.current['live' if str(root) == '/opt/proofofwork-api' else 'stage'] == OLD else self.new_att

    def run(self, argv, *args, **kwargs):
        self.operations.append(argv)
        if argv[0] == self.helpers.get('exchange'):
            self.current['live'], self.current['stage'] = self.current['stage'], self.current['live']
            return 'status=exchanged'
        return ''

    def state(self, unit):
        return {'ActiveState': 'inactive', 'MainPID': '0'}

    def fingerprint(self, root):
        return {'manifestSha256': self.args.old_manifest_sha256, 'treeSha256': self.args.old_tree_sha256}

    def unchanged_authority_and_holds(self):
        pass

    def rebind_helpers(self):
        pass

    def drain(self, roots):
        pass

    def start_apps(self):
        self.operations.append(['restore-old-apps'])

    def restore_timers(self):
        self.operations.append(['restore-prior-timers'])


class ReleaseContracts(unittest.TestCase):
    def tearDown(self):
        signal.alarm(0)

    def test_acceptance_requires_every_gate_identity_runtime_and_fence(self):
        current = dt.datetime(2026, 10, 1, 6, 1, tzinfo=dt.timezone.utc)
        release.acceptance(proof(), C, T, H, current)
        for mutate in (lambda p: p['gates'].update(parity=False),
                       lambda p: p.update(authority='http://127.0.0.1:8081'),
                       lambda p: p.update(mode='production'),
                       lambda p: p['candidate'].update(commit='9' * 40),
                       lambda p: p['candidate'].update(runtimeSha256='9' * 64),
                       lambda p: p['stableCheckpoint'].update(hash=''),
                       lambda p: p.update(completedAt='2026-10-01T05:00:00Z'),
                       lambda p: p.update(completedAt='2026-10-01T07:00:00Z')):
            value = proof(); mutate(value)
            with self.assertRaises(RuntimeError):
                release.acceptance(value, C, T, H, current)

    def test_exact_classification_never_omits_duplicates_or_adds_roots(self):
        root = str(release.ROLLBACKS / 'proofofwork-www-pre-fixture')
        row = {'root': root, 'classification': 'retain', 'manifestSha256': H, 'treeSha256': H}
        self.assertEqual(list(release.classifications([row], [root])), [root])
        for records, existing in (([], [root]), ([row], []), ([row, row], [root]),
                                  ([{**row, 'classification': 'remove'}], [root])):
            with self.assertRaises(RuntimeError):
                release.classifications(records, existing)

    def test_active_oneshot_with_zero_pid_still_refuses(self):
        for active, pid in (('activating', '0'), ('active', '77'), ('deactivating', '0')):
            with self.assertRaises(RuntimeError):
                release.quiet({'backup': {'ActiveState': active, 'MainPID': pid}})
        release.quiet({'backup': {'ActiveState': 'inactive', 'MainPID': '0'}})

    def test_inactive_disabled_wal_is_preserved_while_core_is_required_active(self):
        authorities = {u: {'LoadState': 'loaded', 'ActiveState': 'active', 'SubState': 'running',
                          'UnitFileState': 'enabled', 'MainPID': '111', 'NRestarts': '0',
                          'ExecMainStartTimestamp': 'unchanged'} for u in release.KEEP}
        authorities['pg_receivewal@16-main.service'].update(ActiveState='inactive', SubState='dead',
                                                          UnitFileState='disabled', MainPID='0')
        release.authority_baseline(authorities)
        fixture = release.Controller(SimpleNamespace(command='node', release_id=C[:12] + '-20261001T060000Z'))
        fixture.before = {'authorities': authorities, 'holds': {}}
        fixture.holds = lambda: {}
        fixture.state = lambda unit: authorities[unit].copy()
        fixture.unchanged_authority_and_holds()
        for unit in release.REQUIRED_AUTHORITY:
            bad = {**authorities, unit: {**authorities[unit], 'ActiveState': 'failed'}}
            with self.assertRaisesRegex(RuntimeError, 'Authority service'):
                release.authority_baseline(bad)

    def test_wal_state_or_configuration_change_still_refuses(self):
        old = {'LoadState': 'loaded', 'ActiveState': 'inactive', 'SubState': 'dead',
               'UnitFileState': 'disabled', 'MainPID': '0', 'NRestarts': '0', 'ExecMainStartTimestamp': ''}
        fixture = release.Controller(SimpleNamespace(command='node', release_id=C[:12] + '-20261001T060000Z'))
        fixture.before = {'authorities': {'pg_receivewal@16-main.service': old}, 'holds': {}}
        fixture.holds = lambda: {}
        for field, value in [('ActiveState', 'active'), ('SubState', 'running'),
                             ('UnitFileState', 'enabled'), ('MainPID', '123')]:
            fixture.state = lambda unit: {**old, field: value}
            with self.assertRaisesRegex(RuntimeError, 'Authority service identity'):
                fixture.unchanged_authority_and_holds()

    def test_timer_restoration_preserves_masked_and_inactive_states(self):
        before = {'held': {'ActiveState': 'inactive', 'UnitFileState': 'masked'},
                  'enabled': {'ActiveState': 'active', 'UnitFileState': 'enabled'}}
        release.timer_restore(before, before)
        for field, value in (('ActiveState', 'active'), ('UnitFileState', 'enabled')):
            changed = {**before, 'held': {**before['held'], field: value}}
            with self.assertRaises(RuntimeError):
                release.timer_restore(before, changed)

    def test_hash_reader_binds_mutation_clocks_but_allows_atime(self):
        with tempfile.TemporaryDirectory() as root:
            file = Path(root) / 'evidence'; file.write_bytes(b'private fixture')
            digest = hashlib.sha256(file.read_bytes()).hexdigest()
            with patch.object(release, 'safe_path', lambda p: Path(p).lstat()):
                self.assertEqual(release.bound_file(file, digest, text=True), b'private fixture')
                with self.assertRaises(RuntimeError):
                    release.bound_file(file, '0' * 64)

    def test_five_field_attestation_and_duplicate_provenance_refuse(self):
        self.assertEqual(release.attestation(f'{C}\t{T}\t10\t100\t{H}')[4], H)
        for value in (f'{C} {T} 0 100 {H}', f'{C} {T} 10 100 {H} extra'):
            with self.assertRaises(RuntimeError):
                release.attestation(value)
        with self.assertRaises(RuntimeError):
            release.parse_lines('commit=a\ncommit=b\n')

    def test_node_post_syscall_failure_recovers_bound_old_pair(self):
        fixture = FixtureController(position='exchanged')
        with patch.object(release, 'identity', lambda path: fixture.current['live' if str(path) == '/opt/proofofwork-api' else 'stage']):
            with self.assertRaises(RuntimeError):
                fixture.execute()
        self.assertEqual(fixture.phase, 'rolled-back')
        self.assertEqual(fixture.current['live'], OLD)
        self.assertEqual(fixture.current['stage'], NEW)
        self.assertIn(['restore-old-apps'], fixture.operations)
        self.assertIn(['restore-prior-timers'], fixture.operations)
        self.assertTrue(any(name == 'rollback' for name, _ in fixture.receipts))
        self.assertTrue(any(name == 'failure' for name, _ in fixture.receipts))

    def test_exhausted_normal_budget_has_separate_bounded_recovery(self):
        fixture = FixtureController(position='exchanged')
        fixture.deadline = time.monotonic() - 1
        def bounded(argv, *args, **kwargs):
            self.assertGreater(fixture.deadline, time.monotonic())
            self.assertLessEqual(fixture.deadline, fixture.hard_deadline)
            return FixtureController.run(fixture, argv, *args, **kwargs)
        fixture.run = bounded
        with patch.object(release, 'identity', lambda path: fixture.current['live' if str(path) == '/opt/proofofwork-api' else 'stage']):
            with self.assertRaises(RuntimeError):
                fixture.execute()
        self.assertEqual(fixture.phase, 'rolled-back')
        self.assertEqual(fixture.current['live'], OLD)
        self.assertIn(['restore-old-apps'], fixture.operations)
        self.assertIn(['restore-prior-timers'], fixture.operations)

    def test_timeout_kills_private_child_process_group(self):
        with tempfile.TemporaryDirectory() as root:
            fixture = release.Controller(SimpleNamespace(command='node', release_id=C[:12] + '-20261001T060000Z'))
            fixture.out = Path(root)
            marker = Path(root) / 'late-child-write'
            code = ("import os,time,pathlib; child=os.fork(); "
                    "time.sleep(0.5 if child==0 else 10); "
                    "pathlib.Path(" + repr(str(marker)) + ").write_text('unexpected') if child==0 else None")
            with self.assertRaisesRegex(RuntimeError, 'timed out'):
                fixture.run([sys.executable, '-I', '-c', code], 0.1)
            time.sleep(0.6)
            self.assertFalse(marker.exists(), 'timed-out child must not keep writing')

    def test_unknown_exchange_never_restarts_or_restores_timers(self):
        fixture = FixtureController(position='uncertain')
        with patch.object(release, 'identity', lambda path: fixture.current['live' if str(path) == '/opt/proofofwork-api' else 'stage']):
            with self.assertRaises(RuntimeError):
                fixture.execute()
        self.assertEqual(fixture.phase, 'inspection-required')
        self.assertNotIn(['restore-old-apps'], fixture.operations)
        self.assertNotIn(['restore-prior-timers'], fixture.operations)
        self.assertFalse(any(op[0] == fixture.helpers['exchange'] for op in fixture.operations))

    def test_ui_publisher_rollback_verified_then_prior_timers_restored(self):
        fixture = FixtureController(mode='ui', position='unchanged')
        with patch.object(release, 'identity', lambda path: OLD):
            with self.assertRaises(RuntimeError):
                fixture.execute()
        self.assertEqual(fixture.phase, 'rolled-back')
        self.assertIn(['restore-prior-timers'], fixture.operations)
        self.assertTrue(any(name == 'publisher-rollback-observed' and value['oldLiveRestoredAndVerified']
                            for name, value in fixture.receipts))

    def test_ui_unproven_rollback_retains_hold_without_second_exchange(self):
        fixture = FixtureController(mode='ui')
        with patch.object(release, 'identity', lambda path: NEW):
            with self.assertRaises(RuntimeError):
                fixture.execute()
        self.assertEqual(fixture.phase, 'inspection-required')
        self.assertNotIn(['restore-prior-timers'], fixture.operations)
        self.assertEqual(fixture.operations, [])


if __name__ == '__main__':
    unittest.main()
