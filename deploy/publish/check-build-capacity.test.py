#!/usr/bin/env python3
"""Pure storage guard regression tests; no production path writes."""
import importlib.util
import os
import subprocess
import tempfile
from pathlib import Path
from types import SimpleNamespace
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location('builder', Path(__file__).with_name('build.py'))
b = importlib.util.module_from_spec(spec)
spec.loader.exec_module(b)

class CapacityTests(unittest.TestCase):
    def capacity(self, free, used, current=0, exists=False):
        with patch.object(b.shutil, 'disk_usage', return_value=SimpleNamespace(free=free)), \
             patch.object(b.subprocess, 'check_output', side_effect=[str(used), str(current)]), \
             patch.object(Path, 'exists', return_value=exists):
            b.check_build_capacity(b.BUILD_PARENT / 'test')

    def test_approved_finite_limits_and_exact_boundary(self):
        self.assertEqual(b.RETAINED_BUDGET, 24 * 1024**3)
        self.assertEqual(b.BUILD_BUDGET, 4 * 1024**3)
        self.assertEqual(b.DATA_RESERVE, 100 * 1024**3)
        self.capacity(b.DATA_RESERVE + b.BUILD_BUDGET,
                      b.RETAINED_BUDGET - b.BUILD_BUDGET)
        with self.assertRaises(ValueError):
            self.capacity(b.DATA_RESERVE + b.BUILD_BUDGET,
                          b.RETAINED_BUDGET - b.BUILD_BUDGET + 1)
        with self.assertRaises(ValueError):
            self.capacity(b.DATA_RESERVE + b.BUILD_BUDGET - 1,
                          b.RETAINED_BUDGET - b.BUILD_BUDGET)

    def test_safe_new_build(self):
        self.capacity(b.DATA_RESERVE + b.BUILD_BUDGET, 0)

    def test_low_free_refused(self):
        with self.assertRaises(ValueError):
            self.capacity(b.DATA_RESERVE + b.BUILD_BUDGET - 1, 0)

    def test_aggregate_refused(self):
        with self.assertRaises(ValueError):
            self.capacity(b.DATA_RESERVE * 2, b.RETAINED_BUDGET - b.BUILD_BUDGET + 1)

    def test_oversized_current_refused(self):
        with self.assertRaises(ValueError):
            self.capacity(b.DATA_RESERVE * 2, b.BUILD_BUDGET + 1, b.BUILD_BUDGET + 1, True)

    def test_existing_allocation_charged_once(self):
        self.capacity(b.DATA_RESERVE, b.BUILD_BUDGET, b.BUILD_BUDGET, True)

    def test_tmp_and_nested_roots_refused(self):
        for path in ['/tmp/build', '/data/proofofwork-ui-builds/nested/build', '/data/proofofwork-ui-builds/../bad', '/data/proofofwork-ui-builds/.hidden']:
            with self.subTest(path=path), self.assertRaises(ValueError):
                b.validate_build_root(Path(path))


class HistoryTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory(prefix='pay-build-history-')
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name)
        self.repository = self.root / 'full'
        self.environment = {**os.environ, 'GIT_CONFIG_NOSYSTEM': '1',
                            'GIT_CONFIG_GLOBAL': '/dev/null', 'GIT_CONFIG_SYSTEM': '/dev/null'}
        self.git('init', '--quiet', str(self.repository))
        (self.repository / 'record.txt').write_text('retained source\\n')
        self.git('-C', str(self.repository), 'add', 'record.txt')
        self.git('-C', str(self.repository), '-c', 'user.name=Build fixture',
                 '-c', 'user.email=build-fixture@example.invalid', '-c', 'commit.gpgsign=false',
                 'commit', '--quiet', '-m', 'Fixture history')

    def git(self, *args):
        return subprocess.check_output(['git', *args], env=self.environment, stderr=subprocess.PIPE)

    def test_complete_local_history_accepted(self):
        b.require_complete_history(self.repository, self.environment)

    def test_shallow_history_refused(self):
        shallow = self.root / 'shallow'
        self.git('clone', '--quiet', '--depth=1', self.repository.as_uri(), str(shallow))
        with self.assertRaisesRegex(ValueError, 'complete Git history'):
            b.require_complete_history(shallow, self.environment)

    def test_nonshallow_missing_object_refused(self):
        blob = self.git('-C', str(self.repository), 'rev-parse', 'HEAD:record.txt').decode().strip()
        (self.repository / '.git' / 'objects' / blob[:2] / blob[2:]).unlink()
        with self.assertRaises(subprocess.CalledProcessError):
            b.require_complete_history(self.repository, self.environment)


if __name__ == '__main__':
    unittest.main()
