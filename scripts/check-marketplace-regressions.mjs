#!/usr/bin/env node

const API_BASE = (
  process.env.POW_API_BASE ||
  process.env.VITE_POW_API_BASE ||
  "http://127.0.0.1:8081"
).replace(/\/+$/u, "");

const WORK_TOKEN_ID =
  "d4e5ebf11d104d6a63fb74e42094364b25a5f7199a09e5c0e71408972466a8b8";
const SELLER = "1BPVvi1GK4QkfqFMU4jHGjsQjyGwjJJJ7x";
const LISTING_TX =
  "8d01d2d202755dda5b6debdc568f6f6fe6cd2308b75c6c700fa0604780eb8555";
const DELIST_TX =
  "71092adb6e27e871a43a5338459b09528f2de39a0e90b31b2605bd36a9f80c47";
const LOG_CLOSE_TX =
  "9079e81e519b2e9a2cecde1133d656afc892b7866ed72d37c2b524913ce82850";
const REPORTED_LISTING_TX =
  "50cd4dff315842c999a06c3ed0be3616f61c33f1a2f0fce6f645e3f48e9b023c";
const REPORTED_DELIST_TX =
  "f5dbee238a09fe0da6a0e4d01526fefefa6676b86df742323ce49df0daa5ecf5";
const REPORTED_SALE_TX =
  "34ad3a1211c3023d66d72e04e9faf8d989cd60f476887a0abd28b53ba2a8b0a3";
const REPORTED_BUY_TX =
  "50086fb6c14bcbfc818b87415191378188a1bb1e3781d17d0875d81fef91301f";
const REPORTED_BUY_LISTING_TX =
  "67730b089c8fce6f287968fc5c028df8b2ff72ce84b1b3dbda014fb6b9807933";
const REPORTED_SECOND_BUY_TX =
  "35db9a67bddb61d8601f25d8cde3c7c0edda16fbdad1ee9e71110842496c7528";
const REPORTED_SECOND_BUY_LISTING_TX =
  "b97dfcf6eafaabc37f3516581a2c7bb6bca5c34a793a8bb11e71e2643b05f08f";
const REPORTED_BUY_BUYER = "1BPVvi1GK4QkfqFMU4jHGjsQjyGwjJJJ7x";
const REPORTED_BUY_SELLER = "1KhLgiejzFDxzM3AsmXXHCisH3VA7zcSUW";
const CARBONZ_ADDRESS =
  "bc1p0uxp0axptr8rg9dndgtlwxn00j4hq8m88kg80tqd0t6045putwhq5ca7ed";
const CARBONZ_TAPROOT_LISTING_ADDRESS =
  "bc1parjksvz4hetpmqwtka9wuzl9skhq8y3weusenf8e3qrguqhypweqtpmz2g";
const CARBONZ_LISTING_TX =
  "d0697f88d7648ac4221af34d17d3e8c55852b917f820100d9029143085b29a13";
const CARBONZ_SEAL_TX =
  "e365ada0deb8a7bf8f8c4c012897633e4f00938e7f0ca85999de884f939cbc68";
const REPORTED_TRANSFER_TX =
  "90cdafde9e7e050a1831fcc3b412f29e529368fa6d9afc8f053c681c204449d4";
const REPORTED_WAITING_FOR_SEAL_LISTING_TX =
  "a5476c0c6a8df67569935c3cca152a3ef979d95469ce8fe8c8187f359c48a6c7";
const REPORTED_LATEST_WAITING_FOR_SEAL_LISTING_TX =
  "9cbaf52ddb244d228204d841342b126dc8801a987626d0a05d82d5e1af2c1bc3";
const REPORTED_LATEST_WAITING_FOR_SEAL_CLOSE_TX =
  "bcacff05f33c248008073a01f0c37222cf01299a742afc68f49d0a1d479a8525";
const REPORTED_RECENT_WAITING_FOR_SEAL_LISTING_TX =
  "f371ee499b94f929069fb4677446006b1bb67d6793724f2b8d6effb26499c090";
const REPORTED_CONFIRMED_SEALABLE_LISTING_TX =
  "d7fe42285c4edd02592608cbd887ad7a8a2b78e085de05296e352fcc1e2166a9";
const REPORTED_DROPPED_LISTING_TX =
  "658bca245e97ccfa0055ba6237e309fa2fa089316c9287c8952c8af6f59a050a";
const REPORTED_TRANSFER_SENDER =
  "bc1pq0czje5lfwwat69g97k4sysx7an0wxu80n7jceqy6gc50hacd5wqltpx8y";
const REPORTED_TRANSFER_RECIPIENT = "1ArUWhGjcdgRhJ9NMwsNQiSS9KEQoBUH9d";
const STALE_MARKETPLACE_SNAPSHOT_AT = "2026-06-22T18:08:38.250Z";
const WALLET_SUMMARY_DELIST_TXS = [
  "4bdb7f9de2293548d598cd00b07df621339cf364fa1fa1cf42e80ad0551488f4",
  "4c59acfc84b47225f6e0b9bd67379d1ddac14e2e71f6a256315cececbe559d98",
  "51fa5bfe98090b84bd1f2fc906c6f677f636b88a7f45f5e7ae75c8762ba03019",
  DELIST_TX,
  LOG_CLOSE_TX,
  REPORTED_DELIST_TX,
];
const BUY_TXS = [
  "85d7930ffd5650c8508baf1f0128d469592e8349ad51483f69f3e227aca9233b",
  "8b470b3ab319c201d4eb440bb3562b7b907b7ca38480ff71b51c6b655e522e97",
];
const MARKETPLACE_SUMMARY_MAX_MS = Number(
  process.env.MARKETPLACE_SUMMARY_MAX_MS ?? 55_000,
);
const MARKETPLACE_FRESH_SUMMARY_MAX_MS = Number(
  process.env.MARKETPLACE_FRESH_SUMMARY_MAX_MS ?? 180_000,
);
const REQUEST_TIMEOUT_MS = Number(
  process.env.MARKETPLACE_REGRESSION_REQUEST_TIMEOUT_MS ??
    Math.max(MARKETPLACE_FRESH_SUMMARY_MAX_MS + 15_000, 90_000),
);

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function assertRenderableLogItems(payload, label) {
  const items = Array.isArray(payload?.items) ? payload.items : [];
  for (const item of items) {
    const txid = String(item?.txid ?? "");
    assert(txid, `${label} returned a Log row without txid`);
    assert(
      String(item?.title ?? "").trim(),
      `${label} returned ${txid} without title`,
    );
    assert(
      String(item?.description ?? "").trim(),
      `${label} returned ${txid} without description`,
    );
    assert(
      Array.isArray(item?.tags),
      `${label} returned ${txid} without render-safe tags`,
    );
  }
}

async function getJson(path, params = {}) {
  const url = new URL(path, `${API_BASE}/`);
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null && value !== "") {
      url.searchParams.set(key, String(value));
    }
  }
  const response = await fetch(url, {
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  if (!response.ok) {
    throw new Error(`${url} returned HTTP ${response.status}`);
  }
  return response.json();
}

async function timedGetJson(path, params = {}) {
  const startedAt = Date.now();
  const json = await getJson(path, params);
  return {
    elapsedMs: Date.now() - startedAt,
    json,
  };
}

async function tokenHistory(kind, params = {}) {
  return getJson("/api/v1/token-history", {
    network: "livenet",
    asset: WORK_TOKEN_ID,
    kind,
    limit: 20,
    ...params,
  });
}

function txids(items) {
  return new Set(
    (Array.isArray(items) ? items : [])
      .map((item) =>
        String(
          item?.txid ??
            item?.listingId ??
            item?.closedTxid ??
            item?.sale?.txid ??
            item?.listing?.listingId ??
            item?.closedListing?.closedTxid ??
            "",
        ).toLowerCase(),
      )
      .filter(Boolean),
  );
}

function listingKey(item) {
  return `${item?.network ?? ""}:${String(item?.listingId ?? "").toLowerCase()}`;
}

function tokenListingHasConfirmedSeal(item) {
  return (
    item?.sealConfirmed === true &&
    /^[0-9a-f]{64}$/u.test(String(item?.sealTxid ?? "")) &&
    /^[0-9a-f]{64}$/u.test(String(item?.saleAuthorization?.anchorTxid ?? "")) &&
    typeof item?.saleAuthorization?.anchorSignature === "string" &&
    item.saleAuthorization.anchorSignature.length > 0
  );
}

function listingById(items, listingId) {
  const needle = String(listingId ?? "").toLowerCase();
  return (items ?? []).find(
    (item) => String(item?.listingId ?? "").toLowerCase() === needle,
  );
}

function holderByAddress(items, address) {
  const needle = String(address ?? "").toLowerCase();
  return (items ?? []).find(
    (item) => String(item?.address ?? "").toLowerCase() === needle,
  );
}

const activeListing = await tokenHistory("listings", { q: LISTING_TX });
assert(
  !txids(activeListing.items).has(LISTING_TX),
  `${LISTING_TX} is still returned as an active listing`,
);
const reportedActiveListing = await tokenHistory("listings", {
  q: REPORTED_LISTING_TX,
});
assert(
  !txids(reportedActiveListing.items).has(REPORTED_LISTING_TX),
  `${REPORTED_LISTING_TX} is still returned as an active listing`,
);

const closedByDelist = await tokenHistory("closed-listings", { q: DELIST_TX });
assert(
  (closedByDelist.items ?? []).some(
    (item) =>
      String(item?.closedTxid ?? "").toLowerCase() === DELIST_TX &&
      item?.closedConfirmed === true,
  ),
  `${DELIST_TX} is not returned as a confirmed closed listing`,
);
const reportedClosedByDelist = await tokenHistory("closed-listings", {
  q: REPORTED_DELIST_TX,
});
assert(
  (reportedClosedByDelist.items ?? []).some(
    (item) =>
      String(item?.listingId ?? "").toLowerCase() === REPORTED_LISTING_TX &&
      String(item?.closedTxid ?? "").toLowerCase() === REPORTED_DELIST_TX &&
      item?.closedConfirmed === true,
  ),
  `${REPORTED_DELIST_TX} is not returned as a confirmed closed listing`,
);

const sellerSales = await tokenHistory("sales", { address: SELLER });
const sellerSaleTxids = txids(sellerSales.items);
for (const txid of BUY_TXS) {
  assert(
    sellerSaleTxids.has(txid),
    `${txid} is missing from seller-scoped sales history`,
  );
}
const reportedSaleHistory = await tokenHistory("sales", { q: REPORTED_SALE_TX });
assert(
  txids(reportedSaleHistory.items).has(REPORTED_SALE_TX),
  `${REPORTED_SALE_TX} is missing from credit sales history`,
);
const reportedMarketLog = await tokenHistory("market-log", {
  q: REPORTED_SALE_TX,
});
assert(
  txids(reportedMarketLog.items).has(REPORTED_SALE_TX),
  `${REPORTED_SALE_TX} is missing from credit sales and listings log`,
);
const reportedBuySaleHistory = await tokenHistory("sales", {
  fresh: 1,
  q: REPORTED_BUY_TX,
});
const reportedBuySale = (reportedBuySaleHistory.items ?? []).find(
  (item) =>
    String(item?.txid ?? "").toLowerCase() === REPORTED_BUY_TX &&
    String(item?.listingId ?? "").toLowerCase() === REPORTED_BUY_LISTING_TX,
);
assert(reportedBuySale, `${REPORTED_BUY_TX} is missing from WORK sales history`);
assert(
  reportedBuySale?.confirmed === true &&
    reportedBuySale?.amount === 60 &&
    reportedBuySale?.priceSats === 9932 &&
    reportedBuySale?.buyerAddress === REPORTED_BUY_BUYER &&
    reportedBuySale?.sellerAddress === REPORTED_BUY_SELLER,
  `${REPORTED_BUY_TX} returned an incomplete recovered WORK sale`,
);
const reportedBuyMarketLog = await tokenHistory("market-log", {
  fresh: 1,
  q: REPORTED_BUY_TX,
});
assert(
  txids(reportedBuyMarketLog.items).has(REPORTED_BUY_TX),
  `${REPORTED_BUY_TX} is missing from WORK credit sales and listings log`,
);
const reportedBuyClosedListing = await tokenHistory("closed-listings", {
  fresh: 1,
  q: REPORTED_BUY_TX,
});
assert(
  (reportedBuyClosedListing.items ?? []).some(
    (item) =>
      String(item?.listingId ?? "").toLowerCase() === REPORTED_BUY_LISTING_TX &&
      String(item?.closedTxid ?? "").toLowerCase() === REPORTED_BUY_TX &&
      item?.closedConfirmed === true,
  ),
  `${REPORTED_BUY_TX} is missing from WORK closed-listings history`,
);
const reportedBuyActiveListing = await tokenHistory("listings", {
  fresh: 1,
  q: REPORTED_BUY_LISTING_TX,
});
assert(
  !txids(reportedBuyActiveListing.items).has(REPORTED_BUY_LISTING_TX),
  `${REPORTED_BUY_LISTING_TX} is still returned as an active WORK listing`,
);
const reportedSecondBuySaleHistory = await tokenHistory("sales", {
  fresh: 1,
  q: REPORTED_SECOND_BUY_TX,
});
assert(
  (reportedSecondBuySaleHistory.items ?? []).some(
    (item) =>
      String(item?.txid ?? "").toLowerCase() === REPORTED_SECOND_BUY_TX &&
      String(item?.listingId ?? "").toLowerCase() ===
        REPORTED_SECOND_BUY_LISTING_TX &&
      item?.confirmed === true,
  ),
  `${REPORTED_SECOND_BUY_TX} is missing from WORK sales history`,
);
const reportedSecondBuyClosedListing = await tokenHistory("closed-listings", {
  fresh: 1,
  q: REPORTED_SECOND_BUY_TX,
});
assert(
  (reportedSecondBuyClosedListing.items ?? []).some(
    (item) =>
      String(item?.listingId ?? "").toLowerCase() ===
        REPORTED_SECOND_BUY_LISTING_TX &&
      String(item?.closedTxid ?? "").toLowerCase() ===
        REPORTED_SECOND_BUY_TX &&
      item?.closedConfirmed === true,
  ),
  `${REPORTED_SECOND_BUY_TX} is missing from WORK closed-listings history`,
);
const reportedSecondBuyActiveListing = await tokenHistory("listings", {
  fresh: 1,
  q: REPORTED_SECOND_BUY_LISTING_TX,
});
assert(
  !txids(reportedSecondBuyActiveListing.items).has(
    REPORTED_SECOND_BUY_LISTING_TX,
  ),
  `${REPORTED_SECOND_BUY_LISTING_TX} is still returned as an active WORK listing`,
);
const reportedWaitingForSealMarketLog = await tokenHistory("market-log", {
  fresh: 1,
  q: REPORTED_WAITING_FOR_SEAL_LISTING_TX,
});
assert(
  txids(reportedWaitingForSealMarketLog.items).has(
    REPORTED_WAITING_FOR_SEAL_LISTING_TX,
  ),
  `${REPORTED_WAITING_FOR_SEAL_LISTING_TX} is missing from WORK market-log history`,
);
const reportedLatestActiveListing = await tokenHistory("listings", {
  fresh: 1,
  q: REPORTED_LATEST_WAITING_FOR_SEAL_LISTING_TX,
});
assert(
  !txids(reportedLatestActiveListing.items).has(
    REPORTED_LATEST_WAITING_FOR_SEAL_LISTING_TX,
  ),
  `${REPORTED_LATEST_WAITING_FOR_SEAL_LISTING_TX} is still returned as an active waiting-for-seal listing after its anchor was spent`,
);
const reportedLatestClosedListing = await tokenHistory("closed-listings", {
  fresh: 1,
  q: REPORTED_LATEST_WAITING_FOR_SEAL_LISTING_TX,
});
const latestClosedItem = (reportedLatestClosedListing.items ?? []).find(
  (item) =>
    item?.listingId === REPORTED_LATEST_WAITING_FOR_SEAL_LISTING_TX &&
    item?.closedTxid === REPORTED_LATEST_WAITING_FOR_SEAL_CLOSE_TX,
);
assert(
  latestClosedItem?.closedConfirmed === true,
  `${REPORTED_LATEST_WAITING_FOR_SEAL_LISTING_TX} is not returned as a confirmed closed listing`,
);
const reportedRecentWaitingForSealListing = await tokenHistory("listings", {
  fresh: 1,
  q: REPORTED_RECENT_WAITING_FOR_SEAL_LISTING_TX,
});
const recentWaitingForSealItem = listingById(
  reportedRecentWaitingForSealListing.items,
  REPORTED_RECENT_WAITING_FOR_SEAL_LISTING_TX,
);
assert(
  recentWaitingForSealItem?.confirmed === true &&
    recentWaitingForSealItem?.amount === 130 &&
    recentWaitingForSealItem?.priceSats === 81325 &&
    recentWaitingForSealItem?.sellerAddress ===
      CARBONZ_TAPROOT_LISTING_ADDRESS &&
    !tokenListingHasConfirmedSeal(recentWaitingForSealItem),
  `${REPORTED_RECENT_WAITING_FOR_SEAL_LISTING_TX} is not returned as a confirmed waiting-for-seal listing`,
);
const carbonzTaprootListingHistory = await tokenHistory("listings", {
  address: CARBONZ_TAPROOT_LISTING_ADDRESS,
});
for (const txid of [REPORTED_RECENT_WAITING_FOR_SEAL_LISTING_TX]) {
  const item = listingById(carbonzTaprootListingHistory.items, txid);
  assert(
    item?.confirmed === true && !tokenListingHasConfirmedSeal(item),
    `${txid} is missing from cached Carbonz address-scoped waiting-for-seal listings`,
  );
}
const reportedSealableListing = await tokenHistory("listings", {
  q: REPORTED_CONFIRMED_SEALABLE_LISTING_TX,
});
const sealableItem = listingById(
  reportedSealableListing.items,
  REPORTED_CONFIRMED_SEALABLE_LISTING_TX,
);
assert(
  sealableItem?.confirmed === true,
  `${REPORTED_CONFIRMED_SEALABLE_LISTING_TX} is not returned as a confirmed active listing`,
);
assert(
  sealableItem?.tokenId === WORK_TOKEN_ID &&
    sealableItem?.registryAddress &&
    sealableItem?.sellerAddress &&
    sealableItem?.saleAuthorization?.version === "pwt-sale-v1" &&
    sealableItem?.saleAuthorization?.anchorType === "sale-ticket-v1" &&
    sealableItem?.saleAuthorization?.anchorVout === 2 &&
    sealableItem?.saleAuthorization?.anchorValueSats === 546,
  `${REPORTED_CONFIRMED_SEALABLE_LISTING_TX} is missing complete sale-ticket listing fields`,
);
const reportedDroppedListing = await tokenHistory("listings", {
  q: REPORTED_DROPPED_LISTING_TX,
});
assert(
  !txids(reportedDroppedListing.items).has(REPORTED_DROPPED_LISTING_TX),
  `${REPORTED_DROPPED_LISTING_TX} is still returned as an active listing`,
);

const walletToken = await getJson("/api/v1/token", {
  network: "livenet",
  asset: WORK_TOKEN_ID,
  address: SELLER,
  wallet: 1,
});
assert(
  !(walletToken.listings ?? []).some(
    (item) => String(item?.listingId ?? "").toLowerCase() === LISTING_TX,
  ),
  `${LISTING_TX} is still returned as active in wallet-scoped token payload`,
);
assert(
  !(walletToken.listings ?? []).some(
    (item) => String(item?.listingId ?? "").toLowerCase() === REPORTED_LISTING_TX,
  ),
  `${REPORTED_LISTING_TX} is still returned as active in wallet-scoped token payload`,
);
assert(
  (walletToken.closedListings ?? []).some(
    (item) =>
      String(item?.listingId ?? "").toLowerCase() === LISTING_TX &&
      String(item?.closedTxid ?? "").toLowerCase() === DELIST_TX &&
      item?.closedConfirmed === true,
  ),
  `${LISTING_TX} is not closed by ${DELIST_TX} in wallet-scoped token payload`,
);
assert(
  (walletToken.closedListings ?? []).some(
    (item) =>
      String(item?.listingId ?? "").toLowerCase() === REPORTED_LISTING_TX &&
      String(item?.closedTxid ?? "").toLowerCase() === REPORTED_DELIST_TX &&
      item?.closedConfirmed === true,
  ),
  `${REPORTED_LISTING_TX} is not closed by ${REPORTED_DELIST_TX} in wallet-scoped token payload`,
);
const walletSaleTxids = txids(walletToken.sales);
for (const txid of BUY_TXS) {
  assert(
    walletSaleTxids.has(txid),
    `${txid} is missing from wallet-scoped sales`,
  );
}
const carbonzTaprootWalletToken = await getJson("/api/v1/token", {
  network: "livenet",
  asset: WORK_TOKEN_ID,
  address: CARBONZ_TAPROOT_LISTING_ADDRESS,
  wallet: 1,
  fresh: 1,
});
for (const txid of [REPORTED_RECENT_WAITING_FOR_SEAL_LISTING_TX]) {
  const item = listingById(carbonzTaprootWalletToken.listings, txid);
  assert(
    item?.confirmed === true && !tokenListingHasConfirmedSeal(item),
    `${txid} is missing from Carbonz wallet-scoped waiting-for-seal listings`,
  );
}
assert(
  !listingById(
    carbonzTaprootWalletToken.listings,
    REPORTED_LATEST_WAITING_FOR_SEAL_LISTING_TX,
  ),
  `${REPORTED_LATEST_WAITING_FOR_SEAL_LISTING_TX} is still returned as a Carbonz wallet-scoped waiting-for-seal listing after its anchor was spent`,
);
const latestWalletClosedItem = listingById(
  carbonzTaprootWalletToken.closedListings,
  REPORTED_LATEST_WAITING_FOR_SEAL_LISTING_TX,
);
assert(
  latestWalletClosedItem?.closedTxid ===
    REPORTED_LATEST_WAITING_FOR_SEAL_CLOSE_TX,
  `${REPORTED_LATEST_WAITING_FOR_SEAL_LISTING_TX} is missing from Carbonz wallet-scoped closed listings`,
);
const carbonzTaprootHolderHistory = await tokenHistory("holders", {
  fresh: 1,
  q: CARBONZ_TAPROOT_LISTING_ADDRESS,
});
const carbonzTaprootWalletHolder = holderByAddress(
  carbonzTaprootWalletToken.holders,
  CARBONZ_TAPROOT_LISTING_ADDRESS,
);
const carbonzTaprootHistoryHolder = holderByAddress(
  carbonzTaprootHolderHistory.items,
  CARBONZ_TAPROOT_LISTING_ADDRESS,
);
assert(
  Number(carbonzTaprootWalletHolder?.balance ?? 0) > 0 &&
    Number(carbonzTaprootWalletHolder?.balance ?? 0) ===
      Number(carbonzTaprootHistoryHolder?.balance ?? 0),
  `${CARBONZ_TAPROOT_LISTING_ADDRESS} holder search does not match wallet-scoped WORK balance`,
);

const reportedTransferHistory = await tokenHistory("transfers", {
  fresh: 1,
  q: REPORTED_TRANSFER_TX,
});
assert(
  txids(reportedTransferHistory.items).has(REPORTED_TRANSFER_TX),
  `${REPORTED_TRANSFER_TX} is missing from WORK transfer history`,
);
for (const address of [REPORTED_TRANSFER_SENDER, REPORTED_TRANSFER_RECIPIENT]) {
  const scopedWallet = await getJson("/api/v1/token", {
    network: "livenet",
    asset: WORK_TOKEN_ID,
    address,
    wallet: 1,
    fresh: 1,
  });
  assert(
    (scopedWallet.transfers ?? []).some(
      (item) =>
        String(item?.txid ?? "").toLowerCase() === REPORTED_TRANSFER_TX &&
        item?.confirmed === true,
    ),
    `${REPORTED_TRANSFER_TX} is missing from ${address} wallet-scoped transfers`,
  );
}

const walletSummary = await getJson("/api/v1/token-summary", {
  network: "livenet",
  asset: WORK_TOKEN_ID,
  address: SELLER,
  wallet: 1,
  fresh: 1,
});
for (const txid of WALLET_SUMMARY_DELIST_TXS) {
  assert(
    (walletSummary.closedListings ?? []).some(
      (item) =>
        String(item?.closedTxid ?? "").toLowerCase() === txid &&
        item?.closedConfirmed === true,
    ),
    `${txid} is not confirmed in wallet-scoped token summary`,
  );
}
assert(
  !(walletSummary.closedListings ?? []).some(
    (item) => item?.sellerAddress === SELLER && !item?.closedTxid,
  ),
  "wallet-scoped token summary returned an anonymous closed listing",
);

const { elapsedMs: marketplaceSummaryMs, json: marketplaceSummary } =
  await timedGetJson("/api/v1/marketplace-summary", {
    network: "livenet",
  });
assert(
  marketplaceSummaryMs <= MARKETPLACE_SUMMARY_MAX_MS,
  `/api/v1/marketplace-summary took ${marketplaceSummaryMs}ms, expected <= ${MARKETPLACE_SUMMARY_MAX_MS}ms`,
);
assert(
  !(marketplaceSummary.token?.listings ?? []).some(
    (item) => String(item?.listingId ?? "").toLowerCase() === LISTING_TX,
  ),
  `${LISTING_TX} is still returned as active in marketplace summary`,
);
const { elapsedMs: marketplaceFreshSummaryMs, json: marketplaceFreshSummary } =
  await timedGetJson("/api/v1/marketplace-summary", {
    network: "livenet",
    fresh: 1,
  });
assert(
  marketplaceFreshSummaryMs <= MARKETPLACE_FRESH_SUMMARY_MAX_MS,
  `/api/v1/marketplace-summary?fresh=1 took ${marketplaceFreshSummaryMs}ms, expected <= ${MARKETPLACE_FRESH_SUMMARY_MAX_MS}ms`,
);
const freshMarketplaceIndexedAt = Date.parse(
  marketplaceFreshSummary.token?.indexedAt ??
    marketplaceFreshSummary.indexedAt ??
    "",
);
assert(
  Number.isFinite(freshMarketplaceIndexedAt) &&
    freshMarketplaceIndexedAt > Date.parse(STALE_MARKETPLACE_SNAPSHOT_AT),
  `/api/v1/marketplace-summary?fresh=1 is still pinned to stale snapshot ${STALE_MARKETPLACE_SNAPSHOT_AT}`,
);
assert(
  (marketplaceFreshSummary.token?.listings ?? []).some(
    (item) =>
      String(item?.listingId ?? "").toLowerCase() ===
        REPORTED_WAITING_FOR_SEAL_LISTING_TX && item?.confirmed === true,
  ),
  `${REPORTED_WAITING_FOR_SEAL_LISTING_TX} is missing from fresh marketplace summary listings`,
);
assert(
  !(marketplaceFreshSummary.token?.listings ?? []).some(
    (item) =>
      String(item?.listingId ?? "").toLowerCase() ===
      REPORTED_LATEST_WAITING_FOR_SEAL_LISTING_TX,
  ),
  `${REPORTED_LATEST_WAITING_FOR_SEAL_LISTING_TX} is still returned in fresh marketplace summary waiting-for-seal listings after its anchor was spent`,
);
assert(
  (marketplaceFreshSummary.token?.listings ?? []).some(
    (item) =>
      String(item?.listingId ?? "").toLowerCase() ===
        REPORTED_RECENT_WAITING_FOR_SEAL_LISTING_TX &&
      item?.confirmed === true &&
      !tokenListingHasConfirmedSeal(item),
  ),
  `${REPORTED_RECENT_WAITING_FOR_SEAL_LISTING_TX} is missing from fresh marketplace summary waiting-for-seal listings`,
);
const workToken = await getJson("/api/v1/token", {
  network: "livenet",
  asset: WORK_TOKEN_ID,
  fresh: 1,
});
const [workSummary, workTokenSummary] = await Promise.all([
  getJson("/api/v1/work-summary", {
    network: "livenet",
    fresh: 1,
  }),
  getJson("/api/v1/token-summary", {
    network: "livenet",
    asset: WORK_TOKEN_ID,
    fresh: 1,
  }),
]);
const activeWorkListingCount = (workToken.listings ?? []).length;
const workSummaryToken = (workSummary.token?.tokens ?? []).find(
  (item) => item?.tokenId === WORK_TOKEN_ID,
);
const scopedSummaryToken = (workTokenSummary.tokens ?? []).find(
  (item) => item?.tokenId === WORK_TOKEN_ID,
);
assert(
  (workSummary.token?.listings ?? []).length === activeWorkListingCount,
  `/api/v1/work-summary?fresh=1 returned ${(workSummary.token?.listings ?? []).length} active WORK listings, expected ${activeWorkListingCount}`,
);
assert(
  (workTokenSummary.listings ?? []).length === activeWorkListingCount,
  `/api/v1/token-summary?asset=WORK&fresh=1 returned ${(workTokenSummary.listings ?? []).length} active WORK listings, expected ${activeWorkListingCount}`,
);
assert(
  workSummaryToken?.openListings === activeWorkListingCount,
  `/api/v1/work-summary?fresh=1 reports ${workSummaryToken?.openListings} open WORK listings, expected ${activeWorkListingCount}`,
);
assert(
  scopedSummaryToken?.openListings === activeWorkListingCount,
  `/api/v1/token-summary?asset=WORK&fresh=1 reports ${scopedSummaryToken?.openListings} open WORK listings, expected ${activeWorkListingCount}`,
);
const confirmedSealedListings = (workToken.listings ?? []).filter(
  tokenListingHasConfirmedSeal,
);
const summaryListingsByKey = new Map(
  (marketplaceSummary.token?.listings ?? []).map((item) => [listingKey(item), item]),
);
assert(
  confirmedSealedListings.length > 0,
  "full WORK token payload returned no confirmed sealed listings",
);
for (const listing of confirmedSealedListings) {
  const summaryListing = summaryListingsByKey.get(listingKey(listing));
  assert(
    summaryListing,
    `${listing.listingId} is confirmed sealed in /api/v1/token but missing from marketplace summary`,
  );
  assert(
    tokenListingHasConfirmedSeal(summaryListing),
    `${listing.listingId} is confirmed sealed in /api/v1/token but marketplace summary dropped its seal metadata`,
  );
  assert(
    String(summaryListing.sealTxid ?? "").toLowerCase() ===
      String(listing.sealTxid ?? "").toLowerCase(),
    `${listing.listingId} has mismatched seal txid between /api/v1/token and marketplace summary`,
  );
  assert(
    String(summaryListing.saleAuthorization?.anchorTxid ?? "").toLowerCase() ===
      String(listing.saleAuthorization?.anchorTxid ?? "").toLowerCase(),
    `${listing.listingId} has mismatched sale-ticket anchor between /api/v1/token and marketplace summary`,
  );
}

const carbonzWalletToken = await getJson("/api/v1/token", {
  network: "livenet",
  asset: WORK_TOKEN_ID,
  address: CARBONZ_ADDRESS,
  wallet: 1,
});
const carbonzListing = (carbonzWalletToken.listings ?? []).find(
  (item) => String(item?.listingId ?? "").toLowerCase() === CARBONZ_LISTING_TX,
);
assert(
  carbonzListing &&
    String(carbonzListing.sealTxid ?? "").toLowerCase() === CARBONZ_SEAL_TX &&
    carbonzListing.sealConfirmed === true,
  `${CARBONZ_LISTING_TX} is missing its confirmed seal in carbonz wallet-scoped token payload`,
);
const carbonzMarketLog = await tokenHistory("market-log", {
  address: CARBONZ_ADDRESS,
  limit: 100,
});
assert(
  txids(carbonzMarketLog.items).has(CARBONZ_LISTING_TX),
  `${CARBONZ_LISTING_TX} is missing from carbonz-scoped market log`,
);

const logClose = await getJson("/api/v1/log-history", {
  network: "livenet",
  q: LOG_CLOSE_TX,
  limit: 5,
});
assert(
  (logClose.items ?? []).some(
    (item) =>
      item?.kind === "token-listing-closed" &&
      String(item?.txid ?? "").toLowerCase() === LOG_CLOSE_TX &&
      item?.confirmed === true,
  ),
  `${LOG_CLOSE_TX} is not logged as a confirmed token-listing close`,
);
const reportedLogClose = await getJson("/api/v1/log-history", {
  network: "livenet",
  q: REPORTED_DELIST_TX,
  limit: 5,
});
assertRenderableLogItems(reportedLogClose, "reported delist Log search");
assert(
  (reportedLogClose.items ?? []).some(
    (item) =>
      item?.kind === "token-listing-closed" &&
      String(item?.txid ?? "").toLowerCase() === REPORTED_DELIST_TX &&
      item?.confirmed === true,
  ),
  `${REPORTED_DELIST_TX} is not logged as a confirmed token-listing close`,
);
const reportedLogSale = await getJson("/api/v1/log-history", {
  network: "livenet",
  q: REPORTED_SALE_TX,
  limit: 5,
});
assertRenderableLogItems(reportedLogSale, "reported sale Log search");
assert(
  (reportedLogSale.items ?? []).some(
    (item) =>
      item?.kind === "token-sale" &&
      String(item?.txid ?? "").toLowerCase() === REPORTED_SALE_TX &&
      item?.confirmed === true,
  ),
  `${REPORTED_SALE_TX} is not logged as a confirmed token sale`,
);
const reportedBuyLogSale = await getJson("/api/v1/log-history", {
  network: "livenet",
  q: REPORTED_BUY_TX,
  limit: 5,
});
assertRenderableLogItems(reportedBuyLogSale, "reported recovered buy Log search");
assert(
  (reportedBuyLogSale.items ?? []).some(
    (item) =>
      item?.kind === "token-sale" &&
      String(item?.txid ?? "").toLowerCase() === REPORTED_BUY_TX &&
      item?.confirmed === true,
  ),
  `${REPORTED_BUY_TX} is not logged as a confirmed token sale`,
);

console.log(
  `Marketplace regression checks passed for ${API_BASE}: delist, summary, sealed listings, sales, wallet, and Log close status.`,
);
