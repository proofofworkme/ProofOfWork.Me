import {
  createProofIndexPool,
  proofIndexDatabaseConfigured,
} from "./postgres.mjs";

let proofIndexReadPool = null;

function proofIndexPool() {
  if (!proofIndexDatabaseConfigured()) {
    return null;
  }

  if (!proofIndexReadPool) {
    proofIndexReadPool = createProofIndexPool({
      env: {
        ...process.env,
        POW_INDEX_DB_APP_NAME:
          process.env.POW_INDEX_DB_APP_NAME ?? "proof-index-reader",
      },
    });
  }

  return proofIndexReadPool;
}

export async function closeProofIndexReadPool() {
  if (proofIndexReadPool) {
    await proofIndexReadPool.end();
    proofIndexReadPool = null;
  }
}

function featureEnabled(rawValue, feature) {
  const value = String(rawValue ?? "").trim().toLowerCase();
  if (!value || /^(?:0|false|no|none|off)$/iu.test(value)) {
    return false;
  }
  if (/^(?:1|true|yes|all|\*)$/iu.test(value)) {
    return true;
  }

  const aliases = new Set(
    String(feature ?? "")
      .split(/[,\s]+/u)
      .map((part) => part.trim().toLowerCase())
      .filter(Boolean),
  );
  const enabled = value
    .split(/[,\s]+/u)
    .map((part) => part.trim().toLowerCase())
    .filter(Boolean);
  return enabled.some((part) => aliases.has(part));
}

export function proofIndexReadFeatureEnabled(feature, env = process.env) {
  return (
    proofIndexDatabaseConfigured(env) &&
    featureEnabled(env.POW_INDEX_READS, feature)
  );
}

export function proofIndexShadowFeatureEnabled(feature, env = process.env) {
  return (
    proofIndexDatabaseConfigured(env) &&
    featureEnabled(env.POW_INDEX_SHADOW_READS, feature)
  );
}

export function proofIndexReadUnconfirmedTxStatus(env = process.env) {
  return /^(?:1|true|yes)$/iu.test(
    String(env.POW_INDEX_READ_UNCONFIRMED_TX_STATUS ?? ""),
  );
}

function dateIso(value, fallback = new Date()) {
  const date = value instanceof Date ? value : new Date(value ?? fallback);
  if (Number.isNaN(date.getTime())) {
    return fallback.toISOString();
  }
  return date.toISOString();
}

function boundedInteger(value, fallback, min, max) {
  const parsed = Number.parseInt(String(value ?? ""), 10);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }
  return Math.min(max, Math.max(min, parsed));
}

function normalizedSnapshotId(value) {
  const snapshotId = String(value ?? "").trim();
  if (!snapshotId || snapshotId.length > 128 || /\s/u.test(snapshotId)) {
    return "";
  }
  return snapshotId;
}

function historyCursorFromSearch(value) {
  const raw = String(value ?? "").trim();
  if (!raw) {
    return { offset: 0, snapshotId: "" };
  }

  const snapshotMatch = /^snapshot:([^:]+):(\d+)$/iu.exec(raw);
  if (snapshotMatch) {
    return {
      offset: boundedInteger(snapshotMatch[2], 0, 0, 100_000_000),
      snapshotId: normalizedSnapshotId(snapshotMatch[1]),
    };
  }

  return {
    offset: boundedInteger(raw, 0, 0, 100_000_000),
    snapshotId: "",
  };
}

function historyCursor(snapshotId, offset) {
  const pinnedSnapshotId = normalizedSnapshotId(snapshotId);
  return pinnedSnapshotId ? `snapshot:${pinnedSnapshotId}:${offset}` : String(offset);
}

function historyPaginationFromSearch(searchParams) {
  const params = searchParams ?? new URLSearchParams();
  const limit = boundedInteger(params.get("limit"), 200, 1, 500);
  const page = boundedInteger(params.get("page"), 0, 0, 1_000_000);
  const cursorRaw = String(params.get("cursor") ?? "").trim();
  const cursor = historyCursorFromSearch(cursorRaw);
  const offset = cursorRaw ? cursor.offset : page * limit;
  const snapshotId =
    cursor.snapshotId ||
    normalizedSnapshotId(
      params.get("snapshot") ?? params.get("snapshotId") ?? "",
    );
  const query = String(params.get("q") ?? params.get("search") ?? "")
    .trim()
    .toLowerCase();

  return { limit, offset, page, query, snapshotId };
}

function tokenHistorySafeKind(kind) {
  const value = String(kind ?? "").trim().toLowerCase();
  const kindMap = new Map([
    ["holders", "holders"],
    ["invalid", "invalidEvents"],
    ["invalid-events", "invalidEvents"],
    ["invalid_events", "invalidEvents"],
    ["closedlistings", "closedListings"],
    ["closed-listings", "closedListings"],
    ["closed_listing", "closedListings"],
    ["closed-listing", "closedListings"],
    ["listings", "listings"],
    ["marketlog", "market-log"],
    ["market-log", "market-log"],
    ["market_log", "market-log"],
    ["tokenmarketlog", "market-log"],
    ["token-market-log", "market-log"],
    ["mints", "mints"],
    ["sales", "sales"],
    ["tokens", "tokens"],
    ["transfers", "transfers"],
  ]);
  return kindMap.get(value) ?? "mints";
}

function tokenScopeKey(tokenScope) {
  const scope = String(tokenScope ?? "").trim().toLowerCase();
  return scope || "all";
}

function tokenHistoryFilterNeedles(searchParams, pagination) {
  const params = searchParams ?? new URLSearchParams();
  const values = [];
  if (pagination.query) {
    values.push(pagination.query);
  }
  for (const key of [
    "address",
    "owner",
    "ownerAddress",
    "seller",
    "sellerAddress",
    "buyer",
    "buyerAddress",
    "txid",
    "transaction",
    "transactionId",
  ]) {
    values.push(...params.getAll(key));
  }
  return [
    ...new Set(
      values
        .map((value) => String(value ?? "").trim().toLowerCase())
        .filter(Boolean),
    ),
  ];
}

function historyItemsMatchingNeedles(items, needles) {
  if (!Array.isArray(needles) || needles.length === 0) {
    return items;
  }
  return items.filter((item) => {
    const text = valueSearchText(item).toLowerCase();
    return needles.every((needle) => text.includes(needle));
  });
}

export function proofIndexLogHistoryReadEligibility(kind, searchParams) {
  const requestedKind = String(kind ?? "").trim().toLowerCase();
  const pagination = historyPaginationFromSearch(searchParams);
  const params = searchParams ?? new URLSearchParams();
  const cursorRaw = String(params.get("cursor") ?? "").trim();

  if (requestedKind) {
    return {
      eligible: true,
      pagination,
      reason: "kind-filter",
    };
  }

  if (pagination.query) {
    return {
      eligible: true,
      pagination,
      reason: "query",
    };
  }

  if (cursorRaw || pagination.snapshotId || pagination.offset > 0) {
    return {
      eligible: true,
      pagination,
      reason: "snapshot-pinned-activity",
    };
  }

  return {
    eligible: false,
    pagination,
    reason: "volatile-first-page-canonical",
  };
}

export function proofIndexTokenHistoryReadEligibility(
  tokenScope,
  kind,
  searchParams,
) {
  const pagination = historyPaginationFromSearch(searchParams);
  const params = searchParams ?? new URLSearchParams();
  const walletScoped = /^(?:1|true|yes)$/iu.test(
    String(params.get("wallet") ?? "").trim(),
  );
  if (walletScoped) {
    return {
      eligible: false,
      kind: tokenHistorySafeKind(kind),
      pagination,
      reason: "wallet-scoped-canonical",
      scope: tokenScopeKey(tokenScope),
    };
  }

  const safeKind = tokenHistorySafeKind(kind);
  return {
    eligible: true,
    kind: safeKind,
    pagination,
    reason:
      pagination.query || tokenHistoryFilterNeedles(params, pagination).length > 0
        ? "query"
        : "snapshot-pinned-token-history",
    scope: tokenScopeKey(tokenScope),
  };
}

export function proofIndexTokenReadEligibility(tokenScope, searchParams) {
  const params = searchParams ?? new URLSearchParams();
  const walletScoped = /^(?:1|true|yes)$/iu.test(
    String(params.get("wallet") ?? "").trim(),
  );
  const scopedAddressParams = [
    "address",
    "owner",
    "ownerAddress",
    "seller",
    "sellerAddress",
    "buyer",
    "buyerAddress",
  ].some((key) => params.has(key));
  const query = String(params.get("q") ?? params.get("search") ?? "").trim();
  if (walletScoped || scopedAddressParams || query) {
    return {
      eligible: false,
      reason: walletScoped ? "wallet-scoped-canonical" : "query-scoped-canonical",
      scope: tokenScopeKey(tokenScope),
    };
  }

  return {
    eligible: true,
    reason: "snapshot-pinned-token-state",
    scope: tokenScopeKey(tokenScope),
  };
}

function rowNumber(row, key) {
  const number = Number(row?.[key]);
  return Number.isFinite(number) ? number : 0;
}

function canonicalEventPayload(payload) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return {};
  }
  const { indexedFrom, ...item } = payload;
  return item;
}

function valueSearchText(value) {
  if (value === null || value === undefined) {
    return "";
  }
  if (Array.isArray(value)) {
    return value.map(valueSearchText).join(" ");
  }
  if (typeof value === "object") {
    return Object.values(value).map(valueSearchText).join(" ");
  }
  return String(value);
}

function historyItemsMatchingQuery(items, query) {
  if (!query) {
    return items;
  }
  return items.filter((item) =>
    valueSearchText(item).toLowerCase().includes(query),
  );
}

function itemCreatedAtMs(item) {
  const parsed = Date.parse(item?.createdAt);
  return Number.isFinite(parsed) ? parsed : 0;
}

function compareHistoryItems(left, right) {
  return (
    itemCreatedAtMs(right) - itemCreatedAtMs(left) ||
    String(right?.txid ?? "").localeCompare(String(left?.txid ?? ""))
  );
}

function indexedThroughBlockFromItems(items) {
  const heights = (Array.isArray(items) ? items : [])
    .map((item) => Number(item?.blockHeight))
    .filter((height) => Number.isSafeInteger(height) && height > 0);
  return heights.length > 0 ? Math.max(...heights) : undefined;
}

function completeStoredItems(storedPayload) {
  if (
    !storedPayload ||
    storedPayload.complete === false ||
    !Array.isArray(storedPayload.items)
  ) {
    return null;
  }
  if (
    storedPayload.items.length === 0 &&
    Number(storedPayload.totalCount ?? 0) > 0
  ) {
    return null;
  }
  return storedPayload.items;
}

function salePriceSats(sale) {
  const value = Number(
    sale?.priceSats ?? sale?.salePriceSats ?? sale?.amountSats ?? 0,
  );
  return Number.isFinite(value) && value > 0 ? value : 0;
}

function salesStats(sales) {
  const items = Array.isArray(sales) ? sales : [];
  let confirmedSales = 0;
  let confirmedSalesVolumeSats = 0;
  let pendingSales = 0;
  let pendingSalesVolumeSats = 0;
  for (const sale of items) {
    if (sale?.confirmed) {
      confirmedSales += 1;
      confirmedSalesVolumeSats += salePriceSats(sale);
    } else {
      pendingSales += 1;
      pendingSalesVolumeSats += salePriceSats(sale);
    }
  }
  return {
    confirmedSales,
    confirmedSalesVolumeSats,
    pendingSales,
    pendingSalesVolumeSats,
    sales: confirmedSales + pendingSales,
    salesVolumeSats: confirmedSalesVolumeSats + pendingSalesVolumeSats,
  };
}

function uniqueTxidCount(items) {
  const txids = new Set();
  for (const item of Array.isArray(items) ? items : []) {
    const txid = String(item?.txid ?? "").trim().toLowerCase();
    if (/^[0-9a-f]{64}$/u.test(txid)) {
      txids.add(txid);
    }
  }
  return txids.size;
}

function normalizedStatus(status) {
  const value = String(status ?? "").toLowerCase();
  if (value === "confirmed" || value === "pending" || value === "dropped") {
    return value;
  }
  return value === "orphaned" ? "dropped" : "";
}

export async function proofIndexTxStatusPayload(txid, network, options = {}) {
  const pool = proofIndexPool();
  if (!pool) {
    return null;
  }

  const result = await pool.query(
    `
      SELECT txid, status, confirmed_at, dropped_at, last_seen_at, updated_at
      FROM proof_indexer.transactions
      WHERE network = $1 AND txid = $2
      LIMIT 1
    `,
    [network, String(txid ?? "").toLowerCase()],
  );
  const row = result.rows[0];
  if (!row) {
    return null;
  }

  const status = normalizedStatus(row.status);
  if (!status) {
    return null;
  }
  if (status !== "confirmed" && !options.includeUnconfirmed) {
    return null;
  }

  return {
    confirmed: status === "confirmed",
    indexedAt: dateIso(
      row.updated_at ?? row.confirmed_at ?? row.dropped_at ?? row.last_seen_at,
    ),
    network,
    status,
    txid: row.txid,
  };
}

async function ledgerSnapshot(pool, network, snapshotId = "") {
  const pinnedSnapshotId = normalizedSnapshotId(snapshotId);
  if (pinnedSnapshotId) {
    const pinnedResult = await pool.query(
      `
        SELECT
          snapshot_id,
          generated_at,
          indexed_through_block,
          consistency,
          payload
        FROM proof_indexer.ledger_snapshots
        WHERE network = $1 AND snapshot_id = $2
        LIMIT 1
      `,
      [network, pinnedSnapshotId],
    );
    return pinnedResult.rows[0] ?? null;
  }

  const snapshotResult = await pool.query(
    `
      SELECT
        snapshot_id,
        generated_at,
        indexed_through_block,
        consistency,
        payload
      FROM proof_indexer.ledger_snapshots
      WHERE network = $1
      ORDER BY generated_at DESC
      LIMIT 1
    `,
    [network],
  );
  return snapshotResult.rows[0] ?? null;
}

function snapshotActivityPayload(snapshot) {
  const payload = snapshot?.payload;
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return null;
  }
  if (
    payload.activityPayload &&
    typeof payload.activityPayload === "object" &&
    !Array.isArray(payload.activityPayload)
  ) {
    return payload.activityPayload;
  }
  return payload;
}

function tokenHistoryPayloadsFromSnapshot(snapshot) {
  const payload = snapshot?.payload;
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return null;
  }
  if (
    payload.tokenHistoryPayloads &&
    typeof payload.tokenHistoryPayloads === "object" &&
    !Array.isArray(payload.tokenHistoryPayloads)
  ) {
    return payload.tokenHistoryPayloads;
  }
  return null;
}

function tokenStatePayloadsFromSnapshot(snapshot) {
  const payload = snapshot?.payload;
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return null;
  }
  if (
    payload.tokenStatePayloads &&
    typeof payload.tokenStatePayloads === "object" &&
    !Array.isArray(payload.tokenStatePayloads)
  ) {
    return payload.tokenStatePayloads;
  }
  return null;
}

function registryHistoryPayloadsFromSnapshot(snapshot) {
  const payload = snapshot?.payload;
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return null;
  }
  if (
    payload.registryHistoryPayloads &&
    typeof payload.registryHistoryPayloads === "object" &&
    !Array.isArray(payload.registryHistoryPayloads)
  ) {
    return payload.registryHistoryPayloads;
  }
  return null;
}

function proofIndexTokenHistoryMaxAgeMs(env = process.env) {
  return boundedInteger(
    env.POW_INDEX_TOKEN_HISTORY_MAX_AGE_MS,
    15 * 60_000,
    0,
    24 * 60 * 60_000,
  );
}

function tokenHistorySnapshotAgeMs(snapshot) {
  const payload = snapshot?.payload;
  const parsed = Date.parse(
    payload?.tokenHistoryIndexedAt ??
      payload?.tokenHistoryPayloads?.all?.tokens?.indexedAt ??
      snapshot?.generated_at,
  );
  return Number.isFinite(parsed) ? Date.now() - parsed : Number.POSITIVE_INFINITY;
}

function tokenStateSnapshotAgeMs(snapshot) {
  const payload = snapshot?.payload;
  const parsed = Date.parse(
    payload?.tokenStatePayloadsIndexedAt ??
      payload?.tokenHistoryIndexedAt ??
      payload?.tokenStatePayloads?.all?.indexedAt ??
      snapshot?.generated_at,
  );
  return Number.isFinite(parsed) ? Date.now() - parsed : Number.POSITIVE_INFINITY;
}

function proofIndexSnapshotMaxAgeMs(env = process.env) {
  return boundedInteger(
    env.POW_INDEX_SNAPSHOT_READ_MAX_AGE_MS,
    24 * 60 * 60_000,
    0,
    24 * 60 * 60_000,
  );
}

function snapshotPayloadFresh(snapshot, indexedAtKey, env = process.env) {
  const payload = snapshot?.payload;
  const parsed = Date.parse(payload?.[indexedAtKey] ?? snapshot?.generated_at);
  if (!Number.isFinite(parsed)) {
    return false;
  }
  return Date.now() - parsed <= proofIndexSnapshotMaxAgeMs(env);
}

function registryHistorySafeKind(kind) {
  const value = String(kind ?? "").trim().toLowerCase();
  if (value === "pending") {
    return "pending";
  }
  return new Set(["activity", "listings", "records", "sales"]).has(value)
    ? value
    : "records";
}

export function proofIndexRegistryHistoryReadEligibility(kind, searchParams) {
  const safeKind = registryHistorySafeKind(kind);
  return {
    eligible: safeKind !== "pending",
    kind: safeKind,
    pagination: historyPaginationFromSearch(searchParams),
    reason: "snapshot-pinned-registry-history",
  };
}

function logHistoryPageFromSnapshot(snapshot, network, requestedKind, pagination) {
  const activityPayload = snapshotActivityPayload(snapshot);
  const sourceItems = Array.isArray(activityPayload?.activity)
    ? activityPayload.activity
    : [];
  if (sourceItems.length === 0) {
    return null;
  }

  const kindItems = requestedKind
    ? sourceItems.filter((item) => item?.kind === requestedKind)
    : sourceItems;
  const sortedItems = [...kindItems].sort(compareHistoryItems);
  const filtered = historyItemsMatchingQuery(sortedItems, pagination.query);
  const totalCount = filtered.length;
  const start = Math.min(pagination.offset, totalCount);
  const end = Math.min(totalCount, start + pagination.limit);
  const snapshotId = activityPayload.snapshotId ?? snapshot?.snapshot_id ?? "";
  const cursor = historyCursor(snapshotId, start);
  const nextCursor = end < totalCount ? historyCursor(snapshotId, end) : "";
  const indexedAt = dateIso(
    activityPayload.indexedAt ??
      activityPayload.generatedAt ??
      snapshot?.generated_at,
  );

  const page = {
    cursor,
    end,
    indexedAt,
    indexedThroughBlock:
      indexedThroughBlockFromItems(filtered) ??
      rowNumber(snapshot, "indexed_through_block"),
    items: filtered.slice(start, end),
    kind: requestedKind || "activity",
    limit: pagination.limit,
    network,
    nextCursor,
    page: Math.floor(start / pagination.limit),
    pageCount: Math.max(1, Math.ceil(totalCount / pagination.limit)),
    pageSize: pagination.limit,
    query: pagination.query,
    source: activityPayload.source ?? "proof-indexer-snapshot",
    start,
    totalCount,
  };

  if (snapshotId) {
    return {
      ...page,
      consistency: activityPayload.consistency ?? snapshot?.consistency ?? undefined,
      ledgerGeneratedAt:
        activityPayload.ledgerGeneratedAt ??
        dateIso(activityPayload.generatedAt ?? snapshot?.generated_at),
      snapshotId,
    };
  }

  return page;
}

function historyPageFromStoredPayload(
  storedPayload,
  snapshot,
  network,
  kind,
  pagination,
) {
  const sourceItems = Array.isArray(storedPayload?.items)
    ? storedPayload.items
    : [];
  if (sourceItems.length === 0 && Number(storedPayload?.totalCount ?? 0) > 0) {
    return null;
  }

  const filtered = historyItemsMatchingQuery(sourceItems, pagination.query);
  const totalCount = filtered.length;
  const start = Math.min(pagination.offset, totalCount);
  const end = Math.min(totalCount, start + pagination.limit);
  const snapshotId =
    storedPayload?.snapshotId ??
    storedPayload?.ledgerSnapshotId ??
    snapshot?.snapshot_id ??
    "";
  const cursor = historyCursor(snapshotId, start);
  const nextCursor = end < totalCount ? historyCursor(snapshotId, end) : "";
  const indexedAt = dateIso(
    storedPayload?.indexedAt ??
      storedPayload?.ledgerGeneratedAt ??
      storedPayload?.generatedAt ??
      snapshot?.generated_at,
  );

  const page = {
    cursor,
    end,
    indexedAt,
    indexedThroughBlock:
      indexedThroughBlockFromItems(filtered) ??
      rowNumber(snapshot, "indexed_through_block"),
    items: filtered.slice(start, end),
    kind,
    limit: pagination.limit,
    network,
    nextCursor,
    page: Math.floor(start / pagination.limit),
    pageCount: Math.max(1, Math.ceil(totalCount / pagination.limit)),
    pageSize: pagination.limit,
    query: pagination.query,
    source: storedPayload?.source ?? "proof-indexer-snapshot",
    start,
    totalCount,
  };

  if (snapshotId) {
    return {
      ...page,
      consistency: storedPayload?.consistency ?? snapshot?.consistency ?? undefined,
      ledgerGeneratedAt:
        storedPayload?.ledgerGeneratedAt ??
        dateIso(storedPayload?.generatedAt ?? snapshot?.generated_at),
      snapshotId,
    };
  }

  return page;
}

function tokenHistoryItemsFromSnapshot(tokenHistoryPayloads, scope, safeKind) {
  const scopedPayload = tokenHistoryPayloads?.[scope];
  if (
    scopedPayload?.[safeKind] &&
    scopedPayload[safeKind].complete !== false &&
    Array.isArray(scopedPayload[safeKind].items)
  ) {
    return {
      payload: scopedPayload[safeKind],
      sourceItems: scopedPayload[safeKind].items,
    };
  }

  const allPayload = tokenHistoryPayloads?.all?.[safeKind];
  if (
    !allPayload ||
    allPayload.complete === false ||
    !Array.isArray(allPayload.items)
  ) {
    return null;
  }
  if (scope === "all") {
    return {
      payload: allPayload,
      sourceItems: allPayload.items,
    };
  }
  if (safeKind === "holders") {
    return null;
  }

  return {
    payload: allPayload,
    sourceItems: allPayload.items.filter((item) => {
      const tokenId = String(item?.tokenId ?? "").trim().toLowerCase();
      const ticker = String(item?.ticker ?? "").trim().toLowerCase();
      return tokenId === scope || ticker === scope;
    }),
  };
}

function tokenHistoryPageFromSnapshot(
  snapshot,
  network,
  tokenScope,
  safeKind,
  searchParams,
  pagination,
) {
  if (tokenHistorySnapshotAgeMs(snapshot) > proofIndexTokenHistoryMaxAgeMs()) {
    return null;
  }
  const tokenHistoryPayloads = tokenHistoryPayloadsFromSnapshot(snapshot);
  if (!tokenHistoryPayloads) {
    return null;
  }

  const scope = tokenScopeKey(tokenScope);
  const source = tokenHistoryItemsFromSnapshot(tokenHistoryPayloads, scope, safeKind);
  if (!source) {
    return null;
  }

  const needles = tokenHistoryFilterNeedles(searchParams, pagination);
  const filtered = historyItemsMatchingNeedles(source.sourceItems, needles);
  const totalCount = filtered.length;
  const start = Math.min(pagination.offset, totalCount);
  const end = Math.min(totalCount, start + pagination.limit);
  const snapshotId =
    source.payload?.snapshotId ??
    source.payload?.ledgerSnapshotId ??
    snapshot?.snapshot_id ??
    "";
  const cursor = historyCursor(snapshotId, start);
  const nextCursor = end < totalCount ? historyCursor(snapshotId, end) : "";
  const indexedAt = dateIso(
    source.payload?.indexedAt ??
      source.payload?.ledgerGeneratedAt ??
      source.payload?.generatedAt ??
      snapshot?.generated_at,
  );

  const page = {
    cursor,
    end,
    indexedAt,
    indexedThroughBlock:
      indexedThroughBlockFromItems(filtered) ??
      rowNumber(snapshot, "indexed_through_block"),
    items: filtered.slice(start, end),
    kind: safeKind,
    limit: pagination.limit,
    network,
    nextCursor,
    page: Math.floor(start / pagination.limit),
    pageCount: Math.max(1, Math.ceil(totalCount / pagination.limit)),
    pageSize: pagination.limit,
    query: pagination.query,
    source: source.payload?.source ?? "proof-indexer-token-snapshot",
    start,
    totalCount,
  };

  if (snapshotId) {
    return {
      ...page,
      consistency: source.payload?.consistency ?? snapshot?.consistency ?? undefined,
      ledgerGeneratedAt:
        source.payload?.ledgerGeneratedAt ??
        dateIso(source.payload?.generatedAt ?? snapshot?.generated_at),
      snapshotId,
    };
  }

  return page;
}

export async function proofIndexLogHistoryPayload(network, kind, searchParams) {
  const pool = proofIndexPool();
  if (!pool) {
    return null;
  }

  const requestedKind = String(kind ?? "").trim().toLowerCase();
  const { pagination } = proofIndexLogHistoryReadEligibility(
    requestedKind,
    searchParams,
  );
  const snapshot = await ledgerSnapshot(pool, network, pagination.snapshotId);
  if (!snapshot) {
    return null;
  }
  const snapshotPage = logHistoryPageFromSnapshot(
    snapshot,
    network,
    requestedKind,
    pagination,
  );
  if (snapshotPage) {
    return snapshotPage;
  }

  const conditions = [
    "e.network = $1",
    "e.payload->>'indexedFrom' = 'log'",
  ];
  const params = [network];

  if (requestedKind) {
    params.push(requestedKind);
    conditions.push(`e.kind = $${params.length}`);
  }

  if (pagination.query) {
    params.push(`%${pagination.query}%`);
    conditions.push(`lower(e.payload::text) LIKE $${params.length}`);
  }

  const whereClause = conditions.join(" AND ");
  const countResult = await pool.query(
    `
      SELECT count(*) AS total_count, max(e.block_height) AS indexed_through_block
      FROM proof_indexer.events e
      WHERE ${whereClause}
    `,
    params,
  );
  const totalCount = rowNumber(countResult.rows[0], "total_count");
  const indexedThroughBlock = rowNumber(
    countResult.rows[0],
    "indexed_through_block",
  );

  const rowParams = [...params, pagination.limit, pagination.offset];
  const limitParam = rowParams.length - 1;
  const offsetParam = rowParams.length;
  const rowsResult = await pool.query(
    `
      SELECT e.payload, e.event_time, e.block_height, e.txid, e.event_id
      FROM proof_indexer.events e
      WHERE ${whereClause}
      ORDER BY
        COALESCE(e.event_time, e.block_time, e.created_at) DESC,
        e.txid DESC,
        e.event_id DESC
      LIMIT $${limitParam}
      OFFSET $${offsetParam}
    `,
    rowParams,
  );

  const start = Math.min(pagination.offset, totalCount);
  const end = Math.min(totalCount, start + pagination.limit);
  const snapshotId = snapshot.snapshot_id ?? "";
  const cursor = historyCursor(snapshotId, start);
  const nextCursor = end < totalCount ? historyCursor(snapshotId, end) : "";
  const indexedAt = snapshot.generated_at
    ? dateIso(snapshot.generated_at)
    : new Date().toISOString();

  const page = {
    cursor,
    end,
    indexedAt,
    indexedThroughBlock,
    items: rowsResult.rows.map((row) => canonicalEventPayload(row.payload)),
    kind: requestedKind || "activity",
    limit: pagination.limit,
    network,
    nextCursor,
    page: Math.floor(start / pagination.limit),
    pageCount: Math.max(1, Math.ceil(totalCount / pagination.limit)),
    pageSize: pagination.limit,
    query: pagination.query,
    source: "proof-indexer",
    start,
    totalCount,
  };

  if (snapshotId) {
    return {
      ...page,
      consistency: snapshot.consistency ?? undefined,
      ledgerGeneratedAt: indexedAt,
      snapshotId,
    };
  }

  return page;
}

export async function proofIndexTokenHistoryPayload(
  network,
  tokenScope,
  kind,
  searchParams,
) {
  const pool = proofIndexPool();
  if (!pool) {
    return null;
  }

  const eligibility = proofIndexTokenHistoryReadEligibility(
    tokenScope,
    kind,
    searchParams,
  );
  if (!eligibility.eligible) {
    return null;
  }

  const snapshot = await ledgerSnapshot(
    pool,
    network,
    eligibility.pagination.snapshotId,
  );
  if (!snapshot) {
    return null;
  }

  const snapshotPage = tokenHistoryPageFromSnapshot(
    snapshot,
    network,
    tokenScope,
    eligibility.kind,
    searchParams,
    eligibility.pagination,
  );
  if (snapshotPage) {
    return snapshotPage;
  }

  if (
    eligibility.kind === "holders" &&
    eligibility.scope !== "all" &&
    tokenHistorySnapshotAgeMs(snapshot) <= proofIndexTokenHistoryMaxAgeMs()
  ) {
    return proofIndexScopedHolderHistoryPayload(
      pool,
      network,
      eligibility.scope,
      eligibility.pagination,
      snapshot,
    );
  }

  return null;
}

function tokenMatchesScope(token, scope) {
  const normalizedScope = String(scope ?? "").trim().toLowerCase();
  if (!normalizedScope || normalizedScope === "all") {
    return true;
  }
  return (
    String(token?.tokenId ?? "").trim().toLowerCase() === normalizedScope ||
    String(token?.ticker ?? "").trim().toLowerCase() === normalizedScope
  );
}

function tokenStateWithSnapshotMetadata(payload, snapshot, source) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return null;
  }
  const snapshotId = payload.snapshotId ?? snapshot?.snapshot_id ?? "";
  return {
    ...payload,
    indexedAt: dateIso(
      payload.indexedAt ??
        snapshot?.payload?.tokenStatePayloadsIndexedAt ??
        snapshot?.generated_at,
    ),
    source: payload.source ?? source,
    ...(snapshotId ? { snapshotId } : {}),
  };
}

function tokenStateStats(payload, tokens, mints, transfers, invalidEvents) {
  return {
    ...(payload?.stats ?? {}),
    confirmedMints: mints.filter((item) => item?.confirmed).length,
    confirmedTransfers: transfers.filter((item) => item?.confirmed).length,
    confirmedTokens: tokens.filter((item) => item?.confirmed).length,
    holders: Array.isArray(payload?.holders) ? payload.holders.length : 0,
    invalidEvents: invalidEvents.filter((item) => item?.confirmed).length,
    pendingMints: mints.filter((item) => !item?.confirmed).length,
    pendingTransfers: transfers.filter((item) => !item?.confirmed).length,
    pendingTokens: tokens.filter((item) => !item?.confirmed).length,
    registries: new Set(
      tokens.map((token) => token?.registryAddress).filter(Boolean),
    ).size,
    transactions:
      tokens.length +
      mints.length +
      transfers.length +
      (Array.isArray(payload?.listings) ? payload.listings.length : 0) +
      (Array.isArray(payload?.closedListings)
        ? payload.closedListings.length
        : 0) +
      (Array.isArray(payload?.sales) ? payload.sales.length : 0),
  };
}

async function scopedHoldersFromBalances(pool, network, tokenId) {
  const result = await pool.query(
    `
      SELECT address, confirmed_balance
      FROM proof_indexer.credit_balances
      WHERE network = $1
        AND token_id = $2
        AND confirmed_balance > 0
      ORDER BY confirmed_balance DESC, address ASC
    `,
    [network, tokenId],
  );
  return result.rows.map((row) => ({
    address: row.address,
    balance: Number(row.confirmed_balance),
  }));
}

async function scopedTokenStateFromAllPayload(pool, network, scope, allPayload) {
  const tokens = (Array.isArray(allPayload?.tokens) ? allPayload.tokens : []).filter(
    (token) => tokenMatchesScope(token, scope),
  );
  if (tokens.length === 0) {
    return null;
  }
  const tokenIds = new Set(tokens.map((token) => token.tokenId).filter(Boolean));
  const scopedItems = (items) =>
    (Array.isArray(items) ? items : []).filter((item) =>
      tokenIds.has(item?.tokenId),
    );
  const mints = scopedItems(allPayload.mints);
  const transfers = scopedItems(allPayload.transfers);
  const listings = scopedItems(allPayload.listings);
  const closedListings = scopedItems(allPayload.closedListings);
  const sales = scopedItems(allPayload.sales);
  const invalidEvents = scopedItems(allPayload.invalidEvents);
  const holders =
    tokenIds.size === 1
      ? await scopedHoldersFromBalances(pool, network, [...tokenIds][0])
      : [];
  const confirmedSupply = holders.reduce(
    (total, holder) => total + Number(holder.balance ?? 0),
    0,
  );
  const creationSats = tokens.reduce(
    (total, token) => total + Number(token?.creationFeeSats ?? 0),
    0,
  );
  const payload = {
    ...allPayload,
    closedListings,
    confirmedSupply,
    creationSats,
    holders,
    invalidEvents,
    listings,
    mints,
    pendingSupply: mints
      .filter((mint) => !mint?.confirmed)
      .reduce((total, mint) => total + Number(mint?.amount ?? 0), 0),
    sales,
    tokens,
    transfers,
  };
  return {
    ...payload,
    stats: tokenStateStats(payload, tokens, mints, transfers, invalidEvents),
  };
}

export async function proofIndexTokenPayload(network, tokenScope, searchParams) {
  const pool = proofIndexPool();
  if (!pool) {
    return null;
  }
  const eligibility = proofIndexTokenReadEligibility(tokenScope, searchParams);
  if (!eligibility.eligible) {
    return null;
  }

  const snapshot = await ledgerSnapshot(pool, network);
  if (
    !snapshot ||
    tokenStateSnapshotAgeMs(snapshot) > proofIndexTokenHistoryMaxAgeMs()
  ) {
    return null;
  }

  const statePayloads = tokenStatePayloadsFromSnapshot(snapshot);
  if (!statePayloads) {
    return null;
  }

  const scopedPayload = statePayloads[eligibility.scope];
  if (scopedPayload && typeof scopedPayload === "object") {
    return tokenStateWithSnapshotMetadata(
      scopedPayload,
      snapshot,
      "proof-indexer-token-state-snapshot",
    );
  }

  const allPayload = statePayloads.all;
  if (!allPayload || typeof allPayload !== "object") {
    return null;
  }
  if (eligibility.scope === "all") {
    return tokenStateWithSnapshotMetadata(
      allPayload,
      snapshot,
      "proof-indexer-token-state-snapshot",
    );
  }

  const reconstructed = await scopedTokenStateFromAllPayload(
    pool,
    network,
    eligibility.scope,
    allPayload,
  );
  return tokenStateWithSnapshotMetadata(
    reconstructed,
    snapshot,
    "proof-indexer-token-state-snapshot",
  );
}

async function proofIndexScopedHolderHistoryPayload(
  pool,
  network,
  scope,
  pagination,
  snapshot,
) {
  const tokenResult = await pool.query(
    `
      SELECT token_id, ticker
      FROM proof_indexer.credit_definitions
      WHERE network = $1
        AND (token_id = $2 OR lower(ticker) = lower($2))
      LIMIT 1
    `,
    [network, scope],
  );
  const token = tokenResult.rows[0];
  if (!token) {
    return null;
  }

  const countResult = await pool.query(
    `
      SELECT count(*) AS total_count
      FROM proof_indexer.credit_balances
      WHERE network = $1
        AND token_id = $2
        AND confirmed_balance > 0
        AND ($3 = '' OR lower(address) LIKE $4)
    `,
    [
      network,
      token.token_id,
      pagination.query,
      `%${pagination.query}%`,
    ],
  );
  const totalCount = rowNumber(countResult.rows[0], "total_count");
  const rowsResult = await pool.query(
    `
      SELECT address, confirmed_balance
      FROM proof_indexer.credit_balances
      WHERE network = $1
        AND token_id = $2
        AND confirmed_balance > 0
        AND ($5 = '' OR lower(address) LIKE $6)
      ORDER BY confirmed_balance DESC, address ASC
      LIMIT $3
      OFFSET $4
    `,
    [
      network,
      token.token_id,
      pagination.limit,
      pagination.offset,
      pagination.query,
      `%${pagination.query}%`,
    ],
  );

  const start = Math.min(pagination.offset, totalCount);
  const end = Math.min(totalCount, start + pagination.limit);
  const snapshotId = snapshot?.snapshot_id ?? "";
  const cursor = historyCursor(snapshotId, start);
  const nextCursor = end < totalCount ? historyCursor(snapshotId, end) : "";
  const indexedAt = dateIso(
    snapshot?.payload?.tokenHistoryIndexedAt ?? snapshot?.generated_at,
  );

  return {
    cursor,
    end,
    indexedAt,
    indexedThroughBlock: rowNumber(snapshot, "indexed_through_block"),
    items: rowsResult.rows.map((row) => ({
      address: row.address,
      balance: Number(row.confirmed_balance),
    })),
    kind: "holders",
    limit: pagination.limit,
    network,
    nextCursor,
    page: Math.floor(start / pagination.limit),
    pageCount: Math.max(1, Math.ceil(totalCount / pagination.limit)),
    pageSize: pagination.limit,
    query: pagination.query,
    source: "proof-indexer-credit-balances",
    start,
    totalCount,
    snapshotId,
  };
}

export async function proofIndexRegistryHistoryPayload(
  network,
  kind,
  searchParams,
) {
  const pool = proofIndexPool();
  if (!pool) {
    return null;
  }

  const eligibility = proofIndexRegistryHistoryReadEligibility(
    kind,
    searchParams,
  );
  if (!eligibility.eligible) {
    return null;
  }

  const snapshot = await ledgerSnapshot(
    pool,
    network,
    eligibility.pagination.snapshotId,
  );
  if (
    !snapshot ||
    !snapshotPayloadFresh(snapshot, "registryHistoryIndexedAt")
  ) {
    return null;
  }

  const registryHistoryPayloads = registryHistoryPayloadsFromSnapshot(snapshot);
  const storedPayload = registryHistoryPayloads?.[eligibility.kind];
  if (!storedPayload || storedPayload.complete === false) {
    return null;
  }

  return historyPageFromStoredPayload(
    storedPayload,
    snapshot,
    network,
    eligibility.kind,
    eligibility.pagination,
  );
}

export async function proofIndexRegistryPayload(network, options = {}) {
  const pool = proofIndexPool();
  if (!pool) {
    return null;
  }

  const snapshot = await ledgerSnapshot(
    pool,
    network,
    options.snapshotId ?? "",
  );
  if (
    !snapshot ||
    !snapshotPayloadFresh(snapshot, "registryHistoryIndexedAt")
  ) {
    return null;
  }

  const registryHistoryPayloads = registryHistoryPayloadsFromSnapshot(snapshot);
  const recordsPayload = registryHistoryPayloads?.records;
  const listingsPayload = registryHistoryPayloads?.listings;
  const salesPayload = registryHistoryPayloads?.sales;
  const activityPayload = registryHistoryPayloads?.activity;
  const records = completeStoredItems(recordsPayload);
  const listings = completeStoredItems(listingsPayload);
  const sales = completeStoredItems(salesPayload);
  const activity = completeStoredItems(activityPayload);

  if (!records || !listings || !sales || !activity) {
    return null;
  }

  const pendingEvents = completeStoredItems(registryHistoryPayloads?.pending) ?? [];
  const confirmed = records.filter((record) => record?.confirmed).length;
  const pendingRecords = records.length - confirmed;
  const marketplaceStats = salesStats(sales);
  const indexedAt = dateIso(
    recordsPayload?.indexedAt ??
      activityPayload?.indexedAt ??
      snapshot?.payload?.registryHistoryIndexedAt ??
      snapshot?.generated_at,
  );
  const snapshotId = snapshot?.snapshot_id ?? "";
  const registryItems = [
    ...records,
    ...listings,
    ...sales,
    ...activity,
    ...pendingEvents,
  ];

  return {
    activity,
    indexedAt,
    indexedThroughBlock:
      indexedThroughBlockFromItems(registryItems) ??
      rowNumber(snapshot, "indexed_through_block"),
    listings,
    network,
    pendingEvents,
    records,
    registryAddress: String(options.registryAddress ?? ""),
    sales,
    snapshotId,
    source: "proof-indexer-registry-snapshot",
    stats: {
      confirmed,
      confirmedSales: marketplaceStats.confirmedSales,
      confirmedSalesVolumeSats: marketplaceStats.confirmedSalesVolumeSats,
      pending: pendingRecords + pendingEvents.length,
      pendingChanges: pendingEvents.length,
      pendingRecords,
      pendingSales: marketplaceStats.pendingSales,
      pendingSalesVolumeSats: marketplaceStats.pendingSalesVolumeSats,
      sales: marketplaceStats.sales,
      salesVolumeSats: marketplaceStats.salesVolumeSats,
      total: records.length,
      transactions:
        uniqueTxidCount(activity) || uniqueTxidCount(registryItems),
    },
  };
}

export async function proofIndexActivityPayload(network) {
  const pool = proofIndexPool();
  if (!pool) {
    return null;
  }

  const snapshot = await ledgerSnapshot(pool, network);
  if (!snapshot || !snapshotPayloadFresh(snapshot, "activityIndexedAt")) {
    return null;
  }

  return snapshotActivityPayload(snapshot);
}

function eventHistoryFilters(searchParams, pagination, baseValues = []) {
  const params = searchParams ?? new URLSearchParams();
  const filters = [];
  const values = [...baseValues];
  const addValue = (value) => {
    values.push(value);
    return `$${values.length}`;
  };
  const scalarFilter = (column, key) => {
    const value = String(params.get(key) ?? "").trim().toLowerCase();
    if (!value) {
      return;
    }
    filters.push(`${column} = ${addValue(value)}`);
  };

  scalarFilter("e.protocol", "protocol");
  scalarFilter("e.kind", "kind");
  const status = String(params.get("status") ?? "confirmed")
    .trim()
    .toLowerCase();
  if (status && status !== "all" && status !== "*") {
    filters.push(`e.status = ${addValue(status)}`);
  }
  const source = String(params.get("source") ?? "").trim().toLowerCase();
  if (source) {
    filters.push(`lower(e.payload->>'indexedFrom') = ${addValue(source)}`);
  }
  const txid = String(params.get("txid") ?? "").trim().toLowerCase();
  if (/^[0-9a-f]{64}$/u.test(txid)) {
    filters.push(`e.txid = ${addValue(txid)}`);
  }
  const address = String(params.get("address") ?? "").trim();
  if (address) {
    filters.push(`
      EXISTS (
        SELECT 1
        FROM proof_indexer.event_participants ep
        WHERE ep.event_id = e.event_id
          AND lower(ep.address) = ${addValue(address.toLowerCase())}
      )
    `);
  }
  const refType = String(params.get("refType") ?? params.get("ref_type") ?? "")
    .trim()
    .toLowerCase();
  const refValue = String(
    params.get("ref") ??
      params.get("refValue") ??
      params.get("ref_value") ??
      "",
  )
    .trim()
    .toLowerCase();
  if (refValue) {
    const valueParam = addValue(refValue);
    const typeFilter = refType ? `AND lower(er.ref_type) = ${addValue(refType)}` : "";
    filters.push(`
      EXISTS (
        SELECT 1
        FROM proof_indexer.event_refs er
        WHERE er.event_id = e.event_id
          AND lower(er.ref_value) = ${valueParam}
          ${typeFilter}
      )
    `);
  }
  if (pagination.query) {
    const queryParam = addValue(`%${pagination.query}%`);
    filters.push(`
      (
        lower(e.txid) LIKE ${queryParam}
        OR lower(e.payload::text) LIKE ${queryParam}
        OR EXISTS (
          SELECT 1
          FROM proof_indexer.event_refs erq
          WHERE erq.event_id = e.event_id
            AND lower(erq.ref_value) LIKE ${queryParam}
        )
        OR EXISTS (
          SELECT 1
          FROM proof_indexer.event_participants epq
          WHERE epq.event_id = e.event_id
            AND lower(epq.address) LIKE ${queryParam}
        )
      )
    `);
  }

  return { filters, values };
}

function eventRowPayload(row, network) {
  const payload = canonicalEventPayload(row.payload);
  return {
    txid: row.txid,
    protocol: row.protocol,
    kind: row.kind,
    status: row.status,
    confirmed: row.status === "confirmed",
    createdAt: dateIso(row.event_time ?? row.block_time ?? row.created_at),
    network,
    ...payload,
  };
}

const ADDRESS_MAIL_EVENT_KINDS = [
  "mail",
  "reply",
  "file",
  "attachment",
  "browser",
  "infinity-bond",
];

function normalizedAddress(value) {
  return String(value ?? "").trim();
}

function normalizedAddressKey(value) {
  return normalizedAddress(value).toLowerCase();
}

function positiveNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : 0;
}

function stringList(values) {
  return (Array.isArray(values) ? values : [])
    .map((value) => normalizedAddress(value))
    .filter(Boolean);
}

function mailSubjectFromEvent(row, payload) {
  const direct = String(row.subject ?? payload.subject ?? "").trim();
  if (direct) {
    return direct;
  }

  const detail = String(payload.detail ?? "").trim();
  const match = /^Subject:\s*(.+)$/isu.exec(detail);
  return match ? match[1].trim() : "";
}

function mailMemoFromEvent(row, payload) {
  const body = String(
    row.body_text ?? payload.body ?? payload.message ?? payload.memo ?? "",
  ).trim();
  if (body) {
    return body;
  }

  const detail = String(payload.detail ?? "").trim();
  if (detail && !/^Subject:\s*/iu.test(detail)) {
    return detail;
  }

  return "";
}

function mailParticipantsFromRow(row, payload) {
  const participantRows = Array.isArray(row.participants)
    ? row.participants
    : [];
  const addresses = [
    ...stringList(payload.participants),
    ...participantRows.map((participant) => participant?.address),
    payload.actor,
    payload.counterparty,
  ];
  const unique = new Map();
  for (const address of addresses) {
    const value = normalizedAddress(address);
    if (!value || /\s\+\d+$/u.test(value)) {
      continue;
    }
    unique.set(normalizedAddressKey(value), value);
  }
  return [...unique.values()];
}

function recipientRows(addresses, totalAmountSats) {
  const amount =
    addresses.length > 1 && totalAmountSats % addresses.length === 0
      ? totalAmountSats / addresses.length
      : totalAmountSats;
  return addresses.map((address) => ({
    address,
    amountSats: amount,
    display: address,
  }));
}

function recipientSummary(recipients) {
  const first = recipients[0];
  if (!first) {
    return "Unknown";
  }
  return recipients.length === 1
    ? first.display
    : `${first.display} +${recipients.length - 1}`;
}

function addressMailRowPayload(row, address, network) {
  const payload = canonicalEventPayload(row.payload);
  const targetAddress = normalizedAddress(address);
  const targetKey = normalizedAddressKey(targetAddress);
  const actor = normalizedAddress(payload.actor);
  const actorKey = normalizedAddressKey(actor);
  const participants = mailParticipantsFromRow(row, payload);
  const recipientAddresses = participants.filter(
    (participant) => normalizedAddressKey(participant) !== actorKey,
  );
  const totalAmountSats = positiveNumber(
    payload.amountSats ?? row.amount_sats,
  );
  const recipients = recipientRows(recipientAddresses, totalAmountSats);
  const createdAt = dateIso(row.event_time ?? row.block_time ?? row.created_at);
  const confirmed = row.status === "confirmed";
  const deliveryStatus = row.status === "orphaned" ? "dropped" : row.status;
  const subject = mailSubjectFromEvent(row, payload);
  const memo = mailMemoFromEvent(row, payload);
  const parentTxid = String(row.parent_txid ?? payload.parentTxid ?? "").trim();

  if (actorKey && actorKey === targetKey) {
    return {
      folder: "sent",
      message: {
        amountSats: totalAmountSats,
        confirmedAt: confirmed ? createdAt : undefined,
        createdAt,
        feeRate: 0,
        from: targetAddress,
        lastCheckedAt: new Date().toISOString(),
        memo,
        network,
        parentTxid: parentTxid || undefined,
        recipients: recipients.length > 0 ? recipients : undefined,
        replyTo: targetAddress,
        status: confirmed ? "confirmed" : deliveryStatus,
        subject: subject || undefined,
        to: recipientSummary(recipients),
        txid: row.txid,
      },
    };
  }

  const targetRecipient =
    recipients.find(
      (recipient) => normalizedAddressKey(recipient.address) === targetKey,
    ) ?? recipients[0];
  return {
    folder: "inbox",
    message: {
      amountSats: positiveNumber(targetRecipient?.amountSats) || totalAmountSats,
      confirmed,
      createdAt,
      from: actor || "Unknown",
      memo,
      network,
      parentTxid: parentTxid || undefined,
      recipients: recipients.length > 0 ? recipients : undefined,
      replyTo: actor || "Unknown",
      subject: subject || undefined,
      to: targetAddress,
      txid: row.txid,
    },
  };
}

function compareMailMessages(left, right) {
  return (
    Date.parse(right.createdAt) - Date.parse(left.createdAt) ||
    String(right.txid ?? "").localeCompare(String(left.txid ?? ""))
  );
}

export async function proofIndexAddressMailPayload(network, address) {
  const pool = proofIndexPool();
  if (!pool) {
    return null;
  }

  const targetAddress = normalizedAddress(address);
  if (!targetAddress) {
    return null;
  }

  const rowsResult = await pool.query(
    `
      SELECT
        e.payload,
        e.kind,
        e.status,
        e.event_time,
        e.block_time,
        e.created_at,
        e.txid,
        e.event_id,
        m.subject,
        m.parent_txid,
        m.body_text,
        m.amount_sats,
        COALESCE(
          jsonb_agg(
            jsonb_build_object(
              'address', ep.address,
              'role', ep.role,
              'powid', ep.powid
            )
            ORDER BY ep.role, ep.address
          ) FILTER (WHERE ep.address IS NOT NULL),
          '[]'::jsonb
        ) AS participants
      FROM proof_indexer.events e
      LEFT JOIN proof_indexer.mail_items m
        ON m.network = e.network
       AND m.txid = e.txid
      LEFT JOIN proof_indexer.event_participants ep
        ON ep.event_id = e.event_id
      WHERE e.network = $1
        AND e.valid = true
        AND e.kind = ANY($3::text[])
        AND e.status IN ('pending', 'confirmed', 'dropped', 'orphaned')
        AND EXISTS (
          SELECT 1
          FROM proof_indexer.event_participants target
          WHERE target.event_id = e.event_id
            AND lower(target.address) = $2
        )
      GROUP BY
        e.payload,
        e.kind,
        e.status,
        e.event_time,
        e.block_time,
        e.created_at,
        e.txid,
        e.event_id,
        m.subject,
        m.parent_txid,
        m.body_text,
        m.amount_sats
      ORDER BY
        COALESCE(e.event_time, e.block_time, e.created_at) DESC,
        e.txid DESC,
        e.event_id DESC
      LIMIT 1000
    `,
    [network, targetAddress.toLowerCase(), ADDRESS_MAIL_EVENT_KINDS],
  );

  const inboxMessages = [];
  const sentMessages = [];
  for (const row of rowsResult.rows) {
    const item = addressMailRowPayload(row, targetAddress, network);
    if (item.folder === "sent") {
      sentMessages.push(item.message);
    } else {
      inboxMessages.push(item.message);
    }
  }

  inboxMessages.sort(compareMailMessages);
  sentMessages.sort(compareMailMessages);

  return {
    address: targetAddress,
    inboxMessages,
    indexedAt: new Date().toISOString(),
    network,
    sentMessages,
    source: "proof-indexer-mail",
    stats: {
      inbox: inboxMessages.filter((message) => message.confirmed).length,
      incoming: inboxMessages.filter((message) => !message.confirmed).length,
      indexedEvents: rowsResult.rows.length,
      scanFailed: false,
      scannedTransactions: 0,
      sent: sentMessages.filter((message) => message.status === "confirmed")
        .length,
      outbox: sentMessages.filter((message) => message.status !== "confirmed")
        .length,
    },
  };
}

export async function proofIndexEventHistoryPayload(network, searchParams) {
  const pool = proofIndexPool();
  if (!pool) {
    return null;
  }

  const pagination = historyPaginationFromSearch(searchParams);
  const snapshot = await ledgerSnapshot(pool, network, pagination.snapshotId);
  if (!snapshot) {
    return null;
  }
  const { filters, values } = eventHistoryFilters(searchParams, pagination, [
    network,
  ]);
  const whereClause = ["e.network = $1", ...filters].join(" AND ");
  const countResult = await pool.query(
    `
      SELECT count(*) AS total_count, max(e.block_height) AS indexed_through_block
      FROM proof_indexer.events e
      WHERE ${whereClause}
    `,
    values,
  );
  const totalCount = rowNumber(countResult.rows[0], "total_count");
  const indexedThroughBlock = rowNumber(
    countResult.rows[0],
    "indexed_through_block",
  );
  const rowParams = [...values, pagination.limit, pagination.offset];
  const limitParam = rowParams.length - 1;
  const offsetParam = rowParams.length;
  const rowsResult = await pool.query(
    `
      SELECT
        e.payload,
        e.protocol,
        e.kind,
        e.status,
        e.event_time,
        e.block_time,
        e.created_at,
        e.block_height,
        e.txid,
        e.event_id
      FROM proof_indexer.events e
      WHERE ${whereClause}
      ORDER BY
        COALESCE(e.event_time, e.block_time, e.created_at) DESC,
        e.txid DESC,
        e.event_id DESC
      LIMIT $${limitParam}
      OFFSET $${offsetParam}
    `,
    rowParams,
  );
  const start = Math.min(pagination.offset, totalCount);
  const end = Math.min(totalCount, start + pagination.limit);
  const snapshotId = snapshot.snapshot_id ?? "";

  return {
    cursor: historyCursor(snapshotId, start),
    end,
    indexedAt: dateIso(snapshot.generated_at),
    indexedThroughBlock,
    items: rowsResult.rows.map((row) => eventRowPayload(row, network)),
    kind: "events",
    limit: pagination.limit,
    network,
    nextCursor: end < totalCount ? historyCursor(snapshotId, end) : "",
    page: Math.floor(start / pagination.limit),
    pageCount: Math.max(1, Math.ceil(totalCount / pagination.limit)),
    pageSize: pagination.limit,
    query: pagination.query,
    source: "proof-indexer-events",
    start,
    totalCount,
    ...(snapshotId ? { snapshotId } : {}),
  };
}

export async function proofIndexSnapshotPayload(network, key) {
  const pool = proofIndexPool();
  if (!pool) {
    return null;
  }

  const snapshot = await ledgerSnapshot(pool, network);
  if (!snapshot || !snapshotPayloadFresh(snapshot, "summaryPayloadsIndexedAt")) {
    return null;
  }

  const payload = snapshot?.payload?.summaryPayloads?.[key];
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return null;
  }
  return payload;
}

function historyItemKey(item) {
  return [
    item?.kind,
    item?.txid,
    item?.listingId,
    item?.closedTxid,
    item?.sealTxid,
    item?.tokenId,
    item?.ticker,
    item?.address,
    item?.minterAddress,
    item?.senderAddress,
    item?.recipientAddress,
    item?.sellerAddress,
    item?.buyerAddress,
  ]
    .filter((value) => value !== undefined && value !== null && value !== "")
    .join(":");
}

export function compareProofIndexHistoryPayloads(canonical, indexed) {
  const mismatches = [];
  if (!canonical || !indexed) {
    return ["missing-payload"];
  }
  if (Number(canonical.totalCount) !== Number(indexed.totalCount)) {
    mismatches.push(
      `totalCount:${canonical.totalCount ?? "null"}!=${indexed.totalCount ?? "null"}`,
    );
  }

  const canonicalItems = Array.isArray(canonical.items) ? canonical.items : [];
  const indexedItems = Array.isArray(indexed.items) ? indexed.items : [];
  if (canonicalItems.length !== indexedItems.length) {
    mismatches.push(`items.length:${canonicalItems.length}!=${indexedItems.length}`);
  }

  const sampleSize = Math.min(canonicalItems.length, indexedItems.length, 20);
  for (let index = 0; index < sampleSize; index += 1) {
    const left = canonicalItems[index];
    const right = indexedItems[index];
    const leftKey = historyItemKey(left);
    const rightKey = historyItemKey(right);
    if (leftKey !== rightKey) {
      mismatches.push(`item[${index}]:${leftKey}!=${rightKey}`);
      if (mismatches.length >= 5) {
        break;
      }
    }
  }

  return mismatches;
}

export async function proofIndexRecentTransactionIds(
  network,
  options = {},
) {
  const pool = proofIndexPool();
  if (!pool) {
    return [];
  }
  const limit = boundedInteger(options.limit, 20, 1, 100);
  const status = String(options.status ?? "confirmed").toLowerCase();
  const result = await pool.query(
    `
      SELECT txid
      FROM proof_indexer.transactions
      WHERE network = $1 AND status = $2
      ORDER BY COALESCE(confirmed_at, last_seen_at, updated_at) DESC, txid DESC
      LIMIT $3
    `,
    [network, status, limit],
  );
  return result.rows.map((row) => row.txid);
}
