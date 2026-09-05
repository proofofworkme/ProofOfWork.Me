import { expect, test } from "@playwright/test";

const WORK_TOKEN_ID =
  "d4e5ebf11d104d6a63fb74e42094364b25a5f7199a09e5c0e71408972466a8b8";
const MISTYPED_WORK_TOKEN_ID =
  "d4e5ebf11d104d6a63fb74e42094364b2535f7199a09e5c0e71408972466a8b8";
const MALFORMED_WORK_PREFIX_ASSET = `WORK${"-".repeat(60)}`;
const MALFORMED_POWB_PREFIX_ASSET = `POWB${"-".repeat(60)}`;
const MALFORMED_INCB_PREFIX_ASSET = `INCB${"-".repeat(60)}`;
const POWB_TOKEN_ID =
  "a3d0bc8528f91dfc52400a885bed7e49235396aa82aa9f95db41be629f1d5562";
const INCB_TOKEN_ID =
  "3cb25745f937f2b4e5508e5400189fe8fe679cd8e84bfa1e9176d70c9761f15d";
const WORK_PRECISION_MODEL = "canonical-work-subatoms-v2";
const WORK_STORAGE_MODEL = "work-subatoms-v2";
const WORK_UNIT_SCALE = "10000000000000000";
const VIEWPORT_WIDTHS = [
  320,
  360,
  375,
  390,
  412,
  430,
  480,
  520,
  620,
  768,
  861,
  1024,
  1180,
  1181,
  1440,
  1800,
];
const MOBILE_VIEWPORT_WIDTHS = VIEWPORT_WIDTHS.filter((width) => width <= 620);
const VIEWPORT_HEIGHT = 900;
const NOW = "2026-07-22T12:00:00.000Z";
const HASH = "1".repeat(64);
const BOOST_FIXTURE_ITEM = {
  authorAddress: "1BPVvi1GK4QkfqFMU4jHGjsQjyGwjJJJ7x",
  authorDisplay: "Proof Fixture",
  authorId: "proof-fixture",
  confirmed: true,
  createdAt: NOW,
  currentOwnerAddress: "1BPVvi1GK4QkfqFMU4jHGjsQjyGwjJJJ7x",
  kind: "boost",
  likeCount: 0,
  proofSignalSats: 546,
  reboostCount: 0,
  replyCount: 0,
  text: "Deterministic Boost fixture for compact keyboard coverage.",
  totalSignalSats: 546,
  txid: "2".repeat(64),
};
const MARKETPLACE_BASE_URL = (
  process.env.POW_MARKETPLACE_BASE_URL ||
  process.env.POW_UI_BASE_URL ||
  ""
).replace(/\/$/u, "");
const COMPUTER_BASE_URL = (
  process.env.POW_COMPUTER_BASE_URL ||
  process.env.POW_UI_BASE_URL ||
  ""
).replace(/\/$/u, "");
const REPRESENTATIVE_ACCESSIBILITY_ROUTES = [
  { label: "Home", path: "/?landing=1", ready: ".landing-app" },
  { label: "Computer", path: "/?folder=inbox", ready: ".mail-app" },
  {
    label: "AMO",
    path: `/?marketplace=1&asset=${WORK_TOKEN_ID}`,
    ready: ".marketplace-app",
  },
  { label: "Boost", path: "/?boost=1", ready: ".boost-public-app" },
];
const REPRESENTATIVE_EMBEDDED_ROUTES = [
  {
    label: "Computer AMO",
    path: `/?folder=marketplace&asset=${WORK_TOKEN_ID}`,
    ready: ".mail-layout.is-marketplace-workspace",
  },
  {
    label: "Computer Boost",
    path: "/?folder=boost",
    ready: ".boost-post",
  },
];

function surfaceUrl(baseUrl, path) {
  return baseUrl ? `${baseUrl}${path}` : path;
}

function tokenDefinition({ ticker, tokenId, registryAddress, uncapped = false }) {
  const work = ticker === "WORK";
  return {
    ...(work
      ? {
          amountStorageModel: WORK_STORAGE_MODEL,
          confirmedSupplySubatoms: "210000000000000000000000",
          maxSupplySubatoms: "210000000000000000000000",
          mintAmountSubatoms: "10000000000000000000",
          pendingSupplySubatoms: "0",
          precisionModel: WORK_PRECISION_MODEL,
        }
      : {}),
    confirmed: true,
    confirmedMints: work ? 21_000 : 1,
    confirmedOpenListings: 0,
    confirmedSales: 0,
    confirmedSalesVolumeSats: 0,
    confirmedSupply: work ? "21000000" : "1000",
    createdAt: NOW,
    creatorAddress: "1L4xrDurN9VghknrbsSju2vQb6oXZe1Pbn",
    creationFeeSats: 1_000,
    decimals: work ? 16 : 0,
    holderCount: 1,
    maxSupply: uncapped ? null : 21_000_000,
    maxSupplyModel: uncapped ? "uncapped" : "fixed",
    mintAmount: work ? 1_000 : 1,
    mintPriceSats: 1_000,
    network: "livenet",
    openListings: 0,
    pendingMints: 0,
    pendingOpenListings: 0,
    pendingSales: 0,
    pendingSalesVolumeSats: 0,
    pendingSupply: work ? "0" : 0,
    registryAddress,
    ticker,
    tokenId,
    transferCount: 0,
    txid: tokenId,
    uncapped,
    unitScale: work ? WORK_UNIT_SCALE : "1",
  };
}

const TOKENS = [
  tokenDefinition({
    registryAddress: "1638Vn6KtmK8p5r4oGvAXq9nmZb1emU1DV",
    ticker: "WORK",
    tokenId: WORK_TOKEN_ID,
  }),
  tokenDefinition({
    registryAddress: "1L4xrDurN9VghknrbsSju2vQb6oXZe1Pbn",
    ticker: "POWB",
    tokenId: POWB_TOKEN_ID,
    uncapped: true,
  }),
  tokenDefinition({
    registryAddress: "1L4xrDurN9VghknrbsSju2vQb6oXZe1Pbn",
    ticker: "INCB",
    tokenId: INCB_TOKEN_ID,
    uncapped: true,
  }),
];

const TOKEN_STATE = {
  amountStorageModel: WORK_STORAGE_MODEL,
  authoritativeWallet: false,
  closedListings: [],
  creationSats: 3_000,
  holders: [],
  invalidEvents: [],
  listings: [],
  mints: [],
  pendingSupply: 0,
  pendingSupplySubatoms: "0",
  precisionModel: WORK_PRECISION_MODEL,
  sales: [],
  source: "responsive-layout-fixture",
  summaryOnly: false,
  tokens: TOKENS,
  transfers: [],
  unitScale: WORK_UNIT_SCALE,
};

const REGISTRY_STATE = {
  activity: [],
  listings: [],
  pendingEvents: [],
  records: [],
  sales: [],
};

// Production-scale exact values make the rendered checks exercise the long
// numbers that exposed the original clipped metric-card regression.
const NETWORK_VALUE_EXACT = "1969375307586980910.74165320";
const NETWORK_VALUE = Number(NETWORK_VALUE_EXACT);
const NETWORK_VALUE_Q8 = "196937530758698091074165320";
const FLOOR_VALUE_EXACT = "93779776551.76099574";
const FLOOR_VALUE = Number(FLOOR_VALUE_EXACT);
const FLOOR_VALUE_Q8 = "9377977655176099574";
const WORK_ACCOUNTING_MODEL = "canonical-exact-work-network-q8-v1";
const WORK_AMO_V5_DECLARATION_TXID =
  "54d7a367a3998ce1327ee89d983a25c80ce34b96d9811807df215a8694aead36";
const WORK_AMO_V5_DECLARATION_BLOCK_HASH =
  "0000000000000000000094195957f498f894c92f5d5f75ff5b9c9afc749a6811";
const WORK_AMO_V8 = {
  activation: {
    activationHeight: 960_219,
    active: true,
    confirmed: true,
    declarationConfirmed: true,
    declarationHeight: 960_218,
    evidenceComplete: true,
    reached: true,
    tipVerified: true,
  },
  legacyWriteEmbargo: true,
  listingWritesEnabled: true,
  pinsConfigured: true,
  pinsRequested: true,
  protocolReady: true,
  protocolWritesEnabled: true,
  ready: true,
  reasonCode: "",
  settlementWritesEnabled: true,
  version: "pwt-sale-v8",
  writeAdmission: true,
};

const WORK_ACTUAL_VALUE = {
  baseNetworkValueQ8: NETWORK_VALUE_Q8,
  baseNetworkValueSats: NETWORK_VALUE,
  baseNetworkValueSatsExact: NETWORK_VALUE_EXACT,
  baseTotalQ8: NETWORK_VALUE_Q8,
  baseTotalSats: NETWORK_VALUE,
  baseTotalSatsExact: NETWORK_VALUE_EXACT,
  creditMinerFeeAccountingModel: "canonical-unique-tx-input-output-v1",
  creditMinerFeeCoverage: {
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
  creditEventFrozenValueQ8: "0",
  creditEventLiveValueQ8: "0",
  creditFrozenNetworkValueQ8: "0",
  creditLiveNetworkValueQ8: "0",
  creditMovementFrozenValueQ8: "0",
  creditMovementLiveValueQ8: "0",
  creditNetworkValueQ8: "0",
  floorQ8: FLOOR_VALUE_Q8,
  floorSats: FLOOR_VALUE,
  floorSatsExact: FLOOR_VALUE_EXACT,
  frozenFloorQ8: FLOOR_VALUE_Q8,
  frozenFloorSats: FLOOR_VALUE,
  frozenFloorSatsExact: FLOOR_VALUE_EXACT,
  frozenNetworkValueQ8: NETWORK_VALUE_Q8,
  frozenNetworkValueSats: NETWORK_VALUE,
  frozenNetworkValueSatsExact: NETWORK_VALUE_EXACT,
  frozenTotalQ8: NETWORK_VALUE_Q8,
  frozenTotalSats: NETWORK_VALUE,
  frozenTotalSatsExact: NETWORK_VALUE_EXACT,
  liveFloorQ8: FLOOR_VALUE_Q8,
  liveFloorSats: FLOOR_VALUE,
  liveFloorSatsExact: FLOOR_VALUE_EXACT,
  liveNetworkValueQ8: NETWORK_VALUE_Q8,
  liveNetworkValueSats: NETWORK_VALUE,
  liveNetworkValueSatsExact: NETWORK_VALUE_EXACT,
  liveTotalQ8: NETWORK_VALUE_Q8,
  liveTotalSats: NETWORK_VALUE,
  liveTotalSatsExact: NETWORK_VALUE_EXACT,
  networkValueQ8: NETWORK_VALUE_Q8,
  networkValueSats: NETWORK_VALUE,
  networkValueSatsExact: NETWORK_VALUE_EXACT,
  totalQ8: NETWORK_VALUE_Q8,
  totalSats: NETWORK_VALUE,
  totalSatsExact: NETWORK_VALUE_EXACT,
  workAmoV8: WORK_AMO_V8,
  workNetworkValueAccountingModel: WORK_ACCOUNTING_MODEL,
};

const WORK_FLOOR = {
  actualValue: WORK_ACTUAL_VALUE,
  chartPoints: [
    {
      floorQ8: FLOOR_VALUE_Q8,
      floorSats: FLOOR_VALUE,
      label: "Fixture",
      networkValueQ8: NETWORK_VALUE_Q8,
      networkValueSats: NETWORK_VALUE,
      years: 0,
    },
  ],
  floorQ8: FLOOR_VALUE_Q8,
  floorSats: FLOOR_VALUE,
  floorSatsExact: FLOOR_VALUE_EXACT,
  frozenFloorQ8: FLOOR_VALUE_Q8,
  frozenFloorSats: FLOOR_VALUE,
  frozenFloorSatsExact: FLOOR_VALUE_EXACT,
  frozenNetworkValueQ8: NETWORK_VALUE_Q8,
  frozenNetworkValueSats: NETWORK_VALUE,
  frozenNetworkValueSatsExact: NETWORK_VALUE_EXACT,
  indexedAt: NOW,
  indexedThroughBlock: 960_220,
  indexedThroughBlockHash: HASH,
  liveFloorQ8: FLOOR_VALUE_Q8,
  liveFloorSats: FLOOR_VALUE,
  liveFloorSatsExact: FLOOR_VALUE_EXACT,
  liveNetworkValueQ8: NETWORK_VALUE_Q8,
  liveNetworkValueSats: NETWORK_VALUE,
  liveNetworkValueSatsExact: NETWORK_VALUE_EXACT,
  network: "livenet",
  networkValueQ8: NETWORK_VALUE_Q8,
  networkValueSats: NETWORK_VALUE,
  networkValueSatsExact: NETWORK_VALUE_EXACT,
  powids: 1,
  snapshotId: "responsive-layout-fixture",
  stats: { indexedThroughBlock: 960_220 },
  tokenFlowSats: 0,
  totalQ8: NETWORK_VALUE_Q8,
  workAmoV5: {
    activationHeight: 959_621,
    active: true,
    allowedFaceUsdCents: [2000, 5000, 10000],
    authVersion: "pwt-sale-v5",
    declarationBlockHash: WORK_AMO_V5_DECLARATION_BLOCK_HASH,
    declarationConfirmed: true,
    declarationHeight: 959_620,
    declarationTxid: WORK_AMO_V5_DECLARATION_TXID,
    estimates: {
      2000: {
        estimateOnly: true,
        unitAmountAtoms: "20000000",
        unitFaceUsdCents: 2000,
        unitMinimumPriceSats: 20_000,
        unitNetworkValueBeforeQ8: NETWORK_VALUE_Q8,
        unitPriceSats: 20_000,
        unitUsdQuoteTxid: HASH,
      },
      5000: {
        estimateOnly: true,
        unitAmountAtoms: "50000000",
        unitFaceUsdCents: 5000,
        unitMinimumPriceSats: 50_000,
        unitNetworkValueBeforeQ8: NETWORK_VALUE_Q8,
        unitPriceSats: 50_000,
        unitUsdQuoteTxid: HASH,
      },
      10000: {
        estimateOnly: true,
        unitAmountAtoms: "100000000",
        unitFaceUsdCents: 10000,
        unitMinimumPriceSats: 100_000,
        unitNetworkValueBeforeQ8: NETWORK_VALUE_Q8,
        unitPriceSats: 100_000,
        unitUsdQuoteTxid: HASH,
      },
    },
    indexReady: true,
    listingWritesEnabled: true,
    maxQuoteAgeBlocks: 144,
    protocolWritesEnabled: true,
    quoteReady: true,
    writesConfigured: true,
    writesEnabled: true,
  },
  workAmoV6: {
    activation: {
      active: true,
      activationHeight: 959_999,
      canonical: true,
      confirmed: true,
      declaration: {
        activationHeight: 959_999,
        blockHash: HASH,
        blockHeight: 959_998,
        blockTransactionIndex: 0,
        protocolVout: 0,
        recordOrdinal: 0,
        txid: HASH,
      },
      evidenceComplete: true,
      reasonCode: "",
    },
    estimates: {
      20000: {
        estimateOnly: true,
        unitAmountAtoms: "21",
        unitFaceProofs: 20_000,
        unitMinimumPriceSats: "19694",
        unitNetworkValueBeforeQ8: NETWORK_VALUE_Q8,
        unitPriceSats: "20000",
      },
      50000: {
        estimateOnly: true,
        unitAmountAtoms: "53",
        unitFaceProofs: 50_000,
        unitMinimumPriceSats: "49704",
        unitNetworkValueBeforeQ8: NETWORK_VALUE_Q8,
        unitPriceSats: "50000",
      },
      100000: {
        estimateOnly: true,
        unitAmountAtoms: "106",
        unitFaceProofs: 100_000,
        unitMinimumPriceSats: "99407",
        unitNetworkValueBeforeQ8: NETWORK_VALUE_Q8,
        unitPriceSats: "100000",
      },
    },
    indexReady: true,
    listingWritesEnabled: true,
    migrationReady: true,
    networkValueBeforeQ8: NETWORK_VALUE_Q8,
    pinsConfigured: true,
    protocolWritesEnabled: true,
    ready: true,
    reasonCode: "",
    settlementWritesEnabled: true,
    tipHash: HASH,
    tipHeight: 960_000,
    version: "pwt-sale-v6",
    writesConfigured: true,
  },
  workAmoV8: WORK_AMO_V8,
  workNetworkValueAccountingModel: WORK_ACCOUNTING_MODEL,
};

const AMO_LISTING_COUNT = 512;
const AMO_SEALED_COUNT = 505;
const AMO_UNSEALED_COUNT = AMO_LISTING_COUNT - AMO_SEALED_COUNT;
const AMO_SELLER = "1BPVvi1GK4QkfqFMU4jHGjsQjyGwjJJJ7x";
const AMO_LONG_BUYER =
  "bc1p0uxp0axptr8rg9dndgtlwxn00j4hq8m88kg80tqd0t6045putwhq5ca7ed";
const AMO_ANCHOR_SIGNATURE = "aa".repeat(64);
const AMO_SELLER_PUBLIC_KEY =
  "02777b8fd3dc524694c52f2b505d14eacf289430f42b5785c48b7cb4948db8499b";

function fixtureTxid(index, offset = 0) {
  return (index + offset + 1).toString(16).padStart(64, "0");
}

function responsiveAmoListing(index) {
  const sealed = index < AMO_SEALED_COUNT;
  const listingId = fixtureTxid(index);
  return {
    amount: "0.0000000749030366",
    amountSubatoms: "749030366",
    amountStorageModel: WORK_STORAGE_MODEL,
    confirmed: true,
    createdAt: new Date(Date.parse(NOW) - index * 1_000).toISOString(),
    dataBytes: 994,
    decimals: 16,
    listingId,
    network: "livenet",
    precisionModel: WORK_PRECISION_MODEL,
    priceSats: 25_000,
    registryAddress: TOKENS[0].registryAddress,
    saleAuthorization: {
      amountModel: "canonical-work-amo-proof-unit-amount-v3",
      anchorScriptPubKey:
        "76a9144752142b83faf13d526a59212f3f228012890dbe88ac",
      anchorSigHashType: 131,
      anchorSignature: sealed ? AMO_ANCHOR_SIGNATURE : "",
      anchorTxid: sealed ? listingId : "",
      anchorType: "sale-ticket-v1",
      anchorValueSats: 546,
      anchorVout: 2,
      blockSequencerModel:
        "canonical-work-amo-full-position-block-sequencer-v4",
      bondTransitionModel: "canonical-compute-then-bond-v1",
      buyerAddress: "",
      expiresAt: "",
      network: "livenet",
      nonce: `responsive-amo-${index}`,
      registryAddress: TOKENS[0].registryAddress,
      sellerAddress: AMO_SELLER,
      sellerPublicKey: AMO_SELLER_PUBLIC_KEY,
      stateOrderModel: "canonical-proof-state-order-v1",
      ticker: "WORK",
      tokenId: WORK_TOKEN_ID,
      unitFaceProofs: 25_000,
      unitModel: "canonical-work-amo-proof-unit-v3",
      unitWorkOracleModel: "canonical-work-prefix-before-action-v1",
      version: "pwt-sale-v8",
    },
    ...(sealed
      ? {
          sealAt: new Date(Date.parse(NOW) - index * 1_000 + 500).toISOString(),
          sealConfirmed: true,
          sealTxid: fixtureTxid(index, 10_000),
        }
      : {}),
    sellerAddress: AMO_SELLER,
    ticker: "WORK",
    tokenId: WORK_TOKEN_ID,
    unitScale: WORK_UNIT_SCALE,
  };
}

const RESPONSIVE_AMO_LISTINGS = Array.from(
  { length: AMO_LISTING_COUNT },
  (_, index) => responsiveAmoListing(index),
);
const RESPONSIVE_AMO_ACTIVITY_ITEMS = {
  "market-listings": [
    {
      createdAt: RESPONSIVE_AMO_LISTINGS[0].createdAt,
      kind: "listing",
      listing: RESPONSIVE_AMO_LISTINGS[0],
      txid: RESPONSIVE_AMO_LISTINGS[0].listingId,
    },
  ],
  "market-sales": [
    {
      createdAt: NOW,
      kind: "sale",
      sale: {
        amount: RESPONSIVE_AMO_LISTINGS[0].amount,
        amountSubatoms: RESPONSIVE_AMO_LISTINGS[0].amountSubatoms,
        amountStorageModel: WORK_STORAGE_MODEL,
        buyerAddress: AMO_LONG_BUYER,
        confirmed: true,
        createdAt: NOW,
        decimals: 16,
        listingId: RESPONSIVE_AMO_LISTINGS[0].listingId,
        network: "livenet",
        paidSats: 25_000,
        precisionModel: WORK_PRECISION_MODEL,
        priceSats: 25_000,
        registryAddress: TOKENS[0].registryAddress,
        sellerAddress: AMO_SELLER,
        ticker: "WORK",
        tokenId: WORK_TOKEN_ID,
        txid: fixtureTxid(30_000),
        unitScale: WORK_UNIT_SCALE,
      },
      txid: fixtureTxid(30_000),
    },
  ],
  "market-seals": [
    {
      createdAt: RESPONSIVE_AMO_LISTINGS[0].createdAt,
      kind: "seal",
      seal: RESPONSIVE_AMO_LISTINGS[0],
      txid: RESPONSIVE_AMO_LISTINGS[0].sealTxid,
    },
  ],
};

function paginated(items = [], totalCount = items.length, authority = {}) {
  return {
    authoritative: true,
    complete: true,
    end: items.length,
    hasMore: false,
    indexedAt: NOW,
    items,
    limit: 25,
    page: 0,
    snapshotId: "responsive-layout-fixture",
    start: 0,
    totalCount,
    ...authority,
  };
}

async function installApiFixtures(
  page,
  {
    activityHistoryMode = "authoritative",
    boostItems = [],
    countedAmo = false,
    marketplaceSummaryGate,
    marketplaceSummaryMode = "ready",
    marketplaceSummaryTransform,
  } = {},
) {
  const fixtureTokenState = countedAmo
    ? {
        ...TOKEN_STATE,
        listings: RESPONSIVE_AMO_LISTINGS,
        tokens: TOKENS.map((token) =>
          token.tokenId === WORK_TOKEN_ID
            ? {
                ...token,
                confirmedOpenListings: AMO_LISTING_COUNT,
                openListings: AMO_LISTING_COUNT,
                pendingOpenListings: 0,
              }
            : token,
        ),
        totalCounts: { listings: AMO_LISTING_COUNT },
      }
    : TOKEN_STATE;
  // Match HTTP API reads only. A broader `/api/` glob would also intercept
  // Vite's `/src/api/*.ts` JavaScript modules and prevent the app from loading.
  await page.route("**/api/v1/**", async (route) => {
    const url = new URL(route.request().url());
    const { pathname } = url;
    let json;

    if (pathname === "/api/v1/marketplace-summary") {
      if (marketplaceSummaryGate) {
        await marketplaceSummaryGate;
      }
      const currentMarketplaceSummaryMode =
        typeof marketplaceSummaryMode === "function"
          ? marketplaceSummaryMode(url)
          : marketplaceSummaryMode;
      const summaryUnavailable =
        currentMarketplaceSummaryMode === "unavailable" ||
        (currentMarketplaceSummaryMode === "fresh-unavailable" &&
          url.searchParams.get("fresh") === "1");
      if (summaryUnavailable) {
        await route.fulfill({
          body: JSON.stringify({
            error: "Canonical AMO index is catching up.",
            details: {
              code: "CANONICAL_INDEX_CATCHING_UP",
              indexedThroughBlock: 965_473,
              lagBlocks: 20,
              tipHeight: 965_493,
            },
          }),
          contentType: "application/json",
          status: 503,
        });
        return;
      }
      const marketplaceSummary = {
        indexedAt: NOW,
        network: "livenet",
        registry: REGISTRY_STATE,
        summaryOnly: false,
        token: fixtureTokenState,
        workFloor: WORK_FLOOR,
      };
      json = marketplaceSummaryTransform
        ? marketplaceSummaryTransform(marketplaceSummary, url)
        : marketplaceSummary;
    } else if (pathname === "/api/v1/work-summary") {
      json = {
        floor: WORK_FLOOR,
        indexedAt: NOW,
        network: "livenet",
        summaryOnly: false,
        token: fixtureTokenState,
      };
    } else if (pathname === "/api/v1/work-floor") {
      json = WORK_FLOOR;
    } else if (pathname === "/api/v1/token-history") {
      const kind = url.searchParams.get("kind");
      const activityTotal = countedAmo
        ? kind === "market-listings"
          ? AMO_LISTING_COUNT
          : kind === "market-seals"
            ? AMO_SEALED_COUNT
            : kind === "market-sales"
              ? AMO_UNSEALED_COUNT
              : 0
        : 0;
      if (
        ["mismatched-kind", "preview"].includes(activityHistoryMode) &&
        ["market-listings", "market-seals", "market-sales"].includes(kind)
      ) {
        const items =
          kind === "market-listings"
            ? RESPONSIVE_AMO_ACTIVITY_ITEMS["market-listings"]
            : [];
        json =
          activityHistoryMode === "mismatched-kind"
            ? paginated(items, 999, {
                kind: "mints",
                source: "responsive-mismatched-history-kind",
              })
            : paginated(items, items.length, {
                authoritative: false,
                complete: false,
                kind,
                preview: true,
                source: "responsive-incomplete-preview",
              });
      } else {
        const items = countedAmo
          ? (RESPONSIVE_AMO_ACTIVITY_ITEMS[kind] ?? [])
          : [];
        json = paginated(items, activityTotal, {
          ...(kind?.startsWith("market-") ? { kind } : {}),
        });
      }
    } else if (
      pathname === "/api/v1/token" ||
      pathname === "/api/v1/token-summary"
    ) {
      json = fixtureTokenState;
    } else if (
      pathname === "/api/v1/registry" ||
      pathname === "/api/v1/registry-summary"
    ) {
      json = REGISTRY_STATE;
    } else if (pathname === "/api/v1/prices/btc-usd") {
      json = { USD: 100_000, usd: 100_000 };
    } else if (pathname === "/api/v1/boost") {
      json = {
        indexedAt: NOW,
        items: boostItems,
        network: "livenet",
        stats: { confirmed: 0, pending: 0, total: 0 },
        totalCount: boostItems.length,
      };
    } else if (pathname.endsWith("/status")) {
      json = {
        blockHash: HASH,
        blockHeight: 959_100,
        confirmed: true,
        status: "confirmed",
      };
    } else if (pathname.includes("-summary")) {
      json = {
        actualValue: {},
        indexedAt: NOW,
        network: "livenet",
        stats: {},
        token: fixtureTokenState,
      };
    } else if (pathname.includes("history") || pathname.includes("/log")) {
      json = paginated();
    } else {
      json = {};
    }

    await route.fulfill({
      body: JSON.stringify(json),
      contentType: "application/json",
      status: 200,
    });
  });
}

async function assertNoDocumentOverflow(page, label) {
  const dimensions = await page.evaluate(() => ({
    bodyClientWidth: document.body.clientWidth,
    bodyScrollWidth: document.body.scrollWidth,
    documentClientWidth: document.documentElement.clientWidth,
    documentScrollWidth: document.documentElement.scrollWidth,
    innerWidth: window.innerWidth,
  }));
  expect(
    Math.max(dimensions.bodyScrollWidth, dimensions.documentScrollWidth),
    `${label} widened the document: ${JSON.stringify(dimensions)}`,
  ).toBeLessThanOrEqual(dimensions.innerWidth + 1);
}

async function assertLocatorWithinViewport(page, locator, label) {
  await expect
    .poll(async () => {
      const [box, viewport] = await Promise.all([
        locator.boundingBox(),
        page.evaluate(() => ({ height: window.innerHeight, width: window.innerWidth })),
      ]);
      return Boolean(
        box &&
          box.x >= -1 &&
          box.y >= -1 &&
          box.x + box.width <= viewport.width + 1 &&
          box.y + box.height <= viewport.height + 1,
      );
    }, { message: `${label} did not settle within the viewport` })
    .toBe(true);
  const [box, viewport] = await Promise.all([
    locator.boundingBox(),
    page.evaluate(() => ({ height: window.innerHeight, width: window.innerWidth })),
  ]);
  expect(box, `${label} has no geometry`).not.toBeNull();
  expect(box.x, `${label} starts left of the viewport`).toBeGreaterThanOrEqual(-1);
  expect(box.y, `${label} starts above the viewport`).toBeGreaterThanOrEqual(-1);
  expect(
    box.x + box.width,
    `${label} escapes the viewport horizontally`,
  ).toBeLessThanOrEqual(viewport.width + 1);
  expect(
    box.y + box.height,
    `${label} escapes the viewport vertically`,
  ).toBeLessThanOrEqual(viewport.height + 1);
}

async function assertTabListContained(page, tabList, label) {
  await expect(tabList, `${label} did not render`).toBeVisible();
  await tabList.scrollIntoViewIfNeeded();
  await assertElementContainsItsLayout(tabList, label);
  const tabs = tabList.getByRole("tab");
  const count = await tabs.count();
  expect(count, `${label} has no tabs`).toBeGreaterThan(0);
  const listBox = await tabList.boundingBox();
  expect(listBox, `${label} has no geometry`).not.toBeNull();
  for (let index = 0; index < count; index += 1) {
    const tab = tabs.nth(index);
    const box = await tab.boundingBox();
    expect(box, `${label} tab ${index + 1} has no geometry`).not.toBeNull();
    expect(box.x, `${label} tab ${index + 1} starts outside its list`).toBeGreaterThanOrEqual(
      listBox.x - 1,
    );
    expect(
      box.x + box.width,
      `${label} tab ${index + 1} escapes its list`,
    ).toBeLessThanOrEqual(listBox.x + listBox.width + 1);
    expect(box.height, `${label} tab ${index + 1} is not touch-safe`).toBeGreaterThanOrEqual(
      44,
    );
  }
  await assertLocatorWithinViewport(page, tabList, label);
}

async function assertTabControlsLabelledPanel(page, tab, label) {
  const [controls, tabId] = await Promise.all([
    tab.getAttribute("aria-controls"),
    tab.getAttribute("id"),
  ]);
  expect(controls, `${label} has no aria-controls target`).toBeTruthy();
  expect(tabId, `${label} has no stable id`).toBeTruthy();
  const panel = page.locator(`[id="${controls}"]`);
  await expect(panel, `${label} target panel is missing`).toHaveCount(1);
  await expect(panel).toHaveAttribute("role", "tabpanel");
  await expect(panel).toHaveAttribute("aria-labelledby", tabId);
  return panel;
}

async function assertMobileDomainNav(page, label) {
  const trigger = page.locator(".app-menu-trigger").first();
  await expect(trigger).toBeVisible();
  await expect(trigger).toHaveAccessibleName("Open application menu");
  await expect(trigger).toHaveAttribute("aria-expanded", "false");
  await trigger.click();

  const dialog = page.getByRole("dialog", { name: "Applications" });
  await expect(dialog, `${label} application sheet did not open`).toBeVisible();
  await expect(trigger).toHaveAttribute("aria-expanded", "true");
  await expect(trigger).toHaveAccessibleName("Close application menu");
  await assertLocatorWithinViewport(page, dialog, `${label} application sheet`);
  await expect(page.locator(".app-menu-scrim")).toBeVisible();
  await expect
    .poll(() =>
      dialog.evaluate((element) => element.contains(document.activeElement)),
    )
    .toBe(true);

  await page.keyboard.press("Tab");
  expect(
    await dialog.evaluate((element) => element.contains(document.activeElement)),
    `${label} application sheet did not trap forward focus`,
  ).toBe(true);
  await page.keyboard.press("Shift+Tab");
  expect(
    await dialog.evaluate((element) => element.contains(document.activeElement)),
    `${label} application sheet did not trap reverse focus`,
  ).toBe(true);

  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  await expect(trigger).toHaveAttribute("aria-expanded", "false");
  await expect(trigger).toHaveAccessibleName("Open application menu");
  await expect(trigger, `${label} menu trigger did not regain focus`).toBeFocused();
}

async function assertSkipLink(page, label) {
  const skipLink = page.locator("a.skip-link").first();
  await expect(skipLink, `${label} skip link is missing`).toHaveAttribute(
    "href",
    "#main-content",
  );
  await page.evaluate(() => {
    if (document.activeElement instanceof HTMLElement) {
      document.activeElement.blur();
    }
    window.scrollTo(0, 0);
  });
  await page.keyboard.press("Tab");
  await expect(skipLink, `${label} skip link is not first in keyboard order`).toBeFocused();
  await expect(skipLink, `${label} focused skip link is not visible`).toBeVisible();
  await page.keyboard.press("Enter");
  await expect(
    page.locator("#main-content"),
    `${label} skip target did not receive focus`,
  ).toBeFocused();
}

async function assertProgressbarSemantics(page, label) {
  const progressbar = page
    .getByRole("progressbar", { name: "WORK mint progress" })
    .first();
  await expect(progressbar, `${label} WORK progressbar is missing`).toBeVisible();
  await expect(progressbar).toHaveAttribute("aria-valuemin", "0");
  await expect(progressbar).toHaveAttribute("aria-valuemax", "100");
  const value = Number(await progressbar.getAttribute("aria-valuenow"));
  expect(Number.isFinite(value), `${label} progressbar value is not numeric`).toBe(
    true,
  );
  expect(value, `${label} progressbar value is below its minimum`).toBeGreaterThanOrEqual(
    0,
  );
  expect(value, `${label} progressbar value exceeds its maximum`).toBeLessThanOrEqual(
    100,
  );
}

async function assertComputerMoreSheet(page, label) {
  const trigger = page
    .locator(".computer-mobile-nav")
    .getByRole("button", { name: "More" });
  await expect(trigger, `${label} More control is missing`).toBeVisible();
  await expect(trigger).toHaveAttribute("aria-expanded", "false");
  await expect(trigger).toHaveAttribute("aria-haspopup", "dialog");
  await trigger.click();

  const dialog = page.getByRole("dialog", { name: "Computer navigation" });
  await expect(dialog, `${label} navigation sheet did not open`).toBeVisible();
  await expect(trigger).toHaveAttribute("aria-expanded", "true");
  await expect(dialog).toHaveAttribute("aria-modal", "true");
  await assertLocatorWithinViewport(page, dialog, `${label} navigation sheet`);
  await expect(page.locator(".computer-navigation-scrim")).toBeVisible();
  await expect
    .poll(() =>
      dialog.evaluate((element) => element.contains(document.activeElement)),
    )
    .toBe(true);
  await expect
    .poll(() => page.evaluate(() => document.documentElement.classList.contains("computer-nav-open")))
    .toBe(true);

  await page.keyboard.press("Tab");
  expect(
    await dialog.evaluate((element) => element.contains(document.activeElement)),
    `${label} navigation sheet did not trap forward focus`,
  ).toBe(true);
  await page.keyboard.press("Shift+Tab");
  expect(
    await dialog.evaluate((element) => element.contains(document.activeElement)),
    `${label} navigation sheet did not trap reverse focus`,
  ).toBe(true);

  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  await expect(trigger).toHaveAttribute("aria-expanded", "false");
  await expect(trigger, `${label} More control did not regain focus`).toBeFocused();
  await expect
    .poll(() => page.evaluate(() => document.documentElement.classList.contains("computer-nav-open")))
    .toBe(false);
}

async function assertBoostDrawerResizeCleanup(page, label) {
  const trigger = page.getByRole("button", { exact: true, name: "Tools" });
  await expect(trigger, `${label} Tools control is missing`).toBeVisible();
  await expect(trigger).toHaveAttribute("aria-expanded", "false");
  await trigger.click();

  const dialog = page.getByRole("dialog", { name: "Boost tools" });
  await expect(dialog, `${label} tools drawer did not open`).toBeVisible();
  await expect(trigger).toHaveAttribute("aria-expanded", "true");
  await expect(dialog).toHaveAttribute("aria-modal", "true");
  await assertLocatorWithinViewport(page, dialog, `${label} tools drawer`);
  await expect(page.locator(".boost-tools-backdrop")).toBeVisible();
  await expect
    .poll(() =>
      dialog.evaluate((element) => element.contains(document.activeElement)),
    )
    .toBe(true);
  await expect
    .poll(() => page.evaluate(() => document.body.style.overflow))
    .toBe("hidden");

  await page.setViewportSize({ height: VIEWPORT_HEIGHT, width: 1024 });
  await expect(dialog, `${label} tools drawer remained modal after resize`).toBeHidden();
  await expect(page.locator(".boost-tools-backdrop")).toHaveCount(0);
  await expect(page.locator(".boost-sidebar")).toBeVisible();
  await expect
    .poll(() => page.evaluate(() => document.body.style.overflow))
    .not.toBe("hidden");
}

async function assertExpandableStatus(page, label) {
  const status = page.locator(".app-status-row").first();
  await expect(status, `${label} status row did not render`).toBeVisible();
  await assertLocatorWithinViewport(page, status, `${label} status row`);
  const collapsedBox = await status.boundingBox();
  expect(collapsedBox.height, `${label} status row is shorter than 44px`).toBeGreaterThanOrEqual(
    44,
  );

  const expand = status.locator(".status-expand-button");
  await expect(expand, `${label} long status has no disclosure`).toBeVisible();
  await expect(expand).toHaveAccessibleName("Show full status");
  await expect(expand).toHaveAttribute("aria-expanded", "false");
  await expand.focus();
  await page.keyboard.press("Enter");
  await expect(expand).toHaveAttribute("aria-expanded", "true");
  await expect(expand).toHaveAccessibleName("Collapse status");
  const expandedBox = await status.boundingBox();
  expect(
    expandedBox.height,
    `${label} expanded status became shorter`,
  ).toBeGreaterThanOrEqual(collapsedBox.height);
  await expect(status.locator(".status-text")).toHaveCSS("white-space", "normal");
  await page.keyboard.press("Space");
  await expect(expand).toHaveAttribute("aria-expanded", "false");
  await expect(expand).toHaveAccessibleName("Show full status");
}

async function assertStructuralAccessibility(page, label) {
  const result = await page.evaluate(() => {
    const visible = (element) => {
      const style = getComputedStyle(element);
      const rect = element.getBoundingClientRect();
      return (
        style.display !== "none" &&
        style.visibility !== "hidden" &&
        rect.width > 0 &&
        rect.height > 0
      );
    };
    const normalizedText = (value) => String(value ?? "").replace(/\s+/gu, " ").trim();
    const referencedText = (element, attribute) =>
      normalizedText(
        (element.getAttribute(attribute) ?? "")
          .split(/\s+/u)
          .filter(Boolean)
          .map((id) => document.getElementById(id)?.textContent ?? "")
          .join(" "),
      );
    const accessibleName = (element) => {
      const explicit = normalizedText(element.getAttribute("aria-label"));
      if (explicit) return explicit;
      const labelled = referencedText(element, "aria-labelledby");
      if (labelled) return labelled;
      if (element.id) {
        const escapedId = CSS.escape(element.id);
        const externalLabel = normalizedText(
          document.querySelector(`label[for="${escapedId}"]`)?.textContent,
        );
        if (externalLabel) return externalLabel;
      }
      const wrappingLabel = normalizedText(element.closest("label")?.textContent);
      if (wrappingLabel) return wrappingLabel;
      if (element instanceof HTMLImageElement) {
        return normalizedText(element.alt);
      }
      return (
        normalizedText(element.textContent) ||
        normalizedText(element.getAttribute("title")) ||
        normalizedText(element.getAttribute("value"))
      );
    };

    const issues = [];
    const ids = new Map();
    for (const element of document.querySelectorAll("[id]")) {
      const id = element.id.trim();
      if (!id) continue;
      ids.set(id, (ids.get(id) ?? 0) + 1);
    }
    for (const [id, count] of ids) {
      if (count > 1) issues.push(`duplicate id #${id} (${count})`);
    }

    const namedSelector = [
      "a[href]",
      "button",
      "input:not([type='hidden'])",
      "select",
      "textarea",
      "[role='button']",
      "[role='dialog']",
      "[role='menuitem']",
      "[role='progressbar']",
      "[role='tab']",
      "[role='tablist']",
    ].join(",");
    for (const element of document.querySelectorAll(namedSelector)) {
      if (!visible(element) || element.getAttribute("aria-hidden") === "true") continue;
      if (!accessibleName(element)) {
        issues.push(`unnamed ${element.tagName.toLowerCase()}${element.getAttribute("role") ? `[role=${element.getAttribute("role")}]` : ""}`);
      }
    }

    for (const image of document.querySelectorAll("img")) {
      if (visible(image) && !image.hasAttribute("alt")) {
        issues.push(`image missing alt: ${image.getAttribute("src") ?? "unknown"}`);
      }
    }

    for (const element of document.querySelectorAll("[tabindex]")) {
      const tabIndex = Number(element.getAttribute("tabindex"));
      if (Number.isFinite(tabIndex) && tabIndex > 0) {
        issues.push(`positive tabindex ${tabIndex} on ${element.tagName.toLowerCase()}`);
      }
    }

    for (const progressbar of document.querySelectorAll("[role='progressbar']")) {
      if (!visible(progressbar)) continue;
      const minimum = Number(progressbar.getAttribute("aria-valuemin"));
      const maximum = Number(progressbar.getAttribute("aria-valuemax"));
      const current = Number(progressbar.getAttribute("aria-valuenow"));
      if (
        !Number.isFinite(minimum) ||
        !Number.isFinite(maximum) ||
        !Number.isFinite(current) ||
        maximum <= minimum ||
        current < minimum ||
        current > maximum
      ) {
        issues.push(
          `invalid progressbar range ${minimum}/${current}/${maximum}`,
        );
      }
    }

    for (const element of document.querySelectorAll("[aria-controls], [aria-labelledby]")) {
      for (const attribute of ["aria-controls", "aria-labelledby"]) {
        const references = (element.getAttribute(attribute) ?? "")
          .split(/\s+/u)
          .filter(Boolean);
        for (const reference of references) {
          if (!document.getElementById(reference)) {
            issues.push(`${attribute} references missing #${reference}`);
          }
        }
      }
    }

    return {
      h1Count: [...document.querySelectorAll("h1")].filter(visible).length,
      issues,
      lang: document.documentElement.lang,
      mainCount: [...document.querySelectorAll("main, [role='main']")].filter(visible)
        .length,
    };
  });

  expect(result.lang, `${label} document language is missing`).toMatch(/^en(?:-|$)/iu);
  expect(result.h1Count, `${label} has no visible level-one heading`).toBeGreaterThan(0);
  expect(result.mainCount, `${label} must expose one visible main landmark`).toBe(1);
  expect(result.issues, `${label} structural accessibility issues`).toEqual([]);
}

async function assertOperableTargetGeometry(page, label) {
  const offenders = await page.evaluate(() => {
    const visible = (element) => {
      const style = getComputedStyle(element);
      const rect = element.getBoundingClientRect();
      return (
        style.display !== "none" &&
        style.visibility !== "hidden" &&
        rect.width > 0 &&
        rect.height > 0
      );
    };
    const selector = [
      "button:not([hidden])",
      "[role='button']:not([hidden])",
      "input:not([type='hidden'])",
      "select",
      "textarea",
      "details > summary",
      ".attachment-picker",
      ".compose-social-toggle",
      "a.primary",
      "a.secondary",
      "a.icon-button",
    ].join(",");
    const targets = [...new Set(document.querySelectorAll(selector))];
    return targets.flatMap((element) => {
      if (!visible(element) || element.getAttribute("aria-hidden") === "true") {
        return [];
      }
      let measured = element;
      if (
        element instanceof HTMLInputElement &&
        ["checkbox", "radio"].includes(element.type)
      ) {
        const label = [...(element.labels ?? [])].find(visible);
        if (label) measured = label;
      }
      const rect = measured.getBoundingClientRect();
      return rect.width >= 43.5 && rect.height >= 43.5
        ? []
        : [
            {
              className:
                typeof measured.className === "string" ? measured.className : "",
              height: Number(rect.height.toFixed(2)),
              tag: measured.tagName.toLowerCase(),
              text: (measured.textContent ?? "").replace(/\s+/gu, " ").trim().slice(0, 60),
              width: Number(rect.width.toFixed(2)),
            },
          ];
    });
  });
  expect(offenders, `${label} has operable targets below 44×44 CSS pixels`).toEqual(
    [],
  );
}

async function assertRepresentativeContrast(page, label) {
  const primarySelector = [
    "button.primary:not(:disabled):visible",
    "a.primary:visible",
    ".compose-button:not(:disabled):visible",
  ].join(",");
  const mutedSelector = [
    "#credit-market-activity .field-note:visible",
    ".marketplace-app .field-note:visible",
    ".brand span:visible",
  ].join(",");
  const controlSelector = [
    "#credit-market-activity input:not([type='hidden']):visible",
    ".marketplace-app input:not([type='hidden']):visible",
    ".marketplace-app select:visible",
  ].join(",");
  await expect(
    page.locator(primarySelector).first(),
    `${label} primary contrast sample did not finish rendering`,
  ).toBeVisible({ timeout: 20_000 });
  await expect(
    page.locator(mutedSelector).first(),
    `${label} muted contrast sample did not finish rendering`,
  ).toBeVisible({ timeout: 20_000 });
  await expect(
    page.locator(controlSelector).first(),
    `${label} control contrast sample did not finish rendering`,
  ).toBeVisible({ timeout: 20_000 });
  await expect(
    page.locator(".app-status-row .status-text:visible").first(),
    `${label} status contrast sample did not finish rendering`,
  ).toBeVisible({ timeout: 20_000 });

  const result = await page.evaluate(() => {
    const parseColor = (value) => {
      if (!value || value === "transparent") return [0, 0, 0, 0];
      const hex = value.trim().match(/^#([\da-f]{3,8})$/iu)?.[1];
      if (hex) {
        const expanded =
          hex.length === 3 || hex.length === 4
            ? [...hex].map((character) => `${character}${character}`).join("")
            : hex;
        if (expanded.length === 6 || expanded.length === 8) {
          return [
            Number.parseInt(expanded.slice(0, 2), 16),
            Number.parseInt(expanded.slice(2, 4), 16),
            Number.parseInt(expanded.slice(4, 6), 16),
            expanded.length === 8
              ? Number.parseInt(expanded.slice(6, 8), 16) / 255
              : 1,
          ];
        }
      }
      const match = value.match(/^rgba?\((.*)\)$/iu);
      if (!match) return null;
      const parts = match[1]
        .replace("/", " ")
        .split(/[\s,]+/u)
        .filter(Boolean)
        .map(Number);
      if (parts.length < 3 || parts.slice(0, 3).some((part) => !Number.isFinite(part))) {
        return null;
      }
      return [parts[0], parts[1], parts[2], Number.isFinite(parts[3]) ? parts[3] : 1];
    };
    const composite = (foreground, background) => {
      const alpha = foreground[3] + background[3] * (1 - foreground[3]);
      if (alpha === 0) return [0, 0, 0, 0];
      return [
        (foreground[0] * foreground[3] + background[0] * background[3] * (1 - foreground[3])) / alpha,
        (foreground[1] * foreground[3] + background[1] * background[3] * (1 - foreground[3])) / alpha,
        (foreground[2] * foreground[3] + background[2] * background[3] * (1 - foreground[3])) / alpha,
        alpha,
      ];
    };
    const backgroundUnder = (element) => {
      const layers = [];
      for (let current = element; current; current = current.parentElement) {
        const color = parseColor(getComputedStyle(current).backgroundColor);
        if (color && color[3] > 0) layers.push(color);
      }
      let resolved = [255, 255, 255, 1];
      for (const layer of layers.reverse()) resolved = composite(layer, resolved);
      return resolved;
    };
    const luminance = (color) => {
      const channels = color.slice(0, 3).map((channel) => {
        const normalized = channel / 255;
        return normalized <= 0.04045
          ? normalized / 12.92
          : ((normalized + 0.055) / 1.055) ** 2.4;
      });
      return channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722;
    };
    const contrast = (first, second) => {
      const firstLuminance = luminance(first);
      const secondLuminance = luminance(second);
      return (
        (Math.max(firstLuminance, secondLuminance) + 0.05) /
        (Math.min(firstLuminance, secondLuminance) + 0.05)
      );
    };
    const visible = (element) => {
      if (!(element instanceof HTMLElement)) return false;
      const style = getComputedStyle(element);
      const rect = element.getBoundingClientRect();
      return (
        style.display !== "none" &&
        style.visibility !== "hidden" &&
        Number(style.opacity) > 0 &&
        rect.width > 0 &&
        rect.height > 0
      );
    };
    const firstVisible = (selector) =>
      [...document.querySelectorAll(selector)].find(visible) ?? null;
    const samples = [];
    const textSample = (name, element, threshold = 4.5) => {
      if (!element) {
        samples.push({ name, missing: true, ratio: 0, threshold });
        return;
      }
      const background = backgroundUnder(element);
      const foreground = parseColor(getComputedStyle(element).color);
      samples.push({
        name,
        ratio: foreground
          ? contrast(composite(foreground, background), background)
          : 0,
        threshold,
      });
    };

    const primary = firstVisible("button.primary:not(:disabled), a.primary, .compose-button:not(:disabled)");
    const muted = firstVisible(
      "#credit-market-activity .field-note, .marketplace-app .field-note, .brand span",
    );
    const status = firstVisible(".app-status-row .status-text");
    const control = firstVisible(
      "#credit-market-activity input:not([type='hidden']), .marketplace-app input:not([type='hidden']), .marketplace-app select",
    );

    textSample("primary action text", primary);
    textSample("body text", document.body);
    textSample("muted text", muted);
    textSample("status text", status);

    if (!control) {
      samples.push({
        missing: true,
        name: "interactive control border",
        ratio: 0,
        threshold: 3,
      });
      samples.push({
        missing: true,
        name: "keyboard focus indication",
        ratio: 0,
        threshold: 3,
      });
      return { focusChanged: false, focusVisible: false, samples };
    }

    const surroundingSurface = backgroundUnder(control.parentElement ?? document.body);
    control.style.transition = "none";
    control.blur();
    void control.offsetWidth;
    const beforeStyle = getComputedStyle(control);
    const beforeBorder = beforeStyle.borderTopColor;
    const beforeOutline = `${beforeStyle.outlineStyle}/${beforeStyle.outlineWidth}/${beforeStyle.outlineColor}`;
    const beforeShadow = beforeStyle.boxShadow;
    const rootStyle = getComputedStyle(document.documentElement);
    const interactiveBorder = parseColor(
      rootStyle.getPropertyValue("--border-interactive").trim(),
    );
    const instrumentSurface = parseColor(
      rootStyle.getPropertyValue("--surface").trim(),
    );
    samples.push({
      name: "interactive border token",
      ratio: interactiveBorder && instrumentSurface
        ? contrast(composite(interactiveBorder, instrumentSurface), instrumentSurface)
        : 0,
      threshold: 3,
    });
    const renderedBorder = parseColor(beforeBorder);
    samples.push({
      name: "rendered control border",
      ratio: renderedBorder
        ? contrast(composite(renderedBorder, surroundingSurface), surroundingSurface)
        : 0,
      threshold: 3,
    });

    control.focus();
    const focusStyle = getComputedStyle(control);
    const focusOutline = parseColor(focusStyle.outlineColor);
    samples.push({
      name: "keyboard focus indication",
      ratio: focusOutline
        ? contrast(composite(focusOutline, surroundingSurface), surroundingSurface)
        : 0,
      threshold: 3,
    });

    return {
      focusChanged:
        beforeBorder !== focusStyle.borderTopColor ||
        beforeOutline !== `${focusStyle.outlineStyle}/${focusStyle.outlineWidth}/${focusStyle.outlineColor}` ||
        beforeShadow !== focusStyle.boxShadow,
      focusOutlineStyle: focusStyle.outlineStyle,
      focusOutlineWidth: Number.parseFloat(focusStyle.outlineWidth),
      focusVisible: control.matches(":focus-visible"),
      samples,
    };
  });

  expect(result.focusVisible, `${label} keyboard target did not match :focus-visible`).toBe(
    true,
  );
  expect(result.focusChanged, `${label} focus did not produce a visual style change`).toBe(
    true,
  );
  expect(result.focusOutlineStyle, `${label} focus outline is not solid`).toBe("solid");
  expect(result.focusOutlineWidth, `${label} focus outline is thinner than 2px`).toBeGreaterThanOrEqual(
    2,
  );
  for (const sample of result.samples) {
    expect(sample.missing, `${label} is missing the ${sample.name} sample`).not.toBe(
      true,
    );
    expect(
      sample.ratio,
      `${label} ${sample.name} contrast ${sample.ratio.toFixed(2)}:1 is below ${sample.threshold}:1`,
    ).toBeGreaterThanOrEqual(sample.threshold);
  }
}

async function assertReducedMotion(page, label) {
  await page.emulateMedia({ reducedMotion: "reduce" });
  const offenders = await page.evaluate(() => {
    const durationMs = (value) =>
      value
        .split(",")
        .map((part) => part.trim())
        .reduce((maximum, part) => {
          const numeric = Number.parseFloat(part);
          if (!Number.isFinite(numeric)) return maximum;
          return Math.max(maximum, part.endsWith("ms") ? numeric : numeric * 1_000);
        }, 0);
    return [...document.querySelectorAll("body *")]
      .filter((element) => element.getClientRects().length > 0)
      .flatMap((element) => {
        const style = getComputedStyle(element);
        const animationMs = durationMs(style.animationDuration);
        const transitionMs = durationMs(style.transitionDuration);
        return animationMs > 0.02 || transitionMs > 0.02
          ? [
              {
                animationMs,
                selector: `${element.tagName.toLowerCase()}.${[...element.classList].join(".")}`,
                transitionMs,
              },
            ]
          : [];
      })
      .slice(0, 10);
  });
  expect(offenders, `${label} ignores reduced-motion preferences`).toEqual([]);
}

async function assertTwoHundredPercentTextReflow(page, label) {
  await page.addStyleTag({
    content: "html { font-size: 200% !important; }",
  });
  await expect
    .poll(() =>
      page.evaluate(() => Number.parseFloat(getComputedStyle(document.documentElement).fontSize)),
    )
    .toBeGreaterThanOrEqual(31);
  await assertNoDocumentOverflow(page, `${label} at 200% text`);
  const root = page.locator("#root");
  await expect(root).not.toBeEmpty();
  const rootBox = await root.boundingBox();
  expect(rootBox.width, `${label} root collapsed at 200% text`).toBeGreaterThan(0);
}

async function assertElementContainsItsLayout(
  locator,
  label,
  { allowHorizontalScroll = false } = {},
) {
  const dimensions = await locator.evaluate((element) => {
    const style = getComputedStyle(element);
    return {
      clientWidth: element.clientWidth,
      overflowingDescendants: [...element.querySelectorAll("*")]
        .filter((child) => child.scrollWidth > child.clientWidth + 1)
        .slice(0, 8)
        .map((child) => ({
          className: child.className,
          clientWidth: child.clientWidth,
          overflowX: getComputedStyle(child).overflowX,
          scrollWidth: child.scrollWidth,
          tag: child.tagName.toLowerCase(),
        })),
      overflowX: style.overflowX,
      scrollWidth: element.scrollWidth,
    };
  });
  if (allowHorizontalScroll && dimensions.scrollWidth > dimensions.clientWidth + 1) {
    expect(
      ["auto", "scroll"],
      `${label} must contain long exact text in an intentional scroll lane: ${JSON.stringify(dimensions)}`,
    ).toContain(dimensions.overflowX);
    return;
  }
  expect(
    dimensions.scrollWidth,
    `${label} clips horizontal content: ${JSON.stringify(dimensions)}`,
  ).toBeLessThanOrEqual(dimensions.clientWidth + 1);
}

async function assertFragmentOnOneRenderedLine(
  locator,
  fragment,
  label,
  { allowHorizontalScroll = false } = {},
) {
  const result = await locator.evaluate((element, needle) => {
    const content = element.textContent ?? "";
    const startIndex = content.indexOf(needle);
    if (startIndex < 0) {
      return { found: false, lineCount: 0 };
    }

    const endIndex = startIndex + needle.length;
    const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
    let cursor = 0;
    let startNode;
    let startOffset = 0;
    let endNode;
    let endOffset = 0;

    while (walker.nextNode()) {
      const node = walker.currentNode;
      const length = node.textContent?.length ?? 0;
      const next = cursor + length;
      if (!startNode && startIndex >= cursor && startIndex <= next) {
        startNode = node;
        startOffset = startIndex - cursor;
      }
      if (!endNode && endIndex >= cursor && endIndex <= next) {
        endNode = node;
        endOffset = endIndex - cursor;
      }
      cursor = next;
    }

    if (!startNode || !endNode) {
      return { found: false, lineCount: 0 };
    }

    const range = document.createRange();
    range.setStart(startNode, startOffset);
    range.setEnd(endNode, endOffset);
    const lineTops = [];
    for (const rect of range.getClientRects()) {
      if (rect.width < 0.5 || rect.height < 0.5) {
        continue;
      }
      if (!lineTops.some((top) => Math.abs(top - rect.top) <= 1)) {
        lineTops.push(rect.top);
      }
    }

    return {
      clientWidth: element.clientWidth,
      found: true,
      lineCount: lineTops.length,
      scrollWidth: element.scrollWidth,
    };
  }, fragment);

  expect(result.found, `${label} exact fragment was not rendered`).toBe(true);
  expect(
    result.lineCount,
    `${label} numeric value split across lines: ${JSON.stringify(result)}`,
  ).toBe(1);
  if (!allowHorizontalScroll) {
    expect(
      result.scrollWidth,
      `${label} overflows horizontally`,
    ).toBeLessThanOrEqual(result.clientWidth + 1);
  } else if (result.scrollWidth > result.clientWidth + 1) {
    const overflowX = await locator.evaluate(
      (element) => getComputedStyle(element).overflowX,
    );
    expect(
      ["auto", "scroll"],
      `${label} long exact value is not contained by a horizontal scroll lane`,
    ).toContain(overflowX);
  }
}

async function assertComputerWorkExactMetrics(page, label) {
  const stats = page.locator(
    '.work-floor-metrics-card [aria-label="Live WORK floor"]',
  );
  await expect(
    stats,
    `${label} exact WORK floor metrics did not render`,
  ).toBeVisible();

  const checks = [
    ["Floor", "93,779,776,551.76099574"],
    ["Live network value", "1,969,375,307,586,980,910.7416532"],
    ["Frozen network value", "1,969,375,307,586,980,910.7416532"],
    ["Frozen floor", "93,779,776,551.76099574"],
  ];
  for (const [metricLabel, exactText] of checks) {
    const value = stats
      .getByText(metricLabel, { exact: true })
      .locator("xpath=..")
      .locator(".proof-metric-display");
    await expect(value, `${label} ${metricLabel} missing`).toHaveCount(1);
    await expect(value).toContainText(exactText);
    await assertFragmentOnOneRenderedLine(
      value,
      exactText,
      `${label} ${metricLabel}`,
      { allowHorizontalScroll: true },
    );
  }
}

async function assertMarketplaceWorkExactMetrics(page, label) {
  const stats = page.locator('[aria-label="WORK market price"]');
  await expect(stats, `${label} exact WORK market metrics did not render`).toBeVisible();

  const checks = [
    ["Live network floor", "93,779,776,551.76099574"],
    ["Live network value", "1,969,375,307,586,980,910.7416532"],
    ["Frozen network value", "1,969,375,307,586,980,910.7416532"],
    ["Frozen floor", "93,779,776,551.76099574"],
  ];
  for (const [metricLabel, exactText] of checks) {
    const value = stats
      .getByText(metricLabel, { exact: true })
      .locator("xpath=..")
      .locator(".proof-metric-display");
    await expect(value, `${label} ${metricLabel} missing`).toHaveCount(1);
    await expect(value).toContainText(exactText);
    await assertFragmentOnOneRenderedLine(
      value,
      exactText,
      `${label} ${metricLabel}`,
      { allowHorizontalScroll: true },
    );
  }
}

async function assertCountedAmoControls(page, label) {
  const orderBook = page.locator("#credit-market-book");
  await expect(orderBook).toBeVisible();
  const orderFilters = orderBook.locator(".marketplace-listing-tabs");
  await expect(orderFilters).toHaveAccessibleName("Credit order book filter");
  await orderFilters.scrollIntoViewIfNeeded();
  await assertElementContainsItsLayout(
    orderFilters,
    `${label} counted order-book filters`,
  );
  await assertLocatorWithinViewport(
    page,
    orderFilters,
    `${label} counted order-book filters`,
  );
  const all = orderFilters.getByRole("button", { name: /All\s*512/u });
  const sealed = orderFilters.getByRole("button", { name: /Sealed\s*505/u });
  const unsealed = orderFilters.getByRole("button", { name: /Unsealed\s*7/u });
  const filterBox = await orderFilters.boundingBox();
  for (const [name, filter] of [
    ["All", all],
    ["Sealed", sealed],
    ["Unsealed", unsealed],
  ]) {
    const box = await filter.boundingBox();
    expect(box, `${label} ${name} filter has no geometry`).not.toBeNull();
    expect(box.height, `${label} ${name} filter is not touch-safe`).toBeGreaterThanOrEqual(
      44,
    );
    expect(
      box.x + box.width,
      `${label} ${name} filter escapes its control group`,
    ).toBeLessThanOrEqual(filterBox.x + filterBox.width + 1);
  }
  await expect(all).toHaveAttribute("aria-pressed", "true");
  await sealed.click();
  await expect(sealed).toHaveAttribute("aria-pressed", "true");
  await expect(all).toHaveAttribute("aria-pressed", "false");
  await unsealed.click();
  await expect(unsealed).toHaveAttribute("aria-pressed", "true");
  await all.click();
  await expect(all).toHaveAttribute("aria-pressed", "true");

  const sort = orderBook.locator(".marketplace-sort-row select");
  await expect(sort).toBeVisible();
  await expect(sort).toHaveAccessibleName("Sort");
  await sort.scrollIntoViewIfNeeded();
  await assertLocatorWithinViewport(page, sort, `${label} AMO sort control`);
  const sortBox = await sort.boundingBox();
  const orderBox = await orderBook.boundingBox();
  expect(
    sortBox.x + sortBox.width,
    `${label} AMO sort control escapes the order book`,
  ).toBeLessThanOrEqual(orderBox.x + orderBox.width + 1);

  const activity = page.locator("#credit-market-activity");
  await expect(activity).toBeVisible();
  const activityTabs = activity.getByRole("tablist", {
    name: "Credit market activity",
  });
  await assertTabListContained(page, activityTabs, `${label} market-activity tabs`);
  const listings = activityTabs.getByRole("tab", { name: /Listings\s*512/u });
  const seals = activityTabs.getByRole("tab", { name: /Seals\s*505/u });
  const sales = activityTabs.getByRole("tab", { name: /Sales\s*7/u });
  await expect(listings).toHaveAttribute("aria-selected", "true");
  await assertTabControlsLabelledPanel(
    page,
    listings,
    `${label} Listings activity tab`,
  );
  await listings.focus();
  await page.keyboard.press("End");
  await expect(sales).toBeFocused();
  await expect(sales).toHaveAttribute("aria-selected", "true");
  const salesPanel = await assertTabControlsLabelledPanel(
    page,
    sales,
    `${label} Sales activity tab`,
  );
  await expect(salesPanel).toHaveAttribute(
    "aria-labelledby",
    await sales.getAttribute("id"),
  );
  await page.keyboard.press("ArrowRight");
  await expect(listings).toBeFocused();
  await expect(listings).toHaveAttribute("aria-selected", "true");
  const listingsPanel = await assertTabControlsLabelledPanel(
    page,
    listings,
    `${label} Listings activity tab after wrap`,
  );
  await expect(listingsPanel).toHaveAttribute(
    "aria-labelledby",
    await listings.getAttribute("id"),
  );
  await expect(seals).toHaveAttribute("aria-selected", "false");
  await expect(activity.locator(".token-search-count")).toHaveText("512 found");
  await expect(activity.locator(".token-market-history-preview-note")).toHaveCount(
    0,
  );
  await expect(
    activity.locator('[aria-label="Credit market listings pagination"]'),
  ).toBeVisible();
}

async function assertPopulatedAmoActivityRows(page, label) {
  const activity = page.locator("#credit-market-activity");
  const tabs = activity.getByRole("tablist", { name: "Credit market activity" });
  const listings = tabs.getByRole("tab", { name: /Listings\s*512/u });
  const seals = tabs.getByRole("tab", { name: /Seals\s*505/u });
  const sales = tabs.getByRole("tab", { name: /Sales\s*7/u });

  await listings.click();
  let panel = await assertTabControlsLabelledPanel(
    page,
    listings,
    `${label} populated Listings tab`,
  );
  let row = panel.locator(".token-market-row").first();
  await expect(row).toContainText("0.0000000749030366 WORK");
  await row.scrollIntoViewIfNeeded();
  await assertElementContainsItsLayout(row, `${label} listing history row`);
  await expect(row.getByRole("link", { name: "Listing TX" })).toHaveAttribute(
    "href",
    new RegExp(RESPONSIVE_AMO_LISTINGS[0].listingId, "u"),
  );

  await seals.click();
  panel = await assertTabControlsLabelledPanel(
    page,
    seals,
    `${label} populated Seals tab`,
  );
  row = panel.locator(".token-market-row").first();
  await expect(row).toContainText("0.0000000749030366 WORK");
  await row.scrollIntoViewIfNeeded();
  await assertElementContainsItsLayout(row, `${label} seal history row`);
  await expect(row.getByRole("link", { name: "Seal TX" })).toHaveAttribute(
    "href",
    new RegExp(RESPONSIVE_AMO_LISTINGS[0].sealTxid, "u"),
  );

  await sales.click();
  panel = await assertTabControlsLabelledPanel(
    page,
    sales,
    `${label} populated Sales tab`,
  );
  row = panel.locator(".token-market-row").first();
  await expect(row).toContainText("0.0000000749030366 WORK");
  await row.scrollIntoViewIfNeeded();
  await assertElementContainsItsLayout(row, `${label} sale history row`);
  await expect(row.getByRole("link", { name: "Sale TX" })).toHaveAttribute(
    "href",
    new RegExp(RESPONSIVE_AMO_ACTIVITY_ITEMS["market-sales"][0].txid, "u"),
  );

  const search = activity.getByRole("searchbox", { name: "Search sales" });
  await search.fill(AMO_LONG_BUYER);
  await expect(search).toHaveValue(AMO_LONG_BUYER);
  await assertLocatorWithinViewport(page, search, `${label} long address search`);
  await expect(row).toBeVisible();
  await search.fill(RESPONSIVE_AMO_ACTIVITY_ITEMS["market-sales"][0].txid);
  await expect(search).toHaveValue(
    RESPONSIVE_AMO_ACTIVITY_ITEMS["market-sales"][0].txid,
  );
  await assertLocatorWithinViewport(page, search, `${label} long txid search`);
  await expect(row).toBeVisible();
  await assertNoDocumentOverflow(page, `${label} populated history`);
}

async function assertProtocolHistoryTabs(page, label, width) {
  const tabs = page.getByRole("tablist", { name: "WORK AMO protocol view" });
  await assertTabListContained(page, tabs, `${label} protocol-history tabs`);
  const amo = tabs.getByRole("tab", { name: /^AMO\b/u });
  const v1 = tabs.getByRole("tab", { name: /Marketplace V1 Relic/u });
  await assertTabControlsLabelledPanel(page, amo, `${label} AMO protocol tab`);
  await amo.focus();
  await page.keyboard.press("End");
  await expect(v1).toBeFocused();
  await expect(v1).toHaveAttribute("aria-selected", "true");
  await assertTabControlsLabelledPanel(page, v1, `${label} V1 protocol tab`);
  await expect(
    page.getByRole("heading", { exact: true, name: "Marketplace V1 Relic" }),
  ).toBeVisible();
  await page.keyboard.press("Home");
  await expect(amo).toBeFocused();
  await expect(amo).toHaveAttribute("aria-selected", "true");
  await expect(page.getByRole("heading", { exact: true, name: "AMO Units" })).toBeVisible();

  const box = await tabs.boundingBox();
  expect(
    box.height,
    `${label} protocol-history tabs use an unexpected layout`,
  ).toBeLessThanOrEqual(width <= 620 ? 190 : 96);
}

async function assertSingleColumnProtocolTabs(page, label) {
  const tabList = page.getByRole("tablist", { name: "WORK AMO protocol view" });
  await tabList.scrollIntoViewIfNeeded();
  const tabs = tabList.getByRole("tab");
  await expect(tabs).toHaveCount(3);
  const boxes = await Promise.all(
    [0, 1, 2].map((index) => tabs.nth(index).boundingBox()),
  );
  for (let index = 0; index < boxes.length; index += 1) {
    const box = boxes[index];
    expect(box, `${label} protocol tab ${index + 1} has no geometry`).not.toBeNull();
    if (index > 0) {
      const previous = boxes[index - 1];
      expect(
        Math.abs(box.x - previous.x),
        `${label} protocol tabs are not aligned as one column`,
      ).toBeLessThanOrEqual(1);
      expect(
        box.y,
        `${label} protocol tabs overlap vertically`,
      ).toBeGreaterThanOrEqual(previous.y + previous.height - 1);
    }
  }
  await assertElementContainsItsLayout(tabList, `${label} protocol tabs`);
  await assertNoDocumentOverflow(page, label);
}

async function assertTopbarGeometry(page, label, width) {
  const topbar = page.locator(".topbar");
  const brand = topbar.locator(".brand");
  const nav = topbar.locator(".domain-nav");
  const actions = topbar.locator(".topbar-actions");
  await expect(topbar, `${label} topbar did not render`).toBeVisible();
  await expect(brand, `${label} brand did not render`).toBeVisible();
  await expect(nav, `${label} app navigation did not render`).toBeVisible();
  await expect(actions, `${label} header actions did not render`).toBeVisible();

  const [brandBox, navBox, actionsBox] = await Promise.all([
    brand.boundingBox(),
    nav.boundingBox(),
    actions.boundingBox(),
  ]);
  expect(brandBox, `${label} brand has no geometry`).not.toBeNull();
  expect(navBox, `${label} app navigation has no geometry`).not.toBeNull();
  expect(actionsBox, `${label} header actions have no geometry`).not.toBeNull();
  expect(
    brandBox.x + brandBox.width,
    `${label} brand overlaps app navigation`,
  ).toBeLessThanOrEqual(navBox.x + 1);
  expect(
    navBox.x + navBox.width,
    `${label} app navigation overlaps header actions`,
  ).toBeLessThanOrEqual(actionsBox.x + 1);
  expect(
    actionsBox.x + actionsBox.width,
    `${label} header actions escape the viewport`,
  ).toBeLessThanOrEqual(width + 1);

  const links = nav.locator(".domain-nav-links");
  const menu = nav.locator(".app-menu-trigger");
  if (width <= 1100) {
    await expect(menu, `${label} compact app menu is missing`).toBeVisible();
    await expect(
      links,
      `${label} clipped desktop links are still active`,
    ).toBeHidden();
  } else if (width <= 1799) {
    await expect(menu, `${label} compact app menu is missing`).toBeVisible();
    await expect(links, `${label} priority app links are missing`).toBeVisible();
    await expect(
      links.locator("a:visible"),
      `${label} has no priority app links`,
    ).not.toHaveCount(0);
    await assertElementContainsItsLayout(links, `${label} priority app links`);
  } else {
    await expect(menu, `${label} compact app menu did not close`).toBeHidden();
    await expect(links, `${label} desktop app links are missing`).toBeVisible();
    await assertElementContainsItsLayout(links, `${label} desktop app links`);
  }
}

async function assertWorkMetricGeometry(
  page,
  label,
  {
    minimumCardWidth = 0,
    selector = ".marketplace-work-floor-card .token-floor-stats",
  } = {},
) {
  const stats = page.locator(selector);
  await expect(stats, `${label} WORK metrics did not render`).toBeVisible();
  await assertElementContainsItsLayout(stats, `${label} WORK metrics`);

  const cards = stats.locator(":scope > div");
  const cardCount = await cards.count();
  expect(cardCount, `${label} WORK metrics are empty`).toBeGreaterThan(0);
  const statsBox = await stats.boundingBox();
  expect(statsBox, `${label} WORK metrics have no geometry`).not.toBeNull();

  for (let index = 0; index < cardCount; index += 1) {
    const card = cards.nth(index);
    const value = card.locator(".proof-metric-display, strong").first();
    const [cardBox, valueBox] = await Promise.all([
      card.boundingBox(),
      value.boundingBox(),
    ]);
    expect(cardBox, `${label} metric card ${index + 1} has no geometry`).not.toBeNull();
    expect(valueBox, `${label} metric value ${index + 1} has no geometry`).not.toBeNull();
    expect(
      cardBox.x + cardBox.width,
      `${label} metric card ${index + 1} escapes the metric grid`,
    ).toBeLessThanOrEqual(statsBox.x + statsBox.width + 1);
    expect(
      valueBox.x + valueBox.width,
      `${label} metric value ${index + 1} escapes its card`,
    ).toBeLessThanOrEqual(cardBox.x + cardBox.width + 1);
    if (minimumCardWidth > 0) {
      expect(
        cardBox.width,
        `${label} metric card ${index + 1} is too narrow for exact values`,
      ).toBeGreaterThanOrEqual(minimumCardWidth);
    }
    const wrapping = await value.evaluate((element) => {
      const style = getComputedStyle(element);
      return {
        overflowWrap: style.overflowWrap,
        wordBreak: style.wordBreak,
      };
    });
    expect(
      wrapping.overflowWrap,
      `${label} metric value ${index + 1} permits arbitrary digit breaks`,
    ).toBe("normal");
    expect(
      wrapping.wordBreak,
      `${label} metric value ${index + 1} permits broken words`,
    ).toBe("normal");
    await assertElementContainsItsLayout(
      card,
      `${label} metric card ${index + 1}`,
    );
    await assertElementContainsItsLayout(
      value,
      `${label} metric value ${index + 1}`,
      { allowHorizontalScroll: true },
    );
  }
}

async function assertComputerWorkspace(page, label, width) {
  await assertTopbarGeometry(page, label, width);
  const layout = page.locator(".mail-layout");
  await expect(layout, `${label} Computer shell did not render`).toBeVisible();
  const workspace = layout.locator(":scope > :not(.sidebar)");
  await expect(workspace, `${label} workspace did not render`).toHaveCount(1);
  await expect(workspace).toBeVisible();

  const [box, viewport] = await Promise.all([
    workspace.boundingBox(),
    page.evaluate(() => ({ height: window.innerHeight, width: window.innerWidth })),
  ]);
  expect(box, `${label} workspace has no geometry`).not.toBeNull();
  expect(box.x, `${label} workspace starts outside the viewport`).toBeLessThan(
    viewport.width,
  );
  expect(
    box.x + box.width,
    `${label} workspace extends beyond the viewport`,
  ).toBeLessThanOrEqual(viewport.width + 1);
  expect(box.width, `${label} workspace collapsed`).toBeGreaterThan(
    Math.min(320, viewport.width * 0.4),
  );
  await assertElementContainsItsLayout(workspace, `${label} workspace`);
  await assertNoDocumentOverflow(page, label);
}

async function openFixtureRoute(page, href, label) {
  await page.goto(href, { waitUntil: "domcontentloaded" });
  await expect(page.locator("#root"), `${label} root did not render`).not.toBeEmpty();
}

async function assertMarketplaceGeometry(page, mode, width) {
  const label = `AMO WORK ${mode} at ${width}px`;
  await assertTopbarGeometry(page, label, width);
  const tabs = page.getByRole("tablist", { name: "WORK AMO protocol view" });
  await expect(tabs, `${label} version controls did not render`).toBeVisible();

  if (mode === "V1") {
    await tabs.getByRole("tab", { name: /Marketplace V1 Relic/ }).click();
  } else if (mode === "V4") {
    await tabs.getByRole("tab", { name: /Pre-V8 Relics/ }).click();
  }

  const panelHeading =
    mode === "V1"
      ? "Marketplace V1 Relic"
      : mode === "V4"
        ? "Pre-V8 AMO Relics"
        : "AMO Units";
  const panel = page
    .getByRole("heading", { exact: true, name: panelHeading })
    .locator("xpath=ancestor::section[1]");
  await expect(panel, `${label} panel did not render`).toBeVisible();
  if (mode === "AMO") {
    await expect(
      panel,
      `${label} must describe the singleton proof-native V8 face`,
    ).toContainText("single 25,000-proof face");
    await expect(
      panel,
      `${label} must not describe the retired USD attestor`,
    ).not.toContainText("signed multi-source USD");
  }

  const [tabsBox, panelBox] = await Promise.all([
    tabs.boundingBox(),
    panel.boundingBox(),
  ]);
  expect(tabsBox, `${label} tabs have no geometry`).not.toBeNull();
  expect(panelBox, `${label} panel has no geometry`).not.toBeNull();
  expect(tabsBox.height, `${label} tabs stretched unexpectedly`).toBeLessThanOrEqual(
    width <= 620 ? 190 : 96,
  );
  expect(
    panelBox.y,
    `${label} panel is beside/behind its version controls`,
  ).toBeGreaterThanOrEqual(tabsBox.y + tabsBox.height - 1);

  await assertElementContainsItsLayout(tabs, `${label} version controls`);
  await assertElementContainsItsLayout(panel, `${label} panel`);
  await assertElementContainsItsLayout(
    page.locator(".token-market-content"),
    `${label} marketplace grid`,
  );
  await assertNoDocumentOverflow(page, label);

  if (width >= 1181) {
    await assertWorkMetricGeometry(page, label);
  }

  if (mode === "V1") {
    await expect(
      panel.locator(".token-market-row"),
      `${label} must render one 25-row page rather than all 94 relics`,
    ).toHaveCount(25);
    await expect(
      panel.locator('[aria-label="Marketplace V1 relic pagination"]'),
    ).toContainText("1-25 of 94");
  }
}

test("mobile navigation, exact metrics, counted AMO tabs, status, and sort remain contained", async ({
  page,
}) => {
  test.setTimeout(420_000);
  await installApiFixtures(page, { countedAmo: true });
  for (const width of MOBILE_VIEWPORT_WIDTHS) {
    await test.step(`${width}px`, async () => {
      const label = `mobile AMO controls at ${width}px`;
      await page.setViewportSize({ height: VIEWPORT_HEIGHT, width });
      await openFixtureRoute(
        page,
        surfaceUrl(
          MARKETPLACE_BASE_URL,
          `/?marketplace=1&asset=${WORK_TOKEN_ID}`,
        ),
        label,
      );
      await page.getByRole("button", { name: "Refresh" }).first().click();
      await expect(page.locator(".app-status-row").first()).toContainText(
        "Credit market loaded",
      );
      await assertTopbarGeometry(page, label, width);
      await assertMobileDomainNav(page, label);
      await assertExpandableStatus(page, label);
      await assertMarketplaceWorkExactMetrics(page, label);
      await assertWorkMetricGeometry(page, label);
      await assertProtocolHistoryTabs(page, label, width);
      await assertCountedAmoControls(page, label);
      await assertNoDocumentOverflow(page, label);
    });
  }
});

test("AMO history exposes authoritative totals and rejects incomplete or mismatched previews", async ({
  page,
}) => {
  const href = surfaceUrl(
    MARKETPLACE_BASE_URL,
    `/?marketplace=1&asset=${WORK_TOKEN_ID}`,
  );
  await page.setViewportSize({ height: VIEWPORT_HEIGHT, width: 390 });
  await installApiFixtures(page, { countedAmo: true });
  await openFixtureRoute(page, href, "authoritative AMO activity");
  await expect(
    page.locator(
      '.marketplace-summary-read-state[aria-label="AMO summary verification"]',
    ),
  ).toHaveAttribute("data-state", "ready", { timeout: 60_000 });

  let activity = page.locator("#credit-market-activity");
  await expect(
    activity.getByRole("tab", { name: /Listings\s*512/u }),
  ).toHaveAttribute("aria-selected", "true");
  await expect(activity.locator(".token-search-count")).toHaveText("512 found");
  await expect(activity.locator(".token-market-history-preview-note")).toHaveCount(
    0,
  );
  await expect(
    activity.locator('[aria-label="Credit market listings pagination"]'),
  ).toBeVisible();
  await assertPopulatedAmoActivityRows(page, "authoritative AMO activity at 390px");

  await page.unroute("**/api/v1/**");
  await installApiFixtures(page, {
    activityHistoryMode: "preview",
    countedAmo: true,
  });
  await openFixtureRoute(page, href, "incomplete AMO activity preview");

  activity = page.locator("#credit-market-activity");
  const listings = activity.getByRole("tab", { name: /Listings\s*…/u });
  await expect(listings).toHaveAttribute("aria-selected", "true");
  await expect(activity.locator(".token-search-count")).toHaveText(
    "1 visible · incomplete",
  );
  await expect(activity.locator(".token-market-history-preview-note")).toContainText(
    "totals and absence claims are withheld",
  );
  await expect(
    activity.locator('[aria-label="Credit market listings pagination"]'),
  ).toHaveCount(0);
  await expect(
    activity.getByRole("heading", { name: "No listings yet" }),
  ).toHaveCount(0);

  await activity.getByRole("tab", { name: /Sales\s*…/u }).click();
  await expect(
    activity.getByRole("heading", { name: "Full sales history unavailable" }),
  ).toBeVisible();
  await expect(activity).toContainText(
    "A partial current-state preview cannot establish that no history exists.",
  );
  await expect(
    activity.locator('[aria-label="Credit market sales pagination"]'),
  ).toHaveCount(0);
  await expect(activity.getByRole("heading", { name: "No sales yet" })).toHaveCount(
    0,
  );

  await page.unroute("**/api/v1/**");
  await installApiFixtures(page, {
    activityHistoryMode: "mismatched-kind",
    countedAmo: true,
  });
  await openFixtureRoute(page, href, "mismatched-kind AMO activity preview");

  activity = page.locator("#credit-market-activity");
  await expect(
    activity.getByRole("tab", { name: /Listings\s*…/u }),
  ).toHaveAttribute("aria-selected", "true");
  await expect(activity.locator(".token-search-count")).toHaveText(
    "1 visible · incomplete",
  );
  await expect(activity.locator(".token-market-history-preview-note")).toContainText(
    "totals and absence claims are withheld",
  );
  await expect(activity).not.toContainText("999 found");
  await expect(
    activity.locator('[aria-label="Credit market listings pagination"]'),
  ).toHaveCount(0);
});

test("AMO 503 responses become unavailable without false zero totals or endless loading", async ({
  page,
}) => {
  test.setTimeout(180_000);
  let marketplaceSummaryMode = "unavailable";
  const marketplaceSummaryRequests = [];
  await installApiFixtures(page, {
    countedAmo: true,
    marketplaceSummaryMode: (url) => {
      marketplaceSummaryRequests.push(url.href);
      return marketplaceSummaryMode;
    },
  });
  await page.setViewportSize({ height: VIEWPORT_HEIGHT, width: 390 });
  const surfaces = [
    {
      baseUrl: MARKETPLACE_BASE_URL,
      label: "standalone AMO",
      path: `/?marketplace=1&asset=${WORK_TOKEN_ID}`,
      ready: ".marketplace-app",
      stats: ".id-launch-hero .id-launch-stats",
    },
    {
      baseUrl: COMPUTER_BASE_URL,
      label: "Computer AMO",
      path: `/?folder=marketplace&asset=${WORK_TOKEN_ID}`,
      ready: ".mail-layout.is-marketplace-workspace",
      stats: "",
    },
  ];

  for (const surface of surfaces) {
    await test.step(surface.label, async () => {
      marketplaceSummaryMode = "unavailable";
      const requestCountBeforeUnavailable = marketplaceSummaryRequests.length;
      await openFixtureRoute(
        page,
        surfaceUrl(surface.baseUrl, surface.path),
        `${surface.label} unavailable summary`,
      );
      const verification = page
        .locator(`${surface.ready} .marketplace-summary-read-state`)
        .first();
      await expect(verification).toHaveAttribute("data-state", "unavailable", {
        timeout: 60_000,
      });
      await expect(verification).toContainText("Unavailable");
      await expect(
        page.getByRole("heading", { name: "AMO summary unavailable" }),
      ).toBeVisible();
      await expect(
        page.getByRole("heading", { name: "Loading AMO summary" }),
      ).toHaveCount(0);

      if (surface.stats) {
        const metrics = page.locator(`${surface.ready} ${surface.stats} strong`);
        await expect(metrics.first()).toHaveText("—");
        const renderedMetrics = await metrics.allTextContents();
        expect(renderedMetrics.length).toBeGreaterThan(0);
        expect(
          renderedMetrics.every((value) => value.trim() === "—"),
          `${surface.label} exposed an unverified numeric AMO total: ${JSON.stringify(renderedMetrics)}`,
        ).toBe(true);
      } else {
        await expect(
          page.locator(`${surface.ready} .marketplace-workspace-stats`),
        ).toHaveCount(0);
      }

      const tabs = page.getByLabel("AMO asset tabs");
      for (const label of ["IDs", "Credits", "Bonds"]) {
        await expect(
          tabs.getByRole("button", {
            name: new RegExp(`^${label}\\s+—$`, "u"),
          }),
        ).toBeVisible();
      }

      expect(marketplaceSummaryRequests.length).toBeGreaterThan(
        requestCountBeforeUnavailable,
      );
      const unavailableRequestUrl = new URL(
        marketplaceSummaryRequests.at(-1),
      );
      expect(unavailableRequestUrl.origin).toBe(new URL(page.url()).origin);

      const requestCountBeforeRetry = marketplaceSummaryRequests.length;
      const retry = verification.getByRole("button", { name: "Retry" });
      await expect(retry).toBeVisible();
      await expect(retry).toBeEnabled();
      const retryClick = retry.evaluate((button) => button.click());
      marketplaceSummaryMode = "ready";
      await retryClick;
      await expect(verification).toHaveAttribute("data-state", "ready", {
        timeout: 60_000,
      });
      await expect(verification).toContainText("Ready");
      expect(marketplaceSummaryRequests.length).toBeGreaterThan(
        requestCountBeforeRetry,
      );
      const retryRequestUrl = new URL(marketplaceSummaryRequests.at(-1));
      expect(retryRequestUrl.origin).toBe(new URL(page.url()).origin);
      await expect(
        page.locator(`${surface.ready} [aria-label="WORK credit AMO stats"]`),
      ).toContainText(AMO_LISTING_COUNT.toLocaleString());
      await expect(
        page.getByRole("heading", { name: "AMO summary unavailable" }),
      ).toHaveCount(0);
      await assertNoDocumentOverflow(
        page,
        `${surface.label} recovered summary`,
      );
    });
  }
});

test("AMO rejects an unknown asset route without falling back to global zero or history views", async ({
  page,
}) => {
  test.setTimeout(180_000);
  const marketplaceSummaryRequests = [];
  const historyRequests = [];
  page.on("request", (request) => {
    const requestUrl = new URL(request.url());
    if (
      requestUrl.pathname === "/api/v1/token-history" &&
      ["market-listings", "market-seals", "market-sales"].includes(
        requestUrl.searchParams.get("kind"),
      )
    ) {
      historyRequests.push(requestUrl.href);
    }
  });
  await installApiFixtures(page, {
    countedAmo: true,
    marketplaceSummaryMode: (url) => {
      marketplaceSummaryRequests.push(url.href);
      return "ready";
    },
  });
  await page.setViewportSize({ height: VIEWPORT_HEIGHT, width: 390 });
  const surfaces = [
    {
      baseUrl: MARKETPLACE_BASE_URL,
      label: "standalone AMO",
      path: `/?marketplace=1&asset=${MISTYPED_WORK_TOKEN_ID}&ticker=WORK`,
      ready: ".marketplace-app",
      routeParam: "marketplace",
      routeValue: "1",
    },
    {
      baseUrl: COMPUTER_BASE_URL,
      label: "Computer AMO",
      path: `/?folder=marketplace&asset=${MISTYPED_WORK_TOKEN_ID}&ticker=WORK`,
      ready: ".mail-layout.is-marketplace-workspace",
      routeParam: "folder",
      routeValue: "marketplace",
    },
  ];

  for (const surface of surfaces) {
    await test.step(surface.label, async () => {
      historyRequests.length = 0;
      const summaryRequestCount = marketplaceSummaryRequests.length;
      await openFixtureRoute(
        page,
        surfaceUrl(surface.baseUrl, surface.path),
        `${surface.label} unknown asset route`,
      );
      const app = page.locator(surface.ready);
      const summaryState = app
        .locator('.marketplace-summary-read-state[aria-label="AMO summary verification"]')
        .first();
      await expect(summaryState).toHaveAttribute("data-state", "ready", {
        timeout: 60_000,
      });

      const assetState = app.getByLabel("Requested credit availability");
      await expect(assetState).toHaveAttribute("data-state", "unavailable");
      await expect(assetState).toContainText("Requested credit unavailable");
      await expect(assetState).toContainText(MISTYPED_WORK_TOKEN_ID);
      await expect(
        assetState.locator(".token-market-route-target"),
      ).toHaveCSS("white-space", "nowrap");
      await expect(
        assetState.locator(".token-market-route-target"),
      ).toHaveCSS("overflow-x", "auto");
      await expect(
        app.locator(
          '[aria-label="WORK credit AMO stats"], [aria-label="Credit AMO stats"]',
        ),
      ).toHaveCount(0);
      await expect(
        app.getByRole("heading", { name: "WORK AMO State" }),
      ).toHaveCount(0);
      await expect(
        app.getByRole("heading", { name: "Credit Market Activity" }),
      ).toHaveCount(0);
      expect(new URL(page.url()).searchParams.get("asset")).toBe(
        MISTYPED_WORK_TOKEN_ID,
      );
      expect(historyRequests).toEqual([]);
      expect(marketplaceSummaryRequests.length).toBeGreaterThan(
        summaryRequestCount,
      );
      for (const requestUrl of marketplaceSummaryRequests.slice(
        summaryRequestCount,
      )) {
        expect(new URL(requestUrl).searchParams.has("asset")).toBe(false);
      }
      await assertNoDocumentOverflow(page, `${surface.label} unknown asset route`);

      await assetState.getByRole("button", { name: "View all credits" }).click();
      await expect
        .poll(() => new URL(page.url()).searchParams.get("asset"))
        .toBeNull();
      expect(new URL(page.url()).searchParams.get("ticker")).toBeNull();
      expect(new URL(page.url()).searchParams.get(surface.routeParam)).toBe(
        surface.routeValue,
      );
      const directoryHeading = app.getByRole("heading", {
        name: "Credit Markets",
      });
      await expect(directoryHeading).toBeVisible();
      await expect(directoryHeading).toBeFocused();
      await expect(assetState).toHaveCount(0);
      await assertNoDocumentOverflow(page, `${surface.label} all credits route`);

      const uppercaseRoute = new URLSearchParams({
        [surface.routeParam]: surface.routeValue,
        asset: WORK_TOKEN_ID.toUpperCase(),
      });
      await openFixtureRoute(
        page,
        surfaceUrl(surface.baseUrl, `/?${uppercaseRoute.toString()}`),
        `${surface.label} uppercase canonical asset route`,
      );
      await expect(
        app
          .locator(
            '.marketplace-summary-read-state[aria-label="AMO summary verification"]',
          )
          .first(),
      ).toHaveAttribute("data-state", "ready", { timeout: 60_000 });
      await expect(assetState).toHaveCount(0);
      await expect(
        app.getByRole("heading", { name: "WORK AMO State" }),
      ).toBeVisible();
      expect(new URL(page.url()).searchParams.get("asset")).toBe(
        WORK_TOKEN_ID.toUpperCase(),
      );
      await assertNoDocumentOverflow(
        page,
        `${surface.label} uppercase canonical asset route`,
      );

      for (const malformedTarget of [
        MALFORMED_WORK_PREFIX_ASSET,
        MALFORMED_POWB_PREFIX_ASSET,
        MALFORMED_INCB_PREFIX_ASSET,
      ]) {
        const malformedRoute = new URLSearchParams({
          [surface.routeParam]: surface.routeValue,
          asset: malformedTarget,
        });
        await openFixtureRoute(
          page,
          surfaceUrl(surface.baseUrl, `/?${malformedRoute.toString()}`),
          `${surface.label} malformed ticker-prefix asset route`,
        );
        await expect(
          app
            .locator(
              '.marketplace-summary-read-state[aria-label="AMO summary verification"]',
            )
            .first(),
        ).toHaveAttribute("data-state", "ready", { timeout: 60_000 });
        await expect(assetState).toHaveAttribute("data-state", "unavailable");
        await expect(assetState).toContainText(malformedTarget);
        await expect(
          app.getByRole("heading", { name: "WORK AMO State" }),
        ).toHaveCount(0);
        await expect(
          app.getByRole("heading", { name: "Bond Listings" }),
        ).toHaveCount(0);
        await assertNoDocumentOverflow(
          page,
          `${surface.label} malformed ticker-prefix asset route`,
        );
      }

      for (const bondRoute of [
        { id: POWB_TOKEN_ID.toUpperCase(), tab: "Infinity" },
        { id: INCB_TOKEN_ID.toUpperCase(), tab: "Inception" },
      ]) {
        const bondQuery = new URLSearchParams({
          [surface.routeParam]: surface.routeValue,
          asset: bondRoute.id,
        });
        await openFixtureRoute(
          page,
          surfaceUrl(surface.baseUrl, `/?${bondQuery.toString()}`),
          `${surface.label} uppercase ${bondRoute.tab} bond route`,
        );
        await expect(
          app.getByRole("heading", { name: "Bond Listings" }),
        ).toBeVisible();
        await expect(
          app
            .getByLabel("Bond listing tabs")
            .getByRole("button", { name: new RegExp(bondRoute.tab, "u") }),
        ).toHaveAttribute("aria-pressed", "true");
        expect(new URL(page.url()).searchParams.get("asset")).toBe(
          bondRoute.id,
        );
        await assertNoDocumentOverflow(
          page,
          `${surface.label} uppercase ${bondRoute.tab} bond route`,
        );
      }
    });
  }
});

test("AMO summary moves from loading to ready without presenting placeholder zeros", async ({
  page,
}) => {
  test.setTimeout(180_000);
  let releaseMarketplaceSummary = () => {};
  const marketplaceSummaryGate = new Promise((resolve) => {
    releaseMarketplaceSummary = resolve;
  });
  await installApiFixtures(page, { marketplaceSummaryGate });
  await page.setViewportSize({ height: VIEWPORT_HEIGHT, width: 390 });
  await openFixtureRoute(
    page,
    surfaceUrl(
      MARKETPLACE_BASE_URL,
      `/?marketplace=1&asset=${WORK_TOKEN_ID}`,
    ),
    "AMO loading and ready states",
  );

  const verification = page.locator(".marketplace-summary-read-state").first();
  await expect(verification).toHaveAttribute("data-state", "loading", {
    timeout: 60_000,
  });
  const loadingMetrics = page.locator(".id-launch-hero .id-launch-stats strong");
  await expect(loadingMetrics.first()).toHaveText("—");

  releaseMarketplaceSummary();
  await expect(verification).toHaveAttribute("data-state", "ready", {
    timeout: 60_000,
  });
  await expect(verification).toContainText("Ready");
  await expect(loadingMetrics.first()).not.toHaveText("—");
});

test("AMO retains labeled last-verified totals when an exact-tip refresh returns 503", async ({
  page,
}) => {
  test.setTimeout(180_000);
  await installApiFixtures(page, {
    countedAmo: true,
    marketplaceSummaryMode: "fresh-unavailable",
  });
  await page.setViewportSize({ height: VIEWPORT_HEIGHT, width: 390 });
  const surfaces = [
    {
      baseUrl: MARKETPLACE_BASE_URL,
      label: "standalone AMO",
      path: `/?marketplace=1&asset=${WORK_TOKEN_ID}`,
      ready: ".marketplace-app",
    },
    {
      baseUrl: COMPUTER_BASE_URL,
      label: "Computer AMO",
      path: `/?folder=marketplace&asset=${WORK_TOKEN_ID}`,
      ready: ".mail-layout.is-marketplace-workspace",
    },
  ];

  for (const surface of surfaces) {
    await test.step(surface.label, async () => {
      await openFixtureRoute(
        page,
        surfaceUrl(surface.baseUrl, surface.path),
        `${surface.label} last verified summary`,
      );
      const verification = page
        .locator(`${surface.ready} .marketplace-summary-read-state`)
        .first();
      await page.getByRole("button", { name: "Refresh" }).first().click();
      await expect(verification).toHaveAttribute(
        "data-state",
        "last-verified",
        { timeout: 60_000 },
      );
      await expect(verification).toContainText("Last Verified");
      await expect(verification).toContainText("20 blocks behind");
      await expect(
        page.locator(`${surface.ready} [aria-label="WORK credit AMO stats"]`),
      ).toContainText(AMO_LISTING_COUNT.toLocaleString());
      await expect(
        page.locator(`${surface.ready} .marketplace-summary-gate`),
      ).toHaveCount(0);
      await verification.getByRole("button", { name: "Retry" }).click();
      await expect(verification).toHaveAttribute(
        "data-state",
        "last-verified",
      );
      await expect(
        page.locator(`${surface.ready} [aria-label="WORK credit AMO stats"]`),
      ).toContainText(AMO_LISTING_COUNT.toLocaleString());
      await assertNoDocumentOverflow(
        page,
        `${surface.label} last verified summary`,
      );
    });
  }
});

test("AMO retains one atomic last-verified snapshot when a canonical lane regresses", async ({
  page,
}) => {
  test.setTimeout(180_000);
  const firstRecord = {
    amountSats: 1_000,
    confirmed: true,
    createdAt: NOW,
    id: "atomic-one",
    network: "livenet",
    ownerAddress: AMO_SELLER,
    receiveAddress: AMO_SELLER,
    txid: fixtureTxid(40_000),
  };
  const secondRecord = {
    ...firstRecord,
    id: "atomic-two",
    txid: fixtureTxid(40_001),
  };
  let serveMixedLaneRegression = false;
  await installApiFixtures(page, {
    marketplaceSummaryTransform: (summary, url) => {
      const verifiedSummary = {
        ...summary,
        registry: {
          ...summary.registry,
          records: [firstRecord],
        },
      };
      if (
        !serveMixedLaneRegression ||
        url.searchParams.get("fresh") !== "1"
      ) {
        return verifiedSummary;
      }
      return {
        ...verifiedSummary,
        indexedAt: "2026-07-22T13:00:00.000Z",
        registry: {
          ...verifiedSummary.registry,
          records: [firstRecord, secondRecord],
        },
        token: {
          ...verifiedSummary.token,
          tokens: verifiedSummary.token.tokens.slice(0, 2),
        },
      };
    },
  });
  await page.setViewportSize({ height: VIEWPORT_HEIGHT, width: 390 });
  await openFixtureRoute(
    page,
    surfaceUrl(
      MARKETPLACE_BASE_URL,
      `/?marketplace=1&asset=${WORK_TOKEN_ID}`,
    ),
    "atomic AMO summary retention",
  );

  const verification = page.locator(".marketplace-summary-read-state").first();
  await expect(verification).toHaveAttribute("data-state", "ready", {
    timeout: 60_000,
  });
  const verifiedText = await verification.locator("div span").innerText();
  const verifiedAt = verifiedText.match(/Verified .+\.$/u)?.[0];
  expect(verifiedAt).toBeTruthy();

  await page
    .getByLabel("AMO asset tabs")
    .getByRole("button", { name: /^IDs\s+0$/u })
    .click();
  const totalIds = page.locator('[aria-label="ID AMO stats"] strong').first();
  await expect(totalIds).toHaveText("1");

  serveMixedLaneRegression = true;
  await page.getByRole("button", { name: "Refresh" }).first().click();
  await expect(verification).toHaveAttribute("data-state", "last-verified", {
    timeout: 60_000,
  });
  await expect(verification).toContainText("Last Verified");
  await expect(verification).toContainText(
    "could not replace every verified lane without regression",
  );
  await expect(verification).toContainText(verifiedAt);
  await expect(totalIds).toHaveText("1");
  await expect(page.locator(".marketplace-summary-gate")).toHaveCount(0);
  await assertNoDocumentOverflow(page, "atomic AMO summary retention");
});

test("Computer mobile More opens a viewport-bound modal and restores focus", async ({
  page,
}) => {
  await installApiFixtures(page);
  await page.setViewportSize({ height: VIEWPORT_HEIGHT, width: 390 });
  await openFixtureRoute(
    page,
    surfaceUrl(COMPUTER_BASE_URL, "/?folder=inbox"),
    "Computer mobile navigation",
  );
  await expect(page.locator(".computer-mobile-nav")).toBeVisible();
  await assertComputerMoreSheet(page, "Computer mobile navigation");
  await assertNoDocumentOverflow(page, "Computer mobile navigation after close");
});

test("Boost tools drawer closes and unlocks scrolling above its mobile breakpoint", async ({
  page,
}) => {
  await installApiFixtures(page, { boostItems: [BOOST_FIXTURE_ITEM] });
  await page.setViewportSize({ height: VIEWPORT_HEIGHT, width: 390 });
  await openFixtureRoute(
    page,
    surfaceUrl(COMPUTER_BASE_URL || MARKETPLACE_BASE_URL, "/?boost=1"),
    "Boost tools resize",
  );
  await expect(page.locator(".boost-public-app")).toBeVisible();
  await assertBoostDrawerResizeCleanup(page, "Boost tools resize");
  await assertNoDocumentOverflow(page, "Boost tools after desktop resize");

  await page.setViewportSize({ height: VIEWPORT_HEIGHT, width: 390 });
  const reply = page.getByTitle("Reply with 546-proof Boost action");
  await expect(reply, "Boost fixture Reply action is missing").toBeVisible();
  await reply.focus();
  await page.keyboard.press("Enter");
  const dialog = page.getByRole("dialog", { name: "Boost tools" });
  await expect(dialog, "Reply did not open compact Boost tools").toBeVisible();
  await expect
    .poll(() =>
      dialog.evaluate((element) => element.contains(document.activeElement)),
    )
    .toBe(true);
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  await expect(reply, "Boost tools did not return focus to Reply").toBeFocused();
  await expect
    .poll(() => page.evaluate(() => document.body.style.overflow))
    .not.toBe("hidden");
});

test("representative Home, Computer, AMO, and Boost routes pass structural accessibility smoke checks", async ({
  page,
}) => {
  await installApiFixtures(page);
  await page.setViewportSize({ height: VIEWPORT_HEIGHT, width: 390 });
  const baseUrl = COMPUTER_BASE_URL || MARKETPLACE_BASE_URL;
  for (const surface of REPRESENTATIVE_ACCESSIBILITY_ROUTES) {
    await test.step(surface.label, async () => {
      await openFixtureRoute(
        page,
        surfaceUrl(baseUrl, surface.path),
        `${surface.label} accessibility`,
      );
      await expect(page.locator(surface.ready).first()).toBeVisible();
      await assertSkipLink(page, surface.label);
      await assertStructuralAccessibility(page, surface.label);
      await assertOperableTargetGeometry(page, `${surface.label} mobile`);
      if (surface.label === "AMO") {
        await assertProgressbarSemantics(page, surface.label);
      }
      await assertNoDocumentOverflow(page, `${surface.label} accessibility`);
    });
  }
});

test("embedded Computer workspaces preserve 44px operable targets on mobile", async ({
  page,
}) => {
  await installApiFixtures(page, { boostItems: [BOOST_FIXTURE_ITEM] });
  await page.setViewportSize({ height: VIEWPORT_HEIGHT, width: 390 });
  for (const surface of REPRESENTATIVE_EMBEDDED_ROUTES) {
    await test.step(surface.label, async () => {
      await openFixtureRoute(
        page,
        surfaceUrl(COMPUTER_BASE_URL, surface.path),
        `${surface.label} target geometry`,
      );
      await expect(page.locator(surface.ready).first()).toBeVisible();
      await assertOperableTargetGeometry(page, `${surface.label} embedded mobile`);
      await assertNoDocumentOverflow(page, `${surface.label} embedded mobile`);
    });
  }
});

test("representative Proof Instrument colors meet WCAG text and non-text contrast contracts", async ({
  page,
}) => {
  await installApiFixtures(page, { countedAmo: true });
  await page.setViewportSize({ height: VIEWPORT_HEIGHT, width: 390 });
  const surfaces = [
    {
      label: "AMO",
      path: `/?marketplace=1&asset=${WORK_TOKEN_ID}`,
      ready: ".marketplace-app",
    },
    {
      label: "Computer AMO",
      path: `/?folder=marketplace&asset=${WORK_TOKEN_ID}`,
      ready: ".mail-layout.is-marketplace-workspace",
    },
  ];
  for (const surface of surfaces) {
    await test.step(surface.label, async () => {
      await openFixtureRoute(
        page,
        surfaceUrl(COMPUTER_BASE_URL || MARKETPLACE_BASE_URL, surface.path),
        `${surface.label} contrast`,
      );
      await expect(page.locator(surface.ready).first()).toBeVisible();
      await assertRepresentativeContrast(page, `${surface.label} mobile`);
    });
  }
});

test("representative routes reflow at 200% text and honor reduced motion", async ({
  page,
}) => {
  await installApiFixtures(page);
  await page.setViewportSize({ height: VIEWPORT_HEIGHT, width: 1280 });
  await page.emulateMedia({ reducedMotion: "reduce" });
  const baseUrl = COMPUTER_BASE_URL || MARKETPLACE_BASE_URL;
  for (const surface of REPRESENTATIVE_ACCESSIBILITY_ROUTES) {
    await test.step(surface.label, async () => {
      await openFixtureRoute(
        page,
        surfaceUrl(baseUrl, surface.path),
        `${surface.label} text reflow`,
      );
      await expect(page.locator(surface.ready).first()).toBeVisible();
      await assertReducedMotion(page, surface.label);
      await assertTwoHundredPercentTextReflow(page, surface.label);
    });
  }
});

test("representative mobile routes match deterministic visual snapshots", async ({
  page,
}) => {
  test.setTimeout(180_000);
  await installApiFixtures(page);
  await page.setViewportSize({ height: 844, width: 390 });
  await page.emulateMedia({ colorScheme: "dark", reducedMotion: "reduce" });
  const baseUrl = COMPUTER_BASE_URL || MARKETPLACE_BASE_URL;
  for (const surface of REPRESENTATIVE_ACCESSIBILITY_ROUTES) {
    await test.step(surface.label, async () => {
      await openFixtureRoute(
        page,
        surfaceUrl(baseUrl, surface.path),
        `${surface.label} visual snapshot`,
      );
      await expect(page.locator(surface.ready).first()).toBeVisible();
      if (surface.label === "AMO") {
        await expect(
          page.locator(".marketplace-summary-read-state").first(),
        ).toHaveAttribute("data-state", "ready", { timeout: 30_000 });
      }
      await page.evaluate(async () => {
        await document.fonts.ready;
      });
      await expect(page).toHaveScreenshot(
        `proof-instrument-${surface.label.toLowerCase()}-390.png`,
        {
          animations: "disabled",
          caret: "hide",
          fullPage: false,
          mask: [page.locator("iframe, video")],
          maxDiffPixelRatio: 0.005,
        },
      );
    });
  }
});

for (const mode of ["AMO", "V4", "V1"]) {
  test(`standalone AMO WORK ${mode} geometry matrix`, async ({ page }) => {
    test.setTimeout(300_000);
    await installApiFixtures(page);
    for (const width of VIEWPORT_WIDTHS) {
      await test.step(`${width}px`, async () => {
        await page.setViewportSize({ height: VIEWPORT_HEIGHT, width });
        await openFixtureRoute(
          page,
          surfaceUrl(
            MARKETPLACE_BASE_URL,
            `/?marketplace=1&asset=${WORK_TOKEN_ID}`,
          ),
          `AMO WORK ${mode}`,
        );
        await assertMarketplaceGeometry(page, mode, width);
      });
    }
  });
}

const COMPUTER_ROUTES = [
  {
    folder: "marketplace",
    path: `/?folder=marketplace&asset=${WORK_TOKEN_ID}`,
  },
  { folder: "token", path: "/?folder=token" },
  { folder: "wallet", path: "/?folder=wallet" },
  { folder: "work", path: "/?folder=work" },
  { folder: "infinity", path: "/?folder=infinity" },
  { folder: "inception", path: "/?folder=inception" },
  { folder: "browser", path: "/?folder=browser" },
  { folder: "ids", path: "/?folder=ids" },
];

for (const route of COMPUTER_ROUTES) {
  test(`Computer ${route.folder} responsive boundary matrix`, async ({ page }) => {
    test.setTimeout(300_000);
    await installApiFixtures(page);
    for (const width of VIEWPORT_WIDTHS) {
      await test.step(`${width}px`, async () => {
        await page.setViewportSize({ height: VIEWPORT_HEIGHT, width });
        await openFixtureRoute(
          page,
          surfaceUrl(COMPUTER_BASE_URL, route.path),
          `Computer ${route.folder}`,
        );
        await assertComputerWorkspace(
          page,
          `Computer ${route.folder} at ${width}px`,
          width,
        );
        if (route.folder === "marketplace" && width === 390) {
          await assertSingleColumnProtocolTabs(
            page,
            "Computer AMO protocol tabs at 390px",
          );
        }
        if (route.folder === "work") {
          await assertWorkMetricGeometry(
            page,
            `Computer WORK floor at ${width}px`,
            {
              minimumCardWidth: width <= 620 ? 0 : 280,
              selector: ".work-floor-metrics-card .token-floor-stats",
            },
          );
          if (width <= 620 || width === 1024) {
            await assertComputerWorkExactMetrics(
              page,
              `Computer WORK floor at ${width}px`,
            );
          }
        }
      });
    }
  });
}
