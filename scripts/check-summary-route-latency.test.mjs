import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import vm from 'node:vm';
const source = readFileSync(new URL('./check-summary-route-readiness.mjs', import.meta.url), 'utf8');
const start = source.indexOf('function pushLatencyIssues(');
const end = source.indexOf('\nfunction ', start + 1);
const evaluate = vm.runInNewContext(`(${source.slice(start, end)})`, {
  WARN_MS: 2500, CRITICAL_MS: 10000,
  compactIssue: (severity, kind, message, details) => ({ severity, kind, message, details }),
});
test('latency warning never asserts correctness of a refused or unverified response', () => {
  for (const status of [200, 503]) {
    const issues = [];
    evaluate(issues, [{label:'marketplace-summary', status, ok: status === 200, elapsedMs:9105}]);
    assert.equal(issues[0].kind, 'route-latency-warning');
    assert.equal(issues[0].severity, 'warning');
  }
});
test('critical latency and fast responses retain their independent thresholds', () => {
  const issues = [];
  evaluate(issues, [{label:'work-summary', elapsedMs:11000}, {label:'health',elapsedMs:50}]);
  assert.equal(issues.length, 1);
  assert.equal(issues[0].kind, 'route-latency-critical');
});
