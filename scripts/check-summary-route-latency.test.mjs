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

const monitor = vm.runInNewContext(
  source.slice(0, source.indexOf('\nmain().catch(')) + '\n({ checkpointFromPayload, checkpointMismatch, routeSummary, pushCheckpointIssues, pushHttpIssues, pushHealthIssues, pushV8Issues, pushLatencyIssues, summarizeIssues })',
  { process: { env: {} } },
);
const blockHash = 'a'.repeat(64);
const sourceSnapshotId = '3b0ee262944199e18ecd4308';
const derivedSnapshotId = 'ed0527e13501703f4daa72de';
function checkpointPayload(overrides = {}) {
  return { network: 'livenet', snapshotId: sourceSnapshotId,
    indexedThroughBlock: 972943, indexedThroughBlockHash: blockHash,
    indexedAt: '2026-10-24T15:48:20.496Z', ...overrides };
}
function checkpoint(payload) {
  return monitor.checkpointFromPayload(payload, 'workSummary');
}

test('one explicit derived snapshot matches its source only at the same complete checkpoint', () => {
  const original = checkpoint(checkpointPayload());
  const derived = checkpoint(checkpointPayload({ snapshotId: derivedSnapshotId,
    derivedFromSnapshotId: sourceSnapshotId }));
  assert.equal(monitor.checkpointMismatch(original, original), false);
  assert.equal(monitor.checkpointMismatch(original, derived), false);
  assert.equal(monitor.checkpointMismatch(derived, original), false);
  assert.equal(derived.snapshotId, derivedSnapshotId);
  assert.equal(derived.derivedFromSnapshotId, sourceSnapshotId);
});

test('derived lineage cannot conceal wrong, missing, invalid or indirect authority', () => {
  const original = checkpoint(checkpointPayload());
  for (const link of [undefined, null, '', 'wrong-source', derivedSnapshotId, 123, {}, ['parent']]) {
    const payload = checkpointPayload({ snapshotId: derivedSnapshotId });
    if (link !== undefined) payload.derivedFromSnapshotId = link;
    assert.equal(monitor.checkpointMismatch(original, checkpoint(payload)), true, String(link));
  }
  const derived = checkpoint(checkpointPayload({ snapshotId: derivedSnapshotId,
    derivedFromSnapshotId: sourceSnapshotId }));
  for (const other of [
    checkpointPayload({ derivedFromSnapshotId: 'unproven-grandparent' }),
    checkpointPayload({ snapshotId: 'another-child', derivedFromSnapshotId: sourceSnapshotId }),
    checkpointPayload({ snapshotId: derivedSnapshotId, derivedFromSnapshotId: 'different-parent' }),
    checkpointPayload({ snapshotId: derivedSnapshotId }),
  ]) assert.equal(monitor.checkpointMismatch(derived, checkpoint(other)), true);
  // A nested link is not the explicit lineage emitted by the API.
  assert.equal(monitor.checkpointMismatch(original, checkpoint(checkpointPayload({
    snapshotId: derivedSnapshotId, provenance: { derivedFromSnapshotId: sourceSnapshotId },
  }))), true);
});

test('equal or derived IDs cannot conceal changed or incomplete checkpoint evidence', () => {
  const original = checkpoint(checkpointPayload());
  for (const identity of [{}, { snapshotId: derivedSnapshotId, derivedFromSnapshotId: sourceSnapshotId }]) {
    for (const mutation of [
      { indexedThroughBlock: 972942 }, { indexedThroughBlock: null },
      { indexedThroughBlock: Number.MAX_SAFE_INTEGER + 1 },
      { indexedThroughBlockHash: 'b'.repeat(64) }, { indexedThroughBlockHash: 'invalid' },
      { indexedAt: '2026-10-24T15:48:21.496Z' }, { indexedAt: null }, { indexedAt: 'invalid' },
      { network: 'testnet' }, { network: null },
    ]) assert.equal(monitor.checkpointMismatch(original, checkpoint(checkpointPayload({ ...identity, ...mutation }))), true,
      JSON.stringify({ identity, mutation }));
  }
});

test('valid derived lineage leaves HTTP, lag, declaration and latency gates independent', () => {
  const v8 = { ready: true, indexReady: true, migrationReady: true, declarationReady: true,
    evidenceComplete: true, pendingWitnessReady: true,
    tipHeight: 972943, tipHash: blockHash,
    workerReadiness: { ready: true, tipHeight: 972943, tipHash: blockHash },
    declarationEvidence: { declarationTxid: 'f90e1faf572ef8253ca5959731b9d9e99c74bced4397380059878936712bee7a',
      declarationHeight: 960600, activationHeight: 960601, evidenceComplete: true,
      coreVerified: true, indexVerified: true, configuredPinsMatch: true } };
  const route = (label, payload) => monitor.routeSummary({ label, status: 200, ok: true,
    elapsedMs: 50, payloadBytes: 100, payload: { ...payload, workAmoV8: structuredClone(v8) } });
  const work = route('work-summary', checkpointPayload());
  const marketplace = route('marketplace-summary', checkpointPayload({ snapshotId: derivedSnapshotId,
    derivedFromSnapshotId: sourceSnapshotId }));
  const health = { ready: true, available: true, lagBlocks: 0, indexedThroughBlock: 972943,
    indexedThroughBlockHash: blockHash, summarySnapshotOk: true };
  const check = (candidate = marketplace, healthState = health) => {
    const issues = [];
    monitor.pushCheckpointIssues(issues, healthState, work, candidate);
    monitor.pushHttpIssues(issues, candidate);
    monitor.pushHealthIssues(issues, healthState);
    monitor.pushV8Issues(issues, work, candidate);
    monitor.pushLatencyIssues(issues, [work, candidate]);
    return monitor.summarizeIssues(issues);
  };
  assert.equal(check().ok, true);
  assert.equal(check({ ...marketplace, ok: false, status: 503, error: 'checkpoint unavailable' }).staleReadiness.length, 1);
  assert.equal(check({ ...marketplace, ok: false, status: 500, error: 'internal error' }).activeInvariantFailures[0].kind, 'route-http');
  assert.ok(check(marketplace, { ...health, indexedThroughBlock: 972950, lagBlocks: 7 }).staleReadiness.length);
  const badEvidence = structuredClone(marketplace);
  badEvidence.workAmoV8.declarationEvidence.coreVerified = false;
  assert.equal(check(badEvidence).activeInvariantFailures[0].kind, 'work-amo-v8-declaration-evidence');
  assert.equal(check({ ...marketplace, elapsedMs: 3000 }).counts.latencyWarnings, 1);
  assert.equal(check({ ...marketplace, elapsedMs: 11000 }).counts.latencyErrors, 1);
});
