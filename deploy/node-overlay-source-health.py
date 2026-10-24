#!/usr/bin/python3 -I
"""Read-only, exact source-overlay verification. This does not certify archives.

The root-owned acceptance manifest must be independently reviewed and installed
by a scoped deployment controller; this tool never creates or learns a baseline.
Unmodified files remain bound to the detached base Git tree. Every deviation
requires an exact hash, mode, and retained acceptance-evidence hash.
"""
import hashlib
import json
import os
from pathlib import Path, PurePosixPath
import re
import stat
import subprocess

ROOT = Path('/opt/proofofwork-api')
MANIFEST = Path('/etc/proofofwork-retention/node-source-overlays.json')
EVIDENCE = Path('/data/proofofwork-release-backups')


def require(condition, message):
    if not condition:
        raise ValueError(message)


def identity(s):
    return (s.st_dev, s.st_ino, s.st_mode, s.st_uid, s.st_gid,
            s.st_nlink, s.st_size, s.st_mtime_ns, s.st_ctime_ns)


def read_regular(path, owner, limit=32 * 1024**2):
    require(path.is_absolute() and path.resolve(strict=True) == path,
            'Noncanonical evidence/source path')
    s = path.lstat()
    require(stat.S_ISREG(s.st_mode) and s.st_uid == owner and
            not s.st_mode & 0o7022 and s.st_nlink == 1 and s.st_size <= limit,
            'Unsafe evidence/source metadata')
    fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
    with os.fdopen(fd, 'rb') as f:
        require(identity(os.fstat(f.fileno())) == identity(s), 'File changed')
        raw = f.read(limit + 1)
        require(identity(os.fstat(f.fileno())) == identity(s), 'File changed')
    require(identity(path.lstat()) == identity(s) and len(raw) == s.st_size,
            'File changed')
    return raw


def relative(value):
    require(isinstance(value, str) and value and '\\' not in value and
            not any(ord(c) < 32 or ord(c) == 127 for c in value), 'Invalid source path')
    p = PurePosixPath(value)
    require(not p.is_absolute() and str(p) == value and '..' not in p.parts and
            p.parts[0] not in ('.git', 'node_modules'), 'Unsafe source path')
    return value


def digest(raw):
    return hashlib.sha256(raw).hexdigest()


def git(root, *args):
    return subprocess.check_output(
        ['git', '-c', f'safe.directory={root}', '-C', str(root), *args],
        env={**os.environ, 'GIT_OPTIONAL_LOCKS': '0'}, timeout=30)


def unique_object(pairs):
    result = {}
    for key, value in pairs:
        require(key not in result, 'Duplicate JSON key')
        result[key] = value
    return result


def validate_manifest(m):
    require(set(m) == {'format', 'baselineHead', 'baselineTree', 'overlays'},
            'Unexpected manifest fields')
    require(m['format'] == 'pow-accepted-node-source-overlays-v1', 'Wrong format')
    for key in ('baselineHead', 'baselineTree'):
        require(isinstance(m[key], str) and re.fullmatch('[0-9a-f]{40}', m[key]),
                'Invalid Git identity')
    require(isinstance(m['overlays'], list) and len(m['overlays']) <= 2000,
            'Invalid overlay count')
    rows = {}
    for row in m['overlays']:
        require(set(row) == {'path', 'sha256', 'gitMode', 'evidence'},
                'Unexpected overlay fields')
        name = relative(row['path'])
        require(name not in rows, 'Duplicate overlay')
        require(row['gitMode'] in ('100644', '100755') and
                isinstance(row['sha256'], str) and
                re.fullmatch('[0-9a-f]{64}', row['sha256']), 'Invalid source pin')
        require(isinstance(row['evidence'], list) and row['evidence'],
                'Missing acceptance evidence')
        for e in row['evidence']:
            require(set(e) == {'path', 'sha256'} and isinstance(e['path'], str) and
                    isinstance(e['sha256'], str) and
                    re.fullmatch('[0-9a-f]{64}', e['sha256']), 'Invalid evidence pin')
        rows[name] = row
    return rows


def verify(root=ROOT, manifest=MANIFEST, evidence_root=EVIDENCE, manifest_owner=0):
    raw = read_regular(manifest, manifest_owner)
    m = json.loads(raw, object_pairs_hook=unique_object)
    rows = validate_manifest(m)
    require(root.is_absolute() and root.resolve(strict=True) == root and
            not root.stat().st_mode & 0o7022, 'Unsafe runtime root')
    owner = root.stat().st_uid
    # A detached base is mandatory; do not reset or modify Git to satisfy it.
    ref = subprocess.run(['git', '-c', f'safe.directory={root}', '-C', str(root),
                          'symbolic-ref', '-q', 'HEAD'], stdout=subprocess.PIPE,
                         stderr=subprocess.PIPE, timeout=30)
    require(ref.returncode == 1, 'Runtime base must be detached')
    require(git(root, 'rev-parse', 'HEAD').decode().strip() == m['baselineHead'] and
            git(root, 'rev-parse', 'HEAD^{tree}').decode().strip() == m['baselineTree'],
            'Runtime base differs')
    tree_raw = git(root, 'ls-tree', '-rz', '--full-tree', 'HEAD')
    tree = {}
    for record in tree_raw.split(b'\0'):
        if not record:
            continue
        metadata, name = record.split(b'\t', 1)
        mode, kind, oid = metadata.decode().split()
        name = relative(name.decode())
        require(kind == 'blob' and mode in ('100644', '100755'),
                'Unsupported base source type')
        tree[name] = (mode, oid)
    others = git(root, 'ls-files', '--others', '--exclude-standard', '-z')
    untracked = {relative(n.decode()) for n in others.split(b'\0') if n}
    require(untracked == set(rows) - set(tree), 'Unexpected or missing untracked source')
    ignored = git(root, 'ls-files', '--others', '--ignored', '--exclude-standard', '-z')
    require(all(n.startswith(b'node_modules/') for n in ignored.split(b'\0') if n),
            'Unexpected ignored source')
    evidence_pins = {}
    source_pins = {}
    for name in sorted(set(tree) | set(rows)):
        path = root / name
        data = read_regular(path, owner)
        actual = digest(data)
        mode = '100755' if path.stat().st_mode & 0o111 else '100644'
        if name in rows:
            row = rows[name]
            require(actual == row['sha256'] and mode == row['gitMode'],
                    f'Overlay differs: {name}')
            for e in row['evidence']:
                ep = Path(e['path'])
                require(ep.is_absolute() and evidence_root in ep.parents,
                        'Evidence escapes retained release custody')
                value = read_regular(ep, manifest_owner)
                require(digest(value) == e['sha256'], 'Acceptance evidence differs')
                evidence_pins[ep] = e['sha256']
        else:
            base_mode, oid = tree[name]
            actual_oid = hashlib.sha1(b'blob ' + str(len(data)).encode() + b'\0' + data).hexdigest()
            require(mode == base_mode and actual_oid == oid, f'Base source differs: {name}')
        source_pins[path] = (actual, mode)
    # Fence a concurrent overlay, manifest edit or Git change before success.
    require(read_regular(manifest, manifest_owner) == raw and
            git(root, 'ls-tree', '-rz', '--full-tree', 'HEAD') == tree_raw and
            git(root, 'rev-parse', 'HEAD').decode().strip() == m['baselineHead'] and
            git(root, 'ls-files', '--others', '--exclude-standard', '-z') == others and
            git(root, 'ls-files', '--others', '--ignored', '--exclude-standard', '-z') == ignored,
            'Runtime inventory changed during verification')
    for path, (expected, mode) in source_pins.items():
        require(digest(read_regular(path, owner)) == expected and
                ('100755' if path.stat().st_mode & 0o111 else '100644') == mode,
                'Source changed during verification')
    for path, expected in evidence_pins.items():
        require(digest(read_regular(path, manifest_owner)) == expected, 'Evidence changed during verification')
    return {'ok': True, 'scope': 'source-only', 'baselineHead': m['baselineHead'],
            'baselineTree': m['baselineTree'], 'overlayCount': len(rows),
            'manifestSha256': digest(raw), 'archiveAndDependencyCoverageVerified': False}


if __name__ == '__main__':
    try:
        print(json.dumps(verify()))
    except Exception as error:
        print(json.dumps({'ok': False, 'scope': 'source-only', 'error': str(error)}))
        raise SystemExit(2)
