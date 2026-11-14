#!/usr/bin/python3
"""Retire only three explicitly reviewed, archive-equivalent extracted build trees.

Plan is read-only except for its exclusive VPS receipt. Apply requires the exact
reviewed plan hash and a separate operator approval. Archives and build receipts
are never deletion targets. This is not a general cleanup command.
"""
import argparse
import fcntl
import hashlib
import json
import os
from pathlib import Path
import shutil
import stat
import tarfile

BUILD = Path('/data/proofofwork-ui-builds')
RESULTS = Path('/data/proofofwork-pay-development-20261114/results')
TARGETS = (
    ('audit-remediation-d481496-20261112', 'proofofwork-ui-source-d4814962c654-20261112T070304Z',
     'feabc4b7d34546e877747effa2f9b7189a94fa5eee3fe4d910cf539e17644d5c',
     '8d54d3ceffe2c4fed0e7046ab0254b879328bb42cb9c827f11249fe4d5bd8a1f', 31981576),
    ('audit-remediation-9d6d070-20261112', 'proofofwork-ui-source-9d6d070ac3a4-20261112T071021Z',
     '0f2207050017e723ab4212faf596f02be62f09045b62ae209f48a12e9653a718',
     '0eab8df90a5eeb25af121131041a2144e0beaeb3f058789154f44374ce2cfe18', 31993697),
    ('audit-remediation-1c3abcf-20261112', 'proofofwork-ui-source-1c3abcf2e2d3-20261112T072005Z',
     '17de6ee675db5e135186119fe3e915ab6501ce7cc1552856e4f8d9d09d1da9b7',
     '52cdf6969cd135ff23fa58144abfe663824519da409be735f9f50ac4bb426bfa', 32005818),
)
FORMAT = 'pay-exact-three-build-source-retirement-v1'

def require(condition, message):
    if not condition:
        raise ValueError(message)

def digest_file(path):
    digest = hashlib.sha256()
    with path.open('rb') as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b''):
            digest.update(chunk)
    return digest.hexdigest()

def safe_ancestry(path):
    require(path.is_absolute() and path.resolve() == path, 'Noncanonical source ancestry')
    for item in (path, *path.parents):
        info = item.lstat()
        require(stat.S_ISDIR(info.st_mode) and info.st_uid in (0, 1000) and not info.st_mode & 0o022,
                'Unsafe source ancestry: ' + str(item))

def identity(info):
    return [info.st_dev, info.st_ino, info.st_mode, info.st_uid, info.st_gid,
            info.st_nlink, info.st_size, info.st_mtime_ns, info.st_ctime_ns]

def archive_equivalence(root, archive):
    """Stream bytes; refuse specials, aliases, extras, hardlinks and path escapes."""
    root_stat = root.lstat()
    before_archive = identity(archive.lstat())
    require(stat.S_ISREG(archive.lstat().st_mode) and archive.lstat().st_nlink == 1, 'Unsafe archive')
    actual = {root.name: root}
    pending = [root]
    allocated = 0
    while pending:
        parent = pending.pop()
        with os.scandir(parent) as children:
            for entry in children:
                item = Path(entry.path)
                info = item.lstat()
                require(info.st_dev == root_stat.st_dev, 'Source crosses a filesystem')
                require(stat.S_ISDIR(info.st_mode) or stat.S_ISREG(info.st_mode) or stat.S_ISLNK(info.st_mode), 'Special source file')
                if stat.S_ISREG(info.st_mode):
                    require(info.st_nlink == 1, 'Source has an external or internal hardlink')
                actual[str(item.relative_to(root.parent))] = item
                allocated += info.st_blocks * 512
                require(len(actual) <= 20000 and allocated <= 1024 ** 3, 'Source inventory exceeds bounds')
                if stat.S_ISDIR(info.st_mode):
                    pending.append(item)
    seen, commitment, bytes_read = set(), hashlib.sha256(), 0
    with tarfile.open(archive, 'r|gz') as stream:
        for member in stream:
            name = member.name.rstrip('/')
            require(name and name not in seen and name in actual and '..' not in Path(name).parts and not Path(name).is_absolute(), 'Archive inventory differs')
            seen.add(name)
            item = actual[name]
            before = identity(item.lstat())
            info = item.lstat()
            require(member.uid == info.st_uid and member.gid == info.st_gid and member.mode == stat.S_IMODE(info.st_mode), 'Archive ownership/mode differs')
            require((member.isdir() and stat.S_ISDIR(info.st_mode)) or
                    (member.isfile() and stat.S_ISREG(info.st_mode)) or
                    (member.issym() and stat.S_ISLNK(info.st_mode)), 'Archive type differs')
            content = hashlib.sha256()
            if member.isfile():
                require(member.size == info.st_size, 'Archive size differs')
                raw = stream.extractfile(member)
                with item.open('rb') as current:
                    while True:
                        chunk = raw.read(1024 * 1024)
                        require(chunk == current.read(len(chunk) or 1), 'Archive source bytes differ')
                        if not chunk:
                            break
                        content.update(chunk)
                        bytes_read += len(chunk)
                        require(bytes_read <= 1024 ** 3, 'Archive expanded bytes exceed bound')
            elif member.issym():
                require(os.readlink(item) == member.linkname, 'Archive symlink differs')
                require(item.resolve().is_relative_to(root.resolve()), 'Source symlink escapes its tree')
                content.update(member.linkname.encode())
            require(before == identity(item.lstat()), 'Source changed while verifying')
            commitment.update(json.dumps([name, before, content.hexdigest()], separators=(',', ':')).encode() + b'\n')
    require(seen == set(actual), 'Archive omits source entries')
    require(before_archive == identity(archive.lstat()), 'Archive changed while verifying')
    return {'entries': len(seen), 'allocatedBytes': allocated + root_stat.st_blocks * 512,
            'inventorySha256': commitment.hexdigest(), 'rootIdentity': identity(root_stat)}

def assert_unreferenced(roots):
    prefixes = [str(path).encode() for path in roots]
    def check(raw):
        require(not any(prefix in raw for prefix in prefixes), 'A live process or systemd configuration references a source tree')
    for proc in Path('/proc').iterdir():
        if not proc.name.isdigit() or int(proc.name) == os.getpid():
            continue
        try:
            check((proc / 'cmdline').read_bytes())
            check((proc / 'maps').read_bytes())
            for item in [proc / 'cwd', proc / 'root', proc / 'exe', *(proc / 'fd').iterdir()]:
                try:
                    check(os.readlink(item).encode())
                except FileNotFoundError:
                    pass
        except (FileNotFoundError, ProcessLookupError):
            pass
    for base in [Path('/etc/systemd/system'), Path('/run/systemd/system')]:
        for current, dirs, files in os.walk(base, followlinks=False):
            for name in dirs + files:
                item = Path(current) / name
                if item.is_symlink():
                    check(os.readlink(item).encode())
                elif item.is_file():
                    require(item.stat().st_size <= 2 * 1024 ** 2, 'Oversized systemd configuration')
                    check(item.read_bytes())

def verify_targets():
    rows, roots = [], []
    for run, name, archive_sha, receipt_sha, inode in TARGETS:
        root = BUILD / run / name
        archive, receipt = root.with_name(name + '.tgz'), root.parent / 'build-receipt.json'
        safe_ancestry(root)
        require(root.stat().st_dev == 64514 and root.stat().st_ino == inode, 'Reviewed source tree identity changed')
        require(digest_file(archive) == archive_sha and digest_file(receipt) == receipt_sha, 'Retained archive or receipt changed')
        rows.append({'path': str(root), 'archive': str(archive), 'archiveSha256': archive_sha,
                     'receiptSha256': receipt_sha, **archive_equivalence(root, archive)})
        roots.append(root)
    assert_unreferenced(roots)
    return rows

def save_exclusive(path, value):
    require(path.parent == RESULTS and path.name.endswith('.json') and path.resolve() == path, 'Receipt must be a new named VPS result')
    safe_ancestry(path.parent)
    raw = (json.dumps(value, sort_keys=True, indent=2) + '\n').encode()
    fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)
    with os.fdopen(fd, 'wb') as stream:
        stream.write(raw)
        stream.flush()
        os.fsync(stream.fileno())
    return hashlib.sha256(raw).hexdigest()

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('mode', choices=('plan', 'apply'))
    parser.add_argument('--receipt', required=True, type=Path)
    parser.add_argument('--plan', type=Path)
    parser.add_argument('--plan-sha256')
    parser.add_argument('--approval')
    args = parser.parse_args()
    require(os.geteuid() == 0, 'Root is required for a complete process reference census')
    require(shutil.rmtree.avoids_symlink_attacks, 'FD-safe tree removal unavailable')
    safe_ancestry(BUILD)
    lock = os.open(BUILD / '.build.lock', os.O_RDWR | os.O_NOFOLLOW)
    lock_info = os.fstat(lock)
    require(stat.S_ISREG(lock_info.st_mode) and lock_info.st_nlink == 1 and
            lock_info.st_uid in (0, 1000) and not lock_info.st_mode & 0o077, 'Unsafe build lock')
    fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
    rows = verify_targets()
    controller = digest_file(Path(__file__).resolve())
    plan = {'format': FORMAT, 'controllerSha256': controller, 'targets': rows,
            'archivesRetained': True, 'productionUntouched': True}
    if args.mode == 'plan':
        result = {'receipt': str(args.receipt), 'sha256': save_exclusive(args.receipt, plan),
                  'allocatedBytes': sum(row['allocatedBytes'] for row in rows), 'targets': [row['path'] for row in rows]}
    else:
        require(args.approval == 'retire-only-three-reviewed-pay-build-source-trees', 'Explicit exact-scope approval required')
        require(args.plan and args.plan.parent == RESULTS and not args.plan.is_symlink(), 'Reviewed VPS plan required')
        require(digest_file(args.plan) == args.plan_sha256, 'Reviewed plan hash differs')
        require(json.loads(args.plan.read_text()) == plan, 'Current sources differ from the reviewed plan')
        journal = {'format': FORMAT, 'planSha256': args.plan_sha256, 'phase': 'verified-before-removal', 'targets': rows}
        save_exclusive(args.receipt, journal)
        for row in rows:
            root = Path(row['path'])
            require(identity(root.lstat()) == row['rootIdentity'], 'Source changed before removal')
            shutil.rmtree(root)
            require(not os.path.lexists(root), 'Source removal incomplete')
            require(digest_file(Path(row['archive'])) == row['archiveSha256'], 'Retained archive changed')
            require(digest_file(root.parent / 'build-receipt.json') == row['receiptSha256'], 'Build receipt changed')
        result = {'format': FORMAT, 'phase': 'complete', 'planSha256': args.plan_sha256,
                  'removed': [row['path'] for row in rows], 'archivesRetained': True, 'productionUntouched': True}
        completion = args.receipt.with_name(args.receipt.stem + '-complete.json')
        result['receiptSha256'] = save_exclusive(completion, result)
        result['receipt'] = str(completion)
    print(json.dumps(result), flush=True)

if __name__ == '__main__':
    main()
