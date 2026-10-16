#!/usr/bin/env python3
"""Real filesystem state fencing plus real policy/custody retirement integration."""
import base64
import contextlib
import importlib.util
import json
import os
from pathlib import Path
import subprocess
import shutil
import tempfile
import types
import unittest
from unittest.mock import patch


def load(name, path):
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


HERE = Path(__file__).resolve().parent
R = load('lifecycle_remote_tests', HERE / 'lifecycle_remote.py')
I = load('lifecycle_installer_tests', HERE / 'install_lifecycle.py')
F = load('lifecycle_storage_fixtures', HERE.parent / 'audit30/check-ui-storage.test.py')


def envelope(value):
    raw = R.encoded(value)
    return {'base64': base64.b64encode(raw).decode(), 'sha256': R.sha(raw)}


class RemoteTests(unittest.TestCase):
    def setUp(self):
        self.previous_umask = os.umask(0o077)
        self.fixture = F.StorageTests()
        self.fixture.setUp()
        self.addCleanup(self.fixture.doCleanups)
        self.addCleanup(self.fixture.tearDown)
        self.layout = self.fixture.l
        self.state = self.fixture.base / 'state'
        self.state.mkdir()
        self.config = {'statePath': str(self.state / 'state.json'), 'offHostCustodyRoot': R.CUSTODY_ROOT,
                       'approval': {'path': '/approved/package/approval.json', 'sha256': R.APPROVAL_SHA},
                       'controller': {'path': '/approved/package/controller.py', 'sha256': 'c' * 64}}
        self.runtime = R.Runtime(self.config, 'a' * 64, F.S, F.P, layout=self.layout)
        self.capacity = patch.object(self.runtime, 'capacity', return_value={'unchangedBudgets': True})
        self.capacity.start()
        self.addCleanup(self.capacity.stop)

    def tearDown(self):
        os.umask(self.previous_umask)

    def initialize(self):
        _, review, _, _, _ = self.fixture.migration_fixture()
        review_binding = self.fixture.policy_record('audit30-policy-migration-review-', review)
        _, context = self.runtime.current()
        return self.runtime.dispatch('bootstrap', {'operationId': 'bootstrap-test', 'expectedStateSha256': None,
                                                   'expectedPair': context['pair'], 'migrationReview': review_binding})

    def https(self):
        pair, context = self.runtime.current()
        fields = pair['current']['fields']
        surfaces = F.S.declared_surfaces(fields)
        count = sum(int(fields['surface.' + n + '.file_count']) for n in surfaces if n != 'nft')
        value = {'format': 'publish-ui-https-byte-smoke-v1', 'ok': True,
                 'releaseId': fields['release_id'], 'commit': fields['commit'], 'tree': fields['source_tree'],
                 'archiveSha256': fields['archive_sha256'], 'manifestSha256': context['manifests']['current'],
                 'sidecarAndProvenanceVerified': True, 'sourceProvenanceVerified': True,
                 'finalLocalEvidenceReverified': True, 'apexRedirectVerified': True,
                 'expectedPublicFiles': count, 'archivedFilesChecked': count,
                 'hostnameRootsChecked': len(surfaces) - 1, 'publicSurfaces': len(surfaces) - 1,
                 'sourceProvenanceSurfaces': len(surfaces) - 1, 'finishedAt': '2026-10-16T03:00:00Z'}
        terminal = {'releaseId': fields['release_id'], 'commit': fields['commit'], 'tree': fields['source_tree'],
                    'exitCode': 0, 'failure': None, 'finishedAt': '2026-10-16T02:59:00Z'}
        path = self.layout.scratch / ('recovery-publish-' + fields['release_id'] + '-test') / 'receipt.json'
        path.parent.mkdir()
        binding = R.write_new(path, R.encoded(terminal))
        return value, binding, context

    def prepare(self):
        initialized = self.initialize()
        https, publication, context = self.https()
        return self.runtime.dispatch('prepare-cycle', {'operationId': 'release-' + context['pair']['current'],
            'expectedStateSha256': initialized['stateSha256'], 'expectedPair': context['pair'],
            'httpsReceipt': envelope(https), 'publicationReceipt': publication})

    def test_bootstrap_preserves_prior_index_and_exact_previous_state(self):
        result = self.initialize()
        status = self.runtime.dispatch('status', {})
        self.assertFalse(status['retentionComplete'])
        self.assertEqual(result['stateSha256'], status['stateSha256'])
        self.assertEqual(status['binding']['state']['sha256'], status['stateSha256'])
        intent, _ = R.read_json(result['intent']['path'], result['intent']['sha256'])
        self.assertIsNone(intent['priorStateBase64'])
        with self.assertRaisesRegex(ValueError, 'retention-incomplete'):
            self.runtime.dispatch('status', {'requireComplete': True})

    def test_prepare_canonical_plan_bytes_and_durable_prior_state(self):
        result = self.prepare()
        plan = result['ordinaryPlan']
        self.assertEqual(Path(plan['path']).read_bytes(), F.S.encoded(plan['value']))
        self.assertEqual(plan['sha256'], F.S.digest(plan['value']))
        intent, _ = R.read_json(result['intent']['path'], result['intent']['sha256'])
        prior = base64.b64decode(intent['priorStateBase64'])
        self.assertEqual(R.sha(prior), intent['priorStateSha256'])
        self.assertIsNone(json.loads(prior)['pending'])
        self.assertEqual(self.runtime.state()[0]['pending']['stage'], 'prepared')

    def test_stale_state_and_current_pair_refuse_before_intent(self):
        initialized = self.initialize()
        https, publication, context = self.https()
        frame = {'operationId': 'stale', 'expectedStateSha256': '0' * 64, 'expectedPair': context['pair'],
                 'httpsReceipt': envelope(https), 'publicationReceipt': publication}
        with self.assertRaisesRegex(ValueError, 'Stale expected'):
            self.runtime.dispatch('prepare-cycle', frame)
        self.assertFalse((self.layout.evidence / 'ui-lifecycle-stale-intent.json').exists())
        frame['expectedStateSha256'] = initialized['stateSha256']
        frame['expectedPair'] = dict(context['pair'], current='changed')
        with self.assertRaisesRegex(ValueError, 'pair differs'):
            self.runtime.dispatch('prepare-cycle', frame)

    def test_https_partial_assets_or_stale_manifest_refuses(self):
        initialized = self.initialize()
        https, publication, context = self.https()
        for change in ({'manifestSha256': '0' * 64}, {'archivedFilesChecked': 0},
                       {'sourceProvenanceVerified': False}, {'finishedAt': '2026-10-16T01:00:00Z'}):
            with self.subTest(change=change), self.assertRaises(ValueError):
                self.runtime.dispatch('prepare-cycle', {'operationId': 'bad-https',
                    'expectedStateSha256': initialized['stateSha256'], 'expectedPair': context['pair'],
                    'httpsReceipt': envelope(dict(https, **change)), 'publicationReceipt': publication})
        self.assertEqual(self.runtime.state()[1], initialized['stateSha256'])

    def test_publication_value_binding_uses_exact_durable_sha(self):
        self.initialize()
        https, binding, context = self.https()
        terminal, _ = R.read_json(binding['path'])
        pair, _ = self.runtime.current()
        result = self.runtime.verify_publication(https, {'path': binding['path'], 'value': terminal}, pair, context)
        self.assertEqual(result, binding)
        with self.assertRaisesRegex(ValueError, 'terminal value differs'):
            self.runtime.verify_publication(https, {'path': binding['path'], 'value': dict(terminal, exitCode=1)}, pair, context)

    def test_preparation_interruption_blocks_new_operation_ids(self):
        initialized = self.initialize()
        https, publication, context = self.https()
        frame = {'operationId': 'interrupted', 'expectedStateSha256': initialized['stateSha256'],
                 'expectedPair': context['pair'], 'httpsReceipt': envelope(https), 'publicationReceipt': publication}
        with patch.object(F.S, 'create_plan', side_effect=InterruptedError('fixture interruption')):
            with self.assertRaises(InterruptedError):
                self.runtime.dispatch('prepare-cycle', frame)
        state, state_sha = self.runtime.state()
        self.assertEqual(state['activePhase']['operationId'], 'interrupted')
        frame.update(operationId='blind-retry', expectedStateSha256=state_sha)
        with self.assertRaisesRegex(ValueError, 'reconcile'):
            self.runtime.dispatch('prepare-cycle', frame)
        self.assertFalse((self.layout.evidence / 'ui-lifecycle-blind-retry-intent.json').exists())

    def test_durable_intent_without_state_write_still_blocks_retry(self):
        initialized = self.initialize()
        https, publication, context = self.https()
        frame = {'operationId': 'state-write-failed', 'expectedStateSha256': initialized['stateSha256'],
                 'expectedPair': context['pair'], 'httpsReceipt': envelope(https), 'publicationReceipt': publication}
        with patch.object(self.runtime, 'cas', side_effect=OSError('fixture full disk')):
            with self.assertRaises(OSError):
                self.runtime.dispatch('prepare-cycle', frame)
        self.assertEqual(self.runtime.state()[1], initialized['stateSha256'])
        self.assertEqual(len(self.runtime.status({})['unfinishedIntents']), 1)
        with self.assertRaisesRegex(ValueError, 'Unsealed phase'):
            self.runtime.dispatch('prepare-cycle', dict(frame, operationId='blind-retry'))

    def custody_state(self):
        plan, proof = self.fixture.ordinary_custody_fixture()
        _, context = self.runtime.current()
        plan_binding = R.write_new(self.layout.evidence / 'fixture-ordinary-plan.json', F.S.encoded(plan))
        state = {'schema': 'pow-ui-retention-lifecycle-state-v1', 'configSha256': self.runtime.config_sha,
                 'revision': 1, 'status': 'retention-incomplete', 'index': plan['policyScope']['admissionIndex'],
                 'completedContext': None, 'activePhase': None,
                 'pending': {'stage': 'prepared', 'cycleId': 'fixture', 'token': 'f' * 64,
                             'context': context, 'ordinaryPlan': plan_binding}}
        R.write_new(self.runtime.state_path, R.encoded(state))
        frame = {'expectedStateSha256': R.sha(R.encoded(state)), 'expectedPair': context['pair'],
                 'operationId': 'ordinary-test', 'cycleId': 'fixture', 'pendingToken': 'f' * 64,
                 'custodyProof': envelope(proof)}
        return plan, proof, state, frame

    def test_real_ordinary_custody_and_execute_update_authenticated_index(self):
        plan, _, _, frame = self.custody_state()
        out = self.runtime.dispatch('apply-ordinary', frame)
        self.assertTrue(out['freshCustodyQualificationRequired'])
        self.assertEqual(F.P.policy_scope(out['index'], self.layout, R.APPROVAL_SHA)['eligible'], [])
        self.assertTrue(all(not Path(r['path']).exists() for r in plan['delete']))
        state, _ = self.runtime.state()
        self.assertEqual(state['pending']['stage'], 'ordinary-complete')
        self.assertFalse(self.runtime.status({})['retentionComplete'])

    def test_custody_mismatch_changes_no_artifact_and_blocks_retry(self):
        plan, proof, _, frame = self.custody_state()
        frame['custodyProof'] = envelope(dict(proof, objects=proof['objects'][:-1]))
        with self.assertRaisesRegex(ValueError, 'every planned object'):
            self.runtime.dispatch('apply-ordinary', frame)
        self.assertTrue(all(Path(r['path']).exists() for r in plan['delete']))
        self.assertEqual(self.runtime.state()[0]['activePhase']['operation'], 'apply-ordinary')

    def test_interrupted_execute_preserves_applying_state_no_new_index(self):
        _, _, state, frame = self.custody_state()
        with patch.object(F.S, 'execute', side_effect=InterruptedError('fixture interruption')):
            with self.assertRaises(InterruptedError):
                self.runtime.dispatch('apply-ordinary', frame)
        current, _ = self.runtime.state()
        self.assertEqual(current['pending']['stage'], 'applying')
        self.assertEqual(current['index'], state['index'])
        with self.assertRaisesRegex(ValueError, 'Partial phase'):
            self.runtime.dispatch('apply-ordinary', dict(frame, operationId='retry'))

    def test_complete_requires_fresh_closure_and_final_custody_verifier(self):
        _, _, _, frame = self.custody_state()
        applied = self.runtime.dispatch('apply-ordinary', frame)
        state, _ = self.runtime.state()
        custody = types.SimpleNamespace(verify_final_result=lambda *args: {'ok': True, 'completedCount': 0})
        self.runtime.C = custody
        plan = {'lifecycle': self.runtime.lifecycle(applied['index']), 'candidates': []}
        final = {'expectedStateSha256': applied['stateSha256'], 'expectedPair': state['pending']['context']['pair'],
                 'operationId': 'complete-test', 'cycleId': 'fixture', 'pendingToken': 'f' * 64,
                 'custodyPlan': envelope(plan), 'custodyResult': envelope({'ok': True})}
        with patch.object(custody, 'verify_final_result', side_effect=ValueError('eligible bulk remains')):
            with self.assertRaisesRegex(ValueError, 'eligible bulk'):
                self.runtime.dispatch('complete-cycle', final)
        bad = dict(final, custodyPlan=envelope({'lifecycle': {'index': {'sha256': '0' * 64}}}))
        with self.assertRaisesRegex(ValueError, 'Fresh custody'):
            self.runtime.dispatch('complete-cycle', bad)
        out = self.runtime.dispatch('complete-cycle', final)
        self.assertTrue(out['retentionComplete'])
        self.assertTrue(self.runtime.dispatch('status', {'requireComplete': True})['retentionComplete'])
        # A newly published pair cannot borrow the prior cycle's completion.
        self.fixture.publish_policy_fixture('aaaaaa000003-20261016T040000Z', F.S.V5_SURFACES, 'proofofwork-ui-release-v5')
        with self.assertRaisesRegex(ValueError, 'retention-incomplete'):
            self.runtime.dispatch('status', {'requireComplete': True})
        before, state_sha = self.runtime.state()
        https, publication, context = self.https()
        next_cycle = self.runtime.dispatch('prepare-cycle', {'operationId': 'prepare-next',
            'expectedStateSha256': state_sha, 'expectedPair': context['pair'],
            'httpsReceipt': envelope(https), 'publicationReceipt': publication})
        admitted = F.P.load_index(next_cycle['index']['path'], next_cycle['index']['sha256'], self.layout, R.APPROVAL_SHA)
        self.assertEqual(len(admitted['admissions']), 2)
        self.assertEqual(admitted['admissions'][-1]['retainedPair'], context['pair'])
        self.assertNotEqual(next_cycle['index'], before['index'])

    def test_existing_receipt_is_never_overwritten_and_state_cas_refuses(self):
        path = self.layout.evidence / 'sealed.json'
        R.write_new(path, b'original')
        with self.assertRaises(FileExistsError):
            R.write_new(path, b'replacement')
        self.assertEqual(path.read_bytes(), b'original')
        self.initialize()
        before, digest = self.runtime.state()
        with self.assertRaisesRegex(ValueError, 'State changed'):
            self.runtime.cas('0' * 64, before, 'wrong-cas')
        self.assertEqual(self.runtime.state()[1], digest)

    def test_complete_status_rechecks_real_retirement_absence_and_journal(self):
        _, _, _, frame = self.custody_state()
        applied = self.runtime.dispatch('apply-ordinary', frame)
        state, _ = self.runtime.state()
        custody = load('completed_status_custody', HERE / 'custody.py')
        custody.load_helpers()
        self.runtime.C = custody
        exporter, removal = custody.E, custody.W
        name = 'proofofwork-ui-release-eeeeeeeeeeee-20261016T010203Z.tgz'
        primary = self.layout.archives / name
        for suffix in ('', '.sha256', '.provenance'):
            Path(str(primary) + suffix).write_bytes(b'uniquely preserved fixture bytes')
        inventory = exporter.inventory_file_group(primary, sorted(name + s for s in ('', '.sha256', '.provenance')), os.geteuid())
        source = custody.expected({'inventory': inventory})
        row = {'path': str(primary), 'eligible': True, 'retirementMethod': 'custody', 'inventory': inventory}
        plan = {'candidates': [row], 'lifecycle': self.runtime.lifecycle(applied['index'])}
        plan_sha = R.sha(custody.encoded(plan))
        key = R.sha(str(primary).encode())[:16]
        receipt = self.layout.evidence / ('bounded-retention-' + plan_sha[:12] + '-' + key)
        receipt.mkdir()
        archive = self.fixture.base / 'reappeared-custody.tgz'
        with archive.open('wb') as sink:
            exporter.archive_root(primary, source, sink, os.geteuid())
        restoration = exporter.extract_verify(archive, source, self.fixture.base / 'reappeared-restored')
        record = {'ok': True, 'sourcePath': str(primary), 'sourceInventory': source,
                  'inventorySha256': exporter.inventory_sha(inventory['records']),
                  'archiveSha256': custody.digest(archive), 'planSha256': plan_sha, 'restoration': restoration}
        R.write_new(receipt / 'intent.json', custody.encoded({'plan': {'lifecycle': plan['lifecycle']}, 'row': row, 'custody': record}))
        journal = removal.Journal(receipt / 'actions.jsonl')
        fd = os.open(primary.parent, os.O_RDONLY | os.O_DIRECTORY)
        try:
            count = removal.delete_file_group(fd, source, journal)
        finally:
            journal.close()
            os.close(fd)
        completed = {'ok': True, 'path': str(primary), 'receipt': str(receipt), 'actions': count,
                     'custody': record, 'protectedPairVerified': True}
        R.write_new(receipt / 'completed.json', custody.encoded(completed))
        result = {'ok': True, 'completed': [completed], 'planSha256': plan_sha}
        packet = {'expectedStateSha256': applied['stateSha256'], 'expectedPair': state['pending']['context']['pair'],
                  'operationId': 'complete-absence', 'cycleId': 'fixture', 'pendingToken': 'f' * 64,
                  'custodyPlan': envelope(plan), 'custodyResult': envelope(result)}
        # Runtime independently checks the real policy pair/guards/index; only
        # custody's fixed-production discovery/fence paths are fixture-bound.
        with patch.object(custody, 'BASE', self.layout.base), patch.object(custody, 'fence'), patch.object(custody, 'discover', return_value=[]):
            self.runtime.dispatch('complete-cycle', packet)
            self.assertTrue(self.runtime.dispatch('status', {'requireComplete': True})['retentionComplete'])
            primary.write_bytes(b'reappeared source/upload')
            with self.assertRaisesRegex(ValueError, 'reappeared'):
                self.runtime.dispatch('status', {'requireComplete': True})
            primary.unlink()
            log = receipt / 'actions.jsonl'
            log.write_bytes(b'\n'.join(log.read_bytes().splitlines()[:-1]) + b'\n')
            with self.assertRaisesRegex(ValueError, 'partial'):
                self.runtime.dispatch('status', {'requireComplete': True})

    def test_a_b_c_d_complete_cycles_with_real_custody_and_prior_restoration(self):
        # Remove unrelated historical fixture setup before the migration review;
        # this acceptance fixture starts with only its actual admitted lineage.
        keep_ids = {self.fixture.current, self.fixture.previous}
        for path in self.layout.roots.iterdir():
            if path.name != 'proofofwork-www-pre-' + self.fixture.current:
                shutil.rmtree(path)
        for path in self.layout.archives.iterdir():
            if not any(path.name.startswith('proofofwork-ui-release-' + rid + '.tgz') for rid in keep_ids):
                path.unlink()
        self.initialize()
        custody = load('repeated_cycle_custody', HERE / 'custody.py')
        custody.load_helpers()
        self.runtime.C = custody
        E, W = custody.E, custody.W
        approval = self.fixture.base / 'repair-approval.json'
        approval.write_bytes((HERE.parents[1] / 'audits/2026-10-16-ui-retention-repair-approval.json').read_bytes())
        self.config['approval'] = {'path': str(approval), 'sha256': R.APPROVAL_SHA}
        guards = F.S.safeguards(self.layout)[0]
        capacity_bytes = self.layout.capacity.read_bytes()
        capacity_policy = load('repeated_cycle_capacity', HERE.parent / 'proofofwork-ui-capacity.py')
        limits = (capacity_policy.ROOT_RESERVE_BYTES, capacity_policy.GROWTH_RESERVE_BYTES,
                  capacity_policy.MAX_DEPLOY_SCRATCH_BYTES, capacity_policy.RETENTION_BUDGETS)
        self.assertEqual(limits[:3], (10 * 1024**3, 64 * 1024**2, 5 * 1024**3))
        self.assertEqual([limit for _, limit in limits[3]], [18 * 1024**3, 9 * 1024**3])
        original_read, original_verified = E.read_regular, custody.R.verified_release

        def read_fixture(path, *args, **kwargs):
            if str(path) == '/etc/proofofwork-retention/audit28-held-review.json':
                raw, info = original_read(self.layout.held, *args, **kwargs)
                review = json.loads(raw)
                for row in review['retain']:
                    row['path'] = str(self.fixture.base / row['path'].lstrip('/'))
                return E.encoded(review), info
            return original_read(path, *args, **kwargs)

        def verified_fixture(path, archives):
            return original_verified(self.layout.live if Path(path) == Path('/var/www') else path, archives)

        def inventory_fixture(path, kind):
            if kind == 'managed-archive-group':
                return E.inventory_file_group(path, sorted(Path(str(path) + s).name for s in ('', '.sha256', '.provenance')), os.geteuid())
            return E.inventory(path, os.geteuid(), require_manifest=False, allow_symlinks=True)

        def terminal(fields, existing=None):
            folder = self.layout.scratch / ('recovery-publish-' + fields['release_id'] + '-test')
            folder.mkdir(exist_ok=True)
            intent = {'attempt': 'test', 'releaseId': fields['release_id'], 'commit': fields['commit'], 'tree': fields['source_tree']}
            log = ('ui_release_publish status=published release_id=' + fields['release_id'] + ' commit=' + fields['commit'] + ' fixture=yes\n').encode()
            (folder / 'intent.json').write_bytes(E.encoded(intent))
            (folder / 'publisher.log').write_bytes(log)
            result = dict(intent, exitCode=0, failure=None, finishedAt='2026-10-16T02:59:00Z',
                          evidence=str(folder), publisherLogSha256=R.sha(log), capturedLogBytes=len(log))
            (folder / 'receipt.json').write_bytes(E.encoded(result))
            return {'path': str(folder / 'receipt.json'), 'sha256': R.sha(E.encoded(result))}

        def preserve(path, source, directory, key):
            archive = directory / (key + '.tgz')
            with archive.open('wb') as stream:
                exported = E.archive_root(path, source, stream, os.geteuid(), require_manifest=False, allow_symlinks=True)
            restored_path = directory / (key + '-restored')
            restored = E.extract_verify(archive, source, restored_path)
            E.verify_restored(restored_path, source)
            return dict(ok=True, sourcePath=str(path), sourceInventory=source, archivePath=str(archive),
                        archiveSha256=exported['archiveSha256'], inventorySha256=exported['inventorySha256'], restoration=restored)

        with contextlib.ExitStack() as stack:
            for obj, name, value in ((custody, 'BASE', self.layout.base), (custody, 'SCRATCH', self.layout.scratch),
                                     (custody, 'A', F.S), (custody, 'P', F.P)):
                stack.enter_context(patch.object(obj, name, value))
            stack.enter_context(patch.object(F.S, 'Layout', return_value=self.layout))
            stack.enter_context(patch.object(E, 'read_regular', side_effect=read_fixture))
            stack.enter_context(patch.object(E, 'hold_snapshot', return_value=guards))
            stack.enter_context(patch.object(E, 'timer_snapshot', return_value=guards['masks']))
            stack.enter_context(patch.object(custody.R, 'verified_release', side_effect=verified_fixture))
            stack.enter_context(patch.object(custody, 'row_inventory', side_effect=inventory_fixture))
            stack.enter_context(patch.object(custody, 'check_references', return_value={'fixtureNamespaceChecked': True}))
            pair, _ = self.runtime.current()
            terminal(pair['previous']['fields'])
            releases = [pair['current']['fields']['release_id'], 'aaaaaa000003-20261016T030000Z',
                        'aaaaaa000004-20261016T040000Z', 'aaaaaa000005-20261016T050000Z']
            previous_revision = -1
            for number, rid in enumerate(releases):
                if number:
                    self.fixture.publish_policy_fixture(rid, F.S.V5_SURFACES, 'proofofwork-ui-release-v5')
                    old, new = F.S.source_locations(self.layout, rid)
                    new.parent.mkdir(parents=True)
                    os.rename(old, new)
                https, _, context = self.https()
                pair, _ = self.runtime.current()
                publication = terminal(pair['current']['fields'])
                _, state_sha = self.runtime.state()
                prepared = self.runtime.dispatch('prepare-cycle', {'operationId': 'release-' + rid,
                    'expectedStateSha256': state_sha, 'expectedPair': context['pair'],
                    'httpsReceipt': envelope(https), 'publicationReceipt': publication})
                plan = prepared['ordinaryPlan']['value']
                directory = self.fixture.base / ('cycle-custody-' + str(number))
                directory.mkdir()
                groups, objects = {}, []
                for row in plan['delete']:
                    path = Path(row['path'])
                    root = row['kind'] == 'rollback-root'
                    primary = path if root or row['kind'] == 'managed-release-archive' else Path(str(path).removesuffix('.sha256').removesuffix('.provenance'))
                    if str(primary) not in groups:
                        inventory = inventory_fixture(primary, 'rollback-root' if root else 'managed-archive-group')
                        source = custody.expected({'inventory': inventory})
                        record = preserve(primary, source, directory, 'ordinary-' + str(len(groups)))
                        record['planSha256'] = F.S.digest(plan)
                        binding = self.fixture.policy_record('ui-retention-custody-record-', record)
                        groups[str(primary)] = (record, binding)
                    record, binding = groups[str(primary)]
                    objects.append(dict(path=str(path), snapshotSha256=row['snapshot']['sha256'], custody=binding,
                        sourceMember='.' if root else path.name, archiveSha256=record['archiveSha256'],
                        inventorySha256=record['inventorySha256'], custodyPlanSha256=record['planSha256'], independentRestorationVerified=True))
                proof = dict(schema='pow-ui-retention-ordinary-custody-proof-v1', scopeApprovalSha256=R.APPROVAL_SHA,
                    admissionIndex=prepared['index'], planSha256=F.S.digest(plan), protectedReleaseIds=sorted(context['pair'].values()), objects=objects)
                applied = self.runtime.dispatch('apply-ordinary', {'operationId': 'ordinary-' + rid,
                    'expectedStateSha256': prepared['stateSha256'], 'expectedPair': context['pair'],
                    'cycleId': prepared['cycleId'], 'pendingToken': prepared['pendingToken'], 'custodyProof': envelope(proof)})
                pair, _ = self.runtime.current()
                bulk = {'current': verified_fixture(self.layout.live, self.layout.archives),
                        'prior': verified_fixture(Path(pair['previous']['path']), self.layout.archives),
                        'priorRoot': pair['previous']['path'], 'holds': guards, 'timers': guards['masks'],
                        'protectedManifests': {pair[k]['path']: F.S.hash_read(Path(pair[k]['path']) / '.proofofwork-ui-release')[0] for k in ('current', 'previous')},
                        'lifecycle': applied['lifecycleBinding'],
                        'closure': custody.lifecycle_context(applied['lifecycleBinding'])}
                bulk['candidates'] = [custody.qualify_candidate(path, bulk) for path in custody.discover(bulk)]
                bulk_sha = R.sha(custody.encoded(bulk))
                completed = []
                for row in bulk['candidates']:
                    if not row['eligible']:
                        continue
                    self.assertEqual(row['retirementMethod'], 'custody')
                    path = Path(row['path'])
                    source = custody.expected(row)
                    record = preserve(path, source, directory, 'bulk-' + str(len(completed)))
                    record['planSha256'] = bulk_sha
                    key = R.sha(str(path).encode())[:16]
                    receipt = self.layout.evidence / ('bounded-retention-' + bulk_sha[:12] + '-' + key)
                    receipt.mkdir()
                    R.write_new(receipt / 'intent.json', custody.encoded({'plan': {k: v for k, v in bulk.items() if k != 'candidates'}, 'row': row, 'custody': record}))
                    journal = W.Journal(receipt / 'actions.jsonl')
                    fd = os.open(path.parent, os.O_RDONLY | os.O_DIRECTORY)
                    try:
                        count = W.delete_tree(fd, path.name, source, journal)
                    finally:
                        os.close(fd)
                        journal.close()
                    result = dict(ok=True, path=str(path), receipt=str(receipt), actions=count, custody=record, protectedPairVerified=True)
                    R.write_new(receipt / 'completed.json', custody.encoded(result))
                    completed.append(result)
                final = self.runtime.dispatch('complete-cycle', {'operationId': 'complete-' + rid,
                    'expectedStateSha256': applied['stateSha256'], 'expectedPair': context['pair'],
                    'cycleId': prepared['cycleId'], 'pendingToken': prepared['pendingToken'],
                    'custodyPlan': envelope(bulk), 'custodyResult': envelope({'ok': True, 'completed': completed, 'planSha256': bulk_sha})})
                self.assertTrue(final['retentionComplete'])
                status = self.runtime.dispatch('status', {'requireComplete': True})
                self.assertEqual(status['pair']['current'], rid)
                self.assertEqual(list(self.layout.roots.iterdir()), [Path(pair['previous']['path'])])
                self.assertEqual(sorted(p.name for p in self.layout.archives.iterdir()), sorted(
                    pair[k]['fields']['archive_name'] + suffix for k in ('current', 'previous') for suffix in ('', '.sha256', '.provenance')))
                self.assertEqual(len(list((self.layout.base / 'transport-evidence').glob('*/proofofwork-ui-source-*'))), 2)
                self.assertEqual(F.S.safeguards(self.layout)[0], guards)
                self.assertEqual(self.layout.capacity.read_bytes(), capacity_bytes)
                self.assertEqual(limits, (capacity_policy.ROOT_RESERVE_BYTES, capacity_policy.GROWTH_RESERVE_BYTES,
                                        capacity_policy.MAX_DEPLOY_SCRATCH_BYTES, capacity_policy.RETENTION_BUDGETS))
                prior_path = Path(pair['previous']['path'])
                prior_inventory = E.inventory(prior_path, os.geteuid())
                restored = preserve(prior_path, custody.expected({'inventory': prior_inventory}), directory, 'verified-prior')
                self.assertTrue(restored['restoration']['modeTimesXattrsRestored'])
                current_state, _ = self.runtime.state()
                self.assertGreater(current_state['revision'], previous_revision)
                previous_revision = current_state['revision']
                self.assertEqual(current_state['status'], 'complete')
                self.assertIsNone(current_state['pending'])


class PackagingTests(unittest.TestCase):
    def fixture_payload(self):
        def git(argv):
            if 'status' in argv:
                return b''
            if argv[-1] == 'HEAD':
                return b'1' * 40
            if argv[-1] == 'HEAD^{tree}':
                return b'2' * 40
            return (I.ROOT / argv[-1].split(':', 1)[1]).read_bytes()
        with patch.object(I.subprocess, 'check_output', side_effect=git):
            return I.committed_payload()

    def installer_fixture(self, base):
        for relative in ('usr/local/sbin', 'etc/proofofwork-retention', 'etc/systemd/system',
                         'var/www', 'var/backups/proofofwork-ui/cleanup-evidence',
                         'var/backups/proofofwork-ui/rollback-roots', 'run/proofofwork-ui', 'var/lib'):
            (base / relative).mkdir(parents=True, exist_ok=True, mode=0o700)
        for relative in ('usr/local/sbin/proofofwork-ui-capacity',
                         'usr/local/sbin/proofofwork-retention-protection',
                         'usr/local/sbin/proofofwork-ui-release-publish',
                         'etc/proofofwork-retention/audit28.hold',
                         'run/proofofwork-ui/deploy.lock'):
            path = base / relative
            path.write_bytes(b'original bytes preserved\n')
            path.chmod(0o600)
        for name in ('proofofwork-ui-release-prune.timer', 'proofofwork-ui-storage-prune.timer'):
            (base / 'etc/systemd/system' / name).symlink_to('/dev/null')
        rid = 'aaaaaaaaaaaa-20261016T000000Z'
        (base / 'var/www/.proofofwork-ui-release').write_text('release_id=' + rid + '\n')
        prior = base / 'var/backups/proofofwork-ui/rollback-roots' / ('proofofwork-www-pre-' + rid)
        prior.mkdir()
        (prior / '.proofofwork-ui-release').write_text('release_id=bbbbbbbbbbbb-20261015T000000Z\n')
        old = base / I.EVIDENCE.lstrip('/') / 'audit30-private-tools-old'
        old.mkdir()
        (old / 'historical.py').write_bytes(b'unique historical source')
        return {'schema': 'pow-ui-retention-install-plan-v1', 'scopeApprovalSha256': I.APPROVAL,
                'payload': self.fixture_payload(), 'before': I.guard_inventory(base)}

    def test_actual_installer_creates_only_private_package_config_and_receipts(self):
        with tempfile.TemporaryDirectory() as directory:
            base = Path(directory)
            old_umask = os.umask(0o077)
            try:
                plan = self.installer_fixture(base)
                with patch.object(I.subprocess, 'run', return_value=subprocess.CompletedProcess([], 0, b'{}')):
                    out = I.install_remote(plan, base)
                self.assertTrue(out['priorHelpersHoldsAndTimersPreserved'])
                after = I.guard_inventory(base)
                self.assertEqual(after['files'], plan['before']['files'])
                self.assertEqual(after['units'], plan['before']['units'])
                self.assertEqual(after['currentManifest'], plan['before']['currentManifest'])
                self.assertEqual(after['previousManifest'], plan['before']['previousManifest'])
                self.assertFalse(after['configAbsent'])
                self.assertTrue(after['stateAbsent'])
                self.assertEqual((base / I.CONFIG.lstrip('/')).stat().st_mode & 0o777, 0o600)
                self.assertEqual((base / I.EVIDENCE.lstrip('/') / 'audit30-private-tools-old/historical.py').read_bytes(),
                                 b'unique historical source')
                with self.assertRaisesRegex(ValueError, 'guard/pair changed'):
                    I.install_remote(plan, base)
            finally:
                os.umask(old_umask)

    def test_installer_drift_and_existing_intent_refuse_without_installation(self):
        with tempfile.TemporaryDirectory() as directory:
            base = Path(directory)
            old_umask = os.umask(0o077)
            try:
                plan = self.installer_fixture(base)
                helper = base / 'usr/local/sbin/proofofwork-retention-protection'
                helper.write_bytes(b'accepted concurrent monitor change')
                with self.assertRaisesRegex(ValueError, 'guard/pair changed'):
                    I.install_remote(plan, base)
                self.assertFalse((base / I.CONFIG.lstrip('/')).exists())
                plan['before'] = I.guard_inventory(base)
                receipt = base / I.EVIDENCE.lstrip('/') / ('ui-lifecycle-install-' + plan['payload']['config']['package']['sha256'])
                receipt.mkdir()
                (receipt / 'intent.json').write_bytes(b'prior interrupted installation')
                with self.assertRaisesRegex(ValueError, 'Prior package or install intent'):
                    I.install_remote(plan, base)
            finally:
                os.umask(old_umask)

    def test_package_lists_match_and_exclude_existing_helpers(self):
        self.assertEqual(I.FILES, R.PACKAGE_FILES)
        self.assertNotIn('deploy/proofofwork-ui-capacity.py', I.FILES)
        self.assertNotIn('deploy/proofofwork-retention-protection.py', I.FILES)
        self.assertIn('deploy/ui-retention/lifecycle.py', I.FILES)

    def test_committed_package_refuses_dirty_source(self):
        with patch.object(I.subprocess, 'check_output', return_value=b' M tracked.py\n'):
            with self.assertRaisesRegex(ValueError, 'Commit reviewed'):
                I.committed_payload()

    def test_installer_expanded_path_and_config_rejected(self):
        with self.assertRaisesRegex(ValueError, 'Expanded package'):
            I.validate_payload({'files': {'../../outside': {}}, 'manifest': {'files': {}}})

    def test_embedded_evidence_sha_duplicates_and_symlink_refuse(self):
        with self.assertRaisesRegex(ValueError, 'SHA differs'):
            R.embedded({'value': {'x': 1}, 'sha256': '0' * 64})
        raw = b'{"same":1,"same":2}'
        with self.assertRaisesRegex(ValueError, 'Duplicate'):
            R.embedded({'base64': base64.b64encode(raw).decode(), 'sha256': R.sha(raw)})
        with tempfile.TemporaryDirectory() as root:
            path = Path(root) / 'real'
            path.write_text('bytes')
            path.chmod(0o600)
            link = Path(root) / 'link'
            link.symlink_to(path)
            with self.assertRaisesRegex(ValueError, 'Unsafe evidence'):
                R.read(link)


if __name__ == '__main__':
    unittest.main()
