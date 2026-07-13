import assert from "node:assert/strict";
import { createHash, timingSafeEqual } from "node:crypto";
import { EventEmitter } from "node:events";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";

const API_PATH = new URL("../server/proof-api.mjs", import.meta.url);
const APP_PATH = new URL("../src/App.tsx", import.meta.url);
const BACKFILL_PATH = new URL("./backfill-proof-indexer.mjs", import.meta.url);
const READER_PATH = new URL("../server/db/proof-index-reader.mjs", import.meta.url);
const WORKER_PATH = new URL("./run-proof-indexer-worker.mjs", import.meta.url);

const sourceCache = new Map();

function fileSource(path) {
  const key = path.href;
  if (!sourceCache.has(key)) {
    sourceCache.set(key, readFileSync(path, "utf8"));
  }
  return sourceCache.get(key);
}

function topLevelFunctionSource(path, name) {
  const source = fileSource(path);
  const startPattern = new RegExp(
    `^(?:export\\s+)?(?:async\\s+)?function\\s+${name}(?:<[^>]+>)?\\s*\\(`,
    "mu",
  );
  const startMatch = startPattern.exec(source);
  if (!startMatch) {
    throw new Error(`Could not find ${name} in ${path.pathname}`);
  }
  const rest = source.slice(startMatch.index + startMatch[0].length);
  const nextMatch = /\n(?:export\s+)?(?:async\s+)?function\s+[A-Za-z_$][\w$]*\s*\(/mu.exec(
    rest,
  );
  const end = nextMatch
    ? startMatch.index + startMatch[0].length + nextMatch.index
    : source.length;
  return source.slice(startMatch.index, end).trim().replace(/^export\s+/u, "");
}

function isolatedFunction(path, name, globals = {}) {
  const context = vm.createContext({
    URLSearchParams,
    console: {
      error() {},
      log() {},
      warn() {},
    },
    ...globals,
  });
  const definition = topLevelFunctionSource(path, name);
  new vm.Script(`${definition}\nthis.__checkedFunction = ${name};`, {
    filename: path.pathname,
  }).runInContext(context);
  return context.__checkedFunction;
}

function isolatedTypeScriptFunction(path, name, globals = {}) {
  const context = vm.createContext({
    console: {
      error() {},
      log() {},
      warn() {},
    },
    ...globals,
  });
  const definition = topLevelFunctionSource(path, name);
  const transpiled = ts.transpileModule(definition, {
    compilerOptions: {
      module: ts.ModuleKind.None,
      target: ts.ScriptTarget.ES2022,
    },
  }).outputText;
  new vm.Script(`${transpiled}\nthis.__checkedFunction = ${name};`, {
    filename: path.pathname,
  }).runInContext(context);
  return context.__checkedFunction;
}

async function rejection(promise, predicate, message) {
  try {
    await promise;
  } catch (error) {
    assert.ok(predicate(error), message ?? error?.message);
    return error;
  }
  assert.fail(message ?? "Expected the operation to reject");
}

const tests = [];
function check(name, run) {
  tests.push({ name, run });
}

check("a current market lifecycle overlay owns sold and active state", () => {
  const listingId =
    "e95c6299b1fdd132b192ea040bcb8683140632b81dbde82946c5b754a8f87dbc";
  const purchaseTxid =
    "66e601cdc087d55b9d97421acd45dcdc73a441870d333ce0ba0095f9f5fbdaaf";
  const mergeTokenStateItemsByKey = (
    baseItems,
    overlayItems,
    keyForItem,
    mergeItem = (_current, incoming) => incoming,
  ) => {
    const byKey = new Map();
    for (const item of Array.isArray(baseItems) ? baseItems : []) {
      byKey.set(keyForItem(item), item);
    }
    for (const item of Array.isArray(overlayItems) ? overlayItems : []) {
      const key = keyForItem(item);
      byKey.set(key, mergeItem(byKey.get(key), item));
    }
    return [...byKey.values()];
  };
  const applyOverlay = isolatedFunction(
    API_PATH,
    "tokenStateWithIndexedMarketSummaryOverlay",
    {
      confirmedTokenSalesStats: (sales) => ({
        confirmedSales: sales.filter((sale) => sale.confirmed).length,
        confirmedSalesVolumeSats: sales.reduce(
          (total, sale) => total + Number(sale.priceSats ?? 0),
          0,
        ),
      }),
      mergeTokenListingRecord: (current, incoming) => ({
        ...(current ?? {}),
        ...(incoming ?? {}),
      }),
      mergeTokenStateItemsByKey,
      mergedSourceLabel: (...sources) => sources.filter(Boolean).join("+"),
      newerIso: (_left, right) => right,
      numericValue: (value) => Number(value) || 0,
      safeStatNumber: (payload, key) => Number(payload?.stats?.[key]) || 0,
      sortClosedTokenListings: (items) => items,
      tokenClosedListingItemKey: (item) =>
        `${item.network}:${item.listingId}:${item.closedTxid}`,
      tokenListingItemKey: (item) => `${item.network}:${item.listingId}`,
      tokenSaleItemKey: (item) => item.txid,
    },
  );
  const lifecycleOverlay = isolatedFunction(
    API_PATH,
    "tokenMarketLifecycleOverlayFromCreditListings",
    {
      normalizeTokenScope: (value) => String(value ?? "").toLowerCase(),
      numericValue: (value) => Number(value) || 0,
    },
  )({
    indexedAt: "2026-07-12T01:52:58.000Z",
    indexedThroughBlock: 957637,
    items: [
      {
        amount: 10000,
        buyerAddress: "buyer",
        closedAt: "2026-07-12T01:52:42.000Z",
        closedConfirmed: true,
        closedTxid: purchaseTxid,
        confirmed: true,
        listingId,
        network: "livenet",
        priceSats: 86590,
        saleTxid: purchaseTxid,
        sellerAddress: "seller",
        status: "sold",
        ticker: "WORK",
        tokenId: "work",
      },
    ],
    network: "livenet",
    source: "proof-indexer-credit-listing-lifecycle",
    stats: { complete: true, totalCount: 1 },
  });

  const result = applyOverlay(
    {
      closedListings: [],
      indexedAt: "2026-07-12T01:40:00.000Z",
      listings: [{ listingId, network: "livenet", status: "active" }],
      sales: [],
      source: "stale-summary",
      stats: {},
    },
    lifecycleOverlay,
  );
  assert.equal(result.listings.length, 0);
  assert.equal(result.closedListings[0].closedTxid, purchaseTxid);
  assert.equal(result.sales[0].txid, purchaseTxid);

  const activeListingId =
    "15aa831e339a17dd3d0a8a256268cb5e652b965ecf79a6af1423375619ad88fa";
  const reopened = applyOverlay(
    {
      closedListings: [
        {
          closedTxid: "f".repeat(64),
          listingId: activeListingId,
          network: "livenet",
        },
      ],
      listings: [],
      sales: [
        {
          listingId: activeListingId,
          txid: "e".repeat(64),
        },
      ],
      source: "stale-summary",
      stats: {},
    },
    {
      closedListings: [],
      indexedAt: "2026-07-12T14:28:54.000Z",
      listings: [
        {
          confirmed: true,
          listingId: activeListingId,
          network: "livenet",
          sellerAddress: "seller",
        },
      ],
      sales: [],
      source: "proof-indexer-credit-listing-lifecycle",
      stats: { complete: true },
    },
  );
  assert.equal(reopened.listings[0].listingId, activeListingId);
  assert.equal(reopened.closedListings.length, 0);
  assert.equal(reopened.sales.length, 0);
});

check("marketplace fast fallback fails closed without lifecycle coverage", async () => {
  const fastMarketplaceOverlay = isolatedFunction(
    API_PATH,
    "marketplaceSummaryPayloadWithIndexedMarketOverlay",
    {
      compactTokenSummaryPayload: (payload) => payload,
      indexedTokenMarketSummaryOverlay: async () => null,
      marketplaceSummaryWithCurrentBtcUsd: (payload) => payload,
      newerIso: (_left, right) => right,
      tokenStateWithIndexedMarketSummaryOverlay: (payload) => payload,
      workFloorWithIndexedMarketSummaryOverlay: (payload) => payload,
    },
  );
  assert.equal(
    await fastMarketplaceOverlay(
      { token: { listings: [{ listingId: "stale" }] }, workFloor: {} },
      "livenet",
      { fast: true },
    ),
    null,
  );
});

check("market lifecycle remains live when event enrichment is slow", async () => {
  const listingId =
    "15aa831e339a17dd3d0a8a256268cb5e652b965ecf79a6af1423375619ad88fa";
  const indexedTokenMarketSummaryOverlay = isolatedFunction(
    API_PATH,
    "indexedTokenMarketSummaryOverlay",
    {
      SUMMARY_PROOF_INDEX_READ_WAIT_MS: 10,
      errorSummary: (error) => String(error?.message ?? error),
      normalizeTokenScope: (value) => String(value ?? "").toLowerCase(),
      numericValue: (value) => Number(value) || 0,
      payloadWithFallbackAfterMs: (promise, fallback) =>
        Promise.race([
          promise,
          new Promise((resolve) => setImmediate(() => resolve(fallback))),
        ]),
      proofIndexCreditListingsPayload: async () => ({
        indexedAt: "2026-07-12T14:28:54.000Z",
        indexedThroughBlock: 957712,
        items: [{ listingId }],
        stats: { complete: true, totalCount: 1 },
      }),
      proofIndexPayloadCoversConfirmedTip: async () => true,
      proofIndexReadFeatureEnabled: () => true,
      proofIndexTokenMarketSummaryOverlayPayload: () =>
        new Promise(() => {}),
      setImmediate,
      tokenMarketLifecycleOverlayFromCreditListings: (payload) => ({
        closedListings: [],
        indexedAt: payload.indexedAt,
        indexedThroughBlock: payload.indexedThroughBlock,
        listings: payload.items,
        sales: [],
        source: "proof-indexer-credit-listing-lifecycle",
        stats: payload.stats,
      }),
    },
  );
  const result = await indexedTokenMarketSummaryOverlay("livenet", "");
  assert.equal(result.listings[0].listingId, listingId);
  assert.equal(result.indexedThroughBlock, 957712);
});

check("market lifecycle overrides stale event closures", async () => {
  const listingId =
    "15aa831e339a17dd3d0a8a256268cb5e652b965ecf79a6af1423375619ad88fa";
  const indexedTokenMarketSummaryOverlay = isolatedFunction(
    API_PATH,
    "indexedTokenMarketSummaryOverlay",
    {
      SUMMARY_PROOF_INDEX_READ_WAIT_MS: 10,
      errorSummary: (error) => String(error?.message ?? error),
      normalizeTokenScope: (value) => String(value ?? "").toLowerCase(),
      numericValue: (value) => Number(value) || 0,
      payloadWithFallbackAfterMs: async (promise) => promise,
      proofIndexCreditListingsPayload: async () => ({
        indexedAt: "2026-07-12T14:28:54.000Z",
        indexedThroughBlock: 957712,
        items: [{ listingId }],
        stats: { complete: true, totalCount: 1 },
      }),
      proofIndexPayloadCoversConfirmedTip: async () => true,
      proofIndexReadFeatureEnabled: () => true,
      proofIndexTokenMarketSummaryOverlayPayload: async () => ({
        closedListings: [
          { closedTxid: "f".repeat(64), listingId },
        ],
        listings: [{ listingId: "e".repeat(64) }],
        stats: { complete: true },
      }),
      tokenMarketLifecycleOverlayFromCreditListings: (payload) => ({
        closedListings: [],
        indexedAt: payload.indexedAt,
        indexedThroughBlock: payload.indexedThroughBlock,
        listings: payload.items,
        sales: [],
        source: "proof-indexer-credit-listing-lifecycle",
        stats: payload.stats,
      }),
      tokenStateWithIndexedMarketSummaryOverlay: (_history, lifecycle) =>
        lifecycle,
    },
  );
  const result = await indexedTokenMarketSummaryOverlay("livenet", "");
  assert.equal(result.listings[0].listingId, listingId);
  assert.equal(result.closedListings.length, 0);
});

check("unscoped credit lifecycle reads query every token", async () => {
  const scopes = [];
  const proofIndexCreditListingsPayload = isolatedFunction(
    READER_PATH,
    "proofIndexCreditListingsPayload",
    {
      boundedInteger: (value, fallback, min, max) =>
        Math.min(max, Math.max(min, Number(value ?? fallback))),
      dateIso: (value) => new Date(value).toISOString(),
      latestProofIndexScanMetadata: async () => ({
        generated_at: "2026-07-12T14:28:54.000Z",
        indexed_through_block: 957712,
      }),
      objectRecord: (value) =>
        value && typeof value === "object" && !Array.isArray(value)
          ? value
          : {},
      proofIndexPool: () => ({
        async query(sql, params) {
          scopes.push(params[1]);
          return /count\(\*\) AS total_count/u.test(String(sql))
            ? { rows: [{ total_count: 0 }] }
            : { rows: [] };
        },
      }),
      rowNumber: (row, key) => Number(row?.[key] ?? 0),
      tokenScopeKey: (value) =>
        String(value ?? "").trim().toLowerCase() || "all",
    },
  );
  await proofIndexCreditListingsPayload("livenet", "");
  assert.deepEqual(scopes, ["", ""]);
});

check("an exact WORK transfer miss requests canonical recovery", () => {
  const txid = "a".repeat(64);
  const exactTransferHistoryNeedsCanonicalRecovery = isolatedFunction(
    API_PATH,
    "exactTransferHistoryNeedsCanonicalRecovery",
    {
      WORK_TOKEN_ID: "work",
      isValidBitcoinAddress: (address) => String(address).startsWith("bc1"),
      normalizeTokenScope: (scope) => String(scope).toLowerCase(),
      pruneInternalVerifierStateCache: () => {},
      normalizedTokenHistoryKind: (kind) => String(kind).toLowerCase(),
      recoveryTxidsFromSearchParams: (params) => [
        ...new Set(
          ["q", "search", "txid", "transaction", "transactionId"]
            .flatMap((key) => params.getAll(key))
            .map((value) => value.toLowerCase())
            .filter((value) => /^[0-9a-f]{64}$/u.test(value)),
        ),
      ],
    },
  );
  const params = new URLSearchParams({ txid });
  assert.equal(
    exactTransferHistoryNeedsCanonicalRecovery(
      { items: [], network: "livenet" },
      "work",
      "transfers",
      params,
    ),
    true,
  );
  assert.equal(
    exactTransferHistoryNeedsCanonicalRecovery(
      {
        items: [
          {
            recipientAddress: "bc1recipient",
            senderAddress: "bc1sender",
            txid,
          },
        ],
        network: "livenet",
      },
      "work",
      "transfers",
      params,
    ),
    false,
  );
  assert.equal(
    exactTransferHistoryNeedsCanonicalRecovery(
      {
        canonicalInvalidTxids: [txid],
        items: [],
        network: "livenet",
      },
      "work",
      "transfers",
      params,
    ),
    false,
  );
  const missingTxid = "b".repeat(64);
  const mixedParams = new URLSearchParams();
  mixedParams.append("txid", txid);
  mixedParams.append("transactionId", missingTxid);
  assert.equal(
    exactTransferHistoryNeedsCanonicalRecovery(
      {
        canonicalInvalidTxids: [txid],
        items: [],
        network: "livenet",
      },
      "work",
      "transfers",
      mixedParams,
    ),
    false,
  );
});

check("canonical credit overlays retain explicit address scope", async () => {
  const address = "bc1wallet";
  let filteredAddresses = null;
  let mergeOptions = null;
  const tokenHistoryPageWithCanonicalCreditValueOverlay = isolatedFunction(
    API_PATH,
    "tokenHistoryPageWithCanonicalCreditValueOverlay",
    {
      BOND_TOKEN_IDS: new Set(["powb", "incb"]),
      POWB_TOKEN_ID: "powb",
      activeTokenListingsFromState: () => [],
      existingCanonicalLedgerPayload: async () => null,
      existingCurrentCanonicalLedgerPayload: async () => ({
        generatedAt: "2026-07-11T00:00:00.000Z",
      }),
      historyItemsMatchingAddresses: (items, addresses) => {
        filteredAddresses = addresses;
        return items;
      },
      historyPaginationFromSearch: () => ({
        limit: 20,
        offset: 0,
        page: 0,
        query: "",
      }),
      ledgerTokenStateForScope: () => ({ transfers: [] }),
      mergeTokenHistoryPageWithOverlay: (page, _overlay, _pagination, options) => {
        mergeOptions = options;
        return page;
      },
      mergedSourceLabel: () => "test",
      normalizeTokenScope: (scope) => String(scope).toLowerCase(),
      normalizedTokenHistoryKind: (kind) => String(kind).toLowerCase(),
      paginatedHistoryPayload: (value) => value,
      recoveryAddressHintsFromSearchParams: () => [address],
      tokenHistoryKindNeedsCreditNetworkValueOverlay: () => true,
      tokenMarketLogItemsFromState: () => [],
    },
  );
  await tokenHistoryPageWithCanonicalCreditValueOverlay(
    { items: [] },
    "livenet",
    "work",
    "transfers",
    new URLSearchParams({ address }),
  );
  assert.deepEqual(filteredAddresses, [address]);
  assert.equal(mergeOptions?.addOverlayItems, false);
});

check("current ID reads exclude dropped registration transactions", async () => {
  const confirmedIdRecordsFromCurrentTables = isolatedFunction(
    READER_PATH,
    "confirmedIdRecordsFromCurrentTables",
    {
      confirmedIdRecordFromRow: (row) => ({
        confirmed: true,
        id: row.display_id,
        txid: row.registration_txid,
      }),
    },
  );
  const databaseRows = [
    {
      display_id: "inception",
      registration_txid: "1".repeat(64),
      status: "confirmed",
    },
    {
      display_id: "dropped-name",
      registration_txid: "2".repeat(64),
      status: "dropped",
    },
  ];
  const calls = [];
  const pool = {
    async query(sql, params) {
      calls.push({ params, sql });
      let rows = [...databaseRows];
      if (/t\.status\s*=\s*'confirmed'/u.test(sql)) {
        rows = rows.filter((row) => row.status === "confirmed");
      }
      if (params.length > 1) {
        rows = rows.filter(
          (row) => row.display_id.toLowerCase() === String(params[1]).toLowerCase(),
        );
      }
      return { rows };
    },
  };

  const all = await confirmedIdRecordsFromCurrentTables(pool, "livenet");
  assert.deepEqual(
    Array.from(all, (record) => record.id),
    ["inception"],
  );
  const dropped = await confirmedIdRecordsFromCurrentTables(
    pool,
    "livenet",
    "dropped-name",
  );
  assert.equal(dropped.length, 0);
  assert.deepEqual(Array.from(calls[1].params), ["livenet", "dropped-name"]);
  assert.match(calls[0].sql, /e\.payload->>'blockIndex'/u);
  assert.match(calls[0].sql, /registration_event\.registration_event_id DESC/u);
  assert.match(
    calls[0].sql,
    /COALESCE\(r\.registered_height, t\.block_height\) DESC/u,
  );
});

check("Electrum registry hydration preserves canonical history heights", async () => {
  const armyTxid = "a8622941a8ac1ed6ac8a8df58ce40795fc7d97b3615d81e9dc23ca6c0cf820fa";
  const registryTxid = "664f605a032a726f248c7ea298773e04ccabd063555cf109cfd02736935bc84e";
  const fetchAddressTransactionsFromElectrum = isolatedFunction(
    API_PATH,
    "fetchAddressTransactionsFromElectrum",
    {
      ADDRESS_ELECTRUM_HISTORY_TIMEOUT_MS: 1_000,
      TX_FETCH_CONCURRENCY: 2,
      dedupeTransactions: (transactions) => transactions,
      electrumRequest: async () => [
        { height: 948_376, tx_hash: armyTxid },
        { height: 948_376, tx_hash: registryTxid },
      ],
      fetchTransactionFromElectrum: async (txid) => ({
        status: {
          block_hash: "f".repeat(64),
          confirmed: true,
        },
        txid,
      }),
      fetchTransactionWithSourceFallback: async () => null,
      mapWithConcurrency: async (items, _limit, mapper) =>
        Promise.all(items.map(mapper)),
      scriptHashForAddress: () => "scripthash",
    },
  );
  const transactions = await fetchAddressTransactionsFromElectrum(
    "bc1registry",
    "livenet",
  );
  assert.deepEqual(
    Array.from(transactions, (transaction) => transaction.status.block_height),
    [948_376, 948_376],
  );
});

check("ID records pin canonical block position and newest-first display", () => {
  const records = [
    {
      blockHeight: 948_376,
      blockIndex: 1_601,
      confirmed: true,
      id: "armyofyouth",
      txid: "a8622941a8ac1ed6ac8a8df58ce40795fc7d97b3615d81e9dc23ca6c0cf820fa",
    },
    {
      blockHeight: 948_376,
      blockIndex: 1_602,
      confirmed: true,
      id: "satoshin",
      txid: "74312caa53ee552d2ff85944d99e700fe313208378db17506b490f0e99349b0f",
    },
    {
      blockHeight: 948_376,
      blockIndex: 2_080,
      confirmed: true,
      id: "bitcoin",
      txid: "6ef73916cdc421e62df2a7df7bb4269b40db7b8616f9545f99f34a15e7a1932e",
    },
    {
      blockHeight: 948_376,
      blockIndex: 2_081,
      confirmed: true,
      id: "registry",
      txid: "664f605a032a726f248c7ea298773e04ccabd063555cf109cfd02736935bc84e",
    },
  ];
  const compareRegistryRecordDisplayOrder = isolatedFunction(
    API_PATH,
    "compareRegistryRecordDisplayOrder",
  );
  const expected = ["registry", "bitcoin", "satoshin", "armyofyouth"];
  const freshOrder = records
    .slice()
    .sort(compareRegistryRecordDisplayOrder)
    .map((record) => record.id);
  const indexedOrder = records
    .slice()
    .reverse()
    .sort(compareRegistryRecordDisplayOrder)
    .map((record) => record.id);
  assert.deepEqual(freshOrder, expected);
  assert.deepEqual(indexedOrder, expected);

  const crossBlock = [
    { blockHeight: 948_377, blockIndex: 1, confirmed: true, txid: "1" },
    { blockHeight: 948_376, blockIndex: 3_000, confirmed: true, txid: "2" },
  ].sort(compareRegistryRecordDisplayOrder);
  assert.equal(crossBlock[0].blockHeight, 948_377);
});

check("scoped WORK summaries preserve canonical holder totals and identity", async () => {
  const normalizeTokenTicker = (ticker) =>
    String(ticker ?? "").trim().toUpperCase();
  const tokenHolderMatchesDefinition = isolatedTypeScriptFunction(
    APP_PATH,
    "tokenHolderMatchesDefinition",
    { normalizeTokenTicker },
  );
  const tokenHoldersForDefinition = isolatedTypeScriptFunction(
    APP_PATH,
    "tokenHoldersForDefinition",
    { tokenHolderMatchesDefinition },
  );
  const tokenHolderTotalCount = isolatedTypeScriptFunction(
    APP_PATH,
    "tokenHolderTotalCount",
  );
  const work = {
    holderCount: 311,
    ticker: "WORK",
    tokenId: "work-token-id",
  };
  const previewHolders = Array.from({ length: 40 }, (_, index) => ({
    address: `preview-${index}`,
    balance: 40 - index,
  }));
  const compactSaleReplay = Array.from({ length: 13 }, (_, index) => ({
    address: `sale-${index}`,
    balance: 13 - index,
  }));
  const resolved = tokenHoldersForDefinition(
    work,
    [work],
    previewHolders,
    compactSaleReplay,
  );
  assert.equal(resolved.length, 40);
  assert.equal(resolved[0].address, "preview-0");
  assert.equal(tokenHolderTotalCount(work, resolved), 311);

  const other = { ticker: "OTHER", tokenId: "other-token-id" };
  const ambiguous = tokenHoldersForDefinition(
    work,
    [work, other],
    previewHolders,
    compactSaleReplay,
  );
  assert.equal(ambiguous.length, 13);
  assert.equal(ambiguous[0].address, "sale-0");

  const normalizeTokenScope = (value) =>
    String(value ?? "").trim().toLowerCase();
  const tokenMatchesScope = (token, scope) =>
    normalizeTokenScope(token?.tokenId) === scope ||
    normalizeTokenScope(token?.ticker) === scope;
  const tokenPayloadWithScopedHolderIdentity = isolatedFunction(
    API_PATH,
    "tokenPayloadWithScopedHolderIdentity",
    { normalizeTokenScope, tokenMatchesScope },
  );
  const scopedPayload = tokenPayloadWithScopedHolderIdentity(
    { holders: previewHolders, tokens: [work] },
    work.tokenId,
  );
  assert.equal(scopedPayload.holders.length, 40);
  assert.ok(
    scopedPayload.holders.every(
      (holder) =>
        holder.tokenId === work.tokenId && holder.ticker === work.ticker,
    ),
  );
  const multiTokenPayload = {
    holders: previewHolders,
    tokens: [work, other],
  };
  assert.equal(
    tokenPayloadWithScopedHolderIdentity(multiTokenPayload, work.tokenId),
    multiTokenPayload,
  );

  let holderSql = "";
  const scopedHoldersFromBalances = isolatedFunction(
    READER_PATH,
    "scopedHoldersFromBalances",
  );
  const indexedHolders = await scopedHoldersFromBalances(
    {
      async query(sql) {
        holderSql = String(sql);
        return {
          rows: [
            {
              address: "bc1holder",
              confirmed_balance: "1234",
              ticker: "WORK",
              token_id: "WORK-TOKEN-ID",
            },
          ],
        };
      },
    },
    "livenet",
    work.tokenId,
  );
  assert.match(holderSql, /JOIN proof_indexer\.credit_definitions/u);
  assert.equal(indexedHolders[0].balance, 1234);
  assert.equal(indexedHolders[0].ticker, "WORK");
  assert.equal(indexedHolders[0].tokenId, "work-token-id");
});

check("WORK mint progress stays below 100 until max supply confirms", () => {
  const tokenProgressPercent = isolatedTypeScriptFunction(
    APP_PATH,
    "tokenProgressPercent",
  );
  const tokenProgressLabel = isolatedTypeScriptFunction(
    APP_PATH,
    "tokenProgressLabel",
    { tokenProgressPercent },
  );
  assert.equal(tokenProgressLabel(20_999_000, 21_000_000), "99.995%");
  assert.equal(tokenProgressLabel(21_000_000, 21_000_000), "100%");
});

check("token send preflight retries transient canonical reads only", async () => {
  let attempts = 0;
  const retryNotices = [];
  const fetchFreshWalletTokenPreflightState = isolatedTypeScriptFunction(
    APP_PATH,
    "fetchFreshWalletTokenPreflightState",
    {
      TOKEN_SPENDABLE_RECHECK_DELAYS_MS: [0, 1, 1],
      URLSearchParams,
      delay: async () => {},
      fetchProofApiJson: async (path, network) => {
        attempts += 1;
        if (attempts === 1) {
          throw new Error("canonical gate");
        }
        assert.equal(network, "livenet");
        assert.match(path, /fresh=1/u);
        assert.match(path, /wallet=1/u);
        assert.match(path, /asset=work-token-id/u);
        return {
          authoritativeWallet: true,
          closedListings: [],
          holders: [{ balance: 1 }],
          listings: [],
          sales: [],
          source: "proof-indexer-wallet-token-overlay",
          transfers: [],
          walletScoped: true,
        };
      },
      isTransientProofApiReadError: (error) =>
        error instanceof Error && error.message === "canonical gate",
    },
  );
  const state = await fetchFreshWalletTokenPreflightState(
    "sender",
    "work-token-id",
    (attempt, total) => {
      retryNotices.push([attempt, total]);
    },
  );
  assert.equal(attempts, 2);
  assert.equal(state.holders[0].balance, 1);
  assert.deepEqual(retryNotices, [[2, 3]]);

  const unavailablePreflight = isolatedTypeScriptFunction(
    APP_PATH,
    "fetchFreshWalletTokenPreflightState",
    {
      TOKEN_SPENDABLE_RECHECK_DELAYS_MS: [0, 1],
      URLSearchParams,
      delay: async () => {},
      fetchProofApiJson: async () => ({
        authoritativeWallet: false,
        holders: [{ balance: 99_000 }],
        source: "stale-token-cache",
        walletScoped: true,
      }),
      isTransientProofApiReadError: () => false,
    },
  );
  await rejection(
    unavailablePreflight("sender", "work-token-id"),
    (error) =>
      /could not verify this wallet balance/u.test(String(error?.message)) &&
      /No transaction was created/u.test(String(error?.message)),
  );
});

check("fresh wallet token reads never fall back behind canonical coverage", async () => {
  let fallbackReads = 0;
  const walletScopedTokenPayload = isolatedFunction(
    API_PATH,
    "walletScopedTokenPayload",
    {
      BOND_TOKEN_IDS: new Set(),
      WORK_TOKEN_ID: "work-token-id",
      currentProofIndexTokenPayloadForRead: async () => null,
      freshDataUnavailableError: (message) => new Error(message),
      normalizeTokenScope: (value) => value,
      proofIndexReadFeatureEnabled: () => true,
      tokenPayloadForRead: async () => {
        fallbackReads += 1;
        return {};
      },
    },
  );
  await rejection(
    walletScopedTokenPayload(
      "livenet",
      "work-token-id",
      ["sender"],
      { requireCurrent: true },
    ),
    (error) => /still catching up/u.test(String(error?.message)),
  );
  assert.equal(fallbackReads, 0);

  const currentWalletScopedTokenPayload = isolatedFunction(
    API_PATH,
    "walletScopedTokenPayload",
    {
      BOND_TOKEN_IDS: new Set(),
      WORK_TOKEN_ID: "work-token-id",
      currentProofIndexTokenPayloadForRead: async () => ({
        holders: [],
        tokens: [{ tokenId: "other-token-id" }],
      }),
      normalizeTokenScope: (value) => value,
      proofIndexReadFeatureEnabled: () => true,
      tokenPayloadScopedToAddresses: (payload) => payload,
      tokenPayloadWithIndexedWalletOverlay: async (payload) => payload,
      tokenPayloadWithWalletActiveListings: async (payload) => payload,
    },
  );
  const current = await currentWalletScopedTokenPayload(
    "livenet",
    "other-token-id",
    ["sender"],
    { requireCurrent: true },
  );
  assert.equal(current.authoritativeWallet, true);
});

check("token spendability deducts reservations and pending sends once", () => {
  const tokenSpendabilityForWallet = isolatedTypeScriptFunction(
    APP_PATH,
    "tokenSpendabilityForWallet",
    {
      mergeTokenListingsById: (current, incoming) => [...current, ...incoming],
      tokenHolderMatchesDefinition: (holder, token) =>
        holder.tokenId === token.tokenId,
      tokenListingStateKey: (listing) => listing.listingId,
      tokenListingsWithPreservedLocalPending: (_local, indexed) => indexed,
      tokenReservedBalanceFor: (listings) =>
        listings.reduce((total, listing) => total + listing.amount, 0),
    },
  );
  const token = { ticker: "WORK", tokenId: "work-token-id" };
  const pendingTransfer = {
    amount: 1_000,
    confirmed: false,
    recipientAddress: "recipient",
    senderAddress: "sender",
    tokenId: token.tokenId,
    txid: "pending-send",
  };
  const result = tokenSpendabilityForWallet(
    "sender",
    token,
    {
      closedListings: [],
      holders: [{ address: "sender", balance: 10_763, tokenId: token.tokenId }],
      listings: [
        {
          amount: 2_000,
          listingId: "reserved-listing",
          sellerAddress: "sender",
          tokenId: token.tokenId,
        },
      ],
      sales: [],
      transfers: [pendingTransfer],
    },
    [],
    [],
    [pendingTransfer],
    [],
  );
  assert.equal(result.confirmedBalance, 10_763);
  assert.equal(result.reservedBalance, 2_000);
  assert.equal(result.pendingOutgoing, 1_000);
  assert.equal(result.spendableBalance, 7_763);

  const pendingCloseResult = tokenSpendabilityForWallet(
    "sender",
    token,
    {
      closedListings: [],
      holders: [{ address: "sender", balance: 10_000, tokenId: token.tokenId }],
      listings: [],
      sales: [],
      transfers: [],
    },
    [],
    [
      {
        amount: 8_000,
        closedConfirmed: false,
        confirmed: true,
        listingId: "pending-delist",
        sellerAddress: "sender",
        tokenId: token.tokenId,
      },
    ],
    [],
    [],
  );
  assert.equal(pendingCloseResult.reservedBalance, 8_000);
  assert.equal(pendingCloseResult.spendableBalance, 2_000);
});

check("insufficient credit balance records exact attempted and available amounts", () => {
  const insufficientTokenBalanceInvalidEvent = isolatedFunction(
    API_PATH,
    "insufficientTokenBalanceInvalidEvent",
  );
  const event = insufficientTokenBalanceInvalidEvent({
    actorAddress: "1PNdpSender",
    amount: 99_000,
    confirmedBalance: 10_763,
    recipientAddress: "1Pg9Recipient",
    reservedBalance: 0,
    ticker: "WORK",
    tokenId: "4".repeat(64),
  });
  assert.equal(event.reasonCode, "insufficient-spendable-balance");
  assert.equal(event.attemptedAmount, 99_000);
  assert.equal(event.availableAmount, 10_763);
  assert.equal(event.confirmedBalance, 10_763);
  assert.equal(event.spendableBalance, 10_763);
  assert.match(event.reason, /10,763 available; 99,000 attempted/u);
});

check("wallet holder overlays preserve WORK and POWB for one address", () => {
  const mergeWalletHolders = isolatedFunction(
    API_PATH,
    "mergeWalletHolders",
  );
  const address = "1BPVvi1GK4QkfqFMU4jHGjsQjyGwjJJJ7x";
  const holders = mergeWalletHolders([], [
    {
      address,
      balance: 3_639_060,
      ticker: "WORK",
      tokenId: "d4e5ebf11d104d6a63fb74e42094364b25a5f7199a09e5c0e71408972466a8b8",
    },
    {
      address,
      balance: 225_001,
      ticker: "POWB",
      tokenId: "a3d05fcb82548bfb800f293f7574740e09a1b117f5bfe3d6d4d696c4d0d66f50",
    },
  ]);
  assert.equal(holders.length, 2);
  assert.deepEqual(
    Array.from(holders, (holder) => [holder.ticker, holder.balance]),
    [
      ["WORK", 3_639_060],
      ["POWB", 225_001],
    ],
  );
  const zeroBalanceHolder = mergeWalletHolders([], [
    {
      address,
      balance: 0,
      ticker: "WORK",
      tokenId: "d4e5ebf11d104d6a63fb74e42094364b25a5f7199a09e5c0e71408972466a8b8",
    },
  ]);
  assert.equal(zeroBalanceHolder.length, 1);
  assert.equal(zeroBalanceHolder[0].balance, 0);

  for (const functionName of [
    "walletScopedTokenSummaryPayload",
    "walletScopedTokenPayload",
  ]) {
    const source = topLevelFunctionSource(API_PATH, functionName);
    assert.doesNotMatch(source, /scope !== POWB_TOKEN_ID/u);
    assert.match(source, /tokenPayloadWithIndexedWalletOverlay/u);
  }

  const appSource = fileSource(APP_PATH);
  const walletBalanceSource = topLevelFunctionSource(
    APP_PATH,
    "tokenWalletBalancesFor",
  );
  assert.match(walletBalanceSource, /hasConfirmedReplayBase/u);
  assert.match(walletBalanceSource, /canReplayConfirmedBalance/u);
  const tokenWalletBalancesFor = isolatedTypeScriptFunction(
    APP_PATH,
    "tokenWalletBalancesFor",
    {
      normalizeTokenTicker: (ticker) => String(ticker ?? "").toUpperCase(),
      tokenHolderMatchesDefinition: isolatedTypeScriptFunction(
        APP_PATH,
        "tokenHolderMatchesDefinition",
        {
          normalizeTokenTicker: (ticker) =>
            String(ticker ?? "").toUpperCase(),
        },
      ),
    },
  );
  const tokens = [
    {
      ticker: "WORK",
      tokenId: "d4e5ebf11d104d6a63fb74e42094364b25a5f7199a09e5c0e71408972466a8b8",
    },
    {
      ticker: "POWB",
      tokenId: "a3d0bc8528f91dfc52400a885bed7e49235396aa82aa9f95db41be629f1d5562",
    },
  ];
  const walletBalances = tokenWalletBalancesFor(
    address,
    tokens,
    [],
    [],
    [
      {
        amount: 30_060,
        buyerAddress: address,
        confirmed: true,
        tokenId: tokens[0].tokenId,
      },
    ],
    holders,
  );
  assert.deepEqual(
    Array.from(walletBalances, (balance) => [
      balance.token.ticker,
      balance.confirmedBalance,
    ]),
    [
      ["WORK", 3_639_060],
      ["POWB", 225_001],
    ],
  );
  assert.equal(
    tokenWalletBalancesFor(
      address,
      [tokens[0]],
      [],
      [],
      [
        {
          amount: 30_060,
          buyerAddress: address,
          confirmed: true,
          tokenId: tokens[0].tokenId,
        },
      ],
      [],
    ).length,
    0,
  );
  assert.match(
    appSource,
    /mergeTokenWalletBalancesByToken\(\s*accountTokenWalletBalances,\s*accountWorkWalletBalances/u,
  );
  assert.match(
    appSource,
    /mergeTokenWalletBalancesByToken\([\s\S]*accountWorkWalletBalances[\s\S]*accountPowbWalletBalances/u,
  );
  assert.match(appSource, /accountUtxoAvailability\(accountUtxos, reservedListingOutpoints\)/u);
  assert.match(appSource, /activeListingAnchorOutpointsForAddress\(idListings/u);
  assert.match(appSource, /activeTokenListingAnchorOutpointsForAddress/u);

  const accountUtxoAvailability = isolatedTypeScriptFunction(
    APP_PATH,
    "accountUtxoAvailability",
    { DUST_SATS: 546 },
  );
  const values = [100_000, 10_000, 5_000, 3_000, 1_500, 1_000, 641, 546, 546];
  const utxos = values.map((value, index) => ({
    status: { confirmed: true },
    txid: String(index + 1).padStart(64, "0"),
    value,
    vout: 0,
  }));
  const availability = accountUtxoAvailability(
    utxos,
    utxos.slice(-2).map(({ txid, vout }) => ({ txid, vout })),
  );
  assert.equal(availability.confirmedBalanceSats, 122_233);
  assert.equal(availability.confirmedUtxos.length, 9);
  assert.equal(availability.reservedListingUtxos.length, 2);
  assert.equal(availability.spendableSats, 121_141);
  assert.equal(availability.spendableUtxos.length, 7);
});

check("wallet token scope preserves holder definitions and indexed invalids", async () => {
  const address = "1SenderAddress";
  const tokenId = "4".repeat(64);
  const txid = "6".repeat(64);
  const valueSearchText = isolatedFunction(API_PATH, "valueSearchText");
  const historyItemsMatchingAddresses = isolatedFunction(
    API_PATH,
    "historyItemsMatchingAddresses",
    { valueSearchText },
  );
  const tokenPayloadScopedToAddresses = isolatedFunction(
    API_PATH,
    "tokenPayloadScopedToAddresses",
    {
      historyItemsMatchingAddresses,
      normalizeTokenScope: (value) => String(value ?? "").toLowerCase(),
    },
  );
  const scoped = tokenPayloadScopedToAddresses(
    {
      closedListings: [],
      holders: [{ address, balance: 3_263, ticker: "WORK", tokenId }],
      invalidEvents: [],
      listings: [],
      mints: [],
      sales: [],
      stats: {},
      tokens: [{ ticker: "WORK", tokenId }],
      transfers: [],
    },
    [address],
  );
  assert.equal(scoped.tokens.length, 1);
  assert.equal(scoped.tokens[0].tokenId, tokenId);

  const mergeTokenStateItemsByKey = (
    baseItems,
    overlayItems,
    keyForItem,
    mergeItem = (_current, incoming) => incoming,
  ) => {
    const byKey = new Map();
    for (const item of Array.isArray(baseItems) ? baseItems : []) {
      byKey.set(keyForItem(item), item);
    }
    for (const item of Array.isArray(overlayItems) ? overlayItems : []) {
      const key = keyForItem(item);
      byKey.set(key, mergeItem(byKey.get(key), item));
    }
    return [...byKey.values()];
  };
  const tokenPayloadWithIndexedWalletOverlay = isolatedFunction(
    API_PATH,
    "tokenPayloadWithIndexedWalletOverlay",
    {
      errorSummary: () => "",
      mergeTokenListingRecord: (_current, incoming) => incoming,
      mergeTokenStateItemsByKey,
      mergeTokenTransferRecord: (_current, incoming) => incoming,
      mergeWalletHolders: (base, overlay) => [...base, ...overlay],
      mergedSourceLabel: (base, overlay) => `${base}+${overlay}`,
      newerIso: (left, right) => right ?? left,
      normalizeTokenScope: (value) => String(value ?? "").toLowerCase(),
      proofIndexReadFeatureEnabled: () => true,
      proofIndexWalletTokenOverlayPayload: async () => ({
        closedListings: [],
        holders: [],
        indexedAt: "2026-07-13T00:00:00.000Z",
        invalidEvents: [
          {
            confirmed: true,
            createdAt: "2026-07-06T07:53:19.000Z",
            reasonCode: "insufficient-spendable-balance",
            tokenId,
            txid,
            valid: false,
          },
        ],
        listings: [],
        sales: [],
        source: "proof-indexer-wallet-token-overlay",
        transfers: [],
      }),
      tokenStateWithPreservedListingRecords: (state) => state,
    },
  );
  const merged = await tokenPayloadWithIndexedWalletOverlay(
    {
      closedListings: [],
      holders: [],
      indexedAt: "2026-07-12T00:00:00.000Z",
      invalidEvents: [],
      listings: [],
      sales: [],
      source: "canonical",
      stats: {},
      transfers: [],
    },
    "livenet",
    tokenId,
    [address],
    [{ ticker: "WORK", tokenId }],
  );
  assert.equal(merged.invalidEvents.length, 1);
  assert.equal(merged.invalidEvents[0].txid, txid);
  assert.equal(merged.stats.invalidEvents, 1);
  assert.equal(merged.tokens.length, 1);
  assert.equal(merged.tokens[0].tokenId, tokenId);
});

check("confirmed invalid credit events remain visible without becoming valid", async () => {
  const tokenId = "4".repeat(64);
  const txid = "6".repeat(64);
  const blockHash = "7".repeat(64);
  const senderAddress = "bc1psender";
  const recipientAddress = "18xrecipient";
  const registryAddress = "bc1pregistry";
  const rowNumber = (row, key) => Number(row?.[key] ?? 0);
  const canonicalRawTransactionMinerFeeSats = isolatedFunction(
    READER_PATH,
    "canonicalRawTransactionMinerFeeSats",
    {
      objectRecord: (value) =>
        value && typeof value === "object" && !Array.isArray(value) ? value : {},
    },
  );
  const tokenInvalidAuditCosts = isolatedFunction(
    READER_PATH,
    "tokenInvalidAuditCosts",
    { canonicalRawTransactionMinerFeeSats, rowNumber },
  );
  const tokenInvalidEventFromRow = isolatedFunction(
    READER_PATH,
    "tokenInvalidEventFromRow",
    {
      canonicalEventPayload: (payload) => payload ?? {},
      dateIso: (value) => new Date(value).toISOString(),
      normalizeEventPayload: (payload) => payload,
      rowNumber,
      tokenInvalidAuditCosts,
    },
  );
  const row = {
    block_hash: blockHash,
    effective_status: "confirmed",
    kind: "token-event-invalid",
    network: "livenet",
    participants: [
      { address: senderAddress, powid: "sender-id", role: "actor" },
      { address: recipientAddress, powid: "", role: "counterparty" },
      { address: registryAddress, powid: "", role: "registry" },
    ],
    payload: {
      actor: senderAddress,
      amount: 12_345,
      counterparty: recipientAddress,
      kind: "token-event-invalid",
      reason: "no-valid-token-event",
      recipients: [
        { address: registryAddress, amountSats: "546" },
        { address: "bc1pchange", amountSats: "646876" },
      ],
      tokenId,
      txid,
    },
    protocol: "pwt1",
    registry_address: registryAddress,
    ticker: "WORK",
    token_id: tokenId,
    transaction_block_height: 950_123,
    transaction_block_time: "2026-05-20T12:00:00.000Z",
    transaction_fee_sats: null,
    transaction_raw_tx: {
      canonicalBlockScan: { network: "livenet" },
      vin: [{ prevout: { valueSats: 648_152 } }],
      vout: [{ valueSats: 546 }, { valueSats: 646_876 }],
    },
    txid,
    validation_errors: ["no-valid-token-event"],
  };
  const mapped = tokenInvalidEventFromRow(row);
  assert.equal(mapped.valid, false);
  assert.equal(mapped.confirmed, true);
  assert.equal(mapped.kind, "token-event-invalid");
  assert.equal(mapped.reason, "no-valid-token-event");
  assert.equal(mapped.amount, 12_345);
  assert.equal(mapped.auditMinerFeeSats, 730);
  assert.equal(mapped.auditRegistryPaymentSats, 546);
  assert.equal(mapped.auditTotalCostSats, 1_276);
  assert.equal(mapped.amountSats, 0);
  assert.equal(mapped.minerFeeSats, 0);
  assert.equal(mapped.registryMutationFeeSats, 0);
  assert.equal(mapped.blockHeight, 950_123);
  assert.equal(mapped.blockHash, blockHash);
  assert.equal(mapped.senderAddress, senderAddress);
  assert.equal(mapped.recipientAddress, recipientAddress);
  assert.deepEqual(Array.from(mapped.participants), [
    senderAddress,
    recipientAddress,
    registryAddress,
  ]);
  assert.equal(mapped.participantDetails[0].powid, "sender-id");

  const tokenVerifierItemsFromState = isolatedFunction(
    API_PATH,
    "tokenVerifierItemsFromState",
  );
  const verifierItems = tokenVerifierItemsFromState(
    {
      canonicalCoverage: true,
      invalidEvents: [
        {
          ...mapped,
          amount: 99_000,
          attemptedAmount: 99_000,
          availableAmount: 10_763,
          blockHeight: 956_893,
          reason:
            "Insufficient spendable WORK balance: 10,763 available; 99,000 attempted.",
          reasonCode: "insufficient-spendable-balance",
        },
      ],
    },
    txid,
  );
  assert.equal(verifierItems.length, 1);
  assert.equal(verifierItems[0].kind, "token-event-invalid");
  assert.equal(verifierItems[0].valid, false);
  assert.equal(verifierItems[0].blockHeight, 956_893);
  assert.equal(verifierItems[0].attemptedAmount, 99_000);
  assert.equal(verifierItems[0].availableAmount, 10_763);
  assert.equal(
    verifierItems[0].reasonCode,
    "insufficient-spendable-balance",
  );

  const eventRowPayload = isolatedFunction(READER_PATH, "eventRowPayload", {
    canonicalEventPayload: (payload) => payload ?? {},
    dateIso: (value) => new Date(value).toISOString(),
    eventPayloadParticipants: () => [],
    normalizeEventPayload: (payload) => payload,
    normalizedLowerText: (value) => String(value ?? "").trim().toLowerCase(),
    normalizedText: (value) => String(value ?? "").trim(),
    rowNumber,
    tokenInvalidAuditCosts,
  });
  const auditEvent = eventRowPayload(
    {
      ...row,
      block_height: 950_123,
      block_time: "2026-05-20T12:00:00.000Z",
      created_at: "2026-05-20T12:00:00.000Z",
      event_time: "2026-05-20T12:00:00.000Z",
      status: "confirmed",
    },
    "livenet",
  );
  assert.equal(auditEvent.auditMinerFeeSats, 730);
  assert.equal(auditEvent.auditRegistryPaymentSats, 546);
  assert.equal(auditEvent.auditTotalCostSats, 1_276);
  for (const field of [
    "amountSats",
    "frozenNetworkValueSats",
    "liveNetworkValueSats",
    "marketplaceMutationFeeSats",
    "minerFeeSats",
    "proofPaymentSats",
    "registryMutationFeeSats",
    "salePaymentSats",
  ]) {
    assert.equal(auditEvent[field], 0, `${field} must stay out of accounting`);
  }

  let query;
  const normalizedTxid = isolatedFunction(READER_PATH, "normalizedTxid");
  const tokenHistoryFilterNeedles = isolatedFunction(
    READER_PATH,
    "tokenHistoryFilterNeedles",
  );
  const tokenScopeKey = isolatedFunction(READER_PATH, "tokenScopeKey");
  const tokenInvalidEventQueryParts = isolatedFunction(
    READER_PATH,
    "tokenInvalidEventQueryParts",
    { normalizedTxid, tokenHistoryFilterNeedles, tokenScopeKey },
  );
  const tokenInvalidEventSelectSql = isolatedFunction(
    READER_PATH,
    "tokenInvalidEventSelectSql",
  );
  const proofIndexTokenInvalidEventsFromTables = isolatedFunction(
    READER_PATH,
    "proofIndexTokenInvalidEventsFromTables",
    {
      TOKEN_STATE_EVENT_READ_LIMIT: 100_000,
      compareTokenItemsByTime: () => 0,
      tokenInvalidEventFromRow,
      tokenInvalidEventQueryParts,
      tokenInvalidEventSelectSql,
    },
  );
  const items = await proofIndexTokenInvalidEventsFromTables(
    {
      async query(sql, params) {
        query = { params: Array.from(params), sql: String(sql) };
        return { rows: [row] };
      },
    },
    "livenet",
    "work",
  );
  assert.equal(items.length, 1);
  assert.equal(items[0].txid, txid);
  assert.deepEqual(query.params, ["livenet", "work"]);
  assert.match(query.sql, /e\.protocol = 'pwt1'/u);
  assert.match(query.sql, /e\.valid = false OR e\.kind = 'token-event-invalid'/u);
  assert.match(query.sql, /t\.status = 'confirmed'/u);
  assert.match(query.sql, /t\.raw_tx AS transaction_raw_tx/u);
  assert.match(query.sql, /FROM proof_indexer\.event_participants/u);

  const normalizedSnapshotId = isolatedFunction(
    READER_PATH,
    "normalizedSnapshotId",
  );
  const historyCursor = isolatedFunction(READER_PATH, "historyCursor", {
    normalizedSnapshotId,
  });
  const historyQueries = [];
  const currentTokenInvalidEventHistoryPage = isolatedFunction(
    READER_PATH,
    "currentTokenInvalidEventHistoryPage",
    {
      dateIso: (value) => new Date(value).toISOString(),
      historyCursor,
      latestProofIndexScanMetadata: async () => ({
        generated_at: "2026-07-11T12:00:00.000Z",
        indexed_through_block: 957_598,
      }),
      newestDateIso: (values) =>
        values.filter(Boolean).sort().at(-1) ?? "2026-07-11T12:00:00.000Z",
      rowNumber,
      tokenInvalidEventFromRow,
      tokenInvalidEventQueryParts,
      tokenInvalidEventSelectSql,
    },
  );
  const historyPage = await currentTokenInvalidEventHistoryPage(
    {
      async query(sql, params) {
        historyQueries.push({ params: Array.from(params), sql: String(sql) });
        return historyQueries.length === 1
          ? {
              rows: [
                {
                  indexed_at: "2026-07-03T12:00:00.000Z",
                  indexed_through_block: 956_369,
                  total_count: 1,
                },
              ],
            }
          : { rows: [row] };
      },
    },
    "livenet",
    "work",
    new URLSearchParams({ address: senderAddress }),
    { limit: 25, offset: 0, page: 0, query: "", snapshotId: "" },
  );
  assert.equal(historyPage.source, "proof-indexer-token-invalid-events");
  assert.equal(historyPage.kind, "invalidEvents");
  assert.equal(historyPage.totalCount, 1);
  assert.equal(historyPage.items[0].valid, false);
  assert.equal(historyPage.indexedThroughBlock, 957_598);
  assert.deepEqual(historyQueries[0].params, [
    "livenet",
    "work",
    `%${senderAddress}%`,
  ]);
  assert.deepEqual(historyQueries[1].params.slice(-2), [25, 0]);
  assert.match(
    historyQueries[0].sql,
    /FROM proof_indexer\.event_participants epq/u,
  );

  const sentinelPage = { source: "live-invalid-history" };
  const proofIndexTokenHistoryPayload = isolatedFunction(
    READER_PATH,
    "proofIndexTokenHistoryPayload",
    {
      currentTokenInvalidEventHistoryPage: async () => sentinelPage,
      normalizedTxid,
      proofIndexPool: () => ({}),
      proofIndexTokenHistoryReadEligibility: () => ({
        eligible: true,
        kind: "invalidEvents",
        pagination: {
          limit: 25,
          offset: 0,
          page: 0,
          query: "",
          snapshotId: "",
        },
        scope: "work",
      }),
      tokenHistoryFilterNeedles: () => [],
      tokenHistoryMarketEventKinds: () => [],
    },
  );
  assert.equal(
    await proofIndexTokenHistoryPayload(
      "livenet",
      "work",
      "invalid-events",
      new URLSearchParams({ address: senderAddress }),
    ),
    sentinelPage,
  );
});

check("unpinned mint and market history use current relational pages", async () => {
  const scan = {
    generated_at: "2026-07-11T12:00:00.000Z",
    indexed_through_block: 957_619,
  };
  const currentRelationalHistoryPageWithScanCoverage = isolatedFunction(
    READER_PATH,
    "currentRelationalHistoryPageWithScanCoverage",
    {
      dateIso: (value) => new Date(value).toISOString(),
      newestDateIso: (values) => values.filter(Boolean).sort().at(-1),
      rowNumber: (row, key) => Number(row?.[key] ?? 0),
    },
  );
  const mintPage = {
    cursor: "0",
    indexedAt: "2026-07-10T12:00:00.000Z",
    indexedThroughBlock: 957_417,
    items: [{ txid: "1".repeat(64) }],
    source: "proof-indexer-token-mint-events",
  };
  const marketPage = {
    cursor: "0",
    indexedAt: "2026-07-10T13:00:00.000Z",
    indexedThroughBlock: 957_408,
    items: [{ txid: "2".repeat(64) }],
    source: "proof-indexer-token-events",
  };
  let embeddedSnapshotReads = 0;
  let mintReads = 0;
  let marketReads = 0;
  const proofIndexTokenHistoryPayload = isolatedFunction(
    READER_PATH,
    "proofIndexTokenHistoryPayload",
    {
      currentRelationalHistoryPageWithScanCoverage,
      exactTokenMintHistoryPage: async (
        _pool,
        _network,
        _scope,
        _searchParams,
        _pagination,
        snapshot,
      ) => {
        mintReads += 1;
        assert.equal(snapshot, null);
        return mintPage;
      },
      latestProofIndexScanMetadata: async () => scan,
      ledgerSnapshotWithPayload: async () => {
        embeddedSnapshotReads += 1;
        return null;
      },
      normalizedTxid: (value) =>
        /^[0-9a-f]{64}$/u.test(String(value ?? "").toLowerCase())
          ? String(value).toLowerCase()
          : "",
      proofIndexPool: () => ({}),
      proofIndexTokenHistoryReadEligibility: (_scope, kind) => ({
        eligible: true,
        kind,
        pagination: {
          limit: 10,
          offset: 0,
          page: 0,
          query: "",
          snapshotId: "",
        },
        scope: "all",
      }),
      proofIndexTokenMarketHistoryOverlayPayload: async (
        _network,
        _scope,
        _kind,
        _searchParams,
        options,
      ) => {
        marketReads += 1;
        assert.equal(options.snapshot.snapshot_id, "");
        return marketPage;
      },
      tokenHistoryFilterNeedles: () => [],
      tokenHistoryMarketEventKinds: (kind) =>
        kind === "market-log" ? ["token-listing"] : [],
    },
  );

  const mintResult = await proofIndexTokenHistoryPayload(
    "livenet",
    "",
    "mints",
    new URLSearchParams({ limit: "10" }),
  );
  const marketResult = await proofIndexTokenHistoryPayload(
    "livenet",
    "work",
    "market-log",
    new URLSearchParams({ limit: "10" }),
  );

  assert.equal(mintReads, 1);
  assert.equal(marketReads, 1);
  assert.equal(embeddedSnapshotReads, 0);
  assert.equal(mintResult.source, "proof-indexer-token-mint-events");
  assert.equal(marketResult.source, "proof-indexer-token-events");
  assert.equal(mintResult.indexedThroughBlock, 957_619);
  assert.equal(marketResult.indexedThroughBlock, 957_619);
  assert.equal(mintResult.indexedAt, scan.generated_at);
  assert.equal(marketResult.indexedAt, scan.generated_at);
});

check("invalid listing attempts inherit their canonical credit scope", () => {
  const txid = "a".repeat(64);
  const tokenInvalidEventQueryParts = isolatedFunction(
    READER_PATH,
    "tokenInvalidEventQueryParts",
    {
      normalizedTxid: (value) =>
        /^[0-9a-f]{64}$/u.test(String(value)) ? String(value) : "",
      tokenHistoryFilterNeedles: (_params, pagination) => [pagination.query],
      tokenScopeKey: (scope) => String(scope).toLowerCase(),
    },
  );
  const query = tokenInvalidEventQueryParts(
    "livenet",
    "work",
    new URLSearchParams({ q: txid }),
    { query: txid },
  );
  assert.match(query.fromSql, /proof_indexer\.credit_listings cl_invalid/u);
  assert.match(query.fromSql, /lower\(cl_invalid\.token_id\) = \$2/u);
  assert.deepEqual(Array.from(query.params[2]), [txid]);
});

check("public Log counts only valid confirmed or pending actions", async () => {
  const readerSource = fileSource(READER_PATH);
  const publicKinds = /const PUBLIC_LOG_EVENT_KINDS = new Set\(\[([\s\S]*?)\]\);/u.exec(
    readerSource,
  )?.[1] ?? "";
  assert.doesNotMatch(publicKinds, /"token-event-invalid"/u);
  assert.match(
    topLevelFunctionSource(READER_PATH, "normalizeHistoryEventItem"),
    /publicOnly[\s\S]*item\?\.valid === false/u,
  );

  let activitySql = "";
  let activityParams = [];
  const rows = Array.from({ length: 23_585 }, (_, index) => ({
    event_time: "2026-07-11T12:00:00.000Z",
    txid: index.toString(16).padStart(64, "0"),
  }));
  const proofIndexCanonicalActivityPayload = isolatedFunction(
    READER_PATH,
    "proofIndexCanonicalActivityPayload",
    {
      indexedThroughBlockFromItems: () => 950_123,
      latestProofIndexScanMetadata: async () => null,
      newestDateIso: () => "2026-05-20T12:00:00.000Z",
      normalizeHistoryEventRows: (items) =>
        items.map((item) => ({ confirmed: true, txid: item.txid })),
      PUBLIC_LOG_EVENT_KINDS: new Set(["mail", "token-mint"]),
      proofIndexPool: () => ({
        async query(sql, params) {
          activitySql = String(sql);
          activityParams = params;
          return { rows };
        },
      }),
      rowNumber: () => 0,
    },
  );
  const activity = await proofIndexCanonicalActivityPayload("livenet");
  assert.equal(activity.stats.confirmed, 23_585);
  assert.equal(activity.stats.total, 23_585);
  assert.match(activitySql, /e\.valid = true/u);
  assert.match(activitySql, /e\.status IN \('confirmed', 'pending'\)/u);
  assert.match(activitySql, /e\.kind = ANY\(\$2::text\[\]\)/u);
  assert.doesNotMatch(activitySql, /token-event-invalid/u);
  assert.deepEqual(Array.from(activityParams[1]), ["mail", "token-mint"]);

  const logHistorySource = topLevelFunctionSource(
    READER_PATH,
    "proofIndexLogHistoryPayload",
  );
  assert.match(logHistorySource, /"e\.valid = true"/u);
  assert.match(
    logHistorySource,
    /"e\.status IN \('confirmed', 'pending'\)"/u,
  );
  assert.match(logHistorySource, /"e\.kind = ANY\(\$2::text\[\]\)"/u);
});

check("canonical consistency aggregates participants across same-tx events", () => {
  const activityCoverageByTxidKind = isolatedFunction(
    API_PATH,
    "activityCoverageByTxidKind",
  );
  const txid = "7".repeat(64);
  const coverage = activityCoverageByTxidKind([
    {
      kind: "token-listing-closed",
      participants: ["bc1seller", "bc1registry"],
      txid,
    },
    {
      kind: "token-listing-closed",
      participants: ["bc1buyer"],
      txid,
    },
  ]).get(`token-listing-closed:${txid}`);
  assert.equal(coverage.items, 2);
  assert.deepEqual(
    [...coverage.participants].sort(),
    ["bc1buyer", "bc1registry", "bc1seller"],
  );
});

check("canonical consistency rejects zero token components behind token activity", () => {
  const tokenComponentCoverageFromConfirmedActivity = isolatedFunction(
    API_PATH,
    "tokenComponentCoverageFromConfirmedActivity",
  );
  const missing = tokenComponentCoverageFromConfirmedActivity(
    [
      { confirmed: true, kind: "token-create" },
      { confirmed: true, kind: "token-mint" },
      { confirmed: true, kind: "token-transfer" },
      { confirmed: true, kind: "token-sale" },
    ],
    { mints: [], sales: [], tokens: [], transfers: [] },
  );
  assert.equal(missing.ok, false);
  assert.deepEqual(Array.from(missing.missing).sort(), [
    "mints",
    "sales",
    "tokens",
    "transfers",
  ]);

  const complete = tokenComponentCoverageFromConfirmedActivity(
    [
      { confirmed: true, kind: "token-create" },
      { confirmed: true, kind: "token-mint" },
      { confirmed: true, kind: "token-transfer" },
      { confirmed: true, kind: "token-sale" },
    ],
    {
      mints: [{ confirmed: true }],
      sales: [{ confirmed: true }],
      tokens: [{ confirmed: true }],
      transfers: [{ confirmed: true }],
    },
  );
  assert.equal(complete.ok, true);
  assert.deepEqual(Array.from(complete.missing), []);
});

check("canonical activity counts exactly match the public Log", () => {
  const canonicalActivityCountCoverage = isolatedFunction(
    API_PATH,
    "canonicalActivityCountCoverage",
    {
      numericValue: (value, fallback = 0) => {
        const number = Number(value);
        return Number.isFinite(number) ? number : fallback;
      },
    },
  );
  assert.equal(
    canonicalActivityCountCoverage(
      { activityItems: 3, confirmedComputerActions: 2 },
      { activity: { count: 2, confirmed: 2 } },
    ).ok,
    false,
  );
  assert.equal(
    canonicalActivityCountCoverage(
      { activityItems: 2, confirmedComputerActions: 2 },
      { activity: { count: 2, confirmed: 1 } },
    ).ok,
    false,
  );
  assert.equal(
    canonicalActivityCountCoverage(
      { activityItems: 2, confirmedComputerActions: 1 },
      { activity: { count: 2, confirmed: 1 } },
    ).ok,
    true,
  );
});

check("synthetic WORK, POWB, and INCB definitions are not public Log actions", () => {
  const tokenStateLogExpectations = isolatedFunction(
    API_PATH,
    "tokenStateLogExpectations",
    {
      BOND_TOKEN_IDS: new Set(["powb", "incb"]),
      POWB_TOKEN_ID: "powb",
      WORK_TOKEN_ID: "work",
    },
  );
  const expectations = tokenStateLogExpectations({
    closedListings: [],
    listings: [],
    mints: [],
    sales: [],
    tokens: [
      { confirmed: true, tokenId: "work", txid: "a".repeat(64) },
      { confirmed: true, tokenId: "powb", txid: "b".repeat(64) },
      { confirmed: true, tokenId: "incb", txid: "d".repeat(64) },
      { confirmed: true, tokenId: "real", txid: "c".repeat(64) },
    ],
    transfers: [],
  });
  assert.deepEqual(
    Array.from(expectations, (item) => item.tokenId),
    ["real"],
  );
});

check("stale registry age can be bypassed only with explicit current tip coverage", async () => {
  let tipHeight;
  const proofIndexPayloadHasExplicitCurrentCoverage = isolatedFunction(
    API_PATH,
    "proofIndexPayloadHasExplicitCurrentCoverage",
    {
      PROOF_INDEX_CONFIRMED_READ_MAX_LAG_BLOCKS: 6,
      ledgerTipHeight: async () => tipHeight,
      proofIndexPayloadIndexedThroughBlock: (payload) =>
        Number(payload?.indexedThroughBlock),
    },
  );
  assert.equal(
    await proofIndexPayloadHasExplicitCurrentCoverage(
      { indexedThroughBlock: 100 },
      "livenet",
    ),
    false,
  );
  tipHeight = 105;
  assert.equal(
    await proofIndexPayloadHasExplicitCurrentCoverage(
      { indexedThroughBlock: 100 },
      "livenet",
    ),
    true,
  );
  tipHeight = 107;
  assert.equal(
    await proofIndexPayloadHasExplicitCurrentCoverage(
      { indexedThroughBlock: 100 },
      "livenet",
    ),
    false,
  );
});

check("stored canonical summaries require component and public Log count checks", () => {
  const eligibleCanonicalSummarySnapshotPayload = isolatedFunction(
    BACKFILL_PATH,
    "eligibleCanonicalSummarySnapshotPayload",
    {
      canonicalSummaryCoverage: () => 957_641,
      objectPayload: (value) =>
        value && typeof value === "object" && !Array.isArray(value)
          ? value
          : null,
    },
  );
  const payload = {
    checks: [],
    ok: true,
    sourceHashes: { canonicalSummary: "a".repeat(64) },
    status: "green",
    summaryPayloads: {},
    summaryRefresh: { mode: "canonical-summary-refresh" },
  };
  assert.equal(eligibleCanonicalSummarySnapshotPayload(payload), false);
  payload.checks.push({
    name: "token-components-cover-confirmed-activity",
    ok: true,
  });
  assert.equal(eligibleCanonicalSummarySnapshotPayload(payload), false);
  payload.checks.push({
    name: "canonical-activity-count-matches-public-log",
    ok: true,
  });
  assert.equal(eligibleCanonicalSummarySnapshotPayload(payload), true);

  const snapshotReadSource = topLevelFunctionSource(
    READER_PATH,
    "proofIndexSnapshotPayload",
  );
  assert.match(
    snapshotReadSource,
    /token-components-cover-confirmed-activity/u,
  );
  assert.match(
    snapshotReadSource,
    /canonical-activity-count-matches-public-log/u,
  );
  assert.match(snapshotReadSource, /check_item->>'ok'[\s\S]*'true'/u);
});

check("bond value uses confirmed payments instead of synthetic mint payment fields", () => {
  const POWB_TOKEN_ID = "powb";
  const bondAmounts = [
    ...Array.from({ length: 464 }, () => 1_000_000),
    166_196_569,
  ];
  const bonds = bondAmounts.map((amountSats, index) => ({
    amountSats,
    confirmed: true,
    createdAt: new Date(1_700_000_000_000 + index * 1_000).toISOString(),
    kind: "infinity-bond",
    txid: index.toString(16).padStart(64, "0"),
  }));
  const tokenState = {
    confirmedSupply: 630_196_569,
    holders: [{ address: "bc1holder", balance: 630_196_569 }],
    listings: [],
    mints: bonds.map((bond) => ({
      amount: bond.amountSats,
      confirmed: true,
      paidSats: 0,
      tokenId: POWB_TOKEN_ID,
      txid: bond.txid,
    })),
    pendingSupply: 0,
    sales: [],
    source: "fixture",
    tokens: [{ registryAddress: "bc1registry", tokenId: POWB_TOKEN_ID }],
    transfers: Array.from({ length: 4 }, (_, index) => ({
      confirmed: true,
      paidSats: 546,
      tokenId: POWB_TOKEN_ID,
      txid: `t${index}`,
    })),
  };
  const mutations = Array.from({ length: 2 }, (_, index) => ({
    amountSats: 546,
    confirmed: true,
    kind: "token-listing",
    tokenId: POWB_TOKEN_ID,
    txid: `m${index}`,
  }));
  const bondSummaryPayloadFromLedger = isolatedFunction(
    API_PATH,
    "bondSummaryPayloadFromLedger",
    {
      TOKEN_MARKETPLACE_MUTATION_KINDS: new Set(["token-listing"]),
      activityAmountSats: (item) => Number(item?.amountSats ?? 0),
      btcUsdResponseMetadata: () => ({ btcUsd: 0 }),
      compactTokenSummaryPayload: (state) => state,
      infinityBondChartPointsFromEvents: ({ bonds: items }) =>
        items.length > 0 ? [{ txid: items.at(-1).txid }] : [],
      isBondActivityItem: (item, config) =>
        item?.kind === config.kind,
      ledgerTokenStateForScope: (ledger) => ledger.tokenState,
      numericValue: (value) => {
        const number = Number(value);
        return Number.isFinite(number) ? number : 0;
      },
      satsToUsdAtBtcUsd: () => 0,
    },
  );
  const summary = bondSummaryPayloadFromLedger(
    {
      activity: [...bonds, ...mutations],
      generatedAt: "2026-07-11T12:00:00.000Z",
      network: "livenet",
      tokenState,
    },
    {
      kind: "infinity-bond",
      registryId: "infinity@proofofwork.me",
      ticker: "POWB",
      tokenId: POWB_TOKEN_ID,
    },
  );
  assert.equal(summary.stats.confirmedBondActions, 465);
  assert.equal(summary.actualValue.bondMintFlowSats, 630_196_569);
  assert.equal(summary.actualValue.bondTransferFeeSats, 2_184);
  assert.equal(summary.actualValue.bondMarketplaceMutationFeeSats, 1_092);
  assert.equal(summary.networkValueSats, 630_199_845);
  assert.ok(Math.abs(summary.floorSats - 1.0000051983779588) < 1e-12);
  assert.doesNotMatch(
    topLevelFunctionSource(API_PATH, "bondSummaryPayloadFromLedger"),
    /bondMintFlowSats[\s\S]*mint\.paidSats/u,
  );
});

check("empty bond summaries cannot cross bond-family identity", () => {
  const bondSummaryPayloadHasKnownMainnetValue = isolatedFunction(
    API_PATH,
    "bondSummaryPayloadHasKnownMainnetValue",
    {
      isValidBitcoinAddress: (address) => address === "1registry",
      normalizePowId: (value) =>
        String(value ?? "")
          .trim()
          .replace(/@proofofwork\.me$/u, "")
          .toLowerCase(),
      numericValue: (value) => Number(value) || 0,
    },
  );
  const config = {
    registryId: "inception@proofofwork.me",
    ticker: "INCB",
    tokenId: "incb",
  };
  const empty = {
    actualValue: { bondMintFlowSats: 0, networkValueSats: 0 },
    chartPoints: [],
    networkValueSats: 0,
    registryAddress: "1registry",
    registryId: config.registryId,
    stats: { confirmedBondActions: 0, confirmedSupply: 0 },
    ticker: config.ticker,
    tokenId: config.tokenId,
  };
  assert.equal(
    bondSummaryPayloadHasKnownMainnetValue(empty, config, {
      allowEmptyHistory: true,
    }),
    true,
  );
  assert.equal(
    bondSummaryPayloadHasKnownMainnetValue(
      { ...empty, ticker: "POWB", tokenId: "powb" },
      config,
      { allowEmptyHistory: true },
    ),
    false,
  );
});

check("a canonical zero-supply INCB definition is known token history", () => {
  const incbTokenId = "incb";
  const tokenPayloadHasKnownMainnetHistory = isolatedFunction(
    API_PATH,
    "tokenPayloadHasKnownMainnetHistory",
    {
      BOND_TOKEN_IDS: new Set([incbTokenId]),
      INCB_TOKEN_ID: incbTokenId,
      WORK_TOKEN_ID: "work",
      bondConfigForTokenId: (tokenId) =>
        tokenId === incbTokenId
          ? { ticker: "INCB", tokenId: incbTokenId }
          : null,
      isValidBitcoinAddress: (address) => address === "1registry",
      normalizeTokenScope: (value) => String(value ?? "").toLowerCase(),
      numericValue: (value) => Number(value) || 0,
    },
  );
  assert.equal(
    tokenPayloadHasKnownMainnetHistory(
      {
        confirmedSupply: 0,
        holders: [],
        listings: [],
        mints: [],
        sales: [],
        tokens: [
          {
            confirmed: true,
            registryAddress: "1registry",
            ticker: "INCB",
            tokenId: incbTokenId,
          },
        ],
        transfers: [],
      },
      incbTokenId,
    ),
    true,
  );
});

check("a hashless legacy block checkpoint cannot resume automatically", async () => {
  const latestBlockScanCheckpoint = isolatedFunction(
    BACKFILL_PATH,
    "latestBlockScanCheckpoint",
    {
      BLOCK_SCAN_FROM_HEIGHT: 0,
      NETWORK: "livenet",
    },
  );
  await rejection(
    latestBlockScanCheckpoint({
      async query() {
        return {
          rows: [{ block_hash: "", indexed_through_block: 957_000 }],
        };
      },
    }),
    (error) => /no canonical block hash|supervised replay/iu.test(error.message),
    "a hashless legacy checkpoint was accepted for automatic resume",
  );
});

check("an explicit supervised block replay owns its starting height", async () => {
  const latestBlockScanCheckpoint = isolatedFunction(
    BACKFILL_PATH,
    "latestBlockScanCheckpoint",
    {
      BLOCK_SCAN_FROM_HEIGHT: 956_000,
      NETWORK: "livenet",
    },
  );
  const checkpoint = await latestBlockScanCheckpoint({
    async query() {
      assert.fail("explicit replay unexpectedly read a legacy checkpoint");
    },
  });
  assert.equal(checkpoint.height, 955_999);
  assert.equal(checkpoint.blockHash, "");
});

check("a timed-out worker child is terminated and reported failed", async () => {
  const cancelledTimers = new Set();
  let nextTimer = 0;
  const fakeSetTimeout = (callback) => {
    const timer = ++nextTimer;
    queueMicrotask(() => {
      if (!cancelledTimers.has(timer)) {
        callback();
      }
    });
    return timer;
  };
  const kills = [];
  const child = new EventEmitter();
  child.kill = (signal) => {
    kills.push(signal);
    if (signal === "SIGTERM") {
      queueMicrotask(() => child.emit("exit", null, signal));
    }
    return true;
  };
  const runScript = isolatedFunction(
    WORKER_PATH,
    "runScript",
    {
      BACKFILL_CHILD_TIMEOUT_MS: 100,
      clearTimeout: (timer) => cancelledTimers.add(timer),
      path: { join: (...parts) => parts.join("/") },
      process: { env: {}, execPath: "node" },
      repoRoot: "/tmp/recovery-fixture",
      setTimeout: fakeSetTimeout,
      spawn: () => child,
    },
  );
  await rejection(
    runScript("fixture.mjs", [], {}, { timeoutMs: 10 }),
    (error) => /wall-clock budget/iu.test(error.message),
  );
  assert.deepEqual(kills, ["SIGTERM"]);
});

check("the index worker retries a failed block cycle before going unhealthy", async () => {
  let attempts = 0;
  const runBackfillWithRetries = isolatedFunction(
    WORKER_PATH,
    "runBackfillWithRetries",
    {
      BACKFILL_CHILD_TIMEOUT_MS: 1_000,
      BACKFILL_RETRIES: 2,
      BACKFILL_RETRY_DELAY_MS: 1,
      console: { error() {} },
      runScript: async () => {
        attempts += 1;
        if (attempts === 1) {
          throw new Error("tip changed");
        }
      },
      setTimeout: (callback) => {
        queueMicrotask(callback);
        return 1;
      },
    },
  );
  await runBackfillWithRetries({});
  assert.equal(attempts, 2);
});

check("pending status cleanup is concurrent but capped", async () => {
  let activeReads = 0;
  let maxActiveReads = 0;
  const rows = Array.from({ length: 12 }, (_value, index) => ({
    txid: String(index).padStart(64, "0"),
  }));
  const refreshPendingStatuses = isolatedFunction(
    WORKER_PATH,
    "refreshPendingStatuses",
    {
      NETWORK: "livenet",
      PENDING_MIN_AGE_MS: 60_000,
      PENDING_STATUS_BUDGET_MS: 15_000,
      PENDING_STATUS_CONCURRENCY: 5,
      PENDING_STATUS_LIMIT: 25,
      STATUS_REQUEST_TIMEOUT_MS: 5_000,
      endpoint: (pathname) => new URL(pathname, "http://127.0.0.1:8081"),
      readJson: async () => {
        activeReads += 1;
        maxActiveReads = Math.max(maxActiveReads, activeReads);
        await new Promise((resolve) => setImmediate(resolve));
        activeReads -= 1;
        return { status: "pending" };
      },
      updateTransactionStatus: async () => {},
    },
  );
  const pool = {
    async connect() {
      return {
        async query() {},
        release() {},
      };
    },
    async query() {
      return { rowCount: rows.length, rows };
    },
  };
  const summary = await refreshPendingStatuses(pool);
  assert.equal(summary.checked, rows.length);
  assert.equal(summary.pending, rows.length);
  assert.equal(summary.deferred, 0);
  assert.equal(maxActiveReads, 5);
});

check("an outer ledger height cannot promote embedded history coverage", () => {
  const indexedThroughBlockFromItems = (items) =>
    Math.max(0, ...items.map((item) => Number(item.blockHeight ?? 0))) || null;
  const embeddedHistoryIndexedThroughBlock = isolatedFunction(
    READER_PATH,
    "embeddedHistoryIndexedThroughBlock",
    {
      indexedThroughBlockFromItems,
      safeBlockHeight: (value) => Math.max(0, Number(value) || 0),
    },
  );
  const historyPageFromStoredPayload = isolatedFunction(
    READER_PATH,
    "historyPageFromStoredPayload",
    {
      dateIso: (value) => value,
      embeddedHistoryIndexedThroughBlock,
      historyCursor: (snapshotId, offset) => `${snapshotId}:${offset}`,
      historyItemsMatchingQuery: (items) => items,
      indexedThroughBlockFromItems,
    },
  );
  const page = historyPageFromStoredPayload(
    {
      indexedAt: "2026-07-03T00:00:00.000Z",
      indexedThroughBlock: 120,
      items: [{ blockHeight: 120, txid: "3".repeat(64) }],
      source: "fixture",
    },
    {
      generated_at: "2026-07-11T00:00:00.000Z",
      indexed_through_block: 999,
      snapshot_id: "outer-newer",
    },
    "livenet",
    "transfers",
    { limit: 25, offset: 0, query: "" },
  );
  assert.equal(page.indexedThroughBlock, 120);
});

check("an outer ledger height cannot promote embedded token state", () => {
  const tokenStateWithSnapshotMetadata = isolatedFunction(
    READER_PATH,
    "tokenStateWithSnapshotMetadata",
    {
      dateIso: (value) => value,
      rowNumber: (row, key) => Number(row?.[key] ?? 0),
    },
  );
  const state = tokenStateWithSnapshotMetadata(
    {
      indexedAt: "2026-07-03T00:00:00.000Z",
      indexedThroughBlock: 120,
      source: "embedded",
    },
    {
      generated_at: "2026-07-11T00:00:00.000Z",
      indexed_through_block: 999,
      snapshot_id: "outer-newer",
    },
    "fixture",
  );
  assert.equal(state.indexedThroughBlock, 120);
});

check("the hot worker publishes a fresh canonical summary with conservative coverage", async () => {
  const objectPayload = (value) =>
    value && typeof value === "object" && !Array.isArray(value) ? value : null;
  const numberOrNull = (value) =>
    Number.isFinite(Number(value)) ? Number(value) : null;
  const summaryPayloadConservativeCoverage = isolatedFunction(
    BACKFILL_PATH,
    "summaryPayloadConservativeCoverage",
    { numberOrNull, objectPayload },
  );
  assert.equal(
    summaryPayloadConservativeCoverage(
      { floor: { indexedThroughBlock: 100 }, indexedThroughBlock: 101 },
      "workSummary",
    ),
    100,
  );
  const requiredKeys = [
    "growthSummary",
    "inceptionSummary",
    "infinitySummary",
    "marketplaceSummary",
    "workFloor",
    "workSummary",
  ];
  const canonicalSummaryCoverage = isolatedFunction(
    BACKFILL_PATH,
    "canonicalSummaryCoverage",
    {
      REQUIRED_CURRENT_SUMMARY_KEYS: requiredKeys,
      summaryPayloadConservativeCoverage,
    },
  );
  const summaryFor = (key, height, snapshotId = `full-${height}`) => ({
    indexedThroughBlock: height,
    snapshotId,
    ...(key === "workSummary"
      ? { floor: { indexedThroughBlock: height } }
      : key === "growthSummary" || key === "marketplaceSummary"
        ? { workFloor: { indexedThroughBlock: height } }
        : {}),
  });
  const previousPayload = {
    ok: true,
    snapshotId: "full-100",
    status: "consistent",
    summaryPayloads: Object.fromEntries(
      requiredKeys.map((key) => [key, summaryFor(key, 100)]),
    ),
  };
  const inserted = [];
  const storeCanonicalSummarySnapshot = isolatedFunction(
    BACKFILL_PATH,
    "storeCanonicalSummarySnapshot",
    {
      NETWORK: "livenet",
      SUMMARY_SNAPSHOT_SOURCES: [
        { key: "unused", path: "/unused" },
      ],
      CANONICAL_SUMMARY_REFRESH_TIMEOUT_MS: 120_000,
      REQUIRED_CURRENT_SUMMARY_KEYS: requiredKeys,
      canonicalSummaryCoverage,
      createHash,
      latestBlockScanCheckpoint: async () => ({ height: 101 }),
      numberOrNull,
      objectPayload,
      readJson: async (url, options) => {
        assert.equal(url.pathname, "/api/v1/internal/canonical-summary");
        assert.equal(options.retries, 0);
        assert.equal(options.timeoutMs, 120_000);
        return {
          indexedThroughBlock: 101,
          ledger: {
            checks: [{ name: "ledger-covers-node-tip", ok: true }],
            indexedThroughBlock: 101,
            metrics: { indexedThroughBlock: 101 },
            ok: true,
            snapshotId: "full-101",
            status: "consistent",
            tokenState: { indexedThroughBlock: 101, marker: "canonical" },
          },
          snapshotId: "full-101",
          summaryPayloads: Object.fromEntries(
            requiredKeys.map((key) => [key, summaryFor(key, 101)]),
          ),
        };
      },
      storedEligibleCanonicalSummarySnapshotPayload: async () =>
        previousPayload,
      storedLedgerSnapshotPayload: async (_client, snapshotId) => ({
        activityPayload: { marker: `derived-${snapshotId}` },
      }),
      summaryPayloadSnapshotId: (payload) => String(payload?.snapshotId ?? ""),
      summaryPayloadsWithAlignedWorkFloor: (payload) => payload,
      summarySnapshotTotals: () => ({ workNetworkValueSats: 1 }),
      unpagedEndpoint: (pathname) => ({ pathname }),
    },
  );
  const result = await storeCanonicalSummarySnapshot({
    async query(sql, params) {
      inserted.push({ params: Array.from(params), sql: String(sql) });
      return { rows: [] };
    },
  });
  assert.equal(result.skipped, false);
  assert.equal(result.indexedThroughBlock, 101);
  assert.equal(inserted.length, 1);
  assert.equal(inserted[0].params[3], 101);
  const stored = JSON.parse(inserted[0].params[7]);
  assert.equal(stored.indexedThroughBlock, 101);
  assert.equal(stored.tokenState.marker, "canonical");
  assert.equal(stored.summaryRefresh.indexedThroughBlock, 101);
  assert.equal(stored.summaryRefresh.mode, "canonical-summary-refresh");
  assert.equal(stored.activityPayload.marker, "derived-full-101");
  assert.ok(stored.sourceHashes.canonicalSummary);
  assert.ok(
    Object.values(stored.summaryPayloads).every(
      (payload) => payload.indexedThroughBlock === 101,
    ),
  );
});

check("canonical summary tip races defer without failing the block worker", () => {
  const canonicalSummaryRefreshCanDefer = isolatedFunction(
    BACKFILL_PATH,
    "canonicalSummaryRefreshCanDefer",
  );
  const tipRace = Object.assign(
    new Error("/api/v1/internal/canonical-summary returned HTTP 503"),
    {
      responseText: JSON.stringify({
        error:
          "The indexed canonical summary checkpoint is not exactly at the Bitcoin Core tip.",
      }),
      statusCode: 503,
    },
  );
  assert.equal(canonicalSummaryRefreshCanDefer(tipRace), true);
  assert.equal(
    canonicalSummaryRefreshCanDefer(
      Object.assign(new Error("database failed"), { statusCode: 503 }),
    ),
    false,
  );
});

check("the canonical summary publisher rejects mixed snapshot identities", async () => {
  const objectPayload = (value) =>
    value && typeof value === "object" && !Array.isArray(value) ? value : null;
  const numberOrNull = (value) =>
    Number.isFinite(Number(value)) ? Number(value) : null;
  const requiredKeys = [
    "growthSummary",
    "inceptionSummary",
    "infinitySummary",
    "marketplaceSummary",
    "workFloor",
    "workSummary",
  ];
  const summaryPayloadConservativeCoverage = isolatedFunction(
    BACKFILL_PATH,
    "summaryPayloadConservativeCoverage",
    { numberOrNull, objectPayload },
  );
  const canonicalSummaryCoverage = isolatedFunction(
    BACKFILL_PATH,
    "canonicalSummaryCoverage",
    {
      REQUIRED_CURRENT_SUMMARY_KEYS: requiredKeys,
      summaryPayloadConservativeCoverage,
    },
  );
  const summaryFor = (key, snapshotId = "one-snapshot") => ({
    indexedThroughBlock: 101,
    snapshotId,
    ...(key === "workSummary"
      ? { floor: { indexedThroughBlock: 101 } }
      : key === "growthSummary" || key === "marketplaceSummary"
        ? { workFloor: { indexedThroughBlock: 101 } }
        : {}),
  });
  let writes = 0;
  const storeCanonicalSummarySnapshot = isolatedFunction(
    BACKFILL_PATH,
    "storeCanonicalSummarySnapshot",
    {
      CANONICAL_SUMMARY_REFRESH_TIMEOUT_MS: 120_000,
      NETWORK: "livenet",
      REQUIRED_CURRENT_SUMMARY_KEYS: requiredKeys,
      canonicalSummaryCoverage,
      createHash,
      latestBlockScanCheckpoint: async () => ({ height: 101 }),
      numberOrNull,
      objectPayload,
      readJson: async () => ({
        indexedThroughBlock: 101,
        ledger: {
          indexedThroughBlock: 101,
          metrics: { indexedThroughBlock: 101 },
          ok: true,
          snapshotId: "one-snapshot",
          status: "consistent",
        },
        snapshotId: "one-snapshot",
        summaryPayloads: Object.fromEntries(
          requiredKeys.map((key) => [
            key,
            summaryFor(key, key === "infinitySummary" ? "mixed" : undefined),
          ]),
        ),
      }),
      storedEligibleCanonicalSummarySnapshotPayload: async () => null,
      storedLedgerSnapshotPayload: async () => ({}),
      summaryPayloadSnapshotId: (payload) => String(payload?.snapshotId ?? ""),
      summaryPayloadsWithAlignedWorkFloor: (payload) => payload,
      summarySnapshotTotals: () => ({}),
      unpagedEndpoint: (pathname) => ({ pathname }),
    },
  );
  await rejection(
    storeCanonicalSummarySnapshot({
      async query() {
        writes += 1;
        return { rows: [] };
      },
    }),
    (error) => /not one exact snapshot/u.test(error.message),
  );
  assert.equal(writes, 0);
});

check("exact canonical summaries require current conserved token balances", async () => {
  const tokenTablePayloadHasConservedBalances = isolatedFunction(
    API_PATH,
    "tokenTablePayloadHasConservedBalances",
  );
  const tokenId = "a".repeat(64);
  const conserved = {
    holders: [
      { address: "alice", balance: 600, tokenId },
      { address: "bob", balance: 400, tokenId },
    ],
    mints: [
      { amount: 600, confirmed: true, tokenId },
      { amount: 400, confirmed: true, tokenId },
    ],
    tokens: [{ tokenId }],
  };
  assert.equal(tokenTablePayloadHasConservedBalances(conserved), true);
  assert.equal(
    tokenTablePayloadHasConservedBalances({ ...conserved, holders: [] }),
    false,
  );
  assert.equal(
    tokenTablePayloadHasConservedBalances({
      ...conserved,
      holders: [{ address: "alice", balance: 999, tokenId }],
    }),
    false,
  );
  const orphanTokenId = "b".repeat(64);
  assert.equal(
    tokenTablePayloadHasConservedBalances({
      ...conserved,
      holders: [
        ...conserved.holders,
        { address: "mallory", balance: 100, tokenId: orphanTokenId },
      ],
      mints: [
        ...conserved.mints,
        { amount: 100, confirmed: true, tokenId: orphanTokenId },
      ],
    }),
    false,
  );

  let requestedHeight = 0;
  let tablePayload = null;
  const exactTokenTablePayloadForCanonicalLedger = isolatedFunction(
    API_PATH,
    "exactTokenTablePayloadForCanonicalLedger",
    {
      currentProofIndexTokenTablePayloadForLedger: async (
        _network,
        _label,
        options,
      ) => {
        requestedHeight = options.exactHeight;
        return tablePayload;
      },
      freshDataUnavailableError: (message) => new Error(message),
      tokenTablePayloadHasConservedBalances,
    },
  );
  await rejection(
    exactTokenTablePayloadForCanonicalLedger("livenet", "fixture", 101),
    (error) => /exact conserved token balances are unavailable/u.test(error.message),
  );
  assert.equal(requestedHeight, 101);
  await rejection(
    exactTokenTablePayloadForCanonicalLedger("livenet", "fixture", 0),
    (error) => /exact positive token-table checkpoint/u.test(error.message),
  );
  tablePayload = conserved;
  assert.equal(
    await exactTokenTablePayloadForCanonicalLedger("livenet", "fixture", 102),
    conserved,
  );
  assert.equal(requestedHeight, 102);
});

check("livenet summary routes prefer the exact stored canonical snapshot", async () => {
  const requestSource = topLevelFunctionSource(API_PATH, "handleRequest");
  const workSource = topLevelFunctionSource(API_PATH, "workSummaryPayload");
  const marketplaceSource = topLevelFunctionSource(
    API_PATH,
    "livenetMarketplaceSummaryPayload",
  );
  const bondSummarySource = topLevelFunctionSource(
    API_PATH,
    "bondSummaryPayload",
  );
  const growthSource = topLevelFunctionSource(API_PATH, "growthSummaryPayload");
  const workRouteStart = requestSource.indexOf(
    'if (url.pathname === "/api/v1/work-summary")',
  );
  const workRouteEnd = requestSource.indexOf(
    'if (url.pathname === "/api/v1/marketplace-summary")',
    workRouteStart,
  );
  const exactInfinitySummaryRead = bondSummarySource.indexOf(
    "currentProofIndexSummarySnapshotFallbackPayload",
  );
  const relationalInfinitySummaryRead = bondSummarySource.indexOf(
    "proofIndexBondSummaryPayload",
  );
  assert.ok(workRouteStart >= 0);
  assert.ok(workRouteEnd > workRouteStart);
  assert.ok(exactInfinitySummaryRead >= 0);
  assert.ok(relationalInfinitySummaryRead > exactInfinitySummaryRead);
  const workRouteSource = requestSource.slice(workRouteStart, workRouteEnd);

  assert.doesNotMatch(workRouteSource, /fastLivenetWorkSummaryPayload/u);
  assert.match(
    workRouteSource,
    /workSummaryPayload\(network,\s*freshRead\)/u,
  );
  assert.ok(
    workSource.indexOf("currentProofIndexSummarySnapshotFallbackPayload") <
      workSource.indexOf("summaryCanonicalLedgerPayload"),
  );
  assert.ok(
    marketplaceSource.indexOf(
      "currentProofIndexMarketplaceSummaryFallbackPayload",
    ) < marketplaceSource.indexOf("if (!fresh)"),
  );
  assert.ok(
    growthSource.indexOf("currentProofIndexSummarySnapshotFallbackPayload") <
      growthSource.indexOf("summaryCanonicalLedgerPayload"),
  );

  const canonicalInfinity = { snapshotId: "canonical-infinity" };
  const relationalInfinity = { snapshotId: "relational-infinity" };
  let exactInfinity = canonicalInfinity;
  let relationalInfinityReads = 0;
  const readBondSummary = isolatedFunction(
    API_PATH,
    "bondSummaryPayload",
    {
      LEDGER_SUMMARY_FRESH_WAIT_MS: 1_000,
      bondSummaryFromCanonicalLedger: async () => null,
      currentProofIndexSummarySnapshotFallbackPayload: async () => exactInfinity,
      existingCurrentCanonicalLedgerPayloadWithinMs: async () => null,
      freshDataUnavailableError: (message) => new Error(message),
      numericValue: (value) => Number(value) || 0,
      payloadWithFallbackAfterMs: async (promise, fallback) =>
        (await promise) ?? fallback,
      proofIndexBondSummaryPayload: async () => {
        relationalInfinityReads += 1;
        return relationalInfinity;
      },
      standaloneBondSummaryPayload: async () => null,
      summaryCanonicalLedgerPayload: async () => null,
    },
  );
  const infinityConfig = {
    displayName: "Infinity Bond",
    summaryKey: "infinitySummary",
    summaryRoute: "infinity-summary",
  };
  assert.equal(
    await readBondSummary("livenet", false, infinityConfig),
    canonicalInfinity,
  );
  assert.equal(
    await readBondSummary("livenet", true, infinityConfig),
    relationalInfinity,
  );
  assert.equal(relationalInfinityReads, 1);
  exactInfinity = null;
  assert.equal(
    await readBondSummary("livenet", false, infinityConfig),
    relationalInfinity,
  );
  assert.equal(relationalInfinityReads, 2);
});

check("exact token tables own the current active listing set", () => {
  const key = (item) => `${item?.tokenId ?? ""}:${item?.listingId ?? ""}`;
  const tokenStateWithAuthoritativeCurrentListings = isolatedFunction(
    API_PATH,
    "tokenStateWithAuthoritativeCurrentListings",
    {
      mergeTokenListingRecord: (current, incoming) => ({
        ...(current ?? {}),
        ...(incoming ?? {}),
      }),
      mergeTokenStateItemsByKey: (currentItems, incomingItems, keyForItem, merge) => {
        const merged = new Map();
        for (const item of Array.isArray(currentItems) ? currentItems : []) {
          merged.set(keyForItem(item), item);
        }
        for (const item of Array.isArray(incomingItems) ? incomingItems : []) {
          const itemKey = keyForItem(item);
          merged.set(itemKey, merge(merged.get(itemKey), item));
        }
        return [...merged.values()];
      },
      normalizeTokenScope: (value) => String(value ?? "").toLowerCase(),
      tokenClosedListingItemKey: key,
      tokenListingItemKey: key,
      tokenStateWithPendingStats: (state) => state,
    },
  );
  const current = tokenStateWithAuthoritativeCurrentListings(
    {
      closedListings: [],
      listings: [
        { listingId: "stale", tokenId: "work" },
        { listingId: "active", richField: true, tokenId: "work" },
        { listingId: "other", tokenId: "other" },
      ],
    },
    {
      closedListings: [
        { closedTxid: "close", listingId: "stale", tokenId: "work" },
      ],
      listings: [
        { listingId: "active", status: "active", tokenId: "work" },
      ],
      tokens: [{ tokenId: "work" }],
    },
  );
  assert.deepEqual(
    Array.from(current.listings, (listing) => listing.listingId).sort(),
    ["active", "other"],
  );
  assert.equal(
    current.listings.find((listing) => listing.listingId === "active")
      .richField,
    true,
  );
  assert.deepEqual(
    Array.from(current.closedListings, (listing) => listing.listingId),
    ["stale"],
  );
});

check("exact canonical source reads reject lagging activity and registry payloads", async () => {
  const activityPayload = {
    activity: [{ confirmed: true, txid: "a".repeat(64) }],
    indexedThroughBlock: 100,
  };
  const indexedActivityStateForCanonicalLedger = isolatedFunction(
    API_PATH,
    "indexedActivityStateForCanonicalLedger",
    {
      errorSummary: (error) => String(error?.message ?? error),
      proofIndexCanonicalActivityPayload: async () => activityPayload,
      proofIndexPayloadCoversConfirmedTip: async () => true,
      proofIndexPayloadIndexedThroughBlock: (payload) =>
        Number(payload?.indexedThroughBlock) || 0,
      proofIndexReadFeatureEnabled: () => true,
    },
  );
  assert.equal(
    await indexedActivityStateForCanonicalLedger("livenet", {
      exactHeight: 101,
    }),
    null,
  );
  assert.equal(
    await indexedActivityStateForCanonicalLedger("livenet", {
      exactHeight: 100,
    }),
    activityPayload,
  );

  const registryPayload = { indexedThroughBlock: 100, records: [{}] };
  const indexedRegistryStateForCanonicalLedger = isolatedFunction(
    API_PATH,
    "indexedRegistryStateForCanonicalLedger",
    {
      indexedRegistryPayload: async () => registryPayload,
      proofIndexPayloadCoversConfirmedTip: async () => true,
      proofIndexPayloadIndexedThroughBlock: (payload) =>
        Number(payload?.indexedThroughBlock) || 0,
    },
  );
  assert.equal(
    await indexedRegistryStateForCanonicalLedger("livenet", {
      exactHeight: 101,
    }),
    null,
  );
  assert.equal(
    await indexedRegistryStateForCanonicalLedger("livenet", {
      exactHeight: 100,
    }),
    registryPayload,
  );
});

check("canonical registry state can replace a stale higher cached count", async () => {
  const payload = {
    indexedThroughBlock: 957_616,
    records: Array.from({ length: 492 }, () => ({})),
  };
  let rejectArguments = [];
  const indexedRegistryPayload = isolatedFunction(
    API_PATH,
    "indexedRegistryPayload",
    {
      compareRegistryRecordDisplayOrder: () => 0,
      errorSummary: (error) => String(error?.message ?? error),
      proofIndexReadFeatureEnabled: () => true,
      proofIndexRegistryPayload: async () => payload,
      registryAddressForNetwork: () => "bc1registry",
      registryConfirmedCount: (value) => value?.records?.length ?? 0,
      registryIndexedPayloadRejectReason: (...args) => {
        rejectArguments = args;
        return "";
      },
    },
  );

  const accepted = await indexedRegistryPayload("livenet");
  assert.equal(accepted.indexedThroughBlock, payload.indexedThroughBlock);
  assert.equal(accepted.records.length, payload.records.length);
  assert.equal(rejectArguments.length, 1);
  assert.equal(
    rejectArguments[0].indexedThroughBlock,
    payload.indexedThroughBlock,
  );
  assert.equal(rejectArguments[0].records.length, payload.records.length);
});

check("strict RUSH history is complete and ordered by canonical blocks", async () => {
  const confirmedElectrumHistoryEntries = isolatedFunction(
    API_PATH,
    "confirmedElectrumHistoryEntries",
  );
  const firstTxid = "1".repeat(64);
  const secondTxid = "2".repeat(64);
  const blockHash = "a".repeat(64);
  assert.deepEqual(
    Array.from(
      confirmedElectrumHistoryEntries(
        [
          { height: 100, tx_hash: secondTxid },
          { height: 0, tx_hash: "3".repeat(64) },
          { height: 100, tx_hash: firstTxid },
        ],
        101,
      ),
    ).map((entry) => ({ height: entry.height, txid: entry.txid })),
    [
      { height: 100, txid: secondTxid },
      { height: 100, txid: firstTxid },
    ],
  );
  assert.throws(
    () =>
      confirmedElectrumHistoryEntries(
        [
          { height: 100, tx_hash: firstTxid },
          { height: 101, tx_hash: firstTxid },
        ],
        101,
      ),
    /conflicting heights/u,
  );

  let failingTxid = "";
  const strictCanonicalRushTransactions = isolatedFunction(
    API_PATH,
    "strictCanonicalRushTransactions",
    {
      ADDRESS_ELECTRUM_HISTORY_TIMEOUT_MS: 5_000,
      ELECTRUM_HOST: "127.0.0.1",
      ELECTRUM_PORT: 50_001,
      TX_FETCH_CONCURRENCY: 4,
      bitcoinRpc: async (method, params) => {
        assert.equal(method, "getblockhash");
        assert.equal(params[0], 100);
        return { ok: true, result: blockHash };
      },
      canonicalBlockTxidIndexFromCore: async () =>
        new Map([
          [secondTxid, 0],
          [firstTxid, 1],
        ]),
      confirmedElectrumHistoryEntries,
      electrumRequest: async () => [
        { height: 100, tx_hash: firstTxid },
        { height: 100, tx_hash: secondTxid },
      ],
      fetchTransactionFromBitcoinRpc: async (txid) => {
        if (txid === failingTxid) {
          throw new Error("fixture hydration failed");
        }
        return {
          status: { block_hash: blockHash, confirmed: true },
          txid,
          vin: [],
          vout: [],
        };
      },
      freshDataUnavailableError: (message) => new Error(message),
      mapWithConcurrency: async (items, _concurrency, mapper) =>
        Promise.all(items.map(mapper)),
      scriptHashForAddress: () => "fixture-scripthash",
      transactionBlockHash: (tx) => tx.status.block_hash,
      transactionConfirmed: (tx) => tx.status.confirmed === true,
      transactionTxid: (tx) => tx.txid,
    },
  );
  const transactions = await strictCanonicalRushTransactions(
    "bc1registry",
    "livenet",
    101,
  );
  assert.deepEqual(
    transactions.map((tx) => [tx.txid, tx.status.block_height, tx._powBlockIndex]),
    [
      [firstTxid, 100, 1],
      [secondTxid, 100, 0],
    ],
  );
  failingTxid = secondTxid;
  await rejection(
    strictCanonicalRushTransactions("bc1registry", "livenet", 101),
    (error) => /fixture hydration failed/u.test(error.message),
    "One failed RUSH hydration must abort the complete canonical history",
  );
});

check("internal canonical routes require token, loopback socket, and loopback Host", () => {
  const token = "t".repeat(64);
  const internalVerifierRequestAllowed = isolatedFunction(
    API_PATH,
    "internalVerifierRequestAllowed",
    { Buffer, INTERNAL_VERIFIER_TOKEN: token, timingSafeEqual },
  );
  const request = (presentedToken, remoteAddress, host = "127.0.0.1:8097") => ({
    headers: {
      host,
      "x-pow-internal-verifier": presentedToken,
    },
    socket: { remoteAddress },
  });
  assert.equal(
    internalVerifierRequestAllowed(request(token, "127.0.0.1")),
    true,
  );
  assert.equal(
    internalVerifierRequestAllowed(request(token, "::1", "[::1]:8097")),
    true,
  );
  assert.equal(
    internalVerifierRequestAllowed(request("wrong", "127.0.0.1")),
    false,
  );
  assert.equal(
    internalVerifierRequestAllowed(request(token, "203.0.113.8")),
    false,
  );
  assert.equal(
    internalVerifierRequestAllowed(
      request(token, "127.0.0.1", "computer.proofofwork.me"),
    ),
    false,
  );
});

check("pending ID checks fall back to supported Electrum history", async () => {
  const calls = [];
  const electrumPendingScripthashEntries = isolatedFunction(
    API_PATH,
    "electrumPendingScripthashEntries",
    {
      HEALTH_CHECK_TIMEOUT_MS: 5_000,
      electrumRequest: async (method) => {
        calls.push(method);
        if (method === "blockchain.scripthash.get_mempool") {
          throw new Error("method not found");
        }
        return [
          { height: 956_000, tx_hash: "1".repeat(64) },
          { height: 0, tx_hash: "2".repeat(64) },
          { height: -1, tx_hash: "3".repeat(64) },
        ];
      },
      errorSummary: (error) => error.message,
    },
  );
  const entries = await electrumPendingScripthashEntries("fixture");
  assert.deepEqual(calls, [
    "blockchain.scripthash.get_mempool",
    "blockchain.scripthash.get_history",
  ]);
  assert.deepEqual(
    entries.map((entry) => entry.height),
    [0, -1],
  );
});

check("block verification completes before the atomic block transaction", async () => {
  const events = [];
  const txid = "4".repeat(64);
  const backfillBlockScanSource = isolatedFunction(
    BACKFILL_PATH,
    "backfillBlockScanSource",
    {
      BITCOIN_RPC_URL: "http://core.invalid",
      BLOCK_SCAN_MAX_BLOCKS: 0,
      BLOCK_SCAN_MAX_TXIDS: Number.POSITIVE_INFINITY,
      CANONICAL_REBUILD: false,
      CANONICAL_FAULT_META_KEY: "canonical:fault",
      CANONICAL_REBUILD_META_KEY: "canonical:rebuild",
      NETWORK: "livenet",
      canonicalRebuildCheckpointValue: () => null,
      proofIndexerMetaValue: async () => null,
      bitcoinRpc: async (method, params = []) => {
        if (method === "getblockcount") return 101;
        if (method === "getblockhash") return params[0] === 100 ? "h100" : "h101";
        if (method === "getblock") {
          return {
            hash: "h101",
            height: 101,
            nTx: 1,
            previousblockhash: "h100",
            time: 1_700_000_000,
            tx: [{ txid }],
          };
        }
        throw new Error(`unexpected RPC method ${method}`);
      },
      latestBlockScanCheckpoint: async () => ({ blockHash: "h100", height: 100 }),
      assertCanonicalBlockEnvelope: () => {},
      assertHydratedProtocolTransaction: () => {},
      persistPreparedProtocolItems: async () => {
        events.push("persist");
        return { indexed: 1, skipped: 0 };
      },
      persistCanonicalBlock: async () => {
        events.push("block");
      },
      persistCanonicalRawTransaction: async () => {
        events.push("raw");
      },
      preparedProtocolItemsForTx: async () => {
        events.push("verify");
        return [{ item: { txid }, sourceLabel: "id-records" }];
      },
      protocolMessagesFromTx: () => ["pwid1:r2:fixture"],
      rebuildConfirmedCreditBalancesFromCanonicalEvents: async () => {
        events.push("balances");
      },
      storeBlockScanSnapshot: async () => {
        events.push("checkpoint");
      },
      transactionWithInputPrevouts: async (tx) => tx,
    },
  );
  const client = {
    async query(sql) {
      events.push(String(sql).trim());
      return { rows: [] };
    },
  };
  await backfillBlockScanSource(client, { label: "block-scan" });
  assert.deepEqual(events, [
    "verify",
    "BEGIN",
    "block",
    "raw",
    "persist",
    "balances",
    "checkpoint",
    "COMMIT",
  ]);
});

check("a verifier error cannot begin or advance a block checkpoint", async () => {
  const databaseCalls = [];
  const checkpointCalls = [];
  const txid = "5".repeat(64);
  const backfillBlockScanSource = isolatedFunction(
    BACKFILL_PATH,
    "backfillBlockScanSource",
    {
      BITCOIN_RPC_URL: "http://core.invalid",
      BLOCK_SCAN_MAX_BLOCKS: 0,
      BLOCK_SCAN_MAX_TXIDS: Number.POSITIVE_INFINITY,
      CANONICAL_REBUILD: false,
      CANONICAL_FAULT_META_KEY: "canonical:fault",
      CANONICAL_REBUILD_META_KEY: "canonical:rebuild",
      NETWORK: "livenet",
      canonicalRebuildCheckpointValue: () => null,
      proofIndexerMetaValue: async () => null,
      bitcoinRpc: async (method, params = []) => {
        if (method === "getblockcount") return 101;
        if (method === "getblockhash") return params[0] === 100 ? "h100" : "h101";
        if (method === "getblock") {
          return {
            hash: "h101",
            height: 101,
            nTx: 1,
            previousblockhash: "h100",
            time: 1_700_000_000,
            tx: [{ txid }],
          };
        }
        throw new Error(`unexpected RPC method ${method}`);
      },
      latestBlockScanCheckpoint: async () => ({ blockHash: "h100", height: 100 }),
      assertCanonicalBlockEnvelope: () => {},
      assertHydratedProtocolTransaction: () => {},
      persistPreparedProtocolItems: async () => ({ indexed: 1, skipped: 0 }),
      preparedProtocolItemsForTx: async () => {
        throw new Error("canonical verifier is stale");
      },
      protocolMessagesFromTx: () => ["pwid1:r2:fixture"],
      storeBlockScanSnapshot: async (client, payload) => {
        checkpointCalls.push(payload);
      },
      transactionWithInputPrevouts: async (tx) => tx,
    },
  );
  const client = {
    async query(sql) {
      databaseCalls.push(String(sql).trim());
      return { rows: [] };
    },
  };
  await rejection(
    backfillBlockScanSource(client, { label: "block-scan" }),
    (error) => /canonical verifier is stale/u.test(error.message),
    "The block scan should fail closed on an unresolved canonical verifier",
  );
  assert.deepEqual(databaseCalls, []);
  assert.deepEqual(checkpointCalls, []);
});

check("the protocol tx target defers a later block but never splits one", async () => {
  async function runFixture(protocolCounts) {
    const persistedBlocks = [];
    let verified = 0;
    const tipHeight = 100 + protocolCounts.length;
    const blockFor = (height) => {
      const count = protocolCounts[height - 101] ?? 0;
      return {
        hash: `h${height}`,
        height,
        nTx: count,
        previousblockhash: `h${height - 1}`,
        time: 1_700_000_000 + height,
        tx: Array.from({ length: count }, (_, index) => ({
          txid: (BigInt(height) * 1_000_000n + BigInt(index) + 1n)
            .toString(16)
            .padStart(64, "0"),
        })),
      };
    };
    const backfillBlockScanSource = isolatedFunction(
      BACKFILL_PATH,
      "backfillBlockScanSource",
      {
        BITCOIN_RPC_URL: "http://core.invalid",
        BLOCK_SCAN_MAX_BLOCKS: 0,
        BLOCK_SCAN_MAX_TXIDS: 250,
        CANONICAL_FAULT_META_KEY: "canonical:fault",
        CANONICAL_REBUILD: false,
        CANONICAL_REBUILD_META_KEY: "canonical:rebuild",
        NETWORK: "livenet",
        assertCanonicalBlockEnvelope: () => {},
        assertHydratedProtocolTransaction: () => {},
        bitcoinRpc: async (method, params = []) => {
          if (method === "getblockcount") return tipHeight;
          if (method === "getblockhash") return `h${params[0]}`;
          if (method === "getblock") {
            const height = Number(String(params[0]).slice(1));
            return blockFor(height);
          }
          throw new Error(`unexpected RPC method ${method}`);
        },
        canonicalRebuildCheckpointValue: () => null,
        latestBlockScanCheckpoint: async () => ({ blockHash: "h100", height: 100 }),
        persistCanonicalBlock: async (_client, _block, height) => {
          persistedBlocks.push(height);
        },
        persistCanonicalRawTransaction: async () => {},
        persistPreparedProtocolItems: async () => ({ indexed: 0, skipped: 0 }),
        preparedProtocolItemsForTx: async () => {
          verified += 1;
          return [];
        },
        proofIndexerMetaValue: async () => null,
        protocolMessagesFromTx: () => ["pwid1:r2:fixture"],
        rebuildConfirmedCreditBalancesFromCanonicalEvents: async () => {},
        storeBlockScanSnapshot: async () => {},
        transactionWithInputPrevouts: async (tx) => tx,
      },
    );
    const client = {
      async query() {
        return { rows: [] };
      },
    };
    const result = await backfillBlockScanSource(client, { label: "block-scan" });
    return { persistedBlocks, result, verified };
  }

  const deferred = await runFixture([249, 10]);
  assert.deepEqual(deferred.persistedBlocks, [101]);
  assert.equal(deferred.verified, 249);
  assert.equal(deferred.result.indexedThroughBlock, 101);
  assert.equal(deferred.result.stopReason, "protocol-txid-limit");

  const denseFirstBlock = await runFixture([251]);
  assert.deepEqual(denseFirstBlock.persistedBlocks, [101]);
  assert.equal(denseFirstBlock.verified, 251);
  assert.equal(denseFirstBlock.result.indexedThroughBlock, 101);
  assert.equal(denseFirstBlock.result.complete, true);
});

check("an explicitly requested participant repair aborts when its row is absent", async () => {
  const txid = "6".repeat(64);
  let coreReads = 0;
  const queries = [];
  const repairConfirmedWorkTransferParticipants = isolatedFunction(
    BACKFILL_PATH,
    "repairConfirmedWorkTransferParticipants",
    {
      BITCOIN_RPC_URL: "http://core.invalid",
      NETWORK: "livenet",
      REPAIR_WORK_PARTICIPANTS: true,
      REPAIR_WORK_PARTICIPANTS_LIMIT: 10,
      REPAIR_WORK_PARTICIPANTS_TXIDS: [txid],
      WORK_TOKEN_ID: "work-token",
      rawTransactionFromCore: async () => {
        coreReads += 1;
        return null;
      },
    },
  );
  const client = {
    async query(sql, params) {
      queries.push({ params, sql: String(sql).trim() });
      return { rows: [] };
    },
  };
  await rejection(
    repairConfirmedWorkTransferParticipants(client),
    (error) => error.message.includes(txid),
    "A missing explicit txid must be reported instead of a successful zero-row repair",
  );
  assert.equal(coreReads, 0);
  assert.deepEqual(Array.from(queries[0].params[2]), [txid]);
  assert.equal(queries.some((call) => call.sql === "BEGIN"), false);
});

check("Carbonz valid transfer participant repair preserves the legacy event key", () => {
  const txid = "6ed13a1783d612dc1c1f692d2bd6e60c55f3bf88ead9352112a78931ea18852f";
  const tokenId = "b".repeat(64);
  const stableEventKey = isolatedFunction(BACKFILL_PATH, "stableEventKey");
  const input = {
    kind: "token-transfer",
    protocol: "pwt1",
    sourceLabel: "token-transfers",
    txid,
  };
  const legacyKey = stableEventKey({
    ...input,
    item: { tokenId },
  });
  const repairedKey = stableEventKey({
    ...input,
    item: { protocolVout: 4, tokenId, vout: 4 },
  });
  assert.equal(repairedKey, legacyKey);
  assert.equal(legacyKey, `pwt1:token-transfer:${txid}:${tokenId}`);
});

check("only true same-kind duplicates receive stable ordinals", () => {
  const txid = "f".repeat(64);
  const tokenId = "a".repeat(64);
  const disambiguateDuplicateProtocolItems = isolatedFunction(
    BACKFILL_PATH,
    "disambiguateDuplicateProtocolItems",
  );
  const stableEventKey = isolatedFunction(BACKFILL_PATH, "stableEventKey");
  const duplicates = disambiguateDuplicateProtocolItems([
    { kind: "token-transfer", protocol: "pwt1", protocolVout: 4, tokenId, txid },
    { kind: "token-transfer", protocol: "pwt1", protocolVout: 9, tokenId, txid },
    { kind: "token-transfer", protocol: "pwt1", protocolVout: 12, tokenId, txid },
    { kind: "token-mint", protocol: "pwt1", protocolVout: 13, tokenId, txid },
  ]);
  assert.equal(duplicates[0].eventKeyVout, undefined);
  assert.equal(duplicates[1].eventKeyVout, 1);
  assert.equal(duplicates[2].eventKeyVout, 2);
  assert.equal(duplicates[3].eventKeyVout, undefined);
  const keys = duplicates.slice(0, 3).map((item) =>
    stableEventKey({
      item,
      kind: item.kind,
      protocol: item.protocol,
      sourceLabel: "token-transfers",
      txid,
    }),
  );
  assert.equal(new Set(keys).size, 3);
});

check("pwm1 outputs aggregate once while staged protocols stay unscanned", () => {
  let baseCalls = 0;
  const decodedBase64UrlBytes = isolatedFunction(
    BACKFILL_PATH,
    "decodedBase64UrlBytes",
    { Buffer },
  );
  const aggregatePwmProtocolItem = isolatedFunction(
    BACKFILL_PATH,
    "aggregatePwmProtocolItem",
    {
      Buffer,
      INFINITY_BOND_KIND: "infinity-bond",
      INFINITY_BOND_MEMO: "powb",
      MAIL_ATTACHMENT_MAX_BYTES: 60_000,
      bondTagForMemo: (value) =>
        value === "powb" ? { kind: "infinity-bond" } : null,
      baseProtocolItem: (_tx, _message, kind) => {
        baseCalls += 1;
        return { amountSats: "1000", kind, protocol: "pwm1", txid: "1".repeat(64) };
      },
      createHash: (algorithm) =>
        // The fixture attachment is not exercised in this aggregate value check.
        ({ update: () => ({ digest: () => algorithm }) }),
      decodeBase64UrlText: (value) =>
        Buffer.from(String(value), "base64url").toString("utf8"),
      decodedBase64UrlBytes,
    },
  );
  const messages = [
    { prefix: "pwm1:", text: "pwm1:s:SGVsbG8", voutIndex: 2 },
    { prefix: "pwm1:", text: "pwm1:m:proof", voutIndex: 3 },
    { prefix: "pwm1:", text: "pwm1:m:s", voutIndex: 4 },
  ];
  const item = aggregatePwmProtocolItem({ txid: "1".repeat(64) }, messages);
  assert.equal(baseCalls, 1);
  assert.equal(item.kind, "mail");
  assert.equal(item.memo, "proofs");
  assert.equal(item.subject, "Hello");
  assert.equal(item.amountSats, "1000");
  assert.equal(
    item.dataBytes,
    messages.reduce((total, message) => total + Buffer.byteLength(message.text), 0),
  );
  const rawProtocolItemsForTx = isolatedFunction(
    BACKFILL_PATH,
    "rawProtocolItemsForTx",
    {
      aggregatePwmProtocolItem,
      canonicalBondMintItemsFromMailItem: () => [],
      protocolItemsFromTx: () => {
        assert.fail("staged protocol reached a raw block-scan parser");
      },
    },
  );
  const aggregated = rawProtocolItemsForTx(
    { txid: "1".repeat(64) },
    [
      ...messages,
      { prefix: "pwr1:", text: "pwr1:m:rush", voutIndex: 5 },
      { prefix: "pwc1:", text: "pwc1:profile:staged", voutIndex: 6 },
    ],
  );
  assert.equal(aggregated.length, 1);
  assert.equal(aggregated[0].amountSats, "1000");

  const protocolMessagesFromTx = isolatedFunction(
    BACKFILL_PATH,
    "protocolMessagesFromTx",
    {
      PROTOCOL_PREFIXES: ["pwm1:", "pwid1:", "pwt1:"],
      opReturnTextFromVout: (vout) => vout.text,
    },
  );
  const scanned = protocolMessagesFromTx({
    vout: [
      { text: "pwr1:m:rush" },
      { text: "pwc1:profile:staged" },
      { text: "pwm1:m:hello" },
    ],
  });
  assert.deepEqual(Array.from(scanned, (message) => message.prefix), ["pwm1:"]);
});

check("legacy pwid1:r registrations retain plain IDs and projection fields", () => {
  const protocolItemsFromTx = isolatedFunction(
    BACKFILL_PATH,
    "protocolItemsFromTx",
    {
      baseProtocolItem: (_tx, _message, kind) => ({
        kind,
        protocol: "pwid1",
        txid: "a".repeat(64),
      }),
      decodeBase64UrlText: (value) =>
        Buffer.from(String(value), "base64url").toString("utf8"),
      normalizedPowId: (value) => String(value ?? "").trim().toLowerCase(),
    },
  );
  const [registration] = protocolItemsFromTx(
    { txid: "a".repeat(64) },
    {
      prefix: "pwid1:",
      text: "pwid1:r:bitcoin:1owner:1receiver",
    },
  );

  assert.equal(registration.kind, "id-register");
  assert.equal(registration.id, "bitcoin");
  assert.equal(registration.ownerAddress, "1owner");
  assert.equal(registration.receiveAddress, "1receiver");
});

check("canonical PWM aggregation classifies reply, file, and bond once", () => {
  const bytes = Buffer.from("x");
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  const decodedBase64UrlBytes = isolatedFunction(
    BACKFILL_PATH,
    "decodedBase64UrlBytes",
    { Buffer },
  );
  const aggregatePwmProtocolItem = isolatedFunction(
    BACKFILL_PATH,
    "aggregatePwmProtocolItem",
    {
      Buffer,
      INFINITY_BOND_KIND: "infinity-bond",
      INFINITY_BOND_MEMO: "powb",
      MAIL_ATTACHMENT_MAX_BYTES: 60_000,
      bondTagForMemo: (value) =>
        value === "powb" ? { kind: "infinity-bond" } : null,
      baseProtocolItem: (_tx, _message, kind) => ({
        amountSats: "546",
        kind,
        protocol: "pwm1",
        txid: "2".repeat(64),
      }),
      createHash,
      decodeBase64UrlText: (value) =>
        Buffer.from(String(value), "base64url").toString("utf8"),
      decodedBase64UrlBytes,
    },
  );
  const reply = aggregatePwmProtocolItem({}, [
    { prefix: "pwm1:", text: `pwm1:r:${"3".repeat(64)}`, voutIndex: 1 },
    { prefix: "pwm1:", text: "pwm1:m:reply", voutIndex: 2 },
  ]);
  const file = aggregatePwmProtocolItem({}, [
    {
      prefix: "pwm1:",
      text: `pwm1:a:dGV4dC9wbGFpbg:eC50eHQ:1:${sha256}:0/1:${bytes.toString("base64url")}`,
      voutIndex: 1,
    },
  ]);
  const bond = aggregatePwmProtocolItem({}, [
    { prefix: "pwm1:", text: "pwm1:m:po", voutIndex: 1 },
    { prefix: "pwm1:", text: "pwm1:m:wb", voutIndex: 2 },
  ]);
  assert.equal(reply.kind, "reply");
  assert.equal(file.kind, "file");
  assert.equal(file.attachment.sha256, sha256);
  assert.equal(bond.kind, "infinity-bond");
  assert.equal(bond.amountSats, "546");
});

check("canonical mail recipients become indexed participants", () => {
  const participantsForItem = isolatedFunction(
    BACKFILL_PATH,
    "participantsForItem",
  );
  const sender = "bc1sender";
  const recipient = "bc1recipient";
  const participants = participantsForItem({
    recipients: [{ address: recipient }],
    senderAddress: sender,
  });
  assert.ok(
    participants.some(
      (participant) =>
        participant.address === recipient && participant.role === "recipient",
    ),
  );
  assert.ok(
    participants.some(
      (participant) =>
        participant.address === sender && participant.role === "sender",
    ),
  );
});

check("wallet mail projection recognizes canonical senderAddress as sent activity", () => {
  const sender = "bc1psender";
  const recipient = "bc1precipient";
  const addressMailRowPayloads = isolatedFunction(
    READER_PATH,
    "addressMailRowPayloads",
    {
      canonicalEventPayload: (value) => value ?? {},
      dateIso: (value) => new Date(value).toISOString(),
      knownMailAddress: (value) => String(value ?? "").trim(),
      mailMemoFromEvent: (_row, payload) => String(payload?.memo ?? ""),
      mailParticipantRecordsFromRow: () => [
        { address: sender, role: "sender" },
        { address: recipient, role: "recipient" },
      ],
      mailParticipantsFromRow: () => [sender, recipient],
      mailSubjectFromEvent: () => "",
      normalizeEventPayload: (value) => value ?? {},
      normalizedAddress: (value) => String(value ?? "").trim(),
      normalizedAddressKey: (value) => String(value ?? "").trim().toLowerCase(),
      objectRecord: (value) =>
        value && typeof value === "object" && !Array.isArray(value) ? value : {},
      positiveNumber: (value) => Number(value) || 0,
      recipientRows: (addresses, amountSats) =>
        addresses.map((address) => ({ address, amountSats, display: address })),
      recipientSummary: (recipients) => recipients[0]?.display ?? "Unknown",
      rawTransactionItemPayload: () => ({}),
    },
  );

  const projected = addressMailRowPayloads(
    {
      event_time: "2026-07-11T00:00:00.000Z",
      kind: "mail",
      payload: {
        amountSats: 546,
        memo: "hello",
        recipients: [{ address: recipient }],
        senderAddress: sender,
      },
      status: "confirmed",
      txid: "a".repeat(64),
    },
    sender,
    "livenet",
  );

  assert.equal(projected.length, 1);
  assert.equal(projected[0].folder, "sent");
  assert.equal(projected[0].message.from, sender);
  assert.equal(projected[0].message.to, recipient);
});

check("unproven verifier holder snapshots cannot publish balances", async () => {
  let upserts = 0;
  const persistPreparedProtocolItems = isolatedFunction(
    BACKFILL_PATH,
    "persistPreparedProtocolItems",
    {
      BOND_TAGS: [],
      sourceLabelForProtocolItem: () => "token-transfers",
      CANONICAL_REBUILD: false,
      POWB_REGISTRY_ID: "infinity",
      seedCanonicalBondDefinition: async () => false,
      upsertEvent: async () => {
        upserts += 1;
        return { skipped: false };
      },
    },
  );
  const result = await persistPreparedProtocolItems(
    {
      async query() {
        assert.fail("holder snapshot attempted a database write");
      },
    },
    [
      {
        balanceSnapshot: {
          holders: [{ address: "bc1unproven", balance: 999 }],
          tokenId: "4".repeat(64),
        },
        item: { kind: "token-transfer", txid: "5".repeat(64) },
      },
    ],
  );
  assert.equal(upserts, 1);
  assert.equal(result.indexed, 1);
});

check("complete canonical token replay publishes conserved balances", async () => {
  const tokenId = "4".repeat(64);
  const writes = [];
  const rebuildConfirmedCreditBalancesFromCanonicalEvents = isolatedFunction(
    BACKFILL_PATH,
    "rebuildConfirmedCreditBalancesFromCanonicalEvents",
    { NETWORK: "livenet" },
  );
  const client = {
    async query(sql, params) {
      const text = String(sql);
      if (text.includes("FROM proof_indexer.credit_definitions")) {
        return { rows: [{ max_supply: "100", token_id: tokenId }] };
      }
      if (text.includes("FROM proof_indexer.events")) {
        return {
          rows: [
            {
              canonical_block_height: 101,
              event_id: 1,
              kind: "token-mint",
              payload: {
                _powEventIndex: 0,
                amount: 10,
                blockIndex: 0,
                minterAddress: "alice",
                tokenId,
              },
              txid: "1".repeat(64),
            },
            {
              canonical_block_height: 101,
              event_id: 2,
              kind: "token-transfer",
              payload: {
                _powEventIndex: 0,
                amount: 3,
                blockIndex: 1,
                recipientAddress: "bob",
                senderAddress: "alice",
                tokenId,
              },
              txid: "2".repeat(64),
            },
            {
              canonical_block_height: 101,
              event_id: 3,
              kind: "token-sale",
              payload: {
                _powEventIndex: 0,
                amount: 2,
                blockIndex: 2,
                buyerAddress: "carol",
                sellerAddress: "alice",
                tokenId,
              },
              txid: "3".repeat(64),
            },
          ].reverse(),
        };
      }
      if (text.includes("sum(confirmed_balance)")) {
        return { rows: [{ confirmed_supply: "10", token_id: tokenId }] };
      }
      writes.push({ params: Array.from(params ?? []), sql: text });
      return { rows: [] };
    },
  };
  const result = await rebuildConfirmedCreditBalancesFromCanonicalEvents(client);
  assert.deepEqual({ holders: result.holders, tokens: result.tokens }, { holders: 3, tokens: 1 });
  const inserts = writes.filter((write) =>
    write.sql.includes("INSERT INTO proof_indexer.credit_balances"),
  );
  assert.equal(writes.filter((write) => write.sql.includes("DELETE FROM")).length, 1);
  assert.deepEqual(
    inserts.map((write) => [write.params[2], write.params[3]]),
    [
      ["alice", "5"],
      ["bob", "3"],
      ["carol", "2"],
    ],
  );
});

check("negative canonical token replay fails before balance publication", async () => {
  const tokenId = "5".repeat(64);
  let destructiveWrites = 0;
  const rebuildConfirmedCreditBalancesFromCanonicalEvents = isolatedFunction(
    BACKFILL_PATH,
    "rebuildConfirmedCreditBalancesFromCanonicalEvents",
    { NETWORK: "livenet" },
  );
  const client = {
    async query(sql) {
      const text = String(sql);
      if (text.includes("FROM proof_indexer.credit_definitions")) {
        return { rows: [{ max_supply: "100", token_id: tokenId }] };
      }
      if (text.includes("FROM proof_indexer.events")) {
        return {
          rows: [
            {
              canonical_block_height: 101,
              event_id: 1,
              kind: "token-mint",
              payload: {
                _powEventIndex: 0,
                amount: 10,
                blockIndex: 0,
                minterAddress: "alice",
                tokenId,
              },
              txid: "1".repeat(64),
            },
            {
              canonical_block_height: 101,
              event_id: 2,
              kind: "token-transfer",
              payload: {
                _powEventIndex: 0,
                amount: 11,
                blockIndex: 1,
                recipientAddress: "bob",
                senderAddress: "alice",
                tokenId,
              },
              txid: "2".repeat(64),
            },
          ],
        };
      }
      if (text.includes("sum(confirmed_balance)")) {
        return { rows: [{ confirmed_supply: "10", token_id: tokenId }] };
      }
      destructiveWrites += 1;
      return { rows: [] };
    },
  };
  await rejection(
    rebuildConfirmedCreditBalancesFromCanonicalEvents(client),
    (error) => /negative/u.test(error.message),
    "An overspend must fail canonical replay",
  );
  assert.equal(destructiveWrites, 0);
});

check("canonical rebuild preparation requires an explicit supervised height", () => {
  const invalid = isolatedFunction(
    BACKFILL_PATH,
    "assertCanonicalRebuildConfiguration",
    {
      BLOCK_SCAN_FROM_HEIGHT: 0,
      CANONICAL_REBUILD: true,
      NETWORK: "livenet",
      PREPARE_CANONICAL_REBUILD_ONLY: true,
      PREPARE_CANONICAL_PWT_RANGE_REPLAY_ONLY: false,
      REPAIR_ID_TXIDS: [],
      REPAIR_ID_TXIDS_ONLY: false,
    },
  );
  assert.throws(invalid, /explicit positive/u);
  const valid = isolatedFunction(
    BACKFILL_PATH,
    "assertCanonicalRebuildConfiguration",
    {
      BLOCK_SCAN_FROM_HEIGHT: 100,
      CANONICAL_REBUILD: true,
      NETWORK: "livenet",
      PREPARE_CANONICAL_REBUILD_ONLY: true,
      PREPARE_CANONICAL_PWT_RANGE_REPLAY_ONLY: false,
      REPAIR_ID_TXIDS: [],
      REPAIR_ID_TXIDS_ONLY: false,
    },
  );
  assert.doesNotThrow(valid);
});

check("canonical rebuild reset and hashed bootstrap are one transaction", async () => {
  const calls = [];
  const bootstrapHash = "a".repeat(64);
  const prepareCanonicalRebuild = isolatedFunction(
    BACKFILL_PATH,
    "prepareCanonicalRebuild",
    {
      BLOCK_SCAN_FROM_HEIGHT: 100,
      CANONICAL_FAULT_META_KEY: "canonical:fault",
      CANONICAL_REBUILD: true,
      CANONICAL_REBUILD_META_KEY: "canonical:rebuild",
      NETWORK: "livenet",
      PREPARE_CANONICAL_REBUILD_ONLY: true,
      bitcoinRpc: async (method) =>
        method === "getblockhash" ? bootstrapHash : 120,
      isHexTxid: (value) => /^[0-9a-f]{64}$/u.test(String(value)),
      proofIndexerMetaValue: async () => null,
      seedCanonicalWorkDefinition: async () => calls.push("seed-work"),
      storeBlockScanSnapshot: async (_client, payload) =>
        calls.push({ snapshot: payload }),
      storeProofIndexerMeta: async (_client, key, value) =>
        calls.push({ key, meta: value }),
    },
  );
  const client = {
    async query(sql, params = []) {
      calls.push({ params: Array.from(params), sql: String(sql).trim() });
      return { rows: [] };
    },
  };
  const prepared = await prepareCanonicalRebuild(client);
  assert.equal(prepared.resumed, false);
  assert.equal(prepared.value.bootstrapHeight, 99);
  assert.equal(prepared.value.bootstrapHash, bootstrapHash);
  assert.equal(calls[0].sql, "BEGIN");
  assert.equal(calls.at(-1).sql, "COMMIT");
  const sql = calls.filter((call) => call.sql).map((call) => call.sql).join("\n");
  for (const table of [
    "proof_indexer.events",
    "proof_indexer.id_records",
    "proof_indexer.credit_balances",
    "proof_indexer.credit_listings",
    "proof_indexer.credit_definitions",
    "proof_indexer.mail_items",
    "proof_indexer.file_attachments",
    "proof_indexer.ledger_snapshots",
  ]) {
    assert.match(sql, new RegExp(table.replace(".", "\\."), "u"));
  }
  assert.doesNotMatch(
    sql,
    /DELETE FROM proof_indexer\.(?:tx_inputs|tx_outputs|op_returns)/u,
  );
  assert.match(sql, /UPDATE proof_indexer\.blocks[\s\S]*canonical = false/u);
  const eventDelete = calls.find((call) =>
    call.sql?.includes("DELETE FROM proof_indexer.events"),
  );
  assert.deepEqual(Array.from(eventDelete.params[1]), ["pwid1", "pwt1", "pwm1"]);
  assert.ok(calls.includes("seed-work"));
  assert.ok(
    calls.some(
      (call) => call.params?.[0] === "mempoolScan:livenet",
    ),
  );
  const snapshot = calls.find((call) => call.snapshot)?.snapshot;
  assert.equal(snapshot.complete, false);
  assert.equal(snapshot.indexedThroughBlock, 99);
  assert.equal(snapshot.indexedThroughBlockHash, bootstrapHash);
});

check("PWT range replay removes whole stale txs and resets projections", async () => {
  const calls = [];
  const canonicalBootstrapHash = "a".repeat(64);
  const rangeCheckpointHash = "b".repeat(64);
  const existingRebuild = {
    active: false,
    bootstrapHash: canonicalBootstrapHash,
    bootstrapHeight: 947999,
    complete: true,
    fromHeight: 948000,
    indexedThroughBlock: 957000,
    indexedThroughBlockHash: "c".repeat(64),
    network: "livenet",
    status: "complete",
  };
  const prepareCanonicalPwtRangeReplay = isolatedFunction(
    BACKFILL_PATH,
    "prepareCanonicalPwtRangeReplay",
    {
      BLOCK_SCAN_FROM_HEIGHT: 950200,
      CANONICAL_FAULT_META_KEY: "canonical:fault",
      CANONICAL_REBUILD_META_KEY: "canonical:rebuild",
      NETWORK: "livenet",
      PREPARE_CANONICAL_PWT_RANGE_REPLAY_ONLY: true,
      bitcoinRpc: async (method) =>
        method === "getblockhash" ? rangeCheckpointHash : 957000,
      isHexTxid: (value) => /^[0-9a-f]{64}$/u.test(String(value)),
      proofIndexerMetaValue: async () => existingRebuild,
      seedCanonicalBondDefinitions: async () => calls.push("seed-bonds"),
      seedCanonicalWorkDefinition: async () => calls.push("seed-work"),
      sourceLabelForProtocolItem: (item) =>
        item.kind === "token-create" ? "tokens" : "token-listings",
      storeBlockScanSnapshot: async (_client, payload) =>
        calls.push({ snapshot: payload }),
      storeProofIndexerMeta: async (_client, key, value) =>
        calls.push({ key, meta: value }),
      upsertProjection: async (_client, source, item) =>
        calls.push({ item, source }),
    },
  );
  const client = {
    async query(sql, params = []) {
      const normalizedSql = String(sql).trim();
      calls.push({ params: Array.from(params), sql: normalizedSql });
      if (normalizedSql.includes("AS first_height")) {
        return { rows: [{ first_height: 950246 }] };
      }
      if (normalizedSql.includes("AS first_false_height")) {
        return { rows: [{ first_false_height: null }] };
      }
      if (normalizedSql.includes("e.kind = 'token-create'")) {
        return {
          rows: [
            {
              payload: { kind: "token-create", tokenId: "d".repeat(64) },
              status: "confirmed",
            },
          ],
        };
      }
      if (
        normalizedSql.includes("SELECT e.payload, e.status") &&
        normalizedSql.includes("e.kind = ANY")
      ) {
        return {
          rows: [
            {
              payload: { kind: "token-listing", listingId: "e".repeat(64) },
              status: "confirmed",
            },
          ],
        };
      }
      return { rows: [] };
    },
  };
  const prepared = await prepareCanonicalPwtRangeReplay(client);
  assert.equal(prepared.resumed, false);
  assert.equal(prepared.value.fromHeight, 948000);
  assert.equal(prepared.value.bootstrapHeight, 947999);
  assert.equal(prepared.value.bootstrapHash, canonicalBootstrapHash);
  assert.equal(prepared.value.rangeReplayFromHeight, 950200);
  assert.equal(prepared.value.indexedThroughBlock, 950199);
  assert.equal(prepared.value.indexedThroughBlockHash, rangeCheckpointHash);
  assert.equal(calls[0].sql, "BEGIN");
  assert.equal(calls.at(-1).sql, "COMMIT");
  const sql = calls.filter((call) => call.sql).map((call) => call.sql).join("\n");
  assert.match(sql, /WITH replay_txids AS[\s\S]*DELETE FROM proof_indexer\.events/u);
  assert.match(sql, /DELETE FROM proof_indexer\.credit_balances/u);
  assert.match(sql, /DELETE FROM proof_indexer\.credit_listings/u);
  assert.match(sql, /DELETE FROM proof_indexer\.credit_definitions/u);
  assert.match(sql, /DELETE FROM proof_indexer\.ledger_snapshots/u);
  assert.doesNotMatch(sql, /DELETE FROM proof_indexer\.(?:id_records|mail_items)/u);
  assert.ok(calls.includes("seed-work"));
  assert.ok(calls.includes("seed-bonds"));
  assert.ok(calls.some((call) => call.source === "tokens"));
  assert.ok(calls.some((call) => call.source === "token-listings"));
});

check("completed canonical metadata advances through H+1 and H+2 catch-up", () => {
  const canonicalRebuildCheckpointValue = isolatedFunction(
    BACKFILL_PATH,
    "canonicalRebuildCheckpointValue",
  );
  const completedAtH = {
    active: false,
    bootstrapHash: "a".repeat(64),
    bootstrapHeight: 99,
    complete: true,
    fromHeight: 100,
    indexedThroughBlock: 110,
    indexedThroughBlockHash: "b".repeat(64),
    network: "livenet",
    status: "complete",
  };
  const atH1 = canonicalRebuildCheckpointValue(completedAtH, {
    blockHash: "c".repeat(64),
    complete: false,
    height: 111,
  });
  assert.equal(atH1.status, "active");
  assert.equal(atH1.indexedThroughBlock, 111);
  const atH2 = canonicalRebuildCheckpointValue(atH1, {
    blockHash: "d".repeat(64),
    complete: true,
    height: 112,
  });
  assert.equal(atH2.status, "complete");
  assert.equal(atH2.indexedThroughBlock, 112);
  assert.equal(atH2.indexedThroughBlockHash, "d".repeat(64));
});

check("canonical raw tx replaces legacy wrappers without entering event payloads", async () => {
  const txid = "b".repeat(64);
  let call;
  const persistCanonicalRawTransaction = isolatedFunction(
    BACKFILL_PATH,
    "persistCanonicalRawTransaction",
    {
      NETWORK: "livenet",
      isHexTxid: (value) => /^[0-9a-f]{64}$/u.test(String(value)),
      itemTime: () => null,
      numberOrNull: (value) =>
        Number.isFinite(Number(value)) ? Number(value) : null,
    },
  );
  await persistCanonicalRawTransaction(
    {
      async query(sql, params) {
        call = { params: Array.from(params), sql: String(sql) };
        return { rows: [] };
      },
    },
    {
      _powBlockIndex: 7,
      txid,
      vin: [{ prevout: { scriptPubKey: { address: "sender" }, value: 0.1 } }],
      vout: [{ scriptPubKey: { type: "nulldata" }, value: 0 }],
    },
    { blockHash: "c".repeat(64), blockTime: 1_700_000_000, height: 101 },
  );
  assert.match(call.sql, /raw_tx = EXCLUDED\.raw_tx/u);
  const raw = JSON.parse(call.params[9]);
  assert.equal(raw.canonicalBlockScan.height, 101);
  assert.equal(raw.canonicalBlockScan.network, "livenet");
  assert.equal(raw._powBlockIndex, 7);
  assert.equal(raw.item, undefined);
  assert.equal(raw.vin.length, 1);
  assert.equal(raw.vout.length, 1);
});

check("canonical block envelopes and protocol prevout values fail closed", () => {
  const hash = "d".repeat(64);
  const assertCanonicalBlockEnvelope = isolatedFunction(
    BACKFILL_PATH,
    "assertCanonicalBlockEnvelope",
    { isHexTxid: (value) => /^[0-9a-f]{64}$/u.test(String(value)) },
  );
  assert.doesNotThrow(() =>
    assertCanonicalBlockEnvelope(
      { hash, height: 101, nTx: 1, tx: [{ txid: "e".repeat(64) }] },
      101,
      hash,
    ),
  );
  assert.throws(
    () =>
      assertCanonicalBlockEnvelope(
        { hash, height: 101, nTx: 2, tx: [{ txid: "e".repeat(64) }] },
        101,
        hash,
      ),
    /invalid block envelope/u,
  );
  const assertHydratedProtocolTransaction = isolatedFunction(
    BACKFILL_PATH,
    "assertHydratedProtocolTransaction",
    { isHexTxid: (value) => /^[0-9a-f]{64}$/u.test(String(value)) },
  );
  assert.doesNotThrow(() =>
    assertHydratedProtocolTransaction({
      txid: "f".repeat(64),
      vin: [
        {
          prevout: {
            scriptPubKey: { address: "sender", hex: "51" },
            valueSats: 1_000,
          },
          txid: "1".repeat(64),
          vout: 0,
        },
      ],
    }),
  );
  assert.throws(
    () =>
      assertHydratedProtocolTransaction({
        txid: "f".repeat(64),
        vin: [{ txid: "1".repeat(64), vout: 0 }],
      }),
    /no complete canonical prevout/u,
  );
  assert.doesNotThrow(() =>
    assertHydratedProtocolTransaction({
      txid: "f".repeat(64),
      vin: [
        {
          prevout: {
            scriptPubKey: { hex: "51", type: "multisig" },
            valueSats: 1_000,
          },
          txid: "1".repeat(64),
          vout: 0,
        },
      ],
    }),
  );
  assert.throws(
    () =>
      assertHydratedProtocolTransaction({
        txid: "f".repeat(64),
        vin: [
          {
            prevout: { scriptPubKey: {}, valueSats: 1_000 },
            txid: "1".repeat(64),
            vout: 0,
          },
        ],
      }),
    /no complete canonical prevout/u,
  );
});

check("Core prevout hydration is deduplicated and concurrency bounded", async () => {
  const boundedMapWithConcurrency = isolatedFunction(
    BACKFILL_PATH,
    "boundedMapWithConcurrency",
  );
  const prevoutFromOutput = isolatedFunction(
    BACKFILL_PATH,
    "prevoutFromOutput",
    {
      satsFromVoutValue: (value) =>
        BigInt(Math.round(Number(value) * 100_000_000)),
    },
  );
  let active = 0;
  let maxActive = 0;
  let reads = 0;
  const transactionWithInputPrevouts = isolatedFunction(
    BACKFILL_PATH,
    "transactionWithInputPrevouts",
    {
      PREVOUT_HYDRATION_CONCURRENCY: 3,
      boundedMapWithConcurrency,
      isHexTxid: (value) => /^[0-9a-f]{64}$/u.test(String(value)),
      prevoutFromOutput,
      rawTransactionFromCore: async () => {
        active += 1;
        reads += 1;
        maxActive = Math.max(maxActive, active);
        await new Promise((resolve) => setTimeout(resolve, 2));
        active -= 1;
        return {
          vout: [{ scriptPubKey: { hex: "51", type: "pubkey" }, value: 0.00001 }],
        };
      },
    },
  );
  const repeatedTxid = "a".repeat(64);
  const uniqueTxids = Array.from({ length: 11 }, (_, index) =>
    index.toString(16).padStart(64, "0"),
  );
  const hydrated = await transactionWithInputPrevouts({
    txid: "b".repeat(64),
    vin: [repeatedTxid, repeatedTxid, ...uniqueTxids].map((txid) => ({
      txid,
      vout: 0,
    })),
  });
  assert.equal(reads, 12);
  assert.ok(maxActive <= 3, `observed ${maxActive} concurrent Core reads`);
  assert.ok(hydrated.vin.every((input) => input.prevout?.valueSats === 1_000));
});

check("canonical API hydration propagates Core uncertainty but accepts addressless scripts", async () => {
  const txid = "c".repeat(64);
  const previousTxid = "d".repeat(64);
  const blockHash = "e".repeat(64);
  let previousAvailable = false;
  const mapWithConcurrency = isolatedFunction(API_PATH, "mapWithConcurrency");
  const transactionInputsHavePrevouts = isolatedFunction(
    API_PATH,
    "transactionInputsHavePrevouts",
  );
  const transactionHasCompleteCanonicalPrevouts = isolatedFunction(
    API_PATH,
    "transactionHasCompleteCanonicalPrevouts",
  );
  const fetchTransactionFromBitcoinRpc = isolatedFunction(
    API_PATH,
    "fetchTransactionFromBitcoinRpc",
    {
      MAX_TRANSACTION_CACHE_SIZE: 100,
      TRANSACTION_CACHE: new Map(),
      TX_FETCH_CONCURRENCY: 4,
      bitcoinRpc: async (_method, [requestedTxid]) => {
        if (requestedTxid === previousTxid && !previousAvailable) {
          return { error: { code: -28 }, ok: false };
        }
        if (requestedTxid === previousTxid) {
          return {
            ok: true,
            result: {
              blockhash: "f".repeat(64),
              confirmations: 10,
              height: 90,
              txid: previousTxid,
              vin: [{ coinbase: "00", sequence: 0 }],
              vout: [
                {
                  scriptPubKey: { asm: "1", hex: "51", type: "pubkey" },
                  value: 0.00002,
                },
              ],
            },
          };
        }
        return {
          ok: true,
          result: {
            blockhash: blockHash,
            confirmations: 1,
            height: 101,
            txid,
            vin: [{ sequence: 1, txid: previousTxid, vout: 0 }],
            vout: [
              {
                scriptPubKey: { asm: "OP_RETURN", hex: "6a", type: "nulldata" },
                value: 0,
              },
            ],
          },
        };
      },
      coreVoutToMempoolVout: (output) => ({
        scriptpubkey: String(output?.scriptPubKey?.hex ?? ""),
        scriptpubkey_address: String(output?.scriptPubKey?.address ?? ""),
        scriptpubkey_asm: String(output?.scriptPubKey?.asm ?? ""),
        scriptpubkey_type: String(output?.scriptPubKey?.type ?? ""),
        value: Math.round(Number(output?.value ?? 0) * 100_000_000),
      }),
      errorSummary: (error) => String(error?.message ?? error?.code ?? error),
      mapWithConcurrency,
      transactionHasCompleteCanonicalPrevouts,
      transactionInputsHavePrevouts,
    },
  );
  await rejection(
    fetchTransactionFromBitcoinRpc(txid, "livenet", {
      requireCanonicalPrevouts: true,
    }),
    (error) => /could not resolve canonical transaction/u.test(error.message),
    "A transient prevout RPC failure must abort canonical verification",
  );
  previousAvailable = true;
  const hydrated = await fetchTransactionFromBitcoinRpc(txid, "livenet", {
    requireCanonicalPrevouts: true,
  });
  assert.equal(hydrated.vin[0].prevout.value, 2_000);
  assert.equal(hydrated.vin[0].prevout.scriptpubkey, "51");
  assert.equal(hydrated.vin[0].prevout.scriptpubkey_address, "");
});

check("unknown aggregated PWM emits one invalid audit event", () => {
  const invalidProtocolItem = isolatedFunction(
    BACKFILL_PATH,
    "invalidProtocolItem",
  );
  const rawProtocolItemsForTx = isolatedFunction(
    BACKFILL_PATH,
    "rawProtocolItemsForTx",
    {
      Buffer,
      aggregatePwmProtocolItem: () => null,
      baseProtocolItem: (_tx, _message, kind) => ({
        amountSats: "546",
        kind,
        protocol: "pwm1",
        txid: "1".repeat(64),
      }),
      canonicalBondMintItemsFromMailItem: () => [],
      invalidProtocolItem,
      protocolItemsFromTx: () => [],
    },
  );
  const items = rawProtocolItemsForTx({}, [
    { prefix: "pwm1:", text: "pwm1:unknown:data", voutIndex: 1 },
    { prefix: "pwm1:", text: "pwm1:also-unknown", voutIndex: 2 },
  ]);
  assert.equal(items.length, 1);
  assert.equal(items[0].valid, false);
  assert.equal(items[0].kind, "mail-invalid");
  assert.match(items[0].reason, /Malformed or unknown aggregated PWM/u);
});

check("bond companions mint each family recipient without double-counting value", () => {
  const powbTokenId = "a".repeat(64);
  const incbTokenId = "b".repeat(64);
  const canonicalBondMintItemsFromMailItem = isolatedFunction(
    BACKFILL_PATH,
    "canonicalBondMintItemsFromMailItem",
    {
      bondTagForKind: (kind) =>
        kind === "infinity-bond"
          ? { ticker: "POWB", tokenId: powbTokenId }
          : kind === "inception-bond"
            ? { ticker: "INCB", tokenId: incbTokenId }
            : null,
    },
  );
  const disambiguateDuplicateProtocolItems = isolatedFunction(
    BACKFILL_PATH,
    "disambiguateDuplicateProtocolItems",
  );
  const mints = disambiguateDuplicateProtocolItems(
    canonicalBondMintItemsFromMailItem({
      amountSats: "1000",
      blockHeight: 101,
      blockIndex: 3,
      confirmed: true,
      kind: "infinity-bond",
      network: "livenet",
      recipients: [
        { address: "alice", amountSats: "600" },
        { address: "bob", amountSats: "400" },
      ],
      txid: "2".repeat(64),
    }),
  );
  assert.deepEqual(
    mints.map((mint) => [mint.minterAddress, mint.amount, mint.amountSats]),
    [
      ["alice", "600", 0],
      ["bob", "400", 0],
    ],
  );
  assert.equal(mints[0].eventKeyVout, undefined);
  assert.equal(mints[1].eventKeyVout, 1);
  assert.deepEqual(mints.map((mint) => mint._powEventIndex), [0, 1]);
  const [incbMint] = canonicalBondMintItemsFromMailItem({
    confirmed: true,
    kind: "inception-bond",
    recipients: [{ address: "carol", amountSats: "250" }],
    txid: "3".repeat(64),
  });
  assert.equal(incbMint.ticker, "INCB");
  assert.equal(incbMint.tokenId, incbTokenId);
  assert.equal(incbMint.amountSats, 0);
});

check("bond definitions bind to their canonical ID receivers", async () => {
  let definition;
  const seedCanonicalBondDefinition = isolatedFunction(
    BACKFILL_PATH,
    "seedCanonicalBondDefinition",
    {
      NETWORK: "livenet",
      upsertCanonicalSyntheticCreditDefinition: async (_client, value) => {
        definition = value;
      },
    },
  );
  const infinityTag = {
    createdAt: "2026-06-23T00:00:00.000Z",
    registryId: "infinity",
    ticker: "POWB",
    tokenId: "a".repeat(64),
    tokenMaxSupply: Number.MAX_SAFE_INTEGER,
  };
  await seedCanonicalBondDefinition(
    {
      async query() {
        return {
          rows: [{ owner_address: "owner", receive_address: "bond-receiver" }],
        };
      },
    },
    infinityTag,
    { required: true },
  );
  assert.equal(definition.registryAddress, "bond-receiver");
  assert.equal(definition.ticker, "POWB");

  await rejection(
    seedCanonicalBondDefinition(
      { async query() { return { rows: [] }; } },
      infinityTag,
      { required: true },
    ),
    (error) => /confirmed infinity ID receiver/u.test(error.message),
  );
});

check("POWB bond mints rebuild holder supply before dependent transfers", async () => {
  const tokenId = "a".repeat(64);
  const writes = [];
  const rebuildConfirmedCreditBalancesFromCanonicalEvents = isolatedFunction(
    BACKFILL_PATH,
    "rebuildConfirmedCreditBalancesFromCanonicalEvents",
    { NETWORK: "livenet" },
  );
  const result = await rebuildConfirmedCreditBalancesFromCanonicalEvents({
    async query(sql, params = []) {
      const text = String(sql);
      if (text.includes("FROM proof_indexer.credit_definitions")) {
        return {
          rows: [{ max_supply: String(Number.MAX_SAFE_INTEGER), token_id: tokenId }],
        };
      }
      if (text.includes("FROM proof_indexer.events")) {
        return {
          // Deliberately returned in insertion-hostile order; canonical block
          // and event positions must place both bond mints before the spend.
          rows: [
            {
              canonical_block_height: 102,
              event_key: "transfer",
              kind: "token-transfer",
              payload: {
                _powEventIndex: 0,
                amount: 100,
                blockIndex: 0,
                recipientAddress: "carol",
                senderAddress: "alice",
                tokenId,
              },
              txid: "3".repeat(64),
            },
            {
              canonical_block_height: 101,
              event_key: "mint-bob",
              kind: "token-mint",
              payload: {
                _powEventIndex: 1,
                amount: 400,
                blockIndex: 0,
                minterAddress: "bob",
                tokenId,
              },
              txid: "2".repeat(64),
            },
            {
              canonical_block_height: 101,
              event_key: "mint-alice",
              kind: "token-mint",
              payload: {
                _powEventIndex: 0,
                amount: 600,
                blockIndex: 0,
                minterAddress: "alice",
                tokenId,
              },
              txid: "2".repeat(64),
            },
          ],
        };
      }
      if (text.includes("sum(confirmed_balance)")) {
        return { rows: [] };
      }
      writes.push({ params: Array.from(params), sql: text });
      return { rows: [] };
    },
  });
  assert.equal(result.tokens, 1);
  const balances = new Map(
    writes
      .filter((write) => write.sql.includes("INSERT INTO proof_indexer.credit_balances"))
      .map((write) => [write.params[2], write.params[3]]),
  );
  assert.deepEqual(Object.fromEntries(balances), {
    alice: "500",
    bob: "400",
    carol: "100",
  });
});

check("canonical Core raw transactions normalize dependent replay inputs", () => {
  const canonicalCoreScriptType = isolatedFunction(
    READER_PATH,
    "canonicalCoreScriptType",
  );
  const canonicalCoreValueSats = isolatedFunction(
    READER_PATH,
    "canonicalCoreValueSats",
  );
  const objectRecord = (value) =>
    value && typeof value === "object" && !Array.isArray(value) ? value : {};
  const canonicalCoreOutput = isolatedFunction(
    READER_PATH,
    "canonicalCoreOutput",
    { canonicalCoreScriptType, canonicalCoreValueSats, objectRecord },
  );
  const canonicalRawTransactionFromRow = isolatedFunction(
    READER_PATH,
    "canonicalRawTransactionFromRow",
    {
      canonicalCoreOutput,
      canonicalCoreValueSats,
      objectRecord,
      rowNumber: (row, key) => Number(row?.[key] ?? 0),
    },
  );
  const blockHash = "3".repeat(64);
  const txid = "4".repeat(64);
  const normalized = canonicalRawTransactionFromRow(
    {
      block_hash: blockHash,
      block_height: 101,
      block_time: "2026-07-11T00:00:00.000Z",
      raw_tx: {
        _powBlockIndex: 2,
        canonicalBlockScan: { blockHash, height: 101, network: "livenet" },
        fee: 0.000001,
        locktime: 0,
        txid,
        version: 2,
        vin: [
          {
            prevout: {
              scriptPubKey: {
                address: "sender",
                asm: "1",
                hex: "51",
                type: "witness_v1_taproot",
              },
              value: 0.00002,
            },
            sequence: 1,
            txid: "5".repeat(64),
            vout: 0,
          },
        ],
        vout: [
          {
            scriptPubKey: { asm: "OP_RETURN", hex: "6a", type: "nulldata" },
            value: 0.00001,
          },
        ],
        weight: 400,
      },
      txid,
    },
    "livenet",
  );
  assert.equal(normalized._powBlockIndex, 2);
  assert.equal(normalized.vin[0].prevout.value, 2_000);
  assert.equal(normalized.vin[0].prevout.scriptpubkey_address, "sender");
  assert.equal(normalized.vin[0].prevout.scriptpubkey_type, "v1_p2tr");
  assert.equal(normalized.vout[0].value, 1_000);
  assert.equal(normalized.vout[0].scriptpubkey_type, "op_return");
  assert.equal(normalized.fee, 100);
  assert.equal(normalized.status.block_height, 101);
});

check("confirmed token scope distinguishes resolved invalid and ambiguous evidence", async () => {
  const listingId = "a".repeat(64);
  const tokenId = "b".repeat(64);
  const buyTxid = "c".repeat(64);
  const delistTxid = "d".repeat(64);
  const unresolvedTxid = "e".repeat(64);
  const malformedTxid = "1".repeat(64);
  const mixedTxid = "2".repeat(64);
  const ambiguousListingId = "3".repeat(64);
  const ambiguousTxid = "4".repeat(64);
  const otherTokenId = "5".repeat(64);
  const blockHash = "6".repeat(64);
  const confirmedTokenVerifierScopeFromContext = isolatedFunction(
    API_PATH,
    "confirmedTokenVerifierScopeFromContext",
    {
      TOKEN_PROTOCOL_PREFIX: "pwt1:",
      canonicalTokenListingScopeEvidenceFromCore: async () => ({
        reason: "referenced-listing-does-not-exist",
        status: "deterministically-invalid",
      }),
      decodedProtocolMessages: (vout) => vout.map((output) => output.message),
      parseTokenPayload: (message) => message,
      transactionBlockHash: (tx) => tx.status?.block_hash ?? "",
      transactionBlockHeight: (tx) => tx.status?.block_height,
      transactionTxid: (tx) => tx.txid,
    },
  );
  const currentBlock = (tx) => ({
    ...tx,
    status: { block_hash: blockHash, block_height: 101, confirmed: true },
  });
  const context = {
    blockHash,
    coverageHeight: 101,
    transactions: [
      {
        txid: listingId,
        vout: [
          {
            message: {
              kind: "list",
              saleAuthorization: {
                registryAddress: "bc1registry",
                tokenId,
              },
            },
          },
        ],
      },
      currentBlock({
        txid: buyTxid,
        vout: [{ message: { kind: "buy", listingId } }],
      }),
      currentBlock({
        txid: delistTxid,
        vout: [{ message: { kind: "delist", listingId } }],
      }),
      currentBlock({
        txid: unresolvedTxid,
        vout: [
          {
            message: {
              kind: "buy",
              listingId: "f".repeat(64),
            },
          },
        ],
      }),
      currentBlock({
        txid: malformedTxid,
        vout: [{ message: null }],
      }),
      currentBlock({
        txid: mixedTxid,
        vout: [
          { message: null },
          { message: { kind: "send", tokenId } },
        ],
      }),
      {
        txid: ambiguousListingId,
        vout: [
          {
            message: {
              kind: "list",
              saleAuthorization: { tokenId },
            },
          },
          {
            message: {
              kind: "list",
              saleAuthorization: { tokenId: otherTokenId },
            },
          },
        ],
      },
      currentBlock({
        txid: ambiguousTxid,
        vout: [{ message: { kind: "buy", listingId: ambiguousListingId } }],
      }),
    ],
  };
  const buy = await confirmedTokenVerifierScopeFromContext(
    context,
    "livenet",
    buyTxid,
  );
  assert.equal(buy.scope, tokenId);
  assert.equal(buy.status, "resolved");
  const delist = await confirmedTokenVerifierScopeFromContext(
    context,
    "livenet",
    delistTxid,
  );
  assert.equal(delist.scope, tokenId);
  assert.equal(delist.status, "resolved");
  const invalid = await confirmedTokenVerifierScopeFromContext(
    context,
    "livenet",
    unresolvedTxid,
  );
  assert.equal(invalid.reason, "referenced-listing-is-not-canonical");
  assert.equal(invalid.status, "deterministically-invalid");
  const malformed = await confirmedTokenVerifierScopeFromContext(
    context,
    "livenet",
    malformedTxid,
  );
  assert.equal(malformed.status, "deterministically-invalid");
  const mixed = await confirmedTokenVerifierScopeFromContext(
    context,
    "livenet",
    mixedTxid,
  );
  assert.equal(mixed.scope, tokenId);
  assert.equal(mixed.status, "resolved");
  const ambiguous = await confirmedTokenVerifierScopeFromContext(
    context,
    "livenet",
    ambiguousTxid,
  );
  assert.equal(ambiguous.reason, "ambiguous-token-scope");
  assert.equal(ambiguous.status, "unresolved");
});

check("a canonical listing missing from DB context is unavailable, not invalid", async () => {
  const listingId = "7".repeat(64);
  const tokenId = "8".repeat(64);
  const listingBlockHash = "9".repeat(64);
  let mode = "canonical";
  const canonicalTokenListingScopeEvidenceFromCore = isolatedFunction(
    API_PATH,
    "canonicalTokenListingScopeEvidenceFromCore",
    {
      TOKEN_PROTOCOL_PREFIX: "pwt1:",
      bitcoinRpc: async (method) => {
        if (method === "getrawtransaction") {
          return mode === "missing"
            ? { error: { code: -5 }, ok: false }
            : {
                ok: true,
                result: {
                  blockhash: listingBlockHash,
                  confirmations: 2,
                  vout: [{ message: { kind: "list", saleAuthorization: { tokenId } } }],
                },
              };
        }
        if (method === "getblockheader") {
          return { ok: true, result: { height: 100 } };
        }
        if (method === "getblockhash") {
          return { ok: true, result: listingBlockHash };
        }
        throw new Error(`unexpected method ${method}`);
      },
      coreVoutToMempoolVout: (output) => output,
      decodedProtocolMessages: (vout) => vout.map((output) => output.message),
      parseTokenPayload: (message) => message,
    },
  );
  const unresolved = await canonicalTokenListingScopeEvidenceFromCore(
    { coverageHeight: 101 },
    "livenet",
    listingId,
  );
  assert.equal(unresolved.status, "unresolved");
  assert.equal(
    unresolved.reason,
    "canonical-listing-is-missing-from-index-context",
  );

  mode = "missing";
  const invalid = await canonicalTokenListingScopeEvidenceFromCore(
    { coverageHeight: 101 },
    "livenet",
    listingId,
  );
  assert.equal(invalid.status, "deterministically-invalid");
  assert.equal(invalid.reason, "referenced-listing-does-not-exist");
});

check("same-height verifier contexts are cached by exact block identity", async () => {
  const previousBlockHash = "a".repeat(64);
  const firstBlockHash = "b".repeat(64);
  const replacementBlockHash = "c".repeat(64);
  const keys = [];
  const loads = [];
  const canonicalVerifierContextFromCheckpoint = isolatedFunction(
    API_PATH,
    "canonicalVerifierContextFromCheckpoint",
    {
      cachedInternalVerifierState: async (key, loader) => {
        keys.push(key);
        return loader();
      },
      loadCanonicalVerifierContextFromCheckpoint: async (...args) => {
        loads.push(args);
        return { blockHash: args[2], coverageHeight: args[1] };
      },
      pruneInternalVerifierStateCache: () => {},
    },
  );
  await canonicalVerifierContextFromCheckpoint(
    "livenet",
    101,
    firstBlockHash,
    previousBlockHash,
  );
  await canonicalVerifierContextFromCheckpoint(
    "livenet",
    101,
    replacementBlockHash,
    previousBlockHash,
  );
  assert.equal(loads.length, 2);
  assert.notEqual(keys[0], keys[1]);
  assert.ok(keys[0].includes(firstBlockHash));
  assert.ok(keys[1].includes(replacementBlockHash));
});

check("canonical verifier rejects a replaced block before state hydration", async () => {
  const expectedBlockHash = "d".repeat(64);
  const replacementBlockHash = "e".repeat(64);
  let calls = 0;
  const canonicalVerifierCurrentBlock = isolatedFunction(
    API_PATH,
    "canonicalVerifierCurrentBlock",
    {
      bitcoinRpc: async (method) => {
        calls += 1;
        assert.equal(method, "getblockhash");
        return { ok: true, result: replacementBlockHash };
      },
    },
  );
  await rejection(
    canonicalVerifierCurrentBlock(
      "livenet",
      101,
      "f".repeat(64),
      expectedBlockHash,
    ),
    (error) => /does not match the requested canonical hash/u.test(error.message),
    "A same-height replacement must not reuse or hydrate the old block",
  );
  assert.equal(calls, 1);
});

check("confirmed unscoped token verifier caches by target txid", async () => {
  const firstTxid = "1".repeat(64);
  const secondTxid = "2".repeat(64);
  const tokenId = "3".repeat(64);
  const blockHash = "4".repeat(64);
  const previousBlockHash = "5".repeat(64);
  const cacheKeys = [];
  const confirmedLoads = [];
  const tokenVerifierPayload = isolatedFunction(
    API_PATH,
    "tokenVerifierPayload",
    {
      INTERNAL_VERIFIER_STATE_CACHE: new Map(),
      WORK_TOKEN_ID: "work",
      cachedInternalVerifierState: async (key, loader) => {
        cacheKeys.push(key);
        return loader();
      },
      completeTokenVerifierState: async (...args) => {
        confirmedLoads.push(args);
        return {
          blockHash,
          canonicalCoverage: true,
          coverageHeight: 101,
          indexedThroughBlock: 101,
          previousBlockHash,
        };
      },
      normalizeTokenScope: (scope) => String(scope).toLowerCase(),
      pruneInternalVerifierStateCache: () => {},
      tokenPayload: async () => ({
        indexedThroughBlock: 100,
        pendingFixture: true,
      }),
      tokenVerifierDeterministicInvalidReason: async () => "",
      tokenVerifierItemsFromState: (state, txid) => [
        {
          blockHeight: 101,
          confirmed: !state.pendingFixture,
          kind: state.pendingFixture ? "token-event-invalid" : "token-sale",
          tokenId,
          txid,
          valid: !state.pendingFixture,
        },
      ],
      verifierBalanceSnapshot: () => null,
      workTokenPayload: async () => ({}),
    },
  );
  for (const txid of [firstTxid, secondTxid]) {
    await tokenVerifierPayload("livenet", "all", txid, {
      blockHash,
      blockHeight: 101,
      previousBlockHash,
      requireConfirmed: true,
    });
  }
  await tokenVerifierPayload("livenet", "all", firstTxid);

  assert.deepEqual(
    confirmedLoads.map((args) => args[3]),
    [firstTxid, secondTxid],
  );
  assert.ok(
    cacheKeys.includes(
      `token-complete:livenet:tx:${firstTxid}:h101:${previousBlockHash}:${blockHash}`,
    ),
  );
  assert.ok(
    cacheKeys.includes(
      `token-complete:livenet:tx:${secondTxid}:h101:${previousBlockHash}:${blockHash}`,
    ),
  );
  assert.ok(cacheKeys.includes("token:livenet:all"));
});

check("a stale token verifier absence remains unresolved", async () => {
  const txid = "7".repeat(64);
  const blockHash = "a".repeat(64);
  const previousBlockHash = "b".repeat(64);
  const tokenVerifierPayload = isolatedFunction(
    API_PATH,
    "tokenVerifierPayload",
    {
      INTERNAL_VERIFIER_STATE_CACHE: new Map(),
      POWB_TOKEN_ID: "powb",
      WORK_TOKEN_ID: "work",
      cachedInternalVerifierState: async () => ({
        blockHash,
        coverageHeight: 101,
        indexedAt: "2026-07-03T00:00:00.000Z",
        indexedThroughBlock: 100,
        previousBlockHash,
      }),
      completeTokenVerifierState: async () => ({ coverageHeight: 101 }),
      normalizeTokenScope: (scope) => String(scope).toLowerCase(),
      pruneInternalVerifierStateCache: () => {},
      tokenPayload: async () => ({}),
      tokenVerifierDeterministicInvalidReason: async () => "",
      tokenVerifierItemsFromState: () => [],
      verifierBalanceSnapshot: () => null,
      workTokenPayload: async () => ({}),
    },
  );
  await rejection(
    tokenVerifierPayload("livenet", "work", txid, {
      blockHash,
      blockHeight: 101,
      previousBlockHash,
      requireConfirmed: true,
    }),
    (error) =>
      error.statusCode === 503 && error.details?.code === "TOKEN_VERIFIER_UNRESOLVED",
    "Stale absence must not be converted into an invalid token event",
  );
});

check("a stale ID verifier absence remains unresolved", async () => {
  const txid = "8".repeat(64);
  const blockHash = "c".repeat(64);
  const previousBlockHash = "d".repeat(64);
  const idVerifierPayload = isolatedFunction(API_PATH, "idVerifierPayload", {
    INTERNAL_VERIFIER_STATE_CACHE: new Map(),
    cachedInternalVerifierState: async () => ({
      blockHash,
      coverageHeight: 101,
      previousBlockHash,
      state: { activity: [], sales: [] },
      transactions: [{ confirmed: true, height: 101, txid }],
    }),
    completeIdVerifierStateBundle: async () => ({ coverageHeight: 101 }),
    fetchTransactionFromBitcoinRpc: async () => ({
      confirmed: true,
      height: 101,
      txid,
    }),
    idVerifierDeterministicInvalidReason: async () => "",
    idVerifierItemsFromState: () => [],
    indexedThroughBlockFromTransactions: () => 101,
    pruneInternalVerifierStateCache: () => {},
    transactionBlockHeight: (tx) => tx.height,
    transactionConfirmed: (tx) => tx.confirmed === true,
    transactionTxid: (tx) => tx.txid,
  });
  await rejection(
    idVerifierPayload("livenet", txid, {
      blockHash,
      blockHeight: 101,
      previousBlockHash,
      requireConfirmed: true,
    }),
    (error) =>
      error.statusCode === 503 && error.details?.code === "ID_VERIFIER_UNRESOLVED",
    "Stale absence must not be converted into a synthetic invalid ID event",
  );
});

check("confirmed verifiers ignore a same-txid copy from the wrong block", async () => {
  const requiredBlockHeight = 101;
  const wrongBlockHeight = 100;
  const tokenTxid = "6".repeat(64);
  const idTxid = "5".repeat(64);
  const blockHash = "4".repeat(64);
  const previousBlockHash = "3".repeat(64);
  let decodedWrongBlockTransactions = 0;
  let rpcReads = 0;
  const wrongBlockTransaction = (txid) => ({
    confirmed: true,
    height: wrongBlockHeight,
    txid,
    // Deliberately malformed and fee-less. Confirmed invalidity may only be
    // decided from the exact transaction in the requested canonical block.
    vout: [{ scriptpubkey_type: "op_return", scriptpubkey: "6a01ff" }],
  });
  const transactionTxid = (tx) => String(tx?.txid ?? "").toLowerCase();
  const transactionBlockHeight = (tx) => Number(tx?.height ?? 0);
  const transactionConfirmed = (tx) => tx?.confirmed === true;
  const decodedProtocolMessages = () => {
    decodedWrongBlockTransactions += 1;
    return ["malformed"];
  };
  const fetchTransactionFromBitcoinRpc = async () => {
    rpcReads += 1;
    return wrongBlockTransaction(tokenTxid);
  };

  const tokenVerifierDeterministicInvalidReason = isolatedFunction(
    API_PATH,
    "tokenVerifierDeterministicInvalidReason",
    {
      decodedProtocolMessages,
      fetchTransactionFromBitcoinRpc,
      transactionBlockHeight,
      transactionConfirmed,
      transactionTxid,
    },
  );
  const tokenState = {
    blockHash,
    canonicalCoverage: true,
    coverageHeight: requiredBlockHeight,
    indexedThroughBlock: requiredBlockHeight,
    previousBlockHash,
    transactions: [wrongBlockTransaction(tokenTxid)],
  };
  const tokenVerifierPayload = isolatedFunction(
    API_PATH,
    "tokenVerifierPayload",
    {
      INTERNAL_VERIFIER_STATE_CACHE: new Map(),
      cachedInternalVerifierState: async (_key, loader) => loader(),
      completeTokenVerifierState: async () => tokenState,
      decodedProtocolMessages,
      normalizeTokenScope: (scope) => String(scope).toLowerCase(),
      pruneInternalVerifierStateCache: () => {},
      tokenVerifierDeterministicInvalidReason,
      tokenVerifierItemsFromState: () => [],
      transactionBlockHeight,
      transactionTxid,
    },
  );
  await rejection(
    tokenVerifierPayload("livenet", "work", tokenTxid, {
      blockHash,
      blockHeight: requiredBlockHeight,
      previousBlockHash,
      requireConfirmed: true,
    }),
    (error) =>
      error.statusCode === 503 &&
      error.details?.code === "TOKEN_VERIFIER_UNRESOLVED",
    "A token transaction from the wrong block became deterministic invalidity",
  );

  const idVerifierDeterministicInvalidReason = isolatedFunction(
    API_PATH,
    "idVerifierDeterministicInvalidReason",
    {
      decodedProtocolMessages,
      fetchTransactionFromBitcoinRpc,
      transactionBlockHeight,
      transactionConfirmed,
      transactionTxid,
    },
  );
  const idBundle = {
    blockHash,
    canonicalCoverage: true,
    coverageHeight: requiredBlockHeight,
    state: { activity: [], sales: [] },
    previousBlockHash,
    transactions: [wrongBlockTransaction(idTxid)],
  };
  const idVerifierPayload = isolatedFunction(API_PATH, "idVerifierPayload", {
    INTERNAL_VERIFIER_STATE_CACHE: new Map(),
    cachedInternalVerifierState: async (_key, loader) => loader(),
    completeIdVerifierStateBundle: async () => idBundle,
    decodedProtocolMessages,
    idVerifierDeterministicInvalidReason,
    idVerifierItemsFromState: () => [],
    pruneInternalVerifierStateCache: () => {},
    transactionBlockHeight,
    transactionTxid,
  });
  await rejection(
    idVerifierPayload("livenet", idTxid, {
      blockHash,
      blockHeight: requiredBlockHeight,
      previousBlockHash,
      requireConfirmed: true,
    }),
    (error) =>
      error.statusCode === 503 &&
      error.details?.code === "ID_VERIFIER_UNRESOLVED",
    "An ID transaction from the wrong block became deterministic invalidity",
  );
  assert.equal(decodedWrongBlockTransactions, 0);
  assert.equal(rpcReads, 0);
});

check("canonical buy recovery counts price and one registry close only", async () => {
  const txid = "b".repeat(64);
  const listingId = "c".repeat(64);
  const tokenId = "d".repeat(64);
  const priceSats = 12_000;
  const anchorRefundSats = 330;
  const paidSats = priceSats + 546 + anchorRefundSats;
  const blockHash = "e".repeat(64);
  const previousBlockHash = "f".repeat(64);
  const canonicalRecoveryItemsForTx = isolatedFunction(
    BACKFILL_PATH,
    "canonicalRecoveryItemsForTx",
    {
      NETWORK: "livenet",
      PENDING_VERIFIER_TIMEOUT_MS: 5_000,
      canonicalKindForSourceLabel: isolatedFunction(
        BACKFILL_PATH,
        "canonicalKindForSourceLabel",
      ),
      canonicalRecoveryItemMatchesTxid: isolatedFunction(
        BACKFILL_PATH,
        "canonicalRecoveryItemMatchesTxid",
      ),
      disambiguateDuplicateProtocolItems: isolatedFunction(
        BACKFILL_PATH,
        "disambiguateDuplicateProtocolItems",
      ),
      endpoint: () => "http://127.0.0.1/internal/token-verifier",
      invalidProtocolItem: isolatedFunction(BACKFILL_PATH, "invalidProtocolItem"),
      rawProtocolItemMatchesCanonical: isolatedFunction(
        BACKFILL_PATH,
        "rawProtocolItemMatchesCanonical",
      ),
      rawProtocolItemsForTx: () => [
        {
          amount: 10,
          amountSats: paidSats,
          kind: "token-sale",
          listingId,
          paidSats,
          protocol: "pwt1",
          tokenId,
          txid,
        },
      ],
      readJson: async () => ({
        blockHash,
        indexedThroughBlock: 101,
        items: [
          {
            amount: 10,
            amountSats: paidSats,
            anchorRefundSats,
            blockHeight: 101,
            confirmed: true,
            kind: "token-sale",
            listingId,
            paidSats,
            priceSats,
            tokenId,
            txid,
          },
          {
            amount: 10,
            amountSats: paidSats,
            anchorRefundSats,
            closedBlockHeight: 101,
            closedTxid: txid,
            confirmed: true,
            kind: "token-listing-closed",
            listingId,
            paidSats,
            tokenId,
          },
        ],
        network: "livenet",
        previousBlockHash,
        source: "canonical-block-scan-db-core-credit-verifier",
        txid,
      }),
      recoveryEndpointSpecs: () => [
        {
          label: "token-verifier",
          params: { asset: tokenId, txid },
          path: "/api/v1/internal/token-verifier",
        },
      ],
      sourceLabelForProtocolItem: isolatedFunction(
        BACKFILL_PATH,
        "sourceLabelForProtocolItem",
      ),
    },
  );
  const recovered = await canonicalRecoveryItemsForTx(
    {
      _powBlockHash: blockHash,
      _powPreviousBlockHash: previousBlockHash,
      height: 101,
      txid,
    },
    [{ prefix: "pwt1:", text: "pwt1:buy5:fixture" }],
  );
  const sales = recovered.filter(({ item }) => item.kind === "token-sale");
  const closes = recovered.filter(
    ({ item }) => item.kind === "token-listing-closed",
  );
  assert.equal(sales.length, 1);
  assert.equal(closes.length, 1);
  assert.equal(sales[0].item.amountSats, priceSats);
  assert.equal(closes[0].item.amountSats, 546);
  assert.equal(
    sales[0].item.amountSats + closes[0].item.amountSats,
    priceSats + 546,
  );
  assert.notEqual(
    sales[0].item.amountSats + closes[0].item.amountSats,
    paidSats,
  );
});

check("sealed credit listings keep the original sale-ticket anchor", () => {
  const listingId = "a".repeat(64);
  const sealTxid = "b".repeat(64);
  const tokenListingAnchorOutpoint = isolatedFunction(
    API_PATH,
    "tokenListingAnchorOutpoint",
    { TOKEN_LISTING_ANCHOR_TYPE: "sale-ticket-v1" },
  );
  const anchor = tokenListingAnchorOutpoint({
    listingId,
    saleAuthorization: {
      anchorType: "sale-ticket-v1",
      anchorVout: 2,
    },
    sealConfirmed: true,
    sealTxid,
  });
  assert.equal(anchor.txid, listingId);
  assert.equal(anchor.vout, 2);
});

check("closed listing projections retain seal metadata and close chronology", () => {
  const listingId = "a".repeat(64);
  const sealTxid = "b".repeat(64);
  const closeTxid = "c".repeat(64);
  const tokenClosedListingFromEventPayload = isolatedFunction(
    READER_PATH,
    "tokenClosedListingFromEventPayload",
    {
      dateIso: (value) => new Date(value).toISOString(),
      objectRecord: (value) => value ?? {},
      rowNumber: (value, key) => Number(value?.[key] ?? 0),
      tokenMarketNumbersFromTags: () => ({ amount: 0, priceSats: 0, ticker: "" }),
      tokenRegistryAddressFromPayload: () => "bc1registry",
      validTxid: (value) => /^[0-9a-f]{64}$/u.test(String(value ?? "")),
    },
  );
  const closed = tokenClosedListingFromEventPayload({
    closedAt: "2026-06-30T10:49:21.000Z",
    confirmed: true,
    createdAt: "2026-06-21T11:50:32.000Z",
    listingId,
    saleAuthorization: { anchorTxid: listingId },
    sealAt: "2026-06-21T21:18:53.000Z",
    sealConfirmed: true,
    sealTxid,
    tokenId: "work",
    txid: closeTxid,
  });

  assert.equal(closed.createdAt, "2026-06-21T11:50:32.000Z");
  assert.equal(closed.closedAt, "2026-06-30T10:49:21.000Z");
  assert.equal(closed.sealTxid, sealTxid);
  assert.equal(closed.sealConfirmed, true);
  assert.equal(closed.saleAuthorization.anchorTxid, listingId);
});

check("seal-close summary recovery requires a proven unspent anchor", async () => {
  const listingId = "a".repeat(64);
  const sealTxid = "b".repeat(64);
  let outspend = { spent: true, status: { confirmed: true }, txid: sealTxid };
  const workTokenListingFromCreditListingItem = isolatedFunction(
    API_PATH,
    "workTokenListingFromCreditListingItem",
    {
      WORK_TOKEN_DEFAULT_REGISTRY_ADDRESS: "bc1registry",
      WORK_TOKEN_ID: "work-token",
      WORK_TOKEN_TICKER: "WORK",
      errorSummary: (error) => error?.message ?? String(error),
      normalizeTokenScope: (value) => String(value ?? "").toLowerCase(),
      numericValue: (value) => Number(value) || 0,
      tokenListingAnchorOutspend: async () => outspend,
      tokenListingWithoutCloseMetadata: (listing) => {
        const {
          closeTxid,
          closedAt,
          closedConfirmed,
          closedTxid,
          closedVin,
          ...active
        } = listing;
        return active;
      },
      tokenSaleAuthorizationUsesSaleTicketAnchor: () => true,
      tokenSaleAuthorizationUsesSpendableSaleTicketAnchor: () => true,
    },
  );
  const projectedClose = {
    amount: 1_000,
    closeTxid: sealTxid,
    closedConfirmed: true,
    confirmed: true,
    listingId,
    saleAuthorization: {
      anchorType: "sale-ticket-v1",
      anchorVout: 2,
      tokenId: "work-token",
    },
    sealConfirmed: true,
    sealTxid,
    status: "delisted",
    tokenId: "work-token",
  };
  assert.equal(
    await workTokenListingFromCreditListingItem(
      projectedClose,
      "livenet",
      "2026-07-11T00:00:00.000Z",
    ),
    null,
  );

  outspend = { spent: false };
  const recovered = await workTokenListingFromCreditListingItem(
    projectedClose,
    "livenet",
    "2026-07-11T00:00:00.000Z",
  );
  assert.equal(recovered.status, "sealing");
  assert.equal(recovered.closeTxid, undefined);
  assert.equal(recovered.closedTxid, undefined);

  outspend = null;
  assert.equal(
    await workTokenListingFromCreditListingItem(
      projectedClose,
      "livenet",
      "2026-07-11T00:00:00.000Z",
    ),
    null,
  );
});

check("canonical listing actions use their action time", () => {
  const itemTime = isolatedFunction(BACKFILL_PATH, "itemTime");
  assert.equal(
    itemTime({
      createdAt: "2026-05-20T00:00:00.000Z",
      kind: "token-listing-sealed",
      sealAt: "2026-05-23T00:00:00.000Z",
    }),
    "2026-05-23T00:00:00.000Z",
  );
  assert.equal(
    itemTime({
      closedAt: "2026-05-24T00:00:00.000Z",
      createdAt: "2026-05-20T00:00:00.000Z",
      kind: "token-listing-closed",
    }),
    "2026-05-24T00:00:00.000Z",
  );
});

check("canonical raw transaction time survives event projection upserts", async () => {
  let sql = "";
  const upsertTransaction = isolatedFunction(
    BACKFILL_PATH,
    "upsertTransaction",
    {
      NETWORK: "livenet",
      itemTime: () => "2026-05-20T00:00:00.000Z",
      numberOrNull: (value) => Number(value),
    },
  );
  await upsertTransaction(
    {
      async query(statement) {
        sql = String(statement);
        return { rows: [] };
      },
    },
    { blockHeight: 950_667 },
    "a".repeat(64),
    "confirmed",
    "token-listing-sealed",
  );
  assert.match(
    sql,
    /raw_tx \? 'canonicalBlockScan'[\s\S]*THEN proof_indexer\.transactions\.block_time/u,
  );
  assert.match(
    sql,
    /raw_tx \? 'canonicalBlockScan'[\s\S]*THEN proof_indexer\.transactions\.source/u,
  );
});

check("canonical read gating exempts node primitives only", () => {
  const canonicalPublicReadGateApplies = isolatedFunction(
    API_PATH,
    "canonicalPublicReadGateApplies",
  );
  const txid = "a".repeat(64);
  for (const path of [
    "/api/v1/address/bc1fixture/utxo",
    "/api/v1/address/bc1fixture/txs",
    "/api/v1/address/bc1fixture/txs/mempool",
    `/api/v1/tx/${txid}`,
    `/api/v1/tx/${txid}/hex`,
    `/api/v1/tx/${txid}/status`,
    `/api/v1/tx/${txid}/outspend/0`,
    "/api/v1/block/00000000",
    "/api/v1/broadcast/tx",
    "/api/v1/internal/token-verifier",
    "/api/v1/prices/btc",
  ]) {
    assert.equal(canonicalPublicReadGateApplies(path), false, path);
  }
  for (const path of [
    "/api/v1/address/bc1fixture/mail",
    "/api/v1/registry-history",
    "/api/v1/token-history",
    "/api/v1/ids/inception",
  ]) {
    assert.equal(canonicalPublicReadGateApplies(path), true, path);
  }
});

check("summary catch-up does not brown out current relational reads", async () => {
  const blockHash = "a".repeat(64);
  let confirmedEventMaxBlock = 99;
  const summarySnapshotCoversCanonicalReadModels = isolatedFunction(
    API_PATH,
    "summarySnapshotCoversCanonicalReadModels",
  );
  const loadCanonicalPublicReadGate = isolatedFunction(
    API_PATH,
    "loadCanonicalPublicReadGate",
    {
      PROOF_INDEX_HEALTH_MAX_AGE_MS: 120_000,
      PROOF_INDEX_REQUIRED: true,
      bitcoinRpc: async () => ({
        ok: true,
        result: { bestblockhash: blockHash, blocks: 100 },
      }),
      proofIndexCanonicalStateMetaPayload: async () => ({
        fault: {},
        rebuild: { active: false, status: "complete" },
      }),
      proofIndexOperationalStatusPayload: async () => ({
        indexedThroughBlock: 100,
        readModels: {
          confirmedEvents: { count: 10, maxBlock: confirmedEventMaxBlock },
          confirmedIds: { count: 1, maxBlock: 90 },
          confirmedTransfers: { count: 1, maxBlock: 95 },
        },
        scan: { blockHash, complete: true },
        summarySnapshot: {
          eligible: true,
          indexedThroughBlock: 99,
        },
        worker: {
          lastSuccessAt: new Date().toISOString(),
          ok: true,
        },
      }),
      summarySnapshotCoversCanonicalReadModels,
    },
  );
  const gate = await loadCanonicalPublicReadGate("livenet");
  assert.equal(gate.ok, true);
  assert.equal(gate.summarySnapshotOk, true);
  confirmedEventMaxBlock = 100;
  const changedGate = await loadCanonicalPublicReadGate("livenet");
  assert.equal(changedGate.summarySnapshotOk, false);

  const summaryGate = isolatedFunction(
    API_PATH,
    "canonicalSummarySnapshotReadGateApplies",
  );
  assert.equal(summaryGate("/api/v1/ids/inception"), false);
  assert.equal(summaryGate("/api/v1/token-history"), false);
  assert.equal(summaryGate("/api/v1/work-floor"), true);
  assert.equal(summaryGate("/api/v1/work-summary"), true);
  assert.equal(summaryGate("/api/v1/marketplace-summary"), true);
  assert.equal(summaryGate("/api/v1/infinity-summary"), true);
  assert.equal(summaryGate("/api/v1/growth-summary"), true);
});

check("long worker cycles do not brown out exact canonical reads", async () => {
  const blockHash = "b".repeat(64);
  const summarySnapshotCoversCanonicalReadModels = isolatedFunction(
    API_PATH,
    "summarySnapshotCoversCanonicalReadModels",
  );
  const loadCanonicalPublicReadGate = isolatedFunction(
    API_PATH,
    "loadCanonicalPublicReadGate",
    {
      PROOF_INDEX_HEALTH_MAX_AGE_MS: 120_000,
      PROOF_INDEX_REQUIRED: true,
      bitcoinRpc: async () => ({
        ok: true,
        result: { bestblockhash: blockHash, blocks: 100 },
      }),
      proofIndexCanonicalStateMetaPayload: async () => ({
        fault: {},
        rebuild: { active: false, status: "complete" },
      }),
      proofIndexOperationalStatusPayload: async () => ({
        indexedThroughBlock: 100,
        readModels: {
          confirmedEvents: { count: 10, maxBlock: 100 },
          confirmedIds: { count: 1, maxBlock: 90 },
          confirmedTransfers: { count: 1, maxBlock: 95 },
        },
        scan: { blockHash, complete: true },
        summarySnapshot: {
          eligible: true,
          indexedThroughBlock: 99,
        },
        worker: {
          lastSuccessAt: new Date(Date.now() - 300_000).toISOString(),
          ok: false,
        },
      }),
      summarySnapshotCoversCanonicalReadModels,
    },
  );

  const gate = await loadCanonicalPublicReadGate("livenet");
  assert.equal(gate.ok, true);
  assert.equal(gate.workerFresh, false);
  assert.equal(gate.workerOk, false);
  assert.equal(gate.summarySnapshotOk, false);
});

check("canonical public-read gates cache each network independently", async () => {
  const loads = [];
  const canonicalPublicReadGate = isolatedFunction(
    API_PATH,
    "canonicalPublicReadGate",
    {
      CANONICAL_PUBLIC_READ_GATE_TTL_MS: 2_000,
      CANONICAL_PUBLIC_READ_GATE_TIMEOUT_MS: 15_000,
      CANONICAL_PUBLIC_READ_GATE_TIMEOUT_TTL_MS: 2_000,
      canonicalPublicReadGateCache: new Map(),
      errorSummary: (error) => String(error?.message ?? error),
      loadCanonicalPublicReadGate: async (network) => {
        loads.push(network);
        return { network, ok: true };
      },
      promiseOutcomeWithin: async (promise) => ({
        ok: true,
        timedOut: false,
        value: await promise,
      }),
    },
  );
  await canonicalPublicReadGate("livenet");
  await canonicalPublicReadGate("testnet");
  await canonicalPublicReadGate("livenet");
  assert.deepEqual(loads, ["livenet", "testnet"]);
});

check("exact current ID reads preserve the confirmed database record", () => {
  assert.match(
    fileSource(READER_PATH),
    /function confirmedIdRecordFromRow[\s\S]*?amountSats:\s*ID_REGISTRATION_PRICE_SATS/u,
    "relational ID records must retain their canonical registration proof amount",
  );
  const exactIdRecordsWithIndexedConfirmation = isolatedFunction(
    API_PATH,
    "exactIdRecordsWithIndexedConfirmation",
    {
      normalizePowId: (value) => String(value).trim().toLowerCase(),
    },
  );
  const confirmed = {
    confirmed: true,
    id: "inception",
    ownerAddress: "bc1currentowner",
    txid: "c".repeat(64),
  };
  const records = exactIdRecordsWithIndexedConfirmation(
    { records: [] },
    { records: [confirmed] },
    "inception",
  );
  assert.equal(records.length, 1);
  assert.equal(records[0].confirmed, true);
  assert.equal(records[0].ownerAddress, "bc1currentowner");
});

check("exact ID lifecycle keeps sealed listings active until a canonical close", () => {
  const listingId = "a".repeat(64);
  const sealTxid = "b".repeat(64);
  const delistTxid = "c".repeat(64);
  const buyTxid = "d".repeat(64);
  const siblingListingId = "9".repeat(64);
  const sellerAddress = "bc1seller";
  const buyerAddress = "bc1buyer";
  const idLifecycleStateFromItems = isolatedFunction(
    READER_PATH,
    "idLifecycleStateFromItems",
    {
      compareHistoryItems: (left, right) =>
        Date.parse(right.createdAt) - Date.parse(left.createdAt),
      dateIso: (value) => new Date(value).toISOString(),
      normalizedLowerText: (value) => String(value ?? "").trim().toLowerCase(),
      normalizedText: (value) => String(value ?? "").trim(),
      normalizedTxid: (value) => {
        const txid = String(value ?? "").trim().toLowerCase();
        return /^[0-9a-f]{64}$/u.test(txid) ? txid : "";
      },
      objectRecord: (value) =>
        value && typeof value === "object" && !Array.isArray(value)
          ? value
          : {},
    },
  );
  const authorization = {
    anchorSignature: "",
    anchorTxid: "",
    anchorType: "sale-ticket-v1",
    anchorValueSats: 546,
    anchorVout: 2,
    id: "fixture-id",
    nonce: "fixture",
    priceSats: 12_345,
    sellerAddress,
    version: "pwid-sale-v4",
  };
  const list = {
    blockHeight: 100,
    blockIndex: 1,
    _powEventIndex: 0,
    confirmed: true,
    createdAt: "2026-07-11T00:00:00.000Z",
    id: "fixture-id",
    kind: "id-list",
    listingId,
    listingVersion: "list5",
    priceSats: 12_345,
    saleAuthorization: authorization,
    sellerAddress,
    txid: listingId,
  };
  const seal = {
    blockHeight: 100,
    blockIndex: 1,
    _powEventIndex: 1,
    confirmed: true,
    createdAt: "2026-07-11T00:10:00.000Z",
    kind: "id-seal",
    listingId,
    saleAuthorization: {
      ...authorization,
      anchorSignature: "3044fixture",
      anchorTxid: listingId,
    },
    txid: sealTxid,
  };

  const sealed = idLifecycleStateFromItems(
    [list, seal],
    "livenet",
    "fixture-id",
  );
  assert.equal(sealed.listings.length, 1);
  assert.equal(sealed.listings[0].listingId, listingId);
  assert.equal(sealed.listings[0].txid, listingId);
  assert.equal(sealed.listings[0].sealTxid, sealTxid);
  assert.equal(sealed.listings[0].saleAuthorization.anchorTxid, listingId);
  assert.equal(
    sealed.listings[0].saleAuthorization.anchorSignature,
    "3044fixture",
  );
  assert.equal(sealed.activity[0].kind, "id-seal");

  for (const [version, listingVersion] of [
    ["pwid-sale-v2", "list3"],
    ["pwid-sale-v3", "list4"],
  ]) {
    const legacyListingId = listingVersion === "list3" ? "7".repeat(64) : "8".repeat(64);
    const legacy = idLifecycleStateFromItems(
      [
        {
          ...list,
          listingId: legacyListingId,
          listingVersion: undefined,
          saleAuthorization: { ...authorization, version },
          txid: legacyListingId,
        },
      ],
      "livenet",
      "fixture-id",
    );
    assert.equal(legacy.listings[0].listingVersion, listingVersion);
  }

  const delisted = idLifecycleStateFromItems(
    [
      list,
      seal,
      {
        blockHeight: 102,
        blockIndex: 1,
        confirmed: true,
        createdAt: "2026-07-11T00:20:00.000Z",
        kind: "id-delist",
        listingId,
        txid: delistTxid,
      },
    ],
    "livenet",
    "fixture-id",
  );
  assert.equal(delisted.listings.length, 0);
  assert.equal(delisted.sales.length, 0);

  const bought = idLifecycleStateFromItems(
    [
      list,
      seal,
      {
        ...list,
        blockHeight: 101,
        blockIndex: 3,
        createdAt: "2026-07-11T00:15:00.000Z",
        listingId: siblingListingId,
        txid: siblingListingId,
      },
      {
        amountSats: 546,
        blockHeight: 102,
        blockIndex: 1,
        buyerAddress,
        confirmed: true,
        createdAt: "2026-07-11T00:20:00.000Z",
        id: "fixture-id",
        kind: "id-buy",
        listingId,
        ownerAddress: buyerAddress,
        priceSats: 12_345,
        receiveAddress: buyerAddress,
        sellerAddress,
        transferVersion: "buy5",
        txid: buyTxid,
      },
    ],
    "livenet",
    "fixture-id",
  );
  assert.equal(bought.listings.length, 0);
  assert.equal(bought.sales.length, 1);
  assert.equal(bought.sales[0].listingId, listingId);
  assert.equal(bought.sales[0].buyerAddress, buyerAddress);
  assert.equal(bought.sales[0].priceSats, 12_345);

  const legacyBuy = idLifecycleStateFromItems(
    [
      list,
      {
        amountSats: 546,
        blockHeight: 102,
        blockIndex: 1,
        buyerAddress,
        confirmed: true,
        createdAt: "2026-07-11T00:20:00.000Z",
        id: "fixture-id",
        kind: "id-buy",
        listingId,
        ownerAddress: buyerAddress,
        priceSats: 12_345,
        receiveAddress: buyerAddress,
        sellerAddress,
        transferVersion: "buy2",
        txid: "4".repeat(64),
      },
    ],
    "livenet",
    "fixture-id",
  );
  assert.equal(legacyBuy.listings.length, 0);
  assert.equal(legacyBuy.sales.length, 0);
  assert.equal(legacyBuy.activity[0].kind, "id-buy");

  const otherListingId = "6".repeat(64);
  const broad = idLifecycleStateFromItems(
    [
      list,
      seal,
      {
        ...list,
        blockHeight: 101,
        id: "other-id",
        listingId: otherListingId,
        saleAuthorization: { ...authorization, id: "other-id" },
        txid: otherListingId,
      },
      {
        amountSats: 546,
        blockHeight: 102,
        blockIndex: 1,
        buyerAddress,
        confirmed: true,
        createdAt: "2026-07-11T00:20:00.000Z",
        id: "fixture-id",
        kind: "id-buy",
        listingId,
        ownerAddress: buyerAddress,
        priceSats: 12_345,
        receiveAddress: buyerAddress,
        sellerAddress,
        transferVersion: "buy5",
        txid: buyTxid,
      },
    ],
    "livenet",
    "",
  );
  assert.deepEqual(
    Array.from(broad.listings, (item) => item.listingId),
    [otherListingId],
  );
  assert.equal(broad.sales.length, 1);
  assert.equal(broad.sales[0].id, "fixture-id");

  const transferred = idLifecycleStateFromItems(
    [
      list,
      {
        ...list,
        blockHeight: 101,
        id: "other-id",
        listingId: otherListingId,
        saleAuthorization: { ...authorization, id: "other-id" },
        txid: otherListingId,
      },
      {
        blockHeight: 102,
        blockIndex: 1,
        confirmed: true,
        createdAt: "2026-07-11T00:20:00.000Z",
        id: "other-id",
        kind: "id-transfer",
        ownerAddress: "bc1newowner",
        receiveAddress: "bc1newowner",
        txid: "5".repeat(64),
      },
    ],
    "livenet",
    "",
  );
  assert.deepEqual(
    Array.from(transferred.listings, (item) => item.listingId),
    [listingId],
  );
});

check("exact ID API lifecycle feeds every ID marketplace preflight", async () => {
  const listing = {
    confirmed: true,
    createdAt: "2026-07-11T00:00:00.000Z",
    id: "fixture-id",
    listingId: "e".repeat(64),
    network: "livenet",
    saleAuthorization: {},
    sellerAddress: "bc1seller",
    txid: "e".repeat(64),
  };
  const sale = {
    buyerAddress: "bc1buyer",
    confirmed: true,
    createdAt: "2026-07-11T00:10:00.000Z",
    id: "fixture-id",
    network: "livenet",
    sellerAddress: "bc1seller",
    transferVersion: "buy5",
    txid: "f".repeat(64),
  };
  const proofIndexIdRecordPayload = isolatedFunction(
    READER_PATH,
    "proofIndexIdRecordPayload",
    {
      confirmedIdLifecycleFromCurrentEvents: async () => ({
        activity: [{ ...listing, kind: "id-list" }],
        listings: [listing],
        sales: [sale],
      }),
      confirmedIdRecordsFromCurrentTables: async () => [
        {
          confirmed: true,
          createdAt: "2026-07-11T00:00:00.000Z",
          id: "fixture-id",
          network: "livenet",
          ownerAddress: "bc1seller",
          receiveAddress: "bc1seller",
          txid: "1".repeat(64),
          updatedHeight: 101,
        },
      ],
      indexedThroughBlockFromItems: () => 101,
      newestDateIso: () => "2026-07-11T00:10:00.000Z",
      proofIndexPool: () => ({}),
    },
  );
  const payload = await proofIndexIdRecordPayload("livenet", "fixture-id");
  assert.equal(payload.listings[0].listingId, listing.listingId);
  assert.equal(payload.sales[0].txid, sale.txid);
  assert.equal(payload.source, "proof-indexer-id-record-lifecycle");

  const appSource = fileSource(APP_PATH);
  const replacementDefinition = topLevelFunctionSource(
    APP_PATH,
    "replaceExactPowIdStateItems",
  );
  const replacementBodyStart = replacementDefinition.indexOf(
    "{",
    replacementDefinition.indexOf(")"),
  );
  assert.ok(replacementBodyStart > 0, "exact ID replacement body missing");
  const replacementContext = vm.createContext({
    normalizePowId: (value) => String(value ?? "").trim().toLowerCase(),
  });
  new vm.Script(
    `function replaceExactPowIdStateItems(current, incoming, id, network) ${replacementDefinition
      .slice(replacementBodyStart)
      .replace(/\(item:\s*T\)/gu, "(item)")}\nthis.__replaceExactPowIdStateItems = replaceExactPowIdStateItems;`,
    { filename: APP_PATH.pathname },
  ).runInContext(replacementContext);
  const replaceExactPowIdStateItems =
    replacementContext.__replaceExactPowIdStateItems;
  const staleExact = {
    id: "fixture-id",
    listingId: "2".repeat(64),
    network: "livenet",
  };
  const unrelated = {
    id: "other-id",
    listingId: "3".repeat(64),
    network: "livenet",
  };
  const otherNetwork = {
    id: "fixture-id",
    listingId: "4".repeat(64),
    network: "testnet4",
  };
  const cleared = replaceExactPowIdStateItems(
    [staleExact, unrelated, otherNetwork],
    [],
    "fixture-id",
    "livenet",
  );
  assert.deepEqual(
    Array.from(cleared, (item) => item.listingId),
    [unrelated.listingId, otherNetwork.listingId],
  );
  const replacement = {
    id: "fixture-id",
    listingId: "5".repeat(64),
    network: "livenet",
  };
  const replaced = replaceExactPowIdStateItems(
    [staleExact, unrelated],
    [replacement],
    "fixture-id",
    "livenet",
  );
  assert.deepEqual(
    Array.from(replaced, (item) => item.listingId),
    [replacement.listingId, unrelated.listingId],
  );

  const section = (start, end) => {
    const startIndex = appSource.indexOf(start);
    const endIndex = appSource.indexOf(end, startIndex + start.length);
    assert.ok(startIndex >= 0 && endIndex > startIndex, `${start} section missing`);
    return appSource.slice(startIndex, endIndex);
  };
  const exactFetcher = section(
    "async function fetchIdRecordState(",
    "async function fetchGlobalActivity(",
  );
  assert.match(exactFetcher, /current:\s*"1"/u);
  assert.match(exactFetcher, /fresh:\s*"1"/u);
  for (const actionSource of [
    section("async function sealIdListing(", "async function delistIdListing("),
    section("async function delistIdListing(", "async function purchaseId("),
    section("async function purchaseId(", "async function updateIdReceiver("),
  ]) {
    assert.match(actionSource, /fetchIdRecordState\(network,/u);
    assert.match(actionSource, /replaceExactPowIdStateItems\(/u);
    assert.match(actionSource, /latestState\.pendingEvents/u);
    assert.match(actionSource, /latestState\.sales/u);
    assert.match(actionSource, /latestState\.listings\.find\(/u);
  }
});

check("unpinned broad ID registry uses current relational event state", async () => {
  const listing = {
    confirmed: true,
    createdAt: "2026-07-11T00:10:00.000Z",
    id: "listed-id",
    listingId: "a".repeat(64),
    network: "livenet",
    priceSats: 12_345,
    sellerAddress: "bc1seller",
    txid: "a".repeat(64),
  };
  const confirmedSale = {
    buyerAddress: "bc1buyer",
    confirmed: true,
    createdAt: "2026-07-11T00:08:00.000Z",
    id: "sold-id",
    network: "livenet",
    priceSats: 20_000,
    sellerAddress: "bc1seller",
    transferVersion: "buy5",
    txid: "b".repeat(64),
  };
  const pendingSale = {
    buyerAddress: "bc1pendingbuyer",
    confirmed: false,
    createdAt: "2026-07-11T00:12:00.000Z",
    id: "pending-sale-id",
    network: "livenet",
    priceSats: 30_000,
    sellerAddress: "bc1seller",
    transferVersion: "buy5",
    txid: "c".repeat(64),
  };
  const confirmedRecord = {
    confirmed: true,
    createdAt: "2026-07-10T00:00:00.000Z",
    id: "listed-id",
    network: "livenet",
    ownerAddress: "bc1seller",
    receiveAddress: "bc1seller",
    txid: "d".repeat(64),
    updatedHeight: 100,
  };
  const pendingRecord = {
    confirmed: false,
    createdAt: "2026-07-11T00:11:00.000Z",
    id: "pending-id",
    network: "livenet",
    ownerAddress: "bc1pending",
    receiveAddress: "bc1pending",
    txid: "e".repeat(64),
  };
  const pendingEvent = {
    confirmed: false,
    createdAt: "2026-07-11T00:12:00.000Z",
    id: "pending-sale-id",
    kind: "marketTransfer",
    network: "livenet",
    txid: pendingSale.txid,
  };
  const confirmedRegistration = {
    confirmed: true,
    createdAt: confirmedRecord.createdAt,
    id: confirmedRecord.id,
    kind: "id-register",
    network: "livenet",
    txid: confirmedRecord.txid,
  };
  let registryActivity = [confirmedRegistration, pendingEvent, listing];
  const currentProofIndexRegistryPayload = isolatedFunction(
    READER_PATH,
    "currentProofIndexRegistryPayload",
    {
      compareHistoryItems: (left, right) =>
        Date.parse(right.createdAt) - Date.parse(left.createdAt),
      confirmedIdRecordsFromCurrentTables: async () => [confirmedRecord],
      currentIdRegistryEventState: async () => ({
        activity: registryActivity,
        listings: [listing],
        pendingEvents: [pendingEvent],
        pendingRecords: [pendingRecord],
        pendingSales: [pendingSale],
        sales: [confirmedSale],
      }),
      dateIso: (value) => new Date(value).toISOString(),
      indexedThroughBlockFromItems: () => 100,
      latestProofIndexScanMetadata: async () => ({
        generated_at: "2026-07-11T00:13:00.000Z",
        indexed_through_block: 101,
        payload: {
          complete: true,
          indexedThroughBlockHash: "f".repeat(64),
        },
        snapshot_id: "current-scan",
      }),
      newestDateIso: (values) =>
        new Date(Math.max(...values.map((value) => Date.parse(value)))).toISOString(),
      normalizedLowerText: (value) => String(value ?? "").trim().toLowerCase(),
      objectRecord: (value) => value ?? {},
      rowNumber: (row, key) => Number(row?.[key] ?? 0),
      salesStats: (sales) => ({
        confirmedSales: sales.filter((sale) => sale.confirmed).length,
        confirmedSalesVolumeSats: sales
          .filter((sale) => sale.confirmed)
          .reduce((sum, sale) => sum + sale.priceSats, 0),
        pendingSales: sales.filter((sale) => !sale.confirmed).length,
        pendingSalesVolumeSats: sales
          .filter((sale) => !sale.confirmed)
          .reduce((sum, sale) => sum + sale.priceSats, 0),
        sales: sales.length,
        salesVolumeSats: sales.reduce((sum, sale) => sum + sale.priceSats, 0),
      }),
      uniqueTxidCount: (items) => new Set(items.map((item) => item.txid)).size,
    },
  );
  const current = await currentProofIndexRegistryPayload(
    {},
    "livenet",
    { registryAddress: "bc1registry" },
  );
  assert.deepEqual(
    Array.from(current.records, (record) => record.id),
    ["listed-id", "pending-id"],
  );
  assert.equal(current.listings[0].listingId, listing.listingId);
  assert.equal(current.sales.length, 2);
  assert.equal(current.stats.confirmedSalesVolumeSats, 20_000);
  assert.equal(current.stats.pendingSalesVolumeSats, 30_000);
  assert.equal(current.stats.pendingRecords, 1);
  assert.equal(current.stats.pendingChanges, 1);
  assert.equal(current.indexedThroughBlock, 101);
  assert.equal(current.snapshotId, "current-scan");
  assert.equal(
    current.source,
    "proof-indexer-current-id-events+proof-indexer-confirmed-id-records",
  );
  registryActivity = [
    ...registryActivity,
    {
      confirmed: true,
      id: "missing-relational-record",
      kind: "id-register",
    },
  ];
  assert.equal(
    await currentProofIndexRegistryPayload({}, "livenet", {
      registryAddress: "bc1registry",
    }),
    null,
  );

  let currentReads = 0;
  let snapshotReads = 0;
  const proofIndexRegistryPayload = isolatedFunction(
    READER_PATH,
    "proofIndexRegistryPayload",
    {
      currentProofIndexRegistryPayload: async () => {
        currentReads += 1;
        return current;
      },
      ledgerSnapshotWithPayload: async () => {
        snapshotReads += 1;
        return null;
      },
      normalizedSnapshotId: (value) => {
        const snapshotId = String(value ?? "").trim();
        return !snapshotId || snapshotId.length > 128 || /\s/u.test(snapshotId)
          ? ""
          : snapshotId;
      },
      proofIndexPool: () => ({}),
    },
  );
  assert.equal(
    await proofIndexRegistryPayload("livenet", {}),
    current,
  );
  assert.equal(currentReads, 1);
  assert.equal(snapshotReads, 0);
  assert.equal(
    await proofIndexRegistryPayload("livenet", { snapshotId: "pinned" }),
    null,
  );
  assert.equal(snapshotReads, 1);
  assert.equal(
    await proofIndexRegistryPayload("livenet", { snapshotId: "invalid pin" }),
    null,
  );
  assert.equal(currentReads, 1);
  assert.equal(snapshotReads, 1);
});

check("token verifier uses event-specific seal and close confirmation", () => {
  const sealTxid = "d".repeat(64);
  const closeTxid = "e".repeat(64);
  const tokenVerifierItemsFromState = isolatedFunction(
    API_PATH,
    "tokenVerifierItemsFromState",
  );
  const state = {
    closedListings: [
      {
        closedConfirmed: false,
        closedTxid: closeTxid,
        confirmed: true,
        listingId: "f".repeat(64),
        sealConfirmed: false,
        sealTxid,
      },
    ],
  };
  const [seal] = tokenVerifierItemsFromState(state, sealTxid);
  const [close] = tokenVerifierItemsFromState(state, closeTxid);
  assert.equal(seal.kind, "token-listing-sealed");
  assert.equal(seal.confirmed, false);
  assert.equal(close.kind, "token-listing-closed");
  assert.equal(close.confirmed, false);

  state.closedListings[0].sealConfirmed = true;
  state.closedListings[0].closedConfirmed = true;
  assert.equal(tokenVerifierItemsFromState(state, sealTxid)[0].confirmed, true);
  assert.equal(tokenVerifierItemsFromState(state, closeTxid)[0].confirmed, true);
});

check("canonical consistency reads the exact eligible summary snapshot", async () => {
  const snapshotId = "summary-snapshot";
  const checks = [
    {
      name: "token-components-cover-confirmed-activity",
      ok: true,
    },
    {
      name: "canonical-activity-count-matches-public-log",
      ok: true,
    },
  ];
  let queryText = "";
  const readCanonicalSummary = isolatedFunction(
    READER_PATH,
    "proofIndexCanonicalSummaryLedgerPayload",
    {
      dateIso: (value) => new Date(value).toISOString(),
      proofIndexPool: () => ({
        async query(sql, params) {
          queryText = String(sql);
          assert.deepEqual(Array.from(params), ["livenet"]);
          return {
            rows: [
              {
                consistency: {
                  checks,
                  missingLogEvents: [],
                  ok: true,
                  status: "green",
                },
                generated_at: "2026-07-12T14:16:59.808Z",
                growth_floor_height: 957712,
                growth_height: 957712,
                growth_snapshot_id: snapshotId,
                indexed_through_block: 957712,
                inception_height: 957712,
                inception_snapshot_id: snapshotId,
                infinity_height: 957712,
                infinity_snapshot_id: snapshotId,
                marketplace_floor_height: 957712,
                marketplace_height: 957712,
                marketplace_snapshot_id: snapshotId,
                metrics: {
                  activityItems: 23591,
                  confirmedComputerActions: 23585,
                  indexedThroughBlock: 957712,
                },
                payload_snapshot_id: snapshotId,
                snapshot_id: snapshotId,
                source_hashes: {
                  activity: { confirmed: 23585, count: 23591 },
                },
                totals: {
                  growthActualValueSats: 8_171_663_094,
                  growthWorkFloorValueSats: 8_171_663_094,
                  workActualValueSats: 8_171_663_094,
                  workNetworkValueSats: 8_171_663_094,
                },
                work_floor_height: 957712,
                work_floor_snapshot_id: snapshotId,
                work_summary_floor_height: 957712,
                work_summary_height: 957712,
                work_summary_snapshot_id: snapshotId,
              },
            ],
          };
        },
      }),
      safeBlockHeight: (value) =>
        Number.isSafeInteger(Number(value)) && Number(value) > 0
          ? Number(value)
          : 0,
    },
  );
  const result = await readCanonicalSummary("livenet");
  assert.match(
    queryText,
    /canonical-activity-count-matches-public-log/u,
  );
  assert.equal(result.snapshotId, snapshotId);
  assert.equal(result.metrics.activityItems, 23591);
  assert.equal(result.metrics.confirmedComputerActions, 23585);
  assert.equal(result.consistency.checks.length, 2);
  assert.equal(result.workFloor.networkValueSats, 8_171_663_094);
});

check("public consistency prefers the eligible database snapshot", async () => {
  let legacyReads = 0;
  const indexedLedger = {
    snapshotId: "current-summary",
    metrics: {
      activityItems: 23591,
      confirmedComputerActions: 23585,
    },
  };
  const ledgerConsistencyPayload = isolatedFunction(
    API_PATH,
    "ledgerConsistencyPayload",
    {
      SUMMARY_PROOF_INDEX_READ_WAIT_MS: 100,
      ENABLE_REQUEST_LEDGER_RECOVERY: false,
      errorSummary: (error) => String(error?.message ?? error),
      ledgerPayloadCoversTip: async () => true,
      ledgerPayloadHasCurrentChecks: () => true,
      ledgerConsistencyPayloadFromLedger: (ledger) => ({
        metrics: ledger.metrics,
        snapshotId: ledger.snapshotId,
      }),
      payloadWithFallbackAfterMs: async (promise) => promise,
      proofIndexCanonicalSummaryLedgerPayload: async () => indexedLedger,
      summaryCanonicalLedgerPayload: async () => {
        legacyReads += 1;
        return null;
      },
    },
  );
  const result = await ledgerConsistencyPayload("livenet", true);
  assert.equal(result.snapshotId, indexedLedger.snapshotId);
  assert.equal(result.metrics.activityItems, 23591);
  assert.equal(legacyReads, 0);
});

check("public consistency fails closed without an eligible database snapshot", async () => {
  let legacyReads = 0;
  let indexedLedger = null;
  const ledgerConsistencyPayload = isolatedFunction(
    API_PATH,
    "ledgerConsistencyPayload",
    {
      ENABLE_REQUEST_LEDGER_RECOVERY: false,
      SUMMARY_PROOF_INDEX_READ_WAIT_MS: 100,
      errorSummary: (error) => String(error?.message ?? error),
      freshDataUnavailableError: (message) => {
        const error = new Error(message);
        error.statusCode = 503;
        return error;
      },
      ledgerPayloadCoversTip: async () => true,
      ledgerPayloadHasCurrentChecks: (payload) =>
        payload?.eligible === true,
      payloadWithFallbackAfterMs: async (promise) => promise,
      proofIndexCanonicalSummaryLedgerPayload: async () => indexedLedger,
      summaryCanonicalLedgerPayload: async () => {
        legacyReads += 1;
        return null;
      },
    },
  );
  for (const candidate of [null, { eligible: false }]) {
    indexedLedger = candidate;
    await rejection(
      ledgerConsistencyPayload("livenet", false),
      (error) => error?.statusCode === 503,
    );
  }
  assert.equal(legacyReads, 0);
});

check("consistency recovery remains available only when explicitly enabled", async () => {
  const ledgerConsistencyPayload = isolatedFunction(
    API_PATH,
    "ledgerConsistencyPayload",
    {
      ENABLE_REQUEST_LEDGER_RECOVERY: true,
      SUMMARY_PROOF_INDEX_READ_WAIT_MS: 100,
      errorSummary: (error) => String(error?.message ?? error),
      ledgerConsistencyPayloadFromLedger: (ledger) => ({
        snapshotId: ledger.snapshotId,
      }),
      ledgerConsistencyPayloadWithCurrentSummaries: async (payload) => payload,
      ledgerPayloadCoversTip: async () => false,
      ledgerPayloadHasCurrentChecks: () => false,
      payloadWithFallbackAfterMs: async (promise) => promise,
      proofIndexCanonicalSummaryLedgerPayload: async () => null,
      summaryCanonicalLedgerPayload: async () => ({
        snapshotId: "recovered-ledger",
      }),
    },
  );
  assert.equal(
    (await ledgerConsistencyPayload("livenet", false)).snapshotId,
    "recovered-ledger",
  );
});

check("both consistency routes require an eligible summary snapshot", () => {
  const applies = isolatedFunction(
    API_PATH,
    "canonicalSummarySnapshotReadGateApplies",
  );
  assert.equal(applies("/api/v1/consistency"), true);
  assert.equal(applies("/api/v1/ledger-consistency"), true);
});

check("an accepted ID buy projects the buyer as the current owner", async () => {
  const txid = "9".repeat(64);
  const listingId = "a".repeat(64);
  const buyer = "bc1buyer";
  const idVerifierItemsFromState = isolatedFunction(
    API_PATH,
    "idVerifierItemsFromState",
  );
  const [buy] = idVerifierItemsFromState(
    {
      activity: [
        {
          confirmed: true,
          id: "fixture-id",
          kind: "id-buy",
          listingId,
          txid,
        },
      ],
      listings: [],
      sales: [
        {
          buyerAddress: buyer,
          id: "fixture-id",
          receiveAddress: buyer,
          sellerAddress: "bc1seller",
          txid,
        },
      ],
    },
    txid,
  );
  assert.equal(buy.ownerAddress, buyer);

  const upsertProjection = isolatedFunction(BACKFILL_PATH, "upsertProjection", {
    INFINITY_BOND_KIND: "infinity-bond",
    NETWORK: "livenet",
    bondTagForKind: () => null,
    eventKind: (item) => item.kind,
    numberOrNull: (value) => (Number.isFinite(Number(value)) ? Number(value) : null),
  });
  const calls = [];
  await upsertProjection(
    {
      async query(sql, params) {
        calls.push({ params, sql: String(sql) });
        return { rows: [] };
      },
    },
    "id-sales",
    { ...buy, blockHeight: 101 },
    "confirmed",
  );
  const update = calls.find((call) => /UPDATE proof_indexer\.id_records/u.test(call.sql));
  assert.ok(update, "ID buy did not update the current ID record");
  assert.equal(update.params[2], buyer);
  assert.equal(update.params[3], buyer);
  assert.equal(update.params[5], txid);
});

let failures = 0;
for (const test of tests) {
  try {
    await test.run();
    console.log(`ok - ${test.name}`);
  } catch (error) {
    failures += 1;
    console.error(`not ok - ${test.name}`);
    console.error(`  ${error?.stack ?? error}`);
  }
}

console.log(`\n${tests.length - failures}/${tests.length} behavior checks passed.`);
if (failures > 0) {
  process.exitCode = 1;
}
