#!/usr/bin/python3
"""Conservative V3/V4 candidate/archive budgets; no filesystem mutations.

The release plan pins this helper source and its installed stager authority.
Historical phase helpers remain unchanged.
"""
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
import zlib

SURFACES = 'activity boost browser code computer desktop dns growth id inception infinity jobs landing marketplace nft publish search token wallet work'.split()
PAGES_SURFACES = [*SURFACES, 'pages']
PERMISSION_SURFACES = [*PAGES_SURFACES, 'permission']
EXPECTED_STAGER_SHA256 = None


def rounded(size, block):
    return ((size + block - 1) // block) * block


def tree_budget(root, *, owner=0, managed=False):
    root = Path(root)
    base = root.lstat()
    if not stat.S_ISDIR(base.st_mode) or root.resolve() != root:
        raise ValueError('Capacity root is not canonical')
    pages = root / ('proofofwork-pages' if managed else 'pages')
    permission = root / ('proofofwork-permission' if managed else 'permission')
    surfaces = PERMISSION_SURFACES if os.path.lexists(permission) else PAGES_SURFACES if os.path.lexists(pages) else SURFACES
    names = [('proofofwork-' if managed else '') + name for name in surfaces]
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



def closed_managed_archive_budget(incoming, compatibility, order):
    """Bound GNU tar --hard-dereference from the verified final managed paths.

    Every incoming path remains in the archive. Prior paths enter only through
    the complete accepted compatibility closure; physical inode dedup never
    reduces a file's logical tar contribution.
    """
    order = list(order)
    if len(order) != len(set(order)) or set(order) not in (set(SURFACES), set(PAGES_SURFACES), set(PERMISSION_SURFACES)):
        raise ValueError('Closed archive requires the exact managed surface set')
    if set(incoming) != set(order) or not set(compatibility) <= set(order):
        raise ValueError('Closed archive row surface set differs')
    tar_bytes, logical, entries, files = 2048, 0, 1, 0
    file_keys = {'path', 'kind', 'size', 'mode', 'uid', 'gid', 'xattrs', 'sha256'}
    for surface in order:
        merged = {}
        for source in (incoming[surface], compatibility.get(surface, [])):
            seen = set()
            for row in source:
                if not isinstance(row, dict) or row.get('kind') not in ('directory', 'file'):
                    raise ValueError('Closed archive row has an unsupported type')
                relative = row.get('path')
                if (not isinstance(relative, str) or not relative or '\\' in relative or
                        any(ord(c) < 32 or ord(c) == 127 for c in relative) or
                        Path(relative).is_absolute() or '..' in Path(relative).parts or
                        Path(relative).as_posix() != relative):
                    raise ValueError('Closed archive row path is not canonical')
                if relative in seen:
                    raise ValueError('Closed archive row path is duplicated')
                seen.add(relative)
                if row['kind'] == 'directory':
                    if set(row) != {'path', 'kind'}:
                        raise ValueError('Closed archive directory row has file fields')
                else:
                    if (set(row) != file_keys or relative == '.' or
                            any(type(row[key]) is not int or row[key] < 0 for key in ('size', 'mode', 'uid', 'gid')) or
                            row['mode'] > 0o7777 or row['mode'] & 0o7022 or
                            not isinstance(row['sha256'], str) or len(row['sha256']) != 64 or
                            any(c not in '0123456789abcdef' for c in row['sha256']) or
                            not isinstance(row['xattrs'], list)):
                        raise ValueError('Closed archive file row metadata is invalid')
                previous = merged.get(relative)
                if previous is not None:
                    if (previous['kind'] != row['kind'] or row['kind'] == 'file' and
                            (previous['size'], previous['sha256']) != (row['size'], row['sha256'])):
                        raise ValueError('Closed archive row collision differs')
                    continue
                merged[relative] = row
        if merged.get('.', {}).get('kind') != 'directory':
            raise ValueError('Closed archive managed root is missing')
        for relative, row in merged.items():
            if relative != '.':
                for parent in Path(relative).parents:
                    if merged.get(parent.as_posix(), {}).get('kind') != 'directory':
                        raise ValueError('Closed archive parent is missing or collides with a file')
            managed_path = 'proofofwork-' + surface
            if relative != '.':
                managed_path += '/' + relative
            # Match tree_budget's independently measured managed-stage envelope.
            tar_bytes += 1024 + rounded(len(os.fsencode(managed_path)) + 1, 512)
            entries += 1
            if row['kind'] == 'file':
                files += 1
                logical += row['size']
                tar_bytes += rounded(row['size'], 512)
    tar_bytes = rounded(tar_bytes + 10240, 10240)
    upper = tar_bytes + (tar_bytes + 999) // 1000 + 65536
    return {'model': 'closed-managed-archive-tar-gzip-v1', 'managedSurfaces': order,
            'hardDereference': True, 'logicalBytes': logical, 'entries': entries,
            'regularFiles': files, 'archiveUpperBoundBytes': upper}


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


def prior_compatibility(live_root, live_surfaces, stager, incoming):
    """Match the installed stager's complete prior asset traversal and reject all collisions."""
    compatibility, per_surface, references = {}, {}, []
    # A historical hash-pinned stager only knows its original global bounds.
    if hasattr(stager, 'prior_asset_parser'):
        dependency_limit, parse_references = stager.prior_asset_parser(live_surfaces)
    else:
        dependency_limit, parse_references = stager.MAXIMUM_DEPENDENCIES, stager.dependency_references
    counters = {'dependencies': 0, 'reference_edges': 0, 'reference_candidates': 0, 'total_bytes': 0}
    for surface in live_surfaces:
        before = dict(counters)
        live_surface = live_root / ('proofofwork-' + surface)
        index = live_surface / 'index.html'
        details = index.lstat()
        if not stat.S_ISREG(details.st_mode) or index.resolve() != index or details.st_size > stager.MAXIMUM_INDEX_BYTES:
            raise ValueError('Unsafe prior capacity index')
        _, content = stager.digest_regular_file(index, details, capture=True)
        pending = parse_references(live_surface, index, content, counters)
        existing = {row['path']: row for row in incoming[surface]}
        missing, visited = [], set()
        while pending:
            relative = pending.pop()
            if relative in visited:
                continue
            visited.add(relative)
            counters['dependencies'] += 1
            if counters['dependencies'] > dependency_limit:
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
            references.append([surface, relative, row['size'], row['sha256']])
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
                pending.extend(parse_references(live_surface, path, content, counters))
        compatibility[surface] = missing
        per_surface[surface] = {name: counters[name] - before[name] for name in counters}
    digest = hashlib.sha256(json.dumps(sorted(references), separators=(',', ':')).encode()).hexdigest()
    return compatibility, per_surface, counters, digest


def inventory_path(release, digest):
    import re
    if not re.fullmatch(r'[0-9a-f]{12}-[0-9]{8}T[0-9]{6}Z', release) or not re.fullmatch(r'[0-9a-f]{64}', digest):
        raise ValueError('Invalid release inventory identity')
    return Path('/var/tmp/proofofwork-deploy') / ('recovery-control-' + release + '-inventory-' + digest + '.zlib')


def private_staging_storage(incoming, compatibility, live_root, order):
    """Bounds to recheck after the new input and candidate independently establish internal aliases."""
    block = os.statvfs(live_root).f_frsize
    if not 512 <= block <= 65536:
        raise ValueError('Unsupported private stage allocation block')
    # The receiver and the candidate own independent inodes. Each key can
    # be used as one allocation only after comparing the complete file bytes.
    def managed_bytes(groups):
        keys = set()
        entries = directories = 0
        attributes = 0
        for rows in groups:
            for row in rows:
                entries += 1
                if row['kind'] == 'directory':
                    directories += 1
                else:
                    keys.add(dedup_key(row))
                    for name, value in row['xattrs']:
                        attributes += len(os.fsencode(name)) + len(bytes.fromhex(value)) + block
        payload = sum(rounded(key[0], block) for key in keys)
        # Match the native four-block metadata charge on *every* path,
        # including aliases, plus space for directory entries and attributes.
        return payload + (entries * 4 + directories * 2 + 32) * block + rounded(attributes, block)

    managed = {'proofofwork-' + name for name in order}
    passthrough = 0
    snapshot = {}
    pending = [p for p in live_root.iterdir() if p.name not in managed and p.name != '.proofofwork-ui-release']
    while pending:
        path = pending.pop()
        details = path.lstat()
        if (details.st_dev != live_root.stat().st_dev or path.resolve() != path or
                not (stat.S_ISDIR(details.st_mode) or stat.S_ISREG(details.st_mode))):
            raise ValueError('Private stage passthrough contains an unsupported entry')
        snapshot[path] = snapshot_identity(details)
        if len(snapshot) > 100000:
            raise ValueError('Private stage passthrough entry bound exceeded')
        attrs = sum(block + len(os.fsencode(name)) + len(os.getxattr(path, name, follow_symlinks=False))
                    for name in os.listxattr(path, follow_symlinks=False))
        passthrough += max(rounded(details.st_size, block), details.st_blocks * 512) + 4 * block + rounded(attrs, block)
        if stat.S_ISDIR(details.st_mode):
            pending.extend(path.iterdir())
    check_snapshot(snapshot)
    # Include the payload root, surfaces/ and the fresh journal. Double-counting
    # overlaps in incoming/compatibility is conservative.
    return {'model': 'private-release-stage-v1', 'blockSize': block,
            'compactInputUpperBytes': managed_bytes(incoming.values()) + 4 * 1024**2,
            'finalCandidateUpperBytes': passthrough + managed_bytes([*incoming.values(), *compatibility.values()]),
            'passthroughUpperBytes': passthrough}


def private_stage_receipt(stage, stager, expected_upper):
    measured, snapshot = stager.candidate_allocation(stage, os.geteuid())
    if measured['additionalBytes'] > expected_upper:
        raise ValueError('Completed stage exceeds private allocation admission')
    content = list(stager.tree_fingerprint(stage, expected_owner=os.geteuid()))
    stager.verify_candidate_allocation(snapshot)
    rows = [[str(path.relative_to(stage)), ids, [(name, val.hex()) for name, val in attrs]]
            for path, (ids, attrs) in sorted(snapshot.items())]
    return {'storage': measured, 'content': content,
            'allocationSha256': hashlib.sha256(json.dumps(rows, separators=(',', ':')).encode()).hexdigest()}


def verify_private_predecessor(plan, plan_sha, prior, current_compact, current_stage):
    if (prior.get('ok') is not True or prior.get('phase') != 'surfaces-stage' or
            any(prior.get(k) != plan[k] for k in ('releaseId', 'commit', 'tree')) or
            prior.get('planSha256') != plan_sha or prior.get('productionPublished') is not False or
            prior.get('historicalDeletion') is not False or current_compact != prior.get('compactInput') or
            current_stage != prior.get('privateStageAllocation')):
        raise ValueError('Private stage/input no longer match the preceding verified receipt')


def assess_closed_input(request, helpers, live, stager, packed, live_root):
    """Prove the declared tar size from the candidate metadata and the actual live byte closure."""
    if (request['model'] != 'proof-ui-closed-input-v1' or request['releaseId'][:12] != request['commit'][:12]
        or request['helperHashes'] != {key: helpers[key]['sha256'] for key in ('publisher', 'provenance', 'stager')}):
        raise ValueError('Installed release helpers differ from the input attestation')
    if not 0 < len(packed) <= 65536 or hashlib.sha256(packed).hexdigest() != request['inventorySha256']:
        raise ValueError('Candidate inventory is unbound')
    inflater = zlib.decompressobj()
    raw = inflater.decompress(packed, 4 * 1024**2 + 1)
    if len(raw) > 4 * 1024**2 or not inflater.eof or inflater.unused_data or inflater.unconsumed_tail:
        raise ValueError('Invalid compressed candidate inventory')
    rows = json.loads(raw)
    if not isinstance(rows, list) or not 1 <= len(rows) <= 30000:
        raise ValueError('Invalid candidate inventory length')
    order = sorted(PERMISSION_SURFACES)
    incoming = {name: [] for name in order}
    seen = set()
    total = 0
    for rel, kind, mode, uid, gid, size, digest in rows:
        if (not isinstance(rel, str) or Path(rel).as_posix() != rel or Path(rel).is_absolute() or
                '..' in Path(rel).parts or rel in seen or len(rel.encode()) > 4096 or
                any(ord(c) < 32 or ord(c) == 127 or c == chr(92) for c in rel) or
                not isinstance(mode, int) or not 0 <= mode <= 0o777 or mode & 0o022 or uid != 0 or gid != 0 or
                type(size) is not int or not 0 <= size <= 96 * 1024**2):
            raise ValueError('Invalid candidate inventory entry')
        seen.add(rel)
        if rel in ('.', 'surfaces'):
            if kind != 'directory' or size != 0 or digest is not None:
                raise ValueError('Invalid candidate wrapper directory')
            continue
        names = rel.split('/')
        if len(names) < 2 or names[0] != 'surfaces' or names[1] not in incoming:
            raise ValueError('Unexpected candidate surface')
        path = '/'.join(names[2:]) or '.'
        if kind == 'directory' and size == 0 and digest is None:
            row = {'path': path, 'kind': kind}
        elif kind == 'file' and isinstance(digest, str) and len(digest) == 64 and all(c in '0123456789abcdef' for c in digest):
            row = {'path': path, 'kind': kind, 'mode': mode, 'uid': uid, 'gid': gid,
                   'size': size, 'sha256': digest, 'xattrs': []}
        else:
            raise ValueError('Invalid candidate inventory type')
        total += size
        incoming[names[1]].append(row)
    fingerprint = {'sha256': hashlib.sha256(raw).hexdigest(), 'entries': len(rows), 'regularBytes': total}
    if not {'.', 'surfaces'} <= seen or total > 512*1024**2 or request['payloadFingerprint'] != fingerprint:
        raise ValueError('Candidate payload fingerprint differs')
    live_surfaces = stager.live_surface_names(live_root)
    if set(live_surfaces) != set(order):
        raise ValueError('Streaming admission requires the complete live V5 surface family')
    compatibility, _, counters, prior_sha = prior_compatibility(live_root, live_surfaces, stager, incoming)
    archive = closed_managed_archive_budget(incoming, compatibility, order)
    evidence = {'request': request, 'archive': archive, 'priorDependenciesSha256': prior_sha,
                'dependencyCounters': counters, 'liveManifestSha256': live['manifestSha256'], 'liveTreeSha256': live['treeSha256']}
    if 'inputCompactorSha256' in request:
        digest = request['inputCompactorSha256']
        if not isinstance(digest, str) or len(digest) != 64 or any(c not in '0123456789abcdef' for c in digest):
            raise ValueError('Invalid private input compactor identity')
        evidence['privateStaging'] = private_staging_storage(incoming, compatibility, live_root, order)
    return evidence


def recheck_closed_input(request, helpers, live, lock_fd):
    """Read only the release-bound metadata; never create or extract a payload."""
    path = inventory_path(request['releaseId'], request['inventorySha256'])
    info = path.lstat()
    if (path.resolve() != path or not stat.S_ISREG(info.st_mode) or info.st_uid != 0 or info.st_gid != 0
            or info.st_nlink != 1 or info.st_mode & 0o7022 or not 0 < info.st_size <= 65536):
        raise ValueError('Unsafe closed release input')
    with os.fdopen(os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_NOATIME), 'rb') as handle:
        if os.fstat(handle.fileno()) != info:
            raise ValueError('Closed input changed before reading')
        packed = handle.read(65537)
        if os.fstat(handle.fileno()) != info or path.lstat() != info:
            raise ValueError('Closed input changed while reading')
    stager = locked_installed_stager(helpers['stager']['sha256'], lock_fd)
    return assess_closed_input(request, helpers, live, stager, packed, Path('/var/www'))


def stage_budget(incoming_root, live_root, stager, *, owner=0, allocation_parent=None, private_input=False):
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
    order = stager.payload_surface_names(incoming_root) if hasattr(stager, 'payload_surface_names') else stager.SURFACES
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
    input_aliases = {}
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
            elif stat.S_ISREG(details.st_mode) and (details.st_nlink == 1 or private_input):
                inode = (details.st_dev, details.st_ino)
                paths = input_aliases.setdefault(inode, [])
                paths.append(path)
                rows.append(file_row(path, relative, details, stager))
            else:
                raise ValueError('Incoming capacity files must be independent regular copies')
        incoming[surface] = rows
    snapshot[incoming_root] = snapshot_identity(incoming_root.lstat())
    if any(paths[0].lstat().st_nlink != len(paths) for paths in input_aliases.values()):
        raise ValueError('Incoming surface aliases extend outside the fresh input')
    compatibility, per_surface, counters, prior_sha = prior_compatibility(live_root, live_surfaces, stager, incoming)
    check_snapshot(snapshot)
    stager.reject_nested_mounts(live_root, mountinfo)
    stager.reject_nested_mounts(incoming_root, mountinfo)
    result = phase_bound(initial, incoming, old_exclusive, compatibility, order, block)
    archive_model = closed_managed_archive_budget(incoming, compatibility, order)
    result['modeledManagedArchive'] = archive_model
    result['priorDependenciesSha256'] = prior_sha
    result['modeledManagedArchiveUpperBoundBytes'] = archive_model['archiveUpperBoundBytes']
    result.update({'initialCopyUpperBytes': initial, 'exclusiveOldContributionBytes': sum(old_exclusive.values()),
                   'compatibilityCounters': counters, 'perSurfaceCounters': per_surface,
                   'blockSize': block, 'inputStabilityVerified': True})
    if allocation_parent is not None:
        allocation_parent = Path(allocation_parent)
        stager.canonical_safe_directory(allocation_parent, 'Evidence candidate allocation parent', owner)
        if allocation_parent.stat().st_dev != live_root.stat().st_dev:
            raise ValueError('Evidence candidate allocation filesystem differs')
        helper = stager.capacity_helper()
        full_copy = helper.tree_bound(live_root, allocation_parent)
        result['canonicalFullLogicalCopyBound'] = {**full_copy, 'allocationPath': str(allocation_parent),
            'additionalBytes': full_copy['additionalBytes'] + 2*helper.entry_bytes(0, helper.allocation_block(allocation_parent))}
        result['candidateStorage'] = 'release-evidence-v1'
        result['finalScratchAdmission'] = 'completed-candidate-unique-inodes-v1'
        check_snapshot(snapshot)
    return result


def locked_installed_stager(expected=None, lock_fd=None):
    if os.geteuid() != 0 or not sys.flags.isolated:
        raise ValueError('Live capacity verification requires root and isolated Python')
    lock = Path('/run/proofofwork-ui/deploy.lock')
    details = lock.lstat()
    descriptor = int(os.environ['POW_UI_DEPLOY_LOCK_FD']) if lock_fd is None else lock_fd
    opened = os.fstat(descriptor)
    if (not stat.S_ISREG(details.st_mode) or details.st_uid != 0 or details.st_mode & 0o7022 or
            (opened.st_dev, opened.st_ino) != (details.st_dev, details.st_ino)):
        raise ValueError('Inherited deployment lock identity differs')
    fcntl.flock(descriptor, fcntl.LOCK_EX | fcntl.LOCK_NB)
    path = Path('/usr/local/sbin/proofofwork-ui-release-stage')
    if path.resolve() != path:
        raise ValueError('Installed stager path is not canonical')
    descriptor = os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK | os.O_NOATIME)
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
    expected = EXPECTED_STAGER_SHA256 if expected is None else expected
    if not isinstance(expected, str) or len(expected) != 64 or any(
            char not in '0123456789abcdef' for char in expected):
        raise ValueError('Exact planned installed-stager SHA256 is required')
    if hashlib.sha256(code).hexdigest() != expected:
        raise ValueError('Installed stager differs from the reviewed phase model')
    module = types.ModuleType('audit5_installed_stager')
    module.__file__ = str(path)
    sys.modules[module.__name__] = module
    exec(compile(code, str(path), 'exec'), module.__dict__)
    return module


if __name__ == '__main__':
    if len(sys.argv) not in (3, 4, 5) or sys.argv[1] not in ('incoming', 'managed', 'stage') or (
            sys.argv[1] == 'stage' and len(sys.argv) not in (4, 5)):
        raise SystemExit('Usage: phase_capacity.py incoming|managed CANONICAL_ROOT | stage CANONICAL_ROOT EXPECTED_STAGER_SHA256')
    if sys.argv[1] == 'stage':
        EXPECTED_STAGER_SHA256 = sys.argv[3]
        mode = sys.argv[4] if len(sys.argv) == 5 else None
        result = stage_budget(sys.argv[2], '/var/www', locked_installed_stager(),
                              allocation_parent=None if mode == '--private-input' else mode,
                              private_input=mode == '--private-input')
        result['installedStagerSha256'] = EXPECTED_STAGER_SHA256
        print(json.dumps(result))
    else:
        print(json.dumps(tree_budget(sys.argv[2], managed=sys.argv[1] == 'managed')))
