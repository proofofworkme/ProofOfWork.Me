#!/usr/bin/env python3
"""Apply the approved tip delta over a hash-bound active runtime, preserving audit work.

Run as root with an exact JSON manifest on stdin. Source and dependency hashes,
service cwd and the existing operations lock fence every write. Retain immutable
before/candidate files and a fsynced receipt. Failure restores prior existing
sources; a new unused helper remains preserved as evidence after rollback.
"""
import base64, datetime, fcntl, hashlib, json, os, pathlib, shutil, stat, subprocess, sys
ROOT = pathlib.Path('/opt/proofofwork-api')
ALLOWED = {'server/proof-api.mjs', 'server/db/proof-index-reader.mjs',
    'scripts/backfill-proof-indexer.mjs', 'server/boost-projection.mjs',
    'server/boost-growth.mjs', 'src/shared/protocol/boostTip.mjs'}
UNITS = ['proofofwork-api.service', 'proofofwork-indexer-worker.service']
sha = lambda value: hashlib.sha256(value).hexdigest()
def main():
    assert os.geteuid() == 0 and len(sys.argv) == 1
    os.umask(0o077)
    raw = sys.stdin.buffer.read(20 * 1024**2 + 1); assert len(raw) <= 20 * 1024**2
    manifest = json.loads(raw)
    assert manifest['format'] == 'proof-of-work-tipping-scoped-runtime-v1'
    assert manifest['services'] == UNITS
    sources = manifest['sources']
    assert {row['path'] for row in sources} == ALLOWED and len(sources) == len(ALLOWED)
    assert ROOT.resolve() == ROOT and shutil.disk_usage(ROOT).free > 1024**3
    lock = pathlib.Path('/run/proofofwork-audit29-ops.lock'); details = lock.lstat()
    assert lock.resolve() == lock and stat.S_ISREG(details.st_mode)
    assert (details.st_uid, details.st_gid, details.st_mode & 0o777, details.st_nlink) == (0, 0, 0o600, 1)
    fd = os.open(lock, os.O_RDONLY | os.O_NOFOLLOW); fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
    assert os.fstat(fd).st_ino == lock.stat().st_ino
    def fence():
        for path, digest in manifest['dependencies'].items():
            assert path.startswith(('server/', 'scripts/', 'src/shared/protocol/')) and path.endswith('.mjs') and '..' not in pathlib.PurePosixPath(path).parts
            file = ROOT/path; assert file.resolve() == file and sha(file.read_bytes()) == digest, path
        for row in sources:
            file = ROOT/row['path']; assert file.resolve() == file
            assert (sha(file.read_bytes()) if file.exists() else None) == row['before'], row['path']
    fence()
    node = os.readlink('/proc/' + subprocess.check_output(['systemctl', 'show', UNITS[0], '-p', 'MainPID', '--value'], text=True).strip() + '/exe')
    assert pathlib.Path(node).is_file()
    for unit in UNITS:
        assert subprocess.check_output(['systemctl', 'is-active', unit], text=True).strip() == 'active'
        assert subprocess.check_output(['systemctl', 'show', unit, '-p', 'WorkingDirectory', '--value'], text=True).strip() == str(ROOT)
    keep = ['bitcoind.service', 'electrs.service', 'postgresql@16-main.service']
    keep_pids = {unit: subprocess.check_output(['systemctl','show',unit,'-p','MainPID','--value'],text=True).strip() for unit in keep}
    stamp = datetime.datetime.now(datetime.timezone.utc).strftime('%Y%m%dT%H%M%SZ')
    backup = pathlib.Path('/data/proofofwork-release-backups')/('content-tips-'+stamp); backup.mkdir(mode=0o700)
    receipt = {'format': manifest['format'], 'startedAt': stamp, 'sourceCommit': manifest['sourceCommit'],
        'approval': 'Go for it, ship the full scope', 'baselineHead': manifest['baselineHead'],
        'manifestSha256': sha(raw), 'rollbackRoot': str(backup), 'dependencyCount': len(manifest['dependencies']),
        'installed': False, 'rolledBack': False, 'authorityPids': keep_pids,
        'sources': [{k:v for k,v in row.items() if k != 'base64'} for row in sources]}
    def durable(file, value, mode=0o600):
        descriptor = os.open(file, os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW, mode)
        with os.fdopen(descriptor, 'wb') as output: output.write(value); output.flush(); os.fsync(output.fileno())
    def save():
        temp = backup/'receipt.tmp'
        durable(temp, (json.dumps(receipt, indent=2)+'\n').encode()); os.replace(temp, backup/'receipt.json')
        descriptor = os.open(backup, os.O_RDONLY|os.O_DIRECTORY); os.fsync(descriptor); os.close(descriptor)
    metadata = {}
    for index, row in enumerate(sources):
        file = ROOT/row['path']; assert file.parent.resolve() == file.parent
        before = file.read_bytes() if file.exists() else None
        details = file.stat() if file.exists() else (ROOT/'src/shared/protocol/publishArticle.mjs').stat()
        metadata[row['path']] = (details.st_uid, details.st_gid, stat.S_IMODE(details.st_mode))
        if before is not None: durable(backup/f'before-{index}.mjs', before)
        value = base64.b64decode(row['base64'], validate=True); assert sha(value) == row['after'] and len(value) <= 10*1024**2
        durable(backup/f'candidate-{index}.mjs', value)
        subprocess.run([node, '--check', str(backup/f'candidate-{index}.mjs')], capture_output=True, check=True, timeout=30)
    durable(backup/'manifest.json', raw); save(); fence()
    def install(candidate):
        for index, row in enumerate(sources):
            if not candidate and row['before'] is None: continue
            file = ROOT/row['path']; temporary = file.with_name(file.name+'.tip-'+stamp)
            durable(temporary, (backup/f'{"candidate" if candidate else "before"}-{index}.mjs').read_bytes())
            uid,gid,mode = metadata[row['path']]; os.chown(temporary,uid,gid); os.chmod(temporary,mode)
            os.replace(temporary,file); descriptor=os.open(file.parent,os.O_RDONLY|os.O_DIRECTORY); os.fsync(descriptor); os.close(descriptor)
    try:
        receipt['stopRequested'] = True; save()
        subprocess.run(['systemctl','stop',*UNITS],check=True,timeout=120)
        assert all(subprocess.check_output(['systemctl','show',unit,'-p','MainPID','--value'],text=True).strip()=='0' for unit in UNITS)
        fence(); install(True); receipt['installed']=True; save()
        assert all(sha((ROOT/row['path']).read_bytes())==row['after'] for row in sources)
        assert all(sha((ROOT/path).read_bytes())==digest for path,digest in manifest['dependencies'].items() if path not in ALLOWED)
        subprocess.run(['systemctl','start',*UNITS],check=True,timeout=60)
        assert all(subprocess.check_output(['systemctl','is-active',unit],text=True).strip()=='active' for unit in UNITS)
        assert keep_pids == {unit:subprocess.check_output(['systemctl','show',unit,'-p','MainPID','--value'],text=True).strip() for unit in keep}
        receipt['completedAt']=datetime.datetime.now(datetime.timezone.utc).isoformat(); save(); print(json.dumps(receipt),flush=True)
    except BaseException as error:
        receipt['errorClass']=type(error).__name__
        subprocess.run(['systemctl','stop',*UNITS],check=True,timeout=120); install(False)
        subprocess.run(['systemctl','start',*UNITS],check=True,timeout=60)
        receipt['rolledBack']=True; receipt['newHelperRetained']=True; save(); print(json.dumps(receipt),flush=True); raise
if __name__ == '__main__': main()
