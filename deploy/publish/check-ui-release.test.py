#!/usr/bin/env python3
"""Offline refusal tests; never execute a remote script's module-level actions.

These tests use real local artifacts, AST-extracted safe functions, and mocked
SSH/HTTPS/process boundaries. They certify refusal behavior, not a deployment.
"""
import ast
import contextlib
import copy
import fcntl
import hashlib
import io
import json
import os
import shlex
from pathlib import Path
import subprocess
import sys
import tarfile
import tempfile
import types
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parent
COMMIT = 'a' * 40
TREE = 'b' * 40
RELEASE = COMMIT[:12] + '-20261002T210000Z'


def safe_module(name):
    namespace = {'__name__': '_offline_refusal_test', '__file__': str(ROOT / name)}
    exec(compile((ROOT / name).read_bytes(), str(ROOT / name), 'exec'), namespace)
    return types.SimpleNamespace(**namespace)


def functions_only(name, names):
    """Extract definitions without executing preflight/transport/publish."""
    tree = ast.parse((ROOT / name).read_bytes())
    nodes = [n for n in tree.body if isinstance(n, (ast.Import, ast.ImportFrom)) or
             isinstance(n, (ast.FunctionDef, ast.ClassDef)) and n.name in names]
    namespace = {'__name__': '_offline_ast_test', '__file__': str(ROOT / name)}
    exec(compile(ast.Module(body=nodes, type_ignores=[]), str(ROOT / name), 'exec'), namespace)
    return namespace


def raw_json(value):
    return (json.dumps(value, indent=2) + '\n').encode()


def statement_range(name, first_assignment, stop_assignment):
    nodes = ast.parse((ROOT / name).read_bytes()).body
    def index(variable):
        return next(i for i, node in enumerate(nodes) if isinstance(node, ast.Assign) and
                    any(isinstance(target, ast.Name) and target.id == variable for target in node.targets))
    return compile(ast.Module(body=nodes[index(first_assignment):index(stop_assignment)],
                              type_ignores=[]), str(ROOT / name), 'exec')


def write_tar(path, members):
    with tarfile.open(path, 'w:gz') as archive:
        for name, content, kind in members:
            member = tarfile.TarInfo(name)
            member.type = kind
            member.mode = 0o755 if kind == tarfile.DIRTYPE else 0o644
            if kind == tarfile.REGTYPE:
                member.size = len(content)
                archive.addfile(member, io.BytesIO(content))
            else:
                if kind == tarfile.SYMTYPE:
                    member.linkname = '/etc/passwd'
                archive.addfile(member)


class ReleaseRefusals(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix='pow-ui-release-test-', dir='/tmp')
        self.base = Path(self.temp.name).resolve()
        self.release = safe_module('release.py')
        self.transport = safe_module('transport_preserve.py')

    def tearDown(self):
        self.temp.cleanup()

    def test_every_current_surface_vector_includes_the_same_twenty_roots(self):
        expected = set(self.release.SURFACES)
        self.assertEqual(len(expected), 20)
        self.assertIn('jobs', expected)
        self.assertIn('search', expected)
        vectors = [('build.py', 'SURFACES'), ('remote_transport.py', 'SURFACES'),
                   ('phase_capacity.py', 'SURFACES'), ('https_smoke.py', 'HOSTS'),
                   ('../search/install-ui.py', 'SURFACES'),
                   ('../proofofwork-ui-release-stage.py', 'SURFACES'),
                   ('../proofofwork-ui-verified-retention.py', 'SURFACES')]
        for name, variable in vectors:
            with self.subTest(module=name):
                tree = ast.parse((ROOT / name).read_bytes())
                assignment = next(node for node in tree.body if isinstance(node, ast.Assign)
                    and any(isinstance(target, ast.Name) and target.id == variable
                            for target in node.targets))
                namespace = {}
                exec(compile(ast.Module(body=[assignment], type_ignores=[]), name, 'exec'), namespace)
                actual = set(namespace[variable])
                if variable == 'HOSTS' or name == 'build.py':
                    actual.add('nft')
                self.assertEqual(actual, expected)

    def plan(self):
        return {'schema': 'proof-of-work-audit29-ui-transport-plan-v1',
                'releaseId': RELEASE, 'commit': COMMIT, 'tree': TREE,
                'publicationAttempt': 'initial'}

    def test_plan_identity_and_size_refusals(self):
        path = self.base / 'plan.json'
        good = self.plan()
        path.write_bytes(raw_json(good))
        value, sha, raw = self.release.load_plan(path)
        self.assertEqual(value, good)
        self.assertEqual(sha, hashlib.sha256(raw).hexdigest())
        changes = [('schema', 'other'), ('releaseId', '../unsafe'),
                   ('releaseId', 'c' * 12 + '-20261002T210000Z'),
                   ('commit', COMMIT.upper()), ('commit', 'a' * 39),
                   ('tree', 'b' * 39), ('publicationAttempt', '../retry'),
                   ('publicationAttempt', 'a' * 32)]
        for key, value in changes:
            with self.subTest(key=key, value=value):
                bad = {**good, key: value}
                path.write_bytes(raw_json(bad))
                with self.assertRaises((AssertionError, ValueError)):
                    self.release.load_plan(path)
        path.write_bytes(b' ' * 65537)
        with self.assertRaisesRegex(ValueError, '64 KiB'):
            self.release.load_plan(path)

    def test_local_evidence_is_creation_only_and_canonical(self):
        path = self.base / 'receipt.json'
        self.release.create(path, b'first')
        with self.assertRaises(FileExistsError):
            self.release.create(path, b'second')
        self.assertEqual(path.read_bytes(), b'first')
        alias = self.base / 'alias'
        alias.symlink_to(self.base, target_is_directory=True)
        for bad in ['relative.json', '/var/tmp/audit30-test.json', alias / 'new.json']:
            with self.subTest(path=str(bad)), self.assertRaises(ValueError):
                self.release.create(bad, b'forbidden')

    def test_preflight_refuses_failed_gate_or_unpaused_retention(self):
        for value in [{'checks': [{'exitCode': 1}], 'retentionDeferred': True},
                      {'checks': [{'exitCode': 0}], 'retentionDeferred': False}]:
            with self.subTest(value=value):
                output = self.base / 'preflight.json'
                fake = subprocess.CompletedProcess([], 0, stdout=raw_json(value))
                with patch.dict(self.release.preflight.__globals__, remote=lambda *a, **k: fake):
                    with self.assertRaises(AssertionError):
                        self.release.preflight(types.SimpleNamespace(output=str(output)))
                self.assertFalse(output.exists())

    def build_inputs(self):
        source = self.base / 'source.tgz'
        surfaces = self.base / 'surfaces.tgz'
        write_tar(source, [('source/README.md', b'local source', tarfile.REGTYPE)])
        top = 'proofofwork-ui-surfaces-' + RELEASE
        prefix = top + '/surfaces/'
        members = [(top, b'', tarfile.DIRTYPE), (top + '/surfaces', b'', tarfile.DIRTYPE)]
        for name in self.release.SURFACES:
            members.extend([(prefix + name, b'', tarfile.DIRTYPE),
                            (prefix + name + '/index.html', name.encode(), tarfile.REGTYPE)])
        write_tar(surfaces, members)
        bundles = {kind: {'path': str(path), 'bytes': path.stat().st_size,
                          'sha256': self.release.digest(path)}
                   for kind, path in [('source', source), ('surfaces', surfaces)]}
        build = {'commit': COMMIT, 'tree': TREE, 'releaseId': RELEASE,
                 'sourceAllocatedBytes': 4096, 'bundles': bundles}
        keys = ['controller', 'receiver', 'stage-shell', 'phase-capacity', 'capacity',
                'retained', 'publisher', 'stager', 'provenance', 'transport']
        preflight = {'retentionDeferred': True, 'checks': [{'exitCode': 0}],
                     'retained': [{'root': '/var/backups/retained', 'treeSha256': 'e' * 64}],
                     'helpers': {k: {'path': '/trusted/' + k, 'sha256': 'd' * 64}
                                 for k in keys},
                     'live': {'manifestSha256': 'f' * 64, 'treeSha256': '0' * 64},
                     'oldManaged': {'logicalBytes': 123456, 'entries': 100}}
        bpath, ppath = self.base / 'build.json', self.base / 'preflight.json'
        bpath.write_bytes(raw_json(build)); ppath.write_bytes(raw_json(preflight))
        args = types.SimpleNamespace(build_receipt=str(bpath), preflight=str(ppath),
                                     output=str(self.base / 'out.json'), attempt='initial')
        return build, preflight, args

    def git_output(self, argv, **kwargs):
        if argv[-1] == 'HEAD':
            return COMMIT + '\n'
        if argv[-1] in ('HEAD^{tree}', COMMIT + '^{tree}'):
            return TREE + '\n'
        if 'show' in argv:
            return (ROOT / argv[-1].rsplit('/', 1)[-1]).read_bytes()
        return b''

    def test_plan_pins_exact_inputs_helpers_and_capacity(self):
        build, previous, args = self.build_inputs()
        with patch.object(subprocess, 'check_output', side_effect=self.git_output), contextlib.redirect_stdout(io.StringIO()):
            self.release.make_plan(args)
        plan = json.loads(Path(args.output).read_bytes())
        self.assertTrue(plan['frontendOnly'] and plan['retentionDeferred'])
        self.assertEqual(plan['retainedRoots'], previous['retained'])
        self.assertEqual(plan['oldFullRootTreeSha256'], previous['live']['treeSha256'])
        self.assertEqual(plan['publicationWrapperSha256'], self.release.digest(ROOT / 'publish.py'))
        self.assertEqual(plan['preservingTransportSha256'], self.release.digest(ROOT / 'remote_transport.py'))
        for kind in ('source', 'surfaces'):
            self.assertEqual(plan[kind]['sha256'], build['bundles'][kind]['sha256'])
            self.assertGreater(plan['admissions'][kind + '-receive']['bytes'], 16 * 1024**2)
            self.assertGreaterEqual(plan['admissions'][kind + '-receive']['inodes'], 4000)
        self.assertGreater(plan['stageArchiveUpperBoundBytes'], 123456 + 32 * 1024**2)

    def test_20_surface_plan_binds_phase_capacity_and_committed_wrapper_sources(self):
        self.assertEqual(len(self.release.SURFACES), 20)
        self.assertIn('jobs', self.release.SURFACES)
        self.assertIn('publish', self.release.SURFACES)
        self.assertIn('search', self.release.SURFACES)
        self.assertEqual(self.release.REPO, ROOT.parents[1])
        build, previous, args = self.build_inputs()
        with patch.object(subprocess, 'check_output', side_effect=self.git_output), contextlib.redirect_stdout(io.StringIO()):
            self.release.make_plan(args)
        plan = json.loads(Path(args.output).read_bytes())
        self.assertEqual(plan['httpsSmokeSha256'], self.release.digest(ROOT / 'https_smoke.py'))
        self.assertEqual(plan['phaseCapacity']['source'], (ROOT / 'phase_capacity.py').read_text())
        self.assertEqual(plan['phaseCapacity']['sha256'], self.release.digest(ROOT / 'phase_capacity.py'))
        self.assertEqual(plan['wrapperSourceSha256']['release.py'], self.release.digest(ROOT / 'release.py'))
        self.assertEqual(plan['wrapperSourceSha256']['build.py'], self.release.digest(ROOT / 'build.py'))
        self.assertEqual(plan['helperSha256']['phase-capacity'], previous['helpers']['phase-capacity']['sha256'])

    def test_plan_refuses_uncommitted_wrapper_before_creation(self):
        build, previous, args = self.build_inputs()
        def changed(argv, **kwargs):
            return b'# changed source' if argv[-1] == 'HEAD:deploy/publish/phase_capacity.py' else self.git_output(argv, **kwargs)
        with patch.object(subprocess, 'check_output', side_effect=changed):
            with self.assertRaisesRegex(AssertionError, 'committed source'):
                self.release.make_plan(args)
        self.assertFalse(Path(args.output).exists())

    def test_plan_refuses_dirty_checkout_changed_bundle_and_link_surface(self):
        for case in ('dirty', 'changed', 'link'):
            with self.subTest(case=case):
                build, previous, args = self.build_inputs()
                if case == 'changed':
                    Path(build['bundles']['source']['path']).write_bytes(b'changed')
                if case == 'link':
                    path = Path(build['bundles']['surfaces']['path'])
                    write_tar(path, [('unsafe', b'', tarfile.SYMTYPE)])
                    build['bundles']['surfaces'].update(bytes=path.stat().st_size, sha256=self.release.digest(path))
                    Path(args.build_receipt).write_bytes(raw_json(build))
                def output(argv, **kwargs):
                    return b' M README.md\n' if case == 'dirty' and 'status' in argv else self.git_output(argv)
                with patch.object(subprocess, 'check_output', side_effect=output):
                    with self.assertRaises(AssertionError):
                        self.release.make_plan(args)
                self.assertFalse(Path(args.output).exists())

    def test_publish_refuses_changed_wrapper_before_remote_call(self):
        plan = {**self.plan(), 'publicationWrapperSha256': '0' * 64}
        path = self.base / 'plan.json'; path.write_bytes(raw_json(plan))
        with patch.dict(self.release.publish.__globals__, remote=unittest.mock.Mock()) as namespace:
            with self.assertRaises(AssertionError):
                self.release.publish(types.SimpleNamespace(plan=str(path), log=str(self.base / 'log')))
            namespace['remote'].assert_not_called()
        self.assertFalse((self.base / 'log').exists())

    def test_transport_refuses_changed_helper_or_bundle_before_ssh(self):
        bundle = self.base / 'bundle.tgz'; bundle.write_bytes(b'approved')
        plan = {**self.plan(), 'preservingTransportSha256': self.release.digest(ROOT / 'remote_transport.py'),
                'localBundles': {'source': str(bundle)},
                'source': {'compressedBytes': bundle.stat().st_size, 'sha256': self.release.digest(bundle)}}
        for case in ('helper', 'bytes', 'digest', 'alias'):
            with self.subTest(case=case):
                candidate = copy.deepcopy(plan)
                if case == 'helper': candidate['preservingTransportSha256'] = '0' * 64
                if case == 'bytes': candidate['source']['compressedBytes'] += 1
                if case == 'digest': candidate['source']['sha256'] = '0' * 64
                if case == 'alias':
                    alias = self.base / 'bundle-link'; alias.symlink_to(bundle)
                    candidate['localBundles']['source'] = str(alias)
                path = self.base / 'plan.json'; path.write_bytes(raw_json(candidate))
                log = self.base / 'transport.log'
                with patch('sys.argv', ['transport_preserve.py', str(path), 'source', str(log)]), patch.object(subprocess, 'run') as run:
                    with self.assertRaises(AssertionError): self.transport.main()
                    run.assert_not_called()
                self.assertFalse(log.exists())

    def test_hash_bound_remote_reads_refuse_unsafe_or_changed_inputs(self):
        # Root ownership is simulated only for this unprivileged local fixture;
        # actual regular/link/hardlink/mode/hash/size checks remain exercised.
        original_lstat, original_fstat = Path.lstat, os.fstat
        def owned(details):
            result = types.SimpleNamespace(**{k: getattr(details, k) for k in dir(details) if k.startswith('st_')})
            result.st_uid = result.st_gid = 0
            return result
        for filename, name in [('remote_transport.py', 'bound'), ('publish.py', 'load_bound')]:
            function = functions_only(filename, {name, 'identity'})[name]
            path = self.base / filename; path.write_bytes(b'exact helper'); path.chmod(0o600)
            sha = hashlib.sha256(path.read_bytes()).hexdigest()
            with patch.object(Path, 'lstat', lambda p: owned(original_lstat(p))), patch.object(os, 'fstat', lambda fd: owned(original_fstat(fd))):
                self.assertEqual(function(path, sha), b'exact helper')
                with self.assertRaises(AssertionError): function(path, '0' * 64)
                with self.assertRaises(AssertionError): function(path, sha, 3)
                path.chmod(0o666)
                with self.assertRaises(AssertionError): function(path, sha)
                path.chmod(0o600)
                alias = self.base / (filename + '.symlink'); alias.symlink_to(path)
                with self.assertRaises(AssertionError): function(alias, sha)
                hard = self.base / (filename + '.hardlink'); os.link(path, hard)
                with self.assertRaises(AssertionError): function(path, sha)

    def test_launchers_pin_ssh_identity_and_host_key(self):
        for option in ('BatchMode=yes', 'IdentitiesOnly=yes', 'StrictHostKeyChecking=yes', 'ConnectTimeout=10'):
            self.assertIn(option, self.release.SSH)
        for name in ('transport_preserve.py', 'collect_verify.py'):
            tree = ast.parse((ROOT / name).read_bytes())
            strings = {n.value for n in ast.walk(tree) if isinstance(n, ast.Constant) and isinstance(n.value, str)}
            self.assertTrue({'BatchMode=yes', 'IdentitiesOnly=yes', 'StrictHostKeyChecking=yes'} <= strings)

    def test_publisher_refuses_wrong_process_cgroup_or_deadline(self):
        code = statement_range('publish.py', 'unit', 'lock_path')
        unit = 'proofofwork-recovery-release-' + RELEASE + '-ui-initial.service'
        good = {'ActiveState': 'active', 'MainPID': str(os.getpid()),
                'KillMode': 'control-group', 'RuntimeMaxUSec': '30min',
                'ControlGroup': '/system.slice/' + unit}
        namespace = functions_only('publish.py', set())
        namespace.update(release=RELEASE, attempt='initial')
        for key, value in [(None, None), ('ActiveState', 'inactive'), ('MainPID', '0'),
                           ('KillMode', 'process'), ('RuntimeMaxUSec', '60min'),
                           ('ControlGroup', '/system.slice/unrelated.service')]:
            with self.subTest(key=key):
                fields = good if key is None else {**good, key: value}
                raw = '\n'.join(k + '=' + v for k, v in fields.items())
                with patch.object(subprocess, 'check_output', return_value=raw), \
                     patch.object(Path, 'read_text', return_value='0::' + good['ControlGroup'] + '\n'):
                    if key is None: exec(code, namespace)
                    else:
                        with self.assertRaises(AssertionError): exec(code, namespace)

    def test_publisher_deploy_lock_is_nonblocking_exclusive_and_link_safe(self):
        code = statement_range('publish.py', 'lock_path', 'env')
        namespace = functions_only('publish.py', {'identity'})
        lock = self.base / 'deploy.lock'; lock.write_bytes(b''); lock.chmod(0o600)
        original_lstat, original_fstat = Path.lstat, os.fstat
        def owned(details):
            row = types.SimpleNamespace(**{k: getattr(details, k) for k in dir(details) if k.startswith('st_')})
            row.st_uid = row.st_gid = 0
            return row
        namespace['pathlib'] = types.SimpleNamespace(Path=lambda value: lock if value == '/run/proofofwork-ui/deploy.lock' else Path(value))
        with patch.object(Path, 'lstat', lambda p: owned(original_lstat(p))), \
             patch.object(os, 'fstat', lambda fd: owned(original_fstat(fd))):
            exec(code, namespace)
            os.close(namespace.pop('fd'))
            holder = os.open(lock, os.O_RDONLY)
            try:
                fcntl.flock(holder, fcntl.LOCK_EX | fcntl.LOCK_NB)
                with self.assertRaises(BlockingIOError): exec(code, namespace)
                os.close(namespace.pop('fd'))
            finally: os.close(holder)
            lock.chmod(0o666)
            with self.assertRaises(AssertionError): exec(code, namespace)
            lock.chmod(0o600)
            hard = self.base / 'lock-hardlink'; os.link(lock, hard)
            with self.assertRaises(AssertionError): exec(code, namespace)
            hard.unlink()
            original = self.base / 'lock-original'; lock.rename(original); lock.symlink_to(original)
            with self.assertRaises(AssertionError): exec(code, namespace)

    def test_transport_log_bound_and_child_timeout_terminate_local_child(self):
        namespace = functions_only('remote_transport.py', {'run'})
        lock = self.base / 'child.lock'; lock.write_bytes(b'')
        descriptor = os.open(lock, os.O_RDONLY)
        try:
            namespace.update(out=self.base, env={'PATH': '/usr/bin:/bin'}, lock_fd=descriptor,
                             captured_log_bytes=0, TOTAL_LOG_CEILING=128)
            with self.assertRaisesRegex(AssertionError, 'log bound'):
                namespace['run'](['/usr/bin/python3', '-I', '-B', '-c', 'print("x" * 4096)'],
                                 'too-much.log', timeout=5)
            self.assertEqual((self.base / 'too-much.log').stat().st_size, 0)
            namespace.update(captured_log_bytes=0, TOTAL_LOG_CEILING=1024)
            with self.assertRaisesRegex(AssertionError, 'deadline'):
                namespace['run'](['/usr/bin/python3', '-I', '-B', '-c', 'import time; time.sleep(3)'],
                                 'too-slow.log', timeout=0.01)
        finally: os.close(descriptor)


class PublishCompatibilityTimeout(unittest.TestCase):
    """Run the actual bounded publisher parser only against isolated local roots."""

    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix='pow-ui-compatibility-timeout-', dir='/tmp')
        self.base = Path(self.temp.name).resolve()
        self.live, self.stage = self.base / 'live', self.base / 'stage'
        self.live.mkdir()
        self.stage.mkdir()
        self.surfaces = ('activity', 'browser', 'boost', 'code', 'computer', 'desktop',
                         'dns', 'growth', 'id', 'inception', 'infinity', 'jobs', 'landing',
                         'marketplace', 'nft', 'publish', 'search', 'token', 'wallet', 'work')
        self.asset_bytes = b'export const prior = 1;\n'
        for surface in self.surfaces:
            for root in (self.live, self.stage):
                directory = root / ('proofofwork-' + surface)
                (directory / 'assets').mkdir(parents=True)
                (directory / 'assets/prior.js').write_bytes(self.asset_bytes)
                (directory / 'index.html').write_bytes(b'<script src="/assets/prior.js"></script>')
        publisher = (ROOT.parent / 'proofofwork-ui-release-publish.sh').read_text()
        self.function = 'verify_prior_asset_compatibility() {' + publisher.split(
            'verify_prior_asset_compatibility() {', 1)[1].split(
            '\n}\n\npassthrough_digest()', 1)[0] + '\n}\n'
        self.timeout = 'timeout --signal=TERM --kill-after=5s 120s'
        self.assertEqual(self.function.count(self.timeout), 1)
        self.assertNotIn('timeout --signal=TERM --kill-after=5s 45s', self.function)
        self.after_parser = self.base / 'after-parser'

    def tearDown(self):
        self.temp.cleanup()

    def tree(self):
        return [(str(path.relative_to(self.base)), path.stat().st_mode,
                 path.read_bytes() if path.is_file() else None)
                for root in (self.live, self.stage) for path in sorted(root.rglob('*'))]

    def run_parser(self, scaled_timeout=None):
        if self.after_parser.exists():
            self.after_parser.unlink()
        function = self.function
        if scaled_timeout is not None:
            # Change only the time budget in this local fixture; the actual
            # parser, TERM signal and five-second kill grace remain unchanged.
            replacement = 'timeout --signal=TERM --kill-after=5s ' + scaled_timeout
            function = function.replace(self.timeout, replacement)
            self.assertEqual(function.replace(replacement, self.timeout), self.function)
        script = ('set -euo pipefail\nwww_root=' + shlex.quote(str(self.live)) +
                  '\nstage_root=' + shlex.quote(str(self.stage)) + '\nsurfaces=(' +
                  ' '.join(shlex.quote(surface) for surface in self.surfaces) + ')\n' +
                  function + '\nverify_prior_asset_compatibility\n: > ' +
                  shlex.quote(str(self.after_parser)) + '\n')
        return subprocess.run(['/usr/bin/bash'], input=script, capture_output=True,
                              text=True, timeout=10)

    def test_valid_prior_closure_passes_actual_120_second_wrapper(self):
        before = self.tree()
        result = self.run_parser()
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(result.stdout.strip(),
                         f'ui_release_compatibility dependencies=20 bytes={20 * len(self.asset_bytes)}')
        self.assertTrue(self.after_parser.exists())
        self.assertEqual(self.tree(), before)

    def test_scaled_timeout_refuses_before_next_step_without_changing_roots(self):
        before = self.tree()
        result = self.run_parser('0.001s')
        self.assertEqual(result.returncode, 124, result.stderr)
        self.assertFalse(self.after_parser.exists())
        self.assertEqual(self.tree(), before)

    def test_longer_timeout_preserves_missing_and_collision_refusals(self):
        target = self.stage / 'proofofwork-activity/assets/prior.js'
        before = self.tree()
        target.unlink()
        result = self.run_parser()
        self.assertEqual(result.returncode, 1, result.stderr)
        self.assertIn('Staged UI release is missing prior dependency:', result.stderr)
        self.assertFalse(self.after_parser.exists())
        target.write_bytes(self.asset_bytes + b'changed')
        result = self.run_parser()
        self.assertEqual(result.returncode, 1, result.stderr)
        self.assertIn('Staged UI compatibility dependency collision differs from prior bytes:', result.stderr)
        self.assertFalse(self.after_parser.exists())
        target.write_bytes(self.asset_bytes)
        self.assertEqual(self.tree(), before)


class PublishProvenance(unittest.TestCase):
    def test_retention_recognizes_complete_historical_families_and_refuses_gaps(self):
        retention = safe_module('../proofofwork-ui-verified-retention.py')
        self.assertEqual(sorted(len(value) for value in retention.SURFACE_FAMILIES), list(range(14, 21)))
        self.assertIn(retention.SURFACES - {'jobs'}, retention.SURFACE_FAMILIES)
        self.assertNotIn(retention.SURFACES - {'code'}, retention.SURFACE_FAMILIES)
        self.assertNotIn(retention.SURFACES - {'publish'}, retention.SURFACE_FAMILIES)

    def test_actual_helper_records_and_verifies_all_14_through_20_surface_history(self):
        surfaces = safe_module('release.py').SURFACES
        capacity = ROOT.parents[1] / 'deploy/proofofwork-ui-capacity.py'
        provenance = ROOT.parents[1] / 'deploy/proofofwork-ui-release-provenance.sh'
        with tempfile.TemporaryDirectory(prefix='pow-publish-history-', dir='/tmp') as name:
            base = Path(name).resolve()
            for omitted in ({'jobs', 'code', 'search', 'publish', 'dns', 'boost'}, {'jobs', 'code', 'search', 'publish', 'dns'},
                            {'jobs', 'code', 'search', 'publish'}, {'jobs', 'code', 'search'}, {'jobs', 'code'}, {'jobs'}, set()):
                included = [surface for surface in surfaces if surface not in omitted]
                case = base / str(len(included)); case.mkdir(mode=0o700)
                www, archives, scratch = [case / label for label in ('www', 'archives', 'scratch')]
                for target in (www, archives, scratch): target.mkdir(mode=0o755)
                for surface in included:
                    target = www / ('proofofwork-' + surface); target.mkdir(mode=0o755)
                    (target / 'index.html').write_bytes(b'<html><script src="/assets/main.js"></script></html>')
                    (target / 'assets').mkdir(mode=0o755)
                    (target / 'assets/main.js').write_bytes(b'const historical = true;')
                    (target / 'assets/main.js').chmod(0o644)
                    (target / 'index.html').chmod(0o644)
                archive = archives / ('proofofwork-ui-release-family-' + str(len(included)) + '.tgz')
                with tarfile.open(archive, 'w:gz') as target:
                    for surface in included:
                        target.add(www / ('proofofwork-' + surface), arcname='surfaces/' + surface)
                archive.chmod(0o644)
                Path(str(archive) + '.sha256').write_text(hashlib.sha256(archive.read_bytes()).hexdigest() + '  ' + archive.name + '\n')
                Path(str(archive) + '.sha256').chmod(0o644)
                environment = {**os.environ, 'POW_UI_ALLOW_TEST_ROOTS': '1', 'POW_UI_WWW_ROOT': str(www),
                    'POW_UI_RELEASE_ARCHIVE_ROOT': str(archives), 'POW_UI_CAPACITY_SCRIPT': str(capacity),
                    'POW_UI_DEPLOY_LOCK': str(case / 'deploy.lock'), 'TMPDIR': str(scratch)}
                for command in (['record-rollback-evidence', '--archive', str(archive)], ['verify-rollback']):
                    result = subprocess.run(['/bin/bash', str(provenance), *command], env=environment,
                        capture_output=True, text=True, timeout=120)
                    self.assertEqual(result.returncode, 0, result.stderr)
                manifest = (www / '.proofofwork-ui-release').read_text()
                self.assertEqual(sum(line.endswith('.file_count=2') for line in manifest.splitlines()), len(included))
                self.assertEqual('surface.publish.sha256=' in manifest, 'publish' in included)
                self.assertEqual('surface.search.sha256=' in manifest, 'search' in included)
                self.assertEqual('surface.code.sha256=' in manifest, 'code' in included)
                self.assertEqual('surface.jobs.sha256=' in manifest, 'jobs' in included)
                self.assertEqual(list(scratch.iterdir()), [])


class PublishCapacity(unittest.TestCase):
    def test_all_20_incoming_roots_are_required_and_links_refused(self):
        capacity = safe_module('phase_capacity.py')
        with tempfile.TemporaryDirectory(prefix='pow-publish-capacity-', dir='/tmp') as name:
            root = Path(name).resolve()
            for surface in capacity.SURFACES:
                target = root / surface
                target.mkdir(mode=0o755)
                (target / 'index.html').write_bytes(b'exact UI')
                (target / 'index.html').chmod(0o644)
            result = capacity.tree_budget(root, owner=os.geteuid())
            self.assertGreater(result['archiveUpperBoundBytes'], 19 * len(b'exact UI'))
            omitted = root / 'jobs'
            omitted.rename(root / 'other')
            with self.assertRaisesRegex(ValueError, 'complete managed set'):
                capacity.tree_budget(root, owner=os.geteuid())
            (root / 'other').rename(omitted)
            (omitted / 'index.html').unlink()
            (omitted / 'index.html').symlink_to(root / 'work/index.html')
            with self.assertRaisesRegex(ValueError, 'link|Unsafe'):
                capacity.tree_budget(root, owner=os.geteuid())

    def test_preflight_accounts_historical_16_through_19_and_next_20_surface_roots(self):
        code = statement_range('preflight.py', 'old_managed', 'storage')
        with tempfile.TemporaryDirectory(prefix='pow-publish-preflight-', dir='/tmp') as name:
            root = Path(name).resolve()
            for surface in safe_module('release.py').SURFACES:
                if surface in ('publish', 'search', 'code', 'jobs'): continue
                target = root / ('proofofwork-' + surface)
                target.mkdir()
                (target / 'index.html').write_bytes(b'123')
            def local_path(value):
                prefix = '/var/www/'
                return root / value[len(prefix):] if value.startswith(prefix) else Path(value)
            namespace = functions_only('preflight.py', set())
            namespace.update(Path=local_path, active_manifest={})
            exec(code, namespace)
            self.assertEqual(namespace['old_managed']['regularFiles'], 16)
            self.assertEqual(namespace['old_managed']['logicalBytes'], 48)
            (root / 'proofofwork-publish').mkdir()
            (root / 'proofofwork-publish/index.html').write_bytes(b'12345')
            exec(code, namespace)
            self.assertEqual(namespace['old_managed']['regularFiles'], 17)
            self.assertEqual(namespace['old_managed']['logicalBytes'], 53)
            (root / 'proofofwork-search').mkdir()
            (root / 'proofofwork-search/index.html').write_bytes(b'1234567')
            exec(code, namespace)
            self.assertEqual(namespace['old_managed']['regularFiles'], 18)
            self.assertEqual(namespace['old_managed']['logicalBytes'], 60)
            (root / 'proofofwork-code').mkdir()
            (root / 'proofofwork-code/index.html').write_bytes(b'123456789')
            exec(code, namespace)
            self.assertEqual(namespace['old_managed']['regularFiles'], 19)
            self.assertEqual(namespace['old_managed']['logicalBytes'], 69)
            (root / 'proofofwork-jobs').mkdir()
            (root / 'proofofwork-jobs/index.html').write_bytes(b'12345678901')
            exec(code, namespace)
            self.assertEqual(namespace['old_managed']['regularFiles'], 20)
            self.assertEqual(namespace['old_managed']['logicalBytes'], 80)


class PreservedTransport(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory(prefix='pow-preserved-transport-', dir='/tmp')
        self.base = Path(self.temporary.name).resolve()
        self.release = safe_module('release.py')

    def tearDown(self): self.temporary.cleanup()

    def surfaces(self):
        top = 'proofofwork-ui-surfaces-' + RELEASE
        members = [(top, b'', tarfile.DIRTYPE), (top + '/surfaces', b'', tarfile.DIRTYPE)]
        for name in self.release.SURFACES:
            members += [(top + '/surfaces/' + name, b'', tarfile.DIRTYPE),
                        (top + '/surfaces/' + name + '/index.html', name.encode(), tarfile.REGTYPE)]
        path = self.base / 'surfaces.tgz'; write_tar(path, members)
        return path, members

    def test_independent_archive_fingerprint_matches_actual_extracted_payload(self):
        path, _ = self.surfaces()
        expected = self.release.bundle_payload_fingerprint(path, RELEASE)
        receiver_path = ROOT.parents[1] / 'deploy/audit5/stream-ui-bundle.py'
        receiver = {'__name__': '_pinned_surface_receiver_fixture'}
        exec(compile(receiver_path.read_bytes(), str(receiver_path), 'exec'), receiver)
        lock = self.base/'deploy.lock'; lock.write_bytes(b''); lock.chmod(0o600)
        raw = path.read_bytes()
        receiver['receive']('surfaces', RELEASE, len(raw), hashlib.sha256(raw).hexdigest(),
                            io.BytesIO(raw), self.base, lock, owner=os.geteuid(), floor=0)
        namespace = functions_only('remote_transport.py', {'payload_fingerprint', 'identity'})
        root = self.base / ('proofofwork-ui-surfaces-' + RELEASE)
        original_lstat, original_fstat = Path.lstat, os.fstat
        def owned(details):
            row = types.SimpleNamespace(**{k: getattr(details, k) for k in dir(details) if k.startswith('st_')})
            row.st_uid = row.st_gid = 0
            return row
        with patch.object(Path, 'lstat', lambda p: owned(original_lstat(p))), patch.object(os, 'fstat', lambda fd: owned(original_fstat(fd))):
            self.assertEqual(namespace['payload_fingerprint'](root), expected)
            (root / 'surfaces/publish/index.html').write_bytes(b'changed')
            self.assertNotEqual(namespace['payload_fingerprint'](root), expected)

    def test_archive_fingerprint_refuses_links_duplicates_escapes_and_extra_roots(self):
        path, members = self.surfaces()
        top = 'proofofwork-ui-surfaces-' + RELEASE
        for extra in [(top + '/surfaces/publish/link', b'', tarfile.SYMTYPE),
                      (top + '/surfaces/publish/index.html', b'duplicate', tarfile.REGTYPE),
                      (top + '/surfaces/../escape', b'escape', tarfile.REGTYPE),
                      (top + '/other', b'extra', tarfile.REGTYPE)]:
            with self.subTest(extra=extra):
                write_tar(path, members + [extra])
                with self.assertRaises(AssertionError): self.release.bundle_payload_fingerprint(path, RELEASE)

    def test_deployment_only_artifact_reuse_rejects_any_application_change(self):
        tooling_commit, tooling_tree = 'c'*40, 'd'*40
        def git(argv, **kwargs):
            if argv[-1] == 'HEAD': return tooling_commit + '\n'
            if argv[-1] == 'HEAD^{tree}': return tooling_tree + '\n'
            if argv[-1] == COMMIT + '^{tree}': return TREE + '\n'
            if 'diff' in argv: return self.changed + '\n'
            return b''
        with patch.object(subprocess, 'check_output', side_effect=git):
            self.changed = 'deploy/publish/remote_transport.py'
            binding = self.release.artifact_tooling_binding(COMMIT, TREE)
            self.assertEqual(binding['toolingCommit'], tooling_commit)
            self.assertEqual(binding['toolingTree'], tooling_tree)
            for self.changed in ('src/BoostRoot.tsx', 'package-lock.json', 'deploy/Caddyfile', 'assets/hidden.js', 'server/proof-api.mjs'):
                with self.subTest(path=self.changed), self.assertRaisesRegex(AssertionError, 'outside deployment-only'):
                    self.release.artifact_tooling_binding(COMMIT, TREE)
            self.changed = 'deploy/publish/remote_transport.py'
            with self.assertRaisesRegex(AssertionError, 'Artifact tree'):
                self.release.artifact_tooling_binding(COMMIT, 'f'*40)

    def resume_fixture(self):
        namespace = functions_only('remote_transport.py', {'validate_resume'})
        namespace.update(BASE=self.base, directory=lambda path: path.resolve(strict=True))
        original = {'releaseId': RELEASE, 'commit': COMMIT, 'tree': TREE, 'publicationAttempt': 'initial',
                    'source': {'sha256': '1'*64}, 'surfaces': {'sha256': '2'*64},
                    'oldLiveManifestSha256': '3'*64, 'oldFullRootTreeSha256': '4'*64, 'retainedRoots': []}
        failed_plan = self.base / ('recovery-plan-' + RELEASE + '-initial.json')
        failed_plan.write_bytes(raw_json(original)); plan_sha = hashlib.sha256(failed_plan.read_bytes()).hexdigest()
        failed = self.base / ('recovery-transport-' + RELEASE + '-surfaces-stage'); failed.mkdir(mode=0o700)
        receipt = {'status': 'verified', 'kind': 'surfaces', 'releaseId': RELEASE}
        receiver = self.base / ('audit5-stream-surfaces-' + RELEASE + '.json'); receiver.write_bytes(raw_json(receipt))
        values = {'intent.json': raw_json({'planSha256': plan_sha, 'phase': 'surfaces-stage'}),
                  'receive-admission.log': b'exact admission\n', 'receiver.log': raw_json(receipt),
                  'stage-model.json': b'{"inputStabilityVerified":true}\n',
                  'stage-check-scratch.json': b'UI deployment scratch review required ' + raw_json({
                      'maximumBytes': 5*1024**3, 'allocatedBytes': 5*1024**3-100,
                      'additionalBytes': 200, 'cleanupApproved': False, 'phase': 'recovery-stage', 'path': str(self.base)})}
        for name, raw in values.items(): (failed / name).write_bytes(raw)
        def bound(path, sha, maximum):
            raw = Path(path).read_bytes()
            assert len(raw) <= maximum and hashlib.sha256(raw).hexdigest() == sha
            return raw
        namespace['bound'] = bound
        current = {**original, 'publicationAttempt': 'preserved-v1', 'resumeSurfaces': {
            'failedPlanPath': str(failed_plan), 'failedPlanSha256': plan_sha, 'failedEvidence': str(failed),
            'failedRecords': {name: {'sha256': hashlib.sha256(raw).hexdigest(), 'bytes': len(raw)} for name, raw in values.items()},
            'receiverReceiptPath': str(receiver), 'receiverReceiptSha256': hashlib.sha256(receiver.read_bytes()).hexdigest()}}
        return namespace['validate_resume'], current, failed, receiver

    def test_resume_recognizes_only_exact_failed_admission_and_preserves_old_evidence(self):
        validate, plan, failed, receiver = self.resume_fixture()
        before = {path.name: path.read_bytes() for path in failed.iterdir()}
        self.assertEqual(validate(plan), json.loads(receiver.read_bytes()))
        self.assertEqual(before, {path.name: path.read_bytes() for path in failed.iterdir()})
        for key in ('failedPlanSha256', 'receiverReceiptSha256'):
            bad = copy.deepcopy(plan); bad['resumeSurfaces'][key] = '0'*64
            with self.subTest(key=key), self.assertRaises(AssertionError): validate(bad)
        for name in ('stager.log', 'receipt.json'):
            path = failed / name; path.write_bytes(b'evidence of attempted staging')
            with self.assertRaises(AssertionError): validate(plan)
            path.unlink()
        bad = copy.deepcopy(plan); bad['publicationAttempt'] = 'initial'
        with self.assertRaises(AssertionError): validate(bad)
        receiver.write_bytes(b'changed')
        with self.assertRaises(AssertionError): validate(plan)

    def test_resume_dispatch_uses_fresh_unit_without_another_payload_stream(self):
        bundle = self.base / 'bundle.tgz'; bundle.write_bytes(b'exact approved archive')
        transport = safe_module('transport_preserve.py')
        plan = {'releaseId': RELEASE, 'publicationAttempt': 'preserved-v1', 'inputStorage': 'release-evidence-v1',
                'resumeSurfaces': {'verified': True}, 'preservingTransportSha256': self.release.digest(ROOT/'remote_transport.py'),
                'localBundles': {'surfaces': str(bundle)}, 'surfaces': {'compressedBytes': bundle.stat().st_size, 'sha256': self.release.digest(bundle)}}
        path = self.base / 'plan.json'; path.write_bytes(raw_json(plan)); log = self.base / 'resume.log'
        previous_umask = os.umask(0o022)
        try:
            with patch('sys.argv', ['transport_preserve.py', str(path), 'surfaces-stage-resume', str(log)]), patch.object(subprocess, 'run') as run:
                transport.main()
                self.assertEqual(run.call_args.kwargs['stdin'], subprocess.DEVNULL)
                command = run.call_args.args[0][-1]
                self.assertIn('surfaces-stage-resume-preserved-v1.service', command)
                self.assertIn('Transport unit namespace occupied', command)
        finally: os.umask(previous_umask)

    def test_original_pinned_receiver_preserves_source_pool_and_refuses_changed_stream(self):
        receiver_path = ROOT.parents[1] / 'deploy/audit5/stream-ui-bundle.py'
        namespace = {'__name__': '_pinned_receiver_fixture'}
        exec(compile(receiver_path.read_bytes(), str(receiver_path), 'exec'), namespace)
        pool = self.base / 'evidence'; pool.mkdir(mode=0o700)
        lock = self.base / 'deploy.lock'; lock.write_bytes(b''); lock.chmod(0o600)
        top = 'proofofwork-ui-source-' + RELEASE
        tar = self.base / 'source.tgz'; write_tar(tar, [(top, b'', tarfile.DIRTYPE), (top+'/README.md', b'pinned source', tarfile.REGTYPE)])
        raw = tar.read_bytes(); sha = hashlib.sha256(raw).hexdigest()
        receipt = namespace['receive']('source', RELEASE, len(raw), sha, io.BytesIO(raw), pool, lock,
                                      owner=os.geteuid(), floor=0)
        self.assertEqual(receipt['extractedRoot'], str(pool/top))
        self.assertEqual((pool/top/'README.md').read_bytes(), b'pinned source')
        self.assertFalse((self.base/top).exists())
        second = self.base/'failed-pool'; second.mkdir(mode=0o700)
        with self.assertRaisesRegex(RuntimeError, 'digest mismatch'):
            namespace['receive']('source', RELEASE, len(raw), '0'*64, io.BytesIO(raw), second, lock,
                                 owner=os.geteuid(), floor=0)
        self.assertTrue((second/('.audit5-stream-source-'+RELEASE)/top/'README.md').exists())
        self.assertFalse((second/top).exists())

    def preserved_stage_fixture(self):
        validate_initial, original, first_failed, receiver = self.resume_fixture()
        evidence = self.base / 'evidence'; evidence.mkdir(mode=0o700)
        release_root = evidence / RELEASE; release_root.mkdir(mode=0o700)
        original.update(inputStorage='release-evidence-v1',
            preservedSurfacesRoot=str(release_root / ('proofofwork-ui-surfaces-' + RELEASE) / 'surfaces'),
            preservedSourceCheckout=str(release_root / ('proofofwork-ui-source-' + RELEASE)),
            surfacesPayloadFingerprint={'sha256': '8'*64, 'entries': 2, 'regularBytes': 12})
        original_path = self.base / ('recovery-plan-' + RELEASE + '-preserved-v1.json')
        original_path.write_bytes(raw_json(original)); original_sha = self.release.digest(original_path)
        incoming = {'format': 'proof-of-work-ui-incoming-evidence-v1', 'releaseId': RELEASE,
            'commit': COMMIT, 'tree': TREE, 'planSha256': original_sha,
            'payloadFingerprint': original['surfacesPayloadFingerprint'],
            'preservedPath': str(Path(original['preservedSurfacesRoot']).parent),
            'movePreservedInodes': True, 'historicalDeletion': False,
            'receiverReceipt': validate_initial(original)}
        incoming_path = release_root / 'incoming-receipt.json'; incoming_path.write_bytes(raw_json(incoming))
        failed = self.base / ('recovery-transport-' + RELEASE + '-surfaces-stage-resume-preserved-v1'); failed.mkdir(mode=0o700)
        refusal = {'maximumBytes': 5*1024**3, 'allocatedBytes': 5*1024**3-100,
                   'additionalBytes': 200, 'cleanupApproved': False, 'phase': 'stage-private-root', 'path': str(self.base)}
        values = {'intent.json': raw_json({'planSha256': original_sha, 'phase': 'surfaces-stage-resume'}),
            'input-evidence-check.json': raw_json({'status': 'sufficient'}),
            'stage-model.json': raw_json({'inputStabilityVerified': True}),
            'stage-check-scratch.json': raw_json({'status': 'sufficient'}),
            'stage-check.json': raw_json({'status': 'sufficient'}),
            'stager.log': b'UI deployment scratch review required ' + raw_json(refusal)}
        for name, raw in values.items(): (failed / name).write_bytes(raw)
        current = {**original, 'publicationAttempt': 'completed-v1'}; del current['resumeSurfaces']
        private = release_root / ('.proofofwork-ui-stage-' + RELEASE + '.completed-v1')
        current['preservedStageResume'] = {'failedPlanPath': str(original_path), 'failedPlanSha256': original_sha,
            'failedEvidence': str(failed), 'failedRecords': {name: {'sha256': hashlib.sha256(raw).hexdigest(), 'bytes': len(raw)} for name, raw in values.items()},
            'incomingReceiptPath': str(incoming_path), 'incomingReceiptSha256': self.release.digest(incoming_path),
            'incomingReceiptBytes': incoming_path.stat().st_size, 'fullCopyRefusal': refusal,
            'candidateStorage': 'release-evidence-v1', 'privateCandidateParent': str(private)}
        namespace = functions_only('remote_transport.py', {'validate_preserved_stage', 'validate_resume'})
        def bound(path, sha, maximum):
            raw = Path(path).read_bytes(); assert len(raw) <= maximum and hashlib.sha256(raw).hexdigest() == sha
            return raw
        namespace.update(BASE=self.base, EVIDENCE=evidence, bound=bound,
                         directory=lambda path: Path(path).resolve(strict=True),
                         validate_evidence_ancestors=lambda *args, **kwargs: release_root)
        return namespace['validate_preserved_stage'], current, incoming_path, failed, private

    def test_preserved_resume_binds_refusal_receipt_and_fresh_namespace_without_replaying_input_move(self):
        validate, plan, incoming, failed, private = self.preserved_stage_fixture()
        original = {path.name: path.read_bytes() for path in failed.iterdir()}; receipt = incoming.read_bytes()
        self.assertEqual(validate(plan), json.loads(receipt))
        self.assertEqual(receipt, incoming.read_bytes()); self.assertEqual(original, {path.name: path.read_bytes() for path in failed.iterdir()})
        self.assertFalse(private.exists())
        for key in ('incomingReceiptSha256', 'failedPlanSha256'):
            bad = copy.deepcopy(plan); bad['preservedStageResume'][key] = '0'*64
            with self.subTest(key=key), self.assertRaises(AssertionError): validate(bad)
        for key, value in (('candidateStorage', 'deploy-scratch'), ('privateCandidateParent', str(private)+'-sibling')):
            bad = copy.deepcopy(plan); bad['preservedStageResume'][key] = value
            with self.subTest(key=key), self.assertRaises(AssertionError): validate(bad)
        bad = copy.deepcopy(plan); bad['preservedStageResume']['fullCopyRefusal']['maximumBytes'] += 1
        with self.assertRaises(AssertionError): validate(bad)
        private.mkdir(mode=0o700)
        with self.assertRaises(AssertionError): validate(plan)
        self.assertEqual(receipt, incoming.read_bytes()); self.assertEqual(original, {path.name: path.read_bytes() for path in failed.iterdir()})

    def test_preserved_resume_refuses_any_changed_or_extra_failure_record(self):
        validate, plan, incoming, failed, private = self.preserved_stage_fixture()
        stager = failed / 'stager.log'; before = stager.read_bytes(); stager.write_bytes(before+b'changed')
        with self.assertRaises(AssertionError): validate(plan)
        stager.write_bytes(before)
        (failed / 'receipt.json').write_bytes(b'previous success')
        with self.assertRaises(AssertionError): validate(plan)
        self.assertFalse(private.exists())

    def test_plan_binding_requires_exact_original_preserved_failure_receipt_and_inventory(self):
        _, local_plan, incoming_path, failed, _ = self.preserved_stage_fixture()
        release_root = '/var/backups/proofofwork-ui/transport-evidence/' + RELEASE
        original = json.loads(Path(local_plan['preservedStageResume']['failedPlanPath']).read_bytes())
        original.update(schema='proof-of-work-audit29-ui-transport-plan-v1',
            preservedSurfacesRoot=release_root + '/proofofwork-ui-surfaces-' + RELEASE + '/surfaces',
            preservedSourceCheckout=release_root + '/proofofwork-ui-source-' + RELEASE)
        original_path = self.base / 'original-plan-local.json'; original_path.write_bytes(raw_json(original))
        original_sha = self.release.digest(original_path)
        current = {**original, 'publicationAttempt': 'completed-v1'}; del current['resumeSurfaces']
        records = {}
        for path in failed.iterdir():
            raw = path.read_bytes(); value = raw.decode() if path.name == 'stager.log' else json.loads(raw)
            if path.name == 'intent.json': value['planSha256'] = original_sha
            if path.name == 'stager.log':
                prefix = 'UI deployment scratch review required '
                refusal = json.loads(value[len(prefix):]); refusal['path'] = '/var/tmp/proofofwork-deploy'
                value = prefix + raw_json(refusal).decode(); raw = value.encode()
            else: raw = raw_json(value)
            records[path.name] = {'value': value, 'sha256': hashlib.sha256(raw).hexdigest(), 'bytes': len(raw)}
        evidence = {'evidence': '/var/tmp/proofofwork-deploy/recovery-transport-' + RELEASE + '-surfaces-stage-resume-preserved-v1',
                    'stageExists': False, 'sourceExists': False, 'privateStages': [], 'preservedInputExists': True, 'records': records}
        incoming = json.loads(incoming_path.read_bytes()); incoming.update(planSha256=original_sha,
            preservedPath=str(Path(original['preservedSurfacesRoot']).parent))
        incoming_raw = raw_json(incoming)
        incoming_record = {'path': release_root+'/incoming-receipt.json', 'value': incoming,
            'sha256': hashlib.sha256(incoming_raw).hexdigest(), 'bytes': len(incoming_raw)}
        inventory = {'stageExists': False, 'sourceExists': False, 'privateStages': [], 'allLiveAndRetainedRootsUnchanged': True,
            'live': {'manifestSha256': original['oldLiveManifestSha256'], 'treeSha256': original['oldFullRootTreeSha256']}, 'retained': original['retainedRoots']}
        paths = [self.base / name for name in ('refusal-evidence.json', 'incoming-record.json', 'root-proof.json')]
        for path, value in zip(paths, (evidence, incoming_record, inventory)): path.write_bytes(raw_json(value))
        args = types.SimpleNamespace(preserved_plan=original_path, preserved_evidence=paths[0],
            preserved_incoming_receipt=paths[1], preserved_inventory=paths[2])
        binding = self.release.preserved_stage_binding(args, current)
        self.assertEqual(binding['incomingReceiptSha256'], incoming_record['sha256'])
        self.assertEqual(binding['privateCandidateParent'], release_root + '/.proofofwork-ui-stage-' + RELEASE + '.completed-v1')
        bad = {**current, 'publicationAttempt': 'preserved-v1'}
        with self.assertRaisesRegex(AssertionError, 'fresh attempt'): self.release.preserved_stage_binding(args, bad)
        inventory['stageExists'] = True; paths[2].write_bytes(raw_json(inventory))
        with self.assertRaises(AssertionError): self.release.preserved_stage_binding(args, current)

    def test_preserved_stage_dispatch_has_no_stream_and_exact_new_phase_unit(self):
        bundle = self.base / 'bundle.tgz'; bundle.write_bytes(b'exact approved archive')
        transport = safe_module('transport_preserve.py')
        plan = {'releaseId': RELEASE, 'publicationAttempt': 'completed-v1', 'inputStorage': 'release-evidence-v1',
                'preservedStageResume': {'verified': True}, 'preservingTransportSha256': self.release.digest(ROOT/'remote_transport.py'),
                'localBundles': {'surfaces': str(bundle)}, 'surfaces': {'compressedBytes': bundle.stat().st_size, 'sha256': self.release.digest(bundle)}}
        path = self.base / 'preserved-plan.json'; path.write_bytes(raw_json(plan)); log = self.base / 'preserved-resume.log'
        previous_umask = os.umask(0o022)
        try:
            with patch('sys.argv', ['transport_preserve.py', str(path), 'preserved-stage-resume', str(log)]), patch.object(subprocess, 'run') as run:
                transport.main()
                self.assertEqual(run.call_args.kwargs['stdin'], subprocess.DEVNULL)
                command = run.call_args.args[0][-1]
                self.assertIn('preserved-stage-resume-completed-v1.service', command)
                self.assertIn('Transport unit namespace occupied', command)
        finally: os.umask(previous_umask)


    def initial_preserved_stage_fixture(self):
        validate, current, incoming_path, old_failed, private = self.preserved_stage_fixture()
        original = json.loads(Path(current['preservedStageResume']['failedPlanPath']).read_bytes())
        del original['resumeSurfaces']; original['publicationAttempt'] = 'initial'
        original['surfaces']['compressedBytes'] = 100
        original_path = self.base / ('recovery-plan-' + RELEASE + '-initial.json')
        original_path.write_bytes(raw_json(original)); original_sha = self.release.digest(original_path)
        receiver_path = self.base / ('audit5-stream-surfaces-' + RELEASE + '.json')
        receiver = {'status': 'verified', 'kind': 'surfaces', 'releaseId': RELEASE,
            'archiveSha256': original['surfaces']['sha256'], 'compressedBytes': 100,
            'entries': 2, 'logicalBytes': 12,
            'extractedRoot': str(self.base / ('proofofwork-ui-surfaces-' + RELEASE))}
        receiver_path.write_bytes(raw_json(receiver))
        failed = self.base / ('recovery-transport-' + RELEASE + '-surfaces-stage-initial')
        failed.mkdir(mode=0o700)
        values = {path.name: path.read_bytes() for path in old_failed.iterdir()}
        values['intent.json'] = raw_json({'planSha256': original_sha, 'phase': 'surfaces-stage'})
        values['receive-admission.log'] = raw_json({'ok': True, 'phase': 'preflight'})
        values['receiver.log'] = raw_json(receiver)
        for name, raw in values.items(): (failed / name).write_bytes(raw)
        incoming = json.loads(incoming_path.read_bytes())
        incoming.update(planSha256=original_sha, receiverReceipt=receiver)
        incoming_path.write_bytes(raw_json(incoming))
        current = {**original, 'publicationAttempt': 'completed-v1',
            'preservedStageResume': {**current['preservedStageResume'],
                'failedPlanPath': str(original_path), 'failedPlanSha256': original_sha,
                'failedEvidence': str(failed),
                'failedRecords': {name: {'sha256': self.release.digest(failed/name), 'bytes': (failed/name).stat().st_size} for name in values},
                'incomingReceiptSha256': self.release.digest(incoming_path), 'incomingReceiptBytes': incoming_path.stat().st_size,
                'receiverReceiptPath': str(receiver_path), 'receiverReceiptSha256': self.release.digest(receiver_path)}}
        return validate, current, incoming_path, failed, private, receiver_path

    def test_initial_preserved_resume_recognizes_exact_eight_records_and_preserves_all_evidence(self):
        validate, plan, incoming, failed, private, receiver = self.initial_preserved_stage_fixture()
        before = {path.name: path.read_bytes() for path in failed.iterdir()}
        original_receipt, original_receiver = incoming.read_bytes(), receiver.read_bytes()
        self.assertEqual(validate(plan), json.loads(original_receipt))
        self.assertEqual(len(plan['preservedStageResume']['failedRecords']), 8)
        self.assertEqual(before, {path.name: path.read_bytes() for path in failed.iterdir()})
        self.assertEqual(original_receipt, incoming.read_bytes()); self.assertEqual(original_receiver, receiver.read_bytes())
        self.assertFalse(private.exists())
        for key in ('failedPlanSha256', 'incomingReceiptSha256', 'receiverReceiptSha256'):
            bad = copy.deepcopy(plan); bad['preservedStageResume'][key] = '0'*64
            with self.subTest(key=key), self.assertRaises(AssertionError): validate(bad)
        bad = copy.deepcopy(plan); bad['preservedStageResume']['receiverReceiptPath'] += '-sibling'
        with self.assertRaises(AssertionError): validate(bad)
        for name in ('receive-admission.log', 'receiver.log'):
            bad = copy.deepcopy(plan); del bad['preservedStageResume']['failedRecords'][name]
            with self.subTest(record=name), self.assertRaises(AssertionError): validate(bad)
        (failed/'receipt.json').write_bytes(b'previous success')
        with self.assertRaises(AssertionError): validate(plan)

    def test_initial_preserved_resume_refuses_coordinated_receiver_field_changes_and_disagreement(self):
        validate, plan, incoming_path, failed, private, receiver_path = self.initial_preserved_stage_fixture()
        initial_receiver = json.loads(receiver_path.read_bytes()); initial_incoming = json.loads(incoming_path.read_bytes())
        for key, value in (('status','other'), ('kind','source'), ('releaseId','other'), ('archiveSha256','0'*64),
                           ('compressedBytes',101), ('entries',3), ('logicalBytes',13), ('extractedRoot',str(self.base/'sibling'))):
            changed = {**initial_receiver, key:value}; receiver_path.write_bytes(raw_json(changed))
            (failed/'receiver.log').write_bytes(raw_json(changed))
            incoming_path.write_bytes(raw_json({**initial_incoming, 'receiverReceipt': changed}))
            bad = copy.deepcopy(plan); binding=bad['preservedStageResume']
            binding.update(receiverReceiptSha256=self.release.digest(receiver_path),
                           incomingReceiptSha256=self.release.digest(incoming_path), incomingReceiptBytes=incoming_path.stat().st_size)
            binding['failedRecords']['receiver.log']={'sha256':self.release.digest(failed/'receiver.log'), 'bytes':(failed/'receiver.log').stat().st_size}
            with self.subTest(key=key), self.assertRaises(AssertionError): validate(bad)
        receiver_path.write_bytes(raw_json(initial_receiver)); (failed/'receiver.log').write_bytes(raw_json(initial_receiver))
        incoming_path.write_bytes(raw_json({**initial_incoming, 'receiverReceipt': {**initial_receiver, 'logicalBytes': 13}}))
        bad=copy.deepcopy(plan); bad['preservedStageResume'].update(incomingReceiptSha256=self.release.digest(incoming_path), incomingReceiptBytes=incoming_path.stat().st_size)
        with self.assertRaises(AssertionError): validate(bad)
        self.assertFalse(private.exists())

    def test_initial_preserved_resume_refuses_phase_attempt_namespace_and_changed_admission(self):
        validate, plan, incoming, failed, private, receiver = self.initial_preserved_stage_fixture()
        bad = copy.deepcopy(plan); bad['publicationAttempt']='initial'
        with self.assertRaises(AssertionError): validate(bad)
        intent = json.loads((failed/'intent.json').read_bytes()); intent['phase']='surfaces-stage-resume'
        raw=raw_json(intent); (failed/'intent.json').write_bytes(raw)
        bad=copy.deepcopy(plan); bad['preservedStageResume']['failedRecords']['intent.json']={'sha256':hashlib.sha256(raw).hexdigest(),'bytes':len(raw)}
        with self.assertRaises(AssertionError): validate(bad)
        intent['phase']='surfaces-stage'; (failed/'intent.json').write_bytes(raw_json(intent))
        admission = failed/'receive-admission.log'; before=admission.read_bytes(); admission.write_bytes(before+b'changed')
        with self.assertRaises(AssertionError): validate(plan)
        admission.write_bytes(before)
        self.assertEqual(validate(plan),json.loads(incoming.read_bytes()))
        private.mkdir(mode=0o700)
        with self.assertRaises(AssertionError): validate(plan)

    def test_initial_preserved_resume_refuses_false_resume_noninitial_attempt_and_changed_root_bindings(self):
        validate,plan,incoming,failed,private,receiver=self.initial_preserved_stage_fixture()
        original_path=Path(plan['preservedStageResume']['failedPlanPath']); original=json.loads(original_path.read_bytes())
        for changed in ({**original,'resumeSurfaces':False}, {**original,'resumeSurfaces':{}},
                        {**original,'publicationAttempt':'other'}, {**original,'preservedStageResume':{}},
                        {**original,'inputStorage':'other'}):
            original_path.write_bytes(raw_json(changed)); bad=copy.deepcopy(plan)
            bad['preservedStageResume']['failedPlanSha256']=self.release.digest(original_path)
            with self.subTest(change=changed), self.assertRaises(AssertionError): validate(bad)
        original_path.write_bytes(raw_json(original))
        for key,value in (('oldLiveManifestSha256','0'*64),('oldFullRootTreeSha256','0'*64),('retainedRoots',[{}]),
                          ('surfacesPayloadFingerprint',{'sha256':'0'*64,'entries':2,'regularBytes':12}),
                          ('preservedSurfacesRoot',str(self.base/'sibling/surfaces'))):
            bad=copy.deepcopy(plan); bad[key]=value
            with self.subTest(key=key), self.assertRaises(AssertionError): validate(bad)
        self.assertEqual(validate(plan),json.loads(incoming.read_bytes()))

    def initial_local_binding_fixture(self):
        _, remote_plan, incoming_path, failed, _, receiver_path = self.initial_preserved_stage_fixture()
        original = json.loads(Path(remote_plan['preservedStageResume']['failedPlanPath']).read_bytes())
        old_base = str(self.base); canonical_base = '/var/tmp/proofofwork-deploy'
        canonical_pool = '/var/backups/proofofwork-ui/transport-evidence/' + RELEASE
        original.update(schema='proof-of-work-audit29-ui-transport-plan-v1',
            preservedSurfacesRoot=canonical_pool+'/proofofwork-ui-surfaces-'+RELEASE+'/surfaces',
            preservedSourceCheckout=canonical_pool+'/proofofwork-ui-source-'+RELEASE)
        original_path = self.base/'original-local-plan.json'; original_path.write_bytes(raw_json(original))
        original_sha=self.release.digest(original_path); current={**original,'publicationAttempt':'completed-v1'}
        receiver=json.loads(receiver_path.read_bytes()); receiver['extractedRoot']=canonical_base+'/proofofwork-ui-surfaces-'+RELEASE
        records={}
        for path in failed.iterdir():
            raw=path.read_bytes(); value=raw.decode() if path.name=='stager.log' else json.loads(raw)
            if path.name=='intent.json': value['planSha256']=original_sha
            if path.name=='receiver.log': value=receiver
            if path.name=='stager.log':
                prefix='UI deployment scratch review required '; refusal=json.loads(value[len(prefix):]); refusal['path']=canonical_base
                value=prefix+raw_json(refusal).decode(); raw=value.encode()
            else: raw=raw_json(value)
            records[path.name]={'value':value,'sha256':hashlib.sha256(raw).hexdigest(),'bytes':len(raw)}
        evidence={'evidence':canonical_base+'/recovery-transport-'+RELEASE+'-surfaces-stage-initial',
                  'stageExists':False,'sourceExists':False,'privateStages':[],'preservedInputExists':True,'records':records}
        incoming=json.loads(incoming_path.read_bytes()); incoming.update(planSha256=original_sha,
            preservedPath=str(Path(original['preservedSurfacesRoot']).parent),receiverReceipt=receiver)
        incoming_raw=raw_json(incoming)
        incoming_record={'path':canonical_pool+'/incoming-receipt.json','value':incoming,
                         'sha256':hashlib.sha256(incoming_raw).hexdigest(),'bytes':len(incoming_raw)}
        inventory={'stageExists':False,'sourceExists':False,'privateStages':[],'allLiveAndRetainedRootsUnchanged':True,
                   'live':{'manifestSha256':original['oldLiveManifestSha256'],'treeSha256':original['oldFullRootTreeSha256']},
                   'retained':original['retainedRoots'],'surfaceReceiverReceipt':receiver,
                   'receiverReceiptSha256':hashlib.sha256(raw_json(receiver)).hexdigest()}
        paths=[self.base/name for name in ('initial-local-evidence.json','initial-local-incoming.json','initial-local-inventory.json')]
        for path,value in zip(paths,(evidence,incoming_record,inventory)): path.write_bytes(raw_json(value))
        args=types.SimpleNamespace(preserved_plan=original_path,preserved_evidence=paths[0],preserved_incoming_receipt=paths[1],preserved_inventory=paths[2])
        return args,current,paths,evidence,incoming_record,inventory

    def test_initial_local_binding_pins_independent_receiver_and_all_exact_current_release_records(self):
        args,current,paths,evidence,incoming,inventory=self.initial_local_binding_fixture()
        binding=self.release.preserved_stage_binding(args,current)
        self.assertEqual(binding['receiverReceiptSha256'],inventory['receiverReceiptSha256'])
        self.assertEqual(binding['receiverReceiptPath'],'/var/tmp/proofofwork-deploy/audit5-stream-surfaces-'+RELEASE+'.json')
        self.assertEqual(len(binding['failedRecords']),8)
        self.assertEqual(binding['privateCandidateParent'],'/var/backups/proofofwork-ui/transport-evidence/'+RELEASE+'/.proofofwork-ui-stage-'+RELEASE+'.completed-v1')
        for key,value in (('receiverReceiptSha256','invalid'),('stageExists',True),('allLiveAndRetainedRootsUnchanged',False)):
            bad={**inventory,key:value}; paths[2].write_bytes(raw_json(bad))
            with self.subTest(key=key), self.assertRaises(AssertionError): self.release.preserved_stage_binding(args,current)
        paths[2].write_bytes(raw_json(inventory))
        bad=copy.deepcopy(evidence); del bad['records']['receive-admission.log']; paths[0].write_bytes(raw_json(bad))
        with self.assertRaises(AssertionError): self.release.preserved_stage_binding(args,current)

    def test_initial_local_binding_refuses_false_resume_noninitial_attempt_and_changed_root_bindings(self):
        args,current,paths,evidence,incoming,inventory=self.initial_local_binding_fixture()
        original_path=Path(args.preserved_plan); original=json.loads(original_path.read_bytes())
        for changed in ({**original,'resumeSurfaces':False},{**original,'resumeSurfaces':{}},
                        {**original,'publicationAttempt':'other'},{**original,'preservedStageResume':{}},
                        {**original,'inputStorage':'other'}):
            original_path.write_bytes(raw_json(changed))
            with self.subTest(change=changed), self.assertRaises(AssertionError): self.release.preserved_stage_binding(args,current)
        original_path.write_bytes(raw_json(original))
        for key,value in (('oldLiveManifestSha256','0'*64),('oldFullRootTreeSha256','0'*64),('retainedRoots',[{}]),
                          ('preservedSurfacesRoot','/var/backups/sibling/surfaces')):
            bad=copy.deepcopy(current); bad[key]=value
            with self.subTest(key=key), self.assertRaises(AssertionError): self.release.preserved_stage_binding(args,bad)
        self.assertEqual(len(self.release.preserved_stage_binding(args,current)['failedRecords']),8)

    def test_initial_local_binding_refuses_coordinated_receiver_field_changes(self):
        args,current,paths,evidence,incoming,inventory=self.initial_local_binding_fixture()
        receiver=inventory['surfaceReceiverReceipt']
        for key,value in (('status','other'),('kind','source'),('releaseId','other'),('archiveSha256','0'*64),
                          ('compressedBytes',101),('entries',3),('logicalBytes',13),('extractedRoot','/var/tmp/sibling')):
            changed={**receiver,key:value}; bad_evidence=copy.deepcopy(evidence); bad_incoming=copy.deepcopy(incoming); bad_inventory=copy.deepcopy(inventory)
            raw=raw_json(changed); bad_evidence['records']['receiver.log']={'value':changed,'sha256':hashlib.sha256(raw).hexdigest(),'bytes':len(raw)}
            bad_incoming['value']['receiverReceipt']=changed
            incoming_raw=raw_json(bad_incoming['value']); bad_incoming.update(sha256=hashlib.sha256(incoming_raw).hexdigest(),bytes=len(incoming_raw))
            bad_inventory.update(surfaceReceiverReceipt=changed,receiverReceiptSha256=hashlib.sha256(raw).hexdigest())
            for path,value in zip(paths,(bad_evidence,bad_incoming,bad_inventory)): path.write_bytes(raw_json(value))
            with self.subTest(key=key), self.assertRaises(AssertionError): self.release.preserved_stage_binding(args,current)


    def test_isolated_installed_stager_loader_preserves_path_for_original_sibling_capacity_helper(self):
        phase = safe_module('phase_capacity.py')
        stager_path = ROOT.parents[1] / 'deploy/proofofwork-ui-release-stage.py'
        lock = self.base / 'loader-deploy.lock'; lock.write_bytes(b''); lock.chmod(0o600)
        descriptor = os.open(lock, os.O_RDONLY)
        actual_lstat, actual_fstat = Path.lstat, os.fstat
        def owned(details):
            row = types.SimpleNamespace(**{key: getattr(details, key) for key in dir(details) if key.startswith('st_')})
            row.st_uid = row.st_gid = 0
            # The source checkout may be group writable; installed production
            # helpers use safe modes, independently tested by this loader.
            row.st_mode &= ~0o022
            return row
        def local_path(value):
            return {'/run/proofofwork-ui/deploy.lock': lock,
                    '/usr/local/sbin/proofofwork-ui-release-stage': stager_path}.get(str(value), Path(value))
        namespace = phase.locked_installed_stager.__globals__
        namespace['Path'] = local_path
        namespace['EXPECTED_STAGER_SHA256'] = self.release.digest(stager_path)
        flags = types.SimpleNamespace(**{key: getattr(sys.flags, key) for key in dir(sys.flags) if not key.startswith('_') and not callable(getattr(sys.flags, key))})
        flags.isolated = 1
        try:
            with patch.object(Path, 'lstat', lambda path: owned(actual_lstat(path))), \
                 patch.object(os, 'fstat', lambda fd: owned(actual_fstat(fd))), \
                 patch.object(os, 'geteuid', return_value=0), patch.object(sys, 'flags', flags), \
                 patch.dict(os.environ, {'POW_UI_DEPLOY_LOCK_FD': str(descriptor)}):
                installed = phase.locked_installed_stager()
                self.assertEqual(installed.__file__, str(stager_path))
                namespace['EXPECTED_STAGER_SHA256'] = '0'*64
                with self.assertRaisesRegex(ValueError, 'differs from the reviewed'):
                    phase.locked_installed_stager()
            # The unchanged capacity helper resolves beside the hash-verified
            # module, with every original constant and full tree-bound behavior.
            helper = installed.capacity_helper()
            self.assertEqual(helper.MAX_DEPLOY_SCRATCH_BYTES, 5*1024**3)
            self.assertEqual(helper.ROOT_RESERVE_BYTES, 10*1024**3)
            bound = helper.tree_bound(self.base, self.base)
            self.assertGreater(bound['additionalBytes'], 0)
        finally:
            os.close(descriptor)

    def test_new_record_hash_is_bounded_before_read_and_refuses_linked_or_oversized_records(self):
        namespace = functions_only('remote_transport.py', {'bounded_record', 'identity'})
        path = self.base / 'record.json'; path.write_bytes(b'bounded record'); path.chmod(0o600)
        original_lstat, original_fstat = Path.lstat, os.fstat
        def owned(details):
            row = types.SimpleNamespace(**{k: getattr(details, k) for k in dir(details) if k.startswith('st_')})
            row.st_uid = row.st_gid = 0; return row
        with patch.object(Path, 'lstat', lambda p: owned(original_lstat(p))), patch.object(os, 'fstat', lambda fd: owned(original_fstat(fd))):
            self.assertEqual(namespace['bounded_record'](path), (b'bounded record', hashlib.sha256(b'bounded record').hexdigest()))
            path.write_bytes(b'x'*65537)
            with patch.object(os, 'open') as opened, self.assertRaises(AssertionError): namespace['bounded_record'](path)
            opened.assert_not_called()
            path.write_bytes(b'restored'); os.link(path, self.base/'alias')
            with self.assertRaises(AssertionError): namespace['bounded_record'](path)

    def test_capacity_trajectory_charges_only_preserved_source_to_disk(self):
        base, payload, candidate, peak, source = 5171429376, 236478464, 261242880, 264581120, 365621248
        reserve = 32*1024**2
        namespace = {'__name__': '_pinned_capacity_fixture'}
        helper = ROOT.parents[1]/'deploy/proofofwork-ui-capacity.py'
        exec(compile(helper.read_bytes(), str(helper), 'exec'), namespace)
        def measured(amount):
            return patch.object(subprocess, 'run', return_value=types.SimpleNamespace(stdout=(str(amount)+'\t'+str(self.base)+'\n').encode()))
        with measured(base), self.assertRaisesRegex(namespace['CapacityError'], 'scratch review'):
            namespace['check_deploy_scratch'](self.base, peak+reserve, 'stage')
        with measured(base-payload):
            namespace['check_deploy_scratch'](self.base, peak+reserve, 'stage')
        with measured(base-payload+candidate):
            with self.assertRaisesRegex(namespace['CapacityError'], 'scratch review'):
                namespace['check_deploy_scratch'](self.base, source+reserve, 'source-in-scratch')
            namespace['check_deploy_scratch'](self.base, reserve, 'source-in-evidence')
        disk_after_peak = 19012272128-(peak+507226197+source+2*reserve)
        vfs = types.SimpleNamespace(f_bavail=disk_after_peak, f_frsize=1, f_favail=100000)
        with patch.object(os, 'statvfs', return_value=vfs):
            namespace['check_capacity'](self.base, 0, 10000, 'release-trajectory')
        vfs.f_bavail = 10*1024**3
        with patch.object(os, 'statvfs', return_value=vfs), self.assertRaisesRegex(namespace['CapacityError'], 'capacity refused'):
            namespace['check_capacity'](self.base, 0, 10000, 'root-reserve')

    def test_current_input_preservation_is_inode_preserving_and_never_replaces_evidence(self):
        namespace = functions_only('remote_transport.py', {'rename_new', 'sync'})
        source = self.base/'current-input'; source.mkdir(mode=0o700); (source/'index.html').write_bytes(b'exact input')
        pool = self.base/'evidence'; pool.mkdir(mode=0o700); target = pool/source.name
        inode = source.stat().st_ino; file_inode = (source/'index.html').stat().st_ino
        namespace['rename_new'](source, target)
        self.assertFalse(source.exists()); self.assertEqual(target.stat().st_ino, inode)
        self.assertEqual((target/'index.html').stat().st_ino, file_inode)
        source.mkdir(mode=0o700); (source/'index.html').write_bytes(b'second attempt')
        with self.assertRaises(AssertionError): namespace['rename_new'](source, target)
        self.assertEqual((target/'index.html').read_bytes(), b'exact input')
        self.assertEqual((source/'index.html').read_bytes(), b'second attempt')

    def test_evidence_ancestor_admission_refuses_alias_modes_devices_and_mounts_before_writes(self):
        namespace = functions_only('remote_transport.py', {'validate_evidence_ancestors'})
        backups = self.base/'backups'; backups.mkdir(mode=0o700)
        parent = backups/'proofofwork-ui'; parent.mkdir(mode=0o700)
        evidence = parent/'transport-evidence'; evidence.mkdir(mode=0o700)
        release_root = evidence/RELEASE; release_root.mkdir(mode=0o700)
        mountinfo = self.base/'mountinfo'; mountinfo.write_text('1 0 0:1 / / rw - ext4 root rw\n')
        namespace.update(BASE=self.base, EVIDENCE=evidence)
        original_lstat = Path.lstat
        wrong_device = None
        def owned(path):
            details = original_lstat(path)
            row = types.SimpleNamespace(**{k:getattr(details,k) for k in dir(details) if k.startswith('st_')})
            row.st_uid = row.st_gid = 0
            if path == wrong_device: row.st_dev += 1
            return row
        with patch.object(Path, 'lstat', owned):
            namespace['validate_evidence_ancestors'](RELEASE, require_release=True, mountinfo=mountinfo)
            before = sorted(path.relative_to(self.base).as_posix() for path in self.base.rglob('*'))
            for target in (backups, parent, evidence, release_root):
                target.chmod(0o777)
                with self.assertRaises(AssertionError): namespace['validate_evidence_ancestors'](RELEASE, require_release=True, mountinfo=mountinfo)
                target.chmod(0o700)
                wrong_device = target
                with self.assertRaisesRegex(AssertionError, 'filesystem'): namespace['validate_evidence_ancestors'](RELEASE, require_release=True, mountinfo=mountinfo)
                wrong_device = None
                mountinfo.write_text('1 0 0:1 / '+str(target)+' rw - ext4 fixture rw\n')
                with self.assertRaisesRegex(AssertionError, 'Mounted'): namespace['validate_evidence_ancestors'](RELEASE, require_release=True, mountinfo=mountinfo)
            mountinfo.write_text('1 0 0:1 / '+str(release_root/'nested')+' rw - ext4 fixture rw\n')
            with self.assertRaisesRegex(AssertionError, 'Mounted'): namespace['validate_evidence_ancestors'](RELEASE, require_release=True, mountinfo=mountinfo)
            mountinfo.write_text('1 0 0:1 / / rw - ext4 root rw\n')
            saved = self.base/'saved-release'; release_root.rename(saved); release_root.symlink_to(saved, target_is_directory=True)
            with self.assertRaises(AssertionError): namespace['validate_evidence_ancestors'](RELEASE, require_release=True, mountinfo=mountinfo)
            release_root.unlink(); saved.rename(release_root)
            self.assertEqual(before, sorted(path.relative_to(self.base).as_posix() for path in self.base.rglob('*')))


class HttpsRefusals(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix='pow-ui-https-test-', dir='/tmp')
        self.base = Path(self.temp.name).resolve()
        self.smoke = safe_module('https_smoke.py')

    def tearDown(self): self.temp.cleanup()

    def archive(self, extra=(), omit=()):
        path = self.base / ('proofofwork-ui-release-' + RELEASE + '.tgz')
        members = [('surfaces', b'', tarfile.DIRTYPE)]
        members += [('surfaces/' + surface + '/index.html', surface.encode(), tarfile.REGTYPE)
                    for surface in list(self.smoke.HOSTS) + ['nft'] if surface not in omit]
        write_tar(path, members + list(extra))
        sha = hashlib.sha256(path.read_bytes()).hexdigest()
        manifest = ('format=proofofwork-ui-release-v3\nrelease_id=' + RELEASE + '\ncommit=' + COMMIT +
                    '\nsource_tree=' + TREE + '\narchive_name=' + path.name + '\narchive_sha256=' + sha + '\n').encode()
        (self.base / '.proofofwork-ui-release').write_bytes(manifest)
        Path(str(path) + '.provenance').write_bytes(manifest)
        Path(str(path) + '.sha256').write_text(sha + '  ' + path.name + '\n')
        args = types.SimpleNamespace(archive=str(path), release_id=RELEASE, commit=COMMIT,
                                     tree=TREE, archive_sha256=sha, workers=2, timeout=1)
        receipt = {'verifiedResponseBytes': 0, 'archivedFilesChecked': 0, 'hostnameRootsChecked': 0}
        return args, receipt

    def test_all_managed_roots_and_public_bytes_are_checked(self):
        args, receipt = self.archive()
        with patch.dict(self.smoke.check.__globals__, compare_https=lambda url, body, timeout, **kw: len(body)):
            self.smoke.check(args, receipt)
        self.assertEqual(receipt['publicSurfaces'], 19)
        self.assertEqual(receipt['archiveFilesSkippedNft'], 1)
        self.assertEqual(receipt['archivedFilesChecked'], 19)
        self.assertEqual(receipt['hostnameRootsChecked'], 19)
        self.assertTrue(receipt['apexRedirectVerified'] and receipt['finalLocalEvidenceReverified'])

    def test_archive_traversal_duplicates_links_unknown_or_missing_root_refuse(self):
        changes = [([('../escape', b'x', tarfile.REGTYPE)], ()),
                   ([('surfaces/work/index.html', b'other', tarfile.REGTYPE)], ()),
                   ([('surfaces/work/link', b'', tarfile.SYMTYPE)], ()),
                   ([('surfaces/unknown/index.html', b'x', tarfile.REGTYPE)], ()),
                   ([], ('nft',)), ([], ('computer',)), ([], ('search',)), ([], ('code',)), ([], ('jobs',))]
        for extra, omit in changes:
            with self.subTest(extra=extra, omit=omit):
                args, receipt = self.archive(extra, omit)
                with patch.dict(self.smoke.check.__globals__, compare_https=unittest.mock.Mock()) as namespace:
                    with self.assertRaises(ValueError): self.smoke.check(args, receipt)
                    namespace['compare_https'].assert_not_called()

    def test_manifest_sidecar_archive_and_http_mismatch_refuse(self):
        for case in ('manifest', 'provenance', 'sidecar', 'archive', 'http'):
            with self.subTest(case=case):
                args, receipt = self.archive()
                if case == 'manifest':
                    changed = (self.base / '.proofofwork-ui-release').read_bytes().replace(COMMIT.encode(), ('c' * 40).encode())
                    (self.base / '.proofofwork-ui-release').write_bytes(changed)
                    Path(args.archive + '.provenance').write_bytes(changed)
                if case == 'provenance': Path(args.archive + '.provenance').write_bytes(b'changed')
                if case == 'sidecar': Path(args.archive + '.sha256').write_text('0' * 64 + '  wrong.tgz\n')
                if case == 'archive': Path(args.archive).write_bytes(b'changed')
                compare = unittest.mock.Mock(side_effect=ValueError('Served bytes differ'))
                with patch.dict(self.smoke.check.__globals__, compare_https=compare):
                    with self.assertRaises(ValueError): self.smoke.check(args, receipt)
                if case != 'http': compare.assert_not_called()

    def test_http_refuses_redirect_encoding_length_extra_or_different_bytes(self):
        url = 'https://computer.proofofwork.me/index.html'
        class Response(io.BytesIO):
            status = 200
            def __init__(self, body=b'exact', **headers):
                super().__init__(body); self.headers = headers
            def geturl(self): return url
        cases = [Response(b'exact!'), Response(b'wrong'),
                 Response(Content_Encoding='gzip'), Response(Content_Length='4')]
        # Use real HTTP header spelling in these mocks.
        cases[2].headers = {'Content-Encoding': 'gzip'}
        cases[3].headers = {'Content-Length': '4'}
        moved = Response(); moved.geturl = lambda: 'https://other.example/'
        cases.append(moved)
        status = Response(); status.status = 302; cases.append(status)
        for response in cases:
            with self.subTest(headers=response.headers, status=response.status):
                opener = types.SimpleNamespace(open=lambda *a, **kw: response)
                with patch.object(self.smoke.urllib.request, 'build_opener', return_value=opener):
                    with self.assertRaises(ValueError): self.smoke.compare_https(url, b'exact', 1)


if __name__ == '__main__':
    unittest.main(verbosity=2)
