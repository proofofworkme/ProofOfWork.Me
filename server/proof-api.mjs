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
const MEMPOOL_BASE_MAINNET = stripTrailingSlash(
  process.env.MEMPOOL_BASE ?? "http://127.0.0.1:8080",
);
const PENDING_MEMPOOL_BASE_MAINNET = stripTrailingSlash(
  process.env.PENDING_MEMPOOL_BASE ?? "https://mempool.space",
);
const MEMPOOL_BASE_TESTNET = stripTrailingSlash(
  process.env.MEMPOOL_BASE_TESTNET ?? "https://mempool.space/testnet",
);
const MEMPOOL_BASE_TESTNET4 = stripTrailingSlash(
  process.env.MEMPOOL_BASE_TESTNET4 ?? "https://mempool.space/testnet4",
);
const ELECTRUM_HOST = process.env.ELECTRUM_HOST ?? "127.0.0.1";
const ELECTRUM_PORT = Number(process.env.ELECTRUM_PORT ?? 50001);
const MAX_REGISTRY_TX_PAGES = Number(process.env.MAX_REGISTRY_TX_PAGES ?? 250);
const MAX_ADDRESS_TX_PAGES = Number(process.env.MAX_ADDRESS_TX_PAGES ?? 50);
const MAX_ACTIVITY_ADDRESSES = Number(
  process.env.MAX_ACTIVITY_ADDRESSES ?? 500,
);
const MAX_ACTIVITY_ADDRESS_GRAPH_PASSES = Number(
  process.env.MAX_ACTIVITY_ADDRESS_GRAPH_PASSES ?? 1,
);
const ACTIVITY_CACHE_TTL_MS = Number(
  process.env.ACTIVITY_CACHE_TTL_MS ?? 60_000,
);
const ACTIVITY_CACHE_STALE_MS = Number(
  process.env.ACTIVITY_CACHE_STALE_MS ?? 3_600_000,
);
const DERIVED_APP_CACHE_TTL_MS = Number(
  process.env.DERIVED_APP_CACHE_TTL_MS ?? 15 * 60_000,
);
const DERIVED_APP_CACHE_STALE_MS = Number(
  process.env.DERIVED_APP_CACHE_STALE_MS ?? 3_600_000,
);
const RESPONSE_CACHE_TTL_MS = Number(
  process.env.RESPONSE_CACHE_TTL_MS ?? 15_000,
);
const RESPONSE_CACHE_STALE_MS = Number(
  process.env.RESPONSE_CACHE_STALE_MS ?? 120_000,
);
const TOKEN_CACHE_TTL_MS = Number(process.env.TOKEN_CACHE_TTL_MS ?? 30_000);
const TOKEN_CACHE_STALE_MS = Number(
  process.env.TOKEN_CACHE_STALE_MS ?? 5 * 60_000,
);
const TX_FETCH_CONCURRENCY = Number(process.env.TX_FETCH_CONCURRENCY ?? 8);
const BLOCK_TXID_FETCH_CONCURRENCY = Number(
  process.env.BLOCK_TXID_FETCH_CONCURRENCY ?? 4,
);
const MAX_TRANSACTION_CACHE_SIZE = Number(
  process.env.MAX_TRANSACTION_CACHE_SIZE ?? 100_000,
);
const PERSISTED_CACHE_DIR =
  process.env.POW_API_CACHE_DIR ?? path.join(process.cwd(), ".pow-api-cache");
const SLIPSTREAM_SUBMIT_TX_URL = "https://slipstream.mara.com/rest-api/submit-tx";
const SLIPSTREAM_TX_URL = "https://slipstream.mara.com/tx";

const PROTOCOL_PREFIX = "pwm1:";
const ID_PROTOCOL_PREFIX = "pwid1:";
const PAY2SPEAK_PROTOCOL_PREFIX = "pws1:";
const TOKEN_PROTOCOL_PREFIX = "pwt1:";
const RUSH_PROTOCOL_PREFIX = "pwr1:";
const RUSH_MINT_PAYLOAD = "pwr1:m:rush";
const ID_REGISTRATION_PRICE_SATS = 1000;
const ID_MUTATION_PRICE_SATS = 546;
const PAY2SPEAK_REGISTRY_PRICE_SATS = 1000;
const PAY2SPEAK_SPLIT_THRESHOLD_SATS = 5460;
const AK_PROTOCOL_MINT = '{"p":"nft","op":"mint","name":"ak21"}';
const AK_OPERATOR_ADDRESS = "bc1qyh9pgznpass4mjcl8qj9yxs3vvl9rnrk7whapn";
const NFT_DEPLOY_FEE_ADDRESS = AK_OPERATOR_ADDRESS;
const NFT_DEPLOY_MIN_FEE_SATS = 1000;
const AK_OPERATOR_MIN_SATS = 1000;
const AK_OWNER_ANCHOR_SATS = 762;
const NFT_COLLECTIONS = [
  {
    defaultOperatorAddress: AK_OPERATOR_ADDRESS,
    description:
      "AK21 visual NFT mints with an operator payment, mint JSON, owner anchor, optional Genesis Tag, and image OP_RETURN.",
    displayName: "AK",
    id: "ak21",
    maxSupply: 1000,
    mintProtocolPayload: AK_PROTOCOL_MINT,
    name: "ak21",
    operatorMinSats: AK_OPERATOR_MIN_SATS,
    ownerAnchorSats: AK_OWNER_ANCHOR_SATS,
    slug: "ak",
  },
];
const TOKEN_CREATE_ACTION = "create";
const TOKEN_MINT_ACTION = "mint";
const TOKEN_CREATION_PRICE_SATS = 546;
const TOKEN_MIN_MUTATION_PRICE_SATS = 546;
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
const WORK_TOKEN_DEFAULT_REGISTRY_ADDRESS =
  "1638Vn6KtmK8p5r4oGvAXq9nmZb1emU1DV";
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
const PAY2SPEAK_REGISTRY_ADDRESSES = {
  livenet: "bc1q4k34zlkgwtuhfpfrcpml2ajvj66x22x20an2t4",
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
const GLOBAL_ACTIVITY_CACHE = new Map();
const RESPONSE_CACHE = new Map();
const READ_CACHE_CONTROL =
  "public, max-age=15, stale-while-revalidate=60, stale-if-error=120";
const EXPENSIVE_READ_CACHE_CONTROL =
  "public, max-age=60, stale-while-revalidate=3600, stale-if-error=3600";
const TOKEN_READ_CACHE_CONTROL =
  "public, max-age=30, stale-while-revalidate=300, stale-if-error=300";
const FRESH_READ_CACHE_CONTROL = "no-store, max-age=0, must-revalidate";

function stripTrailingSlash(value) {
  return String(value).replace(/\/+$/u, "");
}

function shouldPersistJsonCache(cacheKey) {
  return (
    cacheKey === "activity:livenet" || cacheKey.startsWith("token:livenet:")
  );
}

function persistedJsonCachePath(jsonKey) {
  const file = Buffer.from(jsonKey).toString("base64url") + ".json";
  return path.join(PERSISTED_CACHE_DIR, file);
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
    const tempFile = `${file}.${process.pid}.${Date.now()}.tmp`;
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

function mempoolBase(network) {
  if (network === "testnet4") {
    return MEMPOOL_BASE_TESTNET4;
  }

  if (network === "testnet") {
    return MEMPOOL_BASE_TESTNET;
  }

  return MEMPOOL_BASE_MAINNET;
}

function pendingMempoolBases(network) {
  if (network !== "livenet") {
    return [mempoolBase(network)];
  }

  return [
    ...new Set(
      [MEMPOOL_BASE_MAINNET, PENDING_MEMPOOL_BASE_MAINNET].filter(Boolean),
    ),
  ];
}

function registryAddressForNetwork(network) {
  return ID_REGISTRY_ADDRESSES[network] ?? "";
}

function pay2SpeakRegistryAddressForNetwork(network) {
  return PAY2SPEAK_REGISTRY_ADDRESSES[network] ?? "";
}

function tokenIndexAddressForNetwork(network) {
  return TOKEN_INDEX_ADDRESSES[network] ?? "";
}

async function fetchJson(url) {
  const response = await fetch(url, {
    headers: {
      Accept: "application/json",
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

async function submitSlipstreamTransaction(txHex) {
  const response = await fetch(SLIPSTREAM_SUBMIT_TX_URL, {
    body: JSON.stringify({ tx_hex: txHex }),
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
    throw new Error(
      payload?.error ??
        payload?.message ??
        responseText ??
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

  return submitSlipstreamTransaction(txHex);
}

async function fetchBlockTxidIndex(blockHash, network) {
  if (!/^[0-9a-fA-F]{64}$/u.test(blockHash)) {
    return new Map();
  }

  const normalizedHash = blockHash.toLowerCase();
  const cacheKey = `${network}:${normalizedHash}`;
  if (!BLOCK_TXID_INDEX_CACHE.has(cacheKey)) {
    const promise = fetchJson(
      `${mempoolBase(network)}/api/block/${normalizedHash}/txids`,
    )
      .then((txids) => {
        const index = new Map();
        if (Array.isArray(txids)) {
          txids.forEach((txid, position) => {
            if (typeof txid === "string" && /^[0-9a-fA-F]{64}$/u.test(txid)) {
              index.set(txid.toLowerCase(), position);
            }
          });
        }
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

  return dedupeTransactions(
    pages.flatMap((page) => (page.status === "fulfilled" ? page.value : [])),
  );
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

  const txs = await mapWithConcurrency(
    txids,
    TX_FETCH_CONCURRENCY,
    async (txid) => {
      try {
        return await fetchTransaction(txid, network);
      } catch {
        return null;
      }
    },
  );

  return dedupeTransactions(txs.filter(Boolean));
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
    } catch {
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
        message.startsWith(PAY2SPEAK_PROTOCOL_PREFIX) ||
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

function firstPay2SpeakOutputIndex(vout) {
  return vout.findIndex((output) => {
    if (output.scriptpubkey_type !== "op_return") {
      return false;
    }

    return (
      decodedProtocolMessages([output], PAY2SPEAK_PROTOCOL_PREFIX).length > 0
    );
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

function pay2SpeakPaymentAmountBeforeProtocol(vout, address) {
  const protocolIndex = firstPay2SpeakOutputIndex(vout);
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

  return null;
}

function normalizeTokenScope(value) {
  const raw = String(value ?? "").trim();
  if (/^[0-9a-fA-F]{64}$/u.test(raw)) {
    return raw.toLowerCase();
  }

  return normalizeTokenTicker(raw);
}

function tokenMatchesScope(token, scope) {
  if (!scope) {
    return true;
  }

  return token.tokenId === scope || token.ticker === scope;
}

function emptyTokenState() {
  return {
    creationSats: 0,
    confirmedSupply: 0,
    holders: [],
    mints: [],
    pendingSupply: 0,
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
        tokens.some((token) => token.tokenId === txid)
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
) {
  const { tokens: allTokens } = tokenDefinitionsFromTransactions(
    indexTxs,
    indexAddress,
    network,
  );
  const scope = normalizeTokenScope(tokenScope);
  const tokens = allTokens.filter((token) => tokenMatchesScope(token, scope));
  const creationSats = tokens.reduce(
    (total, token) => total + token.creationFeeSats,
    0,
  );
  const tokensById = new Map(tokens.map((token) => [token.tokenId, token]));
  const tokenSupply = new Map();
  const balances = new Map();
  const mints = [];
  let confirmedSupply = 0;
  let pendingSupply = 0;

  for (const token of tokens) {
    const txs = registryTxsByAddress.get(token.registryAddress) ?? [];
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

      let remainingRegistrySats = tokenPaymentAmountBeforeProtocol(
        vout,
        token.registryAddress,
      );
      const confirmed = transactionConfirmed(tx);
      const createdAt = new Date(tokenTransactionTime(tx)).toISOString();

      for (const message of messages) {
        const parsed = parseTokenPayload(message, network);
        if (!parsed || parsed.kind !== "mint") {
          continue;
        }

        const mintedToken = tokensById.get(parsed.tokenId);
        if (
          !mintedToken ||
          mintedToken.registryAddress !== token.registryAddress ||
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
          const balanceKey = `${mintedToken.tokenId}:${actorAddress}`;
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
      }
    }
  }

  return {
    creationSats,
    confirmedSupply,
    holders: [...balances.entries()]
      .map(([key, balance]) => ({
        address: String(key).split(":").slice(1).join(":"),
        balance,
      }))
      .sort(
        (left, right) =>
          right.balance - left.balance ||
          left.address.localeCompare(right.address),
      ),
    mints: mints.sort(
      (left, right) =>
        Number(right.confirmed) - Number(left.confirmed) ||
        Date.parse(right.createdAt) - Date.parse(left.createdAt) ||
        left.txid.localeCompare(right.txid),
    ),
    pendingSupply,
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

function normalizeXHandle(value) {
  return String(value ?? "")
    .trim()
    .replace(/^@+/u, "")
    .toLowerCase();
}

function pay2SpeakFundingSplit(grossSats) {
  const gross = Math.floor(grossSats);
  if (!Number.isSafeInteger(gross) || gross <= PAY2SPEAK_REGISTRY_PRICE_SATS) {
    throw new Error("Contribution must be greater than 1,000 sats.");
  }

  const registrySats =
    gross < PAY2SPEAK_SPLIT_THRESHOLD_SATS
      ? PAY2SPEAK_REGISTRY_PRICE_SATS
      : Math.floor(gross / 10);
  return { creatorSats: gross - registrySats, grossSats: gross, registrySats };
}

function parsePay2SpeakPayload(message) {
  if (!message.startsWith(PAY2SPEAK_PROTOCOL_PREFIX)) {
    return null;
  }

  const parts = message.slice(PAY2SPEAK_PROTOCOL_PREFIX.length).split(":");
  if (parts[0] === "c" && parts.length === 4) {
    const spaceNumber = Number(parts[1]);
    const handle = normalizeXHandle(parts[2]);
    const targetGrossSats = Number(parts[3]);
    if (
      !Number.isSafeInteger(spaceNumber) ||
      spaceNumber < 0 ||
      !/^[a-z0-9_]{1,15}$/u.test(handle) ||
      !Number.isSafeInteger(targetGrossSats) ||
      targetGrossSats <= PAY2SPEAK_REGISTRY_PRICE_SATS
    ) {
      return null;
    }

    return { handle, kind: "campaign", spaceNumber, targetGrossSats };
  }

  if (
    parts[0] === "f" &&
    parts.length >= 2 &&
    parts.length <= 3 &&
    /^[0-9a-fA-F]{64}$/u.test(parts[1] ?? "")
  ) {
    let question = "";
    try {
      question = parts[2]
        ? decodeTextBase64Url(parts[2]).trim().slice(0, 500)
        : "";
    } catch {
      return null;
    }

    return {
      campaignId: parts[1].toLowerCase(),
      kind: "funding",
      question: question || undefined,
    };
  }

  return null;
}

function pay2SpeakTitle(handle, spaceNumber) {
  return `@${handle} Space #${spaceNumber}`;
}

function comparePay2SpeakCampaigns(left, right) {
  if (left.confirmed !== right.confirmed) {
    return Number(right.confirmed) - Number(left.confirmed);
  }

  return (
    Date.parse(right.createdAt) - Date.parse(left.createdAt) ||
    left.txid.localeCompare(right.txid)
  );
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
    const base = {
      amountSats: event.amountSats,
      actor: event.inputAddresses[0],
      confirmed: event.confirmed,
      createdAt: event.createdAt,
      dataBytes: event.dataBytes ?? 0,
      network: event.network,
      tags: [
        status,
        networkLabel(event.network),
        `${event.amountSats.toLocaleString()} sats`,
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
        description: `${event.id}@proofofwork.me listed for ${event.priceSats.toLocaleString()} sats by ${shortAddress(event.sellerAddress)}.`,
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
          `${event.priceSats.toLocaleString()} sale sats`,
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
        event.priceSats ? `${event.priceSats.toLocaleString()} sale sats` : "",
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
  return `${item.kind}:${item.network}:${item.txid}:${item.listingId ?? ""}:${item.id ?? ""}`;
}

function dedupeActivityItems(items) {
  const merged = new Map();

  for (const item of items) {
    if (!item?.txid) {
      continue;
    }

    const key = activityKey(item);
    const current = merged.get(key);
    if (!current || (item.confirmed && !current.confirmed)) {
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
  const kind = isFile ? "file" : isReply ? "reply" : "mail";
  const noun = isFile ? "file" : isReply ? "reply" : "mail";
  const title = `${isFile ? "File" : isReply ? "Reply" : "Mail"} ${confirmed ? "sent" : "pending"}`;
  const detail = protocolMessage.attachment
    ? `${protocolMessage.attachment.name} · ${formatBytes(protocolMessage.attachment.size)} · ${protocolMessage.attachment.mime}`
    : protocolMessage.subject
      ? `Subject: ${protocolMessage.subject}`
      : compactText(protocolMessage.memo, 120) || "No message body";

  return {
    amountSats,
    actor,
    confirmed,
    counterparty,
    createdAt,
    dataBytes: proofProtocolDataBytesForVout(vout),
    description: `${shortAddress(actor)} sent ${noun} to ${counterparty}${amountSats > 0 ? ` for ${amountSats.toLocaleString()} sats` : ""}.`,
    detail,
    kind,
    network,
    tags: [
      activityStatusTag(confirmed),
      networkLabel(network),
      isFile ? "Attachment" : isReply ? "Reply" : "Message",
      isBrowserHtmlMessageBody(protocolMessage.memo) ? "HTML body" : "",
      recipients.length > 1 ? `${recipients.length} recipients` : "1 recipient",
      amountSats > 0 ? `${amountSats.toLocaleString()} sats` : "",
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

function pay2SpeakActivityItemsFromState(state, registryAddress) {
  const campaigns = (state.campaigns ?? []).map((campaign) => ({
    amountSats: campaign.registrySats,
    actor: campaign.creatorAddress,
    confirmed: campaign.confirmed,
    counterparty: registryAddress,
    createdAt: campaign.createdAt,
    dataBytes: campaign.dataBytes,
    description: `${campaign.title} opened by ${shortAddress(campaign.creatorAddress)} with a ${campaign.targetGrossSats.toLocaleString()} sat target.`,
    detail: `Space ${campaign.spaceNumber.toLocaleString()} · @${campaign.handle}`,
    kind: "pay2speak-campaign",
    network: campaign.network,
    tags: [
      activityStatusTag(campaign.confirmed),
      networkLabel(campaign.network),
      "Pay2Speak",
      "Campaign",
      `${campaign.registrySats.toLocaleString()} registry sats`,
    ],
    title: campaign.confirmed
      ? "Pay2Speak campaign"
      : "Pay2Speak campaign pending",
    txid: campaign.txid,
  }));

  const funding = (state.funding ?? []).map((item) => ({
    amountSats: item.grossSats,
    actor: item.donorAddress,
    confirmed: item.confirmed,
    counterparty: item.creatorAddress,
    createdAt: item.createdAt,
    dataBytes: item.dataBytes,
    description: `${shortAddress(item.donorAddress)} funded ${shortAddress(item.creatorAddress)} with ${item.grossSats.toLocaleString()} gross sats.`,
    detail: item.question
      ? `Question: ${compactText(item.question, 120)}`
      : `Campaign ${shortAddress(item.campaignId)}`,
    kind: "pay2speak-funding",
    network: item.network,
    tags: [
      activityStatusTag(item.confirmed),
      networkLabel(item.network),
      "Pay2Speak",
      item.question ? "Question" : "Funding",
      `${item.creatorSats.toLocaleString()} creator sats`,
      `${item.registrySats.toLocaleString()} registry sats`,
    ],
    title: item.confirmed
      ? item.question
        ? "Funded question"
        : "Campaign funding"
      : item.question
        ? "Funded question pending"
        : "Campaign funding pending",
    txid: item.txid,
  }));

  return [...campaigns, ...funding];
}

function akActivityItemsFromState(state) {
  const deploys = (state.collections ?? [])
    .filter((collection) => collection?.txid)
    .map((collection) => ({
      amountSats: collection.deployFeeSats,
      actor: collection.operatorAddress ?? collection.defaultOperatorAddress,
      confirmed: collection.confirmed,
      counterparty: NFT_DEPLOY_FEE_ADDRESS,
      createdAt: collection.createdAt,
      dataBytes: collection.dataBytes,
      description: `${collection.displayName ?? collection.name ?? "NFT"} NFT collection deployed by ${shortAddress(collection.operatorAddress ?? collection.defaultOperatorAddress)}.`,
      detail: collection.genesisTag
        ? `Genesis Tag: ${compactText(collection.genesisTag, 120)}`
        : `${Number(collection.maxSupply ?? 0).toLocaleString()} max supply`,
      kind: "ak-deploy",
      network: collection.network,
      tags: [
        activityStatusTag(collection.confirmed),
        networkLabel(collection.network),
        "AK",
        "NFT",
        "Deploy",
        `${Number(collection.deployFeeSats ?? 0).toLocaleString()} deploy sats`,
      ],
      title: collection.confirmed
        ? "NFT collection deployed"
        : "NFT collection deploy pending",
      txid: collection.txid,
    }));

  const mints = (state.mints ?? []).map((mint) => ({
    amountSats: mint.operatorSats,
    actor: mint.ownerAddress,
    confirmed: mint.confirmed,
    counterparty: mint.operatorAddress,
    createdAt: mint.createdAt,
    dataBytes: mint.dataBytes,
    description: `${shortAddress(mint.ownerAddress)} minted an AK NFT.`,
    detail: mint.genesisTag
      ? `Genesis Tag: ${compactText(mint.genesisTag, 120)}`
      : `Token ${mint.tokenIdentifier}`,
    kind: "ak-mint",
    network: mint.network,
    tags: [
      activityStatusTag(mint.confirmed),
      networkLabel(mint.network),
      "AK",
      "NFT",
      `${mint.operatorSats.toLocaleString()} operator sats`,
    ],
    title: mint.confirmed ? "AK minted" : "AK mint pending",
    txid: mint.txid,
  }));

  return [...deploys, ...mints];
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
    detail: `${token.mintAmount.toLocaleString()} ${token.ticker} for ${token.mintPriceSats.toLocaleString()} sats`,
    kind: "token-create",
    network: token.network,
    tags: [
      activityStatusTag(token.confirmed),
      networkLabel(token.network),
      "Token",
      "Creation",
      token.ticker,
      `${token.creationFeeSats.toLocaleString()} creation sats`,
    ],
    title: token.confirmed ? "Token created" : "Token creation pending",
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
    detail: `Token ${shortAddress(mint.tokenId)}`,
    kind: "token-mint",
    network: mint.network,
    tags: [
      activityStatusTag(mint.confirmed),
      networkLabel(mint.network),
      "Token",
      "Mint",
      mint.ticker,
      `${mint.amount.toLocaleString()} ${mint.ticker}`,
      `${mint.paidSats.toLocaleString()} mint sats`,
    ],
    title: mint.confirmed ? "Token mint" : "Token mint pending",
    txid: mint.txid,
  }));

  return [...creations, ...mints];
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
    tags: [
      activityStatusTag(mint.confirmed),
      networkLabel(mint.network),
      "RUSH",
      "Token",
      "Mint",
      `${mint.amount} RUSH`,
      `${mint.paidSats.toLocaleString()} registry sats`,
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

function activityAddressesFromRegistry(registry, network) {
  const addresses = new Set();

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

function cachedPay2SpeakPayload(network) {
  return cachedPayload(
    `payload:pay2speak:${network}`,
    () => pay2SpeakPayload(network),
    DERIVED_APP_CACHE_TTL_MS,
    DERIVED_APP_CACHE_STALE_MS,
  );
}

function cachedAkPayload(
  network,
  ownerFilter = "",
  collectionId = "",
  operatorAddressInput = "",
) {
  return cachedPayload(
    `payload:nft:${network}:${collectionId}:${operatorAddressInput}:${ownerFilter}`,
    () => akPayload(network, ownerFilter, collectionId, operatorAddressInput),
    DERIVED_APP_CACHE_TTL_MS,
    DERIVED_APP_CACHE_STALE_MS,
  );
}

function cachedTokenPayload(network, tokenScope = "") {
  const scope = normalizeTokenScope(tokenScope);
  return cachedPayload(
    `payload:token:${network}:${scope}`,
    () => tokenPayload(network, scope),
    TOKEN_CACHE_TTL_MS,
    TOKEN_CACHE_STALE_MS,
  );
}

function cachedRushPayload(network) {
  return cachedPayload(
    `payload:rush:${network}`,
    () => rushPayload(network),
    TOKEN_CACHE_TTL_MS,
    TOKEN_CACHE_STALE_MS,
  );
}

async function globalActivityPayload(network) {
  const cacheKey = network;
  const cached = GLOBAL_ACTIVITY_CACHE.get(cacheKey);
  if (cached && Date.now() - cached.createdAt < ACTIVITY_CACHE_TTL_MS) {
    return cached.payload;
  }

  const registry = await registryPayload(network);
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
            return await fetchAddressTransactionsViaMempoolPagination(
              address,
              network,
              3,
            );
          } catch {
            return [];
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
  const [pay2SpeakState, akState, tokenState, rushState] = await Promise.all([
    cachedPay2SpeakPayload(network).catch(() => null),
    cachedAkPayload(network).catch(() => null),
    cachedTokenPayload(network).catch(() => null),
    cachedRushPayload(network).catch(() => null),
  ]);
  const pay2SpeakActivity = pay2SpeakState
    ? pay2SpeakActivityItemsFromState(
        pay2SpeakState,
        pay2SpeakState.registryAddress ?? "",
      )
    : [];
  const tokenActivity = tokenState
    ? tokenActivityItemsFromState(tokenState, tokenState.indexAddress ?? "")
    : [];
  const akActivity = akState ? akActivityItemsFromState(akState) : [];
  const rushActivity = rushState ? rushActivityItemsFromState(rushState) : [];
  const activity = dedupeActivityItems([
    ...(registry.activity ?? []),
    ...mailActivity,
    ...pay2SpeakActivity,
    ...akActivity,
    ...tokenActivity,
    ...rushActivity,
  ]);
  const dataBytes = totalProtocolDataBytes(activity);
  const fileActions = activity.filter((item) => item.kind === "file").length;
  const messageActions = activity.filter(
    (item) => item.kind === "mail" || item.kind === "reply",
  ).length;
  const pay2SpeakActions = activity.filter((item) =>
    String(item.kind).startsWith("pay2speak-"),
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
      messages: messageActions,
      pay2Speak: pay2SpeakActions,
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

function pay2SpeakStateFromTransactions(txs, registryAddress, network) {
  const campaignMap = new Map();
  const candidateFunding = [];

  for (const tx of txs) {
    const txid = transactionTxid(tx);
    if (!txid) {
      continue;
    }

    const vin = Array.isArray(tx.vin) ? tx.vin : [];
    const vout = Array.isArray(tx.vout) ? tx.vout : [];
    const messages = decodedProtocolMessages(vout, PAY2SPEAK_PROTOCOL_PREFIX);
    if (messages.length === 0) {
      continue;
    }

    const confirmed = transactionConfirmed(tx);
    const createdAt = new Date(
      typeof tx.status?.block_time === "number"
        ? tx.status.block_time * 1000
        : Date.now(),
    ).toISOString();
    const actorAddress = inputAddresses(vin)[0] ?? "Unknown";
    const registrySats = pay2SpeakPaymentAmountBeforeProtocol(
      vout,
      registryAddress,
    );

    for (const message of messages) {
      const parsed = parsePay2SpeakPayload(message);
      if (!parsed) {
        continue;
      }

      if (parsed.kind === "campaign") {
        if (
          registrySats < PAY2SPEAK_REGISTRY_PRICE_SATS ||
          !isValidBitcoinAddress(actorAddress, network)
        ) {
          continue;
        }

        campaignMap.set(txid, {
          confirmed,
          createdAt,
          creatorAddress: actorAddress,
          dataBytes: proofProtocolDataBytesForVout(vout),
          fundedGrossSats: 0,
          fundingCount: 0,
          handle: parsed.handle,
          network,
          registrySats,
          spaceNumber: parsed.spaceNumber,
          status: "Funding",
          targetGrossSats: parsed.targetGrossSats,
          title: pay2SpeakTitle(parsed.handle, parsed.spaceNumber),
          txid,
        });
        continue;
      }

      candidateFunding.push({
        campaignId: parsed.campaignId,
        confirmed,
        createdAt,
        dataBytes: proofProtocolDataBytesForVout(vout),
        donorAddress: actorAddress,
        network,
        question: parsed.question,
        registrySats,
        txid,
      });
    }
  }

  const funding = candidateFunding.flatMap((candidate) => {
    const campaign = campaignMap.get(candidate.campaignId);
    if (!campaign) {
      return [];
    }

    const tx = txs.find((item) => transactionTxid(item) === candidate.txid);
    const vout = Array.isArray(tx?.vout) ? tx.vout : [];
    const creatorSats = pay2SpeakPaymentAmountBeforeProtocol(
      vout,
      campaign.creatorAddress,
    );
    const grossSats = creatorSats + candidate.registrySats;
    let split;
    try {
      split = pay2SpeakFundingSplit(grossSats);
    } catch {
      return [];
    }

    if (
      split.registrySats !== candidate.registrySats ||
      split.creatorSats !== creatorSats
    ) {
      return [];
    }

    return [
      {
        ...candidate,
        creatorAddress: campaign.creatorAddress,
        creatorSats,
        grossSats,
      },
    ];
  });

  for (const item of funding) {
    const campaign = campaignMap.get(item.campaignId);
    if (!campaign) {
      continue;
    }

    campaign.fundedGrossSats += item.grossSats;
    campaign.fundingCount += 1;
    campaign.status =
      campaign.fundedGrossSats >= campaign.targetGrossSats
        ? "Funded"
        : "Funding";
  }

  const questions = funding
    .filter((item) => item.question)
    .map((item) => ({
      campaignId: item.campaignId,
      confirmed: item.confirmed,
      createdAt: item.createdAt,
      grossSats: item.grossSats,
      question: item.question,
      txid: item.txid,
    }))
    .sort(
      (left, right) =>
        right.grossSats - left.grossSats ||
        Date.parse(right.createdAt) - Date.parse(left.createdAt),
    );

  return {
    campaigns: [...campaignMap.values()].sort(comparePay2SpeakCampaigns),
    funding: funding.sort(
      (left, right) => Date.parse(right.createdAt) - Date.parse(left.createdAt),
    ),
    questions,
  };
}

function isAkImagePayload(payload) {
  const value = String(payload ?? "").trim();
  return value.startsWith("data:image/") || value.startsWith("iVBORw0KGgo");
}

function normalizeAkImagePayload(payload) {
  const value = String(payload ?? "").trim();
  if (value.startsWith("data:image/")) {
    return value;
  }

  return `data:image/png;base64,${value}`;
}

function akImageBase64(payload) {
  const value = String(payload ?? "").trim();
  if (!value.startsWith("data:image/")) {
    return value;
  }

  const comma = value.indexOf(",");
  return comma >= 0 ? value.slice(comma + 1) : "";
}

function akDataBytes(protocolPayload, genesisTag, imagePayload) {
  return [protocolPayload, genesisTag ?? "", imagePayload]
    .filter(Boolean)
    .reduce((total, payload) => total + Buffer.byteLength(payload, "utf8"), 0);
}

function parseNftDeployPayload(payload) {
  try {
    const parsed = JSON.parse(String(payload ?? ""));
    if (parsed?.p !== "nft" || parsed?.op !== "deploy") {
      return null;
    }

    const name = String(parsed.name ?? "").trim();
    const maxSupply = Number.parseInt(String(parsed.amt ?? ""), 10);
    if (!name || !Number.isSafeInteger(maxSupply) || maxSupply <= 0) {
      return null;
    }

    return { maxSupply, name };
  } catch {
    return null;
  }
}

function transactionInputAddresses(vin) {
  return (Array.isArray(vin) ? vin : [])
    .map((input) => input?.prevout?.scriptpubkey_address)
    .filter((address) => typeof address === "string" && address);
}

function nftDeployFeeAmount(vout) {
  return (Array.isArray(vout) ? vout : []).reduce((total, output) => {
    if (
      output?.scriptpubkey_address === NFT_DEPLOY_FEE_ADDRESS &&
      typeof output.value === "number"
    ) {
      return total + output.value;
    }

    return total;
  }, 0);
}

function parseNftDeployTransaction(tx, network) {
  const txid = transactionTxid(tx);
  if (!txid) {
    return null;
  }

  const operatorAddress = transactionInputAddresses(tx.vin)[0] ?? "";
  if (!isValidBitcoinAddress(operatorAddress, network)) {
    return null;
  }

  const vout = Array.isArray(tx.vout) ? tx.vout : [];
  const deployRecord = parseNftDeployPayload(decodedOpReturnAt(vout, 0));
  if (!deployRecord) {
    return null;
  }

  const deployFeeSats = nftDeployFeeAmount(vout);
  if (deployFeeSats < NFT_DEPLOY_MIN_FEE_SATS) {
    return null;
  }

  const genesisTag = decodedOpReturnAt(vout, 1).trim() || null;
  const imagePayload = decodedOpReturnAt(vout, 2);
  if (!isAkImagePayload(imagePayload)) {
    return null;
  }

  const blockTime =
    typeof tx.status?.block_time === "number"
      ? tx.status.block_time * 1000
      : Date.now();
  const normalizedName = deployRecord.name.toLowerCase();

  return {
    confirmed: transactionConfirmed(tx),
    createdAt: new Date(blockTime).toISOString(),
    dataBytes: akDataBytes(decodedOpReturnAt(vout, 0), genesisTag, imagePayload),
    defaultOperatorAddress: operatorAddress,
    deployedHeight: transactionBlockHeight(tx),
    deployedTime:
      typeof tx.status?.block_time === "number"
        ? tx.status.block_time
        : undefined,
    deployFeeSats,
    description:
      genesisTag ??
      `${deployRecord.name} NFT collection deployed by ${shortAddress(operatorAddress)}.`,
    displayName: deployRecord.name,
    genesisTag,
    id: normalizedName,
    imageBase64: akImageBase64(imagePayload),
    imageDataUrl: normalizeAkImagePayload(imagePayload),
    maxSupply: deployRecord.maxSupply,
    mintProtocolPayload: JSON.stringify({
      p: "nft",
      op: "mint",
      name: normalizedName,
    }),
    name: deployRecord.name,
    network,
    operatorAddress,
    operatorMinSats: AK_OPERATOR_MIN_SATS,
    ownerAnchorSats: AK_OWNER_ANCHOR_SATS,
    slug: normalizedName,
    txid,
  };
}

function compareNftCollections(left, right) {
  if (left.confirmed !== right.confirmed) {
    return Number(right.confirmed) - Number(left.confirmed);
  }

  return (
    Date.parse(right.createdAt) - Date.parse(left.createdAt) ||
    left.txid.localeCompare(right.txid)
  );
}

function nftKnownCollectionRecords(network) {
  return NFT_COLLECTIONS.map((collection) => ({
    ...collection,
    confirmed: true,
    createdAt: "2026-05-05T11:21:44.000Z",
    deployFeeSats: NFT_DEPLOY_MIN_FEE_SATS,
    genesisTag: null,
    imageBase64: "",
    imageDataUrl: "",
    network,
    operatorAddress: collection.defaultOperatorAddress,
    txid: "",
  }));
}

function mergeNftCollections(indexed, network) {
  const byKey = new Map();
  for (const collection of nftKnownCollectionRecords(network)) {
    byKey.set(
      `${collection.name.toLowerCase()}:${collection.operatorAddress.toLowerCase()}`,
      collection,
    );
  }
  for (const collection of indexed) {
    byKey.set(
      `${collection.name.toLowerCase()}:${collection.operatorAddress.toLowerCase()}`,
      collection,
    );
  }
  return [...byKey.values()].sort(compareNftCollections);
}

function nftSyntheticCollectionDefinition(name, operatorAddress = "") {
  const trimmedName = String(name ?? "").trim();
  const normalizedName = (trimmedName || "nft").toLowerCase();
  return {
    defaultOperatorAddress: operatorAddress || AK_OPERATOR_ADDRESS,
    description: `${trimmedName || "NFT"} NFT collection.`,
    displayName: trimmedName || "NFT",
    id: normalizedName,
    maxSupply: 0,
    mintProtocolPayload: JSON.stringify({
      p: "nft",
      op: "mint",
      name: normalizedName,
    }),
    name: trimmedName || normalizedName,
    operatorMinSats: AK_OPERATOR_MIN_SATS,
    ownerAnchorSats: AK_OWNER_ANCHOR_SATS,
    slug: normalizedName,
  };
}

function nftCollectionByNameAndOperator(value, operatorAddressInput = "") {
  const normalized = String(value ?? "").trim().toLowerCase();
  const normalizedOperator = String(operatorAddressInput ?? "").trim().toLowerCase();
  if (!normalized) {
    return NFT_COLLECTIONS[0];
  }
  const matches = NFT_COLLECTIONS.filter(
    (collection) =>
      collection.id.toLowerCase() === normalized ||
      collection.name.toLowerCase() === normalized ||
      collection.slug.toLowerCase() === normalized,
  );

  if (normalizedOperator) {
    const operatorMatch = matches.find(
      (collection) =>
        collection.defaultOperatorAddress.toLowerCase() === normalizedOperator,
    );
    if (operatorMatch) {
      return operatorMatch;
    }
  }

  if (matches.length > 0) {
    return matches[0];
  }

  return (
    NFT_COLLECTIONS.find(
      (collection) =>
        normalizedOperator &&
        collection.defaultOperatorAddress.toLowerCase() === normalizedOperator,
    ) ?? nftSyntheticCollectionDefinition(value, operatorAddressInput)
  );
}

function nftOperatorAddress(collection, value) {
  const operatorAddress = String(value ?? "").trim();
  return operatorAddress || collection.defaultOperatorAddress;
}

function parseAkMintTransaction(
  tx,
  network,
  collection = NFT_COLLECTIONS[0],
  operatorAddress = collection.defaultOperatorAddress,
) {
  const txid = transactionTxid(tx);
  if (!txid) {
    return null;
  }

  const vout = Array.isArray(tx.vout) ? tx.vout : [];
  const operatorOutput = vout[0];
  if (
    operatorOutput?.scriptpubkey_address !== operatorAddress ||
    typeof operatorOutput.value !== "number" ||
    operatorOutput.value < collection.operatorMinSats
  ) {
    return null;
  }

  const mintPayload = decodedOpReturnAt(vout, 1);
  if (mintPayload !== collection.mintProtocolPayload) {
    return null;
  }

  const ownerOutput = vout[2];
  const ownerAddress = ownerOutput?.scriptpubkey_address;
  if (
    typeof ownerAddress !== "string" ||
    !isValidBitcoinAddress(ownerAddress, network) ||
    typeof ownerOutput.value !== "number" ||
    ownerOutput.value < collection.ownerAnchorSats
  ) {
    return null;
  }

  const vout3Payload = decodedOpReturnAt(vout, 3);
  if (!vout3Payload) {
    return null;
  }

  let genesisTag = null;
  let imagePayload = "";
  if (isAkImagePayload(vout3Payload)) {
    imagePayload = vout3Payload;
  } else {
    genesisTag = vout3Payload.trim() || null;
    imagePayload = decodedOpReturnAt(vout, 4);
  }

  if (!isAkImagePayload(imagePayload)) {
    return null;
  }

  const blockTime =
    typeof tx.status?.block_time === "number"
      ? tx.status.block_time * 1000
      : Date.now();
  return {
    confirmed: transactionConfirmed(tx),
    collectionId: collection.id,
    collectionName: collection.name,
    createdAt: new Date(blockTime).toISOString(),
    dataBytes: akDataBytes(mintPayload, genesisTag, imagePayload),
    genesisTag,
    imageBase64: akImageBase64(imagePayload),
    imageDataUrl: normalizeAkImagePayload(imagePayload),
    mintedHeight: transactionBlockHeight(tx),
    mintedTime:
      typeof tx.status?.block_time === "number"
        ? tx.status.block_time
        : undefined,
    network,
    operatorAddress,
    operatorSats: operatorOutput.value,
    ownerAddress,
    tokenIdentifier: `${txid}:2`,
    txid,
    voutIndex: 2,
  };
}

function compareAkMints(left, right) {
  if (left.confirmed !== right.confirmed) {
    return Number(right.confirmed) - Number(left.confirmed);
  }

  return (
    Date.parse(right.createdAt) - Date.parse(left.createdAt) ||
    left.txid.localeCompare(right.txid)
  );
}

async function akPayload(
  network,
  ownerFilter = "",
  collectionId = "",
  operatorAddressInput = "",
) {
  const collection = nftCollectionByNameAndOperator(
    collectionId,
    operatorAddressInput,
  );
  const operatorAddress = nftOperatorAddress(collection, operatorAddressInput);
  if (network !== "livenet") {
    return {
      collection,
      collections: [],
      indexedAt: new Date().toISOString(),
      mints: [],
      network,
      operatorAddress,
      source: mempoolBase(network),
      stats: { confirmed: 0, pending: 0, total: 0 },
    };
  }

  const [deployTxs, txs] = await Promise.all([
    fetchRegistryTransactions(NFT_DEPLOY_FEE_ADDRESS, network),
    isValidBitcoinAddress(operatorAddress, network)
      ? fetchRegistryTransactions(operatorAddress, network)
      : [],
  ]);
  const collections = mergeNftCollections(
    deployTxs.map((tx) => parseNftDeployTransaction(tx, network)).filter(Boolean),
    network,
  );
  const effectiveCollection =
    collections.find(
      (item) =>
        item.name.toLowerCase() === collection.name.toLowerCase() &&
        item.operatorAddress.toLowerCase() === operatorAddress.toLowerCase(),
    ) ?? collection;
  const normalizedOwner = String(ownerFilter ?? "").trim();
  const mints = txs
    .map((tx) =>
      parseAkMintTransaction(tx, network, effectiveCollection, operatorAddress),
    )
    .filter(Boolean)
    .filter(
      (mint) =>
        !normalizedOwner ||
        mint.ownerAddress.toLowerCase() === normalizedOwner.toLowerCase(),
    )
    .sort(compareAkMints);

  return {
    collection: effectiveCollection,
    collections,
    indexedAt: new Date().toISOString(),
    mints,
    network,
    operatorAddress,
    source: mempoolBase(network),
    stats: {
      confirmed: mints.filter((mint) => mint.confirmed).length,
      pending: mints.filter((mint) => !mint.confirmed).length,
      total: mints.length,
    },
  };
}

async function pay2SpeakPayload(network) {
  const registryAddress = pay2SpeakRegistryAddressForNetwork(network);
  if (!registryAddress) {
    return {
      campaigns: [],
      funding: [],
      indexedAt: new Date().toISOString(),
      network,
      questions: [],
      registryAddress: "",
    };
  }

  const txs = await fetchRegistryTransactions(registryAddress, network);
  const state = pay2SpeakStateFromTransactions(txs, registryAddress, network);
  return {
    ...state,
    indexedAt: new Date().toISOString(),
    network,
    registryAddress,
    source: mempoolBase(network),
    stats: {
      campaigns: state.campaigns.length,
      confirmedCampaigns: state.campaigns.filter(
        (campaign) => campaign.confirmed,
      ).length,
      funding: state.funding.length,
      grossSats: state.campaigns.reduce(
        (total, campaign) => total + campaign.fundedGrossSats,
        0,
      ),
      questions: state.questions.length,
      transactions: txs.length,
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
  return {
    ...state,
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
      confirmedTokens: state.tokens.filter((token) => token.confirmed).length,
      creationSats: state.creationSats,
      holders: state.holders.length,
      pendingMints: state.mints.filter((mint) => !mint.confirmed).length,
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

    if (request.method !== "GET") {
      errorResponse(response, 405, "Method not allowed.");
      return;
    }

    if (url.pathname === "/health" || url.pathname === "/api/v1/health") {
      jsonResponse(response, 200, await healthPayload(), "no-store");
      return;
    }

    const network = networkFromSearch(url.searchParams);

    if (url.pathname === "/api/v1/registry" || url.pathname === "/api/v1/ids") {
      await cachedJsonResponse(
        response,
        `registry:${network}`,
        () => registryPayload(network),
        READ_CACHE_CONTROL,
      );
      return;
    }

    if (url.pathname === "/api/v1/activity" || url.pathname === "/api/v1/log") {
      await cachedJsonResponse(
        response,
        `activity:${network}`,
        () => globalActivityPayload(network),
        EXPENSIVE_READ_CACHE_CONTROL,
        ACTIVITY_CACHE_TTL_MS,
        ACTIVITY_CACHE_STALE_MS,
      );
      return;
    }

    if (url.pathname === "/api/v1/pay2speak") {
      await cachedJsonResponse(
        response,
        `pay2speak:${network}`,
        () => cachedPay2SpeakPayload(network),
        READ_CACHE_CONTROL,
      );
      return;
    }

    if (url.pathname === "/api/v1/nft" || url.pathname === "/api/v1/ak") {
      const owner = url.searchParams.get("owner") ?? "";
      const collection = url.searchParams.get("collection") ?? "";
      const operator = url.searchParams.get("operator") ?? "";
      await cachedJsonResponse(
        response,
        `nft:${network}:${collection}:${operator}:${owner}`,
        () => cachedAkPayload(network, owner, collection, operator),
        EXPENSIVE_READ_CACHE_CONTROL,
        DERIVED_APP_CACHE_TTL_MS,
        DERIVED_APP_CACHE_STALE_MS,
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
      if (freshReadRequested(url.searchParams)) {
        jsonResponse(
          response,
          200,
          await tokenPayload(network, tokenScope),
          FRESH_READ_CACHE_CONTROL,
        );
      } else {
        await cachedJsonResponse(
          response,
          `token:${network}:${tokenScope}`,
          () => cachedTokenPayload(network, tokenScope),
          TOKEN_READ_CACHE_CONTROL,
          TOKEN_CACHE_TTL_MS,
          TOKEN_CACHE_STALE_MS,
        );
      }
      return;
    }

    if (url.pathname === "/api/v1/rush") {
      if (freshReadRequested(url.searchParams)) {
        jsonResponse(
          response,
          200,
          await rushPayload(network),
          FRESH_READ_CACHE_CONTROL,
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
        registryPayload(network),
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
    errorResponse(
      response,
      500,
      error instanceof Error ? error.message : "Unexpected server error.",
    );
  }
}

const server = http.createServer((request, response) => {
  void handleRequest(request, response);
});

function prewarmExpensiveReadCaches() {
  warmJsonCache(
    "token:livenet:",
    () => cachedTokenPayload("livenet"),
    TOKEN_CACHE_TTL_MS,
    TOKEN_CACHE_STALE_MS,
  );
  warmJsonCache(
    "activity:livenet",
    () => globalActivityPayload("livenet"),
    ACTIVITY_CACHE_TTL_MS,
    ACTIVITY_CACHE_STALE_MS,
  );
}

server.listen(PORT, HOST, () => {
  console.log(`ProofOfWork OP_RETURN API listening on http://${HOST}:${PORT}`);
  console.log(`Mainnet mempool source: ${MEMPOOL_BASE_MAINNET}`);
  prewarmExpensiveReadCaches();
});
