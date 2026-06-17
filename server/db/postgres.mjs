import pg from "pg";

const { Pool } = pg;

export function proofIndexDatabaseUrl(env = process.env) {
  return String(
    env.POW_INDEX_DATABASE_URL ??
      env.PROOF_INDEX_DATABASE_URL ??
      env.DATABASE_URL ??
      "",
  ).trim();
}

export function proofIndexDatabaseConfigured(env = process.env) {
  return Boolean(proofIndexDatabaseUrl(env));
}

export function createProofIndexPool(options = {}) {
  const env = options.env ?? process.env;
  const connectionString = options.connectionString ?? proofIndexDatabaseUrl(env);

  if (!connectionString) {
    throw new Error(
      "POW_INDEX_DATABASE_URL, PROOF_INDEX_DATABASE_URL, or DATABASE_URL is required.",
    );
  }

  return new Pool({
    application_name: String(env.POW_INDEX_DB_APP_NAME ?? "proof-indexer"),
    connectionString,
    connectionTimeoutMillis: Number(env.POW_INDEX_DB_CONNECT_TIMEOUT_MS ?? 10_000),
    idleTimeoutMillis: Number(env.POW_INDEX_DB_IDLE_TIMEOUT_MS ?? 30_000),
    max: Number(env.POW_INDEX_DB_POOL_MAX ?? 4),
    statement_timeout: Number(env.POW_INDEX_DB_STATEMENT_TIMEOUT_MS ?? 120_000),
  });
}

export async function withProofIndexClient(callback, options = {}) {
  const pool = options.pool ?? createProofIndexPool(options);
  const shouldEndPool = !options.pool;
  const client = await pool.connect();

  try {
    return await callback(client, pool);
  } finally {
    client.release();
    if (shouldEndPool) {
      await pool.end();
    }
  }
}
