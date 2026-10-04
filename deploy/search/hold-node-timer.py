#!/usr/bin/python3 -I
"""Hold only Search projection around the unchanged audited Node controller.

Future Node operators call hold before their managed controller and restore in
finally, passing the same immutable receipt and installed service/timer hashes.
No enablement, authority service, economic service or existing timer is changed.
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

SERVICE = 'proofofwork-search-index.service'
TIMER = 'proofofwork-search-index.timer'
UNITS = Path('/etc/systemd/system')
LOCK = Path('/run/proofofwork-search-release.lock')
HOLD = Path('/run/proofofwork-search-release.hold')
BASE = Path('/var/tmp/proofofwork-deploy')
KEEP = ['bitcoind.service', 'electrs.service', 'postgresql@16-main.service']
TIMERS = ['pg_basebackup@16-main.timer', 'pg_compresswal@16-main.timer',
          'proofofwork-cache-prune.timer', 'proofofwork-node-release-health.timer',
          'proofofwork-node-release-prune.timer', 'proofofwork-postgres-logical-backup.timer',
          'proofofwork-postgres-query-health.timer', 'proofofwork-worker-recovery-watch.timer']
ENV = {'PATH': '/usr/sbin:/usr/bin:/sbin:/bin', 'LC_ALL': 'C'}


def require(value, message):
    if not value:
        raise ValueError(message)


def identity(details):
    return tuple(getattr(details, key) for key in ('st_dev', 'st_ino', 'st_mode',
        'st_uid', 'st_gid', 'st_nlink', 'st_size', 'st_mtime_ns', 'st_ctime_ns'))


def safe_read(path, limit=65536):
    path = Path(path); before = path.lstat()
    require(path.is_absolute() and path.resolve(strict=True) == path and
        stat.S_ISREG(before.st_mode) and before.st_uid == before.st_gid == 0 and
        before.st_nlink == 1 and not before.st_mode & 0o7022 and before.st_size <= limit,
        'Unsafe or oversized Search hold input')
    descriptor = os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK | os.O_NOATIME)
    with os.fdopen(descriptor, 'rb') as stream:
        require(identity(os.fstat(stream.fileno())) == identity(before), 'Input changed')
        raw = stream.read(limit+1)
        require(identity(os.fstat(stream.fileno())) == identity(before), 'Input changed')
    require(identity(path.lstat()) == identity(before) and len(raw) == before.st_size, 'Input changed')
    return raw


def safe_directory(path):
    details = path.lstat()
    require(path.is_absolute() and path.resolve(strict=True) == path and
        stat.S_ISDIR(details.st_mode) and details.st_uid == details.st_gid == 0 and
        not details.st_mode & 0o7022, 'Unsafe Search hold directory')


def record(path, value):
    raw = (json.dumps(value, sort_keys=True, indent=2)+'\n').encode()
    descriptor = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)
    with os.fdopen(descriptor, 'wb') as stream:
        stream.write(raw); stream.flush(); os.fsync(stream.fileno())
    return hashlib.sha256(raw).hexdigest()


def systemctl(arguments):
    result = subprocess.run(['/usr/bin/systemctl', *arguments], env=ENV,
        stdin=subprocess.DEVNULL, capture_output=True, timeout=30)
    require(result.returncode == 0 and len(result.stdout) <= 65536 and len(result.stderr) <= 65536,
        'Search hold systemctl failed')
    return result.stdout.decode('utf-8')


def state(name, fields):
    result = dict(line.split('=', 1) for line in systemctl(['show', name,
        *['--property='+field for field in fields]]).splitlines() if '=' in line)
    require(set(result) == set(fields), 'Incomplete unit state')
    return result


def baseline():
    return {'authority': {name: state(name, ['ActiveState', 'MainPID']) for name in KEEP},
            'timers': {name: state(name, ['ActiveState', 'UnitFileState']) for name in TIMERS}}


def check_units(pins):
    require(set(pins) == {SERVICE, TIMER} and
        all(re.fullmatch('[0-9a-f]{64}', value) for value in pins.values()), 'Exact unit hashes required')
    for name, expected in pins.items():
        require(hashlib.sha256(safe_read(UNITS/name)).hexdigest() == expected, 'Search unit bytes differ')


def restore_activation(prior):
    current = state(TIMER, ['ActiveState', 'UnitFileState'])
    require(current['UnitFileState'] == prior['UnitFileState'], 'Search timer enablement changed')
    if prior['ActiveState'] == 'active':
        systemctl(['start', TIMER])
    elif current['ActiveState'] != 'inactive':
        systemctl(['stop', TIMER])
    require(state(TIMER, ['ActiveState', 'UnitFileState']) == prior, 'Search activation was not restored')


def apply(phase, root, bindings):
    check_units(bindings['files'])
    if phase == 'hold':
        require(not os.path.lexists(root) and not os.path.lexists(HOLD), 'Another Search hold exists')
        original = baseline()
        timer = state(TIMER, ['ActiveState', 'UnitFileState'])
        require(timer['ActiveState'] in ('active', 'inactive') and
            timer['UnitFileState'] in ('enabled', 'disabled'), 'Unexpected Search timer state')
        root.mkdir(mode=0o700)
        record(root/'intent.json', {**bindings, 'baseline': original, 'timer': timer})
        marker = {**bindings, 'evidence': str(root)}
        marker_sha = record(HOLD, marker)
        try:
            systemctl(['stop', TIMER])
            systemctl(['stop', SERVICE])
            require(state(TIMER, ['ActiveState', 'UnitFileState']) ==
                {**timer, 'ActiveState': 'inactive'}, 'Search timer did not stop')
            service = state(SERVICE, ['ActiveState', 'MainPID'])
            require(service['ActiveState'] in ('inactive', 'failed') and service['MainPID'] == '0',
                'Search projection is still running')
            require(baseline() == original, 'Authority or existing timers changed')
            record(root/'held.json', {**marker, 'ok': True, 'markerSha256': marker_sha,
                'baseline': original, 'timer': timer})
        except BaseException as error:
            record(root/'failed.json', {'ok': False, 'errorClass': type(error).__name__})
            restored = False
            try:
                restore_activation(timer)
                require(baseline() == original, 'Existing state changed')
                require(hashlib.sha256(safe_read(HOLD)).hexdigest() == marker_sha, 'Hold marker changed')
                HOLD.unlink(); restored = True
            finally:
                record(root/'rollback.json', {'ok': restored})
            raise
    else:
        safe_directory(root)
        held = json.loads(safe_read(root/'held.json'))
        require(held.get('ok') is True and all(held.get(key) == value for key, value in bindings.items()),
            'Hold receipt belongs to another release')
        require(hashlib.sha256(safe_read(HOLD)).hexdigest() == held['markerSha256'] and
            json.loads(safe_read(HOLD)) == {**bindings, 'evidence': str(root)}, 'Active Search hold differs')
        require(not os.path.lexists(root/'restored.json'), 'Search hold already restored')
        try:
            require(baseline() == held['baseline'], 'Authority or existing timers changed')
            restore_activation(held['timer'])
            require(baseline() == held['baseline'], 'Authority or existing timers changed')
            record(root/'restored.json', {**bindings, 'ok': True, 'timer': held['timer']})
            HOLD.unlink()
        except BaseException as error:
            attempt = 0
            while os.path.lexists(root/('restore-failed-'+str(attempt)+'.json')):
                attempt += 1
            record(root/('restore-failed-'+str(attempt)+'.json'),
                {'ok': False, 'errorClass': type(error).__name__})
            raise
    return {'ok': True, 'phase': phase, 'evidence': str(root), **bindings}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--phase', choices=['hold', 'restore'], required=True)
    parser.add_argument('--release-id', required=True)
    parser.add_argument('--attempt', default='initial')
    parser.add_argument('--service-sha256', required=True)
    parser.add_argument('--timer-sha256', required=True)
    args = parser.parse_args()
    require(sys.flags.isolated and os.geteuid() == 0, 'Root and python3 -I required')
    require(re.fullmatch('[0-9a-f]{12}-[0-9]{8}T[0-9]{6}Z', args.release_id) and
        re.fullmatch('[a-z0-9][a-z0-9-]{0,24}', args.attempt), 'Invalid hold identity')
    os.umask(0o077); safe_directory(BASE)
    descriptor = os.open(LOCK, os.O_RDWR | os.O_CREAT | os.O_NOFOLLOW, 0o600)
    try:
        safe_read(LOCK); fcntl.flock(descriptor, fcntl.LOCK_EX | fcntl.LOCK_NB)
        root = BASE/('search-timer-hold-'+args.release_id+'-'+args.attempt)
        bindings = {'releaseId': args.release_id, 'attempt': args.attempt,
                    'files': {SERVICE: args.service_sha256, TIMER: args.timer_sha256}}
        print(json.dumps(apply(args.phase, root, bindings)))
    finally:
        os.close(descriptor)


if __name__ == '__main__':
    try:
        main()
    except BaseException as error:
        print(json.dumps({'ok': False, 'errorClass': type(error).__name__}))
        sys.exit(1)
