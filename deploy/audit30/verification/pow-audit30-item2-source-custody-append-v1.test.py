#!/usr/bin/python3 -I -B
"""Synthetic local custody invariants; no real repository apply or remote call."""
import copy
import importlib.util
import json
from pathlib import Path
import tempfile
import unittest

SOURCE = Path('/tmp/pow-audit30-item2-source-custody-append-v1.py')
spec = importlib.util.spec_from_file_location('custody_append', SOURCE)
M = importlib.util.module_from_spec(spec)
spec.loader.exec_module(M)

def old():
    return {'schema': 'pow-audit30-verification-source-custody-v1', 'atUtc': '2026-10-03T15:24:56Z',
            'files': [{'originalPath': '/tmp/old-'+str(i), 'repositoryPath': M.SCOPE+'old-'+str(i)+'.json',
                       'bytes': 1, 'sha256': 'a'*64, 'purpose': 'opaque retained history'} for i in range(1027)],
            'qualification': 'Historical failures stay failed.',
            'storedRepresentations': {str(i): {'opaque': 'unchanged'} for i in range(4)},
            'testExecutionQualification': 'Existing fixtures are synthetic.'}

def manifest():
    return {'schema': 'pow-audit30-item2-source-custody-append-manifest-v1',
            'custodyPreimage': {'path': str(M.CUSTODY.relative_to(M.ROOT)), 'bytes': M.BASE_BYTES,
                               'sha256': M.BASE_SHA, 'rows': 1027, 'storedRepresentations': 4},
            'atUtc': '2026-10-03T20:00:00Z', 'publicReviewed': True, 'privateDataIncluded': False,
            'additionalQualification': 'Dated item2 accepted public source custody.',
            'files': [{'originalPath': '/tmp/new-file.json', 'repositoryPath': M.SCOPE+'new-file.json',
                       'bytes': 2, 'sha256': 'b'*64, 'purpose': 'root-reviewed public receipt'}]}

class Custody(unittest.TestCase):
    def test_preserves_1027_opaque_rows_and_four_mappings(self):
        prior = old(); q = manifest(); after = json.loads(M.build(prior, q, lambda _: None))
        self.assertEqual(after['files'][:1027], prior['files'])
        self.assertEqual(after['storedRepresentations'], prior['storedRepresentations'])
        self.assertEqual(after['files'][1027:], q['files'])
        self.assertEqual(after['qualification'], prior['qualification']+' '+q['additionalQualification'])
        self.assertEqual(after['testExecutionQualification'], prior['testExecutionQualification'])
        self.assertEqual(len(prior['files']), 1027)

    def test_refuses_existing_and_new_duplicate(self):
        q = manifest(); q['files'][0]['repositoryPath'] = old()['files'][0]['repositoryPath']
        with self.assertRaisesRegex(ValueError, 'NEW_DUPLICATE_PATH'): M.build(old(), q, lambda _: None)
        q = manifest(); q['files'].append(copy.deepcopy(q['files'][0]))
        with self.assertRaisesRegex(ValueError, 'NEW_DUPLICATE_PATH'): M.build(old(), q, lambda _: None)

    def test_refuses_false_public_and_changed_preimage(self):
        for key, value in [('publicReviewed', False), ('privateDataIncluded', True)]:
            q = manifest(); q[key] = value
            with self.assertRaisesRegex(ValueError, 'EXPLICIT_PUBLIC_MANIFEST'): M.build(old(), q, lambda _: None)
        q = manifest(); q['custodyPreimage']['sha256'] = '0'*64
        with self.assertRaisesRegex(ValueError, 'MANIFEST_PREIMAGE'): M.build(old(), q, lambda _: None)

    def test_refuses_changed_history_scope_and_nonutc(self):
        prior = old(); prior['files'].pop()
        with self.assertRaisesRegex(ValueError, 'PREFIX_SCOPE'): M.build(prior, manifest(), lambda _: None)
        prior = old(); prior['storedRepresentations'].pop('0')
        with self.assertRaisesRegex(ValueError, 'PREFIX_SCOPE'): M.build(prior, manifest(), lambda _: None)
        q = manifest(); q['atUtc'] = '2026-10-03T20:00:00-04:00'
        with self.assertRaisesRegex(ValueError, 'UTC_APPEND_DATE'): M.build(old(), q, lambda _: None)

    def test_exact_direct_source_and_reject_raw_diff(self):
        with tempfile.TemporaryDirectory(prefix='pow-audit30-custody-fixture-', dir='/tmp') as tmp:
            saved_root, saved_custody = M.ROOT, M.CUSTODY
            try:
                M.ROOT = Path(tmp); M.CUSTODY = M.ROOT/M.SCOPE/'source-custody.json'
                target = M.ROOT/M.SCOPE/'source.mjs'; target.parent.mkdir(parents=True)
                original = M.ROOT/'original.mjs'; raw = ' exact Unicode é\n'.encode()
                original.write_bytes(raw); target.write_bytes(raw)
                row = {'originalPath': str(original), 'repositoryPath': M.SCOPE+'source.mjs',
                       'bytes': len(raw), 'sha256': M.sha(raw)}
                M.validate_new(row)
                original.write_bytes(raw+b' ')
                with self.assertRaisesRegex(ValueError, 'ORIGINAL_COPY_BYTES_DIFFER'): M.validate_new(row)
                row['repositoryPath'] = M.SCOPE+'forensic.diff'
                with self.assertRaisesRegex(ValueError, 'NEW_ROW_SCOPE'): M.validate_new(row)
            finally: M.ROOT, M.CUSTODY = saved_root, saved_custody

    def test_exact_lossless_envelope_and_refuse_changed_raw(self):
        import base64
        with tempfile.TemporaryDirectory(prefix='pow-audit30-custody-fixture-', dir='/tmp') as tmp:
            saved_root, saved_custody = M.ROOT, M.CUSTODY
            try:
                M.ROOT = Path(tmp); M.CUSTODY = M.ROOT/M.SCOPE/'source-custody.json'
                target = M.ROOT/M.SCOPE/'source.diff.evidence.json'; target.parent.mkdir(parents=True)
                original = M.ROOT/'source.diff'; raw = b'raw forensic patch\n\n'; original.write_bytes(raw)
                envelope = {'originalInput': str(original), 'rawBytes': len(raw), 'rawSha256': M.sha(raw),
                            'rawBase64': base64.b64encode(raw).decode()}
                encoded = json.dumps(envelope).encode(); target.write_bytes(encoded)
                row = {'originalPath': str(original), 'repositoryPath': M.SCOPE+'source.diff.evidence.json',
                       'bytes': len(encoded), 'sha256': M.sha(encoded), 'rawBytes': len(raw),
                       'rawSha256': M.sha(raw), 'representation': 'closed-base64-envelope-preserves-exact-raw-input'}
                M.validate_new(row)
                original.write_bytes(raw+b' ')
                with self.assertRaisesRegex(ValueError, 'ORIGINAL_ENVELOPE_BYTES_DIFFER'): M.validate_new(row)
            finally: M.ROOT, M.CUSTODY = saved_root, saved_custody

if __name__ == '__main__':
    unittest.main()
