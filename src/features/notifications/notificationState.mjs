// Notification preferences are display state, scoped to an exact address or ID registration and network.
export function notificationAddressScope(address) {
  return /^(?:bc1|tb1|bcrt1)/iu.test(address) ? address.toLowerCase() : address;
}
export function notificationStorageKey(network, address) {
  return `pow:notifications:v1:${encodeURIComponent(network)}:${encodeURIComponent(address)}`;
}
export function emptyNotificationReadState() { return { version: 1, entries: {} }; }
function boundaries(state) { return state.readBoundaries ?? (state.readThrough ? [state.readThrough] : []); }
function boundaryState(values) {
  // Keep the non-dominated operations: a later read of an older snapshot must
  // neither forget a broader earlier read nor clear an explicit unread beyond it.
  const ordered = [...values].sort((a, b) => Date.parse(b.firstSeenAt) - Date.parse(a.firstSeenAt) || b.maxEventId - a.maxEventId || b.at - a.at);
  const retained = [];
  for (const value of ordered) if (!retained.some(previous => previous.at >= value.at && previous.maxEventId >= value.maxEventId && Date.parse(previous.firstSeenAt) >= Date.parse(value.firstSeenAt))) retained.push(value);
  return retained.length ? { readThrough: retained[0], ...(retained.length > 1 ? { readBoundaries: retained } : {}) } : {};
}
function latestBoundaryAt(state) { return boundaries(state).reduce((at, boundary) => Math.max(at, boundary.at), 0); }
export function parseNotificationReadState(raw) {
  if (raw == null) return emptyNotificationReadState();
  const parsed = JSON.parse(raw);
  if (parsed?.version !== 1 || !parsed.entries || typeof parsed.entries !== "object" || Array.isArray(parsed.entries)) {
    throw new Error("Saved notification preferences could not be read.");
  }
  const entries = {};
  for (const [id, entry] of Object.entries(parsed.entries)) {
    if (!id || !entry || typeof entry.read !== "boolean" || !Number.isSafeInteger(entry.at) || entry.at < 0) {
      throw new Error("Saved notification preferences could not be read.");
    }
    Object.defineProperty(entries, id, { value: { read: entry.read, at: entry.at }, enumerable: true, configurable: true, writable: true });
  }
  if (parsed.readBoundaries !== undefined && !Array.isArray(parsed.readBoundaries)) throw new Error("Saved notification preferences could not be read.");
  const values = [...(parsed.readBoundaries ?? []), ...(parsed.readThrough !== undefined ? [parsed.readThrough] : [])];
  for (const boundary of values) if (!boundary || !Number.isFinite(Date.parse(boundary.firstSeenAt)) || !Number.isSafeInteger(boundary.at) || boundary.at < 0 || !Number.isSafeInteger(boundary.maxEventId) || boundary.maxEventId < 0) {
    throw new Error("Saved notification preferences could not be read.");
  }
  return { version: 1, entries, ...boundaryState(values) };
}
export function mergeNotificationReadStates(left, right) {
  const entries = { ...left.entries };
  for (const [id, next] of Object.entries(right.entries)) {
    const previous = Object.hasOwn(entries, id) ? entries[id] : undefined;
    if (!previous || next.at > previous.at || (next.at === previous.at && next.read === false)) Object.defineProperty(entries, id, { value: next, enumerable: true, configurable: true, writable: true });
  }
  return { version: 1, entries, ...boundaryState([...boundaries(left), ...boundaries(right)]) };
}
export function setNotificationsRead(state, ids, read, now = Date.now()) {
  const entries = { ...state.entries };
  for (const id of ids) Object.defineProperty(entries, id, { value: { read, at: Math.max(now, (entries[id]?.at ?? 0) + 1, latestBoundaryAt(state) + 1) }, enumerable: true, configurable: true, writable: true });
  return { ...state, version: 1, entries };
}
export function setAllNotificationsRead(state, items, firstSeenAt, maxEventId, now = Date.now()) {
  if (!Number.isFinite(Date.parse(firstSeenAt)) || !Number.isSafeInteger(maxEventId) || maxEventId < 0) throw new Error("The notification read boundary is unavailable. Refresh and try again.");
  const at = Object.values(state.entries).reduce((latest, entry) => Math.max(latest, entry.at + 1), Math.max(now, latestBoundaryAt(state) + 1));
  const marked = setNotificationsRead(state, items.map(item => item.id), true, at);
  return { version: 1, entries: marked.entries, ...boundaryState([...boundaries(state), { firstSeenAt, maxEventId, at }]) };
}
export function notificationIsRead(state, item) {
  const entry = state.entries[item.id];
  if (entry?.read === true) return true;
  if (item.firstSeenAt != null && Number.isSafeInteger(item.maxEventId) && item.maxEventId >= 0) {
    const seen = typeof item.firstSeenAt === "number" ? item.firstSeenAt : Date.parse(item.firstSeenAt);
    if (Number.isFinite(seen) && boundaries(state).some(boundary => seen <= Date.parse(boundary.firstSeenAt) && item.maxEventId <= boundary.maxEventId && (!entry || boundary.at > entry.at))) return true;
  }
  return false;
}

// Raw observations without stable event fences are read by explicit transaction
// identity. A snapshot may include those IDs from pages not yet loaded.
export function notificationSnapshotReadIds(response) {
  return [...new Set([...response.items.map(item => item.id), ...(response.readBoundary?.explicitIds ?? [])])];
}
export function notificationHasUnloadedUnread(state, response) {
  if (!response?.hasMore) return false;
  const loaded = new Set(response.items.map(item => item.id));
  const explicit = response.readBoundary?.explicitIds ?? [];
  if (explicit.some(id => !loaded.has(id) && !notificationIsRead(state, { id }))) return true;
  if (new Set([...loaded, ...explicit]).size >= response.totalCount) return false;
  const boundary = response.readBoundary, marked = state.readThrough;
  return !marked || !boundary?.maxFirstSeenAt
    || Date.parse(marked.firstSeenAt) < Date.parse(boundary.maxFirstSeenAt)
    || marked.maxEventId < boundary.maxEventId
    || Object.entries(state.entries).some(([id, entry]) => !entry.read && entry.at > marked.at && !loaded.has(id));
}

// A cursor page belongs to exactly one scope and snapshot. Do not quietly combine
// snapshots or accept a repeated cursor: either can hide history or loop forever.
export function appendNotificationPage(previous, page, requestedCursor) {
  if (!previous || !requestedCursor || requestedCursor !== previous.nextCursor
    || previous.network !== page.network || previous.address !== page.address
    || previous.scopeKey !== page.scopeKey
    || previous.scope?.type !== page.scope?.type || previous.scope?.id !== page.scope?.id
    || previous.scope?.registrationTxid !== page.scope?.registrationTxid
    || previous.snapshotId !== page.snapshotId) {
    throw new Error("Notification history changed. Refresh to continue from the latest activity.");
  }
  if (page.hasMore && (!page.nextCursor || page.nextCursor === requestedCursor)) {
    throw new Error("Notification pagination did not advance. Refresh and try again.");
  }
  const byId = new Map(previous.items.map(item => [item.id, item]));
  for (const item of page.items) byId.set(item.id, item);
  return { ...page, items: [...byId.values()] };
}


export function serializeNotificationReadState(state) {
  const entries = Object.fromEntries(Object.entries(state.entries).sort(([left], [right]) => left.localeCompare(right)));
  return JSON.stringify({ version: 1, entries, ...boundaryState(boundaries(state)) });
}

// Reconcile each browser tab's union before persisting. Canonical serialization
// makes equivalent merges converge without repeatedly triggering storage events.
export function reconcileNotificationReadStorage(storage, key, memory, change = state => state) {
  let persisted;
  try { persisted = parseNotificationReadState(storage.getItem(key)); }
  catch {
    return { state: change(memory), warning: "Read status is available for this session. Existing browser data was preserved." };
  }
  const state = change(mergeNotificationReadStates(memory, persisted));
  if (serializeNotificationReadState(state) !== serializeNotificationReadState(persisted)) {
    try { storage.setItem(key, serializeNotificationReadState(state)); }
    catch { return { state, warning: "Read status is available for this session. Browser storage could not be updated." }; }
  }
  return { state, warning: "" };
}
