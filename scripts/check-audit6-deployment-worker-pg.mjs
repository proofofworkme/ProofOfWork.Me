// Requires a disposable PostgreSQL 16 database named audit6_safeguards on an
// explicitly supplied localhost port. Never uses ambient production DB URLs.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, writeFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import vm from 'node:vm';
import { createProofIndexPool } from '../server/db/postgres.mjs';
import { createWorkerRuntime, requestWorkerStop, runScript } from './run-proof-indexer-worker.mjs';
import { readWorkerDatabaseSnapshot, assertFrozenWorkerSnapshot,
  assertRetiredWorkerSnapshot } from '../deploy/audit6/node-worker-db.mjs';

const filename = fileURLToPath(import.meta.url);
const dbUrl = String(process.env.POW_AUDIT6_FIXTURE_DATABASE_URL ?? '');
const parsed = new URL(dbUrl);
assert.equal(parsed.protocol, 'postgres:');
assert.equal(parsed.hostname, '127.0.0.1');
assert.equal(parsed.pathname, '/audit6_safeguards');
assert.ok(Number(parsed.port) >= 1024 && parsed.port !== '5432');
const connection = { connectionString: dbUrl, env: { POW_INDEX_DB_APP_NAME: 'audit6-retirement-observer',
  POW_INDEX_DB_POOL_MAX: '2', POW_INDEX_DB_STATEMENT_TIMEOUT_MS: '10000' } };
const source = readFileSync(new URL('./run-proof-indexer-worker.mjs', import.meta.url), 'utf8');
const from = source.indexOf('async function writeWorkerMeta(');
const to = source.indexOf('\nasync function readWorkerMeta(', from);
assert.ok(from > 0 && to > from);
const writeDefinition = source.slice(from, to);
const writeWorkerMeta = vm.runInNewContext(`${writeDefinition}; writeWorkerMeta`,
  { NETWORK: 'livenet', console, JSON, cappedChildError: String });
const finishedAt = '2026-09-09T00:00:00.000Z';
const replay = { era: 'q16', ready: true, replayRequired: true, tipHeight: 966120,
  tipHash: 'a'.repeat(64), mempoolCount: 1, mempoolSha256: 'b'.repeat(64),
  pendingMembershipCount: 1, pendingMembershipSha256: 'c'.repeat(64), pendingProjectionSha256: 'd'.repeat(64) };
const baseline = { network: 'livenet', state: 'idle', ok: true, lastSuccessAt: finishedAt,
  lastSuccess: { finishedAt, workPrecision: { era: 'q16', replay } }, workPrecision: { era: 'q16', replay } };
const context = { network: 'livenet', tipHash: replay.tipHash, tipHeight: replay.tipHeight,
  liveMempoolSnapshot: { model: 'canonical-core-mempool-txid-set-v1' } };
const mode = process.argv.find((v) => v.startsWith('--fixture='))?.slice(10);
const scenario = process.argv.find((v) => v.startsWith('--scenario='))?.slice(11);
const marker = process.env.POW_AUDIT6_FIXTURE_MARKER;

if (mode === 'child') {
  const pool = createProofIndexPool({ ...connection, env: { ...connection.env,
    POW_INDEX_DB_APP_NAME: 'proof-indexer-worker-backfill' } });
  const client = await pool.connect();
  await client.query('BEGIN');
  await client.query("INSERT INTO public.audit6_effects VALUES (1, 'uncommitted child write')");
  writeFileSync(marker, 'transaction-open');
  if (scenario === 'commit') {
    await client.query('COMMIT');
    client.release(); await pool.end();
  } else {
    await delay(120000); // Actual worker SIGTERM must terminate this child first.
  }
} else if (mode === 'worker') {
  const pool = createProofIndexPool({ ...connection, env: { ...connection.env,
    POW_INDEX_DB_APP_NAME: 'proof-indexer-worker' } });
  const runtime = createWorkerRuntime('livenet');
  process.on('SIGTERM', () => requestWorkerStop(runtime));
  await writeWorkerMeta(pool, baseline);
  try {
    if (scenario === 'idle-race') {
      writeFileSync(marker, 'idle-before-scheduled-child');
      await delay(1000);
    }
    await runScript(path.basename(filename), ['--fixture=child', '--scenario=' + scenario], {},
      { runtime, timeoutMs: 120000 });
  } catch (error) {
    if (error.code !== 'POW_INDEX_WORKER_STOPPING') throw error;
  } finally {
    await pool.end();
  }
} else {
  const pool = createProofIndexPool(connection);
  const temporary = mkdtempSync(path.join(tmpdir(), 'pow-audit6-worker-pg-'));
  const children = new Set();
  const checks = [];
  const record = (name) => checks.push({ name, passed: true });
  const waitFor = async (predicate, description, timeoutMs = 10000) => {
    const end = Date.now() + timeoutMs;
    while (!(await predicate())) {
      assert.ok(Date.now() < end, 'Timed out: ' + description);
      await delay(25);
    }
  };
  const launch = (name) => {
    const markerPath = path.join(temporary, name);
    const child = spawn(process.execPath, [filename, '--fixture=worker', '--scenario=' + name],
      { detached: true, env: { ...process.env, POW_AUDIT6_FIXTURE_MARKER: markerPath },
        stdio: ['ignore', 'pipe', 'pipe'] });
    children.add(child);
    let output = ''; child.stdout.on('data', (d) => { output += d; }); child.stderr.on('data', (d) => { output += d; });
    const exit = new Promise((resolve) => child.on('exit', (code, signal) => resolve({ code, signal, output })));
    return { child, markerPath, exit };
  };
  try {
    const version = (await pool.query('SHOW server_version_num')).rows[0].server_version_num;
    assert.equal(Math.trunc(Number(version) / 10000), 16);
    await pool.query('CREATE SCHEMA proof_indexer');
    await pool.query('CREATE TABLE proof_indexer.meta (key text PRIMARY KEY, value jsonb NOT NULL, updated_at timestamptz NOT NULL)');
    await pool.query('CREATE TABLE public.audit6_effects (id integer PRIMARY KEY, note text NOT NULL)');
    record('isolated PostgreSQL 16 with real repository pg pool');

    const active = launch('open-transaction');
    await waitFor(() => existsSync(active.markerPath), 'real worker child transaction');
    const open = await readWorkerDatabaseSnapshot(pool);
    assert.ok(open.sessions.some((s) => s.application_name === 'proof-indexer-worker-backfill' && s.xact_start));
    assert.throws(() => assertFrozenWorkerSnapshot(open, { ...context, frozen: true,
      pids: [active.child.pid, active.child.pid + 1], mainPid: active.child.pid }), /children/u);
    record('in-flight child and PostgreSQL transaction refuse quiescent retirement');
    active.child.kill('SIGTERM');
    const stopped = await active.exit;
    assert.equal(stopped.code, 0, stopped.output);
    await waitFor(async () => (await readWorkerDatabaseSnapshot(pool)).sessions.length === 0, 'worker and child backend disconnect');
    assert.equal((await pool.query('SELECT count(*)::integer AS n FROM public.audit6_effects')).rows[0].n, 0);
    assert.deepEqual((await readWorkerDatabaseSnapshot(pool)).worker, baseline);
    record('actual requestWorkerStop/runScript kills active child; PostgreSQL rolls back uncommitted rows and retains completed metadata');

    const idle = launch('idle-race');
    await waitFor(() => existsSync(idle.markerPath), 'idle pre-child boundary');
    idle.child.kill('SIGSTOP');
    await waitFor(() => /State:\s+T/u.test(readFileSync(`/proc/${idle.child.pid}/status`, 'utf8')), 'kernel stop');
    const before = await readWorkerDatabaseSnapshot(pool);
    assertFrozenWorkerSnapshot(before, { ...context, frozen: true, pids: [idle.child.pid], mainPid: idle.child.pid });
    await delay(1200); // Beyond the timer that would otherwise create a child.
    assert.equal(readFileSync(`/proc/${idle.child.pid}/task/${idle.child.pid}/children`, 'utf8').trim(), '');
    idle.child.kill('SIGKILL'); // Retire without resuming a queued child-launch callback.
    await idle.exit;
    await waitFor(async () => (await readWorkerDatabaseSnapshot(pool)).sessions.length === 0, 'retired backend disconnect');
    assertRetiredWorkerSnapshot(before, await readWorkerDatabaseSnapshot(pool));
    assert.equal((await pool.query('SELECT count(*)::integer AS n FROM public.audit6_effects')).rows[0].n, 0);
    record('frozen idle parent cannot launch scheduled child; kill without resume closes actual PG backend and preserves checkpoint');

    const committed = launch('commit');
    const complete = await committed.exit;
    assert.equal(complete.code, 0, complete.output);
    assert.equal((await pool.query('SELECT count(*)::integer AS n FROM public.audit6_effects')).rows[0].n, 1);
    const final = await readWorkerDatabaseSnapshot(pool);
    assertRetiredWorkerSnapshot(before, final);
    record('subsequent worker uses the real launcher and commits successfully with no old backend remaining');
    assert.throws(() => assertRetiredWorkerSnapshot(before, { ...final, worker: { ...final.worker, state: 'running' } }), /checkpoint changed/u);
    assert.throws(() => assertRetiredWorkerSnapshot(before, { ...final, sessions: before.sessions }), /sessions remain/u);
    record('changed checkpoint and surviving backend both fail closed');
    console.log(JSON.stringify({ model: 'proofofwork-audit6-worker-postgresql-fixture-v1', passed: true,
      serverVersion: version, checks, sourceSha256: createHash('sha256').update(source).digest('hex'),
      extractedMetadataWriterSha256: createHash('sha256').update(writeDefinition).digest('hex'),
      limit: 'Real PostgreSQL 16, pg pool, worker child launcher/stop handler and exact metadata writer. Transaction payload is a synthetic table. SIGSTOP exercises a single parent boundary; it does not certify systemd cgroup freeze, the complete canonical backfill, production writer inventory, API routing or unit override recovery.' }, null, 2));
  } finally {
    for (const child of children) {
      try { process.kill(-child.pid, 'SIGKILL'); } catch (error) { if (error.code !== 'ESRCH') throw error; }
    }
    await pool.end();
    rmSync(temporary, { recursive: true, force: true }); // Only this invocation's synthetic fixture markers.
  }
}
