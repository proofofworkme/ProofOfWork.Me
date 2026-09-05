#!/usr/bin/env python3
"""Audit-5 transport duplicates only; default is a fully verified dry run."""

import argparse
import fcntl
import hashlib
import json
import os
from pathlib import Path, PurePosixPath
import stat
import tarfile
import time


ROOT = Path('/var/tmp/proofofwork-deploy')
LOCK = Path('/run/proofofwork-ui/deploy.lock')
LIVE = Path('/var/www/.proofofwork-ui-release')
ROLLBACK = Path('/var/backups/proofofwork-ui/rollback-roots')
EXPECTED_COMMIT = '6a7d5c12e403e0ddb6247fa2a6865cb70d623a8e'
APPROVED = (
    ('proofofwork-ui-surfaces-d13e9cad67e9-20260901T230747Z', 175832501,
     '6a2dcac74f5c745d91529b949dfc1187db65f4a579e8dbcb53c9d9d1a80206f8', 360, 194821294),
    ('proofofwork-ui-surfaces-c2396ce9c3ea-20260902T005518Z', 175830884,
     '6380420c7494aecb72cbb0e3c5adba516a5a054d14952cbb47b97b3c56983d51', 360, 194828089),
    ('proofofwork-ui-source-c2396ce9c3ea-20260902T005518Z', 81677086,
     'b201c5d3c45a11b891b7cb96190e1a7513393886a29ecf928ab090d9c600f1db', 5864, 210624199),
)


def identity(details):
    return (details.st_dev, details.st_ino, details.st_size,
            details.st_mtime_ns, details.st_ctime_ns)


def safe_directory(path):
    details = path.lstat()
    if not stat.S_ISDIR(details.st_mode) or path.resolve(strict=True) != path:
        raise ValueError(f'Noncanonical directory: {path}')
    if details.st_uid != os.geteuid() or stat.S_IMODE(details.st_mode) & 0o7022:
        raise ValueError(f'Unsafe directory owner/mode: {path}')
    return details


def regular_bytes(path, maximum=65536):
    fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW)
    with os.fdopen(fd, 'rb') as source:
        details = os.fstat(source.fileno())
        if not stat.S_ISREG(details.st_mode) or details.st_uid != os.geteuid() or \
                stat.S_IMODE(details.st_mode) & 0o7022 or details.st_size > maximum:
            raise ValueError(f'Unsafe evidence file: {path}')
        return source.read(maximum + 1)


def digest_stream(source, deadline):
    digest = hashlib.sha256()
    while True:
        if time.monotonic() > deadline:
            raise TimeoutError('Approved duplicate validation exceeded five minutes')
        data = source.read(1024 * 1024)
        if not data:
            return digest.hexdigest()
        digest.update(data)


def reject_mounts(root):
    for line in Path('/proc/self/mountinfo').read_text().splitlines():
        fields = line.split()
        if len(fields) < 5:
            raise ValueError('Malformed mount information')
        mount = Path(fields[4].replace('\\040', ' ').replace('\\011', '\t')
                     .replace('\\012', '\n').replace('\\134', '\\'))
        if mount == root or root in mount.parents:
            raise ValueError(f'Archive/duplicate namespace contains a mount: {mount}')


def retained_entry(root, parts):
    """Open every ancestor without following links, including during races."""
    parent = os.open(root, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
    try:
        for part in parts[:-1]:
            child = os.open(part, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW,
                            dir_fd=parent)
            os.close(parent)
            parent = child
        return parent, parts[-1]
    except BaseException:
        os.close(parent)
        raise


def validate_archive(root, approved, deadline):
    stem, size, expected_hash, expected_count, expected_bytes = approved
    archive = root / (stem + '.tgz')
    kept = root / stem
    safe_directory(kept)
    details = archive.lstat()
    if not stat.S_ISREG(details.st_mode) or details.st_uid != os.geteuid() or \
            stat.S_IMODE(details.st_mode) & 0o7022 or details.st_size != size or \
            details.st_nlink != 1:
        raise ValueError(f'Approved archive identity/size is invalid: {archive}')
    checksum = regular_bytes(Path(str(archive) + '.sha256')).decode('ascii').splitlines()
    if checksum not in ([expected_hash + '  ' + archive.name],
                        [expected_hash + '  ' + str(archive)]):
        raise ValueError(f'Approved checksum sidecar differs: {archive}')
    fd = os.open(archive, os.O_RDONLY | os.O_NOFOLLOW)
    with os.fdopen(fd, 'rb') as source:
        if identity(os.fstat(source.fileno())) != identity(details):
            raise ValueError('Archive changed while opening')
        if digest_stream(source, deadline) != expected_hash:
            raise ValueError(f'Approved archive digest differs: {archive}')
        source.seek(0)
        count = total = 0
        seen = set()
        with tarfile.open(fileobj=source, mode='r|gz') as contents:
            for member in contents:
                parts = PurePosixPath(member.name).parts
                if not parts or parts[0] != stem or '..' in parts or \
                        member.name.startswith('/') or member.name in seen:
                    raise ValueError('Archive contains an unexpected or duplicate path')
                seen.add(member.name)
                if len(seen) > 20000:
                    raise ValueError('Archive member cap exceeded')
                parent, name = retained_entry(root, parts)
                try:
                    current = os.stat(name, dir_fd=parent, follow_symlinks=False)
                    if member.isdir():
                        if not stat.S_ISDIR(current.st_mode):
                            raise ValueError('Retained directory type differs')
                    elif member.issym():
                        if not stat.S_ISLNK(current.st_mode) or \
                                os.readlink(name, dir_fd=parent) != member.linkname:
                            raise ValueError('Retained link differs')
                    elif member.isfile():
                        if not stat.S_ISREG(current.st_mode) or current.st_size != member.size:
                            raise ValueError('Retained regular-file type/size differs')
                        kept_fd = os.open(name, os.O_RDONLY | os.O_NOFOLLOW, dir_fd=parent)
                        with os.fdopen(kept_fd, 'rb') as retained, contents.extractfile(member) as original:
                            if identity(os.fstat(retained.fileno())) != identity(current) or \
                                    digest_stream(retained, deadline) != digest_stream(original, deadline) or \
                                    identity(os.fstat(retained.fileno())) != identity(current):
                                raise ValueError('Retained regular-file bytes/identity differ')
                        count += 1
                        total += member.size
                    else:
                        raise ValueError('Unsupported archive member type')
                    if not member.issym() and stat.S_IMODE(current.st_mode) != member.mode:
                        raise ValueError('Retained member mode differs')
                finally:
                    os.close(parent)
        if identity(os.fstat(source.fileno())) != identity(details):
            raise ValueError('Archive changed during validation')
    if count != expected_count or total != expected_bytes:
        raise ValueError('Retained payload count/byte total differs from approved evidence')
    return {'archive': str(archive), 'preservedDuplicate': str(kept), 'bytes': size,
            'sha256': expected_hash, 'comparedRegularFiles': count,
            'comparedBytes': total, 'identity': identity(details)}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--apply', action='store_true')
    options = parser.parse_args()
    safe_directory(ROOT)
    safe_directory(LOCK.parent)
    safe_directory(ROLLBACK)
    reject_mounts(ROOT)
    lock_fd = os.open(LOCK, os.O_RDWR | os.O_NOFOLLOW)
    try:
        lock_stat = os.fstat(lock_fd)
        if not stat.S_ISREG(lock_stat.st_mode) or lock_stat.st_uid != os.geteuid() or \
                stat.S_IMODE(lock_stat.st_mode) & 0o7022:
            raise ValueError('Unsafe existing deployment lock')
        fcntl.flock(lock_fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
        live = regular_bytes(LIVE).decode('utf-8')
        if f'commit={EXPECTED_COMMIT}\n' not in live:
            raise ValueError('Live release changed; review the exact cleanup scope again')
        manifests = [live]
        for path in sorted(ROLLBACK.iterdir()):
            safe_directory(path)
            manifests.append(regular_bytes(path / '.proofofwork-ui-release').decode('utf-8'))
        for stem, _, digest, _, _ in APPROVED:
            if any(stem in manifest or digest in manifest for manifest in manifests):
                raise ValueError('Approved transport copy is referenced by current/rollback evidence')
        deadline = time.monotonic() + 300
        plan = [validate_archive(ROOT, candidate, deadline) for candidate in APPROVED]
        print(json.dumps({'phase': 'validated', 'mode': 'apply' if options.apply else 'dry-run',
                          'archives': plan, 'totalBytes': sum(row['bytes'] for row in plan),
                          'preserve': 'Every extracted duplicate, checksum, provenance, backup, release root and other file'}), flush=True)
        if options.apply:
            root_fd = os.open(ROOT, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
            try:
                for row in plan:
                    name = Path(row['archive']).name
                    current = os.stat(name, dir_fd=root_fd, follow_symlinks=False)
                    if identity(current) != tuple(row['identity']):
                        raise ValueError('Archive identity changed before approved unlink')
                    os.unlink(name, dir_fd=root_fd)
                    os.fsync(root_fd)
                    print(json.dumps({'phase': 'removed-approved-archive', **row}), flush=True)
            finally:
                os.close(root_fd)
        print(json.dumps({'phase': 'complete', 'removedArchives': len(plan) if options.apply else 0,
                          'availableBytesAfter': os.statvfs(ROOT).f_bavail * os.statvfs(ROOT).f_frsize}), flush=True)
    finally:
        os.close(lock_fd)


if __name__ == '__main__':
    main()
