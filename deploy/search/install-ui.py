#!/usr/bin/python3 -I
"""Promote exact Search UI helpers or Caddy config, retaining every prior byte.

Helpers go first. Caddy reload requires the exact nineteen-root release to be
serving and verified. Both phases use the shared deploy lock; timers, holds,
historical trees and application services remain protected.
"""
import argparse
import fcntl
import hashlib
import json
import os
from pathlib import Path
import re
import stat
import subprocess
import sys

FILES = {
    'deploy/proofofwork-ui-release-stage.py': '/usr/local/sbin/proofofwork-ui-release-stage',
    'deploy/proofofwork-ui-release-provenance.sh': '/usr/local/sbin/proofofwork-ui-release-provenance',
    'deploy/proofofwork-ui-release-publish.sh': '/usr/local/sbin/proofofwork-ui-release-publish',
    'deploy/Caddyfile': '/etc/caddy/Caddyfile',
}
SURFACES = 'activity boost browser code computer desktop dns growth id inception infinity landing marketplace nft publish search token wallet work'.split()
CAPACITY = Path('/usr/local/sbin/proofofwork-ui-capacity')
RETAINED = Path('/usr/local/sbin/proofofwork-ui-retained-root')
CADDY = Path('/usr/bin/caddy')
LOCK = Path('/run/proofofwork-ui/deploy.lock')
PRUNE = ['proofofwork-ui-release-prune.timer', 'proofofwork-ui-storage-prune.timer']
TIMERS = [*PRUNE, 'proofofwork-ui-release-provenance.timer']
ENV = {'PATH': '/usr/sbin:/usr/bin:/sbin:/bin', 'LC_ALL': 'C', 'GIT_OPTIONAL_LOCKS': '0'}
HEX64 = re.compile('[0-9a-f]{64}')


def require(condition, message):
    if not condition:
        raise ValueError(message)


def digest(raw):
    return hashlib.sha256(raw).hexdigest()


def stamp(details):
    return tuple(getattr(details, key) for key in ('st_dev', 'st_ino', 'st_mode',
        'st_nlink', 'st_uid', 'st_gid', 'st_size', 'st_mtime_ns', 'st_ctime_ns'))


def read_safe(path, limit=2*1024**2, *, owner=0, shared=False):
    path = Path(path); before = path.lstat()
    require(path.is_absolute() and path.resolve(strict=True) == path and
        stat.S_ISREG(before.st_mode) and before.st_uid == before.st_gid == owner and
        (shared or before.st_nlink == 1) and not before.st_mode & 0o7022 and before.st_size <= limit,
        'Unsafe or oversized input: ' + path.name)
    descriptor = os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK | os.O_NOATIME)
    with os.fdopen(descriptor, 'rb') as stream:
        require(stamp(os.fstat(stream.fileno())) == stamp(before), 'Input changed before reading')
        raw = stream.read(limit+1)
        require(stamp(os.fstat(stream.fileno())) == stamp(before), 'Input changed during reading')
    require(stamp(path.lstat()) == stamp(before) and len(raw) == before.st_size, 'Input changed after reading')
    return raw, before


def directory(path):
    details = path.lstat()
    require(path.is_absolute() and path.resolve(strict=True) == path and
        stat.S_ISDIR(details.st_mode) and details.st_uid == details.st_gid == 0 and
        not details.st_mode & 0o7022, 'Unsafe directory: ' + path.name)


def check_plan(plan):
    require(plan['schema'] == 'proof-of-work-search-ui-install-v1', 'Wrong installation schema')
    require(re.fullmatch('[0-9a-f]{40}', plan['commit']) and re.fullmatch('[0-9a-f]{40}', plan['tree']),
        'Installation must pin full application commit/tree')
    require(re.fullmatch('[0-9a-f]{12}-[0-9]{8}T[0-9]{6}Z', plan['releaseId']) and
        plan['releaseId'].startswith(plan['commit'][:12]+'-'), 'Wrong release identity')
    require(set(plan['files']) == set(FILES), 'Installation scope differs from Search allowlist')
    for row in plan['files'].values():
        require(set(row) == {'beforeSha256', 'afterSha256'} and
            all(HEX64.fullmatch(value) for value in row.values()), 'Missing exact before/after file pins')
    for name in ('capacitySha256', 'retainedSha256', 'caddyBinarySha256'):
        require(HEX64.fullmatch(plan[name]), 'Missing exact support-tool pin')
    require(type(plan['caddyVersion']) is str and re.fullmatch(r'[0-9]+\.[0-9]+\.[0-9]+',
        plan['caddyVersion']), 'Caddy version must match its exact numeric version')


def parse_manifest(raw):
    lines = raw.decode('utf-8').splitlines()
    require(all('=' in line for line in lines) and
        len(lines) == len(set(line.split('=', 1)[0] for line in lines)), 'Duplicate or malformed active manifest')
    return dict(line.split('=', 1) for line in lines)


def check_published(raw, plan):
    manifest = parse_manifest(raw)
    require(manifest.get('format') == 'proofofwork-ui-release-v3' and
        manifest.get('release_id') == plan['releaseId'] and manifest.get('commit') == plan['commit'] and
        manifest.get('source_tree') == plan['tree'], 'Caddy requires the exact published Search release')
    names = {key.split('.')[1] for key in manifest if key.startswith('surface.')}
    require(names == set(SURFACES), 'Caddy requires all nineteen managed roots')
    for name in SURFACES:
        require(HEX64.fullmatch(manifest.get('surface.'+name+'.sha256', '')) and
            re.fullmatch('[1-9][0-9]*', manifest.get('surface.'+name+'.file_count', '')),
            'Incomplete published surface evidence')
    for field in ('sha256', 'file_count'):
        require(manifest['surface.computer.'+field] == manifest['surface.nft.'+field],
            'NFT alias must retain exact Computer evidence')


def run(argv, descriptor, *, timeout=120):
    result = subprocess.run(argv, env={**ENV, 'POW_UI_DEPLOY_LOCK_FD': str(descriptor)},
        stdin=subprocess.DEVNULL, capture_output=True, text=True, timeout=timeout,
        pass_fds=(descriptor,))
    require(result.returncode == 0, 'Guarded operation failed: '+Path(argv[0]).name)
    return result.stdout.strip()


def states(descriptor):
    return {name: dict(line.split('=', 1) for line in run(['/usr/bin/systemctl', 'show', name,
        '-p', 'LoadState', '-p', 'ActiveState', '-p', 'MainPID', '-p', 'UnitFileState'],
        descriptor, timeout=15).splitlines() if '=' in line) for name in ['caddy.service', *TIMERS]}


def sync_directory(path):
    descriptor = os.open(path, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
    try:
        os.fsync(descriptor)
    finally:
        os.close(descriptor)


def save(path, raw, mode=0o600):
    descriptor = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, mode)
    with os.fdopen(descriptor, 'wb') as output:
        output.write(raw); output.flush(); os.fsync(output.fileno())
    os.chmod(path, mode); sync_directory(path.parent)


def replace(path, raw, mode, token):
    temporary = path.parent / ('.'+path.name+'.search-'+token)
    save(temporary, raw, mode); os.replace(temporary, path); sync_directory(path.parent)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--phase', choices=('helpers', 'caddy'), required=True)
    parser.add_argument('--source', type=Path, required=True)
    parser.add_argument('--manifest', type=Path, required=True)
    parser.add_argument('--manifest-sha256', required=True)
    parser.add_argument('--attempt', default='initial')
    args = parser.parse_args()
    require(sys.flags.isolated and os.geteuid() == os.getegid() == 0, 'Use isolated root Python')
    require(re.fullmatch('[a-z0-9][a-z0-9-]{0,30}', args.attempt), 'Fresh attempt name required')
    raw, _ = read_safe(args.manifest, 65536)
    require(HEX64.fullmatch(args.manifest_sha256) and digest(raw) == args.manifest_sha256,
        'Installation manifest hash differs')
    plan = json.loads(raw); check_plan(plan)
    require(args.source == Path('/var/tmp/proofofwork-deploy/search-tools-'+plan['releaseId']),
        'Source must use the exact release-bound private tools namespace')
    directory(args.source); directory(args.source/'deploy')
    for path, pin in ((CAPACITY, 'capacitySha256'), (RETAINED, 'retainedSha256')):
        require(digest(read_safe(path)[0]) == plan[pin], 'Support-tool bytes differ')
    read_safe(Path('/etc/proofofwork-retention/audit28.hold'))
    _, details = read_safe(LOCK, 0)
    descriptor = os.open(LOCK, os.O_RDONLY | os.O_NOFOLLOW)
    require(stamp(os.fstat(descriptor)) == stamp(details), 'Deploy lock changed')
    fcntl.flock(descriptor, fcntl.LOCK_EX | fcntl.LOCK_NB)
    try:
        baseline = states(descriptor)
        require(baseline['caddy.service']['ActiveState'] == 'active', 'Caddy must keep serving')
        require(all(baseline[name]['LoadState'] == 'masked' and
            baseline[name]['ActiveState'] == 'inactive' for name in PRUNE), 'Retention holds differ')
        namespace = {'__name__': '_search_install_retained_root'}
        retained_source = read_safe(RETAINED)[0]
        require(digest(retained_source) == plan['retainedSha256'], 'Retained-root helper changed')
        exec(compile(retained_source, str(RETAINED), 'exec'), namespace)
        live = namespace['fingerprint'](Path('/var/www'))
        roots = sorted(Path('/var/backups/proofofwork-ui/rollback-roots').glob('proofofwork-www-pre-*'))
        require(len(roots) <= 16, 'Retained root count exceeds existing protection bound')
        retained = [namespace['fingerprint'](root) for root in roots]
        selected = [name for name in FILES if (name == 'deploy/Caddyfile') == (args.phase == 'caddy')]
        before, after = {}, {}
        for name in selected:
            blob, _ = read_safe(args.source/name)
            target = Path(FILES[name]); directory(target.parent)
            prior, info = read_safe(target)
            require(digest(blob) == plan['files'][name]['afterSha256'] and
                digest(prior) == plan['files'][name]['beforeSha256'], 'Reviewed before/after bytes differ')
            before[name] = (prior, stat.S_IMODE(info.st_mode)); after[name] = blob
        if args.phase == 'caddy':
            check_published(read_safe(Path('/var/www/.proofofwork-ui-release'), 65536)[0], plan)
            for name in FILES:
                if name != 'deploy/Caddyfile':
                    require(digest(read_safe(Path(FILES[name]))[0]) == plan['files'][name]['afterSha256'],
                        'Search helper promotion must precede Caddy')
            for name in SURFACES:
                directory(Path('/var/www/proofofwork-'+name))
                read_safe(Path('/var/www/proofofwork-'+name+'/index.html'), shared=True)
            run([FILES['deploy/proofofwork-ui-release-provenance.sh'], 'verify'], descriptor, timeout=600)
            require(digest(read_safe(CADDY, 128*1024**2)[0]) == plan['caddyBinarySha256'], 'Caddy binary differs')
            require(run([str(CADDY), 'version'], descriptor).split()[0] == plan['caddyVersion'], 'Caddy version differs')
            run([str(CADDY), 'validate', '--config', str(args.source/'deploy/Caddyfile'), '--adapter', 'caddyfile'], descriptor)
        parent = Path('/var/backups/proofofwork-ui/release-tooling'); directory(parent)
        output = parent / ('search-'+plan['releaseId']+'-'+args.phase+'-'+args.attempt)
        require(not os.path.lexists(output), 'Never reuse an installation receipt namespace')
        require(digest(read_safe(CAPACITY)[0]) == plan['capacitySha256'], 'Capacity helper changed')
        run(['/usr/bin/python3', '-I', '-B', str(CAPACITY), 'check', '--path', str(parent),
            '--additional-bytes', str(16*1024**2), '--additional-inodes', '64', '--phase',
            'search-'+args.phase+'-install'], descriptor)
        output.mkdir(mode=0o700); sync_directory(parent)
        for i, name in enumerate(selected):
            save(output/(str(i)+'.previous'), before[name][0])
        save(output/'intent.json', (json.dumps({'phase': args.phase, 'manifestSha256': args.manifest_sha256,
            'baseline': baseline, 'live': live, 'retained': retained,
            'previous': [{'source': name, 'destination': FILES[name], 'backup': str(i)+'.previous',
                'sha256': digest(before[name][0]), 'mode': before[name][1]} for i, name in enumerate(selected)]}, indent=2)+'\n').encode())
        installed = []
        try:
            for name in selected:
                target = Path(FILES[name])
                require(read_safe(target)[0] == before[name][0], 'Destination changed after preflight')
                installed.append(name)
                replace(target, after[name], 0o644 if name == 'deploy/Caddyfile' else 0o755, output.name)
                require(read_safe(target)[0] == after[name], 'Installed bytes differ')
            if args.phase == 'caddy':
                run(['/usr/bin/systemctl', 'reload', 'caddy.service'], descriptor)
            require(states(descriptor) == baseline, 'Serving process or held timer changed')
            require(namespace['fingerprint'](Path('/var/www')) == live and
                roots == sorted(Path('/var/backups/proofofwork-ui/rollback-roots').glob('proofofwork-www-pre-*')) and
                [namespace['fingerprint'](root) for root in roots] == retained, 'Serving or retained roots changed')
            save(output/'completed.json', (json.dumps({'status': 'completed', 'phase': args.phase,
                'installed': [{'path': FILES[name], 'sha256': digest(after[name])} for name in installed],
                'retainedRootsUnchanged': True, 'servingRootUnchanged': True, 'timersUnchanged': True}, indent=2)+'\n').encode())
        except Exception as error:
            save(output/'failure.json', (json.dumps({'status': 'failed', 'errorClass': type(error).__name__,
                'installed': installed})+'\n').encode())
            for name in reversed(installed):
                target = Path(FILES[name]); current = read_safe(target)[0]
                require(current in (before[name][0], after[name]), 'Unknown installed bytes require inspection')
                if current != before[name][0]:
                    replace(target, before[name][0], before[name][1], output.name+'-rollback')
            if args.phase == 'caddy':
                run(['/usr/bin/systemctl', 'reload', 'caddy.service'], descriptor)
            raise
        print(json.dumps({'status': 'completed', 'phase': args.phase, 'receipt': str(output)}))
    finally:
        os.close(descriptor)


if __name__ == '__main__':
    main()
