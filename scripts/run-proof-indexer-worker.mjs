import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { createProofIndexPool } from "../server/db/postgres.mjs";
import {
  WORK_ATOMIC_PROJECTION_MODEL,
  WORK_DECIMALS,
  WORK_PRECISION_V2_MIGRATION_META_KEY,
  WORK_PRECISION_V2_MIGRATION_MODEL,
  WORK_PRECISION_V2_MODEL,
  WORK_SUBATOM_DECIMALS,
  WORK_SUBATOM_PROJECTION_MODEL,
  WORK_SUBATOM_UNIT_SCALE_TEXT,
  WORK_TOKEN_ID,
  WORK_UNIT_SCALE_TEXT,
} from "../server/work-units.mjs";
import {
  WORK_AMO_V5_DECLARATION_AUTHORITY_SCRIPT_PUBKEY,
  WORK_AMO_V5_DECLARATION_MIN_PAYMENT_SATS,
  WORK_AMO_V5_DECLARATION_REGISTRY_ADDRESS,
  WORK_AMO_V5_NETWORK_ACCUMULATOR_MODEL,
  WORK_AMO_V5_PAYLOAD_COMMITMENT_MODEL,
  WORK_AMO_V5_STATE_COMMITMENT_MODEL,
  workAmoV5CanonicalPayloadCommitment,
} from "../server/work-amo-v5.mjs";
import {
  workPrecisionV2MarkerReady as sharedWorkPrecisionV2MarkerReady,
} from "../server/work-precision-v2-marker.mjs";
import {
  WORK_Q16_PENDING_PROJECTION_MODEL as WORK_AMO_V8_PENDING_PROJECTION_MODEL,
  workQ16PendingTransactionProjectionRows,
} from "../server/work-q16-pending-projection.mjs";
import {
  workPrecisionV2ConstraintAudit as sharedWorkPrecisionV2ConstraintAudit,
} from "../server/work-precision-v2-schema.mjs";
import {
  WORK_AMO_V6_BLOCK_SEQUENCER_MODEL,
} from "../server/work-amo-v6.mjs";
import {
  WORK_AMO_V8_AUTH_VERSION,
  WORK_AMO_V8_BLOCK_SEQUENCER_MODEL,
  WORK_AMO_V8_MINT_AMOUNT_SUBATOMS,
  WORK_AMO_V8_TOKEN_STATE_PREIMAGE_MODEL,
  WORK_AMO_V8_TRANSFER_VERSION,
  workAmoV8CanonicalTokenStateCommitment,
} from "../server/work-amo-v8.mjs";
import {
  workAmoV8DeclarationCommitment,
} from "../server/work-amo-v8-declaration.mjs";
import {
  WORK_AMO_V8_ACTIVATION_LATCH_META_KEY,
  WORK_AMO_V8_ACTIVATION_LATCH_MODEL,
  workAmoV8ActivationLatchReady as sharedWorkAmoV8ActivationLatchReady,
} from "../server/work-amo-v8-activation-latch.mjs";

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
export function pendingBackfillChildTimeoutMs(
  configured = process.env.POW_INDEX_WORKER_PENDING_BACKFILL_TIMEOUT_MS,
) {
  return Math.min(
    30_000,
    Math.max(
      20_000,
      Math.floor(Number(configured ?? 30_000) || 30_000),
    ),
  );
}
const PENDING_BACKFILL_CHILD_TIMEOUT_MS = pendingBackfillChildTimeoutMs();
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
const WORK_Q8_MAX_SUPPLY = "2100000000000000";
const WORK_Q8_MINT_AMOUNT = "100000000000";
const WORK_Q16_MAX_SUPPLY = "210000000000000000000000";
const WORK_Q16_MINT_AMOUNT = "10000000000000000000";
const WORK_PRECISION_V2_DECLARATION_EVIDENCE_MODEL =
  "canonical-work-precision-v2-declaration-core-index-evidence-v1";
const WORK_PRECISION_V2_DECLARATION_EVIDENCE_DOMAIN =
  "ProofOfWork.Me/WORK-PRECISION-V2-DECLARATION-EVIDENCE/v1";
const WORK_PRECISION_V2_SNAPSHOT_POLICY =
  "preserve-preactivation-canonical-invalidate-wrong-era-derived-require-post-migration-current-snapshot";
const WORK_PRECISION_V2_CONVERSION_FACTOR = "100000000";
const WORK_PRECISION_V2_RAW_HISTORY_POLICY = "none";
const WORK_PRECISION_V2_DERIVED_PROJECTION_POLICY =
  "invalidate-and-replay-from-activation";
const WORK_PRECISION_Q8_ERA = "q8";
const WORK_PRECISION_Q16_ERA = "q16";
const WORK_AMO_V8_PENDING_REBUILD_META_KEY =
  "workQ16PendingRebuild:livenet";
const WORK_AMO_V8_PENDING_REBUILD_MODEL =
  "canonical-work-q16-pending-rebuild-v2";
const WORK_AMO_V8_PENDING_MEMPOOL_MODEL =
  "canonical-core-mempool-txid-set-v1";
const WORK_AMO_V8_PENDING_MEMPOOL_DOMAIN =
  "ProofOfWork.Me/WORK-Q16-PENDING-MEMPOOL/v1";
const WORK_AMO_V8_PENDING_PROJECTION_DOMAIN_PREFIX =
  "ProofOfWork.Me/WORK-Q16-PENDING-";
const WORK_AMO_V8_PENDING_WITNESS_MAX_AGE_MS = Math.min(
  10 * 60_000,
  Math.max(
    60_000,
    Number(
      process.env.POW_INDEX_WORKER_PENDING_WITNESS_MAX_AGE_MS ??
        2 * 60_000,
    ) || 2 * 60_000,
  ),
);
const WORK_AMO_V8_EXPECTED_DECLARATION_COMMITMENT =
  workAmoV8DeclarationCommitment();
const WORK_PRECISION_CORE_RPC_TIMEOUT_MS = Math.min(
  30_000,
  Math.max(
    5_000,
    Number(process.env.POW_INDEX_WORKER_CORE_RPC_TIMEOUT_MS ?? 15_000) ||
      15_000,
  ),
);
const CHILD_LINE_BUFFER_CHARS = 16_384;
const CHILD_ERROR_MAX_CHARS = 4_096;
const CHILD_STOP_GRACE_MS = 5_000;
const PENDING_CHILD_STOP_GRACE_MS = 1_000;
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
    workPrecision: null,
    workPrecisionEra: "",
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

function objectRecord(value) {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value
    : {};
}

function normalizedLowerText(value) {
  return String(value ?? "").trim().toLowerCase();
}

function exactObjectKeys(value, expectedKeys) {
  const keys = Object.keys(objectRecord(value)).sort();
  return (
    keys.length === expectedKeys.length &&
    keys.every((key, index) => key === expectedKeys[index])
  );
}

function canonicalConfiguredInteger(value, { minimum = 0 } = {}) {
  const raw = String(value ?? "");
  const text = raw.trim();
  if (!/^(?:0|[1-9][0-9]*)$/u.test(text)) {
    return null;
  }
  if (raw !== text) {
    return null;
  }
  const parsed = Number(text);
  return Number.isSafeInteger(parsed) && parsed >= minimum ? parsed : null;
}

function canonicalConfiguredHash(value) {
  const raw = String(value ?? "");
  return /^[0-9a-f]{64}$/u.test(raw) ? raw : "";
}

function exactJsonInteger(value, { minimum = 0 } = {}) {
  return (
    typeof value === "number" &&
    Number.isSafeInteger(value) &&
    value >= minimum
  );
}

export function workerWorkAmoV8DeclarationConfig(env = process.env) {
  const declarationTxid = canonicalConfiguredHash(
    env.WORK_AMO_V8_DECLARATION_TXID,
  );
  const declarationHeight = canonicalConfiguredInteger(
    env.WORK_AMO_V8_DECLARATION_HEIGHT,
    { minimum: 1 },
  );
  const declarationBlockHash = canonicalConfiguredHash(
    env.WORK_AMO_V8_DECLARATION_BLOCK_HASH,
  );
  const declarationBlockIndex = canonicalConfiguredInteger(
    env.WORK_AMO_V8_DECLARATION_BLOCK_INDEX,
  );
  const declarationMemoSha256 = canonicalConfiguredHash(
    env.WORK_AMO_V8_DECLARATION_MEMO_SHA256,
  );
  const declarationMemoBytes = canonicalConfiguredInteger(
    env.WORK_AMO_V8_DECLARATION_MEMO_BYTES,
    { minimum: 1 },
  );
  const declarationProtocolVout = canonicalConfiguredInteger(
    env.WORK_AMO_V8_DECLARATION_PROTOCOL_VOUT,
  );
  const declarationRecordOrdinal = canonicalConfiguredInteger(
    env.WORK_AMO_V8_DECLARATION_RECORD_ORDINAL,
  );
  const declarationRegistryPaymentVout = canonicalConfiguredInteger(
    env.WORK_AMO_V8_DECLARATION_REGISTRY_PAYMENT_VOUT,
  );
  const configuredActivationHeight = canonicalConfiguredInteger(
    env.WORK_AMO_V8_ACTIVATION_HEIGHT,
    { minimum: 1 },
  );
  const rawWritesSource = String(
    env.WORK_AMO_V8_WRITES_ENABLED ?? "",
  );
  const rawWritesEnabled = rawWritesSource.trim();
  const writesEnabled = /^(?:1|true|yes)$/iu.test(rawWritesEnabled);
  const writesDisabled =
    rawWritesEnabled === "" ||
    /^(?:0|false|no)$/iu.test(rawWritesEnabled);
  const rawValues = [
    env.WORK_AMO_V8_DECLARATION_TXID,
    env.WORK_AMO_V8_DECLARATION_HEIGHT,
    env.WORK_AMO_V8_DECLARATION_BLOCK_HASH,
    env.WORK_AMO_V8_DECLARATION_BLOCK_INDEX,
    env.WORK_AMO_V8_DECLARATION_MEMO_SHA256,
    env.WORK_AMO_V8_DECLARATION_MEMO_BYTES,
    env.WORK_AMO_V8_DECLARATION_PROTOCOL_VOUT,
    env.WORK_AMO_V8_DECLARATION_RECORD_ORDINAL,
    env.WORK_AMO_V8_DECLARATION_REGISTRY_PAYMENT_VOUT,
    env.WORK_AMO_V8_ACTIVATION_HEIGHT,
  ].map((value) => String(value ?? ""));
  const requested =
    rawValues.some((value) => value !== "") ||
    writesEnabled ||
    !writesDisabled ||
    rawWritesSource !== rawWritesEnabled;
  const configured = Boolean(
    /^[0-9a-f]{64}$/u.test(declarationTxid) &&
      declarationHeight !== null &&
      declarationHeight < Number.MAX_SAFE_INTEGER &&
      configuredActivationHeight === declarationHeight + 1 &&
      /^[0-9a-f]{64}$/u.test(declarationBlockHash) &&
      declarationBlockIndex !== null &&
      /^[0-9a-f]{64}$/u.test(declarationMemoSha256) &&
      declarationMemoBytes ===
        WORK_AMO_V8_EXPECTED_DECLARATION_COMMITMENT.protocolRecordBytes &&
      declarationMemoSha256 ===
        WORK_AMO_V8_EXPECTED_DECLARATION_COMMITMENT.protocolRecordSha256 &&
      declarationProtocolVout !== null &&
      declarationRecordOrdinal === 0 &&
      declarationRegistryPaymentVout !== null,
  );
  return {
    activationHeight: configuredActivationHeight,
    configured,
    declarationBlockHash,
    declarationBlockIndex,
    declarationHeight,
    declarationMemoBytes,
    declarationMemoSha256,
    declarationProtocolVout,
    declarationRecordOrdinal,
    declarationRegistryPaymentVout,
    declarationTxid,
    requested,
    writesEnabled,
  };
}

function workPrecisionCommitmentShapeReady(value, { model = "" } = {}) {
  const commitment = objectRecord(value);
  return (
    (
      model === "" ||
      exactObjectKeys(
        commitment,
        ["model", "payloadBytes", "sha256"],
      )
    ) &&
    (model === "" || commitment.model === model) &&
    typeof commitment.payloadBytes === "number" &&
    Number.isSafeInteger(commitment.payloadBytes) &&
    commitment.payloadBytes > 0 &&
    /^[0-9a-f]{64}$/u.test(String(commitment.sha256 ?? "")) &&
    String(commitment.sha256) === normalizedLowerText(commitment.sha256)
  );
}

function workPrecisionRowsCommitmentShapeReady(value) {
  const commitment = objectRecord(value);
  return (
    exactObjectKeys(commitment, ["count", "payloadBytes", "sha256"]) &&
    typeof commitment.count === "number" &&
    Number.isSafeInteger(commitment.count) &&
    commitment.count >= 0 &&
    workPrecisionCommitmentShapeReady(commitment)
  );
}

function workerWorkPrecisionEvidenceCommitment(evidenceValue) {
  const evidence = objectRecord(evidenceValue);
  const committed = {
    authorityScriptPubKey: normalizedLowerText(
      evidence.authorityScriptPubKey,
    ),
    blockHash: normalizedLowerText(evidence.blockHash),
    blockHeight: Number(evidence.blockHeight),
    blockTransactionIndex: Number(evidence.blockTransactionIndex),
    inputCount: Number(evidence.inputCount),
    outputCount: Number(evidence.outputCount),
    payloadBytes: Number(evidence.payloadBytes),
    payloadSha256: normalizedLowerText(evidence.payloadSha256),
    protocol: String(evidence.protocol ?? ""),
    protocolVout: Number(evidence.protocolVout),
    recordOrdinal: Number(evidence.recordOrdinal),
    registryAddress: String(evidence.registryAddress ?? "").trim(),
    registryPaymentSats: String(evidence.registryPaymentSats ?? "").trim(),
    registryPaymentVout: Number(evidence.registryPaymentVout),
    txid: normalizedLowerText(evidence.txid),
  };
  return {
    committed,
    sha256: createHash("sha256")
      .update(
        Buffer.from(
          `${WORK_PRECISION_V2_DECLARATION_EVIDENCE_DOMAIN}\n${
            JSON.stringify(committed)
          }`,
          "utf8",
        ),
      )
      .digest("hex"),
  };
}

export function workerWorkPrecisionV2MarkerReady(
  markerValue,
  declarationConfig,
) {
  const marker = objectRecord(markerValue);
  const config = objectRecord(declarationConfig);
  const evidence = objectRecord(marker.declarationEvidence);
  const activationOpening = objectRecord(marker.activationOpening);
  const before = objectRecord(marker.before);
  const after = objectRecord(marker.after);
  const evidenceCommitment =
    workerWorkPrecisionEvidenceCommitment(evidence);
  const committedEvidence = evidenceCommitment.committed;
  const markerKeys = [
    "activationHeight",
    "activationOpening",
    "after",
    "before",
    "completedAt",
    "conversionFactor",
    "declarationBlockHash",
    "declarationBlockIndex",
    "declarationEvidence",
    "declarationHeight",
    "declarationMemoBytes",
    "declarationMemoSha256",
    "declarationProtocolVout",
    "declarationRecordOrdinal",
    "declarationRegistryPaymentVout",
    "declarationTextBytes",
    "declarationTextSha256",
    "declarationTxid",
    "decimals",
    "globalPrecisionModel",
    "derivedProjectionPolicy",
    "legacyDecimals",
    "legacyProjectionModel",
    "maxSupplySubatoms",
    "migrationModel",
    "mintAmountSubatoms",
    "model",
    "network",
    "projectionModel",
    "rawConfirmedHistoryMutation",
    "relicCutover",
    "replayFromHeight",
    "snapshotPolicy",
    "status",
    "transferVersion",
    "unitScale",
    "updatedAt",
    "version",
  ].sort();
  const evidenceKeys = [
    "authorityScriptPubKey",
    "blockHash",
    "blockHeight",
    "blockTransactionIndex",
    "commitmentSha256",
    "coreVerified",
    "evidenceComplete",
    "indexVerified",
    "inputCount",
    "model",
    "outputCount",
    "payloadBytes",
    "payloadSha256",
    "protocol",
    "protocolVout",
    "recordOrdinal",
    "registryAddress",
    "registryPaymentSats",
    "registryPaymentVout",
    "txid",
  ].sort();
  return Boolean(
    config.configured === true &&
      sharedWorkPrecisionV2MarkerReady(marker, config) &&
      exactObjectKeys(marker, markerKeys) &&
      exactObjectKeys(activationOpening, [
        "declarationClosingStatePayloadBytes",
        "declarationClosingStateSha256",
        "declarationTransitionModel",
        "legacyTokenStateCommitment",
        "subatomTokenStateCommitment",
      ]) &&
      exactObjectKeys(before, ["balances", "listings"]) &&
      exactObjectKeys(after, ["balances", "listings"]) &&
      exactObjectKeys(evidence, evidenceKeys) &&
      marker.model === WORK_PRECISION_V2_MIGRATION_MODEL &&
      marker.migrationModel === WORK_PRECISION_V2_MIGRATION_MODEL &&
      marker.status === "complete" &&
      marker.network === "livenet" &&
      marker.version === WORK_AMO_V8_AUTH_VERSION &&
      marker.globalPrecisionModel === WORK_PRECISION_V2_MODEL &&
      marker.projectionModel === WORK_SUBATOM_PROJECTION_MODEL &&
      marker.legacyProjectionModel === WORK_ATOMIC_PROJECTION_MODEL &&
      marker.transferVersion === WORK_AMO_V8_TRANSFER_VERSION &&
      marker.legacyDecimals === WORK_DECIMALS &&
      marker.decimals === WORK_SUBATOM_DECIMALS &&
      String(marker.conversionFactor ?? "") ===
        WORK_PRECISION_V2_CONVERSION_FACTOR &&
      String(marker.unitScale ?? "") === WORK_SUBATOM_UNIT_SCALE_TEXT &&
      String(marker.maxSupplySubatoms ?? "") === WORK_Q16_MAX_SUPPLY &&
      String(marker.mintAmountSubatoms ?? "") ===
        WORK_AMO_V8_MINT_AMOUNT_SUBATOMS.toString() &&
      marker.rawConfirmedHistoryMutation ===
        WORK_PRECISION_V2_RAW_HISTORY_POLICY &&
      marker.derivedProjectionPolicy ===
        WORK_PRECISION_V2_DERIVED_PROJECTION_POLICY &&
      marker.activationHeight === config.activationHeight &&
      marker.replayFromHeight === config.activationHeight &&
      marker.snapshotPolicy === WORK_PRECISION_V2_SNAPSHOT_POLICY &&
      marker.declarationTxid === config.declarationTxid &&
      marker.declarationHeight === config.declarationHeight &&
      marker.declarationBlockHash ===
        config.declarationBlockHash &&
      marker.declarationBlockIndex === config.declarationBlockIndex &&
      marker.declarationMemoBytes === config.declarationMemoBytes &&
      marker.declarationMemoSha256 ===
        config.declarationMemoSha256 &&
      marker.declarationProtocolVout ===
        config.declarationProtocolVout &&
      marker.declarationRecordOrdinal ===
        config.declarationRecordOrdinal &&
      marker.declarationRegistryPaymentVout ===
        config.declarationRegistryPaymentVout &&
      marker.declarationTextBytes ===
        WORK_AMO_V8_EXPECTED_DECLARATION_COMMITMENT.payloadBytes &&
      marker.declarationTextSha256 ===
        WORK_AMO_V8_EXPECTED_DECLARATION_COMMITMENT.payloadSha256 &&
      Number.isFinite(Date.parse(String(marker.completedAt ?? ""))) &&
      Number.isFinite(Date.parse(String(marker.updatedAt ?? ""))) &&
      activationOpening.declarationTransitionModel ===
        WORK_AMO_V6_BLOCK_SEQUENCER_MODEL &&
      exactJsonInteger(
        activationOpening.declarationClosingStatePayloadBytes,
        { minimum: 1 },
      ) &&
      /^[0-9a-f]{64}$/u.test(
        activationOpening.declarationClosingStateSha256,
      ) &&
      workPrecisionCommitmentShapeReady(
        activationOpening.legacyTokenStateCommitment,
        { model: WORK_AMO_V5_PAYLOAD_COMMITMENT_MODEL },
      ) &&
      workPrecisionCommitmentShapeReady(
        activationOpening.subatomTokenStateCommitment,
        { model: WORK_AMO_V5_PAYLOAD_COMMITMENT_MODEL },
      ) &&
      workPrecisionRowsCommitmentShapeReady(before.balances) &&
      workPrecisionRowsCommitmentShapeReady(before.listings) &&
      workPrecisionRowsCommitmentShapeReady(after.balances) &&
      workPrecisionRowsCommitmentShapeReady(after.listings) &&
      evidence.model ===
        WORK_PRECISION_V2_DECLARATION_EVIDENCE_MODEL &&
      evidence.coreVerified === true &&
      evidence.indexVerified === true &&
      evidence.evidenceComplete === true &&
      evidence.commitmentSha256 ===
        evidenceCommitment.sha256 &&
      exactJsonInteger(evidence.blockHeight, { minimum: 1 }) &&
      exactJsonInteger(evidence.blockTransactionIndex) &&
      exactJsonInteger(evidence.inputCount, { minimum: 1 }) &&
      exactJsonInteger(evidence.outputCount, { minimum: 1 }) &&
      exactJsonInteger(evidence.payloadBytes, { minimum: 1 }) &&
      exactJsonInteger(evidence.protocolVout) &&
      exactJsonInteger(evidence.recordOrdinal) &&
      exactJsonInteger(evidence.registryPaymentVout) &&
      evidence.authorityScriptPubKey ===
        normalizedLowerText(evidence.authorityScriptPubKey) &&
      evidence.blockHash === normalizedLowerText(evidence.blockHash) &&
      evidence.payloadSha256 ===
        normalizedLowerText(evidence.payloadSha256) &&
      evidence.txid === normalizedLowerText(evidence.txid) &&
      evidence.registryAddress ===
        String(evidence.registryAddress ?? "").trim() &&
      evidence.registryPaymentSats ===
        String(evidence.registryPaymentSats ?? "").trim() &&
      committedEvidence.authorityScriptPubKey ===
        WORK_AMO_V5_DECLARATION_AUTHORITY_SCRIPT_PUBKEY &&
      committedEvidence.txid === config.declarationTxid &&
      committedEvidence.blockHash === config.declarationBlockHash &&
      committedEvidence.blockHeight === config.declarationHeight &&
      committedEvidence.blockTransactionIndex ===
        config.declarationBlockIndex &&
      committedEvidence.payloadBytes === config.declarationMemoBytes &&
      committedEvidence.payloadSha256 ===
        config.declarationMemoSha256 &&
      committedEvidence.protocolVout === config.declarationProtocolVout &&
      committedEvidence.recordOrdinal ===
        config.declarationRecordOrdinal &&
      committedEvidence.protocol === "pwm1" &&
      committedEvidence.registryAddress ===
        WORK_AMO_V5_DECLARATION_REGISTRY_ADDRESS &&
      /^(?:0|[1-9][0-9]*)$/u.test(
        committedEvidence.registryPaymentSats,
      ) &&
      BigInt(committedEvidence.registryPaymentSats) >=
        BigInt(WORK_AMO_V5_DECLARATION_MIN_PAYMENT_SATS) &&
      committedEvidence.registryPaymentVout ===
        config.declarationRegistryPaymentVout
  );
}

export function workerWorkAmoV8ActivationLatchReady(
  latchValue,
  declarationConfig,
) {
  const config = objectRecord(declarationConfig);
  return Boolean(
    config.configured === true &&
      sharedWorkAmoV8ActivationLatchReady(
        latchValue,
        config,
        { network: "livenet" },
      )
  );
}

export function workerWorkPrecisionEra({
  activationLatch,
  declarationConfig,
  definition,
  marker,
  observedHeight,
  q16Latched = false,
  tipHeight,
} = {}) {
  const config = objectRecord(declarationConfig);
  const row = objectRecord(definition);
  const metadata = objectRecord(row.metadata);
  const observed = Math.max(
    Number.isSafeInteger(Number(observedHeight))
      ? Number(observedHeight)
      : 0,
    Number.isSafeInteger(Number(tipHeight)) ? Number(tipHeight) : 0,
  );
  const boundaryReached =
    config.configured === true &&
    Number.isSafeInteger(Number(config.activationHeight)) &&
    observed >= Number(config.activationHeight);
  const q16StatePresent =
    Object.keys(objectRecord(activationLatch)).length > 0 ||
    Object.keys(objectRecord(marker)).length > 0 ||
    metadata.amountStorageModel === WORK_SUBATOM_PROJECTION_MODEL ||
    metadata.precisionModel === WORK_PRECISION_V2_MODEL ||
    String(row.max_supply ?? "") === WORK_Q16_MAX_SUPPLY ||
    String(row.mint_amount ?? "") === WORK_Q16_MINT_AMOUNT;
  return q16Latched || boundaryReached || q16StatePresent
    ? WORK_PRECISION_Q16_ERA
    : WORK_PRECISION_Q8_ERA;
}

async function readWorkerWorkPrecisionState(pool) {
  const result = await pool.query(
    `
      SELECT
        (
          SELECT jsonb_build_object(
            'max_supply', definition.max_supply::text,
            'mint_amount', definition.mint_amount::text,
            'metadata', definition.metadata
          )
          FROM proof_indexer.credit_definitions definition
          WHERE definition.network = $1
            AND definition.token_id = $2
          LIMIT 1
        ) AS definition,
        (
          SELECT value
          FROM proof_indexer.meta
          WHERE key = $3
          LIMIT 1
        ) AS migration_marker,
        (
          SELECT value
          FROM proof_indexer.meta
          WHERE key = $4
          LIMIT 1
        ) AS activation_latch,
        (
          SELECT COALESCE(max(height), 0)::integer
          FROM proof_indexer.blocks
          WHERE network = $1 AND canonical = true
        ) AS tip_height,
        (
          SELECT COALESCE(max(height), 0)::integer
          FROM proof_indexer.blocks
          WHERE network = $1
        ) AS observed_height
    `,
    [
      NETWORK,
      WORK_TOKEN_ID,
      WORK_PRECISION_V2_MIGRATION_META_KEY,
      WORK_AMO_V8_ACTIVATION_LATCH_META_KEY,
    ],
  );
  const row = result.rows[0] ?? {};
  return {
    activationLatch: objectRecord(row.activation_latch),
    definition: objectRecord(row.definition),
    marker: objectRecord(row.migration_marker),
    observedHeight: Number(row.observed_height ?? 0),
    tipHeight: Number(row.tip_height ?? 0),
  };
}

async function assertWorkAtomicProjectionReady(
  pool,
  { q16Latched = false } = {},
) {
  if (!REQUIRE_WORK_ATOMIC_PROJECTION) {
    if (NETWORK === "livenet") {
      throw new Error(
        "Proof index worker refuses to disable exact WORK precision readiness on livenet.",
      );
    }
    return {
      activationHeight: null,
      era: "unchecked",
      replayRequired: false,
    };
  }
  const declarationConfig = workerWorkAmoV8DeclarationConfig();
  if (
    declarationConfig.requested === true &&
    declarationConfig.configured !== true
  ) {
    throw new Error(
      "Proof index worker is paused because the AMO V8 declaration pins are partial or do not match the compiled declaration.",
    );
  }
  const state = await readWorkerWorkPrecisionState(pool);
  if (Object.keys(state.definition).length === 0) {
    const missingDefinitionEra = workerWorkPrecisionEra({
      activationLatch: state.activationLatch,
      declarationConfig,
      definition: state.definition,
      marker: state.marker,
      observedHeight: state.observedHeight,
      q16Latched,
      tipHeight: state.tipHeight,
    });
    const error = new Error(
      "Proof index worker is paused because the canonical WORK definition is missing.",
    );
    if (missingDefinitionEra === WORK_PRECISION_Q16_ERA) {
      error.workPrecision = {
        activationHeight: declarationConfig.activationHeight,
        declarationBlockHash: declarationConfig.declarationBlockHash,
        declarationConfigured: declarationConfig.configured,
        declarationHeight: declarationConfig.declarationHeight,
        declarationTxid: declarationConfig.declarationTxid,
        era: WORK_PRECISION_Q16_ERA,
        observedHeight: state.observedHeight,
        ready: false,
        replayRequired: true,
        tipHeight: state.tipHeight,
      };
    }
    throw error;
  }
  const era = workerWorkPrecisionEra({
    activationLatch: state.activationLatch,
    declarationConfig,
    definition: state.definition,
    marker: state.marker,
    observedHeight: state.observedHeight,
    q16Latched,
    tipHeight: state.tipHeight,
  });
  const metadata = objectRecord(state.definition.metadata);
  if (era === WORK_PRECISION_Q8_ERA) {
    if (
      String(state.definition.max_supply ?? "") !== WORK_Q8_MAX_SUPPLY ||
      String(state.definition.mint_amount ?? "") !== WORK_Q8_MINT_AMOUNT ||
      metadata.amountStorageModel !== WORK_ATOMIC_PROJECTION_MODEL ||
      Number(metadata.decimals) !== WORK_DECIMALS ||
      String(metadata.unitScale ?? "") !== WORK_UNIT_SCALE_TEXT ||
      Object.keys(state.marker).length > 0 ||
      Object.keys(state.activationLatch).length > 0
    ) {
      throw new Error(
        "Proof index worker is paused until the exact pre-activation WORK Q8 projection is restored.",
      );
    }
    return {
      activationHeight: declarationConfig.activationHeight,
      declarationConfigured: declarationConfig.configured,
      era,
      observedHeight: state.observedHeight,
      replayRequired: false,
      tipHeight: state.tipHeight,
    };
  }
  if (
    declarationConfig.configured !== true ||
    String(state.definition.max_supply ?? "") !== WORK_Q16_MAX_SUPPLY ||
    String(state.definition.mint_amount ?? "") !== WORK_Q16_MINT_AMOUNT ||
    metadata.amountStorageModel !== WORK_SUBATOM_PROJECTION_MODEL ||
    Number(metadata.decimals) !== WORK_SUBATOM_DECIMALS ||
    String(metadata.unitScale ?? "") !== WORK_SUBATOM_UNIT_SCALE_TEXT ||
    metadata.precisionModel !== WORK_PRECISION_V2_MODEL ||
    metadata.precisionMigrationModel !==
      WORK_PRECISION_V2_MIGRATION_MODEL ||
    !workerWorkAmoV8ActivationLatchReady(
      state.activationLatch,
      declarationConfig,
    ) ||
    !workerWorkPrecisionV2MarkerReady(
      state.marker,
      declarationConfig,
    )
  ) {
    const error = new Error(
      "Proof index worker is fail-closed at the AMO V8 boundary until the exact Q16 definition and immutable precision migration marker are installed.",
    );
    error.workPrecision = {
      activationHeight: declarationConfig.activationHeight,
      declarationBlockHash: declarationConfig.declarationBlockHash,
      declarationConfigured: declarationConfig.configured,
      declarationHeight: declarationConfig.declarationHeight,
      declarationTxid: declarationConfig.declarationTxid,
      era: WORK_PRECISION_Q16_ERA,
      observedHeight: state.observedHeight,
      ready: false,
      replayRequired: true,
      tipHeight: state.tipHeight,
    };
    throw error;
  }
  return {
    activationHeight: declarationConfig.activationHeight,
    declarationConfigured: true,
    declarationBlockHash: declarationConfig.declarationBlockHash,
    declarationHeight: declarationConfig.declarationHeight,
    declarationTxid: declarationConfig.declarationTxid,
    era,
    activationLatch: state.activationLatch,
    markerCompletedAt: state.marker.completedAt,
    openingTokenStateCommitment: objectRecord(
      state.marker.activationOpening,
    ).subatomTokenStateCommitment,
    observedHeight: state.observedHeight,
    replayRequired: true,
    tipHeight: state.tipHeight,
  };
}

async function assertAmoPositionSchemaReady(
  pool,
  { activationHeight = null, era = WORK_PRECISION_Q8_ERA } = {},
) {
  const result = await pool.query(
    `
      SELECT
        to_regclass('proof_indexer.work_usd_quotes') IS NOT NULL
          AS quotes_ready,
        to_regclass('proof_indexer.work_amo_listing_terms') IS NOT NULL
          AS listing_terms_ready,
        to_regclass('proof_indexer.work_amo_v6_listing_terms') IS NOT NULL
          AS v6_listing_terms_ready,
        to_regclass('proof_indexer.work_amo_v6_attestations') IS NULL
          AS v6_legacy_attestations_absent,
        to_regprocedure(
          'proof_indexer.valid_work_amo_v6_sources(jsonb,integer,bigint,integer)'
        ) IS NULL AS v6_legacy_source_validator_absent,
        to_regclass('proof_indexer.work_amo_block_transitions') IS NOT NULL
          AS block_transitions_ready,
        (
          SELECT count(*) = 4
          FROM information_schema.columns
          WHERE table_schema = 'proof_indexer'
            AND table_name = 'work_usd_quotes'
            AND column_name IN (
              'record_count',
              'registry_address',
              'registry_payment_sats',
              'registry_payment_vout'
            )
        ) AS quote_evidence_ready,
        (
          SELECT count(*) = 17
          FROM information_schema.columns
          WHERE table_schema = 'proof_indexer'
            AND table_name = 'work_amo_v6_listing_terms'
            AND column_name IN (
              'listing_id',
              'listing_txid',
              'token_id',
              'authorization_version',
              'unit_face_proofs',
              'unit_amount_atoms',
              'unit_price_sats',
              'unit_minimum_price_sats',
              'listing_network_value_before_q8',
              'listing_block_height',
              'listing_block_hash',
              'listing_block_index',
              'listing_protocol_vout',
              'listing_record_ordinal',
              'listing_bond_contribution_q8',
              'listing_network_value_after_q8',
              'frozen_terms'
            )
        ) AND (
          SELECT count(*) = 19
          FROM information_schema.columns
          WHERE table_schema = 'proof_indexer'
            AND table_name = 'work_amo_v6_listing_terms'
        ) AND NOT EXISTS (
          SELECT 1
          FROM information_schema.columns
          WHERE table_schema = 'proof_indexer'
            AND table_name = 'work_amo_v6_listing_terms'
            AND (
              column_name = 'unit_face_usd_cents'
              OR column_name LIKE 'unit_usd_%'
            )
        ) AS v6_listing_terms_evidence_ready,
        (
          SELECT count(*) = 4
          FROM pg_constraint constraint_row
          JOIN pg_class relation
            ON relation.oid = constraint_row.conrelid
          JOIN pg_namespace namespace
            ON namespace.oid = relation.relnamespace
          WHERE namespace.nspname = 'proof_indexer'
            AND relation.relname = 'work_amo_v6_listing_terms'
            AND constraint_row.contype = 'c'
            AND constraint_row.convalidated = true
            AND constraint_row.conname IN (
              'work_amo_v6_terms_identity',
              'work_amo_v6_terms_values',
              'work_amo_v6_terms_positions',
              'work_amo_v6_terms_frozen_payload'
            )
        ) AS v6_policy_constraints_ready,
        (
          SELECT count(*) = 22
          FROM information_schema.columns
          WHERE table_schema = 'proof_indexer'
            AND table_name = 'work_amo_block_transitions'
            AND column_name IN (
              'block_height',
              'block_hash',
              'previous_block_hash',
              'model',
              'state_commitment_model',
              'opening_network_value_q8',
              'closing_network_value_q8',
              'opening_state_sha256',
              'closing_state_sha256',
              'opening_state_payload_bytes',
              'closing_state_payload_bytes',
              'protocol_record_count',
              'raw_protocol_candidate_count',
              'transaction_count',
              'event_count',
              'event_set_model',
              'event_set_sha256',
              'event_set_payload_bytes',
              'block_atomic',
              'fee_once',
              'invalid_zero',
              'complete'
            )
        ) AS block_transition_evidence_ready,
        EXISTS (
          SELECT 1
          FROM information_schema.columns
          WHERE table_schema = 'proof_indexer'
            AND table_name = 'transactions'
            AND column_name = 'block_index'
        ) AS transaction_position_ready,
        (
          SELECT count(*) = 3
          FROM information_schema.columns
          WHERE table_schema = 'proof_indexer'
            AND table_name = 'events'
            AND column_name IN (
              'block_index',
              'op_return_vout',
              'record_ordinal'
            )
        ) AS event_position_ready,
        (
          SELECT count(*) = 4
          FROM information_schema.columns
          WHERE table_schema = 'proof_indexer'
            AND (
              (
                table_name = 'events'
                AND column_name = 'record_ordinal'
              )
              OR (
                table_name = 'work_usd_quotes'
                AND column_name = 'record_ordinal'
              )
              OR (
                table_name = 'work_amo_listing_terms'
                AND column_name = 'listing_record_ordinal'
              )
              OR (
                table_name = 'work_amo_v6_listing_terms'
                AND column_name = 'listing_record_ordinal'
              )
            )
            AND is_nullable = 'NO'
            AND column_default IS NULL
        ) AS ordinal_constraints_ready,
        EXISTS (
          SELECT 1
          FROM pg_trigger trigger_row
          JOIN pg_class relation
            ON relation.oid = trigger_row.tgrelid
          JOIN pg_namespace namespace
            ON namespace.oid = relation.relnamespace
          WHERE namespace.nspname = 'proof_indexer'
            AND relation.relname = 'work_amo_v6_listing_terms'
            AND trigger_row.tgname =
              'work_amo_v6_listing_terms_immutable'
            AND trigger_row.tgenabled <> 'D'
            AND trigger_row.tgisinternal = false
        ) AS v6_immutability_ready,
        EXISTS (
          SELECT 1
          FROM pg_trigger trigger_row
          JOIN pg_class relation
            ON relation.oid = trigger_row.tgrelid
          JOIN pg_namespace namespace
            ON namespace.oid = relation.relnamespace
          WHERE namespace.nspname = 'proof_indexer'
            AND relation.relname = 'meta'
            AND trigger_row.tgname =
              'work_amo_v6_migration_marker_immutable'
            AND trigger_row.tgenabled <> 'D'
            AND trigger_row.tgisinternal = false
        ) AS v6_marker_immutability_ready,
        EXISTS (
          SELECT 1
          FROM pg_indexes
          WHERE schemaname = 'proof_indexer'
            AND tablename = 'events'
            AND indexname =
              'events_confirmed_governed_position_uidx'
        ) AS governed_position_unique_ready,
        to_regclass('proof_indexer.work_amo_v8_listing_terms') IS NOT NULL
          AS v7_listing_terms_ready,
        (
          SELECT count(*) = 17
          FROM information_schema.columns
          WHERE table_schema = 'proof_indexer'
            AND table_name = 'work_amo_v8_listing_terms'
            AND column_name IN (
              'listing_id',
              'listing_txid',
              'token_id',
              'authorization_version',
              'unit_face_proofs',
              'unit_amount_subatoms',
              'unit_price_sats',
              'unit_minimum_price_sats',
              'listing_network_value_before_q8',
              'listing_block_height',
              'listing_block_hash',
              'listing_block_index',
              'listing_protocol_vout',
              'listing_record_ordinal',
              'listing_bond_contribution_q8',
              'listing_network_value_after_q8',
              'frozen_terms'
            )
        ) AND (
          SELECT count(*) = 19
          FROM information_schema.columns
          WHERE table_schema = 'proof_indexer'
            AND table_name = 'work_amo_v8_listing_terms'
        ) AND NOT EXISTS (
          SELECT 1
          FROM information_schema.columns
          WHERE table_schema = 'proof_indexer'
            AND table_name = 'work_amo_v8_listing_terms'
            AND column_name = 'unit_amount_atoms'
        ) AS v7_listing_terms_evidence_ready,
        (
          SELECT count(*) = 5
          FROM pg_constraint constraint_row
          JOIN pg_class relation
            ON relation.oid = constraint_row.conrelid
          JOIN pg_namespace namespace
            ON namespace.oid = relation.relnamespace
          WHERE namespace.nspname = 'proof_indexer'
            AND relation.relname = 'work_amo_v8_listing_terms'
            AND constraint_row.contype = 'c'
            AND constraint_row.convalidated = true
            AND constraint_row.conname IN (
              'work_amo_v8_terms_identity',
              'work_amo_v8_terms_values',
              'work_amo_v8_terms_positions',
              'work_amo_v8_terms_frozen_payload',
              'work_amo_v8_terms_activation'
            )
        ) AS v7_policy_constraints_ready,
        (
          SELECT pg_get_constraintdef(constraint_row.oid)
          FROM pg_constraint constraint_row
          WHERE constraint_row.conrelid =
              'proof_indexer.work_amo_v8_listing_terms'::regclass
            AND constraint_row.conname =
              'work_amo_v8_terms_identity'
            AND constraint_row.convalidated = true
          LIMIT 1
        ) AS v8_identity_constraint,
        (
          SELECT pg_get_constraintdef(constraint_row.oid)
          FROM pg_constraint constraint_row
          WHERE constraint_row.conrelid =
              'proof_indexer.work_amo_v8_listing_terms'::regclass
            AND constraint_row.conname =
              'work_amo_v8_terms_values'
            AND constraint_row.convalidated = true
          LIMIT 1
        ) AS v8_values_constraint,
        (
          SELECT pg_get_constraintdef(constraint_row.oid)
          FROM pg_constraint constraint_row
          WHERE constraint_row.conrelid =
              'proof_indexer.work_amo_v8_listing_terms'::regclass
            AND constraint_row.conname =
              'work_amo_v8_terms_positions'
            AND constraint_row.convalidated = true
          LIMIT 1
        ) AS v8_positions_constraint,
        (
          SELECT pg_get_constraintdef(constraint_row.oid)
          FROM pg_constraint constraint_row
          WHERE constraint_row.conrelid =
              'proof_indexer.work_amo_v8_listing_terms'::regclass
            AND constraint_row.conname =
              'work_amo_v8_terms_frozen_payload'
            AND constraint_row.convalidated = true
          LIMIT 1
        ) AS v8_frozen_constraint,
        (
          SELECT pg_get_constraintdef(constraint_row.oid)
          FROM pg_constraint constraint_row
          JOIN pg_class relation
            ON relation.oid = constraint_row.conrelid
          JOIN pg_namespace namespace
            ON namespace.oid = relation.relnamespace
          WHERE namespace.nspname = 'proof_indexer'
            AND relation.relname = 'work_amo_v8_listing_terms'
            AND constraint_row.conname =
              'work_amo_v8_terms_activation'
          LIMIT 1
        ) AS v7_activation_constraint,
        (
          SELECT pg_get_constraintdef(constraint_row.oid)
          FROM pg_constraint constraint_row
          JOIN pg_class relation
            ON relation.oid = constraint_row.conrelid
          JOIN pg_namespace namespace
            ON namespace.oid = relation.relnamespace
          WHERE namespace.nspname = 'proof_indexer'
            AND relation.relname = 'work_amo_block_transitions'
            AND constraint_row.conname =
              'work_amo_block_transitions_models'
            AND constraint_row.convalidated = true
          LIMIT 1
        ) AS transition_model_constraint,
        EXISTS (
          SELECT 1
          FROM information_schema.columns
          WHERE table_schema = 'proof_indexer'
            AND table_name = 'work_amo_block_transitions'
            AND column_name = 'work_token_state_model'
        ) AS transition_token_state_ready,
        EXISTS (
          SELECT 1
          FROM pg_trigger trigger_row
          JOIN pg_class relation
            ON relation.oid = trigger_row.tgrelid
          JOIN pg_namespace namespace
            ON namespace.oid = relation.relnamespace
          WHERE namespace.nspname = 'proof_indexer'
            AND relation.relname = 'work_amo_block_transitions'
            AND trigger_row.tgname =
              'work_amo_block_transitions_immutable'
            AND trigger_row.tgenabled <> 'D'
            AND trigger_row.tgisinternal = false
        ) AS transition_immutability_ready,
        EXISTS (
          SELECT 1
          FROM pg_trigger trigger_row
          WHERE trigger_row.tgrelid =
              'proof_indexer.work_amo_v7_listing_terms'::regclass
            AND trigger_row.tgname =
              'work_amo_v7_listing_terms_immutable'
            AND trigger_row.tgenabled <> 'D'
            AND trigger_row.tgisinternal = false
        ) AS v7_history_immutability_ready,
        EXISTS (
          SELECT 1
          FROM information_schema.columns
          WHERE table_schema = 'proof_indexer'
            AND table_name = 'work_amo_v8_listing_terms'
            AND column_name = 'listing_record_ordinal'
            AND is_nullable = 'NO'
            AND column_default IS NULL
        ) AS v7_ordinal_constraint_ready,
        EXISTS (
          SELECT 1
          FROM pg_trigger trigger_row
          JOIN pg_class relation
            ON relation.oid = trigger_row.tgrelid
          JOIN pg_namespace namespace
            ON namespace.oid = relation.relnamespace
          WHERE namespace.nspname = 'proof_indexer'
            AND relation.relname = 'work_amo_v8_listing_terms'
            AND trigger_row.tgname =
              'work_amo_v8_listing_terms_immutable'
            AND trigger_row.tgenabled <> 'D'
            AND trigger_row.tgisinternal = false
        ) AS v7_immutability_ready,
        EXISTS (
          SELECT 1
          FROM pg_trigger trigger_row
          JOIN pg_class relation
            ON relation.oid = trigger_row.tgrelid
          JOIN pg_namespace namespace
            ON namespace.oid = relation.relnamespace
          WHERE namespace.nspname = 'proof_indexer'
            AND relation.relname = 'meta'
            AND trigger_row.tgname =
              'work_precision_v2_marker_immutable'
            AND trigger_row.tgenabled <> 'D'
            AND trigger_row.tgisinternal = false
        ) AS precision_marker_immutability_ready,
        (
          SELECT pg_get_functiondef(procedure_row.oid)
          FROM pg_proc procedure_row
          JOIN pg_namespace namespace
            ON namespace.oid = procedure_row.pronamespace
          WHERE namespace.nspname = 'proof_indexer'
            AND procedure_row.proname =
              'reject_work_precision_v2_marker_mutation'
          LIMIT 1
        ) AS precision_marker_immutability_definition
    `,
  );
  const row = result.rows[0] ?? {};
  if (
    row.quotes_ready !== true ||
    row.listing_terms_ready !== true ||
    row.v6_listing_terms_ready !== true ||
    row.v6_legacy_attestations_absent !== true ||
    row.v6_legacy_source_validator_absent !== true ||
    row.block_transitions_ready !== true ||
    row.block_transition_evidence_ready !== true ||
    row.quote_evidence_ready !== true ||
    row.v6_listing_terms_evidence_ready !== true ||
    row.v6_policy_constraints_ready !== true ||
    row.v6_immutability_ready !== true ||
    row.v6_marker_immutability_ready !== true ||
    row.transaction_position_ready !== true ||
    row.event_position_ready !== true ||
    row.ordinal_constraints_ready !== true ||
    row.governed_position_unique_ready !== true
  ) {
    throw new Error(
      "Proof index worker is paused until the AMO V5/proof-native V6 canonical-position schema is installed.",
    );
  }
  if (era !== WORK_PRECISION_Q16_ERA) {
    return;
  }
  const transitionConstraint = String(
    row.transition_model_constraint ?? "",
  );
  const q16ConstraintAudit =
    sharedWorkPrecisionV2ConstraintAudit({
      transitionModels: transitionConstraint,
      v8Frozen: row.v8_frozen_constraint,
      v8Identity: row.v8_identity_constraint,
      v8Positions: row.v8_positions_constraint,
      v8Values: row.v8_values_constraint,
    });
  const precisionMarkerImmutabilityDefinition = String(
    row.precision_marker_immutability_definition ?? "",
  );
  if (
    !Number.isSafeInteger(Number(activationHeight)) ||
    Number(activationHeight) < 1 ||
    row.v7_listing_terms_ready !== true ||
    row.v7_listing_terms_evidence_ready !== true ||
    row.v7_policy_constraints_ready !== true ||
    !String(row.v7_activation_constraint ?? "").includes(
      `listing_block_height >= ${Number(activationHeight)}`,
    ) ||
    row.transition_token_state_ready !== true ||
    row.transition_immutability_ready !== true ||
    q16ConstraintAudit.v8TransitionReady !== true ||
    q16ConstraintAudit.v8ValuesReady !== true ||
    q16ConstraintAudit.v8IdentityReady !== true ||
    q16ConstraintAudit.v8PositionsReady !== true ||
    q16ConstraintAudit.v8FrozenReady !== true ||
    row.v7_history_immutability_ready !== true ||
    row.v7_ordinal_constraint_ready !== true ||
    row.v7_immutability_ready !== true ||
    row.precision_marker_immutability_ready !== true ||
    !precisionMarkerImmutabilityDefinition.includes(
      WORK_PRECISION_V2_MIGRATION_META_KEY,
    ) ||
    !precisionMarkerImmutabilityDefinition.includes(
      WORK_AMO_V8_ACTIVATION_LATCH_META_KEY,
    )
  ) {
    throw new Error(
      "Proof index worker is fail-closed until the exact AMO V8 Q16 schema, activation constraint, and immutable replay models are installed.",
    );
  }
}

function compareUtf8(left, right) {
  return Buffer.compare(
    Buffer.from(String(left ?? ""), "utf8"),
    Buffer.from(String(right ?? ""), "utf8"),
  );
}

function canonicalWorkPrecisionUnsignedInteger(value, { positive = false } = {}) {
  const text = String(value ?? "");
  if (
    !/^(?:0|[1-9][0-9]*)$/u.test(text) ||
    (positive && text === "0")
  ) {
    throw new TypeError("work-precision-relational-integer-invalid");
  }
  return text;
}

function canonicalWorkPrecisionBalanceRows(rows, {
  amountField,
  keyField,
} = {}) {
  if (!Array.isArray(rows)) {
    throw new TypeError("work-precision-relational-balances-invalid");
  }
  const seen = new Set();
  const canonical = [];
  for (const row of rows) {
    const address = String(row?.[keyField] ?? "");
    const balanceSubatoms = canonicalWorkPrecisionUnsignedInteger(
      row?.[amountField],
    );
    if (!address || seen.has(address)) {
      throw new TypeError("work-precision-relational-balance-key-invalid");
    }
    seen.add(address);
    if (balanceSubatoms !== "0") {
      canonical.push({ address, balanceSubatoms });
    }
  }
  return canonical.sort((left, right) =>
    compareUtf8(left.address, right.address),
  );
}

function canonicalWorkPrecisionListingRows(
  rows,
  {
    actual = false,
  } = {},
) {
  if (!Array.isArray(rows)) {
    throw new TypeError("work-precision-relational-listings-invalid");
  }
  const seen = new Set();
  const canonical = [];
  for (const row of rows) {
    const listingId = String(
      (actual ? row?.listing_id : row?.listingId) ?? "",
    );
    const amountSubatoms = canonicalWorkPrecisionUnsignedInteger(
      actual ? row?.amount : row?.amountSubatoms,
      { positive: true },
    );
    const sellerAddress = String(
      (actual ? row?.seller_address : row?.sellerAddress) ?? "",
    );
    const priceSats = canonicalWorkPrecisionUnsignedInteger(
      actual ? row?.price_sats : row?.priceSats,
      { positive: true },
    );
    const saleAuthorization = objectRecord(
      actual ? row?.sale_authorization : row?.saleAuthorization,
    );
    const frozenTerms = objectRecord(
      actual ? row?.frozen_terms : row?.frozenTerms,
    );
    if (
      !listingId ||
      seen.has(listingId) ||
      !sellerAddress ||
      Object.keys(saleAuthorization).length === 0 ||
      Object.keys(frozenTerms).length === 0
    ) {
      throw new TypeError("work-precision-relational-listing-row-invalid");
    }
    seen.add(listingId);
    if (actual) {
      if (!["active", "sealing"].includes(String(row?.status ?? ""))) {
        throw new TypeError(
          "work-precision-relational-listing-status-invalid",
        );
      }
      const authorizationVersion = String(
        saleAuthorization.version ?? "",
      );
      const v7TermsPresent =
        row?.v7_authorization_version !== null &&
        row?.v7_authorization_version !== undefined;
      if (authorizationVersion === WORK_AMO_V8_AUTH_VERSION) {
        if (
          !v7TermsPresent ||
          String(row.v7_authorization_version) !==
            WORK_AMO_V8_AUTH_VERSION ||
          canonicalWorkPrecisionUnsignedInteger(
            row.v7_unit_amount_subatoms,
            { positive: true },
          ) !== amountSubatoms ||
          canonicalWorkPrecisionUnsignedInteger(
            row.v7_unit_price_sats,
            { positive: true },
          ) !== priceSats ||
          workAmoV5CanonicalPayloadCommitment(
            objectRecord(row.v7_frozen_terms),
          ).sha256 !==
            workAmoV5CanonicalPayloadCommitment(frozenTerms).sha256
        ) {
          throw new TypeError(
            "work-precision-relational-v8-terms-invalid",
          );
        }
      } else if (v7TermsPresent) {
        throw new TypeError(
          "work-precision-relational-legacy-v8-terms-invalid",
        );
      }
    }
    canonical.push({
      amountSubatoms,
      frozenTerms,
      listingId,
      priceSats,
      saleAuthorization,
      sellerAddress,
    });
  }
  return canonical.sort((left, right) =>
    compareUtf8(left.listingId, right.listingId),
  );
}

function sameWorkPrecisionCanonicalPayload(left, right) {
  const leftCommitment = workAmoV5CanonicalPayloadCommitment(left);
  const rightCommitment = workAmoV5CanonicalPayloadCommitment(right);
  return (
    leftCommitment.model === rightCommitment.model &&
    leftCommitment.sha256 === rightCommitment.sha256 &&
    leftCommitment.payloadBytes === rightCommitment.payloadBytes
  );
}

export function workerWorkPrecisionRelationalParity({
  balanceRows,
  closingTokenState,
  listingRows,
} = {}) {
  try {
    const state = objectRecord(closingTokenState);
    return (
      sameWorkPrecisionCanonicalPayload(
        canonicalWorkPrecisionBalanceRows(balanceRows, {
          amountField: "confirmed_balance",
          keyField: "address",
        }),
        canonicalWorkPrecisionBalanceRows(state.holders, {
          amountField: "balanceSubatoms",
          keyField: "address",
        }),
      ) &&
      sameWorkPrecisionCanonicalPayload(
        canonicalWorkPrecisionListingRows(listingRows, {
          actual: true,
        }),
        canonicalWorkPrecisionListingRows(state.listings),
      )
    );
  } catch {
    return false;
  }
}

function sameWorkPrecisionCommitment(leftValue, rightValue, model = "") {
  const left = objectRecord(leftValue);
  const right = objectRecord(rightValue);
  return Boolean(
    workPrecisionCommitmentShapeReady(left, { model }) &&
      workPrecisionCommitmentShapeReady(right, { model }) &&
      left.model === right.model &&
      left.sha256 === right.sha256 &&
      left.payloadBytes === right.payloadBytes,
  );
}

export function workerWorkPrecisionSnapshotReady(
  snapshotValue,
  { tipHash, tipHeight } = {},
) {
  const snapshot = objectRecord(snapshotValue);
  const normalizedTipHash = normalizedLowerText(tipHash);
  const tokenStatePayloads = objectRecord(
    snapshot.tokenStatePayloads,
  );
  return Boolean(
    Number.isSafeInteger(Number(tipHeight)) &&
      Number(tipHeight) > 0 &&
      /^[0-9a-f]{64}$/u.test(normalizedTipHash) &&
      Number(snapshot.indexedThroughBlock) === Number(tipHeight) &&
      normalizedLowerText(snapshot.sourceBlockHash) ===
        normalizedTipHash &&
      normalizedLowerText(snapshot.payloadBlockHash) ===
        normalizedTipHash &&
      normalizedLowerText(snapshot.summaryBlockHash) ===
        normalizedTipHash &&
      snapshot.workAmountStorageModel ===
        WORK_SUBATOM_PROJECTION_MODEL &&
      snapshot.summaryMode === "canonical-summary-refresh" &&
      snapshot.consistencyOk === true &&
      snapshot.consistencyStatus === "green" &&
      Object.keys(tokenStatePayloads).length > 0 &&
      Object.keys(
        objectRecord(tokenStatePayloads[WORK_TOKEN_ID]),
      ).length > 0
  );
}

export function workerWorkPrecisionCoreTipReady(
  coreTipValue,
  { tipHash, tipHeight } = {},
) {
  const coreTip = objectRecord(coreTipValue);
  const normalizedTipHash = normalizedLowerText(tipHash);
  return Boolean(
    coreTip.stable === true &&
      Number.isSafeInteger(Number(coreTip.height)) &&
      Number(coreTip.height) > 0 &&
      /^[0-9a-f]{64}$/u.test(
        normalizedLowerText(coreTip.blockHash),
      ) &&
      Number(coreTip.height) === Number(tipHeight) &&
      normalizedLowerText(coreTip.blockHash) === normalizedTipHash
  );
}

export function workerWorkPrecisionConfirmedReplayEnvelopeReady({
  activationHeight,
  activationTransition,
  coreTip,
  declarationBlockHash,
  invalidPrecisionEventCount,
  invalidTransitionCount,
  latestTransition,
  markerOpeningCommitment,
  snapshot,
  tipHash,
  tipHeight,
  transitionCount,
} = {}) {
  const activation = objectRecord(activationTransition);
  const activationPayload = objectRecord(activation.payload);
  const latest = objectRecord(latestTransition);
  const latestPayload = objectRecord(latest.payload);
  const openingCommitment = objectRecord(
    activationPayload.precisionOpeningTokenStateCommitment,
  );
  const expectedOpeningCommitment = objectRecord(
    markerOpeningCommitment,
  );
  const normalizedTipHash = normalizedLowerText(tipHash);
  const normalizedDeclarationBlockHash =
    normalizedLowerText(declarationBlockHash);
  const expectedTransitionCount =
    Number.isSafeInteger(Number(tipHeight)) &&
    Number.isSafeInteger(Number(activationHeight)) &&
    Number(tipHeight) >= Number(activationHeight)
      ? Number(tipHeight) - Number(activationHeight) + 1
      : -1;
  return Boolean(
    expectedTransitionCount > 0 &&
      /^[0-9a-f]{64}$/u.test(normalizedTipHash) &&
      /^[0-9a-f]{64}$/u.test(normalizedDeclarationBlockHash) &&
      Number(activation.blockHeight) === Number(activationHeight) &&
      normalizedLowerText(activation.previousBlockHash) ===
        normalizedDeclarationBlockHash &&
      activation.model === WORK_AMO_V8_BLOCK_SEQUENCER_MODEL &&
      activation.stateCommitmentModel ===
        WORK_AMO_V5_STATE_COMMITMENT_MODEL &&
      activation.workTokenStateModel ===
        WORK_AMO_V8_TOKEN_STATE_PREIMAGE_MODEL &&
      activationPayload.precisionMigrationMarkerKey ===
        WORK_PRECISION_V2_MIGRATION_META_KEY &&
      Number(activationPayload.activationHeight) ===
        Number(activationHeight) &&
      sameWorkPrecisionCommitment(
        openingCommitment,
        expectedOpeningCommitment,
        WORK_AMO_V5_PAYLOAD_COMMITMENT_MODEL,
      ) &&
      sameWorkPrecisionCommitment(
        openingCommitment,
        objectRecord(
          activationPayload.openingSufficientState,
        ).tokenStateCommitment,
        WORK_AMO_V5_PAYLOAD_COMMITMENT_MODEL,
      ) &&
      Number(latest.blockHeight) === Number(tipHeight) &&
      normalizedLowerText(latest.blockHash) === normalizedTipHash &&
      latest.model === WORK_AMO_V8_BLOCK_SEQUENCER_MODEL &&
      latest.stateCommitmentModel ===
        WORK_AMO_V5_STATE_COMMITMENT_MODEL &&
      latest.workTokenStateModel ===
        WORK_AMO_V8_TOKEN_STATE_PREIMAGE_MODEL &&
      Number(transitionCount) === expectedTransitionCount &&
      Number(invalidTransitionCount) === 0 &&
      Number(invalidPrecisionEventCount) === 0 &&
      workerWorkPrecisionCoreTipReady(coreTip, {
        tipHash: normalizedTipHash,
        tipHeight,
      }) &&
      workerWorkPrecisionSnapshotReady(snapshot, {
        tipHash: normalizedTipHash,
        tipHeight,
      })
  );
}

async function workerBitcoinCoreRpc(method, params = []) {
  const rpcUrl = String(process.env.BITCOIN_RPC_URL ?? "").trim();
  const rpcUser = String(process.env.BITCOIN_RPC_USER ?? "");
  const rpcPassword = String(process.env.BITCOIN_RPC_PASSWORD ?? "");
  if (!rpcUrl) {
    throw new Error(
      "Proof index worker requires BITCOIN_RPC_URL for exact Q16 tip readiness.",
    );
  }
  const controller = new AbortController();
  const timeout = setTimeout(
    () => controller.abort(),
    WORK_PRECISION_CORE_RPC_TIMEOUT_MS,
  );
  try {
    const headers = { "content-type": "application/json" };
    if (rpcUser || rpcPassword) {
      headers.authorization = `Basic ${Buffer.from(
        `${rpcUser}:${rpcPassword}`,
        "utf8",
      ).toString("base64")}`;
    }
    const response = await fetch(rpcUrl, {
      body: JSON.stringify({
        id: `proof-indexer-worker-${method}`,
        jsonrpc: "1.0",
        method,
        params,
      }),
      headers,
      method: "POST",
      signal: controller.signal,
    });
    const payload = await response.json();
    if (!response.ok || payload?.error) {
      throw new Error(
        `Proof index worker Core RPC ${method} failed: ${
          payload?.error?.message ?? response.status
        }`,
      );
    }
    return payload.result;
  } finally {
    clearTimeout(timeout);
  }
}

async function readExactWorkerCoreTip() {
  const before = await workerBitcoinCoreRpc(
    "getblockchaininfo",
    [],
  );
  const height = Number(before?.blocks);
  const headers = Number(before?.headers);
  const blockHash = normalizedLowerText(before?.bestblockhash);
  if (
    !Number.isSafeInteger(height) ||
    height < 1 ||
    headers !== height ||
    !/^[0-9a-f]{64}$/u.test(blockHash)
  ) {
    throw new Error(
      "Proof index worker received an inexact Core tip before Q16 replay verification.",
    );
  }
  const [heightHashValue, after] = await Promise.all([
    workerBitcoinCoreRpc("getblockhash", [height]),
    workerBitcoinCoreRpc("getblockchaininfo", []),
  ]);
  const heightHash = normalizedLowerText(heightHashValue);
  const afterHeight = Number(after?.blocks);
  const afterHeaders = Number(after?.headers);
  const afterHash = normalizedLowerText(after?.bestblockhash);
  if (
    afterHeight !== height ||
    afterHeaders !== height ||
    afterHash !== blockHash ||
    heightHash !== blockHash
  ) {
    throw new Error(
      "Proof index worker Core tip changed during Q16 replay verification.",
    );
  }
  return {
    blockHash,
    height,
    stable: true,
  };
}

function canonicalWorkerJsonText(value) {
  if (Array.isArray(value)) {
    return `[${value.map(canonicalWorkerJsonText).join(",")}]`;
  }
  if (value && typeof value === "object") {
    return `{${Object.keys(value)
      .sort()
      .map(
        (key) =>
          `${JSON.stringify(key)}:${
            canonicalWorkerJsonText(value[key])
          }`,
      )
      .join(",")}}`;
  }
  return JSON.stringify(value ?? null);
}

function workerWorkQ16PendingCommitment(domain, rows) {
  return createHash("sha256")
    .update(
      Buffer.from(
        `${WORK_AMO_V8_PENDING_PROJECTION_DOMAIN_PREFIX}${domain}/v1\n${
          canonicalWorkerJsonText(rows)
        }`,
        "utf8",
      ),
    )
    .digest("hex");
}

function canonicalWorkerMempoolSnapshot(value) {
  if (!Array.isArray(value)) {
    throw new Error(
      "Proof index worker requires the exact Core getrawmempool(false) array.",
    );
  }
  const rawTxids = value;
  const txids = rawTxids
    .map((txid) => normalizedLowerText(txid));
  if (
    txids.some((txid) => !/^[0-9a-f]{64}$/u.test(txid)) ||
    txids.length !== new Set(txids).size
  ) {
    throw new Error(
      "Proof index worker received invalid or duplicate Core mempool txids.",
    );
  }
  txids.sort(compareUtf8);
  return {
    count: txids.length,
    model: WORK_AMO_V8_PENDING_MEMPOOL_MODEL,
    sha256: createHash("sha256")
      .update(
        Buffer.from(
          `${WORK_AMO_V8_PENDING_MEMPOOL_DOMAIN}\n${
            canonicalWorkerJsonText(txids)
          }`,
          "utf8",
        ),
      )
      .digest("hex"),
    txids,
  };
}

async function readExactWorkerCoreMempoolSnapshot() {
  return canonicalWorkerMempoolSnapshot(
    await workerBitcoinCoreRpc("getrawmempool", [false]),
  );
}

export function workerWorkPrecisionPendingProjection({
  balanceRows,
  eventRows,
  listingRows,
  transactionRows,
} = {}) {
  const rowSets = {
    balances: Array.isArray(balanceRows) ? balanceRows : [],
    events: Array.isArray(eventRows) ? eventRows : [],
    listings: Array.isArray(listingRows) ? listingRows : [],
    transactions: workQ16PendingTransactionProjectionRows(
      transactionRows,
    ),
  };
  const projectionParts = Object.fromEntries(
    Object.entries(rowSets).map(([key, rows]) => [
      key,
      {
        count: rows.length,
        sha256: workerWorkQ16PendingCommitment(
          key.toUpperCase(),
          rows,
        ),
      },
    ]),
  );
  return {
    ...projectionParts,
    commitmentSha256: workerWorkQ16PendingCommitment(
      "PROJECTION",
      projectionParts,
    ),
    model: WORK_AMO_V8_PENDING_PROJECTION_MODEL,
  };
}

export function workerWorkPrecisionPendingMembership({
  eventRows,
  listingRows,
  recoveryRows,
} = {}) {
  const isTxid = (value) => /^[0-9a-f]{64}$/u.test(value);
  const txids = new Set();
  const invalidMembers = [];
  const addRequiredTxid = (source, identity, value) => {
    const txid = normalizedLowerText(value);
    if (!isTxid(txid)) {
      invalidMembers.push({
        identity: String(identity ?? ""),
        reason: "missing-or-invalid-txid",
        source,
        value: String(value ?? ""),
      });
      return;
    }
    txids.add(txid);
  };
  const workMintDecisionCounts = new Map();
  const validProjectionCounts = new Map();
  for (const row of Array.isArray(eventRows) ? eventRows : []) {
    addRequiredTxid("event", row?.event_id, row?.txid);
    const txid = normalizedLowerText(row?.txid);
    const payload = objectRecord(row?.payload);
    const kind = normalizedLowerText(row?.kind);
    const workMintDecision =
      (kind === "token-mint" && row?.valid === true) ||
      (kind === "token-event-invalid" &&
        row?.valid === false &&
        (
          payload.provisionalReason === "supply-cap" ||
          String(payload.reason ?? "").startsWith(
            "WORK mint exceeds max supply:",
          )
        ));
    if (isTxid(txid) && workMintDecision) {
      workMintDecisionCounts.set(
        txid,
        Number(workMintDecisionCounts.get(txid) ?? 0) + 1,
      );
    }
    if (isTxid(txid) && row?.valid === true) {
      validProjectionCounts.set(
        txid,
        Number(validProjectionCounts.get(txid) ?? 0) + 1,
      );
    }
  }
  for (const row of Array.isArray(listingRows) ? listingRows : []) {
    addRequiredTxid(
      "listing",
      row?.listing_id,
      row?.membership_txid,
    );
    const txid = normalizedLowerText(row?.membership_txid);
    if (isTxid(txid)) {
      validProjectionCounts.set(
        txid,
        Number(validProjectionCounts.get(txid) ?? 0) + 1,
      );
    }
  }
  for (const row of Array.isArray(recoveryRows) ? recoveryRows : []) {
    const raw = objectRecord(row?.raw_tx);
    const attemptValue = raw.pendingWorkMintAttemptCount;
    const attemptValid =
      Number.isSafeInteger(attemptValue) && attemptValue >= 0;
    const attemptCount = attemptValid ? attemptValue : -1;
    const inspectionVersion =
      raw.pendingWorkMintInspectionVersion;
    const recoveryValue = raw.pendingWorkMintRecoveryNeeded;
    const recoveryDeclared = typeof recoveryValue === "boolean";
    const recoveryNeeded = recoveryValue === true;
    const resolvedInvalidValue =
      raw.pendingWorkMintResolvedInvalid;
    const resolvedInvalidDeclared =
      typeof resolvedInvalidValue === "boolean";
    const resolvedInvalid = resolvedInvalidValue === true;
    const protocolResolvedInvalidValue =
      raw.pendingProtocolResolvedInvalid;
    const protocolResolvedInvalidDeclared =
      typeof protocolResolvedInvalidValue === "boolean";
    const protocolResolvedInvalid =
      protocolResolvedInvalidValue === true;
    if (
      row?.status !== "pending" ||
      !attemptValid ||
      !Number.isSafeInteger(attemptCount) ||
      inspectionVersion !== 1 ||
      !recoveryDeclared ||
      !resolvedInvalidDeclared ||
      !protocolResolvedInvalidDeclared ||
      (attemptCount === 0 && (recoveryNeeded || resolvedInvalid))
    ) {
      invalidMembers.push({
        identity: String(row?.txid ?? ""),
        reason: "malformed-work-recovery-marker",
        source: "recovery",
        value: String(row?.txid ?? ""),
      });
      continue;
    }
    if (attemptCount === 0) {
      continue;
    }
    addRequiredTxid("recovery", row?.txid, row?.txid);
    const txid = normalizedLowerText(row?.txid);
    const decisionCount = Number(workMintDecisionCounts.get(txid) ?? 0);
    const validProjectionCount = Number(
      validProjectionCounts.get(txid) ?? 0,
    );
    const terminalMarker =
      resolvedInvalid || protocolResolvedInvalid;
    let invalidReason = "";
    if (recoveryNeeded) {
      invalidReason = "work-recovery-unresolved";
    } else if (protocolResolvedInvalid && validProjectionCount > 0) {
      invalidReason = "protocol-terminal-valid-projection-conflict";
    } else if (attemptCount > 1) {
      invalidReason = protocolResolvedInvalid
        ? ""
        : "ambiguous-multi-mint-recovery";
    } else if (decisionCount === 0 && !terminalMarker) {
      invalidReason = "work-decision-missing";
    } else if (decisionCount > 1 || (decisionCount > 0 && resolvedInvalid)) {
      invalidReason = "work-decision-conflict";
    }
    if (invalidReason) {
      invalidMembers.push({
        identity: String(row?.txid ?? ""),
        reason: invalidReason,
        source: "recovery",
        value: String(row?.txid ?? ""),
      });
    }
  }
  const expectedTxids = [...txids].sort(compareUtf8);
  invalidMembers.sort((left, right) =>
    compareUtf8(
      canonicalWorkerJsonText(left),
      canonicalWorkerJsonText(right),
    )
  );
  return {
    expectedTxidCount: expectedTxids.length,
    expectedTxids,
    expectedTxidsSha256: workerWorkQ16PendingCommitment(
      "MEMBERSHIP",
      expectedTxids,
    ),
    invalidCount: invalidMembers.length,
    invalidSha256: workerWorkQ16PendingCommitment(
      "INVALID-MEMBERSHIP",
      invalidMembers,
    ),
    model: "canonical-work-q16-pending-membership-v2",
  };
}

function workerWorkPrecisionPendingInspectionMarkerReason(
  row,
  decisionCount = 0,
  validProjectionCount = 0,
) {
  const raw = objectRecord(row?.raw_tx);
  const attemptCount = raw.pendingWorkMintAttemptCount;
  const inspectionVersion = raw.pendingWorkMintInspectionVersion;
  const recoveryNeeded = raw.pendingWorkMintRecoveryNeeded;
  const resolvedInvalid = raw.pendingWorkMintResolvedInvalid;
  const protocolResolvedInvalid = raw.pendingProtocolResolvedInvalid;
  if (
    row?.status !== "pending" ||
    !Number.isSafeInteger(attemptCount) ||
    attemptCount < 0 ||
    inspectionVersion !== 1 ||
    typeof recoveryNeeded !== "boolean" ||
    typeof resolvedInvalid !== "boolean" ||
    typeof protocolResolvedInvalid !== "boolean"
  ) {
    return "malformed-work-inspection-marker";
  }
  if (attemptCount === 0) {
    return recoveryNeeded ||
        resolvedInvalid ||
        decisionCount !== 0 ||
        (protocolResolvedInvalid && validProjectionCount > 0)
      ? "work-inspection-zero-attempt-conflict"
      : "";
  }
  if (recoveryNeeded) {
    return "work-recovery-unresolved";
  }
  if (protocolResolvedInvalid && validProjectionCount > 0) {
    return "protocol-terminal-valid-projection-conflict";
  }
  if (attemptCount > 1) {
    return protocolResolvedInvalid
      ? ""
      : "ambiguous-multi-mint-recovery";
  }
  const terminalMarker = resolvedInvalid || protocolResolvedInvalid;
  if (decisionCount === 0 && !terminalMarker) {
    return "work-decision-missing";
  }
  if (decisionCount > 1 || (decisionCount > 0 && resolvedInvalid)) {
    return "work-decision-conflict";
  }
  return "";
}

export function workerWorkPrecisionPendingParity({
  balanceRows,
  eventRows,
  listingRows,
  mempoolTxids,
  recoveryRows,
  transactionRows,
} = {}) {
  const isTxid = (value) => /^[0-9a-f]{64}$/u.test(value);
  const mempool = new Set(
    (Array.isArray(mempoolTxids) ? mempoolTxids : [])
      .map(normalizedLowerText)
      .filter(isTxid),
  );
  const membership = workerWorkPrecisionPendingMembership({
    eventRows,
    listingRows,
    recoveryRows,
  });
  const expectedTxids = membership.expectedTxids;
  const outsideMempoolTxids = expectedTxids.filter(
    (txid) => !mempool.has(txid),
  );
  const transactionRowsByTxid = new Map();
  let duplicateTransactionCount = 0;
  for (
    const row of Array.isArray(transactionRows)
      ? transactionRows
      : []
  ) {
    const txid = normalizedLowerText(row?.txid);
    if (!isTxid(txid) || !mempool.has(txid)) {
      continue;
    }
    if (transactionRowsByTxid.has(txid)) {
      duplicateTransactionCount += 1;
    }
    transactionRowsByTxid.set(txid, row);
  }
  const missingTransactionTxids = expectedTxids.filter(
    (txid) =>
      !transactionRowsByTxid.has(txid) ||
      transactionRowsByTxid.get(txid)?.status !== "pending",
  );
  const workMintDecisionCounts = new Map();
  const validProjectionCounts = new Map();
  for (const row of Array.isArray(eventRows) ? eventRows : []) {
    const txid = normalizedLowerText(row?.txid);
    const payload = objectRecord(row?.payload);
    const kind = normalizedLowerText(row?.kind);
    const decision =
      (kind === "token-mint" && row?.valid === true) ||
      (kind === "token-event-invalid" &&
        row?.valid === false &&
        (
          payload.provisionalReason === "supply-cap" ||
          String(payload.reason ?? "").startsWith(
            "WORK mint exceeds max supply:",
          )
        ));
    if (isTxid(txid) && decision) {
      workMintDecisionCounts.set(
        txid,
        Number(workMintDecisionCounts.get(txid) ?? 0) + 1,
      );
    }
    if (isTxid(txid) && row?.valid === true) {
      validProjectionCounts.set(
        txid,
        Number(validProjectionCounts.get(txid) ?? 0) + 1,
      );
    }
  }
  for (const row of Array.isArray(listingRows) ? listingRows : []) {
    const txid = normalizedLowerText(row?.membership_txid);
    if (isTxid(txid)) {
      validProjectionCounts.set(
        txid,
        Number(validProjectionCounts.get(txid) ?? 0) + 1,
      );
    }
  }
  const invalidInspectionRows = expectedTxids.flatMap((txid) => {
    const row = transactionRowsByTxid.get(txid);
    if (!row) {
      return [];
    }
    const reason = workerWorkPrecisionPendingInspectionMarkerReason(
      row,
      Number(workMintDecisionCounts.get(txid) ?? 0),
      Number(validProjectionCounts.get(txid) ?? 0),
    );
    return reason ? [{ reason, txid }] : [];
  });
  const observedNonzeroBalanceRows =
    Array.isArray(balanceRows) ? balanceRows : [];
  const {
    expectedTxids: _expectedTxids,
    ...membershipCommitment
  } = membership;
  return {
    balanceDeltas: {
      expectedNonzeroCount: 0,
      model:
        "pending-work-events-do-not-mutate-holder-balances-v1",
      observedNonzeroCount: observedNonzeroBalanceRows.length,
      observedSha256: workerWorkQ16PendingCommitment(
        "BALANCE-DELTA-PARITY",
        observedNonzeroBalanceRows,
      ),
    },
    membership: {
      ...membershipCommitment,
      outsideMempoolCount: outsideMempoolTxids.length,
      outsideMempoolTxidsSha256:
        workerWorkQ16PendingCommitment(
          "OUTSIDE-MEMPOOL",
          outsideMempoolTxids,
        ),
    },
    model: "canonical-work-q16-pending-parity-v2",
    ready:
      membership.invalidCount === 0 &&
      outsideMempoolTxids.length === 0 &&
      duplicateTransactionCount === 0 &&
      missingTransactionTxids.length === 0 &&
      invalidInspectionRows.length === 0 &&
      observedNonzeroBalanceRows.length === 0,
    transactions: {
      duplicateCount: duplicateTransactionCount,
      expectedCount: expectedTxids.length,
      inspectionInvalidCount: invalidInspectionRows.length,
      inspectionInvalidSha256: workerWorkQ16PendingCommitment(
        "INVALID-INSPECTION",
        invalidInspectionRows,
      ),
      matchedCount:
        expectedTxids.length - missingTransactionTxids.length,
      missingCount: missingTransactionTxids.length,
      missingTxidsSha256: workerWorkQ16PendingCommitment(
        "MISSING-TRANSACTIONS",
        missingTransactionTxids,
      ),
    },
  };
}

function exactWorkerPendingCommitment(value) {
  const commitment = objectRecord(value);
  return Boolean(
    exactObjectKeys(commitment, ["count", "sha256"]) &&
      exactJsonInteger(commitment.count) &&
      /^[0-9a-f]{64}$/u.test(
        String(commitment.sha256 ?? ""),
      ),
  );
}

export function workerWorkPrecisionPendingWitnessReady(
  witnessValue,
  {
    coreTip,
    declarationConfig,
    invalidLegacyMutationCount,
    mempoolSnapshot,
    nowMs = Date.now(),
    parity,
    projection,
  } = {},
) {
  const witness = objectRecord(witnessValue);
  const config = objectRecord(declarationConfig);
  const witnessedTip = objectRecord(witness.canonicalTip);
  const witnessedMempool = objectRecord(witness.mempoolSnapshot);
  const witnessedMembership = objectRecord(witness.membershipSnapshot);
  const currentMempool = objectRecord(mempoolSnapshot);
  const witnessedProjection = objectRecord(witness.projection);
  const currentProjection = objectRecord(projection);
  const witnessedParity = objectRecord(witness.parity);
  const currentParity = objectRecord(parity);
  const scan = objectRecord(witness.scan);
  const txids = Array.isArray(witnessedMembership.txids)
    ? witnessedMembership.txids.map((txid) => normalizedLowerText(txid))
    : [];
  const currentMempoolTxids = Array.isArray(currentMempool.txids)
    ? currentMempool.txids.map((txid) => normalizedLowerText(txid))
    : [];
  const generatedAtMs = Date.parse(String(witness.generatedAt ?? ""));
  const projectionParts = {
    balances: witnessedProjection.balances,
    events: witnessedProjection.events,
    listings: witnessedProjection.listings,
    transactions: witnessedProjection.transactions,
  };
  return Boolean(
    config.configured === true &&
      exactObjectKeys(witness, [
        "activationHeight",
        "amountStorageModel",
        "canonicalTip",
        "declarationTxid",
        "generatedAt",
        "invalidLegacyMutationCount",
        "membershipSnapshot",
        "mempoolSnapshot",
        "model",
        "network",
        "parity",
        "precisionModel",
        "projection",
        "ready",
        "scan",
      ]) &&
      exactObjectKeys(witnessedTip, ["hash", "height"]) &&
      exactObjectKeys(witnessedMempool, [
        "count",
        "model",
        "sha256",
      ]) &&
      exactObjectKeys(witnessedMembership, [
        "count",
        "model",
        "sha256",
        "txids",
      ]) &&
      exactObjectKeys(witnessedProjection, [
        "balances",
        "commitmentSha256",
        "events",
        "listings",
        "model",
        "transactions",
      ]) &&
      exactObjectKeys(scan, [
        "canonicalDeferred",
        "complete",
        "completeModel",
        "discoveryModel",
        "inspectedTxids",
        "mempoolMembershipCount",
        "protocolTxids",
        "scanned",
        "stopReason",
        "unresolved",
      ]) &&
      witness.model === WORK_AMO_V8_PENDING_REBUILD_MODEL &&
      witness.network === "livenet" &&
      witness.ready === true &&
      witness.activationHeight === config.activationHeight &&
      witness.declarationTxid ===
        config.declarationTxid &&
      witness.amountStorageModel === WORK_SUBATOM_PROJECTION_MODEL &&
      witness.precisionModel === WORK_PRECISION_V2_MODEL &&
      witness.invalidLegacyMutationCount === 0 &&
      Number(invalidLegacyMutationCount) === 0 &&
      workerWorkPrecisionCoreTipReady(coreTip, {
        tipHash: witnessedTip.hash,
        tipHeight: witnessedTip.height,
      }) &&
      exactJsonInteger(witnessedTip.height, {
        minimum: config.activationHeight,
      }) &&
      witnessedTip.hash === normalizedLowerText(witnessedTip.hash) &&
      witnessedMempool.model === WORK_AMO_V8_PENDING_MEMPOOL_MODEL &&
      exactJsonInteger(witnessedMempool.count) &&
      /^[0-9a-f]{64}$/u.test(String(witnessedMempool.sha256 ?? "")) &&
      witnessedMembership.model ===
        "canonical-work-q16-pending-membership-v2" &&
      witnessedMembership.count === txids.length &&
      canonicalWorkerJsonText(witnessedMembership.txids) ===
        canonicalWorkerJsonText(txids) &&
      txids.length === new Set(txids).size &&
      txids.every((txid) => /^[0-9a-f]{64}$/u.test(txid)) &&
      txids.every(
        (txid, index) =>
          index === 0 || compareUtf8(txids[index - 1], txid) < 0,
      ) &&
      witnessedMembership.sha256 ===
        workerWorkQ16PendingCommitment("MEMBERSHIP", txids) &&
      witnessedParity.membership?.model ===
        witnessedMembership.model &&
      exactJsonInteger(
        witnessedParity.membership?.expectedTxidCount,
      ) &&
      witnessedParity.membership.expectedTxidCount ===
        witnessedMembership.count &&
      String(witnessedParity.membership?.expectedTxidsSha256 ?? "") ===
        witnessedMembership.sha256 &&
      currentMempool.model === WORK_AMO_V8_PENDING_MEMPOOL_MODEL &&
      currentMempool.count === currentMempoolTxids.length &&
      canonicalWorkerJsonText(currentMempool.txids) ===
        canonicalWorkerJsonText(currentMempoolTxids) &&
      currentMempoolTxids.length === new Set(currentMempoolTxids).size &&
      currentMempoolTxids.every((txid) =>
        /^[0-9a-f]{64}$/u.test(txid)
      ) &&
      currentMempoolTxids.every(
        (txid, index) =>
          index === 0 ||
          compareUtf8(currentMempoolTxids[index - 1], txid) < 0,
      ) &&
      currentMempool.sha256 ===
        canonicalWorkerMempoolSnapshot(currentMempoolTxids).sha256 &&
      witnessedProjection.model ===
        WORK_AMO_V8_PENDING_PROJECTION_MODEL &&
      witnessedParity.ready === true &&
      currentParity.ready === true &&
      canonicalWorkerJsonText(witnessedParity) ===
        canonicalWorkerJsonText(currentParity) &&
      Object.values(projectionParts).every(
        exactWorkerPendingCommitment,
      ) &&
      witnessedProjection.commitmentSha256 ===
        workerWorkQ16PendingCommitment(
          "PROJECTION",
          projectionParts,
        ) &&
      canonicalWorkerJsonText(witnessedProjection) ===
        canonicalWorkerJsonText(currentProjection) &&
      scan.complete === true &&
      scan.completeModel ===
        "persisted-pending-work-projection-audit-v1" &&
      scan.discoveryModel ===
        "bounded-best-effort-unconfirmed-discovery-v1" &&
      exactJsonInteger(scan.canonicalDeferred) &&
      exactJsonInteger(scan.unresolved) &&
      exactJsonInteger(scan.mempoolMembershipCount) &&
      scan.mempoolMembershipCount === witnessedMempool.count &&
      exactJsonInteger(scan.inspectedTxids) &&
      scan.inspectedTxids <= scan.mempoolMembershipCount &&
      exactJsonInteger(scan.protocolTxids) &&
      exactJsonInteger(scan.scanned) &&
      typeof scan.stopReason === "string" &&
      typeof witness.generatedAt === "string" &&
      Number.isFinite(generatedAtMs) &&
      Number.isFinite(Number(nowMs)) &&
      Number(nowMs) >= generatedAtMs &&
      Number(nowMs) - generatedAtMs <=
        WORK_AMO_V8_PENDING_WITNESS_MAX_AGE_MS
  );
}

async function assertWorkPrecisionReplayReady(pool, precision) {
  if (precision?.era !== WORK_PRECISION_Q16_ERA) {
    return {
      era: precision?.era ?? WORK_PRECISION_Q8_ERA,
      ready: true,
      replayRequired: false,
    };
  }
  const activationHeight = Number(precision.activationHeight);
  if (
    !Number.isSafeInteger(activationHeight) ||
    activationHeight < 1 ||
    !Number.isFinite(Date.parse(String(precision.markerCompletedAt ?? "")))
  ) {
    throw new Error(
      "Proof index worker cannot verify AMO V8 replay without the exact activation and migration completion.",
    );
  }
  const declarationBlockHash = normalizedLowerText(
    precision.declarationBlockHash,
  );
  if (
    Number(precision.declarationHeight) !== activationHeight - 1 ||
    !/^[0-9a-f]{64}$/u.test(declarationBlockHash)
  ) {
    throw new Error(
      "Proof index worker cannot verify AMO V8 replay without the exact declaration-height predecessor.",
    );
  }
  const coreTipBefore = await readExactWorkerCoreTip();
  const [stateResult, balanceResult, listingResult] = await Promise.all([
    pool.query(
      `
        WITH canonical_tip AS (
          SELECT
            block.height,
            lower(block.block_hash) AS block_hash
          FROM proof_indexer.blocks block
          WHERE block.network = $1
            AND block.canonical = true
          ORDER BY block.height DESC
          LIMIT 1
        )
        SELECT
          (
            SELECT tip.height
            FROM canonical_tip tip
          ) AS tip_height,
          (
            SELECT tip.block_hash
            FROM canonical_tip tip
          ) AS tip_hash,
          (
            SELECT count(*)::integer
            FROM proof_indexer.work_amo_block_transitions transition
            WHERE transition.network = $1
              AND transition.block_height >= $2
          ) AS transition_count,
          (
            SELECT count(*)::integer
            FROM proof_indexer.work_amo_block_transitions transition
            LEFT JOIN proof_indexer.blocks block
              ON block.network = transition.network
             AND block.height = transition.block_height
             AND block.block_hash = transition.block_hash
             AND block.canonical = true
            LEFT JOIN proof_indexer.blocks previous_block
              ON previous_block.network = transition.network
             AND previous_block.height = transition.block_height - 1
             AND previous_block.block_hash =
                  transition.previous_block_hash
             AND previous_block.canonical = true
            LEFT JOIN proof_indexer.work_amo_block_transitions
              previous_transition
              ON previous_transition.network = transition.network
             AND previous_transition.block_height =
                  transition.block_height - 1
            WHERE transition.network = $1
              AND transition.block_height >= $2
              AND (
                transition.complete IS DISTINCT FROM true
                OR transition.model <> $3
                OR transition.work_token_state_model <> $4
                OR transition.state_commitment_model <> $5
                OR transition.block_atomic IS DISTINCT FROM true
                OR transition.fee_once IS DISTINCT FROM true
                OR transition.invalid_zero IS DISTINCT FROM true
                OR block.block_hash IS NULL
                OR previous_block.block_hash IS NULL
                OR transition.payload->>'model'
                  IS DISTINCT FROM $3
                OR transition.payload->>'network'
                  IS DISTINCT FROM $1
                OR transition.payload->>'blockHeight'
                  IS DISTINCT FROM
                  transition.block_height::text
                OR lower(COALESCE(
                  transition.payload->>'blockHash',
                  ''
                )) <> transition.block_hash
                OR lower(COALESCE(
                  transition.payload->>'previousBlockHash',
                  ''
                )) <> transition.previous_block_hash
                OR transition.payload->>'blockAtomic'
                  IS DISTINCT FROM 'true'
                OR transition.payload->>'feeOnce'
                  IS DISTINCT FROM 'true'
                OR transition.payload->>'invalidZero'
                  IS DISTINCT FROM 'true'
                OR transition.payload->>'complete'
                  IS DISTINCT FROM 'true'
                OR transition.payload->'openingSufficientState'
                     ->>'model' IS DISTINCT FROM $6
                OR transition.payload->'closingSufficientState'
                     ->>'model' IS DISTINCT FROM $6
                OR transition.payload->'openingSufficientState'
                     ->>'throughBlockHeight' IS DISTINCT FROM
                  (transition.block_height - 1)::text
                OR lower(COALESCE(
                  transition.payload->'openingSufficientState'
                    ->>'throughBlockHash',
                  ''
                )) <> transition.previous_block_hash
                OR transition.payload->'closingSufficientState'
                     ->>'throughBlockHeight' IS DISTINCT FROM
                  transition.block_height::text
                OR lower(COALESCE(
                  transition.payload->'closingSufficientState'
                    ->>'throughBlockHash',
                  ''
                )) <> transition.block_hash
                OR transition.payload->'openingSufficientState'
                     ->>'networkValueQ8' IS DISTINCT FROM
                  transition.opening_network_value_q8::text
                OR transition.payload->'closingSufficientState'
                     ->>'networkValueQ8' IS DISTINCT FROM
                  transition.closing_network_value_q8::text
                OR transition.payload->'openingStateCommitment'
                     ->>'model' IS DISTINCT FROM $5
                OR lower(COALESCE(
                  transition.payload->'openingStateCommitment'
                    ->>'sha256',
                  ''
                )) <> transition.opening_state_sha256
                OR transition.payload->'openingStateCommitment'
                     ->>'payloadBytes' IS DISTINCT FROM
                  transition.opening_state_payload_bytes::text
                OR transition.payload->'closingStateCommitment'
                     ->>'model' IS DISTINCT FROM $5
                OR lower(COALESCE(
                  transition.payload->'closingStateCommitment'
                    ->>'sha256',
                  ''
                )) <> transition.closing_state_sha256
                OR transition.payload->'closingStateCommitment'
                     ->>'payloadBytes' IS DISTINCT FROM
                  transition.closing_state_payload_bytes::text
                OR transition.payload->'openingSufficientState'
                     ->'tokenStateCommitment'->>'model'
                  IS DISTINCT FROM $7
                OR transition.payload->'closingSufficientState'
                     ->'tokenStateCommitment'->>'model'
                  IS DISTINCT FROM $7
                OR transition.payload->>'workTokenStateModel'
                  IS DISTINCT FROM $4
                OR (
                  transition.block_height = $2
                  AND transition.previous_block_hash <> $12
                )
                OR (
                  transition.block_height > $2
                  AND (
                    previous_transition.block_hash IS NULL
                    OR previous_transition.block_hash <>
                      transition.previous_block_hash
                    OR previous_transition.closing_network_value_q8 <>
                      transition.opening_network_value_q8
                    OR previous_transition.closing_state_sha256 <>
                      transition.opening_state_sha256
                    OR previous_transition.closing_state_payload_bytes <>
                      transition.opening_state_payload_bytes
                    OR transition.payload->'openingSufficientState'
                      IS DISTINCT FROM
                      previous_transition.payload
                        ->'closingSufficientState'
                  )
                )
              )
          ) AS invalid_transition_count,
          (
            SELECT jsonb_build_object(
              'blockHeight', transition.block_height,
              'blockHash', transition.block_hash,
              'model', transition.model,
              'payload', transition.payload,
              'previousBlockHash', transition.previous_block_hash,
              'stateCommitmentModel',
                transition.state_commitment_model,
              'workTokenStateModel', transition.work_token_state_model
            )
            FROM proof_indexer.work_amo_block_transitions transition
            WHERE transition.network = $1
              AND transition.complete = true
            ORDER BY transition.block_height DESC
            LIMIT 1
          ) AS latest_transition,
          (
            SELECT jsonb_build_object(
              'blockHeight', transition.block_height,
              'blockHash', transition.block_hash,
              'model', transition.model,
              'payload', transition.payload,
              'previousBlockHash', transition.previous_block_hash,
              'stateCommitmentModel',
                transition.state_commitment_model,
              'workTokenStateModel', transition.work_token_state_model
            )
            FROM proof_indexer.work_amo_block_transitions transition
            WHERE transition.network = $1
              AND transition.block_height = $2
              AND transition.complete = true
            LIMIT 1
          ) AS activation_transition,
          (
            SELECT jsonb_build_object(
              'consistencyOk',
                snapshot.consistency->>'ok' = 'true',
              'consistencyStatus',
                snapshot.consistency->>'status',
              'indexedThroughBlock',
                snapshot.indexed_through_block,
              'payloadBlockHash',
                lower(COALESCE(
                  snapshot.payload->>'indexedThroughBlockHash',
                  ''
                )),
              'sourceBlockHash',
                lower(COALESCE(
                  snapshot.source_hashes->>'blockScan',
                  ''
                )),
              'summaryBlockHash',
                lower(COALESCE(
                  snapshot.payload->'summaryRefresh'
                    ->>'indexedThroughBlockHash',
                  ''
                )),
              'summaryMode',
                snapshot.payload->'summaryRefresh'->>'mode',
              'tokenStatePayloads',
                snapshot.payload->'tokenStatePayloads',
              'workAmountStorageModel',
                snapshot.payload->>'workAmountStorageModel'
            )
            FROM proof_indexer.ledger_snapshots snapshot
            WHERE snapshot.network = $1
              AND snapshot.generated_at >= $8::timestamptz
              AND snapshot.payload ? 'tokenStatePayloads'
              AND snapshot.payload->'tokenStatePayloads' ? $9
              AND snapshot.payload->>'workAmountStorageModel' = $11
            ORDER BY snapshot.indexed_through_block DESC NULLS LAST,
              snapshot.generated_at DESC
            LIMIT 1
          ) AS snapshot,
          (
            SELECT count(*)::integer
            FROM proof_indexer.events event
            WHERE event.network = $1
              AND event.protocol = 'pwt1'
              AND event.status = 'confirmed'
              AND event.valid = true
              AND lower(COALESCE(
                event.payload->>'tokenId',
                event.payload->'saleAuthorization'->>'tokenId',
                event.payload->'listingAuthorization'->>'tokenId',
                ''
              )) = $9
              AND (
                (
                  event.block_height < $2
                  AND (
                    event.raw_payload LIKE 'pwt1:send3:%'
                    OR lower(COALESCE(
                      event.payload->'saleAuthorization'->>'version',
                      event.payload->'listingAuthorization'->>'version',
                      ''
                    )) = $10
                  )
                )
                OR (
                  event.block_height >= $2
                  AND (
                    event.raw_payload LIKE 'pwt1:send:%'
                    OR event.raw_payload LIKE 'pwt1:send2:%'
                    OR (
                      event.kind = 'token-listing'
                      AND lower(COALESCE(
                        event.payload->'saleAuthorization'->>'version',
                        event.payload->'listingAuthorization'->>'version',
                        ''
                      )) <> $10
                    )
                  )
                )
              )
          ) AS invalid_precision_event_count
      `,
      [
        NETWORK,
        activationHeight,
        WORK_AMO_V8_BLOCK_SEQUENCER_MODEL,
        WORK_AMO_V8_TOKEN_STATE_PREIMAGE_MODEL,
        WORK_AMO_V5_STATE_COMMITMENT_MODEL,
        WORK_AMO_V5_NETWORK_ACCUMULATOR_MODEL,
        WORK_AMO_V5_PAYLOAD_COMMITMENT_MODEL,
        precision.markerCompletedAt,
        WORK_TOKEN_ID,
        WORK_AMO_V8_AUTH_VERSION,
        WORK_SUBATOM_PROJECTION_MODEL,
        declarationBlockHash,
      ],
    ),
    pool.query(
      `
        SELECT address, confirmed_balance::text
        FROM proof_indexer.credit_balances
        WHERE network = $1
          AND token_id = $2
        ORDER BY address ASC
      `,
      [NETWORK, WORK_TOKEN_ID],
    ),
    pool.query(
      `
        SELECT
          listing.listing_id,
          listing.amount::text,
          listing.seller_address,
          listing.price_sats::text,
          listing.status,
          COALESCE(
            listing.payload->'listingAuthorization',
            listing.payload->'saleAuthorization'
          ) AS sale_authorization,
          COALESCE(
            listing.payload->'listingFrozenTerms',
            listing.payload->'frozenTerms'
          ) AS frozen_terms,
          v8.authorization_version AS v7_authorization_version,
          v8.unit_amount_subatoms::text AS
            v7_unit_amount_subatoms,
          v8.unit_price_sats::text AS v7_unit_price_sats,
          v8.frozen_terms AS v7_frozen_terms
        FROM proof_indexer.credit_listings listing
        LEFT JOIN proof_indexer.work_amo_v8_listing_terms v8
          ON v8.network = listing.network
         AND v8.listing_id = listing.listing_id
        WHERE listing.network = $1
          AND listing.token_id = $2
          AND listing.status IN ('active', 'sealing')
        ORDER BY listing.listing_id ASC
      `,
      [NETWORK, WORK_TOKEN_ID],
    ),
  ]);
  const coreTipAfter = await readExactWorkerCoreTip();
  if (
    coreTipBefore.height !== coreTipAfter.height ||
    coreTipBefore.blockHash !== coreTipAfter.blockHash
  ) {
    throw new Error(
      "Proof index worker Core tip changed across the Q16 relational replay audit.",
    );
  }
  const row = stateResult.rows[0] ?? {};
  const tipHeight = Number(row.tip_height);
  const tipHash = normalizedLowerText(row.tip_hash);
  const latest = objectRecord(row.latest_transition);
  const activation = objectRecord(row.activation_transition);
  const latestPayload = objectRecord(latest.payload);
  const closingTokenState = objectRecord(
    latestPayload.closingTokenState,
  );
  const closingSufficientState = objectRecord(
    latestPayload.closingSufficientState,
  );
  const sufficientCommitment = objectRecord(
    closingSufficientState.tokenStateCommitment,
  );
  const markerOpeningCommitment = objectRecord(
    precision.openingTokenStateCommitment,
  );
  let closingCommitment = null;
  try {
    closingCommitment =
      workAmoV8CanonicalTokenStateCommitment(closingTokenState);
  } catch {
    closingCommitment = null;
  }
  const commitmentReady = Boolean(
    closingCommitment &&
      sameWorkPrecisionCommitment(
        closingCommitment,
        sufficientCommitment,
        WORK_AMO_V5_PAYLOAD_COMMITMENT_MODEL,
      ),
  );
  const replayEnvelopeReady =
    workerWorkPrecisionConfirmedReplayEnvelopeReady({
      activationHeight,
      activationTransition: activation,
      coreTip: coreTipAfter,
      declarationBlockHash,
      invalidPrecisionEventCount:
        row.invalid_precision_event_count,
      invalidTransitionCount: row.invalid_transition_count,
      latestTransition: latest,
      markerOpeningCommitment,
      snapshot: row.snapshot,
      tipHash,
      tipHeight,
      transitionCount: row.transition_count,
    });
  const relationalParityReady = workerWorkPrecisionRelationalParity({
    balanceRows: balanceResult.rows,
    closingTokenState,
    listingRows: listingResult.rows,
  });
  const ready =
    replayEnvelopeReady &&
    commitmentReady &&
    relationalParityReady;
  if (!ready) {
    throw new Error(
      "Proof index worker is fail-closed until AMO V8 has exact activation-to-tip replay, Q16 relational parity, and a post-migration current snapshot " +
        `(envelope=${replayEnvelopeReady}, commitment=${commitmentReady}, ` +
        `relational=${relationalParityReady}, invalidTransitions=${Number(row.invalid_transition_count)}).`,
    );
  }
  return {
    activationHeight,
    era: WORK_PRECISION_Q16_ERA,
    ready: true,
    replayRequired: true,
    tipHash,
    tipHeight,
    transitionCount: Number(row.transition_count),
  };
}

async function assertWorkPrecisionPendingReady(
  pool,
  precision,
  confirmedReplay,
) {
  if (precision?.era !== WORK_PRECISION_Q16_ERA) {
    return {
      era: precision?.era ?? WORK_PRECISION_Q8_ERA,
      ready: true,
      replayRequired: false,
    };
  }
  if (
    confirmedReplay?.ready !== true ||
    !workerWorkPrecisionCoreTipReady(
      {
        blockHash: confirmedReplay.tipHash,
        height: confirmedReplay.tipHeight,
        stable: true,
      },
      {
        tipHash: confirmedReplay.tipHash,
        tipHeight: confirmedReplay.tipHeight,
      },
    )
  ) {
    throw new Error(
      "Proof index worker refuses pending readiness before exact confirmed replay.",
    );
  }
  const declarationConfig = workerWorkAmoV8DeclarationConfig();
  const witnessResult = await pool.query(
    `
      SELECT value
      FROM proof_indexer.meta
      WHERE key = $1
      LIMIT 2
    `,
    [WORK_AMO_V8_PENDING_REBUILD_META_KEY],
  );
  const witness = objectRecord(witnessResult.rows[0]?.value);
  const [coreTipBefore, mempoolBefore] = await Promise.all([
    readExactWorkerCoreTip(),
    readExactWorkerCoreMempoolSnapshot(),
  ]);
  const [
    balanceResult,
    eventResult,
    listingResult,
    recoveryResult,
    invalidLegacyResult,
  ] = await Promise.all([
    pool.query(
      `
        SELECT address, pending_delta::text
        FROM proof_indexer.credit_balances
        WHERE network = $1
          AND token_id = $2
          AND pending_delta <> 0
        ORDER BY address ASC
      `,
      [NETWORK, WORK_TOKEN_ID],
    ),
    pool.query(
      `
        SELECT
          event_id,
          txid,
          kind,
          protocol,
          op_return_vout AS protocol_vout,
          record_ordinal,
          valid,
          raw_payload,
          payload
        FROM proof_indexer.events
        WHERE network = $1
          AND status = 'pending'
          AND protocol = 'pwt1'
          AND lower(COALESCE(
            payload->>'tokenId',
            payload->'saleAuthorization'->>'tokenId',
            payload->'listingAuthorization'->>'tokenId',
            payload->'actionAuthorization'->>'tokenId',
            ''
          )) = $2
        ORDER BY txid ASC, protocol_vout ASC, record_ordinal ASC,
          event_id ASC
      `,
      [NETWORK, WORK_TOKEN_ID],
    ),
    pool.query(
      `
        SELECT
          listing.listing_id,
          listing.status,
          listing.seller_address,
          listing.buyer_address,
          listing.amount::text,
          listing.price_sats::text,
          listing.sale_ticket_txid,
          listing.seal_txid,
          CASE
            WHEN listing.status = 'pending'
              THEN lower(listing.listing_id)
            WHEN listing.status = 'sealing'
              AND COALESCE(seal_tx.status, '') <> 'confirmed'
              AND COALESCE(listing.seal_txid, '') <> ''
              THEN lower(listing.seal_txid)
            ELSE NULL
          END AS membership_txid,
          seal_tx.status AS seal_transaction_status,
          listing.payload
        FROM proof_indexer.credit_listings listing
        LEFT JOIN proof_indexer.transactions seal_tx
          ON seal_tx.network = listing.network
         AND seal_tx.txid = lower(listing.seal_txid)
        WHERE listing.network = $1
          AND listing.token_id = $2
          AND (
            listing.status = 'pending'
            OR (
              listing.status = 'sealing'
              AND COALESCE(seal_tx.status, '') <> 'confirmed'
            )
          )
        ORDER BY listing.listing_id ASC
      `,
      [NETWORK, WORK_TOKEN_ID],
    ),
    pool.query(
      `
        SELECT txid, status, raw_tx
        FROM proof_indexer.transactions
        WHERE network = $1
          AND status = 'pending'
          AND (
            raw_tx ? 'pendingWorkMintAttemptCount'
            OR raw_tx ? 'pendingWorkMintInspectionVersion'
            OR raw_tx ? 'pendingWorkMintRecoveryNeeded'
            OR raw_tx ? 'pendingWorkMintResolvedInvalid'
            OR raw_tx ? 'pendingProtocolResolvedInvalid'
          )
          AND (
            jsonb_typeof(
              raw_tx->'pendingWorkMintAttemptCount'
            ) = 'number'
            AND jsonb_typeof(
              raw_tx->'pendingWorkMintInspectionVersion'
            ) = 'number'
            AND jsonb_typeof(
              raw_tx->'pendingWorkMintRecoveryNeeded'
            ) = 'boolean'
            AND jsonb_typeof(
              raw_tx->'pendingWorkMintResolvedInvalid'
            ) = 'boolean'
            AND jsonb_typeof(
              raw_tx->'pendingProtocolResolvedInvalid'
            ) = 'boolean'
            AND raw_tx->>'pendingWorkMintAttemptCount' = '0'
            AND raw_tx->>'pendingWorkMintInspectionVersion' = '1'
            AND raw_tx->>'pendingWorkMintRecoveryNeeded' = 'false'
            AND raw_tx->>'pendingWorkMintResolvedInvalid' = 'false'
            AND raw_tx->>'pendingProtocolResolvedInvalid'
              IN ('false', 'true')
          ) IS NOT TRUE
        ORDER BY txid ASC
      `,
      [NETWORK],
    ),
    pool.query(
      `
        SELECT count(*)::integer AS invalid_count
        FROM proof_indexer.events event
        WHERE event.network = $1
          AND event.status = 'pending'
          AND event.protocol = 'pwt1'
          AND event.valid = true
          AND lower(COALESCE(
            event.payload->>'tokenId',
            event.payload->'saleAuthorization'->>'tokenId',
            event.payload->'listingAuthorization'->>'tokenId',
            event.payload->'actionAuthorization'->>'tokenId',
            ''
          )) = $2
          AND (
            event.raw_payload LIKE 'pwt1:send:%'
            OR event.raw_payload LIKE 'pwt1:send2:%'
            OR (
              event.kind = 'token-listing'
              AND lower(COALESCE(
                event.payload->'saleAuthorization'->>'version',
                event.payload->'listingAuthorization'->>'version',
                ''
              )) <> $3
            )
          )
      `,
      [NETWORK, WORK_TOKEN_ID, WORK_AMO_V8_AUTH_VERSION],
    ),
  ]);
  const membership = workerWorkPrecisionPendingMembership({
    eventRows: eventResult.rows,
    listingRows: listingResult.rows,
    recoveryRows: recoveryResult.rows,
  });
  const transactionResult = await pool.query(
    `
      SELECT txid, status, raw_tx
      FROM proof_indexer.transactions
      WHERE network = $1
        AND status = 'pending'
        AND txid = ANY($2::text[])
      ORDER BY txid ASC
    `,
    [NETWORK, membership.expectedTxids],
  );
  const projection = workerWorkPrecisionPendingProjection({
    balanceRows: balanceResult.rows,
    eventRows: eventResult.rows,
    listingRows: listingResult.rows,
    transactionRows: transactionResult.rows,
  });
  const [coreTipAfter, mempoolAfter] = await Promise.all([
    readExactWorkerCoreTip(),
    readExactWorkerCoreMempoolSnapshot(),
  ]);
  const stableCore =
    coreTipBefore.height === coreTipAfter.height &&
    coreTipBefore.blockHash === coreTipAfter.blockHash;
  const mempoolBeforeTxids = new Set(mempoolBefore.txids);
  const mempoolAfterTxids = new Set(mempoolAfter.txids);
  const stableMempool = membership.expectedTxids.every(
    (txid) => mempoolBeforeTxids.has(txid) && mempoolAfterTxids.has(txid),
  );
  const parity = workerWorkPrecisionPendingParity({
    balanceRows: balanceResult.rows,
    eventRows: eventResult.rows,
    listingRows: listingResult.rows,
    mempoolTxids: mempoolAfter.txids,
    recoveryRows: recoveryResult.rows,
    transactionRows: transactionResult.rows,
  });
  const ready =
    witnessResult.rows.length === 1 &&
    stableCore &&
    stableMempool &&
    workerWorkPrecisionCoreTipReady(coreTipAfter, {
      tipHash: confirmedReplay.tipHash,
      tipHeight: confirmedReplay.tipHeight,
    }) &&
    workerWorkPrecisionPendingWitnessReady(witness, {
      coreTip: coreTipAfter,
      declarationConfig,
      invalidLegacyMutationCount:
        invalidLegacyResult.rows[0]?.invalid_count,
      mempoolSnapshot: mempoolAfter,
      parity,
      projection,
    });
  if (!ready) {
    throw new Error(
      "Proof index worker is fail-closed until the backfill-owned Q16 pending witness matches every persisted pending WORK transaction and the exact pending projection.",
    );
  }
  return {
    activationHeight: precision.activationHeight,
    confirmed: confirmedReplay,
    era: WORK_PRECISION_Q16_ERA,
    mempoolCount: mempoolAfter.count,
    mempoolSha256: mempoolAfter.sha256,
    pendingGeneratedAt: witness.generatedAt,
    pendingMembershipCount: membership.expectedTxidCount,
    pendingMembershipSha256: membership.expectedTxidsSha256,
    pendingProjectionSha256: projection.commitmentSha256,
    ready: true,
    replayRequired: true,
    tipHash: confirmedReplay.tipHash,
    tipHeight: confirmedReplay.tipHeight,
    transitionCount: confirmedReplay.transitionCount,
  };
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

export function workerWorkPrecisionFromMeta(value, network = NETWORK) {
  const state = objectRecord(value?.workPrecision);
  if (
    String(value?.network ?? "") !== String(network ?? "") ||
    state.era !== WORK_PRECISION_Q16_ERA
  ) {
    return null;
  }
  return {
    ...state,
    era: WORK_PRECISION_Q16_ERA,
    replayRequired: true,
  };
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

export function workerBackfillPhasePlan(
  sourceText = BACKFILL_SOURCES,
  storeCanonicalSummarySnapshot =
    BACKFILL_STORE_CANONICAL_SUMMARY_SNAPSHOT,
) {
  const sourceLabels = [
    ...new Set(
      String(sourceText ?? "")
        .split(/[,\s]+/u)
        .map((value) => value.trim())
        .filter(Boolean),
    ),
  ];
  const confirmedFirstHotPath =
    sourceLabels.length === 2 &&
    sourceLabels.includes("block-scan") &&
    sourceLabels.includes("mempool-scan");
  if (!confirmedFirstHotPath) {
    return [
      {
        canonicalBarrier: sourceLabels.includes("block-scan"),
        kind: "combined",
        sourceLabels,
        storeCanonicalSummarySnapshot: String(
          storeCanonicalSummarySnapshot ?? "",
        ),
      },
    ];
  }
  return [
    {
      canonicalBarrier: true,
      kind: "confirmed",
      sourceLabels: ["block-scan"],
      storeCanonicalSummarySnapshot: String(
        storeCanonicalSummarySnapshot ?? "",
      ),
    },
    {
      canonicalBarrier: false,
      kind: "best-effort-pending",
      sourceLabels: ["mempool-scan"],
      storeCanonicalSummarySnapshot: "0",
    },
  ];
}

export function runScript(
  scriptName,
  args = [],
  envOverrides = {},
  {
    forceKillGraceMs = CHILD_STOP_GRACE_MS,
    runtime = null,
    timeoutMs = BACKFILL_CHILD_TIMEOUT_MS,
  } = {},
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
    const wallClockBudgetMs = Math.max(
      1,
      Number(timeoutMs) || BACKFILL_CHILD_TIMEOUT_MS,
    );
    const forceKillAfterMs = Math.max(
      1,
      Number(forceKillGraceMs) || CHILD_STOP_GRACE_MS,
    );
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
        forceKillAfterMs,
      );
      forceKillTimer.unref?.();
    }, wallClockBudgetMs);
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
          `${scriptName} exceeded its ${wallClockBudgetMs}ms wall-clock budget`,
        );
        error.code = "POW_INDEX_CHILD_TIMEOUT";
        error.timeoutMs = wallClockBudgetMs;
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

export async function runBestEffortPendingBackfill(
  envOverrides,
  runtime,
  {
    args = [],
    forceKillGraceMs = PENDING_CHILD_STOP_GRACE_MS,
    scriptName = "backfill-proof-indexer.mjs",
    timeoutMs = PENDING_BACKFILL_CHILD_TIMEOUT_MS,
  } = {},
) {
  try {
    await runScript(scriptName, args, envOverrides, {
      forceKillGraceMs,
      runtime,
      timeoutMs,
    });
    return {
      attempted: true,
      error: null,
      ok: true,
      timedOut: false,
    };
  } catch (error) {
    if (runtime?.stopping || error?.code === "POW_INDEX_WORKER_STOPPING") {
      throw workerStoppingError();
    }
    return {
      attempted: true,
      error: cappedChildError(error?.message ?? error),
      ok: false,
      timedOut: error?.code === "POW_INDEX_CHILD_TIMEOUT",
    };
  }
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
          block_index = NULL,
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
          block_index = NULL,
          op_return_vout = NULL,
          record_ordinal = 0,
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
            OR block_index IS NOT NULL
            OR op_return_vout IS NOT NULL
            OR record_ordinal <> 0
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
        block_index = NULL,
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
        block_index = NULL,
        op_return_vout = NULL,
        record_ordinal = 0,
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
          JOIN proof_indexer.transactions event_tx
            ON event_tx.network = e.network
           AND event_tx.txid = e.txid
           AND event_tx.status = 'confirmed'
           AND event_tx.block_height = e.block_height
           AND event_tx.block_index = e.block_index
          WHERE e.network = $1
            AND e.txid = affected.listing_id
            AND e.kind = 'token-listing'
            AND e.status = 'confirmed'
            AND e.valid = true
          ORDER BY
            e.block_height DESC NULLS LAST,
            e.block_index DESC NULLS LAST,
            e.op_return_vout DESC NULLS LAST,
            e.record_ordinal DESC
          LIMIT 1
        ) base_event ON true
        LEFT JOIN LATERAL (
          SELECT e.txid, e.payload
          FROM proof_indexer.events e
          JOIN proof_indexer.transactions event_tx
            ON event_tx.network = e.network
           AND event_tx.txid = e.txid
           AND event_tx.status = 'confirmed'
           AND event_tx.block_height = e.block_height
           AND event_tx.block_index = e.block_index
          WHERE e.network = $1
            AND e.kind = 'token-listing-sealed'
            AND e.status = 'confirmed'
            AND e.valid = true
            AND e.txid <> $2
            AND lower(e.payload->>'listingId') = affected.listing_id
          ORDER BY
            e.block_height DESC NULLS LAST,
            e.block_index DESC NULLS LAST,
            e.op_return_vout DESC NULLS LAST,
            e.record_ordinal DESC
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
  let workPrecision;
  let workPrecisionRecoveryError = null;
  try {
    workPrecision = await assertWorkAtomicProjectionReady(pool, {
      q16Latched:
        runtime.workPrecisionEra === WORK_PRECISION_Q16_ERA,
    });
  } catch (error) {
    if (error?.workPrecision?.era === WORK_PRECISION_Q16_ERA) {
      runtime.workPrecisionEra = WORK_PRECISION_Q16_ERA;
      workPrecisionRecoveryError = cappedChildError(
        error?.message ?? error,
      );
      workPrecision = {
        ...error.workPrecision,
        readinessRecoveryRequired: true,
        readinessError: workPrecisionRecoveryError,
      };
      runtime.workPrecision = workPrecision;
    } else {
      throw error;
    }
  }
  runtime.workPrecisionEra = workPrecision.era;
  runtime.workPrecision = workPrecision;
  await assertAmoPositionSchemaReady(pool, workPrecision);
  await writeWorkerMeta(pool, {
    apiBase: API_BASE,
    lastSuccess,
    lastSuccessAt: lastSuccess?.finishedAt ?? null,
    network: NETWORK,
    noProgress,
    ok:
      Boolean(lastSuccess) &&
      workPrecision.ready !== false &&
      workPrecisionRecoveryError === null,
    startedAt: startedAt.toISOString(),
    state: "running",
    workPrecision,
    workPrecisionRecoveryError,
  });
  const commonBackfillEnv = {
    NETWORK,
    POW_API_BASE: API_BASE,
    POW_INDEX_BACKFILL_LIMIT: String(BACKFILL_LIMIT),
    POW_INDEX_BACKFILL_MAX_PAGES: String(BACKFILL_MAX_PAGES),
    POW_INDEX_BACKFILL_HOLDERS: INCLUDE_HOLDERS ? "1" : "0",
    POW_INDEX_BACKFILL_SNAPSHOT_FRESH: BACKFILL_SNAPSHOT_FRESH,
    POW_INDEX_BACKFILL_SOURCE_FRESH: BACKFILL_SOURCE_FRESH,
    POW_INDEX_BACKFILL_STORE_LEDGER_SNAPSHOT: BACKFILL_STORE_LEDGER_SNAPSHOT,
    POW_INDEX_BACKFILL_SUMMARY_SNAPSHOT_FRESH: BACKFILL_SUMMARY_SNAPSHOT_FRESH,
    POW_INDEX_BACKFILL_TOKEN_SNAPSHOT_FRESH: BACKFILL_TOKEN_SNAPSHOT_FRESH,
    POW_INDEX_DB_APP_NAME: "proof-indexer-worker-backfill",
  };
  const backfillPhases = workerBackfillPhasePlan(
    BACKFILL_SOURCES,
    BACKFILL_STORE_CANONICAL_SUMMARY_SNAPSHOT,
  );
  if (
    workPrecision.era === WORK_PRECISION_Q16_ERA &&
    !(
      backfillPhases.length === 2 &&
      backfillPhases[0]?.kind === "confirmed" &&
      backfillPhases[0]?.canonicalBarrier === true &&
      backfillPhases[1]?.kind === "best-effort-pending" &&
      backfillPhases[1]?.sourceLabels?.length === 1 &&
      backfillPhases[1].sourceLabels[0] === "mempool-scan"
    )
  ) {
    throw new Error(
      "Proof index worker requires confirmed block replay before the isolated pending rebuild in the AMO V8 Q16 era.",
    );
  }
  let canonicalProgress = null;
  let clearedNoProgress = noProgress;
  let canonicalPhase = null;
  let pendingBackfill = {
    attempted: false,
    error: null,
    ok: null,
    timedOut: null,
  };
  let pendingStatus = null;
  let workPrecisionReplay = {
    era: workPrecision.era,
    ready: workPrecision.era !== WORK_PRECISION_Q16_ERA,
    replayRequired: workPrecision.replayRequired === true,
  };
  let workPrecisionConfirmedReplay = {
    ...workPrecisionReplay,
    confirmedOnly: true,
  };
  const runBackfillPhase = async (phase) => {
    const backfillEnv = {
      ...commonBackfillEnv,
      POW_INDEX_BACKFILL_PENDING_ONLY:
        phase.kind === "best-effort-pending" ? "1" : "0",
      POW_INDEX_BACKFILL_PENDING_CHILD_TIMEOUT_MS:
        phase.kind === "best-effort-pending"
          ? String(PENDING_BACKFILL_CHILD_TIMEOUT_MS)
          : "",
      POW_INDEX_BACKFILL_SOURCES: phase.sourceLabels.join(","),
      POW_INDEX_BACKFILL_STORE_LEDGER_SNAPSHOT:
        phase.kind === "best-effort-pending"
          ? "0"
          : commonBackfillEnv.POW_INDEX_BACKFILL_STORE_LEDGER_SNAPSHOT,
      POW_INDEX_BACKFILL_STORE_CANONICAL_SUMMARY_SNAPSHOT:
        phase.storeCanonicalSummarySnapshot,
    };
    if (phase.kind === "best-effort-pending") {
      pendingBackfill = await runBestEffortPendingBackfill(
        backfillEnv,
        runtime,
      );
      if (!pendingBackfill.ok) {
        console.error(
          JSON.stringify({
            error: pendingBackfill.error,
            phase: "worker-pending-backfill",
            retrying: false,
            timedOut: pendingBackfill.timedOut,
          }),
        );
        if (workPrecision.era === WORK_PRECISION_Q16_ERA) {
          throw new Error(
            "Proof index worker cannot complete the AMO V8 cycle until the backfill-owned pending projection is rebuilt.",
          );
        }
      }
    } else {
      await runBackfillWithRetries(backfillEnv, runtime);
    }
    if (!phase.canonicalBarrier) {
      return;
    }
    canonicalProgress = await readCanonicalWorkerProgress(
      pool,
      runtime.network,
    );
    try {
      workPrecision = await assertWorkAtomicProjectionReady(pool, {
        q16Latched:
          runtime.workPrecisionEra === WORK_PRECISION_Q16_ERA,
      });
    } catch (error) {
      if (error?.workPrecision?.era === WORK_PRECISION_Q16_ERA) {
        runtime.workPrecisionEra = WORK_PRECISION_Q16_ERA;
        runtime.workPrecision = {
          ...error.workPrecision,
          readinessRecoveryRequired: true,
          readinessError: cappedChildError(error?.message ?? error),
        };
      }
      throw error;
    }
    runtime.workPrecisionEra = workPrecision.era;
    runtime.workPrecision = workPrecision;
    await assertAmoPositionSchemaReady(pool, workPrecision);
    workPrecisionConfirmedReplay =
      await assertWorkPrecisionReplayReady(
        pool,
        workPrecision,
      );
    workPrecisionReplay =
      workPrecision.era === WORK_PRECISION_Q16_ERA
        ? {
            confirmed: workPrecisionConfirmedReplay,
            era: WORK_PRECISION_Q16_ERA,
            pendingRequired: true,
            ready: false,
            replayRequired: true,
          }
        : workPrecisionConfirmedReplay;
    runtime.workPrecision = {
      ...workPrecision,
      replay: workPrecisionReplay,
    };
    clearedNoProgress = resetWorkerNoProgressState(
      noProgress,
      canonicalProgress,
      Date.now(),
      "canonical-scan-success",
      runtime.network,
    );
    runtime.noProgress = clearedNoProgress;
    const canonicalFinishedAt = new Date();
    canonicalPhase = {
      durationMs: canonicalFinishedAt.getTime() - startedAt.getTime(),
      finishedAt: canonicalFinishedAt.toISOString(),
      pendingStatus: lastSuccess?.pendingStatus ?? null,
      startedAt: startedAt.toISOString(),
    };
    await writeWorkerMeta(pool, {
      apiBase: API_BASE,
      backfillPhase: phase.kind,
      canonicalPhase,
      canonicalProgress,
      consecutiveFailures: 0,
      lastSuccess,
      lastSuccessAt: lastSuccess?.finishedAt ?? null,
      network: runtime.network,
      noProgress: clearedNoProgress,
      ok: workPrecisionReplay.ready === true,
      startedAt: startedAt.toISOString(),
      state: "canonical-phase-complete",
      workPrecision: runtime.workPrecision,
    });
  };
  const refreshPendingStatusesSafely = async () => {
    try {
      return await refreshPendingStatuses(pool);
    } catch (error) {
      const failedStatus = {
        checked: 0,
        deferred: 0,
        error: cappedChildError(error?.message ?? error),
        errors: 1,
        unavailable: true,
      };
      console.error(
        JSON.stringify({
          error: failedStatus.error,
          phase: "pending-status-scheduling",
        }),
      );
      return failedStatus;
    }
  };
  if (
    backfillPhases.length === 2 &&
    backfillPhases[0]?.kind === "confirmed" &&
    backfillPhases[1]?.kind === "best-effort-pending"
  ) {
    await runCanonicalBeforePending(
      () => runBackfillPhase(backfillPhases[0]),
      async () => {
        pendingStatus = await refreshPendingStatusesSafely();
        await runBackfillPhase(backfillPhases[1]);
      },
    );
  } else {
    for (const phase of backfillPhases) {
      await runBackfillPhase(phase);
    }
    pendingStatus = await refreshPendingStatusesSafely();
  }
  if (!canonicalProgress) {
    canonicalProgress = await readCanonicalWorkerProgress(
      pool,
      runtime.network,
    );
    clearedNoProgress = resetWorkerNoProgressState(
      noProgress,
      canonicalProgress,
      Date.now(),
      "canonical-scan-success",
      runtime.network,
    );
    runtime.noProgress = clearedNoProgress;
  }
  workPrecisionConfirmedReplay = await assertWorkPrecisionReplayReady(
    pool,
    workPrecision,
  );
  workPrecisionReplay =
    workPrecision.era === WORK_PRECISION_Q16_ERA
      ? await assertWorkPrecisionPendingReady(
          pool,
          workPrecision,
          workPrecisionConfirmedReplay,
        )
      : workPrecisionConfirmedReplay;
  runtime.workPrecision = {
    ...workPrecision,
    pendingRebuild:
      backfillPhases.some(
        (phase) => phase.kind === "best-effort-pending",
      )
        ? {
            model: WORK_AMO_V8_PENDING_REBUILD_MODEL,
            owner: "backfill",
            ready: workPrecisionReplay.ready === true,
          }
        : "not-configured",
    replay: workPrecisionReplay,
  };
  if (runtime.stopping) {
    throw workerStoppingError();
  }
  workPrecisionConfirmedReplay = await assertWorkPrecisionReplayReady(
    pool,
    workPrecision,
  );
  workPrecisionReplay =
    workPrecision.era === WORK_PRECISION_Q16_ERA
      ? await assertWorkPrecisionPendingReady(
          pool,
          workPrecision,
          workPrecisionConfirmedReplay,
        )
      : workPrecisionConfirmedReplay;
  runtime.workPrecision = {
    ...runtime.workPrecision,
    pendingRebuild:
      workPrecision.era === WORK_PRECISION_Q16_ERA
        ? {
            model: WORK_AMO_V8_PENDING_REBUILD_MODEL,
            owner: "backfill",
            ready: workPrecisionReplay.ready === true,
          }
        : runtime.workPrecision.pendingRebuild,
    replay: workPrecisionReplay,
  };

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
    workPrecision: runtime.workPrecision,
  };
  const value = {
    apiBase: API_BASE,
    backfillLimit: BACKFILL_LIMIT,
    backfillMaxPages: BACKFILL_MAX_PAGES,
    backfillPhases: backfillPhases.map((phase) => ({
      kind: phase.kind,
      sources: phase.sourceLabels,
      storeCanonicalSummarySnapshot:
        phase.storeCanonicalSummarySnapshot,
    })),
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
    pendingBackfill,
    pendingBackfillTimeoutMs: PENDING_BACKFILL_CHILD_TIMEOUT_MS,
    pendingStatus,
    startedAt: currentSuccess.startedAt,
    state: "idle",
    workPrecision: runtime.workPrecision,
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
    const declarationConfig = workerWorkAmoV8DeclarationConfig();
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
          pendingBackfillTimeoutMs: PENDING_BACKFILL_CHILD_TIMEOUT_MS,
          pendingBackfillStopGraceMs: PENDING_CHILD_STOP_GRACE_MS,
          backfillRetries: BACKFILL_RETRIES,
          backfillRetryDelayMs: BACKFILL_RETRY_DELAY_MS,
          backfillPhases: workerBackfillPhasePlan(
            BACKFILL_SOURCES,
            BACKFILL_STORE_CANONICAL_SUMMARY_SNAPSHOT,
          ),
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
          workAmoV8Declaration: {
            activationHeight: declarationConfig.activationHeight,
            configured: declarationConfig.configured,
            requested: declarationConfig.requested,
          },
          workPrecisionPolicy:
            "q8-before-v8-boundary-q16-latched-no-fallback",
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
    runtime.workPrecision = workerWorkPrecisionFromMeta(
      previousMeta,
      runtime.network,
    );
    runtime.workPrecisionEra =
      runtime.workPrecision?.era ?? "";
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
      workPrecision: runtime.workPrecision,
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
          workPrecision: runtime.workPrecision,
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
