const TXID = /^[0-9a-f]{64}$/u;
const MAX_ROWS = 100_000;

function unavailable(message) {
  return Object.assign(new Error(message), { statusCode: 503 });
}

export function notificationIdKey(value) {
  return typeof value === "string" ? value.trim().toLowerCase().replace(/^@/u, "")
    .replace(/@proofofwork\.me$/u, "").trim() : "";
}

export function normalizeNotificationIdScope(scope) {
  if (!scope || scope.type !== "id" || !notificationIdKey(scope.id) ||
      /[\u0000-\u001f\u007f]/u.test(scope.id) || !TXID.test(scope.registrationTxid ?? "")) {
    throw Object.assign(new Error("Notifications require a registered ID identity."), { statusCode: 400 });
  }
  return { type: "id", id: notificationIdKey(scope.id), registrationTxid: scope.registrationTxid };
}

function accepted(event) {
  return event?.confirmed === true && event.valid !== false && event.protocolValid !== false &&
    !["pending", "dropped", "orphaned", "invalid", "rejected"].includes(event.status);
}

// The API supplies the complete, independently verified registry at its exact
// checkpoint. A current owner/receiver lookup cannot establish this identity.
export function notificationIdScopeFromRegistry(registry, requestedId) {
  const id = notificationIdKey(requestedId);
  if (!id) throw Object.assign(new Error("An ID is required."), { statusCode: 400 });
  if (!Array.isArray(registry?.activity) || registry.activity.length > MAX_ROWS) {
    throw unavailable("Complete ID registration history is unavailable.");
  }
  const registrations = registry.activity.filter(event => accepted(event) &&
    ["register", "id-register"].includes(event.kind ?? event.action) && notificationIdKey(event.id) === id);
  if (registrations.length === 0) throw Object.assign(new Error("This ID has no accepted registration."), { statusCode: 404 });
  if (registrations.length !== 1) throw unavailable("ID registration history is ambiguous.");
  return normalizeNotificationIdScope({ type: "id", id, registrationTxid: registrations[0].txid });
}

export function notificationIdLifecycleTxids(registry, requestedScope) {
  const scope = normalizeNotificationIdScope(requestedScope);
  const verified = notificationIdScopeFromRegistry(registry, scope.id);
  if (verified.registrationTxid !== scope.registrationTxid) throw unavailable("ID registration changed during notification verification.");
  const kinds = new Set(["register", "update", "transfer", "list", "seal", "delist", "buy", "marketTransfer"]);
  const events = registry.activity.filter(event => accepted(event) && notificationIdKey(event.id) === scope.id &&
    kinds.has(String(event.kind ?? event.action ?? "").replace(/^id-/u, "")));
  if (events.some(event => !TXID.test(event.txid ?? ""))) throw unavailable("Accepted ID lifecycle lacks transaction identity.");
  return [...new Set(events.map(event => event.txid))].sort();
}

function decoded(value) {
  if (typeof value !== "string" || !/^[A-Za-z0-9_-]+$/u.test(value)) return "";
  try { return new TextDecoder("utf-8", { fatal: true }).decode(Buffer.from(value, "base64url")); }
  catch { return ""; }
}

function json(value) {
  try {
    const result = JSON.parse(decoded(value));
    return result && typeof result === "object" && !Array.isArray(result) ? result : null;
  } catch { return null; }
}

function wireReferences(row) {
  const source = row.payload && typeof row.payload === "object" ? row.payload : row;
  const raw = row.raw_payload ?? row.rawPayload ?? (typeof source.payload === "string" ? source.payload : "");
  if (typeof raw !== "string") return { ids: [], listing: "" };
  if (raw.length > 4 * 1024 * 1024) throw unavailable("ID notification carrier exceeds the discovery budget.");
  const parts = raw.split(":"), protocol = row.protocol ?? source.protocol;
  const ids = [], add = (id, role) => { const normalized = notificationIdKey(id); if (normalized) ids.push({ id: normalized, role }); };
  let listing = "";
  if (protocol === "pwid1" && parts[0] === "pwid1") {
    const action = parts[1];
    if (action === "r") add(parts[2], "asset");
    if (["r2", "u", "t"].includes(action)) add(decoded(parts[2]), "asset");
    if (/^(?:list[2345]|buy2)$/u.test(action)) add(json(parts[2])?.id, "asset");
    if (action === "seal5") add(json(parts[3])?.id, "asset");
    if (/^(?:buy[345]|delist[2345]|seal5)$/u.test(action) && TXID.test(parts[2] ?? "")) listing = parts[2];
  } else if (protocol === "pwb1" && parts[0] === "pwb1") {
    const action = parts[1], metadata = json(parts[action === "reply" ? 3 : 2]);
    if (["follow", "unfollow"].includes(action)) {
      add(metadata?.targetId ?? metadata?.followedId ?? metadata?.profileId ?? metadata?.id, "target");
    } else if (action === "profile") {
      add(metadata?.id ?? metadata?.profileId ?? metadata?.handle, "author-claim");
    } else if (["post", "reply"].includes(action)) {
      add(metadata?.profileId, "author-claim");
    }
  }
  return { ids, listing };
}

function position(row) {
  const values = [row.block_height ?? row.blockHeight, row.block_index ?? row.blockIndex,
    row.op_return_vout ?? row.protocolVout, row.record_ordinal ?? row.recordOrdinal];
  return values.every(value => Number.isSafeInteger(value) && value >= 0) && values[0] > 0 ? values : null;
}

function compare(left, right) {
  for (let index = 0; index < left.length; index += 1) if (left[index] !== right[index]) return left[index] - right[index];
  return 0;
}

// Only raw, typed ID references count. In particular participant.powid,
// authorId/currentOwnerId display enrichments, free text, and a former owner's
// unrelated wallet transactions never enter this registration's history.
export function notificationIdMatches(rows, requestedScope) {
  const scope = normalizeNotificationIdScope(requestedScope);
  if (!Array.isArray(rows) || rows.length > MAX_ROWS) throw unavailable("ID notification discovery exceeds its complete read budget.");
  const records = rows.map(row => ({ row, refs: wireReferences(row), position: position(row) }));
  const roots = records.filter(({ row, refs }) => row.txid === scope.registrationTxid &&
    row.status === "confirmed" && row.valid === true && row.protocol === "pwid1" &&
    ["id-register", "register"].includes(row.kind) && refs.ids.some(ref => ref.id === scope.id));
  if (roots.length !== 1 || !roots[0].position) throw unavailable("ID registration is not exactly represented in the indexed snapshot.");
  const rootPosition = roots[0].position;
  const eligible = records.filter(({ row, position: at }) => {
    if (row.status === "confirmed" && !at) throw unavailable("ID notification evidence lacks canonical position.");
    return !at || compare(at, rootPosition) >= 0;
  });
  const matched = new Map(), listingRows = new Map();
  for (const record of eligible) {
    const roles = [...new Set(record.refs.ids.filter(ref => ref.id === scope.id).map(ref => ref.role))];
    if (roles.length) matched.set(record, { roles, source: "explicit-wire-id" });
    if (record.row.protocol === "pwid1" && /^pwid1:list[2345]:/u.test(record.row.raw_payload ?? record.row.rawPayload ?? record.row.payload?.payload ?? "") && roles.includes("asset")) {
      const existing = listingRows.get(record.row.txid) ?? [];
      listingRows.set(record.row.txid, [...existing, record]);
    }
  }
  for (const record of eligible) {
    if (!record.refs.listing || !listingRows.has(record.refs.listing)) continue;
    const earlier = listingRows.get(record.refs.listing).some(source => source.row.status === "confirmed" &&
      source.position && (record.row.status !== "confirmed" || compare(source.position, record.position) < 0));
    if (earlier && !matched.has(record)) matched.set(record, { roles: ["asset"], source: "id-listing-reference" });
  }
  const matches = [...matched].map(([{ row }, { roles, source }]) => ({
    eventId: String(row.event_id ?? row.eventId ?? ""), txid: row.txid,
    protocolVout: row.op_return_vout ?? row.protocolVout, recordOrdinal: row.record_ordinal ?? row.recordOrdinal,
    id: scope.id, registrationTxid: scope.registrationTxid, matchedIdRoles: roles, source,
  }));
  if (matches.some(match => !TXID.test(match.txid ?? "") || !match.eventId ||
      [match.protocolVout, match.recordOrdinal].some(value => !Number.isSafeInteger(value) || value < 0))) {
    throw unavailable("ID notification match has no exact carrier identity.");
  }
  return { txids: [...new Set(matches.map(match => match.txid))].sort(), matches };
}

export function notificationIdDirection(match) {
  const roles = match?.matchedIdRoles ?? [], outgoing = roles.includes("author-claim"), incoming = roles.includes("target");
  return incoming && outgoing ? "self" : outgoing ? "outgoing" : incoming ? "incoming" : "related";
}

export function notificationIdTransactionSql(parameter) {
  return `NOT EXISTS (SELECT 1 FROM proof_indexer.events earlier
    WHERE earlier.network=e.network AND earlier.txid=e.txid AND earlier.status=e.status AND earlier.event_id<e.event_id
      AND (earlier.kind NOT LIKE 'token-%' OR earlier.protocol='pwt1')
      AND (e.status <> 'confirmed' OR earlier.block_height=e.block_height)) AND e.txid=ANY(${parameter}::text[])`;
}
