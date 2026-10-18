#!/usr/bin/env python3
"""Whole-release budget and transport-order fixtures. No remote calls."""
import ast
import copy
import importlib.util
import io
import json
from pathlib import Path
import tempfile
import types
import unittest
from unittest.mock import patch

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

    def test_nonoverlapping_scratch_phases_keep_other_projections_unchanged(self):
        charges = self.required['charges']
        incoming, source = charges['receivedSurfaces'], charges['preservedSource']
        candidate, verification = charges['candidateCopy'], charges['provenanceExtraction']
        archive, old = charges['managedArchiveAndSidecars'], charges['liveToRollbackPool']
        self.assertEqual(self.required['additionalBytes'], {
            'root': incoming + source + candidate + archive + verification + M.EVIDENCE_BYTES,
            'backup': incoming + source + archive + old + M.EVIDENCE_BYTES,
            'transport': incoming + source + archive + M.EVIDENCE_BYTES,
            'scratch': max(incoming, candidate + verification) + M.EVIDENCE_BYTES,
        })
        self.assertEqual(self.required['additionalInodes'], 33512)
        # At the new exact boundary the old sum falsely charges the already
        # preserved input a second time. One additional real scratch byte
        # still refuses; no deletion, deduplication or limit change is credited.
        census = self.exact_fit()
        old_requirement = copy.deepcopy(self.required)
        old_requirement['additionalBytes']['scratch'] += incoming
        with self.assertRaisesRegex(ValueError, 'before upload'):
            M.admit(old_requirement, census)
        self.assertEqual(M.admit(self.required, census)['headroom']['scratch'], 0)
        census['usage']['scratch'] += 1
        with self.assertRaisesRegex(ValueError, 'before upload'):
            M.admit(self.required, census)

    def test_refused_release_is_admitted_without_touching_existing_scratch(self):
        plan = copy.deepcopy(self.plan)
        plan['admissions']['surfaces-receive']['bytes'] = 391208960
        census = copy.deepcopy(self.census)
        census['liveTree']['additionalBytes'] = 640266240
        census['usage']['scratch'] = 2874064896
        required = M.requirements(plan, census)
        self.assertEqual(required['additionalBytes']['scratch'], 2130059264)
        self.assertEqual(M.admit(required, census)['headroom']['scratch'], 364584960)
        old_requirement = copy.deepcopy(required)
        old_requirement['additionalBytes']['scratch'] += 391208960
        with self.assertRaisesRegex(ValueError, '"scratch": 26624000'):
            M.admit(old_requirement, census)

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


class TransportPhaseOrder(unittest.TestCase):
    """Execute the real fresh transport branch through its stager boundary.

    Receiver/process and root-owner boundaries are fixture adapters; the
    production rename, absence/inode assertions and branch ordering run intact.
    No systemd, SSH, archive creation or production module preamble executes.
    """
    def run_transport(self, *, ineffective_rename=False):
        path = PATH.with_name('remote_transport.py')
        nodes = ast.parse(path.read_bytes()).body
        def assignment(node, name):
            return isinstance(node, ast.Assign) and any(
                isinstance(target, ast.Name) and target.id == name for target in node.targets)
        start = next(i for i, node in enumerate(nodes) if assignment(node, 'kind'))
        finish = next(i for i in range(start, len(nodes)) if isinstance(nodes[i], ast.If)
                      and ast.unparse(nodes[i].test) == "phase != 'source'")
        definitions = [node for node in nodes if isinstance(node, (ast.Import, ast.ImportFrom))
                       or isinstance(node, ast.FunctionDef) and node.name in
                       ('sync', 'durable_json', 'rename_new')]
        scope = {'__name__': '_transport_order_fixture'}
        exec(compile(ast.Module(body=definitions, type_ignores=[]), str(path), 'exec'), scope)
        code = compile(ast.Module(body=nodes[start:finish + 1], type_ignores=[]), str(path), 'exec')
        class ReachedStager(Exception):
            pass
        with tempfile.TemporaryDirectory(prefix='pow-scratch-order-') as temporary:
            root = Path(temporary)
            scratch, evidence, archives, out = [root / name for name in ('scratch', 'evidence', 'archives', 'out')]
            for directory in (scratch, evidence, archives, out):
                directory.mkdir()
            release = 'aaaaaaaaaaaa-20261018T082109Z'
            payload = scratch / ('proofofwork-ui-surfaces-' + release)
            evidence_root = evidence / release
            preserved = evidence_root / payload.name
            stage = scratch / ('proofofwork-www-stage-' + release)
            fingerprint = {'sha256': 'f' * 64, 'entries': 3, 'regularBytes': 7}
            events, received_identity = [], []
            def directory(path, create=False):
                if create:
                    path.mkdir(exist_ok=True)
                self.assertTrue(path.is_dir())
            def fingerprint_at(path):
                self.assertEqual((path / 'surfaces' / 'payload').read_bytes(), b'fixture')
                return fingerprint
            def run(argv, name, **kwargs):
                if name == 'receive-admission.log':
                    events.append('admitted')
                elif name == 'receiver.log':
                    self.assertFalse(stage.exists())
                    self.assertFalse(evidence_root.exists())
                    (payload / 'surfaces').mkdir(parents=True)
                    (payload / 'surfaces' / 'payload').write_bytes(b'fixture')
                    received_identity.append((payload.stat().st_dev, payload.stat().st_ino))
                    receipt = {'status': 'verified', 'archiveSha256': 'a' * 64,
                               'compressedBytes': 7, 'releaseId': release, 'kind': 'surfaces',
                               'extractedRoot': str(payload), 'entries': 3, 'logicalBytes': 7}
                    (scratch / ('audit5-stream-surfaces-' + release + '.json')).write_text(json.dumps(receipt))
                    events.append('received')
                elif name in ('stage-model.json', 'stager.log'):
                    # Both model and real stage launch must observe receipt
                    # completion and the same inode outside the scratch pool.
                    self.assertFalse(payload.exists())
                    self.assertEqual((preserved.stat().st_dev, preserved.stat().st_ino), received_identity[0])
                    self.assertTrue((evidence_root / 'incoming-receipt.json').is_file())
                    self.assertIn(str(preserved / 'surfaces'), argv)
                    if name == 'stage-model.json':
                        (out / name).write_text(json.dumps({'inputStabilityVerified': True,
                            'installedStagerSha256': 's' * 64, 'peakAdditionalBytes': 4096}))
                        events.append('modeled')
                    else:
                        self.assertIn(str(stage), argv)
                        events.append('stager')
                        raise ReachedStager()
                else:
                    self.fail('Unexpected process boundary: ' + name)
            scope.update(BASE=scratch, EVIDENCE=evidence, ARCHIVES=archives, out=out,
                phase='surfaces-stage', release=release, evidence_root=evidence_root,
                plan_sha='p' * 64, lock_fd=123, tools=root / 'tools', EVIDENCE_RESERVE=32*1024**2,
                phase_capacity_source='fixture phase model', SURFACES=['fixture'],
                helpers={'capacity': {'sha256': 'c' * 64}, 'stager': {'path': '/fixture/stager', 'sha256': 's' * 64}},
                p={'admissions': {'surfaces-receive': {'bytes': 4096, 'inodes': 32}},
                   'surfaces': {'compressedBytes': 7, 'sha256': 'a' * 64},
                   'publicationAttempt': 'fixture', 'commit': 'a' * 40, 'tree': 'b' * 40,
                   'surfacesPayloadFingerprint': fingerprint, 'stageArchiveUpperBoundBytes': 8192},
                sys=types.SimpleNamespace(stdin=types.SimpleNamespace(buffer=io.BytesIO())),
                run=run, directory=directory, capacity=lambda *args, **kwargs: None,
                validate_evidence_ancestors=lambda *args, **kwargs: None,
                payload_fingerprint=fingerprint_at, modeled_managed_archive_upper=lambda *args: 8192)
            if ineffective_rename:
                class FakeRename:
                    def __call__(self, *args):
                        return 0
                with patch.object(scope['ctypes'], 'CDLL', return_value=types.SimpleNamespace(renameat2=FakeRename())):
                    with self.assertRaises(AssertionError):
                        exec(code, scope)
                self.assertEqual(events, ['admitted', 'received'])
                self.assertTrue(payload.exists())
                self.assertFalse((evidence_root / 'incoming-receipt.json').exists())
            else:
                with self.assertRaises(ReachedStager):
                    exec(code, scope)
                self.assertEqual(events, ['admitted', 'received', 'modeled', 'stager'])

    def test_received_surfaces_leave_scratch_before_model_and_stager(self):
        self.run_transport()

    def test_failed_move_cannot_reach_model_or_stager(self):
        self.run_transport(ineffective_rename=True)


if __name__ == '__main__':
    unittest.main()
