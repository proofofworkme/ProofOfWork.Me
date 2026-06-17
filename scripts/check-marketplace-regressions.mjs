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
const WALLET_SUMMARY_DELIST_TXS = [
  "4bdb7f9de2293548d598cd00b07df621339cf364fa1fa1cf42e80ad0551488f4",
  "4c59acfc84b47225f6e0b9bd67379d1ddac14e2e71f6a256315cececbe559d98",
  "51fa5bfe98090b84bd1f2fc906c6f677f636b88a7f45f5e7ae75c8762ba03019",
  DELIST_TX,
  LOG_CLOSE_TX,
];
const BUY_TXS = [
  "85d7930ffd5650c8508baf1f0128d469592e8349ad51483f69f3e227aca9233b",
  "8b470b3ab319c201d4eb440bb3562b7b907b7ca38480ff71b51c6b655e522e97",
];

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

const activeListing = await tokenHistory("listings", { q: LISTING_TX });
assert(
  !txids(activeListing.items).has(LISTING_TX),
  `${LISTING_TX} is still returned as an active listing`,
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

const sellerSales = await tokenHistory("sales", { address: SELLER });
const sellerSaleTxids = txids(sellerSales.items);
for (const txid of BUY_TXS) {
  assert(
    sellerSaleTxids.has(txid),
    `${txid} is missing from seller-scoped sales history`,
  );
}

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
  (walletToken.closedListings ?? []).some(
    (item) =>
      String(item?.listingId ?? "").toLowerCase() === LISTING_TX &&
      String(item?.closedTxid ?? "").toLowerCase() === DELIST_TX &&
      item?.closedConfirmed === true,
  ),
  `${LISTING_TX} is not closed by ${DELIST_TX} in wallet-scoped token payload`,
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

const marketplaceSummary = await getJson("/api/v1/marketplace-summary", {
  network: "livenet",
});
assert(
  !(marketplaceSummary.token?.listings ?? []).some(
    (item) => String(item?.listingId ?? "").toLowerCase() === LISTING_TX,
  ),
  `${LISTING_TX} is still returned as active in marketplace summary`,
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

console.log(
  `Marketplace regression checks passed for ${API_BASE}: delist, summary, sales, wallet, and Log close status.`,
);
