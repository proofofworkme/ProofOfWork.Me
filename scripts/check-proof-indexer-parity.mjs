import { createProofIndexPool } from "../server/db/postgres.mjs";
import {
  closeProofIndexReadPool,
  compareProofIndexHistoryPayloads,
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
} from "../server/db/proof-index-reader.mjs";

const DEFAULT_API_BASE = "http://127.0.0.1:8081";
const API_BASE = String(process.env.POW_API_BASE ?? DEFAULT_API_BASE).replace(
  /\/+$/u,
  "",
);
const NETWORK = process.env.NETWORK ?? "livenet";
const REQUEST_TIMEOUT_MS = Number(process.env.POW_INDEX_FETCH_TIMEOUT_MS ?? 60_000);
const REQUEST_RETRIES = Number(process.env.POW_INDEX_FETCH_RETRIES ?? 4);
const STRICT = /^(?:1|true|yes)$/iu.test(
  String(process.env.POW_INDEX_PARITY_STRICT ?? ""),
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
const CANONICAL_SUMMARY_KEYS = [
  "growthSummary",
  "infinitySummary",
  "marketplaceSummary",
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

async function readJson(url) {
  let lastError = null;
  const retries = Number.isFinite(REQUEST_RETRIES)
    ? Math.max(0, Math.floor(REQUEST_RETRIES))
    : 0;

  for (let attempt = 0; attempt <= retries; attempt += 1) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    try {
      const response = await fetch(url, { signal: controller.signal });
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
        : key === "workFloor" || key === "infinitySummary"
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
  const countsResult = await pool.query(
    `
      SELECT
        (SELECT count(*) FROM proof_indexer.transactions WHERE network = $1) AS transactions_total,
        (SELECT count(*) FROM proof_indexer.transactions WHERE network = $1 AND status = 'confirmed') AS transactions_confirmed,
        (SELECT count(*) FROM proof_indexer.transactions WHERE network = $1 AND status = 'pending') AS transactions_pending,
        (SELECT count(*) FROM proof_indexer.transactions WHERE network = $1 AND status = 'dropped') AS transactions_dropped,
        (SELECT count(*) FROM proof_indexer.events WHERE network = $1) AS events_total,
        (SELECT count(*) FROM proof_indexer.events WHERE network = $1 AND status = 'confirmed') AS events_confirmed,
        (SELECT count(*) FROM proof_indexer.events WHERE network = $1 AND status = 'pending') AS events_pending,
        (SELECT count(*) FROM proof_indexer.events WHERE network = $1 AND status = 'dropped') AS events_dropped,
        (SELECT count(*) FROM proof_indexer.event_refs er JOIN proof_indexer.events e ON e.event_id = er.event_id WHERE e.network = $1) AS event_refs,
        (SELECT count(*) FROM proof_indexer.event_participants ep JOIN proof_indexer.events e ON e.event_id = ep.event_id WHERE e.network = $1) AS event_participants,
        (SELECT count(*) FROM proof_indexer.credit_definitions WHERE network = $1 AND confirmed = true) AS credit_definitions_confirmed,
        (SELECT count(*) FROM proof_indexer.credit_balances WHERE network = $1) AS credit_balances,
        (SELECT count(*) FROM proof_indexer.credit_listings WHERE network = $1) AS credit_listings,
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
        AND payload ? 'snapshotId'
        AND payload->>'snapshotId' = snapshot_id
        AND COALESCE(consistency->>'ok', payload->>'ok', 'false') = 'true'
        AND COALESCE(consistency->>'status', payload->>'status', '') <>
          'summary-snapshot-fallback'
        AND payload->'summaryRefresh'->>'mode' = 'canonical-summary-refresh'
        AND source_hashes ? 'canonicalSummary'
        AND jsonb_typeof(payload->'summaryPayloads') = 'object'
        AND jsonb_typeof(payload->'summaryPayloads'->'growthSummary') = 'object'
        AND jsonb_typeof(payload->'summaryPayloads'->'infinitySummary') = 'object'
        AND jsonb_typeof(payload->'summaryPayloads'->'marketplaceSummary') = 'object'
        AND jsonb_typeof(payload->'summaryPayloads'->'workFloor') = 'object'
        AND jsonb_typeof(payload->'summaryPayloads'->'workSummary') = 'object'
        AND EXISTS (
          SELECT 1
          FROM jsonb_array_elements(COALESCE(consistency->'checks', '[]'::jsonb)) AS check_item
          WHERE check_item->>'name' = 'token-components-cover-confirmed-activity'
            AND COALESCE(check_item->>'ok', 'false') = 'true'
        )
      ORDER BY indexed_through_block DESC NULLS LAST, generated_at DESC
      LIMIT 1
    `,
    [NETWORK],
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
  try {
    canonicalActivityPayload = await readJson(endpoint("/api/v1/log", { fresh: "1" }));
  } catch (error) {
    console.error(
      JSON.stringify({
        error: error?.message ?? String(error),
        phase: "canonical-activity-coverage",
      }),
    );
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
  const confirmedActivityCoverageCount =
    canonicalConfirmedActivityItems || metricActivityItems;
  const canonicalActivityTxids = uniqueActivityTxids(canonicalActivityRows);
  const canonicalActivityTxidCount =
    canonicalActivityTxids.size || metricActivityItems;
  const checks = [];

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
    rowNumber(counts, "transactions_total") >= canonicalActivityTxidCount,
    {
      canonicalActivityItems: canonicalActivityItemCount,
      canonicalActivityTxids: canonicalActivityTxidCount,
      confirmedTransactions: rowNumber(counts, "transactions_confirmed"),
      pendingTransactions: rowNumber(counts, "transactions_pending"),
      totalTransactions: rowNumber(counts, "transactions_total"),
    },
    STRICT ? "error" : "warning",
  );
  check(
    checks,
    "confirmed-transaction-status-lag",
    rowNumber(counts, "transactions_confirmed") >= confirmedComputerActions,
    {
      canonicalConfirmedComputerActions: confirmedComputerActions,
      confirmedTransactions: rowNumber(counts, "transactions_confirmed"),
      pendingTransactions: rowNumber(counts, "transactions_pending"),
    },
    "warning",
  );
  check(
    checks,
    "events-cover-canonical-activity",
    rowNumber(counts, "events_confirmed") >= confirmedActivityCoverageCount,
    {
      canonicalActivityItems: canonicalActivityItemCount,
      canonicalConfirmedActivityItems,
      canonicalPendingActivityItems,
      confirmedEvents: rowNumber(counts, "events_confirmed"),
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
      STRICT ? "error" : "warning",
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
    const canonicalActivityPayload = await readJson(
      endpoint("/api/v1/log", { fresh: "1" }),
    );
    check(
      checks,
      "log-payload-snapshot-parity",
      Boolean(indexedActivityPayload?.snapshotId) &&
        indexedActivityPayload?.snapshotId === canonicalActivityPayload?.snapshotId &&
        (indexedActivityPayload?.activity ?? []).length ===
          (canonicalActivityPayload?.activity ?? []).length,
      {
        canonicalActivityItems: canonicalActivityPayload?.activity?.length ?? null,
        canonicalSnapshotId: canonicalActivityPayload?.snapshotId ?? null,
        indexedActivityItems: indexedActivityPayload?.activity?.length ?? null,
        indexedSnapshotId: indexedActivityPayload?.snapshotId ?? null,
      },
      STRICT ? "error" : "warning",
    );
  }

  const registryHistoryCases = [
    { label: "records", params: { kind: "records", limit: 10 } },
    { label: "listings", params: { kind: "listings", limit: 10 } },
    { label: "sales", params: { kind: "sales", limit: 10 } },
    { label: "activity", params: { kind: "activity", limit: 10 } },
  ];
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
    const canonicalRegistryPage = await readJson(
      endpoint(
        "/api/v1/registry-history",
        snapshotParityParams(registryCase.params),
      ),
    );
    const registryMismatches = compareProofIndexHistoryPayloads(
      canonicalRegistryPage,
      indexedRegistryPage,
    );
    check(
      checks,
      `registry-history-${registryCase.label}-parity`,
      registryMismatches.length === 0,
      {
        mismatches: registryMismatches.slice(0, 5),
        snapshotId: indexedRegistryPage?.snapshotId ?? null,
      },
      STRICT ? "error" : "warning",
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

  const indexedRegistryPayload = await proofIndexRegistryPayload(NETWORK);
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
      pageUsesCurrentCursorContract(indexedTokenPage, currentSnapshotId) &&
        tokenCase.expectedSources.includes(
          String(indexedTokenPage?.source ?? ""),
        ) &&
        Number(indexedTokenPage?.indexedThroughBlock) > 0 &&
        arrayLength(indexedTokenPage?.items) > 0,
      {
        cursor: indexedTokenPage?.cursor ?? null,
        indexedThroughBlock: indexedTokenPage?.indexedThroughBlock ?? null,
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
    } else {
      check(
        checks,
        "token-history-non-work-holders-current-relational",
        pageUsesCurrentCursorContract(
          indexedScopedHolders,
          currentSnapshotId,
        ) &&
          indexedScopedHolders?.source === "proof-indexer-credit-balances" &&
          Number(indexedScopedHolders?.indexedThroughBlock) > 0 &&
          arrayLength(indexedScopedHolders?.items) > 0,
        {
          indexedThroughBlock:
            indexedScopedHolders?.indexedThroughBlock ?? null,
          items: indexedScopedHolders?.items?.length ?? null,
          snapshotId: indexedScopedHolders?.snapshotId ?? null,
          source: indexedScopedHolders?.source ?? null,
          tokenId: nonWorkHolderTokenId,
        },
      );
    }
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
    snapshotId: ledger.snapshotId ?? null,
    strict: STRICT,
  };

  console.log(JSON.stringify(output, null, 2));

  if (failed.length > 0) {
    process.exitCode = 1;
  }
} finally {
  await closeProofIndexReadPool();
  await pool.end();
}
