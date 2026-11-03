// The worker advances the discovery fence in the same transaction as these
// observations. Read the fence and observations in one repeatable-read snapshot.
const hash = /^[0-9a-f]{64}$/u;
function unavailable() {
  return Object.assign(new Error("Confirmed linked-file activity is not available at this checkpoint."), { statusCode: 503 });
}

export async function readPowcatActivity(pool, network, checkpoint) {
  const { height, hash: blockHash, verify } = checkpoint;
  if (!pool || network !== "livenet" || !Number.isSafeInteger(height) || height < 1 ||
      !hash.test(blockHash) || typeof verify !== "function") throw unavailable();
  const client = await pool.connect();
  try {
    await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
    await client.query("SET LOCAL statement_timeout = '5s'");
    const marker = (await client.query("SELECT value FROM proof_indexer.meta WHERE key = $1",
      [network + ":powcat1:discovery:v1"])).rows[0]?.value;
    if (marker?.model !== "powcat1-discovery-v1" || marker.network !== network || marker.complete !== true ||
        marker.fromHeight !== 973975 || marker.anchorHash !== "0000000000000000000197a8d7eeab4e20eae8693e7bb933edd89a75031933e3" || marker.fromHeight > height ||
        marker.indexedThroughBlock !== height || marker.indexedThroughBlockHash !== blockHash) throw unavailable();
    const canonicalTip = await client.query("SELECT block_hash FROM proof_indexer.blocks WHERE network=$1 AND height=$2 AND canonical", [network, height]);
    if (canonicalTip.rows.length !== 1 || canonicalTip.rows[0].block_hash !== blockHash) throw unavailable();
    const { rows: [row] } = await client.query(`
      SELECT count(*) AS carriers, count(DISTINCT e.txid) AS transactions,
        count(*) FILTER (WHERE e.kind = 'powcat-part') AS parts,
        coalesce(sum((e.payload #>> '{powcat,size}')::bigint) FILTER (WHERE e.kind = 'powcat-part'), 0) AS part_bytes,
        count(*) FILTER (WHERE e.kind = 'powcat-linker') AS linkers,
        count(DISTINCT e.payload #>> '{powcat,fileHash}') FILTER (WHERE e.kind = 'powcat-linker') AS distinct_files,
        coalesce(sum((e.payload #>> '{powcat,size}')::bigint) FILTER (WHERE e.kind = 'powcat-linker'), 0) AS published_bytes,
        count(*) FILTER (WHERE b.block_hash IS NULL OR e.amount_sats <> 0 OR
          (e.payload #>> '{powcat,size}') IS NULL OR (e.payload #>> '{powcat,size}')::bigint NOT BETWEEN 1 AND
            CASE WHEN e.kind = 'powcat-part' THEN 96000 ELSE 4000000 END OR
          coalesce(e.payload #>> '{powcat,fileHash}', '') !~ '^[0-9a-f]{64}$') AS inconsistent,
        count(t.fee_sats) FILTER (WHERE t.fee_sats >= 0) AS known_fees, coalesce(sum(t.fee_sats), 0) AS miner_fees
      FROM proof_indexer.events e
      LEFT JOIN proof_indexer.transactions t ON t.network=e.network AND t.txid=e.txid AND
        t.status='confirmed' AND t.block_height=e.block_height
      LEFT JOIN proof_indexer.blocks b ON b.network=t.network AND b.block_hash=t.block_hash AND b.height=t.block_height AND b.canonical
      WHERE e.network=$1 AND e.protocol='powcat1' AND e.kind IN ('powcat-part','powcat-linker') AND
        e.valid AND e.status='confirmed' AND e.block_height BETWEEN $2 AND $3
    `, [network, marker.fromHeight, height]);
    if (!row || row.carriers !== row.transactions || Number(row.inconsistent) !== 0 ||
        !Number.isSafeInteger(marker.confirmedParts) || !Number.isSafeInteger(marker.confirmedLinkers) ||
        String(marker.confirmedParts) !== row.parts || String(marker.confirmedLinkers) !== row.linkers ||
        ![row.parts, row.linkers, row.part_bytes, row.distinct_files, row.published_bytes, row.miner_fees]
          .every(value => /^(?:0|[1-9][0-9]*)$/u.test(value))) throw unavailable();
    if (await verify(height) !== blockHash) throw unavailable();
    await client.query("COMMIT");
    return { source: "powcat1-discovery-v1", complete: true, network, fromHeight: marker.fromHeight,
      indexedThroughBlock: height, indexedThroughBlockHash: blockHash,
      parts: row.parts, partBytes: row.part_bytes, publications: row.linkers, distinctFiles: row.distinct_files,
      publishedBytes: row.published_bytes, minerFeeProofs: row.known_fees === row.carriers ? row.miner_fees : null };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally { client.release(); }
}
