#!/usr/bin/env python3
import importlib.util
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch

sys.dont_write_bytecode = True
spec = importlib.util.spec_from_file_location('retained', 'deploy/proofofwork-ui-retained-root.py')
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


class RetainedRootTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory(prefix='pow-ui-retained-fixture-')
        self.root = Path(self.temporary.name)
        self.manifest = self.root / '.proofofwork-ui-release'
        self.manifest.write_text('format=fixture\n')
        self.manifest.chmod(0o600)
        self.asset = self.root / 'asset.txt'
        self.asset.write_text('original')
        self.asset.chmod(0o644)

    def tearDown(self):
        self.temporary.cleanup()

    def test_stable_read_only(self):
        first = module.fingerprint(self.root)
        self.assertEqual(first, module.fingerprint(self.root))
        self.assertEqual(first['entries'], 3)
        self.assertEqual(self.asset.read_text(), 'original')

    def test_bytes_change(self):
        first = module.fingerprint(self.root)
        self.asset.write_text('tampered')
        self.assertNotEqual(first['treeSha256'], module.fingerprint(self.root)['treeSha256'])

    def test_manifest_change(self):
        first = module.fingerprint(self.root)
        self.manifest.write_text('format=changed\n')
        self.assertNotEqual(first['manifestSha256'], module.fingerprint(self.root)['manifestSha256'])

    def test_manifest_bound(self):
        self.manifest.write_bytes(b'x' * 65537)
        with self.assertRaisesRegex(ValueError, '64 KiB'):
            module.fingerprint(self.root)

    def test_manifest_replaced_before_open(self):
        original_open = os.open
        def swap_then_open(path, flags, *args, **kwargs):
            if Path(path) == self.manifest:
                self.manifest.unlink()
                self.manifest.symlink_to(self.asset)
            return original_open(path, flags, *args, **kwargs)
        with patch.object(module.os, 'open', side_effect=swap_then_open):
            with self.assertRaises(OSError): module.fingerprint(self.root)

    def test_metadata_change(self):
        first = module.fingerprint(self.root)
        self.asset.chmod(0o600)
        self.assertNotEqual(first['treeSha256'], module.fingerprint(self.root)['treeSha256'])

    def test_symlink_rejected(self):
        (self.root / 'link').symlink_to(self.asset)
        with self.assertRaises(ValueError): module.fingerprint(self.root)

    def test_writable_rejected(self):
        self.asset.chmod(0o666)
        with self.assertRaises(ValueError): module.fingerprint(self.root)

    def test_classification_mismatch(self):
        evidence = module.fingerprint(self.root)
        result = subprocess.run([sys.executable, 'deploy/proofofwork-ui-retained-root.py', str(self.root),
            '--manifest-sha256', evidence['manifestSha256'], '--tree-sha256', '0' * 64],
            env={**os.environ, 'POW_UI_ALLOW_TEST_ROOTS': '1'}, capture_output=True, text=True)
        self.assertNotEqual(result.returncode, 0)
        self.assertIn('explicit reviewed classification', result.stderr)


unittest.main()
