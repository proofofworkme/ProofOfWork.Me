#!/usr/bin/python3
"""Exercise the exact release-health metadata predicate, without production paths."""
from pathlib import Path
import os
import re
import subprocess
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]
SOURCE = (ROOT / 'deploy/proofofwork-node-release-health.sh').read_text()
MATCH = re.search(r'      if \(\(8#\$\{file_mode\} & 07022\)\) \|\|.*?; then', SOURCE, re.S)
assert MATCH, 'Exact verifier mode predicate missing'
PREDICATE = MATCH.group(0).strip()

class ModeTests(unittest.TestCase):
    def check_mode(self, tracked, mode):
        with tempfile.TemporaryDirectory(prefix='pow-mode-fixture-') as directory:
            file = Path(directory) / 'commit-msg'
            file.write_text('#!/bin/sh\nexit 0\n')
            file.chmod(mode)
            script = 'set -eu\ntracked_mode="$1"\nlive_path="$2"\nfile_mode="$(stat --format=%a -- "$live_path")"\n'
            script += PREDICATE + '\n exit 2\nfi\n'
            return subprocess.run(['/bin/bash', '-c', script, 'fixture', tracked, str(file)], capture_output=True).returncode

    def test_owner_executable_class_survives_restricted_verifier_identity(self):
        self.assertNotIn(' -x ', PREDICATE)
        for mode in (0o700, 0o750, 0o755, 0o500):
            with self.subTest(mode=oct(mode)):
                self.assertEqual(self.check_mode('100755', mode), 0)

    def test_missing_execute_is_rejected(self):
        for mode in (0o600, 0o640, 0o644):
            self.assertEqual(self.check_mode('100755', mode), 2)

    def test_unexpected_execute_is_rejected(self):
        for mode in (0o700, 0o750, 0o755):
            self.assertEqual(self.check_mode('100644', mode), 2)
        self.assertEqual(self.check_mode('100644', 0o640), 0)

    def test_unsafe_modes_still_rejected(self):
        for mode in (0o770, 0o757, 0o4750, 0o2750, 0o1750):
            self.assertEqual(self.check_mode('100755', mode), 2)
        for mode in (0o660, 0o646, 0o4644):
            self.assertEqual(self.check_mode('100644', mode), 2)

    def test_publisher_uses_same_permission_bit_class(self):
        publisher = (ROOT / 'deploy/proofofwork-node-release-publish.sh').read_text()
        self.assertIn('executable = bool(details.st_mode & 0o111)', publisher)
        self.assertIn('8#${file_mode} & 0111', PREDICATE)

if __name__ == '__main__':
    unittest.main(verbosity=2)
