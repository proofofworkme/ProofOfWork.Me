#!/usr/bin/env python3
"""Whole-release budget and transport-order fixtures. No remote calls."""
import ast
import copy
import importlib.util
import io
import json
import os
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

    def test_transport_only_calibration_and_retained_failure_measurement(self):
        self.assertEqual(M.LIMITS, {
            'backupBudgetBytes': 18 * 1024**3,
            'transportBudgetBytes': 9 * 1024**3 + 64 * 1024**2,
            'scratchBudgetBytes': 5 * 1024**3,
            'rootReserveBytes': 10 * 1024**3,
            'growthReserveBytes': 64 * 1024**2, 'inodeReserve': 128})
        census = self.exact_fit()
        census['usage']['transport'] = 8008511488
        required = copy.deepcopy(self.required)
        required['additionalBytes']['transport'] = 1667156555
        self.assertEqual(M.admit(required, census)['headroom']['transport'], 55117237)
        self.assertEqual(8008511488 + 1667156555 - 9 * 1024**3, 11991627)
        historical = copy.deepcopy(census)
        historical['limits']['transportBudgetBytes'] = 9 * 1024**3
        with self.assertRaisesRegex(ValueError, 'cannot credit'):
            M.admit(required, historical)
        census['usage']['transport'] += 55117238
        with self.assertRaisesRegex(ValueError, 'before upload'):
            M.admit(required, census)

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
            'transport': incoming + source + M.EVIDENCE_BYTES,
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

    def test_new_archive_growth_charges_backup_and_root_but_never_transport(self):
        plan = copy.deepcopy(self.plan)
        plan['stageArchiveUpperBoundBytes'] += 4096
        required = M.requirements(plan, self.census)
        for name in ('backup', 'root'):
            self.assertEqual(required['additionalBytes'][name] - self.required['additionalBytes'][name], 4096)
        for name in ('transport', 'scratch'):
            self.assertEqual(required['additionalBytes'][name], self.required['additionalBytes'][name])
        with self.assertRaisesRegex(ValueError, 'before upload'):
            M.admit(required, self.exact_fit())

    def test_archive_pool_allocation_admits_observed_refusal_without_retirement_credit(self):
        plan = copy.deepcopy(self.plan)
        plan['admissions']['surfaces-receive']['bytes'] = 393461760
        plan['admissions']['source-receive']['bytes'] = 415391744
        plan['sourceAllocatedBytes'] = 361689088
        plan['stageArchiveUpperBoundBytes'] = 801087643 - 65536
        census = copy.deepcopy(self.census)
        census['usage'] = {'backup': 16332455936, 'transport': 8758210560, 'scratch': 1622282240}
        census['availableBytes'] = 16224972800
        census['liveTree']['additionalBytes'] = 646123520
        required = M.requirements(plan, census)
        result = M.admit(required, census)
        self.assertEqual(result['headroom']['transport'], 96612352)
        self.assertEqual(required['retirementCreditBytes'], 0)
        self.assertEqual(required['futureHardlinkCreditBytes'], 0)
        previous = copy.deepcopy(required)
        previous['additionalBytes']['transport'] += required['charges']['managedArchiveAndSidecars']
        with self.assertRaisesRegex(ValueError, '"transport": 704475291'):
            M.admit(previous, census)

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
                       or assignment(node, 'RECEIVE_TIMEOUT_SECONDS')
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


class ArchivePoolWork(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory(prefix='pow-archive-pool-')
        self.root = Path(self.temporary.name).resolve()
        self.archives, self.evidence = self.root / 'archives', self.root / 'evidence'
        self.archives.mkdir(mode=0o700); self.evidence.mkdir(mode=0o700)
        self.release, self.attempt = 'aaaaaaaaaaaa-20261101T021451Z', 'initial'
        self.workspace = self.archives / ('.proofofwork-ui-archive-' + self.release + '-' + self.attempt)
        path = PATH.with_name('remote_transport.py')
        nodes = ast.parse(path.read_bytes()).body
        definitions = [node for node in nodes if isinstance(node, (ast.Import, ast.ImportFrom))
            or isinstance(node, ast.FunctionDef) and node.name in ('directory', 'sync', 'rename_new', 'archive_workspace')]
        self.scope = {'__name__': '_archive_pool_fixture', 'BASE': self.root, 'ARCHIVES': self.archives}
        exec(compile(ast.Module(body=definitions, type_ignores=[]), str(path), 'exec'), self.scope)
        # Only numeric root ownership is adapted for unprivileged test runners.
        # Real path, device, mode, symlink and exclusive-mkdir checks remain.
        lstat = Path.lstat
        def owned(path, *args, **kwargs):
            value = lstat(path, *args, **kwargs)
            result = types.SimpleNamespace(**{key: getattr(value, key) for key in dir(value) if key.startswith('st_')})
            result.st_uid = result.st_gid = 0
            return result
        self.owner = patch.object(Path, 'lstat', owned)
        self.owner.start()

    def tearDown(self):
        self.owner.stop()
        self.temporary.cleanup()

    def test_archive_workspace_is_exclusive_canonical_and_in_archive_pool(self):
        work = self.scope['archive_workspace'](self.release, self.attempt)
        self.assertEqual(work, self.workspace)
        self.assertEqual(work.stat().st_mode & 0o777, 0o700)
        self.assertEqual(work.stat().st_dev, self.archives.stat().st_dev)
        with self.assertRaises(FileExistsError):
            self.scope['archive_workspace'](self.release, self.attempt)

    def test_occupied_file_and_dangling_symlink_refuse_without_replacing_evidence(self):
        for kind in ('file', 'symlink'):
            with self.subTest(kind=kind):
                if kind == 'file': self.workspace.write_bytes(b'prior evidence')
                else: self.workspace.symlink_to(self.root / 'absent')
                before = self.workspace.lstat()
                with self.assertRaises(FileExistsError):
                    self.scope['archive_workspace'](self.release, self.attempt)
                self.assertEqual(self.workspace.lstat().st_ino, before.st_ino)
                if kind == 'file': self.assertEqual(self.workspace.read_bytes(), b'prior evidence')
                else: self.assertFalse((self.root / 'absent').exists())
                self.workspace.unlink()

    def test_unsafe_archive_parent_and_unbound_attempt_refuse_before_creation(self):
        alias = self.root / 'alias'; alias.symlink_to(self.archives, target_is_directory=True)
        self.scope['ARCHIVES'] = alias
        with self.assertRaises(AssertionError): self.scope['archive_workspace'](self.release, self.attempt)
        self.assertFalse(self.workspace.exists())
        self.scope['ARCHIVES'] = self.archives
        for release, attempt in ((self.release, '../old'), ('../old', self.attempt), (self.release, '')):
            with self.subTest(release=release, attempt=attempt), self.assertRaises(AssertionError):
                self.scope['archive_workspace'](release, attempt)
        self.assertEqual(list(self.archives.iterdir()), [])

    def test_real_archive_branch_allocates_and_renames_only_within_archive_pool(self):
        path = PATH.with_name('remote_transport.py')
        nodes = ast.parse(path.read_bytes()).body
        branch = next(node for node in nodes if isinstance(node, ast.If)
            and ast.unparse(node.test) == "phase != 'source'")
        start = next(i for i, node in enumerate(branch.body) if isinstance(node, ast.Expr)
            and isinstance(node.value, ast.Call) and ast.unparse(node.value).startswith("capacity('check', ARCHIVES,"))
        finish = next(i for i in range(start, len(branch.body)) if isinstance(branch.body[i], ast.Expr)
            and ast.unparse(branch.body[i].value) == 'rename_new(temporary, archive)')
        code = compile(ast.Module(body=branch.body[start:finish + 1], type_ignores=[]), str(path), 'exec')
        archive = self.archives / ('proofofwork-ui-release-' + self.release + '.tgz')
        admissions = []
        def run(argv, name, **kwargs):
            self.assertEqual(name, 'archive.log')
            temporary = Path(argv[argv.index('--file') + 1])
            self.assertEqual(temporary.parent, self.workspace)
            self.assertFalse(os.path.lexists(temporary))
            self.assertEqual(admissions, [('check', self.archives, 4096 + 65536, 'archive')])
            with temporary.open('xb') as output: output.write(b'fixture managed archive')
        self.scope.update(release=self.release, p={'publicationAttempt': self.attempt},
            evidence_root=self.evidence, archive=archive, upper=4096, stage=self.root / 'stage',
            SURFACES=['computer'], run=run,
            capacity=lambda *args, **kwargs: admissions.append(args))
        exec(code, self.scope)
        self.assertEqual(archive.read_bytes(), b'fixture managed archive')
        self.assertEqual(Path(str(archive) + '.sha256').read_text(),
            self.scope['hashlib'].sha256(archive.read_bytes()).hexdigest() + '  ' + archive.name + '\n')
        self.assertEqual(list(self.workspace.iterdir()), [])
        self.assertEqual([path.name for path in self.evidence.iterdir()], ['archive-base'])


if __name__ == '__main__':
    unittest.main()
