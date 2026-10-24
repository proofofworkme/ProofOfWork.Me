#!/usr/bin/env python3
import copy
import importlib.util
import os
from pathlib import Path
import tempfile
import unittest
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

if __name__ == '__main__': unittest.main()
