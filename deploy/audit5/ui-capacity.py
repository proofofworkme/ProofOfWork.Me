#!/usr/bin/python3
"""Conservative audit-5 candidate/archive budgets; no filesystem mutations."""
import hashlib
import json
import os
from pathlib import Path
import stat
import sys

SURFACES = 'activity boost browser computer desktop growth id inception infinity landing marketplace nft token wallet work'.split()


def rounded(size, block):
    return ((size + block - 1) // block) * block


def tree_budget(root, *, owner=0, managed=False):
    root = Path(root)
    base = root.lstat()
    if not stat.S_ISDIR(base.st_mode) or root.resolve() != root:
        raise ValueError('Capacity root is not canonical')
    names = [('proofofwork-' if managed else '') + name for name in SURFACES]
    if not managed and sorted(p.name for p in root.iterdir()) != sorted(names):
        raise ValueError('Incoming surface set differs from the complete managed set')
    block = os.statvfs(root).f_frsize
    unique, largest, metadata, logical, entries, tar_bytes = {}, 0, 0, 0, 1, 2048
    for name in names:
        surface = root / name
        surface_bytes = 0
        pending = [surface]
        while pending:
            path = pending.pop()
            details = path.lstat()
            if details.st_dev != base.st_dev or details.st_uid != owner or details.st_mode & 0o7022:
                raise ValueError('Unsafe incoming ownership, mode or filesystem')
            if not stat.S_ISDIR(details.st_mode) and not stat.S_ISREG(details.st_mode):
                raise ValueError('Managed surfaces contain a link or special file')
            entries += 1
            metadata += max(block, details.st_blocks * 512 if stat.S_ISDIR(details.st_mode) else block)
            surface_bytes += block
            # Two headers plus full path padding cover GNU long-name records too.
            tar_bytes += 1024 + rounded(len(os.fsencode(path.relative_to(root))) + 1, 512)
            if stat.S_ISDIR(details.st_mode):
                pending.extend(path.iterdir())
                continue
            if not managed and details.st_nlink != 1:
                raise ValueError('Incoming files must be independent regular copies')
            descriptor = os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
            try:
                opened = os.fstat(descriptor)
                if opened != details:
                    raise ValueError('Incoming file changed before hashing')
                digest = hashlib.sha256()
                while chunk := os.read(descriptor, 1024 * 1024):
                    digest.update(chunk)
                attrs = tuple((key, os.getxattr(descriptor, key)) for key in sorted(os.listxattr(descriptor)))
                after = os.fstat(descriptor)
                if (after.st_ino, after.st_dev, after.st_size, after.st_mtime_ns, after.st_ctime_ns) != (
                        opened.st_ino, opened.st_dev, opened.st_size, opened.st_mtime_ns, opened.st_ctime_ns):
                    raise ValueError('Incoming file changed while hashing')
            finally:
                os.close(descriptor)
            # Matches the stager's eligibility: bytes, mode, owner/group and xattrs;
            # timestamps are intentionally not part of internal dedup eligibility.
            key = (details.st_size, stat.S_IMODE(details.st_mode), details.st_uid,
                   details.st_gid, digest.digest(), attrs)
            allocated = rounded(details.st_size, block)
            unique[key] = allocated
            logical += details.st_size
            surface_bytes += allocated
            tar_bytes += rounded(details.st_size, 512)
        largest = max(largest, surface_bytes)
    tar_bytes = rounded(tar_bytes + 10240, 10240)
    # Stored-deflate overhead is below0.1%; retain extra fixed framing headroom.
    archive_upper = tar_bytes + (tar_bytes + 999) // 1000 + 65536
    return {'uniqueIncomingBytes': sum(unique.values()), 'incomingMetadataBytes': metadata,
            'largestSurfaceCopyBytes': largest, 'logicalBytes': logical, 'entries': entries,
            'archiveUpperBoundBytes': archive_upper}


if __name__ == '__main__':
    if len(sys.argv) != 3 or sys.argv[1] not in ('incoming', 'managed'):
        raise SystemExit('Usage: ui-capacity.py incoming|managed CANONICAL_ROOT')
    print(json.dumps(tree_budget(sys.argv[2], managed=sys.argv[1] == 'managed')))
