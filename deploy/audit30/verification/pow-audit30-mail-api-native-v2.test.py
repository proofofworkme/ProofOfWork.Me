import base64, copy, importlib.util, json, os, pathlib, signal, stat, tempfile, time, types, unittest, subprocess, sys
from unittest.mock import patch

P = pathlib.Path
spec = importlib.util.spec_from_file_location('M', '/tmp/pow-audit30-mail-api-native-v2.py')
M = importlib.util.module_from_spec(spec)
spec.loader.exec_module(M)
UTILITY = P('/tmp/pow-audit30-treasury-native-v7.py').read_bytes()
COLLECTOR = P('/tmp/pow-audit30-mail-api-population-v2.py').read_bytes()


def child(stage='baseline'):
    return {'schema': 'pow-audit30-mail-api-population-request-v1', 'approvalSha256': M.APPROVAL,
            'stage': stage, 'runId': '20261003T060000Z', 'sourceSha256': M.COLLECTOR_SHA,
            'liveFive': {u: {'MainPID': '42', 'InvocationID': 'a' * 32} for u in
                         ('bitcoind.service', 'electrs.service', 'postgresql@16-main.service',
                          'proofofwork-api.service', 'proofofwork-indexer-worker.service')}}


def request():
    raw = M.encoded(child())
    return {'schema': 'pow-audit30-mail-api-native-request-v1', 'approvalSha256': M.APPROVAL,
            'mode': 'run', 'collectorBase64': base64.b64encode(COLLECTOR).decode(),
            'utilityBase64': base64.b64encode(UTILITY).decode(), 'collectorRequestBase64': base64.b64encode(raw).decode(),
            'collectorRequestSha256': M.sha(raw)}


def properties(unit, evidence):
    path = M.BASE / evidence.name.rsplit('-', 1)[1]
    d = {k: '' for k in M.B.FIELDS}
    d.update(M.actual_properties(path, evidence))
    d.update(LoadState='loaded', ActiveState='active', SubState='exited', MainPID='0', InvocationID='a' * 32,
             Result='success', ExecMainStatus='0', User='root', Group='root', Type='exec', Transient='yes',
             ControlGroup='', RestrictAddressFamilies='AF_INET AF_UNIX',
             FragmentPath='/run/systemd/transient/' + unit, DropInPaths='', SourcePath='')
    return d


class Tests(unittest.TestCase):
    def setUp(self):
        M.B = M.load_utility(UTILITY)
        M.LAUNCHED = False
        M.OBSERVER = M.WORK = None
        M.CAPTURES = {}
        M.REQUEST_SHA = 'd' * 64

    def test_frozen_request_and_codepins_are_exact(self):
        files, c = M.request(request())
        self.assertEqual(M.sha(files['collector.py']), M.COLLECTOR_SHA)
        self.assertEqual(M.sha(files['owner-utility.py']), M.UTILITY_SHA)
        self.assertEqual(c['stage'], 'baseline')
        self.assertRaises(ValueError, M.load_utility, UTILITY + b'\n')
        for k, v in [('mode', 'delete'), ('approvalSha256', 'e' * 64), ('collectorBase64', base64.b64encode(COLLECTOR + b'\n').decode())]:
            self.assertRaises(ValueError, M.request, request() | {k: v})
        self.assertRaises(ValueError, M.request, request() | {'extra': 'arbitrary-command'})

    def test_canonical_child_request_and_calendar_live_identity_refusal(self):
        for alteration in (child() | {'stage': 'write'}, child() | {'runId': '20260230T060000Z'},
                           child() | {'liveFive': {}}, child() | {'sourceSha256': 'b' * 64}):
            r = request(); raw = M.encoded(alteration)
            r.update(collectorRequestBase64=base64.b64encode(raw).decode(), collectorRequestSha256=M.sha(raw))
            self.assertRaises(ValueError, M.request, r)
        r = request(); raw = M.encoded(child()) + b'\n'
        r.update(collectorRequestBase64=base64.b64encode(raw).decode(), collectorRequestSha256=M.sha(raw))
        self.assertRaises(ValueError, M.request, r)

    def test_native_setters_path_and_observed_enums_remain_separate(self):
        path = M.BASE / child()['runId']; e = M.EVIDENCE / ('audit30-mail-api-baseline-' + child()['runId'])
        props = M.launch_properties(path, e)
        self.assertEqual(props['StandardInput'], 'file:' + str(path / 'request.json'))
        self.assertEqual(props['StandardOutput'], 'file:' + str(e / 'public-result.json'))
        self.assertEqual(props['StandardError'], 'file:' + str(e / 'stderr.log'))
        d = properties('fixture.service', e); M.validate_properties(d, e)
        self.assertRaises(ValueError, M.validate_properties, d | {'StandardOutput': props['StandardOutput']}, e)
        self.assertEqual(M.command(path, 'd' * 64), ['/usr/bin/python3', '-I', '-B', str(path / 'collector.py'), 'd' * 64])

    def test_owned_role_resources_and_failed_cgroup_are_strict(self):
        e = M.EVIDENCE / ('audit30-mail-api-baseline-' + child()['runId'])
        owner = M.owner_class()('fixture.service', e, 0, ['fixed'])
        d = properties(owner.unit, e)
        self.assertEqual(owner.identity(d), 'a' * 32)
        for key, value in [('User', 'bitcoin'), ('Group', 'postgres'), ('Type', 'simple'),
                           ('Transient', 'no'), ('ControlGroup', '/system.slice/other.service')]:
            self.assertRaises(ValueError, owner.identity, d | {key: value})
        failed = d | {'ActiveState': 'failed', 'SubState': 'failed', 'Result': 'exit-code', 'ExecMainStatus': '2'}
        self.assertRaises(ValueError, owner.identity, failed, True)
        owner.owned = 'a' * 32
        self.assertEqual(owner.identity(failed, True), 'a' * 32)
        self.assertRaises(ValueError, owner.identity, failed)
        self.assertRaises(ValueError, owner.identity, failed | {'InvocationID': 'b' * 32}, True)
        for key in ('MemoryMax', 'CPUQuotaPerSecUSec', 'InaccessiblePaths', 'ReadOnlyPaths', 'LimitFSIZE'):
            self.assertRaises(ValueError, M.validate_properties, d | {key: 'weaker'}, e)

    def test_owner_records_typed_invocation_before_resource_refusal(self):
        e = M.EVIDENCE / ('audit30-mail-api-baseline-' + child()['runId'])
        owner = M.owner_class()('fixture.service', e, 0, ['fixed'])
        d = properties(owner.unit, e) | {'MemoryMax': 'infinity'}
        with patch.object(owner, 'show', return_value=d), patch.object(owner, 'typed_start', return_value={'exact': True}):
            self.assertRaises(ValueError, owner.observe)
        self.assertEqual(owner.owned, 'a' * 32)

    def test_starting_is_not_success_but_positive_pid_owned_state_waits(self):
        d = dict(MainPID='42', ActiveState='activating', SubState='start')
        self.assertEqual(M.state(d), 'waiting')
        self.assertRaises(ValueError, M.state, d | {'MainPID': '0'})
        self.assertRaises(ValueError, M.state, d | {'SubState': 'start-pre'})
        self.assertEqual(M.state(dict(MainPID='0', ActiveState='active', SubState='exited', Result='success', ExecMainStatus='0')), 'finished')

    def test_fragment_is_exact_root_no_dropin_selected_paths(self):
        e = M.EVIDENCE / ('audit30-mail-api-baseline-' + child()['runId'])
        owner = M.owner_class()('fixture.service', e, 0, ['fixed']); d = properties(owner.unit, e)
        p = M.BASE / child()['runId']; wanted = {k: M.launch_properties(p, e)[k] for k in ('StandardInput', 'StandardOutput', 'StandardError')}
        raw = ('[Service]\n' + '\n'.join(k + '=' + v for k, v in wanted.items()) + '\n').encode()
        meta = types.SimpleNamespace(st_dev=1, st_ino=2, st_mode=stat.S_IFREG | 0o644, st_uid=0, st_gid=0, st_nlink=1, st_size=len(raw), st_mtime_ns=1, st_ctime_ns=2)
        with patch.object(M, 'canonical_dir'), patch.object(M.B, 'read_file', return_value=(raw, meta)), patch.object(M.os, 'listxattr', return_value=[]):
            self.assertEqual(owner.output_proof(d)['selectedOutputDirectives'], wanted)
            for bad in (raw + b'StandardInput=file:/other\n', raw.replace(b'[Service]', b'[Unit]'), raw.replace(str(p / 'request.json').encode(), b'/other')):
                with patch.object(M.B, 'read_file', return_value=(bad, meta)):
                    self.assertRaises(ValueError, owner.output_proof, d)
            self.assertRaises(ValueError, owner.output_proof, d | {'DropInPaths': '/other'})

    def test_existing_package_cannot_be_reused_and_no_unit_is_launched(self):
        files, c = M.request(request())
        with tempfile.TemporaryDirectory() as text:
            base = P(text) / 'tools'; base.mkdir(); (base / c['runId']).mkdir()
            with patch.object(M, 'BASE', base), patch.object(M, 'canonical_dir'), patch.object(M.B.Observer, 'command') as command:
                self.assertRaises(ValueError, M.prepare, files, c)
            command.assert_not_called()

    def exercise_run(self, collision=False, weak=False):
        files, c = M.request(request())
        temp = tempfile.TemporaryDirectory(); self.addCleanup(temp.cleanup)
        parent = P(temp.name); base = parent / 'tools'; base.mkdir()
        evidence = parent / ('audit30-mail-api-' + c['stage'] + '-' + c['runId'])
        live = {u: {'MainPID': '42', 'InvocationID': 'a' * 32} for u in c['liveFive']}
        argv = []
        Owner = M.owner_class()
        def command(owner, args, cleanup=False):
            if args[0] == '/usr/bin/systemd-run':
                argv.extend(args)
                public = {'schema': 'pow-audit30-mail-api-population-result-v1', 'stage': 'baseline',
                          'sourceSha256': M.COLLECTOR_SHA, 'populationRows': 619, 'actorCount': 33,
                          'privateCaptureUnchanged': True, 'sourceUnchanged': True, 'liveFiveUnchanged': True,
                          'productionMutation': False, 'privatePayloadExported': False, 'addressesExported': False,
                          'financialCompleteness': False, 'newCoreCalls': 0, 'sqlCalls': 0,
                          'allExpectedRowsVerified': False}
                (evidence / 'public-result.json').write_bytes(M.encoded(public))
                return b''
            if args[:2] == ['/usr/bin/systemctl', 'stop']:
                return b''
            raise AssertionError(args)
        def capture(path, cap):
            raw = path.read_bytes()
            return {'path': str(path), 'bytes': len(raw), 'sha256': M.sha(raw)}, raw
        def fake_capture_identity(path):
            s = path.lstat()
            return (s.st_dev, s.st_ino, s.st_mode, 0, 0, s.st_nlink)
        with patch.object(M, 'BASE', base), patch.object(M, 'EVIDENCE', parent), patch.object(M, 'canonical_dir'), \
             patch.object(M, 'package_proof', return_value={'hashes': 'frozen'}), patch.object(M.B, 'require_absent', side_effect=ValueError('collision') if collision else None), \
             patch.object(M.B, 'live_snapshot', return_value=live), patch.object(M, 'owner_class', return_value=Owner), \
             patch.object(Owner, 'command', command), patch.object(Owner, 'show', side_effect=lambda self=None, cleanup=False: properties('fixture.service', evidence) | ({'MemoryMax': 'infinity'} if weak else {})), \
             patch.object(Owner, 'identity', return_value='a' * 32), patch.object(Owner, 'typed_start', return_value={'fixed': True}), \
             patch.object(Owner, 'output_proof', return_value={'rootFragment': True}), patch.object(M.B, 'capture_proof', side_effect=capture), \
             patch.object(M, 'capture_identity', side_effect=fake_capture_identity):
            if collision or weak:
                self.assertRaises(ValueError, M.run, files, c)
            else:
                value = M.run(files, c)
                self.assertFalse(value['result']['allExpectedRowsVerified'])
        return argv, evidence

    def test_actual_constructed_run_argv_uses_three_exact_file_setters(self):
        argv, evidence = self.exercise_run()
        props = dict(argv[i + 1].split('=', 1) for i, x in enumerate(argv) if x == '--property')
        self.assertEqual(props['StandardOutput'], 'file:' + str(evidence / 'public-result.json'))
        self.assertEqual(props['StandardError'], 'file:' + str(evidence / 'stderr.log'))
        self.assertEqual(props['StandardInput'], 'file:' + str(evidence.parent / 'tools' / child()['runId'] / 'request.json'))
        self.assertNotIn('--collect', argv)

    def test_prelaunch_collision_happens_before_evidence_creation(self):
        argv, evidence = self.exercise_run(collision=True)
        self.assertEqual(argv, [])
        self.assertFalse(evidence.exists())

    def test_weakened_resource_rejected_after_invocation_but_before_result_acceptance(self):
        argv, evidence = self.exercise_run(weak=True)
        self.assertTrue(argv)
        self.assertIsNotNone(M.OBSERVER.owned)

    def test_capture_replaced_after_launch_is_not_accepted_even_same_bytes(self):
        with tempfile.TemporaryDirectory() as text:
            path = P(text) / 'public-result.json'
            path.write_bytes(b'{}')
            path.chmod(0o600)
            with patch.object(M.os, 'listxattr', return_value=[]):
                s = path.lstat()
                with patch.object(M, 'capture_identity', return_value=(s.st_dev, s.st_ino, s.st_mode, 0, 0, 1)):
                    M.CAPTURES[path.name] = M.capture_identity(path)
                    with patch.object(M.B, 'capture_proof', return_value=({'bytes': 2}, b'{}')):
                        self.assertEqual(M.capture(path, 10)[1], b'{}')
                    with patch.object(M, 'capture_identity', return_value=(s.st_dev, s.st_ino + 1, s.st_mode, 0, 0, 1)):
                        self.assertRaises(ValueError, M.capture, path, 10)

    def test_capture_identity_drift_during_read_refuses(self):
        path = P('/public-result.json'); M.CAPTURES[path.name] = (1, 2, 3, 0, 0, 1)
        with patch.object(M, 'capture_identity', side_effect=[M.CAPTURES[path.name], (1, 9, 3, 0, 0, 1)]), \
             patch.object(M.B, 'capture_proof', return_value=({'bytes': 2}, b'{}')):
            self.assertRaises(ValueError, M.capture, path, 10)

    def signal_child(self, mode):
        with tempfile.TemporaryDirectory(dir='/tmp') as text:
            folder = P(text); ready = folder / 'blocking'
            raw = M.encoded(request())
            # Runs only local fixture children. Fixed remote methods and real
            # service discovery are never invoked by this test.
            code = r'''
import importlib.util,sys,os,pathlib,time,types,json
folder=pathlib.Path(sys.argv[1]);mode=sys.argv[2]
s=importlib.util.spec_from_file_location('M','/tmp/pow-audit30-mail-api-native-v2.py');M=importlib.util.module_from_spec(s);s.loader.exec_module(M)
original_stdin=sys.stdin
M.os.geteuid=M.os.getegid=lambda:0
M.os.uname=lambda:types.SimpleNamespace(nodename='pow-bitcoin-01')
raw=pathlib.Path(folder/'request.json').read_bytes()
sys.argv=['fixed',M.sha(raw)]
if mode=='stdin':
 class Block:
  def read(self,n):
   (folder/'blocking').write_text('handler-installed-before-read')
   return original_stdin.buffer.read(n)
 sys.stdin=types.SimpleNamespace(buffer=Block())
else:
 import io
 sys.stdin=types.SimpleNamespace(buffer=io.BytesIO(raw))
 def local_run(files,child):
  M.WORK=folder
  def stop_owned():
   (folder/'cleanup').write_text('cleanup-masked')
   time.sleep(.1)
   return {'attempted':True,'verified':True}
  observer=types.SimpleNamespace(owned='a'*32,snapshots=[],stop_owned=stop_owned)
  M.OBSERVER=observer;M.LAUNCHED=True
  M.B.live_snapshot=lambda _:{'only':'local-fixture'}
  M.package_proof=lambda *_:{'only':'local-fixture'}
  runner=M.B.Observer('fixture-never-a-native-unit',folder,time.monotonic()+20)
  runner.command([sys.executable,'-I','-B','-c','import pathlib,sys,time,os;pathlib.Path(sys.argv[1]).write_text(str(os.getpid()));time.sleep(10)',str(folder/'blocking')])
 M.run=local_run
try:
 M.main()
except BaseException as error:
 print(json.dumps({'errorClass':type(error).__name__}),flush=True)
else:
 print(json.dumps({'errorClass':None}),flush=True)
'''
            (folder / 'request.json').write_bytes(raw)
            p = subprocess.Popen([sys.executable, '-I', '-B', '-c', code, text, mode], stdin=subprocess.PIPE,
                                 stdout=subprocess.PIPE, stderr=subprocess.PIPE, start_new_session=True)
            try:
                start=time.monotonic()
                while not ready.exists() and time.monotonic()-start<2:
                    time.sleep(.01)
                self.assertTrue(ready.exists())
                p.send_signal(signal.SIGTERM)
                if mode=='subprocess':
                    while not (folder/'cleanup').exists() and p.poll() is None and time.monotonic()-start<2:
                        time.sleep(.005)
                    self.assertTrue((folder/'cleanup').exists())
                    p.send_signal(signal.SIGINT)
                out,err=p.communicate(timeout=2)
                self.assertEqual(p.returncode,0);self.assertEqual(err,b'')
                value=json.loads(out)
                if mode=='stdin':
                    self.assertEqual(value['errorClass'],'NativeInterrupted')
                    self.assertFalse((folder/'intent.json').exists())
                else:
                    done=json.loads((folder/'failed.json').read_bytes())
                    self.assertEqual(done['status'],'failed')
                    self.assertEqual(done['failure']['errorClass'],'NativeInterrupted')
                    self.assertTrue(done['cleanup']['verified'])
                    self.assertFalse((folder/'completed.json').exists())
                    with self.assertRaises(ProcessLookupError):os.kill(int(ready.read_text()),0)
                self.assertLess(time.monotonic()-start,2)
            finally:
                if p.poll() is None:
                    os.killpg(p.pid,signal.SIGKILL);p.wait(timeout=2)
                for f in (p.stdin,p.stdout,p.stderr):
                    if not f.closed:f.close()

    def test_actual_pre_stdin_signal_is_refused_without_any_native_action(self):
        self.signal_child('stdin')

    def test_actual_blocking_subprocess_selector_signal_reaches_owned_failure_cleanup(self):
        self.signal_child('subprocess')

    def test_own_signal_category_cannot_be_swallowed_by_selectors_interruptederror_branch(self):
        import selectors
        import inspect
        self.assertTrue(issubclass(M.NativeInterrupted,RuntimeError))
        self.assertFalse(issubclass(M.NativeInterrupted,InterruptedError))
        selector=selectors.DefaultSelector()
        try:
            with patch.object(selector,'_selector',types.SimpleNamespace(poll=lambda *_:(_ for _ in ()).throw(M.NativeInterrupted('fixture')))):
                self.assertRaises(M.NativeInterrupted,selector.select,.01)
        finally:selector.close()


if __name__ == '__main__':
    unittest.main()
