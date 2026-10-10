#!/usr/bin/env python3
"""Offline refusal tests; never execute a remote script's module-level actions.

These tests use real local artifacts, AST-extracted safe functions, and mocked
SSH/HTTPS/process boundaries. They certify refusal behavior, not a deployment.
"""
import ast
import base64
import contextlib
import copy
import fcntl
import hashlib
import io
import json
import os
import shlex
import shutil
import stat
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

    def test_every_v4_surface_vector_adds_exactly_pages(self):
        expected = set(self.release.PAGES_SURFACES)
        self.assertEqual(len(expected), 21)
        self.assertEqual(expected, set(self.release.SURFACES) | {'pages'})
        vectors = [('build.py', 'PAGES_SURFACES'), ('remote_transport.py', 'PAGES_SURFACES'),
                   ('phase_capacity.py', 'PAGES_SURFACES'), ('https_smoke.py', 'PAGES_HOSTS'),
                   ('../search/install-ui.py', 'PAGES_SURFACES'),
                   ('../proofofwork-ui-release-stage.py', 'PAGES_SURFACES'),
                   ('../proofofwork-ui-verified-retention.py', 'PAGES_SURFACES')]
        for name, variable in vectors:
            with self.subTest(module=name):
                tree = ast.parse((ROOT / name).read_bytes())
                assignments = [node for node in tree.body if isinstance(node, ast.Assign)
                    and any(isinstance(target, ast.Name) and target.id in ('SURFACES', 'HOSTS', variable)
                            for target in node.targets)]
                namespace = {}
                exec(compile(ast.Module(body=assignments, type_ignores=[]), name, 'exec'), namespace)
                actual = set(namespace[variable])
                if variable == 'PAGES_HOSTS' or name == 'build.py': actual.add('nft')
                self.assertEqual(actual, expected)

    def test_focused_builder_typechecks_once_and_fences_each_surface_flag(self):
        builder = safe_module('build.py')
        environment = {'PATH': '/usr/bin:/bin', 'HOME': str(self.base / 'home'), 'LANG': 'C.UTF-8'}
        source, payload = self.base / 'source', self.base / 'payload'
        with patch.object(subprocess, 'run') as run, contextlib.redirect_stdout(io.StringIO()):
            builder.build_focused_surfaces(source, payload, builder.PAGES_SURFACES, environment, io.BytesIO())
        calls = run.call_args_list
        self.assertEqual(len(calls), 21, 'one typecheck and twenty focused builds; NFT is copied from Computer')
        self.assertEqual(calls[0].args[0], ['/usr/bin/node', str(source / 'node_modules/typescript/bin/tsc')])
        self.assertEqual(calls[0].kwargs['env'], environment)
        for call, (name, (host, flag)) in zip(calls[1:], builder.PAGES_SURFACES.items()):
            self.assertEqual(call.args[0][:3], ['/usr/bin/node', str(source / 'node_modules/vite/bin/vite.js'), 'build'])
            self.assertEqual(call.kwargs['cwd'], source)
            expected = {**environment, 'VITE_POW_API_BASE': 'https://' + host + '.proofofwork.me'}
            if flag: expected[flag] = '1'
            self.assertEqual(call.kwargs['env'], expected)
            self.assertIn(str(payload / 'surfaces' / name), call.args[0])
            self.assertTrue(call.kwargs['check'])
        with patch.object(subprocess, 'run', side_effect=subprocess.CalledProcessError(2, ['tsc'])) as run:
            with self.assertRaises(subprocess.CalledProcessError):
                builder.build_focused_surfaces(source, payload, builder.PAGES_SURFACES, environment, io.BytesIO())
            self.assertEqual(run.call_count, 1, 'failed source typechecking cannot produce any focused bundle')

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

    def build_inputs(self, pages=False):
        source = self.base / 'source.tgz'
        surfaces = self.base / 'surfaces.tgz'
        write_tar(source, [('source/README.md', b'local source', tarfile.REGTYPE)])
        top = 'proofofwork-ui-surfaces-' + RELEASE
        prefix = top + '/surfaces/'
        members = [(top, b'', tarfile.DIRTYPE), (top + '/surfaces', b'', tarfile.DIRTYPE)]
        for name in self.release.PAGES_SURFACES if pages else self.release.SURFACES:
            members.extend([(prefix + name, b'', tarfile.DIRTYPE),
                            (prefix + name + '/index.html', name.encode(), tarfile.REGTYPE)])
        write_tar(surfaces, members)
        bundles = {kind: {'path': str(path), 'bytes': path.stat().st_size,
                          'sha256': self.release.digest(path)}
                   for kind, path in [('source', source), ('surfaces', surfaces)]}
        build = {'commit': COMMIT, 'tree': TREE, 'releaseId': RELEASE,
                 'sourceAllocatedBytes': 4096, 'bundles': bundles}
        if pages:
            build.update(releaseFormat='proofofwork-ui-release-v4', surfaces=list(self.release.PAGES_SURFACES))
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

    def test_v4_plan_binds_all21_and_refuses_incomplete_or_wrong_format_receipts(self):
        build, previous, args = self.build_inputs(pages=True)
        with patch.object(subprocess, 'check_output', side_effect=self.git_output), contextlib.redirect_stdout(io.StringIO()):
            self.release.make_plan(args)
        plan = json.loads(Path(args.output).read_bytes())
        self.assertEqual(plan['releaseFormat'], 'proofofwork-ui-release-v4')
        self.assertEqual(set(plan['managedSurfaces']), set(self.release.PAGES_SURFACES))
        self.assertEqual(len(plan['managedSurfaces']), 21)
        self.assertEqual(self.release.load_plan(args.output)[0], plan)
        Path(args.output).unlink()
        for change in ('missing', 'duplicate', 'format'):
            build, previous, args = self.build_inputs(pages=True)
            if change == 'missing': build['surfaces'].remove('pages')
            if change == 'duplicate': build['surfaces'].append('pages')
            if change == 'format': build['releaseFormat'] = 'proofofwork-ui-release-v3'
            Path(args.build_receipt).write_bytes(raw_json(build))
            with patch.object(subprocess, 'check_output', side_effect=self.git_output), self.assertRaises(AssertionError):
                self.release.make_plan(args)
            self.assertFalse(Path(args.output).exists())

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
                  'v3_surfaces=("${surfaces[@]}")\npages_surfaces=("${surfaces[@]}" pages)\n' +
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


    def test_actual_helper_records_and_verifies_attributed_21_and_22_surface_roots(self):
        release = safe_module('release.py')
        provenance = ROOT.parent / 'proofofwork-ui-release-provenance.sh'
        capacity = ROOT.parent / 'proofofwork-ui-capacity.py'
        with tempfile.TemporaryDirectory(prefix='pow-publish-attributed-', dir='/tmp') as name:
            base = Path(name).resolve()
            def git(source, *args):
                command = ['/usr/bin/git', '-c', 'core.hooksPath=/dev/null', '-c',
                           'core.fsmonitor=false', '-c', 'user.name=Provenance Test Fixture',
                           '-c', 'user.email=fixture@invalid', '-C', str(source), *args]
                result = subprocess.run(command, check=True, capture_output=True, text=True, timeout=15,
                                        env={**os.environ, 'GIT_OPTIONAL_LOCKS': '0'})
                return result.stdout.strip()
            for surfaces in (release.PAGES_SURFACES, release.PERMISSION_SURFACES):
                family = len(surfaces)
                with self.subTest(family=family):
                    case = base / str(family); case.mkdir(mode=0o700)
                    www, archives, scratch, source = [case / n for n in ('www', 'archives', 'scratch', 'source')]
                    for target in (www, archives, scratch, source): target.mkdir(mode=0o755)
                    (source / '.gitignore').write_text('node_modules/\n')
                    (source / 'README.md').write_text('Authenticated provenance test fixture.\n')
                    for filename in ('.gitignore', 'README.md'): (source / filename).chmod(0o644)
                    git(source, 'init', '--template=')
                    git(source, 'add', '--', '.gitignore', 'README.md')
                    git(source, 'commit', '-m', 'Create exact detached fixture')
                    commit = git(source, 'rev-parse', 'HEAD')
                    git(source, 'checkout', '--detach', commit)
                    (source / 'node_modules').mkdir(mode=0o755)
                    dependency = source / 'node_modules/fixture.txt'
                    dependency.write_bytes(b'bounded exact fixture dependency\n'); dependency.chmod(0o644)
                    for surface in surfaces:
                        target = www / ('proofofwork-' + surface); target.mkdir(mode=0o755)
                        (target / 'assets').mkdir(mode=0o755)
                        (target / 'index.html').write_bytes(b'<html><script src="/assets/main.js"></script></html>')
                        (target / 'assets/main.js').write_bytes(b'const current = true;')
                        for filename in ('index.html', 'assets/main.js'): (target / filename).chmod(0o644)
                    archive = archives / ('proofofwork-ui-release-current-' + str(family) + '.tgz')
                    with tarfile.open(archive, 'w:gz') as tar:
                        for surface in surfaces: tar.add(www / ('proofofwork-' + surface), arcname='surfaces/' + surface)
                    archive.chmod(0o644)
                    checksum = Path(str(archive) + '.sha256')
                    checksum.write_text(hashlib.sha256(archive.read_bytes()).hexdigest() + '  ' + archive.name + '\n')
                    checksum.chmod(0o644)
                    environment = {**os.environ, 'POW_UI_ALLOW_TEST_ROOTS': '1', 'POW_UI_WWW_ROOT': str(www),
                        'POW_UI_RELEASE_ARCHIVE_ROOT': str(archives), 'POW_UI_CAPACITY_SCRIPT': str(capacity),
                        'POW_UI_DEPLOY_LOCK': str(case / 'deploy.lock'), 'TMPDIR': str(scratch),
                        'GIT_OPTIONAL_LOCKS': '0'}
                    # Current families cannot be promoted from unattributed historical evidence.
                    result = subprocess.run(['/usr/bin/bash', str(provenance), 'record-rollback-evidence',
                        '--archive', str(archive)], env=environment, capture_output=True, text=True, timeout=120)
                    self.assertNotEqual(result.returncode, 0)
                    self.assertFalse((www / '.proofofwork-ui-release').exists())
                    for command in (['record', '--release-id', 'current-' + str(family), '--commit', commit,
                                     '--source-checkout', str(source), '--archive', str(archive)], ['verify-rollback']):
                        result = subprocess.run(['/usr/bin/bash', str(provenance), *command], env=environment,
                            capture_output=True, text=True, timeout=120)
                        self.assertEqual(result.returncode, 0, result.stderr)
                    manifest = (www / '.proofofwork-ui-release').read_text()
                    self.assertIn('format=proofofwork-ui-release-v' + str(4 if family == 21 else 5) + '\n', manifest)
                    self.assertIn('commit=' + commit + '\n', manifest)
                    self.assertEqual(sum(line.endswith('.file_count=2') for line in manifest.splitlines()), family)
                    self.assertEqual(Path(str(archive) + '.provenance').read_bytes(),
                                     (www / '.proofofwork-ui-release').read_bytes())
                    self.assertEqual(list(scratch.iterdir()), [])
                    self.assertEqual(git(source, 'status', '--porcelain'), '')
                    self.assertEqual(git(source, 'rev-parse', 'HEAD'), commit)



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
            namespace.update(Path=local_path, active_manifest={'format': 'proofofwork-ui-release-v3'})
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
            (root / 'proofofwork-pages').mkdir()
            (root / 'proofofwork-pages/index.html').write_bytes(b'1234567890123')
            with self.assertRaises(AssertionError): exec(code, namespace)
            namespace['active_manifest']['format'] = 'proofofwork-ui-release-v4'
            exec(code, namespace)
            self.assertEqual(namespace['old_managed']['regularFiles'], 21)
            self.assertEqual(namespace['old_managed']['logicalBytes'], 93)

    def test_pages_v4_capacity_charges_all21_and_refuses_missing_old_surface(self):
        capacity = safe_module('phase_capacity.py')
        with tempfile.TemporaryDirectory(prefix='pow-pages-capacity-', dir='/tmp') as name:
            root = Path(name).resolve()
            for surface in capacity.PAGES_SURFACES:
                target = root / surface; target.mkdir(mode=0o755)
                file = target / 'index.html'; file.write_bytes(b'exact UI'); file.chmod(0o644)
            result = capacity.tree_budget(root, owner=os.geteuid())
            self.assertEqual(result['entries'], 43)
            self.assertEqual(result['logicalBytes'], 21 * len(b'exact UI'))
            (root / 'jobs').rename(root / 'other')
            with self.assertRaisesRegex(ValueError, 'complete managed set'):
                capacity.tree_budget(root, owner=os.geteuid())



class ClosedManagedArchive(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix='pow-closed-managed-archive-', dir='/tmp')
        self.base = Path(self.temp.name).resolve()
        self.phase = safe_module('phase_capacity.py')
        self.stager = safe_module('../proofofwork-ui-release-stage.py')
        self.order = list(self.phase.PAGES_SURFACES)
        self.owner = os.geteuid()

    def tearDown(self):
        self.temp.cleanup()

    def row(self, relative, content=b'content'):
        return {'path': relative, 'kind': 'file', 'size': len(content), 'mode': 0o644,
                'uid': self.owner, 'gid': os.getegid(), 'xattrs': [],
                'sha256': hashlib.sha256(content).hexdigest()}

    def minimal_rows(self):
        return {surface: [{'path': '.', 'kind': 'directory'}, self.row('index.html')]
                for surface in self.order}

    def actual_rows(self, root):
        rows = []
        for path in [root, *sorted(root.rglob('*'))]:
            relative = '.' if path == root else path.relative_to(root).as_posix()
            if path.is_dir(): rows.append({'path': relative, 'kind': 'directory'})
            else: rows.append(self.row(relative, path.read_bytes()))
        return rows

    def test_exact_gnu_tar_v4_long_paths_empty_files_nft_alias_and_hard_dereference(self):
        incoming, stage, archive_base = [self.base / name for name in ('incoming', 'stage', 'archive-base')]
        for path in (incoming, stage, archive_base): path.mkdir(mode=0o755)
        (archive_base / 'surfaces').mkdir(mode=0o755)
        common = bytes(range(256))*257
        long_directory = '/'.join(['a'*190, 'b'*190, 'c'*120])
        rows, compatibility = {}, {}
        for surface in self.order:
            root = incoming / surface; (root / 'assets').mkdir(parents=True, mode=0o755); root.chmod(0o755)
            (root / 'index.html').write_bytes(b'<script src="/assets/common.js"></script>')
            (root / 'assets/common.js').write_bytes(common)
            (root / 'empty').write_bytes(b'')
            (root / long_directory).mkdir(parents=True, mode=0o755)
            (root / long_directory / 'empty-leaf').write_bytes(b'')
            for path in root.rglob('*'): path.chmod(0o755 if path.is_dir() else 0o644)
            rows[surface] = self.actual_rows(root)
            shutil.copytree(root, stage / ('proofofwork-' + surface))
            # This missing prior path and its parents are part of every final
            # served archive, while equal incoming overlap is included once.
            compatibility[surface] = [self.row('assets/common.js', common),
                {'path': 'prior', 'kind': 'directory'}, {'path': 'prior/deep', 'kind': 'directory'},
                self.row('prior/deep/old.js', b'previous dependency')]
            target = stage / ('proofofwork-' + surface) / 'prior/deep'
            target.mkdir(parents=True); (target / 'old.js').write_bytes(b'previous dependency')
            for parent in (target, target.parent): parent.chmod(0o755)
            (target / 'old.js').chmod(0o644)
        first = stage / 'proofofwork-computer/assets/common.js'
        for surface in self.order:
            target = stage / ('proofofwork-' + surface) / 'assets/common.js'
            if target != first: target.unlink(); os.link(first, target)
        modeled = self.phase.closed_managed_archive_budget(rows, compatibility, self.order)
        measured = self.phase.tree_budget(stage, owner=self.owner, managed=True)
        self.assertEqual(modeled['logicalBytes'], measured['logicalBytes'])
        self.assertEqual(modeled['entries'], measured['entries'])
        self.assertEqual(modeled['archiveUpperBoundBytes'], measured['archiveUpperBoundBytes'])
        self.assertGreater(modeled['logicalBytes'], first.stat().st_size * 21)
        archive = self.base / 'actual.tgz'
        command = ['/usr/bin/tar', '--sort=name', '--create', '--gzip', '--hard-dereference',
            '--file', str(archive), '--transform=s|^proofofwork-|surfaces/|',
            '--directory', str(archive_base), 'surfaces', '--directory', str(stage),
            *['proofofwork-' + surface for surface in self.order]]
        subprocess.run(command, check=True, capture_output=True, timeout=20)
        self.assertLessEqual(archive.stat().st_size, modeled['archiveUpperBoundBytes'])
        with tarfile.open(archive, 'r:gz') as contents:
            members = contents.getmembers()
            self.assertEqual(sum(member.size for member in members if member.isfile()), modeled['logicalBytes'])
            self.assertEqual(len(members), modeled['entries'])
            self.assertFalse(any(member.islnk() or member.issym() for member in members))
            self.assertEqual({member.name.split('/')[1] for member in members if member.name != 'surfaces'}, set(self.order))
            for surface in ('computer', 'nft'):
                self.assertEqual(contents.extractfile('surfaces/' + surface + '/assets/common.js').read(), common)
            self.assertTrue(any(len(member.name.encode()) > 512 and member.isdir() for member in members))

    def test_malformed_duplicate_and_colliding_rows_are_refused(self):
        for change in ('negative', 'bool', 'size-type', 'kind', 'root-file', 'directory-size',
                       'duplicate', 'parent-file', 'parent-missing', 'escape', 'uncanonical', 'missing-root'):
            incoming = self.minimal_rows(); compatibility = {}
            rows = incoming['pages']
            with self.subTest(change=change):
                if change == 'negative': rows[1]['size'] = -1
                elif change == 'bool': rows[1]['size'] = True
                elif change == 'size-type': rows[1]['size'] = '7'
                elif change == 'kind': rows[1]['kind'] = 'symlink'
                elif change == 'root-file': rows[0] = self.row('.')
                elif change == 'directory-size': rows[0]['size'] = 0
                elif change == 'duplicate': rows.append(copy.deepcopy(rows[1]))
                elif change == 'parent-file': rows.extend([self.row('assets'), self.row('assets/file.js')])
                elif change == 'parent-missing': rows.append(self.row('assets/file.js'))
                elif change == 'escape': rows.append(self.row('../outside'))
                elif change == 'uncanonical': rows.append(self.row('assets//file.js'))
                elif change == 'missing-root': rows.pop(0)
                with self.assertRaises(ValueError):
                    self.phase.closed_managed_archive_budget(incoming, compatibility, self.order)
        rows = self.minimal_rows()
        for collision in (self.row('index.html', b'different'), {'path': 'index.html', 'kind': 'directory'}):
            with self.subTest(collision=collision), self.assertRaisesRegex(ValueError, 'collision'):
                self.phase.closed_managed_archive_budget(rows, {'pages': [collision]}, self.order)
        with self.assertRaisesRegex(ValueError, 'surface'):
            self.phase.closed_managed_archive_budget(rows, {'other': []}, self.order)

    def test_stage_budget_preserves_all_reachable_prior_files_and_excludes_only_unreachable_old_archive_paths(self):
        incoming, live = self.base / 'incoming', self.base / 'live'
        incoming.mkdir(mode=0o755); live.mkdir(mode=0o755)
        new_html = b'<script src="/assets/new.js"></script>'
        for surface in self.order:
            root = incoming / surface; (root / 'assets').mkdir(parents=True, mode=0o755); root.chmod(0o755)
            (root / 'index.html').write_bytes(new_html); (root / 'assets/new.js').write_bytes(b'new content')
            (root / 'unreferenced-new').write_bytes(b'keep complete incoming')
            for path in root.rglob('*'): path.chmod(0o755 if path.is_dir() else 0o644)
        for surface in self.phase.SURFACES:
            root = live / ('proofofwork-' + surface); (root / 'assets/deep').mkdir(parents=True, mode=0o755); root.chmod(0o755)
            (root / 'index.html').write_bytes(b'<script src="/assets/old.js"></script>')
            (root / 'assets/old.js').write_bytes(b'import "./deep/leaf.js";')
            (root / 'assets/deep/leaf.js').write_bytes(b'prior leaf')
            (root / 'unreferenced-old').write_bytes(b'x'*4096)
            for path in root.rglob('*'): path.chmod(0o755 if path.is_dir() else 0o644)
        passthrough = live / 'historical-passthrough'; passthrough.write_bytes(b'p'*8192); passthrough.chmod(0o644)
        before = {str(path): path.read_bytes() for path in live.rglob('*') if path.is_file()}
        result = self.phase.stage_budget(incoming, live, self.stager, owner=self.owner)
        closed = result['modeledManagedArchive']
        expected = 21*(len(new_html)+len(b'new content')+len(b'keep complete incoming')) + \
                   20*(len(b'import "./deep/leaf.js";')+len(b'prior leaf'))
        self.assertEqual(closed['logicalBytes'], expected)
        self.assertEqual(result['compatibilityCounters']['dependencies'], 40)
        self.assertEqual(closed['entries'], 1 + 21*5 + 20*3)
        self.assertEqual(closed['archiveUpperBoundBytes'], result['modeledManagedArchiveUpperBoundBytes'])
        self.assertGreater(result['initialCopyUpperBytes'], 8192+20*4096)
        self.assertEqual(before, {str(path): path.read_bytes() for path in live.rglob('*') if path.is_file()})

    def test_transport_closed_bound_rejects_model_ceiling_or_actual_growth_before_archive(self):
        closed = self.phase.closed_managed_archive_budget(self.minimal_rows(), {}, self.order)
        model = {'modeledManagedArchive': closed, 'modeledManagedArchiveUpperBoundBytes': closed['archiveUpperBoundBytes']}
        namespace = functions_only('remote_transport.py', {'modeled_managed_archive_upper'})
        validate = namespace['modeled_managed_archive_upper']; upper = closed['archiveUpperBoundBytes']
        self.assertEqual(validate(model, upper, self.order), upper)
        self.assertLess(upper, 640537895)
        for change in ('ceiling', 'bool', 'zero', 'record-mismatch', 'family', 'hardlinks'):
            bad = copy.deepcopy(model); ceiling = upper
            if change == 'ceiling': ceiling -= 1
            elif change == 'bool': bad['modeledManagedArchiveUpperBoundBytes'] = True
            elif change == 'zero': bad['modeledManagedArchiveUpperBoundBytes'] = 0
            elif change == 'record-mismatch': bad['modeledManagedArchive']['archiveUpperBoundBytes'] += 1
            elif change == 'family': bad['modeledManagedArchive']['managedSurfaces'].pop()
            elif change == 'hardlinks': bad['modeledManagedArchive']['hardDereference'] = False
            with self.subTest(change=change), self.assertRaises(AssertionError): validate(bad, ceiling, self.order)
        # Run the actual module-level post-stage statements without invoking any
        # remote script actions or tar; a too-small prediction refuses first.
        module = ast.parse((ROOT / 'remote_transport.py').read_bytes())
        branch = next(node for node in module.body if isinstance(node, ast.If) and
                      any(isinstance(child, ast.Assign) and any(isinstance(t,ast.Name) and t.id=='managed'
                          for t in child.targets) for child in node.body))
        start = next(i for i,node in enumerate(branch.body) if isinstance(node,ast.Assign) and
                     any(isinstance(t,ast.Name) and t.id=='upper' for t in node.targets))
        code = compile(ast.Module(body=branch.body[start:start+2],type_ignores=[]),'actual-post-stage-bound','exec')
        for actual in (upper, upper+1, 0, True):
            scope = {'managed':{'archiveUpperBoundBytes':actual},'stage_archive_upper':upper,'p':{'stageArchiveUpperBoundBytes':640537895}}
            with self.subTest(actual=actual):
                if actual == upper and type(actual) is int: exec(code,scope)
                else:
                    with self.assertRaises(AssertionError):exec(code,scope)

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

    def archive(self, extra=(), omit=(), pages=False, provenance_changes=None, omit_provenance=()):
        path = self.base / ('proofofwork-ui-release-' + RELEASE + '.tgz')
        members = [('surfaces', b'', tarfile.DIRTYPE)]
        members += [('surfaces/' + surface + '/index.html', surface.encode(), tarfile.REGTYPE)
                    for surface in list(self.smoke.PAGES_HOSTS if pages else self.smoke.HOSTS) + ['nft'] if surface not in omit]
        if pages:
            for surface in self.smoke.PAGES_HOSTS:
                if surface in omit or surface in omit_provenance: continue
                proof = {'format': 'proof-of-work-ui-source-v1', 'commit': COMMIT,
                         'tree': TREE, 'trackedDirty': False}
                if provenance_changes and surface == provenance_changes[0]: proof.update(provenance_changes[1])
                members.append(('surfaces/' + surface + '/source-provenance.json', raw_json(proof), tarfile.REGTYPE))
        write_tar(path, members + list(extra))
        sha = hashlib.sha256(path.read_bytes()).hexdigest()
        manifest = ('format=proofofwork-ui-release-' + ('v4' if pages else 'v3') + '\nrelease_id=' + RELEASE + '\ncommit=' + COMMIT +
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

    def test_pages_v4_checks_all20_public_hosts_and_refuses_missing_pages(self):
        args, receipt = self.archive(pages=True)
        requests = []
        def compare(url, body, timeout, **kwargs):
            requests.append(url)
            return len(body)
        with patch.dict(self.smoke.check.__globals__, compare_https=compare):
            self.smoke.check(args, receipt)
        self.assertEqual(receipt['publicSurfaces'], 20)
        self.assertEqual(receipt['archivedFilesChecked'], 40)
        self.assertEqual(receipt['hostnameRootsChecked'], 20)
        self.assertIn('https://pages.proofofwork.me/index.html', requests)
        self.assertIn('https://pages.proofofwork.me/', requests)
        self.assertTrue(receipt['sourceProvenanceVerified'])
        self.assertEqual(receipt['sourceProvenanceSurfaces'], 20)
        self.assertIn('https://pages.proofofwork.me/source-provenance.json', requests)
        args, receipt = self.archive(omit=('pages',), pages=True)
        with patch.dict(self.smoke.check.__globals__, compare_https=unittest.mock.Mock()) as namespace:
            with self.assertRaises(ValueError): self.smoke.check(args, receipt)
            namespace['compare_https'].assert_not_called()

    def test_v4_semantic_source_provenance_refuses_stale_dirty_or_missing_host_before_https(self):
        for change in ({'commit': 'c'*40}, {'tree': 'd'*40}, {'trackedDirty': True},
                       {'trackedDirty': 0}, {'format': 'unknown'}):
            with self.subTest(change=change):
                args, receipt = self.archive(pages=True, provenance_changes=('browser', change))
                with patch.dict(self.smoke.check.__globals__, compare_https=unittest.mock.Mock()) as namespace:
                    with self.assertRaisesRegex(ValueError, 'Source provenance differs'):
                        self.smoke.check(args, receipt)
                    namespace['compare_https'].assert_not_called()
        args, receipt = self.archive(pages=True, omit_provenance=('pages',))
        with patch.dict(self.smoke.check.__globals__, compare_https=unittest.mock.Mock()) as namespace:
            with self.assertRaisesRegex(ValueError, 'source provenance is missing'):
                self.smoke.check(args, receipt)
            namespace['compare_https'].assert_not_called()
        args, receipt = self.archive(extra=[('surfaces/pages/index.html', b'pages', tarfile.REGTYPE)])
        with patch.dict(self.smoke.check.__globals__, compare_https=unittest.mock.Mock()) as namespace:
            with self.assertRaises(ValueError): self.smoke.check(args, receipt)
            namespace['compare_https'].assert_not_called()

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


class OuterCapacityResume(unittest.TestCase):
    """Exercise the real planner, native recognizer and no-stream branch offline."""
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory(prefix='pow-outer-capacity-', dir='/tmp')
        self.base = Path(self.temporary.name).resolve()
        self.release = safe_module('release.py')

    def tearDown(self): self.temporary.cleanup()

    def fixture(self, remote=False):
        base = str(self.base) if remote else '/var/tmp/proofofwork-deploy'
        evidence_base = str(self.base / 'evidence') if remote else '/var/backups/proofofwork-ui/transport-evidence'
        pool = evidence_base + '/' + RELEASE
        fingerprint = {'sha256': '8'*64, 'entries': 2, 'regularBytes': 12}
        original = {'schema': 'proof-of-work-audit29-ui-transport-plan-v1', 'releaseFormat': 'proofofwork-ui-release-v5',
            'releaseId': RELEASE, 'commit': COMMIT, 'tree': TREE, 'publicationAttempt': 'initial',
            'managedSurfaces': list(self.release.PERMISSION_SURFACES), 'inputStorage': 'release-evidence-v1',
            'source': {'sha256': '1'*64, 'compressedBytes': 12}, 'surfaces': {'sha256': '2'*64, 'compressedBytes': 12},
            'sourceAllocatedBytes': 100, 'admissions': {'source-receive': {'bytes': 100, 'inodes': 10}},
            'preservedSurfacesRoot': pool + '/proofofwork-ui-surfaces-' + RELEASE + '/surfaces',
            'preservedSourceCheckout': pool + '/proofofwork-ui-source-' + RELEASE,
            'surfacesPayloadFingerprint': fingerprint, 'oldLiveManifestSha256': '3'*64,
            'oldFullRootTreeSha256': '4'*64, 'retainedRoots': [], 'publicationHelpers': {'stager': {'sha256': '5'*64}},
            'helperSha256': {'capacity': '6'*64}, 'installedStagerSha256': '5'*64, 'phaseCapacity': {'sha256': '7'*64},
            'stageArchiveUpperBoundBytes': 2000}
        original_path = self.base / ('recovery-plan-' + RELEASE + '-initial.json')
        original_path.write_bytes(raw_json(original)); original_sha = self.release.digest(original_path)
        model = {'inputStabilityVerified': True, 'installedStagerSha256': '5'*64, 'peakAdditionalBytes': 1000,
            'modeledManagedArchiveUpperBoundBytes': 2000, 'modeledManagedArchive': {
                'model': 'closed-managed-archive-tar-gzip-v1', 'hardDereference': True,
                'archiveUpperBoundBytes': 2000, 'managedSurfaces': list(self.release.PERMISSION_SURFACES)}}
        scratch = {'status': 'sufficient', 'phase': 'recovery-stage', 'path': '/var/tmp/proofofwork-deploy',
            'maximumBytes': 5*1024**3, 'allocatedBytes': 2606174208, 'additionalBytes': 1000 + 32*1024**2,
            'cleanupApproved': False}
        refusal = {'availableBytes': 10*1024**3, 'requiredBytes': 10*1024**3 + 64*1024**2 + scratch['additionalBytes'] + 2000,
            'availableInodes': 100000, 'requiredInodes': 10128, 'path': '/', 'phase': 'recovery-stage'}
        receiver = {'status': 'verified', 'kind': 'surfaces', 'releaseId': RELEASE, 'archiveSha256': '2'*64,
            'compressedBytes': 12, 'entries': 2, 'logicalBytes': 12,
            'extractedRoot': base + '/proofofwork-ui-surfaces-' + RELEASE}
        incoming = {'format': 'proof-of-work-ui-incoming-evidence-v1', 'releaseId': RELEASE,
            'commit': COMMIT, 'tree': TREE, 'planSha256': original_sha, 'payloadFingerprint': fingerprint,
            'preservedPath': str(Path(original['preservedSurfacesRoot']).parent),
            'movePreservedInodes': True, 'historicalDeletion': False, 'receiverReceipt': receiver}
        failed_name = 'recovery-transport-' + RELEASE + '-surfaces-stage-initial'
        failed = self.base / failed_name; failed.mkdir(mode=0o700)
        values = {'intent.json': {'releaseId': RELEASE, 'commit': COMMIT, 'tree': TREE, 'planSha256': original_sha,
                'phase': 'surfaces-stage', 'historicalDeletion': False, 'retentionDeferred': True},
            'input-evidence-check.json': {'status': 'sufficient'}, 'receive-admission.log': {'status': 'sufficient'},
            'receiver.log': receiver, 'stage-model.json': model, 'stage-check-scratch.json': scratch,
            'stage-check.json': 'UI capacity refused ' + json.dumps(refusal) + '\n'}
        def record(path, value):
            raw = value.encode() if isinstance(value, str) else raw_json(value)
            return {'path': path, 'sha256': hashlib.sha256(raw).hexdigest(), 'bytes': len(raw),
                    'base64': base64.b64encode(raw).decode(), 'value': value}, raw
        records = {}
        for name, value in values.items():
            records[name], raw = record(base + '/' + failed_name + '/' + name, value)
            (failed / name).write_bytes(raw)
        incoming_record, incoming_raw = record(pool + '/incoming-receipt.json', incoming)
        receiver_record, receiver_raw = record(base + '/audit5-stream-surfaces-' + RELEASE + '.json', receiver)
        unit = {'name': 'proofofwork-recovery-ui-transport-' + RELEASE + '-surfaces-stage-initial.service',
            'LoadState': 'loaded', 'ActiveState': 'failed', 'SubState': 'failed', 'MainPID': '0',
            'InvocationID': '9'*32, 'Result': 'exit-code'}
        evidence = {'evidence': base + '/' + failed_name, 'records': records, 'failedUnit': unit,
            'stageExists': False, 'sourceExists': False, 'privateStages': [], 'preservedInputExists': True}
        inventory = {'stageExists': False, 'sourceExists': False, 'scratchPayloadExists': False,
            'archiveExists': False, 'checksumExists': False, 'provenanceExists': False,
            'privateStages': [], 'allLiveAndRetainedRootsUnchanged': True,
            'live': {'manifestSha256': '3'*64, 'treeSha256': '4'*64}, 'retained': [],
            'preservedInputFingerprint': fingerprint, 'failedUnit': unit,
            'freshNamespaces': {name: True for name in ['transportEvidence', 'sourceEvidence', 'publishEvidence',
                'transportUnit', 'sourceUnit', 'publishUnit']},
            'surfaceReceiverReceipt': receiver, 'receiverReceipt': receiver_record,
            'receiverReceiptSha256': receiver_record['sha256']}
        current = {**original, 'publicationAttempt': 'capacity-v1'}
        if not remote:
            paths = [self.base / name for name in ('failed-evidence.json', 'incoming-record.json', 'inventory.json')]
            for path, value in zip(paths, (evidence, incoming_record, inventory)): path.write_bytes(raw_json(value))
            args = types.SimpleNamespace(capacity_plan=original_path, capacity_evidence=paths[0],
                capacity_incoming_receipt=paths[1], capacity_inventory=paths[2])
            return original, current, args, evidence, incoming_record, inventory, failed
        release_pool = self.base / 'evidence' / RELEASE; release_pool.mkdir(parents=True)
        (release_pool / 'incoming-receipt.json').write_bytes(incoming_raw)
        Path(incoming['preservedPath']).mkdir()
        (self.base / ('audit5-stream-surfaces-' + RELEASE + '.json')).write_bytes(receiver_raw)
        pins = {name: {'sha256': record['sha256'], 'bytes': record['bytes']} for name, record in records.items()}
        current['preservedCapacityResume'] = {'failedPlanPath': str(original_path), 'failedPlanSha256': original_sha,
            'failedEvidence': str(failed), 'failedRecords': pins, 'failedUnit': unit,
            'receiverReceiptPath': str(self.base / ('audit5-stream-surfaces-' + RELEASE + '.json')),
            'receiverReceiptSha256': receiver_record['sha256'], 'incomingReceiptPath': str(release_pool / 'incoming-receipt.json'),
            'incomingReceiptSha256': incoming_record['sha256'], 'incomingReceiptBytes': len(incoming_raw), 'filesystemRefusal': refusal}
        namespace = functions_only('remote_transport.py', {'outer_capacity_refusal', 'unused_capacity_namespaces', 'validate_capacity_resume'})
        def bound(path, digest, maximum=65536):
            raw = Path(path).read_bytes(); assert len(raw) <= maximum and hashlib.sha256(raw).hexdigest() == digest; return raw
        namespace.update(BASE=self.base, EVIDENCE=self.base / 'evidence', ARCHIVES=self.base / 'archives', ENV={},
            bound=bound, directory=lambda path: Path(path).resolve(strict=True),
            validate_evidence_ancestors=lambda *a, **k: release_pool,
            payload_fingerprint=lambda path: fingerprint)
        def state(argv, **kwargs):
            value = {key: val for key, val in unit.items() if key != 'name'} if argv[2] == unit['name'] else {
                'LoadState': 'not-found', 'ActiveState': 'inactive', 'MainPID': '0'}
            return ''.join(key + '=' + val + '\n' for key, val in value.items())
        return namespace, current, incoming, failed, state

    def test_local_binding_verifies_raw_bytes_and_exact_seven_record_outer_refusal(self):
        original, current, args, evidence, incoming, inventory, failed = self.fixture()
        before = {p.name: p.read_bytes() for p in failed.iterdir()}
        binding = self.release.preserved_capacity_binding(args, current)
        self.assertEqual(binding['failedUnit']['InvocationID'], '9'*32)
        self.assertEqual(set(binding['failedRecords']), set(before))
        self.assertEqual(before, {p.name: p.read_bytes() for p in failed.iterdir()})
        for field in ('base64', 'value', 'sha256', 'bytes'):
            bad = copy.deepcopy(evidence)
            bad['records']['stage-check.json'][field] = {'base64': 'eA==', 'value': 'forged', 'sha256': '0'*64, 'bytes': 1}[field]
            args.capacity_evidence.write_bytes(raw_json(bad))
            with self.subTest(field=field), self.assertRaises(AssertionError): self.release.preserved_capacity_binding(args, current)

    def test_local_binding_refuses_changed_artifacts_roots_gates_and_occupied_namespaces(self):
        original, current, args, evidence, incoming, inventory, failed = self.fixture()
        for key in ('commit', 'tree', 'source', 'surfaces', 'admissions', 'retainedRoots', 'phaseCapacity', 'publicationHelpers', 'stageArchiveUpperBoundBytes'):
            bad = copy.deepcopy(current); bad[key] = None
            with self.subTest(key=key), self.assertRaises(AssertionError): self.release.preserved_capacity_binding(args, bad)
        for attempt in ('initial', '', '../escape', 'UPPER', 'a'*32):
            bad = copy.deepcopy(current); bad['publicationAttempt'] = attempt
            with self.subTest(attempt=attempt), self.assertRaises(AssertionError): self.release.preserved_capacity_binding(args, bad)
        for key in inventory['freshNamespaces']:
            bad = copy.deepcopy(inventory); bad['freshNamespaces'][key] = False
            args.capacity_inventory.write_bytes(raw_json(bad))
            with self.subTest(namespace=key), self.assertRaises(AssertionError): self.release.preserved_capacity_binding(args, current)
        args.capacity_inventory.write_bytes(raw_json(inventory))
        for extra in ('stager.log', 'receipt.json'):
            bad = copy.deepcopy(evidence); bad['records'][extra] = {}
            args.capacity_evidence.write_bytes(raw_json(bad))
            with self.subTest(extra=extra), self.assertRaises(AssertionError): self.release.preserved_capacity_binding(args, current)

    def test_native_recognizer_rechecks_unit_receipts_namespace_and_preserved_payload(self):
        namespace, plan, incoming, failed, state = self.fixture(remote=True)
        before = {p.name: p.read_bytes() for p in failed.iterdir()}
        validate = namespace['validate_capacity_resume']
        with patch.object(subprocess, 'check_output', side_effect=state):
            self.assertEqual(validate(plan), incoming)
            for field in ('failedPlanSha256', 'incomingReceiptSha256', 'receiverReceiptSha256'):
                bad = copy.deepcopy(plan); bad['preservedCapacityResume'][field] = '0'*64
                with self.subTest(field=field), self.assertRaises(AssertionError): validate(bad)
            occupied = self.base / ('proofofwork-www-stage-' + RELEASE); occupied.mkdir()
            with self.assertRaisesRegex(AssertionError, 'namespace occupied'): validate(plan)
            occupied.rmdir()
            namespace['payload_fingerprint'] = lambda path: {'sha256': '0'*64}
            with self.assertRaises(AssertionError): validate(plan)
        self.assertEqual(before, {p.name: p.read_bytes() for p in failed.iterdir()})

    def test_native_refuses_changed_failed_unit_and_extra_or_partial_evidence(self):
        namespace, plan, incoming, failed, state = self.fixture(remote=True)
        validate = namespace['validate_capacity_resume']
        for before, after in [('MainPID=0', 'MainPID=1'), ('InvocationID='+'9'*32, 'InvocationID='+'0'*32),
                ('ActiveState=failed', 'ActiveState=active'), ('Result=exit-code', 'Result=success')]:
            def changed(argv, **kwargs): return state(argv, **kwargs).replace(before, after)
            with patch.object(subprocess, 'check_output', side_effect=changed), self.subTest(field=before), self.assertRaisesRegex(AssertionError, 'failed unit changed'): validate(plan)
        with patch.object(subprocess, 'check_output', side_effect=state):
            for name in ('stager.log', 'receipt.json'):
                path = failed / name; path.write_bytes(b'partial or completed')
                with self.subTest(name=name), self.assertRaises(AssertionError): validate(plan)
                path.unlink()
            for path in list(failed.iterdir()):
                raw = path.read_bytes(); path.unlink()
                with self.subTest(missing=path.name), self.assertRaises(AssertionError): validate(plan)
                path.write_bytes(raw)
            (failed / 'receiver.log').write_bytes(b'changed')
            with self.assertRaises(AssertionError): validate(plan)

    def test_classifier_matches_both_sources_and_refuses_other_capacity_shapes(self):
        original, current, args, evidence, incoming, inventory, failed = self.fixture()
        namespace = functions_only('remote_transport.py', {'outer_capacity_refusal'})
        records = {name: record['value'] for name, record in evidence['records'].items()}
        classifiers = (self.release.outer_capacity_refusal, namespace['outer_capacity_refusal'])
        definitions = []
        for source in ('release.py', 'remote_transport.py'):
            definition = next(node for node in ast.parse((ROOT / source).read_bytes()).body
                if isinstance(node, ast.FunctionDef) and node.name == 'outer_capacity_refusal')
            definitions.append(ast.dump(definition, include_attributes=False))
        self.assertEqual(*definitions, 'Planner/native refusal classification must remain identical')
        for classifier in classifiers:
            expected = classifier(records, original)
            for case in ('scratch', 'inode', 'reserve', 'sufficient', 'full-copy', 'wrong-root'):
                bad = copy.deepcopy(records)
                refusal = copy.deepcopy(expected)
                if case == 'scratch': bad['stage-check-scratch.json']['maximumBytes'] += 1
                elif case == 'inode': refusal['availableInodes'] = 0
                elif case == 'reserve': refusal['requiredBytes'] -= 1
                elif case == 'sufficient': refusal['availableBytes'] = refusal['requiredBytes']
                elif case == 'full-copy': bad['stage-check.json'] = 'UI deployment scratch review required {}'
                elif case == 'wrong-root': refusal['path'] = '/var/backups'
                if case not in ('scratch', 'full-copy'): bad['stage-check.json'] = 'UI capacity refused ' + json.dumps(refusal)
                with self.subTest(source=classifier.__module__, case=case), self.assertRaises(AssertionError): classifier(bad, original)

    def test_native_refuses_each_future_unit_and_partial_source_archive_namespace(self):
        namespace, plan, incoming, failed, state = self.fixture(remote=True)
        validate = namespace['validate_capacity_resume']; pool = self.base / 'evidence' / RELEASE
        partials = [pool / 'archive-base', pool / ('.audit5-stream-source-' + RELEASE),
            pool / ('audit5-stream-source-' + RELEASE + '.json'),
            pool / ('proofofwork-ui-source-' + RELEASE),
            pool / ('proofofwork-ui-release-' + RELEASE + '.tgz.incoming'), pool / 'archive.sha256.incoming',
            self.base / ('proofofwork-ui-surfaces-' + RELEASE),
            self.base / ('recovery-transport-' + RELEASE + '-preserved-capacity-resume-capacity-v1'),
            self.base / ('recovery-transport-' + RELEASE + '-source-capacity-v1'),
            self.base / ('recovery-publish-' + RELEASE + '-capacity-v1'),
            pool / ('.proofofwork-ui-stage-' + RELEASE + '.partial'),
            self.base / ('.proofofwork-ui-stage-' + RELEASE + '.partial')]
        archives = self.base / 'archives'; archives.mkdir()
        archive = archives / ('proofofwork-ui-release-' + RELEASE + '.tgz')
        partials += [archive, Path(str(archive)+'.sha256'), Path(str(archive)+'.provenance')]
        with patch.object(subprocess, 'check_output', side_effect=state):
            for path in partials:
                path.mkdir()
                with self.subTest(path=path), self.assertRaises(AssertionError): validate(plan)
                path.rmdir()
        for part in ('-source-capacity-v1.service', '-ui-capacity-v1.service'):
            def occupied(argv, **kwargs):
                value = state(argv, **kwargs)
                return value.replace('LoadState=not-found', 'LoadState=loaded') if argv[2].endswith(part) else value
            with patch.object(subprocess, 'check_output', side_effect=occupied), self.subTest(unit=part), self.assertRaises(AssertionError): validate(plan)

    def test_capacity_dispatch_has_no_stream_and_uses_pinned_controller_fresh_unit(self):
        transport = safe_module('transport_preserve.py')
        bundle = self.base / 'bundle.tgz'; bundle.write_bytes(b'pinned archive')
        plan = {'releaseId': RELEASE, 'publicationAttempt': 'capacity-v1', 'inputStorage': 'release-evidence-v1',
            'preservedCapacityResume': {'verified': True}, 'preservingTransportSha256': self.release.digest(ROOT / 'remote_transport.py'),
            'localBundles': {'surfaces': str(bundle)}, 'surfaces': {'compressedBytes': bundle.stat().st_size, 'sha256': self.release.digest(bundle)}}
        path = self.base / 'plan.json'; path.write_bytes(raw_json(plan)); log = self.base / 'transport.log'
        previous = os.umask(0o022)
        try:
            with patch('sys.argv', ['transport_preserve.py', str(path), 'preserved-capacity-resume', str(log)]), patch.object(subprocess, 'run') as run:
                transport.main(); command = run.call_args.args[0][-1]
                self.assertEqual(run.call_args.kwargs['stdin'], subprocess.DEVNULL)
                self.assertIn('preserved-capacity-resume-capacity-v1.service', command)
                self.assertIn('Transport unit namespace occupied', command)
                self.assertIn('--property=KillMode=control-group', command)
        finally: os.umask(previous)

    def test_actual_capacity_branch_reuses_input_and_keeps_normal_allocation_guards(self):
        tree = ast.parse((ROOT / 'remote_transport.py').read_bytes())
        branch = next(node for node in tree.body if isinstance(node, ast.If) and
            isinstance(node.test, ast.Compare) and isinstance(node.test.left, ast.Name) and node.test.left.id == 'phase' and
            isinstance(node.test.ops[0], ast.NotEq) and node.test.comparators[0].value == 'source')
        incoming = {'preservedPath': str(self.base / 'preserved'), 'receiverReceipt': {'status': 'verified'}}
        calls = []
        scope = {'phase': 'preserved-capacity-resume', 'p': {'surfacesPayloadFingerprint': 'fingerprint'}, 'capacity_incoming': incoming,
            'Path': Path, 'directory': lambda path: calls.append(('directory', path)),
            'payload_fingerprint': lambda path: calls.append(('fingerprint', path)) or 'fingerprint',
            'validate_preserved_stage': lambda plan: self.fail('Old recognizer was invoked')}
        exec(compile(ast.Module(body=[branch.body[0]], type_ignores=[]), 'actual-capacity-input-branch', 'exec'), scope)
        self.assertEqual(scope['incoming'], incoming)
        self.assertEqual(calls, [('directory', Path(incoming['preservedPath'])), ('fingerprint', Path(incoming['preservedPath']))])
        guard = next(node for node in branch.body if isinstance(node, ast.If) and
            isinstance(node.test, ast.Compare) and isinstance(node.test.comparators[0], ast.Constant) and
            node.test.comparators[0].value == 'preserved-stage-resume' and
            any(isinstance(child, ast.Assign) and any(isinstance(t, ast.Name) and t.id == 'stager_args' for t in child.targets) for child in node.body))
        guards = []
        scope.update(BASE=self.base, EVIDENCE_RESERVE=32*1024**2, model={'peakAdditionalBytes': 1000},
            stage_archive_upper=2000, capacity=lambda *args: guards.append(args))
        exec(compile(ast.Module(body=[guard], type_ignores=[]), 'actual-capacity-normal-guards', 'exec'), scope)
        self.assertEqual(scope['stager_args'], [])
        self.assertEqual(guards, [('check-scratch', self.base, 1000+32*1024**2, 'stage'),
            ('check', self.base, 1000+2000+32*1024**2, 'stage')])
        # Validation precedes evidence creation, so refusal/cancellation never
        # enters input replay or grants publication authority.
        source = (ROOT / 'remote_transport.py').read_text()
        self.assertLess(source.index('capacity_incoming = validate_capacity_resume'), source.index('out.mkdir(mode=0o700)'))
        self.assertIn("'productionPublished': False", source)

    def test_native_capacity_refusal_stops_before_stager_and_keeps_input_evidence(self):
        tree = ast.parse((ROOT / 'remote_transport.py').read_bytes())
        outer = next(node for node in tree.body if isinstance(node, ast.If) and
            isinstance(node.test, ast.Compare) and isinstance(node.test.left, ast.Name) and node.test.left.id == 'phase'
            and isinstance(node.test.ops[0], ast.NotEq) and node.test.comparators[0].value == 'source')
        guard = next(node for node in outer.body if isinstance(node, ast.If) and
            isinstance(node.test, ast.Compare) and isinstance(node.test.comparators[0], ast.Constant)
            and node.test.comparators[0].value == 'preserved-stage-resume'
            and any(isinstance(child, ast.Assign) and any(isinstance(t, ast.Name) and t.id == 'stager_args' for t in child.targets) for child in node.body))
        before = self.base / 'preserved-input'; before.write_bytes(b'unchanged canonical incoming evidence')
        for stop in ('check-scratch', 'check'):
            calls = []
            def capacity(command, *args):
                calls.append(command)
                if command == stop: raise RuntimeError('native capacity refusal')
            scope = {'phase': 'preserved-capacity-resume', 'BASE': self.base, 'EVIDENCE_RESERVE': 32*1024**2,
                'model': {'peakAdditionalBytes': 1000}, 'stage_archive_upper': 2000, 'capacity': capacity}
            with self.subTest(stop=stop), self.assertRaisesRegex(RuntimeError, 'native capacity refusal'):
                exec(compile(ast.Module(body=[guard], type_ignores=[]), 'actual-refusal-block', 'exec'), scope)
            self.assertNotIn('stager_args', scope)
            self.assertEqual(before.read_bytes(), b'unchanged canonical incoming evidence')
            self.assertEqual(calls, ['check-scratch'] if stop == 'check-scratch' else ['check-scratch', 'check'])

    def test_new_branch_child_timeout_preserves_original_input_and_partial_evidence(self):
        namespace, plan, incoming, failed, state = self.fixture(remote=True)
        preserved = Path(incoming['preservedPath'])
        original_input = preserved / 'source'; original_input.write_bytes(b'exact preserved input')
        original_records = {path.name: path.read_bytes() for path in failed.iterdir()}
        incoming_before = (self.base / 'evidence' / RELEASE / 'incoming-receipt.json').read_bytes()
        with patch.object(subprocess, 'check_output', side_effect=state):
            admitted = namespace['validate_capacity_resume'](plan)
        # Execute the actual new input branch, then the same actual bounded
        # child runner used for its stager. A killed copy can leave a candidate;
        # neither the branch nor runner rewrites old input/evidence or publishes.
        tree = ast.parse((ROOT / 'remote_transport.py').read_bytes())
        branch = next(node for node in tree.body if isinstance(node, ast.If) and
            isinstance(node.test, ast.Compare) and isinstance(node.test.left, ast.Name) and node.test.left.id == 'phase'
            and isinstance(node.test.ops[0], ast.NotEq) and node.test.comparators[0].value == 'source')
        scope = {'phase': 'preserved-capacity-resume', 'p': plan, 'capacity_incoming': admitted,
            'Path': Path, 'directory': namespace['directory'], 'payload_fingerprint': namespace['payload_fingerprint']}
        exec(compile(ast.Module(body=[branch.body[0]], type_ignores=[]), 'actual-admitted-input', 'exec'), scope)
        out = self.base / ('recovery-transport-' + RELEASE + '-preserved-capacity-resume-capacity-v1'); out.mkdir()
        runner = functions_only('remote_transport.py', {'run'})
        runner.update(out=out, env={}, lock_fd=os.open(self.base, os.O_RDONLY | os.O_DIRECTORY),
            captured_log_bytes=0, TOTAL_LOG_CEILING=16*1024**2)
        stage = self.base / ('proofofwork-www-stage-' + RELEASE)
        child = "import os,time; from pathlib import Path; Path(" + repr(str(stage)) + ").mkdir(); print(os.getpid(),flush=True); time.sleep(30)"
        try:
            with self.assertRaisesRegex(AssertionError, 'Child deadline exceeded'):
                runner['run'](['/usr/bin/python3', '-I', '-B', '-c', child], 'stager.log', timeout=0.05)
        finally: os.close(runner['lock_fd'])
        child_pid = int((out / 'stager.log').read_text().strip())
        with self.assertRaises(ProcessLookupError): os.kill(child_pid, 0)
        self.assertTrue(stage.is_dir())
        self.assertFalse((out / 'receipt.json').exists())
        self.assertEqual(original_input.read_bytes(), b'exact preserved input')
        self.assertEqual(incoming_before, (self.base / 'evidence' / RELEASE / 'incoming-receipt.json').read_bytes())
        self.assertEqual(original_records, {path.name: path.read_bytes() for path in failed.iterdir()})
        with patch.object(subprocess, 'check_output', side_effect=state), self.assertRaisesRegex(AssertionError, 'namespace occupied'):
            namespace['validate_capacity_resume'](plan)


# Native lock fixtures run only the real lock acquisition/closing block in tiny
# local Bash bodies. The pre-repair block reproduces the audited busy-lock fault;
# native historical/current tests below separately run full verifier bodies.
PROVENANCE_HELPER = ROOT.parent / 'proofofwork-ui-release-provenance.sh'
PROVENANCE_SOURCE = PROVENANCE_HELPER.read_text()
PROVENANCE_LOCK_FOOTER = '\n# Only a successful command reaches the closing original descriptor/path fence.\nui_provenance_lock_guard close "${deploy_lock_fd}" "${provenance_lock_pin}"\n'
PROVENANCE_PRIOR_ACQUISITION = r'''
inherited_deploy_lock_fd="${POW_UI_DEPLOY_LOCK_FD:-}"
if [[ -n "${inherited_deploy_lock_fd}" ]]; then
  if [[ ! "${inherited_deploy_lock_fd}" =~ ^[1-9][0-9]*$ ]] ||
    ((inherited_deploy_lock_fd < 3)) ||
    [[ ! -f "/proc/self/fd/${inherited_deploy_lock_fd}" ]] ||
    [[ "$(realpath -e -- "/proc/self/fd/${inherited_deploy_lock_fd}" 2>/dev/null || true)" != "${deploy_lock}" ]]; then
    echo "Inherited UI deployment lock descriptor is invalid." >&2
    exit 64
  fi
  deploy_lock_fd="${inherited_deploy_lock_fd}"
else
  exec {deploy_lock_fd}>"${deploy_lock}"
  chmod 0600 "${deploy_lock}"
fi
if ! flock --exclusive --nonblock "${deploy_lock_fd}"; then
  echo "Another UI deployment or cleanup operation holds ${deploy_lock}." >&2
  exit 1
fi
'''.lstrip('\n')
PROVENANCE_PRIOR_SOURCE = (
    PROVENANCE_SOURCE[:PROVENANCE_SOURCE.index('# Existing lock contenders')]
    + PROVENANCE_PRIOR_ACQUISITION
    + PROVENANCE_SOURCE[PROVENANCE_SOURCE.index('\nmanifest="${ui_root}/.proofofwork-ui-release"'):-len(PROVENANCE_LOCK_FOOTER)]
)
PROVENANCE_PRIOR_SHA = 'b9e27a7df46d10be40ffa7d3d36c77a704fbf9f57063c4f3d884d7d4356d40b8'
PROVENANCE_SOURCE_SHA = '822fb461c8a1d6d3174f47e448d8bd2c0ce548134358da409c97e46fde163215'

def provenance_lock_block(source):
    return source[source.index('deploy_lock="${POW_UI_DEPLOY_LOCK:'):source.index('\nmanifest="${ui_root}/.proofofwork-ui-release"')]

def provenance_lock_identity(s):
    return [getattr(s, k) for k in ('st_dev', 'st_ino', 'st_mode', 'st_uid', 'st_gid', 'st_nlink', 'st_size', 'st_blocks', 'st_mtime_ns', 'st_ctime_ns')]

def provenance_lock_pin(path):
    return {'parentCore': provenance_lock_identity(path.parent.lstat())[:5], 'lockIdentity': provenance_lock_identity(path.lstat())}

PROVENANCE_LOCK_BLOCK = provenance_lock_block(PROVENANCE_SOURCE)
PROVENANCE_LOCK_PYTHON = PROVENANCE_LOCK_BLOCK.split("<<'PY'\n", 1)[1].split("\nPY\n}", 1)[0]

class ProvenanceLock(unittest.TestCase):

    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.base = Path(self.tmp.name)
        self.parent = self.base / 'private'
        self.parent.mkdir(mode=448)
        self.lock = self.parent / 'deploy.lock'
        self.script = self.base / 'fixture.sh'

    def tearDown(self):
        self.tmp.cleanup()

    def file(self, body=b'lock-body'):
        self.lock.write_bytes(body)
        self.lock.chmod(384)
        return self.lock.lstat()

    def script_for(self, body=None, source=PROVENANCE_SOURCE):
        if body is None:
            body = 'printf \'PID:%s\\n\' "$$"\nprintf \'COMMAND:%s\\n\' "$command"\nprintf \'ARG:%s\\n\' "$@"\nprintf \'VERIFIED\\n\'\n'
        start = '#!/usr/bin/bash\nset -Eeuo pipefail\ncommand="${1:-verify-fixture}"\nif (($# > 0)); then shift; fi\n'
        self.script.write_text(start + provenance_lock_block(source) + '\n' + body + (PROVENANCE_LOCK_FOOTER if source == PROVENANCE_SOURCE else ''))
        self.script.chmod(384)

    def run_fixture(self, *args, fd=None, extra=None):
        env = {'PATH': '/usr/bin:/bin', 'LC_ALL': 'C', 'POW_UI_ALLOW_TEST_ROOTS': '1', 'POW_UI_DEPLOY_LOCK': str(self.lock)}
        if fd is not None:
            env['POW_UI_DEPLOY_LOCK_FD'] = str(fd)
        if extra:
            env.update(extra)
        p = subprocess.Popen(['/usr/bin/bash', str(self.script), *(args or ('verify-fixture',))], stdin=subprocess.DEVNULL, stdout=subprocess.PIPE, stderr=subprocess.PIPE, env=env, pass_fds=() if fd is None else (fd,), start_new_session=True)
        out, err = p.communicate(timeout=8)
        return (p.returncode, out, err, p.pid)

    def test_exact_baseline_and_proposed_source_pins(self):
        self.assertEqual(hashlib.sha256(PROVENANCE_PRIOR_SOURCE.encode()).hexdigest(), PROVENANCE_PRIOR_SHA)
        self.assertEqual(hashlib.sha256(PROVENANCE_HELPER.read_bytes()).hexdigest(), PROVENANCE_SOURCE_SHA)

    def test_bash_syntax_full_proposed_source(self):
        p = subprocess.run(['/usr/bin/bash', '-n', str(PROVENANCE_HELPER)], stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=8)
        self.assertEqual((p.returncode, p.stderr), (0, b''))

    def test_all_verifier_record_math_archive_capacity_body_bytes_unchanged(self):
        first = 'inherited_deploy_lock_fd="${POW_UI_DEPLOY_LOCK_FD:-}"'
        before = PROVENANCE_PRIOR_SOURCE[:PROVENANCE_PRIOR_SOURCE.index(first)]
        self.assertTrue(PROVENANCE_SOURCE.startswith(before))
        after = '\nmanifest="${ui_root}/.proofofwork-ui-release"'
        self.assertEqual(PROVENANCE_SOURCE[PROVENANCE_SOURCE.index(after):-len(PROVENANCE_LOCK_FOOTER)], PROVENANCE_PRIOR_SOURCE[PROVENANCE_PRIOR_SOURCE.index(after):])

    def test_old_busy_path_reproduces_truncate_and_timestamp_fault(self):
        before = self.file()
        fd = os.open(self.lock, os.O_RDONLY)
        fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
        self.script_for(source=PROVENANCE_PRIOR_SOURCE)
        try:
            code, out, err, pid = self.run_fixture()
            self.assertNotEqual(code, 0)
            self.assertNotIn(b'VERIFIED', out)
            self.assertEqual(self.lock.read_bytes(), b'')
            self.assertNotEqual(provenance_lock_identity(self.lock.lstat()), provenance_lock_identity(before))
        finally:
            os.close(fd)

    def test_busy_original_body_and_all_authority_stat_fields_unchanged(self):
        before = self.file()
        fd = os.open(self.lock, os.O_RDONLY)
        fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
        self.script_for()
        try:
            code, out, err, pid = self.run_fixture()
            self.assertEqual(code, 1, err)
            self.assertIn(b'Another UI deployment', err)
            self.assertNotIn(b'VERIFIED', out)
            self.assertEqual(self.lock.read_bytes(), b'lock-body')
            self.assertEqual(provenance_lock_identity(before), provenance_lock_identity(self.lock.lstat()))
            self.assertEqual(provenance_lock_identity(os.fstat(fd)), provenance_lock_identity(before))
        finally:
            os.close(fd)

    def test_existing_success_preserves_body_metadata_and_same_process_pid(self):
        before = self.file()
        self.script_for()
        code, out, err, pid = self.run_fixture()
        self.assertEqual(code, 0, err)
        self.assertIn(b'VERIFIED', out)
        self.assertIn(('PID:' + str(pid) + '\n').encode(), out)
        self.assertEqual(provenance_lock_identity(before), provenance_lock_identity(self.lock.lstat()))
        self.assertEqual(self.lock.read_bytes(), b'lock-body')

    def test_first_absent_creation_exclusive_0600_owner_single_link(self):
        self.script_for()
        code, out, err, pid = self.run_fixture()
        self.assertEqual(code, 0, err)
        s = self.lock.lstat()
        self.assertEqual(stat.S_IMODE(s.st_mode), 384)
        self.assertEqual((s.st_uid, s.st_gid, s.st_nlink, s.st_size), (os.geteuid(), os.getegid(), 1, 0))
        self.assertTrue(stat.S_ISREG(s.st_mode))
        self.assertIn(b'VERIFIED', out)

    def test_second_run_never_normalizes_first_created_lock(self):
        self.script_for()
        self.assertEqual(self.run_fixture()[0], 0)
        before = self.lock.lstat()
        self.assertEqual(self.run_fixture()[0], 0)
        self.assertEqual(provenance_lock_identity(self.lock.lstat()), provenance_lock_identity(before))

    def test_exact_argv_reexec_preserved_including_spaces_and_metacharacters(self):
        self.file()
        self.script_for()
        code, out, err, pid = self.run_fixture('verify-fixture', 'two words', 'literal-$value', 'semi;colon')
        self.assertEqual(code, 0, err)
        self.assertIn(b'COMMAND:verify-fixture\nARG:two words\nARG:literal-$value\nARG:semi;colon\n', out)

    def test_inherited_owned_flock_and_descriptor_remain_caller_owned(self):
        before = self.file()
        fd = os.open(self.lock, os.O_RDONLY)
        fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
        self.script_for()
        try:
            code, out, err, pid = self.run_fixture(fd=fd)
            self.assertEqual(code, 0, err)
            self.assertEqual(provenance_lock_identity(os.fstat(fd)), provenance_lock_identity(before))
            other = os.open(self.lock, os.O_RDONLY)
            try:
                with self.assertRaises(BlockingIOError):
                    fcntl.flock(other, fcntl.LOCK_EX | fcntl.LOCK_NB)
            finally:
                os.close(other)
        finally:
            os.close(fd)

    def test_inherited_unlocked_independent_contender_refuses_without_mutation(self):
        before = self.file()
        holder = os.open(self.lock, os.O_RDONLY)
        fd = os.open(self.lock, os.O_RDONLY)
        fcntl.flock(holder, fcntl.LOCK_EX | fcntl.LOCK_NB)
        self.script_for()
        try:
            code, out, err, pid = self.run_fixture(fd=fd)
            self.assertEqual(code, 1, err)
            self.assertNotIn(b'VERIFIED', out)
            self.assertEqual(provenance_lock_identity(self.lock.lstat()), provenance_lock_identity(before))
            self.assertEqual(provenance_lock_identity(os.fstat(fd)), provenance_lock_identity(before))
        finally:
            os.close(holder)
            os.close(fd)

    def test_missing_inherited_descriptor_never_creates_lock(self):
        self.script_for()
        code, out, err, pid = self.run_fixture(extra={'POW_UI_DEPLOY_LOCK_FD': '99999'})
        self.assertNotEqual(code, 0)
        self.assertFalse(self.lock.exists())
        self.assertNotIn(b'VERIFIED', out)

    def test_wrong_inherited_inode_refuses(self):
        self.file()
        other = self.base / 'other'
        other.write_bytes(b'foreign')
        fd = os.open(other, os.O_RDONLY)
        self.script_for()
        try:
            code, out, err, pid = self.run_fixture(fd=fd)
            self.assertNotEqual(code, 0)
            self.assertNotIn(b'VERIFIED', out)
            self.assertEqual(other.read_bytes(), b'foreign')
        finally:
            os.close(fd)

    def test_invalid_descriptor_labels_refuse(self):
        self.file()
        self.script_for()
        for label in ['0', '1', '2', '03', '-3', 'abc', '3.0']:
            with self.subTest(label=label):
                code, out, err, pid = self.run_fixture(extra={'POW_UI_DEPLOY_LOCK_FD': label})
                self.assertNotEqual(code, 0)
                self.assertNotIn(b'VERIFIED', out)

    def test_symlink_lock_refuses_and_preserves_foreign_target(self):
        target = self.base / 'target'
        target.write_bytes(b'foreign')
        self.lock.symlink_to(target)
        self.script_for()
        code, out, err, pid = self.run_fixture()
        self.assertNotEqual(code, 0)
        self.assertEqual(target.read_bytes(), b'foreign')

    def test_hardlink_lock_refuses_without_changing_either_name(self):
        before = self.file()
        os.link(self.lock, self.base / 'alias')
        before = self.lock.lstat()
        self.script_for()
        code, out, err, pid = self.run_fixture()
        self.assertNotEqual(code, 0)
        self.assertEqual(provenance_lock_identity(self.lock.lstat()), provenance_lock_identity(before))
        self.assertEqual(self.lock.read_bytes(), b'lock-body')

    def test_mode0400_refuses_without_redundant_chmod(self):
        self.file()
        self.lock.chmod(256)
        before = self.lock.lstat()
        self.script_for()
        code, out, err, pid = self.run_fixture()
        self.assertNotEqual(code, 0)
        self.assertEqual(provenance_lock_identity(self.lock.lstat()), provenance_lock_identity(before))
        self.assertEqual(stat.S_IMODE(self.lock.lstat().st_mode), 256)

    def test_parent_unsafe_mode_refuses(self):
        self.file()
        self.parent.chmod(493)
        self.script_for()
        code, out, err, pid = self.run_fixture()
        self.assertNotEqual(code, 0)
        self.assertNotIn(b'VERIFIED', out)

    def test_body_timestamp_drift_refuses_at_success_closing_fence(self):
        self.file()
        self.script_for('touch -- "$deploy_lock"\nprintf "BODY_RAN\\n"\n')
        code, out, err, pid = self.run_fixture()
        self.assertNotEqual(code, 0)
        self.assertIn(b'BODY_RAN', out)
        self.assertIn(b'Original UI deployment lock identity changed', err)

    def test_body_path_replacement_refuses_at_success_closing_fence(self):
        self.file()
        self.script_for('mv -- "$deploy_lock" "$deploy_lock.saved"\nprintf foreign > "$deploy_lock"\nchmod 0600 "$deploy_lock"\n')
        code, out, err, pid = self.run_fixture()
        self.assertNotEqual(code, 0)
        self.assertEqual(self.lock.read_bytes(), b'foreign')
        self.assertEqual(Path(str(self.lock) + '.saved').read_bytes(), b'lock-body')

    def test_body_parent_replacement_refuses_at_success_closing_fence(self):
        self.file()
        self.script_for('mv -- "$lock_parent" "$lock_parent.saved"\nmkdir -m0700 -- "$lock_parent"\n')
        code, out, err, pid = self.run_fixture()
        self.assertNotEqual(code, 0)
        self.assertTrue(Path(str(self.parent) + '.saved').exists())

    def test_duplicate_pin_and_bool_metadata_refuse(self):
        self.file()
        fd = os.open(self.lock, os.O_RDONLY)
        self.script_for()
        try:
            for value in ['{"parentCore":[],"parentCore":[],"lockIdentity":[]}', json.dumps({**provenance_lock_pin(self.lock), 'parentCore': [False, *provenance_lock_pin(self.lock)['parentCore'][1:]]}), json.dumps({**provenance_lock_pin(self.lock), 'lockIdentity': [True, *provenance_lock_pin(self.lock)['lockIdentity'][1:]]})]:
                with self.subTest(value=value):
                    code, out, err, pid = self.run_fixture(fd=fd, extra={'POW_UI_PROVENANCE_LOCK_PIN': value})
                    self.assertNotEqual(code, 0)
                    self.assertNotIn(b'VERIFIED', out)
        finally:
            os.close(fd)

class ProvenanceLockFaults(unittest.TestCase):

    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.base = Path(self.tmp.name)
        self.parent = self.base / 'private'
        self.parent.mkdir(mode=448)
        self.lock = self.parent / 'deploy.lock'
        self.real_open = os.open
        self.opened = []

    def tearDown(self):
        for fd in reversed(self.opened):
            try:
                os.close(fd)
            except OSError:
                pass
        self.tmp.cleanup()

    def file(self):
        self.lock.write_bytes(b'original')
        self.lock.chmod(384)

    def execute(self, hook=None, exec_hook=None):

        def opened(*a, **k):
            fd = self.real_open(*a, **k)
            self.opened.append(fd)
            if hook:
                hook(fd, *a, **k)
            return fd
        argv = ['exact_inline_helper', str(self.lock), 'launch', '/fixture/source.sh', 'verify-fixture']
        with patch.object(sys, 'argv', argv), patch.object(os, 'open', side_effect=opened), patch.object(os, 'execve', side_effect=exec_hook or RuntimeError('fixture reached exact exec')):
            exec(compile(PROVENANCE_LOCK_PYTHON, 'exact_source_inline_guard', 'exec'), {})

    def test_after_existing_open_path_replacement_is_preserved_before_flock(self):
        self.file()

        def hook(fd, path, flags, *a, **k):
            if path == 'deploy.lock':
                self.lock.rename(self.parent / 'saved')
                self.lock.write_bytes(b'foreign')
                self.lock.chmod(384)
        with self.assertRaisesRegex(SystemExit, 'identity changed'):
            self.execute(hook)
        self.assertEqual(self.lock.read_bytes(), b'foreign')
        self.assertEqual((self.parent / 'saved').read_bytes(), b'original')

    def test_after_first_creation_parent_replacement_refuses_before_fsync(self):
        called = []
        real_fsync = os.fsync

        def hook(fd, path, flags, *a, **k):
            if flags & os.O_CREAT:
                self.parent.rename(self.base / 'saved')
                self.parent.mkdir(mode=448)
        with patch.object(os, 'fsync', side_effect=lambda fd: (called.append(fd), real_fsync(fd))):
            with self.assertRaisesRegex(SystemExit, 'parent changed'):
                self.execute(hook)
        self.assertEqual(called, [])
        self.assertEqual((self.base / 'saved' / 'deploy.lock').read_bytes(), b'')
        self.assertFalse(self.lock.exists())

    def test_after_first_creation_path_replacement_refuses_before_fsync(self):
        called = []

        def hook(fd, path, flags, *a, **k):
            if flags & os.O_CREAT:
                self.lock.rename(self.parent / 'saved')
                self.lock.write_bytes(b'foreign')
                self.lock.chmod(384)
        with patch.object(os, 'fsync', side_effect=lambda fd: called.append(fd)):
            with self.assertRaisesRegex(SystemExit, 'identity changed'):
                self.execute(hook)
        self.assertEqual(called, [])
        self.assertEqual(self.lock.read_bytes(), b'foreign')
        self.assertEqual((self.parent / 'saved').read_bytes(), b'')

    def test_first_create_collision_has_no_rebase_or_truncate(self):
        real = self.real_open

        def collision(path, flags, *a, **k):
            if flags & os.O_CREAT:
                self.lock.write_bytes(b'racing')
                self.lock.chmod(384)
            fd = real(path, flags, *a, **k)
            self.opened.append(fd)
            return fd
        with patch.object(sys, 'argv', ['exact', str(self.lock), 'launch', '/source.sh', 'verify']), patch.object(os, 'open', side_effect=collision):
            with self.assertRaises(FileExistsError):
                exec(compile(PROVENANCE_LOCK_PYTHON, 'exact_source_inline_guard', 'exec'), {})
        self.assertEqual(self.lock.read_bytes(), b'racing')

    def test_first_created_descriptor_fsync_fault_preserves_zero_inode(self):
        with patch.object(os, 'fsync', side_effect=OSError('fixture fsync failure')):
            with self.assertRaises(OSError):
                self.execute()
        self.assertTrue(self.lock.exists())
        self.assertEqual(self.lock.read_bytes(), b'')
        self.assertEqual(stat.S_IMODE(self.lock.lstat().st_mode), 384)

    def test_first_created_parent_fsync_fault_preserves_zero_inode(self):
        real = os.fsync
        count = 0

        def fsync(fd):
            nonlocal count
            count += 1
            if count == 2:
                raise OSError('fixture parent fsync failure')
            real(fd)
        with patch.object(os, 'fsync', side_effect=fsync):
            with self.assertRaises(OSError):
                self.execute()
        self.assertTrue(self.lock.exists())
        self.assertEqual(self.lock.read_bytes(), b'')

    def test_no_inherited_fd_close_on_guard_failure(self):
        self.file()
        fd = os.open(self.lock, os.O_RDONLY)
        try:
            value = provenance_lock_pin(self.lock)
            value['lockIdentity'][1] += 1
            with patch.object(sys, 'argv', ['exact', str(self.lock), 'admit', str(fd), json.dumps(value)]):
                with self.assertRaisesRegex(SystemExit, 'identity changed'):
                    exec(compile(PROVENANCE_LOCK_PYTHON, 'exact_source_inline_guard', 'exec'), {})
            self.assertEqual(os.fstat(fd).st_ino, self.lock.lstat().st_ino)
        finally:
            os.close(fd)

    def test_production_exclusivecreate_and_nonblocking_nofollow_flags_are_actual_code(self):
        tree = ast.parse(PROVENANCE_LOCK_PYTHON)
        opens = [n for n in ast.walk(tree) if isinstance(n, ast.Call) and isinstance(n.func, ast.Attribute) and (n.func.attr == 'open')]
        self.assertEqual(len(opens), 3)
        launch = [ast.unparse(n) for n in opens if len(n.args) >= 2 and 'path.name' in ast.unparse(n)]
        self.assertEqual(len(launch), 2)
        self.assertTrue(any(('O_RDONLY' in n and 'O_NOFOLLOW' in n and ('O_NONBLOCK' in n) and ('O_TRUNC' not in n) for n in launch)))
        self.assertTrue(any(('O_EXCL' in n and 'O_CREAT' in n and ('O_NOFOLLOW' in n) for n in launch)))
        calls = [n.func.attr for n in ast.walk(tree) if isinstance(n, ast.Call) and isinstance(n.func, ast.Attribute)]
        self.assertTrue(set(calls).isdisjoint({'chmod', 'fchmod', 'chown', 'fchown'}))

    def test_after_flock_timestamp_change_refuses_before_exec(self):
        self.file()
        real = fcntl.flock

        def flock(fd, flags):
            real(fd, flags)
            value = self.lock.lstat()
            os.utime(self.lock, ns=(value.st_atime_ns, value.st_mtime_ns + 1))
        with patch.object(fcntl, 'flock', side_effect=flock):
            with self.assertRaisesRegex(SystemExit, 'identity changed'):
                self.execute()

    def test_after_flock_parent_replacement_refuses_before_exec(self):
        self.file()
        real = fcntl.flock

        def flock(fd, flags):
            real(fd, flags)
            self.parent.rename(self.base / 'saved')
            self.parent.mkdir(mode=448)
        with patch.object(fcntl, 'flock', side_effect=flock):
            with self.assertRaisesRegex(SystemExit, 'parent changed'):
                self.execute()

    def test_fifo_metadata_observation_refuses_without_special_fixture(self):
        self.file()
        real = Path.lstat
        before = provenance_lock_identity(self.lock.lstat())

        def lstat(path, *args, **kwargs):
            value = real(path, *args, **kwargs)
            if path == self.lock:
                values = {name: getattr(value, name) for name in ('st_dev', 'st_ino', 'st_mode', 'st_uid', 'st_gid', 'st_nlink', 'st_size', 'st_blocks', 'st_mtime_ns', 'st_ctime_ns')}
                values['st_mode'] = stat.S_IFIFO | 384
                return types.SimpleNamespace(**values)
            return value
        with patch.object(Path, 'lstat', autospec=True, side_effect=lstat):
            with self.assertRaisesRegex(SystemExit, 'metadata differs'):
                self.execute()
        self.assertEqual(provenance_lock_identity(self.lock.lstat()), before)
        self.assertEqual(self.lock.read_bytes(), b'original')

    def test_direct_owner_mismatch_refuses_without_file_mutation(self):
        self.file()
        real = Path.lstat
        before = provenance_lock_identity(self.lock.lstat())

        def lstat(path, *a, **k):
            value = real(path, *a, **k)
            if path == self.lock:
                d = {name: getattr(value, name) for name in ['st_dev', 'st_ino', 'st_mode', 'st_uid', 'st_gid', 'st_nlink', 'st_size', 'st_blocks', 'st_mtime_ns', 'st_ctime_ns']}
                d['st_uid'] += 1
                return types.SimpleNamespace(**d)
            return value
        with patch.object(Path, 'lstat', autospec=True, side_effect=lstat):
            with self.assertRaisesRegex(SystemExit, 'metadata differs'):
                self.execute()
        self.assertEqual(provenance_lock_identity(self.lock.lstat()), before)
        self.assertEqual(self.lock.read_bytes(), b'original')

    def test_new_inode_mtime_drift_during_file_fsync_not_rebased(self):
        real = os.fsync
        fired = False

        def fsync(fd):
            nonlocal fired
            real(fd)
            if not fired and stat.S_ISREG(os.fstat(fd).st_mode):
                fired = True
                value = self.lock.lstat()
                os.utime(self.lock, ns=(value.st_atime_ns, value.st_mtime_ns + 1))
        with patch.object(os, 'fsync', side_effect=fsync):
            with self.assertRaisesRegex(SystemExit, 'identity changed'):
                self.execute()
        self.assertTrue(fired)
        self.assertTrue(self.lock.exists())
        self.assertEqual(self.lock.read_bytes(), b'')

    def test_new_inode_body_drift_during_parent_fsync_not_rebased(self):
        real = os.fsync
        fired = False

        def fsync(fd):
            nonlocal fired
            real(fd)
            if not fired and stat.S_ISDIR(os.fstat(fd).st_mode):
                fired = True
                self.lock.write_bytes(b'foreign-body')
        with patch.object(os, 'fsync', side_effect=fsync):
            with self.assertRaisesRegex(SystemExit, 'identity changed'):
                self.execute()
        self.assertTrue(fired)
        self.assertEqual(self.lock.read_bytes(), b'foreign-body')

class ProvenanceLockUmask(unittest.TestCase):
    setUp = ProvenanceLock.setUp
    tearDown = ProvenanceLock.tearDown
    file = ProvenanceLock.file
    script_for = ProvenanceLock.script_for

    def test_first_and_existing_launch_preserve_caller_umask(self):
        self.script_for('printf "UMASK:%s\\n" "$(umask)"\n')
        for mask in ('0022', '0002'):
            for existing in (False, True):
                with self.subTest(mask=mask, existing=existing):
                    if self.lock.exists():
                        self.lock.unlink()
                    if existing:
                        self.file()
                    env = {'PATH': '/usr/bin:/bin', 'LC_ALL': 'C', 'POW_UI_ALLOW_TEST_ROOTS': '1', 'POW_UI_DEPLOY_LOCK': str(self.lock)}
                    code = ['/usr/bin/bash', '-c', 'umask "$1"; exec /usr/bin/bash "$2" verify-fixture', 'fixture', mask, str(self.script)]
                    p = subprocess.run(code, stdin=subprocess.DEVNULL, stdout=subprocess.PIPE, stderr=subprocess.PIPE, env=env, timeout=8)
                    self.assertEqual(p.returncode, 0, p.stderr)
                    self.assertEqual(p.stdout, ('UMASK:' + mask + '\n').encode())
                    self.assertEqual(stat.S_IMODE(self.lock.lstat().st_mode), 384)

    def test_launch_create_error_restores_umask_in_exact_inline_function(self):
        real_open = os.open
        opened = []
        original = os.umask(18)
        try:

            def opened_fn(path, flags, *a, **k):
                if flags & os.O_CREAT:
                    raise FileExistsError('fixture first-create collision')
                fd = real_open(path, flags, *a, **k)
                opened.append(fd)
                return fd
            with patch.object(sys, 'argv', ['exact', str(self.lock), 'launch', '/source.sh', 'verify']), patch.object(os, 'open', side_effect=opened_fn):
                with self.assertRaises(FileExistsError):
                    exec(compile(PROVENANCE_LOCK_PYTHON, 'exact_source_inline_guard', 'exec'), {})
            current = os.umask(18)
            self.assertEqual(current, 18)
        finally:
            os.umask(original)
            for fd in opened:
                try:
                    os.close(fd)
                except OSError:
                    pass

if __name__ == '__main__':
    unittest.main(verbosity=2)
