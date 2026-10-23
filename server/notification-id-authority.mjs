const TXID = /^[0-9a-f]{64}$/u;
const NETWORKS = new Set(["livenet", "testnet", "testnet4"]);
const KINDS = new Set(["id-register", "id-update", "id-transfer", "id-list", "id-seal", "id-delist", "id-buy"]);
const unavailable = message => Object.assign(new Error(message), { statusCode: 503 });
const exactPosition = item => [item.blockHeight, item.blockIndex, item.protocolVout, item.recordOrdinal]
  .every(value => Number.isSafeInteger(value) && value >= 0) && item.blockHeight > 0;
function identity(item) {
  if (!NETWORKS.has(item?.network) || item?.protocol !== "pwid1" || !TXID.test(item.txid ?? "") || !TXID.test(item.blockHash ?? "") ||
      !exactPosition(item) || item.confirmed !== true ||
      ["pending", "dropped", "orphaned"].includes(item.confirmationStatus ?? item.status)) return null;
  return JSON.stringify([item.network, item.txid, item.blockHash, item.blockHeight, item.blockIndex,
    item.protocolVout, item.recordOrdinal]);
}

// Registry activity is an independently verified lifecycle projection. Historical
// decoders can emit a rejected alias beside its accepted canonical carrier; only
// an exact carrier and canonical-position match can qualify that alias.
export function qualifyNotificationIds(items, registry, checkpoint) {
  if (!Array.isArray(items) || !Array.isArray(registry?.activity) ||
      !NETWORKS.has(registry.network) || registry.network !== checkpoint.network ||
      registry.indexedThroughBlock !== checkpoint.indexedThroughBlock ||
      registry.indexedThroughBlockHash !== checkpoint.indexedThroughBlockHash) {
    throw unavailable("Notification ID authority is unavailable at its checkpoint.");
  }
  const accepted = new Map();
  for (const event of registry.activity) {
    if (event.valid !== true || event.applied === false || event.protocolValid === false || !KINDS.has(event.kind) ||
        ["invalid", "rejected"].includes(event.status)) continue;
    const key = identity(event);
    if (!key || event.network !== registry.network) throw unavailable("Accepted ID authority lacks exact canonical carrier evidence.");
    const previous = accepted.get(key);
    if (previous && (previous.kind !== event.kind || previous.id !== event.id ||
        String(previous.eventId) !== String(event.eventId))) {
      throw unavailable("Accepted ID authority has conflicting canonical carrier evidence.");
    }
    accepted.set(key, event);
  }
  return items.map(item => {
    const canonical = accepted.get(identity(item));
    if (!canonical) return item;
    return { ...item, id: canonical.id, kind: canonical.kind, valid: true, applied: true, protocolValid: true,
      reason: canonical.reason ?? "",
      description: canonical.description ?? item.description, detail: canonical.detail ?? item.detail,
      subject: canonical.subject ?? item.subject, decodedKind: item.kind, decodedValid: item.protocolValid ?? item.valid,
      decodedReason: item.reason ?? "",
      idAuthority: { ready: true, valid: true, applied: true, model: "canonical-id-lifecycle-replay-v1",
        sourceEventId: canonical.eventId, kind: canonical.kind, id: canonical.id,
        txid: canonical.txid, protocolVout: canonical.protocolVout, recordOrdinal: canonical.recordOrdinal,
        checkpointHeight: checkpoint.indexedThroughBlock, checkpointHash: checkpoint.indexedThroughBlockHash } };
  });
}
