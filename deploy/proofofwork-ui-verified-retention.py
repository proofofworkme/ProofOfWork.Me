#!/usr/bin/python3 -I
"""Keep verified current/latest UI recovery material and retire redundant copies.

Dry-run by default. Production-only CLI, deployment lock, complete byte/hash
verification, process/config reference refusal, and durable compact evidence.
"""
import argparse
import datetime
import fcntl
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import stat
import subprocess

RELEASE = re.compile(r'[0-9a-f]{7,64}-[0-9]{8}T[0-9]{6}Z\Z')
STAGE = re.compile(r'proofofwork-ui-(source|surfaces)-([0-9a-f]{7,64}-[0-9]{8}T[0-9]{6}Z)(\.tgz(?:\.sha256)?)?\Z')
SURFACES = frozenset('activity boost browser code computer desktop dns growth id inception infinity jobs landing marketplace nft publish search token wallet work'.split())

PRE_JOBS_SURFACES = SURFACES - {'jobs'}
SURFACE_FAMILIES = {SURFACES, PRE_JOBS_SURFACES, PRE_JOBS_SURFACES - {'code'}, PRE_JOBS_SURFACES - {'code', 'search'},
                    PRE_JOBS_SURFACES - {'code', 'search', 'publish'}, PRE_JOBS_SURFACES - {'code', 'search', 'publish', 'dns'},
                    PRE_JOBS_SURFACES - {'code', 'search', 'publish', 'dns', 'boost'}}


def sha256(path):
    with path.open('rb') as stream:
        return hashlib.file_digest(stream, 'sha256').hexdigest()


def safe_path(path, directory=True):
    info = path.lstat()
    if path.resolve() != path or path.is_symlink() or (directory and not stat.S_ISDIR(info.st_mode)) or info.st_uid != os.geteuid() or info.st_mode & 0o7022:
        raise ValueError('Unsafe retention path: ' + str(path))


def manifest(path):
    source = path / '.proofofwork-ui-release'
    safe_path(source, directory=False)
    if not source.is_file() or source.stat().st_size > 65536:
        raise ValueError('Invalid release manifest')
    fields = {}
    for line in source.read_text().splitlines():
        key, separator, value = line.partition('=')
        if not separator or key in fields:
            raise ValueError('Invalid release manifest fields')
        fields[key] = value
    if fields.get('format') != 'proofofwork-ui-release-v3' or not RELEASE.fullmatch(fields.get('release_id', '')):
        raise ValueError('Unsupported release provenance')
    return fields


def verified_release(path, archives):
    safe_path(path)
    fields = manifest(path)
    surface_fields = {key.split('.')[1] for key in fields if key.startswith('surface.') and key.endswith('.sha256')}
    surface_counts = {key.split('.')[1] for key in fields if key.startswith('surface.') and key.endswith('.file_count')}
    if frozenset(surface_fields) not in SURFACE_FAMILIES or surface_counts != surface_fields:
        raise ValueError('Incomplete release surface coverage')
    for surface in SURFACES - surface_fields:
        if os.path.lexists(path / ('proofofwork-' + surface)):
            raise ValueError('Undeclared release surface: ' + surface)
    for surface in sorted(surface_fields):
        base = path / ('proofofwork-' + surface)
        safe_path(base)
        files = []
        for root, dirs, names in os.walk(base, followlinks=False):
            for name in dirs + names:
                candidate = Path(root) / name
                safe_path(candidate, directory=False)
                if not candidate.is_dir() and not candidate.is_file():
                    raise ValueError('Unsupported release file')
            files.extend((Path(root) / name).relative_to(base).as_posix() for name in names)
        digest = hashlib.sha256()
        for name in sorted(files, key=lambda value: value.encode()):
            file = base / name
            digest.update(name.encode() + b'\0' + format(stat.S_IMODE(file.stat().st_mode), 'o').encode() + b'\0' + sha256(file).encode() + b'\n')
        if digest.hexdigest() != fields['surface.' + surface + '.sha256'] or len(files) != int(fields['surface.' + surface + '.file_count']):
            raise ValueError('Release surface fingerprint mismatch: ' + surface)
    archive_name = fields.get('archive_name', '')
    if archive_name != 'proofofwork-ui-release-' + fields['release_id'] + '.tgz':
        raise ValueError('Release archive name mismatch')
    archive = archives / archive_name
    safe_path(archive, directory=False)
    if not archive.is_file() or sha256(archive) != fields['archive_sha256']:
        raise ValueError('Release archive checksum mismatch')
    return fields


def passthrough_fingerprint(root):
    """Require non-release content in a retired root to remain in recovery."""
    managed = {'proofofwork-' + surface for surface in SURFACES}
    digest = hashlib.sha256()
    for path in sorted(root.rglob('*'), key=lambda value: os.fsencode(value.relative_to(root))):
        relative = path.relative_to(root)
        if relative.parts[0] in managed or relative.as_posix() == '.proofofwork-ui-release':
            continue
        safe_path(path, directory=False)
        if not path.is_dir() and not path.is_file():
            raise ValueError('Unsupported non-release recovery content')
        digest.update(os.fsencode(relative) + b'\0' + str(stat.S_IMODE(path.stat().st_mode)).encode() + b'\0')
        digest.update((sha256(path) if path.is_file() else 'directory').encode() + b'\n')
    return digest.hexdigest()


def rollback_plan(www, rollbacks, archives):
    current = verified_release(www, archives)
    latest = rollbacks / ('proofofwork-www-pre-' + current['release_id'])
    previous = verified_release(latest, archives)
    passthrough = {passthrough_fingerprint(www), passthrough_fingerprint(latest)}
    plan = []
    for path in sorted(rollbacks.iterdir()):
        if path == latest:
            continue
        safe_path(path)
        release = path.name.removeprefix('proofofwork-www-pre-')
        if not path.name.startswith('proofofwork-www-pre-') or not RELEASE.fullmatch(release):
            raise ValueError('Unexpected rollback entry')
        fields = manifest(path)
        fingerprint = passthrough_fingerprint(path)
        if fingerprint not in passthrough:
            raise ValueError('Retired rollback has unique non-release recovery content')
        plan.append({'path': str(path), 'class': 'redundant-rollback', 'manifest': fields, 'passthroughSha256': fingerprint})
    return current, previous, plan


def referenced_paths(plan):
    paths = [row['path'] for row in plan]
    def check(value):
        if any(value == path or value.startswith(path + '/') for path in paths):
            raise ValueError('Live process/config references cleanup candidate')
    for proc in Path('/proc').glob('[0-9]*'):
        for link in [proc / 'cwd', proc / 'root', proc / 'exe', *list((proc / 'fd').glob('*'))]:
            try:
                check(os.readlink(link).removesuffix(' (deleted)'))
            except OSError:
                continue
        try:
            command = (proc / 'cmdline').read_bytes()
            maps = (proc / 'maps').read_bytes()
        except OSError:
            continue
        if any(os.fsencode(path) in command or os.fsencode(path) in maps for path in paths):
            raise ValueError('Live process references cleanup candidate')
    for root in ['/etc/systemd/system', '/etc/caddy', '/var/www']:
        for path in Path(root).rglob('*'):
            if path.is_symlink():
                check(str(path.resolve()))
            elif root != '/var/www' and path.is_file() and path.stat().st_size < 1048576:
                data = path.read_bytes()
                if any(os.fsencode(candidate) in data for candidate in paths):
                    raise ValueError('Production config references cleanup candidate')
    for line in Path('/proc/self/mountinfo').read_text().splitlines():
        mount = line.split()[4]
        if any(mount == path or mount.startswith(path + '/') for path in paths):
            raise ValueError('Cleanup candidate contains a mount')


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--apply', action='store_true')
    options = parser.parse_args()
    hold = Path('/etc/proofofwork-retention/audit28.hold')
    if options.apply and (hold.exists() or hold.is_symlink()):
        raise ValueError('Persistent audit28 retention hold: exact manifest approval required')
    if os.geteuid() != 0:
        raise ValueError('Production retention requires root')
    www = Path('/var/www')
    rollbacks = Path('/var/backups/proofofwork-ui/rollback-roots')
    archives = Path('/var/backups/proofofwork-ui/releases')
    staging = Path('/var/tmp/proofofwork-deploy')
    evidence = Path('/var/backups/proofofwork-ui/cleanup-evidence')
    for path in [rollbacks, archives, staging, evidence, Path('/run/proofofwork-ui')]:
        safe_path(path)
    lock = Path('/run/proofofwork-ui/deploy.lock')
    safe_path(lock, directory=False)
    inherited = os.environ.get('POW_UI_DEPLOY_LOCK_FD', '')
    if inherited:
        if not inherited.isdecimal() or int(inherited) < 3 or Path('/proc/self/fd/' + inherited).resolve() != lock:
            raise ValueError('Invalid inherited deployment lock')
        stream = os.fdopen(os.dup(int(inherited)), 'a')
    else:
        stream = lock.open('a')
    with stream:
        fcntl.flock(stream, fcntl.LOCK_EX | fcntl.LOCK_NB)
        current, previous, plan = rollback_plan(www, rollbacks, archives)
        keep = {current['release_id'], previous['release_id']}
        verified_sources = {}
        for path in sorted(staging.iterdir()):
            match = STAGE.fullmatch(path.name)
            if not match or match[1] != 'source' or match[3] or not path.is_dir() or path.is_symlink():
                continue
            safe_path(path)
            git = ['/usr/bin/git', '-c', 'safe.directory=' + str(path), '-C', str(path)]
            environment = {'PATH': '/usr/bin:/bin', 'GIT_OPTIONAL_LOCKS': '0'}
            head = subprocess.run(git + ['rev-parse', 'HEAD'], env=environment, capture_output=True, text=True, timeout=10)
            status = subprocess.run(git + ['status', '--porcelain', '--untracked-files=all', '--ignored'], env=environment, capture_output=True, text=True, timeout=30)
            if head.returncode == 0 and status.returncode == 0 and head.stdout.strip().startswith(match[2].split('-')[0]) and all(line == '!! node_modules/' for line in status.stdout.splitlines()):
                verified_sources[match[2]] = head.stdout.strip()
        for path in sorted(staging.iterdir()):
            match = STAGE.fullmatch(path.name)
            if not match or match[2] in keep or match[2] not in verified_sources:
                continue
            safe_path(path, directory=False)
            if path.is_dir():
                if match[3]:
                    raise ValueError('Unexpected transport directory')
            elif not path.is_file():
                raise ValueError('Unsupported transport file')
            plan.append({'path': str(path), 'class': 'rebuildable-transport', 'sourceCommit': verified_sources[match[2]], 'sha256': sha256(path) if path.is_file() else None})
        if len(plan) > 256:
            raise ValueError('Retention plan exceeds safety cap')
        referenced_paths(plan)
        receipt = {'time': datetime.datetime.now(datetime.timezone.utc).isoformat(), 'mode': 'apply' if options.apply else 'dry-run', 'preservedReleases': sorted(keep), 'plan': plan}
        if options.apply and plan:
            target = evidence / ('verified-retention-' + datetime.datetime.now(datetime.timezone.utc).strftime('%Y%m%dT%H%M%S.%fZ') + '.json')
            with target.open('x') as output:
                os.chmod(target, 0o600)
                json.dump(receipt, output, indent=2)
                output.flush()
                os.fsync(output.fileno())
            directory = os.open(evidence, os.O_DIRECTORY)
            os.fsync(directory)
            os.close(directory)
            for row in plan:
                path = Path(row['path'])
                safe_path(path, directory=False)
                shutil.rmtree(path) if path.is_dir() else path.unlink()
        print(json.dumps({'ok': True, 'mode': receipt['mode'], 'candidatePaths': len(plan), 'preservedReleases': sorted(keep)}))


if __name__ == '__main__':
    main()
