#!/usr/bin/env python3
"""Exact refusal/custody bindings and no-replay reconciliation dispatch."""
import contextlib
import hashlib
import importlib.util
import io
import json
import os
from pathlib import Path
import subprocess
import tempfile
import types
import unittest
from unittest.mock import Mock, patch

HERE = Path(__file__).resolve().parent
def load(name, path):
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec); spec.loader.exec_module(module); return module
Q = load('reconciliation_test', HERE / 'reconcile_custody.py')
I, L, C = Q.helpers()


class ReconciliationTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(); self.addCleanup(self.temp.cleanup)
        self.base = Path(self.temp.name); self.old_umask = os.umask(0o077); self.addCleanup(os.umask, self.old_umask)
        self.stack = contextlib.ExitStack(); self.addCleanup(self.stack.close)
        self.stack.enter_context(patch.object(C, 'BASE', self.base / 'remote'))
        self.stack.enter_context(patch.object(I, 'CUSTODY', str(self.base / 'custody')))

    def save(self, path, value):
        path.parent.mkdir(parents=True, exist_ok=True)
        I.save(path, Q.encoded(value)); return Q.binding(path, I)

    def fixture(self):
        rid = 'aaaaaaaaaaaa-20261016T000000Z'
        source = C.BASE / 'transport-evidence' / rid / ('proofofwork-ui-source-' + rid)
        source.mkdir(parents=True); (source / 'source.txt').write_bytes(b'exact source\r\n')
        inventory = C.E.inventory(source, owner=os.geteuid(), require_manifest=False, allow_symlinks=True)
        row = {'path': str(source), 'eligible': True, 'retirementMethod': 'custody', 'inventory': inventory}
        index = {'path': '/remote/index', 'sha256': 'a' * 64}
        lifecycle = {'schema': 'pow-ui-custody-lifecycle-v1', 'approval': {'path': '/old/approval', 'sha256': Q.APPROVAL}, 'index': index}
        plan = {'current': {'release_id': rid}, 'lifecycle': lifecycle, 'candidates': [row]}
        qualified = self.save(self.base / 'cycle/custody-qualified.json', plan)
        root = Path(I.CUSTODY) / rid / 'bulk'; root.mkdir(parents=True)
        key = Q.sha(str(source).encode())[:16]; archive = root / (key + '.tgz')
        wanted = C.expected(row)
        with archive.open('xb') as stream:
            exported = C.E.archive_root(source, wanted, stream, owner=os.geteuid(), require_manifest=False, allow_symlinks=True)
        inventory_path = root / (key + '.inventory.json'); self.save(inventory_path, wanted)
        restored = C.E.extract_verify(archive, wanted, self.base / 'restored')
        objects = [{'index': 0, 'path': str(source), 'proof': exported}]
        seal = {'schema': 'pow-ui-custody-export-batch-v1', 'planSha256': qualified['sha256'],
                'entryAndFinalProtectedVerification': True, 'continuousDeploymentLock': True,
                'count': 1, 'objects': objects, 'objectManifestSha256': Q.sha(Q.encoded(objects))}
        seal_binding = self.save(root / 'batch-exported.json', seal)
        record = {'ok': True, 'sourcePath': str(source), 'archivePath': str(archive),
                  'archiveSha256': C.digest(archive), 'inventorySha256': C.E.inventory_sha(inventory['records']),
                  'sourceInventory': wanted, 'restoration': restored, 'planSha256': qualified['sha256'],
                  'batchExport': {'path': seal_binding['path'], 'sha256': seal_binding['sha256'], 'index': 0}}
        self.save(root / (key + '.json'), record)
        cycle = 'release-' + rid + '-batch1'; token = 'b' * 64
        receipt = {'path': '/remote/ordinary', 'sha256': 'c' * 64}
        prepared = {'cycleId': cycle, 'pendingToken': token}
        applied = dict(prepared, stateSha256='d' * 64, index=index, ordinaryReceipt=receipt, lifecycleBinding=lifecycle)
        pbind = self.save(self.base / 'cycle/prepared.json', prepared)
        abind = self.save(self.base / 'cycle/ordinary-applied.json', applied)
        evidence = self.save(self.base / 'original-failure.json', {'observed': 'pre-intent absence'})
        log = self.save(self.base / 'failure-log.json', {'exitCode': 1})
        refusal = {'schema': 'pow-ui-custody-preintent-refusal-v1', 'scopeApprovalSha256': Q.APPROVAL,
                   'disposition': 'authenticated-pre-intent-refusal', 'directStderrAvailable': False,
                   'state': {'path': I.STATE, 'sha256': 'd' * 64, 'revision': 10,
                             'pendingStage': 'ordinary-complete', 'status': 'retention-incomplete'},
                   'config': {'path': I.CONFIG, 'sha256': 'e' * 64}, 'process': {'exitCode': 1, 'log': log},
                   'cycleId': cycle, 'pendingToken': token, 'evidence': [evidence], 'qualifiedPlan': qualified,
                   'prepared': pbind, 'ordinaryApplied': abind, 'index': index, 'ordinaryReceipt': receipt,
                   'custodyRoot': str(root), 'sealedBatch': seal_binding,
                   'sourceChecks': [{'path': str(source), 'sourcePresent': True, 'receiptAbsent': True,
                                     'receiptPath': str(C.BASE / 'cleanup-evidence' / ('bounded-retention-' + qualified['sha256'][:12] + '-' + key))}]}
        refusal_binding = self.save(self.base / 'refusal.json', refusal)
        def restore_check(archive_path, wanted_path, output, **kwargs):
            result = C.E.verify_restored(output, json.loads(wanted_path.read_bytes()))
            return subprocess.CompletedProcess([], 0, json.dumps(result), '')
        self.stack.enter_context(patch.object(C, 'restored_check', side_effect=restore_check))
        return refusal_binding, refusal, plan, archive

    def test_real_archive_and_restored_bytes_are_reverified(self):
        bound, refusal, plan, archive = self.fixture()
        review = Q.read_local(bound, I, C)
        self.assertEqual(review['plan'], plan)
        self.assertEqual(review['localProofs']['objects'][0]['archive']['sha256'], C.digest(archive))
        (self.base / 'restored/source.txt').write_bytes(b'corrupted restored copy')
        with self.assertRaises(ValueError): Q.read_local(bound, I, C)

    def test_custody_archive_and_seal_changes_refuse(self):
        bound, refusal, _, archive = self.fixture()
        original = archive.read_bytes(); archive.write_bytes(original + b'changed')
        with self.assertRaisesRegex(ValueError, 'archive hash'): Q.read_local(bound, I, C)
        archive.write_bytes(original)
        Path(refusal['sealedBatch']['path']).write_bytes(b'{}')
        with self.assertRaisesRegex(ValueError, 'seal differs'): Q.read_local(bound, I, C)

    def test_refusal_scope_and_state_paths_are_not_substitutable(self):
        bound, refusal, _, _ = self.fixture()
        for label, alter in [('state', lambda p: p['state'].update(path='/elsewhere/state')),
                             ('scope', lambda p: p['sourceChecks'].clear())]:
            changed = json.loads(Q.encoded(refusal)); alter(changed)
            bad = self.save(self.base / (label + '.json'), changed)
            with self.subTest(label=label), self.assertRaises(ValueError): Q.read_local(bad, I, C)

    def test_repo_group_write_requires_exact_hash_and_rejects_world_write_or_symlink(self):
        repository = self.base / 'repository'; repository.mkdir()
        path = repository / 'review.json'; path.write_bytes(b'exact reviewed bytes'); path.chmod(0o664)
        with patch.object(Q, 'ROOT', repository):
            self.assertEqual(Q.local_read(path, I, Q.sha(path.read_bytes())), b'exact reviewed bytes')
            with self.assertRaisesRegex(ValueError, 'SHA differs'): Q.local_read(path, I, '0' * 64)
            path.chmod(0o666)
            with self.assertRaisesRegex(ValueError, 'Unsafe repository'): Q.local_read(path, I)
            path.chmod(0o664); link = repository / 'linked.json'; link.symlink_to(path)
            with self.assertRaisesRegex(ValueError, 'Unsafe repository'): Q.local_read(link, I)
        outside = self.base / 'private.json'; outside.write_bytes(b'private'); outside.chmod(0o664)
        with self.assertRaisesRegex(ValueError, 'Unsafe installation'): Q.local_read(outside, I)

    def application_plan(self):
        return {'schema': 'pow-ui-custody-reconciliation-plan-v1', 'scopeApprovalSha256': Q.APPROVAL,
                'refusal': {'path': '/reviewed/refusal', 'sha256': 'a' * 64},
                'qualifiedPlan': {'path': '/existing/qualified', 'sha256': 'b' * 64}, 'custodyRoot': '/existing/sealed',
                'sources': {'files': [{'path': 'deploy/ui-retention/custody.py', 'sha256': 'c' * 64}]},
                'remote': {'binding': {'config': {'path': I.CONFIG, 'sha256': 'd' * 64}},
                           'stateSha256': 'e' * 64, 'context': {'pair': {'current': 'a', 'previous': 'b'}},
                           'pending': {'cycleId': 'sealed-cycle', 'token': 'f' * 64}},
                'operationId': 'complete-existing-receipt1'}

    def test_apply_dispatches_only_custody_and_exact_old_complete_cycle(self):
        plan = self.application_plan(); calls = []
        custody = types.SimpleNamespace(SOURCES={}, retire=lambda *a, **kw: calls.append(('retire', a, kw)))
        local = types.SimpleNamespace(blob=lambda p: {'path': str(p)},
            call=lambda *a: calls.append(('complete', a)) or {'retentionComplete': True})
        destination = self.base / 'attempt'
        with patch.object(Q, 'create_plan', return_value=plan):
            result = Q.apply(plan, destination, I, local, custody)
            with self.assertRaisesRegex(ValueError, 'attempt exists'): Q.apply(plan, destination, I, local, custody)
        self.assertTrue(result['retentionComplete']); self.assertEqual([c[0] for c in calls], ['retire', 'complete'])
        self.assertEqual(calls[0][2]['expected_sources'], plan['sources']['files'])
        binding, operation, frame = calls[1][1]
        self.assertEqual(binding, plan['remote']['binding']); self.assertEqual(operation, 'complete-cycle')
        self.assertEqual(frame['expectedStateSha256'], plan['remote']['stateSha256'])
        self.assertEqual(frame['cycleId'], 'sealed-cycle'); self.assertEqual(frame['pendingToken'], 'f' * 64)
        self.assertTrue((destination / 'intent.json').is_file()); self.assertTrue((destination / 'completed.json').is_file())

    def test_stale_review_or_retirement_failure_never_completes_or_replays(self):
        plan = self.application_plan(); custody = types.SimpleNamespace(SOURCES={}, retire=Mock(side_effect=ValueError('changed source')))
        local = types.SimpleNamespace(call=Mock(), blob=Mock())
        with patch.object(Q, 'create_plan', return_value=dict(plan, changed=True)):
            with self.assertRaisesRegex(ValueError, 'changed after review'):
                Q.apply(plan, self.base / 'stale', I, local, custody)
        self.assertFalse((self.base / 'stale').exists()); custody.retire.assert_not_called()
        with patch.object(Q, 'create_plan', return_value=plan):
            with self.assertRaisesRegex(ValueError, 'changed source'):
                Q.apply(plan, self.base / 'failed', I, local, custody)
        local.call.assert_not_called(); self.assertTrue((self.base / 'failed/intent.json').exists())
        self.assertFalse((self.base / 'failed/completed.json').exists())


if __name__ == '__main__': unittest.main()
