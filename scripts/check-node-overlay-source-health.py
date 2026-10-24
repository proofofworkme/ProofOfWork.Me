#!/usr/bin/python3
"""Private Git/evidence fixtures; never connect to production."""
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import subprocess
import tempfile
import unittest
from unittest import mock

spec = importlib.util.spec_from_file_location('overlay_health',
    Path(__file__).resolve().parents[1] / 'deploy/node-overlay-source-health.py')
health = importlib.util.module_from_spec(spec)
spec.loader.exec_module(health)


class OverlayHealthTests(unittest.TestCase):
    def setUp(self):
        old_umask = os.umask(0o022)
        self.addCleanup(os.umask, old_umask)
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.base = Path(self.tmp.name)
        self.root = self.base / 'runtime'; self.root.mkdir(mode=0o700)
        self.evidence = self.base / 'retained'; self.evidence.mkdir(mode=0o700)
        self.receipt = self.evidence / 'receipt.json'
        self.receipt.write_text('{"installed":true}')
        self.manifest = self.base / 'accepted.json'
        self.git('init', '-q')
        (self.root / 'base.mjs').write_text('original\n')
        (self.root / 'unchanged.mjs').write_text('unchanged\n')
        (self.root / '.gitignore').write_text('node_modules/\nignored/\n')
        self.git('add', '.')
        self.git('-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid',
                 '-c', 'core.hooksPath=/dev/null', 'commit', '-qm', 'fixture')
        self.git('checkout', '--detach', '-q')
        (self.root / 'base.mjs').write_text('accepted edit\n')
        (self.root / 'new.mjs').write_text('accepted addition\n')
        self.value = {'format': 'pow-accepted-node-source-overlays-v1',
            'baselineHead': self.git('rev-parse', 'HEAD').strip(),
            'baselineTree': self.git('rev-parse', 'HEAD^{tree}').strip(),
            'overlays': [{'path': name, 'sha256': health.digest((self.root/name).read_bytes()),
                'gitMode': '100644', 'evidence': [{'path': str(self.receipt),
                'sha256': health.digest(self.receipt.read_bytes())}]}
                for name in ['base.mjs', 'new.mjs']]}
        self.save()

    def git(self, *args):
        return subprocess.check_output(['git', '-C', str(self.root), *args],
                                       stderr=subprocess.PIPE, text=True)

    def save(self):
        self.manifest.write_text(json.dumps(self.value))

    def verify(self):
        return health.verify(self.root, self.manifest, self.evidence, os.getuid())

    def test_accepted_overlay_is_source_only(self):
        result = self.verify()
        self.assertTrue(result['ok'])
        self.assertEqual(result['overlayCount'], 2)
        self.assertFalse(result['archiveAndDependencyCoverageVerified'])

    def test_changed_base_or_overlay_is_rejected(self):
        for name in ['base.mjs', 'new.mjs', 'unchanged.mjs']:
            with self.subTest(name=name):
                p = self.root/name; raw = p.read_bytes(); p.write_text('unapproved\n')
                with self.assertRaises(ValueError): self.verify()
                p.write_bytes(raw)

    def test_unknown_untracked_or_ignored_file_is_rejected(self):
        for name in ['extra.mjs', 'ignored/extra']:
            with self.subTest(name=name):
                p = self.root/name; p.parent.mkdir(exist_ok=True); p.write_text('extra')
                with self.assertRaises(ValueError): self.verify()
                p.unlink()

    def test_missing_or_changed_evidence_is_rejected(self):
        self.receipt.write_text('changed')
        with self.assertRaises(ValueError): self.verify()
        self.receipt.unlink()
        with self.assertRaises(FileNotFoundError): self.verify()

    def test_symlink_and_world_writable_manifest_are_rejected(self):
        target = self.base/'target'; target.write_text(self.manifest.read_text())
        self.manifest.unlink(); self.manifest.symlink_to(target)
        with self.assertRaises(ValueError): self.verify()
        self.manifest.unlink(); self.save(); self.manifest.chmod(0o666)
        with self.assertRaises(ValueError): self.verify()

    def test_duplicate_and_escaping_pins_are_rejected(self):
        self.value['overlays'].append(self.value['overlays'][0]); self.save()
        with self.assertRaises(ValueError): self.verify()
        self.value['overlays'].pop()
        self.value['overlays'][0]['path'] = '../escape'; self.save()
        with self.assertRaises(ValueError): self.verify()

    def test_mode_and_base_identity_changes_are_rejected(self):
        p = self.root/'new.mjs'; p.chmod(0o755)
        with self.assertRaises(ValueError): self.verify()
        p.chmod(0o644)
        self.value['baselineHead'] = '0'*40; self.save()
        with self.assertRaises(ValueError): self.verify()

    def test_duplicate_json_keys_are_rejected(self):
        raw = self.manifest.read_text()
        self.manifest.write_text('{"format":"untrusted",' + raw[1:])
        with self.assertRaisesRegex(ValueError, 'Duplicate JSON key'): self.verify()

    def test_del_control_character_path_is_rejected(self):
        self.value['overlays'][0]['path'] = 'bad\x7f.mjs'; self.save()
        with self.assertRaisesRegex(ValueError, 'Invalid source path'): self.verify()

    def test_mode_change_during_final_fence_is_rejected(self):
        original = health.read_regular
        target = self.root / 'new.mjs'
        reads = 0
        def change_mode(path, *args, **kwargs):
            nonlocal reads
            raw = original(path, *args, **kwargs)
            if path == target:
                reads += 1
                if reads == 2: target.chmod(0o755)
            return raw
        with mock.patch.object(health, 'read_regular', side_effect=change_mode):
            with self.assertRaisesRegex(ValueError, 'Source changed during verification'):
                self.verify()

    def test_attached_branch_is_rejected(self):
        self.git('switch', '-c', 'fixture-branch')
        with self.assertRaises(ValueError): self.verify()


if __name__ == '__main__':
    unittest.main()
