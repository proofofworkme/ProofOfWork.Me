import {
  createProofIndexPool,
  proofIndexDatabaseConfigured,
} from "./postgres.mjs";

let proofIndexReadPool = null;
const INFINITY_BOND_MEMO = "powb";
const INFINITY_BOND_KIND = "infinity-bond";
const PUBLIC_LOG_EVENT_KINDS = new Set([
  "attachment",
  "browser",
  "file",
  "id-buy",
  "id-delist",
  "id-list",
  "id-register",
  "id-seal",
  "id-transfer",
  "id-update",
  "infinity-bond",
  "mail",
  "reply",
  "rush-mint",
  "token-create",
  "token-listing",
  "token-listing-closed",
  "token-listing-sealed",
  "token-mint",
  "token-sale",
  "token-transfer",
]);
const SMALL_EVENT_HISTORY_NORMALIZE_LIMIT = 2_000;

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

function commaNumber(value) {
  const number = Number(String(value ?? "").replace(/,/gu, ""));
  return Number.isFinite(number) && number > 0 ? number : 0;
}

function tokenMarketNumbersFromTags(payload) {
  const tags = Array.isArray(payload?.tags) ? payload.tags.map(String) : [];
  let amount = 0;
  let priceSats = 0;
  let ticker = "";

  for (const tag of tags) {
    const amountMatch = /^([\d,]+)\s+([A-Z0-9]{1,16})$/u.exec(tag.trim());
    if (amountMatch && !amount) {
      amount = commaNumber(amountMatch[1]);
      ticker = amountMatch[2];
      continue;
    }

    const priceMatch = /^([\d,]+)\s+sale\s+proofs$/iu.exec(tag.trim());
    if (priceMatch && !priceSats) {
      priceSats = commaNumber(priceMatch[1]);
    }
  }

  return { amount, priceSats, ticker };
}

function tokenTransferAmountFromTags(payload, ticker = "") {
  const tags = Array.isArray(payload?.tags) ? payload.tags.map(String) : [];
  const normalizedTicker = String(ticker || "").trim().toUpperCase();
  for (const tag of tags) {
    const amountMatch = /^([\d,]+)\s+([A-Z0-9]{1,16})$/u.exec(tag.trim());
    if (!amountMatch) {
      continue;
    }
    if (normalizedTicker && amountMatch[2] !== normalizedTicker) {
      continue;
    }
    return commaNumber(amountMatch[1]);
  }
  return 0;
}

function tokenRegistryAddressFromPayload(payload, actor, counterparty, fallback = "") {
  const actorKey = String(actor ?? "").toLowerCase();
  const counterpartyKey = String(counterparty ?? "").toLowerCase();
  const participants = Array.isArray(payload?.participants)
    ? payload.participants
    : [];
  return (
    participants.find((participant) => {
      const value = String(participant ?? "").trim();
      const key = value.toLowerCase();
      return value && key !== actorKey && key !== counterpartyKey;
    }) ??
    payload?.registryAddress ??
    fallback ??
    ""
  );
}

function tokenSaleFromEventPayload(payload) {
  const { amount, priceSats, ticker } = tokenMarketNumbersFromTags(payload);
  const buyerAddress = String(payload?.actor ?? payload?.buyerAddress ?? "")
    .trim();
  const sellerAddress = String(
    payload?.counterparty ?? payload?.sellerAddress ?? "",
  ).trim();
  const registryAddress = tokenRegistryAddressFromPayload(
    payload,
    buyerAddress,
    sellerAddress,
  );
  return {
    amount,
    buyerAddress,
    confirmed: payload?.confirmed === true,
    createdAt: dateIso(payload?.createdAt),
    dataBytes: rowNumber(payload, "dataBytes"),
    listingId: String(payload?.listingId ?? "").trim().toLowerCase(),
    network: payload?.network,
    paidSats: rowNumber(payload, "amountSats"),
    priceSats,
    registryAddress,
    sellerAddress,
    ticker,
    tokenId: String(payload?.tokenId ?? "").trim().toLowerCase(),
    txid: String(payload?.txid ?? "").trim().toLowerCase(),
  };
}

function tokenListingFromEventPayload(payload) {
  const { amount, priceSats, ticker } = tokenMarketNumbersFromTags(payload);
  const sellerAddress = String(
    payload?.sellerAddress ?? payload?.actor ?? "",
  ).trim();
  const registryAddress = tokenRegistryAddressFromPayload(
    payload,
    sellerAddress,
    payload?.counterparty,
  );
  const saleAuthorization =
    payload?.saleAuthorization &&
    typeof payload.saleAuthorization === "object" &&
    !Array.isArray(payload.saleAuthorization)
      ? payload.saleAuthorization
      : {};
  return {
    amount: rowNumber(payload, "amount") || amount,
    confirmed: payload?.confirmed === true,
    createdAt: dateIso(payload?.createdAt),
    dataBytes: rowNumber(payload, "dataBytes"),
    listingId: String(payload?.listingId ?? payload?.txid ?? "")
      .trim()
      .toLowerCase(),
    network: payload?.network,
    priceSats: rowNumber(payload, "priceSats") || priceSats,
    registryAddress,
    saleAuthorization,
    sellerAddress,
    ticker,
    tokenId: String(payload?.tokenId ?? "").trim().toLowerCase(),
  };
}

function tokenClosedListingFromEventPayload(payload) {
  const { amount, priceSats, ticker } = tokenMarketNumbersFromTags(payload);
  const sellerAddress = String(payload?.actor ?? payload?.sellerAddress ?? "")
    .trim();
  const registryAddress = tokenRegistryAddressFromPayload(
    payload,
    sellerAddress,
    payload?.counterparty,
    payload?.counterparty,
  );
  const createdAt = dateIso(payload?.createdAt);
  return {
    amount,
    closedAt: createdAt,
    closedConfirmed: payload?.confirmed === true,
    closedTxid: String(payload?.txid ?? "").trim().toLowerCase(),
    confirmed: true,
    createdAt,
    dataBytes: rowNumber(payload, "dataBytes"),
    listingId: String(payload?.listingId ?? "").trim().toLowerCase(),
    network: payload?.network,
    priceSats,
    registryAddress,
    saleAuthorization: {},
    sellerAddress,
    ticker,
    tokenId: String(payload?.tokenId ?? "").trim().toLowerCase(),
  };
}

function tokenTransferFromEventPayload(payload, row = {}) {
  const ticker = String(row.ticker ?? payload?.ticker ?? "").trim();
  const senderAddress = String(
    payload?.senderAddress ?? payload?.from ?? payload?.actor ?? "",
  ).trim();
  const recipientAddress = String(
    payload?.recipientAddress ?? payload?.to ?? payload?.counterparty ?? "",
  ).trim();
  const registryAddress = tokenRegistryAddressFromPayload(
    payload,
    senderAddress,
    recipientAddress,
    row.registry_address,
  );
  const amount =
    rowNumber(payload, "amount") ||
    rowNumber(payload, "tokenAmount") ||
    tokenTransferAmountFromTags(payload, ticker);
  return {
    amount,
    confirmed:
      row.status === "confirmed" || payload?.confirmed === true,
    createdAt: dateIso(
      payload?.createdAt ?? row.event_time ?? row.block_time ?? row.created_at,
    ),
    dataBytes: rowNumber(payload, "dataBytes"),
    network: payload?.network ?? row.network,
    paidSats: rowNumber(payload, "paidSats") || rowNumber(payload, "amountSats"),
    recipientAddress,
    registryAddress,
    senderAddress,
    ticker,
    tokenId: String(payload?.tokenId ?? row.token_id ?? "").trim().toLowerCase(),
    txid: String(payload?.txid ?? row.txid ?? "").trim().toLowerCase(),
  };
}

function tokenHistoryItemFromMarketEventPayload(payload, safeKind) {
  if (payload?.kind === "token-listing") {
    const listing = tokenListingFromEventPayload(payload);
    if (!listing.listingId || !listing.tokenId) {
      return null;
    }
    if (safeKind === "listings") {
      return listing;
    }
    return {
      createdAt: listing.createdAt,
      kind: "listing",
      listing,
      txid: listing.listingId,
    };
  }

  if (payload?.kind === "token-sale") {
    const sale = tokenSaleFromEventPayload(payload);
    if (!sale.txid || !sale.listingId || !sale.tokenId) {
      return null;
    }
    if (safeKind === "sales") {
      return sale;
    }
    return {
      createdAt: sale.createdAt,
      kind: "sale",
      sale,
      txid: sale.txid,
    };
  }

  if (payload?.kind === "token-listing-closed") {
    const closedListing = tokenClosedListingFromEventPayload(payload);
    if (
      !closedListing.closedTxid ||
      !closedListing.listingId ||
      !closedListing.tokenId
    ) {
      return null;
    }
    if (safeKind === "closedListings") {
      return closedListing;
    }
    return {
      closedListing,
      createdAt: closedListing.closedAt ?? closedListing.createdAt,
      kind: "closed-listing",
      txid: closedListing.closedTxid || closedListing.listingId,
    };
  }

  return null;
}

function compareTokenItemsByTime(left, right) {
  const leftTime = Date.parse(left?.createdAt ?? left?.closedAt ?? "");
  const rightTime = Date.parse(right?.createdAt ?? right?.closedAt ?? "");
  return (
    (Number.isFinite(rightTime) ? rightTime : 0) -
      (Number.isFinite(leftTime) ? leftTime : 0) ||
    String(right?.txid ?? right?.closedTxid ?? right?.listingId ?? "")
      .localeCompare(String(left?.txid ?? left?.closedTxid ?? left?.listingId ?? ""))
  );
}

function tokenHistoryMarketEventKinds(safeKind) {
  if (safeKind === "listings") {
    return ["token-listing"];
  }
  if (safeKind === "sales") {
    return ["token-sale"];
  }
  if (safeKind === "closedListings") {
    return ["token-listing-closed"];
  }
  if (safeKind === "market-log") {
    return ["token-listing", "token-sale", "token-listing-closed"];
  }
  return [];
}

function tokenListingId(item) {
  return String(item?.listingId ?? item?.listing?.listingId ?? "")
    .trim()
    .toLowerCase();
}

function tokenHistoryItemKey(item, safeKind) {
  if (safeKind === "market-log") {
    if (item?.kind === "sale") {
      return `sale:${String(item.sale?.txid ?? item.txid ?? "").toLowerCase()}`;
    }
    if (item?.kind === "closed-listing") {
      return `closed:${String(
        item.closedListing?.listingId ?? "",
      ).toLowerCase()}:${String(
        item.closedListing?.closedTxid ?? item.txid ?? "",
      ).toLowerCase()}`;
    }
    if (item?.kind === "listing") {
      return `listing:${String(
        item.listing?.listingId ?? item.txid ?? "",
      ).toLowerCase()}`;
    }
  }

  if (safeKind === "closedListings") {
    return `closed:${String(item?.listingId ?? "").toLowerCase()}:${String(
      item?.closedTxid ?? item?.txid ?? "",
    ).toLowerCase()}`;
  }

  if (safeKind === "sales") {
    return `sale:${String(item?.txid ?? "").toLowerCase()}`;
  }

  return String(item?.txid ?? item?.listingId ?? JSON.stringify(item));
}

function tokenHistoryItemCreatedAt(item) {
  if (item?.kind === "sale") {
    return item.sale?.createdAt ?? item.createdAt;
  }
  if (item?.kind === "closed-listing") {
    return item.closedListing?.closedAt ?? item.closedListing?.createdAt ?? item.createdAt;
  }
  if (item?.kind === "listing") {
    return item.listing?.createdAt ?? item.createdAt;
  }
  return item?.closedAt ?? item?.createdAt;
}

function compareTokenHistoryMarketItems(left, right) {
  const leftTime = Date.parse(tokenHistoryItemCreatedAt(left) ?? "");
  const rightTime = Date.parse(tokenHistoryItemCreatedAt(right) ?? "");
  return (
    (Number.isFinite(rightTime) ? rightTime : 0) -
      (Number.isFinite(leftTime) ? leftTime : 0) ||
    String(right?.txid ?? right?.closedTxid ?? right?.listingId ?? "")
      .localeCompare(String(left?.txid ?? left?.closedTxid ?? left?.listingId ?? ""))
  );
}

function tokenHistoryPageFromItems({
  indexedAt,
  indexedThroughBlock,
  items,
  kind,
  network,
  pagination,
  source,
  snapshot,
}) {
  const needles = tokenHistoryFilterNeedles(new URLSearchParams(), pagination);
  const filtered = historyItemsMatchingNeedles(items, needles);
  const totalCount = filtered.length;
  const start = Math.min(pagination.offset, totalCount);
  const end = Math.min(totalCount, start + pagination.limit);
  const snapshotId = snapshot?.snapshot_id ?? "";
  const cursor = historyCursor(snapshotId, start);
  const nextCursor = end < totalCount ? historyCursor(snapshotId, end) : "";
  const page = {
    cursor,
    end,
    indexedAt,
    indexedThroughBlock:
      indexedThroughBlock ?? indexedThroughBlockFromItems(filtered),
    items: filtered.slice(start, end),
    kind,
    limit: pagination.limit,
    network,
    nextCursor,
    page: Math.floor(start / pagination.limit),
    pageCount: Math.max(1, Math.ceil(totalCount / pagination.limit)),
    pageSize: pagination.limit,
    query: pagination.query,
    source,
    start,
    totalCount,
  };
  if (snapshotId) {
    return {
      ...page,
      consistency: snapshot?.consistency ?? undefined,
      ledgerGeneratedAt: dateIso(snapshot?.generated_at),
      snapshotId,
    };
  }
  return page;
}

function mergedSourceLabel(...sources) {
  return [
    ...new Set(
      sources
        .flatMap((source) => String(source ?? "").split("+"))
        .map((source) => source.trim())
        .filter(Boolean),
    ),
  ].join("+");
}

function mergeTokenHistoryPages(basePage, overlayPage, safeKind, pagination) {
  if (!overlayPage || !Array.isArray(overlayPage.items) || overlayPage.items.length === 0) {
    return basePage;
  }
  if (!basePage) {
    return overlayPage;
  }

  const byKey = new Map();
  for (const item of [
    ...overlayPage.items,
    ...(Array.isArray(basePage.items) ? basePage.items : []),
  ]) {
    byKey.set(tokenHistoryItemKey(item, safeKind), item);
  }
  const items = [...byKey.values()].sort(compareTokenHistoryMarketItems);
  return {
    ...tokenHistoryPageFromItems({
      indexedAt: dateIso(overlayPage.indexedAt ?? basePage.indexedAt),
      indexedThroughBlock:
        overlayPage.indexedThroughBlock ?? basePage.indexedThroughBlock,
      items,
      kind: safeKind,
      network: basePage.network ?? overlayPage.network,
      pagination: {
        ...pagination,
        offset: 0,
      },
      source: mergedSourceLabel(basePage.source, overlayPage.source),
      snapshot: {
        consistency: basePage.consistency ?? overlayPage.consistency,
        generated_at:
          basePage.ledgerGeneratedAt ?? overlayPage.ledgerGeneratedAt,
        snapshot_id: basePage.snapshotId ?? overlayPage.snapshotId ?? "",
      },
    }),
    totalCount: Math.max(
      Number(basePage.totalCount ?? 0),
      Number(overlayPage.totalCount ?? 0),
      items.length,
    ),
  };
}

async function filterClosedTokenListingHistoryPage(pool, page, network) {
  if (!page || !Array.isArray(page.items) || page.items.length === 0) {
    return page;
  }

  const listingIds = [...new Set(page.items.map(tokenListingId).filter(Boolean))];
  if (listingIds.length === 0) {
    return page;
  }

  const result = await pool.query(
    `
      SELECT DISTINCT lower(e.payload->>'listingId') AS listing_id
      FROM proof_indexer.events e
      WHERE e.network = $1
        AND e.valid = true
        AND e.kind = ANY($2::text[])
        AND lower(e.payload->>'listingId') = ANY($3::text[])
    `,
    [network, ["token-listing-closed", "token-sale"], listingIds],
  );
  const closedListingIds = new Set(
    result.rows
      .map((row) => String(row?.listing_id ?? "").trim().toLowerCase())
      .filter(Boolean),
  );
  if (closedListingIds.size === 0) {
    return page;
  }

  const items = page.items.filter(
    (item) => !closedListingIds.has(tokenListingId(item)),
  );
  return {
    ...page,
    items,
    totalCount: Math.max(
      0,
      Number(page.totalCount ?? page.items.length) -
        (page.items.length - items.length),
    ),
  };
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

function rawTransactionItemPayload(row) {
  const raw = row?.transaction_raw_tx;
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return {};
  }
  const item = raw.item;
  if (item && typeof item === "object" && !Array.isArray(item)) {
    return item;
  }
  return raw;
}

function normalizedText(value) {
  return String(value ?? "").trim();
}

function normalizedLowerText(value) {
  return normalizedText(value).toLowerCase();
}

function isInfinityBondMemoText(value) {
  return normalizedLowerText(value) === INFINITY_BOND_MEMO;
}

function isInfinityBondEventPayload(payload, row = {}) {
  const kind = normalizedLowerText(payload?.kind ?? row.kind);
  if (kind === INFINITY_BOND_KIND) {
    return true;
  }
  if (kind !== "mail") {
    return false;
  }
  return [
    payload?.detail,
    payload?.memo,
    payload?.body,
    payload?.message,
    row.body_text,
  ].some(isInfinityBondMemoText);
}

function normalizedInfinityBondTags(tags) {
  const normalized = [];
  for (const tag of Array.isArray(tags) ? tags : []) {
    const value = String(tag ?? "").trim();
    if (!value) {
      continue;
    }
    normalized.push(/^message$/iu.test(value) ? "Infinity Bond" : value);
  }
  if (!normalized.some((tag) => /^infinity bond$/iu.test(tag))) {
    normalized.push("Infinity Bond");
  }
  return normalized;
}

function normalizedInfinityBondTitle(payload, row = {}) {
  const title = normalizedText(payload?.title);
  if (title && !/^(?:mail|message)\b/iu.test(title)) {
    return title;
  }
  const confirmed = row.status
    ? normalizedLowerText(row.status) === "confirmed"
    : payload?.confirmed !== false;
  return `Infinity Bond ${confirmed ? "sent" : "pending"}`;
}

function normalizeEventPayload(payload, row = {}) {
  if (!isInfinityBondEventPayload(payload, row)) {
    return payload;
  }
  return {
    ...payload,
    detail: normalizedText(payload?.detail) || INFINITY_BOND_MEMO,
    kind: INFINITY_BOND_KIND,
    tags: normalizedInfinityBondTags(payload?.tags),
    title: normalizedInfinityBondTitle(payload, row),
  };
}

function eventKindSqlCondition(kind, addValue) {
  const normalizedKind = normalizedLowerText(kind);
  if (normalizedKind !== INFINITY_BOND_KIND) {
    return `e.kind = ${addValue(normalizedKind)}`;
  }

  const infinityBondKindParam = addValue(INFINITY_BOND_KIND);
  const mailKindParam = addValue("mail");
  const memoParam = addValue(INFINITY_BOND_MEMO);
  return `
    (
      e.kind = ${infinityBondKindParam}
      OR (
        e.kind = ${mailKindParam}
        AND (
          lower(coalesce(e.payload->>'detail', '')) = ${memoParam}
          OR lower(coalesce(e.payload->>'memo', '')) = ${memoParam}
          OR lower(coalesce(e.payload->>'body', '')) = ${memoParam}
          OR lower(coalesce(e.payload->>'message', '')) = ${memoParam}
        )
      )
    )
  `;
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

function historyActivityKey(item) {
  if (item?.kind === "token-listing-closed" && item?.txid) {
    return `${item.kind}:${item.network}:${item.txid}`;
  }

  return [
    item?.kind,
    item?.network,
    item?.txid,
    item?.listingId ?? "",
    item?.id ?? "",
  ].join(":");
}

function historyActivityRichness(item) {
  return [
    item?.title,
    item?.description,
    item?.detail,
    item?.listingId,
    item?.tokenId,
    item?.actor,
    item?.counterparty,
    ...(Array.isArray(item?.tags) ? item.tags : []),
    ...(Array.isArray(item?.participants) ? item.participants : []),
  ].filter(Boolean).length;
}

function eventKindTitle(kind, confirmed) {
  const label = String(kind ?? "")
    .split(/[-_]+/u)
    .filter(Boolean)
    .map((part) => `${part.slice(0, 1).toUpperCase()}${part.slice(1)}`)
    .join(" ");
  return `${label || "ProofOfWork event"} ${confirmed ? "confirmed" : "pending"}`;
}

function safeEventTags(item, network, confirmed) {
  const tags = (Array.isArray(item?.tags) ? item.tags : [])
    .map((tag) => normalizedText(tag))
    .filter(Boolean);
  if (tags.length > 0) {
    return tags;
  }

  return [
    confirmed ? "Confirmed" : "Pending",
    network === "livenet" ? "Mainnet" : network,
    normalizedText(item?.kind),
  ].filter(Boolean);
}

function normalizeHistoryEventItem(item, network, { publicOnly = false } = {}) {
  const kind = normalizedLowerText(item?.kind);
  if (publicOnly && !PUBLIC_LOG_EVENT_KINDS.has(kind)) {
    return null;
  }

  const txid = normalizedLowerText(item?.txid);
  if (!txid) {
    return null;
  }

  const confirmed =
    typeof item?.confirmed === "boolean"
      ? item.confirmed
      : normalizedLowerText(item?.status) === "confirmed";
  const createdAt = dateIso(item?.createdAt);
  const title = normalizedText(item?.title) || eventKindTitle(kind, confirmed);
  const description =
    normalizedText(item?.description) ||
    normalizedText(item?.detail) ||
    `${title} for ${txid.slice(0, 8)}...${txid.slice(-8)}.`;

  return {
    ...item,
    confirmed,
    createdAt,
    description,
    kind,
    network: normalizedText(item?.network) || network,
    tags: safeEventTags(item, network, confirmed),
    title,
    txid,
  };
}

function normalizeHistoryEventRows(rows, network, options = {}) {
  const merged = new Map();

  for (const row of Array.isArray(rows) ? rows : []) {
    const item = normalizeHistoryEventItem(eventRowPayload(row, network), network, options);
    if (!item) {
      continue;
    }

    const key = historyActivityKey(item);
    const current = merged.get(key);
    if (
      !current ||
      (item.confirmed && !current.confirmed) ||
      (item.confirmed === current.confirmed &&
        historyActivityRichness(item) > historyActivityRichness(current))
    ) {
      merged.set(key, item);
    }
  }

  return [...merged.values()].sort(compareHistoryItems);
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
    24 * 60 * 60_000,
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
        .map((item) =>
          normalizeHistoryEventItem(normalizeEventPayload(item), network, {
            publicOnly: true,
          }),
        )
        .filter(Boolean)
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

function logHistoryPageFromItems({
  indexedAt,
  indexedThroughBlock,
  items,
  kind,
  network,
  pagination,
  snapshot,
  source,
}) {
  const totalCount = items.length;
  const start = Math.min(pagination.offset, totalCount);
  const end = Math.min(totalCount, start + pagination.limit);
  const snapshotId = snapshot?.snapshot_id ?? "";
  const page = {
    cursor: historyCursor(snapshotId, start),
    end,
    indexedAt,
    indexedThroughBlock:
      indexedThroughBlock ?? indexedThroughBlockFromItems(items),
    items: items.slice(start, end),
    kind,
    limit: pagination.limit,
    network,
    nextCursor: end < totalCount ? historyCursor(snapshotId, end) : "",
    page: Math.floor(start / pagination.limit),
    pageCount: Math.max(1, Math.ceil(totalCount / pagination.limit)),
    pageSize: pagination.limit,
    query: pagination.query,
    source,
    start,
    totalCount,
  };

  if (snapshotId) {
    return {
      ...page,
      consistency: snapshot?.consistency ?? undefined,
      ledgerGeneratedAt: dateIso(snapshot?.generated_at),
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

export async function proofIndexTokenMarketHistoryOverlayPayload(
  network,
  tokenScope,
  kind,
  searchParams,
  options = {},
) {
  const pool = proofIndexPool();
  if (!pool) {
    return null;
  }

  const safeKind = tokenHistorySafeKind(kind);
  const eventKinds = tokenHistoryMarketEventKinds(safeKind);
  if (eventKinds.length === 0) {
    return null;
  }

  const pagination =
    options.pagination ?? historyPaginationFromSearch(searchParams);
  const scope = tokenScopeKey(tokenScope);
  const snapshot =
    options.snapshot ?? (await ledgerSnapshot(pool, network, pagination.snapshotId));
  const conditions = [
    "e.network = $1",
    "e.valid = true",
    "e.kind = ANY($2::text[])",
  ];
  const params = [network, eventKinds];

  if (scope && scope !== "all") {
    params.push(scope);
    const scopeParam = `$${params.length}`;
    params.push(`%${scope}%`);
    const scopeLikeParam = `$${params.length}`;
    conditions.push(
      `(lower(e.payload->>'tokenId') = ${scopeParam} OR lower(e.payload::text) LIKE ${scopeLikeParam})`,
    );
  }

  const needles = tokenHistoryFilterNeedles(searchParams, pagination);
  for (const needle of needles) {
    params.push(`%${needle}%`);
    const param = `$${params.length}`;
    conditions.push(`lower(e.payload::text) LIKE ${param}`);
  }
  if (safeKind === "listings") {
    conditions.push(
      `NOT EXISTS (
        SELECT 1
        FROM proof_indexer.events close_event
        WHERE close_event.network = e.network
          AND close_event.valid = true
          AND close_event.kind = ANY(ARRAY['token-listing-closed','token-sale']::text[])
          AND lower(close_event.payload->>'listingId') = lower(e.payload->>'listingId')
      )`,
    );
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
  if (totalCount === 0) {
    return null;
  }

  const rowParams = [...params, pagination.limit, pagination.offset];
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
  const items = rowsResult.rows
    .map((row) =>
      tokenHistoryItemFromMarketEventPayload(eventRowPayload(row, network), safeKind),
    )
    .filter(Boolean)
    .sort(compareTokenHistoryMarketItems);
  const start = Math.min(pagination.offset, totalCount);
  const end = Math.min(totalCount, start + pagination.limit);
  const snapshotId = snapshot?.snapshot_id ?? "";
  const cursor = historyCursor(snapshotId, start);
  const nextCursor = end < totalCount ? historyCursor(snapshotId, end) : "";
  const indexedAt = dateIso(
    rowsResult.rows[0]?.event_time ??
      rowsResult.rows[0]?.block_time ??
      rowsResult.rows[0]?.created_at ??
      snapshot?.generated_at,
  );
  const page = {
    cursor,
    end,
    indexedAt,
    indexedThroughBlock,
    items,
    kind: safeKind,
    limit: pagination.limit,
    network,
    nextCursor,
    page: Math.floor(start / pagination.limit),
    pageCount: Math.max(1, Math.ceil(totalCount / pagination.limit)),
    pageSize: pagination.limit,
    query: pagination.query,
    source: "proof-indexer-token-events",
    start,
    totalCount,
  };
  if (snapshotId) {
    return {
      ...page,
      consistency: snapshot?.consistency ?? undefined,
      ledgerGeneratedAt: dateIso(snapshot?.generated_at),
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
  if (
    snapshotPage &&
    !((requestedKind || pagination.query) && snapshotPage.totalCount === 0)
  ) {
    return snapshotPage;
  }

  const conditions = ["e.network = $1"];
  const params = [network];
  const addParam = (value) => {
    params.push(value);
    return `$${params.length}`;
  };

  if (requestedKind) {
    conditions.push(eventKindSqlCondition(requestedKind, addParam));
  }

  if (pagination.query) {
    conditions.push(
      `lower(e.payload::text) LIKE ${addParam(`%${pagination.query}%`)}`,
    );
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

  if (
    totalCount > 0 &&
    totalCount <= SMALL_EVENT_HISTORY_NORMALIZE_LIMIT
  ) {
    const allRowsResult = await pool.query(
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
        LIMIT ${totalCount}
      `,
      params,
    );
    return logHistoryPageFromItems({
      indexedAt: snapshot.generated_at
        ? dateIso(snapshot.generated_at)
        : new Date().toISOString(),
      indexedThroughBlock,
      items: normalizeHistoryEventRows(allRowsResult.rows, network, {
        publicOnly: true,
      }),
      kind: requestedKind || "activity",
      network,
      pagination,
      snapshot,
      source: "proof-indexer",
    });
  }

  const rowParams = [...params, pagination.limit, pagination.offset];
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
    items: normalizeHistoryEventRows(rowsResult.rows, network, {
      publicOnly: true,
    }),
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

export async function proofIndexTokenMarketSummaryOverlayPayload(
  network,
  tokenScope,
  options = {},
) {
  const pool = proofIndexPool();
  if (!pool) {
    return null;
  }

  const scope = tokenScopeKey(tokenScope);
  const maxRows = boundedInteger(options.limit, 5000, 1, 10000);
  const conditions = [
    "e.network = $1",
    "e.valid = true",
    "e.kind = ANY($2::text[])",
  ];
  const params = [
    network,
    ["token-listing", "token-sale", "token-listing-closed"],
  ];

  if (scope && scope !== "all") {
    params.push(scope);
    const scopeParam = `$${params.length}`;
    params.push(`%${scope}%`);
    const scopeLikeParam = `$${params.length}`;
    conditions.push(
      `(lower(e.payload->>'tokenId') = ${scopeParam} OR lower(e.payload::text) LIKE ${scopeLikeParam})`,
    );
  }

  const whereClause = conditions.join(" AND ");
  const countResult = await pool.query(
    `
      SELECT
        count(*) AS total_count,
        max(e.block_height) AS indexed_through_block,
        max(COALESCE(e.event_time, e.block_time, e.created_at)) AS indexed_at
      FROM proof_indexer.events e
      WHERE ${whereClause}
    `,
    params,
  );
  const totalCount = rowNumber(countResult.rows[0], "total_count");
  if (totalCount === 0) {
    return null;
  }

  const rowParams = [...params, maxRows];
  const limitParam = `$${rowParams.length}`;
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
      LIMIT ${limitParam}
    `,
    rowParams,
  );

  const sales = [];
  const listings = [];
  const closedListings = [];
  for (const row of rowsResult.rows) {
    const payload = eventRowPayload(row, network);
    if (payload?.kind === "token-listing") {
      const listing = tokenListingFromEventPayload(payload);
      if (listing.listingId && listing.tokenId) {
        listings.push(listing);
      }
      continue;
    }

    if (payload?.kind === "token-sale") {
      const sale = tokenSaleFromEventPayload(payload);
      if (sale.txid && sale.listingId && sale.tokenId) {
        sales.push(sale);
      }
      continue;
    }

    if (payload?.kind === "token-listing-closed") {
      const closedListing = tokenClosedListingFromEventPayload(payload);
      if (
        closedListing.closedTxid &&
        closedListing.listingId &&
        closedListing.tokenId
      ) {
        closedListings.push(closedListing);
      }
    }
  }

  const stats = salesStats(sales);
  return {
    closedListings: closedListings.sort(compareTokenItemsByTime),
    indexedAt: dateIso(countResult.rows[0]?.indexed_at),
    indexedThroughBlock: rowNumber(
      countResult.rows[0],
      "indexed_through_block",
    ),
    listings: listings.sort(compareTokenItemsByTime),
    sales: sales.sort(compareTokenItemsByTime),
    source: "proof-indexer-token-market-summary-overlay",
    stats: {
      ...stats,
      complete: rowsResult.rows.length >= totalCount,
      totalCount,
    },
  };
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
  const marketOverlayPage = await proofIndexTokenMarketHistoryOverlayPayload(
    network,
    tokenScope,
    eligibility.kind,
    searchParams,
    {
      pagination: eligibility.pagination,
      snapshot,
    },
  );
  let page = snapshotPage;
  if (marketOverlayPage) {
    page = mergeTokenHistoryPages(
      snapshotPage,
      marketOverlayPage,
      eligibility.kind,
      eligibility.pagination,
    );
  }
  if (page && eligibility.kind === "listings") {
    page = await filterClosedTokenListingHistoryPage(pool, page, network);
  }
  if (page) {
    return page;
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
    indexedThroughBlock: rowNumber(snapshot, "indexed_through_block"),
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

export async function proofIndexWalletTokenOverlayPayload(
  network,
  tokenScope,
  addresses,
) {
  const pool = proofIndexPool();
  const addressNeedles = [
    ...new Set(
      (Array.isArray(addresses) ? addresses : [])
        .map((address) => String(address ?? "").trim().toLowerCase())
        .filter(Boolean),
    ),
  ];
  if (!pool || addressNeedles.length === 0) {
    return null;
  }

  const scope = tokenScopeKey(tokenScope);
  const scoped = scope && scope !== "all";
  const scopeCondition = scoped
    ? "AND (lower(cb.token_id) = $3 OR lower(cd.ticker) = lower($3))"
    : "";
  const holderParams = scoped
    ? [network, addressNeedles, scope]
    : [network, addressNeedles];
  const holderResult = await pool.query(
    `
      SELECT
        cb.address,
        cb.confirmed_balance,
        cb.pending_delta,
        cb.updated_at,
        cb.token_id,
        cd.ticker,
        cd.registry_address
      FROM proof_indexer.credit_balances cb
      JOIN proof_indexer.credit_definitions cd
        ON cd.network = cb.network
       AND cd.token_id = cb.token_id
      WHERE cb.network = $1
        AND lower(cb.address) = ANY($2::text[])
        ${scopeCondition}
      ORDER BY cb.updated_at DESC, cb.address ASC
    `,
    holderParams,
  );

  const eventConditions = [
    "e.network = $1",
    "e.valid = true",
    "e.status IN ('confirmed', 'pending')",
    `EXISTS (
      SELECT 1
      FROM proof_indexer.event_participants ep
      WHERE ep.event_id = e.event_id
        AND lower(ep.address) = ANY($2::text[])
    )`,
  ];
  const eventParams = [network, addressNeedles];
  if (scoped) {
    eventParams.push(scope);
    const scopeParam = `$${eventParams.length}`;
    eventConditions.push(
      `(lower(e.payload->>'tokenId') = ${scopeParam} OR lower(cd.ticker) = lower(${scopeParam}))`,
    );
  }
  const eventWhere = eventConditions.join(" AND ");
  const eventParamsWithLimit = [...eventParams, 500];
  const eventLimitParam = `$${eventParamsWithLimit.length}`;
  const eventResult = await pool.query(
    `
      SELECT
        e.payload,
        e.status,
        e.event_time,
        e.block_time,
        e.created_at,
        e.block_height,
        e.txid,
        e.network,
        cd.token_id,
        cd.ticker,
        cd.registry_address
      FROM proof_indexer.events e
      LEFT JOIN proof_indexer.credit_definitions cd
        ON cd.network = e.network
       AND cd.token_id = lower(e.payload->>'tokenId')
      WHERE ${eventWhere}
        AND e.kind IN ('token-transfer', 'token-sale')
      ORDER BY
        COALESCE(e.event_time, e.block_time, e.created_at) DESC,
        e.txid DESC,
        e.event_id DESC
      LIMIT ${eventLimitParam}
    `,
    eventParamsWithLimit,
  );

  const holders = holderResult.rows
    .map((row) => ({
      address: row.address,
      balance: Number(row.confirmed_balance ?? 0),
      pendingDelta: Number(row.pending_delta ?? 0),
      ticker: row.ticker,
      tokenId: String(row.token_id ?? "").toLowerCase(),
    }))
    .filter((holder) => holder.address && holder.balance > 0)
    .sort(
      (left, right) =>
        right.balance - left.balance ||
        left.address.localeCompare(right.address),
    );
  const transfers = [];
  const sales = [];
  for (const row of eventResult.rows) {
    const payload = normalizeEventPayload(canonicalEventPayload(row.payload), row);
    if (payload?.kind === "token-transfer") {
      const transfer = tokenTransferFromEventPayload(payload, row);
      if (
        transfer.txid &&
        transfer.tokenId &&
        transfer.amount > 0 &&
        (transfer.senderAddress || transfer.recipientAddress)
      ) {
        transfers.push(transfer);
      }
      continue;
    }
    if (payload?.kind === "token-sale") {
      const sale = tokenSaleFromEventPayload(payload);
      if (sale.txid && sale.listingId && sale.tokenId) {
        sales.push(sale);
      }
    }
  }

  const newestTime = [
    ...holderResult.rows.map((row) => row.updated_at),
    ...eventResult.rows.map(
      (row) => row.event_time ?? row.block_time ?? row.created_at,
    ),
  ]
    .map((value) => Date.parse(value))
    .filter(Number.isFinite)
    .reduce((max, value) => Math.max(max, value), 0);

  return {
    holders,
    indexedAt: newestTime ? new Date(newestTime).toISOString() : undefined,
    sales: sales.sort(compareTokenItemsByTime),
    source: "proof-indexer-wallet-token-overlay",
    transfers: transfers.sort(compareTokenItemsByTime),
  };
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
  const kind = String(params.get("kind") ?? "").trim().toLowerCase();
  if (kind) {
    filters.push(eventKindSqlCondition(kind, addValue));
  }
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
  const payload = normalizeEventPayload(canonicalEventPayload(row.payload), row);
  return {
    ...payload,
    txid: row.txid ?? payload.txid,
    protocol: row.protocol ?? payload.protocol,
    kind: normalizedLowerText(payload.kind ?? row.kind),
    status: row.status ?? payload.status,
    confirmed: row.status ? row.status === "confirmed" : payload.confirmed,
    createdAt: dateIso(row.event_time ?? row.block_time ?? row.created_at),
    network,
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

function knownMailAddress(value) {
  const address = normalizedAddress(value);
  return /^unknown$/iu.test(address) ? "" : address;
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
    .map((value) => knownMailAddress(value))
    .filter(Boolean);
}

function recipientAddressRecords(values) {
  return (Array.isArray(values) ? values : [])
    .map((value) => {
      if (typeof value === "string") {
        return { address: value, role: "recipient" };
      }
      return { address: value?.address, role: "recipient" };
    })
    .filter((record) => knownMailAddress(record.address));
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

function subjectOnlyMailBody(value) {
  return /^Subject:\s*/iu.test(String(value ?? "").trim());
}

function mailMemoFromEvent(row, payload) {
  const payloadBody = String(
    payload.body ?? payload.message ?? payload.memo ?? "",
  ).trim();
  if (payloadBody) {
    return payloadBody;
  }

  const storedBody = String(row.body_text ?? "").trim();
  if (storedBody && !subjectOnlyMailBody(storedBody)) {
    return storedBody;
  }

  const detail = String(payload.detail ?? "").trim();
  if (detail && !subjectOnlyMailBody(detail)) {
    return detail;
  }

  return "";
}

function mailParticipantRecordsFromRow(row, payload, rawPayload = {}) {
  const participantRows = Array.isArray(row.participants)
    ? row.participants
    : [];
  const records = [
    ...participantRows.map((participant) => ({
      address: participant?.address,
      role: participant?.role,
    })),
    { address: row.sender_address, role: "sender" },
    ...stringList(payload.participants).map((address) => ({
      address,
      role: "participant",
    })),
    ...stringList(rawPayload.participants).map((address) => ({
      address,
      role: "participant",
    })),
    ...recipientAddressRecords(payload.recipients),
    ...recipientAddressRecords(rawPayload.recipients),
    { address: payload.actor, role: "sender" },
    { address: rawPayload.actor, role: "sender" },
    { address: payload.counterparty, role: "recipient" },
    { address: rawPayload.counterparty, role: "recipient" },
  ];
  const unique = new Map();
  for (const record of records) {
    const value = knownMailAddress(record.address);
    if (!value || /\s\+\d+$/u.test(value)) {
      continue;
    }
    const role = String(record.role ?? "participant").trim().toLowerCase();
    unique.set(`${normalizedAddressKey(value)}:${role}`, {
      address: value,
      role,
    });
  }
  return [...unique.values()];
}

function mailParticipantsFromRow(row, payload, rawPayload = {}) {
  const unique = new Map();
  for (const participant of mailParticipantRecordsFromRow(row, payload, rawPayload)) {
    unique.set(normalizedAddressKey(participant.address), participant.address);
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

function addressMailRowPayloads(row, address, network) {
  const payload = normalizeEventPayload(canonicalEventPayload(row.payload), row);
  const rawPayload = normalizeEventPayload(
    canonicalEventPayload(rawTransactionItemPayload(row)),
    row,
  );
  const targetAddress = normalizedAddress(address);
  const targetKey = normalizedAddressKey(targetAddress);
  const actor =
    knownMailAddress(payload.actor) || knownMailAddress(rawPayload.actor);
  const actorKey = normalizedAddressKey(actor);
  const participantRecords = mailParticipantRecordsFromRow(row, payload, rawPayload);
  const participants = mailParticipantsFromRow(row, payload, rawPayload);
  const roleRecipientAddresses = participantRecords
    .filter((participant) =>
      ["recipient", "receiver", "counterparty"].includes(participant.role),
    )
    .map((participant) => participant.address);
  const fallbackRecipientAddresses = participants.filter(
    (participant) => normalizedAddressKey(participant) !== actorKey,
  );
  const recipientAddresses =
    roleRecipientAddresses.length > 0
      ? [...new Set(roleRecipientAddresses)]
      : fallbackRecipientAddresses;
  const targetIsRecipient =
    recipientAddresses.some(
      (participant) => normalizedAddressKey(participant) === targetKey,
    ) ||
    participantRecords.some(
      (participant) =>
        normalizedAddressKey(participant.address) === targetKey &&
        ["recipient", "receiver", "counterparty"].includes(participant.role),
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
  const items = [];

  if (actorKey && actorKey === targetKey) {
    items.push({
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
        protocolKind: row.kind,
        recipients: recipients.length > 0 ? recipients : undefined,
        replyTo: targetAddress,
        status: confirmed ? "confirmed" : deliveryStatus,
        subject: subject || undefined,
        to: recipientSummary(recipients),
        txid: row.txid,
      },
    });
  }

  if (
    deliveryStatus !== "dropped" &&
    (!actorKey || actorKey !== targetKey || targetIsRecipient)
  ) {
    const targetRecipient =
      recipients.find(
        (recipient) => normalizedAddressKey(recipient.address) === targetKey,
      ) ?? recipients[0];
    items.push({
      folder: "inbox",
      message: {
        amountSats:
          positiveNumber(targetRecipient?.amountSats) || totalAmountSats,
        confirmed,
        createdAt,
        from: actor || "Unknown",
        memo,
        network,
        parentTxid: parentTxid || undefined,
        protocolKind: row.kind,
        recipients: recipients.length > 0 ? recipients : undefined,
        replyTo: actor || "Unknown",
        subject: subject || undefined,
        to: targetAddress,
        txid: row.txid,
      },
    });
  }

  return items;
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
  const addressCandidates = [
    ...new Set([targetAddress, targetAddress.toLowerCase()].filter(Boolean)),
  ];

  const rowsResult = await pool.query(
    `
      SELECT
        e.payload,
        e.kind,
        CASE
          WHEN 'confirmed' = ANY(ARRAY[e.status, m.status, t.status]) THEN 'confirmed'
          WHEN 'dropped' = ANY(ARRAY[e.status, m.status, t.status]) THEN 'dropped'
          WHEN 'orphaned' = ANY(ARRAY[e.status, m.status, t.status]) THEN 'orphaned'
          ELSE e.status
        END AS status,
        e.event_time,
        e.block_time,
        e.created_at,
        e.txid,
        e.event_id,
        t.raw_tx AS transaction_raw_tx,
        m.subject,
        m.sender_address,
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
      LEFT JOIN proof_indexer.transactions t
        ON t.network = e.network
       AND t.txid = e.txid
      LEFT JOIN proof_indexer.event_participants ep
        ON ep.event_id = e.event_id
      WHERE e.network = $1
        AND e.valid = true
        AND e.kind = ANY($3::text[])
        AND e.status IN ('pending', 'confirmed', 'dropped', 'orphaned')
        AND (
          m.sender_address = ANY($2::text[])
          OR t.raw_tx->'item'->>'actor' = ANY($2::text[])
          OR EXISTS (
            SELECT 1
            FROM jsonb_array_elements_text(
              COALESCE(t.raw_tx->'item'->'participants', '[]'::jsonb)
            ) raw_participant(address)
            WHERE raw_participant.address = ANY($2::text[])
          )
          OR EXISTS (
            SELECT 1
            FROM jsonb_array_elements(
              COALESCE(t.raw_tx->'item'->'recipients', '[]'::jsonb)
            ) raw_recipient(recipient)
            WHERE raw_recipient.recipient->>'address' = ANY($2::text[])
          )
          OR EXISTS (
            SELECT 1
            FROM proof_indexer.event_participants target
            WHERE target.event_id = e.event_id
              AND target.address = ANY($2::text[])
          )
        )
      GROUP BY
        e.payload,
        e.kind,
        e.status,
        m.status,
        t.status,
        e.event_time,
        e.block_time,
        e.created_at,
        e.txid,
        e.event_id,
        t.raw_tx,
        m.subject,
        m.sender_address,
        m.parent_txid,
        m.body_text,
        m.amount_sats
      ORDER BY
        COALESCE(e.event_time, e.block_time, e.created_at) DESC,
        e.txid DESC,
        e.event_id DESC
      LIMIT 1000
    `,
    [network, addressCandidates, ADDRESS_MAIL_EVENT_KINDS],
  );

  const inboxMessages = [];
  const sentMessages = [];
  for (const row of rowsResult.rows) {
    for (const item of addressMailRowPayloads(row, targetAddress, network)) {
      if (item.folder === "sent") {
        sentMessages.push(item.message);
      } else {
        inboxMessages.push(item.message);
      }
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

  if (
    totalCount > 0 &&
    totalCount <= SMALL_EVENT_HISTORY_NORMALIZE_LIMIT
  ) {
    const allRowsResult = await pool.query(
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
        LIMIT ${totalCount}
      `,
      values,
    );
    const items = normalizeHistoryEventRows(allRowsResult.rows, network);
    const start = Math.min(pagination.offset, items.length);
    const end = Math.min(items.length, start + pagination.limit);
    const snapshotId = snapshot.snapshot_id ?? "";

    return {
      cursor: historyCursor(snapshotId, start),
      end,
      indexedAt: dateIso(snapshot.generated_at),
      indexedThroughBlock,
      items: items.slice(start, end),
      kind: "events",
      limit: pagination.limit,
      network,
      nextCursor: end < items.length ? historyCursor(snapshotId, end) : "",
      page: Math.floor(start / pagination.limit),
      pageCount: Math.max(1, Math.ceil(items.length / pagination.limit)),
      pageSize: pagination.limit,
      query: pagination.query,
      source: "proof-indexer-events",
      start,
      totalCount: items.length,
      ...(snapshotId ? { snapshotId } : {}),
    };
  }

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
    items: normalizeHistoryEventRows(rowsResult.rows, network),
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
