// Local validation only. The pool is constructed but never connected.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createProofIndexPool } from '../server/db/postgres.mjs';
import { readonlyDatabaseUrl, verifyReadOnlySettings, onlyPrimaryGroup } from '../deploy/audit5/shadow-entry.mjs';

const url = new URL(readonlyDatabaseUrl({
  POW_INDEX_DATABASE_URL: 'postgresql://synthetic:dummy@127.0.0.1:5432/proof_indexer?sslmode=disable&options=-c%20statement_timeout%3D1000',
  DATABASE_URL: 'invalid-lower-precedence-fallback',
}));
assert.equal(url.pathname, '/proof_indexer');
assert.equal(url.username, 'synthetic');
assert.equal(url.password, 'dummy');
assert.equal(url.searchParams.get('sslmode'), 'disable');
assert.equal(url.searchParams.get('options'), '-c search_path=pg_catalog,\\ pg_temp -c default_transaction_read_only=on');
const pool = createProofIndexPool({ env: { POW_INDEX_DATABASE_URL: url.toString(), POW_INDEX_DB_POOL_MAX: '2' } });
assert.equal(pool.options.max, 2);
const client = new pool.Client(pool.options);
assert.equal(client.connectionParameters.options, url.searchParams.get('options'));
await pool.end();
const goodSettings = { transaction_read_only: 'on', default_transaction_read_only: 'on', search_path: 'pg_catalog, pg_temp', database: 'proof_indexer' };
verifyReadOnlySettings(goodSettings);
for (const patch of [{ transaction_read_only: 'off' }, { default_transaction_read_only: 'off' },
  { search_path: 'public, pg_catalog' }, { database: 'postgres' }]) {
  assert.throws(() => verifyReadOnlySettings({ ...goodSettings, ...patch }));
}
assert.throws(() => readonlyDatabaseUrl({ POW_INDEX_DATABASE_URL: 'https://example.invalid/db' }));
assert.equal(onlyPrimaryGroup([], 1000), true);
assert.equal(onlyPrimaryGroup([1000], 1000), true);
assert.equal(onlyPrimaryGroup([1000, 27], 1000), false);
const python = spawnSync('python3', ['-I', fileURLToPath(new URL('./check-audit5-private-launcher.py', import.meta.url))],
  { encoding: 'utf8', timeout: 60_000, env: { PATH: process.env.PATH ?? '/usr/bin:/bin', LANG: 'C.UTF-8' } });
if (python.status !== 0) {
  process.stderr.write(python.stderr || 'Synthetic Python launcher checks failed.\n');
  process.exit(1);
}
process.stdout.write(python.stderr);
console.log(JSON.stringify({ ok: true, databaseConnections: 0,
  coverage: ['capture-identity-fences', 'private-env-preservation', 'fixed-repair-scope', 'fixed-gate-argv',
    'fixed-sequenced-gate-argv', 'candidate-probe-fixed-scope', 'candidate-runner-pins',
    'actual-pool-and-pg-options-precedence', 'read-only-settings',
    'expected-database', 'primary-group-semantics'] }));
