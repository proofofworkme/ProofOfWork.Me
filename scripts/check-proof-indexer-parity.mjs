import { createProofIndexPool } from "../server/db/postgres.mjs";
import {
  closeProofIndexReadPool,
  compareProofIndexHistoryPayloads,
  proofIndexActivityPayload,
  proofIndexEventHistoryPayload,
  proofIndexLogHistoryReadEligibility,
  proofIndexLogHistoryPayload,
  proofIndexRecentTransactionIds,
  proofIndexRegistryHistoryPayload,
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
const WORK_TOKEN_ID =
  "d4e5ebf11d104d6a63fb74e42094364b25a5f7199a09e5c0e71408972466a8b8";

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
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(url, { signal: controller.signal });
    if (!response.ok) {
      throw new Error(`${url.pathname} returned HTTP ${response.status}`);
    }
    return await response.json();
  } finally {
    clearTimeout(timeout);
  }
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
      SELECT snapshot_id, generated_at, indexed_through_block
      FROM proof_indexer.ledger_snapshots
      WHERE network = $1
      ORDER BY generated_at DESC
      LIMIT 1
    `,
    [NETWORK],
  );

  const counts = countsResult.rows[0] ?? {};
  const latestSnapshot = latestSnapshotResult.rows[0] ?? null;
  const metrics = ledger.metrics ?? {};
  const missingLogEvents = Array.isArray(ledger.missingLogEvents)
    ? ledger.missingLogEvents
    : [];
  const activityItems = numberValue(metrics.activityItems);
  const confirmedTokens = numberValue(metrics.confirmedTokens);
  const checks = [];

  check(checks, "canonical-ledger-green", ledger.ok === true && ledger.status === "green", {
    ok: ledger.ok,
    status: ledger.status,
  });
  check(checks, "canonical-log-complete", missingLogEvents.length === 0, {
    missing: missingLogEvents.length,
  });
  check(checks, "database-has-ledger-snapshot", Boolean(latestSnapshot), {
    latestSnapshotId: latestSnapshot?.snapshot_id ?? null,
    snapshots: rowNumber(counts, "ledger_snapshots"),
  });
  check(
    checks,
    "database-snapshot-matches-canonical",
    latestSnapshot?.snapshot_id === ledger.snapshotId,
    {
      canonicalSnapshotId: ledger.snapshotId ?? null,
      databaseSnapshotId: latestSnapshot?.snapshot_id ?? null,
    },
    STRICT ? "error" : "warning",
  );
  check(
    checks,
    "transactions-cover-canonical-activity",
    rowNumber(counts, "transactions_total") >= activityItems,
    {
      canonicalActivityItems: activityItems,
      confirmedTransactions: rowNumber(counts, "transactions_confirmed"),
      pendingTransactions: rowNumber(counts, "transactions_pending"),
      totalTransactions: rowNumber(counts, "transactions_total"),
    },
  );
  check(
    checks,
    "confirmed-transaction-status-lag",
    rowNumber(counts, "transactions_confirmed") >= activityItems,
    {
      canonicalActivityItems: activityItems,
      confirmedTransactions: rowNumber(counts, "transactions_confirmed"),
      pendingTransactions: rowNumber(counts, "transactions_pending"),
    },
    "warning",
  );
  check(
    checks,
    "events-cover-canonical-activity",
    rowNumber(counts, "events_confirmed") >= activityItems,
    {
      canonicalActivityItems: activityItems,
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
      `registry-history-${registryCase.label}-snapshot-pinned`,
      Boolean(indexedRegistryPage?.snapshotId) &&
        String(indexedRegistryPage?.cursor ?? "").startsWith(
          `snapshot:${indexedRegistryPage?.snapshotId}:`,
        ) &&
        (!indexedRegistryPage?.nextCursor ||
          String(indexedRegistryPage.nextCursor).startsWith(
            `snapshot:${indexedRegistryPage.snapshotId}:`,
          )),
      {
        cursor: indexedRegistryPage?.cursor ?? null,
        nextCursor: indexedRegistryPage?.nextCursor ?? null,
        snapshotId: indexedRegistryPage?.snapshotId ?? null,
      },
    );
  }

  const summaryCases = [
    { key: "growthSummary", label: "growth-summary", path: "/api/v1/growth-summary" },
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
    "token-state-snapshot-present",
    Boolean(indexedTokenState?.snapshotId) &&
      arrayLength(indexedTokenState?.tokens) > 0,
    {
      listings: arrayLength(indexedTokenState?.listings),
      snapshotId: indexedTokenState?.snapshotId ?? null,
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
    "work-token-state-snapshot-present",
    Boolean(indexedWorkTokenState?.snapshotId) &&
      arrayLength(indexedWorkTokenState?.tokens) > 0,
    {
      holders: arrayLength(indexedWorkTokenState?.holders),
      listings: arrayLength(indexedWorkTokenState?.listings),
      snapshotId: indexedWorkTokenState?.snapshotId ?? null,
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

  const tokenHistoryCases = [
    {
      label: "all-mints",
      params: { kind: "mints", limit: 10 },
      tokenScope: "",
    },
    {
      label: "all-transfers",
      params: { kind: "transfers", limit: 10 },
      tokenScope: "",
    },
    {
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
      label: "work-holders",
      params: { asset: WORK_TOKEN_ID, kind: "holders", limit: 10 },
      tokenScope: WORK_TOKEN_ID,
    },
    {
      label: "work-market-log",
      params: { asset: WORK_TOKEN_ID, kind: "market-log", limit: 10 },
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
      `token-history-${tokenCase.label}-snapshot-pinned`,
      Boolean(indexedTokenPage?.snapshotId) &&
        String(indexedTokenPage?.cursor ?? "").startsWith(
          `snapshot:${indexedTokenPage?.snapshotId}:`,
        ) &&
        (!indexedTokenPage?.nextCursor ||
          String(indexedTokenPage.nextCursor).startsWith(
            `snapshot:${indexedTokenPage.snapshotId}:`,
          )),
      {
        cursor: indexedTokenPage?.cursor ?? null,
        nextCursor: indexedTokenPage?.nextCursor ?? null,
        snapshotId: indexedTokenPage?.snapshotId ?? null,
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
        "token-history-non-work-holders-db-page",
        Boolean(indexedScopedHolders?.snapshotId) &&
          (indexedScopedHolders?.items ?? []).length > 0,
        {
          items: indexedScopedHolders?.items?.length ?? null,
          snapshotId: indexedScopedHolders?.snapshotId ?? null,
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
