#!/usr/bin/python3 -I
"""Private fixtures only: no production commands, services, archives or paths."""
import datetime as dt
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import signal
import subprocess
import tempfile
import time
import sys
from types import SimpleNamespace
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location('audit29_release', Path(__file__).with_name('release.py'))
release = importlib.util.module_from_spec(spec)
spec.loader.exec_module(release)
C, T, H, OLD, NEW = 'a' * 40, 'b' * 40, 'c' * 64, [1, 2], [1, 3]


def proof():
    return {'ok': True, 'mode': 'shadow', 'network': 'livenet', 'completedAt': '2026-10-01T06:00:00Z',
            'base': 'http://127.0.0.1:18081', 'authority': 'http://127.0.0.1:18081',
            'candidate': {'commit': C, 'tree': T, 'runtimeSha256': H},
            'gates': {'ids': True, 'events': True, 'parity': True},
            'stableCheckpoint': {'height': 969395, 'hash': 'd' * 64}}


def postgres_observation(sessions=0):
    return {'role': 'postgres', 'sessionRole': 'postgres', 'database': 'proof_indexer',
            'readOnly': 'on', 'statementTimeout': '30s', 'lockTimeout': '5s', 'sessions': sessions,
            'rebuild': {'active': False, 'complete': True, 'status': 'complete'}}


def native_fixture():
    fixture = release.Controller(SimpleNamespace(command='node', release_id=C[:12] + '-20261001T060000Z',
                                                postgres_client_sha256=H, commit=C, tree=T))
    fixture.receipts = []
    fixture.save = lambda name, value: fixture.receipts.append((name, value))
    return fixture


class FixtureController(release.Controller):
    def __init__(self, mode='node', position='exchanged'):
        args = SimpleNamespace(command=mode, release_id=C[:12] + '-20261001T060000Z', commit=C,
                               old_manifest_sha256='e' * 64, old_tree_sha256='f' * 64)
        super().__init__(args)
        self.position, self.receipts, self.operations = position, [], []
        self.current = {'live': OLD if position == 'unchanged' else NEW,
                        'stage': NEW if position == 'unchanged' else OLD}
        if position == 'uncertain':
            self.current['live'] = [1, 99]

    def setup(self):
        pass

    def node(self):
        self.old_identity, self.new_identity = OLD, NEW
        self.old_att, self.new_att = ['old'], ['new']
        self.before = {'timers': {}, 'authorities': {}, 'holds': {}, 'apps': {}}
        self.phase = 'exchange-uncertain'
        raise RuntimeError('Injected exchange helper failure after syscall')

    ui = node

    def save(self, name, value):
        self.receipts.append((name, value))

    def attest(self, root):
        return self.old_att if self.current['live' if str(root) == '/opt/proofofwork-api' else 'stage'] == OLD else self.new_att

    def run(self, argv, *args, **kwargs):
        self.operations.append(argv)
        if argv[0] == self.helpers.get('exchange'):
            self.current['live'], self.current['stage'] = self.current['stage'], self.current['live']
            return 'status=exchanged'
        return ''

    def state(self, unit):
        return {'ActiveState': 'inactive', 'MainPID': '0'}

    def fingerprint(self, root):
        return {'manifestSha256': self.args.old_manifest_sha256, 'treeSha256': self.args.old_tree_sha256}

    def unchanged_authority_and_holds(self):
        pass

    def rebind_helpers(self):
        pass

    def drain(self, roots):
        pass

    def start_apps(self):
        self.operations.append(['restore-old-apps'])

    def restore_timers(self):
        self.operations.append(['restore-prior-timers'])


class ReleaseContracts(unittest.TestCase):
    def tearDown(self):
        signal.alarm(0)

    def test_acceptance_requires_every_gate_identity_runtime_and_fence(self):
        current = dt.datetime(2026, 10, 1, 6, 1, tzinfo=dt.timezone.utc)
        release.acceptance(proof(), C, T, H, current)
        for mutate in (lambda p: p['gates'].update(parity=False),
                       lambda p: p.update(authority='http://127.0.0.1:8081'),
                       lambda p: p.update(mode='production'),
                       lambda p: p['candidate'].update(commit='9' * 40),
                       lambda p: p['candidate'].update(runtimeSha256='9' * 64),
                       lambda p: p['stableCheckpoint'].update(hash=''),
                       lambda p: p.update(completedAt='2026-10-01T05:00:00Z'),
                       lambda p: p.update(completedAt='2026-10-01T07:00:00Z')):
            value = proof(); mutate(value)
            with self.assertRaises(RuntimeError):
                release.acceptance(value, C, T, H, current)

    def test_exact_classification_never_omits_duplicates_or_adds_roots(self):
        root = str(release.ROLLBACKS / 'proofofwork-www-pre-fixture')
        row = {'root': root, 'classification': 'retain', 'manifestSha256': H, 'treeSha256': H}
        self.assertEqual(list(release.classifications([row], [root])), [root])
        for records, existing in (([], [root]), ([row], []), ([row, row], [root]),
                                  ([{**row, 'classification': 'remove'}], [root])):
            with self.assertRaises(RuntimeError):
                release.classifications(records, existing)

    def test_active_oneshot_with_zero_pid_still_refuses(self):
        for active, pid in (('activating', '0'), ('active', '77'), ('deactivating', '0')):
            with self.assertRaises(RuntimeError):
                release.quiet({'backup': {'ActiveState': active, 'MainPID': pid}})
        release.quiet({'backup': {'ActiveState': 'inactive', 'MainPID': '0'}})

    def test_inactive_disabled_wal_is_preserved_while_core_is_required_active(self):
        authorities = {u: {'LoadState': 'loaded', 'ActiveState': 'active', 'SubState': 'running',
                          'UnitFileState': 'enabled', 'MainPID': '111', 'NRestarts': '0',
                          'ExecMainStartTimestamp': 'unchanged'} for u in release.KEEP}
        authorities['pg_receivewal@16-main.service'].update(ActiveState='inactive', SubState='dead',
                                                          UnitFileState='disabled', MainPID='0')
        release.authority_baseline(authorities)
        fixture = release.Controller(SimpleNamespace(command='node', release_id=C[:12] + '-20261001T060000Z'))
        fixture.before = {'authorities': authorities, 'holds': {}}
        fixture.holds = lambda: {}
        fixture.state = lambda unit: authorities[unit].copy()
        fixture.unchanged_authority_and_holds()
        for unit in release.REQUIRED_AUTHORITY:
            bad = {**authorities, unit: {**authorities[unit], 'ActiveState': 'failed'}}
            with self.assertRaisesRegex(RuntimeError, 'Authority service'):
                release.authority_baseline(bad)

    def test_wal_state_or_configuration_change_still_refuses(self):
        old = {'LoadState': 'loaded', 'ActiveState': 'inactive', 'SubState': 'dead',
               'UnitFileState': 'disabled', 'MainPID': '0', 'NRestarts': '0', 'ExecMainStartTimestamp': ''}
        fixture = release.Controller(SimpleNamespace(command='node', release_id=C[:12] + '-20261001T060000Z'))
        fixture.before = {'authorities': {'pg_receivewal@16-main.service': old}, 'holds': {}}
        fixture.holds = lambda: {}
        for field, value in [('ActiveState', 'active'), ('SubState', 'running'),
                             ('UnitFileState', 'enabled'), ('MainPID', '123')]:
            fixture.state = lambda unit: {**old, field: value}
            with self.assertRaisesRegex(RuntimeError, 'Authority service identity'):
                fixture.unchanged_authority_and_holds()

    def test_ui_candidate_verification_invokes_helper_against_staged_root(self):
        with tempfile.TemporaryDirectory() as folder:
            base = Path(folder); rollbacks = base / 'rollback-roots'; rollbacks.mkdir()
            helper = base / 'provenance-helper'
            helper.write_text('#!' + sys.executable + '\nimport json,os,sys\n' +
                'print(json.dumps({"argv":sys.argv[1:],"root":os.environ.get("POW_UI_WWW_ROOT"),'
                '"staged":os.environ.get("POW_UI_STAGED_ROOT")}))\n')
            helper.chmod(0o700)
            release_id = C[:12] + '-20261001T060000Z'
            args = SimpleNamespace(command='ui', release_id=release_id, commit=C, tree=T,
                archive_sha256=H, candidate_attestation=base/'candidate.json', attestation_sha256=H,
                classifications=base/'classifications.json', classifications_sha256=H,
                old_manifest_sha256=H, old_tree_sha256=H)
            fixture = release.Controller(args); fixture.out=base
            fixture.helpers = {**fixture.helpers, 'provenance': str(helper)}
            fixture.capacity=lambda: None; fixture.bound_acceptance=lambda: None
            fixture.fingerprint=lambda root: {'manifestSha256':H,'treeSha256':H}
            observed=[]
            def run(argv, *positional, **named):
                if argv[1]=='verify-candidate':
                    output=release.Controller.run(fixture,argv,*positional,**named)
                    observed.append(json.loads(output))
                return ''
            fixture.run=run
            def bound(path,*args,**kwargs):
                if path == args_original.candidate_attestation:
                    return json.dumps({'commit':C,'tree':T,'archiveSha256':H}).encode()
                if path == args_original.classifications: return b'[]'
                return b''
            args_original=args
            with patch.object(release,'ROLLBACKS',rollbacks), patch.object(release,'bound_file',bound), \
                 patch.object(release,'identity',side_effect=RuntimeError('stop before mutation')):
                with self.assertRaisesRegex(RuntimeError,'stop before mutation'): fixture.ui()
            self.assertEqual(len(observed),1)
            self.assertEqual(observed[0]['root'],str(release.SCRATCH/('proofofwork-www-stage-'+release_id)))
            self.assertEqual(observed[0]['staged'],'1')
            self.assertEqual(observed[0]['argv'][0],'verify-candidate')
            self.assertIn(str(release.SCRATCH/('proofofwork-ui-source-'+release_id)),observed[0]['argv'])

    def test_timer_restoration_preserves_masked_and_inactive_states(self):
        before = {'held': {'ActiveState': 'inactive', 'UnitFileState': 'masked'},
                  'enabled': {'ActiveState': 'active', 'UnitFileState': 'enabled'}}
        release.timer_restore(before, before)
        for field, value in (('ActiveState', 'active'), ('UnitFileState', 'enabled')):
            changed = {**before, 'held': {**before['held'], field: value}}
            with self.assertRaises(RuntimeError):
                release.timer_restore(before, changed)

    def test_hash_reader_binds_mutation_clocks_but_allows_atime(self):
        with tempfile.TemporaryDirectory() as root:
            file = Path(root) / 'evidence'; file.write_bytes(b'private fixture')
            digest = hashlib.sha256(file.read_bytes()).hexdigest()
            with patch.object(release, 'safe_path', lambda p: Path(p).lstat()):
                self.assertEqual(release.bound_file(file, digest, text=True), b'private fixture')
                with self.assertRaises(RuntimeError):
                    release.bound_file(file, '0' * 64)

    def test_five_field_attestation_and_duplicate_provenance_refuse(self):
        self.assertEqual(release.attestation(f'{C}\t{T}\t10\t100\t{H}')[4], H)
        for value in (f'{C} {T} 0 100 {H}', f'{C} {T} 10 100 {H} extra'):
            with self.assertRaises(RuntimeError):
                release.attestation(value)
        with self.assertRaises(RuntimeError):
            release.parse_lines('commit=a\ncommit=b\n')

    def test_node_post_syscall_failure_recovers_bound_old_pair(self):
        fixture = FixtureController(position='exchanged')
        with patch.object(release, 'identity', lambda path: fixture.current['live' if str(path) == '/opt/proofofwork-api' else 'stage']):
            with self.assertRaises(RuntimeError):
                fixture.execute()
        self.assertEqual(fixture.phase, 'rolled-back')
        self.assertEqual(fixture.current['live'], OLD)
        self.assertEqual(fixture.current['stage'], NEW)
        self.assertIn(['restore-old-apps'], fixture.operations)
        self.assertIn(['restore-prior-timers'], fixture.operations)
        self.assertTrue(any(name == 'rollback' for name, _ in fixture.receipts))
        self.assertTrue(any(name == 'failure' for name, _ in fixture.receipts))

    def test_exhausted_normal_budget_has_separate_bounded_recovery(self):
        fixture = FixtureController(position='exchanged')
        fixture.deadline = time.monotonic() - 1
        def bounded(argv, *args, **kwargs):
            self.assertGreater(fixture.deadline, time.monotonic())
            self.assertLessEqual(fixture.deadline, fixture.hard_deadline)
            return FixtureController.run(fixture, argv, *args, **kwargs)
        fixture.run = bounded
        with patch.object(release, 'identity', lambda path: fixture.current['live' if str(path) == '/opt/proofofwork-api' else 'stage']):
            with self.assertRaises(RuntimeError):
                fixture.execute()
        self.assertEqual(fixture.phase, 'rolled-back')
        self.assertEqual(fixture.current['live'], OLD)
        self.assertIn(['restore-old-apps'], fixture.operations)
        self.assertIn(['restore-prior-timers'], fixture.operations)

    def test_timeout_kills_private_child_process_group(self):
        with tempfile.TemporaryDirectory() as root:
            fixture = release.Controller(SimpleNamespace(command='node', release_id=C[:12] + '-20261001T060000Z'))
            fixture.out = Path(root)
            marker = Path(root) / 'late-child-write'
            code = ("import os,time,pathlib; child=os.fork(); "
                    "time.sleep(0.5 if child==0 else 10); "
                    "pathlib.Path(" + repr(str(marker)) + ").write_text('unexpected') if child==0 else None")
            with self.assertRaisesRegex(RuntimeError, 'timed out'):
                fixture.run([sys.executable, '-I', '-c', code], 0.1)
            time.sleep(0.6)
            self.assertFalse(marker.exists(), 'timed-out child must not keep writing')

    def test_designated_artifact_writer_can_create_more_than_log_cap(self):
        with tempfile.TemporaryDirectory() as folder:
            fixture=native_fixture(); fixture.out=Path(folder)
            artifact=Path(folder)/'verified-release-fixture'
            code=('import json,pathlib,resource; pathlib.Path('+repr(str(artifact))+').write_bytes(b"x"*(5*1024**2)); '
                  'print(json.dumps({"artifact":"complete","limit":resource.getrlimit(resource.RLIMIT_FSIZE)}))')
            result=fixture.run([sys.executable,'-I','-B','-c',code],10,artifact_writer=True)
            self.assertEqual(json.loads(result), {'artifact':'complete','limit':[2*1024**3,2*1024**3]})
            self.assertEqual(artifact.stat().st_size,5*1024**2)
            self.assertEqual(hashlib.sha256(artifact.read_bytes()).hexdigest(),
                             hashlib.sha256(b'x'*(5*1024**2)).hexdigest())
            self.assertLess((fixture.out/'001-command.log').stat().st_size,4096)

    def test_ordinary_command_cannot_create_artifact_larger_than_four_mib(self):
        with tempfile.TemporaryDirectory() as folder:
            fixture=native_fixture(); fixture.out=Path(folder)
            artifact=Path(folder)/'not-authorized-as-artifact-writer'
            code='import pathlib; pathlib.Path('+repr(str(artifact))+').write_bytes(b"x"*(5*1024**2))'
            with self.assertRaises(RuntimeError):
                fixture.run([sys.executable,'-I','-B','-c',code],10)
            self.assertTrue(artifact.exists())
            self.assertLessEqual(artifact.stat().st_size,4*1024**2)

    def test_native_sql_reader_cannot_enable_artifact_writer_limit(self):
        with tempfile.TemporaryDirectory() as folder:
            fixture=native_fixture(); fixture.out=Path(folder)
            with patch.object(release.subprocess,'Popen') as child:
                with self.assertRaisesRegex(RuntimeError,'SQL reader cannot be an artifact writer'):
                    fixture.run([str(release.POSTGRES_CLIENT),'--version'],as_postgres=True,artifact_writer=True)
                child.assert_not_called()
            self.assertEqual(list(fixture.out.iterdir()),[])

    def test_output_overflow_kills_descendant_even_after_group_leader_exits(self):
        with tempfile.TemporaryDirectory() as folder:
            fixture=native_fixture(); fixture.out=Path(folder)
            marker=Path(folder)/'late-descendant-write'
            leader=Path(folder)/'leader-exited-before-output'
            code=("import os,pathlib,time\nchild=os.fork()\nif child:\n "
                  "pathlib.Path("+repr(str(leader))+").write_text('leader exiting')\n os._exit(0)\n"
                  "time.sleep(0.15)\nos.write(1,b'x'*(4*1024**2+65536))\ntime.sleep(0.8)\n"
                  "pathlib.Path("+repr(str(marker))+").write_text('unexpected')\n")
            started=time.monotonic()
            with self.assertRaises(RuntimeError):
                fixture.run([sys.executable,'-I','-B','-c',code],5,artifact_writer=True)
            self.assertLess(time.monotonic()-started,3)
            self.assertEqual(leader.read_text(),'leader exiting')
            self.assertLessEqual((fixture.out/'001-command.log').stat().st_size,4*1024**2)
            time.sleep(1)
            self.assertFalse(marker.exists(),'overflow must kill the group even after its leader exits')

    def test_pipe_held_by_exited_leader_descendant_obeys_command_deadline(self):
        with tempfile.TemporaryDirectory() as folder:
            fixture=native_fixture(); fixture.out=Path(folder)
            marker=Path(folder)/'late-held-pipe-write'
            code=("import os,pathlib,time\nif os.fork(): os._exit(0)\ntime.sleep(0.8)\n"
                  "pathlib.Path("+repr(str(marker))+").write_text('unexpected')\n")
            started=time.monotonic()
            with self.assertRaisesRegex(RuntimeError,'timed out'):
                fixture.run([sys.executable,'-I','-B','-c',code],0.1)
            self.assertLess(time.monotonic()-started,2)
            time.sleep(0.9)
            self.assertFalse(marker.exists(),'deadline must kill children retaining the output pipe')

    def test_ordinary_command_preserves_exact_inherited_operational_lock_fd(self):
        with tempfile.TemporaryDirectory() as folder:
            fixture=native_fixture(); fixture.out=Path(folder)
            lock=os.open(Path(folder)/'operational-lock',os.O_CREAT|os.O_RDWR,0o600)
            fixture.lock_fd=lock; expected=os.fstat(lock)
            try:
                code=('import json,os; st=os.fstat('+str(lock)+'); '
                      'print(json.dumps({"device":st.st_dev,"inode":st.st_ino}))')
                observed=json.loads(fixture.run([sys.executable,'-I','-B','-c',code],10))
            finally:
                os.close(lock)
            self.assertEqual(observed,{'device':expected.st_dev,'inode':expected.st_ino})

    def test_native_postgres_child_has_fixed_identity_environment_and_no_root_lock_fd(self):
        with tempfile.TemporaryDirectory() as folder:
            fixture = native_fixture(); fixture.out = Path(folder)
            uid, gid = ((65534, 65534) if os.geteuid() == 0 else (os.getuid(), os.getgid()))
            fixture.postgres_account = (uid, gid)
            account = SimpleNamespace(pw_uid=uid, pw_gid=gid)
            lock = os.open(Path(folder)/'private-lock', os.O_CREAT | os.O_RDWR, 0o600)
            os.set_inheritable(lock, True); fixture.lock_fd = lock
            captured = []; processes = []; real_popen = subprocess.Popen
            def popen(argv, **kwargs):
                captured.append(kwargs.copy())
                # This nonroot test cannot call setgroups. Assert the production
                # credential argument below; root runs exercise the native drop.
                if os.geteuid() != 0:
                    kwargs = {key: value for key, value in kwargs.items() if key != 'extra_groups'}
                process=real_popen(argv, **kwargs); processes.append(process); return process
            code = ("import json,os,resource; "
                    "\ntry: os.fstat("+str(lock)+"); inherited=True"
                    "\nexcept OSError: inherited=False"
                    "\nprint(json.dumps({'uid':os.getuid(),'gid':os.getgid(),'groups':os.getgroups(),"
                    "'cwd':os.getcwd(),'lockInherited':inherited,'env':dict(os.environ),"
                    "'coreLimit':resource.getrlimit(resource.RLIMIT_CORE),"
                    "'fileLimit':resource.getrlimit(resource.RLIMIT_FSIZE),"
                    "'sessionLeader':os.getsid(0)==os.getpid(),'umask':os.umask(0)}))")
            try:
                with patch.object(release, 'POSTGRES_CLIENT', Path(sys.executable)), \
                     patch.object(release.pwd, 'getpwnam', return_value=account), \
                     patch.object(release, 'bound_file', return_value=b'fixture client'), \
                     patch.object(release.subprocess, 'Popen', popen), \
                     patch.dict(os.environ, {'PGPASSWORD':'fixture-secret', 'UNRELATED_SECRET':'fixture-secret'}):
                    observed = json.loads(fixture.run([sys.executable, '-I', '-c', code], 10,
                                                     extra=release.POSTGRES_ENV, as_postgres=True))
            finally:
                os.close(lock)
            self.assertEqual((observed['uid'], observed['gid']), (uid, gid))
            if os.geteuid() == 0: self.assertEqual(observed['groups'], [])
            self.assertFalse(observed['lockInherited'])
            self.assertTrue(observed['sessionLeader'])
            self.assertEqual(observed['cwd'], '/')
            self.assertEqual(observed['umask'], 0o077)
            self.assertEqual(observed['coreLimit'], [0, 0])
            self.assertEqual(observed['fileLimit'], [4*1024**2, 4*1024**2])
            self.assertEqual(observed['env'], {**release.ENV, **release.POSTGRES_ENV})
            self.assertEqual(len(captured), 1)
            for key, value in {'user':uid, 'group':gid, 'extra_groups':[], 'umask':0o077,
                               'pass_fds':(), 'cwd':'/', 'start_new_session':True,
                               'stdin':subprocess.DEVNULL, 'stderr':subprocess.STDOUT}.items():
                self.assertEqual(captured[0][key], value)
            self.assertEqual(captured[0]['stdout'],subprocess.PIPE)
            self.assertTrue(processes[0].stdout.closed)

    def test_native_postgres_command_rejects_wrong_executable_or_changed_account(self):
        fixture = native_fixture(); fixture.postgres_account = (1000, 1000)
        with tempfile.TemporaryDirectory() as folder:
            fixture.out = Path(folder)
            with self.assertRaisesRegex(RuntimeError, 'Unexpected PostgreSQL child'):
                fixture.run(['/bin/true'], as_postgres=True)
            for account in (SimpleNamespace(pw_uid=0, pw_gid=1000),
                            SimpleNamespace(pw_uid=1001, pw_gid=1000)):
                with patch.object(release.pwd, 'getpwnam', return_value=account), \
                     patch.object(release.subprocess, 'Popen') as child:
                    with self.assertRaisesRegex(RuntimeError, 'PostgreSQL identity changed'):
                        fixture.run([str(release.POSTGRES_CLIENT), '--version'], as_postgres=True)
                    child.assert_not_called()

    def test_postgres_preflight_missing_client_or_root_identity_refuses_before_stops(self):
        for problem in ('missing-client', 'root-identity'):
            fixture = native_fixture(); operations = []
            fixture.run = lambda *args, **kwargs: operations.append(args) or ''
            fixture.state = lambda unit: operations.append(('state', unit)) or {}
            fixture.hold_timers = lambda: operations.append(('stop-timers',))
            with patch.object(release, 'bound_file', side_effect=(FileNotFoundError('fixture missing client')
                  if problem == 'missing-client' else None)), \
                 patch.object(release.pwd, 'getpwnam', return_value=SimpleNamespace(pw_uid=0, pw_gid=1000)):
                with self.assertRaises((RuntimeError, FileNotFoundError)):
                    fixture.node()
            self.assertEqual(operations, [], 'preflight must precede stops, queries and exchanges')
            self.assertEqual(fixture.phase, 'preflight')

    def test_postgres_preflight_allows_existing_application_sessions_and_records_no_stops(self):
        fixture = native_fixture(); uid, gid = 1000, 1000; calls=[]
        fixture.state = lambda unit: {'ActiveState':'active', 'MainPID':'12345'}
        def run(argv, timeout, **kwargs):
            calls.append((argv, timeout, kwargs))
            return 'psql (PostgreSQL) 16.11' if argv[-1] == '--version' else json.dumps(postgres_observation(3))
        fixture.run = run
        with patch.object(release, 'bound_file', return_value=b'fixture client'), \
             patch.object(release.pwd, 'getpwnam', return_value=SimpleNamespace(pw_uid=uid, pw_gid=gid)), \
             patch.object(release.Path, 'stat', return_value=SimpleNamespace(st_uid=uid)):
            fixture.postgres_preflight()
        self.assertEqual(fixture.postgres_account, (uid, gid))
        self.assertEqual(len(calls), 2)
        name, receipt = fixture.receipts[-1]
        self.assertEqual(name, 'postgres-preflight')
        self.assertEqual(receipt['state']['sessions'], 3)
        self.assertFalse(receipt['applicationServicesStopped'])
        self.assertFalse(receipt['rootLockDescriptorsInherited'])
        self.assertTrue(all(call[2]['as_postgres'] for call in calls))

    def test_postgres_readonly_connection_rejects_settings_and_rebuild_drift(self):
        fixture = native_fixture(); calls=[]
        observed = postgres_observation(2)
        def run(argv, timeout, **kwargs):
            calls.append((argv, timeout, kwargs)); return json.dumps(observed)
        fixture.run = run
        self.assertEqual(fixture.postgres_state()['sessions'], 2)
        argv, timeout, kwargs = calls[0]
        self.assertEqual(argv[:-2], [str(release.POSTGRES_CLIENT), '-X', '-w', '-qAt', '-v', 'ON_ERROR_STOP=1',
                                   '-h', '/run/postgresql', '-p', '5432', '-U', 'postgres', '-d', 'proof_indexer'])
        self.assertEqual(argv[-2], '-c'); self.assertEqual(timeout, 35)
        self.assertEqual(kwargs, {'extra':release.POSTGRES_ENV, 'as_postgres':True})
        self.assertTrue(argv[-1].startswith('BEGIN READ ONLY;'))
        self.assertTrue(argv[-1].endswith(' ROLLBACK;'))
        self.assertNotIn('pg_terminate_backend', argv[-1])
        for field, value in [('role','root'), ('sessionRole','root'), ('database','postgres'),
                             ('readOnly','off'), ('statementTimeout','0'), ('lockTimeout','0')]:
            observed = {**postgres_observation(), field:value}
            with self.assertRaisesRegex(RuntimeError, 'read-only connection'):
                fixture.postgres_state()
        for rebuild in ({'active':True,'complete':True,'status':'complete'},
                        {'active':False,'complete':False,'status':'complete'},
                        {'active':False,'complete':True,'status':'running'}):
            observed = {**postgres_observation(), 'rebuild':rebuild}
            with self.assertRaisesRegex(RuntimeError, 'rebuild'):
                fixture.postgres_state()

    def test_wrong_readonly_preflight_refuses_before_any_stop_or_exchange(self):
        fixture = native_fixture(); calls=[]
        fixture.state=lambda unit: {'ActiveState':'active', 'MainPID':'12345'}
        fixture.run=lambda argv,*args,**kwargs: calls.append(argv) or ('psql (PostgreSQL) 16.11'
            if argv[-1]=='--version' else json.dumps({**postgres_observation(), 'readOnly':'off'}))
        with patch.object(release, 'bound_file', return_value=b'fixture client'), \
             patch.object(release.pwd, 'getpwnam', return_value=SimpleNamespace(pw_uid=1000,pw_gid=1000)), \
             patch.object(release.Path, 'stat', return_value=SimpleNamespace(st_uid=1000)):
            with self.assertRaisesRegex(RuntimeError, 'read-only connection'):
                fixture.node()
        self.assertEqual(len(calls), 2)
        self.assertTrue(all(argv[0] == str(release.POSTGRES_CLIENT) for argv in calls))
        self.assertEqual(fixture.receipts, [])

    def test_poststop_drain_requires_zero_sessions_without_terminating_any(self):
        fixture = native_fixture(); calls=[]; samples=iter([3,1,0])
        fixture.run=lambda argv,*args,**kwargs: calls.append(argv) or ''
        fixture.postgres_state=lambda: postgres_observation(next(samples))
        with patch.object(release.Path,'iterdir',return_value=iter(())), patch.object(release.time,'sleep'):
            fixture.drain(())
        self.assertEqual(fixture.receipts[-1][0], 'drained')
        self.assertEqual(fixture.receipts[-1][1]['sessions'], 0)
        self.assertEqual(len(calls), 1)
        self.assertEqual(calls[0][0], '/usr/bin/ss')
        fixture.receipts=[]; observed=[]
        fixture.postgres_state=lambda: observed.append(1) or postgres_observation(1)
        with patch.object(release.Path,'iterdir',return_value=iter(())), patch.object(release.time,'sleep'):
            with self.assertRaisesRegex(RuntimeError, 'sessions'):
                fixture.drain(())
        self.assertEqual(len(observed), 6)
        self.assertEqual(fixture.receipts, [])

    def test_retry_attempt_has_separate_unit_and_immutable_receipt_namespace(self):
        args = dict(command='node', release_id=C[:12]+'-20261001T060000Z', commit=C, tree=T)
        original = release.Controller(SimpleNamespace(**args))
        retry = release.Controller(SimpleNamespace(**args, attempt='retry1'))
        self.assertNotEqual(original.unit, retry.unit)
        self.assertNotEqual(original.out, retry.out)
        self.assertTrue(retry.unit.endswith('-node-retry1.service'))
        self.assertEqual(retry.out.name, original.out.name+'-retry1')
        for attempt in ('', '../retry', 'Retry1', 'x'*26):
            with self.assertRaisesRegex(RuntimeError, 'Malformed release attempt'):
                release.Controller(SimpleNamespace(**args, attempt=attempt))
        with tempfile.TemporaryDirectory() as folder:
            retry.out=Path(folder)/'existing-receipts'; retry.out.mkdir()
            marker=retry.out/'failure.json'; marker.write_bytes(b'preserved prior failure')
            with patch.object(release.os,'geteuid',return_value=0), \
                 patch.object(release,'safe_path',return_value=SimpleNamespace()), \
                 patch.object(release,'bound_file') as bound, patch.object(retry,'state') as state:
                with self.assertRaises(FileExistsError): retry.setup()
                bound.assert_not_called(); state.assert_not_called()
            self.assertEqual(marker.read_bytes(), b'preserved prior failure')

    def test_node_archive_trigger_passes_actual_installed_publisher_commit_predicate(self):
        publisher = Path(__file__).parents[1]/'proofofwork-node-release-publish.sh'
        lines = publisher.read_text().splitlines()
        starts = [index for index, line in enumerate(lines) if line.startswith('short_commit=')]
        self.assertEqual(len(starts), 1, 'publisher must expose one unambiguous commit-name check')
        start = starts[0]
        self.assertTrue(lines[start+1].startswith('if [[ ! "${name}" =~ '))
        end = next(index for index in range(start+2, len(lines)) if lines[index] == 'fi')
        predicate = '\n'.join(lines[start:end+1])
        script = 'set -eu\ncommit="$1"\nname="$2"\n'+predicate+'\n'
        release_id = C[:12]+'-20261001T060000Z'
        corrected = release.node_archive_name(C, release_id)
        self.assertEqual(corrected, 'proofofwork-node-release-'+C[:7]+'-20261001T060000Z.tgz')
        old = 'proofofwork-node-release-'+C[:12]+'-20261001T060000Z.tgz'
        wrong = 'proofofwork-node-release-'+T[:7]+'-20261001T060000Z.tgz'
        for name, accepted in ((corrected, True), (old, False), (wrong, False)):
            result = subprocess.run(['/bin/bash', '-c', script, 'publisher-filename-fixture', C, name],
                                    stdin=subprocess.DEVNULL, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                                    cwd='/', env=release.ENV, timeout=5)
            self.assertEqual(result.returncode == 0, accepted, name)
        for commit, identity in (('bad', release_id), (C, T[:12]+'-20261001T060000Z')):
            with self.assertRaises(RuntimeError): release.node_archive_name(commit, identity)

    def test_unknown_exchange_never_restarts_or_restores_timers(self):
        fixture = FixtureController(position='uncertain')
        with patch.object(release, 'identity', lambda path: fixture.current['live' if str(path) == '/opt/proofofwork-api' else 'stage']):
            with self.assertRaises(RuntimeError):
                fixture.execute()
        self.assertEqual(fixture.phase, 'inspection-required')
        self.assertNotIn(['restore-old-apps'], fixture.operations)
        self.assertNotIn(['restore-prior-timers'], fixture.operations)
        self.assertFalse(any(op[0] == fixture.helpers['exchange'] for op in fixture.operations))

    def test_ui_publisher_rollback_verified_then_prior_timers_restored(self):
        fixture = FixtureController(mode='ui', position='unchanged')
        with patch.object(release, 'identity', lambda path: OLD):
            with self.assertRaises(RuntimeError):
                fixture.execute()
        self.assertEqual(fixture.phase, 'rolled-back')
        self.assertIn(['restore-prior-timers'], fixture.operations)
        self.assertTrue(any(name == 'publisher-rollback-observed' and value['oldLiveRestoredAndVerified']
                            for name, value in fixture.receipts))

    def test_ui_unproven_rollback_retains_hold_without_second_exchange(self):
        fixture = FixtureController(mode='ui')
        with patch.object(release, 'identity', lambda path: NEW):
            with self.assertRaises(RuntimeError):
                fixture.execute()
        self.assertEqual(fixture.phase, 'inspection-required')
        self.assertNotIn(['restore-prior-timers'], fixture.operations)
        self.assertEqual(fixture.operations, [])


if __name__ == '__main__':
    unittest.main()
