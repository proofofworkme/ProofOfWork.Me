import test from 'node:test';
import assert from 'node:assert/strict';
import { MODEL, SUMMARY_KEYS, validateManifest, validateCandidate, sha256, canonicalMempool,
  pendingBinding, assertFrozen, assertRetired, assertCurrentSummary, assertCompleted, verifyPhase } from './node-worker-verifier.mjs';

const hash = 'a'.repeat(64);
const txid = 'b'.repeat(64);
const projectionHash = 'c'.repeat(64);
const tip = { height: 966134, hash };
const now = Date.now();
const time = offset => new Date(now + offset).toISOString();
const clone = value => structuredClone(value);
const manifest = {
  model: MODEL, network: 'livenet', nodeBinary: { path: '/opt/node/bin/node', sha256: hash, owner: 0 },
  verifierModule: { path: '/opt/recovery/node-worker-verifier.mjs', sha256: hash },
  source: { root: '/opt/proofofwork-api', owner: 1000, commit: 'a'.repeat(40), files: Object.fromEntries([
    'scripts/run-proof-indexer-worker.mjs', 'scripts/backfill-proof-indexer.mjs', 'server/canonical-summary-budget.mjs',
    'server/db/proof-index-reader.mjs', 'server/work-amo-v8-worker-readiness.mjs', 'server/db/postgres.mjs',
    'server/proof-api.mjs'].map(file => [file, hash])) },
  apis: [{ kind: 'node-api', unit: 'proofofwork-api.service', pid: 10, startTicks: '100', port: 8081,
    addressHex: '0100007F', sourceRoot: '/opt/proofofwork-api' },
  { kind: 'socket-proxy', unit: 'proofofwork-api-wg.service', socketUnit: 'proofofwork-api-wg.socket', pid: 11,
    startTicks: '101', port: 8081, addressHex: '02004D0A', listenAddress: '10.77.0.2:8081',
    executable: { path: '/usr/lib/systemd/systemd-socket-proxyd', sha256: hash } }],
  primaryApiUnit: 'proofofwork-api.service',
  budgets: { priorCompactBytes: 16777216, compactBytes: 17825792, sqlTextBytes: 18874368 },
  candidate: { receipt: { path: '/opt/receipt.json', sha256: hash }, payload: { path: '/opt/payload.json', sha256: hash },
    maximumAgeSeconds: 1800 },
};
function observation() {
  const membership = { model: 'canonical-work-q16-pending-membership-v2', count: 1, txids: [txid],
    sha256: sha256(`ProofOfWork.Me/WORK-Q16-PENDING-MEMBERSHIP/v1\n${JSON.stringify([txid])}`) };
  const commitments = { closingStateCommitment: { model: 'state', payloadBytes: 100, sha256: hash },
    tokenStateCommitment: { model: 'token', payloadBytes: 200, sha256: txid } };
  const worker = { state: 'idle', ok: true, consecutiveFailures: 0, error: null, lastSuccessAt: time(-1000),
    lastSuccess: { finishedAt: time(-1000), workPrecision: { era: 'q16', replay: { ready: true,
      pendingMembershipCount: 1, pendingMembershipSha256: membership.sha256, pendingProjectionSha256: projectionHash } } } };
  const db = { worker, scan: { ...tip, complete: true }, sessions: [],
    summary: { ...tip, payloadHash: hash, refreshHash: hash, ok: true, status: 'green', sqlTextBytes: 17660681,
      generatedAt: time(-2000), snapshotId: 'new', workAmountStorageModel: 'work-subatoms-v2',
      workSufficientState: { indexedThroughBlock: tip.height, indexedThroughBlockHash: hash, ...clone(commitments) },
      coverage: Object.fromEntries(SUMMARY_KEYS.map(key => [key, { ...tip, snapshotId: 'new', nestedHeight: tip.height }])),
      exactAliases: Array(8).fill('838757623963559142078714414') },
    transition: { ...tip, complete: true, ...commitments },
    pending: { model: 'canonical-work-q16-pending-rebuild-v2', network: 'livenet', ready: true, generatedAt: time(-2000),
      canonicalTip: tip, membershipSnapshot: membership, projection: { commitmentSha256: projectionHash } },
    durable: { worker, scan: ['scan', tip.height, hash], summary: ['new', tip.height, hash], pending: ['witness'] } };
  db.sessions = [{ application_name: 'proof-indexer-worker', state: 'idle', xact_start: null,
    wait_event_type: 'Client', wait_event: 'ClientRead' }];
  return { coreBefore: tip, coreAfter: tip, db,
    workerProcess: { pid: 22, pids: [22], frozen: false, compactBytes: 17825792, sqlTextBytes: 18874368 },
    readiness: { ready: true, pendingReady: true, failureActive: false, tipHeight: tip.height, tipHash: hash },
    pending: { ready: true, relevantMembershipStable: true },
    apiReads: ['work-summary', 'marketplace-summary'].map(endpoint => ({ endpoint, status: 200, ...tip,
      snapshotId: 'new', ready: true, protocolWritesEnabled: true, workNetworkValueQ8: db.summary.exactAliases[0] })) };
}
function frozen() {
  const value = observation();
  value.passed = true; value.phase = 'frozen';
  value.workerProcess = { pid: 20, pids: [20], frozen: true, compactBytes: 16777216, sqlTextBytes: 18874368 };
  value.db.worker = { state: 'failed-retrying', ok: false, lastSuccess: { finishedAt: time(-60000) } };
  value.db.durable.worker = value.db.worker;
  value.db.sessions = [{ application_name: 'proof-indexer-worker', state: 'idle', xact_start: null,
    wait_event_type: 'Client', wait_event: 'ClientRead' }];
  value.incident = { matched: true };
  return value;
}

test('manifest pins the actual Node API and WireGuard socket proxy separately', () => {
  assert.equal(validateManifest(manifest), manifest);
  for (const mutate of [m => { m.apis[1].unit = 'proofofwork-api-wireguard.service'; },
    m => { m.apis[1].kind = 'node-api'; }, m => { m.budgets.compactBytes = 20 * 1024 * 1024; },
    m => { delete m.source.files['server/db/proof-index-reader.mjs']; }, m => { m.candidate.maximumAgeSeconds = 1801; }]) {
    const value = clone(manifest); mutate(value); assert.throws(() => validateManifest(value));
  }
});

test('candidate proof binds unchanged writer, exact bytes, age, SQL envelope and checkpoint', () => {
  const payload = { ok: true, status: 'green', checks: [{ ok: true }], indexedThroughBlock: tip.height,
    indexedThroughBlockHash: hash, snapshotId: 'candidate' };
  const receipt = { ok: true, sameCore: true, sameScan: true, candidateMatchesFence: true, coreAfter: tip,
    writerSha256: hash, at: time(-1000), candidate: { sha256: sha256(JSON.stringify(payload)),
      compactBytes: Buffer.byteLength(JSON.stringify(payload)), sql_text_bytes: 1000 } };
  assert.equal(validateCandidate(receipt, payload, manifest, now).height, tip.height);
  for (const mutate of [r => { r.candidate.sql_text_bytes = 18874369; }, r => { r.at = time(-1801000); },
    r => { r.writerSha256 = txid; }, r => { r.candidate.compactBytes += 1; }, r => { r.sameCore = false; }]) {
    const value = clone(receipt); mutate(value); assert.throws(() => validateCandidate(value, payload, manifest, now));
  }
  assert.throws(() => validateCandidate(receipt, { ...payload, status: 'failed' }, manifest, now));
});

test('frozen gate rejects children, in-flight SQL, partial worker phase and unbound incidents', () => {
  assert.equal(assertFrozen(frozen()), true);
  for (const mutate of [v => { v.workerProcess.pids.push(21); }, v => { v.workerProcess.frozen = false; },
    v => { v.db.sessions[0].xact_start = time(-1); }, v => { v.db.sessions[0].state = 'active'; },
    v => { v.db.sessions[0].application_name = 'proof-indexer-worker-backfill'; },
    v => { v.db.worker.state = 'canonical-phase-complete'; }, v => { v.incident.matched = false; }]) {
    const value = frozen(); mutate(value); assert.throws(() => assertFrozen(value));
  }
});

test('retirement preserves the exact durable baseline and proves all worker sessions gone', () => {
  const before = frozen(); const after = clone(before);
  after.workerProcess = { pid: 0, pids: [] }; after.db.sessions = [];
  assert.equal(assertRetired(before, after), true);
  for (const mutate of [v => { v.db.sessions.push({ pid: 99 }); }, v => { v.db.durable.pending = ['changed']; },
    v => { v.db.durable.worker.lastSuccess.finishedAt = time(-5); }, v => { v.workerProcess.pid = 20; }]) {
    const value = clone(after); mutate(value); assert.throws(() => assertRetired(before, value));
  }
});

test('canonical gate requires eight complete summaries, SQL capacity and exact integer/state bindings', () => {
  assert.equal(assertCurrentSummary(observation().db, tip, (now - 10000) / 1000), true);
  for (const mutate of [v => { v.summary.sqlTextBytes = 18874369; }, v => { v.summary.coverage.workSummary.nestedHeight -= 1; },
    v => { v.summary.exactAliases[0] = Number(v.summary.exactAliases[0]); },
    v => { v.summary.exactAliases[2] = '838757623963559142078714415'; },
    v => { v.summary.workSufficientState.tokenStateCommitment.sha256 = projectionHash; },
    v => { delete v.summary.coverage.logSummary; }, v => { v.transition.complete = false; },
    v => { v.summary.generatedAt = time(-20000); }]) {
    const value = observation().db; mutate(value); assert.throws(() => assertCurrentSummary(value, tip, (now - 10000) / 1000));
  }
});

test('published pending candidates remain in Core while unrelated arrivals do not invalidate authority', () => {
  const db = observation().db;
  const before = canonicalMempool([txid]); const after = canonicalMempool([txid, hash]);
  assert.equal(pendingBinding(db, before, after).ready, true);
  assert.equal(pendingBinding(db, before, after).relevantMembershipStable, true);
  assert.equal(pendingBinding(db, before, canonicalMempool([hash])).relevantMembershipStable, false);
  const altered = clone(db); altered.pending.projection.commitmentSha256 = hash;
  assert.equal(pendingBinding(altered, before, after).ready, false);
  const duplicate = clone(db); duplicate.pending.membershipSnapshot.txids.push(txid);
  assert.equal(pendingBinding(duplicate, before, after).ready, false);
  assert.throws(() => canonicalMempool([txid, txid]));
});

test('new-cycle gate rejects old success, unreadable API, moving Core and changed pending publication', () => {
  const request = { preparedAt: (now - 10000) / 1000 };
  assert.equal(assertCompleted(frozen(), observation(), request), true);
  for (const mutate of [v => { v.workerProcess.pid = 20; }, v => { v.db.worker.lastSuccess.finishedAt = time(-60000); },
    v => { v.db.worker.state = 'canonical-phase-complete'; }, v => { v.apiReads[0].status = 503; },
    v => { v.apiReads[1].snapshotId = 'old'; }, v => { v.apiReads[0].protocolWritesEnabled = false; },
    v => { v.coreAfter = { height: tip.height + 1, hash }; }, v => { v.pending.ready = false; },
    v => { v.readiness.pendingReady = false; }]) {
    const value = observation(); mutate(value); assert.throws(() => assertCompleted(frozen(), value, request));
  }
});

test('before-freeze recognizes only the current measured incident, not health or stale preflight', async () => {
  const value = observation(); value.workerProcess.compactBytes = 16777216;
  value.apiBaseline = { status: 503, errorCode: 'CANONICAL_SUMMARY_UNAVAILABLE' };
  const request = { phase: 'before-freeze', baselineMode: 'incident-existing-unhealthy', preparedAt: now / 1000 };
  const dependencies = { candidate: tip, observe: async () => value };
  const result = await verifyPhase(manifest, request, dependencies);
  assert.equal(result.passed, true); assert.equal(result.healthy, false);
  await assert.rejects(verifyPhase(manifest, { ...request, baselineMode: 'healthy' }, dependencies));
  await assert.rejects(verifyPhase(manifest, request, { ...dependencies, candidate: { ...tip, height: tip.height - 1 } }));
  value.apiBaseline.status = 200;
  await assert.rejects(verifyPhase(manifest, request, dependencies));
  const nonquiescent = observation(); nonquiescent.workerProcess.pids.push(23);
  nonquiescent.apiBaseline = { status: 503, errorCode: 'CANONICAL_SUMMARY_UNAVAILABLE' };
  await assert.rejects(verifyPhase(manifest, request, { ...dependencies, observe: async () => nonquiescent }));
  const activeSession = observation(); activeSession.apiBaseline = { status: 503, errorCode: 'CANONICAL_SUMMARY_UNAVAILABLE' };
  activeSession.db.sessions[0].state = 'active';
  await assert.rejects(verifyPhase(manifest, request, { ...dependencies, observe: async () => activeSession }));
});

test('armed rollback accepts the durable preflight only when retirement was impossible, and never claims healthy', async () => {
  const before = frozen(); before.phase = 'before-freeze';
  const value = clone(before); value.workerProcess.frozen = false;
  value.db.worker.state = 'canonical-phase-complete';
  const request = { phase: 'rollback', baselineMode: 'incident-existing-unhealthy', preparedAt: now / 1000,
    before, retirementOccurredPossible: false, wasFrozenBaseline: false };
  const dependencies = { candidate: tip, observe: async () => value };
  const result = await verifyPhase(manifest, request, dependencies);
  assert.equal(result.passed, true); assert.equal(result.healthy, false);
  await assert.rejects(verifyPhase(manifest, { ...request, retirementOccurredPossible: true }, dependencies));
  value.workerProcess.compactBytes = 17825792;
  await assert.rejects(verifyPhase(manifest, request, dependencies));
});
