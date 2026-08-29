import { createProofIndexPool } from "../server/db/postgres.mjs";
import {
  PROOF_INDEX_EVENT_RELATION_PARITY_MODEL,
  proofIndexCanonicalEventRelationParity,
} from "../server/proof-index-event-relations.mjs";
import {
  PROOF_INDEX_MAIL_PROJECTION_PARITY_MODEL,
  PROOF_INDEX_RENDERED_MAIL_KINDS,
  proofIndexCanonicalMailProjectionParity,
} from "../server/proof-index-mail-projection.mjs";
import {
  canonicalSummarySnapshotSqlTextMaxBytes,
} from "../server/canonical-summary-budget.mjs";
import {
  closeProofIndexReadPool,
  compareProofIndexHistoryPayloads,
  compareProofIndexRegistryPayloads,
  proofIndexActivityPayload,
  proofIndexAddressMailPayload,
  proofIndexEventHistoryPayload,
  proofIndexLogHistoryReadEligibility,
  proofIndexLogHistoryPayload,
  proofIndexRecentTransactionIds,
  proofIndexRegistryHistoryPayload,
  proofIndexRegistryPayload,
  proofIndexSnapshotPayload,
  proofIndexTokenPayload,
  proofIndexTokenHistoryReadEligibility,
  proofIndexTokenHistoryPayload,
  proofIndexTokenReadEligibility,
  proofIndexTxStatusPayload,
  proofIndexWorkAmoReplayReadiness,
  proofIndexWorkAmoV5Declaration,
  proofIndexWorkUsdQuoteHead,
} from "../server/db/proof-index-reader.mjs";

const DEFAULT_API_BASE = "http://127.0.0.1:8081";
const API_BASE = String(process.env.POW_API_BASE ?? DEFAULT_API_BASE).replace(
  /\/+$/u,
  "",
);
const NETWORK = process.env.NETWORK ?? "livenet";
const REQUEST_TIMEOUT_MS = Number(process.env.POW_INDEX_FETCH_TIMEOUT_MS ?? 60_000);
const REQUEST_RETRIES = Number(process.env.POW_INDEX_FETCH_RETRIES ?? 4);
const INTERNAL_VERIFIER_TOKEN = String(
  process.env.POW_INTERNAL_VERIFIER_TOKEN ?? "",
);
const STRICT = /^(?:1|true|yes)$/iu.test(
  String(process.env.POW_INDEX_PARITY_STRICT ?? ""),
);
const REQUIRE_WORK_AMO_V5_READY = /^(?:1|true|yes)$/iu.test(
  String(process.env.WORK_AMO_V5_WRITES_ENABLED ?? ""),
);
const CHECK_ACTIVITY_SNAPSHOT = /^(?:1|true|yes)$/iu.test(
  String(process.env.POW_INDEX_PARITY_ACTIVITY_SNAPSHOT ?? ""),
);
const CHECK_FRESH_LOG_HISTORY = /^(?:1|true|yes)$/iu.test(
  String(process.env.POW_INDEX_PARITY_LOG_FRESH ?? ""),
);
const CHECK_FRESH_SNAPSHOTS = /^(?:1|true|yes)$/iu.test(
  String(process.env.POW_INDEX_PARITY_SNAPSHOT_FRESH ?? ""),
);
const CHECK_FRESH_TOKEN_HISTORY = /^(?:1|true|yes)$/iu.test(
  String(process.env.POW_INDEX_PARITY_TOKEN_FRESH ?? ""),
);
const DRY_RUN = process.argv.includes("--dry-run");
const INFINITY_BOND_REGRESSION_TXID =
  "411ff4ac6aeeb638abdc387b37734c384481bcce7dd01e28b827d02dc4968891";
const PAGINATION_GAP_INFINITY_BOND_TXID =
  "b4b17f84853ce5c9f6dbad7fe3cce0d61ac4cb92d92f7ea6d9d8c38256631f34";
const WORK_TRANSFER_REGRESSION_TXID =
  "7e9e711564be12330793b3415a032eca42bb742499fbdb8a6b8be6d6f1867354";
const WORK_DELIST_REGRESSION_TXID =
  "f5dbee238a09fe0da6a0e4d01526fefefa6676b86df742323ce49df0daa5ecf5";
const WORK_DELIST_REGRESSION_LISTING_TXID =
  "50cd4dff315842c999a06c3ed0be3616f61c33f1a2f0fce6f645e3f48e9b023c";
const WORK_TOKEN_ID =
  "d4e5ebf11d104d6a63fb74e42094364b25a5f7199a09e5c0e71408972466a8b8";
const CANONICAL_SUMMARY_SNAPSHOT_SQL_TEXT_MAX_BYTES =
  canonicalSummarySnapshotSqlTextMaxBytes();
const CANONICAL_SUMMARY_SNAPSHOT_ROOT_KEYS = Object.freeze([
  "checks",
  "generatedAt",
  "indexedThroughBlock",
  "indexedThroughBlockHash",
  "metrics",
  "missingLogEvents",
  "network",
  "ok",
  "snapshotId",
  "sourceHashes",
  "status",
  "summaryPayloads",
  "summaryPayloadsIndexedAt",
  "summaryRefresh",
  "totals",
  "workAmountStorageModel",
  "workSufficientState",
]);
const WORK_Q16_SUMMARY_TRANSITION_CHECKPOINT_MODEL =
  "canonical-work-q16-transition-checkpoint-v1";
const WORK_Q16_SUMMARY_TRANSITION_CHECKPOINT_KEYS = Object.freeze([
  "amountStorageModel",
  "closingStateCommitment",
  "decimals",
  "indexedThroughBlock",
  "indexedThroughBlockHash",
  "model",
  "precisionModel",
  "tokenStateCommitment",
  "transitionModel",
  "unitScale",
  "workTokenStateModel",
]);
const CANONICAL_SUMMARY_KEYS = [
  "growthSummary",
  "inceptionSummary",
  "infinitySummary",
  "logSummary",
  "marketplaceSummary",
  "tokenSummary",
  "workFloor",
  "workSummary",
];
const ADDRESS_MAIL_REGRESSION_CASES = [
  {
    address: "1BPVvi1GK4QkfqFMU4jHGjsQjyGwjJJJ7x",
    label: "otc",
    minInbox: 6,
    minSent: 6,
    minTotal: 12,
  },
  {
    address:
      "bc1p0uxp0axptr8rg9dndgtlwxn00j4hq8m88kg80tqd0t6045putwhq5ca7ed",
    label: "carbonz",
    minInbox: 1,
    minTotal: 1,
  },
  {
    address:
      "bc1p8ddc3s6z09ktchgdxxht8l0tt7gs7jn90w004uw2hrxuue39lp7qlxrd3q",
    label: "pinoratiko",
    minSent: 1,
    minTotal: 1,
  },
];

function endpoint(pathname, params = {}) {
  const url = new URL(`${API_BASE}${pathname}`);
  url.searchParams.set("network", NETWORK);
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== "") {
      url.searchParams.set(key, String(value));
    }
  }
  return url;
}

function snapshotParityParams(params = {}) {
  return CHECK_FRESH_SNAPSHOTS ? { ...params, fresh: "1" } : params;
}

async function readJson(url, options = {}) {
  let lastError = null;
  const retries = Number.isFinite(REQUEST_RETRIES)
    ? Math.max(0, Math.floor(REQUEST_RETRIES))
    : 0;

  for (let attempt = 0; attempt <= retries; attempt += 1) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    try {
      const internalVerifier = options.internalVerifier === true;
      if (internalVerifier) {
        if (
          !["127.0.0.1", "::1", "[::1]"].includes(
            url.hostname.toLowerCase(),
          ) ||
          url.protocol !== "http:" ||
          INTERNAL_VERIFIER_TOKEN.length < 32
        ) {
          throw new Error(
            "Registry parity authority requires an authenticated numeric loopback API origin.",
          );
        }
      }
      const response = await fetch(url, {
        ...(internalVerifier
          ? {
              headers: {
                "X-PoW-Internal-Verifier": INTERNAL_VERIFIER_TOKEN,
              },
            }
          : {}),
        signal: controller.signal,
      });
      if (!response.ok) {
        throw new Error(`${url.pathname} returned HTTP ${response.status}`);
      }
      return await response.json();
    } catch (error) {
      lastError = error;
      if (attempt >= retries) {
        break;
      }
      const delayMs = Math.min(30_000, 1000 * 2 ** attempt);
      console.error(
        JSON.stringify({
          attempt,
          delayMs,
          error: error?.message ?? String(error),
          retrying: true,
          url: String(url),
        }),
      );
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    } finally {
      clearTimeout(timeout);
    }
  }

  throw lastError;
}

function numberValue(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}

function check(results, name, ok, details = {}, severity = "error") {
  results.push({ details, name, ok: Boolean(ok), severity });
}

function rowNumber(row, key) {
  return numberValue(row?.[key]);
}

function summaryValue(payload) {
  const candidates = [
    payload?.actualValue?.totalSats,
    payload?.floor?.actualValue?.totalSats,
    payload?.workFloor?.actualValue?.totalSats,
    payload?.networkValueSats,
  ];
  return numberValue(candidates.find((value) => Number.isFinite(Number(value))));
}

function objectValue(value) {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value
    : {};
}

function payloadIndexedThroughBlock(payload) {
  const value = objectValue(payload);
  return Math.max(
    numberValue(value.indexedThroughBlock),
    numberValue(value.metrics?.indexedThroughBlock),
    numberValue(value.stats?.indexedThroughBlock),
  );
}

function canonicalSummaryCoverageByKey(snapshot) {
  const summaryPayloads = objectValue(snapshot?.payload?.summaryPayloads);
  return Object.fromEntries(
    CANONICAL_SUMMARY_KEYS.map((key) => {
      const payload = objectValue(summaryPayloads[key]);
      const parentCoverage = payloadIndexedThroughBlock(payload);
      const nested =
        key === "workSummary"
          ? objectValue(payload.floor)
          : key === "growthSummary" || key === "marketplaceSummary"
            ? objectValue(payload.workFloor)
            : null;
      const nestedCoverage = nested
        ? payloadIndexedThroughBlock(nested)
        : key === "workFloor" ||
            key === "inceptionSummary" ||
            key === "infinitySummary" ||
            key === "logSummary" ||
            key === "tokenSummary"
          ? parentCoverage
          : 0;
      return [
        key,
        parentCoverage > 0 && nestedCoverage > 0
          ? Math.min(parentCoverage, nestedCoverage)
          : 0,
      ];
    }),
  );
}

function pageUsesCurrentCursorContract(page, currentSnapshotId) {
  if (!page || !Array.isArray(page.items)) {
    return false;
  }
  const snapshotId = String(page.snapshotId ?? "");
  const cursor = String(page.cursor ?? "");
  const nextCursor = String(page.nextCursor ?? "");
  if (snapshotId) {
    return (
      snapshotId === currentSnapshotId &&
      cursor.startsWith(`snapshot:${snapshotId}:`) &&
      (!nextCursor || nextCursor.startsWith(`snapshot:${snapshotId}:`))
    );
  }
  return (
    cursor === String(numberValue(page.start)) &&
    (!nextCursor || nextCursor === String(numberValue(page.end)))
  );
}

function tokenHistoryPageHasExactCoverage(page, currentSnapshotId) {
  if (
    !pageUsesCurrentCursorContract(page, currentSnapshotId) ||
    String(page?.snapshotId ?? "")
  ) {
    return false;
  }
  const exactInteger = (value, minimum = 0) => {
    if (
      value === undefined ||
      value === null ||
      typeof value === "boolean" ||
      (typeof value === "string" && value.trim() === "")
    ) {
      return null;
    }
    const normalized = typeof value === "string" ? value.trim() : value;
    if (
      typeof normalized === "string" &&
      !/^(?:0|[1-9][0-9]*)$/u.test(normalized)
    ) {
      return null;
    }
    const number = Number(normalized);
    return Number.isSafeInteger(number) && number >= minimum ? number : null;
  };
  const indexedThroughBlock = exactInteger(page?.indexedThroughBlock, 1);
  const start = exactInteger(page?.start);
  const end = exactInteger(page?.end);
  const limit = exactInteger(page?.limit, 1);
  const totalCount = exactInteger(page?.totalCount);
  if (
    indexedThroughBlock === null ||
    !/^[0-9a-f]{64}$/u.test(
      String(page?.indexedThroughBlockHash ?? "").trim().toLowerCase(),
    ) ||
    start === null ||
    end === null ||
    limit === null ||
    totalCount === null ||
    start > totalCount
  ) {
    return false;
  }
  const expectedEnd = Math.min(totalCount, start + limit);
  const expectedHasMore = expectedEnd < totalCount;
  const expectedNextCursor = expectedHasMore ? String(expectedEnd) : "";
  return (
    end === expectedEnd &&
    String(page?.cursor ?? "") === String(start) &&
    String(page?.nextCursor ?? "") === expectedNextCursor &&
    page?.hasMore === expectedHasMore &&
    page.items.length === end - start &&
    exactInteger(page?.page) === Math.floor(start / limit) &&
    exactInteger(page?.pageCount, 1) ===
      Math.max(1, Math.ceil(totalCount / limit)) &&
    exactInteger(page?.pageSize, 1) === limit
  );
}

function uniqueActivityTxids(items) {
  return new Set(
    (Array.isArray(items) ? items : [])
      .map((item) => String(item?.txid ?? "").trim().toLowerCase())
      .filter((txid) => /^[0-9a-f]{64}$/u.test(txid)),
  );
}

function activityItemStatus(item) {
  const status = String(item?.status ?? "").trim().toLowerCase();
  if (["confirmed", "pending", "dropped", "orphaned"].includes(status)) {
    return status;
  }
  if (item?.dropped === true) {
    return "dropped";
  }
  return item?.confirmed === false ? "pending" : "confirmed";
}

function arrayLength(value) {
  return Array.isArray(value) ? value.length : 0;
}

function registryParityAuthorityIsComplete(payload, network) {
  const authority = objectValue(payload?._powRegistryParityAuthority);
  const coreBefore = objectValue(authority.core?.before);
  const coreAfter = objectValue(authority.core?.after);
  const electrumBefore = objectValue(authority.electrum?.before);
  const electrumAfter = objectValue(authority.electrum?.after);
  const confirmed = objectValue(authority.hydration?.confirmed);
  const pending = objectValue(authority.hydration?.pending);
  const listings = objectValue(authority.listingReconciliation);
  const pendingTime = objectValue(authority.pendingMempoolTime);
  const hash = (value) =>
    String(value ?? "").trim().toLowerCase();
  const exactCount = (value) => {
    const number = Number(value);
    return Number.isSafeInteger(number) && number >= 0 ? number : null;
  };
  const exactHeight = (value) => {
    const number = Number(value);
    return Number.isSafeInteger(number) && number > 0 ? number : null;
  };
  const validHash = (value) => /^[0-9a-f]{64}$/u.test(hash(value));
  const source = String(payload?.source ?? "").trim();
  const coreHeight = exactHeight(coreBefore.height);
  const confirmedCount = exactCount(confirmed.observedCount);
  const pendingCount = exactCount(pending.observedCount);
  const anchoredCount = exactCount(listings.anchoredListingCount);
  const inputListingCount = exactCount(listings.inputListingCount);
  const legacyListingCount = exactCount(
    listings.legacyUnanchoredListingCount,
  );
  const outputListingCount = exactCount(listings.outputListingCount);
  const spentListingCount = exactCount(listings.spentListingCount);
  const unspentListingCount = exactCount(listings.unspentListingCount);
  return (
    authority.model === "proof-registry-first-party-fenced-v1" &&
    authority.network === network &&
    authority.source === source &&
    source.startsWith("electrum://") &&
    source.endsWith("+bitcoin-core") &&
    !source.includes("proof-indexer") &&
    Number.isFinite(Date.parse(authority.generatedAt)) &&
    coreHeight !== null &&
    coreHeight === exactHeight(coreAfter.height) &&
    validHash(coreBefore.blockHash) &&
    hash(coreBefore.blockHash) === hash(coreAfter.blockHash) &&
    Number(payload?.indexedThroughBlock) === coreHeight &&
    hash(payload?.indexedThroughBlockHash) === hash(coreBefore.blockHash) &&
    exactHeight(electrumBefore.height) === coreHeight &&
    exactHeight(electrumAfter.height) === coreHeight &&
    hash(electrumBefore.blockHash) === hash(coreBefore.blockHash) &&
    hash(electrumAfter.blockHash) === hash(coreBefore.blockHash) &&
    validHash(electrumBefore.headerSha256) &&
    hash(electrumBefore.headerSha256) ===
      hash(electrumAfter.headerSha256) &&
    validHash(electrumBefore.snapshotSha256) &&
    hash(electrumBefore.snapshotSha256) ===
      hash(electrumAfter.snapshotSha256) &&
    confirmedCount !== null &&
    confirmedCount > 0 &&
    pendingCount !== null &&
    arrayLength(payload?.records) > 0 &&
    confirmedCount === exactCount(confirmed.hydratedCount) &&
    pendingCount === exactCount(pending.hydratedCount) &&
    validHash(confirmed.observedSha256) &&
    hash(confirmed.observedSha256) === hash(confirmed.hydratedSha256) &&
    hash(confirmed.observedSha256) ===
      hash(electrumBefore.confirmedTxidsSha256) &&
    hash(electrumBefore.confirmedTxidsSha256) ===
      hash(electrumAfter.confirmedTxidsSha256) &&
    validHash(pending.observedSha256) &&
    hash(pending.observedSha256) === hash(pending.hydratedSha256) &&
    hash(pending.observedSha256) ===
      hash(electrumBefore.pendingTxidsSha256) &&
    hash(electrumBefore.pendingTxidsSha256) ===
      hash(electrumAfter.pendingTxidsSha256) &&
    confirmedCount === exactCount(electrumBefore.confirmedTxidCount) &&
    confirmedCount === exactCount(electrumAfter.confirmedTxidCount) &&
    pendingCount === exactCount(electrumBefore.pendingTxidCount) &&
    pendingCount === exactCount(electrumAfter.pendingTxidCount) &&
    confirmedCount + pendingCount ===
      exactCount(electrumBefore.historyEntryCount) &&
    confirmedCount + pendingCount ===
      exactCount(electrumAfter.historyEntryCount) &&
    confirmedCount + pendingCount ===
      exactCount(authority.hydration?.totalObserved) &&
    confirmedCount + pendingCount ===
      exactCount(authority.hydration?.totalHydrated) &&
    pendingCount === exactCount(pendingTime.count) &&
    validHash(pendingTime.beforeSha256) &&
    hash(pendingTime.beforeSha256) === hash(pendingTime.afterSha256) &&
    listings.model === "proof-registry-core-gettxout-v1" &&
    listings.includeMempool === true &&
    anchoredCount !== null &&
    inputListingCount !== null &&
    legacyListingCount !== null &&
    outputListingCount !== null &&
    spentListingCount !== null &&
    unspentListingCount !== null &&
    anchoredCount === unspentListingCount + spentListingCount &&
    inputListingCount === legacyListingCount + anchoredCount &&
    outputListingCount === legacyListingCount + unspentListingCount &&
    outputListingCount === arrayLength(payload?.listings) &&
    Number(payload?.stats?.activeListings) === outputListingCount &&
    Number(payload?.stats?.listingCount) === outputListingCount &&
    Number(payload?.stats?.listings) === outputListingCount &&
    validHash(listings.checkedOutpointsSha256) &&
    exactHeight(listings.checkpoint?.height) === coreHeight &&
    hash(listings.checkpoint?.blockHash) === hash(coreBefore.blockHash)
  );
}

function registryParityValueSearchText(value) {
  if (value === null || value === undefined) {
    return "";
  }
  if (Array.isArray(value)) {
    return value.map(registryParityValueSearchText).join(" ");
  }
  if (typeof value === "object") {
    return Object.values(value).map(registryParityValueSearchText).join(" ");
  }
  return String(value);
}

function registryParityHistoryPage(payload, params) {
  const kind = String(params?.kind ?? "records").trim().toLowerCase();
  const sourceItems = Array.isArray(payload?.[kind]) ? payload[kind] : [];
  const query = String(params?.q ?? params?.search ?? "")
    .trim()
    .toLowerCase();
  const filtered = query
    ? sourceItems.filter((item) =>
        registryParityValueSearchText(item).toLowerCase().includes(query),
      )
    : sourceItems;
  const limit = Math.min(500, Math.max(1, Number(params?.limit) || 200));
  const requestedPage = Math.min(
    1_000_000,
    Math.max(0, Number(params?.page) || 0),
  );
  const requestedOffset = Number(params?.offset);
  const offset = Number.isSafeInteger(requestedOffset) && requestedOffset >= 0
    ? requestedOffset
    : requestedPage * limit;
  const totalCount = filtered.length;
  const start = Math.min(offset, totalCount);
  const end = Math.min(totalCount, start + limit);
  const heights = filtered
    .flatMap((item) => [item?.blockHeight, item?.updatedHeight])
    .map(Number)
    .filter((height) => Number.isSafeInteger(height) && height > 0);
  return {
    cursor: String(start),
    end,
    hasMore: end < totalCount,
    indexedAt: payload?.indexedAt,
    indexedThroughBlock:
      heights.length > 0 ? Math.max(...heights) : undefined,
    items: filtered.slice(start, end),
    kind,
    limit,
    network: payload?.network,
    nextCursor: end < totalCount ? String(end) : "",
    page: Math.floor(start / limit),
    pageCount: Math.max(1, Math.ceil(totalCount / limit)),
    pageSize: limit,
    query,
    source: payload?.source,
    start,
    totalCount,
  };
}

async function readRenderedProjectionParity(pool, network) {
  const client = await pool.connect();
  let transactionOpen = false;
  try {
    await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
    transactionOpen = true;
    const eventResult = await client.query(
      `
        SELECT
          event.event_id::text AS event_id,
          event.network,
          event.txid,
          event.protocol,
          event.kind,
          event.valid,
          event.amount_sats::text,
          event.data_bytes,
          event.event_time,
          event.payload,
          event.status
        FROM proof_indexer.events event
        WHERE event.network = $1
          AND event.status IN ('pending', 'confirmed', 'dropped', 'orphaned')
        ORDER BY event.event_id ASC
      `,
      [network],
    );
    const participantResult = await client.query(
      `
        SELECT
          event.event_id::text AS event_id,
          COALESCE(participant.address, '') AS address,
          COALESCE(participant.role, '') AS role,
          COALESCE(participant.powid, '') AS powid
        FROM proof_indexer.events event
        JOIN proof_indexer.event_participants participant
          ON participant.event_id = event.event_id
        WHERE event.network = $1
          AND event.status IN ('pending', 'confirmed', 'dropped', 'orphaned')
        ORDER BY event.event_id ASC, participant.address ASC,
          participant.role ASC, COALESCE(participant.powid, '') ASC
      `,
      [network],
    );
    const refResult = await client.query(
      `
        SELECT
          event.event_id::text AS event_id,
          COALESCE(ref.ref_type, '') AS ref_type,
          COALESCE(ref.ref_value, '') AS ref_value
        FROM proof_indexer.events event
        JOIN proof_indexer.event_refs ref
          ON ref.event_id = event.event_id
        WHERE event.network = $1
          AND event.status IN ('pending', 'confirmed', 'dropped', 'orphaned')
        ORDER BY event.event_id ASC, ref.ref_type ASC, ref.ref_value ASC
      `,
      [network],
    );
    const mailResult = await client.query(
      `
        SELECT
          mail.network,
          mail.txid,
          mail.status,
          mail.sender_address,
          mail.subject,
          mail.parent_txid,
          mail.body_text,
          mail.amount_sats::text,
          mail.data_bytes,
          mail.message,
          mail.event_time
        FROM proof_indexer.mail_items mail
        WHERE mail.network = $1
        ORDER BY mail.txid ASC
      `,
      [network],
    );
    const mailTransactionResult = await client.query(
      `
        SELECT
          transaction_row.network,
          transaction_row.txid,
          transaction_row.status,
          transaction_row.raw_tx
        FROM proof_indexer.transactions transaction_row
        WHERE transaction_row.network = $1
          AND (
            EXISTS (
              SELECT 1
              FROM proof_indexer.events event
              WHERE event.network = transaction_row.network
                AND event.txid = transaction_row.txid
                AND event.protocol = 'pwm1'
                AND event.kind = ANY($2::text[])
                AND event.status IN (
                  'pending',
                  'confirmed',
                  'dropped',
                  'orphaned'
                )
                AND event.valid = true
            )
            OR (
              jsonb_typeof(transaction_row.raw_tx->'item') = 'object'
              AND lower(btrim(COALESCE(
                transaction_row.raw_tx->'item'->>'kind',
                ''
              ))) = ANY($2::text[])
            )
          )
        ORDER BY transaction_row.txid ASC
      `,
      [network, PROOF_INDEX_RENDERED_MAIL_KINDS],
    );
    await client.query("COMMIT");
    transactionOpen = false;
    return {
      eventRelations: proofIndexCanonicalEventRelationParity({
        eventRows: eventResult.rows,
        participantRows: participantResult.rows,
        refRows: refResult.rows,
      }),
      mailProjection: proofIndexCanonicalMailProjectionParity({
        eventRows: eventResult.rows,
        mailRows: mailResult.rows,
        transactionRows: mailTransactionResult.rows,
      }),
    };
  } catch (error) {
    if (transactionOpen) {
      await client.query("ROLLBACK").catch(() => {});
    }
    throw error;
  } finally {
    client.release();
  }
}

if (DRY_RUN) {
  console.log(
    JSON.stringify(
      {
        apiBase: API_BASE,
        dryRun: true,
        network: NETWORK,
        strict: STRICT,
      },
      null,
      2,
    ),
  );
  process.exit(0);
}

const pool = createProofIndexPool({
  env: {
    ...process.env,
    POW_INDEX_DB_APP_NAME:
      process.env.POW_INDEX_DB_APP_NAME ?? "proof-indexer-parity",
  },
});

try {
  const ledger = await readJson(endpoint("/api/v1/ledger-consistency"));
  const renderedProjectionParity = await readRenderedProjectionParity(
    pool,
    NETWORK,
  );
  const eventRelationParity = renderedProjectionParity.eventRelations;
  const mailProjectionParity = renderedProjectionParity.mailProjection;
  const countsResult = await pool.query(
    `
      SELECT
        (SELECT count(*) FROM proof_indexer.transactions WHERE network = $1) AS transactions_total,
        (SELECT count(*) FROM proof_indexer.transactions WHERE network = $1 AND status = 'confirmed') AS transactions_confirmed,
        (SELECT count(*) FROM proof_indexer.transactions WHERE network = $1 AND status = 'pending') AS transactions_pending,
        (SELECT count(*) FROM proof_indexer.transactions WHERE network = $1 AND status = 'dropped') AS transactions_dropped,
        (
          SELECT count(*)
          FROM proof_indexer.transactions transaction_row
          LEFT JOIN proof_indexer.blocks canonical_block
            ON canonical_block.network = transaction_row.network
           AND canonical_block.block_hash = transaction_row.block_hash
           AND canonical_block.height = transaction_row.block_height
           AND canonical_block.canonical = true
          WHERE transaction_row.network = $1
            AND transaction_row.status = 'confirmed'
            AND (
              transaction_row.block_height IS NULL
              OR transaction_row.block_hash IS NULL
              OR transaction_row.block_time IS NULL
              OR canonical_block.block_hash IS NULL
              OR NOT CASE
                WHEN jsonb_typeof(
                  transaction_row.raw_tx->'canonicalBlockScan'
                ) = 'object'
                  AND transaction_row.raw_tx->'canonicalBlockScan'->>'network' = $1
                  AND transaction_row.raw_tx->'canonicalBlockScan'->>'height' ~
                    '^[0-9]+$'
                  AND transaction_row.raw_tx->'canonicalBlockScan'->>'blockHash' ~
                    '^[0-9a-fA-F]{64}$'
                THEN
                  (transaction_row.raw_tx->'canonicalBlockScan'->>'height')::integer =
                    transaction_row.block_height
                  AND lower(
                    transaction_row.raw_tx->'canonicalBlockScan'->>'blockHash'
                  ) = lower(transaction_row.block_hash)
                ELSE false
              END
            )
        ) AS confirmed_transactions_without_canonical_block,
        (
          SELECT count(*)
          FROM proof_indexer.transactions
          WHERE network = $1
            AND status IN ('pending', 'dropped', 'orphaned')
            AND (
              block_hash IS NOT NULL
              OR block_height IS NOT NULL
              OR block_index IS NOT NULL
              OR block_time IS NOT NULL
              OR confirmed_at IS NOT NULL
            )
        ) AS nonconfirmed_transactions_with_block_metadata,
        (SELECT count(*) FROM proof_indexer.events WHERE network = $1) AS events_total,
        (SELECT count(*) FROM proof_indexer.events WHERE network = $1 AND status = 'confirmed') AS events_confirmed,
        (SELECT count(*) FROM proof_indexer.events WHERE network = $1 AND status = 'pending') AS events_pending,
        (SELECT count(*) FROM proof_indexer.events WHERE network = $1 AND status = 'dropped') AS events_dropped,
        (SELECT count(*) FROM proof_indexer.events WHERE network = $1 AND status = 'confirmed' AND valid = true) AS events_confirmed_valid,
        (SELECT count(*) FROM proof_indexer.events WHERE network = $1 AND status = 'pending' AND valid = true) AS events_pending_valid,
        (
          SELECT count(*)
          FROM proof_indexer.events event_row
          JOIN proof_indexer.transactions transaction_row
            ON transaction_row.network = event_row.network
           AND transaction_row.txid = event_row.txid
          JOIN proof_indexer.blocks canonical_block
            ON canonical_block.network = transaction_row.network
           AND canonical_block.block_hash = transaction_row.block_hash
           AND canonical_block.height = transaction_row.block_height
           AND canonical_block.canonical = true
          WHERE event_row.network = $1
            AND event_row.protocol = 'pwid1'
            AND event_row.status IN ('pending', 'dropped', 'orphaned')
            AND transaction_row.status = 'confirmed'
        ) AS canonical_confirmed_transactions_with_volatile_pwid_events,
        (SELECT count(DISTINCT txid) FROM proof_indexer.events WHERE network = $1 AND status IN ('confirmed', 'pending') AND valid = true) AS canonical_activity_txids,
        (SELECT count(DISTINCT e.txid) FROM proof_indexer.events e LEFT JOIN proof_indexer.transactions t ON t.network = e.network AND t.txid = e.txid WHERE e.network = $1 AND e.status IN ('confirmed', 'pending') AND e.valid = true AND t.txid IS NULL) AS canonical_activity_txids_missing_transaction,
        (SELECT count(*) FROM proof_indexer.events e LEFT JOIN proof_indexer.transactions t ON t.network = e.network AND t.txid = e.txid WHERE e.network = $1 AND e.status = 'confirmed' AND e.valid = true AND COALESCE(t.status, '') <> 'confirmed') AS confirmed_activity_events_without_confirmed_transaction,
        (
          SELECT count(*)
          FROM proof_indexer.events e
          JOIN proof_indexer.transactions t
            ON t.network = e.network AND t.txid = e.txid
          WHERE e.network = $1
            AND e.status = 'confirmed'
            AND e.valid = true
            AND (
              t.status <> 'confirmed'
              OR e.block_height IS DISTINCT FROM t.block_height
              OR e.block_index IS DISTINCT FROM t.block_index
              OR e.block_index IS NULL
              OR e.op_return_vout IS NULL
              OR e.record_ordinal < 0
              OR e.block_time IS DISTINCT FROM t.block_time
              OR e.event_time IS NULL
              OR e.event_time < TIMESTAMPTZ '2009-01-03 18:15:05+00'
            )
        ) AS confirmed_events_without_parent_metadata,
        (
          SELECT count(*)
          FROM proof_indexer.events
          WHERE network = $1
            AND status IN ('pending', 'dropped', 'orphaned')
            AND (
              block_height IS NOT NULL
              OR block_index IS NOT NULL
              OR block_time IS NOT NULL
            )
        ) AS nonconfirmed_events_with_block_metadata,
        (
          SELECT count(*)
          FROM proof_indexer.events
          WHERE network = $1
            AND (
              (status = 'confirmed' AND payload->>'confirmed' = 'false')
              OR (status <> 'confirmed' AND payload->>'confirmed' = 'true')
              OR (
                lower(COALESCE(payload->>'status', '')) IN (
                  'pending',
                  'confirmed',
                  'dropped',
                  'orphaned'
                )
                AND lower(payload->>'status') <> status
              )
            )
        ) AS event_payload_status_mismatches,
        (SELECT count(*) FROM proof_indexer.event_refs er JOIN proof_indexer.events e ON e.event_id = er.event_id WHERE e.network = $1) AS event_refs,
        (SELECT count(*) FROM proof_indexer.event_participants ep JOIN proof_indexer.events e ON e.event_id = ep.event_id WHERE e.network = $1) AS event_participants,
        (SELECT count(*) FROM proof_indexer.credit_definitions WHERE network = $1 AND confirmed = true) AS credit_definitions_confirmed,
        (SELECT count(*) FROM proof_indexer.credit_balances WHERE network = $1) AS credit_balances,
        (SELECT count(*) FROM proof_indexer.credit_listings WHERE network = $1) AS credit_listings,
        (SELECT count(*) FROM proof_indexer.work_usd_quotes WHERE network = $1 AND status = 'confirmed' AND valid = true) AS work_usd_quotes_confirmed,
        (SELECT count(*) FROM proof_indexer.work_amo_listing_terms WHERE network = $1) AS work_amo_listing_terms,
        (SELECT count(*) FROM proof_indexer.id_records WHERE network = $1) AS id_records,
        (SELECT count(*) FROM proof_indexer.ledger_snapshots WHERE network = $1) AS ledger_snapshots
    `,
    [NETWORK],
  );
  const latestSnapshotResult = await pool.query(
    `
      SELECT
        snapshot_id,
        generated_at,
        indexed_through_block,
        source_hashes,
        consistency,
        payload
      FROM proof_indexer.ledger_snapshots
      WHERE network = $1
        AND payload ? 'summaryPayloads'
        AND octet_length(payload::text) <= $2
        AND NOT EXISTS (
          SELECT 1
          FROM jsonb_object_keys(
            CASE
              WHEN jsonb_typeof(payload) = 'object' THEN payload
              ELSE '{}'::jsonb
            END
          ) AS root_keys(root_key)
          WHERE root_key <> ALL($3::text[])
        )
        AND payload ? 'workSufficientState'
        AND NOT (payload ? 'tokenStatePayloads')
        AND jsonb_typeof(payload->'workSufficientState') = 'object'
        AND NOT EXISTS (
          SELECT 1
          FROM jsonb_object_keys(
            CASE
              WHEN jsonb_typeof(payload->'workSufficientState') =
                'object'
                THEN payload->'workSufficientState'
              ELSE '{}'::jsonb
            END
          ) AS state_keys(state_key)
          WHERE state_key <> ALL($5::text[])
        )
        AND (
          SELECT count(*)
          FROM jsonb_object_keys(
            CASE
              WHEN jsonb_typeof(payload->'workSufficientState') =
                'object'
                THEN payload->'workSufficientState'
              ELSE '{}'::jsonb
            END
          ) AS state_keys(state_key)
        ) = 11
        AND payload->'workSufficientState'->>'model' = $4
        AND payload->'workSufficientState'->>'amountStorageModel' =
          'work-subatoms-v2'
        AND payload->'workSufficientState'->'decimals' = to_jsonb(16)
        AND payload->'workSufficientState'->>'precisionModel' =
          'canonical-work-subatoms-v2'
        AND payload->'workSufficientState'->'unitScale' =
          to_jsonb('10000000000000000'::text)
        AND payload->'workSufficientState'->>'transitionModel' =
          'canonical-work-amo-full-position-block-sequencer-v4'
        AND payload->'workSufficientState'->>'workTokenStateModel' =
          'canonical-work-token-state-subatoms-v3'
        AND jsonb_typeof(payload->'workSufficientState'
          ->'tokenStateCommitment') = 'object'
        AND payload->'workSufficientState'->'tokenStateCommitment' =
          jsonb_build_object(
            'model', 'canonical-work-amo-payload-sha256-v1',
            'payloadBytes', payload->'workSufficientState'
              ->'tokenStateCommitment'->'payloadBytes',
            'sha256', payload->'workSufficientState'
              ->'tokenStateCommitment'->>'sha256'
          )
        AND jsonb_typeof(payload->'workSufficientState'
          ->'tokenStateCommitment'->'payloadBytes') = 'number'
        AND payload->'workSufficientState'->'tokenStateCommitment'
          ->>'payloadBytes' ~ '^[1-9][0-9]*$'
        AND jsonb_typeof(payload->'workSufficientState'
          ->'tokenStateCommitment'->'sha256') = 'string'
        AND payload->'workSufficientState'->'tokenStateCommitment'
          ->>'sha256' ~ '^[0-9a-f]{64}$'
        AND jsonb_typeof(payload->'workSufficientState'
          ->'closingStateCommitment') = 'object'
        AND payload->'workSufficientState'->'closingStateCommitment' =
          jsonb_build_object(
            'model', 'canonical-work-amo-sufficient-state-sha256-v1',
            'payloadBytes', payload->'workSufficientState'
              ->'closingStateCommitment'->'payloadBytes',
            'sha256', payload->'workSufficientState'
              ->'closingStateCommitment'->>'sha256'
          )
        AND jsonb_typeof(payload->'workSufficientState'
          ->'closingStateCommitment'->'payloadBytes') = 'number'
        AND payload->'workSufficientState'->'closingStateCommitment'
          ->>'payloadBytes' ~ '^[1-9][0-9]*$'
        AND jsonb_typeof(payload->'workSufficientState'
          ->'closingStateCommitment'->'sha256') = 'string'
        AND payload->'workSufficientState'->'closingStateCommitment'
          ->>'sha256' ~ '^[0-9a-f]{64}$'
        AND payload->'workSufficientState'->'indexedThroughBlock' =
          to_jsonb(indexed_through_block)
        AND payload->'workSufficientState'
          ->>'indexedThroughBlockHash' ~ '^[0-9a-f]{64}$'
        AND source_hashes->>'blockScan' ~ '^[0-9a-f]{64}$'
        AND payload->'workSufficientState'
          ->>'indexedThroughBlockHash' =
          source_hashes->>'blockScan'
        AND EXISTS (
          SELECT 1
          FROM proof_indexer.work_amo_block_transitions transition
          JOIN proof_indexer.blocks transition_block
            ON transition_block.network = transition.network
           AND transition_block.height = transition.block_height
           AND transition_block.block_hash = transition.block_hash
           AND transition_block.canonical = true
          WHERE transition.network = ledger_snapshots.network
            AND transition.block_height =
              ledger_snapshots.indexed_through_block
            AND lower(transition.block_hash) =
              lower(ledger_snapshots.source_hashes->>'blockScan')
            AND transition.model =
              'canonical-work-amo-full-position-block-sequencer-v4'
            AND transition.state_commitment_model =
              'canonical-work-amo-sufficient-state-sha256-v1'
            AND transition.work_token_state_model =
              'canonical-work-token-state-subatoms-v3'
            AND transition.complete = true
            AND payload->'workSufficientState'
              ->'closingStateCommitment' = jsonb_build_object(
                'model', transition.state_commitment_model,
                'payloadBytes', transition.closing_state_payload_bytes,
                'sha256', transition.closing_state_sha256
              )
            AND payload->'workSufficientState'
              ->'tokenStateCommitment' = transition.payload
                ->'closingSufficientState'->'tokenStateCommitment'
        )
        AND payload ? 'snapshotId'
        AND payload->>'snapshotId' = snapshot_id
        AND COALESCE(consistency->>'ok', payload->>'ok', 'false') = 'true'
        AND COALESCE(consistency->>'status', payload->>'status', '') <>
          'summary-snapshot-fallback'
        AND payload->'summaryRefresh'->>'mode' = 'canonical-summary-refresh'
        AND payload->>'indexedThroughBlockHash' ~ '^[0-9a-fA-F]{64}$'
        AND payload->'summaryRefresh'->>'indexedThroughBlockHash' =
          payload->>'indexedThroughBlockHash'
        AND source_hashes ? 'canonicalSummary'
        AND jsonb_typeof(payload->'summaryPayloads') = 'object'
        AND jsonb_typeof(payload->'summaryPayloads'->'growthSummary') = 'object'
        AND jsonb_typeof(payload->'summaryPayloads'->'inceptionSummary') = 'object'
        AND jsonb_typeof(payload->'summaryPayloads'->'infinitySummary') = 'object'
        AND jsonb_typeof(payload->'summaryPayloads'->'logSummary') = 'object'
        AND jsonb_typeof(payload->'summaryPayloads'->'marketplaceSummary') = 'object'
        AND jsonb_typeof(payload->'summaryPayloads'->'tokenSummary') = 'object'
        AND jsonb_typeof(payload->'summaryPayloads'->'workFloor') = 'object'
        AND jsonb_typeof(payload->'summaryPayloads'->'workSummary') = 'object'
        AND EXISTS (
          SELECT 1
          FROM jsonb_array_elements(COALESCE(consistency->'checks', '[]'::jsonb)) AS check_item
          WHERE check_item->>'name' = 'token-components-cover-confirmed-activity'
            AND COALESCE(check_item->>'ok', 'false') = 'true'
        )
        AND EXISTS (
          SELECT 1
          FROM jsonb_array_elements(COALESCE(consistency->'checks', '[]'::jsonb)) AS check_item
          WHERE check_item->>'name' = 'canonical-activity-count-matches-public-log'
            AND COALESCE(check_item->>'ok', 'false') = 'true'
        )
      ORDER BY indexed_through_block DESC NULLS LAST, generated_at DESC
      LIMIT 1
    `,
    [
      NETWORK,
      CANONICAL_SUMMARY_SNAPSHOT_SQL_TEXT_MAX_BYTES,
      [...CANONICAL_SUMMARY_SNAPSHOT_ROOT_KEYS],
      WORK_Q16_SUMMARY_TRANSITION_CHECKPOINT_MODEL,
      [...WORK_Q16_SUMMARY_TRANSITION_CHECKPOINT_KEYS],
    ],
  );

  const counts = countsResult.rows[0] ?? {};
  const latestSnapshot = latestSnapshotResult.rows[0] ?? null;
  const canonicalSummaryCoverage = canonicalSummaryCoverageByKey(latestSnapshot);
  const canonicalSummaryCoverageValues = Object.values(
    canonicalSummaryCoverage,
  );
  const canonicalSummaryIndexedThroughBlock =
    canonicalSummaryCoverageValues.length === CANONICAL_SUMMARY_KEYS.length &&
    canonicalSummaryCoverageValues.every((height) => height > 0)
      ? Math.min(...canonicalSummaryCoverageValues)
      : 0;
  const currentSnapshotId = String(latestSnapshot?.snapshot_id ?? "");
  const ledgerIndexedThroughBlock = payloadIndexedThroughBlock(ledger);
  const metrics = ledger.metrics ?? {};
  const missingLogEvents = Array.isArray(ledger.missingLogEvents)
    ? ledger.missingLogEvents
    : [];
  const metricActivityItems = numberValue(metrics.activityItems);
  const confirmedComputerActions = numberValue(metrics.confirmedComputerActions);
  const confirmedTokens = numberValue(metrics.confirmedTokens);
  let canonicalActivityPayload = null;
  if (CHECK_ACTIVITY_SNAPSHOT) {
    try {
      canonicalActivityPayload = await readJson(
        endpoint("/api/v1/log", { fresh: "1" }),
      );
    } catch (error) {
      console.error(
        JSON.stringify({
          error: error?.message ?? String(error),
          phase: "canonical-activity-coverage",
        }),
      );
    }
  }
  const canonicalActivityRows = Array.isArray(canonicalActivityPayload?.activity)
    ? canonicalActivityPayload.activity
    : [];
  const canonicalConfirmedActivityItems = canonicalActivityRows.filter(
    (item) => activityItemStatus(item) === "confirmed",
  ).length;
  const canonicalPendingActivityItems = canonicalActivityRows.filter(
    (item) => activityItemStatus(item) === "pending",
  ).length;
  const canonicalActivityItemCount =
    canonicalActivityRows.length || metricActivityItems;
  const canonicalActivityTxids = uniqueActivityTxids(canonicalActivityRows);
  const canonicalActivityTxidCount =
    canonicalActivityTxids.size || rowNumber(counts, "canonical_activity_txids");
  const expectedConfirmedActivityItems =
    canonicalActivityRows.length > 0
      ? canonicalConfirmedActivityItems
      : confirmedComputerActions;
  const expectedPendingActivityItems =
    canonicalActivityRows.length > 0
      ? canonicalPendingActivityItems
      : Math.max(0, metricActivityItems - confirmedComputerActions);
  const checks = [];
  const workAmoRequestedThroughHeight = Math.max(
    ledgerIndexedThroughBlock,
    numberValue(latestSnapshot?.indexed_through_block),
  );
  const workAmoRequestedThroughBlockHash =
    numberValue(latestSnapshot?.indexed_through_block) ===
      workAmoRequestedThroughHeight
      ? String(
          latestSnapshot?.payload?.indexedThroughBlockHash ?? "",
        )
          .trim()
          .toLowerCase()
      : "";
  const [workAmoDeclaration, workAmoQuoteHead, workAmoReadiness] =
    await Promise.all([
      proofIndexWorkAmoV5Declaration(
        NETWORK,
        workAmoRequestedThroughHeight,
      ),
      proofIndexWorkUsdQuoteHead(NETWORK),
      proofIndexWorkAmoReplayReadiness(NETWORK, {
        throughBlockHash: workAmoRequestedThroughBlockHash,
        throughHeight: workAmoRequestedThroughHeight,
      }),
    ]);

  check(
    checks,
    "work-amo-v5-declaration-evidence",
    workAmoDeclaration?.canonical === true &&
      workAmoDeclaration?.evidenceComplete === true &&
      workAmoDeclaration?.blockIndex === 141,
    {
      declaration: workAmoDeclaration,
    },
  );
  check(
    checks,
    "work-amo-v5-canonical-positions",
    workAmoReadiness?.positionsReady === true,
    {
      duplicatePositions: workAmoReadiness?.duplicatePositions ?? null,
      missingPositions: workAmoReadiness?.missingPositions ?? null,
      reasons: workAmoReadiness?.reasons ?? [],
    },
    REQUIRE_WORK_AMO_V5_READY ? "error" : "warning",
  );
  check(
    checks,
    "work-amo-v5-migration",
    workAmoReadiness?.migrationReady === true &&
      workAmoReadiness?.legacyStateReady === true &&
      workAmoReadiness?.frozenTermsReady === true,
    {
      migration: workAmoReadiness?.migration ?? null,
      missingFrozenTerms: workAmoReadiness?.missingFrozenTerms ?? null,
      postActivationV4Active:
        workAmoReadiness?.postActivationV4Active ?? null,
      preActivationV4Actions:
        workAmoReadiness?.preActivationV4Actions ?? null,
      postV1V3Active: workAmoReadiness?.postV1V3Active ?? null,
      reasons: workAmoReadiness?.reasons ?? [],
    },
    "warning",
  );
  check(
    checks,
    "work-amo-v5-usd-quote-head",
    Boolean(workAmoQuoteHead) && workAmoReadiness?.quoteReady === true,
    {
      quoteHead: workAmoQuoteHead,
      reasons: workAmoReadiness?.reasons ?? [],
    },
    REQUIRE_WORK_AMO_V5_READY ? "error" : "warning",
  );
  check(
    checks,
    "work-amo-v5-write-readiness",
    REQUIRE_WORK_AMO_V5_READY
      ? workAmoReadiness?.indexReady === true
      : true,
    {
      required: REQUIRE_WORK_AMO_V5_READY,
      readiness: workAmoReadiness,
    },
  );

  check(checks, "canonical-ledger-green", ledger.ok === true && ledger.status === "green", {
    ok: ledger.ok,
    status: ledger.status,
  });
  check(checks, "canonical-log-complete", missingLogEvents.length === 0, {
    missing: missingLogEvents.length,
  });
  check(checks, "database-has-canonical-summary-snapshot", Boolean(latestSnapshot), {
    latestSnapshotId: latestSnapshot?.snapshot_id ?? null,
    snapshots: rowNumber(counts, "ledger_snapshots"),
  });
  check(
    checks,
    "canonical-summary-snapshot-current",
    Boolean(latestSnapshot) &&
      currentSnapshotId === String(ledger.snapshotId ?? "") &&
      String(latestSnapshot?.payload?.snapshotId ?? "") === currentSnapshotId &&
      /^[0-9a-f]{64}$/u.test(
        String(latestSnapshot?.source_hashes?.canonicalSummary ?? ""),
      ) &&
      numberValue(latestSnapshot?.indexed_through_block) ===
        canonicalSummaryIndexedThroughBlock &&
      canonicalSummaryIndexedThroughBlock === ledgerIndexedThroughBlock &&
      CANONICAL_SUMMARY_KEYS.every(
        (key) =>
          String(latestSnapshot?.payload?.summaryPayloads?.[key]?.snapshotId ?? "") ===
          currentSnapshotId,
      ),
    {
      canonicalSummaryCoverage,
      canonicalSnapshotId: ledger.snapshotId ?? null,
      databaseSnapshotId: latestSnapshot?.snapshot_id ?? null,
      ledgerIndexedThroughBlock,
      snapshotIndexedThroughBlock:
        latestSnapshot?.indexed_through_block ?? null,
    },
  );
  check(
    checks,
    "transactions-cover-canonical-activity-txids",
    rowNumber(counts, "transactions_total") >= canonicalActivityTxidCount &&
      rowNumber(counts, "canonical_activity_txids_missing_transaction") === 0,
    {
      canonicalActivityItems: canonicalActivityItemCount,
      canonicalActivityTxids: canonicalActivityTxidCount,
      missingCanonicalActivityTxids: rowNumber(
        counts,
        "canonical_activity_txids_missing_transaction",
      ),
      confirmedTransactions: rowNumber(counts, "transactions_confirmed"),
      pendingTransactions: rowNumber(counts, "transactions_pending"),
      totalTransactions: rowNumber(counts, "transactions_total"),
    },
    "error",
  );
  check(
    checks,
    "confirmed-transaction-status-lag",
    rowNumber(counts, "confirmed_activity_events_without_confirmed_transaction") ===
      0,
    {
      canonicalConfirmedComputerActions: confirmedComputerActions,
      confirmedActivityEventsWithoutConfirmedTransaction: rowNumber(
        counts,
        "confirmed_activity_events_without_confirmed_transaction",
      ),
      confirmedTransactions: rowNumber(counts, "transactions_confirmed"),
      pendingTransactions: rowNumber(counts, "transactions_pending"),
    },
    "warning",
  );
  check(
    checks,
    "confirmed-transactions-have-canonical-block-proof",
    rowNumber(counts, "confirmed_transactions_without_canonical_block") === 0,
    {
      missing: rowNumber(
        counts,
        "confirmed_transactions_without_canonical_block",
      ),
    },
  );
  check(
    checks,
    "nonconfirmed-transactions-have-no-block-metadata",
    rowNumber(counts, "nonconfirmed_transactions_with_block_metadata") === 0,
    {
      mismatches: rowNumber(
        counts,
        "nonconfirmed_transactions_with_block_metadata",
      ),
    },
  );
  check(
    checks,
    "confirmed-events-match-canonical-parent-metadata",
    rowNumber(counts, "confirmed_events_without_parent_metadata") === 0,
    {
      mismatches: rowNumber(
        counts,
        "confirmed_events_without_parent_metadata",
      ),
    },
  );
  check(
    checks,
    "nonconfirmed-events-have-no-block-metadata",
    rowNumber(counts, "nonconfirmed_events_with_block_metadata") === 0,
    {
      mismatches: rowNumber(counts, "nonconfirmed_events_with_block_metadata"),
    },
  );
  check(
    checks,
    "canonical-confirmed-transactions-own-no-volatile-pwid-events",
    rowNumber(
      counts,
      "canonical_confirmed_transactions_with_volatile_pwid_events",
    ) === 0,
    {
      volatilePwidEvents: rowNumber(
        counts,
        "canonical_confirmed_transactions_with_volatile_pwid_events",
      ),
    },
  );
  check(
    checks,
    "event-payload-status-matches-relational-status",
    rowNumber(counts, "event_payload_status_mismatches") === 0,
    {
      mismatches: rowNumber(counts, "event_payload_status_mismatches"),
    },
  );
  check(
    checks,
    "events-cover-canonical-activity",
    rowNumber(counts, "events_confirmed_valid") ===
      expectedConfirmedActivityItems &&
      rowNumber(counts, "events_pending_valid") === expectedPendingActivityItems,
    {
      canonicalActivityItems: canonicalActivityItemCount,
      canonicalConfirmedActivityItems,
      canonicalPendingActivityItems,
      confirmedEvents: rowNumber(counts, "events_confirmed_valid"),
      expectedConfirmedActivityItems,
      expectedPendingActivityItems,
      pendingEvents: rowNumber(counts, "events_pending_valid"),
    },
  );
  check(
    checks,
    "credit-definitions-match-canonical",
    confirmedTokens === 0 ||
      rowNumber(counts, "credit_definitions_confirmed") === confirmedTokens,
    {
      canonicalConfirmedTokens: confirmedTokens,
      databaseConfirmedTokens: rowNumber(counts, "credit_definitions_confirmed"),
    },
  );
  check(
    checks,
    "event-search-index-populated",
    rowNumber(counts, "event_refs") > 0 && rowNumber(counts, "event_participants") > 0,
    {
      eventParticipants: rowNumber(counts, "event_participants"),
      eventRefs: rowNumber(counts, "event_refs"),
    },
  );
  check(
    checks,
    "rendered-event-participant-semantic-parity",
    eventRelationParity.model ===
        PROOF_INDEX_EVENT_RELATION_PARITY_MODEL &&
      eventRelationParity.eventCount > 0 &&
      eventRelationParity.participants.ready === true,
    {
      eventCount: eventRelationParity.eventCount,
      statusCounts: eventRelationParity.statusCounts,
      ...eventRelationParity.participants,
    },
  );
  check(
    checks,
    "rendered-event-reference-semantic-parity",
    eventRelationParity.model ===
        PROOF_INDEX_EVENT_RELATION_PARITY_MODEL &&
      eventRelationParity.eventCount > 0 &&
      eventRelationParity.refs.ready === true,
    {
      eventCount: eventRelationParity.eventCount,
      statusCounts: eventRelationParity.statusCounts,
      ...eventRelationParity.refs,
    },
  );
  check(
    checks,
    "rendered-mail-projection-semantic-parity",
    mailProjectionParity.model ===
        PROOF_INDEX_MAIL_PROJECTION_PARITY_MODEL &&
      mailProjectionParity.expectedCount > 0 &&
      mailProjectionParity.ready === true,
    mailProjectionParity,
  );
  const workDelistDbResult = await pool.query(
    `
      SELECT
        t.status AS transaction_status,
        e.kind,
        e.status AS event_status,
        COALESCE(
          array_agg(er.ref_value ORDER BY er.ref_type, er.ref_value)
            FILTER (WHERE er.ref_value IS NOT NULL),
          ARRAY[]::text[]
        ) AS refs
      FROM proof_indexer.transactions t
      LEFT JOIN proof_indexer.events e
        ON e.network = t.network
       AND e.txid = t.txid
      LEFT JOIN proof_indexer.event_refs er
        ON er.event_id = e.event_id
      WHERE t.network = $1
        AND t.txid = $2
      GROUP BY t.status, e.kind, e.status
    `,
    [NETWORK, WORK_DELIST_REGRESSION_TXID],
  );
  const workDelistRows = workDelistDbResult.rows ?? [];
  const workDelistConfirmedTx = workDelistRows.some(
    (row) => row.transaction_status === "confirmed",
  );
  const workDelistConfirmedEvent = workDelistRows.some(
    (row) =>
      row.event_status === "confirmed" &&
      (Array.isArray(row.refs) ? row.refs : []).includes(
        WORK_DELIST_REGRESSION_LISTING_TXID,
      ),
  );
  check(
    checks,
    "work-delist-regression-transaction-indexed",
    workDelistConfirmedTx,
    {
      rows: workDelistRows.map((row) => ({
        eventStatus: row.event_status ?? null,
        kind: row.kind ?? null,
        transactionStatus: row.transaction_status ?? null,
      })),
      txid: WORK_DELIST_REGRESSION_TXID,
    },
  );
  check(
    checks,
    "work-delist-regression-event-indexed",
    workDelistConfirmedEvent,
    {
      listingId: WORK_DELIST_REGRESSION_LISTING_TXID,
      refs: workDelistRows.flatMap((row) =>
        Array.isArray(row.refs) ? row.refs : [],
      ),
      txid: WORK_DELIST_REGRESSION_TXID,
    },
  );
  check(
    checks,
    "holder-projections-present",
    rowNumber(counts, "credit_balances") > 0,
    {
      creditBalances: rowNumber(counts, "credit_balances"),
    },
    STRICT ? "error" : "warning",
  );

  const logHistoryCases = [
    {
      compareFresh: false,
      expectIndexedRead: false,
      expectReason: "volatile-first-page-canonical",
      label: "first-page",
      params: { limit: 20 },
    },
    {
      compareFresh: true,
      expectIndexedRead: true,
      expectReason: "kind-filter",
      label: "kind-token-sale",
      params: { kind: "token-sale", limit: 10 },
    },
    {
      compareFresh: true,
      expectIndexedRead: true,
      expectReason: "query",
      label: "query-infinity-bond",
      params: { q: INFINITY_BOND_REGRESSION_TXID, limit: 10 },
    },
    {
      compareFresh: true,
      expectIndexedRead: true,
      expectReason: "query",
      label: "query-pagination-gap-infinity-bond",
      params: { q: PAGINATION_GAP_INFINITY_BOND_TXID, limit: 10 },
    },
    {
      compareFresh: true,
      expectIndexedRead: true,
      expectReason: "query",
      label: "query-work-transfer",
      params: { q: WORK_TRANSFER_REGRESSION_TXID, limit: 10 },
    },
    {
      compareFresh: true,
      expectIndexedRead: true,
      expectReason: "query",
      label: "query-work-delist",
      params: { q: WORK_DELIST_REGRESSION_TXID, limit: 10 },
    },
    {
      compareFresh: false,
      expectIndexedRead: true,
      expectReason: "snapshot-pinned-activity",
      label: "paginated-history",
      params: { cursor: 40, limit: 20 },
    },
  ];
  for (const logCase of logHistoryCases) {
    const searchParams = new URLSearchParams();
    for (const [key, value] of Object.entries(logCase.params)) {
      searchParams.set(key, String(value));
    }
    const eligibility = proofIndexLogHistoryReadEligibility(
      String(logCase.params.kind ?? ""),
      searchParams,
    );
    check(
      checks,
      `log-history-${logCase.label}-read-eligibility`,
      eligibility.eligible === logCase.expectIndexedRead,
      {
        eligible: eligibility.eligible,
        expected: logCase.expectIndexedRead,
        offset: eligibility.pagination.offset,
        query: eligibility.pagination.query,
        reason: eligibility.reason,
      },
    );
    check(
      checks,
      `log-history-${logCase.label}-read-reason`,
      eligibility.reason === logCase.expectReason,
      {
        expected: logCase.expectReason,
        reason: eligibility.reason,
      },
    );
    if (!eligibility.eligible) {
      continue;
    }

    const indexedLogPage = await proofIndexLogHistoryPayload(
      NETWORK,
      String(logCase.params.kind ?? ""),
      searchParams,
    );
    if (!logCase.compareFresh || !CHECK_FRESH_LOG_HISTORY) {
      check(
        checks,
        `log-history-${logCase.label}-snapshot-pinned`,
        Boolean(indexedLogPage?.snapshotId) &&
          String(indexedLogPage?.cursor ?? "").startsWith(
            `snapshot:${indexedLogPage?.snapshotId}:`,
          ) &&
          (!indexedLogPage?.nextCursor ||
            String(indexedLogPage.nextCursor).startsWith(
              `snapshot:${indexedLogPage.snapshotId}:`,
            )),
        {
          cursor: indexedLogPage?.cursor ?? null,
          nextCursor: indexedLogPage?.nextCursor ?? null,
          snapshotId: indexedLogPage?.snapshotId ?? null,
        },
      );
      continue;
    }

    const canonicalLogPage = await readJson(
      endpoint("/api/v1/log-history", { ...logCase.params, fresh: "1" }),
    );
    const logMismatches = compareProofIndexHistoryPayloads(
      canonicalLogPage,
      indexedLogPage,
    );
    check(
      checks,
      `log-history-${logCase.label}-parity`,
      logMismatches.length === 0,
      {
        mismatches: logMismatches.slice(0, 5),
      },
      "error",
    );
  }

  const firstSnapshotParams = new URLSearchParams({ cursor: "40", limit: "20" });
  const firstSnapshotPage = await proofIndexLogHistoryPayload(
    NETWORK,
    "",
    firstSnapshotParams,
  );
  const secondSnapshotParams = new URLSearchParams({
    cursor: String(firstSnapshotPage?.nextCursor ?? ""),
    limit: "20",
  });
  const secondSnapshotPage = await proofIndexLogHistoryPayload(
    NETWORK,
    "",
    secondSnapshotParams,
  );
  const firstKeys = new Set(
    (firstSnapshotPage?.items ?? []).map(
      (item) => `${item?.kind ?? ""}:${item?.txid ?? ""}:${item?.listingId ?? ""}`,
    ),
  );
  const overlappingKeys = (secondSnapshotPage?.items ?? [])
    .map((item) => `${item?.kind ?? ""}:${item?.txid ?? ""}:${item?.listingId ?? ""}`)
    .filter((key) => firstKeys.has(key));
  check(
    checks,
    "log-history-snapshot-cursor-stability",
    Boolean(firstSnapshotPage?.snapshotId) &&
      firstSnapshotPage?.snapshotId === secondSnapshotPage?.snapshotId &&
      Number(firstSnapshotPage?.end) === Number(secondSnapshotPage?.start) &&
      overlappingKeys.length === 0,
    {
      firstEnd: firstSnapshotPage?.end ?? null,
      firstNextCursor: firstSnapshotPage?.nextCursor ?? null,
      firstSnapshotId: firstSnapshotPage?.snapshotId ?? null,
      overlap: overlappingKeys.slice(0, 3),
      secondSnapshotId: secondSnapshotPage?.snapshotId ?? null,
      secondStart: secondSnapshotPage?.start ?? null,
    },
  );

  if (CHECK_ACTIVITY_SNAPSHOT) {
    const indexedActivityPayload = await proofIndexActivityPayload(NETWORK);
    const canonicalActivityComparisonPayload =
      canonicalActivityPayload ??
      (await readJson(endpoint("/api/v1/log", { fresh: "1" })));
    check(
      checks,
      "log-payload-snapshot-parity",
      Boolean(indexedActivityPayload?.snapshotId) &&
        indexedActivityPayload?.snapshotId ===
          canonicalActivityComparisonPayload?.snapshotId &&
        (indexedActivityPayload?.activity ?? []).length ===
          (canonicalActivityComparisonPayload?.activity ?? []).length,
      {
        canonicalActivityItems:
          canonicalActivityComparisonPayload?.activity?.length ?? null,
        canonicalSnapshotId:
          canonicalActivityComparisonPayload?.snapshotId ?? null,
        indexedActivityItems: indexedActivityPayload?.activity?.length ?? null,
        indexedSnapshotId: indexedActivityPayload?.snapshotId ?? null,
      },
      "error",
    );
  }

  const registryHistoryCases = [
    { label: "records", params: { kind: "records", limit: 10 } },
    { label: "listings", params: { kind: "listings", limit: 10 } },
    { label: "sales", params: { kind: "sales", limit: 10 } },
    { label: "activity", params: { kind: "activity", limit: 10 } },
  ];
  const [indexedRegistryPayload, canonicalRegistryPayload] = await Promise.all([
    proofIndexRegistryPayload(NETWORK),
    readJson(endpoint("/api/v1/internal/registry-parity"), {
      internalVerifier: true,
    }),
  ]);
  const canonicalRegistrySource = String(
    canonicalRegistryPayload?.source ?? "",
  ).trim();
  const canonicalRegistryFreshAuthority = Boolean(
    canonicalRegistryPayload?.network === NETWORK &&
      registryParityAuthorityIsComplete(canonicalRegistryPayload, NETWORK),
  );
  check(
    checks,
    "registry-canonical-fresh-authority",
    canonicalRegistryFreshAuthority,
    {
      indexedAt: canonicalRegistryPayload?.indexedAt ?? null,
      model:
        canonicalRegistryPayload?._powRegistryParityAuthority?.model ?? null,
      source: canonicalRegistrySource || null,
    },
    "error",
  );
  const registrySemanticParity = compareProofIndexRegistryPayloads(
    canonicalRegistryFreshAuthority ? canonicalRegistryPayload : null,
    indexedRegistryPayload,
  );
  const registryQueryId = String(
    canonicalRegistryPayload?.records?.[0]?.id ?? "",
  ).trim();
  if (registryQueryId) {
    registryHistoryCases.push({
      label: "records-search",
      params: { kind: "records", limit: 2, q: registryQueryId },
    });
  }
  if (arrayLength(canonicalRegistryPayload?.records) > 2) {
    registryHistoryCases.push({
      label: "records-page-2",
      params: { kind: "records", limit: 2, page: 1 },
    });
  }
  for (const registryCase of registryHistoryCases) {
    const searchParams = new URLSearchParams();
    for (const [key, value] of Object.entries(registryCase.params)) {
      searchParams.set(key, String(value));
    }
    const indexedRegistryPage = await proofIndexRegistryHistoryPayload(
      NETWORK,
      String(registryCase.params.kind ?? ""),
      searchParams,
    );
    const canonicalRegistryPage = registryParityHistoryPage(
      canonicalRegistryPayload,
      registryCase.params,
    );
    const registryMismatches = compareProofIndexHistoryPayloads(
      canonicalRegistryPage,
      indexedRegistryPage,
    );
    for (const field of [
      "cursor",
      "end",
      "hasMore",
      "indexedThroughBlock",
      "kind",
      "limit",
      "network",
      "nextCursor",
      "page",
      "pageCount",
      "pageSize",
      "query",
      "start",
      "totalCount",
    ]) {
      if (
        JSON.stringify(canonicalRegistryPage?.[field] ?? null) !==
        JSON.stringify(indexedRegistryPage?.[field] ?? null)
      ) {
        registryMismatches.push(
          `${field}:${JSON.stringify(canonicalRegistryPage?.[field] ?? null)}!=${JSON.stringify(indexedRegistryPage?.[field] ?? null)}`,
        );
      }
    }
    const pageKind = String(registryCase.params.kind ?? "records");
    const pagePayload = (page) => ({
      activity: [],
      listings: [],
      network: NETWORK,
      records: [],
      sales: [],
      [pageKind]: Array.isArray(page?.items) ? page.items : [],
    });
    const pageSemanticMismatches =
      compareProofIndexRegistryPayloads(
        pagePayload(canonicalRegistryPage),
        pagePayload(indexedRegistryPage),
      ).confirmed?.[pageKind] ?? ["missing-page-semantic-comparison"];
    registryMismatches.push(...pageSemanticMismatches);
    check(
      checks,
      `registry-history-${registryCase.label}-parity`,
      registryMismatches.length === 0,
      {
        mismatches: registryMismatches.slice(0, 5),
        snapshotId: indexedRegistryPage?.snapshotId ?? null,
      },
      "error",
    );
    check(
      checks,
      `registry-history-${registryCase.label}-current-relational`,
      pageUsesCurrentCursorContract(indexedRegistryPage, currentSnapshotId) &&
        !indexedRegistryPage?.snapshotId &&
        Number(indexedRegistryPage?.indexedThroughBlock) > 0 &&
        String(indexedRegistryPage?.source ?? "").startsWith(
          "proof-indexer-",
        ) &&
        arrayLength(indexedRegistryPage?.items) > 0,
      {
        cursor: indexedRegistryPage?.cursor ?? null,
        indexedThroughBlock:
          indexedRegistryPage?.indexedThroughBlock ?? null,
        items: arrayLength(indexedRegistryPage?.items),
        nextCursor: indexedRegistryPage?.nextCursor ?? null,
        snapshotId: indexedRegistryPage?.snapshotId ?? null,
        source: indexedRegistryPage?.source ?? null,
      },
    );
  }

  for (const [kind, mismatches] of Object.entries(
    registrySemanticParity.confirmed ?? {},
  )) {
    check(
      checks,
      `registry-confirmed-${kind}-semantic-parity`,
      Array.isArray(mismatches) && mismatches.length === 0,
      { mismatches: Array.isArray(mismatches) ? mismatches : ["missing"] },
      "error",
    );
  }

  const pendingRegistryMismatches = Object.entries(
    registrySemanticParity.pending ?? {},
  ).flatMap(([kind, mismatches]) =>
    (Array.isArray(mismatches) ? mismatches : []).map(
      (mismatch) => `${kind}:${mismatch}`,
    ),
  );
  check(
    checks,
    "registry-pending-visibility-parity",
    pendingRegistryMismatches.length === 0,
    {
      canonicalActivity: arrayLength(canonicalRegistryPayload?.activity),
      canonicalRecords: arrayLength(canonicalRegistryPayload?.records),
      indexedActivity: arrayLength(indexedRegistryPayload?.activity),
      indexedRecords: arrayLength(indexedRegistryPayload?.records),
      mismatches: pendingRegistryMismatches.slice(0, 8),
    },
    "error",
  );

  const registryEvidenceFaults = (
    Array.isArray(indexedRegistryPayload?.activity)
      ? indexedRegistryPayload.activity
      : []
  ).flatMap((item) => {
    if (item?.confirmed !== true) {
      return [];
    }
    const payload = String(item?.protocolPayload ?? "");
    const protocolDataBytes = Number(item?.protocolDataBytes);
    const dataBytes = Number(item?.dataBytes);
    const payments = Array.isArray(item?.auditPaymentOutputs)
      ? item.auditPaymentOutputs
      : [];
    const inputs = Array.isArray(item?.inputAddresses)
      ? item.inputAddresses
      : [];
    const outpoints = Array.isArray(item?.spentOutpoints)
      ? item.spentOutpoints
      : [];
    const rawWitness = item?.workAmoV5RawScriptWitness;
    const expectedRegistryFee = item?.kind === "id-register" ? 1_000 : 546;
    const witnessPayloadHex = String(rawWitness?.payloadHex ?? "")
      .trim()
      .toLowerCase();
    return payload.startsWith("pwid1:") &&
      String(item?.payload ?? "") === payload &&
      String(item?.rawPayload ?? "") === payload &&
      item?.valid === true &&
      item?.dropped === false &&
      String(item?.reasonCode ?? "") === "" &&
      Number(item?.amountSats) === expectedRegistryFee &&
      /^[0-9a-f]{64}$/u.test(String(item?.blockHash ?? "")) &&
      Number.isSafeInteger(Number(item?.blockHeight)) &&
      Number(item.blockHeight) > 0 &&
      Number.isSafeInteger(Number(item?.blockIndex)) &&
      Number(item.blockIndex) >= 0 &&
      Number.isSafeInteger(Number(item?.protocolVout)) &&
      Number(item.protocolVout) >= 0 &&
      Number(item?.recordOrdinal) === 0 &&
      Number.isSafeInteger(protocolDataBytes) &&
      protocolDataBytes === Buffer.byteLength(payload, "utf8") &&
      Number.isSafeInteger(dataBytes) &&
      dataBytes >= protocolDataBytes &&
      payments.length > 0 &&
      payments.every(
        (output) =>
          String(output?.address ?? "").trim() &&
          Number.isSafeInteger(Number(output?.amountSats)) &&
          Number(output.amountSats) > 0 &&
          Number.isSafeInteger(Number(output?.vout)) &&
          Number(output.vout) >= 0,
      ) &&
      inputs.length > 0 &&
      inputs.length === outpoints.length &&
      outpoints.every(
        (outpoint) =>
          /^[0-9a-f]{64}$/u.test(String(outpoint?.txid ?? "")) &&
          Number.isSafeInteger(Number(outpoint?.vout)) &&
          Number(outpoint.vout) >= 0,
      ) &&
      rawWitness?.decodeValid === true &&
      String(rawWitness?.decodeDetail ?? "") === "" &&
      String(rawWitness?.reasonCode ?? "") === "" &&
      /^[0-9a-f]+$/u.test(witnessPayloadHex) &&
      witnessPayloadHex === Buffer.from(payload, "utf8").toString("hex") &&
      /^[0-9a-f]+$/u.test(String(rawWitness?.scriptPubKeyHex ?? ""))
      ? []
      : [String(item?.txid ?? "unknown")];
  });
  check(
    checks,
    "registry-confirmed-raw-evidence-complete",
    registryEvidenceFaults.length === 0,
    { faults: registryEvidenceFaults.slice(0, 8) },
    "error",
  );

  check(
    checks,
    "registry-payload-current-relational",
    indexedRegistryPayload?.source ===
      "proof-indexer-current-id-events+proof-indexer-confirmed-id-records" &&
      Number(indexedRegistryPayload?.indexedThroughBlock) ===
        canonicalSummaryIndexedThroughBlock &&
      Boolean(indexedRegistryPayload?.snapshotId) &&
      arrayLength(indexedRegistryPayload?.records) > 0 &&
      arrayLength(indexedRegistryPayload?.activity) > 0 &&
      arrayLength(indexedRegistryPayload?.listings) > 0 &&
      Number.isFinite(Number(indexedRegistryPayload?.stats?.confirmed)) &&
      Number(indexedRegistryPayload?.stats?.confirmed) ===
        rowNumber(counts, "id_records"),
    {
      activity: arrayLength(indexedRegistryPayload?.activity),
      confirmed: indexedRegistryPayload?.stats?.confirmed ?? null,
      indexedThroughBlock:
        indexedRegistryPayload?.indexedThroughBlock ?? null,
      listings: arrayLength(indexedRegistryPayload?.listings),
      records: arrayLength(indexedRegistryPayload?.records),
      snapshotId: indexedRegistryPayload?.snapshotId ?? null,
      source: indexedRegistryPayload?.source ?? null,
    },
  );

  const summaryCases = [
    { key: "growthSummary", label: "growth-summary", path: "/api/v1/growth-summary" },
    {
      key: "inceptionSummary",
      label: "inception-summary",
      path: "/api/v1/inception-summary",
    },
    {
      key: "infinitySummary",
      label: "infinity-summary",
      path: "/api/v1/infinity-summary",
    },
    {
      key: "marketplaceSummary",
      label: "marketplace-summary",
      path: "/api/v1/marketplace-summary",
    },
    { key: "workFloor", label: "work-floor", path: "/api/v1/work-floor" },
    { key: "workSummary", label: "work-summary", path: "/api/v1/work-summary" },
  ];
  for (const summaryCase of summaryCases) {
    const [indexedSummary, canonicalSummary] = await Promise.all([
      proofIndexSnapshotPayload(NETWORK, summaryCase.key),
      readJson(endpoint(summaryCase.path, snapshotParityParams())),
    ]);
    const indexedValue = summaryValue(indexedSummary);
    const canonicalValue = summaryValue(canonicalSummary);
    check(
      checks,
      `${summaryCase.label}-snapshot-parity`,
      Boolean(indexedSummary?.snapshotId) &&
        indexedSummary?.snapshotId === canonicalSummary?.snapshotId &&
        (!canonicalValue || Math.abs(indexedValue - canonicalValue) < 0.0001),
      {
        canonicalSnapshotId: canonicalSummary?.snapshotId ?? null,
        canonicalValue,
        indexedSnapshotId: indexedSummary?.snapshotId ?? null,
        indexedValue,
      },
      STRICT ? "error" : "warning",
    );
  }

  const tokenReadEligibility = proofIndexTokenReadEligibility(
    "",
    new URLSearchParams(),
  );
  check(
    checks,
    "token-state-read-eligibility",
    tokenReadEligibility.eligible === true,
    {
      reason: tokenReadEligibility.reason,
      scope: tokenReadEligibility.scope,
    },
  );
  const indexedTokenState = await proofIndexTokenPayload(
    NETWORK,
    "",
    new URLSearchParams(),
  );
  check(
    checks,
    "token-state-current-relational",
    indexedTokenState?.source === "proof-indexer-token-state-tables" &&
      Number(indexedTokenState?.indexedThroughBlock) ===
        canonicalSummaryIndexedThroughBlock &&
      arrayLength(indexedTokenState?.tokens) > 0,
    {
      indexedThroughBlock: indexedTokenState?.indexedThroughBlock ?? null,
      listings: arrayLength(indexedTokenState?.listings),
      mints: arrayLength(indexedTokenState?.mints),
      snapshotId: indexedTokenState?.snapshotId ?? null,
      source: indexedTokenState?.source ?? null,
      transfers: arrayLength(indexedTokenState?.transfers),
      tokens: arrayLength(indexedTokenState?.tokens),
    },
  );
  check(
    checks,
    "marketplace-token-state-lifecycle-present",
    arrayLength(indexedTokenState?.listings) > 0 &&
      (arrayLength(indexedTokenState?.closedListings) > 0 ||
        arrayLength(indexedTokenState?.sales) > 0),
    {
      activeListings: arrayLength(indexedTokenState?.listings),
      closedListings: arrayLength(indexedTokenState?.closedListings),
      sales: arrayLength(indexedTokenState?.sales),
      sealedListings: (indexedTokenState?.listings ?? []).filter(
        (listing) =>
          listing?.sealTxid ||
          listing?.sealPending ||
          listing?.sealConfirmed,
      ).length,
    },
  );
  const indexedWorkTokenState = await proofIndexTokenPayload(
    NETWORK,
    WORK_TOKEN_ID,
    new URLSearchParams({ asset: WORK_TOKEN_ID }),
  );
  check(
    checks,
    "work-token-state-current-relational",
    indexedWorkTokenState?.source === "proof-indexer-token-state-tables" &&
      Number(indexedWorkTokenState?.indexedThroughBlock) ===
        canonicalSummaryIndexedThroughBlock &&
      arrayLength(indexedWorkTokenState?.tokens) > 0,
    {
      holders: arrayLength(indexedWorkTokenState?.holders),
      indexedThroughBlock:
        indexedWorkTokenState?.indexedThroughBlock ?? null,
      listings: arrayLength(indexedWorkTokenState?.listings),
      mints: arrayLength(indexedWorkTokenState?.mints),
      snapshotId: indexedWorkTokenState?.snapshotId ?? null,
      source: indexedWorkTokenState?.source ?? null,
      transfers: arrayLength(indexedWorkTokenState?.transfers),
      tokens: arrayLength(indexedWorkTokenState?.tokens),
    },
  );

  const eventHistoryCases = [
    { label: "mail-protocol", params: { limit: 5, protocol: "pwm1" } },
    { label: "credit-protocol", params: { limit: 5, protocol: "pwt1" } },
    { label: "id-protocol", params: { limit: 5, protocol: "pwid1" } },
    {
      label: "work-transfer-search",
      params: { limit: 5, q: WORK_TRANSFER_REGRESSION_TXID },
    },
    {
      label: "work-delist-search",
      params: { limit: 5, q: WORK_DELIST_REGRESSION_TXID },
    },
  ];
  for (const eventCase of eventHistoryCases) {
    const searchParams = new URLSearchParams();
    for (const [key, value] of Object.entries(eventCase.params)) {
      searchParams.set(key, String(value));
    }
    const indexedEvents = await proofIndexEventHistoryPayload(
      NETWORK,
      searchParams,
    );
    check(
      checks,
      `event-history-${eventCase.label}-db-page`,
      Boolean(indexedEvents?.snapshotId) && arrayLength(indexedEvents?.items) > 0,
      {
        count: arrayLength(indexedEvents?.items),
        snapshotId: indexedEvents?.snapshotId ?? null,
        totalCount: indexedEvents?.totalCount ?? null,
      },
    );
  }

  for (const mailCase of ADDRESS_MAIL_REGRESSION_CASES) {
    const indexedMail = await proofIndexAddressMailPayload(
      NETWORK,
      mailCase.address,
    );
    const inboxCount = (indexedMail?.inboxMessages ?? []).filter(
      (message) => message?.confirmed,
    ).length;
    const sentCount = (indexedMail?.sentMessages ?? []).filter(
      (message) => message?.status === "confirmed",
    ).length;
    const totalCount =
      arrayLength(indexedMail?.inboxMessages) +
      arrayLength(indexedMail?.sentMessages);
    check(
      checks,
      `address-mail-${mailCase.label}-db-page`,
      String(indexedMail?.source ?? "")
        .split("+")
        .includes("proof-indexer-mail") &&
        inboxCount >= numberValue(mailCase.minInbox) &&
        sentCount >= numberValue(mailCase.minSent) &&
        totalCount >= numberValue(mailCase.minTotal),
      {
        inbox: inboxCount,
        indexedEvents: indexedMail?.stats?.indexedEvents ?? null,
        sent: sentCount,
        source: indexedMail?.source ?? null,
        total: totalCount,
      },
    );
  }

  const tokenHistoryCases = [
    {
      expectedSources: ["proof-indexer-token-mint-events"],
      label: "all-mints",
      params: { kind: "mints", limit: 10 },
      tokenScope: "",
    },
    {
      expectedSources: ["proof-indexer-token-transfer-events"],
      label: "all-transfers",
      params: { kind: "transfers", limit: 10 },
      tokenScope: "",
    },
    {
      expectedSources: ["proof-indexer-token-transfer-events"],
      label: "work-transfer-query",
      params: {
        asset: WORK_TOKEN_ID,
        kind: "transfers",
        limit: 10,
        q: WORK_TRANSFER_REGRESSION_TXID,
      },
      tokenScope: WORK_TOKEN_ID,
    },
    {
      allowEmpty: true,
      expectedSources: ["proof-indexer-token-invalid-events"],
      label: "all-invalid-events",
      params: { kind: "invalid-events", limit: 10 },
      tokenScope: "",
    },
    {
      expectedSources: ["proof-indexer-credit-balances"],
      label: "work-holders",
      params: { asset: WORK_TOKEN_ID, kind: "holders", limit: 10 },
      tokenScope: WORK_TOKEN_ID,
    },
    {
      expectedSources: ["proof-indexer-token-events"],
      label: "work-market-log",
      params: { asset: WORK_TOKEN_ID, kind: "market-log", limit: 10 },
      tokenScope: WORK_TOKEN_ID,
    },
    {
      expectedSources: ["proof-indexer-token-events"],
      label: "work-delist-closed-query",
      requiresScanCoverage: false,
      expectedNeedle: WORK_DELIST_REGRESSION_TXID,
      params: {
        asset: WORK_TOKEN_ID,
        kind: "closed-listings",
        limit: 10,
        q: WORK_DELIST_REGRESSION_TXID,
      },
      tokenScope: WORK_TOKEN_ID,
    },
  ];
  for (const tokenCase of tokenHistoryCases) {
    const searchParams = new URLSearchParams();
    for (const [key, value] of Object.entries(tokenCase.params)) {
      searchParams.set(key, String(value));
    }
    const eligibility = proofIndexTokenHistoryReadEligibility(
      tokenCase.tokenScope,
      String(tokenCase.params.kind ?? ""),
      searchParams,
    );
    check(
      checks,
      `token-history-${tokenCase.label}-read-eligibility`,
      eligibility.eligible === true,
      {
        eligible: eligibility.eligible,
        kind: eligibility.kind,
        offset: eligibility.pagination.offset,
        query: eligibility.pagination.query,
        reason: eligibility.reason,
        scope: eligibility.scope,
      },
    );
    if (!eligibility.eligible) {
      continue;
    }

    const indexedTokenPage = await proofIndexTokenHistoryPayload(
      NETWORK,
      tokenCase.tokenScope,
      String(tokenCase.params.kind ?? ""),
      searchParams,
    );
    if (tokenCase.expectedNeedle) {
      const expectedNeedle = String(tokenCase.expectedNeedle).toLowerCase();
      check(
        checks,
        `token-history-${tokenCase.label}-contains-expected-event`,
        (indexedTokenPage?.items ?? []).some((item) =>
          JSON.stringify(item).toLowerCase().includes(expectedNeedle),
        ),
        {
          count: arrayLength(indexedTokenPage?.items),
          expectedNeedle,
          snapshotId: indexedTokenPage?.snapshotId ?? null,
        },
      );
    }
    if (CHECK_FRESH_TOKEN_HISTORY) {
      const canonicalTokenPage = await readJson(
        endpoint("/api/v1/token-history", { ...tokenCase.params, fresh: "1" }),
      );
      const tokenMismatches = compareProofIndexHistoryPayloads(
        canonicalTokenPage,
        indexedTokenPage,
      );
      check(
        checks,
        `token-history-${tokenCase.label}-parity`,
        tokenMismatches.length === 0,
        {
          mismatches: tokenMismatches.slice(0, 5),
          snapshotId: indexedTokenPage?.snapshotId ?? null,
        },
        STRICT ? "error" : "warning",
      );
    }
    check(
      checks,
      `token-history-${tokenCase.label}-current-relational`,
      (tokenCase.requiresScanCoverage === false
        ? pageUsesCurrentCursorContract(indexedTokenPage, currentSnapshotId)
        : tokenHistoryPageHasExactCoverage(
            indexedTokenPage,
            currentSnapshotId,
          )) &&
        tokenCase.expectedSources.includes(
          String(indexedTokenPage?.source ?? ""),
        ) &&
        Number(indexedTokenPage?.indexedThroughBlock) > 0 &&
        (tokenCase.allowEmpty === true ||
          arrayLength(indexedTokenPage?.items) > 0),
      {
        cursor: indexedTokenPage?.cursor ?? null,
        hasMore: indexedTokenPage?.hasMore ?? null,
        indexedThroughBlock: indexedTokenPage?.indexedThroughBlock ?? null,
        indexedThroughBlockHash:
          indexedTokenPage?.indexedThroughBlockHash ?? null,
        items: arrayLength(indexedTokenPage?.items),
        nextCursor: indexedTokenPage?.nextCursor ?? null,
        snapshotId: indexedTokenPage?.snapshotId ?? null,
        source: indexedTokenPage?.source ?? null,
      },
    );
  }

  const nonWorkHolderTokenResult = await pool.query(
    `
      SELECT cb.token_id
      FROM proof_indexer.credit_balances cb
      WHERE cb.network = $1
        AND cb.token_id <> $2
        AND cb.confirmed_balance > 0
      GROUP BY cb.token_id
      ORDER BY count(*) DESC, cb.token_id
      LIMIT 1
    `,
    [NETWORK, WORK_TOKEN_ID],
  );
  const nonWorkHolderTokenId = nonWorkHolderTokenResult.rows[0]?.token_id ?? "";
  if (nonWorkHolderTokenId) {
    const searchParams = new URLSearchParams({
      asset: nonWorkHolderTokenId,
      kind: "holders",
      limit: "10",
    });
    const indexedScopedHolders = await proofIndexTokenHistoryPayload(
      NETWORK,
      nonWorkHolderTokenId,
      "holders",
      searchParams,
    );
    if (CHECK_FRESH_TOKEN_HISTORY) {
      const canonicalScopedHolders = await readJson(
        endpoint("/api/v1/token-history", {
          asset: nonWorkHolderTokenId,
          fresh: "1",
          kind: "holders",
          limit: 10,
        }),
      );
      const holderMismatches = compareProofIndexHistoryPayloads(
        canonicalScopedHolders,
        indexedScopedHolders,
      );
      check(
        checks,
        "token-history-non-work-holders-parity",
        holderMismatches.length === 0,
        {
          mismatches: holderMismatches.slice(0, 5),
          snapshotId: indexedScopedHolders?.snapshotId ?? null,
          tokenId: nonWorkHolderTokenId,
        },
        STRICT ? "error" : "warning",
      );
    }
    check(
      checks,
      "token-history-non-work-holders-current-relational",
      tokenHistoryPageHasExactCoverage(
        indexedScopedHolders,
        currentSnapshotId,
      ) &&
        indexedScopedHolders?.source === "proof-indexer-credit-balances" &&
        Number(indexedScopedHolders?.indexedThroughBlock) > 0 &&
        arrayLength(indexedScopedHolders?.items) > 0,
      {
        indexedThroughBlock:
          indexedScopedHolders?.indexedThroughBlock ?? null,
        indexedThroughBlockHash:
          indexedScopedHolders?.indexedThroughBlockHash ?? null,
        hasMore: indexedScopedHolders?.hasMore ?? null,
        items: indexedScopedHolders?.items?.length ?? null,
        snapshotId: indexedScopedHolders?.snapshotId ?? null,
        source: indexedScopedHolders?.source ?? null,
        tokenId: nonWorkHolderTokenId,
      },
    );
  }

  const sampleTxids = await proofIndexRecentTransactionIds(NETWORK, {
    limit: 10,
    status: "confirmed",
  });
  let txStatusMismatches = 0;
  for (const txid of sampleTxids) {
    const [canonicalStatus, indexedStatus] = await Promise.all([
      readJson(endpoint(`/api/v1/tx/${txid}/status`)),
      proofIndexTxStatusPayload(txid, NETWORK, { includeUnconfirmed: true }),
    ]);
    if (
      canonicalStatus?.status !== indexedStatus?.status ||
      Boolean(canonicalStatus?.confirmed) !== Boolean(indexedStatus?.confirmed)
    ) {
      txStatusMismatches += 1;
    }
  }
  check(
    checks,
    "tx-status-confirmed-sample-parity",
    txStatusMismatches === 0,
    {
      checked: sampleTxids.length,
      mismatches: txStatusMismatches,
    },
  );

  const failed = checks.filter((item) => item.severity === "error" && !item.ok);
  const output = {
    apiBase: API_BASE,
    checks,
    database: Object.fromEntries(
      Object.entries(counts).map(([key, value]) => [key, rowNumber(counts, key)]),
    ),
    indexedThroughBlock: latestSnapshot?.indexed_through_block ?? null,
    latestSnapshotGeneratedAt: latestSnapshot?.generated_at ?? null,
    network: NETWORK,
    ok: failed.length === 0,
    requireWorkAmoV5Ready: REQUIRE_WORK_AMO_V5_READY,
    snapshotId: ledger.snapshotId ?? null,
    strict: STRICT,
    workAmoV5: {
      declaration: workAmoDeclaration,
      quoteHead: workAmoQuoteHead,
      readiness: workAmoReadiness,
    },
  };

  console.log(JSON.stringify(output, null, 2));

  if (failed.length > 0) {
    process.exitCode = 1;
  }
} finally {
  await closeProofIndexReadPool();
  await pool.end();
}
