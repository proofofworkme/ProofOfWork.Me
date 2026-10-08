#!/usr/bin/python3 -I
"""Private fixture checks for Search promotion refusal and serving prerequisites."""
import copy
import importlib.util
import os
from pathlib import Path
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[2]
spec = importlib.util.spec_from_file_location('search_install', Path(__file__).with_name('install-ui.py'))
install = importlib.util.module_from_spec(spec); spec.loader.exec_module(install)
COMMIT = 'a'*40
TREE = 'b'*40


def plan():
    return {'schema': 'proof-of-work-search-ui-install-v1', 'commit': COMMIT, 'tree': TREE,
        'releaseId': COMMIT[:12]+'-20261004T120000Z',
        'files': {name: {'beforeSha256': 'c'*64, 'afterSha256': 'd'*64} for name in install.FILES},
        'capacitySha256': 'e'*64, 'retainedSha256': 'f'*64,
        'caddyBinarySha256': '1'*64, 'caddyVersion': '2.6.2'}


def published(value):
    fields = {'format': 'proofofwork-ui-release-v3', 'release_id': value['releaseId'],
        'commit': value['commit'], 'source_tree': value['tree']}
    for name in install.SURFACES:
        fields['surface.'+name+'.file_count'] = '2'
        fields['surface.'+name+'.sha256'] = '2'*64
    return fields


def encode(fields):
    return ('\n'.join(key+'='+value for key, value in fields.items())+'\n').encode()


class SearchPromotion(unittest.TestCase):
    def test_pages_install_requires_v4_all21_and_retention_helper_pins(self):
        value = plan()
        value['schema'] = 'proof-of-work-pages-ui-install-v1'
        value['files'] = {name: {'beforeSha256': 'c'*64, 'afterSha256': 'd'*64} for name in install.PAGES_FILES}
        install.check_plan(value)
        fields = published(value)
        fields['format'] = 'proofofwork-ui-release-v4'
        fields.update({'surface.pages.file_count': '2', 'surface.pages.sha256': '2'*64})
        install.check_published(encode(fields), value)
        incomplete = copy.deepcopy(value)
        incomplete['files'].pop('deploy/proofofwork-ui-verified-retention.py')
        with self.assertRaises(ValueError): install.check_plan(incomplete)
        for key in ('surface.pages.file_count', 'surface.pages.sha256', 'surface.jobs.sha256'):
            changed = fields.copy(); changed.pop(key)
            with self.assertRaises(ValueError): install.check_published(encode(changed), value)
        changed = fields.copy(); changed['format'] = 'proofofwork-ui-release-v3'
        with self.assertRaises(ValueError): install.check_published(encode(changed), value)
        with self.assertRaises(ValueError): install.check_published(encode(fields), plan())

    def test_exact_scope_and_complete_before_after_pins_are_required(self):
        value = plan(); install.check_plan(value)
        cases = []
        extra = copy.deepcopy(value); extra['files']['deploy/unapproved'] = extra['files']['deploy/Caddyfile']; cases.append(extra)
        missing = copy.deepcopy(value); missing['files'].pop('deploy/Caddyfile'); cases.append(missing)
        unbound = copy.deepcopy(value); unbound['files']['deploy/Caddyfile'].pop('beforeSha256'); cases.append(unbound)
        wrong = copy.deepcopy(value); wrong['releaseId'] = '3'*12+'-20261004T120000Z'; cases.append(wrong)
        version = copy.deepcopy(value); version['caddyVersion'] = 'v2.6.2'; cases.append(version)
        for candidate in cases:
            with self.subTest(candidate=candidate), self.assertRaises(ValueError):
                install.check_plan(candidate)

    def test_reload_requires_same_release_commit_tree_and_all_twenty_roots(self):
        value = plan(); fields = published(value); install.check_published(encode(fields), value)
        cases = []
        for key in ('commit', 'source_tree', 'release_id'):
            changed = fields.copy(); changed[key] = 'changed'; cases.append(changed)
        legacy = {key: data for key, data in fields.items() if not key.startswith('surface.search.')}; cases.append(legacy)
        alias = fields.copy(); alias['surface.nft.sha256'] = '0'*64; cases.append(alias)
        unknown = fields.copy(); unknown['surface.unapproved.sha256'] = '2'*64; cases.append(unknown)
        incomplete = fields.copy(); incomplete['surface.search.file_count'] = '0'; cases.append(incomplete)
        for candidate in cases:
            with self.subTest(candidate=candidate), self.assertRaises(ValueError):
                install.check_published(encode(candidate), value)

    def test_duplicate_manifest_fields_cannot_authorize_reload(self):
        with self.assertRaisesRegex(ValueError, 'Duplicate'):
            install.parse_manifest(b'commit=a\ncommit=b\n')

    def test_safe_reads_refuse_aliases_group_write_hardlinks_and_oversized_files(self):
        with tempfile.TemporaryDirectory(prefix='pow-search-install-', dir='/tmp') as name:
            root = Path(name).resolve(); source = root/'source'; source.write_bytes(b'prior bytes'); source.chmod(0o600)
            raw, before = install.read_safe(source, owner=os.geteuid()); self.assertEqual(raw, b'prior bytes')
            self.assertEqual(before.st_atime_ns, source.stat().st_atime_ns)
            with self.assertRaisesRegex(ValueError, 'Unsafe'):
                install.read_safe(source, limit=2, owner=os.geteuid())
            source.chmod(0o660)
            with self.assertRaisesRegex(ValueError, 'Unsafe'):
                install.read_safe(source, owner=os.geteuid())
            source.chmod(0o600); alias = root/'alias'; alias.symlink_to(source)
            with self.assertRaisesRegex(ValueError, 'Unsafe'):
                install.read_safe(alias, owner=os.geteuid())
            hard = root/'hard'; os.link(source, hard)
            with self.assertRaisesRegex(ValueError, 'Unsafe'):
                install.read_safe(source, owner=os.geteuid())
            self.assertEqual(install.read_safe(source, owner=os.geteuid(), shared=True)[0], b'prior bytes')

    def test_creation_only_receipts_and_atomic_replacement_preserve_prior_bytes(self):
        with tempfile.TemporaryDirectory(prefix='pow-search-install-', dir='/tmp') as name:
            root = Path(name); receipt = root/'previous'; target = root/'installed'
            install.save(receipt, b'old'); target.write_bytes(b'old')
            with self.assertRaises(FileExistsError):
                install.save(receipt, b'new')
            install.replace(target, b'new', 0o644, 'fixture')
            self.assertEqual(receipt.read_bytes(), b'old'); self.assertEqual(target.read_bytes(), b'new')
            install.replace(target, receipt.read_bytes(), 0o600, 'rollback')
            self.assertEqual(target.read_bytes(), b'old'); self.assertEqual(target.stat().st_mode & 0o777, 0o600)

    def test_caddy_validation_and_provenance_precede_install_and_reload(self):
        text = Path(__file__).with_name('install-ui.py').read_text()
        self.assertLess(text.index("check_published(read_safe"), text.index('output.mkdir'))
        self.assertLess(text.index("'verify'], descriptor"), text.index('output.mkdir'))
        self.assertLess(text.index("'validate', '--config'"), text.index('output.mkdir'))
        self.assertLess(text.index('installed.append(name)'), text.index('replace(target, after[name]'))
        self.assertIn("states(descriptor) == baseline", text)
        self.assertIn("current in (before[name][0], after[name])", text)
        self.assertIn("before[name][1], output.name+'-rollback'", text)

    def test_search_timer_is_bounded_and_independent_from_economic_services(self):
        service = (ROOT/'deploy/proofofwork-search-index.service').read_text()
        timer = (ROOT/'deploy/proofofwork-search-index.timer').read_text()
        for required in ('Type=oneshot', 'User=powadmin', 'POW_INDEX_DB_POOL_MAX=1',
            '--batch-size=200 --max-batches=20 --budget-ms=30000', 'TimeoutStartSec=45s',
            'MemoryMax=512M', 'MemorySwapMax=0', 'ProtectSystem=strict'):
            self.assertIn(required, service)
        for forbidden in ('PartOf=', 'OnFailure=', 'proofofwork-api.service',
            'proofofwork-indexer-worker.service', 'internal-verifier.env', 'Restart='):
            self.assertNotIn(forbidden, service)
        self.assertIn('OnUnitInactiveSec=30s', timer)
        self.assertIn('Unit=proofofwork-search-index.service', timer)


if __name__ == '__main__':
    unittest.main(verbosity=2)
