#!/usr/bin/env node

import fs from "node:fs/promises";
import http from "node:http";
import net from "node:net";
import path from "node:path";
import { URL } from "node:url";
import bip322 from "bip322-js";
import * as bitcoin from "bitcoinjs-lib";
import * as ecc from "@bitcoinerlab/secp256k1";
import {
  errorResponse,
  jsonResponse,
  optionsResponse,
  writeJsonBody,
} from "./http/responses.mjs";

bitcoin.initEccLib(ecc);
const { Verifier } = bip322;

const HOST = process.env.HOST ?? "127.0.0.1";
const PORT = Number(process.env.PORT ?? 8081);
const MEMPOOL_BASE_MAINNET = nodeApiBase(
  process.env.MEMPOOL_BASE ?? "http://127.0.0.1:8080",
);
const PENDING_MEMPOOL_BASE_MAINNET = nodeApiBase(
  process.env.PENDING_MEMPOOL_BASE ?? MEMPOOL_BASE_MAINNET,
);
const MEMPOOL_BASE_TESTNET = nodeApiBase(process.env.MEMPOOL_BASE_TESTNET ?? "");
const MEMPOOL_BASE_TESTNET4 = nodeApiBase(process.env.MEMPOOL_BASE_TESTNET4 ?? "");
const BITCOIN_RPC_URL = String(process.env.BITCOIN_RPC_URL ?? "").trim();
const BITCOIN_RPC_USER = String(process.env.BITCOIN_RPC_USER ?? "").trim();
const BITCOIN_RPC_PASSWORD = String(
  process.env.BITCOIN_RPC_PASSWORD ?? "",
).trim();
const ELECTRUM_HOST = process.env.ELECTRUM_HOST ?? "127.0.0.1";
const ELECTRUM_PORT = Number(process.env.ELECTRUM_PORT ?? 50001);
const MAX_REGISTRY_TX_PAGES = Number(process.env.MAX_REGISTRY_TX_PAGES ?? 250);
const MAX_ADDRESS_TX_PAGES = Number(process.env.MAX_ADDRESS_TX_PAGES ?? 50);
const MAX_ACTIVITY_ADDRESSES = Number(
  process.env.MAX_ACTIVITY_ADDRESSES ?? 500,
);
const SEEDED_MAIL_ACTIVITY_MAX_ADDRESSES = Number(
  process.env.SEEDED_MAIL_ACTIVITY_MAX_ADDRESSES ?? MAX_ACTIVITY_ADDRESSES,
);
const MAX_ACTIVITY_ADDRESS_GRAPH_PASSES = Number(
  process.env.MAX_ACTIVITY_ADDRESS_GRAPH_PASSES ?? 1,
);
const HEAVY_READ_STALE_MS = Number(
  process.env.HEAVY_READ_STALE_MS ?? 24 * 60 * 60_000,
);
const REGISTRY_CACHE_TTL_MS = Number(
  process.env.REGISTRY_CACHE_TTL_MS ?? 60_000,
);
const REGISTRY_CACHE_STALE_MS = Number(
  process.env.REGISTRY_CACHE_STALE_MS ?? HEAVY_READ_STALE_MS,
);
const ACTIVITY_CACHE_TTL_MS = Number(
  process.env.ACTIVITY_CACHE_TTL_MS ?? 60_000,
);
const ACTIVITY_CACHE_STALE_MS = Number(
  process.env.ACTIVITY_CACHE_STALE_MS ?? HEAVY_READ_STALE_MS,
);
const BACKGROUND_ACTIVITY_REFRESH_DELAY_MS = Number(
  process.env.BACKGROUND_ACTIVITY_REFRESH_DELAY_MS ?? 1000,
);
const BACKGROUND_ACTIVITY_REFRESH_INTERVAL_MS = Number(
  process.env.BACKGROUND_ACTIVITY_REFRESH_INTERVAL_MS ?? 30_000,
);
const BACKGROUND_REGISTRY_REFRESH_INTERVAL_MS = Number(
  process.env.BACKGROUND_REGISTRY_REFRESH_INTERVAL_MS ?? 60_000,
);
const BACKGROUND_TOKEN_REFRESH_INTERVAL_MS = Number(
  process.env.BACKGROUND_TOKEN_REFRESH_INTERVAL_MS ?? 5 * 60_000,
);
const BACKGROUND_WORK_TOKEN_REFRESH_INTERVAL_MS = Number(
  process.env.BACKGROUND_WORK_TOKEN_REFRESH_INTERVAL_MS ?? 10 * 60_000,
);
const BACKGROUND_DERIVED_REFRESH_INTERVAL_MS = Number(
  process.env.BACKGROUND_DERIVED_REFRESH_INTERVAL_MS ?? 15_000,
);
const BACKGROUND_STARTUP_REFRESH_DELAY_MS = Number(
  process.env.BACKGROUND_STARTUP_REFRESH_DELAY_MS ?? 2_500,
);
const ENABLE_GLOBAL_ACTIVITY_CRAWL = ["1", "true", "yes"].includes(
  String(process.env.ENABLE_GLOBAL_ACTIVITY_CRAWL ?? "").toLowerCase(),
);
const ENABLE_SUMMARY_TOKEN_REFRESH = ["1", "true", "yes"].includes(
  String(process.env.ENABLE_SUMMARY_TOKEN_REFRESH ?? "").toLowerCase(),
);
const DERIVED_APP_CACHE_TTL_MS = Number(
  process.env.DERIVED_APP_CACHE_TTL_MS ?? 15 * 60_000,
);
const DERIVED_APP_CACHE_STALE_MS = Number(
  process.env.DERIVED_APP_CACHE_STALE_MS ?? HEAVY_READ_STALE_MS,
);
const RESPONSE_CACHE_TTL_MS = Number(
  process.env.RESPONSE_CACHE_TTL_MS ?? 15_000,
);
const RESPONSE_CACHE_STALE_MS = Number(
  process.env.RESPONSE_CACHE_STALE_MS ?? 10 * 60_000,
);
const TOKEN_CACHE_TTL_MS = Number(process.env.TOKEN_CACHE_TTL_MS ?? 60_000);
const TOKEN_CACHE_STALE_MS = Number(
  process.env.TOKEN_CACHE_STALE_MS ?? HEAVY_READ_STALE_MS,
);
const WORK_FLOOR_CACHE_TTL_MS = Number(
  process.env.WORK_FLOOR_CACHE_TTL_MS ?? 15_000,
);
const WORK_FLOOR_CACHE_STALE_MS = Number(
  process.env.WORK_FLOOR_CACHE_STALE_MS ?? 5 * 60_000,
);
const LEDGER_CACHE_TTL_MS = Number(
  process.env.LEDGER_CACHE_TTL_MS ?? WORK_FLOOR_CACHE_TTL_MS,
);
const LEDGER_CACHE_STALE_MS = Number(
  process.env.LEDGER_CACHE_STALE_MS ?? WORK_FLOOR_CACHE_STALE_MS,
);
const LEDGER_FRESH_MIN_INTERVAL_MS = Number(
  process.env.LEDGER_FRESH_MIN_INTERVAL_MS ?? 60_000,
);
const WORK_FLOOR_FRESH_WAIT_MS = Number(
  process.env.WORK_FLOOR_FRESH_WAIT_MS ?? 1500,
);
const WORK_TOKEN_LIVE_WAIT_MS = Number(
  process.env.WORK_TOKEN_LIVE_WAIT_MS ?? WORK_FLOOR_FRESH_WAIT_MS,
);
const TOKEN_MARKET_OUTSPEND_CACHE_TTL_MS = Number(
  process.env.TOKEN_MARKET_OUTSPEND_CACHE_TTL_MS ?? 10 * 60_000,
);
const TOKEN_MARKET_OUTSPEND_CACHE_STALE_MS = Number(
  process.env.TOKEN_MARKET_OUTSPEND_CACHE_STALE_MS ?? HEAVY_READ_STALE_MS,
);
const WORK_TOKEN_LIVE_DELTA_MAX_TXS = Number(
  process.env.WORK_TOKEN_LIVE_DELTA_MAX_TXS ?? 1500,
);
const WORK_TOKEN_LIVE_PENDING_CONFIRMATION_MAX_TXS = Number(
  process.env.WORK_TOKEN_LIVE_PENDING_CONFIRMATION_MAX_TXS ?? 0,
);
const WORK_TOKEN_LIVE_RECENT_MAX_TXS = Number(
  process.env.WORK_TOKEN_LIVE_RECENT_MAX_TXS ?? 40,
);
const WORK_TOKEN_LIVE_HISTORY_MAX_TXS = Number(
  process.env.WORK_TOKEN_LIVE_HISTORY_MAX_TXS ?? 40,
);
const SUMMARY_ACTIVITY_LIMIT = Number(process.env.SUMMARY_ACTIVITY_LIMIT ?? 60);
const SUMMARY_MARKET_LIMIT = Number(process.env.SUMMARY_MARKET_LIMIT ?? 40);
const HISTORY_PAGE_DEFAULT_LIMIT = Number(
  process.env.HISTORY_PAGE_DEFAULT_LIMIT ?? 50,
);
const HISTORY_PAGE_MAX_LIMIT = Number(process.env.HISTORY_PAGE_MAX_LIMIT ?? 200);
const BTC_USD_PRICE_CACHE_TTL_MS = Number(
  process.env.BTC_USD_PRICE_CACHE_TTL_MS ?? 60_000,
);
const BTC_USD_PRICE_FETCH_TIMEOUT_MS = Number(
  process.env.BTC_USD_PRICE_FETCH_TIMEOUT_MS ?? 8_000,
);
const TX_FETCH_CONCURRENCY = Number(process.env.TX_FETCH_CONCURRENCY ?? 8);
const SEEDED_MAIL_ACTIVITY_CONCURRENCY = Number(
  process.env.SEEDED_MAIL_ACTIVITY_CONCURRENCY ??
    Math.min(8, TX_FETCH_CONCURRENCY),
);
const BLOCK_TXID_FETCH_CONCURRENCY = Number(
  process.env.BLOCK_TXID_FETCH_CONCURRENCY ?? 4,
);
const MAX_TRANSACTION_CACHE_SIZE = Number(
  process.env.MAX_TRANSACTION_CACHE_SIZE ?? 100_000,
);
const PENDING_TOKEN_TRANSACTION_CACHE_TTL_MS = Number(
  process.env.PENDING_TOKEN_TRANSACTION_CACHE_TTL_MS ?? 24 * 60 * 60_000,
);
const PENDING_TOKEN_TRANSACTION_CACHE_MAX_SIZE = Number(
  process.env.PENDING_TOKEN_TRANSACTION_CACHE_MAX_SIZE ?? 5000,
);
const PERSISTED_CACHE_DIR =
  process.env.POW_API_CACHE_DIR ?? path.join(process.cwd(), ".pow-api-cache");
const SLIPSTREAM_SUBMIT_TX_URL = "https://slipstream.mara.com/api/transactions";
const SLIPSTREAM_TX_URL = "https://slipstream.mara.com/tx";
const SLIPSTREAM_CLIENT_CODE = String(
  process.env.SLIPSTREAM_CLIENT_CODE ?? process.env.MARA_SLIPSTREAM_CLIENT_CODE ?? "",
).trim();
const SLIPSTREAM_CLIENT_CODE_REQUIRED_MESSAGE =
  "MARA Slipstream currently requires a client code for direct transaction submission.";

const PROTOCOL_PREFIX = "pwm1:";
const ID_PROTOCOL_PREFIX = "pwid1:";
const TOKEN_PROTOCOL_PREFIX = "pwt1:";
const RUSH_PROTOCOL_PREFIX = "pwr1:";
const RUSH_MINT_PAYLOAD = "pwr1:m:rush";
const INFINITY_BOND_MEMO = "powb";
const ID_REGISTRATION_PRICE_SATS = 1000;
const ID_MUTATION_PRICE_SATS = 546;
const TOKEN_CREATE_ACTION = "create";
const TOKEN_MINT_ACTION = "mint";
const TOKEN_SEND_ACTION = "send";
const TOKEN_LIST_ACTION = "list5";
const TOKEN_SEAL_ACTION = "seal5";
const TOKEN_DELIST_ACTION = "delist5";
const TOKEN_BUY_ACTION = "buy5";
const TOKEN_SALE_AUTH_VERSION = "pwt-sale-v1";
const TOKEN_CREATION_PRICE_SATS = 546;
const TOKEN_MIN_MUTATION_PRICE_SATS = 546;
const TOKEN_LISTING_ANCHOR_TYPE = "sale-ticket-v1";
const TOKEN_LISTING_ANCHOR_VALUE_SATS = 546;
const TOKEN_LISTING_ANCHOR_VOUT = 2;
const TOKEN_LISTING_ANCHOR_SIGHASH_TYPE =
  bitcoin.Transaction.SIGHASH_SINGLE | bitcoin.Transaction.SIGHASH_ANYONECANPAY;
const TOKEN_INDEX_ID = "tokens@proofofwork.me";
const TOKEN_INDEX_TXID =
  "7a8845f33823305fabd818b3a3e2f06a175b29bf55dd79a2f83365251a6d5d19";
const WORK_TOKEN_TICKER = "WORK";
const WORK_TOKEN_MAX_SUPPLY = 21_000_000;
const WORK_TOKEN_MINT_AMOUNT = 1000;
const WORK_TOKEN_MINT_PRICE_SATS = 1000;
const WORK_TOKEN_PRICE_SATS_PER_WORK = 1;
const WORK_TOKEN_ID =
  "d4e5ebf11d104d6a63fb74e42094364b25a5f7199a09e5c0e71408972466a8b8";
const BLOCKED_TOKEN_CREATOR_ADDRESSES = new Set([
  "bc1qcf57sgazj4gcd0yfxste3eaa35eltj48sgrvjl",
]);
const WORK_TOKEN_DEFAULT_REGISTRY_ADDRESS =
  "1638Vn6KtmK8p5r4oGvAXq9nmZb1emU1DV";
const WORK_TOKEN_CREATED_AT = "2026-05-15T02:57:28.000Z";
const WORK_TOKEN_CREATE_DATA_BYTES = 70;
const FULL_ACTIVITY_HISTORY_ADDRESSES = {
  livenet: new Set(
    String(
      process.env.FULL_ACTIVITY_HISTORY_ADDRESSES_LIVENET ??
        [
          "1H1arP2xpam6MZmHt6k1tB83stqVdH6ANK",
          "1F1p9UEHuH5KTFR7Zsx93Khdrqhj6t5nFv",
          "bc1p0uxp0axptr8rg9dndgtlwxn00j4hq8m88kg80tqd0t6045putwhq5ca7ed",
          "bc1parjksvz4hetpmqwtka9wuzl9skhq8y3weusenf8e3qrguqhypweqtpmz2g",
          "bc1p0e5qs2vcu6c50t6xwxuk7yfnqpwtm03rclv7wzgxzk37849xt8fssl6zvd",
        ].join(","),
    )
      .split(/[,\s]+/u)
      .filter(Boolean),
  ),
};
const GROWTH_MODEL_START_MS = Date.parse("2026-05-11T00:00:00.000Z");
const MS_PER_MODEL_YEAR = 365 * 24 * 60 * 60 * 1000;
const MAX_GROWTH_ACTUAL_CHART_EVENTS = 240;
const GROWTH_MODEL_INPUTS = {
  currentBtcUsd: 80_879.33,
  historicalBtcUsd: 452.73,
  btcBenchmarkYears: 10,
  idDensitySatsPerN2: 268.68933906745133,
  valueMultiple: 5,
};
const BTC_USD_PRICE = Number(
  process.env.BTC_USD_PRICE ?? GROWTH_MODEL_INPUTS.currentBtcUsd,
);
const ID_SALE_AUTH_VERSION_LEGACY = "pwid-sale-v1";
const ID_SALE_AUTH_VERSION_ANCHORED = "pwid-sale-v2";
const ID_SALE_AUTH_VERSION = "pwid-sale-v3";
const ID_SALE_AUTH_VERSION_TICKET = "pwid-sale-v4";
const ID_LISTING_ANCHOR_TYPE_LEGACY = "p2wsh-op-true-v1";
const ID_LISTING_ANCHOR_TYPE = "seller-utxo-v1";
const ID_LISTING_TICKET_ANCHOR_TYPE = "sale-ticket-v1";
const ID_LISTING_ANCHOR_VALUE_SATS = 546;
const ID_LISTING_ANCHOR_VOUT = 2;
const ID_LISTING_ANCHOR_SIGHASH_TYPE =
  bitcoin.Transaction.SIGHASH_SINGLE | bitcoin.Transaction.SIGHASH_ANYONECANPAY;
const MAX_ATTACHMENT_BYTES = 60_000;
const ID_REGISTRY_ADDRESSES = {
  livenet: "bc1qfwytlzyr3ym3enz2eutwtjsf9kkf6uqkjydk3e",
};
const TOKEN_INDEX_ADDRESSES = {
  livenet: "1L4xrDurN9VghknrbsSju2vQb6oXZe1Pbn",
};
const RUSH_REGISTRY_ADDRESSES = {
  livenet: "bc1qym392dfvfm024k7ukzlnvnpfvuu4kfqvu56w3e",
  testnet4: "tb1qyh9pgznpass4mjcl8qj9yxs3vvl9rnrk5gvw6q",
};
const RUSH_MINT_PRICE_SATS = 1000;
const RUSH_DECIMALS = 6n;
const RUSH_BASE_UNITS = 1_000_000n;
const RUSH_TOTAL_SUPPLY_UNITS = 1_000_000_000n * RUSH_BASE_UNITS;
const RUSH_MAX_REWARDED_MINTS = 50_000;
const RUSH_PHASES = [
  {
    endOrdinal: 5000,
    phase: 1,
    rewardUnits: 50_000n * RUSH_BASE_UNITS,
    startOrdinal: 1,
  },
  {
    endOrdinal: 15000,
    phase: 2,
    rewardUnits: 30_000n * RUSH_BASE_UNITS,
    startOrdinal: 5001,
  },
  {
    endOrdinal: 30000,
    phase: 3,
    rewardUnits: 18_000n * RUSH_BASE_UNITS,
    startOrdinal: 15001,
  },
  {
    endOrdinal: 45000,
    phase: 4,
    rewardUnits: 10_000n * RUSH_BASE_UNITS,
    startOrdinal: 30001,
  },
  {
    endOrdinal: 50000,
    phase: 5,
    rewardUnits: 6_000n * RUSH_BASE_UNITS,
    startOrdinal: 45001,
  },
];

const NETWORKS = new Set(["livenet", "testnet", "testnet4"]);
const BLOCK_TXID_INDEX_CACHE = new Map();
const TRANSACTION_CACHE = new Map();
const PENDING_TOKEN_TRANSACTION_CACHE = new Map();
const GLOBAL_ACTIVITY_CACHE = new Map();
const BACKGROUND_ACTIVITY_REFRESHES = new Set();
const BACKGROUND_LEDGER_REFRESHES = new Set();
const BACKGROUND_PAYLOAD_REFRESHES = new Set();
const BACKGROUND_TOKEN_REFRESHES = new Set();
const BACKGROUND_REFRESH_LAST_STARTED = new Map();
const RESPONSE_CACHE = new Map();
const WORK_TOKEN_LIVE_SEEN_TXIDS = new Map();
const TOKEN_MARKET_OUTSPEND_CACHE = new Map();
let persistedCacheWriteSequence = 0;
let btcUsdPriceCache = null;
const HEAVY_READ_STALE_SECONDS = Math.max(
  60,
  Math.floor(HEAVY_READ_STALE_MS / 1000),
);
const READ_CACHE_CONTROL =
  "public, max-age=15, stale-while-revalidate=60, stale-if-error=120";
const EXPENSIVE_READ_CACHE_CONTROL =
  `public, max-age=60, stale-while-revalidate=${HEAVY_READ_STALE_SECONDS}, stale-if-error=${HEAVY_READ_STALE_SECONDS}`;
const TOKEN_READ_CACHE_CONTROL =
  `public, max-age=60, stale-while-revalidate=${HEAVY_READ_STALE_SECONDS}, stale-if-error=${HEAVY_READ_STALE_SECONDS}`;
const FRESH_READ_CACHE_CONTROL = "no-store, max-age=0, must-revalidate";

function stripTrailingSlash(value) {
  return String(value).replace(/\/+$/u, "");
}

function nodeApiBase(value) {
  const base = stripTrailingSlash(value ?? "");
  if (/^https:\/\/mempool\.space(?:\/|$)/iu.test(base)) {
    return "";
  }

  return base;
}

function shouldPersistJsonCache(cacheKey) {
  return (
    cacheKey === "activity:livenet" ||
    cacheKey === "ledger:livenet" ||
    cacheKey === "registry:livenet" ||
    cacheKey.startsWith("token:livenet:") ||
    cacheKey === "rush:livenet" ||
    cacheKey === "work-floor:livenet" ||
    cacheKey === "growth-summary:livenet"
  );
}

function expireResponseCacheEntry(cacheKey, staleMs) {
  const cached = RESPONSE_CACHE.get(cacheKey);
  if (!cached) {
    return;
  }

  RESPONSE_CACHE.set(cacheKey, {
    ...cached,
    expiresAt: Date.now() - 1,
    staleUntil: Math.max(cached.staleUntil ?? 0, Date.now() + staleMs),
  });
}

function backgroundRefreshRecentlyStarted(cacheKey, intervalMs) {
  const interval = Math.max(0, Number(intervalMs) || 0);
  if (interval <= 0) {
    return false;
  }

  const now = Date.now();
  const lastStarted = BACKGROUND_REFRESH_LAST_STARTED.get(cacheKey) ?? 0;
  if (now - lastStarted < interval) {
    return true;
  }

  BACKGROUND_REFRESH_LAST_STARTED.set(cacheKey, now);
  return false;
}

function backgroundRefreshIntervalForCacheKey(cacheKey) {
  if (cacheKey === "registry:livenet") {
    return BACKGROUND_REGISTRY_REFRESH_INTERVAL_MS;
  }
  if (cacheKey === `token:livenet:${WORK_TOKEN_ID}`) {
    return BACKGROUND_WORK_TOKEN_REFRESH_INTERVAL_MS;
  }
  if (cacheKey.startsWith("token:livenet")) {
    return BACKGROUND_TOKEN_REFRESH_INTERVAL_MS;
  }
  if (
    cacheKey === "work-floor:livenet" ||
    cacheKey === "ledger:livenet" ||
    cacheKey === "growth-summary:livenet"
  ) {
    return BACKGROUND_DERIVED_REFRESH_INTERVAL_MS;
  }
  return BACKGROUND_DERIVED_REFRESH_INTERVAL_MS;
}

function persistedJsonCachePath(jsonKey) {
  const file = Buffer.from(jsonKey).toString("base64url") + ".json";
  return path.join(PERSISTED_CACHE_DIR, file);
}

function invalidateWorkFloorCaches(network) {
  if (network !== "livenet") {
    return;
  }

  expireResponseCacheEntry(
    `payload:ledger:${network}`,
    LEDGER_CACHE_STALE_MS,
  );
  expireResponseCacheEntry(
    `json:ledger:${network}`,
    LEDGER_CACHE_STALE_MS,
  );
  expireResponseCacheEntry(
    `payload:work-floor:${network}`,
    WORK_FLOOR_CACHE_STALE_MS,
  );
  expireResponseCacheEntry(
    `json:work-floor:${network}`,
    WORK_FLOOR_CACHE_STALE_MS,
  );
  expireResponseCacheEntry(
    `payload:growth-summary:${network}`,
    HEAVY_READ_STALE_MS,
  );
  expireResponseCacheEntry(
    `json:growth-summary:${network}`,
    HEAVY_READ_STALE_MS,
  );
}

function invalidateDerivedCachesForBaseCache(cacheKey) {
  if (
    cacheKey === "registry:livenet" ||
    cacheKey === "activity:livenet" ||
    cacheKey.startsWith("token:livenet")
  ) {
    invalidateWorkFloorCaches("livenet");
  }
}

async function readPersistedJsonCache(jsonKey) {
  try {
    const text = await fs.readFile(persistedJsonCachePath(jsonKey), "utf8");
    const parsed = JSON.parse(text);
    if (parsed && typeof parsed.body === "string") {
      return parsed.body;
    }
  } catch {
    return "";
  }

  return "";
}

async function writePersistedJsonCache(jsonKey, body) {
  try {
    await fs.mkdir(PERSISTED_CACHE_DIR, { recursive: true });
    const file = persistedJsonCachePath(jsonKey);
    persistedCacheWriteSequence += 1;
    const tempFile = `${file}.${process.pid}.${Date.now()}.${persistedCacheWriteSequence}.${process.hrtime.bigint()}.tmp`;
    await fs.writeFile(
      tempFile,
      JSON.stringify({ body, savedAt: new Date().toISOString() }),
      "utf8",
    );
    await fs.rename(tempFile, file);
  } catch (error) {
    console.error(`Persisted cache write failed for ${jsonKey}:`, error);
  }
}

function cacheJsonBody(jsonKey, body, ttlMs, staleMs) {
  RESPONSE_CACHE.set(jsonKey, {
    body,
    expiresAt: Date.now() + ttlMs,
    staleUntil: Date.now() + ttlMs + staleMs,
  });
}

async function hydratePersistedJsonCache(jsonKey, staleMs) {
  if (RESPONSE_CACHE.get(jsonKey)?.body) {
    return;
  }

  const body = await readPersistedJsonCache(jsonKey);
  if (!body) {
    return;
  }

  const now = Date.now();
  RESPONSE_CACHE.set(jsonKey, {
    body,
    expiresAt: now - 1,
    staleUntil: now + staleMs,
  });
}

async function cachedPayload(
  cacheKey,
  producer,
  ttlMs = RESPONSE_CACHE_TTL_MS,
  staleMs = RESPONSE_CACHE_STALE_MS,
) {
  const now = Date.now();
  const cached = RESPONSE_CACHE.get(cacheKey);
  if (cached?.payload && now < cached.expiresAt) {
    return cached.payload;
  }

  if (cached?.payload && now < cached.staleUntil) {
    if (!cached.promise) {
      cached.promise = producer()
        .then((payload) => {
          RESPONSE_CACHE.set(cacheKey, {
            expiresAt: Date.now() + ttlMs,
            payload,
            staleUntil: Date.now() + staleMs,
          });
          return payload;
        })
        .catch((error) => {
          RESPONSE_CACHE.set(cacheKey, {
            ...cached,
            promise: null,
          });
          console.error(`Cache refresh failed for ${cacheKey}:`, error);
          return cached.payload;
        });
      RESPONSE_CACHE.set(cacheKey, cached);
    }
    return cached.payload;
  }

  if (cached?.promise) {
    return cached.promise;
  }

  const promise = producer()
    .then((payload) => {
      RESPONSE_CACHE.set(cacheKey, {
        expiresAt: Date.now() + ttlMs,
        payload,
        staleUntil: Date.now() + staleMs,
      });
      return payload;
    })
    .catch((error) => {
      RESPONSE_CACHE.delete(cacheKey);
      throw error;
    });
  RESPONSE_CACHE.set(cacheKey, {
    expiresAt: now + ttlMs,
    payload: cached?.payload,
    promise,
    staleUntil: now + staleMs,
  });
  return promise;
}

async function cachedJsonResponse(
  response,
  cacheKey,
  producer,
  cacheControl = READ_CACHE_CONTROL,
  ttlMs = RESPONSE_CACHE_TTL_MS,
  staleMs = RESPONSE_CACHE_STALE_MS,
) {
  const jsonKey = `json:${cacheKey}`;
  const now = Date.now();
  if (shouldPersistJsonCache(cacheKey)) {
    await hydratePersistedJsonCache(jsonKey, staleMs);
  }

  const cached = RESPONSE_CACHE.get(jsonKey);
  if (cached?.body && now < cached.expiresAt) {
    writeJsonBody(response, 200, cached.body, cacheControl, "HIT");
    return;
  }

  if (cached?.body && now < cached.staleUntil) {
    if (!cached.promise) {
      cached.promise = producer()
        .then((payload) => {
          const body = JSON.stringify(payload);
          cacheJsonBody(jsonKey, body, ttlMs, staleMs);
          if (shouldPersistJsonCache(cacheKey)) {
            void writePersistedJsonCache(jsonKey, body);
          }
          invalidateDerivedCachesForBaseCache(cacheKey);
          return body;
        })
        .catch((error) => {
          RESPONSE_CACHE.set(jsonKey, {
            ...cached,
            promise: null,
          });
          console.error(`JSON cache refresh failed for ${cacheKey}:`, error);
          return cached.body;
        });
      RESPONSE_CACHE.set(jsonKey, cached);
    }
    writeJsonBody(response, 200, cached.body, cacheControl, "STALE");
    return;
  }

  if (cached?.promise) {
    const body = await cached.promise;
    writeJsonBody(response, 200, body, cacheControl, "MISS-COALESCED");
    return;
  }

  const promise = producer()
    .then((payload) => {
      const body = JSON.stringify(payload);
      cacheJsonBody(jsonKey, body, ttlMs, staleMs);
      if (shouldPersistJsonCache(cacheKey)) {
        void writePersistedJsonCache(jsonKey, body);
      }
      return body;
    })
    .catch((error) => {
      RESPONSE_CACHE.delete(jsonKey);
      throw error;
    });
  RESPONSE_CACHE.set(jsonKey, {
    body: cached?.body,
    expiresAt: now + ttlMs,
    promise,
    staleUntil: now + staleMs,
  });
  const body = await promise;
  writeJsonBody(response, 200, body, cacheControl, "MISS");
}

function refreshedJsonResponse(
  response,
  cacheKey,
  payload,
  cacheControl = FRESH_READ_CACHE_CONTROL,
  ttlMs = RESPONSE_CACHE_TTL_MS,
  staleMs = RESPONSE_CACHE_STALE_MS,
) {
  const jsonKey = `json:${cacheKey}`;
  const body = JSON.stringify(payload);
  cacheJsonBody(jsonKey, body, ttlMs, staleMs);
  if (shouldPersistJsonCache(cacheKey)) {
    void writePersistedJsonCache(jsonKey, body);
  }
  invalidateDerivedCachesForBaseCache(cacheKey);
  writeJsonBody(response, 200, body, cacheControl, "REFRESH");
}

function warmJsonCache(cacheKey, producer, ttlMs, staleMs) {
  const jsonKey = `json:${cacheKey}`;
  void (async () => {
    await hydratePersistedJsonCache(jsonKey, staleMs);
    const cached = RESPONSE_CACHE.get(jsonKey);
    if (cached?.promise) {
      return;
    }

    const promise = producer()
      .then((payload) => {
        const body = JSON.stringify(payload);
        cacheJsonBody(jsonKey, body, ttlMs, staleMs);
        void writePersistedJsonCache(jsonKey, body);
        invalidateDerivedCachesForBaseCache(cacheKey);
        return body;
      })
      .catch((error) => {
        if (cached?.body) {
          RESPONSE_CACHE.set(jsonKey, { ...cached, promise: null });
          console.error(`Startup cache refresh failed for ${cacheKey}:`, error);
          return cached.body;
        }

        RESPONSE_CACHE.delete(jsonKey);
        console.error(`Startup cache warm failed for ${cacheKey}:`, error);
        return "";
      });

    RESPONSE_CACHE.set(
      jsonKey,
      cached?.body
        ? { ...cached, promise }
        : {
            expiresAt: Date.now() + ttlMs,
            promise,
            staleUntil: Date.now() + staleMs,
          },
    );
  })();
}

function networkFromSearch(searchParams) {
  const network = searchParams.get("network") ?? "livenet";
  if (!NETWORKS.has(network)) {
    throw new Error("Unsupported network.");
  }

  return network;
}

function freshReadRequested(searchParams) {
  return ["1", "true", "yes"].includes(
    String(
      searchParams.get("fresh") ??
        searchParams.get("refresh") ??
        searchParams.get("nocache") ??
        "",
    ).toLowerCase(),
  );
}

function clearResponseCache(...cacheKeys) {
  for (const cacheKey of cacheKeys) {
    const jsonCacheKey = `json:${cacheKey}`;
    if (cacheKey.endsWith(":")) {
      for (const key of [...RESPONSE_CACHE.keys()]) {
        if (
          key === cacheKey ||
          key === jsonCacheKey ||
          key.startsWith(cacheKey) ||
          key.startsWith(jsonCacheKey)
        ) {
          RESPONSE_CACHE.delete(key);
        }
      }
      continue;
    }

    RESPONSE_CACHE.delete(cacheKey);
    RESPONSE_CACHE.delete(jsonCacheKey);
  }
}

function safeStatNumber(payload, key, fallback = 0) {
  const value = payload?.stats?.[key];
  return Number.isFinite(value) ? Number(value) : fallback;
}

function confirmedItemCount(items) {
  return Array.isArray(items)
    ? items.filter((item) => item?.confirmed).length
    : 0;
}

function errorSummary(error) {
  return error instanceof Error && error.message
    ? error.message
    : String(error);
}

function cachedJsonPayload(jsonKey) {
  const cached = RESPONSE_CACHE.get(jsonKey);
  if (!cached?.body) {
    return null;
  }

  try {
    return JSON.parse(cached.body);
  } catch {
    RESPONSE_CACHE.delete(jsonKey);
    return null;
  }
}

async function persistedPayloadForCache(cacheKey, staleMs) {
  const jsonKey = `json:${cacheKey}`;
  await hydratePersistedJsonCache(jsonKey, staleMs);
  return cachedJsonPayload(jsonKey);
}

function registryConfirmedCount(payload) {
  return Math.max(
    safeStatNumber(payload, "confirmed"),
    confirmedItemCount(payload?.records),
  );
}

function registryPayloadLooksWorse(nextPayload, previousPayload) {
  if (!previousPayload) {
    return false;
  }

  const previousConfirmed = registryConfirmedCount(previousPayload);
  const nextConfirmed = registryConfirmedCount(nextPayload);
  if (previousConfirmed === 0) {
    return false;
  }

  return nextConfirmed < previousConfirmed;
}

async function existingRegistryPayload(network) {
  const payloadKey = `payload:registry:${network}`;
  const cachedPayload = RESPONSE_CACHE.get(payloadKey)?.payload;
  if (cachedPayload) {
    return cachedPayload;
  }

  return persistedPayloadForCache(`registry:${network}`, REGISTRY_CACHE_STALE_MS);
}

async function safeRegistryPayload(network) {
  const previousPayload = await existingRegistryPayload(network);
  let nextPayload;
  try {
    nextPayload = await registryPayload(network);
  } catch (error) {
    if (previousPayload) {
      console.error(
        `Using previous registry payload for ${network} after refresh failure: ${errorSummary(error)}`,
      );
      return previousPayload;
    }
    throw error;
  }

  if (registryPayloadLooksWorse(nextPayload, previousPayload)) {
    console.error(
      `Rejected registry payload regression for ${network}: confirmed ${registryConfirmedCount(nextPayload)} < ${registryConfirmedCount(previousPayload)}.`,
    );
    return previousPayload;
  }

  return nextPayload;
}

function tokenPayloadMetrics(payload) {
  return {
    confirmedClosedListings: Array.isArray(payload?.closedListings)
      ? payload.closedListings.filter((listing) => listing?.closedConfirmed).length
      : 0,
    confirmedMints: Math.max(
      safeStatNumber(payload, "confirmedMints"),
      confirmedItemCount(payload?.mints),
    ),
    confirmedSupply: Math.max(
      Number.isFinite(payload?.confirmedSupply)
        ? Number(payload.confirmedSupply)
        : 0,
      0,
    ),
    confirmedTokens: Math.max(
      safeStatNumber(payload, "confirmedTokens"),
      confirmedItemCount(payload?.tokens),
    ),
    confirmedTransfers: Math.max(
      safeStatNumber(payload, "confirmedTransfers"),
      confirmedItemCount(payload?.transfers),
    ),
    tokenSales: Math.max(
      safeStatNumber(payload, "confirmedSales"),
      confirmedItemCount(payload?.sales),
    ),
  };
}

function canonicalWorkTokenDefinition(network = "livenet") {
  return {
    confirmed: true,
    createdAt: WORK_TOKEN_CREATED_AT,
    creationFeeSats: TOKEN_CREATION_PRICE_SATS,
    creatorAddress: tokenIndexAddressForNetwork(network) ?? "",
    dataBytes: WORK_TOKEN_CREATE_DATA_BYTES,
    maxSupply: WORK_TOKEN_MAX_SUPPLY,
    mintAmount: WORK_TOKEN_MINT_AMOUNT,
    mintPriceSats: WORK_TOKEN_MINT_PRICE_SATS,
    network,
    registryAddress: WORK_TOKEN_DEFAULT_REGISTRY_ADDRESS,
    ticker: WORK_TOKEN_TICKER,
    tokenId: WORK_TOKEN_ID,
    txid: WORK_TOKEN_ID,
  };
}

function tokenPayloadLooksWorse(nextPayload, previousPayload) {
  if (!previousPayload) {
    return false;
  }

  const next = tokenPayloadMetrics(nextPayload);
  const previous = tokenPayloadMetrics(previousPayload);
  const hasPreviousHistory = Object.values(previous).some((value) => value > 0);
  if (!hasPreviousHistory) {
    return false;
  }

  return Object.keys(previous).some((key) => next[key] < previous[key]);
}

async function existingTokenPayload(network, tokenScope = "") {
  const scope = normalizeTokenScope(tokenScope);
  const payloadKey = `payload:token:${network}:${scope}`;
  const cachedPayload = RESPONSE_CACHE.get(payloadKey)?.payload;
  if (cachedPayload) {
    return cachedPayload;
  }

  return persistedPayloadForCache(
    `token:${network}:${scope}`,
    TOKEN_CACHE_STALE_MS,
  );
}

async function safeTokenPayload(network, tokenScope = "") {
  const scope = normalizeTokenScope(tokenScope);
  let previousPayload = await existingTokenPayload(network, scope);
  if (scope === WORK_TOKEN_ID) {
    previousPayload = await liveWorkTokenState(network, previousPayload);
  }
  let nextPayload;
  try {
    nextPayload =
      scope === WORK_TOKEN_ID
        ? await workTokenPayload(network, previousPayload)
        : await tokenPayload(network, scope);
  } catch (error) {
    if (previousPayload) {
      console.error(
        `Using previous token payload for ${network}:${scope} after refresh failure: ${errorSummary(error)}`,
      );
      return previousPayload;
    }
    throw error;
  }

  if (tokenPayloadLooksWorse(nextPayload, previousPayload)) {
    console.error(
      `Rejected token payload regression for ${network}:${scope}: ${JSON.stringify(tokenPayloadMetrics(nextPayload))} < ${JSON.stringify(tokenPayloadMetrics(previousPayload))}.`,
    );
    return previousPayload;
  }

  return scope === WORK_TOKEN_ID
    ? await liveWorkTokenState(network, nextPayload)
    : nextPayload;
}

function boundedInteger(value, fallback, min, max) {
  const parsed = Number.parseInt(String(value ?? ""), 10);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }

  return Math.min(max, Math.max(min, parsed));
}

function historyPaginationFromSearch(searchParams) {
  const limit = boundedInteger(
    searchParams.get("limit"),
    HISTORY_PAGE_DEFAULT_LIMIT,
    1,
    HISTORY_PAGE_MAX_LIMIT,
  );
  const page = boundedInteger(searchParams.get("page"), 0, 0, 1_000_000);
  const cursorRaw = String(searchParams.get("cursor") ?? "").trim();
  const offset = cursorRaw
    ? boundedInteger(cursorRaw, 0, 0, 100_000_000)
    : page * limit;
  const query = String(searchParams.get("q") ?? searchParams.get("search") ?? "")
    .trim()
    .toLowerCase();

  return {
    limit,
    offset,
    page,
    query,
  };
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

function paginatedHistoryPayload({
  indexedAt,
  items,
  kind,
  network,
  pagination,
  source,
}) {
  const filtered = historyItemsMatchingQuery(items, pagination.query);
  const totalCount = filtered.length;
  const start = Math.min(pagination.offset, totalCount);
  const end = Math.min(totalCount, start + pagination.limit);
  const pageItems = filtered.slice(start, end);
  const nextCursor = end < totalCount ? String(end) : "";
  const indexedThroughBlock = indexedThroughBlockFromItems(filtered);

  return {
    cursor: String(start),
    end,
    indexedAt,
    indexedThroughBlock,
    items: pageItems,
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
}

function mempoolBase(network) {
  let base;
  if (network === "testnet4") {
    base = MEMPOOL_BASE_TESTNET4;
  } else if (network === "testnet") {
    base = MEMPOOL_BASE_TESTNET;
  } else {
    base = MEMPOOL_BASE_MAINNET;
  }

  if (!base) {
    const error = new Error(
      `No ProofOfWork node API is configured for ${network}.`,
    );
    error.statusCode = 503;
    throw error;
  }

  return base;
}

function explorerBase(network) {
  if (network === "testnet4") {
    return "https://mempool.space/testnet4";
  }

  if (network === "testnet") {
    return "https://mempool.space/testnet";
  }

  return "https://mempool.space";
}

function explorerTxUrl(txid, network) {
  return `${explorerBase(network)}/tx/${txid}`;
}

function pendingMempoolBases(network) {
  if (network !== "livenet") {
    return [
      ...new Set([mempoolBase(network), explorerBase(network)].filter(Boolean)),
    ];
  }

  return [
    ...new Set(
      [
        MEMPOOL_BASE_MAINNET,
        PENDING_MEMPOOL_BASE_MAINNET,
        explorerBase(network),
      ].filter(Boolean),
    ),
  ];
}

function registryAddressForNetwork(network) {
  return ID_REGISTRY_ADDRESSES[network] ?? "";
}

function tokenIndexAddressForNetwork(network) {
  return TOKEN_INDEX_ADDRESSES[network] ?? "";
}

async function fetchJson(url, init = {}) {
  const response = await fetch(url, {
    ...init,
    headers: {
      Accept: "application/json",
      ...(init.headers ?? {}),
    },
  });

  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new Error(
      `${url} returned ${response.status}${body ? `: ${body.slice(0, 200)}` : ""}`,
    );
  }

  return response.json();
}

async function fetchText(url) {
  const response = await fetch(url);
  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new Error(
      `${url} returned ${response.status}${body ? `: ${body.slice(0, 200)}` : ""}`,
    );
  }

  return response.text();
}

function readRequestBody(request, maxBytes = 1_000_000) {
  return new Promise((resolve, reject) => {
    let body = "";

    request.setEncoding("utf8");
    request.on("data", (chunk) => {
      body += chunk;
      if (body.length > maxBytes) {
        reject(new Error("Request body is too large."));
        request.destroy();
      }
    });
    request.on("end", () => resolve(body));
    request.on("error", reject);
  });
}

async function readJsonRequestBody(request, maxBytes) {
  const body = await readRequestBody(request, maxBytes);
  if (!body.trim()) {
    return {};
  }

  try {
    return JSON.parse(body);
  } catch {
    throw new Error("Invalid JSON request body.");
  }
}

function normalizeBroadcastTxid(value) {
  const txid = String(value ?? "").trim().toLowerCase();
  return /^[0-9a-f]{64}$/u.test(txid) ? txid : "";
}

function parseMaybeJson(text) {
  const value = String(text ?? "").trim();
  if (!value) {
    return null;
  }

  try {
    return JSON.parse(value);
  } catch {
    const firstBrace = value.indexOf("{");
    const lastBrace = value.lastIndexOf("}");
    if (firstBrace >= 0 && lastBrace > firstBrace) {
      try {
        return JSON.parse(value.slice(firstBrace, lastBrace + 1));
      } catch {
        return null;
      }
    }
  }

  return null;
}

function firstNonEmptyString(...values) {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }
  }

  return "";
}

function bitcoinRejectHint(reason, code) {
  const text = String(reason ?? "").toLowerCase();
  if (text.includes("too-long-mempool-chain")) {
    return "Too many unconfirmed ancestors. Wait for confirmations or prepare fresh confirmed UTXOs before minting again.";
  }
  if (
    text.includes("min relay fee") ||
    text.includes("mempool min fee") ||
    text.includes("insufficient fee") ||
    text.includes("fee")
  ) {
    return "The effective fee is too low for current node policy. Raise the fee rate or wait for mempool pressure to drop.";
  }
  if (
    text.includes("missingorspent") ||
    text.includes("txn-mempool-conflict") ||
    text.includes("conflict") ||
    text.includes("already spent")
  ) {
    return "One or more inputs are already spent or conflicting. Refresh wallet UTXOs and build from fresh confirmed inputs.";
  }
  if (text.includes("dust")) {
    return "One output is below dust policy. Increase the output value or remove that output.";
  }
  if (text.includes("mandatory-script-verify") || text.includes("script")) {
    return "The signature or script validation failed. Rebuild and sign a fresh transaction.";
  }
  if (text.includes("non-mandatory-script-verify")) {
    return "The transaction failed non-mandatory script policy. Rebuild and sign with a standard wallet path.";
  }
  if (Number(code) === -26) {
    return "The upstream node rejected this transaction by mempool policy or validation and did not include a more specific reason.";
  }

  return "";
}

function normalizeNodeRejectDetails(responseText, statusCode) {
  const parsed = parseMaybeJson(responseText);
  const outerErrorString =
    parsed &&
    typeof parsed === "object" &&
    typeof parsed.error === "string"
      ? parsed.error
      : "";
  const embeddedError = outerErrorString ? parseMaybeJson(outerErrorString) : null;
  const nestedError =
    parsed && typeof parsed === "object" && parsed.error && typeof parsed.error === "object"
      ? parsed.error
      : embeddedError &&
          typeof embeddedError === "object" &&
          embeddedError.error &&
          typeof embeddedError.error === "object"
        ? embeddedError.error
      : null;
  const code = Number(
    nestedError?.code ??
      (embeddedError && typeof embeddedError === "object"
        ? embeddedError.code
        : undefined) ??
      (parsed && typeof parsed === "object" ? parsed.code : undefined),
  );
  const reason = firstNonEmptyString(
    nestedError?.message,
    embeddedError && typeof embeddedError === "object"
      ? embeddedError.message
      : "",
    parsed?.message,
    parsed?.reason,
    parsed?.["reject-reason"],
    outerErrorString && !embeddedError ? outerErrorString : "",
  );
  const upstreamBody = String(responseText ?? "").trim();
  const hint = bitcoinRejectHint(reason || upstreamBody, code);
  const message = reason
    ? `Node rejected transaction: ${reason}.`
    : Number.isFinite(code)
      ? `Node rejected transaction with RPC code ${code}.`
      : upstreamBody
        ? `Node rejected transaction: ${upstreamBody}.`
        : `Node broadcast failed with HTTP ${statusCode}.`;

  return {
    code: Number.isFinite(code) ? code : undefined,
    hint: hint || undefined,
    message,
    reason: reason || undefined,
    upstreamBody: upstreamBody ? upstreamBody.slice(0, 2000) : undefined,
    upstreamStatus: statusCode,
  };
}

class BroadcastRejectError extends Error {
  constructor(details, statusCode = 400) {
    super(details.message || "Node rejected transaction.");
    this.name = "BroadcastRejectError";
    this.details = details;
    this.statusCode = statusCode;
  }
}

async function bitcoinRpc(method, params) {
  if (!BITCOIN_RPC_URL || !BITCOIN_RPC_USER || !BITCOIN_RPC_PASSWORD) {
    return null;
  }

  const authorization = Buffer.from(
    `${BITCOIN_RPC_USER}:${BITCOIN_RPC_PASSWORD}`,
  ).toString("base64");
  const response = await fetch(BITCOIN_RPC_URL, {
    body: JSON.stringify({
      id: "proofofwork-broadcast-diagnostic",
      jsonrpc: "1.0",
      method,
      params,
    }),
    headers: {
      Authorization: `Basic ${authorization}`,
      "Content-Type": "application/json",
    },
    method: "POST",
    signal: AbortSignal.timeout(10_000),
  });
  const responseText = await response.text().catch(() => "");
  const payload = parseMaybeJson(responseText);
  if (!response.ok || payload?.error) {
    return {
      error: payload?.error ?? responseText,
      ok: false,
    };
  }

  return {
    ok: true,
    result: payload?.result,
  };
}

async function testMempoolAcceptDiagnostic(txHex, network) {
  if (network !== "livenet") {
    return null;
  }

  try {
    const response = await bitcoinRpc("testmempoolaccept", [[txHex]]);
    const first = Array.isArray(response?.result) ? response.result[0] : null;
    if (!first || typeof first !== "object") {
      return null;
    }

    return {
      allowed: Boolean(first.allowed),
      rejectReason: first["reject-reason"] ?? first.rejectReason,
      vsize: first.vsize,
      fees: first.fees,
    };
  } catch {
    return null;
  }
}

async function submitSlipstreamTransaction(txHex) {
  if (!SLIPSTREAM_CLIENT_CODE) {
    throw new Error(SLIPSTREAM_CLIENT_CODE_REQUIRED_MESSAGE);
  }

  const submitBody = {
    client_code: SLIPSTREAM_CLIENT_CODE,
    tx_hex: txHex,
  };
  const response = await fetch(SLIPSTREAM_SUBMIT_TX_URL, {
    body: JSON.stringify(submitBody),
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
    },
    method: "POST",
    signal: AbortSignal.timeout(15_000),
  });
  const responseText = await response.text().catch(() => "");
  let payload = null;
  if (responseText) {
    try {
      payload = JSON.parse(responseText);
    } catch {
      payload = { message: responseText };
    }
  }

  const txid = normalizeBroadcastTxid(
    payload?.message ?? payload?.txId ?? payload?.txid ?? payload?.result,
  );
  if (!response.ok || payload?.status !== "success" || !txid) {
    const upstreamMessage = String(
      payload?.error ?? payload?.message ?? responseText ?? "",
    );
    throw new Error(
      upstreamMessage.toLowerCase().includes("client code")
        ? SLIPSTREAM_CLIENT_CODE_REQUIRED_MESSAGE
        : upstreamMessage ||
            `Slipstream broadcast failed with HTTP ${response.status}.`,
    );
  }

  return {
    ok: true,
    raw: payload,
    source: "slipstream",
    txid,
    url: `${SLIPSTREAM_TX_URL}/${txid}`,
  };
}

async function broadcastSlipstreamPayload(request) {
  const payload = await readJsonRequestBody(request, 1_000_000);
  const txHex = String(payload?.txHex ?? payload?.tx_hex ?? "").trim();
  if (!/^[0-9a-fA-F]+$/u.test(txHex) || txHex.length % 2 !== 0) {
    throw new Error("Invalid transaction hex.");
  }

  const result = await submitSlipstreamTransaction(txHex);
  await cachePendingTokenTransactionByTxid(
    result.txid,
    "livenet",
    "broadcast-slipstream",
  );
  return result;
}

async function submitNodeTransaction(txHex, network) {
  let response;
  try {
    response = await fetch(`${mempoolBase(network)}/api/tx`, {
      body: txHex,
      headers: {
        Accept: "text/plain, application/json",
        "Content-Type": "text/plain",
      },
      method: "POST",
      signal: AbortSignal.timeout(30_000),
    });
  } catch (error) {
    const message =
      error instanceof Error && error.message
        ? error.message
        : "node broadcast request failed";
    throw new BroadcastRejectError(
      {
        hint: "The transaction was not accepted by the broadcast gateway. Refresh wallet UTXOs and retry; if it persists, wait for pending ancestors to confirm.",
        message: `Node broadcast request failed: ${message}.`,
        reason: message,
      },
      503,
    );
  }
  const responseText = await response.text().catch(() => "");
  const txid = normalizeBroadcastTxid(responseText);
  if (!response.ok || !txid) {
    const details = normalizeNodeRejectDetails(responseText, response.status);
    const mempoolAccept = await testMempoolAcceptDiagnostic(txHex, network);
    if (mempoolAccept) {
      details.mempoolAccept = mempoolAccept;
      if (mempoolAccept.rejectReason) {
        details.reason = String(mempoolAccept.rejectReason);
        details.message = `Node rejected transaction: ${details.reason}.`;
        details.hint = bitcoinRejectHint(details.reason, details.code);
      }
    }
    throw new BroadcastRejectError(details);
  }

  return {
    ok: true,
    raw: responseText,
    source: "node",
    txid,
    url: explorerTxUrl(txid, network),
  };
}

async function broadcastNodePayload(request, network) {
  const payload = await readJsonRequestBody(request, 1_000_000);
  const txHex = String(payload?.txHex ?? payload?.tx_hex ?? "").trim();
  if (!/^[0-9a-fA-F]+$/u.test(txHex) || txHex.length % 2 !== 0) {
    throw new Error("Invalid transaction hex.");
  }

  const result = await submitNodeTransaction(txHex, network);
  await cachePendingTokenTransactionByTxid(
    result.txid,
    network,
    "broadcast-node",
  );
  return result;
}

function slipstreamStatusPayload() {
  return {
    clientCodeConfigured: Boolean(SLIPSTREAM_CLIENT_CODE),
    message: SLIPSTREAM_CLIENT_CODE
      ? "MARA Slipstream client code is configured."
      : SLIPSTREAM_CLIENT_CODE_REQUIRED_MESSAGE,
    ok: Boolean(SLIPSTREAM_CLIENT_CODE),
    ready: Boolean(SLIPSTREAM_CLIENT_CODE),
    source: "slipstream",
    submitUrl: SLIPSTREAM_SUBMIT_TX_URL,
  };
}

function configuredBtcUsdPrice() {
  const usd =
    Number.isFinite(BTC_USD_PRICE) && BTC_USD_PRICE > 0
      ? BTC_USD_PRICE
      : GROWTH_MODEL_INPUTS.currentBtcUsd;
  return Number.isFinite(usd) && usd > 0 ? usd : 0;
}

function normalizeBtcUsdPricePayload(payload) {
  const usd = Number(payload?.USD ?? payload?.usd);
  if (!Number.isFinite(usd) || usd <= 0) {
    throw new Error("USD price payload did not include a valid quote.");
  }

  const quoteTimestamp = Number(payload?.time);
  return {
    priceIndexedAt:
      Number.isFinite(quoteTimestamp) && quoteTimestamp > 0
        ? new Date(quoteTimestamp * 1000).toISOString()
        : undefined,
    usd,
  };
}

async function fetchLiveBtcUsdPrice({ fresh = false } = {}) {
  const now = Date.now();
  if (
    !fresh &&
    btcUsdPriceCache &&
    now - btcUsdPriceCache.fetchedAtMs < BTC_USD_PRICE_CACHE_TTL_MS
  ) {
    return { ...btcUsdPriceCache, cached: true };
  }

  const sourceUrl = `${mempoolBase("livenet")}/api/v1/prices`;
  const response = await fetch(sourceUrl, {
    headers: {
      Accept: "application/json",
    },
    signal: AbortSignal.timeout(BTC_USD_PRICE_FETCH_TIMEOUT_MS),
  });
  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new Error(
      `${sourceUrl} returned ${response.status}${body ? `: ${body.slice(0, 200)}` : ""}`,
    );
  }

  const payload = await response.json();
  const quote = {
    ...normalizeBtcUsdPricePayload(payload),
    fetchedAtMs: now,
    source: "proof-node-prices",
    sourceUrl,
  };
  btcUsdPriceCache = quote;
  return { ...quote, cached: false };
}

async function btcUsdPricePayload(network, { fresh = false } = {}) {
  try {
    const quote = await fetchLiveBtcUsdPrice({ fresh });
    return {
      USD: quote.usd,
      cached: quote.cached,
      indexedAt: new Date().toISOString(),
      network,
      priceIndexedAt: quote.priceIndexedAt,
      source: quote.source,
      sourceUrl: quote.sourceUrl,
      usd: quote.usd,
    };
  } catch (error) {
    const usd = configuredBtcUsdPrice();
    if (!usd) {
      throw error;
    }

    const sourceError =
      error instanceof Error && error.message ? error.message : String(error);
    return {
      USD: usd,
      indexedAt: new Date().toISOString(),
      network,
      source: "proof-api-config-fallback",
      sourceError,
      usd,
    };
  }
}

async function fetchBlockTxids(blockHash, network) {
  const normalizedHash = blockHash.toLowerCase();
  const txids = await fetchJson(
    `${mempoolBase(network)}/api/block/${normalizedHash}/txids`,
  );
  return Array.isArray(txids)
    ? txids.filter(
        (txid) => typeof txid === "string" && /^[0-9a-f]{64}$/iu.test(txid),
      )
    : [];
}

async function fetchBlockTxidIndex(blockHash, network) {
  if (!/^[0-9a-fA-F]{64}$/u.test(blockHash)) {
    return new Map();
  }

  const normalizedHash = blockHash.toLowerCase();
  const cacheKey = `${network}:${normalizedHash}`;
  if (!BLOCK_TXID_INDEX_CACHE.has(cacheKey)) {
    const promise = fetchBlockTxids(normalizedHash, network)
      .then((txids) => {
        const index = new Map();
        txids.forEach((txid, position) => {
          index.set(txid.toLowerCase(), position);
        });
        return index;
      })
      .catch((error) => {
        BLOCK_TXID_INDEX_CACHE.delete(cacheKey);
        throw error;
      });
    BLOCK_TXID_INDEX_CACHE.set(cacheKey, promise);
  }

  return BLOCK_TXID_INDEX_CACHE.get(cacheKey);
}

async function fetchAddressTransactionsPage(address, network, path) {
  const transactions = await fetchJson(
    `${mempoolBase(network)}/api/address/${address}/${path}`,
  );
  return Array.isArray(transactions) ? transactions : [];
}

async function fetchAddressTransactionsPageFromBase(baseUrl, address, path) {
  const transactions = await fetchJson(
    `${baseUrl}/api/address/${address}/${path}`,
  );
  return Array.isArray(transactions) ? transactions : [];
}

async function fetchAddressMempoolTransactions(address, network) {
  const pages = await Promise.allSettled(
    pendingMempoolBases(network).map((baseUrl) =>
      fetchAddressTransactionsPageFromBase(baseUrl, address, "txs/mempool"),
    ),
  );

  const transactions = dedupeTransactions(
    pages.flatMap((page) => (page.status === "fulfilled" ? page.value : [])),
  );
  for (const tx of transactions) {
    cachePendingTokenTransaction(tx, network, "address-mempool");
  }

  return transactions;
}

function bitcoinNetwork(network) {
  return network === "livenet"
    ? bitcoin.networks.bitcoin
    : bitcoin.networks.testnet;
}

function isValidBitcoinAddress(address, network) {
  try {
    bitcoin.address.toOutputScript(address, bitcoinNetwork(network));
    return true;
  } catch {
    return false;
  }
}

function marketplaceLegacyAnchorWitnessScript() {
  return bitcoin.script.compile([bitcoin.opcodes.OP_TRUE]);
}

function marketplaceLegacyAnchorScriptPubKey() {
  const payment = bitcoin.payments.p2wsh({
    redeem: {
      output: marketplaceLegacyAnchorWitnessScript(),
    },
  });

  if (!payment.output) {
    throw new Error("Could not build marketplace listing anchor script.");
  }

  return Buffer.from(payment.output).toString("hex");
}

function validPublicKeyHex(value) {
  return (
    /^[0-9a-fA-F]{64}$/u.test(value) ||
    /^(02|03)[0-9a-fA-F]{64}$/u.test(value) ||
    /^04[0-9a-fA-F]{128}$/u.test(value)
  );
}

function validSignatureHex(value) {
  return (
    /^[0-9a-fA-F]+$/u.test(value) &&
    value.length >= 18 &&
    value.length <= 146 &&
    value.length % 2 === 0
  );
}

function scriptHashForAddress(address, network) {
  const script = bitcoin.address.toOutputScript(
    address,
    bitcoinNetwork(network),
  );
  return Buffer.from(bitcoin.crypto.sha256(script)).reverse().toString("hex");
}

function scriptHashForScriptHex(scriptHex) {
  if (!/^[0-9a-fA-F]+$/u.test(scriptHex) || scriptHex.length % 2 !== 0) {
    throw new Error("Invalid output script.");
  }

  const script = Buffer.from(scriptHex, "hex");
  return Buffer.from(bitcoin.crypto.sha256(script)).reverse().toString("hex");
}

function electrumRequest(method, params) {
  return new Promise((resolve, reject) => {
    const socket = net.createConnection({
      host: ELECTRUM_HOST,
      port: ELECTRUM_PORT,
    });
    const requestId = Date.now();
    let settled = false;
    let buffer = "";

    const timer = setTimeout(() => {
      if (settled) {
        return;
      }

      settled = true;
      socket.destroy();
      reject(new Error(`Electrum request timed out: ${method}`));
    }, 30_000);

    socket.on("connect", () => {
      socket.write(`${JSON.stringify({ id: requestId, method, params })}\n`);
    });

    socket.on("data", (data) => {
      buffer += data.toString("utf8");
      const newlineIndex = buffer.indexOf("\n");
      if (newlineIndex === -1 || settled) {
        return;
      }

      const line = buffer.slice(0, newlineIndex);
      settled = true;
      clearTimeout(timer);
      socket.end();

      try {
        const parsed = JSON.parse(line);
        if (parsed.error) {
          reject(
            new Error(parsed.error.message ?? `Electrum error for ${method}`),
          );
          return;
        }

        resolve(parsed.result);
      } catch (error) {
        reject(error);
      }
    });

    socket.on("error", (error) => {
      if (settled) {
        return;
      }

      settled = true;
      clearTimeout(timer);
      reject(error);
    });
  });
}

async function mapWithConcurrency(items, concurrency, mapper) {
  const results = Array.from({ length: items.length });
  let nextIndex = 0;

  async function worker() {
    while (nextIndex < items.length) {
      const index = nextIndex;
      nextIndex += 1;
      results[index] = await mapper(items[index], index);
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(concurrency, items.length) }, worker),
  );
  return results;
}

async function fetchTransaction(txid, network) {
  const normalizedTxid = String(txid ?? "").toLowerCase();
  const cacheKey = `${network}:${normalizedTxid}`;
  const cached = TRANSACTION_CACHE.get(cacheKey);
  if (cached) {
    return cached;
  }

  const tx = await fetchJson(`${mempoolBase(network)}/api/tx/${normalizedTxid}`);
  cachePendingTokenTransaction(tx, network, "tx");
  if (transactionConfirmed(tx)) {
    TRANSACTION_CACHE.set(cacheKey, tx);
    if (TRANSACTION_CACHE.size > MAX_TRANSACTION_CACHE_SIZE) {
      TRANSACTION_CACHE.delete(TRANSACTION_CACHE.keys().next().value);
    }
  }

  return tx;
}

async function fetchTransactionFromBase(baseUrl, txid) {
  const response = await fetch(`${baseUrl}/api/tx/${txid}`);
  if (response.status === 404) {
    return null;
  }

  if (!response.ok) {
    throw new Error(`Transaction lookup returned ${response.status}`);
  }

  return response.json();
}

async function fetchTransactionWithPendingFallback(txid, network) {
  for (const baseUrl of pendingMempoolBases(network)) {
    const tx = await fetchTransactionFromBase(baseUrl, txid).catch(() => null);
    if (tx) {
      cachePendingTokenTransaction(tx, network, "pending-fallback");
      return tx;
    }
  }

  return null;
}

async function fetchAddressTransactionsFromElectrum(address, network) {
  const scripthash = scriptHashForAddress(address, network);
  const history = await electrumRequest("blockchain.scripthash.get_history", [
    scripthash,
  ]);
  const entries = Array.isArray(history) ? history : [];
  const txids = [
    ...new Set(
      entries
        .map((entry) => entry?.tx_hash)
        .filter(
          (txid) => typeof txid === "string" && /^[0-9a-fA-F]{64}$/u.test(txid),
        )
        .map((txid) => txid.toLowerCase()),
    ),
  ];

  let failedFetches = 0;
  const txs = await mapWithConcurrency(
    txids,
    TX_FETCH_CONCURRENCY,
    async (txid) => {
      try {
        return await fetchTransaction(txid, network);
      } catch {
        failedFetches += 1;
        return null;
      }
    },
  );

  if (failedFetches > 0) {
    throw new Error(
      `Electrum history transaction hydration was partial for ${address}: ${failedFetches} of ${txids.length} transaction lookups failed.`,
    );
  }

  return dedupeTransactions(txs.filter(Boolean));
}

async function fetchAddressHistoryTxidsFromElectrum(address, network) {
  if (network !== "livenet" || !ELECTRUM_HOST || !ELECTRUM_PORT) {
    return [];
  }

  const scripthash = scriptHashForAddress(address, network);
  const history = await electrumRequest("blockchain.scripthash.get_history", [
    scripthash,
  ]);
  return [
    ...new Set(
      (Array.isArray(history) ? history : [])
        .map((entry) => entry?.tx_hash)
        .filter(
          (txid) => typeof txid === "string" && /^[0-9a-fA-F]{64}$/u.test(txid),
        )
        .map((txid) => txid.toLowerCase()),
    ),
  ];
}

async function fetchRecentUnknownAddressTransactions(
  address,
  network,
  knownTxids,
  maxTxs,
) {
  const collected = [];
  const cursors = new Set();
  const maxPages = Math.max(1, Math.ceil(maxTxs / 25) + 4);
  const pageBases = [
    ...new Set([
      mempoolBase(network),
      ...pendingMempoolBases(network),
      explorerBase(network),
    ]),
  ];
  const fetchPage = async (path) => {
    let lastError = null;
    for (const baseUrl of pageBases) {
      try {
        return await fetchAddressTransactionsPageFromBase(
          baseUrl,
          address,
          path,
        );
      } catch (error) {
        lastError = error;
      }
    }
    throw lastError ?? new Error(`No address page source for ${address}.`);
  };
  const collectUnknown = (txs) => {
    let pageUnknown = 0;
    for (const tx of txs) {
      const txid = transactionTxid(tx);
      if (!txid || knownTxids.has(txid)) {
        continue;
      }

      pageUnknown += 1;
      collected.push(tx);
      if (collected.length >= maxTxs) {
        break;
      }
    }

    return pageUnknown;
  };

  try {
    collectUnknown(await fetchAddressMempoolTransactions(address, network));
    if (collected.length >= maxTxs) {
      return annotateBlockOrder(dedupeTransactions(collected), network);
    }
  } catch (error) {
    console.error(
      `Recent address mempool lookup failed for ${address}: ${errorSummary(error)}`,
    );
  }

  let cursor = "";
  let consecutiveKnownPages = 0;

  for (let page = 0; page < maxPages; page += 1) {
    const path = cursor ? `txs/chain/${cursor}` : "txs/chain";
    let pageTxs = [];
    try {
      pageTxs = await fetchPage(path);
    } catch (error) {
      if (page === 0) {
        pageTxs = await fetchPage("txs").catch(() => []);
      }
      if (pageTxs.length === 0) {
        console.error(
          `Recent address page lookup failed for ${address}: ${errorSummary(error)}`,
        );
        break;
      }
    }

    if (pageTxs.length === 0) {
      break;
    }

    const pageUnknown = collectUnknown(pageTxs);
    if (collected.length >= maxTxs) {
      return annotateBlockOrder(dedupeTransactions(collected), network);
    }

    consecutiveKnownPages = pageUnknown === 0 ? consecutiveKnownPages + 1 : 0;
    if (consecutiveKnownPages >= 2 || (collected.length > 0 && pageUnknown === 0)) {
      break;
    }

    cursor = oldestConfirmedTxid(pageTxs);
    if (!cursor || cursors.has(cursor)) {
      break;
    }
    cursors.add(cursor);
  }

  return annotateBlockOrder(dedupeTransactions(collected), network);
}

function transactionTxid(tx) {
  return typeof tx.txid === "string" && /^[0-9a-fA-F]{64}$/u.test(tx.txid)
    ? tx.txid.toLowerCase()
    : "";
}

function transactionConfirmed(tx) {
  return Boolean(tx.status?.confirmed);
}

function transactionBlockHash(tx) {
  const blockHash = tx.status?.block_hash;
  return typeof blockHash === "string" && /^[0-9a-fA-F]{64}$/u.test(blockHash)
    ? blockHash.toLowerCase()
    : "";
}

function transactionBlockHeight(tx) {
  const height = tx.status?.block_height;
  return Number.isSafeInteger(height) && height >= 0 ? height : undefined;
}

function transactionBlockIndex(tx) {
  const index =
    tx._powBlockIndex ?? tx.status?.block_index ?? tx.status?.block_tx_index;
  return Number.isSafeInteger(index) && index >= 0 ? index : undefined;
}

async function annotateBlockOrder(txs, network) {
  const blockCounts = new Map();
  for (const tx of txs) {
    if (!transactionConfirmed(tx)) {
      continue;
    }

    const blockHash = transactionBlockHash(tx);
    if (blockHash) {
      blockCounts.set(blockHash, (blockCounts.get(blockHash) ?? 0) + 1);
    }
  }

  const blockHashes = [...blockCounts]
    .filter(([, count]) => count > 1)
    .map(([blockHash]) => blockHash);

  if (blockHashes.length === 0) {
    return txs;
  }

  const blockIndexes = new Map();
  await mapWithConcurrency(
    blockHashes,
    BLOCK_TXID_FETCH_CONCURRENCY,
    async (blockHash) => {
      const index = await fetchBlockTxidIndex(blockHash, network).catch(
        () => null,
      );
      if (index) {
        blockIndexes.set(blockHash, index);
      }
    },
  );

  if (blockIndexes.size === 0) {
    return txs;
  }

  return txs.map((tx) => {
    const txid = transactionTxid(tx);
    const blockHash = transactionBlockHash(tx);
    const index = blockIndexes.get(blockHash)?.get(txid);
    return Number.isSafeInteger(index) ? { ...tx, _powBlockIndex: index } : tx;
  });
}

function oldestConfirmedTxid(txs) {
  const confirmedTxs = txs.filter(transactionConfirmed);
  return confirmedTxs.length > 0
    ? transactionTxid(confirmedTxs[confirmedTxs.length - 1])
    : "";
}

function dedupeTransactions(txs) {
  const merged = new Map();

  for (const tx of txs) {
    const txid = transactionTxid(tx);
    if (!txid) {
      continue;
    }

    const current = merged.get(txid);
    if (
      !current ||
      (transactionConfirmed(tx) && !transactionConfirmed(current))
    ) {
      merged.set(txid, tx);
    }
  }

  return [...merged.values()];
}

function pendingTokenTransactionCacheKey(network, txid) {
  return `${network}:${txid}`;
}

function transactionHasTokenProtocol(tx, network) {
  const vout = Array.isArray(tx?.vout) ? tx.vout : [];
  return decodedProtocolMessages(vout, TOKEN_PROTOCOL_PREFIX).some((message) =>
    Boolean(parseTokenPayload(message, network)),
  );
}

function prunePendingTokenTransactionCache(now = Date.now()) {
  for (const [key, entry] of PENDING_TOKEN_TRANSACTION_CACHE) {
    if (
      now >= entry.expiresAt ||
      !transactionTxid(entry.tx) ||
      transactionConfirmed(entry.tx)
    ) {
      PENDING_TOKEN_TRANSACTION_CACHE.delete(key);
    }
  }

  while (
    PENDING_TOKEN_TRANSACTION_CACHE.size >
    PENDING_TOKEN_TRANSACTION_CACHE_MAX_SIZE
  ) {
    PENDING_TOKEN_TRANSACTION_CACHE.delete(
      PENDING_TOKEN_TRANSACTION_CACHE.keys().next().value,
    );
  }
}

function cachePendingTokenTransaction(tx, network, source = "lookup") {
  const txid = transactionTxid(tx);
  if (!txid) {
    return false;
  }

  const cacheKey = pendingTokenTransactionCacheKey(network, txid);
  if (transactionConfirmed(tx)) {
    PENDING_TOKEN_TRANSACTION_CACHE.delete(cacheKey);
    return false;
  }

  if (!transactionHasTokenProtocol(tx, network)) {
    return false;
  }

  const now = Date.now();
  PENDING_TOKEN_TRANSACTION_CACHE.delete(cacheKey);
  PENDING_TOKEN_TRANSACTION_CACHE.set(cacheKey, {
    expiresAt: now + PENDING_TOKEN_TRANSACTION_CACHE_TTL_MS,
    network,
    seenAt: now,
    source,
    tx,
  });
  prunePendingTokenTransactionCache(now);
  return true;
}

async function cachePendingTokenTransactionByTxid(
  txid,
  network,
  source = "lookup",
) {
  const normalizedTxid = String(txid ?? "").trim().toLowerCase();
  if (!/^[0-9a-f]{64}$/u.test(normalizedTxid)) {
    return false;
  }

  try {
    const tx = await fetchTransactionWithPendingFallback(normalizedTxid, network);
    return tx ? cachePendingTokenTransaction(tx, network, source) : false;
  } catch {
    return false;
  }
}

function cachedPendingTokenTransactions(network, predicate = () => true) {
  prunePendingTokenTransactionCache();
  const transactions = [];
  for (const entry of PENDING_TOKEN_TRANSACTION_CACHE.values()) {
    if (entry.network !== network || !entry.tx || !predicate(entry.tx)) {
      continue;
    }
    transactions.push(entry.tx);
  }

  return dedupeTransactions(transactions);
}

function pendingTokenTransactionPaysRegistry(tx, registryAddress) {
  const vout = Array.isArray(tx?.vout) ? tx.vout : [];
  return (
    tokenPaymentAmountBeforeProtocol(vout, registryAddress) >=
    TOKEN_MIN_MUTATION_PRICE_SATS
  );
}

function cachedPendingTokenTransactionsForRegistry(network, registryAddress) {
  return cachedPendingTokenTransactions(network, (tx) =>
    pendingTokenTransactionPaysRegistry(tx, registryAddress),
  );
}

async function fetchAddressTransactionsViaMempoolPagination(
  address,
  network,
  maxPages = MAX_ADDRESS_TX_PAGES,
) {
  const recentTxs = await fetchAddressTransactionsPage(address, network, "txs");
  const mempoolTxs = await fetchAddressMempoolTransactions(
    address,
    network,
  ).catch(() => []);

  let chainPage = [];
  try {
    chainPage = await fetchAddressTransactionsPage(
      address,
      network,
      "txs/chain",
    );
  } catch {
    chainPage = recentTxs.filter(transactionConfirmed);
  }

  if (chainPage.length === 0) {
    chainPage = recentTxs.filter(transactionConfirmed);
  }

  const chainTxs = [...chainPage];
  const cursors = new Set();
  let cursor = oldestConfirmedTxid(chainPage);

  for (let page = 0; cursor && page < maxPages; page += 1) {
    if (cursors.has(cursor)) {
      break;
    }

    cursors.add(cursor);
    let nextPage = [];
    try {
      nextPage = await fetchAddressTransactionsPage(
        address,
        network,
        `txs/chain/${cursor}`,
      );
    } catch {
      break;
    }

    if (nextPage.length === 0) {
      break;
    }

    chainTxs.push(...nextPage);
    cursor = oldestConfirmedTxid(nextPage);
  }

  return dedupeTransactions([...chainTxs, ...mempoolTxs, ...recentTxs]);
}

async function fetchAddressTransactions(
  address,
  network,
  maxPages = MAX_ADDRESS_TX_PAGES,
) {
  if (network === "livenet" && ELECTRUM_HOST && ELECTRUM_PORT) {
    try {
      const [historyTxs, mempoolTxs] = await Promise.all([
        fetchAddressTransactionsFromElectrum(address, network),
        fetchAddressMempoolTransactions(address, network).catch(() => []),
      ]);

      return dedupeTransactions([...historyTxs, ...mempoolTxs]);
    } catch (error) {
      if (
        error instanceof Error &&
        error.message.includes("transaction hydration was partial")
      ) {
        throw error;
      }

      return fetchAddressTransactionsViaMempoolPagination(
        address,
        network,
        maxPages,
      );
    }
  }

  return fetchAddressTransactionsViaMempoolPagination(
    address,
    network,
    maxPages,
  );
}

async function fetchRegistryTransactions(registryAddress, network) {
  const txs = await fetchAddressTransactions(
    registryAddress,
    network,
    MAX_REGISTRY_TX_PAGES,
  );
  return annotateBlockOrder(txs, network);
}

function decodeHex(hex) {
  if (!hex || hex.length % 2 !== 0 || !/^[0-9a-fA-F]+$/u.test(hex)) {
    return "";
  }

  return Buffer.from(hex, "hex").toString("utf8");
}

function decodedOpReturnMessages(vout) {
  return vout
    .filter((output) => output.scriptpubkey_type === "op_return")
    .map((output) => String(output.scriptpubkey_asm ?? ""))
    .map((asm) =>
      asm
        .split(" ")
        .slice(1)
        .filter((token) => /^[0-9a-fA-F]+$/u.test(token))
        .map(decodeHex)
        .join(""),
    )
    .filter(Boolean);
}

function decodedProtocolMessages(vout, prefix) {
  return decodedOpReturnMessages(vout).filter((message) =>
    message.startsWith(prefix),
  );
}

function decodedOpReturnAt(vout, index) {
  const output = vout[index];
  if (!output || output.scriptpubkey_type !== "op_return") {
    return "";
  }

  return decodedOpReturnMessages([output])[0] ?? "";
}

function protocolDataBytesForVout(vout, prefix) {
  return decodedProtocolMessages(vout, prefix).reduce(
    (total, message) => total + Buffer.byteLength(message, "utf8"),
    0,
  );
}

function proofProtocolDataBytesForVout(vout) {
  return decodedOpReturnMessages(vout)
    .filter(
      (message) =>
        message.startsWith(PROTOCOL_PREFIX) ||
        message.startsWith(ID_PROTOCOL_PREFIX) ||
        message.startsWith(TOKEN_PROTOCOL_PREFIX) ||
        message.startsWith(RUSH_PROTOCOL_PREFIX),
    )
    .reduce((total, message) => total + Buffer.byteLength(message, "utf8"), 0);
}

function firstProtocolOutputIndex(vout) {
  return vout.findIndex((output) => {
    if (output.scriptpubkey_type !== "op_return") {
      return false;
    }

    return decodedProtocolMessages([output], PROTOCOL_PREFIX).length > 0;
  });
}

function firstIdProtocolOutputIndex(vout) {
  return vout.findIndex((output) => {
    if (output.scriptpubkey_type !== "op_return") {
      return false;
    }

    return decodedProtocolMessages([output], ID_PROTOCOL_PREFIX).length > 0;
  });
}

function base64FromBase64Url(value) {
  const base64 = value.replace(/-/g, "+").replace(/_/g, "/");
  return base64.padEnd(Math.ceil(base64.length / 4) * 4, "=");
}

function base64UrlDecodeBytes(value) {
  if (!/^[A-Za-z0-9_-]*$/u.test(value)) {
    throw new Error("Invalid base64url data.");
  }

  return Buffer.from(base64FromBase64Url(value), "base64");
}

function decodeTextBase64Url(value) {
  return base64UrlDecodeBytes(value).toString("utf8");
}

function normalizeSubject(value) {
  return String(value).trim().replace(/\s+/gu, " ").slice(0, 180);
}

function sha256Hex(bytes) {
  return Buffer.from(bitcoin.crypto.sha256(Buffer.from(bytes))).toString("hex");
}

function normalizeAttachmentName(name) {
  return name.trim().replace(/\s+/gu, " ").slice(0, 120) || "attachment";
}

function normalizeAttachmentMime(mime) {
  return mime.trim().slice(0, 120) || "application/octet-stream";
}

function parseAttachmentPayload(payload, current) {
  const parts = payload.split(":");
  if (parts.length !== 7) {
    return current;
  }

  const [, mimeEncoded, nameEncoded, sizeText, sha256, partText, chunk] = parts;
  const size = Number(sizeText);
  const part = partText.match(/^(\d+)\/(\d+)$/u);

  if (
    !Number.isSafeInteger(size) ||
    size <= 0 ||
    size > MAX_ATTACHMENT_BYTES ||
    !/^[0-9a-f]{64}$/iu.test(sha256) ||
    !part
  ) {
    return current;
  }

  const index = Number(part[1]);
  const total = Number(part[2]);
  if (
    !Number.isSafeInteger(index) ||
    !Number.isSafeInteger(total) ||
    total < 1 ||
    index < 0 ||
    index >= total
  ) {
    return current;
  }

  let mime = "";
  let name = "";
  try {
    mime = normalizeAttachmentMime(decodeTextBase64Url(mimeEncoded));
    name = normalizeAttachmentName(decodeTextBase64Url(nameEncoded));
  } catch {
    return current;
  }

  const accumulator =
    current &&
    current.mime === mime &&
    current.name === name &&
    current.size === size &&
    current.sha256 === sha256.toLowerCase() &&
    current.total === total
      ? current
      : {
          chunks: Array.from({ length: total }, () => ""),
          mime,
          name,
          sha256: sha256.toLowerCase(),
          size,
          total,
        };

  accumulator.chunks[index] = chunk;
  return accumulator;
}

function attachmentFromAccumulator(accumulator) {
  if (!accumulator || accumulator.chunks.some((chunk) => !chunk)) {
    return undefined;
  }

  const data = accumulator.chunks.join("");
  try {
    const bytes = base64UrlDecodeBytes(data);
    if (
      bytes.byteLength !== accumulator.size ||
      sha256Hex(bytes) !== accumulator.sha256
    ) {
      return undefined;
    }
  } catch {
    return undefined;
  }

  return {
    data,
    mime: accumulator.mime,
    name: accumulator.name,
    sha256: accumulator.sha256,
    size: accumulator.size,
  };
}

function extractProtocolMemo(vout) {
  const decodedMessages = decodedOpReturnMessages(vout);
  let replyTo = "";
  let parentTxid;
  let attachmentAccumulator;
  let subject = "";
  const chunks = [];

  for (const decodedMessage of decodedMessages) {
    if (!decodedMessage.startsWith(PROTOCOL_PREFIX)) {
      continue;
    }

    const payload = decodedMessage.slice(PROTOCOL_PREFIX.length);
    if (payload.startsWith("f:")) {
      replyTo = payload.slice(2);
      continue;
    }

    if (payload.startsWith("s:")) {
      try {
        subject = normalizeSubject(decodeTextBase64Url(payload.slice(2)));
      } catch {
        // Ignore malformed optional subjects while still allowing body/attachments through.
      }
      continue;
    }

    const reply = payload.match(/^r:([0-9a-fA-F]{64})$/u);
    if (reply) {
      parentTxid = reply[1].toLowerCase();
      continue;
    }

    if (payload.startsWith("m:")) {
      chunks.push(payload.slice(2));
      continue;
    }

    if (payload.startsWith("a:")) {
      attachmentAccumulator = parseAttachmentPayload(
        payload,
        attachmentAccumulator,
      );
    }
  }

  if (chunks.length === 0 && !subject && !attachmentAccumulator) {
    return null;
  }

  const protocolMessage = {
    memo: chunks.join(""),
  };

  if (replyTo) {
    protocolMessage.replyTo = replyTo;
  }

  if (parentTxid) {
    protocolMessage.parentTxid = parentTxid;
  }

  if (subject) {
    protocolMessage.subject = subject;
  }

  const attachment = attachmentFromAccumulator(attachmentAccumulator);
  if (attachment) {
    protocolMessage.attachment = attachment;
  }

  return protocolMessage;
}

function receivedPaymentAmount(vout, address) {
  const protocolIndex = firstProtocolOutputIndex(vout);
  const amount = vout.reduce((total, output, index) => {
    if (
      output.scriptpubkey_address !== address ||
      typeof output.value !== "number"
    ) {
      return total;
    }

    return protocolIndex === -1 || index < protocolIndex
      ? total + output.value
      : total;
  }, 0);

  if (amount > 0) {
    return amount;
  }

  if (protocolIndex !== -1) {
    return 0;
  }

  const fallbackOutput = vout.find(
    (output) =>
      output.scriptpubkey_address === address &&
      typeof output.value === "number",
  );
  return typeof fallbackOutput?.value === "number" ? fallbackOutput.value : 0;
}

function protocolPaymentOutputs(vout) {
  const protocolIndex = firstProtocolOutputIndex(vout);
  if (protocolIndex === -1) {
    return [];
  }

  return vout.flatMap((output, index) => {
    if (
      index >= protocolIndex ||
      output.scriptpubkey_type === "op_return" ||
      typeof output.scriptpubkey_address !== "string" ||
      typeof output.value !== "number" ||
      output.value <= 0
    ) {
      return [];
    }

    return [
      {
        address: output.scriptpubkey_address,
        amountSats: output.value,
        display: output.scriptpubkey_address,
      },
    ];
  });
}

function inputAddresses(vin) {
  return vin
    .map((input) => input?.prevout?.scriptpubkey_address)
    .filter((address) => typeof address === "string" && address.length > 0);
}

function spentOutpoints(vin) {
  return vin.flatMap((input) => {
    const txid =
      typeof input?.txid === "string" && /^[0-9a-fA-F]{64}$/u.test(input.txid)
        ? input.txid.toLowerCase()
        : "";
    const vout =
      Number.isSafeInteger(input?.vout) && input.vout >= 0 ? input.vout : -1;
    return txid && vout >= 0 ? [{ txid, vout }] : [];
  });
}

function senderAddress(vin, targetAddress) {
  const addresses = inputAddresses(vin);
  return (
    addresses.find((inputAddress) => inputAddress !== targetAddress) ??
    addresses[0] ??
    "Unknown"
  );
}

function registryPaymentAmount(vout, registryAddress) {
  const protocolIndex = firstIdProtocolOutputIndex(vout);
  return vout.reduce((total, output, index) => {
    if (
      output.scriptpubkey_address === registryAddress &&
      typeof output.value === "number" &&
      output.value > 0 &&
      (protocolIndex === -1 || index < protocolIndex)
    ) {
      return total + output.value;
    }

    return total;
  }, 0);
}

function firstTokenOutputIndex(vout) {
  return vout.findIndex((output) => {
    if (output.scriptpubkey_type !== "op_return") {
      return false;
    }

    return decodedProtocolMessages([output], TOKEN_PROTOCOL_PREFIX).length > 0;
  });
}

function tokenPaymentAmountBeforeProtocol(vout, address) {
  const protocolIndex = firstTokenOutputIndex(vout);
  return vout.reduce((total, output, index) => {
    if (
      output.scriptpubkey_address === address &&
      typeof output.value === "number" &&
      output.value > 0 &&
      (protocolIndex === -1 || index < protocolIndex)
    ) {
      return total + output.value;
    }

    return total;
  }, 0);
}

function paymentOutputsBeforeTokenProtocol(vout) {
  const protocolIndex = firstTokenOutputIndex(vout);
  return vout.flatMap((output, index) => {
    if (
      typeof output.scriptpubkey_address !== "string" ||
      typeof output.value !== "number" ||
      output.value <= 0 ||
      (protocolIndex !== -1 && index >= protocolIndex)
    ) {
      return [];
    }

    return [{ address: output.scriptpubkey_address, amountSats: output.value }];
  });
}

function firstRushOutputIndex(vout) {
  return vout.findIndex((output) => {
    if (output.scriptpubkey_type !== "op_return") {
      return false;
    }

    return decodedProtocolMessages([output], RUSH_PROTOCOL_PREFIX).some(
      (message) => message === RUSH_MINT_PAYLOAD,
    );
  });
}

function rushPaymentAmountBeforeProtocol(vout, address) {
  const protocolIndex = firstRushOutputIndex(vout);
  return vout.reduce((total, output, index) => {
    if (
      output.scriptpubkey_address === address &&
      typeof output.value === "number" &&
      output.value > 0 &&
      (protocolIndex === -1 || index < protocolIndex)
    ) {
      return total + output.value;
    }

    return total;
  }, 0);
}

function rushPhaseForOrdinal(ordinal) {
  if (!Number.isSafeInteger(ordinal) || ordinal < 1) {
    return undefined;
  }

  return RUSH_PHASES.find(
    (phase) => ordinal >= phase.startOrdinal && ordinal <= phase.endOrdinal,
  );
}

function rushRewardUnitsForOrdinal(ordinal) {
  return rushPhaseForOrdinal(ordinal)?.rewardUnits ?? 0n;
}

function formatRushUnits(units) {
  const sign = units < 0n ? "-" : "";
  const absolute = units < 0n ? -units : units;
  const whole = absolute / RUSH_BASE_UNITS;
  const fractional = absolute % RUSH_BASE_UNITS;
  if (fractional === 0n) {
    return `${sign}${whole.toString()}`;
  }

  const decimals = fractional
    .toString()
    .padStart(Number(RUSH_DECIMALS), "0")
    .replace(/0+$/u, "");
  return `${sign}${whole.toString()}.${decimals}`;
}

function rushStatsFromMints(mints) {
  const confirmedMints = mints.filter((mint) => mint.confirmed).length;
  const pendingMints = mints.filter((mint) => !mint.confirmed).length;
  const rewardedMints = Math.min(confirmedMints, RUSH_MAX_REWARDED_MINTS);
  const overflowMints = Math.max(0, confirmedMints - RUSH_MAX_REWARDED_MINTS);
  const distributedUnits = mints.reduce((total, mint) => {
    if (!mint.confirmed || mint.overflow) {
      return total;
    }

    return total + BigInt(mint.amountUnits || "0");
  }, 0n);
  const remainingUnits =
    distributedUnits >= RUSH_TOTAL_SUPPLY_UNITS
      ? 0n
      : RUSH_TOTAL_SUPPLY_UNITS - distributedUnits;
  const nextOrdinal =
    rewardedMints >= RUSH_MAX_REWARDED_MINTS ? null : rewardedMints + 1;
  const nextPhase = nextOrdinal ? rushPhaseForOrdinal(nextOrdinal) : undefined;

  return {
    confirmedMints,
    currentPhase: nextPhase?.phase ?? null,
    distributed: formatRushUnits(distributedUnits),
    nextOrdinal,
    nextReward: nextOrdinal
      ? formatRushUnits(rushRewardUnitsForOrdinal(nextOrdinal))
      : "0",
    overflowMints,
    pendingMints,
    remaining: formatRushUnits(remainingUnits),
    rewardedMints,
    totalSupply: "1000000000",
  };
}

function normalizeTokenTicker(value) {
  return String(value ?? "")
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]/gu, "")
    .slice(0, 12);
}

function normalizeTokenCreatorAddress(value) {
  return String(value ?? "").trim().toLowerCase();
}

function tokenTickerIsReserved(value) {
  const ticker = normalizeTokenTicker(value);
  return ticker.includes(WORK_TOKEN_TICKER);
}

function tokenCreationIsAllowed({ creatorAddress, ticker, tokenId }) {
  if (String(tokenId ?? "").toLowerCase() === WORK_TOKEN_ID) {
    return true;
  }

  if (
    BLOCKED_TOKEN_CREATOR_ADDRESSES.has(
      normalizeTokenCreatorAddress(creatorAddress),
    )
  ) {
    return false;
  }

  return !tokenTickerIsReserved(ticker);
}

function tokenSaleAuthorizationDraft(authorization = {}) {
  return {
    amount: Math.max(0, Math.floor(Number(authorization.amount ?? 0))),
    anchorScriptPubKey: String(authorization.anchorScriptPubKey ?? "").toLowerCase(),
    anchorSigHashType: Math.floor(Number(authorization.anchorSigHashType ?? 0)),
    anchorType: String(authorization.anchorType ?? ""),
    anchorValueSats: Math.max(
      0,
      Math.floor(Number(authorization.anchorValueSats ?? 0)),
    ),
    anchorVout: Math.max(0, Math.floor(Number(authorization.anchorVout ?? 0))),
    buyerAddress: String(authorization.buyerAddress ?? "").trim(),
    expiresAt: String(authorization.expiresAt ?? "").trim(),
    network: authorization.network ?? "livenet",
    nonce: String(authorization.nonce ?? "").trim(),
    priceSats: Math.max(0, Math.floor(Number(authorization.priceSats ?? 0))),
    registryAddress: String(authorization.registryAddress ?? "").trim(),
    sellerAddress: String(authorization.sellerAddress ?? "").trim(),
    sellerPublicKey: String(authorization.sellerPublicKey ?? "").toLowerCase(),
    ticker: normalizeTokenTicker(String(authorization.ticker ?? "")),
    tokenId: String(authorization.tokenId ?? "").toLowerCase(),
    version: authorization.version ?? TOKEN_SALE_AUTH_VERSION,
  };
}

function parseTokenSaleAuthorizationJson(value, network) {
  const parsed = JSON.parse(value);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("Credit sale authorization is not an object.");
  }

  const draft = tokenSaleAuthorizationDraft(parsed);
  const anchorTxid = String(parsed.anchorTxid ?? "").toLowerCase();
  const anchorSignature = String(parsed.anchorSignature ?? "").toLowerCase();
  if (
    draft.version !== TOKEN_SALE_AUTH_VERSION ||
    !/^[0-9a-f]{64}$/u.test(draft.tokenId) ||
    !/^[A-Z0-9]{1,12}$/u.test(draft.ticker) ||
    draft.amount < 1 ||
    draft.priceSats < 1 ||
    draft.network !== network ||
    !isValidBitcoinAddress(draft.registryAddress, network) ||
    !isValidBitcoinAddress(draft.sellerAddress, network) ||
    (draft.buyerAddress && !isValidBitcoinAddress(draft.buyerAddress, network)) ||
    !draft.nonce ||
    draft.nonce.length > 160 ||
    (draft.expiresAt && Number.isNaN(Date.parse(draft.expiresAt))) ||
    draft.anchorType !== TOKEN_LISTING_ANCHOR_TYPE ||
    draft.anchorVout !== TOKEN_LISTING_ANCHOR_VOUT ||
    draft.anchorValueSats !== TOKEN_LISTING_ANCHOR_VALUE_SATS ||
    !/^[0-9a-f]+$/u.test(draft.anchorScriptPubKey) ||
    !validPublicKeyHex(draft.sellerPublicKey) ||
    draft.anchorSigHashType !== TOKEN_LISTING_ANCHOR_SIGHASH_TYPE ||
    (anchorTxid && !/^[0-9a-f]{64}$/u.test(anchorTxid)) ||
    (anchorSignature && !validSignatureHex(anchorSignature))
  ) {
    throw new Error("Credit sale authorization is invalid.");
  }

  return { ...draft, anchorSignature, anchorTxid };
}

function tokenSaleAuthorizationUsesSaleTicketAnchor(authorization) {
  return (
    authorization?.version === TOKEN_SALE_AUTH_VERSION &&
    authorization.anchorType === TOKEN_LISTING_ANCHOR_TYPE &&
    authorization.anchorVout === TOKEN_LISTING_ANCHOR_VOUT &&
    authorization.anchorValueSats === TOKEN_LISTING_ANCHOR_VALUE_SATS &&
    authorization.anchorSigHashType === TOKEN_LISTING_ANCHOR_SIGHASH_TYPE &&
    /^[0-9a-f]{64}$/u.test(authorization.anchorTxid ?? "") &&
    validPublicKeyHex(authorization.sellerPublicKey ?? "") &&
    validSignatureHex(authorization.anchorSignature ?? "")
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

function tokenListingHasConfirmedSaleTicketSeal(listing) {
  return (
    listing?.sealConfirmed === true &&
    tokenSaleAuthorizationUsesSaleTicketAnchor(listing.saleAuthorization)
  );
}

function tokenListingHasPendingSaleTicketSeal(listing) {
  return (
    listing?.sealConfirmed !== true &&
    tokenSaleAuthorizationUsesSaleTicketAnchor(listing.saleAuthorization)
  );
}

function tokenSaleAuthorizationTermsMatch(left, right) {
  return (
    JSON.stringify(
      tokenSaleAuthorizationDraft({ ...left, anchorSignature: "", anchorTxid: "" }),
    ) ===
    JSON.stringify(
      tokenSaleAuthorizationDraft({ ...right, anchorSignature: "", anchorTxid: "" }),
    )
  );
}

function tokenListingAnchorIsPresent(vout, authorization) {
  const output = vout[authorization.anchorVout];
  return (
    output?.scriptpubkey === authorization.anchorScriptPubKey &&
    typeof output.value === "number" &&
    output.value === authorization.anchorValueSats
  );
}

function tokenListingIsExpired(listing, nowMs = Date.now()) {
  return Boolean(
    listing.saleAuthorization.expiresAt &&
      Date.parse(listing.saleAuthorization.expiresAt) <= nowMs,
  );
}

function spendsTokenListingAnchor(spent, listing) {
  return spent.some(
    (outpoint) =>
      outpoint.txid === listing.listingId &&
      outpoint.vout === listing.saleAuthorization.anchorVout,
  );
}

function tokenListingAnchorSpendMatchesAuthorization(vin, listing) {
  const authorization = listing?.saleAuthorization;
  if (!tokenSaleAuthorizationUsesSpendableSaleTicketAnchor(authorization)) {
    return false;
  }

  return vin.some((input) => {
    const prevout = input?.prevout ?? {};
    const txid =
      typeof input?.txid === "string" ? input.txid.toLowerCase() : "";
    const vout = Number.isSafeInteger(input?.vout) ? input.vout : -1;
    return (
      txid === listing.listingId &&
      vout === authorization.anchorVout &&
      prevout.scriptpubkey === authorization.anchorScriptPubKey &&
      prevout.scriptpubkey_address === listing.sellerAddress &&
      prevout.value === authorization.anchorValueSats
    );
  });
}

function tokenSellerPaymentRequiredSats(listing) {
  return listing.priceSats + listing.saleAuthorization.anchorValueSats;
}

function tokenListingAnchorOutpoint(listing) {
  if (
    listing?.saleAuthorization?.anchorType !== TOKEN_LISTING_ANCHOR_TYPE ||
    !/^[0-9a-f]{64}$/u.test(listing?.listingId ?? "") ||
    !Number.isSafeInteger(listing.saleAuthorization.anchorVout)
  ) {
    return null;
  }

  return {
    txid: listing.listingId,
    vout: listing.saleAuthorization.anchorVout,
  };
}

function tokenMarketOutspendCacheKey(network, anchor) {
  return `token-outspend:${network}:${anchor.txid}:${anchor.vout}`;
}

function cachedTokenMarketOutspend(network, anchor, allowStale = false) {
  const cached = TOKEN_MARKET_OUTSPEND_CACHE.get(
    tokenMarketOutspendCacheKey(network, anchor),
  );
  if (!cached) {
    return null;
  }

  const now = Date.now();
  if (now < cached.expiresAt || (allowStale && now < cached.staleUntil)) {
    return cached.payload;
  }

  TOKEN_MARKET_OUTSPEND_CACHE.delete(
    tokenMarketOutspendCacheKey(network, anchor),
  );
  return null;
}

function cacheTokenMarketOutspend(network, anchor, payload) {
  TOKEN_MARKET_OUTSPEND_CACHE.set(tokenMarketOutspendCacheKey(network, anchor), {
    expiresAt: Date.now() + TOKEN_MARKET_OUTSPEND_CACHE_TTL_MS,
    payload,
    staleUntil:
      Date.now() +
      TOKEN_MARKET_OUTSPEND_CACHE_TTL_MS +
      TOKEN_MARKET_OUTSPEND_CACHE_STALE_MS,
  });
}

async function tokenListingAnchorOutspend(listing, network) {
  const anchor = tokenListingAnchorOutpoint(listing);
  if (!anchor) {
    return null;
  }

  const cached = cachedTokenMarketOutspend(network, anchor);
  if (cached) {
    return cached;
  }

  try {
    const payload = await txOutspendPayload(anchor.txid, anchor.vout, network);
    cacheTokenMarketOutspend(network, anchor, payload);
    return payload;
  } catch (error) {
    console.error(
      `Token listing outspend lookup failed for ${anchor.txid}:${anchor.vout}: ${errorSummary(error)}`,
    );
    // Keep the last known answer if the node has a transient outspend miss.
    return cachedTokenMarketOutspend(network, anchor, true);
  }
}

async function filterSpendableTokenListings(listings, network) {
  const outspends = await Promise.all(
    listings.map((listing) => tokenListingAnchorOutspend(listing, network)),
  );
  const activeListings = [];
  const closedListings = [];

  for (const [index, listing] of listings.entries()) {
    const outspend = outspends[index];
    if (!outspend?.spent) {
      activeListings.push(listing);
      continue;
    }

    const blockTime = outspend.status?.block_time;
    closedListings.push({
      ...listing,
      closedAt:
        typeof blockTime === "number"
          ? new Date(blockTime * 1000).toISOString()
          : new Date().toISOString(),
      closedConfirmed: Boolean(outspend.status?.confirmed),
      closedTxid: typeof outspend.txid === "string" ? outspend.txid : "",
      closedVin: Number.isSafeInteger(outspend.vin) ? outspend.vin : undefined,
    });
  }

  return { closedListings, listings: activeListings };
}

function tokenListingWithoutCloseMetadata(listing) {
  const {
    closedAt,
    closedConfirmed,
    closedTxid,
    closedVin,
    ...activeListing
  } = listing ?? {};
  return activeListing;
}

async function tokenMarketTxIsVisible(txid, network) {
  const normalizedTxid = String(txid ?? "").trim().toLowerCase();
  if (!/^[0-9a-f]{64}$/u.test(normalizedTxid)) {
    return false;
  }

  const tx = await fetchTransactionWithPendingFallback(normalizedTxid, network);
  return Boolean(tx);
}

async function tokenMarketTxIsConfirmed(txid, network) {
  const normalizedTxid = String(txid ?? "").trim().toLowerCase();
  if (!/^[0-9a-f]{64}$/u.test(normalizedTxid)) {
    return false;
  }

  try {
    return transactionConfirmed(await fetchTransaction(normalizedTxid, network));
  } catch {
    return false;
  }
}

async function reconcileCachedTokenListingSeal(listing, network) {
  const sealTxid = String(listing?.sealTxid ?? "").trim().toLowerCase();
  if (
    listing?.sealConfirmed !== false ||
    !/^[0-9a-f]{64}$/u.test(sealTxid) ||
    !tokenSaleAuthorizationUsesSaleTicketAnchor(listing?.saleAuthorization)
  ) {
    return listing;
  }

  return (await tokenMarketTxIsConfirmed(sealTxid, network))
    ? { ...listing, sealConfirmed: true, sealTxid }
    : listing;
}

async function tokenStateWithReconciledListingSeals(payload, network) {
  if (!payload) {
    return payload;
  }

  const [listings, closedListings] = await Promise.all([
    mapWithConcurrency(
      Array.isArray(payload.listings) ? payload.listings : [],
      TX_FETCH_CONCURRENCY,
      (listing) => reconcileCachedTokenListingSeal(listing, network),
    ),
    mapWithConcurrency(
      Array.isArray(payload.closedListings) ? payload.closedListings : [],
      TX_FETCH_CONCURRENCY,
      (listing) => reconcileCachedTokenListingSeal(listing, network),
    ),
  ]);

  return {
    ...payload,
    closedListings,
    listings,
  };
}

async function reconcileCachedTokenClosedListing(closedListing, network) {
  closedListing = await reconcileCachedTokenListingSeal(closedListing, network);

  if (closedListing?.closedConfirmed) {
    return { kind: "closed", listing: closedListing };
  }

  const closedTxid = String(closedListing?.closedTxid ?? "")
    .trim()
    .toLowerCase();
  if (closedTxid && (await tokenMarketTxIsVisible(closedTxid, network))) {
    return { kind: "closed", listing: closedListing };
  }

  const outspend = await tokenListingAnchorOutspend(closedListing, network);
  if (outspend?.spent) {
    const blockTime = outspend.status?.block_time;
    return {
      kind: "closed",
      listing: {
        ...closedListing,
        closedAt:
          typeof blockTime === "number"
            ? new Date(blockTime * 1000).toISOString()
            : (closedListing.closedAt ?? new Date().toISOString()),
        closedConfirmed: Boolean(outspend.status?.confirmed),
        closedTxid:
          typeof outspend.txid === "string"
            ? outspend.txid.toLowerCase()
            : closedTxid,
        closedVin: Number.isSafeInteger(outspend.vin)
          ? outspend.vin
          : closedListing.closedVin,
      },
    };
  }

  const activeListing = tokenListingWithoutCloseMetadata(closedListing);
  return tokenListingAnchorOutpoint(activeListing)
    ? { kind: "active", listing: activeListing }
    : { kind: "closed", listing: closedListing };
}

async function reconcileCachedTokenMarketPayload(payload, network) {
  payload = await tokenStateWithReconciledListingSeals(payload, network);
  const activeListingsById = new Map(
    (Array.isArray(payload?.listings) ? payload.listings : [])
      .filter((listing) => listing?.listingId)
      .map((listing) => [listing.listingId, listing]),
  );
  const closedListings = [];

  const reconciledClosedListings = await mapWithConcurrency(
    Array.isArray(payload?.closedListings) ? payload.closedListings : [],
    TX_FETCH_CONCURRENCY,
    (listing) => reconcileCachedTokenClosedListing(listing, network),
  );

  for (const result of reconciledClosedListings) {
    if (result?.kind === "active" && result.listing?.listingId) {
      activeListingsById.set(result.listing.listingId, result.listing);
      continue;
    }

    if (result?.listing) {
      closedListings.push(result.listing);
    }
  }

  const sales = await mapWithConcurrency(
    Array.isArray(payload?.sales) ? payload.sales : [],
    TX_FETCH_CONCURRENCY,
    async (sale) => {
      if (sale?.confirmed) {
        return sale;
      }

      return (await tokenMarketTxIsVisible(sale?.txid, network)) ? sale : null;
    },
  );

  return {
    ...payload,
    closedListings,
    listings: [...activeListingsById.values()],
    sales: sales.filter(Boolean),
  };
}

function sortClosedTokenListings(listings) {
  return [...listings].sort(
    (left, right) =>
      Number(right.closedConfirmed) - Number(left.closedConfirmed) ||
      Date.parse(right.closedAt) - Date.parse(left.closedAt) ||
      left.listingId.localeCompare(right.listingId),
  );
}

function tokenMarketLogItemConfirmed(item) {
  if (item?.kind === "closed-listing") {
    return Boolean(item.closedListing?.closedConfirmed);
  }
  if (item?.kind === "sale") {
    return Boolean(item.sale?.confirmed);
  }
  return Boolean(item?.listing?.confirmed);
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

function sortTokenMarketLogItems(items) {
  return [...items].sort(
    (left, right) =>
      Number(tokenMarketLogItemConfirmed(right)) -
        Number(tokenMarketLogItemConfirmed(left)) ||
      Date.parse(tokenMarketLogItemCreatedAt(right)) -
        Date.parse(tokenMarketLogItemCreatedAt(left)) ||
      tokenMarketLogItemTxid(left).localeCompare(tokenMarketLogItemTxid(right)),
  );
}

function tokenMarketLogItemsFromState(state) {
  const listings = Array.isArray(state?.listings) ? state.listings : [];
  const closedListings = Array.isArray(state?.closedListings)
    ? state.closedListings
    : [];
  const sales = Array.isArray(state?.sales) ? state.sales : [];

  return sortTokenMarketLogItems([
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
  ]);
}

async function tokenPayloadWithSpendableListings(payload, network) {
  if (!payload || !Array.isArray(payload.listings)) {
    return payload;
  }

  const reconciledPayload = await reconcileCachedTokenMarketPayload(payload, network);
  const tokenListings = await filterSpendableTokenListings(
    reconciledPayload.listings,
    network,
  );
  const closedByKey = new Map();
  for (const listing of [
    ...(Array.isArray(reconciledPayload.closedListings)
      ? reconciledPayload.closedListings
      : []),
    ...tokenListings.closedListings,
  ]) {
    closedByKey.set(`${listing.listingId}:${listing.closedTxid ?? ""}`, listing);
  }

  return {
    ...reconciledPayload,
    closedListings: sortClosedTokenListings([...closedByKey.values()]),
    listings: tokenListings.listings,
  };
}

function parseTokenPayload(message, network) {
  if (!message.startsWith(TOKEN_PROTOCOL_PREFIX)) {
    return null;
  }

  const parts = message.slice(TOKEN_PROTOCOL_PREFIX.length).split(":");
  if (parts.length === 6 && parts[0] === TOKEN_CREATE_ACTION) {
    const ticker = normalizeTokenTicker(parts[1]);
    const maxSupply = Number(parts[2]);
    const mintAmount = Number(parts[3]);
    const mintPriceSats = Number(parts[4]);
    const registryAddress = String(parts[5] ?? "").trim();
    if (
      !/^[A-Z0-9]{1,12}$/u.test(ticker) ||
      !Number.isSafeInteger(maxSupply) ||
      maxSupply < 1 ||
      !Number.isSafeInteger(mintAmount) ||
      mintAmount < 1 ||
      mintAmount > maxSupply ||
      !Number.isSafeInteger(mintPriceSats) ||
      mintPriceSats < TOKEN_MIN_MUTATION_PRICE_SATS ||
      !isValidBitcoinAddress(registryAddress, network)
    ) {
      return null;
    }

    return {
      kind: "create",
      maxSupply,
      mintAmount,
      mintPriceSats,
      registryAddress,
      ticker,
    };
  }

  if (parts.length === 3 && parts[0] === TOKEN_MINT_ACTION) {
    const tokenId = String(parts[1] ?? "").toLowerCase();
    const amount = Number(parts[2]);
    if (
      !/^[0-9a-f]{64}$/u.test(tokenId) ||
      !Number.isSafeInteger(amount) ||
      amount < 1
    ) {
      return null;
    }

    return { amount, kind: "mint", tokenId };
  }

  if (parts.length === 4 && parts[0] === TOKEN_SEND_ACTION) {
    const tokenId = String(parts[1] ?? "").toLowerCase();
    const amount = Number(parts[2]);
    const recipientAddress = String(parts[3] ?? "").trim();
    if (
      !/^[0-9a-f]{64}$/u.test(tokenId) ||
      !Number.isSafeInteger(amount) ||
      amount < 1 ||
      !isValidBitcoinAddress(recipientAddress, network)
    ) {
      return null;
    }

    return { amount, kind: "send", recipientAddress, tokenId };
  }

  if (parts.length === 2 && parts[0] === TOKEN_LIST_ACTION) {
    try {
      return {
        kind: "list",
        saleAuthorization: parseTokenSaleAuthorizationJson(
          decodeTextBase64Url(parts[1]),
          network,
        ),
      };
    } catch {
      return null;
    }
  }

  if (
    parts.length === 3 &&
    parts[0] === TOKEN_SEAL_ACTION &&
    /^[0-9a-fA-F]{64}$/u.test(parts[1])
  ) {
    try {
      return {
        kind: "seal",
        listingId: parts[1].toLowerCase(),
        saleAuthorization: parseTokenSaleAuthorizationJson(
          decodeTextBase64Url(parts[2]),
          network,
        ),
      };
    } catch {
      return null;
    }
  }

  if (
    parts.length === 2 &&
    parts[0] === TOKEN_DELIST_ACTION &&
    /^[0-9a-fA-F]{64}$/u.test(parts[1])
  ) {
    return { kind: "delist", listingId: parts[1].toLowerCase() };
  }

  if (
    parts.length === 3 &&
    parts[0] === TOKEN_BUY_ACTION &&
    /^[0-9a-fA-F]{64}$/u.test(parts[1])
  ) {
    const buyerAddress = String(parts[2] ?? "").trim();
    if (!isValidBitcoinAddress(buyerAddress, network)) {
      return null;
    }

    return {
      buyerAddress,
      kind: "buy",
      listingId: parts[1].toLowerCase(),
    };
  }

  return null;
}

function normalizeTokenScope(value) {
  const raw = String(value ?? "").trim();
  if (/^[0-9a-fA-F]{64}$/u.test(raw)) {
    return raw.toLowerCase();
  }

  const ticker = normalizeTokenTicker(raw);
  return ticker === WORK_TOKEN_TICKER ? WORK_TOKEN_ID : ticker;
}

function tokenMatchesScope(token, scope) {
  if (!scope) {
    return true;
  }

  return token.tokenId === scope || token.ticker === scope;
}

function emptyTokenState() {
  return {
    closedListings: [],
    creationSats: 0,
    confirmedSupply: 0,
    holders: [],
    listings: [],
    mints: [],
    pendingSupply: 0,
    sales: [],
    transfers: [],
    tokens: [],
  };
}

function tokenTransactionTime(tx) {
  return typeof tx.status?.block_time === "number"
    ? tx.status.block_time * 1000
    : Date.now();
}

function tokenProtocolSortedTransactions(txs) {
  return txs.slice().sort((left, right) => {
    const leftConfirmed = transactionConfirmed(left);
    const rightConfirmed = transactionConfirmed(right);
    if (leftConfirmed !== rightConfirmed) {
      return Number(rightConfirmed) - Number(leftConfirmed);
    }

    return (
      (transactionBlockHeight(left) ?? Number.MAX_SAFE_INTEGER) -
        (transactionBlockHeight(right) ?? Number.MAX_SAFE_INTEGER) ||
      (transactionBlockIndex(left) ?? Number.MAX_SAFE_INTEGER) -
        (transactionBlockIndex(right) ?? Number.MAX_SAFE_INTEGER) ||
      transactionTxid(left).localeCompare(transactionTxid(right))
    );
  });
}

function tokenDefinitionsFromTransactions(txs, indexAddress, network) {
  const tokens = [];
  let creationSats = 0;

  for (const tx of tokenProtocolSortedTransactions(txs)) {
    const txid = transactionTxid(tx);
    if (!txid) {
      continue;
    }

    const vin = Array.isArray(tx.vin) ? tx.vin : [];
    const vout = Array.isArray(tx.vout) ? tx.vout : [];
    const actorAddress = inputAddresses(vin)[0] ?? "";
    if (!isValidBitcoinAddress(actorAddress, network)) {
      continue;
    }

    const messages = decodedProtocolMessages(vout, TOKEN_PROTOCOL_PREFIX);
    if (messages.length === 0) {
      continue;
    }

    let remainingCreationSats = tokenPaymentAmountBeforeProtocol(
      vout,
      indexAddress,
    );
    const confirmed = transactionConfirmed(tx);
    const createdAt = new Date(tokenTransactionTime(tx)).toISOString();

    for (const message of messages) {
      const parsed = parseTokenPayload(message, network);
      if (
        !parsed ||
        parsed.kind !== "create" ||
        remainingCreationSats < TOKEN_CREATION_PRICE_SATS ||
        tokens.some((token) => token.tokenId === txid) ||
        !tokenCreationIsAllowed({
          creatorAddress: actorAddress,
          ticker: parsed.ticker,
          tokenId: txid,
        })
      ) {
        continue;
      }

      remainingCreationSats -= TOKEN_CREATION_PRICE_SATS;
      creationSats += TOKEN_CREATION_PRICE_SATS;
      tokens.push({
        confirmed,
        createdAt,
        creationFeeSats: TOKEN_CREATION_PRICE_SATS,
        creatorAddress: actorAddress,
        dataBytes: proofProtocolDataBytesForVout(vout),
        maxSupply: parsed.maxSupply,
        mintAmount: parsed.mintAmount,
        mintPriceSats: parsed.mintPriceSats,
        network,
        registryAddress: parsed.registryAddress,
        ticker: parsed.ticker,
        tokenId: txid,
        txid,
      });
    }
  }

  return {
    creationSats,
    tokens: tokens.sort(
      (left, right) =>
        Number(right.confirmed) - Number(left.confirmed) ||
        Date.parse(right.createdAt) - Date.parse(left.createdAt) ||
        left.txid.localeCompare(right.txid),
    ),
  };
}

function tokenStateFromTransactions(
  indexTxs,
  registryTxsByAddress,
  indexAddress,
  network,
  tokenScope = "",
  seedTokens = [],
) {
  const { tokens: allTokens } = tokenDefinitionsFromTransactions(
    indexTxs,
    indexAddress,
    network,
  );
  const scope = normalizeTokenScope(tokenScope);
  const tokensByDefinition = new Map();
  for (const token of Array.isArray(seedTokens) ? seedTokens : []) {
    if (token?.tokenId) {
      tokensByDefinition.set(token.tokenId, token);
    }
  }
  for (const token of allTokens) {
    if (token?.tokenId) {
      tokensByDefinition.set(token.tokenId, token);
    }
  }
  const tokens = [...tokensByDefinition.values()].filter((token) =>
    tokenMatchesScope(token, scope),
  );
  const creationSats = tokens.reduce(
    (total, token) => total + token.creationFeeSats,
    0,
  );
  const tokensById = new Map(tokens.map((token) => [token.tokenId, token]));
  const tokenSupply = new Map();
  const balances = new Map();
  const listings = new Map();
  const closedListings = [];
  const mints = [];
  const sales = [];
  const transfers = [];
  let confirmedSupply = 0;
  let pendingSupply = 0;
  const balanceKeyFor = (tokenId, ownerAddress) => `${tokenId}:${ownerAddress}`;
  const reservedBalanceFor = (tokenId, ownerAddress) => {
    let reserved = 0;
    for (const listing of listings.values()) {
      if (
        listing.tokenId === tokenId &&
        listing.sellerAddress === ownerAddress &&
        !tokenListingIsExpired(listing)
      ) {
        reserved += listing.amount;
      }
    }
    return reserved;
  };
  const spendableBalanceFor = (tokenId, ownerAddress) =>
    (balances.get(balanceKeyFor(tokenId, ownerAddress)) ?? 0) -
    reservedBalanceFor(tokenId, ownerAddress);
  const closeListing = (listing, event) => {
    if (
      closedListings.some(
        (closed) =>
          closed.listingId === listing.listingId &&
          closed.closedTxid === event.txid,
      )
    ) {
      return;
    }

    closedListings.push({
      ...listing,
      closedAt: event.createdAt,
      closedConfirmed: event.confirmed,
      closedTxid: event.txid,
    });
  };
  const closeListingsSpentByEvent = (spentOutpoints, event) => {
    for (const [listingId, listing] of [...listings.entries()]) {
      if (!spendsTokenListingAnchor(spentOutpoints, listing)) {
        continue;
      }

      listings.delete(listingId);
      closeListing(listing, event);
    }
  };

  const registryAddresses = [
    ...new Set(tokens.map((token) => token.registryAddress).filter(Boolean)),
  ];

  for (const registryAddress of registryAddresses) {
    const txs = registryTxsByAddress.get(registryAddress) ?? [];
    for (const tx of tokenProtocolSortedTransactions(txs)) {
      const txid = transactionTxid(tx);
      if (!txid) {
        continue;
      }

      const vin = Array.isArray(tx.vin) ? tx.vin : [];
      const vout = Array.isArray(tx.vout) ? tx.vout : [];
      const txInputAddresses = inputAddresses(vin);
      const actorAddress = txInputAddresses[0] ?? "";
      if (!isValidBitcoinAddress(actorAddress, network)) {
        continue;
      }

      const messages = decodedProtocolMessages(vout, TOKEN_PROTOCOL_PREFIX);
      if (messages.length === 0) {
        continue;
      }

      let remainingRegistrySats = tokenPaymentAmountBeforeProtocol(
        vout,
        registryAddress,
      );
      const paymentOutputs = paymentOutputsBeforeTokenProtocol(vout);
      const eventSpentOutpoints = spentOutpoints(vin);
      const confirmed = transactionConfirmed(tx);
      const createdAt = new Date(tokenTransactionTime(tx)).toISOString();

      for (const message of messages) {
        const parsed = parseTokenPayload(message, network);
        if (!parsed) {
          continue;
        }

        if (parsed.kind === "mint") {
          const mintedToken = tokensById.get(parsed.tokenId);
          if (
            !mintedToken ||
            mintedToken.registryAddress !== registryAddress ||
            parsed.amount !== mintedToken.mintAmount ||
            remainingRegistrySats < mintedToken.mintPriceSats
          ) {
            continue;
          }

          const currentSupply = tokenSupply.get(mintedToken.tokenId) ?? {
            confirmed: 0,
            pending: 0,
          };
          if (
            currentSupply.confirmed + currentSupply.pending + parsed.amount >
            mintedToken.maxSupply
          ) {
            continue;
          }

          remainingRegistrySats -= mintedToken.mintPriceSats;
          if (confirmed) {
            currentSupply.confirmed += parsed.amount;
            confirmedSupply += parsed.amount;
            const balanceKey = balanceKeyFor(mintedToken.tokenId, actorAddress);
            balances.set(
              balanceKey,
              (balances.get(balanceKey) ?? 0) + parsed.amount,
            );
          } else {
            currentSupply.pending += parsed.amount;
            pendingSupply += parsed.amount;
          }
          tokenSupply.set(mintedToken.tokenId, currentSupply);

          mints.push({
            amount: parsed.amount,
            confirmed,
            createdAt,
            dataBytes: proofProtocolDataBytesForVout(vout),
            minterAddress: actorAddress,
            network,
            paidSats: mintedToken.mintPriceSats,
            registryAddress: mintedToken.registryAddress,
            ticker: mintedToken.ticker,
            tokenId: mintedToken.tokenId,
            txid,
          });
          continue;
        }

        if (parsed.kind === "send") {
          const sentToken = tokensById.get(parsed.tokenId);
          if (
            !sentToken ||
            sentToken.registryAddress !== registryAddress ||
            remainingRegistrySats < TOKEN_MIN_MUTATION_PRICE_SATS
          ) {
            continue;
          }

          const senderBalanceKey = balanceKeyFor(sentToken.tokenId, actorAddress);
          const recipientBalanceKey = balanceKeyFor(
            sentToken.tokenId,
            parsed.recipientAddress,
          );
          const senderBalance = balances.get(senderBalanceKey) ?? 0;
          if (
            confirmed &&
            spendableBalanceFor(sentToken.tokenId, actorAddress) < parsed.amount
          ) {
            continue;
          }

          remainingRegistrySats -= TOKEN_MIN_MUTATION_PRICE_SATS;
          if (confirmed) {
            balances.set(senderBalanceKey, senderBalance - parsed.amount);
            balances.set(
              recipientBalanceKey,
              (balances.get(recipientBalanceKey) ?? 0) + parsed.amount,
            );
          }

          transfers.push({
            amount: parsed.amount,
            confirmed,
            createdAt,
            dataBytes: proofProtocolDataBytesForVout(vout),
            network,
            paidSats: TOKEN_MIN_MUTATION_PRICE_SATS,
            recipientAddress: parsed.recipientAddress,
            registryAddress: sentToken.registryAddress,
            senderAddress: actorAddress,
            ticker: sentToken.ticker,
            tokenId: sentToken.tokenId,
            txid,
          });
          continue;
        }

        if (parsed.kind === "list") {
          const authorization = parsed.saleAuthorization;
          const listedToken = tokensById.get(authorization.tokenId);
          if (
            !listedToken ||
            listedToken.registryAddress !== registryAddress ||
            authorization.registryAddress !== registryAddress ||
            authorization.ticker !== listedToken.ticker ||
            authorization.sellerAddress !== actorAddress ||
            remainingRegistrySats < TOKEN_MIN_MUTATION_PRICE_SATS ||
            spendableBalanceFor(listedToken.tokenId, actorAddress) <
              authorization.amount ||
            !tokenListingAnchorIsPresent(vout, authorization) ||
            listings.has(txid)
          ) {
            continue;
          }

          remainingRegistrySats -= TOKEN_MIN_MUTATION_PRICE_SATS;
          listings.set(txid, {
            amount: authorization.amount,
            confirmed,
            createdAt,
            dataBytes: proofProtocolDataBytesForVout(vout),
            listingId: txid,
            network,
            priceSats: authorization.priceSats,
            registryAddress,
            saleAuthorization: authorization,
            sellerAddress: actorAddress,
            ticker: listedToken.ticker,
            tokenId: listedToken.tokenId,
          });
          continue;
        }

        if (parsed.kind === "seal") {
          const listing = listings.get(parsed.listingId);
          const authorization = parsed.saleAuthorization;
          if (
            !listing ||
            listing.sellerAddress !== actorAddress ||
            remainingRegistrySats < TOKEN_MIN_MUTATION_PRICE_SATS ||
            !tokenSaleAuthorizationTermsMatch(
              listing.saleAuthorization,
              authorization,
            ) ||
            authorization.anchorTxid !== listing.listingId ||
            !tokenSaleAuthorizationUsesSaleTicketAnchor(authorization)
          ) {
            continue;
          }

          remainingRegistrySats -= TOKEN_MIN_MUTATION_PRICE_SATS;
          listings.set(listing.listingId, {
            ...listing,
            saleAuthorization: authorization,
            sealAt: createdAt,
            sealConfirmed: confirmed,
            sealDataBytes: proofProtocolDataBytesForVout(vout),
            sealTxid: txid,
          });
          continue;
        }

        if (parsed.kind === "delist") {
          const listing = listings.get(parsed.listingId);
          if (
            !listing ||
            listing.sellerAddress !== actorAddress ||
            remainingRegistrySats < TOKEN_MIN_MUTATION_PRICE_SATS ||
            !spendsTokenListingAnchor(eventSpentOutpoints, listing)
          ) {
            continue;
          }

          remainingRegistrySats -= TOKEN_MIN_MUTATION_PRICE_SATS;
          closeListing(listing, {
            confirmed,
            createdAt,
            txid,
          });
          listings.delete(listing.listingId);
          continue;
        }

        if (parsed.kind === "buy") {
          const listing = listings.get(parsed.listingId);
          const listingHasValidSaleTicketSpend = listing
            ? tokenSaleAuthorizationUsesSaleTicketAnchor(
                listing.saleAuthorization,
              ) || tokenListingAnchorSpendMatchesAuthorization(vin, listing)
            : false;
          const sellerBalanceKey = listing
            ? balanceKeyFor(listing.tokenId, listing.sellerAddress)
            : "";
          const buyerBalanceKey = listing
            ? balanceKeyFor(listing.tokenId, parsed.buyerAddress)
            : "";
          if (
            !listing ||
            !txInputAddresses.includes(parsed.buyerAddress) ||
            remainingRegistrySats < TOKEN_MIN_MUTATION_PRICE_SATS ||
            !listingHasValidSaleTicketSpend ||
            (listing.saleAuthorization.buyerAddress &&
              listing.saleAuthorization.buyerAddress !== parsed.buyerAddress) ||
            tokenListingIsExpired(listing) ||
            !spendsTokenListingAnchor(eventSpentOutpoints, listing) ||
            paymentAmountFromSnapshots(paymentOutputs, listing.sellerAddress) <
              tokenSellerPaymentRequiredSats(listing) ||
            (confirmed &&
              (balances.get(sellerBalanceKey) ?? 0) < listing.amount)
          ) {
            continue;
          }

          remainingRegistrySats -= TOKEN_MIN_MUTATION_PRICE_SATS;
          closeListing(listing, {
            confirmed,
            createdAt,
            txid,
          });
          listings.delete(listing.listingId);
          if (confirmed) {
            const sellerBalance = balances.get(sellerBalanceKey) ?? 0;
            balances.set(sellerBalanceKey, sellerBalance - listing.amount);
            balances.set(
              buyerBalanceKey,
              (balances.get(buyerBalanceKey) ?? 0) + listing.amount,
            );
          }

          sales.push({
            amount: listing.amount,
            buyerAddress: parsed.buyerAddress,
            confirmed,
            createdAt,
            listingId: listing.listingId,
            network,
            paidSats:
              tokenSellerPaymentRequiredSats(listing) +
              TOKEN_MIN_MUTATION_PRICE_SATS,
            priceSats: listing.priceSats,
            registryAddress,
            sellerAddress: listing.sellerAddress,
            ticker: listing.ticker,
            tokenId: listing.tokenId,
            txid,
          });
        }
      }

      closeListingsSpentByEvent(eventSpentOutpoints, {
        confirmed,
        createdAt,
        txid,
      });
    }
  }

  return {
    closedListings: closedListings.sort(
      (left, right) =>
        Number(right.closedConfirmed) - Number(left.closedConfirmed) ||
        Date.parse(right.closedAt) - Date.parse(left.closedAt) ||
        left.listingId.localeCompare(right.listingId),
    ),
    creationSats,
    confirmedSupply,
    holders: [...balances.entries()]
      .filter(([, balance]) => balance > 0)
      .map(([key, balance]) => ({
        address: String(key).split(":").slice(1).join(":"),
        balance,
      }))
      .sort(
        (left, right) =>
          right.balance - left.balance ||
          left.address.localeCompare(right.address),
      ),
    listings: [...listings.values()]
      .filter((listing) => !tokenListingIsExpired(listing))
      .sort(
        (left, right) =>
          Number(right.confirmed) - Number(left.confirmed) ||
          Date.parse(right.createdAt) - Date.parse(left.createdAt) ||
          left.listingId.localeCompare(right.listingId),
      ),
    mints: mints.sort(
      (left, right) =>
        Number(right.confirmed) - Number(left.confirmed) ||
        Date.parse(right.createdAt) - Date.parse(left.createdAt) ||
        left.txid.localeCompare(right.txid),
    ),
    pendingSupply,
    sales: sales.sort(
      (left, right) =>
        Number(right.confirmed) - Number(left.confirmed) ||
        Date.parse(right.createdAt) - Date.parse(left.createdAt) ||
        left.txid.localeCompare(right.txid),
    ),
    transfers: transfers.sort(
      (left, right) =>
        Number(right.confirmed) - Number(left.confirmed) ||
        Date.parse(right.createdAt) - Date.parse(left.createdAt) ||
        left.txid.localeCompare(right.txid),
    ),
    tokens,
  };
}

function emptyRushState(network = "livenet") {
  return {
    indexedAt: new Date().toISOString(),
    mints: [],
    network,
    registryAddress: RUSH_REGISTRY_ADDRESSES[network] ?? "",
    stats: rushStatsFromMints([]),
  };
}

function rushStateFromTransactions(txs, registryAddress, network) {
  if (!registryAddress) {
    return emptyRushState(network);
  }

  const mints = [];
  let confirmedOrdinal = 0;

  for (const tx of tokenProtocolSortedTransactions(txs)) {
    const txid = transactionTxid(tx);
    if (!txid || mints.some((mint) => mint.txid === txid)) {
      continue;
    }

    const vin = Array.isArray(tx.vin) ? tx.vin : [];
    const vout = Array.isArray(tx.vout) ? tx.vout : [];
    const minterAddress = transactionInputAddresses(vin)[0] ?? "";
    if (!isValidBitcoinAddress(minterAddress, network)) {
      continue;
    }

    const messages = decodedProtocolMessages(vout, RUSH_PROTOCOL_PREFIX);
    if (!messages.includes(RUSH_MINT_PAYLOAD)) {
      continue;
    }

    if (
      rushPaymentAmountBeforeProtocol(vout, registryAddress) <
      RUSH_MINT_PRICE_SATS
    ) {
      continue;
    }

    const confirmed = transactionConfirmed(tx);
    const ordinal = confirmed ? (confirmedOrdinal += 1) : undefined;
    const rewardOrdinal = ordinal ?? confirmedOrdinal + 1;
    const rewardUnits = rushRewardUnitsForOrdinal(rewardOrdinal);
    const phase = rushPhaseForOrdinal(rewardOrdinal);

    mints.push({
      amount: formatRushUnits(rewardUnits),
      amountUnits: rewardUnits.toString(),
      confirmed,
      createdAt: new Date(tokenTransactionTime(tx)).toISOString(),
      dataBytes: proofProtocolDataBytesForVout(vout),
      minterAddress,
      network,
      ordinal,
      overflow: confirmed ? rewardUnits === 0n : false,
      paidSats: RUSH_MINT_PRICE_SATS,
      phase: phase?.phase,
      registryAddress,
      txid,
    });
  }

  const sortedMints = mints.sort(
    (left, right) =>
      Number(right.confirmed) - Number(left.confirmed) ||
      (right.ordinal ?? Number.MAX_SAFE_INTEGER) -
        (left.ordinal ?? Number.MAX_SAFE_INTEGER) ||
      Date.parse(right.createdAt) - Date.parse(left.createdAt) ||
      left.txid.localeCompare(right.txid),
  );

  return {
    indexedAt: new Date().toISOString(),
    mints: sortedMints,
    network,
    registryAddress,
    stats: rushStatsFromMints(sortedMints),
  };
}

function idEventMinimumPaymentSats(kind) {
  return kind === "register"
    ? ID_REGISTRATION_PRICE_SATS
    : ID_MUTATION_PRICE_SATS;
}

function paymentOutputsBeforeIdProtocol(vout) {
  const protocolIndex = firstIdProtocolOutputIndex(vout);
  return vout.flatMap((output, index) => {
    if (
      typeof output.scriptpubkey_address !== "string" ||
      typeof output.value !== "number" ||
      output.value <= 0 ||
      (protocolIndex !== -1 && index >= protocolIndex)
    ) {
      return [];
    }

    return [{ address: output.scriptpubkey_address, amountSats: output.value }];
  });
}

function paymentAmountFromSnapshots(outputs, address) {
  return outputs.reduce(
    (total, output) =>
      total + (output.address === address ? output.amountSats : 0),
    0,
  );
}

function paymentAmountBeforeIdProtocol(vout, address) {
  const protocolIndex = firstIdProtocolOutputIndex(vout);
  return vout.reduce((total, output, index) => {
    if (
      output.scriptpubkey_address === address &&
      typeof output.value === "number" &&
      output.value > 0 &&
      (protocolIndex === -1 || index < protocolIndex)
    ) {
      return total + output.value;
    }

    return total;
  }, 0);
}

function normalizePowId(value) {
  return value
    .trim()
    .toLowerCase()
    .replace(/^@/u, "")
    .replace(/@proofofwork\.me$/u, "")
    .trim();
}

function parseIdRegistrationPayload(payload, network) {
  let rawId = "";
  let ownerAddress = "";
  let receiveAddress = "";
  let pgpEncoded = "";

  if (payload.startsWith("r2:")) {
    const parts = payload.split(":");
    if (parts.length < 4 || parts.length > 5) {
      return null;
    }

    const [, idEncoded, owner, receiver, pgp] = parts;
    try {
      rawId = decodeTextBase64Url(idEncoded);
    } catch {
      return null;
    }

    ownerAddress = owner;
    receiveAddress = receiver;
    pgpEncoded = pgp ?? "";
  } else if (payload.startsWith("r:")) {
    const parts = payload.split(":");
    if (parts.length < 4 || parts.length > 5) {
      return null;
    }

    const [, id, owner, receiver, pgp] = parts;
    rawId = id;
    ownerAddress = owner;
    receiveAddress = receiver;
    pgpEncoded = pgp ?? "";
  } else {
    return null;
  }

  const id = normalizePowId(rawId);
  if (
    !id ||
    !isValidBitcoinAddress(ownerAddress, network) ||
    !isValidBitcoinAddress(receiveAddress, network)
  ) {
    return null;
  }

  let pgpKey = "";
  if (pgpEncoded) {
    try {
      pgpKey = decodeTextBase64Url(pgpEncoded).trim();
    } catch {
      return null;
    }
  }

  return {
    id,
    ownerAddress,
    pgpKey,
    receiveAddress,
  };
}

function parseIdReceiverUpdatePayload(payload, network) {
  if (!payload.startsWith("u:")) {
    return null;
  }

  const parts = payload.split(":");
  if (parts.length !== 3) {
    return null;
  }

  const [, idEncoded, receiver] = parts;
  let rawId = "";
  try {
    rawId = decodeTextBase64Url(idEncoded);
  } catch {
    return null;
  }

  const id = normalizePowId(rawId);
  if (!id || !isValidBitcoinAddress(receiver, network)) {
    return null;
  }

  return {
    id,
    receiveAddress: receiver,
  };
}

function parseIdTransferPayload(payload, network) {
  if (!payload.startsWith("t:")) {
    return null;
  }

  const parts = payload.split(":");
  if (parts.length < 3 || parts.length > 4) {
    return null;
  }

  const [, idEncoded, owner, receiver] = parts;
  let rawId = "";
  try {
    rawId = decodeTextBase64Url(idEncoded);
  } catch {
    return null;
  }

  const receiveAddress = receiver?.trim() || owner;
  const id = normalizePowId(rawId);
  if (
    !id ||
    !isValidBitcoinAddress(owner, network) ||
    !isValidBitcoinAddress(receiveAddress, network)
  ) {
    return null;
  }

  return {
    id,
    ownerAddress: owner,
    receiveAddress,
  };
}

function saleAuthorizationDraft({
  anchorSigHashType,
  anchorSignature,
  anchorScriptPubKey,
  anchorTxid,
  anchorType,
  anchorValueSats,
  anchorVout,
  buyerAddress,
  expiresAt,
  id,
  nonce,
  priceSats,
  receiveAddress,
  sellerAddress,
  sellerPublicKey,
  version = ID_SALE_AUTH_VERSION,
}) {
  const draft = {
    buyerAddress: buyerAddress?.trim() || undefined,
    expiresAt: expiresAt?.trim() || undefined,
    id: normalizePowId(id),
    nonce,
    priceSats: Math.floor(priceSats),
    receiveAddress: receiveAddress?.trim() || undefined,
    sellerAddress: sellerAddress.trim(),
    sellerPublicKey: sellerPublicKey?.trim().toLowerCase() || undefined,
    version,
  };

  if (
    version === ID_SALE_AUTH_VERSION_ANCHORED ||
    version === ID_SALE_AUTH_VERSION ||
    version === ID_SALE_AUTH_VERSION_TICKET
  ) {
    draft.anchorSigHashType = Number.isSafeInteger(anchorSigHashType)
      ? Math.floor(anchorSigHashType)
      : version === ID_SALE_AUTH_VERSION ||
          version === ID_SALE_AUTH_VERSION_TICKET
        ? ID_LISTING_ANCHOR_SIGHASH_TYPE
        : undefined;
    draft.anchorSignature = anchorSignature?.trim().toLowerCase() || undefined;
    draft.anchorScriptPubKey =
      anchorScriptPubKey?.trim().toLowerCase() || undefined;
    draft.anchorTxid = anchorTxid?.trim().toLowerCase() || undefined;
    draft.anchorType =
      anchorType?.trim() ||
      (version === ID_SALE_AUTH_VERSION_TICKET
        ? ID_LISTING_TICKET_ANCHOR_TYPE
        : version === ID_SALE_AUTH_VERSION
          ? ID_LISTING_ANCHOR_TYPE
          : ID_LISTING_ANCHOR_TYPE_LEGACY);
    draft.anchorValueSats = Number.isSafeInteger(anchorValueSats)
      ? Math.floor(anchorValueSats)
      : ID_LISTING_ANCHOR_VALUE_SATS;
    draft.anchorVout = Number.isSafeInteger(anchorVout)
      ? Math.floor(anchorVout)
      : 2;

    if (
      version === ID_SALE_AUTH_VERSION_ANCHORED &&
      !draft.anchorScriptPubKey
    ) {
      draft.anchorScriptPubKey = marketplaceLegacyAnchorScriptPubKey();
    }
  }

  return draft;
}

function saleAuthorizationMessage(authorization) {
  const lines = [
    "ProofOfWork.Me ID Sale",
    `version:${authorization.version}`,
    `id:${normalizePowId(authorization.id)}@proofofwork.me`,
    `seller:${authorization.sellerAddress}`,
    `priceSats:${Math.floor(authorization.priceSats)}`,
    `buyer:${authorization.buyerAddress || "*"}`,
    `receiver:${authorization.receiveAddress || "*"}`,
    `nonce:${authorization.nonce}`,
    `expiresAt:${authorization.expiresAt || ""}`,
  ];

  if (
    authorization.version === ID_SALE_AUTH_VERSION_ANCHORED ||
    authorization.version === ID_SALE_AUTH_VERSION ||
    authorization.version === ID_SALE_AUTH_VERSION_TICKET
  ) {
    lines.push(
      `anchorType:${authorization.anchorType || ""}`,
      `anchorTxid:${authorization.anchorTxid || ""}`,
      `anchorVout:${authorization.anchorVout ?? ""}`,
      `anchorValueSats:${authorization.anchorValueSats ?? ""}`,
      `anchorScriptPubKey:${authorization.anchorScriptPubKey || ""}`,
      `anchorSigHashType:${authorization.anchorSigHashType ?? ""}`,
      `sellerPublicKey:${authorization.sellerPublicKey || ""}`,
    );
  }

  return lines.join("\n");
}

function parseSaleAuthorizationJson(value, network) {
  const parsed = JSON.parse(value);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("Sale authorization must be a JSON object.");
  }

  const id = normalizePowId(typeof parsed.id === "string" ? parsed.id : "");
  const sellerAddress =
    typeof parsed.sellerAddress === "string" ? parsed.sellerAddress.trim() : "";
  const buyerAddress =
    typeof parsed.buyerAddress === "string" ? parsed.buyerAddress.trim() : "";
  const receiveAddress =
    typeof parsed.receiveAddress === "string"
      ? parsed.receiveAddress.trim()
      : "";
  const signature =
    typeof parsed.signature === "string" ? parsed.signature.trim() : "";
  const nonce = typeof parsed.nonce === "string" ? parsed.nonce.trim() : "";
  const expiresAt =
    typeof parsed.expiresAt === "string" ? parsed.expiresAt.trim() : "";
  const priceSats =
    typeof parsed.priceSats === "number"
      ? Math.floor(parsed.priceSats)
      : Number.NaN;
  const version =
    parsed.version === ID_SALE_AUTH_VERSION_LEGACY
      ? ID_SALE_AUTH_VERSION_LEGACY
      : parsed.version === ID_SALE_AUTH_VERSION_ANCHORED
        ? ID_SALE_AUTH_VERSION_ANCHORED
        : parsed.version === ID_SALE_AUTH_VERSION
          ? ID_SALE_AUTH_VERSION
          : parsed.version === ID_SALE_AUTH_VERSION_TICKET
            ? ID_SALE_AUTH_VERSION_TICKET
            : "";
  const anchorType =
    typeof parsed.anchorType === "string" ? parsed.anchorType.trim() : "";
  const anchorSigHashType =
    typeof parsed.anchorSigHashType === "number"
      ? Math.floor(parsed.anchorSigHashType)
      : Number.NaN;
  const anchorSignature =
    typeof parsed.anchorSignature === "string"
      ? parsed.anchorSignature.trim().toLowerCase()
      : "";
  const anchorScriptPubKey =
    typeof parsed.anchorScriptPubKey === "string"
      ? parsed.anchorScriptPubKey.trim().toLowerCase()
      : "";
  const anchorTxid =
    typeof parsed.anchorTxid === "string"
      ? parsed.anchorTxid.trim().toLowerCase()
      : "";
  const anchorVout =
    typeof parsed.anchorVout === "number"
      ? Math.floor(parsed.anchorVout)
      : Number.NaN;
  const anchorValueSats =
    typeof parsed.anchorValueSats === "number"
      ? Math.floor(parsed.anchorValueSats)
      : Number.NaN;
  const sellerPublicKey =
    typeof parsed.sellerPublicKey === "string"
      ? parsed.sellerPublicKey.trim().toLowerCase()
      : "";

  if (!version || !id || !isValidBitcoinAddress(sellerAddress, network)) {
    throw new Error("Sale authorization is invalid.");
  }

  if (buyerAddress && !isValidBitcoinAddress(buyerAddress, network)) {
    throw new Error("Sale buyer address is invalid.");
  }

  if (receiveAddress && !isValidBitcoinAddress(receiveAddress, network)) {
    throw new Error("Sale receive address is invalid.");
  }

  if (
    !Number.isSafeInteger(priceSats) ||
    priceSats < 0 ||
    !nonce ||
    nonce.length > 160
  ) {
    throw new Error("Sale authorization terms are invalid.");
  }

  if (expiresAt && Number.isNaN(Date.parse(expiresAt))) {
    throw new Error("Sale authorization expiry is invalid.");
  }

  if (version === ID_SALE_AUTH_VERSION_ANCHORED) {
    if (
      anchorType !== ID_LISTING_ANCHOR_TYPE_LEGACY ||
      !Number.isSafeInteger(anchorVout) ||
      anchorVout < 0 ||
      !Number.isSafeInteger(anchorValueSats) ||
      anchorValueSats < 546 ||
      anchorScriptPubKey !== marketplaceLegacyAnchorScriptPubKey()
    ) {
      throw new Error("Sale authorization anchor is invalid.");
    }
  }

  if (version === ID_SALE_AUTH_VERSION) {
    if (
      anchorType !== ID_LISTING_ANCHOR_TYPE ||
      !/^[0-9a-f]{64}$/u.test(anchorTxid) ||
      !Number.isSafeInteger(anchorVout) ||
      anchorVout < 0 ||
      !Number.isSafeInteger(anchorValueSats) ||
      anchorValueSats < 546 ||
      !/^[0-9a-f]+$/u.test(anchorScriptPubKey) ||
      !validPublicKeyHex(sellerPublicKey) ||
      anchorSigHashType !== ID_LISTING_ANCHOR_SIGHASH_TYPE ||
      !validSignatureHex(anchorSignature)
    ) {
      throw new Error("Sale authorization anchor is invalid.");
    }
  }

  if (version === ID_SALE_AUTH_VERSION_TICKET) {
    if (
      anchorType !== ID_LISTING_TICKET_ANCHOR_TYPE ||
      !Number.isSafeInteger(anchorVout) ||
      anchorVout < 0 ||
      !Number.isSafeInteger(anchorValueSats) ||
      anchorValueSats < 546 ||
      !/^[0-9a-f]+$/u.test(anchorScriptPubKey) ||
      !validPublicKeyHex(sellerPublicKey) ||
      anchorSigHashType !== ID_LISTING_ANCHOR_SIGHASH_TYPE ||
      (anchorSignature && !validSignatureHex(anchorSignature))
    ) {
      throw new Error("Sale authorization ticket is invalid.");
    }
  }

  return {
    ...saleAuthorizationDraft({
      anchorSigHashType,
      anchorSignature,
      anchorScriptPubKey,
      anchorTxid,
      anchorType,
      anchorValueSats,
      anchorVout,
      buyerAddress,
      expiresAt,
      id,
      nonce,
      priceSats,
      receiveAddress,
      sellerAddress,
      sellerPublicKey,
      version,
    }),
    signature,
  };
}

function saleAuthorizationMessageDraft(authorization) {
  return saleAuthorizationDraft(authorization);
}

function saleAuthorizationVerified(authorization) {
  if (
    authorization.version !== ID_SALE_AUTH_VERSION_LEGACY ||
    !authorization.signature
  ) {
    return false;
  }

  try {
    return Verifier.verifySignature(
      authorization.sellerAddress,
      saleAuthorizationMessage(saleAuthorizationMessageDraft(authorization)),
      authorization.signature,
    );
  } catch {
    return false;
  }
}

function saleAuthorizationTermsMatch(left, right) {
  return (
    JSON.stringify(saleAuthorizationDraft(left)) ===
    JSON.stringify(saleAuthorizationDraft(right))
  );
}

function saleAuthorizationTermsMatchIgnoringSeal(left, right) {
  return (
    JSON.stringify(
      saleAuthorizationDraft({
        ...left,
        anchorSignature: undefined,
        anchorTxid: undefined,
      }),
    ) ===
    JSON.stringify(
      saleAuthorizationDraft({
        ...right,
        anchorSignature: undefined,
        anchorTxid: undefined,
      }),
    )
  );
}

function findMatchingActiveListing(
  listings,
  authorization,
  currentOwnerAddress,
) {
  for (const listing of listings.values()) {
    if (
      listing.listingVersion !== "list3" &&
      listing.id === authorization.id &&
      listing.sellerAddress === authorization.sellerAddress &&
      listing.sellerAddress === currentOwnerAddress &&
      saleAuthorizationTermsMatch(listing.saleAuthorization, authorization)
    ) {
      return listing;
    }
  }

  return undefined;
}

function saleAuthorizationHasAnchor(authorization) {
  return (
    (authorization?.version === ID_SALE_AUTH_VERSION_ANCHORED ||
      authorization?.version === ID_SALE_AUTH_VERSION ||
      authorization?.version === ID_SALE_AUTH_VERSION_TICKET) &&
    (authorization.anchorType === ID_LISTING_ANCHOR_TYPE_LEGACY ||
      authorization.anchorType === ID_LISTING_ANCHOR_TYPE ||
      authorization.anchorType === ID_LISTING_TICKET_ANCHOR_TYPE) &&
    typeof authorization.anchorScriptPubKey === "string" &&
    /^[0-9a-f]+$/u.test(authorization.anchorScriptPubKey) &&
    Number.isSafeInteger(authorization.anchorVout) &&
    Number.isSafeInteger(authorization.anchorValueSats) &&
    authorization.anchorValueSats >= 546
  );
}

function saleAuthorizationUsesSaleTicketAnchor(authorization) {
  return (
    saleAuthorizationHasAnchor(authorization) &&
    authorization.version === ID_SALE_AUTH_VERSION_TICKET &&
    authorization.anchorType === ID_LISTING_TICKET_ANCHOR_TYPE &&
    typeof authorization.anchorTxid === "string" &&
    /^[0-9a-f]{64}$/u.test(authorization.anchorTxid) &&
    typeof authorization.sellerPublicKey === "string" &&
    validPublicKeyHex(authorization.sellerPublicKey) &&
    authorization.anchorSigHashType === ID_LISTING_ANCHOR_SIGHASH_TYPE &&
    typeof authorization.anchorSignature === "string" &&
    validSignatureHex(authorization.anchorSignature)
  );
}

function saleAuthorizationUsesSellerUtxoAnchor(authorization) {
  return (
    saleAuthorizationHasAnchor(authorization) &&
    authorization.version === ID_SALE_AUTH_VERSION &&
    authorization.anchorType === ID_LISTING_ANCHOR_TYPE &&
    typeof authorization.anchorTxid === "string" &&
    /^[0-9a-f]{64}$/u.test(authorization.anchorTxid) &&
    typeof authorization.sellerPublicKey === "string" &&
    validPublicKeyHex(authorization.sellerPublicKey) &&
    authorization.anchorSigHashType === ID_LISTING_ANCHOR_SIGHASH_TYPE &&
    typeof authorization.anchorSignature === "string" &&
    validSignatureHex(authorization.anchorSignature)
  );
}

function listingAnchorOutpoint(listing) {
  if (!saleAuthorizationHasAnchor(listing?.saleAuthorization)) {
    return null;
  }

  return {
    txid: saleAuthorizationUsesSellerUtxoAnchor(listing.saleAuthorization)
      ? listing.saleAuthorization.anchorTxid
      : listing.listingId,
    vout: listing.saleAuthorization.anchorVout,
  };
}

function spendsListingAnchor(spent, listing) {
  const anchor = listingAnchorOutpoint(listing);

  return Boolean(
    anchor &&
    spent.some(
      (outpoint) =>
        outpoint.txid === anchor.txid && outpoint.vout === anchor.vout,
    ),
  );
}

function sellerPaymentRequiredSats(listing) {
  const anchorValue = saleAuthorizationHasAnchor(listing?.saleAuthorization)
    ? listing.saleAuthorization.anchorValueSats
    : 0;
  return listing.priceSats + anchorValue;
}

function listingAnchorIsPresent(vout, authorization) {
  if (!saleAuthorizationHasAnchor(authorization)) {
    return false;
  }

  if (
    authorization.version !== ID_SALE_AUTH_VERSION_ANCHORED &&
    authorization.version !== ID_SALE_AUTH_VERSION_TICKET
  ) {
    return false;
  }

  if (
    authorization.version === ID_SALE_AUTH_VERSION_ANCHORED &&
    authorization.anchorType !== ID_LISTING_ANCHOR_TYPE_LEGACY
  ) {
    return false;
  }

  if (
    authorization.version === ID_SALE_AUTH_VERSION_TICKET &&
    authorization.anchorType !== ID_LISTING_TICKET_ANCHOR_TYPE
  ) {
    return false;
  }

  const output = vout[authorization.anchorVout];
  return (
    output?.scriptpubkey === authorization.anchorScriptPubKey &&
    typeof output.value === "number" &&
    output.value === authorization.anchorValueSats
  );
}

async function listingAnchorSpent(listing, network) {
  const anchor = listingAnchorOutpoint(listing);
  if (
    (listing?.listingVersion !== "list3" &&
      listing?.listingVersion !== "list4" &&
      listing?.listingVersion !== "list5") ||
    !anchor
  ) {
    return false;
  }

  for (const base of pendingMempoolBases(network)) {
    try {
      const outspend = await fetchJson(
        `${base}/api/tx/${anchor.txid}/outspend/${anchor.vout}`,
      );
      if (outspend?.spent) {
        return true;
      }
    } catch {
      // Keep the listing visible if a transient outspend lookup fails.
    }
  }

  return false;
}

async function filterSpendableListings(listings, network) {
  const spentStates = await Promise.all(
    listings.map((listing) => listingAnchorSpent(listing, network)),
  );
  return listings.filter((_listing, index) => !spentStates[index]);
}

function saleAuthorizationExpired(authorization, eventCreatedAt) {
  if (!authorization.expiresAt) {
    return false;
  }

  return Date.parse(eventCreatedAt) > Date.parse(authorization.expiresAt);
}

function compareRegistryEventOrder(left, right) {
  if (left.confirmed && right.confirmed) {
    const leftHeight = Number.isSafeInteger(left.blockHeight)
      ? left.blockHeight
      : Number.POSITIVE_INFINITY;
    const rightHeight = Number.isSafeInteger(right.blockHeight)
      ? right.blockHeight
      : Number.POSITIVE_INFINITY;
    if (leftHeight !== rightHeight) {
      return leftHeight - rightHeight;
    }

    const leftIndex = Number.isSafeInteger(left.blockIndex)
      ? left.blockIndex
      : Number.POSITIVE_INFINITY;
    const rightIndex = Number.isSafeInteger(right.blockIndex)
      ? right.blockIndex
      : Number.POSITIVE_INFINITY;
    if (leftIndex !== rightIndex) {
      return leftIndex - rightIndex;
    }
  }

  return (
    Date.parse(left.createdAt) - Date.parse(right.createdAt) ||
    left.txid.localeCompare(right.txid)
  );
}

function parseIdMarketplaceTransferPayload(payload, network) {
  const parts = payload.split(":");
  if (
    payload.startsWith("buy3:") ||
    payload.startsWith("buy4:") ||
    payload.startsWith("buy5:")
  ) {
    if (
      parts.length < 3 ||
      parts.length > 4 ||
      !/^[0-9a-fA-F]{64}$/u.test(parts[1])
    ) {
      return null;
    }

    const [, listingId, owner, receiver] = parts;
    const receiveAddress = receiver?.trim() || owner;
    if (
      !isValidBitcoinAddress(owner, network) ||
      !isValidBitcoinAddress(receiveAddress, network)
    ) {
      return null;
    }

    return {
      listingId: listingId.toLowerCase(),
      ownerAddress: owner,
      receiveAddress,
      transferVersion: payload.startsWith("buy5:")
        ? "buy5"
        : payload.startsWith("buy4:")
          ? "buy4"
          : "buy3",
    };
  }

  if (!payload.startsWith("buy2:")) {
    return null;
  }

  if (parts.length < 3 || parts.length > 4) {
    return null;
  }

  const [, authorizationEncoded, owner, receiver] = parts;
  let authorization;
  try {
    authorization = parseSaleAuthorizationJson(
      decodeTextBase64Url(authorizationEncoded),
      network,
    );
  } catch {
    return null;
  }

  const receiveAddress = receiver?.trim() || owner;
  if (
    !isValidBitcoinAddress(owner, network) ||
    !isValidBitcoinAddress(receiveAddress, network)
  ) {
    return null;
  }

  if (authorization.buyerAddress && authorization.buyerAddress !== owner) {
    return null;
  }

  if (
    authorization.receiveAddress &&
    authorization.receiveAddress !== receiveAddress
  ) {
    return null;
  }

  return {
    id: authorization.id,
    ownerAddress: owner,
    priceSats: authorization.priceSats,
    receiveAddress,
    saleAuthorization: authorization,
    sellerAddress: authorization.sellerAddress,
    transferVersion: "buy2",
  };
}

function parseIdListingPayload(payload, network) {
  const listingVersion = payload.startsWith("list5:")
    ? "list5"
    : payload.startsWith("list4:")
      ? "list4"
      : payload.startsWith("list3:")
        ? "list3"
        : payload.startsWith("list2:")
          ? "list2"
          : "";
  if (!listingVersion) {
    return null;
  }

  const parts = payload.split(":");
  if (parts.length !== 2) {
    return null;
  }

  const [, authorizationEncoded] = parts;
  let authorization;
  try {
    authorization = parseSaleAuthorizationJson(
      decodeTextBase64Url(authorizationEncoded),
      network,
    );
  } catch {
    return null;
  }

  return {
    id: authorization.id,
    listingVersion,
    priceSats: authorization.priceSats,
    saleAuthorization: authorization,
    sellerAddress: authorization.sellerAddress,
  };
}

function parseIdSaleSealPayload(payload, network) {
  if (!payload.startsWith("seal5:")) {
    return null;
  }

  const parts = payload.split(":");
  if (parts.length !== 3 || !/^[0-9a-fA-F]{64}$/u.test(parts[1])) {
    return null;
  }

  const [, listingId, authorizationEncoded] = parts;
  let authorization;
  try {
    authorization = parseSaleAuthorizationJson(
      decodeTextBase64Url(authorizationEncoded),
      network,
    );
  } catch {
    return null;
  }

  return {
    listingId: listingId.toLowerCase(),
    saleAuthorization: authorization,
  };
}

function parseIdDelistingPayload(payload) {
  const delistingVersion = payload.startsWith("delist5:")
    ? "delist5"
    : payload.startsWith("delist4:")
      ? "delist4"
      : payload.startsWith("delist3:")
        ? "delist3"
        : payload.startsWith("delist2:")
          ? "delist2"
          : "";
  if (!delistingVersion) {
    return null;
  }

  const parts = payload.split(":");
  if (parts.length !== 2 || !/^[0-9a-fA-F]{64}$/u.test(parts[1])) {
    return null;
  }

  return {
    delistingVersion,
    listingId: parts[1].toLowerCase(),
  };
}

function parseIdEventPayload(payload, network) {
  const registration = parseIdRegistrationPayload(payload, network);
  if (registration) {
    return {
      kind: "register",
      ...registration,
    };
  }

  const update = parseIdReceiverUpdatePayload(payload, network);
  if (update) {
    return {
      kind: "update",
      ...update,
    };
  }

  const transfer = parseIdTransferPayload(payload, network);
  if (transfer) {
    return {
      kind: "transfer",
      ...transfer,
    };
  }

  const marketplaceTransfer = parseIdMarketplaceTransferPayload(
    payload,
    network,
  );
  if (marketplaceTransfer) {
    return {
      kind: "marketTransfer",
      ...marketplaceTransfer,
    };
  }

  const listing = parseIdListingPayload(payload, network);
  if (listing) {
    return {
      kind: "list",
      ...listing,
    };
  }

  const seal = parseIdSaleSealPayload(payload, network);
  if (seal) {
    return {
      kind: "seal",
      ...seal,
    };
  }

  const delisting = parseIdDelistingPayload(payload);
  if (delisting) {
    return {
      kind: "delist",
      ...delisting,
    };
  }

  return null;
}

function shortAddress(value) {
  if (!value) {
    return "Unknown";
  }

  return value.length > 18
    ? `${value.slice(0, 8)}...${value.slice(-8)}`
    : value;
}

function networkLabel(network) {
  if (network === "testnet4") {
    return "Testnet4";
  }

  return network === "livenet" ? "Mainnet" : "Testnet3";
}

function activityStatusTag(confirmed) {
  return confirmed ? "Confirmed" : "Pending";
}

function emptyMarketplaceStats() {
  return {
    confirmedSales: 0,
    confirmedVolumeSats: 0,
    pendingSales: 0,
    pendingVolumeSats: 0,
    totalSales: 0,
    totalVolumeSats: 0,
  };
}

function marketplaceStatsFromSales(sales) {
  return sales.reduce((stats, sale) => {
    if (sale.confirmed) {
      stats.confirmedSales += 1;
      stats.confirmedVolumeSats += sale.priceSats;
    } else {
      stats.pendingSales += 1;
      stats.pendingVolumeSats += sale.priceSats;
    }

    stats.totalSales += 1;
    stats.totalVolumeSats += sale.priceSats;
    return stats;
  }, emptyMarketplaceStats());
}

function publicMarketplaceSales(sales) {
  return sales.filter((sale) => sale.transferVersion === "buy5");
}

function compareMarketplaceSales(left, right) {
  return (
    Date.parse(right.createdAt) - Date.parse(left.createdAt) ||
    right.txid.localeCompare(left.txid)
  );
}

function compareActivityItems(left, right) {
  return (
    Date.parse(right.createdAt) - Date.parse(left.createdAt) ||
    right.txid.localeCompare(left.txid)
  );
}

function idActivityItemsFromEvents(events) {
  return events.map((event) => {
    const status = activityStatusTag(event.confirmed);
    const participants = [
      ...(Array.isArray(event.inputAddresses) ? event.inputAddresses : []),
      event.currentOwnerAddress,
      event.currentReceiveAddress,
      event.ownerAddress,
      event.receiveAddress,
      event.sellerAddress,
      event.saleAuthorization?.buyerAddress,
    ].filter(Boolean);
    const base = {
      amountSats: event.amountSats,
      actor: event.inputAddresses[0],
      blockHeight: event.blockHeight,
      confirmed: event.confirmed,
      createdAt: event.createdAt,
      dataBytes: event.dataBytes ?? 0,
      network: event.network,
      participants,
      tags: [
        status,
        networkLabel(event.network),
        `${event.amountSats.toLocaleString()} proofs`,
      ],
      txid: event.txid,
    };

    if (event.kind === "register") {
      return {
        ...base,
        counterparty: event.receiveAddress,
        description: `${event.id}@proofofwork.me claimed by ${shortAddress(event.ownerAddress)} and routed to ${shortAddress(event.receiveAddress)}.`,
        detail: event.pgpKey ? "PGP key registered" : "No PGP key",
        id: event.id,
        kind: "id-register",
        tags: [...base.tags, "Registration"],
        title: event.confirmed ? "ID registered" : "ID registration pending",
      };
    }

    if (event.kind === "update") {
      return {
        ...base,
        counterparty: event.receiveAddress,
        description: `${event.id}@proofofwork.me receive address updated to ${shortAddress(event.receiveAddress)}.`,
        id: event.id,
        kind: "id-update",
        tags: [...base.tags, "Receiver update"],
        title: event.confirmed ? "Receiver updated" : "Receiver update pending",
      };
    }

    if (event.kind === "transfer") {
      return {
        ...base,
        counterparty: event.ownerAddress,
        description: `${event.id}@proofofwork.me transferred to ${shortAddress(event.ownerAddress)} and routed to ${shortAddress(event.receiveAddress)}.`,
        id: event.id,
        kind: "id-transfer",
        tags: [...base.tags, "Transfer"],
        title: event.confirmed ? "ID transferred" : "ID transfer pending",
      };
    }

    if (event.kind === "list") {
      const anchorVout =
        event.saleAuthorization.anchorVout ?? ID_LISTING_ANCHOR_VOUT;
      return {
        ...base,
        actor: event.sellerAddress,
        counterparty: event.saleAuthorization.buyerAddress,
        description: `${event.id}@proofofwork.me listed for ${event.priceSats.toLocaleString()} proofs by ${shortAddress(event.sellerAddress)}.`,
        detail:
          event.listingVersion === "list5"
            ? "Sale-ticket listing"
            : "Legacy listing",
        id: event.id,
        kind: "id-list",
        listingId: event.txid,
        tags: [
          ...base.tags,
          "Listing",
          `${event.priceSats.toLocaleString()} sale proofs`,
        ],
        title: event.confirmed ? "ID listed" : "ID listing pending",
        utxo: `${event.txid}:${anchorVout}`,
      };
    }

    if (event.kind === "seal") {
      return {
        ...base,
        description: `Sale ticket sealed for listing ${shortAddress(event.listingId)}.`,
        detail: "Seller signature published on chain",
        kind: "id-seal",
        listingId: event.listingId,
        tags: [...base.tags, "Seal"],
        title: event.confirmed
          ? "Sale ticket sealed"
          : "Sale-ticket seal pending",
      };
    }

    if (event.kind === "delist") {
      return {
        ...base,
        description: `Listing ${shortAddress(event.listingId)} delisted by spending its sale ticket.`,
        detail: event.delistingVersion,
        kind: "id-delist",
        listingId: event.listingId,
        tags: [...base.tags, "Delisting"],
        title: event.confirmed ? "Listing delisted" : "Delisting pending",
      };
    }

    return {
      ...base,
      actor: event.ownerAddress,
      counterparty: event.sellerAddress,
      description: `${event.id ? `${event.id}@proofofwork.me` : "ID"} purchased by ${shortAddress(event.ownerAddress)}${event.sellerAddress ? ` from ${shortAddress(event.sellerAddress)}` : ""}.`,
      detail: event.listingId
        ? `Listing ${shortAddress(event.listingId)}`
        : undefined,
      id: event.id,
      kind: "id-buy",
      listingId: event.listingId,
      tags: [
        ...base.tags,
        "Marketplace buy",
        event.priceSats ? `${event.priceSats.toLocaleString()} sale proofs` : "",
      ].filter(Boolean),
      title: event.confirmed ? "ID purchased" : "ID purchase pending",
    };
  });
}

function formatBytes(bytes) {
  if (!Number.isFinite(bytes) || bytes <= 0) {
    return "0 B";
  }

  if (bytes < 1024) {
    return `${bytes} B`;
  }

  if (bytes < 1024 * 1024) {
    return `${Math.round(bytes / 1024)} KB`;
  }

  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function compactText(value, maxLength = 140) {
  const text = String(value ?? "")
    .replace(/\s+/gu, " ")
    .trim();
  if (text.length <= maxLength) {
    return text;
  }

  return `${text.slice(0, Math.max(0, maxLength - 1)).trimEnd()}...`;
}

function activityKey(item) {
  if (item?.kind === "token-listing-closed" && item?.txid) {
    return `${item.kind}:${item.network}:${item.txid}`;
  }

  return `${item.kind}:${item.network}:${item.txid}:${item.listingId ?? ""}:${item.id ?? ""}`;
}

function activityItemRichness(item) {
  return [
    item?.listingId,
    item?.tokenId,
    ...(Array.isArray(item?.participants) ? item.participants : []),
  ].filter(Boolean).length;
}

function dedupeActivityItems(items) {
  const merged = new Map();

  for (const item of items) {
    if (!item?.txid) {
      continue;
    }

    const key = activityKey(item);
    const current = merged.get(key);
    if (
      !current ||
      (item.confirmed && !current.confirmed) ||
      (item.confirmed === current.confirmed &&
        activityItemRichness(item) > activityItemRichness(current))
    ) {
      merged.set(key, item);
    }
  }

  return [...merged.values()].sort(compareActivityItems);
}

function totalProtocolDataBytes(items) {
  const bytesByTxid = new Map();

  for (const item of items) {
    if (
      !item?.txid ||
      !Number.isFinite(item.dataBytes) ||
      item.dataBytes <= 0
    ) {
      continue;
    }

    bytesByTxid.set(
      item.txid,
      Math.max(bytesByTxid.get(item.txid) ?? 0, item.dataBytes),
    );
  }

  return [...bytesByTxid.values()].reduce((total, bytes) => total + bytes, 0);
}

function indexedThroughBlockFromItems(items) {
  const heights = (Array.isArray(items) ? items : [])
    .map((item) => Number(item?.blockHeight))
    .filter((height) => Number.isSafeInteger(height) && height > 0);
  return heights.length > 0 ? Math.max(...heights) : undefined;
}

function isBrowserHtmlMessageBody(value) {
  const text = String(value ?? "").trim();
  if (!text) {
    return false;
  }

  return (
    /^<!doctype\s+html[\s>]/iu.test(text) ||
    /^<html[\s>]/iu.test(text) ||
    /<\/(?:html|head|body)>/iu.test(text) ||
    /^<(?:a|article|body|button|canvas|code|div|form|h[1-6]|head|img|input|main|ol|p|pre|script|section|span|style|svg|table|ul)(?:\s|>|\/)/iu.test(
      text,
    )
  );
}

function isInfinityBondMemo(value) {
  return String(value ?? "").trim().toLowerCase() === INFINITY_BOND_MEMO;
}

function isInfinityBondActivityItem(item) {
  if (item?.kind === "infinity-bond") {
    return true;
  }

  return item?.kind === "mail" && isInfinityBondMemo(item.detail);
}

function mailActivityItemFromTransaction(tx, network) {
  const vin = Array.isArray(tx.vin) ? tx.vin : [];
  const vout = Array.isArray(tx.vout) ? tx.vout : [];
  const protocolMessage = extractProtocolMemo(vout);
  const txid = transactionTxid(tx);

  if (!protocolMessage || !txid) {
    return null;
  }

  const confirmed = transactionConfirmed(tx);
  const blockTime =
    typeof tx.status?.block_time === "number"
      ? tx.status.block_time * 1000
      : Date.now();
  const createdAt = new Date(blockTime).toISOString();
  const recipients = protocolPaymentOutputs(vout);
  const amountSats = recipients.reduce(
    (total, recipient) => total + recipient.amountSats,
    0,
  );
  const actor = senderAddress(vin, "");
  const counterparty =
    recipients.length === 0
      ? "Unknown"
      : recipients.length === 1
        ? recipients[0].display
        : `${recipients[0].display} +${recipients.length - 1}`;
  const isFile = Boolean(protocolMessage.attachment);
  const isReply = Boolean(protocolMessage.parentTxid);
  const isInfinityBond =
    !isFile && !isReply && isInfinityBondMemo(protocolMessage.memo);
  const kind = isFile
    ? "file"
    : isReply
      ? "reply"
      : isInfinityBond
        ? "infinity-bond"
        : "mail";
  const noun = isFile
    ? "file"
    : isReply
      ? "reply"
      : isInfinityBond
        ? "infinity bond"
        : "mail";
  const title = `${isFile ? "File" : isReply ? "Reply" : isInfinityBond ? "Infinity Bond" : "Mail"} ${confirmed ? "sent" : "pending"}`;
  const detail = protocolMessage.attachment
    ? `${protocolMessage.attachment.name} · ${formatBytes(protocolMessage.attachment.size)} · ${protocolMessage.attachment.mime}`
    : protocolMessage.subject
      ? `Subject: ${protocolMessage.subject}`
      : compactText(protocolMessage.memo, 120) || "No message body";

  return {
    amountSats,
    actor,
    blockHeight: transactionBlockHeight(tx),
    confirmed,
    counterparty,
    createdAt,
    dataBytes: proofProtocolDataBytesForVout(vout),
    description: `${shortAddress(actor)} sent ${noun} to ${counterparty}${amountSats > 0 ? ` for ${amountSats.toLocaleString()} proofs` : ""}.`,
    detail,
    kind,
    network,
    participants: [
      actor,
      ...recipients.map((recipient) => recipient.address),
    ].filter(Boolean),
    tags: [
      activityStatusTag(confirmed),
      networkLabel(network),
      isFile
        ? "Attachment"
        : isReply
          ? "Reply"
          : isInfinityBond
            ? "Infinity Bond"
            : "Message",
      isBrowserHtmlMessageBody(protocolMessage.memo) ? "HTML body" : "",
      recipients.length > 1 ? `${recipients.length} recipients` : "1 recipient",
      amountSats > 0 ? `${amountSats.toLocaleString()} proofs` : "",
    ].filter(Boolean),
    title,
    txid,
  };
}

function mailActivityItemsFromTransactions(txs, network) {
  return dedupeTransactions(txs)
    .map((tx) => mailActivityItemFromTransaction(tx, network))
    .filter(Boolean);
}

function tokenActivityItemsFromState(state, indexAddress) {
  const creations = (state.tokens ?? []).map((token) => ({
    amountSats: token.creationFeeSats,
    actor: token.creatorAddress,
    confirmed: token.confirmed,
    counterparty: indexAddress,
    createdAt: token.createdAt,
    dataBytes: token.dataBytes,
    description: `${token.ticker} created with ${token.maxSupply.toLocaleString()} max supply and registry ${shortAddress(token.registryAddress)}.`,
    detail: `${token.mintAmount.toLocaleString()} ${token.ticker} for ${token.mintPriceSats.toLocaleString()} proofs`,
    kind: "token-create",
    network: token.network,
    participants: [token.creatorAddress, token.registryAddress].filter(Boolean),
    tags: [
      activityStatusTag(token.confirmed),
      networkLabel(token.network),
      "Credit",
      "Creation",
      token.ticker,
      `${token.creationFeeSats.toLocaleString()} creation proofs`,
    ],
    title: token.confirmed ? "Credit created" : "Credit creation pending",
    tokenId: token.tokenId,
    txid: token.txid,
  }));

  const mints = (state.mints ?? []).map((mint) => ({
    amountSats: mint.paidSats,
    actor: mint.minterAddress,
    confirmed: mint.confirmed,
    counterparty: mint.registryAddress,
    createdAt: mint.createdAt,
    dataBytes: mint.dataBytes,
    description: `${mint.amount.toLocaleString()} ${mint.ticker} minted by ${shortAddress(mint.minterAddress)}.`,
    detail: `Credit ${shortAddress(mint.tokenId)}`,
    kind: "token-mint",
    network: mint.network,
    participants: [mint.minterAddress, mint.registryAddress].filter(Boolean),
    tags: [
      activityStatusTag(mint.confirmed),
      networkLabel(mint.network),
      "Credit",
      "Mint",
      mint.ticker,
      `${mint.amount.toLocaleString()} ${mint.ticker}`,
      `${mint.paidSats.toLocaleString()} mint proofs`,
    ],
    title: mint.confirmed ? "Credit mint" : "Credit mint pending",
    tokenId: mint.tokenId,
    txid: mint.txid,
  }));

  const transfers = (state.transfers ?? []).map((transfer) => ({
    amountSats: transfer.paidSats,
    actor: transfer.senderAddress,
    confirmed: transfer.confirmed,
    counterparty: transfer.recipientAddress,
    createdAt: transfer.createdAt,
    dataBytes: transfer.dataBytes,
    description: `${transfer.amount.toLocaleString()} ${transfer.ticker} transferred from ${shortAddress(transfer.senderAddress)} to ${shortAddress(transfer.recipientAddress)}.`,
    detail: `Credit ${shortAddress(transfer.tokenId)}`,
    kind: "token-transfer",
    network: transfer.network,
    participants: [
      transfer.senderAddress,
      transfer.recipientAddress,
      transfer.registryAddress,
    ].filter(Boolean),
    tags: [
      activityStatusTag(transfer.confirmed),
      networkLabel(transfer.network),
      "Credit",
      "Transfer",
      transfer.ticker,
      `${transfer.amount.toLocaleString()} ${transfer.ticker}`,
      `${transfer.paidSats.toLocaleString()} registry proofs`,
    ],
    title: transfer.confirmed ? "Credit transfer" : "Credit transfer pending",
    tokenId: transfer.tokenId,
    txid: transfer.txid,
  }));

  const listings = (state.listings ?? []).map((listing) => {
    const sealConfirmed = tokenListingHasConfirmedSaleTicketSeal(listing);
    const sealPending = tokenListingHasPendingSaleTicketSeal(listing);
    return {
      amountSats: TOKEN_MIN_MUTATION_PRICE_SATS,
      actor: listing.sellerAddress,
      confirmed: listing.confirmed,
      counterparty: listing.registryAddress,
      createdAt: listing.createdAt,
      dataBytes: listing.dataBytes,
      description: `${listing.amount.toLocaleString()} ${listing.ticker} listed by ${shortAddress(listing.sellerAddress)} for ${listing.priceSats.toLocaleString()} proofs.`,
      detail: sealConfirmed
        ? `Sealed sale ticket ${shortAddress(listing.sealTxid ?? "")}`
        : sealPending
          ? `Sale-ticket seal pending ${shortAddress(listing.sealTxid ?? "")}`
          : "Waiting for sale-ticket seal",
      kind: "token-listing",
      listingId: listing.listingId,
      network: listing.network,
      participants: [
        listing.sellerAddress,
        listing.saleAuthorization?.buyerAddress,
        listing.registryAddress,
      ].filter(Boolean),
      tags: [
        activityStatusTag(listing.confirmed),
        networkLabel(listing.network),
        "Credit",
        "Marketplace",
        sealConfirmed ? "Sealed" : sealPending ? "Seal pending" : "Listing",
        listing.ticker,
        `${listing.amount.toLocaleString()} ${listing.ticker}`,
        `${listing.priceSats.toLocaleString()} sale proofs`,
      ],
      title: listing.confirmed
        ? sealConfirmed
          ? "Credit listing sealed"
          : sealPending
            ? "Credit listing seal pending"
          : "Credit listing"
        : "Credit listing pending",
      tokenId: listing.tokenId,
      txid: listing.listingId,
    };
  });
  const sealedListings = [];
  const seenSealTxids = new Set();
  for (const listing of [
    ...(state.listings ?? []),
    ...(state.closedListings ?? []),
  ]) {
    const sealTxid =
      typeof listing.sealTxid === "string" ? listing.sealTxid : "";
    if (!sealTxid || seenSealTxids.has(sealTxid)) {
      continue;
    }
    seenSealTxids.add(sealTxid);
    const sealConfirmed = listing.sealConfirmed === true;
    sealedListings.push({
      amountSats: TOKEN_MIN_MUTATION_PRICE_SATS,
      actor: listing.sellerAddress,
      confirmed: sealConfirmed,
      counterparty: listing.registryAddress,
      createdAt: listing.sealAt ?? listing.createdAt,
      dataBytes: listing.sealDataBytes ?? 0,
      description: `${listing.amount.toLocaleString()} ${listing.ticker} sale ticket sealed for listing ${shortAddress(listing.listingId)}.`,
      detail: `Listing ${shortAddress(listing.listingId)}`,
      kind: "token-listing-sealed",
      listingId: listing.listingId,
      network: listing.network,
      participants: [
        listing.sellerAddress,
        listing.saleAuthorization?.buyerAddress,
        listing.registryAddress,
      ].filter(Boolean),
      tags: [
        activityStatusTag(sealConfirmed),
        networkLabel(listing.network),
        "Credit",
        "Marketplace",
        "Seal",
        listing.ticker,
        `${listing.amount.toLocaleString()} ${listing.ticker}`,
        `${TOKEN_MIN_MUTATION_PRICE_SATS.toLocaleString()} registry proofs`,
      ],
      title: sealConfirmed
        ? "Credit sale ticket sealed"
        : "Credit sale-ticket seal pending",
      tokenId: listing.tokenId,
      txid: sealTxid,
    });
  }

  const closedListings = (state.closedListings ?? []).map((listing) => {
    const closedTxid =
      typeof listing.closedTxid === "string" ? listing.closedTxid : "";
    const spentBy = closedTxid ? ` by ${shortAddress(closedTxid)}` : "";
    return {
      amountSats: TOKEN_MIN_MUTATION_PRICE_SATS,
      actor: listing.sellerAddress,
      confirmed: Boolean(listing.closedConfirmed),
      counterparty: listing.registryAddress,
      createdAt: listing.closedAt ?? listing.createdAt,
      dataBytes: listing.dataBytes,
      description: `${listing.amount.toLocaleString()} ${listing.ticker} listing closed because its sale-ticket output was spent${spentBy}.`,
      detail: closedTxid
        ? `Sale ticket spent by ${shortAddress(closedTxid)}`
        : "Sale ticket spent",
      kind: "token-listing-closed",
      listingId: listing.listingId,
      network: listing.network,
      participants: [
        listing.sellerAddress,
        listing.saleAuthorization?.buyerAddress,
        listing.registryAddress,
      ].filter(Boolean),
      tags: [
        activityStatusTag(Boolean(listing.closedConfirmed)),
        networkLabel(listing.network),
        "Credit",
        "Marketplace",
        "Closed",
        "Spent ticket",
        listing.ticker,
        `${listing.amount.toLocaleString()} ${listing.ticker}`,
        `${listing.priceSats.toLocaleString()} sale proofs`,
      ],
      title: listing.closedConfirmed
        ? "Credit listing closed"
        : "Credit listing closing",
      tokenId: listing.tokenId,
      txid: closedTxid || listing.listingId,
    };
  });

  const sales = (state.sales ?? []).map((sale) => ({
    amountSats: sale.paidSats,
    actor: sale.buyerAddress,
    confirmed: sale.confirmed,
    counterparty: sale.sellerAddress,
    createdAt: sale.createdAt,
    dataBytes: sale.dataBytes,
    description: `${sale.amount.toLocaleString()} ${sale.ticker} bought by ${shortAddress(sale.buyerAddress)} from ${shortAddress(sale.sellerAddress)} for ${sale.priceSats.toLocaleString()} proofs.`,
    detail: `Listing ${shortAddress(sale.listingId)}`,
    kind: "token-sale",
    listingId: sale.listingId,
    network: sale.network,
    participants: [
      sale.buyerAddress,
      sale.sellerAddress,
      sale.registryAddress,
    ].filter(Boolean),
    tags: [
      activityStatusTag(sale.confirmed),
      networkLabel(sale.network),
      "Credit",
      "Marketplace",
      "Sale",
      sale.ticker,
      `${sale.amount.toLocaleString()} ${sale.ticker}`,
      `${sale.priceSats.toLocaleString()} sale proofs`,
    ],
    title: sale.confirmed ? "Credit sale" : "Credit sale pending",
    tokenId: sale.tokenId,
    txid: sale.txid,
  }));

  return [
    ...creations,
    ...mints,
    ...transfers,
    ...listings,
    ...sealedListings,
    ...closedListings,
    ...sales,
  ];
}

function rushActivityItemsFromState(state) {
  return (state.mints ?? []).map((mint) => ({
    amountSats: mint.paidSats,
    actor: mint.minterAddress,
    confirmed: mint.confirmed,
    counterparty: mint.registryAddress,
    createdAt: mint.createdAt,
    dataBytes: mint.dataBytes,
    description: `${mint.amount} RUSH minted by ${shortAddress(mint.minterAddress)}.`,
    detail: mint.ordinal
      ? `Mint #${mint.ordinal.toLocaleString()} Â· phase ${mint.phase ?? "overflow"}`
      : `Pending mint Â· estimated phase ${mint.phase ?? "overflow"}`,
    kind: "rush-mint",
    network: mint.network,
    participants: [mint.minterAddress, mint.registryAddress].filter(Boolean),
    tags: [
      activityStatusTag(mint.confirmed),
      networkLabel(mint.network),
      "RUSH",
      "Credit",
      "Mint",
      `${mint.amount} RUSH`,
      `${mint.paidSats.toLocaleString()} registry proofs`,
    ],
    title: mint.confirmed ? "RUSH mint" : "RUSH mint pending",
    txid: mint.txid,
  }));
}

function addActivityAddress(addresses, address, network) {
  if (typeof address === "string" && isValidBitcoinAddress(address, network)) {
    addresses.add(address);
  }
}

function fullActivityHistoryAddressesForNetwork(network) {
  return FULL_ACTIVITY_HISTORY_ADDRESSES[network] ?? new Set();
}

function shouldFetchFullActivityHistory(address, network) {
  return fullActivityHistoryAddressesForNetwork(network).has(address);
}

function activityAddressesFromRegistry(registry, network) {
  const addresses = new Set();

  for (const address of fullActivityHistoryAddressesForNetwork(network)) {
    addActivityAddress(addresses, address, network);
  }

  for (const record of registry.records ?? []) {
    addActivityAddress(addresses, record.ownerAddress, network);
    addActivityAddress(addresses, record.receiveAddress, network);
  }

  for (const event of registry.pendingEvents ?? []) {
    for (const inputAddress of event.inputAddresses ?? []) {
      addActivityAddress(addresses, inputAddress, network);
    }
    addActivityAddress(addresses, event.currentOwnerAddress, network);
    addActivityAddress(addresses, event.currentReceiveAddress, network);
    addActivityAddress(addresses, event.ownerAddress, network);
    addActivityAddress(addresses, event.receiveAddress, network);
    addActivityAddress(addresses, event.sellerAddress, network);
  }

  for (const listing of registry.listings ?? []) {
    addActivityAddress(addresses, listing.sellerAddress, network);
    addActivityAddress(addresses, listing.buyerAddress, network);
    addActivityAddress(addresses, listing.receiveAddress, network);
  }

  for (const item of registry.activity ?? []) {
    addActivityAddress(addresses, item.actor, network);
    addActivityAddress(addresses, item.counterparty, network);
  }

  return [...addresses].slice(0, MAX_ACTIVITY_ADDRESSES);
}

function activityAddressesFromMailTransactions(txs, network) {
  const addresses = new Set();

  for (const tx of txs) {
    const vin = Array.isArray(tx.vin) ? tx.vin : [];
    const vout = Array.isArray(tx.vout) ? tx.vout : [];
    if (!extractProtocolMemo(vout)) {
      continue;
    }

    for (const address of inputAddresses(vin)) {
      addActivityAddress(addresses, address, network);
    }

    for (const recipient of protocolPaymentOutputs(vout)) {
      addActivityAddress(addresses, recipient.address, network);
    }
  }

  return addresses;
}

function addActivityItemAddresses(addresses, item, network) {
  addActivityAddress(addresses, item?.actor, network);
  addActivityAddress(addresses, item?.counterparty, network);
  for (const participant of item?.participants ?? []) {
    addActivityAddress(addresses, participant, network);
  }
}

function addTokenStateActivityAddresses(addresses, tokenState, network) {
  if (!tokenState) {
    return;
  }

  for (const token of tokenState.tokens ?? []) {
    addActivityAddress(addresses, token.creatorAddress, network);
    addActivityAddress(addresses, token.registryAddress, network);
  }

  for (const mint of tokenState.mints ?? []) {
    addActivityAddress(addresses, mint.minterAddress, network);
    addActivityAddress(addresses, mint.registryAddress, network);
  }

  for (const transfer of tokenState.transfers ?? []) {
    addActivityAddress(addresses, transfer.senderAddress, network);
    addActivityAddress(addresses, transfer.recipientAddress, network);
    addActivityAddress(addresses, transfer.registryAddress, network);
  }

  for (const holder of tokenState.holders ?? []) {
    addActivityAddress(addresses, holder.address, network);
  }

  for (const listing of tokenState.listings ?? []) {
    addActivityAddress(addresses, listing.sellerAddress, network);
    addActivityAddress(addresses, listing.saleAuthorization?.buyerAddress, network);
    addActivityAddress(addresses, listing.registryAddress, network);
  }

  for (const listing of tokenState.closedListings ?? []) {
    addActivityAddress(addresses, listing.sellerAddress, network);
    addActivityAddress(addresses, listing.saleAuthorization?.buyerAddress, network);
    addActivityAddress(addresses, listing.registryAddress, network);
  }

  for (const sale of tokenState.sales ?? []) {
    addActivityAddress(addresses, sale.buyerAddress, network);
    addActivityAddress(addresses, sale.sellerAddress, network);
    addActivityAddress(addresses, sale.registryAddress, network);
  }
}

function canonicalMailSeedAddresses({
  activityState,
  network,
  registryState,
  tokenState,
  workTokenState,
}) {
  const addresses = new Set();

  for (const address of fullActivityHistoryAddressesForNetwork(network)) {
    addActivityAddress(addresses, address, network);
  }

  for (const address of activityAddressesFromRegistry(registryState, network)) {
    addActivityAddress(addresses, address, network);
  }

  for (const item of activityState?.activity ?? []) {
    addActivityItemAddresses(addresses, item, network);
  }

  addTokenStateActivityAddresses(addresses, tokenState, network);
  addTokenStateActivityAddresses(addresses, workTokenState, network);

  return [...addresses].slice(0, SEEDED_MAIL_ACTIVITY_MAX_ADDRESSES);
}

function emptySeededMailActivityPayload(network, seedAddresses = []) {
  return {
    activity: [],
    indexedAt: new Date().toISOString(),
    network,
    seedAddresses,
    source: mempoolBase(network),
    stats: {
      addresses: seedAddresses.length,
      dataBytes: 0,
      files: 0,
      infinityBonds: 0,
      messages: 0,
      pending: 0,
      total: 0,
      transactions: 0,
    },
  };
}

async function buildSeededMailActivityPayload(network, seedAddresses) {
  const addresses = [...new Set(seedAddresses)]
    .filter((address) => isValidBitcoinAddress(address, network))
    .slice(0, SEEDED_MAIL_ACTIVITY_MAX_ADDRESSES);
  if (addresses.length === 0) {
    return emptySeededMailActivityPayload(network, addresses);
  }

  const concurrency = Math.max(
    1,
    Math.min(SEEDED_MAIL_ACTIVITY_CONCURRENCY, addresses.length),
  );
  const addressTxGroups = await mapWithConcurrency(
    addresses,
    concurrency,
    async (address) => {
      try {
        if (shouldFetchFullActivityHistory(address, network)) {
          return await fetchAddressTransactions(address, network);
        }
        return await fetchAddressTransactionsViaMempoolPagination(
          address,
          network,
          MAX_ADDRESS_TX_PAGES,
        );
      } catch (error) {
        console.error(
          `Seeded mail activity lookup failed for ${address}: ${errorSummary(error)}`,
        );
        try {
          return shouldFetchFullActivityHistory(address, network)
            ? await fetchAddressTransactionsViaMempoolPagination(
                address,
                network,
                MAX_ADDRESS_TX_PAGES,
              )
            : await fetchAddressTransactions(address, network);
        } catch (fallbackError) {
          console.error(
            `Seeded mail activity fallback failed for ${address}: ${errorSummary(fallbackError)}`,
          );
          return [];
        }
      }
    },
  );
  const txs = dedupeTransactions(addressTxGroups.flat());
  const activity = mailActivityItemsFromTransactions(txs, network);
  const dataBytes = totalProtocolDataBytes(activity);
  const infinityBondActions = activity.filter(isInfinityBondActivityItem).length;
  const messageActions = activity.filter(
    (item) =>
      (item.kind === "mail" || item.kind === "reply") &&
      !isInfinityBondActivityItem(item),
  ).length;

  return {
    activity,
    indexedAt: new Date().toISOString(),
    network,
    seedAddresses: addresses,
    source: mempoolBase(network),
    stats: {
      addresses: addresses.length,
      dataBytes,
      files: activity.filter((item) => item.kind === "file").length,
      infinityBonds: infinityBondActions,
      messages: messageActions,
      pending: activity.filter((item) => !item.confirmed).length,
      total: activity.length,
      transactions: txs.length,
    },
  };
}

async function seededMailActivityPayload(network, seedAddresses) {
  const addresses = [...new Set(seedAddresses)]
    .filter((address) => isValidBitcoinAddress(address, network))
    .slice(0, SEEDED_MAIL_ACTIVITY_MAX_ADDRESSES);
  if (addresses.length === 0) {
    return emptySeededMailActivityPayload(network, addresses);
  }

  const seedHash = sha256Hex(JSON.stringify(addresses)).slice(0, 16);
  return cachedPayload(
    `payload:seeded-mail:${network}:${seedHash}`,
    () => buildSeededMailActivityPayload(network, addresses),
    ACTIVITY_CACHE_TTL_MS,
    ACTIVITY_CACHE_STALE_MS,
  );
}

function cachedTokenPayload(network, tokenScope = "") {
  const scope = normalizeTokenScope(tokenScope);
  return cachedPayload(
    `payload:token:${network}:${scope}`,
    () => safeTokenPayload(network, scope),
    TOKEN_CACHE_TTL_MS,
    TOKEN_CACHE_STALE_MS,
  );
}

function cacheTokenPayload(network, tokenScope = "", payload) {
  const scope = normalizeTokenScope(tokenScope);
  const cacheKey = `token:${network}:${scope}`;
  const payloadKey = `payload:${cacheKey}`;
  const jsonKey = `json:${cacheKey}`;
  const body = JSON.stringify(payload);
  RESPONSE_CACHE.set(payloadKey, {
    expiresAt: Date.now() + TOKEN_CACHE_TTL_MS,
    payload,
    staleUntil: Date.now() + TOKEN_CACHE_STALE_MS,
  });
  cacheJsonBody(jsonKey, body, TOKEN_CACHE_TTL_MS, TOKEN_CACHE_STALE_MS);
  if (shouldPersistJsonCache(cacheKey)) {
    void writePersistedJsonCache(jsonKey, body);
  }
  invalidateDerivedCachesForBaseCache(cacheKey);
}

async function refreshTokenPayload(network, tokenScope = "") {
  const scope = normalizeTokenScope(tokenScope);
  const payload = await safeTokenPayload(network, scope);
  cacheTokenPayload(network, scope, payload);
  return payload;
}

function refreshTokenPayloadCacheInBackground(network, tokenScope = "") {
  const scope = normalizeTokenScope(tokenScope);
  const cacheKey = `${network}:${scope}`;
  const refreshKey = `token:${cacheKey}`;
  if (BACKGROUND_TOKEN_REFRESHES.has(cacheKey)) {
    return;
  }
  if (
    backgroundRefreshRecentlyStarted(
      refreshKey,
      scope === WORK_TOKEN_ID
        ? BACKGROUND_WORK_TOKEN_REFRESH_INTERVAL_MS
        : BACKGROUND_TOKEN_REFRESH_INTERVAL_MS,
    )
  ) {
    return;
  }

  BACKGROUND_TOKEN_REFRESHES.add(cacheKey);
  void safeTokenPayload(network, scope)
    .then((payload) => {
      cacheTokenPayload(network, scope, payload);
    })
    .catch((error) => {
      console.error(`Token cache refresh failed for ${cacheKey}:`, error);
    })
    .finally(() => {
      BACKGROUND_TOKEN_REFRESHES.delete(cacheKey);
    });
}

function refreshGlobalActivityCacheInBackground(network) {
  if (!ENABLE_GLOBAL_ACTIVITY_CRAWL) {
    return;
  }

  if (BACKGROUND_ACTIVITY_REFRESHES.has(network)) {
    return;
  }
  if (
    backgroundRefreshRecentlyStarted(
      `activity:${network}`,
      BACKGROUND_ACTIVITY_REFRESH_INTERVAL_MS,
    )
  ) {
    return;
  }

  BACKGROUND_ACTIVITY_REFRESHES.add(network);
  setTimeout(() => {
    void globalActivityPayload(network, true)
      .then(() => {
        invalidateDerivedCachesForBaseCache(`activity:${network}`);
      })
      .catch((error) => {
        console.error(`Activity cache refresh failed for ${network}:`, error);
      })
      .finally(() => {
        BACKGROUND_ACTIVITY_REFRESHES.delete(network);
      });
  }, BACKGROUND_ACTIVITY_REFRESH_DELAY_MS);
}

function refreshPayloadCacheInBackground(
  cacheKey,
  payloadKey,
  producer,
  ttlMs,
  staleMs,
) {
  if (BACKGROUND_PAYLOAD_REFRESHES.has(cacheKey)) {
    return;
  }
  if (
    backgroundRefreshRecentlyStarted(
      cacheKey,
      backgroundRefreshIntervalForCacheKey(cacheKey),
    )
  ) {
    return;
  }

  BACKGROUND_PAYLOAD_REFRESHES.add(cacheKey);
  void producer()
    .then((payload) => {
      RESPONSE_CACHE.set(payloadKey, {
        expiresAt: Date.now() + ttlMs,
        payload,
        staleUntil: Date.now() + staleMs,
      });
      const body = JSON.stringify(payload);
      cacheJsonBody(`json:${cacheKey}`, body, ttlMs, staleMs);
      if (shouldPersistJsonCache(cacheKey)) {
        void writePersistedJsonCache(`json:${cacheKey}`, body);
      }
      invalidateDerivedCachesForBaseCache(cacheKey);
    })
    .catch((error) => {
      console.error(`Cache refresh failed for ${cacheKey}:`, error);
    })
    .finally(() => {
      BACKGROUND_PAYLOAD_REFRESHES.delete(cacheKey);
    });
}

async function fastJsonBackedPayload(
  cacheKey,
  payloadKey,
  producer,
  ttlMs,
  staleMs,
  fallbackPayload,
) {
  const payloadEntry = RESPONSE_CACHE.get(payloadKey);
  if (payloadEntry?.payload) {
    return payloadEntry.payload;
  }

  const jsonKey = `json:${cacheKey}`;
  await hydratePersistedJsonCache(jsonKey, staleMs);
  const cachedJsonEntry = RESPONSE_CACHE.get(jsonKey);
  if (cachedJsonEntry?.body) {
    try {
      const payload = JSON.parse(cachedJsonEntry.body);
      RESPONSE_CACHE.set(payloadKey, {
        expiresAt: Date.now() + ttlMs,
        payload,
        staleUntil: Date.now() + staleMs,
      });
      refreshPayloadCacheInBackground(
        cacheKey,
        payloadKey,
        producer,
        ttlMs,
        staleMs,
      );
      return payload;
    } catch {
      RESPONSE_CACHE.delete(jsonKey);
    }
  }

  refreshPayloadCacheInBackground(
    cacheKey,
    payloadKey,
    producer,
    ttlMs,
    staleMs,
  );
  return fallbackPayload;
}

async function backgroundRefreshedJsonBackedPayload(
  cacheKey,
  payloadKey,
  producer,
  ttlMs,
  staleMs,
  fallbackPayload,
) {
  refreshPayloadCacheInBackground(
    cacheKey,
    payloadKey,
    producer,
    ttlMs,
    staleMs,
  );

  const payloadEntry = RESPONSE_CACHE.get(payloadKey);
  if (payloadEntry?.payload) {
    return payloadEntry.payload;
  }

  const jsonKey = `json:${cacheKey}`;
  await hydratePersistedJsonCache(jsonKey, staleMs);
  const cachedJsonEntry = RESPONSE_CACHE.get(jsonKey);
  if (cachedJsonEntry?.body) {
    try {
      const payload = JSON.parse(cachedJsonEntry.body);
      RESPONSE_CACHE.set(payloadKey, {
        expiresAt: Date.now() + ttlMs,
        payload,
        staleUntil: Date.now() + staleMs,
      });
      return payload;
    } catch {
      RESPONSE_CACHE.delete(jsonKey);
    }
  }

  return fallbackPayload;
}

async function fastGlobalActivityPayload(network) {
  const cached = GLOBAL_ACTIVITY_CACHE.get(network);
  if (cached?.payload && Date.now() - cached.createdAt < ACTIVITY_CACHE_TTL_MS) {
    return cached.payload;
  }
  if (cached?.payload) {
    if (ENABLE_GLOBAL_ACTIVITY_CRAWL) {
      refreshGlobalActivityCacheInBackground(network);
    }
    return cached.payload;
  }

  const jsonKey = `json:activity:${network}`;
  await hydratePersistedJsonCache(jsonKey, ACTIVITY_CACHE_STALE_MS);
  const cachedJsonEntry = RESPONSE_CACHE.get(jsonKey);
  if (cachedJsonEntry?.body) {
    try {
      const payload = JSON.parse(cachedJsonEntry.body);
      GLOBAL_ACTIVITY_CACHE.set(network, {
        createdAt: Date.now(),
        payload,
      });
      if (ENABLE_GLOBAL_ACTIVITY_CRAWL) {
        refreshGlobalActivityCacheInBackground(network);
      }
      return payload;
    } catch {
      RESPONSE_CACHE.delete(jsonKey);
    }
  }

  if (ENABLE_GLOBAL_ACTIVITY_CRAWL) {
    refreshGlobalActivityCacheInBackground(network);
  }
  return {
    activity: [],
    indexedAt: new Date().toISOString(),
    network,
    source: mempoolBase(network),
    stats: {
      addresses: 0,
      dataBytes: 0,
      pending: 0,
      total: 0,
    },
  };
}

async function cachedGlobalActivityPayloadNoRefresh(network) {
  const cached = GLOBAL_ACTIVITY_CACHE.get(network);
  if (cached?.payload) {
    return cached.payload;
  }

  const jsonKey = `json:activity:${network}`;
  await hydratePersistedJsonCache(jsonKey, ACTIVITY_CACHE_STALE_MS);
  const cachedJsonEntry = RESPONSE_CACHE.get(jsonKey);
  if (cachedJsonEntry?.body) {
    try {
      const payload = JSON.parse(cachedJsonEntry.body);
      GLOBAL_ACTIVITY_CACHE.set(network, {
        createdAt: Date.now(),
        payload,
      });
      return payload;
    } catch {
      RESPONSE_CACHE.delete(jsonKey);
    }
  }

  return {
    activity: [],
    indexedAt: new Date().toISOString(),
    network,
    source: mempoolBase(network),
    stats: {
      addresses: 0,
      dataBytes: 0,
      pending: 0,
      total: 0,
    },
  };
}

function emptyTokenPayloadSnapshot(network) {
  return {
    ...emptyTokenState(),
    creationPriceSats: TOKEN_CREATION_PRICE_SATS,
    indexedAt: new Date().toISOString(),
    indexAddress: tokenIndexAddressForNetwork(network) ?? "",
    indexId: TOKEN_INDEX_ID,
    indexTxid: TOKEN_INDEX_TXID,
    minMutationPriceSats: TOKEN_MIN_MUTATION_PRICE_SATS,
    network,
    source: mempoolBase(network),
    stats: {
      confirmedMints: 0,
      confirmedTransfers: 0,
      confirmedTokens: 0,
      holders: 0,
      pendingMints: 0,
      pendingTransfers: 0,
      pendingTokens: 0,
      registries: 0,
      transactions: 0,
    },
    workDefaults: {
      maxSupply: WORK_TOKEN_MAX_SUPPLY,
      mintAmount: WORK_TOKEN_MINT_AMOUNT,
      mintPriceSats: WORK_TOKEN_MINT_PRICE_SATS,
      priceSatsPerWork: WORK_TOKEN_PRICE_SATS_PER_WORK,
      registryAddress: WORK_TOKEN_DEFAULT_REGISTRY_ADDRESS,
      ticker: WORK_TOKEN_TICKER,
      tokenId: WORK_TOKEN_ID,
    },
  };
}

async function cachedTokenPayloadSnapshotNoRefresh(network, tokenScope = "") {
  const scope = normalizeTokenScope(tokenScope);
  const payloadKey = `payload:token:${network}:${scope}`;
  const cachedPayloadEntry = RESPONSE_CACHE.get(payloadKey);
  if (cachedPayloadEntry?.payload) {
    return cachedPayloadEntry.payload;
  }

  const jsonKey = `json:token:${network}:${scope}`;
  await hydratePersistedJsonCache(jsonKey, TOKEN_CACHE_STALE_MS);
  const cachedJsonEntry = RESPONSE_CACHE.get(jsonKey);
  if (cachedJsonEntry?.body) {
    try {
      const payload = JSON.parse(cachedJsonEntry.body);
      RESPONSE_CACHE.set(payloadKey, {
        expiresAt: Date.now() - 1,
        payload,
        staleUntil: Date.now() + TOKEN_CACHE_STALE_MS,
      });
      return payload;
    } catch {
      RESPONSE_CACHE.delete(jsonKey);
    }
  }

  return emptyTokenPayloadSnapshot(network);
}

async function fastCachedTokenPayload(network, tokenScope = "") {
  const scope = normalizeTokenScope(tokenScope);
  const payloadKey = `payload:token:${network}:${scope}`;
  const now = Date.now();
  const cachedPayloadEntry = RESPONSE_CACHE.get(payloadKey);
  if (cachedPayloadEntry?.payload && now < cachedPayloadEntry.expiresAt) {
    return tokenPayloadWithSpendableListings(
      cachedPayloadEntry.payload,
      network,
    );
  }
  if (cachedPayloadEntry?.payload && now < cachedPayloadEntry.staleUntil) {
    if (shouldAutoRefreshTokenScope(scope)) {
      refreshTokenPayloadCacheInBackground(network, scope);
    }
    return tokenPayloadWithSpendableListings(
      cachedPayloadEntry.payload,
      network,
    );
  }

  const jsonKey = `json:token:${network}:${scope}`;
  await hydratePersistedJsonCache(jsonKey, TOKEN_CACHE_STALE_MS);
  const cachedJsonEntry = RESPONSE_CACHE.get(jsonKey);
  if (cachedJsonEntry?.body) {
    try {
      const payload = await tokenPayloadWithSpendableListings(
        JSON.parse(cachedJsonEntry.body),
        network,
      );
      RESPONSE_CACHE.set(payloadKey, {
        expiresAt: Date.now() + TOKEN_CACHE_TTL_MS,
        payload,
        staleUntil: Date.now() + TOKEN_CACHE_STALE_MS,
      });
      if (shouldAutoRefreshTokenScope(scope)) {
        refreshTokenPayloadCacheInBackground(network, scope);
      }
      return payload;
    } catch {
      RESPONSE_CACHE.delete(jsonKey);
    }
  }

  if (shouldAutoRefreshTokenScope(scope)) {
    refreshTokenPayloadCacheInBackground(network, scope);
  }
  if (cachedPayloadEntry?.payload) {
    return tokenPayloadWithSpendableListings(cachedPayloadEntry.payload, network);
  }
  return {
    ...emptyTokenState(),
    creationPriceSats: TOKEN_CREATION_PRICE_SATS,
    indexedAt: new Date().toISOString(),
    indexAddress: tokenIndexAddressForNetwork(network) ?? "",
    indexId: TOKEN_INDEX_ID,
    indexTxid: TOKEN_INDEX_TXID,
    minMutationPriceSats: TOKEN_MIN_MUTATION_PRICE_SATS,
    network,
    source: mempoolBase(network),
    stats: {
      confirmedMints: 0,
      confirmedTransfers: 0,
      confirmedTokens: 0,
      holders: 0,
      pendingMints: 0,
      pendingTransfers: 0,
      pendingTokens: 0,
      registries: 0,
      transactions: 0,
    },
    workDefaults: {
      maxSupply: WORK_TOKEN_MAX_SUPPLY,
      mintAmount: WORK_TOKEN_MINT_AMOUNT,
      mintPriceSats: WORK_TOKEN_MINT_PRICE_SATS,
      priceSatsPerWork: WORK_TOKEN_PRICE_SATS_PER_WORK,
      registryAddress: WORK_TOKEN_DEFAULT_REGISTRY_ADDRESS,
      ticker: WORK_TOKEN_TICKER,
      tokenId: WORK_TOKEN_ID,
    },
  };
}

function cachedRushPayload(network) {
  return cachedPayload(
    `payload:rush:${network}`,
    () => rushPayload(network),
    TOKEN_CACHE_TTL_MS,
    TOKEN_CACHE_STALE_MS,
  );
}

function shouldAutoRefreshTokenScope(_scope) {
  return false;
}

async function globalActivityPayload(network, fresh = false) {
  if (!ENABLE_GLOBAL_ACTIVITY_CRAWL) {
    return cachedGlobalActivityPayloadNoRefresh(network);
  }

  const cacheKey = network;
  const cached = GLOBAL_ACTIVITY_CACHE.get(cacheKey);
  if (!fresh && cached && Date.now() - cached.createdAt < ACTIVITY_CACHE_TTL_MS) {
    return cached.payload;
  }

  const registry = await safeRegistryPayload(network);
  const seenAddresses = new Set();
  const queuedAddresses = activityAddressesFromRegistry(registry, network);
  const mailTxs = [];

  let graphPasses = 0;
  while (
    queuedAddresses.length > 0 &&
    seenAddresses.size < MAX_ACTIVITY_ADDRESSES &&
    graphPasses < MAX_ACTIVITY_ADDRESS_GRAPH_PASSES
  ) {
    graphPasses += 1;
    const passCount = queuedAddresses.length;
    let processedInPass = 0;

    while (
      queuedAddresses.length > 0 &&
      processedInPass < passCount &&
      seenAddresses.size < MAX_ACTIVITY_ADDRESSES
    ) {
      const batch = queuedAddresses
        .splice(0, Math.max(1, TX_FETCH_CONCURRENCY))
        .filter((address) => !seenAddresses.has(address));
      if (batch.length === 0) {
        continue;
      }
      processedInPass += batch.length;

      for (const address of batch) {
        seenAddresses.add(address);
      }

      const addressTxGroups = await mapWithConcurrency(
        batch,
        TX_FETCH_CONCURRENCY,
        async (address) => {
          try {
            if (shouldFetchFullActivityHistory(address, network)) {
              return await fetchAddressTransactions(address, network);
            }

            return await fetchAddressTransactionsViaMempoolPagination(
              address,
              network,
              MAX_ADDRESS_TX_PAGES,
            );
          } catch (error) {
            console.error(
              `Global activity address lookup failed for ${address}: ${errorSummary(error)}`,
            );
            try {
              return await fetchAddressTransactionsViaMempoolPagination(
                address,
                network,
                MAX_ADDRESS_TX_PAGES,
              );
            } catch (fallbackError) {
              console.error(
                `Global activity fallback lookup failed for ${address}: ${errorSummary(fallbackError)}`,
              );
              return [];
            }
          }
        },
      );
      const batchTxs = addressTxGroups.flat();
      mailTxs.push(...batchTxs);

      for (const discoveredAddress of activityAddressesFromMailTransactions(
        batchTxs,
        network,
      )) {
        if (
          !seenAddresses.has(discoveredAddress) &&
          seenAddresses.size + queuedAddresses.length < MAX_ACTIVITY_ADDRESSES
        ) {
          queuedAddresses.push(discoveredAddress);
        }
      }
    }
  }

  const mailActivity = mailActivityItemsFromTransactions(mailTxs, network);
  const [tokenState, rushState] = await Promise.all([
    fastTokenPayloadSnapshot(network).catch(() => null),
    (fresh ? rushPayload(network) : cachedRushPayload(network)).catch(() => null),
  ]);
  const tokenActivity = tokenState
    ? tokenActivityItemsFromState(tokenState, tokenState.indexAddress ?? "")
    : [];
  const rushActivity = rushState ? rushActivityItemsFromState(rushState) : [];
  const activity = dedupeActivityItems([
    ...(registry.activity ?? []),
    ...mailActivity,
    ...tokenActivity,
    ...rushActivity,
  ]);
  const dataBytes = totalProtocolDataBytes(activity);
  const fileActions = activity.filter((item) => item.kind === "file").length;
  const infinityBondActions = activity.filter(isInfinityBondActivityItem).length;
  const messageActions = activity.filter(
    (item) =>
      (item.kind === "mail" || item.kind === "reply") &&
      !isInfinityBondActivityItem(item),
  ).length;
  const tokenActions = activity.filter((item) =>
    String(item.kind).startsWith("token-"),
  ).length;
  const akActions = activity.filter((item) =>
    String(item.kind).startsWith("ak-"),
  ).length;
  const rushActions = activity.filter((item) =>
    String(item.kind).startsWith("rush-"),
  ).length;
  const indexedThroughBlock = indexedThroughBlockFromItems(activity);

  const payload = {
    activity,
    indexedAt: new Date().toISOString(),
    network,
    source: mempoolBase(network),
    stats: {
      addresses: seenAddresses.size,
      ak: akActions,
      dataBytes,
      files: fileActions,
      indexedThroughBlock,
      infinityBonds: infinityBondActions,
      messages: messageActions,
      pending: activity.filter((item) => !item.confirmed).length,
      registry: (registry.activity ?? []).length,
      rush: rushActions,
      tokens: tokenActions,
      total: activity.length,
    },
  };

  GLOBAL_ACTIVITY_CACHE.set(cacheKey, {
    createdAt: Date.now(),
    payload,
  });

  return payload;
}

function idRegistryStateFromTransactions(txs, registryAddress, network) {
  const events = txs.flatMap((tx) => {
    const vin = Array.isArray(tx.vin) ? tx.vin : [];
    const vout = Array.isArray(tx.vout) ? tx.vout : [];
    const amount = registryPaymentAmount(vout, registryAddress);
    const txid = transactionTxid(tx);

    if (!txid || amount <= 0) {
      return [];
    }

    const eventMessage = decodedProtocolMessages(vout, ID_PROTOCOL_PREFIX)
      .map((message) => message.slice(ID_PROTOCOL_PREFIX.length))
      .map((payload) => parseIdEventPayload(payload, network))
      .find(Boolean);
    if (!eventMessage) {
      return [];
    }

    if (amount < idEventMinimumPaymentSats(eventMessage.kind)) {
      return [];
    }

    const blockTime =
      typeof tx.status?.block_time === "number"
        ? tx.status.block_time * 1000
        : Date.now();
    const baseEvent = {
      amountSats: amount,
      blockHeight: transactionBlockHeight(tx),
      blockIndex: transactionBlockIndex(tx),
      confirmed: transactionConfirmed(tx),
      createdAt: new Date(blockTime).toISOString(),
      dataBytes: proofProtocolDataBytesForVout(vout),
      inputAddresses: inputAddresses(vin),
      network,
      txid,
    };
    const eventSpentOutpoints = spentOutpoints(vin);
    const eventPaymentOutputs = paymentOutputsBeforeIdProtocol(vout);

    if (eventMessage.kind === "register") {
      return [
        {
          ...baseEvent,
          id: eventMessage.id,
          kind: "register",
          ownerAddress: eventMessage.ownerAddress,
          pgpKey: eventMessage.pgpKey || undefined,
          receiveAddress: eventMessage.receiveAddress,
        },
      ];
    }

    if (eventMessage.kind === "update") {
      return [
        {
          ...baseEvent,
          id: eventMessage.id,
          kind: "update",
          receiveAddress: eventMessage.receiveAddress,
        },
      ];
    }

    if (eventMessage.kind === "marketTransfer") {
      return [
        {
          ...baseEvent,
          id: eventMessage.id,
          kind: "marketTransfer",
          listingId: eventMessage.listingId,
          ownerAddress: eventMessage.ownerAddress,
          paymentOutputs: eventPaymentOutputs,
          priceSats: eventMessage.priceSats,
          receiveAddress: eventMessage.receiveAddress,
          saleAuthorization: eventMessage.saleAuthorization,
          sellerAddress: eventMessage.sellerAddress,
          spentOutpoints: eventSpentOutpoints,
          transferVersion: eventMessage.transferVersion,
        },
      ];
    }

    if (eventMessage.kind === "list") {
      return [
        {
          ...baseEvent,
          id: eventMessage.id,
          kind: "list",
          listingAnchorPresent: listingAnchorIsPresent(
            vout,
            eventMessage.saleAuthorization,
          ),
          listingVersion: eventMessage.listingVersion,
          priceSats: eventMessage.priceSats,
          saleAuthorization: eventMessage.saleAuthorization,
          sellerAddress: eventMessage.sellerAddress,
        },
      ];
    }

    if (eventMessage.kind === "seal") {
      return [
        {
          ...baseEvent,
          kind: "seal",
          listingId: eventMessage.listingId,
          saleAuthorization: eventMessage.saleAuthorization,
          spentOutpoints: eventSpentOutpoints,
        },
      ];
    }

    if (eventMessage.kind === "delist") {
      return [
        {
          ...baseEvent,
          delistingVersion: eventMessage.delistingVersion,
          kind: "delist",
          listingId: eventMessage.listingId,
          spentOutpoints: eventSpentOutpoints,
        },
      ];
    }

    return [
      {
        ...baseEvent,
        id: eventMessage.id,
        kind: "transfer",
        ownerAddress: eventMessage.ownerAddress,
        receiveAddress: eventMessage.receiveAddress,
      },
    ];
  });

  const confirmedEvents = events
    .filter((event) => event.confirmed)
    .sort(compareRegistryEventOrder);
  const pendingRegistrations = events
    .filter((event) => !event.confirmed && event.kind === "register")
    .sort(
      (left, right) =>
        Date.parse(right.createdAt) - Date.parse(left.createdAt) ||
        left.txid.localeCompare(right.txid),
    );
  const records = new Map();
  const listings = new Map();
  const confirmedSales = [];
  const acceptedActivityEvents = [];

  function invalidateListingsForId(id) {
    for (const [listingId, listing] of listings) {
      if (listing.id === id) {
        listings.delete(listingId);
      }
    }
  }

  for (const event of confirmedEvents) {
    if (event.kind === "register") {
      const current = records.get(event.id);
      if (current) {
        continue;
      }

      records.set(event.id, {
        amountSats: event.amountSats,
        confirmed: true,
        createdAt: event.createdAt,
        id: event.id,
        network: event.network,
        ownerAddress: event.ownerAddress,
        pgpKey: event.pgpKey,
        receiveAddress: event.receiveAddress,
        txid: event.txid,
      });
      acceptedActivityEvents.push(event);
      continue;
    }

    if (event.kind === "delist") {
      const listing = listings.get(event.listingId);
      const current = listing ? records.get(listing.id) : undefined;
      const anchorOk =
        (event.delistingVersion !== "delist3" &&
          event.delistingVersion !== "delist5") ||
        (listing ? spendsListingAnchor(event.spentOutpoints, listing) : false);
      if (
        listing &&
        current &&
        event.inputAddresses.includes(current.ownerAddress) &&
        anchorOk
      ) {
        listings.delete(event.listingId);
        acceptedActivityEvents.push(event);
      }
      continue;
    }

    if (event.kind === "seal") {
      const listing = listings.get(event.listingId);
      const current = listing ? records.get(listing.id) : undefined;
      if (
        !listing ||
        !current ||
        listing.listingVersion !== "list5" ||
        current.ownerAddress !== listing.sellerAddress ||
        !event.inputAddresses.includes(current.ownerAddress) ||
        !saleAuthorizationUsesSaleTicketAnchor(event.saleAuthorization) ||
        event.saleAuthorization.anchorTxid !== listing.listingId ||
        !saleAuthorizationTermsMatchIgnoringSeal(
          listing.saleAuthorization,
          event.saleAuthorization,
        )
      ) {
        continue;
      }

      listings.set(event.listingId, {
        ...listing,
        anchorSigHashType: event.saleAuthorization.anchorSigHashType,
        anchorSignature: event.saleAuthorization.anchorSignature,
        anchorTxid: listing.listingId,
        saleAuthorization: {
          ...event.saleAuthorization,
          anchorTxid: listing.listingId,
        },
        sealTxid: event.txid,
      });
      acceptedActivityEvents.push(event);
      continue;
    }

    if (event.kind === "marketTransfer") {
      if (
        event.transferVersion === "buy3" ||
        event.transferVersion === "buy4" ||
        event.transferVersion === "buy5"
      ) {
        const listing = event.listingId
          ? listings.get(event.listingId)
          : undefined;
        const current = listing ? records.get(listing.id) : undefined;
        const sellerPaymentSats = listing
          ? paymentAmountFromSnapshots(
              event.paymentOutputs,
              listing.sellerAddress,
            )
          : 0;
        if (
          !listing ||
          !current ||
          (event.transferVersion === "buy3" &&
            listing.listingVersion !== "list3") ||
          (event.transferVersion === "buy4" &&
            listing.listingVersion !== "list4") ||
          (event.transferVersion === "buy5" &&
            listing.listingVersion !== "list5") ||
          current.ownerAddress !== listing.sellerAddress ||
          !spendsListingAnchor(event.spentOutpoints, listing) ||
          sellerPaymentSats < sellerPaymentRequiredSats(listing) ||
          saleAuthorizationExpired(
            listing.saleAuthorization,
            event.createdAt,
          ) ||
          (listing.buyerAddress &&
            listing.buyerAddress !== event.ownerAddress) ||
          (listing.receiveAddress &&
            listing.receiveAddress !== event.receiveAddress)
        ) {
          continue;
        }

        records.set(listing.id, {
          ...current,
          amountSats: event.amountSats,
          createdAt: event.createdAt,
          ownerAddress: event.ownerAddress,
          receiveAddress: event.receiveAddress,
          txid: event.txid,
        });
        confirmedSales.push({
          amountSats: event.amountSats,
          buyerAddress: event.ownerAddress,
          confirmed: true,
          createdAt: event.createdAt,
          id: listing.id,
          listingId: listing.listingId,
          network: event.network,
          priceSats: listing.priceSats,
          receiveAddress: event.receiveAddress,
          sellerAddress: listing.sellerAddress,
          transferVersion: event.transferVersion,
          txid: event.txid,
        });
        acceptedActivityEvents.push(event);
        invalidateListingsForId(listing.id);
        continue;
      }

      if (
        event.id &&
        event.saleAuthorization &&
        event.sellerAddress &&
        typeof event.priceSats === "number"
      ) {
        const current = records.get(event.id);
        if (!current) {
          continue;
        }

        const matchingListing = findMatchingActiveListing(
          listings,
          event.saleAuthorization,
          current.ownerAddress,
        );
        if (
          current.ownerAddress !== event.sellerAddress ||
          paymentAmountFromSnapshots(
            event.paymentOutputs,
            event.sellerAddress,
          ) < event.priceSats ||
          saleAuthorizationExpired(event.saleAuthorization, event.createdAt) ||
          (!matchingListing &&
            !saleAuthorizationVerified(event.saleAuthorization))
        ) {
          continue;
        }

        records.set(event.id, {
          ...current,
          amountSats: event.amountSats,
          createdAt: event.createdAt,
          ownerAddress: event.ownerAddress,
          receiveAddress: event.receiveAddress,
          txid: event.txid,
        });
        confirmedSales.push({
          amountSats: event.amountSats,
          buyerAddress: event.ownerAddress,
          confirmed: true,
          createdAt: event.createdAt,
          id: event.id,
          listingId: matchingListing?.listingId,
          network: event.network,
          priceSats: event.priceSats,
          receiveAddress: event.receiveAddress,
          sellerAddress: event.sellerAddress,
          transferVersion: event.transferVersion,
          txid: event.txid,
        });
        acceptedActivityEvents.push(event);
        invalidateListingsForId(event.id);
      }
      continue;
    }

    const current = records.get(event.id);
    if (!current) {
      continue;
    }

    if (event.kind === "list") {
      if (
        current.ownerAddress !== event.sellerAddress ||
        !event.inputAddresses.includes(current.ownerAddress) ||
        saleAuthorizationExpired(event.saleAuthorization, event.createdAt) ||
        (event.listingVersion === "list3" && !event.listingAnchorPresent) ||
        (event.listingVersion === "list4" &&
          event.saleAuthorization.version !== ID_SALE_AUTH_VERSION) ||
        (event.listingVersion === "list5" &&
          (event.saleAuthorization.version !== ID_SALE_AUTH_VERSION_TICKET ||
            !event.listingAnchorPresent)) ||
        (event.listingVersion === "list2" &&
          event.saleAuthorization.version !== ID_SALE_AUTH_VERSION_LEGACY)
      ) {
        continue;
      }

      listings.set(event.txid, {
        amountSats: event.amountSats,
        anchorSigHashType: event.saleAuthorization.anchorSigHashType,
        anchorSignature: event.saleAuthorization.anchorSignature,
        anchorScriptPubKey: event.saleAuthorization.anchorScriptPubKey,
        anchorTxid: event.saleAuthorization.anchorTxid,
        anchorType: event.saleAuthorization.anchorType,
        anchorValueSats: event.saleAuthorization.anchorValueSats,
        anchorVout: event.saleAuthorization.anchorVout,
        buyerAddress: event.saleAuthorization.buyerAddress,
        confirmed: true,
        createdAt: event.createdAt,
        expiresAt: event.saleAuthorization.expiresAt,
        id: event.id,
        listingId: event.txid,
        listingVersion: event.listingVersion,
        network: event.network,
        priceSats: event.priceSats,
        receiveAddress: event.saleAuthorization.receiveAddress,
        saleAuthorization: event.saleAuthorization,
        sellerAddress: event.sellerAddress,
        sellerPublicKey: event.saleAuthorization.sellerPublicKey,
        txid: event.txid,
      });
      acceptedActivityEvents.push(event);
      continue;
    }

    if (!event.inputAddresses.includes(current.ownerAddress)) {
      continue;
    }

    if (event.kind === "update") {
      records.set(event.id, {
        ...current,
        amountSats: event.amountSats,
        createdAt: event.createdAt,
        receiveAddress: event.receiveAddress,
        txid: event.txid,
      });
      acceptedActivityEvents.push(event);
      continue;
    }

    records.set(event.id, {
      ...current,
      amountSats: event.amountSats,
      createdAt: event.createdAt,
      ownerAddress: event.ownerAddress,
      receiveAddress: event.receiveAddress,
      txid: event.txid,
    });
    acceptedActivityEvents.push(event);
    invalidateListingsForId(event.id);
  }

  const accepted = [...records.values()];
  const pendingEvents = events
    .filter((event) => !event.confirmed && event.kind !== "register")
    .flatMap((event) => {
      if (event.kind === "delist") {
        const listing = listings.get(event.listingId);
        const current = listing ? records.get(listing.id) : undefined;
        const anchorOk =
          (event.delistingVersion !== "delist3" &&
            event.delistingVersion !== "delist5") ||
          (listing
            ? spendsListingAnchor(event.spentOutpoints, listing)
            : false);
        if (
          !listing ||
          !current ||
          !event.inputAddresses.includes(current.ownerAddress) ||
          !anchorOk
        ) {
          return [];
        }

        return [
          {
            amountSats: event.amountSats,
            createdAt: event.createdAt,
            currentOwnerAddress: current.ownerAddress,
            currentReceiveAddress: current.receiveAddress,
            id: listing.id,
            inputAddresses: event.inputAddresses,
            kind: "delist",
            listingId: event.listingId,
            network: event.network,
            sellerAddress: listing.sellerAddress,
            txid: event.txid,
          },
        ];
      }

      if (event.kind === "seal") {
        const listing = listings.get(event.listingId);
        const current = listing ? records.get(listing.id) : undefined;
        if (
          !listing ||
          !current ||
          listing.listingVersion !== "list5" ||
          current.ownerAddress !== listing.sellerAddress ||
          !event.inputAddresses.includes(current.ownerAddress) ||
          !saleAuthorizationUsesSaleTicketAnchor(event.saleAuthorization) ||
          event.saleAuthorization.anchorTxid !== listing.listingId ||
          !saleAuthorizationTermsMatchIgnoringSeal(
            listing.saleAuthorization,
            event.saleAuthorization,
          )
        ) {
          return [];
        }

        return [
          {
            amountSats: event.amountSats,
            createdAt: event.createdAt,
            currentOwnerAddress: current.ownerAddress,
            currentReceiveAddress: current.receiveAddress,
            id: listing.id,
            inputAddresses: event.inputAddresses,
            kind: "seal",
            listingId: event.listingId,
            network: event.network,
            sellerAddress: listing.sellerAddress,
            txid: event.txid,
          },
        ];
      }

      if (event.kind === "marketTransfer") {
        if (
          event.transferVersion === "buy3" ||
          event.transferVersion === "buy4" ||
          event.transferVersion === "buy5"
        ) {
          const listing = event.listingId
            ? listings.get(event.listingId)
            : undefined;
          const current = listing ? records.get(listing.id) : undefined;
          const sellerPaymentSats = listing
            ? paymentAmountFromSnapshots(
                event.paymentOutputs,
                listing.sellerAddress,
              )
            : 0;
          if (
            !listing ||
            !current ||
            (event.transferVersion === "buy3" &&
              listing.listingVersion !== "list3") ||
            (event.transferVersion === "buy4" &&
              listing.listingVersion !== "list4") ||
            (event.transferVersion === "buy5" &&
              listing.listingVersion !== "list5") ||
            current.ownerAddress !== listing.sellerAddress ||
            !spendsListingAnchor(event.spentOutpoints, listing) ||
            sellerPaymentSats < sellerPaymentRequiredSats(listing) ||
            saleAuthorizationExpired(
              listing.saleAuthorization,
              event.createdAt,
            ) ||
            (listing.buyerAddress &&
              listing.buyerAddress !== event.ownerAddress) ||
            (listing.receiveAddress &&
              listing.receiveAddress !== event.receiveAddress)
          ) {
            return [];
          }

          return [
            {
              amountSats: event.amountSats,
              createdAt: event.createdAt,
              currentOwnerAddress: current.ownerAddress,
              currentReceiveAddress: current.receiveAddress,
              id: listing.id,
              inputAddresses: event.inputAddresses,
              kind: "marketTransfer",
              listingId: listing.listingId,
              network: event.network,
              ownerAddress: event.ownerAddress,
              priceSats: listing.priceSats,
              receiveAddress: event.receiveAddress,
              sellerAddress: listing.sellerAddress,
              transferVersion: event.transferVersion,
              txid: event.txid,
            },
          ];
        }

        if (
          event.id &&
          event.saleAuthorization &&
          event.sellerAddress &&
          typeof event.priceSats === "number"
        ) {
          const current = records.get(event.id);
          if (!current) {
            return [];
          }

          const matchingListing = findMatchingActiveListing(
            listings,
            event.saleAuthorization,
            current.ownerAddress,
          );
          if (
            current.ownerAddress !== event.sellerAddress ||
            paymentAmountFromSnapshots(
              event.paymentOutputs,
              event.sellerAddress,
            ) < event.priceSats ||
            saleAuthorizationExpired(
              event.saleAuthorization,
              event.createdAt,
            ) ||
            (!matchingListing &&
              !saleAuthorizationVerified(event.saleAuthorization))
          ) {
            return [];
          }

          return [
            {
              amountSats: event.amountSats,
              createdAt: event.createdAt,
              currentOwnerAddress: current.ownerAddress,
              currentReceiveAddress: current.receiveAddress,
              id: event.id,
              inputAddresses: event.inputAddresses,
              kind: "marketTransfer",
              network: event.network,
              ownerAddress: event.ownerAddress,
              priceSats: event.priceSats,
              receiveAddress: event.receiveAddress,
              sellerAddress: event.sellerAddress,
              transferVersion: event.transferVersion,
              txid: event.txid,
            },
          ];
        }

        return [];
      }

      const current = records.get(event.id);
      if (!current) {
        return [];
      }

      if (event.kind === "list") {
        if (
          current.ownerAddress !== event.sellerAddress ||
          !event.inputAddresses.includes(current.ownerAddress) ||
          saleAuthorizationExpired(event.saleAuthorization, event.createdAt) ||
          (event.listingVersion === "list3" && !event.listingAnchorPresent) ||
          (event.listingVersion === "list4" &&
            event.saleAuthorization.version !== ID_SALE_AUTH_VERSION) ||
          (event.listingVersion === "list5" &&
            (event.saleAuthorization.version !== ID_SALE_AUTH_VERSION_TICKET ||
              !event.listingAnchorPresent)) ||
          (event.listingVersion === "list2" &&
            event.saleAuthorization.version !== ID_SALE_AUTH_VERSION_LEGACY)
        ) {
          return [];
        }

        return [
          {
            amountSats: event.amountSats,
            createdAt: event.createdAt,
            currentOwnerAddress: current.ownerAddress,
            currentReceiveAddress: current.receiveAddress,
            id: event.id,
            inputAddresses: event.inputAddresses,
            kind: "list",
            network: event.network,
            priceSats: event.priceSats,
            sellerAddress: event.sellerAddress,
            txid: event.txid,
          },
        ];
      }

      if (!event.inputAddresses.includes(current.ownerAddress)) {
        return [];
      }

      if (event.kind === "update") {
        return [
          {
            amountSats: event.amountSats,
            createdAt: event.createdAt,
            currentOwnerAddress: current.ownerAddress,
            currentReceiveAddress: current.receiveAddress,
            id: event.id,
            inputAddresses: event.inputAddresses,
            kind: "update",
            network: event.network,
            receiveAddress: event.receiveAddress,
            txid: event.txid,
          },
        ];
      }

      return [
        {
          amountSats: event.amountSats,
          createdAt: event.createdAt,
          currentOwnerAddress: current.ownerAddress,
          currentReceiveAddress: current.receiveAddress,
          id: event.id,
          inputAddresses: event.inputAddresses,
          kind: "transfer",
          network: event.network,
          ownerAddress: event.ownerAddress,
          receiveAddress: event.receiveAddress,
          txid: event.txid,
        },
      ];
    })
    .sort(
      (left, right) =>
        Date.parse(right.createdAt) - Date.parse(left.createdAt) ||
        left.txid.localeCompare(right.txid),
    );

  const pendingSales = pendingEvents
    .filter(
      (event) =>
        event.kind === "marketTransfer" &&
        event.id &&
        event.ownerAddress &&
        Number.isSafeInteger(event.priceSats) &&
        event.priceSats >= 0 &&
        event.receiveAddress &&
        event.sellerAddress,
    )
    .map((event) => ({
      amountSats: event.amountSats,
      buyerAddress: event.ownerAddress,
      confirmed: false,
      createdAt: event.createdAt,
      id: event.id,
      listingId: event.listingId,
      network: event.network,
      priceSats: event.priceSats,
      receiveAddress: event.receiveAddress,
      sellerAddress: event.sellerAddress,
      transferVersion: event.transferVersion,
      txid: event.txid,
    }));

  const pendingRegistrationIds = new Set(records.keys());
  const pendingRegistrationActivityEvents = [];
  for (const event of pendingRegistrations) {
    if (!pendingRegistrationIds.has(event.id)) {
      accepted.push({
        amountSats: event.amountSats,
        confirmed: false,
        createdAt: event.createdAt,
        id: event.id,
        network: event.network,
        ownerAddress: event.ownerAddress,
        pgpKey: event.pgpKey,
        receiveAddress: event.receiveAddress,
        txid: event.txid,
      });
      pendingRegistrationActivityEvents.push(event);
      pendingRegistrationIds.add(event.id);
    }
  }

  const pendingEventTxids = new Set(pendingEvents.map((event) => event.txid));
  const pendingMutationActivityEvents = events.filter(
    (event) =>
      !event.confirmed &&
      event.kind !== "register" &&
      pendingEventTxids.has(event.txid),
  );
  const activityEvents = [
    ...acceptedActivityEvents,
    ...pendingRegistrationActivityEvents,
    ...pendingMutationActivityEvents,
  ];

  return {
    activity:
      idActivityItemsFromEvents(activityEvents).sort(compareActivityItems),
    listings: [...listings.values()].sort(
      (left, right) =>
        Date.parse(right.createdAt) - Date.parse(left.createdAt) ||
        left.txid.localeCompare(right.txid),
    ),
    pendingEvents,
    records: accepted,
    sales: publicMarketplaceSales([...confirmedSales, ...pendingSales]).sort(
      compareMarketplaceSales,
    ),
  };
}

function idRecordsFromTransactions(txs, registryAddress, network) {
  return idRegistryStateFromTransactions(txs, registryAddress, network).records;
}

function inboxMessagesFromTransactions(txs, address, network) {
  return txs.flatMap((tx) => {
    const vin = Array.isArray(tx.vin) ? tx.vin : [];
    const vout = Array.isArray(tx.vout) ? tx.vout : [];
    const protocolMessage = extractProtocolMemo(vout);
    const amount = receivedPaymentAmount(vout, address);
    const recipients = protocolPaymentOutputs(vout);

    if (!protocolMessage || amount <= 0) {
      return [];
    }

    const blockTime =
      typeof tx.status?.block_time === "number"
        ? tx.status.block_time * 1000
        : Date.now();
    const sender = senderAddress(vin, address);
    const message = {
      amountSats: amount,
      attachment: protocolMessage.attachment,
      confirmed: transactionConfirmed(tx),
      createdAt: new Date(blockTime).toISOString(),
      from: sender,
      memo: protocolMessage.memo,
      network,
      recipients: recipients.length > 0 ? recipients : undefined,
      replyTo:
        sender === "Unknown" ? (protocolMessage.replyTo ?? "Unknown") : sender,
      subject: protocolMessage.subject,
      to: address,
      txid: transactionTxid(tx),
    };

    if (!message.txid) {
      return [];
    }

    if (protocolMessage.parentTxid) {
      message.parentTxid = protocolMessage.parentTxid;
    }

    return [message];
  });
}

function sentMessagesFromTransactions(txs, address, network) {
  return txs.flatMap((tx) => {
    const vin = Array.isArray(tx.vin) ? tx.vin : [];
    const vout = Array.isArray(tx.vout) ? tx.vout : [];
    if (!inputAddresses(vin).includes(address)) {
      return [];
    }

    const protocolMessage = extractProtocolMemo(vout);
    const recipients = protocolPaymentOutputs(vout);
    const payment = recipients[0];
    const txid = transactionTxid(tx);
    if (!protocolMessage || !payment || !txid) {
      return [];
    }

    const confirmed = transactionConfirmed(tx);
    const blockTime =
      typeof tx.status?.block_time === "number"
        ? tx.status.block_time * 1000
        : Date.now();
    const createdAt = new Date(blockTime).toISOString();

    return [
      {
        amountSats: recipients.reduce(
          (total, recipient) => total + recipient.amountSats,
          0,
        ),
        attachment: protocolMessage.attachment,
        confirmedAt: confirmed ? createdAt : undefined,
        createdAt,
        feeRate: 0,
        from: address,
        lastCheckedAt: new Date().toISOString(),
        memo: protocolMessage.memo,
        network,
        parentTxid: protocolMessage.parentTxid,
        recipients,
        replyTo: address,
        subject: protocolMessage.subject,
        status: confirmed ? "confirmed" : "pending",
        to:
          recipients.length === 1
            ? payment.display
            : `${payment.display} +${recipients.length - 1}`,
        txid,
      },
    ];
  });
}

async function registryPayload(network) {
  const registryAddress = registryAddressForNetwork(network);
  if (!registryAddress) {
    return {
      activity: [],
      indexedAt: new Date().toISOString(),
      network,
      records: [],
      registryAddress: "",
      sales: [],
      stats: {
        confirmed: 0,
        confirmedSales: 0,
        confirmedSalesVolumeSats: 0,
        pending: 0,
        pendingSales: 0,
        pendingSalesVolumeSats: 0,
        sales: 0,
        salesVolumeSats: 0,
        total: 0,
      },
    };
  }

  const txs = await fetchRegistryTransactions(registryAddress, network);
  const state = idRegistryStateFromTransactions(txs, registryAddress, network);
  const listings = await filterSpendableListings(state.listings, network);
  const { activity, pendingEvents, records, sales } = state;
  const marketplaceStats = marketplaceStatsFromSales(sales);
  const confirmed = records.filter((record) => record.confirmed).length;
  const pendingRecords = records.length - confirmed;

  return {
    activity,
    indexedAt: new Date().toISOString(),
    listings,
    network,
    pendingEvents,
    records,
    registryAddress,
    sales,
    source: mempoolBase(network),
    stats: {
      confirmed,
      confirmedSales: marketplaceStats.confirmedSales,
      confirmedSalesVolumeSats: marketplaceStats.confirmedVolumeSats,
      pending: pendingRecords + pendingEvents.length,
      pendingChanges: pendingEvents.length,
      pendingRecords,
      pendingSales: marketplaceStats.pendingSales,
      pendingSalesVolumeSats: marketplaceStats.pendingVolumeSats,
      sales: marketplaceStats.totalSales,
      salesVolumeSats: marketplaceStats.totalVolumeSats,
      total: records.length,
      transactions: txs.length,
    },
  };
}

function transactionInputAddresses(vin) {
  return (Array.isArray(vin) ? vin : [])
    .map((input) => input?.prevout?.scriptpubkey_address)
    .filter((address) => typeof address === "string" && address);
}

async function workTokenPayload(network, fallbackPayload = null) {
  const indexAddress = tokenIndexAddressForNetwork(network);
  const previousWorkToken = (Array.isArray(fallbackPayload?.tokens)
    ? fallbackPayload.tokens
    : []
  ).find(
    (token) =>
      token.tokenId === WORK_TOKEN_ID || token.ticker === WORK_TOKEN_TICKER,
  );
  const workToken = {
    ...canonicalWorkTokenDefinition(network),
    ...(previousWorkToken ?? {}),
    maxSupply: WORK_TOKEN_MAX_SUPPLY,
    mintAmount: WORK_TOKEN_MINT_AMOUNT,
    mintPriceSats: WORK_TOKEN_MINT_PRICE_SATS,
    network,
    registryAddress: WORK_TOKEN_DEFAULT_REGISTRY_ADDRESS,
    ticker: WORK_TOKEN_TICKER,
    tokenId: WORK_TOKEN_ID,
    txid: WORK_TOKEN_ID,
  };
  const registryTxs = await fetchRegistryTransactions(
    WORK_TOKEN_DEFAULT_REGISTRY_ADDRESS,
    network,
  );
  const state = tokenStateFromTransactions(
    [],
    new Map([[WORK_TOKEN_DEFAULT_REGISTRY_ADDRESS, registryTxs]]),
    indexAddress,
    network,
    WORK_TOKEN_ID,
    [workToken],
  );
  const payloadState = await tokenPayloadWithSpendableListings(state, network);

  return {
    ...payloadState,
    creationPriceSats: TOKEN_CREATION_PRICE_SATS,
    indexedAt: new Date().toISOString(),
    indexAddress,
    indexId: TOKEN_INDEX_ID,
    indexTxid: TOKEN_INDEX_TXID,
    minMutationPriceSats: TOKEN_MIN_MUTATION_PRICE_SATS,
    network,
    source: mempoolBase(network),
    stats: {
      confirmedMints: state.mints.filter((mint) => mint.confirmed).length,
      confirmedTransfers: state.transfers.filter((transfer) => transfer.confirmed)
        .length,
      confirmedTokens: state.tokens.filter((token) => token.confirmed).length,
      creationSats: state.creationSats,
      holders: state.holders.length,
      pendingMints: state.mints.filter((mint) => !mint.confirmed).length,
      pendingTransfers: state.transfers.filter((transfer) => !transfer.confirmed)
        .length,
      pendingTokens: state.tokens.filter((token) => !token.confirmed).length,
      registries: 1,
      transactions: registryTxs.length,
    },
    workDefaults: {
      maxSupply: WORK_TOKEN_MAX_SUPPLY,
      mintAmount: WORK_TOKEN_MINT_AMOUNT,
      mintPriceSats: WORK_TOKEN_MINT_PRICE_SATS,
      priceSatsPerWork: WORK_TOKEN_PRICE_SATS_PER_WORK,
      registryAddress: WORK_TOKEN_DEFAULT_REGISTRY_ADDRESS,
      ticker: WORK_TOKEN_TICKER,
      tokenId: WORK_TOKEN_ID,
    },
  };
}

async function tokenPayload(network, tokenScope = "") {
  const scope = normalizeTokenScope(tokenScope);
  const indexAddress = tokenIndexAddressForNetwork(network);
  if (!indexAddress) {
    return {
      ...emptyTokenState(),
      creationPriceSats: TOKEN_CREATION_PRICE_SATS,
      indexedAt: new Date().toISOString(),
      indexAddress: "",
      indexId: TOKEN_INDEX_ID,
      indexTxid: TOKEN_INDEX_TXID,
      minMutationPriceSats: TOKEN_MIN_MUTATION_PRICE_SATS,
      network,
      workDefaults: {
        maxSupply: WORK_TOKEN_MAX_SUPPLY,
        mintAmount: WORK_TOKEN_MINT_AMOUNT,
        mintPriceSats: WORK_TOKEN_MINT_PRICE_SATS,
        priceSatsPerWork: WORK_TOKEN_PRICE_SATS_PER_WORK,
        registryAddress: WORK_TOKEN_DEFAULT_REGISTRY_ADDRESS,
        ticker: WORK_TOKEN_TICKER,
        tokenId: WORK_TOKEN_ID,
      },
    };
  }

  if (scope === WORK_TOKEN_ID) {
    return workTokenPayload(network);
  }

  const indexTxs = await fetchRegistryTransactions(indexAddress, network);
  const { tokens } = tokenDefinitionsFromTransactions(
    indexTxs,
    indexAddress,
    network,
  );
  const scopedTokens = tokens.filter((token) => tokenMatchesScope(token, scope));
  const registryAddresses = [
    ...new Set(
      scopedTokens.map((token) => token.registryAddress).filter(Boolean),
    ),
  ];
  const registryEntries = await Promise.all(
    registryAddresses.map(async (registryAddress) => [
      registryAddress,
      await fetchRegistryTransactions(registryAddress, network),
    ]),
  );
  const state = tokenStateFromTransactions(
    indexTxs,
    new Map(registryEntries),
    indexAddress,
    network,
    scope,
  );
  const payloadState = await tokenPayloadWithSpendableListings(state, network);
  return {
    ...payloadState,
    creationPriceSats: TOKEN_CREATION_PRICE_SATS,
    indexedAt: new Date().toISOString(),
    indexAddress,
    indexId: TOKEN_INDEX_ID,
    indexTxid: TOKEN_INDEX_TXID,
    minMutationPriceSats: TOKEN_MIN_MUTATION_PRICE_SATS,
    network,
    source: mempoolBase(network),
    stats: {
      confirmedMints: state.mints.filter((mint) => mint.confirmed).length,
      confirmedTransfers: state.transfers.filter((transfer) => transfer.confirmed)
        .length,
      confirmedTokens: state.tokens.filter((token) => token.confirmed).length,
      creationSats: state.creationSats,
      holders: state.holders.length,
      pendingMints: state.mints.filter((mint) => !mint.confirmed).length,
      pendingTransfers: state.transfers.filter((transfer) => !transfer.confirmed)
        .length,
      pendingTokens: state.tokens.filter((token) => !token.confirmed).length,
      registries: registryAddresses.length,
      transactions:
        indexTxs.length +
        registryEntries.reduce((total, [, txs]) => total + txs.length, 0),
    },
    workDefaults: {
      maxSupply: WORK_TOKEN_MAX_SUPPLY,
      mintAmount: WORK_TOKEN_MINT_AMOUNT,
      mintPriceSats: WORK_TOKEN_MINT_PRICE_SATS,
      priceSatsPerWork: WORK_TOKEN_PRICE_SATS_PER_WORK,
      registryAddress: WORK_TOKEN_DEFAULT_REGISTRY_ADDRESS,
      ticker: WORK_TOKEN_TICKER,
      tokenId: WORK_TOKEN_ID,
    },
  };
}

function recentByCreatedAt(items, limit = SUMMARY_ACTIVITY_LIMIT) {
  return (Array.isArray(items) ? items : [])
    .slice()
    .sort(
      (left, right) =>
        Number(Boolean(right?.closedConfirmed ?? right?.confirmed)) -
          Number(Boolean(left?.closedConfirmed ?? left?.confirmed)) ||
        Date.parse(String(right?.closedAt ?? right?.createdAt ?? "")) -
          Date.parse(String(left?.closedAt ?? left?.createdAt ?? "")) ||
        String(left?.closedTxid ?? left?.txid ?? left?.listingId ?? "").localeCompare(
          String(right?.closedTxid ?? right?.txid ?? right?.listingId ?? ""),
        ),
    )
    .slice(0, Math.max(0, limit));
}

function tokenAggregateSummaries(payload) {
  const tokens = Array.isArray(payload.tokens) ? payload.tokens : [];
  const summaries = new Map(
    tokens.map((token) => [
      token.tokenId,
      {
        balances: new Map(),
        confirmedMints: 0,
        confirmedSupply: 0,
        holderCount: 0,
        lastSalePricePerToken: 0,
        lowestAskPricePerToken: 0,
        openListings: 0,
        pendingMints: 0,
        pendingSupply: 0,
        transferCount: 0,
      },
    ]),
  );
  const addBalance = (tokenId, address, amount) => {
    if (!tokenId || !address || !Number.isFinite(amount) || amount === 0) {
      return;
    }

    const current = summaries.get(tokenId);
    if (!current) {
      return;
    }

    current.balances.set(address, (current.balances.get(address) ?? 0) + amount);
  };

  for (const mint of Array.isArray(payload.mints) ? payload.mints : []) {
    const current = summaries.get(mint.tokenId);
    if (!current) {
      continue;
    }

    if (mint.confirmed) {
      current.confirmedMints += 1;
      current.confirmedSupply += mint.amount;
      addBalance(mint.tokenId, mint.minterAddress, mint.amount);
    } else {
      current.pendingMints += 1;
      current.pendingSupply += mint.amount;
    }
  }

  for (const transfer of Array.isArray(payload.transfers) ? payload.transfers : []) {
    const current = summaries.get(transfer.tokenId);
    if (!current) {
      continue;
    }

    current.transferCount += 1;
    if (!transfer.confirmed) {
      continue;
    }

    addBalance(transfer.tokenId, transfer.senderAddress, -transfer.amount);
    addBalance(transfer.tokenId, transfer.recipientAddress, transfer.amount);
  }

  for (const sale of Array.isArray(payload.sales) ? payload.sales : []) {
    const current = summaries.get(sale.tokenId);
    if (!current || !sale.confirmed) {
      continue;
    }

    addBalance(sale.tokenId, sale.sellerAddress, -sale.amount);
    addBalance(sale.tokenId, sale.buyerAddress, sale.amount);
    if (current.lastSalePricePerToken === 0 && sale.amount > 0) {
      current.lastSalePricePerToken = sale.priceSats / sale.amount;
    }
  }

  for (const listing of Array.isArray(payload.listings) ? payload.listings : []) {
    const current = summaries.get(listing.tokenId);
    if (!current) {
      continue;
    }

    current.openListings += 1;
    if (!tokenListingHasConfirmedSaleTicketSeal(listing)) {
      continue;
    }

    const ask = listing.amount > 0 ? listing.priceSats / listing.amount : 0;
    if (ask > 0) {
      current.lowestAskPricePerToken =
        current.lowestAskPricePerToken > 0
          ? Math.min(current.lowestAskPricePerToken, ask)
          : ask;
    }
  }

  for (const summary of summaries.values()) {
    summary.holderCount = [...summary.balances.values()].filter(
      (balance) => balance > 0,
    ).length;
    delete summary.balances;
  }

  return summaries;
}

function scopedTokenPayloadFromState(tokenState, scope) {
  const normalizedScope = normalizeTokenScope(scope);
  if (!normalizedScope) {
    return tokenState;
  }

  const tokens = (tokenState.tokens ?? []).filter((token) =>
    tokenMatchesScope(token, normalizedScope),
  );
  const scopedTokenIds = new Set(tokens.map((token) => token.tokenId));
  const matchesScopedToken = (item) => scopedTokenIds.has(item?.tokenId);
  const closedListings = (tokenState.closedListings ?? []).filter(
    matchesScopedToken,
  );
  const listings = (tokenState.listings ?? []).filter(matchesScopedToken);
  const mints = (tokenState.mints ?? []).filter(matchesScopedToken);
  const sales = (tokenState.sales ?? []).filter(matchesScopedToken);
  const transfers = (tokenState.transfers ?? []).filter(matchesScopedToken);
  const summaries = tokenAggregateSummaries({
    listings,
    mints,
    sales,
    tokens,
    transfers,
  });
  const balances = new Map();
  const addBalance = (address, amount) => {
    if (!address || !Number.isFinite(amount) || amount === 0) {
      return;
    }

    balances.set(address, (balances.get(address) ?? 0) + amount);
  };
  for (const mint of mints) {
    if (mint.confirmed) {
      addBalance(mint.minterAddress, mint.amount);
    }
  }
  for (const transfer of transfers) {
    if (transfer.confirmed) {
      addBalance(transfer.senderAddress, -transfer.amount);
      addBalance(transfer.recipientAddress, transfer.amount);
    }
  }
  for (const sale of sales) {
    if (sale.confirmed) {
      addBalance(sale.sellerAddress, -sale.amount);
      addBalance(sale.buyerAddress, sale.amount);
    }
  }

  const confirmedSupply = tokens.reduce((total, token) => {
    const summary = summaries.get(token.tokenId);
    return total + Math.max(
      summary?.confirmedSupply ?? 0,
      Number.isFinite(token.confirmedSupply) ? Number(token.confirmedSupply) : 0,
    );
  }, 0);
  const pendingSupply = tokens.reduce((total, token) => {
    const summary = summaries.get(token.tokenId);
    return total + Math.max(
      summary?.pendingSupply ?? 0,
      Number.isFinite(token.pendingSupply) ? Number(token.pendingSupply) : 0,
    );
  }, 0);
  const holders = [...balances.entries()]
    .filter(([, balance]) => balance > 0)
    .map(([address, balance]) => ({ address, balance }))
    .sort(
      (left, right) =>
        right.balance - left.balance ||
        left.address.localeCompare(right.address),
    );

  const creationSats = tokens.reduce(
    (total, token) => total + (Number(token.creationFeeSats) || 0),
    0,
  );

  return {
    ...tokenState,
    closedListings,
    creationSats,
    confirmedSupply,
    holders,
    listings,
    mints,
    pendingSupply,
    sales,
    tokens,
    transfers,
    stats: {
      ...(tokenState.stats ?? {}),
      confirmedMints: mints.filter((mint) => mint.confirmed).length,
      confirmedTransfers: transfers.filter((transfer) => transfer.confirmed)
        .length,
      confirmedTokens: tokens.filter((token) => token.confirmed).length,
      creationSats,
      holders: holders.length,
      pendingMints: mints.filter((mint) => !mint.confirmed).length,
      pendingTransfers: transfers.filter((transfer) => !transfer.confirmed)
        .length,
      pendingTokens: tokens.filter((token) => !token.confirmed).length,
      registries: new Set(
        tokens.map((token) => token.registryAddress).filter(Boolean),
      ).size,
    },
  };
}

async function fastTokenPayloadSnapshot(network, tokenScope = "", options = {}) {
  const scope = normalizeTokenScope(tokenScope);
  const reconcileSpendable = options.reconcileSpendable !== false;
  const payloadKey = `payload:token:${network}:${scope}`;
  const now = Date.now();
  const cachedPayloadEntry = RESPONSE_CACHE.get(payloadKey);
  if (cachedPayloadEntry?.payload && now < cachedPayloadEntry.expiresAt) {
    return reconcileSpendable
      ? await tokenPayloadWithSpendableListings(cachedPayloadEntry.payload, network)
      : cachedPayloadEntry.payload;
  }
  if (cachedPayloadEntry?.payload && now < cachedPayloadEntry.staleUntil) {
    if (shouldAutoRefreshTokenScope(scope)) {
      refreshTokenPayloadCacheInBackground(network, scope);
    }
    return reconcileSpendable
      ? await tokenPayloadWithSpendableListings(cachedPayloadEntry.payload, network)
      : cachedPayloadEntry.payload;
  }

  const jsonKey = `json:token:${network}:${scope}`;
  await hydratePersistedJsonCache(jsonKey, TOKEN_CACHE_STALE_MS);
  const cachedJsonEntry = RESPONSE_CACHE.get(jsonKey);
  if (cachedJsonEntry?.body) {
    try {
      const rawPayload = JSON.parse(cachedJsonEntry.body);
      const payload = reconcileSpendable
        ? await tokenPayloadWithSpendableListings(rawPayload, network)
        : rawPayload;
      RESPONSE_CACHE.set(payloadKey, {
        expiresAt: Date.now() + TOKEN_CACHE_TTL_MS,
        payload,
        staleUntil: Date.now() + TOKEN_CACHE_STALE_MS,
      });
      if (shouldAutoRefreshTokenScope(scope)) {
        refreshTokenPayloadCacheInBackground(network, scope);
      }
      return payload;
    } catch {
      RESPONSE_CACHE.delete(jsonKey);
    }
  }

  if (shouldAutoRefreshTokenScope(scope)) {
    refreshTokenPayloadCacheInBackground(network, scope);
  }
  return {
    ...emptyTokenState(),
    creationPriceSats: TOKEN_CREATION_PRICE_SATS,
    indexedAt: new Date().toISOString(),
    indexAddress: tokenIndexAddressForNetwork(network) ?? "",
    indexId: TOKEN_INDEX_ID,
    indexTxid: TOKEN_INDEX_TXID,
    minMutationPriceSats: TOKEN_MIN_MUTATION_PRICE_SATS,
    network,
    source: mempoolBase(network),
    stats: {
      confirmedMints: 0,
      confirmedTransfers: 0,
      confirmedTokens: 0,
      holders: 0,
      pendingMints: 0,
      pendingTransfers: 0,
      pendingTokens: 0,
      registries: 0,
      transactions: 0,
    },
    workDefaults: {
      maxSupply: WORK_TOKEN_MAX_SUPPLY,
      mintAmount: WORK_TOKEN_MINT_AMOUNT,
      mintPriceSats: WORK_TOKEN_MINT_PRICE_SATS,
      priceSatsPerWork: WORK_TOKEN_PRICE_SATS_PER_WORK,
      registryAddress: WORK_TOKEN_DEFAULT_REGISTRY_ADDRESS,
      ticker: WORK_TOKEN_TICKER,
      tokenId: WORK_TOKEN_ID,
    },
  };
}

function compactTokenSummaryPayload(payload, tokenScope = "") {
  const holders = Array.isArray(payload.holders) ? payload.holders : [];
  const stats =
    payload.stats && typeof payload.stats === "object" ? payload.stats : {};
  const scope = normalizeTokenScope(tokenScope);
  const rawTokens = Array.isArray(payload.tokens) ? payload.tokens : [];
  const tokenSummaries = tokenAggregateSummaries(payload);
  const scopedTokenId =
    scope && rawTokens.length === 1 && tokenMatchesScope(rawTokens[0], scope)
      ? rawTokens[0].tokenId
      : "";
  const scopedConfirmedSupply = Number.isFinite(payload.confirmedSupply)
    ? Math.max(0, Number(payload.confirmedSupply))
    : undefined;
  const scopedPendingSupply = Number.isFinite(payload.pendingSupply)
    ? Math.max(0, Number(payload.pendingSupply))
    : undefined;
  const tokens = rawTokens.map((token) => {
    const summary = tokenSummaries.get(token.tokenId) ?? {};
    const next = {
      ...token,
      ...summary,
    };
    if (scopedTokenId && token.tokenId === scopedTokenId) {
      if (scopedConfirmedSupply !== undefined) {
        next.confirmedSupply = scopedConfirmedSupply;
      }
      if (scopedPendingSupply !== undefined) {
        next.pendingSupply = scopedPendingSupply;
      }
    }
    return next;
  });

  return {
    ...payload,
    closedListings: recentByCreatedAt(payload.closedListings, SUMMARY_MARKET_LIMIT),
    holders: holders.slice(0, SUMMARY_MARKET_LIMIT),
    listings: recentByCreatedAt(payload.listings, SUMMARY_MARKET_LIMIT),
    mints: [],
    sales: recentByCreatedAt(payload.sales, SUMMARY_MARKET_LIMIT),
    summaryOnly: true,
    tokens,
    transfers: [],
    stats: {
      ...stats,
      holders: holders.length,
    },
  };
}

function workTokenLiveSeenTxids(network) {
  const key = String(network || "livenet");
  let seen = WORK_TOKEN_LIVE_SEEN_TXIDS.get(key);
  if (!seen) {
    seen = new Set();
    WORK_TOKEN_LIVE_SEEN_TXIDS.set(key, seen);
  }
  return seen;
}

function addTokenStateTxids(txids, state) {
  const add = (value) => {
    if (typeof value === "string" && /^[0-9a-fA-F]{64}$/u.test(value)) {
      txids.add(value.toLowerCase());
    }
  };

  for (const key of [
    "mints",
    "transfers",
    "sales",
    "listings",
    "closedListings",
  ]) {
    for (const item of Array.isArray(state?.[key]) ? state[key] : []) {
      add(item.txid);
      add(item.listingId);
      add(item.sealTxid);
      add(item.closedTxid);
    }
  }
}

function unconfirmedTokenStateTxids(state) {
  const txids = new Set();
  const add = (value) => {
    if (typeof value === "string" && /^[0-9a-fA-F]{64}$/u.test(value)) {
      txids.add(value.toLowerCase());
    }
  };

  for (const item of Array.isArray(state?.mints) ? state.mints : []) {
    if (item?.confirmed === false) {
      add(item.txid);
    }
  }

  for (const item of Array.isArray(state?.transfers) ? state.transfers : []) {
    if (item?.confirmed === false) {
      add(item.txid);
    }
  }

  for (const item of Array.isArray(state?.sales) ? state.sales : []) {
    if (item?.confirmed === false) {
      add(item.txid);
    }
  }

  for (const item of Array.isArray(state?.listings) ? state.listings : []) {
    if (item?.confirmed === false) {
      add(item.txid);
      add(item.listingId);
    }
    if (item?.sealConfirmed === false) {
      add(item.sealTxid);
    }
  }

  for (const item of Array.isArray(state?.closedListings)
    ? state.closedListings
    : []) {
    if (item?.confirmed === false) {
      add(item.txid);
      add(item.listingId);
    }
    if (item?.closedConfirmed === false) {
      add(item.closedTxid);
    }
  }

  return [...txids];
}

function syncWorkTokenLiveSeenTxids(network, state) {
  const knownTxids = workTokenLiveSeenTxids(network);
  knownTxids.clear();
  addTokenStateTxids(knownTxids, state);
  for (const txid of unconfirmedTokenStateTxids(state)) {
    knownTxids.delete(txid);
  }
  return knownTxids;
}

function workTokenClosedListingsMissingSales(state, network) {
  const saleTxids = new Set(
    (Array.isArray(state?.sales) ? state.sales : [])
      .map((sale) => String(sale?.txid ?? "").toLowerCase())
      .filter((txid) => /^[0-9a-f]{64}$/u.test(txid)),
  );
  return (Array.isArray(state?.closedListings) ? state.closedListings : []).filter(
    (listing) => {
      const closedTxid = String(listing?.closedTxid ?? "").toLowerCase();
      return (
        listing?.tokenId === WORK_TOKEN_ID &&
        listing?.closedConfirmed === true &&
        /^[0-9a-f]{64}$/u.test(closedTxid) &&
        !saleTxids.has(closedTxid)
      );
    },
  );
}

function confirmedWorkSaleFromClosedListingTransaction(tx, listing, network) {
  const txid = transactionTxid(tx);
  if (!txid || !transactionConfirmed(tx)) {
    return null;
  }

  const vin = Array.isArray(tx.vin) ? tx.vin : [];
  const vout = Array.isArray(tx.vout) ? tx.vout : [];
  const txInputAddresses = inputAddresses(vin);
  const messages = decodedProtocolMessages(vout, TOKEN_PROTOCOL_PREFIX);
  if (messages.length === 0) {
    return null;
  }

  const registryAddress =
    listing.registryAddress || WORK_TOKEN_DEFAULT_REGISTRY_ADDRESS;
  let remainingRegistrySats = tokenPaymentAmountBeforeProtocol(
    vout,
    registryAddress,
  );
  const paymentOutputs = paymentOutputsBeforeTokenProtocol(vout);
  const eventSpentOutpoints = spentOutpoints(vin);
  const createdAt = new Date(tokenTransactionTime(tx)).toISOString();

  for (const message of messages) {
    const parsed = parseTokenPayload(message, network);
    if (
      !parsed ||
      parsed.kind !== "buy" ||
      parsed.listingId !== listing.listingId
    ) {
      continue;
    }

    const listingHasValidSaleTicketSpend =
      tokenSaleAuthorizationUsesSaleTicketAnchor(listing.saleAuthorization) ||
      tokenListingAnchorSpendMatchesAuthorization(vin, listing);
    if (
      !txInputAddresses.includes(parsed.buyerAddress) ||
      remainingRegistrySats < TOKEN_MIN_MUTATION_PRICE_SATS ||
      !listingHasValidSaleTicketSpend ||
      (listing.saleAuthorization.buyerAddress &&
        listing.saleAuthorization.buyerAddress !== parsed.buyerAddress) ||
      tokenListingIsExpired(listing, Date.parse(createdAt)) ||
      !spendsTokenListingAnchor(eventSpentOutpoints, listing) ||
      paymentAmountFromSnapshots(paymentOutputs, listing.sellerAddress) <
        tokenSellerPaymentRequiredSats(listing)
    ) {
      continue;
    }

    remainingRegistrySats -= TOKEN_MIN_MUTATION_PRICE_SATS;
    return {
      amount: listing.amount,
      buyerAddress: parsed.buyerAddress,
      confirmed: true,
      createdAt,
      listingId: listing.listingId,
      network,
      paidSats:
        tokenSellerPaymentRequiredSats(listing) +
        TOKEN_MIN_MUTATION_PRICE_SATS,
      priceSats: listing.priceSats,
      registryAddress,
      sellerAddress: listing.sellerAddress,
      ticker: listing.ticker,
      tokenId: listing.tokenId,
      txid,
    };
  }

  return null;
}

async function recoverWorkSalesFromClosedListings(state, network) {
  const candidates = workTokenClosedListingsMissingSales(state, network);
  const recovered = [];

  for (const listing of candidates) {
    const closedTxid = String(listing.closedTxid ?? "").toLowerCase();
    try {
      const tx = await fetchTransaction(closedTxid, network);
      const sale = confirmedWorkSaleFromClosedListingTransaction(
        tx,
        listing,
        network,
      );
      if (sale) {
        recovered.push(sale);
      }
    } catch (error) {
      console.error(
        `WORK closed sale repair lookup failed for ${closedTxid}: ${errorSummary(error)}`,
      );
    }
  }

  return recovered;
}

function workTokenStateWithRecoveredSales(state, recoveredSales) {
  const newSales = recoveredSales.filter(
    (sale) =>
      sale?.txid &&
      !(Array.isArray(state.sales) ? state.sales : []).some(
        (existing) => existing?.txid === sale.txid,
      ),
  );
  if (newSales.length === 0) {
    return state;
  }

  const holders = new Map(
    (Array.isArray(state.holders) ? state.holders : [])
      .filter((holder) => holder?.address && Number(holder.balance) > 0)
      .map((holder) => [holder.address, Number(holder.balance)]),
  );

  for (const sale of newSales) {
    holders.set(
      sale.sellerAddress,
      (holders.get(sale.sellerAddress) ?? 0) - sale.amount,
    );
    holders.set(
      sale.buyerAddress,
      (holders.get(sale.buyerAddress) ?? 0) + sale.amount,
    );
  }

  const nextHolders = [...holders.entries()]
    .filter(([, balance]) => balance > 0)
    .map(([address, balance]) => ({ address, balance }))
    .sort(
      (left, right) =>
        right.balance - left.balance ||
        left.address.localeCompare(right.address),
    );

  const nextSales = [...(Array.isArray(state.sales) ? state.sales : []), ...newSales]
    .sort(
      (left, right) =>
        Number(right.confirmed) - Number(left.confirmed) ||
        Date.parse(right.createdAt) - Date.parse(left.createdAt) ||
        left.txid.localeCompare(right.txid),
    );

  return {
    ...state,
    holders: nextHolders,
    indexedAt: new Date().toISOString(),
    sales: nextSales,
    stats: {
      ...(state.stats ?? {}),
      holders: nextHolders.length,
    },
  };
}

function confirmedWorkMintEventsFromTransaction(tx, network) {
  const txid = transactionTxid(tx);
  if (!txid || !transactionConfirmed(tx)) {
    return [];
  }

  const vin = Array.isArray(tx.vin) ? tx.vin : [];
  const vout = Array.isArray(tx.vout) ? tx.vout : [];
  const minterAddress = transactionInputAddresses(vin)[0] ?? "";
  if (!isValidBitcoinAddress(minterAddress, network)) {
    return [];
  }

  const messages = decodedProtocolMessages(vout, TOKEN_PROTOCOL_PREFIX);
  if (messages.length === 0) {
    return [];
  }

  let remainingRegistrySats = tokenPaymentAmountBeforeProtocol(
    vout,
    WORK_TOKEN_DEFAULT_REGISTRY_ADDRESS,
  );
  const createdAt = new Date(tokenTransactionTime(tx)).toISOString();
  const events = [];

  for (const message of messages) {
    const parsed = parseTokenPayload(message, network);
    if (
      !parsed ||
      parsed.kind !== "mint" ||
      parsed.tokenId !== WORK_TOKEN_ID ||
      parsed.amount !== WORK_TOKEN_MINT_AMOUNT ||
      remainingRegistrySats < WORK_TOKEN_MINT_PRICE_SATS
    ) {
      continue;
    }

    remainingRegistrySats -= WORK_TOKEN_MINT_PRICE_SATS;
    events.push({
      amount: WORK_TOKEN_MINT_AMOUNT,
      confirmed: true,
      createdAt,
      dataBytes: proofProtocolDataBytesForVout(vout),
      minterAddress,
      network,
      paidSats: WORK_TOKEN_MINT_PRICE_SATS,
      registryAddress: WORK_TOKEN_DEFAULT_REGISTRY_ADDRESS,
      ticker: WORK_TOKEN_TICKER,
      tokenId: WORK_TOKEN_ID,
      txid,
    });
  }

  return events;
}

function workTokenDeltaHasNonMintActions(txs, network) {
  return (Array.isArray(txs) ? txs : []).some((tx) => {
    const vout = Array.isArray(tx?.vout) ? tx.vout : [];
    return decodedProtocolMessages(vout, TOKEN_PROTOCOL_PREFIX).some(
      (message) => {
        const parsed = parseTokenPayload(message, network);
        return parsed && parsed.kind !== "mint";
      },
    );
  });
}

function workMintSupplyTotals(mints) {
  const rows = workMintRowsWithinPendingCap(mints);
  return {
    confirmedMints: rows.filter((mint) => mint.confirmed).length,
    confirmedSupply: rows
      .filter((mint) => mint.confirmed)
      .reduce((total, mint) => total + Number(mint.amount || 0), 0),
    pendingMints: rows.filter((mint) => !mint.confirmed).length,
    pendingSupply: rows
      .filter((mint) => !mint.confirmed)
      .reduce((total, mint) => total + Number(mint.amount || 0), 0),
  };
}

function sortWorkMintsForDisplay(mints) {
  return [...(Array.isArray(mints) ? mints : [])].sort(
    (left, right) =>
      Number(right.confirmed) - Number(left.confirmed) ||
      Date.parse(right.createdAt) - Date.parse(left.createdAt) ||
      String(left.txid ?? "").localeCompare(String(right.txid ?? "")),
  );
}

function sortWorkMintsForPendingCap(mints) {
  return [...(Array.isArray(mints) ? mints : [])].sort(
    (left, right) =>
      Date.parse(left.createdAt) - Date.parse(right.createdAt) ||
      String(left.txid ?? "").localeCompare(String(right.txid ?? "")),
  );
}

function workMintRowsWithinPendingCap(mints) {
  const rows = (Array.isArray(mints) ? mints : []).filter(
    (mint) => Number(mint?.amount) > 0,
  );
  const confirmed = rows.filter((mint) => mint.confirmed);
  const confirmedSupply = confirmed.reduce(
    (total, mint) => total + Number(mint.amount || 0),
    0,
  );
  const acceptedPending = [];
  let pendingSupply = 0;

  for (const mint of sortWorkMintsForPendingCap(
    rows.filter((item) => !item.confirmed),
  )) {
    const amount = Number(mint.amount || 0);
    if (confirmedSupply + pendingSupply + amount > WORK_TOKEN_MAX_SUPPLY) {
      continue;
    }

    pendingSupply += amount;
    acceptedPending.push(mint);
  }

  return [...confirmed, ...acceptedPending];
}

function workTokenStateWithMintSupplyCounters(state) {
  const cappedMints = workMintRowsWithinPendingCap(state?.mints);
  const totals = workMintSupplyTotals(cappedMints);
  const stats = state?.stats && typeof state.stats === "object" ? state.stats : {};
  const changed =
    (Array.isArray(state?.mints) ? state.mints.length : 0) !==
      cappedMints.length ||
    Number(state?.confirmedSupply ?? 0) !== totals.confirmedSupply ||
    Number(state?.pendingSupply ?? 0) !== totals.pendingSupply ||
    Number(stats.confirmedMints ?? 0) !== totals.confirmedMints ||
    Number(stats.pendingMints ?? 0) !== totals.pendingMints;
  if (!changed) {
    return state;
  }

  return {
    ...state,
    confirmedSupply: totals.confirmedSupply,
    mints: sortWorkMintsForDisplay(cappedMints),
    pendingSupply: totals.pendingSupply,
    stats: {
      ...stats,
      confirmedMints: totals.confirmedMints,
      pendingMints: totals.pendingMints,
    },
  };
}

function workTokenStateWithDeltaTransactions(state, txs, network) {
  const incomingConfirmedTxids = new Set(
    (Array.isArray(txs) ? txs : [])
      .filter(transactionConfirmed)
      .map(transactionTxid)
      .filter(Boolean)
      .map((txid) => txid.toLowerCase()),
  );
  const matchesIncomingConfirmedTxid = (...values) => {
    if (incomingConfirmedTxids.size === 0) {
      return false;
    }
    return values.some((value) =>
      typeof value === "string" &&
      incomingConfirmedTxids.has(value.toLowerCase()),
    );
  };
  const confirmedPendingSealTxids = new Set();
  for (const item of [
    ...(Array.isArray(state?.listings) ? state.listings : []),
    ...(Array.isArray(state?.closedListings) ? state.closedListings : []),
  ]) {
    if (
      item?.sealConfirmed === false &&
      matchesIncomingConfirmedTxid(item.sealTxid)
    ) {
      confirmedPendingSealTxids.add(String(item.sealTxid).toLowerCase());
    }
  }
  const shouldDropConfirmedDeltaMatch = (item) => {
    return (
      (item?.confirmed === false &&
        matchesIncomingConfirmedTxid(item.txid, item.listingId)) ||
      (item?.closedConfirmed === false &&
        matchesIncomingConfirmedTxid(item.closedTxid))
    );
  };
  const stateMints = workMintRowsWithinPendingCap(
    (Array.isArray(state?.mints) ? state.mints : []).filter(
      (item) => !shouldDropConfirmedDeltaMatch(item),
    ),
  );
  const stateTransfers = (Array.isArray(state?.transfers)
    ? state.transfers
    : []).filter((item) => !shouldDropConfirmedDeltaMatch(item));
  const stateListings = (Array.isArray(state?.listings)
    ? state.listings
    : []).filter((item) => !shouldDropConfirmedDeltaMatch(item));
  const stateClosedListings = (Array.isArray(state?.closedListings)
    ? state.closedListings
    : []).filter((item) => !shouldDropConfirmedDeltaMatch(item));
  const stateSales = (Array.isArray(state?.sales) ? state.sales : []).filter(
    (item) => !shouldDropConfirmedDeltaMatch(item),
  );
  const existingTxids = new Set();
  addTokenStateTxids(existingTxids, {
    closedListings: stateClosedListings,
    listings: stateListings,
    mints: stateMints,
    sales: stateSales,
    transfers: stateTransfers,
  });
  for (const txid of confirmedPendingSealTxids) {
    existingTxids.delete(txid);
  }

  const holderBalances = new Map(
    (Array.isArray(state?.holders) ? state.holders : [])
      .filter((holder) => holder?.address && Number.isFinite(Number(holder.balance)))
      .map((holder) => [holder.address, Number(holder.balance)]),
  );
  const listings = new Map(
    stateListings
      .filter((listing) => listing?.listingId)
      .map((listing) => [listing.listingId, listing]),
  );
  const closedListings = [...stateClosedListings];
  const mints = [...stateMints];
  const sales = [...stateSales];
  const transfers = [...stateTransfers];
  const initialSupplyTotals = workMintSupplyTotals(mints);
  let confirmedSupply = initialSupplyTotals.confirmedSupply;
  let pendingSupply = initialSupplyTotals.pendingSupply;
  let changed =
    Number(state?.confirmedSupply ?? 0) !== confirmedSupply ||
    Number(state?.pendingSupply ?? 0) !== pendingSupply;

  const reservedBalanceFor = (ownerAddress) => {
    let reserved = 0;
    for (const listing of listings.values()) {
      if (
        listing.tokenId === WORK_TOKEN_ID &&
        listing.sellerAddress === ownerAddress &&
        !tokenListingIsExpired(listing)
      ) {
        reserved += Number(listing.amount || 0);
      }
    }
    return reserved;
  };
  const spendableBalanceFor = (ownerAddress) =>
    (holderBalances.get(ownerAddress) ?? 0) - reservedBalanceFor(ownerAddress);
  const closeListing = (listing, event) => {
    if (
      closedListings.some(
        (closed) =>
          closed.listingId === listing.listingId &&
          closed.closedTxid === event.txid,
      )
    ) {
      return;
    }
    closedListings.push({
      ...listing,
      closedAt: event.createdAt,
      closedConfirmed: event.confirmed,
      closedTxid: event.txid,
    });
    changed = true;
  };

  for (const tx of tokenProtocolSortedTransactions(
    (Array.isArray(txs) ? txs : []).filter(Boolean),
  )) {
    const txid = transactionTxid(tx);
    if (!txid || existingTxids.has(txid)) {
      continue;
    }

    const vin = Array.isArray(tx.vin) ? tx.vin : [];
    const vout = Array.isArray(tx.vout) ? tx.vout : [];
    const txInputAddresses = inputAddresses(vin);
    const actorAddress = txInputAddresses[0] ?? "";
    if (!isValidBitcoinAddress(actorAddress, network)) {
      continue;
    }

    const messages = decodedProtocolMessages(vout, TOKEN_PROTOCOL_PREFIX);
    if (messages.length === 0) {
      continue;
    }

    let remainingRegistrySats = tokenPaymentAmountBeforeProtocol(
      vout,
      WORK_TOKEN_DEFAULT_REGISTRY_ADDRESS,
    );
    const paymentOutputs = paymentOutputsBeforeTokenProtocol(vout);
    const eventSpentOutpoints = spentOutpoints(vin);
    const confirmed = transactionConfirmed(tx);
    const createdAt = new Date(tokenTransactionTime(tx)).toISOString();
    let acceptedTxMessage = false;

    for (const message of messages) {
      const parsed = parseTokenPayload(message, network);
      if (!parsed) {
        continue;
      }

      if (parsed.kind === "mint") {
        const projectedSupply = confirmed
          ? confirmedSupply + parsed.amount
          : confirmedSupply + pendingSupply + parsed.amount;
        if (
          parsed.tokenId !== WORK_TOKEN_ID ||
          parsed.amount !== WORK_TOKEN_MINT_AMOUNT ||
          remainingRegistrySats < WORK_TOKEN_MINT_PRICE_SATS ||
          projectedSupply > WORK_TOKEN_MAX_SUPPLY
        ) {
          continue;
        }

        remainingRegistrySats -= WORK_TOKEN_MINT_PRICE_SATS;
        if (confirmed) {
          confirmedSupply += parsed.amount;
          holderBalances.set(
            actorAddress,
            (holderBalances.get(actorAddress) ?? 0) + parsed.amount,
          );
        } else {
          pendingSupply += parsed.amount;
        }
        mints.push({
          amount: parsed.amount,
          confirmed,
          createdAt,
          dataBytes: proofProtocolDataBytesForVout(vout),
          minterAddress: actorAddress,
          network,
          paidSats: WORK_TOKEN_MINT_PRICE_SATS,
          registryAddress: WORK_TOKEN_DEFAULT_REGISTRY_ADDRESS,
          ticker: WORK_TOKEN_TICKER,
          tokenId: WORK_TOKEN_ID,
          txid,
        });
        acceptedTxMessage = true;
        changed = true;
        continue;
      }

      if (parsed.kind === "send") {
        if (
          parsed.tokenId !== WORK_TOKEN_ID ||
          remainingRegistrySats < TOKEN_MIN_MUTATION_PRICE_SATS ||
          (confirmed && spendableBalanceFor(actorAddress) < parsed.amount)
        ) {
          continue;
        }

        remainingRegistrySats -= TOKEN_MIN_MUTATION_PRICE_SATS;
        if (confirmed) {
          holderBalances.set(
            actorAddress,
            (holderBalances.get(actorAddress) ?? 0) - parsed.amount,
          );
          holderBalances.set(
            parsed.recipientAddress,
            (holderBalances.get(parsed.recipientAddress) ?? 0) + parsed.amount,
          );
        }
        transfers.push({
          amount: parsed.amount,
          confirmed,
          createdAt,
          dataBytes: proofProtocolDataBytesForVout(vout),
          network,
          paidSats: TOKEN_MIN_MUTATION_PRICE_SATS,
          recipientAddress: parsed.recipientAddress,
          registryAddress: WORK_TOKEN_DEFAULT_REGISTRY_ADDRESS,
          senderAddress: actorAddress,
          ticker: WORK_TOKEN_TICKER,
          tokenId: WORK_TOKEN_ID,
          txid,
        });
        acceptedTxMessage = true;
        changed = true;
        continue;
      }

      if (parsed.kind === "list") {
        const authorization = parsed.saleAuthorization;
        if (
          authorization.tokenId !== WORK_TOKEN_ID ||
          authorization.registryAddress !== WORK_TOKEN_DEFAULT_REGISTRY_ADDRESS ||
          authorization.ticker !== WORK_TOKEN_TICKER ||
          authorization.sellerAddress !== actorAddress ||
          remainingRegistrySats < TOKEN_MIN_MUTATION_PRICE_SATS ||
          spendableBalanceFor(actorAddress) < authorization.amount ||
          !tokenListingAnchorIsPresent(vout, authorization) ||
          listings.has(txid)
        ) {
          continue;
        }

        remainingRegistrySats -= TOKEN_MIN_MUTATION_PRICE_SATS;
        listings.set(txid, {
          amount: authorization.amount,
          confirmed,
          createdAt,
          dataBytes: proofProtocolDataBytesForVout(vout),
          listingId: txid,
          network,
          priceSats: authorization.priceSats,
          registryAddress: WORK_TOKEN_DEFAULT_REGISTRY_ADDRESS,
          saleAuthorization: authorization,
          sellerAddress: actorAddress,
          ticker: WORK_TOKEN_TICKER,
          tokenId: WORK_TOKEN_ID,
        });
        acceptedTxMessage = true;
        changed = true;
        continue;
      }

      if (parsed.kind === "seal") {
        const listing = listings.get(parsed.listingId);
        const authorization = parsed.saleAuthorization;
        if (
          !listing ||
          listing.sellerAddress !== actorAddress ||
          remainingRegistrySats < TOKEN_MIN_MUTATION_PRICE_SATS ||
          !tokenSaleAuthorizationTermsMatch(
            listing.saleAuthorization,
            authorization,
          ) ||
          authorization.anchorTxid !== listing.listingId ||
          !tokenSaleAuthorizationUsesSaleTicketAnchor(authorization)
        ) {
          continue;
        }

        remainingRegistrySats -= TOKEN_MIN_MUTATION_PRICE_SATS;
        listings.set(listing.listingId, {
          ...listing,
          saleAuthorization: authorization,
          sealAt: createdAt,
          sealConfirmed: confirmed,
          sealDataBytes: proofProtocolDataBytesForVout(vout),
          sealTxid: txid,
        });
        acceptedTxMessage = true;
        changed = true;
        continue;
      }

      if (parsed.kind === "delist") {
        const listing = listings.get(parsed.listingId);
        if (
          !listing ||
          listing.sellerAddress !== actorAddress ||
          remainingRegistrySats < TOKEN_MIN_MUTATION_PRICE_SATS ||
          !spendsTokenListingAnchor(eventSpentOutpoints, listing)
        ) {
          continue;
        }

        remainingRegistrySats -= TOKEN_MIN_MUTATION_PRICE_SATS;
        closeListing(listing, { confirmed, createdAt, txid });
        listings.delete(listing.listingId);
        acceptedTxMessage = true;
        changed = true;
        continue;
      }

      if (parsed.kind === "buy") {
        const listing = listings.get(parsed.listingId);
        const listingHasValidSaleTicketSpend = listing
          ? tokenSaleAuthorizationUsesSaleTicketAnchor(
              listing.saleAuthorization,
            ) || tokenListingAnchorSpendMatchesAuthorization(vin, listing)
          : false;
        if (
          !listing ||
          !txInputAddresses.includes(parsed.buyerAddress) ||
          remainingRegistrySats < TOKEN_MIN_MUTATION_PRICE_SATS ||
          !listingHasValidSaleTicketSpend ||
          (listing.saleAuthorization.buyerAddress &&
            listing.saleAuthorization.buyerAddress !== parsed.buyerAddress) ||
          tokenListingIsExpired(listing) ||
          !spendsTokenListingAnchor(eventSpentOutpoints, listing) ||
          paymentAmountFromSnapshots(paymentOutputs, listing.sellerAddress) <
            tokenSellerPaymentRequiredSats(listing) ||
          (confirmed &&
            (holderBalances.get(listing.sellerAddress) ?? 0) < listing.amount)
        ) {
          continue;
        }

        remainingRegistrySats -= TOKEN_MIN_MUTATION_PRICE_SATS;
        closeListing(listing, { confirmed, createdAt, txid });
        listings.delete(listing.listingId);
        if (confirmed) {
          holderBalances.set(
            listing.sellerAddress,
            (holderBalances.get(listing.sellerAddress) ?? 0) - listing.amount,
          );
          holderBalances.set(
            parsed.buyerAddress,
            (holderBalances.get(parsed.buyerAddress) ?? 0) + listing.amount,
          );
        }
        sales.push({
          amount: listing.amount,
          buyerAddress: parsed.buyerAddress,
          confirmed,
          createdAt,
          listingId: listing.listingId,
          network,
          paidSats:
            tokenSellerPaymentRequiredSats(listing) +
            TOKEN_MIN_MUTATION_PRICE_SATS,
          priceSats: listing.priceSats,
          registryAddress: WORK_TOKEN_DEFAULT_REGISTRY_ADDRESS,
          sellerAddress: listing.sellerAddress,
          ticker: WORK_TOKEN_TICKER,
          tokenId: WORK_TOKEN_ID,
          txid,
        });
        acceptedTxMessage = true;
        changed = true;
      }
    }

    if (acceptedTxMessage) {
      existingTxids.add(txid);
    }
  }

  if (!changed) {
    return state;
  }

  const holders = [...holderBalances.entries()]
    .filter(([, balance]) => balance > 0)
    .map(([address, balance]) => ({ address, balance }))
    .sort(
      (left, right) =>
        right.balance - left.balance ||
        left.address.localeCompare(right.address),
    );
  const activeListings = [...listings.values()]
    .filter((listing) => !tokenListingIsExpired(listing))
    .sort(
      (left, right) =>
        Number(right.confirmed) - Number(left.confirmed) ||
        Date.parse(right.createdAt) - Date.parse(left.createdAt) ||
        left.listingId.localeCompare(right.listingId),
    );
  const sortedMints = sortWorkMintsForDisplay(workMintRowsWithinPendingCap(mints));
  const mintSupplyTotals = workMintSupplyTotals(sortedMints);
  const sortedSales = sales.sort(
    (left, right) =>
      Number(right.confirmed) - Number(left.confirmed) ||
      Date.parse(right.createdAt) - Date.parse(left.createdAt) ||
      left.txid.localeCompare(right.txid),
  );
  const sortedTransfers = transfers.sort(
    (left, right) =>
      Number(right.confirmed) - Number(left.confirmed) ||
      Date.parse(right.createdAt) - Date.parse(left.createdAt) ||
      left.txid.localeCompare(right.txid),
  );

  return {
    ...state,
    closedListings: sortClosedTokenListings(closedListings),
    confirmedSupply: mintSupplyTotals.confirmedSupply,
    holders,
    indexedAt: new Date().toISOString(),
    listings: activeListings,
    mints: sortedMints,
    pendingSupply: mintSupplyTotals.pendingSupply,
    sales: sortedSales,
    stats: {
      ...(state.stats ?? {}),
      confirmedMints: mintSupplyTotals.confirmedMints,
      confirmedTransfers: sortedTransfers.filter((transfer) => transfer.confirmed)
        .length,
      confirmedTokens: (Array.isArray(state.tokens) ? state.tokens : []).filter(
        (token) => token.confirmed,
      ).length,
      holders: holders.length,
      pendingMints: mintSupplyTotals.pendingMints,
      pendingTransfers: sortedTransfers.filter((transfer) => !transfer.confirmed)
        .length,
      pendingTokens: (Array.isArray(state.tokens) ? state.tokens : []).filter(
        (token) => !token.confirmed,
      ).length,
    },
    transfers: sortedTransfers,
  };
}

function cacheLiveWorkTokenState(network, state) {
  const scope = WORK_TOKEN_ID;
  cacheTokenPayload(network, scope, state);
}

async function confirmedTransactionsForTxids(txids, network, maxTxs) {
  const uniqueTxids = [...new Set(txids)]
    .filter((txid) => /^[0-9a-f]{64}$/u.test(txid))
    .slice(0, Math.max(0, maxTxs));
  if (uniqueTxids.length === 0) {
    return [];
  }

  const txs = await mapWithConcurrency(
    uniqueTxids,
    TX_FETCH_CONCURRENCY,
    async (txid) => {
      try {
        const tx = await fetchTransaction(txid, network);
        return transactionConfirmed(tx) ? tx : null;
      } catch {
        return null;
      }
    },
  );
  return txs.filter(Boolean);
}

async function recentUnknownHistoryTransactions(
  address,
  network,
  knownTxids,
  maxTxs,
) {
  let historyTxids = [];
  try {
    historyTxids = await fetchAddressHistoryTxidsFromElectrum(address, network);
  } catch (error) {
    console.error(
      `WORK live registry history lookup failed for ${network}: ${errorSummary(error)}`,
    );
    return [];
  }

  const unknownTxids = historyTxids
    .filter((txid) => !knownTxids.has(txid))
    .slice(-Math.max(0, maxTxs));
  if (unknownTxids.length === 0) {
    return [];
  }

  let failedFetches = 0;
  const txs = await mapWithConcurrency(
    unknownTxids,
    TX_FETCH_CONCURRENCY,
    async (txid) => {
      try {
        return await fetchTransaction(txid, network);
      } catch {
        failedFetches += 1;
        return null;
      }
    },
  );

  if (failedFetches > 0) {
    console.error(
      `WORK live history hydration was partial for ${network}: ${failedFetches} of ${unknownTxids.length} transaction lookups failed.`,
    );
  }

  return annotateBlockOrder(dedupeTransactions(txs.filter(Boolean)), network);
}

async function replayLiveWorkTokenState(network, state, reason) {
  try {
    const replayedState = await workTokenPayload(network, state);
    if (!tokenPayloadLooksWorse(replayedState, state)) {
      cacheLiveWorkTokenState(network, replayedState);
      syncWorkTokenLiveSeenTxids(network, replayedState);
      console.log(`Replayed full WORK registry ${reason} for ${network}.`);
      return replayedState;
    }

    const nextMetrics = JSON.stringify(tokenPayloadMetrics(replayedState));
    const previousMetrics = JSON.stringify(tokenPayloadMetrics(state));
    console.error(
      `Rejected WORK ${reason} replay regression for ${network}: ${nextMetrics} < ${previousMetrics}.`,
    );
  } catch (error) {
    console.error(
      `WORK ${reason} replay failed for ${network}: ${errorSummary(error)}`,
    );
  }

  return null;
}

async function liveWorkTokenState(network, cachedWorkTokenState, options = {}) {
  let state =
    cachedWorkTokenState && typeof cachedWorkTokenState === "object"
      ? cachedWorkTokenState
      : {
          ...emptyTokenState(),
          indexedAt: new Date().toISOString(),
          network,
          tokens: [
            {
              confirmed: true,
              createdAt: new Date(GROWTH_MODEL_START_MS).toISOString(),
              creationFeeSats: TOKEN_CREATION_PRICE_SATS,
              creatorAddress: "",
              dataBytes: 0,
              maxSupply: WORK_TOKEN_MAX_SUPPLY,
              mintAmount: WORK_TOKEN_MINT_AMOUNT,
              mintPriceSats: WORK_TOKEN_MINT_PRICE_SATS,
              network,
              registryAddress: WORK_TOKEN_DEFAULT_REGISTRY_ADDRESS,
              ticker: WORK_TOKEN_TICKER,
              tokenId: WORK_TOKEN_ID,
              txid: WORK_TOKEN_ID,
            },
          ],
        };

  if (network !== "livenet") {
    return state;
  }

  const counterNormalizedState = workTokenStateWithMintSupplyCounters(state);
  if (counterNormalizedState !== state) {
    state = counterNormalizedState;
    cacheLiveWorkTokenState(network, state);
    syncWorkTokenLiveSeenTxids(network, state);
  }

  if (options.recoverClosedSales !== false) {
    const recoveredSales = await recoverWorkSalesFromClosedListings(
      state,
      network,
    );
    if (recoveredSales.length > 0) {
      state = workTokenStateWithRecoveredSales(state, recoveredSales);
      cacheLiveWorkTokenState(network, state);
      syncWorkTokenLiveSeenTxids(network, state);
      console.log(
        `Recovered ${recoveredSales.length} WORK closed sale(s) for ${network}.`,
      );
    }
  }

  const maxDeltaTxs = Math.max(1, WORK_TOKEN_LIVE_DELTA_MAX_TXS);
  const maxPendingConfirmationTxs = Math.max(
    0,
    Math.min(maxDeltaTxs, WORK_TOKEN_LIVE_PENDING_CONFIRMATION_MAX_TXS),
  );
  const maxRecentTxs = Math.max(
    1,
    Math.min(maxDeltaTxs, WORK_TOKEN_LIVE_RECENT_MAX_TXS),
  );
  const maxHistoryTxs = Math.max(
    1,
    Math.min(maxDeltaTxs, WORK_TOKEN_LIVE_HISTORY_MAX_TXS),
  );
  const pendingTxids = unconfirmedTokenStateTxids(state);
  const confirmedPendingTxs = await confirmedTransactionsForTxids(
    pendingTxids,
    network,
    maxPendingConfirmationTxs,
  );

  const knownTxids = syncWorkTokenLiveSeenTxids(network, state);
  let txs = await fetchRecentUnknownAddressTransactions(
    WORK_TOKEN_DEFAULT_REGISTRY_ADDRESS,
    network,
    knownTxids,
    maxRecentTxs,
  ).catch((error) => {
    console.error(
      `WORK live recent page lookup failed for ${network}: ${errorSummary(error)}`,
    );
    return [];
  });
  const cachedPendingTokenTxs = cachedPendingTokenTransactionsForRegistry(
    network,
    WORK_TOKEN_DEFAULT_REGISTRY_ADDRESS,
  );
  const historyTxs = await recentUnknownHistoryTransactions(
    WORK_TOKEN_DEFAULT_REGISTRY_ADDRESS,
    network,
    knownTxids,
    maxHistoryTxs,
  );

  txs = dedupeTransactions([
    ...confirmedPendingTxs,
    ...txs.filter(Boolean),
    ...historyTxs,
    ...cachedPendingTokenTxs,
  ]);
  const confirmedDeltaTxids = new Set(
    txs.filter(transactionConfirmed).map(transactionTxid).filter(Boolean),
  );
  if (workTokenDeltaHasNonMintActions(txs, network)) {
    const deltaState = workTokenStateWithDeltaTransactions(state, txs, network);
    if (deltaState !== state && !tokenPayloadLooksWorse(deltaState, state)) {
      cacheLiveWorkTokenState(network, deltaState);
      syncWorkTokenLiveSeenTxids(network, deltaState);
      console.log(
        `Applied incremental WORK non-mint delta for ${network}.`,
      );
      return deltaState;
    }

    const replayedState = await replayLiveWorkTokenState(
      network,
      state,
      "after non-mint delta",
    );
    if (replayedState) {
      return replayedState;
    }

    return state;
  }

  for (const tx of txs) {
    const txid = transactionTxid(tx);
    if (txid) {
      knownTxids.add(txid);
    }
  }

  const existingMints = workMintRowsWithinPendingCap(
    (Array.isArray(state.mints) ? state.mints : []).filter(
      (mint) =>
        !(
          mint?.confirmed === false &&
          confirmedDeltaTxids.has(String(mint.txid ?? "").toLowerCase())
        ),
    ),
  );
  const acceptedMintCountsByTxid = new Map();
  for (const mint of existingMints) {
    const txid = String(mint.txid ?? "").toLowerCase();
    if (/^[0-9a-f]{64}$/u.test(txid)) {
      acceptedMintCountsByTxid.set(
        txid,
        (acceptedMintCountsByTxid.get(txid) ?? 0) + 1,
      );
    }
  }
  let confirmedSupply = existingMints
    .filter((mint) => mint.confirmed)
    .reduce((total, mint) => total + Number(mint.amount || 0), 0);
  const seenMintCountsByTxid = new Map();
  const newMints = [];

  for (const tx of tokenProtocolSortedTransactions(txs.filter(Boolean))) {
    for (const mint of confirmedWorkMintEventsFromTransaction(tx, network)) {
      const seenCountInTx = seenMintCountsByTxid.get(mint.txid) ?? 0;
      seenMintCountsByTxid.set(mint.txid, seenCountInTx + 1);
      const acceptedCount = acceptedMintCountsByTxid.get(mint.txid) ?? 0;
      if (
        seenCountInTx < acceptedCount ||
        confirmedSupply + mint.amount > WORK_TOKEN_MAX_SUPPLY
      ) {
        continue;
      }

      acceptedMintCountsByTxid.set(mint.txid, acceptedCount + 1);
      confirmedSupply += mint.amount;
      newMints.push(mint);
    }
  }

  if (newMints.length === 0) {
    return state;
  }

  const holders = new Map(
    (Array.isArray(state.holders) ? state.holders : [])
      .filter((holder) => holder?.address && Number(holder.balance) > 0)
      .map((holder) => [holder.address, Number(holder.balance)]),
  );
  for (const mint of newMints) {
    holders.set(
      mint.minterAddress,
      (holders.get(mint.minterAddress) ?? 0) + mint.amount,
    );
  }

  const mergedMints = sortWorkMintsForDisplay(
    workMintRowsWithinPendingCap([...existingMints, ...newMints]),
  );
  const mintSupplyTotals = workMintSupplyTotals(mergedMints);
  const nextState = {
    ...state,
    confirmedSupply: mintSupplyTotals.confirmedSupply,
    holders: [...holders.entries()]
      .map(([address, balance]) => ({ address, balance }))
      .sort(
        (left, right) =>
          right.balance - left.balance ||
          left.address.localeCompare(right.address),
      ),
    indexedAt: new Date().toISOString(),
    mints: mergedMints,
    pendingSupply: mintSupplyTotals.pendingSupply,
    stats: {
      ...(state.stats ?? {}),
      confirmedMints: mintSupplyTotals.confirmedMints,
      holders: holders.size,
      pendingMints: mintSupplyTotals.pendingMints,
    },
  };
  cacheLiveWorkTokenState(network, nextState);
  syncWorkTokenLiveSeenTxids(network, nextState);
  console.log(
    `Applied ${newMints.length} live WORK registry mint(s) for ${network}.`,
  );
  return nextState;
}

async function liveWorkTokenStateWithFallbackAfterMs(
  network,
  cachedWorkTokenState,
  timeoutMs = WORK_TOKEN_LIVE_WAIT_MS,
  options = {},
) {
  const fallback = workTokenStateWithMintSupplyCounters(cachedWorkTokenState);
  return payloadWithFallbackAfterMs(
    liveWorkTokenState(network, fallback, options),
    fallback,
    timeoutMs,
  );
}

async function tokenPayloadForRead(
  network,
  tokenScope = "",
  fresh = false,
  options = {},
) {
  const scope = normalizeTokenScope(tokenScope);
  const useLedgerSnapshot = options.useLedgerSnapshot !== false;
  if (network === "livenet" && useLedgerSnapshot) {
    let ledger = null;
    try {
      ledger = fresh
        ? await summaryCanonicalLedgerPayload(network, true)
        : await existingCanonicalLedgerPayload(network);
    } catch (error) {
      console.error(
        `Canonical token payload failed for ${network}:${scope}: ${errorSummary(error)}`,
      );
    }
    if (ledger) {
      let payload = attachLedgerMetadata(
        {
          ...ledgerTokenStateForScope(ledger, scope),
          indexedAt: ledger.generatedAt,
        },
        ledger,
      );
      if (scope === WORK_TOKEN_ID) {
        const liveOptions = {
          recoverClosedSales: options.recoverWorkSales !== false,
        };
        payload = Number.isFinite(options.liveWorkWaitMs)
          ? await liveWorkTokenStateWithFallbackAfterMs(
              network,
              payload,
              options.liveWorkWaitMs,
              liveOptions,
            )
          : await liveWorkTokenState(network, payload, liveOptions);
      }
      return options.reconcileSpendable === false
        ? payload
        : await tokenPayloadWithSpendableListings(payload, network);
    }
  }

  return fresh
    ? await freshTokenPayloadOrSnapshot(network, scope, options)
    : await fastTokenPayloadSnapshot(network, scope, options);
}

async function tokenSummaryPayload(network, tokenScope = "", fresh = false) {
  const scope = normalizeTokenScope(tokenScope);
  const indexAddress = tokenIndexAddressForNetwork(network);
  if (!indexAddress) {
    return {
      ...emptyTokenState(),
      creationPriceSats: TOKEN_CREATION_PRICE_SATS,
      indexedAt: new Date().toISOString(),
      indexAddress: "",
      indexId: TOKEN_INDEX_ID,
      indexTxid: TOKEN_INDEX_TXID,
      minMutationPriceSats: TOKEN_MIN_MUTATION_PRICE_SATS,
      network,
      stats: {
        confirmedMints: 0,
        confirmedTransfers: 0,
        confirmedTokens: 0,
        holders: 0,
        pendingMints: 0,
        pendingTransfers: 0,
        pendingTokens: 0,
        registries: 0,
        transactions: 0,
      },
      workDefaults: {
        maxSupply: WORK_TOKEN_MAX_SUPPLY,
        mintAmount: WORK_TOKEN_MINT_AMOUNT,
        mintPriceSats: WORK_TOKEN_MINT_PRICE_SATS,
        priceSatsPerWork: WORK_TOKEN_PRICE_SATS_PER_WORK,
        registryAddress: WORK_TOKEN_DEFAULT_REGISTRY_ADDRESS,
        ticker: WORK_TOKEN_TICKER,
        tokenId: WORK_TOKEN_ID,
      },
    };
  }

  const payload = await tokenPayloadForRead(network, scope, fresh, {
    liveWorkWaitMs: scope === WORK_TOKEN_ID ? WORK_TOKEN_LIVE_WAIT_MS : undefined,
    recoverWorkSales: scope !== WORK_TOKEN_ID,
    reconcileSpendable: false,
  });
  return compactTokenSummaryPayload(payload, scope);
}

function emptyRegistryPayload(network) {
  return {
    activity: [],
    indexedAt: new Date().toISOString(),
    listings: [],
    network,
    pendingEvents: [],
    records: [],
    registryAddress: registryAddressForNetwork(network) ?? "",
    sales: [],
    source: mempoolBase(network),
    stats: {
      confirmed: 0,
      pending: 0,
      pendingChanges: 0,
      pendingRecords: 0,
      total: 0,
    },
  };
}

function compactRegistrySummaryPayload(payload) {
  return {
    ...payload,
    activity: recentByCreatedAt(payload.activity, SUMMARY_ACTIVITY_LIMIT),
    listings: recentByCreatedAt(payload.listings, SUMMARY_MARKET_LIMIT),
    pendingEvents: recentByCreatedAt(payload.pendingEvents, SUMMARY_MARKET_LIMIT),
    sales: recentByCreatedAt(payload.sales, SUMMARY_MARKET_LIMIT),
    summaryOnly: true,
  };
}

function compactActivitySummaryPayload(payload) {
  return {
    ...payload,
    activity: recentByCreatedAt(payload.activity, SUMMARY_ACTIVITY_LIMIT),
    summaryOnly: true,
  };
}

function activityStatsFromItems(activity, baseStats = {}) {
  const dataBytes = totalProtocolDataBytes(activity);
  const fileActions = activity.filter((item) => item.kind === "file").length;
  const infinityBondActions = activity.filter(isInfinityBondActivityItem).length;
  const messageActions = activity.filter(
    (item) =>
      (item.kind === "mail" || item.kind === "reply") &&
      !isInfinityBondActivityItem(item),
  ).length;
  const tokenActions = activity.filter((item) =>
    String(item.kind).startsWith("token-"),
  ).length;
  const rushActions = activity.filter((item) =>
    String(item.kind).startsWith("rush-"),
  ).length;
  const akActions = activity.filter((item) =>
    String(item.kind).startsWith("ak-"),
  ).length;

  return {
    ...baseStats,
    ak: akActions,
    dataBytes,
    files: fileActions,
    indexedThroughBlock: indexedThroughBlockFromItems(activity),
    infinityBonds: infinityBondActions,
    messages: messageActions,
    pending: activity.filter((item) => !item.confirmed).length,
    rush: rushActions,
    tokens: tokenActions,
    total: activity.length,
  };
}

function numericValue(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function numbersAgree(left, right, tolerance = 0.000001) {
  return Math.abs(numericValue(left) - numericValue(right)) <= tolerance;
}

function sourceCollectionFingerprint(items) {
  const list = Array.isArray(items) ? items : [];
  const confirmed = list.filter((item) => item?.confirmed).length;
  const newest = list.reduce((max, item) => {
    const time = Date.parse(item?.createdAt ?? "");
    return Number.isFinite(time) ? Math.max(max, time) : max;
  }, 0);
  const sample = list
    .slice(0, 8)
    .map(
      (item) =>
        item?.txid ??
        item?.listingId ??
        item?.closedTxid ??
        item?.id ??
        "",
    )
    .filter(Boolean);

  return {
    confirmed,
    count: list.length,
    newest,
    sample,
  };
}

function ledgerSourceHashes({
  activityState,
  registryState,
  rushState,
  seededMailActivityState,
  tokenState,
  workTokenState,
}) {
  return {
    activity: sourceCollectionFingerprint(activityState?.activity),
    registry: sourceCollectionFingerprint(registryState?.activity),
    registryRecords: sourceCollectionFingerprint(registryState?.records),
    rushMints: sourceCollectionFingerprint(rushState?.mints),
    seededMail: sourceCollectionFingerprint(seededMailActivityState?.activity),
    tokenMints: sourceCollectionFingerprint(tokenState?.mints),
    tokenSales: sourceCollectionFingerprint(tokenState?.sales),
    tokens: sourceCollectionFingerprint(tokenState?.tokens),
    workMints: sourceCollectionFingerprint(workTokenState?.mints),
    workSales: sourceCollectionFingerprint(workTokenState?.sales),
  };
}

function ledgerMetricsFromState({
  activity,
  registryState,
  tokenState,
  workFloor,
}) {
  const records = registryState?.records ?? [];
  const tokenDefinitions = tokenState?.tokens ?? [];
  const tokenMints = tokenState?.mints ?? [];
  const tokenTransfers = tokenState?.transfers ?? [];
  const tokenSales = tokenState?.sales ?? [];
  const confirmedComputerActions =
    workFloor?.stats?.confirmedComputerActions ??
    confirmedComputerActionCount(
      records,
      activity,
      tokenDefinitions,
      tokenMints,
      tokenTransfers,
      tokenSales,
    );

  return {
    activityItems: Array.isArray(activity) ? activity.length : 0,
    confirmedComputerActions,
    confirmedTokenMints:
      workFloor?.stats?.confirmedTokenMints ?? confirmedItemCount(tokenMints),
    confirmedTokenSales: confirmedItemCount(tokenSales),
    confirmedTokenTransfers: confirmedItemCount(tokenTransfers),
    confirmedTokens:
      workFloor?.stats?.confirmedTokens ?? confirmedItemCount(tokenDefinitions),
    indexedThroughBlock: indexedThroughBlockFromItems(activity ?? []),
    networkValueSats: numericValue(
      workFloor?.networkValueSats ?? workFloor?.actualValue?.totalSats,
    ),
    powids: registryConfirmedCount(registryState),
  };
}

function ledgerPayloadLooksWorse(nextPayload, previousPayload) {
  if (!previousPayload?.metrics) {
    return false;
  }

  const next = nextPayload?.metrics ?? {};
  const previous = previousPayload.metrics;
  const guardedKeys = [
    "powids",
    "confirmedTokenMints",
    "confirmedTokenSales",
    "confirmedTokenTransfers",
    "confirmedTokens",
    "confirmedComputerActions",
  ];
  const hasPreviousHistory = guardedKeys.some(
    (key) => numericValue(previous[key]) > 0,
  );
  if (!hasPreviousHistory) {
    return false;
  }

  return guardedKeys.some(
    (key) => numericValue(next[key]) < numericValue(previous[key]),
  );
}

function ledgerPayloadHasCurrentChecks(payload) {
  const checkNames = new Set(
    (payload?.consistency?.checks ?? []).map((check) => check?.name),
  );
  return (
    Boolean(payload?.snapshotId) &&
    checkNames.has("livenet-confirmed-history-present") &&
    checkNames.has("token-definitions-cover-confirmed-mints") &&
    checkNames.has("token-sales-logged") &&
    checkNames.has("seeded-mail-events-logged") &&
    checkNames.has("seeded-infinity-bonds-logged")
  );
}

function ledgerPayloadAgeMs(payload, now = Date.now()) {
  const generatedAt = Date.parse(payload?.generatedAt ?? "");
  return Number.isFinite(generatedAt) ? Math.max(0, now - generatedAt) : Infinity;
}

async function existingCanonicalLedgerPayload(network) {
  const cacheKey = `ledger:${network}`;
  const payloadKey = `payload:ledger:${network}`;
  const cachedPayload = RESPONSE_CACHE.get(payloadKey)?.payload;
  if (cachedPayload && ledgerPayloadHasCurrentChecks(cachedPayload)) {
    return cachedPayload;
  }

  const persistedPayload = await persistedPayloadForCache(
    cacheKey,
    LEDGER_CACHE_STALE_MS,
  );
  if (persistedPayload && ledgerPayloadHasCurrentChecks(persistedPayload)) {
    RESPONSE_CACHE.set(payloadKey, {
      expiresAt: Date.now() - 1,
      payload: persistedPayload,
      staleUntil: Date.now() + LEDGER_CACHE_STALE_MS,
    });
    return persistedPayload;
  }

  return null;
}

function cacheDerivedLedgerPayload(cacheKey, payload, ttlMs, staleMs) {
  const payloadKey = `payload:${cacheKey}`;
  const body = JSON.stringify(payload);
  RESPONSE_CACHE.set(payloadKey, {
    expiresAt: Date.now() + ttlMs,
    payload,
    staleUntil: Date.now() + staleMs,
  });
  cacheJsonBody(`json:${cacheKey}`, body, ttlMs, staleMs);
  if (shouldPersistJsonCache(cacheKey)) {
    void writePersistedJsonCache(`json:${cacheKey}`, body);
  }
}

function cacheCanonicalLedgerPayload(network, payload) {
  const cacheKey = `ledger:${network}`;
  const payloadKey = `payload:${cacheKey}`;
  const body = JSON.stringify(payload);
  RESPONSE_CACHE.set(payloadKey, {
    expiresAt: Date.now() + LEDGER_CACHE_TTL_MS,
    payload,
    staleUntil: Date.now() + LEDGER_CACHE_STALE_MS,
  });
  cacheJsonBody(
    `json:${cacheKey}`,
    body,
    LEDGER_CACHE_TTL_MS,
    LEDGER_CACHE_STALE_MS,
  );
  if (shouldPersistJsonCache(cacheKey)) {
    void writePersistedJsonCache(`json:${cacheKey}`, body);
  }

  if (payload?.workFloor) {
    cacheDerivedLedgerPayload(
      `work-floor:${network}`,
      payload.workFloor,
      WORK_FLOOR_CACHE_TTL_MS,
      WORK_FLOOR_CACHE_STALE_MS,
    );
  }
  if (payload?.growthSummary) {
    cacheDerivedLedgerPayload(
      `growth-summary:${network}`,
      payload.growthSummary,
      LEDGER_CACHE_TTL_MS,
      HEAVY_READ_STALE_MS,
    );
  }
}

function ledgerTokenStateForScope(ledger, scope) {
  if (!scope) {
    return ledger.tokenState;
  }

  if (scope === WORK_TOKEN_ID && ledger.workTokenState) {
    return ledger.workTokenState;
  }

  const tokenState = ledger.tokenState ?? emptyTokenPayloadSnapshot(ledger.network);
  return scopedTokenPayloadFromState(tokenState, scope);
}

function ledgerSnapshotChecks({
  activity,
  growthSummary,
  metrics,
  network,
  seededMailActivityState,
  tokenState,
  workFloor,
}) {
  const checks = [];
  const missingLogEvents = [];
  const addCheck = (name, ok, details = {}) => {
    checks.push({ details, name, ok });
  };

  addCheck(
    "livenet-confirmed-history-present",
    network !== "livenet" ||
      numericValue(metrics?.powids) > 0 ||
      numericValue(metrics?.confirmedTokens) > 0 ||
      numericValue(metrics?.activityItems) > 0,
    {
      activityItems: numericValue(metrics?.activityItems),
      confirmedTokens: numericValue(metrics?.confirmedTokens),
      powids: numericValue(metrics?.powids),
    },
  );
  addCheck(
    "token-definitions-cover-confirmed-mints",
    numericValue(metrics?.confirmedTokenMints) === 0 ||
      numericValue(metrics?.confirmedTokens) > 0,
    {
      confirmedTokenMints: numericValue(metrics?.confirmedTokenMints),
      confirmedTokens: numericValue(metrics?.confirmedTokens),
    },
  );

  const workNetworkValue = numericValue(workFloor?.networkValueSats);
  const workActualValue = numericValue(workFloor?.actualValue?.totalSats);
  const growthActualValue = numericValue(growthSummary?.actualValue?.totalSats);
  const growthFloorValue = numericValue(
    growthSummary?.workFloor?.networkValueSats,
  );
  addCheck("work-floor-actual-total", numbersAgree(workNetworkValue, workActualValue), {
    actualValueSats: workActualValue,
    networkValueSats: workNetworkValue,
  });
  addCheck("growth-actual-total", numbersAgree(workNetworkValue, growthActualValue), {
    growthValueSats: growthActualValue,
    workValueSats: workNetworkValue,
  });
  addCheck("growth-work-floor-total", numbersAgree(workNetworkValue, growthFloorValue), {
    growthWorkFloorSats: growthFloorValue,
    workValueSats: workNetworkValue,
  });

  const activityByTxidKind = new Map();
  for (const item of activity ?? []) {
    if (!item?.txid || !item?.kind) {
      continue;
    }
    activityByTxidKind.set(`${item.kind}:${item.txid}`, item);
  }

  for (const sale of tokenState?.sales ?? []) {
    if (!sale?.confirmed || !sale?.txid) {
      continue;
    }
    const item = activityByTxidKind.get(`token-sale:${sale.txid}`);
    const participants = new Set(
      Array.isArray(item?.participants) ? item.participants : [],
    );
    const participantOk = [
      sale.buyerAddress,
      sale.sellerAddress,
      sale.registryAddress,
    ]
      .filter(Boolean)
      .every((address) => participants.has(address));
    if (!item || !participantOk) {
      missingLogEvents.push({
        kind: "token-sale",
        txid: sale.txid,
        tokenId: sale.tokenId,
      });
    }
  }

  for (const listing of tokenState?.closedListings ?? []) {
    const closedTxid = listing?.closedTxid || listing?.listingId;
    if (!listing?.closedConfirmed || !closedTxid) {
      continue;
    }
    if (!activityByTxidKind.has(`token-listing-closed:${closedTxid}`)) {
      missingLogEvents.push({
        kind: "token-listing-closed",
        txid: closedTxid,
        tokenId: listing.tokenId,
      });
    }
  }

  addCheck("token-sales-logged", missingLogEvents.length === 0, {
    missing: missingLogEvents.length,
  });

  const seededConfirmedMail = (seededMailActivityState?.activity ?? []).filter(
    (item) => item?.confirmed && item?.txid && item?.kind,
  );
  const missingSeededMailEvents = [];
  const missingSeededInfinityBondEvents = [];
  for (const item of seededConfirmedMail) {
    if (!activityByTxidKind.has(`${item.kind}:${item.txid}`)) {
      const missing = {
        amountSats: activityAmountSats(item),
        kind: item.kind,
        txid: item.txid,
      };
      missingSeededMailEvents.push(missing);
      missingLogEvents.push(missing);
      if (isInfinityBondActivityItem(item)) {
        missingSeededInfinityBondEvents.push(missing);
      }
    }
  }
  const seededInfinityBondFlowSats = seededConfirmedMail
    .filter(isInfinityBondActivityItem)
    .reduce((total, item) => total + activityAmountSats(item), 0);
  const loggedInfinityBondFlowSats = (activity ?? [])
    .filter((item) => item?.confirmed && isInfinityBondActivityItem(item))
    .reduce((total, item) => total + activityAmountSats(item), 0);
  addCheck("seeded-mail-events-logged", missingSeededMailEvents.length === 0, {
    missing: missingSeededMailEvents.length,
    seeded: seededConfirmedMail.length,
  });
  addCheck(
    "seeded-infinity-bonds-logged",
    missingSeededInfinityBondEvents.length === 0 &&
      loggedInfinityBondFlowSats >= seededInfinityBondFlowSats,
    {
      loggedFlowSats: loggedInfinityBondFlowSats,
      missing: missingSeededInfinityBondEvents.length,
      seeded: seededConfirmedMail.filter(isInfinityBondActivityItem).length,
      seededFlowSats: seededInfinityBondFlowSats,
    },
  );

  const ok = checks.every((check) => check.ok);
  return {
    checks,
    missingLogEvents,
    ok,
    status: ok ? "green" : "red",
  };
}

function attachLedgerMetadata(payload, ledger) {
  return {
    ...payload,
    consistency: ledger.consistency,
    indexedThroughBlock: ledger.metrics.indexedThroughBlock,
    ledgerGeneratedAt: ledger.generatedAt,
    snapshotId: ledger.snapshotId,
  };
}

function growthSummaryPayloadFromLedger(ledger) {
  const {
    activity,
    activityPayload,
    registryState,
    tokenState,
    workFloor,
  } = ledger;
  const registrySummary = compactRegistrySummaryPayload(registryState);
  const activitySummary = compactActivitySummaryPayload(activityPayload);
  const tokenSummary = compactTokenSummaryPayload(tokenState);
  const registry = {
    ...registrySummary,
    activity: [],
    listings: [],
    pendingEvents: [],
    records: [],
    sales: [],
  };
  const compactActivity = {
    ...activitySummary,
    activity: [],
  };
  const token = {
    ...tokenSummary,
    holders: [],
    listings: [],
    sales: [],
    tokens: [],
  };
  const tokenMints = tokenState.mints ?? [];
  const tokenTransfers = tokenState.transfers ?? [];
  const tokenSales = Array.isArray(tokenState.sales) ? tokenState.sales : [];
  const actualValue = workFloor.actualValue;
  const marketplaceStats = marketplaceStatsFromSales(registryState.sales ?? []);
  const confirmedActivity = activity.filter((item) => item.confirmed);
  const events = growthRealEventItems(
    registryState.records ?? [],
    activity,
    registryState.sales ?? [],
    tokenState.tokens ?? [],
    tokenMints,
    tokenTransfers,
    tokenSales,
  ).slice(0, SUMMARY_ACTIVITY_LIMIT);
  const confirmedTokenSales = tokenSales.filter((sale) => sale.confirmed).length;

  return {
    actualValue,
    activity: compactActivity,
    btcUsd: workFloor.btcUsd,
    btcUsdIndexedAt: workFloor.btcUsdIndexedAt,
    counts: {
      browserActions: confirmedActivity.filter(isBrowserActivityItem).length,
      confirmedComputerActions: ledger.metrics.confirmedComputerActions,
      confirmedTokenDefinitions: (tokenState.tokens ?? []).filter(
        (item) => item.confirmed,
      ).length,
      confirmedTokenMints: ledger.metrics.confirmedTokenMints,
      confirmedTokenSales,
      confirmedTokenTransfers: tokenTransfers.filter((item) => item.confirmed)
        .length,
      driveActions: confirmedActivity.filter(
        (item) => item.kind === "file" && !isBrowserActivityItem(item),
      ).length,
      idListings: (registryState.listings ?? []).length,
      infinityBondActions: confirmedActivity.filter(isInfinityBondActivityItem)
        .length,
      mailActions: confirmedActivity.filter(
        (item) =>
          (item.kind === "mail" || item.kind === "reply") &&
          !isInfinityBondActivityItem(item),
      ).length,
      marketplaceSaleCount: marketplaceStats.confirmedSales + confirmedTokenSales,
      pendingRecords: (registryState.records ?? []).filter(
        (record) => !record.confirmed,
      ).length,
      powids: actualValue.powids,
      tokenCount: (tokenState.tokens ?? []).length,
    },
    events,
    indexedAt: ledger.generatedAt,
    network: ledger.network,
    registry,
    summaryOnly: true,
    token,
    usdSource: workFloor.usdSource,
    usdSourceUrl: workFloor.usdSourceUrl,
    workFloor,
  };
}

function ledgerConsistencyPayloadFromLedger(ledger) {
  const growthSummary = ledger.growthSummary;
  return {
    checks: ledger.consistency.checks,
    generatedAt: ledger.generatedAt,
    indexedThroughBlock: ledger.metrics.indexedThroughBlock,
    metrics: ledger.metrics,
    missingLogEvents: ledger.consistency.missingLogEvents,
    network: ledger.network,
    ok: ledger.consistency.ok,
    snapshotId: ledger.snapshotId,
    sourceHashes: ledger.sourceHashes,
    status: ledger.consistency.status,
    totals: {
      growthActualValueSats: numericValue(growthSummary?.actualValue?.totalSats),
      growthWorkFloorValueSats: numericValue(
        growthSummary?.workFloor?.networkValueSats,
      ),
      workActualValueSats: numericValue(
        ledger.workFloor?.actualValue?.totalSats,
      ),
      workNetworkValueSats: numericValue(ledger.workFloor?.networkValueSats),
    },
  };
}

async function ledgerConsistencyPayload(network, fresh = false) {
  const ledger = await summaryCanonicalLedgerPayload(network, fresh);
  if (ledger) {
    return ledgerConsistencyPayloadFromLedger(ledger);
  }

  return ledgerConsistencyPayloadFromLedger(
    await canonicalLedgerPayload(network, false),
  );
}

async function ledgerTokenPayload(network, tokenScope = "", fresh = false) {
  const scope = normalizeTokenScope(tokenScope);
  let fallback = await fastTokenPayloadSnapshot(network, scope, {
    reconcileSpendable: false,
  });
  if (scope === WORK_TOKEN_ID) {
    fallback = await liveWorkTokenStateWithFallbackAfterMs(
      network,
      fallback,
      WORK_TOKEN_LIVE_WAIT_MS,
      { recoverClosedSales: false },
    );
  }
  if (!fresh || !ENABLE_SUMMARY_TOKEN_REFRESH) {
    return fallback;
  }

  return payloadWithFallbackAfterMs(
    refreshTokenPayload(network, scope),
    fallback,
    WORK_FLOOR_FRESH_WAIT_MS,
  );
}

async function buildCanonicalLedgerPayload(network, fresh = false) {
  const emptyRegistryState = emptyRegistryPayload(network);
  const [
    activityState,
    registryState,
    tokenState,
    workTokenState,
    rushState,
    btcUsdQuote,
  ] = await Promise.all([
    fresh && ENABLE_GLOBAL_ACTIVITY_CRAWL
      ? globalActivityPayload(network, true)
      : cachedGlobalActivityPayloadNoRefresh(network),
    fresh
      ? safeRegistryPayload(network)
      : fastJsonBackedPayload(
          `registry:${network}`,
          `payload:registry:${network}`,
          () => safeRegistryPayload(network),
          REGISTRY_CACHE_TTL_MS,
          REGISTRY_CACHE_STALE_MS,
          emptyRegistryState,
        ),
    ledgerTokenPayload(network, "", fresh),
    ledgerTokenPayload(network, WORK_TOKEN_ID, fresh),
    (fresh ? rushPayload(network) : cachedRushPayload(network)).catch(() => null),
    network === "livenet"
      ? btcUsdPricePayload(network, { fresh })
      : Promise.resolve(null),
  ]);

  const valueTokenState = tokenStateWithScopedTokenOverride(
    tokenState,
    workTokenState,
    WORK_TOKEN_ID,
  );
  const seededMailActivityState = await seededMailActivityPayload(
    network,
    canonicalMailSeedAddresses({
      activityState,
      network,
      registryState,
      tokenState: valueTokenState,
      workTokenState,
    }),
  );
  const activity = dedupeActivityItems([
    ...(Array.isArray(activityState?.activity) ? activityState.activity : []),
    ...(Array.isArray(seededMailActivityState?.activity)
      ? seededMailActivityState.activity
      : []),
    ...(Array.isArray(registryState?.activity) ? registryState.activity : []),
    ...tokenActivityItemsFromState(
      valueTokenState,
      valueTokenState?.indexAddress ?? "",
    ),
    ...(rushState ? rushActivityItemsFromState(rushState) : []),
  ]);
  const activityPayload = {
    activity,
    indexedAt: new Date().toISOString(),
    network,
    source: activityState?.source ?? mempoolBase(network),
    stats: activityStatsFromItems(activity, {
      addresses: Math.max(
        numericValue(activityState?.stats?.addresses),
        numericValue(seededMailActivityState?.stats?.addresses),
      ),
      registry: Array.isArray(registryState?.activity)
        ? registryState.activity.length
        : undefined,
      seededMail: seededMailActivityState?.stats?.total,
    }),
  };
  const workFloor = workFloorPayloadFromState(
    network,
    registryState,
    activityPayload,
    valueTokenState,
    {},
    { btcUsdQuote },
  );
  const metrics = ledgerMetricsFromState({
    activity,
    registryState,
    tokenState: valueTokenState,
    workFloor,
  });
  const sourceHashes = ledgerSourceHashes({
    activityState,
    registryState,
    rushState,
    seededMailActivityState,
    tokenState,
    workTokenState,
  });
  const snapshotId = sha256Hex(
    Buffer.from(
      JSON.stringify({
        metrics,
        network,
        sourceHashes,
      }),
    ),
  ).slice(0, 24);
  const ledger = {
    activity,
    activityPayload,
    generatedAt: new Date().toISOString(),
    metrics,
    network,
    registryState,
    rushState,
    seededMailActivityState,
    snapshotId,
    sourceHashes,
    tokenState: valueTokenState,
    workFloor,
    workTokenState,
  };
  const growthSummary = growthSummaryPayloadFromLedger(ledger);
  const consistency = ledgerSnapshotChecks({
    activity,
    growthSummary,
    metrics,
    network,
    seededMailActivityState,
    tokenState: valueTokenState,
    workFloor,
  });

  return {
    ...ledger,
    activityPayload: attachLedgerMetadata(activityPayload, {
      ...ledger,
      consistency,
    }),
    consistency,
    growthSummary: attachLedgerMetadata(growthSummary, {
      ...ledger,
      consistency,
    }),
    workFloor: attachLedgerMetadata(workFloor, {
      ...ledger,
      consistency,
    }),
  };
}

async function refreshCanonicalLedgerPayload(network, fresh = false) {
  const previous = await existingCanonicalLedgerPayload(network);
  const next = await buildCanonicalLedgerPayload(network, fresh);
  const payload = ledgerPayloadLooksWorse(next, previous) ? previous : next;

  if (payload === previous) {
    console.error(
      `Rejected ledger payload regression for ${network}: ${JSON.stringify(next.metrics)} < ${JSON.stringify(previous.metrics)}.`,
    );
  }

  cacheCanonicalLedgerPayload(network, payload);
  return payload;
}

async function canonicalLedgerPayload(network, fresh = false) {
  const cacheKey = `ledger:${network}`;
  const payloadKey = `payload:${cacheKey}`;
  let cached = RESPONSE_CACHE.get(payloadKey);
  const now = Date.now();
  if (cached?.payload && !ledgerPayloadHasCurrentChecks(cached.payload)) {
    RESPONSE_CACHE.delete(payloadKey);
    cached = null;
  }
  if (!cached?.payload) {
    const persistedPayload = await existingCanonicalLedgerPayload(network);
    if (persistedPayload) {
      cached = RESPONSE_CACHE.get(payloadKey);
    }
  }
  if (fresh) {
    if (
      cached?.payload &&
      ledgerPayloadAgeMs(cached.payload, now) < LEDGER_FRESH_MIN_INTERVAL_MS
    ) {
      return cached.payload;
    }
    if (cached?.promise) {
      return cached.promise;
    }
    const promise = refreshCanonicalLedgerPayload(network, true).finally(() => {
      const current = RESPONSE_CACHE.get(payloadKey);
      if (current?.promise === promise) {
        RESPONSE_CACHE.set(payloadKey, { ...current, promise: null });
      }
    });
    RESPONSE_CACHE.set(payloadKey, {
      expiresAt: cached?.expiresAt ?? Date.now(),
      payload: cached?.payload,
      promise,
      staleUntil: cached?.staleUntil ?? Date.now() + LEDGER_CACHE_STALE_MS,
    });
    return promise;
  }

  if (cached?.payload && now < cached.expiresAt) {
    return cached.payload;
  }
  if (cached?.payload && now < cached.staleUntil) {
    return cached.payload;
  }
  if (cached?.promise) {
    return cached.promise;
  }

  const promise = refreshCanonicalLedgerPayload(network, false).finally(() => {
    const current = RESPONSE_CACHE.get(payloadKey);
    if (current?.promise === promise) {
      RESPONSE_CACHE.set(payloadKey, { ...current, promise: null });
    }
  });
  RESPONSE_CACHE.set(payloadKey, {
    expiresAt: now,
    promise,
    staleUntil: now + LEDGER_CACHE_STALE_MS,
  });
  return promise;
}

function refreshCanonicalLedgerPayloadInBackground(network, fresh = false) {
  const cacheKey = `ledger:${network}`;
  if (BACKGROUND_LEDGER_REFRESHES.has(cacheKey)) {
    return;
  }
  if (
    backgroundRefreshRecentlyStarted(
      cacheKey,
      BACKGROUND_DERIVED_REFRESH_INTERVAL_MS,
    )
  ) {
    return;
  }

  BACKGROUND_LEDGER_REFRESHES.add(cacheKey);
  void refreshCanonicalLedgerPayload(network, fresh)
    .catch((error) => {
      console.error(
        `Ledger refresh failed for ${network}: ${errorSummary(error)}`,
      );
    })
    .finally(() => {
      BACKGROUND_LEDGER_REFRESHES.delete(cacheKey);
    });
}

async function summaryCanonicalLedgerPayload(network, fresh = false) {
  const fallback = await existingCanonicalLedgerPayload(network);
  if (fresh) {
    refreshCanonicalLedgerPayloadInBackground(network, true);
    return fallback;
  }

  if (fallback) {
    return fallback;
  }

  refreshCanonicalLedgerPayloadInBackground(network, false);
  return null;
}

async function mergedLogActivityPayload(network, fresh = false) {
  const ledger = await summaryCanonicalLedgerPayload(network, fresh);
  if (ledger) {
    return ledger.activityPayload;
  }

  return (await canonicalLedgerPayload(network, false)).activityPayload;
}

async function registrySummaryPayload(network, fresh = false) {
  const payload = fresh
    ? await safeRegistryPayload(network)
    : await fastJsonBackedPayload(
        `registry:${network}`,
        `payload:registry:${network}`,
        () => safeRegistryPayload(network),
        REGISTRY_CACHE_TTL_MS,
        REGISTRY_CACHE_STALE_MS,
        emptyRegistryPayload(network),
      );
  return compactRegistrySummaryPayload(payload);
}

async function activitySummaryPayload(network, fresh = false) {
  const payload = await mergedLogActivityPayload(network, fresh);
  return compactActivitySummaryPayload(payload);
}

function payloadWithFallbackAfterMs(promise, fallbackPayload, timeoutMs) {
  let timer;
  return Promise.race([
    promise.catch((error) => {
      console.error(`Fresh payload refresh failed: ${errorSummary(error)}`);
      return fallbackPayload;
    }),
    new Promise((resolve) => {
      timer = setTimeout(() => resolve(fallbackPayload), timeoutMs);
    }),
  ]).finally(() => clearTimeout(timer));
}

async function freshTokenPayloadOrSnapshot(
  network,
  tokenScope = "",
  options = {},
) {
  const scope = normalizeTokenScope(tokenScope);
  const fallback = await fastTokenPayloadSnapshot(network, scope, options);
  if (!ENABLE_SUMMARY_TOKEN_REFRESH) {
    return fallback;
  }

  if (scope === WORK_TOKEN_ID) {
    return payloadWithFallbackAfterMs(
      refreshTokenPayload(network, scope),
      fallback,
      WORK_FLOOR_FRESH_WAIT_MS,
    );
  }

  refreshTokenPayloadCacheInBackground(network, scope);
  return fallback;
}

async function cachedWorkFloorSnapshotNoRefresh(network) {
  const cacheKey = `work-floor:${network}`;
  const payloadKey = `payload:${cacheKey}`;
  const cachedPayload = RESPONSE_CACHE.get(payloadKey)?.payload;
  if (cachedPayload) {
    return cachedPayload;
  }

  const persistedPayload = await persistedPayloadForCache(
    cacheKey,
    WORK_FLOOR_CACHE_STALE_MS,
  );
  if (persistedPayload) {
    RESPONSE_CACHE.set(payloadKey, {
      expiresAt: Date.now() - 1,
      payload: persistedPayload,
      staleUntil: Date.now() + WORK_FLOOR_CACHE_STALE_MS,
    });
    return persistedPayload;
  }

  return null;
}

async function cachedWorkFloorPayload(network, fresh = false) {
  if (network === "livenet") {
    const ledger = fresh
      ? await summaryCanonicalLedgerPayload(network, true)
      : await existingCanonicalLedgerPayload(network);
    if (ledger?.workFloor) {
      return ledger.workFloor;
    }

    const cachedFloor = await cachedWorkFloorSnapshotNoRefresh(network);
    if (cachedFloor) {
      return cachedFloor;
    }
  }

  return workFloorPayload(network, false);
}

async function workSummaryPayload(network, fresh = false) {
  if (network === "livenet") {
    const ledger = fresh
      ? await summaryCanonicalLedgerPayload(network, true)
      : await existingCanonicalLedgerPayload(network);
    if (ledger) {
      const workTokenState = await liveWorkTokenStateWithFallbackAfterMs(
        network,
        ledgerTokenStateForScope(ledger, WORK_TOKEN_ID),
        WORK_TOKEN_LIVE_WAIT_MS,
        { recoverClosedSales: false },
      );
      return attachLedgerMetadata(
        {
          floor: ledger.workFloor,
          indexedAt: ledger.generatedAt,
          network,
          summaryOnly: true,
          token: attachLedgerMetadata(
            compactTokenSummaryPayload(workTokenState, WORK_TOKEN_ID),
            ledger,
          ),
        },
        ledger,
      );
    }

    const [floor, token] = await Promise.all([
      cachedWorkFloorPayload(network, false),
      tokenSummaryPayload(network, WORK_TOKEN_ID, false),
    ]);
    return {
      floor,
      indexedAt: floor.indexedAt ?? token.indexedAt ?? new Date().toISOString(),
      network,
      summaryOnly: true,
      token,
    };
  }

  const [token, floor] = await Promise.all([
    tokenSummaryPayload(network, WORK_TOKEN_ID, fresh),
    fresh
      ? cachedWorkFloorPayload(network, true)
      : cachedWorkFloorPayload(network, false),
  ]);
  return {
    floor,
    indexedAt: new Date().toISOString(),
    network,
    summaryOnly: true,
    token,
  };
}

async function marketplaceSummaryPayload(network, fresh = false) {
  if (network === "livenet") {
    const ledger = fresh
      ? await summaryCanonicalLedgerPayload(network, true)
      : await existingCanonicalLedgerPayload(network);
    if (ledger) {
      const tokenState = await tokenStateWithReconciledListingSeals(
        ledger.tokenState,
        network,
      );
      return attachLedgerMetadata(
        {
          indexedAt: ledger.generatedAt,
          network,
          registry: compactRegistrySummaryPayload(ledger.registryState),
          summaryOnly: true,
          token: attachLedgerMetadata(
            compactTokenSummaryPayload(tokenState),
            ledger,
          ),
          workFloor: ledger.workFloor,
        },
        ledger,
      );
    }

    const [registry, token, workFloor] = await Promise.all([
      registrySummaryPayload(network, false),
      tokenSummaryPayload(network, "", false),
      cachedWorkFloorPayload(network, false),
    ]);
    return {
      indexedAt:
        workFloor.indexedAt ??
        token.indexedAt ??
        registry.indexedAt ??
        new Date().toISOString(),
      network,
      registry,
      summaryOnly: true,
      token,
      workFloor,
    };
  }

  if (fresh) {
    refreshPayloadCacheInBackground(
      `registry:${network}`,
      `payload:registry:${network}`,
      () => safeRegistryPayload(network),
      REGISTRY_CACHE_TTL_MS,
      REGISTRY_CACHE_STALE_MS,
    );
  }

  const [registry, token, floor] = await Promise.all([
    registrySummaryPayload(network, false),
    tokenSummaryPayload(network, "", fresh),
    fresh
      ? cachedWorkFloorPayload(network, true)
      : cachedWorkFloorPayload(network, false),
  ]);
  return {
    indexedAt: new Date().toISOString(),
    network,
    registry,
    summaryOnly: true,
    token,
    workFloor: floor,
  };
}

function refreshGrowthCachesInBackground(network) {
  refreshCanonicalLedgerPayloadInBackground(network, true);
}

async function growthSummaryPayload(network, fresh = false) {
  const ledger = await summaryCanonicalLedgerPayload(network, fresh);
  if (ledger) {
    return ledger.growthSummary;
  }

  return (await canonicalLedgerPayload(network, false)).growthSummary;
}

async function registryHistoryPayload(network, kind, searchParams, fresh = false) {
  const payload = fresh
    ? await safeRegistryPayload(network)
    : await fastJsonBackedPayload(
        `registry:${network}`,
        `payload:registry:${network}`,
        () => safeRegistryPayload(network),
        REGISTRY_CACHE_TTL_MS,
        REGISTRY_CACHE_STALE_MS,
        emptyRegistryPayload(network),
      );
  const safeKind = new Set([
    "activity",
    "listings",
    "pending",
    "records",
    "sales",
  ]).has(kind)
    ? kind
    : "records";
  const items =
    safeKind === "pending"
      ? (payload.pendingEvents ?? [])
      : (payload[safeKind] ?? []);

  return paginatedHistoryPayload({
    indexedAt: payload.indexedAt ?? new Date().toISOString(),
    items,
    kind: safeKind,
    network,
    pagination: historyPaginationFromSearch(searchParams),
    source: payload.source ?? mempoolBase(network),
  });
}

async function mailActivityItemsForAddressSearch(address, network) {
  return cachedPayload(
    `direct-mail-activity:${network}:${address}`,
    async () => {
      const txs = await fetchAddressTransactions(address, network);
      return mailActivityItemsFromTransactions(txs, network);
    },
    ACTIVITY_CACHE_TTL_MS,
    ACTIVITY_CACHE_STALE_MS,
  );
}

async function activityHistoryPayload(network, kind, searchParams, fresh = false) {
  const payload = await mergedLogActivityPayload(network, fresh);
  const rawQuery = String(
    searchParams.get("q") ?? searchParams.get("search") ?? "",
  ).trim();
  const directMailActivity =
    rawQuery && isValidBitcoinAddress(rawQuery, network)
      ? await mailActivityItemsForAddressSearch(rawQuery, network).catch(
          (error) => {
            console.error(
              `Direct log mail lookup failed for ${rawQuery}: ${errorSummary(error)}`,
            );
            return [];
          },
        )
      : [];
  const activity = dedupeActivityItems([
    ...(payload.activity ?? []),
    ...directMailActivity,
  ]);
  const requestedKind = String(kind ?? "").trim();
  const items = requestedKind
    ? activity.filter((item) => item.kind === requestedKind)
    : activity;

  const page = paginatedHistoryPayload({
    indexedAt: payload.indexedAt ?? new Date().toISOString(),
    items,
    kind: requestedKind || "activity",
    network,
    pagination: historyPaginationFromSearch(searchParams),
    source: payload.source ?? mempoolBase(network),
  });
  return payload.snapshotId
    ? {
        ...page,
        consistency: payload.consistency,
        ledgerGeneratedAt: payload.ledgerGeneratedAt,
        snapshotId: payload.snapshotId,
      }
    : page;
}

async function tokenHistoryPayload(network, tokenScope, kind, searchParams, fresh = false) {
  const scope = normalizeTokenScope(tokenScope);
  let payload = await tokenPayloadForRead(network, scope, fresh, {
    reconcileSpendable: false,
  });
  const kindMap = new Map([
    ["holders", "holders"],
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
  const safeKind = kindMap.get(kind) ?? "mints";
  if (
    safeKind === "listings" ||
    safeKind === "closedListings" ||
    safeKind === "market-log"
  ) {
    payload = await tokenStateWithReconciledListingSeals(payload, network);
  }
  const items =
    safeKind === "market-log"
      ? tokenMarketLogItemsFromState(payload)
      : (payload[safeKind] ?? []);

  const page = paginatedHistoryPayload({
    indexedAt: payload.indexedAt ?? new Date().toISOString(),
    items,
    kind: safeKind,
    network,
    pagination: historyPaginationFromSearch(searchParams),
    source: payload.source ?? mempoolBase(network),
  });
  return payload.snapshotId
    ? {
        ...page,
        consistency: payload.consistency,
        ledgerGeneratedAt: payload.ledgerGeneratedAt,
        snapshotId: payload.snapshotId,
      }
    : page;
}

async function rushPayload(network) {
  const registryAddress = RUSH_REGISTRY_ADDRESSES[network] ?? "";
  if (!registryAddress) {
    return emptyRushState(network);
  }

  const txs = await fetchRegistryTransactions(registryAddress, network);
  return {
    ...rushStateFromTransactions(txs, registryAddress, network),
    source: mempoolBase(network),
    transactions: txs.length,
  };
}

function growthElapsedYears() {
  return Math.max(0, (Date.now() - GROWTH_MODEL_START_MS) / MS_PER_MODEL_YEAR);
}

function growthBtcUsdAtYears(years) {
  const mu =
    Math.log(
      GROWTH_MODEL_INPUTS.currentBtcUsd / GROWTH_MODEL_INPUTS.historicalBtcUsd,
    ) / GROWTH_MODEL_INPUTS.btcBenchmarkYears;
  return GROWTH_MODEL_INPUTS.currentBtcUsd * Math.exp(mu * Math.max(0, years));
}

function growthSatsToUsdAtYears(sats, years) {
  return (sats / 100_000_000) * growthBtcUsdAtYears(years);
}

function satsToUsdAtBtcUsd(sats, btcUsd) {
  return (sats / 100_000_000) * btcUsd;
}

function btcUsdFromQuote(quote) {
  const usd = Number(quote?.usd ?? quote?.USD);
  return Number.isFinite(usd) && usd > 0 ? usd : 0;
}

function btcUsdResponseMetadata(quote) {
  const btcUsd = btcUsdFromQuote(quote);
  const metadata = {
    btcUsd,
    btcUsdIndexedAt: quote?.priceIndexedAt,
    usdSource: quote?.source,
    usdSourceUrl: quote?.sourceUrl,
  };
  if (quote?.sourceError) {
    metadata.usdSourceError = quote.sourceError;
  }
  return metadata;
}

function isBrowserActivityItem(item) {
  const tags = Array.isArray(item.tags) ? item.tags : [];
  const searchText = [
    item.title,
    item.detail,
    item.description,
    ...tags,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
  const hasHtmlAttachment =
    searchText.includes("text/html") ||
    searchText.includes("application/xhtml+xml") ||
    /\.x?html?\b/u.test(searchText);
  const hasHtmlBody =
    tags.some((tag) => String(tag).toLowerCase() === "html body") ||
    isBrowserHtmlMessageBody(item.detail ?? "");

  if (item.kind === "file") {
    return hasHtmlAttachment;
  }

  if (item.kind === "mail" || item.kind === "reply") {
    return hasHtmlBody;
  }

  return false;
}

function activityAmountSats(item) {
  const amount = Number(item?.amountSats ?? 0);
  return Number.isFinite(amount) && amount > 0 ? amount : 0;
}

function activityKindHasDedicatedGrowthBucket(item) {
  if (isBrowserActivityItem(item) || isInfinityBondActivityItem(item)) {
    return true;
  }

  return (
    item.kind === "mail" ||
    item.kind === "reply" ||
    item.kind === "file" ||
    item.kind === "token-create" ||
    item.kind === "token-mint" ||
    item.kind === "token-transfer" ||
    item.kind === "token-sale"
  );
}

function unbucketedConfirmedComputerLogFlowSats(confirmedActivity) {
  return confirmedActivity
    .filter((item) => !activityKindHasDedicatedGrowthBucket(item))
    .reduce((total, item) => total + activityAmountSats(item), 0);
}

function confirmedActivityFlowSats(confirmedActivity, kinds) {
  return confirmedActivity
    .filter((item) => kinds.has(item.kind))
    .reduce((total, item) => total + activityAmountSats(item), 0);
}

function tokenStateWithScopedTokenOverride(tokenState, scopedState, tokenId) {
  if (!scopedState || !tokenId) {
    return tokenState;
  }

  const scopedTokens = Array.isArray(scopedState.tokens)
    ? scopedState.tokens.filter((item) => item.tokenId === tokenId)
    : [];
  if (scopedTokens.length === 0) {
    return tokenState;
  }

  const replaceScopedItems = (globalItems, scopedItems) => [
    ...(Array.isArray(globalItems)
      ? globalItems.filter((item) => item.tokenId !== tokenId)
      : []),
    ...(Array.isArray(scopedItems)
      ? scopedItems.filter((item) => item.tokenId === tokenId)
      : []),
  ];

  return {
    ...tokenState,
    closedListings: replaceScopedItems(
      tokenState?.closedListings,
      scopedState.closedListings,
    ),
    listings: replaceScopedItems(tokenState?.listings, scopedState.listings),
    mints: replaceScopedItems(tokenState?.mints, scopedState.mints),
    sales: replaceScopedItems(tokenState?.sales, scopedState.sales),
    tokens: replaceScopedItems(tokenState?.tokens, scopedState.tokens),
    transfers: replaceScopedItems(tokenState?.transfers, scopedState.transfers),
  };
}

function growthActualNetworkValue(
  records,
  idActivity,
  sales,
  tokenDefinitions,
  tokenMints,
  tokenTransfers = [],
  tokenSales = [],
  cutoffMs = Date.now(),
) {
  const confirmedRecords = records.filter(
    (record) => record.confirmed && Date.parse(record.createdAt) <= cutoffMs,
  );
  const confirmedActivity = idActivity.filter(
    (item) => item.confirmed && Date.parse(item.createdAt) <= cutoffMs,
  );
  const confirmedSales = publicMarketplaceSales(sales).filter(
    (sale) => sale.confirmed && Date.parse(sale.createdAt) <= cutoffMs,
  );
  const confirmedTokens = tokenDefinitions.filter(
    (token) => token.confirmed && Date.parse(token.createdAt) <= cutoffMs,
  );
  const confirmedTokenMints = tokenMints.filter(
    (mint) => mint.confirmed && Date.parse(mint.createdAt) <= cutoffMs,
  );
  const confirmedTokenTransfers = tokenTransfers.filter(
    (transfer) =>
      transfer.confirmed && Date.parse(transfer.createdAt) <= cutoffMs,
  );
  const confirmedTokenSales = tokenSales.filter(
    (sale) => sale.confirmed && Date.parse(sale.createdAt) <= cutoffMs,
  );
  const powids = confirmedRecords.length;
  const mailFlowSats = confirmedActivity
    .filter(
      (item) =>
        (item.kind === "mail" || item.kind === "reply") &&
        !isInfinityBondActivityItem(item) &&
        !isBrowserActivityItem(item),
    )
    .reduce((total, item) => total + (item.amountSats ?? 0), 0);
  const infinityBondFlowSats = confirmedActivity
    .filter(isInfinityBondActivityItem)
    .reduce((total, item) => total + (item.amountSats ?? 0), 0);
  const browserFlowSats = confirmedActivity
    .filter(isBrowserActivityItem)
    .reduce((total, item) => total + (item.amountSats ?? 0), 0);
  const driveFlowSats = confirmedActivity
    .filter((item) => item.kind === "file" && !isBrowserActivityItem(item))
    .reduce((total, item) => total + (item.amountSats ?? 0), 0);
  const idMarketplaceVolumeSats = confirmedSales.reduce(
    (total, sale) => total + sale.priceSats,
    0,
  );
  const tokenSaleVolumeSats = confirmedTokenSales.reduce(
    (total, sale) => total + sale.priceSats,
    0,
  );
  const tokenSaleFlowSats = tokenSaleVolumeSats;
  const marketplaceSaleVolumeSats =
    idMarketplaceVolumeSats + tokenSaleVolumeSats;
  const marketplaceVolumeSats = marketplaceSaleVolumeSats;
  const idMarketplaceFeeSats = confirmedActivityFlowSats(
    confirmedActivity,
    new Set(["id-list", "id-seal", "id-delist", "id-buy"]),
  );
  const tokenMarketplaceFeeSats = confirmedActivityFlowSats(
    confirmedActivity,
    new Set([
      "token-listing",
      "token-listing-sealed",
      "token-listing-closed",
    ]),
  );
  const marketplaceFeeSats =
    idMarketplaceFeeSats + tokenMarketplaceFeeSats;
  const marketplaceMutationFeeSats = marketplaceFeeSats;
  const tokenCreationFlowSats = confirmedTokens.reduce(
    (total, token) => total + token.creationFeeSats,
    0,
  );
  const tokenMintFlowSats = confirmedTokenMints.reduce(
    (total, mint) => total + mint.paidSats,
    0,
  );
  const tokenTransferFlowSats = confirmedTokenTransfers.reduce(
    (total, transfer) => total + transfer.paidSats,
    0,
  );
  const walletFlowSats = tokenTransferFlowSats;
  const computerEventFlowSats =
    unbucketedConfirmedComputerLogFlowSats(confirmedActivity);
  const idSats = powids ** 2 * GROWTH_MODEL_INPUTS.idDensitySatsPerN2;
  const mailSats = mailFlowSats * GROWTH_MODEL_INPUTS.valueMultiple;
  const infinityBondSats =
    infinityBondFlowSats * GROWTH_MODEL_INPUTS.valueMultiple;
  const driveSats = driveFlowSats * GROWTH_MODEL_INPUTS.valueMultiple;
  const marketplaceSats =
    marketplaceVolumeSats * GROWTH_MODEL_INPUTS.valueMultiple;
  const browserSats = browserFlowSats * GROWTH_MODEL_INPUTS.valueMultiple;
  const tokenSats =
    (tokenCreationFlowSats + tokenMintFlowSats) *
    GROWTH_MODEL_INPUTS.valueMultiple;
  const walletSats = walletFlowSats * GROWTH_MODEL_INPUTS.valueMultiple;
  const computerEventSats =
    computerEventFlowSats * GROWTH_MODEL_INPUTS.valueMultiple;
  const totalSats =
    idSats +
    mailSats +
    infinityBondSats +
    driveSats +
    marketplaceSats +
    browserSats +
    tokenSats +
    walletSats +
    computerEventSats;
  const years = Math.max(
    0,
    (Math.min(cutoffMs, Date.now()) - GROWTH_MODEL_START_MS) /
      MS_PER_MODEL_YEAR,
  );

  return {
    browserFlowSats,
    browserSats,
    computerEventFlowSats,
    computerEventSats,
    driveFlowSats,
    driveSats,
    idSats,
    mailFlowSats,
    mailSats,
    marketplaceSats,
    idMarketplaceFeeSats,
    idMarketplaceVolumeSats,
    infinityBondFlowSats,
    infinityBondSats,
    marketplaceFeeSats,
    marketplaceMutationFeeSats,
    marketplaceSaleVolumeSats,
    marketplaceVolumeSats,
    powids,
    tokenMarketplaceFeeSats,
    tokenCreationFlowSats,
    tokenMintFlowSats,
    tokenSaleFlowSats,
    tokenSaleVolumeSats,
    tokenTransferFlowSats,
    tokenSats,
    walletFlowSats,
    walletSats,
    totalSats,
    totalUsd: growthSatsToUsdAtYears(totalSats, years),
  };
}

function compactGrowthEventTimes(eventTimes) {
  const sorted = [...eventTimes].sort(
    (left, right) => left.createdMs - right.createdMs,
  );
  if (sorted.length <= MAX_GROWTH_ACTUAL_CHART_EVENTS) {
    return sorted;
  }

  const indexes = new Set([0, sorted.length - 1]);
  for (let index = 0; index < MAX_GROWTH_ACTUAL_CHART_EVENTS; index += 1) {
    indexes.add(
      Math.round(
        (index * (sorted.length - 1)) /
          Math.max(1, MAX_GROWTH_ACTUAL_CHART_EVENTS - 1),
      ),
    );
  }

  return [...indexes]
    .sort((left, right) => left - right)
    .map((index) => sorted[index])
    .filter(Boolean);
}

function growthActualValuePoints(
  records,
  idActivity,
  sales,
  tokenDefinitions,
  tokenMints,
  tokenTransfers = [],
  tokenSales = [],
  options = {},
) {
  const startMs = Math.max(
    options.startMs ?? GROWTH_MODEL_START_MS,
    GROWTH_MODEL_START_MS,
  );
  const startYears = Math.max(
    0,
    (startMs - GROWTH_MODEL_START_MS) / MS_PER_MODEL_YEAR,
  );
  const eventTimes = [];
  const addEventTime = (createdAt, label) => {
    const createdMs = Date.parse(createdAt);
    if (Number.isFinite(createdMs) && createdMs >= startMs) {
      eventTimes.push({ createdMs, label });
    }
  };

  for (const record of records) {
    if (record.confirmed) {
      addEventTime(record.createdAt, `${record.id}@proofofwork.me`);
    }
  }

  for (const item of idActivity) {
    if (item.confirmed) {
      addEventTime(item.createdAt, item.title);
    }
  }

  for (const sale of publicMarketplaceSales(sales)) {
    if (sale.confirmed) {
      addEventTime(sale.createdAt, `${sale.id}@proofofwork.me sale`);
    }
  }

  for (const token of tokenDefinitions) {
    if (token.confirmed) {
      addEventTime(token.createdAt, `${token.ticker} credit created`);
    }
  }

  for (const mint of tokenMints) {
    if (mint.confirmed) {
      addEventTime(mint.createdAt, `${mint.ticker} credit mint`);
    }
  }

  for (const transfer of tokenTransfers) {
    if (transfer.confirmed) {
      addEventTime(transfer.createdAt, `${transfer.ticker} credit transfer`);
    }
  }

  for (const sale of tokenSales) {
    if (sale.confirmed) {
      addEventTime(sale.createdAt, `${sale.ticker} credit sale`);
    }
  }

  const points = [];
  const startValue = growthActualNetworkValue(
    records,
    idActivity,
    sales,
    tokenDefinitions,
    tokenMints,
    tokenTransfers,
    tokenSales,
    startMs,
  );
  points.push({
    label: options.startLabel ?? "Model start",
    sats: startValue.totalSats,
    usd: growthSatsToUsdAtYears(startValue.totalSats, startYears),
    years: startYears,
  });

  for (const { createdMs, label } of compactGrowthEventTimes(eventTimes)) {
    const value = growthActualNetworkValue(
      records,
      idActivity,
      sales,
      tokenDefinitions,
      tokenMints,
      tokenTransfers,
      tokenSales,
      createdMs,
    );
    points.push({
      label,
      sats: value.totalSats,
      usd: growthSatsToUsdAtYears(
        value.totalSats,
        Math.max(0, (createdMs - GROWTH_MODEL_START_MS) / MS_PER_MODEL_YEAR),
      ),
      years: Math.max(
        0,
        (createdMs - GROWTH_MODEL_START_MS) / MS_PER_MODEL_YEAR,
      ),
    });
  }

  const elapsed = growthElapsedYears();
  const nowValue = growthActualNetworkValue(
    records,
    idActivity,
    sales,
    tokenDefinitions,
    tokenMints,
    tokenTransfers,
    tokenSales,
  );
  const lastPoint = points[points.length - 1];
  if (
    !lastPoint ||
    lastPoint.sats !== nowValue.totalSats ||
    lastPoint.years < elapsed
  ) {
    points.push({
      label: "Real now",
      sats: nowValue.totalSats,
      usd: nowValue.totalUsd,
      years: elapsed,
    });
  }

  return points;
}

function growthActivityKindLabel(kind) {
  if (
    kind === "id-register" ||
    kind === "id-update" ||
    kind === "id-transfer"
  ) {
    return "ID";
  }

  if (
    kind === "id-list" ||
    kind === "id-seal" ||
    kind === "id-delist" ||
    kind === "id-buy"
  ) {
    return "Marketplace";
  }

  if (kind === "file") {
    return "Drive";
  }

  if (kind === "token-transfer") {
    return "Wallet";
  }

  if (kind === "infinity-bond") {
    return "Infinity Bond";
  }

  if (
    kind === "token-create" ||
    kind === "token-mint" ||
    kind === "token-listing" ||
    kind === "token-listing-sealed" ||
    kind === "token-listing-closed" ||
    kind === "token-sale"
  ) {
    return "Credit";
  }

  return kind === "reply" ? "Mail reply" : "Mail";
}

function confirmedComputerActionCount(
  records,
  idActivity,
  tokenDefinitions,
  tokenMints,
  tokenTransfers = [],
  tokenSales = [],
) {
  const txids = new Set();
  const add = (confirmed, txid) => {
    if (confirmed && txid) {
      txids.add(txid);
    }
  };

  records.forEach((record) => add(record.confirmed, record.txid));
  idActivity.forEach((item) => add(item.confirmed, item.txid));
  tokenDefinitions.forEach((token) => add(token.confirmed, token.txid));
  tokenMints.forEach((mint) => add(mint.confirmed, mint.txid));
  tokenTransfers.forEach((transfer) => add(transfer.confirmed, transfer.txid));
  tokenSales.forEach((sale) => add(sale.confirmed, sale.txid));

  return txids.size;
}

function growthRealEventItems(
  records,
  idActivity,
  sales,
  tokenDefinitions,
  tokenMints,
  tokenTransfers = [],
  tokenSales = [],
) {
  const events = new Map();
  const setEvent = (event) => {
    events.set(event.key, event);
  };

  for (const record of records) {
    if (!record.confirmed) {
      continue;
    }

    setEvent({
      amountLabel: `${record.amountSats.toLocaleString()} proofs`,
      createdAt: record.createdAt,
      detail: `${record.id}@proofofwork.me joined the confirmed ID graph.`,
      key: record.txid,
      kind: "ID",
      network: record.network,
      title: "ID registered",
      txid: record.txid,
    });
  }

  for (const item of idActivity) {
    if (!item.confirmed) {
      continue;
    }

    setEvent({
      amountLabel: item.amountSats
        ? `${item.amountSats.toLocaleString()} proofs`
        : "Confirmed",
      createdAt: item.createdAt,
      detail: item.detail || item.description,
      key: item.txid,
      kind: isInfinityBondActivityItem(item)
        ? "Infinity Bond"
        : isBrowserActivityItem(item)
        ? "Browser"
        : growthActivityKindLabel(item.kind),
      network: item.network,
      title: item.id ? `${item.title}: ${item.id}@proofofwork.me` : item.title,
      txid: item.txid,
    });
  }

  for (const sale of publicMarketplaceSales(sales)) {
    if (!sale.confirmed) {
      continue;
    }

    setEvent({
      amountLabel: `${sale.priceSats.toLocaleString()} sale proofs`,
      createdAt: sale.createdAt,
      detail: `${sale.id}@proofofwork.me transferred from ${shortAddress(sale.sellerAddress)} to ${shortAddress(sale.buyerAddress)}.`,
      key: sale.txid,
      kind: "Marketplace",
      network: sale.network,
      title: "Marketplace sale",
      txid: sale.txid,
    });
  }

  for (const token of tokenDefinitions) {
    if (!token.confirmed) {
      continue;
    }

    setEvent({
      amountLabel: `${token.creationFeeSats.toLocaleString()} creation proofs`,
      createdAt: token.createdAt,
      detail: `${token.ticker} created with ${token.maxSupply.toLocaleString()} max supply and registry ${shortAddress(token.registryAddress)}.`,
      key: token.txid,
      kind: "Credit",
      network: token.network,
      title: "Credit created",
      txid: token.txid,
    });
  }

  for (const mint of tokenMints) {
    if (!mint.confirmed) {
      continue;
    }

    setEvent({
      amountLabel: `${mint.paidSats.toLocaleString()} mint proofs`,
      createdAt: mint.createdAt,
      detail: `${mint.amount.toLocaleString()} ${mint.ticker} minted by ${shortAddress(mint.minterAddress)}.`,
      key: mint.txid,
      kind: "Credit",
      network: mint.network,
      title: "Credit mint",
      txid: mint.txid,
    });
  }

  for (const transfer of tokenTransfers) {
    if (!transfer.confirmed) {
      continue;
    }

    setEvent({
      amountLabel: `${transfer.paidSats.toLocaleString()} registry proofs`,
      createdAt: transfer.createdAt,
      detail: `${transfer.amount.toLocaleString()} ${transfer.ticker} moved from ${shortAddress(transfer.senderAddress)} to ${shortAddress(transfer.recipientAddress)}.`,
      key: transfer.txid,
      kind: "Wallet",
      network: transfer.network,
      title: "Wallet transfer",
      txid: transfer.txid,
    });
  }

  for (const sale of tokenSales) {
    if (!sale.confirmed) {
      continue;
    }

    setEvent({
      amountLabel: `${sale.priceSats.toLocaleString()} sale proofs`,
      createdAt: sale.createdAt,
      detail: `${sale.amount.toLocaleString()} ${sale.ticker} bought by ${shortAddress(sale.buyerAddress)} from ${shortAddress(sale.sellerAddress)}.`,
      key: sale.txid,
      kind: "Marketplace",
      network: sale.network,
      title: "Credit sale",
      txid: sale.txid,
    });
  }

  return [...events.values()].sort(
    (left, right) => Date.parse(right.createdAt) - Date.parse(left.createdAt),
  );
}

function emptyWorkFloorPayload(network) {
  return {
    actualValue: {
      browserFlowSats: 0,
      browserSats: 0,
      computerEventFlowSats: 0,
      computerEventSats: 0,
      driveFlowSats: 0,
      driveSats: 0,
      idSats: 0,
      idMarketplaceFeeSats: 0,
      idMarketplaceVolumeSats: 0,
      infinityBondFlowSats: 0,
      infinityBondSats: 0,
      mailFlowSats: 0,
      mailSats: 0,
      marketplaceFeeSats: 0,
      marketplaceMutationFeeSats: 0,
      marketplaceSaleVolumeSats: 0,
      marketplaceSats: 0,
      marketplaceVolumeSats: 0,
      powids: 0,
      tokenMarketplaceFeeSats: 0,
      tokenCreationFlowSats: 0,
      tokenMintFlowSats: 0,
      tokenSaleFlowSats: 0,
      tokenSaleVolumeSats: 0,
      tokenTransferFlowSats: 0,
      tokenSats: 0,
      totalSats: 0,
      totalUsd: 0,
      walletFlowSats: 0,
      walletSats: 0,
    },
    chartPoints: [],
    indexedAt: new Date().toISOString(),
    network,
    networkValueSats: 0,
    powids: 0,
    source: mempoolBase(network),
    tokenFlowSats: 0,
    stats: {
      confirmedTokenMints: 0,
      confirmedTokens: 0,
      marketplaceVolumeSats: 0,
      infinityBondFlowSats: 0,
      infinityBondSats: 0,
      idMarketplaceFeeSats: 0,
      idMarketplaceVolumeSats: 0,
      marketplaceFeeSats: 0,
      marketplaceMutationFeeSats: 0,
      marketplaceSaleVolumeSats: 0,
      tokenMarketplaceFeeSats: 0,
      computerEventFlowSats: 0,
      computerEventSats: 0,
      confirmedComputerActions: 0,
      tokenCreationFlowSats: 0,
      tokenMintFlowSats: 0,
      tokenSaleFlowSats: 0,
      tokenSaleVolumeSats: 0,
      tokenTransactions: 0,
    },
  };
}

async function workFloorPayload(network, fresh = false) {
  if (network !== "livenet") {
    return emptyWorkFloorPayload(network);
  }

  const emptyRegistryState = {
    activity: [],
    indexedAt: new Date().toISOString(),
    listings: [],
    network,
    pendingEvents: [],
    records: [],
    registryAddress: registryAddressForNetwork(network),
    sales: [],
    source: mempoolBase(network),
  };
  const [registryState, computerActivity, tokenState, workTokenState, btcUsdQuote] =
    await Promise.all([
      fresh
        ? safeRegistryPayload(network)
        : fastJsonBackedPayload(
            `registry:${network}`,
            `payload:registry:${network}`,
            () => safeRegistryPayload(network),
            REGISTRY_CACHE_TTL_MS,
            REGISTRY_CACHE_STALE_MS,
            emptyRegistryState,
          ),
      fresh
        ? globalActivityPayload(network, true)
        : fastGlobalActivityPayload(network),
      fresh && ENABLE_SUMMARY_TOKEN_REFRESH
        ? refreshTokenPayload(network)
        : fastTokenPayloadSnapshot(network, "", { reconcileSpendable: false }),
      fresh && ENABLE_SUMMARY_TOKEN_REFRESH
        ? refreshTokenPayload(network, WORK_TOKEN_ID)
        : fastTokenPayloadSnapshot(network, WORK_TOKEN_ID, {
            reconcileSpendable: false,
          }),
      btcUsdPricePayload(network, { fresh }),
    ]);

  return workFloorPayloadFromState(
    network,
    registryState,
    computerActivity,
    tokenState,
    workTokenState,
    { btcUsdQuote },
  );
}

function workFloorPayloadFromState(
  network,
  registryState,
  computerActivity,
  tokenState,
  workTokenState,
  options = {},
) {
  if (network !== "livenet") {
    return emptyWorkFloorPayload(network);
  }

  const valueTokenState = tokenStateWithScopedTokenOverride(
    tokenState,
    workTokenState,
    WORK_TOKEN_ID,
  );
  const activityForGrowth =
    Array.isArray(computerActivity.activity) &&
    computerActivity.activity.length > 0
      ? computerActivity.activity
      : registryState.activity ?? [];
  const tokenSalesForValue = Array.isArray(valueTokenState.sales)
    ? valueTokenState.sales
    : [];
  const confirmedComputerActions = confirmedComputerActionCount(
    registryState.records ?? [],
    activityForGrowth,
    valueTokenState.tokens ?? [],
    valueTokenState.mints ?? [],
    valueTokenState.transfers ?? [],
    tokenSalesForValue,
  );
  const actualValue = growthActualNetworkValue(
    registryState.records ?? [],
    activityForGrowth,
    registryState.sales ?? [],
    valueTokenState.tokens ?? [],
    valueTokenState.mints ?? [],
    valueTokenState.transfers ?? [],
    tokenSalesForValue,
  );
  const globalWorkMintFlowSats = (valueTokenState.mints ?? [])
    .filter((mint) => mint.confirmed && mint.tokenId === WORK_TOKEN_ID)
    .reduce((total, mint) => total + mint.paidSats, 0);
  const scopedWorkMintFlowSats = (workTokenState.mints ?? [])
    .filter((mint) => mint.confirmed)
    .reduce((total, mint) => total + mint.paidSats, 0);
  const globalWorkMintCount = (valueTokenState.mints ?? []).filter(
    (mint) => mint.confirmed && mint.tokenId === WORK_TOKEN_ID,
  ).length;
  const scopedWorkMintCount = (workTokenState.mints ?? []).filter(
    (mint) => mint.confirmed,
  ).length;
  const missingWorkMintFlowSats = Math.max(
    0,
    scopedWorkMintFlowSats - globalWorkMintFlowSats,
  );
  const missingWorkMintCount = Math.max(
    0,
    scopedWorkMintCount - globalWorkMintCount,
  );
  const correctedTokenMintFlowSats =
    actualValue.tokenMintFlowSats + missingWorkMintFlowSats;
  const correctedTokenSats =
    (actualValue.tokenCreationFlowSats + correctedTokenMintFlowSats) *
    GROWTH_MODEL_INPUTS.valueMultiple;
  const correctedNetworkValueSats =
    actualValue.totalSats +
    missingWorkMintFlowSats * GROWTH_MODEL_INPUTS.valueMultiple;
  const modelTotalUsd = growthSatsToUsdAtYears(
    correctedNetworkValueSats,
    growthElapsedYears(),
  );
  const btcUsdMetadata = btcUsdResponseMetadata(options.btcUsdQuote);
  const liveTotalUsd =
    btcUsdMetadata.btcUsd > 0
      ? satsToUsdAtBtcUsd(correctedNetworkValueSats, btcUsdMetadata.btcUsd)
      : modelTotalUsd;
  const correctedActualValue = {
    ...actualValue,
    modelTotalUsd,
    tokenMintFlowSats: correctedTokenMintFlowSats,
    tokenSats: correctedTokenSats,
    totalSats: correctedNetworkValueSats,
    totalUsd: liveTotalUsd,
  };
  const workToken = (valueTokenState.tokens ?? []).find(
    (token) =>
      token.tokenId === WORK_TOKEN_ID || token.ticker === WORK_TOKEN_TICKER,
  ) ?? (workTokenState.tokens ?? [])[0];
  const workCreatedMs = workToken
    ? Date.parse(workToken.createdAt)
    : GROWTH_MODEL_START_MS;
  const chartPoints = growthActualValuePoints(
    registryState.records ?? [],
    activityForGrowth,
    registryState.sales ?? [],
    valueTokenState.tokens ?? [],
    valueTokenState.mints ?? [],
    valueTokenState.transfers ?? [],
    tokenSalesForValue,
    {
      startLabel: "WORK deploy",
      startMs: workCreatedMs,
    },
  )
    .map((point) => ({
      floorSats: point.sats / WORK_TOKEN_MAX_SUPPLY,
      label: point.label,
      networkValueSats: point.sats,
      years: point.years,
    }));
  const lastChartPoint = chartPoints[chartPoints.length - 1];
  const correctedNowPoint = {
    floorSats: correctedNetworkValueSats / WORK_TOKEN_MAX_SUPPLY,
    label: "Real now",
    networkValueSats: correctedNetworkValueSats,
    years: growthElapsedYears(),
  };
  if (!lastChartPoint || lastChartPoint.label !== "Real now") {
    chartPoints.push(correctedNowPoint);
  } else {
    chartPoints[chartPoints.length - 1] = correctedNowPoint;
  }

  return {
    actualValue: correctedActualValue,
    ...btcUsdMetadata,
    chartPoints,
    indexedAt: new Date().toISOString(),
    network,
    networkValueSats: correctedNetworkValueSats,
    powids: actualValue.powids,
    source: mempoolBase(network),
    tokenFlowSats:
      actualValue.tokenCreationFlowSats + correctedTokenMintFlowSats,
    stats: {
      confirmedTokenMints: (valueTokenState.mints ?? []).filter(
        (mint) => mint.confirmed,
      ).length + missingWorkMintCount,
      confirmedTokens: (valueTokenState.tokens ?? []).filter(
        (token) => token.confirmed,
      ).length,
      confirmedComputerActions,
      browserFlowSats: actualValue.browserFlowSats,
      browserSats: actualValue.browserSats,
      computerEventFlowSats: actualValue.computerEventFlowSats,
      computerEventSats: actualValue.computerEventSats,
      driveFlowSats: actualValue.driveFlowSats,
      driveSats: actualValue.driveSats,
      idSats: actualValue.idSats,
      infinityBondFlowSats: actualValue.infinityBondFlowSats,
      infinityBondSats: actualValue.infinityBondSats,
      mailFlowSats: actualValue.mailFlowSats,
      mailSats: actualValue.mailSats,
      idMarketplaceFeeSats: actualValue.idMarketplaceFeeSats,
      idMarketplaceVolumeSats: actualValue.idMarketplaceVolumeSats,
      marketplaceFeeSats: actualValue.marketplaceFeeSats,
      marketplaceMutationFeeSats: actualValue.marketplaceMutationFeeSats,
      marketplaceSaleVolumeSats: actualValue.marketplaceSaleVolumeSats,
      marketplaceSats: actualValue.marketplaceSats,
      marketplaceVolumeSats: actualValue.marketplaceVolumeSats,
      tokenMarketplaceFeeSats: actualValue.tokenMarketplaceFeeSats,
      tokenCreationFlowSats: actualValue.tokenCreationFlowSats,
      tokenMintFlowSats: correctedTokenMintFlowSats,
      tokenSaleFlowSats: actualValue.tokenSaleFlowSats,
      tokenSaleVolumeSats: actualValue.tokenSaleVolumeSats,
      tokenSats: correctedTokenSats,
      tokenTransferFlowSats: actualValue.tokenTransferFlowSats,
      walletFlowSats: actualValue.walletFlowSats,
      walletSats: actualValue.walletSats,
      totalSats: correctedNetworkValueSats,
      tokenTransactions:
        valueTokenState.stats?.transactions ??
        (valueTokenState.tokens ?? []).length +
          (valueTokenState.mints ?? []).length +
          tokenSalesForValue.length,
    },
  };
}

async function mailPayload(address, network) {
  const txs = await fetchAddressTransactions(address, network);
  const inboxMessages = inboxMessagesFromTransactions(txs, address, network);
  const sentMessages = sentMessagesFromTransactions(txs, address, network);

  return {
    address,
    inboxMessages,
    indexedAt: new Date().toISOString(),
    network,
    sentMessages,
    source: mempoolBase(network),
    stats: {
      inbox: inboxMessages.filter((message) => message.confirmed).length,
      incoming: inboxMessages.filter((message) => !message.confirmed).length,
      scannedTransactions: txs.length,
      sent: sentMessages.filter((message) => message.status === "confirmed")
        .length,
      outbox: sentMessages.filter((message) => message.status !== "confirmed")
        .length,
    },
  };
}

async function addressUtxoPayload(address, network) {
  return fetchJson(`${mempoolBase(network)}/api/address/${address}/utxo`);
}

async function txHexPayload(txid, network) {
  const hex = await fetchText(`${mempoolBase(network)}/api/tx/${txid}/hex`);
  return {
    hex,
    indexedAt: new Date().toISOString(),
    network,
    txid,
  };
}

async function txOutspendPayload(txid, vout, network) {
  let primaryOutspend = null;
  try {
    primaryOutspend = await fetchJson(
      `${mempoolBase(network)}/api/tx/${txid}/outspend/${vout}`,
    );
    if (primaryOutspend?.spent) {
      return primaryOutspend;
    }
  } catch {
    // Some private electrs/mempool deployments do not expose /outspend.
    // Reconstruct the answer from the output script's Electrum history instead.
  }

  const sourceTx = await fetchTransactionWithPendingFallback(txid, network);
  const output = Array.isArray(sourceTx?.vout) ? sourceTx.vout[vout] : undefined;
  const outputScript =
    output && typeof output.scriptpubkey === "string" ? output.scriptpubkey : "";
  if (!outputScript) {
    if (primaryOutspend) {
      return primaryOutspend;
    }
    throw new Error("Transaction output not found.");
  }

  const scripthash = scriptHashForScriptHex(outputScript);
  let history = [];
  try {
    history = await electrumRequest("blockchain.scripthash.get_history", [
      scripthash,
    ]);
  } catch (error) {
    if (primaryOutspend) {
      return primaryOutspend;
    }
    throw error;
  }
  const candidateTxids = [
    ...new Set(
      (Array.isArray(history) ? history : [])
        .map((entry) => entry?.tx_hash)
        .filter(
          (candidateTxid) =>
            typeof candidateTxid === "string" &&
            /^[0-9a-fA-F]{64}$/u.test(candidateTxid),
        )
        .map((candidateTxid) => candidateTxid.toLowerCase())
        .filter((candidateTxid) => candidateTxid !== txid),
    ),
  ];
  const candidateTxs = await mapWithConcurrency(
    candidateTxids,
    TX_FETCH_CONCURRENCY,
    async (candidateTxid) => {
      try {
        return await fetchTransactionWithPendingFallback(candidateTxid, network);
      } catch {
        return null;
      }
    },
  );

  for (const candidateTx of candidateTxs.filter(Boolean)) {
    const vin = Array.isArray(candidateTx.vin) ? candidateTx.vin : [];
    const inputIndex = vin.findIndex(
      (input) => input?.txid === txid && input?.vout === vout,
    );
    if (inputIndex >= 0) {
      return {
        spent: true,
        status: candidateTx.status ?? null,
        txid: transactionTxid(candidateTx),
        vin: inputIndex,
      };
    }
  }

  return primaryOutspend ?? { spent: false };
}

async function txStatusPayload(txid, network) {
  const tx = await fetchTransactionWithPendingFallback(txid, network);
  if (!tx) {
    return {
      confirmed: false,
      indexedAt: new Date().toISOString(),
      network,
      status: "dropped",
      txid,
    };
  }

  const confirmed = transactionConfirmed(tx);
  return {
    confirmed,
    indexedAt: new Date().toISOString(),
    network,
    status: confirmed ? "confirmed" : "pending",
    txid,
  };
}

async function txPayload(txid, network) {
  const tx = await fetchTransactionWithPendingFallback(txid, network);
  if (!tx) {
    return {
      confirmed: false,
      indexedAt: new Date().toISOString(),
      network,
      status: "dropped",
      tx: null,
      txid,
    };
  }

  const confirmed = transactionConfirmed(tx);
  return {
    confirmed,
    indexedAt: new Date().toISOString(),
    network,
    status: confirmed ? "confirmed" : "pending",
    tx,
    txid,
  };
}

async function healthPayload() {
  let tipHeight = null;
  let backend = null;
  try {
    const tip = await fetchText(
      `${MEMPOOL_BASE_MAINNET}/api/blocks/tip/height`,
    );
    tipHeight = Number(tip);
  } catch {
    tipHeight = null;
  }

  try {
    const info = await fetchJson(`${MEMPOOL_BASE_MAINNET}/api/v1/backend-info`);
    backend = info?.backend ?? null;
  } catch {
    backend = null;
  }

  return {
    backend,
    indexedAt: new Date().toISOString(),
    mempoolBase: MEMPOOL_BASE_MAINNET,
    ok: true,
    service: "proofofwork-op-return-api",
    tipHeight,
  };
}

async function handleRequest(request, response) {
  if (request.method === "OPTIONS") {
    optionsResponse(response);
    return;
  }

  const url = new URL(
    request.url ?? "/",
    `http://${request.headers.host ?? "localhost"}`,
  );
  const pathParts = url.pathname.split("/").filter(Boolean);

  try {
    if (
      request.method === "POST" &&
      url.pathname === "/api/v1/broadcast/slipstream"
    ) {
      jsonResponse(
        response,
        200,
        await broadcastSlipstreamPayload(request),
        "no-store",
      );
      return;
    }

    if (
      request.method === "POST" &&
      url.pathname === "/api/v1/broadcast/tx"
    ) {
      jsonResponse(
        response,
        200,
        await broadcastNodePayload(request, networkFromSearch(url.searchParams)),
        "no-store",
      );
      return;
    }

    if (request.method !== "GET") {
      errorResponse(response, 405, "Method not allowed.");
      return;
    }

    if (url.pathname === "/api/v1/broadcast/slipstream/status") {
      jsonResponse(response, 200, slipstreamStatusPayload(), "no-store");
      return;
    }

    if (url.pathname === "/health" || url.pathname === "/api/v1/health") {
      jsonResponse(response, 200, await healthPayload(), "no-store");
      return;
    }

    const network = networkFromSearch(url.searchParams);
    const freshRead = freshReadRequested(url.searchParams);

    if (url.pathname === "/api/v1/prices/btc-usd") {
      jsonResponse(
        response,
        200,
        await btcUsdPricePayload(network, { fresh: freshRead }),
        freshRead ? FRESH_READ_CACHE_CONTROL : "public, max-age=60",
      );
      return;
    }

    if (
      pathParts.length === 5 &&
      pathParts[0] === "api" &&
      pathParts[1] === "v1" &&
      pathParts[2] === "block" &&
      pathParts[4] === "txids"
    ) {
      const blockHash = pathParts[3].toLowerCase();
      if (!/^[0-9a-f]{64}$/u.test(blockHash)) {
        errorResponse(response, 400, "Invalid block hash.");
        return;
      }

      jsonResponse(
        response,
        200,
        await fetchBlockTxids(blockHash, network),
        "public, max-age=300",
      );
      return;
    }

    if (
      url.pathname === "/api/v1/registry-summary" ||
      url.pathname === "/api/v1/ids-summary"
    ) {
      jsonResponse(
        response,
        200,
        await registrySummaryPayload(network, freshRead),
        freshRead ? FRESH_READ_CACHE_CONTROL : EXPENSIVE_READ_CACHE_CONTROL,
      );
      return;
    }

    if (url.pathname === "/api/v1/registry" || url.pathname === "/api/v1/ids") {
      if (freshRead) {
        clearResponseCache(`registry:${network}`);
        refreshedJsonResponse(
          response,
          `registry:${network}`,
          await safeRegistryPayload(network),
          FRESH_READ_CACHE_CONTROL,
          REGISTRY_CACHE_TTL_MS,
          REGISTRY_CACHE_STALE_MS,
        );
        return;
      }

      await cachedJsonResponse(
        response,
        `registry:${network}`,
        () => safeRegistryPayload(network),
        EXPENSIVE_READ_CACHE_CONTROL,
        REGISTRY_CACHE_TTL_MS,
        REGISTRY_CACHE_STALE_MS,
      );
      return;
    }

    if (
      url.pathname === "/api/v1/registry-history" ||
      url.pathname === "/api/v1/ids-history"
    ) {
      const historyKind = String(url.searchParams.get("kind") ?? "records")
        .trim()
        .toLowerCase();
      jsonResponse(
        response,
        200,
        await registryHistoryPayload(
          network,
          historyKind,
          url.searchParams,
          freshRead,
        ),
        freshRead ? FRESH_READ_CACHE_CONTROL : EXPENSIVE_READ_CACHE_CONTROL,
      );
      return;
    }

    if (
      url.pathname === "/api/v1/activity-summary" ||
      url.pathname === "/api/v1/log-summary"
    ) {
      jsonResponse(
        response,
        200,
        await activitySummaryPayload(network, freshRead),
        freshRead ? FRESH_READ_CACHE_CONTROL : EXPENSIVE_READ_CACHE_CONTROL,
      );
      return;
    }

    if (
      url.pathname === "/api/v1/consistency" ||
      url.pathname === "/api/v1/ledger-consistency"
    ) {
      jsonResponse(
        response,
        200,
        await ledgerConsistencyPayload(network, freshRead),
        freshRead ? FRESH_READ_CACHE_CONTROL : READ_CACHE_CONTROL,
      );
      return;
    }

    if (url.pathname === "/api/v1/activity" || url.pathname === "/api/v1/log") {
      if (freshRead) {
        jsonResponse(
          response,
          200,
          await mergedLogActivityPayload(network, true),
          FRESH_READ_CACHE_CONTROL,
        );
        return;
      }

      jsonResponse(
        response,
        200,
        await mergedLogActivityPayload(network),
        EXPENSIVE_READ_CACHE_CONTROL,
      );
      return;
    }

    if (
      url.pathname === "/api/v1/activity-history" ||
      url.pathname === "/api/v1/log-history"
    ) {
      const historyKind = String(url.searchParams.get("kind") ?? "")
        .trim()
        .toLowerCase();
      jsonResponse(
        response,
        200,
        await activityHistoryPayload(
          network,
          historyKind,
          url.searchParams,
          freshRead,
        ),
        freshRead ? FRESH_READ_CACHE_CONTROL : EXPENSIVE_READ_CACHE_CONTROL,
      );
      return;
    }

    if (url.pathname === "/api/v1/token") {
      const tokenScope = normalizeTokenScope(
        url.searchParams.get("asset") ??
          url.searchParams.get("tokenId") ??
          url.searchParams.get("ticker") ??
          "",
      );
      jsonResponse(
        response,
        200,
        await tokenPayloadForRead(network, tokenScope, freshRead, {
          reconcileSpendable: false,
        }),
        freshRead ? FRESH_READ_CACHE_CONTROL : TOKEN_READ_CACHE_CONTROL,
      );
      return;
    }

    if (url.pathname === "/api/v1/token-summary") {
      const tokenScope = normalizeTokenScope(
        url.searchParams.get("asset") ??
          url.searchParams.get("tokenId") ??
          url.searchParams.get("ticker") ??
          "",
      );
      jsonResponse(
        response,
        200,
        await tokenSummaryPayload(network, tokenScope, freshRead),
        freshRead ? FRESH_READ_CACHE_CONTROL : TOKEN_READ_CACHE_CONTROL,
      );
      return;
    }

    if (url.pathname === "/api/v1/token-history") {
      const tokenScope = normalizeTokenScope(
        url.searchParams.get("asset") ??
          url.searchParams.get("tokenId") ??
          url.searchParams.get("ticker") ??
          "",
      );
      const historyKind = String(url.searchParams.get("kind") ?? "mints")
        .trim()
        .toLowerCase();
      jsonResponse(
        response,
        200,
        await tokenHistoryPayload(
          network,
          tokenScope,
          historyKind,
          url.searchParams,
          freshRead,
        ),
        freshRead ? FRESH_READ_CACHE_CONTROL : TOKEN_READ_CACHE_CONTROL,
      );
      return;
    }

    if (url.pathname === "/api/v1/work-floor") {
      if (freshRead) {
        jsonResponse(
          response,
          200,
          await cachedWorkFloorPayload(network, true),
          FRESH_READ_CACHE_CONTROL,
        );
      } else {
        jsonResponse(
          response,
          200,
          await cachedWorkFloorPayload(network, false),
          READ_CACHE_CONTROL,
        );
      }
      return;
    }

    if (url.pathname === "/api/v1/work-summary") {
      jsonResponse(
        response,
        200,
        await workSummaryPayload(network, freshRead),
        freshRead ? FRESH_READ_CACHE_CONTROL : READ_CACHE_CONTROL,
      );
      return;
    }

    if (url.pathname === "/api/v1/marketplace-summary") {
      jsonResponse(
        response,
        200,
        await marketplaceSummaryPayload(network, freshRead),
        freshRead ? FRESH_READ_CACHE_CONTROL : READ_CACHE_CONTROL,
      );
      return;
    }

    if (url.pathname === "/api/v1/growth-summary") {
      jsonResponse(
        response,
        200,
        await growthSummaryPayload(network, freshRead),
        freshRead ? FRESH_READ_CACHE_CONTROL : READ_CACHE_CONTROL,
      );
      return;
    }

    if (url.pathname === "/api/v1/rush") {
      if (freshRead) {
        clearResponseCache(`rush:${network}`, `payload:rush:${network}`);
        refreshedJsonResponse(
          response,
          `rush:${network}`,
          await rushPayload(network),
          FRESH_READ_CACHE_CONTROL,
          TOKEN_CACHE_TTL_MS,
          TOKEN_CACHE_STALE_MS,
        );
      } else {
        await cachedJsonResponse(
          response,
          `rush:${network}`,
          () => cachedRushPayload(network),
          TOKEN_READ_CACHE_CONTROL,
          TOKEN_CACHE_TTL_MS,
          TOKEN_CACHE_STALE_MS,
        );
      }
      return;
    }

    if (
      pathParts.length === 4 &&
      pathParts[0] === "api" &&
      pathParts[1] === "v1" &&
      pathParts[2] === "ids"
    ) {
      const id = normalizePowId(decodeURIComponent(pathParts[3]));
      const registry = await cachedPayload(`registry:${network}`, () =>
        safeRegistryPayload(network),
      );
      const records = registry.records.filter((record) => record.id === id);
      const confirmed = records.find((record) => record.confirmed);
      const pending = records.find((record) => !record.confirmed);
      jsonResponse(response, 200, {
        id,
        indexedAt: registry.indexedAt,
        network,
        record: confirmed ?? pending ?? null,
        routable: Boolean(confirmed),
        status: confirmed ? "confirmed" : pending ? "pending" : "available",
      });
      return;
    }

    if (
      pathParts.length === 5 &&
      pathParts[0] === "api" &&
      pathParts[1] === "v1" &&
      pathParts[2] === "address" &&
      pathParts[4] === "utxo"
    ) {
      const address = decodeURIComponent(pathParts[3]);
      if (!isValidBitcoinAddress(address, network)) {
        errorResponse(response, 400, "Invalid address for network.");
        return;
      }

      jsonResponse(
        response,
        200,
        await addressUtxoPayload(address, network),
        "no-store",
      );
      return;
    }

    if (
      pathParts.length >= 5 &&
      pathParts.length <= 7 &&
      pathParts[0] === "api" &&
      pathParts[1] === "v1" &&
      pathParts[2] === "address" &&
      pathParts[4] === "txs"
    ) {
      const address = decodeURIComponent(pathParts[3]);
      const addressPath = pathParts.slice(4).join("/");
      if (!isValidBitcoinAddress(address, network)) {
        errorResponse(response, 400, "Invalid address for network.");
        return;
      }
      if (
        !/^txs(?:\/(?:mempool|chain(?:\/[0-9a-f]{64})?))?$/iu.test(
          addressPath,
        )
      ) {
        errorResponse(response, 400, "Invalid address transaction path.");
        return;
      }

      jsonResponse(
        response,
        200,
        addressPath === "txs/mempool"
          ? await fetchAddressMempoolTransactions(address, network)
          : await fetchAddressTransactionsPage(address, network, addressPath),
        "no-store",
      );
      return;
    }

    if (
      pathParts.length === 5 &&
      pathParts[0] === "api" &&
      pathParts[1] === "v1" &&
      pathParts[2] === "address" &&
      pathParts[4] === "mail"
    ) {
      const address = decodeURIComponent(pathParts[3]);
      if (!isValidBitcoinAddress(address, network)) {
        errorResponse(response, 400, "Invalid address for network.");
        return;
      }

      jsonResponse(
        response,
        200,
        await mailPayload(address, network),
        "public, max-age=10",
      );
      return;
    }

    if (
      pathParts.length === 5 &&
      pathParts[0] === "api" &&
      pathParts[1] === "v1" &&
      pathParts[2] === "tx" &&
      pathParts[4] === "hex"
    ) {
      const txid = pathParts[3].toLowerCase();
      if (!/^[0-9a-f]{64}$/u.test(txid)) {
        errorResponse(response, 400, "Invalid txid.");
        return;
      }

      jsonResponse(
        response,
        200,
        await txHexPayload(txid, network),
        "no-store",
      );
      return;
    }

    if (
      pathParts.length === 5 &&
      pathParts[0] === "api" &&
      pathParts[1] === "v1" &&
      pathParts[2] === "tx" &&
      pathParts[4] === "status"
    ) {
      const txid = pathParts[3].toLowerCase();
      if (!/^[0-9a-f]{64}$/u.test(txid)) {
        errorResponse(response, 400, "Invalid txid.");
        return;
      }

      jsonResponse(
        response,
        200,
        await txStatusPayload(txid, network),
        "no-store",
      );
      return;
    }

    if (
      pathParts.length === 6 &&
      pathParts[0] === "api" &&
      pathParts[1] === "v1" &&
      pathParts[2] === "tx" &&
      pathParts[4] === "outspend"
    ) {
      const txid = pathParts[3].toLowerCase();
      const vout = Number(pathParts[5]);
      if (!/^[0-9a-f]{64}$/u.test(txid)) {
        errorResponse(response, 400, "Invalid txid.");
        return;
      }
      if (!Number.isSafeInteger(vout) || vout < 0) {
        errorResponse(response, 400, "Invalid output index.");
        return;
      }

      jsonResponse(
        response,
        200,
        await txOutspendPayload(txid, vout, network),
        "no-store",
      );
      return;
    }

    if (
      pathParts.length === 4 &&
      pathParts[0] === "api" &&
      pathParts[1] === "v1" &&
      pathParts[2] === "tx"
    ) {
      const txid = pathParts[3].toLowerCase();
      if (!/^[0-9a-f]{64}$/u.test(txid)) {
        errorResponse(response, 400, "Invalid txid.");
        return;
      }

      const payload = await txPayload(txid, network);
      if (!payload.tx) {
        errorResponse(response, 404, "Transaction not found.");
        return;
      }

      jsonResponse(response, 200, payload, "no-store");
      return;
    }

    errorResponse(response, 404, "Not found.");
  } catch (error) {
    const statusCode =
      error && typeof error === "object" && Number.isInteger(error.statusCode)
        ? error.statusCode
        : 500;
    errorResponse(
      response,
      statusCode,
      error instanceof Error ? error.message : "Unexpected server error.",
      error && typeof error === "object" ? error.details : undefined,
    );
  }
}

const server = http.createServer((request, response) => {
  void handleRequest(request, response);
});

function scheduleWarmJsonCache(cacheKey, producer, ttlMs, staleMs, delayMs) {
  const delay = Math.max(0, Number(delayMs) || 0);
  setTimeout(() => {
    warmJsonCache(cacheKey, producer, ttlMs, staleMs);
  }, delay);
}

function prewarmExpensiveReadCaches() {
  BACKGROUND_REFRESH_LAST_STARTED.set("token:livenet:", Date.now());
  BACKGROUND_REFRESH_LAST_STARTED.set(
    `token:livenet:${WORK_TOKEN_ID}`,
    Date.now(),
  );
  setTimeout(() => {
    refreshCanonicalLedgerPayloadInBackground("livenet", false);
  }, BACKGROUND_STARTUP_REFRESH_DELAY_MS);
}

server.listen(PORT, HOST, () => {
  console.log(`ProofOfWork OP_RETURN API listening on http://${HOST}:${PORT}`);
  console.log(`Mainnet mempool source: ${MEMPOOL_BASE_MAINNET}`);
  prewarmExpensiveReadCaches();
});
