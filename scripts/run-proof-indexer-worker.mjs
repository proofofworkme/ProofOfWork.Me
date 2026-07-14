import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { createProofIndexPool } from "../server/db/postgres.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");

const DEFAULT_API_BASE = "http://127.0.0.1:8081";
const API_BASE = String(process.env.POW_API_BASE ?? DEFAULT_API_BASE).replace(
  /\/+$/u,
  "",
);
const NETWORK = process.env.NETWORK ?? "livenet";
const INTERVAL_MS = Number(process.env.POW_INDEX_WORKER_INTERVAL_MS ?? 300_000);
const ERROR_INTERVAL_MS = Number(
  process.env.POW_INDEX_WORKER_ERROR_INTERVAL_MS ?? 60_000,
);
const BACKFILL_MAX_PAGES = Number(
  process.env.POW_INDEX_WORKER_BACKFILL_MAX_PAGES ??
    process.env.POW_INDEX_BACKFILL_MAX_PAGES ??
    20,
);
const BACKFILL_LIMIT = Number(
  process.env.POW_INDEX_WORKER_BACKFILL_LIMIT ??
    process.env.POW_INDEX_BACKFILL_LIMIT ??
    200,
);
const DEFAULT_WORKER_BACKFILL_SOURCES = "block-scan,mempool-scan";
const BACKFILL_SOURCES = String(
  process.env.POW_INDEX_WORKER_BACKFILL_SOURCES ??
    DEFAULT_WORKER_BACKFILL_SOURCES,
).trim();
const BACKFILL_SOURCE_FRESH = String(
  process.env.POW_INDEX_WORKER_BACKFILL_SOURCE_FRESH ??
    process.env.POW_INDEX_BACKFILL_SOURCE_FRESH ??
    "0",
).trim();
const BACKFILL_SNAPSHOT_FRESH = String(
  process.env.POW_INDEX_WORKER_BACKFILL_SNAPSHOT_FRESH ??
    process.env.POW_INDEX_BACKFILL_SNAPSHOT_FRESH ??
    "",
).trim();
const BACKFILL_TOKEN_SNAPSHOT_FRESH = String(
  process.env.POW_INDEX_WORKER_BACKFILL_TOKEN_SNAPSHOT_FRESH ??
    process.env.POW_INDEX_BACKFILL_TOKEN_SNAPSHOT_FRESH ??
    "0",
).trim();
const BACKFILL_SUMMARY_SNAPSHOT_FRESH = String(
  process.env.POW_INDEX_WORKER_BACKFILL_SUMMARY_SNAPSHOT_FRESH ??
    process.env.POW_INDEX_BACKFILL_SUMMARY_SNAPSHOT_FRESH ??
    "0",
).trim();
const BACKFILL_STORE_LEDGER_SNAPSHOT = String(
  process.env.POW_INDEX_WORKER_BACKFILL_STORE_LEDGER_SNAPSHOT ??
    process.env.POW_INDEX_BACKFILL_STORE_LEDGER_SNAPSHOT ??
    "0",
).trim();
const BACKFILL_STORE_CANONICAL_SUMMARY_SNAPSHOT = String(
  process.env.POW_INDEX_WORKER_BACKFILL_STORE_CANONICAL_SUMMARY_SNAPSHOT ??
    process.env.POW_INDEX_BACKFILL_STORE_CANONICAL_SUMMARY_SNAPSHOT ??
    "1",
).trim();
const PENDING_STATUS_LIMIT = Number(process.env.POW_INDEX_PENDING_STATUS_LIMIT ?? 100);
const PENDING_MIN_AGE_MS = Number(process.env.POW_INDEX_PENDING_MIN_AGE_MS ?? 300_000);
const PENDING_DROP_CONFIRMATION_MS = Math.max(
  0,
  Number(
    process.env.POW_INDEX_PENDING_DROP_CONFIRMATION_MS ?? 5 * 60_000,
  ) || 0,
);
const REQUEST_TIMEOUT_MS = Number(process.env.POW_INDEX_FETCH_TIMEOUT_MS ?? 60_000);
const STATUS_REQUEST_TIMEOUT_MS = Number(
  Math.min(
    5_000,
    Math.max(
      1_000,
      Number(process.env.POW_INDEX_STATUS_FETCH_TIMEOUT_MS ?? 5_000) || 5_000,
    ),
  ),
);
const PENDING_STATUS_BUDGET_MS = Number(
  Math.min(
    15_000,
    Math.max(
      STATUS_REQUEST_TIMEOUT_MS,
      Number(process.env.POW_INDEX_PENDING_STATUS_BUDGET_MS ?? 15_000) ||
        15_000,
    ),
  ),
);
const PENDING_STATUS_CONCURRENCY = Math.min(
  5,
  Math.max(
    1,
    Math.floor(
      Number(process.env.POW_INDEX_PENDING_STATUS_CONCURRENCY ?? 5) || 5,
    ),
  ),
);
const BACKFILL_CHILD_TIMEOUT_MS = Math.min(
  15 * 60_000,
  Math.max(
    30_000,
    Number(process.env.POW_INDEX_WORKER_BACKFILL_TIMEOUT_MS ?? 4 * 60_000) ||
      4 * 60_000,
  ),
);
const BACKFILL_RETRIES = Math.min(
  5,
  Math.max(
    0,
    Math.floor(Number(process.env.POW_INDEX_WORKER_BACKFILL_RETRIES ?? 2) || 0),
  ),
);
const BACKFILL_RETRY_DELAY_MS = Math.min(
  30_000,
  Math.max(
    250,
    Number(process.env.POW_INDEX_WORKER_BACKFILL_RETRY_DELAY_MS ?? 1_000) ||
      1_000,
  ),
);
const PARITY_CHILD_TIMEOUT_MS = Math.min(
  5 * 60_000,
  Math.max(
    30_000,
    Number(process.env.POW_INDEX_WORKER_PARITY_TIMEOUT_MS ?? 2 * 60_000) ||
      2 * 60_000,
  ),
);
const RUN_PARITY = !/^(?:0|false|no)$/iu.test(
  String(process.env.POW_INDEX_WORKER_PARITY ?? "1"),
);
const PARITY_INTERVAL_MS = Number(
  process.env.POW_INDEX_WORKER_PARITY_INTERVAL_MS ?? 15 * 60_000,
);
const INCLUDE_HOLDERS = /^(?:1|true|yes)$/iu.test(
  String(process.env.POW_INDEX_WORKER_HOLDERS ?? ""),
);
const MAX_CONSECUTIVE_FAILURES = Math.max(
  1,
  Math.trunc(
    Number(process.env.POW_INDEX_WORKER_MAX_CONSECUTIVE_FAILURES ?? 3) || 3,
  ),
);
const DRY_RUN = process.argv.includes("--dry-run");
const ONCE = process.argv.includes("--once");

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

async function readJson(url, timeoutMs = REQUEST_TIMEOUT_MS) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
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

function runScript(
  scriptName,
  args = [],
  envOverrides = {},
  { timeoutMs = BACKFILL_CHILD_TIMEOUT_MS } = {},
) {
  return new Promise((resolve, reject) => {
    let timedOut = false;
    let forceKillTimer;
    const child = spawn(
      process.execPath,
      [path.join(repoRoot, "scripts", scriptName), ...args],
      {
        cwd: repoRoot,
        env: { ...process.env, ...envOverrides },
        stdio: "inherit",
      },
    );
    const timeout = setTimeout(() => {
      timedOut = true;
      child.kill("SIGTERM");
      forceKillTimer = setTimeout(() => child.kill("SIGKILL"), 5_000);
      forceKillTimer.unref?.();
    }, Math.max(1, Number(timeoutMs) || BACKFILL_CHILD_TIMEOUT_MS));
    timeout.unref?.();
    child.on("error", (error) => {
      clearTimeout(timeout);
      clearTimeout(forceKillTimer);
      reject(error);
    });
    child.on("exit", (code, signal) => {
      clearTimeout(timeout);
      clearTimeout(forceKillTimer);
      if (timedOut) {
        reject(
          new Error(
            `${scriptName} exceeded its ${timeoutMs}ms wall-clock budget`,
          ),
        );
        return;
      }
      if (code === 0) {
        resolve();
        return;
      }
      reject(
        new Error(
          `${scriptName} exited with ${signal ? `signal ${signal}` : `code ${code}`}`,
        ),
      );
    });
  });
}

async function runBackfillWithRetries(backfillEnv) {
  let lastError;
  for (let attempt = 0; attempt <= BACKFILL_RETRIES; attempt += 1) {
    try {
      await runScript("backfill-proof-indexer.mjs", [], backfillEnv, {
        timeoutMs: BACKFILL_CHILD_TIMEOUT_MS,
      });
      return;
    } catch (error) {
      lastError = error;
      if (attempt >= BACKFILL_RETRIES) {
        break;
      }
      const delayMs = Math.min(
        30_000,
        BACKFILL_RETRY_DELAY_MS * 2 ** attempt,
      );
      console.error(
        JSON.stringify({
          attempt: attempt + 1,
          delayMs,
          error: error?.message ?? String(error),
          phase: "worker-backfill-retry",
          retrying: true,
        }),
      );
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }
  throw lastError;
}

async function writeWorkerMeta(pool, value) {
  await pool.query(
    `
      INSERT INTO proof_indexer.meta (key, value, updated_at)
      VALUES ('worker:lastRun', $1::jsonb, now())
      ON CONFLICT (key)
      DO UPDATE SET value = EXCLUDED.value, updated_at = now()
    `,
    [JSON.stringify(value)],
  );
}

async function readWorkerMeta(pool) {
  const result = await pool.query(
    `
      SELECT value
      FROM proof_indexer.meta
      WHERE key = 'worker:lastRun'
      LIMIT 1
    `,
  );
  const value = result.rows[0]?.value;
  return value && typeof value === "object" ? value : null;
}

function lastSuccessFromMeta(value) {
  if (value?.lastSuccess && typeof value.lastSuccess === "object") {
    return value.lastSuccess;
  }
  if (value?.ok === true && value?.finishedAt) {
    return {
      durationMs: value.durationMs,
      finishedAt: value.finishedAt,
      pendingStatus: value.pendingStatus,
      startedAt: value.startedAt,
    };
  }
  return null;
}

let lastParityAtMs = 0;

async function updateTransactionStatus(client, txid, status, payload) {
  const normalizedTxid = String(txid ?? "").trim().toLowerCase();
  const normalizedStatus = String(status ?? "").trim().toLowerCase();
  const observedAtMs = Date.parse(payload?.observedAt ?? "");
  const sourceList = Array.isArray(payload?.sources)
    ? payload.sources.map((source) => String(source))
    : [];
  const coreObserved = sourceList.some((source) =>
    source.startsWith("bitcoin-core:"),
  );
  if (
    !/^[0-9a-f]{64}$/u.test(normalizedTxid) ||
    !["pending", "confirmed", "dropped"].includes(normalizedStatus) ||
    payload?.contract !== "proof-of-work-tx-status-v2" ||
    String(payload?.network ?? "") !== NETWORK ||
    String(payload?.txid ?? "").trim().toLowerCase() !== normalizedTxid ||
    !Number.isFinite(observedAtMs) ||
    observedAtMs < Date.UTC(2009, 0, 3, 18, 15, 5) ||
    observedAtMs > Date.now() + 5 * 60_000
  ) {
    throw new Error(`Invalid authoritative status envelope for ${normalizedTxid}.`);
  }

  let transitionTimeMs = observedAtMs;
  if (normalizedStatus === "confirmed") {
    const blockHash = String(payload?.blockHash ?? "").trim().toLowerCase();
    const blockHeight = Number(payload?.blockHeight);
    const blockTimeMs = Date.parse(payload?.blockTime ?? "");
    if (
      payload?.confirmed !== true ||
      payload?.canonical !== true ||
      !/^[0-9a-f]{64}$/u.test(blockHash) ||
      !Number.isSafeInteger(blockHeight) ||
      blockHeight <= 0 ||
      !Number.isFinite(blockTimeMs) ||
      blockTimeMs < Date.UTC(2009, 0, 3, 18, 15, 5) ||
      !coreObserved
    ) {
      throw new Error(`Unproven confirmed status for ${normalizedTxid}.`);
    }
    transitionTimeMs = blockTimeMs;
  } else if (normalizedStatus === "pending") {
    const mempoolTimeMs = Date.parse(payload?.mempoolFirstSeenAt ?? "");
    if (
      payload?.confirmed !== false ||
      payload?.mempoolSeen !== true ||
      !Number.isFinite(mempoolTimeMs) ||
      mempoolTimeMs < Date.UTC(2009, 0, 3, 18, 15, 5) ||
      !coreObserved
    ) {
      throw new Error(`Unproven pending status for ${normalizedTxid}.`);
    }
    transitionTimeMs = mempoolTimeMs;
  } else if (
    payload?.confirmed !== false ||
    payload?.absenceProven !== true ||
    !String(payload?.reason ?? "").trim() ||
    !coreObserved
  ) {
    throw new Error(`Unproven dropped status for ${normalizedTxid}.`);
  }

  const locked = await client.query(
    `
      SELECT status, raw_tx
      FROM proof_indexer.transactions
      WHERE network = $1 AND txid = $2
      FOR UPDATE
    `,
    [NETWORK, normalizedTxid],
  );
  const row = locked.rows[0];
  if (!row || row.status !== "pending") {
    return { applied: false, reason: "status-race" };
  }

  if (normalizedStatus === "confirmed") {
    return { applied: false, reason: "canonical-block-scan-required" };
  }

  const evidence = {
    absenceCount: 0,
    contract: payload.contract,
    observedAt: payload.observedAt,
    reason: payload.reason ?? undefined,
    sources: sourceList,
    status: normalizedStatus,
  };
  if (normalizedStatus === "pending") {
    const updated = await client.query(
      `
        UPDATE proof_indexer.transactions
        SET
          first_seen_at = LEAST(first_seen_at, to_timestamp($3::double precision / 1000)),
          last_seen_at = now(),
          confirmed_at = NULL,
          dropped_at = NULL,
          dropped_reason = NULL,
          replaced_by_txid = NULL,
          block_hash = NULL,
          block_height = NULL,
          block_time = NULL,
          raw_tx =
            (COALESCE(raw_tx, '{}'::jsonb) - 'statusObservation')
            || jsonb_build_object('statusObservation', $4::jsonb),
          updated_at = now()
        WHERE network = $1 AND txid = $2 AND status = 'pending'
      `,
      [
        NETWORK,
        normalizedTxid,
        transitionTimeMs,
        JSON.stringify(evidence),
      ],
    );
    if (updated.rowCount !== 1) {
      return { applied: false, reason: "status-race" };
    }
    await client.query(
      `
        UPDATE proof_indexer.events
        SET
          block_height = NULL,
          block_time = NULL,
          event_time = CASE
            WHEN event_time IS NULL
              OR event_time < TIMESTAMPTZ '2009-01-03 18:15:05+00'
            THEN to_timestamp($3::double precision / 1000)
            ELSE LEAST(
              event_time,
              to_timestamp($3::double precision / 1000)
            )
          END,
          payload =
            (
              payload
              - 'blockHash'
              - 'blockHeight'
              - 'blockTime'
              - 'height'
              - '_powBlockHash'
              - '_powBlockIndex'
              - 'createdAt'
            )
            || jsonb_build_object(
              'confirmed', false,
              'createdAt', CASE
                WHEN event_time IS NULL
                  OR event_time < TIMESTAMPTZ '2009-01-03 18:15:05+00'
                THEN to_timestamp($3::double precision / 1000)
                ELSE LEAST(
                  event_time,
                  to_timestamp($3::double precision / 1000)
                )
              END,
              'status', 'pending'
            ),
          updated_at = now()
        WHERE network = $1 AND txid = $2 AND status = 'pending'
      `,
      [NETWORK, normalizedTxid, transitionTimeMs],
    );
    await client.query(
      `
        UPDATE proof_indexer.mail_items
        SET
          event_time = CASE
            WHEN event_time IS NULL
              OR event_time < TIMESTAMPTZ '2009-01-03 18:15:05+00'
            THEN to_timestamp($3::double precision / 1000)
            ELSE LEAST(
              event_time,
              to_timestamp($3::double precision / 1000)
            )
          END,
          message =
            (message - 'blockHash' - 'blockHeight' - 'blockTime' - 'height')
            || jsonb_build_object('confirmed', false, 'status', 'pending')
        WHERE network = $1 AND txid = $2 AND status = 'pending'
      `,
      [NETWORK, normalizedTxid, transitionTimeMs],
    );
    await client.query(
      `
        UPDATE proof_indexer.file_attachments
        SET
          event_time = CASE
            WHEN event_time IS NULL
              OR event_time < TIMESTAMPTZ '2009-01-03 18:15:05+00'
            THEN to_timestamp($3::double precision / 1000)
            ELSE LEAST(
              event_time,
              to_timestamp($3::double precision / 1000)
            )
          END,
          metadata =
            (metadata - 'blockHash' - 'blockHeight' - 'blockTime' - 'height')
            || jsonb_build_object('confirmed', false, 'status', 'pending')
        WHERE network = $1 AND txid = $2 AND status = 'pending'
      `,
      [NETWORK, normalizedTxid, transitionTimeMs],
    );
    return { applied: true, reason: "mempool-evidence" };
  }

  const priorObservation =
    row.raw_tx?.statusObservation &&
    typeof row.raw_tx.statusObservation === "object"
      ? row.raw_tx.statusObservation
      : null;
  const priorObservedAtMs = Date.parse(priorObservation?.observedAt ?? "");
  const priorAbsenceCount = Number(priorObservation?.absenceCount ?? 0);
  const repeatedAbsence =
    priorObservation?.status === "dropped" &&
    Number.isSafeInteger(priorAbsenceCount) &&
    priorAbsenceCount > 0 &&
    Number.isFinite(priorObservedAtMs) &&
    observedAtMs >= priorObservedAtMs + PENDING_DROP_CONFIRMATION_MS;
  evidence.absenceCount = repeatedAbsence ? priorAbsenceCount + 1 : 1;

  if (!repeatedAbsence) {
    await client.query(
      `
        UPDATE proof_indexer.transactions
        SET
          raw_tx =
            (COALESCE(raw_tx, '{}'::jsonb) - 'statusObservation')
            || jsonb_build_object('statusObservation', $3::jsonb),
          updated_at = now()
        WHERE network = $1 AND txid = $2 AND status = 'pending'
      `,
      [NETWORK, normalizedTxid, JSON.stringify(evidence)],
    );
    return { applied: false, reason: "repeat-absence-required" };
  }

  const dropped = await client.query(
    `
      UPDATE proof_indexer.transactions
      SET
        status = 'dropped',
        confirmed_at = NULL,
        dropped_at = to_timestamp($4::double precision / 1000),
        dropped_reason = $5,
        block_hash = NULL,
        block_height = NULL,
        block_time = NULL,
        raw_tx =
          (COALESCE(raw_tx, '{}'::jsonb) - 'statusObservation')
          || jsonb_build_object('statusObservation', $3::jsonb),
        updated_at = now()
      WHERE network = $1 AND txid = $2 AND status = 'pending'
    `,
    [
      NETWORK,
      normalizedTxid,
      JSON.stringify(evidence),
      observedAtMs,
      String(payload.reason),
    ],
  );
  if (dropped.rowCount !== 1) {
    return { applied: false, reason: "status-race" };
  }
  await client.query(
    `
      UPDATE proof_indexer.events
      SET
        status = 'dropped',
        block_height = NULL,
        block_time = NULL,
        payload =
          (
            payload
            - 'blockHash'
            - 'blockHeight'
            - 'blockTime'
            - 'height'
            - '_powBlockHash'
            - '_powBlockIndex'
          )
          || jsonb_build_object('confirmed', false, 'status', 'dropped'),
        updated_at = now()
      WHERE network = $1 AND txid = $2 AND status = 'pending'
    `,
    [NETWORK, normalizedTxid],
  );
  await client.query(
    `
      UPDATE proof_indexer.mail_items
      SET
        status = 'dropped',
        message =
          (message - 'blockHash' - 'blockHeight' - 'blockTime' - 'height')
          || jsonb_build_object('confirmed', false, 'status', 'dropped')
      WHERE network = $1 AND txid = $2 AND status = 'pending'
    `,
    [NETWORK, normalizedTxid],
  );
  await client.query(
    `
      UPDATE proof_indexer.file_attachments
      SET
        status = 'dropped',
        metadata =
          (metadata - 'blockHash' - 'blockHeight' - 'blockTime' - 'height')
          || jsonb_build_object('confirmed', false, 'status', 'dropped')
      WHERE network = $1 AND txid = $2 AND status = 'pending'
    `,
    [NETWORK, normalizedTxid],
  );
  await client.query(
    `
      UPDATE proof_indexer.credit_definitions
      SET
        confirmed = false,
        created_height = NULL,
        metadata = metadata || jsonb_build_object(
          'confirmed', false,
          'status', 'dropped'
        )
      WHERE network = $1 AND create_txid = $2 AND confirmed = false
    `,
    [NETWORK, normalizedTxid],
  );
  await client.query(
    `
      UPDATE proof_indexer.credit_listings
      SET
        status = 'dropped',
        seal_txid = NULL,
        close_txid = NULL,
        buyer_address = NULL,
        payload =
          (
            payload
            - 'sealTxid'
            - 'closeTxid'
            - 'closedTxid'
            - 'saleTxid'
            - 'buyerAddress'
          )
          || jsonb_build_object(
          'confirmed', false,
          'closedConfirmed', false,
          'sealPending', false,
          'status', 'dropped'
        ),
        updated_at = now()
      WHERE network = $1 AND listing_id = $2 AND status = 'pending'
    `,
    [NETWORK, normalizedTxid],
  );
  await client.query(
    `
      WITH affected AS (
        SELECT cl.listing_id
        FROM proof_indexer.credit_listings cl
        WHERE cl.network = $1
          AND (
            (cl.seal_txid = $2 AND cl.status = 'sealing')
            OR (
              cl.close_txid = $2
              AND cl.status IN ('pending', 'sealing')
            )
          )
      ),
      restoration AS (
        SELECT
          affected.listing_id,
          base_event.payload AS base_payload,
          surviving_seal.txid AS confirmed_seal_txid,
          surviving_seal.payload AS confirmed_seal_payload
        FROM affected
        LEFT JOIN LATERAL (
          SELECT e.payload
          FROM proof_indexer.events e
          WHERE e.network = $1
            AND e.txid = affected.listing_id
            AND e.kind = 'token-listing'
            AND e.status = 'confirmed'
            AND e.valid = true
          ORDER BY e.block_height DESC NULLS LAST, e.event_id DESC
          LIMIT 1
        ) base_event ON true
        LEFT JOIN LATERAL (
          SELECT e.txid, e.payload
          FROM proof_indexer.events e
          WHERE e.network = $1
            AND e.kind = 'token-listing-sealed'
            AND e.status = 'confirmed'
            AND e.valid = true
            AND e.txid <> $2
            AND lower(e.payload->>'listingId') = affected.listing_id
          ORDER BY e.block_height DESC NULLS LAST, e.event_id DESC
          LIMIT 1
        ) surviving_seal ON true
      )
      UPDATE proof_indexer.credit_listings cl
      SET
        status = CASE
          WHEN restoration.base_payload IS NULL THEN 'dropped'
          WHEN restoration.confirmed_seal_txid IS NOT NULL THEN 'sealing'
          ELSE 'active'
        END,
        seller_address = COALESCE(
          NULLIF(restoration.base_payload->>'sellerAddress', ''),
          cl.seller_address
        ),
        buyer_address = NULL,
        amount = CASE
          WHEN restoration.base_payload->>'amount' ~ '^[0-9]+$'
            THEN (restoration.base_payload->>'amount')::numeric
          ELSE cl.amount
        END,
        price_sats = CASE
          WHEN restoration.base_payload->>'priceSats' ~ '^[0-9]+$'
            THEN (restoration.base_payload->>'priceSats')::bigint
          ELSE cl.price_sats
        END,
        sale_ticket_txid = COALESCE(
          NULLIF(restoration.base_payload->>'saleTicketTxid', ''),
          cl.sale_ticket_txid
        ),
        seal_txid = restoration.confirmed_seal_txid,
        close_txid = NULL,
        payload = CASE
          WHEN restoration.base_payload IS NULL THEN
            (
              cl.payload
              - 'sealTxid'
              - 'sealAt'
              - 'sealedAt'
              - 'closeTxid'
              - 'closedTxid'
              - 'closedAt'
              - 'closeAt'
              - 'saleTxid'
              - 'buyerAddress'
            )
            || jsonb_build_object(
              'confirmed', false,
              'closedConfirmed', false,
              'sealPending', false,
              'status', 'dropped'
            )
          ELSE
            (
              restoration.base_payload
              || CASE
                WHEN restoration.confirmed_seal_payload IS NULL
                  THEN '{}'::jsonb
                ELSE
                  restoration.confirmed_seal_payload
                  - 'txid'
                  - 'eventTxid'
                  - 'createdAt'
                  - 'kind'
                  - 'protocol'
                  - 'blockHash'
                  - 'blockHeight'
                  - 'blockTime'
                  - 'closeTxid'
                  - 'closedTxid'
                  - 'closedAt'
                  - 'closeAt'
                  - 'saleTxid'
                  - 'buyerAddress'
                END
            )
            || jsonb_build_object(
              'confirmed', true,
              'closedConfirmed', false,
              'listingId', restoration.listing_id,
              'sealConfirmed',
                restoration.confirmed_seal_txid IS NOT NULL,
              'sealPending', false,
              'status', CASE
                WHEN restoration.confirmed_seal_txid IS NOT NULL
                  THEN 'sealing'
                ELSE 'active'
              END,
              'txid', restoration.listing_id
            )
        END,
        updated_at = now()
      FROM restoration
      WHERE cl.network = $1
        AND cl.listing_id = restoration.listing_id
    `,
    [NETWORK, normalizedTxid],
  );
  return { applied: true, reason: "repeated-core-absence" };
}

async function refreshPendingStatuses(pool) {
  const pendingResult = await pool.query(
    `
      SELECT txid, last_seen_at
      FROM proof_indexer.transactions
      WHERE network = $1
        AND status = 'pending'
        AND last_seen_at <= now() - ($2::double precision * interval '1 millisecond')
      ORDER BY last_seen_at ASC, txid ASC
      LIMIT $3
    `,
    [NETWORK, PENDING_MIN_AGE_MS, PENDING_STATUS_LIMIT],
  );

  const summary = {
    checked: 0,
    confirmed: 0,
    deferred: 0,
    dropped: 0,
    errors: 0,
    pending: 0,
    staleCandidates: pendingResult.rowCount,
  };
  const deadlineMs = Date.now() + PENDING_STATUS_BUDGET_MS;
  let nextIndex = 0;
  const worker = async () => {
    while (nextIndex < pendingResult.rows.length) {
      const remainingMs = deadlineMs - Date.now();
      if (remainingMs <= 0) {
        return;
      }
      const row = pendingResult.rows[nextIndex];
      nextIndex += 1;
      const txid = String(row.txid);
      summary.checked += 1;
      try {
        const payload = await readJson(
          endpoint(`/api/v1/tx/${txid}/status`),
          Math.max(1, Math.min(STATUS_REQUEST_TIMEOUT_MS, remainingMs)),
        );
        const status = String(payload?.status ?? "").toLowerCase();
        if (!["pending", "confirmed", "dropped"].includes(status)) {
          throw new Error(
            `Unexpected tx status ${JSON.stringify(payload?.status)}`,
          );
        }

        const client = await pool.connect();
        try {
          await client.query("BEGIN");
          const outcome = await updateTransactionStatus(
            client,
            txid,
            status,
            payload,
          );
          await client.query("COMMIT");
          if (outcome?.applied) {
            summary[status] += 1;
          } else {
            summary.deferred += 1;
          }
        } catch (error) {
          await client.query("ROLLBACK");
          throw error;
        } finally {
          client.release();
        }
      } catch (error) {
        summary.errors += 1;
        console.error(
          JSON.stringify({
            error: error?.message ?? String(error),
            phase: "pending-status",
            txid,
          }),
        );
      }
    }
  };
  await Promise.all(
    Array.from(
      {
        length: Math.min(
          PENDING_STATUS_CONCURRENCY,
          pendingResult.rows.length,
        ),
      },
      () => worker(),
    ),
  );
  summary.deferred += Math.max(0, pendingResult.rows.length - summary.checked);

  return summary;
}

async function runCycle(pool, lastSuccess) {
  const startedAt = new Date();
  await writeWorkerMeta(pool, {
    apiBase: API_BASE,
    lastSuccess,
    lastSuccessAt: lastSuccess?.finishedAt ?? null,
    network: NETWORK,
    ok: Boolean(lastSuccess),
    startedAt: startedAt.toISOString(),
    state: "running",
  });
  const backfillEnv = {
    NETWORK,
    POW_API_BASE: API_BASE,
    POW_INDEX_BACKFILL_LIMIT: String(BACKFILL_LIMIT),
    POW_INDEX_BACKFILL_MAX_PAGES: String(BACKFILL_MAX_PAGES),
    POW_INDEX_BACKFILL_HOLDERS: INCLUDE_HOLDERS ? "1" : "0",
    POW_INDEX_BACKFILL_SOURCES: BACKFILL_SOURCES,
    POW_INDEX_BACKFILL_SNAPSHOT_FRESH: BACKFILL_SNAPSHOT_FRESH,
    POW_INDEX_BACKFILL_SOURCE_FRESH: BACKFILL_SOURCE_FRESH,
    POW_INDEX_BACKFILL_STORE_LEDGER_SNAPSHOT: BACKFILL_STORE_LEDGER_SNAPSHOT,
    POW_INDEX_BACKFILL_STORE_CANONICAL_SUMMARY_SNAPSHOT:
      BACKFILL_STORE_CANONICAL_SUMMARY_SNAPSHOT,
    POW_INDEX_BACKFILL_SUMMARY_SNAPSHOT_FRESH: BACKFILL_SUMMARY_SNAPSHOT_FRESH,
    POW_INDEX_BACKFILL_TOKEN_SNAPSHOT_FRESH: BACKFILL_TOKEN_SNAPSHOT_FRESH,
    POW_INDEX_DB_APP_NAME: "proof-indexer-worker-backfill",
  };

  const pendingStatus = await refreshPendingStatuses(pool);
  await runBackfillWithRetries(backfillEnv);

  const nowMs = Date.now();
  const runParityNow =
    RUN_PARITY &&
    (ONCE ||
      lastParityAtMs === 0 ||
      nowMs - lastParityAtMs >= Math.max(0, PARITY_INTERVAL_MS));
  if (runParityNow) {
    lastParityAtMs = nowMs;
    try {
      await runScript("check-proof-indexer-parity.mjs", [], {
        NETWORK,
        POW_API_BASE: API_BASE,
        POW_INDEX_DB_APP_NAME: "proof-indexer-worker-parity",
      }, {
        timeoutMs: PARITY_CHILD_TIMEOUT_MS,
      });
      lastParityAtMs = Date.now();
    } catch (error) {
      console.error(`Worker parity check failed: ${error?.message ?? error}`);
    }
  }

  const finishedAt = new Date();
  const currentSuccess = {
    durationMs: finishedAt.getTime() - startedAt.getTime(),
    finishedAt: finishedAt.toISOString(),
    pendingStatus,
    startedAt: startedAt.toISOString(),
  };
  const value = {
    apiBase: API_BASE,
    backfillLimit: BACKFILL_LIMIT,
    backfillMaxPages: BACKFILL_MAX_PAGES,
    backfillSources: BACKFILL_SOURCES,
    consecutiveFailures: 0,
    durationMs: currentSuccess.durationMs,
    finishedAt: currentSuccess.finishedAt,
    holders: INCLUDE_HOLDERS,
    lastSuccess: currentSuccess,
    lastSuccessAt: currentSuccess.finishedAt,
    network: NETWORK,
    ok: true,
    parity: runParityNow,
    parityEnabled: RUN_PARITY,
    parityIntervalMs: PARITY_INTERVAL_MS,
    pendingStatus,
    startedAt: currentSuccess.startedAt,
    state: "idle",
  };
  await writeWorkerMeta(pool, value);
  console.log(JSON.stringify({ phase: "worker-cycle", ...value }));
  return currentSuccess;
}

if (DRY_RUN) {
  console.log(
    JSON.stringify(
      {
        apiBase: API_BASE,
        backfillLimit: BACKFILL_LIMIT,
        backfillMaxPages: BACKFILL_MAX_PAGES,
        backfillSources: BACKFILL_SOURCES,
        backfillStoreLedgerSnapshot: BACKFILL_STORE_LEDGER_SNAPSHOT,
        backfillStoreCanonicalSummarySnapshot:
          BACKFILL_STORE_CANONICAL_SUMMARY_SNAPSHOT,
        dryRun: true,
        intervalMs: INTERVAL_MS,
        holders: INCLUDE_HOLDERS,
        maxConsecutiveFailures: MAX_CONSECUTIVE_FAILURES,
        network: NETWORK,
        once: ONCE,
        parity: RUN_PARITY,
        parityIntervalMs: PARITY_INTERVAL_MS,
        pendingDropConfirmationMs: PENDING_DROP_CONFIRMATION_MS,
        pendingMinAgeMs: PENDING_MIN_AGE_MS,
        pendingStatusBudgetMs: PENDING_STATUS_BUDGET_MS,
        pendingStatusConcurrency: PENDING_STATUS_CONCURRENCY,
        pendingStatusLimit: PENDING_STATUS_LIMIT,
        backfillTimeoutMs: BACKFILL_CHILD_TIMEOUT_MS,
        backfillRetries: BACKFILL_RETRIES,
        backfillRetryDelayMs: BACKFILL_RETRY_DELAY_MS,
        parityTimeoutMs: PARITY_CHILD_TIMEOUT_MS,
        statusTimeoutMs: STATUS_REQUEST_TIMEOUT_MS,
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
      process.env.POW_INDEX_DB_APP_NAME ?? "proof-indexer-worker",
  },
});

let stopping = false;
for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => {
    stopping = true;
  });
}

try {
  const previousMeta = await readWorkerMeta(pool).catch(() => null);
  let lastSuccess = lastSuccessFromMeta(previousMeta);
  let consecutiveFailures = 0;
  await writeWorkerMeta(pool, {
    apiBase: API_BASE,
    lastSuccess,
    lastSuccessAt: lastSuccess?.finishedAt ?? null,
    network: NETWORK,
    ok: Boolean(lastSuccess),
    startedAt: new Date().toISOString(),
    state: "starting",
  });
  while (!stopping) {
    try {
      lastSuccess = await runCycle(pool, lastSuccess);
      consecutiveFailures = 0;
      if (ONCE || stopping) {
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, INTERVAL_MS));
    } catch (error) {
      consecutiveFailures += 1;
      const value = {
        apiBase: API_BASE,
        consecutiveFailures,
        error: error?.message ?? String(error),
        failedAt: new Date().toISOString(),
        lastSuccess,
        lastSuccessAt: lastSuccess?.finishedAt ?? null,
        maxConsecutiveFailures: MAX_CONSECUTIVE_FAILURES,
        network: NETWORK,
        ok: false,
        state: "failed",
      };
      console.error(JSON.stringify({ phase: "worker-cycle", ...value }));
      await writeWorkerMeta(pool, value).catch(() => {});
      if (
        ONCE ||
        stopping ||
        consecutiveFailures >= MAX_CONSECUTIVE_FAILURES
      ) {
        throw error;
      }
      await new Promise((resolve) => setTimeout(resolve, ERROR_INTERVAL_MS));
    }
  }
} finally {
  await pool.end();
}
