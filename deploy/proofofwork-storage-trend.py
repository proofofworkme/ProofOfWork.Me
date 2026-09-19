#!/usr/bin/python3 -I
"""Read existing storage observations; forecast reserve exhaustion, never prune."""
import datetime
import json
import os
import re
import subprocess
import sys
import time

DAY = 86400
PATTERN = re.compile(r'^storage target=(\S+) filesystem=\S+ used_percent=\d+ inode_used_percent=\d+ available_bytes=(\d+) available_inodes=\d+$')


def forecast(samples, now, available, reserve):
    """Use the larger observed 1-day/7-day net consumption, with integer bytes."""
    samples = sorted((int(t), int(b)) for t, b in samples if now - 8 * DAY <= t <= now and b >= 0)
    rates = []
    windows = []
    for days in (1, 7):
        # Require an observation close to the window boundary, not a misleading
        # extrapolation from a deployment-sized five-minute interval.
        candidates = [(t, b) for t, b in samples if abs((now - t) - days * DAY) <= 3600]
        if not candidates:
            continue
        t, before = min(candidates, key=lambda item: abs(now - item[0] - days * DAY))
        elapsed = now - t
        if elapsed <= 0:
            continue
        consumed = max(0, before - available)
        per_day = (consumed * DAY + elapsed - 1) // elapsed
        rates.append(per_day)
        windows.append({'days': days, 'elapsedSeconds': elapsed, 'netConsumedBytes': before - available})
    rate = max(rates, default=0)
    runway = max(0, available - reserve)
    seconds = runway * DAY // rate if rate else None
    status = 'critical' if available < reserve or (seconds is not None and seconds <= DAY) else 'warning' if seconds is not None and seconds <= 7 * DAY else 'ok' if windows else 'insufficient-history'
    return {'status': status, 'availableBytes': available, 'reserveBytes': reserve,
            'headroomBytes': runway, 'netConsumptionBytesPerDay': rate if windows else None,
            'secondsToReserve': seconds, 'windows': windows,
            'limitation': 'Net historical consumption; sudden growth and future backup bursts can exceed this estimate.'}


def main():
    assert sys.flags.isolated and os.geteuid() == 0 and sys.argv[1:] in (['ui'], ['node'])
    role = sys.argv[1]
    unit = 'proofofwork-' + role + '-storage-health.service'
    now = int(time.time())
    # Existing five-minute observations avoid a second mutable state database.
    result = subprocess.run(['/usr/bin/journalctl', '--unit=' + unit, '--since=8 days ago',
                             '--output=json', '--no-pager', '--lines=12000'],
                            capture_output=True, timeout=30, check=True)
    assert len(result.stdout) <= 32 * 1024**2, 'Journal observation budget exceeded'
    samples = {}
    for line in result.stdout.splitlines():
        row = json.loads(line)
        message = row.get('MESSAGE')
        match = PATTERN.fullmatch(message) if isinstance(message, str) else None
        if match:
            samples.setdefault(match[1], []).append((int(row['__REALTIME_TIMESTAMP']) // 1000000, int(match[2])))
    targets = {'/': 10 * 1024**3}
    if role == 'node':
        targets['/data'] = 100 * 1024**3
    severity = 0
    for target, reserve in targets.items():
        mount = subprocess.check_output(['/usr/bin/findmnt', '-n', '-o', 'TARGET', '--target', target], text=True, timeout=5).strip()
        assert mount == target, 'Expected mount missing: ' + target
        stat = os.statvfs(target)
        item = forecast(samples.get(target, []), now, stat.f_bavail * stat.f_frsize, reserve)
        print(json.dumps({'event': 'storage-growth-forecast', 'role': role, 'target': target,
                          'at': datetime.datetime.now(datetime.timezone.utc).isoformat(), **item}), flush=True)
        severity = max(severity, {'critical': 2, 'warning': 1, 'insufficient-history': 1, 'ok': 0}[item['status']])
    # Attribute current allocation separately. Values must not be summed: hard
    # links and recovery copies may share blocks. No path is a cleanup candidate.
    paths = ['/var/backups/proofofwork-ui', '/var/tmp/proofofwork-deploy', '/var/www', '/var/log'] if role == 'ui' else [
        '/data/proofofwork-postgres-backups', '/data/proofofwork-postgres-tablespaces',
        '/data/proofofwork-api-cache', '/var/log']
    for path in paths:
        if not os.path.isdir(path):
            print(json.dumps({'event': 'storage-allocation', 'path': path, 'status': 'absent'}), flush=True)
            continue
        try:
            measured = subprocess.run(['/usr/bin/du', '--one-file-system', '--summarize', '--block-size=1', path], capture_output=True, timeout=30, check=True)
            allocated = int(measured.stdout.split()[0])
            print(json.dumps({'event': 'storage-allocation', 'path': path, 'allocatedBytes': allocated, 'status': 'measured'}), flush=True)
        except (subprocess.SubprocessError, ValueError):
            print(json.dumps({'event': 'storage-allocation', 'path': path, 'status': 'incomplete'}), flush=True)
            severity = max(severity, 1)
    return severity


if __name__ == '__main__':
    sys.exit(main())
