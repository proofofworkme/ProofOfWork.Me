#!/usr/bin/env python3
"""Real filesystem compatibility admission boundaries; no production access."""
import importlib.util
import os
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch
ROOT = Path(__file__).resolve().parents[1]
def load(name, path):
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec); spec.loader.exec_module(module)
    return module
stage = load('bounded_stage', ROOT / 'deploy/proofofwork-ui-release-stage.py')
phase = load('bounded_phase', ROOT / 'deploy/publish/phase_capacity.py')
class CompatibilityBoundaries(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix='pow-compat-bound-')
        self.base = Path(self.temp.name).resolve()
        self.live, self.incoming, self.candidate = [self.base / n for n in ('live', 'incoming', 'candidate')]
        for root in (self.live, self.incoming, self.candidate): root.mkdir(mode=0o755)
        for surface in stage.SURFACES:
            live = self.live / ('proofofwork-' + surface); (live / 'assets').mkdir(parents=True)
            html = ''.join(f'<script src="/assets/a{i}.js"></script>' for i in range(80))
            (live / 'index.html').write_text(html)
            for i in range(80): (live / 'assets' / f'a{i}.js').write_bytes(b'void 0;')
            incoming = self.incoming / surface; incoming.mkdir(); (incoming / 'assets').mkdir(); (incoming / 'index.html').write_bytes(b'<script src="/assets/new.js"></script>'); (incoming / 'assets/new.js').write_bytes(b'x')
            candidate = self.candidate / ('proofofwork-' + surface); candidate.mkdir(); (candidate / 'index.html').write_bytes(b'new')
        for path in self.base.rglob('*'): path.chmod(0o755 if path.is_dir() else 0o644)
    def tearDown(self): self.temp.cleanup()
    def budget(self): return phase.stage_budget(self.incoming, self.live, stage, owner=os.geteuid())
    def copy(self): return stage.copy_prior_asset_compatibility(self.live, self.candidate)
    def test_1600_paths_accepted_by_model_and_copy_with_exact_bytes(self):
        self.assertEqual(stage.MAXIMUM_DEPENDENCIES, 1600)
        self.assertEqual(self.budget()['compatibilityCounters']['dependencies'], 1600)
        self.assertEqual(self.copy(), (1600, 11200))
        for p in self.live.rglob('*.js'):
            self.assertEqual(p.read_bytes(), (self.candidate / p.relative_to(self.live)).read_bytes())
    def test_1601_paths_refused_by_both_consumers(self):
        root = self.live / ('proofofwork-' + stage.SURFACES[0])
        with (root / 'index.html').open('a') as f: f.write('<script src="/assets/extra.js"></script>')
        (root / 'assets/extra.js').write_bytes(b'x')
        with self.assertRaisesRegex(ValueError, 'dependency bound'): self.budget()
        with self.assertRaisesRegex(stage.StageError, 'dependency bound'): self.copy()
    def test_independent_limits_unchanged_and_enforced(self):
        self.assertEqual((stage.MAXIMUM_REFERENCE_EDGES, stage.MAXIMUM_REFERENCE_CANDIDATES,
                          stage.MAXIMUM_TOTAL_BYTES, stage.MAXIMUM_ASSET_BYTES),
                         (5120, 1310720, 512 * 1024**2, 64 * 1024**2))
        for name in ('MAXIMUM_REFERENCE_EDGES', 'MAXIMUM_REFERENCE_CANDIDATES', 'MAXIMUM_TOTAL_BYTES', 'MAXIMUM_ASSET_BYTES'):
            with self.subTest(limit=name), patch.object(stage, name, 1):
                with self.assertRaises((stage.StageError, ValueError)): self.budget()
                with self.assertRaises((stage.StageError, ValueError)): self.copy()
    def test_model_obeys_installed_stager_ceiling(self):
        with patch.object(stage, 'MAXIMUM_DEPENDENCIES', 1536):
            with self.assertRaisesRegex(ValueError, 'dependency bound'): self.budget()
if __name__ == '__main__': unittest.main()
