#!/usr/bin/env node

import fs from "node:fs";
import {
  parseWorkAmountToAtoms,
  parseWorkAmountToSubatoms,
} from "../server/work-units.mjs";
import {
  MarketplaceRegressionHttpError,
  createCanonicalConvergenceBudget,
  isRetryableWorkAmoV5TipRaceStatus,
  marketplaceRegressionCanonicalReadKind,
  waitForCanonicalConvergenceWithinBudget,
} from "./marketplace-canonical-convergence.mjs";

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
const WORK_MARKET_V2_ACTIVATION_HEIGHT = 959_062;
const WORK_MARKET_V2_DECLARATION_TXID =
  "4c53252c6e9279726e1456f4d846274bfa33f778b633d32a68ed36906b38083f";
const WORK_MARKET_V2_REASON_CODE = "work-market-v2-version-required";
const WORK_MARKET_V3_AUTH_VERSION = "pwt-sale-v3";
const WORK_MARKET_V4_AUTH_VERSION = "pwt-sale-v4";
const WORK_MARKET_V4_ORACLE_MODEL =
  "canonical-work-market-confirmation-floor-v1";
const WORK_AMO_V5_AUTH_VERSION = "pwt-sale-v5";
const WORK_AMO_V5_DECLARATION_TXID =
  "54d7a367a3998ce1327ee89d983a25c80ce34b96d9811807df215a8694aead36";
const WORK_AMO_V5_DECLARATION_BLOCK_HASH =
  "0000000000000000000094195957f498f894c92f5d5f75ff5b9c9afc749a6811";
const WORK_AMO_V5_DECLARATION_HEIGHT = 959_620;
const WORK_AMO_V5_DECLARATION_BLOCK_INDEX = 141;
const WORK_AMO_V5_ACTIVATION_HEIGHT = 959_621;
const WORK_AMO_V5_V1_ACTIVATION_HEIGHT = 959_306;
const WORK_AMO_V5_ALLOWED_FACE_USD_CENTS = [2_000, 5_000, 10_000];
const WORK_AMO_V5_MAX_QUOTE_AGE_BLOCKS = 144;
const WORK_AMO_V5_PRE_V1_RELIC_LISTING_TX =
  "4e9cedced2252cd183608dc9176415a913c4f6aa5e8307a732179a2240b6feb1";
const WORK_AMO_V5_POST_V1_INVALID_LISTING_TX =
  "5eb0a876603a7551653806b932533dc27a884631a581caa2e36dcf129b8278e8";
const WORK_AMO_V5_MODELS = {
  amountModel: "canonical-confirmed-position-derived-work-amount-v1",
  bondTransitionModel: "canonical-compute-then-bond-v1",
  stateOrderModel: "canonical-proof-state-order-v1",
  unitModel: "canonical-work-amo-usd-unit-v2",
  unitUsdOracleModel: "canonical-amo-chain-usd-quote-v1",
  unitWorkOracleModel: "canonical-work-prefix-before-action-v1",
};
const WORK_AMO_V6_AUTH_VERSION = "pwt-sale-v6";
const WORK_AMO_V6_ALLOWED_FACE_PROOFS = [20_000, 50_000, 100_000];
const WORK_AMO_V8_AUTH_VERSION = "pwt-sale-v8";
const WORK_AMO_V8_ALLOWED_FACE_PROOFS = [25_000];
const WORK_AMO_V8_DECLARATION_TXID =
  "f90e1faf572ef8253ca5959731b9d9e99c74bced4397380059878936712bee7a";
const WORK_AMO_V8_DECLARATION_BLOCK_HASH =
  "00000000000000000001ec938998cde4fd86ee6e3c672a6d3d95200cd8a984ac";
const WORK_AMO_V8_DECLARATION_HEIGHT = 960_600;
const WORK_AMO_V8_DECLARATION_BLOCK_INDEX = 2_369;
const WORK_AMO_V8_DECLARATION_PROTOCOL_VOUT = 3;
const WORK_AMO_V8_DECLARATION_RECORD_ORDINAL = 0;
const WORK_AMO_V8_DECLARATION_REGISTRY_PAYMENT_VOUT = 4;
const WORK_AMO_V8_DECLARATION_MEMO_SHA256 =
  "1ba53b285f95f8d69f0272c8e75c76b09cd3bd26281c68e665749368e7694528";
const WORK_AMO_V8_DECLARATION_MEMO_BYTES = 5_593;
const WORK_AMO_V8_ACTIVATION_HEIGHT = 960_601;
const WORK_AMO_V8_PRECISION = Object.freeze({
  amountStorageModel: "work-subatoms-v2",
  decimals: 16,
  unitScale: "10000000000000000",
});
const WORK_AMO_V6_FIRST_LISTING_TX =
  "b259fa601676287eca2ea94c9142cd13b45fde7031ec98967f15306df6ef7936";
const WORK_AMO_V6_FIRST_LISTING_BLOCK_HASH =
  "00000000000000000000a5ea8861570ed551f77ed3cc0bddc3db3958d2700b44";
const WORK_AMO_V6_FIRST_LISTING_SELLER =
  "18hkqE81wQuq75UEBKhB4JjAuQg47jN7Aa";
const WORK_AMO_V6_FIRST_LISTING_CLOSE_TX =
  "4d8f0c92c19a6904e46594975d4b17139d5937209ce5b245844677cd3491bfe0";
const WORK_AMO_V6_FIRST_LISTING_CLOSE_BLOCK_HASH =
  "00000000000000000000700a55e93d0a769d861e956868c04ede0185ec929569";
const WORK_MARKET_V2_LATE_SEAL_LISTING_TX =
  "9c79f121eb73f079b330950a2890ba2029416e5b75bafadc642623c66fd963f9";
const WORK_MARKET_V2_LATE_SEAL_TX =
  "5575f61bb7f42ef26bf56b1575a8ae43fec54c43a5d3b71057bc8fd4839a1af1";
const WORK_MARKET_V2_POST_ACTIVATION_LISTING_TX =
  "df317cbbfdc603a390ee0f8b027ba8f0d08ef2200ce914b0b3e7dd46ce0982ce";
const WORK_MARKET_V1_REFUND_SNAPSHOT = JSON.parse(
  fs.readFileSync(
    new URL("../WORK_MARKET_V1_REFUNDS_959061.json", import.meta.url),
    "utf8",
  ),
);
const WORK_MARKET_V1_RELIC_IDS = new Set(
  WORK_MARKET_V1_REFUND_SNAPSHOT.listings.map((listing) => listing.listingId),
);
const WORK_MARKET_V1_REFUND_LISTINGS_BY_ID = new Map(
  WORK_MARKET_V1_REFUND_SNAPSHOT.listings.map((listing) => [
    String(listing?.listingId ?? "").toLowerCase(),
    listing,
  ]),
);
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
const REPORTED_DROPPED_CLOSE_TX =
  "36a298da7f67a24b0c19d75ea354f61466b347da65d2226b151af50c60d15c67";
const REPORTED_DROPPED_CLOSE_LISTING_TX =
  "351f6305ae5d193469e7966553e749ea0b31debd758503a5381cba844dfd240c";
const REPORTED_DROPPED_CLOSE_SELLER =
  "bc1pl8vmv8y4k37jvw77cn7y8tckeawrm5u2n50qrjvglgrp04hczvtq5jyum0";
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
const WORK_AMO_CONVERGENCE_MAX_MS = Math.min(
  300_000,
  Math.max(
    1_000,
    Number(
      process.env.MARKETPLACE_AMO_V5_CONVERGENCE_MAX_MS ?? 180_000,
    ) || 180_000,
  ),
);
const WORK_AMO_CONVERGENCE_POLL_MS = Math.min(
  10_000,
  Math.max(
    100,
    Number(
      process.env.MARKETPLACE_AMO_V5_CONVERGENCE_POLL_MS ?? 2_000,
    ) || 2_000,
  ),
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
    const expectedSubatoms = parseWorkAmountToSubatoms(expectedAmount, {
      allowZero: true,
    });
    const amountAtoms = record?.amountAtoms;
    const amountSubatoms = record?.amountSubatoms;
    const hasAmountAtoms =
      amountAtoms !== undefined && amountAtoms !== null && amountAtoms !== "";
    const hasAmountSubatoms =
      amountSubatoms !== undefined &&
      amountSubatoms !== null &&
      amountSubatoms !== "";
    if (typeof record?.amount === "number") {
      return (
        !hasAmountAtoms &&
        !hasAmountSubatoms &&
        Number.isSafeInteger(record.amount) &&
        parseWorkAmountToAtoms(record.amount, { allowZero: true }) ===
          expectedAtoms
      );
    }
    const q8Historical =
      typeof record?.amount === "string" &&
      record.amount === expectedAmount &&
      typeof amountAtoms === "string" &&
      amountAtoms === expectedAtoms &&
      !hasAmountSubatoms;
    const q16Current =
      typeof record?.amount === "string" &&
      record.amount === expectedAmount &&
      !hasAmountAtoms &&
      typeof amountSubatoms === "string" &&
      amountSubatoms === expectedSubatoms &&
      record?.amountStorageModel ===
        WORK_AMO_V8_PRECISION.amountStorageModel &&
      Number(record?.decimals) === WORK_AMO_V8_PRECISION.decimals &&
      String(record?.unitScale ?? "") === WORK_AMO_V8_PRECISION.unitScale;
    return q8Historical || q16Current;
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

async function requestJson(
  path,
  params = {},
  {
    canonicalErrorDetails = false,
    retryCount = REQUEST_RETRY_COUNT,
    timeoutMs = REQUEST_TIMEOUT_MS,
  } = {},
) {
  const url = new URL(path, `${API_BASE}/`);
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null && value !== "") {
      url.searchParams.set(key, String(value));
    }
  }
  const requestStartedAt = Date.now();
  console.log(`GET   [${GATE_LABEL}] ${url.pathname}${url.search}`);
  let lastError = null;
  for (let attempt = 0; attempt <= retryCount; attempt += 1) {
    try {
      const response = await fetch(url, {
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (response.ok) {
        console.log(
          `OK    [${GATE_LABEL}] ${url.pathname}${url.search} ${elapsedMs(
            requestStartedAt,
          )}`,
        );
        return response.json();
      }
      let responseError = new Error(
        `${url} returned HTTP ${response.status}`,
      );
      if (canonicalErrorDetails) {
        let errorPayload = null;
        try {
          errorPayload = await response.json();
        } catch {
          // A non-JSON server failure is never eligible for canonical
          // convergence retries, but preserve the HTTP status for diagnostics.
        }
        responseError = new MarketplaceRegressionHttpError(
          url,
          response.status,
          errorPayload,
        );
      }
      const retryableStatus = [500, 502, 503, 504].includes(response.status);
      if (!retryableStatus || attempt >= retryCount) {
        console.error(
          `BAD   [${GATE_LABEL}] ${url.pathname}${url.search} HTTP ${
            response.status
          } ${elapsedMs(requestStartedAt)}`,
        );
        throw responseError;
      }
      lastError = responseError;
    } catch (error) {
      lastError = error;
      const retryableError =
        error?.name === "TimeoutError" ||
        String(error?.message ?? "").includes("fetch failed");
      if (!retryableError || attempt >= retryCount) {
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
      }/${retryCount + 1}`,
    );
    await new Promise((resolve) =>
      setTimeout(resolve, 1_000 * (attempt + 1)),
    );
  }
  throw lastError;
}

const marketplaceCanonicalConvergenceBudget =
  createCanonicalConvergenceBudget(WORK_AMO_CONVERGENCE_MAX_MS);

async function convergedFreshCanonicalJson(path, params, kind) {
  return waitForCanonicalConvergenceWithinBudget({
    budget: marketplaceCanonicalConvergenceBudget,
    isReady: (payload) =>
      kind !== "work-token" ||
      canonicalWorkAmoStatusIndexReady(payload),
    isRetryableValue:
      kind === "work-token"
        ? isRetryableWorkAmoTipRacePayload
        : () => false,
    label:
      kind === "work-token"
        ? "WORK AMO canonical token readiness"
        : `fresh canonical ${path} readiness`,
    pollIntervalMs: WORK_AMO_CONVERGENCE_POLL_MS,
    read: ({ remainingMs }) =>
      requestJson(path, params, {
        canonicalErrorDetails: true,
        retryCount: 0,
        timeoutMs: Math.max(
          1,
          Math.min(REQUEST_TIMEOUT_MS, Math.floor(remainingMs)),
        ),
      }),
    onRetry: ({ attempt, delayMs, error }) => {
      const reason =
        error?.code ||
        error?.serverMessage ||
        (kind === "work-token"
          ? "work-amo-index-not-ready"
          : "canonical-index-catching-up");
      console.log(
        `WAIT  [${GATE_LABEL}] ${kind === "work-token" ? "WORK AMO token" : path} canonical convergence after attempt ${attempt}: ${reason}; retrying in ${delayMs}ms`,
      );
    },
  });
}

async function getJson(
  path,
  params = {},
  {
    retryCount = REQUEST_RETRY_COUNT,
    timeoutMs = REQUEST_TIMEOUT_MS,
  } = {},
) {
  const convergenceKind = marketplaceRegressionCanonicalReadKind({
    path,
    params,
    workTokenId: WORK_TOKEN_ID,
  });
  if (convergenceKind) {
    return convergedFreshCanonicalJson(path, params, convergenceKind);
  }
  return requestJson(path, params, { retryCount, timeoutMs });
}

function canonicalSummarySnapshotIds(summarySet) {
  return [
    summarySet?.marketplace?.snapshotId,
    summarySet?.token?.snapshotId,
    summarySet?.work?.snapshotId,
    summarySet?.growth?.snapshotId,
  ].map((value) => String(value ?? "").trim());
}

function canonicalSummarySetHasOneSnapshot(summarySet) {
  const snapshotIds = canonicalSummarySnapshotIds(summarySet);
  return (
    snapshotIds.every((snapshotId) => snapshotId !== "") &&
    new Set(snapshotIds).size === 1
  );
}

async function convergedFreshCanonicalSummarySet() {
  return waitForCanonicalConvergenceWithinBudget({
    budget: marketplaceCanonicalConvergenceBudget,
    isReady: canonicalSummarySetHasOneSnapshot,
    isRetryableValue: (summarySet) =>
      canonicalSummarySnapshotIds(summarySet).every(
        (snapshotId) => snapshotId !== "",
      ),
    label: "fresh canonical summary snapshot alignment",
    pollIntervalMs: WORK_AMO_CONVERGENCE_POLL_MS,
    read: async ({ remainingMs }) => {
      const requestOptions = {
        canonicalErrorDetails: true,
        retryCount: 0,
        timeoutMs: Math.max(
          1,
          Math.min(REQUEST_TIMEOUT_MS, Math.floor(remainingMs)),
        ),
      };
      const [marketplace, token, work, growth] = await Promise.all([
        requestJson(
          "/api/v1/marketplace-summary",
          { fresh: 1, network: "livenet" },
          requestOptions,
        ),
        requestJson(
          "/api/v1/token-summary",
          { asset: WORK_TOKEN_ID, fresh: 1, network: "livenet" },
          requestOptions,
        ),
        requestJson(
          "/api/v1/work-summary",
          { fresh: 1, network: "livenet" },
          requestOptions,
        ),
        requestJson(
          "/api/v1/growth-summary",
          { fresh: 1, network: "livenet" },
          requestOptions,
        ),
      ]);
      return { growth, marketplace, token, work };
    },
    onRetry: ({ attempt, delayMs, error }) => {
      console.log(
        `WAIT  [${GATE_LABEL}] canonical summary snapshot alignment after attempt ${attempt}: ${
          error?.code ?? error?.serverMessage ?? "snapshot-id-transition"
        }; retrying in ${delayMs}ms`,
      );
    },
  });
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
  const lifecycleSignature = (page) =>
    (page.items ?? [])
      .filter(
        (item) =>
          String(item?.txid ?? "").toLowerCase() ===
          REPORTED_JULY_PURCHASE_TX,
      )
      .map((item) => `${item.kind}:${item.txid}:${item.createdAt}`);
  const expectedLifecycle = [
    `sale:${REPORTED_JULY_PURCHASE_TX}:2026-07-12T01:52:42.000Z`,
    `closed-listing:${REPORTED_JULY_PURCHASE_TX}:2026-07-12T01:52:42.000Z`,
  ];
  assert(
    JSON.stringify(lifecycleSignature(marketLog)) ===
      JSON.stringify(expectedLifecycle),
    `${REPORTED_JULY_PURCHASE_TX} market lifecycle order is unstable`,
  );
  const repeatedMarketLog = await tokenHistory("market-log", {
    fresh: 1,
    q: REPORTED_JULY_PURCHASE_TX,
  });
  assert(
    JSON.stringify(lifecycleSignature(repeatedMarketLog)) ===
      JSON.stringify(expectedLifecycle),
    `${REPORTED_JULY_PURCHASE_TX} market lifecycle changed between reads`,
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

async function assertDroppedCloseCannotHideActiveListing() {
  const status = await getJson(
    `/api/v1/tx/${REPORTED_DROPPED_CLOSE_TX}/status`,
    { network: "livenet" },
  );
  assert(
    status?.status === "dropped" && status?.absenceProven === true,
    `${REPORTED_DROPPED_CLOSE_TX} is not full-node proven dropped`,
  );

  const { elapsedMs: marketLogMs, json: marketLog } = await timedGetJson(
    "/api/v1/token-history",
    {
      network: "livenet",
      asset: WORK_TOKEN_ID,
      kind: "market-log",
      limit: 20,
      fresh: 1,
      q: REPORTED_DROPPED_CLOSE_TX,
    },
  );
  assert(
    marketLogMs <= EXACT_HISTORY_MAX_MS,
    `terminal WORK market-log lookup took ${marketLogMs}ms, expected <= ${EXACT_HISTORY_MAX_MS}ms`,
  );
  assert(
    !txids(marketLog.items).has(REPORTED_DROPPED_CLOSE_TX),
    `${REPORTED_DROPPED_CLOSE_TX} leaked into WORK market-log history`,
  );
  assert(
    marketLog.queryDisposition === "terminal-nonmarket",
    `${REPORTED_DROPPED_CLOSE_TX} market-log miss lacks terminal disposition`,
  );

  const { elapsedMs: closedListingsMs, json: closedListings } =
    await timedGetJson("/api/v1/token-history", {
      network: "livenet",
      asset: WORK_TOKEN_ID,
      kind: "closed-listings",
      limit: 20,
      fresh: 1,
      q: REPORTED_DROPPED_CLOSE_TX,
    });
  assert(
    closedListingsMs <= EXACT_HISTORY_MAX_MS,
    `terminal WORK closed-listing lookup took ${closedListingsMs}ms, expected <= ${EXACT_HISTORY_MAX_MS}ms`,
  );
  assert(
    !txids(closedListings.items).has(REPORTED_DROPPED_CLOSE_TX),
    `${REPORTED_DROPPED_CLOSE_TX} leaked into WORK closed-listing history`,
  );
  assert(
    closedListings.queryDisposition === "terminal-nonmarket",
    `${REPORTED_DROPPED_CLOSE_TX} closed-listing miss lacks terminal disposition`,
  );

  const activeListings = await tokenHistory("listings", {
    fresh: 1,
    q: REPORTED_DROPPED_CLOSE_LISTING_TX,
  });
  assert(
    !listingById(activeListings.items, REPORTED_DROPPED_CLOSE_LISTING_TX),
    `${REPORTED_DROPPED_CLOSE_LISTING_TX} remained active after the Marketplace V2 cutover`,
  );
  const relicToken = await getJson("/api/v1/token", {
    network: "livenet",
    asset: WORK_TOKEN_ID,
    fresh: 1,
  });
  const relicListing = listingById(
    relicToken.closedListings,
    REPORTED_DROPPED_CLOSE_LISTING_TX,
  );
  const refundSnapshotListing = WORK_MARKET_V1_REFUND_LISTINGS_BY_ID.get(
    REPORTED_DROPPED_CLOSE_LISTING_TX,
  );
  assert(
    refundSnapshotListing &&
      String(refundSnapshotListing.sellerAddress ?? "") ===
        REPORTED_DROPPED_CLOSE_SELLER,
    `${REPORTED_DROPPED_CLOSE_LISTING_TX} is missing from the immutable V1 refund snapshot after dropped close ${REPORTED_DROPPED_CLOSE_TX}`,
  );
  if (relicListing) {
    assert(
      relicListing.relic === true && relicListing.refundEligible === true,
      `${REPORTED_DROPPED_CLOSE_LISTING_TX} has invalid projected refund metadata after dropped close ${REPORTED_DROPPED_CLOSE_TX}`,
    );
  }

  const walletToken = await getJson("/api/v1/token", {
    network: "livenet",
    asset: WORK_TOKEN_ID,
    address: REPORTED_DROPPED_CLOSE_SELLER,
    wallet: 1,
    fresh: 1,
  });
  assert(
    !listingById(walletToken.listings, REPORTED_DROPPED_CLOSE_LISTING_TX),
    `${REPORTED_DROPPED_CLOSE_LISTING_TX} remained active in its seller wallet after the Marketplace V2 cutover`,
  );
  assert(
    !(walletToken.closedListings ?? []).some(
      (item) =>
        String(item?.closedTxid ?? item?.txid ?? "").toLowerCase() ===
        REPORTED_DROPPED_CLOSE_TX,
    ),
    `${REPORTED_DROPPED_CLOSE_TX} leaked into seller wallet closed listings`,
  );

  const marketplaceSummary = await getJson("/api/v1/marketplace-summary", {
    network: "livenet",
    fresh: 1,
  });
  assert(
    !listingById(
      marketplaceSummary.token?.listings,
      REPORTED_DROPPED_CLOSE_LISTING_TX,
    ),
    `${REPORTED_DROPPED_CLOSE_LISTING_TX} remained active in Marketplace summary after the V2 cutover`,
  );
  assert(
    !(marketplaceSummary.token?.closedListings ?? []).some(
      (item) =>
        String(item?.closedTxid ?? item?.txid ?? "").toLowerCase() ===
        REPORTED_DROPPED_CLOSE_TX,
    ),
    `${REPORTED_DROPPED_CLOSE_TX} leaked into Marketplace summary closed listings`,
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

function workListingAuthorizationVersion(listing) {
  return String(
    listing?.saleAuthorization?.version ?? listing?.version ?? "",
  )
    .trim()
    .toLowerCase();
}

function isLegacyWorkListing(listing) {
  return (
    String(
      listing?.tokenId ?? listing?.saleAuthorization?.tokenId ?? "",
    )
      .trim()
      .toLowerCase() === WORK_TOKEN_ID &&
    ["pwt-sale-v1", "pwt-sale-v2"].includes(
      workListingAuthorizationVersion(listing),
    )
  );
}

function validWorkMarketV4DeclarationCoordinates(value) {
  const declarationHeight = Number(value?.declarationHeight);
  const activationHeight = Number(value?.activationHeight);
  return (
    /^[0-9a-f]{64}$/u.test(
      String(value?.declarationTxid ?? "").trim().toLowerCase(),
    ) &&
    /^[0-9a-f]{64}$/u.test(
      String(value?.declarationBlockHash ?? "").trim().toLowerCase(),
    ) &&
    Number.isSafeInteger(declarationHeight) &&
    declarationHeight > 0 &&
    activationHeight === declarationHeight + 1
  );
}

function workAmoV5StatusFromPayload(payload, context = payload) {
  return [
    context?.workAmoV5,
    context?.floor?.workAmoV5,
    context?.workFloor?.workAmoV5,
    payload?.workAmoV5,
  ].find((status) => status && typeof status === "object");
}

function workAmoV6StatusFromPayload(payload, context = payload) {
  return [
    context?.workAmoV6,
    context?.floor?.workAmoV6,
    context?.workFloor?.workAmoV6,
    payload?.workAmoV6,
  ].find((status) => status && typeof status === "object");
}

function workAmoV8StatusFromPayload(payload, context = payload) {
  return [
    context?.workAmoV8,
    context?.floor?.workAmoV8,
    context?.workFloor?.workAmoV8,
    payload?.workAmoV8,
  ].find((status) => status && typeof status === "object");
}

function workAmoV8IsAuthoritative(status) {
  return (
    status?.activation?.reached === true ||
    status?.migrationReadiness?.active === true
  );
}

function workAmoV8StatusIndexReady(status) {
  return (
    workAmoV8IsAuthoritative(status) &&
    status?.version === WORK_AMO_V8_AUTH_VERSION &&
    status?.indexReady === true &&
    status?.ready === true &&
    status?.migrationReadiness?.ready === true
  );
}

function canonicalWorkAmoStatusIndexReady(payload) {
  const v8 = workAmoV8StatusFromPayload(payload);
  if (workAmoV8IsAuthoritative(v8)) {
    return workAmoV8StatusIndexReady(v8);
  }
  const v6 = workAmoV6StatusFromPayload(payload);
  return v6?.pinsConfigured === true
    ? v6.indexReady === true
    : workAmoV5StatusFromPayload(payload)?.indexReady === true;
}

function isRetryableWorkAmoTipRacePayload(payload) {
  const v8 = workAmoV8StatusFromPayload(payload);
  if (workAmoV8IsAuthoritative(v8)) {
    return !workAmoV8StatusIndexReady(v8);
  }
  const v6 = workAmoV6StatusFromPayload(payload);
  return v6?.pinsConfigured === true && v6.indexReady !== true
    ? true
    : isRetryableWorkAmoV5TipRacePayload(payload);
}

function isRetryableWorkAmoV5TipRacePayload(payload) {
  return isRetryableWorkAmoV5TipRaceStatus(
    workAmoV5StatusFromPayload(payload),
    {
      activationHeight: WORK_AMO_V5_ACTIVATION_HEIGHT,
      allowedFaceUsdCents: WORK_AMO_V5_ALLOWED_FACE_USD_CENTS,
      authVersion: WORK_AMO_V5_AUTH_VERSION,
      declarationBlockHash: WORK_AMO_V5_DECLARATION_BLOCK_HASH,
      declarationBlockIndex: WORK_AMO_V5_DECLARATION_BLOCK_INDEX,
      declarationHeight: WORK_AMO_V5_DECLARATION_HEIGHT,
      declarationTxid: WORK_AMO_V5_DECLARATION_TXID,
      maxQuoteAgeBlocks: WORK_AMO_V5_MAX_QUOTE_AGE_BLOCKS,
      models: WORK_AMO_V5_MODELS,
    },
  );
}

async function convergedWorkAmoToken({ fresh = true } = {}) {
  return getJson("/api/v1/token", {
    network: "livenet",
    asset: WORK_TOKEN_ID,
    ...(fresh ? { fresh: 1 } : {}),
  });
}

function assertWorkAmoV5Readiness(payload, label, context = payload) {
  const status = workAmoV5StatusFromPayload(payload, context);
  const v8Authoritative = workAmoV8IsAuthoritative(
    workAmoV8StatusFromPayload(payload, context),
  );
  assert(status, `${label} is missing WORK AMO V5 status`);
  assert(
    status.active === true &&
      status.authVersion === WORK_AMO_V5_AUTH_VERSION &&
      status.declarationConfirmed === true &&
      status.declarationTxid === WORK_AMO_V5_DECLARATION_TXID &&
      status.declarationBlockHash === WORK_AMO_V5_DECLARATION_BLOCK_HASH &&
      Number(status.declarationHeight) === WORK_AMO_V5_DECLARATION_HEIGHT &&
      Number(status.declarationBlockIndex) ===
        WORK_AMO_V5_DECLARATION_BLOCK_INDEX &&
      Number(status.activationHeight) === WORK_AMO_V5_ACTIVATION_HEIGHT,
    `${label} does not expose the exact confirmed AMO V5 declaration`,
  );
  assert(
    JSON.stringify(status.allowedFaceUsdCents) ===
      JSON.stringify(WORK_AMO_V5_ALLOWED_FACE_USD_CENTS) &&
      Number(status.maxQuoteAgeBlocks) ===
        WORK_AMO_V5_MAX_QUOTE_AGE_BLOCKS,
    `${label} does not expose exactly the $20, $50, and $100 V5 faces`,
  );
  assert(
    Object.entries(WORK_AMO_V5_MODELS).every(
      ([key, value]) => status.models?.[key] === value,
    ),
    `${label} does not expose the exact AMO V5 model identifiers`,
  );
  if (v8Authoritative) {
    assert(
      status.indexReady === false &&
        status.protocolWritesEnabled === false &&
        status.listingWritesEnabled === false &&
        status.writesEnabled === false &&
        status.quoteReady === false &&
        status.quoteHead === null &&
        status.reasonCode === "work-amo-v5-index-not-ready",
      `${label} did not preserve V5 as closed historical evidence after V8 activation`,
    );
    return status;
  }
  assert(
    status.indexReady === true,
    `${label} reports that canonical AMO V5 replay is not ready`,
  );
  assert(
    status.protocolWritesEnabled === false &&
      status.listingWritesEnabled === false &&
      status.writesEnabled === false &&
      ["work-amo-v5-quote-not-ready", "work-amo-v5-writes-not-configured"].includes(
        String(status.reasonCode ?? ""),
      ),
    `${label} did not preserve the fail-closed AMO V5 production write gate`,
  );
  if (status.quoteReady === true) {
    assert(
      /^[0-9a-f]{64}$/u.test(String(status.quoteHead?.txid ?? "")) &&
        Number(status.quoteHead?.blockHeight) >=
          WORK_AMO_V5_V1_ACTIVATION_HEIGHT,
      `${label} reports a ready AMO quote without a canonical quote head`,
    );
  } else {
    assert(
      status.quoteHead === null,
      `${label} reports an unusable AMO quote head`,
    );
  }
  return status;
}

function assertWorkAmoV6ProofEstimates(status, label) {
  const estimates =
    status?.estimates && typeof status.estimates === "object"
      ? status.estimates
      : {};
  const observedFaces = Object.keys(estimates)
    .map(Number)
    .sort((left, right) => left - right);
  assert(
    JSON.stringify(observedFaces) ===
      JSON.stringify(WORK_AMO_V6_ALLOWED_FACE_PROOFS),
    `${label} does not expose exactly 20,000, 50,000, and 100,000 proof faces`,
  );
  for (const face of WORK_AMO_V6_ALLOWED_FACE_PROOFS) {
    const estimate = estimates[String(face)];
    assert(
      estimate?.estimateOnly === true &&
        Number(estimate?.unitFaceProofs) === face &&
        String(estimate?.unitPriceSats) === String(face) &&
        /^[1-9][0-9]*$/u.test(String(estimate?.unitAmountAtoms ?? "")) &&
        /^[1-9][0-9]*$/u.test(
          String(estimate?.unitMinimumPriceSats ?? ""),
        ) &&
        BigInt(estimate.unitMinimumPriceSats) <= BigInt(face),
      `${label} has invalid deterministic terms for ${face} proofs`,
    );
  }
}

function assertWorkAmoV6Surface(payload, label, context = payload) {
  const status = workAmoV6StatusFromPayload(payload, context);
  assert(status, `${label} is missing WORK AMO V6 status`);
  assert(
    status.version === WORK_AMO_V6_AUTH_VERSION,
    `${label} reports the wrong WORK AMO V6 version`,
  );
  assert(
    status.settlementWritesEnabled ===
        (status.ready === true &&
          status.protocolWritesEnabled === true) &&
      status.listingWritesEnabled ===
        (status.settlementWritesEnabled === true),
    `${label} does not preserve the single proof-native write-gate invariant`,
  );
  if (
    /^[1-9][0-9]*$/u.test(String(status.networkValueBeforeQ8 ?? ""))
  ) {
    assertWorkAmoV6ProofEstimates(status, label);
  }
  if (status.pinsConfigured !== true) {
    assert(
      status.ready === false &&
        status.indexReady === false &&
        status.writesConfigured === false &&
        status.protocolWritesEnabled === false &&
        status.settlementWritesEnabled === false &&
        status.listingWritesEnabled === false &&
        status.activation?.active === false &&
        status.activation?.reasonCode ===
          "work-amo-v6-declaration-commitment-unconfigured",
      `${label} did not preserve the fully closed pre-declaration V6 stage`,
    );
    return status;
  }

  if (status.activation?.active === true) {
    const declaration = status.activation.declaration;
    assert(
      status.ready === true &&
        status.indexReady === true &&
        status.migrationReady === true &&
        status.activation.evidenceComplete === true &&
        status.activation.canonical === true &&
        status.activation.confirmed === true &&
        /^[0-9a-f]{64}$/u.test(String(declaration?.txid ?? "")) &&
        Number.isSafeInteger(Number(declaration?.blockHeight)) &&
        Number(declaration?.activationHeight) ===
          Number(declaration?.blockHeight) + 1 &&
        /^[0-9a-f]{64}$/u.test(String(declaration?.blockHash ?? "")) &&
        Number.isSafeInteger(Number(declaration?.blockTransactionIndex)) &&
        Number.isSafeInteger(Number(declaration?.protocolVout)) &&
        Number(declaration?.recordOrdinal) === 0 &&
        Number.isSafeInteger(Number(declaration?.registryPaymentVout)),
      `${label} does not expose exact active declaration/index evidence`,
    );
  } else {
    assert(
      status.ready === false &&
        status.protocolWritesEnabled === false &&
        status.settlementWritesEnabled === false &&
        status.listingWritesEnabled === false,
      `${label} enabled V6 writes before exact activation evidence`,
    );
  }
  return status;
}

function assertWorkAmoV8Surface(payload, label, context = payload) {
  const status = workAmoV8StatusFromPayload(payload, context);
  assert(status, `${label} is missing WORK AMO V8 status`);
  const activation = status.activation;
  const declaration = activation?.declaration;
  const migration = status.migrationReadiness;
  assert(
    status.version === WORK_AMO_V8_AUTH_VERSION &&
      workAmoV8IsAuthoritative(status) &&
      activation?.active === true &&
      activation?.canonical === true &&
      activation?.confirmed === true &&
      activation?.evidenceComplete === true &&
      activation?.tipVerified === true &&
      Number(activation?.activationHeight) === WORK_AMO_V8_ACTIVATION_HEIGHT,
    `${label} does not expose authoritative WORK AMO V8 activation evidence`,
  );
  assert(
    String(declaration?.txid ?? "").toLowerCase() ===
        WORK_AMO_V8_DECLARATION_TXID &&
      String(declaration?.blockHash ?? "").toLowerCase() ===
        WORK_AMO_V8_DECLARATION_BLOCK_HASH &&
      Number(declaration?.blockHeight) === WORK_AMO_V8_DECLARATION_HEIGHT &&
      Number(declaration?.blockTransactionIndex) ===
        WORK_AMO_V8_DECLARATION_BLOCK_INDEX &&
      Number(declaration?.activationHeight) === WORK_AMO_V8_ACTIVATION_HEIGHT &&
      Number(declaration?.protocolVout) ===
        WORK_AMO_V8_DECLARATION_PROTOCOL_VOUT &&
      Number(declaration?.recordOrdinal) ===
        WORK_AMO_V8_DECLARATION_RECORD_ORDINAL &&
      Number(declaration?.registryPaymentVout) ===
        WORK_AMO_V8_DECLARATION_REGISTRY_PAYMENT_VOUT &&
      String(declaration?.payloadSha256 ?? "").toLowerCase() ===
        WORK_AMO_V8_DECLARATION_MEMO_SHA256 &&
      Number(declaration?.payloadBytes) ===
        WORK_AMO_V8_DECLARATION_MEMO_BYTES,
    `${label} changed the exact confirmed WORK AMO V8 declaration`,
  );
  assert(
    migration?.ready === true &&
      migration?.active === true &&
      migration?.canonical === true &&
      migration?.confirmed === true &&
      migration?.evidenceComplete === true &&
      migration?.parityReady === true &&
      migration?.replayReady === true &&
      migration?.pendingReady === true &&
      migration?.precision?.amountStorageModel ===
        WORK_AMO_V8_PRECISION.amountStorageModel &&
      Number(migration?.precision?.decimals) ===
        WORK_AMO_V8_PRECISION.decimals &&
      String(migration?.precision?.unitScale ?? "") ===
        WORK_AMO_V8_PRECISION.unitScale,
    `${label} does not expose exact ready Q16 migration and pending evidence`,
  );
  assert(
    status.indexReady === true &&
      status.migrationReady === true &&
      status.precisionMigrationReady === true &&
      status.ready === true &&
      status.workerReadiness?.ready === true,
    `${label} is not fully ready at the authoritative V8 tip`,
  );
  const writesEnabled = status.protocolWritesEnabled === true;
  assert(
    status.settlementWritesEnabled === writesEnabled &&
      status.listingWritesEnabled === writesEnabled &&
      status.writeAdmission === writesEnabled &&
      status.writesConfigured === writesEnabled &&
      (writesEnabled
        ? String(status.reasonCode ?? "") === ""
        : status.reasonCode === "work-amo-v8-writes-paused"),
    `${label} does not preserve the single WORK AMO V8 write-gate invariant`,
  );
  assert(
    status.relicCutover?.model ===
        "canonical-work-amo-v8-preactivation-relic-cutover-v1" &&
      Number(status.relicCutover?.count) === 23 &&
      status.relicCutover?.items?.length === 23,
    `${label} changed the exact 23-listing V8 relic cutover`,
  );
  if (/^[1-9][0-9]*$/u.test(String(status.networkValueBeforeQ8 ?? ""))) {
    const observedFaces = Object.keys(status.estimates ?? {})
      .map(Number)
      .sort((left, right) => left - right);
    assert(
      JSON.stringify(observedFaces) ===
        JSON.stringify(WORK_AMO_V8_ALLOWED_FACE_PROOFS),
      `${label} does not expose the singleton 25,000-proof V8 face`,
    );
    const estimate = status.estimates?.["25000"];
    assert(
      estimate?.estimateOnly === true &&
        Number(estimate?.unitFaceProofs) === 25_000 &&
        String(estimate?.unitPriceSats) === "25000" &&
        /^[1-9][0-9]*$/u.test(String(estimate?.unitAmountSubatoms ?? "")) &&
        !("unitAmountAtoms" in estimate),
      `${label} exposes an invalid or Q8-authoritative V8 unit estimate`,
    );
  }
  return status;
}

function firstWorkAmoV6AmountProjectionIsExact(listing) {
  if (String(listing?.amount ?? "") !== "0.0000001") {
    return false;
  }
  const storageModel = String(listing?.amountStorageModel ?? "");
  const q8Historical =
    String(listing?.amountAtoms ?? "") === "10" &&
    (!storageModel || storageModel === "work-atoms-v1") &&
    (listing?.amountSubatoms == null || listing.amountSubatoms === "");
  const q16Current =
    String(listing?.amountSubatoms ?? "") === "1000000000" &&
    listing?.amountAtoms == null &&
    storageModel === WORK_AMO_V8_PRECISION.amountStorageModel &&
    Number(listing?.decimals) === WORK_AMO_V8_PRECISION.decimals &&
    String(listing?.unitScale ?? "") === WORK_AMO_V8_PRECISION.unitScale;
  return q8Historical || q16Current;
}

function assertFirstWorkAmoV6ListingRecord(
  listing,
  label,
  allowedStatuses = ["active", "sealing", "sold", "delisted"],
) {
  assert(listing, `${label} is missing the first confirmed AMO V6 listing`);
  const status = String(listing.status ?? "").toLowerCase();
  assert(
    String(listing.listingId ?? "").toLowerCase() ===
        WORK_AMO_V6_FIRST_LISTING_TX &&
      listing.confirmed === true &&
      allowedStatuses.includes(status) &&
      workListingAuthorizationVersion(listing) ===
        WORK_AMO_V6_AUTH_VERSION &&
      String(listing.tokenId ?? "").toLowerCase() === WORK_TOKEN_ID &&
      String(listing.sellerAddress ?? "") ===
        WORK_AMO_V6_FIRST_LISTING_SELLER &&
      firstWorkAmoV6AmountProjectionIsExact(listing) &&
      Number(listing.priceSats) === 20_000 &&
      Number(listing.blockHeight) === 960_258 &&
      String(listing.blockHash ?? "").toLowerCase() ===
        WORK_AMO_V6_FIRST_LISTING_BLOCK_HASH &&
      Number(listing.blockIndex) === 4_093 &&
      Number(listing.protocolVout) === 1 &&
      Number(listing.recordOrdinal) === 0,
    `${label} changed the canonical first AMO V6 listing terms, position, or lifecycle status (${status || "missing"})`,
  );
}

function assertFirstWorkAmoV6FrozenTerms(frozenTerms, label) {
  const expected = {
    amountModel: "canonical-confirmed-position-derived-work-amount-v1",
    bondTransitionModel: "canonical-compute-then-bond-v1",
    listingBlockHash: WORK_AMO_V6_FIRST_LISTING_BLOCK_HASH,
    listingBlockHeight: 960_258,
    listingBlockIndex: 4_093,
    listingBondContributionQ8: "2940553839600",
    listingNetworkValueAfterQ8: "407065289490677089559475846",
    listingNetworkValueBeforeQ8: "407065289490674149005636246",
    listingProtocolVout: 1,
    listingRecordOrdinal: 0,
    stateOrderModel: "canonical-proof-state-order-v1",
    unitAmountAtoms: "10",
    unitFaceProofs: 20_000,
    unitMinimumPriceSats: "19385",
    unitModel: "canonical-work-amo-proof-unit-v1",
    unitPriceSats: "20000",
    unitWorkOracleModel: "canonical-work-prefix-before-action-v1",
    version: WORK_AMO_V6_AUTH_VERSION,
  };
  assert(
    frozenTerms &&
      JSON.stringify(Object.keys(frozenTerms).sort()) ===
        JSON.stringify(Object.keys(expected).sort()) &&
      Object.entries(expected).every(
        ([key, value]) => frozenTerms[key] === value,
      ),
    `${label} changed the exact first AMO V6 frozen terms`,
  );
}

function assertFirstWorkAmoV6ClosedListingRecord(
  listing,
  label,
  { requireOriginalPosition = false } = {},
) {
  if (requireOriginalPosition) {
    assertFirstWorkAmoV6ListingRecord(listing, label, ["delisted"]);
    assertFirstWorkAmoV6FrozenTerms(
      listing.frozenTerms,
      `${label} projection`,
    );
    const original = listing.listing ?? listing.closedListing;
    assert(
      String(original?.listingId ?? "").toLowerCase() ===
          WORK_AMO_V6_FIRST_LISTING_TX &&
        String(original?.amountAtoms ?? "") === "10" &&
        Number(original?.priceSats) === 20_000 &&
        String(original?.sellerAddress ?? "") ===
          WORK_AMO_V6_FIRST_LISTING_SELLER &&
        workListingAuthorizationVersion(original) ===
          WORK_AMO_V6_AUTH_VERSION,
      `${label} changed the nested original first AMO V6 listing`,
    );
    assertFirstWorkAmoV6FrozenTerms(
      original.frozenTerms,
      `${label} nested listing`,
    );
    assert(
      String(listing.saleTicketTxid ?? "").toLowerCase() ===
          WORK_AMO_V6_FIRST_LISTING_TX &&
        Number(listing.saleTicketVout) === 2 &&
        listing.closedByCanonicalOutpointSpend === true,
      `${label} lost canonical sale-ticket close evidence`,
    );
  }
  assert(
    String(listing?.listingId ?? "").toLowerCase() ===
        WORK_AMO_V6_FIRST_LISTING_TX &&
      listing?.confirmed === true &&
      listing?.closedConfirmed === true &&
      workListingAuthorizationVersion(listing) ===
        WORK_AMO_V6_AUTH_VERSION &&
      String(listing?.tokenId ?? "").toLowerCase() === WORK_TOKEN_ID &&
      String(listing?.sellerAddress ?? "") ===
        WORK_AMO_V6_FIRST_LISTING_SELLER &&
      firstWorkAmoV6AmountProjectionIsExact(listing) &&
      Number(listing?.priceSats) === 20_000 &&
      String(listing?.closedTxid ?? "").toLowerCase() ===
        WORK_AMO_V6_FIRST_LISTING_CLOSE_TX &&
      Number(listing?.closedBlockHeight) === 960_302 &&
      String(listing?.closedBlockHash ?? "").toLowerCase() ===
        WORK_AMO_V6_FIRST_LISTING_CLOSE_BLOCK_HASH &&
      Number(listing?.closedBlockIndex) === 3_818 &&
      Number(listing?.closedProtocolVout) === 2 &&
      Number(listing?.closedRecordOrdinal) === 0,
    `${label} changed the canonical first AMO V6 listing close lifecycle`,
  );
}

async function assertFirstWorkAmoV6ListingProjection(token) {
  const tokenActiveMatches = (token?.listings ?? []).filter(
    (item) =>
      String(item?.listingId ?? "").toLowerCase() ===
      WORK_AMO_V6_FIRST_LISTING_TX,
  );
  const tokenClosedMatches = (token?.closedListings ?? []).filter(
    (item) =>
      String(item?.listingId ?? "").toLowerCase() ===
      WORK_AMO_V6_FIRST_LISTING_TX,
  );
  assert(
    tokenActiveMatches.length === 0 && tokenClosedMatches.length <= 1,
    `/api/v1/token returned ${tokenActiveMatches.length} active and ${tokenClosedMatches.length} closed copies of the canonically delisted first AMO V6 listing`,
  );
  if (tokenClosedMatches.length === 1) {
    assertFirstWorkAmoV6ClosedListingRecord(
      tokenClosedMatches[0],
      "/api/v1/token closed listing",
      { requireOriginalPosition: true },
    );
  }

  const exactActiveHistory = await tokenHistory("listings", {
    fresh: 1,
    q: WORK_AMO_V6_FIRST_LISTING_TX,
  });
  const exactActiveMatches = (exactActiveHistory.items ?? []).filter(
    (item) =>
      String(item?.listingId ?? "").toLowerCase() ===
      WORK_AMO_V6_FIRST_LISTING_TX,
  );
  assert(
    exactActiveMatches.length === 0 &&
      Number(exactActiveHistory.totalCount) === 0,
    `exact active listing history returned ${exactActiveMatches.length} rows and total ${exactActiveHistory.totalCount} for the canonically delisted first AMO V6 listing`,
  );

  const exactClosedHistory = await tokenHistory("closed-listings", {
    fresh: 1,
    q: WORK_AMO_V6_FIRST_LISTING_TX,
  });
  const exactClosedMatches = (exactClosedHistory.items ?? []).filter(
    (item) =>
      String(item?.listingId ?? "").toLowerCase() ===
      WORK_AMO_V6_FIRST_LISTING_TX,
  );
  assert(
    exactClosedMatches.length === 1 &&
      Number(exactClosedHistory.totalCount) === 1,
    `exact closed listing history returned ${exactClosedMatches.length} rows and total ${exactClosedHistory.totalCount} for the first AMO V6 listing`,
  );
  assertFirstWorkAmoV6ClosedListingRecord(
    exactClosedMatches[0],
    "exact closed /api/v1/token-history",
  );

  const exactClosedByCloseTx = await tokenHistory("closed-listings", {
    fresh: 1,
    q: WORK_AMO_V6_FIRST_LISTING_CLOSE_TX,
  });
  const exactClosedByCloseMatches = (
    exactClosedByCloseTx.items ?? []
  ).filter(
    (item) =>
      String(item?.listingId ?? "").toLowerCase() ===
        WORK_AMO_V6_FIRST_LISTING_TX &&
      String(item?.closedTxid ?? "").toLowerCase() ===
        WORK_AMO_V6_FIRST_LISTING_CLOSE_TX,
  );
  assert(
    exactClosedByCloseMatches.length === 1 &&
      Number(exactClosedByCloseTx.totalCount) === 1,
    `exact close-tx history returned ${exactClosedByCloseMatches.length} rows and total ${exactClosedByCloseTx.totalCount} for the first AMO V6 lifecycle`,
  );
  assertFirstWorkAmoV6ClosedListingRecord(
    exactClosedByCloseMatches[0],
    "exact close-tx /api/v1/token-history",
  );

  const exactMarketLog = await tokenHistory("market-log", {
    fresh: 1,
    q: WORK_AMO_V6_FIRST_LISTING_TX,
  });
  const marketItems = exactMarketLog.items ?? [];
  assert(
    marketItems.length === 2 &&
      Number(exactMarketLog.totalCount) === 2 &&
      marketItems[0]?.kind === "closed-listing" &&
      String(marketItems[0]?.txid ?? "").toLowerCase() ===
        WORK_AMO_V6_FIRST_LISTING_CLOSE_TX &&
      marketItems[1]?.kind === "listing" &&
      String(marketItems[1]?.txid ?? "").toLowerCase() ===
        WORK_AMO_V6_FIRST_LISTING_TX,
    "exact market log did not return the canonical close-then-listing lifecycle order for the first AMO V6 listing",
  );
  assertFirstWorkAmoV6ListingRecord(
    marketItems[1].listing,
    "exact market-log listing",
    ["confirmed"],
  );
  assertFirstWorkAmoV6ClosedListingRecord(
    marketItems[0].closedListing,
    "exact market-log close",
  );
}

function expectedActiveWorkMarketVersion(payload, context = payload) {
  const workAmoV8 = workAmoV8StatusFromPayload(payload, context);
  if (workAmoV8IsAuthoritative(workAmoV8)) {
    return WORK_AMO_V8_AUTH_VERSION;
  }
  const workAmoV6 = workAmoV6StatusFromPayload(payload, context);
  if (
    workAmoV6?.activation?.active === true &&
    workAmoV6?.ready === true &&
    workAmoV6?.version === WORK_AMO_V6_AUTH_VERSION
  ) {
    return WORK_AMO_V6_AUTH_VERSION;
  }
  const workAmoV5 = workAmoV5StatusFromPayload(payload, context);
  if (
    workAmoV5?.active === true &&
    workAmoV5?.declarationConfirmed === true &&
    workAmoV5?.authVersion === WORK_AMO_V5_AUTH_VERSION
  ) {
    return WORK_AMO_V5_AUTH_VERSION;
  }
  const statusCandidates = [
    context?.workMarketplaceV4,
    context?.floor?.workMarketplaceV4,
    context?.workFloor?.workMarketplaceV4,
    payload?.workMarketplaceV4,
  ];
  if (
    statusCandidates.some(
      (status) =>
        status?.active === true &&
        status?.declarationConfirmed === true &&
        status?.authVersion === WORK_MARKET_V4_AUTH_VERSION &&
        status?.oracleModel === WORK_MARKET_V4_ORACLE_MODEL &&
        validWorkMarketV4DeclarationCoordinates(status),
    )
  ) {
    return WORK_MARKET_V4_AUTH_VERSION;
  }

  const activation =
    payload?.workMarketV4Activation ??
    context?.workMarketV4Activation ??
    context?.token?.workMarketV4Activation;
  const indexedThroughBlock = Number(
    payload?.indexedThroughBlock ??
      payload?.stats?.indexedThroughBlock ??
      context?.indexedThroughBlock ??
      context?.stats?.indexedThroughBlock,
  );
  return validWorkMarketV4DeclarationCoordinates(activation) &&
    Number.isSafeInteger(indexedThroughBlock) &&
    indexedThroughBlock >= Number(activation.activationHeight)
    ? WORK_MARKET_V4_AUTH_VERSION
    : WORK_MARKET_V3_AUTH_VERSION;
}

function assertWorkAmoEraSelectionContract() {
  const readyV6 = {
    activation: { active: true },
    indexReady: true,
    pinsConfigured: true,
    ready: true,
    version: WORK_AMO_V6_AUTH_VERSION,
  };
  const reachedV8 = {
    activation: { active: true, reached: true },
    indexReady: false,
    migrationReadiness: { active: true, ready: true },
    ready: false,
    version: WORK_AMO_V8_AUTH_VERSION,
  };
  const readyV8 = {
    ...reachedV8,
    indexReady: true,
    ready: true,
  };
  const pinnedOnlyV8 = {
    activation: { active: false, reached: false },
    indexReady: false,
    migrationReadiness: { active: false, ready: false },
    pinsConfigured: true,
    ready: false,
    version: WORK_AMO_V8_AUTH_VERSION,
  };
  assert(
    canonicalWorkAmoStatusIndexReady({
      workAmoV6: readyV6,
      workAmoV8: pinnedOnlyV8,
    }),
    "a merely pinned preactivation V8 status must retain V6 precedence",
  );
  assert(
    !canonicalWorkAmoStatusIndexReady({
      workAmoV6: readyV6,
      workAmoV8: reachedV8,
    }) &&
      isRetryableWorkAmoTipRacePayload({
        workAmoV6: readyV6,
        workAmoV8: reachedV8,
      }),
    "authoritative but red V8 must not fall back to ready V6",
  );
  assert(
    canonicalWorkAmoStatusIndexReady({
      workAmoV6: { ...readyV6, indexReady: false },
      workAmoV8: readyV8,
    }) &&
      !isRetryableWorkAmoTipRacePayload({
        workAmoV6: { ...readyV6, indexReady: false },
        workAmoV8: readyV8,
      }),
    "fully ready V8 must converge even though superseded V6 is closed",
  );
  assert(
    !canonicalWorkAmoStatusIndexReady({
      workAmoV6: readyV6,
      workAmoV8: { ...readyV8, version: "pwt-sale-v8-invalid" },
    }) &&
      expectedActiveWorkMarketVersion({
        workAmoV6: readyV6,
        workAmoV8: { ...reachedV8, version: "" },
      }) === WORK_AMO_V8_AUTH_VERSION,
    "an authoritative malformed V8 status must fail closed in the V8 era",
  );
  assert(
    expectedActiveWorkMarketVersion({ workAmoV6: readyV6 }) ===
      WORK_AMO_V6_AUTH_VERSION,
    "pre-V8 V6 active-version selection must remain intact",
  );
}

assertWorkAmoEraSelectionContract();

function assertActiveWorkListingsUseCanonicalVersion(
  payload,
  label,
  context = payload,
) {
  const expectedVersion = expectedActiveWorkMarketVersion(payload, context);
  const activeWrongVersion = (payload?.listings ?? []).filter(
    (listing) => {
      const isWork =
        String(
          listing?.tokenId ?? listing?.saleAuthorization?.tokenId ?? "",
        )
          .trim()
          .toLowerCase() === WORK_TOKEN_ID;
      if (!isWork) {
        return false;
      }
      const version = workListingAuthorizationVersion(listing);
      if (version === expectedVersion) {
        return false;
      }
      const v6Status = workAmoV6StatusFromPayload(payload, context);
      const v6ActivationHeight = Number(
        v6Status?.activation?.activationHeight ??
          v6Status?.activation?.declaration?.activationHeight,
      );
      return !(
        (expectedVersion === WORK_AMO_V5_AUTH_VERSION &&
          version === WORK_MARKET_V4_AUTH_VERSION &&
          listing?.confirmed === true &&
          Number.isSafeInteger(Number(listing?.blockHeight)) &&
          Number(listing.blockHeight) < WORK_AMO_V5_ACTIVATION_HEIGHT) ||
        (expectedVersion === WORK_AMO_V6_AUTH_VERSION &&
          [WORK_MARKET_V4_AUTH_VERSION, WORK_AMO_V5_AUTH_VERSION].includes(
            version,
          ) &&
          listing?.confirmed === true &&
          Number.isSafeInteger(v6ActivationHeight) &&
          Number.isSafeInteger(Number(listing?.blockHeight)) &&
          Number(listing.blockHeight) < v6ActivationHeight)
      );
    },
  );
  assert(
    activeWrongVersion.length === 0,
    `${label} returned ${activeWrongVersion.length} active WORK listings that are not ${expectedVersion}`,
  );
}

function assertExactWorkV1Relics(payload, label) {
  const snapshotIds = WORK_MARKET_V1_REFUND_SNAPSHOT.listings.map(
    (listing) => String(listing?.listingId ?? "").toLowerCase(),
  );
  assert(
    snapshotIds.length === 94 &&
      WORK_MARKET_V1_RELIC_IDS.size === 94 &&
      snapshotIds.every((listingId) =>
        WORK_MARKET_V1_RELIC_IDS.has(listingId)
      ),
    "the immutable WORK V1 refund snapshot must preserve 94 unique listing identities",
  );
  const pinnedRows = (payload?.closedListings ?? []).filter(
    (listing) => WORK_MARKET_V1_RELIC_IDS.has(
      String(listing?.listingId ?? "").toLowerCase(),
    ),
  );
  const actualIds = new Set(
    pinnedRows.map((listing) =>
      String(listing?.listingId ?? "").toLowerCase()
    ),
  );
  assert(
    pinnedRows.length === actualIds.size,
    `${label} duplicated a projected member of the pinned 94-listing WORK V1 refund snapshot`,
  );
  assert(
    pinnedRows.every((listing) => isLegacyWorkListing(listing)),
    `${label} changed the historical authorization version of a pinned WORK V1 refund row`,
  );
  assert(
    !actualIds.has(WORK_MARKET_V2_POST_ACTIVATION_LISTING_TX),
    `${label} incorrectly included the post-activation invalid listing in the V1 relic set`,
  );
  assert(
    pinnedRows.every(
      (listing) =>
        listing?.relic === true &&
        listing?.status === "disabled" &&
        listing?.refundEligible === true &&
        Number(listing?.disabledAtBlockHeight) ===
          WORK_MARKET_V2_ACTIVATION_HEIGHT &&
        String(listing?.disabledByTxid ?? "").toLowerCase() ===
          WORK_MARKET_V2_DECLARATION_TXID,
    ),
    `${label} returned a projected WORK V1 relic without the canonical cutover metadata`,
  );
  const lateSealRelic = listingById(
    pinnedRows,
    WORK_MARKET_V2_LATE_SEAL_LISTING_TX,
  );
  const lateSealSnapshot = WORK_MARKET_V1_REFUND_LISTINGS_BY_ID.get(
    WORK_MARKET_V2_LATE_SEAL_LISTING_TX,
  );
  assert(
    lateSealSnapshot?.sealed === false &&
      !String(lateSealSnapshot?.sealTxid ?? "").trim() &&
      Number(lateSealSnapshot?.refundSats) ===
        Number(lateSealSnapshot?.listingMinerFeeSats),
    "the immutable V1 refund snapshot applied the post-activation seal to its pre-activation relic",
  );
  if (lateSealRelic) {
    assert(
      lateSealRelic.relic === true &&
        lateSealRelic.refundEligible === true &&
        lateSealRelic.sealConfirmed !== true &&
        !String(lateSealRelic.sealTxid ?? "").trim(),
      `${label} applied the post-activation seal to its projected pre-activation relic`,
    );
  }
}

async function assertWorkMarketV2InvalidAttempt({
  blockHeight,
  listingId,
  txid,
}) {
  const history = await tokenHistory("invalid-events", {
    fresh: 1,
    q: txid,
  });
  const invalid = (history.items ?? []).find(
    (item) => String(item?.txid ?? "").toLowerCase() === txid,
  );
  assert(
    invalid?.confirmed === true &&
      invalid?.valid === false &&
      Number(invalid?.blockHeight) === blockHeight &&
      String(invalid?.listingId ?? invalid?.txid ?? "").toLowerCase() ===
        listingId &&
      String(invalid?.reasonCode ?? invalid?.reason ?? "") ===
        WORK_MARKET_V2_REASON_CODE &&
      invalid?.refundEligible === false,
    `${txid} is missing or incomplete in WORK Marketplace V2 invalid-event history`,
  );

  const publicLog = await getJson("/api/v1/log-history", {
    network: "livenet",
    q: txid,
    limit: 5,
  });
  assert(
    !txids(publicLog.items).has(txid),
    `${txid} leaked into the valid-action public Log`,
  );
}

async function assertWorkMarketV2CutoverContract({
  fresh = true,
  token: providedToken = null,
} = {}) {
  const token =
    providedToken ??
    (await convergedWorkAmoToken({
      fresh,
    }));
  assertActiveWorkListingsUseCanonicalVersion(
    token,
    "/api/v1/token?asset=WORK",
  );
  assertExactWorkV1Relics(token, "/api/v1/token?asset=WORK");
  await assertWorkMarketV2InvalidAttempt({
    blockHeight: 959_091,
    listingId: WORK_MARKET_V2_LATE_SEAL_LISTING_TX,
    txid: WORK_MARKET_V2_LATE_SEAL_TX,
  });
  await assertWorkMarketV2InvalidAttempt({
    blockHeight: 959_093,
    listingId: WORK_MARKET_V2_POST_ACTIVATION_LISTING_TX,
    txid: WORK_MARKET_V2_POST_ACTIVATION_LISTING_TX,
  });
  return token;
}

async function assertWorkAmoV5CutoverContract({
  fresh = true,
  token: providedToken = null,
} = {}) {
  const token =
    providedToken ??
    (await convergedWorkAmoToken({
      fresh,
    }));
  assertWorkAmoV5Readiness(token, "/api/v1/token?asset=WORK");
  assertActiveWorkListingsUseCanonicalVersion(
    token,
    "/api/v1/token?asset=WORK",
  );

  const relicHistory = await tokenHistory("closed-listings", {
    fresh: 1,
    q: WORK_AMO_V5_PRE_V1_RELIC_LISTING_TX,
  });
  const relic = listingById(
    relicHistory.items,
    WORK_AMO_V5_PRE_V1_RELIC_LISTING_TX,
  );
  assert(
    relic?.confirmed === true &&
      relic?.relic === true &&
      relic?.refundEligible === false &&
      String(relic?.closedTxid ?? relic?.txid ?? "").toLowerCase() ===
        WORK_AMO_V5_DECLARATION_TXID &&
      ["disabled", "closed"].includes(String(relic?.status ?? "")),
    `${WORK_AMO_V5_PRE_V1_RELIC_LISTING_TX} is not preserved as a non-reserving pre-unit relic`,
  );

  const relicByDeclaration = await tokenHistory("closed-listings", {
    fresh: 1,
    q: WORK_AMO_V5_DECLARATION_TXID,
  });
  const declarationRelic = listingById(
    relicByDeclaration.items,
    WORK_AMO_V5_PRE_V1_RELIC_LISTING_TX,
  );
  assert(
    declarationRelic?.relic === true &&
      String(
        declarationRelic?.closedTxid ?? declarationRelic?.txid ?? "",
      ).toLowerCase() === WORK_AMO_V5_DECLARATION_TXID,
    `${WORK_AMO_V5_DECLARATION_TXID} does not resolve the pre-unit closed relic`,
  );

  for (const query of [
    WORK_AMO_V5_PRE_V1_RELIC_LISTING_TX,
    WORK_AMO_V5_DECLARATION_TXID,
  ]) {
    const relicMarketLog = await tokenHistory("market-log", {
      fresh: 1,
      q: query,
    });
    const marketRelic = (relicMarketLog.items ?? []).find(
      (item) =>
        item?.kind === "closed-listing" &&
        String(item?.closedListing?.listingId ?? "").toLowerCase() ===
          WORK_AMO_V5_PRE_V1_RELIC_LISTING_TX &&
        String(item?.txid ?? "").toLowerCase() ===
          WORK_AMO_V5_DECLARATION_TXID,
    );
    assert(
      marketRelic?.closedListing?.relic === true &&
        marketRelic?.closedListing?.refundEligible === false,
      `${query} does not resolve the pre-unit relic in WORK market-log`,
    );
  }

  const activeRelicHistory = await tokenHistory("listings", {
    fresh: 1,
    q: WORK_AMO_V5_PRE_V1_RELIC_LISTING_TX,
  });
  assert(
    !listingById(
      activeRelicHistory.items,
      WORK_AMO_V5_PRE_V1_RELIC_LISTING_TX,
    ),
    `${WORK_AMO_V5_PRE_V1_RELIC_LISTING_TX} leaked into active WORK listing history`,
  );

  const broadRelicHistory = await tokenHistory("closed-listings", {
    fresh: 1,
    limit: 200,
  });
  const broadRelic = listingById(
    broadRelicHistory.items,
    WORK_AMO_V5_PRE_V1_RELIC_LISTING_TX,
  );
  assert(
    broadRelic?.relic === true &&
      String(broadRelic?.closedTxid ?? broadRelic?.txid ?? "").toLowerCase() ===
        WORK_AMO_V5_DECLARATION_TXID,
    `${WORK_AMO_V5_PRE_V1_RELIC_LISTING_TX} is absent from broad relational closed history`,
  );

  const invalidHistory = await tokenHistory("invalid-events", {
    fresh: 1,
    q: WORK_AMO_V5_POST_V1_INVALID_LISTING_TX,
  });
  const invalid = (invalidHistory.items ?? []).find(
    (item) =>
      String(item?.txid ?? "").toLowerCase() ===
      WORK_AMO_V5_POST_V1_INVALID_LISTING_TX,
  );
  assert(
    invalid?.confirmed === true &&
      invalid?.valid === false &&
      invalid?.relic === false &&
      invalid?.refundEligible === false &&
      String(invalid?.reasonCode ?? invalid?.reason ?? "") ===
        "work-market-v4-version-required",
    `${WORK_AMO_V5_POST_V1_INVALID_LISTING_TX} is not preserved as post-V1 invalid audit history`,
  );
  assert(
    !listingById(token.listings, WORK_AMO_V5_PRE_V1_RELIC_LISTING_TX) &&
      !listingById(token.listings, WORK_AMO_V5_POST_V1_INVALID_LISTING_TX),
    "AMO V5 migration left a V3 listing reservation active",
  );
  return token;
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

  let cutoverToken = null;
  await step("WORK Marketplace V2 cutover contract", async () => {
    cutoverToken = await assertWorkMarketV2CutoverContract();
  });

  await step("WORK AMO V5 cutover and write gate", async () => {
    await assertWorkAmoV5CutoverContract({ token: cutoverToken });
  });

  await step("WORK AMO V6 staged/current gate", async () => {
    await assertWorkAmoV6Surface(
      cutoverToken,
      "/api/v1/token?asset=WORK",
    );
  });

  await step("WORK AMO V8 Q16 activation and write gate", async () => {
    await assertWorkAmoV8Surface(
      cutoverToken,
      "/api/v1/token?asset=WORK",
    );
  });

  await step("first confirmed WORK AMO V6 listing lifecycle", async () => {
    await assertFirstWorkAmoV6ListingProjection(cutoverToken);
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

    await assertDroppedCloseCannotHideActiveListing();
    await assertReportedJulyPurchaseLifecycle();
  });

  await step("seller wallet excludes legacy WORK inventory", async () => {
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
    assertActiveWorkListingsUseCanonicalVersion(
      walletToken,
      "seller wallet-scoped token payload",
    );
    for (const txid of REPORTED_OTC_UNSEALED_LISTING_TXS) {
      const item = listingById(walletToken.listings, txid);
      assert(
        !item,
        `${txid} remained active in the seller wallet after the Marketplace V2 cutover`,
      );
    }
  });

  await step("legacy sealed WORK inventory is disabled", async () => {
    const carbonzTaprootWalletToken = await getJson("/api/v1/token", {
      network: "livenet",
      asset: WORK_TOKEN_ID,
      address: CARBONZ_TAPROOT_LISTING_ADDRESS,
      wallet: 1,
      fresh: 1,
    });
    assertActiveWorkListingsUseCanonicalVersion(
      carbonzTaprootWalletToken,
      "Carbonz wallet-scoped token payload",
    );
    assert(
      !listingById(
        carbonzTaprootWalletToken.listings,
        REPORTED_RECENT_WAITING_FOR_SEAL_LISTING_TX,
      ),
      `${REPORTED_RECENT_WAITING_FOR_SEAL_LISTING_TX} remained active after the Marketplace V2 cutover`,
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
    assertActiveWorkListingsUseCanonicalVersion(
      marketplaceSummary.token,
      "Marketplace summary",
      marketplaceSummary,
    );
    const v6Status = workAmoV6StatusFromPayload(
      marketplaceSummary,
      marketplaceSummary.token,
    );
    if (v6Status?.activation?.active === true && v6Status?.ready === true) {
      const firstActiveMatches = (
        marketplaceSummary.token?.listings ?? []
      ).filter(
        (item) =>
          String(item?.listingId ?? "").toLowerCase() ===
          WORK_AMO_V6_FIRST_LISTING_TX,
      );
      const firstClosedMatches = (
        marketplaceSummary.token?.closedListings ?? []
      ).filter(
        (item) =>
          String(item?.listingId ?? "").toLowerCase() ===
          WORK_AMO_V6_FIRST_LISTING_TX,
      );
      assert(
        firstActiveMatches.length === 0 && firstClosedMatches.length <= 1,
        `Marketplace summary returned ${firstActiveMatches.length} active and ${firstClosedMatches.length} closed copies of the canonically delisted first AMO V6 listing`,
      );
      if (firstClosedMatches.length === 1) {
        assertFirstWorkAmoV6ClosedListingRecord(
          firstClosedMatches[0],
          "Marketplace summary closed listing",
          { requireOriginalPosition: true },
        );
      }
    }
    for (const txid of REPORTED_OTC_UNSEALED_LISTING_TXS) {
      const item = listingById(marketplaceSummary.token?.listings, txid);
      assert(
        !item,
        `${txid} remained active in Marketplace summary after the V2 cutover`,
      );
    }
  });

  console.log(
    `Marketplace fast regression checks passed for ${API_BASE}: ID lookup, V2 cutover/relic state, listing lifecycle, wallet scopes, and targeted WORK transfers.`,
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

const workCutoverToken = await assertWorkMarketV2CutoverContract();
await assertWorkAmoV5CutoverContract({ token: workCutoverToken });
await assertWorkAmoV6Surface(
  workCutoverToken,
  "/api/v1/token?asset=WORK",
);
await assertWorkAmoV8Surface(
  workCutoverToken,
  "/api/v1/token?asset=WORK",
);
await assertFirstWorkAmoV6ListingProjection(workCutoverToken);

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
await assertDroppedCloseCannotHideActiveListing();

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
const recentWaitingForSealItem = listingById(
  workCutoverToken.closedListings,
  REPORTED_RECENT_WAITING_FOR_SEAL_LISTING_TX,
);
const recentWaitingForSealRefund =
  WORK_MARKET_V1_REFUND_LISTINGS_BY_ID.get(
    REPORTED_RECENT_WAITING_FOR_SEAL_LISTING_TX,
  );
assert(
  recentWaitingForSealRefund?.sealed === true &&
    String(recentWaitingForSealRefund?.sealTxid ?? "").toLowerCase() ===
      REPORTED_RECENT_WAITING_FOR_SEAL_SEAL_TX &&
    recentWaitingForSealRefund?.sellerAddress ===
      CARBONZ_TAPROOT_LISTING_ADDRESS,
  `${REPORTED_RECENT_WAITING_FOR_SEAL_LISTING_TX} is missing its exact immutable V1 refund evidence`,
);
if (recentWaitingForSealItem) {
  assert(
    recentWaitingForSealItem.relic === true &&
      recentWaitingForSealItem.refundEligible === true &&
      tokenListingHasConfirmedSeal(recentWaitingForSealItem) &&
      String(recentWaitingForSealItem.sealTxid ?? "").toLowerCase() ===
        REPORTED_RECENT_WAITING_FOR_SEAL_SEAL_TX &&
      workAmountMatches(recentWaitingForSealItem, "130") &&
      recentWaitingForSealItem.priceSats === 81325 &&
      recentWaitingForSealItem.sellerAddress ===
        CARBONZ_TAPROOT_LISTING_ADDRESS,
    `${REPORTED_RECENT_WAITING_FOR_SEAL_LISTING_TX} has incomplete projected V1 relic data`,
  );
}
const sealableItem = listingById(
  workCutoverToken.closedListings,
  REPORTED_CONFIRMED_SEALABLE_LISTING_TX,
);
const sealableRefund = WORK_MARKET_V1_REFUND_LISTINGS_BY_ID.get(
  REPORTED_CONFIRMED_SEALABLE_LISTING_TX,
);
assert(
  sealableRefund?.sealed === true &&
    /^[0-9a-f]{64}$/u.test(String(sealableRefund?.sealTxid ?? "")) &&
    sealableRefund?.version === "pwt-sale-v1" &&
    Number(sealableRefund?.refundSats) ===
      Number(sealableRefund?.listingMinerFeeSats) +
        Number(sealableRefund?.sealMinerFeeSats) +
        Number(sealableRefund?.sealPaymentSats),
  `${REPORTED_CONFIRMED_SEALABLE_LISTING_TX} is missing its exact immutable V1 refund evidence`,
);
if (sealableItem) {
  assert(
    sealableItem.relic === true &&
      sealableItem.refundEligible === true &&
      sealableItem.tokenId === WORK_TOKEN_ID &&
      sealableItem.registryAddress &&
      sealableItem.sellerAddress &&
      sealableItem.saleAuthorization?.version === "pwt-sale-v1" &&
      sealableItem.saleAuthorization?.anchorType === "sale-ticket-v1" &&
      sealableItem.saleAuthorization?.anchorVout === 2 &&
      sealableItem.saleAuthorization?.anchorValueSats === 546,
    `${REPORTED_CONFIRMED_SEALABLE_LISTING_TX} has incomplete projected sale-ticket fields`,
  );
}
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
assertActiveWorkListingsUseCanonicalVersion(
  walletToken,
  "seller wallet-scoped token payload",
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
    !item,
    `${txid} remained active in the seller wallet after the Marketplace V2 cutover`,
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
assertActiveWorkListingsUseCanonicalVersion(
  carbonzTaprootWalletToken,
  "Carbonz wallet-scoped token payload",
);
for (const txid of [REPORTED_RECENT_WAITING_FOR_SEAL_LISTING_TX]) {
  const item = listingById(carbonzTaprootWalletToken.listings, txid);
  assert(
    !item,
    `${txid} remained active in Carbonz wallet state after the Marketplace V2 cutover`,
  );
  const relic = listingById(carbonzTaprootWalletToken.closedListings, txid);
  const refund = WORK_MARKET_V1_REFUND_LISTINGS_BY_ID.get(txid);
  assert(
    refund?.sealed === true &&
      String(refund?.sealTxid ?? "").toLowerCase() ===
        REPORTED_RECENT_WAITING_FOR_SEAL_SEAL_TX &&
      refund?.sellerAddress === CARBONZ_TAPROOT_LISTING_ADDRESS,
    `${txid} is missing its confirmed pre-cutover seal in the immutable V1 refund snapshot`,
  );
  if (relic) {
    assert(
      relic.relic === true &&
        relic.refundEligible === true &&
        tokenListingHasConfirmedSeal(relic) &&
        String(relic.sealTxid ?? "").toLowerCase() ===
          REPORTED_RECENT_WAITING_FOR_SEAL_SEAL_TX,
      `${txid} has incomplete projected Carbonz wallet V1 relic data`,
    );
  }
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
    (item) =>
      item?.sellerAddress === SELLER &&
      !item?.closedTxid &&
      item?.relic !== true,
  ),
  "wallet-scoped token summary returned an anonymous non-relic closed listing",
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
assertActiveWorkListingsUseCanonicalVersion(
  marketplaceSummary.token,
  "Marketplace summary",
  marketplaceSummary,
);
for (const txid of REPORTED_OTC_UNSEALED_LISTING_TXS) {
  const item = listingById(marketplaceSummary.token?.listings, txid);
  assert(
    !item,
    `${txid} remained active in Marketplace summary after the V2 cutover`,
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
  !(marketplaceFreshSummary.token?.listings ?? []).some(
    (item) =>
      String(item?.listingId ?? "").toLowerCase() ===
      REPORTED_WAITING_FOR_SEAL_LISTING_TX,
  ),
  `${REPORTED_WAITING_FOR_SEAL_LISTING_TX} remained active in fresh Marketplace summary after the V2 cutover`,
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
  !(marketplaceFreshSummary.token?.listings ?? []).some(
    (item) =>
      String(item?.listingId ?? "").toLowerCase() ===
      REPORTED_RECENT_WAITING_FOR_SEAL_LISTING_TX,
  ),
  `${REPORTED_RECENT_WAITING_FOR_SEAL_LISTING_TX} remained active in fresh Marketplace summary after the V2 cutover`,
);
assertActiveWorkListingsUseCanonicalVersion(
  marketplaceFreshSummary.token,
  "Fresh Marketplace summary",
  marketplaceFreshSummary,
);
for (const txid of REPORTED_OTC_UNSEALED_LISTING_TXS) {
  const item = listingById(marketplaceFreshSummary.token?.listings, txid);
  assert(
    !item,
    `${txid} remained active in fresh Marketplace summary after the V2 cutover`,
  );
}
const workToken = await getJson("/api/v1/token", {
  network: "livenet",
  asset: WORK_TOKEN_ID,
  fresh: 1,
});
assertActiveWorkListingsUseCanonicalVersion(
  workToken,
  "Fresh WORK token payload",
);
const alignedFreshSummaries = await convergedFreshCanonicalSummarySet();
const workSummary = alignedFreshSummaries.work;
const workTokenSummary = alignedFreshSummaries.token;
const growthSummary = alignedFreshSummaries.growth;
const alignedMarketplaceFreshSummary = alignedFreshSummaries.marketplace;
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
  workSummary.snapshotId === alignedMarketplaceFreshSummary.snapshotId &&
    workSummary.snapshotId === workTokenSummary.snapshotId &&
    workSummary.snapshotId === growthSummary.snapshotId,
  `summary snapshot mismatch: work=${workSummary.snapshotId ?? "none"} marketplace=${alignedMarketplaceFreshSummary.snapshotId ?? "none"} token=${workTokenSummary.snapshotId ?? "none"} growth=${growthSummary.snapshotId ?? "none"}`,
);
assert(
  numbersAgree(
    workSummary.floor?.networkValueSats,
    alignedMarketplaceFreshSummary.workFloor?.networkValueSats,
  ) &&
    numbersAgree(
      workSummary.floor?.networkValueSats,
      growthSummary.workFloor?.networkValueSats,
    ) &&
    numbersAgree(
      workSummary.floor?.networkValueSats,
      growthSummary.actualValue?.totalSats,
    ),
  `summary network value mismatch: work=${workSummary.floor?.networkValueSats} marketplace=${alignedMarketplaceFreshSummary.workFloor?.networkValueSats} growthFloor=${growthSummary.workFloor?.networkValueSats} growth=${growthSummary.actualValue?.totalSats}`,
);
assert(
  numbersAgree(
    workSummary.floor?.floorSats,
    alignedMarketplaceFreshSummary.workFloor?.floorSats,
  ) &&
    numbersAgree(
      workSummary.floor?.floorSats,
      growthSummary.workFloor?.floorSats,
    ),
  `WORK floor mismatch: work=${workSummary.floor?.floorSats} marketplace=${alignedMarketplaceFreshSummary.workFloor?.floorSats} growth=${growthSummary.workFloor?.floorSats}`,
);
const confirmedSealedListings = (workToken.listings ?? []).filter(
  tokenListingHasConfirmedSeal,
);
const summaryListingsByKey = new Map(
  (marketplaceFreshSummary.token?.listings ?? []).map((item) => [
    listingKey(item),
    item,
  ]),
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
