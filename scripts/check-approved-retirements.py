#!/usr/bin/env python3
"""Completed exact retirement exceptions never relax other historical holds."""
from pathlib import Path
import copy
import hashlib
import json
import runpy
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]
MODULE = runpy.run_path(str(ROOT / 'scripts/check-retention-protection.py'))
REVIEW = json.loads((ROOT / 'audits/2026-09-29-audit28-held-review.json').read_text())


def fixtures():
    paths = [row['path'] for row in REVIEW['retain'] if row.get('role') == 'ui' and row['path'] in {
        '/var/tmp/proofofwork-deploy/proofofwork-ui-source-0e767c69e785-20260929T165314Z',
        '/var/tmp/proofofwork-deploy/proofofwork-ui-source-3bc6c9d44e00-20260929T200127Z'}]
    paths += ['/var/tmp/proofofwork-deploy/proofofwork-ui-source-fixture-' + str(i) for i in range(9)]
    paths += ['/var/backups/proofofwork-ui/rollback-roots/proofofwork-www-pre-fixture-' + str(i) for i in range(15)]
    manifest = {'schema': 'proof-of-work-audit29-exact-cleanup-review-v1',
                'delete': [{'path': path, 'fingerprint': {'path': path, 'sha256': hashlib.sha256(path.encode()).hexdigest()}} for path in paths]}
    receipt = {'schema': 'proof-of-work-audit29-completed-retirements-v1', 'host': '77.42.91.106',
               'status': 'completed', 'approvedManifestSha256': 'approved-digest',
               'historicalHeldReviewSha256': MODULE['EXPECTED_HELD_REVIEW_SHA256'],
               'retiredPathCount': 26,
               'retired': [{'path': row['path'], 'beforeFingerprintSha256': row['fingerprint']['sha256'], 'outcome': 'retired'} for row in manifest['delete']]}
    return manifest, receipt


class RetirementProtectionTests(unittest.TestCase):
    def test_complete_binding_covers_exact_two_held_paths_only(self):
        manifest, receipt = fixtures()
        retired = MODULE['validate_completed_retirements'](manifest, receipt, 'approved-digest')
        result = MODULE['held_path_protection']('ui', REVIEW, retired, lambda path: path not in retired)
        self.assertTrue(result['ok']); self.assertEqual(result['approvedRetiredHeldPaths'], 2)
        self.assertEqual(result['mustRemainPresent'], 293)
        self.assertTrue(MODULE['held_path_protection']('node', REVIEW, set(), lambda _: True)['ok'])

    def test_partial_wrong_digest_fingerprint_duplicate_or_wrong_host_fails(self):
        manifest, receipt = fixtures()
        for mutate in (lambda r: r.update(status='partial'), lambda r: r.update(approvedManifestSha256='wrong'),
                       lambda r: r.update(historicalHeldReviewSha256='wrong'), lambda r: r.update(host='node'),
                       lambda r: r['retired'].pop(), lambda r: r['retired'].append(r['retired'][0]),
                       lambda r: r['retired'][0].update(beforeFingerprintSha256='wrong')):
            bad = copy.deepcopy(receipt); mutate(bad)
            with self.assertRaises(ValueError):
                MODULE['validate_completed_retirements'](manifest, bad, 'approved-digest')

    def test_missing_unapproved_descendant_or_reappearing_root_is_not_hidden(self):
        manifest, receipt = fixtures(); retired = MODULE['validate_completed_retirements'](manifest, receipt, 'approved-digest')
        missing = next(row['path'] for row in REVIEW['retain'] if row.get('role') == 'ui' and row['path'] not in retired)
        result = MODULE['held_path_protection']('ui', REVIEW, retired, lambda path: path not in retired and path != missing)
        self.assertFalse(result['ok']); self.assertEqual(result['missingHeldPaths'], [missing])
        self.assertFalse(MODULE['held_path_protection']('ui', REVIEW, retired, lambda _: True)['ok'])
        with self.assertRaises(ValueError):
            MODULE['held_path_protection']('node', REVIEW, retired, lambda _: True)

    def test_traversal_or_category_expansion_is_rejected(self):
        manifest, receipt = fixtures()
        for path in ('/var/tmp/proofofwork-deploy/proofofwork-ui-source-test/../live', '/var/www/proofofwork-computer'):
            bad = copy.deepcopy(manifest); bad['delete'][0]['path'] = path; bad['delete'][0]['fingerprint']['path'] = path
            with self.assertRaises(ValueError):
                MODULE['validate_completed_retirements'](bad, receipt, 'approved-digest')

    def test_original_evidence_hash_is_fixed(self):
        self.assertEqual(hashlib.sha256((ROOT / 'audits/2026-09-29-audit28-held-review.json').read_bytes()).hexdigest(), MODULE['EXPECTED_HELD_REVIEW_SHA256'])

    def test_preexisting_absence_metadata_never_silences_missing_holds(self):
        manifest,receipt=fixtures()
        cleanup=runpy.run_path(str(ROOT/'deploy/audit29/cleanup-exact.py'))
        missing=set(cleanup['PREEXISTING_ABSENT_UI_PATHS'])
        receipt.update(preexistingUnresolvedHeldAbsences=sorted(missing),
                       preexistingUnresolvedHeldAbsenceCount=11,
                       preexistingUiAbsenceReceiptSha256='a'*64,
                       remainingPresentHistoricalUiHeldPaths=282,
                       retentionMonitorMustRemainFailing=True)
        retired=MODULE['validate_completed_retirements'](manifest,receipt,'approved-digest')
        result=MODULE['held_path_protection']('ui',REVIEW,retired,
                                            lambda path:path not in retired and path not in missing)
        self.assertFalse(result['ok']);self.assertEqual(set(result['missingHeldPaths']),missing)
        self.assertEqual(result['mustRemainPresent'],293)


if __name__ == '__main__':
    unittest.main(verbosity=2)
