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
node_data_allocation_report = module['node_data_allocation_report']
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
assert severity == 1 and allocation['status'] == 'critical-review'
assert 'does not approve deletion' in allocation['note']
assert allocation['healthCategory'] == 'allocation-review' and allocation['capacityEmergency'] is False
assert allocation['thresholdBand'] == 'critical'
assert forecast([(now-day, 300)], now, 200, reserve)['basis'] == 'conditional-historical-net-consumption'
severity, core = node_data_allocation_report('/data/bitcoin', 979 * module['GIB'])
assert severity == 0 and core['label'] == 'canonical-bitcoin-core-chainstore'
assert core['cleanupApproved'] is False
severity, replay = node_data_allocation_report('/data/proofofwork-incb-final-source-replay-20260925', 89 * 1024**3)
assert severity == 1 and replay['status'] == 'critical-review'
assert replay['cleanupApproved'] is False
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

def run_node_attribution():
    root_available = 40 * gib
    data_available = 500 * gib
    rows = []
    for target, available in (('/', root_available), ('/data', data_available)):
        for timestamp, bytes_free in ((now-day, available + gib), (now, available)):
            message = (f'storage target={target} filesystem=/dev/test used_percent=50 '
                       f'inode_used_percent=1 available_bytes={bytes_free} available_inodes=100')
            rows.append(json.dumps({'MESSAGE': message,
                                    '__REALTIME_TIMESTAMP': str(timestamp*1000000)}).encode())
    journal = b'\n'.join(rows)
    du = (f'{979*gib}\t/data/bitcoin\n{64*gib}\t/data/electrs\n'
          f'{89*gib}\t/data/proofofwork-incb-final-source-replay-20260925\n').encode()
    fake_os = SimpleNamespace(
        geteuid=lambda: 0,
        path=SimpleNamespace(isdir=lambda _: False, normpath=lambda path: path),
        statvfs=lambda target: SimpleNamespace(
            f_bavail=root_available if target == '/' else data_available,
            f_frsize=1,
        ),
    )
    def run(command, **kwargs):
        return SimpleNamespace(stdout=journal if command[0].endswith('journalctl') else du)
    output = io.StringIO()
    with patch.dict(module['main'].__globals__, {
            'sys': SimpleNamespace(flags=SimpleNamespace(isolated=True), argv=['monitor', 'node']),
            'os': fake_os,
            'subprocess': SimpleNamespace(run=run, check_output=lambda command, **kwargs: command[-1]),
            'time': SimpleNamespace(time=lambda: now)}), contextlib.redirect_stdout(output):
        code = module['main']()
    reports = [json.loads(line) for line in output.getvalue().splitlines()]
    by_path = {report.get('path'): report for report in reports if report.get('event') == 'storage-allocation'}
    assert by_path['/data/bitcoin']['label'] == 'canonical-bitcoin-core-chainstore'
    assert by_path['/data/electrs']['label'] == 'canonical-electrs-index'
    assert by_path['/data/proofofwork-incb-final-source-replay-20260925']['status'] == 'critical-review'
    assert all(report['cleanupApproved'] is False for report in by_path.values())
    assert code == 1
    assert reports[-1]['capacitySeverity'] == 0
    assert reports[-1]['allocationReviewSeverity'] == 1
    assert reports[-1]['status'] == 'warning'

run_node_attribution()
print('Storage forecast: history, exact bytes, allocation thresholds, producer freshness, current reserve warnings and actual monitor exit statuses passed.')
