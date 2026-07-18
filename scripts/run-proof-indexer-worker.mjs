import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { createProofIndexPool } from "../server/db/postgres.mjs";
import {
  WORK_ATOMIC_PROJECTION_MODEL,
  WORK_DECIMALS,
  WORK_TOKEN_ID,
  WORK_UNIT_SCALE_TEXT,
} from "../server/work-units.mjs";

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
const MAX_ERROR_INTERVAL_MS = Math.max(
  ERROR_INTERVAL_MS,
  Number(process.env.POW_INDEX_WORKER_MAX_ERROR_INTERVAL_MS ?? 15 * 60_000) ||
    15 * 60_000,
);
const NO_PROGRESS_ALERT_INTERVAL_MS = Math.max(
  60_000,
  Number(
    process.env.POW_INDEX_WORKER_NO_PROGRESS_ALERT_INTERVAL_MS ??
      15 * 60_000,
  ) ||
    15 * 60_000,
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
const PENDING_DROP_CONFIRMATION_MS = pendingDropConfirmationMs(
  process.env.POW_INDEX_PENDING_DROP_CONFIRMATION_MS,
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
const REQUIRE_WORK_ATOMIC_PROJECTION = !/^(?:0|false|no)$/iu.test(
  String(process.env.POW_INDEX_REQUIRE_WORK_ATOMS ?? "1"),
);
const CHILD_LINE_BUFFER_CHARS = 16_384;
const CHILD_ERROR_MAX_CHARS = 4_096;
const CHILD_STOP_GRACE_MS = 5_000;
export const CANONICAL_TX_CONTENT_FAILURE_CODE =
  "POW_CANONICAL_TX_CONTENT_INVARIANT";
export const CANONICAL_TX_CONTENT_FAILURE_CLASS =
  "CanonicalTransactionContentInvariantError";

function workerStoppingError() {
  const error = new Error("Proof index worker is stopping");
  error.code = "POW_INDEX_WORKER_STOPPING";
  return error;
}

export function createWorkerRuntime(network = NETWORK) {
  return {
    activeChild: null,
    childStopTimer: null,
    network: String(network ?? ""),
    noProgress: null,
    stopping: false,
    wakeSleep: null,
  };
}

export function requestWorkerStop(runtime) {
  if (!runtime || runtime.stopping) {
    return;
  }
  runtime.stopping = true;
  runtime.wakeSleep?.();
  const child = runtime.activeChild;
  if (!child || child.exitCode !== null || child.signalCode !== null) {
    return;
  }
  child.kill("SIGTERM");
  clearTimeout(runtime.childStopTimer);
  runtime.childStopTimer = setTimeout(() => {
    if (runtime.activeChild === child) {
      child.kill("SIGKILL");
    }
  }, CHILD_STOP_GRACE_MS);
  runtime.childStopTimer.unref?.();
}

function workerSleep(runtime, delayMs) {
  if (runtime?.stopping) {
    return Promise.resolve();
  }
  return new Promise((resolve) => {
    const timeout = setTimeout(() => {
      if (runtime?.wakeSleep === wake) {
        runtime.wakeSleep = null;
      }
      resolve();
    }, Math.max(0, Number(delayMs) || 0));
    const wake = () => {
      clearTimeout(timeout);
      if (runtime?.wakeSleep === wake) {
        runtime.wakeSleep = null;
      }
      resolve();
    };
    if (runtime) {
      runtime.wakeSleep = wake;
    }
  });
}

async function assertWorkAtomicProjectionReady(pool) {
  if (!REQUIRE_WORK_ATOMIC_PROJECTION) {
    return;
  }
  const result = await pool.query(
    `
      SELECT max_supply::text, mint_amount::text, metadata
      FROM proof_indexer.credit_definitions
      WHERE network = $1 AND token_id = $2
      LIMIT 1
    `,
    [NETWORK, WORK_TOKEN_ID],
  );
  const row = result.rows[0];
  const metadata =
    row?.metadata &&
    typeof row.metadata === "object" &&
    !Array.isArray(row.metadata)
      ? row.metadata
      : {};
  if (
    !row ||
    String(row.max_supply ?? "") !== "2100000000000000" ||
    String(row.mint_amount ?? "") !== "100000000000" ||
    metadata.amountStorageModel !== WORK_ATOMIC_PROJECTION_MODEL ||
    Number(metadata.decimals) !== WORK_DECIMALS ||
    String(metadata.unitScale ?? "") !== WORK_UNIT_SCALE_TEXT
  ) {
    throw new Error(
      "Proof index worker is paused until the transactional WORK atomic projection migration is complete.",
    );
  }
}

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

function finitePositiveInteger(value, fallback) {
  const parsed = Math.trunc(Number(value));
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function cappedChildError(value) {
  const text = String(value ?? "Canonical transaction verification failed");
  return text.length <= CHILD_ERROR_MAX_CHARS
    ? text
    : `${text.slice(0, CHILD_ERROR_MAX_CHARS - 1)}…`;
}

function normalizedCheckpoint(value) {
  const rawHeight = value?.checkpointHeight ?? value?.indexedThroughBlock;
  const height =
    rawHeight === undefined || rawHeight === null || rawHeight === ""
      ? null
      : Math.trunc(Number(rawHeight));
  const hash = String(
    value?.checkpointHash ?? value?.indexedThroughBlockHash ?? "",
  )
    .trim()
    .toLowerCase();
  return {
    checkpointHash: /^[0-9a-f]{64}$/u.test(hash) ? hash : null,
    checkpointHeight:
      Number.isSafeInteger(height) && height >= 0 ? height : null,
  };
}

function trustedCanonicalWorkerFailureIdentity(value) {
  return (
    value?.failureCode === CANONICAL_TX_CONTENT_FAILURE_CODE &&
    value?.failureClass === CANONICAL_TX_CONTENT_FAILURE_CLASS
  );
}

export function canonicalWorkerFailureFromLine(line) {
  const candidate = String(line ?? "").trim();
  if (
    candidate.length > CHILD_LINE_BUFFER_CHARS ||
    !candidate.startsWith("{") ||
    !candidate.endsWith("}")
  ) {
    return null;
  }
  let value;
  try {
    value = JSON.parse(candidate);
  } catch {
    return null;
  }
  const failingBlockHeight = Math.trunc(Number(value?.height));
  const txid = String(value?.txid ?? "").trim().toLowerCase();
  if (
    !trustedCanonicalWorkerFailureIdentity(value) ||
    value?.phase !== "block-scan-verification" ||
    !Number.isSafeInteger(failingBlockHeight) ||
    failingBlockHeight <= 0 ||
    !/^[0-9a-f]{64}$/u.test(txid)
  ) {
    return null;
  }
  return {
    deterministic: true,
    error: cappedChildError(value?.error),
    failureClass: CANONICAL_TX_CONTENT_FAILURE_CLASS,
    failureCode: CANONICAL_TX_CONTENT_FAILURE_CODE,
    failingBlockHeight,
    phase: "block-scan-verification",
    txid,
  };
}

export function canonicalWorkerFailureFromError(error) {
  const failure = error?.workerFailure;
  if (!failure || typeof failure !== "object") {
    return null;
  }
  return canonicalWorkerFailureFromLine(JSON.stringify({
    error: failure.error,
    failureClass: failure.failureClass,
    failureCode: failure.failureCode,
    height: failure.failingBlockHeight ?? failure.height,
    phase: failure.phase,
    txid: failure.txid,
  }));
}

function failureFingerprint(failure) {
  return [
    String(failure?.failureCode ?? ""),
    String(failure?.failureClass ?? ""),
    String(failure?.phase ?? ""),
    `h${Math.trunc(Number(failure?.failingBlockHeight ?? 0))}`,
    String(failure?.txid ?? "").trim().toLowerCase(),
  ].join(":");
}

function exponentialRetryDelayMs(
  repeatCount,
  baseDelayMs = ERROR_INTERVAL_MS,
  maxDelayMs = MAX_ERROR_INTERVAL_MS,
) {
  const base = finitePositiveInteger(baseDelayMs, 1_000);
  const maximum = Math.max(base, finitePositiveInteger(maxDelayMs, base));
  const exponent = Math.min(20, Math.max(0, repeatCount - 1));
  return Math.min(maximum, base * 2 ** exponent);
}

export function nextWorkerNoProgressState(
  previous,
  {
    failure,
    progress,
    nowMs = Date.now(),
    threshold = MAX_CONSECUTIVE_FAILURES,
    baseDelayMs = ERROR_INTERVAL_MS,
    maxDelayMs = MAX_ERROR_INTERVAL_MS,
    alertIntervalMs = NO_PROGRESS_ALERT_INTERVAL_MS,
    network = NETWORK,
  } = {},
) {
  if (
    failure?.deterministic !== true ||
    !trustedCanonicalWorkerFailureIdentity(failure)
  ) {
    throw new Error(
      "A trusted deterministic canonical worker failure is required",
    );
  }
  const checkpoint = normalizedCheckpoint(progress);
  const fingerprint = failureFingerprint(failure);
  const previousCheckpoint = normalizedCheckpoint(previous);
  const sameFailureWithoutProgress =
    previous?.fingerprint === fingerprint &&
    previousCheckpoint.checkpointHeight === checkpoint.checkpointHeight &&
    previousCheckpoint.checkpointHash === checkpoint.checkpointHash;
  const repeatCount = sameFailureWithoutProgress
    ? finitePositiveInteger(previous?.repeatCount, 1) + 1
    : 1;
  const activationThreshold = finitePositiveInteger(threshold, 3);
  const active = repeatCount >= activationThreshold;
  const now = new Date(nowMs).toISOString();
  const retryDelayMs = exponentialRetryDelayMs(
    repeatCount,
    baseDelayMs,
    maxDelayMs,
  );
  const previousLastAlertMs = Date.parse(String(previous?.lastAlertAt ?? ""));
  const alertInterval = finitePositiveInteger(alertIntervalMs, 15 * 60_000);
  const alertReady =
    active &&
    (!sameFailureWithoutProgress ||
      previous?.active !== true ||
      !Number.isFinite(previousLastAlertMs) ||
      nowMs - previousLastAlertMs >= alertInterval);
  return {
    action: "retry",
    active,
    alertReady,
    checkpointHash: checkpoint.checkpointHash,
    checkpointHeight: checkpoint.checkpointHeight,
    error: String(failure.error ?? "Canonical transaction verification failed"),
    failureClass: CANONICAL_TX_CONTENT_FAILURE_CLASS,
    failureCode: CANONICAL_TX_CONTENT_FAILURE_CODE,
    failingBlockHeight: failure.failingBlockHeight,
    fingerprint,
    firstFailedAt: sameFailureWithoutProgress
      ? previous.firstFailedAt
      : now,
    lastAlertAt: sameFailureWithoutProgress
      ? previous.lastAlertAt ?? null
      : null,
    lastFailedAt: now,
    network: String(network ?? ""),
    nextRetryAt: new Date(nowMs + retryDelayMs).toISOString(),
    phase: failure.phase,
    reason: "deterministic-canonical-checkpoint-no-progress",
    repeatCount,
    retryDelayMs,
    threshold: activationThreshold,
    txid: failure.txid,
  };
}

export function markWorkerNoProgressAlerted(state, nowMs = Date.now()) {
  return {
    ...state,
    alertReady: false,
    lastAlertAt: new Date(nowMs).toISOString(),
  };
}

export function resetWorkerNoProgressState(
  previous,
  progress,
  nowMs = Date.now(),
  reason = "canonical-progress-resumed",
  network = NETWORK,
) {
  const checkpoint = normalizedCheckpoint(progress);
  return {
    action: "normal",
    active: false,
    alertReady: false,
    checkpointHash: checkpoint.checkpointHash,
    checkpointHeight: checkpoint.checkpointHeight,
    clearedFingerprint: previous?.fingerprint ?? null,
    network: String(network ?? ""),
    reason,
    repeatCount: 0,
    resetAt: new Date(nowMs).toISOString(),
  };
}

export function workerNoProgressFromMeta(value, network = NETWORK) {
  const expectedNetwork = String(network ?? "");
  const state = value?.noProgress;
  if (
    !value ||
    typeof value !== "object" ||
    String(value.network ?? "") !== expectedNetwork ||
    !state ||
    typeof state !== "object" ||
    String(state.network ?? "") !== expectedNetwork ||
    !Number.isSafeInteger(Number(state.repeatCount)) ||
    Number(state.repeatCount) < 0
  ) {
    return null;
  }
  if (
    Number(state.repeatCount) > 0 &&
    !trustedCanonicalWorkerFailureIdentity(state)
  ) {
    return null;
  }
  if (
    state.active === true &&
    (!/^[0-9a-f]{64}$/u.test(String(state.checkpointHash ?? "")) ||
      !Number.isSafeInteger(Number(state.checkpointHeight)) ||
      Number(state.checkpointHeight) < 0 ||
      !/^[0-9a-f]{64}$/u.test(String(state.txid ?? "")) ||
      !Number.isSafeInteger(Number(state.failingBlockHeight)) ||
      Number(state.failingBlockHeight) <= Number(state.checkpointHeight))
  ) {
    return null;
  }
  return state;
}

export function shouldEscalateWorkerFailure(
  canonicalFailure,
  consecutiveFailures,
  threshold = MAX_CONSECUTIVE_FAILURES,
) {
  return (
    !canonicalFailure &&
    Number(consecutiveFailures) >= finitePositiveInteger(threshold, 3)
  );
}

export function containableCanonicalFailure(failure, progress) {
  const checkpoint = normalizedCheckpoint(progress);
  return failure?.deterministic === true &&
    trustedCanonicalWorkerFailureIdentity(failure) &&
    Number.isSafeInteger(checkpoint.checkpointHeight) &&
    checkpoint.checkpointHeight >= 0 &&
    checkpoint.checkpointHeight < Number(failure.failingBlockHeight) &&
    /^[0-9a-f]{64}$/u.test(String(checkpoint.checkpointHash ?? ""))
    ? failure
    : null;
}

export async function runCanonicalBeforePending(runCanonical, runPending) {
  await runCanonical();
  return runPending();
}

export function runScript(
  scriptName,
  args = [],
  envOverrides = {},
  { runtime = null, timeoutMs = BACKFILL_CHILD_TIMEOUT_MS } = {},
) {
  if (runtime?.stopping) {
    return Promise.reject(workerStoppingError());
  }
  return new Promise((resolve, reject) => {
    let timedOut = false;
    let forceKillTimer;
    let timeout;
    let settled = false;
    let observedCanonicalFailure = null;
    const lineBuffers = new Map();
    const child = spawn(
      process.execPath,
      [path.join(repoRoot, "scripts", scriptName), ...args],
      {
        cwd: repoRoot,
        env: { ...process.env, ...envOverrides },
        stdio: ["inherit", "pipe", "pipe"],
      },
    );
    if (runtime) {
      runtime.activeChild = child;
    }
    const finish = (callback, value) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timeout);
      clearTimeout(forceKillTimer);
      if (runtime?.activeChild === child) {
        runtime.activeChild = null;
      }
      clearTimeout(runtime?.childStopTimer);
      if (runtime) {
        runtime.childStopTimer = null;
      }
      callback(value);
    };
    const observeOutput = (stream, destination, label) => {
      if (!stream) {
        return;
      }
      lineBuffers.set(label, "");
      stream.on("data", (chunk) => {
        if (!destination.write(chunk)) {
          stream.pause();
          destination.once("drain", () => stream.resume());
        }
        const combined = `${lineBuffers.get(label) ?? ""}${chunk.toString("utf8")}`;
        const lines = combined.split(/\r?\n/u);
        lineBuffers.set(
          label,
          lines.pop()?.slice(-CHILD_LINE_BUFFER_CHARS) ?? "",
        );
        for (const line of lines) {
          const failure = canonicalWorkerFailureFromLine(line);
          if (failure) {
            observedCanonicalFailure = failure;
          }
        }
      });
    };
    observeOutput(child.stdout, process.stdout, "stdout");
    observeOutput(child.stderr, process.stderr, "stderr");
    timeout = setTimeout(() => {
      timedOut = true;
      child.kill("SIGTERM");
      forceKillTimer = setTimeout(
        () => child.kill("SIGKILL"),
        CHILD_STOP_GRACE_MS,
      );
      forceKillTimer.unref?.();
    }, Math.max(1, Number(timeoutMs) || BACKFILL_CHILD_TIMEOUT_MS));
    timeout.unref?.();
    child.on("error", (error) => {
      finish(reject, runtime?.stopping ? workerStoppingError() : error);
    });
    child.on("close", (code, signal) => {
      for (const bufferedLine of lineBuffers.values()) {
        const failure = canonicalWorkerFailureFromLine(bufferedLine);
        if (failure) {
          observedCanonicalFailure = failure;
        }
      }
      if (runtime?.stopping) {
        finish(reject, workerStoppingError());
        return;
      }
      if (timedOut) {
        const error = new Error(
          `${scriptName} exceeded its ${timeoutMs}ms wall-clock budget`,
        );
        error.workerFailure = observedCanonicalFailure;
        finish(reject, error);
        return;
      }
      if (code === 0) {
        finish(resolve);
        return;
      }
      const error = new Error(
        `${scriptName} exited with ${signal ? `signal ${signal}` : `code ${code}`}`,
      );
      error.workerFailure = observedCanonicalFailure;
      finish(reject, error);
    });
  });
}

async function runBackfillWithRetries(backfillEnv, runtime) {
  let lastError;
  for (let attempt = 0; attempt <= BACKFILL_RETRIES; attempt += 1) {
    if (runtime?.stopping) {
      throw workerStoppingError();
    }
    try {
      await runScript("backfill-proof-indexer.mjs", [], backfillEnv, {
        runtime,
        timeoutMs: BACKFILL_CHILD_TIMEOUT_MS,
      });
      return;
    } catch (error) {
      lastError = error;
      if (canonicalWorkerFailureFromError(error)) {
        break;
      }
      if (runtime?.stopping || error?.code === "POW_INDEX_WORKER_STOPPING") {
        throw workerStoppingError();
      }
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
      await workerSleep(runtime, delayMs);
    }
  }
  throw lastError;
}

async function writeWorkerMeta(pool, value) {
  if (String(value?.network ?? "") !== NETWORK) {
    throw new Error("Refusing to persist cross-network worker metadata");
  }
  try {
    await pool.query(
      `
        INSERT INTO proof_indexer.meta (key, value, updated_at)
        VALUES ('worker:lastRun', $1::jsonb, now())
        ON CONFLICT (key)
        DO UPDATE SET value = EXCLUDED.value, updated_at = now()
      `,
      [JSON.stringify(value)],
    );
  } catch (error) {
    console.error(
      JSON.stringify({
        error: cappedChildError(error?.message ?? error),
        network: NETWORK,
        phase: "worker-meta-write",
        state: value?.state ?? null,
      }),
    );
    throw error;
  }
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

export const AUTHORITATIVE_WORKER_CHECKPOINT_SQL = `
  SELECT
    indexed_through_block,
    lower(payload->>'indexedThroughBlockHash') AS checkpoint_hash
  FROM proof_indexer.ledger_snapshots
  WHERE network = $1
    AND indexed_through_block IS NOT NULL
    AND NOT (source_hashes ? 'canonicalSummary')
    AND source_hashes ? 'blockScan'
    AND payload->>'source' = 'proof-indexer-block-scan'
    AND consistency->>'status' IN ('block-scan-current', 'block-scan-partial')
    AND payload->>'indexedThroughBlockHash' ~* '^[0-9a-f]{64}$'
    AND source_hashes->>'blockScan' ~* '^[0-9a-f]{64}$'
    AND lower(source_hashes->>'blockScan') =
      lower(payload->>'indexedThroughBlockHash')
  ORDER BY indexed_through_block DESC, generated_at DESC
  LIMIT 1
`;

async function readCanonicalWorkerProgress(pool, network = NETWORK) {
  const result = await pool.query(
    AUTHORITATIVE_WORKER_CHECKPOINT_SQL,
    [network],
  );
  return normalizedCheckpoint({
    checkpointHash: result.rows[0]?.checkpoint_hash,
    checkpointHeight: result.rows[0]?.indexed_through_block,
  });
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

function pendingDropConfirmationMs(value) {
  const configured = Number(value);
  return Math.max(
    5 * 60_000,
    Number.isFinite(configured) ? configured : 5 * 60_000,
  );
}

function authoritativeDroppedStatusEvidence(payload) {
  const requiredSources = [
    "bitcoin-core:getrawtransaction",
    "bitcoin-core:getmempoolentry",
    "bitcoin-core:getblockchaininfo",
    "bitcoin-core:getindexinfo:txindex",
  ];
  const sources = Array.isArray(payload?.sources)
    ? payload.sources.map((source) => String(source))
    : [];
  return (
    payload?.absenceProven === true &&
    payload?.contract === "proof-of-work-tx-status-v2" &&
    payload?.reason ===
      "absent-from-synced-unpruned-mainnet-bitcoin-core-txindex-and-mempool" &&
    sources.length === requiredSources.length &&
    requiredSources.every((source) => sources.includes(source))
  );
}

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
    !authoritativeDroppedStatusEvidence(payload)
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

  const evidence = {
    absenceCount: 0,
    absenceProven:
      normalizedStatus === "dropped" ? payload.absenceProven : undefined,
    contract: payload.contract,
    observedAt: payload.observedAt,
    reason: payload.reason ?? undefined,
    sources: sourceList,
    status: normalizedStatus,
  };
  if (normalizedStatus === "confirmed") {
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
    return { applied: false, reason: "canonical-block-scan-required" };
  }

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
              - 'timestamp'
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
              'timestamp', CASE
                WHEN event_time IS NULL
                  OR event_time < TIMESTAMPTZ '2009-01-03 18:15:05+00'
                THEN to_timestamp($3::double precision / 1000)
                ELSE LEAST(
                  event_time,
                  to_timestamp($3::double precision / 1000)
                )
              END,
              'dropped', false,
              'status', 'pending'
            ),
          updated_at = now()
        WHERE network = $1 AND txid = $2 AND status = 'pending'
          AND (
            block_height IS NOT NULL
            OR block_time IS NOT NULL
            OR event_time IS DISTINCT FROM CASE
              WHEN event_time IS NULL
                OR event_time < TIMESTAMPTZ '2009-01-03 18:15:05+00'
              THEN to_timestamp($3::double precision / 1000)
              ELSE LEAST(
                event_time,
                to_timestamp($3::double precision / 1000)
              )
            END
            OR payload ?| ARRAY[
              'blockHash',
              'blockHeight',
              'blockTime',
              'height',
              '_powBlockHash',
              '_powBlockIndex'
            ]
            OR payload->'confirmed' IS DISTINCT FROM 'false'::jsonb
            OR payload->'dropped' IS DISTINCT FROM 'false'::jsonb
            OR payload->>'status' IS DISTINCT FROM 'pending'
            OR payload->'createdAt' IS DISTINCT FROM to_jsonb(
              CASE
                WHEN event_time IS NULL
                  OR event_time < TIMESTAMPTZ '2009-01-03 18:15:05+00'
                THEN to_timestamp($3::double precision / 1000)
                ELSE LEAST(
                  event_time,
                  to_timestamp($3::double precision / 1000)
                )
              END
            )
            OR payload->'timestamp' IS DISTINCT FROM to_jsonb(
              CASE
                WHEN event_time IS NULL
                  OR event_time < TIMESTAMPTZ '2009-01-03 18:15:05+00'
                THEN to_timestamp($3::double precision / 1000)
                ELSE LEAST(
                  event_time,
                  to_timestamp($3::double precision / 1000)
                )
              END
            )
          )
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
            (
              message
              - 'blockHash'
              - 'blockHeight'
              - 'blockTime'
              - 'height'
              - 'createdAt'
              - 'timestamp'
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
              'timestamp', CASE
                WHEN event_time IS NULL
                  OR event_time < TIMESTAMPTZ '2009-01-03 18:15:05+00'
                THEN to_timestamp($3::double precision / 1000)
                ELSE LEAST(
                  event_time,
                  to_timestamp($3::double precision / 1000)
                )
              END,
              'dropped', false,
              'status', 'pending'
            )
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
            (
              metadata
              - 'blockHash'
              - 'blockHeight'
              - 'blockTime'
              - 'height'
              - 'createdAt'
              - 'timestamp'
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
              'timestamp', CASE
                WHEN event_time IS NULL
                  OR event_time < TIMESTAMPTZ '2009-01-03 18:15:05+00'
                THEN to_timestamp($3::double precision / 1000)
                ELSE LEAST(
                  event_time,
                  to_timestamp($3::double precision / 1000)
                )
              END,
              'dropped', false,
              'status', 'pending'
            )
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
  const priorAbsenceStartedAtMs = Date.parse(
    priorObservation?.absenceStartedAt ?? "",
  );
  const consecutiveAbsence =
    priorObservation?.status === "dropped" &&
    authoritativeDroppedStatusEvidence(priorObservation) &&
    Number.isSafeInteger(priorAbsenceCount) &&
    priorAbsenceCount > 0 &&
    Number.isFinite(priorObservedAtMs) &&
    Number.isFinite(priorAbsenceStartedAtMs) &&
    priorAbsenceStartedAtMs <= priorObservedAtMs &&
    observedAtMs >= priorObservedAtMs;
  const absenceStartedAtMs = consecutiveAbsence
    ? priorAbsenceStartedAtMs
    : observedAtMs;
  evidence.absenceCount = consecutiveAbsence ? priorAbsenceCount + 1 : 1;
  evidence.absenceStartedAt = new Date(absenceStartedAtMs).toISOString();
  const repeatedAbsence =
    consecutiveAbsence &&
    observedAtMs >= absenceStartedAtMs + PENDING_DROP_CONFIRMATION_MS;

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
          || jsonb_build_object(
            'confirmed', false,
            'dropped', true,
            'status', 'dropped'
          ),
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
          || jsonb_build_object(
            'confirmed', false,
            'dropped', true,
            'status', 'dropped'
          )
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
          || jsonb_build_object(
            'confirmed', false,
            'dropped', true,
            'status', 'dropped'
          )
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

async function runCycle(pool, lastSuccess, runtime) {
  const startedAt = new Date();
  const noProgress = runtime.noProgress;
  await assertWorkAtomicProjectionReady(pool);
  await writeWorkerMeta(pool, {
    apiBase: API_BASE,
    lastSuccess,
    lastSuccessAt: lastSuccess?.finishedAt ?? null,
    network: NETWORK,
    noProgress,
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

  await runBackfillWithRetries(backfillEnv, runtime);
  const canonicalProgress = await readCanonicalWorkerProgress(
    pool,
    runtime.network,
  );
  const clearedNoProgress = resetWorkerNoProgressState(
    noProgress,
    canonicalProgress,
    Date.now(),
    "canonical-scan-success",
    runtime.network,
  );
  runtime.noProgress = clearedNoProgress;
  await writeWorkerMeta(pool, {
    apiBase: API_BASE,
    canonicalProgress,
    consecutiveFailures: 0,
    lastSuccess,
    lastSuccessAt: lastSuccess?.finishedAt ?? null,
    network: runtime.network,
    noProgress: clearedNoProgress,
    ok: Boolean(lastSuccess),
    startedAt: startedAt.toISOString(),
    state: "canonical-scan-complete",
  });
  if (runtime.stopping) {
    throw workerStoppingError();
  }
  const pendingStatus = await refreshPendingStatuses(pool);

  const nowMs = Date.now();
  const runParityNow =
    !runtime.stopping &&
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
        runtime,
        timeoutMs: PARITY_CHILD_TIMEOUT_MS,
      });
      lastParityAtMs = Date.now();
    } catch (error) {
      if (runtime.stopping || error?.code === "POW_INDEX_WORKER_STOPPING") {
        throw workerStoppingError();
      }
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
    canonicalProgress,
    consecutiveFailures: 0,
    durationMs: currentSuccess.durationMs,
    finishedAt: currentSuccess.finishedAt,
    holders: INCLUDE_HOLDERS,
    lastSuccess: currentSuccess,
    lastSuccessAt: currentSuccess.finishedAt,
    network: runtime.network,
    noProgress: clearedNoProgress,
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
  return {
    canonicalProgress,
    lastSuccess: currentSuccess,
    noProgress: clearedNoProgress,
  };
}

export async function runWorkerMain() {
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
          backfillTimeoutMs: BACKFILL_CHILD_TIMEOUT_MS,
          backfillRetries: BACKFILL_RETRIES,
          backfillRetryDelayMs: BACKFILL_RETRY_DELAY_MS,
          dryRun: true,
          errorIntervalMs: ERROR_INTERVAL_MS,
          holders: INCLUDE_HOLDERS,
          intervalMs: INTERVAL_MS,
          maxConsecutiveFailures: MAX_CONSECUTIVE_FAILURES,
          maxErrorIntervalMs: MAX_ERROR_INTERVAL_MS,
          network: NETWORK,
          noProgressAlertIntervalMs: NO_PROGRESS_ALERT_INTERVAL_MS,
          noProgressPolicy: "fail-closed-contained-retry",
          once: ONCE,
          parity: RUN_PARITY,
          parityIntervalMs: PARITY_INTERVAL_MS,
          parityTimeoutMs: PARITY_CHILD_TIMEOUT_MS,
          pendingAfterCanonicalScan: true,
          pendingDropConfirmationMs: PENDING_DROP_CONFIRMATION_MS,
          pendingMinAgeMs: PENDING_MIN_AGE_MS,
          pendingStatusBudgetMs: PENDING_STATUS_BUDGET_MS,
          pendingStatusConcurrency: PENDING_STATUS_CONCURRENCY,
          pendingStatusLimit: PENDING_STATUS_LIMIT,
          requireWorkAtomicProjection: REQUIRE_WORK_ATOMIC_PROJECTION,
          statusTimeoutMs: STATUS_REQUEST_TIMEOUT_MS,
        },
        null,
        2,
      ),
    );
    return;
  }

  const pool = createProofIndexPool({
    env: {
      ...process.env,
      POW_INDEX_DB_APP_NAME:
      process.env.POW_INDEX_DB_APP_NAME ?? "proof-indexer-worker",
    },
  });
  const runtime = createWorkerRuntime(NETWORK);
  const onSignal = () => requestWorkerStop(runtime);
  for (const signal of ["SIGINT", "SIGTERM"]) {
    process.on(signal, onSignal);
  }

  try {
    const previousMeta = await readWorkerMeta(pool).catch(() => null);
    runtime.noProgress = workerNoProgressFromMeta(previousMeta, runtime.network);
    let lastSuccess = lastSuccessFromMeta(previousMeta);
    let consecutiveFailures = Math.max(
      0,
      Math.trunc(Number(runtime.noProgress?.repeatCount ?? 0)) || 0,
    );
    await writeWorkerMeta(pool, {
      apiBase: API_BASE,
      lastSuccess,
      lastSuccessAt: lastSuccess?.finishedAt ?? null,
      network: runtime.network,
      noProgress: runtime.noProgress,
      ok: Boolean(lastSuccess),
      startedAt: new Date().toISOString(),
      state: "starting",
    });
    while (!runtime.stopping) {
      try {
        const cycle = await runCycle(pool, lastSuccess, runtime);
        lastSuccess = cycle.lastSuccess;
        runtime.noProgress = cycle.noProgress;
        consecutiveFailures = 0;
        if (ONCE || runtime.stopping) {
          break;
        }
        await workerSleep(runtime, INTERVAL_MS);
      } catch (error) {
        if (
          runtime.stopping ||
          error?.code === "POW_INDEX_WORKER_STOPPING"
        ) {
          break;
        }
        consecutiveFailures += 1;
        const nowMs = Date.now();
        const canonicalFailure = canonicalWorkerFailureFromError(error);
        const canonicalProgress = await readCanonicalWorkerProgress(
          pool,
          runtime.network,
        ).catch((checkpointError) => {
          console.error(
            JSON.stringify({
              error: cappedChildError(
                checkpointError?.message ?? checkpointError,
              ),
              network: runtime.network,
              phase: "worker-checkpoint-read",
            }),
          );
          return normalizedCheckpoint(null);
        });
        const containedCanonicalFailure = containableCanonicalFailure(
          canonicalFailure,
          canonicalProgress,
        );
        let retryDelayMs = exponentialRetryDelayMs(consecutiveFailures);
        let alertEmitted = false;
        if (containedCanonicalFailure) {
          runtime.noProgress = nextWorkerNoProgressState(runtime.noProgress, {
            failure: containedCanonicalFailure,
            network: runtime.network,
            progress: canonicalProgress,
            nowMs,
          });
          retryDelayMs = runtime.noProgress.retryDelayMs;
          if (runtime.noProgress.alertReady) {
            alertEmitted = true;
            console.error(
              JSON.stringify({
                ...runtime.noProgress,
                alert: "proof-index-worker-no-progress",
                alertReady: true,
                canonicalPhase: runtime.noProgress.phase,
                phase: "worker-containment-alert",
              }),
            );
            runtime.noProgress = markWorkerNoProgressAlerted(
              runtime.noProgress,
              nowMs,
            );
          }
        }
        const escalating = shouldEscalateWorkerFailure(
          containedCanonicalFailure,
          consecutiveFailures,
        );
        const retrying = !ONCE && !runtime.stopping && !escalating;
        const failedAt = new Date(nowMs).toISOString();
        const value = {
          alertEmitted,
          apiBase: API_BASE,
          canonicalFailure,
          containmentEligible: Boolean(containedCanonicalFailure),
          canonicalProgress,
          consecutiveFailures,
          error: cappedChildError(error?.message ?? error),
          failedAt,
          lastSuccess,
          lastSuccessAt: lastSuccess?.finishedAt ?? null,
          maxConsecutiveFailures: MAX_CONSECUTIVE_FAILURES,
          network: runtime.network,
          nextRetryAt: retrying
            ? new Date(nowMs + retryDelayMs).toISOString()
            : null,
          noProgress: runtime.noProgress,
          ok: false,
          retryDelayMs,
          retrying,
          state: containedCanonicalFailure && runtime.noProgress?.active
            ? "contained-no-progress"
            : escalating
              ? "failed-escalating"
              : "failed-retrying",
        };
        console.error(JSON.stringify({ phase: "worker-cycle", ...value }));
        await writeWorkerMeta(pool, value);
        if (ONCE) {
          throw error;
        }
        if (
          !containedCanonicalFailure &&
          consecutiveFailures >= MAX_CONSECUTIVE_FAILURES
        ) {
          throw error;
        }
        await workerSleep(runtime, retryDelayMs);
      }
    }
  } finally {
    requestWorkerStop(runtime);
    for (const signal of ["SIGINT", "SIGTERM"]) {
      process.off(signal, onSignal);
    }
    await pool.end();
  }
}

const invokedDirectly =
  process.argv[1] &&
  path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));
if (invokedDirectly) {
  await runWorkerMain();
}
