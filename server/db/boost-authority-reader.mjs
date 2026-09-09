import { boostAuthorityWitness } from "../boost-authority.mjs";
import { boostProjectionError } from "../boost-projection.mjs";

// Raw witnesses stay private. The public projection receives only accepted
// fields and rejection reasons, never an unbounded raw transaction payload.
export async function readBoostAuthorityWitnesses(pool, network, history, loadSnapshot, loadRegistryActivity) {
  if (!pool) throw boostProjectionError("Boost transaction authority is unavailable.");
  const confirmed = history.items.filter((item) => item.confirmed === true);
  const ids = [...new Set(confirmed.map((item) => item.txid))];
  const witnesses = new Map();
  if (!ids.length) return { witnesses, ticketSpends: [], registryActivity: [] };
  let acquireTimer; let acquisitionExpired = false;
  const acquisition = pool.connect().then((client) => {
    if (!acquisitionExpired) return client;
    client.release(); return null;
  });
  let client;
  try {
    client = await Promise.race([acquisition, new Promise((resolve) => {
      acquireTimer = setTimeout(() => { acquisitionExpired = true; resolve(null); }, 1000);
    })]);
  } finally { clearTimeout(acquireTimer); }
  if (!client) throw boostProjectionError("Boost authority index is busy; retry shortly.");
  let open = false;
  const started = Date.now();
  try {
    await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY"); open = true;
    await client.query("SET LOCAL statement_timeout = '5000ms'");
    const snapshot = await loadSnapshot(client, network, history.snapshotId);
    if (snapshot?.snapshot_id !== history.snapshotId || Number(snapshot.indexed_through_block) !== history.indexedThroughBlock || snapshot.payload?.indexedThroughBlockHash !== history.indexedThroughBlockHash) throw boostProjectionError("Boost authority cannot bind to the requested snapshot.", 409);
    const block = await client.query(`SELECT block_hash, block_time FROM proof_indexer.blocks WHERE network = $1 AND height = $2 AND canonical = true`, [network, history.indexedThroughBlock]);
    if (block.rows.length !== 1 || block.rows[0].block_hash !== history.indexedThroughBlockHash) throw boostProjectionError("Boost authority checkpoint was reorganized.", 409);
    const registryActivity = (await loadRegistryActivity(client, network)).filter((item) => item.confirmed === true && item.blockHeight <= history.indexedThroughBlock);
    for (let offset = 0; offset < ids.length; offset += 100) {
      if (Date.now() - started > 15_000) throw boostProjectionError("Complete Boost authority exceeded its read budget.");
      const result = await client.query(`
        SELECT t.txid, t.status, t.block_height, t.block_hash, t.block_index, t.raw_tx,
          COALESCE((SELECT jsonb_agg(jsonb_build_object(
            'protocol', e.protocol, 'kind', e.kind, 'status', e.status,
            'valid', e.valid, 'payload', e.payload, 'op_return_vout', e.op_return_vout,
            'record_ordinal', e.record_ordinal, 'raw_payload', e.raw_payload
          )) FROM proof_indexer.events e WHERE e.network = t.network AND e.txid = t.txid
            AND e.protocol = 'pwt1' AND e.status = 'confirmed'
            AND e.block_height = t.block_height AND e.block_index = t.block_index), '[]'::jsonb) AS events
        FROM proof_indexer.transactions t
        JOIN proof_indexer.blocks b ON b.network = t.network AND b.height = t.block_height
          AND b.block_hash = t.block_hash AND b.canonical = true
        WHERE t.network = $1 AND t.txid = ANY($2::text[]) AND t.status = 'confirmed'
          AND t.block_height <= $3
      `, [network, ids.slice(offset, offset + 100), history.indexedThroughBlock]);
      for (const row of result.rows) witnesses.set(row.txid, boostAuthorityWitness(row, { ...history, network }));
    }
    if (witnesses.size !== ids.length) throw boostProjectionError("Boost canonical transaction inventory is incomplete.");
    const spends = await client.query(`
      SELECT i.prev_txid, i.prev_vout, t.txid, t.block_height, t.block_index
      FROM proof_indexer.tx_inputs i JOIN proof_indexer.transactions t
        ON t.network = i.network AND t.txid = i.txid AND t.status = 'confirmed'
      JOIN proof_indexer.blocks b ON b.network = t.network AND b.height = t.block_height
        AND b.block_hash = t.block_hash AND b.canonical = true
      WHERE i.network = $1 AND i.prev_txid = ANY($2::text[]) AND t.block_height <= $3
    `, [network, [...new Set(confirmed.filter((item) => item.kind === "boost-list").map((item) => item.txid))], history.indexedThroughBlock]);
    const ticketSpends = spends.rows.map((row) => ({ prevTxid: row.prev_txid, prevVout: row.prev_vout, txid: row.txid, blockHeight: row.block_height, blockIndex: row.block_index, protocolVout: 0, recordOrdinal: 0 }));
    await client.query("COMMIT"); open = false;
    return { witnesses, ticketSpends, registryActivity, checkpointTime: block.rows[0].block_time ? new Date(block.rows[0].block_time).toISOString() : "" };
  } finally {
    if (open) await client.query("ROLLBACK").catch(() => {});
    client.release();
  }
}
