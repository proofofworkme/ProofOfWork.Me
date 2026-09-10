// A worker retirement gate, not a replacement for chain/readiness verification.
// It never cancels queries, terminates sessions, or changes database contents.
import { exactWorkAmoV8WorkerReadiness } from '../../server/work-amo-v8-worker-readiness.mjs';

export const WORKER_APPLICATIONS = Object.freeze([
  'proof-indexer-worker', 'proof-indexer-worker-backfill',
  'proof-indexer-worker-parity',
]);

function require(condition, message) {
  if (!condition) throw new Error(message);
}

export async function readWorkerDatabaseSnapshot(pool, applications = WORKER_APPLICATIONS) {
  require(Array.isArray(applications) && applications.length > 0 && applications.length <= 16 &&
    applications.every((name) => /^[a-z0-9-]{1,63}$/u.test(name)), 'Invalid exact worker application list');
  const client = await pool.connect();
  try {
    await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
    const metadata = await client.query("SELECT value FROM proof_indexer.meta WHERE key = 'worker:lastRun'");
    const activity = await client.query(`SELECT pid, backend_start::text, application_name,
        client_addr::text, client_port, state, xact_start::text, wait_event_type, wait_event
      FROM pg_catalog.pg_stat_activity WHERE datname = current_database()
        AND application_name = ANY($1::text[]) ORDER BY pid`, [applications]);
    await client.query('COMMIT');
    return { model: 'proofofwork-worker-db-retirement-snapshot-v1',
      worker: metadata.rows.length === 1 ? metadata.rows[0].value : null,
      sessions: activity.rows, applications: [...applications] };
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

export function assertFrozenWorkerSnapshot(snapshot, { network, tipHash, tipHeight,
  liveMempoolSnapshot, frozen, pids, mainPid, baselineMode = 'healthy' }) {
  require(frozen === true, 'The complete service cgroup must be frozen before sampling');
  require(Number.isInteger(mainPid) && mainPid > 1 && Array.isArray(pids) &&
    pids.length === 1 && pids[0] === mainPid, 'Active worker children prohibit retirement');
  require(snapshot?.model === 'proofofwork-worker-db-retirement-snapshot-v1', 'Unknown database retirement snapshot');
  const readiness = exactWorkAmoV8WorkerReadiness({ network, worker: snapshot.worker },
    { network, tipHash, tipHeight, liveMempoolSnapshot });
  if (baselineMode === 'incident-existing-unhealthy') {
    require(snapshot.worker?.state === 'failed-retrying' && snapshot.worker?.ok === false &&
      typeof snapshot.worker?.lastSuccess?.finishedAt === 'string' &&
      /Canonical summary snapshot (?:\d+ bytes exceeds budget 16777216|is \d+ bytes; the storage budget is 16777216 bytes\.)/u.test(String(snapshot.worker?.error ?? '')),
    'Incident exception applies only to the recorded 16 MiB summary-budget failure');
  } else {
    require(baselineMode === 'healthy' && snapshot.worker?.state === 'idle' && snapshot.worker?.ok === true,
      'Only a healthy idle worker can enter quiescent retirement');
    require(readiness.ready === true, 'Worker has no exact durable readiness proof');
  }
  require(snapshot.sessions.length > 0 && snapshot.sessions.every((row) =>
    row.application_name === 'proof-indexer-worker' && row.state === 'idle' &&
    row.xact_start === null && row.wait_event_type === 'Client' && row.wait_event === 'ClientRead'),
  'Worker database sessions are not all idle outside transactions');
  return { passed: true, readiness, sessions: snapshot.sessions.map((row) =>
    ({ pid: row.pid, backend_start: row.backend_start })) };
}

export function assertRetiredWorkerSnapshot(before, after) {
  // A frozen process may already have sent SQL. Never infer its final durable
  // state from the pre-kill sample: all old application sessions must disappear
  // and its last complete worker record must be byte-equivalent as JSON.
  require(after?.model === before?.model && after.sessions.length === 0,
    'Worker database sessions remain after retirement');
  require(JSON.stringify(after.worker) === JSON.stringify(before.worker),
    'Worker checkpoint changed while retiring; preserve the prior service and revalidate');
  return { passed: true };
}
