#!/usr/bin/python3 -I
"""Receive a pinned audit-5 source/payload stream into a new private root."""
import sys
if __name__ == '__main__' and not sys.flags.isolated:
    raise SystemExit('Run the receiver with python3 -I to isolate root imports')

import ctypes
import fcntl
import hashlib
import json
import os
from pathlib import Path, PurePosixPath
import re
import stat
import tarfile

FLOOR = 10 * 1024**3 + 64 * 1024**2
LIMIT = 512 * 1024**2
RELEASE = re.compile(r'[0-9a-f]{12}-[0-9]{8}T[0-9]{6}Z\Z')


def require(condition, message):
    if not condition:
        raise RuntimeError(message)


def safe_directory(path, owner):
    details = path.lstat()
    require(stat.S_ISDIR(details.st_mode) and path.resolve() == path and
            details.st_uid == owner and not details.st_mode & 0o7022,
            'Unsafe stream parent')


class LimitedStream:
    def __init__(self, source, length):
        self.source = source
        self.remaining = length
        self.digest = hashlib.sha256()

    def read(self, size=-1):
        if not self.remaining:
            return b''
        size = min(self.remaining, 1024 * 1024 if size < 0 else size)
        data = self.source.read(size)
        require(bool(data), 'Archive stream truncated')
        self.remaining -= len(data)
        self.digest.update(data)
        return data


def sync_tree(root):
    for directory, _dirs, files in os.walk(root, followlinks=False, topdown=False):
        for name in files:
            path = Path(directory, name)
            if path.is_symlink():
                continue
            descriptor = os.open(path, os.O_RDONLY | os.O_NOFOLLOW)
            try:
                require(stat.S_ISREG(os.fstat(descriptor).st_mode), 'Unsafe extracted file')
                os.fsync(descriptor)
            finally:
                os.close(descriptor)
        descriptor = os.open(directory, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
        try:
            os.fsync(descriptor)
        finally:
            os.close(descriptor)


def receive(mode, release, length, expected, source, parent, lock_path, *, owner=0, floor=FLOOR):
    require(mode in ('source', 'surfaces') and RELEASE.fullmatch(release), 'Invalid stream identity')
    require(re.fullmatch(r'[0-9a-f]{64}', expected) and 0 < length <= LIMIT, 'Invalid stream bounds')
    safe_directory(parent, owner)
    safe_directory(lock_path.parent, owner)
    require(lock_path.resolve() == lock_path, 'Unsafe deploy lock path')
    descriptor = os.open(lock_path, os.O_RDONLY | os.O_NOFOLLOW)
    try:
        details = os.fstat(descriptor)
        require(stat.S_ISREG(details.st_mode) and details.st_uid == owner and
                details.st_nlink == 1 and not details.st_mode & 0o7022, 'Unsafe deploy lock')
        fcntl.flock(descriptor, fcntl.LOCK_EX | fcntl.LOCK_NB)
        top = f'proofofwork-ui-{mode}-{release}'
        root = parent / top
        require(not os.path.lexists(root), 'Release stream root already exists')
        scratch = parent / f'.audit5-stream-{mode}-{release}'
        scratch.mkdir(mode=0o700)  # Retained on failure; never reuse old scratch.
        stream = LimitedStream(source, length)
        seen, total, count = set(), 0, 0
        with tarfile.open(fileobj=stream, mode='r|gz') as archive:
            for member in archive:
                name = member.name.rstrip('/')
                path = PurePosixPath(name)
                require(bool(name) and name == path.as_posix() and path.parts[0] == top and
                        not path.is_absolute() and '..' not in path.parts and '\\' not in name and
                        all(ord(c) >= 32 and ord(c) != 127 for c in name), 'Unsafe archive path')
                require(name not in seen, 'Duplicate archive path')
                seen.add(name)
                require(not member.issparse() and member.size >= 0, 'Sparse/invalid archive entry')
                require(member.isdir() or member.isfile() or (mode == 'source' and member.issym()),
                        'Unsupported archive entry')
                # POSIX symlink permissions are normally0777; only source links are allowed.
                require(member.issym() or not member.mode & 0o7022, 'Unsafe archive mode')
                if member.issym():
                    require(not os.path.isabs(member.linkname) and '\\' not in member.linkname and
                            ((scratch / name).parent / member.linkname).resolve().is_relative_to(scratch / top),
                            'Source link leaves checkout')
                count += 1
                total += member.size
                require(count <= 30000 and total <= LIMIT and member.size <= 96 * 1024**2,
                        'Archive expansion bound exceeded')
                disk = os.statvfs(parent)
                required = ((member.size + disk.f_frsize - 1) // disk.f_frsize + 2) * disk.f_frsize
                require(disk.f_bavail * disk.f_frsize >= floor + required, 'UI free-space reserve')

                def safe_filter(item, destination):
                    filtered = tarfile.data_filter(item, destination)
                    require(filtered is not None, 'Archive filter refused entry')
                    return filtered.replace(mode=member.mode, uid=owner, gid=os.getegid(),
                                            uname=None, gname=None, deep=False)

                archive.extract(member, path=scratch, filter=safe_filter)
        while stream.remaining:
            stream.read(1024 * 1024)
        require(stream.digest.hexdigest() == expected, 'Transport digest mismatch')
        require(source.read(1) == b'', 'Extra transport bytes')
        require(sorted(p.name for p in scratch.iterdir()) == [top] and
                (scratch / top).is_dir() and not (scratch / top).is_symlink(), 'Invalid extracted root')
        sync_tree(scratch / top)
        # Never replace an existing root, including an entry created after preflight.
        libc = ctypes.CDLL(None, use_errno=True)
        result = libc.renameat2(-100, os.fsencode(scratch / top), -100, os.fsencode(root), 1)
        if result:
            raise OSError(ctypes.get_errno(), 'Non-replacing stream publication failed')
        scratch.rmdir()
        parent_fd = os.open(parent, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
        try:
            os.fsync(parent_fd)
            receipt = {'status': 'verified', 'kind': mode, 'releaseId': release,
                       'archiveSha256': expected, 'compressedBytes': length, 'entries': count,
                       'logicalBytes': total, 'extractedRoot': str(root)}
            receipt_path = parent / f'audit5-stream-{mode}-{release}.json'
            with open(receipt_path, 'x') as output:
                json.dump(receipt, output, indent=2)
                output.write('\n')
                output.flush()
                os.fsync(output.fileno())
            os.fsync(parent_fd)
        finally:
            os.close(parent_fd)
        return receipt
    finally:
        os.close(descriptor)


def main():
    require(os.geteuid() == 0 and os.getegid() == 0, 'Run receiver as root')
    require(len(sys.argv) == 5, 'Usage: stream-ui-bundle.py source|surfaces RELEASE LENGTH SHA256')
    mode, release, length, expected = sys.argv[1:]
    print(json.dumps(receive(mode, release, int(length), expected, sys.stdin.buffer,
                             Path('/var/tmp/proofofwork-deploy'),
                             Path('/run/proofofwork-ui/deploy.lock'))))


if __name__ == '__main__':
    main()
