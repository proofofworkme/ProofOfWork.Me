#!/usr/bin/env python3
"""Real filesystem compatibility admission boundaries; no production access."""
import importlib.util
import os
import shlex
import subprocess
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

def verify_with_publisher(live, candidate):
    publisher = (ROOT / 'deploy/proofofwork-ui-release-publish.sh').read_text()
    function = 'verify_prior_asset_compatibility() {' + publisher.split(
        'verify_prior_asset_compatibility() {', 1)[1].split(
        '\n}\n\npassthrough_digest()', 1)[0] + '\n}\n'
    script = ('set -euo pipefail\nwww_root=' + shlex.quote(str(live)) +
              '\nstage_root=' + shlex.quote(str(candidate)) + '\nsurfaces=(' +
              ' '.join(stage.SURFACES) + ')\nv3_surfaces=("${surfaces[@]}")\n' +
              'pages_surfaces=("${surfaces[@]}" pages)\n' +
              'permission_surfaces=("${pages_surfaces[@]}" permission)\n' +
              function + '\nverify_prior_asset_compatibility\n')
    return subprocess.run(['/usr/bin/bash'], input=script, text=True, capture_output=True, timeout=125)

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
    def test_independent_limits_explicit_and_enforced(self):
        self.assertEqual((stage.MAXIMUM_REFERENCE_EDGES, stage.MAXIMUM_REFERENCE_CANDIDATES,
                          stage.MAXIMUM_TOTAL_BYTES, stage.MAXIMUM_ASSET_BYTES),
                         (5632, 1441792, 512 * 1024**2, 64 * 1024**2))
        for name in ('MAXIMUM_REFERENCE_EDGES', 'MAXIMUM_REFERENCE_CANDIDATES', 'MAXIMUM_TOTAL_BYTES', 'MAXIMUM_ASSET_BYTES'):
            with self.subTest(limit=name), patch.object(stage, name, 1):
                with self.assertRaises((stage.StageError, ValueError)): self.budget()
                with self.assertRaises((stage.StageError, ValueError)): self.copy()
    def test_publisher_actual_1600_accepted_1601_refused(self):
        self.copy()
        accepted = verify_with_publisher(self.live, self.candidate)
        self.assertEqual(accepted.returncode, 0, accepted.stderr)
        self.assertIn('dependencies=1600 bytes=11200', accepted.stdout)
        for base in (self.live, self.candidate):
            root = base / ('proofofwork-' + stage.SURFACES[0])
            (root / 'assets/extra.js').write_bytes(b'x')
        root = self.live / ('proofofwork-' + stage.SURFACES[0])
        with (root / 'index.html').open('a') as f:
            f.write('<script src="/assets/extra.js"></script>')
        refused = verify_with_publisher(self.live, self.candidate)
        self.assertNotEqual(refused.returncode, 0)
        self.assertIn('dependency bound exceeded', refused.stderr)
    def test_model_obeys_installed_stager_ceiling(self):
        with patch.object(stage, 'MAXIMUM_DEPENDENCIES', 1536):
            with self.assertRaisesRegex(ValueError, 'dependency bound'): self.budget()

class PermissionGraphBoundary(unittest.TestCase):
    def test_copy_plan_and_publication_enforce_the_same_v5_graph(self):
        surfaces = stage.PERMISSION_SURFACES
        with tempfile.TemporaryDirectory() as temp:
            live, candidate = Path(temp) / 'live', Path(temp) / 'stage'
            incoming = {s: [{'path': '.', 'kind': 'directory'}] for s in surfaces}
            remaining_imports = 6272 - 1664
            for index, surface in enumerate(surfaces):
                count = 1664 // len(surfaces) + (index < 1664 % len(surfaces))
                root = live / ('proofofwork-' + surface)
                (root / 'assets').mkdir(parents=True)
                (candidate / root.name).mkdir(parents=True)
                (root / 'index.html').write_text(''.join(f'<script src="/assets/{n}.js"></script>' for n in range(count)))
                for n in range(count):
                    imports = min(3, remaining_imports)
                    remaining_imports -= imports
                    (root / 'assets' / f'{n}.js').write_text(
                        ''.join(f'import "./{(n + j + 1) % count}.js";\n' for j in range(imports)))
            self.assertEqual(remaining_imports, 0)
            def plan(): return phase.prior_compatibility(live, surfaces, stage, incoming)[2]
            def copy(): return stage.copy_prior_asset_compatibility(live, candidate, surfaces)
            counters = plan()
            self.assertEqual((counters['dependencies'], counters['reference_edges']), (1664, 6272))
            self.assertEqual(copy(), (1664, counters['total_bytes']))
            published = verify_with_publisher(live, candidate)
            self.assertEqual(published.returncode, 0, published.stderr)
            def refused(reason):
                with self.assertRaisesRegex((ValueError, stage.StageError), reason): plan()
                with self.assertRaisesRegex(stage.StageError, reason): copy()
                result = verify_with_publisher(live, candidate)
                self.assertNotEqual(result.returncode, 0)
                self.assertIn(reason, result.stderr)
            # One extra edge between already admitted files must still refuse.
            surface_dir = 'proofofwork-' + surfaces[0]
            referrer = Path(surface_dir) / 'assets/0.js'
            original = (live / referrer).read_text()
            for tree in (live, candidate):
                (tree / referrer).write_text(original + 'import "./0.js";')
            refused('reference-edge bound')
            # Keep the edge total constant and introduce one new served path.
            for tree in (live, candidate):
                (tree / referrer).write_text(original.replace('"./1.js"', '"./extra.js"'))
                (tree / surface_dir / 'assets/extra.js').write_text('void 0;')
            refused('dependency bound')

if __name__ == '__main__': unittest.main()
