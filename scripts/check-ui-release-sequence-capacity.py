#!/usr/bin/env python3
"""Whole-release budget refusal fixtures. No remote calls or allocations."""
import copy
import importlib.util
from pathlib import Path
import unittest

PATH = Path(__file__).resolve().parents[1] / 'deploy/publish/sequence_capacity.py'
SPEC = importlib.util.spec_from_file_location('sequence_capacity', PATH)
M = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(M)


class CompleteSequence(unittest.TestCase):
    def setUp(self):
        self.plan = {'inputStorage': 'release-evidence-v1',
                     'admissions': {'surfaces-receive': {'bytes': 300000000, 'inodes': 4000},
                                    'source-receive': {'bytes': 400000000, 'inodes': 15000}},
                     'sourceAllocatedBytes': 350000000, 'stageArchiveUpperBoundBytes': 450000000}
        self.census = {'limits': dict(M.LIMITS), 'usage': {'backup': 0, 'transport': 0, 'scratch': 0},
                       'availableBytes': 30 * 1024**3, 'availableInodes': 1000000,
                       'liveTree': {'additionalBytes': 500000000, 'additionalInodes': 3000}}
        self.required = M.requirements(self.plan, self.census)

    def exact_fit(self):
        census = copy.deepcopy(self.census)
        for name in ('backup', 'transport', 'scratch'):
            census['usage'][name] = M.LIMITS[name + 'BudgetBytes'] - self.required['additionalBytes'][name]
        census['availableBytes'] = (M.LIMITS['rootReserveBytes'] + M.LIMITS['growthReserveBytes'] +
                                    self.required['additionalBytes']['root'])
        census['availableInodes'] = M.LIMITS['inodeReserve'] + self.required['additionalInodes']
        return census

    def test_exact_fit_then_one_byte_or_inode_over_each_limit(self):
        census = self.exact_fit()
        self.assertTrue(M.admit(self.required, census)['ok'])
        for name in ('backup', 'transport', 'scratch', 'root', 'inodes'):
            with self.subTest(boundary=name):
                changed = copy.deepcopy(census)
                if name in changed['usage']:
                    changed['usage'][name] += 1
                else:
                    changed['availableBytes' if name == 'root' else 'availableInodes'] -= 1
                with self.assertRaisesRegex(ValueError, 'before upload'):
                    M.admit(self.required, changed)

    def test_live_root_rename_charges_backup_even_without_physical_copy(self):
        larger = copy.deepcopy(self.census)
        larger['liveTree']['additionalBytes'] += 300000000
        new = M.requirements(self.plan, larger)
        self.assertEqual(new['additionalBytes']['backup'] - self.required['additionalBytes']['backup'], 300000000)
        self.assertEqual(new['charges']['liveToRollbackPool'], 800000000)
        # Old roots can be shared with other retained roots. No guessed
        # cross-pool hardlink saving can admit an otherwise over-budget rename.
        with self.assertRaisesRegex(ValueError, 'before upload'):
            M.admit(new, self.exact_fit())

    def test_new_preserved_input_charges_transport_and_backup(self):
        plan = copy.deepcopy(self.plan)
        plan['admissions']['surfaces-receive']['bytes'] += 1
        required = M.requirements(plan, self.census)
        for name in ('transport', 'backup'):
            self.assertEqual(required['additionalBytes'][name] - self.required['additionalBytes'][name], 1)
        with self.assertRaisesRegex(ValueError, 'before upload'):
            M.admit(required, self.exact_fit())

    def test_provenance_extraction_is_charged_while_archive_exists(self):
        charges = self.required['charges']
        self.assertGreaterEqual(charges['provenanceExtraction'], charges['candidateCopy'])
        self.assertGreater(self.required['additionalBytes']['root'],
                           charges['managedArchiveAndSidecars'] + charges['candidateCopy'] + charges['preservedSource'])

    def test_promised_cleanup_and_deduplication_never_create_headroom(self):
        for key in ('retirementCreditBytes', 'futureHardlinkCreditBytes'):
            changed = copy.deepcopy(self.required)
            changed[key] = 1
            with self.assertRaisesRegex(ValueError, 'cannot credit'):
                M.admit(changed, self.census)

    def test_concurrent_allocation_requires_fresh_admission(self):
        census = self.exact_fit()
        self.assertTrue(M.admit(self.required, census)['ok'])
        census['usage']['backup'] += 4096
        with self.assertRaisesRegex(ValueError, 'before upload'):
            M.admit(self.required, census)

    def test_limits_cannot_be_raised_and_unknown_partial_states_refuse(self):
        changed = copy.deepcopy(self.census)
        changed['limits']['backupBudgetBytes'] += 1
        with self.assertRaises(ValueError):
            M.requirements(self.plan, changed)
        for key in ('resumeSurfaces', 'preservedStageResume', 'preservedCapacityResume'):
            plan = {**self.plan, key: {}}
            with self.assertRaisesRegex(ValueError, 'reconciliation'):
                M.requirements(plan, self.census)
        for value in (True, -1, '100'):
            plan = copy.deepcopy(self.plan)
            plan['sourceAllocatedBytes'] = value
            with self.assertRaises(ValueError):
                M.requirements(plan, self.census)


if __name__ == '__main__':
    unittest.main()
