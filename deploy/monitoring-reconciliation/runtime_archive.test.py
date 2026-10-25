#!/usr/bin/env python3
import copy
import importlib.util
import json
import os
from pathlib import Path
import tempfile
import unittest
from unittest import mock
spec = importlib.util.spec_from_file_location('archive', Path(__file__).with_name('runtime_archive.py'))
m = importlib.util.module_from_spec(spec); spec.loader.exec_module(m)


class ArchiveTests(unittest.TestCase):
    def test_subsequent_archive_requires_exact_completed_receipt(self):
        path = m.BASE / ('runtime-latest-' + 'a'*12 + '-20261024T152151Z') / 'completion.json'
        archive = m.MANAGED / ('proofofwork-node-release-' + 'b'*12 + '-accepted-overlays-20261024T152151Z.tgz')
        value = {'receipt': str(path), 'archive': str(archive), 'completedAt': '2026-10-24',
                 'localBackupCreated': False, 'runtimeSourceModified': False,
                 'sourceCommit': 'a'*40, 'archiveBytes': 4, 'archiveSha256': 'c'*64}
        def check(candidate):
            with mock.patch.object(m, 'read', return_value=m.encode(candidate)) as read, \
                 mock.patch.object(m, 'metadata', return_value=(0,0,0,0,0,1,4,0,0)), \
                 mock.patch.object(m, 'file_sha', return_value='c'*64):
                result = m.previous_archive(str(path), 'd'*64)
                read.assert_called_once_with(path, 'd'*64)
                return result
        self.assertEqual(check(value), value)
        for key, replacement in [('receipt', '/elsewhere/completion.json'), ('completedAt', ''),
                                 ('localBackupCreated', True), ('runtimeSourceModified', True),
                                 ('sourceCommit', 'e'*40), ('archiveBytes', 5),
                                 ('archiveSha256', 'f'*64), ('archive', '/tmp/not-a-managed-archive.tgz')]:
            with self.subTest(key=key), self.assertRaises(ValueError):
                check({**value, key: replacement})
        for invalid_path, digest in [(str(path.parent/'other.json'), 'd'*64),
                                     ('/tmp/completion.json', 'd'*64), (str(path), 'wrong')]:
            with self.assertRaises(ValueError): m.previous_archive(invalid_path, digest)

    def test_one_previous_archive_inventory_is_still_exact_and_protected(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory); name = 'proofofwork-node-release-fixture.tgz'; archive = root/name
            archive.write_bytes(b'data'); archive.chmod(0o600)
            digest = m.sha(b'data')
            Path(str(archive)+'.sha256').write_text(digest+'  '+name+'\n')
            Path(str(archive)+'.provenance').write_text('format=proof-of-work-node-release-provenance-v2\n'
                'archive='+name+'\narchive_sha256='+digest+'\narchive_bytes=4\n')
            for suffix in ('.sha256', '.provenance'): Path(str(archive)+suffix).chmod(0o600)
            previous = {'archive': str(archive), 'archiveSha256': digest, 'archiveBytes': 4}
            real_metadata, real_read = m.metadata, m.read
            with mock.patch.object(m, 'MANAGED', root), \
                 mock.patch.object(m, 'metadata', side_effect=lambda p, links=1, owner=0: real_metadata(p, links, os.getuid())), \
                 mock.patch.object(m, 'read', side_effect=lambda p, expected=None, owner=0, links=1: real_read(p, expected, os.getuid(), links)):
                result = m.inventory({'retain': []}, {'overlays': []}, previous)
                self.assertEqual([r['path'] for r in result], [str(archive)])
                with self.assertRaisesRegex(ValueError, 'Held/current evidence'):
                    m.inventory({'retain': [{'role': 'node', 'path': str(archive)}]}, {'overlays': []}, previous)
                with self.assertRaisesRegex(ValueError, 'Held/current evidence'):
                    m.inventory({'retain': []}, {'overlays': [{'evidence': [{'path': str(archive)}]}]}, previous)
                (root/'proofofwork-node-release-unreviewed.tgz').write_bytes(b'new')
                with self.assertRaisesRegex(ValueError, 'inventory differs'):
                    m.inventory({'retain': []}, {'overlays': []}, previous)

    def test_only_exact_completed_two_file_receipt(self):
        rows = [{'path': name, 'before': 'e'*64, 'after': 'a'*64} for name in m.TARGETS]
        manifest = {'format': 'proof-of-work-api-response-latency-scoped-runtime-v1',
                    'sourceCommit': 'b'*40, 'baselineHead': 'c'*40, 'sources': rows}
        receipt = {**manifest, 'manifestSha256': 'd'*64, 'installed': True, 'rolledBack': False,
                   'completedAt': '2026-10-24', 'rollbackRoot': '/data/receipt'}
        def check(value):
            return m.receipt_sources(manifest, value, 'd'*64, 'b'*40, Path('/data/receipt'), 'c'*40)
        self.assertEqual(set(check(receipt)), set(m.TARGETS))
        for key, value in [('rolledBack', True), ('installed', False), ('manifestSha256', 'wrong'),
                           ('sourceCommit', 'wrong'), ('completedAt', None), ('rollbackRoot', '/elsewhere')]:
            bad = copy.deepcopy(receipt); bad[key] = value
            with self.assertRaises(ValueError): check(bad)
        bad = copy.deepcopy(receipt); bad['sources'].append({'path': 'new-file', 'after': 'a'*64})
        with self.assertRaises(ValueError): check(bad)
        bad = copy.deepcopy(receipt); bad['sources'][0]['after'] = 'wrong'
        with self.assertRaises(ValueError): check(bad)

    def test_amo_new_helper_receipt_is_exact_and_cannot_replace_prior_source(self):
        family = 'proof-of-work-amo-browse-scoped-runtime-v1'
        rows = [{'path': 'server/proof-api.mjs', 'before': 'e'*64, 'after': 'a'*64},
                {'path': 'server/amo-browse-snapshot.mjs', 'before': None, 'after': 'f'*64}]
        manifest = {'format': family, 'sourceCommit': 'b'*40, 'baselineHead': 'c'*40, 'sources': rows}
        receipt = {**copy.deepcopy(manifest), 'manifestSha256': 'd'*64, 'installed': True,
                   'rolledBack': False, 'completedAt': '2026-10-25', 'rollbackRoot': '/data/receipt'}
        def check(candidate, result=None):
            return m.receipt_sources(candidate, result or receipt, 'd'*64, 'b'*40, Path('/data/receipt'), 'c'*40)
        accepted = {'server/proof-api.mjs': {'sha256': 'e'*64},
                    'server/db/proof-index-reader.mjs': {'sha256': '9'*64}}
        bound = check(manifest)
        m.require_overlay_extension(bound, accepted, family)
        self.assertEqual(accepted['server/db/proof-index-reader.mjs']['sha256'], '9'*64)
        for key, replacement in [('format', 'unreviewed-runtime'), ('sources', rows[:1]),
                                 ('sources', rows + [{'path': 'server/other.mjs', 'after': 'a'*64}])]:
            bad = copy.deepcopy(manifest); bad[key] = replacement
            with self.subTest(key=key), self.assertRaises(ValueError): check(bad)
        bad = copy.deepcopy(receipt); bad['format'] = 'proof-of-work-api-response-latency-scoped-runtime-v1'
        with self.assertRaises(ValueError): check(manifest, bad)
        bad = copy.deepcopy(manifest); bad['sources'][1]['before'] = '8'*64
        result = {**receipt, 'sources': bad['sources']}
        with self.assertRaisesRegex(ValueError, 'absent baseline'): check(bad, result)
        result = copy.deepcopy(receipt); result['sources'][0]['before'] = '8'*64
        with self.assertRaisesRegex(ValueError, 'hash differs'): check(manifest, result)
        bad = copy.deepcopy(manifest); del bad['sources'][1]['before']
        with self.assertRaisesRegex(ValueError, 'hash differs'): check(bad)
        with self.assertRaisesRegex(ValueError, 'cannot replace'):
            m.require_overlay_extension(bound, {**accepted, 'server/amo-browse-snapshot.mjs': {'sha256': '8'*64}}, family)
        with self.assertRaisesRegex(ValueError, 'extend accepted'):
            m.require_overlay_extension(bound, {**accepted, 'server/proof-api.mjs': {'sha256': '8'*64}}, family)

    def test_safe_metadata_refuses_links_and_permissions(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory)/'evidence'; path.write_text('receipt'); path.chmod(0o600)
            self.assertEqual(m.read(path, m.sha(b'receipt'), owner=os.getuid()), b'receipt')
            with self.assertRaises(ValueError): m.read(path, 'wrong', owner=os.getuid())
            alias = Path(directory)/'alias'; alias.symlink_to(path)
            with self.assertRaises(ValueError): m.read(alias, owner=os.getuid())
            alias.unlink(); os.link(path, alias)
            with self.assertRaises(ValueError): m.read(path, owner=os.getuid())
            alias.unlink(); path.chmod(0o666)
            with self.assertRaises(ValueError): m.read(path, owner=os.getuid())

    def test_unknown_archive_blocks_retirement(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root/'proofofwork-node-release-unreviewed.tgz').write_bytes(b'data')
            with mock.patch.object(m, 'MANAGED', root):
                with self.assertRaisesRegex(ValueError, 'inventory differs'):
                    m.inventory({'retain': []}, {'overlays': []})

    def test_held_archive_blocks_retirement(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory); path = root / 'proofofwork-node-release-fixture.tgz'
            path.write_bytes(b'data'); path.chmod(0o600)
            held = {'retain': [{'role': 'node', 'path': str(path)}]}
            real_metadata = m.metadata
            with mock.patch.object(m, 'MANAGED', root), mock.patch.object(m, 'OLD', (path.name,)), \
                 mock.patch.object(m, 'metadata', side_effect=lambda p, links=1: real_metadata(p, links, os.getuid())):
                with self.assertRaisesRegex(ValueError, 'Held/current evidence'):
                    m.inventory(held, {'overlays': []})

if __name__ == '__main__': unittest.main()
