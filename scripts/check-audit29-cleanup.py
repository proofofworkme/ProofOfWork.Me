#!/usr/bin/env python3
"""Exact-scope and partial-failure tests; temporary fixtures only."""
from pathlib import Path
import hashlib
import json
import runpy
import tempfile
import unittest
import os
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
MODULE = runpy.run_path(str(ROOT / 'deploy/audit29/cleanup-exact.py'))


def fixture():
    rows = []
    for prefix, parent, kind, count in (
        ('proofofwork-www-pre-', '/var/backups/proofofwork-ui/rollback-roots', 'redundant-rollback-root', 15),
        ('proofofwork-ui-source-', '/var/tmp/proofofwork-deploy', 'rebuildable-clean-source', 11)):
        for index in range(count):
            path = parent + '/' + prefix + 'fixture-' + str(index)
            rows.append({'path':path,'kind':kind,'fingerprint':{'path':path,'sha256':hashlib.sha256(path.encode()).hexdigest()}})
    raw = json.dumps({'schema':'proof-of-work-audit29-exact-cleanup-review-v1','delete':rows}).encode()
    return rows, raw


class CleanupTests(unittest.TestCase):
    def test_exact_hash_scope_and_explicit_apply_approval(self):
        rows, raw = fixture(); digest = hashlib.sha256(raw).hexdigest()
        with patch.dict(MODULE['validate_manifest'].__globals__, EXPECTED_MANIFEST_SHA256=digest):
            self.assertEqual(MODULE['validate_manifest'](raw)[1],digest)
            with self.assertRaises(ValueError):
                MODULE['validate_manifest'](raw,'wrong',True)
            self.assertEqual(len(MODULE['validate_manifest'](raw,digest,True)[0]['delete']),26)
            for changed in (rows[:-1],rows+[rows[0]], [{**rows[0],'path':'/var/www/live'}]+rows[1:]):
                bad = json.dumps({'schema':'proof-of-work-audit29-exact-cleanup-review-v1','delete':changed}).encode()
                with self.assertRaises(ValueError):
                    MODULE['validate_manifest'](bad,digest,True)

    def test_all_preflight_checks_precede_any_removal_and_partial_result_is_durable(self):
        rows, _ = fixture(); verified=[]; removed=[]; receipts=[]
        def verify(row): verified.append(row['path'])
        def remove(path):
            self.assertGreaterEqual(len(verified),26)
            if len(removed)==2: raise OSError('fixture deletion refused')
            removed.append(str(path))
        def persist(status, retired, error): receipts.append((status,list(retired),error))
        with self.assertRaises(OSError):
            MODULE['retire_exact_rows'](rows,verify,remove,persist)
        self.assertEqual(len(removed),2)
        self.assertEqual(receipts[-1][0],'failed'); self.assertEqual(len(receipts[-1][1]),2)
        self.assertEqual(receipts[-1][2]['candidatePath'],rows[2]['path'])
        self.assertFalse(any(row[0]=='completed' for row in receipts))

    def test_preflight_failure_preserves_intent_and_removes_nothing(self):
        rows, _ = fixture(); receipts=[]; removed=[]
        def verify(row): raise ValueError('fixture content drift')
        with self.assertRaises(ValueError):
            MODULE['retire_exact_rows'](rows,verify,lambda p:removed.append(p),
                lambda status,retired,error:receipts.append((status,list(retired),error)))
        self.assertEqual(removed,[]); self.assertEqual(receipts[-1][0],'failed')
        self.assertEqual(receipts[-1][2]['phase'],'preflight-verification')

    def test_complete_run_still_requires_separate_final_keep_hold_verification(self):
        rows, _ = fixture(); verified=[]; removed=[]; receipts=[]
        retired=MODULE['retire_exact_rows'](rows,lambda r:verified.append(r['path']),lambda p:removed.append(str(p)),
            lambda status,retired,error:receipts.append((status,len(retired))))
        self.assertEqual(len(retired),26); self.assertEqual(len(verified),52)
        self.assertEqual(receipts[-1],('partial',26)); self.assertNotIn(('completed',26),receipts)

    def test_content_or_top_identity_drift_changes_fingerprint_and_links_are_not_followed(self):
        with tempfile.TemporaryDirectory(prefix='pow-cleanup-fingerprint-') as temporary:
            root=Path(temporary)/'candidate'; root.mkdir(); target=root/'bytes';target.write_bytes(b'old')
            external=Path(temporary)/'external'; external.write_bytes(b'outside');(root/'link').symlink_to(external)
            before=MODULE['fingerprint'](root);target.write_bytes(b'new')
            self.assertNotEqual(MODULE['fingerprint'](root),before);self.assertEqual(external.read_bytes(),b'outside')

    def test_protected_identity_ignores_reads_and_detects_replacement(self):
        with tempfile.TemporaryDirectory(prefix='pow-cleanup-keep-') as temporary:
            path=Path(temporary)/'protected'; path.write_bytes(b'kept')
            before=MODULE['path_identity'](path)
            path.read_bytes()
            self.assertEqual(MODULE['path_identity'](path),before)
            replacement=Path(temporary)/'replacement'; replacement.write_bytes(b'kept')
            replacement.replace(path)
            self.assertNotEqual(MODULE['path_identity'](path),before)

    def test_live_rollback_plan_must_match_all_fifteen_exact_roots(self):
        rows,_=fixture(); plan=[{'path':row['path']} for row in rows[:15]]
        MODULE['require_exact_rollback_set'](plan,rows)
        for changed in (plan[:-1],plan+[plan[0]],plan[:-1]+[{'path':'/var/backups/other'}]):
            with self.assertRaises(ValueError):
                MODULE['require_exact_rollback_set'](changed,rows)

    def test_rollback_archive_manifest_and_unique_passthrough_are_rechecked(self):
        with tempfile.TemporaryDirectory(prefix='pow-cleanup-rollback-') as temporary:
            path=Path(temporary)/'root';path.mkdir()
            manifest=path/'.proofofwork-ui-release';manifest.write_bytes(b'manifest')
            row={'path':str(path),'rollbackProvenance':{'containedRelease':'contained','commit':'commit',
                 'manifestSha256':hashlib.sha256(b'manifest').hexdigest()}}
            calls=[]
            def verified(root,archives):
                calls.append((root,archives));return {'release_id':'contained','commit':'commit'}
            def passthrough(root): return 'unique' if root==path else 'keep'
            helper={'verified_release':verified,'passthrough_fingerprint':lambda root:'keep'}
            protected={'latestRollbackPath':'/kept-rollback'}
            MODULE['verify_rollback_provenance'](row,helper,protected)
            self.assertEqual(len(calls),1)
            helper['passthrough_fingerprint']=passthrough
            with self.assertRaisesRegex(ValueError,'unique non-release'):
                MODULE['verify_rollback_provenance'](row,helper,protected)
            helper['passthrough_fingerprint']=lambda root:'keep'
            manifest.write_bytes(b'drift')
            with self.assertRaisesRegex(ValueError,'provenance changed'):
                MODULE['verify_rollback_provenance'](row,helper,protected)
            def broken_archive(root,archives): raise ValueError('archive checksum mismatch')
            helper['verified_release']=broken_archive
            with self.assertRaisesRegex(ValueError,'archive checksum'):
                MODULE['verify_rollback_provenance'](row,helper,protected)

    def absence_fixture(self):
        missing=sorted(MODULE['PREEXISTING_ABSENT_UI_PATHS'])
        held=missing+['/held-fixture-'+str(index) for index in range(284)]
        review={'retain':[{'role':'ui','path':path,'currentMetadata':{'path':path,'exists':True,'size':123}}
                          for path in held]}
        receipt={'schema':'proof-of-work-audit29-preexisting-ui-absence-v1','host':'77.42.91.106',
                 'status':'preexisting-unresolved-absence',
                 'historicalHeldReviewSha256':MODULE['EXPECTED_HELD_REVIEW_SHA256'],
                 'historicalHeldPathCount':295,'currentlyPresentPathCount':284,'missingPathCount':11,
                 'observedUtc':'2026-10-01T05:40:00Z',
                 'missing':[{'path':path,'currentlyExists':False,'historicalCurrentMetadata':{'path':path,'exists':True,'size':123}}
                            for path in missing]}
        return held,review,receipt

    def test_absence_census_is_exact_and_historical_metadata_bound(self):
        held,review,receipt=self.absence_fixture()
        self.assertEqual(MODULE['validate_preexisting_absence'](receipt,review),set(held[:11]))
        for key,value in (('status','completed'),('host','65.108.122.87'),('missingPathCount',12),
                          ('historicalHeldReviewSha256','wrong')):
            changed={**receipt,key:value}
            with self.assertRaises(ValueError):MODULE['validate_preexisting_absence'](changed,review)
        for missing in (receipt['missing'][:-1],receipt['missing']+[receipt['missing'][0]],
                        [{**receipt['missing'][0],'path':'/unapproved'}]+receipt['missing'][1:],
                        [{**receipt['missing'][0],'historicalCurrentMetadata':{'size':999}}]+receipt['missing'][1:]):
            with self.assertRaises(ValueError):
                MODULE['validate_preexisting_absence']({**receipt,'missing':missing},review)

    def test_preexisting_absence_does_not_allow_new_missing_or_reappeared_paths(self):
        held,review,receipt=self.absence_fixture(); absent=MODULE['validate_preexisting_absence'](receipt,review)
        present=set(held)-absent
        MODULE['verify_held_census'](held,absent,set(),lambda p:p in present)
        retired={held[11],held[12]};present-=retired
        MODULE['verify_held_census'](held,absent,retired,lambda p:p in present)
        self.assertEqual(len(present),282)
        with self.assertRaisesRegex(ValueError,'new unapproved'):
            MODULE['verify_held_census'](held,absent,retired,lambda p:p in present and p!=held[13])
        with self.assertRaisesRegex(ValueError,'reappeared'):
            MODULE['verify_held_census'](held,absent,retired,lambda p:p in present or p==held[0])

    def test_absence_file_requires_exact_hash_and_safe_read_without_mutation(self):
        held,review,receipt=self.absence_fixture();raw=json.dumps(receipt).encode();digest=hashlib.sha256(raw).hexdigest()
        with tempfile.TemporaryDirectory(prefix='pow-absence-receipt-')as temporary:
            path=Path(temporary)/'absence.json';path.write_bytes(raw);path.chmod(0o600)
            # Fixtures change only the private lstat/fstat owner, never expose a
            # production owner bypass or alternate evidence path contract.
            original_lstat=Path.lstat;original_fstat=os.fstat
            def root_stat(value):
                class Owned:
                    def __getattr__(self,name):return getattr(value,name)
                    st_uid=0
                return Owned()
            with patch.object(Path,'lstat',lambda p:root_stat(original_lstat(p))),patch.object(os,'fstat',lambda fd:root_stat(original_fstat(fd))):
                self.assertEqual(MODULE['read_absence_receipt'](path,digest,review),set(held[:11]))
                with self.assertRaisesRegex(ValueError,'hash differs'):
                    MODULE['read_absence_receipt'](path,'0'*64,review)
                path.chmod(0o666)
                with self.assertRaisesRegex(ValueError,'Unsafe'):
                    MODULE['read_absence_receipt'](path,digest,review)
            self.assertEqual(path.read_bytes(),raw)


if __name__=='__main__':unittest.main(verbosity=2)
