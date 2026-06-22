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
const CARBONZ_ADDRESS =
  "bc1p0uxp0axptr8rg9dndgtlwxn00j4hq8m88kg80tqd0t6045putwhq5ca7ed";
const CARBONZ_LISTING_TX =
  "d0697f88d7648ac4221af34d17d3e8c55852b917f820100d9029143085b29a13";
const CARBONZ_SEAL_TX =
  "e365ada0deb8a7bf8f8c4c012897633e4f00938e7f0ca85999de884f939cbc68";
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

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

async function getJson(path, params = {}) {
  const url = new URL(path, `${API_BASE}/`);
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null && value !== "") {
      url.searchParams.set(key, String(value));
    }
  }
  const response = await fetch(url, { signal: AbortSignal.timeout(90_000) });
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
            item?.closedTxid ??
            item?.sale?.txid ??
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

const workToken = await getJson("/api/v1/token", {
  network: "livenet",
  asset: WORK_TOKEN_ID,
});
const confirmedSealedListings = (workToken.listings ?? []).filter(
  tokenListingHasConfirmedSeal,
);
const summaryListingKeys = new Set(
  (marketplaceSummary.token?.listings ?? []).map(listingKey),
);
assert(
  confirmedSealedListings.length > 0,
  "full WORK token payload returned no confirmed sealed listings",
);
for (const listing of confirmedSealedListings) {
  assert(
    summaryListingKeys.has(listingKey(listing)),
    `${listing.listingId} is confirmed sealed in /api/v1/token but missing from marketplace summary`,
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
assert(
  (reportedLogSale.items ?? []).some(
    (item) =>
      item?.kind === "token-sale" &&
      String(item?.txid ?? "").toLowerCase() === REPORTED_SALE_TX &&
      item?.confirmed === true,
  ),
  `${REPORTED_SALE_TX} is not logged as a confirmed token sale`,
);

console.log(
  `Marketplace regression checks passed for ${API_BASE}: delist, summary, sealed listings, sales, wallet, and Log close status.`,
);
