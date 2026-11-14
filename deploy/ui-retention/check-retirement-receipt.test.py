#!/usr/bin/env python3
import copy
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import tempfile
import unittest

spec = importlib.util.spec_from_file_location('retirement_receipt',
    Path(__file__).with_name('retirement_receipt.py'))
R = importlib.util.module_from_spec(spec)
spec.loader.exec_module(R)
H = '1' * 64

def prepare():
    return {'proposalSha256': R.PROPOSAL_SHA, 'inventorySha256': R.INVENTORY_SHA,
            'restoreSha256': R.RESTORE_SHA, 'approvalSha256': H,
            'preflightSha256': '2' * 64, 'pair': R.PAIR.copy()}

def chain():
    values = [('prepared', prepare())]
    for i, path in enumerate(R.PATHS):
        values += [('action-started', {'path': path, 'index': i, 'freshFenceSha256': H, 'frozenInventorySha256': H}),
                   ('action-reconciled', {'path': path, 'index': i,
                     'absenceProofSha256': H, 'preservationProofSha256': H})]
    values += [('completed', {k: H for k in ('finalFenceSha256',
        'retainedPairProofSha256', 'sidecarsProofSha256',
        'historicalEvidenceProofSha256', 'successorPolicyCodeSha256')})]
    records = []
    for event, data in values:
        records.append({'sequence': len(records), 'previousSha256':
            R.digest(R.encoded(records[-1])) if records else None,
            'event': event, 'data': data})
    return records

class TestRetirement(unittest.TestCase):
    def test_journal_read_preserves_stale_atime(self):
        with tempfile.TemporaryDirectory() as d:
            with R.Journal(d) as journal:
                journal.append('prepared', prepare())
                path = Path(d) / '0000.json'
                info = path.stat()
                os.utime(path, ns=(1, info.st_mtime_ns))
                before = path.stat()
                self.assertEqual(len(journal.read()), 1)
                self.assertEqual(path.stat(), before)

    def test_exact_scope(self):
        self.assertEqual(len(R.PATHS), 4)
        self.assertEqual(len(set(R.PATHS)), 4)
        for p in R.PATHS:
            self.assertNotIn('pre-064b699', p)
            self.assertNotIn('release-e2669', p)

    def test_complete_chain(self):
        self.assertEqual(R.validate_chain(chain())['status'], 'complete')

    def test_uncertain_requires_reconciliation(self):
        records = chain()[:2]
        self.assertEqual(R.validate_chain(records)['status'], 'uncertain')
        bad = copy.deepcopy(records[1]); bad['sequence'] = 2
        bad['previousSha256'] = R.digest(R.encoded(records[-1]))
        with self.assertRaisesRegex(ValueError, 'must reconcile'):
            R.validate_chain(records + [bad])

    def test_cannot_complete_early(self):
        c = chain(); last = copy.deepcopy(c[-1]);last['sequence'] = 1
        last['previousSha256'] = R.digest(R.encoded(c[0]))
        with self.assertRaises(ValueError):R.validate_chain([c[0], last])

    def test_changed_chain(self):
        c = chain();c[2]['data']['path'] = '/var/www'
        with self.assertRaises(ValueError):R.validate_chain(c)

    def test_wrong_pair(self):
        c = chain();c[0]['data']['pair']['previous'] = '1042'
        with self.assertRaises(ValueError):R.validate_chain(c)

    def test_no_approval_bool(self):
        c = chain();c[0]['data']['approvalSha256'] = True
        with self.assertRaises(ValueError):R.validate_chain(c)

    def test_unknown_fields(self):
        c = chain();c[0]['hiddenPermission'] = True
        with self.assertRaises(ValueError):R.validate_chain(c)

    def test_no_bare_absence_acceptance(self):
        c = chain();head = R.digest(R.encoded(c[-1]))
        with self.assertRaises(ValueError):
            R.verify_retired_payload_receipt(c, head, H, lambda unused: False)

    def test_missing_verifier(self):
        c = chain();head = R.digest(R.encoded(c[-1]))
        with self.assertRaises(ValueError):
            R.verify_retired_payload_receipt(c, head, H, None)

    def test_wrong_trust_anchor(self):
        c = chain()
        with self.assertRaises(ValueError):
            R.verify_retired_payload_receipt(c, 'f'*64, H, lambda unused: True)

    def test_scoped_verified_retired_not_preserved(self):
        c = chain();head = R.digest(R.encoded(c[-1]))
        out = R.verify_retired_payload_receipt(c, head, H, lambda unused: True)
        self.assertEqual(out['model'], 'intentionally-retired-payloads-retained-evidence-v1')
        self.assertNotIn('verifiedPreservedRelease1042', out)
        self.assertEqual(out['recoveryVerification'], 'isolated-static-only')

    def test_proposal_tamper(self):
        with self.assertRaisesRegex(ValueError, 'Proposal bytes'):
            R.authenticate_proposal(b'{}', b'{}', b'{}')

    def test_restart_and_append(self):
        with tempfile.TemporaryDirectory() as d:
            with R.Journal(d) as j:
                j.append('prepared', prepare())
            with R.Journal(d) as j:
                self.assertEqual(j.read(), chain()[:1])
                for x in chain()[1:]:j.append(x['event'], x['data'])
                self.assertEqual(j.read(), chain())
                with self.assertRaises(ValueError):j.append('completed', chain()[-1]['data'])

    def test_concurrent_writer_rejected(self):
        with tempfile.TemporaryDirectory() as d:
            with R.Journal(d):
                with self.assertRaises(BlockingIOError):R.Journal(d)

    def test_symlink_record_rejected(self):
        with tempfile.TemporaryDirectory() as d:
            os.symlink('/dev/null', Path(d)/'0000.json')
            with R.Journal(d) as j:
                with self.assertRaises(OSError):j.read()

    def test_replaced_directory_stops_old_writer(self):
        with tempfile.TemporaryDirectory() as d:
            path = Path(d)/'journal';path.mkdir(mode=0o700)
            with R.Journal(path) as old:
                path.rename(Path(d)/'moved');path.mkdir(mode=0o700)
                with R.Journal(path) as current:
                    with self.assertRaisesRegex(ValueError, 'identity changed'):
                        old.append('prepared', prepare())
                    current.append('prepared', prepare())
                self.assertEqual(list((Path(d)/'moved').iterdir()), [])

    def test_directory_mode_change_stops_writer(self):
        with tempfile.TemporaryDirectory() as d:
            with R.Journal(d) as j:
                os.chmod(d, 0o750)
                with self.assertRaisesRegex(ValueError, 'identity changed'):
                    j.read()

    def test_partial_record_fails_closed(self):
        with tempfile.TemporaryDirectory() as d:
            p = Path(d)/'0000.json';p.write_text('{');p.chmod(0o600)
            with R.Journal(d) as j:
                with self.assertRaises(ValueError):j.read()

    def test_gap_fails_closed(self):
        with tempfile.TemporaryDirectory() as d:
            p=Path(d)/'0001.json';p.write_text('{}');p.chmod(0o600)
            with R.Journal(d) as j:
                with self.assertRaises(ValueError):j.read()

    def test_group_writable_directory_rejected(self):
        with tempfile.TemporaryDirectory() as d:
            os.chmod(d, 0o770)
            with self.assertRaises(ValueError):R.Journal(d)

    def test_noncanonical_record_fails_closed(self):
        with tempfile.TemporaryDirectory() as d:
            p=Path(d)/'0000.json';p.write_text(json.dumps(chain()[0]));p.chmod(0o600)
            with R.Journal(d) as j:
                with self.assertRaises(ValueError):j.read()

if __name__ == '__main__':unittest.main()
