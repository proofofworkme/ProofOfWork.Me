import { createHash } from "node:crypto";
import { isDeepStrictEqual } from "node:util";

export const REGISTRY_COLLECTIONS = Object.freeze(["records", "listings", "sales", "activity", "pendingEvents"]);
const hash = (value) => /^[0-9a-f]{64}$/u.test(String(value ?? ""));
const count = (value) => Number.isSafeInteger(value) && value >= 0;
export const registryObservationHash = (value) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
export function registryObservationUnavailable(message) {
  return Object.assign(new Error(message), { statusCode: 503, code: "REGISTRY_COMPLETE_OBSERVATION_UNPROVEN" });
}
function checkpointValid(tip) { return Number.isSafeInteger(tip?.height) && tip.height > 0 && hash(tip.blockHash); }
function collectionShape(payload) {
  return REGISTRY_COLLECTIONS.every((name) => Array.isArray(payload?.[name])) &&
    payload.records.every((row) => row && typeof row.id === "string" && row.id.length > 0 && hash(row.txid) && typeof row.confirmed === "boolean") &&
    new Set(payload.records.map((row) => row.id.toLowerCase())).size === payload.records.length;
}
export function registryRecordObservation(records) {
  return records.map((row) => ({ txid: row.txid, confirmed: row.confirmed, sha256: registryObservationHash(row) }));
}
/** Compare the complete materialized record table to accepted raw-bound ID
 * events from the same MVCC snapshot; this folds state, not raw transactions. */
export function assertRegistryRecordLifecycleParity(payload) {
  const kinds = new Set(["id-register", "id-update", "id-transfer", "id-buy"]);
  const events = payload.activity.filter((row) => row?.confirmed === true && kinds.has(row.kind));
  const orderFields = ["blockHeight", "blockIndex", "protocolVout", "recordOrdinal"];
  const positions = new Set();
  for (const event of events) {
    if (!hash(event.txid) || !hash(event.blockHash) || typeof event.id !== "string" || !event.id ||
        orderFields.some((key) => !Number.isSafeInteger(event[key]) || event[key] < (key === "blockHeight" ? 1 : 0))) throw registryObservationUnavailable("Accepted registry lifecycle has an incomplete canonical position.");
    const key = orderFields.map((name) => event[name]).join(":");
    if (positions.has(key)) throw registryObservationUnavailable("Accepted registry lifecycle repeats a canonical position.");
    positions.add(key);
  }
  events.sort((left, right) => {
    for (const key of orderFields) if (left[key] !== right[key]) return left[key] - right[key];
    return 0;
  });
  const state = new Map();
  for (const event of events) {
    const id = event.id.toLowerCase(); const current = state.get(id);
    if (event.kind === "id-register") {
      if (current || !event.ownerAddress || !event.receiveAddress) throw registryObservationUnavailable("Accepted registry registration state is inconsistent.");
      state.set(id, { ownerAddress: event.ownerAddress, receiveAddress: event.receiveAddress, pgpKey: event.pgpKey ?? "", txid: event.txid,
        lastEventTxid: event.txid, blockHeight: event.blockHeight, blockIndex: event.blockIndex, blockHash: event.blockHash,
        protocolVout: event.protocolVout, recordOrdinal: event.recordOrdinal, updatedHeight: event.blockHeight });
      continue;
    }
    if (!current || !event.receiveAddress) throw registryObservationUnavailable("Accepted registry mutation has no complete registration state.");
    const ownerAddress = event.kind === "id-update" ? current.ownerAddress : event.ownerAddress ?? event.buyerAddress;
    if (!ownerAddress) throw registryObservationUnavailable("Accepted registry mutation has no owner.");
    state.set(id, { ...current, ownerAddress, receiveAddress: event.receiveAddress, lastEventTxid: event.txid, updatedHeight: event.blockHeight });
  }
  const records = payload.records.filter((row) => row.confirmed === true);
  if (records.length !== state.size) throw registryObservationUnavailable("Confirmed registry records do not exhaust accepted lifecycle state.");
  for (const record of records) {
    const expected = state.get(record.id.toLowerCase());
    if (!expected || Object.entries(expected).some(([key, value]) => (key === "pgpKey" ? record[key] ?? "" : record[key]) !== value)) throw registryObservationUnavailable(`Confirmed ID ${record.id} disagrees with its accepted canonical lifecycle.`);
  }
}
function mempoolSet(value) {
  if (!Array.isArray(value) || value.some((txid) => !hash(txid)) || new Set(value).size !== value.length) throw registryObservationUnavailable("Current Core mempool membership is unavailable for the registry.");
  return new Set(value);
}
const observationMembers = (candidates, membership) => candidates.filter((txid) => membership.has(txid));

/** Fresh record authority comes from one complete indexed MVCC observation.
 * Core membership only filters pending candidates; it does not promise that the
 * index already contains every new mempool registration. */
export async function buildFencedRegistryObservation(network, { readTip, readMempool, readIndexed, reconcileListings }) {
  if (network !== "livenet") throw registryObservationUnavailable("Canonical registry observation requires livenet.");
  const before = await readTip();
  if (!checkpointValid(before)) throw registryObservationUnavailable("The initial Core registry checkpoint is unavailable.");
  const beforeMempool = mempoolSet(await readMempool());
  const indexed = await readIndexed(before);
  if (!indexed?.observation || !collectionShape(indexed.payload)) throw registryObservationUnavailable("The complete indexed registry observation is unavailable.");
  const observed = indexed.payload;
  const candidateTxids = [...new Set(REGISTRY_COLLECTIONS.flatMap((name) => observed[name]
    .filter((row) => row?.confirmed !== true).map((row) => row?.txid)))].sort();
  if (candidateTxids.some((txid) => !hash(txid))) throw registryObservationUnavailable("Pending registry candidates have incomplete transaction identities.");
  const beforeMembers = observationMembers(candidateTxids, beforeMempool);
  const payload = { ...observed, ...Object.fromEntries(REGISTRY_COLLECTIONS.map((name) => [name,
    observed[name].filter((row) => row?.confirmed === true || beforeMempool.has(row?.txid)),
  ])) };
  const reconciled = await reconcileListings(payload, before);
  const afterMempool = mempoolSet(await readMempool());
  const after = await readTip();
  if (!isDeepStrictEqual(before, after) || !isDeepStrictEqual(beforeMembers, observationMembers(candidateTxids, afterMempool))) throw registryObservationUnavailable("The Core registry checkpoint or pending candidate membership changed during the read.");
  if (!collectionShape(reconciled?.payload)) throw registryObservationUnavailable("The reconciled registry observation is incomplete.");
  const result = reconciled.payload;
  const confirmed = result.records.filter((row) => row.confirmed).length;
  const confirmedSales = result.sales.filter((row) => row.confirmed === true);
  const pendingSales = result.sales.filter((row) => row.confirmed !== true);
  const salesVolume = (rows) => rows.reduce((total, row) => {
    if (!count(row.priceSats) || !Number.isSafeInteger(total + row.priceSats)) throw registryObservationUnavailable("Registry sale totals are not exact integers.");
    return total + row.priceSats;
  }, 0);
  const confirmedVolume = salesVolume(confirmedSales); const pendingVolume = salesVolume(pendingSales);
  return publicFencedRegistryPayload({
    ...result,
    totalCounts: { ...result.totalCounts, ...Object.fromEntries(REGISTRY_COLLECTIONS.map((name) => [name, result[name].length])) },
    collectionHasMore: { ...result.collectionHasMore, ...Object.fromEntries(REGISTRY_COLLECTIONS.map((name) => [name, false])) },
    hasMore: false,
    stats: { ...result.stats, confirmed, total: result.records.length,
      pendingRecords: result.records.length - confirmed, pendingChanges: result.pendingEvents.length,
      pending: result.records.length - confirmed + result.pendingEvents.length,
      activeListings: result.listings.length, listingCount: result.listings.length, listings: result.listings.length,
      confirmedSales: confirmedSales.length, pendingSales: pendingSales.length, sales: result.sales.length,
      confirmedSalesVolumeSats: confirmedVolume, pendingSalesVolumeSats: pendingVolume, salesVolumeSats: salesVolume(result.sales),
      transactions: new Set((result.activity.length ? result.activity : REGISTRY_COLLECTIONS.flatMap((name) => result[name])).map((row) => row.txid).filter(Boolean)).size,
    },
    _powRegistryIndexedAuthority: {
      model: "proof-registry-indexed-core-fenced-v1", network, core: { before, after },
      indexed: indexed.observation, listingReconciliation: reconciled.evidence,
      pending: { model: "core-membership-filtered-indexed-candidates-v1", candidateTxids,
        retainedTxids: beforeMembers, beforeSha256: registryObservationHash(beforeMembers), afterSha256: registryObservationHash(observationMembers(candidateTxids, afterMempool)) },
      generatedAt: new Date().toISOString(),
    },
  });
}

/** Legacy first-party hydration is useful history, but does not attest modern
 * per-carrier replay semantics. Only the complete indexed/Core fence below may
 * authorize replacing a canonical registry observation. */
export function publicFencedRegistryPayload(payload) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return payload;
  const { _powRegistryParityAuthority: _legacy, _powRegistryIndexedAuthority: fence, ...publicPayload } = payload;
  if (!fence) return publicPayload;
  const fail = () => { throw registryObservationUnavailable("The complete registry observation lost its authority fence."); };
  const tip = fence.core?.before; const indexed = fence.indexed; const pending = fence.pending; const listing = fence.listingReconciliation;
  if (fence.model !== "proof-registry-indexed-core-fenced-v1" || fence.network !== "livenet" || payload.network !== fence.network ||
      !checkpointValid(tip) || !isDeepStrictEqual(tip, fence.core?.after) ||
      payload.indexedThroughBlock !== tip.height || payload.indexedThroughBlockHash !== tip.blockHash ||
      indexed?.model !== "proof-registry-indexed-mvcc-v1" || indexed.complete !== true || indexed.consistencyOk !== true || indexed.scanStatus !== "block-scan-current" ||
      !indexed.snapshotId || indexed.tipHeight !== tip.height || !isDeepStrictEqual(indexed.checkpoint, tip) ||
      !collectionShape(payload) || payload.collectionHasMore?.records !== false || payload.totalCounts?.records !== payload.records.length ||
      !Array.isArray(indexed.records) || indexed.records.some((row) => !hash(row.txid) || !hash(row.sha256) || typeof row.confirmed !== "boolean") ||
      pending?.model !== "core-membership-filtered-indexed-candidates-v1" || !Array.isArray(pending.candidateTxids) || !Array.isArray(pending.retainedTxids) ||
      pending.candidateTxids.some((txid) => !hash(txid)) || pending.retainedTxids.some((txid) => !pending.candidateTxids.includes(txid)) ||
      pending.beforeSha256 !== registryObservationHash(pending.retainedTxids) || pending.afterSha256 !== pending.beforeSha256 ||
      listing?.model !== "proof-registry-core-gettxout-v1" || listing.includeMempool !== true || !isDeepStrictEqual(listing.checkpoint, tip) ||
      !hash(listing.checkedOutpointsSha256) || !count(listing.anchoredListingCount) || !count(listing.legacyUnanchoredListingCount) || !count(listing.inputListingCount) || !count(listing.outputListingCount) || !count(listing.spentListingCount) || !count(listing.unspentListingCount) ||
      listing.anchoredListingCount + listing.legacyUnanchoredListingCount !== listing.inputListingCount || listing.spentListingCount + listing.unspentListingCount !== listing.anchoredListingCount || listing.outputListingCount !== payload.listings.length || listing.outputListingCount + listing.spentListingCount !== listing.inputListingCount) fail();
  const retained = new Set(pending.retainedTxids);
  const expectedRecords = indexed.records.filter((row) => row.confirmed || retained.has(row.txid));
  if (!isDeepStrictEqual(expectedRecords, registryRecordObservation(payload.records))) fail();
  const snapshotId = registryObservationHash({ network: payload.network, checkpoint: tip, collections: Object.fromEntries(REGISTRY_COLLECTIONS.map((name) => [name, payload[name]])) });
  return { ...publicPayload, snapshotId, provenance: {
    contract: "proof-of-work-canonical-registry-v1", network: payload.network, surface: "registry",
    ready: true, coherent: true, served: "exact-tip", indexedThroughBlock: tip.height, indexedThroughBlockHash: tip.blockHash,
    tipHeight: tip.height, tipHash: tip.blockHash, snapshotId, completeCollections: { records: true },
    authoritySource: "complete-indexed-canonical-scan+core-fence", pendingAuthority: "best-effort-core-membership-filtered-indexed-candidates", generatedAt: fence.generatedAt,
  } };
}
