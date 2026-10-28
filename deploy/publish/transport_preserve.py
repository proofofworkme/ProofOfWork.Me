"""Dispatch one committed, hash-bound UI release phase; no work runs on import."""
import argparse
import ast
import hashlib
import json
from pathlib import Path
import shlex
import subprocess
import os
import contextlib

ROOT = Path(__file__).resolve().parent
TRANSPORT_RUNTIME_SECONDS = 6000
TRANSPORT_REMOTE_TIMEOUT_SECONDS = 6300


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
    script = r'''
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
    command = ['ssh', '-i', '/home/sixer/.ssh/proofofwork_node_ed25519', '-o', 'BatchMode=yes',
               '-o', 'IdentitiesOnly=yes', '-o', 'StrictHostKeyChecking=yes', '-o', 'ConnectTimeout=10',
               'powadmin@65.108.122.87', shlex.join(['sudo', '-n', '/usr/bin/python3', '-I', '-B',
               '-c', script, str(bundle), str(plan[kind]['compressedBytes']), plan[kind]['sha256']])]
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


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('plan', type=Path)
    parser.add_argument('phase', choices=('surfaces-stage', 'surfaces-stage-resume', 'preserved-stage-resume', 'preserved-capacity-resume', 'source'))
    parser.add_argument('log', type=Path)
    parser.add_argument('--bundle-host', choices=('local', 'node-vps'), default='local')
    args = parser.parse_args()
    os.umask(0o077)
    raw = args.plan.read_bytes(); assert len(raw) <= 65536
    p = json.loads(raw); sha = hashlib.sha256(raw).hexdigest()
    script = (ROOT / 'remote_transport.py').read_bytes(); ast.parse(script)
    assert hashlib.sha256(script).hexdigest() == p['preservingTransportSha256']
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
    ssh = ['ssh', '-i', '/home/sixer/.ssh/proofofwork_me_ed25519', '-o', 'BatchMode=yes',
        '-o', 'IdentitiesOnly=yes', '-o', 'StrictHostKeyChecking=yes', '-o', 'ConnectTimeout=10',
        'root@77.42.91.106', shlex.join(['/usr/bin/python3', '-I', '-B', '-c', bootstrap, unit, *argv])]
    assert args.log.resolve() == args.log and str(args.log).startswith('/tmp/')
    context = contextlib.nullcontext(subprocess.DEVNULL) if args.phase in ('surfaces-stage-resume', 'preserved-stage-resume', 'preserved-capacity-resume') else bundle_source(p, kind, args.bundle_host)
    with context as source, args.log.open('xb') as log:
        subprocess.run(ssh, stdin=source, stdout=log, stderr=subprocess.STDOUT, timeout=TRANSPORT_REMOTE_TIMEOUT_SECONDS, check=True)


if __name__ == '__main__':
    main()
