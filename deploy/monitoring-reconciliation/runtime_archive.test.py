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
    def test_only_exact_completed_two_file_receipt(self):
        rows = [{'path': name, 'after': 'a'*64} for name in m.TARGETS]
        manifest = {'sourceCommit': 'b'*40, 'baselineHead': 'c'*40, 'sources': rows}
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
