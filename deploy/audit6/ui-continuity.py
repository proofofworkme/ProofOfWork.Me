#!/usr/bin/python3 -I
"""Prepare a separately attested rollback root without changing the current root.

Imported by the durable controller. All roots/commands come from its fixed-path
configuration. Original prior files, root identity and evidence remain intact.
"""
import hashlib
import os
from pathlib import Path
import shutil
import stat


def require(condition, message):
    if not condition:
        raise RuntimeError(message)


def locations(c, release):
    suffix = 'recovery-' + hashlib.sha256(release.encode()).hexdigest()[:32]
    return {'root': str(Path(c['stage']) / ('proofofwork-www-stage-' + suffix)),
            'archive': str(Path(c['archives']) / ('proofofwork-ui-release-' + suffix + '.tgz'))}


def mapping(inventory):
    result = {}
    for item in inventory:
        key = (item['host'], item['path'])
        require(key not in result, 'Duplicate resource in continuity inventory')
        result[key] = (item['sha256'], item['bytes'])
    return result


def prove(prior, candidate, recovery):
    old, new, restored = mapping(prior), mapping(candidate), mapping(recovery)
    old_resources = {key: value for key, value in old.items() if key[1] != '/'}
    require(all(new.get(key) == value for key, value in old_resources.items()),
            'Candidate lacks exact prior resource continuity during forward publication')
    require(all(restored.get(key) == value for key, value in old.items()),
            'Recovery root does not preserve every prior document/resource byte')
    resources = {key: value for key, value in new.items() if key[1] != '/'}
    require(all(restored.get(key) == value for key, value in resources.items()),
            'Recovery root lacks exact candidate resource continuity')
    require(set(restored) == set(old) | set(resources), 'Recovery root contains unclassified resources')
    digest = hashlib.sha256()
    for (host, path), (sha256, size) in sorted(restored.items()):
        for value in (host, path, sha256, str(size)):
            field = value.encode()
            digest.update(len(field).to_bytes(8, 'big'))
            digest.update(field)
    return {'model': 'proofofwork-ui-rollback-resource-continuity-v1',
            'priorFiles': len(old), 'priorResources': len(old_resources), 'candidateResources': len(resources),
            'recoveryFiles': len(restored), 'closureSha256': digest.hexdigest()}


def fsync_file(path):
    fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW)
    try:
        os.fsync(fd)
    finally:
        os.close(fd)


def make(c, release, prior, candidate, surfaces, fingerprint, inventory, command):
    paths = locations(c, release)
    destination, archive = Path(paths['root']), Path(paths['archive'])
    checksum = Path(str(archive) + '.sha256')
    require(not destination.exists() and not archive.exists() and not checksum.exists() and
            not Path(str(archive) + '.provenance').exists(),
            'Continuity rollback artifact already exists; preserve it and use a reviewed fresh release')
    before = fingerprint(prior)
    candidate_before = inventory(candidate)
    old_inventory = inventory(prior)
    # Keep enough headroom for the additional complete root and its archive.
    # This is a preparation guard, not a general VPS retention policy.
    required = 2 * (before['regularBytes'] + sum(x['bytes'] for x in candidate_before)) + 1024 ** 3
    require(shutil.disk_usage(c['stage']).free > required and shutil.disk_usage(c['archives']).free > required,
            'Insufficient reserve for separately attested continuity rollback preparation')
    shutil.copytree(prior, destination, copy_function=shutil.copy2)
    # Only remove the copy's old manifest; original evidence remains untouched.
    (destination / '.proofofwork-ui-release').unlink()
    for surface in surfaces:
        old_surface = destination / ('proofofwork-' + surface)
        new_surface = Path(candidate) / ('proofofwork-' + surface)
        for source in sorted(new_surface.rglob('*')):
            relative = source.relative_to(new_surface)
            target = old_surface / relative
            details = source.lstat()
            require(details.st_uid == os.geteuid() and not details.st_mode & 0o7022,
                    'Candidate resource has unsafe ownership/mode')
            if stat.S_ISDIR(details.st_mode):
                if not target.exists():
                    target.mkdir(mode=stat.S_IMODE(details.st_mode))
                require(target.is_dir() and not target.is_symlink(), 'Continuity directory conflict')
                continue
            require(stat.S_ISREG(details.st_mode) and not source.is_symlink(), 'Unsupported candidate resource type')
            if relative.as_posix() == 'index.html':
                continue
            require(details.st_size <= 16 * 1024 * 1024, 'Candidate resource exceeds smoke bound')
            data = source.read_bytes()
            if target.exists():
                require(target.is_file() and not target.is_symlink() and target.read_bytes() == data and
                        stat.S_IMODE(target.stat().st_mode) == stat.S_IMODE(details.st_mode),
                        'Same resource URL has conflicting bytes or modes: ' + surface + '/' + relative.as_posix())
            else:
                fd = os.open(target, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW,
                             stat.S_IMODE(details.st_mode))
                with os.fdopen(fd, 'wb') as out:
                    out.write(data)
                    out.flush()
                    os.fsync(out.fileno())
                target.chmod(stat.S_IMODE(details.st_mode))
    require(fingerprint(prior) == before, 'Original prior root changed during continuity preparation')
    require(inventory(candidate) == candidate_before, 'Candidate changed during continuity preparation')
    proof = prove(old_inventory, candidate_before, inventory(destination))
    # Transform only the known top-level surface prefixes; no shell evaluation.
    command(['/usr/bin/tar', '--format=posix', '-czf', str(archive),
             '--transform=s,^proofofwork-,surfaces/,', '-C', str(destination),
             *['proofofwork-' + surface for surface in surfaces]])
    archive.chmod(0o600)
    require(archive.stat().st_size <= 512 * 1024 * 1024, 'Continuity archive exceeds existing provenance limit')
    fsync_file(archive)
    digest = hashlib.sha256(archive.read_bytes()).hexdigest()
    fd = os.open(checksum, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)
    with os.fdopen(fd, 'w') as out:
        out.write(digest + '  ' + archive.name + '\n')
        out.flush()
        os.fsync(out.fileno())
    command([c['provenance'], 'record-rollback-evidence', '--archive', str(archive)], root=str(destination))
    command([c['provenance'], 'verify-rollback'], root=str(destination))
    require(fingerprint(prior) == before and inventory(candidate) == candidate_before,
            'Original roots changed while continuity evidence was attested')
    require(prove(old_inventory, candidate_before, inventory(destination)) == proof,
            'Attested continuity root changed')
    # Fsync all prepared files and directories before a job may reference them.
    for p in sorted(destination.rglob('*')):
        if p.is_file():
            fsync_file(p)
    for p in sorted([destination, *[p for p in destination.rglob('*') if p.is_dir()]], reverse=True):
        fd = os.open(p, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
        try:
            os.fsync(fd)
        finally:
            os.close(fd)
    for p in (destination.parent, archive.parent):
        fd = os.open(p, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
        try:
            os.fsync(fd)
        finally:
            os.close(fd)
    return {**paths, 'proof': proof, 'fingerprint': fingerprint(destination),
            'smoke': inventory(destination), 'archiveSha256': digest}
