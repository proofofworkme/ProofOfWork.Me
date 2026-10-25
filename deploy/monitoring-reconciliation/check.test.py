#!/usr/bin/env python3
import copy
import contextlib
import importlib.util
import os
from pathlib import Path
import tempfile
import unittest
from unittest import mock
spec = importlib.util.spec_from_file_location('retention', Path(__file__).with_name('retention.py'))
m = importlib.util.module_from_spec(spec)
spec.loader.exec_module(m)


def baseline(role):
    total, retired, relocated = m.COUNTERS[role]
    historical = {'ok': False, 'heldPaths': total, 'approvedRetiredHeldPaths': retired,
                  'approvedRelocatedHeldPaths': relocated, 'mustRemainPresent': total-retired,
                  'mustRemainAtOriginalPath': total-retired-relocated, 'approvedRelocations': {},
                  'unexpectedRelocatedOriginalPathsPresent': [], 'unexpectedRetiredPathsPresent': [],
                  'missingHeldPaths': m.TARGETS[role].copy()}
    historical['approvedNodeDumpRetirement' if role == 'node' else 'approvedRelocationEvidence'] = {'ok': True}
    return {'role': role, 'ok': False, 'issues': [m.ISSUE], 'historicalHeldInventory': historical,
            'logicalBackupRetention': {'ok': True}}


class Tests(unittest.TestCase):
    def test_exact_only(self):
        for role in m.TARGETS:
            result = m.reconcile(baseline(role), role, lambda _: False)
            self.assertTrue(result['ok'])
            self.assertEqual(result['historicalHeldInventory']['heldPaths'], m.COUNTERS[role][0])
            self.assertEqual(result['historicalHeldInventory']['missingHeldPaths'], [])
    def test_unknown_missing_preserved(self):
        value = baseline('node')
        value['historicalHeldInventory']['missingHeldPaths'].append('/data/new-missing-evidence')
        value = m.reconcile(value, 'node', lambda _: False)
        self.assertFalse(value['ok'])
        self.assertEqual(value['historicalHeldInventory']['missingHeldPaths'], ['/data/new-missing-evidence'])
    def test_unrelated_failure_preserved(self):
        value = baseline('node'); value['issues'].append('logical-backup-retention-invalid')
        self.assertEqual(m.reconcile(value, 'node', lambda _: False)['issues'], ['logical-backup-retention-invalid'])
    def test_reappearance_is_failure(self):
        value = baseline('ui'); target = m.TARGETS['ui'][0]
        value['historicalHeldInventory']['missingHeldPaths'].remove(target)
        value = m.reconcile(value, 'ui', lambda p: p == target)
        self.assertFalse(value['ok']); self.assertIn(target, value['historicalHeldInventory']['unexpectedRetiredPathsPresent'])
    def test_new_schema_or_changed_counts_refused(self):
        for key, value in [('unknown', True), ('heldPaths', 520)]:
            result = baseline('node'); result['historicalHeldInventory'][key] = value
            with self.assertRaises(ValueError): m.reconcile(result, 'node', lambda _: False)
    def test_unexplained_failure_refused(self):
        result = baseline('node'); result['historicalHeldInventory']['missingHeldPaths'] = []
        with self.assertRaises(ValueError): m.reconcile(result, 'node', lambda _: False)
    def test_relocation_failure_preserved(self):
        result = baseline('ui'); result['historicalHeldInventory']['approvedRelocationEvidence'] = {'ok': False}
        self.assertFalse(m.reconcile(result, 'ui', lambda _: False)['ok'])
    def test_prior_retired_resurrection_preserved(self):
        result = baseline('node'); result['historicalHeldInventory']['unexpectedRetiredPathsPresent'] = ['/data/old-retired']
        self.assertFalse(m.reconcile(result, 'node', lambda _: False)['ok'])
    def test_policy_requires_exact_authorized_inventory(self):
        role = 'ui'
        review = {'retain': [{'path': path, 'role': role} for path in m.TARGETS[role]]}
        policy = {'schema': 'pow-historical-requirement-retirement-v1', 'role': role,
                  'authorization': '2026-10-24 user-approved outdated-monitoring reconciliation; keep current runtime, rollback and newest VPS backup',
                  'qualifiedAt': '2026-10-24', 'previousCheckerSha256': m.PREVIOUS_SHA[role],
                  'heldReviewSha256': m.HELD_SHA, 'deletionPerformed': False,
                  'originalDeletionTimeAndCauseKnown': False,
                  'retiredRequirements': [{'path': row['path'], 'heldRowSha256': m.digest(m.encode(row)),
                                          'status': 'already-absent-historical-requirement-retired'}
                                         for row in review['retain']]}
        m.validate_policy(policy, role, review)
        for key, value in [('authorization', 'unapproved'), ('deletionPerformed', True),
                           ('heldReviewSha256', 'wrong')]:
            changed = copy.deepcopy(policy); changed[key] = value
            with self.assertRaises(ValueError): m.validate_policy(changed, role, review)
        changed = copy.deepcopy(policy); changed['retiredRequirements'][0]['path'] = '/data/new-target'
        with self.assertRaises(ValueError): m.validate_policy(changed, role, review)
        changed = copy.deepcopy(policy); changed['retiredRequirements'][0]['heldRowSha256'] = 'wrong'
        with self.assertRaises(ValueError): m.validate_policy(changed, role, review)

    def test_metadata_refuses_symlink_mode_hash(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory)/'safe'; path.write_text('data'); path.chmod(0o600)
            self.assertEqual(m.read_safe(path, m.digest(b'data'), os.getuid()), b'data')
            with self.assertRaises(ValueError): m.read_safe(path, 'bad', os.getuid())
            link = Path(directory)/'link'; link.symlink_to(path)
            with self.assertRaises(ValueError): m.read_safe(link, owner=os.getuid())
            path.chmod(0o666)
            with self.assertRaises(ValueError): m.read_safe(path, owner=os.getuid())


    def test_metadata_aged_atime_read_is_side_effect_free(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / 'aged'
            payload = b'exact retained metadata'
            path.write_bytes(payload)
            path.chmod(0o600)
            aged_ns = 1_000_000_000
            os.utime(path, ns=(aged_ns, path.stat().st_mtime_ns))
            before = path.stat()
            descriptor = os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
            with os.fdopen(descriptor, 'rb') as stream:
                self.assertEqual(stream.read(), payload)
            control = path.stat()
            if control.st_atime_ns == before.st_atime_ns:
                self.skipTest('Fixture filesystem does not update access times')
            self.assertGreater(control.st_atime_ns, before.st_atime_ns)
            for field in ('st_dev', 'st_ino', 'st_mode', 'st_uid', 'st_gid',
                          'st_nlink', 'st_size', 'st_mtime_ns', 'st_ctime_ns'):
                self.assertEqual(getattr(control, field), getattr(before, field), field)
            # Reset before the fence; no fixture mutation occurs during read_safe.
            os.utime(path, ns=(aged_ns, control.st_mtime_ns))
            before = path.stat()
            self.assertEqual(m.read_safe(path, m.digest(payload), os.getuid()), payload)
            after = path.stat()
            self.assertEqual(after, before)
            self.assertEqual(after.st_atime_ns, before.st_atime_ns)
            self.assertEqual(after.st_mtime_ns, before.st_mtime_ns)
            self.assertEqual(after.st_ctime_ns, before.st_ctime_ns)

    def read_then_mutate(self, action):
        original = os.fdopen

        @contextlib.contextmanager
        def intercepted(descriptor, mode):
            with original(descriptor, mode) as stream:
                class Reader:
                    def fileno(self):
                        return stream.fileno()

                    def read(self):
                        result = stream.read()
                        action()
                        return result
                yield Reader()
        return mock.patch.object(m.os, 'fdopen', intercepted)

    def test_metadata_mode_change_during_read_is_rejected(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / 'mode-race'
            path.write_bytes(b'data')
            path.chmod(0o600)
            with self.read_then_mutate(lambda: path.chmod(0o640)):
                with self.assertRaisesRegex(ValueError, 'Metadata changed on read'):
                    m.read_safe(path, m.digest(b'data'), os.getuid())

    def test_metadata_same_bytes_path_replacement_is_rejected(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / 'path-race'
            replacement = Path(directory) / 'replacement'
            for current in (path, replacement):
                current.write_bytes(b'data')
                current.chmod(0o600)
            with self.read_then_mutate(lambda: os.replace(replacement, path)):
                with self.assertRaisesRegex(ValueError, 'Metadata changed (on|after) read'):
                    m.read_safe(path, m.digest(b'data'), os.getuid())

if __name__ == '__main__': unittest.main()
