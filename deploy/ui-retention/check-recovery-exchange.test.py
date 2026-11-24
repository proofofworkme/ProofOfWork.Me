#!/usr/bin/env python3
"""Exercise the real persistent recovery exchange on disposable inodes."""
import importlib.util
import json
import os
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch


S = importlib.util.spec_from_file_location('failed341_exchange', Path(__file__).with_name('recovery_exchange.py'))
M = importlib.util.module_from_spec(S)
S.loader.exec_module(M)


class PowerLoss(BaseException):
    pass


class ExchangeTests(unittest.TestCase):
    def setUp(self):
        self.addCleanup(os.umask, os.umask(0o077))
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name)
        self.live = {k: self.root / rel for k, rel in M.TARGETS.items()}
        self.original = {k: (k + '-failed341\n').encode() for k in M.ROLES}
        self.after = {k: (k + '-recovered342\n').encode() for k in M.ROLES}
        self.prior = {k: M.sha(raw) for k, raw in self.original.items()}
        for k, path in self.live.items():
            path.parent.mkdir(parents=True, mode=0o700)
            path.write_bytes(self.original[k])
            path.chmod(0o600)
            os.setxattr(path, 'user.exchange-fixture', b'original')
        self.old_ids = {k: M.read(path)[1] for k, path in self.live.items()}
        self.journal = (self.root / 'var/backups/proofofwork-ui/cleanup-evidence' /
                        ('ui-lifecycle-upgrade-' + '1' * 64) / 'exchange')
        self.journal.parent.mkdir(parents=True, mode=0o700)
        self.plan = '2' * 64
        self.lock = True
        self.checked = []
        self.expect_failure = False

    def fence(self):
        if not self.lock:
            raise ValueError('No deployment lock')

    def after_check(self):
        self.assertEqual(self.positions(), self.after)
        self.checked.append('after')
        if self.expect_failure:
            raise ValueError('Native post-switch verification failed')
        return M.sha(b'actual new status')

    def reviewed(self):
        return M.review_receipts(self.journal, self.plan, lambda path, pin: M.read(path)[0], os.path.lexists)

    def ordinary(self):
        self.fence()
        self.assertEqual(self.positions(), self.after)
        chain = self.reviewed()
        self.assertEqual(set(chain['receipts']), {'forward', 'checking', 'verified'})
        self.assertEqual(chain['records']['verified']['verificationSha256'], M.sha(b'actual new status'))
        self.checked.append('ordinary')
        return M.sha(b'independent ordinary complete status')

    def restored_check(self):
        self.assertEqual({k: M.read(path)[1] for k, path in self.live.items()}, self.old_ids)
        self.checked.append('restored')
        return M.sha(b'actual original refusal')

    def operate(self, action):
        return M.operate(action, self.journal, self.plan, self.prior, self.after,
                         self.fence, self.after_check, self.restored_check, verify_ordinary=self.ordinary,
                         root=self.root, prior_descriptors=self.old_ids)

    def positions(self):
        return {k: path.read_bytes() for k, path in self.live.items()}

    def assert_restored(self):
        with self.assertRaises(M.Restored) as result:
            self.operate('reconcile')
        self.assertEqual(result.exception.result['disposition'], 'restored')
        self.assertEqual(self.positions(), self.original)

    def test_native_success_preserves_both_original_inodes(self):
        self.assertEqual(self.operate('status')['disposition'], 'absent')
        prepared = self.operate('prepare')
        self.assertEqual(prepared['positions'], dict.fromkeys(M.ROLES, 'before'))
        self.assertTrue(all(os.getxattr(self.journal / k, 'user.exchange-fixture') == b'original' for k in M.ROLES))
        with self.assertRaisesRegex(ValueError, 'already exists'):
            self.operate('prepare')
        result = self.operate('apply')
        self.assertEqual(result['disposition'], 'accepted')
        self.assertEqual(self.checked, ['after', 'ordinary'])
        self.assertEqual({k: M.read(self.journal / k)[1] for k in M.ROLES}, self.old_ids)
        self.assertEqual(self.operate('status'), result)
        self.assertEqual(self.operate('reconcile'), result)
        self.assertEqual(self.checked, ['after', 'ordinary'])
        self.assertEqual(set(result['receipts']), {'forward', 'checking', 'verified', 'accepted'})

    def test_acceptance_binds_both_independent_native_proofs_and_provisional_receipt(self):
        self.operate('prepare')
        self.operate('apply')
        checked = self.reviewed()
        self.assertEqual(checked['records']['verified']['verificationSha256'], M.sha(b'actual new status'))
        accepted = checked['records']['accepted']
        self.assertEqual(accepted['verifiedSha256'], checked['receipts']['verified'])
        self.assertEqual(accepted['verificationSha256'], M.sha(b'independent ordinary complete status'))
        self.assertEqual(accepted['preparedSha256'], checked['preparedSha256'])

    def test_ordinary_failure_retains_provisional_receipt_and_restores_original_inodes(self):
        self.operate('prepare')
        original_ordinary = self.ordinary
        def fail_ordinary():
            original_ordinary()
            raise ValueError('Post-switch ordinary path refused')
        self.ordinary = fail_ordinary
        with self.assertRaises(M.Restored) as refused:
            self.operate('apply')
        self.assertEqual(refused.exception.result['disposition'], 'restored')
        self.assertEqual(set(self.reviewed()['receipts']), {'forward', 'checking', 'verified', 'reversing', 'restored'})
        self.assertEqual(self.checked, ['after', 'ordinary', 'restored'])
        self.assert_restored()
        self.assertEqual(self.positions(), self.original)

    def test_crash_after_provisional_seal_resumes_only_ordinary_verification(self):
        self.operate('prepare')
        create = M.create
        def interrupted(path, *args):
            create(path, *args)
            if path == self.journal / 'verified.json':
                raise PowerLoss()
        with patch.object(M, 'create', side_effect=interrupted), self.assertRaises(PowerLoss):
            self.operate('apply')
        self.assertEqual(self.checked, ['after'])
        self.assertEqual(self.operate('status')['disposition'], 'verified')
        self.assertNotIn('accepted', self.reviewed()['receipts'])
        with self.assertRaisesRegex(ValueError, 'explicit reconciliation'):
            self.operate('apply')
        self.assertEqual(self.operate('reconcile')['disposition'], 'accepted')
        self.assertEqual(self.checked, ['after', 'ordinary'])

    def test_interrupted_ordinary_failure_reconciles_only_toward_original_pair(self):
        self.operate('prepare')
        self.ordinary = lambda: None
        self.interrupt_exchange_at('apply', 'config', True)
        provisional = self.operate('status')
        self.assertEqual(provisional['disposition'], 'reversing')
        self.assertEqual(set(provisional['receipts']), {'forward', 'checking', 'verified', 'reversing'})
        self.ordinary = lambda: self.fail('Cannot re-enter ordinary verification once reversal starts')
        self.assert_restored()
        self.assertEqual(self.checked, ['after', 'restored'])

    def test_wrong_provisional_link_is_rejected_by_independent_readonly_reader(self):
        self.operate('prepare')
        self.operate('apply')
        checked = self.reviewed()
        bad = dict(checked['records']['accepted'], verifiedSha256='a'*64)
        def read_bound(path, pin):
            if path.name == 'accepted.json':
                return M.encoded(bad)
            return M.read(path)[0]
        with self.assertRaisesRegex(ValueError, 'phase binding'):
            M.review_receipts(self.journal, self.plan, read_bound, os.path.lexists)

    def test_verification_failure_restores_original_inodes_and_is_sticky(self):
        self.operate('prepare')
        self.expect_failure = True
        with self.assertRaises(M.Restored) as failed:
            self.operate('apply')
        self.assertEqual(self.checked, ['after', 'restored'])
        self.assertEqual(failed.exception.result['positions'], dict.fromkeys(M.ROLES, 'before'))
        self.assertEqual(set(failed.exception.result['receipts']), {'forward', 'checking', 'reversing', 'restored'})
        self.expect_failure = False
        self.assert_restored()
        self.assertNotIn('verified', self.operate('status')['receipts'])
        self.assertEqual(self.checked, ['after', 'restored'])
        with self.assertRaisesRegex(ValueError, 'already terminal'):
            self.operate('apply')

    def interrupt_exchange_at(self, action, role, reverse):
        actual = M.exchange
        def interrupted(source, spare, dirs, pair):
            actual(source, spare, dirs, pair)
            if source == self.live[role] and (self.journal / 'reversing.json').exists() == reverse:
                raise PowerLoss()
        with patch.object(M, 'exchange', side_effect=interrupted), self.assertRaises(PowerLoss):
            self.operate(action)

    def test_partial_forward_requires_explicit_reconciliation(self):
        self.operate('prepare')
        self.interrupt_exchange_at('apply', 'state', False)
        self.assertEqual(self.operate('status')['positions'], {'config': 'before', 'state': 'after'})
        with self.assertRaisesRegex(ValueError, 'explicit reconciliation'):
            self.operate('apply')
        self.assertEqual(self.operate('reconcile')['disposition'], 'accepted')
        self.assertEqual(self.checked, ['after', 'ordinary'])

    def test_interrupted_last_forward_exchange_resyncs_both_parents(self):
        self.operate('prepare')
        self.interrupt_exchange_at('apply', 'config', False)
        with patch.object(M, 'sync', wraps=M.sync) as sync:
            self.assertEqual(self.operate('reconcile')['disposition'], 'accepted')
            self.assertTrue({p.parent for p in self.live.values()} | {self.journal}
                            <= {c.args[0] for c in sync.call_args_list})

    def test_partial_reversal_cannot_resume_forward(self):
        self.expect_failure = True
        self.operate('prepare')
        self.interrupt_exchange_at('apply', 'config', True)
        partial = self.operate('status')
        self.assertEqual(partial['disposition'], 'reversing')
        self.assertEqual(partial['positions'], {'config': 'before', 'state': 'after'})
        self.expect_failure = False
        self.assert_restored()
        self.assertEqual(self.checked, ['after', 'restored'])

    def test_restored_positions_before_terminal_must_be_reread(self):
        self.operate('prepare')
        self.expect_failure = True
        self.interrupt_exchange_at('apply', 'state', True)
        self.assertEqual(self.operate('status')['positions'], dict.fromkeys(M.ROLES, 'before'))
        with patch.object(M, 'sync', wraps=M.sync) as sync:
            self.assert_restored()
            self.assertTrue({p.parent for p in self.live.values()} | {self.journal}
                            <= {c.args[0] for c in sync.call_args_list})

    def test_duplicate_content_is_not_an_owned_inode(self):
        self.operate('prepare')
        original = self.live['state']
        original.rename(original.with_name('retained-original'))
        original.write_bytes(self.original['state'])
        original.chmod(0o600)
        with self.assertRaisesRegex(ValueError, 'Unowned recovery inode'):
            self.operate('apply')
        self.assertFalse((self.journal / 'forward.json').exists())
        self.assertTrue(original.with_name('retained-original').exists())

    def test_unknown_files_after_success_are_never_overwritten(self):
        self.operate('prepare')
        self.operate('apply')
        path = self.live['state']
        path.write_bytes(b'foreign')
        for action in ('status', 'apply', 'reconcile'):
            with self.assertRaisesRegex(ValueError, 'Unowned recovery inode'):
                self.operate(action)
        self.assertEqual(path.read_bytes(), b'foreign')
        self.assertFalse((self.journal / 'reversing.json').exists())

    def test_foreign_inode_after_verifier_failure_is_never_restored_over(self):
        self.operate('prepare')
        def drift():
            p = self.live['state']
            p.rename(p.with_name('foreign-renamed-candidate'))
            p.write_bytes(b'unrelated')
            p.chmod(0o600)
            raise ValueError('Post-write drift')
        self.after_check = drift
        with self.assertRaisesRegex(ValueError, 'Unowned recovery inode'):
            self.operate('apply')
        self.assertEqual(self.live['state'].read_bytes(), b'unrelated')
        self.assertFalse((self.journal / 'restored.json').exists())

    def test_lock_required_for_each_action(self):
        self.lock = False
        with self.assertRaisesRegex(ValueError, 'No deployment lock'):
            self.operate('prepare')
        self.assertFalse(self.journal.exists())
        self.lock = True
        self.operate('prepare')
        self.lock = False
        for action in ('status', 'apply', 'reconcile'):
            with self.assertRaisesRegex(ValueError, 'No deployment lock'):
                self.operate(action)
        self.assertEqual(self.positions(), self.original)

    def test_wrong_scope_and_plan_fail_before_exchange(self):
        proper = self.journal
        self.journal = self.root / 'other' / 'exchange'
        with self.assertRaisesRegex(ValueError, 'Wrong recovery exchange journal'):
            self.operate('prepare')
        self.journal = proper
        self.operate('prepare')
        self.plan = '3' * 64
        with self.assertRaisesRegex(ValueError, 'custody or plan differs'):
            self.operate('apply')
        self.assertEqual(self.positions(), self.original)

    def test_different_filesystem_refused_before_preparation(self):
        actual = M.directory
        def mounted(path, private=False):
            identity = actual(path, private)
            if path == self.live['state'].parent:
                identity[0] += 1
            return identity
        with patch.object(M, 'directory', side_effect=mounted), self.assertRaisesRegex(ValueError, 'Cross-filesystem'):
            self.operate('prepare')
        self.assertFalse(self.journal.exists())
        self.assertEqual(self.positions(), self.original)

    def test_same_bytes_wrong_inode_refuses_before_prepare(self):
        live = self.live['config']
        live.rename(live.with_name('preserved-remote-inode'))
        live.write_bytes(self.original['config'])
        live.chmod(0o600)
        with self.assertRaisesRegex(ValueError, 'Original failed-341 input differs'):
            self.operate('prepare')
        self.assertFalse(self.journal.exists())

    def test_named_inode_is_checked_on_the_open_parent_descriptors(self):
        self.operate('prepare')
        actual = M.exchange
        def replace_at_syscall(left, right, dirs, pair):
            right.rename(right.with_name('unexpected-relink'))
            right.write_bytes(self.after['state'])
            right.chmod(0o600)
            actual(left, right, dirs, pair)
        with patch.object(M, 'exchange', side_effect=replace_at_syscall), self.assertRaisesRegex(ValueError, 'Unowned recovery inode'):
            self.operate('apply')
        self.assertEqual({k: M.read(p)[1] for k,p in self.live.items()}, self.old_ids)

    def test_unsealed_initial_preparation_never_changes_live_files(self):
        self.journal.mkdir(mode=0o700)
        (self.journal / 'state').touch(mode=0o600)
        for action in ('status', 'apply', 'reconcile'):
            with self.assertRaisesRegex(ValueError, 'Unsealed or foreign'):
                self.operate(action)
        self.assertEqual(self.positions(), self.original)

    def test_conflicting_terminal_evidence_is_refused(self):
        self.operate('prepare')
        self.operate('apply')
        p = self.journal / 'verified.json'
        value = json.loads(p.read_bytes())
        for marker in ('reversing', 'restored'):
            rogue = self.journal / (marker + '.json')
            data = dict(value, phase=marker)
            if marker == 'reversing':
                del data['verificationSha256']
                data['failure'] = {'type':'ValueError','messageSha256':'1'*64}
            M.create(rogue, M.encoded(data))
        with self.assertRaisesRegex(ValueError, 'Conflicting recovery phase'):
            self.operate('reconcile')
        self.assertEqual(self.positions(), self.after)


if __name__ == '__main__':
    unittest.main()
