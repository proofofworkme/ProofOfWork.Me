const DEFAULT_API_BASE = "https://work.proofofwork.me";
const NETWORK = process.env.NETWORK ?? "livenet";
const API_BASE = String(process.env.POW_API_BASE ?? DEFAULT_API_BASE).replace(
  /\/+$/u,
  "",
);
const GULLISH_TXID =
  "cf6aacd51b3bb755620d9bd84e88b4e94e2a12bce74812734ba9013ae9d488aa";
const GULLISH_BUYER =
  "bc1p0e5qs2vcu6c50t6xwxuk7yfnqpwtm03rclv7wzgxzk37849xt8fssl6zvd";
const WORK_TOKEN_ID =
  "d4e5ebf11d104d6a63fb74e42094364b25a5f7199a09e5c0e71408972466a8b8";
const POWB_TOKEN_ID =
  "a3d0bc8528f91dfc52400a885bed7e49235396aa82aa9f95db41be629f1d5562";
const MAX_LEDGER_TIP_LAG_BLOCKS = Number(
  process.env.MAX_LEDGER_TIP_LAG_BLOCKS ?? 6,
);
const WORK_TRANSFER_REGRESSION_TXID =
  "7e9e711564be12330793b3415a032eca42bb742499fbdb8a6b8be6d6f1867354";
const WORK_TRANSFER_REGRESSION_RECIPIENT =
  "1MexjWyzCEwRW9R3Unnw6p6PPWWKdY3Wc2";
const OTC_WORK_TRANSFER_REGRESSION_TXID =
  "accaa6797578aadb1c9cced97fad154629324b1a41fc3fc60dabaf8701ab161b";
const OTC_WORK_TRANSFER_REGRESSION_RECIPIENT =
  "bc1qgzxhgj4y3xkm5zgtdkxw3whq0xek0g22rhu7q3";
const WORK_SEAL_REGRESSION_TXID =
  "e365ada0deb8a7bf8f8c4c012897633e4f00938e7f0ca85999de884f939cbc68";
const WORK_SEAL_REGRESSION_LISTING_TXID =
  "d0697f88d7648ac4221af34d17d3e8c55852b917f820100d9029143085b29a13";
const WORK_DELIST_REGRESSION_LISTING_TXID =
  "4e80256079c9475589f5a828079be2e403ed029bf3dcd7a9801055714ee4b2bf";
const WORK_DELIST_REGRESSION_TXID =
  "9079e81e519b2e9a2cecde1133d656afc892b7866ed72d37c2b524913ce82850";
const WORK_DELIST_REGRESSION_SELLER =
  "1BPVvi1GK4QkfqFMU4jHGjsQjyGwjJJJ7x";
const WORK_BUY_RECOVERY_REGRESSIONS = [
  {
    buyer: "bc1p0uxp0axptr8rg9dndgtlwxn00j4hq8m88kg80tqd0t6045putwhq5ca7ed",
    listingId:
      "f190c6246feae944e61ae909fc80fc39b3fe2e7536832279eb7d3c593ba889b8",
    txid: "85d7930ffd5650c8508baf1f0128d469592e8349ad51483f69f3e227aca9233b",
  },
  {
    buyer: "1KhLgiejzFDxzM3AsmXXHCisH3VA7zcSUW",
    listingId:
      "4cde906f5e0692e05c6c1bfcfb8d49fccfce9bdb564d88b358aa50d418e163c6",
    txid: "8b470b3ab319c201d4eb440bb3562b7b907b7ca38480ff71b51c6b655e522e97",
  },
  {
    buyer: "1BPVvi1GK4QkfqFMU4jHGjsQjyGwjJJJ7x",
    listingId:
      "67730b089c8fce6f287968fc5c028df8b2ff72ce84b1b3dbda014fb6b9807933",
    txid: "50086fb6c14bcbfc818b87415191378188a1bb1e3781d17d0875d81fef91301f",
  },
];
const INFINITY_BOND_REGRESSION_TXID =
  "411ff4ac6aeeb638abdc387b37734c384481bcce7dd01e28b827d02dc4968891";
const PAGINATION_GAP_INFINITY_BOND_TXID =
  "b4b17f84853ce5c9f6dbad7fe3cce0d61ac4cb92d92f7ea6d9d8c38256631f34";
const OTC_SELF_BOND_TXID =
  "64dcddd3bc035ad57e021f302f021fac5c135c20dcfeffb487ba6b23317d155e";
const OTC_SELF_BOND_ADDRESS =
  "1BPVvi1GK4QkfqFMU4jHGjsQjyGwjJJJ7x";
const REPORTED_POWB_LISTING_TXID =
  "dcac1665798675b7817a973fa990283bc9de2c77cc374361e8cb956a5f2daa46";
const HISTORY_AUDIT_PAGE_LIMIT = 200;
const HISTORY_AUDIT_MAX_PAGES = 10;
const AUDIT_REQUEST_TIMEOUT_MS = Number(
  process.env.AUDIT_REQUEST_TIMEOUT_MS ?? 45_000,
);
const MIN_INFINITY_BOND_FLOW_SATS = 47_234_999;
const GROWTH_VALUE_MULTIPLE = 5;
const failures = [];

function endpoint(path) {
  const separator = path.includes("?") ? "&" : "?";
  return `${API_BASE}${path}${separator}network=${encodeURIComponent(NETWORK)}`;
}

async function readJson(path) {
  const controller = new AbortController();
  const timeout = setTimeout(
    () => controller.abort(),
    AUDIT_REQUEST_TIMEOUT_MS,
  );
  let response;
  try {
    response = await fetch(endpoint(path), { signal: controller.signal });
  } catch (error) {
    if (error?.name === "AbortError") {
      throw new Error(`${path} timed out after ${AUDIT_REQUEST_TIMEOUT_MS}ms`);
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
  if (!response.ok) {
    throw new Error(`${path} returned HTTP ${response.status}`);
  }
  return response.json();
}

async function readJsonPaths(paths) {
  const payloads = [];
  for (const path of paths) {
    payloads.push(await readJson(path));
  }
  return payloads;
}

function appendQuery(path, params) {
  const entries = Object.entries(params).filter(
    ([, value]) => value !== undefined && value !== "",
  );
  if (!entries.length) {
    return path;
  }
  const separator = path.includes("?") ? "&" : "?";
  return `${path}${separator}${new URLSearchParams(entries)}`;
}

function expect(name, condition) {
  if (!condition) {
    failures.push(name);
  }
}

function numberValue(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}

function numbersAgree(left, right) {
  return Math.abs(numberValue(left) - numberValue(right)) <= 0.000001;
}

function usdNumbersAgree(left, right) {
  return Math.abs(numberValue(left) - numberValue(right)) <= 0.01;
}

function satsToUsd(sats, btcUsd) {
  return (numberValue(sats) / 100_000_000) * numberValue(btcUsd);
}

function btcUsdQuotesClose(left, right) {
  const leftNumber = numberValue(left);
  const rightNumber = numberValue(right);
  if (leftNumber <= 0 || rightNumber <= 0) {
    return false;
  }
  return Math.abs(leftNumber - rightNumber) / rightNumber <= 0.01;
}

function items(payload) {
  return Array.isArray(payload?.items) ? payload.items : [];
}

function workSealAttachedToListing(item) {
  const listing = item?.listing ?? item;
  const saleAuthorization = listing?.saleAuthorization ?? {};
  const anchorSignature = String(saleAuthorization.anchorSignature ?? "").trim();
  const sealTxid = listing?.sealTxid ?? saleAuthorization.sealTxid ?? null;
  return (
    listing?.listingId === WORK_SEAL_REGRESSION_LISTING_TXID &&
    (sealTxid === WORK_SEAL_REGRESSION_TXID ||
      (saleAuthorization.anchorTxid === WORK_SEAL_REGRESSION_LISTING_TXID &&
        anchorSignature.length > 0)) &&
    (listing?.sealConfirmed === true || sealTxid === WORK_SEAL_REGRESSION_TXID || anchorSignature.length > 0)
  );
}

function isReportedPowbListing(item) {
  const listing = item?.listing ?? item;
  return (
    (item?.txid === REPORTED_POWB_LISTING_TXID ||
      listing?.listingId === REPORTED_POWB_LISTING_TXID) &&
    (item?.tokenId === POWB_TOKEN_ID || listing?.tokenId === POWB_TOKEN_ID)
  );
}

async function readHistoryUntil(path, predicate) {
  const collected = [];
  let cursor = "";

  for (let page = 0; page < HISTORY_AUDIT_MAX_PAGES; page += 1) {
    const payload = await readJson(
      appendQuery(path, {
        cursor,
        limit: String(HISTORY_AUDIT_PAGE_LIMIT),
      }),
    );
    const pageItems = items(payload);
    collected.push(...pageItems);
    if (pageItems.some(predicate)) {
      return collected;
    }
    cursor = String(payload?.nextCursor ?? "");
    if (!cursor) {
      break;
    }
  }

  return collected;
}

function checkNames(payload) {
  return new Set((payload?.checks ?? []).map((check) => check?.name));
}

function isGullishBuyerTokenSale(item) {
  return (
    item.kind === "token-sale" &&
    item.txid === GULLISH_TXID &&
    Array.isArray(item.participants) &&
    item.participants.includes(GULLISH_BUYER)
  );
}

const [
  consistency,
  health,
  workFloor,
  marketplaceSummary,
  infinitySummary,
  powbTokenState,
  growthSummary,
  btcUsdPrice,
  txLog,
  workTransferLog,
  otcWorkTransferLog,
  workSealLog,
  workTransferHistory,
  otcWorkTransferHistory,
  otcWorkTransferRecipientHistory,
  workSealListingHistory,
  workSealMarketLogHistory,
  workDelistedActiveListingHistory,
  workDelistedClosedListingHistory,
  workDelistedListingMarketLog,
  infinityBondLog,
  paginationGapInfinityBondLog,
  otcSelfBondLog,
  reportedPowbListingStatus,
  reportedPowbListingMarketLog,
  reportedPowbListings,
  reportedPowbTokenState,
] =
  await readJsonPaths([
    "/api/v1/consistency",
    "/health",
    "/api/v1/work-floor",
    "/api/v1/marketplace-summary",
    "/api/v1/infinity-summary",
    `/api/v1/token?asset=${POWB_TOKEN_ID}`,
    "/api/v1/growth-summary",
    "/api/v1/prices/btc-usd?fresh=1",
    `/api/v1/log-history?q=${GULLISH_TXID}`,
    `/api/v1/log-history?q=${WORK_TRANSFER_REGRESSION_TXID}`,
    `/api/v1/log-history?q=${OTC_WORK_TRANSFER_REGRESSION_TXID}`,
    `/api/v1/log-history?q=${WORK_SEAL_REGRESSION_TXID}`,
    `/api/v1/token-history?asset=${WORK_TOKEN_ID}&kind=transfers&q=${WORK_TRANSFER_REGRESSION_TXID}&fresh=1`,
    `/api/v1/token-history?asset=${WORK_TOKEN_ID}&kind=transfers&q=${OTC_WORK_TRANSFER_REGRESSION_TXID}&fresh=1`,
    `/api/v1/token-history?asset=${WORK_TOKEN_ID}&kind=transfers&q=${OTC_WORK_TRANSFER_REGRESSION_RECIPIENT}&fresh=1`,
    `/api/v1/token-history?asset=${WORK_TOKEN_ID}&kind=listings&q=${WORK_SEAL_REGRESSION_LISTING_TXID}&fresh=1`,
    `/api/v1/token-history?asset=${WORK_TOKEN_ID}&kind=market-log&q=${WORK_SEAL_REGRESSION_TXID}&fresh=1`,
    `/api/v1/token-history?asset=${WORK_TOKEN_ID}&kind=listings&q=${WORK_DELIST_REGRESSION_LISTING_TXID}&fresh=1`,
    `/api/v1/token-history?asset=${WORK_TOKEN_ID}&kind=closed-listings&q=${WORK_DELIST_REGRESSION_TXID}&fresh=1`,
    `/api/v1/token-history?asset=${WORK_TOKEN_ID}&kind=market-log&q=${WORK_DELIST_REGRESSION_TXID}&fresh=1`,
    `/api/v1/log-history?q=${INFINITY_BOND_REGRESSION_TXID}`,
    `/api/v1/log-history?q=${PAGINATION_GAP_INFINITY_BOND_TXID}`,
    `/api/v1/log-history?q=${OTC_SELF_BOND_TXID}`,
    `/api/v1/tx/${REPORTED_POWB_LISTING_TXID}/status`,
    `/api/v1/token-history?asset=${POWB_TOKEN_ID}&kind=market-log&q=${REPORTED_POWB_LISTING_TXID}&fresh=1`,
    `/api/v1/token-history?asset=${POWB_TOKEN_ID}&kind=listings&q=${REPORTED_POWB_LISTING_TXID}&fresh=1`,
    `/api/v1/token?asset=${POWB_TOKEN_ID}`,
  ]);

const buyerLogItems = items(txLog);
const workBuyRecoveryAudits = await Promise.all(
  WORK_BUY_RECOVERY_REGRESSIONS.map(async (regression) => {
    const [sales, marketLog, tokenSaleLog] = await Promise.all([
      readJson(
        `/api/v1/token-history?asset=${WORK_TOKEN_ID}&kind=sales&q=${regression.txid}&fresh=1`,
      ),
      readJson(
        `/api/v1/token-history?asset=${WORK_TOKEN_ID}&kind=market-log&q=${regression.txid}&fresh=1`,
      ),
      readJson(`/api/v1/log-history?kind=token-sale&q=${regression.txid}`),
    ]);
    return {
      marketLog,
      regression,
      sales,
      tokenSaleLog,
    };
  }),
);

expect("consistency endpoint is green", consistency.ok === true);
const consistencyChecks = checkNames(consistency);
expect(
  "consistency guards seeded mail coverage",
  consistencyChecks.has("seeded-mail-events-logged") &&
    consistencyChecks.has("seeded-infinity-bonds-logged"),
);
expect(
  "consistency guards ledger node-tip coverage",
  consistencyChecks.has("ledger-covers-node-tip"),
);
const healthTipHeight = numberValue(health.tipHeight);
const consistencyIndexedThroughBlock = numberValue(
  consistency.indexedThroughBlock ?? consistency.metrics?.indexedThroughBlock,
);
expect(
  "ledger snapshot is current with node tip",
  healthTipHeight <= 0 ||
    (consistencyIndexedThroughBlock > 0 &&
      healthTipHeight - consistencyIndexedThroughBlock <=
        MAX_LEDGER_TIP_LAG_BLOCKS),
);
expect(
  "WORK and Growth share snapshot id",
  (workFloor.snapshotId && workFloor.snapshotId === growthSummary.snapshotId) ||
    (numbersAgree(workFloor.networkValueSats, growthSummary.actualValue?.totalSats) &&
      numberValue(workFloor.indexedThroughBlock) > 0 &&
      numberValue(workFloor.indexedThroughBlock) ===
        numberValue(growthSummary.indexedThroughBlock)),
);
expect(
  "consistency and WORK share snapshot id",
  (consistency.snapshotId && consistency.snapshotId === workFloor.snapshotId) ||
    (numbersAgree(
      workFloor.networkValueSats,
      consistency.checks?.find((check) => check?.name === "network-values-finite")
        ?.details?.workNetworkValueSats,
    ) &&
      numberValue(workFloor.indexedThroughBlock) > 0 &&
      consistencyIndexedThroughBlock - numberValue(workFloor.indexedThroughBlock) <=
        MAX_LEDGER_TIP_LAG_BLOCKS),
);
expect(
  "WORK network value equals WORK actual value",
  numbersAgree(workFloor.networkValueSats, workFloor.actualValue?.totalSats),
);
expect(
  "WORK network value equals Growth actual value",
  numbersAgree(workFloor.networkValueSats, growthSummary.actualValue?.totalSats),
);
expect(
  "WORK network value equals Growth workFloor value",
  numbersAgree(workFloor.networkValueSats, growthSummary.workFloor?.networkValueSats),
);
const liveBtcUsd = numberValue(workFloor.btcUsd);
const priceEndpointBtcUsd = numberValue(btcUsdPrice.usd ?? btcUsdPrice.USD);
const marketplaceSummaryWorkFloor = marketplaceSummary.workFloor ?? {};
const marketplaceSummaryBtcUsd = numberValue(marketplaceSummaryWorkFloor.btcUsd);
const growthSummaryBtcUsd = numberValue(growthSummary.btcUsd);
const powbConfirmedMints = Array.isArray(powbTokenState.mints)
  ? powbTokenState.mints.filter((mint) => mint?.confirmed).length
  : numberValue(powbTokenState.stats?.confirmedMints);
const powbPendingMints = Array.isArray(powbTokenState.mints)
  ? powbTokenState.mints.filter((mint) => !mint?.confirmed).length
  : numberValue(powbTokenState.stats?.pendingMints);
const powbHolders = Array.isArray(powbTokenState.holders)
  ? powbTokenState.holders.length
  : numberValue(powbTokenState.stats?.holders);
const infinitySummaryBtcUsd = numberValue(infinitySummary.btcUsd);
expect("WORK exposes live BTC/USD metadata", liveBtcUsd > 0);
expect(
  "WORK BTC/USD metadata matches price endpoint",
  btcUsdQuotesClose(liveBtcUsd, priceEndpointBtcUsd),
);
expect(
  "Marketplace summary WORK floor shares WORK floor value",
  numbersAgree(
    marketplaceSummaryWorkFloor.networkValueSats,
    workFloor.networkValueSats,
  ),
);
expect(
  "Marketplace summary WORK floor BTC/USD metadata matches price endpoint",
  btcUsdQuotesClose(marketplaceSummaryBtcUsd, priceEndpointBtcUsd),
);
expect(
  "Infinity summary BTC/USD metadata matches price endpoint",
  btcUsdQuotesClose(infinitySummaryBtcUsd, priceEndpointBtcUsd),
);
expect(
  "Growth BTC/USD metadata matches price endpoint",
  btcUsdQuotesClose(growthSummaryBtcUsd, priceEndpointBtcUsd),
);
expect(
  "WORK total USD uses live BTC/USD",
  usdNumbersAgree(
    workFloor.actualValue?.totalUsd,
    satsToUsd(workFloor.actualValue?.totalSats, liveBtcUsd),
  ),
);
expect(
  "Marketplace summary WORK floor total USD uses live BTC/USD",
  usdNumbersAgree(
    marketplaceSummaryWorkFloor.actualValue?.totalUsd,
    satsToUsd(
      marketplaceSummaryWorkFloor.actualValue?.totalSats ??
        marketplaceSummaryWorkFloor.networkValueSats,
      marketplaceSummaryBtcUsd,
    ),
  ),
);
expect(
  "Growth total USD uses live BTC/USD",
  usdNumbersAgree(
    growthSummary.actualValue?.totalUsd,
    satsToUsd(growthSummary.actualValue?.totalSats, growthSummaryBtcUsd),
  ),
);
expect(
  "Infinity summary confirmed supply matches POWB token state",
  numbersAgree(
    infinitySummary.stats?.confirmedSupply,
    powbTokenState.confirmedSupply,
  ),
);
expect(
  "Infinity summary pending supply matches POWB token state",
  numbersAgree(infinitySummary.stats?.pendingSupply, powbTokenState.pendingSupply),
);
expect(
  "Infinity summary confirmed bond count matches POWB mints",
  numbersAgree(infinitySummary.stats?.confirmedBondActions, powbConfirmedMints),
);
expect(
  "Infinity summary pending bond count matches POWB mints",
  numbersAgree(infinitySummary.stats?.pendingBondActions, powbPendingMints),
);
expect(
  "Infinity summary holder count matches POWB token state",
  numbersAgree(infinitySummary.stats?.holders, powbHolders),
);
expect(
  "Infinity total USD uses live BTC/USD",
  usdNumbersAgree(
    infinitySummary.actualValue?.totalUsd,
    satsToUsd(infinitySummary.actualValue?.totalSats, infinitySummaryBtcUsd),
  ),
);
expect(
  "reported POWB listing tx is confirmed",
  reportedPowbListingStatus.confirmed === true ||
    reportedPowbListingStatus.status === "confirmed",
);
expect(
  "reported POWB listing is visible in market log",
  items(reportedPowbListingMarketLog).some(isReportedPowbListing),
);
expect(
  "reported POWB listing is visible in POWB listings",
  items(reportedPowbListings).some(
    (listing) =>
      listing.listingId === REPORTED_POWB_LISTING_TXID &&
      listing.tokenId === POWB_TOKEN_ID &&
      listing.confirmed === true,
  ),
);
expect(
  "reported POWB listing is visible in token state",
  Array.isArray(reportedPowbTokenState.listings) &&
    reportedPowbTokenState.listings.some(
      (listing) =>
        listing.listingId === REPORTED_POWB_LISTING_TXID &&
        listing.tokenId === POWB_TOKEN_ID &&
        listing.confirmed === true,
    ),
);
expect(
  "reported POWB listing is visible in Infinity summary token state",
  Array.isArray(infinitySummary.token?.listings) &&
    infinitySummary.token.listings.some(
      (listing) =>
        listing.listingId === REPORTED_POWB_LISTING_TXID &&
        listing.tokenId === POWB_TOKEN_ID &&
        listing.confirmed === true,
    ),
);
const actualValue = workFloor.actualValue ?? {};
const marketplaceFeeSats = numberValue(actualValue.marketplaceFeeSats);
const marketplaceMutationFeeSats = numberValue(
  actualValue.marketplaceMutationFeeSats,
);
const marketplaceSaleVolumeSats = numberValue(
  actualValue.marketplaceSaleVolumeSats ?? actualValue.marketplaceVolumeSats,
);
const marketplaceFlowSats = numberValue(actualValue.marketplaceFlowSats);
const marketplaceSats = numberValue(actualValue.marketplaceSats);
const creditMovementFrozenValueSats = numberValue(
  actualValue.creditMovementFrozenValueSats,
);
const creditProofPaymentFlowSats = numberValue(
  actualValue.creditProofPaymentFlowSats,
);
const creditRegistryMutationFlowSats = numberValue(
  actualValue.creditRegistryMutationFlowSats,
);
const creditMarketplaceMutationFlowSats = numberValue(
  actualValue.creditMarketplaceMutationFlowSats,
);
const creditSalePaymentFlowSats = numberValue(
  actualValue.creditSalePaymentFlowSats,
);
const creditMinerFeeFlowSats = numberValue(actualValue.creditMinerFeeFlowSats);
const creditNetworkValueSats = numberValue(actualValue.creditNetworkValueSats);
const creditEventFrozenValueSats = numberValue(
  actualValue.creditEventFrozenValueSats ??
    actualValue.creditFrozenNetworkValueSats,
);
const creditEventLiveValueSats = numberValue(
  actualValue.creditEventLiveValueSats ??
    actualValue.creditLiveNetworkValueSats,
);
const creditLiveNetworkValueSats = numberValue(
  actualValue.creditLiveNetworkValueSats ?? creditEventLiveValueSats,
);
expect(
  "consistency guards marketplace mutation fee accounting",
  consistencyChecks.has("marketplace-mutation-fees-counted") &&
    consistencyChecks.has("marketplace-value-includes-mutation-fees") &&
    consistencyChecks.has("credit-frozen-value-includes-event-components") &&
    consistencyChecks.has("credit-live-value-is-active-network-value") &&
    consistencyChecks.has("computer-event-flow-excludes-marketplace"),
);
expect(
  "marketplace mutation fee aliases agree",
  numbersAgree(marketplaceFeeSats, marketplaceMutationFeeSats),
);
expect(
  "marketplace flow includes sale volume and mutation fees",
  numbersAgree(
    marketplaceFlowSats,
    marketplaceSaleVolumeSats + marketplaceMutationFeeSats,
  ),
);
expect(
  "marketplace network value includes mutation fees",
  numbersAgree(
    marketplaceSats,
    marketplaceFlowSats * GROWTH_VALUE_MULTIPLE,
  ),
);
expect(
  "credit frozen value includes event components",
  numbersAgree(
    creditEventFrozenValueSats,
    creditMovementFrozenValueSats +
      creditProofPaymentFlowSats +
      creditRegistryMutationFlowSats +
      creditMarketplaceMutationFlowSats +
      creditSalePaymentFlowSats +
      creditMinerFeeFlowSats,
  ),
);
expect(
  "credit live value is the active network value",
  numbersAgree(creditNetworkValueSats, creditLiveNetworkValueSats) &&
    numbersAgree(creditNetworkValueSats, creditEventLiveValueSats),
);
expect(
  "Infinity Bond confirmed flow is fully indexed",
  numberValue(workFloor.actualValue?.infinityBondFlowSats) >=
    MIN_INFINITY_BOND_FLOW_SATS,
);
expect(
  "known seeded Infinity Bond tx is searchable in Log",
  items(infinityBondLog).some(
    (item) =>
      item.kind === "infinity-bond" &&
      item.txid === INFINITY_BOND_REGRESSION_TXID &&
      item.amountSats >= 950_000,
  ),
);
expect(
  "known paginated-address Infinity Bond tx is searchable in Log",
  items(paginationGapInfinityBondLog).some(
    (item) =>
      item.kind === "infinity-bond" &&
      item.txid === PAGINATION_GAP_INFINITY_BOND_TXID &&
      item.amountSats >= 1_000_000,
  ),
);
expect(
  "known OTC self-send Infinity Bond tx is searchable in Log",
  items(otcSelfBondLog).some(
    (item) =>
      item.kind === "infinity-bond" &&
      item.txid === OTC_SELF_BOND_TXID &&
      item.amountSats >= 50_000,
  ),
);
expect(
  "known OTC self-send Infinity Bond tx preserves address participant",
  items(otcSelfBondLog).some(
    (item) =>
      item.kind === "infinity-bond" &&
      item.txid === OTC_SELF_BOND_TXID &&
      item.amountSats >= 50_000 &&
      Array.isArray(item.participants) &&
      item.participants.includes(OTC_SELF_BOND_ADDRESS),
  ),
);
expect(
  "Gullish txid search returns token sale",
  items(txLog).some(
    (item) =>
      item.kind === "token-sale" &&
      item.txid === GULLISH_TXID &&
      item.tokenId ===
        "d4e5ebf11d104d6a63fb74e42094364b25a5f7199a09e5c0e71408972466a8b8",
  ),
);
expect(
  "Gullish txid search returns token listing closure",
  items(txLog).some(
    (item) => item.kind === "token-listing-closed" && item.txid === GULLISH_TXID,
  ),
);
expect(
  "Gullish buyer address search returns sale participant event",
  buyerLogItems.some(isGullishBuyerTokenSale),
);
for (const { marketLog, regression, sales, tokenSaleLog } of workBuyRecoveryAudits) {
  expect(
    `confirmed WORK buy ${regression.txid} is in sales history`,
    items(sales).some(
      (item) =>
        item.txid === regression.txid &&
        item.listingId === regression.listingId &&
        item.buyerAddress === regression.buyer &&
        item.confirmed === true,
    ),
  );
  expect(
    `confirmed WORK buy ${regression.txid} is in market log as a sale`,
    items(marketLog).some(
      (item) =>
        item.kind === "sale" &&
        item.txid === regression.txid &&
        item.sale?.listingId === regression.listingId,
    ),
  );
  expect(
    `confirmed WORK buy ${regression.txid} is in Log as a token sale`,
    items(tokenSaleLog).some(
      (item) =>
        item.kind === "token-sale" &&
        item.txid === regression.txid &&
        item.listingId === regression.listingId &&
        Array.isArray(item.participants) &&
        item.participants.includes(regression.buyer),
    ),
  );
}
expect(
  "confirmed WORK transfer tx is in transfer history",
  items(workTransferHistory).some(
    (item) =>
      item.txid === WORK_TRANSFER_REGRESSION_TXID &&
      item.confirmed === true &&
      item.amount === 101_000 &&
      item.recipientAddress === WORK_TRANSFER_REGRESSION_RECIPIENT,
  ),
);
expect(
  "confirmed WORK transfer tx is searchable in Log",
  items(workTransferLog).some(
    (item) =>
      item.kind === "token-transfer" &&
      item.txid === WORK_TRANSFER_REGRESSION_TXID &&
      item.tokenId === WORK_TOKEN_ID &&
      Array.isArray(item.participants) &&
      item.participants.includes(WORK_TRANSFER_REGRESSION_RECIPIENT),
  ),
);
expect(
  "confirmed OTC WORK transfer tx is in transfer history",
  items(otcWorkTransferHistory).some(
    (item) =>
      item.txid === OTC_WORK_TRANSFER_REGRESSION_TXID &&
      item.confirmed === true &&
      item.amount === 10_000 &&
      item.recipientAddress === OTC_WORK_TRANSFER_REGRESSION_RECIPIENT,
  ),
);
expect(
  "confirmed OTC WORK transfer is searchable by recipient in transfer history",
  items(otcWorkTransferRecipientHistory).some(
    (item) =>
      item.txid === OTC_WORK_TRANSFER_REGRESSION_TXID &&
      item.confirmed === true &&
      item.amount === 10_000 &&
      item.recipientAddress === OTC_WORK_TRANSFER_REGRESSION_RECIPIENT,
  ),
);
expect(
  "confirmed OTC WORK transfer tx is searchable in Log",
  items(otcWorkTransferLog).some(
    (item) =>
      item.kind === "token-transfer" &&
      item.txid === OTC_WORK_TRANSFER_REGRESSION_TXID &&
      item.tokenId === WORK_TOKEN_ID &&
      Array.isArray(item.participants) &&
      item.participants.includes(OTC_WORK_TRANSFER_REGRESSION_RECIPIENT),
  ),
);
expect(
  "confirmed WORK seal is attached to its listing",
  items(workSealListingHistory).some(workSealAttachedToListing) ||
    items(workSealMarketLogHistory).some(workSealAttachedToListing),
);
expect(
  "confirmed WORK seal tx is searchable in market log",
  items(workSealMarketLogHistory).some(workSealAttachedToListing),
);
expect(
  "confirmed WORK seal tx is searchable in Log",
  items(workSealLog).some(
    (item) =>
      item.kind === "token-listing-sealed" &&
      item.txid === WORK_SEAL_REGRESSION_TXID &&
      item.listingId === WORK_SEAL_REGRESSION_LISTING_TXID &&
      item.tokenId === WORK_TOKEN_ID,
  ),
);
expect(
  "delisted WORK listing is removed from active listing history",
  !items(workDelistedActiveListingHistory).some(
    (item) => item.listingId === WORK_DELIST_REGRESSION_LISTING_TXID,
  ),
);
expect(
  "WORK delist tx is visible in closed listing history",
  items(workDelistedClosedListingHistory).some(
    (item) =>
      item.listingId === WORK_DELIST_REGRESSION_LISTING_TXID &&
      item.closedTxid === WORK_DELIST_REGRESSION_TXID &&
      item.amount === 20_000 &&
      item.priceSats === 151_600 &&
      item.sellerAddress === WORK_DELIST_REGRESSION_SELLER,
  ),
);
expect(
  "WORK delist tx is visible in market log",
  items(workDelistedListingMarketLog).some(
    (item) =>
      item.kind === "closed-listing" &&
      item.txid === WORK_DELIST_REGRESSION_TXID &&
      item.closedListing?.listingId === WORK_DELIST_REGRESSION_LISTING_TXID &&
      item.closedListing?.sellerAddress === WORK_DELIST_REGRESSION_SELLER,
  ),
);

if (failures.length) {
  console.error(`Ledger consistency audit failed against ${API_BASE}:`);
  for (const failure of failures) {
    console.error(`- ${failure}`);
  }
  process.exit(1);
}

console.log(
  `Ledger consistency audit passed for ${API_BASE}: snapshot ${consistency.snapshotId}, value ${workFloor.networkValueSats} proofs.`,
);
