#!/usr/bin/env python3
"""Pure storage guard regression tests; no production path writes."""
import importlib.util
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

if __name__ == '__main__':
    unittest.main()
