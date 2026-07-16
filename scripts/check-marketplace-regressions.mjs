#!/usr/bin/env node

import { parseWorkAmountToAtoms } from "../server/work-units.mjs";

const API_BASE = (
  process.env.POW_API_BASE ||
  process.env.VITE_POW_API_BASE ||
  "http://127.0.0.1:8081"
).replace(/\/+$/u, "");
const REGRESSION_MODE = String(
  process.env.MARKETPLACE_REGRESSION_MODE ??
    (process.argv.includes("--full") ? "full" : "fast"),
)
  .trim()
  .toLowerCase();
const FULL_REGRESSION_MODE = ["full", "audit", "slow"].includes(
  REGRESSION_MODE,
);
const GATE_LABEL = FULL_REGRESSION_MODE ? "full" : "fast";
const EXACT_HISTORY_MAX_MS = 10_000;

const WORK_TOKEN_ID =
  "d4e5ebf11d104d6a63fb74e42094364b25a5f7199a09e5c0e71408972466a8b8";
const POWB_TOKEN_ID =
  "a3d0bc8528f91dfc52400a885bed7e49235396aa82aa9f95db41be629f1d5562";
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
const CARBONZ_SALE_TX =
  "c74632a45a987b25de86f5f37c1b02f7642bc49c22355515f488c9dd5527855d";
const REPORTED_TRANSFER_TX =
  "90cdafde9e7e050a1831fcc3b412f29e529368fa6d9afc8f053c681c204449d4";
const CARBONZ_DELAYED_TRANSFER_TX =
  "c90f95cdd45892f76af89686dea7c1c35ec070148e5a74c947f174e244ef44db";
const CARBONZ_DELAYED_TRANSFER_SENDER =
  "18xvbj6mpPpYYjWibcqsXdV7SCwBQNrqMW";
const CARBONZ_DELAYED_TRANSFER_RECIPIENT =
  "14hKW6Z3WKrJZayZhCvLJCocMaaAtTHd9L";
const REPORTED_STALE_SALE_TX =
  "d5fba208f3213ff0eabe3f857b84d1be9bc63ea5318f8e945a7a6cb9b6190edb";
const REPORTED_STALE_SALE_LISTING_TX =
  "ed2302fc151663295633de43026e1669f21e4371cc2805866cf17ee1f78eb78e";
const REPORTED_STALE_SALE_BUYER = "18xvbj6mpPpYYjWibcqsXdV7SCwBQNrqMW";
const REPORTED_STALE_SALE_SELLER =
  "bc1pl8vmv8y4k37jvw77cn7y8tckeawrm5u2n50qrjvglgrp04hczvtq5jyum0";
const REPORTED_JULY_PURCHASE_TX =
  "66e601cdc087d55b9d97421acd45dcdc73a441870d333ce0ba0095f9f5fbdaaf";
const REPORTED_JULY_PURCHASE_LISTING_TX =
  "e95c6299b1fdd132b192ea040bcb8683140632b81dbde82946c5b754a8f87dbc";
const CARBONZ_POWB_TRANSFER_TX =
  "18c7dba7ebe06727e2f37bf0d4885a2aadbf42aff56743936e8e076e2c691100";
const REPORTED_WAITING_FOR_SEAL_LISTING_TX =
  "a5476c0c6a8df67569935c3cca152a3ef979d95469ce8fe8c8187f359c48a6c7";
const REPORTED_LATEST_WAITING_FOR_SEAL_LISTING_TX =
  "9cbaf52ddb244d228204d841342b126dc8801a987626d0a05d82d5e1af2c1bc3";
const REPORTED_LATEST_WAITING_FOR_SEAL_CLOSE_TX =
  "bcacff05f33c248008073a01f0c37222cf01299a742afc68f49d0a1d479a8525";
const REPORTED_RECENT_WAITING_FOR_SEAL_LISTING_TX =
  "f371ee499b94f929069fb4677446006b1bb67d6793724f2b8d6effb26499c090";
const REPORTED_RECENT_WAITING_FOR_SEAL_SEAL_TX =
  "d6c78c4ffad8e9b17324b19f5baee023e91cce63e8e05fd4677280023b022c12";
const REPORTED_CONFIRMED_SEALABLE_LISTING_TX =
  "d7fe42285c4edd02592608cbd887ad7a8a2b78e085de05296e352fcc1e2166a9";
const REPORTED_DROPPED_LISTING_TX =
  "658bca245e97ccfa0055ba6237e309fa2fa089316c9287c8952c8af6f59a050a";
const REPORTED_SPENT_SEAL_LISTING_TX =
  "df5740ebf1260f04906479ec1f23a1fd64d112f368be4a056a0a4b55cff838a1";
const REPORTED_SPENT_SEAL_TX =
  "a18c2972590631e0a53bf47a2b1a737c39142136994faf2fd04247f7c1628749";
const REPORTED_OTC_UNSEALED_LISTING_TXS = [
  "15aa831e339a17dd3d0a8a256268cb5e652b965ecf79a6af1423375619ad88fa",
  "7f41658356632323b0659c935f83c2a5dcc42aefce08e8ed6d769722325d1fe9",
];
const CARBONZ_REPORTED_BUY_TX =
  "7ddf760aaae819aab74a4cc5523016350e11b5888c4950acd97a7660533ba47b";
const CARBONZ_REPORTED_BUY_LISTING_TX =
  "48decc8b8e1ee2c6e0678387c8466c6381b4a071661e31748b5779a4106c57eb";
const CARBONZ_REPORTED_BUY_BUYER = "1ArUWhGjcdgRhJ9NMwsNQiSS9KEQoBUH9d";
const CARBONZ_REPORTED_BUY_SELLER =
  "bc1p3yaleuat8cdugnx20m0zkum90vpwnuqgshkd8j4xqrwn6amqan4shdh33v";
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
    (FULL_REGRESSION_MODE
      ? Math.max(MARKETPLACE_FRESH_SUMMARY_MAX_MS + 120_000, 300_000)
      : 90_000),
);
const REQUEST_RETRY_COUNT = Number(
  process.env.MARKETPLACE_REGRESSION_REQUEST_RETRY_COUNT ??
    (FULL_REGRESSION_MODE ? 2 : 0),
);
const ID_RECORD_MAX_MS = Number(
  process.env.MARKETPLACE_ID_RECORD_MAX_MS ?? 15_000,
);

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function numericValue(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}

function numbersAgree(left, right, tolerance = 0.01) {
  return Math.abs(numericValue(left) - numericValue(right)) <= tolerance;
}

function workAmountMatches(record, expectedAmount) {
  try {
    const expectedAtoms = parseWorkAmountToAtoms(expectedAmount, {
      allowZero: true,
    });
    const amountAtoms = record?.amountAtoms;
    const hasAmountAtoms =
      amountAtoms !== undefined && amountAtoms !== null && amountAtoms !== "";
    if (typeof record?.amount === "number") {
      return (
        !hasAmountAtoms &&
        Number.isSafeInteger(record.amount) &&
        parseWorkAmountToAtoms(record.amount, { allowZero: true }) ===
          expectedAtoms
      );
    }
    return (
      typeof record?.amount === "string" &&
      record.amount === expectedAmount &&
      typeof amountAtoms === "string" &&
      amountAtoms === expectedAtoms
    );
  } catch {
    return false;
  }
}

function elapsedMs(startedAt) {
  return `${Date.now() - startedAt}ms`;
}

async function step(name, run) {
  const startedAt = Date.now();
  console.log(`START [${GATE_LABEL}] ${name}`);
  try {
    const result = await run();
    console.log(`PASS  [${GATE_LABEL}] ${name} ${elapsedMs(startedAt)}`);
    return result;
  } catch (error) {
    console.error(
      `FAIL  [${GATE_LABEL}] ${name} ${elapsedMs(startedAt)}: ${
        error?.message ?? error
      }`,
    );
    throw error;
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
  const requestStartedAt = Date.now();
  console.log(`GET   [${GATE_LABEL}] ${url.pathname}${url.search}`);
  let lastError = null;
  for (let attempt = 0; attempt <= REQUEST_RETRY_COUNT; attempt += 1) {
    try {
      const response = await fetch(url, {
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
      if (response.ok) {
        console.log(
          `OK    [${GATE_LABEL}] ${url.pathname}${url.search} ${elapsedMs(
            requestStartedAt,
          )}`,
        );
        return response.json();
      }
      const retryableStatus = [500, 502, 503, 504].includes(response.status);
      if (!retryableStatus || attempt >= REQUEST_RETRY_COUNT) {
        console.error(
          `BAD   [${GATE_LABEL}] ${url.pathname}${url.search} HTTP ${
            response.status
          } ${elapsedMs(requestStartedAt)}`,
        );
        throw new Error(`${url} returned HTTP ${response.status}`);
      }
      lastError = new Error(`${url} returned HTTP ${response.status}`);
    } catch (error) {
      lastError = error;
      const retryableError =
        error?.name === "TimeoutError" ||
        String(error?.message ?? "").includes("fetch failed");
      if (!retryableError || attempt >= REQUEST_RETRY_COUNT) {
        console.error(
          `BAD   [${GATE_LABEL}] ${url.pathname}${url.search} ${
            error?.message ?? error
          } ${elapsedMs(requestStartedAt)}`,
        );
        throw error;
      }
    }
    console.log(
      `RETRY [${GATE_LABEL}] ${url.pathname}${url.search} attempt ${
        attempt + 2
      }/${REQUEST_RETRY_COUNT + 1}`,
    );
    await new Promise((resolve) =>
      setTimeout(resolve, 1_000 * (attempt + 1)),
    );
  }
  throw lastError;
}

async function timedGetJson(path, params = {}) {
  const startedAt = Date.now();
  const json = await getJson(path, params);
  return {
    elapsedMs: Date.now() - startedAt,
    json,
  };
}

async function tokenHistoryForAsset(asset, kind, params = {}) {
  return getJson("/api/v1/token-history", {
    network: "livenet",
    asset,
    kind,
    limit: 20,
    ...params,
  });
}

async function tokenHistory(kind, params = {}) {
  return tokenHistoryForAsset(WORK_TOKEN_ID, kind, params);
}

async function assertReportedJulyPurchaseLifecycle() {
  const saleHistory = await tokenHistory("sales", {
    fresh: 1,
    q: REPORTED_JULY_PURCHASE_TX,
  });
  assert(
    (saleHistory.items ?? []).some(
      (item) =>
        String(item?.txid ?? "").toLowerCase() ===
          REPORTED_JULY_PURCHASE_TX &&
        String(item?.listingId ?? "").toLowerCase() ===
          REPORTED_JULY_PURCHASE_LISTING_TX &&
        item?.confirmed === true,
    ),
    `${REPORTED_JULY_PURCHASE_TX} is missing from confirmed WORK sales history`,
  );

  const marketLog = await tokenHistory("market-log", {
    fresh: 1,
    q: REPORTED_JULY_PURCHASE_TX,
  });
  assert(
    txids(marketLog.items).has(REPORTED_JULY_PURCHASE_TX),
    `${REPORTED_JULY_PURCHASE_TX} is missing from Credit Sales & Listings Log`,
  );

  const closedListings = await tokenHistory("closed-listings", {
    fresh: 1,
    q: REPORTED_JULY_PURCHASE_TX,
  });
  assert(
    (closedListings.items ?? []).some(
      (item) =>
        String(item?.listingId ?? "").toLowerCase() ===
          REPORTED_JULY_PURCHASE_LISTING_TX &&
        String(item?.closedTxid ?? "").toLowerCase() ===
          REPORTED_JULY_PURCHASE_TX &&
        item?.closedConfirmed === true,
    ),
    `${REPORTED_JULY_PURCHASE_LISTING_TX} is missing its confirmed purchase closure`,
  );

  const activeListings = await tokenHistory("listings", {
    fresh: 1,
    q: REPORTED_JULY_PURCHASE_LISTING_TX,
  });
  assert(
    !txids(activeListings.items).has(REPORTED_JULY_PURCHASE_LISTING_TX),
    `${REPORTED_JULY_PURCHASE_LISTING_TX} is still active after ${REPORTED_JULY_PURCHASE_TX}`,
  );
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

async function runFastMarketplaceRegressionGate() {
  console.log(`Marketplace regression gate: fast deploy checks for ${API_BASE}`);

  await step("fast ProofOfWork ID record lookup", async () => {
    const { elapsedMs: carbonzIdMs, json: carbonzIdPayload } =
      await timedGetJson("/api/v1/ids/carbonz", { network: "livenet" });
    assert(
      carbonzIdMs <= ID_RECORD_MAX_MS,
      `/api/v1/ids/carbonz took ${carbonzIdMs}ms, expected <= ${ID_RECORD_MAX_MS}ms`,
    );
    assert(
      String(carbonzIdPayload.record?.id ?? "").toLowerCase() === "carbonz" &&
        carbonzIdPayload.record?.confirmed === true,
      "/api/v1/ids/carbonz did not return the confirmed Carbonz ID record",
    );
  });

  await step("active and closed WORK listing truth", async () => {
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

    const closedByDelist = await tokenHistory("closed-listings", {
      q: DELIST_TX,
    });
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
          String(item?.closedTxid ?? "").toLowerCase() ===
            REPORTED_DELIST_TX &&
          item?.closedConfirmed === true,
      ),
      `${REPORTED_DELIST_TX} is not returned as a confirmed closed listing`,
    );

    await assertReportedJulyPurchaseLifecycle();
  });

  await step("seller wallet active and unsealed listing state", async () => {
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
        (item) =>
          String(item?.listingId ?? "").toLowerCase() ===
          REPORTED_LISTING_TX,
      ),
      `${REPORTED_LISTING_TX} is still returned as active in wallet-scoped token payload`,
    );
    for (const txid of REPORTED_OTC_UNSEALED_LISTING_TXS) {
      const item = listingById(walletToken.listings, txid);
      assert(
        item?.confirmed === true &&
          item?.sellerAddress === SELLER &&
          !item?.sealTxid,
        `${txid} is missing as an active unsealed seller listing in wallet-scoped token payload`,
      );
    }
  });

  await step("confirmed sealed listing metadata stays visible", async () => {
    const carbonzTaprootWalletToken = await getJson("/api/v1/token", {
      network: "livenet",
      asset: WORK_TOKEN_ID,
      address: CARBONZ_TAPROOT_LISTING_ADDRESS,
      wallet: 1,
      fresh: 1,
    });
    const recentWaitingForSealItem = listingById(
      carbonzTaprootWalletToken.listings,
      REPORTED_RECENT_WAITING_FOR_SEAL_LISTING_TX,
    );
    assert(
      recentWaitingForSealItem?.confirmed === true &&
        tokenListingHasConfirmedSeal(recentWaitingForSealItem) &&
        String(recentWaitingForSealItem.sealTxid ?? "").toLowerCase() ===
          REPORTED_RECENT_WAITING_FOR_SEAL_SEAL_TX,
      `${REPORTED_RECENT_WAITING_FOR_SEAL_LISTING_TX} is missing its confirmed seal metadata`,
    );
  });

  await step("Carbonz delayed WORK transfer wallet recovery", async () => {
    const carbonzDelayedTransferHistory = await tokenHistory("transfers", {
      fresh: 1,
      q: CARBONZ_DELAYED_TRANSFER_TX,
    });
    const carbonzDelayedTransfer = (
      carbonzDelayedTransferHistory.items ?? []
    ).find(
      (item) =>
        String(item?.txid ?? "").toLowerCase() ===
          CARBONZ_DELAYED_TRANSFER_TX && item?.confirmed === true,
    );
    assert(
      workAmountMatches(carbonzDelayedTransfer, "20000") &&
        carbonzDelayedTransfer?.senderAddress ===
          CARBONZ_DELAYED_TRANSFER_SENDER &&
        carbonzDelayedTransfer?.recipientAddress ===
          CARBONZ_DELAYED_TRANSFER_RECIPIENT,
      `${CARBONZ_DELAYED_TRANSFER_TX} is missing or incomplete in WORK transfer history`,
    );
    for (const address of [
      CARBONZ_DELAYED_TRANSFER_SENDER,
      CARBONZ_DELAYED_TRANSFER_RECIPIENT,
    ]) {
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
            String(item?.txid ?? "").toLowerCase() ===
              CARBONZ_DELAYED_TRANSFER_TX &&
            item?.confirmed === true &&
            item?.senderAddress === CARBONZ_DELAYED_TRANSFER_SENDER &&
            item?.recipientAddress === CARBONZ_DELAYED_TRANSFER_RECIPIENT,
        ),
        `${CARBONZ_DELAYED_TRANSFER_TX} is missing from ${address} wallet-scoped transfers`,
      );
    }
    const delayedRecipientWallet = await getJson("/api/v1/token-summary", {
      network: "livenet",
      asset: WORK_TOKEN_ID,
      address: CARBONZ_DELAYED_TRANSFER_RECIPIENT,
      wallet: 1,
      fresh: 1,
    });
    const delayedRecipientHolder = holderByAddress(
      delayedRecipientWallet.holders,
      CARBONZ_DELAYED_TRANSFER_RECIPIENT,
    );
    assert(
      Number(delayedRecipientHolder?.balance ?? 0) >= 20000,
      `${CARBONZ_DELAYED_TRANSFER_RECIPIENT} wallet summary did not include the confirmed WORK transfer balance`,
    );
  });

  await step("marketplace summary active book contract", async () => {
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
    assert(
      !(marketplaceSummary.token?.listings ?? []).some(
        (item) =>
          String(item?.listingId ?? "").toLowerCase() ===
          REPORTED_SPENT_SEAL_LISTING_TX,
      ),
      `${REPORTED_SPENT_SEAL_LISTING_TX} is still returned as active in marketplace summary after ${REPORTED_SPENT_SEAL_TX} spent its sale-ticket anchor`,
    );
    assert(
      !(marketplaceSummary.token?.listings ?? []).some(
        (item) =>
          String(item?.listingId ?? "").toLowerCase() ===
          REPORTED_JULY_PURCHASE_LISTING_TX,
      ),
      `${REPORTED_JULY_PURCHASE_LISTING_TX} is still returned as active in marketplace summary after ${REPORTED_JULY_PURCHASE_TX}`,
    );
    for (const txid of REPORTED_OTC_UNSEALED_LISTING_TXS) {
      const item = listingById(marketplaceSummary.token?.listings, txid);
      assert(
        item?.confirmed === true &&
          item?.sellerAddress === SELLER &&
          !item?.sealTxid,
        `${txid} is missing as an active unsealed seller listing in marketplace summary`,
      );
    }
  });

  console.log(
    `Marketplace fast regression checks passed for ${API_BASE}: ID lookup, listing lifecycle, wallet scopes, sealed/unsealed book state, and targeted WORK transfers.`,
  );
}

if (!FULL_REGRESSION_MODE) {
  await runFastMarketplaceRegressionGate();
  process.exit(0);
}

console.log(`Marketplace regression gate: full convergence audit for ${API_BASE}`);

const { elapsedMs: carbonzIdMs, json: carbonzIdPayload } = await timedGetJson(
  "/api/v1/ids/carbonz",
  { network: "livenet" },
);
assert(
  carbonzIdMs <= ID_RECORD_MAX_MS,
  `/api/v1/ids/carbonz took ${carbonzIdMs}ms, expected <= ${ID_RECORD_MAX_MS}ms`,
);
assert(
  String(carbonzIdPayload.record?.id ?? "").toLowerCase() === "carbonz" &&
    carbonzIdPayload.record?.confirmed === true,
  "/api/v1/ids/carbonz did not return the confirmed Carbonz ID record",
);

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
await assertReportedJulyPurchaseLifecycle();
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
    workAmountMatches(reportedBuySale, "60") &&
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
const reportedStaleSaleHistory = await tokenHistory("sales", {
  fresh: 1,
  q: REPORTED_STALE_SALE_TX,
});
const reportedStaleSale = (reportedStaleSaleHistory.items ?? []).find(
  (item) =>
    String(item?.txid ?? "").toLowerCase() === REPORTED_STALE_SALE_TX &&
    String(item?.listingId ?? "").toLowerCase() ===
      REPORTED_STALE_SALE_LISTING_TX,
);
assert(
  reportedStaleSale?.confirmed === true &&
    workAmountMatches(reportedStaleSale, "20000") &&
    reportedStaleSale?.priceSats === 128000 &&
    reportedStaleSale?.buyerAddress === REPORTED_STALE_SALE_BUYER &&
    reportedStaleSale?.sellerAddress === REPORTED_STALE_SALE_SELLER,
  `${REPORTED_STALE_SALE_TX} is missing or incomplete in WORK sales history`,
);
const reportedStaleMarketLog = await tokenHistory("market-log", {
  fresh: 1,
  q: REPORTED_STALE_SALE_TX,
});
assert(
  txids(reportedStaleMarketLog.items).has(REPORTED_STALE_SALE_TX),
  `${REPORTED_STALE_SALE_TX} is missing from WORK credit sales and listings log`,
);
const reportedStaleClosedListing = await tokenHistory("closed-listings", {
  fresh: 1,
  q: REPORTED_STALE_SALE_TX,
});
assert(
  (reportedStaleClosedListing.items ?? []).some(
    (item) =>
      String(item?.listingId ?? "").toLowerCase() ===
        REPORTED_STALE_SALE_LISTING_TX &&
      String(item?.closedTxid ?? "").toLowerCase() ===
        REPORTED_STALE_SALE_TX &&
      item?.closedConfirmed === true,
  ),
  `${REPORTED_STALE_SALE_TX} is missing from WORK closed-listings history`,
);
const reportedStaleActiveListing = await tokenHistory("listings", {
  fresh: 1,
  q: REPORTED_STALE_SALE_LISTING_TX,
});
assert(
  !txids(reportedStaleActiveListing.items).has(
    REPORTED_STALE_SALE_LISTING_TX,
  ),
  `${REPORTED_STALE_SALE_LISTING_TX} is still returned as an active WORK listing`,
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
    workAmountMatches(recentWaitingForSealItem, "130") &&
    recentWaitingForSealItem?.priceSats === 81325 &&
    recentWaitingForSealItem?.sellerAddress ===
      CARBONZ_TAPROOT_LISTING_ADDRESS,
  `${REPORTED_RECENT_WAITING_FOR_SEAL_LISTING_TX} is not returned as a confirmed listing event`,
);
const carbonzTaprootListingHistory = await tokenHistory("listings", {
  address: CARBONZ_TAPROOT_LISTING_ADDRESS,
});
for (const txid of [REPORTED_RECENT_WAITING_FOR_SEAL_LISTING_TX]) {
  const item = listingById(carbonzTaprootListingHistory.items, txid);
  assert(
    item?.confirmed === true,
    `${txid} is missing from cached Carbonz address-scoped listings`,
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
const {
  elapsedMs: reportedDroppedListingMs,
  json: reportedDroppedListing,
} = await timedGetJson("/api/v1/token-history", {
  network: "livenet",
  asset: WORK_TOKEN_ID,
  kind: "listings",
  limit: 20,
  q: REPORTED_DROPPED_LISTING_TX,
});
assert(
  !txids(reportedDroppedListing.items).has(REPORTED_DROPPED_LISTING_TX),
  `${REPORTED_DROPPED_LISTING_TX} is still returned as an active listing`,
);
assert(
  reportedDroppedListingMs <= EXACT_HISTORY_MAX_MS,
  `terminal listing lookup took ${reportedDroppedListingMs}ms, expected <= ${EXACT_HISTORY_MAX_MS}ms`,
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
for (const txid of REPORTED_OTC_UNSEALED_LISTING_TXS) {
  const item = listingById(walletToken.listings, txid);
  assert(
    item?.confirmed === true &&
      item?.sellerAddress === SELLER &&
      !item?.sealTxid,
    `${txid} is missing as an active unsealed seller listing in wallet-scoped token payload`,
  );
}
const walletSaleTxids = txids(walletToken.sales);
for (const txid of BUY_TXS) {
  assert(
    walletSaleTxids.has(txid),
    `${txid} is missing from wallet-scoped sales`,
  );
}
const carbonzBuyerWalletToken = await getJson("/api/v1/token", {
  network: "livenet",
  asset: WORK_TOKEN_ID,
  address: CARBONZ_REPORTED_BUY_BUYER,
  wallet: 1,
  fresh: 1,
});
const carbonzBuyerSale = (carbonzBuyerWalletToken.sales ?? []).find(
  (item) =>
    String(item?.txid ?? "").toLowerCase() === CARBONZ_REPORTED_BUY_TX,
);
assert(
  !carbonzBuyerSale,
  `${CARBONZ_REPORTED_BUY_TX} is canonically invalid but leaked into buyer wallet-scoped sales`,
);
const carbonzInvalidBuyHistory = await getJson("/api/v1/token-history", {
  network: "livenet",
  fresh: 1,
  // The rejected listing never resolved to a canonical WORK listing, so its
  // value-neutral audit event belongs to global invalid history.
  kind: "invalid-events",
  limit: 20,
  q: CARBONZ_REPORTED_BUY_TX,
});
const carbonzInvalidBuy = (carbonzInvalidBuyHistory.items ?? []).find(
  (item) =>
    String(item?.txid ?? "").toLowerCase() === CARBONZ_REPORTED_BUY_TX,
);
assert(
  carbonzInvalidBuy?.kind === "token-event-invalid" &&
    carbonzInvalidBuy?.protocol === "pwt1" &&
    carbonzInvalidBuy?.confirmed === true &&
    carbonzInvalidBuy?.valid === false &&
    carbonzInvalidBuy?.reason === "no-valid-token-event" &&
    String(carbonzInvalidBuy?.listingId ?? "").toLowerCase() ===
      CARBONZ_REPORTED_BUY_LISTING_TX &&
    carbonzInvalidBuy?.buyerAddress === CARBONZ_REPORTED_BUY_BUYER &&
    carbonzInvalidBuy?.senderAddress === CARBONZ_REPORTED_BUY_SELLER,
  `${CARBONZ_REPORTED_BUY_TX} is missing or incomplete in canonical invalid-event history`,
);
const carbonzInvalidBuyAudit = await getJson("/api/v1/event-history", {
  network: "livenet",
  kind: "token-event-invalid",
  q: CARBONZ_REPORTED_BUY_TX,
  limit: 5,
});
const carbonzInvalidBuyAuditItem = (carbonzInvalidBuyAudit.items ?? []).find(
  (item) =>
    String(item?.txid ?? "").toLowerCase() === CARBONZ_REPORTED_BUY_TX,
);
assert(
  carbonzInvalidBuyAuditItem?.kind === "token-event-invalid" &&
    carbonzInvalidBuyAuditItem?.protocol === "pwt1" &&
    carbonzInvalidBuyAuditItem?.confirmed === true &&
    carbonzInvalidBuyAuditItem?.valid === false,
  `${CARBONZ_REPORTED_BUY_TX} is missing from confirmed invalid event audit history`,
);
const {
  elapsedMs: carbonzInvalidBuyPublicLogMs,
  json: carbonzInvalidBuyPublicLog,
} = await timedGetJson("/api/v1/log-history", {
  network: "livenet",
  q: CARBONZ_REPORTED_BUY_TX,
  limit: 5,
});
assert(
  !(carbonzInvalidBuyPublicLog.items ?? []).some(
    (item) =>
      String(item?.txid ?? "").toLowerCase() === CARBONZ_REPORTED_BUY_TX,
  ),
  `${CARBONZ_REPORTED_BUY_TX} leaked into the valid-action public Log`,
);
assert(
  carbonzInvalidBuyPublicLogMs <= EXACT_HISTORY_MAX_MS,
  `invalid-only Log lookup took ${carbonzInvalidBuyPublicLogMs}ms, expected <= ${EXACT_HISTORY_MAX_MS}ms`,
);
const randomExactLogTxid = "f".repeat(64);
const {
  elapsedMs: randomExactLogMs,
  json: randomExactLog,
} = await timedGetJson("/api/v1/log-history", {
  network: "livenet",
  q: randomExactLogTxid,
  limit: 5,
});
assert(
  Number(randomExactLog.totalCount ?? 0) === 0 &&
    randomExactLog.queryDisposition === "not-indexed-proof-event",
  "random exact Log miss did not return the bounded indexed disposition",
);
assert(
  randomExactLogMs <= EXACT_HISTORY_MAX_MS,
  `random exact Log miss took ${randomExactLogMs}ms, expected <= ${EXACT_HISTORY_MAX_MS}ms`,
);
const {
  elapsedMs: randomExactLogAliasMs,
  json: randomExactLogAlias,
} = await timedGetJson("/api/v1/log", {
  network: "livenet",
  q: randomExactLogTxid,
  limit: 5,
  fresh: 1,
});
assert(
  Number(randomExactLogAlias.totalCount ?? 0) === 0 &&
    randomExactLogAlias.queryDisposition === "not-indexed-proof-event",
  "random exact fresh Log alias miss did not return the bounded indexed disposition",
);
assert(
  randomExactLogAliasMs <= EXACT_HISTORY_MAX_MS,
  `random exact fresh Log alias miss took ${randomExactLogAliasMs}ms, expected <= ${EXACT_HISTORY_MAX_MS}ms`,
);
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
    item?.confirmed === true &&
      tokenListingHasConfirmedSeal(item) &&
      String(item.sealTxid ?? "").toLowerCase() ===
        REPORTED_RECENT_WAITING_FOR_SEAL_SEAL_TX,
    `${txid} is missing its confirmed seal in Carbonz wallet-scoped listings`,
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
const carbonzDelayedTransferHistory = await tokenHistory("transfers", {
  fresh: 1,
  q: CARBONZ_DELAYED_TRANSFER_TX,
});
const carbonzDelayedTransfer = (carbonzDelayedTransferHistory.items ?? []).find(
  (item) =>
    String(item?.txid ?? "").toLowerCase() === CARBONZ_DELAYED_TRANSFER_TX &&
    item?.confirmed === true,
);
assert(
  workAmountMatches(carbonzDelayedTransfer, "20000") &&
    carbonzDelayedTransfer?.senderAddress === CARBONZ_DELAYED_TRANSFER_SENDER &&
    carbonzDelayedTransfer?.recipientAddress ===
      CARBONZ_DELAYED_TRANSFER_RECIPIENT,
  `${CARBONZ_DELAYED_TRANSFER_TX} is missing or incomplete in WORK transfer history`,
);
for (const address of [
  CARBONZ_DELAYED_TRANSFER_SENDER,
  CARBONZ_DELAYED_TRANSFER_RECIPIENT,
]) {
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
        String(item?.txid ?? "").toLowerCase() ===
          CARBONZ_DELAYED_TRANSFER_TX &&
        item?.confirmed === true &&
        item?.senderAddress === CARBONZ_DELAYED_TRANSFER_SENDER &&
        item?.recipientAddress === CARBONZ_DELAYED_TRANSFER_RECIPIENT,
    ),
    `${CARBONZ_DELAYED_TRANSFER_TX} is missing from ${address} wallet-scoped transfers`,
  );
}
const delayedRecipientWallet = await getJson("/api/v1/token-summary", {
  network: "livenet",
  asset: WORK_TOKEN_ID,
  address: CARBONZ_DELAYED_TRANSFER_RECIPIENT,
  wallet: 1,
  fresh: 1,
});
const delayedRecipientHolder = holderByAddress(
  delayedRecipientWallet.holders,
  CARBONZ_DELAYED_TRANSFER_RECIPIENT,
);
assert(
  Number(delayedRecipientHolder?.balance ?? 0) >= 20000,
  `${CARBONZ_DELAYED_TRANSFER_RECIPIENT} wallet summary did not include the confirmed WORK transfer balance`,
);
const carbonzPowbTransferHistory = await tokenHistoryForAsset(
  POWB_TOKEN_ID,
  "transfers",
  {
    fresh: 1,
    q: CARBONZ_POWB_TRANSFER_TX,
  },
);
assert(
  (carbonzPowbTransferHistory.items ?? []).some(
    (item) =>
      String(item?.txid ?? "").toLowerCase() === CARBONZ_POWB_TRANSFER_TX &&
      item?.confirmed === true,
  ),
  `${CARBONZ_POWB_TRANSFER_TX} is missing from POWB transfer history`,
);

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
assert(
  !(marketplaceSummary.token?.listings ?? []).some(
    (item) =>
      String(item?.listingId ?? "").toLowerCase() ===
      REPORTED_SPENT_SEAL_LISTING_TX,
  ),
  `${REPORTED_SPENT_SEAL_LISTING_TX} is still returned as active in marketplace summary after ${REPORTED_SPENT_SEAL_TX} spent its sale-ticket anchor`,
);
for (const txid of REPORTED_OTC_UNSEALED_LISTING_TXS) {
  const item = listingById(marketplaceSummary.token?.listings, txid);
  assert(
    item?.confirmed === true &&
      item?.sellerAddress === SELLER &&
      !item?.sealTxid,
    `${txid} is missing as an active unsealed seller listing in marketplace summary`,
  );
}
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
  !(marketplaceFreshSummary.token?.listings ?? []).some(
    (item) =>
      String(item?.listingId ?? "").toLowerCase() ===
      REPORTED_SPENT_SEAL_LISTING_TX,
  ),
  `${REPORTED_SPENT_SEAL_LISTING_TX} is still returned in fresh marketplace summary after ${REPORTED_SPENT_SEAL_TX} spent its sale-ticket anchor`,
);
assert(
  (marketplaceFreshSummary.token?.listings ?? []).some(
    (item) =>
      String(item?.listingId ?? "").toLowerCase() ===
        REPORTED_RECENT_WAITING_FOR_SEAL_LISTING_TX &&
      item?.confirmed === true &&
      tokenListingHasConfirmedSeal(item) &&
      String(item.sealTxid ?? "").toLowerCase() ===
        REPORTED_RECENT_WAITING_FOR_SEAL_SEAL_TX,
  ),
  `${REPORTED_RECENT_WAITING_FOR_SEAL_LISTING_TX} is missing its confirmed seal in fresh marketplace summary listings`,
);
for (const txid of REPORTED_OTC_UNSEALED_LISTING_TXS) {
  const item = listingById(marketplaceFreshSummary.token?.listings, txid);
  assert(
    item?.confirmed === true &&
      item?.sellerAddress === SELLER &&
      !item?.sealTxid,
    `${txid} is missing as an active unsealed seller listing in fresh marketplace summary`,
  );
}
const workToken = await getJson("/api/v1/token", {
  network: "livenet",
  asset: WORK_TOKEN_ID,
  fresh: 1,
});
const [workSummary, workTokenSummary, growthSummary] = await Promise.all([
  getJson("/api/v1/work-summary", {
    network: "livenet",
    fresh: 1,
  }),
  getJson("/api/v1/token-summary", {
    network: "livenet",
    asset: WORK_TOKEN_ID,
    fresh: 1,
  }),
  getJson("/api/v1/growth-summary", {
    network: "livenet",
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
assert(
  workSummary.snapshotId === marketplaceFreshSummary.snapshotId &&
    workSummary.snapshotId === growthSummary.snapshotId,
  `summary snapshot mismatch: work=${workSummary.snapshotId ?? "none"} marketplace=${marketplaceFreshSummary.snapshotId ?? "none"} growth=${growthSummary.snapshotId ?? "none"}`,
);
assert(
  numbersAgree(
    workSummary.floor?.networkValueSats,
    marketplaceFreshSummary.workFloor?.networkValueSats,
  ) &&
    numbersAgree(
      workSummary.floor?.networkValueSats,
      growthSummary.workFloor?.networkValueSats,
    ) &&
    numbersAgree(
      workSummary.floor?.networkValueSats,
      growthSummary.actualValue?.totalSats,
    ),
  `summary network value mismatch: work=${workSummary.floor?.networkValueSats} marketplace=${marketplaceFreshSummary.workFloor?.networkValueSats} growthFloor=${growthSummary.workFloor?.networkValueSats} growth=${growthSummary.actualValue?.totalSats}`,
);
assert(
  numbersAgree(
    workSummary.floor?.floorSats,
    marketplaceFreshSummary.workFloor?.floorSats,
  ) &&
    numbersAgree(
      workSummary.floor?.floorSats,
      growthSummary.workFloor?.floorSats,
    ),
  `WORK floor mismatch: work=${workSummary.floor?.floorSats} marketplace=${marketplaceFreshSummary.workFloor?.floorSats} growth=${growthSummary.workFloor?.floorSats}`,
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
const carbonzActiveListing = (carbonzWalletToken.listings ?? []).find(
  (item) => String(item?.listingId ?? "").toLowerCase() === CARBONZ_LISTING_TX,
);
assert(
  !carbonzActiveListing,
  `${CARBONZ_LISTING_TX} was sold by ${CARBONZ_SALE_TX} but remains active in the carbonz wallet-scoped token payload`,
);
const carbonzClosedListing = (carbonzWalletToken.closedListings ?? []).find(
  (item) => String(item?.listingId ?? "").toLowerCase() === CARBONZ_LISTING_TX,
);
assert(
  carbonzClosedListing?.closedConfirmed === true &&
    String(carbonzClosedListing.closedTxid ?? "").toLowerCase() ===
      CARBONZ_SALE_TX &&
    carbonzClosedListing.sealConfirmed === true &&
    String(carbonzClosedListing.sealTxid ?? "").toLowerCase() ===
      CARBONZ_SEAL_TX,
  `${CARBONZ_LISTING_TX} is missing its confirmed seal and sale close in carbonz wallet-scoped history`,
);
assert(
  (carbonzWalletToken.sales ?? []).some(
    (item) =>
      String(item?.listingId ?? "").toLowerCase() === CARBONZ_LISTING_TX &&
      String(item?.txid ?? item?.saleTxid ?? "").toLowerCase() ===
        CARBONZ_SALE_TX &&
      item?.confirmed === true,
  ),
  `${CARBONZ_SALE_TX} is missing from carbonz wallet-scoped sales`,
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
const reportedStaleLogSale = await getJson("/api/v1/log-history", {
  network: "livenet",
  q: REPORTED_STALE_SALE_TX,
  limit: 5,
});
assertRenderableLogItems(reportedStaleLogSale, "reported stale sale Log search");
assert(
  (reportedStaleLogSale.items ?? []).some(
    (item) =>
      item?.kind === "token-sale" &&
      String(item?.txid ?? "").toLowerCase() === REPORTED_STALE_SALE_TX &&
      item?.confirmed === true,
  ),
  `${REPORTED_STALE_SALE_TX} is not logged as a confirmed token sale`,
);
const reportedPowbTransferLog = await getJson("/api/v1/log-history", {
  network: "livenet",
  q: CARBONZ_POWB_TRANSFER_TX,
  limit: 5,
});
assertRenderableLogItems(reportedPowbTransferLog, "reported POWB transfer Log search");
assert(
  (reportedPowbTransferLog.items ?? []).some(
    (item) =>
      item?.kind === "token-transfer" &&
      String(item?.txid ?? "").toLowerCase() === CARBONZ_POWB_TRANSFER_TX &&
      item?.confirmed === true,
  ),
  `${CARBONZ_POWB_TRANSFER_TX} is not logged as a confirmed token transfer`,
);

console.log(
  `Marketplace full regression checks passed for ${API_BASE}: delist, fresh summaries, sealed listings, sales, wallet, and Log close status.`,
);
