import { REGISTRY_COLLECTIONS, assertRegistryRecordLifecycleParity, registryRecordObservation, registryObservationUnavailable } from "../registry-provenance.mjs";

export async function readCompleteRegistryObservation(pool, network, { expectedHeight, expectedHash, registryAddress }, { loadScan, loadPayload }) {
  if (!pool || network !== "livenet" || !Number.isSafeInteger(expectedHeight) || expectedHeight < 1 || !/^[0-9a-f]{64}$/u.test(expectedHash ?? "")) throw registryObservationUnavailable("An exact indexed registry checkpoint is required.");
  let expired = false; let timer;
  const acquisition = pool.connect().then((client) => { if (!expired) return client; client.release(); return null; });
  let client;
  try { client = await Promise.race([acquisition, new Promise((resolve) => { timer = setTimeout(() => { expired = true; resolve(null); }, 1000); })]); }
  finally { clearTimeout(timer); }
  if (!client) throw registryObservationUnavailable("The indexed registry pool is busy.");
  let open = false;
  try {
    await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY"); open = true;
    await client.query("SET LOCAL statement_timeout = '5000ms'");
    await client.query("SET LOCAL lock_timeout = '1000ms'");
    const started = Date.now();
    const scan = await loadScan(client, network);
    const checkpoint = { height: expectedHeight, blockHash: expectedHash };
    const scanHash = scan?.payload?.indexedThroughBlockHash ?? scan?.payload?.blockHash ?? scan?.source_hashes?.blockScan;
    if (scan?.payload?.complete !== true || scan.consistency?.ok !== true || scan.consistency?.status !== "block-scan-current" ||
        !scan.snapshot_id || Number(scan.indexed_through_block) !== expectedHeight || Number(scan.payload.tipHeight) !== expectedHeight || scanHash !== expectedHash) throw registryObservationUnavailable("The complete registry scan is not at the exact Core checkpoint.");
    const block = await client.query("SELECT block_hash FROM proof_indexer.blocks WHERE network = $1 AND height = $2 AND canonical = true", [network, expectedHeight]);
    if (block.rows.length !== 1 || block.rows[0].block_hash !== expectedHash) throw registryObservationUnavailable("The registry scan lost its canonical block binding.");
    const payload = await loadPayload(client, network, { expectedHeight, expectedHash, registryAddress, skipIndexedListingSpendFilter: true });
    if (!payload || payload.snapshotId !== String(scan.snapshot_id) || payload.indexedThroughBlock !== expectedHeight || payload.indexedThroughBlockHash !== expectedHash ||
        REGISTRY_COLLECTIONS.some((name) => !Array.isArray(payload[name]) || payload.collectionHasMore?.[name] === true) || payload.stats?.total !== payload.records.length ||
        payload.records.some((row) => typeof row?.confirmed !== "boolean")) throw registryObservationUnavailable("The complete registry collections are not bound to one indexed snapshot.");
    assertRegistryRecordLifecycleParity(payload);
    if (Date.now() - started > 20_000) throw registryObservationUnavailable("The complete indexed registry read exceeded its budget.");
    const observation = { model: "proof-registry-indexed-mvcc-v1", checkpoint, complete: true, consistencyOk: true,
      snapshotId: String(scan.snapshot_id), scanStatus: scan.consistency.status, tipHeight: Number(scan.payload.tipHeight), records: registryRecordObservation(payload.records) };
    await client.query("COMMIT"); open = false;
    return { payload, observation };
  } finally { if (open) await client.query("ROLLBACK").catch(() => {}); client.release(); }
}
