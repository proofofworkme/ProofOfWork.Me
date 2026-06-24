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
const WORK_TRANSFER_REGRESSION_TXID =
  "7e9e711564be12330793b3415a032eca42bb742499fbdb8a6b8be6d6f1867354";
const WORK_TRANSFER_REGRESSION_RECIPIENT =
  "1MexjWyzCEwRW9R3Unnw6p6PPWWKdY3Wc2";
const OTC_WORK_TRANSFER_REGRESSION_TXID =
  "accaa6797578aadb1c9cced97fad154629324b1a41fc3fc60dabaf8701ab161b";
const OTC_WORK_TRANSFER_REGRESSION_RECIPIENT =
  "bc1qgzxhgj4y3xkm5zgtdkxw3whq0xek0g22rhu7q3";
const WORK_SEAL_REGRESSION_TXID =
  "0cdd580f47ffb1e53d2667121f10f99784e7750a60403787bf09fac512fb0b3d";
const WORK_SEAL_REGRESSION_LISTING_TXID =
  "d976f2abdfd60eca041cb7a64450f0c9de06761978cd28b5d2fcae1605457148";
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
];
const INFINITY_BOND_REGRESSION_TXID =
  "411ff4ac6aeeb638abdc387b37734c384481bcce7dd01e28b827d02dc4968891";
const PAGINATION_GAP_INFINITY_BOND_TXID =
  "b4b17f84853ce5c9f6dbad7fe3cce0d61ac4cb92d92f7ea6d9d8c38256631f34";
const OTC_SELF_BOND_TXID =
  "64dcddd3bc035ad57e021f302f021fac5c135c20dcfeffb487ba6b23317d155e";
const OTC_SELF_BOND_ADDRESS =
  "1BPVvi1GK4QkfqFMU4jHGjsQjyGwjJJJ7x";
const HISTORY_AUDIT_PAGE_LIMIT = 200;
const HISTORY_AUDIT_MAX_PAGES = 10;
const MIN_INFINITY_BOND_FLOW_SATS = 47_234_999;
const GROWTH_VALUE_MULTIPLE = 5;
const failures = [];

function endpoint(path) {
  const separator = path.includes("?") ? "&" : "?";
  return `${API_BASE}${path}${separator}network=${encodeURIComponent(NETWORK)}`;
}

async function readJson(path) {
  const response = await fetch(endpoint(path));
  if (!response.ok) {
    throw new Error(`${path} returned HTTP ${response.status}`);
  }
  return response.json();
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
  workFloor,
  workSummary,
  marketplaceSummary,
  growthSummary,
  btcUsdPrice,
  txLog,
  workTransferLog,
  otcWorkTransferLog,
  workSealLog,
  workTransferHistory,
  otcWorkTransferHistory,
  otcWorkTransferRecipientHistory,
  workTransferInvalidHistory,
  workSealListingHistory,
  workSealMarketLogHistory,
  workSealInvalidHistory,
  workDelistedActiveListingHistory,
  workDelistedClosedListingHistory,
  workDelistedListingMarketLog,
  infinityBondLog,
  paginationGapInfinityBondLog,
  otcSelfBondLog,
  otcSelfBondEventHistory,
] =
  await Promise.all([
    readJson("/api/v1/consistency"),
    readJson("/api/v1/work-floor"),
    readJson("/api/v1/work-summary"),
    readJson("/api/v1/marketplace-summary"),
    readJson("/api/v1/growth-summary"),
    readJson("/api/v1/prices/btc-usd?fresh=1"),
    readJson(`/api/v1/log-history?q=${GULLISH_TXID}`),
    readJson(`/api/v1/log-history?q=${WORK_TRANSFER_REGRESSION_TXID}`),
    readJson(`/api/v1/log-history?q=${OTC_WORK_TRANSFER_REGRESSION_TXID}`),
    readJson(`/api/v1/log-history?q=${WORK_SEAL_REGRESSION_TXID}`),
    readJson(
      `/api/v1/token-history?asset=${WORK_TOKEN_ID}&kind=transfers&q=${WORK_TRANSFER_REGRESSION_TXID}&fresh=1`,
    ),
    readJson(
      `/api/v1/token-history?asset=${WORK_TOKEN_ID}&kind=transfers&q=${OTC_WORK_TRANSFER_REGRESSION_TXID}&fresh=1`,
    ),
    readJson(
      `/api/v1/token-history?asset=${WORK_TOKEN_ID}&kind=transfers&q=${OTC_WORK_TRANSFER_REGRESSION_RECIPIENT}&fresh=1`,
    ),
    readJson(
      `/api/v1/token-history?asset=${WORK_TOKEN_ID}&kind=invalid-events&q=${WORK_TRANSFER_REGRESSION_TXID}&fresh=1`,
    ),
    readJson(
      `/api/v1/token-history?asset=${WORK_TOKEN_ID}&kind=listings&q=${WORK_SEAL_REGRESSION_LISTING_TXID}&fresh=1`,
    ),
    readJson(
      `/api/v1/token-history?asset=${WORK_TOKEN_ID}&kind=market-log&q=${WORK_SEAL_REGRESSION_TXID}&fresh=1`,
    ),
    readJson(
      `/api/v1/token-history?asset=${WORK_TOKEN_ID}&kind=invalid-events&q=${WORK_SEAL_REGRESSION_TXID}&fresh=1`,
    ),
    readJson(
      `/api/v1/token-history?asset=${WORK_TOKEN_ID}&kind=listings&q=${WORK_DELIST_REGRESSION_LISTING_TXID}&fresh=1`,
    ),
    readJson(
      `/api/v1/token-history?asset=${WORK_TOKEN_ID}&kind=closed-listings&q=${WORK_DELIST_REGRESSION_TXID}&fresh=1`,
    ),
    readJson(
      `/api/v1/token-history?asset=${WORK_TOKEN_ID}&kind=market-log&q=${WORK_DELIST_REGRESSION_TXID}&fresh=1`,
    ),
    readJson(`/api/v1/log-history?q=${INFINITY_BOND_REGRESSION_TXID}`),
    readJson(`/api/v1/log-history?q=${PAGINATION_GAP_INFINITY_BOND_TXID}`),
    readJson(`/api/v1/log-history?kind=infinity-bond&q=${OTC_SELF_BOND_TXID}`),
    readJson(
      `/api/v1/event-history?kind=infinity-bond&address=${OTC_SELF_BOND_ADDRESS}`,
    ),
  ]);

const buyerLogItems = await readHistoryUntil(
  `/api/v1/log-history?q=${GULLISH_BUYER}`,
  isGullishBuyerTokenSale,
);
const workBuyRecoveryAudits = await Promise.all(
  WORK_BUY_RECOVERY_REGRESSIONS.map(async (regression) => {
    const [sales, invalid, marketLog, tokenSaleLog] = await Promise.all([
      readJson(
        `/api/v1/token-history?asset=${WORK_TOKEN_ID}&kind=sales&q=${regression.txid}&fresh=1`,
      ),
      readJson(
        `/api/v1/token-history?asset=${WORK_TOKEN_ID}&kind=invalid-events&q=${regression.txid}&fresh=1`,
      ),
      readJson(
        `/api/v1/token-history?asset=${WORK_TOKEN_ID}&kind=market-log&q=${regression.txid}&fresh=1`,
      ),
      readJson(`/api/v1/log-history?kind=token-sale&q=${regression.txid}`),
    ]);
    return {
      invalid,
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
  "WORK and Growth share snapshot id",
  workFloor.snapshotId && workFloor.snapshotId === growthSummary.snapshotId,
);
expect(
  "consistency and WORK share snapshot id",
  consistency.snapshotId && consistency.snapshotId === workFloor.snapshotId,
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
const workSummaryFloor = workSummary.floor ?? {};
const marketplaceSummaryWorkFloor = marketplaceSummary.workFloor ?? {};
const workSummaryBtcUsd = numberValue(workSummaryFloor.btcUsd);
const marketplaceSummaryBtcUsd = numberValue(marketplaceSummaryWorkFloor.btcUsd);
expect("WORK exposes live BTC/USD metadata", liveBtcUsd > 0);
expect(
  "WORK BTC/USD metadata matches price endpoint",
  btcUsdQuotesClose(liveBtcUsd, priceEndpointBtcUsd),
);
expect(
  "WORK summary floor shares WORK floor value",
  numbersAgree(workSummaryFloor.networkValueSats, workFloor.networkValueSats),
);
expect(
  "WORK summary floor BTC/USD metadata matches price endpoint",
  btcUsdQuotesClose(workSummaryBtcUsd, priceEndpointBtcUsd),
);
expect(
  "Marketplace summary WORK floor BTC/USD metadata matches price endpoint",
  btcUsdQuotesClose(marketplaceSummaryBtcUsd, priceEndpointBtcUsd),
);
expect(
  "WORK total USD uses live BTC/USD",
  usdNumbersAgree(
    workFloor.actualValue?.totalUsd,
    satsToUsd(workFloor.actualValue?.totalSats, liveBtcUsd),
  ),
);
expect(
  "WORK summary floor total USD uses live BTC/USD",
  usdNumbersAgree(
    workSummaryFloor.actualValue?.totalUsd,
    satsToUsd(
      workSummaryFloor.actualValue?.totalSats ?? workSummaryFloor.networkValueSats,
      workSummaryBtcUsd,
    ),
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
    satsToUsd(growthSummary.actualValue?.totalSats, liveBtcUsd),
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
expect(
  "consistency guards marketplace mutation fee accounting",
  consistencyChecks.has("marketplace-mutation-fees-counted") &&
    consistencyChecks.has("marketplace-value-includes-mutation-fees") &&
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
  "known OTC self-send Infinity Bond tx is searchable in Event history",
  items(otcSelfBondEventHistory).some(
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
for (const {
  invalid,
  marketLog,
  regression,
  sales,
  tokenSaleLog,
} of workBuyRecoveryAudits) {
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
  expect(
    `confirmed WORK buy ${regression.txid} is not classified invalid`,
    items(invalid).length === 0,
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
  "confirmed WORK transfer tx is not classified invalid",
  items(workTransferInvalidHistory).length === 0,
);
expect(
  "confirmed WORK seal is attached to its listing",
  items(workSealListingHistory).some(
    (item) =>
      item.listingId === WORK_SEAL_REGRESSION_LISTING_TXID &&
      item.sealTxid === WORK_SEAL_REGRESSION_TXID &&
      item.sealConfirmed === true,
  ),
);
expect(
  "confirmed WORK seal tx is searchable in market log",
  items(workSealMarketLogHistory).some(
    (item) =>
      item.txid === WORK_SEAL_REGRESSION_LISTING_TXID &&
      item.listing?.sealTxid === WORK_SEAL_REGRESSION_TXID,
  ),
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
  "confirmed WORK seal tx is not classified invalid",
  items(workSealInvalidHistory).length === 0,
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
