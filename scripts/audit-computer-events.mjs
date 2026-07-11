#!/usr/bin/env node

import { createProofIndexPool } from "../server/db/postgres.mjs";

const DEFAULT_API_BASE = "https://computer.proofofwork.me";
const API_BASE = String(process.env.POW_API_BASE ?? DEFAULT_API_BASE).replace(
  /\/+$/u,
  "",
);
const NETWORK = process.env.NETWORK ?? "livenet";
const REQUEST_TIMEOUT_MS = Number(
  process.env.COMPUTER_AUDIT_REQUEST_TIMEOUT_MS ?? 90_000,
);
const MAX_TIP_LAG_BLOCKS = Number(process.env.MAX_LEDGER_TIP_LAG_BLOCKS ?? 6);
const RECENT_METADATA_HOURS = Number(
  process.env.COMPUTER_AUDIT_RECENT_METADATA_HOURS ?? 72,
);
const FRESH_HISTORY_READS = /^(?:1|true|yes)$/iu.test(
  String(process.env.COMPUTER_AUDIT_FRESH_HISTORY ?? ""),
);

const WORK_TOKEN_ID =
  "d4e5ebf11d104d6a63fb74e42094364b25a5f7199a09e5c0e71408972466a8b8";
const POWB_TOKEN_ID =
  "a3d0bc8528f91dfc52400a885bed7e49235396aa82aa9f95db41be629f1d5562";

const REPORTED_TX_CASES = [
  {
    kind: "sales",
    label: "reported WORK buy 8429",
    tokenId: WORK_TOKEN_ID,
    txid: "8429e3984c8dcedbb982ccbcbfe3a314f3dcc8cbfd63fe81d4e45a3483187491",
  },
  {
    expectedEventKind: "token-event-invalid",
    expectedProtocol: "pwt1",
    expectedValid: false,
    kind: "invalid-events",
    label: "reported WORK buy 5dcd",
    tokenId: WORK_TOKEN_ID,
    txid: "5dcdd8d4181e6166d90912c54ccb47047c69441099194a5cd102dacb57efe8cf",
  },
  {
    kind: "sales",
    label: "reported WORK buy d946",
    tokenId: WORK_TOKEN_ID,
    txid: "d946eea2face8675fbaf463dffef28d75df52d451c4694a3e6bc11298e43cd85",
  },
  {
    expectedEventKind: "token-event-invalid",
    expectedProtocol: "pwt1",
    expectedValid: false,
    kind: "invalid-events",
    label: "reported WORK buy 4e59",
    tokenId: WORK_TOKEN_ID,
    txid: "4e599fd0064642b864e8b9c7152b16b50a49fcea8c108f042d8df9294a2fb93d",
  },
  {
    kind: "sales",
    label: "reported WORK buy 2e57",
    tokenId: WORK_TOKEN_ID,
    txid: "2e577dd95c75b326cafc3c281c8e7330bf62097b779b9ac873302bb4be744a13",
  },
  {
    expectedEventKind: "token-event-invalid",
    expectedProtocol: "pwt1",
    expectedValid: false,
    kind: "invalid-events",
    label: "Carbonz reported WORK buy",
    tokenId: WORK_TOKEN_ID,
    txid: "7ddf760aaae819aab74a4cc5523016350e11b5888c4950acd97a7660533ba47b",
  },
  {
    kind: "transfers",
    label: "Carbonz delayed WORK transfer",
    tokenId: WORK_TOKEN_ID,
    txid: "c90f95cdd45892f76af89686dea7c1c35ec070148e5a74c947f174e244ef44db",
  },
  {
    kind: "transfers",
    label: "Carbonz POWB transfer",
    tokenId: POWB_TOKEN_ID,
    txid: "18c7dba7ebe06727e2f37bf0d4885a2aadbf42aff56743936e8e076e2c691100",
  },
  {
    kind: "listings",
    label: "Gullish POWB listing",
    tokenId: POWB_TOKEN_ID,
    txid: "dcac1665798675b7817a973fa990283bc9de2c77cc374361e8cb956a5f2daa46",
  },
  {
    kind: "closed-listings",
    label: "spent seal listing closure",
    tokenId: WORK_TOKEN_ID,
    txid: "df5740ebf1260f04906479ec1f23a1fd64d112f368be4a056a0a4b55cff838a1",
  },
];

const extraTxids = String(process.env.COMPUTER_AUDIT_TXIDS ?? "")
  .split(",")
  .map((txid) => txid.trim().toLowerCase())
  .filter((txid) => /^[0-9a-f]{64}$/u.test(txid))
  .map((txid) => ({ label: `extra ${txid.slice(0, 8)}`, txid }));

const failures = [];
const warnings = [];

function endpoint(pathname, params = {}) {
  const url = new URL(pathname, `${API_BASE}/`);
  url.searchParams.set("network", NETWORK);
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null && value !== "") {
      url.searchParams.set(key, String(value));
    }
  }
  return url;
}

async function readJson(pathname, params = {}) {
  const url = endpoint(pathname, params);
  const startedAt = Date.now();
  const response = await fetch(url, {
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  const elapsedMs = Date.now() - startedAt;
  if (!response.ok) {
    throw new Error(`${url} returned HTTP ${response.status}`);
  }
  return { elapsedMs, json: await response.json(), url: String(url) };
}

function check(name, ok, details = {}, severity = "error") {
  const entry = { details, name, ok: Boolean(ok), severity };
  if (!entry.ok && severity === "warning") {
    warnings.push(entry);
  } else if (!entry.ok) {
    failures.push(entry);
  }
  return entry;
}

function numberValue(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}

function numbersAgree(left, right, tolerance = 0.000001) {
  return Math.abs(numberValue(left) - numberValue(right)) <= tolerance;
}

function positiveInteger(value) {
  const number = Number(value);
  return Number.isSafeInteger(number) && number > 0;
}

function rowNumber(row, key) {
  return numberValue(row?.[key]);
}

function array(value) {
  return Array.isArray(value) ? value : [];
}

function itemTxids(items) {
  return new Set(
    array(items)
      .flatMap((item) => [
        item?.txid,
        item?.listingId,
        item?.closedTxid,
        item?.sale?.txid,
        item?.listing?.listingId,
        item?.closedListing?.closedTxid,
      ])
      .map((value) => String(value ?? "").trim().toLowerCase())
      .filter((value) => /^[0-9a-f]{64}$/u.test(value)),
  );
}

function directItemsForTxid(items, txid) {
  const normalizedTxid = String(txid ?? "").trim().toLowerCase();
  return array(items).filter(
    (item) => String(item?.txid ?? "").trim().toLowerCase() === normalizedTxid,
  );
}

function itemMatchesExpectedEvent(item, txCase) {
  const expectedValid = txCase.expectedValid !== false;
  const status = String(item?.status ?? "").trim().toLowerCase();
  const confirmed = item?.confirmed === true || status === "confirmed";
  const protocol = String(item?.protocol ?? "").trim().toLowerCase();
  const kind = String(item?.kind ?? "").trim().toLowerCase();
  return (
    confirmed &&
    (expectedValid ? item?.valid !== false : item?.valid === false) &&
    (!txCase.expectedProtocol || protocol === txCase.expectedProtocol) &&
    (!txCase.expectedEventKind || kind === txCase.expectedEventKind)
  );
}

function ledgerCheckNames(ledger) {
  return new Set(array(ledger?.checks).map((item) => item?.name));
}

async function queryOne(pool, sql, params = []) {
  const result = await pool.query(sql, params);
  return result.rows[0] ?? {};
}

const pool = createProofIndexPool({
  env: {
    ...process.env,
    POW_INDEX_DB_APP_NAME:
      process.env.POW_INDEX_DB_APP_NAME ?? "computer-event-audit",
  },
});

try {
  const [
    healthRead,
    ledgerRead,
    workFloorRead,
    growthRead,
    marketplaceRead,
    infinityRead,
  ] = await Promise.all([
    readJson("/health"),
    readJson("/api/v1/ledger-consistency"),
    readJson("/api/v1/work-floor"),
    readJson("/api/v1/growth-summary"),
    readJson("/api/v1/marketplace-summary"),
    readJson("/api/v1/infinity-summary"),
  ]);

  const health = healthRead.json;
  const ledger = ledgerRead.json;
  const workFloor = workFloorRead.json;
  const growth = growthRead.json;
  const marketplace = marketplaceRead.json;
  const infinity = infinityRead.json;

  const db = await queryOne(
    pool,
    `
      SELECT
        (SELECT count(*) FROM proof_indexer.transactions WHERE network = $1) AS transactions_total,
        (SELECT count(*) FROM proof_indexer.transactions WHERE network = $1 AND status = 'confirmed') AS transactions_confirmed,
        (SELECT count(*) FROM proof_indexer.transactions WHERE network = $1 AND status = 'pending') AS transactions_pending,
        (SELECT count(*) FROM proof_indexer.transactions WHERE network = $1 AND status = 'dropped') AS transactions_dropped,
        (SELECT count(*) FROM proof_indexer.transactions WHERE network = $1 AND status = 'confirmed' AND raw_tx IS NULL) AS confirmed_transactions_missing_raw,
        (SELECT count(*) FROM proof_indexer.transactions WHERE network = $1 AND status = 'confirmed' AND block_height IS NULL) AS confirmed_transactions_missing_block,
        (SELECT count(*) FROM proof_indexer.transactions WHERE network = $1 AND status = 'confirmed' AND block_height IS NULL AND confirmed_at >= now() - make_interval(hours => $2::int)) AS recent_confirmed_transactions_missing_block,
        (SELECT count(*) FROM proof_indexer.events WHERE network = $1) AS events_total,
        (SELECT count(*) FROM proof_indexer.events WHERE network = $1 AND status = 'confirmed' AND valid IS DISTINCT FROM false) AS events_confirmed_valid,
        (SELECT count(*) FROM proof_indexer.events WHERE network = $1 AND status = 'confirmed' AND protocol = 'pwt1' AND kind = 'token-event-invalid' AND valid = false) AS events_confirmed_pwt_invalid_audit,
        (SELECT count(*) FROM proof_indexer.events WHERE network = $1 AND status = 'confirmed' AND (valid IS DISTINCT FROM false OR (protocol = 'pwt1' AND kind = 'token-event-invalid' AND valid = false))) AS events_confirmed_canonical_activity,
        (SELECT count(*) FROM proof_indexer.events e LEFT JOIN proof_indexer.transactions t ON t.network = e.network AND t.txid = e.txid WHERE e.network = $1 AND e.status = 'confirmed' AND (e.valid IS DISTINCT FROM false OR (e.protocol = 'pwt1' AND e.kind = 'token-event-invalid' AND e.valid = false)) AND t.txid IS NULL) AS confirmed_events_missing_transaction,
        (SELECT count(*) FROM proof_indexer.events e LEFT JOIN proof_indexer.transactions t ON t.network = e.network AND t.txid = e.txid WHERE e.network = $1 AND e.status = 'confirmed' AND (e.valid IS DISTINCT FROM false OR (e.protocol = 'pwt1' AND e.kind = 'token-event-invalid' AND e.valid = false)) AND COALESCE(t.status, '') <> 'confirmed') AS confirmed_events_without_confirmed_transaction,
        (SELECT count(*) FROM proof_indexer.events e JOIN proof_indexer.transactions t ON t.network = e.network AND t.txid = e.txid WHERE e.network = $1 AND e.status = 'confirmed' AND (e.valid IS DISTINCT FROM false OR (e.protocol = 'pwt1' AND e.kind = 'token-event-invalid' AND e.valid = false)) AND t.raw_tx IS NULL) AS confirmed_events_missing_raw_transaction,
        (SELECT count(*) FROM proof_indexer.event_refs er JOIN proof_indexer.events e ON e.event_id = er.event_id WHERE e.network = $1) AS event_refs,
        (SELECT count(*) FROM proof_indexer.event_participants ep JOIN proof_indexer.events e ON e.event_id = ep.event_id WHERE e.network = $1) AS event_participants,
        (SELECT count(*) FROM proof_indexer.credit_definitions WHERE network = $1 AND confirmed = true) AS credit_definitions_confirmed,
        (SELECT count(*) FROM proof_indexer.credit_balances WHERE network = $1) AS credit_balances,
        (SELECT count(*) FROM proof_indexer.credit_listings WHERE network = $1) AS credit_listings,
        (SELECT count(*) FROM proof_indexer.id_records WHERE network = $1) AS id_records,
        (SELECT count(*) FROM proof_indexer.mail_items WHERE network = $1 AND status = 'confirmed') AS confirmed_mail_items,
        (SELECT count(*) FROM proof_indexer.op_returns WHERE network = $1) AS op_returns,
        (SELECT snapshot_id FROM proof_indexer.ledger_snapshots WHERE network = $1 ORDER BY indexed_through_block DESC NULLS LAST, generated_at DESC LIMIT 1) AS latest_snapshot_id,
        (SELECT indexed_through_block FROM proof_indexer.ledger_snapshots WHERE network = $1 ORDER BY indexed_through_block DESC NULLS LAST, generated_at DESC LIMIT 1) AS latest_snapshot_block,
        (SELECT generated_at FROM proof_indexer.ledger_snapshots WHERE network = $1 ORDER BY indexed_through_block DESC NULLS LAST, generated_at DESC LIMIT 1) AS latest_snapshot_generated_at
    `,
    [NETWORK, RECENT_METADATA_HOURS],
  );

  const eventKindResult = await pool.query(
    `
      SELECT
        protocol,
        kind,
        status,
        valid,
        count(*)::int AS count,
        COALESCE(sum(amount_sats), 0)::text AS amount_sats,
        min(block_height)::int AS min_block_height,
        max(block_height)::int AS max_block_height
      FROM proof_indexer.events
      WHERE network = $1
      GROUP BY protocol, kind, status, valid
      ORDER BY protocol, kind, status, valid
    `,
    [NETWORK],
  );

  const sourceGapResult = await pool.query(
    `
      SELECT
        COALESCE(source, 'unknown') AS source,
        count(*)::int AS count,
        min(confirmed_at) AS first_confirmed_at,
        max(confirmed_at) AS last_confirmed_at
      FROM proof_indexer.transactions
      WHERE network = $1
        AND status = 'confirmed'
        AND block_height IS NULL
      GROUP BY COALESCE(source, 'unknown')
      ORDER BY count(*) DESC, source
    `,
    [NETWORK],
  );

  const ledgerChecks = ledgerCheckNames(ledger);
  const tipLagBlocks = numberValue(ledger?.metrics?.tipLagBlocks);
  const indexedThroughBlock = numberValue(ledger?.metrics?.indexedThroughBlock);
  const sourceTipHeight = numberValue(
    ledger?.metrics?.sourceTipHeight ?? health?.tipHeight,
  );
  const canonicalConfirmedActivity = numberValue(
    ledger?.sourceHashes?.activity?.confirmed,
  );

  const checks = [
    check("api-health-ok", health?.ok === true && positiveInteger(health?.tipHeight), {
      service: health?.service ?? null,
      tipHeight: health?.tipHeight ?? null,
    }),
    check("ledger-green", ledger?.ok === true && ledger?.status === "green", {
      snapshotId: ledger?.snapshotId ?? null,
      status: ledger?.status ?? null,
    }),
    check(
      "ledger-covers-node-tip",
      positiveInteger(indexedThroughBlock) &&
        positiveInteger(sourceTipHeight) &&
        sourceTipHeight >= indexedThroughBlock &&
        tipLagBlocks <= MAX_TIP_LAG_BLOCKS,
      {
        indexedThroughBlock,
        maxTipLagBlocks: MAX_TIP_LAG_BLOCKS,
        sourceTipHeight,
        tipLagBlocks,
      },
    ),
    check("ledger-has-no-missing-log-events", array(ledger?.missingLogEvents).length === 0, {
      missing: array(ledger?.missingLogEvents).length,
    }),
    check(
      "ledger-has-required-log-coverage-checks",
      ledgerChecks.has("token-events-logged") &&
        ledgerChecks.has("token-sales-logged") &&
        ledgerChecks.has("seeded-mail-events-logged") &&
        ledgerChecks.has("seeded-infinity-bonds-logged"),
      { checks: [...ledgerChecks].sort() },
    ),
    check(
      "db-confirmed-transactions-cover-ledger-actions",
      rowNumber(db, "transactions_confirmed") >=
        numberValue(ledger?.metrics?.confirmedComputerActions),
      {
        confirmedComputerActions: ledger?.metrics?.confirmedComputerActions ?? null,
        transactionsConfirmed: rowNumber(db, "transactions_confirmed"),
      },
    ),
    check(
      "db-events-cover-ledger-confirmed-activity",
      rowNumber(db, "events_confirmed_canonical_activity") >=
        canonicalConfirmedActivity,
      {
        canonicalConfirmedActivity,
        eventsConfirmedCanonicalActivity: rowNumber(
          db,
          "events_confirmed_canonical_activity",
        ),
        eventsConfirmedPwtInvalidAudit: rowNumber(
          db,
          "events_confirmed_pwt_invalid_audit",
        ),
        eventsConfirmedValid: rowNumber(db, "events_confirmed_valid"),
      },
    ),
    check("all-confirmed-events-have-transaction-row", rowNumber(db, "confirmed_events_missing_transaction") === 0, {
      missing: rowNumber(db, "confirmed_events_missing_transaction"),
    }),
    check(
      "all-confirmed-events-join-confirmed-transaction",
      rowNumber(db, "confirmed_events_without_confirmed_transaction") === 0,
      {
        mismatched: rowNumber(db, "confirmed_events_without_confirmed_transaction"),
      },
    ),
    check("all-confirmed-events-have-raw-transaction-or-payload", rowNumber(db, "confirmed_events_missing_raw_transaction") === 0, {
      missing: rowNumber(db, "confirmed_events_missing_raw_transaction"),
    }),
    check("event-search-index-populated", rowNumber(db, "event_refs") > 0 && rowNumber(db, "event_participants") > 0, {
      eventParticipants: rowNumber(db, "event_participants"),
      eventRefs: rowNumber(db, "event_refs"),
    }),
    check(
      "recent-confirmed-transactions-have-block-metadata",
      rowNumber(db, "recent_confirmed_transactions_missing_block") === 0,
      {
        hours: RECENT_METADATA_HOURS,
        missing: rowNumber(db, "recent_confirmed_transactions_missing_block"),
      },
    ),
    check(
      "all-confirmed-transactions-have-block-metadata",
      rowNumber(db, "confirmed_transactions_missing_block") === 0,
      {
        missing: rowNumber(db, "confirmed_transactions_missing_block"),
        sourceGaps: sourceGapResult.rows,
      },
      "warning",
    ),
    check(
      "op-return-table-populated",
      rowNumber(db, "op_returns") > 0,
      {
        opReturns: rowNumber(db, "op_returns"),
      },
      "warning",
    ),
    check(
      "work-growth-network-value-match",
      numbersAgree(workFloor?.networkValueSats, growth?.actualValue?.totalSats, 0.01) &&
        numbersAgree(workFloor?.networkValueSats, growth?.workFloor?.networkValueSats, 0.01),
      {
        growthActualValueSats: growth?.actualValue?.totalSats ?? null,
        growthWorkFloorSats: growth?.workFloor?.networkValueSats ?? null,
        workNetworkValueSats: workFloor?.networkValueSats ?? null,
      },
    ),
    check(
      "marketplace-work-network-value-match",
      numbersAgree(workFloor?.networkValueSats, marketplace?.workFloor?.networkValueSats, 0.01),
      {
        marketplaceWorkNetworkValueSats:
          marketplace?.workFloor?.networkValueSats ?? null,
        workNetworkValueSats: workFloor?.networkValueSats ?? null,
      },
    ),
    check(
      "infinity-nonzero",
      numberValue(infinity?.stats?.confirmedBondActions) > 0 &&
        numberValue(infinity?.actualValue?.networkValueSats) > 0,
      {
        confirmedBondActions: infinity?.stats?.confirmedBondActions ?? null,
        networkValueSats: infinity?.actualValue?.networkValueSats ?? null,
      },
    ),
  ];

  const txCases = [...REPORTED_TX_CASES, ...extraTxids];
  const txids = txCases.map((item) => item.txid.toLowerCase());
  const txCoverageResult = txids.length
    ? await pool.query(
        `
          SELECT
            t.txid,
            t.status,
            t.block_height,
            t.source,
            t.raw_tx IS NOT NULL AS has_raw_tx,
            COALESCE(
              jsonb_agg(
                DISTINCT jsonb_build_object(
                  'kind', e.kind,
                  'protocol', e.protocol,
                  'status', e.status,
                  'valid', e.valid
                )
              ) FILTER (WHERE e.event_id IS NOT NULL),
              '[]'::jsonb
            ) AS events
          FROM unnest($2::text[]) AS needle(txid)
          LEFT JOIN proof_indexer.transactions t
            ON t.network = $1
           AND t.txid = needle.txid
          LEFT JOIN proof_indexer.events e
            ON e.network = t.network
           AND e.txid = t.txid
          GROUP BY t.txid, t.status, t.block_height, t.source, t.raw_tx
        `,
        [NETWORK, txids],
      )
    : { rows: [] };
  const coverageByTxid = new Map(
    txCoverageResult.rows.map((row) => [String(row.txid ?? "").toLowerCase(), row]),
  );

  const txReports = [];
  for (const txCase of txCases) {
    const row = coverageByTxid.get(txCase.txid.toLowerCase()) ?? null;
    const logRead = await readJson("/api/v1/log-history", {
      limit: 10,
      q: txCase.txid,
    });
    const logItems = array(logRead.json?.items);
    const logHasTx = itemTxids(logItems).has(txCase.txid.toLowerCase());
    const logDirectItems = directItemsForTxid(logItems, txCase.txid);
    const logHasExpectedEvent =
      txCase.expectedValid === false
        ? logDirectItems.some((item) => itemMatchesExpectedEvent(item, txCase))
        : logHasTx;
    let historyHasTx = true;
    let historyHasExpectedEvent = true;
    let historyElapsedMs = null;
    let historyTotalCount = null;
    if (txCase.tokenId && txCase.kind) {
      const historyRead = await readJson("/api/v1/token-history", {
        // A rejected attempt may not resolve to a canonical credit, so its
        // durable audit row is discoverable from global invalid history.
        ...(txCase.expectedValid === false
          ? {}
          : { asset: txCase.tokenId }),
        ...(FRESH_HISTORY_READS ? { fresh: 1 } : {}),
        kind: txCase.kind,
        limit: 20,
        q: txCase.txid,
      });
      historyElapsedMs = historyRead.elapsedMs;
      historyTotalCount = historyRead.json?.totalCount ?? null;
      historyHasTx = itemTxids(historyRead.json?.items).has(
        txCase.txid.toLowerCase(),
      );
      if (txCase.expectedValid === false) {
        historyHasExpectedEvent = directItemsForTxid(
          historyRead.json?.items,
          txCase.txid,
        ).some((item) => itemMatchesExpectedEvent(item, txCase));
      }
    }
    const events = array(row?.events);
    const hasExpectedConfirmedEvent = events.some((event) =>
      itemMatchesExpectedEvent(event, txCase),
    );
    const hasConflictingConfirmedValidEvent =
      txCase.expectedValid === false &&
      events.some(
        (event) =>
          event?.status === "confirmed" && event?.valid !== false,
      );
    const txReport = {
      blockHeight: row?.block_height ?? null,
      dbEvents: events,
      dbSource: row?.source ?? null,
      dbStatus: row?.status ?? null,
      hasRawTx: row?.has_raw_tx ?? false,
      historyElapsedMs,
      historyHasExpectedEvent,
      historyHasTx,
      historyTotalCount,
      label: txCase.label,
      logElapsedMs: logRead.elapsedMs,
      logHasExpectedEvent,
      logHasTx,
      expectedEventKind: txCase.expectedEventKind ?? null,
      expectedProtocol: txCase.expectedProtocol ?? null,
      expectedValid: txCase.expectedValid !== false,
      txid: txCase.txid,
    };
    txReports.push(txReport);
    checks.push(
      check(
        `reported-tx-db-${txCase.label}`,
        row?.status === "confirmed" &&
          row?.has_raw_tx === true &&
          hasExpectedConfirmedEvent &&
          !hasConflictingConfirmedValidEvent,
        txReport,
      ),
      check(`reported-tx-log-${txCase.label}`, logHasExpectedEvent, txReport),
      check(
        `reported-tx-history-${txCase.label}`,
        historyHasTx && historyHasExpectedEvent,
        txReport,
      ),
    );
  }

  const endpointTimings = {
    health: healthRead.elapsedMs,
    infinitySummary: infinityRead.elapsedMs,
    ledgerConsistency: ledgerRead.elapsedMs,
    marketplaceSummary: marketplaceRead.elapsedMs,
    workFloor: workFloorRead.elapsedMs,
    growthSummary: growthRead.elapsedMs,
  };

  const output = {
    apiBase: API_BASE,
    checks,
    database: Object.fromEntries(
      Object.entries(db).map(([key, value]) => [
        key,
        typeof value === "bigint" ? Number(value) : value,
      ]),
    ),
    endpointTimings,
    eventKinds: eventKindResult.rows,
    failures,
    freshHistoryReads: FRESH_HISTORY_READS,
    ledger: {
      generatedAt: ledger?.generatedAt ?? null,
      indexedThroughBlock,
      missingLogEvents: array(ledger?.missingLogEvents).length,
      networkValueSats: ledger?.metrics?.networkValueSats ?? null,
      snapshotId: ledger?.snapshotId ?? null,
      sourceTipHeight,
      status: ledger?.status ?? null,
      tipLagBlocks,
    },
    network: NETWORK,
    ok: failures.length === 0,
    reportedTxs: txReports,
    warnings,
  };

  console.log(JSON.stringify(output, null, 2));
  if (failures.length > 0) {
    process.exitCode = 1;
  }
} finally {
  await pool.end();
}
