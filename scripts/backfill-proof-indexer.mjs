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
const CANONICAL_SUMMARY_REFRESH_TIMEOUT_MS = Math.min(
  220_000,
  Math.max(
    30_000,
    Math.floor(
      Number(
        process.env.POW_INDEX_CANONICAL_SUMMARY_REFRESH_TIMEOUT_MS ?? 120_000,
      ) || 120_000,
    ),
  ),
);
const BITCOIN_RPC_TIMEOUT_MS = Math.min(
  30_000,
  Math.max(
    1_000,
    Math.floor(
      Number(process.env.POW_INDEX_BITCOIN_RPC_TIMEOUT_MS ?? 15_000) || 15_000,
    ),
  ),
);
const BITCOIN_RPC_RETRIES = Math.min(
  3,
  Math.max(
    0,
    Math.floor(Number(process.env.POW_INDEX_BITCOIN_RPC_RETRIES ?? 2) || 0),
  ),
);
const BITCOIN_RPC_URL = String(process.env.BITCOIN_RPC_URL ?? "").trim();
const BITCOIN_RPC_USER = String(process.env.BITCOIN_RPC_USER ?? "").trim();
const BITCOIN_RPC_PASSWORD = String(process.env.BITCOIN_RPC_PASSWORD ?? "").trim();
const INTERNAL_VERIFIER_TOKEN = String(
  process.env.POW_INTERNAL_VERIFIER_TOKEN ?? "",
).trim();
const REPAIR_MINT_MINTERS = /^(?:1|true|yes)$/iu.test(
  String(process.env.POW_INDEX_REPAIR_MINT_MINTERS ?? ""),
);
const REPAIR_MINT_MINTERS_LIMIT = Number(
  process.env.POW_INDEX_REPAIR_MINT_MINTERS_LIMIT ?? 500,
);
const REPAIR_WORK_PARTICIPANTS =
  process.argv.includes("--repair-work-participants") ||
  /^(?:1|true|yes)$/iu.test(
    String(process.env.POW_INDEX_REPAIR_WORK_PARTICIPANTS ?? ""),
  );
const REPAIR_WORK_PARTICIPANTS_ONLY = process.argv.includes(
  "--repair-work-participants",
);
const REPAIR_WORK_PARTICIPANTS_LIMIT = Number(
  process.env.POW_INDEX_REPAIR_WORK_PARTICIPANTS_LIMIT ?? 500,
);
const REPAIR_WORK_PARTICIPANTS_TXIDS = [
  ...new Set(
    String(process.env.POW_INDEX_REPAIR_WORK_PARTICIPANTS_TXIDS ?? "")
      .split(/[,\s]+/u)
      .map((value) => value.trim().toLowerCase())
      .filter((value) => /^[0-9a-f]{64}$/u.test(value)),
  ),
];
const REPAIR_ID_TXIDS = [
  ...new Set(
    String(process.env.POW_INDEX_REPAIR_ID_TXIDS ?? "")
      .split(/[,\s]+/u)
      .map((value) => value.trim().toLowerCase())
      .filter((value) => /^[0-9a-f]{64}$/u.test(value)),
  ),
];
const BLOCK_SCAN_MAX_BLOCKS = Number(
  process.env.POW_INDEX_BACKFILL_BLOCK_SCAN_MAX_BLOCKS ?? 2_000,
);
const BLOCK_SCAN_MAX_TXIDS = Number(
  process.env.POW_INDEX_BACKFILL_BLOCK_SCAN_MAX_TXIDS ?? 5_000,
);
const PREVOUT_HYDRATION_CONCURRENCY = Math.min(
  8,
  Math.max(
    1,
    Math.floor(
      Number(process.env.POW_INDEX_PREVOUT_HYDRATION_CONCURRENCY ?? 4) || 4,
    ),
  ),
);
const BLOCK_SCAN_FROM_HEIGHT = Number(
  process.env.POW_INDEX_BACKFILL_BLOCK_SCAN_FROM_HEIGHT ?? 0,
);
const CANONICAL_REBUILD = /^(?:1|true|yes)$/iu.test(
  String(process.env.POW_INDEX_BACKFILL_CANONICAL_REBUILD ?? ""),
);
const MEMPOOL_SCAN_MAX_TXIDS = Number(
  process.env.POW_INDEX_MEMPOOL_SCAN_MAX_TXIDS ?? 500,
);
const MEMPOOL_SCAN_MAX_PROTOCOL_TXIDS = Math.min(
  5,
  Math.max(
    1,
    Math.floor(
      Number(process.env.POW_INDEX_MEMPOOL_SCAN_MAX_PROTOCOL_TXIDS ?? 5) || 5,
    ),
  ),
);
const PENDING_VERIFIER_TIMEOUT_MS = Math.min(
  5_000,
  Math.max(
    1_000,
    Math.floor(
      Number(process.env.POW_INDEX_PENDING_VERIFIER_TIMEOUT_MS ?? 5_000) ||
        5_000,
    ),
  ),
);
const MEMPOOL_SCAN_SEEN_LIMIT = Number(
  process.env.POW_INDEX_MEMPOOL_SCAN_SEEN_LIMIT ?? 10_000,
);
// Only protocols with a canonical block-scan parser/verifier belong here.
// pwc1 is staged and pwr1 still relies on its separate ordered validator.
const PROTOCOL_PREFIXES = ["pwm1:", "pwid1:", "pwt1:"];
const MAIL_ATTACHMENT_MAX_BYTES = 60_000;
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
const PREPARE_CANONICAL_REBUILD_ONLY = process.argv.includes(
  "--prepare-canonical-rebuild",
);
const PREPARE_CANONICAL_PWT_RANGE_REPLAY_ONLY = process.argv.includes(
  "--prepare-canonical-pwt-range-replay",
);
const REPAIR_ID_TXIDS_ONLY = process.argv.includes("--repair-id-txids");

function assertCanonicalRebuildConfiguration() {
  if (
    PREPARE_CANONICAL_REBUILD_ONLY &&
    PREPARE_CANONICAL_PWT_RANGE_REPLAY_ONLY
  ) {
    throw new Error("Canonical full rebuild and PWT range replay are exclusive.");
  }
  if (
    REPAIR_ID_TXIDS_ONLY &&
    (PREPARE_CANONICAL_REBUILD_ONLY || PREPARE_CANONICAL_PWT_RANGE_REPLAY_ONLY)
  ) {
    throw new Error("Canonical ID repair and replay preparation are exclusive.");
  }
  if (REPAIR_ID_TXIDS_ONLY && REPAIR_ID_TXIDS.length === 0) {
    throw new Error(
      "--repair-id-txids requires POW_INDEX_REPAIR_ID_TXIDS with at least one transaction id",
    );
  }
  if (PREPARE_CANONICAL_REBUILD_ONLY && !CANONICAL_REBUILD) {
    throw new Error(
      "--prepare-canonical-rebuild requires POW_INDEX_BACKFILL_CANONICAL_REBUILD=1",
    );
  }
  if (PREPARE_CANONICAL_PWT_RANGE_REPLAY_ONLY) {
    if (
      CANONICAL_REBUILD ||
      NETWORK !== "livenet" ||
      !Number.isSafeInteger(BLOCK_SCAN_FROM_HEIGHT) ||
      BLOCK_SCAN_FROM_HEIGHT <= 0
    ) {
      throw new Error(
        "--prepare-canonical-pwt-range-replay requires NETWORK=livenet, canonical rebuild mode off, and an explicit positive POW_INDEX_BACKFILL_BLOCK_SCAN_FROM_HEIGHT",
      );
    }
    return;
  }
  if (!CANONICAL_REBUILD) {
    return;
  }
  if (
    NETWORK !== "livenet" ||
    !Number.isSafeInteger(BLOCK_SCAN_FROM_HEIGHT) ||
    BLOCK_SCAN_FROM_HEIGHT <= 0
  ) {
    throw new Error(
      "POW_INDEX_BACKFILL_CANONICAL_REBUILD=1 requires NETWORK=livenet and an explicit positive POW_INDEX_BACKFILL_BLOCK_SCAN_FROM_HEIGHT",
    );
  }
}

function validateCanonicalRebuildConfigurationAtStartup() {
  assertCanonicalRebuildConfiguration();
}

validateCanonicalRebuildConfigurationAtStartup();
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
  { label: "mempool-scan", mempoolScan: true },
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
const STORE_LEDGER_SNAPSHOT = (() => {
  const configured = String(
    process.env.POW_INDEX_BACKFILL_STORE_LEDGER_SNAPSHOT ?? "",
  ).trim();
  if (configured) {
    return /^(?:1|true|yes)$/iu.test(configured);
  }
  return SOURCES.some(
    (source) => !source.blockScan && !source.mempoolScan,
  );
})();
const STORE_CANONICAL_SUMMARY_SNAPSHOT = /^(?:1|true|yes)$/iu.test(
  String(process.env.POW_INDEX_BACKFILL_STORE_CANONICAL_SUMMARY_SNAPSHOT ?? ""),
);
const WORK_TOKEN_ID =
  "d4e5ebf11d104d6a63fb74e42094364b25a5f7199a09e5c0e71408972466a8b8";
const WORK_TOKEN_MAX_SUPPLY = 21_000_000;
const WORK_TOKEN_MINT_AMOUNT = 1_000;
const WORK_TOKEN_MINT_PRICE_SATS = 1_000;
const WORK_TOKEN_REGISTRY_ADDRESS = "1638Vn6KtmK8p5r4oGvAXq9nmZb1emU1DV";
const WORK_TOKEN_CREATED_AT = "2026-05-15T02:57:28.000Z";
const POWB_TOKEN_ID =
  "a3d0bc8528f91dfc52400a885bed7e49235396aa82aa9f95db41be629f1d5562";
const POWB_TOKEN_MAX_SUPPLY = Number.MAX_SAFE_INTEGER;
const POWB_REGISTRY_ID = "infinity";
const POWB_TOKEN_CREATED_AT = "2026-06-23T00:00:00.000Z";
const INCB_TOKEN_ID =
  "3cb25745f937f2b4e5508e5400189fe8fe679cd8e84bfa1e9176d70c9761f15d";
const INCB_TOKEN_MAX_SUPPLY = Number.MAX_SAFE_INTEGER;
const INCB_REGISTRY_ID = "inception";
const INCB_TOKEN_CREATED_AT = "2026-07-10T00:00:00.000Z";
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
const INCEPTION_BOND_MEMO = "incb";
const INCEPTION_BOND_KIND = "inception-bond";
const BOND_TAGS = [
  {
    createdAt: POWB_TOKEN_CREATED_AT,
    kind: INFINITY_BOND_KIND,
    label: "Infinity Bond",
    memo: INFINITY_BOND_MEMO,
    registryId: POWB_REGISTRY_ID,
    ticker: "POWB",
    tokenId: POWB_TOKEN_ID,
    tokenMaxSupply: POWB_TOKEN_MAX_SUPPLY,
  },
  {
    createdAt: INCB_TOKEN_CREATED_AT,
    kind: INCEPTION_BOND_KIND,
    label: "Inception Bond",
    memo: INCEPTION_BOND_MEMO,
    registryId: INCB_REGISTRY_ID,
    ticker: "INCB",
    tokenId: INCB_TOKEN_ID,
    tokenMaxSupply: INCB_TOKEN_MAX_SUPPLY,
  },
];
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
  { key: INCB_TOKEN_ID, params: { asset: INCB_TOKEN_ID } },
];
const REGISTRY_HISTORY_SNAPSHOT_KINDS = ["activity", "listings", "records", "sales"];
const SUMMARY_SNAPSHOT_SOURCES = [
  { key: "growthSummary", path: "/api/v1/growth-summary" },
  { key: "inceptionSummary", path: "/api/v1/inception-summary" },
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
    const timeoutMs = Number.isFinite(options.timeoutMs)
      ? Math.max(1, Number(options.timeoutMs))
      : REQUEST_TIMEOUT_MS;
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const internalVerifier = url.pathname.startsWith("/api/v1/internal/");
      const loopbackApi = ["127.0.0.1", "::1", "localhost"].includes(
        url.hostname.toLowerCase(),
      );
      if (internalVerifier && INTERNAL_VERIFIER_TOKEN.length < 32) {
        throw new Error(
          "POW_INTERNAL_VERIFIER_TOKEN is required for canonical verifier calls",
        );
      }
      const response = await fetch(url, {
        headers: loopbackApi && INTERNAL_VERIFIER_TOKEN.length >= 32
          ? { "X-PoW-Internal-Verifier": INTERNAL_VERIFIER_TOKEN }
          : undefined,
        signal: controller.signal,
      });
      if (response.status === 404 && options.allowNotFound === true) {
        return { items: [] };
      }
      if (!response.ok) {
        const responseText = await response.text().catch(() => "");
        const requestError = new Error(
          `${url.pathname} returned HTTP ${response.status}`,
        );
        requestError.statusCode = response.status;
        requestError.responseText = responseText;
        throw requestError;
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

async function bitcoinRpcOnce(method, params = []) {
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
  const timeout = setTimeout(() => controller.abort(), BITCOIN_RPC_TIMEOUT_MS);
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

async function bitcoinRpc(method, params = []) {
  let lastError = null;
  for (let attempt = 0; attempt <= BITCOIN_RPC_RETRIES; attempt += 1) {
    try {
      return await bitcoinRpcOnce(method, params);
    } catch (error) {
      lastError = error;
      if (attempt >= BITCOIN_RPC_RETRIES) {
        break;
      }
      const delayMs = Math.min(5_000, 250 * 2 ** attempt);
      console.error(
        JSON.stringify({
          attempt,
          delayMs,
          error: error?.message ?? String(error),
          method,
          phase: "bitcoin-rpc",
          retrying: true,
        }),
      );
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }
  throw lastError;
}

const RAW_TRANSACTION_CACHE = new Map();

async function rawTransactionFromCore(txid) {
  const normalizedTxid = String(txid ?? "").trim().toLowerCase();
  if (!isHexTxid(normalizedTxid) || !BITCOIN_RPC_URL) {
    return null;
  }
  if (!RAW_TRANSACTION_CACHE.has(normalizedTxid)) {
    const pending = bitcoinRpc("getrawtransaction", [normalizedTxid, true]).catch(
      (error) => {
        RAW_TRANSACTION_CACHE.delete(normalizedTxid);
        console.error(
          JSON.stringify({
            error: error?.message ?? String(error),
            phase: "raw-transaction-hydration",
            txid: normalizedTxid,
          }),
        );
        return null;
      },
    );
    RAW_TRANSACTION_CACHE.set(normalizedTxid, pending);
  }
  return RAW_TRANSACTION_CACHE.get(normalizedTxid);
}

async function boundedMapWithConcurrency(items, concurrency, mapper) {
  const values = Array.from(items ?? []);
  if (values.length === 0) {
    return [];
  }
  const results = new Array(values.length);
  let cursor = 0;
  const worker = async () => {
    while (cursor < values.length) {
      const index = cursor;
      cursor += 1;
      results[index] = await mapper(values[index], index);
    }
  };
  await Promise.all(
    Array.from(
      {
        length: Math.min(
          values.length,
          Math.max(1, Math.floor(Number(concurrency) || 1)),
        ),
      },
      worker,
    ),
  );
  return results;
}

function prevoutFromOutput(vout) {
  if (!vout || typeof vout !== "object") {
    return null;
  }
  const numericValue = Number(vout.value);
  if (!Number.isFinite(numericValue) || numericValue < 0) {
    return null;
  }
  const coreScript = vout?.scriptPubKey;
  const mempoolScriptHex = vout?.scriptpubkey;
  const explicitValueSats = Number(vout?.valueSats);
  const valueSats = Number.isSafeInteger(explicitValueSats) && explicitValueSats >= 0
    ? BigInt(explicitValueSats)
    : coreScript && typeof coreScript === "object"
      ? satsFromVoutValue(vout.value)
      : BigInt(Math.round(numericValue));
  if (valueSats > BigInt(Number.MAX_SAFE_INTEGER)) {
    return null;
  }
  const scriptHex =
    coreScript && typeof coreScript === "object"
      ? coreScript.hex
      : mempoolScriptHex;
  if (
    typeof scriptHex !== "string" ||
    scriptHex.length % 2 !== 0 ||
    !/^[0-9a-f]*$/iu.test(scriptHex)
  ) {
    return null;
  }
  return {
    scriptPubKey:
      coreScript && typeof coreScript === "object"
        ? coreScript
        : {
            address: String(vout?.scriptpubkey_address ?? ""),
            asm: String(vout?.scriptpubkey_asm ?? ""),
            hex: scriptHex,
            type: String(vout?.scriptpubkey_type ?? ""),
          },
    value: vout.value,
    valueSats: Number(valueSats),
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

  const previousTxids = [
    ...new Set(
      vin.flatMap((input) => {
        if (input?.prevout) {
          return [];
        }
        const prevTxid = String(input?.txid ?? "").trim().toLowerCase();
        const prevVout = Number(input?.vout);
        return isHexTxid(prevTxid) &&
          Number.isSafeInteger(prevVout) &&
          prevVout >= 0
          ? [prevTxid]
          : [];
      }),
    ),
  ];
  const previousTransactions = new Map(
    await boundedMapWithConcurrency(
      previousTxids,
      PREVOUT_HYDRATION_CONCURRENCY,
      async (prevTxid) => [prevTxid, await rawTransactionFromCore(prevTxid)],
    ),
  );

  const hydratedVin = vin.map((input) => {
    if (input?.prevout) {
      const prevout = prevoutFromOutput(input.prevout);
      return prevout ? { ...input, prevout } : input;
    }
    const prevTxid = String(input?.txid ?? "").trim().toLowerCase();
    const prevVout = Number(input?.vout);
    if (!isHexTxid(prevTxid) || !Number.isSafeInteger(prevVout) || prevVout < 0) {
      return input;
    }
    const previousOutput = previousTransactions.get(prevTxid)?.vout?.[prevVout];
    const prevout = prevoutFromOutput(previousOutput);
    return prevout ? { ...input, prevout } : input;
  });

  return { ...tx, vin: hydratedVin };
}

function assertHydratedProtocolTransaction(tx) {
  for (const [index, input] of (tx?.vin ?? []).entries()) {
    if (input?.coinbase) {
      continue;
    }
    const prevout = input?.prevout;
    const previousTxid = String(input?.txid ?? "").trim().toLowerCase();
    const previousVout = Number(input?.vout);
    const scriptHex = String(prevout?.scriptPubKey?.hex ?? "");
    if (
      !isHexTxid(previousTxid) ||
      !Number.isSafeInteger(previousVout) ||
      previousVout < 0 ||
      !prevout ||
      !Number.isSafeInteger(Number(prevout.valueSats)) ||
      Number(prevout.valueSats) < 0 ||
      scriptHex.length % 2 !== 0 ||
      !/^[0-9a-f]*$/iu.test(scriptHex) ||
      typeof prevout?.scriptPubKey?.hex !== "string"
    ) {
      throw new Error(
        `Canonical protocol transaction ${tx?.txid ?? "unknown"} input ${index} has no complete canonical prevout`,
      );
    }
  }
}

function assertCanonicalBlockEnvelope(block, height, blockHash) {
  const transactions = Array.isArray(block?.tx) ? block.tx : [];
  const returnedHash = String(block?.hash ?? "").trim().toLowerCase();
  if (
    returnedHash !== String(blockHash ?? "").trim().toLowerCase() ||
    Number(block?.height) !== height ||
    transactions.length === 0 ||
    Number(block?.nTx) !== transactions.length ||
    transactions.some((tx) => !isHexTxid(tx?.txid))
  ) {
    throw new Error(`Bitcoin Core returned an invalid block envelope at ${height}`);
  }
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
  for (const [voutIndex, vout] of (tx?.vout ?? []).entries()) {
    const text = opReturnTextFromVout(vout);
    const prefix = PROTOCOL_PREFIXES.find((candidate) =>
      text.startsWith(candidate),
    );
    if (prefix) {
      messages.push({ prefix, text, voutIndex });
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

function paymentOutputsBeforeProtocol(tx, protocolIndex) {
  return (tx?.vout ?? [])
    .filter((_vout, index) =>
      Number.isSafeInteger(Number(protocolIndex))
        ? index < Number(protocolIndex)
        : true,
    )
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

function normalizedPowId(value) {
  return String(value ?? "")
    .trim()
    .replace(/@proofofwork\.me$/iu, "")
    .toLowerCase();
}

function baseProtocolItem(tx, message, kind) {
  const payments = paymentOutputsBeforeProtocol(tx, message?.voutIndex);
  const amountSats = payments.reduce(
    (sum, output) => sum + output.amountSats,
    0n,
  );
  return {
    amountSats: amountSats.toString(),
    blockHeight: Number(tx?.status?.block_height ?? tx?.height ?? 0) || null,
    blockIndex: Number.isSafeInteger(Number(tx?._powBlockIndex))
      ? Number(tx._powBlockIndex)
      : undefined,
    blockTime: blockEventTime(tx),
    confirmed:
      Number(tx?.confirmations ?? 0) > 0 ||
      Number(tx?.status?.block_height ?? tx?.height ?? 0) > 0,
    dataBytes: Buffer.byteLength(message.text, "utf8"),
    kind,
    network: NETWORK,
    payload: message.text,
    protocol: message.prefix.replace(/:$/u, ""),
    protocolVout: Number(message?.voutIndex),
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

function decodedBase64UrlBytes(value) {
  const encoded = String(value ?? "");
  if (!/^[A-Za-z0-9_-]*$/u.test(encoded)) {
    return null;
  }
  try {
    const normalized = encoded.replace(/-/gu, "+").replace(/_/gu, "/");
    const padded = normalized.padEnd(
      Math.ceil(normalized.length / 4) * 4,
      "=",
    );
    return Buffer.from(padded, "base64");
  } catch {
    return null;
  }
}

function aggregatePwmProtocolItem(tx, messages) {
  const pwmMessages = messages.filter((message) => message?.prefix === "pwm1:");
  if (pwmMessages.length === 0) {
    return null;
  }

  let attachmentAccumulator = null;
  let attachmentMalformed = false;
  let parentTxid = "";
  let replyTo = "";
  let subject = "";
  const memoChunks = [];
  for (const message of pwmMessages) {
    const payload = String(message?.text ?? "").slice("pwm1:".length);
    if (payload.startsWith("s:")) {
      subject = decodeBase64UrlText(payload.slice(2)).trim();
      continue;
    }
    if (payload.startsWith("m:")) {
      memoChunks.push(payload.slice(2));
      continue;
    }
    if (/^r:[0-9a-f]{64}$/iu.test(payload)) {
      parentTxid = payload.slice(2).toLowerCase();
      continue;
    }
    if (payload.startsWith("f:")) {
      replyTo = payload.slice(2).trim();
      continue;
    }
    if (!payload.startsWith("a:")) {
      continue;
    }

    const parts = payload.split(":");
    const size = Number(parts[3]);
    const sha256 = String(parts[4] ?? "").toLowerCase();
    const part = String(parts[5] ?? "").match(/^(\d+)\/(\d+)$/u);
    const index = Number(part?.[1]);
    const total = Number(part?.[2]);
    const mime = decodeBase64UrlText(parts[1]).trim();
    const name = decodeBase64UrlText(parts[2]).trim();
    if (
      parts.length !== 7 ||
      !mime ||
      !name ||
      !Number.isSafeInteger(size) ||
      size <= 0 ||
      size > MAIL_ATTACHMENT_MAX_BYTES ||
      !/^[0-9a-f]{64}$/u.test(sha256) ||
      !part ||
      !Number.isSafeInteger(index) ||
      !Number.isSafeInteger(total) ||
      total < 1 ||
      index < 0 ||
      index >= total
    ) {
      attachmentMalformed = true;
      continue;
    }
    if (!attachmentAccumulator) {
      attachmentAccumulator = {
        chunks: Array.from({ length: total }, () => ""),
        mime,
        name,
        sha256,
        size,
        total,
      };
    }
    if (
      attachmentAccumulator.mime !== mime ||
      attachmentAccumulator.name !== name ||
      attachmentAccumulator.sha256 !== sha256 ||
      attachmentAccumulator.size !== size ||
      attachmentAccumulator.total !== total ||
      attachmentAccumulator.chunks[index]
    ) {
      attachmentMalformed = true;
      continue;
    }
    attachmentAccumulator.chunks[index] = parts[6];
  }

  let attachment;
  if (
    !attachmentMalformed &&
    attachmentAccumulator &&
    attachmentAccumulator.chunks.every(Boolean)
  ) {
    const data = attachmentAccumulator.chunks.join("");
    const bytes = decodedBase64UrlBytes(data);
    if (
      bytes &&
      bytes.byteLength === attachmentAccumulator.size &&
      createHash("sha256").update(bytes).digest("hex") ===
        attachmentAccumulator.sha256
    ) {
      attachment = {
        data,
        mime: attachmentAccumulator.mime,
        name: attachmentAccumulator.name,
        sha256: attachmentAccumulator.sha256,
        size: attachmentAccumulator.size,
      };
    }
  }

  const memo = memoChunks.join("");
  if (!memo && !subject && !parentTxid && !replyTo && !attachment) {
    return null;
  }
  const kind = attachment
    ? "file"
    : parentTxid
      ? "reply"
      : bondTagForMemo(memo)?.kind
        ? bondTagForMemo(memo).kind
        : "mail";
  return {
    ...baseProtocolItem(tx, pwmMessages[0], kind),
    ...(attachment ? { attachment } : {}),
    dataBytes: pwmMessages.reduce(
      (total, message) =>
        total + Buffer.byteLength(String(message?.text ?? ""), "utf8"),
      0,
    ),
    memo,
    ...(parentTxid ? { parentTxid } : {}),
    payload: pwmMessages.map((message) => message.text).join("\n"),
    ...(replyTo ? { replyTo } : {}),
    ...(subject ? { subject } : {}),
  };
}

function canonicalBondMintItemsFromMailItem(item) {
  const bondTag = bondTagForKind(item?.kind);
  if (!bondTag || item?.confirmed !== true) {
    return [];
  }
  return (Array.isArray(item?.recipients) ? item.recipients : []).flatMap(
    (recipient) => {
      const minterAddress = String(recipient?.address ?? "").trim();
      const amount = String(recipient?.amountSats ?? "").trim();
      if (!minterAddress || !/^[1-9]\d*$/u.test(amount)) {
        return [];
      }
      return [
        {
          amount,
          // The PWM event carries the bond proofs. The companion only projects
          // bond credit units and must never count the same proofs a second time.
          amountSats: 0,
          blockHeight: item.blockHeight,
          blockIndex: item.blockIndex,
          blockTime: item.blockTime,
          confirmed: true,
          dataBytes: 0,
          kind: "token-mint",
          minterAddress,
          network: item.network,
          protocol: "pwt1",
          sourceBondTxid: item.txid,
          ticker: bondTag.ticker,
          timestamp: item.timestamp,
          tokenId: bondTag.tokenId,
          txid: item.txid,
          valid: true,
          validationMode: `canonical-${bondTag.ticker.toLowerCase()}-bond-projection`,
        },
      ];
    },
  );
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
              : bondTagForMemo(memo)?.kind
                ? bondTagForMemo(memo).kind
                : "mail",
        ),
        memo,
        subject: action === "s" ? decodeBase64UrlText(parts[2]) : "",
      },
    ];
  }

  if (message.prefix === "pwid1:") {
    const base = baseProtocolItem(
      tx,
      message,
      action === "r" || action === "r2"
        ? "id-register"
        : action === "u"
          ? "id-update"
          : action === "t"
            ? "id-transfer"
            : `id-${action || "event"}`,
    );
    const id = normalizedPowId(
      action === "r" ? parts[2] : decodeBase64UrlText(parts[2]),
    );
    if (action === "r" || action === "r2") {
      const ownerAddress = String(parts[3] ?? "").trim();
      const receiveAddress = String(parts[4] ?? ownerAddress).trim();
      const pgpPublicKey = parts[5]
        ? decodeBase64UrlText(parts[5]).trim()
        : "";
      return [{
        ...base,
        id,
        ownerAddress,
        pgpPublicKey: pgpPublicKey || undefined,
        receiveAddress,
      }];
    }
    if (action === "u") {
      return [{
        ...base,
        id,
        receiveAddress: String(parts[3] ?? "").trim(),
      }];
    }
    if (action === "t") {
      const ownerAddress = String(parts[3] ?? "").trim();
      return [{
        ...base,
        id,
        ownerAddress,
        receiveAddress: String(parts[4] ?? ownerAddress).trim(),
      }];
    }
    if (action === "buy5") {
      const ownerAddress = String(parts[3] ?? "").trim();
      return [{
        ...base,
        kind: "id-buy",
        listingId: String(parts[2] ?? "").trim().toLowerCase(),
        ownerAddress,
        receiveAddress: String(parts[4] ?? ownerAddress).trim(),
        transferVersion: "buy5",
      }];
    }
    if (["list5", "seal5", "delist5"].includes(action)) {
      return [{
        ...base,
        kind:
          action === "list5"
            ? "id-list"
            : action === "seal5"
              ? "id-seal"
              : "id-delist",
        listingId: String(parts[2] ?? tx.txid ?? "").trim().toLowerCase(),
      }];
    }
    return [{ ...base, id }];
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

function rawProtocolItemsForTx(tx, messages) {
  const mailItem = aggregatePwmProtocolItem(tx, messages);
  const pwmMessages = messages.filter((message) => message?.prefix === "pwm1:");
  const invalidMailItem =
    pwmMessages.length > 0 && !mailItem
      ? invalidProtocolItem(
          {
            ...baseProtocolItem(tx, pwmMessages[0], "mail"),
            dataBytes: pwmMessages.reduce(
              (total, message) =>
                total + Buffer.byteLength(String(message?.text ?? ""), "utf8"),
              0,
            ),
            payload: pwmMessages.map((message) => message.text).join("\n"),
          },
          "Malformed or unknown aggregated PWM protocol payload.",
        )
      : null;
  return [
    ...(mailItem ? [mailItem] : []),
    ...(invalidMailItem ? [invalidMailItem] : []),
    ...canonicalBondMintItemsFromMailItem(mailItem),
    ...messages
      .filter((message) => ["pwid1:", "pwt1:"].includes(message?.prefix))
      .flatMap((message) => protocolItemsFromTx(tx, message)),
  ];
}

function sourceLabelForProtocolItem(item) {
  const kind = String(item?.kind ?? "").toLowerCase();
  if (kind.endsWith("-invalid")) {
    return kind.startsWith("token-") ? "token-invalid-events" : "log";
  }
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
  if (["id-register", "id-update", "id-transfer"].includes(kind)) {
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
    scopes.add("all");
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
  if (message.prefix === "pwid1:") {
    return [
      {
        label: "id-verifier",
        params: { txid },
        path: "/api/v1/internal/id-verifier",
      },
    ];
  }
  if (message.prefix === "pwt1:") {
    const action = String(message.text ?? "").split(":")[1]?.toLowerCase() ?? "";
    if (
      !["create", "mint", "send", "list5", "seal5", "delist5", "buy5"].includes(
        action,
      )
    ) {
      return [];
    }
    const scopes = tokenScopesForProtocolMessage(txid, message.text);
    return [{
      label: "token-verifier",
      params: { asset: scopes[0] ?? "all", txid },
      path: "/api/v1/internal/token-verifier",
    }];
  }
  return [];
}

function invalidProtocolItem(item, reason) {
  const kind = String(item?.kind ?? "event").toLowerCase();
  return {
    ...item,
    kind: kind.endsWith("-invalid") ? kind : `${kind}-invalid`,
    reason,
    valid: false,
  };
}

function disambiguateDuplicateProtocolItems(items) {
  const seen = new Map();
  return items.map((item, eventIndex) => {
    const key = [
      item?.protocol,
      item?.kind,
      item?.tokenId,
      item?.id,
      item?.parentTxid,
      item?.attachmentIndex,
    ]
      .map((value) => String(value ?? ""))
      .join(":")
      .toLowerCase();
    const ordinal = seen.get(key) ?? 0;
    seen.set(key, ordinal + 1);
    return ordinal === 0
      ? { ...item, _powEventIndex: eventIndex }
      : {
          ...item,
          _powEventIndex: eventIndex,
          eventKeyVout: ordinal,
        };
  });
}

function canonicalRecoveryItemMatchesTxid(item, txid) {
  return [
    item?.txid,
    item?.eventTxid,
    item?.lastEventTxid,
    item?.listingId,
    item?.closedTxid,
    item?.sealTxid,
    item?.saleTxid,
    item?.tokenId,
    item?.listing?.listingId,
    item?.sale?.txid,
    item?.closedListing?.closedTxid,
  ].some(
    (candidate) =>
      String(candidate ?? "").trim().toLowerCase() === txid,
  );
}

function canonicalKindForSourceLabel(sourceLabel, item) {
  const explicit = String(item?.kind ?? "").trim().toLowerCase();
  if (explicit) {
    return explicit;
  }
  return {
    tokens: "token-create",
    "token-mints": "token-mint",
    "token-transfers": "token-transfer",
    "token-listings": "token-listing",
    "token-closed-listings": "token-listing-closed",
    "token-sales": "token-sale",
    "token-invalid-events": "token-event-invalid",
  }[sourceLabel] ?? "";
}

function rawProtocolItemMatchesCanonical(rawItem, canonicalItem, kind) {
  const rawKind = String(rawItem?.kind ?? "").toLowerCase();
  if (
    rawKind !== kind &&
    !(kind === "token-listing" && rawKind.startsWith("token-listing")) &&
    !(
      kind.endsWith("-invalid") &&
      (rawKind.startsWith("token-") || rawKind.startsWith("id-"))
    )
  ) {
    return false;
  }
  for (const field of [
    "id",
    "tokenId",
    "listingId",
    "recipientAddress",
    "buyerAddress",
  ]) {
    const canonicalValue = String(canonicalItem?.[field] ?? "").trim();
    const rawValue = String(rawItem?.[field] ?? "").trim();
    if (canonicalValue && rawValue && canonicalValue !== rawValue) {
      return false;
    }
  }
  const canonicalAmount = String(canonicalItem?.amount ?? "").trim();
  const rawAmount = String(rawItem?.amount ?? "").trim();
  return !canonicalAmount || !rawAmount || canonicalAmount === rawAmount;
}

async function canonicalRecoveryItemsForTx(tx, messages) {
  const txid = String(tx?.txid ?? "").trim().toLowerCase();
  const specs = new Map();
  for (const message of messages) {
    for (const spec of recoveryEndpointSpecs(txid, message)) {
      const key = `${spec.label}:${spec.path}:${JSON.stringify(spec.params ?? {})}`;
      specs.set(key, spec);
    }
  }
  if (specs.size === 0) {
    return [];
  }

  const recovered = [];
  for (const spec of specs.values()) {
    const payload = await readJson(
      endpoint(spec.path, {
        ...(spec.params ?? {}),
        blockHash: Number(tx?.height ?? 0) > 0
          ? String(tx?._powBlockHash ?? "").trim().toLowerCase()
          : undefined,
        blockHeight: Number(tx?.height ?? 0) || undefined,
        confirmed: Number(tx?.height ?? 0) > 0 ? "1" : "0",
        fresh: "1",
        previousBlockHash: Number(tx?.height ?? 0) > 0
          ? String(tx?._powPreviousBlockHash ?? "").trim().toLowerCase()
          : undefined,
      }),
      {
        retries: 0,
        timeoutMs:
          Number(tx?.height ?? 0) > 0
            ? 30_000
            : PENDING_VERIFIER_TIMEOUT_MS,
      },
    );
    if (Number(tx?.height ?? 0) > 0) {
      const coverageHeight = Number(payload?.indexedThroughBlock ?? 0);
      const expectedBlockHash = String(tx?._powBlockHash ?? "")
        .trim()
        .toLowerCase();
      const expectedPreviousBlockHash = String(tx?._powPreviousBlockHash ?? "")
        .trim()
        .toLowerCase();
      const strictSource = String(payload?.source ?? "");
      const expectedSource = spec.path.endsWith("/id-verifier")
        ? "canonical-block-scan-db-core-id-verifier"
        : "canonical-block-scan-db-core-credit-verifier";
      if (
        !Number.isSafeInteger(coverageHeight) ||
        coverageHeight !== Number(tx.height) ||
        String(payload?.network ?? "") !== NETWORK ||
        String(payload?.txid ?? "").trim().toLowerCase() !== txid ||
        String(payload?.blockHash ?? "").trim().toLowerCase() !==
          expectedBlockHash ||
        String(payload?.previousBlockHash ?? "").trim().toLowerCase() !==
          expectedPreviousBlockHash ||
        strictSource !== expectedSource
      ) {
        throw new Error(
          `Canonical verifier coverage is unproven for ${txid} at block ${tx.height}`,
        );
      }
    }
    for (const item of Array.isArray(payload?.items) ? payload.items : []) {
      if (
        canonicalRecoveryItemMatchesTxid(item, txid) &&
        (Number(tx?.height ?? 0) <= 0 || item?.confirmed === true)
      ) {
        recovered.push({
          item: {
            ...item,
            canonicalVerifier: spec.path,
            validationMode: "canonical-first-party-state",
          },
          sourceLabel: spec.label,
        });
      }
    }
  }
  if (recovered.length === 0) {
    throw new Error(`Canonical verifier did not resolve protocol transaction ${txid}`);
  }

  const rawItems = disambiguateDuplicateProtocolItems(
    rawProtocolItemsForTx(tx, messages),
  );
  const usedRawItems = new Set();
  const normalizedRecovered = [];
  for (const recoveredItem of recovered) {
    const canonicalItem = recoveredItem.item;
    const kind = canonicalKindForSourceLabel(
      recoveredItem.sourceLabel,
      canonicalItem,
    );
    const rawIndex = rawItems.findIndex(
      (rawItem, index) =>
        !usedRawItems.has(index) &&
        rawProtocolItemMatchesCanonical(rawItem, canonicalItem, kind),
    );
    const rawItem = rawIndex >= 0 ? rawItems[rawIndex] : null;
    if (rawIndex >= 0) {
      usedRawItems.add(rawIndex);
    }
    const normalizedKind =
      String(canonicalItem?.kind ?? "").trim().toLowerCase() ||
      rawItem?.kind ||
      kind;
    if (!normalizedKind) {
      throw new Error(`Canonical verifier returned an untyped item for ${txid}`);
    }
    let normalizedAmountSats = canonicalItem?.amountSats;
    if (String(normalizedKind).startsWith("token-")) {
      if (normalizedKind === "token-sale") {
        // Sale volume is the seller price only. The sale-ticket anchor refund
        // is not revenue/value, and the 546 registry mutation is projected by
        // the closed-listing companion below.
        normalizedAmountSats = canonicalItem?.priceSats ?? 0;
      } else if (
        normalizedKind === "token-listing" ||
        normalizedKind === "token-listing-sealed" ||
        (normalizedKind === "token-listing-closed" && rawItem)
      ) {
        normalizedAmountSats = 546;
      } else if (normalizedKind === "token-listing-closed" && !rawItem) {
        // A buy produces a synthetic close companion for the registry fee.
        // The sale row carries only seller price; the 546 anchor refund is
        // intentionally excluded from both rows.
        normalizedAmountSats = 546;
      } else {
        normalizedAmountSats =
          canonicalItem?.amountSats ??
          canonicalItem?.paidSats ??
          canonicalItem?.creationFeeSats ??
          canonicalItem?.mutationFeeSats ??
          canonicalItem?.feeSats ??
          0;
      }
    }
    const normalizedItem = {
      ...(rawItem ?? {}),
      ...canonicalItem,
      amountSats: normalizedAmountSats,
      blockHeight:
        canonicalItem?.blockHeight ??
        canonicalItem?.closedBlockHeight ??
        rawItem?.blockHeight ??
        tx?.height,
      kind: normalizedKind,
      ownerAddress:
        canonicalItem?.ownerAddress ??
        rawItem?.ownerAddress ??
        (normalizedKind === "id-update" ? canonicalItem?.actor : undefined),
      protocol: rawItem?.protocol ?? canonicalItem?.protocol,
      txid,
    };
    normalizedRecovered.push({
      ...recoveredItem,
      item: normalizedItem,
      sourceLabel: sourceLabelForProtocolItem(normalizedItem),
    });
  }

  rawItems.forEach((rawItem, index) => {
    if (usedRawItems.has(index)) {
      return;
    }
    if (rawItem?.protocol === "pwm1") {
      normalizedRecovered.push({
        item: rawItem,
        sourceLabel: sourceLabelForProtocolItem(rawItem),
      });
      return;
    }
    if (String(rawItem?.validationMode ?? "").endsWith("-bond-projection")) {
      normalizedRecovered.push({
        item: rawItem,
        sourceLabel: sourceLabelForProtocolItem(rawItem),
      });
      return;
    }
    const invalidItem = invalidProtocolItem(
      rawItem,
      "The canonical first-party verifier rejected this protocol event.",
    );
    normalizedRecovered.push({
      item: invalidItem,
      sourceLabel: sourceLabelForProtocolItem(invalidItem),
    });
  });
  return normalizedRecovered;
}

async function preparedProtocolItemsForTx(tx, messages) {
  const recovered = await canonicalRecoveryItemsForTx(tx, messages);
  if (recovered.length > 0) {
    return recovered;
  }
  return disambiguateDuplicateProtocolItems(
    rawProtocolItemsForTx(tx, messages),
  ).map((item) => {
    const statefulUnknown =
      (item?.protocol === "pwt1" || item?.protocol === "pwid1") &&
      !String(item?.validationMode ?? "").endsWith("-bond-projection");
    const normalizedItem = statefulUnknown
      ? invalidProtocolItem(item, "Unknown or malformed stateful protocol action.")
      : item;
    return {
      item: normalizedItem,
      sourceLabel: sourceLabelForProtocolItem(normalizedItem),
    };
  });
}

async function persistPreparedProtocolItems(client, preparedItems) {
  let indexed = 0;
  let skipped = 0;
  for (const prepared of preparedItems) {
    const item = prepared.item ?? prepared;
    const sourceLabel =
      prepared.sourceLabel ?? sourceLabelForProtocolItem(item);
    const result = await upsertEvent(client, sourceLabel, item);
    if (result.skipped) {
      skipped += 1;
    } else {
      indexed += 1;
    }
    const bondTag = BOND_TAGS.find(
      (candidate) =>
        String(item?.id ?? "").trim().toLowerCase() === candidate.registryId,
    );
    if (
      bondTag &&
      String(item?.kind ?? "").startsWith("id-") &&
      item?.confirmed !== false
    ) {
      await seedCanonicalBondDefinition(client, bondTag);
    }
  }
  return { indexed, skipped };
}

async function upsertCanonicalSyntheticCreditDefinition(client, definition) {
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
      VALUES ($1, $2, $3, NULLIF($4, ''), $5, $6, $7, $8, $2, true, NULL, $9::jsonb)
      ON CONFLICT (network, token_id)
      DO UPDATE SET
        ticker = EXCLUDED.ticker,
        creator_address = EXCLUDED.creator_address,
        registry_address = EXCLUDED.registry_address,
        max_supply = EXCLUDED.max_supply,
        mint_amount = EXCLUDED.mint_amount,
        mint_price_sats = EXCLUDED.mint_price_sats,
        confirmed = true,
        metadata = EXCLUDED.metadata
    `,
    [
      NETWORK,
      definition.tokenId,
      definition.ticker,
      definition.creatorAddress ?? "",
      definition.registryAddress,
      String(definition.maxSupply),
      String(definition.mintAmount),
      String(definition.mintPriceSats),
      JSON.stringify({
        ...definition,
        canonicalSynthetic: true,
        confirmed: true,
        network: NETWORK,
        txid: definition.tokenId,
      }),
    ],
  );
}

async function seedCanonicalWorkDefinition(client) {
  await upsertCanonicalSyntheticCreditDefinition(client, {
    createdAt: WORK_TOKEN_CREATED_AT,
    creationFeeSats: 546,
    creatorAddress: "",
    dataBytes: 70,
    maxSupply: WORK_TOKEN_MAX_SUPPLY,
    mintAmount: WORK_TOKEN_MINT_AMOUNT,
    mintPriceSats: WORK_TOKEN_MINT_PRICE_SATS,
    registryAddress: WORK_TOKEN_REGISTRY_ADDRESS,
    ticker: "WORK",
    tokenId: WORK_TOKEN_ID,
  });
}

async function seedCanonicalPowbDefinition(client, options = {}) {
  return seedCanonicalBondDefinition(
    client,
    BOND_TAGS.find((tag) => tag.tokenId === POWB_TOKEN_ID),
    options,
  );
}

async function seedCanonicalIncbDefinition(client, options = {}) {
  return seedCanonicalBondDefinition(
    client,
    BOND_TAGS.find((tag) => tag.tokenId === INCB_TOKEN_ID),
    options,
  );
}

async function seedCanonicalBondDefinitions(client, options = {}) {
  const results = [];
  for (const bondTag of BOND_TAGS) {
    results.push(await seedCanonicalBondDefinition(client, bondTag, options));
  }
  return results.every(Boolean);
}

async function seedCanonicalBondDefinition(client, bondTag, options = {}) {
  if (!bondTag) {
    return false;
  }
  const result = await client.query(
    `
      SELECT owner_address, receive_address
      FROM proof_indexer.id_records
      WHERE network = $1
        AND id_lower = $2
      LIMIT 1
    `,
    [NETWORK, bondTag.registryId],
  );
  const row = result.rows[0];
  const registryAddress = String(
    row?.receive_address ?? row?.owner_address ?? "",
  ).trim();
  if (!registryAddress) {
    if (options.required === true) {
      throw new Error(
        `Canonical rebuild cannot publish ${bondTag.ticker} without the confirmed ${bondTag.registryId} ID receiver`,
      );
    }
    return false;
  }
  await upsertCanonicalSyntheticCreditDefinition(client, {
    createdAt: bondTag.createdAt,
    creationFeeSats: 0,
    creatorAddress: registryAddress,
    dataBytes: 0,
    maxSupply: bondTag.tokenMaxSupply,
    mintAmount: 1,
    mintPriceSats: 1,
    registryAddress,
    ticker: bondTag.ticker,
    tokenId: bondTag.tokenId,
    uncapped: true,
  });
  return true;
}

async function rebuildConfirmedCreditBalancesFromCanonicalEvents(client) {
  const integerAmount = (value, label) => {
    if (typeof value === "bigint") {
      if (value > 0n) return value;
      throw new Error(`${label} must be a positive integer`);
    }
    if (typeof value === "number") {
      if (Number.isSafeInteger(value) && value > 0) return BigInt(value);
      throw new Error(`${label} must be a positive safe integer`);
    }
    const text = String(value ?? "").trim();
    if (!/^[1-9]\d*$/u.test(text)) {
      throw new Error(`${label} must be a positive integer`);
    }
    return BigInt(text);
  };
  const nonnegativeInteger = (value, label) => {
    const text = String(value ?? "0").trim();
    if (!/^\d+$/u.test(text)) {
      throw new Error(`${label} must be a non-negative integer`);
    }
    return BigInt(text);
  };
  const normalizedAddress = (value, label) => {
    const address = String(value ?? "").trim();
    if (!address) {
      throw new Error(`${label} is missing`);
    }
    return address;
  };

  const definitionsResult = await client.query(
    `
      SELECT token_id, max_supply, metadata
      FROM proof_indexer.credit_definitions
      WHERE network = $1
        AND confirmed = true
    `,
    [NETWORK],
  );
  const definitions = new Map(
    definitionsResult.rows.map((row) => [
      String(row.token_id ?? "").trim().toLowerCase(),
      {
        maxSupply: nonnegativeInteger(
          row.max_supply,
          `credit ${row.token_id} max supply`,
        ),
        uncapped: row?.metadata?.uncapped === true,
      },
    ]),
  );
  const eventsResult = await client.query(
    `
      SELECT
        e.event_id,
        e.event_key,
        e.txid,
        e.kind,
        COALESCE(e.block_height, t.block_height) AS canonical_block_height,
        e.payload
      FROM proof_indexer.events e
      LEFT JOIN proof_indexer.transactions t
        ON t.network = e.network
       AND t.txid = e.txid
      WHERE e.network = $1
        AND e.protocol = 'pwt1'
        AND e.valid = true
        AND COALESCE(t.status, e.status) = 'confirmed'
        AND e.kind IN ('token-mint', 'token-transfer', 'token-sale')
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
        e.event_key ASC
    `,
    [NETWORK],
  );
  const existingResult = await client.query(
    `
      SELECT token_id, COALESCE(sum(confirmed_balance), 0) AS confirmed_supply
      FROM proof_indexer.credit_balances
      WHERE network = $1
      GROUP BY token_id
    `,
    [NETWORK],
  );
  const existingSupply = new Map(
    existingResult.rows.map((row) => [
      String(row.token_id ?? "").trim().toLowerCase(),
      nonnegativeInteger(
        row.confirmed_supply,
        `credit ${row.token_id} stored supply`,
      ),
    ]),
  );
  const balancesByToken = new Map();
  const mintedByToken = new Map();
  const balanceMap = (tokenId) => {
    if (!balancesByToken.has(tokenId)) {
      balancesByToken.set(tokenId, new Map());
    }
    return balancesByToken.get(tokenId);
  };
  const addBalance = (tokenId, address, delta, eventLabel) => {
    const balances = balanceMap(tokenId);
    const next = (balances.get(address) ?? 0n) + delta;
    if (next < 0n) {
      throw new Error(
        `Canonical credit replay would make ${tokenId}:${address} negative at ${eventLabel}`,
      );
    }
    balances.set(address, next);
  };

  const orderedEvents = [...eventsResult.rows].sort(
    (left, right) =>
      Number(left.canonical_block_height ?? 0) -
        Number(right.canonical_block_height ?? 0) ||
      Number(left?.payload?.blockIndex ?? Number.MAX_SAFE_INTEGER) -
        Number(right?.payload?.blockIndex ?? Number.MAX_SAFE_INTEGER) ||
      Number(left?.payload?._powEventIndex ?? Number.MAX_SAFE_INTEGER) -
        Number(right?.payload?._powEventIndex ?? Number.MAX_SAFE_INTEGER) ||
      String(left.event_key ?? "").localeCompare(String(right.event_key ?? "")),
  );
  for (const row of orderedEvents) {
    const payload =
      row?.payload && typeof row.payload === "object" && !Array.isArray(row.payload)
        ? row.payload
        : {};
    if (
      !Number.isSafeInteger(Number(row.canonical_block_height)) ||
      Number(row.canonical_block_height) < 0 ||
      !Number.isSafeInteger(Number(payload.blockIndex)) ||
      Number(payload.blockIndex) < 0 ||
      !Number.isSafeInteger(Number(payload._powEventIndex)) ||
      Number(payload._powEventIndex) < 0
    ) {
      throw new Error(
        `Canonical credit event ${row.txid ?? row.event_key ?? row.event_id} is missing block/event order`,
      );
    }
    const tokenId = String(payload.tokenId ?? "").trim().toLowerCase();
    const eventLabel = `${row.kind}:${row.txid ?? row.event_key ?? row.event_id}`;
    if (!/^[0-9a-f]{64}$/u.test(tokenId) || !definitions.has(tokenId)) {
      throw new Error(`Canonical credit event ${eventLabel} has no confirmed definition`);
    }
    const amount = integerAmount(payload.amount, `${eventLabel} amount`);
    if (row.kind === "token-mint") {
      const minter = normalizedAddress(
        payload.minterAddress,
        `${eventLabel} minter`,
      );
      mintedByToken.set(tokenId, (mintedByToken.get(tokenId) ?? 0n) + amount);
      addBalance(tokenId, minter, amount, eventLabel);
      continue;
    }
    const sender = normalizedAddress(
      row.kind === "token-sale" ? payload.sellerAddress : payload.senderAddress,
      `${eventLabel} sender`,
    );
    const recipient = normalizedAddress(
      row.kind === "token-sale" ? payload.buyerAddress : payload.recipientAddress,
      `${eventLabel} recipient`,
    );
    addBalance(tokenId, sender, -amount, eventLabel);
    addBalance(tokenId, recipient, amount, eventLabel);
  }

  for (const [tokenId, balances] of balancesByToken) {
    const minted = mintedByToken.get(tokenId) ?? 0n;
    const definition = definitions.get(tokenId);
    if (
      !definition.uncapped &&
      definition.maxSupply > 0n &&
      minted > definition.maxSupply
    ) {
      throw new Error(
        `Canonical credit replay supply ${minted} exceeds ${tokenId} max ${definition.maxSupply}`,
      );
    }
    const replayedSupply = [...balances.values()].reduce(
      (total, balance) => total + balance,
      0n,
    );
    if (replayedSupply !== minted) {
      throw new Error(
        `Canonical credit replay supply mismatch for ${tokenId}: balances ${replayedSupply}, mints ${minted}`,
      );
    }
    const storedSupply = existingSupply.get(tokenId) ?? 0n;
    if (storedSupply > minted) {
      throw new Error(
        `Canonical credit replay for ${tokenId} is incomplete: stored ${storedSupply}, replayed ${minted}`,
      );
    }
  }

  const tokenIds = [...balancesByToken.keys()].sort();
  if (tokenIds.length === 0) {
    return { holders: 0, tokens: 0 };
  }
  await client.query(
    `
      DELETE FROM proof_indexer.credit_balances
      WHERE network = $1
        AND token_id = ANY($2::text[])
    `,
    [NETWORK, tokenIds],
  );
  let holders = 0;
  for (const tokenId of tokenIds) {
    const balances = balancesByToken.get(tokenId);
    for (const [address, balance] of [...balances.entries()].sort((left, right) =>
      left[0].localeCompare(right[0]),
    )) {
      if (balance === 0n) {
        continue;
      }
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
          VALUES ($1, $2, $3, $4, 0, now())
        `,
        [NETWORK, tokenId, address, balance.toString()],
      );
      holders += 1;
    }
  }
  return { holders, tokens: tokenIds.length };
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
  const kind = String(item?.kind ?? item?.action ?? "").toLowerCase();
  if (kind === "token-listing-sealed" && item?.sealAt) {
    return item.sealAt;
  }
  if (kind === "token-listing-closed" && item?.closedAt) {
    return item.closedAt;
  }
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

function bondTagForMemo(value) {
  const memo = normalizedLowerText(value);
  return BOND_TAGS.find((tag) => tag.memo === memo) ?? null;
}

function bondTagForKind(value) {
  const kind = normalizedLowerText(value);
  return BOND_TAGS.find((tag) => tag.kind === kind) ?? null;
}

function bondTagForItem(item, kind = rawEventKind(item)) {
  const direct = bondTagForKind(kind);
  if (direct) {
    return direct;
  }
  if (kind !== "mail") {
    return null;
  }
  for (const value of [item?.detail, item?.memo, item?.body, item?.message]) {
    const tag = bondTagForMemo(value);
    if (tag) {
      return tag;
    }
  }
  return null;
}

function isInfinityBondMemoText(value) {
  return bondTagForMemo(value)?.kind === INFINITY_BOND_KIND;
}

function isInfinityBondItem(item, kind = rawEventKind(item)) {
  return bondTagForItem(item, kind)?.kind === INFINITY_BOND_KIND;
}

function stableEventKeyKind(item, kind, fallback) {
  const rawKind = rawEventKind(item, fallback);
  return bondTagForItem(item, rawKind)?.kind ?? bondTagForKind(kind)?.kind ?? kind;
}

function normalizedBondTags(tags, bondTag) {
  const bondLabels = new Set(BOND_TAGS.map((tag) => tag.label.toLowerCase()));
  const normalized = [];
  for (const tag of Array.isArray(tags) ? tags : []) {
    const value = normalizedText(tag);
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

function normalizedBondTitle(item, status, bondTag) {
  const title = normalizedText(item?.title);
  if (title && !/^(?:mail|message)\b/iu.test(title)) {
    return title;
  }
  return `${bondTag.label} ${status === "confirmed" ? "sent" : "pending"}`;
}

function normalizedEventItem(item, kind, status) {
  const bondTag = bondTagForKind(kind);
  if (!bondTag) {
    return item;
  }
  return {
    ...item,
    detail: normalizedText(item?.detail) || bondTag.memo,
    kind: bondTag.kind,
    tags: normalizedBondTags(item?.tags, bondTag),
    title: normalizedBondTitle(item, status, bondTag),
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

async function currentSummarySnapshots() {
  const payloads = {};
  for (const source of SUMMARY_SNAPSHOT_SOURCES) {
    try {
      payloads[source.key] = await readJson(unpagedEndpoint(source.path));
    } catch (error) {
      console.error(
        JSON.stringify({
          error: error?.message ?? String(error),
          phase: "summary-snapshot-current-only",
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
  if (!REFRESH_ACTIVITY_SNAPSHOT && objectPayload(previousPayload?.activityPayload)) {
    return previousPayload.activityPayload;
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
  return bondTagForItem(item, kind)?.kind ?? kind;
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
    ["mail", "reply", "file", "attachment", "browser"].includes(kind) ||
    Boolean(bondTagForKind(kind))
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
    ["mail", "reply", "file", "attachment", "browser"].includes(explicit) ||
    Boolean(bondTagForKind(explicit))
  ) {
    return explicit === "attachment" ? "file" : explicit;
  }
  if (message?.attachment) {
    return "file";
  }
  if (message?.parentTxid) {
    return "reply";
  }
  return bondTagForMemo(message?.memo)?.kind ?? "mail";
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
    title: bondTagForKind(kind)?.label
      ? `${bondTagForKind(kind).label} sent`
      : "Mail sent",
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
    item?.eventKeyVout,
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
  for (const recipient of Array.isArray(item?.recipients)
    ? item.recipients
    : []) {
    add(recipient?.address ?? recipient?.display, "recipient");
  }
  add(item?.address, "address");
  add(item?.actor, "actor");
  add(item?.counterparty, "counterparty");
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

async function persistCanonicalBlock(client, block, height, blockHash) {
  const blockTime = Number(block?.time);
  const medianTime = Number(block?.mediantime);
  await client.query(
    `
      INSERT INTO proof_indexer.blocks (
        network,
        block_hash,
        height,
        previous_block_hash,
        block_time,
        median_time,
        tx_count,
        canonical,
        indexed_at
      )
      VALUES ($1, $2, $3, NULLIF($4, ''), $5::timestamptz, $6::timestamptz, $7, true, now())
      ON CONFLICT (network, block_hash)
      DO UPDATE SET
        height = EXCLUDED.height,
        previous_block_hash = EXCLUDED.previous_block_hash,
        block_time = EXCLUDED.block_time,
        median_time = EXCLUDED.median_time,
        tx_count = EXCLUDED.tx_count,
        canonical = true,
        indexed_at = now()
    `,
    [
      NETWORK,
      String(blockHash ?? "").trim().toLowerCase(),
      height,
      String(block?.previousblockhash ?? "").trim().toLowerCase(),
      Number.isFinite(blockTime) && blockTime > 0
        ? new Date(blockTime * 1000).toISOString()
        : null,
      Number.isFinite(medianTime) && medianTime > 0
        ? new Date(medianTime * 1000).toISOString()
        : null,
      Array.isArray(block?.tx) ? block.tx.length : null,
    ],
  );
}

async function persistCanonicalRawTransaction(
  client,
  tx,
  { blockHash, blockTime, height },
) {
  const txid = String(tx?.txid ?? "").trim().toLowerCase();
  if (!isHexTxid(txid)) {
    throw new Error("Canonical block scan produced an invalid transaction id.");
  }
  const canonicalRawTx = {
    ...tx,
    canonicalBlockScan: {
      blockHash: String(blockHash ?? "").trim().toLowerCase(),
      height,
      network: NETWORK,
    },
  };
  const eventTime =
    Number.isFinite(Number(blockTime)) && Number(blockTime) > 0
      ? new Date(Number(blockTime) * 1000).toISOString()
      : itemTime(tx);
  await client.query(
    `
      INSERT INTO proof_indexer.transactions (
        network,
        txid,
        status,
        first_seen_at,
        last_seen_at,
        confirmed_at,
        block_hash,
        block_height,
        block_time,
        vsize,
        weight,
        version,
        locktime,
        source,
        raw_tx
      )
      VALUES (
        $1,
        $2,
        'confirmed',
        now(),
        now(),
        COALESCE($3::timestamptz, now()),
        $4,
        $5,
        $3::timestamptz,
        $6,
        $7,
        $8,
        $9,
        'canonical-block-scan',
        $10::jsonb
      )
      ON CONFLICT (network, txid)
      DO UPDATE SET
        status = 'confirmed',
        last_seen_at = now(),
        confirmed_at = COALESCE(EXCLUDED.confirmed_at, proof_indexer.transactions.confirmed_at),
        block_hash = EXCLUDED.block_hash,
        block_height = EXCLUDED.block_height,
        block_time = EXCLUDED.block_time,
        vsize = COALESCE(EXCLUDED.vsize, proof_indexer.transactions.vsize),
        weight = COALESCE(EXCLUDED.weight, proof_indexer.transactions.weight),
        version = COALESCE(EXCLUDED.version, proof_indexer.transactions.version),
        locktime = COALESCE(EXCLUDED.locktime, proof_indexer.transactions.locktime),
        source = EXCLUDED.source,
        raw_tx = EXCLUDED.raw_tx,
        updated_at = now()
    `,
    [
      NETWORK,
      txid,
      eventTime,
      String(blockHash ?? "").trim().toLowerCase(),
      height,
      numberOrNull(tx?.vsize),
      numberOrNull(tx?.weight),
      numberOrNull(tx?.version),
      numberOrNull(tx?.locktime),
      JSON.stringify(canonicalRawTx),
    ],
  );
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
        confirmed_at = CASE
          WHEN proof_indexer.transactions.raw_tx ? 'canonicalBlockScan'
            THEN proof_indexer.transactions.confirmed_at
          ELSE COALESCE(proof_indexer.transactions.confirmed_at, EXCLUDED.confirmed_at)
        END,
        block_height = CASE
          WHEN proof_indexer.transactions.raw_tx ? 'canonicalBlockScan'
            THEN proof_indexer.transactions.block_height
          ELSE COALESCE(EXCLUDED.block_height, proof_indexer.transactions.block_height)
        END,
        block_time = CASE
          WHEN proof_indexer.transactions.raw_tx ? 'canonicalBlockScan'
            THEN proof_indexer.transactions.block_time
          ELSE COALESCE(EXCLUDED.block_time, proof_indexer.transactions.block_time)
        END,
        source = CASE
          WHEN proof_indexer.transactions.raw_tx ? 'canonicalBlockScan'
            THEN proof_indexer.transactions.source
          ELSE COALESCE(EXCLUDED.source, proof_indexer.transactions.source)
        END,
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
  const indexedInput = {
    ...normalizedItem,
    participants: [
      ...new Set([
        ...(Array.isArray(normalizedItem?.participants)
          ? normalizedItem.participants
          : []),
        normalizedItem?.actor,
        normalizedItem?.counterparty,
        normalizedItem?.senderAddress,
        normalizedItem?.recipientAddress,
        normalizedItem?.ownerAddress,
        normalizedItem?.receiveAddress,
        normalizedItem?.sellerAddress,
        normalizedItem?.buyerAddress,
      ].filter(Boolean)),
    ],
  };
  const protocol = protocolForItem(item, kind);
  const eventKey = stableEventKey({
    item: indexedInput,
    kind: stableEventKeyKind(item, kind, sourceLabel),
    protocol,
    sourceLabel,
    txid,
  });
  const eventTime = itemTime(indexedInput);

  await upsertTransaction(client, indexedInput, txid, status, sourceLabel);

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
        payload =
          (proof_indexer.events.payload || EXCLUDED.payload)
          || jsonb_strip_nulls(
            jsonb_build_object(
              'senderAddress', COALESCE(
                NULLIF(EXCLUDED.payload->>'senderAddress', ''),
                NULLIF(proof_indexer.events.payload->>'senderAddress', '')
              ),
              'actor', COALESCE(
                NULLIF(EXCLUDED.payload->>'actor', ''),
                NULLIF(proof_indexer.events.payload->>'actor', '')
              ),
              'counterparty', COALESCE(
                NULLIF(EXCLUDED.payload->>'counterparty', ''),
                NULLIF(proof_indexer.events.payload->>'counterparty', '')
              ),
              'recipientAddress', COALESCE(
                NULLIF(EXCLUDED.payload->>'recipientAddress', ''),
                NULLIF(proof_indexer.events.payload->>'recipientAddress', '')
              ),
              'ownerAddress', COALESCE(
                NULLIF(EXCLUDED.payload->>'ownerAddress', ''),
                NULLIF(proof_indexer.events.payload->>'ownerAddress', '')
              ),
              'receiveAddress', COALESCE(
                NULLIF(EXCLUDED.payload->>'receiveAddress', ''),
                NULLIF(proof_indexer.events.payload->>'receiveAddress', '')
              ),
              'sellerAddress', COALESCE(
                NULLIF(EXCLUDED.payload->>'sellerAddress', ''),
                NULLIF(proof_indexer.events.payload->>'sellerAddress', '')
              ),
              'buyerAddress', COALESCE(
                NULLIF(EXCLUDED.payload->>'buyerAddress', ''),
                NULLIF(proof_indexer.events.payload->>'buyerAddress', '')
              ),
              'participants', CASE
                WHEN NULLIF(EXCLUDED.payload->>'senderAddress', '') IS NULL
                  AND NULLIF(proof_indexer.events.payload->>'senderAddress', '') IS NOT NULL
                THEN COALESCE(
                  proof_indexer.events.payload->'participants',
                  EXCLUDED.payload->'participants',
                  '[]'::jsonb
                )
                ELSE COALESCE(
                  EXCLUDED.payload->'participants',
                  proof_indexer.events.payload->'participants',
                  '[]'::jsonb
                )
              END
            )
          ),
        updated_at = now()
      RETURNING event_id, payload
    `,
    [
      NETWORK,
      eventKey,
      txid,
      protocol,
      kind,
      status,
      indexedInput?.valid !== false && !String(kind).includes("invalid"),
      indexedInput?.reason ? [String(indexedInput.reason)] : [],
      amountSats(indexedInput),
      dataBytes(indexedInput),
      numberOrNull(indexedInput?.blockHeight ?? indexedInput?.height),
      eventTime,
      eventTime,
      indexedInput?.payload ? String(indexedInput.payload) : "",
      JSON.stringify({ ...indexedInput, indexedFrom: sourceLabel }),
    ],
  );
  const eventId = result.rows[0].event_id;
  const indexedItem = result.rows[0].payload ?? indexedInput;

  await client.query("DELETE FROM proof_indexer.event_participants WHERE event_id = $1", [
    eventId,
  ]);
  for (const participant of participantsForItem(indexedItem)) {
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
  for (const ref of refsForItem(indexedItem)) {
    await client.query(
      `
        INSERT INTO proof_indexer.event_refs (event_id, ref_type, ref_value)
        VALUES ($1, $2, $3)
        ON CONFLICT DO NOTHING
      `,
      [eventId, ref.refType, ref.refValue],
    );
  }

  if (indexedItem?.valid !== false) {
    await upsertProjection(client, sourceLabel, indexedItem, status);
  }
  return { skipped: false };
}

async function upsertProjection(client, sourceLabel, item, status) {
  const projectionKind = eventKind(item, sourceLabel);
  if (
    projectionKind === "id-register" &&
    item?.id &&
    item?.ownerAddress &&
    status === "confirmed"
  ) {
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
        DO NOTHING
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

  if (
    ["id-update", "id-transfer", "id-buy"].includes(projectionKind) &&
    item?.id &&
    status === "confirmed"
  ) {
    await client.query(
      `
        UPDATE proof_indexer.id_records
        SET
          display_id = COALESCE(NULLIF($2, ''), display_id),
          owner_address = COALESCE(NULLIF($3, ''), owner_address),
          receive_address = COALESCE(NULLIF($4, ''), receive_address),
          pgp_public_key = COALESCE(NULLIF($5, ''), pgp_public_key),
          last_event_txid = $6,
          updated_height = COALESCE($7, updated_height),
          updated_at = now()
        WHERE network = $1
          AND id_lower = lower($2)
      `,
      [
        NETWORK,
        String(item.id),
        item.ownerAddress ?? item.actor ?? "",
        item.receiveAddress ?? item.ownerAddress ?? item.actor ?? "",
        item.pgpPublicKey ?? "",
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
          buyer_address = COALESCE(EXCLUDED.buyer_address, proof_indexer.credit_listings.buyer_address),
          amount = EXCLUDED.amount,
          price_sats = EXCLUDED.price_sats,
          sale_ticket_txid = COALESCE(EXCLUDED.sale_ticket_txid, proof_indexer.credit_listings.sale_ticket_txid),
          sale_ticket_vout = COALESCE(EXCLUDED.sale_ticket_vout, proof_indexer.credit_listings.sale_ticket_vout),
          sale_ticket_value_sats = COALESCE(EXCLUDED.sale_ticket_value_sats, proof_indexer.credit_listings.sale_ticket_value_sats),
          seal_txid = COALESCE(NULLIF(EXCLUDED.seal_txid, ''), proof_indexer.credit_listings.seal_txid),
          close_txid = COALESCE(NULLIF(EXCLUDED.close_txid, ''), proof_indexer.credit_listings.close_txid),
          payload = proof_indexer.credit_listings.payload || EXCLUDED.payload,
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
    ["mail", "reply", "file", "attachment", "browser"].includes(
      projectionKind,
    ) || Boolean(bondTagForKind(projectionKind))
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

function summaryPayloadFreshnessMs(payload) {
  return Math.max(
    Date.parse(payload?.indexedAt ?? ""),
    Date.parse(payload?.generatedAt ?? ""),
    Date.parse(payload?.btcUsdIndexedAt ?? ""),
    Date.parse(payload?.actualValue?.indexedAt ?? ""),
    0,
  );
}

function summaryPayloadBtcUsd(payload) {
  return finiteSummaryNumber(
    payload?.btcUsd ??
      payload?.floor?.btcUsd ??
      payload?.workFloor?.btcUsd,
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
  if (Math.abs(candidateValue - baseValue) <= 0.0001) {
    const baseBtcUsd = summaryPayloadBtcUsd(base);
    const candidateBtcUsd = summaryPayloadBtcUsd(candidate);
    if (
      candidateBtcUsd !== null &&
      baseBtcUsd !== null &&
      Math.abs(candidateBtcUsd - baseBtcUsd) > 0.000001
    ) {
      return candidate;
    }
    const baseFreshness = summaryPayloadFreshnessMs(base);
    const candidateFreshness = summaryPayloadFreshnessMs(candidate);
    if (candidateFreshness > baseFreshness) {
      return candidate;
    }
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
    btcUsd: floor.btcUsd ?? summary.btcUsd,
    btcUsdIndexedAt: floor.btcUsdIndexedAt ?? summary.btcUsdIndexedAt,
    frozenNetworkValueSats:
      frozenSats !== null ? frozenSats : summary.frozenNetworkValueSats,
    liveNetworkValueSats:
      liveSats !== null ? liveSats : summary.liveNetworkValueSats,
    networkValueSats: totalSats,
    usdSource: floor.usdSource ?? summary.usdSource,
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
      workFloor,
    };
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
  const summaryPayloads = summaryPayloadsWithAlignedWorkFloor(
    strongerSummaryPayloads(previousPayload?.summaryPayloads, rawSummaryPayloads),
  );
  const latestIndexedHeight = await latestIndexedBlockHeight(client).catch(() => 0);
  const mergedIndexedThroughBlock = Math.max(
    numberOrNull(payload?.indexedThroughBlock) ?? 0,
    numberOrNull(payload?.metrics?.indexedThroughBlock) ?? 0,
    latestIndexedHeight,
  );
  if (mergedIndexedThroughBlock > 0 && payload) {
    payload = {
      ...payload,
      indexedThroughBlock: mergedIndexedThroughBlock,
      metrics: {
        ...(payload.metrics ?? {}),
        indexedThroughBlock: mergedIndexedThroughBlock,
      },
    };
  }
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
  const { summaryRefresh: _canonicalSummaryRefresh, ...legacyBasePayload } =
    basePayload;
  const snapshotPayload = {
    ...legacyBasePayload,
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

const REQUIRED_CURRENT_SUMMARY_KEYS = [
  "growthSummary",
  "inceptionSummary",
  "infinitySummary",
  "marketplaceSummary",
  "workFloor",
  "workSummary",
];

function summaryPayloadConservativeCoverage(payload, key) {
  const item = objectPayload(payload);
  if (!item) {
    return 0;
  }
  const parentCoverage = Math.max(
    numberOrNull(item.indexedThroughBlock) ?? 0,
    numberOrNull(item.metrics?.indexedThroughBlock) ?? 0,
    numberOrNull(item.stats?.indexedThroughBlock) ?? 0,
  );
  if (parentCoverage <= 0) {
    return 0;
  }
  const nested =
    key === "workSummary"
      ? objectPayload(item.floor)
      : key === "growthSummary" || key === "marketplaceSummary"
        ? objectPayload(item.workFloor)
        : null;
  if (
    !nested &&
    !["inceptionSummary", "infinitySummary", "workFloor"].includes(key)
  ) {
    return 0;
  }
  if (!nested) {
    return parentCoverage;
  }
  const nestedCoverage = Math.max(
    numberOrNull(nested.indexedThroughBlock) ?? 0,
    numberOrNull(nested.metrics?.indexedThroughBlock) ?? 0,
    numberOrNull(nested.stats?.indexedThroughBlock) ?? 0,
  );
  return nestedCoverage > 0
    ? Math.min(parentCoverage, nestedCoverage)
    : 0;
}

function canonicalSummaryCoverage(summaryPayloads = {}) {
  const coverages = REQUIRED_CURRENT_SUMMARY_KEYS.map((key) =>
    summaryPayloadConservativeCoverage(summaryPayloads?.[key], key),
  );
  return coverages.every((height) => height > 0)
    ? Math.min(...coverages)
    : 0;
}

function eligibleCanonicalSummarySnapshotPayload(payload) {
  const item = objectPayload(payload);
  const tokenComponentCheck = (Array.isArray(item?.checks) ? item.checks : []).find(
    (check) => check?.name === "token-components-cover-confirmed-activity",
  );
  const publicLogCountCheck = (Array.isArray(item?.checks) ? item.checks : []).find(
    (check) => check?.name === "canonical-activity-count-matches-public-log",
  );
  return Boolean(
    item &&
      item.ok === true &&
      item.status !== "summary-snapshot-fallback" &&
      tokenComponentCheck?.ok === true &&
      publicLogCountCheck?.ok === true &&
      item.summaryRefresh?.mode === "canonical-summary-refresh" &&
      /^[0-9a-f]{64}$/u.test(String(item.sourceHashes?.canonicalSummary ?? "")) &&
      canonicalSummaryCoverage(item.summaryPayloads) > 0,
  );
}

async function storedEligibleCanonicalSummarySnapshotPayload(client) {
  const result = await client.query(
    `
      SELECT payload
      FROM proof_indexer.ledger_snapshots
      WHERE network = $1
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
      ORDER BY generated_at DESC
      LIMIT 1
    `,
    [NETWORK],
  );
  const payload = result.rows[0]?.payload;
  return eligibleCanonicalSummarySnapshotPayload(payload) ? payload : null;
}

function canonicalSummaryRefreshCanDefer(error) {
  const statusCode = Number(error?.statusCode ?? 0);
  const errorText = [error?.message, error?.responseText]
    .filter(Boolean)
    .join(" ");
  return (
    error?.name === "AbortError" ||
    /operation was aborted/iu.test(errorText) ||
    (statusCode === 503 &&
      /(?:not exactly at the Bitcoin Core tip|tip changed during canonical summary construction|canonical summary.*(?:timed out|catching up))/iu.test(
        errorText,
      ))
  );
}

async function storeCanonicalSummarySnapshot(client) {
  const latestIndexedHeight = (
    await latestBlockScanCheckpoint(client, { useStoredCheckpoint: true })
  ).height;
  const previousPayload = await storedEligibleCanonicalSummarySnapshotPayload(
    client,
  );
  const previousCoverage = previousPayload
    ? canonicalSummaryCoverage(previousPayload.summaryPayloads)
    : 0;
  if (previousCoverage >= latestIndexedHeight) {
    return {
      indexedThroughBlock: previousCoverage,
      reason: "already-current",
      skipped: true,
      snapshotId: previousPayload?.snapshotId ?? null,
    };
  }

  let canonicalBundle;
  try {
    canonicalBundle = await readJson(
      unpagedEndpoint("/api/v1/internal/canonical-summary"),
      {
        retries: 0,
        timeoutMs: CANONICAL_SUMMARY_REFRESH_TIMEOUT_MS,
      },
    );
  } catch (error) {
    if (!previousPayload || !canonicalSummaryRefreshCanDefer(error)) {
      throw error;
    }
    console.error(
      JSON.stringify({
        error: error?.message ?? String(error),
        indexedThroughBlock: previousCoverage,
        latestIndexedHeight,
        phase: "canonical-summary-refresh",
        retryingNextCycle: true,
      }),
    );
    return {
      indexedThroughBlock: previousCoverage,
      latestIndexedHeight,
      reason: "canonical-summary-deferred",
      skipped: true,
      snapshotId: previousPayload.snapshotId ?? null,
    };
  }
  const ledger = objectPayload(canonicalBundle?.ledger);
  const ledgerCoverage = Math.max(
    numberOrNull(ledger?.indexedThroughBlock) ?? 0,
    numberOrNull(ledger?.metrics?.indexedThroughBlock) ?? 0,
  );
  if (
    ledger?.ok !== true ||
    ledger?.status === "summary-snapshot-fallback" ||
    ledgerCoverage !== latestIndexedHeight ||
    numberOrNull(canonicalBundle?.indexedThroughBlock) !== latestIndexedHeight
  ) {
    throw new Error(
      `Canonical ledger summary refresh is not current through block ${latestIndexedHeight}`,
    );
  }

  const summaryPayloads = summaryPayloadsWithAlignedWorkFloor(
    canonicalBundle?.summaryPayloads,
  );
  const indexedThroughBlock = canonicalSummaryCoverage(summaryPayloads);
  const snapshotId = String(canonicalBundle?.snapshotId ?? "").trim();
  const summarySnapshotIds = REQUIRED_CURRENT_SUMMARY_KEYS.map((key) =>
    summaryPayloadSnapshotId(summaryPayloads?.[key]),
  );
  if (
    indexedThroughBlock !== latestIndexedHeight ||
    !snapshotId ||
    String(ledger.snapshotId ?? "").trim() !== snapshotId ||
    summarySnapshotIds.some((value) => value !== snapshotId)
  ) {
    throw new Error(
      `Canonical summary refresh is not one exact snapshot through block ${latestIndexedHeight}`,
    );
  }
  const sameSnapshotPayload = await storedLedgerSnapshotPayload(
    client,
    snapshotId,
  );

  const generatedAt = new Date().toISOString();
  const summaryHash = createHash("sha256")
    .update(JSON.stringify(summaryPayloads))
    .digest("hex");
  const snapshotPayload = {
    ...(previousPayload ?? {}),
    ...(sameSnapshotPayload ?? {}),
    ...ledger,
    generatedAt,
    snapshotId,
    sourceHashes: {
      ...(ledger.sourceHashes ?? {}),
      canonicalSummary: summaryHash,
    },
    summaryPayloads,
    summaryPayloadsIndexedAt: generatedAt,
    summaryRefresh: {
      indexedThroughBlock,
      mode: "canonical-summary-refresh",
      previousCoverage,
    },
    totals: summarySnapshotTotals(summaryPayloads),
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
      ledgerCoverage,
      JSON.stringify(snapshotPayload.sourceHashes ?? {}),
      JSON.stringify(ledger.metrics ?? {}),
      JSON.stringify({
        checks: ledger.checks ?? [],
        missingLogEvents: ledger.missingLogEvents ?? [],
        ok: ledger.ok,
        status: ledger.status,
      }),
      JSON.stringify(snapshotPayload),
    ],
  );
  return {
    indexedThroughBlock,
    previousCoverage,
    skipped: false,
    snapshotId,
  };
}

async function repairStoredSummarySnapshot(client) {
  await storeCanonicalSummarySnapshot(client);
  const snapshotPayload = await storedEligibleCanonicalSummarySnapshotPayload(
    client,
  );
  if (!snapshotPayload) {
    throw new Error("Canonical summary refresh did not publish an eligible snapshot.");
  }
  return snapshotPayload;
}

async function latestIndexedBlockHeight(client) {
  const result = await client.query(
    `
      SELECT GREATEST(
        COALESCE((
          SELECT max(block_height)
          FROM proof_indexer.transactions
          WHERE network = $1 AND status = 'confirmed'
        ), 0),
        COALESCE((
          SELECT max(indexed_through_block)
          FROM proof_indexer.ledger_snapshots
          WHERE network = $1
        ), 0)
      ) AS height
    `,
    [NETWORK],
  );
  const height = Number(result.rows[0]?.height ?? 0);
  return Number.isSafeInteger(height) && height > 0 ? height : 0;
}

const CANONICAL_REBUILD_META_KEY = "canonical:rebuild";
const CANONICAL_FAULT_META_KEY = "canonical:fault";

async function proofIndexerMetaValue(client, key) {
  const result = await client.query(
    `SELECT value FROM proof_indexer.meta WHERE key = $1 LIMIT 1`,
    [key],
  );
  const value = result.rows[0]?.value;
  return value && typeof value === "object" && !Array.isArray(value)
    ? value
    : null;
}

async function storeProofIndexerMeta(client, key, value) {
  await client.query(
    `
      INSERT INTO proof_indexer.meta (key, value, updated_at)
      VALUES ($1, $2::jsonb, now())
      ON CONFLICT (key)
      DO UPDATE SET value = EXCLUDED.value, updated_at = now()
    `,
    [key, JSON.stringify(value)],
  );
}

async function prepareCanonicalRebuild(client) {
  if (!CANONICAL_REBUILD) {
    return null;
  }
  const existing = await proofIndexerMetaValue(
    client,
    CANONICAL_REBUILD_META_KEY,
  );
  if (
    existing?.network === NETWORK &&
    Number(existing?.fromHeight) === BLOCK_SCAN_FROM_HEIGHT &&
    (existing?.status === "active" ||
      (existing?.status === "complete" && !PREPARE_CANONICAL_REBUILD_ONLY))
  ) {
    return { resumed: true, value: existing };
  }

  const bootstrapHeight = BLOCK_SCAN_FROM_HEIGHT - 1;
  const bootstrapHash = String(
    await bitcoinRpc("getblockhash", [bootstrapHeight]),
  )
    .trim()
    .toLowerCase();
  if (!isHexTxid(bootstrapHash)) {
    throw new Error(
      `Bitcoin Core returned an invalid canonical bootstrap hash for block ${bootstrapHeight}`,
    );
  }
  const tipHeight = Number(await bitcoinRpc("getblockcount"));
  const startedAt = new Date().toISOString();
  const value = {
    active: true,
    bootstrapHash,
    bootstrapHeight,
    complete: false,
    fromHeight: BLOCK_SCAN_FROM_HEIGHT,
    indexedThroughBlock: bootstrapHeight,
    indexedThroughBlockHash: bootstrapHash,
    network: NETWORK,
    startedAt,
    status: "active",
    transactionNormalization: "canonical-raw-tx-only",
    updatedAt: startedAt,
  };

  await client.query("BEGIN");
  try {
    await client.query(
      `
        DELETE FROM proof_indexer.events
        WHERE network = $1
          AND protocol = ANY($2::text[])
      `,
      [NETWORK, ["pwid1", "pwt1", "pwm1"]],
    );
    await client.query(`DELETE FROM proof_indexer.id_records WHERE network = $1`, [
      NETWORK,
    ]);
    await client.query(
      `DELETE FROM proof_indexer.credit_balances WHERE network = $1`,
      [NETWORK],
    );
    await client.query(
      `DELETE FROM proof_indexer.credit_listings WHERE network = $1`,
      [NETWORK],
    );
    await client.query(
      `DELETE FROM proof_indexer.credit_definitions WHERE network = $1`,
      [NETWORK],
    );
    await seedCanonicalWorkDefinition(client);
    await client.query(`DELETE FROM proof_indexer.mail_items WHERE network = $1`, [
      NETWORK,
    ]);
    await client.query(
      `DELETE FROM proof_indexer.file_attachments WHERE network = $1`,
      [NETWORK],
    );
    await client.query(
      `
        UPDATE proof_indexer.transactions
        SET raw_tx = NULL, updated_at = now()
        WHERE network = $1
          AND raw_tx ? 'canonicalBlockScan'
      `,
      [NETWORK],
    );
    await client.query(
      `
        UPDATE proof_indexer.blocks
        SET canonical = false, indexed_at = now()
        WHERE network = $1
      `,
      [NETWORK],
    );
    await client.query(
      `
        DELETE FROM proof_indexer.ledger_snapshots
        WHERE network = $1
      `,
      [NETWORK],
    );
    await client.query(`DELETE FROM proof_indexer.meta WHERE key = $1`, [
      CANONICAL_FAULT_META_KEY,
    ]);
    await client.query(`DELETE FROM proof_indexer.meta WHERE key = $1`, [
      `mempoolScan:${NETWORK}`,
    ]);
    await storeProofIndexerMeta(client, CANONICAL_REBUILD_META_KEY, value);
    await storeBlockScanSnapshot(client, {
      complete: false,
      indexed: 0,
      indexedThroughBlock: bootstrapHeight,
      indexedThroughBlockHash: bootstrapHash,
      protocolTxids: 0,
      rebuild: value,
      scannedBlocks: 0,
      skipped: 0,
      stopReason: "canonical-rebuild-bootstrap",
      tipHeight: Number.isSafeInteger(tipHeight) ? tipHeight : null,
    });
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  }
  return { resumed: false, value };
}

async function prepareCanonicalPwtRangeReplay(client) {
  if (!PREPARE_CANONICAL_PWT_RANGE_REPLAY_ONLY) {
    return null;
  }
  const existing = await proofIndexerMetaValue(
    client,
    CANONICAL_REBUILD_META_KEY,
  );
  const existingFault = await proofIndexerMetaValue(
    client,
    CANONICAL_FAULT_META_KEY,
  );
  if (existingFault?.network === NETWORK && existingFault?.active === true) {
    throw new Error(
      "PWT range replay cannot bypass an active canonical fault; use full reorg recovery.",
    );
  }
  if (
    existing?.network === NETWORK &&
    existing?.mode === "pwt-range-replay" &&
    Number(existing?.rangeReplayFromHeight) === BLOCK_SCAN_FROM_HEIGHT &&
    existing?.status === "active"
  ) {
    return { resumed: true, value: existing };
  }

  const canonicalFromHeight = Number(existing?.fromHeight ?? 0);
  const canonicalBootstrapHeight = Number(existing?.bootstrapHeight ?? 0);
  const canonicalBootstrapHash = String(existing?.bootstrapHash ?? "")
    .trim()
    .toLowerCase();
  if (
    existing?.network !== NETWORK ||
    !["active", "complete"].includes(existing?.status) ||
    !Number.isSafeInteger(canonicalFromHeight) ||
    canonicalFromHeight <= 0 ||
    canonicalFromHeight > BLOCK_SCAN_FROM_HEIGHT ||
    !Number.isSafeInteger(canonicalBootstrapHeight) ||
    canonicalBootstrapHeight !== canonicalFromHeight - 1 ||
    !isHexTxid(canonicalBootstrapHash)
  ) {
    throw new Error(
      "PWT range replay requires the original hashed canonical rebuild metadata.",
    );
  }

  const rangeBootstrapHeight = BLOCK_SCAN_FROM_HEIGHT - 1;
  const rangeBootstrapHash = String(
    await bitcoinRpc("getblockhash", [rangeBootstrapHeight]),
  )
    .trim()
    .toLowerCase();
  if (!isHexTxid(rangeBootstrapHash)) {
    throw new Error(
      `Bitcoin Core returned an invalid PWT range checkpoint hash for block ${rangeBootstrapHeight}`,
    );
  }
  const tipHeight = Number(await bitcoinRpc("getblockcount"));
  if (
    !Number.isSafeInteger(tipHeight) ||
    tipHeight < BLOCK_SCAN_FROM_HEIGHT
  ) {
    throw new Error("Bitcoin Core tip is below the requested PWT replay range.");
  }

  const startedAt = new Date().toISOString();
  const { completedAt: _completedAt, ...existingBase } = existing;
  const value = {
    ...existingBase,
    active: true,
    bootstrapHash: canonicalBootstrapHash,
    bootstrapHeight: canonicalBootstrapHeight,
    complete: false,
    fromHeight: canonicalFromHeight,
    indexedThroughBlock: rangeBootstrapHeight,
    indexedThroughBlockHash: rangeBootstrapHash,
    mode: "pwt-range-replay",
    network: NETWORK,
    rangeReplayFromHeight: BLOCK_SCAN_FROM_HEIGHT,
    rangeReplayStartedAt: startedAt,
    status: "active",
    transactionNormalization: "canonical-raw-tx-only",
    updatedAt: startedAt,
  };

  await client.query("BEGIN");
  try {
    const firstMarketplaceEvent = await client.query(
      `
        SELECT min(COALESCE(e.block_height, t.block_height)) AS first_height
        FROM proof_indexer.events e
        LEFT JOIN proof_indexer.transactions t
          ON t.network = e.network
         AND t.txid = e.txid
        WHERE e.network = $1
          AND e.protocol = 'pwt1'
          AND e.valid = true
          AND COALESCE(t.status, e.status) = 'confirmed'
          AND e.kind = ANY($2::text[])
      `,
      [
        NETWORK,
        [
          "token-listing",
          "token-listings",
          "token-listing-sealed",
          "token-listing-closed",
          "token-sale",
        ],
      ],
    );
    const firstMarketplaceHeight = Number(
      firstMarketplaceEvent.rows[0]?.first_height ?? 0,
    );
    if (
      Number.isSafeInteger(firstMarketplaceHeight) &&
      firstMarketplaceHeight > 0 &&
      firstMarketplaceHeight < BLOCK_SCAN_FROM_HEIGHT
    ) {
      throw new Error(
        `PWT range replay must begin at or before the first canonical marketplace event at block ${firstMarketplaceHeight}`,
      );
    }
    const preRangeFalseClose = await client.query(
      `
        SELECT min(COALESCE(e.block_height, t.block_height)) AS first_false_height
        FROM proof_indexer.events e
        JOIN proof_indexer.transactions t
          ON t.network = e.network
         AND t.txid = e.txid
        WHERE e.network = $1
          AND e.protocol = 'pwt1'
          AND e.valid = true
          AND COALESCE(t.status, e.status) = 'confirmed'
          AND e.kind = 'token-listing-closed'
          AND COALESCE(e.block_height, t.block_height, 0) < $2
          AND e.payload->'saleAuthorization'->>'anchorVout' ~ '^[0-9]+$'
          AND EXISTS (
            SELECT 1
            FROM jsonb_array_elements(
              CASE
                WHEN jsonb_typeof(t.raw_tx->'vin') = 'array'
                  THEN t.raw_tx->'vin'
                ELSE '[]'::jsonb
              END
            ) vin
            WHERE vin->>'txid' = e.payload->>'sealTxid'
              AND (vin->>'vout')::integer =
                (e.payload->'saleAuthorization'->>'anchorVout')::integer
          )
          AND NOT EXISTS (
            SELECT 1
            FROM jsonb_array_elements(
              CASE
                WHEN jsonb_typeof(t.raw_tx->'vin') = 'array'
                  THEN t.raw_tx->'vin'
                ELSE '[]'::jsonb
              END
            ) vin
            WHERE vin->>'txid' = e.payload->>'listingId'
              AND (vin->>'vout')::integer =
                (e.payload->'saleAuthorization'->>'anchorVout')::integer
          )
      `,
      [NETWORK, BLOCK_SCAN_FROM_HEIGHT],
    );
    const firstPreRangeFalseCloseHeight = Number(
      preRangeFalseClose.rows[0]?.first_false_height ?? 0,
    );
    if (
      Number.isSafeInteger(firstPreRangeFalseCloseHeight) &&
      firstPreRangeFalseCloseHeight > 0
    ) {
      throw new Error(
        `PWT range replay starts too late; a false sale-ticket close already exists at block ${firstPreRangeFalseCloseHeight}`,
      );
    }
    const baseDefinitions = await client.query(
      `
        SELECT e.payload, e.status
        FROM proof_indexer.events e
        LEFT JOIN proof_indexer.transactions t
          ON t.network = e.network
         AND t.txid = e.txid
        WHERE e.network = $1
          AND e.protocol = 'pwt1'
          AND e.valid = true
          AND COALESCE(t.status, e.status) = 'confirmed'
          AND e.kind = 'token-create'
          AND COALESCE(e.block_height, t.block_height, 0) < $2
        ORDER BY
          COALESCE(e.block_height, t.block_height, 0),
          e.event_id
      `,
      [NETWORK, BLOCK_SCAN_FROM_HEIGHT],
    );
    const baseMarketplace = await client.query(
      `
        SELECT e.payload, e.status
        FROM proof_indexer.events e
        LEFT JOIN proof_indexer.transactions t
          ON t.network = e.network
         AND t.txid = e.txid
        WHERE e.network = $1
          AND e.protocol = 'pwt1'
          AND e.valid = true
          AND COALESCE(t.status, e.status) = 'confirmed'
          AND e.kind = ANY($2::text[])
          AND COALESCE(e.block_height, t.block_height, 0) < $3
        ORDER BY
          COALESCE(e.block_height, t.block_height, 0),
          CASE
            WHEN e.payload->>'blockIndex' ~ '^[0-9]+$'
              THEN (e.payload->>'blockIndex')::integer
            ELSE 2147483647
          END,
          CASE
            WHEN e.payload->>'_powEventIndex' ~ '^[0-9]+$'
              THEN (e.payload->>'_powEventIndex')::integer
            ELSE 2147483647
          END,
          e.event_key
      `,
      [
        NETWORK,
        [
          "token-listing",
          "token-listings",
          "token-listing-sealed",
          "token-listing-closed",
          "token-sale",
        ],
        BLOCK_SCAN_FROM_HEIGHT,
      ],
    );

    await client.query(
      `
        WITH replay_txids AS (
          SELECT DISTINCT e.txid
          FROM proof_indexer.events e
          LEFT JOIN proof_indexer.transactions t
            ON t.network = e.network
           AND t.txid = e.txid
          WHERE e.network = $1
            AND e.protocol = 'pwt1'
            AND (
              COALESCE(t.status, e.status) <> 'confirmed'
              OR COALESCE(e.block_height, t.block_height, 0) >= $2
            )
        )
        DELETE FROM proof_indexer.events e
        USING replay_txids r
        WHERE e.network = $1
          AND e.txid = r.txid
      `,
      [NETWORK, BLOCK_SCAN_FROM_HEIGHT],
    );
    await client.query(
      `DELETE FROM proof_indexer.credit_balances WHERE network = $1`,
      [NETWORK],
    );
    await client.query(
      `DELETE FROM proof_indexer.credit_listings WHERE network = $1`,
      [NETWORK],
    );
    await client.query(
      `DELETE FROM proof_indexer.credit_definitions WHERE network = $1`,
      [NETWORK],
    );
    await seedCanonicalWorkDefinition(client);
    await seedCanonicalBondDefinitions(client, { required: true });
    for (const row of baseDefinitions.rows) {
      await upsertProjection(client, "tokens", row.payload, row.status);
    }
    for (const row of baseMarketplace.rows) {
      await upsertProjection(
        client,
        sourceLabelForProtocolItem(row.payload),
        row.payload,
        row.status,
      );
    }
    await client.query(
      `DELETE FROM proof_indexer.ledger_snapshots WHERE network = $1`,
      [NETWORK],
    );
    await client.query(`DELETE FROM proof_indexer.meta WHERE key = $1`, [
      CANONICAL_FAULT_META_KEY,
    ]);
    await client.query(`DELETE FROM proof_indexer.meta WHERE key = $1`, [
      `mempoolScan:${NETWORK}`,
    ]);
    await storeProofIndexerMeta(client, CANONICAL_REBUILD_META_KEY, value);
    await storeBlockScanSnapshot(client, {
      complete: false,
      indexed: 0,
      indexedThroughBlock: rangeBootstrapHeight,
      indexedThroughBlockHash: rangeBootstrapHash,
      protocolTxids: 0,
      rebuild: value,
      scannedBlocks: 0,
      skipped: 0,
      stopReason: "canonical-pwt-range-replay-bootstrap",
      tipHeight,
    });
    await client.query("COMMIT");
    return {
      baseDefinitions: baseDefinitions.rows.length,
      baseMarketplaceEvents: baseMarketplace.rows.length,
      resumed: false,
      value,
    };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  }
}

async function storeCanonicalReorgFault(client, details) {
  const detectedAt = new Date().toISOString();
  const fault = {
    active: true,
    detectedAt,
    network: NETWORK,
    status: "fault",
    type: "reorg",
    ...details,
  };
  await storeProofIndexerMeta(client, CANONICAL_FAULT_META_KEY, fault);
  const rebuild = await proofIndexerMetaValue(
    client,
    CANONICAL_REBUILD_META_KEY,
  );
  if (rebuild?.network === NETWORK && rebuild?.status === "active") {
    await storeProofIndexerMeta(client, CANONICAL_REBUILD_META_KEY, {
      ...rebuild,
      active: false,
      fault,
      status: "fault",
      updatedAt: detectedAt,
    });
  }
  return fault;
}

function canonicalRebuildCheckpointValue(
  rebuild,
  { blockHash, complete, height },
) {
  if (!rebuild || typeof rebuild !== "object") {
    return null;
  }
  const { completedAt: _previousCompletedAt, ...baseRebuild } = rebuild;
  const updatedAt = new Date().toISOString();
  return {
    ...baseRebuild,
    active: !complete,
    ...(complete ? { completedAt: updatedAt } : {}),
    complete,
    indexedThroughBlock: height,
    indexedThroughBlockHash: blockHash,
    status: complete ? "complete" : "active",
    updatedAt,
  };
}

async function latestBlockScanCheckpoint(client, options = {}) {
  if (
    options.useStoredCheckpoint !== true &&
    Number.isSafeInteger(BLOCK_SCAN_FROM_HEIGHT) &&
    BLOCK_SCAN_FROM_HEIGHT > 0
  ) {
    return { blockHash: "", height: BLOCK_SCAN_FROM_HEIGHT - 1 };
  }
  const result = await client.query(
    `
      SELECT
        indexed_through_block,
        COALESCE(
          NULLIF(payload->>'indexedThroughBlockHash', ''),
          NULLIF(payload->>'blockHash', '')
        ) AS block_hash
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
      ORDER BY indexed_through_block DESC, generated_at DESC
      LIMIT 1
    `,
    [NETWORK],
  );
  const height = Number(result.rows[0]?.indexed_through_block ?? 0);
  if (
    result.rows.length === 0 ||
    !Number.isSafeInteger(height) ||
    height < 0
  ) {
    throw new Error(
      "No hashed authoritative block-scan checkpoint exists; set POW_INDEX_BACKFILL_BLOCK_SCAN_FROM_HEIGHT only for an explicit supervised replay",
    );
  }
  const blockHash = String(result.rows[0]?.block_hash ?? "")
    .trim()
    .toLowerCase();
  if (!/^[0-9a-f]{64}$/u.test(blockHash)) {
    throw new Error(
      "The stored block-scan checkpoint has no canonical block hash; an explicit supervised replay is required",
    );
  }
  return {
    blockHash,
    height,
  };
}

async function storeBlockScanSnapshot(client, payload) {
  const snapshotId = createHash("sha256")
    .update(
      JSON.stringify({
        indexedThroughBlock: payload.indexedThroughBlock,
        indexedThroughBlockHash: payload.indexedThroughBlockHash ?? "",
        network: NETWORK,
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
      numberOrNull(payload.indexedThroughBlock),
      JSON.stringify({
        blockScan: payload.indexedThroughBlockHash || snapshotId,
      }),
      JSON.stringify({
        complete: payload.complete,
        indexed: payload.indexed,
        indexedThroughBlock: payload.indexedThroughBlock,
        indexedThroughBlockHash: payload.indexedThroughBlockHash ?? "",
        protocolTxids: payload.protocolTxids,
        scannedBlocks: payload.scannedBlocks,
        skipped: payload.skipped,
        stopReason: payload.stopReason ?? "",
        tipHeight: payload.tipHeight,
      }),
      JSON.stringify({
        ok: payload.complete === true,
        status: payload.complete === true
          ? "block-scan-current"
          : "block-scan-partial",
      }),
      JSON.stringify({
        complete: payload.complete === true,
        generatedAt,
        indexedThroughBlock: payload.indexedThroughBlock,
        indexedThroughBlockHash: payload.indexedThroughBlockHash ?? "",
        network: NETWORK,
        ...(payload.rebuild ? { rebuild: payload.rebuild } : {}),
        snapshotId,
        source: "proof-indexer-block-scan",
        stopReason: payload.stopReason ?? "",
        tipHeight: payload.tipHeight,
      }),
    ],
  );
  return snapshotId;
}

async function backfillBlockScanSource(client, source) {
  if (!BITCOIN_RPC_URL) {
    throw new Error(
      `BITCOIN_RPC_URL is required for ${source.label}; no block scan was performed`,
    );
  }

  const canonicalRebuildState = CANONICAL_REBUILD
    ? await prepareCanonicalRebuild(client)
    : null;
  const storedRebuild = canonicalRebuildState?.value ??
    (await proofIndexerMetaValue(client, CANONICAL_REBUILD_META_KEY));
  const storedFault = await proofIndexerMetaValue(
    client,
    CANONICAL_FAULT_META_KEY,
  );
  if (storedFault?.network === NETWORK && storedFault?.active === true) {
    throw new Error(
      "Canonical indexing is faulted; run a new supervised canonical rebuild.",
    );
  }
  let canonicalRebuild =
    storedRebuild?.network === NETWORK &&
    ["active", "complete"].includes(storedRebuild?.status)
      ? storedRebuild
      : null;
  const checkpoint = await latestBlockScanCheckpoint(client, {
    useStoredCheckpoint: CANONICAL_REBUILD,
  });
  const latestIndexedHeight = checkpoint.height;
  const tipHeight = Number(await bitcoinRpc("getblockcount"));
  if (!Number.isSafeInteger(tipHeight) || tipHeight < latestIndexedHeight) {
    await storeCanonicalReorgFault(client, {
      checkpointHeight: latestIndexedHeight,
      nodeTipHeight: Number.isSafeInteger(tipHeight) ? tipHeight : null,
      phase: "checkpoint-ahead-of-tip",
    });
    throw new Error(
      `Block-scan checkpoint ${latestIndexedHeight} is ahead of node tip ${tipHeight}`,
    );
  }
  let indexedThroughBlockHash = checkpoint.blockHash;
  if (latestIndexedHeight > 0) {
    const canonicalCheckpointHash = String(
      await bitcoinRpc("getblockhash", [latestIndexedHeight]),
    )
      .trim()
      .toLowerCase();
    if (
      indexedThroughBlockHash &&
      canonicalCheckpointHash !== indexedThroughBlockHash
    ) {
      await storeCanonicalReorgFault(client, {
        actualBlockHash: canonicalCheckpointHash,
        expectedBlockHash: indexedThroughBlockHash,
        height: latestIndexedHeight,
        phase: "checkpoint",
      });
      throw new Error(
        `Bitcoin reorg detected at indexed checkpoint ${latestIndexedHeight}; operator replay is required`,
      );
    }
    indexedThroughBlockHash = canonicalCheckpointHash;
  }
  if (!Number.isSafeInteger(tipHeight) || tipHeight <= latestIndexedHeight) {
    if (canonicalRebuild?.status === "active") {
      const completedRebuild = canonicalRebuildCheckpointValue(
        canonicalRebuild,
        {
          blockHash: indexedThroughBlockHash,
          complete: true,
          height: latestIndexedHeight,
        },
      );
      await client.query("BEGIN");
      try {
        await seedCanonicalBondDefinitions(client, { required: true });
        await rebuildConfirmedCreditBalancesFromCanonicalEvents(client);
        await storeProofIndexerMeta(
          client,
          CANONICAL_REBUILD_META_KEY,
          completedRebuild,
        );
        await storeBlockScanSnapshot(client, {
          complete: true,
          indexed: 0,
          indexedThroughBlock: latestIndexedHeight,
          indexedThroughBlockHash,
          protocolTxids: 0,
          rebuild: completedRebuild,
          scannedBlocks: 0,
          skipped: 0,
          stopReason: "",
          tipHeight,
        });
        await client.query("COMMIT");
        canonicalRebuild = completedRebuild;
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      }
    }
    if (latestIndexedHeight > 0 && !checkpoint.blockHash) {
      await storeBlockScanSnapshot(client, {
        complete: tipHeight === latestIndexedHeight,
        indexed: 0,
        indexedThroughBlock: latestIndexedHeight,
        indexedThroughBlockHash,
        protocolTxids: 0,
        scannedBlocks: 0,
        skipped: 0,
        stopReason: "checkpoint-hash-bootstrap",
        tipHeight,
      });
    }
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
  const firstHeight = latestIndexedHeight + 1;
  const lastHeight = maxBlocks > 0
    ? Math.min(tipHeight, firstHeight + Math.floor(maxBlocks) - 1)
    : tipHeight;
  const maxProtocolTxids = Number.isFinite(BLOCK_SCAN_MAX_TXIDS) &&
    BLOCK_SCAN_MAX_TXIDS > 0
    ? Math.floor(BLOCK_SCAN_MAX_TXIDS)
    : Number.POSITIVE_INFINITY;
  let indexed = 0;
  let indexedThroughBlock = latestIndexedHeight;
  let protocolTxids = 0;
  let scanError = null;
  let skipped = 0;
  let scannedBlocks = 0;
  let stopReason = "";

  scanBlocks: for (let height = firstHeight; height <= lastHeight; height += 1) {
    if (protocolTxids >= maxProtocolTxids && scannedBlocks > 0) {
      stopReason = "protocol-txid-limit";
      break;
    }
    const blockHash = await bitcoinRpc("getblockhash", [height]);
    // Verbosity 2 is sufficient to identify protocol transactions. Hydrate
    // prevouts only for those transactions below instead of asking Core to
    // materialize every input in every unrelated transaction in the block.
    const block = await bitcoinRpc("getblock", [blockHash, 2]);
    assertCanonicalBlockEnvelope(block, height, blockHash);
    if (
      indexedThroughBlockHash &&
      String(block?.previousblockhash ?? "").toLowerCase() !==
        indexedThroughBlockHash
    ) {
      await storeCanonicalReorgFault(client, {
        actualPreviousBlockHash: String(
          block?.previousblockhash ?? "",
        ).toLowerCase(),
        expectedPreviousBlockHash: indexedThroughBlockHash,
        height,
        phase: "before-block",
        proposedBlockHash: String(blockHash ?? "").toLowerCase(),
      });
      throw new Error(
        `Bitcoin reorg detected before block ${height}; operator replay is required`,
      );
    }
    const protocolCandidates = (block?.tx ?? []).flatMap((tx, blockIndex) => {
      const messages = protocolMessagesFromTx(tx);
      return messages.length > 0 ? [{ blockIndex, messages, tx }] : [];
    });
    if (
      scannedBlocks > 0 &&
      Number.isFinite(maxProtocolTxids) &&
      protocolTxids + protocolCandidates.length > maxProtocolTxids
    ) {
      stopReason = "protocol-txid-limit";
      break;
    }
    scannedBlocks += 1;
    let foundInBlock = protocolCandidates.length;
    let blockIndexed = 0;
    let blockSkipped = 0;
    let currentTxid = "";
    const preparedTransactions = [];
    try {
      for (const { blockIndex, messages, tx } of protocolCandidates) {
        currentTxid = String(tx.txid ?? "");
        protocolTxids += 1;
        const hydratedTx = await transactionWithInputPrevouts({
          ...tx,
          _powBlockIndex: blockIndex,
          _powBlockHash: String(blockHash ?? "").trim().toLowerCase(),
          _powPreviousBlockHash: String(block?.previousblockhash ?? "")
            .trim()
            .toLowerCase(),
          blocktime: block?.time,
          height,
        });
        assertHydratedProtocolTransaction(hydratedTx);
        preparedTransactions.push({
          items: await preparedProtocolItemsForTx(hydratedTx, messages),
          rawTx: hydratedTx,
          txid: currentTxid,
        });
      }
    } catch (error) {
      skipped += 1;
      scanError = error;
      stopReason = "protocol-verification-failed";
      console.error(
        JSON.stringify({
          error: error?.message ?? String(error),
          height,
          phase: "block-scan-verification",
          txid: currentTxid,
        }),
      );
      break scanBlocks;
    }

    const commitBlockHash = String(
      await bitcoinRpc("getblockhash", [height]),
    )
      .trim()
      .toLowerCase();
    if (commitBlockHash !== String(blockHash ?? "").trim().toLowerCase()) {
      await storeCanonicalReorgFault(client, {
        actualBlockHash: commitBlockHash,
        height,
        phase: "before-block-commit",
        proposedBlockHash: String(blockHash ?? "").trim().toLowerCase(),
      });
      throw new Error(
        `Bitcoin reorg detected before committing block ${height}; operator replay is required`,
      );
    }

    await client.query("BEGIN");
    try {
      await persistCanonicalBlock(client, block, height, blockHash);
      for (const prepared of preparedTransactions) {
        currentTxid = prepared.txid;
        await persistCanonicalRawTransaction(client, prepared.rawTx, {
          blockHash,
          blockTime: block?.time,
          height,
        });
        const result = await persistPreparedProtocolItems(client, prepared.items);
        blockIndexed += result.indexed;
        blockSkipped += result.skipped;
      }
      const nextIndexedThroughBlockHash = String(blockHash).trim().toLowerCase();
      const nextComplete = height >= tipHeight;
      const nextStopReason = nextComplete
        ? ""
        : protocolTxids >= maxProtocolTxids
          ? "protocol-txid-limit"
          : height >= lastHeight
            ? "block-limit"
            : "";
      const nextRebuild = canonicalRebuildCheckpointValue(canonicalRebuild, {
        blockHash: nextIndexedThroughBlockHash,
        complete: nextComplete,
        height,
      });
      if (nextComplete) {
        if (canonicalRebuild) {
          await seedCanonicalBondDefinitions(client, { required: true });
        }
        await rebuildConfirmedCreditBalancesFromCanonicalEvents(client);
      }
      if (nextRebuild) {
        await storeProofIndexerMeta(
          client,
          CANONICAL_REBUILD_META_KEY,
          nextRebuild,
        );
      }
      await storeBlockScanSnapshot(client, {
        complete: nextComplete,
        indexed: indexed + blockIndexed,
        indexedThroughBlock: height,
        indexedThroughBlockHash: nextIndexedThroughBlockHash,
        protocolTxids,
        rebuild: nextRebuild,
        scannedBlocks,
        skipped: skipped + blockSkipped,
        stopReason: nextStopReason,
        tipHeight,
      });
      await client.query("COMMIT");
      indexed += blockIndexed;
      skipped += blockSkipped;
      indexedThroughBlock = height;
      indexedThroughBlockHash = nextIndexedThroughBlockHash;
      canonicalRebuild = nextRebuild;
    } catch (error) {
      await client.query("ROLLBACK");
      skipped += 1;
      scanError = error;
      stopReason = "block-transaction-failed";
      console.error(
        JSON.stringify({
          error: error?.message ?? String(error),
          height,
          phase: "block-scan",
          txid: currentTxid,
        }),
      );
      break scanBlocks;
    }
    if (foundInBlock > 0 || scannedBlocks % 25 === 0 || height === lastHeight) {
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
  }

  const complete = indexedThroughBlock >= tipHeight;
  if (!stopReason && !complete) {
    stopReason = "block-limit";
  }
  const summary = {
    blocks: scannedBlocks,
    complete,
    fromHeight: firstHeight,
    indexed,
    indexedThroughBlock,
    indexedThroughBlockHash,
    latestIndexedHeight,
    skipped,
    source: source.label,
    stopReason,
    tipHeight,
    toHeight: lastHeight,
    txids: protocolTxids,
  };
  if (scanError) {
    throw new Error(
      `Block scan stopped at ${indexedThroughBlock}; ${scanError.message ?? String(scanError)}`,
      { cause: scanError },
    );
  }
  return summary;
}

async function mempoolScanState(client) {
  const key = `mempoolScan:${NETWORK}`;
  const result = await client.query(
    `SELECT value FROM proof_indexer.meta WHERE key = $1`,
    [key],
  );
  return {
    key,
    processedTxids: new Set(
      Array.isArray(result.rows[0]?.value?.processedTxids)
        ? result.rows[0].value.processedTxids
        : [],
    ),
  };
}

async function storeMempoolScanState(client, key, processedTxids) {
  await client.query(
    `
      INSERT INTO proof_indexer.meta (key, value, updated_at)
      VALUES ($1, $2::jsonb, now())
      ON CONFLICT (key)
      DO UPDATE SET value = EXCLUDED.value, updated_at = now()
    `,
    [
      key,
      JSON.stringify({
        processedTxids,
        scannedAt: new Date().toISOString(),
      }),
    ],
  );
}

async function backfillMempoolScanSource(client, source) {
  if (!BITCOIN_RPC_URL) {
    return {
      error: "BITCOIN_RPC_URL is not configured",
      indexed: 0,
      source: source.label,
      unresolved: 0,
    };
  }
  let mempool;
  try {
    mempool = await bitcoinRpc("getrawmempool", [true]);
  } catch (error) {
    console.error(
      JSON.stringify({
        error: error?.message ?? String(error),
        phase: "mempool-scan",
      }),
    );
    return {
      error: error?.message ?? String(error),
      indexed: 0,
      source: source.label,
      unresolved: 0,
    };
  }

  const state = await mempoolScanState(client);
  const entries = Object.entries(mempool ?? {})
    .filter(([txid]) => isHexTxid(txid))
    .sort(
      (left, right) =>
        Number(right[1]?.time ?? 0) - Number(left[1]?.time ?? 0) ||
        left[0].localeCompare(right[0]),
    );
  const candidateLimit = Number.isFinite(MEMPOOL_SCAN_MAX_TXIDS)
    ? Math.max(0, Math.floor(MEMPOOL_SCAN_MAX_TXIDS))
    : 500;
  const candidates = entries
    .filter(([txid]) => !state.processedTxids.has(txid))
    .slice(0, candidateLimit);
  const processed = new Set(
    [...state.processedTxids].filter((txid) => mempool?.[txid]),
  );
  let indexed = 0;
  let protocolTxids = 0;
  let scanned = 0;
  let unresolved = 0;

  for (const [txid] of candidates) {
    if (protocolTxids >= Math.max(1, MEMPOOL_SCAN_MAX_PROTOCOL_TXIDS)) {
      break;
    }
    scanned += 1;
    const tx = await rawTransactionFromCore(txid);
    if (!tx) {
      continue;
    }
    const messages = protocolMessagesFromTx(tx);
    if (messages.length === 0) {
      processed.add(txid);
      continue;
    }
    protocolTxids += 1;
    try {
      const hydrated = await transactionWithInputPrevouts(tx);
      const prepared = (await preparedProtocolItemsForTx(hydrated, messages))
        .filter((entry) => (entry.item ?? entry)?.valid !== false);
      await client.query("BEGIN");
      const result = await persistPreparedProtocolItems(client, prepared);
      await client.query("COMMIT");
      indexed += result.indexed;
      processed.add(txid);
    } catch (error) {
      await client.query("ROLLBACK").catch(() => {});
      unresolved += 1;
      console.error(
        JSON.stringify({
          error: error?.message ?? String(error),
          phase: "mempool-protocol-verification",
          txid,
        }),
      );
    }
  }

  const seenLimit = Number.isFinite(MEMPOOL_SCAN_SEEN_LIMIT)
    ? Math.max(100, Math.floor(MEMPOOL_SCAN_SEEN_LIMIT))
    : 10_000;
  const nextProcessed = entries
    .map(([txid]) => txid)
    .filter((txid) => processed.has(txid))
    .slice(0, seenLimit);
  await storeMempoolScanState(client, state.key, nextProcessed);
  return {
    indexed,
    mempoolSize: entries.length,
    protocolTxids,
    scanned,
    source: source.label,
    unresolved,
  };
}

async function backfillSource(client, source) {
  if (source.mempoolScan) {
    return backfillMempoolScanSource(client, source);
  }
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

async function repairConfirmedWorkTransferParticipants(client) {
  if (!REPAIR_WORK_PARTICIPANTS) {
    return { indexed: 0, skipped: 0, source: "repair-work-participants" };
  }
  if (!BITCOIN_RPC_URL) {
    throw new Error("BITCOIN_RPC_URL is required for WORK participant repair.");
  }

  const limit = Number.isFinite(REPAIR_WORK_PARTICIPANTS_LIMIT)
    ? Math.max(1, Math.floor(REPAIR_WORK_PARTICIPANTS_LIMIT))
    : 500;
  const explicit = REPAIR_WORK_PARTICIPANTS_TXIDS.length > 0;
  const repairFilter = explicit
    ? "lower(e.txid) = ANY($3::text[])"
    : `(
        COALESCE(NULLIF(e.payload->>'senderAddress', ''), '') = ''
        OR NOT EXISTS (
          SELECT 1
          FROM proof_indexer.event_participants ep
          WHERE ep.event_id = e.event_id
            AND ep.role = 'sender'
        )
        OR (
          COALESCE(NULLIF(e.payload->>'recipientAddress', ''), '') <> ''
          AND NOT EXISTS (
            SELECT 1
            FROM proof_indexer.event_participants ep
            WHERE ep.event_id = e.event_id
              AND ep.role = 'recipient'
              AND ep.address = e.payload->>'recipientAddress'
          )
        )
      )`;
  const limitParam = explicit ? "$4" : "$3";
  const params = explicit
    ? [NETWORK, WORK_TOKEN_ID, REPAIR_WORK_PARTICIPANTS_TXIDS, limit]
    : [NETWORK, WORK_TOKEN_ID, limit];
  const result = await client.query(
    `
      SELECT DISTINCT ON (lower(e.txid))
        e.txid,
        e.block_height,
        e.block_time,
        e.event_time
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
        AND COALESCE(t.status, e.status) = 'confirmed'
        AND (
          lower(e.payload->>'tokenId') = $2
          OR lower(cd.token_id) = $2
          OR lower(cd.ticker) = 'work'
        )
        AND ${repairFilter}
      ORDER BY
        lower(e.txid),
        COALESCE(e.block_time, t.block_time, e.event_time, t.confirmed_at, e.created_at) DESC
      LIMIT ${limitParam}
    `,
    params,
  );

  const rowsByTxid = new Map(
    result.rows.map((row) => [String(row.txid ?? "").toLowerCase(), row]),
  );
  const missingRequested = REPAIR_WORK_PARTICIPANTS_TXIDS.filter(
    (txid) => !rowsByTxid.has(txid),
  );
  if (missingRequested.length > 0) {
    throw new Error(
      `WORK participant repair cannot proceed; confirmed valid event row is missing for: ${missingRequested.join(",")}`,
    );
  }

  let indexed = 0;
  let skipped = 0;
  const failures = [];
  for (const row of rowsByTxid.values()) {
    const txid = String(row.txid ?? "").trim().toLowerCase();
    try {
      const tx = await rawTransactionFromCore(txid);
      if (!tx) {
        throw new Error("transaction is unavailable from Bitcoin Core");
      }
      if (
        !String(tx.blockhash ?? "").trim() ||
        !Number.isFinite(Number(tx.confirmations)) ||
        Number(tx.confirmations) <= 0
      ) {
        throw new Error("transaction is not confirmed in Bitcoin Core");
      }
      let blockHeight = numberOrNull(row.block_height);
      if (!blockHeight) {
        const header = await bitcoinRpc("getblockheader", [tx.blockhash, true]);
        blockHeight = numberOrNull(header?.height);
      }
      const hydratedTx = await transactionWithInputPrevouts({
        ...tx,
        blocktime:
          tx.blocktime ??
          tx.time ??
          Math.floor(Date.parse(row.block_time ?? row.event_time ?? "") / 1000),
        height: blockHeight,
      });
      const items = protocolMessagesFromTx(hydratedTx)
        .flatMap((message) => protocolItemsFromTx(hydratedTx, message))
        .filter(
          (item) =>
            item?.kind === "token-transfer" &&
            String(item?.tokenId ?? "").toLowerCase() === WORK_TOKEN_ID &&
            item?.senderAddress &&
            item?.recipientAddress,
        )
        .map((item) => ({
          ...item,
          validationMode: "confirmed-event-participant-repair",
        }));
      if (items.length === 0) {
        throw new Error(
          "transaction does not contain a confirmed WORK transfer with resolvable participants",
        );
      }

      await client.query("BEGIN");
      try {
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
        throw error;
      }
    } catch (error) {
      skipped += 1;
      failures.push({ error: error?.message ?? String(error), txid });
      console.error(
        JSON.stringify({
          error: error?.message ?? String(error),
          phase: "repair-work-participants",
          txid,
        }),
      );
    }
  }
  if (failures.length > 0) {
    throw new Error(
      `WORK participant repair failed for ${failures.length} transaction(s): ${failures
        .map((failure) => failure.txid)
        .join(",")}`,
    );
  }
  return {
    indexed,
    requested: REPAIR_WORK_PARTICIPANTS_TXIDS.length,
    scanned: rowsByTxid.size,
    skipped,
    source: "repair-work-participants",
  };
}

async function repairMailParticipants(client) {
  const result = await client.query(
    `
      WITH participant_candidates AS (
        SELECT
          e.event_id,
          NULLIF(btrim(m.sender_address), '') AS address,
          'sender'::text AS role
        FROM proof_indexer.mail_items m
        JOIN proof_indexer.events e
          ON e.network = m.network
         AND e.txid = m.txid
        WHERE e.network = $1
          AND e.protocol = 'pwm1'
          AND e.valid IS DISTINCT FROM false

        UNION

        SELECT
          e.event_id,
          NULLIF(btrim(COALESCE(
            m.message->>'senderAddress',
            m.message->>'from'
          )), '') AS address,
          'sender'::text AS role
        FROM proof_indexer.mail_items m
        JOIN proof_indexer.events e
          ON e.network = m.network
         AND e.txid = m.txid
        WHERE e.network = $1
          AND e.protocol = 'pwm1'
          AND e.valid IS DISTINCT FROM false

        UNION

        SELECT
          e.event_id,
          NULLIF(btrim(COALESCE(
            m.message->>'recipientAddress',
            m.message->>'to'
          )), '') AS address,
          'recipient'::text AS role
        FROM proof_indexer.mail_items m
        JOIN proof_indexer.events e
          ON e.network = m.network
         AND e.txid = m.txid
        WHERE e.network = $1
          AND e.protocol = 'pwm1'
          AND e.valid IS DISTINCT FROM false

        UNION

        SELECT
          e.event_id,
          NULLIF(btrim(COALESCE(
            recipient.record->>'address',
            recipient.record->>'display'
          )), '') AS address,
          'recipient'::text AS role
        FROM proof_indexer.mail_items m
        JOIN proof_indexer.events e
          ON e.network = m.network
         AND e.txid = m.txid
        CROSS JOIN LATERAL jsonb_array_elements(
          CASE
            WHEN jsonb_typeof(m.message->'recipients') = 'array'
              THEN m.message->'recipients'
            ELSE '[]'::jsonb
          END
        ) recipient(record)
        WHERE e.network = $1
          AND e.protocol = 'pwm1'
          AND e.valid IS DISTINCT FROM false
      )
      INSERT INTO proof_indexer.event_participants (
        event_id,
        address,
        role,
        powid
      )
      SELECT
        event_id,
        address,
        role,
        ''
      FROM participant_candidates
      WHERE address IS NOT NULL
        AND address !~ '\\s'
      ON CONFLICT (event_id, address, role) DO NOTHING
      RETURNING event_id
    `,
    [NETWORK],
  );
  return {
    indexed: result.rows.length,
    skipped: 0,
    source: "repair-mail-participants",
  };
}

async function repairConfirmedListingSealMetadata(client) {
  const result = await client.query(
    `
      WITH confirmed_seals AS (
        SELECT DISTINCT ON (lower(e.payload->>'listingId'))
          lower(e.payload->>'listingId') AS listing_id,
          lower(COALESCE(NULLIF(e.payload->>'sealTxid', ''), e.txid)) AS seal_txid,
          e.payload
        FROM proof_indexer.events e
        WHERE e.network = $1
          AND e.protocol = 'pwt1'
          AND e.kind = 'token-listing-sealed'
          AND e.status = 'confirmed'
          AND e.valid = true
          AND e.payload->>'listingId' ~ '^[0-9a-fA-F]{64}$'
        ORDER BY
          lower(e.payload->>'listingId'),
          e.block_height DESC NULLS LAST,
          e.event_id DESC
      )
      UPDATE proof_indexer.credit_listings cl
      SET
        sale_ticket_txid = CASE
          WHEN cl.sale_ticket_txid IS NULL OR cl.sale_ticket_txid = seals.seal_txid
            THEN seals.listing_id
          ELSE cl.sale_ticket_txid
        END,
        sale_ticket_vout = COALESCE(
          cl.sale_ticket_vout,
          CASE
            WHEN seals.payload->>'saleTicketVout' ~ '^[0-9]+$'
              THEN (seals.payload->>'saleTicketVout')::integer
            ELSE NULL
          END,
          2
        ),
        sale_ticket_value_sats = COALESCE(
          cl.sale_ticket_value_sats,
          CASE
            WHEN seals.payload->>'saleTicketValueSats' ~ '^[0-9]+$'
              THEN (seals.payload->>'saleTicketValueSats')::bigint
            ELSE NULL
          END,
          546
        ),
        seal_txid = seals.seal_txid,
        payload = cl.payload || jsonb_strip_nulls(
          jsonb_build_object(
            'saleAuthorization', seals.payload->'saleAuthorization',
            'sealAt', NULLIF(seals.payload->>'sealAt', ''),
            'sealBlockHeight', CASE
              WHEN seals.payload->>'sealBlockHeight' ~ '^[0-9]+$'
                THEN (seals.payload->>'sealBlockHeight')::integer
              ELSE NULL
            END,
            'sealConfirmed', true,
            'sealDataBytes', CASE
              WHEN seals.payload->>'sealDataBytes' ~ '^[0-9]+$'
                THEN (seals.payload->>'sealDataBytes')::integer
              ELSE NULL
            END,
            'sealMinerFeeSats', CASE
              WHEN seals.payload->>'sealMinerFeeSats' ~ '^[0-9]+$'
                THEN (seals.payload->>'sealMinerFeeSats')::bigint
              ELSE NULL
            END,
            'sealTxid', seals.seal_txid
          )
        ),
        updated_at = now()
      FROM confirmed_seals seals
      WHERE cl.network = $1
        AND cl.listing_id = seals.listing_id
        AND (
          COALESCE(cl.seal_txid, '') <> seals.seal_txid
          OR COALESCE(cl.payload->>'sealTxid', '') <> seals.seal_txid
          OR cl.payload->>'sealConfirmed' IS DISTINCT FROM 'true'
        )
      RETURNING cl.listing_id
    `,
    [NETWORK],
  );
  return {
    indexed: result.rows.length,
    skipped: 0,
    source: "repair-listing-seal-metadata",
  };
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

async function canonicalIdRepairTarget(txid) {
  const raw = await rawTransactionFromCore(txid);
  const blockHash = String(raw?.blockhash ?? "").trim().toLowerCase();
  if (
    !raw ||
    Number(raw?.confirmations) <= 0 ||
    !/^[0-9a-f]{64}$/u.test(blockHash)
  ) {
    throw new Error(`Canonical ID repair transaction ${txid} is not confirmed.`);
  }
  const block = await bitcoinRpc("getblock", [blockHash, 2]);
  const height = Number(block?.height);
  assertCanonicalBlockEnvelope(block, height, blockHash);
  const blockIndex = (Array.isArray(block?.tx) ? block.tx : []).findIndex(
    (candidate) => String(candidate?.txid ?? "").trim().toLowerCase() === txid,
  );
  if (blockIndex < 0) {
    throw new Error(
      `Canonical ID repair transaction ${txid} is absent from block ${blockHash}.`,
    );
  }
  const hydrated = await transactionWithInputPrevouts({
    ...block.tx[blockIndex],
    _powBlockHash: blockHash,
    _powBlockIndex: blockIndex,
    _powPreviousBlockHash: String(block?.previousblockhash ?? "")
      .trim()
      .toLowerCase(),
    blocktime: block?.time,
    height,
  });
  assertHydratedProtocolTransaction(hydrated);
  const messages = protocolMessagesFromTx(hydrated).filter(
    (message) => message?.prefix === "pwid1:",
  );
  const rawItems = messages.flatMap((message) =>
    protocolItemsFromTx(hydrated, message),
  );
  const ids = [
    ...new Set(
      rawItems
        .map((item) => normalizedPowId(item?.id))
        .filter(Boolean),
    ),
  ];
  if (messages.length === 0 || rawItems.length === 0 || ids.length === 0) {
    throw new Error(
      `Canonical ID repair transaction ${txid} has no parseable pwid1 event.`,
    );
  }
  return { block, blockHash, height, hydrated, ids, messages, rawItems, txid };
}

async function repairCanonicalIdTransactions(client) {
  const targets = [];
  for (const txid of REPAIR_ID_TXIDS) {
    targets.push(await canonicalIdRepairTarget(txid));
  }
  targets.sort(
    (left, right) =>
      left.height - right.height ||
      Number(left.hydrated?._powBlockIndex ?? 0) -
        Number(right.hydrated?._powBlockIndex ?? 0) ||
      left.txid.localeCompare(right.txid),
  );
  const affectedIds = [
    ...new Set(targets.flatMap((target) => target.ids)),
  ];
  for (const id of affectedIds) {
    if (
      !targets.some((target) =>
        target.rawItems.some(
          (item) => item?.kind === "id-register" && normalizedPowId(item?.id) === id,
        ),
      )
    ) {
      throw new Error(
        `Canonical ID repair for ${id} must include its registration transaction.`,
      );
    }
  }

  await client.query("BEGIN");
  try {
    await client.query(
      `
        DELETE FROM proof_indexer.event_participants
        WHERE event_id IN (
          SELECT event_id
          FROM proof_indexer.events
          WHERE network = $1
            AND txid = ANY($2::text[])
            AND (protocol = 'pwid1' OR kind LIKE 'id-%')
        )
      `,
      [NETWORK, REPAIR_ID_TXIDS],
    );
    await client.query(
      `
        DELETE FROM proof_indexer.event_refs
        WHERE event_id IN (
          SELECT event_id
          FROM proof_indexer.events
          WHERE network = $1
            AND txid = ANY($2::text[])
            AND (protocol = 'pwid1' OR kind LIKE 'id-%')
        )
      `,
      [NETWORK, REPAIR_ID_TXIDS],
    );
    await client.query(
      `
        DELETE FROM proof_indexer.events
        WHERE network = $1
          AND txid = ANY($2::text[])
          AND (protocol = 'pwid1' OR kind LIKE 'id-%')
      `,
      [NETWORK, REPAIR_ID_TXIDS],
    );
    await client.query(
      `
        DELETE FROM proof_indexer.id_records
        WHERE network = $1
          AND id_lower = ANY($2::text[])
      `,
      [NETWORK, affectedIds],
    );
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  }

  let indexed = 0;
  for (const target of targets) {
    const prepared = await preparedProtocolItemsForTx(
      target.hydrated,
      target.messages,
    );
    if (
      prepared.length === 0 ||
      prepared.some(
        (entry) =>
          entry?.item?.valid === false ||
          !String(entry?.item?.kind ?? "").startsWith("id-"),
      )
    ) {
      throw new Error(
        `Canonical ID repair verifier did not return only valid ID events for ${target.txid}.`,
      );
    }
    await client.query("BEGIN");
    try {
      await persistCanonicalBlock(
        client,
        target.block,
        target.height,
        target.blockHash,
      );
      await persistCanonicalRawTransaction(client, target.hydrated, {
        blockHash: target.blockHash,
        blockTime: target.block?.time,
        height: target.height,
      });
      const result = await persistPreparedProtocolItems(client, prepared);
      indexed += result.indexed;
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    }
  }

  const verification = await client.query(
    `
      SELECT
        (SELECT count(*)
         FROM proof_indexer.id_records
         WHERE network = $1
           AND id_lower = ANY($2::text[])) AS records,
        (SELECT count(*)
         FROM proof_indexer.events
         WHERE network = $1
           AND txid = ANY($3::text[])
           AND (valid = false OR kind LIKE '%-invalid')) AS invalid_events
    `,
    [NETWORK, affectedIds, REPAIR_ID_TXIDS],
  );
  const records = Number(verification.rows[0]?.records ?? 0);
  const invalidEvents = Number(verification.rows[0]?.invalid_events ?? 0);
  if (records !== affectedIds.length || invalidEvents !== 0) {
    throw new Error(
      `Canonical ID repair verification failed: records=${records}/${affectedIds.length}, invalidEvents=${invalidEvents}.`,
    );
  }
  return {
    affectedIds,
    indexed,
    invalidEvents,
    records,
    source: "repair-canonical-id-transactions",
    txids: targets.map((target) => target.txid),
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
        repairIdTxids: REPAIR_ID_TXIDS,
        repairIdTxidsOnly: REPAIR_ID_TXIDS_ONLY,
        repairWorkParticipants: REPAIR_WORK_PARTICIPANTS,
        repairWorkParticipantsOnly: REPAIR_WORK_PARTICIPANTS_ONLY,
        repairWorkParticipantsTxids: REPAIR_WORK_PARTICIPANTS_TXIDS,
        scopedHolders: INCLUDE_SCOPED_HOLDERS,
        prepareCanonicalRebuildOnly: PREPARE_CANONICAL_REBUILD_ONLY,
        prepareCanonicalPwtRangeReplayOnly:
          PREPARE_CANONICAL_PWT_RANGE_REPLAY_ONLY,
        sources: SOURCES.map((source) => source.label),
        storeCanonicalSummarySnapshot: STORE_CANONICAL_SUMMARY_SNAPSHOT,
        storeLedgerSnapshot: STORE_LEDGER_SNAPSHOT,
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
    if (PREPARE_CANONICAL_PWT_RANGE_REPLAY_ONLY) {
      const prepared = await prepareCanonicalPwtRangeReplay(client);
      console.log(
        JSON.stringify(
          {
            canonicalPwtRangeReplayPrepared: true,
            network: NETWORK,
            ok: true,
            resumed: prepared?.resumed === true,
            state: prepared?.value ?? null,
            baseDefinitions: prepared?.baseDefinitions ?? null,
            baseMarketplaceEvents: prepared?.baseMarketplaceEvents ?? null,
          },
          null,
          2,
        ),
      );
    } else if (PREPARE_CANONICAL_REBUILD_ONLY) {
      const prepared = await prepareCanonicalRebuild(client);
      console.log(
        JSON.stringify(
          {
            canonicalRebuildPrepared: true,
            network: NETWORK,
            ok: true,
            resumed: prepared?.resumed === true,
            state: prepared?.value ?? null,
          },
          null,
          2,
        ),
      );
    } else if (REPAIR_ID_TXIDS_ONLY) {
      const repair = await repairCanonicalIdTransactions(client);
      console.log(
        JSON.stringify(
          {
            apiBase: API_BASE,
            canonicalIdRepair: true,
            network: NETWORK,
            ok: true,
            repair,
          },
          null,
          2,
        ),
      );
    } else if (DB_SUMMARY_REPAIR) {
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
      if (!REPAIR_WORK_PARTICIPANTS_ONLY) {
        for (const source of SOURCES) {
          results.push(await backfillSource(client, source));
        }
        results.push(await repairMailParticipants(client));
        results.push(await repairConfirmedListingSealMetadata(client));
      }
      results.push(await repairConfirmedWorkTransferParticipants(client));
      if (REPAIR_WORK_PARTICIPANTS_ONLY) {
        console.log(
          JSON.stringify(
            {
              apiBase: API_BASE,
              network: NETWORK,
              ok: true,
              repairWorkParticipantsOnly: true,
              results,
            },
            null,
            2,
          ),
        );
        process.exitCode = 0;
      } else {
        results.push(await repairWorkMintMinterAttribution(client));
        results.push(await backfillScopedTokenHolders(client));
        const snapshot = STORE_LEDGER_SNAPSHOT
          ? await storeLedgerSnapshot(client)
          : null;
        const canonicalSummarySnapshot = STORE_CANONICAL_SUMMARY_SNAPSHOT
          ? await storeCanonicalSummarySnapshot(client)
          : null;
        console.log(
          JSON.stringify(
            {
              apiBase: API_BASE,
              network: NETWORK,
              ok: true,
              results,
              canonicalSummarySnapshot,
              snapshotId: snapshot?.snapshotId ?? null,
              storeCanonicalSummarySnapshot: STORE_CANONICAL_SUMMARY_SNAPSHOT,
              storeLedgerSnapshot: STORE_LEDGER_SNAPSHOT,
            },
            null,
            2,
          ),
        );
      }
    }
  } finally {
    client.release();
  }
} finally {
  await pool.end();
}
