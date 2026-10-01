#!/usr/bin/python3 -I
"""Install only reviewed Audit29 operational files, preserving rollback bytes."""
import argparse
from contextlib import contextmanager, nullcontext
import datetime
import fcntl
import hashlib
import json
import os
from pathlib import Path
import re
import stat
import subprocess
import sys

COMMON = {
    'deploy/proofofwork-storage-trend.py': '/usr/local/sbin/proofofwork-storage-trend',
    'scripts/check-retention-protection.py': '/usr/local/sbin/proofofwork-retention-protection',
    'deploy/proofofwork-deploy-tmpfiles.conf': '/etc/tmpfiles.d/proofofwork-deploy.conf',
    'audits/2026-09-29-audit28-held-review.json': '/etc/proofofwork-retention/audit28-held-review.json',
}
ROLE = {
    'ui': {
        'deploy/proofofwork-ui-capacity.py': '/usr/local/sbin/proofofwork-ui-capacity',
        'deploy/proofofwork-ui-release-stage.py': '/usr/local/sbin/proofofwork-ui-release-stage',
        'audits/2026-10-01-audit29-approved-cleanup.json': '/etc/proofofwork-retention/audit29-approved-cleanup.json',
    },
    'node': {
        'deploy/proofofwork-postgres-logical-backup.sh': '/usr/local/sbin/proofofwork-postgres-logical-backup',
        'deploy/proofofwork-postgres-logical-backup.service': '/etc/systemd/system/proofofwork-postgres-logical-backup.service',
        'deploy/proofofwork-postgres-logical-backup-state.py': '/usr/local/sbin/proofofwork-postgres-logical-backup-state',
        'deploy/proofofwork-postgres-query-health.sh': '/usr/local/sbin/proofofwork-postgres-query-health',
    },
}
ENV = {'PATH': '/usr/sbin:/usr/bin:/sbin:/bin', 'LC_ALL': 'C', 'GIT_OPTIONAL_LOCKS': '0'}


def digest(raw):
    return hashlib.sha256(raw).hexdigest()


def read_safe(path, limit=2*1024**2):
    before = path.lstat()
    assert stat.S_ISREG(before.st_mode) and before.st_uid == 0 and before.st_gid == 0
    assert not before.st_mode & 0o7022 and path.resolve() == path and before.st_size <= limit
    fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW)
    with os.fdopen(fd, 'rb') as stream:
        opened = os.fstat(stream.fileno())
        raw = stream.read(limit+1)
    fields = lambda row: (row.st_dev,row.st_ino,row.st_mode,row.st_uid,row.st_gid,row.st_size,row.st_mtime_ns,row.st_ctime_ns)
    assert fields(before) == fields(opened) == fields(path.lstat()) and len(raw) == before.st_size
    return raw, before


def directory(path):
    row = path.lstat()
    assert stat.S_ISDIR(row.st_mode) and row.st_uid == row.st_gid == 0 and not row.st_mode & 0o7022
    assert path.resolve() == path


def run(args, timeout=15):
    result = subprocess.run(args, env=ENV, stdin=subprocess.DEVNULL,
                            capture_output=True, text=True, timeout=timeout)
    assert result.returncode == 0, 'Reviewed operation failed: '+args[0]
    return result.stdout.strip()


def states(names):
    return {name: dict(line.split('=',1) for line in run(['systemctl','show',name,'-p','LoadState','-p','ActiveState','-p','MainPID','-p','UnitFileState']).splitlines() if '=' in line) for name in names}


def exclusive(path, raw, mode=0o600):
    fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, mode)
    with os.fdopen(fd, 'wb') as stream:
        stream.write(raw); stream.flush(); os.fsync(stream.fileno())
    os.chmod(path, mode)
    directory_fd = os.open(path.parent, os.O_RDONLY | os.O_DIRECTORY)
    try: os.fsync(directory_fd)
    finally: os.close(directory_fd)


def replace(path, raw, mode, token):
    temporary = path.parent / ('.'+path.name+'.audit29-'+token)
    exclusive(temporary, raw, mode)
    os.replace(temporary, path)
    fd = os.open(path.parent, os.O_RDONLY | os.O_DIRECTORY)
    try: os.fsync(fd)
    finally: os.close(fd)


@contextmanager
def backup_install_window(receipt_root):
    timer = 'proofofwork-postgres-logical-backup.timer'
    before = states([timer])[timer]
    assert before['LoadState'] == 'loaded' and before['ActiveState'] in ('active','inactive')
    selected = before['ActiveState'] == 'active'
    token = datetime.datetime.now(datetime.timezone.utc).strftime('%Y%m%dT%H%M%S.%fZ')
    exclusive(receipt_root/('backup-window-'+token+'.intent.json'),
              json.dumps({'timer':timer,'before':before,'status':'prepared'}).encode()+b'\n')
    descriptor = None
    try:
        if selected: run(['systemctl','stop',timer])
        assert states([timer])[timer]['ActiveState'] == 'inactive'
        lock = Path('/data/proofofwork-postgres-backups/logical/.proofofwork-postgres-logical-backup.lock')
        info=lock.lstat()
        assert stat.S_ISREG(info.st_mode) and lock.resolve()==lock and not info.st_mode & 0o7022
        descriptor=os.open(lock,os.O_RDONLY|os.O_NOFOLLOW)
        fcntl.flock(descriptor,fcntl.LOCK_EX|fcntl.LOCK_NB)
        assert_backup_quiet()
        yield
    finally:
        if descriptor is not None: os.close(descriptor)
        if selected: run(['systemctl','start',timer])
        after=states([timer])[timer]
        exclusive(receipt_root/('backup-window-'+token+'.restored.json'),
                  json.dumps({'timer':timer,'before':before,'after':after,'restored':after==before}).encode()+b'\n')
        assert after==before, 'Backup timer state was not restored'


def assert_backup_quiet():
    unit='proofofwork-postgres-logical-backup.service'
    backup=states([unit])[unit]
    assert backup['ActiveState']=='inactive' and backup['MainPID']=='0', 'Backup must be quiet for tooling installation'
    for process in Path('/proc').iterdir():
        if process.name.isdecimal():
            try: assert (process/'comm').read_text().strip() not in ('pg_dump','pg_dumpall'), 'Dump writer remains'
            except FileNotFoundError: pass


def reconcile_install_failure(installed, before, new, token):
    for destination in reversed(installed):
        old=before[destination]; target=Path(destination)
        current,_=read_safe(target) if target.exists() or target.is_symlink() else (None,None)
        if current == old['bytes']: continue
        assert current == new[destination]['bytes'], 'Unknown installed state requires review'
        if old['bytes'] is not None:
            replace(target,old['bytes'],old['mode'],token+'-rollback')
        # A newly created metadata/helper remains evidence rather than being deleted.


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--role', choices=ROLE, required=True)
    parser.add_argument('--source', type=Path, required=True)
    parser.add_argument('--manifest', type=Path, required=True)
    parser.add_argument('--manifest-sha256', required=True)
    parser.add_argument('--receipt-root', type=Path, required=True)
    args=parser.parse_args()
    assert sys.flags.isolated and os.geteuid()==0 and re.fullmatch('[0-9a-f]{64}',args.manifest_sha256)
    directory(args.source); directory(args.receipt_root)
    raw,_=read_safe(args.manifest); assert digest(raw)==args.manifest_sha256
    manifest=json.loads(raw); mapping={**COMMON,**ROLE[args.role]}
    assert manifest['schema']=='proof-of-work-audit29-ops-install-v1' and manifest['role']==args.role
    assert set(manifest['files'])==set(mapping), 'Installation scope differs from reviewed allowlist'
    hold=Path('/etc/proofofwork-retention/audit28.hold'); read_safe(hold)
    prune=['proofofwork-ui-release-prune.timer','proofofwork-ui-storage-prune.timer'] if args.role=='ui' else ['proofofwork-node-release-prune.timer']
    protected=['bitcoind.service','electrs.service','postgresql@16-main.service','pg_receivewal@16-main.service'] if args.role=='node' else ['caddy.service']
    baseline=states(protected+prune)
    assert all(baseline[name]['LoadState']=='masked' and baseline[name]['ActiveState']=='inactive' for name in prune)
    lock=Path('/run/proofofwork-ui/deploy.lock') if args.role=='ui' else Path('/run/proofofwork-audit29-ops.lock')
    if args.role=='ui': read_safe(lock)
    descriptor=os.open(lock,os.O_RDONLY|os.O_NOFOLLOW) if args.role=='ui' else os.open(lock,os.O_RDWR|os.O_CREAT|os.O_NOFOLLOW,0o600)
    try:
        fcntl.flock(descriptor,fcntl.LOCK_EX|fcntl.LOCK_NB)
        window = backup_install_window(args.receipt_root) if args.role=='node' else nullcontext()
        with window:
            before={}; new={}
            for source,destination in mapping.items():
                blob,_=read_safe(args.source/source); assert digest(blob)==manifest['files'][source]
                target=Path(destination); directory(target.parent)
                exists=target.exists() or target.is_symlink()
                old,details=read_safe(target) if exists else (None,None)
                if destination.startswith('/etc/proofofwork-retention/') and old is not None:
                    assert old == blob, 'Immutable historical retention evidence differs'
                mode=0o755 if destination.startswith('/usr/local/sbin/') else 0o644
                before[destination]={'bytes':old,'mode':stat.S_IMODE(details.st_mode) if details else None}
                new[destination]={'bytes':blob,'mode':mode}
            receipt=args.receipt_root/('ops-'+args.role+'-'+datetime.datetime.now(datetime.timezone.utc).strftime('%Y%m%dT%H%M%SZ'))
            receipt.mkdir(mode=0o700); directory(receipt)
            prior=[]
            for i,(destination,row) in enumerate(before.items()):
                if row['bytes'] is not None:
                    backup=str(i)+'.previous'; exclusive(receipt/backup,row['bytes'])
                    prior.append({'destination':destination,'backup':backup,'sha256':digest(row['bytes']),'mode':row['mode']})
                else: prior.append({'destination':destination,'existed':False})
            exclusive(receipt/'intent.json',json.dumps({'manifestSha256':args.manifest_sha256,'baseline':baseline,'previous':prior,'status':'prepared'},indent=2).encode()+b'\n')
            installed=[]
            try:
                for destination,row in new.items():
                    if args.role=='node': assert_backup_quiet()
                    target=Path(destination)
                    current,_=read_safe(target) if target.exists() else (None,None)
                    assert current==before[destination]['bytes'], 'Destination changed after preflight'
                    installed.append(destination)  # Arm rollback before the atomic rename can succeed.
                    replace(target,row['bytes'],row['mode'],receipt.name)
                    assert read_safe(target)[0]==row['bytes']
                if args.role=='node': assert_backup_quiet()
                run(['systemctl','daemon-reload'])
                assert states(protected+prune)==baseline, 'Authority or held timer changed'
                exclusive(receipt/'completed.json',json.dumps({'status':'completed','role':args.role,'manifestSha256':args.manifest_sha256,'installed':[{ 'path':p,'sha256':digest(new[p]['bytes'])} for p in installed]},indent=2).encode()+b'\n')
            except Exception as error:
                exclusive(receipt/'failure.json',json.dumps({'status':'failed','errorClass':type(error).__name__,'installed':installed}).encode()+b'\n')
                # Do not discard partially installed forensic evidence or unknown new files.
                reconcile_install_failure(installed,before,new,receipt.name)
                run(['systemctl','daemon-reload']); raise
        print(json.dumps({'status':'completed','receipt':str(receipt),'role':args.role}))
    finally: os.close(descriptor)

if __name__=='__main__': main()
