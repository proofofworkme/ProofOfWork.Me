#!/usr/bin/python3 -I
"""Exercise transport selection without contacting either production host."""
import contextlib
import ast
import re
import pathlib
import pwd
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import runpy
import stat
import subprocess
import sys
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import patch

HERE = Path(__file__).resolve().parent


def load(path):
    spec = importlib.util.spec_from_file_location(path.stem, path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


life = load(HERE.parent / 'ui-retention/lifecycle.py')
installer = load(HERE.parent / 'ui-retention/install_lifecycle.py')
publisher = load(HERE / 'release.py')
transport = load(HERE / 'transport_preserve.py')
RUN_PATH = runpy.run_path


class NativeDispatch(unittest.TestCase):
    def test_node_sender_admits_only_guarded_data_build_location(self):
        tree = ast.parse(transport.NODE_BUNDLE_SENDER)
        function = next(n for n in tree.body if isinstance(n, ast.FunctionDef) and n.name == 'permitted_bundle_location')
        ns = dict(pathlib=pathlib, re=re, stat=stat, pwd=pwd)
        exec(compile(ast.Module(body=[function], type_ignores=[]), '<sender-location>', 'exec'), ns)
        allowed = ns['permitted_bundle_location']
        good = Path('/data/proofofwork-ui-builds/release-123/proofofwork-ui-source-x.tgz')
        def info(path, **kwargs):
            return SimpleNamespace(st_mode=stat.S_IFDIR | 0o700, st_uid=0, st_gid=0, st_dev=1 if str(path)=='/' else 2)
        with patch.object(Path, 'stat', info), patch.object(Path, 'resolve', lambda p: p):
            self.assertTrue(allowed(good))
            self.assertTrue(allowed(Path('/tmp/old-build/old.tgz')))
            for bad in ('/data/other/run/a.tgz', '/data/proofofwork-ui-builds/a.tgz', '/data/proofofwork-ui-builds/nested/run/a.tgz', '/data/proofofwork-ui-builds/.hidden/a.tgz', '/data/proofofwork-ui-builds/good/a.zip'):
                self.assertFalse(allowed(Path(bad)), bad)
            for key, value in (('st_uid',12345),('st_gid',12345),('st_mode',stat.S_IFDIR|0o777),('st_dev',1)):
                def unsafe(path, **kwargs):
                    value_info=info(path);setattr(value_info,key,value);return value_info
                with patch.object(Path, 'stat', unsafe):self.assertFalse(allowed(good), key)
        def build_user_info(path, **kwargs):
            row=info(path);row.st_uid=row.st_gid=1000;return row
        with patch.object(Path, 'stat', build_user_info), patch.object(Path, 'resolve', lambda p:p), patch.object(pwd, 'getpwnam', return_value=SimpleNamespace(pw_uid=1000,pw_gid=1000)):
            self.assertTrue(allowed(good))
        with patch.object(Path, 'resolve', lambda p: Path('/tmp/different.tgz')):
            self.assertFalse(allowed(good))

    def test_root_on_node_or_operator_host_refuses_before_files_or_transport(self):
        flags = SimpleNamespace(isolated=1, optimize=0)
        with contextlib.ExitStack() as stack:
            stack.enter_context(patch.object(sys, 'flags', flags))
            for name in ('getuid', 'geteuid', 'getgid', 'getegid'):
                stack.enter_context(patch.object(os, name, return_value=0))
            probe = stack.enter_context(patch.object(subprocess, 'check_output',
                return_value=b'[{"addr_info":[{"local":"65.108.122.87"}]}]'))
            with self.assertRaisesRegex(ValueError, 'production UI address'):
                life.require_ui_host(life.ROOT)
            probe.assert_called_once_with(['/usr/sbin/ip', '-j', '-4', 'address', 'show'], timeout=10)

    def test_installer_release_and_lifecycle_execute_original_argv_without_ssh(self):
        result = subprocess.CompletedProcess([], 0, stdout=b'{}', stderr=b'')
        argv = ['/usr/bin/python3', '-I', '-B', '-c', "print('original guarded script')"]
        for native in (False, True):
            with patch.object(subprocess, 'run', return_value=result) as run:
                with patch.object(publisher, 'UI_HOST', native):
                    publisher.remote(argv, data=b'payload')
                    self.assertIs(publisher.lifecycle_module().UI_HOST, native)
                    self.assertEqual(run.call_args.args[0], argv if native else publisher.SSH + [publisher.shlex.join(argv)])
                    self.assertEqual(run.call_args.kwargs['input'], b'payload')
                with patch.object(life, 'UI_HOST', native):
                    self.assertEqual(life.remote(argv, b'frame'), {})
                    self.assertEqual(run.call_args.args[0], argv if native else life.SSH + [life.shlex.join(argv)])
                with patch.object(installer, 'UI_HOST', native):
                    installer.remote('upgrade-inventory', {'request': 1})
                    command = run.call_args.args[0]
                    self.assertEqual(command[0], '/usr/bin/nice' if native else 'ssh')
                    self.assertIn(b'result=upgrade_inventory(value)', run.call_args.kwargs['input'])

    def test_stream_or_no_stream_matches_the_exact_phase(self):
        with patch.object(os, 'fstat', return_value=SimpleNamespace(st_mode=stat.S_IFIFO)):
            for phase, kind in [('source', 'source'), ('surfaces-stage', 'surfaces')]:
                with transport.phase_source(phase, 'stdin', True, {}, kind) as source:
                    self.assertIs(source, sys.stdin.buffer)
                for forbidden in ('local', 'node-vps'):
                    with self.assertRaises(ValueError):
                        transport.phase_source(phase, forbidden, True, {}, kind)
                with self.assertRaises(ValueError):
                    transport.phase_source(phase, 'stdin', False, {}, kind)
            for phase in ('surfaces-stage-resume', 'preserved-stage-resume', 'preserved-capacity-resume'):
                with transport.phase_source(phase, 'local', True, {}, 'surfaces') as source:
                    self.assertEqual(source, subprocess.DEVNULL)
                with self.assertRaises(ValueError):
                    transport.phase_source(phase, 'stdin', True, {}, 'surfaces')
        with patch.object(os, 'fstat', return_value=SimpleNamespace(st_mode=stat.S_IFREG)):
            with self.assertRaises(ValueError):
                transport.phase_source('source', 'stdin', True, {}, 'source')

    def test_initial_native_receiver_keeps_hash_bound_phase_and_systemd_guards(self):
        with tempfile.TemporaryDirectory(dir='/tmp') as directory:
            root = Path(directory)
            guard_source = (HERE/'publication_admission.py').read_bytes()
            guard_sha = hashlib.sha256(guard_source).hexdigest()
            plan = {'releaseId': 'a'*12+'-20261103T120000Z', 'publicationAttempt':'initial',
                    'wrapperSourceSha256':{'publication_admission.py':guard_sha},
                    'preservingTransportSha256':hashlib.sha256((HERE/'remote_transport.py').read_bytes()).hexdigest()}
            path = root/'plan'; path.write_text(json.dumps(plan))
            for phase in ('source', 'surfaces-stage'):
                guard = lambda repo: self.assertEqual(repo, HERE.parents[1])
                def tools(path):
                    if Path(path).name == 'lifecycle.py':
                        return {'require_ui_host':guard}
                    self.assertEqual(Path(path).name,'release.py')
                    def source(expected):
                        self.assertEqual(expected,guard_sha)
                        return guard_source
                    return {'admission_source':source}
                with patch.object(transport,'dispatch_admission') as admission, \
                        patch.object(runpy, 'run_path', side_effect=tools), \
                        patch.object(os, 'fstat', return_value=SimpleNamespace(st_mode=stat.S_IFIFO)), \
                        patch.object(sys, 'argv', ['transport','--ui-host',str(path),phase,str(root/phase),'--bundle-host','stdin']), \
                        patch.object(subprocess, 'run') as run:
                    transport.main()
                admission.assert_called_once_with(plan,guard_source,True)
                argv = run.call_args.args[0]
                self.assertEqual(argv[:4], ['/usr/bin/python3','-I','-B','-c'])
                self.assertIn('/usr/bin/systemd-run', argv)
                self.assertIn('--pipe', argv)
                self.assertTrue(argv[-4].startswith(guard_source.decode() + '\n'))
                self.assertEqual(argv[-2:], [hashlib.sha256(path.read_bytes()).hexdigest(),phase])
                self.assertIs(run.call_args.kwargs['stdin'], sys.stdin.buffer)

    def test_emitter_refuses_changed_plan_and_cross_release_archive(self):
        with tempfile.TemporaryDirectory(dir='/tmp') as d:
            root = Path(d); rid = 'a'*12+'-20261103T120000Z'; name = 'proofofwork-ui-source-'+rid+'.tgz'
            p = {'schema':'proof-of-work-audit29-ui-transport-plan-v1','releaseId':rid,
                 'commit':'a'*40,'localBundles':{'source':str(root/name),'surfaces':str(root/name)},
                 'source':{'compressedBytes':100,'sha256':'b'*64},'surfaces':{'compressedBytes':100,'sha256':'b'*64}}
            path = root/'plan'; path.write_text(json.dumps(p)); digest = hashlib.sha256(path.read_bytes()).hexdigest()
            with patch.object(os,'geteuid',return_value=0), patch.object(os,'getegid',return_value=0), \
                    patch.object(sys,'flags',SimpleNamespace(isolated=True,optimize=False)), \
                    patch.object(subprocess,'check_output',return_value=b'[{"addr_info":[{"local":"65.108.122.87"}]}]'), \
                    patch.object(os,'execv') as execv:
                for sha,kind in [('1'*64,'source'),(digest,'surfaces')]:
                    with self.assertRaises(ValueError):
                        transport.emit_node_bundle([str(path),sha,kind])
                execv.assert_not_called()
                transport.emit_node_bundle([str(path),digest,'source'])
                self.assertEqual(execv.call_args.args[1][-4:], [transport.NODE_BUNDLE_SENDER,str(root/name),'100','b'*64])

    def test_verifier_propagates_ui_mode_to_https_and_retention(self):
        with tempfile.TemporaryDirectory(dir='/tmp') as d:
            root = Path(d); commit='a'*40; tree='b'*40; rid=commit[:12]+'-20261103T120000Z'
            plan = {'releaseId':rid,'commit':commit,'tree':tree,'retentionLifecycle':{'bound':True},
                    'httpsSmokeSha256':hashlib.sha256((HERE/'https_smoke.py').read_bytes()).hexdigest()}
            manifest='c'*64; archive='d'*64
            publish={'releaseId':rid,'commit':commit,'tree':tree,'exitCode':0,'failure':None}
            proof={'ok':True,'allPriorRootsPreserved':True,'archiveSha256':archive,'manifestSha256':manifest}
            (root/'plan').write_text(json.dumps(plan)); (root/'log').write_text(json.dumps(publish)+'\n'+json.dumps(proof))
            smoke={**proof,**publish}; wrapped={'receipt':smoke,'sha256':'0'*64}
            with patch.object(runpy, 'run_path', return_value={'require_ui_host':lambda repo: None}), \
                    patch.object(sys,'argv',['collect','--ui-host',str(root/'plan'),str(root/'log'),str(root/'done')]), \
                    patch.object(subprocess,'run',return_value=subprocess.CompletedProcess([],0,stdout=json.dumps(wrapped).encode(),stderr=b'')) as run:
                RUN_PATH(str(HERE/'collect_verify.py'), run_name='__main__')
            self.assertEqual(len(run.call_args_list), 2)
            first,second=[c.args[0] for c in run.call_args_list]
            self.assertEqual(first[:4],['/usr/bin/python3','-I','-B','-c'])
            self.assertIn('helperSha256',first[-1])
            self.assertEqual(second[3:6], [str(HERE.parent/'ui-retention/lifecycle.py'),'--ui-host','complete'])


if __name__ == '__main__':
    unittest.main()
