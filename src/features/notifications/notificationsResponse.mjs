const TXID = /^[a-f0-9]{64}$/iu;
const record = value => value !== null && typeof value === "object" && !Array.isArray(value);
const optionalString = value => value == null || typeof value === "string";
const optionalPosition = value => value == null || (Number.isSafeInteger(value) && value >= 0);
const fail = () => { throw new Error("The notification service returned incomplete activity. Refresh to retry."); };
function matchesScope(response, query) {
  if (query.id !== undefined) return query.address === undefined && response.address === null && record(response.scope)
    && response.scope.type === "id" && response.scope.id === query.id
    && typeof response.scope.registrationTxid === "string" && /^[a-f0-9]{64}$/u.test(response.scope.registrationTxid)
    && response.scopeKey === `id:${response.scope.registrationTxid}`;
  if (response.address !== query.address) return false;
  // Existing address clients retain their exact storage and transport scope.
  return response.scope === undefined && response.scopeKey === undefined
    || record(response.scope) && response.scope.type === "address" && response.scope.address === query.address
      && response.scopeKey === `address:${query.address}`;
}
function checkAction(item) {
  if (!record(item) || !TXID.test(item.txid) || typeof item.label !== "string" || typeof item.detail !== "string"
    || typeof item.app !== "string" || typeof item.kind !== "string"
    || !["incoming", "outgoing", "self", "related"].includes(item.direction)
    || !["confirmed", "pending", "dropped", "orphaned", "invalid", "unavailable"].includes(item.status)
    || !record(item.evidence) || typeof item.evidence.protocol !== "string"
    || ![true, false, null].includes(item.evidence.valid)
    || !optionalString(item.evidence.reason) || !optionalString(item.evidence.chainStatus)
    || !(item.evidence.qualification == null || typeof item.evidence.qualification === "string" || record(item.evidence.qualification))
    || !(item.evidence.amounts == null || record(item.evidence.amounts))
    || !optionalPosition(item.protocolVout) || !optionalPosition(item.recordOrdinal)
    || !(item.senderAddresses === undefined || Array.isArray(item.senderAddresses) && item.senderAddresses.every(value => typeof value === "string"))
    || !Array.isArray(item.recipientAddresses) || !item.recipientAddresses.every(value => typeof value === "string")
    || !Array.isArray(item.relatedTxids) || !item.relatedTxids.every(value => typeof value === "string" && TXID.test(value))
    || !optionalString(item.actorAddress)
    || !record(item.target) || typeof item.target.workspace !== "string" || !TXID.test(item.target.txid)) fail();
}

// This is transport/display validation, never a replacement for protocol replay.
export function validateNotificationsResponse(response, query) {
  if (!record(response) || response.model !== "proof-computer-notifications-v1" || response.network !== query.network || !matchesScope(response, query)
    || !Array.isArray(response.items) || response.items.length > 100 || !record(response.coverage)
    || typeof response.coverage.complete !== "boolean" || !Array.isArray(response.coverage.qualification)
    || !response.coverage.qualification.every(value => typeof value === "string")
    || !optionalString(response.coverage.localActions) || !optionalString(response.coverage.mentions)
    || !Number.isSafeInteger(response.totalCount) || response.totalCount < response.items.length || typeof response.hasMore !== "boolean"
    || typeof response.snapshotId !== "string" || !response.snapshotId
    || !(response.nextCursor == null || typeof response.nextCursor === "string")
    || (response.hasMore && (typeof response.nextCursor !== "string" || !response.nextCursor))) {
    throw new Error("Notification coverage is unavailable for this address or ID. Try refreshing shortly.");
  }
  if (response.readBoundary != null && (!record(response.readBoundary)
    || !(response.readBoundary.explicitIds === undefined || Array.isArray(response.readBoundary.explicitIds) && response.readBoundary.explicitIds.length <= 10_000 && response.readBoundary.explicitIds.every(id => typeof id === "string" && id.startsWith(`${query.network}:`) && TXID.test(id.slice(query.network.length + 1))))
    || !Number.isSafeInteger(response.readBoundary.maxEventId) || response.readBoundary.maxEventId < 0
    || !(response.readBoundary.maxFirstSeenAt == null || (typeof response.readBoundary.maxFirstSeenAt === "string" && Number.isFinite(Date.parse(response.readBoundary.maxFirstSeenAt)))))) fail();
  const ids = new Set();
  for (const item of response.items) {
    checkAction(item);
    if (typeof item.id !== "string" || item.id !== `${query.network}:${item.txid}` || ids.has(item.id)
      || !optionalPosition(item.maxEventId)
      || !(item.firstSeenAt == null || (typeof item.firstSeenAt === "string" && Number.isFinite(Date.parse(item.firstSeenAt))) || (typeof item.firstSeenAt === "number" && Number.isFinite(item.firstSeenAt)))
      || (item.actions !== undefined && (!Array.isArray(item.actions) || item.actions.length === 0))) fail();
    item.actions?.forEach(action => { checkAction(action); if (action.txid !== item.txid) fail(); });
    ids.add(item.id);
  }
  return response;
}
