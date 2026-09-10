#!/usr/bin/python3
"""Real local publisher/provenance and HTTP recovery fault tests. No VPS calls.

Systemd kill-group/lifecycle behavior must additionally pass on a disposable
systemd host before production installation. These tests kill the equivalent
local process tree and run recovery in a separate fresh process.
"""
import hashlib
import http.client
import importlib.util
import concurrent.futures
import http.server
import json
import io
import os
from pathlib import Path
import shutil
import signal
import subprocess
import sys
import tempfile
import threading
import time
import unittest

ROOT = Path(__file__).resolve().parents[1]
CONTROLLER = ROOT / 'deploy/audit6/ui-deployment.py'
SURFACES = dict(activity='log', browser='browser', boost='boost', computer='computer',
                desktop='desktop', growth='growth', id='id', inception='inception',
                infinity='infinity', landing='www', marketplace='amo', nft='nft',
                token='credit', wallet='wallet', work='work')


def sha(b):
    return hashlib.sha256(b).hexdigest()


def run(argv, env=None, good=True):
    p = subprocess.run([str(x) for x in argv], env=env, capture_output=True, text=True, timeout=600)
    if good and p.returncode:
        raise AssertionError(str(argv) + '\n' + p.stdout + p.stderr)
    return p


def kill_tree(pid):
    # Includes publisher's separate process group. Production KillMode=control-group
    # must be tested independently; this is not a claim local PIDs are a cgroup.
    parents = {}
    for p in Path('/proc').iterdir():
        if p.name.isdigit():
            try:
                fields = (p / 'stat').read_text().rsplit(')', 1)[1].split()
                parents[int(p.name)] = int(fields[1])
            except (OSError, ValueError):
                pass
    descendants = {pid}
    while True:
        extra = {child for child, parent in parents.items() if parent in descendants}
        if extra <= descendants:
            break
        descendants |= extra
    for child in sorted(descendants, reverse=True):
        try:
            os.kill(child, signal.SIGKILL)
        except ProcessLookupError:
            pass


class Fixture:
    def __init__(self, pause=None, after_exchange=False, conflicting_resource=False, trapped_failure=False):
        os.umask(0o022)
        self.temp = tempfile.TemporaryDirectory(prefix='pow-audit6-deployment-', dir='/tmp')
        self.root = Path(self.temp.name)
        self.www = self.root / 'www'
        self.state = self.root / 'state'
        self.archives = self.root / 'archives'
        self.rollbacks = self.root / 'rollbacks'
        self.stage = self.root / 'stage'
        self.helpers = self.root / 'helpers'
        for p in [self.www, self.state, self.archives, self.rollbacks, self.stage, self.helpers]:
            p.mkdir(mode=0o755)
        self.state.chmod(0o700)
        self.release = 'fixture-candidate'
        self.candidate = self.stage / ('proofofwork-www-stage-' + self.release)
        self.source = self.stage / ('proofofwork-ui-source-' + self.release)
        self.marker = self.root / 'pause-marker'
        self.after_exchange = self.root / 'after-exchange-marker'
        self.release_failure = self.root / 'release-failure'
        self.trap_restored = self.root / 'trap-restored-marker'
        self.resume_recovery = self.root / 'resume-recovery'
        self.fault = False
        self.requests = []
        self.processes = []
        for name, filename in [('publisher', 'proofofwork-ui-release-publish.sh'),
                               ('provenance', 'proofofwork-ui-release-provenance.sh'),
                               ('fingerprint', 'proofofwork-ui-retained-root.py')]:
            p = self.helpers / name
            shutil.copyfile(ROOT / 'deploy' / filename, p)
            p.chmod(0o755)
            assert sha(p.read_bytes()) == sha((ROOT / 'deploy' / filename).read_bytes())
        shutil.copyfile(ROOT / 'deploy/audit6/ui-continuity.py', self.helpers / 'ui-continuity.py')
        (self.helpers / 'ui-continuity.py').chmod(0o755)
        self.provenance = self.helpers / 'provenance'
        if after_exchange:
            wrapper = self.helpers / 'provenance-wrapper'
            wrapper.write_text('#!/usr/bin/python3\nimport os,sys,time,pathlib\n'
                + "if sys.argv[1]=='record':\n"
                + f" pathlib.Path({str(self.after_exchange)!r}).write_text('actual publisher reached post-exchange provenance')\n"
                + ' while True: time.sleep(1)\n'
                + f'os.execv({str(self.provenance)!r},[{str(self.provenance)!r}]+sys.argv[1:])\n')
            wrapper.chmod(0o755)
            self.provenance = wrapper
        for surface in SURFACES:
            p = self.www / ('proofofwork-' + surface)
            (p / 'assets').mkdir(parents=True, mode=0o755)
            label = 'computer' if surface == 'nft' else surface
            (p / 'index.html').write_text(f'<p>old-{label}</p><script src="/assets/old.js"></script>')
            (p / 'assets/old.js').write_text('export const old=true;\n')
        self.env = dict(os.environ, POW_UI_ALLOW_TEST_ROOTS='1', POW_UI_WWW_ROOT=str(self.www),
                        POW_UI_RELEASE_ARCHIVE_ROOT=str(self.archives), POW_UI_DEPLOY_LOCK=str(self.root/'deploy.lock'))
        self.archive('legacy-bootstrap', self.www)
        legacy = self.archives / 'proofofwork-ui-release-legacy-bootstrap.tgz'
        run([self.provenance, 'record-rollback-evidence', '--archive', legacy], self.env)
        self.old_inode = self.www.stat().st_ino
        self.old_manifest = (self.www / '.proofofwork-ui-release').read_bytes()
        shutil.copytree(self.www, self.candidate)
        (self.candidate / '.proofofwork-ui-release').unlink()
        for surface in SURFACES:
            p = self.candidate / ('proofofwork-' + surface)
            label = 'computer' if surface == 'nft' else surface
            (p / 'index.html').write_text(f'<p>new-{label}</p><script src="/assets/new.js"></script>')
            (p / 'assets/new.js').write_text('export const candidate=true;\n')
        if conflicting_resource:
            (self.candidate / 'proofofwork-computer/assets/old.js').write_text('conflicting bytes at an existing URL')
            (self.candidate / 'proofofwork-nft/assets/old.js').write_text('conflicting bytes at an existing URL')
        self.new_inode = self.candidate.stat().st_ino
        if trapped_failure:
            wrapper = self.helpers / 'provenance-wrapper'
            wrapper.write_text('#!/usr/bin/python3\nimport os,sys,time,pathlib\n'
                + f'www=pathlib.Path({str(self.www)!r})\nmarker=pathlib.Path({str(self.after_exchange)!r})\n'
                + "if sys.argv[1]=='record':\n marker.write_text('candidate served before real publisher failure')\n"
                + f' while not pathlib.Path({str(self.release_failure)!r}).exists(): time.sleep(.02)\n'
                + " sys.stderr.write('Injected post-exchange provenance failure\\n');sys.exit(1)\n"
                + f"if sys.argv[1]=='verify-rollback' and marker.exists() and www.stat().st_ino!={self.new_inode}:\n"
                + f" pathlib.Path({str(self.trap_restored)!r}).write_text('publisher trap restored prior before controller recovery')\n"
                + f' while not pathlib.Path({str(self.resume_recovery)!r}).exists(): time.sleep(.02)\n'
                + f'os.execv({str(self.helpers / "provenance")!r},[{str(self.helpers / "provenance")!r}]+sys.argv[1:])\n')
            wrapper.chmod(0o755)
            self.provenance = wrapper
        self.archive(self.release, self.candidate)
        self.source.mkdir(mode=0o755)
        run(['git', '-C', self.source, 'init', '-q'])
        run(['git', '-C', self.source, 'config', 'user.name', 'Deployment Fixture'])
        run(['git', '-C', self.source, 'config', 'user.email', 'fixture@invalid.example'])
        (self.source / '.gitignore').write_text('node_modules/\n')
        (self.source / 'source.txt').write_text('frozen source fixture\n')
        run(['git', '-C', self.source, 'add', '.'])
        run(['git', '-C', self.source, 'commit', '-qm', 'local fixture'])
        run(['git', '-C', self.source, 'checkout', '-q', '--detach'])
        (self.source / 'node_modules/fixture').mkdir(parents=True)
        (self.source / 'node_modules/fixture/index.js').write_text('export default true;\n')
        self.commit = run(['git', '-C', self.source, 'rev-parse', 'HEAD']).stdout.strip()
        for p in self.root.rglob('*'):
            if p.is_file():
                p.chmod(0o755 if p.parent == self.helpers else 0o644)
            elif p.is_dir():
                p.chmod(0o755)
        self.state.chmod(0o700)
        self.gates = self.root / 'gates.json'
        self.gates.write_text(json.dumps({'model': 'proofofwork-reviewed-ui-candidate-v1',
            'candidateCommit': self.commit, 'passed': True, 'rollbackCompatible': True,
            'noPlannedOutage': True, 'checks': [{'name': 'local fixture gate only', 'passed': True,
                                                'evidenceSha256': sha(b'local test receipt')}]}))
        parent = self
        class Handler(http.server.BaseHTTPRequestHandler):
            def do_GET(self):
                host = self.headers.get('Host', '').split(':')[0]
                surface = next((s for s, h in SURFACES.items() if host == h+'.proofofwork.me'), None)
                relative = 'index.html' if self.path == '/' else self.path.lstrip('/')
                try:
                    data = (parent.www / ('proofofwork-' + surface) / relative).read_bytes()
                    if parent.fault and b'new-' in data and surface == 'computer':
                        data = b'intentionally wrong post-publication HTTP content'
                    parent.requests.append((host, self.path, 200))
                    self.send_response(200); self.send_header('Content-Length', str(len(data))); self.end_headers(); self.wfile.write(data)
                except (OSError, TypeError):
                    parent.requests.append((host, self.path, 404)); self.send_error(404)
            def log_message(self, *_):
                pass
        self.http = http.server.ThreadingHTTPServer(('127.0.0.1', 0), Handler)
        self.thread = threading.Thread(target=self.http.serve_forever, daemon=True)
        self.thread.start()
        self.config = self.root / 'test-config.json'
        self.config.write_text(json.dumps({'state': str(self.state), 'www': str(self.www),
            'stage': str(self.stage), 'archives': str(self.archives), 'rollbacks': str(self.rollbacks),
            'lock': str(self.root/'deploy.lock'), 'publisher': str(self.helpers/'publisher'),
            'provenance': str(self.provenance), 'fingerprint': str(self.helpers/'fingerprint'),
            'continuity': str(self.helpers/'ui-continuity.py'),
            'smokePort': self.http.server_port, 'smokeTls': False,
            'pauseAt': pause, 'pauseMarker': str(self.marker)}))
        self.jobpath = self.state / (self.release+'.json')

    def archive(self, name, www):
        payload = self.root / ('payload-' + name)
        (payload/'surfaces').mkdir(parents=True)
        for s in SURFACES:
            shutil.copytree(www/('proofofwork-'+s), payload/'surfaces'/s)
        archive = self.archives/('proofofwork-ui-release-'+name+'.tgz')
        run(['tar', '-czf', archive, '-C', payload, 'surfaces'])
        (Path(str(archive)+'.sha256')).write_text(sha(archive.read_bytes())+'  '+archive.name+'\n')

    def argv(self, action):
        return [sys.executable, '-I', str(CONTROLLER), action, '--test-only', '--test-config', str(self.config)]

    def prepare(self):
        return run(self.argv('prepare')+['--release',self.release,'--commit',self.commit,'--gates-receipt',str(self.gates)])

    def start(self):
        p = subprocess.Popen(self.argv('run')+['--release',self.release], stdout=subprocess.PIPE, stderr=subprocess.PIPE)
        self.processes.append(p)
        return p

    def wait_marker(self, p, marker=None):
        marker = marker or self.marker
        deadline=time.monotonic()+600
        while not marker.exists():
            if p.poll() is not None:
                raise AssertionError('Controller exited before marker: '+str(p.communicate()))
            if time.monotonic()>deadline:
                raise AssertionError('Timed out waiting for fault boundary')
            time.sleep(.02)

    def recover(self):
        # New OS process: no controller memory, closures or original session.
        return run(self.argv('recover-all'))

    def job(self):
        return json.loads(self.jobpath.read_text())

    def close(self):
        for p in self.processes:
            if p.poll() is None:
                kill_tree(p.pid)
            p.communicate(timeout=5)
        self.http.shutdown(); self.http.server_close(); self.thread.join()
        self.temp.cleanup()


class DeploymentTests(unittest.TestCase):
    def fixture(self, **kwargs):
        f=Fixture(**kwargs); self.addCleanup(f.close); return f

    def old_restored(self, f):
        self.assertEqual(f.www.stat().st_ino, f.job()['recovery']['identity'][1])
        preserved = Path(f.job()['originalRoot'])
        self.assertEqual(preserved.stat().st_ino, f.old_inode)
        self.assertEqual((preserved/'.proofofwork-ui-release').read_bytes(), f.old_manifest)
        self.assertEqual((f.www/'proofofwork-computer/index.html').read_bytes(),
                         (preserved/'proofofwork-computer/index.html').read_bytes())
        self.assertEqual(f.job()['rollbackSmoke']['checked'], 45)
        self.assertEqual((f.www/'proofofwork-computer/assets/new.js').read_bytes(),
                         (f.candidate/'proofofwork-computer/assets/new.js').read_bytes())
        self.assertEqual(f.job()['phase'], 'rolled-back')
        self.assertTrue(f.candidate.exists())
        self.assertTrue(all(r[2]==200 for r in f.requests))

    def test_success_commit_then_recovery_does_not_undo(self):
        f=self.fixture(); f.prepare(); p=f.start(); output,error=p.communicate(timeout=600)
        self.assertEqual(p.returncode,0,error); self.assertEqual(f.job()['phase'],'committed')
        self.assertEqual(f.www.stat().st_ino,f.new_inode)
        f.recover(); self.assertEqual(f.www.stat().st_ino,f.new_inode)
        self.assertEqual(f.job()['candidateSmokeResult']['checked'],45)

    def test_kill_before_exchange(self):
        f=self.fixture(pause='armed'); f.prepare(); p=f.start(); f.wait_marker(p)
        kill_tree(p.pid); p.communicate(); f.recover(); self.old_restored(f)

    def test_kill_actual_publisher_after_exchange(self):
        f=self.fixture(after_exchange=True); f.prepare(); p=f.start(); f.wait_marker(p,f.after_exchange)
        self.assertEqual(f.www.stat().st_ino,f.new_inode)
        self.assertEqual(f.job()['phase'],'armed')
        kill_tree(p.pid); p.communicate(); f.recover(); self.old_restored(f)

    def test_failed_http_after_actual_publisher_success(self):
        f=self.fixture(pause='published'); f.prepare(); p=f.start(); f.wait_marker(p)
        self.assertEqual(f.job()['phase'],'published-awaiting-smoke')
        self.assertEqual(f.www.stat().st_ino,f.new_inode)
        f.fault=True; f.marker.unlink(); output,error=p.communicate(timeout=600)
        self.assertNotEqual(p.returncode,0); self.assertIn(b'prior UI restored',error)
        self.old_restored(f)

    def test_kill_after_publication_before_smoke(self):
        f=self.fixture(pause='published'); f.prepare(); p=f.start(); f.wait_marker(p)
        kill_tree(p.pid); p.communicate(); f.recover(); self.old_restored(f)

    def test_kill_after_restore_exchange_is_idempotent(self):
        f=self.fixture(pause='rollback-exchanged'); f.prepare(); f.fault=True; p=f.start(); f.wait_marker(p)
        self.assertEqual(f.www.stat().st_ino,f.job()['recovery']['identity'][1])
        kill_tree(p.pid); p.communicate(); f.recover(); self.old_restored(f)

    def test_kill_after_durable_commit_does_not_rollback(self):
        f=self.fixture(pause='committed'); f.prepare(); p=f.start(); f.wait_marker(p)
        kill_tree(p.pid); p.communicate(); f.recover()
        self.assertEqual(f.job()['phase'],'committed'); self.assertEqual(f.www.stat().st_ino,f.new_inode)

    def test_prepared_job_is_not_published_or_cancelled_by_watch(self):
        f=self.fixture(); f.prepare(); f.recover()
        self.assertEqual(f.job()['phase'],'prepared'); self.assertEqual(f.www.stat().st_ino,f.old_inode)

    def test_gate_commit_mismatch_and_helper_drift_refuse(self):
        f=self.fixture(); gates=json.loads(f.gates.read_text()); gates['candidateCommit']='0'*40; f.gates.write_text(json.dumps(gates))
        result=run(f.argv('prepare')+['--release',f.release,'--commit',f.commit,'--gates-receipt',str(f.gates)],good=False)
        self.assertNotEqual(result.returncode,0); self.assertFalse(f.jobpath.exists())
        gates['candidateCommit']=f.commit; f.gates.write_text(json.dumps(gates)); f.prepare()
        with (f.helpers/'publisher').open('a') as out:out.write('\n# altered after preparation\n')
        p=f.start(); output,error=p.communicate(timeout=15)
        self.assertNotEqual(p.returncode,0); self.assertEqual(f.www.stat().st_ino,f.old_inode)

    def test_conflicting_resource_is_refused_before_arming(self):
        f=self.fixture(conflicting_resource=True)
        result=run(f.argv('prepare')+['--release', f.release, '--commit', f.commit, '--gates-receipt', str(f.gates)], good=False)
        self.assertNotEqual(result.returncode, 0)
        self.assertIn('conflicting bytes or modes', result.stderr)
        self.assertEqual(f.www.stat().st_ino, f.old_inode)
        self.assertFalse(f.jobpath.exists())

    def test_missing_continuity_proof_cannot_arm(self):
        f=self.fixture(); f.prepare()
        job=f.job(); del job['recovery']; f.jobpath.write_text(json.dumps(job)); f.jobpath.chmod(0o600)
        p=f.start(); output,error=p.communicate(timeout=15)
        self.assertNotEqual(p.returncode,0); self.assertIn(b'Missing pre-attested',error)
        self.assertEqual(f.www.stat().st_ino,f.old_inode)

    def test_kill_after_preserving_original_before_recovery_exchange(self):
        f=self.fixture(pause='prior-preserved'); f.prepare(); p=f.start(); f.wait_marker(p)
        self.assertEqual(Path(f.job()['originalRoot']).stat().st_ino, f.old_inode)
        self.assertEqual(f.www.stat().st_ino, f.job()['recovery']['identity'][1])
        kill_tree(p.pid); p.communicate(); f.recover(); self.old_restored(f)

    def test_kill_after_prepublication_union_exchange(self):
        f=self.fixture(pause='union-exchanged'); f.prepare(); p=f.start(); f.wait_marker(p)
        self.assertEqual(f.www.stat().st_ino, f.job()['recovery']['identity'][1])
        self.assertEqual(Path(f.job()['recovery']['root']).stat().st_ino, f.old_inode)
        kill_tree(p.pid); p.communicate(); f.recover(); self.old_restored(f)

    def test_kill_after_preserving_displaced_root(self):
        f=self.fixture(pause='displaced-preserved'); f.prepare(); f.fault=True; p=f.start(); f.wait_marker(p)
        kill_tree(p.pid); p.communicate(); f.recover(); self.old_restored(f)

    def test_candidate_html_resource_survives_rollback(self):
        f=self.fixture(pause='published'); f.prepare(); p=f.start(); f.wait_marker(p)
        def get(path):
            connection=http.client.HTTPConnection('127.0.0.1',f.http.server_port,timeout=10)
            try:
                connection.request('GET',path,headers={'Host':'computer.proofofwork.me'})
                response=connection.getresponse(); return response.status,response.read()
            finally: connection.close()
        before=get('/'); self.assertIn(b'/assets/new.js',before[1])
        asset=get('/assets/new.js'); self.assertEqual(asset[0],200)
        kill_tree(p.pid); p.communicate(); f.recover(); self.old_restored(f)
        self.assertEqual(get('/assets/new.js'),asset)
        self.assertIn(b'old-computer',get('/')[1])

    def test_publisher_exit_trap_preserves_candidate_asset_continuously(self):
        f=self.fixture(trapped_failure=True); f.prepare(); p=f.start(); f.wait_marker(p,f.after_exchange)
        def get(path):
            connection=http.client.HTTPConnection('127.0.0.1',f.http.server_port,timeout=5)
            try:
                connection.request('GET',path,headers={'Host':'computer.proofofwork.me'})
                response=connection.getresponse(); return response.status,response.read()
            finally: connection.close()
        self.assertIn(b'/assets/new.js',get('/')[1])
        expected=get('/assets/new.js'); self.assertEqual(expected[0],200)
        samples=[]; failures=[]; stopped=threading.Event()
        def poll():
            while not stopped.is_set():
                try:
                    actual=get('/assets/new.js'); samples.append(actual)
                    if actual != expected: failures.append(actual[0])
                except Exception as error: failures.append(type(error).__name__)
                stopped.wait(.05)
        thread=threading.Thread(target=poll,daemon=True); thread.start()
        try:
            f.release_failure.write_text('fail the actual post-exchange publisher record call')
            f.wait_marker(p,f.trap_restored)
            # This is the former 404 interval: the legacy EXIT trap completed,
            # while the controller is held before union recovery verification.
            self.assertEqual(f.www.stat().st_ino,f.job()['recovery']['identity'][1])
            self.assertEqual(get('/assets/new.js'),expected)
            self.assertIn(b'old-computer',get('/')[1])
            f.resume_recovery.write_text('resume checked recovery')
            _output,error=p.communicate(timeout=600)
            self.assertNotEqual(p.returncode,0,error)
            self.old_restored(f)
            self.assertEqual(get('/assets/new.js'),expected)
        finally:
            stopped.set(); thread.join(timeout=10)
        self.assertFalse(thread.is_alive()); self.assertTrue(samples); self.assertEqual(failures,[])

    def test_unclassified_retained_root_refuses_before_live_exchange(self):
        f=self.fixture()
        (f.rollbacks/'proofofwork-www-pre-unclassified').mkdir(mode=0o755)
        result=run(f.argv('prepare')+['--release',f.release,'--commit',f.commit,'--gates-receipt',str(f.gates)],good=False)
        self.assertNotEqual(result.returncode,0)
        self.assertIn('Every existing rollback root',result.stderr)
        self.assertEqual(f.www.stat().st_ino,f.old_inode); self.assertFalse(f.jobpath.exists())

    def test_units_preserve_caddy_and_cover_main_process_death(self):
        unit=(ROOT/'deploy/audit6/proofofwork-ui-deployment@.service').read_text()
        watch=(ROOT/'deploy/audit6/proofofwork-ui-deployment-recovery.timer').read_text()
        self.assertIn('Restart=on-failure',unit); self.assertIn('KillMode=control-group',unit)
        self.assertIn('RuntimeMaxSec=15min',unit); self.assertIn('WantedBy=multi-user.target',unit)
        self.assertIn('OnBootSec=10s',watch); self.assertIn('OnUnitInactiveSec=10s',watch)
        self.assertNotIn('systemctl stop',CONTROLLER.read_text())
        self.assertNotIn('ReadWritePaths=/var/www ',unit)


if __name__=='__main__':
    parallel_option = next((arg for arg in sys.argv if arg in ('--jobs=2', '--jobs=3')), None)
    if parallel_option:
        sys.argv.remove(parallel_option)
        assert len(sys.argv) == 1, 'Parallel mode runs the complete suite'
        def test_one(name):
            output = io.StringIO()
            result = unittest.TextTestRunner(stream=output, verbosity=2).run(
                unittest.defaultTestLoader.loadTestsFromName('DeploymentTests.' + name, sys.modules[__name__]))
            return result.wasSuccessful(), output.getvalue()
        results = []
        with concurrent.futures.ThreadPoolExecutor(max_workers=int(parallel_option[-1])) as pool:
            futures = [pool.submit(test_one, name) for name in unittest.defaultTestLoader.getTestCaseNames(DeploymentTests)]
            for future in concurrent.futures.as_completed(futures):
                result = future.result()
                results.append(result)
                print(result[1], end='', flush=True)
        sys.exit(0 if all(ok for ok, _ in results) else 1)
    else:
        unittest.main(verbosity=2)
