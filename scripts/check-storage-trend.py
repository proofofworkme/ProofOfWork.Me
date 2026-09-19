#!/usr/bin/env python3
"""Boundary and burst tests for reserve forecasts; no production access."""
import runpy

module = runpy.run_path('deploy/proofofwork-storage-trend.py')
forecast, day = module['forecast'], module['DAY']
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
print('Storage forecast: history coverage, declines, burst windows, exact byte arithmetic and reserve boundaries passed.')
