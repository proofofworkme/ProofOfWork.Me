#!/usr/bin/env python3
"""Boundary and burst tests for reserve forecasts; no production access."""
import contextlib
import io
import json
import runpy
from types import SimpleNamespace
from unittest.mock import patch

module = runpy.run_path('deploy/proofofwork-storage-trend.py')
forecast, allocation_report, day = module['forecast'], module['allocation_report'], module['DAY']
now = 10 * day
reserve = 100
assert forecast([], now, 200, reserve)['status'] == 'insufficient-history'
assert forecast([(now-300, 10000)], now, 200, reserve)['status'] == 'insufficient-history'
assert forecast([], now, 99, reserve)['status'] == 'critical'
assert forecast([(now-day, 1000)], now, 1100, reserve)['secondsToReserve'] is None
assert forecast([(now-day, 300)], now, 200, reserve)['status'] == 'critical'
assert forecast([(now-day, 300)], now, 201, reserve)['status'] == 'warning'
result = forecast([(now-7*day, 2000), (now-day, 810)], now, 800, reserve)
assert result['netConsumptionBytesPerDay'] == 172 and result['status'] == 'warning'
result = forecast([(now-7*day, 810), (now-day, 1000)], now, 800, reserve)
assert result['netConsumptionBytesPerDay'] == 200
assert forecast([(now+day, 10000)], now, 800, reserve)['status'] == 'insufficient-history'
assert forecast([(now-day, 1001)], now, 1000, reserve)['status'] == 'ok'
assert forecast([(now-day, 2**60+1000)], now, 2**60, reserve)['netConsumptionBytesPerDay'] == 1000
policy = {'path': '/var/backups/proofofwork-ui', 'label': 'ui-release-and-rollback-evidence',
          'reviewBytes': 1000, 'criticalBytes': 2000}
severity, allocation = allocation_report(policy, 999)
assert severity == 0 and allocation['status'] == 'measured'
assert allocation['cleanupApproved'] is False
severity, allocation = allocation_report(policy, 1000)
assert severity == 1 and allocation['status'] == 'review'
assert allocation['reviewRequired'] is True
severity, allocation = allocation_report(policy, 2000)
assert severity == 2 and allocation['status'] == 'critical-review'
assert 'does not approve deletion' in allocation['note']
observation_report = module['observation_report']
assert observation_report([(now-900, 120)], now, 120, 100, 120)[0] == 0
assert observation_report([(now-901, 120)], now, 120, 100, 120)[0] == 1
assert observation_report([(now+1, 120)], now, 120, 100, 120)[1]['reasons'] == ['no-valid-producer-observation']
assert observation_report([(now-300, 120)], now, 119, 100, 120)[0] == 1
assert observation_report([(now-300, 120)], now, 99, 100, 120)[0] == 2

# Execute the actual entry point: a flat daily sample used to return success
# even when its five-minute producer had stopped and UI free space was <12 GiB.
gib = module['GIB']
def run_monitor(age, available):
    samples = [(now-day, available), (now-age, available)]
    journal = b'\n'.join(json.dumps({'MESSAGE': f'storage target=/ filesystem=/dev/test used_percent=50 inode_used_percent=1 available_bytes={b} available_inodes=100',
                                      '__REALTIME_TIMESTAMP': str(t*1000000)}).encode()
                         for t, b in samples)
    output = io.StringIO()
    fake_os = SimpleNamespace(geteuid=lambda: 0, path=SimpleNamespace(isdir=lambda _: False),
                              statvfs=lambda _: SimpleNamespace(f_bavail=available, f_frsize=1))
    fake_subprocess = SimpleNamespace(run=lambda *a, **k: SimpleNamespace(stdout=journal),
                                     check_output=lambda *a, **k: '/')
    with patch.dict(module['main'].__globals__, {
            'sys': SimpleNamespace(flags=SimpleNamespace(isolated=True), argv=['monitor', 'ui']),
            'os': fake_os, 'subprocess': fake_subprocess, 'time': SimpleNamespace(time=lambda: now)}), \
            contextlib.redirect_stdout(output):
        code = module['main']()
    return code, [json.loads(line) for line in output.getvalue().splitlines()]

code, reports = run_monitor(day, 11*gib)
assert code == 1
assert reports[0]['reasons'] == ['producer-observation-stale', 'available-bytes-below-warning']
assert reports[1]['status'] == 'ok'  # Trend remains honest; combined health warns.
assert run_monitor(300, 13*gib)[0] == 0
assert run_monitor(day, 13*gib)[0] == 1
assert run_monitor(300, 11*gib)[0] == 1
assert run_monitor(300, 9*gib)[0] == 2
print('Storage forecast: history, exact bytes, allocation thresholds, producer freshness, current reserve warnings and actual monitor exit statuses passed.')
