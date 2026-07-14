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
      payloadSnapshotId: () => "",
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
  const requestedTxid = "a".repeat(64);
  const otherTxid = "b".repeat(64);
  let filteredAddresses = null;
  let filteredItems = null;
  let mergeOptions = null;
  const tokenHistoryPageWithCanonicalCreditValueOverlay = isolatedFunction(
    API_PATH,
    "tokenHistoryPageWithCanonicalCreditValueOverlay",
    {
      BOND_TOKEN_IDS: new Set(["powb", "incb"]),
      POWB_TOKEN_ID: "powb",
      WORK_TOKEN_ID: "work",
      activeTokenListingsFromState: () => [],
      currentCanonicalWorkTransferValueSummary: async () => ({}),
      existingCanonicalLedgerPayload: async () => null,
      existingCurrentCanonicalLedgerPayload: async () => ({
        generatedAt: "2026-07-11T00:00:00.000Z",
      }),
      historyItemsMatchingAddresses: (items, addresses) => {
        filteredAddresses = addresses;
        filteredItems = items;
        return items;
      },
      historyPaginationFromSearch: () => ({
        limit: 20,
        offset: 0,
        page: 0,
        query: "",
      }),
      ledgerTokenStateForScope: () => ({
        transfers: [
          { recipientAddress: address, txid: otherTxid },
          { recipientAddress: address, txid: requestedTxid },
        ],
      }),
      mergeTokenHistoryPageWithOverlay: (page, _overlay, _pagination, options) => {
        mergeOptions = options;
        return page;
      },
      mergedSourceLabel: () => "test",
      normalizeTokenScope: (scope) => String(scope).toLowerCase(),
      normalizedTokenHistoryKind: (kind) => String(kind).toLowerCase(),
      paginatedHistoryPayload: (value) => value,
      recoveryAddressHintsFromSearchParams: () => [address],
      recoveryTxidsFromSearchParams: (params) =>
        [params.get("txid")].filter(Boolean),
      tokenHistoryKindNeedsCreditNetworkValueOverlay: () => true,
      tokenHistoryPageWithCanonicalWorkTransferValues: (page) => page,
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

  await tokenHistoryPageWithCanonicalCreditValueOverlay(
    { items: [] },
    "livenet",
    "work",
    "transfers",
    new URLSearchParams({ address, txid: requestedTxid }),
  );
  assert.deepEqual(
    Array.from(filteredItems, (item) => item.txid),
    [requestedTxid],
    "an older exact tx read must filter before overlay pagination",
  );
});

check("canonical credit fee fields cannot be overwritten by stale projections", () => {
  const fields = [
    "attributedMinerFeeSats",
    "canonicalMinerFeeSats",
    "fixedEventFlowSats",
    "frozenNetworkValueSats",
    "minerFeeSats",
    "transactionMinerFeeSats",
  ];
  const mergeCreditNetworkValueRecord = isolatedFunction(
    API_PATH,
    "mergeCreditNetworkValueRecord",
    { CREDIT_NETWORK_VALUE_FIELD_NAMES: fields },
  );
  const canonical = {
    attributedMinerFeeSats: 0,
    canonicalMinerFeeCovered: true,
    canonicalMinerFeeSats: 0,
    fixedEventFlowSats: 546,
    frozenNetworkValueSats: 746,
    minerFeeSats: 0,
    minerFeeSource: "proof-indexer-normalized-input-output-totals",
    transactionMinerFeeSats: 0,
  };
  const stale = {
    attributedMinerFeeSats: 999,
    canonicalMinerFeeCovered: false,
    canonicalMinerFeeSats: 999,
    fixedEventFlowSats: 1_545,
    frozenNetworkValueSats: 1_745,
    minerFeeSats: 999,
    minerFeeSource: "legacy-payload",
    transactionMinerFeeSats: 999,
  };
  const preserved = mergeCreditNetworkValueRecord(canonical, stale);
  assert.equal(preserved.canonicalMinerFeeCovered, true);
  assert.equal(preserved.canonicalMinerFeeSats, 0);
  assert.equal(preserved.minerFeeSats, 0);
  assert.equal(preserved.attributedMinerFeeSats, 0);
  assert.equal(preserved.fixedEventFlowSats, 546);
  assert.equal(preserved.frozenNetworkValueSats, 746);
  assert.equal(
    preserved.minerFeeSource,
    "proof-indexer-normalized-input-output-totals",
  );

  const incomingCanonical = {
    ...stale,
    canonicalMinerFeeCovered: true,
    canonicalMinerFeeSats: 22,
    minerFeeSats: 22,
    minerFeeSource: "new-canonical-source",
  };
  const replaced = mergeCreditNetworkValueRecord(
    { ...canonical, canonicalMinerFeeSats: 11, minerFeeSats: 11 },
    incomingCanonical,
  );
  assert.equal(replaced.canonicalMinerFeeSats, 22);
  assert.equal(replaced.minerFeeSats, 22);
  assert.equal(replaced.minerFeeSource, "new-canonical-source");
  assert.match(
    topLevelFunctionSource(API_PATH, "mergeTokenTransferRecord"),
    /mergeCreditNetworkValueRecord\(current, incoming\)/u,
  );
  const floorMergeSource = topLevelFunctionSource(
    API_PATH,
    "tokenPayloadWithCanonicalHistoryFloor",
  );
  assert.match(
    floorMergeSource,
    /next\.mints = mergeCanonicalHistoryItems\([\s\S]*?mergeCreditNetworkValueRecord/u,
  );
  assert.match(
    floorMergeSource,
    /next\.sales = mergeCanonicalHistoryItems\([\s\S]*?mergeCreditNetworkValueRecord/u,
  );
});

check("livenet WORK snapshots require the unique-transaction fee model", async () => {
  const verifiedCanonicalMinerFeeCoverage = isolatedFunction(
    API_PATH,
    "verifiedCanonicalMinerFeeCoverage",
  );
  const workFloorPayloadHasFiniteNetworkValue = isolatedFunction(
    API_PATH,
    "workFloorPayloadHasFiniteNetworkValue",
    {
      CREDIT_MINER_FEE_ACCOUNTING_MODEL:
        "canonical-unique-tx-input-output-v1",
      finitePositiveNumber: (value) => Number(value) > 0,
      numbersAgree: (left, right) => Number(left) === Number(right),
      verifiedCanonicalMinerFeeCoverage,
    },
  );
  const floor = {
    actualValue: {
      frozenNetworkValueSats: 900,
      liveNetworkValueSats: 1_000,
      totalSats: 1_000,
    },
    frozenNetworkValueSats: 900,
    liveNetworkValueSats: 1_000,
    network: "livenet",
    networkValueSats: 1_000,
  };
  assert.equal(workFloorPayloadHasFiniteNetworkValue(floor), false);
  assert.equal(
    workFloorPayloadHasFiniteNetworkValue({
      ...floor,
      actualValue: {
        ...floor.actualValue,
        creditMinerFeeAccountingModel:
          "canonical-unique-tx-input-output-v1",
        creditMinerFeeCoverage: {
          complete: true,
          confirmedEvents: 2,
          confirmedTransactions: 1,
          coveredConfirmedEvents: 2,
          coveredConfirmedTransactions: 1,
          missingConfirmedEvents: 0,
          missingConfirmedTransactions: 0,
          missingConfirmedTxids: [],
          source: "proof-indexer-normalized-input-output-totals",
        },
      },
    }),
    true,
  );
  const ledgerWithReplayedCreditNetworkValues = isolatedFunction(
    API_PATH,
    "ledgerWithReplayedCreditNetworkValues",
    {
      ledgerPayloadIsUsableFallback: () => true,
      verifiedCanonicalMinerFeeCoverage,
    },
  );
  assert.equal(
    await ledgerWithReplayedCreditNetworkValues(
      {
        registryState: {},
        tokenState: {},
        workFloor: {
          actualValue: {
            creditMinerFeeAccountingModel:
              "canonical-unique-tx-input-output-v1",
          },
        },
      },
      "livenet",
    ),
    null,
    "model-only cached ledgers must not self-attest a replay",
  );
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
  let indexedReads = 0;
  const walletScopedTokenPayload = isolatedFunction(
    API_PATH,
    "walletScopedTokenPayload",
    {
      BOND_TOKEN_IDS: new Set(),
      WALLET_SCOPED_INDEX_WAIT_MS: 10_000,
      WORK_TOKEN_ID: "work-token-id",
      currentProofIndexTokenPayloadForRead: async (
        _network,
        _scope,
        _label,
        _timeoutMs,
      ) => {
        indexedReads += 1;
        return null;
      },
      freshDataUnavailableError: (message) => new Error(message),
      normalizeTokenScope: (value) => value,
      proofIndexReadFeatureEnabled: () => true,
      proofIndexWalletScopedTokenPayloadForRead: async () => null,
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
  assert.equal(indexedReads, 0);

  const currentWalletScopedTokenPayload = isolatedFunction(
    API_PATH,
    "walletScopedTokenPayload",
    {
      BOND_TOKEN_IDS: new Set(),
      WALLET_SCOPED_INDEX_WAIT_MS: 10_000,
      WORK_TOKEN_ID: "work-token-id",
      currentProofIndexTokenPayloadForRead: async () => {
        throw new Error("fresh reads must not use an unbound global payload");
      },
      normalizeTokenScope: (value) => value,
      proofIndexReadFeatureEnabled: () => true,
      proofIndexWalletScopedTokenPayloadForRead: async () => ({
        holders: [],
        tokens: [{ tokenId: "other-token-id" }],
      }),
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

check("authoritative wallet projections reject truncated pending or listing sets", () => {
  const walletProjectionExceedsLimit = isolatedFunction(
    READER_PATH,
    "walletProjectionExceedsLimit",
    {
      normalizedLowerText: (value) => String(value ?? "").trim().toLowerCase(),
    },
  );
  const pendingRows = Array.from({ length: 501 }, () => ({
    status: "pending",
  }));
  assert.equal(walletProjectionExceedsLimit(pendingRows, 500, "pending"), true);
  assert.equal(
    walletProjectionExceedsLimit(
      [...pendingRows.slice(0, 500), { status: "confirmed" }],
      500,
      "pending",
    ),
    false,
  );
  assert.equal(
    walletProjectionExceedsLimit(Array.from({ length: 501 }, () => ({})), 500),
    true,
  );
});

check("token spendability deducts reservations and pending sends once", () => {
  const tokenTransferSpendabilityKey = isolatedTypeScriptFunction(
    APP_PATH,
    "tokenTransferSpendabilityKey",
  );
  const mergeTokenTransfersForSpendability = isolatedTypeScriptFunction(
    APP_PATH,
    "mergeTokenTransfersForSpendability",
    { tokenTransferSpendabilityKey },
  );
  const tokenSpendabilityForWallet = isolatedTypeScriptFunction(
    APP_PATH,
    "tokenSpendabilityForWallet",
    {
      mergeTokenListingsById: (current, incoming) => [...current, ...incoming],
      mergeTokenTransfersForSpendability,
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
  const secondPendingTransfer = {
    ...pendingTransfer,
    amount: 2_000,
    recipientAddress: "second-recipient",
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
      transfers: [pendingTransfer, secondPendingTransfer],
    },
    [],
    [],
    [pendingTransfer, secondPendingTransfer],
    [],
  );
  assert.equal(result.confirmedBalance, 10_763);
  assert.equal(result.reservedBalance, 2_000);
  assert.equal(result.pendingOutgoing, 3_000);
  assert.equal(result.spendableBalance, 5_763);

  const identicalRecipientResult = tokenSpendabilityForWallet(
    "sender",
    token,
    {
      closedListings: [],
      holders: [{ address: "sender", balance: 10_000, tokenId: token.tokenId }],
      listings: [],
      sales: [],
      transfers: [pendingTransfer, pendingTransfer],
    },
    [],
    [],
    [pendingTransfer, pendingTransfer],
    [],
  );
  assert.equal(identicalRecipientResult.pendingOutgoing, 2_000);
  assert.equal(identicalRecipientResult.spendableBalance, 8_000);

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

check("clean scoped account lanes suppress stale WORK and bond positives", () => {
  const tokenScopeMatchesToken = (
    token,
    tokenScope = "",
  ) => {
    const normalizedScope = String(tokenScope).trim();
    return (
      normalizedScope.length > 0 &&
      (token.tokenId === normalizedScope ||
        token.ticker === String(normalizedScope).trim().toUpperCase())
    );
  };
  const mergeTokenWalletBalancesByToken = isolatedTypeScriptFunction(
    APP_PATH,
    "mergeTokenWalletBalancesByToken",
    { normalizeTokenTicker: (value) => String(value).trim().toUpperCase() },
  );
  const accountTokenBalanceMatchesLane = isolatedTypeScriptFunction(
    APP_PATH,
    "accountTokenBalanceMatchesLane",
    { tokenScopeMatchesToken },
  );
  const mergeAccountTokenWalletBalanceLanes = isolatedTypeScriptFunction(
    APP_PATH,
    "mergeAccountTokenWalletBalanceLanes",
    { accountTokenBalanceMatchesLane, mergeTokenWalletBalancesByToken },
  );
  const balance = (tokenId, ticker, confirmedBalance) => ({
    confirmedBalance,
    pendingIncoming: 0,
    pendingOutgoing: 0,
    token: { ticker, tokenId },
  });
  const stale = [
    balance("work-token-id", "WORK", 30),
    balance("powb-token-id", "POWB", 20),
    balance("incb-token-id", "INCB", 10),
    balance("other-token-id", "OTHER", 5),
  ];
  const merged = mergeAccountTokenWalletBalanceLanes(stale, false, [
    {
      balances: [],
      clean: true,
      ticker: "WORK",
      tokenId: "work-token-id",
    },
    {
      balances: [],
      clean: true,
      ticker: "POWB",
      tokenId: "powb-token-id",
    },
    {
      balances: [],
      clean: true,
      ticker: "INCB",
      tokenId: "incb-token-id",
    },
  ]);
  assert.equal(
    merged.map((item) => item.token.ticker).join(","),
    "OTHER",
  );
  const cleanAllWithFailedScopedLane = mergeAccountTokenWalletBalanceLanes(
    [balance("work-token-id", "WORK", 30)],
    true,
    [
      {
        balances: [balance("work-token-id", "WORK", 999)],
        clean: false,
        ticker: "WORK",
        tokenId: "work-token-id",
      },
    ],
  );
  assert.equal(cleanAllWithFailedScopedLane[0].confirmedBalance, 30);

  const accountTokenLaneForDefinition = isolatedTypeScriptFunction(
    APP_PATH,
    "accountTokenLaneForDefinition",
    {
      INCB_TOKEN_ID: "incb-token-id",
      INCB_TOKEN_TICKER: "INCB",
      POWB_TOKEN_ID: "powb-token-id",
      POWB_TOKEN_TICKER: "POWB",
      WORK_TOKEN_ID: "work-token-id",
      WORK_TOKEN_TICKER: "WORK",
      tokenScopeMatchesToken,
    },
  );
  const accountTokenLaneHasCleanAuthority = isolatedTypeScriptFunction(
    APP_PATH,
    "accountTokenLaneHasCleanAuthority",
    { accountTokenLaneForDefinition },
  );
  const statuses = {
    all: { error: "", loaded: false, loading: false },
    work: { error: "", loaded: true, loading: false },
    powb: { error: "", loaded: true, loading: false },
    incb: { error: "", loaded: true, loading: false },
  };
  assert.equal(
    accountTokenLaneHasCleanAuthority(stale[0].token, statuses),
    true,
  );
  assert.equal(
    accountTokenLaneHasCleanAuthority(stale[1].token, statuses),
    true,
  );
  assert.equal(
    accountTokenLaneHasCleanAuthority(stale[2].token, statuses),
    true,
  );
  assert.equal(
    accountTokenLaneHasCleanAuthority(stale[3].token, statuses),
    false,
  );
  assert.equal(
    accountTokenLaneHasCleanAuthority(stale[0].token, {
      ...statuses,
      work: { error: "stale", loaded: true, loading: false },
    }),
    false,
  );
  assert.equal(
    accountTokenLaneHasCleanAuthority(stale[3].token, {
      ...statuses,
      all: { error: "", loaded: true, loading: false },
    }),
    true,
  );

  const walletBalancesForConnection = isolatedTypeScriptFunction(
    APP_PATH,
    "walletBalancesForConnection",
  );
  assert.deepEqual(walletBalancesForConnection("connected", [], stale), []);
  assert.deepEqual(walletBalancesForConnection("", [], stale), stale);
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
    /mergeAccountTokenWalletBalanceLanes\(\s*accountTokenWalletBalances/u,
  );
  assert.match(
    appSource,
    /mergeAccountTokenWalletBalanceLanes\([\s\S]*accountWorkWalletBalances[\s\S]*accountPowbWalletBalances/u,
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
  const blockHash = "7".repeat(64);
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
        checkpointComplete: true,
        closedListings: [],
        holders: [],
        indexedAt: "2026-07-13T00:00:00.000Z",
        indexedThroughBlock: 957_935,
        indexedThroughBlockHash: blockHash,
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
        snapshotId: "wallet-overlay-checkpoint",
        source: "proof-indexer-wallet-token-overlay",
        sourceHashes: { blockScan: blockHash },
        transfers: [],
      }),
      tokenStateWithPreservedListingRecords: (state) => state,
      tokenTransferHistoryItemKey: isolatedFunction(
        API_PATH,
        "tokenTransferHistoryItemKey",
        {
          numericValue: (value) => {
            const number = Number(value);
            return Number.isFinite(number) ? number : 0;
          },
        },
      ),
      walletTokenOverlayMatchesPayloadCheckpoint: () => true,
      walletTokenPayloadWithCanonicalDefinitions: (state) => state,
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
  assert.equal(merged.indexedThroughBlock, 957_935);
  assert.equal(merged.indexedThroughBlockHash, blockHash);
  assert.equal(merged.snapshotId, "wallet-overlay-checkpoint");
});

check("wallet index overlay binds every WORK and bond holder to a canonical definition", async () => {
  const address = "1WalletDefinitionInvariant";
  const workTokenId =
    "d4e5ebf11d104d6a63fb74e42094364b25a5f7199a09e5c0e71408972466a8b8";
  const powbTokenId =
    "a3d0bc8528f91dfc52400a885bed7e49235396aa82aa9f95db41be629f1d5562";
  const incbTokenId =
    "3cb25745f937f2b4e5508e5400189fe8fe679cd8e84bfa1e9176d70c9761f15d";
  const blockHash = "7".repeat(64);
  const objectRecord = (value) =>
    value && typeof value === "object" && !Array.isArray(value) ? value : {};
  const rowNumber = (row, key) => Number(row?.[key] ?? 0);
  const dateIso = (value) => new Date(value).toISOString();
  const tokenDefinitionFromRow = isolatedFunction(
    READER_PATH,
    "tokenDefinitionFromRow",
    { dateIso, objectRecord, rowNumber },
  );
  const proofIndexTokenDefinitionsByIds = isolatedFunction(
    READER_PATH,
    "proofIndexTokenDefinitionsByIds",
    { tokenDefinitionFromRow },
  );
  const tokenStateScopeSql = isolatedFunction(
    READER_PATH,
    "tokenStateScopeSql",
  );
  const proofIndexTokenDefinitionsFromTables = isolatedFunction(
    READER_PATH,
    "proofIndexTokenDefinitionsFromTables",
    { tokenDefinitionFromRow, tokenStateScopeSql },
  );
  const proofIndexWalletTokenDefinitions = isolatedFunction(
    READER_PATH,
    "proofIndexWalletTokenDefinitions",
    {
      proofIndexTokenDefinitionsByIds,
      proofIndexTokenDefinitionsFromTables,
    },
  );
  const proofIndexWalletCheckpointMetadata = isolatedFunction(
    READER_PATH,
    "proofIndexWalletCheckpointMetadata",
    {
      dateIso,
      normalizedLowerText: (value) => String(value ?? "").trim().toLowerCase(),
      objectRecord,
      rowNumber,
    },
  );
  const definitions = [
    {
      confirmed: true,
      create_txid: workTokenId,
      created_height: 896_321,
      creator_address: "work-creator",
      max_supply: "21000000",
      metadata: { createdAt: "2026-05-15T02:57:28.000Z" },
      mint_amount: "1000",
      mint_price_sats: "1000",
      registry_address: "work-registry",
      ticker: "WORK",
      token_id: workTokenId,
    },
    {
      confirmed: true,
      create_txid: powbTokenId,
      created_height: 903_001,
      creator_address: "infinity-registry",
      max_supply: String(Number.MAX_SAFE_INTEGER),
      metadata: {
        createdAt: "2026-06-23T00:00:00.000Z",
        uncapped: true,
      },
      mint_amount: "1",
      mint_price_sats: "1",
      registry_address: "infinity-registry",
      ticker: "POWB",
      token_id: powbTokenId,
    },
    {
      confirmed: true,
      create_txid: incbTokenId,
      created_height: 956_001,
      creator_address: "inception-registry",
      max_supply: String(Number.MAX_SAFE_INTEGER),
      metadata: {
        createdAt: "2026-07-10T00:00:00.000Z",
        uncapped: true,
      },
      mint_amount: "1",
      mint_price_sats: "1",
      registry_address: "inception-registry",
      ticker: "INCB",
      token_id: incbTokenId,
    },
  ];
  let definitionQuery = null;
  let checkpointQueries = 0;
  const pool = {
    async query(sql, params) {
      const text = String(sql);
      if (text.includes("FROM proof_indexer.credit_balances cb")) {
        return {
          rows: definitions.map((definition, index) => ({
            address,
            confirmed_balance: String([3_654_060, 225_001, 1_000][index]),
            pending_delta: "0",
            registry_address: definition.registry_address,
            ticker: definition.ticker,
            token_id: definition.token_id,
            updated_at: "2026-07-13T21:00:00.000Z",
          })),
        };
      }
      if (text.includes("wallet_definition_invalid_marker")) {
        return { rows: [] };
      }
      if (text.includes("e.kind IN")) {
        return { rows: [] };
      }
      if (text.includes("FROM proof_indexer.credit_listings cl")) {
        return { rows: [] };
      }
      if (text.includes("FROM proof_indexer.credit_definitions")) {
        if (text.includes("token_id = ANY")) {
          definitionQuery = { params, text };
          return { rows: definitions };
        }
        return {
          rows: definitions.filter(
            (definition) =>
              !params[1] ||
              definition.token_id === params[1] ||
              definition.ticker.toLowerCase() === String(params[1]).toLowerCase(),
          ),
        };
      }
      if (text.includes("FROM proof_indexer.ledger_snapshots")) {
        checkpointQueries += 1;
        return {
          rows: [{
            consistency_complete: false,
            generated_at: "2026-07-13T21:01:00.000Z",
            indexed_through_block: 957_926,
            indexed_through_block_hash: blockHash,
            metrics_complete: false,
            payload_complete: true,
            snapshot_id: "wallet-checkpoint",
            source_hashes: { blockScan: blockHash },
          }],
        };
      }
      assert.fail(`Unexpected wallet overlay query: ${text}`);
    },
  };
  const proofIndexWalletTokenOverlayPayload = isolatedFunction(
    READER_PATH,
    "proofIndexWalletTokenOverlayPayload",
    {
      activeTokenListingHistoryItem: () => false,
      assertCanonicalIncbDefinition: () => {},
      canonicalEventPayload: (payload) => payload ?? {},
      compareTokenItemsByTime: () => 0,
      dateIso,
      normalizeEventPayload: (payload) => payload,
      objectRecord,
      proofIndexPool: () => pool,
      proofIndexWalletTokenDefinitions,
      proofIndexWalletCheckpointMetadata,
      rowNumber,
      tokenClosedListingFromEventPayload: () => ({}),
      tokenInvalidEventFromRow: (row) => row,
      tokenInvalidEventQueryParts: () => ({
        fromSql: "FROM proof_indexer.events e WHERE e.network = $1",
        params: ["livenet"],
      }),
      tokenInvalidEventSelectSql: () =>
        "'wallet_definition_invalid_marker' AS wallet_definition_invalid_marker",
      tokenListingEffectiveCloseTxid: () => "",
      tokenListingEffectiveSaleTicketTxid: () => "",
      tokenListingFromEventPayload: () => ({}),
      tokenSaleFromEventPayload: () => ({}),
      tokenScopeKey: (value) => String(value ?? "").trim().toLowerCase(),
      tokenTransferFromEventPayload: () => ({}),
      validTxid: () => false,
      walletProjectionExceedsLimit: () => false,
    },
  );

  const overlay = await proofIndexWalletTokenOverlayPayload(
    "livenet",
    "all",
    [address],
  );
  const definedById = new Map(
    overlay.tokens.map((token) => [token.tokenId, token]),
  );
  assert.equal(overlay.holders.length, 3);
  assert.equal(overlay.tokens.length, 3);
  for (const holder of overlay.holders) {
    assert.ok(
      definedById.has(holder.tokenId),
      `${holder.ticker} holder is missing its canonical definition`,
    );
    assert.equal(definedById.get(holder.tokenId).ticker, holder.ticker);
  }
  assert.equal(definedById.get(workTokenId).maxSupply, 21_000_000);
  assert.equal(definedById.get(powbTokenId).uncapped, true);
  assert.equal(definedById.get(incbTokenId).uncapped, true);
  assert.match(definitionQuery.text, /token_id = ANY\(\$2::text\[\]\)/u);
  assert.deepEqual(
    [...definitionQuery.params[1]].sort(),
    [workTokenId, powbTokenId, incbTokenId].sort(),
  );
  assert.equal(overlay.checkpointComplete, true);
  assert.equal(overlay.indexedThroughBlock, 957_926);
  assert.equal(overlay.indexedThroughBlockHash, blockHash);
  assert.equal(checkpointQueries, 2);
  const zeroBalanceScopedDefinitions = await proofIndexWalletTokenDefinitions(
    pool,
    "livenet",
    incbTokenId,
    [],
  );
  assert.equal(
    JSON.stringify(
      zeroBalanceScopedDefinitions.map((token) => [token.tokenId, token.ticker]),
    ),
    JSON.stringify([[incbTokenId, "INCB"]]),
  );
  assert.equal(overlay.network, "livenet");
  assert.equal(overlay.snapshotId, "wallet-checkpoint");
  assert.equal(overlay.sourceHashes.blockScan, blockHash);
  assert.equal(overlay.tokenScope, "all");
});

check("wallet scoped token payload deduplicates lifecycle rows before reserving balances", () => {
  const mergeTokenStateItemsByKey = (baseItems, overlayItems, keyForItem) => {
    const byKey = new Map();
    for (const item of [...baseItems, ...overlayItems]) {
      const key = keyForItem(item);
      if (key) {
        byKey.set(key, item);
      }
    }
    return [...byKey.values()];
  };
  const walletScopedTokenPayloadFromOverlay = isolatedFunction(
    API_PATH,
    "walletScopedTokenPayloadFromOverlay",
    {
      mergeTokenStateItemsByKey,
      mergedSourceLabel: (...values) => values.filter(Boolean).join("+"),
      normalizeTokenScope: (value) => String(value ?? "").trim().toLowerCase(),
      numericValue: (value) => Number(value) || 0,
      tokenClosedListingItemKey: (item) =>
        `${item.network}:${item.listingId}:${item.closedTxid}`,
      tokenListingItemKey: (item) => `${item.network}:${item.listingId}`,
      tokenSaleItemKey: (item) => item.txid,
      walletTokenPayloadWithCanonicalDefinitions: (payload) => payload,
    },
  );
  const payload = walletScopedTokenPayloadFromOverlay(
    {
      closedListings: [
        {
          closedTxid: "close-1",
          confirmed: true,
          listingId: "listing-1",
          network: "livenet",
        },
        {
          closedTxid: "close-1",
          confirmed: true,
          listingId: "listing-1",
          network: "livenet",
        },
      ],
      holders: [],
      invalidEvents: [],
      listings: [
        {
          amount: 5_000,
          confirmed: true,
          listingId: "listing-2",
          network: "livenet",
          status: "event",
        },
        {
          amount: 5_000,
          confirmed: true,
          listingId: "listing-2",
          network: "livenet",
          status: "active",
        },
      ],
      sales: [
        { confirmed: true, network: "livenet", txid: "sale-1" },
        { confirmed: true, network: "livenet", txid: "sale-1" },
      ],
      source: "proof-indexer-wallet-token-overlay",
      tokens: [],
      transfers: [],
    },
    "livenet",
    "all",
  );

  assert.equal(payload.listings.length, 1);
  assert.equal(payload.listings[0].amount, 5_000);
  assert.equal(payload.listings[0].status, "active");
  assert.equal(payload.closedListings.length, 1);
  assert.equal(payload.sales.length, 1);
  assert.equal(payload.stats.confirmedListings, 1);
  assert.equal(payload.stats.confirmedSales, 1);
});

check("wallet overlays cannot cross canonical checkpoints", () => {
  const walletTokenOverlayMatchesPayloadCheckpoint = isolatedFunction(
    API_PATH,
    "walletTokenOverlayMatchesPayloadCheckpoint",
    {
      proofIndexPayloadIndexedThroughBlock: (payload) =>
        Number(payload?.indexedThroughBlock),
      walletTokenOverlayHasExactCheckpoint: () => true,
    },
  );
  const blockHash = "8".repeat(64);
  const overlay = {
    indexedThroughBlock: 957_935,
    indexedThroughBlockHash: blockHash,
  };
  assert.equal(
    walletTokenOverlayMatchesPayloadCheckpoint(
      { indexedThroughBlock: 957_935, indexedThroughBlockHash: blockHash },
      overlay,
    ),
    true,
  );
  assert.equal(
    walletTokenOverlayMatchesPayloadCheckpoint(
      { indexedThroughBlock: 957_934, indexedThroughBlockHash: blockHash },
      overlay,
    ),
    false,
  );
  assert.equal(
    walletTokenOverlayMatchesPayloadCheckpoint(
      {
        indexedThroughBlock: 957_935,
        indexedThroughBlockHash: "9".repeat(64),
      },
      overlay,
    ),
    false,
  );
  assert.equal(
    walletTokenOverlayMatchesPayloadCheckpoint(
      { indexedThroughBlockHash: blockHash },
      overlay,
    ),
    false,
  );
  assert.equal(
    walletTokenOverlayMatchesPayloadCheckpoint(
      { indexedThroughBlock: 957_935 },
      overlay,
    ),
    false,
  );
});

check("fresh wallet overlays must match the exact canonical tip", () => {
  const walletTokenOverlayMatchesCanonicalGate = isolatedFunction(
    API_PATH,
    "walletTokenOverlayMatchesCanonicalGate",
    { walletTokenOverlayHasExactCheckpoint: () => true },
  );
  const blockHash = "8".repeat(64);
  const overlay = {
    indexedThroughBlock: 957_935,
    indexedThroughBlockHash: blockHash,
  };
  const exactGate = {
    canonicalHash: blockHash,
    indexedThroughBlock: 957_935,
    ready: true,
    storedHash: blockHash,
    tipHeight: 957_935,
  };
  assert.equal(
    walletTokenOverlayMatchesCanonicalGate(overlay, exactGate),
    true,
  );
  assert.equal(
    walletTokenOverlayMatchesCanonicalGate(overlay, {
      ...exactGate,
      ready: false,
    }),
    false,
  );
  assert.equal(
    walletTokenOverlayMatchesCanonicalGate(overlay, {
      ...exactGate,
      canonicalHash: "9".repeat(64),
    }),
    false,
  );
  assert.equal(
    walletTokenOverlayMatchesCanonicalGate(overlay, {
      ...exactGate,
      tipHeight: 957_936,
    }),
    false,
  );
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
    canonicalEventIdentityDetails: isolatedFunction(
      READER_PATH,
      "canonicalEventIdentityDetails",
    ),
    dateIso: (value) => new Date(value).toISOString(),
    eventPayloadParticipants: () => [],
    normalizeEventPayload: (payload) => payload,
    normalizedLowerText: (value) => String(value ?? "").trim().toLowerCase(),
    normalizedText: (value) => String(value ?? "").trim(),
    plausibleBitcoinEventTime: (...values) =>
      values.find((value) => Number.isFinite(Date.parse(value))),
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

check("canonical miner-fee coverage fails closed on partial normalized rows", async () => {
  const txid = "c".repeat(64);
  let activitySql = "";
  const proofIndexCanonicalActivityPayload = isolatedFunction(
    READER_PATH,
    "proofIndexCanonicalActivityPayload",
    {
      indexedThroughBlockFromItems: () => 957_950,
      latestProofIndexScanMetadata: async () => null,
      newestDateIso: () => "2026-07-13T23:14:00.000Z",
      normalizeHistoryEventRows: (rows) =>
        rows.map((row) => ({ confirmed: true, txid: row.txid })),
      normalizedTxid: (value) => String(value ?? "").trim().toLowerCase(),
      PUBLIC_LOG_EVENT_KINDS: new Set(["token-transfer"]),
      proofIndexPool: () => ({
        async query(sql) {
          activitySql = String(sql);
          return {
            rows: [
              {
                canonical_miner_fee_covered: true,
                canonical_miner_fee_sats: 846,
                status: "confirmed",
                txid,
              },
              {
                canonical_miner_fee_covered: false,
                status: "confirmed",
                txid,
              },
            ],
          };
        },
      }),
      rowNumber: () => 0,
    },
  );
  const activity = await proofIndexCanonicalActivityPayload("livenet");
  assert.equal(activity.canonicalMinerFeeCoverage.complete, false);
  assert.equal(
    activity.canonicalMinerFeeCoverage.missingConfirmedTransactions,
    1,
  );
  assert.equal(activity.canonicalMinerFeeCoverage.confirmedEvents, 2);
  assert.equal(activity.canonicalMinerFeeCoverage.coveredConfirmedEvents, 1);
  assert.equal(activity.canonicalMinerFeeCoverage.missingConfirmedEvents, 1);
  assert.deepEqual(
    Array.from(activity.canonicalMinerFeeCoverage.missingConfirmedTxids),
    [txid],
  );
  assert.match(
    activitySql,
    /jsonb_typeof\(\s*transaction_row\.raw_tx->'canonicalBlockScan'\s*\)\s*=\s*'object'/u,
  );
  assert.equal(
    (
      activitySql.match(
        /input_totals\.input_count\s*=\s*jsonb_array_length\(transaction_row\.raw_tx->'vin'\)/gu,
      ) ?? []
    ).length,
    2,
  );
  assert.match(
    activitySql,
    /output_totals\.output_count\s*=\s*jsonb_array_length\(\s*CASE[\s\S]*?raw_tx->'vout'[\s\S]*?ELSE '\[\]'::jsonb/u,
  );
  assert.match(
    activitySql,
    /COUNT\(o\.value_sats\)::integer AS valued_output_count/u,
  );
  assert.equal(
    (
      activitySql.match(
        /output_totals\.valued_output_count\s*=\s*output_totals\.output_count/gu,
      ) ?? []
    ).length,
    2,
  );
  assert.equal(
    (activitySql.match(/jsonb_exists\([\s\S]*?'coinbase'[\s\S]*?\)/gu) ?? [])
      .length,
    5,
  );
  assert.match(
    activitySql,
    /THEN CASE\s+WHEN jsonb_exists\([\s\S]*?'coinbase'[\s\S]*?\) THEN 0/u,
  );
  assert.equal(
    (
      activitySql.match(
        /NOT jsonb_exists\([\s\S]*?'coinbase'[\s\S]*?\)\s+AND\s+input_totals\.input_count > 0/gu,
      ) ?? []
    ).length,
    2,
  );
});

check("canonical coinbase activity is covered with a zero miner fee", async () => {
  const txid = "e".repeat(64);
  const proofIndexCanonicalActivityPayload = isolatedFunction(
    READER_PATH,
    "proofIndexCanonicalActivityPayload",
    {
      indexedThroughBlockFromItems: () => 957_950,
      latestProofIndexScanMetadata: async () => null,
      newestDateIso: () => "2026-07-13T23:14:00.000Z",
      normalizeHistoryEventRows: (rows) =>
        rows.map((row) => ({
          canonicalMinerFeeCovered:
            row.canonical_miner_fee_covered === true,
          confirmed: true,
          minerFeeSats: Number(row.canonical_miner_fee_sats),
          txid: row.txid,
        })),
      normalizedTxid: (value) => String(value ?? "").trim().toLowerCase(),
      PUBLIC_LOG_EVENT_KINDS: new Set(["token-transfer"]),
      proofIndexPool: () => ({
        async query() {
          return {
            rows: [
              {
                canonical_miner_fee_covered: true,
                canonical_miner_fee_sats: 0,
                status: "confirmed",
                txid,
              },
            ],
          };
        },
      }),
      rowNumber: () => 0,
    },
  );
  const activity = await proofIndexCanonicalActivityPayload("livenet");
  assert.equal(activity.canonicalMinerFeeCoverage.complete, true);
  assert.equal(activity.canonicalMinerFeeCoverage.confirmedEvents, 1);
  assert.equal(activity.canonicalMinerFeeCoverage.confirmedTransactions, 1);
  assert.equal(activity.activity[0].canonicalMinerFeeCovered, true);
  assert.equal(activity.activity[0].minerFeeSats, 0);
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
      canonicalSummaryAccountingModelsCurrent: () => true,
      canonicalSummaryCoverage: () => 957_641,
      objectPayload: (value) =>
        value && typeof value === "object" && !Array.isArray(value)
          ? value
          : null,
    },
  );
  const payload = {
    checks: [],
    indexedThroughBlockHash: "b".repeat(64),
    ok: true,
    sourceHashes: { canonicalSummary: "a".repeat(64) },
    status: "green",
    summaryPayloads: {},
    summaryRefresh: {
      indexedThroughBlockHash: "b".repeat(64),
      mode: "canonical-summary-refresh",
    },
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
  assert.equal(eligibleCanonicalSummarySnapshotPayload(payload), false);
  payload.checks.push({
    name: "inception-live-issuance-matches-incb-supply",
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
      INCB_TOKEN_ID: "incb",
      INCEPTION_ATTACHMENT_ACCOUNTING_MODEL:
        "canonical-pre-bond-live-network-value-v2",
      TOKEN_MARKETPLACE_MUTATION_KINDS: new Set(["token-listing"]),
      activityAmountSats: (item) => Number(item?.amountSats ?? 0),
      attachLedgerMetadata: (payload) => payload,
      bondAttachedWorkValueDetails: () => ({
        attachedWorkActions: 0,
        attachedWorkAmount: 0,
        attachedWorkFrozenValueByTxid: new Map(),
        attachedWorkFrozenValueSats: 0,
        attachedWorkLiveValueSats: 0,
        attachedWorkUnmatchedActions: 0,
        attachedWorkUnvaluedActions: 0,
      }),
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

check("Inception joins an exact same-transaction WORK attachment into frozen and live value", () => {
  const INCB_TOKEN_ID = "incb";
  const INCEPTION_ISSUANCE_ACCOUNTING_MODEL =
    "canonical-pre-bond-live-network-value-v2";
  const INCEPTION_VALUE_SNAPSHOT_MODEL =
    "canonical-summary-h-minus-one-v1";
  const WORK_TOKEN_ID = "work";
  const WORK_TOKEN_MAX_SUPPLY = 21_000_000;
  const txid = "d".repeat(64);
  const blockHash = "e".repeat(64);
  const blockHeight = 957_950;
  const blockIndex = 382;
  const recipientAddress = "bc1inceptionrecipient";
  const numericValue = (value) => {
    const number = Number(value);
    return Number.isFinite(number) ? number : 0;
  };
  const ledgerTokenStateForScope = (ledger, tokenId) =>
    tokenId === WORK_TOKEN_ID ? ledger.workTokenState : ledger.tokenState;
  const canonicalEventOrdinal = isolatedFunction(
    API_PATH,
    "canonicalEventOrdinal",
  );
  const inceptionAttachmentMatchesForBond = isolatedFunction(
    API_PATH,
    "inceptionAttachmentMatchesForBond",
    {
      WORK_TOKEN_ID,
      canonicalEventOrdinal,
      ledgerTokenStateForScope,
      numericValue,
      samePaymentAddress: (left, right) =>
        String(left).toLowerCase() === String(right).toLowerCase(),
    },
  );
  const inceptionIssuanceMetadataFromMints = isolatedFunction(
    API_PATH,
    "inceptionIssuanceMetadataFromMints",
    {
      INCB_TOKEN_ID,
      INCEPTION_ISSUANCE_ACCOUNTING_MODEL,
      INCEPTION_VALUE_SNAPSHOT_MODEL,
      WORK_TOKEN_MAX_SUPPLY,
      numbersAgree: (left, right, tolerance = 0) =>
        Math.abs(Number(left) - Number(right)) <= tolerance,
      numericValue,
      samePaymentAddress: (left, right) =>
        String(left).toLowerCase() === String(right).toLowerCase(),
    },
  );
  const bondAttachedWorkValueDetails = isolatedFunction(
    API_PATH,
    "bondAttachedWorkValueDetails",
    {
      INCB_TOKEN_ID,
      Map,
      WORK_TOKEN_ID,
      inceptionAttachmentMatchesForBond,
      inceptionIssuanceMetadataFromMints,
      ledgerTokenStateForScope,
      numericValue,
      samePaymentAddress: (left, right) =>
        String(left).toLowerCase() === String(right).toLowerCase(),
    },
  );
  const isBondActivityItem = (item, config) => item?.kind === config.kind;
  const activityAmountSats = (item) => numericValue(item?.amountSats);
  const infinityBondChartPointsFromEvents = isolatedFunction(
    API_PATH,
    "infinityBondChartPointsFromEvents",
    {
      INFINITY_BOND_CONFIG: {},
      Map,
      activityAmountSats,
      canonicalTokenReplayOrdinal: (item) =>
        Number(item?.protocolVout ?? Number.MAX_SAFE_INTEGER),
      isBondActivityItem,
      numericValue,
    },
  );
  const bondSummaryPayloadFromLedger = isolatedFunction(
    API_PATH,
    "bondSummaryPayloadFromLedger",
    {
      INCB_TOKEN_ID,
      INCEPTION_ISSUANCE_ACCOUNTING_MODEL,
      INCEPTION_ATTACHMENT_ACCOUNTING_MODEL:
        INCEPTION_ISSUANCE_ACCOUNTING_MODEL,
      TOKEN_MARKETPLACE_MUTATION_KINDS: new Set([
        "token-listing",
        "token-listing-sealed",
        "token-listing-closed",
      ]),
      activityAmountSats,
      attachLedgerMetadata: (payload) => payload,
      bondAttachedWorkValueDetails,
      btcUsdResponseMetadata: () => ({ btcUsd: 0 }),
      compactTokenSummaryPayload: (state) => state,
      infinityBondChartPointsFromEvents,
      inceptionIssuanceMetadataFromMints,
      isBondActivityItem,
      ledgerTokenStateForScope,
      numericValue,
      satsToUsdAtBtcUsd: () => 0,
    },
  );
  const config = {
    kind: "inception-bond",
    registryId: "inception@proofofwork.me",
    ticker: "INCB",
    tokenId: INCB_TOKEN_ID,
  };
  const bond = {
    amountSats: 546,
    attachedCredits: [
      {
        amount: 100,
        protocolVout: 3,
        recipientAddress,
        tokenId: WORK_TOKEN_ID,
      },
    ],
    confirmed: true,
    createdAt: "2026-07-13T03:14:00.000Z",
    blockHash,
    blockHeight,
    blockIndex,
    kind: config.kind,
    recipients: [{ address: recipientAddress, amountSats: 546, vout: 0 }],
    txid,
  };
  const inceptionMint = ({
    attachedWorkAmount = 100,
    attachedWorkLiveValueAtSendSats = 200,
  } = {}) => {
    const issuanceNetworkValueSats =
      546 + attachedWorkLiveValueAtSendSats;
    const confirmedIssuanceUnits = Math.floor(issuanceNetworkValueSats);
    return {
      amount: confirmedIssuanceUnits,
      amountSats: 0,
      attachedWorkAmount,
      attachedWorkLiveFloorAtSendSats:
        attachedWorkAmount > 0
          ? attachedWorkLiveValueAtSendSats / attachedWorkAmount
          : 0,
      attachedWorkIssuanceUnits: confirmedIssuanceUnits - 546,
      attachedWorkLiveValueAtSendSats,
      bondRecipientAddress: recipientAddress,
      bondRecipientAmountSats: 546,
      bondRecipientVout: 0,
      blockHash,
      blockHeight,
      blockIndex,
      confirmed: true,
      confirmedIssuanceUnits,
      directProofIssuanceUnits: 546,
      issuanceAccountingModel: INCEPTION_ISSUANCE_ACCOUNTING_MODEL,
      issuanceAmount: confirmedIssuanceUnits,
      issuanceCheckpointBlockHash: blockHash,
      issuanceCheckpointBlockHeight: blockHeight,
      issuanceCheckpointBlockIndex: blockIndex,
      issuanceCheckpointMode: "bond-transaction-provenance",
      issuanceValueSnapshotBlockHash: "f".repeat(64),
      issuanceValueSnapshotBlockHeight: blockHeight - 1,
      issuanceValueSnapshotCanonicalSummaryHash: "a".repeat(64),
      issuanceValueSnapshotGeneratedAt: "2026-07-13T03:13:00.000Z",
      issuanceValueSnapshotId: "snapshot-before-bond",
      issuanceValueSnapshotMode: "canonical-summary-refresh",
      issuanceValueSnapshotModel: INCEPTION_VALUE_SNAPSHOT_MODEL,
      issuanceValueSnapshotWorkNetworkValueSats:
        (attachedWorkLiveValueAtSendSats / attachedWorkAmount) *
        WORK_TOKEN_MAX_SUPPLY,
      issuanceDustSats:
        issuanceNetworkValueSats - confirmedIssuanceUnits,
      issuanceFloorSats:
        issuanceNetworkValueSats / confirmedIssuanceUnits,
      issuanceNetworkValueSats,
      issuanceUnitSats: 1,
      issuanceValuationFixedAtSend: true,
      minterAddress: recipientAddress,
      paidSats: 546,
      proofPaymentSats: 546,
      sourceBondTxid: txid,
      ticker: "INCB",
      tokenId: INCB_TOKEN_ID,
      txid,
      validationMode: "canonical-incb-bond-projection",
    };
  };
  const canonicalMint = inceptionMint();
  const summary = bondSummaryPayloadFromLedger(
    {
      activity: [bond],
      generatedAt: "2026-07-13T03:15:00.000Z",
      network: "livenet",
      tokenState: {
        confirmedSupply: 746,
        holders: [{ address: recipientAddress, balance: 746 }],
        listings: [],
        mints: [canonicalMint],
        pendingSupply: 0,
        sales: [],
        source: "fixture",
        tokens: [
          {
            registryAddress: "bc1inceptionregistry",
            tokenId: INCB_TOKEN_ID,
          },
        ],
        transfers: [],
      },
      workFloor: { liveFloorSats: 3 },
      workTokenState: {
        transfers: [
          {
            amount: 100,
            blockHash,
            blockHeight,
            blockIndex,
            confirmed: true,
            creditFloorAtConfirmSats: 2,
            creditLiveFloorSats: 99,
            creditLiveValueSats: 9_900,
            creditValueAtConfirmSats: 200,
            protocolVout: 3,
            recipientAddress,
            tokenId: WORK_TOKEN_ID,
            txid,
            valid: true,
          },
          {
            amount: 25,
            blockHash,
            blockHeight,
            blockIndex,
            confirmed: true,
            creditFloorAtConfirmSats: 2,
            creditLiveFloorSats: 3,
            protocolVout: 4,
            recipientAddress,
            tokenId: WORK_TOKEN_ID,
            txid,
            valid: true,
          },
          {
            amount: 100,
            blockHash,
            blockHeight,
            blockIndex,
            confirmed: true,
            creditFloorAtConfirmSats: 2,
            creditLiveFloorSats: 3,
            protocolVout: 5,
            recipientAddress: "bc1wrongrecipient",
            tokenId: WORK_TOKEN_ID,
            txid,
            valid: true,
          },
        ],
      },
    },
    config,
  );

  assert.equal(summary.actualValue.attachedWorkActions, 1);
  assert.equal(summary.actualValue.attachedWorkAmount, 100);
  assert.equal(summary.actualValue.attachedWorkFrozenValueSats, 200);
  assert.equal(summary.actualValue.attachedWorkLiveValueSats, 300);
  assert.equal(summary.actualValue.baseNetworkValueSats, 546);
  assert.equal(
    summary.actualValue.attachmentAccountingModel,
    INCEPTION_ISSUANCE_ACCOUNTING_MODEL,
  );
  assert.equal(
    summary.actualValue.issuanceAccountingModel,
    INCEPTION_ISSUANCE_ACCOUNTING_MODEL,
  );
  assert.equal(summary.actualValue.confirmedIssuanceUnits, 746);
  assert.equal(summary.actualValue.directProofIssuanceUnits, 546);
  assert.equal(summary.actualValue.attachedWorkIssuanceUnits, 200);
  assert.equal(summary.actualValue.issuanceNetworkValueSats, 746);
  assert.equal(summary.actualValue.issuanceFloorSats, 1);
  assert.equal(summary.actualValue.frozenNetworkValueSats, 746);
  assert.equal(summary.actualValue.liveNetworkValueSats, 846);
  assert.equal(summary.frozenNetworkValueSats, 746);
  assert.equal(summary.liveNetworkValueSats, 846);
  assert.equal(summary.networkValueSats, 846);
  assert.equal(summary.frozenFloorSats, 1);
  assert.ok(Math.abs(summary.liveFloorSats - 846 / 746) < 1e-12);
  assert.equal(summary.chartPoints.length, 1);
  assert.equal(summary.chartPoints[0].networkValueSats, 746);
  assert.equal(summary.chartPoints[0].confirmedSupply, 746);
  assert.equal(summary.chartPoints[0].floorSats, 1);

  const partial = bondAttachedWorkValueDetails(
    {
      tokenState: { mints: [canonicalMint] },
      workFloor: { liveFloorSats: 3 },
      workTokenState: {
        transfers: [
          {
            amount: 100,
            blockHash,
            blockHeight,
            blockIndex,
            confirmed: true,
            creditLiveValueSats: 300,
            creditValueAtConfirmSats: 200,
            protocolVout: 3,
            recipientAddress,
            tokenId: WORK_TOKEN_ID,
            txid,
            valid: true,
          },
        ],
      },
    },
    [
      {
        ...bond,
        attachedCredits: [
          ...bond.attachedCredits,
          {
            amount: 999,
            recipientAddress,
            tokenId: WORK_TOKEN_ID,
          },
        ],
      },
    ],
    config,
  );
  assert.equal(partial.attachedWorkActions, 0);
  assert.equal(partial.attachedWorkUnvaluedActions, 2);
  assert.equal(
    partial.attachedWorkUnmatchedActions,
    1,
    "every declared WORK attachment must match one exact same-tx transfer",
  );

  const duplicateAttachments = bondAttachedWorkValueDetails(
    {
      tokenState: {
        mints: [
          inceptionMint({
            attachedWorkAmount: 200,
            attachedWorkLiveValueAtSendSats: 400,
          }),
        ],
      },
      workFloor: { liveFloorSats: 3 },
      workTokenState: {
        transfers: [2, 3].map((protocolVout, index) => ({
          _powEventIndex: index + 10,
          amount: 100,
          blockHash,
          blockHeight,
          blockIndex,
          confirmed: true,
          creditLiveValueSats: 300,
          creditValueAtConfirmSats: 200,
          protocolVout,
          recipientAddress,
          tokenId: WORK_TOKEN_ID,
          txid,
          valid: true,
        })),
      },
    },
    [
      {
        ...bond,
        attachedCredits: [2, 3].map((protocolVout) => ({
          amount: 100,
          protocolVout,
          recipientAddress,
          tokenId: WORK_TOKEN_ID,
        })),
      },
    ],
    config,
  );
  assert.equal(duplicateAttachments.attachedWorkActions, 2);
  assert.equal(duplicateAttachments.attachedWorkAmount, 200);
  assert.equal(duplicateAttachments.attachedWorkFrozenValueSats, 400);
  assert.equal(duplicateAttachments.attachedWorkLiveValueSats, 600);
  assert.equal(duplicateAttachments.attachedWorkUnmatchedActions, 0);
  assert.equal(duplicateAttachments.attachedWorkUnvaluedActions, 0);

  const readerIdentityDetails = isolatedFunction(
    READER_PATH,
    "canonicalEventIdentityDetails",
  );
  const rowNumber = (row, key) => {
    const number = Number(row?.[key]);
    return Number.isFinite(number) ? number : 0;
  };
  const tokenTransferFromEventPayload = isolatedFunction(
    READER_PATH,
    "tokenTransferFromEventPayload",
    {
      canonicalEventIdentityDetails: readerIdentityDetails,
      dateIso: (value) => value,
      rowNumber,
      tokenRegistryAddressFromPayload: () => "bc1workregistry",
      tokenTransferAmountFromTags: () => 0,
    },
  );
  const apiIdentityDetails = isolatedFunction(
    API_PATH,
    "canonicalEventIdentityDetails",
  );
  const tokenTransferFromIndexedActivityItem = isolatedFunction(
    API_PATH,
    "tokenTransferFromIndexedActivityItem",
    {
      canonicalEventIdentityDetails: apiIdentityDetails,
      canonicalMinerFeeDetailsFromActivity: () => ({}),
      creditAmountFromActivityItem: (item) => numericValue(item?.amount),
      indexedActivityValue: (item, ...keys) =>
        keys.map((key) => item?.[key]).find(Boolean) ?? "",
      numericValue,
    },
  );
  const mailAttachedCreditsFromRecord = isolatedFunction(
    API_PATH,
    "mailAttachedCreditsFromRecord",
    {
      TOKEN_MIN_MUTATION_PRICE_SATS: 546,
      WORK_TOKEN_DEFAULT_REGISTRY_ADDRESS: "bc1workregistry",
      WORK_TOKEN_ID,
      WORK_TOKEN_TICKER: "WORK",
      canonicalEventIdentityDetails: apiIdentityDetails,
      isValidBitcoinAddress: () => true,
      normalizeTokenTicker: (value) => String(value).trim().toUpperCase(),
      numericValue,
    },
  );
  const pipelineTransfers = [2, 3].map((protocolVout, index) => {
    const readerTransfer = tokenTransferFromEventPayload(
      {
        _powEventIndex: index + 20,
        amount: 100,
        creditLiveValueSats: 300,
        creditValueAtConfirmSats: 200,
        eventKeyVout: index,
        protocolVout,
        recipientAddress,
        senderAddress: "bc1sender",
        ticker: "WORK",
        tokenId: WORK_TOKEN_ID,
        txid,
      },
      { event_id: index + 100, network: "livenet", status: "confirmed" },
    );
    return tokenTransferFromIndexedActivityItem(
      readerTransfer,
      {
        registryAddress: "bc1workregistry",
        ticker: "WORK",
        tokenId: WORK_TOKEN_ID,
      },
      "livenet",
    );
  });
  const pipelineAttachedCredits = mailAttachedCreditsFromRecord(
    {
      attachedCredits: [2, 3].map((protocolVout, index) => ({
        _powEventIndex: index + 30,
        amount: 100,
        protocolVout,
        recipientAddress,
        ticker: "WORK",
        tokenId: WORK_TOKEN_ID,
      })),
    },
    "livenet",
  );
  assert.deepEqual(
    pipelineTransfers.map((transfer) => [
      transfer?._powEventIndex,
      transfer?.eventKeyVout,
      transfer?.protocolVout,
      transfer?.eventId,
    ]),
    [
      [20, 0, 2, 100],
      [21, 1, 3, 101],
    ],
  );
  assert.deepEqual(
    pipelineAttachedCredits.map((credit) => credit.protocolVout),
    [2, 3],
  );
  const tokenTransferHistoryItemKey = isolatedFunction(
    API_PATH,
    "tokenTransferHistoryItemKey",
    { numericValue },
  );
  const tokenMintHistoryItemKey = isolatedFunction(
    API_PATH,
    "tokenMintHistoryItemKey",
    { numericValue },
  );
  const tokenValueStateSource = topLevelFunctionSource(
    API_PATH,
    "tokenValueStateFromIndexedActivity",
  );
  assert.match(
    tokenValueStateSource,
    /mints\.push\(\{\s*\.\.\.canonicalEventIdentityDetails\(item\),/u,
    "activity-derived mints must preserve the canonical event identity used by token-table mints",
  );
  const tokenHistoryPageItemKey = isolatedFunction(
    API_PATH,
    "tokenHistoryPageItemKey",
    { tokenMintHistoryItemKey, tokenTransferHistoryItemKey },
  );
  assert.equal(
    new Set(
      pipelineTransfers.map((transfer) =>
        tokenHistoryPageItemKey(transfer, "transfers"),
      ),
    ).size,
    2,
  );
  const mergeTokenStateItemsByKey = isolatedFunction(
    API_PATH,
    "mergeTokenStateItemsByKey",
    { compareTokenHistoryPageItems: () => 0 },
  );
  const mintTxid = "9".repeat(64);
  const indexedMint = {
    _powEventIndex: 7,
    amount: 100,
    minterAddress: "bc1minter",
    tokenId: WORK_TOKEN_ID,
    txid: mintTxid,
  };
  const reconstructedMint = {
    ...apiIdentityDetails(indexedMint),
    amount: indexedMint.amount,
    minterAddress: indexedMint.minterAddress,
    tokenId: indexedMint.tokenId,
    txid: indexedMint.txid,
  };
  assert.equal(
    mergeTokenStateItemsByKey(
      [indexedMint],
      [reconstructedMint],
      tokenMintHistoryItemKey,
    ).length,
    1,
    "the activity and exact token-table views of one mint must merge once",
  );
  const tokenStateWithScopedTokenOverride = isolatedFunction(
    API_PATH,
    "tokenStateWithScopedTokenOverride",
    {
      mergeTokenListingRecord: (current, incoming) => current ?? incoming,
      mergeTokenStateItemsByKey,
      mergeTokenTransferRecord: (current, incoming) => current ?? incoming,
      tokenClosedListingItemKey: (item) => item?.listingId ?? "",
      tokenListingItemKey: (item) => item?.listingId ?? "",
      tokenMintHistoryItemKey,
      tokenSaleItemKey: (item) => item?.txid ?? "",
      tokenStateWithPendingStats: (state) => state,
      tokenTransferHistoryItemKey,
    },
  );
  const scopedPipelineState = tokenStateWithScopedTokenOverride(
    { tokens: [], transfers: [] },
    {
      tokens: [{ ticker: "WORK", tokenId: WORK_TOKEN_ID }],
      transfers: pipelineTransfers,
    },
    WORK_TOKEN_ID,
  );
  assert.equal(scopedPipelineState.transfers.length, 2);
  const normalizedPipelineAttachments = bondAttachedWorkValueDetails(
    {
      tokenState: {
        mints: [
          inceptionMint({
            attachedWorkAmount: 200,
            attachedWorkLiveValueAtSendSats: 400,
          }),
        ],
      },
      workFloor: { liveFloorSats: 3 },
      workTokenState: { transfers: scopedPipelineState.transfers },
    },
    [{ ...bond, attachedCredits: pipelineAttachedCredits }],
    config,
  );
  assert.equal(normalizedPipelineAttachments.attachedWorkActions, 2);
  assert.equal(normalizedPipelineAttachments.attachedWorkAmount, 200);
  assert.equal(normalizedPipelineAttachments.attachedWorkUnmatchedActions, 0);
  assert.equal(normalizedPipelineAttachments.attachedWorkUnvaluedActions, 0);
});

check("Inception issuance floors the pre-bond live WORK network value once", () => {
  const INCB_TOKEN_ID = "incb";
  const INCEPTION_ISSUANCE_ACCOUNTING_MODEL =
    "canonical-pre-bond-live-network-value-v2";
  const INCEPTION_VALUE_SNAPSHOT_MODEL =
    "canonical-summary-h-minus-one-v1";
  const WORK_TOKEN_ID = "work";
  const WORK_TOKEN_MAX_SUPPLY = 21_000_000;
  const txid =
    "dd743fb69c519200cc190627219ba34ca2e63e6893e600b73e9aee8d4dac8fa4";
  const blockHash =
    "000000000000000000016ea78b0d57a7979de3542518c8690a1e5a808e691cc5";
  const blockHeight = 957_950;
  const blockIndex = 382;
  const recipientAddress = "bc1inceptiontarget";
  const numericValue = (value) => {
    const number = Number(value);
    return Number.isFinite(number) ? number : 0;
  };
  const samePaymentAddress = (left, right) =>
    String(left).toLowerCase() === String(right).toLowerCase();
  const ledgerTokenStateForScope = (ledger, tokenId) =>
    tokenId === WORK_TOKEN_ID ? ledger.workTokenState : ledger.tokenState;
  const canonicalEventOrdinal = isolatedFunction(
    API_PATH,
    "canonicalEventOrdinal",
  );
  const inceptionAttachmentMatchesForBond = isolatedFunction(
    API_PATH,
    "inceptionAttachmentMatchesForBond",
    {
      WORK_TOKEN_ID,
      canonicalEventOrdinal,
      ledgerTokenStateForScope,
      numericValue,
      samePaymentAddress,
    },
  );
  const inceptionIssuanceCheckpoint = isolatedFunction(
    API_PATH,
    "inceptionIssuanceCheckpoint",
    {
      INCEPTION_VALUE_SNAPSHOT_MODEL,
      inceptionPreBondLiveNetworkValueSats: () => 0,
      numericValue,
    },
  );
  const inceptionMintsWithLiveIssuance = isolatedFunction(
    API_PATH,
    "inceptionMintsWithLiveIssuance",
    {
      INCB_TOKEN_ID,
      INCEPTION_ISSUANCE_ACCOUNTING_MODEL,
      Map,
      WORK_TOKEN_MAX_SUPPLY,
      inceptionAttachmentMatchesForBond,
      inceptionIssuanceCheckpoint,
      canonicalEventOrdinal,
      isInceptionBondActivityItem: (item) =>
        item?.kind === "inception-bond",
      numericValue,
      samePaymentAddress,
    },
  );
  const bond = {
    amountSats: 546,
    attachedCredits: [
      {
        amount: 3_644_060,
        protocolVout: 3,
        recipientAddress,
        tokenId: WORK_TOKEN_ID,
      },
    ],
    confirmed: true,
    blockHash,
    blockHeight,
    blockIndex,
    createdAt: "2026-07-14T03:09:35.000Z",
    kind: "inception-bond",
    recipients: [{ address: recipientAddress, amountSats: 546 }],
    txid,
  };
  const preBondWorkNetworkValueSats = 8_193_547_095.322113;
  const workFloorAtSend = 390.168909301053;
  const publishedCheckpoint = {
    blockHash,
    blockHeight,
    blockIndex,
    valueSnapshotBlockHash:
      "00000000000000000001bda6bfa328f15edf597bfc364e02da42ea92a518a15e",
    valueSnapshotBlockHeight: blockHeight - 1,
    valueSnapshotCanonicalSummaryHash:
      "4f00b3494afb46ef88990948784a0ba8f2a22856615a39e15c3131f0ec979bdc",
    valueSnapshotGeneratedAt: "2026-07-14T03:03:04.765Z",
    valueSnapshotId: "b8e77cd30cbed6855977c514",
    valueSnapshotMode: "canonical-summary-refresh",
    valueSnapshotModel: INCEPTION_VALUE_SNAPSHOT_MODEL,
    workNetworkValueSats: preBondWorkNetworkValueSats,
  };
  const sourceMint = {
    amount: 546,
    blockHash,
    blockHeight,
    blockIndex,
    confirmed: true,
    createdAt: bond.createdAt,
    minterAddress: recipientAddress,
    paidSats: 546,
    tokenId: INCB_TOKEN_ID,
    txid,
  };
  const sourceTransfer = {
    amount: 3_644_060,
    blockHash,
    blockHeight,
    blockIndex,
    confirmed: true,
    protocolVout: 3,
    recipientAddress,
    tokenId: WORK_TOKEN_ID,
    txid,
    valid: true,
  };
  const [mint] = inceptionMintsWithLiveIssuance(
    [sourceMint],
    [bond],
    {
      activity: [bond],
      tokenState: {},
      workTokenState: {
        transfers: [sourceTransfer],
      },
    },
    {
      preBondCheckpoint: () => publishedCheckpoint,
    },
  );
  const exactIssuance = 546 + 3_644_060 * workFloorAtSend;

  assert.equal(mint.amount, 1_421_799_461);
  assert.equal(mint.issuanceAmount, 1_421_799_461);
  assert.equal(mint.confirmedIssuanceUnits, 1_421_799_461);
  assert.equal(mint.directProofIssuanceUnits, 546);
  assert.equal(mint.attachedWorkAmount, 3_644_060);
  assert.equal(mint.attachedWorkIssuanceUnits, 1_421_798_915);
  assert.ok(
    Math.abs(mint.attachedWorkLiveFloorAtSendSats - workFloorAtSend) < 1e-12,
  );
  assert.ok(
    Math.abs(
      mint.attachedWorkLiveValueAtSendSats - 1_421_798_915.6275952,
    ) < 1e-6,
  );
  assert.ok(Math.abs(mint.issuanceNetworkValueSats - exactIssuance) < 1e-6);
  assert.ok(
    Math.abs(mint.issuanceDustSats - (exactIssuance - Math.floor(exactIssuance))) <
      1e-6,
  );
  assert.ok(
    Math.abs(
      mint.issuanceFloorSats - exactIssuance / Math.floor(exactIssuance),
    ) < 1e-12,
  );
  assert.equal(
    mint.issuanceAccountingModel,
    INCEPTION_ISSUANCE_ACCOUNTING_MODEL,
  );
  assert.equal(
    mint.issuanceCheckpointMode,
    "bond-transaction-provenance",
  );
  assert.equal(mint.issuanceValuationFixedAtSend, true);
  assert.equal(mint.issuanceUnitSats, 1);
  assert.equal(mint.amountSats, 0);
  assert.equal(mint.bondRecipientAddress, recipientAddress);
  assert.equal(mint.bondRecipientAmountSats, 546);
  assert.equal(mint.bondRecipientVout, 0);
  assert.equal(mint.proofPaymentSats, 546);
  assert.equal(mint.sourceBondTxid, txid);
  assert.equal(mint.validationMode, "canonical-incb-bond-projection");
  assert.equal(mint.issuanceCheckpointBlockHeight, blockHeight);
  assert.equal(mint.issuanceCheckpointBlockHash, blockHash);
  assert.equal(mint.issuanceCheckpointBlockIndex, blockIndex);
  assert.equal(
    mint.issuanceValueSnapshotWorkNetworkValueSats,
    preBondWorkNetworkValueSats,
  );
  assert.equal(
    mint.issuanceValueSnapshotBlockHash,
    "00000000000000000001bda6bfa328f15edf597bfc364e02da42ea92a518a15e",
  );
  assert.equal(mint.issuanceValueSnapshotBlockHeight, blockHeight - 1);
  assert.equal(
    mint.issuanceValueSnapshotCanonicalSummaryHash,
    "4f00b3494afb46ef88990948784a0ba8f2a22856615a39e15c3131f0ec979bdc",
  );
  assert.equal(
    mint.issuanceValueSnapshotGeneratedAt,
    "2026-07-14T03:03:04.765Z",
  );
  assert.equal(mint.issuanceValueSnapshotId, "b8e77cd30cbed6855977c514");
  assert.equal(mint.issuanceValueSnapshotMode, "canonical-summary-refresh");
  assert.equal(
    mint.issuanceValueSnapshotModel,
    INCEPTION_VALUE_SNAPSHOT_MODEL,
  );

  const inceptionMintHasCanonicalBondBinding = isolatedFunction(
    API_PATH,
    "inceptionMintHasCanonicalBondBinding",
    {
      INCEPTION_ISSUANCE_ACCOUNTING_MODEL,
      canonicalEventOrdinal,
      inceptionIssuanceMetadataFromMints: () => ({ complete: true }),
      numericValue,
      samePaymentAddress,
    },
  );
  const immutableIssuance = isolatedFunction(
    API_PATH,
    "inceptionMintsWithLiveIssuance",
    {
      INCB_TOKEN_ID,
      INCEPTION_ISSUANCE_ACCOUNTING_MODEL,
      Map,
      WORK_TOKEN_MAX_SUPPLY,
      canonicalEventOrdinal,
      inceptionAttachmentMatchesForBond,
      inceptionIssuanceCheckpoint,
      inceptionMintHasCanonicalBondBinding,
      isInceptionBondActivityItem: (item) => item?.kind === "inception-bond",
      numbersAgree: (left, right, tolerance = 0) =>
        Math.abs(Number(left) - Number(right)) <= tolerance,
      numericValue,
      samePaymentAddress,
    },
  );
  assert.strictEqual(
    immutableIssuance([mint], [bond], {
      tokenState: {},
      workTokenState: { transfers: [sourceTransfer] },
    }, {
      preBondCheckpoint: () => publishedCheckpoint,
    })[0],
    mint,
    "a complete bound v2 mint must never be repriced",
  );
  const [oracleMismatch] = immutableIssuance(
    [mint],
    [bond],
    {
      network: "livenet",
      tokenState: {},
      workTokenState: { transfers: [sourceTransfer] },
    },
    {
      preBondCheckpoint: () => ({
        ...publishedCheckpoint,
        workNetworkValueSats: preBondWorkNetworkValueSats * 10,
      }),
    },
  );
  assert.equal(oracleMismatch.issuanceValueSnapshotModel, "");
  assert.equal(
    oracleMismatch.validationMode,
    "canonical-incb-value-snapshot-mismatch",
  );

  const [unproven] = inceptionMintsWithLiveIssuance(
    [{ ...sourceMint, blockHash: "" }],
    [bond],
    {
      activity: [bond],
      tokenState: {},
      workTokenState: { transfers: [sourceTransfer] },
    },
    {
      preBondCheckpoint: () => publishedCheckpoint,
    },
  );
  assert.equal(unproven.amount, 546);
  assert.equal(unproven.issuanceAccountingModel, undefined);
});

check("pre-bond live value uses canonical position without timestamp override", () => {
  const blockHash = "a".repeat(64);
  const bondTxid = "b".repeat(64);
  const canonicalItemPrecedesBondTransaction = isolatedFunction(
    API_PATH,
    "canonicalItemPrecedesBondTransaction",
  );
  const inceptionPreBondLiveNetworkValueSats = isolatedFunction(
    API_PATH,
    "inceptionPreBondLiveNetworkValueSats",
    {
      Number,
      canonicalItemPrecedesBondTransaction,
      growthActualLiveTotalSatsAtProvider: (...collections) => () =>
        collections.flat().reduce((total, item) => total + item.value, 0),
      numericValue: (value) => Number(value) || 0,
    },
  );
  const bond = {
    blockHash,
    blockHeight: 100,
    blockIndex: 5,
    confirmed: true,
    createdAt: "2026-01-01T00:00:00.000Z",
    network: "livenet",
    txid: bondTxid,
  };
  const item = (value, overrides = {}) => ({
    blockHash,
    blockHeight: 100,
    blockIndex: 4,
    confirmed: true,
    createdAt: "2030-01-01T00:00:00.000Z",
    network: "livenet",
    txid: String(value).padStart(64, "0"),
    value,
    ...overrides,
  });
  const ledger = {
    activity: [
      item(2, { blockHeight: 99, blockIndex: 999 }),
      item(100, { blockIndex: 6 }),
      item(200, { txid: bondTxid, blockIndex: 1 }),
      item(400, {
        blockHash: undefined,
        blockHeight: undefined,
        blockIndex: undefined,
        createdAt: "1990-01-01T00:00:00.000Z",
      }),
      item(800, { blockHash: "c".repeat(64), blockIndex: 3 }),
    ],
    registryState: {
      records: [item(1)],
      sales: [item(4)],
    },
    tokenState: {
      mints: [item(16)],
      sales: [item(64)],
      tokens: [item(8)],
      transfers: [item(32)],
    },
  };
  assert.equal(
    inceptionPreBondLiveNetworkValueSats(ledger, bond),
    1 + 2 + 4 + 8 + 16 + 32 + 64,
  );
  assert.equal(
    canonicalItemPrecedesBondTransaction(
      item(1, { blockIndex: 3, createdAt: "2035-01-01T00:00:00.000Z" }),
      bond,
    ),
    true,
    "same-block earlier index wins even when timestamps regress",
  );

  const canonicalEventOrdinal = isolatedFunction(
    API_PATH,
    "canonicalEventOrdinal",
  );
  const samePaymentAddress = (left, right) =>
    String(left).toLowerCase() === String(right).toLowerCase();
  const inceptionAttachmentMatchesForBond = isolatedFunction(
    API_PATH,
    "inceptionAttachmentMatchesForBond",
    {
      WORK_TOKEN_ID: "work",
      canonicalEventOrdinal,
      ledgerTokenStateForScope: (state, scope) =>
        scope === "work" ? state.workTokenState : state.tokenState,
      numericValue: (value) => Number(value) || 0,
      samePaymentAddress,
    },
  );
  const inceptionIssuanceCheckpoint = isolatedFunction(
    API_PATH,
    "inceptionIssuanceCheckpoint",
    {
      inceptionPreBondLiveNetworkValueSats,
      numericValue: (value) => Number(value) || 0,
    },
  );
  const inceptionMintsWithLiveIssuance = isolatedFunction(
    API_PATH,
    "inceptionMintsWithLiveIssuance",
    {
      INCB_TOKEN_ID: "incb",
      INCEPTION_ISSUANCE_ACCOUNTING_MODEL:
        "canonical-pre-bond-live-network-value-v2",
      Map,
      WORK_TOKEN_MAX_SUPPLY: 1,
      canonicalEventOrdinal,
      inceptionAttachmentMatchesForBond,
      inceptionIssuanceCheckpoint,
      isInceptionBondActivityItem: (candidate) =>
        candidate?.kind === "inception-bond",
      numericValue: (value) => Number(value) || 0,
      samePaymentAddress,
    },
  );
  const recipientAddress = "recipient";
  const positionedBond = {
    ...bond,
    amountSats: 546,
    attachedCredits: [{
      amount: 2,
      protocolVout: 3,
      recipientAddress,
      tokenId: "work",
    }],
    kind: "inception-bond",
    recipients: [{ address: recipientAddress, amountSats: 546, vout: 0 }],
  };
  const [issued] = inceptionMintsWithLiveIssuance(
    [{
      amount: 546,
      blockHash,
      blockHeight: 100,
      blockIndex: 5,
      confirmed: true,
      minterAddress: recipientAddress,
      paidSats: 546,
      tokenId: "incb",
      txid: bondTxid,
    }],
    [positionedBond],
    {
      ...ledger,
      workTokenState: {
        transfers: [{
          amount: 2,
          blockHash,
          blockHeight: 100,
          blockIndex: 5,
          confirmed: true,
          protocolVout: 3,
          recipientAddress,
          tokenId: "work",
          txid: bondTxid,
          valid: true,
        }],
      },
    },
  );
  assert.equal(issued.amount, 546);
  assert.equal(issued.issuanceAccountingModel, undefined);
  const creditValueEventHeight = isolatedFunction(
    API_PATH,
    "creditValueEventHeight",
  );
  const creditValueEventIndex = isolatedFunction(
    API_PATH,
    "creditValueEventIndex",
  );
  const compareCreditValueReplayEvents = isolatedFunction(
    API_PATH,
    "compareCreditValueReplayEvents",
    {
      canonicalTokenReplayOrdinal: () => Number.MAX_SAFE_INTEGER,
      creditValueEventHeight,
      creditValueEventIndex,
    },
  );
  assert.ok(
    compareCreditValueReplayEvents(
      {
        createdMs: Date.parse("2030-01-01T00:00:00.000Z"),
        order: 0,
        source: { blockHeight: 100, blockIndex: 4 },
        txid: "a",
      },
      {
        createdMs: Date.parse("1990-01-01T00:00:00.000Z"),
        order: 0,
        source: { blockHeight: 100, blockIndex: 6 },
        txid: "b",
      },
    ) < 0,
    "credit valuation replay must ignore regressing block timestamps",
  );
  const growthActualBaseNetworkValueBeforeCanonicalItem = isolatedFunction(
    API_PATH,
    "growthActualBaseNetworkValueBeforeCanonicalItem",
    {
      canonicalItemPrecedesBondTransaction,
      growthActualBaseNetworkValue: (...args) => ({
        totalSats: args.slice(0, 7).flat().reduce(
          (total, candidate) => total + candidate.value,
          0,
        ),
      }),
      numericValue: (value) => Number(value) || 0,
    },
  );
  assert.equal(
    growthActualBaseNetworkValueBeforeCanonicalItem(
      bond,
      {
        idActivity: [
          item(3, {
            blockIndex: 4,
            createdAt: "2030-01-01T00:00:00.000Z",
          }),
          item(99, {
            blockIndex: 6,
            createdAt: "1990-01-01T00:00:00.000Z",
          }),
        ],
        records: [],
        sales: [],
        tokenDefinitions: [],
        tokenMints: [],
        tokenSales: [],
        tokenTransfers: [],
      },
      Date.parse(bond.createdAt),
      () => 999,
    ),
    3,
    "base-before must follow canonical position rather than block time",
  );
  const canonicalReplayTimeline = isolatedFunction(
    API_PATH,
    "canonicalReplayTimeline",
  );
  const canonicalReplayPrefixLengthAtMs = isolatedFunction(
    API_PATH,
    "canonicalReplayPrefixLengthAtMs",
  );
  const regressingTimeline = canonicalReplayTimeline([
    { createdMs: 200 },
    { createdMs: 100 },
  ]);
  assert.equal(
    canonicalReplayPrefixLengthAtMs(regressingTimeline, 150),
    2,
    "a later canonical event with an earlier block time implies its full chain prefix",
  );
});

check("livenet Inception issuance uses the published H-1 snapshot and excludes its whole block", () => {
  const INCEPTION_VALUE_SNAPSHOT_MODEL =
    "canonical-summary-h-minus-one-v1";
  const numericValue = (value, fallback = 0) => {
    const number = Number(value);
    return Number.isFinite(number) ? number : fallback;
  };
  const canonicalEventOrdinal = isolatedFunction(
    API_PATH,
    "canonicalEventOrdinal",
  );
  const canonicalItemPrecedesBondTransaction = isolatedFunction(
    API_PATH,
    "canonicalItemPrecedesBondTransaction",
  );
  const canonicalTokenReplayOrdinal = isolatedFunction(
    API_PATH,
    "canonicalTokenReplayOrdinal",
  );
  const creditValueEventHeight = isolatedFunction(
    API_PATH,
    "creditValueEventHeight",
  );
  const creditValueEventIndex = isolatedFunction(
    API_PATH,
    "creditValueEventIndex",
  );
  const creditValueEventMs = isolatedFunction(
    API_PATH,
    "creditValueEventMs",
  );
  const compareCreditValueReplayEvents = isolatedFunction(
    API_PATH,
    "compareCreditValueReplayEvents",
    {
      canonicalTokenReplayOrdinal,
      creditValueEventHeight,
      creditValueEventIndex,
    },
  );
  const canonicalReplayTimeline = isolatedFunction(
    API_PATH,
    "canonicalReplayTimeline",
  );
  const canonicalReplayPrefixLengthAtMs = isolatedFunction(
    API_PATH,
    "canonicalReplayPrefixLengthAtMs",
  );
  const presentNonNegativeNumber = isolatedFunction(
    API_PATH,
    "presentNonNegativeNumber",
  );
  const creditReplayTransactionMinerFeeSats = isolatedFunction(
    API_PATH,
    "creditReplayTransactionMinerFeeSats",
    { presentNonNegativeNumber },
  );
  const baseGlobals = {
    BOND_TOKEN_IDS: new Set(["incb", "powb"]),
    GROWTH_MODEL_INPUTS: {
      idDensitySatsPerN2: 0,
      valueMultiple: 1,
    },
    GROWTH_MODEL_START_MS: 0,
    ID_MARKETPLACE_MUTATION_KINDS: new Set(),
    MS_PER_MODEL_YEAR: 1,
    TOKEN_MARKETPLACE_MUTATION_KINDS: new Set(),
    activityAmountSats: (item) => numericValue(item?.amountSats),
    activityKindHasDedicatedGrowthBucket: () => true,
    confirmedActivityFlowSats: () => 0,
    growthSatsToUsdAtYears: () => 0,
    isBondActivityItem: () => false,
    isBrowserActivityItem: () => false,
    isInceptionBondActivityItem: () => false,
    isInfinityBondActivityItem: () => false,
    numericValue,
    publicMarketplaceSales: (items) => items,
    unbucketedConfirmedComputerLogFlowSats: () => 0,
  };
  const growthActualBaseNetworkValue = isolatedFunction(
    API_PATH,
    "growthActualBaseNetworkValue",
    baseGlobals,
  );
  const emptyGrowthActualBaseState = isolatedFunction(
    API_PATH,
    "emptyGrowthActualBaseState",
  );
  const growthActualBaseStateApplyContribution = isolatedFunction(
    API_PATH,
    "growthActualBaseStateApplyContribution",
    { numericValue },
  );
  const growthActualBaseStateAdd = isolatedFunction(
    API_PATH,
    "growthActualBaseStateAdd",
    { numericValue },
  );
  const growthActualBaseStateTotalSats = isolatedFunction(
    API_PATH,
    "growthActualBaseStateTotalSats",
    baseGlobals,
  );
  const growthActualBaseNetworkValueEvents = isolatedFunction(
    API_PATH,
    "growthActualBaseNetworkValueEvents",
    baseGlobals,
  );
  const growthActualBaseNetworkValueAtProvider = isolatedFunction(
    API_PATH,
    "growthActualBaseNetworkValueAtProvider",
    {
      emptyGrowthActualBaseState,
      growthActualBaseNetworkValueEvents,
      growthActualBaseStateApplyContribution,
      growthActualBaseStateTotalSats,
    },
  );
  const growthActualBaseNetworkValueBeforeCanonicalItem = isolatedFunction(
    API_PATH,
    "growthActualBaseNetworkValueBeforeCanonicalItem",
    {
      canonicalItemPrecedesBondTransaction,
      growthActualBaseNetworkValue,
      numericValue,
    },
  );
  const growthActualBaseNetworkValueBeforeCanonicalItemProvider =
    isolatedFunction(
      API_PATH,
      "growthActualBaseNetworkValueBeforeCanonicalItemProvider",
      {
        emptyGrowthActualBaseState,
        growthActualBaseNetworkValueEvents,
        growthActualBaseStateAdd,
        growthActualBaseStateApplyContribution,
        growthActualBaseStateTotalSats,
        numericValue,
      },
    );
  const tokenCanUseCreditNetworkFloor = isolatedFunction(
    API_PATH,
    "tokenCanUseCreditNetworkFloor",
    { WORK_TOKEN_ID: "work" },
  );
  const growthActualLiveTotalSatsAtProvider = isolatedFunction(
    API_PATH,
    "growthActualLiveTotalSatsAtProvider",
    {
      TOKEN_MARKETPLACE_MUTATION_KINDS: new Set([
        "token-listing",
        "token-listing-sealed",
        "token-listing-closed",
      ]),
      TOKEN_MIN_MUTATION_PRICE_SATS: 546,
      canonicalInceptionWorkMovementOracleByIdentity: () => new Map(),
      canonicalReplayPrefixLengthAtMs,
      canonicalReplayTimeline,
      compareCreditValueReplayEvents,
      creditReplayTransactionMinerFeeSats,
      creditValueEventHeight,
      creditValueEventIndex,
      creditValueEventMs,
      growthActualBaseNetworkValueAtProvider,
      growthActualBaseNetworkValueBeforeCanonicalItemProvider,
      isTokenActivityItem: (item) =>
        String(item?.kind ?? "").startsWith("token-"),
      numericValue,
      tokenCanUseCreditNetworkFloor,
    },
  );
  const inceptionPreBondLiveNetworkValueSats = isolatedFunction(
    API_PATH,
    "inceptionPreBondLiveNetworkValueSats",
    {
      canonicalItemPrecedesBondTransaction,
      growthActualLiveTotalSatsAtProvider,
      numericValue,
    },
  );
  const inceptionAttachmentMatchesForBond = isolatedFunction(
    API_PATH,
    "inceptionAttachmentMatchesForBond",
    {
      WORK_TOKEN_ID: "work",
      canonicalEventOrdinal,
      ledgerTokenStateForScope: (state, scope) =>
        scope === "work" ? state.workTokenState : state.tokenState,
      numericValue,
      samePaymentAddress: (left, right) =>
        String(left).toLowerCase() === String(right).toLowerCase(),
    },
  );
  const inceptionIssuanceCheckpoint = isolatedFunction(
    API_PATH,
    "inceptionIssuanceCheckpoint",
    {
      INCEPTION_VALUE_SNAPSHOT_MODEL,
      inceptionPreBondLiveNetworkValueSats,
      numericValue,
    },
  );
  const inceptionMintsWithLiveIssuance = isolatedFunction(
    API_PATH,
    "inceptionMintsWithLiveIssuance",
    {
      INCB_TOKEN_ID: "incb",
      INCEPTION_ISSUANCE_ACCOUNTING_MODEL:
        "canonical-pre-bond-live-network-value-v2",
      WORK_TOKEN_MAX_SUPPLY: 1_000,
      canonicalEventOrdinal,
      inceptionAttachmentMatchesForBond,
      inceptionIssuanceCheckpoint,
      isInceptionBondActivityItem: (item) =>
        item?.kind === "inception-bond",
      numericValue,
      samePaymentAddress: (left, right) =>
        String(left).toLowerCase() === String(right).toLowerCase(),
    },
  );

  const blockHash = "d".repeat(64);
  const bondTxid = "e".repeat(64);
  const recipientAddress = "recipient";
  const positioned = (txid, blockHeight, blockIndex, createdAt, extra = {}) => ({
    blockHash,
    blockHeight,
    blockIndex,
    confirmed: true,
    createdAt,
    network: "livenet",
    txid,
    ...extra,
  });
  const workDefinition = positioned(
    "1".repeat(64),
    99,
    1,
    "2035-01-01T00:00:00.000Z",
    {
      creationFeeSats: 1_000,
      maxSupply: 1_000,
      ticker: "WORK",
      tokenId: "work",
    },
  );
  const priorWorkMint = positioned(
    "2".repeat(64),
    100,
    4,
    "2036-01-01T00:00:00.000Z",
    {
      amount: 100,
      paidSats: 0,
      tokenId: "work",
    },
  );
  const bond = positioned(
    bondTxid,
    100,
    5,
    "2026-01-01T00:00:00.000Z",
    {
      amountSats: 546,
      attachedCredits: [{
        amount: 10,
        protocolVout: 3,
        recipientAddress,
        tokenId: "work",
      }],
      kind: "inception-bond",
      recipients: [{ address: recipientAddress, amountSats: 546, vout: 0 }],
    },
  );
  const attachment = positioned(
    bondTxid,
    100,
    5,
    "2026-01-01T00:00:00.000Z",
    {
      amount: 10,
      protocolVout: 3,
      recipientAddress,
      tokenId: "work",
      valid: true,
    },
  );
  const postBondMint = positioned(
    "3".repeat(64),
    100,
    6,
    "1990-01-01T00:00:00.000Z",
    {
      amount: 900_000,
      paidSats: 900_000,
      tokenId: "work",
    },
  );
  const unknownPositionMint = {
    amount: 900_000,
    confirmed: true,
    createdAt: "1980-01-01T00:00:00.000Z",
    network: "livenet",
    paidSats: 900_000,
    tokenId: "work",
    txid: "4".repeat(64),
  };
  const seedMint = positioned(
    bondTxid,
    100,
    5,
    "2026-01-01T00:00:00.000Z",
    {
      amount: 546,
      minterAddress: recipientAddress,
      paidSats: 546,
      tokenId: "incb",
    },
  );
  const ledger = {
    activity: [bond],
    registryState: { records: [], sales: [] },
    tokenState: {
      mints: [
        priorWorkMint,
        attachment,
        postBondMint,
        unknownPositionMint,
      ],
      sales: [],
      tokens: [workDefinition],
      transfers: [attachment],
    },
    workTokenState: { transfers: [attachment] },
  };

  assert.equal(
    inceptionPreBondLiveNetworkValueSats(ledger, bond),
    1_110,
    "the retired retrospective replay would include an earlier transaction in the bond block",
  );
  const [unproven] = inceptionMintsWithLiveIssuance(
    [seedMint],
    [bond],
    ledger,
  );
  assert.equal(unproven.amount, 546);
  assert.equal(unproven.issuanceAccountingModel, undefined);

  const publishedCheckpoint = {
    blockHash,
    blockHeight: 100,
    blockIndex: 5,
    valueSnapshotBlockHash: "c".repeat(64),
    valueSnapshotBlockHeight: 99,
    valueSnapshotCanonicalSummaryHash: "a".repeat(64),
    valueSnapshotGeneratedAt: "2026-01-01T00:00:00.000Z",
    valueSnapshotId: "published-h-minus-one",
    valueSnapshotMode: "canonical-summary-refresh",
    valueSnapshotModel: INCEPTION_VALUE_SNAPSHOT_MODEL,
    workNetworkValueSats: 1_000,
  };
  const [issued] = inceptionMintsWithLiveIssuance(
    [seedMint],
    [bond],
    ledger,
    { preBondCheckpoint: () => publishedCheckpoint },
  );
  assert.equal(
    issued.issuanceValueSnapshotWorkNetworkValueSats,
    1_000,
    "the published H-1 snapshot excludes every transaction in the bond block",
  );
  assert.equal(issued.amount, 556);
  assert.equal(issued.issuanceNetworkValueSats, 556);

  const [repriced] = inceptionMintsWithLiveIssuance(
    [seedMint],
    [bond],
    {
      ...ledger,
      tokenState: {
        ...ledger.tokenState,
        mints: [
          ...ledger.tokenState.mints,
          positioned(
            "5".repeat(64),
            101,
            0,
            "1970-01-01T00:00:00.000Z",
            {
              amount: 9_000_000,
              paidSats: 9_000_000,
              tokenId: "work",
            },
          ),
        ],
      },
    },
    { preBondCheckpoint: () => publishedCheckpoint },
  );
  assert.equal(
    repriced.issuanceValueSnapshotWorkNetworkValueSats,
    issued.issuanceValueSnapshotWorkNetworkValueSats,
    "current and post-bond WORK state must never reprice issuance",
  );
  assert.equal(repriced.amount, issued.amount);

});

check("empty bond summaries cannot cross bond-family identity", () => {
  const inceptionIssuanceModel =
    "canonical-pre-bond-live-network-value-v2";
  const inceptionValueSnapshotModel =
    "canonical-summary-h-minus-one-v1";
  const bondSummaryPayloadHasKnownMainnetValue = isolatedFunction(
    API_PATH,
    "bondSummaryPayloadHasKnownMainnetValue",
    {
      INCB_TOKEN_ID: "incb",
      INCEPTION_ATTACHMENT_ACCOUNTING_MODEL: inceptionIssuanceModel,
      INCEPTION_ISSUANCE_ACCOUNTING_MODEL: inceptionIssuanceModel,
      INCEPTION_VALUE_SNAPSHOT_MODEL: inceptionValueSnapshotModel,
      finitePositiveNumber: (value) =>
        Number.isFinite(Number(value)) && Number(value) > 0,
      isValidBitcoinAddress: (address) => address === "1registry",
      normalizePowId: (value) =>
        String(value ?? "")
          .trim()
          .replace(/@proofofwork\.me$/u, "")
          .toLowerCase(),
      numbersAgree: (left, right, tolerance = 0) =>
        Math.abs(Number(left) - Number(right)) <= tolerance,
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

  const legacyPositive = {
    ...empty,
    actualValue: { bondMintFlowSats: 546, networkValueSats: 546 },
    chartPoints: [
      {
        confirmedSupply: 546,
        floorSats: 1,
        networkValueSats: 546,
      },
    ],
    networkValueSats: 546,
    stats: { confirmedBondActions: 1, confirmedSupply: 546 },
  };
  assert.equal(
    bondSummaryPayloadHasKnownMainnetValue(legacyPositive, config),
    false,
    "a proof-only legacy INCB summary must not pass the attachment-aware gate",
  );
  assert.equal(
    bondSummaryPayloadHasKnownMainnetValue(
      {
        ...legacyPositive,
        actualValue: {
          ...legacyPositive.actualValue,
          attachedWorkActions: 0,
          attachedWorkAmount: 0,
          attachedWorkFrozenValueSats: 0,
          attachedWorkLiveValueSats: 0,
          attachedWorkUnmatchedActions: 0,
          attachedWorkUnvaluedActions: 0,
          frozenFloorSats: 1,
          frozenNetworkValueSats: 546,
          liveFloorSats: 1,
          liveNetworkValueSats: 546,
        },
      },
      config,
    ),
    false,
    "field names alone cannot make a pre-model snapshot current",
  );
  assert.equal(
    bondSummaryPayloadHasKnownMainnetValue(
      {
        ...legacyPositive,
        actualValue: {
          ...legacyPositive.actualValue,
          attachedWorkActions: 0,
          attachedWorkAmount: 0,
          attachedWorkFrozenValueSats: 0,
          attachedWorkLiveValueSats: 0,
          attachedWorkUnmatchedActions: 0,
          attachedWorkUnvaluedActions: 0,
          attachmentAccountingModel: inceptionIssuanceModel,
          attachedWorkIssuanceUnits: 0,
          attachedWorkLiveFloorAtSendSats: 2,
          attachedWorkLiveValueAtSendSats: 0,
          baseNetworkValueSats: 546,
          bondMarketplaceMutationFeeSats: 0,
          bondSaleVolumeSats: 0,
          bondTransferFeeSats: 0,
          confirmedIssuanceUnits: 546,
          directProofIssuanceUnits: 546,
          frozenFloorSats: 1,
          frozenNetworkValueSats: 546,
          issuanceAccountingModel: inceptionIssuanceModel,
          issuanceCheckpointBlockHash: "e".repeat(64),
          issuanceCheckpointBlockHeight: 957_950,
          issuanceCheckpointBlockIndex: 382,
          issuanceCheckpointMode: "bond-transaction-provenance",
          issuanceValueSnapshotBlockHash: "d".repeat(64),
          issuanceValueSnapshotBlockHeight: 957_949,
          issuanceValueSnapshotCanonicalSummaryHash: "c".repeat(64),
          issuanceValueSnapshotGeneratedAt: "2026-07-14T03:03:04.765Z",
          issuanceValueSnapshotId: "proof-only-h-minus-one",
          issuanceValueSnapshotMode: "canonical-summary-refresh",
          issuanceValueSnapshotModel: inceptionValueSnapshotModel,
          issuanceValueSnapshotWorkNetworkValueSats: 42_000_000,
          issuanceDustSats: 0,
          issuanceFloorSats: 1,
          issuanceNetworkValueSats: 546,
          issuanceUnitSats: 1,
          issuanceValuationFixedAtSend: true,
          liveFloorSats: 1,
          liveNetworkValueSats: 546,
        },
      },
      config,
    ),
    true,
    "a current-model proof-only bond remains arithmetically valid",
  );
  assert.equal(
    bondSummaryPayloadHasKnownMainnetValue(
      {
        ...legacyPositive,
        actualValue: {
          ...legacyPositive.actualValue,
          attachedWorkActions: 1,
          attachedWorkAmount: 100,
          attachedWorkFrozenValueSats: 200,
          attachedWorkLiveValueSats: 300,
          attachedWorkUnmatchedActions: 1,
          attachedWorkUnvaluedActions: 0,
          attachmentAccountingModel: inceptionIssuanceModel,
          attachedWorkIssuanceUnits: 200,
          attachedWorkLiveFloorAtSendSats: 2,
          attachedWorkLiveValueAtSendSats: 200,
          baseNetworkValueSats: 546,
          bondMarketplaceMutationFeeSats: 0,
          bondSaleVolumeSats: 0,
          bondTransferFeeSats: 0,
          confirmedIssuanceUnits: 746,
          directProofIssuanceUnits: 546,
          frozenFloorSats: 1,
          frozenNetworkValueSats: 746,
          issuanceAccountingModel: inceptionIssuanceModel,
          issuanceCheckpointBlockHash: "e".repeat(64),
          issuanceCheckpointBlockHeight: 957_950,
          issuanceCheckpointBlockIndex: 382,
          issuanceCheckpointMode: "bond-transaction-provenance",
          issuanceValueSnapshotBlockHash: "d".repeat(64),
          issuanceValueSnapshotBlockHeight: 957_949,
          issuanceValueSnapshotCanonicalSummaryHash: "c".repeat(64),
          issuanceValueSnapshotGeneratedAt: "2026-07-14T03:03:04.765Z",
          issuanceValueSnapshotId: "attached-h-minus-one",
          issuanceValueSnapshotMode: "canonical-summary-refresh",
          issuanceValueSnapshotModel: inceptionValueSnapshotModel,
          issuanceValueSnapshotWorkNetworkValueSats: 42_000_000,
          issuanceDustSats: 0,
          issuanceFloorSats: 1,
          issuanceNetworkValueSats: 746,
          liveFloorSats: 846 / 746,
          liveNetworkValueSats: 846,
          networkValueSats: 846,
        },
        chartPoints: [
          { confirmedSupply: 746, floorSats: 1, networkValueSats: 746 },
        ],
        networkValueSats: 846,
        stats: { confirmedBondActions: 1, confirmedSupply: 746 },
      },
      config,
    ),
    false,
    "a partially matched declared WORK attachment must fail closed",
  );
  assert.match(
    topLevelFunctionSource(API_PATH, "internalCanonicalSummaryPayload"),
    /summaryPayloadHasFiniteNetworkValue\(\s*network,\s*key,\s*payload,?\s*\)/u,
    "canonical summary publication must validate every financial payload",
  );
});

check("invalid canonical Inception composites never escape ledger fallback", async () => {
  const config = {
    displayName: "Inception Bond",
    summaryKey: "inceptionSummary",
    summaryRoute: "inception-summary",
    tokenId: "incb",
  };
  const ledger = {
    inceptionSummary: {
      registryAddress: "1registry",
      stats: { confirmedBondActions: 2, confirmedSupply: 2, holders: 1 },
    },
  };
  let indexed = null;
  let canonical = { validComposite: false };
  const bondSummaryPayload = isolatedFunction(API_PATH, "bondSummaryPayload", {
    LEDGER_SUMMARY_FRESH_WAIT_MS: 1_000,
    bondSummaryFromCanonicalLedger: async () => canonical,
    currentProofIndexSummarySnapshotFallbackPayload: async () => null,
    existingCurrentCanonicalLedgerPayloadWithinMs: async () => ledger,
    freshDataUnavailableError: (message) => {
      const error = new Error(message);
      error.statusCode = 503;
      return error;
    },
    numericValue: (value) => {
      const number = Number(value);
      return Number.isFinite(number) ? number : 0;
    },
    payloadWithFallbackAfterMs: async (promise) => promise,
    proofIndexBondSummaryPayload: async () => indexed,
    standaloneBondSummaryPayload: async () => null,
    summaryCanonicalLedgerPayload: async () => ledger,
    summaryPayloadHasFiniteNetworkValue: (_network, _key, payload) =>
      payload?.validComposite === true,
  });

  indexed = {
    marker: "validated-indexed",
    stats: { confirmedBondActions: 1, confirmedSupply: 1, holders: 1 },
  };
  assert.equal(
    (await bondSummaryPayload("livenet", true, config)).marker,
    "validated-indexed",
  );

  indexed = null;
  await rejection(
    bondSummaryPayload("livenet", true, config),
    (error) => error?.statusCode === 503,
  );

  canonical = { validComposite: true };
  assert.equal(
    (await bondSummaryPayload("livenet", true, config)).validComposite,
    true,
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
      updateTransactionStatus: async () => ({ applied: true }),
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

check("worker status transitions are proven, race-safe, and projection-safe", async () => {
  const txid = "9".repeat(64);
  const now = Date.now();
  const observedAt = new Date(now).toISOString();
  const mempoolFirstSeenAt = new Date(now - 60_000).toISOString();
  const statusUpdate = isolatedFunction(
    WORKER_PATH,
    "updateTransactionStatus",
    {
      NETWORK: "livenet",
      PENDING_DROP_CONFIRMATION_MS: 1_000,
    },
  );
  const pendingEnvelope = {
    confirmed: false,
    contract: "proof-of-work-tx-status-v2",
    mempoolFirstSeenAt,
    mempoolSeen: true,
    network: "livenet",
    observedAt,
    sources: ["bitcoin-core:getmempoolentry"],
    status: "pending",
    txid,
  };

  const pendingQueries = [];
  const pendingClient = {
    async query(sql, params) {
      pendingQueries.push({ params, sql });
      if (/SELECT status, raw_tx/iu.test(sql)) {
        return { rows: [{ raw_tx: {}, status: "pending" }] };
      }
      return { rowCount: 1, rows: [] };
    },
  };
  const pendingOutcome = await statusUpdate(
    pendingClient,
    txid,
    "pending",
    pendingEnvelope,
  );
  assert.equal(pendingOutcome.applied, true);
  assert.equal(pendingQueries.length, 5);
  assert.match(pendingQueries[1].sql, /block_hash = NULL/iu);
  assert.match(pendingQueries[2].sql, /status = 'pending'/iu);
  assert.match(pendingQueries[2].sql, /WHERE[\s\S]*status = 'pending'/iu);

  const confirmedQueries = [];
  const confirmedOutcome = await statusUpdate(
    {
      async query(sql) {
        confirmedQueries.push(sql);
        return { rows: [{ raw_tx: {}, status: "pending" }] };
      },
    },
    txid,
    "confirmed",
    {
      blockHash: "a".repeat(64),
      blockHeight: 123,
      blockTime: new Date(now - 120_000).toISOString(),
      canonical: true,
      confirmed: true,
      contract: "proof-of-work-tx-status-v2",
      network: "livenet",
      observedAt,
      sources: ["bitcoin-core:getblock"],
      status: "confirmed",
      txid,
    },
  );
  assert.equal(confirmedOutcome.applied, false);
  assert.equal(confirmedOutcome.reason, "canonical-block-scan-required");
  assert.equal(confirmedQueries.length, 1);

  let invalidQueries = 0;
  await rejection(
    statusUpdate(
      {
        async query() {
          invalidQueries += 1;
        },
      },
      txid,
      "confirmed",
      {
        confirmed: true,
        contract: "proof-of-work-tx-status-v2",
        network: "livenet",
        observedAt,
        sources: ["bitcoin-core:getblock"],
        status: "confirmed",
        txid,
      },
    ),
    (error) => /Unproven confirmed status/iu.test(error.message),
  );
  assert.equal(invalidQueries, 0);

  const raceQueries = [];
  const raceOutcome = await statusUpdate(
    {
      async query(sql) {
        raceQueries.push(sql);
        return { rows: [{ raw_tx: {}, status: "confirmed" }] };
      },
    },
    txid,
    "pending",
    pendingEnvelope,
  );
  assert.equal(raceOutcome.applied, false);
  assert.equal(raceOutcome.reason, "status-race");
  assert.equal(raceQueries.length, 1);

  const absentEnvelope = {
    absenceProven: true,
    confirmed: false,
    contract: "proof-of-work-tx-status-v2",
    network: "livenet",
    observedAt,
    reason: "absent-from-healthy-bitcoin-core-chain-and-mempool",
    sources: ["bitcoin-core:getrawtransaction"],
    status: "dropped",
    txid,
  };
  const firstAbsenceQueries = [];
  const firstAbsence = await statusUpdate(
    {
      async query(sql) {
        firstAbsenceQueries.push(sql);
        if (/SELECT status, raw_tx/iu.test(sql)) {
          return { rows: [{ raw_tx: {}, status: "pending" }] };
        }
        return { rowCount: 1, rows: [] };
      },
    },
    txid,
    "dropped",
    absentEnvelope,
  );
  assert.equal(firstAbsence.applied, false);
  assert.equal(firstAbsence.reason, "repeat-absence-required");
  assert.equal(firstAbsenceQueries.length, 2);

  const repeatedAbsenceQueries = [];
  const repeatedAbsence = await statusUpdate(
    {
      async query(sql) {
        repeatedAbsenceQueries.push(sql);
        if (/SELECT status, raw_tx/iu.test(sql)) {
          return {
            rows: [
              {
                raw_tx: {
                  statusObservation: {
                    absenceCount: 1,
                    observedAt: new Date(now - 60_000).toISOString(),
                    status: "dropped",
                  },
                },
                status: "pending",
              },
            ],
          };
        }
        return { rowCount: 1, rows: [] };
      },
    },
    txid,
    "dropped",
    absentEnvelope,
  );
  assert.equal(repeatedAbsence.applied, true);
  const listingUpdates = repeatedAbsenceQueries.filter((sql) =>
    /UPDATE proof_indexer\.credit_listings/iu.test(sql),
  );
  assert.equal(listingUpdates.length, 2);
  const initialListingDrop = listingUpdates.find((sql) =>
    /listing_id = \$2 AND status = 'pending'/iu.test(sql),
  );
  const lifecycleRestore = listingUpdates.find((sql) =>
    /WITH affected AS/iu.test(sql),
  );
  assert.match(initialListingDrop, /status = 'dropped'/iu);
  assert.match(lifecycleRestore, /ELSE 'active'/iu);
  assert.match(lifecycleRestore, /THEN 'sealing'/iu);
  assert.match(lifecycleRestore, /buyer_address = NULL/iu);
  assert.match(lifecycleRestore, /base_event\.payload AS base_payload/iu);
  for (const staleKey of [
    "buyerAddress",
    "closeTxid",
    "closedTxid",
    "saleTxid",
  ]) {
    assert.match(lifecycleRestore, new RegExp(`- '${staleKey}'`, "u"));
  }
});

check("rebroadcast pending transactions clear every prior drop observation", async () => {
  let statement = "";
  const upsertTransaction = isolatedFunction(
    BACKFILL_PATH,
    "upsertTransaction",
    {
      NETWORK: "livenet",
      itemTime: (item) => item.createdAt,
      numberOrNull: (value) =>
        Number.isFinite(Number(value)) ? Number(value) : null,
    },
  );
  await upsertTransaction(
    {
      async query(sql) {
        statement = String(sql);
        return { rows: [] };
      },
    },
    { confirmed: false, createdAt: "2026-07-14T18:00:00.000Z" },
    "a".repeat(64),
    "pending",
    "mempool-scan",
  );
  assert.match(statement, /dropped_at = CASE[\s\S]*THEN NULL/u);
  assert.match(statement, /dropped_reason = CASE[\s\S]*THEN NULL/u);
  assert.match(statement, /replaced_by_txid = CASE[\s\S]*THEN NULL/u);
  assert.match(statement, /- 'statusObservation'/u);
});

check("same-height pending membership versions the canonical Log snapshot", async () => {
  const readerKinds = /const PUBLIC_LOG_EVENT_KINDS = new Set\(\[([\s\S]*?)\]\);/u.exec(
    fileSource(READER_PATH),
  )?.[1];
  const backfillKinds = /const PUBLIC_LOG_EVENT_KINDS = new Set\(\[([\s\S]*?)\]\);/u.exec(
    fileSource(BACKFILL_PATH),
  )?.[1];
  const parseKinds = (source) =>
    [...String(source ?? "").matchAll(/"([^"]+)"/gu)]
      .map((match) => match[1])
      .sort();
  assert.deepEqual(parseKinds(backfillKinds), parseKinds(readerKinds));

  let rows = [
    {
      block_height: 100,
      block_time: "2026-07-14T17:00:00.000Z",
      created_at: "2026-07-14T17:00:00.000Z",
      event_id: "1",
      event_time: "2026-07-14T17:00:00.000Z",
      kind: "mail",
      payload_hash: "1".repeat(32),
      protocol: "pwm1",
      status: "confirmed",
      txid: "1".repeat(64),
      valid: true,
    },
  ];
  let fingerprintSql = "";
  const publicLogRelationalFingerprint = isolatedFunction(
    BACKFILL_PATH,
    "publicLogRelationalFingerprint",
    {
      NETWORK: "livenet",
      PUBLIC_LOG_EVENT_KINDS: new Set(["mail"]),
      createHash,
    },
  );
  const client = {
    async query(sql) {
      fingerprintSql = String(sql);
      return { rows };
    },
  };
  const before = await publicLogRelationalFingerprint(client);
  rows = [
    ...rows,
    {
      block_height: null,
      block_time: null,
      created_at: "2026-07-14T18:00:00.000Z",
      event_id: "2",
      event_time: "2026-07-14T18:00:00.000Z",
      kind: "mail",
      payload_hash: "2".repeat(32),
      protocol: "pwm1",
      status: "pending",
      txid: "2".repeat(64),
      valid: true,
    },
  ];
  const after = await publicLogRelationalFingerprint(client);
  assert.equal(before.count, 1);
  assert.equal(after.count, 2);
  assert.equal(after.pending, 1);
  assert.notEqual(after.hash, before.hash);
  assert.match(fingerprintSql, /md5\(e\.payload::text\)/u);
  assert.doesNotMatch(fingerprintSql, /e\.updated_at/u);

  const runCycleSource = topLevelFunctionSource(WORKER_PATH, "runCycle");
  assert.match(
    runCycleSource,
    /const pendingStatus = await refreshPendingStatuses\(pool\);[\s\S]*await runBackfillWithRetries\(backfillEnv\);/u,
  );
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
      assertCanonicalIncbCurrentProjection: () => {},
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
    "logSummary",
    "marketplaceSummary",
    "tokenSummary",
    "workFloor",
    "workSummary",
  ];
  const publicLogFingerprint = {
    contract: "proof-index-public-log-fingerprint-v1",
    count: 2,
    hash: "f".repeat(64),
    pending: 0,
  };
  const canonicalSummaryCoverage = isolatedFunction(
    BACKFILL_PATH,
    "canonicalSummaryCoverage",
    {
      REQUIRED_CURRENT_SUMMARY_KEYS: requiredKeys,
      summaryPayloadConservativeCoverage,
    },
  );
  const canonicalSummaryAccountingModelsCurrent = isolatedFunction(
    BACKFILL_PATH,
    "canonicalSummaryAccountingModelsCurrent",
    {
      INCB_ISSUANCE_ACCOUNTING_MODEL:
        "canonical-pre-bond-live-network-value-v2",
      INCB_VALUE_SNAPSHOT_MODEL:
        "canonical-summary-h-minus-one-v1",
      WORK_TOKEN_ID:
        "d4e5ebf11d104d6a63fb74e42094364b25a5f7199a09e5c0e71408972466a8b8",
      WORK_TRANSFER_VALUE_PROJECTION_MODEL:
        "canonical-work-transfer-value-projection-v1",
      objectPayload: (value) =>
        value && typeof value === "object" && !Array.isArray(value)
          ? value
          : null,
    },
  );
  const currentInceptionActual = {
    attachedWorkIssuanceUnits: 200,
    attachedWorkLiveValueAtSendSats: 200,
    attachmentAccountingModel:
      "canonical-pre-bond-live-network-value-v2",
    confirmedIssuanceUnits: 746,
    directProofIssuanceUnits: 546,
    issuanceAccountingModel:
      "canonical-pre-bond-live-network-value-v2",
    issuanceCheckpointBlockHeight: 957_950,
    issuanceCheckpointMode: "bond-transaction-provenance",
    issuanceDustSats: 0,
    issuanceFloorSats: 1,
    issuanceNetworkValueSats: 746,
    issuanceValueSnapshotBlockHash: "a".repeat(64),
    issuanceValueSnapshotBlockHeight: 957_949,
    issuanceValueSnapshotCanonicalSummaryHash: "b".repeat(64),
    issuanceValueSnapshotGeneratedAt: "2026-07-14T03:03:04.765Z",
    issuanceValueSnapshotId: "snapshot-before-bond",
    issuanceValueSnapshotMode: "canonical-summary-refresh",
    issuanceValueSnapshotModel: "canonical-summary-h-minus-one-v1",
    issuanceValueSnapshotWorkNetworkValueSats: 42_000_000,
  };
  assert.equal(canonicalSummaryAccountingModelsCurrent({}), false);
  assert.equal(
    canonicalSummaryAccountingModelsCurrent({
      inceptionSummary: {
        actualValue: currentInceptionActual,
        token: { stats: { confirmedMints: 1 } },
      },
      workSummary: {
        token: { stats: { confirmedTransfers: 0 } },
        workTransferValueProjection: {
          items: [],
          model: "canonical-work-transfer-value-projection-v1",
        },
      },
      workFloor: {
        actualValue: {
          creditMinerFeeAccountingModel:
            "canonical-unique-tx-input-output-v1",
          creditMinerFeeCoverage: {
            complete: true,
            confirmedEvents: 2,
            confirmedTransactions: 1,
            coveredConfirmedEvents: 2,
            coveredConfirmedTransactions: 1,
            missingConfirmedEvents: 0,
            missingConfirmedTransactions: 0,
            missingConfirmedTxids: [],
            source: "proof-indexer-normalized-input-output-totals",
          },
        },
      },
    }),
    true,
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
  const currentSummaryFor = (key, height, snapshotId = `full-${height}`) => {
    const payload = summaryFor(key, height, snapshotId);
    if (key === "workFloor") {
      payload.actualValue = {
        creditMinerFeeAccountingModel:
          "canonical-unique-tx-input-output-v1",
        creditMinerFeeCoverage: {
          complete: true,
          confirmedEvents: 2,
          confirmedTransactions: 1,
          coveredConfirmedEvents: 2,
          coveredConfirmedTransactions: 1,
          missingConfirmedEvents: 0,
          missingConfirmedTransactions: 0,
          missingConfirmedTxids: [],
          source: "proof-indexer-normalized-input-output-totals",
        },
      };
    }
    if (key === "inceptionSummary") {
      payload.actualValue = currentInceptionActual;
      payload.token = { stats: { confirmedMints: 1 } };
    }
    if (key === "workSummary") {
      payload.token = { stats: { confirmedTransfers: 0 } };
      payload.workTransferValueProjection = {
        items: [],
        model: "canonical-work-transfer-value-projection-v1",
      };
    }
    if (key === "logSummary") {
      payload.stats = { pending: 0, total: 2 };
      payload.totalCount = 2;
    }
    return payload;
  };
  let previousPayload = {
    ok: true,
    snapshotId: "full-101-legacy-models",
    status: "consistent",
    summaryPayloads: Object.fromEntries(
      requiredKeys.map((key) => [key, summaryFor(key, 101)]),
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
      CANONICAL_SUMMARY_REFRESH_TIMEOUT_MS: 600_000,
      REQUIRED_CURRENT_SUMMARY_KEYS: requiredKeys,
      canonicalSummaryAccountingModelsCurrent,
      canonicalSummaryCoverage,
      createHash,
      latestBlockScanCheckpoint: async () => ({ height: 101 }),
      numberOrNull,
      objectPayload,
      publicLogRelationalFingerprint: async () => publicLogFingerprint,
      publicLogFingerprintsMatch: (left, right) =>
        left?.hash === right?.hash &&
        left?.count === right?.count &&
        left?.pending === right?.pending,
      readJson: async (url, options) => {
        assert.equal(url.pathname, "/api/v1/internal/canonical-summary");
        assert.equal(options.retries, 0);
        assert.equal(options.timeoutMs, 600_000);
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
            requiredKeys.map((key) => [key, currentSummaryFor(key, 101)]),
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
  assert.deepEqual(
    stored.summaryRefresh.publicLogFingerprint,
    publicLogFingerprint,
  );
  assert.equal(stored.activityPayload.marker, "derived-full-101");
  assert.ok(stored.sourceHashes.canonicalSummary);
  assert.ok(
    Object.values(stored.summaryPayloads).every(
      (payload) => payload.indexedThroughBlock === 101,
    ),
  );

  const currentSummaryPayloads = Object.fromEntries(
    requiredKeys.map((key) => [key, summaryFor(key, 101)]),
  );
  currentSummaryPayloads.workFloor.actualValue = {
    creditMinerFeeAccountingModel:
      "canonical-unique-tx-input-output-v1",
    creditMinerFeeCoverage: {
      complete: true,
      confirmedEvents: 2,
      confirmedTransactions: 1,
      coveredConfirmedEvents: 2,
      coveredConfirmedTransactions: 1,
      missingConfirmedEvents: 0,
      missingConfirmedTransactions: 0,
      missingConfirmedTxids: [],
      source: "proof-indexer-normalized-input-output-totals",
    },
  };
  currentSummaryPayloads.inceptionSummary.actualValue =
    currentInceptionActual;
  currentSummaryPayloads.inceptionSummary.token = {
    stats: { confirmedMints: 1 },
  };
  currentSummaryPayloads.workSummary.token = {
    stats: { confirmedTransfers: 0 },
  };
  currentSummaryPayloads.workSummary.workTransferValueProjection = {
    items: [],
    model: "canonical-work-transfer-value-projection-v1",
  };
  previousPayload = {
    ok: true,
    snapshotId: "full-101-current-models",
    status: "consistent",
    summaryPayloads: currentSummaryPayloads,
    summaryRefresh: { publicLogFingerprint },
  };
  const currentResult = await storeCanonicalSummarySnapshot({
    async query() {
      throw new Error("A current same-tip accounting snapshot must not write");
    },
  });
  assert.equal(currentResult.skipped, true);
  assert.equal(currentResult.reason, "already-current");
  assert.equal(currentResult.snapshotId, "full-101-current-models");
  assert.equal(inserted.length, 1);
});

check("canonical summary publication allows cumulative INCB dust across independently floored mints", () => {
  const canonicalSummaryAccountingModelsCurrent = isolatedFunction(
    BACKFILL_PATH,
    "canonicalSummaryAccountingModelsCurrent",
    {
      INCB_ISSUANCE_ACCOUNTING_MODEL:
        "canonical-pre-bond-live-network-value-v2",
      INCB_VALUE_SNAPSHOT_MODEL:
        "canonical-summary-h-minus-one-v1",
      WORK_TOKEN_ID:
        "d4e5ebf11d104d6a63fb74e42094364b25a5f7199a09e5c0e71408972466a8b8",
      WORK_TRANSFER_VALUE_PROJECTION_MODEL:
        "canonical-work-transfer-value-projection-v1",
    },
  );
  const minerFeeCoverage = {
    complete: true,
    confirmedEvents: 2,
    confirmedTransactions: 1,
    coveredConfirmedEvents: 2,
    coveredConfirmedTransactions: 1,
    missingConfirmedEvents: 0,
    missingConfirmedTransactions: 0,
    missingConfirmedTxids: [],
    source: "proof-indexer-normalized-input-output-totals",
  };
  const actualValue = {
    attachedWorkIssuanceUnits: 3_132_313_922,
    attachedWorkLiveValueAtSendSats: 3_132_313_923.5410833,
    attachmentAccountingModel:
      "canonical-pre-bond-live-network-value-v2",
    confirmedIssuanceUnits: 3_132_315_014,
    directProofIssuanceUnits: 1_092,
    issuanceAccountingModel:
      "canonical-pre-bond-live-network-value-v2",
    issuanceCheckpointBlockHeight: 958_007,
    issuanceCheckpointMode: "bond-transaction-provenance",
    issuanceDustSats: 1.5410833358764648,
    issuanceFloorSats: 3_132_315_015.5410833 / 3_132_315_014,
    issuanceNetworkValueSats: 3_132_315_015.5410833,
    issuanceValueSnapshotBlockHash: "a".repeat(64),
    issuanceValueSnapshotBlockHeight: 958_006,
    issuanceValueSnapshotCanonicalSummaryHash: "b".repeat(64),
    issuanceValueSnapshotGeneratedAt: "2026-07-14T06:00:00.000Z",
    issuanceValueSnapshotId: "latest-pre-bond-snapshot",
    issuanceValueSnapshotMode: "canonical-summary-refresh",
    issuanceValueSnapshotModel: "canonical-summary-h-minus-one-v1",
    issuanceValueSnapshotWorkNetworkValueSats: 9_857_361_066.004198,
  };
  const firstExactIssuance = 1_421_799_461.6275952;
  const secondExactIssuance = 1_710_515_553.9134884;
  const independentlyFlooredIssuance =
    Math.floor(firstExactIssuance) + Math.floor(secondExactIssuance);
  const combinedFloor = Math.floor(firstExactIssuance + secondExactIssuance);
  const cumulativeDust =
    firstExactIssuance +
    secondExactIssuance -
    independentlyFlooredIssuance;
  assert.equal(independentlyFlooredIssuance, 3_132_315_014);
  assert.equal(combinedFloor, 3_132_315_015);
  assert.ok(Math.abs(cumulativeDust - 1.5410833358764648) < 1e-12);
  const summaryPayloads = (confirmedMints) => ({
    inceptionSummary: {
      actualValue,
      token: { stats: { confirmedMints } },
    },
    workFloor: {
      actualValue: {
        creditMinerFeeAccountingModel:
          "canonical-unique-tx-input-output-v1",
        creditMinerFeeCoverage: minerFeeCoverage,
      },
    },
    workSummary: {
      token: { stats: { confirmedTransfers: 0 } },
      workTransferValueProjection: {
        items: [],
        model: "canonical-work-transfer-value-projection-v1",
      },
    },
  });

  assert.equal(
    canonicalSummaryAccountingModelsCurrent(summaryPayloads(2)),
    true,
    "two independent mint floors may leave cumulative dust above one proof",
  );
  assert.equal(
    canonicalSummaryAccountingModelsCurrent(summaryPayloads(1)),
    false,
    "cumulative dust must remain below the number of confirmed mints",
  );

  const exactTipLiveFloorSats = 683.8074244507424;
  const creditAmountMoved = 3_644_060;
  const creditValueAtConfirmSats = 1_710_515_007.9134884;
  const creditLiveValueSats = creditAmountMoved * exactTipLiveFloorSats;
  const projectedTransfer = {
    amount: creditAmountMoved,
    confirmed: true,
    creditAmountMoved,
    creditFloorAtConfirmModel:
      "canonical-incb-h-minus-one-live-work-v1",
    creditFloorAtConfirmSats: 469.3981460001999,
    creditLiveFloorSats: exactTipLiveFloorSats,
    creditLiveValueSats,
    creditRevaluationFloorSats: exactTipLiveFloorSats,
    creditValueAtConfirmSats,
    frozenNetworkValueSats: creditValueAtConfirmSats + 546,
    liveNetworkValueSats: creditLiveValueSats + 546,
    tokenId:
      "d4e5ebf11d104d6a63fb74e42094364b25a5f7199a09e5c0e71408972466a8b8",
    txid: "d8b3760f694ec6dda316d93867d61ca39a1f105bed406110dbe28f5d0f56ce21",
    valueSnapshotBlockHash: "c".repeat(64),
    valueSnapshotBlockHeight: 958_006,
    valueSnapshotId: "exact-h-minus-one-snapshot",
  };
  const firstProjectedTransfer = {
    ...projectedTransfer,
    creditFloorAtConfirmSats: 390.168909301053,
    creditValueAtConfirmSats: 1_421_798_915.6275952,
    frozenNetworkValueSats: 1_421_799_461.6275952,
    liveNetworkValueSats: creditLiveValueSats + 546,
    txid: "dd743fb69c519200cc190627219ba34ca2e63e6893e600b73e9aee8d4dac8fa4",
    valueSnapshotBlockHash:
      "00000000000000000001bda6bfa328f15edf597bfc364e02da42ea92a518a15e",
    valueSnapshotBlockHeight: 957_949,
    valueSnapshotId: "first-exact-h-minus-one-snapshot",
  };
  const exactProjectionSummary = summaryPayloads(2);
  exactProjectionSummary.workSummary = {
    floor: { liveFloorSats: exactTipLiveFloorSats },
    token: { stats: { confirmedTransfers: 2 } },
    workTransferValueProjection: {
      items: [firstProjectedTransfer, projectedTransfer],
      model: "canonical-work-transfer-value-projection-v1",
    },
  };
  assert.equal(
    canonicalSummaryAccountingModelsCurrent(exactProjectionSummary),
    true,
    "the projection must reconcile immutable H-1 value with the exact-tip live floor",
  );
  assert.equal(
    canonicalSummaryAccountingModelsCurrent({
      ...exactProjectionSummary,
      workSummary: {
        ...exactProjectionSummary.workSummary,
        workTransferValueProjection: {
          ...exactProjectionSummary.workSummary.workTransferValueProjection,
          items: [
            firstProjectedTransfer,
            {
              ...projectedTransfer,
              creditLiveFloorSats: exactTipLiveFloorSats - 1,
            },
          ],
        },
      },
    }),
    false,
    "an intermediate or stale per-transfer live floor must not publish",
  );
  assert.equal(
    canonicalSummaryAccountingModelsCurrent({
      ...exactProjectionSummary,
      workSummary: {
        ...exactProjectionSummary.workSummary,
        workTransferValueProjection: {
          ...exactProjectionSummary.workSummary.workTransferValueProjection,
          items: [
            firstProjectedTransfer,
            {
              ...projectedTransfer,
              liveNetworkValueSats: projectedTransfer.liveNetworkValueSats + 1,
            },
          ],
        },
      },
    }),
    false,
    "a projected live network value must preserve the transfer's fixed event flow",
  );
  assert.equal(
    canonicalSummaryAccountingModelsCurrent({
      ...exactProjectionSummary,
      workSummary: {
        ...exactProjectionSummary.workSummary,
        workTransferValueProjection: {
          ...exactProjectionSummary.workSummary.workTransferValueProjection,
          items: [
            firstProjectedTransfer,
            {
              ...projectedTransfer,
              frozenNetworkValueSats:
                projectedTransfer.creditValueAtConfirmSats - 1,
            },
          ],
        },
      },
    }),
    false,
    "a negative fixed event-flow component must not publish",
  );
  assert.equal(
    canonicalSummaryAccountingModelsCurrent({
      ...exactProjectionSummary,
      workSummary: {
        ...exactProjectionSummary.workSummary,
        workTransferValueProjection: {
          ...exactProjectionSummary.workSummary.workTransferValueProjection,
          items: [
            firstProjectedTransfer,
            {
              ...projectedTransfer,
              creditValueAtConfirmSats:
                firstProjectedTransfer.creditValueAtConfirmSats,
            },
          ],
        },
      },
    }),
    false,
    "each transfer's frozen credit value must equal its own H-1 floor",
  );
  assert.equal(
    canonicalSummaryAccountingModelsCurrent({
      ...exactProjectionSummary,
      workSummary: {
        ...exactProjectionSummary.workSummary,
        workTransferValueProjection: {
          ...exactProjectionSummary.workSummary.workTransferValueProjection,
          items: [
            firstProjectedTransfer,
            {
              ...projectedTransfer,
              txid: firstProjectedTransfer.txid,
            },
          ],
        },
      },
    }),
    false,
    "duplicate movement identities cannot replace a missing projection row",
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

check("canonical summary timeouts fail closed unless an eligible prior snapshot exists", async () => {
  const abortError = () =>
    Object.assign(new Error("The operation was aborted"), {
      name: "AbortError",
    });
  const priorHash = "a".repeat(64);
  const latestHash = "b".repeat(64);
  let previousPayload = null;
  let insertQueries = 0;
  let canonicalRequestTimeoutMs = null;
  const canonicalSummaryRefreshCanDefer = isolatedFunction(
    BACKFILL_PATH,
    "canonicalSummaryRefreshCanDefer",
  );
  assert.equal(canonicalSummaryRefreshCanDefer(abortError()), true);
  const storeCanonicalSummarySnapshot = isolatedFunction(
    BACKFILL_PATH,
    "storeCanonicalSummarySnapshot",
    {
      CANONICAL_SUMMARY_REFRESH_TIMEOUT_MS: 600_000,
      NETWORK: "livenet",
      canonicalSummaryAccountingModelsCurrent: () => true,
      canonicalSummaryCoverage: () => 100,
      canonicalSummaryRefreshCanDefer,
      latestBlockScanCheckpoint: async () => ({
        blockHash: latestHash,
        height: 101,
      }),
      publicLogRelationalFingerprint: async () => ({
        contract: "proof-index-public-log-fingerprint-v1",
        count: 1,
        hash: "f".repeat(64),
        pending: 0,
      }),
      publicLogFingerprintsMatch: (left, right) => left?.hash === right?.hash,
      objectPayload: (value) =>
        value && typeof value === "object" && !Array.isArray(value)
          ? value
          : null,
      readJson: async (_url, options) => {
        canonicalRequestTimeoutMs = options.timeoutMs;
        throw abortError();
      },
      storedEligibleCanonicalSummarySnapshotPayload: async () =>
        previousPayload,
      unpagedEndpoint: (pathname) => ({ pathname }),
    },
  );
  const client = {
    async query() {
      insertQueries += 1;
      return { rows: [] };
    },
  };

  await rejection(
    storeCanonicalSummarySnapshot(client),
    (error) => error?.name === "AbortError",
    "A cold canonical-summary timeout without an eligible prior snapshot must reject",
  );
  assert.equal(canonicalRequestTimeoutMs, 600_000);
  assert.equal(insertQueries, 0);

  previousPayload = {
    indexedThroughBlockHash: priorHash,
    snapshotId: "eligible-prior-snapshot",
    summaryPayloads: {},
  };
  canonicalRequestTimeoutMs = null;
  const deferred = await storeCanonicalSummarySnapshot(client);
  assert.equal(canonicalRequestTimeoutMs, 600_000);
  assert.equal(deferred.skipped, true);
  assert.equal(deferred.reason, "canonical-summary-deferred");
  assert.equal(deferred.snapshotId, "eligible-prior-snapshot");
  assert.equal(deferred.indexedThroughBlock, 100);
  assert.equal(deferred.latestIndexedHeight, 101);
  assert.equal(insertQueries, 0);
});

check("only the loopback canonical summary read bypasses Undici", async () => {
  const internalToken = "x".repeat(64);
  const canonicalCalls = [];
  const fetchCalls = [];
  const readJson = isolatedFunction(BACKFILL_PATH, "readJson", {
    AbortController,
    CANONICAL_SUMMARY_RESPONSE_MAX_BYTES: 64 * 1024 * 1024,
    INTERNAL_VERIFIER_TOKEN: internalToken,
    REQUEST_RETRIES: 4,
    REQUEST_TIMEOUT_MS: 60_000,
    clearTimeout,
    fetch: async (url, options) => {
      fetchCalls.push({ options, url });
      return {
        json: async () => ({ source: "fetch" }),
        ok: true,
        status: 200,
      };
    },
    readCanonicalSummaryJsonViaLoopbackHttp: async (url, options) => {
      canonicalCalls.push({ options, url });
      return { source: "node-http" };
    },
    setTimeout,
  });

  const canonical = await readJson(
    new URL(
      "http://127.0.0.1:8081/api/v1/internal/canonical-summary?network=livenet",
    ),
    { retries: 0, timeoutMs: 600_000 },
  );
  assert.equal(canonical.source, "node-http");
  assert.equal(canonicalCalls.length, 1);
  assert.equal(fetchCalls.length, 0);
  assert.equal(canonicalCalls[0].options.maxBytes, 64 * 1024 * 1024);
  assert.equal(
    canonicalCalls[0].options.headers["X-PoW-Internal-Verifier"],
    internalToken,
  );
  assert.ok(canonicalCalls[0].options.signal instanceof AbortSignal);

  const ipv6Canonical = await readJson(
    new URL("http://[::1]:8081/api/v1/internal/canonical-summary"),
    { retries: 0, timeoutMs: 600_000 },
  );
  assert.equal(ipv6Canonical.source, "node-http");
  assert.equal(canonicalCalls.length, 2);
  assert.equal(fetchCalls.length, 0);

  const otherInternal = await readJson(
    new URL(
      "http://127.0.0.1:8081/api/v1/internal/token-verifier?network=livenet",
    ),
    { retries: 0, timeoutMs: 1_000 },
  );
  assert.equal(otherInternal.source, "fetch");
  assert.equal(canonicalCalls.length, 2);
  assert.equal(fetchCalls.length, 1);
  assert.equal(
    fetchCalls[0].options.headers["X-PoW-Internal-Verifier"],
    internalToken,
  );
});

check("canonical summary node:http waits for headers under the caller abort budget", async () => {
  let capturedOptions = null;
  let ended = false;
  const readCanonicalSummaryJsonViaLoopbackHttp = isolatedFunction(
    BACKFILL_PATH,
    "readCanonicalSummaryJsonViaLoopbackHttp",
    {
      Buffer,
      CANONICAL_SUMMARY_RESPONSE_MAX_BYTES: 64 * 1024 * 1024,
      httpRequest: (_url, options, onResponse) => {
        capturedOptions = options;
        const request = new EventEmitter();
        request.destroy = () => {};
        request.end = () => {
          ended = true;
          setImmediate(() => {
            const body = Buffer.from('{"ok":true}', "utf8");
            const response = new EventEmitter();
            response.destroy = () => {};
            response.complete = true;
            response.headers = { "content-length": String(body.length) };
            response.resume = () => {};
            response.statusCode = 200;
            onResponse(response);
            setImmediate(() => {
              response.emit("data", body);
              response.emit("end");
            });
          });
        };
        return request;
      },
    },
  );
  const controller = new AbortController();
  const result = await readCanonicalSummaryJsonViaLoopbackHttp(
    new URL("http://127.0.0.1:8081/api/v1/internal/canonical-summary"),
    {
      headers: { "X-PoW-Internal-Verifier": "x".repeat(64) },
      signal: controller.signal,
    },
  );
  assert.equal(result.ok, true);
  assert.equal(ended, true);
  assert.equal(capturedOptions.agent, false);
  assert.equal(capturedOptions.method, "GET");
  assert.equal(capturedOptions.signal, controller.signal);
  assert.equal(
    capturedOptions.headers["X-PoW-Internal-Verifier"],
    "x".repeat(64),
  );
  assert.equal("timeout" in capturedOptions, false);
  assert.equal("headersTimeout" in capturedOptions, false);
});

check("canonical summary node:http preserves status semantics and caps bodies", async () => {
  const responses = [];
  const readCanonicalSummaryJsonViaLoopbackHttp = isolatedFunction(
    BACKFILL_PATH,
    "readCanonicalSummaryJsonViaLoopbackHttp",
    {
      Buffer,
      CANONICAL_SUMMARY_RESPONSE_MAX_BYTES: 64 * 1024 * 1024,
      httpRequest: (_url, _options, onResponse) => {
        const request = new EventEmitter();
        request.destroy = () => {};
        request.end = () => {
          const spec = responses.shift();
          queueMicrotask(() => {
            const response = new EventEmitter();
            response.destroy = () => {};
            response.headers = spec.headers ?? {};
            response.resume = () => {
              spec.resumed = true;
            };
            response.statusCode = spec.statusCode;
            response.complete = spec.complete ?? spec.end !== false;
            onResponse(response);
            for (const chunk of spec.chunks ?? []) {
              response.emit("data", chunk);
            }
            if (spec.end !== false) {
              response.emit("end");
            }
            if (spec.close === true) {
              response.emit("close");
            }
          });
        };
        return request;
      },
    },
  );
  const url = new URL(
    "http://127.0.0.1:8081/api/v1/internal/canonical-summary",
  );

  responses.push({
    chunks: [],
    headers: { "content-length": "9" },
    statusCode: 200,
  });
  const declaredTooLarge = await rejection(
    readCanonicalSummaryJsonViaLoopbackHttp(url, { maxBytes: 8 }),
    (error) => error?.code === "POW_CANONICAL_SUMMARY_RESPONSE_TOO_LARGE",
  );
  assert.equal(declaredTooLarge.maxBytes, 8);
  assert.equal(declaredTooLarge.receivedBytes, 9);

  responses.push({
    chunks: [Buffer.from("12345"), Buffer.from("6789")],
    statusCode: 200,
  });
  const streamedTooLarge = await rejection(
    readCanonicalSummaryJsonViaLoopbackHttp(url, { maxBytes: 8 }),
    (error) => error?.code === "POW_CANONICAL_SUMMARY_RESPONSE_TOO_LARGE",
  );
  assert.equal(streamedTooLarge.receivedBytes, 9);

  responses.push({
    chunks: [Buffer.from("truncated")],
    close: true,
    complete: false,
    end: false,
    statusCode: 200,
  });
  await rejection(
    readCanonicalSummaryJsonViaLoopbackHttp(url, { maxBytes: 1_024 }),
    (error) => error?.code === "POW_CANONICAL_SUMMARY_RESPONSE_INCOMPLETE",
  );

  responses.push({
    chunks: [Buffer.from("ended-but-incomplete")],
    complete: false,
    statusCode: 200,
  });
  await rejection(
    readCanonicalSummaryJsonViaLoopbackHttp(url, { maxBytes: 1_024 }),
    (error) => error?.code === "POW_CANONICAL_SUMMARY_RESPONSE_INCOMPLETE",
  );

  const errorBody = '{"error":"still building"}';
  responses.push({
    chunks: [Buffer.from(errorBody)],
    headers: { "content-length": String(Buffer.byteLength(errorBody)) },
    statusCode: 503,
  });
  const httpError = await rejection(
    readCanonicalSummaryJsonViaLoopbackHttp(url, { maxBytes: 1_024 }),
    (error) => error?.statusCode === 503,
  );
  assert.equal(httpError.message, `${url.pathname} returned HTTP 503`);
  assert.equal(httpError.responseText, errorBody);

  const notFound = {
    chunks: [Buffer.from("not found")],
    headers: { "content-length": "9" },
    statusCode: 404,
  };
  responses.push(notFound);
  const allowed = await readCanonicalSummaryJsonViaLoopbackHttp(url, {
    allowNotFound: true,
    maxBytes: 9,
  });
  assert.equal(Array.isArray(allowed.items), true);
  assert.equal(allowed.items.length, 0);

  responses.push({
    chunks: [],
    headers: { "content-length": "10" },
    statusCode: 404,
  });
  await rejection(
    readCanonicalSummaryJsonViaLoopbackHttp(url, {
      allowNotFound: true,
      maxBytes: 9,
    }),
    (error) => error?.code === "POW_CANONICAL_SUMMARY_RESPONSE_TOO_LARGE",
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
  const canonicalSummaryAccountingModelsCurrent = () => true;
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
      CANONICAL_SUMMARY_REFRESH_TIMEOUT_MS: 600_000,
      NETWORK: "livenet",
      REQUIRED_CURRENT_SUMMARY_KEYS: requiredKeys,
      canonicalSummaryAccountingModelsCurrent,
      canonicalSummaryCoverage,
      createHash,
      latestBlockScanCheckpoint: async () => ({ height: 101 }),
      numberOrNull,
      objectPayload,
      publicLogRelationalFingerprint: async () => ({
        contract: "proof-index-public-log-fingerprint-v1",
        count: 1,
        hash: "f".repeat(64),
        pending: 0,
      }),
      publicLogFingerprintsMatch: (left, right) => left?.hash === right?.hash,
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

check("exact stored bond snapshots serve stable and fresh reads before recovery", async () => {
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
  assert.match(
    bondSummarySource,
    /if \(network === "livenet"\)[\s\S]*currentProofIndexSummarySnapshotFallbackPayload/u,
  );
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
  let exactInfinityReads = 0;
  let relationalInfinityReads = 0;
  let canonicalLedgerReads = 0;
  let currentLedger = null;
  const relationalLedgers = [];
  const readBondSummary = isolatedFunction(
    API_PATH,
    "bondSummaryPayload",
    {
      LEDGER_SUMMARY_FRESH_WAIT_MS: 1_000,
      bondSummaryFromCanonicalLedger: async () => null,
      currentProofIndexSummarySnapshotFallbackPayload: async () => {
        exactInfinityReads += 1;
        return exactInfinity;
      },
      existingCurrentCanonicalLedgerPayloadWithinMs: async () => currentLedger,
      freshDataUnavailableError: (message) => new Error(message),
      numericValue: (value) => Number(value) || 0,
      payloadWithFallbackAfterMs: async (promise, fallback) =>
        (await promise) ?? fallback,
      proofIndexBondSummaryPayload: async (_network, _fresh, _config, ledger) => {
        relationalInfinityReads += 1;
        relationalLedgers.push(ledger);
        return relationalInfinity;
      },
      standaloneBondSummaryPayload: async () => null,
      summaryCanonicalLedgerPayload: async () => {
        canonicalLedgerReads += 1;
        return { marker: "fresh-ledger" };
      },
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
    canonicalInfinity,
  );
  assert.equal(exactInfinityReads, 2);
  assert.equal(relationalInfinityReads, 0);
  assert.equal(canonicalLedgerReads, 0);
  exactInfinity = null;
  assert.equal(
    await readBondSummary("livenet", false, infinityConfig),
    relationalInfinity,
  );
  assert.equal(
    await readBondSummary("livenet", true, infinityConfig),
    relationalInfinity,
  );
  assert.equal(exactInfinityReads, 4);
  assert.equal(relationalInfinityReads, 2);
  assert.equal(canonicalLedgerReads, 1);
  assert.equal(relationalLedgers[0], null);
  assert.equal(relationalLedgers[1]?.marker, "fresh-ledger");
  currentLedger = { marker: "exact-current-ledger" };
  assert.equal(
    await readBondSummary("livenet", true, infinityConfig),
    relationalInfinity,
  );
  assert.equal(exactInfinityReads, 5);
  assert.equal(canonicalLedgerReads, 1);
  assert.equal(relationalLedgers[2]?.marker, "exact-current-ledger");
});

check("exact listing misses bypass chain recovery only with terminal database proof", async () => {
  const txid = "6".repeat(64);
  let terminal = true;
  const sqlReads = [];
  const pool = {
    async query(sql) {
      sqlReads.push(sql);
      if (sql.includes("AS terminal")) {
        return { rows: [{ terminal }] };
      }
      return { rows: [{ indexed_at: null, total_count: 0 }] };
    },
  };
  const exactActiveTokenListingHistoryPage = isolatedFunction(
    READER_PATH,
    "exactActiveTokenListingHistoryPage",
    {
      activeTokenListingHistoryItem: () => true,
      compareTokenHistoryMarketItems: () => 0,
      dateIso: (value) => value ?? "2026-07-13T00:00:00.000Z",
      normalizedTxid: (value) =>
        /^[0-9a-f]{64}$/u.test(String(value ?? "")) ? String(value) : "",
      rowNumber: (row, key) => Number(row?.[key]) || 0,
      tokenHistoryFilterNeedles: () => [txid],
      tokenHistoryPageFromItems: (options) => ({
        indexedThroughBlock: options.indexedThroughBlock,
        items: options.items,
        snapshotId: options.snapshot?.snapshot_id,
        source: options.source,
        totalCount: options.items.length,
      }),
      tokenScopeKey: (value) => String(value ?? "").toLowerCase(),
    },
  );
  const pagination = { limit: 20, offset: 0, query: txid };
  const snapshot = {
    generated_at: "2026-07-13T00:00:00.000Z",
    indexed_through_block: 957913,
    snapshot_id: "current",
  };
  const terminalPage = await exactActiveTokenListingHistoryPage(
    pool,
    "livenet",
    "work",
    new URLSearchParams({ q: txid }),
    pagination,
    snapshot,
  );
  assert.equal(terminalPage.totalCount, 0);
  assert.equal(terminalPage.indexedThroughBlock, 957913);
  assert.equal(terminalPage.source, "proof-indexer-credit-listings-terminal");
  assert.match(sqlReads[0], /cl\.sale_ticket_txid = ANY/u);
  assert.match(sqlReads[0], /cl\.seal_txid = ANY/u);
  assert.match(sqlReads[0], /cl\.close_txid = ANY/u);
  assert.match(sqlReads[1], /terminal_tx\.status IN \('dropped', 'orphaned'\)/u);

  terminal = false;
  sqlReads.length = 0;
  assert.equal(
    await exactActiveTokenListingHistoryPage(
      pool,
      "livenet",
      "work",
      new URLSearchParams({ q: txid }),
      pagination,
      snapshot,
    ),
    null,
  );
  assert.equal(sqlReads.length, 2);

  const readerSource = topLevelFunctionSource(
    READER_PATH,
    "proofIndexTokenHistoryPayload",
  );
  assert.ok(
    readerSource.indexOf("exactActiveTokenListingHistoryPage") <
      readerSource.indexOf("proofIndexTokenMarketHistoryOverlayPayload"),
  );
});

check("exact Log txid reads use indexed refs and trust an exact empty page", async () => {
  const txid = "7".repeat(64);
  const queryReads = [];
  const proofIndexLogHistoryPayload = isolatedFunction(
    READER_PATH,
    "proofIndexLogHistoryPayload",
    {
      PUBLIC_LOG_EVENT_KINDS: new Set(["token-mint"]),
      dateIso: (value) => value,
      eventKindSqlCondition: (kind, addValue) =>
        `e.kind = ${addValue(kind)}`,
      indexedThroughBlockFromItems: () => undefined,
      ledgerSnapshotMetadata: async () => ({
        generated_at: "2026-07-13T00:00:00.000Z",
        indexed_through_block: 957913,
        snapshot_id: "current",
      }),
      logHistoryPageFromItems: (options) => ({
        indexedThroughBlock: options.indexedThroughBlock,
        items: options.items,
        source: options.source,
        totalCount: options.items.length,
      }),
      normalizeHistoryEventRows: (rows) => rows,
      normalizedTxid: (value) =>
        /^[0-9a-f]{64}$/u.test(String(value ?? "")) ? String(value) : "",
      proofIndexLogHistoryReadEligibility: () => ({
        pagination: {
          limit: 5,
          offset: 0,
          query: txid,
          snapshotId: "",
        },
      }),
      proofIndexPool: () => ({
        async query(sql, params) {
          queryReads.push({ params, sql });
          if (sql.includes("invalid_event_count")) {
            return {
              rows: [{
                block_height: 955618,
                event_count: 1,
                has_raw_tx: true,
                invalid_event_count: 1,
                public_event_count: 0,
                status: "confirmed",
              }],
            };
          }
          return { rows: [] };
        },
      }),
      rowNumber: (row, key) => Number(row?.[key]) || 0,
    },
  );
  const result = await proofIndexLogHistoryPayload(
    "livenet",
    "",
    new URLSearchParams({ q: txid }),
  );
  assert.equal(result.totalCount, 0);
  assert.equal(result.indexedThroughBlock, 957913);
  assert.equal(result.queryDisposition, "confirmed-invalid-nonpublic");
  assert.match(queryReads[0].sql, /WITH matched_events AS/u);
  assert.match(queryReads[0].sql, /proof_indexer\.event_refs/u);
  assert.doesNotMatch(queryReads[0].sql, /payload @>/u);
  assert.equal(queryReads[0].params[2], txid);
  assert.match(queryReads[1].sql, /public_event_count/u);
  const nonpublicFilter = await proofIndexLogHistoryPayload(
    "livenet",
    "token-event-invalid",
    new URLSearchParams({ q: txid }),
  );
  assert.equal(nonpublicFilter.totalCount, 0);
  assert.equal(nonpublicFilter.queryDisposition, "nonpublic-kind-filter");
  assert.equal(queryReads.length, 3);
  assert.doesNotMatch(
    topLevelFunctionSource(API_PATH, "handleRequest"),
    /shouldUseCanonicalTxidFallback/u,
  );
  assert.match(
    topLevelFunctionSource(API_PATH, "handleRequest"),
    /exactLogHistoryMissPayload/u,
  );
});

check("ambiguous exact Log misses fail fast instead of scanning all history", async () => {
  let indexedStatus = null;
  const exactLogHistoryMissPayload = isolatedFunction(
    API_PATH,
    "exactLogHistoryMissPayload",
    {
      SUMMARY_PROOF_INDEX_READ_WAIT_MS: 100,
      errorSummary: (error) => String(error?.message ?? error),
      freshDataUnavailableError: (message) => {
        const error = new Error(message);
        error.statusCode = 503;
        return error;
      },
      payloadWithFallbackAfterMs: async (promise, fallback) =>
        (await promise) ?? fallback,
      proofIndexTxStatusPayload: async () => indexedStatus,
    },
  );
  const txid = "8".repeat(64);
  const emptyPage = { items: [], totalCount: 0 };
  assert.equal(
    (
      await exactLogHistoryMissPayload(
        emptyPage,
        "livenet",
        txid,
      )
    ).queryDisposition,
    "not-indexed-proof-event",
  );
  indexedStatus = { status: "dropped" };
  assert.equal(
    (
      await exactLogHistoryMissPayload(
        emptyPage,
        "livenet",
        txid,
      )
    ).queryDisposition,
    "terminal-nonpublic",
  );
  indexedStatus = { status: "confirmed" };
  const error = await rejection(
    exactLogHistoryMissPayload(emptyPage, "livenet", txid),
    (candidate) => candidate?.statusCode === 503,
  );
  assert.equal(error.details.code, "CANONICAL_LOG_PROJECTION_MISSING");
});

check("transaction status trusts only canonical block-backed confirmations", async () => {
  let row = {
    block_canonical: true,
    block_hash: "a".repeat(64),
    block_height: 123,
    block_time: "2026-07-14T00:00:00.000Z",
    canonical_scan_proof: true,
    first_seen_at: "2026-07-13T23:55:00.000Z",
    status: "confirmed",
    txid: "1".repeat(64),
    updated_at: "2026-07-14T00:00:00.000Z",
  };
  const readStatus = isolatedFunction(
    READER_PATH,
    "proofIndexTxStatusPayload",
    {
      BITCOIN_GENESIS_TIME_MS: Date.UTC(2009, 0, 3, 18, 15, 5),
      dateIso: (value) => new Date(value).toISOString(),
      normalizedStatus: (value) => String(value ?? "").toLowerCase(),
      proofIndexPool: () => ({
        async query() {
          return { rows: row ? [row] : [] };
        },
      }),
    },
  );

  const confirmedStatus = await readStatus(row.txid, "livenet");
  assert.equal(confirmedStatus?.status, "confirmed");
  assert.equal(confirmedStatus?.contract, "proof-of-work-tx-status-v2");
  assert.equal(confirmedStatus?.canonical, true);
  assert.equal(confirmedStatus?.blockHash, "a".repeat(64));
  assert.equal(confirmedStatus?.blockHeight, 123);
  assert.equal(confirmedStatus?.blockTime, "2026-07-14T00:00:00.000Z");
  row = { ...row, block_height: null };
  assert.equal(await readStatus(row.txid, "livenet"), null);
  row = { ...row, block_height: 123, block_canonical: false };
  assert.equal(await readStatus(row.txid, "livenet"), null);
  row = {
    ...row,
    block_canonical: true,
    block_hash: null,
    block_height: null,
    block_time: null,
    canonical_scan_proof: false,
    status: "pending",
  };
  assert.equal(await readStatus(row.txid, "livenet"), null);
  const pendingStatus = await readStatus(row.txid, "livenet", {
    includeUnconfirmed: true,
  });
  assert.equal(pendingStatus?.status, "pending");
  assert.equal(pendingStatus?.mempoolSeen, true);
  assert.equal(
    pendingStatus?.mempoolFirstSeenAt,
    "2026-07-13T23:55:00.000Z",
  );
});

check("authoritative transaction status distinguishes proof from dependency failure", async () => {
  const txid = "1".repeat(64);
  const blockHash = "a".repeat(64);
  const unavailableError = (message) => {
    const error = new Error(message);
    error.statusCode = 503;
    return error;
  };
  const confirmedStatus = isolatedFunction(
    API_PATH,
    "bitcoinCoreTxStatusPayload",
    {
      bitcoinRpc: async (method) => {
        if (method === "getrawtransaction") {
          return {
            ok: true,
            result: { blockhash: blockHash, confirmations: 2, txid },
          };
        }
        if (method === "getblockheader") {
          return {
            ok: true,
            result: {
              confirmations: 2,
              hash: blockHash,
              height: 123,
              time: 1_783_000_000,
            },
          };
        }
        if (method === "getblock") {
          return {
            ok: true,
            result: { hash: blockHash, height: 123, tx: [txid] },
          };
        }
        if (method === "getblockhash") {
          return { ok: true, result: blockHash };
        }
        assert.fail(`unexpected RPC method ${method}`);
      },
      errorSummary: (error) => error.message,
      freshDataUnavailableError: unavailableError,
    },
  );
  const confirmed = await confirmedStatus(txid, "livenet");
  assert.equal(confirmed.status, "confirmed");
  assert.equal(confirmed.canonical, true);
  assert.equal(confirmed.blockHash, blockHash);
  assert.equal(confirmed.blockHeight, 123);
  assert.equal(confirmed.contract, "proof-of-work-tx-status-v2");

  const pendingStatus = isolatedFunction(
    API_PATH,
    "bitcoinCoreTxStatusPayload",
    {
      bitcoinRpc: async (method) =>
        method === "getrawtransaction"
          ? { ok: true, result: { confirmations: 0, txid } }
          : { ok: true, result: { time: 1_783_000_000 } },
      errorSummary: (error) => error.message,
      freshDataUnavailableError: unavailableError,
    },
  );
  const pending = await pendingStatus(txid, "livenet");
  assert.equal(pending.status, "pending");
  assert.equal(pending.mempoolSeen, true);
  assert.equal(
    pending.mempoolFirstSeenAt,
    new Date(1_783_000_000_000).toISOString(),
  );

  const absentStatus = isolatedFunction(
    API_PATH,
    "bitcoinCoreTxStatusPayload",
    {
      bitcoinRpc: async (method) => {
        if (method === "getrawtransaction" || method === "getmempoolentry") {
          return { error: { code: -5 }, ok: false };
        }
        if (method === "getindexinfo") {
          return {
            ok: true,
            result: {
              txindex: { best_block_height: 123, synced: true },
            },
          };
        }
        return {
          ok: true,
          result: {
            blocks: 123,
            chain: "main",
            headers: 123,
            initialblockdownload: false,
            pruned: false,
            verificationprogress: 1,
          },
        };
      },
      errorSummary: (error) => error.message,
      freshDataUnavailableError: unavailableError,
    },
  );
  const absent = await absentStatus(txid, "livenet");
  assert.equal(absent.status, "dropped");
  assert.equal(absent.absenceProven, true);

  const missingTxindexStatus = isolatedFunction(
    API_PATH,
    "bitcoinCoreTxStatusPayload",
    {
      bitcoinRpc: async (method) => {
        if (method === "getrawtransaction" || method === "getmempoolentry") {
          return { error: { code: -5 }, ok: false };
        }
        if (method === "getindexinfo") {
          return { ok: true, result: {} };
        }
        return {
          ok: true,
          result: {
            blocks: 123,
            chain: "main",
            headers: 123,
            initialblockdownload: false,
            pruned: false,
            verificationprogress: 1,
          },
        };
      },
      errorSummary: (error) => error.message,
      freshDataUnavailableError: unavailableError,
    },
  );
  await rejection(
    missingTxindexStatus(txid, "livenet"),
    (error) =>
      error.statusCode === 503 && error.details?.code === "TX_STATUS_UNAVAILABLE",
  );

  const unavailableStatus = isolatedFunction(
    API_PATH,
    "bitcoinCoreTxStatusPayload",
    {
      bitcoinRpc: async () => {
        throw new Error("rpc timeout");
      },
      errorSummary: (error) => error.message,
      freshDataUnavailableError: unavailableError,
    },
  );
  const failure = await rejection(
    unavailableStatus(txid, "livenet"),
    (error) =>
      error.statusCode === 503 && error.details?.code === "TX_STATUS_UNAVAILABLE",
  );
  assert.match(failure.message, /lookup failed/iu);
});

check("pending transaction times never turn zero into the Unix epoch", () => {
  const serverTime = isolatedFunction(API_PATH, "tokenTransactionTime");
  const clientTime = isolatedTypeScriptFunction(APP_PATH, "tokenTransactionTime");
  const mempoolSeconds = 1_783_000_000;
  for (const transactionTime of [serverTime, clientTime]) {
    assert.equal(
      transactionTime({
        status: { block_time: 0, mempool_time: mempoolSeconds },
      }),
      mempoolSeconds * 1000,
    );
    assert.ok(transactionTime({ status: { block_time: 0 } }) > 1_230_768_905_000);
  }

  const plausibleTime = isolatedFunction(
    READER_PATH,
    "plausibleBitcoinEventTime",
    { BITCOIN_GENESIS_TIME_MS: Date.UTC(2009, 0, 3, 18, 15, 5) },
  );
  assert.equal(
    plausibleTime(
      "1970-01-01T00:00:00.000Z",
      "2026-07-12T04:11:53.155Z",
    ),
    "2026-07-12T04:11:53.155Z",
  );
});

check("canonical confirmed events reject stale non-confirmed upserts", () => {
  const source = fileSource(BACKFILL_PATH);
  assert.match(
    source,
    /proof_indexer\.events\.status = 'confirmed'[\s\S]*EXCLUDED\.status <> 'confirmed'[\s\S]*canonical_transaction\.raw_tx \? 'canonicalBlockScan'/u,
  );
  assert.match(
    source,
    /if \(result\.rows\.length === 0\)[\s\S]*canonicalConfirmed: true/u,
  );
});

check("synthetic bond definitions are not indexed as Bitcoin transactions", () => {
  const powbTokenId =
    "a3d0bc8528f91dfc52400a885bed7e49235396aa82aa9f95db41be629f1d5562";
  const incbTokenId =
    "3cb25745f937f2b4e5508e5400189fe8fe679cd8e84bfa1e9176d70c9761f15d";
  const itemTxid = isolatedFunction(BACKFILL_PATH, "itemTxid", {
    BOND_TOKEN_IDS: new Set([powbTokenId, incbTokenId]),
    isHexTxid: (value) => /^[0-9a-f]{64}$/u.test(String(value ?? "")),
  });
  assert.equal(itemTxid({ tokenId: powbTokenId, txid: powbTokenId }), "");
  assert.equal(itemTxid({ tokenId: incbTokenId }), "");
  assert.equal(
    itemTxid({ tokenId: powbTokenId, txid: "9".repeat(64) }),
    "9".repeat(64),
  );
  assert.equal(itemTxid({ tokenId: "8".repeat(64) }), "8".repeat(64));
});

check("Log coverage separates the latest event from the verified checkpoint", async () => {
  const compact = isolatedFunction(API_PATH, "compactActivitySummaryPayload", {
    SUMMARY_ACTIVITY_LIMIT: 10,
    activityStatsFromItems: (_items, stats) => stats,
    indexedThroughBlockFromItems: () => 100,
    recentByCreatedAt: (items) => items,
  });
  const summary = compact(
    {
      activity: [{ blockHeight: 100 }],
      stats: { indexedThroughBlock: 100, total: 1 },
    },
    105,
  );
  assert.equal(summary.stats.latestEventBlock, 100);
  assert.equal(summary.stats.indexedThroughBlock, 105);

  let pageTotal = 1;
  const freshPage = isolatedFunction(
    API_PATH,
    "freshProofIndexLogHistoryPayload",
    {
      activitySummaryPayload: async () => ({ marker: "summary" }),
      freshDataUnavailableError: (message) => {
        const error = new Error(message);
        error.statusCode = 503;
        return error;
      },
      payloadIndexedThroughBlockHash: (payload) =>
        payload.indexedThroughBlockHash ?? "",
      payloadSnapshotId: (payload) => payload.snapshotId ?? "",
      proofIndexLogHistoryPayload: async () => ({
        indexedThroughBlock: 105,
        items: [{}],
        latestEventBlock: 100,
        snapshotId: "snapshot-105",
        snapshotTotalCount: pageTotal,
        totalCount: pageTotal,
      }),
      proofIndexLogHistoryReadEligibility: () => ({
        pagination: { query: "", snapshotId: "" },
      }),
      proofIndexPayloadIndexedThroughBlock: (payload) =>
        Number(payload.indexedThroughBlock) || 0,
      summaryPayloadWithCanonicalProvenance: async () => ({
        consistency: { ok: true },
        indexedThroughBlock: 105,
        indexedThroughBlockHash: "a".repeat(64),
        provenance: { ready: true },
        snapshotId: "snapshot-105",
        stats: { total: 1 },
        totalCount: 1,
      }),
      verifiedFreshLogCheckpointAfterRead: async () => ({ exactTip: true }),
    },
  );
  const page = await freshPage("livenet", "", new URLSearchParams("limit=1"));
  assert.equal(page.indexedThroughBlock, 105);
  assert.equal(page.latestEventBlock, 100);
  assert.equal(page.provenance.surface, "log-history");

  pageTotal = 2;
  const error = await rejection(
    freshPage("livenet", "", new URLSearchParams("limit=1")),
    (candidate) => candidate?.details?.code === "CANONICAL_LOG_HISTORY_MISMATCH",
  );
  assert.equal(error.statusCode, 503);

  const canonicalFullItems = [
    {
      blockHash: "b".repeat(64),
      canonicalMinerFeeCovered: true,
      canonicalMinerFeeSats: 846,
      confirmed: true,
    },
    { confirmed: false },
  ];
  let fullItems = canonicalFullItems;
  let postReadCurrent = true;
  const freshFull = isolatedFunction(API_PATH, "freshProofIndexLogPayload", {
    activityStatsFromItems: (items, stats) => ({
      ...stats,
      pending: items.filter((item) => !item.confirmed).length,
      total: items.length,
    }),
    activitySummaryPayload: async () => ({ marker: "summary" }),
    freshDataUnavailableError: (message) => {
      const candidate = new Error(message);
      candidate.statusCode = 503;
      return candidate;
    },
    payloadIndexedThroughBlockHash: (payload) =>
      payload.indexedThroughBlockHash ?? "",
    payloadSnapshotId: (payload) => payload.snapshotId ?? "",
    proofIndexCanonicalActivityPayload: async () => ({
      activity: fullItems,
      canonicalMinerFeeCoverage: { complete: true },
      indexedThroughBlock: 105,
      latestEventBlock: 100,
      ledgerGeneratedAt: "2026-07-14T12:00:00.000Z",
      snapshotId: "snapshot-105",
      snapshotTotalCount: 2,
      source: "proof-indexer-events",
      totalCount: 2,
    }),
    proofIndexPayloadIndexedThroughBlock: (payload) =>
      Number(payload.indexedThroughBlock) || 0,
    summaryPayloadWithCanonicalProvenance: async () => ({
      consistency: { ok: true },
      indexedAt: "2026-07-14T12:00:00.000Z",
      indexedThroughBlock: 105,
      indexedThroughBlockHash: "a".repeat(64),
      ledgerGeneratedAt: "2026-07-14T12:00:00.000Z",
      provenance: { ready: true },
      snapshotId: "snapshot-105",
      stats: { latestEventBlock: 100, pending: 1, total: 2 },
      totalCount: 2,
    }),
    verifiedCanonicalMinerFeeCoverage: (value) =>
      value?.complete === true ? value : null,
    verifiedFreshLogCheckpointAfterRead: async () => {
      if (!postReadCurrent) {
        const candidate = new Error("Tip changed.");
        candidate.details = { code: "CANONICAL_LOG_TIP_CHANGED" };
        candidate.statusCode = 503;
        throw candidate;
      }
      return { exactTip: true };
    },
  });
  const fullPayload = await freshFull("livenet");
  assert.equal(fullPayload.activity.length, 2);
  assert.equal(fullPayload.indexedThroughBlock, 105);
  assert.equal(fullPayload.provenance.surface, "log");
  assert.equal(fullPayload.stats.pending, 1);
  assert.equal(fullPayload.activity[0].blockHash, "b".repeat(64));
  assert.equal(fullPayload.activity[0].canonicalMinerFeeSats, 846);
  assert.equal(fullPayload.activity[0].canonicalMinerFeeCovered, true);
  assert.equal(fullPayload.activity[1].blockHash, undefined);
  assert.equal(fullPayload.canonicalMinerFeeCoverage.complete, true);
  assert.equal(
    fullPayload.stats.canonicalMinerFeeCoverage.complete,
    true,
  );

  fullItems = [{ confirmed: true }, { confirmed: true }];
  const fullError = await rejection(
    freshFull("livenet"),
    (candidate) => candidate?.details?.code === "CANONICAL_LOG_MISMATCH",
  );
  assert.equal(fullError.statusCode, 503);

  fullItems = canonicalFullItems;
  postReadCurrent = false;
  const tipRaceError = await rejection(
    freshFull("livenet"),
    (candidate) => candidate?.details?.code === "CANONICAL_LOG_TIP_CHANGED",
  );
  assert.equal(tipRaceError.statusCode, 503);
});

check("fresh Log post-read checkpoint detects an exact-tip race", async () => {
  let exactTip = true;
  const checkpointHash = "a".repeat(64);
  const verifyAfterRead = isolatedFunction(
    API_PATH,
    "verifiedFreshLogCheckpointAfterRead",
    {
      freshDataUnavailableError: (message) => {
        const error = new Error(message);
        error.statusCode = 503;
        return error;
      },
      payloadIndexedThroughBlockHash: (payload) =>
        payload.indexedThroughBlockHash,
      payloadSnapshotId: (payload) => payload.snapshotId,
      proofIndexPayloadIndexedThroughBlock: (payload) =>
        payload.indexedThroughBlock,
      verifiedSummaryPayloadCheckpoint: async () => ({
        exactTip,
        indexedThroughBlock: 105,
        indexedThroughBlockHash: checkpointHash,
      }),
    },
  );
  const summary = {
    indexedThroughBlock: 105,
    indexedThroughBlockHash: checkpointHash,
    snapshotId: "snapshot-105",
  };
  assert.equal(
    (await verifyAfterRead(summary, "livenet", "log")).exactTip,
    true,
  );
  exactTip = false;
  const error = await rejection(
    verifyAfterRead(summary, "livenet", "log"),
    (candidate) => candidate?.details?.code === "CANONICAL_LOG_TIP_CHANGED",
  );
  assert.equal(error.statusCode, 503);
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
    canonicalMinerFeeCoverage: {
      complete: true,
      confirmedEvents: 1,
      confirmedTransactions: 1,
      coveredConfirmedEvents: 1,
      coveredConfirmedTransactions: 1,
      missingConfirmedEvents: 0,
      missingConfirmedTransactions: 0,
      missingConfirmedTxids: [],
      source: "proof-indexer-normalized-input-output-totals",
    },
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
      verifiedCanonicalMinerFeeCoverage: isolatedFunction(
        API_PATH,
        "verifiedCanonicalMinerFeeCoverage",
      ),
    },
  );
  assert.equal(
    await indexedActivityStateForCanonicalLedger("livenet", {
      exactHeight: 101,
    }),
    null,
  );
  const exactActivity = await indexedActivityStateForCanonicalLedger(
    "livenet",
    {
      exactHeight: 100,
    },
  );
  assert.equal(exactActivity.indexedThroughBlock, 100);
  assert.equal(exactActivity.activity[0].txid, activityPayload.activity[0].txid);
  assert.equal(exactActivity.canonicalMinerFeeCoverage.complete, true);
  assert.equal(exactActivity.canonicalMinerFeeCoverage.confirmedEvents, 1);
  activityPayload.canonicalMinerFeeCoverage = {
    complete: false,
    missingConfirmedTransactions: 1,
  };
  assert.equal(
    await indexedActivityStateForCanonicalLedger("livenet", {
      exactHeight: 100,
    }),
    null,
  );
  assert.equal(
    await indexedActivityStateForCanonicalLedger("livenet", {
      exactHeight: 100,
      requireCanonicalMinerFeeCoverage: false,
    }),
    activityPayload,
    "nonfinancial Log reads may retain canonical activity visibility",
  );
  activityPayload.canonicalMinerFeeCoverage = {
    complete: true,
    confirmedEvents: 1,
    confirmedTransactions: 1,
    coveredConfirmedEvents: 1,
    coveredConfirmedTransactions: 1,
    missingConfirmedEvents: 0,
    missingConfirmedTransactions: 0,
    missingConfirmedTxids: [],
    source: "proof-indexer-normalized-input-output-totals",
  };

  let livenetFallbackReads = 0;
  const activityStateForCanonicalLedger = isolatedFunction(
    API_PATH,
    "activityStateForCanonicalLedger",
    {
      ENABLE_GLOBAL_ACTIVITY_CRAWL: true,
      cachedGlobalActivityPayloadNoRefresh: async () => {
        livenetFallbackReads += 1;
        return { source: "cache" };
      },
      freshDataUnavailableError: (message) => {
        const error = new Error(message);
        error.statusCode = 503;
        return error;
      },
      globalActivityPayload: async () => {
        livenetFallbackReads += 1;
        return { source: "crawl" };
      },
      indexedActivityStateForCanonicalLedger: async () => null,
    },
  );
  await rejection(
    activityStateForCanonicalLedger("livenet", true),
    (error) => error?.statusCode === 503,
    "financial livenet ledgers must not fall back past fee coverage",
  );
  assert.equal(livenetFallbackReads, 0);

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

check("indexed RUSH history is complete and ordered by canonical blocks", async () => {
  const firstTxid = "1".repeat(64);
  const secondTxid = "2".repeat(64);
  const canonicalRushHistoryEntries = isolatedFunction(
    BACKFILL_PATH,
    "canonicalRushHistoryEntries",
    { isHexTxid: (value) => /^[0-9a-f]{64}$/u.test(String(value)) },
  );
  assert.deepEqual(
    JSON.parse(
      JSON.stringify(
        canonicalRushHistoryEntries(
          [
            { height: 100, tx_hash: secondTxid },
            { height: 0, tx_hash: "3".repeat(64) },
            { height: 102, tx_hash: "4".repeat(64) },
            { height: 100, tx_hash: firstTxid },
          ],
          101,
        ),
      ),
    ),
    [
      { height: 100, txid: firstTxid },
      { height: 100, txid: secondTxid },
    ],
  );
  assert.throws(
    () =>
      canonicalRushHistoryEntries(
        [
          { height: 100, tx_hash: firstTxid },
          { height: 101, tx_hash: firstTxid },
        ],
        101,
      ),
    /conflicting heights/u,
  );
  const rushStateFromIndexedMintEvents = isolatedFunction(
    API_PATH,
    "rushStateFromIndexedMintEvents",
    {
      freshDataUnavailableError: (message) => new Error(message),
      formatRushUnits: (units) => String(units),
      isValidBitcoinAddress: (address) => address.startsWith("bc1"),
      numericValue: (value) => Number(value ?? 0),
      RUSH_MINT_PRICE_SATS: 1_000,
      rushPhaseForOrdinal: (ordinal) => ({ phase: ordinal }),
      rushRewardUnitsForOrdinal: (ordinal) => BigInt(ordinal * 10),
      rushStatsFromMints: (mints) => ({ confirmedMints: mints.length }),
    },
  );
  const indexedItem = (txid, blockIndex) => ({
    blockHeight: 100,
    blockIndex,
    confirmed: true,
    createdAt: "2026-01-01T00:00:00.000Z",
    dataBytes: 11,
    kind: "rush-mint",
    minterAddress: `bc1minter${blockIndex}`,
    paidSats: 1_000,
    registryAddress: "bc1registry",
    txid,
    valid: true,
    validationMode: "canonical-ordered-rush-index",
  });
  const state = rushStateFromIndexedMintEvents(
    [indexedItem(firstTxid, 1), indexedItem(secondTxid, 0)],
    "bc1registry",
    "livenet",
    "2026-01-02T00:00:00.000Z",
  );
  assert.deepEqual(
    JSON.parse(
      JSON.stringify(
        state.mints.map((mint) => [mint.txid, mint.blockIndex, mint.ordinal]),
      ),
    ),
    [
      [firstTxid, 1, 2],
      [secondTxid, 0, 1],
    ],
  );
  assert.equal(state.stats.confirmedMints, 2);
  assert.throws(
    () =>
      rushStateFromIndexedMintEvents(
        [
          {
            ...indexedItem(firstTxid, 0),
            validationMode: "unproven",
          },
        ],
        "bc1registry",
        "livenet",
      ),
    /not canonical/u,
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
      protocolItemsFromTx: (_tx, message) =>
        message?.prefix === "pwr1:"
          ? [{ kind: "rush-mint", protocol: "pwr1" }]
          : assert.fail("unexpected protocol reached the raw block-scan parser"),
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
  assert.equal(aggregated.length, 2);
  assert.equal(aggregated[0].amountSats, "1000");
  assert.equal(aggregated[1].kind, "rush-mint");

  const parseRush = isolatedFunction(BACKFILL_PATH, "protocolItemsFromTx", {
    RUSH_MINT_PAYLOAD: "pwr1:m:rush",
    RUSH_MINT_PRICE_SATS: 1_000n,
    RUSH_REGISTRY_ADDRESS: "bc1rushregistry",
    baseProtocolItem: () => ({
      confirmed: true,
      kind: "rush-mint",
      recipients: [{ address: "bc1rushregistry", amountSats: "1000" }],
      txid: "4".repeat(64),
    }),
    invalidProtocolItem: (item, reason) => ({
      ...item,
      kind: `${item.kind}-invalid`,
      reason,
      valid: false,
    }),
    senderAddressFromTx: () => "bc1rushminter",
  });
  const validRush = parseRush(
    { txid: "4".repeat(64) },
    { prefix: "pwr1:", text: "pwr1:m:rush", voutIndex: 2 },
  );
  assert.equal(validRush[0].kind, "rush-mint");
  assert.equal(validRush[0].valid, true);
  assert.equal(validRush[0].validationMode, "canonical-ordered-rush-index");
  const invalidRush = parseRush(
    { txid: "5".repeat(64) },
    { prefix: "pwr1:", text: "pwr1:m:unknown", voutIndex: 2 },
  );
  assert.equal(invalidRush[0].kind, "rush-mint-invalid");
  assert.equal(invalidRush[0].valid, false);

  const protocolMessagesFromTx = isolatedFunction(
    BACKFILL_PATH,
    "protocolMessagesFromTx",
    {
      PROTOCOL_PREFIXES: ["pwm1:", "pwid1:", "pwr1:", "pwt1:"],
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
  assert.deepEqual(Array.from(scanned, (message) => message.prefix), [
    "pwr1:",
    "pwm1:",
  ]);
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

check("reserved bond credits reject generic create and mint supply", () => {
  const txid = "a".repeat(64);
  const powbTokenId = "b".repeat(64);
  const incbTokenId = "c".repeat(64);
  const bondTags = [
    { ticker: "POWB", tokenId: powbTokenId },
    { ticker: "INCB", tokenId: incbTokenId },
  ];
  const canonicalBondMintProjection = isolatedFunction(
    BACKFILL_PATH,
    "canonicalBondMintProjection",
    { BOND_TAGS: bondTags },
  );
  const reservedBondCreditViolationReason = isolatedFunction(
    BACKFILL_PATH,
    "reservedBondCreditViolationReason",
    {
      BOND_TOKEN_IDS: new Set(bondTags.map((tag) => tag.tokenId)),
      BOND_TOKEN_TICKERS: new Set(bondTags.map((tag) => tag.ticker)),
      canonicalBondMintProjection,
    },
  );

  assert.match(
    reservedBondCreditViolationReason({
      kind: "token-create",
      ticker: "POWB",
      tokenId: txid,
    }),
    /reserved synthetic bond credits/u,
  );
  assert.match(
    reservedBondCreditViolationReason({
      kind: "token-mint",
      protocol: "pwt1",
      tokenId: incbTokenId,
      txid,
    }),
    /generic pwt1 create and mint/u,
  );
  assert.equal(
    reservedBondCreditViolationReason({
      kind: "token-transfer",
      tokenId: powbTokenId,
      txid,
    }),
    "",
    "POWB/INCB transfers and sale-ticket markets remain permitted",
  );
  assert.equal(
    reservedBondCreditViolationReason({
      amount: "100",
      amountSats: 0,
      confirmed: true,
      kind: "token-mint",
      minterAddress: "bc1pbondholder",
      protocol: "pwt1",
      sourceBondTxid: txid,
      ticker: "POWB",
      tokenId: powbTokenId,
      txid,
      validationMode: "canonical-powb-bond-projection",
    }),
    "",
    "a canonical PWM bond projection must remain the only POWB mint lane",
  );

  assert.match(
    topLevelFunctionSource(BACKFILL_PATH, "canonicalRecoveryItemsForTx"),
    /reservedBondCreditViolationReason\(normalizedItem\)/u,
  );
  assert.match(
    topLevelFunctionSource(BACKFILL_PATH, "persistPreparedProtocolItems"),
    /protocolIntegrityItemForPersistence/u,
  );
});

check("ordered credit verifier seeds both bond families without generic minting", () => {
  const workTokenId = "1".repeat(64);
  const powbTokenId = "2".repeat(64);
  const incbTokenId = "3".repeat(64);
  const tokenCreationIsAllowed = isolatedFunction(
    API_PATH,
    "tokenCreationIsAllowed",
    {
      BLOCKED_TOKEN_CREATOR_ADDRESSES: new Set(),
      BOND_TOKEN_IDS: new Set([powbTokenId, incbTokenId]),
      WORK_TOKEN_ID: workTokenId,
      normalizeTokenCreatorAddress: (value) => String(value ?? "").toLowerCase(),
      tokenTickerIsReserved: (value) => ["WORK", "POWB", "INCB"].includes(value),
    },
  );
  assert.equal(
    tokenCreationIsAllowed({ ticker: "POWB", tokenId: powbTokenId }),
    false,
  );
  assert.equal(
    tokenCreationIsAllowed({ ticker: "INCB", tokenId: incbTokenId }),
    false,
  );
  assert.equal(
    tokenCreationIsAllowed({ ticker: "WORK", tokenId: workTokenId }),
    true,
  );

  const tokenDefinitionPrecedesTransaction = isolatedFunction(
    API_PATH,
    "tokenDefinitionPrecedesTransaction",
    {
      BOND_TOKEN_IDS: new Set([powbTokenId, incbTokenId]),
      WORK_TOKEN_ID: workTokenId,
      transactionBlockHeight: (tx) => tx.blockHeight,
      transactionBlockIndex: (tx) => tx.blockIndex,
      transactionConfirmed: (tx) => tx.confirmed === true,
    },
  );
  const definition = {
    blockHeight: 100,
    blockIndex: 2,
    confirmed: true,
    tokenId: "4".repeat(64),
  };
  assert.equal(
    tokenDefinitionPrecedesTransaction(definition, {
      blockHeight: 100,
      blockIndex: 3,
      confirmed: true,
    }),
    true,
  );
  assert.equal(
    tokenDefinitionPrecedesTransaction(definition, {
      blockHeight: 100,
      blockIndex: 1,
      confirmed: true,
    }),
    false,
  );
  assert.equal(
    tokenDefinitionPrecedesTransaction(
      { ...definition, confirmed: false },
      { blockHeight: 101, blockIndex: 0, confirmed: true },
    ),
    false,
  );

  const tokenReplaySource = topLevelFunctionSource(
    API_PATH,
    "tokenStateFromTransactions",
  );
  assert.match(
    tokenReplaySource,
    /parsed\.kind === "mint"[\s\S]*BOND_TOKEN_IDS\.has\(parsed\.tokenId\)[\s\S]*tokenDefinitionPrecedesTransaction/u,
  );
  const confirmedVerifierSource = topLevelFunctionSource(
    API_PATH,
    "completeTokenVerifierState",
  );
  assert.match(confirmedVerifierSource, /for \(const config of BOND_TOKEN_CONFIGS\)/u);
  assert.match(
    confirmedVerifierSource,
    /canonicalBondTokenDefinition\(config, network, registryAddress\)/u,
  );
  assert.match(
    confirmedVerifierSource,
    /bondMintsFromActivity\([\s\S]*registryAddress,[\s\S]*network,[\s\S]*config/u,
  );
});

check("canonical bond mint replay unlocks only later INCB mutations", () => {
  const tokenId = "incb";
  const registryAddress = "registry";
  const alice = "alice";
  const bob = "bob";
  const buyer = "buyer";
  const carol = "carol";
  const dave = "dave";
  const erin = "erin";
  const txid = (digit) => String(digit).repeat(64);
  const blockHash = "f".repeat(64);
  const transactionTxid = (tx) => tx.txid;
  const transactionConfirmed = (tx) => tx.status.confirmed === true;
  const transactionBlockHeight = (tx) => tx.status.block_height;
  const transactionBlockIndex = (tx) => tx.status.block_index;
  const tokenTransactionTime = (tx) => tx.status.block_time * 1000;
  const tokenProtocolSortedTransactions = isolatedFunction(
    API_PATH,
    "tokenProtocolSortedTransactions",
    {
      transactionBlockHeight,
      transactionBlockIndex,
      transactionConfirmed,
      transactionTxid,
    },
  );
  const canonicalTokenReplayOrdinal = isolatedFunction(
    API_PATH,
    "canonicalTokenReplayOrdinal",
  );
  const tokenReplayEntriesForRegistry = isolatedFunction(
    API_PATH,
    "tokenReplayEntriesForRegistry",
    {
      canonicalTokenReplayOrdinal,
      tokenProtocolSortedTransactions,
      tokenTransactionTime,
      transactionBlockHeight,
      transactionBlockIndex,
      transactionConfirmed,
      transactionTxid,
    },
  );
  const insufficientTokenBalanceInvalidEvent = isolatedFunction(
    API_PATH,
    "insufficientTokenBalanceInvalidEvent",
  );
  const tokenStateFromTransactions = isolatedFunction(
    API_PATH,
    "tokenStateFromTransactions",
    {
      BOND_TOKEN_IDS: new Set([tokenId]),
      TOKEN_MIN_MUTATION_PRICE_SATS: 546,
      TOKEN_PROTOCOL_PREFIX: "pwt1:",
      canonicalEventIdentityDetails: () => ({}),
      canonicalInceptionMintMetadata: () => ({}),
      decodedProtocolMessages: (outputs) =>
        outputs.flatMap((output) => output?.message ? [output.message] : []),
      inputAddresses: (vin) => vin.map((input) => input.address),
      insufficientTokenBalanceInvalidEvent,
      isValidBitcoinAddress: (address) => Boolean(address),
      normalizeTokenScope: (value) => String(value ?? "").toLowerCase(),
      numericValue: (value) => Number(value) || 0,
      parseTokenPayload: (message) => message,
      paymentAmountFromSnapshots: () => 10_000,
      paymentOutputsBeforeTokenProtocol: () => [],
      proofProtocolDataBytesForVout: () => 0,
      spendsTokenListingAnchor: (spent, listing) =>
        spent.includes(listing.listingId),
      spentOutpoints: (vin) => vin.flatMap((input) => input.spends ?? []),
      tokenDefinitionPrecedesTransaction: () => true,
      tokenDefinitionsFromTransactions: () => ({
        creationSats: 0,
        tokens: [],
      }),
      tokenListingAnchorIsPresent: () => true,
      tokenListingAnchorSpendMatchesAuthorization: () => true,
      tokenListingIsExpired: () => false,
      tokenMatchesScope: (token, scope) =>
        !scope || token.tokenId === scope || token.ticker.toLowerCase() === scope,
      tokenPaymentAmountBeforeProtocol: () => 546,
      tokenReplayEntriesForRegistry,
      tokenSaleAuthorizationTermsMatch: () => true,
      tokenSaleAuthorizationUsesSaleTicketAnchor: () => true,
      tokenSellerPaymentRequiredSats: () => 100,
      tokenTransactionTime,
      transactionBlockHash: () => blockHash,
      transactionBlockHeight,
      transactionBlockIndex,
      transactionConfirmed,
      transactionMinerFeeSats: () => 10,
      transactionTxid,
    },
  );
  const transaction = (id, blockIndex, actor, message, options = {}) => ({
    txid: txid(id),
    status: {
      block_hash: blockHash,
      block_height: 100,
      block_index: blockIndex,
      // Deliberately regress timestamps: replay must still follow position.
      block_time: 2_000 - blockIndex,
      confirmed: true,
    },
    vin: [{ address: actor, spends: options.spends ?? [] }],
    vout: message ? [{ message }] : [],
  });
  const send = (amount, recipientAddress) => ({
    amount,
    kind: "send",
    recipientAddress,
    tokenId,
  });
  const listingTxid = txid(5);
  const listingAuthorization = {
    amount: 300,
    buyerAddress: "",
    priceSats: 100,
    registryAddress,
    sellerAddress: alice,
    ticker: "INCB",
    tokenId,
  };
  const transactions = [
    transaction(1, 1, alice, send(600, bob)),
    transaction(2, 2, alice, send(1, bob)),
    transaction(3, 3, alice, send(600, bob)),
    transaction(5, 4, alice, {
      kind: "list",
      saleAuthorization: listingAuthorization,
    }),
    transaction(6, 5, buyer, {
      buyerAddress: buyer,
      kind: "buy",
      listingId: listingTxid,
    }, { spends: [listingTxid] }),
    transaction(7, 6, carol, send(100, erin)),
    transaction(8, 7, carol, null),
    transaction(9, 8, carol, send(100, erin)),
  ];
  const seedMints = [
    {
      amount: 1_000,
      blockHeight: 100,
      blockIndex: 2,
      confirmed: true,
      createdAt: "2030-01-01T00:00:00.000Z",
      minterAddress: alice,
      recipientOrdinal: 0,
      tokenId,
      txid: txid(2),
    },
    {
      amount: 700,
      blockHeight: 100,
      blockIndex: 2,
      confirmed: true,
      createdAt: "2030-01-01T00:00:00.000Z",
      minterAddress: dave,
      recipientOrdinal: 1,
      tokenId,
      txid: txid(2),
    },
    {
      amount: 500,
      blockHeight: 100,
      blockIndex: 7,
      confirmed: true,
      createdAt: "1990-01-01T00:00:00.000Z",
      minterAddress: carol,
      recipientOrdinal: 0,
      tokenId,
      txid: txid(8),
    },
  ];
  const state = tokenStateFromTransactions(
    [],
    new Map([[registryAddress, transactions]]),
    "index",
    "livenet",
    tokenId,
    [{
      maxSupply: Number.MAX_SAFE_INTEGER,
      registryAddress,
      ticker: "INCB",
      tokenId,
      uncapped: true,
    }],
    seedMints,
  );

  assert.equal(state.confirmedSupply, 2_200);
  assert.equal(state.transfers.length, 2, "only post-bond sends are valid");
  assert.equal(state.sales.length, 1, "post-bond list and sale must settle");
  assert.equal(state.invalidEvents.length, 3);
  assert.deepEqual(
    Object.fromEntries(state.holders.map((holder) => [holder.address, holder.balance])),
    { alice: 100, bob: 600, buyer: 300, carol: 400, dave: 700, erin: 100 },
  );
  assert.equal(
    state.holders.reduce((total, holder) => total + holder.balance, 0),
    state.confirmedSupply,
    "multi-recipient issuance and dependent mutations must conserve supply",
  );

  const issuanceModel = "canonical-pre-bond-live-network-value-v2";
  const canonicalInceptionMintMetadata = (mint) =>
    mint?.issuanceAccountingModel === issuanceModel
      ? { issuanceAccountingModel: issuanceModel }
      : {};
  const inceptionSeedMintReplaySignature = isolatedFunction(
    API_PATH,
    "inceptionSeedMintReplaySignature",
    { JSON, canonicalInceptionMintMetadata },
  );
  let expansionCalls = 0;
  const strictReplay = isolatedFunction(
    API_PATH,
    "tokenStateFromTransactionsWithCanonicalInceptionIssuance",
    {
      INCB_TOKEN_ID: tokenId,
      INCEPTION_ISSUANCE_ACCOUNTING_MODEL: issuanceModel,
      WORK_TOKEN_ID: "work",
      dedupeActivityItems: (items) => items,
      emptyTokenState: () => ({ tokens: [] }),
      inceptionMintsWithLiveIssuance: (mints, activity, ledger, options) => {
        expansionCalls += 1;
        assert.equal(activity[0].attachedCredits[0].amount, 2);
        assert.equal(ledger.workTokenState.transfers[0].amount, 2);
        return mints.map((mint) =>
          mint.issuanceAccountingModel === issuanceModel ||
          !options.legacyBondTxids?.has(mint.txid)
            ? mint
            : {
                ...mint,
                amount: 1_000,
                issuanceAccountingModel: issuanceModel,
              },
        );
      },
      inceptionSeedMintReplaySignature,
      isInceptionBondActivityItem: (item) => item?.kind === "inception-bond",
      isTokenActivityItem: () => false,
      normalizeTokenScope: (value) => String(value ?? "").toLowerCase(),
      numericValue: (value) => Number(value) || 0,
      scopedTokenPayloadFromState: (state) => state,
      tokenActivityItemsFromState: () => [],
      tokenStateFromTransactions,
      tokenStateWithScopedTokenOverride: (_base, scoped) => scoped,
    },
  );
  const legacyBondSeed = {
    amount: 546,
    blockHeight: 100,
    blockIndex: 2,
    confirmed: true,
    createdAt: "2026-01-01T00:00:00.000Z",
    minterAddress: alice,
    tokenId,
    txid: txid(2),
  };
  const strictState = strictReplay(
    [],
    new Map([[registryAddress, [
      transaction(2, 2, alice, null),
      transaction(3, 3, alice, send(600, bob)),
    ]]]),
    "index",
    "livenet",
    tokenId,
    [{
      maxSupply: Number.MAX_SAFE_INTEGER,
      registryAddress,
      ticker: "INCB",
      tokenId,
      uncapped: true,
    }],
    [legacyBondSeed],
    [{
      attachedCredits: [{ amount: 2, tokenId: "work" }],
      blockHeight: 100,
      blockIndex: 2,
      confirmed: true,
      kind: "inception-bond",
      txid: txid(2),
    }],
    {
      activity: [],
      tokenState: { tokens: [] },
      workTokenState: { transfers: [{ amount: 2, txid: txid(2) }] },
    },
  );
  assert.ok(expansionCalls >= 2);
  assert.equal(strictState.confirmedSupply, 1_000);
  assert.equal(strictState.transfers.length, 1);
  assert.deepEqual(
    Object.fromEntries(
      strictState.holders.map((holder) => [holder.address, holder.balance]),
    ),
    { alice: 400, bob: 600 },
  );
});

check("credit mint persistence requires a prior confirmed definition", async () => {
  const tokenId = "d".repeat(64);
  const canonicalBondMintProjection = () => false;
  const tokenMintDefinitionOrderInvalidReason = isolatedFunction(
    BACKFILL_PATH,
    "tokenMintDefinitionOrderInvalidReason",
    {
      NETWORK: "livenet",
      canonicalBondMintProjection,
      isHexTxid: (value) => /^[0-9a-f]{64}$/u.test(String(value ?? "")),
    },
  );
  const item = {
    blockHeight: 200,
    blockIndex: 4,
    confirmed: true,
    kind: "token-mint",
    tokenId,
  };
  const clientFor = (row) => ({
    async query() {
      return { rows: row ? [row] : [] };
    },
  });

  assert.match(
    await tokenMintDefinitionOrderInvalidReason(clientFor(null), item),
    /not confirmed before/u,
  );
  assert.match(
    await tokenMintDefinitionOrderInvalidReason(
      clientFor({
        confirmed: true,
        created_height: 201,
        metadata: { blockIndex: 0 },
      }),
      item,
    ),
    /appears before/u,
  );
  assert.match(
    await tokenMintDefinitionOrderInvalidReason(
      clientFor({
        confirmed: true,
        created_height: 200,
        metadata: { blockIndex: 4 },
      }),
      item,
    ),
    /does not appear after/u,
  );
  assert.equal(
    await tokenMintDefinitionOrderInvalidReason(
      clientFor({
        confirmed: true,
        created_height: 200,
        metadata: { blockIndex: 3 },
      }),
      item,
    ),
    "",
  );
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
      protocolIntegrityItemForPersistence: async (_client, item) => item,
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
        return {
          rows: [{
            confirmed: true,
            created_height: 100,
            max_supply: "100",
            metadata: { blockIndex: 0 },
            ticker: "TEST",
            token_id: tokenId,
          }],
        };
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

check("stored supply can decrease only in the explicit scoped INCB repair", async () => {
  const tokenId =
    "3cb25745f937f2b4e5508e5400189fe8fe679cd8e84bfa1e9176d70c9761f15d";
  const rebuildConfirmedCreditBalancesFromCanonicalEvents = isolatedFunction(
    BACKFILL_PATH,
    "rebuildConfirmedCreditBalancesFromCanonicalEvents",
    { INCB_TOKEN_ID: tokenId, NETWORK: "livenet" },
  );
  const clientFor = (writes) => ({
    async query(sql, params = []) {
      const text = String(sql);
      if (text.includes("FROM proof_indexer.credit_definitions")) {
        return {
          rows: [{
            confirmed: true,
            created_height: 100,
            max_supply: "100",
            metadata: { blockIndex: 0 },
            ticker: "TEST",
            token_id: tokenId,
          }],
        };
      }
      if (text.includes("FROM proof_indexer.events")) {
        return {
          rows: [{
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
          }],
        };
      }
      if (text.includes("sum(confirmed_balance)")) {
        return {
          rows: [{ confirmed_supply: "20", token_id: tokenId }],
        };
      }
      writes.push({ params: Array.from(params), sql: text });
      return { rows: [] };
    },
  });

  const defaultWrites = [];
  await rejection(
    rebuildConfirmedCreditBalancesFromCanonicalEvents(
      clientFor(defaultWrites),
      { tokenIds: [tokenId] },
    ),
    (error) => /incomplete: stored 20, replayed 10/u.test(error.message),
    "A normal scoped replay lowered stored supply",
  );
  assert.equal(defaultWrites.length, 0);

  const repairWrites = [];
  const repaired = await rebuildConfirmedCreditBalancesFromCanonicalEvents(
    clientFor(repairWrites),
    {
      supplyCorrectionMode: "canonical-incb-issuance-repair",
      supplyCorrectionTokenIds: [tokenId],
      tokenIds: [tokenId],
    },
  );
  assert.deepEqual(Array.from(repaired.correctedSupplyTokenIds), [tokenId]);
  assert.ok(
    repairWrites.some((write) =>
      write.sql.includes("DELETE FROM proof_indexer.credit_balances"),
    ),
  );

  await rejection(
    rebuildConfirmedCreditBalancesFromCanonicalEvents(clientFor([]), {
      supplyCorrectionMode: "canonical-incb-issuance-repair",
      supplyCorrectionTokenIds: [tokenId],
    }),
    (error) => /restricted to the explicit scoped INCB issuance repair/u.test(
      error.message,
    ),
    "An unscoped caller acquired the supply correction capability",
  );
});

check("canonical INCB mint recovery binds the verifier minter", () => {
  const tokenId =
    "3cb25745f937f2b4e5508e5400189fe8fe679cd8e84bfa1e9176d70c9761f15d";
  const rawProtocolItemMatchesCanonical = isolatedFunction(
    BACKFILL_PATH,
    "rawProtocolItemMatchesCanonical",
    {
      INCB_TOKEN_ID: tokenId,
      canonicalIncbIssuanceMintProjection: () => true,
    },
  );
  const raw = {
    amount: "546",
    kind: "token-mint",
    minterAddress: "bond-recipient",
    tokenId,
  };
  const canonical = {
    amount: "1421799461",
    kind: "token-mint",
    minterAddress: "bond-recipient",
    tokenId,
  };
  assert.equal(
    rawProtocolItemMatchesCanonical(raw, canonical, "token-mint"),
    true,
  );
  assert.equal(
    rawProtocolItemMatchesCanonical(
      raw,
      { ...canonical, minterAddress: "different-recipient" },
      "token-mint",
    ),
    false,
  );
  assert.equal(
    rawProtocolItemMatchesCanonical(
      { ...raw, minterAddress: "" },
      canonical,
      "token-mint",
    ),
    false,
  );
});

check("canonical indexer binds exact verified WORK transfers to Inception bonds", () => {
  const workTokenId = "4".repeat(64);
  const txid = "d".repeat(64);
  const recipientAddress = "bc1qinceptionrecipient";
  const canonicalIntegerText = isolatedFunction(
    BACKFILL_PATH,
    "canonicalIntegerText",
  );
  const sameCanonicalPaymentAddress = isolatedFunction(
    BACKFILL_PATH,
    "sameCanonicalPaymentAddress",
  );
  const bindAttachments = isolatedFunction(
    BACKFILL_PATH,
    "preparedProtocolItemsWithCanonicalInceptionAttachments",
    {
      INCEPTION_BOND_KIND: "inception-bond",
      Map,
      Set,
      WORK_TOKEN_ID: workTokenId,
      WORK_TOKEN_TICKER: "WORK",
      canonicalIntegerText,
      isHexTxid: (value) => /^[0-9a-f]{64}$/u.test(String(value)),
      sameCanonicalPaymentAddress,
    },
  );
  const prepared = [
    {
      item: {
        attachedCredits: [{ amount: "999", tokenId: workTokenId }],
        confirmed: true,
        kind: "inception-bond",
        recipients: [{ address: recipientAddress, amountSats: "546", vout: 0 }],
        txid,
      },
      sourceLabel: "log",
    },
    {
      item: {
        _powEventIndex: 2,
        amount: "3644060",
        confirmed: true,
        kind: "token-transfer",
        protocolVout: 3,
        recipientAddress: recipientAddress.toUpperCase(),
        ticker: "WORK",
        tokenId: workTokenId,
        txid,
        valid: true,
      },
      sourceLabel: "token-transfers",
    },
    {
      item: {
        amount: "25",
        confirmed: true,
        kind: "token-transfer",
        protocolVout: 4,
        recipientAddress,
        tokenId: workTokenId,
        txid,
        valid: false,
      },
      sourceLabel: "token-invalid-events",
    },
    {
      item: {
        amount: "100",
        confirmed: true,
        kind: "token-transfer",
        protocolVout: 5,
        recipientAddress: "bc1qwrongrecipient",
        tokenId: workTokenId,
        txid,
        valid: true,
      },
      sourceLabel: "token-transfers",
    },
  ];

  const bound = bindAttachments(prepared);
  assert.equal(bound[0].sourceLabel, "log");
  assert.equal(bound[0].item.attachedCredits.length, 1);
  assert.equal(bound[0].item.attachedCredits[0]._powEventIndex, 2);
  assert.equal(bound[0].item.attachedCredits[0].amount, "3644060");
  assert.equal(bound[0].item.attachedCredits[0].protocolVout, 3);
  assert.equal(
    bound[0].item.attachedCredits[0].recipientAddress,
    recipientAddress.toUpperCase(),
  );
  assert.equal(bound[0].item.attachedCredits[0].ticker, "WORK");
  assert.equal(bound[0].item.attachedCredits[0].tokenId, workTokenId);
  assert.equal(bound[1], prepared[1]);
  assert.equal(bound[2], prepared[2]);
  assert.equal(bound[3], prepared[3]);

  const withoutCanonicalTransfer = bindAttachments([
    prepared[0],
    prepared[2],
  ]);
  assert.equal(withoutCanonicalTransfer[0].item.attachedCredits, undefined);

  const duplicateCanonicalVout = bindAttachments([
    prepared[0],
    prepared[1],
    {
      ...prepared[1],
      item: {
        ...prepared[1].item,
        _powEventIndex: 3,
        amount: "1",
      },
    },
  ]);
  assert.equal(
    duplicateCanonicalVout[0].item.attachedCredits,
    undefined,
    "duplicate canonical WORK rows for one protocol vout must fail closed",
  );
});

check("confirmed INCB metadata is fully bound to its recipient and block", () => {
  const tokenId =
    "3cb25745f937f2b4e5508e5400189fe8fe679cd8e84bfa1e9176d70c9761f15d";
  const txid =
    "dd743fb69c519200cc190627219ba34ca2e63e6893e600b73e9aee8d4dac8fa4";
  const blockHash =
    "000000000000000000016ea78b0d57a7979de3542518c8690a1e5a808e691cc5";
  const exactSafeInteger = isolatedFunction(
    READER_PATH,
    "exactSafeInteger",
  );
  const incbIssuanceMetadataFault = isolatedFunction(
    READER_PATH,
    "incbIssuanceMetadataFault",
    {
      INCB_ISSUANCE_ACCOUNTING_MODEL:
        "canonical-pre-bond-live-network-value-v2",
      INCB_VALUE_SNAPSHOT_MODEL:
        "canonical-summary-h-minus-one-v1",
      INCB_TOKEN_ID: tokenId,
      exactSafeInteger,
    },
  );
  const payload = {
    amount: "1421799461",
    amountSats: 0,
    attachedWorkAmount: "3644060",
    attachedWorkIssuanceUnits: "1421798915",
    attachedWorkLiveFloorAtSendSats: 390.168909301053,
    attachedWorkLiveValueAtSendSats: 1421798915.6275952,
    blockHash,
    blockHeight: 957950,
    blockIndex: 382,
    confirmed: true,
    confirmedIssuanceUnits: "1421799461",
    directProofIssuanceUnits: "546",
    issuanceAccountingModel:
      "canonical-pre-bond-live-network-value-v2",
    issuanceAmount: "1421799461",
    issuanceCheckpointBlockHash: blockHash,
    issuanceCheckpointBlockHeight: "957950",
    issuanceCheckpointBlockIndex: "382",
    issuanceCheckpointMode: "bond-transaction-provenance",
    issuanceValueSnapshotBlockHash:
      "00000000000000000001bda6bfa328f15edf597bfc364e02da42ea92a518a15e",
    issuanceValueSnapshotBlockHeight: "957949",
    issuanceValueSnapshotCanonicalSummaryHash:
      "4f00b3494afb46ef88990948784a0ba8f2a22856615a39e15c3131f0ec979bdc",
    issuanceValueSnapshotGeneratedAt: "2026-07-14T03:03:04.765Z",
    issuanceValueSnapshotId: "b8e77cd30cbed6855977c514",
    issuanceValueSnapshotMode: "canonical-summary-refresh",
    issuanceValueSnapshotModel: "canonical-summary-h-minus-one-v1",
    issuanceValueSnapshotWorkNetworkValueSats: 8193547095.322113,
    issuanceDustSats: 0.6275951862335205,
    issuanceFloorSats: 1.0000000004414091,
    issuanceNetworkValueSats: 1421799461.6275952,
    issuanceUnitSats: 1,
    issuanceValuationFixedAtSend: true,
    bondRecipientAddress: "1BPVvi1GK4QkfqFMU4jHGjsQjyGwjJJJ7x",
    bondRecipientAmountSats: "546",
    bondRecipientVout: 0,
    minterAddress: "1BPVvi1GK4QkfqFMU4jHGjsQjyGwjJJJ7x",
    paidSats: "546",
    proofPaymentSats: "546",
    sourceBondTxid: txid,
    ticker: "INCB",
    tokenId,
    txid,
    validationMode: "canonical-incb-bond-projection",
  };
  const row = {
    block_hash: blockHash,
    block_height: 957950,
    block_index: 382,
    status: "confirmed",
    token_id: tokenId,
    txid,
  };
  assert.equal(incbIssuanceMetadataFault(payload, row), "");
  assert.match(
    incbIssuanceMetadataFault({ ...payload, minterAddress: "" }, row),
    /recipient is missing/u,
  );
  assert.match(
    incbIssuanceMetadataFault(
      { ...payload, sourceBondTxid: "f".repeat(64) },
      row,
    ),
    /not bound/u,
  );
  assert.match(
    incbIssuanceMetadataFault(payload, {
      ...row,
      block_hash: "e".repeat(64),
    }),
    /not bound/u,
  );
});

check("multi-recipient bond mints survive reader identity and stats", async () => {
  const tokenId = "a".repeat(64);
  const txid = "b".repeat(64);
  const tokenMintEventQueryParts = isolatedFunction(
    READER_PATH,
    "tokenMintEventQueryParts",
    {
      normalizedTxid: () => "",
      tokenHistoryFilterNeedles: () => [],
      tokenMintQueryScopeCondition: () => "true",
      tokenScopeKey: (value) => String(value ?? "").toLowerCase(),
    },
  );
  const { cte } = tokenMintEventQueryParts(
    "livenet",
    tokenId,
    new URLSearchParams(),
    { limit: 100, offset: 0, page: 0, query: "", snapshotId: "" },
  );
  assert.match(cte, /WITH mint_candidates AS/u);
  assert.match(
    cte,
    /DISTINCT ON \([\s\S]*lower\(txid\)[\s\S]*mint_ordinal[\s\S]*lower\(mint_recipient_address\)/u,
  );
  assert.doesNotMatch(cte, /DISTINCT ON \(lower\(e\.txid\)\)/u);

  const rows = [
    {
      block_height: 100,
      block_time: "2026-07-14T00:00:00.000Z",
      effective_status: "confirmed",
      event_id: 1,
      mint_ordinal: 0,
      mint_recipient_address: "addrA",
      payload: {
        amount: "546",
        minterAddress: "addrA",
        ticker: "POWB",
        tokenId,
        txid,
      },
      token_id: tokenId,
      txid,
    },
    {
      block_height: 100,
      block_time: "2026-07-14T00:00:00.000Z",
      effective_status: "confirmed",
      event_id: 2,
      mint_ordinal: 1,
      mint_recipient_address: "addrB",
      payload: {
        amount: "546",
        eventKeyVout: 1,
        minterAddress: "addrB",
        ticker: "POWB",
        tokenId,
        txid,
      },
      token_id: tokenId,
      txid,
    },
  ];
  let parsedRows = 0;
  const proofIndexTokenMintStatsPayload = isolatedFunction(
    READER_PATH,
    "proofIndexTokenMintStatsPayload",
    {
      TOKEN_STATE_EVENT_READ_LIMIT: 100_000,
      newestDateIso: (values) =>
        values.filter(Boolean).sort().at(-1) ?? undefined,
      objectRecord: (value) => value ?? {},
      proofIndexPool: () => ({}),
      proofIndexTokenMintRows: async () => rows,
      rowNumber: (value, key) => Number(value?.[key] ?? 0) || 0,
      tokenMintFromEventPayload: (payload, row) => {
        parsedRows += 1;
        return {
          amount: Number(payload.amount),
          confirmed: row.effective_status === "confirmed",
          txid: row.txid,
        };
      },
      tokenScopeKey: (value) => String(value ?? "").toLowerCase(),
    },
  );
  const stats = await proofIndexTokenMintStatsPayload("livenet", tokenId);
  assert.equal(parsedRows, 2);
  assert.equal(stats.confirmedMints, 2);
  assert.equal(stats.confirmedSupply, 1092);
  assert.equal(stats.totalMints, 2);

  const rejectingStats = isolatedFunction(
    READER_PATH,
    "proofIndexTokenMintStatsPayload",
    {
      TOKEN_STATE_EVENT_READ_LIMIT: 100_000,
      newestDateIso: () => undefined,
      objectRecord: (value) => value ?? {},
      proofIndexPool: () => ({}),
      proofIndexTokenMintRows: async () => rows,
      rowNumber: (value, key) => Number(value?.[key] ?? 0) || 0,
      tokenMintFromEventPayload: (_payload, row) => {
        if (row.event_id === 2) throw new Error("invalid canonical mint");
        return { amount: 546, confirmed: true, txid: row.txid };
      },
      tokenScopeKey: (value) => String(value ?? "").toLowerCase(),
    },
  );
  await rejection(
    rejectingStats("livenet", tokenId),
    (error) => /invalid canonical mint/u.test(error.message),
    "Mint statistics published after a row failed canonical validation",
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
        return {
          rows: [{
            confirmed: true,
            created_height: 100,
            max_supply: "100",
            metadata: { blockIndex: 0 },
            ticker: "TEST",
            token_id: tokenId,
          }],
        };
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
      HYDRATE_TRANSACTION_DETAILS_ONLY: false,
      NETWORK: "livenet",
      PREPARE_CANONICAL_REBUILD_ONLY: true,
      PREPARE_CANONICAL_PWT_RANGE_REPLAY_ONLY: false,
      REPAIR_INCB_ISSUANCE_ONLY: false,
      REPAIR_ID_TXIDS: [],
      REPAIR_ID_TXIDS_ONLY: false,
      REPAIR_WORK_PARTICIPANTS_ONLY: false,
    },
  );
  assert.throws(invalid, /explicit positive/u);
  const valid = isolatedFunction(
    BACKFILL_PATH,
    "assertCanonicalRebuildConfiguration",
    {
      BLOCK_SCAN_FROM_HEIGHT: 100,
      CANONICAL_REBUILD: true,
      HYDRATE_TRANSACTION_DETAILS_ONLY: false,
      NETWORK: "livenet",
      PREPARE_CANONICAL_REBUILD_ONLY: true,
      PREPARE_CANONICAL_PWT_RANGE_REPLAY_ONLY: false,
      REPAIR_INCB_ISSUANCE_ONLY: false,
      REPAIR_ID_TXIDS: [],
      REPAIR_ID_TXIDS_ONLY: false,
      REPAIR_WORK_PARTICIPANTS_ONLY: false,
    },
  );
  assert.doesNotThrow(valid);

  const hydration = isolatedFunction(
    BACKFILL_PATH,
    "assertCanonicalRebuildConfiguration",
    {
      CANONICAL_REBUILD: false,
      HYDRATE_TRANSACTION_DETAILS_ONLY: true,
      PREPARE_CANONICAL_REBUILD_ONLY: false,
      PREPARE_CANONICAL_PWT_RANGE_REPLAY_ONLY: false,
      REPAIR_INCB_ISSUANCE_ONLY: false,
      REPAIR_ID_TXIDS_ONLY: false,
      REPAIR_WORK_PARTICIPANTS_ONLY: false,
      TX_DETAIL_HYDRATION_AFTER_BLOCK_INDEX: -1,
      TX_DETAIL_HYDRATION_AFTER_HEIGHT: -1,
      TX_DETAIL_HYDRATION_AFTER_TXID: "",
      TX_DETAIL_HYDRATION_BATCH_SIZE: 200,
      TX_DETAIL_HYDRATION_MAX_ROWS: 10_000,
      isHexTxid: (value) => /^[0-9a-f]{64}$/u.test(String(value)),
    },
  );
  assert.doesNotThrow(hydration);
  const conflictingHydration = isolatedFunction(
    BACKFILL_PATH,
    "assertCanonicalRebuildConfiguration",
    {
      CANONICAL_REBUILD: true,
      HYDRATE_TRANSACTION_DETAILS_ONLY: true,
      PREPARE_CANONICAL_REBUILD_ONLY: false,
      PREPARE_CANONICAL_PWT_RANGE_REPLAY_ONLY: false,
      REPAIR_INCB_ISSUANCE_ONLY: false,
      REPAIR_ID_TXIDS_ONLY: false,
      REPAIR_WORK_PARTICIPANTS_ONLY: false,
    },
  );
  assert.throws(conflictingHydration, /exclusive/u);
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
  assert.deepEqual(Array.from(eventDelete.params[1]), [
    "pwid1",
    "pwt1",
    "pwm1",
    "pwr1",
  ]);
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

check("canonical transaction detail rows preserve full-node input and output truth", () => {
  const satsFromVoutValue = isolatedFunction(
    BACKFILL_PATH,
    "satsFromVoutValue",
  );
  const prevoutFromOutput = isolatedFunction(
    BACKFILL_PATH,
    "prevoutFromOutput",
    { satsFromVoutValue },
  );
  const addressFromVout = isolatedFunction(BACKFILL_PATH, "addressFromVout");
  const canonicalOpReturnPayloadFromVout = isolatedFunction(
    BACKFILL_PATH,
    "canonicalOpReturnPayloadFromVout",
    { Buffer },
  );
  const canonicalTransactionDetailRows = isolatedFunction(
    BACKFILL_PATH,
    "canonicalTransactionDetailRows",
    {
      PROTOCOL_PREFIXES: ["pwm1:", "pwid1:", "pwt1:"],
      addressFromVout,
      canonicalOpReturnPayloadFromVout,
      isHexTxid: (value) => /^[0-9a-f]{64}$/u.test(String(value)),
      prevoutFromOutput,
    },
  );
  const payload = Buffer.from("pwm1:b:POWB:100", "utf8");
  const opReturnScript = Buffer.concat([
    Buffer.from([0x6a, payload.length]),
    payload,
  ]).toString("hex");
  const rows = canonicalTransactionDetailRows({
    txid: "a".repeat(64),
    vin: [
      {
        prevout: {
          scriptPubKey: {
            address: "bc1psender",
            asm: "1 sender",
            hex: "5120" + "1".repeat(64),
            type: "witness_v1_taproot",
          },
          value: 0.001,
          valueSats: 100_000,
        },
        scriptSig: { hex: "" },
        sequence: 4_294_967_293,
        txid: "b".repeat(64),
        txinwitness: ["aa", "bb"],
        vout: 2,
      },
    ],
    vout: [
      {
        n: 0,
        scriptPubKey: {
          address: "bc1preceiver",
          asm: "1 receiver",
          hex: "5120" + "2".repeat(64),
          type: "witness_v1_taproot",
        },
        value: 0.00000546,
      },
      {
        n: 1,
        scriptPubKey: {
          asm: `OP_RETURN ${payload.toString("hex")}`,
          hex: opReturnScript,
          type: "nulldata",
        },
        value: 0,
      },
    ],
  });
  assert.equal(rows.inputs.length, 1);
  assert.equal(rows.inputs[0].prev_txid, "b".repeat(64));
  assert.equal(rows.inputs[0].prev_vout, 2);
  assert.equal(rows.inputs[0].address, "bc1psender");
  assert.equal(rows.inputs[0].value_sats, 100_000);
  assert.equal(rows.inputs[0].sequence, 4_294_967_293);
  assert.deepEqual(Array.from(rows.inputs[0].witness), ["aa", "bb"]);
  assert.equal(rows.outputs[0].value_sats, 546);
  assert.equal(rows.outputs[0].address, "bc1preceiver");
  assert.equal(rows.outputs[0].scriptpubkey_type, "witness_v1_taproot");
  assert.equal(rows.opReturns.length, 1);
  assert.equal(rows.opReturns[0].vout, 1);
  assert.equal(rows.opReturns[0].protocol, "pwm1");
  assert.equal(rows.opReturns[0].payload_text, "pwm1:b:POWB:100");
  assert.equal(rows.opReturns[0].payload_hex, payload.toString("hex"));
  assert.equal(rows.opReturns[0].data_bytes, payload.length);
  assert.equal(
    canonicalOpReturnPayloadFromVout({
      scriptPubKey: { hex: "6a4c02ff" },
    }),
    null,
  );
  const binaryPayload = canonicalOpReturnPayloadFromVout({
    scriptPubKey: { hex: "6a02fffe" },
  });
  assert.equal(binaryPayload.payloadText, null);
  assert.equal(binaryPayload.payloadHex, "fffe");
  assert.throws(
    () =>
      canonicalTransactionDetailRows({
        txid: "a".repeat(64),
        vin: [{ coinbase: "00", sequence: 4_294_967_295 }],
        vout: [{ n: 1, scriptPubKey: { hex: "00" }, value: 0 }],
      }),
    /mismatched index/u,
  );
});

check("canonical raw tx replaces legacy wrappers without entering event payloads", async () => {
  const txid = "b".repeat(64);
  const calls = [];
  const details = {
    inputs: [
      {
        address: "sender",
        prev_txid: "a".repeat(64),
        prev_vout: 0,
        script_sig: null,
        sequence: 1,
        value_sats: 10_000,
        vin: 0,
        witness: ["aa"],
      },
    ],
    opReturns: [
      {
        data_bytes: 6,
        output_index: 0,
        payload_hex: "70776d313a78",
        payload_text: "pwm1:x",
        protocol: "pwm1",
        vout: 1,
      },
    ],
    outputs: [
      {
        address: "receiver",
        scriptpubkey: "51",
        scriptpubkey_asm: "1",
        scriptpubkey_type: "nonstandard",
        value_sats: 546,
        vout: 0,
      },
      {
        address: null,
        scriptpubkey: "6a0670776d313a78",
        scriptpubkey_asm: "OP_RETURN 70776d313a78",
        scriptpubkey_type: "nulldata",
        value_sats: 0,
        vout: 1,
      },
    ],
  };
  const canonicalTransactionDetailRows = () => details;
  const isHexTxid = (value) => /^[0-9a-f]{64}$/u.test(String(value));
  const persistCanonicalTransactionDetails = isolatedFunction(
    BACKFILL_PATH,
    "persistCanonicalTransactionDetails",
    {
      NETWORK: "livenet",
      canonicalTransactionDetailRows,
      isHexTxid,
    },
  );
  const persistCanonicalRawTransaction = isolatedFunction(
    BACKFILL_PATH,
    "persistCanonicalRawTransaction",
    {
      NETWORK: "livenet",
      canonicalTransactionDetailRows,
      isHexTxid,
      itemTime: () => null,
      numberOrNull: (value) =>
        Number.isFinite(Number(value)) ? Number(value) : null,
      persistCanonicalTransactionDetails,
    },
  );
  await persistCanonicalRawTransaction(
    {
      async query(sql, params) {
        calls.push({ params: Array.from(params), sql: String(sql) });
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
  assert.equal(calls.length, 6);
  assert.match(calls[0].sql, /raw_tx = EXCLUDED\.raw_tx/u);
  assert.match(calls[0].sql, /fee_sats = EXCLUDED\.fee_sats/u);
  assert.equal(calls[0].params[5], 9_454);
  const raw = JSON.parse(calls[0].params[10]);
  assert.equal(raw.canonicalBlockScan.height, 101);
  assert.equal(raw.canonicalBlockScan.network, "livenet");
  assert.equal(raw._powBlockIndex, 7);
  assert.equal(raw.item, undefined);
  assert.equal(raw.vin.length, 1);
  assert.equal(raw.vout.length, 1);
  assert.match(calls[1].sql, /INSERT INTO proof_indexer\.tx_inputs/u);
  assert.match(calls[1].sql, /ON CONFLICT \(network, txid, vin\)/u);
  assert.equal(JSON.parse(calls[1].params[2])[0].value_sats, 10_000);
  assert.match(calls[2].sql, /INSERT INTO proof_indexer\.tx_outputs/u);
  assert.match(calls[2].sql, /scriptpubkey_asm = EXCLUDED\.scriptpubkey_asm/u);
  assert.doesNotMatch(calls[2].sql, /spent_by_txid = EXCLUDED/u);
  assert.match(calls[3].sql, /INSERT INTO proof_indexer\.op_returns/u);
  assert.match(
    calls[3].sql,
    /ON CONFLICT \(network, txid, vout, output_index\)/u,
  );
  assert.match(calls[4].sql, /FOR UPDATE OF spent_output/u);
  assert.equal(calls[4].params.length, 2);
  assert.equal(JSON.parse(calls[4].params[1])[0].prev_txid, "a".repeat(64));
  assert.match(calls[5].sql, /UPDATE proof_indexer\.tx_outputs AS spent_output/u);
  assert.match(
    calls[5].sql,
    /spent_by_txid IS NULL[\s\S]*spent_by_vin IS NOT DISTINCT FROM incoming\.vin/u,
  );
  assert.equal(calls[5].params[1], txid);
});

check("canonical coinbase protocol rows persist without inventing a miner fee", async () => {
  const txid = "e".repeat(64);
  const calls = [];
  const persistCanonicalRawTransaction = isolatedFunction(
    BACKFILL_PATH,
    "persistCanonicalRawTransaction",
    {
      NETWORK: "livenet",
      canonicalTransactionDetailRows: () => ({
        inputs: [
          {
            prev_txid: null,
            value_sats: null,
            vin: 0,
          },
        ],
        opReturns: [{ vout: 1 }],
        outputs: [
          { value_sats: 3_125_000_000, vout: 0 },
          { value_sats: 0, vout: 1 },
        ],
      }),
      isHexTxid: (value) => /^[0-9a-f]{64}$/u.test(String(value)),
      itemTime: () => "2026-07-14T00:00:00.000Z",
      numberOrNull: (value) =>
        Number.isFinite(Number(value)) ? Number(value) : null,
      persistCanonicalTransactionDetails: async () => {},
    },
  );
  await persistCanonicalRawTransaction(
    {
      async query(sql, params) {
        calls.push({ params: Array.from(params), sql: String(sql) });
        return { rows: [] };
      },
    },
    {
      txid,
      vin: [{ coinbase: "00" }],
      vout: [{ value: 31.25 }, { value: 0 }],
    },
    { blockHash: "f".repeat(64), blockTime: 1_700_000_000, height: 102 },
  );
  assert.equal(calls.length, 1);
  assert.equal(calls[0].params[5], null);
  assert.match(calls[0].sql, /fee_sats = EXCLUDED\.fee_sats/u);
});

check("canonical spend links reject conflicts and permit idempotent replays", async () => {
  const txid = "b".repeat(64);
  const parentTxid = "a".repeat(64);
  const details = {
    inputs: [
      {
        address: "sender",
        prev_txid: parentTxid,
        prev_vout: 1,
        script_sig: null,
        sequence: 1,
        value_sats: 10_000,
        vin: 0,
        witness: [],
      },
    ],
    opReturns: [],
    outputs: [],
  };
  const persistCanonicalTransactionDetails = isolatedFunction(
    BACKFILL_PATH,
    "persistCanonicalTransactionDetails",
    {
      NETWORK: "livenet",
      canonicalTransactionDetailRows: () => details,
      isHexTxid: (value) => /^[0-9a-f]{64}$/u.test(String(value)),
    },
  );
  const run = async (lockedRows) => {
    let updates = 0;
    const client = {
      async query(sql) {
        const text = String(sql);
        if (text.includes("FOR UPDATE OF spent_output")) {
          return { rows: lockedRows };
        }
        if (text.includes("UPDATE proof_indexer.tx_outputs AS spent_output")) {
          updates += 1;
        }
        return { rows: [] };
      },
    };
    const operation = persistCanonicalTransactionDetails(
      client,
      { txid },
      { details, spentAt: "2026-07-13T00:00:00.000Z" },
    );
    return { operation, updates: () => updates };
  };

  const idempotent = await run([
    {
      incoming_vin: 0,
      prev_txid: parentTxid,
      prev_vout: 1,
      spent_by_txid: txid,
      spent_by_vin: 0,
    },
  ]);
  await idempotent.operation;
  assert.equal(idempotent.updates(), 1);

  for (const conflict of [
    {
      incoming_vin: 0,
      prev_txid: parentTxid,
      prev_vout: 1,
      spent_by_txid: "c".repeat(64),
      spent_by_vin: 0,
    },
    {
      incoming_vin: 0,
      prev_txid: parentTxid,
      prev_vout: 1,
      spent_by_txid: txid,
      spent_by_vin: 2,
    },
  ]) {
    const rejected = await run([conflict]);
    await assert.rejects(rejected.operation, /Canonical spend-link conflict/u);
    assert.equal(rejected.updates(), 0);
  }
});

check("historical transaction detail hydration is bounded and projection-neutral", async () => {
  const firstTxid = "1".repeat(64);
  const secondTxid = "2".repeat(64);
  const persisted = [];
  const hydrateHistoricalCanonicalTransactionDetails = isolatedFunction(
    BACKFILL_PATH,
    "hydrateHistoricalCanonicalTransactionDetails",
    {
      NETWORK: "livenet",
      TX_DETAIL_HYDRATION_AFTER_BLOCK_INDEX: -1,
      TX_DETAIL_HYDRATION_AFTER_HEIGHT: -1,
      TX_DETAIL_HYDRATION_AFTER_TXID: "",
      TX_DETAIL_HYDRATION_BATCH_SIZE: 2,
      TX_DETAIL_HYDRATION_MAX_ROWS: 2,
      assertHydratedProtocolTransaction: () => {},
      canonicalTransactionDetailRows: (tx) => ({
        inputs: [{ vin: 0 }],
        opReturns: [{ vout: 1 }],
        outputs: [{ vout: 0 }, { vout: 1 }],
        txid: tx.txid,
      }),
      isHexTxid: (value) => /^[0-9a-f]{64}$/u.test(String(value)),
      itemTime: () => "2026-07-13T00:00:00.000Z",
      persistCanonicalTransactionDetails: async (_client, tx, options) => {
        persisted.push({ options, txid: tx.txid });
        return { inputs: 1, opReturns: 1, outputs: 2 };
      },
      protocolMessagesFromTx: () => [{ prefix: "pwm1:" }],
    },
  );
  const calls = [];
  const client = {
    async query(sql, params = []) {
      const text = String(sql).trim();
      calls.push({ params: Array.from(params), sql: text });
      if (text.startsWith("WITH candidates AS")) {
        return {
          rows: [
            {
              block_canonical: true,
              block_hash: "a".repeat(64),
              block_height: 100,
              block_index: 3,
              block_time: "2026-07-13T00:00:00.000Z",
              canonical_block_hash: "a".repeat(64),
              raw_tx: {
                _powBlockIndex: 3,
                canonicalBlockScan: {
                  blockHash: "a".repeat(64),
                  height: 100,
                  network: "livenet",
                },
                txid: firstTxid,
              },
              txid: firstTxid,
            },
            {
              block_canonical: true,
              block_hash: "a".repeat(64),
              block_height: 100,
              block_index: 4,
              block_time: "2026-07-13T00:01:00.000Z",
              canonical_block_hash: "a".repeat(64),
              raw_tx: {
                _powBlockIndex: 4,
                canonicalBlockScan: {
                  blockHash: "a".repeat(64),
                  height: 100,
                  network: "livenet",
                },
                txid: secondTxid,
              },
              txid: secondTxid,
            },
          ],
        };
      }
      return { rows: [] };
    },
  };
  const result = await hydrateHistoricalCanonicalTransactionDetails(client);
  assert.equal(result.hydrated, 2);
  assert.equal(result.inputs, 2);
  assert.equal(result.outputs, 4);
  assert.equal(result.opReturns, 2);
  assert.equal(result.batches, 1);
  assert.equal(result.limitReached, true);
  assert.equal(result.cursor.afterHeight, 100);
  assert.equal(result.cursor.afterBlockIndex, 4);
  assert.equal(result.cursor.afterTxid, secondTxid);
  assert.deepEqual(
    persisted.map((entry) => entry.txid),
    [firstTxid, secondTxid],
  );
  assert.deepEqual(
    calls.map((call) => call.sql === "BEGIN" || call.sql === "COMMIT"
      ? call.sql
      : "SELECT"),
    ["SELECT", "BEGIN", "COMMIT"],
  );
  assert.deepEqual(calls[0].params, ["livenet", -1, -1, "", 2]);
  assert.match(
    calls[0].sql,
    /JOIN proof_indexer\.blocks AS canonical_block[\s\S]*canonical_block\.block_hash = transaction_row\.block_hash[\s\S]*canonical_block\.height = transaction_row\.block_height[\s\S]*canonical_block\.canonical = true/u,
  );
  assert.match(
    calls[0].sql,
    /jsonb_typeof\(transaction_row\.raw_tx->'vin'\) = 'array'/u,
  );
  assert.match(
    calls[0].sql,
    /canonicalBlockScan'->>'height'[\s\S]*transaction_row\.block_height[\s\S]*canonicalBlockScan'->>'blockHash'[\s\S]*transaction_row\.block_hash/u,
  );
  assert.match(
    calls[0].sql,
    /ORDER BY block_height, block_index, txid[\s\S]*LIMIT \$5/u,
  );
  const source = topLevelFunctionSource(
    BACKFILL_PATH,
    "hydrateHistoricalCanonicalTransactionDetails",
  );
  assert.doesNotMatch(
    source,
    /\b(?:INSERT\s+INTO|UPDATE|DELETE\s+FROM)\s+proof_indexer\.(?:meta|events|credit_|id_records|ledger_snapshots|blocks)\b/iu,
  );
});

check("historical detail hydration fails closed on detached block membership", async () => {
  const txid = "3".repeat(64);
  let persisted = false;
  const hydrateHistoricalCanonicalTransactionDetails = isolatedFunction(
    BACKFILL_PATH,
    "hydrateHistoricalCanonicalTransactionDetails",
    {
      NETWORK: "livenet",
      TX_DETAIL_HYDRATION_AFTER_BLOCK_INDEX: -1,
      TX_DETAIL_HYDRATION_AFTER_HEIGHT: -1,
      TX_DETAIL_HYDRATION_AFTER_TXID: "",
      TX_DETAIL_HYDRATION_BATCH_SIZE: 1,
      TX_DETAIL_HYDRATION_MAX_ROWS: 1,
      assertHydratedProtocolTransaction: () => {},
      canonicalTransactionDetailRows: () => ({
        inputs: [{ vin: 0 }],
        opReturns: [{ vout: 1 }],
        outputs: [{ vout: 0 }, { vout: 1 }],
      }),
      isHexTxid: (value) => /^[0-9a-f]{64}$/u.test(String(value)),
      itemTime: () => "2026-07-13T00:00:00.000Z",
      persistCanonicalTransactionDetails: async () => {
        persisted = true;
        return { inputs: 1, opReturns: 1, outputs: 2 };
      },
      protocolMessagesFromTx: () => [{ prefix: "pwm1:" }],
    },
  );
  const blockHash = "4".repeat(64);
  const client = {
    async query(sql) {
      if (String(sql).trim().startsWith("WITH candidates AS")) {
        return {
          rows: [
            {
              block_canonical: false,
              block_hash: blockHash,
              block_height: 200,
              block_index: 1,
              block_time: "2026-07-13T00:00:00.000Z",
              canonical_block_hash: blockHash,
              raw_tx: {
                _powBlockIndex: 1,
                canonicalBlockScan: {
                  blockHash,
                  height: 200,
                  network: "livenet",
                },
                txid,
              },
              txid,
            },
          ],
        };
      }
      return { rows: [] };
    },
  };

  await assert.rejects(
    hydrateHistoricalCanonicalTransactionDetails(client),
    /Stored canonical transaction detail envelope is invalid/u,
  );
  assert.equal(persisted, false);
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
  const tokenMintHistoryItemKey = isolatedFunction(
    API_PATH,
    "tokenMintHistoryItemKey",
    {
      numericValue: (value) => {
        const number = Number(value);
        return Number.isFinite(number) ? number : 0;
      },
    },
  );
  const mergeTokenStateItemsByKey = isolatedFunction(
    API_PATH,
    "mergeTokenStateItemsByKey",
    { compareTokenHistoryPageItems: () => 0 },
  );
  assert.equal(
    mergeTokenStateItemsByKey([], mints, tokenMintHistoryItemKey).length,
    2,
    "multi-recipient bond mints must survive scoped/history merges",
  );
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
          rows: [{
            confirmed: true,
            created_height: null,
            max_supply: String(Number.MAX_SAFE_INTEGER),
            metadata: { canonicalSynthetic: true, uncapped: true },
            ticker: "POWB",
            token_id: tokenId,
          }],
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
                amountSats: 0,
                blockIndex: 0,
                confirmed: true,
                minterAddress: "bob",
                sourceBondTxid: "2".repeat(64),
                ticker: "POWB",
                tokenId,
                validationMode: "canonical-powb-bond-projection",
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
                amountSats: 0,
                blockIndex: 0,
                confirmed: true,
                minterAddress: "alice",
                sourceBondTxid: "2".repeat(64),
                ticker: "POWB",
                tokenId,
                validationMode: "canonical-powb-bond-projection",
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
      reservedBondCreditViolationReason: () => "",
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
      tokenProtocolIntegrityInvalidItem: (item) => item,
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

check("pending PWM envelopes survive unresolved staged verifier companions", async () => {
  const txid = "9".repeat(64);
  const tokenId = "8".repeat(64);
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
          confirmed: false,
          kind: "inception-bond",
          protocol: "pwm1",
          status: "pending",
          txid,
        },
        {
          amount: 1_000,
          confirmed: false,
          kind: "token-transfer",
          protocol: "pwt1",
          status: "pending",
          tokenId,
          txid,
        },
      ],
      readJson: async () => {
        const error = new Error("ordered verifier unresolved");
        error.statusCode = 503;
        throw error;
      },
      recoveryEndpointSpecs: () => [
        {
          label: "token-verifier",
          params: { asset: tokenId, txid },
          path: "/api/v1/internal/token-verifier",
        },
      ],
      reservedBondCreditViolationReason: () => "",
      sourceLabelForProtocolItem: isolatedFunction(
        BACKFILL_PATH,
        "sourceLabelForProtocolItem",
      ),
      tokenProtocolIntegrityInvalidItem: (item) => item,
    },
  );
  const messages = [
    { prefix: "pwm1:", text: "pwm1:m:incb" },
    { prefix: "pwt1:", text: `pwt1:send:${tokenId}:1000:fixture` },
  ];
  const pending = await canonicalRecoveryItemsForTx(
    { height: 0, txid },
    messages,
  );
  assert.equal(
    JSON.stringify(pending.map(({ item }) => item.kind)),
    JSON.stringify(["inception-bond"]),
  );
  assert.equal(pending[0].item.confirmed, false);
  assert.equal(pending[0].item.valid, undefined);

  await rejection(
    canonicalRecoveryItemsForTx(
      {
        _powBlockHash: "a".repeat(64),
        _powPreviousBlockHash: "b".repeat(64),
        height: 101,
        txid,
      },
      messages,
    ),
    (error) => error.statusCode === 503,
    "A confirmed block event bypassed an unresolved canonical verifier",
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

check("health address checks use bounded Electrum balance responses", async () => {
  const calls = [];
  const healthScripthash = "8f52010f55361085b1806ee106632dd610d3a6587284138d06065d584bab8d21";
  let balance = { confirmed: 0, unconfirmed: 0 };
  const addressIndexHealthPayload = isolatedFunction(
    API_PATH,
    "addressIndexHealthPayload",
    {
      ELECTRUM_HOST: "127.0.0.1",
      ELECTRUM_PORT: 50_001,
      ELECTRUM_HEALTH_SCRIPTHASH: healthScripthash,
      HEALTH_CHECK_TIMEOUT_MS: 5_000,
      electrumRequest: async (method, params) => {
        calls.push({ method, params });
        return balance;
      },
      interactiveElectrumRequest: async (method, params) => {
        calls.push({ method, params });
        return balance;
      },
      errorSummary: (error) => String(error?.message ?? error),
      firstPartyAddressReadBases: () => [],
      promiseOutcomeWithin: async (promise) => {
        try {
          return {
            error: null,
            ok: true,
            timedOut: false,
            value: await promise,
          };
        } catch (error) {
          return { error, ok: false, timedOut: false, value: null };
        }
      },
      registryAddressForNetwork: () => "bc1registry",
    },
  );

  const healthy = JSON.parse(
    JSON.stringify(await addressIndexHealthPayload()),
  );
  assert.equal(healthy.ok, true);
  assert.equal(healthy.timedOut, false);
  assert.deepEqual(healthy.canary, {
    confirmedSats: 0,
    scripthash: healthScripthash,
    unconfirmedSats: 0,
  });
  assert.deepEqual(calls.map((call) => call.method), [
    "blockchain.scripthash.get_balance",
  ]);
  assert.deepEqual(calls.map((call) => Array.from(call.params)), [
    [healthScripthash],
  ]);

  calls.length = 0;
  balance = { confirmed: null, unconfirmed: 0 };
  const invalid = JSON.parse(
    JSON.stringify(await addressIndexHealthPayload()),
  );
  assert.equal(invalid.ok, false);
  assert.match(invalid.error, /invalid balance response/iu);

  balance = { confirmed: "0", unconfirmed: 0 };
  const coerced = JSON.parse(
    JSON.stringify(await addressIndexHealthPayload()),
  );
  assert.equal(coerced.ok, false);
  assert.match(coerced.error, /invalid balance response/iu);
});

check("Electrum health proves the exact sampled Core block header", async () => {
  const calls = [];
  let derivedHash = "a".repeat(64);
  let headerResponse = "00".repeat(80);
  const electrumHealthPayload = isolatedFunction(
    API_PATH,
    "electrumHealthPayload",
    {
      Buffer,
      ELECTRUM_HOST: "127.0.0.1",
      ELECTRUM_PORT: 50_001,
      HEALTH_CHECK_TIMEOUT_MS: 5_000,
      bitcoin: {
        crypto: {
          hash256: () => Buffer.from(derivedHash, "hex").reverse(),
        },
      },
      electrumRequest: async (method, params) => {
        calls.push({ method, params });
        return headerResponse;
      },
      interactiveElectrumRequest: async (method, params) => {
        calls.push({ method, params });
        return headerResponse;
      },
      errorSummary: (error) => String(error?.message ?? error),
      promiseOutcomeWithin: async (promise) => {
        try {
          return {
            error: null,
            ok: true,
            timedOut: false,
            value: await promise,
          };
        } catch (error) {
          return { error, ok: false, timedOut: false, value: null };
        }
      },
    },
  );

  const healthy = JSON.parse(
    JSON.stringify(await electrumHealthPayload(957_864, derivedHash)),
  );
  assert.deepEqual(healthy, {
    configured: true,
    error: "",
    headerHash: derivedHash,
    headerHeight: 957_864,
    ok: true,
    timedOut: false,
  });
  assert.deepEqual(JSON.parse(JSON.stringify(calls)), [
    { method: "blockchain.block.header", params: [957_864] },
  ]);

  const mismatch = JSON.parse(
    JSON.stringify(await electrumHealthPayload(957_864, "b".repeat(64))),
  );
  assert.equal(mismatch.ok, false);
  assert.equal(mismatch.headerHash, derivedHash);
  assert.match(mismatch.error, /does not match Bitcoin Core/iu);

  headerResponse = "00";
  derivedHash = "c".repeat(64);
  const malformed = JSON.parse(
    JSON.stringify(await electrumHealthPayload(957_864, derivedHash)),
  );
  assert.equal(malformed.ok, false);
  assert.equal(malformed.headerHash, null);
  assert.match(malformed.error, /invalid block header/iu);

  const callCount = calls.length;
  const missingCore = JSON.parse(
    JSON.stringify(await electrumHealthPayload(0, "")),
  );
  assert.equal(missingCore.ok, false);
  assert.match(missingCore.error, /Core tip is unavailable/iu);
  assert.equal(calls.length, callCount);
});

check("health Electrum probes stop after canary failure and share one deadline", async () => {
  const calls = [];
  let now = 1_000;
  const boundedHealthElectrumPayload = isolatedFunction(
    API_PATH,
    "boundedHealthElectrumPayload",
    {
      Date: { now: () => now },
      ELECTRUM_HOST: "127.0.0.1",
      ELECTRUM_PORT: 50_001,
      HEALTH_CHECK_TIMEOUT_MS: 5_000,
      electrumHealthPayload: async (...args) => {
        calls.push(args);
        return { configured: true, ok: true };
      },
    },
  );

  const canaryFailure = JSON.parse(
    JSON.stringify(
      await boundedHealthElectrumPayload(
        { ok: false, timedOut: true },
        957_864,
        "a".repeat(64),
        5_750,
      ),
    ),
  );
  assert.equal(canaryFailure.ok, false);
  assert.equal(canaryFailure.timedOut, true);
  assert.match(canaryFailure.error, /canary failed/iu);
  assert.equal(calls.length, 0);

  now = 5_750;
  const expired = JSON.parse(
    JSON.stringify(
      await boundedHealthElectrumPayload(
        { ok: true },
        957_864,
        "a".repeat(64),
        5_750,
      ),
    ),
  );
  assert.equal(expired.ok, false);
  assert.equal(expired.timedOut, true);
  assert.match(expired.error, /budget expired/iu);
  assert.equal(calls.length, 0);

  now = 4_000;
  assert.deepEqual(
    JSON.parse(
      JSON.stringify(
        await boundedHealthElectrumPayload(
          { ok: true },
          957_864,
          "a".repeat(64),
          5_750,
        ),
      ),
    ),
    { configured: true, ok: true },
  );
  assert.deepEqual(JSON.parse(JSON.stringify(calls)), [
    [957_864, "a".repeat(64), 1_750],
  ]);
});

check("concurrent and adjacent health requests share one dependency sweep", async () => {
  let loads = 0;
  let resolveLoad;
  let now = 1_000;
  const pending = new Promise((resolve) => {
    resolveLoad = resolve;
  });
  const healthPayload = isolatedFunction(API_PATH, "healthPayload", {
    Date: { now: () => now },
    HEALTH_CHECK_TIMEOUT_MS: 5_000,
    HEALTH_PAYLOAD_CACHE_TTL_MS: 2_000,
    healthPayloadCache: null,
    loadHealthPayload: () => {
      loads += 1;
      return pending;
    },
    process: { env: {} },
  });

  const first = healthPayload();
  const second = healthPayload();
  assert.equal(loads, 1);
  resolveLoad({ ok: true, sweep: 1 });
  assert.deepEqual(
    JSON.parse(JSON.stringify(await Promise.all([first, second]))),
    [
      { ok: true, sweep: 1 },
      { ok: true, sweep: 1 },
    ],
  );

  assert.deepEqual(
    JSON.parse(JSON.stringify(await healthPayload())),
    { ok: true, sweep: 1 },
  );
  assert.equal(loads, 1);

  now = 3_001;
  assert.deepEqual(
    JSON.parse(JSON.stringify(await healthPayload())),
    { ok: true, sweep: 1 },
  );
  assert.equal(loads, 2);
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
  let summaryIndexedThroughBlock = 99;
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
          confirmedEvents: { count: 10, maxBlock: 99 },
          confirmedIds: { count: 1, maxBlock: 90 },
          confirmedTransfers: { count: 1, maxBlock: 95 },
        },
        scan: { blockHash, complete: true, tipHeight: 100 },
        summarySnapshot: {
          blockHash,
          eligible: true,
          indexedThroughBlock: summaryIndexedThroughBlock,
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
  assert.equal(gate.summarySnapshotOk, false);
  summaryIndexedThroughBlock = 100;
  const changedGate = await loadCanonicalPublicReadGate("livenet");
  assert.equal(changedGate.summarySnapshotOk, true);

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
        scan: { blockHash, complete: true, tipHeight: 100 },
        summarySnapshot: {
          blockHash,
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

check("operational status preserves compact canonical health coverage", async () => {
  let row = {
    confirmed_event_count: 23_914,
    confirmed_event_max_block: 123,
    confirmed_id_count: 493,
    confirmed_id_max_block: 118,
    confirmed_transfer_count: 87,
    confirmed_transfer_max_block: 121,
    generated_at: "2026-07-13T14:30:31.811Z",
    indexed_through_block: 123,
    scan_block_hash: "a".repeat(64),
    scan_consistency_complete: false,
    scan_metrics_complete: true,
    scan_metrics_stop_reason: "reached-tip",
    scan_metrics_tip_height: 123,
    scan_payload_complete: false,
    scan_payload_stop_reason: null,
    scan_payload_tip_height: 0,
    snapshot_id: "scan-snapshot",
    summary_coverage: {
      growthSummary: {
        nested: [119, 118, null],
        parent: [121, 120, null],
      },
      inceptionSummary: { parent: [118, null, null] },
      infinitySummary: { parent: [117, null, null] },
      logSummary: { parent: [120, null, null] },
      marketplaceSummary: {
        nested: [116, 115, null],
        parent: [120, 119, null],
      },
      tokenSummary: { parent: [119, null, null] },
      workFloor: { parent: [115, null, null] },
      workSummary: {
        nested: [114, 113, null],
        parent: [122, 121, null],
      },
    },
    summary_generated_at: "2026-07-13T14:29:00.000Z",
    summary_block_hash: "a".repeat(64),
    summary_indexed_at: "2026-07-13T14:29:01.000Z",
    summary_snapshot_id: "summary-snapshot",
    worker: {
      lastSuccessAt: "2026-07-13T14:30:00.000Z",
      ok: true,
      updatedAt: "stale-value",
    },
    worker_updated_at: "2026-07-13T14:30:00.818Z",
  };
  const operationalStatus = isolatedFunction(
    READER_PATH,
    "proofIndexOperationalStatusPayload",
    {
      dateIso: (value) => new Date(value).toISOString(),
      latestProofIndexOperationalMetadata: async () => row,
      objectRecord: (value) =>
        value && typeof value === "object" && !Array.isArray(value)
          ? value
          : {},
      proofIndexPool: () => ({}),
      rowNumber: (value, key) => Number(value?.[key] ?? 0),
      safeBlockHeight: (value) => {
        const height = Number(value);
        return Number.isSafeInteger(height) && height > 0 ? height : 0;
      },
    },
  );

  const status = JSON.parse(
    JSON.stringify(await operationalStatus("livenet")),
  );
  assert.equal(status.indexedAt, "2026-07-13T14:30:31.811Z");
  assert.equal(status.indexedThroughBlock, 123);
  assert.deepEqual(status.readModels, {
    confirmedEvents: { count: 23_914, maxBlock: 123 },
    confirmedIds: { count: 493, maxBlock: 118 },
    confirmedTransfers: { count: 87, maxBlock: 121 },
  });
  assert.deepEqual(status.scan, {
    blockHash: "a".repeat(64),
    complete: true,
    snapshotId: "scan-snapshot",
    stopReason: "reached-tip",
    tipHeight: 123,
  });
  assert.deepEqual(status.summarySnapshot, {
    blockHash: "a".repeat(64),
    coverageByKey: {
      growthSummary: 119,
      inceptionSummary: 118,
      infinitySummary: 117,
      logSummary: 120,
      marketplaceSummary: 116,
      tokenSummary: 119,
      workFloor: 115,
      workSummary: 114,
    },
    eligible: true,
    generatedAt: "2026-07-13T14:29:00.000Z",
    indexedAt: "2026-07-13T14:29:01.000Z",
    indexedThroughBlock: 114,
    snapshotId: "summary-snapshot",
  });
  assert.deepEqual(status.worker, {
    lastSuccessAt: "2026-07-13T14:30:00.000Z",
    ok: true,
    updatedAt: "2026-07-13T14:30:00.818Z",
  });

  row = {
    ...row,
    summary_coverage: {
      ...row.summary_coverage,
      growthSummary: {
        ...row.summary_coverage.growthSummary,
        nested: [],
      },
    },
  };
  const incomplete = JSON.parse(
    JSON.stringify(await operationalStatus("livenet")),
  );
  assert.equal(incomplete.summarySnapshot.coverageByKey.growthSummary, 0);
  assert.equal(incomplete.summarySnapshot.indexedThroughBlock, 0);
  assert.equal(incomplete.summarySnapshot.eligible, false);
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
          assert.deepEqual(Array.from(params), ["livenet", 0, ""]);
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
                log_height: 957712,
                log_snapshot_id: snapshotId,
                marketplace_floor_height: 957712,
                marketplace_height: 957712,
                marketplace_snapshot_id: snapshotId,
                metrics: {
                  activityItems: 23591,
                  confirmedComputerActions: 23585,
                  indexedThroughBlock: 957712,
                },
                payload_snapshot_id: snapshotId,
                payload_indexed_through_block_hash: "a".repeat(64),
                summary_refresh_block_hash: "a".repeat(64),
                summary_refresh_mode: "canonical-summary-refresh",
                snapshot_id: snapshotId,
                source_hashes: {
                  activity: { confirmed: 23585, count: 23591 },
                  blockScan: "a".repeat(64),
                  canonicalSummary: "b".repeat(64),
                },
                token_height: 957712,
                token_snapshot_id: snapshotId,
                totals: {
                  growthActualValueSats: 8_171_663_094,
                  growthWorkFloorValueSats: 8_171_663_094,
                  workActualValueSats: 8_171_663_094,
                  workNetworkValueSats: 8_171_663_094,
                },
                work_floor_height: 957712,
                work_floor_block_hash: "a".repeat(64),
                work_floor: {
                  actualValue: {
                    totalSats: 8_171_663_094,
                  },
                  liveNetworkValueSats: 8_171_663_094,
                  networkValueSats: 8_171_663_094,
                },
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

check("Inception H-1 oracle accepts only one exact green hash-bound summary", async () => {
  const snapshotId = "b8e77cd30cbed6855977c514";
  const height = 957_949;
  const blockHash =
    "00000000000000000001bda6bfa328f15edf597bfc364e02da42ea92a518a15e";
  const canonicalSummaryHash =
    "4f00b3494afb46ef88990948784a0ba8f2a22856615a39e15c3131f0ec979bdc";
  const workNetworkValueSats = 8_193_547_095.322113;
  let rows = [];
  let queryText = "";
  let queryParams = [];
  const readCanonicalSummary = isolatedFunction(
    READER_PATH,
    "proofIndexCanonicalSummaryLedgerPayload",
    {
      dateIso: (value) => new Date(value).toISOString(),
      proofIndexPool: () => ({
        async query(sql, params) {
          queryText = String(sql);
          queryParams = Array.from(params);
          return { rows };
        },
      }),
      safeBlockHeight: (value) =>
        Number.isSafeInteger(Number(value)) && Number(value) > 0
          ? Number(value)
          : 0,
    },
  );
  const exactRow = () => ({
    consistency: { ok: true, status: "green" },
    generated_at: "2026-07-14T03:03:04.765Z",
    growth_floor_height: height,
    growth_height: height,
    growth_snapshot_id: snapshotId,
    indexed_through_block: height,
    inception_height: height,
    inception_snapshot_id: snapshotId,
    infinity_height: height,
    infinity_snapshot_id: snapshotId,
    log_height: height,
    log_snapshot_id: snapshotId,
    marketplace_floor_height: height,
    marketplace_height: height,
    marketplace_snapshot_id: snapshotId,
    metrics: { indexedThroughBlock: height },
    payload_indexed_through_block_hash: blockHash,
    payload_snapshot_id: snapshotId,
    snapshot_id: snapshotId,
    source_hashes: {
      blockScan: blockHash,
      canonicalSummary: canonicalSummaryHash,
    },
    summary_refresh_block_hash: blockHash,
    summary_refresh_mode: "canonical-summary-refresh",
    token_height: height,
    token_snapshot_id: snapshotId,
    totals: {
      growthActualValueSats: workNetworkValueSats,
      growthWorkFloorValueSats: workNetworkValueSats,
      workActualValueSats: workNetworkValueSats,
      workNetworkValueSats,
    },
    work_floor: {
      actualValue: { totalSats: workNetworkValueSats },
      indexedThroughBlock: height,
      indexedThroughBlockHash: blockHash,
      liveNetworkValueSats: workNetworkValueSats,
      networkValueSats: workNetworkValueSats,
      snapshotId,
    },
    work_floor_block_hash: blockHash,
    work_floor_height: height,
    work_floor_snapshot_id: snapshotId,
    work_summary_floor_height: height,
    work_summary_height: height,
    work_summary_snapshot_id: snapshotId,
  });

  rows = [exactRow()];
  const exact = await readCanonicalSummary("livenet", height, blockHash);
  assert.deepEqual(queryParams, ["livenet", height, blockHash]);
  assert.match(queryText, /consistency->>'status'.*= 'green'/u);
  assert.equal(exact.snapshotId, snapshotId);
  assert.equal(exact.canonicalSummaryHash, canonicalSummaryHash);
  assert.equal(exact.workNetworkValueSats, workNetworkValueSats);

  const historicalWorkValueSnapshotHasFiniteNetworkValue = isolatedFunction(
    API_PATH,
    "historicalWorkValueSnapshotHasFiniteNetworkValue",
    {
      finitePositiveNumber: (value) =>
        Number.isFinite(Number(value)) && Number(value) > 0,
      numbersAgree: (left, right, tolerance = 0) =>
        Math.abs(Number(left) - Number(right)) <= tolerance,
    },
  );
  const canonicalInceptionValueSnapshotCheckpoint = isolatedFunction(
    API_PATH,
    "canonicalInceptionValueSnapshotCheckpoint",
    {
      INCEPTION_VALUE_SNAPSHOT_MODEL:
        "canonical-summary-h-minus-one-v1",
      historicalWorkValueSnapshotHasFiniteNetworkValue,
    },
  );
  const bond = {
    blockHash:
      "000000000000000000016ea78b0d57a7979de3542518c8690a1e5a808e691cc5",
    blockHeight: height + 1,
    blockIndex: 382,
  };
  const bound = canonicalInceptionValueSnapshotCheckpoint(exact, bond);
  assert.equal(bound.valueSnapshotId, snapshotId);
  assert.equal(bound.valueSnapshotBlockHash, blockHash);
  assert.equal(bound.workNetworkValueSats, workNetworkValueSats);
  assert.equal(
    exact.workFloor.actualValue.creditMinerFeeAccountingModel,
    undefined,
    "an immutable green H-1 row predating current-tip miner-fee coverage remains a valid value oracle",
  );
  assert.equal(
    canonicalInceptionValueSnapshotCheckpoint(
      {
        ...exact,
        workFloor: {
          ...exact.workFloor,
          actualValue: {
            ...exact.workFloor.actualValue,
            totalSats: workNetworkValueSats + 1,
          },
        },
      },
      bond,
    ),
    null,
  );
  assert.equal(
    canonicalInceptionValueSnapshotCheckpoint(
      { ...exact, indexedThroughBlockHash: "bad-hash" },
      bond,
    ),
    null,
  );

  rows = [];
  assert.equal(
    await readCanonicalSummary("livenet", height, blockHash),
    null,
  );
  rows = [
    {
      ...exactRow(),
      source_hashes: {
        blockScan: "f".repeat(64),
        canonicalSummary: canonicalSummaryHash,
      },
    },
  ];
  assert.equal(
    await readCanonicalSummary("livenet", height, blockHash),
    null,
  );
  rows = [
    {
      ...exactRow(),
      consistency: { ok: true, status: "amber" },
    },
  ];
  assert.equal(
    await readCanonicalSummary("livenet", height, blockHash),
    null,
  );
  rows = [exactRow(), exactRow()];
  assert.equal(
    await readCanonicalSummary("livenet", height, blockHash),
    null,
  );
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
      verifiedSummaryPayloadCheckpoint: async () => ({ exactTip: true }),
    },
  );
  const result = await ledgerConsistencyPayload("livenet", true);
  assert.equal(result.snapshotId, indexedLedger.snapshotId);
  assert.equal(result.metrics.activityItems, 23591);
  assert.equal(legacyReads, 0);
});

check("credit directory reads the hash-bound database checkpoint", async () => {
  const snapshotId = "exact-token-checkpoint";
  let storedReads = 0;
  let provenanceReads = 0;
  const canonicalTokenDirectoryPayload = isolatedFunction(
    API_PATH,
    "canonicalTokenDirectoryPayload",
    {
      freshDataUnavailableError: (message) => {
        const error = new Error(message);
        error.statusCode = 503;
        return error;
      },
      normalizeTokenScope: (scope) => String(scope ?? "").trim(),
      paginatedHistoryPayload: ({ indexedAt, items, kind, network, pagination, source }) => ({
        indexedAt,
        indexedThroughBlock: 100,
        items: items.slice(pagination.offset, pagination.offset + pagination.limit),
        kind,
        network,
        source,
        totalCount: items.length,
      }),
      payloadIndexedThroughBlockHash: (payload) =>
        payload.indexedThroughBlockHash,
      proofIndexPayloadIndexedThroughBlock: (payload) =>
        payload.indexedThroughBlock,
      storedCanonicalTokenSummaryPayload: async () => {
        storedReads += 1;
        return {
          indexedAt: "2026-07-13T22:35:58.045Z",
          indexedThroughBlock: 957912,
          indexedThroughBlockHash: "a".repeat(64),
          snapshotId,
          source: "proof-index",
          tokens: [{ tokenId: "one" }, { tokenId: "two" }],
        };
      },
      summaryPayloadWithCanonicalProvenance: async (payload, network, fresh, surface) => {
        provenanceReads += 1;
        assert.equal(network, "livenet");
        assert.equal(fresh, true);
        assert.equal(surface, "token-directory:all");
        return {
          ...payload,
          provenance: { ready: true, served: "exact-tip" },
        };
      },
    },
  );
  const result = await canonicalTokenDirectoryPayload(
    "livenet",
    "",
    { limit: 1, offset: 0, query: "" },
    true,
  );
  assert.equal(storedReads, 1);
  assert.equal(provenanceReads, 1);
  assert.equal(result.totalCount, 2);
  assert.equal(result.items[0].tokenId, "one");
  assert.equal(result.indexedThroughBlock, 957912);
  assert.equal(result.indexedThroughBlockHash, "a".repeat(64));
  assert.equal(result.snapshotId, snapshotId);
  assert.equal(result.provenance.served, "exact-tip");
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

check("legacy Log pagination honors offset and transaction aliases in both paths", () => {
  const apiBoundedInteger = isolatedFunction(API_PATH, "boundedInteger");
  const apiHistoryCursorOffset = isolatedFunction(
    API_PATH,
    "historyCursorOffset",
    { boundedInteger: apiBoundedInteger },
  );
  const apiPagination = isolatedFunction(
    API_PATH,
    "historyPaginationFromSearch",
    {
      HISTORY_PAGE_DEFAULT_LIMIT: 200,
      HISTORY_PAGE_MAX_LIMIT: 500,
      boundedInteger: apiBoundedInteger,
      historyCursorOffset: apiHistoryCursorOffset,
    },
  );
  const readerBoundedInteger = isolatedFunction(READER_PATH, "boundedInteger");
  const normalizedSnapshotId = isolatedFunction(
    READER_PATH,
    "normalizedSnapshotId",
  );
  const readerCursor = isolatedFunction(
    READER_PATH,
    "historyCursorFromSearch",
    {
      boundedInteger: readerBoundedInteger,
      normalizedSnapshotId,
    },
  );
  const readerPagination = isolatedFunction(
    READER_PATH,
    "historyPaginationFromSearch",
    {
      boundedInteger: readerBoundedInteger,
      historyCursorFromSearch: readerCursor,
      normalizedSnapshotId,
    },
  );
  for (const pagination of [apiPagination, readerPagination]) {
    const params = new URLSearchParams({
      limit: "2",
      offset: "7",
      page: "99",
      transactionId: "A".repeat(64),
    });
    const result = pagination(params);
    assert.equal(result.limit, 2);
    assert.equal(result.offset, 7);
    assert.equal(result.query, "a".repeat(64));

    params.set("cursor", "11");
    assert.equal(pagination(params).offset, 11, "cursor must outrank offset");
  }
});

check("recompacting summary-only payloads never turns truncated arrays into totals", () => {
  const compactTokenSummaryPayload = isolatedFunction(
    API_PATH,
    "compactTokenSummaryPayload",
    {
      SUMMARY_MARKET_LIMIT: 10,
      mergedTokenSummaryMetric: (token, summary, key) =>
        token?.[key] ?? summary?.[key],
      normalizeTokenScope: (value) => String(value ?? "").toLowerCase(),
      numericValue: (value) => Number(value) || 0,
      recentByCreatedAt: (items, limit) =>
        (Array.isArray(items) ? items : []).slice(0, limit),
      recentClosedTokenListings: (items, limit) => items.slice(0, limit),
      tokenAggregateSummaries: () => new Map(),
      tokenListingHasConfirmedSaleTicketSeal: () => false,
      tokenMatchesScope: () => false,
      tokenPayloadWithScopedHolderIdentity: (payload) => payload,
      tokenSummaryListings: (items, limit) => items.slice(0, limit),
      tokenSummaryMetricValue: (value) =>
        Number.isFinite(Number(value)) ? Number(value) : undefined,
    },
  );
  const compactRegistrySummaryPayload = isolatedFunction(
    API_PATH,
    "compactRegistrySummaryPayload",
    {
      SUMMARY_ACTIVITY_LIMIT: 10,
      SUMMARY_MARKET_LIMIT: 10,
      recentByCreatedAt: (items, limit) =>
        (Array.isArray(items) ? items : []).slice(0, limit),
    },
  );
  const tokenSummary = {
    closedListings: [{ listingId: "closed" }],
    collectionHasMore: { closedListings: true },
    holders: [{ address: "holder", balance: 1 }],
    listings: [{ listingId: "open" }],
    mints: [{ confirmed: true }],
    sales: [{ confirmed: true, priceSats: 1 }],
    stats: {
      confirmedMints: 40,
      confirmedSales: 20,
      confirmedTokens: 3,
      confirmedTransfers: 30,
      holders: 100,
      pendingMints: 2,
      pendingSales: 1,
      pendingTokens: 0,
      pendingTransfers: 4,
      transactions: 999,
    },
    summaryOnly: true,
    tokens: [{ openListings: 77, tokenId: "token" }],
    transfers: [{ confirmed: true }],
  };
  const once = compactTokenSummaryPayload(tokenSummary);
  const twice = compactTokenSummaryPayload(once);
  assert.equal(twice.totalCounts.closedListings, null);
  assert.equal(twice.totalCounts.holders, 100);
  assert.equal(twice.totalCounts.listings, 77);
  assert.equal(twice.totalCounts.mints, 42);
  assert.equal(twice.totalCounts.sales, 21);
  assert.equal(twice.totalCounts.transfers, 34);
  assert.equal(twice.totalCount, 999);
  assert.equal(twice.collectionHasMore.closedListings, true);

  const registryOnce = compactRegistrySummaryPayload({
    activity: [{ txid: "one" }],
    collectionHasMore: { listings: true },
    listings: [{ listingId: "one" }],
    pendingEvents: [{ txid: "pending" }],
    sales: [{ txid: "sale" }],
    stats: { pendingChanges: 8, total: 250 },
    summaryOnly: true,
  });
  const registryTwice = compactRegistrySummaryPayload(registryOnce);
  assert.equal(registryTwice.totalCounts.activity, 250);
  assert.equal(registryTwice.totalCounts.listings, null);
  assert.equal(registryTwice.totalCounts.pendingEvents, 8);
  assert.equal(registryTwice.totalCounts.sales, null);
  assert.equal(registryTwice.collectionHasMore.listings, true);
});

check("summary provenance rejects missing and mismatched required component IDs", async () => {
  const summaryPayloadRequiredComponents = isolatedFunction(
    API_PATH,
    "summaryPayloadRequiredComponents",
  );
  const payloadSnapshotId = isolatedFunction(API_PATH, "payloadSnapshotId");
  const freshDataUnavailableError = (message) => {
    const error = new Error(message);
    error.statusCode = 503;
    return error;
  };
  const provenance = isolatedFunction(
    API_PATH,
    "summaryPayloadWithCanonicalProvenance",
    {
      freshDataUnavailableError,
      payloadSnapshotId,
      summaryPayloadRequiredComponents,
      verifiedSummaryPayloadCheckpoint: async () => ({
        exactTip: true,
        indexedThroughBlock: 100,
        indexedThroughBlockHash: "a".repeat(64),
        tipHash: "a".repeat(64),
        tipHeight: 100,
      }),
    },
  );
  const base = {
    indexedThroughBlock: 100,
    indexedThroughBlockHash: "a".repeat(64),
    registry: { snapshotId: "snapshot" },
    snapshotId: "snapshot",
    token: {},
    workFloor: { snapshotId: "snapshot" },
  };
  const missing = await rejection(
    provenance(base, "livenet", true, "marketplace-summary"),
    (error) => error?.details?.code === "CANONICAL_SUMMARY_INCOHERENT",
  );
  assert.deepEqual(Array.from(missing.details.missingSnapshotIds), ["token"]);

  await rejection(
    provenance(
      { ...base, token: { snapshotId: "other" } },
      "livenet",
      true,
      "marketplace-summary",
    ),
    (error) => error?.details?.code === "CANONICAL_SUMMARY_INCOHERENT",
  );

  const accepted = await provenance(
    { ...base, token: { snapshotId: "snapshot" } },
    "livenet",
    true,
    "marketplace-summary",
  );
  assert.equal(accepted.provenance.coherent, true);
  assert.equal(accepted.provenance.served, "exact-tip");
  assert.equal(accepted.provenance.componentSnapshotIds.token, "snapshot");
});

check("fresh summary checkpoint verification detects a same-height reorg race", async () => {
  const payloadIndexedThroughBlockHash = isolatedFunction(
    API_PATH,
    "payloadIndexedThroughBlockHash",
  );
  const proofIndexPayloadIndexedThroughBlock = isolatedFunction(
    API_PATH,
    "proofIndexPayloadIndexedThroughBlock",
  );
  const freshDataUnavailableError = (message) => {
    const error = new Error(message);
    error.statusCode = 503;
    return error;
  };
  const firstHash = "a".repeat(64);
  const secondHash = "b".repeat(64);
  const gates = [
    {
      canonicalHash: firstHash,
      ok: true,
      ready: true,
      storedHash: firstHash,
      tipHeight: 100,
    },
    {
      canonicalHash: secondHash,
      ok: true,
      ready: true,
      storedHash: secondHash,
      tipHeight: 100,
    },
  ];
  const verify = isolatedFunction(
    API_PATH,
    "verifiedSummaryPayloadCheckpoint",
    {
      canonicalBlockHashAtHeight: async () => firstHash,
      canonicalPublicReadGate: async (_network, options) => {
        assert.equal(options.force, true);
        return gates.shift();
      },
      freshDataUnavailableError,
      payloadIndexedThroughBlockHash,
      proofIndexPayloadIndexedThroughBlock,
    },
  );
  await rejection(
    verify(
      { indexedThroughBlock: 100, indexedThroughBlockHash: firstHash },
      "livenet",
      true,
      "work-floor",
    ),
    (error) => error?.details?.code === "CANONICAL_SUMMARY_TIP_CHANGED",
  );
});

check("broadcast rate identity trusts only the loopback proxy boundary", () => {
  const broadcastClientKey = isolatedFunction(
    API_PATH,
    "broadcastClientKey",
  );
  assert.equal(
    broadcastClientKey({
      headers: { "x-forwarded-for": "203.0.113.7, 10.77.0.1" },
      socket: { remoteAddress: "127.0.0.1" },
    }),
    "203.0.113.7",
  );
  assert.equal(
    broadcastClientKey({
      headers: { "x-forwarded-for": "203.0.113.8" },
      socket: { remoteAddress: "10.77.0.1" },
    }),
    "10.77.0.1",
  );
});

check("broadcast rejects absent origins and a checkpoint change before submit", async () => {
  const allowed = isolatedFunction(API_PATH, "broadcastOriginAllowed", {
    BROADCAST_ALLOW_MISSING_ORIGIN: false,
    BROADCAST_EXTRA_ALLOWED_ORIGINS: new Set(),
    URL,
  });
  assert.equal(allowed({ headers: {} }), false);
  assert.equal(
    allowed({ headers: { origin: "https://wallet.proofofwork.me" } }),
    true,
  );

  const firstHash = "c".repeat(64);
  const secondHash = "d".repeat(64);
  const gates = [
    {
      canonicalHash: firstHash,
      ready: true,
      storedHash: firstHash,
      tipHeight: 100,
    },
    {
      canonicalHash: secondHash,
      ready: true,
      storedHash: secondHash,
      tipHeight: 100,
    },
  ];
  let submitted = false;
  const admission = isolatedFunction(API_PATH, "withBroadcastAdmission", {
    BROADCAST_CONCURRENCY_MAX: 4,
    broadcastActiveRequests: 0,
    broadcastOriginAllowed: () => true,
    canonicalPublicReadGate: async (_network, options) => {
      assert.equal(options.force, true);
      return gates.shift();
    },
    consumeBroadcastRateLimit: () => {},
    freshDataUnavailableError: (message) => {
      const error = new Error(message);
      error.statusCode = 503;
      return error;
    },
  });
  await rejection(
    admission(
      { headers: {} },
      "livenet",
      async ({ beforeSubmit }) => {
        await beforeSubmit();
        submitted = true;
      },
      { requireCanonical: true },
    ),
    (error) => error?.details?.code === "BROADCAST_CANONICAL_CHECKPOINT_CHANGED",
  );
  assert.equal(submitted, false);
});

check("slow broadcast bodies time out and release every concurrency lane", async () => {
  class SlowRequest extends EventEmitter {
    constructor() {
      super();
      this.destroyed = false;
      this.headers = {};
    }

    destroy() {
      this.destroyed = true;
    }

    setEncoding() {}
  }

  const requestBodyReadError = isolatedFunction(
    API_PATH,
    "requestBodyReadError",
  );
  const readRequestBody = isolatedFunction(API_PATH, "readRequestBody", {
    clearTimeout,
    requestBodyReadError,
    setTimeout,
  });
  const admission = isolatedFunction(API_PATH, "withBroadcastAdmission", {
    BROADCAST_CONCURRENCY_MAX: 4,
    broadcastActiveRequests: 0,
    broadcastOriginAllowed: () => true,
    broadcastRateLimitError: (message, code) => {
      const error = new Error(message);
      error.statusCode = 429;
      error.details = { code };
      return error;
    },
    consumeBroadcastRateLimit: () => {},
  });
  const requests = Array.from({ length: 4 }, () => new SlowRequest());
  const keeper = setTimeout(() => {}, 100);
  try {
    const occupied = requests.map((request) =>
      admission(request, "testnet", () =>
        readRequestBody(request, 1_000, {
          label: "Broadcast request body",
          timeoutMs: 15,
        }),
      ),
    );
    await rejection(
      admission(new SlowRequest(), "testnet", async () => "unexpected"),
      (error) => error?.details?.code === "BROADCAST_CONCURRENCY_LIMIT",
    );
    const settled = await Promise.allSettled(occupied);
    assert.equal(
      settled.every(
        (result) =>
          result.status === "rejected" &&
          result.reason?.details?.code === "REQUEST_BODY_TIMEOUT",
      ),
      true,
    );
    assert.equal(requests.every((request) => request.destroyed), true);
    assert.equal(
      requests.every(
        (request) =>
          request.listenerCount("data") === 0 &&
          request.listenerCount("end") === 0 &&
          request.listenerCount("error") === 0,
      ),
      true,
      "timed-out body listeners were not cleaned up",
    );
    assert.equal(
      await admission(new SlowRequest(), "testnet", async () => "released"),
      "released",
    );
  } finally {
    clearTimeout(keeper);
  }
});

check("fresh consistency fails closed when its database snapshot is not exact-tip", async () => {
  const freshDataUnavailableError = (message) => {
    const error = new Error(message);
    error.statusCode = 503;
    return error;
  };
  const ledgerConsistencyPayload = isolatedFunction(
    API_PATH,
    "ledgerConsistencyPayload",
    {
      ENABLE_REQUEST_LEDGER_RECOVERY: false,
      SUMMARY_PROOF_INDEX_READ_WAIT_MS: 100,
      errorSummary: (error) => String(error?.message ?? error),
      freshDataUnavailableError,
      ledgerConsistencyPayloadFromLedger: (ledger) => ledger,
      ledgerPayloadHasCurrentChecks: () => true,
      payloadWithFallbackAfterMs: async (promise) => promise,
      proofIndexCanonicalSummaryLedgerPayload: async () => ({
        indexedThroughBlock: 99,
        indexedThroughBlockHash: "e".repeat(64),
        snapshotId: "stale",
      }),
      summaryCanonicalLedgerPayload: async () => null,
      verifiedSummaryPayloadCheckpoint: async () => {
        throw freshDataUnavailableError("not exact");
      },
    },
  );
  await rejection(
    ledgerConsistencyPayload("livenet", true),
    (error) => error?.statusCode === 503,
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

check("WORK replay counts one canonical miner fee without collapsing same-tx movements", () => {
  const numericValue = (value, fallback = 0) => {
    const number = Number(value);
    return Number.isFinite(number) ? number : fallback;
  };
  const presentNonNegativeNumber = isolatedFunction(
    API_PATH,
    "presentNonNegativeNumber",
  );
  const creditReplayTransactionMinerFeeSats = isolatedFunction(
    API_PATH,
    "creditReplayTransactionMinerFeeSats",
    { presentNonNegativeNumber },
  );
  const creditMovementIdentity = isolatedFunction(
    API_PATH,
    "creditMovementIdentity",
    { numericValue },
  );
  const canonicalReplayTimeline = isolatedFunction(
    API_PATH,
    "canonicalReplayTimeline",
  );
  const canonicalReplayPrefixLengthAtMs = isolatedFunction(
    API_PATH,
    "canonicalReplayPrefixLengthAtMs",
  );
  const verifiedCanonicalMinerFeeCoverage = isolatedFunction(
    API_PATH,
    "verifiedCanonicalMinerFeeCoverage",
  );
  const compareCreditValueReplayEvents = (left, right) =>
    left.createdMs - right.createdMs ||
    left.order - right.order ||
    String(left.txid ?? "").localeCompare(String(right.txid ?? ""));
  const creditNetworkValueMetrics = isolatedFunction(
    API_PATH,
    "creditNetworkValueMetrics",
    {
      CREDIT_MINER_FEE_ACCOUNTING_MODEL:
        "canonical-unique-tx-input-output-v1",
      TOKEN_MARKETPLACE_MUTATION_KINDS: new Set([
        "token-listing",
        "token-listing-sealed",
        "token-listing-closed",
      ]),
      TOKEN_MIN_MUTATION_PRICE_SATS: 546,
      canonicalInceptionWorkMovementOracleByIdentity: () => new Map(),
      compareCreditValueReplayEvents,
      creditMovementIdentity,
      creditReplayTransactionMinerFeeSats,
      creditValueEventMs: (item) => Number(item?.createdMs),
      isTokenActivityItem: (item) =>
        String(item?.kind ?? "").startsWith("token-"),
      numericValue,
      tokenCanUseCreditNetworkFloor: () => true,
      verifiedCanonicalMinerFeeCoverage,
    },
  );
  const tokenId = "d4e5ebf11d104d6a63fb74e42094364b25a5f7199a09e5c0e71408972466a8b8";
  const txid = "7".repeat(64);
  const metrics = creditNetworkValueMetrics({
    baseValueAt: () => 1_000,
    confirmedActivity: [
      {
        canonicalMinerFeeSats: 77,
        canonicalMinerFeeCovered: true,
        confirmed: true,
        createdMs: 100,
        kind: "token-transfer",
        minerFeeSats: 999,
        tokenId,
        txid,
      },
    ],
    canonicalMinerFeeCoverage: {
      complete: true,
      confirmedEvents: 1,
      confirmedTransactions: 1,
      coveredConfirmedEvents: 1,
      coveredConfirmedTransactions: 1,
      missingConfirmedEvents: 0,
      missingConfirmedTransactions: 0,
      missingConfirmedTxids: [],
      source: "proof-indexer-normalized-input-output-totals",
    },
    cutoffMs: 200,
    includeEvents: true,
    tokenDefinitions: [
      { maxSupply: 1_000, ticker: "WORK", tokenId },
    ],
    tokenTransfers: [
      {
        amount: 10,
        confirmed: true,
        createdMs: 100,
        eventId: 1,
        minerFeeSats: 999,
        paidSats: 546,
        tokenId,
        txid,
      },
      {
        amount: 10,
        confirmed: true,
        createdMs: 100,
        eventId: 2,
        minerFeeSats: 999,
        paidSats: 546,
        tokenId,
        txid,
      },
    ],
  });

  assert.equal(metrics.events.length, 2);
  assert.equal(
    metrics.events.reduce((total, event) => total + event.amount, 0),
    20,
    "both WORK movements remain in the replay",
  );
  assert.equal(metrics.creditRegistryMutationFlowSats, 1_092);
  assert.equal(metrics.creditMinerFeeFlowSats, 77);
  assert.equal(
    metrics.creditMinerFeeAccountingModel,
    "canonical-unique-tx-input-output-v1",
  );
  const missingPerTxProof = creditNetworkValueMetrics({
    baseValueAt: () => 1_000,
    canonicalMinerFeeCoverage: {
      complete: true,
      confirmedEvents: 1,
      confirmedTransactions: 1,
      coveredConfirmedEvents: 1,
      coveredConfirmedTransactions: 1,
      missingConfirmedEvents: 0,
      missingConfirmedTransactions: 0,
      missingConfirmedTxids: [],
      source: "proof-indexer-normalized-input-output-totals",
    },
    confirmedActivity: [
      {
        confirmed: true,
        createdMs: 100,
        kind: "token-transfer",
        minerFeeSats: 999,
        tokenId,
        txid,
      },
    ],
    cutoffMs: 200,
    tokenDefinitions: [
      { maxSupply: 1_000, ticker: "WORK", tokenId },
    ],
    tokenTransfers: [
      {
        amount: 10,
        confirmed: true,
        createdMs: 100,
        eventId: 1,
        minerFeeSats: 999,
        paidSats: 546,
        tokenId,
        txid,
      },
    ],
  });
  assert.equal(missingPerTxProof.creditMinerFeeAccountingModel, undefined);
  assert.equal(missingPerTxProof.creditMinerFeeFlowSats, 0);
  assert.deepEqual(
    Array.from(metrics.events, (event) => event.transactionMinerFeeSats),
    [77, 77],
  );
  assert.equal(
    metrics.events.reduce((total, event) => total + event.minerFeeSats, 0),
    77,
  );
  assert.ok(metrics.creditMovementFrozenValueSats > 0);
  assert.notEqual(
    metrics.events[0].movementIdentity,
    metrics.events[1].movementIdentity,
  );
  const tokenStateWithCreditNetworkValueDetails = isolatedFunction(
    API_PATH,
    "tokenStateWithCreditNetworkValueDetails",
    {
      TOKEN_MIN_MUTATION_PRICE_SATS: 546,
      creditMovementIdentity,
      numericValue,
      tokenCanUseCreditNetworkFloor: () => true,
      tokenStateWithPendingStats: (state) => state,
    },
  );
  const enrichedState = tokenStateWithCreditNetworkValueDetails(
    {
      closedListings: [],
      listings: [],
      mints: [],
      sales: [],
      tokens: [{ ticker: "WORK", tokenId }],
      transfers: [
        {
          amount: 10,
          confirmed: true,
          createdMs: 100,
          eventId: 1,
          paidSats: 546,
          tokenId,
          txid,
        },
        {
          amount: 10,
          confirmed: true,
          createdMs: 100,
          eventId: 2,
          paidSats: 546,
          tokenId,
          txid,
        },
      ],
    },
    metrics,
  );
  assert.notEqual(
    enrichedState.transfers[0].creditValueAtConfirmSats,
    enrichedState.transfers[1].creditValueAtConfirmSats,
    "eventId-only movements must retain their distinct replay valuations",
  );
  assert.ok(
    Math.abs(
      metrics.creditEventFrozenValueSats -
        (metrics.creditMovementFrozenValueSats + 1_092 + 77),
    ) < 1e-9,
  );
});

check("Inception-bound WORK movements freeze once at each bond's own H-1 live oracle", () => {
  const WORK_TOKEN_ID =
    "d4e5ebf11d104d6a63fb74e42094364b25a5f7199a09e5c0e71408972466a8b8";
  const INCB_TOKEN_ID =
    "3cb25745f937f2b4e5508e5400189fe8fe679cd8e84bfa1e9176d70c9761f15d";
  const WORK_TOKEN_MAX_SUPPLY = 21_000_000;
  const INCEPTION_WORK_MOVEMENT_ORACLE_MODEL =
    "canonical-incb-h-minus-one-live-work-v1";
  const recipientAddress = "1BPVvi1GK4QkfqFMU4jHGjsQjyGwjJJJ7x";
  const attachedWorkAmount = 3_644_060;
  const first = {
    blockHash:
      "000000000000000000016ea78b0d57a7979de3542518c8690a1e5a808e691cc5",
    blockHeight: 957_950,
    blockIndex: 382,
    createdMs: 100,
    snapshotBlockHash:
      "00000000000000000001bda6bfa328f15edf597bfc364e02da42ea92a518a15e",
    snapshotBlockHeight: 957_949,
    snapshotId: "b8e77cd30cbed6855977c514",
    txid: "dd743fb69c519200cc190627219ba34ca2e63e6893e600b73e9aee8d4dac8fa4",
    workNetworkValueSats: 8_193_547_095.322113,
  };
  const second = {
    blockHash:
      "00000000000000000000db5329facae5d3bdd11f7d2e9df4bdcdda580069afa9",
    blockHeight: 958_007,
    blockIndex: 1_079,
    createdMs: 200,
    snapshotBlockHash:
      "00000000000000000000a9c98064bcf92b25b7c43576c8479befdcb17dfb85cd",
    snapshotBlockHeight: 958_006,
    snapshotId: "c8b800384da576c962ae82a5",
    txid: "d8b3760f694ec6dda316d93867d61ca39a1f105bed406110dbe28f5d0f56ce21",
    workNetworkValueSats: 9_857_361_066.004198,
  };
  const numericValue = (value, fallback = 0) => {
    const number = Number(value);
    return Number.isFinite(number) ? number : fallback;
  };
  const numbersAgree = (left, right, tolerance = 0) =>
    Math.abs(Number(left) - Number(right)) <= tolerance;
  const samePaymentAddress = (left, right) =>
    String(left ?? "").trim() === String(right ?? "").trim();
  const creditMovementIdentity = isolatedFunction(
    API_PATH,
    "creditMovementIdentity",
    { numericValue },
  );
  const issuanceMetadataFromMint = (mints) => {
    const mint = Array.isArray(mints) ? mints[0] : null;
    if (!mint?.validCanonicalIssuance) {
      return {
        attachedWorkAmount: 0,
        canonicalMints: 0,
        complete: false,
        confirmedMints: mint ? 1 : 0,
      };
    }
    return {
      attachedWorkAmount: mint.attachedWorkAmount,
      attachedWorkLiveValueAtSendSats:
        mint.attachedWorkLiveValueAtSendSats,
      canonicalMints: 1,
      complete: true,
      confirmedMints: 1,
      issuanceValueSnapshotBlockHash:
        mint.issuanceValueSnapshotBlockHash,
      issuanceValueSnapshotBlockHeight:
        mint.issuanceValueSnapshotBlockHeight,
      issuanceValueSnapshotCanonicalSummaryHash:
        mint.issuanceValueSnapshotCanonicalSummaryHash,
      issuanceValueSnapshotGeneratedAt:
        mint.issuanceValueSnapshotGeneratedAt,
      issuanceValueSnapshotId: mint.issuanceValueSnapshotId,
      issuanceValueSnapshotWorkNetworkValueSats:
        mint.issuanceValueSnapshotWorkNetworkValueSats,
    };
  };
  const canonicalInceptionWorkMovementOracleByIdentity = isolatedFunction(
    API_PATH,
    "canonicalInceptionWorkMovementOracleByIdentity",
    {
      INCB_TOKEN_ID,
      INCEPTION_WORK_MOVEMENT_ORACLE_MODEL,
      WORK_TOKEN_ID,
      WORK_TOKEN_MAX_SUPPLY,
      creditMovementIdentity,
      inceptionIssuanceMetadataFromMints: issuanceMetadataFromMint,
      numbersAgree,
      numericValue,
      samePaymentAddress,
    },
  );
  const transferFor = (bond) => ({
    _powEventIndex: 2,
    amount: attachedWorkAmount,
    blockHash: bond.blockHash,
    blockHeight: bond.blockHeight,
    blockIndex: bond.blockIndex,
    confirmed: true,
    createdMs: bond.createdMs,
    minerFeeSats: 0,
    network: "livenet",
    paidSats: 546,
    protocolVout: 3,
    recipientAddress,
    senderAddress: recipientAddress,
    tokenId: WORK_TOKEN_ID,
    txid: bond.txid,
  });
  const mintFor = (bond) => {
    const attachedWorkLiveValueAtSendSats =
      attachedWorkAmount *
      (bond.workNetworkValueSats / WORK_TOKEN_MAX_SUPPLY);
    return {
      attachedWorkAmount,
      attachedWorkLiveValueAtSendSats,
      bondRecipientAddress: recipientAddress,
      confirmed: true,
      issuanceCheckpointBlockHash: bond.blockHash,
      issuanceCheckpointBlockHeight: bond.blockHeight,
      issuanceCheckpointBlockIndex: bond.blockIndex,
      issuanceValueSnapshotBlockHash: bond.snapshotBlockHash,
      issuanceValueSnapshotBlockHeight: bond.snapshotBlockHeight,
      issuanceValueSnapshotCanonicalSummaryHash: "a".repeat(64),
      issuanceValueSnapshotGeneratedAt: "2026-07-14T13:05:51.033Z",
      issuanceValueSnapshotId: bond.snapshotId,
      issuanceValueSnapshotWorkNetworkValueSats:
        bond.workNetworkValueSats,
      tokenId: INCB_TOKEN_ID,
      txid: bond.txid,
      validCanonicalIssuance: true,
    };
  };
  const firstTransfer = transferFor(first);
  const secondTransfer = transferFor(second);
  const firstMint = mintFor(first);
  const secondMint = mintFor(second);

  const presentNonNegativeNumber = isolatedFunction(
    API_PATH,
    "presentNonNegativeNumber",
  );
  const creditReplayTransactionMinerFeeSats = isolatedFunction(
    API_PATH,
    "creditReplayTransactionMinerFeeSats",
    { presentNonNegativeNumber },
  );
  const verifiedCanonicalMinerFeeCoverage = isolatedFunction(
    API_PATH,
    "verifiedCanonicalMinerFeeCoverage",
  );
  const creditNetworkValueMetrics = isolatedFunction(
    API_PATH,
    "creditNetworkValueMetrics",
    {
      CREDIT_MINER_FEE_ACCOUNTING_MODEL:
        "canonical-unique-tx-input-output-v1",
      TOKEN_MARKETPLACE_MUTATION_KINDS: new Set([
        "token-listing",
        "token-listing-sealed",
        "token-listing-closed",
      ]),
      TOKEN_MIN_MUTATION_PRICE_SATS: 546,
      canonicalInceptionWorkMovementOracleByIdentity,
      compareCreditValueReplayEvents: (left, right) =>
        left.createdMs - right.createdMs || left.order - right.order,
      creditMovementIdentity,
      creditReplayTransactionMinerFeeSats,
      creditValueEventMs: (item) => Number(item?.createdMs),
      isTokenActivityItem: (item) =>
        String(item?.kind ?? "").startsWith("token-"),
      numericValue,
      tokenCanUseCreditNetworkFloor: (token) =>
        token?.tokenId === WORK_TOKEN_ID,
      verifiedCanonicalMinerFeeCoverage,
    },
  );
  const baseValueAt = () => 50_000_000;
  const metrics = creditNetworkValueMetrics({
    baseValueAt,
    cutoffMs: 300,
    includeEvents: true,
    tokenDefinitions: [
      {
        maxSupply: WORK_TOKEN_MAX_SUPPLY,
        ticker: "WORK",
        tokenId: WORK_TOKEN_ID,
      },
    ],
    tokenMints: [firstMint, secondMint],
    tokenTransfers: [firstTransfer, secondTransfer],
  });
  const firstEvent = metrics.events.find((event) => event.txid === first.txid);
  const secondEvent = metrics.events.find(
    (event) => event.txid === second.txid,
  );
  const firstExpectedValue =
    attachedWorkAmount *
    (first.workNetworkValueSats / WORK_TOKEN_MAX_SUPPLY);
  const secondExpectedValue =
    attachedWorkAmount *
    (second.workNetworkValueSats / WORK_TOKEN_MAX_SUPPLY);

  assert.equal(metrics.events.length, 2);
  assert.equal(
    metrics.events.filter((event) => event.txid === first.txid).length,
    1,
  );
  assert.equal(
    metrics.events.filter((event) => event.txid === second.txid).length,
    1,
  );
  assert.equal(
    firstEvent.creditFloorAtConfirmModel,
    INCEPTION_WORK_MOVEMENT_ORACLE_MODEL,
  );
  assert.equal(
    secondEvent.creditFloorAtConfirmModel,
    INCEPTION_WORK_MOVEMENT_ORACLE_MODEL,
  );
  assert.ok(
    Math.abs(
      firstEvent.creditFloorAtConfirmSats -
        first.workNetworkValueSats / WORK_TOKEN_MAX_SUPPLY,
    ) < 1e-12,
  );
  assert.ok(
    Math.abs(
      secondEvent.creditFloorAtConfirmSats -
        second.workNetworkValueSats / WORK_TOKEN_MAX_SUPPLY,
    ) < 1e-12,
  );
  assert.ok(
    Math.abs(firstEvent.creditValueAtConfirmSats - firstExpectedValue) < 0.01,
  );
  assert.ok(
    Math.abs(secondEvent.creditValueAtConfirmSats - secondExpectedValue) <
      0.01,
  );
  assert.ok(
    Math.abs(
      metrics.creditMovementFrozenValueSats -
        (firstExpectedValue + secondExpectedValue),
    ) < 0.01,
    "each attached WORK movement must enter frozen value exactly once",
  );
  assert.equal(firstEvent.valueSnapshotBlockHeight, first.snapshotBlockHeight);
  assert.equal(
    secondEvent.valueSnapshotBlockHeight,
    second.snapshotBlockHeight,
  );

  const canonicalReplayTimeline = isolatedFunction(
    API_PATH,
    "canonicalReplayTimeline",
  );
  const canonicalReplayPrefixLengthAtMs = isolatedFunction(
    API_PATH,
    "canonicalReplayPrefixLengthAtMs",
  );
  const growthActualLiveTotalSatsAtProvider = isolatedFunction(
    API_PATH,
    "growthActualLiveTotalSatsAtProvider",
    {
      TOKEN_MARKETPLACE_MUTATION_KINDS: new Set([
        "token-listing",
        "token-listing-sealed",
        "token-listing-closed",
      ]),
      TOKEN_MIN_MUTATION_PRICE_SATS: 546,
      canonicalInceptionWorkMovementOracleByIdentity,
      canonicalReplayPrefixLengthAtMs,
      canonicalReplayTimeline,
      compareCreditValueReplayEvents: (left, right) =>
        left.createdMs - right.createdMs || left.order - right.order,
      creditMovementIdentity,
      creditReplayTransactionMinerFeeSats,
      creditValueEventMs: (item) => Number(item?.createdMs),
      growthActualBaseNetworkValueAtProvider: () => () => 50_000_000,
      growthActualBaseNetworkValueBeforeCanonicalItemProvider:
        (_collections, provider) => (_source, createdMs) =>
          provider(createdMs - 1),
      isTokenActivityItem: (item) =>
        String(item?.kind ?? "").startsWith("token-"),
      numericValue,
      tokenCanUseCreditNetworkFloor: (token) =>
        token?.tokenId === WORK_TOKEN_ID,
    },
  );
  const growthTotalAt = growthActualLiveTotalSatsAtProvider(
    [],
    [],
    [],
    [
      {
        maxSupply: WORK_TOKEN_MAX_SUPPLY,
        ticker: "WORK",
        tokenId: WORK_TOKEN_ID,
      },
    ],
    [firstMint, secondMint],
    [firstTransfer, secondTransfer],
    [],
  );
  const movementLiveFactor = attachedWorkAmount / WORK_TOKEN_MAX_SUPPLY;
  const fixedTransferFlowSats = 546;
  const expectedAfterFirst =
    50_000_000 +
    (50_000_000 + firstExpectedValue + fixedTransferFlowSats) *
      movementLiveFactor +
    fixedTransferFlowSats;
  const expectedAfterSecond =
    50_000_000 +
    (50_000_000 +
      firstExpectedValue +
      secondExpectedValue +
      fixedTransferFlowSats * 2) *
      (movementLiveFactor * 2) +
    fixedTransferFlowSats * 2;
  assert.ok(
    Math.abs(growthTotalAt(first.createdMs) - expectedAfterFirst) < 0.01,
    "Growth history must replay the first bond at its own H-1 oracle",
  );
  assert.ok(
    Math.abs(growthTotalAt(second.createdMs) - expectedAfterSecond) < 0.01,
    "Growth history must replay both bonds once at their separate H-1 oracles",
  );

  const wrongRecipientTransfer = {
    ...secondTransfer,
    recipientAddress: "1CQud1ZkoR4NSRJ2Lw31KssCpR4zSYMLJL",
  };
  const wrongBlockTransfer = {
    ...secondTransfer,
    blockHash: "f".repeat(64),
  };
  assert.equal(
    canonicalInceptionWorkMovementOracleByIdentity(
      [secondMint],
      [wrongRecipientTransfer],
    ).size,
    0,
  );
  assert.equal(
    canonicalInceptionWorkMovementOracleByIdentity(
      [secondMint],
      [wrongBlockTransfer],
    ).size,
    0,
  );
  const mismatchMetrics = creditNetworkValueMetrics({
    baseValueAt,
    cutoffMs: 300,
    includeEvents: true,
    tokenDefinitions: [
      {
        maxSupply: WORK_TOKEN_MAX_SUPPLY,
        ticker: "WORK",
        tokenId: WORK_TOKEN_ID,
      },
    ],
    tokenMints: [secondMint],
    tokenTransfers: [wrongBlockTransfer],
  });
  assert.equal(
    mismatchMetrics.events[0].creditFloorAtConfirmModel,
    "canonical-frozen-credit-replay-v1",
  );
  assert.ok(
    Math.abs(
      mismatchMetrics.events[0].creditValueAtConfirmSats -
        secondExpectedValue,
    ) > 1,
    "a provenance mismatch must not inherit the Inception H-1 oracle",
  );
});

check("exact-tip WORK transfer projection preserves both Inception H-1 values", () => {
  const WORK_TOKEN_ID =
    "d4e5ebf11d104d6a63fb74e42094364b25a5f7199a09e5c0e71408972466a8b8";
  const WORK_TRANSFER_VALUE_PROJECTION_MODEL =
    "canonical-work-transfer-value-projection-v1";
  const numericFields = [
    "creditAmountMoved",
    "creditFloorAtConfirmSats",
    "creditLiveFloorSats",
    "creditLiveValueSats",
    "creditRevaluationFloorSats",
    "creditValueAtConfirmSats",
    "frozenNetworkValueSats",
    "liveNetworkValueSats",
  ];
  const projectedFields = [
    "amount",
    "confirmed",
    "creditFloorAtConfirmModel",
    "eventKeyVout",
    "recipientAddress",
    "senderAddress",
    "tokenId",
    "txid",
    "valueSnapshotBlockHash",
    "valueSnapshotBlockHeight",
    "valueSnapshotCanonicalSummaryHash",
    "valueSnapshotGeneratedAt",
    "valueSnapshotId",
    ...numericFields,
  ];
  const fromState = isolatedFunction(
    API_PATH,
    "canonicalWorkTransferValueProjectionFromState",
    {
      WORK_TOKEN_ID,
      WORK_TRANSFER_VALUE_PROJECTION_FIELD_NAMES: projectedFields,
      WORK_TRANSFER_VALUE_PROJECTION_MODEL,
      normalizeTokenScope: (value) => String(value ?? "").toLowerCase(),
      numericValue: (value, fallback = 0) => {
        const number = Number(value);
        return Number.isFinite(number) ? number : fallback;
      },
    },
  );
  const isUsable = isolatedFunction(
    API_PATH,
    "canonicalWorkTransferValueProjectionIsUsable",
    { WORK_TRANSFER_VALUE_PROJECTION_MODEL },
  );
  const mergeCreditNetworkValueRecord = isolatedFunction(
    API_PATH,
    "mergeCreditNetworkValueRecord",
    { CREDIT_NETWORK_VALUE_FIELD_NAMES: numericFields },
  );
  const transferHistoryItemKey = isolatedFunction(
    API_PATH,
    "tokenTransferHistoryItemKey",
    {
      numericValue: (value, fallback = 0) => {
        const number = Number(value);
        return Number.isFinite(number) ? number : fallback;
      },
    },
  );
  const mergeItems = (base, overlay, keyFor, merge) => {
    const byKey = new Map((base ?? []).map((item) => [keyFor(item), item]));
    for (const item of overlay ?? []) {
      const key = keyFor(item);
      byKey.set(key, merge(byKey.get(key), item));
    }
    return [...byKey.values()];
  };
  const apply = isolatedFunction(
    API_PATH,
    "tokenStateWithCanonicalWorkTransferValues",
    {
      canonicalWorkTransferValueProjectionIsUsable: isUsable,
      mergeTokenStateItemsByKey: mergeItems,
      mergeTokenTransferRecord: mergeCreditNetworkValueRecord,
      tokenStateWithPendingStats: (state) => state,
      tokenTransferHistoryItemKey: transferHistoryItemKey,
    },
  );
  const values = [
    {
      floor: 390.168909301053,
      frozen: 1_421_798_915.6275952,
      hash: "00000000000000000001bda6bfa328f15edf597bfc364e02da42ea92a518a15e",
      height: 957_949,
      snapshotId: "first-h-minus-one-snapshot",
      txid: "dd743fb69c519200cc190627219ba34ca2e63e6893e600b73e9aee8d4dac8fa4",
    },
    {
      floor: 469.3981460001999,
      frozen: 1_710_515_007.9134884,
      hash: "00000000000000000000a9c98064bcf92b25b7c43576c8479befdcb17dfb85cd",
      height: 958_006,
      snapshotId: "second-h-minus-one-snapshot",
      txid: "d8b3760f694ec6dda316d93867d61ca39a1f105bed406110dbe28f5d0f56ce21",
    },
  ];
  const rawTransfers = values.map((value, index) => ({
    amount: 3_644_060,
    creditFloorAtConfirmSats: 0,
    creditValueAtConfirmSats: 0,
    eventKeyVout: index + 1,
    tokenId: WORK_TOKEN_ID,
    txid: value.txid,
  }));
  const valuedTransfers = values.map((value) => ({
    ...rawTransfers.find((item) => item.txid === value.txid),
    confirmed: true,
    creditAmountMoved: 3_644_060,
    creditFloorAtConfirmModel: "canonical-incb-h-minus-one-live-work-v1",
    creditFloorAtConfirmSats: value.floor,
    creditLiveFloorSats: 344.16840058442443,
    creditLiveValueSats: 3_644_060 * 344.16840058442443,
    creditRevaluationFloorSats: 344.16840058442443,
    creditValueAtConfirmSats: value.frozen,
    frozenNetworkValueSats: value.frozen + 546,
    liveNetworkValueSats: 3_644_060 * 344.16840058442443 + 546,
    recipientAddress: "1BPVvi1GK4QkfqFMU4jHGjsQjyGwjJJJ7x",
    senderAddress: "1BPVvi1GK4QkfqFMU4jHGjsQjyGwjJJJ7x",
    valueSnapshotBlockHash: value.hash,
    valueSnapshotBlockHeight: value.height,
    valueSnapshotCanonicalSummaryHash: `${value.txid.slice(0, 63)}a`,
    valueSnapshotGeneratedAt: `2026-07-14T${value.height === 957_949 ? "03" : "06"}:00:00.000Z`,
    valueSnapshotId: value.snapshotId,
  }));
  const exactTipLiveFloorSats = 683.8074244507424;
  const projection = fromState(
    {
      mints: Array.from({ length: 100 }, (_, index) => ({ index })),
      transfers: [
        ...valuedTransfers,
        { ...valuedTransfers[0], confirmed: false, txid: "f".repeat(64) },
      ],
    },
    exactTipLiveFloorSats,
  );
  const projected = apply({ transfers: rawTransfers }, projection);

  assert.equal(projection.model, WORK_TRANSFER_VALUE_PROJECTION_MODEL);
  assert.equal(projection.items.length, 2, "only confirmed transfers are projected");
  for (const value of values) {
    const item = projected.transfers.find((row) => row.txid === value.txid);
    assert.ok(Math.abs(item.creditFloorAtConfirmSats - value.floor) < 1e-12);
    assert.ok(Math.abs(item.creditValueAtConfirmSats - value.frozen) < 0.01);
    assert.equal(item.creditLiveFloorSats, exactTipLiveFloorSats);
    assert.equal(item.creditRevaluationFloorSats, exactTipLiveFloorSats);
    assert.ok(
      Math.abs(
        item.creditLiveValueSats -
          item.creditAmountMoved * exactTipLiveFloorSats,
      ) < 0.01,
    );
    assert.ok(
      Math.abs(
        item.liveNetworkValueSats - (item.creditLiveValueSats + 546),
      ) < 0.01,
    );
    assert.equal(item.valueSnapshotBlockHeight, value.height);
    assert.equal(item.valueSnapshotBlockHash, value.hash);
    assert.equal(item.valueSnapshotId, value.snapshotId);
  }
  const absentTxid = "e".repeat(64);
  const projectedWithoutAddition = apply(
    { transfers: rawTransfers },
    {
      ...projection,
      items: [
        ...projection.items,
        {
          ...projection.items[0],
          eventKeyVout: 99,
          txid: absentTxid,
        },
      ],
    },
  );
  assert.equal(projectedWithoutAddition.transfers.length, rawTransfers.length);
  assert.equal(
    projectedWithoutAddition.transfers.some(
      (item) => item.txid === absentTxid,
    ),
    false,
    "a valuation projection cannot create a transfer absent from the indexed page",
  );

  const matches = isolatedFunction(
    API_PATH,
    "canonicalWorkTransferValueSummaryMatchesPayload",
    {
      canonicalWorkTransferValueProjectionIsUsable: isUsable,
      proofIndexPayloadIndexedThroughBlock: (payload) =>
        Number(payload?.indexedThroughBlock),
    },
  );
  const blockHash = "b".repeat(64);
  const summary = {
    indexedThroughBlock: 958_016,
    indexedThroughBlockHash: blockHash,
    snapshotId: "exact-tip-snapshot",
    workTransferValueProjection: projection,
  };
  const gate = {
    canonicalHash: blockHash,
    indexedThroughBlock: 958_016,
    ready: true,
    storedHash: blockHash,
    summarySnapshot: { snapshotId: "exact-tip-snapshot" },
    summarySnapshotOk: true,
    tipHeight: 958_016,
  };
  assert.equal(matches(summary, { indexedThroughBlock: 958_016 }, gate), true);
  assert.equal(
    matches(summary, { indexedThroughBlock: 958_015 }, gate),
    false,
    "a mixed-height token page cannot receive the projection",
  );
  assert.equal(
    matches(summary, { indexedThroughBlock: 958_016 }, {
      ...gate,
      canonicalHash: "c".repeat(64),
    }),
    false,
    "a hash mismatch must fail closed",
  );
  assert.equal(
    matches(summary, { indexedThroughBlock: 958_016 }, {
      ...gate,
      storedHash: "d".repeat(64),
    }),
    false,
    "a stored checkpoint hash mismatch must fail closed",
  );
  assert.equal(
    matches(summary, { indexedThroughBlock: 958_016 }, {
      ...gate,
      summarySnapshotOk: false,
    }),
    false,
    "an ineligible database summary must fail closed",
  );
  assert.equal(
    matches(summary, { indexedThroughBlock: 958_016 }, {
      ...gate,
      summarySnapshot: { snapshotId: "different-snapshot" },
    }),
    false,
    "a different eligible database summary cannot lend its gate to the projection",
  );
});

check("growth chart replay is linear and matches exact credit valuation", () => {
  const numericValue = (value, fallback = 0) => {
    const number = Number(value);
    return Number.isFinite(number) ? number : fallback;
  };
  const baseValueProvider = () => (atMs) =>
    1_000 + Math.max(0, Math.floor(Number(atMs) / 100)) * 100;
  const compareCreditValueReplayEvents = (left, right) =>
    left.createdMs - right.createdMs ||
    left.order - right.order ||
    String(left.txid ?? "").localeCompare(String(right.txid ?? ""));
  const presentNonNegativeNumber = isolatedFunction(
    API_PATH,
    "presentNonNegativeNumber",
  );
  const creditReplayTransactionMinerFeeSats = isolatedFunction(
    API_PATH,
    "creditReplayTransactionMinerFeeSats",
    { presentNonNegativeNumber },
  );
  const creditMovementIdentity = isolatedFunction(
    API_PATH,
    "creditMovementIdentity",
    { numericValue },
  );
  const canonicalReplayTimeline = isolatedFunction(
    API_PATH,
    "canonicalReplayTimeline",
  );
  const canonicalReplayPrefixLengthAtMs = isolatedFunction(
    API_PATH,
    "canonicalReplayPrefixLengthAtMs",
  );
  const globals = {
    CREDIT_MINER_FEE_ACCOUNTING_MODEL:
      "canonical-unique-tx-input-output-v1",
    TOKEN_MARKETPLACE_MUTATION_KINDS: new Set([
      "token-listing",
      "token-listing-sealed",
      "token-listing-closed",
    ]),
    TOKEN_MIN_MUTATION_PRICE_SATS: 546,
    canonicalInceptionWorkMovementOracleByIdentity: () => new Map(),
    compareCreditValueReplayEvents,
    canonicalReplayPrefixLengthAtMs,
    canonicalReplayTimeline,
    creditMovementIdentity,
    creditReplayTransactionMinerFeeSats,
    creditValueEventHeight: () => Number.MAX_SAFE_INTEGER,
    creditValueEventIndex: () => Number.MAX_SAFE_INTEGER,
    creditValueEventMs: (item) => Number(item?.createdMs),
    growthActualBaseNetworkValueBeforeCanonicalItemProvider:
      (_collections, provider) =>
      (_source, createdMs) =>
        provider(createdMs - 1),
    growthActualBaseNetworkValueAtProvider: baseValueProvider,
    isTokenActivityItem: (item) => String(item?.kind ?? "").startsWith("token-"),
    numericValue,
    tokenCanUseCreditNetworkFloor: () => true,
    verifiedCanonicalMinerFeeCoverage: isolatedFunction(
      API_PATH,
      "verifiedCanonicalMinerFeeCoverage",
    ),
  };
  const fastProvider = isolatedFunction(
    API_PATH,
    "growthActualLiveTotalSatsAtProvider",
    globals,
  );
  const exactMetrics = isolatedFunction(
    API_PATH,
    "creditNetworkValueMetrics",
    globals,
  );
  const tokenId = "a".repeat(64);
  const tokenDefinitions = [
    { maxSupply: 1_000, ticker: "FAST", tokenId },
  ];
  const row = (kind, txid, createdMs, extra = {}) => ({
    confirmed: true,
    createdMs,
    kind,
    tokenId,
    txid,
    ...extra,
  });
  const idActivity = [
    row("token-create", "1".repeat(64), 50, {
      amountSats: 546,
      minerFeeSats: 10,
      proofPaymentSats: 546,
    }),
    row("token-mint", "2".repeat(64), 100, { minerFeeSats: 30 }),
    row("token-listing", "3".repeat(64), 150, {
      marketplaceMutationFeeSats: 546,
      minerFeeSats: 20,
    }),
    row("token-transfer", "4".repeat(64), 200, { minerFeeSats: 40 }),
    row("token-sale", "5".repeat(64), 300, { minerFeeSats: 50 }),
  ];
  const tokenMints = [
    row("mint", "2".repeat(64), 100, { amount: 100, paidSats: 1_000 }),
  ];
  const tokenTransfers = [
    row("transfer", "4".repeat(64), 200, { amount: 20, paidSats: 546 }),
  ];
  const tokenSales = [
    row("sale", "5".repeat(64), 300, {
      amount: 10,
      marketplaceMutationFeeSats: 600,
      priceSats: 5_000,
    }),
  ];
  const at = fastProvider(
    [],
    idActivity,
    [],
    tokenDefinitions,
    tokenMints,
    tokenTransfers,
    tokenSales,
  );
  const expectedAt = (cutoffMs) => {
    const baseValueAt = baseValueProvider();
    const base = baseValueAt(cutoffMs);
    const credit = exactMetrics({
      baseValueAt,
      confirmedActivity: idActivity,
      cutoffMs,
      tokenDefinitions,
      tokenMints,
      tokenSales,
      tokenTransfers,
    });
    return base + credit.creditEventLiveValueSats;
  };
  for (const cutoffMs of [0, 50, 100, 150, 200, 300, 400]) {
    assert.ok(
      Math.abs(at(cutoffMs) - expectedAt(cutoffMs)) < 1e-9,
      `linear chart value diverged at ${cutoffMs}`,
    );
  }
  assert.ok(
    Math.abs(at(100) - expectedAt(100)) < 1e-9,
    "linear chart replay did not reset for an earlier cutoff",
  );
});

check("canonical credit base lookup is hash exact and preserves nonlinear state", () => {
  const numericValue = (value, fallback = 0) => {
    const number = Number(value);
    return Number.isFinite(number) ? number : fallback;
  };
  const blockHash = "a".repeat(64);
  const otherBlockHash = "b".repeat(64);
  const targetTxid = "f".repeat(64);
  const emptyGrowthActualBaseState = () => ({ flowSats: 0, powids: 0 });
  const growthActualBaseStateApplyContribution = (
    state,
    contribution,
    multiplier = 1,
  ) => {
    state[contribution.field] += contribution.value * multiplier;
    return state;
  };
  const growthActualBaseStateAdd = (state, addition, multiplier = 1) => {
    state.flowSats += numericValue(addition?.flowSats) * multiplier;
    state.powids += numericValue(addition?.powids) * multiplier;
    return state;
  };
  const growthActualBaseStateTotalSats = (state) =>
    state.powids ** 2 * 10 + state.flowSats;
  const growthActualBaseNetworkValueEvents = (
    records,
    idActivity,
    sales,
    tokenDefinitions,
    tokenMints,
    tokenTransfers,
    tokenSales,
  ) => [
    ...(Array.isArray(records) ? records : []).map((source) => ({
      source,
      contribution: { field: "powids", value: 1 },
    })),
    ...[
      idActivity,
      sales,
      tokenDefinitions,
      tokenMints,
      tokenTransfers,
      tokenSales,
    ]
      .flatMap((items) => (Array.isArray(items) ? items : []))
      .map((source) => ({
        source,
        contribution: { field: "flowSats", value: numericValue(source.value) },
      })),
  ]
    .filter(
      ({ source }) =>
        source?.confirmed === true &&
        Number.isFinite(Date.parse(source?.createdAt ?? "")),
    )
    .map(({ source, contribution }) => ({
      blockHash: String(source.blockHash ?? "").trim().toLowerCase(),
      blockHeight: Number(source.blockHeight),
      blockIndex: Number(source.blockIndex),
      contribution,
      createdMs: Date.parse(source.createdAt),
      source,
      txid: String(source.txid ?? "").trim().toLowerCase(),
    }));
  const prefixProviderFactory = isolatedFunction(
    API_PATH,
    "growthActualBaseNetworkValueBeforeCanonicalItemProvider",
    {
      emptyGrowthActualBaseState,
      growthActualBaseNetworkValueEvents,
      growthActualBaseStateAdd,
      growthActualBaseStateApplyContribution,
      growthActualBaseStateTotalSats,
      numericValue,
    },
  );
  const item = (value, blockHeight, blockIndex, createdAt, extra = {}) => ({
    blockHash,
    blockHeight,
    blockIndex,
    confirmed: true,
    createdAt,
    network: "livenet",
    txid: String(value).padStart(64, "0"),
    value,
    ...extra,
  });
  const emptyCollections = () => ({
    idActivity: [],
    records: [],
    sales: [],
    tokenDefinitions: [],
    tokenMints: [],
    tokenSales: [],
    tokenTransfers: [],
  });
  const collections = emptyCollections();
  const sharedEarlierTxid = "1".repeat(64);
  collections.records = [
    item(101, 99, 1, "2035-01-01T00:00:00.000Z", {
      blockHash: otherBlockHash,
      txid: sharedEarlierTxid,
    }),
    item(102, 100, 1, "2030-01-01T00:00:00.000Z"),
    item(103, 100, 2, "1990-01-01T00:00:00.000Z", {
      blockHash: otherBlockHash,
    }),
    item(104, 100, 3, "2020-01-01T00:00:00.000Z", {
      blockHash: "",
    }),
  ];
  collections.idActivity = [
    item(2, 99, 2, "2036-01-01T00:00:00.000Z", {
      blockHash: otherBlockHash,
      txid: sharedEarlierTxid,
    }),
    item(3, 100, 1, "2030-01-01T00:00:00.000Z"),
    item(5, 100, 2, "1990-01-01T00:00:00.000Z", {
      blockHash: otherBlockHash,
    }),
    item(7, 100, 3, "2020-01-01T00:00:00.000Z", {
      blockHash: "",
    }),
    item(13, 100, 4, "not-a-date"),
    item(11, 100, 6, "2010-01-01T00:00:00.000Z"),
  ];
  const timestampProvider = () => 999;
  const diagnostics = {};
  const before = prefixProviderFactory(
    collections,
    timestampProvider,
    diagnostics,
  );
  const source = (blockHeight, blockIndex, extra = {}) => ({
    blockHash,
    blockHeight,
    blockIndex,
    confirmed: true,
    createdAt: "2000-01-01T00:00:00.000Z",
    network: "livenet",
    txid: targetTxid,
    ...extra,
  });

  const exactBefore = (target) => {
    const targetHeight = Number(target.blockHeight);
    const targetIndex = Number(target.blockIndex);
    const targetHash = String(target.blockHash ?? "").trim().toLowerCase();
    const targetTxid = String(target.txid ?? "").trim().toLowerCase();
    const exactHash = /^[0-9a-f]{64}$/u.test(targetHash);
    const state = emptyGrowthActualBaseState();
    for (const event of growthActualBaseNetworkValueEvents(
      collections.records,
      collections.idActivity,
      collections.sales,
      collections.tokenDefinitions,
      collections.tokenMints,
      collections.tokenTransfers,
      collections.tokenSales,
    )) {
      const precedes =
        event.blockHeight < targetHeight ||
        (event.blockHeight === targetHeight &&
          event.blockIndex < targetIndex &&
          (!exactHash || event.blockHash === targetHash));
      if (
        precedes &&
        !(event.txid && event.txid === targetTxid)
      ) {
        growthActualBaseStateApplyContribution(state, event.contribution);
      }
    }
    return growthActualBaseStateTotalSats(state);
  };
  const exactSource = source(100, 5);
  const hashlessSource = source(100, 5, { blockHash: "" });
  const nextHeightSource = source(101, 0);
  const sameTxSource = source(100, 5, { txid: sharedEarlierTxid });
  for (const target of [
    exactSource,
    hashlessSource,
    nextHeightSource,
    sameTxSource,
  ]) {
    assert.equal(before(target, Date.now()), exactBefore(target));
  }
  assert.equal(before(exactSource, Date.now()), 45);
  assert.equal(before(hashlessSource, Date.now()), 177);
  assert.equal(before(nextHeightSource, Date.now()), 188);
  assert.equal(before(sameTxSource, Date.now()), 13);
  for (let index = 0; index < 1_000; index += 1) {
    assert.equal(before(exactSource, Date.now()), exactBefore(exactSource));
  }
  assert.equal(
    diagnostics.invalidCreatedAtRows,
    1,
    "invalid timestamps must be explicitly observed and excluded like the exact scan",
  );
  assert.equal(diagnostics.providerBuilds, 1);
  assert.equal(diagnostics.slowFallbacks, 0);
  assert.equal(diagnostics.blockHashFallbacks, 0);
  assert.equal(diagnostics.sameTxFallbacks, 0);
  assert.equal(diagnostics.sameTxAdjustments, 4);
  assert.equal(diagnostics.prefixLookups, 1_008);
  assert.ok(
    diagnostics.cursorResets <= 3,
    "canonical lookups must reset only when the requested position regresses",
  );
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
