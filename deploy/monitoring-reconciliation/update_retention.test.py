#!/usr/bin/env python3
"""Synthetic-only updater tests; every mutable path and service call is isolated."""
import contextlib
import copy
import importlib.util
import io
import json
import os
from pathlib import Path
import stat
import tempfile
from types import SimpleNamespace
import unittest
from unittest import mock

spec = importlib.util.spec_from_file_location('update_retention', Path(__file__).with_name('update_retention.py'))
m = importlib.util.module_from_spec(spec)
spec.loader.exec_module(m)


class UpdaterTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.scratch = self.root / 'scratch'
        self.durable = self.root / 'durable'
        self.bin = self.root / 'bin'
        self.policy_dir = self.root / 'policy'
        self.repo = self.root / 'source'
        for directory in (self.scratch, self.durable, self.bin, self.policy_dir, self.repo):
            directory.mkdir(mode=0o700)
        self.target = self.bin / 'checker'
        self.policy = self.policy_dir / 'policy.json'
        self.before = b'# synthetic exact reader\nflags = ' + m.OLD + b'\n'
        self.after = self.before.replace(m.OLD, m.NEW)
        self.write(self.target, self.before, 0o755)
        self.write(self.policy, m.encode({'role': 'node'}))
        self.previous = self.policy_dir / 'checker-before.py'
        self.write(self.previous, b'# preserved historical checker\n')
        self.completion = self.policy_dir / 'retention-completion.json'
        self.write(self.completion, b'{}\n')
        self.units = [self.root / 'checker.service', self.root / 'checker.timer']
        for unit in self.units:
            self.write(unit, b'synthetic unit bytes\n')
        self.archive = self.root / 'runtime-completion.json'
        self.write(self.archive, b'{}\n')
        self.locks = {role: self.root / (role + '.lock') for role in ('node', 'ui')}
        for lock in self.locks.values():
            self.write(lock, b'')
        self.expected_context = {
            m.SERVICE: {'ExecStart': 'exact role=node command', 'PrivateTmp': 'yes'},
            m.TIMER: {'TimersCalendar': '{ OnCalendar=*-*-* *:00/5:00', 'ActiveState': 'active'},
        }
        self.old_status = self.status_value('a' * 32, 10)
        patches = {
            'ROOT': self.scratch, 'EVIDENCE_ROOT': self.durable,
            'TARGET': self.target, 'POLICY': self.policy, 'LOCKS': self.locks,
            'COMMON_PIN_PATHS': {str(p) for p in [self.target, self.policy, self.previous, self.completion, *self.units]},
            'NODE_COMPLETION': str(self.archive),
            'PREVIOUS_CHECKER_SHA': {'node': m.sha(self.previous.read_bytes()), 'ui': m.sha(self.previous.read_bytes())},
            'BEFORE': m.sha(self.before), 'AFTER': m.sha(self.after),
            'POLICY_SHA': m.sha(self.policy.read_bytes()),
        }
        self.stack = contextlib.ExitStack()
        self.addCleanup(self.stack.close)
        for name, value in patches.items():
            self.stack.enter_context(mock.patch.object(m, name, value))
        self.context_mock = self.stack.enter_context(mock.patch.object(m, 'context', return_value=copy.deepcopy(self.expected_context)))
        self.stack.enter_context(mock.patch.object(m, 'settled', return_value=copy.deepcopy(self.old_status)))
        self.stack.enter_context(mock.patch.object(m, 'status', return_value=copy.deepcopy(self.old_status)))
        self.preflight = self.stack.enter_context(mock.patch.object(m, 'candidate_check', return_value={'role': 'node', 'ok': True, 'issues': []}))
        self.service = self.stack.enter_context(mock.patch.object(m, 'service_check', return_value={'startedByUpdater': True, 'result': {'role': 'node', 'ok': True, 'issues': []}}))
        # An accidentally unmocked command must fail before invoking a live service.
        self.stack.enter_context(mock.patch.object(m, 'command', side_effect=AssertionError('Unmocked external command is forbidden')))
        self.plan = self.make_plan()

    def write(self, path, raw, mode=0o600):
        path.write_bytes(raw)
        path.chmod(mode)

    def pin(self, path):
        return {'sha256': m.sha(path.read_bytes()), 'identity': list(m.identity(path.lstat()))}

    def make_plan(self):
        paths = set(m.COMMON_PIN_PATHS) | {m.NODE_COMPLETION}
        return {'schema': 'pow-retention-atime-update-v1', 'role': 'node',
                'sourceRepository': str(self.repo), 'sourceCommit': '1' * 40,
                'sourceTree': '2' * 40, 'beforeSha256': m.BEFORE,
                'afterSha256': m.AFTER, 'policySha256': m.POLICY_SHA,
                'pins': {p: self.pin(Path(p)) for p in paths},
                'unitContext': copy.deepcopy(self.expected_context)}

    def apply(self, plan=None, candidate=None, label='20261025T170000Z'):
        with contextlib.redirect_stdout(io.StringIO()):
            return m.apply(plan or self.plan, self.after if candidate is None else candidate,
                           label, m.sha(m.encode(plan or self.plan)))

    def receipts(self):
        return list(self.durable.glob('attempt-*/result.json'))

    def result(self):
        paths = self.receipts()
        self.assertEqual(len(paths), 1)
        return json.loads(paths[0].read_bytes())

    @staticmethod
    def status_value(invocation, started):
        return {'InvocationID': invocation, 'ActiveState': 'inactive', 'SubState': 'dead',
                'MainPID': '0', 'Result': 'success', 'ExecMainCode': '1',
                'ExecMainStatus': '0', 'ExecMainStartTimestampMonotonic': str(started)}

    def test_success_preserves_metadata_and_durable_intent(self):
        before = self.target.stat()
        result = self.apply()
        self.assertEqual(self.target.read_bytes(), self.after)
        after = self.target.stat()
        self.assertEqual((after.st_uid, after.st_gid, stat.S_IMODE(after.st_mode)),
                         (before.st_uid, before.st_gid, stat.S_IMODE(before.st_mode)))
        self.assertEqual(result['phase'], 'complete')
        receipt = self.receipts()[0]
        self.assertTrue(receipt.is_relative_to(self.durable))
        self.assertFalse(list(self.scratch.glob('attempt-*')))
        self.assertEqual((receipt.parent / 'checker-before.py').read_bytes(), self.before)
        intent = json.loads((receipt.parent / 'intent.json').read_bytes())
        self.assertEqual(intent['sourceCommit'], self.plan['sourceCommit'])
        self.assertEqual(intent['planSha256'], m.sha(m.encode(self.plan)))
        self.assertEqual(m.sha(self.policy.read_bytes()), self.plan['policySha256'])
        self.preflight.assert_called_once()
        self.service.assert_called_once()

    def test_unsealed_commit_and_unknown_role_refused(self):
        for key, value in [('sourceCommit', None), ('sourceTree', None), ('role', 'other')]:
            with self.subTest(key=key):
                plan = copy.deepcopy(self.plan); plan[key] = value
                with self.assertRaises(ValueError): self.apply(plan)
        self.assertEqual(self.target.read_bytes(), self.before)
        self.assertEqual(self.receipts(), [])

    def test_wrong_role_scope_and_exact_pins_refused(self):
        for change in ('role', 'before', 'after', 'policy'):
            with self.subTest(change=change):
                plan = copy.deepcopy(self.plan)
                if change == 'role': plan['role'] = 'ui'
                else: plan[change + 'Sha256'] = '0' * 64
                with self.assertRaises(ValueError): self.apply(plan)
        self.assertEqual(self.target.read_bytes(), self.before)

    def test_same_bytes_new_inode_refused(self):
        replacement = self.bin / 'foreign'
        self.write(replacement, self.before, 0o755)
        os.replace(replacement, self.target)
        with self.assertRaisesRegex(ValueError, 'identity drift'): self.apply()
        self.assertEqual(self.target.read_bytes(), self.before)
        self.service.assert_not_called()

    def test_old_content_and_policy_drift_refused(self):
        self.write(self.target, self.before + b'# drift\n', 0o755)
        with self.assertRaises(ValueError): self.apply()
        self.write(self.target, self.before, 0o755)
        self.plan = self.make_plan()
        self.write(self.policy, m.encode({'role': 'node', 'changed': True}))
        with self.assertRaises(ValueError): self.apply()
        self.assertEqual(self.target.read_bytes(), self.before)
        self.service.assert_not_called()

    def test_wrong_owner_or_unsafe_mode_refused(self):
        os.chown(self.target, 1000, 1000)
        with self.assertRaisesRegex(ValueError, 'Unsafe input'): self.apply()
        os.chown(self.target, 0, 0)
        self.target.chmod(0o777)
        with self.assertRaisesRegex(ValueError, 'Unsafe input'): self.apply()
        self.service.assert_not_called()

    def test_policy_role_mismatch_refused(self):
        self.write(self.policy, m.encode({'role': 'ui'}))
        self.plan['policySha256'] = m.sha(self.policy.read_bytes())
        self.plan['pins'][str(self.policy)] = self.pin(self.policy)
        with mock.patch.object(m, 'POLICY_SHA', self.plan['policySha256']):
            with self.assertRaisesRegex(ValueError, 'Policy role differs'): self.apply()
        self.assertEqual(self.target.read_bytes(), self.before)

    def test_candidate_preflight_failure_does_not_install(self):
        self.preflight.side_effect = ValueError('Candidate result is not green')
        with self.assertRaises(ValueError): self.apply()
        self.assertEqual(self.target.read_bytes(), self.before)
        self.service.assert_not_called()

    def test_unit_context_drift_before_install_refused(self):
        changed = copy.deepcopy(self.expected_context); changed[m.SERVICE]['PrivateTmp'] = 'no'
        self.context_mock.return_value = changed
        with self.assertRaisesRegex(ValueError, 'configuration changed'): self.apply()
        self.assertEqual(self.target.read_bytes(), self.before)
        self.service.assert_not_called()

    def test_unit_context_drift_after_install_rolls_back(self):
        changed = copy.deepcopy(self.expected_context); changed[m.TIMER]['TimersCalendar'] = '{ OnCalendar=daily'
        self.context_mock.side_effect = lambda role: changed if self.target.read_bytes() == self.after else copy.deepcopy(self.expected_context)
        with self.assertRaisesRegex(ValueError, 'configuration changed'): self.apply()
        self.assertEqual(self.target.read_bytes(), self.before)
        self.assertTrue(self.result()['rolledBack'])

    def test_non_green_service_rolls_back_owned_candidate(self):
        self.service.side_effect = ValueError('Actual service result is unsuccessful')
        with self.assertRaises(ValueError): self.apply()
        self.assertEqual(self.target.read_bytes(), self.before)
        self.assertTrue(self.result()['rolledBack'])
        self.assertEqual(stat.S_IMODE(self.target.stat().st_mode), 0o755)

    def test_foreign_replacement_is_preserved(self):
        foreign = b'# replacement from another actor\n'
        def replace(*args):
            path = self.bin / 'external'; self.write(path, foreign, 0o755)
            os.replace(path, self.target)
            raise ValueError('Service failed after another actor replaced checker')
        self.service.side_effect = replace
        with self.assertRaises(ValueError): self.apply()
        self.assertEqual(self.target.read_bytes(), foreign)
        self.assertTrue(self.result()['recoveryIncomplete'])
        self.assertNotIn('restoredSha256', self.result())

    def test_failure_immediately_after_rename_rolls_back(self):
        original = m.sync
        triggered = []
        def fail_once(path):
            if path == self.bin and self.target.read_bytes() == self.after and not triggered:
                triggered.append(True)
                raise OSError('Synthetic fsync failure after atomic rename')
            return original(path)
        with mock.patch.object(m, 'sync', side_effect=fail_once):
            with self.assertRaises(OSError): self.apply()
        self.assertEqual(triggered, [True])
        self.assertEqual(self.target.read_bytes(), self.before)
        self.assertTrue(self.result()['rolledBack'])

    def test_attempt_is_exclusive_no_retry_after_completion(self):
        self.apply()
        with self.assertRaises(ValueError):
            self.apply(label='20261025T170001Z')
        self.assertEqual(len(self.receipts()), 1)
        self.service.assert_called_once()


    def test_nanosecond_plan_roundtrip_and_one_ns_drift_refused(self):
        path = self.scratch / 'update-plan.json'
        raw = m.encode(self.plan)
        self.write(path, raw)
        loaded = json.loads(m.read(path), object_pairs_hook=m.unique)
        self.assertEqual(loaded, self.plan)
        self.assertEqual(m.encode(loaded), raw)
        stamp = loaded['pins'][str(self.target)]['identity'][7]
        self.assertIsInstance(stamp, int)
        self.assertGreater(stamp, 2**53)
        loaded['pins'][str(self.target)]['identity'][7] = stamp + 1
        with self.assertRaisesRegex(ValueError, 'identity drift'):
            self.apply(loaded)
        self.assertEqual(self.target.read_bytes(), self.before)
        self.preflight.assert_not_called()

    def test_failed_preflight_attempt_is_durable_and_cannot_retry(self):
        self.preflight.side_effect = ValueError('Synthetic candidate refusal')
        with self.assertRaisesRegex(ValueError, 'Synthetic candidate refusal'):
            self.apply()
        receipt = self.result()
        self.assertEqual(receipt['phase'], 'failed')
        self.assertFalse(receipt['rolledBack'])
        self.assertEqual(receipt['installTransaction'], {})
        self.preflight.side_effect = None
        with self.assertRaisesRegex(ValueError, 'Earlier attempt exists'):
            self.apply(label='20261025T170001Z')
        self.preflight.assert_called_once()
        self.service.assert_not_called()
        self.assertEqual(self.target.read_bytes(), self.before)

    def test_policy_drift_during_memory_preflight_is_refenced(self):
        def drift(*args):
            self.write(self.policy, m.encode({'role': 'node', 'changed': True}))
            return {'role': 'node', 'ok': True, 'issues': []}
        self.preflight.side_effect = drift
        with self.assertRaisesRegex(ValueError, 'identity drift'):
            self.apply()
        self.assertEqual(self.target.read_bytes(), self.before)
        self.assertFalse(self.result()['rolledBack'])
        self.service.assert_not_called()

    def test_owned_temp_is_removed_on_pre_rename_failure(self):
        original = m.os.fsync
        def fail_temp(fd):
            if Path('/proc/self/fd/' + str(fd)).resolve().name.startswith('.checker.atime-'):
                raise OSError('Synthetic temporary fsync failure')
            return original(fd)
        with mock.patch.object(m.os, 'fsync', side_effect=fail_temp):
            with self.assertRaisesRegex(OSError, 'temporary fsync failure'):
                self.apply()
        self.assertEqual(self.target.read_bytes(), self.before)
        self.assertEqual(list(self.bin.glob('.checker.*')), [])
        self.assertEqual(self.result()['installTransaction']['temporaryCleanup'], 'removed-owned')
        self.service.assert_not_called()

    def test_supported_ui_role_has_its_own_exact_pin_set(self):
        self.write(self.policy, m.encode({'role': 'ui'}))
        plan = copy.deepcopy(self.plan)
        plan['role'] = 'ui'
        plan['policySha256'] = m.sha(self.policy.read_bytes())
        plan['pins'][str(self.policy)] = self.pin(self.policy)
        del plan['pins'][str(self.archive)]
        result = self.apply(plan)
        self.assertEqual(result['role'], 'ui')
        self.assertEqual(result['phase'], 'complete')
        self.preflight.assert_called_once_with(self.after, 'ui')
        self.assertEqual(self.service.call_args.args[2], 'ui')


class CandidateAndSourceTests(unittest.TestCase):
    def test_memory_preflight_receives_exact_bytes_and_requested_role(self):
        candidate = b'# tiny synthetic candidate, never executed\n'
        output = m.encode({'role': 'ui', 'ok': True, 'issues': []})
        result = SimpleNamespace(returncode=0, stdout=output, stderr=b'')
        with mock.patch.object(m, 'command', return_value=result) as command:
            proof = m.candidate_check(candidate, 'ui')
        command.assert_called_once_with(['/usr/bin/python3', '-I', '-B', '-', '--role=ui'], 30, input=candidate)
        self.assertEqual(proof['sha256'], m.sha(candidate))
        self.assertEqual(proof['stdoutSha256'], m.sha(output))

    def test_memory_preflight_rejects_failure_wrong_role_and_ambiguous_json(self):
        cases = [SimpleNamespace(returncode=1, stdout=b'{}', stderr=b'failure'),
                 SimpleNamespace(returncode=0, stdout=m.encode({'role': 'ui', 'ok': True, 'issues': []}), stderr=b''),
                 SimpleNamespace(returncode=0, stdout=m.encode({'role': 'node', 'ok': False, 'issues': ['real failure']}), stderr=b''),
                 SimpleNamespace(returncode=0, stdout=b'{"role":"node","ok":false,"ok":true,"issues":[]}', stderr=b'')]
        for result in cases:
            with self.subTest(stdout=result.stdout), mock.patch.object(m, 'command', return_value=result):
                with self.assertRaises(ValueError): m.candidate_check(b'candidate', 'node')
        with mock.patch.object(m, 'command') as command:
            with self.assertRaises(ValueError): m.candidate_check(b'candidate', 'other')
            command.assert_not_called()

    def source_fixture(self, overrides=None):
        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        repo = Path(temporary.name)
        baseline = b'import os\nEXPECTED_POLICY_SHA256 = None\nflags = ' + m.OLD + b'\n'
        canonical = baseline.replace(m.OLD, m.NEW)
        policy = '3' * 64
        needle = b'EXPECTED_POLICY_SHA256 = None'
        binding = ('EXPECTED_POLICY_SHA256 = ' + repr(policy)).encode()
        plan = {'sourceRepository': str(repo), 'sourceCommit': '1' * 40,
                'sourceTree': '2' * 40, 'policySha256': policy,
                'beforeSha256': m.sha(baseline.replace(needle, binding)),
                'afterSha256': m.sha(canonical.replace(needle, binding))}
        responses = {'commit': (plan['sourceCommit'] + '\n').encode(),
                     'tree': (plan['sourceTree'] + '\n').encode(),
                     'canonical': canonical, 'baseline': baseline}
        responses.update(overrides or {})
        def checked(args, timeout=30):
            if 'rev-parse' in args:
                return responses['tree' if args[-1].endswith('^{tree}') else 'commit']
            if 'merge-base' in args: return b''
            if 'show' in args:
                return responses['baseline' if args[-1].startswith(m.SOURCE_BASE + ':') else 'canonical']
            raise AssertionError('Unexpected external command')
        stack = contextlib.ExitStack()
        self.addCleanup(stack.close)
        stack.enter_context(mock.patch.object(m, 'BASE_CANONICAL', m.sha(baseline)))
        stack.enter_context(mock.patch.object(m, 'CANONICAL', m.sha(canonical)))
        stack.enter_context(mock.patch.object(m, 'checked', side_effect=checked))
        stack.enter_context(mock.patch.object(m, 'command', side_effect=AssertionError('No external command permitted')))
        return plan, canonical.replace(needle, binding), responses

    def test_committed_source_tree_and_exact_one_flag_binding(self):
        plan, installed, _ = self.source_fixture()
        self.assertEqual(m.source(plan), installed)
        self.assertIn(m.NEW, installed)
        self.assertNotIn(b'EXPECTED_POLICY_SHA256 = None', installed)

    def test_committed_source_rejects_wrong_commit_tree_source_and_binding(self):
        plan, installed, responses = self.source_fixture()
        originals = dict(responses)
        for key, wrong in [('commit', b'4' * 40 + b'\n'), ('tree', b'5' * 40 + b'\n'),
                           ('canonical', originals['canonical'] + b'# unrelated edit\n'),
                           ('baseline', originals['baseline'] + b'# wrong predecessor\n')]:
            with self.subTest(key=key):
                responses[key] = wrong
                with self.assertRaises(ValueError): m.source(plan)
                responses[key] = originals[key]
        for key in ('beforeSha256', 'afterSha256'):
            changed = dict(plan); changed[key] = '0' * 64
            with self.subTest(key=key), self.assertRaises(ValueError): m.source(changed)

    def test_even_hash_pinned_unrelated_canonical_edit_is_refused(self):
        plan, installed, responses = self.source_fixture()
        responses['canonical'] += b'# unrelated edit\n'
        with mock.patch.object(m, 'CANONICAL', m.sha(responses['canonical'])):
            with self.assertRaisesRegex(ValueError, 'one-flag correction'): m.source(plan)


class ServiceEvidenceTests(unittest.TestCase):
    def setUp(self):
        self.old = UpdaterTests.status_value('a' * 32, 10)
        self.new = UpdaterTests.status_value('b' * 32, 150)
        self.green = {'role': 'node', 'ok': True, 'issues': []}

    def journal(self, *rows):
        return b''.join((json.dumps({'MESSAGE': json.dumps(row)}) + '\n').encode() for row in rows)

    def test_one_actual_wrapper_start_requires_fresh_invocation_and_green_json(self):
        with mock.patch.object(m, 'settled', side_effect=[self.old, self.new]), \
             mock.patch.object(m, 'command', return_value=SimpleNamespace(returncode=0)) as command, \
             mock.patch.object(m, 'checked', return_value=self.journal(self.green)) as checked:
            value = m.service_check(100, self.old['InvocationID'], 'node')
        self.assertTrue(value['startedByUpdater'])
        command.assert_called_once_with(['/usr/bin/systemctl', 'start', m.SERVICE], 30)
        self.assertIn('_SYSTEMD_INVOCATION_ID=' + self.new['InvocationID'], checked.call_args.args[0])

    def test_already_fresh_timer_invocation_avoids_duplicate_start(self):
        with mock.patch.object(m, 'settled', return_value=self.new), \
             mock.patch.object(m, 'command') as command, \
             mock.patch.object(m, 'checked', return_value=self.journal(self.green)):
            value = m.service_check(100, self.old['InvocationID'], 'node')
        command.assert_not_called()
        self.assertFalse(value['startedByUpdater'])

    def test_stale_id_or_start_time_cannot_certify_install(self):
        for stale in (self.old, {**self.new, 'ExecMainStartTimestampMonotonic': '99'}):
            with self.subTest(stale=stale['InvocationID']), \
                 mock.patch.object(m, 'settled', return_value=stale), \
                 mock.patch.object(m, 'command', return_value=SimpleNamespace(returncode=0)), \
                 mock.patch.object(m, 'checked') as checked:
                with self.assertRaisesRegex(ValueError, 'failed or stale'):
                    m.service_check(100, self.old['InvocationID'], 'node')
                checked.assert_not_called()

    def test_failed_unit_or_non_green_wrong_role_duplicate_result_refused(self):
        failed = {**self.new, 'Result': 'exit-code', 'ExecMainStatus': '1'}
        with mock.patch.object(m, 'settled', return_value=failed):
            with self.assertRaises(ValueError): m.service_check(100, self.old['InvocationID'], 'node')
        for rows in ([{'role': 'node', 'ok': False, 'issues': ['real-failure']}],
                     [{'role': 'ui', 'ok': True, 'issues': []}],
                     [self.green, self.green], []):
            with self.subTest(rows=len(rows)), \
                 mock.patch.object(m, 'settled', return_value=self.new), \
                 mock.patch.object(m, 'checked', return_value=self.journal(*rows)):
                with self.assertRaises(ValueError): m.service_check(100, self.old['InvocationID'], 'node')

    def test_calendar_changes_remain_bound_only_next_time_is_ignored(self):
        first = '{ OnCalendar=*-*-* *:00/5:00 ; next_elapse=Sun 2026-10-25 16:55:00 UTC }'
        later = first.replace('16:55:00', '17:00:00')
        changed = first.replace('*:00/5:00', '*:00/10:00')
        self.assertEqual(m.normalize_calendar(first), m.normalize_calendar(later))
        self.assertNotEqual(m.normalize_calendar(first), m.normalize_calendar(changed))
        with self.assertRaises(ValueError): m.normalize_calendar('unexpected alternate calendar syntax')


if __name__ == '__main__':
    unittest.main()
