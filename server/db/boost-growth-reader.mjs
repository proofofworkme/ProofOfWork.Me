import {
  createBoostGrowthObservation,
  unavailableBoostGrowth,
} from "../boost-growth.mjs";

const PAGE_SIZE = 25;
const READ_BUDGET_MS = 8_000;

/** Complete indexed history, within one read-only MVCC view of the Growth checkpoint. */
export async function readBoostGrowthObservation(pool, network, checkpoint, loadSnapshot) {
  if (!pool || network !== "livenet") {
    return unavailableBoostGrowth(checkpoint, "A confirmed livenet proof index is required.");
  }
  if (!Number.isSafeInteger(checkpoint?.blockHeight) || checkpoint.blockHeight < 1 ||
      !/^[0-9a-f]{64}$/u.test(checkpoint.blockHash ?? "") || !checkpoint.snapshotId) {
    return unavailableBoostGrowth(checkpoint, "Growth has no exact snapshot checkpoint.");
  }
  const startedAt = Date.now();
  let acquireTimer;
  let acquisitionExpired = false;
  const connection = pool.connect().then((client) => {
    if (!acquisitionExpired) return client;
    client.release();
    return null;
  });
  let client;
  try {
    client = await Promise.race([
      connection,
      new Promise((resolve) => { acquireTimer = setTimeout(() => { acquisitionExpired = true; resolve(null); }, 1_000); }),
    ]);
  } catch {
    return unavailableBoostGrowth(checkpoint, "The confirmed Boost index is temporarily unavailable.");
  } finally { clearTimeout(acquireTimer); }
  if (!client) return unavailableBoostGrowth(checkpoint, "The confirmed Boost index is busy; retry shortly.");
  let open = false;
  try {
    await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
    open = true;
    await client.query("SET LOCAL statement_timeout = '3000ms'");
    const snapshot = await loadSnapshot(client, network, checkpoint.snapshotId);
    if (snapshot?.snapshot_id !== checkpoint.snapshotId ||
        Number(snapshot.indexed_through_block) !== checkpoint.blockHeight ||
        snapshot.payload?.indexedThroughBlockHash !== checkpoint.blockHash) {
      throw new Error("Boost history cannot bind to the exact Growth snapshot.");
    }
    const block = await client.query(`
      SELECT block_hash FROM proof_indexer.blocks
      WHERE network = $1 AND height = $2 AND canonical = true
    `, [network, checkpoint.blockHeight]);
    if (block.rows.length !== 1 || block.rows[0].block_hash !== checkpoint.blockHash) {
      throw new Error("The Growth checkpoint is no longer canonical.");
    }

    // Do not interpret missing event projections as zero Boost activity. Every
    // indexed raw Boost carrier must have a same-position outcome, including
    // rejected outcomes, before the observational dataset is called complete.
    const coverage = await client.query(`
      SELECT EXISTS (
        SELECT 1
        FROM proof_indexer.op_returns carrier
        JOIN proof_indexer.transactions t
          ON t.network = carrier.network AND t.txid = carrier.txid
        JOIN proof_indexer.blocks b
          ON b.network = t.network AND b.height = t.block_height
         AND b.block_hash = t.block_hash AND b.canonical = true
        WHERE carrier.network = $1 AND carrier.protocol IN ('pwb1', 'pwb1:')
          AND t.status = 'confirmed' AND t.block_height <= $2
          AND NOT EXISTS (
            SELECT 1 FROM proof_indexer.events e
            WHERE e.network = carrier.network AND e.txid = carrier.txid
              AND e.protocol = 'pwb1' AND e.op_return_vout = carrier.vout
              AND e.status = 'confirmed' AND e.block_height = t.block_height
              AND e.block_index = t.block_index
          )
      ) OR EXISTS (
        SELECT 1 FROM proof_indexer.events e
        LEFT JOIN proof_indexer.transactions t
          ON t.network = e.network AND t.txid = e.txid
        LEFT JOIN proof_indexer.blocks b
          ON b.network = t.network AND b.height = t.block_height
         AND b.block_hash = t.block_hash AND b.canonical = true
        WHERE e.network = $1 AND e.protocol = 'pwb1'
          AND e.status = 'confirmed' AND e.block_height <= $2
          AND (t.status IS DISTINCT FROM 'confirmed' OR b.block_hash IS NULL
            OR e.block_height IS DISTINCT FROM t.block_height
            OR e.block_index IS DISTINCT FROM t.block_index)
      ) AS incomplete
    `, [network, checkpoint.blockHeight]);
    if (coverage.rows[0]?.incomplete !== false) {
      throw new Error("Confirmed Boost carrier and event coverage is incomplete.");
    }

    const observation = createBoostGrowthObservation(checkpoint);
    let afterTxid = "";
    while (true) {
      if (Date.now() - startedAt >= READ_BUDGET_MS) {
        throw new Error("The complete Boost observation exceeded its read budget; retry.");
      }
      const page = await client.query(`
        WITH boost_transactions AS (
          SELECT DISTINCT t.txid
          FROM proof_indexer.events e
          JOIN proof_indexer.transactions t
            ON t.network = e.network AND t.txid = e.txid
          JOIN proof_indexer.blocks b
            ON b.network = t.network AND b.height = t.block_height
           AND b.block_hash = t.block_hash AND b.canonical = true
          WHERE e.network = $1 AND e.protocol = 'pwb1'
            AND e.status = 'confirmed' AND t.status = 'confirmed'
            AND e.block_height = t.block_height AND e.block_index = t.block_index
            AND t.block_height <= $2 AND t.txid > $3
          ORDER BY t.txid LIMIT $4
        )
        SELECT t.txid, t.status, t.block_height, t.block_hash, t.block_index,
          t.raw_tx,
          jsonb_agg(jsonb_build_object(
            'protocol', e.protocol, 'kind', e.kind, 'status', e.status,
            'valid', e.valid, 'validation_errors', e.validation_errors,
            'op_return_vout', e.op_return_vout, 'record_ordinal', e.record_ordinal,
            'raw_payload', e.raw_payload, 'payload', e.payload
          ) ORDER BY e.op_return_vout, e.record_ordinal, e.event_id) AS events
        FROM boost_transactions selected
        JOIN proof_indexer.transactions t ON t.network = $1 AND t.txid = selected.txid
        JOIN proof_indexer.events e ON e.network = t.network AND e.txid = t.txid
          AND e.protocol IN ('pwb1', 'pwm1', 'pwt1')
          AND e.status = 'confirmed' AND e.block_height = t.block_height
          AND e.block_index = t.block_index
        GROUP BY t.network, t.txid
        ORDER BY t.txid
      `, [network, checkpoint.blockHeight, afterTxid, PAGE_SIZE]);
      for (const row of page.rows) observation.addTransaction(row);
      if (Date.now() - startedAt >= READ_BUDGET_MS) {
        throw new Error("The complete Boost observation exceeded its read budget; retry.");
      }
      if (page.rows.length < PAGE_SIZE) break;
      const nextTxid = page.rows.at(-1)?.txid;
      if (!nextTxid || nextTxid <= afterTxid) throw new Error("Boost history cursor did not advance.");
      afterTxid = nextTxid;
    }
    const result = observation.finish();
    await client.query("COMMIT");
    open = false;
    return result;
  } catch (error) {
    return unavailableBoostGrowth(checkpoint, error.code
      ? "The confirmed Boost index is temporarily unavailable."
      : error.message || "Boost history is unavailable.");
  } finally {
    if (open) await client.query("ROLLBACK").catch(() => {});
    client.release();
  }
}
