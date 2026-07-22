import {
  createProofIndexPool,
  proofIndexDatabaseConfigured,
} from "./postgres.mjs";
import {
  BOND_VALUE_Q8_SCALE,
  addIntegerTexts,
  canonicalIntegerText,
  decimalTextFromQ8,
  integerBigInt,
  maxIntegerTexts,
  q8TextFromDecimal,
  safeIntegerNumber,
} from "../bond-units.mjs";
import {
  WORK_ATOMIC_PROJECTION_MODEL,
  WORK_DECIMALS,
  WORK_TOKEN_ID,
  WORK_UNIT_SCALE_TEXT,
  formatWorkAtoms,
  isWorkTokenId,
  normalizeWorkAtoms,
  parseSignedWorkAmountToAtoms,
  parseWorkAmountToAtoms,
  withWorkPrecisionMetadata,
  workAmountAtomsFromRecord,
} from "../work-units.mjs";
import {
  INCB_RANGE_REPLAY_BOUND_WITNESS_SOURCE,
  INCB_RANGE_REPLAY_EXACT_MINT_LEGACY_SNAPSHOT_MODE,
  INCB_RANGE_REPLAY_WITNESS_MANIFEST_MODEL,
  canonicalIncbReplaySha256,
  incbRangeReplayWitnessMetaKey,
  incbReplayRawSnapshotFingerprint,
  incbReplaySnapshotFingerprint,
  normalizeIncbReplaySnapshotDescriptor,
  verifyIncbRangeReplayWitnessManifest,
} from "../incb-range-replay-witness.mjs";

let proofIndexReadPool = null;
const INFINITY_BOND_MEMO = "powb";
const INFINITY_BOND_KIND = "infinity-bond";
const INCEPTION_BOND_MEMO = "incb";
const INCEPTION_BOND_KIND = "inception-bond";
const INCB_TOKEN_ID =
  "3cb25745f937f2b4e5508e5400189fe8fe679cd8e84bfa1e9176d70c9761f15d";
const INCB_ISSUANCE_ACCOUNTING_MODEL =
  "canonical-pre-bond-live-network-value-v2";
const INCB_VALUE_SNAPSHOT_MODEL = "canonical-summary-h-minus-one-v1";
const WORK_NETWORK_VALUE_ACCOUNTING_MODEL =
  "canonical-exact-work-network-q8-v1";
const POWB_TOKEN_ID =
  "a3d0bc8528f91dfc52400a885bed7e49235396aa82aa9f95db41be629f1d5562";
const BOND_TOKEN_IDS = new Set([POWB_TOKEN_ID, INCB_TOKEN_ID]);
const BOND_TAGS = [
  {
    kind: INFINITY_BOND_KIND,
    label: "Infinity Bond",
    memo: INFINITY_BOND_MEMO,
  },
  {
    kind: INCEPTION_BOND_KIND,
    label: "Inception Bond",
    memo: INCEPTION_BOND_MEMO,
  },
];
const ID_REGISTRATION_PRICE_SATS = 1_000;
const ID_REGISTRY_ADDRESSES = {
  livenet: "bc1qfwytlzyr3ym3enz2eutwtjsf9kkf6uqkjydk3e",
};
const TOKEN_SALE_AUTH_VERSION = "pwt-sale-v1";
const WORK_TOKEN_TICKER = "WORK";
const WORK_TOKEN_MAX_SUPPLY_ATOMS = (
  21_000_000n * BigInt(WORK_UNIT_SCALE_TEXT)
).toString();
const TOKEN_SALE_AUTH_VERSIONS = new Set([
  TOKEN_SALE_AUTH_VERSION,
  "pwt-sale-v2",
  "pwt-sale-v3",
]);
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
  "inception-bond",
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
const TOKEN_PENDING_MINT_WITNESS_LIMIT = 32;

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

const BITCOIN_GENESIS_TIME_MS = Date.UTC(2009, 0, 3, 18, 15, 5);

function plausibleBitcoinEventTime(...values) {
  for (const value of values) {
    if (value === null || value === undefined || value === "") {
      continue;
    }
    const parsed = value instanceof Date ? value.getTime() : Date.parse(value);
    if (Number.isFinite(parsed) && parsed >= BITCOIN_GENESIS_TIME_MS) {
      return value;
    }
  }
  return undefined;
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
  const offsetRaw = String(params.get("offset") ?? "").trim();
  const offset = cursorRaw
    ? cursor.offset
    : offsetRaw
      ? boundedInteger(offsetRaw, 0, 0, 100_000_000)
      : page * limit;
  const snapshotId =
    cursor.snapshotId ||
    normalizedSnapshotId(
      params.get("snapshot") ?? params.get("snapshotId") ?? "",
    );
  const query = [
    "q",
    "search",
    "txid",
    "transaction",
    "transactionId",
  ]
    .map((key) => String(params.get(key) ?? "").trim())
    .find(Boolean)
    ?.toLowerCase() ?? "";

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
    const amountMatch =
      /^([\d,]+(?:\.\d{1,8})?)\s+([A-Z0-9]{1,16})$/u.exec(tag.trim());
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
    const amountMatch =
      /^([\d,]+(?:\.\d{1,8})?)\s+([A-Z0-9]{1,16})$/u.exec(tag.trim());
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
  const tokenId = String(payload?.tokenId ?? "").trim().toLowerCase();
  const workAmount = isWorkTokenId(tokenId)
    ? workAmountProjection(payload)
    : null;
  const amount = workAmount
    ? workAmount.amount
    : isBondTokenId(tokenId)
      ? exactBondUnits(payload?.amount ?? payload?.tokenAmount, {
          positive: true,
        })
    : rowNumber(payload, "amount") ||
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
    ...(workAmount
      ? {
          amountAtoms: workAmount.amountAtoms,
          decimals: WORK_DECIMALS,
          unitScale: WORK_UNIT_SCALE_TEXT,
        }
      : {}),
    arbSats: rowNumber(payload, "arbSats"),
    buyerAddress,
    canonicalMinerFeeCovered: payload?.canonicalMinerFeeCovered === true,
    canonicalMinerFeeSats: rowNumber(payload, "canonicalMinerFeeSats"),
    closedMinerFeeCanonical:
      payload?.canonicalMinerFeeCovered === true &&
      String(payload?.kind ?? "").trim().toLowerCase() === "token-sale",
    closedMinerFeeSource:
      payload?.canonicalMinerFeeCovered === true
        ? String(payload?.minerFeeSource ?? "").trim()
        : String(payload?.closedMinerFeeSource ?? "").trim(),
    confirmed: payload?.confirmed === true,
    creditAmountMoved: isBondTokenId(tokenId)
      ? exactBondUnits(payload?.creditAmountMoved ?? amount, {
          positive: true,
        })
      : rowNumber(payload, "creditAmountMoved"),
    creditFloorAtConfirmSats: rowNumber(payload, "creditFloorAtConfirmSats"),
    creditLiveFloorSats: rowNumber(payload, "creditLiveFloorSats"),
    creditLiveValueSats: rowNumber(payload, "creditLiveValueSats"),
    creditValueAtConfirmSats: rowNumber(payload, "creditValueAtConfirmSats"),
    createdAt: dateIso(
      payload?.createdAt ?? payload?.timestamp ?? payload?.blockTime,
    ),
    dataBytes: rowNumber(payload, "dataBytes"),
    closedMinerFeeSats:
      rowNumber(payload, "closedMinerFeeSats") ||
      rowNumber(payload, "minerFeeSats"),
    frozenNetworkValueSats: rowNumber(payload, "frozenNetworkValueSats"),
    listingId: String(payload?.listingId ?? "").trim().toLowerCase(),
    liveNetworkValueSats: rowNumber(payload, "liveNetworkValueSats"),
    marketplaceMutationFeeSats: rowNumber(payload, "marketplaceMutationFeeSats"),
    minerFeeSats: rowNumber(payload, "minerFeeSats"),
    minerFeeSource: String(payload?.minerFeeSource ?? "").trim(),
    network: payload?.network,
    paidSats: rowNumber(payload, "paidSats") || rowNumber(payload, "amountSats"),
    priceSats,
    registryAddress,
    salePaymentSats: rowNumber(payload, "salePaymentSats"),
    sellerAddress,
    ticker,
    tokenId,
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
  const workAmount = isWorkTokenId(tokenId)
    ? workAmountProjection(payload)
    : null;
  const normalizedTicker = String(ticker || saleAuthorization.ticker || "").trim();
  return {
    amount: workAmount
      ? workAmount.amount
      : isBondTokenId(tokenId)
        ? exactBondUnits(
            payload?.amount ?? saleAuthorization?.amount,
            { positive: true },
          )
      : rowNumber(payload, "amount") ||
        rowNumber(saleAuthorization, "amount") ||
        amount,
    ...(workAmount
      ? {
          amountAtoms: workAmount.amountAtoms,
          decimals: WORK_DECIMALS,
          unitScale: WORK_UNIT_SCALE_TEXT,
        }
      : {}),
    canonicalMinerFeeCovered: payload?.canonicalMinerFeeCovered === true,
    canonicalMinerFeeSats: rowNumber(payload, "canonicalMinerFeeSats"),
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
    minerFeeSource: String(payload?.minerFeeSource ?? "").trim(),
    network: payload?.network,
    priceSats:
      rowNumber(payload, "priceSats") ||
      rowNumber(saleAuthorization, "priceSats") ||
      priceSats,
    registryAddress,
    saleAuthorization,
    sealDataBytes: rowNumber(payload, "sealDataBytes"),
    sealFrozenNetworkValueSats: rowNumber(payload, "sealFrozenNetworkValueSats"),
    sealAt: dateIso(payload?.sealAt),
    sealConfirmed:
      typeof payload?.sealConfirmed === "boolean"
        ? payload.sealConfirmed
        : undefined,
    sealLiveNetworkValueSats: rowNumber(payload, "sealLiveNetworkValueSats"),
    sealMinerFeeCanonical:
      payload?.sealMinerFeeCanonical === true ||
      (payload?.canonicalMinerFeeCovered === true &&
        String(payload?.kind ?? "").trim().toLowerCase() ===
          "token-listing-sealed"),
    sealMinerFeeSource:
      payload?.canonicalMinerFeeCovered === true &&
      String(payload?.kind ?? "").trim().toLowerCase() ===
        "token-listing-sealed"
        ? String(payload?.minerFeeSource ?? "").trim()
        : String(payload?.sealMinerFeeSource ?? "").trim(),
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
    TOKEN_SALE_AUTH_VERSIONS.has(authorization?.version) &&
    (
      authorization?.version === TOKEN_SALE_AUTH_VERSION ||
      (
        (authorization?.version === "pwt-sale-v2" ||
          authorization?.version === "pwt-sale-v3") &&
        isWorkTokenId(authorization?.tokenId) &&
        String(authorization?.ticker ?? "").trim().toUpperCase() ===
          WORK_TOKEN_TICKER
      )
    ) &&
    authorization.anchorType === TOKEN_LISTING_ANCHOR_TYPE &&
    authorization.anchorVout === TOKEN_LISTING_ANCHOR_VOUT &&
    authorization.anchorValueSats === TOKEN_LISTING_ANCHOR_VALUE_SATS &&
    authorization.anchorSigHashType === TOKEN_LISTING_ANCHOR_SIGHASH_TYPE &&
    /^[0-9a-f]+$/u.test(authorization.anchorScriptPubKey ?? "") &&
    validPublicKeyHex(authorization.sellerPublicKey ?? "")
  );
}

function compareTokenHolderBalances(left, right) {
  if (isWorkTokenId(left?.tokenId) && isWorkTokenId(right?.tokenId)) {
    const leftAtoms = BigInt(String(left?.balanceAtoms ?? "0"));
    const rightAtoms = BigInt(String(right?.balanceAtoms ?? "0"));
    if (leftAtoms !== rightAtoms) {
      return leftAtoms > rightAtoms ? -1 : 1;
    }
  } else if (isBondTokenId(left?.tokenId) && isBondTokenId(right?.tokenId)) {
    const leftUnits = integerBigInt(left?.balance) ?? 0n;
    const rightUnits = integerBigInt(right?.balance) ?? 0n;
    if (leftUnits !== rightUnits) {
      return leftUnits > rightUnits ? -1 : 1;
    }
  } else {
    const difference =
      Number(right?.balance ?? 0) - Number(left?.balance ?? 0);
    if (difference !== 0) {
      return difference;
    }
  }
  return String(left?.address ?? "").localeCompare(
    String(right?.address ?? ""),
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

function tokenListingSealConfirmedFromTransaction(row, sealTxid) {
  return (
    validTxid(sealTxid) &&
    normalizedLowerText(row?.seal_tx_status) === "confirmed"
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
  const workAmount = isWorkTokenId(tokenId)
    ? workAmountProjection(item)
    : null;

  return {
    ...item,
    amount: workAmount
      ? workAmount.amount
      : isBondTokenId(tokenId)
        ? exactBondUnits(item?.amount ?? saleAuthorization?.amount, {
            positive: true,
          })
      : rowNumber(item, "amount") ||
        rowNumber(saleAuthorization, "amount"),
    ...(workAmount
      ? {
          amountAtoms: workAmount.amountAtoms,
          decimals: WORK_DECIMALS,
          unitScale: WORK_UNIT_SCALE_TEXT,
        }
      : {}),
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
  const tokenId = String(payload?.tokenId ?? "").trim().toLowerCase();
  const workAmount = isWorkTokenId(tokenId)
    ? workAmountProjection(payload)
    : null;
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
    amount: workAmount
      ? workAmount.amount
      : isBondTokenId(tokenId)
        ? exactBondUnits(payload?.amount ?? payload?.tokenAmount, {
            positive: true,
          })
      : rowNumber(payload, "amount") ||
        rowNumber(payload, "tokenAmount") ||
        amount,
    ...(workAmount
      ? {
          amountAtoms: workAmount.amountAtoms,
          decimals: WORK_DECIMALS,
          unitScale: WORK_UNIT_SCALE_TEXT,
        }
      : {}),
    closedAt,
    closedConfirmed: payload?.confirmed === true,
    closedFrozenNetworkValueSats: rowNumber(
      payload,
      "closedFrozenNetworkValueSats",
    ),
    closedLiveNetworkValueSats: rowNumber(payload, "closedLiveNetworkValueSats"),
    closedMinerFeeSats: rowNumber(payload, "closedMinerFeeSats"),
    canonicalMinerFeeCovered: payload?.canonicalMinerFeeCovered === true,
    canonicalMinerFeeSats: rowNumber(payload, "canonicalMinerFeeSats"),
    closedMinerFeeCanonical: payload?.canonicalMinerFeeCovered === true,
    closedMinerFeeSource:
      payload?.canonicalMinerFeeCovered === true
        ? String(payload?.minerFeeSource ?? "").trim()
        : String(payload?.closedMinerFeeSource ?? "").trim(),
    closedTxid: String(payload?.txid ?? "").trim().toLowerCase(),
    confirmed: true,
    createdAt,
    dataBytes: rowNumber(payload, "dataBytes"),
    frozenNetworkValueSats: rowNumber(payload, "frozenNetworkValueSats"),
    liveNetworkValueSats: rowNumber(payload, "liveNetworkValueSats"),
    marketplaceMutationFeeSats: rowNumber(payload, "marketplaceMutationFeeSats"),
    minerFeeSats: rowNumber(payload, "minerFeeSats"),
    minerFeeSource: String(payload?.minerFeeSource ?? "").trim(),
    listingId: String(payload?.listingId ?? "").trim().toLowerCase(),
    network: payload?.network,
    priceSats:
      rowNumber(payload, "priceSats") ||
      rowNumber(payload, "salePriceSats") ||
      priceSats,
    registryAddress,
    saleAuthorization: objectRecord(payload?.saleAuthorization),
    sealAt: dateIso(payload?.sealAt),
    sealConfirmed: payload?.sealConfirmed === true,
    sealDataBytes: rowNumber(payload, "sealDataBytes"),
    sealMinerFeeSats: rowNumber(payload, "sealMinerFeeSats"),
    sealTxid: String(payload?.sealTxid ?? "").trim().toLowerCase(),
    sellerAddress,
    ticker,
    tokenId,
  };
}

function tokenTransferFromEventPayload(payload, row = {}) {
  const ticker = String(row.ticker ?? payload?.ticker ?? "").trim();
  const tokenId = String(payload?.tokenId ?? row.token_id ?? "")
    .trim()
    .toLowerCase();
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
  const workAmount = isWorkTokenId(tokenId)
    ? workAmountProjection(payload)
    : null;
  const amount = workAmount
    ? workAmount.amount
    : isBondTokenId(tokenId)
      ? exactBondUnits(payload?.amount ?? payload?.tokenAmount, {
          positive: true,
        })
    : rowNumber(payload, "amount") ||
      rowNumber(payload, "tokenAmount") ||
      tokenTransferAmountFromTags(payload, ticker);
  return {
    ...canonicalEventIdentityDetails({
      ...payload,
      eventId: payload?.eventId ?? row?.event_id,
    }),
    amount,
    ...(workAmount
      ? {
          amountAtoms: workAmount.amountAtoms,
          decimals: WORK_DECIMALS,
          unitScale: WORK_UNIT_SCALE_TEXT,
        }
      : {}),
    blockHash: String(
      row?.block_hash ?? payload?.blockHash ?? payload?._powBlockHash ?? "",
    )
      .trim()
      .toLowerCase(),
    blockHeight:
      rowNumber(row, "block_height") || rowNumber(payload, "blockHeight"),
    blockIndex: rowNumber(
      {
        value:
          row?.block_index ?? payload?.blockIndex ?? payload?._powBlockIndex,
      },
      "value",
    ),
    confirmed:
      row.status === "confirmed" || payload?.confirmed === true,
    createdAt: dateIso(
      payload?.createdAt ?? row.event_time ?? row.block_time ?? row.created_at,
    ),
    dataBytes: rowNumber(payload, "dataBytes"),
    arbSats: rowNumber(payload, "arbSats"),
    creditAmountMoved: isBondTokenId(tokenId)
      ? exactBondUnits(payload?.creditAmountMoved ?? amount, {
          positive: true,
        })
      : rowNumber(payload, "creditAmountMoved"),
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
    tokenId,
    txid: String(payload?.txid ?? row.txid ?? "").trim().toLowerCase(),
  };
}

function exactSafeInteger(value, { positive = false } = {}) {
  return safeIntegerNumber(
    canonicalIntegerText(value, { allowZero: !positive }),
  );
}

function isBondTokenId(tokenId) {
  return BOND_TOKEN_IDS.has(String(tokenId ?? "").trim().toLowerCase());
}

function exactBondUnits(value, { positive = false, signed = false } = {}) {
  return canonicalIntegerText(value, {
    allowNegative: signed,
    allowZero: !positive,
  });
}

function incbExactIssuanceMetadata(payload = {}) {
  const fieldNames = [
    "attachedWorkAmountAtoms",
    "attachedWorkLiveValueAtSendQ8",
    "issuanceDustQ8",
    "issuanceNetworkValueQ8",
    "issuanceValueSnapshotWorkNetworkValueQ8",
  ];
  const present = fieldNames.some(
    (field) =>
      payload?.[field] !== undefined &&
      payload?.[field] !== null &&
      payload?.[field] !== "",
  );
  if (!present) {
    return { complete: false, fault: "", present: false };
  }

  const exact = {
    attachedWorkAmountAtoms: canonicalIntegerText(
      payload?.attachedWorkAmountAtoms,
      { allowZero: true },
    ),
    attachedWorkLiveValueAtSendQ8: canonicalIntegerText(
      payload?.attachedWorkLiveValueAtSendQ8,
    ),
    issuanceDustQ8: canonicalIntegerText(payload?.issuanceDustQ8),
    issuanceNetworkValueQ8: canonicalIntegerText(
      payload?.issuanceNetworkValueQ8,
      { allowZero: false },
    ),
    issuanceValueSnapshotWorkNetworkValueQ8: canonicalIntegerText(
      payload?.issuanceValueSnapshotWorkNetworkValueQ8,
      { allowZero: false },
    ),
  };
  if (Object.values(exact).some((value) => !value)) {
    return {
      ...exact,
      complete: false,
      fault:
        "fractional exact issuance metadata is incomplete or noncanonical",
      present: true,
    };
  }

  const directUnitsText = canonicalIntegerText(
    payload?.directProofIssuanceUnits ??
      payload?.proofPaymentSats ??
      payload?.bondRecipientAmountSats,
    { allowZero: false },
  );
  if (!directUnitsText) {
    return {
      ...exact,
      complete: false,
      fault: "direct proof issuance units are missing or noncanonical",
      present: true,
    };
  }

  const workMaxSupplyAtoms = 21_000_000n * 100_000_000n;
  const attachedWorkAmountAtoms = BigInt(exact.attachedWorkAmountAtoms);
  const attachedWorkLiveValueAtSendQ8 = BigInt(
    exact.attachedWorkLiveValueAtSendQ8,
  );
  const issuanceDustQ8 = BigInt(exact.issuanceDustQ8);
  const issuanceNetworkValueQ8 = BigInt(exact.issuanceNetworkValueQ8);
  const snapshotWorkNetworkValueQ8 = BigInt(
    exact.issuanceValueSnapshotWorkNetworkValueQ8,
  );
  const directUnits = BigInt(directUnitsText);
  const amount = issuanceNetworkValueQ8 / BOND_VALUE_Q8_SCALE;
  const attachedUnits =
    attachedWorkLiveValueAtSendQ8 / BOND_VALUE_Q8_SCALE;
  const expectedAttachedValueQ8 =
    (attachedWorkAmountAtoms * snapshotWorkNetworkValueQ8) /
    workMaxSupplyAtoms;
  let declaredAttachedWorkAmountAtoms = "";
  try {
    declaredAttachedWorkAmountAtoms = parseWorkAmountToAtoms(
      payload?.attachedWorkAmount,
      { allowZero: true },
    );
  } catch {
    declaredAttachedWorkAmountAtoms = "";
  }
  if (
    declaredAttachedWorkAmountAtoms !== attachedWorkAmountAtoms.toString() ||
    attachedWorkLiveValueAtSendQ8 !== expectedAttachedValueQ8 ||
    issuanceNetworkValueQ8 !==
      directUnits * BOND_VALUE_Q8_SCALE + attachedWorkLiveValueAtSendQ8 ||
    issuanceDustQ8 !== issuanceNetworkValueQ8 % BOND_VALUE_Q8_SCALE
  ) {
    return {
      ...exact,
      complete: false,
      fault:
        declaredAttachedWorkAmountAtoms !== attachedWorkAmountAtoms.toString()
          ? "fractional exact issuance metadata disagrees with projected values"
          : "fractional exact issuance metadata does not conserve value",
      present: true,
    };
  }

  const declaredUnitFields = [
    ["amount", amount],
    ["issuanceAmount", amount],
    ["confirmedIssuanceUnits", amount],
    ["attachedWorkIssuanceUnits", attachedUnits],
  ];
  for (const [field, expected] of declaredUnitFields) {
    const declared = canonicalIntegerText(payload?.[field]);
    // Legacy JSON numbers above 2^53 are already lossy compatibility fields.
    // Exact Q8 metadata is authoritative and reconstructs the canonical unit
    // value. Canonical string or safe-number declarations still have to agree.
    if (declared && BigInt(declared) !== expected) {
      return {
        ...exact,
        complete: false,
        fault: `exact issuance metadata disagrees with ${field}`,
        present: true,
      };
    }
  }

  return {
    ...exact,
    amount: amount.toString(),
    attachedWorkIssuanceUnits: attachedUnits.toString(),
    complete: true,
    confirmedIssuanceUnits: amount.toString(),
    directProofIssuanceUnits: directUnits.toString(),
    fault: "",
    issuanceAmount: amount.toString(),
    present: true,
  };
}

function incbIssuanceMetadataFault(payload, row = {}) {
  const tokenId = String(payload?.tokenId ?? row?.token_id ?? "")
    .trim()
    .toLowerCase();
  if (tokenId !== INCB_TOKEN_ID) {
    return "";
  }
  const effectiveStatus = String(row?.effective_status ?? row?.status ?? "")
    .trim()
    .toLowerCase();
  if (effectiveStatus !== "confirmed" && payload?.confirmed !== true) {
    return "";
  }
  if (
    String(payload?.issuanceAccountingModel ?? "") !==
    INCB_ISSUANCE_ACCOUNTING_MODEL
  ) {
    return "missing canonical pre-bond live-value accounting model";
  }
  const minterAddress = String(payload?.minterAddress ?? "").trim();
  const bondRecipientAddress = String(
    payload?.bondRecipientAddress ?? "",
  ).trim();
  const bondRecipientAmount = exactSafeInteger(
    payload?.bondRecipientAmountSats,
    { positive: true },
  );
  const bondRecipientVout = exactSafeInteger(payload?.bondRecipientVout);
  if (
    !minterAddress ||
    bondRecipientAddress !== minterAddress ||
    bondRecipientAmount === null ||
    bondRecipientVout === null ||
    payload?.issuanceValuationFixedAtSend !== true ||
    Number(payload?.issuanceUnitSats) !== 1
  ) {
    return "canonical Inception Bond recipient is missing";
  }
  const exactIssuance = incbExactIssuanceMetadata(payload);
  if (exactIssuance.fault) {
    return exactIssuance.fault;
  }
  const amountText = exactIssuance.complete
    ? exactIssuance.amount
    : exactBondUnits(payload?.amount, { positive: true });
  const issuanceAmountText = exactIssuance.complete
    ? exactIssuance.issuanceAmount
    : exactBondUnits(payload?.issuanceAmount, { positive: true });
  const confirmedIssuanceUnitsText = exactIssuance.complete
    ? exactIssuance.confirmedIssuanceUnits
    : exactBondUnits(payload?.confirmedIssuanceUnits, { positive: true });
  const directProofIssuanceUnitsText = exactIssuance.complete
    ? exactIssuance.directProofIssuanceUnits
    : exactBondUnits(payload?.directProofIssuanceUnits);
  const attachedWorkIssuanceUnitsText = exactIssuance.complete
    ? exactIssuance.attachedWorkIssuanceUnits
    : exactBondUnits(payload?.attachedWorkIssuanceUnits);
  const amount = integerBigInt(amountText, { allowZero: false });
  const issuanceAmount = integerBigInt(issuanceAmountText, {
    allowZero: false,
  });
  const confirmedIssuanceUnits = integerBigInt(confirmedIssuanceUnitsText, {
    allowZero: false,
  });
  const directProofIssuanceUnits = integerBigInt(
    directProofIssuanceUnitsText,
  );
  const attachedWorkIssuanceUnits = integerBigInt(
    attachedWorkIssuanceUnitsText,
  );
  if (
    amount === null ||
    issuanceAmount !== amount ||
    confirmedIssuanceUnits !== amount ||
    directProofIssuanceUnits === null ||
    directProofIssuanceUnits <= 0n ||
    attachedWorkIssuanceUnits === null ||
    directProofIssuanceUnits + attachedWorkIssuanceUnits !== amount
  ) {
    return "issuance units are missing or do not conserve supply";
  }
  const issuanceNetworkValueSats = exactIssuance.complete
    ? null
    : Number(payload?.issuanceNetworkValueSats);
  const issuanceDustSats = exactIssuance.complete
    ? null
    : Number(payload?.issuanceDustSats);
  const issuanceFloorSats = exactIssuance.complete
    ? null
    : Number(payload?.issuanceFloorSats);
  const attachedWorkLiveValueAtSendSats = exactIssuance.complete
    ? null
    : Number(payload?.attachedWorkLiveValueAtSendSats);
  if (
    !exactIssuance.complete &&
    (!Number.isFinite(issuanceNetworkValueSats) ||
      issuanceNetworkValueSats <= 0 ||
      BigInt(Math.floor(issuanceNetworkValueSats)) !== amount ||
      !Number.isFinite(issuanceDustSats) ||
      issuanceDustSats < 0 ||
      issuanceDustSats >= 1 ||
      Math.abs(
        issuanceDustSats - (issuanceNetworkValueSats - Number(amount)),
      ) > 1e-6 ||
      !Number.isFinite(issuanceFloorSats) ||
      issuanceFloorSats < 1 ||
      Math.abs(issuanceFloorSats - issuanceNetworkValueSats / Number(amount)) >
        1e-9 ||
      !Number.isFinite(attachedWorkLiveValueAtSendSats) ||
      attachedWorkLiveValueAtSendSats < 0 ||
      BigInt(Math.floor(attachedWorkLiveValueAtSendSats)) !==
        attachedWorkIssuanceUnits ||
      Math.abs(
        issuanceNetworkValueSats -
          (Number(directProofIssuanceUnits) +
            attachedWorkLiveValueAtSendSats),
      ) > 1e-6)
  ) {
    return "issuance value, dust, or one-proof unit floor is inconsistent";
  }
  const directProofPayment = exactSafeInteger(
    payload?.proofPaymentSats ?? payload?.paidSats,
  );
  if (
    BigInt(directProofPayment ?? -1) !== directProofIssuanceUnits ||
    BigInt(bondRecipientAmount ?? -1) !== directProofIssuanceUnits
  ) {
    return "direct issuance does not equal the confirmed proof payment";
  }
  if (exactIssuance.complete) {
    if (
      BigInt(exactIssuance.issuanceValueSnapshotWorkNetworkValueQ8) <= 0n
    ) {
      return "attached WORK valuation basis is missing or inconsistent";
    }
  } else if (attachedWorkIssuanceUnits > 0n) {
    const attachedWorkAmount = exactSafeInteger(payload?.attachedWorkAmount, {
      positive: true,
    });
    const attachedWorkLiveFloorAtSendSats = Number(
      payload?.attachedWorkLiveFloorAtSendSats,
    );
    if (
      attachedWorkAmount === null ||
      !Number.isFinite(attachedWorkLiveFloorAtSendSats) ||
      attachedWorkLiveFloorAtSendSats <= 0 ||
      Math.abs(
        attachedWorkLiveValueAtSendSats -
          attachedWorkAmount * attachedWorkLiveFloorAtSendSats,
      ) > 1e-5
    ) {
      return "attached WORK valuation basis is missing or inconsistent";
    }
  } else if (attachedWorkLiveValueAtSendSats !== 0) {
    return "proof-only issuance carries attached WORK value";
  }
  const checkpointMode = String(payload?.issuanceCheckpointMode ?? "");
  const checkpointHeight = exactSafeInteger(
    payload?.issuanceCheckpointBlockHeight,
    { positive: true },
  );
  const checkpointHash = String(
    payload?.issuanceCheckpointBlockHash ?? "",
  )
    .trim()
    .toLowerCase();
  const checkpointIndex = exactSafeInteger(
    payload?.issuanceCheckpointBlockIndex,
  );
  const checkpointWorkNetworkValueSats = exactIssuance.complete
    ? null
    : Number(payload?.issuanceValueSnapshotWorkNetworkValueSats);
  const attachedWorkLiveFloorAtSendSats = exactIssuance.complete
    ? null
    : Number(payload?.attachedWorkLiveFloorAtSendSats);
  if (
    checkpointMode !== "bond-transaction-provenance" ||
    checkpointHeight === null ||
    !/^[0-9a-f]{64}$/u.test(checkpointHash) ||
    checkpointIndex === null ||
    (exactIssuance.complete
      ? BigInt(exactIssuance.issuanceValueSnapshotWorkNetworkValueQ8) <= 0n
      : !Number.isFinite(checkpointWorkNetworkValueSats) ||
        checkpointWorkNetworkValueSats <= 0 ||
        !Number.isFinite(attachedWorkLiveFloorAtSendSats) ||
        attachedWorkLiveFloorAtSendSats <= 0 ||
        Math.abs(
          attachedWorkLiveFloorAtSendSats -
            checkpointWorkNetworkValueSats / 21_000_000,
        ) > 1e-9)
  ) {
    return "pre-bond valuation checkpoint is missing or inconsistent";
  }
  const valueSnapshotHeight = exactSafeInteger(
    payload?.issuanceValueSnapshotBlockHeight,
    { positive: true },
  );
  const valueSnapshotHash = String(
    payload?.issuanceValueSnapshotBlockHash ?? "",
  )
    .trim()
    .toLowerCase();
  const valueSnapshotCanonicalSummaryHash = String(
    payload?.issuanceValueSnapshotCanonicalSummaryHash ?? "",
  )
    .trim()
    .toLowerCase();
  const valueSnapshotGeneratedAt = String(
    payload?.issuanceValueSnapshotGeneratedAt ?? "",
  ).trim();
  if (
    payload?.issuanceValueSnapshotModel !== INCB_VALUE_SNAPSHOT_MODEL ||
    payload?.issuanceValueSnapshotMode !== "canonical-summary-refresh" ||
    valueSnapshotHeight !== checkpointHeight - 1 ||
    !/^[0-9a-f]{64}$/u.test(valueSnapshotHash) ||
    !/^[0-9a-f]{64}$/u.test(valueSnapshotCanonicalSummaryHash) ||
    !String(payload?.issuanceValueSnapshotId ?? "").trim() ||
    !Number.isFinite(Date.parse(valueSnapshotGeneratedAt))
  ) {
    return "H-1 canonical WORK value snapshot provenance is missing or inconsistent";
  }
  const txid = String(payload?.txid ?? row?.txid ?? "")
    .trim()
    .toLowerCase();
  const canonicalBlockHeight = exactSafeInteger(
    row?.block_height ??
      row?.transaction_block_height ??
      payload?.blockHeight,
    { positive: true },
  );
  const canonicalBlockHash = String(
    row?.block_hash ?? payload?.blockHash ?? payload?._powBlockHash ?? "",
  )
    .trim()
    .toLowerCase();
  const canonicalBlockIndex = exactSafeInteger(
    row?.block_index ?? payload?.blockIndex ?? payload?._powBlockIndex,
  );
  if (
    String(payload?.ticker ?? "").trim().toUpperCase() !== "INCB" ||
    String(payload?.sourceBondTxid ?? "").trim().toLowerCase() !== txid ||
    !/^[0-9a-f]{64}$/u.test(txid) ||
    String(payload?.validationMode ?? "") !==
      "canonical-incb-bond-projection" ||
    Number(payload?.amountSats) !== 0 ||
    canonicalBlockHeight !== checkpointHeight ||
    canonicalBlockHash !== checkpointHash ||
    canonicalBlockIndex !== checkpointIndex
  ) {
    return "mint is not bound to its canonical Inception Bond projection";
  }
  return "";
}

function assertCanonicalIncbDefinition(token, context) {
  if (String(token?.tokenId ?? "").trim().toLowerCase() !== INCB_TOKEN_ID) {
    return;
  }
  if (
    token?.issuanceAccountingModel !== INCB_ISSUANCE_ACCOUNTING_MODEL ||
    token?.issuanceValuationFixedAtSend !== true ||
    Number(token?.issuanceUnitSats) !== 1
  ) {
    throw new Error(
      `${context} cannot publish INCB without the canonical pre-bond live-value definition.`,
    );
  }
}

function canonicalLegacyDecimalValue(payload, field) {
  const value = payload?.[field];
  if (typeof value === "string") {
    const text = value.trim();
    const q8 = q8TextFromDecimal(text);
    if (q8) {
      return decimalTextFromQ8(q8);
    }
    const exactDecimal = /^(0|[1-9][0-9]*)(?:\.([0-9]+))?$/u.exec(text);
    if (!exactDecimal) {
      throw new Error(`Invalid exact legacy decimal alias for ${field}.`);
    }
    const fraction = (exactDecimal[2] ?? "").replace(/0+$/u, "");
    return `${exactDecimal[1]}${fraction ? `.${fraction}` : ""}`;
  }
  return rowNumber(payload, field);
}

function tokenMintFromEventPayload(payload, row = {}) {
  // node-postgres decodes JSONB numbers as binary JavaScript Numbers. Legacy
  // INCB rows predate explicit Q8 fields, so preserve the exact decimal text
  // selected alongside the JSONB payload before validating or aggregating it.
  // Exact Q8 metadata on current rows remains authoritative.
  const legacyDecimalColumns = [
    [
      "attachedWorkLiveFloorAtSendSats",
      "attached_work_live_floor_at_send_sats_text",
    ],
    [
      "attachedWorkLiveValueAtSendSats",
      "attached_work_live_value_at_send_sats_text",
    ],
    ["issuanceDustSats", "issuance_dust_sats_text"],
    ["issuanceFloorSats", "issuance_floor_sats_text"],
    ["issuanceNetworkValueSats", "issuance_network_value_sats_text"],
    [
      "issuanceValueSnapshotWorkNetworkValueSats",
      "issuance_value_snapshot_work_network_value_sats_text",
    ],
  ];
  const exactLegacyPayload = { ...payload };
  for (const [payloadField, rowField] of legacyDecimalColumns) {
    const exactDecimal = String(row?.[rowField] ?? "").trim();
    if (exactDecimal) {
      exactLegacyPayload[payloadField] = exactDecimal;
    }
  }
  payload = exactLegacyPayload;
  const tagNumbers = tokenMarketNumbersFromTags(payload);
  const tokenId = String(payload?.tokenId ?? row.token_id ?? "")
    .trim()
    .toLowerCase();
  const workAmount = isWorkTokenId(tokenId)
    ? workAmountProjection(payload)
    : null;
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

  const issuanceFault = incbIssuanceMetadataFault(payload, row);
  if (issuanceFault) {
    throw new Error(
      `Proof index INCB mint ${String(payload?.txid ?? row?.txid ?? "unknown")} is invalid: ${issuanceFault}.`,
    );
  }
  const exactIncbIssuance =
    tokenId === INCB_TOKEN_ID
      ? incbExactIssuanceMetadata(payload)
      : { complete: false };
  const bondAmount = isBondTokenId(tokenId)
    ? tokenId === INCB_TOKEN_ID && exactIncbIssuance.complete
      ? exactIncbIssuance.amount
      : exactBondUnits(payload?.amount ?? payload?.tokenAmount, {
          positive: true,
        })
    : "";

  return {
    ...canonicalEventIdentityDetails({
      ...payload,
      eventId: payload?.eventId ?? row?.event_id,
    }),
    amount: workAmount
      ? workAmount.amount
      : bondAmount ||
        rowNumber(payload, "amount") ||
        rowNumber(payload, "tokenAmount") ||
        tagNumbers.amount,
    ...(workAmount
      ? {
          amountAtoms: workAmount.amountAtoms,
          decimals: WORK_DECIMALS,
          unitScale: WORK_UNIT_SCALE_TEXT,
        }
      : {}),
    amountSats: rowNumber(payload, "amountSats"),
    bondRecipientAddress: String(payload?.bondRecipientAddress ?? "").trim(),
    bondRecipientAmountSats: rowNumber(payload, "bondRecipientAmountSats"),
    bondRecipientVout: rowNumber(payload, "bondRecipientVout"),
    attachedWorkAmount: rowNumber(payload, "attachedWorkAmount"),
    ...(exactIncbIssuance.complete
      ? {
          attachedWorkAmountAtoms:
            exactIncbIssuance.attachedWorkAmountAtoms,
          attachedWorkLiveValueAtSendQ8:
            exactIncbIssuance.attachedWorkLiveValueAtSendQ8,
        }
      : {}),
    attachedWorkLiveFloorAtSendSats: exactIncbIssuance.complete
      ? decimalTextFromQ8(
          (
            BigInt(
              exactIncbIssuance.issuanceValueSnapshotWorkNetworkValueQ8,
            ) / 21_000_000n
          ).toString(),
        )
      : canonicalLegacyDecimalValue(
          payload,
          "attachedWorkLiveFloorAtSendSats",
        ),
    ...(exactIncbIssuance.complete
      ? {
          attachedWorkLiveFloorAtSendQ8: (
            BigInt(
              exactIncbIssuance.issuanceValueSnapshotWorkNetworkValueQ8,
            ) / 21_000_000n
          ).toString(),
        }
      : {}),
    attachedWorkIssuanceUnits: exactIncbIssuance.complete
      ? exactIncbIssuance.attachedWorkIssuanceUnits
      : rowNumber(payload, "attachedWorkIssuanceUnits"),
    attachedWorkLiveValueAtSendSats: exactIncbIssuance.complete
      ? decimalTextFromQ8(exactIncbIssuance.attachedWorkLiveValueAtSendQ8)
      : canonicalLegacyDecimalValue(
          payload,
          "attachedWorkLiveValueAtSendSats",
        ),
    blockHash: String(
      row?.block_hash ?? payload?.blockHash ?? payload?._powBlockHash ?? "",
    )
      .trim()
      .toLowerCase(),
    blockHeight: rowNumber(row, "block_height") || rowNumber(payload, "blockHeight"),
    blockIndex: rowNumber(
      {
        value:
          row?.block_index ?? payload?.blockIndex ?? payload?._powBlockIndex,
      },
      "value",
    ),
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
    confirmedIssuanceUnits: exactIncbIssuance.complete
      ? exactIncbIssuance.confirmedIssuanceUnits
      : rowNumber(payload, "confirmedIssuanceUnits"),
    directProofIssuanceUnits: exactIncbIssuance.complete
      ? exactIncbIssuance.directProofIssuanceUnits
      : rowNumber(payload, "directProofIssuanceUnits"),
    issuanceAccountingModel: String(
      payload?.issuanceAccountingModel ?? "",
    ),
    issuanceAmount: exactIncbIssuance.complete
      ? exactIncbIssuance.issuanceAmount
      : rowNumber(payload, "issuanceAmount"),
    issuanceDustSats: exactIncbIssuance.complete
      ? decimalTextFromQ8(exactIncbIssuance.issuanceDustQ8)
      : canonicalLegacyDecimalValue(payload, "issuanceDustSats"),
    ...(exactIncbIssuance.complete
      ? { issuanceDustQ8: exactIncbIssuance.issuanceDustQ8 }
      : {}),
    issuanceFloorSats: exactIncbIssuance.complete
      ? decimalTextFromQ8(
          (
            BigInt(exactIncbIssuance.issuanceNetworkValueQ8) /
            BigInt(exactIncbIssuance.confirmedIssuanceUnits)
          ).toString(),
        )
      : canonicalLegacyDecimalValue(payload, "issuanceFloorSats"),
    ...(exactIncbIssuance.complete
      ? {
          issuanceFloorQ8: (
            BigInt(exactIncbIssuance.issuanceNetworkValueQ8) /
            BigInt(exactIncbIssuance.confirmedIssuanceUnits)
          ).toString(),
        }
      : {}),
    issuanceNetworkValueSats: exactIncbIssuance.complete
      ? decimalTextFromQ8(exactIncbIssuance.issuanceNetworkValueQ8)
      : canonicalLegacyDecimalValue(payload, "issuanceNetworkValueSats"),
    ...(exactIncbIssuance.complete
      ? {
          issuanceNetworkValueQ8:
            exactIncbIssuance.issuanceNetworkValueQ8,
        }
      : {}),
    issuanceUnitSats: rowNumber(payload, "issuanceUnitSats"),
    issuanceValuationFixedAtSend:
      payload?.issuanceValuationFixedAtSend === true,
    issuanceCheckpointBlockHash: String(
      payload?.issuanceCheckpointBlockHash ?? "",
    )
      .trim()
      .toLowerCase(),
    issuanceCheckpointBlockHeight: rowNumber(
      payload,
      "issuanceCheckpointBlockHeight",
    ),
    issuanceCheckpointBlockIndex: rowNumber(
      payload,
      "issuanceCheckpointBlockIndex",
    ),
    issuanceCheckpointMode: String(
      payload?.issuanceCheckpointMode ?? "",
    ),
    issuanceValueSnapshotBlockHash: String(
      payload?.issuanceValueSnapshotBlockHash ?? "",
    )
      .trim()
      .toLowerCase(),
    issuanceValueSnapshotBlockHeight: rowNumber(
      payload,
      "issuanceValueSnapshotBlockHeight",
    ),
    issuanceValueSnapshotCanonicalSummaryHash: String(
      payload?.issuanceValueSnapshotCanonicalSummaryHash ?? "",
    )
      .trim()
      .toLowerCase(),
    issuanceValueSnapshotGeneratedAt: String(
      payload?.issuanceValueSnapshotGeneratedAt ?? "",
    ).trim(),
    issuanceValueSnapshotId: String(
      payload?.issuanceValueSnapshotId ?? "",
    ).trim(),
    issuanceValueSnapshotMode: String(
      payload?.issuanceValueSnapshotMode ?? "",
    ).trim(),
    issuanceValueSnapshotModel: String(
      payload?.issuanceValueSnapshotModel ?? "",
    ).trim(),
    issuanceValueSnapshotWorkNetworkValueSats: exactIncbIssuance.complete
      ? decimalTextFromQ8(
          exactIncbIssuance.issuanceValueSnapshotWorkNetworkValueQ8,
        )
      : canonicalLegacyDecimalValue(
          payload,
          "issuanceValueSnapshotWorkNetworkValueSats",
        ),
    ...(exactIncbIssuance.complete
      ? {
          issuanceValueSnapshotWorkNetworkValueQ8:
            exactIncbIssuance.issuanceValueSnapshotWorkNetworkValueQ8,
        }
      : {}),
    minterAddress,
    minerFeeSats: rowNumber(payload, "minerFeeSats"),
    network: payload?.network ?? row.network,
    paidSats:
      rowNumber(payload, "proofPaymentSats") ||
      rowNumber(payload, "paidSats") ||
      rowNumber(payload, "amountSats") ||
      rowNumber(row, "amount_sats"),
    proofPaymentSats: rowNumber(payload, "proofPaymentSats"),
    registryAddress,
    sourceBondTxid: String(payload?.sourceBondTxid ?? "")
      .trim()
      .toLowerCase(),
    sourceKind: String(payload?.sourceKind ?? "").trim().toLowerCase(),
    status: effectiveStatus || undefined,
    ticker,
    tokenId,
    txid: String(payload?.txid ?? row.txid ?? "").trim().toLowerCase(),
    validationMode: String(payload?.validationMode ?? "").trim(),
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

function tokenHistoryCanonicalMarketEventsSql(safeKind, whereClause) {
  const listingKinds =
    "ARRAY['token-listings','token-listing','token-listing-sealed']::text[]";
  const listingId = `lower(COALESCE(
    NULLIF(e.payload->>'listingId', ''),
    NULLIF(cl_event.listing_id, ''),
    e.txid
  ))`;
  const canonicalKey =
    safeKind === "listings"
      ? `'listing:' || ${listingId}`
      : safeKind === "sales"
        ? `'sale:' || lower(e.txid)`
        : safeKind === "closedListings"
          ? `'closed:' || ${listingId} || ':' || lower(e.txid)`
          : `CASE
              WHEN e.kind = ANY(${listingKinds})
                THEN 'listing:' || ${listingId}
              WHEN e.kind = 'token-sale'
                THEN 'sale:' || lower(e.txid)
              WHEN e.kind = 'token-listing-closed'
                THEN 'closed:' || ${listingId} || ':' || lower(e.txid)
              ELSE e.kind || ':' || e.event_id::text
            END`;
  const itemTxid = `CASE
    WHEN e.kind = ANY(${listingKinds}) THEN ${listingId}
    ELSE lower(e.txid)
  END`;
  const itemKindRank = `CASE
    WHEN e.kind = 'token-sale' THEN 0
    WHEN e.kind = 'token-listing-closed' THEN 1
    WHEN e.kind = ANY(${listingKinds}) THEN 2
    ELSE 3
  END`;
  const projectionRank = `CASE
    WHEN e.kind = ANY(ARRAY['token-listings','token-listing']::text[]) THEN 0
    WHEN e.kind = 'token-listing-sealed' THEN 1
    WHEN e.kind = 'token-listing-closed' THEN 1
    WHEN e.kind = 'token-sale' THEN 2
    ELSE 3
  END`;

  return `
    WITH ranked_market_events AS (
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
        cd.metadata AS token_metadata,
        cl_event.listing_id AS linked_listing_id,
        cl_event.seller_address AS listing_seller_address,
        cl_event.buyer_address AS listing_buyer_address,
        cl_event.amount AS listing_amount,
        cl_event.price_sats AS listing_price_sats,
        cl_event.payload AS listing_payload,
        (e.status = 'confirmed') AS history_item_confirmed,
        ${itemTxid} AS history_item_txid,
        ${itemKindRank} AS history_item_kind_rank,
        ROW_NUMBER() OVER (
          PARTITION BY ${canonicalKey}
          ORDER BY
            ${projectionRank} ASC,
            COALESCE(e.event_time, e.block_time, e.created_at) DESC,
            (e.status = 'confirmed') DESC,
            e.txid DESC,
            e.event_id DESC
        ) AS canonical_history_rank
      FROM proof_indexer.events e
      LEFT JOIN proof_indexer.credit_listings cl_event
        ON cl_event.network = e.network
       AND cl_event.listing_id = lower(e.payload->>'listingId')
      LEFT JOIN proof_indexer.credit_definitions cd
        ON cd.network = e.network
       AND cd.token_id = COALESCE(lower(e.payload->>'tokenId'), cl_event.token_id)
      WHERE ${whereClause}
    ),
    canonical_market_events AS (
      SELECT *
      FROM ranked_market_events
      WHERE canonical_history_rank = 1
    )
  `;
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

function tokenHistoryItemIsMarketLogItem(item) {
  return (
    item?.kind === "sale" ||
    item?.kind === "closed-listing" ||
    item?.kind === "listing"
  );
}

function tokenHistoryItemConfirmed(item) {
  if (item?.kind === "sale") {
    return item.sale?.confirmed === true;
  }
  if (item?.kind === "closed-listing") {
    return item.closedListing?.closedConfirmed === true;
  }
  return item?.kind === "listing" && item.listing?.confirmed === true;
}

function tokenHistoryItemKindRank(item) {
  if (item?.kind === "sale") {
    return 0;
  }
  if (item?.kind === "closed-listing") {
    return 1;
  }
  return item?.kind === "listing" ? 2 : 3;
}

function tokenHistoryItemTxid(item) {
  return String(
    item?.txid ?? item?.closedTxid ?? item?.listingId ?? "",
  );
}

function compareTokenHistoryMarketItems(left, right) {
  const leftTime = Date.parse(tokenHistoryItemCreatedAt(left) ?? "");
  const rightTime = Date.parse(tokenHistoryItemCreatedAt(right) ?? "");
  const marketLogPair =
    tokenHistoryItemIsMarketLogItem(left) &&
    tokenHistoryItemIsMarketLogItem(right);
  return (
    (Number.isFinite(rightTime) ? rightTime : 0) -
      (Number.isFinite(leftTime) ? leftTime : 0) ||
    (marketLogPair
      ? Number(tokenHistoryItemConfirmed(right)) -
        Number(tokenHistoryItemConfirmed(left))
      : 0) ||
    tokenHistoryItemTxid(right).localeCompare(tokenHistoryItemTxid(left)) ||
    (marketLogPair
      ? tokenHistoryItemKindRank(left) - tokenHistoryItemKindRank(right)
      : 0)
  );
}

function validTxid(value) {
  return /^[0-9a-f]{64}$/u.test(String(value ?? "").trim().toLowerCase());
}

function tokenListingSealRank(listing) {
  if (!validTxid(listing?.sealTxid)) {
    return 0;
  }
  if (listing?.sealConfirmed !== true) {
    return 1;
  }
  return listing?.sealMinerFeeCanonical === true ? 3 : 2;
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
    sealMinerFeeCanonical:
      sealSource.sealMinerFeeCanonical === true ||
      listing.sealMinerFeeCanonical === true,
    sealMinerFeeSource:
      sealSource.sealMinerFeeSource ?? listing.sealMinerFeeSource,
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
  if (listing?.closedConfirmed !== true) {
    return 1;
  }
  return listing?.closedMinerFeeCanonical === true ? 3 : 2;
}

function tokenListingWithCloseFrom(listing, closeSource) {
  if (!listing || tokenListingCloseRank(closeSource) === 0) {
    return listing;
  }

  return {
    ...listing,
    closedAt: closeSource.closedAt ?? listing.closedAt,
    closedBlockHeight:
      closeSource.closedBlockHeight ??
      closeSource.blockHeight ??
      listing.closedBlockHeight,
    closedBlockIndex:
      closeSource.closedBlockIndex ??
      closeSource.blockIndex ??
      listing.closedBlockIndex,
    closedConfirmed: closeSource.closedConfirmed === true,
    closedDataBytes:
      closeSource.closedDataBytes ??
      closeSource.dataBytes ??
      listing.closedDataBytes,
    closedFrozenNetworkValueSats:
      closeSource.closedFrozenNetworkValueSats ??
      listing.closedFrozenNetworkValueSats,
    closedLiveNetworkValueSats:
      closeSource.closedLiveNetworkValueSats ??
      listing.closedLiveNetworkValueSats,
    closedMinerFeeCanonical:
      closeSource.closedMinerFeeCanonical === true ||
      listing.closedMinerFeeCanonical === true,
    closedMinerFeeSats:
      closeSource.closedMinerFeeSats ?? listing.closedMinerFeeSats,
    closedMinerFeeSource:
      closeSource.closedMinerFeeSource ??
      closeSource.minerFeeSource ??
      listing.closedMinerFeeSource,
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

function mergeCanonicalTokenSaleRecord(current, incoming) {
  if (!current) {
    return incoming;
  }
  if (!incoming) {
    return current;
  }
  return {
    ...incoming,
    ...current,
    createdAt: current.createdAt ?? incoming.createdAt,
  };
}

function mergeCanonicalTokenClosedListingRecord(current, incoming) {
  if (!current) {
    return incoming;
  }
  if (!incoming) {
    return current;
  }
  const merged = mergeTokenListingRecord(current, incoming);
  return {
    ...merged,
    closedAt: current.closedAt ?? incoming.closedAt,
    createdAt: current.createdAt ?? incoming.createdAt,
  };
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

  const candidateCte = `
    WITH mint_candidates AS (
      SELECT
        e.payload,
        e.protocol,
        e.kind,
        e.status,
        COALESCE(t.status, e.status) AS effective_status,
        e.event_time,
        COALESCE(e.block_time, t.block_time) AS block_time,
        e.created_at,
        COALESCE(e.block_height, t.block_height) AS block_height,
        t.block_hash AS block_hash,
        CASE
          WHEN e.payload->>'blockIndex' ~ '^[0-9]+$'
            THEN (e.payload->>'blockIndex')::integer
          WHEN e.payload->>'_powBlockIndex' ~ '^[0-9]+$'
            THEN (e.payload->>'_powBlockIndex')::integer
          WHEN t.raw_tx->'canonicalBlockScan'->>'blockIndex' ~ '^[0-9]+$'
            THEN (t.raw_tx->'canonicalBlockScan'->>'blockIndex')::integer
          ELSE NULL
        END AS block_index,
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
        cd.registry_address,
        NULLIF(e.payload->>'attachedWorkLiveFloorAtSendSats', '')
          AS attached_work_live_floor_at_send_sats_text,
        NULLIF(e.payload->>'attachedWorkLiveValueAtSendSats', '')
          AS attached_work_live_value_at_send_sats_text,
        NULLIF(e.payload->>'issuanceDustSats', '')
          AS issuance_dust_sats_text,
        NULLIF(e.payload->>'issuanceFloorSats', '')
          AS issuance_floor_sats_text,
        NULLIF(e.payload->>'issuanceNetworkValueSats', '')
          AS issuance_network_value_sats_text,
        NULLIF(e.payload->>'issuanceValueSnapshotWorkNetworkValueSats', '')
          AS issuance_value_snapshot_work_network_value_sats_text,
        CASE
          WHEN e.payload->>'eventKeyVout' ~ '^[0-9]{1,9}$'
            THEN (e.payload->>'eventKeyVout')::integer
          ELSE 0
        END AS mint_ordinal,
        COALESCE(
          NULLIF(btrim(e.payload->>'minterAddress'), ''),
          NULLIF(btrim(e.payload->>'actor'), ''),
          NULLIF(btrim(e.payload->>'senderAddress'), ''),
          ''
        ) AS mint_recipient_address
      FROM proof_indexer.events e
      LEFT JOIN proof_indexer.transactions t
        ON t.network = e.network
       AND t.txid = e.txid
      LEFT JOIN proof_indexer.credit_definitions cd
        ON cd.network = e.network
       AND cd.token_id = lower(e.payload->>'tokenId')
      WHERE ${conditions.join(" AND ")}
    )
  `;
  const cte = `
    ${candidateCte},
    mint_events AS (
      SELECT DISTINCT ON (
        lower(txid),
        lower(COALESCE(token_id, '')),
        mint_ordinal,
        lower(mint_recipient_address)
      )
        *
      FROM mint_candidates
      ORDER BY
        lower(txid),
        lower(COALESCE(token_id, '')),
        mint_ordinal,
        lower(mint_recipient_address),
        CASE effective_status
          WHEN 'confirmed' THEN 0
          WHEN 'pending' THEN 1
          ELSE 2
        END,
        CASE WHEN block_height IS NULL THEN 1 ELSE 0 END,
        COALESCE(block_time, event_time, confirmed_at, last_seen_at, created_at) DESC,
        event_id DESC
    )
  `;

  return { candidateCte, cte, params };
}

function tokenMintSortSql() {
  return `
    COALESCE(block_time, event_time, confirmed_at, last_seen_at, created_at) DESC,
    block_height DESC NULLS LAST,
    txid DESC,
    mint_ordinal ASC,
    lower(mint_recipient_address) ASC,
    event_id DESC
  `;
}

function canonicalTokenMintCandidateRows(rows) {
  const byMintKey = new Map();
  const integer = (value) => {
    try {
      return BigInt(String(value ?? "0"));
    } catch {
      return 0n;
    }
  };
  const ordinal = (value) => {
    const parsed = Number.parseInt(String(value ?? "0"), 10);
    return Number.isSafeInteger(parsed) ? parsed : 0;
  };
  const statusRank = (row) => {
    const status = String(row?.effective_status ?? row?.status ?? "")
      .trim()
      .toLowerCase();
    return status === "confirmed" ? 0 : status === "pending" ? 1 : 2;
  };
  const candidateWins = (candidate, current) => {
    const candidateStatusRank = statusRank(candidate);
    const currentStatusRank = statusRank(current);
    if (candidateStatusRank !== currentStatusRank) {
      return candidateStatusRank < currentStatusRank;
    }
    const candidateHeightRank = candidate?.block_height == null ? 1 : 0;
    const currentHeightRank = current?.block_height == null ? 1 : 0;
    if (candidateHeightRank !== currentHeightRank) {
      return candidateHeightRank < currentHeightRank;
    }
    const candidateTime = integer(candidate?.mint_winner_time_us);
    const currentTime = integer(current?.mint_winner_time_us);
    if (candidateTime !== currentTime) {
      return candidateTime > currentTime;
    }
    return integer(candidate?.event_id) > integer(current?.event_id);
  };
  const comparePublishedRows = (left, right) => {
    const leftTime = integer(left?.mint_winner_time_us);
    const rightTime = integer(right?.mint_winner_time_us);
    if (leftTime !== rightTime) {
      return leftTime > rightTime ? -1 : 1;
    }
    const leftHeight = left?.block_height == null ? null : integer(left.block_height);
    const rightHeight = right?.block_height == null ? null : integer(right.block_height);
    if (leftHeight !== rightHeight) {
      if (leftHeight === null) return 1;
      if (rightHeight === null) return -1;
      return leftHeight > rightHeight ? -1 : 1;
    }
    const leftTxid = String(left?.txid ?? "").trim().toLowerCase();
    const rightTxid = String(right?.txid ?? "").trim().toLowerCase();
    if (leftTxid !== rightTxid) {
      return leftTxid < rightTxid ? 1 : -1;
    }
    const leftOrdinal = ordinal(left?.mint_ordinal);
    const rightOrdinal = ordinal(right?.mint_ordinal);
    if (leftOrdinal !== rightOrdinal) {
      return leftOrdinal < rightOrdinal ? -1 : 1;
    }
    const leftRecipient = String(left?.mint_recipient_address ?? "")
      .trim()
      .toLowerCase();
    const rightRecipient = String(right?.mint_recipient_address ?? "")
      .trim()
      .toLowerCase();
    if (leftRecipient !== rightRecipient) {
      return leftRecipient < rightRecipient ? -1 : 1;
    }
    const leftEventId = integer(left?.event_id);
    const rightEventId = integer(right?.event_id);
    if (leftEventId === rightEventId) return 0;
    return leftEventId > rightEventId ? -1 : 1;
  };

  for (const row of Array.isArray(rows) ? rows : []) {
    const key = JSON.stringify([
      String(row?.txid ?? "").trim().toLowerCase(),
      String(row?.token_id ?? "").trim().toLowerCase(),
      ordinal(row?.mint_ordinal),
      String(row?.mint_recipient_address ?? "").trim().toLowerCase(),
    ]);
    const current = byMintKey.get(key);
    if (!current || candidateWins(row, current)) {
      byMintKey.set(key, row);
    }
  }
  return [...byMintKey.values()].sort(comparePublishedRows);
}

async function proofIndexTokenMintRows(
  pool,
  network,
  tokenScope,
  searchParams,
  pagination,
) {
  const { candidateCte, params } = tokenMintEventQueryParts(
    network,
    tokenScope,
    searchParams,
    pagination,
  );
  const result = await pool.query(
    `
      ${candidateCte}
      SELECT
        *,
        floor(
          extract(epoch FROM COALESCE(
            block_time,
            event_time,
            confirmed_at,
            last_seen_at,
            created_at
          )) * 1000000
        )::bigint AS mint_winner_time_us
      FROM mint_candidates
    `,
    params,
  );
  // Full token-state and mint-stat reads consume the complete result. Selecting
  // and ordering the canonical rows in JavaScript here
  // avoids carrying the large event payload through two PostgreSQL sorts while
  // preserving the same winner rules as the paginated history query.
  return canonicalTokenMintCandidateRows(result.rows);
}

export async function proofIndexTokenMintStatsPayload(
  network,
  tokenScope,
  options = {},
) {
  const pool = proofIndexPool();
  if (!pool) {
    return null;
  }
  const scope = tokenScopeKey(tokenScope);
  if (!scope || scope === "all") {
    return null;
  }
  const targetTxid = normalizedTxid(options.targetTxid);

  const rows = await proofIndexTokenMintRows(
    pool,
    network,
    scope,
    new URLSearchParams(),
    { limit: TOKEN_STATE_EVENT_READ_LIMIT, offset: 0, page: 0, query: "", snapshotId: "" },
  );
  // Parse every selected row before publishing any aggregate. In particular,
  // confirmed INCB rows pass through the same full issuance and bond-binding
  // validator as history and current token-state reads.
  const mints = rows.map((row) =>
    tokenMintFromEventPayload(objectRecord(row.payload), row),
  );
  const totalMints = mints.length;
  if (totalMints <= 0) {
    return null;
  }

  const exactWholeUnits = isBondTokenId(scope);
  let confirmedMints = 0;
  let confirmedSupply = exactWholeUnits ? 0n : 0;
  let pendingMints = 0;
  let pendingSupply = exactWholeUnits ? 0n : 0;
  let targetConfirmedMints = 0;
  let targetPendingMints = 0;
  const pendingCandidatesByTxid = new Map();
  for (const mint of mints) {
    const amount = exactWholeUnits
      ? integerBigInt(mint.amount)
      : Number(mint.amount);
    if (
      amount === null ||
      (typeof amount === "number" &&
        (!Number.isSafeInteger(amount) || amount < 0)) ||
      (typeof amount === "bigint" && amount < 0n)
    ) {
      throw new Error(
        `Proof index mint statistics contain an inexact amount for ${mint.txid || "an unknown transaction"}.`,
      );
    }
    if (mint.confirmed) {
      confirmedMints += 1;
      confirmedSupply += amount;
      if (targetTxid && normalizedTxid(mint.txid) === targetTxid) {
        targetConfirmedMints += 1;
      }
      if (
        typeof confirmedSupply === "number" &&
        !Number.isSafeInteger(confirmedSupply)
      ) {
        throw new Error("Proof index confirmed mint supply is inexact.");
      }
    } else {
      pendingMints += 1;
      pendingSupply += amount;
      const mintTxid = normalizedTxid(mint.txid);
      if (!mintTxid) {
        throw new Error("Proof index pending mint statistics contain an invalid txid.");
      }
      const existingCandidate = pendingCandidatesByTxid.get(mintTxid);
      const candidateAmount =
        (existingCandidate?.amount ?? (exactWholeUnits ? 0n : 0)) + amount;
      if (
        typeof candidateAmount === "number" &&
        !Number.isSafeInteger(candidateAmount)
      ) {
        throw new Error("Proof index pending mint candidate supply is inexact.");
      }
      pendingCandidatesByTxid.set(mintTxid, {
        amount: candidateAmount,
        txid: mintTxid,
      });
      if (targetTxid && mintTxid === targetTxid) {
        targetPendingMints += 1;
      }
      if (
        typeof pendingSupply === "number" &&
        !Number.isSafeInteger(pendingSupply)
      ) {
        throw new Error("Proof index pending mint supply is inexact.");
      }
    }
  }

  const indexedThroughBlock = Math.max(
    0,
    ...rows.map((row) => rowNumber(row, "block_height")),
  );
  const pendingCandidateRows = [...pendingCandidatesByTxid.values()].sort(
    (left, right) => left.txid.localeCompare(right.txid),
  );
  const pendingCandidateSupply = pendingCandidateRows.reduce(
    (total, candidate) => total + candidate.amount,
    exactWholeUnits ? 0n : 0,
  );
  if (
    typeof pendingCandidateSupply === "number" &&
    !Number.isSafeInteger(pendingCandidateSupply)
  ) {
    throw new Error("Proof index pending mint witness supply is inexact.");
  }
  return {
    confirmedMints,
    confirmedSupply: exactWholeUnits
      ? confirmedSupply.toString()
      : confirmedSupply,
    indexedAt: newestDateIso(
      rows.flatMap((row) => [
        row.block_time,
        row.event_time,
        row.confirmed_at,
        row.last_seen_at,
        row.created_at,
      ]),
    ),
    indexedThroughBlock: indexedThroughBlock || undefined,
    network,
    pendingCandidateCount: pendingCandidateRows.length,
    pendingCandidates: pendingCandidateRows
      .slice(0, TOKEN_PENDING_MINT_WITNESS_LIMIT)
      .map((candidate) => ({
        ...candidate,
        amount: exactWholeUnits
          ? candidate.amount.toString()
          : candidate.amount,
      })),
    pendingCandidatesComplete:
      pendingCandidateRows.length <= TOKEN_PENDING_MINT_WITNESS_LIMIT,
    pendingCandidateSupply: exactWholeUnits
      ? pendingCandidateSupply.toString()
      : pendingCandidateSupply,
    pendingMints,
    pendingSupply: exactWholeUnits ? pendingSupply.toString() : pendingSupply,
    pendingWitnessLimit: TOKEN_PENDING_MINT_WITNESS_LIMIT,
    source: "proof-indexer-token-mint-events",
    ...(targetTxid
      ? {
          targetMintStats: {
            confirmedMints: targetConfirmedMints,
            pendingMints: targetPendingMints,
            totalMints: targetConfirmedMints + targetPendingMints,
            txid: targetTxid,
          },
        }
      : {}),
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

export function exactBondTokenIdForMintOverlay(scope, payload, mints) {
  const scopedTokens = (Array.isArray(payload?.tokens) ? payload.tokens : [])
    .filter((token) => tokenMatchesScope(token, scope));
  const scopedBondTokenId =
    scopedTokens.length === 1 && isBondTokenId(scopedTokens[0]?.tokenId)
      ? scopedTokens[0].tokenId
      : "";
  return scopedBondTokenId &&
    Array.isArray(mints) &&
    mints.length > 0 &&
    mints.every((mint) => mint?.tokenId === scopedBondTokenId)
    ? scopedBondTokenId
    : "";
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
    .filter((item) => {
      if (!item.txid || !item.tokenId) return false;
      if (!isBondTokenId(item.tokenId)) return Number(item.amount) > 0;
      const amount = exactBondUnits(item.amount, { positive: true });
      return Boolean(amount) && BigInt(amount) > 0n;
    });
  if (mints.length === 0) {
    return payload;
  }

  const confirmedMints = mints.filter((mint) => mint.confirmed);
  const pendingMints = mints.filter((mint) => !mint.confirmed);
  const scopedBondTokenId = exactBondTokenIdForMintOverlay(
    scope,
    payload,
    mints,
  );
  const bondScoped = Boolean(scopedBondTokenId);
  const confirmedSupply = bondScoped
    ? confirmedMints
        .reduce(
          (total, mint) => total + BigInt(exactBondUnits(mint.amount)),
          0n,
        )
        .toString()
    : confirmedMints.reduce(
        (total, mint) => total + Number(mint.amount ?? 0),
        0,
      );
  const pendingSupply = bondScoped
    ? pendingMints
        .reduce(
          (total, mint) => total + BigInt(exactBondUnits(mint.amount)),
          0n,
        )
        .toString()
    : pendingMints.reduce(
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
            AND e.status IN ('confirmed', 'pending')
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
    `(
      cl.listing_id = ANY($2::text[])
      OR cl.sale_ticket_txid = ANY($2::text[])
      OR cl.seal_txid = ANY($2::text[])
      OR cl.close_txid = ANY($2::text[])
    )`,
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
  let terminalMiss = false;
  if (totalCount === 0) {
    const terminalResult = await pool.query(
      `
        WITH candidate_events AS (
          SELECT direct.event_id
          FROM proof_indexer.events direct
          WHERE direct.network = $1
            AND direct.txid = ANY($2::text[])
          UNION
          SELECT refs.event_id
          FROM proof_indexer.event_refs refs
          JOIN proof_indexer.events referenced
            ON referenced.event_id = refs.event_id
           AND referenced.network = $1
          WHERE refs.ref_value = ANY($2::text[])
        )
        SELECT (
          EXISTS (
            SELECT 1
            FROM proof_indexer.transactions terminal_tx
            WHERE terminal_tx.network = $1
              AND terminal_tx.txid = ANY($2::text[])
              AND terminal_tx.status IN ('dropped', 'orphaned')
          )
          OR EXISTS (
            SELECT 1
            FROM proof_indexer.credit_listings terminal_listing
            WHERE terminal_listing.network = $1
              AND (
                terminal_listing.listing_id = ANY($2::text[])
                OR terminal_listing.sale_ticket_txid = ANY($2::text[])
                OR terminal_listing.seal_txid = ANY($2::text[])
                OR terminal_listing.close_txid = ANY($2::text[])
              )
              AND terminal_listing.status IN (
                'sold',
                'delisted',
                'dropped',
                'orphaned'
              )
          )
          OR EXISTS (
            SELECT 1
            FROM candidate_events candidate
            JOIN proof_indexer.events terminal_event
              ON terminal_event.event_id = candidate.event_id
            WHERE (
              terminal_event.txid = ANY($2::text[])
              AND (
                terminal_event.valid = false
                OR terminal_event.status IN ('dropped', 'orphaned')
              )
            )
            OR (
              terminal_event.valid = true
              AND terminal_event.status IN ('confirmed', 'pending')
              AND terminal_event.kind IN ('token-listing-closed', 'token-sale')
            )
          )
        ) AS terminal
      `,
      [network, uniqueTxids],
    );
    terminalMiss = terminalResult.rows[0]?.terminal === true;
    if (!terminalMiss) {
      return null;
    }
  }
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
              seal_tx.status AS seal_tx_status,
              cd.ticker,
              cd.registry_address
            FROM proof_indexer.credit_listings cl
            LEFT JOIN proof_indexer.transactions seal_tx
              ON seal_tx.network = cl.network
             AND seal_tx.txid = cl.seal_txid
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
              AND e.status IN ('confirmed', 'pending')
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
        sealConfirmed: tokenListingSealConfirmedFromTransaction(row, sealTxid),
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
    indexedThroughBlock:
      rowNumber(snapshot, "indexed_through_block") || undefined,
    items,
    kind: "listings",
    network,
    pagination,
    source: terminalMiss
      ? "proof-indexer-credit-listings-terminal"
      : "proof-indexer-credit-listings-exact",
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

function workAtomicProjectionMetadata(metadata) {
  const item = objectRecord(metadata);
  return (
    item.amountStorageModel === WORK_ATOMIC_PROJECTION_MODEL &&
    Number(item.decimals) === WORK_DECIMALS &&
    String(item.unitScale ?? "") === WORK_UNIT_SCALE_TEXT
  );
}

function storedWorkAtoms(value, metadata, { signed = false } = {}) {
  if (workAtomicProjectionMetadata(metadata)) {
    return normalizeWorkAtoms(value, {
      allowNegative: signed,
      allowZero: true,
    });
  }
  return signed
    ? parseSignedWorkAmountToAtoms(value)
    : parseWorkAmountToAtoms(value, { allowZero: true });
}

function workAmountProjection(
  record,
  {
    metadata = {},
    storedAmount,
    storedAmountIsAtoms = false,
    allowZero = false,
  } = {},
) {
  const amountAtoms =
    storedAmount !== undefined
      ? storedAmountIsAtoms || workAtomicProjectionMetadata(metadata)
        ? normalizeWorkAtoms(storedAmount, { allowZero })
        : parseWorkAmountToAtoms(storedAmount, { allowZero })
      : workAmountAtomsFromRecord(record, { allowZero });
  return {
    amount: formatWorkAtoms(amountAtoms),
    amountAtoms,
    decimals: WORK_DECIMALS,
    unitScale: WORK_UNIT_SCALE_TEXT,
  };
}

function workBalanceProjection(value, metadata, { signed = false } = {}) {
  const atoms = storedWorkAtoms(value, metadata, { signed });
  return {
    atoms,
    amount: formatWorkAtoms(atoms, { allowNegative: signed }),
  };
}

function addAtomicStrings(left, right) {
  return (BigInt(String(left ?? "0")) + BigInt(String(right ?? "0"))).toString();
}

function maxAtomicStrings(left, right) {
  const leftValue = BigInt(String(left ?? "0"));
  const rightValue = BigInt(String(right ?? "0"));
  return (leftValue >= rightValue ? leftValue : rightValue).toString();
}

function canonicalEventIdentityDetails(item = {}) {
  return ["_powEventIndex", "eventKeyVout", "protocolVout", "eventId"]
    .reduce((details, key) => {
      const value = Number(item?.[key]);
      if (Number.isSafeInteger(value) && value >= 0) {
        details[key] = value;
      }
      return details;
    }, {});
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

function bondTagForMemo(value) {
  const memo = normalizedLowerText(value);
  return BOND_TAGS.find((tag) => tag.memo === memo) ?? null;
}

function bondTagForKind(value) {
  const kind = normalizedLowerText(value);
  return BOND_TAGS.find((tag) => tag.kind === kind) ?? null;
}

function bondTagForEventPayload(payload, row = {}) {
  const kind = normalizedLowerText(payload?.kind ?? row.kind);
  const direct = bondTagForKind(kind);
  if (direct) {
    return direct;
  }
  if (kind !== "mail") {
    return null;
  }
  for (const value of [
    payload?.detail,
    payload?.memo,
    payload?.body,
    payload?.message,
    row.body_text,
  ]) {
    const tag = bondTagForMemo(value);
    if (tag) {
      return tag;
    }
  }
  return null;
}

function isInfinityBondEventPayload(payload, row = {}) {
  return bondTagForEventPayload(payload, row)?.kind === INFINITY_BOND_KIND;
}

function normalizedBondTags(tags, bondTag) {
  const bondLabels = new Set(BOND_TAGS.map((tag) => tag.label.toLowerCase()));
  const normalized = [];
  for (const tag of Array.isArray(tags) ? tags : []) {
    const value = String(tag ?? "").trim();
    if (!value) {
      continue;
    }
    if (bondLabels.has(value.toLowerCase())) {
      continue;
    }
    normalized.push(/^message$/iu.test(value) ? bondTag.label : value);
  }
  if (!normalized.some((tag) => tag.toLowerCase() === bondTag.label.toLowerCase())) {
    normalized.push(bondTag.label);
  }
  return normalized;
}

function normalizedBondTitle(payload, row = {}, bondTag) {
  const title = normalizedText(payload?.title);
  if (title && !/^(?:mail|message)\b/iu.test(title)) {
    return title;
  }
  const confirmed = row.status
    ? normalizedLowerText(row.status) === "confirmed"
    : payload?.confirmed !== false;
  return `${bondTag.label} ${confirmed ? "sent" : "pending"}`;
}

function normalizeEventPayload(payload, row = {}) {
  const bondTag = bondTagForEventPayload(payload, row);
  if (!bondTag) {
    return payload;
  }
  return {
    ...payload,
    detail: normalizedText(payload?.detail) || bondTag.memo,
    kind: bondTag.kind,
    tags: normalizedBondTags(payload?.tags, bondTag),
    title: normalizedBondTitle(payload, row, bondTag),
  };
}

function eventKindSqlCondition(kind, addValue) {
  const normalizedKind = normalizedLowerText(kind);
  const bondTag = bondTagForKind(normalizedKind);
  if (!bondTag) {
    return `e.kind = ${addValue(normalizedKind)}`;
  }

  const bondKindParam = addValue(bondTag.kind);
  const mailKindParam = addValue("mail");
  const memoParam = addValue(bondTag.memo);
  return `
    (
      e.kind = ${bondKindParam}
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
  const createdAt = dateIso(
    plausibleBitcoinEventTime(
      item?.createdAt,
      item?.blockTime,
      item?.timestamp,
      item?.confirmedAt,
      item?.indexedAt,
    ),
  );
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
      SELECT
        transaction_row.txid,
        transaction_row.status,
        transaction_row.first_seen_at,
        transaction_row.confirmed_at,
        transaction_row.dropped_at,
        transaction_row.last_seen_at,
        transaction_row.updated_at,
        transaction_row.block_hash,
        transaction_row.block_height,
        transaction_row.block_time,
        CASE
          WHEN jsonb_typeof(transaction_row.raw_tx->'canonicalBlockScan') = 'object'
            AND transaction_row.raw_tx->'canonicalBlockScan'->>'network' = $1
            AND transaction_row.raw_tx->'canonicalBlockScan'->>'height' ~ '^[0-9]+$'
            AND (transaction_row.raw_tx->'canonicalBlockScan'->>'height')::integer =
              transaction_row.block_height
            AND transaction_row.raw_tx->'canonicalBlockScan'->>'blockHash' ~
              '^[0-9a-fA-F]{64}$'
            AND lower(transaction_row.raw_tx->'canonicalBlockScan'->>'blockHash') =
              lower(transaction_row.block_hash)
          THEN true
          ELSE false
        END AS canonical_scan_proof,
        canonical_block.canonical AS block_canonical
      FROM proof_indexer.transactions transaction_row
      LEFT JOIN proof_indexer.blocks canonical_block
        ON canonical_block.network = transaction_row.network
       AND canonical_block.block_hash = transaction_row.block_hash
       AND canonical_block.height = transaction_row.block_height
       AND canonical_block.canonical = true
      WHERE transaction_row.network = $1 AND transaction_row.txid = $2
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
  const blockTimeMs = new Date(row.block_time ?? "").getTime();
  const blockTime = Number.isFinite(blockTimeMs)
    ? new Date(blockTimeMs).toISOString()
    : "";
  if (status === "confirmed") {
    const blockHeight = Number(row.block_height);
    const blockHash = String(row.block_hash ?? "").trim().toLowerCase();
    if (
      !Number.isSafeInteger(blockHeight) ||
      blockHeight <= 0 ||
      !/^[0-9a-f]{64}$/u.test(blockHash) ||
      row.block_canonical !== true ||
      row.canonical_scan_proof !== true ||
      !blockTime ||
      blockTimeMs < BITCOIN_GENESIS_TIME_MS
    ) {
      return null;
    }
  }
  if (status !== "confirmed" && !options.includeUnconfirmed) {
    return null;
  }

  const observedAt = dateIso(
    row.updated_at ?? row.confirmed_at ?? row.dropped_at ?? row.last_seen_at,
  );
  const payload = {
    confirmed: status === "confirmed",
    contract: "proof-of-work-tx-status-v2",
    indexedAt: observedAt,
    network,
    observedAt,
    sources: ["proof-indexer-canonical-block-scan"],
    status,
    txid: row.txid,
  };
  if (status === "confirmed") {
    return {
      ...payload,
      blockHash: String(row.block_hash).trim().toLowerCase(),
      blockHeight: Number(row.block_height),
      blockTime,
      canonical: true,
    };
  }
  if (status === "pending") {
    const firstSeenMs = new Date(row.first_seen_at ?? "").getTime();
    return {
      ...payload,
      ...(Number.isFinite(firstSeenMs) && firstSeenMs >= BITCOIN_GENESIS_TIME_MS
        ? { mempoolFirstSeenAt: new Date(firstSeenMs).toISOString() }
        : {}),
      mempoolSeen: true,
    };
  }
  return payload;
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
        AND payload->>'workAmountStorageModel' = $2
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
    [network, WORK_ATOMIC_PROJECTION_MODEL],
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
        AND payload->>'workAmountStorageModel' = $2
      ORDER BY generated_at DESC
      LIMIT 1
    `,
    [network, WORK_ATOMIC_PROJECTION_MODEL],
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
        AND payload->>'workAmountStorageModel' = $3
      ORDER BY generated_at DESC
      LIMIT 1
    `,
    [network, requiredPayloadKey, WORK_ATOMIC_PROJECTION_MODEL],
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
          AND payload->>'workAmountStorageModel' = $3
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
    pinnedSnapshotId
      ? [network, tokenScope, pinnedSnapshotId]
      : [network, tokenScope, WORK_ATOMIC_PROJECTION_MODEL],
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
    options.snapshot ??
    (await ledgerSnapshotMetadata(pool, network, pagination.snapshotId));
  const conditions = [
    "e.network = $1",
    "e.valid = true",
    "e.status IN ('confirmed', 'pending')",
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
  const pureExactTxidQuery =
    txidNeedles.length > 0 &&
    needles.every((value) => Boolean(normalizedTxid(value)));
  let exactQueryTxidsParam = "";
  if (txidNeedles.length > 0) {
    const uniqueTxidNeedles = [...new Set(txidNeedles)];
    params.push(uniqueTxidNeedles);
    const param = `$${params.length}`;
    if (pureExactTxidQuery) {
      exactQueryTxidsParam = param;
    }
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
      `(e.payload->'saleAuthorization'->>'version' = ANY(ARRAY['pwt-sale-v1','pwt-sale-v2','pwt-sale-v3']::text[]))`,
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
            AND close_event.status IN ('confirmed', 'pending')
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
            AND close_event.status IN ('confirmed', 'pending')
            AND close_event.kind = ANY(ARRAY['token-listing-closed','token-sale']::text[])
            AND lower(close_event.payload->>'listingId') = lower(e.payload->>'listingId')
        )`,
      );
    }
  }

  const whereClause = conditions.join(" AND ");
  const canonicalMarketEventsSql = tokenHistoryCanonicalMarketEventsSql(
    safeKind,
    whereClause,
  );
  const exactQueryDispositionSql = exactQueryTxidsParam
    ? `CASE
        WHEN (
          SELECT
            count(*) = cardinality(${exactQueryTxidsParam}::text[])
            AND bool_and(
              terminal_tx.status IN ('dropped', 'orphaned')
            )
          FROM proof_indexer.transactions terminal_tx
          WHERE terminal_tx.network = $1
            AND terminal_tx.txid = ANY(${exactQueryTxidsParam}::text[])
        )
        THEN 'terminal-nonmarket'::text
        ELSE NULL::text
      END`
    : "NULL::text";
  const rowParams = [...params, pagination.limit, pagination.offset];
  const limitParam = rowParams.length - 1;
  const offsetParam = rowParams.length;
  const rowsResult = await pool.query(
    `
      ${canonicalMarketEventsSql},
      canonical_market_metadata AS (
        SELECT
          count(*) AS total_count,
          max(block_height) AS indexed_through_block,
          ${exactQueryDispositionSql} AS query_disposition
        FROM canonical_market_events
      )
      SELECT
        page.*,
        metadata.total_count AS history_total_count,
        metadata.indexed_through_block AS history_indexed_through_block,
        metadata.query_disposition AS history_query_disposition
      FROM canonical_market_metadata metadata
      LEFT JOIN LATERAL (
        SELECT *
        FROM canonical_market_events
        ORDER BY
          COALESCE(event_time, block_time, created_at) DESC,
          history_item_confirmed DESC,
          history_item_txid DESC,
          history_item_kind_rank ASC,
          event_id DESC
        LIMIT $${limitParam}
        OFFSET $${offsetParam}
      ) page ON true
    `,
    rowParams,
  );
  const totalCount = rowNumber(rowsResult.rows[0], "history_total_count");
  const indexedThroughBlock =
    rowNumber(rowsResult.rows[0], "history_indexed_through_block") || undefined;
  const queryDisposition =
    totalCount === 0
      ? String(
          rowsResult.rows[0]?.history_query_disposition ?? "",
        ).trim()
      : "";
  if (totalCount === 0 && queryDisposition !== "terminal-nonmarket") {
    return null;
  }
  const items = rowsResult.rows
    .filter((row) => row.kind)
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
    const snapshotPage = {
      ...page,
      consistency: snapshot?.consistency ?? undefined,
      ledgerGeneratedAt: dateIso(snapshot?.generated_at),
      snapshotId,
    };
    return queryDisposition
      ? { ...snapshotPage, queryDisposition }
      : snapshotPage;
  }
  return queryDisposition ? { ...page, queryDisposition } : page;
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
        AND e.status IN ('confirmed', 'pending')
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

export async function proofIndexLogHistoryPayload(
  network,
  kind,
  searchParams,
  options = {},
) {
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

  if (exactQueryTxid) {
    const snapshot = await ledgerSnapshotMetadata(
      pool,
      network,
      pagination.snapshotId,
    );
    if (!snapshot) {
      return null;
    }
    const snapshotHeight = rowNumber(snapshot, "indexed_through_block");
    const snapshotGeneratedAt = snapshot.generated_at ?? null;
    if (
      snapshotHeight <= 0 ||
      !Number.isFinite(Date.parse(snapshotGeneratedAt))
    ) {
      return null;
    }
    const snapshotHeightParam = addParam(snapshotHeight);
    const snapshotTimeParam = addParam(snapshotGeneratedAt);
    conditions.push(`
      e.updated_at <= ${snapshotTimeParam}::timestamptz
      AND (
        (
          e.status = 'confirmed'
          AND e.block_height > 0
          AND e.block_height <= ${snapshotHeightParam}
        )
        OR (
          e.status = 'pending'
          AND e.created_at <= ${snapshotTimeParam}::timestamptz
        )
      )
    `);
    const whereClause = conditions.join(" AND ");
    const rowLimit = Math.max(
      pagination.limit,
      pagination.limit + pagination.offset,
    );
    const exactParams = [...params, exactQueryTxid];
    const exactQueryParam = `$${exactParams.length}`;
    const rowParams = [...exactParams, rowLimit];
    const limitParam = `$${rowParams.length}`;
    const rowsResult = await pool.query(
      `
        WITH matched_events AS (
          SELECT direct.event_id
          FROM proof_indexer.events direct
          WHERE direct.network = $1
            AND direct.txid = ${exactQueryParam}
          UNION
          SELECT refs.event_id
          FROM proof_indexer.event_refs refs
          JOIN proof_indexer.events referenced
            ON referenced.event_id = refs.event_id
           AND referenced.network = $1
          WHERE refs.ref_value = ${exactQueryParam}
        )
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
        FROM matched_events matched
        JOIN proof_indexer.events e
          ON e.event_id = matched.event_id
        WHERE ${whereClause}
        ORDER BY
          COALESCE(e.event_time, e.block_time, e.created_at) DESC,
          e.txid DESC,
          e.event_id DESC
        LIMIT ${limitParam}
      `,
      rowParams,
    );
    let queryDisposition =
      requestedKind && !PUBLIC_LOG_EVENT_KINDS.has(requestedKind)
        ? "nonpublic-kind-filter"
        : undefined;
    if (rowsResult.rows.length === 0 && !queryDisposition) {
      const dispositionResult = await pool.query(
        `
          SELECT
            terminal_tx.status,
            terminal_tx.block_height,
            terminal_tx.raw_tx IS NOT NULL AS has_raw_tx,
            count(candidate.event_id)::integer AS event_count,
            count(candidate.event_id) FILTER (
              WHERE candidate.valid = false
            )::integer AS invalid_event_count,
            count(candidate.event_id) FILTER (
              WHERE candidate.valid = true
                AND candidate.status IN ('confirmed', 'pending')
                AND candidate.kind = ANY($3::text[])
            )::integer AS public_event_count
          FROM proof_indexer.transactions terminal_tx
          LEFT JOIN proof_indexer.blocks canonical_block
            ON canonical_block.network = terminal_tx.network
           AND canonical_block.block_hash = terminal_tx.block_hash
           AND canonical_block.height = terminal_tx.block_height
           AND canonical_block.canonical = true
           AND canonical_block.indexed_at <= $5::timestamptz
          LEFT JOIN proof_indexer.events candidate
            ON candidate.network = terminal_tx.network
           AND candidate.txid = terminal_tx.txid
           AND candidate.updated_at <= $5::timestamptz
           AND (
             (
               candidate.status = 'confirmed'
               AND candidate.block_height = terminal_tx.block_height
               AND candidate.block_height > 0
               AND candidate.block_height <= $4
             )
             OR (
               candidate.status = 'pending'
               AND terminal_tx.status <> 'confirmed'
               AND candidate.created_at <= $5::timestamptz
             )
           )
          WHERE terminal_tx.network = $1
            AND terminal_tx.txid = $2
            AND terminal_tx.updated_at <= $5::timestamptz
            AND (
              (
                terminal_tx.status IN ('dropped', 'orphaned')
                AND terminal_tx.first_seen_at <= $5::timestamptz
              )
              OR (
                terminal_tx.status = 'confirmed'
                AND terminal_tx.block_height > 0
                AND terminal_tx.block_height <= $4
                AND canonical_block.block_hash = terminal_tx.block_hash
                AND jsonb_typeof(terminal_tx.raw_tx) = 'object'
                AND jsonb_typeof(
                  terminal_tx.raw_tx->'canonicalBlockScan'
                ) = 'object'
                AND terminal_tx.raw_tx->'canonicalBlockScan'->>'network' =
                  terminal_tx.network
                AND terminal_tx.raw_tx->'canonicalBlockScan'->>'height' =
                  terminal_tx.block_height::text
                AND lower(
                  terminal_tx.raw_tx->'canonicalBlockScan'->>'blockHash'
                ) = lower(terminal_tx.block_hash)
                AND lower(COALESCE(terminal_tx.raw_tx->>'txid', '')) =
                  terminal_tx.txid
              )
            )
          GROUP BY
            terminal_tx.status,
            terminal_tx.block_height,
            terminal_tx.raw_tx
        `,
        [
          network,
          exactQueryTxid,
          [...PUBLIC_LOG_EVENT_KINDS],
          snapshotHeight,
          snapshotGeneratedAt,
        ],
      );
      const disposition = dispositionResult.rows[0];
      const eventCount = rowNumber(disposition, "event_count");
      const invalidEventCount = rowNumber(
        disposition,
        "invalid_event_count",
      );
      const publicEventCount = rowNumber(
        disposition,
        "public_event_count",
      );
      if (["dropped", "orphaned"].includes(disposition?.status)) {
        queryDisposition = "terminal-nonpublic";
      } else if (
        disposition?.status === "confirmed" &&
        rowNumber(disposition, "block_height") > 0 &&
        rowNumber(disposition, "block_height") <=
          rowNumber(snapshot, "indexed_through_block") &&
        disposition?.has_raw_tx === true &&
        eventCount > 0 &&
        publicEventCount === 0
      ) {
        queryDisposition =
          invalidEventCount === eventCount
            ? "confirmed-invalid-nonpublic"
            : "confirmed-nonpublic";
      }
    }
    const page = logHistoryPageFromItems({
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
    return queryDisposition ? { ...page, queryDisposition } : page;
  }

  const currentRelational = options.currentRelational === true;
  const snapshot = currentRelational
    ? await ledgerSnapshotMetadata(pool, network, pagination.snapshotId)
    : await ledgerSnapshot(pool, network, pagination.snapshotId);
  if (!snapshot) {
    return null;
  }
  let snapshotHeight = 0;
  let snapshotGeneratedAt = null;
  if (currentRelational) {
    snapshotHeight = rowNumber(snapshot, "indexed_through_block");
    snapshotGeneratedAt = snapshot.generated_at ?? null;
    if (snapshotHeight <= 0 || !snapshotGeneratedAt) {
      return null;
    }
    const snapshotHeightParam = addParam(snapshotHeight);
    const snapshotTimeParam = addParam(snapshotGeneratedAt);
    conditions.push(`
      e.updated_at <= ${snapshotTimeParam}::timestamptz
      AND (
        (
          e.status = 'confirmed'
          AND e.block_height > 0
          AND e.block_height <= ${snapshotHeightParam}
        )
        OR (
          e.status = 'pending'
          AND e.created_at <= ${snapshotTimeParam}::timestamptz
        )
      )
    `);
  }
  const whereClause = conditions.join(" AND ");
  const snapshotPage = currentRelational
    ? null
    : logHistoryPageFromSnapshot(
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
  const snapshotTotalCount = currentRelational
    ? rowNumber(
        (
          await pool.query(
            `
              SELECT count(*) AS total_count
              FROM proof_indexer.events e
              WHERE e.network = $1
                AND e.valid = true
                AND e.status IN ('confirmed', 'pending')
                AND e.kind = ANY($2::text[])
                AND e.updated_at <= $4::timestamptz
                AND (
                  (
                    e.status = 'confirmed'
                    AND e.block_height > 0
                    AND e.block_height <= $3
                  )
                  OR (
                    e.status = 'pending'
                    AND e.created_at <= $4::timestamptz
                  )
                )
            `,
            [
              network,
              [...PUBLIC_LOG_EVENT_KINDS],
              snapshotHeight,
              snapshotGeneratedAt,
            ],
          )
        ).rows[0],
        "total_count",
      )
    : totalCount;
  const latestEventBlock = rowNumber(
    countResult.rows[0],
    "indexed_through_block",
  );
  const indexedThroughBlock = Math.max(
    latestEventBlock,
    currentRelational ? rowNumber(snapshot, "indexed_through_block") : 0,
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
    const page = logHistoryPageFromItems({
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
    return currentRelational
      ? { ...page, latestEventBlock, snapshotTotalCount }
      : page;
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
    ...(currentRelational ? { latestEventBlock } : {}),
    ...(currentRelational ? { snapshotTotalCount } : {}),
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
    "e.status IN ('confirmed', 'pending')",
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
        e.event_id,
        e.network,
        e.txid,
        e.status AS event_status,
        COALESCE(t.status, e.status) AS status,
        e.amount_sats,
        e.block_height,
        t.block_hash AS block_hash,
        CASE
          WHEN e.payload->>'blockIndex' ~ '^[0-9]+$'
            THEN (e.payload->>'blockIndex')::integer
          WHEN e.payload->>'_powBlockIndex' ~ '^[0-9]+$'
            THEN (e.payload->>'_powBlockIndex')::integer
          WHEN t.raw_tx->'canonicalBlockScan'->>'blockIndex' ~ '^[0-9]+$'
            THEN (t.raw_tx->'canonicalBlockScan'->>'blockIndex')::integer
          ELSE NULL
        END AS block_index,
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
    eligibility.kind === "listings" &&
    exactMarketTxidNeedles.length > 0
  ) {
    const snapshotMetadata = await ledgerSnapshotMetadata(
      pool,
      network,
      eligibility.pagination.snapshotId,
    );
    if (snapshotMetadata) {
      const exactListingPage = await exactActiveTokenListingHistoryPage(
        pool,
        network,
        tokenScope,
        searchParams,
        eligibility.pagination,
        snapshotMetadata,
      );
      if (exactListingPage) {
        return exactListingPage;
      }
    }
  }
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
  assertCanonicalIncbCurrentProjection(
    payload.tokens,
    payload.mints,
    payload.holders,
    "Proof index token snapshot",
  );
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
          AND NOT (source_hashes ? 'canonicalSummary')
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
                NULLIF(payload->>'blockHash', ''),
                NULLIF(source_hashes->>'blockScan', '')
              ),
              ''
            ) IS NOT NULL THEN 0
            ELSE 1
          END,
          indexed_through_block DESC NULLS LAST,
          generated_at DESC
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
      LEFT JOIN worker_meta ON true
    `,
    [network],
  );
  return result.rows[0] ?? null;
}

async function latestProofIndexOperationalMetadata(pool, network) {
  const result = await pool.query(
    `
      WITH latest_scan AS (
        SELECT
          snapshot_id,
          generated_at,
          indexed_through_block,
          COALESCE(
            NULLIF(payload->>'indexedThroughBlockHash', ''),
            NULLIF(payload->>'blockHash', ''),
            NULLIF(source_hashes->>'blockScan', '')
          ) AS scan_block_hash,
          payload->'complete' AS scan_payload_complete,
          metrics->'complete' AS scan_metrics_complete,
          consistency->'complete' AS scan_consistency_complete,
          payload->>'stopReason' AS scan_payload_stop_reason,
          metrics->>'stopReason' AS scan_metrics_stop_reason,
          payload->'tipHeight' AS scan_payload_tip_height,
          metrics->'tipHeight' AS scan_metrics_tip_height
        FROM proof_indexer.ledger_snapshots
        WHERE network = $1
          AND source_hashes ? 'blockScan'
          AND NOT (source_hashes ? 'canonicalSummary')
        ORDER BY
          CASE
            WHEN NULLIF(
              COALESCE(
                NULLIF(payload->>'indexedThroughBlockHash', ''),
                NULLIF(payload->>'blockHash', ''),
                NULLIF(source_hashes->>'blockScan', '')
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
          COALESCE(
            NULLIF(payload->>'indexedThroughBlockHash', ''),
            NULLIF(payload->'summaryRefresh'->>'indexedThroughBlockHash', ''),
            NULLIF(source_hashes->>'blockScan', '')
          ) AS summary_block_hash,
          payload->>'summaryPayloadsIndexedAt' AS summary_indexed_at,
          jsonb_build_object(
            'growthSummary', jsonb_build_object(
              'parent', jsonb_build_array(
                payload #> '{summaryPayloads,growthSummary,indexedThroughBlock}',
                payload #> '{summaryPayloads,growthSummary,metrics,indexedThroughBlock}',
                payload #> '{summaryPayloads,growthSummary,stats,indexedThroughBlock}'
              ),
              'nested', jsonb_build_array(
                payload #> '{summaryPayloads,growthSummary,workFloor,indexedThroughBlock}',
                payload #> '{summaryPayloads,growthSummary,workFloor,metrics,indexedThroughBlock}',
                payload #> '{summaryPayloads,growthSummary,workFloor,stats,indexedThroughBlock}'
              )
            ),
            'inceptionSummary', jsonb_build_object(
              'parent', jsonb_build_array(
                payload #> '{summaryPayloads,inceptionSummary,indexedThroughBlock}',
                payload #> '{summaryPayloads,inceptionSummary,metrics,indexedThroughBlock}',
                payload #> '{summaryPayloads,inceptionSummary,stats,indexedThroughBlock}'
              )
            ),
            'infinitySummary', jsonb_build_object(
              'parent', jsonb_build_array(
                payload #> '{summaryPayloads,infinitySummary,indexedThroughBlock}',
                payload #> '{summaryPayloads,infinitySummary,metrics,indexedThroughBlock}',
                payload #> '{summaryPayloads,infinitySummary,stats,indexedThroughBlock}'
              )
            ),
            'logSummary', jsonb_build_object(
              'parent', jsonb_build_array(
                payload #> '{summaryPayloads,logSummary,indexedThroughBlock}',
                payload #> '{summaryPayloads,logSummary,metrics,indexedThroughBlock}',
                payload #> '{summaryPayloads,logSummary,stats,indexedThroughBlock}'
              )
            ),
            'marketplaceSummary', jsonb_build_object(
              'parent', jsonb_build_array(
                payload #> '{summaryPayloads,marketplaceSummary,indexedThroughBlock}',
                payload #> '{summaryPayloads,marketplaceSummary,metrics,indexedThroughBlock}',
                payload #> '{summaryPayloads,marketplaceSummary,stats,indexedThroughBlock}'
              ),
              'nested', jsonb_build_array(
                payload #> '{summaryPayloads,marketplaceSummary,workFloor,indexedThroughBlock}',
                payload #> '{summaryPayloads,marketplaceSummary,workFloor,metrics,indexedThroughBlock}',
                payload #> '{summaryPayloads,marketplaceSummary,workFloor,stats,indexedThroughBlock}'
              )
            ),
            'tokenSummary', jsonb_build_object(
              'parent', jsonb_build_array(
                payload #> '{summaryPayloads,tokenSummary,indexedThroughBlock}',
                payload #> '{summaryPayloads,tokenSummary,metrics,indexedThroughBlock}',
                payload #> '{summaryPayloads,tokenSummary,stats,indexedThroughBlock}'
              )
            ),
            'workFloor', jsonb_build_object(
              'parent', jsonb_build_array(
                payload #> '{summaryPayloads,workFloor,indexedThroughBlock}',
                payload #> '{summaryPayloads,workFloor,metrics,indexedThroughBlock}',
                payload #> '{summaryPayloads,workFloor,stats,indexedThroughBlock}'
              )
            ),
            'workSummary', jsonb_build_object(
              'parent', jsonb_build_array(
                payload #> '{summaryPayloads,workSummary,indexedThroughBlock}',
                payload #> '{summaryPayloads,workSummary,metrics,indexedThroughBlock}',
                payload #> '{summaryPayloads,workSummary,stats,indexedThroughBlock}'
              ),
              'nested', jsonb_build_array(
                payload #> '{summaryPayloads,workSummary,floor,indexedThroughBlock}',
                payload #> '{summaryPayloads,workSummary,floor,metrics,indexedThroughBlock}',
                payload #> '{summaryPayloads,workSummary,floor,stats,indexedThroughBlock}'
              )
            )
          ) AS summary_coverage
        FROM proof_indexer.ledger_snapshots
        WHERE network = $1
          AND payload ? 'summaryPayloads'
          AND payload->>'workAmountStorageModel' = $2
          AND COALESCE(consistency->>'ok', payload->>'ok', 'false') = 'true'
          AND COALESCE(consistency->>'status', payload->>'status', '') <> 'summary-snapshot-fallback'
          AND payload->'summaryRefresh'->>'mode' = 'canonical-summary-refresh'
          AND source_hashes ? 'canonicalSummary'
          AND jsonb_typeof(payload->'summaryPayloads') = 'object'
          AND jsonb_typeof(payload->'summaryPayloads'->'growthSummary') = 'object'
          AND jsonb_typeof(payload->'summaryPayloads'->'inceptionSummary') = 'object'
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
        ORDER BY
          indexed_through_block DESC NULLS LAST,
          generated_at DESC
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
        latest_scan.scan_block_hash,
        latest_scan.scan_payload_complete,
        latest_scan.scan_metrics_complete,
        latest_scan.scan_consistency_complete,
        latest_scan.scan_payload_stop_reason,
        latest_scan.scan_metrics_stop_reason,
        latest_scan.scan_payload_tip_height,
        latest_scan.scan_metrics_tip_height,
        latest_summary.snapshot_id AS summary_snapshot_id,
        latest_summary.summary_block_hash,
        latest_summary.generated_at AS summary_generated_at,
        latest_summary.summary_coverage,
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
    [network, WORK_ATOMIC_PROJECTION_MODEL],
  );
  return result.rows[0] ?? null;
}

export async function proofIndexOperationalStatusPayload(network) {
  const pool = proofIndexPool();
  if (!pool) {
    return null;
  }
  const row = await latestProofIndexOperationalMetadata(pool, network);
  if (!row) {
    return null;
  }
  const worker = objectRecord(row.worker);
  const summaryCoverage = objectRecord(row.summary_coverage);
  const indexedThroughBlock = rowNumber(row, "indexed_through_block");
  const summaryCoverageByKey = Object.fromEntries(
    [
      "growthSummary",
      "inceptionSummary",
      "infinitySummary",
      "logSummary",
      "marketplaceSummary",
      "tokenSummary",
      "workFloor",
      "workSummary",
    ].map(
      (key) => {
        const item = objectRecord(summaryCoverage[key]);
        const parentCoverage = Math.max(
          0,
          ...(Array.isArray(item.parent) ? item.parent : []).map(
            safeBlockHeight,
          ),
        );
        const nestedCoverage = Array.isArray(item.nested)
          ? Math.max(
              0,
              ...item.nested.map(safeBlockHeight),
            )
          : key === "workFloor" ||
              key === "inceptionSummary" ||
              key === "infinitySummary" ||
              key === "logSummary" ||
              key === "tokenSummary"
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
      blockHash: String(row.summary_block_hash ?? "").trim().toLowerCase(),
      coverageByKey: summaryCoverageByKey,
      eligible:
        Boolean(String(row.summary_snapshot_id ?? "")) &&
        summaryIndexedThroughBlock > 0 &&
        /^[0-9a-f]{64}$/u.test(
          String(row.summary_block_hash ?? "").trim().toLowerCase(),
        ),
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
      blockHash: String(row.scan_block_hash ?? ""),
      complete:
        row.scan_payload_complete === true ||
        row.scan_metrics_complete === true ||
        row.scan_consistency_complete === true,
      snapshotId: String(row.snapshot_id ?? ""),
      stopReason: String(
        row.scan_payload_stop_reason ?? row.scan_metrics_stop_reason ?? "",
      ),
      tipHeight:
        rowNumber(row, "scan_payload_tip_height") ||
        rowNumber(row, "scan_metrics_tip_height") ||
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

export async function proofIndexRushPayload(
  network,
  expectedHeight = 0,
  options = {},
) {
  const pool = proofIndexPool();
  if (!pool || network !== "livenet") {
    return null;
  }
  const status = await proofIndexOperationalStatusPayload(network);
  const indexedThroughBlock = Number(status?.indexedThroughBlock);
  const indexedThroughBlockHash = String(status?.scan?.blockHash ?? "")
    .trim()
    .toLowerCase();
  if (
    (options.allowIncompleteScan !== true &&
      status?.scan?.complete !== true) ||
    !Number.isSafeInteger(indexedThroughBlock) ||
    indexedThroughBlock <= 0 ||
    (Number.isSafeInteger(Number(expectedHeight)) &&
      Number(expectedHeight) > 0 &&
      indexedThroughBlock !== Number(expectedHeight)) ||
    !/^[0-9a-f]{64}$/u.test(indexedThroughBlockHash)
  ) {
    return null;
  }

  const markerResult = await pool.query(
    `
      SELECT value
      FROM proof_indexer.meta
      WHERE key = $1
      LIMIT 1
    `,
    [`rushCanonicalBootstrap:${network}`],
  );
  const marker = objectRecord(markerResult.rows[0]?.value);
  const bootstrapHeight = Number(marker?.indexedThroughBlock);
  const bootstrapHash = normalizedLowerText(marker?.indexedThroughBlockHash);
  const expectedMintCount = Number(marker?.mintCount);
  if (
    Number(marker?.version) !== 1 ||
    marker?.network !== network ||
    !Number.isSafeInteger(bootstrapHeight) ||
    bootstrapHeight <= 0 ||
    bootstrapHeight > indexedThroughBlock ||
    !/^[0-9a-f]{64}$/u.test(bootstrapHash) ||
    !Number.isSafeInteger(expectedMintCount) ||
    expectedMintCount < 0
  ) {
    return null;
  }

  const result = await pool.query(
    `
      WITH bootstrap_block AS (
        SELECT canonical
        FROM proof_indexer.blocks
        WHERE network = $1
          AND height = $2
          AND block_hash = $3
        LIMIT 1
      ),
      rush_events AS (
        SELECT
          e.*,
          count(*) FILTER (WHERE e.block_height <= $2) OVER ()::int AS bootstrap_mint_count
        FROM proof_indexer.events e
        WHERE e.network = $1
          AND e.protocol = 'pwr1'
          AND e.kind = 'rush-mint'
          AND e.status = 'confirmed'
          AND e.valid = true
          AND e.block_height <= $4
      )
      SELECT
        rush_events.*,
        COALESCE((SELECT canonical FROM bootstrap_block), false) AS bootstrap_canonical
      FROM rush_events
      ORDER BY
        block_height ASC,
        CASE
          WHEN payload->>'blockIndex' ~ '^[0-9]+$'
            THEN (payload->>'blockIndex')::integer
          ELSE 2147483647
        END ASC,
        txid ASC,
        event_id ASC
    `,
    [network, bootstrapHeight, bootstrapHash, indexedThroughBlock],
  );
  const bootstrapMintCount = Number(
    result.rows[0]?.bootstrap_mint_count ?? (expectedMintCount === 0 ? 0 : -1),
  );
  const bootstrapCanonical =
    result.rows[0]?.bootstrap_canonical === true ||
    (expectedMintCount === 0 &&
      Boolean(
        (
          await pool.query(
            `
              SELECT 1
              FROM proof_indexer.blocks
              WHERE network = $1
                AND height = $2
                AND block_hash = $3
                AND canonical = true
              LIMIT 1
            `,
            [network, bootstrapHeight, bootstrapHash],
          )
        ).rows[0],
      ));
  if (
    !bootstrapCanonical ||
    bootstrapMintCount !== expectedMintCount ||
    result.rows.some(
      (row) =>
        Number(row.block_height) > indexedThroughBlock ||
        normalizedLowerText(row.protocol) !== "pwr1",
    )
  ) {
    return null;
  }

  return {
    bootstrap: marker,
    indexedAt: status.indexedAt,
    indexedThroughBlock,
    indexedThroughBlockHash,
    mints: result.rows.map((row) => eventRowPayload(row, network)),
    network,
    source: "proof-indexer-rush-canonical",
  };
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

function canonicalVerifierIncbInvalidEventQueryParts(
  network,
  fromHeight,
  indexedThroughBlock,
) {
  return {
    fromSql: `
      FROM proof_indexer.events e
      JOIN proof_indexer.transactions t
        ON t.network = e.network
       AND t.txid = e.txid
      JOIN proof_indexer.blocks b
        ON b.network = t.network
       AND b.height = t.block_height
       AND b.block_hash = t.block_hash
       AND b.canonical = true
      LEFT JOIN proof_indexer.credit_listings cl_invalid
        ON cl_invalid.network = e.network
       AND cl_invalid.listing_id = lower(e.payload->>'listingId')
      LEFT JOIN proof_indexer.credit_definitions cd
        ON cd.network = e.network
       AND cd.token_id = COALESCE(
         lower(e.payload->>'tokenId'),
         cl_invalid.token_id
       )
      WHERE e.network = $1
        AND e.protocol = 'pwt1'
        AND e.kind = 'token-event-invalid'
        AND e.status = 'confirmed'
        AND e.valid = false
        AND t.status = 'confirmed'
        AND e.block_height = t.block_height
        AND t.block_height BETWEEN $4 AND $5
        AND lower(COALESCE(e.payload->>'kind', '')) = 'token-event-invalid'
        AND lower(COALESCE(e.payload->>'tokenId', '')) = $2
        AND lower(COALESCE(e.payload->>'attemptedKind', '')) = 'token-mint'
        AND lower(COALESCE(e.payload->>'sourceKind', '')) = $3
        AND lower(COALESCE(e.payload->>'txid', '')) = lower(e.txid)
        AND lower(COALESCE(e.payload->>'sourceBondTxid', '')) = lower(e.txid)
        AND COALESCE(e.payload->>'blockHeight', '') ~ '^[0-9]+$'
        AND (e.payload->>'blockHeight')::integer = t.block_height
        AND lower(COALESCE(e.payload->>'blockHash', '')) = lower(t.block_hash)
        AND NOT EXISTS (
          SELECT 1
          FROM proof_indexer.events valid_mint
          WHERE valid_mint.network = e.network
            AND valid_mint.txid = e.txid
            AND valid_mint.protocol = 'pwt1'
            AND valid_mint.kind = 'token-mint'
            AND valid_mint.status = 'confirmed'
            AND valid_mint.valid = true
            AND valid_mint.block_height = t.block_height
            AND lower(COALESCE(valid_mint.payload->>'tokenId', '')) = $2
        )
    `,
    params: [
      network,
      INCB_TOKEN_ID,
      INCEPTION_BOND_KIND,
      fromHeight,
      indexedThroughBlock,
    ],
  };
}

function canonicalVerifierIncbInvalidDispositionFromRow(row, canonicalBlocks) {
  const payload = objectRecord(row?.payload);
  const txid = normalizedLowerText(row?.txid);
  const eventBlockHeight = Number(row?.block_height);
  const transactionBlockHeight = Number(row?.transaction_block_height);
  const payloadBlockHeight = Number(payload.blockHeight);
  const blockHash = normalizedLowerText(row?.block_hash);
  const canonicalBlockHash = normalizedLowerText(
    typeof canonicalBlocks?.get === "function"
      ? canonicalBlocks.get(transactionBlockHeight)
      : "",
  );
  if (
    row?.valid !== false ||
    normalizedLowerText(row?.protocol) !== "pwt1" ||
    normalizedLowerText(row?.kind) !== "token-event-invalid" ||
    normalizedLowerText(row?.status) !== "confirmed" ||
    normalizedLowerText(row?.effective_status) !== "confirmed" ||
    !/^[0-9a-f]{64}$/u.test(txid) ||
    !Number.isSafeInteger(eventBlockHeight) ||
    eventBlockHeight <= 0 ||
    eventBlockHeight !== transactionBlockHeight ||
    payloadBlockHeight !== transactionBlockHeight ||
    !/^[0-9a-f]{64}$/u.test(blockHash) ||
    canonicalBlockHash !== blockHash ||
    normalizedLowerText(payload.kind) !== "token-event-invalid" ||
    normalizedLowerText(payload.tokenId) !== INCB_TOKEN_ID ||
    normalizedLowerText(payload.attemptedKind) !== "token-mint" ||
    normalizedLowerText(payload.sourceKind) !== INCEPTION_BOND_KIND ||
    normalizedLowerText(payload.txid) !== txid ||
    normalizedLowerText(payload.sourceBondTxid) !== txid ||
    normalizedLowerText(payload.blockHash) !== blockHash ||
    row?.valid_incb_mint_overlap === true
  ) {
    return null;
  }
  const event = tokenInvalidEventFromRow(row);
  return event.txid === txid && event.confirmed && event.valid === false
    ? event
    : null;
}

const PWT_RANGE_REPLAY_VERIFIER_BINDING_MODEL =
  "proof-indexer-pwt-range-replay-verifier-binding-v1";

function canonicalIncbReplayReaderBinding(rebuild, network) {
  const source = objectRecord(rebuild);
  const binding = objectRecord(source.verifierBinding);
  const verification = objectRecord(source.incbRangeReplayVerification);
  const bindingId = normalizedLowerText(binding.bindingId);
  const rangeReplayFromHeight = Number(binding.rangeReplayFromHeight);
  const witnessCount = Number(binding.witnessCount);
  const witnessPreserveCount = Number(binding.witnessPreserveCount);
  const witnessedThroughBlock = Number(binding.witnessedThroughBlock);
  const witnessSetHash = normalizedLowerText(binding.witnessSetHash);
  const witnessedThroughBlockHash = normalizedLowerText(
    binding.witnessedThroughBlockHash,
  );
  const expectedMetaKey = /^[0-9a-f]{64}$/u.test(bindingId)
    ? incbRangeReplayWitnessMetaKey(network, bindingId)
    : "";
  const activeReplay =
    source.status === "active" &&
    source.active === true &&
    source.complete === false &&
    source.completedAt == null &&
    source.incbRangeReplayVerification == null;
  const completedReplay =
    source.status === "complete" &&
    source.active === false &&
    source.complete === true &&
    Number.isFinite(Date.parse(String(source.completedAt ?? ""))) &&
    verification.verified === true &&
    verification.accountingModel === INCB_ISSUANCE_ACCOUNTING_MODEL &&
    Number(verification.rangeReplayFromHeight) === rangeReplayFromHeight &&
    normalizedLowerText(verification.witnessSetHash) === witnessSetHash &&
    Number(verification.witnessCount) === witnessCount &&
    Number(verification.witnessPreserveCount) === witnessPreserveCount &&
    Number(verification.consumedPreserveCount) === witnessPreserveCount &&
    Number(verification.rederivedWitnessCount) ===
      witnessCount - witnessPreserveCount &&
    Number(verification.witnessedThroughBlock) === witnessedThroughBlock &&
    normalizedLowerText(verification.witnessedThroughBlockHash) ===
      witnessedThroughBlockHash;
  if (
    source.mode !== "pwt-range-replay" ||
    source.network !== network ||
    (!activeReplay && !completedReplay) ||
    binding.model !== PWT_RANGE_REPLAY_VERIFIER_BINDING_MODEL ||
    binding.network !== network ||
    !/^[0-9a-f]{64}$/u.test(bindingId) ||
    !Number.isFinite(Date.parse(String(binding.createdAt ?? ""))) ||
    !Number.isSafeInteger(rangeReplayFromHeight) ||
    rangeReplayFromHeight <= 1 ||
    Number(source.rangeReplayFromHeight) !== rangeReplayFromHeight ||
    binding.witnessModel !== INCB_RANGE_REPLAY_WITNESS_MANIFEST_MODEL ||
    !/^[0-9a-f]{64}$/u.test(witnessSetHash) ||
    !Number.isSafeInteger(witnessCount) ||
    witnessCount < 0 ||
    !Number.isSafeInteger(witnessPreserveCount) ||
    witnessPreserveCount < 0 ||
    witnessPreserveCount > witnessCount ||
    !Number.isSafeInteger(witnessedThroughBlock) ||
    witnessedThroughBlock < rangeReplayFromHeight - 1 ||
    !/^[0-9a-f]{64}$/u.test(witnessedThroughBlockHash) ||
    String(binding.witnessSetMetaKey ?? "") !== expectedMetaKey
  ) {
    return null;
  }
  return {
    bindingId,
    createdAt: String(binding.createdAt),
    model: PWT_RANGE_REPLAY_VERIFIER_BINDING_MODEL,
    network,
    rangeReplayFromHeight,
    witnessCount,
    witnessModel: INCB_RANGE_REPLAY_WITNESS_MANIFEST_MODEL,
    witnessPreserveCount,
    witnessSetHash,
    witnessSetMetaKey: expectedMetaKey,
    witnessedThroughBlock,
    witnessedThroughBlockHash,
  };
}

async function canonicalIncbReplayManifestRow(client, metaKey) {
  const result = await client.query(
    `SELECT value FROM proof_indexer.meta WHERE key = $1 LIMIT 1`,
    [metaKey],
  );
  return result.rows[0]?.value ?? null;
}

async function canonicalIncbReplaySnapshotRows(client, network, snapshotIds) {
  if (!Array.isArray(snapshotIds) || snapshotIds.length === 0) {
    return [];
  }
  const result = await client.query(
    `
      SELECT
        snapshot_id,
        indexed_through_block,
        generated_at,
        source_hashes->>'blockScan' AS source_block_hash,
        source_hashes->>'canonicalSummary' AS canonical_summary_hash,
        consistency->>'ok' AS consistency_ok,
        COALESCE(consistency->>'status', payload->>'status', '') AS consistency_status,
        payload->>'snapshotId' AS payload_snapshot_id,
        payload->>'indexedThroughBlockHash' AS payload_block_hash,
        payload->'summaryRefresh'->>'mode' AS summary_refresh_mode,
        payload->'summaryRefresh'->>'indexedThroughBlockHash' AS summary_refresh_block_hash,
        payload->'summaryPayloads'->'workFloor'->>'snapshotId' AS work_floor_snapshot_id,
        payload->'summaryPayloads'->'workFloor'->>'indexedThroughBlock' AS work_floor_height,
        payload->'summaryPayloads'->'workFloor'->>'indexedThroughBlockHash' AS work_floor_block_hash,
        payload->'totals'->>'workNetworkValueAccountingModel' AS totals_work_network_value_model,
        payload->'totals'->>'workNetworkValueQ8' AS totals_work_network_value_q8,
        payload->'summaryPayloads'->'workFloor'->>'workNetworkValueAccountingModel' AS work_floor_network_value_model,
        payload->'summaryPayloads'->'workFloor'->>'networkValueQ8' AS work_floor_network_value_q8,
        payload->'summaryPayloads'->'workFloor'->>'liveNetworkValueQ8' AS work_floor_live_network_value_q8,
        payload->'summaryPayloads'->'workFloor'->'actualValue'->>'workNetworkValueAccountingModel' AS work_actual_network_value_model,
        payload->'summaryPayloads'->'workFloor'->'actualValue'->>'networkValueQ8' AS work_actual_network_value_q8,
        payload->'summaryPayloads'->'workFloor'->'actualValue'->>'liveNetworkValueQ8' AS work_actual_live_network_value_q8,
        payload->'summaryPayloads'->'workFloor'->'actualValue'->>'totalQ8' AS work_actual_total_q8,
        payload->'summaryPayloads'->'workFloor'->'actualValue'->>'liveTotalQ8' AS work_actual_live_total_q8,
        COALESCE(
          NULLIF(payload #>> '{summaryPayloads,workFloor,liveNetworkValueSats}', ''),
          NULLIF(payload #>> '{summaryPayloads,workFloor,actualValue,liveNetworkValueSats}', ''),
          NULLIF(payload #>> '{summaryPayloads,workFloor,actualValue,liveTotalSats}', ''),
          NULLIF(payload #>> '{summaryPayloads,workFloor,actualValue,totalSats}', '')
        ) AS work_network_value_sats_text,
        CASE
          WHEN payload #> '{summaryPayloads,workFloor,liveNetworkValueSats}' IS NOT NULL
            THEN jsonb_typeof(payload #> '{summaryPayloads,workFloor,liveNetworkValueSats}')
          WHEN payload #> '{summaryPayloads,workFloor,actualValue,liveNetworkValueSats}' IS NOT NULL
            THEN jsonb_typeof(payload #> '{summaryPayloads,workFloor,actualValue,liveNetworkValueSats}')
          WHEN payload #> '{summaryPayloads,workFloor,actualValue,liveTotalSats}' IS NOT NULL
            THEN jsonb_typeof(payload #> '{summaryPayloads,workFloor,actualValue,liveTotalSats}')
          WHEN payload #> '{summaryPayloads,workFloor,actualValue,totalSats}' IS NOT NULL
            THEN jsonb_typeof(payload #> '{summaryPayloads,workFloor,actualValue,totalSats}')
          ELSE NULL
        END AS work_network_value_sats_type,
        payload::text AS raw_payload_json,
        source_hashes::text AS raw_source_hashes_json,
        consistency::text AS raw_consistency_json,
        metrics::text AS raw_metrics_json
      FROM proof_indexer.ledger_snapshots
      WHERE network = $1
        AND snapshot_id = ANY($2::text[])
      ORDER BY snapshot_id ASC
    `,
    [network, snapshotIds],
  );
  return result.rows;
}

function canonicalIncbReplaySnapshotDescriptorFromReaderRow(row, entry) {
  const snapshot = objectRecord(entry?.snapshot);
  const rawSnapshotFingerprint = incbReplayRawSnapshotFingerprint({
    consistencyJson: String(row?.raw_consistency_json ?? ""),
    generatedAt: new Date(row?.generated_at).toISOString(),
    indexedThroughBlock: Number(row?.indexed_through_block),
    metricsJson: String(row?.raw_metrics_json ?? ""),
    payloadJson: String(row?.raw_payload_json ?? ""),
    snapshotId: String(row?.snapshot_id ?? ""),
    sourceHashesJson: String(row?.raw_source_hashes_json ?? ""),
  });
  const mode = String(snapshot.workNetworkValueMode ?? "");
  const expectedQ8 = canonicalIntegerText(snapshot.workNetworkValueQ8, {
    allowZero: false,
  });
  const models = [
    String(row?.totals_work_network_value_model ?? ""),
    String(row?.work_floor_network_value_model ?? ""),
    String(row?.work_actual_network_value_model ?? ""),
  ];
  const aliases = [
    row?.totals_work_network_value_q8,
    row?.work_floor_network_value_q8,
    row?.work_floor_live_network_value_q8,
    row?.work_actual_network_value_q8,
    row?.work_actual_live_network_value_q8,
    row?.work_actual_total_q8,
    row?.work_actual_live_total_q8,
  ];
  if (mode === WORK_NETWORK_VALUE_ACCOUNTING_MODEL) {
    const normalizedAliases = aliases.map((value) =>
      canonicalIntegerText(value, { allowZero: false })
    );
    if (
      models.some((value) => value !== WORK_NETWORK_VALUE_ACCOUNTING_MODEL) ||
      normalizedAliases.some((value) => value !== expectedQ8)
    ) {
      throw new Error("Current INCB replay snapshot Q8 aliases diverged.");
    }
  } else if (mode === "locked-bound-legacy-work-value-v1") {
    const legacyQ8 =
      models.every((value) => !value) &&
      row?.work_network_value_sats_type === "string" &&
      typeof row?.work_network_value_sats_text === "string"
        ? q8TextFromDecimal(row.work_network_value_sats_text.trim())
        : "";
    if (!legacyQ8 || legacyQ8 !== expectedQ8) {
      throw new Error("Legacy INCB replay snapshot decimal is not exact.");
    }
  } else if (
    mode === INCB_RANGE_REPLAY_EXACT_MINT_LEGACY_SNAPSHOT_MODE
  ) {
    if (models.some(Boolean)) {
      throw new Error(
        "A marked current snapshot cannot use the legacy exact-mint exception.",
      );
    }
    const mintQ8 = canonicalIntegerText(
      entry?.mintPayload?.issuanceValueSnapshotWorkNetworkValueQ8,
      { allowZero: false },
    );
    if (!mintQ8 || mintQ8 !== expectedQ8) {
      throw new Error(
        "The legacy green snapshot is not bound to the mint's exact Q8.",
      );
    }
  } else {
    throw new Error("Unknown INCB replay snapshot accounting witness mode.");
  }
  return normalizeIncbReplaySnapshotDescriptor({
    canonicalSummaryHash: normalizedLowerText(row?.canonical_summary_hash),
    consistencyOk: String(row?.consistency_ok ?? "") === "true",
    consistencyStatus: String(row?.consistency_status ?? ""),
    generatedAt: new Date(row?.generated_at).toISOString(),
    indexedThroughBlock: Number(row?.indexed_through_block),
    payloadBlockHash: normalizedLowerText(row?.payload_block_hash),
    payloadSnapshotId: String(row?.payload_snapshot_id ?? ""),
    rawSnapshotFingerprint,
    snapshotId: String(row?.snapshot_id ?? ""),
    sourceBlockHash: normalizedLowerText(row?.source_block_hash),
    summaryRefreshBlockHash: normalizedLowerText(
      row?.summary_refresh_block_hash,
    ),
    summaryRefreshMode: String(row?.summary_refresh_mode ?? ""),
    workFloorBlockHash: normalizedLowerText(row?.work_floor_block_hash),
    workFloorHeight: Number(row?.work_floor_height),
    workFloorSnapshotId: String(row?.work_floor_snapshot_id ?? ""),
    workNetworkValueMode: mode,
    workNetworkValueQ8: expectedQ8,
  });
}

function canonicalIncbReplayMintMatchesManifest(entry) {
  const mint = objectRecord(entry?.mintPayload);
  const bond = objectRecord(entry?.bond);
  const snapshot = objectRecord(entry?.snapshot);
  return Boolean(
    !incbIssuanceMetadataFault(mint, { status: "confirmed" }) &&
      normalizedLowerText(mint.txid) === bond.txid &&
      normalizedLowerText(mint.sourceBondTxid) === bond.txid &&
      String(mint.minterAddress ?? "").trim() === bond.bondRecipientAddress &&
      String(mint.bondRecipientAddress ?? "").trim() ===
        bond.bondRecipientAddress &&
      Number(mint.bondRecipientVout) === bond.bondRecipientVout &&
      canonicalIntegerText(mint.bondRecipientAmountSats, {
        allowZero: false,
      }) === bond.bondRecipientAmountSats &&
      canonicalIntegerText(mint.directProofIssuanceUnits, {
        allowZero: false,
      }) === bond.bondRecipientAmountSats &&
      canonicalIntegerText(mint.attachedWorkAmountAtoms) ===
        bond.attachedWorkAmountAtoms &&
      Number(mint.blockHeight ?? mint.height) === bond.blockHeight &&
      Number(mint.blockIndex ?? mint._powBlockIndex) === bond.blockIndex &&
      normalizedLowerText(mint.blockHash ?? mint._powBlockHash) ===
        bond.blockHash &&
      Number(mint.issuanceValueSnapshotBlockHeight) ===
        bond.blockHeight - 1 &&
      normalizedLowerText(mint.issuanceValueSnapshotBlockHash) ===
        bond.previousBlockHash &&
      String(mint.issuanceValueSnapshotId ?? "") === snapshot.snapshotId &&
      normalizedLowerText(mint.issuanceValueSnapshotCanonicalSummaryHash) ===
        snapshot.canonicalSummaryHash &&
      new Date(mint.issuanceValueSnapshotGeneratedAt).toISOString() ===
        snapshot.generatedAt &&
      canonicalIntegerText(
        mint.issuanceValueSnapshotWorkNetworkValueQ8,
        { allowZero: false },
      ) === snapshot.workNetworkValueQ8
  );
}

function verifyCanonicalIncbReplayPreservedRows(manifest, rows) {
  const preserved = manifest.entries.filter(
    (entry) => entry.disposition === "preserve",
  );
  const rowsById = new Map(
    rows.map((row) => [String(row?.snapshot_id ?? ""), row]),
  );
  if (
    new Set(preserved.map((entry) => entry.snapshot.snapshotId)).size !==
    rowsById.size
  ) {
    throw new Error(
      "The immutable INCB replay snapshot set is missing or ambiguous.",
    );
  }
  for (const entry of preserved) {
    const descriptor = canonicalIncbReplaySnapshotDescriptorFromReaderRow(
      rowsById.get(entry.snapshot.snapshotId),
      entry,
    );
    if (
      !canonicalIncbReplayMintMatchesManifest(entry) ||
      canonicalIncbReplaySha256(descriptor) !==
        canonicalIncbReplaySha256(entry.snapshot) ||
      incbReplaySnapshotFingerprint(descriptor) !==
        entry.snapshotFingerprint ||
      descriptor.rawSnapshotFingerprint !==
        entry.snapshot.rawSnapshotFingerprint
    ) {
      throw new Error(
        `Immutable INCB replay witness ${entry.bond.txid}:${entry.bond.bondRecipientVout} changed.`,
      );
    }
  }
  return preserved;
}

function canonicalIncbReplayRawMessages(rawTx) {
  const messages = [];
  for (const [voutIndex, output] of (Array.isArray(rawTx?.vout)
    ? rawTx.vout
    : []).entries()) {
    const script = objectRecord(output?.scriptPubKey);
    const asm = String(script.asm ?? output?.scriptpubkey_asm ?? "").trim();
    if (!asm.startsWith("OP_RETURN")) continue;
    const chunks = asm
      .split(/\s+/u)
      .slice(1)
      .filter((part) => /^(?:[0-9a-f]{2})+$/iu.test(part))
      .map((part) => Buffer.from(part, "hex"));
    if (chunks.length > 0) {
      messages.push({
        text: Buffer.concat(chunks).toString("utf8"),
        voutIndex,
      });
    }
  }
  return messages;
}

function canonicalIncbReplayRawWorkAtoms(rawTx, recipientAddress) {
  let total = 0n;
  for (const message of canonicalIncbReplayRawMessages(rawTx)) {
    const parts = String(message.text ?? "").split(":");
    if (
      parts[0] !== "pwt1" ||
      normalizedLowerText(parts[2]) !== WORK_TOKEN_ID ||
      String(parts[4] ?? "").trim() !== recipientAddress
    ) {
      continue;
    }
    const amount = canonicalIntegerText(parts[3], { allowZero: false });
    if (!amount || !["send", "send2"].includes(parts[1])) {
      throw new Error("Malformed WORK attachment in bound INCB raw transaction.");
    }
    total += parts[1] === "send2"
      ? BigInt(amount)
      : BigInt(amount) * BigInt(WORK_UNIT_SCALE_TEXT);
  }
  return total.toString();
}

async function canonicalIncbReplayBondRows(client, network, manifest) {
  if (manifest.entries.length === 0) return [];
  const result = await client.query(
    `
      SELECT
        t.txid,
        t.block_height,
        lower(t.block_hash) AS block_hash,
        CASE
          WHEN t.raw_tx->>'_powBlockIndex' ~ '^[0-9]+$'
            THEN (t.raw_tx->>'_powBlockIndex')::integer
          ELSE NULL
        END AS block_index,
        lower(block.previous_block_hash) AS previous_block_hash,
        t.raw_tx
      FROM proof_indexer.transactions t
      JOIN proof_indexer.blocks block
        ON block.network = t.network
       AND block.height = t.block_height
       AND block.block_hash = t.block_hash
       AND block.canonical = true
      WHERE t.network = $1
        AND t.status = 'confirmed'
        AND t.txid = ANY($2::text[])
    `,
    [
      network,
      [...new Set(manifest.entries.map((entry) => entry.bond.txid))],
    ],
  );
  return result.rows;
}

function verifyCanonicalIncbReplayBondRows(manifest, rows) {
  const rowsByTxid = new Map(
    rows.map((row) => [normalizedLowerText(row.txid), row]),
  );
  for (const entry of manifest.entries) {
    const row = rowsByTxid.get(entry.bond.txid);
    const rawTx = objectRecord(row?.raw_tx);
    const rawOutputs = Array.isArray(rawTx.vout) ? rawTx.vout : [];
    const messages = canonicalIncbReplayRawMessages(rawTx);
    const memos = messages.filter(
      (message) => message.text === "pwm1:m:incb",
    );
    const committedOutputsMatch = entry.bond.bondRecipientOutputs.every(
      (committed) => {
        const output = objectRecord(rawOutputs[committed.vout]);
        const script = objectRecord(output.scriptPubKey);
        return (
          String(
            script.address ??
              (Array.isArray(script.addresses) ? script.addresses[0] : "") ??
              "",
          ).trim() === entry.bond.bondRecipientAddress &&
          canonicalCoreValueSats(
            output.value,
            `INCB witness output ${committed.vout}`,
          ) === Number(committed.amountSats) &&
          Number(committed.vout) < Number(memos[0]?.voutIndex)
        );
      },
    );
    if (
      !row ||
      Number(row.block_height) !== entry.bond.blockHeight ||
      normalizedLowerText(row.block_hash) !== entry.bond.blockHash ||
      Number(row.block_index) !== entry.bond.blockIndex ||
      normalizedLowerText(row.previous_block_hash) !==
        entry.bond.previousBlockHash ||
      memos.length !== 1 ||
      !committedOutputsMatch ||
      canonicalIncbReplayRawWorkAtoms(
        rawTx,
        entry.bond.bondRecipientAddress,
      ) !== entry.bond.attachedWorkAmountAtoms
    ) {
      throw new Error(
        `INCB replay bond ${entry.bond.txid}:${entry.bond.bondRecipientVout} changed canonical position, memo, outputs, or WORK attachment.`,
      );
    }
  }
}

function canonicalIncbReplayWitnessFaultPayload({
  checkpointHash = "",
  code,
  error,
  network,
  rangeReplayFromHeight = 0,
  rebuild = null,
  requestedHeight,
}) {
  return {
    checkpointHash,
    dispositions: [],
    fault: canonicalTransactionFault(
      network,
      code,
      error?.message ?? String(error),
    ),
    indexedThroughBlock: requestedHeight,
    invalidDispositionTxids: [],
    mints: [],
    network,
    rangeReplayFromHeight,
    rebuild,
    source: INCB_RANGE_REPLAY_BOUND_WITNESS_SOURCE,
    witnessCount: 0,
    witnessPreserveCount: 0,
    witnessSetHash: "",
    witnessedThroughBlock: 0,
    witnessedThroughBlockHash: "",
  };
}

export async function proofIndexCanonicalInceptionMintWitnessesPayload(
  network,
  indexedThroughBlock,
) {
  const pool = proofIndexPool();
  const requestedHeight = Number(indexedThroughBlock);
  if (
    !pool ||
    network !== "livenet" ||
    !Number.isSafeInteger(requestedHeight) ||
    requestedHeight <= 0
  ) {
    return null;
  }

  const client = await pool.connect();
  let checkpointHash = "";
  let rebuild = null;
  let rangeReplayFromHeight = 0;
  let transactionOpen = false;
  try {
    await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
    transactionOpen = true;
    const stateMeta = await canonicalStateMetaFromPool(client, network);
    rebuild = objectRecord(stateMeta.rebuild);
    const replayBinding = canonicalIncbReplayReaderBinding(rebuild, network);
    rangeReplayFromHeight = Number(rebuild.rangeReplayFromHeight);
    const fromHeight = Number(rebuild.fromHeight);
    const upperHeight = Math.min(
      requestedHeight,
      rangeReplayFromHeight - 1,
    );
    if (
      !replayBinding ||
      !Number.isSafeInteger(fromHeight) ||
      fromHeight <= 0 ||
      upperHeight <= 0
    ) {
      const error = new Error(
        "Canonical INCB witnesses require an active immutable bound PWT range replay.",
      );
      error.code = "INCB_BOUND_WITNESS_REPLAY_INACTIVE";
      throw error;
    }
    const manifest = verifyIncbRangeReplayWitnessManifest(
      await canonicalIncbReplayManifestRow(
        client,
        replayBinding.witnessSetMetaKey,
      ),
      {
        bindingId: replayBinding.bindingId,
        count: replayBinding.witnessCount,
        hash: replayBinding.witnessSetHash,
        metaKey: replayBinding.witnessSetMetaKey,
        network,
        preserveCount: replayBinding.witnessPreserveCount,
        rangeReplayFromHeight,
        throughHash: replayBinding.witnessedThroughBlockHash,
        throughHeight: replayBinding.witnessedThroughBlock,
      },
    );

    const checkpointResult = await client.query(
    `
      SELECT height, block_hash
      FROM proof_indexer.blocks
      WHERE network = $1
        AND height = $2
        AND canonical = true
      LIMIT 1
    `,
    [network, requestedHeight],
  );
    const checkpoint = checkpointResult.rows[0];
    checkpointHash = normalizedLowerText(checkpoint?.block_hash);
    if (
      Number(checkpoint?.height) !== requestedHeight ||
      !/^[0-9a-f]{64}$/u.test(checkpointHash) ||
      stateMeta.fault?.active === true ||
      requestedHeight > Number(rebuild.indexedThroughBlock)
    ) {
      const error = new Error(
        "The canonical bound INCB witness checkpoint is unavailable.",
      );
      error.code = "INCB_BOUND_WITNESS_CHECKPOINT_UNAVAILABLE";
      throw error;
    }

    const invalidEventQuery = canonicalVerifierIncbInvalidEventQueryParts(
      network,
      fromHeight,
      upperHeight,
    );
    const mintResult = await client.query(
      `
        SELECT
          e.payload,
          e.protocol,
          e.kind,
          e.status,
          COALESCE(t.status, e.status) AS effective_status,
          e.event_time,
          COALESCE(e.block_time, t.block_time) AS block_time,
          e.created_at,
          e.block_height,
          t.block_height AS transaction_block_height,
          t.block_hash,
          CASE
            WHEN t.raw_tx->>'_powBlockIndex' ~ '^[0-9]+$'
              THEN (t.raw_tx->>'_powBlockIndex')::integer
            ELSE NULL
          END AS block_index,
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
          cd.registry_address,
          NULLIF(e.payload->>'attachedWorkLiveFloorAtSendSats', '')
            AS attached_work_live_floor_at_send_sats_text,
          NULLIF(e.payload->>'attachedWorkLiveValueAtSendSats', '')
            AS attached_work_live_value_at_send_sats_text,
          NULLIF(e.payload->>'issuanceDustSats', '')
            AS issuance_dust_sats_text,
          NULLIF(e.payload->>'issuanceFloorSats', '')
            AS issuance_floor_sats_text,
          NULLIF(e.payload->>'issuanceNetworkValueSats', '')
            AS issuance_network_value_sats_text,
          NULLIF(e.payload->>'issuanceValueSnapshotWorkNetworkValueSats', '')
            AS issuance_value_snapshot_work_network_value_sats_text,
          CASE
            WHEN e.payload->>'eventKeyVout' ~ '^[0-9]{1,9}$'
              THEN (e.payload->>'eventKeyVout')::integer
            ELSE 0
          END AS mint_ordinal,
          COALESCE(
            NULLIF(btrim(e.payload->>'minterAddress'), ''),
            NULLIF(btrim(e.payload->>'actor'), ''),
            NULLIF(btrim(e.payload->>'senderAddress'), ''),
            ''
          ) AS mint_recipient_address
        FROM proof_indexer.events e
        JOIN proof_indexer.transactions t
          ON t.network = e.network
         AND t.txid = e.txid
         AND t.status = 'confirmed'
         AND t.block_height = e.block_height
        JOIN proof_indexer.blocks current_block
          ON current_block.network = t.network
         AND current_block.height = t.block_height
         AND current_block.block_hash = t.block_hash
         AND current_block.canonical = true
        JOIN proof_indexer.blocks previous_block
          ON previous_block.network = t.network
         AND previous_block.height = t.block_height - 1
         AND previous_block.block_hash =
           lower(e.payload->>'issuanceValueSnapshotBlockHash')
         AND previous_block.block_hash = current_block.previous_block_hash
         AND previous_block.canonical = true
        LEFT JOIN proof_indexer.credit_definitions cd
          ON cd.network = e.network
         AND cd.token_id = lower(e.payload->>'tokenId')
        WHERE e.network = $1
          AND e.protocol = 'pwt1'
          AND e.kind = 'token-mint'
          AND e.status = 'confirmed'
          AND e.valid = true
          AND lower(e.payload->>'tokenId') = $2
          AND e.block_height BETWEEN $3 AND $4
        ORDER BY
          e.block_height ASC,
          block_index ASC NULLS LAST,
          e.txid ASC,
          e.event_id ASC
      `,
      [network, INCB_TOKEN_ID, fromHeight, upperHeight],
    );
    const invalidResult = await client.query(
      `
        SELECT
          ${tokenInvalidEventSelectSql()}
        ${invalidEventQuery.fromSql}
        ORDER BY
          t.block_height ASC,
          e.txid ASC,
          e.event_id ASC
      `,
      invalidEventQuery.params,
    );

    const confirmedStateMeta = await canonicalStateMetaFromPool(client, network);
    const confirmedRebuild = objectRecord(confirmedStateMeta.rebuild);
    const confirmedBinding = canonicalIncbReplayReaderBinding(
      confirmedRebuild,
      network,
    );
    const confirmedManifest = confirmedBinding
      ? verifyIncbRangeReplayWitnessManifest(
          await canonicalIncbReplayManifestRow(
            client,
            confirmedBinding.witnessSetMetaKey,
          ),
          {
            bindingId: confirmedBinding.bindingId,
            count: confirmedBinding.witnessCount,
            hash: confirmedBinding.witnessSetHash,
            metaKey: confirmedBinding.witnessSetMetaKey,
            network,
            preserveCount: confirmedBinding.witnessPreserveCount,
            rangeReplayFromHeight,
            throughHash: confirmedBinding.witnessedThroughBlockHash,
            throughHeight: confirmedBinding.witnessedThroughBlock,
          },
        )
      : null;
    if (
      confirmedStateMeta.fault?.active === true ||
      !confirmedBinding ||
      canonicalIncbReplaySha256(confirmedBinding) !==
        canonicalIncbReplaySha256(replayBinding) ||
      canonicalIncbReplaySha256(confirmedManifest) !==
        canonicalIncbReplaySha256(manifest)
    ) {
      throw new Error(
        "The canonical replay binding or immutable witness set changed while INCB witnesses were read.",
      );
    }
    const invalidBlocks = new Map(
      invalidResult.rows.map((row) => [
        Number(row.transaction_block_height),
        normalizedLowerText(row.block_hash),
      ]),
    );
    const invalidDispositions = invalidResult.rows.map((row) => {
      const disposition = canonicalVerifierIncbInvalidDispositionFromRow(
        row,
        invalidBlocks,
      );
      if (!disposition) {
        throw new Error(
          `Canonical invalid INCB disposition ${row.txid || "unknown"} is malformed.`,
        );
      }
      return disposition;
    });
    const invalidDispositionTxids = invalidDispositions.map((event) =>
      normalizedLowerText(event.txid),
    );
    const invalidTxids = new Set(invalidDispositionTxids);
    const identities = new Set();
    const legacyMints = mintResult.rows.map((row) => {
      const mint = tokenMintFromEventPayload(objectRecord(row.payload), row);
      const identity = JSON.stringify([
        normalizedLowerText(mint.txid),
        String(mint.minterAddress ?? "").trim(),
        Number(mint.bondRecipientVout),
      ]);
      if (
        mint.confirmed !== true ||
        normalizedLowerText(mint.tokenId) !== INCB_TOKEN_ID ||
        normalizedLowerText(mint.sourceKind) !== INCEPTION_BOND_KIND ||
        mint.issuanceAccountingModel !== INCB_ISSUANCE_ACCOUNTING_MODEL ||
        invalidTxids.has(normalizedLowerText(mint.txid)) ||
        identities.has(identity)
      ) {
        throw new Error(
          `Canonical INCB witness ${mint.txid || "unknown"} is ambiguous, invalid, or overlaps a rejected disposition.`,
        );
      }
      identities.add(identity);
      return mint;
    });
    const preservedSnapshotIds = [...new Set(
      manifest.entries
        .filter((entry) => entry.disposition === "preserve")
        .map((entry) => entry.snapshot.snapshotId),
    )].sort();
    const preservedSnapshotRows = await canonicalIncbReplaySnapshotRows(
      client,
      network,
      preservedSnapshotIds,
    );
    const preservedEntries = verifyCanonicalIncbReplayPreservedRows(
      manifest,
      preservedSnapshotRows,
    );
    verifyCanonicalIncbReplayBondRows(
      manifest,
      await canonicalIncbReplayBondRows(client, network, manifest),
    );
    const repeatedSnapshotRows = await canonicalIncbReplaySnapshotRows(
      client,
      network,
      preservedSnapshotIds,
    );
    verifyCanonicalIncbReplayPreservedRows(
      confirmedManifest,
      repeatedSnapshotRows,
    );
    await client.query("COMMIT");
    transactionOpen = false;

    await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
    transactionOpen = true;
    const finalStateMeta = await canonicalStateMetaFromPool(client, network);
    const finalRebuild = objectRecord(finalStateMeta.rebuild);
    const finalBinding = canonicalIncbReplayReaderBinding(
      finalRebuild,
      network,
    );
    const finalManifest = finalBinding
      ? verifyIncbRangeReplayWitnessManifest(
          await canonicalIncbReplayManifestRow(
            client,
            finalBinding.witnessSetMetaKey,
          ),
          {
            bindingId: finalBinding.bindingId,
            count: finalBinding.witnessCount,
            hash: finalBinding.witnessSetHash,
            metaKey: finalBinding.witnessSetMetaKey,
            network,
            preserveCount: finalBinding.witnessPreserveCount,
            rangeReplayFromHeight,
            throughHash: finalBinding.witnessedThroughBlockHash,
            throughHeight: finalBinding.witnessedThroughBlock,
          },
        )
      : null;
    const finalSnapshotRows = await canonicalIncbReplaySnapshotRows(
      client,
      network,
      preservedSnapshotIds,
    );
    if (
      finalStateMeta.fault?.active === true ||
      !finalBinding ||
      canonicalIncbReplaySha256(finalBinding) !==
        canonicalIncbReplaySha256(replayBinding) ||
      canonicalIncbReplaySha256(finalManifest) !==
        canonicalIncbReplaySha256(manifest)
    ) {
      throw new Error(
        "The canonical replay binding changed after the repeatable-read witness snapshot.",
      );
    }
    verifyCanonicalIncbReplayPreservedRows(finalManifest, finalSnapshotRows);
    verifyCanonicalIncbReplayBondRows(
      finalManifest,
      await canonicalIncbReplayBondRows(client, network, finalManifest),
    );
    await client.query("COMMIT");
    transactionOpen = false;
    const mints = [
      ...legacyMints,
      ...preservedEntries.map((entry) => entry.mintPayload),
    ];
    return {
      checkpointHash,
      dispositions: manifest.entries,
      fault: null,
      indexedThroughBlock: requestedHeight,
      invalidDispositionTxids,
      mints,
      network,
      rangeReplayFromHeight,
      rebuild: finalRebuild,
      source: INCB_RANGE_REPLAY_BOUND_WITNESS_SOURCE,
      witnessCount: manifest.count,
      witnessPreserveCount: manifest.preserveCount,
      witnessSetHash: manifest.commitment.hash,
      witnessedThroughBlock: manifest.throughHeight,
      witnessedThroughBlockHash: manifest.throughHash,
    };
  } catch (error) {
    if (transactionOpen) {
      await client.query("ROLLBACK").catch(() => {});
      transactionOpen = false;
    }
    return canonicalIncbReplayWitnessFaultPayload({
      checkpointHash,
      code: error?.code ?? "INCB_BOUND_WITNESS_INVALID",
      error,
      network,
      rangeReplayFromHeight,
      rebuild,
      requestedHeight,
    });
  } finally {
    client.release();
  }
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
          AND NOT (source_hashes ? 'canonicalSummary')
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
      invalidEvents: [],
      rebuild,
      transactions: [],
    };
  }
  if (fault?.active) {
    return {
      checkpointHash,
      fault,
      indexedThroughBlock: actualHeight,
      invalidEvents: [],
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

  const invalidEventQuery = canonicalVerifierIncbInvalidEventQueryParts(
    network,
    fromHeight,
    actualHeight,
  );
  const [transactionsResult, invalidEventsResult] = await Promise.all([
    pool.query(
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
    ),
    pool.query(
      `
        SELECT
          ${tokenInvalidEventSelectSql()}
        ${invalidEventQuery.fromSql}
        ORDER BY
          t.block_height ASC,
          e.txid ASC,
          e.event_id ASC
      `,
      invalidEventQuery.params,
    ),
  ]);
  const transactions = [];
  const invalidEvents = [];
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
    for (const row of invalidEventsResult.rows) {
      const event = canonicalVerifierIncbInvalidDispositionFromRow(
        row,
        canonicalBlocks,
      );
      if (!event) {
        throw new Error(
          `Invalid-event disposition ${row.txid} is not canonically bound to a rejected INCB bond mint.`,
        );
      }
      invalidEvents.push(event);
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
    invalidEvents: fault?.active ? [] : invalidEvents,
    rebuild,
    transactions: fault?.active ? [] : transactions,
  };
}

function tokenDefinitionFromRow(row) {
  const sourceMetadata = objectRecord(row?.metadata);
  const tokenId = String(row?.token_id ?? sourceMetadata.tokenId ?? "")
    .trim()
    .toLowerCase();
  const metadata = isWorkTokenId(tokenId)
    ? workAtomicProjectionMetadata(sourceMetadata)
      ? withWorkPrecisionMetadata(sourceMetadata)
      : {
          ...sourceMetadata,
          decimals: WORK_DECIMALS,
          unitScale: WORK_UNIT_SCALE_TEXT,
        }
    : sourceMetadata;
  const ticker = String(row?.ticker ?? metadata.ticker ?? "").trim();
  const workMaxSupply = isWorkTokenId(tokenId)
    ? workBalanceProjection(
        row?.max_supply ?? metadata.maxSupply ?? 0,
        sourceMetadata,
      )
    : null;
  const workMintAmount = isWorkTokenId(tokenId)
    ? workBalanceProjection(
        row?.mint_amount ?? metadata.mintAmount ?? 0,
        sourceMetadata,
      )
    : null;
  const bondToken = isBondTokenId(tokenId);
  const bondMintAmount = bondToken
    ? canonicalIntegerText(row?.mint_amount ?? metadata.mintAmount ?? 1, {
        allowZero: false,
      }) || "1"
    : "";
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
    maxSupply: bondToken
      ? null
      : workMaxSupply
        ? workMaxSupply.amount
        : rowNumber(row, "max_supply") || rowNumber(metadata, "maxSupply"),
    ...(bondToken
      ? { maxSupplyModel: "uncapped", uncapped: true }
      : {}),
    ...(workMaxSupply
      ? {
          decimals: WORK_DECIMALS,
          maxSupplyAtoms: workMaxSupply.atoms,
          unitScale: WORK_UNIT_SCALE_TEXT,
        }
      : {}),
    mintAmount: bondToken
      ? bondMintAmount
      : workMintAmount
        ? workMintAmount.amount
        : rowNumber(row, "mint_amount") || rowNumber(metadata, "mintAmount"),
    ...(workMintAmount
      ? { mintAmountAtoms: workMintAmount.atoms }
      : {}),
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
        AND (
          metadata->>'canonicalSynthetic' = 'true'
          OR EXISTS (
            SELECT 1
            FROM proof_indexer.transactions definition_transaction
            WHERE definition_transaction.network =
                proof_indexer.credit_definitions.network
              AND definition_transaction.txid =
                proof_indexer.credit_definitions.create_txid
              AND definition_transaction.status IN ('confirmed', 'pending')
          )
        )
        ${tokenStateScopeSql(scope, "token_id", "ticker")}
      ORDER BY upper(ticker), token_id
    `,
    scoped ? [network, scope] : [network],
  );
  return result.rows.map(tokenDefinitionFromRow).filter((token) => token.tokenId);
}

async function proofIndexTokenDefinitionsByIds(pool, network, tokenIds) {
  const normalizedTokenIds = [
    ...new Set(
      (Array.isArray(tokenIds) ? tokenIds : [])
        .map((tokenId) => String(tokenId ?? "").trim().toLowerCase())
        .filter(Boolean),
    ),
  ].sort();
  if (normalizedTokenIds.length === 0) {
    return [];
  }

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
        AND token_id = ANY($2::text[])
        AND (
          metadata->>'canonicalSynthetic' = 'true'
          OR EXISTS (
            SELECT 1
            FROM proof_indexer.transactions definition_transaction
            WHERE definition_transaction.network =
                proof_indexer.credit_definitions.network
              AND definition_transaction.txid =
                proof_indexer.credit_definitions.create_txid
              AND definition_transaction.status IN ('confirmed', 'pending')
          )
        )
      ORDER BY upper(ticker), token_id
    `,
    [network, normalizedTokenIds],
  );
  const tokens = result.rows
    .map(tokenDefinitionFromRow)
    .filter((token) => token.tokenId);
  const definedTokenIds = new Set(tokens.map((token) => token.tokenId));
  const missingTokenIds = normalizedTokenIds.filter(
    (tokenId) => !definedTokenIds.has(tokenId),
  );
  if (missingTokenIds.length > 0) {
    throw new Error(
      `Wallet token overlay cannot publish token state without canonical definitions: ${missingTokenIds.join(", ")}`,
    );
  }
  return tokens;
}

async function proofIndexWalletTokenDefinitions(
  pool,
  network,
  scope,
  tokenIds,
) {
  const scoped = scope && scope !== "all";
  const [itemDefinitions, scopedDefinitions] = await Promise.all([
    proofIndexTokenDefinitionsByIds(pool, network, tokenIds),
    scoped
      ? proofIndexTokenDefinitionsFromTables(pool, network, scope)
      : Promise.resolve([]),
  ]);
  const definitionsById = new Map();
  for (const token of [...itemDefinitions, ...scopedDefinitions]) {
    const tokenId = String(token?.tokenId ?? "").trim().toLowerCase();
    if (tokenId) {
      definitionsById.set(tokenId, token);
    }
  }
  return [...definitionsById.values()].sort(
    (left, right) =>
      String(left?.ticker ?? "").localeCompare(String(right?.ticker ?? "")) ||
      String(left?.tokenId ?? "").localeCompare(String(right?.tokenId ?? "")),
  );
}

async function proofIndexWalletCheckpointMetadata(pool, network) {
  const result = await pool.query(
    `
      SELECT
        snapshot_id,
        generated_at,
        indexed_through_block,
        source_hashes,
        COALESCE(
          NULLIF(payload->>'indexedThroughBlockHash', ''),
          NULLIF(payload->>'blockHash', '')
        ) AS indexed_through_block_hash,
        payload->'complete' AS payload_complete,
        metrics->'complete' AS metrics_complete,
        consistency->'complete' AS consistency_complete
      FROM proof_indexer.ledger_snapshots
      WHERE network = $1
        AND NOT (source_hashes ? 'canonicalSummary')
        AND (
          source_hashes ? 'blockScan'
          OR payload->>'source' = 'proof-indexer-block-scan'
          OR consistency->>'status' LIKE 'block-scan%'
        )
        AND COALESCE(
          NULLIF(payload->>'indexedThroughBlockHash', ''),
          NULLIF(payload->>'blockHash', '')
        ) IS NOT NULL
      ORDER BY indexed_through_block DESC NULLS LAST, generated_at DESC
      LIMIT 1
    `,
    [network],
  );
  const row = result.rows[0];
  const indexedThroughBlock = rowNumber(row, "indexed_through_block");
  const indexedThroughBlockHash = normalizedLowerText(
    row?.indexed_through_block_hash,
  );
  if (
    !row ||
    !Number.isSafeInteger(indexedThroughBlock) ||
    indexedThroughBlock <= 0 ||
    !/^[0-9a-f]{64}$/u.test(indexedThroughBlockHash)
  ) {
    return null;
  }
  return {
    checkpointComplete:
      row.payload_complete === true ||
      row.metrics_complete === true ||
      row.consistency_complete === true,
    generatedAt: dateIso(row.generated_at),
    indexedThroughBlock,
    indexedThroughBlockHash,
    snapshotId: String(row.snapshot_id ?? "").trim(),
    sourceHashes: objectRecord(row.source_hashes),
  };
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
        cd.registry_address,
        cd.metadata
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
    .map((row) => {
      const tokenId = String(row.token_id ?? "").trim().toLowerCase();
      const workBalance = isWorkTokenId(tokenId)
        ? workBalanceProjection(row.confirmed_balance ?? 0, row.metadata)
        : null;
      const workPending = isWorkTokenId(tokenId)
        ? workBalanceProjection(row.pending_delta ?? 0, row.metadata, {
            signed: true,
          })
        : null;
      const bondBalance = isBondTokenId(tokenId)
        ? exactBondUnits(row.confirmed_balance, { positive: true })
        : "";
      const bondPending = isBondTokenId(tokenId)
        ? exactBondUnits(row.pending_delta, { signed: true })
        : "";
      return {
        address: row.address,
        balance: workBalance
          ? workBalance.amount
          : bondBalance || Number(row.confirmed_balance ?? 0),
        ...(workBalance
          ? {
              balanceAtoms: workBalance.atoms,
              decimals: WORK_DECIMALS,
              unitScale: WORK_UNIT_SCALE_TEXT,
            }
          : {}),
        pendingDelta: workPending
          ? workPending.amount
          : bondPending || Number(row.pending_delta ?? 0),
        ...(workPending ? { pendingDeltaAtoms: workPending.atoms } : {}),
        registryAddress: row.registry_address ?? "",
        ticker: row.ticker ?? "",
        tokenId,
        updatedAt: dateIso(row.updated_at),
      };
    })
    .filter((holder) => {
      const balance = isBondTokenId(holder.tokenId)
        ? integerBigInt(holder.balance)
        : Number(holder.balance);
      return (
        holder.address &&
        holder.tokenId &&
        balance !== null &&
        balance > (typeof balance === "bigint" ? 0n : 0)
      );
    });
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
    if (isWorkTokenId(tokenId)) {
      current.confirmedSupplyAtoms = addAtomicStrings(
        current.confirmedSupplyAtoms,
        holder.balanceAtoms ??
          parseWorkAmountToAtoms(holder.balance ?? 0, { allowZero: true }),
      );
      current.pendingSupplyAtoms = addAtomicStrings(
        current.pendingSupplyAtoms,
        holder.pendingDeltaAtoms ??
          parseSignedWorkAmountToAtoms(holder.pendingDelta ?? 0),
      );
      current.confirmedSupply = formatWorkAtoms(
        current.confirmedSupplyAtoms,
      );
      current.pendingSupply = formatWorkAtoms(current.pendingSupplyAtoms, {
        allowNegative: true,
      });
    } else if (isBondTokenId(tokenId)) {
      current.confirmedSupply = addIntegerTexts(
        current.confirmedSupply,
        holder.balance,
      );
      current.pendingSupply = addIntegerTexts(
        current.pendingSupply,
        holder.pendingDelta,
      );
    } else {
      current.confirmedSupply += Number(holder.balance ?? 0);
      current.pendingSupply += Number(holder.pendingDelta ?? 0);
    }
    current.holderCount += isBondTokenId(tokenId)
      ? integerBigInt(holder.balance) > 0n
        ? 1
        : 0
      : Number(holder.balance ?? 0) > 0
        ? 1
        : 0;
    summaries.set(tokenId, current);
  }
  return summaries;
}

function tokenListingFromCreditListingRow(row, network) {
  const payload = objectRecord(row?.payload);
  const saleAuthorization = objectRecord(payload.saleAuthorization);
  const status = String(row?.status ?? payload.status ?? "").trim().toLowerCase();
  const terminal = ["sold", "delisted"].includes(status);
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
  const tokenId = String(
    row?.token_id ?? payload.tokenId ?? saleAuthorization.tokenId ?? "",
  )
    .trim()
    .toLowerCase();
  const workAmount = isWorkTokenId(tokenId)
    ? workAmountProjection(payload, {
        metadata: row?.token_metadata,
        storedAmount: row?.amount,
      })
    : null;
  const canonicalCloseAt = dateIso(
    row?.close_event_time ??
      row?.close_event_block_time ??
      row?.close_transaction_block_time ??
      payload.closedAt ??
      payload.closeAt,
  );
  return normalizeTokenHistoryListingItem({
    ...payload,
    amount: workAmount
      ? workAmount.amount
      : isBondTokenId(tokenId)
        ? exactBondUnits(row?.amount ?? payload?.amount, { positive: true })
      : rowNumber(row, "amount") || rowNumber(payload, "amount"),
    ...(workAmount ? { amountAtoms: workAmount.amountAtoms } : {}),
    buyerAddress: row?.buyer_address ?? payload.buyerAddress,
    closeTxid,
    closedAt: terminal
      ? canonicalCloseAt
      : dateIso(payload.closedAt ?? payload.closeAt ?? row?.updated_at),
    closedConfirmed: ["sold", "delisted"].includes(status) && validTxid(closeTxid),
    closedTxid: closeTxid,
    confirmed: status !== "pending",
    createdAt: dateIso(
      payload.createdAt ??
        payload.blockTime ??
        payload.timestamp ??
        (terminal ? undefined : row?.updated_at),
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
    sealConfirmed: tokenListingSealConfirmedFromTransaction(row, sealTxid),
    sealTxid,
    sellerAddress: row?.seller_address ?? payload.sellerAddress,
    status,
    ticker: row?.ticker ?? payload.ticker ?? saleAuthorization.ticker,
    tokenId,
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
        close_event.event_time AS close_event_time,
        close_event.block_time AS close_event_block_time,
        CASE
          WHEN close_tx.status = 'confirmed' THEN close_tx.block_time
          ELSE NULL
        END AS close_transaction_block_time,
        seal_tx.status AS seal_tx_status,
        cd.ticker,
        cd.registry_address,
        cd.metadata AS token_metadata
      FROM proof_indexer.credit_listings cl
      LEFT JOIN proof_indexer.transactions seal_tx
        ON seal_tx.network = cl.network
       AND seal_tx.txid = cl.seal_txid
      LEFT JOIN LATERAL (
        SELECT
          close_event_row.event_time,
          close_event_row.block_time
        FROM proof_indexer.events close_event_row
        WHERE close_event_row.network = cl.network
          AND close_event_row.valid = true
          AND close_event_row.status = 'confirmed'
          AND close_event_row.kind =
            ANY(ARRAY['token-sale','token-listing-closed']::text[])
          AND close_event_row.txid = COALESCE(
            NULLIF(lower(cl.close_txid), ''),
            NULLIF(lower(cl.payload->>'closeTxid'), '')
          )
          AND lower(close_event_row.payload->>'listingId') =
            lower(cl.listing_id)
        ORDER BY
          CASE WHEN close_event_row.kind = 'token-sale' THEN 0 ELSE 1 END,
          COALESCE(
            close_event_row.event_time,
            close_event_row.block_time
          ) DESC,
          close_event_row.event_id DESC
        LIMIT 1
      ) close_event ON true
      LEFT JOIN proof_indexer.transactions close_tx
        ON close_tx.network = cl.network
       AND close_tx.txid = COALESCE(
         NULLIF(lower(cl.close_txid), ''),
         NULLIF(lower(cl.payload->>'closeTxid'), '')
       )
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
        e.event_id,
        e.network,
        e.txid,
        e.protocol,
        e.kind,
        e.status,
        e.valid,
        e.amount_sats,
        e.block_height,
        t.block_hash AS block_hash,
        CASE
          WHEN e.payload->>'blockIndex' ~ '^[0-9]+$'
            THEN (e.payload->>'blockIndex')::integer
          WHEN e.payload->>'_powBlockIndex' ~ '^[0-9]+$'
            THEN (e.payload->>'_powBlockIndex')::integer
          WHEN t.raw_tx->'canonicalBlockScan'->>'blockIndex' ~ '^[0-9]+$'
            THEN (t.raw_tx->'canonicalBlockScan'->>'blockIndex')::integer
          ELSE NULL
        END AS block_index,
        e.block_time,
        e.event_time,
        e.created_at,
        e.payload,
        cd.ticker,
        cd.registry_address,
        COALESCE(cd.token_id, lower(e.payload->>'tokenId')) AS token_id
      FROM proof_indexer.events e
      LEFT JOIN proof_indexer.transactions t
        ON t.network = e.network
       AND t.txid = e.txid
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

function canonicalRawTransactionMinerFeeSats(rawTx) {
  const transaction = objectRecord(rawTx);
  const marker = objectRecord(transaction.canonicalBlockScan);
  if (!marker.network) {
    return 0;
  }
  const bitcoinValueSats = (value) => {
    const amount = Number(value);
    const sats = Math.round(amount * 100_000_000);
    return Number.isFinite(amount) && amount >= 0 && Number.isSafeInteger(sats)
      ? sats
      : Number.NaN;
  };
  const inputValues = (Array.isArray(transaction.vin) ? transaction.vin : []).map(
    (input) => {
      const explicitSats = Number(input?.prevout?.valueSats);
      return Number.isSafeInteger(explicitSats) && explicitSats >= 0
        ? explicitSats
        : bitcoinValueSats(input?.prevout?.value);
    },
  );
  const outputValues = (Array.isArray(transaction.vout) ? transaction.vout : []).map(
    (output) => {
      const explicitSats = Number(output?.valueSats);
      return Number.isSafeInteger(explicitSats) && explicitSats >= 0
        ? explicitSats
        : bitcoinValueSats(output?.value);
    },
  );
  if (
    inputValues.length > 0 &&
    outputValues.length > 0 &&
    inputValues.every(Number.isSafeInteger) &&
    outputValues.every(Number.isSafeInteger)
  ) {
    return Math.max(
      0,
      inputValues.reduce((total, value) => total + value, 0) -
        outputValues.reduce((total, value) => total + value, 0),
    );
  }
  const rawFee = Number(transaction.fee);
  const feeSats = Math.round(Math.abs(rawFee) * 100_000_000);
  return Number.isFinite(rawFee) && Number.isSafeInteger(feeSats)
    ? feeSats
    : 0;
}

function tokenInvalidAuditCosts(payload, row, registryAddress) {
  const auditMinerFeeSats =
    rowNumber(payload, "auditMinerFeeSats") ||
    rowNumber(row, "transaction_fee_sats") ||
    canonicalRawTransactionMinerFeeSats(row?.transaction_raw_tx);
  const auditRegistryPaymentSats =
    rowNumber(payload, "auditRegistryPaymentSats") ||
    (Array.isArray(payload?.recipients) ? payload.recipients : []).reduce(
      (total, recipient) =>
        String(recipient?.address ?? "").trim() === registryAddress
          ? total + rowNumber(recipient, "amountSats")
          : total,
      0,
    );
  return {
    auditMinerFeeSats,
    auditRegistryPaymentSats,
    auditTotalCostSats:
      rowNumber(payload, "auditTotalCostSats") ||
      auditMinerFeeSats + auditRegistryPaymentSats,
  };
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
  const auditCosts = tokenInvalidAuditCosts(payload, row, registryAddress);
  const tokenId = String(payload.tokenId ?? row?.token_id ?? "")
    .trim()
    .toLowerCase();

  return {
    ...payload,
    amount: isBondTokenId(tokenId)
      ? exactBondUnits(payload?.amount ?? payload?.tokenAmount)
      : rowNumber(payload, "amount") || rowNumber(payload, "tokenAmount"),
    amountSats: 0,
    ...auditCosts,
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
    frozenNetworkValueSats: 0,
    liveNetworkValueSats: 0,
    marketplaceMutationFeeSats: 0,
    minerFeeSats: 0,
    participantDetails,
    participants,
    protocol: String(payload.protocol ?? row?.protocol ?? "pwt1")
      .trim()
      .toLowerCase(),
    reason: String(payload.reason ?? validationErrors[0] ?? "").trim(),
    recipientAddress,
    proofPaymentSats: 0,
    registryAddress,
    registryMutationFeeSats: 0,
    salePaymentSats: 0,
    senderAddress,
    status: effectiveStatus,
    ticker: String(row?.ticker ?? payload.ticker ?? "").trim(),
    tokenId,
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
    t.fee_sats AS transaction_fee_sats,
    t.raw_tx AS transaction_raw_tx,
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
        e.event_id,
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
        AND e.status IN ('confirmed', 'pending')
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

function tokenListingsWithoutClosedEvents(listings, closedListings) {
  const closedListingIds = new Set(
    (Array.isArray(closedListings) ? closedListings : [])
      .map(tokenListingId)
      .filter(Boolean),
  );
  return (Array.isArray(listings) ? listings : []).filter(
    (listing) => !closedListingIds.has(tokenListingId(listing)),
  );
}

function assertCanonicalIncbCurrentProjection(tokens, mints, holders, context) {
  const incbToken = (Array.isArray(tokens) ? tokens : []).find(
    (token) =>
      String(token?.tokenId ?? "").trim().toLowerCase() === INCB_TOKEN_ID,
  );
  if (!incbToken) {
    return;
  }
  assertCanonicalIncbDefinition(incbToken, context);
  const confirmedMints = (Array.isArray(mints) ? mints : []).filter(
    (mint) =>
      mint?.confirmed === true &&
      String(mint?.tokenId ?? "").trim().toLowerCase() === INCB_TOKEN_ID,
  );
  const incbHolders = (Array.isArray(holders) ? holders : []).filter(
    (holder) =>
      String(holder?.tokenId ?? "").trim().toLowerCase() === INCB_TOKEN_ID,
  );
  const confirmedMintSupply = confirmedMints.reduce((total, mint) => {
    const issuanceFault = incbIssuanceMetadataFault(
      mint,
      {
        block_hash: mint?.blockHash,
        block_height: mint?.blockHeight,
        block_index: mint?.blockIndex,
        status: "confirmed",
        token_id: INCB_TOKEN_ID,
        txid: mint?.txid,
      },
    );
    if (issuanceFault) {
      throw new Error(
        `${context} contains invalid confirmed INCB issuance: ${issuanceFault}.`,
      );
    }
    const amount = integerBigInt(mint?.amount, { allowZero: false });
    if (amount === null) {
      throw new Error(`${context} contains an inexact INCB mint amount.`);
    }
    return total + amount;
  }, 0n);
  const confirmedBalanceSupply = incbHolders.reduce((total, holder) => {
    const balance = integerBigInt(holder?.balance, { allowZero: false });
    if (balance === null) {
      throw new Error(`${context} contains an inexact INCB holder balance.`);
    }
    return total + balance;
  }, 0n);
  if (
    confirmedMints.length === 0 ||
    confirmedMintSupply <= 0n ||
    confirmedMintSupply !== confirmedBalanceSupply
  ) {
    throw new Error(
      `${context} cannot publish INCB: canonical mint supply ${confirmedMintSupply} does not equal holder supply ${confirmedBalanceSupply}.`,
    );
  }
}

async function proofIndexTokenPayloadFromCurrentTables(pool, network, scope) {
  const tokens = await proofIndexTokenDefinitionsFromTables(pool, network, scope);
  if (tokens.length === 0) {
    return null;
  }
  for (const token of tokens) {
    assertCanonicalIncbDefinition(token, "Proof index token state");
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
    .filter((item) => {
      if (!item.txid || !item.tokenId) return false;
      if (!isBondTokenId(item.tokenId)) return Number(item.amount) > 0;
      const amount = exactBondUnits(item.amount, { positive: true });
      return Boolean(amount) && BigInt(amount) > 0n;
    })
    .sort(compareTokenItemsByTime);
  assertCanonicalIncbCurrentProjection(
    tokens,
    mints,
    holders,
    "Proof index token state",
  );
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
      if (isWorkTokenId(mint.tokenId)) {
        current.confirmedSupplyAtoms = addAtomicStrings(
          current.confirmedSupplyAtoms,
          mint.amountAtoms ??
            parseWorkAmountToAtoms(mint.amount ?? 0, { allowZero: true }),
        );
        current.confirmedSupply = formatWorkAtoms(
          current.confirmedSupplyAtoms,
        );
      } else if (isBondTokenId(mint.tokenId)) {
        current.confirmedSupply = addIntegerTexts(
          current.confirmedSupply,
          mint.amount,
        );
      } else {
        current.confirmedSupply += Number(mint.amount ?? 0);
      }
    } else {
      current.pendingMints += 1;
      if (isWorkTokenId(mint.tokenId)) {
        current.pendingSupplyAtoms = addAtomicStrings(
          current.pendingSupplyAtoms,
          mint.amountAtoms ??
            parseWorkAmountToAtoms(mint.amount ?? 0, { allowZero: true }),
        );
        current.pendingSupply = formatWorkAtoms(current.pendingSupplyAtoms);
      } else if (isBondTokenId(mint.tokenId)) {
        current.pendingSupply = addIntegerTexts(
          current.pendingSupply,
          mint.amount,
        );
      } else {
        current.pendingSupply += Number(mint.amount ?? 0);
      }
    }
    mintSummaries.set(mint.tokenId, current);
  }

  const enrichedTokens = tokens.map((token) => {
    const holderSummary = holderSummaries.get(token.tokenId) ?? {};
    const mintSummary = mintSummaries.get(token.tokenId) ?? {};
    if (isWorkTokenId(token.tokenId)) {
      const confirmedSupplyAtoms = maxAtomicStrings(
        holderSummary.confirmedSupplyAtoms,
        mintSummary.confirmedSupplyAtoms,
      );
      const pendingSupplyAtoms = maxAtomicStrings(
        holderSummary.pendingSupplyAtoms,
        mintSummary.pendingSupplyAtoms,
      );
      return {
        ...token,
        confirmedMints: mintSummary.confirmedMints ?? 0,
        confirmedSupply: formatWorkAtoms(confirmedSupplyAtoms),
        confirmedSupplyAtoms,
        holderCount: holderSummary.holderCount ?? 0,
        pendingMints: mintSummary.pendingMints ?? 0,
        pendingSupply: formatWorkAtoms(pendingSupplyAtoms),
        pendingSupplyAtoms,
      };
    }
    if (isBondTokenId(token.tokenId)) {
      return {
        ...token,
        confirmedMints: mintSummary.confirmedMints ?? 0,
        confirmedSupply: maxIntegerTexts(
          holderSummary.confirmedSupply ?? "0",
          mintSummary.confirmedSupply ?? "0",
        ),
        holderCount: holderSummary.holderCount ?? 0,
        pendingMints: mintSummary.pendingMints ?? 0,
        pendingSupply: maxIntegerTexts(
          holderSummary.pendingSupply ?? "0",
          mintSummary.pendingSupply ?? "0",
        ),
      };
    }
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

  // Canonical event rows are deliberately first. The table projection may
  // carry richer lifecycle state, but its maintenance timestamp is not market
  // chronology and must never replace the confirmed event time.
  const sales = uniqueTokenItems(
    [...marketEvents.sales, ...listingProjection.sales],
    (sale) => `${sale.network ?? network}:${sale.txid}`,
    mergeCanonicalTokenSaleRecord,
  );
  const closedListings = uniqueTokenItems(
    [...marketEvents.closedListings, ...listingProjection.closedListings],
    (listing) =>
      `${listing.network ?? network}:${listing.listingId}:${listing.closedTxid ?? listing.txid}`,
    mergeCanonicalTokenClosedListingRecord,
  );
  const listings = tokenListingsWithoutClosedEvents(
    uniqueTokenItems(
      listingProjection.listings,
      (listing) => `${listing.network ?? network}:${listing.listingId}`,
    ),
    closedListings,
  );
  const workScoped =
    enrichedTokens.length === 1 && isWorkTokenId(enrichedTokens[0]?.tokenId);
  const bondScoped =
    enrichedTokens.length === 1 && isBondTokenId(enrichedTokens[0]?.tokenId);
  const genericScoped =
    enrichedTokens.length === 1 && !workScoped && !bondScoped;
  const confirmedSupply = bondScoped
    ? holders.reduce(
        (total, holder) => addIntegerTexts(total, holder.balance),
        "0",
      )
    : genericScoped
      ? holders.reduce(
          (total, holder) => total + Number(holder.balance ?? 0),
          0,
        )
      : null;
  const mintedConfirmedSupply = bondScoped
    ? enrichedTokens.reduce(
        (total, token) => addIntegerTexts(total, token.confirmedSupply),
        "0",
      )
    : genericScoped
      ? enrichedTokens.reduce(
          (total, token) => total + Number(token.confirmedSupply ?? 0),
          0,
        )
      : null;
  const pendingSupply = bondScoped
    ? maxIntegerTexts(
        holders.reduce(
          (total, holder) => addIntegerTexts(total, holder.pendingDelta),
          "0",
        ),
        mints
          .filter((mint) => !mint.confirmed)
          .reduce(
            (total, mint) => addIntegerTexts(total, mint.amount),
            "0",
          ),
      )
    : genericScoped
      ? Math.max(
          holders.reduce(
            (total, holder) => total + Number(holder.pendingDelta ?? 0),
            0,
          ),
          mints
            .filter((mint) => !mint.confirmed)
            .reduce((total, mint) => total + Number(mint.amount ?? 0), 0),
        )
      : null;
  const confirmedSupplyAtoms = workScoped
    ? enrichedTokens[0].confirmedSupplyAtoms
    : "";
  const pendingSupplyAtoms = workScoped
    ? enrichedTokens[0].pendingSupplyAtoms
    : "";
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
    confirmedSupply: workScoped
      ? formatWorkAtoms(confirmedSupplyAtoms)
      : bondScoped
        ? maxIntegerTexts(confirmedSupply, mintedConfirmedSupply)
        : genericScoped
          ? Math.max(confirmedSupply, mintedConfirmedSupply)
          : null,
    ...(workScoped
      ? {
          confirmedSupplyAtoms,
          decimals: WORK_DECIMALS,
          unitScale: WORK_UNIT_SCALE_TEXT,
        }
      : {}),
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
    pendingSupply: workScoped
      ? formatWorkAtoms(pendingSupplyAtoms)
      : pendingSupply,
    ...(workScoped ? { pendingSupplyAtoms } : {}),
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
      SELECT
        cb.address,
        cb.confirmed_balance,
        cb.token_id,
        cd.ticker,
        cd.metadata
      FROM proof_indexer.credit_balances cb
      JOIN proof_indexer.credit_definitions cd
        ON cd.network = cb.network
       AND cd.token_id = cb.token_id
      WHERE cb.network = $1
        AND cb.token_id = $2
        AND cb.confirmed_balance > 0
      ORDER BY cb.confirmed_balance DESC, cb.address ASC
    `,
    [network, tokenId],
  );
  return result.rows.map((row) => {
    const normalizedTokenId = String(row.token_id ?? "").toLowerCase();
    const balance = isWorkTokenId(normalizedTokenId)
      ? workBalanceProjection(row.confirmed_balance, row.metadata)
      : null;
    const bondBalance = isBondTokenId(normalizedTokenId)
      ? exactBondUnits(row.confirmed_balance, { positive: true })
      : "";
    return {
      address: row.address,
      balance: balance
        ? balance.amount
        : bondBalance || Number(row.confirmed_balance),
      ...(balance
        ? {
            balanceAtoms: balance.atoms,
            decimals: WORK_DECIMALS,
            unitScale: WORK_UNIT_SCALE_TEXT,
          }
        : {}),
      ticker: row.ticker,
      tokenId: normalizedTokenId,
    };
  });
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
  const workScoped =
    tokens.length === 1 && isWorkTokenId(tokens[0]?.tokenId);
  const bondScoped =
    tokens.length === 1 && isBondTokenId(tokens[0]?.tokenId);
  const genericScoped = tokens.length === 1 && !workScoped && !bondScoped;
  const confirmedSupply = bondScoped
    ? holders.reduce(
        (total, holder) => addIntegerTexts(total, holder.balance),
        "0",
      )
    : genericScoped
      ? holders.reduce(
          (total, holder) => total + Number(holder.balance ?? 0),
          0,
        )
      : null;
  const confirmedSupplyAtoms = workScoped
    ? holders.reduce(
        (total, holder) =>
          addAtomicStrings(
            total,
            holder.balanceAtoms ??
              parseWorkAmountToAtoms(holder.balance ?? 0, {
                allowZero: true,
              }),
          ),
        "0",
      )
    : "";
  const pendingSupplyAtoms = workScoped
    ? mints
        .filter((mint) => !mint?.confirmed)
        .reduce(
          (total, mint) =>
            addAtomicStrings(
              total,
              mint.amountAtoms ??
                parseWorkAmountToAtoms(mint.amount ?? 0, {
                  allowZero: true,
                }),
            ),
          "0",
        )
    : "";
  const creationSats = tokens.reduce(
    (total, token) => total + Number(token?.creationFeeSats ?? 0),
    0,
  );
  const payload = {
    ...allPayload,
    closedListings,
    confirmedSupply: workScoped
      ? formatWorkAtoms(confirmedSupplyAtoms)
      : confirmedSupply,
    ...(workScoped
      ? {
          confirmedSupplyAtoms,
          decimals: WORK_DECIMALS,
          unitScale: WORK_UNIT_SCALE_TEXT,
        }
      : {}),
    creationSats,
    holders,
    invalidEvents,
    listings,
    mints,
    pendingSupply: workScoped
      ? formatWorkAtoms(pendingSupplyAtoms)
      : bondScoped
        ? mints
            .filter((mint) => !mint?.confirmed)
            .reduce(
              (total, mint) => addIntegerTexts(total, mint?.amount),
              "0",
            )
        : genericScoped
          ? mints
              .filter((mint) => !mint?.confirmed)
              .reduce((total, mint) => total + Number(mint?.amount ?? 0), 0)
          : null,
    ...(workScoped ? { pendingSupplyAtoms } : {}),
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

function walletProjectionExceedsLimit(rows, limit, status = "") {
  const normalizedStatus = normalizedLowerText(status);
  const candidates = Array.isArray(rows)
    ? normalizedStatus
      ? rows.filter(
          (row) => normalizedLowerText(row?.status) === normalizedStatus,
        )
      : rows
    : [];
  return candidates.length > limit;
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
        .map((address) => String(address ?? "").trim())
        .map((address) =>
          /^(?:bc1|tb1|bcrt1)/iu.test(address)
            ? address.toLowerCase()
            : address,
        )
        .filter(Boolean),
    ),
  ];
  if (!pool || addressNeedles.length === 0) {
    return null;
  }

  const scope = tokenScopeKey(tokenScope);
  const scoped = scope && scope !== "all";
  const checkpointBeforeRead = await proofIndexWalletCheckpointMetadata(
    pool,
    network,
  );
  if (!checkpointBeforeRead) {
    return null;
  }
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
        cd.registry_address,
        cd.metadata
      FROM proof_indexer.credit_balances cb
      JOIN proof_indexer.credit_definitions cd
        ON cd.network = cb.network
       AND cd.token_id = cb.token_id
      WHERE cb.network = $1
        AND cb.address = ANY($2::text[])
        ${scopeCondition}
      ORDER BY cb.updated_at DESC, cb.address ASC
    `,
    holderParams,
  );
  const invalidQuery = tokenInvalidEventQueryParts(network, scope);
  const invalidAddressParam = `$${invalidQuery.params.length + 1}`;
  const invalidLimitParam = `$${invalidQuery.params.length + 2}`;
  const invalidResult = await pool.query(
    `
      SELECT
        ${tokenInvalidEventSelectSql()}
      ${invalidQuery.fromSql}
        AND (
          EXISTS (
            SELECT 1
            FROM proof_indexer.event_participants ep_wallet_invalid
            WHERE ep_wallet_invalid.event_id = e.event_id
              AND ep_wallet_invalid.address = ANY(${invalidAddressParam}::text[])
          )
          OR e.payload->>'actor' = ANY(${invalidAddressParam}::text[])
          OR e.payload->>'counterparty' = ANY(${invalidAddressParam}::text[])
          OR e.payload->>'senderAddress' = ANY(${invalidAddressParam}::text[])
          OR e.payload->>'recipientAddress' = ANY(${invalidAddressParam}::text[])
          OR e.payload->>'sellerAddress' = ANY(${invalidAddressParam}::text[])
          OR e.payload->>'buyerAddress' = ANY(${invalidAddressParam}::text[])
        )
      ORDER BY
        COALESCE(t.block_time, e.event_time, e.block_time, e.created_at) DESC,
        e.txid DESC,
        e.event_id DESC
      LIMIT ${invalidLimitParam}
    `,
    [...invalidQuery.params, addressNeedles, 500],
  );

  const eventConditions = [
    "e.network = $1",
    "e.valid = true",
    "e.status IN ('confirmed', 'pending')",
    `(EXISTS (
      SELECT 1
      FROM proof_indexer.event_participants ep
      WHERE ep.event_id = e.event_id
        AND ep.address = ANY($2::text[])
    )
      OR e.payload->>'actor' = ANY($2::text[])
      OR e.payload->>'counterparty' = ANY($2::text[])
      OR e.payload->>'senderAddress' = ANY($2::text[])
      OR e.payload->>'recipientAddress' = ANY($2::text[])
      OR e.payload->>'sellerAddress' = ANY($2::text[])
      OR e.payload->>'buyerAddress' = ANY($2::text[])
      OR e.payload->'saleAuthorization'->>'sellerAddress' = ANY($2::text[])
      OR e.payload->'saleAuthorization'->>'buyerAddress' = ANY($2::text[]))`,
    `(
      e.kind NOT IN ('token-listings', 'token-listing')
      OR NOT EXISTS (
        SELECT 1
        FROM proof_indexer.events close_event
        WHERE close_event.network = e.network
          AND close_event.valid = true
          AND close_event.status IN ('confirmed', 'pending')
          AND close_event.kind = ANY(ARRAY['token-listing-closed','token-sale']::text[])
          AND lower(close_event.payload->>'listingId') = lower(e.payload->>'listingId')
      )
    )`,
  ];
  const eventParams = [network, addressNeedles];
  const walletAuthoritativeRowLimit = 500;
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
  const eventParamsWithLimit = [
    ...eventParams,
    walletAuthoritativeRowLimit + 1,
  ];
  const eventLimitParam = `$${eventParamsWithLimit.length}`;
  const eventResult = await pool.query(
    `
      SELECT
        e.event_id,
        e.payload,
        e.status,
        e.event_time,
        e.block_time,
        e.created_at,
        e.block_height,
        t.block_hash AS block_hash,
        CASE
          WHEN e.payload->>'blockIndex' ~ '^[0-9]+$'
            THEN (e.payload->>'blockIndex')::integer
          WHEN e.payload->>'_powBlockIndex' ~ '^[0-9]+$'
            THEN (e.payload->>'_powBlockIndex')::integer
          WHEN t.raw_tx->'canonicalBlockScan'->>'blockIndex' ~ '^[0-9]+$'
            THEN (t.raw_tx->'canonicalBlockScan'->>'blockIndex')::integer
          ELSE NULL
        END AS block_index,
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
      LEFT JOIN proof_indexer.transactions t
        ON t.network = e.network
       AND t.txid = e.txid
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
        CASE WHEN e.status = 'pending' THEN 0 ELSE 1 END ASC,
        COALESCE(e.event_time, e.block_time, e.created_at) DESC,
        e.txid DESC,
        e.event_id DESC
      LIMIT ${eventLimitParam}
    `,
    eventParamsWithLimit,
  );

  const listingConditions = [
    "cl.network = $1",
    "cl.seller_address = ANY($2::text[])",
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
  const listingParamsWithLimit = [
    ...listingParams,
    walletAuthoritativeRowLimit + 1,
  ];
  const listingLimitParam = `$${listingParamsWithLimit.length}`;
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
        seal_tx.status AS seal_tx_status,
        cd.ticker,
        cd.registry_address,
        cd.metadata AS token_metadata
      FROM proof_indexer.credit_listings cl
      LEFT JOIN proof_indexer.transactions seal_tx
        ON seal_tx.network = cl.network
       AND seal_tx.txid = cl.seal_txid
      LEFT JOIN proof_indexer.credit_definitions cd
        ON cd.network = cl.network
       AND cd.token_id = cl.token_id
      WHERE ${listingConditions.join(" AND ")}
      ORDER BY cl.updated_at DESC, cl.listing_id ASC
      LIMIT ${listingLimitParam}
    `,
    listingParamsWithLimit,
  );

  if (
    walletProjectionExceedsLimit(
      eventResult.rows,
      walletAuthoritativeRowLimit,
      "pending",
    )
  ) {
    throw new Error(
      `Wallet token overlay exceeds the ${walletAuthoritativeRowLimit}-pending-event authoritative limit.`,
    );
  }
  if (
    walletProjectionExceedsLimit(
      listingResult.rows,
      walletAuthoritativeRowLimit,
    )
  ) {
    throw new Error(
      `Wallet token overlay exceeds the ${walletAuthoritativeRowLimit}-active-listing authoritative limit.`,
    );
  }

  const holders = holderResult.rows
    .map((row) => {
      const tokenId = String(row.token_id ?? "").toLowerCase();
      const balance = isWorkTokenId(tokenId)
        ? workBalanceProjection(row.confirmed_balance ?? 0, row.metadata)
        : null;
      const pending = isWorkTokenId(tokenId)
        ? workBalanceProjection(row.pending_delta ?? 0, row.metadata, {
            signed: true,
          })
        : null;
      const bondBalance = isBondTokenId(tokenId)
        ? exactBondUnits(row.confirmed_balance)
        : "";
      const bondPending = isBondTokenId(tokenId)
        ? exactBondUnits(row.pending_delta, { signed: true })
        : "";
      return {
        address: row.address,
        balance: balance
          ? balance.amount
          : bondBalance || Number(row.confirmed_balance ?? 0),
        ...(balance
          ? {
              balanceAtoms: balance.atoms,
              decimals: WORK_DECIMALS,
              unitScale: WORK_UNIT_SCALE_TEXT,
            }
          : {}),
        pendingDelta: pending
          ? pending.amount
          : bondPending || Number(row.pending_delta ?? 0),
        ...(pending ? { pendingDeltaAtoms: pending.atoms } : {}),
        ticker: row.ticker,
        tokenId,
      };
    })
    .filter((holder) => {
      const balance = isBondTokenId(holder.tokenId)
        ? integerBigInt(holder.balance)
        : Number(holder.balance);
      return (
        holder.address &&
        balance !== null &&
        balance >= (typeof balance === "bigint" ? 0n : 0)
      );
    })
    .sort(compareTokenHolderBalances);
  const transfers = [];
  const sales = [];
  const listings = [];
  const closedListings = [];
  const invalidEvents = invalidResult.rows
    .map(tokenInvalidEventFromRow)
    .filter((item) => item.txid && item.confirmed && item.valid === false)
    .sort(compareTokenItemsByTime);
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
        amountAtoms:
          payload.amountAtoms ??
          listingPayload.amountAtoms ??
          (isWorkTokenId(
            payload.tokenId ?? listingPayload.tokenId ?? row.token_id,
          ) &&
          row.listing_amount !== null &&
          row.listing_amount !== undefined
            ? storedWorkAtoms(row.listing_amount ?? 0, row.token_metadata)
            : undefined),
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
    const tokenId = String(row.token_id ?? payload.tokenId ?? "")
      .trim()
      .toLowerCase();
    const workAmount = isWorkTokenId(tokenId)
      ? workAmountProjection(payload, {
          metadata: row.token_metadata,
          storedAmount: row.amount,
        })
      : null;
    const listing = {
      ...payload,
      amount: workAmount
        ? workAmount.amount
        : isBondTokenId(tokenId)
          ? exactBondUnits(row?.amount ?? payload?.amount, {
              positive: true,
            })
        : rowNumber(row, "amount") || rowNumber(payload, "amount"),
      ...(workAmount
        ? {
            amountAtoms: workAmount.amountAtoms,
            decimals: WORK_DECIMALS,
            unitScale: WORK_UNIT_SCALE_TEXT,
          }
        : {}),
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
      sealConfirmed: tokenListingSealConfirmedFromTransaction(row, sealTxid),
      sealTxid,
      sellerAddress: row.seller_address ?? payload.sellerAddress ?? "",
      status: row.status ?? payload.status,
      ticker: payload.ticker ?? row.ticker ?? saleAuthorization.ticker ?? "",
      tokenId,
      txid: String(row.listing_id ?? payload.txid ?? "")
        .trim()
        .toLowerCase(),
    };
    if (activeTokenListingHistoryItem(listing)) {
      listings.push(listing);
    }
  }

  const tokenBearingItems = [
    ...holders,
    ...transfers,
    ...sales,
    ...listings,
    ...closedListings,
  ];
  const [tokens, checkpoint] = await Promise.all([
    proofIndexWalletTokenDefinitions(
      pool,
      network,
      scope,
      tokenBearingItems.map((item) => item?.tokenId),
    ),
    proofIndexWalletCheckpointMetadata(pool, network),
  ]);
  for (const token of tokens) {
    assertCanonicalIncbDefinition(token, "Proof index wallet overlay");
  }
  if (
    !checkpoint ||
    checkpoint.indexedThroughBlock !==
      checkpointBeforeRead.indexedThroughBlock ||
    checkpoint.indexedThroughBlockHash !==
      checkpointBeforeRead.indexedThroughBlockHash
  ) {
    throw new Error(
      "Wallet token overlay checkpoint changed during its scoped read.",
    );
  }

  const newestTime = [
    checkpoint?.generatedAt,
    ...holderResult.rows.map((row) => row.updated_at),
    ...eventResult.rows.map(
      (row) => row.event_time ?? row.block_time ?? row.created_at,
    ),
    ...listingResult.rows.map((row) => row.updated_at),
    ...invalidEvents.map((event) => event.createdAt),
  ]
    .map((value) => Date.parse(value))
    .filter(Number.isFinite)
    .reduce((max, value) => Math.max(max, value), 0);

  return {
    checkpointComplete: checkpoint?.checkpointComplete,
    holders,
    indexedAt: newestTime ? new Date(newestTime).toISOString() : undefined,
    indexedThroughBlock: checkpoint?.indexedThroughBlock,
    indexedThroughBlockHash: checkpoint?.indexedThroughBlockHash,
    invalidEvents,
    closedListings: closedListings.sort(compareTokenItemsByTime),
    listings: listings.sort(compareTokenItemsByTime),
    network,
    sales: sales.sort(compareTokenItemsByTime),
    snapshotId: checkpoint?.snapshotId,
    source: "proof-indexer-wallet-token-overlay",
    sourceHashes: checkpoint?.sourceHashes,
    tokenScope: scope,
    tokens,
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
      SELECT token_id, ticker, metadata
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
  assertCanonicalIncbDefinition(
    {
      ...objectRecord(token.metadata),
      tokenId: token.token_id,
    },
    "Proof index holder history",
  );

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
    items: rowsResult.rows.map((row) => {
      const balance = isWorkTokenId(token.token_id)
        ? workBalanceProjection(row.confirmed_balance, token.metadata)
        : null;
      const bondBalance = isBondTokenId(token.token_id)
        ? exactBondUnits(row.confirmed_balance, { positive: true })
        : "";
      return {
        address: row.address,
        balance: balance
          ? balance.amount
          : bondBalance || Number(row.confirmed_balance),
        ...(balance
          ? {
              balanceAtoms: balance.atoms,
              decimals: WORK_DECIMALS,
              unitScale: WORK_UNIT_SCALE_TEXT,
            }
          : {}),
        ticker: token.ticker,
        tokenId: token.token_id,
      };
    }),
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
  const expectedHeightOptionPresent = options.expectedHeight !== undefined;
  const expectedHashOptionPresent = options.expectedHash !== undefined;
  const expectedCheckpointOptionPresent =
    expectedHeightOptionPresent || expectedHashOptionPresent;
  const expectedHeight = Number(options.expectedHeight);
  const expectedHash = normalizedLowerText(options.expectedHash);
  const exactCheckpointRequested =
    expectedHeightOptionPresent &&
    expectedHashOptionPresent &&
    Number.isSafeInteger(expectedHeight) &&
    expectedHeight > 0 &&
    /^[0-9a-f]{64}$/u.test(expectedHash);
  const allowIncompleteExactCheckpoint =
    options.allowIncompleteScan === true && exactCheckpointRequested;
  if (
    (expectedCheckpointOptionPresent && !exactCheckpointRequested) ||
    (options.allowIncompleteScan === true && !exactCheckpointRequested) ||
    (scanPayload.complete !== true && !allowIncompleteExactCheckpoint) ||
    !/^[0-9a-f]{64}$/u.test(scanBlockHash) ||
    !Number.isSafeInteger(scanIndexedThroughBlock) ||
    scanIndexedThroughBlock <= 0 ||
    (exactCheckpointRequested &&
      (scanIndexedThroughBlock !== expectedHeight ||
        scanBlockHash !== expectedHash))
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
    indexedThroughBlockHash: scanBlockHash,
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

export async function proofIndexCanonicalActivityPayload(
  network,
  options = {},
) {
  const pool = proofIndexPool();
  if (!pool) {
    return null;
  }

  const requestedSnapshotId = String(options.snapshotId ?? "").trim();
  if (
    requestedSnapshotId &&
    (requestedSnapshotId.length > 128 || /\s/u.test(requestedSnapshotId))
  ) {
    return null;
  }
  const membershipRestricted = Object.hasOwn(options, "eventIds");
  const requestedEventIds = membershipRestricted
    ? [...new Set(
        (Array.isArray(options.eventIds) ? options.eventIds : []).map(Number),
      )]
    : [];
  if (
    membershipRestricted &&
    (requestedEventIds.length < 1 ||
      requestedEventIds.length > 500 ||
      requestedEventIds.some(
        (eventId) => !Number.isSafeInteger(eventId) || eventId < 1,
      ))
  ) {
    return null;
  }
  const boundSnapshot = requestedSnapshotId
    ? await ledgerSnapshotMetadata(pool, network, requestedSnapshotId)
    : null;
  if (requestedSnapshotId && !boundSnapshot) {
    return null;
  }
  const snapshotHeight = rowNumber(boundSnapshot, "indexed_through_block");
  const snapshotGeneratedAt = boundSnapshot?.generated_at ?? null;
  if (
    requestedSnapshotId &&
    (snapshotHeight <= 0 || !Number.isFinite(Date.parse(snapshotGeneratedAt)))
  ) {
    return null;
  }
  const queryParams = [network, [...PUBLIC_LOG_EVENT_KINDS]];
  const addQueryParam = (value) => {
    queryParams.push(value);
    return `$${queryParams.length}`;
  };
  const snapshotHeightParam = requestedSnapshotId
    ? addQueryParam(snapshotHeight)
    : "";
  const snapshotTimeParam = requestedSnapshotId
    ? addQueryParam(snapshotGeneratedAt)
    : "";
  const eventIdsParam = membershipRestricted
    ? addQueryParam(requestedEventIds)
    : "";
  const snapshotWhere = requestedSnapshotId
    ? `
          AND e.updated_at <= ${snapshotTimeParam}::timestamptz
          AND (
            (
              e.status = 'confirmed'
              AND e.block_height > 0
              AND e.block_height <= ${snapshotHeightParam}
            )
            OR (
              e.status = 'pending'
              AND e.created_at <= ${snapshotTimeParam}::timestamptz
            )
          )
      `
    : "";
  const membershipWhere = membershipRestricted
    ? `AND e.event_id = ANY(${eventIdsParam}::bigint[])`
    : "";
  const transactionSnapshotWhere = requestedSnapshotId
    ? `AND transaction_row.updated_at <= ${snapshotTimeParam}::timestamptz`
    : "";
  const blockSnapshotWhere = requestedSnapshotId
    ? `AND canonical_block.indexed_at <= ${snapshotTimeParam}::timestamptz`
    : "";

  const result = await pool.query(
    `
      WITH selected_events AS (
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
          e.network
        FROM proof_indexer.events e
        WHERE e.network = $1
          AND e.valid = true
          AND e.status IN ('confirmed', 'pending')
          AND e.kind = ANY($2::text[])
          ${snapshotWhere}
          ${membershipWhere}
      ),
      selected_txids AS (
        SELECT DISTINCT network, txid
        FROM selected_events
        WHERE status = 'confirmed'
      ),
      input_totals AS (
        SELECT
          i.network,
          i.txid,
          COUNT(*)::integer AS input_count,
          COUNT(i.value_sats)::integer AS valued_input_count,
          SUM(i.value_sats)::numeric AS input_value_sats
        FROM proof_indexer.tx_inputs i
        JOIN selected_txids selected
          ON selected.network = i.network
         AND selected.txid = i.txid
        GROUP BY i.network, i.txid
      ),
      output_totals AS (
        SELECT
          o.network,
          o.txid,
          COUNT(*)::integer AS output_count,
          COUNT(o.value_sats)::integer AS valued_output_count,
          SUM(o.value_sats)::numeric AS output_value_sats
        FROM proof_indexer.tx_outputs o
        JOIN selected_txids selected
          ON selected.network = o.network
         AND selected.txid = o.txid
        GROUP BY o.network, o.txid
      )
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
        transaction_row.block_hash AS block_hash,
        CASE
          WHEN e.payload->>'blockIndex' ~ '^[0-9]+$'
            THEN (e.payload->>'blockIndex')::integer
          WHEN e.payload->>'_powBlockIndex' ~ '^[0-9]+$'
            THEN (e.payload->>'_powBlockIndex')::integer
          WHEN transaction_row.raw_tx->'canonicalBlockScan'->>'blockIndex' ~ '^[0-9]+$'
            THEN (
              transaction_row.raw_tx->'canonicalBlockScan'->>'blockIndex'
            )::integer
          ELSE NULL
        END AS block_index,
        CASE
          WHEN e.status = 'confirmed'
            AND transaction_row.status = 'confirmed'
            AND transaction_row.block_hash IS NOT NULL
            AND transaction_row.block_height IS NOT NULL
            AND canonical_block.canonical = true
            AND canonical_block.block_hash = transaction_row.block_hash
            AND canonical_block.height = transaction_row.block_height
            AND (
              e.block_height IS NULL
              OR e.block_height = transaction_row.block_height
            )
            AND jsonb_typeof(transaction_row.raw_tx) = 'object'
            AND jsonb_typeof(
              transaction_row.raw_tx->'canonicalBlockScan'
            ) = 'object'
            AND transaction_row.raw_tx->'canonicalBlockScan'->>'network' =
              transaction_row.network
            AND transaction_row.raw_tx->'canonicalBlockScan'->>'height' =
              transaction_row.block_height::text
            AND lower(
              transaction_row.raw_tx->'canonicalBlockScan'->>'blockHash'
            ) = lower(transaction_row.block_hash)
            AND lower(COALESCE(transaction_row.raw_tx->>'txid', '')) = e.txid
            AND jsonb_typeof(transaction_row.raw_tx->'vin') = 'array'
            AND jsonb_typeof(transaction_row.raw_tx->'vout') = 'array'
            AND output_totals.output_count > 0
            AND output_totals.valued_output_count =
              output_totals.output_count
            AND output_totals.output_count =
              jsonb_array_length(
                CASE
                  WHEN jsonb_typeof(transaction_row.raw_tx->'vout') = 'array'
                    THEN transaction_row.raw_tx->'vout'
                  ELSE '[]'::jsonb
                END
              )
            AND (
              (
                jsonb_array_length(transaction_row.raw_tx->'vin') = 1
                AND jsonb_typeof(transaction_row.raw_tx->'vin'->0) = 'object'
                AND jsonb_exists(
                  transaction_row.raw_tx->'vin'->0,
                  'coinbase'
                )
                AND input_totals.input_count = 1
                AND input_totals.valued_input_count = 0
              )
              OR (
                NOT jsonb_exists(
                  transaction_row.raw_tx->'vin'->0,
                  'coinbase'
                )
                AND
                input_totals.input_count > 0
                AND input_totals.valued_input_count = input_totals.input_count
                AND input_totals.input_count =
                  jsonb_array_length(transaction_row.raw_tx->'vin')
                AND input_totals.input_value_sats >=
                  output_totals.output_value_sats
              )
            )
          THEN CASE
            WHEN jsonb_exists(
              transaction_row.raw_tx->'vin'->0,
              'coinbase'
            ) THEN 0
            ELSE (
              input_totals.input_value_sats - output_totals.output_value_sats
            )::bigint
          END
          ELSE NULL
        END AS canonical_miner_fee_sats,
        CASE
          WHEN e.status = 'confirmed'
            AND transaction_row.status = 'confirmed'
            AND transaction_row.block_hash IS NOT NULL
            AND transaction_row.block_height IS NOT NULL
            AND canonical_block.canonical = true
            AND canonical_block.block_hash = transaction_row.block_hash
            AND canonical_block.height = transaction_row.block_height
            AND (
              e.block_height IS NULL
              OR e.block_height = transaction_row.block_height
            )
            AND jsonb_typeof(transaction_row.raw_tx) = 'object'
            AND jsonb_typeof(
              transaction_row.raw_tx->'canonicalBlockScan'
            ) = 'object'
            AND transaction_row.raw_tx->'canonicalBlockScan'->>'network' =
              transaction_row.network
            AND transaction_row.raw_tx->'canonicalBlockScan'->>'height' =
              transaction_row.block_height::text
            AND lower(
              transaction_row.raw_tx->'canonicalBlockScan'->>'blockHash'
            ) = lower(transaction_row.block_hash)
            AND lower(COALESCE(transaction_row.raw_tx->>'txid', '')) = e.txid
            AND jsonb_typeof(transaction_row.raw_tx->'vin') = 'array'
            AND jsonb_typeof(transaction_row.raw_tx->'vout') = 'array'
            AND output_totals.output_count > 0
            AND output_totals.valued_output_count =
              output_totals.output_count
            AND output_totals.output_count =
              jsonb_array_length(
                CASE
                  WHEN jsonb_typeof(transaction_row.raw_tx->'vout') = 'array'
                    THEN transaction_row.raw_tx->'vout'
                  ELSE '[]'::jsonb
                END
              )
            AND (
              (
                jsonb_array_length(transaction_row.raw_tx->'vin') = 1
                AND jsonb_typeof(transaction_row.raw_tx->'vin'->0) = 'object'
                AND jsonb_exists(
                  transaction_row.raw_tx->'vin'->0,
                  'coinbase'
                )
                AND input_totals.input_count = 1
                AND input_totals.valued_input_count = 0
              )
              OR (
                NOT jsonb_exists(
                  transaction_row.raw_tx->'vin'->0,
                  'coinbase'
                )
                AND
                input_totals.input_count > 0
                AND input_totals.valued_input_count = input_totals.input_count
                AND input_totals.input_count =
                  jsonb_array_length(transaction_row.raw_tx->'vin')
                AND input_totals.input_value_sats >=
                  output_totals.output_value_sats
              )
            )
          THEN true
          ELSE false
        END AS canonical_miner_fee_covered
      FROM selected_events e
      LEFT JOIN proof_indexer.transactions transaction_row
        ON transaction_row.network = e.network
       AND transaction_row.txid = e.txid
       ${transactionSnapshotWhere}
      LEFT JOIN proof_indexer.blocks canonical_block
        ON canonical_block.network = transaction_row.network
       AND canonical_block.block_hash = transaction_row.block_hash
       AND canonical_block.height = transaction_row.block_height
       AND canonical_block.canonical = true
       ${blockSnapshotWhere}
      LEFT JOIN input_totals
        ON input_totals.network = e.network
       AND input_totals.txid = e.txid
      LEFT JOIN output_totals
        ON output_totals.network = e.network
       AND output_totals.txid = e.txid
      ORDER BY
        COALESCE(e.event_time, e.block_time, e.created_at) DESC,
        e.txid DESC,
        e.event_id DESC
    `,
    queryParams,
  );
  const snapshot =
    boundSnapshot ??
    (await latestProofIndexScanMetadata(pool, network).catch(() => null));
  const items = normalizeHistoryEventRows(result.rows, network);
  if (items.length === 0) {
    return null;
  }

  const confirmed = items.filter((item) => item.confirmed).length;
  const confirmedRows = result.rows.filter(
    (row) => row?.status === "confirmed",
  );
  const confirmedTxids = new Set(
    confirmedRows.map((row) => normalizedTxid(row?.txid)).filter(Boolean),
  );
  const coveredConfirmedRows = confirmedRows.filter(
    (row) => row?.canonical_miner_fee_covered === true,
  );
  const coveredConfirmedTxids = new Set(
    coveredConfirmedRows
      .map((row) => normalizedTxid(row?.txid))
      .filter(Boolean),
  );
  const missingConfirmedTxids = [
    ...new Set(
      confirmedRows
        .filter((row) => row?.canonical_miner_fee_covered !== true)
        .map((row) => normalizedTxid(row?.txid))
        .filter(Boolean),
    ),
  ];
  const canonicalMinerFeeCoverage = {
    complete:
      confirmedTxids.size > 0 &&
      missingConfirmedTxids.length === 0 &&
      coveredConfirmedRows.length === confirmedRows.length,
    confirmedEvents: confirmedRows.length,
    coveredConfirmedEvents: coveredConfirmedRows.length,
    missingConfirmedEvents:
      confirmedRows.length - coveredConfirmedRows.length,
    confirmedTransactions: confirmedTxids.size,
    coveredConfirmedTransactions: coveredConfirmedTxids.size,
    missingConfirmedTransactions: missingConfirmedTxids.length,
    missingConfirmedTxids: missingConfirmedTxids.slice(0, 100),
    source: "proof-indexer-normalized-input-output-totals",
  };
  const latestEventBlock = indexedThroughBlockFromItems(items) ?? 0;
  const indexedThroughBlock =
    Math.max(
      latestEventBlock,
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
    canonicalMinerFeeCoverage,
    consistency: snapshot?.consistency ?? undefined,
    indexedAt,
    indexedThroughBlock,
    latestEventBlock,
    ledgerGeneratedAt: snapshot?.generated_at
      ? dateIso(snapshot.generated_at)
      : indexedAt,
    network,
    ...(membershipRestricted
      ? {
          membershipEventIds: requestedEventIds,
          membershipRestricted: true,
        }
      : {}),
    snapshotId: snapshot?.snapshot_id ?? undefined,
    snapshotTotalCount: requestedSnapshotId ? items.length : undefined,
    source: "proof-indexer-events",
    stats: {
      canonicalMinerFeeCoverage,
      confirmed,
      indexedThroughBlock,
      latestEventBlock,
      pending: items.length - confirmed,
      total: items.length,
    },
    totalCount: items.length,
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
  const canonicalMinerFeeCovered =
    row?.canonical_miner_fee_covered === true;
  const canonicalMinerFeeSats = canonicalMinerFeeCovered
    ? rowNumber(row, "canonical_miner_fee_sats")
    : undefined;
  const canonicalMinerFeePatch = canonicalMinerFeeCovered
    ? {
        canonicalMinerFeeCovered: true,
        canonicalMinerFeeSats,
        minerFeeSats: canonicalMinerFeeSats,
        minerFeeSource: "proof-indexer-normalized-input-output-totals",
        ...(kind === "token-listing-sealed"
          ? { sealMinerFeeSats: canonicalMinerFeeSats }
          : {}),
        ...(kind === "token-listing-closed" || kind === "token-sale"
          ? { closedMinerFeeSats: canonicalMinerFeeSats }
          : {}),
      }
    : {};
  const attemptedAmountSats = invalidTokenEvent
    ? rowNumber(payload, "amountSats") || rowNumber(row, "amount_sats")
    : 0;
  const registryAddress = normalizedText(
    payload.registryAddress ?? row.registry_address,
  );
  const auditCosts = invalidTokenEvent
    ? tokenInvalidAuditCosts(payload, row, registryAddress)
    : {};
  const blockIndex = Number(
    row?.block_index ?? payload.blockIndex ?? payload._powBlockIndex,
  );
  return {
    ...payload,
    ...canonicalEventIdentityDetails({
      ...payload,
      // Membership checks must bind the relational row identity. Never let a
      // payload field shadow the database event id used by the bounded query.
      eventId: row?.event_id ?? payload?.eventId,
    }),
    ...canonicalMinerFeePatch,
    ...(invalidTokenEvent
      ? {
          amountSats: 0,
          ...auditCosts,
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
    blockHash: String(
      row?.block_hash ?? payload.blockHash ?? payload._powBlockHash ?? "",
    )
      .trim()
      .toLowerCase(),
    blockHeight: rowNumber(row, "block_height") || payload.blockHeight,
    ...(Number.isSafeInteger(blockIndex) && blockIndex >= 0
      ? { blockIndex }
      : {}),
    txid: row.txid ?? payload.txid,
    protocol: row.protocol ?? payload.protocol,
    kind,
    participants: eventPayloadParticipants(payload),
    status: row.status ?? payload.status,
    confirmed: row.status ? row.status === "confirmed" : payload.confirmed,
    createdAt: dateIso(
      plausibleBitcoinEventTime(
        row.event_time,
        row.block_time,
        payload.blockTime,
        payload.timestamp,
        payload.createdAt,
        row.created_at,
      ),
    ),
    network,
  };
}

function tokenMarketListingSealPatch(payload, listingPayload) {
  const kind = normalizedLowerText(payload?.kind);
  if (
    !["token-listings", "token-listing", "token-listing-sealed"].includes(
      kind,
    ) ||
    !validTxid(listingPayload?.sealTxid)
  ) {
    return {};
  }

  const saleAuthorization = objectRecord(listingPayload.saleAuthorization);
  return {
    ...(Object.keys(saleAuthorization).length > 0 ? { saleAuthorization } : {}),
    sealAt: listingPayload.sealAt ?? payload?.sealAt,
    sealConfirmed:
      typeof listingPayload.sealConfirmed === "boolean"
        ? listingPayload.sealConfirmed
        : payload?.sealConfirmed,
    sealDataBytes:
      listingPayload.sealDataBytes ??
      listingPayload.dataBytes ??
      payload?.sealDataBytes,
    sealFrozenNetworkValueSats:
      listingPayload.sealFrozenNetworkValueSats ??
      payload?.sealFrozenNetworkValueSats,
    sealLiveNetworkValueSats:
      listingPayload.sealLiveNetworkValueSats ??
      payload?.sealLiveNetworkValueSats,
    sealMinerFeeCanonical:
      listingPayload.sealMinerFeeCanonical === true ||
      payload?.sealMinerFeeCanonical === true,
    sealMinerFeeSats:
      listingPayload.sealMinerFeeSats ?? payload?.sealMinerFeeSats,
    sealMinerFeeSource:
      listingPayload.sealMinerFeeSource ?? payload?.sealMinerFeeSource,
    sealTxid: String(listingPayload.sealTxid).trim().toLowerCase(),
    status: listingPayload.status ?? payload?.status,
  };
}

function tokenMarketEventRowPayload(row, network) {
  const payload = eventRowPayload(row, network);
  const listingPayload = objectRecord(row?.listing_payload);
  const sealPatch = tokenMarketListingSealPatch(payload, listingPayload);
  const merged = {
    ...listingPayload,
    ...payload,
    ...sealPatch,
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
  "inception-bond",
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
  const amount = addresses.length === 1 ? totalAmountSats : 0;
  return addresses.map((address) => ({
    address,
    amountSats: amount,
    display: address,
  }));
}

function mailRecipientRowsFromSource(source) {
  return (Array.isArray(source?.recipients) ? source.recipients : [])
    .map((recipient) => {
      if (typeof recipient === "string") {
        return {
          address: normalizedAddress(recipient),
          amountSats: 0,
          display: normalizedAddress(recipient),
        };
      }
      const address = normalizedAddress(
        recipient?.address ?? recipient?.display,
      );
      const amountSats = positiveNumber(recipient?.amountSats);
      return {
        address,
        amountSats,
        display: normalizedAddress(recipient?.display ?? address) || address,
        ...(Number.isSafeInteger(Number(recipient?.vout)) &&
        Number(recipient.vout) >= 0
          ? { vout: Number(recipient.vout) }
          : {}),
      };
    })
    .filter((recipient) => recipient.address);
}

function exactMailRecipientRows(payload, rawPayload, fallbackAddresses, totalAmountSats) {
  const payloadRows = mailRecipientRowsFromSource(payload);
  const rawRows = mailRecipientRowsFromSource(rawPayload);
  const payloadExactRows = payloadRows.filter((row) => row.vout !== undefined);
  const rawExactRows = rawRows.filter((row) => row.vout !== undefined);
  const rows =
    payloadExactRows.length > 0
      ? payloadExactRows
      : rawExactRows.length > 0
        ? rawExactRows
        : payloadRows.length > 0
          ? payloadRows
          : rawRows;
  const byAddressAndVout = new Map();
  for (const row of rows) {
    const key = `${normalizedAddressKey(row.address)}:${row.vout ?? ""}`;
    if (!byAddressAndVout.has(key)) {
      byAddressAndVout.set(key, row);
    }
  }
  if (byAddressAndVout.size > 0) {
    return [...byAddressAndVout.values()];
  }
  return recipientRows(fallbackAddresses, totalAmountSats);
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

function sameMailPaymentAddress(left, right) {
  const leftAddress = normalizedAddress(left);
  const rightAddress = normalizedAddress(right);
  if (!leftAddress || !rightAddress) {
    return false;
  }
  if (leftAddress === rightAddress) {
    return true;
  }
  const leftLower = leftAddress.toLowerCase();
  const rightLower = rightAddress.toLowerCase();
  return (
    /^(?:bc1|tb1|bcrt1)/u.test(leftLower) &&
    /^(?:bc1|tb1|bcrt1)/u.test(rightLower) &&
    leftLower === rightLower
  );
}

function canonicalMailAttachedCreditsFromRow(row, recipientAddresses) {
  if (String(row?.status ?? "").trim().toLowerCase() !== "confirmed") {
    return [];
  }
  const recipients = (Array.isArray(recipientAddresses)
    ? recipientAddresses
    : [])
    .map((value) => normalizedAddress(value))
    .filter(Boolean);
  if (recipients.length === 0) {
    return [];
  }

  const byProtocolVout = new Map();
  for (const rawCredit of Array.isArray(row?.attached_credit_events)
    ? row.attached_credit_events
    : []) {
    const credit = objectRecord(rawCredit);
    const tokenId = String(credit.tokenId ?? "").trim().toLowerCase();
    const ticker = String(credit.ticker ?? "").trim().toUpperCase();
    const recipientAddress = normalizedAddress(credit.recipientAddress);
    const protocolVout = Number(credit.protocolVout);
    let amountAtoms = "";
    try {
      amountAtoms = normalizeWorkAtoms(credit.amountAtoms);
    } catch {
      continue;
    }
    if (
      tokenId !== WORK_TOKEN_ID ||
      (ticker && ticker !== WORK_TOKEN_TICKER) ||
      amountAtoms !== String(credit.amountAtoms ?? "").trim() ||
      BigInt(amountAtoms) > BigInt(WORK_TOKEN_MAX_SUPPLY_ATOMS) ||
      !recipientAddress ||
      !Number.isSafeInteger(protocolVout) ||
      protocolVout < 0 ||
      !recipients.some((recipient) =>
        sameMailPaymentAddress(recipient, recipientAddress),
      )
    ) {
      continue;
    }

    const normalized = withWorkPrecisionMetadata({
      ...canonicalEventIdentityDetails(credit),
      amount: formatWorkAtoms(amountAtoms),
      amountAtoms,
      amountVersion: credit.amountVersion,
      paidSats: positiveNumber(credit.paidSats),
      protocolVout,
      recipientAddress,
      registryAddress: credit.registryAddress,
      ticker: WORK_TOKEN_TICKER,
      tokenId: WORK_TOKEN_ID,
    });
    const existing = byProtocolVout.get(protocolVout);
    if (existing) {
      if (
        existing.amountAtoms !== normalized.amountAtoms ||
        !sameMailPaymentAddress(
          existing.recipientAddress,
          normalized.recipientAddress,
        )
      ) {
        return [];
      }
      continue;
    }
    byProtocolVout.set(protocolVout, normalized);
  }

  return [...byProtocolVout.values()].sort(
    (left, right) =>
      left.protocolVout - right.protocolVout ||
      left.recipientAddress.localeCompare(right.recipientAddress),
  );
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
  const roleRecipientAddresses = participantRecords
    .filter((participant) =>
      ["recipient", "receiver", "counterparty"].includes(participant.role),
    )
    .map((participant) => participant.address);
  const recipientAddresses = [...new Set(roleRecipientAddresses)];
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
  const recipients = exactMailRecipientRows(
    payload,
    rawPayload,
    recipientAddresses,
    totalAmountSats,
  );
  const attachedCredits = canonicalMailAttachedCreditsFromRow(
    row,
    recipientAddresses,
  );
  const targetAttachedCredits = attachedCredits.filter((credit) =>
    sameMailPaymentAddress(credit.recipientAddress, targetAddress),
  );
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
        attachedCredits:
          attachedCredits.length > 0 ? attachedCredits : undefined,
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
    targetIsRecipient
  ) {
    const targetRecipient =
      recipients.find(
        (recipient) => normalizedAddressKey(recipient.address) === targetKey,
      ) ?? recipients[0];
    const targetRecipientAmountSats = recipients
      .filter(
        (recipient) => normalizedAddressKey(recipient.address) === targetKey,
      )
      .reduce(
        (total, recipient) => total + positiveNumber(recipient.amountSats),
        0,
      );
    items.push({
      folder: "inbox",
      message: {
        amountSats:
          targetRecipientAmountSats ||
          positiveNumber(targetRecipient?.amountSats) ||
          (recipients.length === 1 ? totalAmountSats : 0),
        attachedCredits:
          targetAttachedCredits.length > 0
            ? targetAttachedCredits
            : undefined,
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
  const protocol = bondTagForKind(message?.protocolKind) ? 2 : 0;
  const content = [
    ...(Array.isArray(message?.attachedCredits)
      ? message.attachedCredits
      : []),
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
  const currentConfirmed =
    current?.confirmed === true || current?.status === "confirmed";
  const incomingConfirmed =
    incoming?.confirmed === true || incoming?.status === "confirmed";
  const attachedCredits =
    currentConfirmed && incomingConfirmed
      ? current.attachedCredits
      : currentConfirmed !== incomingConfirmed
        ? (currentConfirmed
            ? current.attachedCredits
            : incoming.attachedCredits)
        : primary.attachedCredits ?? secondary.attachedCredits;
  return {
    ...secondary,
    ...primary,
    attachedCredits,
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
      ),
      candidate_mail_events AS (
        SELECT e.event_id, e.network, e.txid
        FROM proof_indexer.events e
        JOIN candidate_events candidate
          ON candidate.event_id = e.event_id
        WHERE e.network = $1
          AND e.valid = true
          AND e.kind = ANY($3::text[])
          AND e.status IN ('pending', 'confirmed', 'dropped', 'orphaned')
        ORDER BY
          COALESCE(e.event_time, e.block_time, e.created_at) DESC,
          e.txid DESC,
          e.event_id DESC
        LIMIT 1000
      ),
      candidate_mail_transactions AS (
        SELECT DISTINCT network, txid
        FROM candidate_mail_events
      ),
      canonical_work_attachments AS (
        SELECT
          transfer_event.network,
          transfer_event.txid,
          jsonb_agg(
            transfer_event.payload || jsonb_build_object(
              'eventId', transfer_event.event_id
            )
            ORDER BY
              CASE
                WHEN COALESCE(transfer_event.payload->>'protocolVout', '') ~ '^[0-9]+$'
                  THEN (transfer_event.payload->>'protocolVout')::numeric
                ELSE 999999999
              END,
              transfer_event.event_id
          ) AS attached_credit_events
        FROM proof_indexer.events transfer_event
        JOIN candidate_mail_transactions candidate_mail
          ON candidate_mail.network = transfer_event.network
         AND candidate_mail.txid = transfer_event.txid
        JOIN proof_indexer.transactions transfer_transaction
          ON transfer_transaction.network = transfer_event.network
         AND transfer_transaction.txid = transfer_event.txid
         AND transfer_transaction.status = 'confirmed'
         AND transfer_event.block_height = transfer_transaction.block_height
        JOIN proof_indexer.blocks transfer_block
          ON transfer_block.network = transfer_transaction.network
         AND transfer_block.block_hash = transfer_transaction.block_hash
         AND transfer_block.height = transfer_transaction.block_height
         AND transfer_block.canonical = true
        WHERE transfer_event.network = $1
          AND transfer_event.kind = 'token-transfer'
          AND transfer_event.status = 'confirmed'
          AND transfer_event.valid = true
          AND lower(COALESCE(transfer_event.payload->>'tokenId', '')) = $4
          AND lower(COALESCE(transfer_event.payload->>'blockHash', '')) =
            transfer_transaction.block_hash
        GROUP BY transfer_event.network, transfer_event.txid
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
          canonical_work_attachments.attached_credit_events,
          '[]'::jsonb
        ) AS attached_credit_events,
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
      LEFT JOIN canonical_work_attachments
        ON canonical_work_attachments.network = e.network
       AND canonical_work_attachments.txid = e.txid
      JOIN candidate_mail_events ce
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
        m.amount_sats,
        canonical_work_attachments.attached_credit_events
      ORDER BY
        COALESCE(e.event_time, e.block_time, e.created_at) DESC,
        e.txid DESC,
        e.event_id DESC
      LIMIT 1000
    `,
    [network, addressCandidates, ADDRESS_MAIL_EVENT_KINDS, WORK_TOKEN_ID],
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
        '[]'::jsonb AS attached_credit_events,
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
          e.event_id,
          t.fee_sats AS transaction_fee_sats,
          CASE
            WHEN e.kind = 'token-event-invalid' THEN t.raw_tx
            ELSE NULL
          END AS transaction_raw_tx
        FROM proof_indexer.events e
        LEFT JOIN proof_indexer.transactions t
          ON t.network = e.network
         AND t.txid = e.txid
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
        e.event_id,
        t.fee_sats AS transaction_fee_sats,
        CASE
          WHEN e.kind = 'token-event-invalid' THEN t.raw_tx
          ELSE NULL
        END AS transaction_raw_tx
      FROM proof_indexer.events e
      LEFT JOIN proof_indexer.transactions t
        ON t.network = e.network
       AND t.txid = e.txid
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

function canonicalSnapshotQ8Text(value, { positive = false } = {}) {
  if (typeof value !== "string" && typeof value !== "bigint") {
    return "";
  }
  return canonicalIntegerText(value, { allowZero: !positive });
}

function canonicalSummaryLedgerRowBinding(
  snapshot,
  requestedHeight = 0,
  requestedHash = "",
) {
  if (
    !snapshot ||
    snapshot.consistency?.ok !== true ||
    snapshot.consistency?.status !== "green" ||
    String(snapshot.payload_snapshot_id ?? "") !==
      String(snapshot.snapshot_id ?? "")
  ) {
    return null;
  }

  const indexedThroughBlock = safeBlockHeight(snapshot.indexed_through_block);
  const summarySnapshotIds = [
    snapshot.growth_snapshot_id,
    snapshot.inception_snapshot_id,
    snapshot.infinity_snapshot_id,
    snapshot.log_snapshot_id,
    snapshot.marketplace_snapshot_id,
    snapshot.token_snapshot_id,
    snapshot.work_floor_snapshot_id,
    snapshot.work_summary_snapshot_id,
  ].map((value) => String(value ?? ""));
  const summaryCoverageHeights = [
    snapshot.growth_height,
    snapshot.growth_floor_height,
    snapshot.inception_height,
    snapshot.infinity_height,
    snapshot.log_height,
    snapshot.marketplace_height,
    snapshot.marketplace_floor_height,
    snapshot.token_height,
    snapshot.work_floor_height,
    snapshot.work_summary_height,
    snapshot.work_summary_floor_height,
  ].map(safeBlockHeight);
  if (
    !indexedThroughBlock ||
    (requestedHeight > 0 && indexedThroughBlock !== requestedHeight) ||
    summarySnapshotIds.some(
      (value) => value !== String(snapshot.snapshot_id ?? ""),
    ) ||
    summaryCoverageHeights.some((height) => height !== indexedThroughBlock)
  ) {
    return null;
  }

  const indexedThroughBlockHash = String(
    snapshot.source_hashes?.blockScan ?? "",
  )
    .trim()
    .toLowerCase();
  const boundCheckpointHashes = [
    indexedThroughBlockHash,
    snapshot.payload_indexed_through_block_hash,
    snapshot.summary_refresh_block_hash,
    snapshot.work_floor_block_hash,
  ].map((value) => String(value ?? "").trim().toLowerCase());
  const canonicalSummaryHash = String(
    snapshot.source_hashes?.canonicalSummary ?? "",
  )
    .trim()
    .toLowerCase();
  if (
    snapshot.summary_refresh_mode !== "canonical-summary-refresh" ||
    !/^[0-9a-f]{64}$/u.test(indexedThroughBlockHash) ||
    !/^[0-9a-f]{64}$/u.test(canonicalSummaryHash) ||
    boundCheckpointHashes.some((hash) => hash !== indexedThroughBlockHash) ||
    (requestedHash && indexedThroughBlockHash !== requestedHash)
  ) {
    return null;
  }

  const workFloor =
    snapshot.work_floor &&
    typeof snapshot.work_floor === "object" &&
    !Array.isArray(snapshot.work_floor)
      ? snapshot.work_floor
      : null;
  const actualValue =
    workFloor?.actualValue &&
    typeof workFloor.actualValue === "object" &&
    !Array.isArray(workFloor.actualValue)
      ? workFloor.actualValue
      : {};
  const q8Aliases = [
    snapshot.totals_work_network_value_q8,
    snapshot.totals_work_actual_value_q8,
    snapshot.totals_growth_actual_value_q8,
    snapshot.totals_growth_work_floor_value_q8,
    snapshot.work_floor_network_value_q8,
    snapshot.work_floor_live_network_value_q8,
    snapshot.work_actual_network_value_q8,
    snapshot.work_actual_live_network_value_q8,
    snapshot.work_actual_total_q8,
    snapshot.work_actual_live_total_q8,
  ].map((value) => canonicalSnapshotQ8Text(value, { positive: true }));
  const workNetworkValueQ8 = q8Aliases[0] ?? "";
  if (
    !workFloor ||
    !workNetworkValueQ8 ||
    q8Aliases.some(
      (value) => !value || value !== workNetworkValueQ8,
    ) ||
    snapshot.totals_work_network_value_model !==
      WORK_NETWORK_VALUE_ACCOUNTING_MODEL ||
    snapshot.work_floor_network_value_model !==
      WORK_NETWORK_VALUE_ACCOUNTING_MODEL ||
    snapshot.work_actual_network_value_model !==
      WORK_NETWORK_VALUE_ACCOUNTING_MODEL ||
    workFloor.workNetworkValueAccountingModel !==
      WORK_NETWORK_VALUE_ACCOUNTING_MODEL ||
    actualValue.workNetworkValueAccountingModel !==
      WORK_NETWORK_VALUE_ACCOUNTING_MODEL
  ) {
    return null;
  }
  const workNetworkValueSats = decimalTextFromQ8(workNetworkValueQ8);
  const frozenNetworkValueQ8Aliases = [
    snapshot.work_floor_frozen_network_value_q8,
    snapshot.work_actual_frozen_network_value_q8,
    snapshot.work_actual_frozen_total_q8,
  ]
    .filter((value) => value !== undefined && value !== null && value !== "")
    .map((value) => canonicalSnapshotQ8Text(value, { positive: true }));
  const frozenNetworkValueQ8 = frozenNetworkValueQ8Aliases[0] ?? "";
  if (
    frozenNetworkValueQ8Aliases.some(
      (value) => !value || value !== frozenNetworkValueQ8,
    )
  ) {
    return null;
  }
  const frozenNetworkValueSats = frozenNetworkValueQ8
    ? decimalTextFromQ8(frozenNetworkValueQ8)
    : null;

  return {
    actualTotalSats: workNetworkValueSats,
    canonicalSummaryHash,
    creditMinerFeeAccountingModel: String(
      actualValue.creditMinerFeeAccountingModel ?? "",
    ),
    declaredNetworkValueSats: workNetworkValueSats,
    frozenNetworkValueQ8: frozenNetworkValueQ8 || null,
    frozenNetworkValueSats,
    growthActualValueQ8: workNetworkValueQ8,
    growthActualValueSats: workNetworkValueSats,
    growthWorkFloorValueQ8: workNetworkValueQ8,
    growthWorkFloorValueSats: workNetworkValueSats,
    indexedThroughBlock,
    indexedThroughBlockHash,
    liveNetworkValueSats: workNetworkValueSats,
    workActualValueQ8: workNetworkValueQ8,
    workActualValueSats: workNetworkValueSats,
    workFloor,
    workNetworkValueAccountingModel: WORK_NETWORK_VALUE_ACCOUNTING_MODEL,
    workNetworkValueQ8,
    workNetworkValueSats,
  };
}

function canonicalSummaryLedgerValueBindingsAgree(left, right) {
  const exactKeys = [
    "frozenNetworkValueQ8",
    "growthActualValueQ8",
    "growthWorkFloorValueQ8",
    "workActualValueQ8",
    "workNetworkValueQ8",
  ];
  return Boolean(
    left &&
      right &&
      left.indexedThroughBlockHash === right.indexedThroughBlockHash &&
      left.creditMinerFeeAccountingModel ===
        right.creditMinerFeeAccountingModel &&
      left.workNetworkValueAccountingModel ===
        right.workNetworkValueAccountingModel &&
      left.indexedThroughBlock === right.indexedThroughBlock &&
      exactKeys.every((key) => left[key] === right[key]),
  );
}

export async function proofIndexCanonicalSummaryLedgerPayload(
  network,
  requiredIndexedThroughBlock = 0,
  requiredIndexedThroughBlockHash = "",
) {
  const pool = proofIndexPool();
  if (!pool) {
    return null;
  }

  const requestedHeight = safeBlockHeight(requiredIndexedThroughBlock);
  const requestedHash = String(requiredIndexedThroughBlockHash ?? "")
    .trim()
    .toLowerCase();
  const exactCheckpointRequested =
    requiredIndexedThroughBlock !== 0 || requestedHash.length > 0;
  if (
    exactCheckpointRequested &&
    (!requestedHeight || !/^[0-9a-f]{64}$/u.test(requestedHash))
  ) {
    return null;
  }

  const checkpointProjection = exactCheckpointRequested
    ? "count(*) OVER ()"
    : "1::bigint";
  const checkpointFilter = exactCheckpointRequested
    ? `
        AND indexed_through_block = $2
        AND lower(COALESCE(source_hashes->>'blockScan', '')) = $3
        AND lower(COALESCE(payload->>'indexedThroughBlockHash', '')) = $3
        AND lower(COALESCE(payload->'summaryRefresh'->>'indexedThroughBlockHash', '')) = $3
        AND lower(COALESCE(payload->'summaryPayloads'->'workFloor'->>'indexedThroughBlockHash', '')) = $3
      `
    : "";
  const workAmountStorageFilter = exactCheckpointRequested
    ? ""
    : "AND payload->>'workAmountStorageModel' = $2";
  // Exact H-1 reads must prove agreement across the complete eligible row
  // set. A numeric cap could hide a disagreeing older row behind the limit.
  const checkpointLimit = exactCheckpointRequested ? "" : "LIMIT 1";
  const checkpointParams = exactCheckpointRequested
    ? [network, requestedHeight, requestedHash]
    : [network, WORK_ATOMIC_PROJECTION_MODEL];

  const result = await pool.query(
    `
      SELECT
        ${checkpointProjection} AS matching_snapshot_count,
        snapshot_id,
        generated_at,
        indexed_through_block,
        source_hashes,
        metrics,
        consistency,
        payload->>'indexedThroughBlockHash' AS payload_indexed_through_block_hash,
        payload->'summaryRefresh'->>'mode' AS summary_refresh_mode,
        payload->'summaryRefresh'->>'indexedThroughBlockHash' AS summary_refresh_block_hash,
        payload->>'snapshotId' AS payload_snapshot_id,
        payload->'summaryPayloads'->'growthSummary'->>'snapshotId' AS growth_snapshot_id,
        payload->'summaryPayloads'->'inceptionSummary'->>'snapshotId' AS inception_snapshot_id,
        payload->'summaryPayloads'->'infinitySummary'->>'snapshotId' AS infinity_snapshot_id,
        payload->'summaryPayloads'->'logSummary'->>'snapshotId' AS log_snapshot_id,
        payload->'summaryPayloads'->'marketplaceSummary'->>'snapshotId' AS marketplace_snapshot_id,
        payload->'summaryPayloads'->'tokenSummary'->>'snapshotId' AS token_snapshot_id,
        payload->'summaryPayloads'->'workFloor'->>'snapshotId' AS work_floor_snapshot_id,
        payload->'summaryPayloads'->'workSummary'->>'snapshotId' AS work_summary_snapshot_id,
        payload->'summaryPayloads'->'growthSummary'->>'indexedThroughBlock' AS growth_height,
        payload->'summaryPayloads'->'growthSummary'->'workFloor'->>'indexedThroughBlock' AS growth_floor_height,
        payload->'summaryPayloads'->'inceptionSummary'->>'indexedThroughBlock' AS inception_height,
        payload->'summaryPayloads'->'infinitySummary'->>'indexedThroughBlock' AS infinity_height,
        payload->'summaryPayloads'->'logSummary'->>'indexedThroughBlock' AS log_height,
        payload->'summaryPayloads'->'marketplaceSummary'->>'indexedThroughBlock' AS marketplace_height,
        payload->'summaryPayloads'->'marketplaceSummary'->'workFloor'->>'indexedThroughBlock' AS marketplace_floor_height,
        payload->'summaryPayloads'->'tokenSummary'->>'indexedThroughBlock' AS token_height,
        payload->'summaryPayloads'->'workFloor'->>'indexedThroughBlock' AS work_floor_height,
        payload->'summaryPayloads'->'workFloor'->>'indexedThroughBlockHash' AS work_floor_block_hash,
        payload->'summaryPayloads'->'workFloor' AS work_floor,
        payload->'totals'->>'workNetworkValueAccountingModel' AS totals_work_network_value_model,
        payload->'totals'->>'workNetworkValueQ8' AS totals_work_network_value_q8,
        payload->'totals'->>'workActualValueQ8' AS totals_work_actual_value_q8,
        payload->'totals'->>'growthActualValueQ8' AS totals_growth_actual_value_q8,
        payload->'totals'->>'growthWorkFloorValueQ8' AS totals_growth_work_floor_value_q8,
        payload->'summaryPayloads'->'workFloor'->>'workNetworkValueAccountingModel' AS work_floor_network_value_model,
        payload->'summaryPayloads'->'workFloor'->>'networkValueQ8' AS work_floor_network_value_q8,
        payload->'summaryPayloads'->'workFloor'->>'liveNetworkValueQ8' AS work_floor_live_network_value_q8,
        payload->'summaryPayloads'->'workFloor'->>'frozenNetworkValueQ8' AS work_floor_frozen_network_value_q8,
        payload->'summaryPayloads'->'workFloor'->'actualValue'->>'workNetworkValueAccountingModel' AS work_actual_network_value_model,
        payload->'summaryPayloads'->'workFloor'->'actualValue'->>'networkValueQ8' AS work_actual_network_value_q8,
        payload->'summaryPayloads'->'workFloor'->'actualValue'->>'liveNetworkValueQ8' AS work_actual_live_network_value_q8,
        payload->'summaryPayloads'->'workFloor'->'actualValue'->>'frozenNetworkValueQ8' AS work_actual_frozen_network_value_q8,
        payload->'summaryPayloads'->'workFloor'->'actualValue'->>'totalQ8' AS work_actual_total_q8,
        payload->'summaryPayloads'->'workFloor'->'actualValue'->>'liveTotalQ8' AS work_actual_live_total_q8,
        payload->'summaryPayloads'->'workFloor'->'actualValue'->>'frozenTotalQ8' AS work_actual_frozen_total_q8,
        payload->'summaryPayloads'->'workSummary'->>'indexedThroughBlock' AS work_summary_height,
        payload->'summaryPayloads'->'workSummary'->'floor'->>'indexedThroughBlock' AS work_summary_floor_height,
        payload->'totals' AS totals
      FROM proof_indexer.ledger_snapshots
      WHERE network = $1
        AND COALESCE(consistency->>'ok', payload->>'ok', 'false') = 'true'
        AND COALESCE(consistency->>'status', payload->>'status', '') = 'green'
        AND payload->'summaryRefresh'->>'mode' = 'canonical-summary-refresh'
        AND payload->'totals'->>'workNetworkValueAccountingModel' = 'canonical-exact-work-network-q8-v1'
        AND payload->'summaryPayloads'->'workFloor'->>'workNetworkValueAccountingModel' = 'canonical-exact-work-network-q8-v1'
        AND payload->'summaryPayloads'->'workFloor'->'actualValue'->>'workNetworkValueAccountingModel' = 'canonical-exact-work-network-q8-v1'
        AND payload->'totals'->>'workNetworkValueQ8' ~ '^[1-9][0-9]*$'
        AND payload->'summaryPayloads'->'workFloor'->>'networkValueQ8' = payload->'totals'->>'workNetworkValueQ8'
        AND payload->'summaryPayloads'->'workFloor'->>'liveNetworkValueQ8' = payload->'totals'->>'workNetworkValueQ8'
        AND payload->'summaryPayloads'->'workFloor'->'actualValue'->>'networkValueQ8' = payload->'totals'->>'workNetworkValueQ8'
        AND payload->'summaryPayloads'->'workFloor'->'actualValue'->>'liveNetworkValueQ8' = payload->'totals'->>'workNetworkValueQ8'
        AND payload->'summaryPayloads'->'workFloor'->'actualValue'->>'totalQ8' = payload->'totals'->>'workNetworkValueQ8'
        AND payload->'summaryPayloads'->'workFloor'->'actualValue'->>'liveTotalQ8' = payload->'totals'->>'workNetworkValueQ8'
        AND source_hashes ? 'canonicalSummary'
        AND payload ? 'summaryPayloads'
        ${workAmountStorageFilter}
        ${checkpointFilter}
        AND jsonb_typeof(payload->'summaryPayloads'->'growthSummary') = 'object'
        AND jsonb_typeof(payload->'summaryPayloads'->'inceptionSummary') = 'object'
        AND jsonb_typeof(payload->'summaryPayloads'->'infinitySummary') = 'object'
        AND jsonb_typeof(payload->'summaryPayloads'->'logSummary') = 'object'
        AND jsonb_typeof(payload->'summaryPayloads'->'marketplaceSummary') = 'object'
        AND jsonb_typeof(payload->'summaryPayloads'->'tokenSummary') = 'object'
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
      ORDER BY
        indexed_through_block DESC NULLS LAST,
        generated_at DESC,
        snapshot_id DESC
      ${checkpointLimit}
    `,
    checkpointParams,
  );
  const snapshot = result.rows[0];
  const matchingSnapshotCount = Number(
    snapshot?.matching_snapshot_count ?? result.rows.length,
  );
  if (
    !snapshot ||
    (exactCheckpointRequested &&
      (!Number.isSafeInteger(matchingSnapshotCount) ||
        matchingSnapshotCount !== result.rows.length))
  ) {
    return null;
  }

  const bindings = result.rows.map((row) =>
    canonicalSummaryLedgerRowBinding(
      row,
      exactCheckpointRequested ? requestedHeight : 0,
      exactCheckpointRequested ? requestedHash : "",
    ),
  );
  const binding = bindings[0];
  if (
    !binding ||
    (exactCheckpointRequested &&
      bindings.some(
        (candidate) =>
          !canonicalSummaryLedgerValueBindingsAgree(binding, candidate),
      ))
  ) {
    return null;
  }

  return {
    canonicalSummaryHash: binding.canonicalSummaryHash,
    consistency: snapshot.consistency,
    generatedAt: dateIso(snapshot.generated_at),
    growthSummary: {
      actualValue: {
        totalQ8: binding.growthActualValueQ8,
        totalSats: binding.growthActualValueSats,
        workNetworkValueAccountingModel:
          binding.workNetworkValueAccountingModel,
      },
      workFloor: {
        actualValue: {
          totalQ8: binding.growthWorkFloorValueQ8,
          totalSats: binding.growthWorkFloorValueSats,
          workNetworkValueAccountingModel:
            binding.workNetworkValueAccountingModel,
        },
        networkValueQ8: binding.growthWorkFloorValueQ8,
        networkValueSats: binding.growthWorkFloorValueSats,
        workNetworkValueAccountingModel:
          binding.workNetworkValueAccountingModel,
      },
    },
    indexedThroughBlock: binding.indexedThroughBlock,
    indexedThroughBlockHash: binding.indexedThroughBlockHash,
    metrics: snapshot.metrics ?? {},
    network,
    snapshotId: snapshot.snapshot_id,
    source: "proof-indexer-canonical-summary-ledger",
    sourceHashes: snapshot.source_hashes ?? {},
    valuationModel: "canonical-summary-refresh",
    workFloor: binding.workFloor,
    workNetworkValueAccountingModel:
      binding.workNetworkValueAccountingModel,
    workNetworkValueSats: binding.liveNetworkValueSats,
    workNetworkValueQ8: binding.workNetworkValueQ8,
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
        AND payload->>'workAmountStorageModel' = $3
        AND COALESCE(consistency->>'ok', payload->>'ok', 'false') = 'true'
        AND COALESCE(consistency->>'status', payload->>'status', '') <> 'summary-snapshot-fallback'
        AND payload->'summaryRefresh'->>'mode' = 'canonical-summary-refresh'
        AND payload->'totals'->>'workNetworkValueAccountingModel' = 'canonical-exact-work-network-q8-v1'
        AND payload->'summaryPayloads'->'workFloor'->>'workNetworkValueAccountingModel' = 'canonical-exact-work-network-q8-v1'
        AND payload->'summaryPayloads'->'workFloor'->'actualValue'->>'workNetworkValueAccountingModel' = 'canonical-exact-work-network-q8-v1'
        AND payload->'totals'->>'workNetworkValueQ8' ~ '^[1-9][0-9]*$'
        AND payload->'summaryPayloads'->'workFloor'->>'networkValueQ8' = payload->'totals'->>'workNetworkValueQ8'
        AND payload->'summaryPayloads'->'workFloor'->>'liveNetworkValueQ8' = payload->'totals'->>'workNetworkValueQ8'
        AND payload->'summaryPayloads'->'workFloor'->'actualValue'->>'networkValueQ8' = payload->'totals'->>'workNetworkValueQ8'
        AND payload->'summaryPayloads'->'workFloor'->'actualValue'->>'liveNetworkValueQ8' = payload->'totals'->>'workNetworkValueQ8'
        AND payload->'summaryPayloads'->'workFloor'->'actualValue'->>'totalQ8' = payload->'totals'->>'workNetworkValueQ8'
        AND payload->'summaryPayloads'->'workFloor'->'actualValue'->>'liveTotalQ8' = payload->'totals'->>'workNetworkValueQ8'
        AND source_hashes ? 'canonicalSummary'
        AND jsonb_typeof(payload->'summaryPayloads'->'growthSummary') = 'object'
        AND jsonb_typeof(payload->'summaryPayloads'->'inceptionSummary') = 'object'
        AND jsonb_typeof(payload->'summaryPayloads'->'infinitySummary') = 'object'
        AND jsonb_typeof(payload->'summaryPayloads'->'logSummary') = 'object'
        AND jsonb_typeof(payload->'summaryPayloads'->'marketplaceSummary') = 'object'
        AND jsonb_typeof(payload->'summaryPayloads'->'tokenSummary') = 'object'
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
    [network, key, WORK_ATOMIC_PROJECTION_MODEL],
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
            AND payload->>'workAmountStorageModel' = $3
            AND COALESCE(consistency->>'ok', payload->>'ok', 'false') = 'true'
            AND COALESCE(consistency->>'status', payload->>'status', '') <> 'summary-snapshot-fallback'
            AND payload->'summaryRefresh'->>'mode' = 'canonical-summary-refresh'
            AND payload->'totals'->>'workNetworkValueAccountingModel' = 'canonical-exact-work-network-q8-v1'
            AND payload->'summaryPayloads'->'workFloor'->>'workNetworkValueAccountingModel' = 'canonical-exact-work-network-q8-v1'
            AND payload->'summaryPayloads'->'workFloor'->'actualValue'->>'workNetworkValueAccountingModel' = 'canonical-exact-work-network-q8-v1'
            AND payload->'totals'->>'workNetworkValueQ8' ~ '^[1-9][0-9]*$'
            AND payload->'summaryPayloads'->'workFloor'->>'networkValueQ8' = payload->'totals'->>'workNetworkValueQ8'
            AND payload->'summaryPayloads'->'workFloor'->>'liveNetworkValueQ8' = payload->'totals'->>'workNetworkValueQ8'
            AND payload->'summaryPayloads'->'workFloor'->'actualValue'->>'networkValueQ8' = payload->'totals'->>'workNetworkValueQ8'
            AND payload->'summaryPayloads'->'workFloor'->'actualValue'->>'liveNetworkValueQ8' = payload->'totals'->>'workNetworkValueQ8'
            AND payload->'summaryPayloads'->'workFloor'->'actualValue'->>'totalQ8' = payload->'totals'->>'workNetworkValueQ8'
            AND payload->'summaryPayloads'->'workFloor'->'actualValue'->>'liveTotalQ8' = payload->'totals'->>'workNetworkValueQ8'
            AND source_hashes ? 'canonicalSummary'
            AND jsonb_typeof(payload->'summaryPayloads'->'growthSummary') = 'object'
            AND jsonb_typeof(payload->'summaryPayloads'->'inceptionSummary') = 'object'
            AND jsonb_typeof(payload->'summaryPayloads'->'infinitySummary') = 'object'
            AND jsonb_typeof(payload->'summaryPayloads'->'logSummary') = 'object'
            AND jsonb_typeof(payload->'summaryPayloads'->'marketplaceSummary') = 'object'
            AND jsonb_typeof(payload->'summaryPayloads'->'tokenSummary') = 'object'
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
      [network, key, WORK_ATOMIC_PROJECTION_MODEL],
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
    ...(payload.activity &&
    typeof payload.activity === "object" &&
    !Array.isArray(payload.activity)
      ? {
          activity: {
            ...payload.activity,
            ...(consistency ? { consistency } : {}),
          },
        }
      : {}),
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
    ...(payload.token &&
    typeof payload.token === "object" &&
    !Array.isArray(payload.token)
      ? {
          token: {
            ...payload.token,
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
          AND NOT (source_hashes ? 'canonicalSummary')
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

function proofIndexConfirmedValueEventDeltaFromRows(rows, network) {
  const sourceRows = Array.isArray(rows) ? rows : [];
  const marketplaceFamily = (kind) => {
    const normalizedKind = normalizedText(kind);
    if (["id-list", "id-seal", "id-delist", "id-buy"].includes(normalizedKind)) {
      return "id-list";
    }
    if (
      [
        "token-listing",
        "token-listing-sealed",
        "token-listing-closed",
      ].includes(normalizedKind)
    ) {
      return "token-listing";
    }
    return "";
  };
  const registryCandidatesByPayment = new Map();
  for (const row of sourceRows) {
    if (row?.marketplace_payment !== true) {
      continue;
    }
    const family = marketplaceFamily(row.kind);
    const txid = normalizedText(row.txid).toLowerCase();
    const registryAddress = normalizedText(row.registry_address);
    if (!family || !txid || !registryAddress) {
      continue;
    }
    const paymentKey = `${family}:${txid}`;
    const candidates =
      registryCandidatesByPayment.get(paymentKey) ?? new Map();
    candidates.set(registryAddress, registryAddress);
    registryCandidatesByPayment.set(paymentKey, candidates);
  }

  const normalizedRows = [];
  const marketplaceRowByPayment = new Map();
  for (const row of sourceRows) {
    if (row?.marketplace_payment !== true) {
      normalizedRows.push(row);
      continue;
    }
    const family = marketplaceFamily(row.kind);
    const txid = normalizedText(row.txid).toLowerCase();
    const paymentKey = `${family}:${txid}`;
    const registryCandidates =
      registryCandidatesByPayment.get(paymentKey) ?? new Map();
    const explicitRegistryAddress = normalizedText(row.registry_address);
    const registryAddress =
      explicitRegistryAddress ||
      (registryCandidates.size === 1
        ? [...registryCandidates.values()][0]
        : "");
    const identity = `${paymentKey}:${registryAddress}`;
    const current = marketplaceRowByPayment.get(identity);
    if (!current) {
      const normalizedRow = {
        ...row,
        event_count: rowNumber(row, "event_count"),
        expected_min_sats: rowNumber(row, "expected_min_sats"),
        kind: family || normalizedText(row.kind),
        registry_address: registryAddress,
        total_sats: rowNumber(row, "total_sats"),
      };
      marketplaceRowByPayment.set(identity, normalizedRow);
      normalizedRows.push(normalizedRow);
      continue;
    }

    current.event_count += rowNumber(row, "event_count");
    current.expected_min_sats = Math.max(
      rowNumber(current, "expected_min_sats"),
      rowNumber(row, "expected_min_sats"),
    );
    current.indexed_through_block = Math.max(
      rowNumber(current, "indexed_through_block"),
      rowNumber(row, "indexed_through_block"),
    );
    current.max_event_block = Math.max(
      rowNumber(current, "max_event_block"),
      rowNumber(row, "max_event_block"),
    );
    current.payment_verified =
      current.payment_verified === true || row?.payment_verified === true;
    current.total_sats = Math.max(
      rowNumber(current, "total_sats"),
      rowNumber(row, "total_sats"),
    );
    if (
      Date.parse(row?.max_event_time ?? "") >
      Date.parse(current.max_event_time ?? "")
    ) {
      current.max_event_time = row.max_event_time;
    }
  }

  const marketplaceRows = normalizedRows.filter(
    (row) => row?.marketplace_payment === true,
  );
  if (
    marketplaceRows.some(
      (row) =>
        row?.payment_verified !== true ||
        !marketplaceFamily(row?.kind) ||
        !validTxid(row?.txid) ||
        !normalizedText(row?.registry_address) ||
        rowNumber(row, "total_sats") <
          rowNumber(row, "expected_min_sats"),
    )
  ) {
    return null;
  }

  const events = normalizedRows
    .filter((row) => row.kind)
    .map((row) => ({
      count: Number(row.event_count ?? 0),
      indexedAt: dateIso(row.max_event_time ?? row.generated_at),
      indexedThroughBlock: Number(row.indexed_through_block) || 0,
      kind: String(row.kind ?? ""),
      ...(row?.marketplace_payment === true
        ? {
            marketplaceMutationFeeSats: Number(row.total_sats ?? 0),
            marketplacePaymentVerified: true,
            registryAddress: normalizedText(row.registry_address),
            txid: normalizedTxid(row.txid),
          }
        : {}),
      maxEventBlock: Number(row.max_event_block) || 0,
      totalSats: Number(row.total_sats ?? 0),
    }));
  const latestScanBlock = Math.max(
    0,
    ...normalizedRows.map((row) => Number(row.indexed_through_block) || 0),
  );
  return {
    events,
    indexedAt: dateIso(
      normalizedRows[0]?.generated_at ?? normalizedRows[0]?.max_event_time,
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

export async function proofIndexConfirmedValueEventsAfterBlock(
  network,
  blockHeight,
) {
  const pool = proofIndexPool();
  if (!pool) {
    return null;
  }

  const minBlock = Number(blockHeight) || 0;
  const idRegistryAddress = ID_REGISTRY_ADDRESSES[network] ?? "";
  const result = await pool.query(
    `
      WITH latest_scan AS (
        SELECT indexed_through_block, generated_at
        FROM proof_indexer.ledger_snapshots
        WHERE network = $1
          AND NOT (source_hashes ? 'canonicalSummary')
          AND (
            source_hashes ? 'blockScan'
            OR
            payload->>'source' = 'proof-indexer-block-scan'
            OR consistency->>'status' LIKE 'block-scan%'
          )
        ORDER BY indexed_through_block DESC NULLS LAST, generated_at DESC
        LIMIT 1
      ),
      filtered_events AS (
        SELECT
          e.kind,
          e.txid,
          e.amount_sats,
          e.block_height,
          e.event_time,
          CASE
            WHEN e.kind IN ('id-list','id-seal','id-delist','id-buy')
              THEN $3::text
            WHEN e.kind IN (
              'token-listing',
              'token-listing-sealed',
              'token-listing-closed'
            )
              THEN COALESCE(
                NULLIF(e.payload->>'registryAddress', ''),
                cd.registry_address,
                ''
              )
            ELSE ''
          END AS registry_address
        FROM proof_indexer.events e
        LEFT JOIN proof_indexer.credit_definitions cd
          ON cd.network = e.network
         AND lower(cd.token_id) = lower(e.payload->>'tokenId')
        WHERE e.network = $1
          AND e.status = 'confirmed'
          AND e.valid IS DISTINCT FROM false
          AND e.block_height > $2
      ),
      grouped_value_events AS (
        SELECT
          kind,
          NULL::text AS txid,
          NULL::text AS registry_address,
          COALESCE(sum(amount_sats), 0)::text AS total_sats,
          0::bigint AS expected_min_sats,
          count(*)::int AS event_count,
          max(block_height)::int AS max_event_block,
          max(event_time) AS max_event_time,
          false AS marketplace_payment,
          true AS payment_verified
        FROM filtered_events
        WHERE kind NOT IN (
          'id-list',
          'id-seal',
          'id-delist',
          'id-buy',
          'token-listing',
          'token-listing-sealed',
          'token-listing-closed'
        )
        GROUP BY kind
      ),
      marketplace_payment_keys AS (
        SELECT
          CASE
            WHEN kind IN ('id-list','id-seal','id-delist','id-buy')
              THEN 'id-list'
            ELSE 'token-listing'
          END AS kind,
          txid,
          registry_address,
          max(amount_sats)::bigint AS expected_min_sats,
          count(*)::int AS event_count,
          max(block_height)::int AS max_event_block,
          max(event_time) AS max_event_time
        FROM filtered_events
        WHERE kind IN (
          'id-list',
          'id-seal',
          'id-delist',
          'id-buy',
          'token-listing',
          'token-listing-sealed',
          'token-listing-closed'
        )
        GROUP BY
          CASE
            WHEN kind IN ('id-list','id-seal','id-delist','id-buy')
              THEN 'id-list'
            ELSE 'token-listing'
          END,
          txid,
          registry_address
      ),
      marketplace_value_events AS (
        SELECT
          payment.kind,
          payment.txid,
          payment.registry_address,
          COALESCE(sum(output.value_sats), 0)::text AS total_sats,
          payment.expected_min_sats,
          payment.event_count,
          payment.max_event_block,
          payment.max_event_time,
          true AS marketplace_payment,
          (
            payment.registry_address <> ''
            AND COALESCE(sum(output.value_sats), 0) >=
              payment.expected_min_sats
          ) AS payment_verified
        FROM marketplace_payment_keys payment
        LEFT JOIN proof_indexer.tx_outputs output
          ON output.network = $1
         AND output.txid = payment.txid
         AND lower(COALESCE(output.address, '')) =
           lower(payment.registry_address)
        GROUP BY
          payment.kind,
          payment.txid,
          payment.registry_address,
          payment.expected_min_sats,
          payment.event_count,
          payment.max_event_block,
          payment.max_event_time
      ),
      value_events AS (
        SELECT * FROM grouped_value_events
        UNION ALL
        SELECT * FROM marketplace_value_events
      )
      SELECT
        value_events.kind,
        value_events.txid,
        value_events.registry_address,
        value_events.total_sats,
        value_events.expected_min_sats,
        value_events.event_count,
        value_events.max_event_block,
        value_events.max_event_time,
        value_events.marketplace_payment,
        value_events.payment_verified,
        latest_scan.indexed_through_block,
        latest_scan.generated_at
      FROM latest_scan
      LEFT JOIN value_events ON true
      ORDER BY value_events.max_event_block, value_events.kind
    `,
    [network, minBlock, idRegistryAddress],
  );

  return proofIndexConfirmedValueEventDeltaFromRows(result.rows, network);
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
          AND e.status IN ('confirmed', 'pending')
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
