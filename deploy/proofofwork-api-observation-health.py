#!/usr/bin/python3 -I
"""Summarize bounded API journal measurements without generating API load."""
import collections
import json
import math
import os
import re
import subprocess
import sys
import time


def normalized_route(row):
    route = str(row.get('route', ''))
    if not route.startswith('/api/v1/') and route not in ('/health', '/health/live'):
        return None
    route = re.sub(r'(/address/)[^/]+', r'\1:address', route)
    route = re.sub(r'/[0-9a-fA-F]{64}(?=/|$)', '/:txid', route)
    return route


def summarize(observations):
    groups = collections.defaultdict(list)
    interrupted_groups = collections.defaultdict(list)
    for row in observations:
        if row.get('method') != 'GET':
            continue
        event = row.get('event')
        if event not in ('http-response-observation', 'http-response-interrupted-observation'):
            continue
        route = normalized_route(row)
        elapsed = row.get('elapsedMs')
        if route is None:
            continue
        if type(elapsed) not in (int, float) or not math.isfinite(elapsed) or elapsed < 0:
            raise ValueError('Malformed response observation')
        if event == 'http-response-observation':
            status = row.get('status')
            if type(status) is not int:
                raise ValueError('Malformed completed response status')
            groups[route].append(row)
        else:
            interrupted_groups[route].append(row)

    result = []
    severity = 0
    for route in sorted(set(groups) | set(interrupted_groups)):
        rows = groups[route]
        interrupted = interrupted_groups[route]
        timings = sorted(row['elapsedMs'] for row in rows)
        count = len(rows)
        errors = sum(row['status'] >= 500 for row in rows)
        slow = sum(row['elapsedMs'] >= 10000 for row in rows)
        sizes = [row['payloadBytes'] for row in rows if type(row.get('payloadBytes')) is int and row['payloadBytes'] >= 0]
        p95 = timings[math.ceil(count * 0.95) - 1] if count else None
        interrupted_timings = sorted(row['elapsedMs'] for row in interrupted)
        interrupted_count = len(interrupted)
        interrupted_p95 = interrupted_timings[math.ceil(interrupted_count * 0.95) - 1] if interrupted_count else None
        alerts = []
        if count >= 20 and errors / count >= 0.05:
            alerts.append('server-error-rate'); severity = max(severity, 2 if errors / count >= 0.15 else 1)
        if count >= 5 and p95 >= 10000:
            alerts.append('response-latency'); severity = max(severity, 2 if p95 >= 30000 else 1)
        if sizes and max(sizes) >= 8 * 1024**2:
            alerts.append('large-response'); severity = max(severity, 1)
        if count >= 5 and len(sizes) != count:
            alerts.append('missing-payload-measurement'); severity = max(severity, 1)
        if interrupted_count >= 3 and interrupted_p95 >= 10000:
            alerts.append('slow-interrupted-reads'); severity = max(severity, 1)
        result.append({'route': route, 'requests': count, 'serverErrors': errors, 'slowRequests': slow,
                       'p95Ms': p95, 'maxPayloadBytes': max(sizes, default=None), 'unknownPayloadCount': count-len(sizes),
                       'interruptedRequests': interrupted_count, 'interruptedP95Ms': interrupted_p95,
                       'interruptedMaxMs': max(interrupted_timings, default=None),
                       'payloadWarningBytes': 8 * 1024**2, 'alerts': alerts})
    if len(groups) and len(interrupted_groups):
        coverage = 'finished-and-interrupted-GET-responses'
    elif len(groups):
        coverage = 'observed-finished-GET-responses'
    elif len(interrupted_groups):
        coverage = 'observed-interrupted-GET-responses'
    else:
        coverage = 'no-observations'
    return {'event': 'api-observation-health', 'severity': severity if result else 1,
            'coverage': coverage, 'routes': result,
            'qualification': 'Measures completed and interrupted GET responses, not client rendering or complete book hydration; checkpoint refusals count as availability errors.'}


def main():
    assert sys.flags.isolated and os.geteuid() == 0 and len(sys.argv) == 1
    now = time.time()
    journal = subprocess.run(['/usr/bin/journalctl', '--unit=proofofwork-api.service', '--since=10 minutes ago',
                              '--output=json', '--no-pager', '--lines=5000'], capture_output=True, check=True, timeout=20)
    assert len(journal.stdout) <= 32 * 1024**2, 'Observation byte budget exceeded'
    lines = journal.stdout.splitlines(); observations = []
    for line in lines:
        envelope = json.loads(line); message = envelope.get('MESSAGE')
        if not isinstance(message, str) or not message.startswith('{'):
            continue
        try: row = json.loads(message)
        except json.JSONDecodeError: continue
        if isinstance(row, dict): observations.append(row)
    result = summarize(observations)
    result.update({'checkedAtUnix': int(now), 'windowSeconds': 600, 'journalLines': len(lines), 'lineBudget': 5000})
    if len(lines) >= 5000:
        result['coverage'] = 'possibly-truncated'; result['severity'] = max(1, result['severity'])
    print(json.dumps(result))
    return result['severity']


if __name__ == '__main__':
    sys.exit(main())
