import { createProofIndexPool, proofIndexDatabaseConfigured } from "./db/postgres.mjs";

let pool;
export async function indexedNotificationTransactions(network, txids) {
  if (!proofIndexDatabaseConfigured() || !txids.length) return new Map();
  pool ??= createProofIndexPool({ env: { ...process.env, POW_INDEX_DB_POOL_MAX: "2" } });
  const client = await pool.connect();
  try {
    await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
    await client.query("SET LOCAL statement_timeout = '15000ms'");
    const result = await client.query(`SELECT t.txid, t.raw_tx, t.block_height, t.block_hash, t.block_time
      FROM proof_indexer.transactions t JOIN proof_indexer.blocks b
        ON b.network=t.network AND b.height=t.block_height AND b.block_hash=t.block_hash AND b.canonical=true
      WHERE t.network=$1 AND t.txid=ANY($2::text[]) AND t.status='confirmed'`, [network, txids]);
    await client.query("COMMIT");
    return new Map(result.rows.map(row => [row.txid, row]));
  } catch (error) { await client.query("ROLLBACK").catch(() => {}); throw error; }
  finally { client.release(); }
}
