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

ROOT = Path(__file__).resolve().parent
TRANSPORT_RUNTIME_SECONDS = 6000
TRANSPORT_REMOTE_TIMEOUT_SECONDS = 6300


NODE_BUNDLE_SENDER = r'''
import hashlib,os,pathlib,stat,sys
p=pathlib.Path(sys.argv[1]);size=int(sys.argv[2]);digest=sys.argv[3]
assert p.is_absolute() and p.resolve()==p and p.is_relative_to('/tmp') and p.suffix=='.tgz'
assert p.name.startswith(('proofofwork-ui-source-','proofofwork-ui-surfaces-'))
s=p.lstat();assert stat.S_ISREG(s.st_mode) and s.st_uid==s.st_gid==0 and not s.st_mode&0o7022 and s.st_nlink==1
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
    argv = ['/usr/bin/systemd-run', '--unit=' + unit,
        '--service-type=exec', '--wait', '--pipe', '--property=User=root', '--property=Group=root',
        '--property=KillMode=control-group', '--property=RuntimeMaxSec=' + str(TRANSPORT_RUNTIME_SECONDS), '--property=TimeoutStopSec=30s',
        '--property=MemoryMax=4G', '--property=MemorySwapMax=0', '--property=TasksMax=128', '--property=UMask=0077',
        '/usr/bin/python3', '-I', '-B', '-c', script.decode(), remote_plan, sha, args.phase]
    bootstrap = "import os,subprocess,sys; assert os.geteuid()==os.getegid()==0; fields=dict(line.split('=',1) for line in subprocess.check_output(['/usr/bin/systemctl','show',sys.argv[1],'-p','LoadState','-p','ActiveState','-p','MainPID'],text=True,timeout=10).splitlines()); assert fields=={'LoadState':'not-found','ActiveState':'inactive','MainPID':'0'},'Transport unit namespace occupied; preserve evidence and reconcile'; os.execv(sys.argv[2],sys.argv[2:])"
    local = ['/usr/bin/python3', '-I', '-B', '-c', bootstrap, unit, *argv]
    command = local if args.ui_host else ['ssh', '-i', '/home/sixer/.ssh/proofofwork_me_ed25519', '-o', 'BatchMode=yes',
        '-o', 'IdentitiesOnly=yes', '-o', 'StrictHostKeyChecking=yes', '-o', 'ConnectTimeout=10',
        'root@77.42.91.106', shlex.join(local)]
    assert args.log.resolve() == args.log and str(args.log).startswith('/tmp/')
    dispatch_admission(p, guard, args.ui_host)
    context = phase_source(args.phase, args.bundle_host, args.ui_host, p, kind)
    with context as source, args.log.open('xb') as log:
        subprocess.run(command, stdin=source, stdout=log, stderr=subprocess.STDOUT, timeout=TRANSPORT_REMOTE_TIMEOUT_SECONDS, check=True)


if __name__ == '__main__':
    main()
