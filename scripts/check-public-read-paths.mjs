// Release acceptance for public consumers, in addition to summary publication
// and source provenance. Read-only: never prepares, signs or broadcasts a tx.
import assert from 'node:assert/strict';

const base = process.env.POW_API_BASE ?? 'https://computer.proofofwork.me';
const deadlineMs = Number(process.env.POW_READ_PATH_TIMEOUT_MS ?? 30_000);
assert.ok(Number.isSafeInteger(deadlineMs) && deadlineMs > 0 && deadlineMs <= 60_000);
const batchTxid = 'b25e6ae7f963af289ba8cb3edae76ef285d3d124204a0e4cd514df0933938322';
const timings = [];
async function read(path) {
  const start = performance.now();
  const response = await fetch(new URL(path, base), {
    cache: 'no-store', redirect: 'error', signal: AbortSignal.timeout(deadlineMs),
  });
  const payload = await response.json();
  timings.push({ path, status: response.status, ms: Math.round(performance.now() - start) });
  assert.equal(response.status, 200, `${path}: ${JSON.stringify(payload).slice(0, 1500)}`);
  return payload;
}
function eventKey(item) {
  assert.match(String(item.eventId), /^[1-9]\d*$/u);
  return String(item.eventId);
}
function checkpoint(payload, expected) {
  assert.equal(payload.snapshotId, expected.snapshotId, 'Consumer snapshot diverged.');
  assert.equal(payload.indexedThroughBlock, expected.indexedThroughBlock, 'Consumer checkpoint diverged.');
  assert.equal(payload.indexedThroughBlockHash, expected.indexedThroughBlockHash, 'Consumer checkpoint hash diverged.');
}
try {
  const health = await read('/health');
  assert.equal(health.ready, true, 'The node/index/summary must be ready before public acceptance.');
  assert.equal(health.checks.index.lagBlocks, 0);
  const coverage = health.checks.index.summarySnapshot.coverageByKey;
  assert.equal(Object.keys(coverage).length, 8);
  assert.ok(Object.values(coverage).every(height => height === health.tipHeight));

  const floor = await read('/api/v1/work-floor?network=livenet&fresh=1');
  assert.equal(floor.indexedThroughBlock, health.tipHeight);
  assert.equal(floor.indexedThroughBlockHash, health.checks.node.bestBlockHash);
  const summary = await read('/api/v1/log-summary?network=livenet&fresh=1');
  checkpoint(summary, floor);
  const first = await read(`/api/v1/log-history?network=livenet&limit=50&snapshot=${encodeURIComponent(floor.snapshotId)}`);
  checkpoint(first, floor);
  assert.ok(first.totalCount > 50 && first.items.length === 50 && first.nextCursor);
  const firstIds = new Set(first.items.map(eventKey));
  assert.equal(firstIds.size, 50);
  const next = await read(`/api/v1/log-history?network=livenet&limit=50&cursor=${encodeURIComponent(first.nextCursor)}`);
  checkpoint(next, floor);
  assert.equal(next.totalCount, first.totalCount);
  assert.equal(next.start, first.end);
  assert.ok(next.items.length > 0 && next.items.every(item => !firstIds.has(eventKey(item))));
  assert.equal(new Set(next.items.map(eventKey)).size, next.items.length);

  const batch = await read(`/api/v1/log-history?network=livenet&limit=200&q=${batchTxid}&snapshot=${encodeURIComponent(floor.snapshotId)}`);
  assert.equal(batch.snapshotId, floor.snapshotId);
  const recipients = batch.items.filter(item => item.txid === batchTxid && item.kind === 'token-transfer');
  assert.equal(recipients.length, 12, 'The known twelve-recipient batch must retain every child.');
  assert.equal(new Set(recipients.map(eventKey)).size, 12);
  assert.equal(new Set(recipients.map(item => `${item.protocolVout}:${item.recordOrdinal}`)).size, 12);
  assert.ok(recipients.every(item => item.confirmed === true));

  const boost = await read('/api/v1/boost?network=livenet&limit=2');
  checkpoint(boost, floor);
  assert.equal(boost.complete, true);
  assert.equal(boost.indexedThroughBlockHash, floor.indexedThroughBlockHash);
  assert.ok(Array.isArray(boost.items) && boost.items.length > 0, 'Boost must return an actual feed.');
  assert.ok(boost.items.every(item => item.confirmed === true));
  const consistency = await read('/api/v1/consistency?network=livenet&fresh=1');
  assert.equal(consistency.ok, true);
  assert.deepEqual(consistency.missingLogEvents, []);
  checkpoint(consistency, floor);
  const after = await read('/health');
  assert.equal(after.ready, true);
  assert.equal(after.tipHeight, health.tipHeight, 'Core advanced during acceptance; rerun at one checkpoint.');
  assert.equal(after.checks.node.bestBlockHash, health.checks.node.bestBlockHash);
  console.log(JSON.stringify({ ok: true, base, snapshotId: floor.snapshotId,
    height: floor.indexedThroughBlock, batchRecipients: recipients.length, timings }));
} catch (error) {
  console.error(JSON.stringify({ ok: false, base, error: String(error.message ?? error), timings }));
  process.exitCode = 1;
}
