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
from pathlib import Path
import subprocess
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
        prefix = 'proofofwork-ui-surfaces-' + RELEASE + '/surfaces/'
        write_tar(surfaces, [(prefix + name + '/index.html', name.encode(), tarfile.REGTYPE)
                             for name in self.release.SURFACES])
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
        if argv[-1] == 'HEAD^{tree}':
            return TREE + '\n'
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
        self.assertEqual(receipt['publicSurfaces'], 15)
        self.assertEqual(receipt['archiveFilesSkippedNft'], 1)
        self.assertEqual(receipt['archivedFilesChecked'], 15)
        self.assertEqual(receipt['hostnameRootsChecked'], 15)
        self.assertTrue(receipt['apexRedirectVerified'] and receipt['finalLocalEvidenceReverified'])

    def test_archive_traversal_duplicates_links_unknown_or_missing_root_refuse(self):
        changes = [([('../escape', b'x', tarfile.REGTYPE)], ()),
                   ([('surfaces/work/index.html', b'other', tarfile.REGTYPE)], ()),
                   ([('surfaces/work/link', b'', tarfile.SYMTYPE)], ()),
                   ([('surfaces/unknown/index.html', b'x', tarfile.REGTYPE)], ()),
                   ([], ('nft',)), ([], ('computer',))]
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
