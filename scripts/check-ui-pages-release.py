#!/usr/bin/env python3
"""Exercise the V3 20 -> V4 21 UI release using temporary local roots only."""
import hashlib
import importlib.util
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import unittest

sys.dont_write_bytecode = True
ROOT = Path(__file__).resolve().parents[1]


def module(name, path):
    spec = importlib.util.spec_from_file_location(name, path)
    value = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(value)
    return value


stage = module('pages_release_stage', ROOT / 'deploy/proofofwork-ui-release-stage.py')
builder = module('pages_release_build', ROOT / 'deploy/publish/build.py')


def write(path, content):
    missing = []
    parent = path.parent
    while not parent.exists():
        missing.append(parent)
        parent = parent.parent
    for directory in reversed(missing):
        directory.mkdir(mode=0o755)
    path.write_text(content)
    path.chmod(0o644)


class PagesRelease(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory(prefix='pow-ui-pages-release-')
        self.base = Path(self.temporary.name)
        self.www = self.base / 'www'
        self.staging = self.base / 'staging'
        self.archives = self.base / 'archives'
        self.rollbacks = self.base / 'rollback-roots'
        self.helpers = self.base / 'helpers'
        for path in [self.www, self.staging, self.archives, self.rollbacks, self.helpers]:
            path.mkdir(mode=0o755)
        for filename in ['proofofwork-ui-capacity.py', 'proofofwork-ui-release-provenance.sh',
                         'proofofwork-ui-retained-root.py']:
            target = self.helpers / filename
            shutil.copyfile(ROOT / 'deploy' / filename, target)
            target.chmod(0o700)
        self.env = {**os.environ, 'POW_UI_ALLOW_TEST_ROOTS': '1',
                    'POW_UI_CAPACITY_SCRIPT': str(self.helpers / 'proofofwork-ui-capacity.py'),
                    'POW_UI_DEPLOY_LOCK': str(self.base / 'deploy.lock'),
                    'POW_UI_RELEASE_ARCHIVE_ROOT': str(self.archives),
                    'POW_UI_WWW_ROOT': str(self.www),
                    'POW_UI_STAGE_WWW_ROOT': str(self.www),
                    'POW_UI_STAGE_STAGING_ROOT': str(self.staging),
                    'POW_UI_PUBLISH_WWW_ROOT': str(self.www),
                    'POW_UI_PUBLISH_STAGING_ROOT': str(self.staging),
                    'POW_UI_PUBLISH_ROLLBACK_ROOT': str(self.rollbacks),
                    'POW_UI_PUBLISH_PROVENANCE_SCRIPT': str(self.helpers / 'proofofwork-ui-release-provenance.sh'),
                    'POW_UI_RETAINED_ROOT_SCRIPT': str(self.helpers / 'proofofwork-ui-retained-root.py')}
        self.source = self.base / 'source'
        self.source.mkdir(mode=0o755)
        write(self.source / '.gitignore', 'node_modules/\n')
        write(self.source / 'source.txt', 'exact source fixture\n')
        self.run_command(['git', '-C', str(self.source), 'init', '--quiet'])
        self.run_command(['git', '-C', str(self.source), 'config', 'user.name', 'Pages Release Fixture'])
        self.run_command(['git', '-C', str(self.source), 'config', 'user.email', 'pages-release@invalid.example'])
        self.run_command(['git', '-C', str(self.source), 'add', '.gitignore', 'source.txt'])
        self.run_command(['git', '-C', str(self.source), 'commit', '--quiet', '-m', 'fixture'])
        self.run_command(['git', '-C', str(self.source), 'checkout', '--quiet', '--detach', 'HEAD'])
        self.run_command(['chmod', '--recursive', 'go-w', str(self.source)])
        self.commit = self.run_command(['git', '-C', str(self.source), 'rev-parse', 'HEAD']).stdout.strip()
        write(self.source / 'node_modules/fixture/index.js', 'export const dependency = true;\n')
        self.baseline_id = self.commit[:12] + '-20261008T010000Z'
        self.release_id = self.commit[:12] + '-20261008T010001Z'
        self.provenance = str(self.helpers / 'proofofwork-ui-release-provenance.sh')

    def tearDown(self):
        self.temporary.cleanup()

    def run_command(self, args, environment=None, success=True):
        result = subprocess.run(args, cwd=ROOT, env={**self.env, **(environment or {})},
                                capture_output=True, text=True, timeout=90)
        if success:
            self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        else:
            self.assertNotEqual(result.returncode, 0, result.stdout + result.stderr)
        return result

    def populate(self, root, surfaces, managed=False, tag='old'):
        for surface in surfaces:
            directory = root / (('proofofwork-' if managed else '') + surface)
            write(directory / 'index.html', '<script src="/assets/' + tag + '.js"></script>')
            write(directory / 'assets' / (tag + '.js'), 'export const surface = ' + repr(surface if surface != 'nft' else 'computer') + ';\n')

    def archive(self, root, surfaces, release):
        payload = self.base / ('archive-' + release)
        (payload / 'surfaces').mkdir(parents=True, mode=0o755)
        for surface in surfaces:
            shutil.copytree(root / ('proofofwork-' + surface), payload / 'surfaces' / surface)
        archive = self.archives / ('proofofwork-ui-release-' + release + '.tgz')
        self.run_command(['tar', '--create', '--gzip', '--hard-dereference', '--file', str(archive),
                          '--directory', str(payload), 'surfaces'])
        archive.chmod(0o644)
        digest = hashlib.sha256(archive.read_bytes()).hexdigest()
        write(Path(str(archive) + '.sha256'), digest + '  ' + archive.name + '\n')
        return archive

    def record(self, release, archive, source=None):
        return self.run_command([self.provenance, 'record', '--release-id', release,
                                 '--commit', self.commit, '--source-checkout', str(source or self.source),
                                 '--archive', str(archive)])

    def stage(self, release, surfaces, tag='new', success=True):
        payload = self.staging / ('proofofwork-ui-surfaces-' + release) / 'surfaces'
        self.populate(payload, surfaces, tag=tag)
        candidate = self.staging / ('proofofwork-www-stage-' + release)
        result = self.run_command([sys.executable, '-B', str(ROOT / 'deploy/proofofwork-ui-release-stage.py'),
                                  '--release-id', release, '--surfaces-root', str(payload),
                                  '--stage-root', str(candidate), '--deduplicate-managed-files'], success=success)
        return candidate, result

    def test_exact_build_contract_and_payload_sets(self):
        self.assertEqual(len(stage.SURFACES), 20)
        self.assertEqual(set(stage.PAGES_SURFACES), set(stage.SURFACES) | {'pages'})
        self.assertEqual(set(builder.PAGES_SURFACES) | {'nft'}, set(stage.PAGES_SURFACES))
        self.assertEqual(builder.PAGES_SURFACES['pages'], ('pages', 'VITE_PAGES_ONLY'))
        self.assertEqual(set(builder.SURFACES) | {'nft'}, set(stage.SURFACES))
        payload = self.base / 'payload'
        payload.mkdir(mode=0o755)
        for surface in stage.SURFACES:
            (payload / surface).mkdir(mode=0o755)
        self.assertEqual(stage.payload_surface_names(payload), stage.SURFACES)
        (payload / 'pages').mkdir(mode=0o755)
        self.assertEqual(stage.payload_surface_names(payload), stage.PAGES_SURFACES)
        (payload / 'unknown').mkdir(mode=0o755)
        with self.assertRaisesRegex(stage.StageError, 'exactly the V3 20 or V4 21'):
            stage.payload_surface_names(payload)

    def test_v4_publication_preserves_v3_rollback_and_refuses_cross_version_payloads(self):
        self.populate(self.www, stage.SURFACES, managed=True)
        write(self.www / 'operator-evidence/keep.txt', 'preserve complete passthrough\n')
        baseline_archive = self.archive(self.www, stage.SURFACES, self.baseline_id)
        self.record(self.baseline_id, baseline_archive)
        self.run_command([self.provenance, 'verify'])

        prior = stage.tree_fingerprint(self.www)
        prior_identity = (self.www.stat().st_dev, self.www.stat().st_ino)
        candidate, _ = self.stage(self.release_id, stage.PAGES_SURFACES)
        self.assertEqual(stage.tree_fingerprint(self.www), prior)
        for surface in stage.SURFACES:
            self.assertTrue((candidate / ('proofofwork-' + surface) / 'assets/old.js').is_file())
        self.assertFalse((candidate / 'proofofwork-pages/assets/old.js').exists())
        archive = self.archive(candidate, stage.PAGES_SURFACES, self.release_id)
        source = self.staging / ('proofofwork-ui-source-' + self.release_id)
        shutil.copytree(self.source, source)
        publish_args = [str(ROOT / 'deploy/proofofwork-ui-release-publish.sh'), '--release-id', self.release_id,
                        '--commit', self.commit, '--source-checkout', str(source), '--archive', str(archive),
                        '--defer-verified-retention']
        failure = self.run_command(publish_args, {'POW_UI_PUBLISH_TEST_FAIL_AFTER_SWAP': '1'}, success=False)
        self.assertIn('Injected', failure.stderr)
        self.assertEqual(stage.tree_fingerprint(self.www), prior)
        self.assertEqual((self.www.stat().st_dev, self.www.stat().st_ino), prior_identity)
        self.assertTrue(candidate.is_dir())
        self.run_command([self.provenance, 'verify-rollback'])
        self.run_command(publish_args)
        self.run_command([self.provenance, 'verify'])
        fields = (self.www / '.proofofwork-ui-release').read_text()
        self.assertIn('format=proofofwork-ui-release-v4\n', fields)
        self.assertEqual(sum(line.startswith('surface.') and line.endswith('.file_count=3') for line in fields.splitlines()), 20)
        self.assertIn('surface.pages.file_count=2\n', fields)
        rollback = self.rollbacks / ('proofofwork-www-pre-' + self.release_id)
        self.assertEqual(stage.tree_fingerprint(rollback), prior)
        self.run_command([self.provenance, 'verify-rollback'], {'POW_UI_WWW_ROOT': str(rollback), 'POW_UI_RETAINED_ROOT': '1'})
        future, _ = self.stage(self.commit[:12] + '-20261008T010003Z', stage.PAGES_SURFACES, tag='future')
        self.assertEqual((future / 'proofofwork-pages/assets/new.js').read_bytes(),
                         (self.www / 'proofofwork-pages/assets/new.js').read_bytes())
        self.assertTrue((future / 'proofofwork-pages/assets/future.js').is_file())
        downgrade, rejected = self.stage(self.commit[:12] + '-20261008T010002Z', stage.SURFACES, success=False)
        self.assertIn('V3 payload cannot replace', rejected.stderr)
        self.assertFalse(downgrade.exists())
        manifest = self.www / '.proofofwork-ui-release'
        manifest.write_text(fields.replace('proofofwork-ui-release-v4', 'proofofwork-ui-release-v3'))
        rejected = self.run_command([self.provenance, 'verify'], success=False)
        self.assertIn('V3 UI release manifest cannot contain Pages', rejected.stderr)
        manifest.write_text('\n'.join(line for line in fields.splitlines() if not line.startswith('surface.pages.')) + '\n')
        rejected = self.run_command([self.provenance, 'verify'], success=False)
        self.assertIn('V4 UI release manifest is missing surface evidence: pages', rejected.stderr)
        manifest.write_text(fields)
        pages_asset = self.www / 'proofofwork-pages/assets/new.js'
        original = pages_asset.read_bytes()
        pages_asset.write_bytes(b'corrupt Pages bytes\n')
        self.run_command([self.provenance, 'verify'], success=False)
        pages_asset.write_bytes(original)
        self.run_command([self.provenance, 'verify'])

    def test_v3_archive_cannot_hide_unattributed_pages_payload(self):
        self.populate(self.www, stage.PAGES_SURFACES, managed=True)
        archive = self.archive(self.www, stage.PAGES_SURFACES, self.baseline_id)
        shutil.rmtree(self.www / 'proofofwork-pages')
        rejected = self.run_command([self.provenance, 'record', '--release-id', self.baseline_id,
                                     '--commit', self.commit, '--source-checkout', str(self.source),
                                     '--archive', str(archive)], success=False)
        self.assertIn('unexpected Pages payload without V4 evidence', rejected.stderr)
        self.assertFalse((self.www / '.proofofwork-ui-release').exists())
        self.assertFalse(Path(str(archive) + '.provenance').exists())


if __name__ == '__main__':
    unittest.main(verbosity=2)
