import { createHash } from "node:crypto";

import { createProofIndexPool } from "../server/db/postgres.mjs";

const DEFAULT_API_BASE = "http://127.0.0.1:8081";
const API_BASE = String(process.env.POW_API_BASE ?? DEFAULT_API_BASE).replace(
  /\/+$/u,
  "",
);
const NETWORK = process.env.NETWORK ?? "livenet";
const PAGE_LIMIT = Number(process.env.POW_INDEX_BACKFILL_LIMIT ?? 200);
const MAX_PAGES = Number(process.env.POW_INDEX_BACKFILL_MAX_PAGES ?? 2000);
const REQUEST_TIMEOUT_MS = Number(process.env.POW_INDEX_FETCH_TIMEOUT_MS ?? 60_000);
const REQUEST_RETRIES = Number(process.env.POW_INDEX_FETCH_RETRIES ?? 4);
const BITCOIN_RPC_URL = String(process.env.BITCOIN_RPC_URL ?? "").trim();
const BITCOIN_RPC_USER = String(process.env.BITCOIN_RPC_USER ?? "").trim();
const BITCOIN_RPC_PASSWORD = String(process.env.BITCOIN_RPC_PASSWORD ?? "").trim();
const REPAIR_MINT_MINTERS = /^(?:1|true|yes)$/iu.test(
  String(process.env.POW_INDEX_REPAIR_MINT_MINTERS ?? ""),
);
const REPAIR_MINT_MINTERS_LIMIT = Number(
  process.env.POW_INDEX_REPAIR_MINT_MINTERS_LIMIT ?? 500,
);
const BLOCK_SCAN_MAX_BLOCKS = Number(
  process.env.POW_INDEX_BACKFILL_BLOCK_SCAN_MAX_BLOCKS ?? 2_000,
);
const BLOCK_SCAN_MAX_TXIDS = Number(
  process.env.POW_INDEX_BACKFILL_BLOCK_SCAN_MAX_TXIDS ?? 5_000,
);
const PROTOCOL_PREFIXES = ["pwm1:", "pwid1:", "pwt1:", "pwr1:", "pwc1:"];
const INCLUDE_SCOPED_HOLDERS = !/^(?:0|false|no)$/iu.test(
  String(process.env.POW_INDEX_BACKFILL_HOLDERS ?? "1"),
);
const REFRESH_ACTIVITY_SNAPSHOT = /^(?:1|true|yes)$/iu.test(
  String(process.env.POW_INDEX_BACKFILL_ACTIVITY_SNAPSHOT ?? ""),
);
const REFRESH_SNAPSHOT_SOURCES = /^(?:1|true|yes)$/iu.test(
  String(process.env.POW_INDEX_BACKFILL_SNAPSHOT_FRESH ?? ""),
);
const REFRESH_TOKEN_SNAPSHOT_SOURCES = /^(?:1|true|yes)$/iu.test(
  String(
    process.env.POW_INDEX_BACKFILL_TOKEN_SNAPSHOT_FRESH ??
      process.env.POW_INDEX_BACKFILL_SNAPSHOT_FRESH ??
      "",
  ),
);
const REFRESH_ALL_TOKEN_SNAPSHOT_SOURCES = /^(?:1|true|yes)$/iu.test(
  String(process.env.POW_INDEX_BACKFILL_ALL_TOKEN_SNAPSHOT_FRESH ?? ""),
);
const REFRESH_SUMMARY_SNAPSHOT_SOURCES = /^(?:1|true|yes)$/iu.test(
  String(
    process.env.POW_INDEX_BACKFILL_SUMMARY_SNAPSHOT_FRESH ??
      process.env.POW_INDEX_BACKFILL_SNAPSHOT_FRESH ??
      "",
  ),
);
const REFRESH_SOURCE_READS = /^(?:1|true|yes)$/iu.test(
  String(process.env.POW_INDEX_BACKFILL_SOURCE_FRESH ?? ""),
);
const MAIL_BACKFILL_ADDRESS_LIMIT = Number(
  process.env.POW_INDEX_BACKFILL_MAIL_ADDRESS_LIMIT ?? 200,
);
const DRY_RUN = process.argv.includes("--dry-run");
const DB_SUMMARY_REPAIR = /^(?:1|true|yes)$/iu.test(
  String(process.env.POW_INDEX_DB_SUMMARY_REPAIR ?? ""),
);
const SOURCE_FILTER = new Set(
  String(process.env.POW_INDEX_BACKFILL_SOURCES ?? "")
    .split(/[,\s]+/u)
    .map((value) => value.trim())
    .filter(Boolean),
);
const ALL_SOURCES = [
  { blockScan: true, label: "block-scan" },
  { label: "log", path: "/api/v1/log-history" },
  { label: "registry-records", path: "/api/v1/registry-history", params: { kind: "records" } },
  { label: "registry-pending", path: "/api/v1/registry-history", params: { kind: "pending" } },
  { label: "registry-listings", path: "/api/v1/registry-history", params: { kind: "listings" } },
  { label: "registry-sales", path: "/api/v1/registry-history", params: { kind: "sales" } },
  { label: "tokens", path: "/api/v1/token-history", params: { kind: "tokens" } },
  { label: "token-mints", path: "/api/v1/token-history", params: { kind: "mints" } },
  { label: "token-transfers", path: "/api/v1/token-history", params: { kind: "transfers" } },
  { label: "token-listings", path: "/api/v1/token-history", params: { kind: "listings" } },
  {
    label: "token-closed-listings",
    path: "/api/v1/token-history",
    params: { kind: "closed-listings" },
  },
  { label: "token-sales", path: "/api/v1/token-history", params: { kind: "sales" } },
  {
    label: "token-invalid-events",
    path: "/api/v1/token-history",
    params: { kind: "invalid-events" },
  },
  { addressMail: true, label: "address-mail" },
];
const SOURCES = SOURCE_FILTER.size
  ? ALL_SOURCES.filter((source) => SOURCE_FILTER.has(source.label))
  : ALL_SOURCES;
const WORK_TOKEN_ID =
  "d4e5ebf11d104d6a63fb74e42094364b25a5f7199a09e5c0e71408972466a8b8";
const WORK_TOKEN_MAX_SUPPLY = 21_000_000;
const POWB_TOKEN_ID =
  "a3d0bc8528f91dfc52400a885bed7e49235396aa82aa9f95db41be629f1d5562";
const GROWTH_VALUE_MULTIPLE = 5;
const ID_MARKETPLACE_MUTATION_KINDS = new Set([
  "id-list",
  "id-seal",
  "id-delist",
  "id-buy",
]);
const TOKEN_MARKETPLACE_MUTATION_KINDS = new Set([
  "token-listing",
  "token-listing-sealed",
  "token-listing-closed",
]);
const INFINITY_BOND_MEMO = "powb";
const INFINITY_BOND_KIND = "infinity-bond";
const DEFAULT_MAIL_BACKFILL_ADDRESSES = [
  "1BPVvi1GK4QkfqFMU4jHGjsQjyGwjJJJ7x",
  "1KNkUBREnfno2BeV7QsBf8XCWZN6YFfxPH",
  "bc1p0uxp0axptr8rg9dndgtlwxn00j4hq8m88kg80tqd0t6045putwhq5ca7ed",
  "bc1p8ddc3s6z09ktchgdxxht8l0tt7gs7jn90w004uw2hrxuue39lp7qlxrd3q",
];
const CONFIGURED_MAIL_BACKFILL_ADDRESSES = String(
  process.env.POW_INDEX_BACKFILL_MAIL_ADDRESSES ?? "",
)
  .split(/[,\s]+/u)
  .map((value) => value.trim())
  .filter(Boolean);
const TOKEN_HISTORY_SNAPSHOT_KINDS = [
  "tokens",
  "mints",
  "transfers",
  "listings",
  "closedListings",
  "sales",
  "market-log",
  "holders",
  "invalidEvents",
];
const TOKEN_HISTORY_SNAPSHOT_SCOPES = [
  { key: "all", params: {} },
  { key: WORK_TOKEN_ID, params: { asset: WORK_TOKEN_ID } },
  { key: POWB_TOKEN_ID, params: { asset: POWB_TOKEN_ID } },
];
const REGISTRY_HISTORY_SNAPSHOT_KINDS = ["activity", "listings", "records", "sales"];
const SUMMARY_SNAPSHOT_SOURCES = [
  { key: "growthSummary", path: "/api/v1/growth-summary" },
  { key: "infinitySummary", path: "/api/v1/infinity-summary" },
  { key: "marketplaceSummary", path: "/api/v1/marketplace-summary" },
  { key: "workFloor", path: "/api/v1/work-floor" },
  { key: "workSummary", path: "/api/v1/work-summary" },
];

function endpoint(pathname, params = {}) {
  const url = new URL(`${API_BASE}${pathname}`);
  url.searchParams.set("network", NETWORK);
  url.searchParams.set("limit", String(PAGE_LIMIT));
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== "") {
      url.searchParams.set(key, String(value));
    }
  }
  return url;
}

function unpagedEndpoint(pathname, params = {}) {
  const url = endpoint(pathname, params);
  url.searchParams.delete("limit");
  return url;
}

async function readJson(url, options = {}) {
  let lastError = null;
  const retries = Number.isFinite(options.retries)
    ? Math.max(0, Math.floor(options.retries))
    : REQUEST_RETRIES;

  for (let attempt = 0; attempt <= retries; attempt += 1) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    try {
      const response = await fetch(url, { signal: controller.signal });
      if (!response.ok) {
        throw new Error(`${url.pathname} returned HTTP ${response.status}`);
      }
      return await response.json();
    } catch (error) {
      lastError = error;
      if (attempt >= retries) {
        break;
      }
      const delayMs = Math.min(30_000, 1000 * 2 ** attempt);
      console.error(
        JSON.stringify({
          attempt,
          delayMs,
          error: error?.message ?? String(error),
          retrying: true,
          url: String(url),
        }),
      );
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    } finally {
      clearTimeout(timeout);
    }
  }

  throw lastError;
}

async function bitcoinRpc(method, params = []) {
  if (!BITCOIN_RPC_URL) {
    throw new Error("BITCOIN_RPC_URL is not configured.");
  }

  const headers = { "content-type": "application/json" };
  if (BITCOIN_RPC_USER || BITCOIN_RPC_PASSWORD) {
    headers.authorization = `Basic ${Buffer.from(
      `${BITCOIN_RPC_USER}:${BITCOIN_RPC_PASSWORD}`,
    ).toString("base64")}`;
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(BITCOIN_RPC_URL, {
      body: JSON.stringify({
        id: "proof-indexer-backfill",
        jsonrpc: "1.0",
        method,
        params,
      }),
      headers,
      method: "POST",
      signal: controller.signal,
    });
    if (!response.ok) {
      throw new Error(`Bitcoin RPC ${method} returned HTTP ${response.status}`);
    }
    const payload = await response.json();
    if (payload?.error) {
      throw new Error(
        `Bitcoin RPC ${method} failed: ${payload.error.message ?? payload.error.code}`,
      );
    }
    return payload.result;
  } finally {
    clearTimeout(timeout);
  }
}

const RAW_TRANSACTION_CACHE = new Map();

async function rawTransactionFromCore(txid) {
  const normalizedTxid = String(txid ?? "").trim().toLowerCase();
  if (!isHexTxid(normalizedTxid) || !BITCOIN_RPC_URL) {
    return null;
  }
  if (!RAW_TRANSACTION_CACHE.has(normalizedTxid)) {
    RAW_TRANSACTION_CACHE.set(
      normalizedTxid,
      bitcoinRpc("getrawtransaction", [normalizedTxid, true]).catch(() => null),
    );
  }
  return RAW_TRANSACTION_CACHE.get(normalizedTxid);
}

function prevoutFromOutput(vout) {
  if (!vout || typeof vout !== "object") {
    return null;
  }
  return {
    scriptPubKey: vout.scriptPubKey ?? vout.scriptpubkey ?? {},
    value: vout.value,
  };
}

async function transactionWithInputPrevouts(tx) {
  if (!tx || typeof tx !== "object") {
    return tx;
  }
  const vin = Array.isArray(tx.vin) ? tx.vin : [];
  if (vin.length === 0) {
    return tx;
  }

  const hydratedVin = await Promise.all(
    vin.map(async (input) => {
      if (input?.prevout) {
        return input;
      }
      const prevTxid = String(input?.txid ?? "").trim().toLowerCase();
      const prevVout = Number(input?.vout);
      if (!isHexTxid(prevTxid) || !Number.isSafeInteger(prevVout) || prevVout < 0) {
        return input;
      }
      const previousTx = await rawTransactionFromCore(prevTxid);
      const previousOutput = previousTx?.vout?.[prevVout];
      const prevout = prevoutFromOutput(previousOutput);
      return prevout ? { ...input, prevout } : input;
    }),
  );

  return { ...tx, vin: hydratedVin };
}

function opReturnTextFromVout(vout) {
  const asm = String(
    vout?.scriptPubKey?.asm ?? vout?.scriptpubkey_asm ?? "",
  ).trim();
  if (!asm.startsWith("OP_RETURN")) {
    return "";
  }

  const chunks = [];
  for (const part of asm.split(/\s+/u).slice(1)) {
    if (/^(?:[0-9a-f]{2})+$/iu.test(part)) {
      chunks.push(Buffer.from(part, "hex"));
    }
  }
  if (chunks.length === 0) {
    return "";
  }
  return Buffer.concat(chunks).toString("utf8");
}

function protocolMessagesFromTx(tx) {
  const messages = [];
  for (const vout of tx?.vout ?? []) {
    const text = opReturnTextFromVout(vout);
    const prefix = PROTOCOL_PREFIXES.find((candidate) =>
      text.startsWith(candidate),
    );
    if (prefix) {
      messages.push({ prefix, text });
    }
  }
  return messages;
}

function satsFromVoutValue(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric <= 0) {
    return 0n;
  }
  if (Number.isInteger(numeric) && numeric > 21_000_000) {
    return BigInt(numeric);
  }
  return BigInt(Math.round(numeric * 100_000_000));
}

function addressFromVout(vout) {
  return String(
    vout?.scriptPubKey?.address ??
      vout?.scriptpubkey_address ??
      vout?.scriptPubKey?.addresses?.[0] ??
      "",
  );
}

function protocolOutputIndex(tx) {
  return (tx?.vout ?? []).findIndex((vout) =>
    PROTOCOL_PREFIXES.some((prefix) => opReturnTextFromVout(vout).startsWith(prefix)),
  );
}

function paymentOutputsBeforeProtocol(tx) {
  const protocolIndex = protocolOutputIndex(tx);
  return (tx?.vout ?? [])
    .filter((vout, index) => protocolIndex === -1 || index < protocolIndex)
    .map((vout) => ({
      address: addressFromVout(vout),
      amountSats: satsFromVoutValue(vout.value),
      vout: Number(vout.n ?? 0),
    }))
    .filter((output) => output.address && output.amountSats > 0n);
}

function senderAddressFromTx(tx) {
  for (const vin of tx?.vin ?? []) {
    const address = String(
      vin?.prevout?.scriptPubKey?.address ??
        vin?.prevout?.scriptpubkey_address ??
        vin?.prevout?.scriptPubKey?.addresses?.[0] ??
        "",
    );
    if (address) {
      return address;
    }
  }
  return "";
}

function blockEventTime(tx) {
  const time = Number(tx?.blocktime ?? tx?.status?.block_time ?? 0);
  return Number.isFinite(time) && time > 0
    ? new Date(time * 1000).toISOString()
    : new Date().toISOString();
}

function decodeBase64UrlText(value) {
  try {
    const normalized = String(value ?? "").replace(/-/gu, "+").replace(/_/gu, "/");
    const padded = normalized.padEnd(
      Math.ceil(normalized.length / 4) * 4,
      "=",
    );
    return Buffer.from(padded, "base64").toString("utf8");
  } catch {
    return "";
  }
}

function decodeBase64UrlJson(value) {
  try {
    const normalized = String(value ?? "").replace(/-/gu, "+").replace(/_/gu, "/");
    const padded = normalized.padEnd(
      Math.ceil(normalized.length / 4) * 4,
      "=",
    );
    return JSON.parse(Buffer.from(padded, "base64").toString("utf8"));
  } catch {
    return null;
  }
}

function baseProtocolItem(tx, message, kind) {
  const payments = paymentOutputsBeforeProtocol(tx);
  const amountSats = payments.reduce(
    (sum, output) => sum + output.amountSats,
    0n,
  );
  return {
    amountSats: amountSats.toString(),
    blockHeight: Number(tx?.status?.block_height ?? tx?.height ?? 0) || null,
    blockTime: blockEventTime(tx),
    confirmed: true,
    dataBytes: Buffer.byteLength(message.text, "utf8"),
    kind,
    network: NETWORK,
    payload: message.text,
    protocol: message.prefix.replace(/:$/u, ""),
    recipients: payments.map((output) => ({
      address: output.address,
      amountSats: output.amountSats.toString(),
      vout: output.vout,
    })),
    senderAddress: senderAddressFromTx(tx),
    timestamp: blockEventTime(tx),
    txid: tx.txid,
  };
}

function tokenListingItemFromTicket(tx, message, ticket) {
  const base = baseProtocolItem(tx, message, "token-listing");
  const tokenId = String(ticket?.tokenId ?? ticket?.asset ?? "").toLowerCase();
  if (!isHexTxid(tokenId)) {
    return null;
  }
  return {
    ...base,
    amount: String(ticket?.amount ?? ticket?.quantity ?? ticket?.units ?? 0),
    listingId: tx.txid,
    priceSats: String(
      ticket?.priceSats ??
        ticket?.price ??
        ticket?.totalPriceSats ??
        ticket?.totalSats ??
        0,
    ),
    saleAuthorization: ticket,
    saleTicketTxid: tx.txid,
    saleTicketValueSats: String(ticket?.saleTicketValueSats ?? 546),
    saleTicketVout: Number(ticket?.saleTicketVout ?? 2),
    sellerAddress:
      ticket?.sellerAddress ?? ticket?.seller ?? base.senderAddress ?? "",
    tokenId,
  };
}

function protocolItemsFromTx(tx, message) {
  const parts = String(message.text ?? "").split(":");
  const action = String(parts[1] ?? "").toLowerCase();
  if (message.prefix === "pwm1:") {
    const memo = parts.slice(2).join(":");
    return [
      {
        ...baseProtocolItem(
          tx,
          message,
          action === "a"
            ? "attachment"
            : action === "r"
              ? "reply"
              : memo.trim().toLowerCase() === INFINITY_BOND_MEMO
                ? INFINITY_BOND_KIND
                : "mail",
        ),
        memo,
        subject: action === "s" ? decodeBase64UrlText(parts[2]) : "",
      },
    ];
  }

  if (message.prefix === "pwid1:") {
    return [
      {
        ...baseProtocolItem(tx, message, action === "r2" ? "id-register" : `id-${action || "event"}`),
        id: decodeBase64UrlText(parts[2]),
        ownerAddress: parts[3] ?? "",
        receiveAddress: parts[4] ?? parts[3] ?? "",
      },
    ];
  }

  if (message.prefix !== "pwt1:") {
    return [baseProtocolItem(tx, message, `${message.prefix.replace(/:$/u, "")}-event`)];
  }

  if (action === "create") {
    return [
      {
        ...baseProtocolItem(tx, message, "token-create"),
        createTxid: tx.txid,
        creatorAddress: senderAddressFromTx(tx),
        maxSupply: parts[3] ?? "0",
        mintAmount: parts[4] ?? "0",
        mintPriceSats: parts[5] ?? "0",
        registryAddress: parts[6] ?? "",
        ticker: parts[2] ?? "",
        tokenId: tx.txid,
      },
    ];
  }
  if (action === "mint") {
    return [
      {
        ...baseProtocolItem(tx, message, "token-mint"),
        amount: parts[3] ?? "0",
        minterAddress: senderAddressFromTx(tx),
        tokenId: String(parts[2] ?? "").toLowerCase(),
      },
    ];
  }
  if (action === "send") {
    return [
      {
        ...baseProtocolItem(tx, message, "token-transfer"),
        amount: parts[3] ?? "0",
        recipientAddress: parts[4] ?? "",
        senderAddress: senderAddressFromTx(tx),
        tokenId: String(parts[2] ?? "").toLowerCase(),
      },
    ];
  }
  if (action === "list5") {
    const item = tokenListingItemFromTicket(tx, message, decodeBase64UrlJson(parts[2]));
    return item ? [item] : [baseProtocolItem(tx, message, "token-listing")];
  }
  if (action === "seal5") {
    const ticket = decodeBase64UrlJson(parts[3]);
    const item = tokenListingItemFromTicket(tx, message, ticket);
    const listingId = String(
      parts[2] ?? ticket?.anchorTxid ?? item?.listingId ?? "",
    )
      .trim()
      .toLowerCase();
    return [
      {
        ...(item ?? baseProtocolItem(tx, message, "token-listing-sealed")),
        kind: "token-listing-sealed",
        closeTxid: undefined,
        closedTxid: undefined,
        listingId,
        saleTicketTxid:
          ticket?.anchorTxid ?? listingId ?? item?.saleTicketTxid ?? "",
        saleTicketValueSats:
          ticket?.anchorValueSats ?? item?.saleTicketValueSats ?? 546,
        saleTicketVout: ticket?.anchorVout ?? item?.saleTicketVout ?? 2,
        sealConfirmed: true,
        sealTxid: tx.txid,
      },
    ];
  }
  if (action === "delist5") {
    return [
      {
        ...baseProtocolItem(tx, message, "token-listing-closed"),
        closedTxid: tx.txid,
        listingId: parts[2] ?? "",
      },
    ];
  }
  if (action === "buy5") {
    return [
      {
        ...baseProtocolItem(tx, message, "token-sale"),
        buyerAddress: parts[3] ?? "",
        listingId: parts[2] ?? "",
        saleTxid: tx.txid,
      },
    ];
  }
  return [baseProtocolItem(tx, message, "token-event")];
}

function sourceLabelForProtocolItem(item) {
  const kind = String(item?.kind ?? "").toLowerCase();
  if (kind === "token-create") {
    return "tokens";
  }
  if (kind === "token-mint") {
    return "token-mints";
  }
  if (kind === "token-transfer") {
    return "token-transfers";
  }
  if (kind === "token-sale") {
    return "token-sales";
  }
  if (kind === "token-listing-closed") {
    return "token-closed-listings";
  }
  if (kind.startsWith("token-listing")) {
    return "token-listings";
  }
  if (kind === "id-register") {
    return "registry-records";
  }
  if (kind.includes("list")) {
    return "registry-listings";
  }
  if (kind.includes("buy") || kind.includes("transfer")) {
    return "registry-sales";
  }
  return "log";
}

function tokenScopesForProtocolMessage(txid, text) {
  const parts = String(text ?? "").split(":");
  const action = String(parts[1] ?? "").toLowerCase();
  const scopes = new Set();
  if (action === "create" && isHexTxid(txid)) {
    scopes.add(txid);
  }
  if (["mint", "send"].includes(action) && isHexTxid(parts[2])) {
    scopes.add(parts[2].toLowerCase());
  }
  if (action === "list5") {
    const ticket = decodeBase64UrlJson(parts[2]);
    if (isHexTxid(ticket?.tokenId)) {
      scopes.add(String(ticket.tokenId).toLowerCase());
    }
  }
  if (action === "seal5") {
    const ticket = decodeBase64UrlJson(parts[3]);
    if (isHexTxid(ticket?.tokenId)) {
      scopes.add(String(ticket.tokenId).toLowerCase());
    }
  }
  if (scopes.size === 0) {
    scopes.add(WORK_TOKEN_ID);
    scopes.add(POWB_TOKEN_ID);
  }
  return [...scopes];
}

function tokenRecoveryKindsForProtocolMessage(text) {
  const action = String(String(text ?? "").split(":")[1] ?? "").toLowerCase();
  if (action === "create") {
    return [{ kind: "tokens", label: "tokens" }];
  }
  if (action === "mint") {
    return [{ kind: "mints", label: "token-mints" }];
  }
  if (action === "send") {
    return [{ kind: "transfers", label: "token-transfers" }];
  }
  if (action === "list5" || action === "seal5") {
    return [{ kind: "listings", label: "token-listings" }];
  }
  if (action === "delist5") {
    return [{ kind: "closed-listings", label: "token-closed-listings" }];
  }
  if (action === "buy5") {
    return [
      { kind: "sales", label: "token-sales" },
      { kind: "closed-listings", label: "token-closed-listings" },
    ];
  }
  return [
    { kind: "tokens", label: "tokens" },
    { kind: "mints", label: "token-mints" },
    { kind: "transfers", label: "token-transfers" },
    { kind: "listings", label: "token-listings" },
    { kind: "closed-listings", label: "token-closed-listings" },
    { kind: "sales", label: "token-sales" },
    { kind: "invalid-events", label: "token-invalid-events" },
  ];
}

function recoveryEndpointSpecs(txid, message) {
  const q = txid;
  if (message.prefix === "pwm1:") {
    return [
      {
        label: "log",
        params: { q },
        path: "/api/v1/event-history",
      },
    ];
  }
  if (message.prefix === "pwid1:") {
    return [
      { label: "registry-records", params: { kind: "records", q }, path: "/api/v1/registry-history" },
      { label: "registry-listings", params: { kind: "listings", q }, path: "/api/v1/registry-history" },
      { label: "registry-sales", params: { kind: "sales", q }, path: "/api/v1/registry-history" },
    ];
  }
  if (message.prefix === "pwt1:") {
    const scopes = tokenScopesForProtocolMessage(txid, message.text);
    const kinds = tokenRecoveryKindsForProtocolMessage(message.text);
    const specs = [];
    for (const scope of scopes) {
      const scoped = { asset: scope };
      for (const kind of kinds) {
        specs.push({
          label: kind.label,
          params: { ...scoped, kind: kind.kind, q },
          path: "/api/v1/token-history",
        });
      }
    }
    return specs;
  }
  return [];
}

async function recoverProtocolTxid(client, tx, messages) {
  let indexed = 0;
  let skipped = 0;
  for (const message of messages) {
    for (const item of protocolItemsFromTx(tx, message)) {
      const result = await upsertEvent(client, sourceLabelForProtocolItem(item), item);
      if (result.skipped) {
        skipped += 1;
      } else {
        indexed += 1;
      }
    }
  }
  return { indexed, skipped };
}

function snapshotSourceParams(params = {}) {
  return REFRESH_SNAPSHOT_SOURCES ? { ...params, fresh: "1" } : params;
}

function tokenSnapshotSourceParams(params = {}) {
  return REFRESH_TOKEN_SNAPSHOT_SOURCES ? { ...params, fresh: "1" } : params;
}

function scopedTokenSnapshotSourceParams(scope, params = {}) {
  if (scope?.key === "all" && !REFRESH_ALL_TOKEN_SNAPSHOT_SOURCES) {
    return snapshotSourceParams(params);
  }
  return tokenSnapshotSourceParams(params);
}

function summarySnapshotSourceParams(params = {}) {
  return REFRESH_SUMMARY_SNAPSHOT_SOURCES
    ? { ...params, fresh: "1" }
    : snapshotSourceParams(params);
}

function backfillSourceParams(params = {}) {
  return REFRESH_SOURCE_READS ? { ...params, fresh: "1" } : params;
}

async function readHistorySnapshot(
  pathname,
  params = {},
  sourceParams = snapshotSourceParams,
) {
  let cursor = "";
  let firstPayload = null;
  let page = 0;
  const items = [];

  while (page < MAX_PAGES) {
    const payload = await readJson(
      endpoint(pathname, sourceParams({ ...params, cursor })),
    );
    if (!firstPayload) {
      firstPayload = payload;
    }
    items.push(...(Array.isArray(payload.items) ? payload.items : []));
    cursor = String(payload.nextCursor ?? "");
    page += 1;
    if (!cursor) {
      break;
    }
  }

  const payloadTotalCount = Number(firstPayload?.totalCount);
  const totalCount = Math.max(
    Number.isFinite(payloadTotalCount) ? payloadTotalCount : 0,
    items.length,
  );
  return {
    ...(firstPayload ?? {}),
    complete: !cursor,
    cursor: "0",
    end: items.length,
    items,
    limit: items.length,
    nextCursor: "",
    page: 0,
    pageCount: 1,
    pageSize: items.length,
    totalCount,
  };
}

function isHexTxid(value) {
  return /^[0-9a-f]{64}$/u.test(String(value ?? "").toLowerCase());
}

function itemTxid(item) {
  const candidates = [
    item?.txid,
    item?.eventTxid,
    item?.listingId,
    item?.closedTxid,
    item?.sealTxid,
    item?.tokenId,
  ];
  return String(candidates.find(isHexTxid) ?? "").toLowerCase();
}

function itemStatus(item) {
  const raw = String(item?.status ?? "").toLowerCase();
  if (["pending", "confirmed", "dropped", "orphaned"].includes(raw)) {
    return raw;
  }
  if (item?.dropped === true) {
    return "dropped";
  }
  return item?.confirmed === false ? "pending" : "confirmed";
}

function itemTime(item) {
  return (
    item?.createdAt ??
    item?.confirmedAt ??
    item?.indexedAt ??
    item?.updatedAt ??
    null
  );
}

function normalizedText(value) {
  return String(value ?? "").trim();
}

function normalizedLowerText(value) {
  return normalizedText(value).toLowerCase();
}

function rawEventKind(item, fallback) {
  return normalizedLowerText(item?.kind ?? item?.action ?? fallback ?? "event");
}

function isInfinityBondMemoText(value) {
  return normalizedLowerText(value) === INFINITY_BOND_MEMO;
}

function isInfinityBondItem(item, kind = rawEventKind(item)) {
  if (kind === INFINITY_BOND_KIND) {
    return true;
  }
  if (kind !== "mail") {
    return false;
  }
  return [item?.detail, item?.memo, item?.body, item?.message].some(
    isInfinityBondMemoText,
  );
}

function stableEventKeyKind(item, kind, fallback) {
  const rawKind = rawEventKind(item, fallback);
  return isInfinityBondItem(item, rawKind) || kind === INFINITY_BOND_KIND
    ? INFINITY_BOND_KIND
    : kind;
}

function normalizedInfinityBondTags(tags) {
  const normalized = [];
  for (const tag of Array.isArray(tags) ? tags : []) {
    const value = normalizedText(tag);
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

function normalizedInfinityBondTitle(item, status) {
  const title = normalizedText(item?.title);
  if (title && !/^(?:mail|message)\b/iu.test(title)) {
    return title;
  }
  return `Infinity Bond ${status === "confirmed" ? "sent" : "pending"}`;
}

function normalizedEventItem(item, kind, status) {
  if (kind !== INFINITY_BOND_KIND) {
    return item;
  }
  return {
    ...item,
    detail: normalizedText(item?.detail) || INFINITY_BOND_MEMO,
    kind: INFINITY_BOND_KIND,
    tags: normalizedInfinityBondTags(item?.tags),
    title: normalizedInfinityBondTitle(item, status),
  };
}

function tokenMarketLogItemConfirmed(item) {
  if (item?.kind === "closed-listing") {
    return item.closedListing?.closedConfirmed ?? item.closedListing?.confirmed;
  }
  if (item?.kind === "sale") {
    return item.sale?.confirmed;
  }
  return item?.listing?.confirmed;
}

function tokenMarketLogItemCreatedAt(item) {
  if (item?.kind === "closed-listing") {
    return String(
      item.closedListing?.closedAt ?? item.closedListing?.createdAt ?? "",
    );
  }
  if (item?.kind === "sale") {
    return String(item.sale?.createdAt ?? "");
  }
  return String(item?.listing?.createdAt ?? "");
}

function tokenMarketLogItemTxid(item) {
  if (item?.kind === "closed-listing") {
    return String(
      item.closedListing?.closedTxid ?? item.closedListing?.listingId ?? "",
    );
  }
  if (item?.kind === "sale") {
    return String(item.sale?.txid ?? "");
  }
  return String(item?.listing?.listingId ?? "");
}

function tokenMarketLogItemsFromState(state) {
  const listings = Array.isArray(state?.listings) ? state.listings : [];
  const closedListings = Array.isArray(state?.closedListings)
    ? state.closedListings
    : [];
  const sales = Array.isArray(state?.sales) ? state.sales : [];

  return [
    ...listings.map((listing) => ({
      createdAt: listing.createdAt,
      kind: "listing",
      listing,
      txid: listing.listingId,
    })),
    ...closedListings.map((closedListing) => ({
      closedListing,
      createdAt: closedListing.closedAt ?? closedListing.createdAt,
      kind: "closed-listing",
      txid: closedListing.closedTxid || closedListing.listingId,
    })),
    ...sales.map((sale) => ({
      createdAt: sale.createdAt,
      kind: "sale",
      sale,
      txid: sale.txid,
    })),
  ].sort(
    (left, right) =>
      Date.parse(tokenMarketLogItemCreatedAt(right)) -
        Date.parse(tokenMarketLogItemCreatedAt(left)) ||
      Number(tokenMarketLogItemConfirmed(right)) -
        Number(tokenMarketLogItemConfirmed(left)) ||
      tokenMarketLogItemTxid(left).localeCompare(tokenMarketLogItemTxid(right)),
  );
}

function tokenHistoryItemsFromState(state, kind) {
  if (kind === "market-log") {
    return tokenMarketLogItemsFromState(state);
  }
  return Array.isArray(state?.[kind]) ? state[kind] : [];
}

function tokenHistorySnapshotFromState(state, kind) {
  const items = tokenHistoryItemsFromState(state, kind);
  return {
    complete: true,
    consistency: state?.consistency,
    cursor: "0",
    end: items.length,
    indexedAt: state?.indexedAt ?? new Date().toISOString(),
    indexedThroughBlock: state?.indexedThroughBlock,
    items,
    kind,
    ledgerGeneratedAt: state?.ledgerGeneratedAt,
    limit: items.length,
    network: state?.network ?? NETWORK,
    nextCursor: "",
    page: 0,
    pageCount: 1,
    pageSize: items.length,
    query: "",
    snapshotId: state?.snapshotId,
    source: state?.source ?? API_BASE,
    start: 0,
    totalCount: items.length,
  };
}

async function tokenHistorySnapshotsForScope(scope) {
  const state = await readJson(
    endpoint(
      "/api/v1/token",
      scopedTokenSnapshotSourceParams(scope, scope.params),
    ),
  );
  const snapshots = Object.fromEntries(
    TOKEN_HISTORY_SNAPSHOT_KINDS.map((kind) => [
      kind,
      tokenHistorySnapshotFromState(state, kind),
    ]),
  );
  if (REFRESH_SNAPSHOT_SOURCES || REFRESH_TOKEN_SNAPSHOT_SOURCES) {
    try {
      snapshots["market-log"] = await readHistorySnapshot(
        "/api/v1/token-history",
        {
          ...scope.params,
          kind: "market-log",
        },
        (params) => scopedTokenSnapshotSourceParams(scope, params),
      );
    } catch (error) {
      console.error(
        JSON.stringify({
          error: error?.message ?? String(error),
          kind: "market-log",
          phase: "token-history-snapshot",
          scope: scope.key,
        }),
      );
      delete snapshots["market-log"];
    }
  }
  return {
    historyPayloads: snapshots,
    statePayload: state,
  };
}

async function summarySnapshots() {
  const payloads = {};
  for (const source of SUMMARY_SNAPSHOT_SOURCES) {
    try {
      payloads[source.key] = await readJson(
        unpagedEndpoint(source.path, summarySnapshotSourceParams()),
      );
    } catch (error) {
      console.error(
        JSON.stringify({
          error: error?.message ?? String(error),
          phase: "summary-snapshot",
          source: source.key,
        }),
      );
    }
  }
  if (!REFRESH_SUMMARY_SNAPSHOT_SOURCES) {
    return payloads;
  }

  for (const source of SUMMARY_SNAPSHOT_SOURCES) {
    try {
      const currentPayload = await readJson(unpagedEndpoint(source.path));
      payloads[source.key] = strongerSummaryPayload(
        payloads[source.key],
        currentPayload,
      );
    } catch (error) {
      console.error(
        JSON.stringify({
          error: error?.message ?? String(error),
          phase: "summary-snapshot-current",
          source: source.key,
        }),
      );
    }
  }
  return payloads;
}

async function registryHistorySnapshots() {
  const entries = [];
  for (const kind of REGISTRY_HISTORY_SNAPSHOT_KINDS) {
    try {
      entries.push([
        kind,
        await readHistorySnapshot("/api/v1/registry-history", { kind }),
      ]);
    } catch (error) {
      console.error(
        JSON.stringify({
          error: error?.message ?? String(error),
          kind,
          phase: "registry-history-snapshot",
        }),
      );
    }
  }
  return Object.fromEntries(entries);
}

async function storedLedgerSnapshotPayload(client, snapshotId = "", options = {}) {
  const requestedSnapshotId = String(snapshotId ?? "").trim();
  const params = [NETWORK];
  const snapshotFilter = requestedSnapshotId
    ? "AND snapshot_id = $2"
    : "";
  if (requestedSnapshotId) {
    params.push(requestedSnapshotId);
  }
  const result = await client.query(
    `
      SELECT payload
      FROM proof_indexer.ledger_snapshots
      WHERE network = $1
      ${snapshotFilter}
      ${options.requireSummaryPayloads ? "AND payload ? 'summaryPayloads'" : ""}
      ORDER BY generated_at DESC
      LIMIT 1
    `,
    params,
  );
  const payload = result.rows[0]?.payload;
  return payload && typeof payload === "object" && !Array.isArray(payload)
    ? payload
    : {};
}

async function activitySnapshot(previousPayload) {
  if (!REFRESH_ACTIVITY_SNAPSHOT) {
    return previousPayload?.activityPayload ?? null;
  }
  try {
    return await readJson(endpoint("/api/v1/log", { fresh: "1" }));
  } catch (error) {
    console.error(
      JSON.stringify({
        error: error?.message ?? String(error),
        phase: "activity-snapshot",
        preservedPrevious: Boolean(previousPayload?.activityPayload),
      }),
    );
    return previousPayload?.activityPayload ?? null;
  }
}

function numberOrNull(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function bigintOrZero(value) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.trunc(number) : 0;
}

function eventKind(item, fallback) {
  const kind = rawEventKind(item, fallback);
  return isInfinityBondItem(item, kind) ? INFINITY_BOND_KIND : kind;
}

function protocolForItem(item, kind) {
  if (item?.protocol) {
    return String(item.protocol);
  }
  if (kind.startsWith("token") || item?.tokenId || item?.ticker) {
    return "pwt1";
  }
  if (kind.startsWith("id") || item?.id || item?.ownerAddress || item?.receiveAddress) {
    return "pwid1";
  }
  if (kind.startsWith("rush")) {
    return "pwr1";
  }
  if (
    ["mail", "reply", "file", "attachment", "browser", "infinity-bond"].includes(kind)
  ) {
    return "pwm1";
  }
  return "proof";
}

function amountSats(item) {
  return bigintOrZero(
    item?.amountSats ??
      item?.paidSats ??
      item?.priceSats ??
      item?.mintPriceSats ??
      item?.creationFeeSats ??
      item?.mutationFeeSats ??
      item?.feeSats,
  );
}

function dataBytes(item) {
  return bigintOrZero(item?.dataBytes ?? item?.protocolBytes ?? item?.sizeBytes);
}

function subjectOnlyMailBody(value) {
  return /^Subject:\s*/iu.test(String(value ?? "").trim());
}

function mailItemBodyText(item) {
  const direct = normalizedText(item?.body ?? item?.message ?? item?.memo ?? "");
  if (direct) {
    return direct;
  }

  const detail = normalizedText(item?.detail ?? "");
  return detail && !subjectOnlyMailBody(detail) ? detail : null;
}

function addressMailMessageKind(message) {
  const explicit = normalizedLowerText(message?.protocolKind ?? message?.kind);
  if (
    ["mail", "reply", "file", "attachment", "browser", INFINITY_BOND_KIND].includes(
      explicit,
    )
  ) {
    return explicit === "attachment" ? "file" : explicit;
  }
  if (message?.attachment) {
    return "file";
  }
  if (message?.parentTxid) {
    return "reply";
  }
  return isInfinityBondMemoText(message?.memo) ? INFINITY_BOND_KIND : "mail";
}

function normalizedMailRecipients(message, fallbackAddress = "") {
  const recipients = Array.isArray(message?.recipients)
    ? message.recipients
        .map((recipient) => ({
          address: normalizedText(recipient?.address ?? recipient?.display),
          amountSats: bigintOrZero(recipient?.amountSats),
          display: normalizedText(recipient?.display ?? recipient?.address),
        }))
        .filter((recipient) => recipient.address)
    : [];
  if (recipients.length > 0) {
    return recipients;
  }
  const to = normalizedText(message?.to ?? fallbackAddress);
  return to
    ? [
        {
          address: to,
          amountSats: amountSats(message),
          display: to,
        },
      ]
    : [];
}

function addressMailMessageToEvent(message, address, folder) {
  const txid = itemTxid(message);
  if (!txid) {
    return null;
  }
  const kind = addressMailMessageKind(message);
  const recipients = normalizedMailRecipients(message, address);
  const actor = normalizedText(message?.from) || address;
  const counterparty =
    normalizedText(message?.to) ||
    (recipients.length === 1
      ? recipients[0].display || recipients[0].address
      : recipients.length > 1
        ? `${recipients[0].display || recipients[0].address} +${recipients.length - 1}`
        : "Unknown");
  const status = itemStatus(message);
  const memo = normalizedText(message?.memo);
  const detail =
    message?.attachment
      ? `${message.attachment.name ?? "Attachment"}`
      : normalizedText(message?.subject)
        ? `Subject: ${message.subject}`
        : memo || "No message body";
  const totalSats =
    amountSats(message) ||
    recipients.reduce((total, recipient) => total + amountSats(recipient), 0);

  return {
    amountSats: totalSats,
    actor,
    attachment: message?.attachment,
    confirmed: status === "confirmed",
    counterparty,
    createdAt: itemTime(message),
    detail,
    indexedFromMailboxFolder: folder,
    kind,
    memo,
    network: NETWORK,
    parentTxid: message?.parentTxid,
    participants: [
      actor,
      ...recipients.map((recipient) => recipient.address),
    ].filter(Boolean),
    recipients,
    senderAddress: actor,
    status,
    subject: message?.subject,
    title: kind === INFINITY_BOND_KIND ? "Infinity Bond sent" : "Mail sent",
    txid,
  };
}

function addressMailPayloadEvents(payload, address) {
  const events = [
    ...(Array.isArray(payload?.inboxMessages)
      ? payload.inboxMessages.map((message) =>
          addressMailMessageToEvent(message, address, "inbox"),
        )
      : []),
    ...(Array.isArray(payload?.sentMessages)
      ? payload.sentMessages.map((message) =>
          addressMailMessageToEvent(message, address, "sent"),
        )
      : []),
  ].filter(Boolean);
  const byKey = new Map();
  for (const event of events) {
    byKey.set(`${event.kind}:${event.txid}`, event);
  }
  return [...byKey.values()];
}

function stableEventKey({ item, kind, protocol, sourceLabel, txid }) {
  const parts = [
    protocol,
    kind,
    txid,
    item?.listingId,
    item?.tokenId,
    item?.id,
    item?.parentTxid,
    item?.attachmentIndex,
    item?.vout,
  ]
    .filter((value) => value !== undefined && value !== null && value !== "")
    .map(String);
  if (parts.length >= 3) {
    return parts.join(":").toLowerCase();
  }
  const digest = createHash("sha256")
    .update(JSON.stringify({ item, sourceLabel }))
    .digest("hex")
    .slice(0, 24);
  return `${sourceLabel}:${digest}`;
}

function participantsForItem(item) {
  const participants = [];
  const add = (address, role, powid = "") => {
    const value = String(address ?? "").trim();
    if (value) {
      participants.push({ address: value, powid: String(powid ?? ""), role });
    }
  };
  for (const address of Array.isArray(item?.participants) ? item.participants : []) {
    add(address, "participant");
  }
  add(item?.address, "address");
  add(item?.senderAddress, "sender");
  add(item?.recipientAddress, "recipient");
  add(item?.ownerAddress, "owner", item?.id);
  add(item?.receiveAddress, "receiver", item?.id);
  add(item?.sellerAddress, "seller");
  add(item?.buyerAddress, "buyer");
  add(item?.registryAddress, "registry");
  add(item?.creatorAddress, "creator");
  add(item?.minterAddress, "minter");
  const unique = new Map();
  for (const participant of participants) {
    unique.set(
      `${participant.address}:${participant.role}:${participant.powid}`,
      participant,
    );
  }
  return [...unique.values()];
}

function refsForItem(item) {
  const refs = [];
  const add = (refType, refValue) => {
    const value = String(refValue ?? "").trim();
    if (value) {
      refs.push({ refType, refValue: value });
    }
  };
  add("powid", item?.id);
  add("token-id", item?.tokenId);
  add("ticker", item?.ticker);
  add("listing-id", item?.listingId);
  add("parent-txid", item?.parentTxid);
  add("closed-txid", item?.closedTxid);
  add("seal-txid", item?.sealTxid);
  if (item?.saleTicketTxid && item?.saleTicketVout !== undefined) {
    add("sale-ticket-outpoint", `${item.saleTicketTxid}:${item.saleTicketVout}`);
  }
  return refs;
}

async function upsertTransaction(client, item, txid, status, sourceLabel) {
  const eventTime = itemTime(item);
  await client.query(
    `
      INSERT INTO proof_indexer.transactions (
        network,
        txid,
        status,
        first_seen_at,
        last_seen_at,
        confirmed_at,
        block_height,
        block_time,
        source,
        raw_tx
      )
      VALUES (
        $1,
        $2,
        $3,
        now(),
        now(),
        CASE WHEN $3 = 'confirmed' THEN COALESCE($4::timestamptz, now()) ELSE NULL END,
        $5,
        $4::timestamptz,
        $6,
        $7::jsonb
      )
      ON CONFLICT (network, txid)
      DO UPDATE SET
        status = EXCLUDED.status,
        last_seen_at = now(),
        confirmed_at = COALESCE(proof_indexer.transactions.confirmed_at, EXCLUDED.confirmed_at),
        block_height = COALESCE(EXCLUDED.block_height, proof_indexer.transactions.block_height),
        block_time = COALESCE(EXCLUDED.block_time, proof_indexer.transactions.block_time),
        source = COALESCE(EXCLUDED.source, proof_indexer.transactions.source),
        raw_tx = COALESCE(proof_indexer.transactions.raw_tx, EXCLUDED.raw_tx),
        updated_at = now()
    `,
    [
      NETWORK,
      txid,
      status,
      eventTime,
      numberOrNull(item?.blockHeight ?? item?.height),
      sourceLabel,
      JSON.stringify({ indexedFrom: sourceLabel, item }),
    ],
  );
}

async function upsertEvent(client, sourceLabel, item) {
  const txid = itemTxid(item);
  const status = itemStatus(item);
  if (!txid) {
    await upsertProjection(client, sourceLabel, item, status);
    return { projected: true, skipped: true };
  }

  const kind = eventKind(item, sourceLabel);
  const normalizedItem = normalizedEventItem(item, kind, status);
  const protocol = protocolForItem(item, kind);
  const eventKey = stableEventKey({
    item: normalizedItem,
    kind: stableEventKeyKind(item, kind, sourceLabel),
    protocol,
    sourceLabel,
    txid,
  });
  const eventTime = itemTime(normalizedItem);

  await upsertTransaction(client, normalizedItem, txid, status, sourceLabel);

  const result = await client.query(
    `
      INSERT INTO proof_indexer.events (
        network,
        event_key,
        txid,
        protocol,
        kind,
        status,
        valid,
        validation_errors,
        amount_sats,
        data_bytes,
        block_height,
        block_time,
        event_time,
        raw_payload,
        payload
      )
      VALUES (
        $1,
        $2,
        $3,
        $4,
        $5,
        $6,
        $7,
        $8::text[],
        $9,
        $10,
        $11,
        $12::timestamptz,
        $13::timestamptz,
        $14,
        $15::jsonb
      )
      ON CONFLICT (network, event_key)
      DO UPDATE SET
        status = EXCLUDED.status,
        valid = EXCLUDED.valid,
        validation_errors = EXCLUDED.validation_errors,
        amount_sats = EXCLUDED.amount_sats,
        data_bytes = EXCLUDED.data_bytes,
        block_height = COALESCE(EXCLUDED.block_height, proof_indexer.events.block_height),
        block_time = COALESCE(EXCLUDED.block_time, proof_indexer.events.block_time),
        event_time = COALESCE(EXCLUDED.event_time, proof_indexer.events.event_time),
        raw_payload = EXCLUDED.raw_payload,
        payload = EXCLUDED.payload,
        updated_at = now()
      RETURNING event_id
    `,
    [
      NETWORK,
      eventKey,
      txid,
      protocol,
      kind,
      status,
      normalizedItem?.valid !== false && !String(kind).includes("invalid"),
      normalizedItem?.reason ? [String(normalizedItem.reason)] : [],
      amountSats(normalizedItem),
      dataBytes(normalizedItem),
      numberOrNull(normalizedItem?.blockHeight ?? normalizedItem?.height),
      eventTime,
      eventTime,
      normalizedItem?.payload ? String(normalizedItem.payload) : "",
      JSON.stringify({ ...normalizedItem, indexedFrom: sourceLabel }),
    ],
  );
  const eventId = result.rows[0].event_id;

  await client.query("DELETE FROM proof_indexer.event_participants WHERE event_id = $1", [
    eventId,
  ]);
  for (const participant of participantsForItem(normalizedItem)) {
    await client.query(
      `
        INSERT INTO proof_indexer.event_participants (event_id, address, role, powid)
        VALUES ($1, $2, $3, NULLIF($4, ''))
        ON CONFLICT DO NOTHING
      `,
      [eventId, participant.address, participant.role, participant.powid],
    );
  }

  await client.query("DELETE FROM proof_indexer.event_refs WHERE event_id = $1", [
    eventId,
  ]);
  for (const ref of refsForItem(normalizedItem)) {
    await client.query(
      `
        INSERT INTO proof_indexer.event_refs (event_id, ref_type, ref_value)
        VALUES ($1, $2, $3)
        ON CONFLICT DO NOTHING
      `,
      [eventId, ref.refType, ref.refValue],
    );
  }

  await upsertProjection(client, sourceLabel, normalizedItem, status);
  return { skipped: false };
}

async function upsertProjection(client, sourceLabel, item, status) {
  if (sourceLabel === "registry-records" && item?.id && item?.ownerAddress) {
    await client.query(
      `
        INSERT INTO proof_indexer.id_records (
          network,
          id_lower,
          display_id,
          owner_address,
          receive_address,
          pgp_public_key,
          registration_txid,
          last_event_txid,
          registered_height,
          updated_height,
          updated_at
        )
        VALUES ($1, lower($2), $2, $3, $4, $5, $6, $6, $7, $7, now())
        ON CONFLICT (network, id_lower)
        DO UPDATE SET
          display_id = EXCLUDED.display_id,
          owner_address = EXCLUDED.owner_address,
          receive_address = EXCLUDED.receive_address,
          pgp_public_key = COALESCE(EXCLUDED.pgp_public_key, proof_indexer.id_records.pgp_public_key),
          last_event_txid = EXCLUDED.last_event_txid,
          updated_height = COALESCE(EXCLUDED.updated_height, proof_indexer.id_records.updated_height),
          updated_at = now()
      `,
      [
        NETWORK,
        String(item.id),
        item.ownerAddress,
        item.receiveAddress ?? item.ownerAddress,
        item.pgpPublicKey ?? null,
        item.txid,
        numberOrNull(item.blockHeight ?? item.height),
      ],
    );
  }

  if (sourceLabel === "tokens" && item?.tokenId && item?.ticker) {
    await client.query(
      `
        INSERT INTO proof_indexer.credit_definitions (
          network,
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
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12::jsonb)
        ON CONFLICT (network, token_id)
        DO UPDATE SET
          ticker = EXCLUDED.ticker,
          creator_address = EXCLUDED.creator_address,
          registry_address = EXCLUDED.registry_address,
          max_supply = EXCLUDED.max_supply,
          mint_amount = EXCLUDED.mint_amount,
          mint_price_sats = EXCLUDED.mint_price_sats,
          confirmed = EXCLUDED.confirmed,
          created_height = COALESCE(EXCLUDED.created_height, proof_indexer.credit_definitions.created_height),
          metadata = EXCLUDED.metadata
      `,
      [
        NETWORK,
        item.tokenId,
        item.ticker,
        item.creatorAddress ?? null,
        item.registryAddress,
        String(item.maxSupply ?? 0),
        String(item.mintAmount ?? 0),
        bigintOrZero(item.mintPriceSats),
        item.txid ?? item.tokenId,
        status === "confirmed",
        numberOrNull(item.blockHeight ?? item.height),
        JSON.stringify(item),
      ],
    );
  }

  if (sourceLabel === "token-holders" && item?.tokenId && item?.address) {
    await client.query(
      `
        INSERT INTO proof_indexer.credit_balances (
          network,
          token_id,
          address,
          confirmed_balance,
          pending_delta,
          updated_at
        )
        VALUES ($1, $2, $3, $4, $5, now())
        ON CONFLICT (network, token_id, address)
        DO UPDATE SET
          confirmed_balance = EXCLUDED.confirmed_balance,
          pending_delta = EXCLUDED.pending_delta,
          updated_at = now()
      `,
      [
        NETWORK,
        item.tokenId,
        item.address,
        String(item.balance ?? item.confirmedBalance ?? 0),
        String(item.pendingDelta ?? item.pendingBalance ?? 0),
      ],
    );
  }

  const projectionKind = eventKind(item, sourceLabel);
  const projectsCreditListing =
    ["token-listings", "token-closed-listings", "token-sales"].includes(
      sourceLabel,
    ) ||
    projectionKind === "token-sale" ||
    projectionKind === "token-listing-closed" ||
    projectionKind === "closed-listing";
  if (projectsCreditListing && item?.listingId && item?.tokenId) {
    const projectedStatus = listingStatus(item, sourceLabel);
    const projectedPayload = creditListingProjectionPayload(item, projectedStatus);
    await client.query(
      `
        INSERT INTO proof_indexer.credit_listings (
          network,
          listing_id,
          token_id,
          status,
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
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14::jsonb, now())
        ON CONFLICT (network, listing_id)
        DO UPDATE SET
          status = EXCLUDED.status,
          seller_address = EXCLUDED.seller_address,
          buyer_address = EXCLUDED.buyer_address,
          amount = EXCLUDED.amount,
          price_sats = EXCLUDED.price_sats,
          sale_ticket_txid = EXCLUDED.sale_ticket_txid,
          sale_ticket_vout = EXCLUDED.sale_ticket_vout,
          sale_ticket_value_sats = EXCLUDED.sale_ticket_value_sats,
          seal_txid = EXCLUDED.seal_txid,
          close_txid = EXCLUDED.close_txid,
          payload = EXCLUDED.payload,
          updated_at = now()
      `,
      [
        NETWORK,
        item.listingId,
        item.tokenId,
        projectedStatus,
        item.sellerAddress ?? "",
        item.buyerAddress ?? null,
        String(item.amount ?? 0),
        bigintOrZero(item.priceSats),
        item.saleTicketTxid ?? item.saleAuthorization?.saleTicketTxid ?? null,
        numberOrNull(item.saleTicketVout ?? item.saleAuthorization?.saleTicketVout),
        bigintOrZero(item.saleTicketValueSats ?? item.saleAuthorization?.saleTicketValueSats),
        item.sealTxid ?? null,
        creditListingCloseTxid(item, projectedStatus, projectionKind, sourceLabel),
        JSON.stringify(projectedPayload),
      ],
    );
  }

  if (
    ["mail", "reply", "file", "attachment", "browser", INFINITY_BOND_KIND].includes(
      projectionKind,
    )
  ) {
    const txid = itemTxid(item);
    if (txid) {
      await client.query(
        `
          INSERT INTO proof_indexer.mail_items (
            network,
            txid,
            status,
            sender_address,
            subject,
            parent_txid,
            body_text,
            amount_sats,
            data_bytes,
            message,
            event_time
          )
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::jsonb, $11::timestamptz)
          ON CONFLICT (network, txid)
          DO UPDATE SET
            status = EXCLUDED.status,
            sender_address = COALESCE(EXCLUDED.sender_address, proof_indexer.mail_items.sender_address),
            subject = COALESCE(EXCLUDED.subject, proof_indexer.mail_items.subject),
            parent_txid = COALESCE(EXCLUDED.parent_txid, proof_indexer.mail_items.parent_txid),
            body_text = COALESCE(EXCLUDED.body_text, proof_indexer.mail_items.body_text),
            amount_sats = EXCLUDED.amount_sats,
            data_bytes = EXCLUDED.data_bytes,
            message = EXCLUDED.message,
            event_time = COALESCE(EXCLUDED.event_time, proof_indexer.mail_items.event_time)
        `,
        [
          NETWORK,
          txid,
          status,
          item.senderAddress ?? null,
          item.subject ?? null,
          item.parentTxid ?? null,
          mailItemBodyText(item),
          amountSats(item),
          dataBytes(item),
          JSON.stringify(item),
          itemTime(item),
        ],
      );
    }
  }
}

function listingStatus(item, sourceLabel) {
  const kind = eventKind(item, sourceLabel);
  if (item?.dropped) {
    return "dropped";
  }
  if (
    sourceLabel === "token-sales" ||
    kind === "token-sale" ||
    sourceLabel === "token-closed-listings" ||
    kind === "token-listing-closed" ||
    kind === "closed-listing"
  ) {
    if (
      item?.confirmed === false ||
      item?.closedConfirmed === false ||
      item?.closedListing?.closedConfirmed === false
    ) {
      return "pending";
    }
    if (item?.saleTxid || item?.buyerAddress) {
      return "sold";
    }
    return "delisted";
  }
  if (item?.sealTxid || item?.sealPending) {
    return "sealing";
  }
  return item?.confirmed === false ? "pending" : "active";
}

function creditListingCloseTxid(
  item,
  projectedStatus,
  projectionKind,
  sourceLabel,
) {
  const kind = eventKind(item, sourceLabel);
  const isSealProjection =
    projectionKind === "token-listing-sealed" ||
    kind === "token-listing-sealed";
  if (isSealProjection) {
    return null;
  }
  const direct =
    item?.closedTxid ?? item?.closeTxid ?? item?.closedListing?.closedTxid;
  if (isHexTxid(direct)) {
    return String(direct).toLowerCase();
  }
  const isCloseProjection =
    sourceLabel === "token-sales" ||
    projectionKind === "token-sale" ||
    sourceLabel === "token-closed-listings" ||
    projectionKind === "token-listing-closed" ||
    projectionKind === "closed-listing";
  if (isCloseProjection && isHexTxid(item?.txid)) {
    return String(item.txid).toLowerCase();
  }
  if (
    !["active", "pending"].includes(projectedStatus) &&
    isHexTxid(item?.txid)
  ) {
    return String(item.txid).toLowerCase();
  }
  return null;
}

function creditListingProjectionPayload(item, projectedStatus) {
  const payload = { ...(item ?? {}) };
  if (projectedStatus === "sold" || projectedStatus === "delisted") {
    payload.closedConfirmed = true;
  }
  if (
    projectedStatus === "pending" &&
    isHexTxid(payload.closedTxid ?? payload.closeTxid)
  ) {
    payload.closedConfirmed = false;
  }
  return payload;
}

function summaryNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}

function numericValue(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function summarySnapshotTotals(summaryPayloads = {}) {
  const workFloor =
    summaryPayloads.workFloor ??
    summaryPayloads.workSummary?.floor ??
    summaryPayloads.marketplaceSummary?.workFloor ??
    null;
  const growthSummary = summaryPayloads.growthSummary ?? null;
  const workNetworkValueSats = summaryNumber(
    workFloor?.networkValueSats ??
      workFloor?.actualValue?.networkValueSats ??
      workFloor?.actualValue?.totalSats,
  );
  const growthActualValueSats = summaryNumber(
    growthSummary?.actualValue?.totalSats ??
      growthSummary?.networkValueSats,
  );
  const growthWorkFloorValueSats = summaryNumber(
    growthSummary?.workFloor?.networkValueSats ??
      growthSummary?.workFloor?.actualValue?.totalSats,
  );
  return {
    growthActualValueSats,
    growthWorkFloorValueSats,
    workActualValueSats: workNetworkValueSats,
    workNetworkValueSats,
  };
}

function objectPayload(value) {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value
    : null;
}

function finiteSummaryNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function workFloorTotalSats(workFloor) {
  return finiteSummaryNumber(
    workFloor?.actualValue?.totalSats ?? workFloor?.networkValueSats,
  );
}

function workFloorLiveSats(workFloor, totalSats) {
  return finiteSummaryNumber(
    workFloor?.actualValue?.liveTotalSats ??
      workFloor?.actualValue?.liveNetworkValueSats ??
      workFloor?.liveNetworkValueSats ??
      totalSats,
  );
}

function workFloorFrozenSats(workFloor) {
  return finiteSummaryNumber(
    workFloor?.actualValue?.frozenTotalSats ??
      workFloor?.actualValue?.frozenNetworkValueSats ??
      workFloor?.frozenNetworkValueSats,
  );
}

function summaryPayloadSnapshotId(payload) {
  const id = String(
    payload?.snapshotId ??
      payload?.floor?.snapshotId ??
      payload?.workFloor?.snapshotId ??
      "",
  ).trim();
  return id || null;
}

function summaryPayloadValue(payload) {
  return finiteSummaryNumber(
    payload?.actualValue?.totalSats ??
      payload?.floor?.actualValue?.totalSats ??
      payload?.workFloor?.actualValue?.totalSats ??
      payload?.networkValueSats,
  );
}

function strongerSummaryPayload(basePayload, candidatePayload) {
  const base = objectPayload(basePayload);
  const candidate = objectPayload(candidatePayload);
  if (!base) {
    return candidate ?? basePayload;
  }
  if (!candidate) {
    return base;
  }

  const baseSnapshotId = summaryPayloadSnapshotId(base);
  const candidateSnapshotId = summaryPayloadSnapshotId(candidate);
  if (
    baseSnapshotId &&
    candidateSnapshotId &&
    baseSnapshotId !== candidateSnapshotId
  ) {
    return base;
  }

  const baseValue = summaryPayloadValue(base);
  const candidateValue = summaryPayloadValue(candidate);
  if (candidateValue === null) {
    return base;
  }
  if (baseValue === null || candidateValue > baseValue + 0.0001) {
    return candidate;
  }
  return base;
}

function strongerSummaryPayloads(basePayloads, candidatePayloads) {
  const base = objectPayload(basePayloads) ?? {};
  const candidate = objectPayload(candidatePayloads) ?? {};
  const next = { ...candidate };
  const keys = new Set([...Object.keys(base), ...Object.keys(candidate)]);
  for (const key of keys) {
    next[key] = strongerSummaryPayload(base[key], candidate[key]);
  }
  return next;
}

function ledgerConsistencyValue(payload) {
  return finiteSummaryNumber(
    payload?.totals?.workNetworkValueSats ??
      payload?.totals?.workActualValueSats ??
      payload?.totals?.growthActualValueSats,
  );
}

function strongerLedgerConsistencyPayload(basePayload, candidatePayload) {
  const base = objectPayload(basePayload);
  const candidate = objectPayload(candidatePayload);
  if (!base) {
    return candidate ?? basePayload;
  }
  if (!candidate) {
    return base;
  }
  if (
    base.snapshotId &&
    candidate.snapshotId &&
    base.snapshotId !== candidate.snapshotId
  ) {
    return base;
  }

  const baseValue = ledgerConsistencyValue(base);
  const candidateValue = ledgerConsistencyValue(candidate);
  if (candidateValue === null) {
    return base;
  }
  if (baseValue === null || candidateValue > baseValue + 0.0001) {
    return candidate;
  }
  const baseGeneratedAt = Date.parse(base.generatedAt ?? "");
  const candidateGeneratedAt = Date.parse(candidate.generatedAt ?? "");
  if (
    Number.isFinite(candidateGeneratedAt) &&
    (!Number.isFinite(baseGeneratedAt) ||
      candidateGeneratedAt > baseGeneratedAt)
  ) {
    return candidate;
  }
  return base;
}

function growthSummaryWithAlignedWorkFloor(growthSummary, workFloor) {
  const summary = objectPayload(growthSummary);
  const floor = objectPayload(workFloor);
  if (!summary || !floor) {
    return growthSummary;
  }

  const totalSats = workFloorTotalSats(floor);
  if (totalSats === null) {
    return { ...summary, workFloor: floor };
  }

  const liveSats = workFloorLiveSats(floor, totalSats);
  const frozenSats = workFloorFrozenSats(floor);
  const actualValue = {
    ...(objectPayload(summary.actualValue) ?? {}),
    networkValueSats: totalSats,
    totalSats,
  };
  if (liveSats !== null) {
    actualValue.liveNetworkValueSats = liveSats;
    actualValue.liveTotalSats = liveSats;
  }
  if (frozenSats !== null) {
    actualValue.frozenFloorSats = frozenSats / 21_000_000;
    actualValue.frozenNetworkValueSats = frozenSats;
    actualValue.frozenTotalSats = frozenSats;
  }
  const floorUsd = finiteSummaryNumber(floor?.actualValue?.totalUsd);
  if (floorUsd !== null) {
    actualValue.totalUsd = floorUsd;
  }

  return {
    ...summary,
    actualValue,
    frozenNetworkValueSats:
      frozenSats !== null ? frozenSats : summary.frozenNetworkValueSats,
    liveNetworkValueSats:
      liveSats !== null ? liveSats : summary.liveNetworkValueSats,
    networkValueSats: totalSats,
    workFloor: floor,
  };
}

function summaryPayloadsWithAlignedWorkFloor(summaryPayloads = {}) {
  const payloads = objectPayload(summaryPayloads) ?? {};
  const workFloor = objectPayload(payloads.workFloor);
  if (!workFloor) {
    return payloads;
  }

  const next = { ...payloads };
  if (objectPayload(next.workSummary)) {
    next.workSummary = {
      ...next.workSummary,
      floor: workFloor,
    };
  }
  if (objectPayload(next.growthSummary)) {
    next.growthSummary = growthSummaryWithAlignedWorkFloor(
      next.growthSummary,
      workFloor,
    );
  }
  if (objectPayload(next.marketplaceSummary)) {
    next.marketplaceSummary = {
      ...next.marketplaceSummary,
      workFloor: objectPayload(next.marketplaceSummary.workFloor) ?? workFloor,
    };
  }
  return next;
}

function newerIso(left, right) {
  const leftMs = Date.parse(left ?? "");
  const rightMs = Date.parse(right ?? "");
  if (!Number.isFinite(leftMs)) {
    return Number.isFinite(rightMs) ? right : left;
  }
  if (!Number.isFinite(rightMs)) {
    return left;
  }
  return rightMs > leftMs ? right : left;
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

function proofIndexPayloadIndexedThroughBlock(payload) {
  const height = Math.max(
    Number(payload?.indexedThroughBlock) || 0,
    Number(payload?.metrics?.indexedThroughBlock) || 0,
    Number(payload?.stats?.indexedThroughBlock) || 0,
    Number(payload?.token?.indexedThroughBlock) || 0,
    Number(payload?.floor?.indexedThroughBlock) || 0,
    Number(payload?.workFloor?.indexedThroughBlock) || 0,
  );
  return Number.isSafeInteger(height) && height > 0 ? height : 0;
}

function growthDeltaForProofIndexEvents(events) {
  const delta = {
    browserFlowSats: 0,
    browserSats: 0,
    computerEventFlowSats: 0,
    computerEventSats: 0,
    driveFlowSats: 0,
    driveSats: 0,
    idMarketplaceFeeSats: 0,
    idMarketplaceVolumeSats: 0,
    infinityBondFlowSats: 0,
    infinityBondSats: 0,
    mailFlowSats: 0,
    mailSats: 0,
    marketplaceFeeSats: 0,
    marketplaceFlowSats: 0,
    marketplaceMutationFeeSats: 0,
    marketplaceSaleVolumeSats: 0,
    marketplaceSats: 0,
    marketplaceVolumeSats: 0,
    tokenCreationFlowSats: 0,
    tokenMarketplaceFeeSats: 0,
    tokenMintFlowSats: 0,
    tokenSaleFlowSats: 0,
    tokenSaleVolumeSats: 0,
    tokenSats: 0,
    tokenTransferFlowSats: 0,
    totalSats: 0,
    walletFlowSats: 0,
    walletSats: 0,
  };
  const addScaled = (flowKey, satsKey, sats) => {
    delta[flowKey] += sats;
    delta[satsKey] += sats * GROWTH_VALUE_MULTIPLE;
    delta.totalSats += sats * GROWTH_VALUE_MULTIPLE;
  };

  for (const event of Array.isArray(events) ? events : []) {
    const kind = String(event?.kind ?? "");
    const sats = numericValue(event?.totalSats);
    if (sats <= 0) {
      continue;
    }

    if (kind === "mail" || kind === "reply") {
      addScaled("mailFlowSats", "mailSats", sats);
    } else if (kind === "file") {
      addScaled("driveFlowSats", "driveSats", sats);
    } else if (kind === INFINITY_BOND_KIND) {
      addScaled("infinityBondFlowSats", "infinityBondSats", sats);
    } else if (ID_MARKETPLACE_MUTATION_KINDS.has(kind)) {
      delta.idMarketplaceFeeSats += sats;
      delta.marketplaceFeeSats += sats;
      delta.marketplaceMutationFeeSats += sats;
      delta.marketplaceFlowSats += sats;
      delta.marketplaceSats += sats * GROWTH_VALUE_MULTIPLE;
      delta.totalSats += sats * GROWTH_VALUE_MULTIPLE;
    } else if (TOKEN_MARKETPLACE_MUTATION_KINDS.has(kind)) {
      delta.tokenMarketplaceFeeSats += sats;
      delta.marketplaceFeeSats += sats;
      delta.marketplaceMutationFeeSats += sats;
      delta.marketplaceFlowSats += sats;
      delta.marketplaceSats += sats * GROWTH_VALUE_MULTIPLE;
      delta.totalSats += sats * GROWTH_VALUE_MULTIPLE;
    } else if (kind === "token-create") {
      addScaled("tokenCreationFlowSats", "tokenSats", sats);
    } else if (kind === "token-mint") {
      addScaled("tokenMintFlowSats", "tokenSats", sats);
    } else if (kind === "token-transfer") {
      delta.tokenTransferFlowSats += sats;
      delta.walletFlowSats += sats;
      delta.walletSats += sats * GROWTH_VALUE_MULTIPLE;
      delta.totalSats += sats * GROWTH_VALUE_MULTIPLE;
    } else if (kind === "token-sale") {
      delta.tokenSaleFlowSats += sats;
      delta.tokenSaleVolumeSats += sats;
      delta.marketplaceSaleVolumeSats += sats;
      delta.marketplaceVolumeSats += sats;
      delta.marketplaceFlowSats += sats;
      delta.marketplaceSats += sats * GROWTH_VALUE_MULTIPLE;
      delta.totalSats += sats * GROWTH_VALUE_MULTIPLE;
    } else {
      addScaled("computerEventFlowSats", "computerEventSats", sats);
    }
  }

  return delta;
}

function actualValueWithProofIndexDelta(actualValue, delta) {
  const actual = { ...(objectPayload(actualValue) ?? {}) };
  const deltaTotalSats = numericValue(delta.totalSats);
  const previousTotalSats = numericValue(actual.totalSats);
  const previousLiveTotalSats = numericValue(
    actual.liveTotalSats ?? actual.liveNetworkValueSats ?? previousTotalSats,
  );
  for (const [key, value] of Object.entries(delta)) {
    if (key === "totalSats" || value === 0) {
      continue;
    }
    actual[key] = numericValue(actual[key]) + value;
  }
  actual.totalSats = previousTotalSats + deltaTotalSats;
  actual.networkValueSats = actual.totalSats;
  actual.liveTotalSats = previousLiveTotalSats + deltaTotalSats;
  actual.liveNetworkValueSats = actual.liveTotalSats;
  actual.liveFloorSats = actual.liveTotalSats / WORK_TOKEN_MAX_SUPPLY;
  const previousFrozenTotal = numericValue(
    actual.frozenTotalSats ?? actual.frozenNetworkValueSats,
  );
  if (previousFrozenTotal > 0) {
    actual.frozenTotalSats = previousFrozenTotal + deltaTotalSats;
    actual.frozenNetworkValueSats = actual.frozenTotalSats;
    actual.frozenFloorSats = actual.frozenTotalSats / WORK_TOKEN_MAX_SUPPLY;
  }
  return actual;
}

function workFloorWithProofIndexEventDelta(workFloor, deltaPayload) {
  const floor = objectPayload(workFloor);
  if (!floor) {
    return workFloor;
  }
  const indexedThroughBlock = Math.max(
    Number(floor.indexedThroughBlock) || 0,
    Number(deltaPayload.indexedThroughBlock) || 0,
    Number(deltaPayload.maxEventBlock) || 0,
  );
  const coveredWorkFloor = {
    ...floor,
    indexedAt: newerIso(floor.indexedAt, deltaPayload.indexedAt),
    indexedThroughBlock,
    source: mergedSourceLabel(floor.source, deltaPayload.source),
    stats: {
      ...(floor.stats ?? {}),
      confirmedComputerActions:
        numericValue(floor.stats?.confirmedComputerActions) +
        numericValue(deltaPayload.totalCount),
      indexedThroughBlock,
    },
  };
  if (numericValue(deltaPayload?.totalSats) <= 0) {
    return coveredWorkFloor;
  }

  const delta = growthDeltaForProofIndexEvents(deltaPayload.events);
  if (numericValue(delta.totalSats) <= 0) {
    return coveredWorkFloor;
  }
  const actualValue = actualValueWithProofIndexDelta(floor.actualValue, delta);
  return {
    ...coveredWorkFloor,
    actualValue,
    floorSats: actualValue.totalSats / WORK_TOKEN_MAX_SUPPLY,
    frozenFloorSats:
      numericValue(actualValue.frozenTotalSats) / WORK_TOKEN_MAX_SUPPLY,
    frozenNetworkValueSats: numericValue(actualValue.frozenTotalSats),
    liveFloorSats: actualValue.totalSats / WORK_TOKEN_MAX_SUPPLY,
    liveNetworkValueSats: actualValue.totalSats,
    networkValueSats: actualValue.totalSats,
  };
}

function growthSummaryWithProofIndexEventDelta(growthSummary, deltaPayload) {
  const summary = objectPayload(growthSummary);
  if (!summary) {
    return growthSummary;
  }
  const coveredWorkFloor = summary.workFloor
    ? workFloorWithProofIndexEventDelta(summary.workFloor, deltaPayload)
    : summary.workFloor;
  const indexedThroughBlock = Math.max(
    Number(summary.indexedThroughBlock) || 0,
    Number(coveredWorkFloor?.indexedThroughBlock) || 0,
    Number(deltaPayload.indexedThroughBlock) || 0,
    Number(deltaPayload.maxEventBlock) || 0,
  );
  const coveredGrowthSummary = {
    ...summary,
    indexedAt: newerIso(summary.indexedAt, deltaPayload.indexedAt),
    indexedThroughBlock,
    source: mergedSourceLabel(summary.source, deltaPayload.source),
    workFloor: coveredWorkFloor,
  };
  if (numericValue(deltaPayload?.totalSats) <= 0) {
    return coveredWorkFloor
      ? growthSummaryWithAlignedWorkFloor(coveredGrowthSummary, coveredWorkFloor)
      : coveredGrowthSummary;
  }

  const delta = growthDeltaForProofIndexEvents(deltaPayload.events);
  if (numericValue(delta.totalSats) <= 0) {
    return coveredWorkFloor
      ? growthSummaryWithAlignedWorkFloor(coveredGrowthSummary, coveredWorkFloor)
      : coveredGrowthSummary;
  }
  const actualValue = actualValueWithProofIndexDelta(summary.actualValue, delta);
  const nextGrowthSummary = {
    ...coveredGrowthSummary,
    actualValue,
    frozenNetworkValueSats: numericValue(actualValue.frozenTotalSats),
    liveNetworkValueSats: actualValue.totalSats,
    networkValueSats: actualValue.totalSats,
  };
  return coveredWorkFloor
    ? growthSummaryWithAlignedWorkFloor(nextGrowthSummary, coveredWorkFloor)
    : nextGrowthSummary;
}

async function proofIndexConfirmedValueEventsAfterBlock(client, blockHeight) {
  const indexedThroughBlock = await latestIndexedBlockHeight(client).catch(() => 0);
  const result = await client.query(
    `
      SELECT
        kind,
        COALESCE(sum(amount_sats), 0)::text AS total_sats,
        count(*)::integer AS event_count,
        max(block_height)::integer AS max_event_block,
        max(event_time) AS max_event_time
      FROM proof_indexer.events
      WHERE network = $1
        AND status = 'confirmed'
        AND valid IS DISTINCT FROM false
        AND block_height > $2
      GROUP BY kind
      ORDER BY kind
    `,
    [NETWORK, blockHeight],
  );
  const events = result.rows.map((row) => ({
    count: Number(row.event_count) || 0,
    kind: String(row.kind ?? ""),
    maxEventBlock: Number(row.max_event_block) || 0,
    totalSats: Number(row.total_sats) || 0,
  }));
  const totalCount = events.reduce((sum, event) => sum + event.count, 0);
  const totalSats = events.reduce((sum, event) => sum + event.totalSats, 0);
  const maxEventBlock = Math.max(
    0,
    ...events.map((event) => Number(event.maxEventBlock) || 0),
  );
  const maxEventTime = result.rows.reduce((latest, row) => {
    const value = row.max_event_time ? new Date(row.max_event_time).toISOString() : "";
    return newerIso(latest, value);
  }, "");

  return {
    events,
    indexedAt: newerIso(maxEventTime, new Date().toISOString()),
    indexedThroughBlock: Math.max(
      Number(indexedThroughBlock) || 0,
      Number(blockHeight) || 0,
      maxEventBlock,
    ),
    maxEventBlock,
    source: "proof-index-db-value-events",
    totalCount,
    totalSats,
  };
}

async function summaryPayloadWithProofIndexEventDelta(
  client,
  payload,
  key,
  deltaByBlock,
) {
  const item = objectPayload(payload);
  if (!item) {
    return payload;
  }
  const indexedThroughBlock = proofIndexPayloadIndexedThroughBlock(item);
  if (!indexedThroughBlock) {
    return payload;
  }
  if (!deltaByBlock.has(indexedThroughBlock)) {
    deltaByBlock.set(
      indexedThroughBlock,
      proofIndexConfirmedValueEventsAfterBlock(client, indexedThroughBlock),
    );
  }
  const deltaPayload = await deltaByBlock.get(indexedThroughBlock);
  if (!deltaPayload) {
    return payload;
  }

  let nextPayload = item;
  if (key === "workFloor") {
    nextPayload = workFloorWithProofIndexEventDelta(item, deltaPayload);
  } else if (key === "workSummary") {
    nextPayload = {
      ...item,
      floor: workFloorWithProofIndexEventDelta(item.floor, deltaPayload),
    };
  } else if (key === "growthSummary") {
    nextPayload = growthSummaryWithProofIndexEventDelta(item, deltaPayload);
  } else if (key === "marketplaceSummary") {
    nextPayload = {
      ...item,
      workFloor: workFloorWithProofIndexEventDelta(
        item.workFloor,
        deltaPayload,
      ),
    };
  } else {
    return payload;
  }

  const mergedIndexedThroughBlock = Math.max(
    proofIndexPayloadIndexedThroughBlock(nextPayload),
    proofIndexPayloadIndexedThroughBlock(deltaPayload),
    Number(deltaPayload.maxEventBlock) || 0,
  );
  return {
    ...nextPayload,
    indexedAt: newerIso(nextPayload.indexedAt, deltaPayload.indexedAt),
    indexedThroughBlock: mergedIndexedThroughBlock,
    source: mergedSourceLabel(nextPayload.source, deltaPayload.source),
  };
}

async function summaryPayloadsWithProofIndexEventDeltas(client, summaryPayloads = {}) {
  const payloads = objectPayload(summaryPayloads) ?? {};
  const next = { ...payloads };
  const deltaByBlock = new Map();
  for (const key of [
    "workFloor",
    "workSummary",
    "growthSummary",
    "marketplaceSummary",
  ]) {
    if (objectPayload(next[key])) {
      next[key] = await summaryPayloadWithProofIndexEventDelta(
        client,
        next[key],
        key,
        deltaByBlock,
      );
    }
  }
  return next;
}

async function fallbackLedgerSnapshotPayload(
  client,
  previousPayload,
  summaryPayloads,
  error,
) {
  const indexedThroughBlock =
    (await latestIndexedBlockHeight(client).catch(() => 0)) ||
    numberOrNull(previousPayload?.indexedThroughBlock) ||
    numberOrNull(previousPayload?.metrics?.indexedThroughBlock) ||
    0;
  const generatedAt = new Date().toISOString();
  const summaryHash = createHash("sha256")
    .update(JSON.stringify(summaryPayloads ?? {}))
    .digest("hex");
  const snapshotId = createHash("sha256")
    .update(
      JSON.stringify({
        indexedThroughBlock,
        network: NETWORK,
        summaryHash,
      }),
    )
    .digest("hex");
  const metrics = {
    ...(previousPayload?.metrics ?? {}),
    indexedThroughBlock,
  };
  return {
    checks: previousPayload?.checks ?? [],
    generatedAt,
    indexedThroughBlock,
    metrics,
    missingLogEvents: previousPayload?.missingLogEvents ?? [],
    network: NETWORK,
    ok: false,
    snapshotId,
    sourceHashes: {
      ...(previousPayload?.sourceHashes ?? {}),
      summarySnapshotFallback: summaryHash,
    },
    status: "summary-snapshot-fallback",
    totals: summarySnapshotTotals(summaryPayloads),
    warning: `Ledger consistency refresh failed: ${error?.message ?? String(error)}`,
  };
}

async function storeLedgerSnapshot(client, options = {}) {
  const includeDerivedSnapshots = options.includeDerivedSnapshots !== false;
  const tokenHistoryPayloads = {};
  const tokenStatePayloads = {};
  let payload = null;
  let ledgerSnapshotError = null;
  try {
    payload = await readJson(
      unpagedEndpoint("/api/v1/ledger-consistency", summarySnapshotSourceParams()),
    );
    if (REFRESH_SUMMARY_SNAPSHOT_SOURCES) {
      try {
        payload = strongerLedgerConsistencyPayload(
          payload,
          await readJson(unpagedEndpoint("/api/v1/ledger-consistency")),
        );
      } catch (error) {
        console.error(
          JSON.stringify({
            error: error?.message ?? String(error),
            phase: "ledger-snapshot-current",
          }),
        );
      }
    }
  } catch (error) {
    ledgerSnapshotError = error;
    console.error(
      JSON.stringify({
        error: error?.message ?? String(error),
        phase: "ledger-snapshot",
      }),
    );
  }
  const previousPayload = await storedLedgerSnapshotPayload(
    client,
    payload?.snapshotId ?? "",
  );
  const [activityPayload, registryHistoryPayloads, rawSummaryPayloads] =
    includeDerivedSnapshots
      ? await Promise.all([
          activitySnapshot(previousPayload),
          registryHistorySnapshots(),
          summarySnapshots(),
        ])
      : [
          previousPayload?.activityPayload ?? null,
          previousPayload?.registryHistoryPayloads ?? {},
          previousPayload?.summaryPayloads ?? {},
        ];
  let summaryPayloads = summaryPayloadsWithAlignedWorkFloor(rawSummaryPayloads);
  summaryPayloads = await summaryPayloadsWithProofIndexEventDeltas(
    client,
    summaryPayloads,
  );
  summaryPayloads = summaryPayloadsWithAlignedWorkFloor(
    strongerSummaryPayloads(previousPayload?.summaryPayloads, summaryPayloads),
  );
  if (!payload) {
    payload = await fallbackLedgerSnapshotPayload(
      client,
      previousPayload,
      summaryPayloads,
      ledgerSnapshotError,
    );
  }
  if (includeDerivedSnapshots) {
    for (const scope of TOKEN_HISTORY_SNAPSHOT_SCOPES) {
      try {
        const tokenSnapshot = await tokenHistorySnapshotsForScope(scope);
        tokenHistoryPayloads[scope.key] = tokenSnapshot.historyPayloads;
        tokenStatePayloads[scope.key] = tokenSnapshot.statePayload;
      } catch (error) {
        console.error(
          JSON.stringify({
            error: error?.message ?? String(error),
            phase: "token-history-snapshot",
            scope: scope.key,
          }),
        );
        tokenHistoryPayloads[scope.key] = {};
        tokenStatePayloads[scope.key] = {};
      }
    }
  }
  const indexedAt = new Date().toISOString();
  const basePayload =
    previousPayload && typeof previousPayload === "object" && !Array.isArray(previousPayload)
      ? previousPayload
      : {};
  const snapshotPayload = {
    ...basePayload,
    ...payload,
    ...(activityPayload
      ? {
          activityIndexedAt:
            activityPayload === previousPayload?.activityPayload
              ? previousPayload.activityIndexedAt ?? indexedAt
              : indexedAt,
          activityPayload,
        }
      : {}),
    ...(includeDerivedSnapshots
      ? {
          registryHistoryIndexedAt: indexedAt,
          registryHistoryPayloads,
          summaryPayloads,
          summaryPayloadsIndexedAt: indexedAt,
          tokenHistoryIndexedAt: indexedAt,
          tokenHistoryPayloads,
          tokenStatePayloads,
          tokenStatePayloadsIndexedAt: indexedAt,
        }
      : {}),
  };
  await client.query(
    `
      INSERT INTO proof_indexer.ledger_snapshots (
        network,
        snapshot_id,
        generated_at,
        indexed_through_block,
        source_hashes,
        metrics,
        consistency,
        payload
      )
      VALUES ($1, $2, COALESCE($3::timestamptz, now()), $4, $5::jsonb, $6::jsonb, $7::jsonb, $8::jsonb)
      ON CONFLICT (network, snapshot_id)
      DO UPDATE SET
        generated_at = EXCLUDED.generated_at,
        indexed_through_block = EXCLUDED.indexed_through_block,
        source_hashes = EXCLUDED.source_hashes,
        metrics = EXCLUDED.metrics,
        consistency = EXCLUDED.consistency,
        payload = EXCLUDED.payload
    `,
    [
      NETWORK,
      payload.snapshotId ?? "unknown",
      payload.generatedAt ?? null,
      numberOrNull(payload.indexedThroughBlock),
      JSON.stringify(payload.sourceHashes ?? {}),
      JSON.stringify(payload.metrics ?? {}),
      JSON.stringify({
        checks: payload.checks ?? [],
        missingLogEvents: payload.missingLogEvents ?? [],
        ok: payload.ok,
        status: payload.status,
      }),
      JSON.stringify(snapshotPayload),
    ],
  );
  return snapshotPayload;
}

async function repairStoredSummarySnapshot(client) {
  const previousPayload = await storedLedgerSnapshotPayload(client, "", {
    requireSummaryPayloads: true,
  });
  if (!objectPayload(previousPayload?.summaryPayloads)) {
    throw new Error("No stored summaryPayloads are available to repair.");
  }

  let summaryPayloads = summaryPayloadsWithAlignedWorkFloor(
    previousPayload.summaryPayloads,
  );
  summaryPayloads = await summaryPayloadsWithProofIndexEventDeltas(
    client,
    summaryPayloads,
  );
  summaryPayloads = summaryPayloadsWithAlignedWorkFloor(
    strongerSummaryPayloads(previousPayload.summaryPayloads, summaryPayloads),
  );

  const indexedAt = new Date().toISOString();
  const indexedThroughBlock = Math.max(
    numberOrNull(previousPayload.indexedThroughBlock) ?? 0,
    numberOrNull(previousPayload.metrics?.indexedThroughBlock) ?? 0,
    proofIndexPayloadIndexedThroughBlock(summaryPayloads.workFloor),
    proofIndexPayloadIndexedThroughBlock(summaryPayloads.workSummary),
    proofIndexPayloadIndexedThroughBlock(summaryPayloads.growthSummary),
    proofIndexPayloadIndexedThroughBlock(summaryPayloads.marketplaceSummary),
    await latestIndexedBlockHeight(client).catch(() => 0),
  );
  const summaryHash = createHash("sha256")
    .update(JSON.stringify(summaryPayloads))
    .digest("hex");
  const metrics = {
    ...(previousPayload.metrics ?? {}),
    indexedThroughBlock,
  };
  const snapshotPayload = {
    ...previousPayload,
    generatedAt: newerIso(previousPayload.generatedAt, indexedAt),
    indexedThroughBlock,
    metrics,
    sourceHashes: {
      ...(previousPayload.sourceHashes ?? {}),
      summarySnapshotDbRepair: summaryHash,
    },
    summaryPayloads,
    summaryPayloadsIndexedAt: indexedAt,
    totals: summarySnapshotTotals(summaryPayloads),
  };
  const snapshotId = String(snapshotPayload.snapshotId ?? "").trim();
  if (!snapshotId) {
    throw new Error("Stored ledger snapshot is missing snapshotId.");
  }

  await client.query(
    `
      UPDATE proof_indexer.ledger_snapshots
      SET
        generated_at = COALESCE($3::timestamptz, generated_at),
        indexed_through_block = $4,
        source_hashes = $5::jsonb,
        metrics = $6::jsonb,
        consistency = $7::jsonb,
        payload = $8::jsonb
      WHERE network = $1
        AND snapshot_id = $2
    `,
    [
      NETWORK,
      snapshotId,
      snapshotPayload.generatedAt ?? null,
      indexedThroughBlock || numberOrNull(previousPayload.indexedThroughBlock),
      JSON.stringify(snapshotPayload.sourceHashes ?? {}),
      JSON.stringify(metrics),
      JSON.stringify({
        checks: snapshotPayload.checks ?? [],
        missingLogEvents: snapshotPayload.missingLogEvents ?? [],
        ok: snapshotPayload.ok,
        status: snapshotPayload.status,
      }),
      JSON.stringify(snapshotPayload),
    ],
  );
  return snapshotPayload;
}

async function latestIndexedBlockHeight(client) {
  const result = await client.query(
    `
      SELECT COALESCE(max(block_height), 0) AS height
      FROM proof_indexer.transactions
      WHERE network = $1 AND status = 'confirmed'
    `,
    [NETWORK],
  );
  const height = Number(result.rows[0]?.height ?? 0);
  return Number.isSafeInteger(height) && height > 0 ? height : 0;
}

async function storeBlockScanSnapshot(client, payload) {
  const snapshotId = createHash("sha256")
    .update(
      JSON.stringify({
        indexedThroughBlock: payload.tipHeight,
        network: NETWORK,
        protocolTxids: payload.protocolTxids,
        source: "block-scan",
      }),
    )
    .digest("hex")
    .slice(0, 24);
  const generatedAt = new Date().toISOString();
  await client.query(
    `
      INSERT INTO proof_indexer.ledger_snapshots (
        network,
        snapshot_id,
        generated_at,
        indexed_through_block,
        source_hashes,
        metrics,
        consistency,
        payload
      )
      VALUES ($1, $2, $3::timestamptz, $4, $5::jsonb, $6::jsonb, $7::jsonb, $8::jsonb)
      ON CONFLICT (network, snapshot_id)
      DO UPDATE SET
        generated_at = EXCLUDED.generated_at,
        indexed_through_block = EXCLUDED.indexed_through_block,
        source_hashes = EXCLUDED.source_hashes,
        metrics = EXCLUDED.metrics,
        consistency = EXCLUDED.consistency,
        payload = EXCLUDED.payload
    `,
    [
      NETWORK,
      snapshotId,
      generatedAt,
      numberOrNull(payload.tipHeight),
      JSON.stringify({ blockScan: snapshotId }),
      JSON.stringify({
        indexed: payload.indexed,
        indexedThroughBlock: payload.tipHeight,
        protocolTxids: payload.protocolTxids,
        scannedBlocks: payload.scannedBlocks,
        skipped: payload.skipped,
      }),
      JSON.stringify({ ok: true, status: "block-scan" }),
      JSON.stringify({
        generatedAt,
        indexedThroughBlock: payload.tipHeight,
        network: NETWORK,
        snapshotId,
        source: "proof-indexer-block-scan",
      }),
    ],
  );
  return snapshotId;
}

async function backfillBlockScanSource(client, source) {
  if (!BITCOIN_RPC_URL) {
    console.error(
      JSON.stringify({
        error: "BITCOIN_RPC_URL is not configured",
        source: source.label,
      }),
    );
    return { indexed: 0, skipped: 0, source: source.label, txids: 0 };
  }

  const latestIndexedHeight = await latestIndexedBlockHeight(client);
  const tipHeight = Number(await bitcoinRpc("getblockcount"));
  if (!Number.isSafeInteger(tipHeight) || tipHeight <= latestIndexedHeight) {
    return {
      blocks: 0,
      indexed: 0,
      latestIndexedHeight,
      skipped: 0,
      source: source.label,
      tipHeight,
      txids: 0,
    };
  }

  const maxBlocks = Math.max(0, BLOCK_SCAN_MAX_BLOCKS);
  const firstHeight = Math.max(
    latestIndexedHeight + 1,
    maxBlocks > 0 ? tipHeight - maxBlocks + 1 : latestIndexedHeight + 1,
  );
  let indexed = 0;
  let protocolTxids = 0;
  let skipped = 0;
  let scannedBlocks = 0;

  for (let height = firstHeight; height <= tipHeight; height += 1) {
    const blockHash = await bitcoinRpc("getblockhash", [height]);
    const block = await bitcoinRpc("getblock", [blockHash, 2]);
    scannedBlocks += 1;
    let foundInBlock = 0;
    for (const tx of block?.tx ?? []) {
      const messages = protocolMessagesFromTx(tx);
      if (messages.length === 0) {
        continue;
      }
      protocolTxids += 1;
      foundInBlock += 1;
      try {
        await client.query("BEGIN");
        const result = await recoverProtocolTxid(
          client,
          await transactionWithInputPrevouts({ ...tx, blocktime: block?.time, height }),
          messages,
        );
        await client.query("COMMIT");
        indexed += result.indexed;
        skipped += result.skipped;
      } catch (error) {
        await client.query("ROLLBACK");
        skipped += 1;
        console.error(
          JSON.stringify({
            error: error?.message ?? String(error),
            phase: "block-scan",
            txid: tx.txid,
          }),
        );
      }
      if (protocolTxids >= BLOCK_SCAN_MAX_TXIDS) {
        break;
      }
    }
    if (foundInBlock > 0 || scannedBlocks % 25 === 0 || height === tipHeight) {
      console.log(
        JSON.stringify({
          foundInBlock,
          height,
          indexed,
          protocolTxids,
          scannedBlocks,
          skipped,
          source: source.label,
          tipHeight,
        }),
      );
    }
    if (protocolTxids >= BLOCK_SCAN_MAX_TXIDS) {
      break;
    }
  }

  const summary = {
    blocks: scannedBlocks,
    fromHeight: firstHeight,
    indexed,
    latestIndexedHeight,
    skipped,
    source: source.label,
    tipHeight,
    txids: protocolTxids,
  };
  await storeBlockScanSnapshot(client, {
    indexed,
    protocolTxids,
    scannedBlocks,
    skipped,
    tipHeight,
  });
  return summary;
}

async function backfillSource(client, source) {
  if (source.blockScan) {
    return backfillBlockScanSource(client, source);
  }

  if (source.addressMail) {
    return backfillAddressMailSource(client, source);
  }

  let cursor = "";
  let page = 0;
  let seen = 0;
  let skipped = 0;

  while (page < MAX_PAGES) {
    const url = endpoint(
      source.path,
      backfillSourceParams({ ...(source.params ?? {}), cursor }),
    );
    const payload = await readJson(url);
    const items = Array.isArray(payload.items) ? payload.items : [];

    await client.query("BEGIN");
    try {
      for (const item of items) {
        const result = await upsertEvent(client, source.label, item);
        if (result.skipped) {
          skipped += 1;
        } else {
          seen += 1;
        }
      }
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    }

    console.log(
      JSON.stringify({
        cursor: payload.cursor,
        indexed: seen,
        page,
        skipped,
        source: source.label,
        totalCount: payload.totalCount,
      }),
    );

    cursor = String(payload.nextCursor ?? "");
    page += 1;
    if (!cursor || items.length === 0) {
      break;
    }
  }

  return { indexed: seen, skipped, source: source.label };
}

async function addressMailBackfillAddresses(client) {
  const addresses = new Set([
    ...DEFAULT_MAIL_BACKFILL_ADDRESSES,
    ...CONFIGURED_MAIL_BACKFILL_ADDRESSES,
  ]);

  const remaining = Math.max(0, MAIL_BACKFILL_ADDRESS_LIMIT - addresses.size);
  if (remaining > 0) {
    const result = await client.query(
      `
        SELECT owner_address, receive_address
        FROM proof_indexer.id_records
        WHERE network = $1
        ORDER BY updated_at DESC NULLS LAST, display_id ASC
        LIMIT $2
      `,
      [NETWORK, remaining],
    );
    for (const row of result.rows) {
      if (row.owner_address) {
        addresses.add(row.owner_address);
      }
      if (row.receive_address) {
        addresses.add(row.receive_address);
      }
    }
  }

  return [...addresses].slice(0, Math.max(0, MAIL_BACKFILL_ADDRESS_LIMIT));
}

async function backfillAddressMailSource(client, source) {
  let seen = 0;
  let skipped = 0;
  const addresses = await addressMailBackfillAddresses(client);

  for (const [index, address] of addresses.entries()) {
    const payload = await readJson(
      endpoint(`/api/v1/address/${encodeURIComponent(address)}/mail`),
    ).catch((error) => {
      console.error(
        JSON.stringify({
          address,
          error: error?.message ?? String(error),
          source: source.label,
        }),
      );
      return null;
    });
    const items = addressMailPayloadEvents(payload, address);

    await client.query("BEGIN");
    try {
      for (const item of items) {
        const result = await upsertEvent(client, source.label, item);
        if (result.skipped) {
          skipped += 1;
        } else {
          seen += 1;
        }
      }
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    }

    console.log(
      JSON.stringify({
        address,
        indexed: seen,
        page: index,
        skipped,
        source: source.label,
        totalCount: items.length,
      }),
    );
  }

  return {
    addresses: addresses.length,
    indexed: seen,
    skipped,
    source: source.label,
  };
}

async function backfillScopedTokenHolders(client) {
  if (!INCLUDE_SCOPED_HOLDERS) {
    return { indexed: 0, skipped: 0, source: "token-holders" };
  }

  const tokenResult = await client.query(
    `
      SELECT token_id
      FROM proof_indexer.credit_definitions
      WHERE network = $1
      ORDER BY token_id
    `,
    [NETWORK],
  );
  let indexed = 0;
  let skipped = 0;
  let tokenCount = 0;

  for (const row of tokenResult.rows) {
    const tokenId = row.token_id;
    let cursor = "";
    let page = 0;

    while (page < MAX_PAGES) {
      const url = endpoint("/api/v1/token-history", {
        ...backfillSourceParams({
          asset: tokenId,
          cursor,
          kind: "holders",
        }),
      });
      const payload = await readJson(url);
      const items = Array.isArray(payload.items) ? payload.items : [];

      await client.query("BEGIN");
      try {
        for (const item of items) {
          if (item?.address) {
            await upsertProjection(
              client,
              "token-holders",
              { ...item, tokenId },
              "confirmed",
            );
            indexed += 1;
          } else {
            skipped += 1;
          }
        }
        await client.query("COMMIT");
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      }

      cursor = String(payload.nextCursor ?? "");
      page += 1;
      if (!cursor || items.length === 0) {
        break;
      }
    }

    tokenCount += 1;
    console.log(
      JSON.stringify({
        indexed,
        skipped,
        source: "token-holders",
        tokenCount,
        tokenId,
        totalTokens: tokenResult.rows.length,
      }),
    );
  }

  return { indexed, skipped, source: "token-holders", tokens: tokenResult.rows.length };
}

async function repairWorkMintMinterAttribution(client) {
  if (!REPAIR_MINT_MINTERS) {
    return { indexed: 0, skipped: 0, source: "repair-mint-minters" };
  }
  if (!BITCOIN_RPC_URL) {
    throw new Error("BITCOIN_RPC_URL is required for mint minter repair.");
  }

  const limit = Number.isFinite(REPAIR_MINT_MINTERS_LIMIT)
    ? Math.max(1, Math.floor(REPAIR_MINT_MINTERS_LIMIT))
    : 500;
  const result = await client.query(
    `
      SELECT DISTINCT ON (lower(e.txid))
        e.txid,
        COALESCE(e.payload->>'tokenId', cd.token_id) AS token_id
      FROM proof_indexer.events e
      LEFT JOIN proof_indexer.transactions t
        ON t.network = e.network
       AND t.txid = e.txid
      LEFT JOIN proof_indexer.credit_definitions cd
        ON cd.network = e.network
       AND cd.token_id = lower(e.payload->>'tokenId')
      WHERE e.network = $1
        AND e.valid IS DISTINCT FROM false
        AND e.kind = 'token-mint'
        AND COALESCE(t.status, e.status) = 'confirmed'
        AND (
          lower(e.payload->>'tokenId') = $2
          OR lower(cd.token_id) = $2
          OR lower(cd.ticker) = 'work'
        )
        AND COALESCE(
          NULLIF(e.payload->>'minterAddress', ''),
          NULLIF(e.payload->>'senderAddress', ''),
          NULLIF(e.payload->>'actor', ''),
          ''
        ) = ''
      ORDER BY
        lower(e.txid),
        COALESCE(e.block_time, t.block_time, e.event_time, t.confirmed_at, e.created_at) DESC
      LIMIT $3
    `,
    [NETWORK, WORK_TOKEN_ID, limit],
  );

  let indexed = 0;
  let skipped = 0;
  for (const row of result.rows) {
    const txid = String(row.txid ?? "").trim().toLowerCase();
    const tx = await rawTransactionFromCore(txid);
    if (!tx) {
      skipped += 1;
      continue;
    }
    const hydratedTx = await transactionWithInputPrevouts({
      ...tx,
      blocktime: tx.blocktime ?? tx.time,
      height: tx.blockheight ?? tx.height,
    });
    const messages = protocolMessagesFromTx(hydratedTx);
    const items = messages
      .flatMap((message) => protocolItemsFromTx(hydratedTx, message))
      .filter(
        (item) =>
          item?.kind === "token-mint" &&
          String(item?.tokenId ?? "").toLowerCase() === WORK_TOKEN_ID &&
          item?.minterAddress,
      );
    if (items.length === 0) {
      skipped += 1;
      continue;
    }

    try {
      await client.query("BEGIN");
      for (const item of items) {
        const upsert = await upsertEvent(
          client,
          sourceLabelForProtocolItem(item),
          item,
        );
        if (upsert.skipped) {
          skipped += 1;
        } else {
          indexed += 1;
        }
      }
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      skipped += 1;
      console.error(
        JSON.stringify({
          error: error?.message ?? String(error),
          phase: "repair-mint-minters",
          txid,
        }),
      );
    }
  }

  return {
    indexed,
    scanned: result.rows.length,
    skipped,
    source: "repair-mint-minters",
  };
}

if (DRY_RUN) {
  console.log(
    JSON.stringify(
      {
        apiBase: API_BASE,
        dryRun: true,
        maxPages: MAX_PAGES,
        network: NETWORK,
        pageLimit: PAGE_LIMIT,
        repairMintMinters: REPAIR_MINT_MINTERS,
        scopedHolders: INCLUDE_SCOPED_HOLDERS,
        sources: SOURCES.map((source) => source.label),
      },
      null,
      2,
    ),
  );
  process.exit(0);
}

const pool = createProofIndexPool({
  env: {
    ...process.env,
    POW_INDEX_DB_APP_NAME:
      process.env.POW_INDEX_DB_APP_NAME ?? "proof-indexer-backfill",
  },
});

try {
  const client = await pool.connect();
  try {
    if (DB_SUMMARY_REPAIR) {
      const snapshot = await repairStoredSummarySnapshot(client);
      console.log(
        JSON.stringify(
          {
            dbSummaryRepair: true,
            network: NETWORK,
            ok: true,
            snapshotId: snapshot.snapshotId,
            totals: summarySnapshotTotals(snapshot.summaryPayloads),
          },
          null,
          2,
        ),
      );
    } else {
      const results = [];
      for (const source of SOURCES) {
        results.push(await backfillSource(client, source));
      }
      results.push(await repairWorkMintMinterAttribution(client));
      results.push(await backfillScopedTokenHolders(client));
      const snapshot = await storeLedgerSnapshot(client);
      console.log(
        JSON.stringify(
          {
            apiBase: API_BASE,
            network: NETWORK,
            ok: true,
            results,
            snapshotId: snapshot.snapshotId,
          },
          null,
          2,
        ),
      );
    }
  } finally {
    client.release();
  }
} finally {
  await pool.end();
}
