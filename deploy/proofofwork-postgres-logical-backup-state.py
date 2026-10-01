#!/usr/bin/python3
"""Read actual scheduled/manual backup state without creating a dump or a lock."""
import argparse
import datetime
import fcntl
import json
import os
from pathlib import Path
import subprocess

UNIT = 'proofofwork-postgres-logical-backup.service'
ROOT = Path('/data/proofofwork-postgres-backups/logical')
FIELDS = ('Type', 'LoadState', 'ActiveState', 'SubState', 'MainPID', 'Result',
          'ExecMainStartTimestamp', 'ExecMainExitTimestamp', 'MemoryPeak',
          'MemoryHigh', 'MemoryMax', 'CPUQuotaPerSecUSec', 'TasksMax',
          'TimeoutStartUSec', 'TimeoutStopUSec', 'KillMode')


def classify_state(unit, dump_pids, temporary_sets, lock_available):
    reasons = []
    if unit.get('Type') != 'oneshot' or unit.get('LoadState') != 'loaded':
        reasons.append('actual-backup-unit-unavailable')
    if unit.get('ActiveState') != 'inactive' or unit.get('MainPID') != '0':
        reasons.append('actual-backup-unit-not-quiet')
    if dump_pids:
        reasons.append('logical-dump-process-present')
    if not lock_available:
        reasons.append('backup-lock-held-or-unreadable')
    if temporary_sets:
        reasons.append('incomplete-or-writing-backup-set-needs-review')
    return {'quiet': not reasons, 'reasons': reasons, 'unit': UNIT,
            'unitState': unit, 'logicalDumpProcessIds': dump_pids,
            'temporarySets': temporary_sets, 'backupLockAvailable': lock_available,
            'productionMutation': False, 'scope': 'Actual unit, process identities, incomplete paths and shared lock only; no backup validation or restore.'}


def collect():
    result = subprocess.run(['/usr/bin/systemctl', 'show', UNIT, '--property=' + ','.join(FIELDS)],
                            text=True, capture_output=True, check=True, timeout=5)
    unit = dict(line.split('=', 1) for line in result.stdout.splitlines() if '=' in line)
    pids = []
    for process in Path('/proc').iterdir():
        if not process.name.isdecimal():
            continue
        try:
            if (process / 'comm').read_text().strip() in ('pg_dump', 'pg_dumpall'):
                pids.append(int(process.name))
        except FileNotFoundError:
            continue
        # Unreadable process identity is an incomplete preflight, not quiet.
    temporary = sorted(str(path) for path in ROOT.glob('.*.dumpset.tmp'))
    lock = ROOT / '.proofofwork-postgres-logical-backup.lock'
    lock_available = False
    try:
        if lock.is_symlink() or lock.resolve() != lock:
            raise ValueError('Noncanonical backup lock')
        descriptor = os.open(lock, os.O_RDONLY | os.O_NOFOLLOW)
        try:
            fcntl.flock(descriptor, fcntl.LOCK_SH | fcntl.LOCK_NB)
            lock_available = True
        finally:
            os.close(descriptor)
    except (OSError, ValueError):
        pass
    return {'observedUtc': datetime.datetime.now(datetime.timezone.utc).isoformat(),
            **classify_state(unit, sorted(pids), temporary, lock_available)}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--require-quiet', action='store_true')
    args = parser.parse_args()
    try:
        result = collect()
    except (OSError, ValueError, subprocess.SubprocessError) as error:
        result = {'quiet': False, 'reasons': ['backup-state-read-failed'],
                  'errorClass': type(error).__name__, 'productionMutation': False}
    print(json.dumps(result, sort_keys=True))
    return 75 if args.require_quiet and not result['quiet'] else 0


if __name__ == '__main__':
    raise SystemExit(main())
