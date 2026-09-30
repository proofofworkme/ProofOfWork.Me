#!/usr/bin/env python3
"""Verify or execute only the single Audit 28 reviewed UI transport retirement."""
import argparse
import datetime
import fcntl
import hashlib
from importlib.machinery import SourceFileLoader
import json
import os
from pathlib import Path
import shutil
import stat

RETENTION_HELPER_SHA256 = '0e3a5adce67f07fb6beb0b0d8001a002e247db316bc5911f3d6f5e622983e4d1'

CANDIDATE = Path('/var/tmp/proofofwork-deploy/proofofwork-ui-source-d2c0afaffd9c-20260929T161019Z')


def fingerprint(root):
    entries = []
    for base, dirs, files in os.walk(root, followlinks=False):
        for name in dirs + files:
            path = Path(base) / name
            info = path.lstat()
            row = {'path': path.relative_to(root).as_posix(), 'mode': stat.S_IMODE(info.st_mode),
                   'size': info.st_size, 'mtimeNs': info.st_mtime_ns, 'inode': info.st_ino, 'device': info.st_dev}
            if path.is_symlink():
                row['link'] = os.readlink(path)
            elif path.is_file():
                with path.open('rb') as stream:
                    row['sha256'] = hashlib.file_digest(stream, 'sha256').hexdigest()
            elif not path.is_dir():
                raise ValueError('Unsupported candidate entry')
            entries.append(row)
    entries.sort(key=lambda row: row['path'].encode())
    digest = hashlib.sha256(json.dumps(entries, sort_keys=True, separators=(',', ':')).encode()).hexdigest()
    info = root.lstat()
    return {'path': str(root), 'fingerprintModel': 'lstat-and-content-json-v1', 'sha256': digest,
            'entryCount': len(entries), 'inode': info.st_ino, 'device': info.st_dev, 'mtimeNs': info.st_mtime_ns,
            'fileBytes': sum(row['size'] for row in entries if 'sha256' in row)}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('manifest', type=Path)
    parser.add_argument('--apply', action='store_true')
    parser.add_argument('--approved-manifest-sha256')
    args = parser.parse_args()
    raw = args.manifest.read_bytes()
    digest = hashlib.sha256(raw).hexdigest()
    if args.apply and args.approved_manifest_sha256 != digest:
        raise ValueError('Apply requires the exact separately approved manifest hash')
    manifest = json.loads(raw)
    if manifest.get('format') != 'proof-of-work-audit28-cleanup-review-v1' or len(manifest.get('delete', [])) != 1:
        raise ValueError('Unsupported manifest scope')
    row = manifest['delete'][0]
    if row.get('host') != '77.42.91.106' or row.get('path') != str(CANDIDATE):
        raise ValueError('Refusing expanded deletion scope')
    if os.geteuid() != 0:
        raise ValueError('Production verification requires root')
    # Import helpers only. Never invoke their broad retention main/apply path.
    helper = Path('/usr/local/sbin/proofofwork-ui-verified-retention')
    info = helper.lstat()
    if helper.is_symlink() or not stat.S_ISREG(info.st_mode) or info.st_uid != 0 or info.st_mode & 0o7022:
        raise ValueError('Unsafe retention helper')
    if hashlib.sha256(helper.read_bytes()).hexdigest() != RETENTION_HELPER_SHA256:
        raise ValueError('Installed retention helper drifted')
    retention = SourceFileLoader('audit28_retention', str(helper)).load_module()
    lock_path = Path('/run/proofofwork-ui/deploy.lock')
    retention.safe_path(lock_path, directory=False)
    with lock_path.open('r') as lock:
        fcntl.flock(lock.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
        retention.safe_path(CANDIDATE)
        current, previous, _ = retention.rollback_plan(Path('/var/www'),
            Path('/var/backups/proofofwork-ui/rollback-roots'), Path('/var/backups/proofofwork-ui/releases'))
        if current != manifest['preserve']['uiCurrent'] or previous != manifest['preserve']['uiPrevious']:
            raise ValueError('Designated rollback pair drifted')
        retention.referenced_paths([{'path': str(CANDIDATE)}])
        if fingerprint(CANDIDATE) != row['fingerprint']:
            raise ValueError('Candidate identity or contents drifted')
        result = {'time': datetime.datetime.now(datetime.timezone.utc).isoformat(),
                  'manifestSha256': digest, 'mode': 'apply' if args.apply else 'verify',
                  'path': str(CANDIDATE), 'fingerprint': row['fingerprint'], 'preserved': manifest['preserve']}
        if args.apply:
            if not shutil.rmtree.avoids_symlink_attacks:
                raise ValueError('Descriptor-based recursive removal unavailable')
            evidence = Path('/var/backups/proofofwork-ui/cleanup-evidence')
            retention.safe_path(evidence)
            receipt = evidence / ('audit28-followup-' + datetime.datetime.now(datetime.timezone.utc).strftime('%Y%m%dT%H%M%S.%fZ') + '.json')
            with receipt.open('x') as output:
                os.chmod(receipt, 0o600)
                json.dump(result, output, indent=2)
                output.flush()
                os.fsync(output.fileno())
            fd = os.open(evidence, os.O_DIRECTORY)
            try:
                os.fsync(fd)
            finally:
                os.close(fd)
            # Recheck references and exact contents after durable evidence publication.
            retention.referenced_paths([{'path': str(CANDIDATE)}])
            if fingerprint(CANDIDATE) != row['fingerprint']:
                raise ValueError('Candidate drifted before removal')
            shutil.rmtree(CANDIDATE)
            fd = os.open(CANDIDATE.parent, os.O_DIRECTORY)
            try:
                os.fsync(fd)
            finally:
                os.close(fd)
        print(json.dumps(result))


if __name__ == '__main__':
    main()
