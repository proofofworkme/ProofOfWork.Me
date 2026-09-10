import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { exactWorkAmoV8WorkerReadiness } from '../server/work-amo-v8-worker-readiness.mjs';

const tipHash = 'a'.repeat(64);
const finishedAt = '2026-09-09T00:00:00.000Z';
const replay = {
  era: 'q16', ready: true, replayRequired: true, tipHeight: 966120, tipHash,
  mempoolCount: 1, mempoolSha256: 'b'.repeat(64), pendingMembershipCount: 1,
  pendingMembershipSha256: 'c'.repeat(64), pendingProjectionSha256: 'd'.repeat(64),
};
const status = {
  network: 'livenet',
  worker: {
    network: 'livenet', state: 'idle', ok: true, lastSuccessAt: finishedAt,
    lastSuccess: { finishedAt, workPrecision: { era: 'q16', replay } },
    workPrecision: { era: 'q16', replay },
  },
};
const context = { network: 'livenet', tipHash, tipHeight: 966120,
  liveMempoolSnapshot: { model: 'canonical-core-mempool-txid-set-v1' } };
const results = [];
for (const state of ['idle', 'starting', 'running', 'canonical-phase-complete']) {
  const result = exactWorkAmoV8WorkerReadiness({ ...status, worker: { ...status.worker, state } }, context);
  assert.equal(result.ready, true, `${state} must preserve an exact durable proof`);
  results.push({ state, ready: result.ready, proofSource: result.proofSource });
}
assert.equal(exactWorkAmoV8WorkerReadiness(status, { ...context, tipHeight: 966121 }).ready, false);
assert.equal(exactWorkAmoV8WorkerReadiness({ ...status,
  worker: { ...status.worker, state: 'starting', error: 'fixture failure' } }, context).ready, false);
assert.equal(exactWorkAmoV8WorkerReadiness(status, { ...context, liveMempoolSnapshot: null }).ready, false);
const workerSource = readFileSync(new URL('./run-proof-indexer-worker.mjs', import.meta.url), 'utf8');
const signalHandler = workerSource.slice(workerSource.indexOf('export function requestWorkerStop('), workerSource.indexOf('\nfunction workerSleep('));
assert.match(signalHandler, /child\.kill\("SIGTERM"\)/u);
assert.match(signalHandler, /child\.kill\("SIGKILL"\)/u);
assert.match(workerSource, /const CHILD_STOP_GRACE_MS = 5_000/u);
console.log(JSON.stringify({ passed: true, checks: 10, results,
  limit: 'Exact source readiness fixture only. Does not certify old-worker draining, database transaction continuity, source/runtime switch, live API routing, or a real supervisor takeover.' }, null, 2));
