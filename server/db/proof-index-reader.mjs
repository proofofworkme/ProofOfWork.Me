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

function historyPaginationFromSearch(searchParams) {
  const params = searchParams ?? new URLSearchParams();
  const limit = boundedInteger(params.get("limit"), 200, 1, 500);
  const page = boundedInteger(params.get("page"), 0, 0, 1_000_000);
  const cursorRaw = String(params.get("cursor") ?? "").trim();
  const offset = cursorRaw
    ? boundedInteger(cursorRaw, 0, 0, 100_000_000)
    : page * limit;
  const query = String(params.get("q") ?? params.get("search") ?? "")
    .trim()
    .toLowerCase();

  return { limit, offset, page, query };
}

export function proofIndexLogHistoryReadEligibility(kind, searchParams) {
  const requestedKind = String(kind ?? "").trim().toLowerCase();
  const pagination = historyPaginationFromSearch(searchParams);

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

  return {
    eligible: false,
    pagination,
    reason: "volatile-unfiltered-activity",
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

async function latestLedgerSnapshot(pool, network) {
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
  return snapshotResult.rows[0] ?? {};
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
  const nextCursor = end < totalCount ? String(end) : "";
  const indexedAt = dateIso(
    activityPayload.indexedAt ??
      activityPayload.generatedAt ??
      snapshot?.generated_at,
  );

  const page = {
    cursor: String(start),
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

  const snapshotId = activityPayload.snapshotId ?? snapshot?.snapshot_id;
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
  const snapshot = await latestLedgerSnapshot(pool, network);
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
  const nextCursor = end < totalCount ? String(end) : "";
  const indexedAt = snapshot.generated_at
    ? dateIso(snapshot.generated_at)
    : new Date().toISOString();

  const page = {
    cursor: String(start),
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

  if (snapshot.snapshot_id) {
    return {
      ...page,
      consistency: snapshot.consistency ?? undefined,
      ledgerGeneratedAt: indexedAt,
      snapshotId: snapshot.snapshot_id,
    };
  }

  return page;
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
    const leftKey = `${left?.kind ?? ""}:${left?.txid ?? ""}:${left?.listingId ?? ""}`;
    const rightKey = `${right?.kind ?? ""}:${right?.txid ?? ""}:${right?.listingId ?? ""}`;
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
