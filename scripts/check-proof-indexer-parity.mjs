import { createProofIndexPool } from "../server/db/postgres.mjs";
import {
  closeProofIndexReadPool,
  compareProofIndexHistoryPayloads,
  proofIndexLogHistoryPayload,
  proofIndexRecentTransactionIds,
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
const DRY_RUN = process.argv.includes("--dry-run");

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

  const canonicalLogPage = await readJson(endpoint("/api/v1/log-history", { limit: 20 }));
  const indexedLogPage = await proofIndexLogHistoryPayload(
    NETWORK,
    "",
    new URLSearchParams("limit=20"),
  );
  const logMismatches = compareProofIndexHistoryPayloads(
    canonicalLogPage,
    indexedLogPage,
  );
  check(
    checks,
    "log-history-first-page-parity",
    logMismatches.length === 0,
    {
      mismatches: logMismatches.slice(0, 5),
    },
    STRICT ? "error" : "warning",
  );

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
