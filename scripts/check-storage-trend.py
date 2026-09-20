#!/usr/bin/env python3
"""Boundary and burst tests for reserve forecasts; no production access."""
import runpy

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
print('Storage forecast: history coverage, declines, burst windows, exact byte arithmetic, allocation review thresholds and no-cleanup signaling passed.')
