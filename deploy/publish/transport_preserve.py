"""Dispatch one committed, hash-bound UI release phase; no work runs on import."""
import argparse
import ast
import hashlib
import json
from pathlib import Path
import shlex
import subprocess
import os

ROOT = Path(__file__).resolve().parent


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('plan', type=Path)
    parser.add_argument('phase', choices=('surfaces-stage', 'source'))
    parser.add_argument('log', type=Path)
    args = parser.parse_args()
    os.umask(0o077)
    raw = args.plan.read_bytes(); assert len(raw) <= 65536
    p = json.loads(raw); sha = hashlib.sha256(raw).hexdigest()
    script = (ROOT / 'remote_transport.py').read_bytes(); ast.parse(script)
    assert hashlib.sha256(script).hexdigest() == p['preservingTransportSha256']
    kind = 'surfaces' if args.phase == 'surfaces-stage' else 'source'
    bundle = Path(p['localBundles'][kind])
    assert bundle.resolve() == bundle and bundle.is_file() and not bundle.is_symlink()
    assert bundle.stat().st_size == p[kind]['compressedBytes']
    with bundle.open('rb') as source:
        assert hashlib.file_digest(source, 'sha256').hexdigest() == p[kind]['sha256']
    remote_plan = '/var/tmp/proofofwork-deploy/recovery-plan-' + p['releaseId'] + '-' + p['publicationAttempt'] + '.json'
    argv = ['systemd-run', '--unit=proofofwork-recovery-ui-transport-' + p['releaseId'] + '-' + args.phase,
        '--service-type=exec', '--wait', '--pipe', '--property=User=root', '--property=Group=root',
        '--property=KillMode=control-group', '--property=RuntimeMaxSec=20min', '--property=TimeoutStopSec=30s',
        '--property=MemoryMax=4G', '--property=MemorySwapMax=0', '--property=TasksMax=128', '--property=UMask=0077',
        '/usr/bin/python3', '-I', '-B', '-c', script.decode(), remote_plan, sha, args.phase]
    ssh = ['ssh', '-i', '/home/sixer/.ssh/proofofwork_me_ed25519', '-o', 'BatchMode=yes',
        '-o', 'IdentitiesOnly=yes', '-o', 'StrictHostKeyChecking=yes', '-o', 'ConnectTimeout=10',
        'root@77.42.91.106', shlex.join(argv)]
    assert args.log.resolve() == args.log and str(args.log).startswith('/tmp/')
    with bundle.open('rb') as source, args.log.open('xb') as log:
        subprocess.run(ssh, stdin=source, stdout=log, stderr=subprocess.STDOUT, timeout=1230, check=True)


if __name__ == '__main__':
    main()
