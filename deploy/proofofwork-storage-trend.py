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
GIB = 1024**3
PATTERN = re.compile(r'^storage target=(\S+) filesystem=\S+ used_percent=\d+ inode_used_percent=\d+ available_bytes=(\d+) available_inodes=\d+$')

ALLOCATION_POLICIES = {
    'ui': [
        {'path': '/var/backups/proofofwork-ui', 'reviewBytes': 16 * GIB, 'criticalBytes': 32 * GIB,
         'label': 'ui-release-and-rollback-evidence'},
        {'path': '/var/tmp/proofofwork-deploy', 'reviewBytes': 1 * GIB, 'criticalBytes': 8 * GIB,
         'label': 'ui-deploy-scratch'},
        {'path': '/var/www', 'reviewBytes': 4 * GIB, 'criticalBytes': 16 * GIB,
         'label': 'ui-live-and-staged-surfaces'},
        {'path': '/var/log', 'reviewBytes': 2 * GIB, 'criticalBytes': 8 * GIB,
         'label': 'system-and-application-logs'},
    ],
    'node': [
        {'path': '/data/proofofwork-postgres-backups', 'reviewBytes': 128 * GIB, 'criticalBytes': 256 * GIB,
         'label': 'node-postgres-backups'},
        {'path': '/data/proofofwork-postgres-tablespaces', 'reviewBytes': 256 * GIB, 'criticalBytes': 512 * GIB,
         'label': 'node-postgres-tablespaces'},
        {'path': '/data/proofofwork-api-cache', 'reviewBytes': 32 * GIB, 'criticalBytes': 96 * GIB,
         'label': 'node-api-cache'},
        {'path': '/data/proofofwork-backups', 'reviewBytes': 64 * GIB, 'criticalBytes': 128 * GIB,
         'label': 'node-general-backups'},
        {'path': '/data/proofofwork-release-backups', 'reviewBytes': 8 * GIB, 'criticalBytes': 32 * GIB,
         'label': 'node-release-backups'},
        {'path': '/var/log', 'reviewBytes': 2 * GIB, 'criticalBytes': 8 * GIB,
         'label': 'system-and-application-logs'},
    ],
}


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


def allocation_report(policy, allocated):
    review = int(policy.get('reviewBytes') or 0)
    critical = int(policy.get('criticalBytes') or 0)
    status = 'measured'
    severity = 0
    if critical and allocated >= critical:
        status = 'critical-review'
        severity = 2
    elif review and allocated >= review:
        status = 'review'
        severity = 1
    report = {'event': 'storage-allocation', 'path': policy['path'],
              'label': policy.get('label', 'unclassified'), 'allocatedBytes': allocated,
              'status': status, 'cleanupApproved': False}
    if review:
        report['reviewBytes'] = review
    if critical:
        report['criticalBytes'] = critical
    if severity:
        report['reviewRequired'] = True
        report['reason'] = 'allocation-threshold-crossed'
        report['note'] = 'Review dependencies before any cleanup; this measurement alone does not approve deletion.'
    return severity, report


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
    for policy in ALLOCATION_POLICIES[role]:
        path = policy['path']
        if not os.path.isdir(path):
            print(json.dumps({'event': 'storage-allocation', 'path': path,
                              'label': policy.get('label', 'unclassified'),
                              'status': 'absent', 'cleanupApproved': False}), flush=True)
            continue
        try:
            measured = subprocess.run(['/usr/bin/du', '--one-file-system', '--summarize', '--block-size=1', path], capture_output=True, timeout=30, check=True)
            allocated = int(measured.stdout.split()[0])
            allocation_severity, report = allocation_report(policy, allocated)
            print(json.dumps(report), flush=True)
            severity = max(severity, allocation_severity)
        except (subprocess.SubprocessError, ValueError):
            print(json.dumps({'event': 'storage-allocation', 'path': path,
                              'label': policy.get('label', 'unclassified'),
                              'status': 'incomplete', 'cleanupApproved': False,
                              'reviewRequired': True}), flush=True)
            severity = max(severity, 1)
    return severity


if __name__ == '__main__':
    sys.exit(main())
