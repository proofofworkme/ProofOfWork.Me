#!/usr/bin/env python3
"""Read-only complete-root fingerprint for an explicit retained UI rollback."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import stat
import struct
import time


def fingerprint(root):
    root = Path(root)
    if not root.is_absolute() or root.resolve(strict=True) != root or root.is_symlink():
        raise ValueError('Retained root must be an absolute canonical directory')
    digest = hashlib.sha256()
    entries = regular_bytes = 0
    manifest_hash = None
    deadline = time.monotonic() + 120

    def identity(details):
        return (details.st_dev, details.st_ino, details.st_mode, details.st_uid,
                details.st_gid, details.st_size, details.st_mtime_ns, details.st_ctime_ns)

    def field(value):
        value = str(value).encode('utf-8')
        digest.update(struct.pack('>Q', len(value)))
        digest.update(value)

    def walk(path, relative):
        nonlocal entries, regular_bytes, manifest_hash
        if time.monotonic() > deadline:
            raise ValueError('Retained-root fingerprint exceeded 120 seconds')
        details = path.lstat()
        if details.st_uid != os.geteuid() or details.st_mode & 0o7022:
            raise ValueError('Retained path has unsafe ownership or mode')
        entries += 1
        if entries > 25000:
            raise ValueError('Retained-root entry bound exceeded')
        for value in (relative, stat.S_IMODE(details.st_mode), details.st_uid, details.st_gid):
            field(value)
        if stat.S_ISDIR(details.st_mode):
            field('directory')
            names = sorted(os.listdir(path))
            for name in names:
                if '\\' in name or any(ord(c) < 32 or ord(c) == 127 for c in name):
                    raise ValueError('Unsafe retained-root path')
                walk(path / name, name if relative == '.' else relative + '/' + name)
            if identity(path.lstat()) != identity(details) or sorted(os.listdir(path)) != names:
                raise ValueError('Retained directory changed during fingerprinting')
        elif stat.S_ISREG(details.st_mode):
            field('file')
            is_manifest = relative == '.proofofwork-ui-release'
            if is_manifest and details.st_size > 65536:
                raise ValueError('Retained manifest exceeds its 64 KiB bound')
            regular_bytes += details.st_size
            if regular_bytes > 2 * 1024 ** 3:
                raise ValueError('Retained-root byte bound exceeded')
            fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW)
            with os.fdopen(fd, 'rb') as source:
                if identity(os.fstat(source.fileno())) != identity(details):
                    raise ValueError('Retained file identity changed')
                file_hash = hashlib.sha256()
                read_bytes = 0
                for chunk in iter(lambda: source.read(65537 if is_manifest else 1024 * 1024), b''):
                    read_bytes += len(chunk)
                    if is_manifest and read_bytes > 65536:
                        raise ValueError('Retained manifest grew beyond its 64 KiB bound')
                    if time.monotonic() > deadline:
                        raise ValueError('Retained-root fingerprint exceeded 120 seconds')
                    file_hash.update(chunk)
                if identity(os.fstat(source.fileno())) != identity(details):
                    raise ValueError('Retained file changed during hashing')
            field(file_hash.hexdigest())
            if is_manifest:
                # Bind the separate manifest receipt to the very same bounded,
                # no-follow descriptor used in the complete-root fingerprint.
                manifest_hash = file_hash.hexdigest()
        else:
            raise ValueError('Retained root contains a link or unsupported type')

    walk(root, '.')
    if manifest_hash is None:
        raise ValueError('Retained manifest must be a bounded regular file')
    return {'format': 'proofofwork-ui-retained-root-v1', 'classification': 'retain',
            'root': str(root), 'manifestSha256': manifest_hash,
            'treeSha256': digest.hexdigest(), 'entries': entries, 'regularBytes': regular_bytes}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('root', type=Path)
    parser.add_argument('--manifest-sha256')
    parser.add_argument('--tree-sha256')
    args = parser.parse_args()
    if os.environ.get('POW_UI_ALLOW_TEST_ROOTS') != '1' and not re.fullmatch(
            r'/var/backups/proofofwork-ui/rollback-roots/proofofwork-www-pre-[A-Za-z0-9][A-Za-z0-9._-]{0,127}', str(args.root)):
        parser.error('Only an exact production retained rollback root is permitted')
    if bool(args.manifest_sha256) != bool(args.tree_sha256):
        parser.error('Both expected fingerprints are required together')
    for expected in (args.manifest_sha256, args.tree_sha256):
        if expected is not None and not re.fullmatch('[0-9a-f]{64}', expected):
            parser.error('Expected fingerprints must be lowercase SHA256')
    result = fingerprint(args.root)
    if args.manifest_sha256 is not None and (
            result['manifestSha256'] != args.manifest_sha256 or result['treeSha256'] != args.tree_sha256):
        raise ValueError('Retained rollback differs from the explicit reviewed classification')
    print(json.dumps(result, sort_keys=True))


if __name__ == '__main__':
    main()
