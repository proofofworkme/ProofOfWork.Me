import assert from "node:assert/strict";
import test from "node:test";
import { buildFencedRegistryObservation, publicFencedRegistryPayload, registryRecordObservation, registryObservationHash } from "./registry-provenance.mjs";
import { readCompleteRegistryObservation } from "./db/registry-observation-reader.mjs";

const txid = (n) => n.toString(16).padStart(64, "0");
const tip = { height: 966131, blockHash: "a".repeat(64) };
function fixture(records = [{ id: "first-id", txid: txid(1), confirmed: true }]) {
  const payload = { network: "livenet", indexedThroughBlock: tip.height, indexedThroughBlockHash: tip.blockHash,
    snapshotId: "d".repeat(24), records, listings: [], sales: [], activity: [], pendingEvents: [], stats: { total: records.length } };
  const observation = { model: "proof-registry-indexed-mvcc-v1", complete: true, checkpoint: { ...tip }, consistencyOk: true,
    scanStatus: "block-scan-current", tipHeight: tip.height, snapshotId: payload.snapshotId, records: registryRecordObservation(records) };
  return { payload, observation };
}
function dependencies(indexed = fixture(), mempool = [[], []], tips = [tip, tip]) {
  return {
    readTip: async () => tips.shift(), readMempool: async () => mempool.shift(), readIndexed: async () => indexed,
    reconcileListings: async (payload, checkpoint) => ({ payload, evidence: { model: "proof-registry-core-gettxout-v1", checkpoint,
      includeMempool: true, anchoredListingCount: 0, legacyUnanchoredListingCount: payload.listings.length,
      inputListingCount: payload.listings.length, outputListingCount: payload.listings.length, spentListingCount: 0,
      unspentListingCount: 0, checkedOutpointsSha256: registryObservationHash([]) } }),
  };
}

test("complete canonical indexed records retain both physical registration outcomes", async () => {
  const input = fixture([{ id: "first-id", txid: txid(1), protocolVout: 1, confirmed: true }, { id: "second-id", txid: txid(1), protocolVout: 3, confirmed: true }]);
  const result = await buildFencedRegistryObservation("livenet", dependencies(input));
  assert.deepEqual(result.records.map((row) => row.id), ["first-id", "second-id"]);
  assert.equal(result.provenance.completeCollections.records, true);
  assert.equal(result.provenance.authoritySource, "complete-indexed-canonical-scan+core-fence");
  assert.equal(result.totalCounts.records, 2); assert.equal(result.collectionHasMore.records, false);
  assert.equal(result.snapshotId, result.provenance.snapshotId);
  assert.equal(result._powRegistryIndexedAuthority, undefined);
});

test("same-height dropped pending candidates disappear from every collection and count", async () => {
  const input = fixture([{ id: "confirmed", txid: txid(1), confirmed: true }, { id: "pending", txid: txid(2), confirmed: false }]);
  input.payload.pendingEvents = [{ txid: txid(2), kind: "update", confirmed: false }];
  input.payload.activity = [{ txid: txid(2), kind: "id-update", confirmed: false }];
  input.payload.sales = [{ txid: txid(2), confirmed: false, priceSats: 546 }];
  const prior = await buildFencedRegistryObservation("livenet", dependencies(input, [[txid(2)], [txid(2)]]));
  const next = await buildFencedRegistryObservation("livenet", dependencies(input));
  assert.equal(prior.records.length, 2); assert.equal(next.records.length, 1);
  assert.equal(next.pendingEvents.length, 0); assert.equal(next.sales.length, 0); assert.equal(next.activity.length, 0);
  assert.equal(next.stats.pending, 0); assert.equal(next.stats.pendingSales, 0); assert.equal(next.stats.pendingSalesVolumeSats, 0);
  assert.notEqual(next.snapshotId, prior.snapshotId);
  assert.match(next.provenance.pendingAuthority, /best-effort.*indexed-candidates/u);
});

test("stable candidate membership tolerates unrelated mempool arrivals, but moving candidates/Core fail", async () => {
  const input = fixture([{ id: "pending", txid: txid(2), confirmed: false }]);
  await assert.rejects(buildFencedRegistryObservation("livenet", dependencies(input, [[txid(2)], []])), /membership changed/u);
  await assert.rejects(buildFencedRegistryObservation("livenet", dependencies(fixture(), [[], []], [tip, { ...tip, blockHash: "b".repeat(64) }])), /checkpoint/u);
  const result = await buildFencedRegistryObservation("livenet", dependencies(input, [[txid(2)], [txid(2), txid(3)]]));
  assert.equal(result.records.length, 1);
});

test("legacy full hydration and compact summaries do not acquire canonical record authority", () => {
  const payload = { ...fixture().payload, _powRegistryParityAuthority: { model: "proof-registry-first-party-fenced-v1" } };
  const result = publicFencedRegistryPayload(payload);
  assert.equal(result._powRegistryParityAuthority, undefined); assert.equal(result.provenance, undefined);
  assert.equal(publicFencedRegistryPayload({ records: [] }).provenance, undefined);
});

test("altered records, partial scans, bad raw fences and malformed pending identity fail closed", async () => {
  for (const mutate of [
    (x) => { x.payload.records[0].ownerAddress = "unproven-correction"; },
    (x) => { x.payload.records = []; },
    (x) => { x.observation.complete = false; },
    (x) => { x.observation.consistencyOk = false; },
    (x) => { x.observation.scanStatus = "block-scan-pending"; },
    (x) => { x.observation.checkpoint.blockHash = "b".repeat(64); },
    (x) => { x.payload.records.push({ id: "bad", txid: "bad", confirmed: false }); },
    (x) => { x.payload.records.push({ ...x.payload.records[0] }); },
  ]) {
    const input = fixture(); mutate(input);
    await assert.rejects(buildFencedRegistryObservation("livenet", dependencies(input)), { statusCode: 503, code: "REGISTRY_COMPLETE_OBSERVATION_UNPROVEN" });
  }
});

function databaseFixture() {
  const indexed = fixture();
  Object.assign(indexed.payload.records[0], { ownerAddress: "owner", receiveAddress: "receiver", lastEventTxid: txid(1), blockHeight: tip.height, blockIndex: 0, blockHash: tip.blockHash, protocolVout: 1, recordOrdinal: 0, updatedHeight: tip.height });
  indexed.payload.activity = [{ ...indexed.payload.records[0], kind: "id-register" }]; const queries = []; let releases = 0;
  const client = { query: async (sql) => { queries.push(sql); return { rows: sql.startsWith("SELECT block_hash") ? [{ block_hash: tip.blockHash }] : [] }; }, release: () => { releases += 1; } };
  const pool = { connect: async () => client, query: () => assert.fail("all reads must use one checked-out client") };
  const scan = { snapshot_id: indexed.payload.snapshotId, indexed_through_block: tip.height, payload: { complete: true, tipHeight: tip.height, indexedThroughBlockHash: tip.blockHash }, consistency: { ok: true, status: "block-scan-current" } };
  const callbacks = { loadScan: async (actual) => { assert.equal(actual, client); return scan; }, loadPayload: async (actual, network, options) => {
    assert.equal(actual, client); assert.equal(network, "livenet"); assert.equal(options.expectedHeight, tip.height);
    assert.equal(options.allowIncompleteScan, undefined); assert.equal(options.skipIndexedListingSpendFilter, true);
    return indexed.payload;
  } };
  return { indexed, queries, client, pool, scan, callbacks, releases: () => releases };
}
const readOptions = { expectedHeight: tip.height, expectedHash: tip.blockHash, registryAddress: "registry" };

test("indexed observation uses one read-only MVCC client, complete scan and exact block", async () => {
  const f = databaseFixture(); const result = await readCompleteRegistryObservation(f.pool, "livenet", readOptions, f.callbacks);
  assert.match(f.queries[0], /REPEATABLE READ READ ONLY/u); assert.equal(f.queries.at(-1), "COMMIT"); assert.equal(f.releases(), 1);
  assert.equal(result.observation.complete, true); assert.deepEqual(result.observation.records, registryRecordObservation(f.indexed.payload.records));
});

test("incomplete/mismatched scan and partial collections roll back and release", async () => {
  for (const mutate of [
    (f) => { f.scan.payload.complete = false; }, (f) => { f.scan.consistency.ok = false; },
    (f) => { f.scan.consistency.status = "block-scan-pending"; }, (f) => { f.scan.payload.tipHeight += 1; },
    (f) => { f.scan.payload.indexedThroughBlockHash = "b".repeat(64); },
    (f) => { f.indexed.payload.snapshotId = "other"; }, (f) => { f.indexed.payload.collectionHasMore = { records: true }; },
    (f) => { f.indexed.payload.stats.total = 2; },
    (f) => { f.indexed.payload.records[0].ownerAddress = "stale-owner"; },
    (f) => { f.indexed.payload.activity = []; },
  ]) {
    const f = databaseFixture(); mutate(f);
    await assert.rejects(readCompleteRegistryObservation(f.pool, "livenet", readOptions, f.callbacks), { statusCode: 503 });
    assert.equal(f.queries.at(-1), "ROLLBACK"); assert.equal(f.releases(), 1);
  }
});

test("failed registry pool acquisition is bounded and releases a late client", async () => {
  let resolve; let released = 0;
  const promise = readCompleteRegistryObservation({ connect: () => new Promise((done) => { resolve = done; }) }, "livenet", readOptions, {});
  await assert.rejects(promise, /pool is busy/u);
  resolve({ release: () => { released += 1; } }); await new Promise((done) => setImmediate(done));
  assert.equal(released, 1);
});
