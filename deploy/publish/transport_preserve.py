"""Dispatch one committed, hash-bound UI release phase.

Stream from NODE with "emit-node-bundle PLAN PLAN_SHA256 surfaces|source". On UI
use "--ui-host PLAN surfaces-stage|source NEW_LOG --bundle-host stdin". Resume
phases use "--ui-host PLAN <resume-phase> NEW_LOG" without a stream. Use
python3 -I -B on each host and require both pipeline exit codes.
"""
import argparse
import ast
import hashlib
import json
from pathlib import Path
import shlex
import subprocess
import os
import contextlib
import re
import runpy
import stat
import sys
import selectors
import signal
import time
import secrets

ROOT = Path(__file__).resolve().parent
TRANSPORT_RUNTIME_SECONDS = 7800
TRANSPORT_REMOTE_TIMEOUT_SECONDS = 8100


NODE_BUNDLE_SENDER = r'''
import hashlib,os,pathlib,pwd,re,stat,sys
def permitted_bundle_location(p):
 if not p.is_absolute() or p.resolve()!=p or p.suffix!='.tgz':return False
 if p.is_relative_to('/tmp'):return True
 parent=pathlib.Path('/data/proofofwork-ui-builds')
 if p.parent.parent!=parent or not re.fullmatch(r'[A-Za-z0-9][A-Za-z0-9._-]{0,127}',p.parent.name):return False
 trusted={(0,0)}
 try:
  account=pwd.getpwnam('powadmin');trusted.add((account.pw_uid,account.pw_gid))
 except KeyError:pass
 owner=(parent.stat().st_uid,parent.stat().st_gid)
 if owner not in trusted:return False
 for directory in (parent,p.parent):
  info=directory.stat()
  if not stat.S_ISDIR(info.st_mode) or (info.st_uid,info.st_gid)!=owner or info.st_mode&0o7022:return False
 return parent.stat().st_dev!=pathlib.Path('/').stat().st_dev
p=pathlib.Path(sys.argv[1]);size=int(sys.argv[2]);digest=sys.argv[3]
assert permitted_bundle_location(p)
assert p.name.startswith(('proofofwork-ui-source-','proofofwork-ui-surfaces-'))
owner=(0,0) if p.is_relative_to('/tmp') else (p.parent.stat().st_uid,p.parent.stat().st_gid)
s=p.lstat();assert stat.S_ISREG(s.st_mode) and (s.st_uid,s.st_gid)==owner and not s.st_mode&0o7022 and s.st_nlink==1
assert 0<size<=2*1024**3 and s.st_size==size
def identity(v):return (v.st_dev,v.st_ino,v.st_mode,v.st_nlink,v.st_uid,v.st_gid,v.st_size,v.st_mtime_ns,v.st_ctime_ns)
with os.fdopen(os.open(p,os.O_RDONLY|os.O_NOFOLLOW|os.O_NOATIME),'rb') as f:
 assert identity(os.fstat(f.fileno()))==identity(s)
 assert hashlib.file_digest(f,'sha256').hexdigest()==digest
 assert identity(p.lstat())==identity(s);f.seek(0);count=0
 while b:=f.read(65536):
  count+=len(b);assert count<=size;sys.stdout.buffer.write(b)
 sys.stdout.buffer.flush()
 assert count==size and identity(os.fstat(f.fileno()))==identity(s)==identity(p.lstat())
'''


@contextlib.contextmanager
def bundle_source(plan, kind, host):
    """Stream a hash-bound build from the node VPS without a local disk copy."""
    bundle = Path(plan['localBundles'][kind])
    if host == 'local':
        assert bundle.resolve() == bundle and bundle.is_file() and not bundle.is_symlink()
        assert bundle.stat().st_size == plan[kind]['compressedBytes']
        with bundle.open('rb') as source:
            assert hashlib.file_digest(source, 'sha256').hexdigest() == plan[kind]['sha256']
            source.seek(0)
            yield source
        return
    assert host == 'node-vps'
    # The receiver independently bounds and hashes the incoming stream. The
    # sender also fences the existing file before and after its read.
    command = ['ssh', '-i', '/home/sixer/.ssh/proofofwork_node_ed25519', '-o', 'BatchMode=yes',
               '-o', 'IdentitiesOnly=yes', '-o', 'StrictHostKeyChecking=yes', '-o', 'ConnectTimeout=10',
               'powadmin@65.108.122.87', shlex.join(['sudo', '-n', '/usr/bin/python3', '-I', '-B',
               '-c', NODE_BUNDLE_SENDER, str(bundle), str(plan[kind]['compressedBytes']), plan[kind]['sha256']])]
    child = subprocess.Popen(command, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL)
    try:
        yield child.stdout
        assert child.wait(timeout=30) == 0, 'Remote build stream failed'
    finally:
        child.stdout.close()
        if child.poll() is None:
            child.terminate()
            try: child.wait(timeout=10)
            except subprocess.TimeoutExpired:
                child.kill(); child.wait(timeout=10)


def admission_source(expected):
    return runpy.run_path(str(ROOT / 'release.py'))['admission_source'](expected)


def dispatch_admission(plan, guard, ui_host):
    # Run independent native discovery before even constructing the archive
    # stream or attempt log. The receiver rechecks under its own deploy lock.
    namespace = {}
    exec(compile(guard, 'publication_admission.py', 'exec'), namespace)
    binding, release, private, rule = namespace['plan_gate'](plan)
    lifecycle = runpy.run_path(str(ROOT.parent / 'ui-retention/lifecycle.py'))
    status = lifecycle['status']
    status.__globals__['UI_HOST'] = ui_host
    observed = status(require_complete=True, prospective_release=release if private else None)
    if observed['binding'] != binding:
        raise ValueError('Transport lifecycle binding changed since preflight')
    namespace['check_observation'](observed, private, rule, release=release, compare=True)


def emit_node_bundle(argv):
    """Emit the exact build-VPS archive from the reviewed plan to the UI receiver."""
    parser = argparse.ArgumentParser(description=emit_node_bundle.__doc__)
    parser.add_argument('plan', type=Path)
    parser.add_argument('plan_sha256')
    parser.add_argument('kind', choices=('surfaces', 'source'))
    args = parser.parse_args(argv)
    if (os.geteuid() != 0 or os.getegid() != 0 or not sys.flags.isolated or sys.flags.optimize or
            not re.fullmatch('[0-9a-f]{64}', args.plan_sha256) or
            not args.plan.is_absolute() or args.plan.resolve(strict=True) != args.plan):
        raise ValueError('Node stream requires isolated root execution and exact reviewed plan SHA')
    interfaces = json.loads(subprocess.check_output(['/usr/sbin/ip', '-j', '-4', 'address', 'show'], timeout=10))
    if not any(address.get('local') == '65.108.122.87' for interface in interfaces
               for address in interface.get('addr_info', [])):
        raise ValueError('Archive emission requires the production build node')
    info = args.plan.lstat()
    if not stat.S_ISREG(info.st_mode) or info.st_size > 65536:
        raise ValueError('Invalid node-side plan')
    with os.fdopen(os.open(args.plan, os.O_RDONLY | os.O_NOFOLLOW | os.O_NOATIME), 'rb') as stream:
        raw = stream.read(65537)
    if len(raw) != info.st_size or hashlib.sha256(raw).hexdigest() != args.plan_sha256:
        raise ValueError('Node stream requires isolated root execution and exact reviewed plan SHA')
    plan = json.loads(raw)
    release = plan['releaseId']
    bundle = Path(plan['localBundles'][args.kind])
    if (plan['schema'] != 'proof-of-work-audit29-ui-transport-plan-v1' or
            not re.fullmatch(r'[0-9a-f]{12}-[0-9]{8}T[0-9]{6}Z', release) or
            not re.fullmatch(r'[0-9a-f]{40}', plan['commit']) or not release.startswith(plan['commit'][:12]+'-') or
            bundle.name != 'proofofwork-ui-'+args.kind+'-'+release+'.tgz' or
            not re.fullmatch('[0-9a-f]{64}', plan[args.kind]['sha256'])):
        raise ValueError('Unexpected release or build archive binding')
    os.execv('/usr/bin/python3', ['/usr/bin/python3', '-I', '-B', '-c', NODE_BUNDLE_SENDER,
                                 str(bundle), str(plan[args.kind]['compressedBytes']), plan[args.kind]['sha256']])


def phase_source(phase, host, ui_host, plan, kind):
    resume = phase in ('surfaces-stage-resume', 'preserved-stage-resume', 'preserved-capacity-resume')
    if ui_host and not resume:
        mode = os.fstat(0).st_mode
        if host != 'stdin' or not (stat.S_ISFIFO(mode) or stat.S_ISSOCK(mode)):
            raise ValueError('UI receive requires --bundle-host stdin and a piped node-verified archive')
        return contextlib.nullcontext(sys.stdin.buffer)
    if host == 'stdin' or (ui_host and host == 'node-vps'):
        raise ValueError('Only an initial UI source/surfaces phase accepts a node stream')
    return contextlib.nullcontext(subprocess.DEVNULL) if resume else bundle_source(plan, kind, host)


# Only the native --ui-host dispatcher uses this supervisor. Legacy remote
# orchestration is unchanged and is not qualified by these bounded-log receipts.
DISPATCH_LOG_LIMIT = 2 * 1024**2
OWNER_PREFIX = b'POW_TRANSPORT_OWNER '
OWNER_BOOTSTRAP = """import os,sys
nonce=sys.argv[1];inv=os.environ.get('INVOCATION_ID','')
assert len(nonce)==64 and len(inv)==32 and all(c in '0123456789abcdef' for c in nonce+inv)
sys.stdout.write('POW_TRANSPORT_OWNER '+nonce+' '+inv+' '+str(os.getpid())+'\\n');sys.stdout.flush()
os.execv(sys.argv[2],sys.argv[2:])
"""


class NativeUnitOwner:
    """Keep an authenticated cgroup directory fd; never stop a unit by name."""
    def __init__(self, unit, nonce, invocation, pid):
        assert re.fullmatch(r'proofofwork-recovery-ui-transport-[a-zA-Z0-9.-]+\.service', unit)
        assert re.fullmatch('[0-9a-f]{64}', nonce) and re.fullmatch('[0-9a-f]{32}', invocation)
        assert type(pid) is int and pid > 1
        self.unit, self.nonce, self.invocation, self.pid = unit, nonce, invocation, pid
        self.fd = None
        self.path = Path('/sys/fs/cgroup/system.slice') / unit
        self.check()
        info = self.path.lstat()
        assert self.path.resolve(strict=True) == self.path and stat.S_ISDIR(info.st_mode) and info.st_uid == 0
        self.fd = os.open(self.path, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
        try:
            self.identity = (info.st_dev, info.st_ino)
            assert self.identity == (os.fstat(self.fd).st_dev, os.fstat(self.fd).st_ino)
            self.check()
            assert self.path.stat().st_ino == self.identity[1]
            assert self.path.parent.parent.joinpath('cgroup.controllers').is_file()
        except BaseException:
            self.close()
            raise

    def fields(self):
        result = subprocess.run(
            ['/usr/bin/systemctl', 'show', self.unit, '-p', 'Description', '-p', 'InvocationID',
             '-p', 'ExecMainPID', '-p', 'MainPID', '-p', 'ControlGroup', '-p', 'KillMode',
             '-p', 'RuntimeMaxUSec', '-p', 'ActiveState', '-p', 'SubState', '-p', 'LoadState'],
            stdin=subprocess.DEVNULL, capture_output=True, timeout=10,
            env={'PATH':'/usr/bin:/bin', 'LC_ALL':'C'})
        assert result.returncode == 0 and len(result.stdout) <= 8192
        return dict(line.split('=', 1) for line in result.stdout.decode().splitlines())

    def check(self, fields=None):
        fields = self.fields() if fields is None else fields
        assert fields['Description'] == 'proofofwork-transport:' + self.nonce
        assert fields['InvocationID'] == self.invocation and int(fields['ExecMainPID']) == self.pid
        assert fields['ControlGroup'] == '/system.slice/' + self.unit or (
            fields['ControlGroup'] == '' and fields['ActiveState'] in ('inactive', 'failed')
            and fields['MainPID'] == '0')
        assert fields['KillMode'] == 'control-group'
        assert fields['RuntimeMaxUSec'] == f'{TRANSPORT_RUNTIME_SECONDS // 3600}h {TRANSPORT_RUNTIME_SECONDS % 3600 // 60}min'
        return fields

    def populated(self):
        try:
            fd = os.open('cgroup.events', os.O_RDONLY | os.O_NOFOLLOW, dir_fd=self.fd)
        except FileNotFoundError:
            # A cgroup directory cannot be removed while it is populated.
            assert os.fstat(self.fd).st_nlink == 0
            return False
        try:
            raw = os.read(fd, 4097)
            assert len(raw) <= 4096
            fields = dict(line.split() for line in raw.decode().splitlines())
            assert fields['populated'] in ('0', '1')
            return fields['populated'] == '1'
        finally:
            os.close(fd)

    def abort(self):
        # The open directory anchors the old kernel cgroup even if a pathname
        # is later reused. A replacement InvocationID is never signalled.
        if not self.populated():
            return self.terminal()
        self.check()
        assert (os.fstat(self.fd).st_dev, os.fstat(self.fd).st_ino) == self.identity
        if self.populated():
            fd = os.open('cgroup.kill', os.O_WRONLY | os.O_NOFOLLOW, dir_fd=self.fd)
            try:
                self.check()
                assert os.write(fd, b'1\n') == 2
            finally:
                os.close(fd)
        return self.terminal()

    def terminal(self, timeout=30):
        deadline = time.monotonic() + timeout
        while time.monotonic() < deadline:
            fields = self.fields()
            empty = not self.populated()
            if fields.get('LoadState') == 'not-found':
                return empty and fields.get('MainPID') == '0'
            self.check(fields)
            if (empty and fields['ActiveState'] in ('inactive', 'failed')
                    and fields['MainPID'] == '0'):
                return True
            time.sleep(0.1)
        return False

    def close(self):
        if self.fd is not None:
            os.close(self.fd)
            self.fd = None


def bounded_dispatch(command, source, log, unit, nonce, *, timeout=8100,
                     limit=2097152, owner_factory=NativeUnitOwner, grace=1):
    """Cap only captured output; never apply an artifact file-size limit."""
    child = subprocess.Popen(command, stdin=source, stdout=subprocess.PIPE,
                             stderr=subprocess.STDOUT, start_new_session=True)
    selector = selectors.DefaultSelector()
    selector.register(child.stdout, selectors.EVENT_READ)
    deadline = time.monotonic() + timeout
    owner = None
    first = bytearray()
    count = 0
    reason = None
    native_rc = None
    terminal = False
    witness = None
    interrupted = []
    previous = {}
    def interrupt(signum, frame):
        interrupted.append(signum)
    try:
        for signum in (signal.SIGTERM, signal.SIGINT, signal.SIGHUP):
            previous[signum] = signal.signal(signum, interrupt)
        while selector.get_map() or child.poll() is None:
            if interrupted:
                reason = 'signal'
                break
            left = deadline - time.monotonic()
            if left <= 0:
                reason = 'timeout'
                break
            for key, _ in selector.select(min(0.1, left)):
                block = os.read(key.fileobj.fileno(), 65536)
                if not block:
                    selector.unregister(key.fileobj)
                    continue
                available = max(0, limit - count)
                log.write(block[:available])
                count += len(block)
                first.extend(block)
                while b'\n' in first:
                    line, _, remainder = bytes(first).partition(b'\n')
                    first[:] = remainder
                    if line.startswith(OWNER_PREFIX):
                        fields = line.decode('ascii').split()
                        assert owner is None, 'Duplicate ownership handoff'
                        assert len(fields) == 4 and fields[:2] == ['POW_TRANSPORT_OWNER', nonce]
                        owner = owner_factory(unit, nonce, fields[2], int(fields[3]))
                        witness = {'invocationId':fields[2], 'execMainPid':int(fields[3])}
                assert count > limit or len(first) <= (2048 if owner is None else limit)
                if count > limit:
                    reason = 'output-limit'
                    break
            if reason:
                break
        native_rc = child.poll()
        if owner is None:
            reason = reason or 'ownership-unproved'
        elif reason or native_rc not in (None, 0):
            terminal = owner.abort()
        else:
            terminal = owner.terminal()
        if not terminal:
            reason = reason or 'terminal-unproved'
    except BaseException as error:
        reason = reason or 'supervision-' + type(error).__name__
        if owner is not None:
            try:
                terminal = owner.abort()
            except BaseException:
                terminal = False
    finally:
        # These signals target only our own systemd-run/SSH waiter group.
        # The separately owned native service is handled through cgroup fd.
        if reason or child.poll() is None:
            try:
                os.killpg(child.pid, signal.SIGTERM)
            except ProcessLookupError:
                pass
            time.sleep(grace)
            try:
                os.killpg(child.pid, signal.SIGKILL)
            except ProcessLookupError:
                pass
        try:
            waited = child.wait(timeout=15)
            if native_rc is None:
                native_rc = waited
        except subprocess.TimeoutExpired:
            reason = reason or 'waiter-unreaped'
        selector.close()
        child.stdout.close()
        if owner is not None:
            owner.close()
        for signum, handler in previous.items():
            signal.signal(signum, handler)
        log.flush()
        os.fsync(log.fileno())
    return {'schema':'pow-ui-transport-supervision-v1', 'unit':unit,
            'nonce':nonce, 'owner':witness, 'nativeExitCode':native_rc, 'supervisionReason':reason,
            'capturedBytes':min(count, limit), 'observedBytes':count, 'limitBytes':limit,
            'nativeTerminalProven':terminal,
            'reconcileBeforeRetry':reason is not None or native_rc != 0}


def save_supervision(path, value):
    raw = (json.dumps(value, sort_keys=True) + '\n').encode()
    assert len(raw) <= 8192
    with path.open('xb') as output:
        output.write(raw)
        output.flush()
        os.fsync(output.fileno())
    fd = os.open(path.parent, os.O_RDONLY | os.O_DIRECTORY)
    try:
        os.fsync(fd)
    finally:
        os.close(fd)


def main():
    if sys.argv[1:2] == ['emit-node-bundle']:
        emit_node_bundle(sys.argv[2:])
        return
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--ui-host', action='store_true', help='Run the receiver directly on the production UI VPS')
    parser.add_argument('plan', type=Path)
    parser.add_argument('phase', choices=('surfaces-stage', 'surfaces-stage-resume', 'preserved-stage-resume', 'preserved-capacity-resume', 'source'))
    parser.add_argument('log', type=Path)
    parser.add_argument('--bundle-host', choices=('local', 'node-vps', 'stdin'), default='local')
    args = parser.parse_args()
    if args.ui_host:
        client = runpy.run_path(str(ROOT.parent / 'ui-retention/lifecycle.py'))
        client['require_ui_host'](ROOT.parents[1])
    os.umask(0o077)
    raw = args.plan.read_bytes(); assert len(raw) <= 65536
    p = json.loads(raw); sha = hashlib.sha256(raw).hexdigest()
    script = (ROOT / 'remote_transport.py').read_bytes(); ast.parse(script)
    assert hashlib.sha256(script).hexdigest() == p['preservingTransportSha256']
    guard = admission_source(p['wrapperSourceSha256']['publication_admission.py'])
    script = guard + b'\n' + script
    kind = 'source' if args.phase == 'source' else 'surfaces'
    if args.phase == 'preserved-capacity-resume':
        assert p['preservedCapacityResume'] and p['inputStorage'] == 'release-evidence-v1'
        assert 'resumeSurfaces' not in p and 'preservedStageResume' not in p
    elif args.phase == 'preserved-stage-resume':
        assert p['preservedStageResume'] and p['inputStorage'] == 'release-evidence-v1'
        assert 'resumeSurfaces' not in p and 'preservedCapacityResume' not in p
    elif args.phase == 'surfaces-stage-resume':
        assert p['resumeSurfaces'] and p['inputStorage'] == 'release-evidence-v1'
        assert 'preservedStageResume' not in p and 'preservedCapacityResume' not in p
    elif args.phase == 'surfaces-stage':
        assert not any(key in p for key in ('resumeSurfaces', 'preservedStageResume', 'preservedCapacityResume'))
    remote_plan = '/var/tmp/proofofwork-deploy/recovery-plan-' + p['releaseId'] + '-' + p['publicationAttempt'] + '.json'
    unit = 'proofofwork-recovery-ui-transport-' + p['releaseId'] + '-' + args.phase + '-' + p['publicationAttempt'] + '.service'
    nonce = secrets.token_hex(32) if args.ui_host else None
    argv = ['/usr/bin/systemd-run', '--unit=' + unit,
        '--service-type=exec', '--wait', '--pipe', '--property=User=root', '--property=Group=root',
        '--property=KillMode=control-group', '--property=RuntimeMaxSec=' + str(TRANSPORT_RUNTIME_SECONDS), '--property=TimeoutStopSec=30s',
        '--property=MemoryMax=4G', '--property=MemorySwapMax=0', '--property=TasksMax=128', '--property=UMask=0077',
        '/usr/bin/python3', '-I', '-B', '-c', script.decode(), remote_plan, sha, args.phase]
    if args.ui_host:
        # systemd owns the nonce property atomically with unit creation.
        native_at = argv.index('/usr/bin/python3')
        argv[native_at:native_at] = ['/usr/bin/python3', '-I', '-B', '-c', OWNER_BOOTSTRAP, nonce]
        argv.insert(2, '--property=Description=proofofwork-transport:' + nonce)
    bootstrap = "import os,subprocess,sys; assert os.geteuid()==os.getegid()==0; fields=dict(line.split('=',1) for line in subprocess.check_output(['/usr/bin/systemctl','show',sys.argv[1],'-p','LoadState','-p','ActiveState','-p','MainPID'],text=True,timeout=10).splitlines()); assert fields=={'LoadState':'not-found','ActiveState':'inactive','MainPID':'0'},'Transport unit namespace occupied; preserve evidence and reconcile'; os.execv(sys.argv[2],sys.argv[2:])"
    local = ['/usr/bin/python3', '-I', '-B', '-c', bootstrap, unit, *argv]
    command = local if args.ui_host else ['ssh', '-i', '/home/sixer/.ssh/proofofwork_me_ed25519', '-o', 'BatchMode=yes',
        '-o', 'IdentitiesOnly=yes', '-o', 'StrictHostKeyChecking=yes', '-o', 'ConnectTimeout=10',
        'root@77.42.91.106', shlex.join(local)]
    assert args.log.resolve() == args.log and str(args.log).startswith('/tmp/')
    dispatch_admission(p, guard, args.ui_host)
    context = phase_source(args.phase, args.bundle_host, args.ui_host, p, kind)
    supervision = args.log.with_name(args.log.name + '.supervision.json')
    intent_path = args.log.with_name(args.log.name + '.supervision-intent.json')
    if args.ui_host:
        assert not os.path.lexists(supervision) and not os.path.lexists(intent_path), 'Prior supervision requires reconciliation'
        assert not os.path.lexists(args.log), 'Prior log requires reconciliation'
        save_supervision(intent_path, {'schema':'pow-ui-transport-supervision-intent-v1',
            'unit':unit, 'nonce':nonce, 'planSha256':sha, 'phase':args.phase,
            'logLimitBytes':DISPATCH_LOG_LIMIT, 'runtimeSeconds':TRANSPORT_RUNTIME_SECONDS,
            'reconcileIfTerminalReceiptMissing':True})
    with context as source, args.log.open('xb') as log:
        if args.ui_host:
            result = bounded_dispatch(command, source, log, unit, nonce,
                                      timeout=TRANSPORT_REMOTE_TIMEOUT_SECONDS,
                                      limit=DISPATCH_LOG_LIMIT)
            result['intentSha256'] = hashlib.sha256(intent_path.read_bytes()).hexdigest()
            save_supervision(supervision, result)
            if result['supervisionReason'] or result['nativeExitCode'] != 0:
                raise RuntimeError('Native transport not qualified; inspect bounded supervision receipt')
        else:
            subprocess.run(command, stdin=source, stdout=log, stderr=subprocess.STDOUT,
                           timeout=TRANSPORT_REMOTE_TIMEOUT_SECONDS, check=True)


if __name__ == '__main__':
    main()
