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
const DEFAULT_WORKER_BACKFILL_SOURCES = [
  "token-listings",
  "token-closed-listings",
  "token-sales",
  "token-transfers",
  "token-mints",
  "tokens",
  "token-invalid-events",
  "registry-records",
  "registry-listings",
  "registry-sales",
  "registry-pending",
  "log",
].join(",");
const BACKFILL_SOURCES = String(
  process.env.POW_INDEX_WORKER_BACKFILL_SOURCES ??
    DEFAULT_WORKER_BACKFILL_SOURCES,
).trim();
const BACKFILL_SOURCE_FRESH = String(
  process.env.POW_INDEX_WORKER_BACKFILL_SOURCE_FRESH ??
    process.env.POW_INDEX_BACKFILL_SOURCE_FRESH ??
    "1",
).trim();
const BACKFILL_SNAPSHOT_FRESH = String(
  process.env.POW_INDEX_WORKER_BACKFILL_SNAPSHOT_FRESH ??
    process.env.POW_INDEX_BACKFILL_SNAPSHOT_FRESH ??
    "",
).trim();
const BACKFILL_TOKEN_SNAPSHOT_FRESH = String(
  process.env.POW_INDEX_WORKER_BACKFILL_TOKEN_SNAPSHOT_FRESH ??
    process.env.POW_INDEX_BACKFILL_TOKEN_SNAPSHOT_FRESH ??
    "1",
).trim();
const BACKFILL_SUMMARY_SNAPSHOT_FRESH = String(
  process.env.POW_INDEX_WORKER_BACKFILL_SUMMARY_SNAPSHOT_FRESH ??
    process.env.POW_INDEX_BACKFILL_SUMMARY_SNAPSHOT_FRESH ??
    "1",
).trim();
const PENDING_STATUS_LIMIT = Number(process.env.POW_INDEX_PENDING_STATUS_LIMIT ?? 100);
const PENDING_MIN_AGE_MS = Number(process.env.POW_INDEX_PENDING_MIN_AGE_MS ?? 300_000);
const REQUEST_TIMEOUT_MS = Number(process.env.POW_INDEX_FETCH_TIMEOUT_MS ?? 60_000);
const STATUS_REQUEST_TIMEOUT_MS = Number(
  process.env.POW_INDEX_STATUS_FETCH_TIMEOUT_MS ??
    Math.min(REQUEST_TIMEOUT_MS, 15_000),
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

function runScript(scriptName, args = [], envOverrides = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(
      process.execPath,
      [path.join(repoRoot, "scripts", scriptName), ...args],
      {
        cwd: repoRoot,
        env: { ...process.env, ...envOverrides },
        stdio: "inherit",
      },
    );
    child.on("error", reject);
    child.on("exit", (code, signal) => {
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

let lastParityAtMs = 0;

async function updateTransactionStatus(client, txid, status, payload) {
  await client.query(
    `
      UPDATE proof_indexer.transactions
      SET
        status = $3,
        last_seen_at = CASE WHEN $3 = 'pending' THEN now() ELSE last_seen_at END,
        confirmed_at = CASE WHEN $3 = 'confirmed' THEN COALESCE(confirmed_at, now()) ELSE confirmed_at END,
        dropped_at = CASE WHEN $3 = 'dropped' THEN COALESCE(dropped_at, now()) ELSE NULL END,
        raw_tx = COALESCE(raw_tx, $4::jsonb),
        updated_at = now()
      WHERE network = $1 AND txid = $2
    `,
    [NETWORK, txid, status, JSON.stringify({ statusPayload: payload })],
  );

  await client.query(
    `
      UPDATE proof_indexer.events
      SET status = $3, updated_at = now()
      WHERE network = $1 AND txid = $2 AND status <> $3
    `,
    [NETWORK, txid, status],
  );

  await client.query(
    `
      UPDATE proof_indexer.mail_items
      SET status = $3
      WHERE network = $1 AND txid = $2 AND status <> $3
    `,
    [NETWORK, txid, status],
  );

  await client.query(
    `
      UPDATE proof_indexer.file_attachments
      SET status = $3
      WHERE network = $1 AND txid = $2 AND status <> $3
    `,
    [NETWORK, txid, status],
  );

  if (status === "dropped") {
    await client.query(
      `
        UPDATE proof_indexer.credit_listings
        SET status = 'dropped', updated_at = now()
        WHERE network = $1
          AND status IN ('pending', 'sealing')
          AND (listing_id = $2 OR seal_txid = $2 OR close_txid = $2)
      `,
      [NETWORK, txid],
    );
  }
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
    dropped: 0,
    errors: 0,
    pending: 0,
    staleCandidates: pendingResult.rowCount,
  };

  for (const row of pendingResult.rows) {
    const txid = String(row.txid);
    summary.checked += 1;
    try {
      const payload = await readJson(
        endpoint(`/api/v1/tx/${txid}/status`),
        STATUS_REQUEST_TIMEOUT_MS,
      );
      const status = String(payload?.status ?? "").toLowerCase();
      if (!["pending", "confirmed", "dropped"].includes(status)) {
        throw new Error(`Unexpected tx status ${JSON.stringify(payload?.status)}`);
      }

      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        await updateTransactionStatus(client, txid, status, payload);
        await client.query("COMMIT");
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      } finally {
        client.release();
      }

      summary[status] += 1;
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

  return summary;
}

async function runCycle(pool) {
  const startedAt = new Date();
  const backfillEnv = {
    NETWORK,
    POW_API_BASE: API_BASE,
    POW_INDEX_BACKFILL_LIMIT: String(BACKFILL_LIMIT),
    POW_INDEX_BACKFILL_MAX_PAGES: String(BACKFILL_MAX_PAGES),
    POW_INDEX_BACKFILL_HOLDERS: INCLUDE_HOLDERS ? "1" : "0",
    POW_INDEX_BACKFILL_SOURCES: BACKFILL_SOURCES,
    POW_INDEX_BACKFILL_SNAPSHOT_FRESH: BACKFILL_SNAPSHOT_FRESH,
    POW_INDEX_BACKFILL_SOURCE_FRESH: BACKFILL_SOURCE_FRESH,
    POW_INDEX_BACKFILL_SUMMARY_SNAPSHOT_FRESH: BACKFILL_SUMMARY_SNAPSHOT_FRESH,
    POW_INDEX_BACKFILL_TOKEN_SNAPSHOT_FRESH: BACKFILL_TOKEN_SNAPSHOT_FRESH,
    POW_INDEX_DB_APP_NAME: "proof-indexer-worker-backfill",
  };

  await runScript("backfill-proof-indexer.mjs", [], backfillEnv);
  const pendingStatus = await refreshPendingStatuses(pool);

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
      });
      lastParityAtMs = Date.now();
    } catch (error) {
      console.error(`Worker parity check failed: ${error?.message ?? error}`);
    }
  }

  const finishedAt = new Date();
  const value = {
    apiBase: API_BASE,
    backfillLimit: BACKFILL_LIMIT,
    backfillMaxPages: BACKFILL_MAX_PAGES,
    backfillSources: BACKFILL_SOURCES,
    durationMs: finishedAt.getTime() - startedAt.getTime(),
    finishedAt: finishedAt.toISOString(),
    holders: INCLUDE_HOLDERS,
    network: NETWORK,
    ok: true,
    parity: runParityNow,
    parityEnabled: RUN_PARITY,
    parityIntervalMs: PARITY_INTERVAL_MS,
    pendingStatus,
    startedAt: startedAt.toISOString(),
  };
  await writeWorkerMeta(pool, value);
  console.log(JSON.stringify({ phase: "worker-cycle", ...value }));
}

if (DRY_RUN) {
  console.log(
    JSON.stringify(
      {
        apiBase: API_BASE,
        backfillLimit: BACKFILL_LIMIT,
        backfillMaxPages: BACKFILL_MAX_PAGES,
        backfillSources: BACKFILL_SOURCES,
        dryRun: true,
        intervalMs: INTERVAL_MS,
        holders: INCLUDE_HOLDERS,
        network: NETWORK,
        once: ONCE,
        parity: RUN_PARITY,
        parityIntervalMs: PARITY_INTERVAL_MS,
        pendingMinAgeMs: PENDING_MIN_AGE_MS,
        pendingStatusLimit: PENDING_STATUS_LIMIT,
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
  while (!stopping) {
    try {
      await runCycle(pool);
      if (ONCE || stopping) {
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, INTERVAL_MS));
    } catch (error) {
      const value = {
        apiBase: API_BASE,
        error: error?.message ?? String(error),
        failedAt: new Date().toISOString(),
        network: NETWORK,
        ok: false,
      };
      console.error(JSON.stringify({ phase: "worker-cycle", ...value }));
      await writeWorkerMeta(pool, value).catch(() => {});
      if (ONCE || stopping) {
        throw error;
      }
      await new Promise((resolve) => setTimeout(resolve, ERROR_INTERVAL_MS));
    }
  }
} finally {
  await pool.end();
}
