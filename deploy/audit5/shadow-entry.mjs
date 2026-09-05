// Root reads this static source before dropping UID; no secret enters argv.
import { pathToFileURL } from 'node:url';
import { realpathSync, statSync, readdirSync } from 'node:fs';
import { userInfo } from 'node:os';

export function readonlyDatabaseUrl(env) {
  const raw = String(env.POW_INDEX_DATABASE_URL ?? env.PROOF_INDEX_DATABASE_URL ?? env.DATABASE_URL ?? '').trim();
  if (!raw) throw new Error('DATABASE_CONFIGURATION_UNAVAILABLE');
  const url = new URL(raw);
  if (!['postgres:', 'postgresql:'].includes(url.protocol)) throw new Error('DATABASE_PROTOCOL_UNSUPPORTED');
  url.searchParams.set('options', '-c search_path=pg_catalog,\\ pg_temp -c default_transaction_read_only=on');
  return url.toString();
}

export function verifyReadOnlySettings(rows) {
  if (rows.transaction_read_only !== 'on' || rows.default_transaction_read_only !== 'on' ||
      rows.database !== 'proof_indexer' || String(rows.search_path).replace(/\s+/gu, '') !== 'pg_catalog,pg_temp') {
    throw new Error('READ_ONLY_POOL_SETTINGS_REJECTED');
  }
}

export function onlyPrimaryGroup(groups, primaryGid) {
  // Node includes effective GID in getgroups(), even after Python setgroups([]).
  return groups.every((gid) => gid === primaryGid);
}

export async function runShadow() {
  let pool;
  try {
    if (process.version !== 'v24.18.0' || userInfo().username !== 'powadmin' ||
        !onlyPrimaryGroup(process.getgroups(), process.getgid()) ||
        process.env.HOST !== '127.0.0.1' || process.env.PORT !== '18081' || process.env.POW_INDEX_DB_POOL_MAX !== '2' ||
        !/^\/opt\/proofofwork-api-stage-[0-9a-f]{12}-[0-9]{8}T[0-9]{6}Z$/u.test(process.cwd())) {
      throw new Error('SHADOW_RUNTIME_REJECTED');
    }
    const cwd = process.cwd();
    const release = cwd.slice('/opt/proofofwork-api-stage-'.length);
    const cache = `/data/proofofwork-api-cache-shadow-${release}`;
    const info = statSync(cache);
    if (realpathSync(cwd) !== cwd || process.env.POW_API_CACHE_DIR !== cache || realpathSync(cache) !== cache ||
        !info.isDirectory() || info.uid !== process.getuid() || info.gid !== process.getgid() ||
        (info.mode & 0o777) !== 0o700 || readdirSync(cache).length !== 0) {
      throw new Error('SHADOW_CACHE_REJECTED');
    }
    process.env.POW_INDEX_DATABASE_URL = readonlyDatabaseUrl(process.env);
    const { createProofIndexPool } = await import(pathToFileURL(`${cwd}/server/db/postgres.mjs`).href);
    pool = createProofIndexPool();
    const client = await pool.connect();
    try {
      const settings = {};
      for (const name of ['transaction_read_only', 'default_transaction_read_only', 'search_path']) {
        settings[name] = (await client.query(`SHOW ${name}`)).rows[0]?.[name];
      }
      settings.database = (await client.query('SELECT current_database() AS database')).rows[0]?.database;
      verifyReadOnlySettings(settings);
    } finally {
      client.release();
    }
    await pool.end();
    pool = null;
    process.stdout.write('private_shadow readonly_pool=verified search_path=verified database=verified\n');
    await import(pathToFileURL(`${cwd}/server/proof-api.mjs`).href);
  } catch {
    if (pool) {
      try { await pool.end(); } catch { /* never log a private URL error */ }
    }
    process.stderr.write('private_shadow status=failed code=READ_ONLY_ENTRYPOINT\n');
    process.exit(1);
  }
}

if (process.env.POW_AUDIT5_SHADOW_EXEC === '1') await runShadow();
