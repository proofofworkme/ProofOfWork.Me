import {
  createProofIndexPool,
  proofIndexDatabaseConfigured,
} from "./postgres.mjs";

let proofIndexReadPool = null;
const INFINITY_BOND_MEMO = "powb";
const INFINITY_BOND_KIND = "infinity-bond";
const ID_REGISTRATION_PRICE_SATS = 1_000;
const TOKEN_SALE_AUTH_VERSION = "pwt-sale-v1";
const TOKEN_LISTING_ANCHOR_TYPE = "sale-ticket-v1";
const TOKEN_LISTING_ANCHOR_VALUE_SATS = 546;
const TOKEN_LISTING_ANCHOR_VOUT = 2;
const TOKEN_LISTING_ANCHOR_SIGHASH_TYPE = 0x83;
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
const LEDGER_SNAPSHOT_RECENT_READ_LIMIT = 25;
const SUMMARY_SNAPSHOT_LOOKBACK_LIMIT = 5_000;
const TOKEN_STATE_EVENT_READ_LIMIT = 100_000;

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

function safeBlockHeight(value) {
  const height = Number(value);
  return Number.isSafeInteger(height) && height > 0 ? height : 0;
}

function summaryPayloadIndexedThroughBlock(payload, snapshot) {
  void snapshot;
  const parentHeight = Math.max(
    safeBlockHeight(payload?.indexedThroughBlock),
    safeBlockHeight(payload?.metrics?.indexedThroughBlock),
    safeBlockHeight(payload?.stats?.indexedThroughBlock),
  );
  if (parentHeight <= 0) {
    return undefined;
  }
  const nestedHeights = [payload?.floor, payload?.workFloor].flatMap(
    (nested) => {
      if (!nested || typeof nested !== "object" || Array.isArray(nested)) {
        return [];
      }
      const height = Math.max(
        safeBlockHeight(nested.indexedThroughBlock),
        safeBlockHeight(nested.metrics?.indexedThroughBlock),
        safeBlockHeight(nested.stats?.indexedThroughBlock),
      );
      return height > 0 ? [height] : [0];
    },
  );
  const height =
    nestedHeights.length > 0
      ? Math.min(parentHeight, ...nestedHeights)
      : parentHeight;
  return height > 0 ? height : undefined;
}

function newestDateIso(values, fallback = new Date()) {
  const times = (Array.isArray(values) ? values : [values])
    .map((value) => {
      const time = Date.parse(String(value ?? ""));
      return Number.isFinite(time) ? time : 0;
    })
    .filter((time) => time > 0);
  return times.length > 0
    ? new Date(Math.max(...times)).toISOString()
    : dateIso(fallback);
}

function boundedInteger(value, fallback, min, max) {
  const parsed = Number.parseInt(String(value ?? ""), 10);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }
  return Math.min(max, Math.max(min, parsed));
}

function normalizedTxid(value) {
  const txid = String(value ?? "").trim().toLowerCase();
  return /^[0-9a-f]{64}$/u.test(txid) ? txid : "";
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
  const tagNumbers = tokenMarketNumbersFromTags(payload);
  const amount =
    rowNumber(payload, "amount") ||
    rowNumber(payload, "tokenAmount") ||
    tagNumbers.amount;
  const priceSats =
    rowNumber(payload, "priceSats") ||
    rowNumber(payload, "salePriceSats") ||
    tagNumbers.priceSats;
  const ticker = String(payload?.ticker ?? tagNumbers.ticker ?? "").trim();
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
    arbSats: rowNumber(payload, "arbSats"),
    buyerAddress,
    confirmed: payload?.confirmed === true,
    creditAmountMoved: rowNumber(payload, "creditAmountMoved"),
    creditFloorAtConfirmSats: rowNumber(payload, "creditFloorAtConfirmSats"),
    creditLiveFloorSats: rowNumber(payload, "creditLiveFloorSats"),
    creditLiveValueSats: rowNumber(payload, "creditLiveValueSats"),
    creditValueAtConfirmSats: rowNumber(payload, "creditValueAtConfirmSats"),
    createdAt: dateIso(
      payload?.createdAt ?? payload?.timestamp ?? payload?.blockTime,
    ),
    dataBytes: rowNumber(payload, "dataBytes"),
    frozenNetworkValueSats: rowNumber(payload, "frozenNetworkValueSats"),
    listingId: String(payload?.listingId ?? "").trim().toLowerCase(),
    liveNetworkValueSats: rowNumber(payload, "liveNetworkValueSats"),
    marketplaceMutationFeeSats: rowNumber(payload, "marketplaceMutationFeeSats"),
    minerFeeSats: rowNumber(payload, "minerFeeSats"),
    network: payload?.network,
    paidSats: rowNumber(payload, "paidSats") || rowNumber(payload, "amountSats"),
    priceSats,
    registryAddress,
    salePaymentSats: rowNumber(payload, "salePaymentSats"),
    sellerAddress,
    ticker,
    tokenId: String(payload?.tokenId ?? "").trim().toLowerCase(),
    txid: String(payload?.txid ?? "").trim().toLowerCase(),
  };
}

function tokenListingFromEventPayload(payload) {
  const saleAuthorization =
    payload?.saleAuthorization &&
    typeof payload.saleAuthorization === "object" &&
    !Array.isArray(payload.saleAuthorization)
      ? payload.saleAuthorization
      : {};
  const { amount, priceSats, ticker } = tokenMarketNumbersFromTags(payload);
  const sellerAddress = String(
    payload?.sellerAddress ??
      payload?.actor ??
      saleAuthorization.sellerAddress ??
      "",
  ).trim();
  const registryAddress = tokenRegistryAddressFromPayload(
    payload,
    sellerAddress,
    payload?.counterparty,
    saleAuthorization.registryAddress,
  );
  const tokenId = String(payload?.tokenId ?? saleAuthorization.tokenId ?? "")
    .trim()
    .toLowerCase();
  const normalizedTicker = String(ticker || saleAuthorization.ticker || "").trim();
  return {
    amount: rowNumber(payload, "amount") || rowNumber(saleAuthorization, "amount") || amount,
    confirmed: payload?.confirmed === true,
    createdAt: dateIso(payload?.createdAt),
    dataBytes: rowNumber(payload, "dataBytes"),
    frozenNetworkValueSats: rowNumber(payload, "frozenNetworkValueSats"),
    listingId: String(payload?.listingId ?? payload?.txid ?? "")
      .trim()
      .toLowerCase(),
    liveNetworkValueSats: rowNumber(payload, "liveNetworkValueSats"),
    marketplaceMutationFeeSats: rowNumber(payload, "marketplaceMutationFeeSats"),
    minerFeeSats: rowNumber(payload, "minerFeeSats"),
    network: payload?.network,
    priceSats:
      rowNumber(payload, "priceSats") ||
      rowNumber(saleAuthorization, "priceSats") ||
      priceSats,
    registryAddress,
    saleAuthorization,
    sealFrozenNetworkValueSats: rowNumber(payload, "sealFrozenNetworkValueSats"),
    sealAt: dateIso(payload?.sealAt),
    sealConfirmed:
      typeof payload?.sealConfirmed === "boolean"
        ? payload.sealConfirmed
        : undefined,
    sealLiveNetworkValueSats: rowNumber(payload, "sealLiveNetworkValueSats"),
    sealMinerFeeSats: rowNumber(payload, "sealMinerFeeSats"),
    sealTxid: String(payload?.sealTxid ?? "").trim().toLowerCase(),
    sellerAddress,
    status: payload?.status,
    ticker: normalizedTicker,
    tokenId,
  };
}

function validPublicKeyHex(value) {
  return (
    /^[0-9a-fA-F]{64}$/u.test(value) ||
    /^(02|03)[0-9a-fA-F]{64}$/u.test(value) ||
    /^04[0-9a-fA-F]{128}$/u.test(value)
  );
}

function tokenSaleAuthorizationUsesSpendableSaleTicketAnchor(authorization) {
  return (
    authorization?.version === TOKEN_SALE_AUTH_VERSION &&
    authorization.anchorType === TOKEN_LISTING_ANCHOR_TYPE &&
    authorization.anchorVout === TOKEN_LISTING_ANCHOR_VOUT &&
    authorization.anchorValueSats === TOKEN_LISTING_ANCHOR_VALUE_SATS &&
    authorization.anchorSigHashType === TOKEN_LISTING_ANCHOR_SIGHASH_TYPE &&
    /^[0-9a-f]+$/u.test(authorization.anchorScriptPubKey ?? "") &&
    validPublicKeyHex(authorization.sellerPublicKey ?? "")
  );
}

function activeTokenListingHistoryItem(listing) {
  return (
    listing &&
    listing.status !== "dropped" &&
    listing.listingId &&
    listing.tokenId &&
    listing.registryAddress &&
    listing.sellerAddress &&
    tokenSaleAuthorizationUsesSpendableSaleTicketAnchor(
      listing.saleAuthorization,
    )
  );
}

function activeOrSealingListingStatus(status) {
  return ["active", "pending", "sealing"].includes(
    String(status ?? "").trim().toLowerCase(),
  );
}

function tokenListingEffectiveCloseTxid(row, payload, status, sealTxid) {
  const closeTxid = String(row?.close_txid ?? payload?.closeTxid ?? "")
    .trim()
    .toLowerCase();
  if (
    activeOrSealingListingStatus(status) &&
    validTxid(closeTxid) &&
    closeTxid === String(sealTxid ?? "").trim().toLowerCase()
  ) {
    return "";
  }
  return closeTxid;
}

function tokenListingEffectiveSaleTicketTxid(
  row,
  payload,
  saleAuthorization,
  listingId,
  sealTxid,
) {
  const raw = String(
    row?.sale_ticket_txid ??
      payload?.saleTicketTxid ??
      saleAuthorization?.saleTicketTxid ??
      saleAuthorization?.anchorTxid ??
      "",
  )
    .trim()
    .toLowerCase();
  const normalizedListingId = String(listingId ?? "").trim().toLowerCase();
  const normalizedSealTxid = String(sealTxid ?? "").trim().toLowerCase();
  if (validTxid(raw) && raw !== normalizedSealTxid) {
    return raw;
  }
  if (validTxid(normalizedListingId)) {
    return normalizedListingId;
  }
  return raw;
}

function normalizeTokenHistoryListingItem(item) {
  if (!item || typeof item !== "object" || Array.isArray(item)) {
    return null;
  }

  const saleAuthorization =
    item.saleAuthorization &&
    typeof item.saleAuthorization === "object" &&
    !Array.isArray(item.saleAuthorization)
      ? item.saleAuthorization
      : {};
  const tokenId = String(item.tokenId ?? saleAuthorization.tokenId ?? "")
    .trim()
    .toLowerCase();
  const registryAddress = String(
    item.registryAddress ?? saleAuthorization.registryAddress ?? "",
  ).trim();
  const sellerAddress = String(
    item.sellerAddress ?? saleAuthorization.sellerAddress ?? "",
  ).trim();
  const ticker = String(item.ticker ?? saleAuthorization.ticker ?? "").trim();

  return {
    ...item,
    amount: rowNumber(item, "amount") || rowNumber(saleAuthorization, "amount"),
    priceSats:
      rowNumber(item, "priceSats") || rowNumber(saleAuthorization, "priceSats"),
    registryAddress,
    saleAuthorization,
    sellerAddress,
    ticker,
    tokenId,
  };
}

function normalizeTokenHistoryItemsForKind(items, safeKind) {
  if (!Array.isArray(items) || safeKind !== "listings") {
    return items;
  }

  return items
    .map(normalizeTokenHistoryListingItem)
    .filter(activeTokenListingHistoryItem);
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
  const createdAt = dateIso(
    payload?.createdAt ?? payload?.timestamp ?? payload?.blockTime,
  );
  const closedAt = dateIso(
    payload?.closedAt ?? payload?.blockTime ?? payload?.timestamp ?? createdAt,
  );
  return {
    amount:
      rowNumber(payload, "amount") ||
      rowNumber(payload, "tokenAmount") ||
      amount,
    closedAt,
    closedConfirmed: payload?.confirmed === true,
    closedFrozenNetworkValueSats: rowNumber(
      payload,
      "closedFrozenNetworkValueSats",
    ),
    closedLiveNetworkValueSats: rowNumber(payload, "closedLiveNetworkValueSats"),
    closedMinerFeeSats: rowNumber(payload, "closedMinerFeeSats"),
    closedTxid: String(payload?.txid ?? "").trim().toLowerCase(),
    confirmed: true,
    createdAt,
    dataBytes: rowNumber(payload, "dataBytes"),
    frozenNetworkValueSats: rowNumber(payload, "frozenNetworkValueSats"),
    liveNetworkValueSats: rowNumber(payload, "liveNetworkValueSats"),
    marketplaceMutationFeeSats: rowNumber(payload, "marketplaceMutationFeeSats"),
    minerFeeSats: rowNumber(payload, "minerFeeSats"),
    listingId: String(payload?.listingId ?? "").trim().toLowerCase(),
    network: payload?.network,
    priceSats:
      rowNumber(payload, "priceSats") ||
      rowNumber(payload, "salePriceSats") ||
      priceSats,
    registryAddress,
    saleAuthorization: objectRecord(payload?.saleAuthorization),
    sealAt: dateIso(payload?.sealAt),
    sealConfirmed:
      payload?.sealConfirmed === true || validTxid(payload?.sealTxid),
    sealDataBytes: rowNumber(payload, "sealDataBytes"),
    sealMinerFeeSats: rowNumber(payload, "sealMinerFeeSats"),
    sealTxid: String(payload?.sealTxid ?? "").trim().toLowerCase(),
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
    arbSats: rowNumber(payload, "arbSats"),
    creditAmountMoved: rowNumber(payload, "creditAmountMoved"),
    creditFloorAtConfirmSats: rowNumber(payload, "creditFloorAtConfirmSats"),
    creditLiveFloorSats: rowNumber(payload, "creditLiveFloorSats"),
    creditLiveValueSats: rowNumber(payload, "creditLiveValueSats"),
    creditValueAtConfirmSats: rowNumber(payload, "creditValueAtConfirmSats"),
    frozenNetworkValueSats: rowNumber(payload, "frozenNetworkValueSats"),
    liveNetworkValueSats: rowNumber(payload, "liveNetworkValueSats"),
    minerFeeSats: rowNumber(payload, "minerFeeSats"),
    network: payload?.network ?? row.network,
    paidSats: rowNumber(payload, "paidSats") || rowNumber(payload, "amountSats"),
    recipientAddress,
    registryMutationFeeSats: rowNumber(payload, "registryMutationFeeSats"),
    registryAddress,
    senderAddress,
    ticker,
    tokenId: String(payload?.tokenId ?? row.token_id ?? "").trim().toLowerCase(),
    txid: String(payload?.txid ?? row.txid ?? "").trim().toLowerCase(),
  };
}

function tokenMintFromEventPayload(payload, row = {}) {
  const tagNumbers = tokenMarketNumbersFromTags(payload);
  const ticker = String(row.ticker ?? payload?.ticker ?? tagNumbers.ticker ?? "")
    .trim();
  const minterAddress = String(
    payload?.minterAddress ??
      payload?.actor ??
      payload?.senderAddress ??
      "",
  ).trim();
  const registryAddress = String(
    payload?.registryAddress ??
      row.registry_address ??
      payload?.counterparty ??
      "",
  ).trim();
  const effectiveStatus = String(row.effective_status ?? row.status ?? "")
    .trim()
    .toLowerCase();

  return {
    amount:
      rowNumber(payload, "amount") ||
      rowNumber(payload, "tokenAmount") ||
      tagNumbers.amount,
    blockHeight: rowNumber(row, "block_height") || rowNumber(payload, "blockHeight"),
    confirmed: effectiveStatus === "confirmed" || payload?.confirmed === true,
    createdAt: dateIso(
      payload?.createdAt ??
        row.block_time ??
        row.event_time ??
        row.confirmed_at ??
        row.last_seen_at ??
        row.created_at,
    ),
    dataBytes: rowNumber(payload, "dataBytes") || rowNumber(row, "data_bytes"),
    minterAddress,
    minerFeeSats: rowNumber(payload, "minerFeeSats"),
    network: payload?.network ?? row.network,
    paidSats:
      rowNumber(payload, "proofPaymentSats") ||
      rowNumber(payload, "paidSats") ||
      rowNumber(payload, "amountSats") ||
      rowNumber(row, "amount_sats"),
    registryAddress,
    status: effectiveStatus || undefined,
    ticker,
    tokenId: String(payload?.tokenId ?? row.token_id ?? "").trim().toLowerCase(),
    txid: String(payload?.txid ?? row.txid ?? "").trim().toLowerCase(),
  };
}

function tokenHistoryItemFromMarketEventPayload(payload, safeKind) {
  if (payload?.kind === "token-listing" || payload?.kind === "token-listings") {
    const listing = tokenListingFromEventPayload(payload);
    if (!activeTokenListingHistoryItem(listing)) {
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

  if (payload?.kind === "token-listing-sealed") {
    const listing = tokenListingFromEventPayload({
      ...payload,
      sealAt: payload.sealAt ?? payload.createdAt,
      sealConfirmed: payload.confirmed !== false,
      sealTxid: payload.sealTxid ?? payload.txid,
      status: "sealing",
    });
    if (!activeTokenListingHistoryItem(listing)) {
      return null;
    }
    if (safeKind === "listings") {
      return listing;
    }
    return {
      createdAt: listing.sealAt ?? listing.createdAt,
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
    if (safeKind === "closedListings") {
      return tokenClosedListingFromSalePayload(sale);
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

function tokenClosedListingFromSalePayload(salePayload) {
  const sale = salePayload?.txid
    ? salePayload
    : tokenSaleFromEventPayload(salePayload);
  if (!sale?.txid || !sale?.listingId || !sale?.tokenId) {
    return null;
  }
  return {
    ...sale,
    buyerAddress: sale.buyerAddress,
    closedAt: sale.createdAt,
    closedConfirmed: sale.confirmed === true,
    closedTxid: sale.txid,
    confirmed: sale.confirmed === true,
    saleTxid: sale.txid,
    status: "sold",
    txid: sale.txid,
  };
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
    return ["token-listings", "token-listing", "token-listing-sealed"];
  }
  if (safeKind === "sales") {
    return ["token-sale"];
  }
  if (safeKind === "closedListings") {
    return ["token-listing-closed", "token-sale"];
  }
  if (safeKind === "market-log") {
    return [
      "token-listings",
      "token-listing",
      "token-listing-sealed",
      "token-sale",
      "token-listing-closed",
    ];
  }
  return [];
}

function tokenHistoryPageWithScanCoverage(page, coverage) {
  // A scan checkpoint is operational evidence only. It cannot change the
  // generation height or source label of an older embedded history page.
  void coverage;
  return page;
}

function tokenListingId(item) {
  return String(item?.listingId ?? item?.listing?.listingId ?? "")
    .trim()
    .toLowerCase();
}

function currentRelationalHistoryPageWithScanCoverage(page, scan) {
  if (!page) {
    return null;
  }
  return {
    ...page,
    indexedAt: dateIso(
      newestDateIso([page.indexedAt, scan?.generated_at]),
    ),
    indexedThroughBlock:
      Math.max(
        rowNumber(page, "indexedThroughBlock"),
        rowNumber(scan, "indexed_through_block"),
      ) || undefined,
  };
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

function validTxid(value) {
  return /^[0-9a-f]{64}$/u.test(String(value ?? "").trim().toLowerCase());
}

function tokenListingSealRank(listing) {
  if (!validTxid(listing?.sealTxid)) {
    return 0;
  }
  return listing?.sealConfirmed === true ? 2 : 1;
}

function tokenListingWithSealFrom(listing, sealSource) {
  if (!listing || tokenListingSealRank(sealSource) === 0) {
    return listing;
  }

  return {
    ...listing,
    saleAuthorization: sealSource.saleAuthorization ?? listing.saleAuthorization,
    sealAt: sealSource.sealAt ?? listing.sealAt,
    sealConfirmed: sealSource.sealConfirmed === true,
    sealDataBytes: sealSource.sealDataBytes ?? listing.sealDataBytes,
    sealFrozenNetworkValueSats:
      sealSource.sealFrozenNetworkValueSats ??
      listing.sealFrozenNetworkValueSats,
    sealLiveNetworkValueSats:
      sealSource.sealLiveNetworkValueSats ??
      listing.sealLiveNetworkValueSats,
    sealMinerFeeSats: sealSource.sealMinerFeeSats ?? listing.sealMinerFeeSats,
    sealTxid: sealSource.sealTxid ?? listing.sealTxid,
  };
}

function tokenListingSealTimeMs(listing) {
  const timeMs = Date.parse(listing?.sealAt ?? listing?.createdAt ?? "");
  return Number.isFinite(timeMs) ? timeMs : 0;
}

function preferredTokenListingSealSource(left, right) {
  const leftRank = tokenListingSealRank(left);
  const rightRank = tokenListingSealRank(right);
  if (leftRank === 0) {
    return rightRank > 0 ? right : null;
  }
  if (rightRank === 0) {
    return left;
  }
  if (leftRank !== rightRank) {
    return leftRank > rightRank ? left : right;
  }

  const leftTime = tokenListingSealTimeMs(left);
  const rightTime = tokenListingSealTimeMs(right);
  if (leftTime !== rightTime) {
    return leftTime > rightTime ? left : right;
  }

  return String(left?.sealTxid ?? "").localeCompare(String(right?.sealTxid ?? "")) >= 0
    ? left
    : right;
}

function tokenListingCloseRank(listing) {
  if (!validTxid(listing?.closedTxid)) {
    return 0;
  }
  return listing?.closedConfirmed === true ? 2 : 1;
}

function tokenListingWithCloseFrom(listing, closeSource) {
  if (!listing || tokenListingCloseRank(closeSource) === 0) {
    return listing;
  }

  return {
    ...listing,
    closedAt: closeSource.closedAt ?? listing.closedAt,
    closedConfirmed: closeSource.closedConfirmed === true,
    closedTxid: closeSource.closedTxid ?? listing.closedTxid,
    closedVin: closeSource.closedVin ?? listing.closedVin,
  };
}

function mergeTokenListingRecord(current, incoming) {
  if (!current) {
    return incoming;
  }
  if (!incoming) {
    return current;
  }

  const sealSource = preferredTokenListingSealSource(current, incoming);
  const merged = sealSource
    ? tokenListingWithSealFrom(incoming, sealSource)
    : incoming;
  return tokenListingCloseRank(current) > tokenListingCloseRank(incoming)
    ? tokenListingWithCloseFrom(merged, current)
    : tokenListingWithCloseFrom(merged, incoming);
}

function mergeTokenHistoryMarketItem(current, incoming, safeKind) {
  if (!current) {
    return incoming;
  }
  if (!incoming) {
    return current;
  }

  if (safeKind === "listings" || safeKind === "closedListings") {
    return mergeTokenListingRecord(current, incoming);
  }

  if (safeKind === "market-log") {
    if (current.kind === "listing" && incoming.kind === "listing") {
      return {
        ...current,
        ...incoming,
        listing: mergeTokenListingRecord(current.listing, incoming.listing),
      };
    }
    if (
      current.kind === "closed-listing" &&
      incoming.kind === "closed-listing"
    ) {
      return {
        ...current,
        ...incoming,
        closedListing: mergeTokenListingRecord(
          current.closedListing,
          incoming.closedListing,
        ),
      };
    }
  }

  return incoming;
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
    ...(Array.isArray(basePage.items) ? basePage.items : []),
    ...overlayPage.items,
  ]) {
    const key = tokenHistoryItemKey(item, safeKind);
    byKey.set(
      key,
      mergeTokenHistoryMarketItem(byKey.get(key), item, safeKind),
    );
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

function tokenMintQueryScopeCondition(scope, param) {
  if (!scope || scope === "all") {
    return "";
  }
  return `(
    lower(e.payload->>'tokenId') = ${param}
    OR lower(cd.token_id) = ${param}
    OR lower(cd.ticker) = lower(${param})
    OR lower(e.payload->>'ticker') = lower(${param})
  )`;
}

function tokenMintEventQueryParts(network, tokenScope, searchParams, pagination) {
  const scope = tokenScopeKey(tokenScope);
  const conditions = [
    "e.network = $1",
    "e.valid IS DISTINCT FROM false",
    "e.kind = 'token-mint'",
    "COALESCE(t.status, e.status) IN ('confirmed', 'pending')",
  ];
  const params = [network];

  if (scope && scope !== "all") {
    params.push(scope);
    conditions.push(tokenMintQueryScopeCondition(scope, `$${params.length}`));
  }

  const needles = tokenHistoryFilterNeedles(searchParams, pagination);
  const txidNeedles = needles.map(normalizedTxid).filter(Boolean);
  if (txidNeedles.length > 0) {
    params.push([...new Set(txidNeedles)]);
    const param = `$${params.length}`;
    conditions.push(
      `(
        lower(e.txid) = ANY(${param}::text[])
        OR lower(e.payload->>'txid') = ANY(${param}::text[])
        OR EXISTS (
          SELECT 1
          FROM proof_indexer.event_refs erq
          WHERE erq.event_id = e.event_id
            AND lower(erq.ref_value) = ANY(${param}::text[])
        )
      )`,
    );
  }

  for (const needle of needles.filter((value) => !normalizedTxid(value))) {
    params.push(`%${needle}%`);
    const param = `$${params.length}`;
    conditions.push(
      `lower(concat_ws(
        ' ',
        e.txid,
        e.payload::text,
        cd.token_id,
        cd.ticker,
        cd.registry_address
      )) LIKE ${param}`,
    );
  }

  const cte = `
    WITH mint_events AS (
      SELECT DISTINCT ON (lower(e.txid))
        e.payload,
        e.protocol,
        e.kind,
        e.status,
        COALESCE(t.status, e.status) AS effective_status,
        e.event_time,
        COALESCE(e.block_time, t.block_time) AS block_time,
        e.created_at,
        COALESCE(e.block_height, t.block_height) AS block_height,
        e.txid,
        e.event_id,
        e.amount_sats,
        e.data_bytes,
        e.network,
        t.confirmed_at,
        t.last_seen_at,
        t.updated_at AS tx_updated_at,
        COALESCE(cd.token_id, lower(e.payload->>'tokenId')) AS token_id,
        cd.ticker,
        cd.registry_address
      FROM proof_indexer.events e
      LEFT JOIN proof_indexer.transactions t
        ON t.network = e.network
       AND t.txid = e.txid
      LEFT JOIN proof_indexer.credit_definitions cd
        ON cd.network = e.network
       AND cd.token_id = lower(e.payload->>'tokenId')
      WHERE ${conditions.join(" AND ")}
      ORDER BY
        lower(e.txid),
        CASE COALESCE(t.status, e.status)
          WHEN 'confirmed' THEN 0
          WHEN 'pending' THEN 1
          ELSE 2
        END,
        CASE WHEN COALESCE(e.block_height, t.block_height) IS NULL THEN 1 ELSE 0 END,
        COALESCE(e.block_time, t.block_time, e.event_time, t.confirmed_at, t.last_seen_at, e.created_at) DESC,
        e.event_id DESC
    )
  `;

  return { cte, params };
}

function tokenMintSortSql() {
  return `
    COALESCE(block_time, event_time, confirmed_at, last_seen_at, created_at) DESC,
    block_height DESC NULLS LAST,
    txid DESC
  `;
}

async function proofIndexTokenMintRows(
  pool,
  network,
  tokenScope,
  searchParams,
  pagination,
) {
  const { cte, params } = tokenMintEventQueryParts(
    network,
    tokenScope,
    searchParams,
    pagination,
  );
  const result = await pool.query(
    `
      ${cte}
      SELECT *
      FROM mint_events
      ORDER BY ${tokenMintSortSql()}
    `,
    params,
  );
  return result.rows;
}

export async function proofIndexTokenMintStatsPayload(network, tokenScope) {
  const pool = proofIndexPool();
  if (!pool) {
    return null;
  }
  const scope = tokenScopeKey(tokenScope);
  if (!scope || scope === "all") {
    return null;
  }

  const { cte, params } = tokenMintEventQueryParts(
    network,
    scope,
    new URLSearchParams(),
    { limit: 1, offset: 0, page: 0, query: "", snapshotId: "" },
  );
  const result = await pool.query(
    `
      ${cte},
      mint_amounts AS (
        SELECT
          *,
          CASE
            WHEN payload->>'amount' ~ '^[0-9]+(?:\\.[0-9]+)?$'
              THEN (payload->>'amount')::numeric
            WHEN payload->>'tokenAmount' ~ '^[0-9]+(?:\\.[0-9]+)?$'
              THEN (payload->>'tokenAmount')::numeric
            WHEN (
              SELECT tag
              FROM jsonb_array_elements_text(payload->'tags') AS tag
              WHERE tag ~ '^[0-9,]+(?:\\.[0-9]+)?\\s+[A-Z0-9]+$'
              LIMIT 1
            ) IS NOT NULL
              THEN regexp_replace(
                (
                  SELECT tag
                  FROM jsonb_array_elements_text(payload->'tags') AS tag
                  WHERE tag ~ '^[0-9,]+(?:\\.[0-9]+)?\\s+[A-Z0-9]+$'
                  LIMIT 1
                ),
                '[^0-9.]',
                '',
                'g'
              )::numeric
            ELSE 0
          END AS mint_amount
        FROM mint_events
      )
      SELECT
        count(*) AS total_mints,
        count(*) FILTER (WHERE effective_status = 'confirmed') AS confirmed_mints,
        count(*) FILTER (WHERE effective_status <> 'confirmed') AS pending_mints,
        COALESCE(sum(mint_amount) FILTER (WHERE effective_status = 'confirmed'), 0) AS confirmed_supply,
        COALESCE(sum(mint_amount) FILTER (WHERE effective_status <> 'confirmed'), 0) AS pending_supply,
        max(block_height) AS indexed_through_block,
        max(COALESCE(block_time, event_time, confirmed_at, last_seen_at, created_at)) AS indexed_at
      FROM mint_amounts
    `,
    params,
  );
  const row = result.rows[0] ?? {};
  const totalMints = rowNumber(row, "total_mints");
  if (totalMints <= 0) {
    return null;
  }
  return {
    confirmedMints: rowNumber(row, "confirmed_mints"),
    confirmedSupply: rowNumber(row, "confirmed_supply"),
    indexedAt: dateIso(row.indexed_at),
    indexedThroughBlock: rowNumber(row, "indexed_through_block") || undefined,
    network,
    pendingMints: rowNumber(row, "pending_mints"),
    pendingSupply: rowNumber(row, "pending_supply"),
    source: "proof-indexer-token-mint-events",
    tokenId: scope,
    totalMints,
  };
}

async function exactTokenMintHistoryPage(
  pool,
  network,
  tokenScope,
  searchParams,
  pagination,
  snapshot,
) {
  const { cte, params } = tokenMintEventQueryParts(
    network,
    tokenScope,
    searchParams,
    pagination,
  );
  const countResult = await pool.query(
    `
      ${cte}
      SELECT
        count(*) AS total_count,
        max(block_height) AS indexed_through_block,
        max(COALESCE(block_time, event_time, confirmed_at, last_seen_at, created_at)) AS indexed_at
      FROM mint_events
    `,
    params,
  );
  const totalCount = rowNumber(countResult.rows[0], "total_count");
  if (totalCount === 0) {
    return null;
  }

  const rowParams = [...params, pagination.limit, pagination.offset];
  const limitParam = rowParams.length - 1;
  const offsetParam = rowParams.length;
  const rowsResult = await pool.query(
    `
      ${cte}
      SELECT *
      FROM mint_events
      ORDER BY ${tokenMintSortSql()}
      LIMIT $${limitParam}
      OFFSET $${offsetParam}
    `,
    rowParams,
  );
  const items = rowsResult.rows
    .map((row) => tokenMintFromEventPayload(objectRecord(row.payload), row))
    .filter((item) => item.txid && item.tokenId && item.amount > 0);
  const start = Math.min(pagination.offset, totalCount);
  const end = Math.min(totalCount, start + pagination.limit);
  const snapshotId = snapshot?.snapshot_id ?? "";
  const page = {
    cursor: historyCursor(snapshotId, start),
    end,
    indexedAt: dateIso(countResult.rows[0]?.indexed_at ?? snapshot?.generated_at),
    indexedThroughBlock:
      rowNumber(countResult.rows[0], "indexed_through_block") || undefined,
    items,
    kind: "mints",
    limit: pagination.limit,
    network,
    nextCursor: end < totalCount ? historyCursor(snapshotId, end) : "",
    page: Math.floor(start / pagination.limit),
    pageCount: Math.max(1, Math.ceil(totalCount / pagination.limit)),
    pageSize: pagination.limit,
    query: pagination.query,
    source: "proof-indexer-token-mint-events",
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

async function tokenStateWithMintEventOverlay(pool, network, scope, payload, snapshot) {
  if (!payload || !scope || scope === "all") {
    return payload;
  }

  const pagination = { limit: 100_000, offset: 0, page: 0, query: "", snapshotId: "" };
  const rows = await proofIndexTokenMintRows(
    pool,
    network,
    scope,
    new URLSearchParams(),
    pagination,
  );
  const mints = rows
    .map((row) => tokenMintFromEventPayload(objectRecord(row.payload), row))
    .filter((item) => item.txid && item.tokenId && item.amount > 0);
  if (mints.length === 0) {
    return payload;
  }

  const confirmedMints = mints.filter((mint) => mint.confirmed);
  const pendingMints = mints.filter((mint) => !mint.confirmed);
  const confirmedSupply = confirmedMints.reduce(
    (total, mint) => total + Number(mint.amount ?? 0),
    0,
  );
  const pendingSupply = pendingMints.reduce(
    (total, mint) => total + Number(mint.amount ?? 0),
    0,
  );
  const tokens = (Array.isArray(payload.tokens) ? payload.tokens : []).map((token) => {
    if (!tokenMatchesScope(token, scope)) {
      return token;
    }
    return {
      ...token,
      confirmedMints: confirmedMints.length,
      confirmedSupply,
      pendingMints: pendingMints.length,
      pendingSupply,
    };
  });
  const nextPayload = {
    ...payload,
    confirmedSupply,
    indexedAt: newestDateIso([
      payload.indexedAt,
      snapshot?.generated_at,
      ...mints.map((mint) => mint.createdAt),
    ]),
    indexedThroughBlock:
      Math.max(
        rowNumber(payload, "indexedThroughBlock"),
        rowNumber(snapshot, "indexed_through_block"),
        indexedThroughBlockFromItems(mints) ?? 0,
      ) || undefined,
    mints,
    pendingSupply,
    source: mergedSourceLabel(payload.source, "proof-indexer-token-mint-events"),
    tokens,
  };
  return {
    ...nextPayload,
    stats: tokenStateStats(
      nextPayload,
      tokens,
      mints,
      Array.isArray(nextPayload.transfers) ? nextPayload.transfers : [],
      Array.isArray(nextPayload.invalidEvents) ? nextPayload.invalidEvents : [],
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
      SELECT DISTINCT lower(COALESCE(e.payload->>'listingId', e.txid)) AS listing_id
      FROM proof_indexer.events e
      WHERE e.network = $1
        AND e.valid = true
        AND (
          (
            e.kind = ANY($2::text[])
            AND lower(e.payload->>'listingId') = ANY($3::text[])
          )
          OR (
            e.kind = 'token-listing'
            AND e.status = 'dropped'
            AND lower(COALESCE(e.payload->>'listingId', e.txid)) = ANY($3::text[])
          )
        )
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

async function exactActiveTokenListingHistoryPage(
  pool,
  network,
  tokenScope,
  searchParams,
  pagination,
  snapshot,
) {
  const needles = tokenHistoryFilterNeedles(searchParams, pagination);
  const txidNeedles = needles.map(normalizedTxid).filter(Boolean);
  if (
    txidNeedles.length === 0 ||
    needles.some((value) => !normalizedTxid(value))
  ) {
    return null;
  }

  const scope = tokenScopeKey(tokenScope);
  const uniqueTxids = [...new Set(txidNeedles)];
  const params = [network, uniqueTxids];
  const conditions = [
    "cl.network = $1",
    "cl.listing_id = ANY($2::text[])",
    "cl.status = ANY(ARRAY['active','sealing']::text[])",
  ];
  if (scope && scope !== "all") {
    params.push(scope);
    conditions.push("cl.token_id = $3");
  }

  const whereClause = conditions.join(" AND ");
  const countResult = await pool.query(
    `
      SELECT
        count(*) AS total_count,
        max(cl.updated_at) AS indexed_at
      FROM proof_indexer.credit_listings cl
      WHERE ${whereClause}
    `,
    params,
  );
  const totalCount = rowNumber(countResult.rows[0], "total_count");
  const rowParams = [...params, pagination.limit, pagination.offset];
  const limitParam = rowParams.length - 1;
  const offsetParam = rowParams.length;
  const rowsResult =
    totalCount > 0
      ? await pool.query(
          `
            SELECT
              cl.listing_id,
              cl.status,
              cl.token_id,
              cl.seller_address,
              cl.buyer_address,
              cl.amount,
              cl.price_sats,
              cl.sale_ticket_txid,
              cl.sale_ticket_vout,
              cl.sale_ticket_value_sats,
              cl.seal_txid,
              cl.close_txid,
              cl.payload,
              cl.updated_at,
              cd.ticker,
              cd.registry_address
            FROM proof_indexer.credit_listings cl
            LEFT JOIN proof_indexer.credit_definitions cd
              ON cd.network = cl.network
             AND cd.token_id = cl.token_id
            WHERE ${whereClause}
            ORDER BY cl.updated_at DESC, cl.listing_id ASC
            LIMIT $${limitParam}
            OFFSET $${offsetParam}
          `,
          rowParams,
        )
      : { rows: [] };
  const closeResult =
    totalCount > 0
      ? await pool.query(
          `
            SELECT DISTINCT lower(e.payload->>'listingId') AS listing_id
            FROM proof_indexer.events e
            WHERE e.network = $1
              AND e.valid = true
              AND e.kind = ANY(ARRAY['token-listing-closed','token-sale']::text[])
              AND lower(e.payload->>'listingId') = ANY($2::text[])
          `,
          [network, uniqueTxids],
        )
      : { rows: [] };
  const closedListingIds = new Set(
    closeResult.rows
      .map((row) => String(row?.listing_id ?? "").trim().toLowerCase())
      .filter(Boolean),
  );

  const items = rowsResult.rows
    .map((row) => {
      const payload = objectRecord(row.payload);
      const saleAuthorization = objectRecord(payload.saleAuthorization);
      const listingId = String(row.listing_id ?? payload.listingId ?? "")
        .trim()
        .toLowerCase();
      const status = String(row.status ?? payload.status ?? "")
        .trim()
        .toLowerCase();
      const sealTxid = String(row.seal_txid ?? payload.sealTxid ?? "")
        .trim()
        .toLowerCase();
      const closeTxid = tokenListingEffectiveCloseTxid(
        row,
        payload,
        status,
        sealTxid,
      );
      return normalizeTokenHistoryListingItem({
        ...payload,
        amount: row.amount,
        buyerAddress: row.buyer_address ?? payload.buyerAddress,
        closeTxid,
        confirmed: true,
        createdAt: dateIso(payload.createdAt ?? row.updated_at),
        listingId,
        network,
        priceSats: Number(row.price_sats ?? 0),
        registryAddress:
          row.registry_address ??
          payload.registryAddress ??
          saleAuthorization.registryAddress,
        saleAuthorization,
        saleTicketTxid: tokenListingEffectiveSaleTicketTxid(
          row,
          payload,
          saleAuthorization,
          listingId,
          sealTxid,
        ),
        saleTicketValueSats: Number(row.sale_ticket_value_sats ?? 0),
        saleTicketVout: row.sale_ticket_vout,
        sealAt: dateIso(payload.sealAt ?? payload.sealedAt ?? row.updated_at),
        sealConfirmed:
          payload.sealConfirmed === true ||
          (validTxid(sealTxid) && status === "sealing"),
        sealTxid,
        sellerAddress: row.seller_address ?? payload.sellerAddress,
        status,
        ticker: row.ticker ?? payload.ticker ?? saleAuthorization.ticker,
        tokenId: row.token_id ?? payload.tokenId ?? saleAuthorization.tokenId,
        txid: listingId,
      });
    })
    .filter(activeTokenListingHistoryItem)
    .filter((item) => !closedListingIds.has(tokenListingId(item)))
    .sort(compareTokenHistoryMarketItems);

  return tokenHistoryPageFromItems({
    indexedAt: dateIso(
      countResult.rows[0]?.indexed_at ?? snapshot?.generated_at,
    ),
    indexedThroughBlock: undefined,
    items,
    kind: "listings",
    network,
    pagination,
    source: "proof-indexer-credit-listings-exact",
    snapshot,
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

function objectRecord(value) {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value
    : {};
}

function inputAddressesFromRawTransaction(rawTx) {
  const tx = objectRecord(rawTx);
  const vin = Array.isArray(tx.vin) ? tx.vin : [];
  return [
    ...new Set(
      vin
        .map((input) =>
          String(input?.prevout?.scriptpubkey_address ?? input?.address ?? "")
            .trim(),
        )
        .filter(Boolean),
    ),
  ];
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
  if (
    publicOnly &&
    (item?.valid === false || !PUBLIC_LOG_EVENT_KINDS.has(kind))
  ) {
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
        AND payload ? 'snapshotId'
      ORDER BY
        CASE
          WHEN payload->>'snapshotId' = snapshot_id
            AND payload ? 'activityPayload'
            AND payload ? 'registryHistoryPayloads'
            AND payload ? 'summaryPayloads'
            AND payload ? 'tokenHistoryPayloads'
            AND payload ? 'tokenStatePayloads'
          THEN 0
          ELSE 1
        END,
        generated_at DESC
      LIMIT 1
    `,
    [network],
  );
  return snapshotResult.rows[0] ?? null;
}

async function ledgerSnapshotMetadata(pool, network, snapshotId = "") {
  const pinnedSnapshotId = normalizedSnapshotId(snapshotId);
  if (pinnedSnapshotId) {
    const pinnedResult = await pool.query(
      `
        SELECT
          snapshot_id,
          generated_at,
          indexed_through_block,
          consistency
        FROM proof_indexer.ledger_snapshots
        WHERE network = $1 AND snapshot_id = $2
          AND payload ? 'snapshotId'
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
        consistency
      FROM proof_indexer.ledger_snapshots
      WHERE network = $1
      ORDER BY generated_at DESC
      LIMIT 1
    `,
    [network],
  );
  return snapshotResult.rows[0] ?? null;
}

async function ledgerSnapshotWithPayload(pool, network, snapshotId, payloadKey) {
  const requiredPayloadKey = String(payloadKey ?? "").trim();
  if (!requiredPayloadKey) {
    return ledgerSnapshot(pool, network, snapshotId);
  }

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
        WHERE network = $1
          AND snapshot_id = $2
          AND payload ? $3
        LIMIT 1
      `,
      [network, pinnedSnapshotId, requiredPayloadKey],
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
        AND payload ? $2
      ORDER BY generated_at DESC
      LIMIT 1
    `,
    [network, requiredPayloadKey],
  );
  return snapshotResult.rows[0] ?? null;
}

async function tokenStateSnapshotForScope(pool, network, snapshotId, scope) {
  const tokenScope = tokenScopeKey(scope);
  if (!tokenScope || tokenScope === "all") {
    return null;
  }

  const pinnedSnapshotId = normalizedSnapshotId(snapshotId);
  const selectSql = pinnedSnapshotId
    ? `
      SELECT
        snapshot_id,
        generated_at,
        indexed_through_block,
        consistency,
        payload->'tokenStatePayloads'->$2 AS scoped_payload
      FROM proof_indexer.ledger_snapshots
      WHERE network = $1
        AND payload ? 'tokenStatePayloads'
        AND payload->'tokenStatePayloads' ? $2
        AND snapshot_id = $3
      LIMIT 1
    `
    : `
      WITH recent AS (
        SELECT
          snapshot_id,
          generated_at,
          indexed_through_block,
          consistency,
          payload
        FROM proof_indexer.ledger_snapshots
        WHERE network = $1
        ORDER BY generated_at DESC
        LIMIT ${LEDGER_SNAPSHOT_RECENT_READ_LIMIT}
      )
      SELECT
        snapshot_id,
        generated_at,
        indexed_through_block,
        consistency,
        payload->'tokenStatePayloads'->$2 AS scoped_payload
      FROM recent
      WHERE payload ? 'tokenStatePayloads'
        AND payload->'tokenStatePayloads' ? $2
      ORDER BY generated_at DESC
      LIMIT 1
    `;
  const result = await pool.query(
    selectSql,
    pinnedSnapshotId ? [network, tokenScope, pinnedSnapshotId] : [network, tokenScope],
  );
  return result.rows[0] ?? null;
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

function embeddedHistoryIndexedThroughBlock(storedPayload) {
  if (
    !storedPayload ||
    typeof storedPayload !== "object" ||
    Array.isArray(storedPayload)
  ) {
    return 0;
  }
  return Math.max(
    safeBlockHeight(storedPayload.indexedThroughBlock),
    safeBlockHeight(storedPayload.stats?.indexedThroughBlock),
    indexedThroughBlockFromItems(storedPayload.items) ?? 0,
  );
}

function tokenHistoryEmbeddedIndexedThroughBlock(snapshot, safeKind) {
  const payloads = tokenHistoryPayloadsFromSnapshot(snapshot);
  if (!payloads) {
    return 0;
  }
  return Math.max(
    0,
    ...Object.values(payloads).map((scopePayload) =>
      embeddedHistoryIndexedThroughBlock(scopePayload?.[safeKind]),
    ),
  );
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
      Math.max(
        indexedThroughBlockFromItems(filtered) ?? 0,
        rowNumber(snapshot, "indexed_through_block"),
      ) || undefined,
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
      Math.max(
        indexedThroughBlockFromItems(filtered) ?? 0,
        embeddedHistoryIndexedThroughBlock(storedPayload),
      ) || undefined,
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

  const sourceItems = normalizeTokenHistoryItemsForKind(
    source.sourceItems,
    safeKind,
  );
  const needles = tokenHistoryFilterNeedles(searchParams, pagination);
  const filtered = historyItemsMatchingNeedles(sourceItems, needles);
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
      Math.max(
        indexedThroughBlockFromItems(filtered) ?? 0,
        embeddedHistoryIndexedThroughBlock(source.payload),
      ) || undefined,
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
    conditions.push(
      `(
        lower(e.payload->>'tokenId') = ${scopeParam}
        OR lower(e.payload->'saleAuthorization'->>'tokenId') = ${scopeParam}
        OR lower(cl_event.token_id) = ${scopeParam}
        OR lower(cd.token_id) = ${scopeParam}
        OR lower(cd.ticker) = lower(${scopeParam})
        OR lower(e.payload->>'ticker') = lower(${scopeParam})
        OR lower(e.payload->'saleAuthorization'->>'ticker') = lower(${scopeParam})
      )`,
    );
  }

  const needles = tokenHistoryFilterNeedles(searchParams, pagination);
  const txidNeedles = needles.map(normalizedTxid).filter(Boolean);
  if (txidNeedles.length > 0) {
    const uniqueTxidNeedles = [...new Set(txidNeedles)];
    params.push(uniqueTxidNeedles);
    const param = `$${params.length}`;
    const payloadClauses = [];
    for (const txidNeedle of uniqueTxidNeedles) {
      for (const key of [
        "txid",
        "saleTxid",
        "closeTxid",
        "closedTxid",
        "listingId",
      ]) {
        params.push(JSON.stringify({ [key]: txidNeedle }));
        payloadClauses.push(`e.payload @> $${params.length}::jsonb`);
      }
    }
    conditions.push(
      `(
        e.txid = ANY(${param}::text[])
        ${payloadClauses.length > 0 ? `OR ${payloadClauses.join("\n        OR ")}` : ""}
        OR cl_event.listing_id = ANY(${param}::text[])
        OR cl_event.close_txid = ANY(${param}::text[])
        OR EXISTS (
          SELECT 1
          FROM proof_indexer.event_refs erq
          WHERE erq.event_id = e.event_id
            AND erq.ref_value = ANY(${param}::text[])
        )
      )`,
    );
  }
  for (const needle of needles.filter((value) => !normalizedTxid(value))) {
    params.push(`%${needle}%`);
    const param = `$${params.length}`;
    conditions.push(
      `lower(concat_ws(
        ' ',
        e.txid,
        e.payload::text,
        cl_event.listing_id,
        cl_event.seller_address,
        cl_event.buyer_address,
        cl_event.amount::text,
        cl_event.price_sats::text,
        cl_event.payload::text,
        cd.token_id,
        cd.ticker,
        cd.registry_address
      )) LIKE ${param}`,
    );
  }
  if (safeKind === "listings") {
    conditions.push(
      `(e.status IS DISTINCT FROM 'dropped')`,
      `(e.payload ? 'saleAuthorization')`,
      `(e.payload->'saleAuthorization'->>'version' = 'pwt-sale-v1')`,
      `(e.payload->'saleAuthorization'->>'anchorType' = 'sale-ticket-v1')`,
    );
    if (txidNeedles.length > 0) {
      conditions.push(
        `(
          cl_event.listing_id IS NULL
          OR lower(cl_event.status) != ALL(ARRAY['closed','sold','dropped']::text[])
        )`,
        `NOT EXISTS (
          SELECT 1
          FROM proof_indexer.events close_event
          WHERE close_event.network = e.network
            AND close_event.valid = true
            AND close_event.kind = ANY(ARRAY['token-listing-closed','token-sale']::text[])
            AND lower(close_event.payload->>'listingId') = lower(e.payload->>'listingId')
        )`,
      );
    } else {
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
  }

  const whereClause = conditions.join(" AND ");
  const countResult = await pool.query(
    `
      SELECT count(*) AS total_count, max(e.block_height) AS indexed_through_block
      FROM proof_indexer.events e
      LEFT JOIN proof_indexer.credit_listings cl_event
        ON cl_event.network = e.network
       AND cl_event.listing_id = lower(e.payload->>'listingId')
      LEFT JOIN proof_indexer.credit_definitions cd
        ON cd.network = e.network
       AND cd.token_id = COALESCE(lower(e.payload->>'tokenId'), cl_event.token_id)
      WHERE ${whereClause}
    `,
    params,
  );
  const totalCount = rowNumber(countResult.rows[0], "total_count");
  const indexedThroughBlock =
    rowNumber(countResult.rows[0], "indexed_through_block") || undefined;
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
        e.event_id,
        COALESCE(cd.token_id, cl_event.token_id) AS token_id,
        cd.ticker,
        cd.registry_address,
        cl_event.listing_id AS linked_listing_id,
        cl_event.seller_address AS listing_seller_address,
        cl_event.buyer_address AS listing_buyer_address,
        cl_event.amount AS listing_amount,
        cl_event.price_sats AS listing_price_sats,
        cl_event.payload AS listing_payload
      FROM proof_indexer.events e
      LEFT JOIN proof_indexer.credit_listings cl_event
        ON cl_event.network = e.network
       AND cl_event.listing_id = lower(e.payload->>'listingId')
      LEFT JOIN proof_indexer.credit_definitions cd
        ON cd.network = e.network
       AND cd.token_id = COALESCE(lower(e.payload->>'tokenId'), cl_event.token_id)
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
      tokenHistoryItemFromMarketEventPayload(
        tokenMarketEventRowPayload(row, network),
        safeKind,
      ),
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

export async function proofIndexTokenListingCloseOutspendPayload(
  network,
  listingTxid,
) {
  const pool = proofIndexPool();
  const normalizedListingTxid = String(listingTxid ?? "").trim().toLowerCase();
  if (!pool || !/^[0-9a-f]{64}$/u.test(normalizedListingTxid)) {
    return null;
  }

  const result = await pool.query(
    `
      SELECT
        e.payload,
        e.status,
        e.block_time,
        e.block_height,
        e.txid
      FROM proof_indexer.events e
      WHERE e.network = $1
        AND e.valid = true
        AND e.kind = ANY(ARRAY['token-listing-closed','token-sale']::text[])
        AND lower(e.payload->>'listingId') = $2
      ORDER BY
        COALESCE(e.event_time, e.block_time, e.created_at) DESC,
        e.txid DESC,
        e.event_id DESC
      LIMIT 1
    `,
    [network, normalizedListingTxid],
  );
  const row = result.rows[0];
  const closeTxid = String(row?.txid ?? row?.payload?.closedTxid ?? "")
    .trim()
    .toLowerCase();
  if (!/^[0-9a-f]{64}$/u.test(closeTxid)) {
    return null;
  }

  const confirmed =
    row?.status === "confirmed" ||
    row?.payload?.confirmed === true ||
    row?.payload?.closedConfirmed === true;
  return {
    spent: true,
    status: {
      block_height: rowNumber(row, "block_height") || undefined,
      block_time: row?.block_time
        ? Math.floor(new Date(row.block_time).getTime() / 1000)
        : undefined,
      confirmed,
    },
    txid: closeTxid,
    vin: Number.isSafeInteger(Number(row?.payload?.closedVin))
      ? Number(row.payload.closedVin)
      : undefined,
  };
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
  const conditions = [
    "e.network = $1",
    "e.valid = true",
    "e.status IN ('confirmed', 'pending')",
    "e.kind = ANY($2::text[])",
  ];
  const params = [network, [...PUBLIC_LOG_EVENT_KINDS]];
  const addParam = (value) => {
    params.push(value);
    return `$${params.length}`;
  };

  if (requestedKind) {
    conditions.push(eventKindSqlCondition(requestedKind, addParam));
  }

  let exactQueryTxid = "";
  if (pagination.query) {
    const queryTxid = normalizedTxid(pagination.query);
    if (queryTxid) {
      exactQueryTxid = queryTxid;
      const queryParam = addParam(queryTxid);
      const txidPayloadParam = addParam(JSON.stringify({ txid: queryTxid }));
      const saleTxidPayloadParam = addParam(
        JSON.stringify({ saleTxid: queryTxid }),
      );
      const closeTxidPayloadParam = addParam(
        JSON.stringify({ closeTxid: queryTxid }),
      );
      const closedTxidPayloadParam = addParam(
        JSON.stringify({ closedTxid: queryTxid }),
      );
      const listingIdPayloadParam = addParam(
        JSON.stringify({ listingId: queryTxid }),
      );
      conditions.push(`
        (
          e.txid = ${queryParam}
          OR e.payload @> ${txidPayloadParam}::jsonb
          OR e.payload @> ${saleTxidPayloadParam}::jsonb
          OR e.payload @> ${closeTxidPayloadParam}::jsonb
          OR e.payload @> ${closedTxidPayloadParam}::jsonb
          OR e.payload @> ${listingIdPayloadParam}::jsonb
          OR EXISTS (
            SELECT 1
            FROM proof_indexer.event_refs erq
            WHERE erq.event_id = e.event_id
              AND erq.ref_value = ${queryParam}
          )
        )
      `);
    } else {
      const queryParam = addParam(`%${pagination.query}%`);
      conditions.push(`
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
  }

  const whereClause = conditions.join(" AND ");
  if (exactQueryTxid) {
    const snapshot = await ledgerSnapshotMetadata(
      pool,
      network,
      pagination.snapshotId,
    );
    if (!snapshot) {
      return null;
    }
    const rowLimit = Math.max(
      pagination.limit,
      pagination.limit + pagination.offset,
    );
    const rowParams = [...params, rowLimit];
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
    return logHistoryPageFromItems({
      indexedAt: snapshot.generated_at
        ? dateIso(snapshot.generated_at)
        : new Date().toISOString(),
      indexedThroughBlock:
        indexedThroughBlockFromItems(rowsResult.rows) ??
        rowNumber(snapshot, "indexed_through_block"),
      items: normalizeHistoryEventRows(rowsResult.rows, network, {
        publicOnly: true,
      }),
      kind: requestedKind || "activity",
      network,
      pagination,
      snapshot,
      source: "proof-indexer",
    });
  }

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
  const scan = await latestProofIndexScanMetadata(pool, network);
  const conditions = [
    "e.network = $1",
    "e.valid = true",
    "e.kind = ANY($2::text[])",
  ];
  const params = [
    network,
    ["token-listings", "token-listing", "token-sale", "token-listing-closed"],
  ];

  if (scope && scope !== "all") {
    params.push(scope);
    const scopeParam = `$${params.length}`;
    conditions.push(
      `(
        lower(e.payload->>'tokenId') = ${scopeParam}
        OR lower(e.payload->'saleAuthorization'->>'tokenId') = ${scopeParam}
        OR lower(cl_event.token_id) = ${scopeParam}
        OR lower(cd.token_id) = ${scopeParam}
        OR lower(cd.ticker) = lower(${scopeParam})
        OR lower(e.payload->>'ticker') = lower(${scopeParam})
        OR lower(e.payload->'saleAuthorization'->>'ticker') = lower(${scopeParam})
      )`,
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
      LEFT JOIN proof_indexer.credit_listings cl_event
        ON cl_event.network = e.network
       AND cl_event.listing_id = lower(e.payload->>'listingId')
      LEFT JOIN proof_indexer.credit_definitions cd
        ON cd.network = e.network
       AND cd.token_id = COALESCE(lower(e.payload->>'tokenId'), cl_event.token_id)
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
        e.event_id,
        COALESCE(cd.token_id, cl_event.token_id) AS token_id,
        cd.ticker,
        cd.registry_address,
        cl_event.listing_id AS linked_listing_id,
        cl_event.seller_address AS listing_seller_address,
        cl_event.buyer_address AS listing_buyer_address,
        cl_event.amount AS listing_amount,
        cl_event.price_sats AS listing_price_sats,
        cl_event.payload AS listing_payload
      FROM proof_indexer.events e
      LEFT JOIN proof_indexer.credit_listings cl_event
        ON cl_event.network = e.network
       AND cl_event.listing_id = lower(e.payload->>'listingId')
      LEFT JOIN proof_indexer.credit_definitions cd
        ON cd.network = e.network
       AND cd.token_id = COALESCE(lower(e.payload->>'tokenId'), cl_event.token_id)
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
    const payload = tokenMarketEventRowPayload(row, network);
    if (payload?.kind === "token-listing" || payload?.kind === "token-listings") {
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
        closedListings.push(tokenClosedListingFromSalePayload(sale));
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
  const eventIndexedThroughBlock = rowNumber(
    countResult.rows[0],
    "indexed_through_block",
  );
  const scanIndexedThroughBlock = rowNumber(scan, "indexed_through_block");
  return {
    closedListings: closedListings.filter(Boolean).sort(compareTokenItemsByTime),
    indexedAt: dateIso(scan?.generated_at ?? countResult.rows[0]?.indexed_at),
    indexedThroughBlock: Math.max(
      eventIndexedThroughBlock,
      scanIndexedThroughBlock,
    ),
    listings: listings.sort(compareTokenItemsByTime),
    sales: sales.sort(compareTokenItemsByTime),
    scanSnapshotId: String(scan?.snapshot_id ?? ""),
    source: "proof-indexer-token-market-summary-overlay",
    stats: {
      ...stats,
      complete: rowsResult.rows.length >= totalCount,
      totalCount,
    },
  };
}

async function currentTokenTransferHistoryPage(
  pool,
  network,
  tokenScope,
  searchParams,
  pagination,
) {
  const scope = tokenScopeKey(tokenScope);
  const params = [network];
  const conditions = [
    "e.network = $1",
    "e.valid = true",
    "e.kind = 'token-transfer'",
    "COALESCE(t.status, e.status) IN ('confirmed', 'pending')",
  ];
  const scan = await latestProofIndexScanMetadata(pool, network);

  if (scope && scope !== "all") {
    params.push(scope);
    const scopeParam = `$${params.length}`;
    conditions.push(`(
      lower(e.payload->>'tokenId') = ${scopeParam}
      OR lower(cd.token_id) = ${scopeParam}
      OR lower(cd.ticker) = lower(${scopeParam})
      OR lower(e.payload->>'ticker') = lower(${scopeParam})
    )`);
  }

  const needles = tokenHistoryFilterNeedles(searchParams, pagination);
  const txidNeedles = [
    ...new Set(needles.map(normalizedTxid).filter(Boolean)),
  ];
  if (txidNeedles.length > 0) {
    params.push(txidNeedles);
    const txidParam = `$${params.length}`;
    conditions.push(`(
        lower(e.txid) = ANY(${txidParam}::text[])
        OR lower(e.payload->>'txid') = ANY(${txidParam}::text[])
        OR EXISTS (
          SELECT 1
          FROM proof_indexer.event_refs erq
          WHERE erq.event_id = e.event_id
            AND lower(erq.ref_value) = ANY(${txidParam}::text[])
        )
      )`);
  }

  for (const needle of needles.filter((value) => !normalizedTxid(value))) {
    params.push(`%${needle}%`);
    const needleParam = `$${params.length}`;
    conditions.push(`(
      lower(e.txid) LIKE ${needleParam}
      OR lower(e.payload::text) LIKE ${needleParam}
      OR lower(COALESCE(cd.token_id, '')) LIKE ${needleParam}
      OR lower(COALESCE(cd.ticker, '')) LIKE ${needleParam}
      OR lower(COALESCE(cd.registry_address, '')) LIKE ${needleParam}
      OR EXISTS (
        SELECT 1
        FROM proof_indexer.event_participants epq
        WHERE epq.event_id = e.event_id
          AND (
            lower(epq.address) LIKE ${needleParam}
            OR lower(COALESCE(epq.powid, '')) LIKE ${needleParam}
          )
      )
      OR EXISTS (
        SELECT 1
        FROM proof_indexer.event_refs erq
        WHERE erq.event_id = e.event_id
          AND lower(erq.ref_value) LIKE ${needleParam}
      )
    )`);
  }

  const fromSql = `
    FROM proof_indexer.events e
    LEFT JOIN proof_indexer.transactions t
      ON t.network = e.network
     AND t.txid = e.txid
    LEFT JOIN proof_indexer.credit_definitions cd
      ON cd.network = e.network
     AND cd.token_id = lower(e.payload->>'tokenId')
    WHERE ${conditions.join(" AND ")}
  `;
  const countResult = await pool.query(
    `
      SELECT
        count(*) AS total_count,
        max(e.block_height) AS indexed_through_block,
        max(COALESCE(e.event_time, e.block_time, e.created_at)) AS indexed_at
      ${fromSql}
    `,
    params,
  );
  const totalCount = rowNumber(countResult.rows[0], "total_count");
  const rowParams = [...params, pagination.limit, pagination.offset];
  const limitParam = `$${rowParams.length - 1}`;
  const offsetParam = `$${rowParams.length}`;
  const rowsResult = await pool.query(
    `
      SELECT
        e.network,
        e.txid,
        e.status AS event_status,
        COALESCE(t.status, e.status) AS status,
        e.amount_sats,
        e.block_height,
        e.block_time,
        e.event_time,
        e.created_at,
        e.payload,
        t.raw_tx,
        cd.ticker,
        cd.registry_address,
        cd.token_id,
        ARRAY(
          SELECT ep.address
          FROM proof_indexer.event_participants ep
          WHERE ep.event_id = e.event_id
          ORDER BY ep.role, ep.address
        ) AS participant_addresses,
        (
          SELECT ep.address
          FROM proof_indexer.event_participants ep
          WHERE ep.event_id = e.event_id
            AND lower(ep.role) IN ('sender', 'actor', 'owner')
          ORDER BY
            CASE lower(ep.role)
              WHEN 'sender' THEN 0
              WHEN 'actor' THEN 1
              ELSE 2
            END,
            ep.address
          LIMIT 1
        ) AS participant_sender_address,
        (
          SELECT ep.address
          FROM proof_indexer.event_participants ep
          WHERE ep.event_id = e.event_id
            AND lower(ep.role) IN ('recipient', 'counterparty', 'receiver')
          ORDER BY
            CASE lower(ep.role)
              WHEN 'recipient' THEN 0
              WHEN 'counterparty' THEN 1
              ELSE 2
            END,
            ep.address
          LIMIT 1
        ) AS participant_recipient_address
      ${fromSql}
      ORDER BY
        COALESCE(e.event_time, e.block_time, e.created_at) DESC,
        e.txid DESC,
        e.event_id DESC
      LIMIT ${limitParam}
      OFFSET ${offsetParam}
    `,
    rowParams,
  );

  const exactTxids = txidNeedles;
  const invalidPage =
    exactTxids.length > 0
      ? await currentTokenInvalidEventHistoryPage(
          pool,
          network,
          tokenScope,
          searchParams,
          {
            ...pagination,
            limit: Math.max(pagination.limit, exactTxids.length),
            offset: 0,
          },
        )
      : null;
  const canonicalInvalidTxids = [
    ...new Set(
      (Array.isArray(invalidPage?.items) ? invalidPage.items : [])
        .map((item) => normalizedTxid(item?.txid))
        .filter((txid) => txid && exactTxids.includes(txid)),
    ),
  ];

  const items = rowsResult.rows
    .map((row) => {
      const payload = normalizeEventPayload(
        canonicalEventPayload(row.payload),
        row,
      );
      const participantAddresses = Array.isArray(row.participant_addresses)
        ? row.participant_addresses.map(String).filter(Boolean)
        : [];
      const recipientAddress = String(
        payload.recipientAddress ??
          payload.to ??
          payload.counterparty ??
          row.participant_recipient_address ??
          "",
      ).trim();
      const registryAddress = String(
        payload.registryAddress ?? row.registry_address ?? "",
      ).trim();
      const inferredSender = participantAddresses.find((address) => {
        const key = address.toLowerCase();
        return (
          key !== recipientAddress.toLowerCase() &&
          key !== registryAddress.toLowerCase()
        );
      });
      const senderAddress = String(
        payload.senderAddress ??
          payload.from ??
          payload.actor ??
          row.participant_sender_address ??
          inferredSender ??
          "",
      ).trim();
      let transfer = tokenTransferFromEventPayload(
        {
          ...payload,
          participants:
            participantAddresses.length > 0
              ? participantAddresses
              : payload.participants,
          recipientAddress,
          senderAddress,
        },
        row,
      );
      if (!transfer.senderAddress) {
        const [rawSenderAddress = ""] = inputAddressesFromRawTransaction(
          row.raw_tx,
        );
        if (rawSenderAddress) {
          transfer = { ...transfer, senderAddress: rawSenderAddress };
        }
      }
      return transfer;
    })
    .filter(
      (item) =>
        item.txid &&
        item.tokenId &&
        item.amount > 0 &&
        (item.senderAddress || item.recipientAddress),
    );
  const start = Math.min(pagination.offset, totalCount);
  const end = Math.min(totalCount, start + pagination.limit);
  const indexedAt = dateIso(
    newestDateIso([scan?.generated_at, countResult.rows[0]?.indexed_at]),
  );

  return {
    canonicalInvalidTxids,
    cursor: historyCursor("", start),
    end,
    indexedAt,
    indexedThroughBlock:
      Math.max(
        rowNumber(scan, "indexed_through_block"),
        rowNumber(countResult.rows[0], "indexed_through_block"),
      ) || undefined,
    items,
    kind: "transfers",
    limit: pagination.limit,
    network,
    nextCursor: end < totalCount ? historyCursor("", end) : "",
    page: Math.floor(start / pagination.limit),
    pageCount: Math.max(1, Math.ceil(totalCount / pagination.limit)),
    pageSize: pagination.limit,
    query: pagination.query,
    source: "proof-indexer-token-transfer-events",
    start,
    totalCount,
  };
}

async function currentTokenInvalidEventHistoryPage(
  pool,
  network,
  tokenScope,
  searchParams,
  pagination,
) {
  const query = tokenInvalidEventQueryParts(
    network,
    tokenScope,
    searchParams,
    pagination,
  );
  const scan = await latestProofIndexScanMetadata(pool, network);
  const countResult = await pool.query(
    `
      SELECT
        count(*) AS total_count,
        max(COALESCE(t.block_height, e.block_height)) AS indexed_through_block,
        max(COALESCE(t.block_time, e.event_time, e.block_time, e.created_at)) AS indexed_at
      ${query.fromSql}
    `,
    query.params,
  );
  const totalCount = rowNumber(countResult.rows[0], "total_count");
  const rowParams = [
    ...query.params,
    pagination.limit,
    pagination.offset,
  ];
  const limitParam = `$${rowParams.length - 1}`;
  const offsetParam = `$${rowParams.length}`;
  const rowsResult = await pool.query(
    `
      SELECT
        ${tokenInvalidEventSelectSql()}
      ${query.fromSql}
      ORDER BY
        COALESCE(t.block_time, e.event_time, e.block_time, e.created_at) DESC,
        e.txid DESC,
        e.event_id DESC
      LIMIT ${limitParam}
      OFFSET ${offsetParam}
    `,
    rowParams,
  );
  const start = Math.min(pagination.offset, totalCount);
  const end = Math.min(totalCount, start + pagination.limit);
  const indexedAt = dateIso(
    newestDateIso([scan?.generated_at, countResult.rows[0]?.indexed_at]),
  );

  return {
    cursor: historyCursor("", start),
    end,
    indexedAt,
    indexedThroughBlock:
      Math.max(
        rowNumber(scan, "indexed_through_block"),
        rowNumber(countResult.rows[0], "indexed_through_block"),
      ) || undefined,
    items: rowsResult.rows.map(tokenInvalidEventFromRow),
    kind: "invalidEvents",
    limit: pagination.limit,
    network,
    nextCursor: end < totalCount ? historyCursor("", end) : "",
    page: Math.floor(start / pagination.limit),
    pageCount: Math.max(1, Math.ceil(totalCount / pagination.limit)),
    pageSize: pagination.limit,
    query: pagination.query,
    source: "proof-indexer-token-invalid-events",
    start,
    totalCount,
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

  const exactMarketTxidNeedles = tokenHistoryFilterNeedles(
    searchParams,
    eligibility.pagination,
  )
    .map(normalizedTxid)
    .filter(Boolean);
  if (
    !eligibility.pagination.snapshotId &&
    exactMarketTxidNeedles.length > 0 &&
    tokenHistoryMarketEventKinds(eligibility.kind).length > 0
  ) {
    const snapshotMetadata = await ledgerSnapshotMetadata(
      pool,
      network,
      eligibility.pagination.snapshotId,
    );
    if (snapshotMetadata) {
      const exactMarketPage = await proofIndexTokenMarketHistoryOverlayPayload(
        network,
        tokenScope,
        eligibility.kind,
        searchParams,
        {
          pagination: eligibility.pagination,
          snapshot: snapshotMetadata,
        },
      );
      if (exactMarketPage) {
        return tokenHistoryPageWithScanCoverage(exactMarketPage, null);
      }
    }
  }

  // Unpinned transfer history is a live read-model query. In particular, the
  // participant index is authoritative for address searches after a targeted
  // participant repair; falling back to an older embedded snapshot would hide
  // the repaired transfer again.
  if (
    eligibility.kind === "transfers" &&
    !eligibility.pagination.snapshotId
  ) {
    return currentTokenTransferHistoryPage(
      pool,
      network,
      tokenScope,
      searchParams,
      eligibility.pagination,
    );
  }

  // Invalid credit attempts are live canonical audit rows. Unpinned history
  // must use the relational participant/ref indexes instead of waiting for a
  // later embedded token-history snapshot to republish them.
  if (
    eligibility.kind === "invalidEvents" &&
    !eligibility.pagination.snapshotId
  ) {
    return currentTokenInvalidEventHistoryPage(
      pool,
      network,
      tokenScope,
      searchParams,
      eligibility.pagination,
    );
  }

  if (
    eligibility.kind === "holders" &&
    eligibility.scope !== "all" &&
    !eligibility.pagination.snapshotId
  ) {
    const scan = await latestProofIndexScanMetadata(pool, network);
    const page = await proofIndexScopedHolderHistoryPayload(
      pool,
      network,
      eligibility.scope,
      eligibility.pagination,
      scan
        ? {
            generated_at: scan.generated_at,
            payload: {},
            snapshot_id: "",
          }
        : null,
    );
    return page
      ? {
          ...page,
          indexedThroughBlock:
            rowNumber(scan, "indexed_through_block") || undefined,
          source: "proof-indexer-credit-balances",
        }
      : null;
  }

  // Unpinned mint history is a current event-table read. Do not require a
  // deprecated embedded token-history snapshot before querying canonical
  // mint rows.
  if (
    eligibility.kind === "mints" &&
    !eligibility.pagination.snapshotId
  ) {
    const scan = await latestProofIndexScanMetadata(pool, network);
    const page = await exactTokenMintHistoryPage(
      pool,
      network,
      tokenScope,
      searchParams,
      eligibility.pagination,
      null,
    );
    if (page) {
      return currentRelationalHistoryPageWithScanCoverage(page, scan);
    }
  }

  // Broad unpinned market history is likewise relational. Exact txid market
  // searches already take the summary-pinned branch above; the default page
  // must not disappear merely because embedded history blobs are retired.
  if (
    eligibility.kind === "market-log" &&
    !eligibility.pagination.snapshotId &&
    exactMarketTxidNeedles.length === 0
  ) {
    const scan = await latestProofIndexScanMetadata(pool, network);
    const page = await proofIndexTokenMarketHistoryOverlayPayload(
      network,
      tokenScope,
      eligibility.kind,
      searchParams,
      {
        pagination: eligibility.pagination,
        snapshot: {
          generated_at: scan?.generated_at,
          snapshot_id: "",
        },
      },
    );
    if (page) {
      return currentRelationalHistoryPageWithScanCoverage(page, scan);
    }
  }

  const snapshot = await ledgerSnapshotWithPayload(
    pool,
    network,
    eligibility.pagination.snapshotId,
    "tokenHistoryPayloads",
  );
  if (!snapshot) {
    return null;
  }

  if (
    eligibility.kind === "mints" &&
    !eligibility.pagination.snapshotId
  ) {
    const exactMintPage = await exactTokenMintHistoryPage(
      pool,
      network,
      tokenScope,
      searchParams,
      eligibility.pagination,
      snapshot,
    );
    if (exactMintPage) {
      return exactMintPage;
    }
  }

  if (
    eligibility.kind === "listings" &&
    !eligibility.pagination.snapshotId
  ) {
    const exactListingPage = await exactActiveTokenListingHistoryPage(
      pool,
      network,
      tokenScope,
      searchParams,
      eligibility.pagination,
      snapshot,
    );
    if (exactListingPage) {
      return exactListingPage;
    }
  }

  const snapshotPage = tokenHistoryPageFromSnapshot(
    snapshot,
    network,
    tokenScope,
    eligibility.kind,
    searchParams,
    eligibility.pagination,
  );
  const marketOverlayPage = eligibility.pagination.snapshotId
    ? null
    : await proofIndexTokenMarketHistoryOverlayPayload(
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
  if (
    page &&
    eligibility.kind === "listings" &&
    !eligibility.pagination.snapshotId
  ) {
    page = await filterClosedTokenListingHistoryPage(pool, page, network);
  }
  if (page) {
    return tokenHistoryPageWithScanCoverage(page, null);
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
  const indexedThroughBlock = Math.max(
    rowNumber(payload, "indexedThroughBlock"),
    rowNumber(payload?.stats, "indexedThroughBlock"),
    rowNumber(payload?.metrics, "indexedThroughBlock"),
  );
  return {
    ...payload,
    indexedThroughBlock: indexedThroughBlock || undefined,
    indexedAt: dateIso(
      payload.indexedAt ??
        snapshot?.payload?.tokenStatePayloadsIndexedAt,
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

async function latestProofIndexScanMetadata(pool, network) {
  const result = await pool.query(
    `
      WITH latest_scan AS (
        SELECT
          snapshot_id,
          generated_at,
          indexed_through_block,
          source_hashes,
          metrics,
          consistency,
          payload
        FROM proof_indexer.ledger_snapshots
        WHERE network = $1
          AND (
            source_hashes ? 'blockScan'
            OR
            payload->>'source' = 'proof-indexer-block-scan'
            OR consistency->>'status' LIKE 'block-scan%'
          )
        ORDER BY
          CASE
            WHEN NULLIF(
              COALESCE(
                NULLIF(payload->>'indexedThroughBlockHash', ''),
                NULLIF(payload->>'blockHash', '')
              ),
              ''
            ) IS NOT NULL THEN 0
            ELSE 1
          END,
          indexed_through_block DESC NULLS LAST,
          generated_at DESC
        LIMIT 1
      ),
      latest_summary AS (
        SELECT
          snapshot_id,
          generated_at,
          payload->'summaryPayloads' AS summary_payloads,
          payload->>'summaryPayloadsIndexedAt' AS summary_indexed_at
        FROM proof_indexer.ledger_snapshots
        WHERE network = $1
          AND COALESCE(consistency->>'ok', payload->>'ok', 'false') = 'true'
          AND COALESCE(consistency->>'status', payload->>'status', '') <> 'summary-snapshot-fallback'
          AND payload->'summaryRefresh'->>'mode' = 'canonical-summary-refresh'
          AND source_hashes ? 'canonicalSummary'
          AND jsonb_typeof(payload->'summaryPayloads') = 'object'
          AND jsonb_typeof(payload->'summaryPayloads'->'growthSummary') = 'object'
          AND jsonb_typeof(payload->'summaryPayloads'->'infinitySummary') = 'object'
          AND jsonb_typeof(payload->'summaryPayloads'->'marketplaceSummary') = 'object'
          AND jsonb_typeof(payload->'summaryPayloads'->'workFloor') = 'object'
          AND jsonb_typeof(payload->'summaryPayloads'->'workSummary') = 'object'
          AND EXISTS (
            SELECT 1
            FROM jsonb_array_elements(COALESCE(consistency->'checks', '[]'::jsonb)) AS check_item
            WHERE check_item->>'name' = 'token-components-cover-confirmed-activity'
              AND COALESCE(check_item->>'ok', 'false') = 'true'
          )
          AND EXISTS (
            SELECT 1
            FROM jsonb_array_elements(COALESCE(consistency->'checks', '[]'::jsonb)) AS check_item
            WHERE check_item->>'name' = 'canonical-activity-count-matches-public-log'
              AND COALESCE(check_item->>'ok', 'false') = 'true'
          )
        ORDER BY generated_at DESC
        LIMIT 1
      ),
      confirmed_ids AS (
        SELECT
          count(*)::int AS confirmed_id_count,
          max(GREATEST(
            COALESCE(r.registered_height, 0),
            COALESCE(r.updated_height, 0),
            COALESCE(t.block_height, 0)
          ))::int AS confirmed_id_max_block
        FROM proof_indexer.id_records r
        JOIN proof_indexer.transactions t
          ON t.network = r.network
         AND t.txid = r.registration_txid
         AND t.status = 'confirmed'
        WHERE r.network = $1
      ),
      confirmed_transfers AS (
        SELECT
          count(*)::int AS confirmed_transfer_count,
          max(e.block_height)::int AS confirmed_transfer_max_block
        FROM proof_indexer.events e
        WHERE e.network = $1
          AND e.kind = 'token-transfer'
          AND e.status = 'confirmed'
          AND e.valid = true
      ),
      confirmed_events AS (
        SELECT
          count(*)::int AS confirmed_event_count,
          max(e.block_height)::int AS confirmed_event_max_block
        FROM proof_indexer.events e
        WHERE e.network = $1
          AND e.status = 'confirmed'
      ),
      worker_meta AS (
        SELECT value, updated_at
        FROM proof_indexer.meta
        WHERE key = 'worker:lastRun'
        LIMIT 1
      )
      SELECT
        latest_scan.snapshot_id,
        latest_scan.generated_at,
        latest_scan.indexed_through_block,
        latest_scan.source_hashes,
        latest_scan.metrics,
        latest_scan.consistency,
        latest_scan.payload,
        latest_summary.snapshot_id AS summary_snapshot_id,
        latest_summary.generated_at AS summary_generated_at,
        latest_summary.summary_payloads,
        latest_summary.summary_indexed_at,
        confirmed_ids.confirmed_id_count,
        confirmed_ids.confirmed_id_max_block,
        confirmed_transfers.confirmed_transfer_count,
        confirmed_transfers.confirmed_transfer_max_block,
        confirmed_events.confirmed_event_count,
        confirmed_events.confirmed_event_max_block,
        worker_meta.value AS worker,
        worker_meta.updated_at AS worker_updated_at
      FROM confirmed_ids
      CROSS JOIN confirmed_transfers
      CROSS JOIN confirmed_events
      LEFT JOIN latest_scan ON true
      LEFT JOIN latest_summary ON true
      LEFT JOIN worker_meta ON true
    `,
    [network],
  );
  return result.rows[0] ?? null;
}

export async function proofIndexOperationalStatusPayload(network) {
  const pool = proofIndexPool();
  if (!pool) {
    return null;
  }
  const row = await latestProofIndexScanMetadata(pool, network);
  if (!row) {
    return null;
  }
  const payload = objectRecord(row.payload);
  const metrics = objectRecord(row.metrics);
  const consistency = objectRecord(row.consistency);
  const worker = objectRecord(row.worker);
  const summaryPayloads = objectRecord(row.summary_payloads);
  const indexedThroughBlock = rowNumber(row, "indexed_through_block");
  const summaryCoverageByKey = Object.fromEntries(
    [
      "growthSummary",
      "infinitySummary",
      "marketplaceSummary",
      "workFloor",
      "workSummary",
    ].map(
      (key) => {
        const item = objectRecord(summaryPayloads[key]);
        const parentCoverage = Math.max(
          safeBlockHeight(item.indexedThroughBlock),
          safeBlockHeight(item.metrics?.indexedThroughBlock),
          safeBlockHeight(item.stats?.indexedThroughBlock),
        );
        const nested =
          key === "workSummary"
            ? objectRecord(item.floor)
            : key === "growthSummary" || key === "marketplaceSummary"
              ? objectRecord(item.workFloor)
              : null;
        const nestedCoverage = nested
          ? Math.max(
              safeBlockHeight(nested.indexedThroughBlock),
              safeBlockHeight(nested.metrics?.indexedThroughBlock),
              safeBlockHeight(nested.stats?.indexedThroughBlock),
            )
          : key === "workFloor" || key === "infinitySummary"
            ? parentCoverage
            : 0;
        return [
          key,
          parentCoverage > 0 && nestedCoverage > 0
            ? Math.min(parentCoverage, nestedCoverage)
            : 0,
        ];
      },
    ),
  );
  const summaryCoverageValues = Object.values(summaryCoverageByKey);
  const summaryIndexedThroughBlock = summaryCoverageValues.every(
    (height) => height > 0,
  )
    ? Math.min(...summaryCoverageValues)
    : 0;
  return {
    indexedAt: row.generated_at ? dateIso(row.generated_at) : undefined,
    indexedThroughBlock,
    network,
    readModels: {
      confirmedIds: {
        count: rowNumber(row, "confirmed_id_count"),
        maxBlock: rowNumber(row, "confirmed_id_max_block"),
      },
      confirmedTransfers: {
        count: rowNumber(row, "confirmed_transfer_count"),
        maxBlock: rowNumber(row, "confirmed_transfer_max_block"),
      },
      confirmedEvents: {
        count: rowNumber(row, "confirmed_event_count"),
        maxBlock: rowNumber(row, "confirmed_event_max_block"),
      },
    },
    summarySnapshot: {
      coverageByKey: summaryCoverageByKey,
      eligible:
        Boolean(String(row.summary_snapshot_id ?? "")) &&
        summaryIndexedThroughBlock > 0,
      generatedAt: row.summary_generated_at
        ? dateIso(row.summary_generated_at)
        : undefined,
      indexedAt: row.summary_indexed_at
        ? dateIso(row.summary_indexed_at)
        : undefined,
      indexedThroughBlock: summaryIndexedThroughBlock,
      snapshotId: String(row.summary_snapshot_id ?? ""),
    },
    scan: {
      blockHash: String(
        payload.indexedThroughBlockHash ||
          payload.blockHash ||
          objectRecord(row.source_hashes).blockHash ||
          "",
      ),
      complete:
        payload.complete === true ||
        metrics.complete === true ||
        consistency.complete === true,
      snapshotId: String(row.snapshot_id ?? ""),
      stopReason: String(payload.stopReason ?? metrics.stopReason ?? ""),
      tipHeight:
        rowNumber(payload, "tipHeight") ||
        rowNumber(metrics, "tipHeight") ||
        indexedThroughBlock,
    },
    source: "proof-indexer-block-scan",
    worker:
      Object.keys(worker).length > 0
        ? {
            ...worker,
            updatedAt: row.worker_updated_at
              ? dateIso(row.worker_updated_at)
              : worker.updatedAt,
          }
        : null,
  };
}

async function canonicalStateMetaFromPool(pool, network) {
  const result = await pool.query(
    `
      SELECT key, value, updated_at
      FROM proof_indexer.meta
      WHERE key = ANY($1::text[])
    `,
    [["canonical:rebuild", "canonical:fault"]],
  );
  const values = new Map(
    result.rows.map((row) => [String(row.key ?? ""), objectRecord(row.value)]),
  );
  const forNetwork = (key) => {
    const value = values.get(key);
    if (!value || value.network !== network) {
      return null;
    }
    return value;
  };
  return {
    fault: forNetwork("canonical:fault"),
    rebuild: forNetwork("canonical:rebuild"),
  };
}

export async function proofIndexCanonicalStateMetaPayload(network) {
  const pool = proofIndexPool();
  if (!pool) {
    return null;
  }
  return canonicalStateMetaFromPool(pool, network);
}

function canonicalCoreScriptType(type) {
  return {
    nulldata: "op_return",
    pubkeyhash: "p2pkh",
    scripthash: "p2sh",
    witness_v0_keyhash: "v0_p2wpkh",
    witness_v0_scripthash: "v0_p2wsh",
    witness_v1_taproot: "v1_p2tr",
  }[String(type ?? "")] ?? String(type ?? "");
}

function canonicalCoreValueSats(value, label) {
  const amount = Number(value);
  const sats = Math.round(amount * 100_000_000);
  if (!Number.isFinite(amount) || amount < 0 || !Number.isSafeInteger(sats)) {
    throw new Error(`Canonical raw transaction has invalid ${label}.`);
  }
  return sats;
}

function canonicalCoreOutput(output, label) {
  const value = objectRecord(output);
  const script = objectRecord(value.scriptPubKey);
  return {
    scriptpubkey: String(script.hex ?? ""),
    scriptpubkey_address: String(
      script.address ?? (Array.isArray(script.addresses) ? script.addresses[0] : "") ?? "",
    ),
    scriptpubkey_asm: String(script.asm ?? ""),
    scriptpubkey_type: canonicalCoreScriptType(script.type),
    value: canonicalCoreValueSats(value.value, label),
  };
}

function canonicalRawTransactionFromRow(row, network) {
  const raw = objectRecord(row?.raw_tx);
  const marker = objectRecord(raw.canonicalBlockScan);
  const { canonicalBlockScan: _marker, ...transaction } = raw;
  const blockHeight = rowNumber(row, "block_height") || rowNumber(marker, "height");
  const rawBlockIndex = Number(transaction._powBlockIndex);
  const blockTimeMs = Date.parse(row?.block_time ?? "");
  const blockTime = Number.isFinite(Number(transaction.blocktime))
    ? Number(transaction.blocktime)
    : Number.isFinite(blockTimeMs)
      ? Math.floor(blockTimeMs / 1000)
      : undefined;
  const blockHash = String(
    transaction.blockhash ?? row?.block_hash ?? marker.blockHash ?? "",
  )
    .trim()
    .toLowerCase();
  const txid = String(transaction.txid ?? row?.txid ?? "").trim().toLowerCase();
  if (
    marker.network !== network ||
    rowNumber(marker, "height") !== blockHeight ||
    String(marker.blockHash ?? "").trim().toLowerCase() !== blockHash ||
    String(row?.txid ?? "").trim().toLowerCase() !== txid ||
    !/^[0-9a-f]{64}$/u.test(txid) ||
    !/^[0-9a-f]{64}$/u.test(blockHash) ||
    !Number.isSafeInteger(rawBlockIndex) ||
    rawBlockIndex < 0 ||
    !Array.isArray(transaction.vin) ||
    !Array.isArray(transaction.vout)
  ) {
    throw new Error(`Malformed canonical raw transaction ${row?.txid ?? "unknown"}.`);
  }
  const vin = transaction.vin.map((input, index) => {
    const value = objectRecord(input);
    const scriptSig = objectRecord(value.scriptSig);
    const prevout = value.prevout
      ? canonicalCoreOutput(value.prevout, `vin ${index} prevout value`)
      : undefined;
    return {
      ...(prevout ? { prevout } : {}),
      scriptsig: String(scriptSig.hex ?? value.scriptsig ?? ""),
      scriptsig_asm: String(scriptSig.asm ?? value.scriptsig_asm ?? ""),
      sequence: Number(value.sequence ?? 0),
      txid: String(value.txid ?? "").trim().toLowerCase(),
      vout: Number(value.vout ?? -1),
      witness: Array.isArray(value.txinwitness)
        ? value.txinwitness
        : Array.isArray(value.witness)
          ? value.witness
          : [],
    };
  });
  const vout = transaction.vout.map((output, index) =>
    canonicalCoreOutput(output, `vout ${index} value`),
  );
  const rawFee = Number(transaction.fee);
  const relationalFee = Number(row?.fee_sats);
  const fee = Number.isSafeInteger(relationalFee) && relationalFee >= 0
    ? relationalFee
    : Number.isFinite(rawFee) && rawFee >= 0
      ? canonicalCoreValueSats(rawFee, "fee")
      : 0;
  return {
    _powBlockIndex: rawBlockIndex,
    blockhash: blockHash,
    blocktime: blockTime,
    confirmations:
      Number.isFinite(Number(transaction.confirmations)) &&
      Number(transaction.confirmations) > 0
        ? Number(transaction.confirmations)
        : 1,
    fee,
    height: blockHeight,
    locktime: Number(transaction.locktime ?? row?.locktime ?? 0),
    size: Number(transaction.size ?? 0),
    status: {
      block_hash: blockHash,
      block_height: blockHeight,
      block_time: blockTime,
      confirmed: true,
    },
    txid,
    version: Number(transaction.version ?? row?.version ?? 0),
    vin,
    vout,
    weight: Number(transaction.weight ?? row?.weight ?? 0),
  };
}

function canonicalTransactionFault(network, code, message, details = {}) {
  return {
    active: true,
    code,
    detectedAt: new Date().toISOString(),
    message,
    network,
    status: "fault",
    ...details,
  };
}

export async function proofIndexCanonicalTransactionsPayload(
  network,
  indexedThroughBlock,
) {
  const pool = proofIndexPool();
  if (!pool) {
    return null;
  }
  const requestedHeight = Number(indexedThroughBlock);
  const boundedHeight =
    Number.isSafeInteger(requestedHeight) && requestedHeight >= 0
      ? requestedHeight
      : 0;
  const [checkpointResult, stateMeta] = await Promise.all([
    pool.query(
      `
        SELECT
          indexed_through_block,
          payload,
          source_hashes
        FROM proof_indexer.ledger_snapshots
        WHERE network = $1
          AND (
            source_hashes ? 'blockScan'
            OR payload->>'source' = 'proof-indexer-block-scan'
          )
          AND COALESCE(
            NULLIF(payload->>'indexedThroughBlockHash', ''),
            NULLIF(payload->>'blockHash', '')
          ) IS NOT NULL
          AND ($2::integer <= 0 OR indexed_through_block = $2)
        ORDER BY indexed_through_block DESC, generated_at DESC
        LIMIT 1
      `,
      [network, boundedHeight],
    ),
    canonicalStateMetaFromPool(pool, network),
  ]);
  let checkpoint = checkpointResult.rows[0];
  const rebuild = stateMeta.rebuild;
  if (
    !checkpoint &&
    boundedHeight > 0 &&
    rebuild?.network === network &&
    ["active", "complete"].includes(String(rebuild?.status ?? "")) &&
    boundedHeight > Number(rebuild?.bootstrapHeight) &&
    boundedHeight <= Number(rebuild?.indexedThroughBlock)
  ) {
    const blockResult = await pool.query(
      `
        SELECT height, block_hash
        FROM proof_indexer.blocks
        WHERE network = $1
          AND height = $2
          AND canonical = true
        LIMIT 1
      `,
      [network, boundedHeight],
    );
    const block = blockResult.rows[0];
    const blockHash = String(block?.block_hash ?? "").trim().toLowerCase();
    if (
      Number(block?.height) === boundedHeight &&
      /^[0-9a-f]{64}$/u.test(blockHash)
    ) {
      checkpoint = {
        indexed_through_block: boundedHeight,
        payload: { indexedThroughBlockHash: blockHash },
        source_hashes: { blockScan: blockHash },
      };
    }
  }
  const actualHeight = rowNumber(checkpoint, "indexed_through_block");
  const checkpointPayload = objectRecord(checkpoint?.payload);
  const checkpointHash = String(
    checkpointPayload.indexedThroughBlockHash ?? checkpointPayload.blockHash ?? "",
  )
    .trim()
    .toLowerCase();
  let fault = stateMeta.fault;
  if (!rebuild || rebuild.network !== network) {
    fault = canonicalTransactionFault(
      network,
      "CANONICAL_REBUILD_META_MISSING",
      "Canonical rebuild metadata is unavailable for this network.",
    );
  } else if (
    boundedHeight > 0 &&
    (boundedHeight < Number(rebuild.bootstrapHeight) ||
      boundedHeight > Number(rebuild.indexedThroughBlock))
  ) {
    fault = canonicalTransactionFault(
      network,
      "CANONICAL_HEIGHT_OUTSIDE_REBUILD",
      "Requested canonical height is outside the rebuilt range.",
      { requestedHeight: boundedHeight },
    );
  }
  if (!checkpoint || !/^[0-9a-f]{64}$/u.test(checkpointHash)) {
    fault = fault ?? canonicalTransactionFault(
      network,
      "CANONICAL_CHECKPOINT_MISSING",
      "An exact hashed canonical checkpoint is unavailable.",
      { requestedHeight: boundedHeight },
    );
    return {
      checkpointHash: "",
      fault,
      indexedThroughBlock: 0,
      rebuild,
      transactions: [],
    };
  }
  if (fault?.active) {
    return {
      checkpointHash,
      fault,
      indexedThroughBlock: actualHeight,
      rebuild,
      transactions: [],
    };
  }

  const fromHeight = Number(rebuild?.fromHeight);
  const bootstrapHeight = Number(rebuild?.bootstrapHeight);
  const bootstrapHash = String(rebuild?.bootstrapHash ?? "").toLowerCase();
  const chainResult = actualHeight > bootstrapHeight
    ? await pool.query(
        `
          WITH RECURSIVE canonical_chain AS (
            SELECT height, block_hash, previous_block_hash
            FROM proof_indexer.blocks
            WHERE network = $1
              AND height = $2
              AND block_hash = $3
              AND canonical = true
            UNION ALL
            SELECT previous.height, previous.block_hash, previous.previous_block_hash
            FROM proof_indexer.blocks previous
            JOIN canonical_chain current
              ON previous.network = $1
             AND previous.block_hash = current.previous_block_hash
             AND previous.height = current.height - 1
             AND previous.canonical = true
            WHERE current.height > $4
          )
          SELECT height, block_hash, previous_block_hash
          FROM canonical_chain
          ORDER BY height ASC
        `,
        [network, actualHeight, checkpointHash, fromHeight],
      )
    : { rows: [] };
  const expectedBlockCount = Math.max(0, actualHeight - bootstrapHeight);
  if (
    !Number.isSafeInteger(fromHeight) ||
    !Number.isSafeInteger(bootstrapHeight) ||
    !/^[0-9a-f]{64}$/u.test(bootstrapHash) ||
    chainResult.rows.length !== expectedBlockCount ||
    (expectedBlockCount > 0 &&
      (Number(chainResult.rows[0]?.height) !== fromHeight ||
        String(chainResult.rows[0]?.previous_block_hash ?? "").toLowerCase() !==
          bootstrapHash))
  ) {
    fault = fault ?? canonicalTransactionFault(
      network,
      "CANONICAL_BLOCK_CHAIN_INCOMPLETE",
      "Canonical block lineage does not connect to the rebuild bootstrap.",
      { actualHeight, fromHeight },
    );
  }
  const canonicalBlocks = new Map(
    chainResult.rows.map((row) => [
      Number(row.height),
      String(row.block_hash ?? "").toLowerCase(),
    ]),
  );

  const transactionsResult = await pool.query(
    `
      SELECT
        txid,
        block_hash,
        block_height,
        block_time,
        fee_sats,
        locktime,
        raw_tx
      FROM proof_indexer.transactions
      WHERE network = $1
        AND status = 'confirmed'
        AND block_height BETWEEN $2 AND $3
        AND jsonb_typeof(raw_tx->'canonicalBlockScan') = 'object'
        AND raw_tx->'canonicalBlockScan'->>'network' = $1
      ORDER BY
        block_height ASC,
        CASE
          WHEN raw_tx->>'_powBlockIndex' ~ '^[0-9]+$'
            THEN (raw_tx->>'_powBlockIndex')::integer
          ELSE 2147483647
        END ASC,
        txid ASC
    `,
    [network, fromHeight, actualHeight],
  );
  const transactions = [];
  const positions = new Set();
  try {
    for (const row of transactionsResult.rows) {
      if (canonicalBlocks.get(Number(row.block_height)) !== row.block_hash) {
        throw new Error(`Transaction ${row.txid} is not on the checkpoint chain.`);
      }
      const transaction = canonicalRawTransactionFromRow(row, network);
      const position = `${transaction.height}:${transaction._powBlockIndex}`;
      if (positions.has(position)) {
        throw new Error(`Duplicate canonical transaction position ${position}.`);
      }
      positions.add(position);
      transactions.push(transaction);
    }
  } catch (error) {
    fault = fault ?? canonicalTransactionFault(
      network,
      "CANONICAL_RAW_TRANSACTION_INVALID",
      error?.message ?? String(error),
    );
  }
  return {
    checkpointHash,
    fault,
    indexedThroughBlock: actualHeight,
    rebuild,
    transactions: fault?.active ? [] : transactions,
  };
}

function tokenDefinitionFromRow(row) {
  const metadata = objectRecord(row?.metadata);
  const tokenId = String(row?.token_id ?? metadata.tokenId ?? "")
    .trim()
    .toLowerCase();
  const ticker = String(row?.ticker ?? metadata.ticker ?? "").trim();
  return {
    ...metadata,
    blockHeight:
      rowNumber(row, "created_height") || rowNumber(metadata, "blockHeight"),
    confirmed:
      typeof row?.confirmed === "boolean" ? row.confirmed : metadata.confirmed === true,
    createdAt: dateIso(
      metadata.createdAt ??
        metadata.timestamp ??
        metadata.blockTime ??
        metadata.confirmedAt ??
        row?.created_at,
    ),
    creationFeeSats:
      rowNumber(metadata, "creationFeeSats") ||
      rowNumber(metadata, "paidSats") ||
      rowNumber(metadata, "amountSats"),
    creatorAddress: row?.creator_address ?? metadata.creatorAddress ?? "",
    maxSupply: rowNumber(row, "max_supply") || rowNumber(metadata, "maxSupply"),
    mintAmount: rowNumber(row, "mint_amount") || rowNumber(metadata, "mintAmount"),
    mintPriceSats:
      rowNumber(row, "mint_price_sats") || rowNumber(metadata, "mintPriceSats"),
    registryAddress: row?.registry_address ?? metadata.registryAddress ?? "",
    ticker,
    tokenId,
    txid: String(row?.create_txid ?? metadata.txid ?? tokenId).trim().toLowerCase(),
  };
}

function tokenStateScopeSql(scope, columnSql, tickerSql) {
  if (!scope || scope === "all") {
    return "";
  }
  return `AND (lower(${columnSql}) = $2 OR lower(${tickerSql}) = lower($2))`;
}

async function proofIndexTokenDefinitionsFromTables(pool, network, scope) {
  const scoped = scope && scope !== "all";
  const result = await pool.query(
    `
      SELECT
        token_id,
        ticker,
        creator_address,
        registry_address,
        max_supply,
        mint_amount,
        mint_price_sats,
        create_txid,
        confirmed,
        created_height,
        metadata
      FROM proof_indexer.credit_definitions
      WHERE network = $1
        ${tokenStateScopeSql(scope, "token_id", "ticker")}
      ORDER BY upper(ticker), token_id
    `,
    scoped ? [network, scope] : [network],
  );
  return result.rows.map(tokenDefinitionFromRow).filter((token) => token.tokenId);
}

async function proofIndexTokenHoldersFromTables(pool, network, tokenIds, scope) {
  const scoped = scope && scope !== "all";
  if (scoped && tokenIds.length === 0) {
    return [];
  }
  const result = await pool.query(
    `
      SELECT
        cb.address,
        cb.confirmed_balance,
        cb.pending_delta,
        cb.token_id,
        cb.updated_at,
        cd.ticker,
        cd.registry_address
      FROM proof_indexer.credit_balances cb
      JOIN proof_indexer.credit_definitions cd
        ON cd.network = cb.network
       AND cd.token_id = cb.token_id
      WHERE cb.network = $1
        AND cb.confirmed_balance > 0
        ${
          scoped
            ? "AND cb.token_id = ANY($2::text[])"
            : ""
        }
      ORDER BY cb.confirmed_balance DESC, cb.address ASC, cb.token_id ASC
    `,
    scoped ? [network, tokenIds] : [network],
  );
  return result.rows
    .map((row) => ({
      address: row.address,
      balance: Number(row.confirmed_balance ?? 0),
      pendingDelta: Number(row.pending_delta ?? 0),
      registryAddress: row.registry_address ?? "",
      ticker: row.ticker ?? "",
      tokenId: String(row.token_id ?? "").trim().toLowerCase(),
      updatedAt: dateIso(row.updated_at),
    }))
    .filter((holder) => holder.address && holder.tokenId && holder.balance > 0);
}

function tokenMetricSummariesFromHolders(holders) {
  const summaries = new Map();
  for (const holder of Array.isArray(holders) ? holders : []) {
    const tokenId = String(holder?.tokenId ?? "").trim().toLowerCase();
    if (!tokenId) {
      continue;
    }
    const current = summaries.get(tokenId) ?? {
      confirmedSupply: 0,
      holderCount: 0,
      pendingSupply: 0,
    };
    current.confirmedSupply += Number(holder.balance ?? 0);
    current.pendingSupply += Number(holder.pendingDelta ?? 0);
    current.holderCount += Number(holder.balance ?? 0) > 0 ? 1 : 0;
    summaries.set(tokenId, current);
  }
  return summaries;
}

function tokenListingFromCreditListingRow(row, network) {
  const payload = objectRecord(row?.payload);
  const saleAuthorization = objectRecord(payload.saleAuthorization);
  const status = String(row?.status ?? payload.status ?? "").trim().toLowerCase();
  const listingId = String(row?.listing_id ?? payload.listingId ?? "")
    .trim()
    .toLowerCase();
  const sealTxid = String(row?.seal_txid ?? payload.sealTxid ?? "")
    .trim()
    .toLowerCase();
  const closeTxid = tokenListingEffectiveCloseTxid(
    row,
    payload,
    status,
    sealTxid,
  );
  return normalizeTokenHistoryListingItem({
    ...payload,
    amount: rowNumber(row, "amount") || rowNumber(payload, "amount"),
    buyerAddress: row?.buyer_address ?? payload.buyerAddress,
    closeTxid,
    closedAt: dateIso(payload.closedAt ?? payload.closeAt ?? row?.updated_at),
    closedConfirmed: ["sold", "delisted"].includes(status) && validTxid(closeTxid),
    closedTxid: closeTxid,
    confirmed: status !== "pending",
    createdAt: dateIso(
      payload.createdAt ??
        payload.blockTime ??
        payload.timestamp ??
        row?.updated_at,
    ),
    listingId,
    network,
    priceSats: rowNumber(row, "price_sats") || rowNumber(payload, "priceSats"),
    registryAddress:
      payload.registryAddress ??
      row?.registry_address ??
      saleAuthorization.registryAddress,
    saleAuthorization,
    saleTicketTxid: tokenListingEffectiveSaleTicketTxid(
      row,
      payload,
      saleAuthorization,
      listingId,
      sealTxid,
    ),
    saleTicketValueSats:
      rowNumber(row, "sale_ticket_value_sats") ||
      rowNumber(payload, "saleTicketValueSats") ||
      rowNumber(saleAuthorization, "saleTicketValueSats"),
    saleTicketVout:
      row?.sale_ticket_vout ?? payload.saleTicketVout ?? saleAuthorization.saleTicketVout,
    sealAt: dateIso(payload.sealAt ?? payload.sealedAt ?? row?.updated_at),
    sealConfirmed:
      payload.sealConfirmed === true ||
      (validTxid(sealTxid) && ["sealing", "sold"].includes(status)),
    sealTxid,
    sellerAddress: row?.seller_address ?? payload.sellerAddress,
    status,
    ticker: row?.ticker ?? payload.ticker ?? saleAuthorization.ticker,
    tokenId:
      row?.token_id ?? payload.tokenId ?? saleAuthorization.tokenId,
    txid: listingId,
  });
}

async function proofIndexTokenListingsFromTables(pool, network, scope) {
  const scoped = scope && scope !== "all";
  const result = await pool.query(
    `
      SELECT
        cl.listing_id,
        cl.status,
        cl.token_id,
        cl.seller_address,
        cl.buyer_address,
        cl.amount,
        cl.price_sats,
        cl.sale_ticket_txid,
        cl.sale_ticket_vout,
        cl.sale_ticket_value_sats,
        cl.seal_txid,
        cl.close_txid,
        cl.payload,
        cl.updated_at,
        cd.ticker,
        cd.registry_address
      FROM proof_indexer.credit_listings cl
      LEFT JOIN proof_indexer.credit_definitions cd
        ON cd.network = cl.network
       AND cd.token_id = cl.token_id
      WHERE cl.network = $1
        ${tokenStateScopeSql(scope, "cl.token_id", "cd.ticker")}
      ORDER BY cl.updated_at DESC, cl.listing_id ASC
      LIMIT ${TOKEN_STATE_EVENT_READ_LIMIT}
    `,
    scoped ? [network, scope] : [network],
  );
  const listings = [];
  const closedListings = [];
  const sales = [];
  for (const row of result.rows) {
    const listing = tokenListingFromCreditListingRow(row, network);
    if (!listing?.listingId || !listing?.tokenId) {
      continue;
    }
    if (["active", "sealing", "pending"].includes(String(row.status))) {
      if (activeTokenListingHistoryItem(listing)) {
        listings.push(listing);
      }
      continue;
    }

    if (["sold", "delisted"].includes(String(row.status))) {
      const closedListing = {
        ...listing,
        closedAt: listing.closedAt ?? listing.createdAt,
        closedConfirmed: true,
        closedTxid: listing.closedTxid || listing.closeTxid,
        confirmed: true,
      };
      if (closedListing.closedTxid && closedListing.listingId) {
        closedListings.push(closedListing);
      }
      if (String(row.status) === "sold" && closedListing.closedTxid) {
        sales.push({
          ...closedListing,
          buyerAddress: listing.buyerAddress ?? "",
          confirmed: true,
          createdAt: closedListing.closedAt ?? listing.createdAt,
          paidSats: listing.priceSats,
          txid: closedListing.closedTxid,
        });
      }
    }
  }
  return {
    closedListings,
    listings,
    sales,
  };
}

async function proofIndexTokenTransferEventsFromTables(pool, network, scope) {
  const scoped = scope && scope !== "all";
  const result = await pool.query(
    `
      SELECT
        e.network,
        e.txid,
        e.protocol,
        e.kind,
        e.status,
        e.valid,
        e.amount_sats,
        e.block_height,
        e.block_time,
        e.event_time,
        e.created_at,
        e.payload,
        cd.ticker,
        cd.registry_address,
        COALESCE(cd.token_id, lower(e.payload->>'tokenId')) AS token_id
      FROM proof_indexer.events e
      LEFT JOIN proof_indexer.credit_definitions cd
        ON cd.network = e.network
       AND cd.token_id = lower(e.payload->>'tokenId')
      WHERE e.network = $1
        AND e.valid IS DISTINCT FROM false
        AND e.kind = 'token-transfer'
        ${tokenStateScopeSql(scope, "COALESCE(cd.token_id, lower(e.payload->>'tokenId'))", "cd.ticker")}
      ORDER BY
        COALESCE(e.event_time, e.block_time, e.created_at) DESC,
        e.txid DESC,
        e.event_id DESC
      LIMIT ${TOKEN_STATE_EVENT_READ_LIMIT}
    `,
    scoped ? [network, scope] : [network],
  );
  return result.rows
    .map((row) =>
      tokenTransferFromEventPayload(
        normalizeEventPayload(canonicalEventPayload(row.payload), row),
        row,
      ),
    )
    .filter(
      (item) =>
        item.txid &&
        item.tokenId &&
        item.amount > 0 &&
        (item.senderAddress || item.recipientAddress),
    )
    .sort(compareTokenItemsByTime);
}

function tokenInvalidEventFromRow(row) {
  const payload = normalizeEventPayload(
    canonicalEventPayload(row?.payload),
    row,
  );
  const participantDetails = (Array.isArray(row?.participants)
    ? row.participants
    : []
  )
    .map((participant) => ({
      address: String(participant?.address ?? "").trim(),
      powid: String(participant?.powid ?? "").trim(),
      role: String(participant?.role ?? "").trim().toLowerCase(),
    }))
    .filter((participant) => participant.address);
  const payloadParticipants = (Array.isArray(payload.participants)
    ? payload.participants
    : []
  )
    .map((participant) =>
      String(
        participant && typeof participant === "object"
          ? participant.address
          : participant,
      ).trim(),
    )
    .filter(Boolean);
  const participants = [
    ...new Set([
      ...payloadParticipants,
      ...participantDetails.map((participant) => participant.address),
    ]),
  ];
  const addressForRoles = (...roles) =>
    participantDetails.find((participant) => roles.includes(participant.role))
      ?.address ?? "";
  const firstText = (...values) =>
    values.map((value) => String(value ?? "").trim()).find(Boolean) ?? "";
  const effectiveStatus = String(
    row?.effective_status ?? row?.status ?? payload.status ?? "",
  )
    .trim()
    .toLowerCase();
  const validationErrors = Array.isArray(row?.validation_errors)
    ? row.validation_errors.map(String).filter(Boolean)
    : [];
  const senderAddress = firstText(
    payload.senderAddress,
    payload.from,
    payload.actor,
    addressForRoles("sender", "actor"),
  );
  const recipientAddress = firstText(
    payload.recipientAddress,
    payload.to,
    payload.counterparty,
    addressForRoles("recipient", "counterparty"),
  );
  const registryAddress = firstText(
    payload.registryAddress,
    row?.registry_address,
    addressForRoles("registry"),
  );

  return {
    ...payload,
    amount:
      rowNumber(payload, "amount") || rowNumber(payload, "tokenAmount"),
    blockHash: String(row?.block_hash ?? payload.blockHash ?? "")
      .trim()
      .toLowerCase(),
    blockHeight:
      rowNumber(row, "transaction_block_height") ||
      rowNumber(row, "block_height") ||
      rowNumber(payload, "blockHeight"),
    confirmed: effectiveStatus === "confirmed",
    createdAt: dateIso(
      payload.createdAt ??
        row?.transaction_block_time ??
        row?.block_time ??
        row?.event_time ??
        row?.created_at,
    ),
    kind: String(payload.kind ?? row?.kind ?? "token-event-invalid")
      .trim()
      .toLowerCase(),
    network: payload.network ?? row?.network,
    participantDetails,
    participants,
    protocol: String(payload.protocol ?? row?.protocol ?? "pwt1")
      .trim()
      .toLowerCase(),
    reason: String(payload.reason ?? validationErrors[0] ?? "").trim(),
    recipientAddress,
    registryAddress,
    senderAddress,
    status: effectiveStatus,
    ticker: String(row?.ticker ?? payload.ticker ?? "").trim(),
    tokenId: String(payload.tokenId ?? row?.token_id ?? "")
      .trim()
      .toLowerCase(),
    txid: String(payload.txid ?? row?.txid ?? "").trim().toLowerCase(),
    valid: false,
    validationErrors,
  };
}

function tokenInvalidEventSelectSql() {
  return `
    e.network,
    e.txid,
    e.protocol,
    e.kind,
    e.status,
    e.valid,
    e.validation_errors,
    e.block_height,
    e.block_time,
    e.event_time,
    e.created_at,
    e.payload,
    t.status AS effective_status,
    t.block_hash,
    t.block_height AS transaction_block_height,
    t.block_time AS transaction_block_time,
    cd.ticker,
    cd.registry_address,
    COALESCE(
      cd.token_id,
      cl_invalid.token_id,
      lower(e.payload->>'tokenId')
    ) AS token_id,
    COALESCE(
      (
        SELECT jsonb_agg(
          jsonb_build_object(
            'address', ep.address,
            'role', ep.role,
            'powid', ep.powid
          )
          ORDER BY ep.role, ep.address
        )
        FROM proof_indexer.event_participants ep
        WHERE ep.event_id = e.event_id
      ),
      '[]'::jsonb
    ) AS participants
  `;
}

function tokenInvalidEventQueryParts(
  network,
  tokenScope,
  searchParams = new URLSearchParams(),
  pagination = { query: "" },
) {
  const scope = tokenScopeKey(tokenScope);
  const params = [network];
  const conditions = [
    "e.network = $1",
    "e.protocol = 'pwt1'",
    "e.status = 'confirmed'",
    "t.status = 'confirmed'",
    "(e.valid = false OR e.kind = 'token-event-invalid')",
  ];

  if (scope && scope !== "all") {
    params.push(scope);
    const scopeParam = `$${params.length}`;
    conditions.push(`(
      lower(e.payload->>'tokenId') = ${scopeParam}
      OR lower(cl_invalid.token_id) = ${scopeParam}
      OR lower(cd.token_id) = ${scopeParam}
      OR lower(cd.ticker) = lower(${scopeParam})
      OR lower(e.payload->>'ticker') = lower(${scopeParam})
    )`);
  }

  const needles = tokenHistoryFilterNeedles(searchParams, pagination);
  const txidNeedles = [
    ...new Set(needles.map(normalizedTxid).filter(Boolean)),
  ];
  if (txidNeedles.length > 0) {
    params.push(txidNeedles);
    const txidParam = `$${params.length}`;
    conditions.push(`(
        lower(e.txid) = ANY(${txidParam}::text[])
        OR lower(e.payload->>'txid') = ANY(${txidParam}::text[])
        OR EXISTS (
          SELECT 1
          FROM proof_indexer.event_refs erq
          WHERE erq.event_id = e.event_id
            AND lower(erq.ref_value) = ANY(${txidParam}::text[])
        )
      )`);
  }

  for (const needle of needles.filter((value) => !normalizedTxid(value))) {
    params.push(`%${needle}%`);
    const needleParam = `$${params.length}`;
    conditions.push(`(
      lower(e.txid) LIKE ${needleParam}
      OR lower(e.payload::text) LIKE ${needleParam}
      OR lower(COALESCE(cd.token_id, '')) LIKE ${needleParam}
      OR lower(COALESCE(cd.ticker, '')) LIKE ${needleParam}
      OR lower(COALESCE(cd.registry_address, '')) LIKE ${needleParam}
      OR EXISTS (
        SELECT 1
        FROM proof_indexer.event_participants epq
        WHERE epq.event_id = e.event_id
          AND (
            lower(epq.address) LIKE ${needleParam}
            OR lower(COALESCE(epq.powid, '')) LIKE ${needleParam}
          )
      )
      OR EXISTS (
        SELECT 1
        FROM proof_indexer.event_refs erq
        WHERE erq.event_id = e.event_id
          AND lower(erq.ref_value) LIKE ${needleParam}
      )
    )`);
  }

  return {
    fromSql: `
      FROM proof_indexer.events e
      JOIN proof_indexer.transactions t
        ON t.network = e.network
       AND t.txid = e.txid
      LEFT JOIN proof_indexer.credit_listings cl_invalid
        ON cl_invalid.network = e.network
       AND cl_invalid.listing_id = lower(e.payload->>'listingId')
      LEFT JOIN proof_indexer.credit_definitions cd
        ON cd.network = e.network
       AND cd.token_id = COALESCE(
         lower(e.payload->>'tokenId'),
         cl_invalid.token_id
       )
      WHERE ${conditions.join(" AND ")}
    `,
    params,
  };
}

async function proofIndexTokenInvalidEventsFromTables(pool, network, scope) {
  const query = tokenInvalidEventQueryParts(network, scope);
  const result = await pool.query(
    `
      SELECT
        ${tokenInvalidEventSelectSql()}
      ${query.fromSql}
      ORDER BY
        COALESCE(t.block_time, e.event_time, e.block_time, e.created_at) DESC,
        e.txid DESC,
        e.event_id DESC
      LIMIT ${TOKEN_STATE_EVENT_READ_LIMIT}
    `,
    query.params,
  );
  return result.rows
    .map(tokenInvalidEventFromRow)
    .filter((item) => item.txid && item.confirmed && item.valid === false)
    .sort(compareTokenItemsByTime);
}

async function proofIndexTokenMarketEventsFromTables(pool, network, scope) {
  const scoped = scope && scope !== "all";
  const result = await pool.query(
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
        e.event_id,
        COALESCE(cd.token_id, cl_event.token_id) AS token_id,
        cd.ticker,
        cd.registry_address,
        cl_event.listing_id AS linked_listing_id,
        cl_event.seller_address AS listing_seller_address,
        cl_event.buyer_address AS listing_buyer_address,
        cl_event.amount AS listing_amount,
        cl_event.price_sats AS listing_price_sats,
        cl_event.payload AS listing_payload
      FROM proof_indexer.events e
      LEFT JOIN proof_indexer.credit_listings cl_event
        ON cl_event.network = e.network
       AND cl_event.listing_id = lower(e.payload->>'listingId')
      LEFT JOIN proof_indexer.credit_definitions cd
        ON cd.network = e.network
       AND cd.token_id = COALESCE(lower(e.payload->>'tokenId'), cl_event.token_id)
      WHERE e.network = $1
        AND e.valid IS DISTINCT FROM false
        AND e.kind = ANY(ARRAY['token-sale','token-listing-closed']::text[])
        ${tokenStateScopeSql(scope, "COALESCE(cd.token_id, cl_event.token_id)", "cd.ticker")}
      ORDER BY
        COALESCE(e.event_time, e.block_time, e.created_at) DESC,
        e.txid DESC,
        e.event_id DESC
      LIMIT ${TOKEN_STATE_EVENT_READ_LIMIT}
    `,
    scoped ? [network, scope] : [network],
  );

  const closedListings = [];
  const sales = [];
  for (const row of result.rows) {
    const payload = tokenMarketEventRowPayload(row, network);
    if (payload?.kind === "token-sale") {
      const sale = tokenSaleFromEventPayload(payload);
      if (sale.txid && sale.listingId && sale.tokenId) {
        sales.push(sale);
        const closedListing = tokenClosedListingFromSalePayload(sale);
        if (closedListing) {
          closedListings.push(closedListing);
        }
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

  return {
    closedListings: closedListings.sort(compareTokenItemsByTime),
    sales: sales.sort(compareTokenItemsByTime),
  };
}

function uniqueTokenItems(items, keyForItem, mergeItems = null) {
  const merged = new Map();
  for (const item of Array.isArray(items) ? items : []) {
    const key = keyForItem(item);
    if (!key) {
      continue;
    }
    const current = merged.get(key);
    if (current && typeof mergeItems === "function") {
      merged.set(key, mergeItems(current, item));
      continue;
    }
    if (
      !current ||
      (item.confirmed && !current.confirmed) ||
      Date.parse(item.createdAt ?? item.closedAt ?? "") >
        Date.parse(current.createdAt ?? current.closedAt ?? "")
    ) {
      merged.set(key, item);
    }
  }
  return [...merged.values()].sort(compareTokenItemsByTime);
}

async function proofIndexTokenPayloadFromCurrentTables(pool, network, scope) {
  const tokens = await proofIndexTokenDefinitionsFromTables(pool, network, scope);
  if (tokens.length === 0) {
    return null;
  }

  const tokenIds = tokens.map((token) => token.tokenId);
  const [
    holders,
    mintRows,
    listingProjection,
    transfers,
    invalidEvents,
    marketEvents,
    scan,
  ] = await Promise.all([
    proofIndexTokenHoldersFromTables(pool, network, tokenIds, scope),
    proofIndexTokenMintRows(
      pool,
      network,
      scope,
      new URLSearchParams(),
      {
        limit: TOKEN_STATE_EVENT_READ_LIMIT,
        offset: 0,
        page: 0,
        query: "",
        snapshotId: "",
      },
    ),
    proofIndexTokenListingsFromTables(pool, network, scope),
    proofIndexTokenTransferEventsFromTables(pool, network, scope),
    proofIndexTokenInvalidEventsFromTables(pool, network, scope),
    proofIndexTokenMarketEventsFromTables(pool, network, scope),
    latestProofIndexScanMetadata(pool, network),
  ]);

  const mints = mintRows
    .map((row) =>
      tokenMintFromEventPayload(
        normalizeEventPayload(canonicalEventPayload(row.payload), row),
        row,
      ),
    )
    .filter((item) => item.txid && item.tokenId && item.amount > 0)
    .sort(compareTokenItemsByTime);
  const holderSummaries = tokenMetricSummariesFromHolders(holders);
  const mintSummaries = new Map();
  for (const mint of mints) {
    const current = mintSummaries.get(mint.tokenId) ?? {
      confirmedMints: 0,
      confirmedSupply: 0,
      pendingMints: 0,
      pendingSupply: 0,
    };
    if (mint.confirmed) {
      current.confirmedMints += 1;
      current.confirmedSupply += Number(mint.amount ?? 0);
    } else {
      current.pendingMints += 1;
      current.pendingSupply += Number(mint.amount ?? 0);
    }
    mintSummaries.set(mint.tokenId, current);
  }

  const enrichedTokens = tokens.map((token) => {
    const holderSummary = holderSummaries.get(token.tokenId) ?? {};
    const mintSummary = mintSummaries.get(token.tokenId) ?? {};
    return {
      ...token,
      confirmedMints: mintSummary.confirmedMints ?? 0,
      confirmedSupply: Math.max(
        Number(holderSummary.confirmedSupply ?? 0),
        Number(mintSummary.confirmedSupply ?? 0),
      ),
      holderCount: holderSummary.holderCount ?? 0,
      pendingMints: mintSummary.pendingMints ?? 0,
      pendingSupply: Math.max(
        Number(holderSummary.pendingSupply ?? 0),
        Number(mintSummary.pendingSupply ?? 0),
      ),
    };
  });

  const listings = uniqueTokenItems(
    listingProjection.listings,
    (listing) => `${listing.network ?? network}:${listing.listingId}`,
  );
  const sales = uniqueTokenItems(
    [...marketEvents.sales, ...listingProjection.sales],
    (sale) => `${sale.network ?? network}:${sale.txid}`,
  );
  const closedListings = uniqueTokenItems(
    [...marketEvents.closedListings, ...listingProjection.closedListings],
    (listing) =>
      `${listing.network ?? network}:${listing.listingId}:${listing.closedTxid ?? listing.txid}`,
    mergeTokenListingRecord,
  );
  const confirmedSupply = holders.reduce(
    (total, holder) => total + Number(holder.balance ?? 0),
    0,
  );
  const mintedConfirmedSupply = enrichedTokens.reduce(
    (total, token) => total + Number(token.confirmedSupply ?? 0),
    0,
  );
  const pendingSupply = Math.max(
    holders.reduce((total, holder) => total + Number(holder.pendingDelta ?? 0), 0),
    mints
      .filter((mint) => !mint.confirmed)
      .reduce((total, mint) => total + Number(mint.amount ?? 0), 0),
  );
  const creationSats = enrichedTokens.reduce(
    (total, token) => total + Number(token.creationFeeSats ?? 0),
    0,
  );
  const indexedThroughBlock = Math.max(
    rowNumber(scan, "indexed_through_block"),
    indexedThroughBlockFromItems(mints) ?? 0,
    indexedThroughBlockFromItems(transfers) ?? 0,
    indexedThroughBlockFromItems(invalidEvents) ?? 0,
    indexedThroughBlockFromItems(sales) ?? 0,
    indexedThroughBlockFromItems(closedListings) ?? 0,
  );
  const indexedAt = newestDateIso([
    scan?.generated_at,
    ...holders.map((holder) => holder.updatedAt),
    ...mints.map((mint) => mint.createdAt),
    ...transfers.map((transfer) => transfer.createdAt),
    ...invalidEvents.map((event) => event.createdAt),
    ...sales.map((sale) => sale.createdAt),
    ...closedListings.map((listing) => listing.closedAt ?? listing.createdAt),
  ]);
  const payload = {
    closedListings,
    creationPriceSats: 0,
    creationSats,
    confirmedSupply: Math.max(confirmedSupply, mintedConfirmedSupply),
    holders,
    indexAddress: "",
    indexId: "",
    indexTxid: "",
    indexedAt,
    indexedThroughBlock: indexedThroughBlock || undefined,
    invalidEvents,
    listings,
    minMutationPriceSats: TOKEN_LISTING_ANCHOR_VALUE_SATS,
    mints,
    network,
    pendingSupply,
    sales,
    source: "proof-indexer-token-state-tables",
    tokens: enrichedTokens,
    transfers,
  };
  return {
    ...payload,
    stats: {
      ...salesStats(sales),
      ...tokenStateStats(payload, enrichedTokens, mints, transfers, invalidEvents),
      indexedThroughBlock: indexedThroughBlock || undefined,
    },
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
  const currentTablePayload = () =>
    proofIndexTokenPayloadFromCurrentTables(pool, network, eligibility.scope);

  // Stable, unscoped token-state reads are live relational projections. The
  // block scanner updates events and balances atomically, while embedded JSON
  // snapshots are retained only as last-good/pinned audit material.
  const currentPayload = await currentTablePayload();
  if (currentPayload) {
    return currentPayload;
  }

  if (eligibility.scope !== "all") {
    const scopedSnapshot = await tokenStateSnapshotForScope(
      pool,
      network,
      "",
      eligibility.scope,
    );
    const scopedPayload = scopedSnapshot?.scoped_payload;
    if (
      scopedSnapshot &&
      tokenStateSnapshotAgeMs(scopedSnapshot) <= proofIndexTokenHistoryMaxAgeMs() &&
      scopedPayload &&
      typeof scopedPayload === "object"
    ) {
      return tokenStateWithMintEventOverlay(
        pool,
        network,
        eligibility.scope,
        tokenStateWithSnapshotMetadata(
          scopedPayload,
          scopedSnapshot,
          "proof-indexer-token-state-snapshot",
        ),
        scopedSnapshot,
      );
    }
  }

  const snapshot = await ledgerSnapshotWithPayload(
    pool,
    network,
    "",
    "tokenStatePayloads",
  );
  if (
    !snapshot ||
    tokenStateSnapshotAgeMs(snapshot) > proofIndexTokenHistoryMaxAgeMs()
  ) {
    return currentTablePayload();
  }

  const statePayloads = tokenStatePayloadsFromSnapshot(snapshot);
  if (!statePayloads) {
    return currentTablePayload();
  }

  const scopedPayload = statePayloads[eligibility.scope];
  if (scopedPayload && typeof scopedPayload === "object") {
    return tokenStateWithMintEventOverlay(
      pool,
      network,
      eligibility.scope,
      tokenStateWithSnapshotMetadata(
        scopedPayload,
        snapshot,
        "proof-indexer-token-state-snapshot",
      ),
      snapshot,
    );
  }

  const allPayload = statePayloads.all;
  if (!allPayload || typeof allPayload !== "object") {
    return currentTablePayload();
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
  if (!reconstructed) {
    return currentTablePayload();
  }
  return tokenStateWithMintEventOverlay(
    pool,
    network,
    eligibility.scope,
    tokenStateWithSnapshotMetadata(
      reconstructed,
      snapshot,
      "proof-indexer-token-state-snapshot",
    ),
    snapshot,
  );
}

export async function proofIndexTokenSnapshotPayload(
  network,
  tokenScope,
  searchParams,
) {
  const pool = proofIndexPool();
  if (!pool) {
    return null;
  }
  const eligibility = proofIndexTokenReadEligibility(tokenScope, searchParams);
  if (!eligibility.eligible) {
    return null;
  }

  if (eligibility.scope !== "all") {
    const scopedSnapshot = await tokenStateSnapshotForScope(
      pool,
      network,
      "",
      eligibility.scope,
    );
    const scopedPayload = scopedSnapshot?.scoped_payload;
    if (
      scopedSnapshot &&
      tokenStateSnapshotAgeMs(scopedSnapshot) <= proofIndexTokenHistoryMaxAgeMs() &&
      scopedPayload &&
      typeof scopedPayload === "object"
    ) {
      return tokenStateWithSnapshotMetadata(
        scopedPayload,
        scopedSnapshot,
        "proof-indexer-token-state-snapshot",
      );
    }
  }

  const snapshot = await ledgerSnapshotWithPayload(
    pool,
    network,
    "",
    "tokenStatePayloads",
  );
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
    `(EXISTS (
      SELECT 1
      FROM proof_indexer.event_participants ep
      WHERE ep.event_id = e.event_id
        AND lower(ep.address) = ANY($2::text[])
    )
      OR lower(e.payload->>'actor') = ANY($2::text[])
      OR lower(e.payload->>'counterparty') = ANY($2::text[])
      OR lower(e.payload->>'senderAddress') = ANY($2::text[])
      OR lower(e.payload->>'recipientAddress') = ANY($2::text[])
      OR lower(e.payload->>'sellerAddress') = ANY($2::text[])
      OR lower(e.payload->>'buyerAddress') = ANY($2::text[])
      OR lower(e.payload->'saleAuthorization'->>'sellerAddress') = ANY($2::text[])
      OR lower(e.payload->'saleAuthorization'->>'buyerAddress') = ANY($2::text[]))`,
    `(
      e.kind NOT IN ('token-listings', 'token-listing')
      OR NOT EXISTS (
        SELECT 1
        FROM proof_indexer.events close_event
        WHERE close_event.network = e.network
          AND close_event.valid = true
          AND close_event.kind = ANY(ARRAY['token-listing-closed','token-sale']::text[])
          AND lower(close_event.payload->>'listingId') = lower(e.payload->>'listingId')
      )
    )`,
  ];
  const eventParams = [network, addressNeedles];
  if (scoped) {
    eventParams.push(scope);
    const scopeParam = `$${eventParams.length}`;
    eventConditions.push(
      `(
        lower(e.payload->>'tokenId') = ${scopeParam}
        OR lower(e.payload->'saleAuthorization'->>'tokenId') = ${scopeParam}
        OR lower(cl_event.token_id) = ${scopeParam}
        OR lower(cd.token_id) = ${scopeParam}
        OR lower(cd.ticker) = lower(${scopeParam})
        OR lower(e.payload->>'ticker') = lower(${scopeParam})
        OR lower(e.payload->'saleAuthorization'->>'ticker') = lower(${scopeParam})
      )`,
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
        COALESCE(cd.token_id, cl_event.token_id) AS token_id,
        cd.ticker,
        cd.registry_address,
        cl_event.listing_id AS linked_listing_id,
        cl_event.seller_address AS listing_seller_address,
        cl_event.buyer_address AS listing_buyer_address,
        cl_event.amount AS listing_amount,
        cl_event.price_sats AS listing_price_sats,
        cl_event.payload AS listing_payload
      FROM proof_indexer.events e
      LEFT JOIN proof_indexer.credit_listings cl_event
        ON cl_event.network = e.network
       AND cl_event.listing_id = lower(e.payload->>'listingId')
      LEFT JOIN proof_indexer.credit_definitions cd
        ON cd.network = e.network
       AND cd.token_id = COALESCE(lower(e.payload->>'tokenId'), cl_event.token_id)
      WHERE ${eventWhere}
        AND e.kind IN (
          'token-transfer',
          'token-sale',
          'token-listings',
          'token-listing',
          'token-listing-closed'
        )
      ORDER BY
        COALESCE(e.event_time, e.block_time, e.created_at) DESC,
        e.txid DESC,
        e.event_id DESC
      LIMIT ${eventLimitParam}
    `,
    eventParamsWithLimit,
  );

  const listingConditions = [
    "cl.network = $1",
    "lower(cl.seller_address) = ANY($2::text[])",
    "cl.status IN ('active', 'sealing', 'pending')",
  ];
  const listingParams = [network, addressNeedles];
  if (scoped) {
    listingParams.push(scope);
    const scopeParam = `$${listingParams.length}`;
    listingConditions.push(
      `(lower(cl.token_id) = ${scopeParam} OR lower(cd.ticker) = lower(${scopeParam}))`,
    );
  }
  const listingResult = await pool.query(
    `
      SELECT
        cl.listing_id,
        cl.status,
        cl.token_id,
        cl.seller_address,
        cl.buyer_address,
        cl.amount,
        cl.price_sats,
        cl.sale_ticket_txid,
        cl.sale_ticket_vout,
        cl.sale_ticket_value_sats,
        cl.seal_txid,
        cl.close_txid,
        cl.payload,
        cl.updated_at,
        cd.ticker,
        cd.registry_address
      FROM proof_indexer.credit_listings cl
      LEFT JOIN proof_indexer.credit_definitions cd
        ON cd.network = cl.network
       AND cd.token_id = cl.token_id
      WHERE ${listingConditions.join(" AND ")}
      ORDER BY cl.updated_at DESC, cl.listing_id ASC
      LIMIT 500
    `,
    listingParams,
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
  const listings = [];
  const closedListings = [];
  for (const row of eventResult.rows) {
    const payload = normalizeEventPayload(canonicalEventPayload(row.payload), row);
    if (payload?.kind === "token-listing" || payload?.kind === "token-listings") {
      const listing = tokenListingFromEventPayload(payload);
      if (activeTokenListingHistoryItem(listing)) {
        listings.push(listing);
      }
      continue;
    }
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
      const listingPayload =
        row.listing_payload &&
        typeof row.listing_payload === "object" &&
        !Array.isArray(row.listing_payload)
          ? row.listing_payload
          : {};
      const sale = tokenSaleFromEventPayload({
        ...listingPayload,
        ...payload,
        amount:
          payload.amount ??
          payload.tokenAmount ??
          listingPayload.amount ??
          row.listing_amount,
        listingId:
          payload.listingId ?? listingPayload.listingId ?? row.linked_listing_id,
        priceSats:
          payload.priceSats ??
          payload.salePriceSats ??
          listingPayload.priceSats ??
          row.listing_price_sats,
        registryAddress:
          payload.registryAddress ??
          listingPayload.registryAddress ??
          row.registry_address,
        sellerAddress:
          payload.sellerAddress ??
          payload.counterparty ??
          listingPayload.sellerAddress ??
          row.listing_seller_address,
        ticker: payload.ticker ?? listingPayload.ticker ?? row.ticker,
        tokenId:
          payload.tokenId ??
          listingPayload.tokenId ??
          row.token_id,
      });
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
  for (const row of listingResult.rows) {
    const payload =
      row.payload && typeof row.payload === "object" && !Array.isArray(row.payload)
        ? row.payload
        : {};
    const status = String(row.status ?? payload.status ?? "").trim().toLowerCase();
    const sealTxid = String(row.seal_txid ?? payload.sealTxid ?? "")
      .trim()
      .toLowerCase();
    const saleAuthorization = objectRecord(payload.saleAuthorization);
    const listingId = String(row.listing_id ?? payload.listingId ?? "")
      .trim()
      .toLowerCase();
    const closeTxid = tokenListingEffectiveCloseTxid(
      row,
      payload,
      status,
      sealTxid,
    );
    const listing = {
      ...payload,
      amount: rowNumber(row, "amount") || rowNumber(payload, "amount"),
      buyerAddress: row.buyer_address ?? payload.buyerAddress,
      closeTxid,
      confirmed: row.status !== "pending",
      createdAt: dateIso(payload.createdAt ?? row.updated_at),
      listingId,
      network,
      priceSats: rowNumber(row, "price_sats") || rowNumber(payload, "priceSats"),
      registryAddress:
        payload.registryAddress ??
        row.registry_address ??
        saleAuthorization.registryAddress ??
        "",
      saleAuthorization,
      saleTicketTxid: tokenListingEffectiveSaleTicketTxid(
        row,
        payload,
        saleAuthorization,
        listingId,
        sealTxid,
      ),
      saleTicketValueSats:
        rowNumber(row, "sale_ticket_value_sats") ||
        rowNumber(payload, "saleTicketValueSats"),
      saleTicketVout:
        row.sale_ticket_vout ?? payload.saleTicketVout,
      sealAt:
        payload.sealAt ??
        payload.blockTime ??
        payload.timestamp ??
        payload.createdAt ??
        row.updated_at,
      sealConfirmed:
        payload.sealConfirmed === true ||
        (validTxid(sealTxid) && status === "sealing" && row.status !== "pending"),
      sealTxid,
      sellerAddress: row.seller_address ?? payload.sellerAddress ?? "",
      status: row.status ?? payload.status,
      ticker: payload.ticker ?? row.ticker ?? saleAuthorization.ticker ?? "",
      tokenId: String(row.token_id ?? payload.tokenId ?? "")
        .trim()
        .toLowerCase(),
      txid: String(row.listing_id ?? payload.txid ?? "")
        .trim()
        .toLowerCase(),
    };
    if (activeTokenListingHistoryItem(listing)) {
      listings.push(listing);
    }
  }

  const newestTime = [
    ...holderResult.rows.map((row) => row.updated_at),
    ...eventResult.rows.map(
      (row) => row.event_time ?? row.block_time ?? row.created_at,
    ),
    ...listingResult.rows.map((row) => row.updated_at),
  ]
    .map((value) => Date.parse(value))
    .filter(Number.isFinite)
    .reduce((max, value) => Math.max(max, value), 0);

  return {
    holders,
    indexedAt: newestTime ? new Date(newestTime).toISOString() : undefined,
    closedListings: closedListings.sort(compareTokenItemsByTime),
    listings: listings.sort(compareTokenItemsByTime),
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
    indexedThroughBlock:
      tokenHistoryEmbeddedIndexedThroughBlock(snapshot, "holders") ||
      undefined,
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

function confirmedIdRecordFromRow(row, network) {
  const blockHeight =
    rowNumber(row, "registered_height") ||
    rowNumber(row, "block_height") ||
    undefined;
  const blockIndex = Number(row.registration_block_index);
  const registrationEventId = Number(row.registration_event_id);
  return {
    amountSats: ID_REGISTRATION_PRICE_SATS,
    blockHeight,
    blockIndex:
      row.registration_block_index !== null &&
      row.registration_block_index !== undefined &&
      Number.isSafeInteger(blockIndex) &&
      blockIndex >= 0
        ? blockIndex
        : undefined,
    confirmed: true,
    createdAt: dateIso(
      row.confirmed_at ?? row.block_time ?? row.updated_at,
    ),
    id: String(row.display_id || row.id_lower),
    lastEventTxid: String(row.last_event_txid || row.registration_txid),
    network,
    ownerAddress: String(row.owner_address || ""),
    pgpKey: row.pgp_public_key || undefined,
    receiveAddress: String(row.receive_address || row.owner_address || ""),
    registrationEventId:
      row.registration_event_id !== null &&
      row.registration_event_id !== undefined &&
      Number.isSafeInteger(registrationEventId) &&
      registrationEventId > 0
        ? registrationEventId
        : undefined,
    txid: String(row.registration_txid || ""),
    updatedHeight:
      rowNumber(row, "updated_height") || blockHeight || undefined,
  };
}

async function confirmedIdRecordsFromCurrentTables(pool, network, idLower = "") {
  const normalizedId = String(idLower ?? "").trim().toLowerCase();
  const params = [network];
  const idCondition = normalizedId ? "AND r.id_lower = $2" : "";
  if (normalizedId) {
    params.push(normalizedId);
  }
  const result = await pool.query(
    `
      SELECT
        r.network,
        r.id_lower,
        r.display_id,
        r.owner_address,
        r.receive_address,
        r.pgp_public_key,
        r.registration_txid,
        r.last_event_txid,
        r.registered_height,
        r.updated_height,
        r.updated_at,
        t.confirmed_at,
        t.block_height,
        t.block_time,
        registration_event.registration_block_index,
        registration_event.registration_event_id
      FROM proof_indexer.id_records r
      JOIN proof_indexer.transactions t
        ON t.network = r.network
       AND t.txid = r.registration_txid
       AND t.status = 'confirmed'
      LEFT JOIN LATERAL (
        SELECT
          CASE
            WHEN e.payload->>'blockIndex' ~ '^[0-9]+$'
              THEN (e.payload->>'blockIndex')::integer
            ELSE NULL
          END AS registration_block_index,
          e.event_id AS registration_event_id
        FROM proof_indexer.events e
        WHERE e.network = r.network
          AND e.txid = r.registration_txid
          AND e.kind = 'id-register'
          AND e.valid = true
          AND lower(COALESCE(e.payload->>'id', '')) = r.id_lower
        ORDER BY e.event_id ASC
        LIMIT 1
      ) registration_event ON true
      WHERE r.network = $1
        ${idCondition}
      ORDER BY
        COALESCE(r.registered_height, t.block_height) DESC NULLS LAST,
        registration_event.registration_block_index DESC NULLS LAST,
        registration_event.registration_event_id DESC NULLS LAST,
        r.registration_txid DESC
    `,
    params,
  );
  return result.rows.map((row) => confirmedIdRecordFromRow(row, network));
}

function idLifecycleStateFromItems(items, network, id) {
  const idLower = normalizedLowerText(id);
  const matchesTargetId = (value) =>
    !idLower || normalizedLowerText(value) === idLower;
  const listingsById = new Map();
  const salesByTxid = new Map();
  const activity = [];
  const supportedKinds = new Set([
    "id-list",
    "id-seal",
    "id-delist",
    "id-buy",
    "id-transfer",
  ]);
  const eventNumber = (item, key, fallback = Number.MAX_SAFE_INTEGER) => {
    const value = Number(item?.[key]);
    return Number.isSafeInteger(value) && value >= 0 ? value : fallback;
  };
  const orderedItems = (Array.isArray(items) ? items : [])
    .filter(
      (item) =>
        item?.confirmed === true &&
        supportedKinds.has(normalizedLowerText(item?.kind)),
    )
    .sort(
      (left, right) =>
        eventNumber(left, "blockHeight") - eventNumber(right, "blockHeight") ||
        eventNumber(left, "blockIndex") - eventNumber(right, "blockIndex") ||
        eventNumber(left, "_powEventIndex") -
          eventNumber(right, "_powEventIndex") ||
        eventNumber(left, "eventId") - eventNumber(right, "eventId") ||
        normalizedLowerText(left?.txid).localeCompare(
          normalizedLowerText(right?.txid),
        ),
    );

  for (const item of orderedItems) {
    const kind = normalizedLowerText(item?.kind);
    const itemId = normalizedLowerText(item?.id);
    const listingId = normalizedTxid(
      item?.listingId ?? (kind === "id-list" ? item?.txid : ""),
    );

    if (kind === "id-list") {
      if (!listingId || !itemId || !matchesTargetId(itemId)) {
        continue;
      }
      const saleAuthorization = objectRecord(item?.saleAuthorization);
      const authorizationVersion = normalizedLowerText(
        saleAuthorization.version,
      );
      const listingVersion =
        normalizedLowerText(item?.listingVersion) ||
        ({
          "pwid-sale-v1": "list2",
          "pwid-sale-v2": "list3",
          "pwid-sale-v3": "list4",
          "pwid-sale-v4": "list5",
        }[authorizationVersion] ?? "");
      const sellerAddress = normalizedText(
        item?.sellerAddress ?? saleAuthorization.sellerAddress,
      );
      listingsById.set(listingId, {
        ...item,
        anchorSigHashType:
          item?.anchorSigHashType ?? saleAuthorization.anchorSigHashType,
        anchorSignature:
          item?.anchorSignature ?? saleAuthorization.anchorSignature,
        anchorScriptPubKey:
          item?.anchorScriptPubKey ?? saleAuthorization.anchorScriptPubKey,
        anchorTxid: item?.anchorTxid ?? saleAuthorization.anchorTxid,
        anchorType: item?.anchorType ?? saleAuthorization.anchorType,
        anchorValueSats:
          item?.anchorValueSats ?? saleAuthorization.anchorValueSats,
        anchorVout: item?.anchorVout ?? saleAuthorization.anchorVout,
        buyerAddress:
          item?.buyerAddress ?? saleAuthorization.buyerAddress ?? undefined,
        confirmed: true,
        createdAt: dateIso(item?.createdAt),
        expiresAt: item?.expiresAt ?? saleAuthorization.expiresAt,
        id: normalizedText(item?.id),
        listingId,
        ...(listingVersion ? { listingVersion } : {}),
        network,
        priceSats: Number(
          item?.priceSats ?? saleAuthorization.priceSats ?? 0,
        ),
        receiveAddress:
          item?.receiveAddress ?? saleAuthorization.receiveAddress ?? undefined,
        saleAuthorization,
        sellerAddress,
        sellerPublicKey:
          item?.sellerPublicKey ?? saleAuthorization.sellerPublicKey,
        txid: listingId,
      });
      activity.push({ ...item, listingId, network });
      continue;
    }

    if (kind === "id-transfer") {
      if (!itemId || !matchesTargetId(itemId)) {
        continue;
      }
      for (const [activeListingId, listing] of listingsById) {
        if (normalizedLowerText(listing?.id) === itemId) {
          listingsById.delete(activeListingId);
        }
      }
      activity.push({ ...item, network });
      continue;
    }

    const currentListing = listingId ? listingsById.get(listingId) : null;
    const lifecycleId = itemId || normalizedLowerText(currentListing?.id);
    if (!lifecycleId || !matchesTargetId(lifecycleId)) {
      continue;
    }

    if (kind === "id-seal") {
      if (!currentListing) {
        continue;
      }
      const sealTxid = normalizedTxid(item?.sealTxid ?? item?.txid);
      const sealedAuthorization = objectRecord(item?.saleAuthorization);
      const saleAuthorization = {
        ...objectRecord(currentListing.saleAuthorization),
        ...sealedAuthorization,
      };
      listingsById.set(listingId, {
        ...currentListing,
        anchorSigHashType:
          item?.anchorSigHashType ??
          saleAuthorization.anchorSigHashType ??
          currentListing.anchorSigHashType,
        anchorSignature:
          item?.anchorSignature ??
          saleAuthorization.anchorSignature ??
          currentListing.anchorSignature,
        anchorScriptPubKey:
          item?.anchorScriptPubKey ??
          saleAuthorization.anchorScriptPubKey ??
          currentListing.anchorScriptPubKey,
        anchorTxid:
          item?.anchorTxid ??
          saleAuthorization.anchorTxid ??
          currentListing.anchorTxid,
        anchorType:
          item?.anchorType ??
          saleAuthorization.anchorType ??
          currentListing.anchorType,
        anchorValueSats:
          item?.anchorValueSats ??
          saleAuthorization.anchorValueSats ??
          currentListing.anchorValueSats,
        anchorVout:
          item?.anchorVout ??
          saleAuthorization.anchorVout ??
          currentListing.anchorVout,
        saleAuthorization,
        ...(sealTxid ? { sealTxid } : {}),
      });
      activity.push({ ...item, listingId, network });
      continue;
    }

    if (kind !== "id-buy") {
      if (listingId) {
        listingsById.delete(listingId);
      }
      activity.push({ ...item, ...(listingId ? { listingId } : {}), network });
      continue;
    }

    const buyerAddress = normalizedText(
      item?.buyerAddress ?? item?.ownerAddress ?? item?.actor,
    );
    const sellerAddress = normalizedText(
      item?.sellerAddress ?? currentListing?.sellerAddress,
    );
    const receiveAddress = normalizedText(
      item?.receiveAddress ?? buyerAddress,
    );
    const saleId = normalizedText(item?.id ?? currentListing?.id);
    const txid = normalizedTxid(item?.txid);
    for (const [activeListingId, listing] of listingsById) {
      if (normalizedLowerText(listing?.id) === normalizedLowerText(saleId)) {
        listingsById.delete(activeListingId);
      }
    }
    activity.push({ ...item, ...(listingId ? { listingId } : {}), network });
    if (
      normalizedLowerText(item?.transferVersion) !== "buy5" ||
      !saleId ||
      !buyerAddress ||
      !sellerAddress ||
      !txid
    ) {
      continue;
    }
    salesByTxid.set(txid, {
      ...item,
      amountSats: Number(item?.amountSats ?? 0),
      buyerAddress,
      confirmed: true,
      createdAt: dateIso(item?.createdAt),
      id: saleId,
      ...(listingId ? { listingId } : {}),
      network,
      priceSats: Number(item?.priceSats ?? currentListing?.priceSats ?? 0),
      receiveAddress,
      sellerAddress,
      txid,
    });
  }

  return {
    activity: [...activity].sort(compareHistoryItems),
    listings: [...listingsById.values()].sort(compareHistoryItems),
    sales: [...salesByTxid.values()].sort(compareHistoryItems),
  };
}

async function confirmedIdLifecycleFromCurrentEvents(pool, network, idLower) {
  const result = await pool.query(
    `
      WITH target_listings AS (
        SELECT lower(COALESCE(NULLIF(e.payload->>'listingId', ''), e.txid)) AS listing_id
        FROM proof_indexer.events e
        JOIN proof_indexer.transactions t
          ON t.network = e.network
         AND t.txid = e.txid
         AND t.status = 'confirmed'
        WHERE e.network = $1
          AND e.kind = 'id-list'
          AND e.status = 'confirmed'
          AND e.valid = true
          AND lower(COALESCE(e.payload->>'id', '')) = $2
      )
      SELECT
        e.event_id,
        e.payload,
        e.protocol,
        e.kind,
        e.status,
        e.event_time,
        e.block_time,
        e.created_at,
        COALESCE(e.block_height, t.block_height) AS block_height,
        e.txid
      FROM proof_indexer.events e
      JOIN proof_indexer.transactions t
        ON t.network = e.network
       AND t.txid = e.txid
       AND t.status = 'confirmed'
      WHERE e.network = $1
        AND e.status = 'confirmed'
        AND e.valid = true
        AND e.kind = ANY(
          ARRAY['id-list','id-seal','id-delist','id-buy','id-transfer']::text[]
        )
        AND (
          lower(COALESCE(e.payload->>'id', '')) = $2
          OR lower(COALESCE(e.payload->>'listingId', '')) IN (
            SELECT listing_id FROM target_listings
          )
          OR lower(e.txid) IN (SELECT listing_id FROM target_listings)
        )
      ORDER BY
        COALESCE(e.block_height, t.block_height) ASC NULLS LAST,
        CASE
          WHEN e.payload->>'blockIndex' ~ '^[0-9]+$'
            THEN (e.payload->>'blockIndex')::integer
          ELSE 2147483647
        END ASC,
        CASE
          WHEN e.payload->>'_powEventIndex' ~ '^[0-9]+$'
            THEN (e.payload->>'_powEventIndex')::integer
          ELSE 2147483647
        END ASC,
        e.event_id ASC
    `,
    [network, idLower],
  );
  const items = result.rows.map((row) => ({
    ...eventRowPayload(row, network),
    eventId: rowNumber(row, "event_id"),
  }));
  return idLifecycleStateFromItems(items, network, idLower);
}

function pendingIdRegistryStateFromActivity(activity, network) {
  const pendingRecordsById = new Map();
  const pendingEvents = [];
  const pendingSales = [];
  const pendingKindByEventKind = new Map([
    ["id-update", "update"],
    ["id-transfer", "transfer"],
    ["id-list", "list"],
    ["id-seal", "seal"],
    ["id-delist", "delist"],
    ["id-buy", "marketTransfer"],
  ]);

  for (const item of Array.isArray(activity) ? activity : []) {
    if (item?.confirmed === true) {
      continue;
    }
    const kind = normalizedLowerText(item?.kind);
    const id = normalizedLowerText(item?.id);
    if (kind === "id-register") {
      const ownerAddress = normalizedText(item?.ownerAddress ?? item?.actor);
      const receiveAddress = normalizedText(
        item?.receiveAddress ?? ownerAddress,
      );
      const txid = normalizedTxid(item?.txid);
      if (
        id &&
        ownerAddress &&
        receiveAddress &&
        txid &&
        !pendingRecordsById.has(id)
      ) {
        pendingRecordsById.set(id, {
          amountSats: Number(item?.amountSats ?? 0),
          confirmed: false,
          createdAt: dateIso(item?.createdAt),
          id: normalizedText(item?.id),
          network,
          ownerAddress,
          pgpKey: item?.pgpKey ?? item?.pgpPublicKey ?? undefined,
          receiveAddress,
          txid,
        });
      }
      continue;
    }

    const pendingKind = pendingKindByEventKind.get(kind);
    if (!pendingKind) {
      continue;
    }
    pendingEvents.push({
      ...item,
      kind: pendingKind,
      network,
    });

    if (
      kind !== "id-buy" ||
      normalizedLowerText(item?.transferVersion) !== "buy5"
    ) {
      continue;
    }
    const buyerAddress = normalizedText(
      item?.buyerAddress ?? item?.ownerAddress ?? item?.actor,
    );
    const sellerAddress = normalizedText(item?.sellerAddress);
    const receiveAddress = normalizedText(
      item?.receiveAddress ?? buyerAddress,
    );
    const txid = normalizedTxid(item?.txid);
    if (!id || !buyerAddress || !sellerAddress || !receiveAddress || !txid) {
      continue;
    }
    pendingSales.push({
      ...item,
      amountSats: Number(item?.amountSats ?? 0),
      buyerAddress,
      confirmed: false,
      createdAt: dateIso(item?.createdAt),
      id: normalizedText(item?.id),
      network,
      priceSats: Number(item?.priceSats ?? 0),
      receiveAddress,
      sellerAddress,
      txid,
    });
  }

  return {
    pendingEvents: [...pendingEvents].sort(compareHistoryItems),
    pendingRecords: [...pendingRecordsById.values()].sort(compareHistoryItems),
    pendingSales: [...pendingSales].sort(compareHistoryItems),
  };
}

async function currentIdRegistryEventState(pool, network) {
  const eventKinds = [
    "id-register",
    "id-update",
    "id-transfer",
    "id-list",
    "id-seal",
    "id-delist",
    "id-buy",
  ];
  const result = await pool.query(
    `
      SELECT
        e.event_id,
        e.payload,
        e.protocol,
        e.kind,
        t.status,
        e.event_time,
        e.block_time,
        e.created_at,
        COALESCE(e.block_height, t.block_height) AS block_height,
        e.txid
      FROM proof_indexer.events e
      JOIN proof_indexer.transactions t
        ON t.network = e.network
       AND t.txid = e.txid
      WHERE e.network = $1
        AND e.valid = true
        AND e.kind = ANY($2::text[])
        AND t.status IN ('confirmed', 'pending')
      ORDER BY
        COALESCE(e.block_height, t.block_height) ASC NULLS LAST,
        CASE
          WHEN e.payload->>'blockIndex' ~ '^[0-9]+$'
            THEN (e.payload->>'blockIndex')::integer
          ELSE 2147483647
        END ASC,
        CASE
          WHEN e.payload->>'_powEventIndex' ~ '^[0-9]+$'
            THEN (e.payload->>'_powEventIndex')::integer
          ELSE 2147483647
        END ASC,
        e.event_id ASC
    `,
    [network, eventKinds],
  );
  const canonicalItems = result.rows.map((row) => ({
    ...eventRowPayload(row, network),
    eventId: rowNumber(row, "event_id"),
  }));
  const activity = normalizeHistoryEventRows(result.rows, network);
  const lifecycle = idLifecycleStateFromItems(canonicalItems, network, "");
  return {
    ...lifecycle,
    activity,
    ...pendingIdRegistryStateFromActivity(activity, network),
  };
}

function registryHistoryEventKinds(safeKind) {
  if (safeKind === "listings") {
    return ["id-list"];
  }
  if (safeKind === "sales") {
    return ["id-buy"];
  }
  if (safeKind === "activity") {
    return [
      "id-register",
      "id-update",
      "id-transfer",
      "id-list",
      "id-seal",
      "id-delist",
      "id-buy",
    ];
  }
  return [];
}

async function currentRegistryEventHistoryPage(
  pool,
  network,
  safeKind,
  pagination,
) {
  const eventKinds = registryHistoryEventKinds(safeKind);
  if (eventKinds.length === 0) {
    return null;
  }
  const params = [network, eventKinds];
  const conditions = [
    "e.network = $1",
    "e.kind = ANY($2::text[])",
    "e.valid = true",
    "COALESCE(t.status, e.status) IN ('confirmed', 'pending')",
  ];
  if (safeKind === "listings") {
    conditions.push(`NOT EXISTS (
      SELECT 1
      FROM proof_indexer.events close_event
      WHERE close_event.network = e.network
        AND close_event.valid = true
        AND close_event.status = 'confirmed'
        AND close_event.kind IN ('id-delist', 'id-buy')
        AND EXISTS (
          SELECT 1
          FROM proof_indexer.transactions close_transaction
          WHERE close_transaction.network = close_event.network
            AND close_transaction.txid = close_event.txid
            AND close_transaction.status = 'confirmed'
        )
        AND lower(close_event.payload->>'listingId') = lower(
          COALESCE(e.payload->>'listingId', e.txid)
        )
    )`);
    conditions.push(`NOT EXISTS (
      SELECT 1
      FROM proof_indexer.events transfer_event
      JOIN proof_indexer.transactions transfer_transaction
        ON transfer_transaction.network = transfer_event.network
       AND transfer_transaction.txid = transfer_event.txid
       AND transfer_transaction.status = 'confirmed'
      WHERE transfer_event.network = e.network
        AND transfer_event.valid = true
        AND transfer_event.status = 'confirmed'
        AND transfer_event.kind IN ('id-transfer', 'id-buy')
        AND lower(COALESCE(transfer_event.payload->>'id', '')) =
          lower(COALESCE(e.payload->>'id', ''))
        AND (
          COALESCE(transfer_event.block_height, 0),
          transfer_event.event_id
        ) > (
          COALESCE(e.block_height, 0),
          e.event_id
        )
    )`);
  }
  if (pagination.query) {
    const queryTxid = normalizedTxid(pagination.query);
    if (queryTxid) {
      params.push(queryTxid);
      const queryParam = `$${params.length}`;
      conditions.push(`(
        lower(e.txid) = ${queryParam}
        OR lower(e.payload->>'txid') = ${queryParam}
        OR lower(e.payload->>'listingId') = ${queryParam}
        OR EXISTS (
          SELECT 1
          FROM proof_indexer.event_refs erq
          WHERE erq.event_id = e.event_id
            AND lower(erq.ref_value) = ${queryParam}
        )
      )`);
    } else {
      params.push(`%${pagination.query}%`);
      const queryParam = `$${params.length}`;
      conditions.push(`(
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
            AND (
              lower(epq.address) LIKE ${queryParam}
              OR lower(COALESCE(epq.powid, '')) LIKE ${queryParam}
            )
        )
      )`);
    }
  }
  const whereClause = conditions.join(" AND ");
  const countResult = await pool.query(
    `
      SELECT
        count(*) AS total_count,
        max(e.block_height) AS indexed_through_block,
        max(COALESCE(e.event_time, e.block_time, e.created_at)) AS indexed_at
      FROM proof_indexer.events e
      LEFT JOIN proof_indexer.transactions t
        ON t.network = e.network
       AND t.txid = e.txid
      WHERE ${whereClause}
    `,
    params,
  );
  const totalCount = rowNumber(countResult.rows[0], "total_count");
  const rowParams = [...params, pagination.limit, pagination.offset];
  const limitParam = `$${rowParams.length - 1}`;
  const offsetParam = `$${rowParams.length}`;
  const rowsResult = await pool.query(
    `
      SELECT
        e.payload,
        e.protocol,
        e.kind,
        COALESCE(t.status, e.status) AS status,
        e.event_time,
        e.block_time,
        e.created_at,
        e.block_height,
        e.txid,
        e.event_id
      FROM proof_indexer.events e
      LEFT JOIN proof_indexer.transactions t
        ON t.network = e.network
       AND t.txid = e.txid
      WHERE ${whereClause}
      ORDER BY
        COALESCE(e.event_time, e.block_time, e.created_at) DESC,
        e.txid DESC,
        e.event_id DESC
      LIMIT ${limitParam}
      OFFSET ${offsetParam}
    `,
    rowParams,
  );
  const items = normalizeHistoryEventRows(rowsResult.rows, network);
  const start = Math.min(pagination.offset, totalCount);
  const end = Math.min(totalCount, start + pagination.limit);

  return {
    cursor: historyCursor("", start),
    end,
    indexedAt: countResult.rows[0]?.indexed_at
      ? dateIso(countResult.rows[0].indexed_at)
      : new Date().toISOString(),
    indexedThroughBlock:
      rowNumber(countResult.rows[0], "indexed_through_block") || undefined,
    items,
    kind: safeKind,
    limit: pagination.limit,
    network,
    nextCursor: end < totalCount ? historyCursor("", end) : "",
    page: Math.floor(start / pagination.limit),
    pageCount: Math.max(1, Math.ceil(totalCount / pagination.limit)),
    pageSize: pagination.limit,
    query: pagination.query,
    source: "proof-indexer-id-events",
    start,
    totalCount,
  };
}

async function currentRegistryRecordsHistoryPage(
  pool,
  network,
  pagination,
) {
  const records = await confirmedIdRecordsFromCurrentTables(pool, network);
  return historyPageFromStoredPayload(
    {
      complete: true,
      indexedAt: newestDateIso(records.map((record) => record.createdAt)),
      indexedThroughBlock: indexedThroughBlockFromItems(records),
      items: records,
      source: "proof-indexer-confirmed-id-records",
      totalCount: records.length,
    },
    null,
    network,
    "records",
    pagination,
  );
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

  if (!eligibility.pagination.snapshotId) {
    if (eligibility.kind === "records") {
      return currentRegistryRecordsHistoryPage(
        pool,
        network,
        eligibility.pagination,
      );
    }
    return currentRegistryEventHistoryPage(
      pool,
      network,
      eligibility.kind,
      eligibility.pagination,
    );
  }

  const snapshot = await ledgerSnapshotWithPayload(
    pool,
    network,
    eligibility.pagination.snapshotId,
    "registryHistoryPayloads",
  );
  if (!snapshot) {
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

export async function proofIndexIdRecordPayload(network, id) {
  const pool = proofIndexPool();
  if (!pool) {
    return null;
  }

  const idLower = String(id ?? "").trim().toLowerCase();
  if (!idLower) {
    return null;
  }

  const [[record], lifecycle] = await Promise.all([
    confirmedIdRecordsFromCurrentTables(pool, network, idLower),
    confirmedIdLifecycleFromCurrentEvents(pool, network, idLower),
  ]);
  if (!record) {
    return null;
  }

  const lifecycleItems = [
    ...(Array.isArray(lifecycle?.activity) ? lifecycle.activity : []),
    ...(Array.isArray(lifecycle?.listings) ? lifecycle.listings : []),
    ...(Array.isArray(lifecycle?.sales) ? lifecycle.sales : []),
  ];

  return {
    activity: lifecycle.activity,
    indexedAt: newestDateIso([
      record.createdAt,
      ...lifecycleItems.map((item) => item?.createdAt),
    ]),
    indexedThroughBlock: Math.max(
      Number(record.updatedHeight) || 0,
      Number(indexedThroughBlockFromItems(lifecycleItems)) || 0,
    ),
    listings: lifecycle.listings,
    network,
    pendingEvents: [],
    records: [record],
    registryAddress: "",
    sales: lifecycle.sales,
    source: "proof-indexer-id-record-lifecycle",
    stats: {
      confirmed: 1,
      pending: 0,
      pendingChanges: 0,
      pendingRecords: 0,
      total: 1,
      transactions:
        (record.txid ? 1 : 0) +
        (Array.isArray(lifecycle?.activity) ? lifecycle.activity.length : 0),
    },
  };
}

async function currentProofIndexRegistryPayload(pool, network, options = {}) {
  const [confirmedRecords, eventState, scan] = await Promise.all([
    confirmedIdRecordsFromCurrentTables(pool, network),
    currentIdRegistryEventState(pool, network),
    latestProofIndexScanMetadata(pool, network),
  ]);
  const scanPayload = objectRecord(scan?.payload);
  const scanBlockHash = normalizedLowerText(
    scanPayload.indexedThroughBlockHash ?? scanPayload.blockHash,
  );
  const scanIndexedThroughBlock = rowNumber(scan, "indexed_through_block");
  if (
    scanPayload.complete !== true ||
    !/^[0-9a-f]{64}$/u.test(scanBlockHash) ||
    !Number.isSafeInteger(scanIndexedThroughBlock) ||
    scanIndexedThroughBlock <= 0
  ) {
    return null;
  }

  const confirmedIds = new Set(
    confirmedRecords
      .map((record) => normalizedLowerText(record?.id))
      .filter(Boolean),
  );
  const registeredEventIds = new Set(
    (Array.isArray(eventState?.activity) ? eventState.activity : [])
      .filter(
        (item) =>
          item?.confirmed === true &&
          normalizedLowerText(item?.kind) === "id-register",
      )
      .map((item) => normalizedLowerText(item?.id))
      .filter(Boolean),
  );
  const missingRelationalIds = [...registeredEventIds].filter(
    (id) => !confirmedIds.has(id),
  );
  const orphanRelationalIds = [...confirmedIds].filter(
    (id) => !registeredEventIds.has(id),
  );
  if (missingRelationalIds.length > 0 || orphanRelationalIds.length > 0) {
    console.error(
      `Rejected inconsistent current ID projection: missing records=${missingRelationalIds.slice(0, 8).join(",") || "none"}; records without valid registrations=${orphanRelationalIds.slice(0, 8).join(",") || "none"}.`,
    );
    return null;
  }
  const pendingRecords = (Array.isArray(eventState?.pendingRecords)
    ? eventState.pendingRecords
    : []
  ).filter((record) => !confirmedIds.has(normalizedLowerText(record?.id)));
  const records = [...confirmedRecords, ...pendingRecords];
  const listings = Array.isArray(eventState?.listings)
    ? eventState.listings
    : [];
  const activity = Array.isArray(eventState?.activity)
    ? eventState.activity
    : [];
  const pendingEvents = Array.isArray(eventState?.pendingEvents)
    ? eventState.pendingEvents
    : [];
  const sales = [
    ...(Array.isArray(eventState?.sales) ? eventState.sales : []),
    ...(Array.isArray(eventState?.pendingSales)
      ? eventState.pendingSales
      : []),
  ]
    .filter(
      (sale) => normalizedLowerText(sale?.transferVersion) === "buy5",
    )
    .sort(compareHistoryItems);
  const confirmed = confirmedRecords.length;
  const marketplaceStats = salesStats(sales);
  const registryItems = [
    ...records,
    ...listings,
    ...sales,
    ...activity,
    ...pendingEvents,
  ];
  const indexedAt = dateIso(
    newestDateIso([
      scan?.generated_at,
      ...registryItems.map((item) => item?.createdAt),
    ]),
  );
  const indexedThroughBlock = Math.max(
    scanIndexedThroughBlock,
    indexedThroughBlockFromItems(registryItems) ?? 0,
    ...confirmedRecords.map((record) => Number(record?.updatedHeight) || 0),
  );

  return {
    activity,
    indexedAt,
    indexedThroughBlock,
    listings,
    network,
    pendingEvents,
    records,
    registryAddress: String(options.registryAddress ?? ""),
    sales,
    snapshotId: String(scan?.snapshot_id ?? ""),
    source:
      "proof-indexer-current-id-events+proof-indexer-confirmed-id-records",
    stats: {
      confirmed,
      confirmedSales: marketplaceStats.confirmedSales,
      confirmedSalesVolumeSats: marketplaceStats.confirmedSalesVolumeSats,
      pending: pendingRecords.length + pendingEvents.length,
      pendingChanges: pendingEvents.length,
      pendingRecords: pendingRecords.length,
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

export async function proofIndexRegistryPayload(network, options = {}) {
  const pool = proofIndexPool();
  if (!pool) {
    return null;
  }

  const requestedSnapshotId = String(options.snapshotId ?? "").trim();
  const pinnedSnapshotId = normalizedSnapshotId(requestedSnapshotId);
  if (requestedSnapshotId && !pinnedSnapshotId) {
    return null;
  }
  if (!pinnedSnapshotId) {
    return currentProofIndexRegistryPayload(pool, network, options);
  }

  const snapshot = await ledgerSnapshotWithPayload(
    pool,
    network,
    pinnedSnapshotId,
    "registryHistoryPayloads",
  );
  if (!snapshot) {
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
    newestDateIso([
      recordsPayload?.indexedAt,
      ...records.map((record) => record.createdAt),
      activityPayload?.indexedAt ??
        snapshot?.payload?.registryHistoryIndexedAt ??
        snapshot?.generated_at,
    ]),
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
      Math.max(
        indexedThroughBlockFromItems(registryItems) ?? 0,
        embeddedHistoryIndexedThroughBlock(recordsPayload),
        embeddedHistoryIndexedThroughBlock(listingsPayload),
        embeddedHistoryIndexedThroughBlock(salesPayload),
        embeddedHistoryIndexedThroughBlock(activityPayload),
      ) || undefined,
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

  const snapshot = await ledgerSnapshotWithPayload(
    pool,
    network,
    "",
    "activityPayload",
  );
  if (!snapshot || !snapshotPayloadFresh(snapshot, "activityIndexedAt")) {
    return null;
  }

  return snapshotActivityPayload(snapshot);
}

export async function proofIndexCanonicalActivityPayload(network) {
  const pool = proofIndexPool();
  if (!pool) {
    return null;
  }

  const result = await pool.query(
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
      WHERE e.network = $1
        AND e.valid = true
        AND e.status IN ('confirmed', 'pending')
        AND e.kind = ANY($2::text[])
      ORDER BY
        COALESCE(e.event_time, e.block_time, e.created_at) DESC,
        e.txid DESC,
        e.event_id DESC
    `,
    [network, [...PUBLIC_LOG_EVENT_KINDS]],
  );
  const snapshot = await latestProofIndexScanMetadata(pool, network).catch(
    () => null,
  );
  const items = normalizeHistoryEventRows(result.rows, network);
  if (items.length === 0) {
    return null;
  }

  const confirmed = items.filter((item) => item.confirmed).length;
  const indexedThroughBlock =
    Math.max(
      indexedThroughBlockFromItems(items) ?? 0,
      rowNumber(snapshot, "indexed_through_block"),
    ) || undefined;
  const indexedAt = newestDateIso([
    snapshot?.generated_at,
    result.rows[0]?.event_time ??
      result.rows[0]?.block_time ??
      result.rows[0]?.created_at,
  ]);

  return {
    activity: items,
    indexedAt,
    indexedThroughBlock,
    network,
    source: "proof-indexer-events",
    stats: {
      confirmed,
      indexedThroughBlock,
      pending: items.length - confirmed,
      total: items.length,
    },
  };
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
    const addressParam = addValue(address.toLowerCase());
    filters.push(`
      (
        EXISTS (
          SELECT 1
          FROM proof_indexer.event_participants ep
          WHERE ep.event_id = e.event_id
            AND lower(ep.address) = ${addressParam}
        )
        OR EXISTS (
          SELECT 1
          FROM proof_indexer.mail_items mi
          WHERE mi.network = e.network
            AND mi.txid = e.txid
            AND (
              lower(COALESCE(mi.sender_address, '')) = ${addressParam}
              OR lower(COALESCE(mi.message->>'senderAddress', '')) = ${addressParam}
              OR lower(COALESCE(mi.message->>'recipientAddress', '')) = ${addressParam}
              OR EXISTS (
                SELECT 1
                FROM jsonb_array_elements(
                  CASE
                    WHEN jsonb_typeof(mi.message->'recipients') = 'array'
                      THEN mi.message->'recipients'
                    ELSE '[]'::jsonb
                  END
                ) recipient
                WHERE lower(COALESCE(recipient->>'address', '')) = ${addressParam}
                   OR lower(COALESCE(recipient->>'display', '')) = ${addressParam}
              )
            )
        )
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
    const queryTxid = normalizedTxid(pagination.query);
    if (queryTxid) {
      const queryParam = addValue(queryTxid);
      filters.push(`
        (
          lower(e.txid) = ${queryParam}
          OR lower(e.payload->>'txid') = ${queryParam}
          OR lower(e.payload->>'saleTxid') = ${queryParam}
          OR lower(e.payload->>'closeTxid') = ${queryParam}
          OR lower(e.payload->>'closedTxid') = ${queryParam}
          OR lower(e.payload->>'listingId') = ${queryParam}
          OR EXISTS (
            SELECT 1
            FROM proof_indexer.event_refs erq
            WHERE erq.event_id = e.event_id
              AND lower(erq.ref_value) = ${queryParam}
          )
        )
      `);
    } else {
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
  }

  return { filters, values };
}

function eventPayloadParticipants(payload) {
  const authorization = objectRecord(payload?.saleAuthorization);
  const participants = [
    ...(Array.isArray(payload?.participants) ? payload.participants : []),
    payload?.actor,
    payload?.counterparty,
    payload?.ownerAddress,
    payload?.receiveAddress,
    payload?.senderAddress,
    payload?.recipientAddress,
    payload?.registryAddress,
    payload?.creatorAddress,
    payload?.minterAddress,
    payload?.sellerAddress,
    payload?.buyerAddress,
    authorization.sellerAddress,
    authorization.buyerAddress,
    authorization.registryAddress,
    ...(Array.isArray(payload?.recipients)
      ? payload.recipients.map((recipient) => recipient?.address)
      : []),
  ]
    .map(normalizedText)
    .filter(Boolean);
  return [...new Set(participants)];
}

function eventRowPayload(row, network) {
  const payload = normalizeEventPayload(canonicalEventPayload(row.payload), row);
  const kind = normalizedLowerText(payload.kind ?? row.kind);
  const invalidTokenEvent = kind === "token-event-invalid";
  const attemptedAmountSats = invalidTokenEvent
    ? rowNumber(payload, "amountSats") || rowNumber(row, "amount_sats")
    : 0;
  return {
    ...payload,
    ...(invalidTokenEvent
      ? {
          amountSats: 0,
          attemptedAmountSats,
          frozenNetworkValueSats: 0,
          liveNetworkValueSats: 0,
          marketplaceMutationFeeSats: 0,
          minerFeeSats: 0,
          proofPaymentSats: 0,
          registryMutationFeeSats: 0,
          salePaymentSats: 0,
          valid: false,
        }
      : {}),
    blockHeight: rowNumber(row, "block_height") || payload.blockHeight,
    txid: row.txid ?? payload.txid,
    protocol: row.protocol ?? payload.protocol,
    kind,
    participants: eventPayloadParticipants(payload),
    status: row.status ?? payload.status,
    confirmed: row.status ? row.status === "confirmed" : payload.confirmed,
    createdAt: dateIso(row.event_time ?? row.block_time ?? row.created_at),
    network,
  };
}

function tokenMarketEventRowPayload(row, network) {
  const payload = eventRowPayload(row, network);
  const listingPayload = objectRecord(row?.listing_payload);
  const merged = {
    ...listingPayload,
    ...payload,
    amount:
      payload.amount ??
      payload.tokenAmount ??
      listingPayload.amount ??
      row?.listing_amount,
    buyerAddress:
      payload.buyerAddress ??
      payload.actor ??
      listingPayload.buyerAddress ??
      row?.listing_buyer_address,
    listingId:
      payload.listingId ??
      listingPayload.listingId ??
      row?.linked_listing_id ??
      row?.txid,
    priceSats:
      payload.priceSats ??
      payload.salePriceSats ??
      listingPayload.priceSats ??
      row?.listing_price_sats,
    registryAddress:
      payload.registryAddress ??
      listingPayload.registryAddress ??
      row?.registry_address,
    sellerAddress:
      payload.sellerAddress ??
      payload.counterparty ??
      listingPayload.sellerAddress ??
      row?.listing_seller_address,
    ticker: payload.ticker ?? listingPayload.ticker ?? row?.ticker,
    tokenId: payload.tokenId ?? listingPayload.tokenId ?? row?.token_id,
  };
  return normalizeEventPayload(merged, row);
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
    { address: payload.senderAddress, role: "sender" },
    { address: rawPayload.actor, role: "sender" },
    { address: rawPayload.senderAddress, role: "sender" },
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
    knownMailAddress(payload.actor) ||
    knownMailAddress(payload.senderAddress) ||
    knownMailAddress(rawPayload.actor) ||
    knownMailAddress(rawPayload.senderAddress) ||
    knownMailAddress(row.sender_address);
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
  const payloadAttachment = objectRecord(payload.attachment);
  const rawAttachment = objectRecord(rawPayload.attachment);
  const attachment =
    Object.keys(payloadAttachment).length > 0
      ? payloadAttachment
      : rawAttachment;
  const items = [];

  if (actorKey && actorKey === targetKey) {
    items.push({
      folder: "sent",
      message: {
        amountSats: totalAmountSats,
        attachment: Object.keys(attachment).length > 0 ? attachment : undefined,
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
        attachment: Object.keys(attachment).length > 0 ? attachment : undefined,
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

function mailMessageProjectionRank(message) {
  const confirmed =
    message?.confirmed === true || message?.status === "confirmed" ? 1 : 0;
  const protocol =
    String(message?.protocolKind ?? "").toLowerCase() === INFINITY_BOND_KIND
      ? 2
      : 0;
  const content = [
    message?.attachment,
    message?.memo,
    message?.subject,
    Array.isArray(message?.recipients) ? message.recipients.length : 0,
  ].some(Boolean)
    ? 1
    : 0;
  return confirmed * 100 + protocol * 10 + content;
}

function mergeMailProjectionMessage(current, incoming) {
  if (!current) {
    return incoming;
  }
  if (!incoming) {
    return current;
  }

  const primary =
    mailMessageProjectionRank(incoming) >= mailMessageProjectionRank(current)
      ? incoming
      : current;
  const secondary = primary === incoming ? current : incoming;
  return {
    ...secondary,
    ...primary,
    attachment: primary.attachment ?? secondary.attachment,
    confirmedAt: primary.confirmedAt ?? secondary.confirmedAt,
    createdAt: primary.createdAt ?? secondary.createdAt,
    lastCheckedAt: primary.lastCheckedAt ?? secondary.lastCheckedAt,
    memo: primary.memo || secondary.memo,
    parentTxid: primary.parentTxid ?? secondary.parentTxid,
    recipients: primary.recipients ?? secondary.recipients,
    replyTo: primary.replyTo || secondary.replyTo,
    subject: primary.subject ?? secondary.subject,
    to: primary.to || secondary.to,
  };
}

function dedupeMailProjectionMessages(messages) {
  const byTxid = new Map();
  const withoutTxid = [];
  for (const message of messages) {
    const txid = String(message?.txid ?? "").trim().toLowerCase();
    if (!txid) {
      withoutTxid.push(message);
      continue;
    }
    const key = `${String(message?.network ?? "").trim().toLowerCase()}:${txid}`;
    byTxid.set(key, mergeMailProjectionMessage(byTxid.get(key), message));
  }
  return [...byTxid.values(), ...withoutTxid].sort(compareMailMessages);
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
  const addressCandidateKeys = [
    ...new Set(addressCandidates.map((value) => normalizedAddressKey(value))),
  ];

  const rowsResult = await pool.query(
    `
      WITH candidate_events AS (
        SELECT DISTINCT e.event_id
        FROM proof_indexer.event_participants ep
        JOIN proof_indexer.events e
          ON e.event_id = ep.event_id
        WHERE e.network = $1
          AND ep.address = ANY($2::text[])

        UNION

        SELECT DISTINCT e.event_id
        FROM proof_indexer.mail_items m
        JOIN proof_indexer.events e
          ON e.network = m.network
         AND e.txid = m.txid
        WHERE m.network = $1
          AND (
            m.sender_address = ANY($2::text[])
            OR lower(COALESCE(m.message->>'senderAddress', '')) = ANY($2::text[])
            OR lower(COALESCE(m.message->>'recipientAddress', '')) = ANY($2::text[])
            OR EXISTS (
              SELECT 1
              FROM jsonb_array_elements(
                CASE
                  WHEN jsonb_typeof(m.message->'recipients') = 'array'
                    THEN m.message->'recipients'
                  ELSE '[]'::jsonb
                END
              ) recipient(record)
              WHERE lower(COALESCE(
                recipient.record->>'address',
                recipient.record->>'display',
                ''
              )) = ANY($2::text[])
            )
          )
      )
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
      JOIN candidate_events ce
        ON ce.event_id = e.event_id
      WHERE e.network = $1
        AND e.valid = true
        AND e.kind = ANY($3::text[])
        AND e.status IN ('pending', 'confirmed', 'dropped', 'orphaned')
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

  const transactionOverlayResult = await pool.query(
    `
      SELECT
        t.raw_tx->'item' AS payload,
        COALESCE(t.raw_tx->'item'->>'kind', '') AS kind,
        t.status,
        COALESCE(
          CASE
            WHEN t.raw_tx->'item'->>'createdAt' ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T'
              THEN (t.raw_tx->'item'->>'createdAt')::timestamptz
            ELSE NULL
          END,
          t.block_time,
          t.confirmed_at,
          t.first_seen_at
        ) AS event_time,
        t.block_time,
        t.first_seen_at AS created_at,
        t.txid,
        NULL::bigint AS event_id,
        t.raw_tx AS transaction_raw_tx,
        NULL::text AS subject,
        COALESCE(
          t.raw_tx->'item'->>'senderAddress',
          t.raw_tx->'item'->>'actor'
        ) AS sender_address,
        NULL::text AS parent_txid,
        t.raw_tx->'item'->>'memo' AS body_text,
        CASE
          WHEN t.raw_tx->'item'->>'amountSats' ~ '^[0-9]+$'
            THEN (t.raw_tx->'item'->>'amountSats')::bigint
          ELSE NULL
        END AS amount_sats,
        '[]'::jsonb AS participants
      FROM proof_indexer.transactions t
      WHERE t.network = $1
        AND t.raw_tx ? 'item'
        AND lower(COALESCE(t.raw_tx->'item'->>'kind', '')) = ANY($3::text[])
        AND t.status IN ('pending', 'confirmed', 'dropped', 'orphaned')
        AND (
          lower(COALESCE(t.raw_tx->'item'->>'actor', '')) = ANY($2::text[])
          OR lower(COALESCE(t.raw_tx->'item'->>'senderAddress', '')) = ANY($2::text[])
          OR lower(COALESCE(t.raw_tx->'item'->>'counterparty', '')) = ANY($2::text[])
          OR EXISTS (
            SELECT 1
            FROM jsonb_array_elements_text(
              CASE
                WHEN jsonb_typeof(t.raw_tx->'item'->'participants') = 'array'
                  THEN t.raw_tx->'item'->'participants'
                ELSE '[]'::jsonb
              END
            ) participant(address)
            WHERE lower(participant.address) = ANY($2::text[])
          )
          OR EXISTS (
            SELECT 1
            FROM jsonb_array_elements(
              CASE
                WHEN jsonb_typeof(t.raw_tx->'item'->'recipients') = 'array'
                  THEN t.raw_tx->'item'->'recipients'
                ELSE '[]'::jsonb
              END
            ) recipient(record)
            WHERE lower(COALESCE(
              recipient.record->>'address',
              recipient.record->>'display',
              ''
            )) = ANY($2::text[])
          )
        )
      ORDER BY
        COALESCE(
          CASE
            WHEN t.raw_tx->'item'->>'createdAt' ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T'
              THEN (t.raw_tx->'item'->>'createdAt')::timestamptz
            ELSE NULL
          END,
          t.block_time,
          t.confirmed_at,
          t.first_seen_at
        ) DESC,
        t.txid DESC
      LIMIT 1000
    `,
    [
      network,
      addressCandidateKeys,
      ADDRESS_MAIL_EVENT_KINDS.map((kind) => kind.toLowerCase()),
    ],
  );

  const inboxMessages = [];
  const sentMessages = [];
  for (const row of [...rowsResult.rows, ...transactionOverlayResult.rows]) {
    for (const item of addressMailRowPayloads(row, targetAddress, network)) {
      if (item.folder === "sent") {
        sentMessages.push(item.message);
      } else {
        inboxMessages.push(item.message);
      }
    }
  }

  const dedupedInboxMessages = dedupeMailProjectionMessages(inboxMessages);
  const dedupedSentMessages = dedupeMailProjectionMessages(sentMessages);

  return {
    address: targetAddress,
    inboxMessages: dedupedInboxMessages,
    indexedAt: new Date().toISOString(),
    network,
    sentMessages: dedupedSentMessages,
    source:
      transactionOverlayResult.rows.length > 0
        ? "proof-indexer-mail+proof-indexer-transaction-mail-overlay"
        : "proof-indexer-mail",
    stats: {
      inbox: dedupedInboxMessages.filter((message) => message.confirmed).length,
      incoming: dedupedInboxMessages.filter((message) => !message.confirmed)
        .length,
      indexedEvents: rowsResult.rows.length + transactionOverlayResult.rows.length,
      scanFailed: false,
      scannedTransactions: 0,
      sent: dedupedSentMessages.filter(
        (message) => message.status === "confirmed",
      ).length,
      outbox: dedupedSentMessages.filter(
        (message) => message.status !== "confirmed",
      ).length,
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

export async function proofIndexCanonicalSummaryLedgerPayload(network) {
  const pool = proofIndexPool();
  if (!pool) {
    return null;
  }

  const result = await pool.query(
    `
      SELECT
        snapshot_id,
        generated_at,
        indexed_through_block,
        source_hashes,
        metrics,
        consistency,
        payload->>'snapshotId' AS payload_snapshot_id,
        payload->'summaryPayloads'->'growthSummary'->>'snapshotId' AS growth_snapshot_id,
        payload->'summaryPayloads'->'infinitySummary'->>'snapshotId' AS infinity_snapshot_id,
        payload->'summaryPayloads'->'marketplaceSummary'->>'snapshotId' AS marketplace_snapshot_id,
        payload->'summaryPayloads'->'workFloor'->>'snapshotId' AS work_floor_snapshot_id,
        payload->'summaryPayloads'->'workSummary'->>'snapshotId' AS work_summary_snapshot_id,
        payload->'summaryPayloads'->'growthSummary'->>'indexedThroughBlock' AS growth_height,
        payload->'summaryPayloads'->'growthSummary'->'workFloor'->>'indexedThroughBlock' AS growth_floor_height,
        payload->'summaryPayloads'->'infinitySummary'->>'indexedThroughBlock' AS infinity_height,
        payload->'summaryPayloads'->'marketplaceSummary'->>'indexedThroughBlock' AS marketplace_height,
        payload->'summaryPayloads'->'marketplaceSummary'->'workFloor'->>'indexedThroughBlock' AS marketplace_floor_height,
        payload->'summaryPayloads'->'workFloor'->>'indexedThroughBlock' AS work_floor_height,
        payload->'summaryPayloads'->'workSummary'->>'indexedThroughBlock' AS work_summary_height,
        payload->'summaryPayloads'->'workSummary'->'floor'->>'indexedThroughBlock' AS work_summary_floor_height,
        payload->'totals' AS totals
      FROM proof_indexer.ledger_snapshots
      WHERE network = $1
        AND COALESCE(consistency->>'ok', payload->>'ok', 'false') = 'true'
        AND COALESCE(consistency->>'status', payload->>'status', '') <> 'summary-snapshot-fallback'
        AND payload->'summaryRefresh'->>'mode' = 'canonical-summary-refresh'
        AND source_hashes ? 'canonicalSummary'
        AND jsonb_typeof(payload->'summaryPayloads'->'growthSummary') = 'object'
        AND jsonb_typeof(payload->'summaryPayloads'->'infinitySummary') = 'object'
        AND jsonb_typeof(payload->'summaryPayloads'->'marketplaceSummary') = 'object'
        AND jsonb_typeof(payload->'summaryPayloads'->'workFloor') = 'object'
        AND jsonb_typeof(payload->'summaryPayloads'->'workSummary') = 'object'
        AND EXISTS (
          SELECT 1
          FROM jsonb_array_elements(COALESCE(consistency->'checks', '[]'::jsonb)) AS check_item
          WHERE check_item->>'name' = 'token-components-cover-confirmed-activity'
            AND COALESCE(check_item->>'ok', 'false') = 'true'
        )
        AND EXISTS (
          SELECT 1
          FROM jsonb_array_elements(COALESCE(consistency->'checks', '[]'::jsonb)) AS check_item
          WHERE check_item->>'name' = 'canonical-activity-count-matches-public-log'
            AND COALESCE(check_item->>'ok', 'false') = 'true'
        )
      ORDER BY indexed_through_block DESC NULLS LAST, generated_at DESC
      LIMIT 1
    `,
    [network],
  );
  const snapshot = result.rows[0];
  if (
    !snapshot ||
    String(snapshot.payload_snapshot_id ?? "") !==
      String(snapshot.snapshot_id ?? "")
  ) {
    return null;
  }

  const indexedThroughBlock = safeBlockHeight(snapshot.indexed_through_block);
  const summarySnapshotIds = [
    snapshot.growth_snapshot_id,
    snapshot.infinity_snapshot_id,
    snapshot.marketplace_snapshot_id,
    snapshot.work_floor_snapshot_id,
    snapshot.work_summary_snapshot_id,
  ].map((value) => String(value ?? ""));
  const summaryCoverageHeights = [
    snapshot.growth_height,
    snapshot.growth_floor_height,
    snapshot.infinity_height,
    snapshot.marketplace_height,
    snapshot.marketplace_floor_height,
    snapshot.work_floor_height,
    snapshot.work_summary_height,
    snapshot.work_summary_floor_height,
  ].map(safeBlockHeight);
  if (
    !indexedThroughBlock ||
    summarySnapshotIds.some(
      (value) => value !== String(snapshot.snapshot_id ?? ""),
    ) ||
    summaryCoverageHeights.some((height) => height !== indexedThroughBlock)
  ) {
    return null;
  }

  const totals =
    snapshot.totals &&
    typeof snapshot.totals === "object" &&
    !Array.isArray(snapshot.totals)
      ? snapshot.totals
      : {};
  const workNetworkValueSats = Number(totals.workNetworkValueSats);
  const workActualValueSats = Number(totals.workActualValueSats);
  const growthActualValueSats = Number(totals.growthActualValueSats);
  const growthWorkFloorValueSats = Number(
    totals.growthWorkFloorValueSats,
  );
  if (
    ![
      workNetworkValueSats,
      workActualValueSats,
      growthActualValueSats,
      growthWorkFloorValueSats,
    ].every((value) => Number.isFinite(value) && value > 0)
  ) {
    return null;
  }

  return {
    consistency: snapshot.consistency,
    generatedAt: dateIso(snapshot.generated_at),
    growthSummary: {
      actualValue: { totalSats: growthActualValueSats },
      workFloor: {
        actualValue: { totalSats: growthWorkFloorValueSats },
        networkValueSats: growthWorkFloorValueSats,
      },
    },
    indexedThroughBlock,
    metrics: snapshot.metrics ?? {},
    network,
    snapshotId: snapshot.snapshot_id,
    source: "proof-indexer-canonical-summary-ledger",
    sourceHashes: snapshot.source_hashes ?? {},
    workFloor: {
      actualValue: { totalSats: workActualValueSats },
      networkValueSats: workNetworkValueSats,
    },
  };
}

export async function proofIndexSnapshotPayload(network, key) {
  const pool = proofIndexPool();
  if (!pool) {
    return null;
  }

  const summaryResult = await pool.query(
    `
      SELECT
        snapshot_id,
        generated_at,
        indexed_through_block,
        consistency,
        payload
      FROM proof_indexer.ledger_snapshots
      WHERE network = $1
        AND COALESCE(consistency->>'ok', payload->>'ok', 'false') = 'true'
        AND COALESCE(consistency->>'status', payload->>'status', '') <> 'summary-snapshot-fallback'
        AND payload->'summaryRefresh'->>'mode' = 'canonical-summary-refresh'
        AND source_hashes ? 'canonicalSummary'
        AND jsonb_typeof(payload->'summaryPayloads'->'growthSummary') = 'object'
        AND jsonb_typeof(payload->'summaryPayloads'->'infinitySummary') = 'object'
        AND jsonb_typeof(payload->'summaryPayloads'->'marketplaceSummary') = 'object'
        AND jsonb_typeof(payload->'summaryPayloads'->'workFloor') = 'object'
        AND jsonb_typeof(payload->'summaryPayloads'->'workSummary') = 'object'
        AND EXISTS (
          SELECT 1
          FROM jsonb_array_elements(COALESCE(consistency->'checks', '[]'::jsonb)) AS check_item
          WHERE check_item->>'name' = 'token-components-cover-confirmed-activity'
            AND COALESCE(check_item->>'ok', 'false') = 'true'
        )
        AND EXISTS (
          SELECT 1
          FROM jsonb_array_elements(COALESCE(consistency->'checks', '[]'::jsonb)) AS check_item
          WHERE check_item->>'name' = 'canonical-activity-count-matches-public-log'
            AND COALESCE(check_item->>'ok', 'false') = 'true'
        )
        AND payload ? 'summaryPayloads'
        AND payload->'summaryPayloads' ? $2
      ORDER BY indexed_through_block DESC NULLS LAST, generated_at DESC
      LIMIT 1
    `,
    [network, key],
  );
  let snapshot = summaryResult.rows[0] ?? null;
  if (!snapshot) {
    const snapshotResult = await pool.query(
      `
        WITH recent AS (
          SELECT
            snapshot_id,
            generated_at,
            indexed_through_block,
            consistency,
            payload
          FROM proof_indexer.ledger_snapshots
          WHERE network = $1
            AND COALESCE(consistency->>'ok', payload->>'ok', 'false') = 'true'
            AND COALESCE(consistency->>'status', payload->>'status', '') <> 'summary-snapshot-fallback'
            AND payload->'summaryRefresh'->>'mode' = 'canonical-summary-refresh'
            AND source_hashes ? 'canonicalSummary'
            AND jsonb_typeof(payload->'summaryPayloads'->'growthSummary') = 'object'
            AND jsonb_typeof(payload->'summaryPayloads'->'infinitySummary') = 'object'
            AND jsonb_typeof(payload->'summaryPayloads'->'marketplaceSummary') = 'object'
            AND jsonb_typeof(payload->'summaryPayloads'->'workFloor') = 'object'
            AND jsonb_typeof(payload->'summaryPayloads'->'workSummary') = 'object'
            AND EXISTS (
              SELECT 1
              FROM jsonb_array_elements(COALESCE(consistency->'checks', '[]'::jsonb)) AS check_item
              WHERE check_item->>'name' = 'token-components-cover-confirmed-activity'
                AND COALESCE(check_item->>'ok', 'false') = 'true'
            )
            AND EXISTS (
              SELECT 1
              FROM jsonb_array_elements(COALESCE(consistency->'checks', '[]'::jsonb)) AS check_item
              WHERE check_item->>'name' = 'canonical-activity-count-matches-public-log'
                AND COALESCE(check_item->>'ok', 'false') = 'true'
            )
          ORDER BY generated_at DESC
          LIMIT ${SUMMARY_SNAPSHOT_LOOKBACK_LIMIT}
        )
        SELECT
          snapshot_id,
          generated_at,
          indexed_through_block,
          consistency,
          payload
        FROM recent
        WHERE payload ? 'summaryPayloads'
          AND payload->'summaryPayloads' ? $2
        ORDER BY generated_at DESC
        LIMIT 1
      `,
      [network, key],
    );
    snapshot = snapshotResult.rows[0] ?? null;
  }
  if (!snapshot) {
    return null;
  }

  // Only authenticated canonical-summary refresh rows are eligible here.
  // proof-api separately requires their conservative embedded coverage to
  // reach the hashed block-scan checkpoint before opening public reads.
  const payload = snapshot?.payload?.summaryPayloads?.[key];
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return null;
  }
  const consistency =
    snapshot?.consistency &&
    typeof snapshot.consistency === "object" &&
    !Array.isArray(snapshot.consistency)
      ? snapshot.consistency
      : payload.consistency;
  const nestedConsistencyPayload = {
    ...payload,
    ...(consistency ? { consistency } : {}),
    ...(payload.floor && typeof payload.floor === "object" && !Array.isArray(payload.floor)
      ? {
          floor: {
            ...payload.floor,
            ...(consistency ? { consistency } : {}),
          },
        }
      : {}),
    ...(payload.workFloor &&
    typeof payload.workFloor === "object" &&
    !Array.isArray(payload.workFloor)
      ? {
          workFloor: {
            ...payload.workFloor,
            ...(consistency ? { consistency } : {}),
          },
        }
      : {}),
  };
  return {
    ...nestedConsistencyPayload,
    indexedThroughBlock: summaryPayloadIndexedThroughBlock(
      nestedConsistencyPayload,
      snapshot,
    ),
    ledgerGeneratedAt:
      payload.ledgerGeneratedAt ?? dateIso(snapshot.generated_at),
    snapshotId: payload.snapshotId ?? snapshot.snapshot_id,
  };
}

export async function proofIndexValueSummaryPayload(network) {
  const pool = proofIndexPool();
  if (!pool) {
    return null;
  }

  const result = await pool.query(
    `
      WITH latest_scan AS (
        SELECT indexed_through_block, generated_at
        FROM proof_indexer.ledger_snapshots
        WHERE network = $1
          AND (
            source_hashes ? 'blockScan'
            OR
            payload->>'source' = 'proof-indexer-block-scan'
            OR consistency->>'status' LIKE 'block-scan%'
          )
        ORDER BY indexed_through_block DESC NULLS LAST, generated_at DESC
        LIMIT 1
      ),
      value_events AS (
        SELECT
          COALESCE(sum(amount_sats), 0)::text AS total_sats,
          count(*)::int AS event_count,
          max(block_height)::int AS max_event_block,
          max(event_time) AS max_event_time
        FROM proof_indexer.events
        WHERE network = $1
          AND status = 'confirmed'
          AND valid IS DISTINCT FROM false
      )
      SELECT
        latest_scan.indexed_through_block,
        latest_scan.generated_at,
        value_events.total_sats,
        value_events.event_count,
        value_events.max_event_block,
        value_events.max_event_time
      FROM value_events
      LEFT JOIN latest_scan ON true
    `,
    [network],
  );
  const row = result.rows[0];
  if (!row) {
    return null;
  }
  const totalSats = Number(row.total_sats ?? 0);
  const indexedThroughBlock =
    Number(row.indexed_through_block) || Number(row.max_event_block) || 0;
  return {
    actualValue: {
      computerEventFlowSats: totalSats,
      networkValueSats: totalSats,
      totalSats,
    },
    indexedAt: dateIso(row.generated_at ?? row.max_event_time),
    indexedThroughBlock,
    network,
    networkValueSats: totalSats,
    source: "proof-indexer-value-events",
    stats: {
      confirmedComputerActions: Number(row.event_count ?? 0),
      indexedThroughBlock,
      maxEventBlock: Number(row.max_event_block) || 0,
    },
  };
}

export async function proofIndexConfirmedValueEventsAfterBlock(
  network,
  blockHeight,
) {
  const pool = proofIndexPool();
  if (!pool) {
    return null;
  }

  const minBlock = Number(blockHeight) || 0;
  const result = await pool.query(
    `
      WITH latest_scan AS (
        SELECT indexed_through_block, generated_at
        FROM proof_indexer.ledger_snapshots
        WHERE network = $1
          AND (
            source_hashes ? 'blockScan'
            OR
            payload->>'source' = 'proof-indexer-block-scan'
            OR consistency->>'status' LIKE 'block-scan%'
          )
        ORDER BY indexed_through_block DESC NULLS LAST, generated_at DESC
        LIMIT 1
      ),
      value_events AS (
        SELECT
          kind,
          COALESCE(sum(amount_sats), 0)::text AS total_sats,
          count(*)::int AS event_count,
          max(block_height)::int AS max_event_block,
          max(event_time) AS max_event_time
        FROM proof_indexer.events
        WHERE network = $1
          AND status = 'confirmed'
          AND valid IS DISTINCT FROM false
          AND block_height > $2
        GROUP BY kind
      )
      SELECT
        value_events.kind,
        value_events.total_sats,
        value_events.event_count,
        value_events.max_event_block,
        value_events.max_event_time,
        latest_scan.indexed_through_block,
        latest_scan.generated_at
      FROM latest_scan
      LEFT JOIN value_events ON true
      ORDER BY value_events.max_event_block, value_events.kind
    `,
    [network, minBlock],
  );

  const events = result.rows
    .filter((row) => row.kind)
    .map((row) => ({
      count: Number(row.event_count ?? 0),
      indexedAt: dateIso(row.max_event_time ?? row.generated_at),
      indexedThroughBlock: Number(row.indexed_through_block) || 0,
      kind: String(row.kind ?? ""),
      maxEventBlock: Number(row.max_event_block) || 0,
      totalSats: Number(row.total_sats ?? 0),
    }));
  const latestScanBlock = Math.max(
    0,
    ...result.rows.map((row) => Number(row.indexed_through_block) || 0),
  );
  return {
    events,
    indexedAt: dateIso(
      result.rows[0]?.generated_at ?? result.rows[0]?.max_event_time,
    ),
    indexedThroughBlock: Math.max(
      latestScanBlock,
      ...events.map((event) => event.indexedThroughBlock),
    ),
    maxEventBlock: Math.max(0, ...events.map((event) => event.maxEventBlock)),
    network,
    source: "proof-indexer-value-event-delta",
    totalCount: events.reduce((total, event) => total + event.count, 0),
    totalSats: events.reduce((total, event) => total + event.totalSats, 0),
  };
}

export async function proofIndexCreditListingsPayload(
  network,
  tokenId = "",
  options = {},
) {
  const pool = proofIndexPool();
  if (!pool) {
    return null;
  }

  const requestedScope = tokenScopeKey(tokenId);
  const scope = requestedScope === "all" ? "" : requestedScope;
  const maxRows = boundedInteger(options.limit, 500, 1, 5000);
  const [scan, countResult] = await Promise.all([
    latestProofIndexScanMetadata(pool, network),
    pool.query(
      `
        SELECT count(*) AS total_count
        FROM proof_indexer.credit_listings
        WHERE network = $1
          AND ($2 = '' OR lower(token_id) = $2)
      `,
      [network, scope],
    ),
  ]);
  const totalCount = rowNumber(countResult.rows[0], "total_count");

  const result = await pool.query(
    `
      SELECT
        listing_id,
        status,
        token_id,
        seller_address,
        buyer_address,
        amount,
        price_sats,
        sale_ticket_txid,
        sale_ticket_vout,
        sale_ticket_value_sats,
        seal_txid,
        close_txid,
        payload,
        updated_at
      FROM proof_indexer.credit_listings
      WHERE network = $1
        AND ($2 = '' OR lower(token_id) = $2)
      ORDER BY updated_at DESC, listing_id ASC
      LIMIT $3
    `,
    [network, scope, maxRows],
  );

  const listingIds = result.rows
    .map((row) => String(row?.listing_id ?? "").trim().toLowerCase())
    .filter(Boolean);
  const closeEventsByListingId = new Map();
  let closeEventRows = [];
  if (listingIds.length > 0) {
    const closeResult = await pool.query(
      `
        SELECT DISTINCT ON (lower(e.payload->>'listingId'))
          lower(e.payload->>'listingId') AS linked_listing_id,
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
        WHERE e.network = $1
          AND e.valid = true
          AND e.kind = ANY(ARRAY['token-sale','token-listing-closed']::text[])
          AND lower(e.payload->>'listingId') = ANY($2::text[])
        ORDER BY
          lower(e.payload->>'listingId'),
          CASE WHEN e.kind = 'token-sale' THEN 0 ELSE 1 END,
          COALESCE(e.event_time, e.block_time, e.created_at) DESC,
          e.txid DESC,
          e.event_id DESC
      `,
      [network, listingIds],
    );
    closeEventRows = closeResult.rows;
    for (const row of closeResult.rows) {
      const listingId = String(row?.linked_listing_id ?? "").trim().toLowerCase();
      if (listingId) {
        closeEventsByListingId.set(listingId, row);
      }
    }
  }
  const newestTime = [
    ...result.rows.map((row) => row.updated_at),
    ...closeEventRows.map(
      (row) => row.event_time ?? row.block_time ?? row.created_at,
    ),
  ]
    .map((value) => Date.parse(value))
    .filter(Number.isFinite)
    .reduce((max, value) => Math.max(max, value), 0);

  return {
    indexedAt: dateIso(
      scan?.generated_at ??
        (newestTime ? new Date(newestTime).toISOString() : result.rows[0]?.updated_at),
    ),
    indexedThroughBlock: rowNumber(scan, "indexed_through_block"),
    items: result.rows.map((row) => {
      const payload = objectRecord(row.payload);
      const saleAuthorization = objectRecord(payload.saleAuthorization);
      const listingId = String(row.listing_id ?? payload.listingId ?? "")
        .trim()
        .toLowerCase();
      const closeRow = closeEventsByListingId.get(listingId);
      const closePayload = closeRow
        ? tokenMarketEventRowPayload(closeRow, network)
        : {};
      const rowStatus = String(row.status ?? payload.status ?? "")
        .trim()
        .toLowerCase();
      const sealTxid = String(row.seal_txid ?? payload.sealTxid ?? "")
        .trim()
        .toLowerCase();
      const closeTxid = closeRow
        ? String(closePayload.txid ?? closePayload.closedTxid ?? "")
            .trim()
            .toLowerCase()
        : tokenListingEffectiveCloseTxid(row, payload, rowStatus, sealTxid);
      const closeConfirmed = closeRow
        ? closePayload.confirmed !== false
        : payload.closedConfirmed === true;
      const closeIsSale =
        closePayload.kind === "token-sale" ||
        Boolean(closePayload.saleTxid) ||
        Boolean(closePayload.buyerAddress);
      const status =
        closeConfirmed && closeTxid
          ? closeIsSale
            ? "sold"
            : "delisted"
          : row.status;
      return {
        ...payload,
        amount: row.amount,
        buyerAddress:
          closePayload.buyerAddress ?? row.buyer_address ?? payload.buyerAddress,
        closeTxid,
        closedAt: closePayload.createdAt ?? payload.closedAt,
        closedConfirmed:
          (Boolean(closeTxid) && closeConfirmed) ||
          payload.closedConfirmed === true,
        closedTxid: closeTxid,
        confirmed: status !== "pending",
        listingId,
        network,
        priceSats: Number(row.price_sats ?? 0),
        saleAuthorization,
        saleTicketTxid: tokenListingEffectiveSaleTicketTxid(
          row,
          payload,
          saleAuthorization,
          listingId,
          sealTxid,
        ),
        saleTicketValueSats: Number(row.sale_ticket_value_sats ?? 0),
        saleTicketVout: row.sale_ticket_vout,
        saleTxid:
          closeIsSale && closeTxid ? closeTxid : payload.saleTxid ?? undefined,
        sealTxid,
        sellerAddress: row.seller_address,
        status,
        tokenId: row.token_id,
        txid: listingId,
        updatedAt: dateIso(row.updated_at),
      };
    }),
    network,
    source: "proof-indexer-credit-listing-lifecycle",
    stats: {
      complete: result.rows.length >= totalCount,
      totalCount,
    },
    totalCount,
  };
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
