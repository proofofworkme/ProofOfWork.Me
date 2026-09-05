#!/usr/bin/python3 -I
"""Focused window2 isolation checks; all captures and process data are local fixtures."""
import sys
sys.dont_write_bytecode = True
import ast
import builtins
import contextlib
import hashlib
import io
import json
import os
import pathlib
import stat
import subprocess
import tempfile
import types
import unittest

ROOT = pathlib.Path(__file__).resolve().parents[1]
HELPERS = ROOT / 'deploy/audit5'
APP = '2ddefac163d5-20260905T180603Z'
OPS = '0b63c8604456-20260905T205150Z'
CAPTURE = '/run/proofofwork-audit5-' + APP + '-window2'
EXEC = '/run/proofofwork-audit5-exec-' + OPS + '-window2'
TOOLS = '/run/proofofwork-audit5-window-tools-' + OPS + '-window2'
ORIGINAL_SHA = '3785ce4ab40b21f5759a37e6170ad38949488ded6d1e1129710bc03d97dbc382'
ORIGINAL = (HELPERS / 'private-env.py').read_bytes()
WRAPPER = (HELPERS / 'attempt-env.py').read_bytes()


def module(name):
    path = HELPERS / name
    namespace = {'__file__': str(path), '__name__': 'local_window2_fixture'}
    exec(compile(path.read_bytes(), str(path), 'exec'), namespace)
    return namespace


def environment_namespace():
    base = {'__file__': EXEC + '/private-env.py', '__name__': 'original_fixture'}
    exec(compile(ORIGINAL, base['__file__'], 'exec'), base)
    namespace = {
        '_base': base, '_original_runroot': base['runroot'],
        '_original_launch': base['launch'], '_original_launch_plan': base['launch_plan'],
        'APP': APP, 'CAPTURE': CAPTURE, 'sys': sys,
        'ALLOWED_MODES': frozenset(('repair-canonical', 'repair-atoms', 'bootstrap-api', 'bootstrap-worker', 'gate')),
    }
    definitions = [node for node in ast.parse(WRAPPER).body
                   if isinstance(node, ast.FunctionDef) and node.name in ('runroot', 'launch_plan', 'launch', 'main')]
    exec(compile(ast.fix_missing_locations(ast.Module(body=definitions, type_ignores=[])), 'wrapper-functions', 'exec'), namespace)
    base.update({name: namespace[name] for name in ('runroot', 'launch', 'launch_plan')})
    return base, namespace


class FixtureOS:
    """Map only root ownership operations for an unprivileged temp directory."""
    def __getattr__(self, name):
        return getattr(os, name)

    def chown(self, path, uid, gid):
        assert (uid, gid) == (0, 0)

    def fchown(self, fd, uid, gid):
        assert (uid, gid) == (0, 0)


class Window2Tests(unittest.TestCase):
    def test_original_source_is_byte_identical(self):
        self.assertEqual(hashlib.sha256(ORIGINAL).hexdigest(), ORIGINAL_SHA)

    def test_nonisolated_wrapper_refuses_before_privileged_reads(self):
        result = subprocess.run(['/usr/bin/python3', '-B', str(HELPERS / 'attempt-env.py'), 'capture', '--release-id', APP], capture_output=True)
        self.assertNotEqual(result.returncode, 0)
        self.assertIn(b'Invoke with /usr/bin/python3 -I', result.stderr)

    def test_complete_wrapper_loader_pins_original_and_never_runs_main_on_import(self):
        for defect in (None, 'wrong-original-bytes', 'original-symlink'):
            with self.subTest(defect=defect), tempfile.TemporaryDirectory(prefix='audit5-window2-loader-') as directory:
                helper_root = pathlib.Path(directory) / 'exec'
                helper_root.mkdir(mode=0o700)
                fixture_source = WRAPPER.replace(EXEC.encode(), str(helper_root).encode())
                wrapper_path = helper_root / 'attempt-env.py'
                wrapper_path.write_bytes(fixture_source); wrapper_path.chmod(0o600)
                original_path = helper_root / 'private-env.py'
                original_path.write_bytes(ORIGINAL if defect != 'wrong-original-bytes' else b'refuse changed source')
                original_path.chmod(0o600)
                if defect == 'original-symlink':
                    retained = helper_root / 'retained-original.py'
                    original_path.rename(retained)
                    original_path.symlink_to(retained)

                class RootOS(FixtureOS):
                    def getuid(self):
                        return 0

                    def geteuid(self):
                        return 0

                    def fstat(self, fd):
                        details = os.fstat(fd)
                        return types.SimpleNamespace(**{name: getattr(details, name) for name in ('st_mode', 'st_dev', 'st_ino', 'st_size', 'st_mtime_ns', 'st_ctime_ns', 'st_nlink')}, st_uid=0, st_gid=0)

                class RootPath(pathlib.PosixPath):
                    def lstat(self):
                        details = os.lstat(self)
                        return types.SimpleNamespace(st_mode=details.st_mode, st_uid=0, st_gid=0)

                root_os = RootOS()
                def fixture_import(name, globals=None, locals=None, fromlist=(), level=0):
                    if name == 'os':
                        return root_os
                    if name == 'pathlib':
                        return types.SimpleNamespace(Path=RootPath)
                    return builtins.__import__(name, globals, locals, fromlist, level)

                namespace = {'__file__': str(wrapper_path), '__name__': 'controller_import_fixture',
                             '__builtins__': dict(vars(builtins), __import__=fixture_import)}
                if defect:
                    with self.assertRaises((AssertionError, OSError)):
                        exec(compile(fixture_source, str(wrapper_path), 'exec'), namespace)
                    self.assertNotIn('_base', namespace)
                else:
                    # The wrapper's exec of the original uses normal builtins;
                    # importing function definitions must not invoke capture or launch.
                    exec(compile(fixture_source, str(wrapper_path), 'exec'), namespace)
                    self.assertEqual(namespace['_base']['__file__'], str(original_path))
                    self.assertEqual(namespace['_base']['runroot'](APP), CAPTURE)
                    self.assertEqual(namespace['_base']['NODE'], '/opt/node-v24.18.0-linux-x64/bin/node')
                    self.assertIs(namespace['private_read'], namespace['_base']['private_read'])
                    self.assertIs(namespace['validate_repair_evidence'], namespace['_base']['validate_repair_evidence'])
                    self.assertEqual(set(path.name for path in helper_root.iterdir()), {'attempt-env.py', 'private-env.py'})

    def test_exact_release_only_and_original_candidate(self):
        base, wrapper = environment_namespace()
        self.assertEqual(wrapper['runroot'](APP), CAPTURE)
        with self.assertRaises(base['Refused']):
            wrapper['runroot']('6a7d5c12e403-20260905T050937Z')
        with self.assertRaises(base['Refused']):
            wrapper['runroot'](APP + '-window2')
        env, command = base['launch_plan']('bootstrap-worker', {}, APP)
        self.assertEqual(env[b'PWD'].decode(), '/opt/proofofwork-api-stage-' + APP)
        self.assertEqual(command, ['scripts/run-proof-indexer-worker.mjs', '--once'])

    def test_shadow_modes_and_cache_preparation_refused(self):
        base, wrapper = environment_namespace()
        with self.assertRaises(base['Refused']):
            base['launch_plan']('readonly-shadow', {}, APP)
        called = []
        wrapper['_original_launch'] = lambda *args: called.append(args)
        with self.assertRaises(base['Refused']):
            wrapper['launch'](types.SimpleNamespace(mode='readonly-shadow'), None)
        self.assertFalse(called)
        previous = sys.argv
        try:
            sys.argv = ['attempt-env.py', 'prepare-shadow-cache', '--release-id', APP]
            with contextlib.redirect_stderr(io.StringIO()):
                self.assertEqual(wrapper['main'](), 1)
        finally:
            sys.argv = previous

    def test_original_lifecycle_and_loader_guards_remain(self):
        base, _ = environment_namespace()
        ordinary = {b'LISTEN_PID': b'123', b'INVOCATION_ID': b'old', b'NODE_OPTIONS': b'--max-old-space-size=2048'}
        env, _ = base['launch_plan']('bootstrap-api', ordinary, APP)
        self.assertNotIn(b'LISTEN_PID', env)
        self.assertNotIn(b'INVOCATION_ID', env)
        self.assertEqual(env[b'NODE_OPTIONS'], ordinary[b'NODE_OPTIONS'])
        for dangerous in ({b'NODE_OPTIONS': b'--require=untrusted'}, {b'LD_PRELOAD': b'untrusted'}, {b'LD_LIBRARY_PATH': b'untrusted'}):
            with self.assertRaises(base['Refused']):
                base['launch_plan']('bootstrap-api', dangerous, APP)

    def test_each_allowed_mode_keeps_its_exact_command(self):
        base, _ = environment_namespace()
        expected = {
            'repair-canonical': ['scripts/backfill-proof-indexer.mjs', '--repair-canonical-txids'],
            'repair-atoms': ['scripts/backfill-proof-indexer.mjs', '--repair-work-atomic-events'],
            'bootstrap-api': ['server/proof-api.mjs'],
            'bootstrap-worker': ['scripts/run-proof-indexer-worker.mjs', '--once'],
            'gate': ['scripts/backfill-proof-indexer.mjs', '--audit-work-atoms'],
        }
        for mode, command in expected.items():
            _, actual = base['launch_plan'](mode, {}, APP, 'indexer:audit-work-atoms' if mode == 'gate' else None)
            self.assertEqual(actual, command)

    def test_fresh_capture_preserves_old_evidence_and_refuses_reuse(self):
        base, wrapper = environment_namespace()
        with tempfile.TemporaryDirectory(prefix='audit5-window2-capture-') as directory:
            parent = pathlib.Path(directory)
            old = parent / 'attempt1'; old.mkdir()
            (old / 'capture-error.json').write_bytes(b'preserved previous failure')
            fresh = parent / 'attempt2'
            wrapper['CAPTURE'] = str(fresh)
            base['os'] = FixtureOS()
            base['check_root_dir'] = lambda path, mode=0o700: self.assertEqual((path, mode), ('/run', 0o755))
            base['proc_identity'] = lambda kind, account: {'pid': 1252738 if kind == 'api' else 1252751, 'kind': kind, 'newCapture': True}
            class EnvironmentFile:
                def read_bytes(self):
                    return b'DATABASE_URL=fixture-only\0PORT=8081\0'
            def fixture_path(*parts):
                self.assertEqual(parts[0], '/proc')
                self.assertEqual(parts[-1], 'environ')
                return EnvironmentFile()
            base['pathlib'] = types.SimpleNamespace(Path=fixture_path)
            with contextlib.redirect_stdout(io.StringIO()):
                base['capture'](APP, None)
            manifest = json.loads((fresh / 'capture.json').read_bytes())
            self.assertEqual(manifest['releaseId'], APP)
            self.assertEqual(manifest['processes']['api']['identityFinal']['pid'], 1252738)
            self.assertEqual(manifest['processes']['worker']['identityFinal']['pid'], 1252751)
            saved = {path.name: path.read_bytes() for path in fresh.iterdir()}
            for path in fresh.iterdir():
                self.assertEqual(stat.S_IMODE(path.stat().st_mode), 0o600)
            with self.assertRaises(FileExistsError):
                base['capture'](APP, None)
            self.assertEqual(saved, {path.name: path.read_bytes() for path in fresh.iterdir()})
            self.assertEqual((old / 'capture-error.json').read_bytes(), b'preserved previous failure')

    def test_quiescence_derived_paths_and_cache_timer_bindings(self):
        guard = module('window-quiescence.py')
        self.assertEqual(str(guard['ROOT']), CAPTURE)
        self.assertEqual(str(guard['BASE']), CAPTURE + '/window-maintenance-baseline.json')
        self.assertEqual(str(guard['HOLD']), CAPTURE + '/window-maintenance-held.json')
        pin = hashlib.sha256((HELPERS / 'window-quiescence.py').read_bytes()).hexdigest()
        for name in ('rotate-cache.py', 'restore-window-timers.py'):
            helper = module(name)
            self.assertEqual(str(helper['CAPTURE']), CAPTURE)
            self.assertEqual(str(helper['GUARD']), TOOLS + '/window-quiescence.py')
            self.assertEqual(helper['GUARD_SHA'], pin)
        self.assertEqual(module('rotate-cache.py')['PRESERVED'], 'proofofwork-api-cache.pre-audit5-' + APP)

    def test_controller_paths_wrapper_pin_and_unit_namespace(self):
        tree = ast.parse((HELPERS / 'window-unit.py').read_bytes())
        names = {'APP', 'OPS', 'NODE', 'CANDIDATE', 'EXEC', 'CAPTURE', 'WINDOW', 'QUIESCENCE_SHA', 'PINS', 'unit', 'argv'}
        assignments = [node for node in tree.body if isinstance(node, ast.Assign)
                       and any(isinstance(target, ast.Name) and target.id in names for target in node.targets)]
        namespace = {'pathlib': pathlib, 'label': 'fixture', 'mode': 'repair-canonical'}
        exec(compile(ast.fix_missing_locations(ast.Module(body=assignments, type_ignores=[])), 'controller-namespace', 'exec'), namespace)
        self.assertEqual(namespace['APP'], APP)
        self.assertEqual(namespace['CANDIDATE'], '/opt/proofofwork-api-stage-' + APP)
        self.assertEqual(str(namespace['EXEC']), EXEC)
        self.assertEqual(str(namespace['CAPTURE']), CAPTURE)
        self.assertEqual(str(namespace['WINDOW']), TOOLS)
        self.assertEqual(namespace['unit'], 'proofofwork-audit5-window-' + OPS + '-window2-fixture.service')
        self.assertEqual(namespace['argv'], ['/usr/bin/python3', '-I', EXEC + '/attempt-env.py', 'launch', '--release-id', APP, '--mode', 'repair-canonical'])
        self.assertEqual(namespace['PINS']['attempt-env.py'], hashlib.sha256(WRAPPER).hexdigest())

    def test_capture_uses_fresh_tools_sql_and_baseline_root(self):
        helper = module('capture-repair-evidence.py')
        self.assertEqual(str(helper['ROOT']), CAPTURE)
        self.assertEqual(str(helper['TOOLS']), TOOLS)
        self.assertNotIn('SOURCE', helper)
        sql_reads = [node for node in ast.walk(ast.parse((HELPERS / 'capture-repair-evidence.py').read_bytes()))
                     if isinstance(node, ast.Call) and isinstance(node.func, ast.Name) and node.func.id == 'read'
                     and node.args and isinstance(node.args[0], ast.BinOp)
                     and isinstance(node.args[0].right, ast.Constant)
                     and node.args[0].right.value == 'proofofwork-audit5-data-repair-check.sql']
        self.assertEqual(len(sql_reads), 1)
        self.assertEqual(sql_reads[0].args[0].left.id, 'TOOLS')


if __name__ == '__main__':
    suite = unittest.defaultTestLoader.loadTestsFromTestCase(Window2Tests)
    result = unittest.TextTestRunner(verbosity=2).run(suite)
    print(json.dumps({'tests': result.testsRun, 'ok': result.wasSuccessful(), 'productionCalls': 0,
                      'qualification': 'Namespace and original helper functions tested with local capture/process fixtures; ownership assignment mocked, privacy source remains byte-identical.'}))
    raise SystemExit(0 if result.wasSuccessful() else 1)
