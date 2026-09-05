#!/usr/bin/python3
"""Conservative audit-5 candidate/archive budgets; no filesystem mutations."""
import sys

if __name__ == '__main__' and not sys.flags.isolated:
    raise SystemExit('Invoke capacity verification with python3 -I.')

import fcntl
import hashlib
import json
import os
from pathlib import Path
import stat
import types

SURFACES = 'activity boost browser computer desktop growth id inception infinity landing marketplace nft token wallet work'.split()
EXPECTED_STAGER_SHA256 = '39f17624d0e244382c344e31f5b04b0b58bb8f4e8c7bc9c93d7418bc8ab0f238'


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


def dedup_key(row):
    return (row['size'], row['mode'], row['uid'], row['gid'],
            tuple(tuple(value) for value in row['xattrs']), row['sha256'])


def phase_bound(initial, incoming, old_exclusive, compatibility, order, block):
    """Bound each real copy before dedup, without crediting shared old inodes."""
    current = initial
    phases = [{'phase': 'initial-copy', 'upperBytes': current}]
    seen = set()
    for surface in order:
        current -= old_exclusive.get(surface, 0)
        if current < 0:
            raise ValueError('Invalid exclusive old-copy contribution')
        rows = incoming[surface]
        files = [row for row in rows if row['kind'] == 'file']
        metadata = len(rows) * block
        phases.append({'phase': 'incoming-copy:' + surface,
                       'upperBytes': current + metadata + sum(rounded(row['size'], block) for row in files)})
        current += metadata
        for row in files:
            identity = dedup_key(row)
            if identity not in seen:
                current += rounded(row['size'], block)
                seen.add(identity)
        phases.append({'phase': 'incoming-dedup:' + surface, 'upperBytes': current})
    for surface in order:
        rows = compatibility.get(surface, [])
        files = [row for row in rows if row['kind'] == 'file']
        metadata = len(rows) * block
        phases.append({'phase': 'compatibility-copy:' + surface,
                       'upperBytes': current + metadata + sum(rounded(row['size'], block) for row in files)})
        current += metadata
        for row in files:
            identity = dedup_key(row)
            if identity not in seen:
                current += rounded(row['size'], block)
                seen.add(identity)
        phases.append({'phase': 'compatibility-dedup:' + surface, 'upperBytes': current})
    peak = max(phases, key=lambda row: row['upperBytes'])
    return {'peakAdditionalBytes': peak['upperBytes'], 'peakPhase': peak['phase'],
            'finalCandidateUpperBytes': current, 'phases': phases}


def snapshot_identity(details):
    return (details.st_dev, details.st_ino, details.st_mode, details.st_uid,
            details.st_gid, details.st_size, details.st_mtime_ns,
            details.st_ctime_ns, details.st_nlink, details.st_blocks)


def check_snapshot(snapshot):
    for path, identity in snapshot.items():
        if snapshot_identity(path.lstat()) != identity:
            raise ValueError('Capacity input changed during inspection')


def file_row(path, relative, details, stager, *, copy_xattrs=True):
    digest, _ = stager.digest_regular_file(path, details)
    descriptor = os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
    try:
        if snapshot_identity(os.fstat(descriptor)) != snapshot_identity(details):
            raise ValueError('Capacity file changed before metadata inspection')
        attrs = [(name, os.getxattr(descriptor, name).hex())
                 for name in sorted(os.listxattr(descriptor))] if copy_xattrs else []
        if snapshot_identity(os.fstat(descriptor)) != snapshot_identity(details):
            raise ValueError('Capacity file changed during metadata inspection')
    finally:
        os.close(descriptor)
    return {'path': relative, 'kind': 'file', 'size': details.st_size,
            'mode': stat.S_IMODE(details.st_mode), 'uid': details.st_uid,
            'gid': details.st_gid, 'xattrs': attrs, 'sha256': digest.hex()}


def stage_budget(incoming_root, live_root, stager, *, owner=0):
    """Read-only collector; caller holds the deployment lock through staging."""
    incoming_root, live_root = Path(incoming_root), Path(live_root)
    stager.canonical_safe_directory(live_root, 'Live capacity root', owner)
    stager.canonical_safe_directory(incoming_root, 'Incoming capacity root', owner)
    block = os.statvfs(live_root).f_frsize
    if os.statvfs(incoming_root).f_frsize != block or incoming_root.stat().st_dev != live_root.stat().st_dev:
        raise ValueError('Capacity inputs must share the target filesystem')
    mountinfo = Path('/proc/self/mountinfo')
    stager.reject_nested_mounts(live_root, mountinfo)
    stager.reject_nested_mounts(incoming_root, mountinfo)
    stager.validate_exact_surfaces_root(incoming_root, owner,
                                       stager.MAXIMUM_PAYLOAD_ENTRIES, stager.MAXIMUM_PAYLOAD_BYTES)
    order = stager.SURFACES
    live_surfaces = stager.live_surface_names(live_root)
    snapshot, seen_inodes, incoming = {}, set(), {}
    # Private staging parent and publication directory-entry overhead. Root and
    # all old file/directory metadata remain charged even after their removal.
    initial = 4 * block
    old_exclusive = {surface: 0 for surface in order}
    pending = [live_root]
    while pending:
        path = pending.pop()
        details = path.lstat()
        if details.st_dev != live_root.stat().st_dev:
            raise ValueError('Live capacity input crosses a filesystem')
        snapshot[path] = snapshot_identity(details)
        if len(snapshot) > 50000:
            raise ValueError('Live capacity entry bound exceeded')
        initial += block
        inode = (details.st_dev, details.st_ino)
        if inode not in seen_inodes:
            seen_inodes.add(inode)
            initial += max(details.st_blocks * 512,
                           block if stat.S_ISDIR(details.st_mode) else rounded(details.st_size, block))
        if stat.S_ISDIR(details.st_mode):
            pending.extend(path.iterdir())
        elif stat.S_ISREG(details.st_mode):
            top = path.relative_to(live_root).parts[0]
            surface = top.removeprefix('proofofwork-')
            if top == 'proofofwork-' + surface and surface in old_exclusive and details.st_nlink == 1:
                # Remove only this exclusive inode's logical contribution to the
                # initial bound. Never subtract metadata, preallocation or an
                # inode with aliases that could survive the surface replacement.
                old_exclusive[surface] += rounded(details.st_size, block)
        elif not stat.S_ISLNK(details.st_mode):
            raise ValueError('Unsupported live capacity entry')
    if initial > 4 * 1024**3:
        raise ValueError('Live capacity copy bound exceeded')
    for surface in order:
        root = incoming_root / surface
        rows, pending = [], [root]
        while pending:
            path = pending.pop()
            details = path.lstat()
            if (path.resolve() != path or details.st_dev != live_root.stat().st_dev or
                    details.st_uid != owner or details.st_mode & 0o7022):
                raise ValueError('Unsafe incoming capacity entry')
            snapshot[path] = snapshot_identity(details)
            relative = '.' if path == root else str(path.relative_to(root))
            if stat.S_ISDIR(details.st_mode):
                rows.append({'path': relative, 'kind': 'directory'})
                pending.extend(path.iterdir())
            elif stat.S_ISREG(details.st_mode) and details.st_nlink == 1:
                rows.append(file_row(path, relative, details, stager))
            else:
                raise ValueError('Incoming capacity files must be independent regular copies')
        incoming[surface] = rows
    snapshot[incoming_root] = snapshot_identity(incoming_root.lstat())
    compatibility, per_surface = {}, {}
    counters = {'dependencies': 0, 'reference_edges': 0, 'reference_candidates': 0, 'total_bytes': 0}
    for surface in live_surfaces:
        before = dict(counters)
        live_surface = live_root / ('proofofwork-' + surface)
        index = live_surface / 'index.html'
        details = index.lstat()
        if not stat.S_ISREG(details.st_mode) or index.resolve() != index or details.st_size > stager.MAXIMUM_INDEX_BYTES:
            raise ValueError('Unsafe prior capacity index')
        _, content = stager.digest_regular_file(index, details, capture=True)
        pending = stager.dependency_references(live_surface, index, content, counters)
        existing = {row['path']: row for row in incoming[surface]}
        missing, visited = [], set()
        while pending:
            relative = pending.pop()
            if relative in visited:
                continue
            visited.add(relative)
            counters['dependencies'] += 1
            if counters['dependencies'] > stager.MAXIMUM_DEPENDENCIES:
                raise ValueError('Prior compatibility dependency bound exceeded')
            path = live_surface / relative
            details = path.lstat()
            if path.resolve() != path or not stat.S_ISREG(details.st_mode) or details.st_size > stager.MAXIMUM_ASSET_BYTES:
                raise ValueError('Unsafe prior compatibility capacity file')
            counters['total_bytes'] += details.st_size
            if counters['total_bytes'] > stager.MAXIMUM_TOTAL_BYTES:
                raise ValueError('Prior compatibility byte bound exceeded')
            capture = path.suffix.lower() in ('.css', '.js', '.mjs')
            digest, content = stager.digest_regular_file(path, details, capture=capture)
            # copy_prior_file preserves mode/uid/gid/bytes but does not copy xattrs.
            row = {'path': relative, 'kind': 'file', 'size': details.st_size,
                   'mode': stat.S_IMODE(details.st_mode), 'uid': details.st_uid,
                   'gid': details.st_gid, 'xattrs': [], 'sha256': digest.hex()}
            if relative in existing:
                candidate = existing[relative]
                if candidate['kind'] != 'file' or (candidate['size'], candidate['sha256']) != (row['size'], row['sha256']):
                    raise ValueError('Prior compatibility capacity collision differs')
            else:
                for parent in reversed(Path(relative).parents):
                    name = str(parent)
                    if name in existing:
                        if existing[name]['kind'] != 'directory':
                            raise ValueError('Prior compatibility parent collides with a file')
                    else:
                        details_parent = (live_surface / parent).lstat()
                        if not stat.S_ISDIR(details_parent.st_mode):
                            raise ValueError('Unsafe prior compatibility parent')
                        directory = {'path': name, 'kind': 'directory'}
                        missing.append(directory)
                        existing[name] = directory
                missing.append(row)
                existing[relative] = row
            if capture:
                pending.extend(stager.dependency_references(live_surface, path, content, counters))
        compatibility[surface] = missing
        per_surface[surface] = {name: counters[name] - before[name] for name in counters}
    check_snapshot(snapshot)
    stager.reject_nested_mounts(live_root, mountinfo)
    stager.reject_nested_mounts(incoming_root, mountinfo)
    result = phase_bound(initial, incoming, old_exclusive, compatibility, order, block)
    result.update({'initialCopyUpperBytes': initial, 'exclusiveOldContributionBytes': sum(old_exclusive.values()),
                   'compatibilityCounters': counters, 'perSurfaceCounters': per_surface,
                   'blockSize': block, 'inputStabilityVerified': True})
    return result


def locked_installed_stager():
    if os.geteuid() != 0 or not sys.flags.isolated:
        raise ValueError('Live capacity verification requires root and isolated Python')
    lock = Path('/run/proofofwork-ui/deploy.lock')
    details = lock.lstat()
    descriptor = int(os.environ['POW_UI_DEPLOY_LOCK_FD'])
    opened = os.fstat(descriptor)
    if (not stat.S_ISREG(details.st_mode) or details.st_uid != 0 or details.st_mode & 0o7022 or
            (opened.st_dev, opened.st_ino) != (details.st_dev, details.st_ino)):
        raise ValueError('Inherited deployment lock identity differs')
    fcntl.flock(descriptor, fcntl.LOCK_EX | fcntl.LOCK_NB)
    path = Path('/usr/local/sbin/proofofwork-ui-release-stage')
    if path.resolve() != path:
        raise ValueError('Installed stager path is not canonical')
    descriptor = os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
    try:
        before = os.fstat(descriptor)
        if (not stat.S_ISREG(before.st_mode) or before.st_uid != 0 or before.st_mode & 0o7022 or
                not 0 < before.st_size <= 1024**2):
            raise ValueError('Unsafe installed stager')
        with os.fdopen(os.dup(descriptor), 'rb') as source:
            code = source.read(1024**2 + 1)
        if len(code) != before.st_size or snapshot_identity(os.fstat(descriptor)) != snapshot_identity(before):
            raise ValueError('Installed stager changed during read')
    finally:
        os.close(descriptor)
    if hashlib.sha256(code).hexdigest() != EXPECTED_STAGER_SHA256:
        raise ValueError('Installed stager differs from the reviewed phase model')
    module = types.ModuleType('audit5_installed_stager')
    sys.modules[module.__name__] = module
    exec(compile(code, str(path), 'exec'), module.__dict__)
    return module


if __name__ == '__main__':
    if len(sys.argv) != 3 or sys.argv[1] not in ('incoming', 'managed', 'stage'):
        raise SystemExit('Usage: ui-capacity.py incoming|managed|stage CANONICAL_ROOT')
    if sys.argv[1] == 'stage':
        result = stage_budget(sys.argv[2], '/var/www', locked_installed_stager())
        result['installedStagerSha256'] = EXPECTED_STAGER_SHA256
        print(json.dumps(result))
    else:
        print(json.dumps(tree_budget(sys.argv[2], managed=sys.argv[1] == 'managed')))
