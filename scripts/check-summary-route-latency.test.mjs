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
test('critical latency fails the operational gate while keeping correctness separately true', async () => {
  const summaryStart=source.indexOf('function summarizeIssues(');
  const mainStart=source.indexOf('async function main()');
  const mainEnd=source.indexOf('\nmain().catch(',mainStart);
  for (const elapsedMs of [50,3000,11000]) {
    let result;const process={exitCode:0};
    const context={BASE:'fixture',NETWORK:'livenet',TIMEOUT_MS:30000,WARN_MS:2500,CRITICAL_MS:10000,MAX_LAG_BLOCKS:2,HEALTH_MAX_LAG_BLOCKS:1,
      process,console:{log(value){result=JSON.parse(value);}},
      routeUrl:()=>'',fetchJson:async()=>({elapsedMs,payload:{}}),healthCheckpoint:x=>x,routeSummary:x=>x,
      pushLatencyIssues:evaluate,pushHttpIssues:()=>{},pushHealthIssues:()=>{},pushCheckpointIssues:()=>{},pushV8Issues:()=>{}};
    await vm.runInNewContext(source.slice(summaryStart,mainStart)+source.slice(mainStart,mainEnd)+'\nmain()',context);
    assert.equal(result.correctnessOk,true);
    assert.equal(result.ok,elapsedMs<10000);
    assert.equal(process.exitCode,elapsedMs<10000?0:1);
  }
});
