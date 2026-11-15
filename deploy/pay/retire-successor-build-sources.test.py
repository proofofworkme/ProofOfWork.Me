#!/usr/bin/python3
"""Scoped successor retirement refusal and synthetic application fixtures."""
import importlib.util
import json
from pathlib import Path
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location('successor_source_retirement',
    Path(__file__).with_name('retire-successor-build-sources.py'))
R = importlib.util.module_from_spec(spec)
spec.loader.exec_module(R)


class SuccessorRetirementTests(unittest.TestCase):
    def test_exact_scope_excludes_all_live_prior_and_held_roots(self):
        self.assertEqual([row[0] for row in R.TARGETS], ['pay-a3cf496-20261114',
            'ui-three-fixes-ca8954b-20261112', 'ui-three-fixes-a04684f-20261112',
            'linked-publish-1f677f6-20261112'])
        for run, name, archive, receipt, inode in R.TARGETS:
            self.assertTrue(name.startswith('proofofwork-ui-source-'))
            self.assertNotIn('/', run + name)
            self.assertEqual(len(archive), 64); self.assertEqual(len(receipt), 64)
            self.assertGreater(inode, 0)
            for protected in ('064b6991', 'e2669bc1', '1042', 'c3969'):
                self.assertNotIn(protected, name)
        self.assertEqual(len(R.B.TARGETS), 3)
        self.assertNotEqual(R.FORMAT, R.B.FORMAT)

    def fixture(self, base):
        source = base / 'source'; source.mkdir(mode=0o700)
        (source / 'bytes').write_bytes(b'exact reviewed source')
        archive = base / 'source.tgz'; archive.write_bytes(b'existing retained archive')
        receipt = base / 'build-receipt.json'; receipt.write_bytes(b'existing build receipt')
        row = {'path': str(source), 'rootIdentity': R.B.identity(source.lstat()),
               'archive': str(archive), 'archiveSha256': R.B.digest_file(archive),
               'receiptSha256': R.B.digest_file(receipt)}
        plan = R.reviewed_plan([row]); plan_path = base / 'plan.json'
        plan_path.write_text(json.dumps(plan)); plan_path.chmod(0o600)
        args = SimpleNamespace(approval=R.APPROVAL, plan=plan_path,
            plan_sha256=R.B.digest_file(plan_path), receipt=base / 'apply.json')
        return source, archive, receipt, plan, args

    def test_wrong_approval_hash_or_plan_refuses_before_any_removal(self):
        for case in ('approval', 'hash', 'plan'):
            with self.subTest(case=case), tempfile.TemporaryDirectory(prefix='pay-four-refusal-') as directory:
                base = Path(directory); source, archive, receipt, plan, args = self.fixture(base)
                if case == 'approval': args.approval = 'retire-only-three-reviewed-pay-build-source-trees'
                elif case == 'hash': args.plan_sha256 = '0' * 64
                else: plan = dict(plan, controllerSha256='0' * 64)
                with patch.object(R.B, 'RESULTS', base), self.assertRaises(ValueError):
                    R.apply(plan, args)
                self.assertTrue(source.exists()); self.assertTrue(archive.exists()); self.assertTrue(receipt.exists())
                self.assertFalse(args.receipt.exists())

    def test_synthetic_application_preserves_archive_receipt_and_seals_once(self):
        with tempfile.TemporaryDirectory(prefix='pay-four-apply-') as directory:
            base = Path(directory); source, archive, receipt, plan, args = self.fixture(base)
            before = (archive.read_bytes(), receipt.read_bytes())
            with patch.object(R.B, 'RESULTS', base):
                result = R.apply(plan, args)
                self.assertEqual(result['phase'], 'complete')
                self.assertFalse(source.exists()); self.assertEqual(before, (archive.read_bytes(), receipt.read_bytes()))
                self.assertEqual(json.loads(args.receipt.read_bytes())['phase'], 'verified-before-removal')
                self.assertTrue(Path(result['receipt']).exists())
                with self.assertRaises(FileExistsError): R.apply(plan, args)

    def test_root_identity_drift_stops_after_intent_without_removal(self):
        with tempfile.TemporaryDirectory(prefix='pay-four-identity-') as directory:
            base = Path(directory); source, archive, receipt, plan, args = self.fixture(base)
            source.rename(base / 'moved-source')
            source.mkdir(mode=0o700)
            with patch.object(R.B, 'RESULTS', base), self.assertRaisesRegex(ValueError, 'Source changed'):
                R.apply(plan, args)
            self.assertTrue(source.exists()); self.assertTrue(archive.exists()); self.assertTrue(receipt.exists())
            self.assertTrue(args.receipt.exists())
            self.assertFalse(args.receipt.with_name('apply-complete.json').exists())


if __name__ == '__main__':
    unittest.main()
