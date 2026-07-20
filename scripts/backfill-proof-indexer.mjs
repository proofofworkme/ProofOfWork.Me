import { createHash, randomBytes } from "node:crypto";
import { request as httpRequest } from "node:http";
import net from "node:net";

import * as bitcoin from "bitcoinjs-lib";

import {
  decimalTextFromQ8,
  q8TextFromDecimal,
} from "../server/bond-units.mjs";
import { createProofIndexPool } from "../server/db/postgres.mjs";
import {
  INCB_RANGE_REPLAY_EXACT_MINT_LEGACY_SNAPSHOT_MODE,
  INCB_RANGE_REPLAY_WITNESS_MANIFEST_MODEL,
  buildIncbRangeReplayWitnessManifest,
  canonicalIncbReplaySha256,
  incbRangeReplayWitnessBindingFields,
  incbRangeReplayWitnessMetaKey,
  incbReplayRawSnapshotFingerprint,
  incbReplaySnapshotFingerprint,
  normalizeIncbReplaySnapshotDescriptor,
  verifyIncbRangeReplayWitnessManifest,
} from "../server/incb-range-replay-witness.mjs";
import {
  WORK_ATOMIC_PROJECTION_MODEL,
  WORK_DECIMALS,
  WORK_TOKEN_ID,
  WORK_UNIT_SCALE,
  WORK_UNIT_SCALE_TEXT,
  WORK_VALUE_Q8_SCALE as VALUE_Q8_SCALE,
  decimalValueToQ8,
  formatWorkAtoms,
  isWorkTokenId,
  normalizeWorkAtoms,
  parseSignedWorkAmountToAtoms,
  parseWorkAmountToAtoms,
  withWorkPrecisionMetadata,
  workAmountAtomsFromRecord,
  workAmountFields,
  workAtomsValueAtFloorQ8,
} from "../server/work-units.mjs";

const DEFAULT_API_BASE = "http://127.0.0.1:8081";
const CONFIGURED_API_BASE = String(process.env.POW_API_BASE ?? "").trim();
const API_BASE_EXPLICIT = CONFIGURED_API_BASE.length > 0;
const CANONICAL_TX_CONTENT_FAILURE_CODE =
  "POW_CANONICAL_TX_CONTENT_INVARIANT";
const CANONICAL_TX_CONTENT_FAILURE_CLASS =
  "CanonicalTransactionContentInvariantError";

class CanonicalTransactionContentInvariantError extends Error {
  constructor(message) {
    super(message);
    this.code = CANONICAL_TX_CONTENT_FAILURE_CODE;
    this.name = CANONICAL_TX_CONTENT_FAILURE_CLASS;
  }
}

const API_BASE = String(CONFIGURED_API_BASE || DEFAULT_API_BASE).replace(
  /\/+$/u,
  "",
);
const PWT_RANGE_REPLAY_VERIFIER_BINDING_MODEL =
  "proof-indexer-pwt-range-replay-verifier-binding-v1";
const WORK_NETWORK_VALUE_ACCOUNTING_MODEL =
  "canonical-exact-work-network-q8-v1";
let ACTIVE_PWT_RANGE_REPLAY_VERIFIER_BINDING = null;
const NETWORK = process.env.NETWORK ?? "livenet";
const PUBLIC_LOG_EVENT_KINDS = new Set([
  "attachment",
  "browser",
  "file",
  "id-buy",
  "id-delist",
  "id-list",
  "id-register",
  "id-seal",
  "id-transfer",
  "id-update",
  "inception-bond",
  "infinity-bond",
  "mail",
  "reply",
  "rush-mint",
  "token-create",
  "token-listing",
  "token-listing-closed",
  "token-listing-sealed",
  "token-mint",
  "token-sale",
  "token-transfer",
]);
const PAGE_LIMIT = Number(process.env.POW_INDEX_BACKFILL_LIMIT ?? 200);
const MAX_PAGES = Number(process.env.POW_INDEX_BACKFILL_MAX_PAGES ?? 2000);
const REQUEST_TIMEOUT_MS = Number(process.env.POW_INDEX_FETCH_TIMEOUT_MS ?? 60_000);
const REQUEST_RETRIES = Number(process.env.POW_INDEX_FETCH_RETRIES ?? 4);
const CANONICAL_SUMMARY_RESPONSE_MAX_BYTES = 64 * 1024 * 1024;
// A deliberate derived-snapshot invalidation leaves the first canonical
// summary refresh with no warm read model. Keep the ordinary default bounded,
// but allow a supervised cold rebuild enough time to finish and publish one
// exact hash-bound snapshot instead of being killed by the old 220s ceiling.
const CANONICAL_SUMMARY_REFRESH_TIMEOUT_MS = Math.min(
  10 * 60_000,
  Math.max(
    30_000,
    Math.floor(
      Number(
        process.env.POW_INDEX_CANONICAL_SUMMARY_REFRESH_TIMEOUT_MS ?? 120_000,
      ) || 120_000,
    ),
  ),
);
const BITCOIN_RPC_TIMEOUT_MS = Math.min(
  30_000,
  Math.max(
    1_000,
    Math.floor(
      Number(process.env.POW_INDEX_BITCOIN_RPC_TIMEOUT_MS ?? 15_000) || 15_000,
    ),
  ),
);
const BITCOIN_RPC_RETRIES = Math.min(
  3,
  Math.max(
    0,
    Math.floor(Number(process.env.POW_INDEX_BITCOIN_RPC_RETRIES ?? 2) || 0),
  ),
);
const BITCOIN_RPC_URL = String(process.env.BITCOIN_RPC_URL ?? "").trim();
const BITCOIN_RPC_USER = String(process.env.BITCOIN_RPC_USER ?? "").trim();
const BITCOIN_RPC_PASSWORD = String(process.env.BITCOIN_RPC_PASSWORD ?? "").trim();
const INTERNAL_VERIFIER_TOKEN = String(
  process.env.POW_INTERNAL_VERIFIER_TOKEN ?? "",
).trim();
const REPAIR_MINT_MINTERS = /^(?:1|true|yes)$/iu.test(
  String(process.env.POW_INDEX_REPAIR_MINT_MINTERS ?? ""),
);
const REPAIR_MINT_MINTERS_LIMIT = Number(
  process.env.POW_INDEX_REPAIR_MINT_MINTERS_LIMIT ?? 500,
);
const REPAIR_WORK_PARTICIPANTS =
  process.argv.includes("--repair-work-participants") ||
  /^(?:1|true|yes)$/iu.test(
    String(process.env.POW_INDEX_REPAIR_WORK_PARTICIPANTS ?? ""),
  );
const REPAIR_WORK_PARTICIPANTS_ONLY = process.argv.includes(
  "--repair-work-participants",
);
const REPAIR_WORK_PARTICIPANTS_LIMIT = Number(
  process.env.POW_INDEX_REPAIR_WORK_PARTICIPANTS_LIMIT ?? 500,
);
const REPAIR_WORK_PARTICIPANTS_TXIDS = [
  ...new Set(
    String(process.env.POW_INDEX_REPAIR_WORK_PARTICIPANTS_TXIDS ?? "")
      .split(/[,\s]+/u)
      .map((value) => value.trim().toLowerCase())
      .filter((value) => /^[0-9a-f]{64}$/u.test(value)),
  ),
];
const REPAIR_ID_TXIDS = [
  ...new Set(
    String(process.env.POW_INDEX_REPAIR_ID_TXIDS ?? "")
      .split(/[,\s]+/u)
      .map((value) => value.trim().toLowerCase())
      .filter((value) => /^[0-9a-f]{64}$/u.test(value)),
  ),
];
const REPAIR_CANONICAL_TXIDS = [
  ...new Set(
    String(process.env.POW_INDEX_REPAIR_CANONICAL_TXIDS ?? "")
      .split(/[,\s]+/u)
      .map((value) => value.trim().toLowerCase())
      .filter(Boolean),
  ),
];
const REPAIR_INCB_ISSUANCE_TXIDS = [
  ...new Set(
    String(process.env.POW_INDEX_REPAIR_INCB_ISSUANCE_TXIDS ?? "")
      .split(/[,\s]+/u)
      .map((value) => value.trim().toLowerCase())
      .filter((value) => /^[0-9a-f]{64}$/u.test(value)),
  ),
];
const BLOCK_SCAN_MAX_BLOCKS = Number(
  process.env.POW_INDEX_BACKFILL_BLOCK_SCAN_MAX_BLOCKS ?? 2_000,
);
const BLOCK_SCAN_MAX_TXIDS = Number(
  process.env.POW_INDEX_BACKFILL_BLOCK_SCAN_MAX_TXIDS ?? 5_000,
);
const PREVOUT_HYDRATION_CONCURRENCY = Math.min(
  8,
  Math.max(
    1,
    Math.floor(
      Number(process.env.POW_INDEX_PREVOUT_HYDRATION_CONCURRENCY ?? 4) || 4,
    ),
  ),
);
const BLOCK_SCAN_FROM_HEIGHT = Number(
  process.env.POW_INDEX_BACKFILL_BLOCK_SCAN_FROM_HEIGHT ?? 0,
);
const CANONICAL_INCB_PWT_RANGE_REPLAY_FROM_HEIGHT = 958_383;
const CANONICAL_REBUILD = /^(?:1|true|yes)$/iu.test(
  String(process.env.POW_INDEX_BACKFILL_CANONICAL_REBUILD ?? ""),
);
const MEMPOOL_SCAN_MAX_TXIDS = Number(
  process.env.POW_INDEX_MEMPOOL_SCAN_MAX_TXIDS ?? 500,
);
const MEMPOOL_SCAN_MAX_PROTOCOL_TXIDS = Math.min(
  5,
  Math.max(
    1,
    Math.floor(
      Number(process.env.POW_INDEX_MEMPOOL_SCAN_MAX_PROTOCOL_TXIDS ?? 5) || 5,
    ),
  ),
);
const PENDING_VERIFIER_TIMEOUT_MS = Math.min(
  5_000,
  Math.max(
    1_000,
    Math.floor(
      Number(process.env.POW_INDEX_PENDING_VERIFIER_TIMEOUT_MS ?? 5_000) ||
        5_000,
    ),
  ),
);
const PENDING_LEGACY_VERIFIER_TIMEOUT_MS = 30_000;
const MEMPOOL_SCAN_SEEN_LIMIT = Number(
  process.env.POW_INDEX_MEMPOOL_SCAN_SEEN_LIMIT ?? 10_000,
);
// Only protocols with a canonical block-scan parser/verifier belong here.
// pwc1 remains staged. RUSH is indexed as an ordered, full-node-verified
// stream so canonical summaries never need to replay its complete history.
const PROTOCOL_PREFIXES = ["pwm1:", "pwid1:", "pwr1:", "pwt1:"];
const RUSH_PROTOCOL_PREFIX = "pwr1:";
const RUSH_MINT_PAYLOAD = "pwr1:m:rush";
const RUSH_REGISTRY_ADDRESS = "bc1qym392dfvfm024k7ukzlnvnpfvuu4kfqvu56w3e";
const RUSH_MINT_PRICE_SATS = 1_000n;
const RUSH_BOOTSTRAP_META_KEY = `rushCanonicalBootstrap:${NETWORK}`;
const RUSH_DISCOVERY_META_KEY = `rushCanonicalDiscovery:${NETWORK}`;
const RUSH_BOOTSTRAP_VERSION = 1;
const RUSH_BOOTSTRAP_ONLY = process.argv.includes("--bootstrap-rush");
const RUSH_BOOTSTRAP_ENABLED =
  RUSH_BOOTSTRAP_ONLY ||
  !/^(?:0|false|no|off)$/iu.test(
    String(process.env.POW_INDEX_RUSH_BOOTSTRAP_ENABLED ?? "1"),
  );
const RUSH_BOOTSTRAP_BATCH_SIZE = Math.min(
  1_000,
  Math.max(
    1,
    Math.floor(
      Number(process.env.POW_INDEX_RUSH_BOOTSTRAP_BATCH_SIZE ?? 250) || 250,
    ),
  ),
);
const RUSH_BOOTSTRAP_MAX_TXIDS = Math.max(
  0,
  Math.floor(
    Number(
      process.env.POW_INDEX_RUSH_BOOTSTRAP_MAX_TXIDS ??
        (RUSH_BOOTSTRAP_ONLY ? 0 : RUSH_BOOTSTRAP_BATCH_SIZE),
    ) || 0,
  ),
);
const RUSH_ELECTRUM_HOST = String(
  process.env.ELECTRUM_HOST ?? "127.0.0.1",
).trim();
const RUSH_ELECTRUM_PORT = Number(process.env.ELECTRUM_PORT ?? 50_001);
const RUSH_ELECTRUM_TIMEOUT_MS = Math.min(
  180_000,
  Math.max(
    10_000,
    Math.floor(
      Number(process.env.POW_INDEX_RUSH_ELECTRUM_TIMEOUT_MS ?? 120_000) ||
        120_000,
    ),
  ),
);
const MAIL_ATTACHMENT_MAX_BYTES = 60_000;
const INCLUDE_SCOPED_HOLDERS = !/^(?:0|false|no)$/iu.test(
  String(process.env.POW_INDEX_BACKFILL_HOLDERS ?? "1"),
);
const REFRESH_ACTIVITY_SNAPSHOT = /^(?:1|true|yes)$/iu.test(
  String(process.env.POW_INDEX_BACKFILL_ACTIVITY_SNAPSHOT ?? ""),
);
const REFRESH_SNAPSHOT_SOURCES = /^(?:1|true|yes)$/iu.test(
  String(process.env.POW_INDEX_BACKFILL_SNAPSHOT_FRESH ?? ""),
);
const REFRESH_TOKEN_SNAPSHOT_SOURCES = /^(?:1|true|yes)$/iu.test(
  String(
    process.env.POW_INDEX_BACKFILL_TOKEN_SNAPSHOT_FRESH ??
      process.env.POW_INDEX_BACKFILL_SNAPSHOT_FRESH ??
      "",
  ),
);
const REFRESH_ALL_TOKEN_SNAPSHOT_SOURCES = /^(?:1|true|yes)$/iu.test(
  String(process.env.POW_INDEX_BACKFILL_ALL_TOKEN_SNAPSHOT_FRESH ?? ""),
);
const REFRESH_SUMMARY_SNAPSHOT_SOURCES = /^(?:1|true|yes)$/iu.test(
  String(
    process.env.POW_INDEX_BACKFILL_SUMMARY_SNAPSHOT_FRESH ??
      process.env.POW_INDEX_BACKFILL_SNAPSHOT_FRESH ??
      "",
  ),
);
const REFRESH_SOURCE_READS = /^(?:1|true|yes)$/iu.test(
  String(process.env.POW_INDEX_BACKFILL_SOURCE_FRESH ?? ""),
);
const MAIL_BACKFILL_ADDRESS_LIMIT = Number(
  process.env.POW_INDEX_BACKFILL_MAIL_ADDRESS_LIMIT ?? 200,
);
const DRY_RUN = process.argv.includes("--dry-run");
const PREPARE_CANONICAL_REBUILD_ONLY = process.argv.includes(
  "--prepare-canonical-rebuild",
);
const PREPARE_CANONICAL_PWT_RANGE_REPLAY_ONLY = process.argv.includes(
  "--prepare-canonical-pwt-range-replay",
);
const REPAIR_ID_TXIDS_ONLY = process.argv.includes("--repair-id-txids");
const REPAIR_CANONICAL_TXIDS_ONLY = process.argv.includes(
  "--repair-canonical-txids",
);
const REPAIR_INCB_ISSUANCE_ONLY = process.argv.includes(
  "--repair-incb-issuance",
);
const HYDRATE_TRANSACTION_DETAILS_ONLY = process.argv.includes(
  "--hydrate-transaction-details",
);
const AUDIT_WORK_ATOMS_ONLY = process.argv.includes("--audit-work-atoms");
const MIGRATE_WORK_ATOMS_ONLY = process.argv.includes("--migrate-work-atoms");
const VERIFY_WORK_ATOMS_POST_BOOTSTRAP_ONLY = process.argv.includes(
  "--verify-work-atoms-post-bootstrap",
);
const APPLY_WORK_ATOMIC_MIGRATION = /^(?:1|true|yes)$/iu.test(
  String(process.env.POW_INDEX_WORK_ATOMIC_MIGRATION_APPLY ?? ""),
);
const TX_DETAIL_HYDRATION_BATCH_SIZE = Number(
  process.env.POW_INDEX_TX_DETAIL_HYDRATION_BATCH_SIZE ?? 200,
);
const TX_DETAIL_HYDRATION_MAX_ROWS = Number(
  process.env.POW_INDEX_TX_DETAIL_HYDRATION_MAX_ROWS ?? 10_000,
);
const TX_DETAIL_HYDRATION_AFTER_HEIGHT = Number(
  process.env.POW_INDEX_TX_DETAIL_HYDRATION_AFTER_HEIGHT ?? -1,
);
const TX_DETAIL_HYDRATION_AFTER_BLOCK_INDEX = Number(
  process.env.POW_INDEX_TX_DETAIL_HYDRATION_AFTER_BLOCK_INDEX ?? -1,
);
const TX_DETAIL_HYDRATION_AFTER_TXID = String(
  process.env.POW_INDEX_TX_DETAIL_HYDRATION_AFTER_TXID ?? "",
)
  .trim()
  .toLowerCase();

function explicitLoopbackApiBaseConfigured() {
  if (!API_BASE_EXPLICIT) {
    return false;
  }
  try {
    const url = new URL(API_BASE);
    return (
      url.protocol === "http:" &&
      ["127.0.0.1", "::1", "[::1]", "localhost"].includes(
        url.hostname.toLowerCase(),
      )
    );
  } catch {
    return false;
  }
}

function assertCanonicalRebuildConfiguration() {
  const verifyWorkAtomsPostBootstrapOnly =
    typeof VERIFY_WORK_ATOMS_POST_BOOTSTRAP_ONLY !== "undefined" &&
    VERIFY_WORK_ATOMS_POST_BOOTSTRAP_ONLY;
  const exclusiveMaintenanceModes = [
    HYDRATE_TRANSACTION_DETAILS_ONLY,
    PREPARE_CANONICAL_REBUILD_ONLY,
    PREPARE_CANONICAL_PWT_RANGE_REPLAY_ONLY,
    REPAIR_CANONICAL_TXIDS_ONLY,
    REPAIR_ID_TXIDS_ONLY,
    REPAIR_INCB_ISSUANCE_ONLY,
    REPAIR_WORK_PARTICIPANTS_ONLY,
    RUSH_BOOTSTRAP_ONLY,
    AUDIT_WORK_ATOMS_ONLY,
    MIGRATE_WORK_ATOMS_ONLY,
    verifyWorkAtomsPostBootstrapOnly,
  ].filter(Boolean).length;
  if (exclusiveMaintenanceModes > 1) {
    throw new Error(
      "Indexer audit, migration, rebuild, bootstrap, hydration, and repair modes are mutually exclusive.",
    );
  }
  if (MIGRATE_WORK_ATOMS_ONLY && !APPLY_WORK_ATOMIC_MIGRATION) {
    throw new Error(
      "--migrate-work-atoms requires POW_INDEX_WORK_ATOMIC_MIGRATION_APPLY=1.",
    );
  }
  if (
    (AUDIT_WORK_ATOMS_ONLY ||
      MIGRATE_WORK_ATOMS_ONLY ||
      verifyWorkAtomsPostBootstrapOnly) &&
    (CANONICAL_REBUILD || NETWORK !== "livenet")
  ) {
    throw new Error(
      "WORK atomic projection audit/migration requires NETWORK=livenet and canonical rebuild mode off.",
    );
  }
  if (
    HYDRATE_TRANSACTION_DETAILS_ONLY &&
    (PREPARE_CANONICAL_REBUILD_ONLY ||
      PREPARE_CANONICAL_PWT_RANGE_REPLAY_ONLY ||
      REPAIR_CANONICAL_TXIDS_ONLY ||
      REPAIR_ID_TXIDS_ONLY ||
      REPAIR_INCB_ISSUANCE_ONLY ||
      REPAIR_WORK_PARTICIPANTS_ONLY ||
      AUDIT_WORK_ATOMS_ONLY ||
      MIGRATE_WORK_ATOMS_ONLY ||
      verifyWorkAtomsPostBootstrapOnly ||
      CANONICAL_REBUILD)
  ) {
    throw new Error(
      "Historical transaction-detail hydration is exclusive with rebuild and repair modes.",
    );
  }
  if (HYDRATE_TRANSACTION_DETAILS_ONLY) {
    if (
      !Number.isSafeInteger(TX_DETAIL_HYDRATION_BATCH_SIZE) ||
      TX_DETAIL_HYDRATION_BATCH_SIZE < 1 ||
      TX_DETAIL_HYDRATION_BATCH_SIZE > 500 ||
      !Number.isSafeInteger(TX_DETAIL_HYDRATION_MAX_ROWS) ||
      TX_DETAIL_HYDRATION_MAX_ROWS < 1 ||
      TX_DETAIL_HYDRATION_MAX_ROWS > 100_000
    ) {
      throw new Error(
        "Historical transaction-detail hydration requires batch size 1-500 and max rows 1-100000.",
      );
    }
    if (
      !Number.isSafeInteger(TX_DETAIL_HYDRATION_AFTER_HEIGHT) ||
      TX_DETAIL_HYDRATION_AFTER_HEIGHT < -1 ||
      !Number.isSafeInteger(TX_DETAIL_HYDRATION_AFTER_BLOCK_INDEX) ||
      TX_DETAIL_HYDRATION_AFTER_BLOCK_INDEX < -1 ||
      (TX_DETAIL_HYDRATION_AFTER_HEIGHT === -1 &&
        (TX_DETAIL_HYDRATION_AFTER_BLOCK_INDEX !== -1 ||
          TX_DETAIL_HYDRATION_AFTER_TXID)) ||
      (TX_DETAIL_HYDRATION_AFTER_BLOCK_INDEX >= 0 &&
        TX_DETAIL_HYDRATION_AFTER_HEIGHT < 0) ||
      (TX_DETAIL_HYDRATION_AFTER_TXID &&
        (TX_DETAIL_HYDRATION_AFTER_BLOCK_INDEX < 0 ||
          !isHexTxid(TX_DETAIL_HYDRATION_AFTER_TXID)))
    ) {
      throw new Error(
        "Historical transaction-detail hydration has an invalid resume cursor.",
      );
    }
    return;
  }
  if (
    PREPARE_CANONICAL_REBUILD_ONLY &&
    PREPARE_CANONICAL_PWT_RANGE_REPLAY_ONLY
  ) {
    throw new Error("Canonical full rebuild and PWT range replay are exclusive.");
  }
  if (
    REPAIR_CANONICAL_TXIDS_ONLY &&
    (PREPARE_CANONICAL_REBUILD_ONLY ||
      PREPARE_CANONICAL_PWT_RANGE_REPLAY_ONLY ||
      REPAIR_ID_TXIDS_ONLY ||
      REPAIR_INCB_ISSUANCE_ONLY ||
      REPAIR_WORK_PARTICIPANTS_ONLY ||
      RUSH_BOOTSTRAP_ONLY ||
      CANONICAL_REBUILD)
  ) {
    throw new Error(
      "Canonical transaction-row repair is exclusive with rebuild and other repair modes.",
    );
  }
  if (
    REPAIR_CANONICAL_TXIDS_ONLY &&
    (REPAIR_CANONICAL_TXIDS.length === 0 ||
      REPAIR_CANONICAL_TXIDS.some((txid) => !isHexTxid(txid)))
  ) {
    throw new Error(
      "--repair-canonical-txids requires POW_INDEX_REPAIR_CANONICAL_TXIDS containing only complete transaction ids",
    );
  }
  if (REPAIR_CANONICAL_TXIDS_ONLY && !BITCOIN_RPC_URL) {
    throw new Error(
      "--repair-canonical-txids requires BITCOIN_RPC_URL for first-party canonical verification",
    );
  }
  if (REPAIR_CANONICAL_TXIDS_ONLY) {
    return;
  }
  if (
    REPAIR_ID_TXIDS_ONLY &&
    (PREPARE_CANONICAL_REBUILD_ONLY ||
      PREPARE_CANONICAL_PWT_RANGE_REPLAY_ONLY ||
      REPAIR_CANONICAL_TXIDS_ONLY ||
      REPAIR_INCB_ISSUANCE_ONLY)
  ) {
    throw new Error("Canonical ID repair and replay preparation are exclusive.");
  }
  if (REPAIR_ID_TXIDS_ONLY && REPAIR_ID_TXIDS.length === 0) {
    throw new Error(
      "--repair-id-txids requires POW_INDEX_REPAIR_ID_TXIDS with at least one transaction id",
    );
  }
  if (
    REPAIR_INCB_ISSUANCE_ONLY &&
    (PREPARE_CANONICAL_REBUILD_ONLY ||
      PREPARE_CANONICAL_PWT_RANGE_REPLAY_ONLY ||
      REPAIR_CANONICAL_TXIDS_ONLY ||
      REPAIR_ID_TXIDS_ONLY ||
      REPAIR_WORK_PARTICIPANTS_ONLY ||
      CANONICAL_REBUILD)
  ) {
    throw new Error(
      "Canonical INCB issuance repair is exclusive with rebuild and other repair modes.",
    );
  }
  if (
    REPAIR_INCB_ISSUANCE_ONLY &&
    REPAIR_INCB_ISSUANCE_TXIDS.length === 0
  ) {
    throw new Error(
      "--repair-incb-issuance requires POW_INDEX_REPAIR_INCB_ISSUANCE_TXIDS with at least one transaction id",
    );
  }
  if (PREPARE_CANONICAL_REBUILD_ONLY && !CANONICAL_REBUILD) {
    throw new Error(
      "--prepare-canonical-rebuild requires POW_INDEX_BACKFILL_CANONICAL_REBUILD=1",
    );
  }
  if (PREPARE_CANONICAL_PWT_RANGE_REPLAY_ONLY) {
    if (
      CANONICAL_REBUILD ||
      NETWORK !== "livenet" ||
      !explicitLoopbackApiBaseConfigured() ||
      !Number.isSafeInteger(BLOCK_SCAN_FROM_HEIGHT) ||
      BLOCK_SCAN_FROM_HEIGHT !==
        CANONICAL_INCB_PWT_RANGE_REPLAY_FROM_HEIGHT
    ) {
      throw new Error(
        `--prepare-canonical-pwt-range-replay requires NETWORK=livenet, canonical rebuild mode off, an explicit loopback POW_API_BASE, and POW_INDEX_BACKFILL_BLOCK_SCAN_FROM_HEIGHT=${CANONICAL_INCB_PWT_RANGE_REPLAY_FROM_HEIGHT}`,
      );
    }
    return;
  }
  if (!CANONICAL_REBUILD) {
    return;
  }
  if (
    NETWORK !== "livenet" ||
    !Number.isSafeInteger(BLOCK_SCAN_FROM_HEIGHT) ||
    BLOCK_SCAN_FROM_HEIGHT <= 0
  ) {
    throw new Error(
      "POW_INDEX_BACKFILL_CANONICAL_REBUILD=1 requires NETWORK=livenet and an explicit positive POW_INDEX_BACKFILL_BLOCK_SCAN_FROM_HEIGHT",
    );
  }
}

function validateCanonicalRebuildConfigurationAtStartup() {
  assertCanonicalRebuildConfiguration();
}

validateCanonicalRebuildConfigurationAtStartup();
const DB_SUMMARY_REPAIR = /^(?:1|true|yes)$/iu.test(
  String(process.env.POW_INDEX_DB_SUMMARY_REPAIR ?? ""),
);
const SOURCE_FILTER = new Set(
  String(process.env.POW_INDEX_BACKFILL_SOURCES ?? "")
    .split(/[,\s]+/u)
    .map((value) => value.trim())
    .filter(Boolean),
);
const ALL_SOURCES = [
  { blockScan: true, label: "block-scan" },
  { label: "mempool-scan", mempoolScan: true },
  { label: "log", path: "/api/v1/log-history" },
  { label: "registry-records", path: "/api/v1/registry-history", params: { kind: "records" } },
  { label: "registry-pending", path: "/api/v1/registry-history", params: { kind: "pending" } },
  { label: "registry-listings", path: "/api/v1/registry-history", params: { kind: "listings" } },
  { label: "registry-sales", path: "/api/v1/registry-history", params: { kind: "sales" } },
  { label: "tokens", path: "/api/v1/token-history", params: { kind: "tokens" } },
  { label: "token-mints", path: "/api/v1/token-history", params: { kind: "mints" } },
  { label: "token-transfers", path: "/api/v1/token-history", params: { kind: "transfers" } },
  { label: "token-listings", path: "/api/v1/token-history", params: { kind: "listings" } },
  {
    label: "token-closed-listings",
    path: "/api/v1/token-history",
    params: { kind: "closed-listings" },
  },
  { label: "token-sales", path: "/api/v1/token-history", params: { kind: "sales" } },
  {
    label: "token-invalid-events",
    path: "/api/v1/token-history",
    params: { kind: "invalid-events" },
  },
  { addressMail: true, label: "address-mail" },
];
const SOURCES = SOURCE_FILTER.size
  ? ALL_SOURCES.filter((source) => SOURCE_FILTER.has(source.label))
  : ALL_SOURCES;
const STORE_LEDGER_SNAPSHOT = (() => {
  const configured = String(
    process.env.POW_INDEX_BACKFILL_STORE_LEDGER_SNAPSHOT ?? "",
  ).trim();
  if (configured) {
    return /^(?:1|true|yes)$/iu.test(configured);
  }
  return SOURCES.some(
    (source) => !source.blockScan && !source.mempoolScan,
  );
})();
const STORE_CANONICAL_SUMMARY_SNAPSHOT = /^(?:1|true|yes)$/iu.test(
  String(process.env.POW_INDEX_BACKFILL_STORE_CANONICAL_SUMMARY_SNAPSHOT ?? ""),
);

const LEDGER_CANONICAL_SUMMARY_RETENTION = Math.max(
  512,
  Math.min(
    20_000,
    Math.floor(
      Number(
        process.env.POW_INDEX_LEDGER_CANONICAL_SUMMARY_RETENTION ?? 4_096,
      ) || 4_096,
    ),
  ),
);
const LEDGER_SCAN_SNAPSHOT_RETENTION = Math.max(
  5_000,
  Math.min(
    100_000,
    Math.floor(
      Number(process.env.POW_INDEX_LEDGER_SCAN_SNAPSHOT_RETENTION ?? 20_000) ||
        20_000,
    ),
  ),
);
const WORK_TOKEN_MAX_SUPPLY = 21_000_000;
const WORK_TOKEN_MINT_AMOUNT = 1_000;
const WORK_TOKEN_MAX_SUPPLY_ATOMS = (
  BigInt(WORK_TOKEN_MAX_SUPPLY) * WORK_UNIT_SCALE
).toString();
const WORK_TOKEN_MINT_AMOUNT_ATOMS = (
  BigInt(WORK_TOKEN_MINT_AMOUNT) * WORK_UNIT_SCALE
).toString();
const WORK_TOKEN_MINT_PRICE_SATS = 1_000;
const WORK_TOKEN_REGISTRY_ADDRESS = "1638Vn6KtmK8p5r4oGvAXq9nmZb1emU1DV";
const WORK_TOKEN_CREATED_AT = "2026-05-15T02:57:28.000Z";
const POWB_TOKEN_ID =
  "a3d0bc8528f91dfc52400a885bed7e49235396aa82aa9f95db41be629f1d5562";
// The shared definition schema keeps max_supply NOT NULL. Bond credits are
// uncapped by protocol, so zero is a neutral storage marker, never an economic
// maximum. The uncapped metadata is authoritative and readers expose
// maxSupply: null.
const BOND_UNCAPPED_MAX_SUPPLY_STORAGE = "0";
const POWB_REGISTRY_ID = "infinity";
const POWB_TOKEN_CREATED_AT = "2026-06-23T00:00:00.000Z";
const INCB_TOKEN_ID =
  "3cb25745f937f2b4e5508e5400189fe8fe679cd8e84bfa1e9176d70c9761f15d";
const INCB_REGISTRY_ID = "inception";
const INCB_TOKEN_CREATED_AT = "2026-07-10T00:00:00.000Z";
const INCB_ISSUANCE_ACCOUNTING_MODEL =
  "canonical-pre-bond-live-network-value-v2";
const INCB_VALUE_SNAPSHOT_MODEL = "canonical-summary-h-minus-one-v1";
const INCB_NETWORK_VALUE_ACCOUNTING_MODEL =
  "fixed-incb-issuance-plus-market-flow-v1";
const WORK_TRANSFER_VALUE_PROJECTION_MODEL =
  "canonical-work-transfer-value-projection-v1";
const CANONICAL_INCB_ISSUANCE_REPAIR_EXPECTATIONS = new Map([
  [
    "dd743fb69c519200cc190627219ba34ca2e63e6893e600b73e9aee8d4dac8fa4",
    {
      attachedWorkAmount: 3_644_060,
      attachedWorkIssuanceUnits: 1_421_798_915,
      attachedWorkLiveFloorAtSendSats: 390.168909301053,
      attachedWorkLiveValueAtSendSats: 1_421_798_915.6275952,
      blockHash:
        "000000000000000000016ea78b0d57a7979de3542518c8690a1e5a808e691cc5",
      blockHeight: 957_950,
      blockIndex: 382,
      confirmedIssuanceUnits: 1_421_799_461,
      directProofIssuanceUnits: 546,
      issuanceDustSats: 0.6275952,
      issuanceFloorSats: 1.0000000004414091,
      issuanceNetworkValueSats: 1_421_799_461.6275952,
      issuanceValueSnapshotBlockHash:
        "00000000000000000001bda6bfa328f15edf597bfc364e02da42ea92a518a15e",
      issuanceValueSnapshotBlockHeight: 957_949,
      issuanceValueSnapshotCanonicalSummaryHash:
        "4f00b3494afb46ef88990948784a0ba8f2a22856615a39e15c3131f0ec979bdc",
      issuanceValueSnapshotGeneratedAt: "2026-07-14T03:03:04.765Z",
      issuanceValueSnapshotId: "b8e77cd30cbed6855977c514",
      issuanceValueSnapshotMode: "canonical-summary-refresh",
      issuanceValueSnapshotModel: INCB_VALUE_SNAPSHOT_MODEL,
      issuanceValueSnapshotWorkNetworkValueSats:
        8_193_547_095.322113,
      recipientAddress: "1BPVvi1GK4QkfqFMU4jHGjsQjyGwjJJJ7x",
      recipientAmountSats: 546,
      recipientVout: 0,
      workAttachmentAmount: 3_644_060,
      workAttachmentProtocolVout: 3,
      workAttachmentRecipientAddress:
        "1BPVvi1GK4QkfqFMU4jHGjsQjyGwjJJJ7x",
      workAttachmentTokenId: WORK_TOKEN_ID,
    },
  ],
]);
// Immutable Bitcoin Core facts for the supervised July 2026 INCB range
// replay. These are transaction facts only. Valid exact V2 issuance is held
// byte-for-byte by the immutable witness manifest; only explicit rederive
// dispositions consume the canonical H-1 WORK summary rebuilt by the replay.
const LEGACY_PWT_RANGE_REPLAY_FROM_HEIGHT = 950_200;
const LEGACY_PWT_CANONICAL_FROM_HEIGHT = 948_000;
const LEGACY_PWT_CANONICAL_BOOTSTRAP_HEIGHT = 947_999;
const LEGACY_PWT_CANONICAL_BOOTSTRAP_HASH =
  "000000000000000000004238bec59ce46cd5b28982efe2b90071a51168d67986";
const CANONICAL_INCB_PWT_RANGE_REPLAY_TARGETS = Object.freeze([
  Object.freeze({
    blockHash:
      "00000000000000000001db52a4485f7d1a1784b7ba6c5b93db1b20449ac2628b",
    blockHeight: 958_383,
    blockIndex: 2_421,
    blockTime: 1_784_276_401,
    bondMemoVout: 2,
    bondRecipientAddress:
      "bc1pxhs9y9ryqnhm05lyv794f6upzk0mtu2zct5w2hgc2vm3d58pvcqspptre0",
    bondRecipientAmountSats: 1_000,
    bondRecipientVout: 0,
    txid: "c9c9f4e382f598aa39b3be57adc8fe1defeb80e5216387d3af6b0948da232aff",
    workAmountAtoms: "10000000000000",
    workProtocolVout: 4,
    workRegistryPaymentVout: 3,
  }),
  Object.freeze({
    blockHash:
      "000000000000000000022e062fe6236b71722b7ade5079d5c45e73a5561252e1",
    blockHeight: 958_429,
    blockIndex: 1_476,
    blockTime: 1_784_301_574,
    bondMemoVout: 2,
    bondRecipientAddress: "18xvbj6mpPpYYjWibcqsXdV7SCwBQNrqMW",
    bondRecipientAmountSats: 1_000,
    bondRecipientVout: 0,
    txid: "e08080c1d86f0770dd6ebbabd98a9e066dc6043b548af7ecb7912fbbdfad4d50",
    workAmountAtoms: "7000000000000",
    workProtocolVout: 4,
    workRegistryPaymentVout: 3,
  }),
  Object.freeze({
    blockHash:
      "000000000000000000022e062fe6236b71722b7ade5079d5c45e73a5561252e1",
    blockHeight: 958_429,
    blockIndex: 1_483,
    blockTime: 1_784_301_574,
    bondMemoVout: 2,
    bondRecipientAddress: "1Pg9E4EHHMxQ6WgEWEVzbWhaKf3UdZKXD9",
    bondRecipientAmountSats: 1_000,
    bondRecipientVout: 0,
    txid: "45b226453dde5b4d61a6a036af299d11ebfdeb65054bf26438ebc6ebebbf00c3",
    workAmountAtoms: "11500000000000",
    workProtocolVout: 4,
    workRegistryPaymentVout: 3,
  }),
  Object.freeze({
    blockHash:
      "0000000000000000000124119a72f9994a7e3a5a724a9826cb178ed2646639f6",
    blockHeight: 958_590,
    blockIndex: 1_945,
    blockTime: 1_784_395_736,
    bondMemoVout: 1,
    bondRecipientAddress: "1BPVvi1GK4QkfqFMU4jHGjsQjyGwjJJJ7x",
    bondRecipientAmountSats: 546,
    bondRecipientVout: 0,
    txid: "62f1a62fdf984c3c50b067cfed806023ad61d4fabd62087ecdd891554f5b51d6",
    workAmountAtoms: "357446000000000",
    workProtocolVout: 3,
    workRegistryPaymentVout: 2,
  }),
]);
const GROWTH_VALUE_MULTIPLE = 5;
const ID_MARKETPLACE_MUTATION_KINDS = new Set([
  "id-list",
  "id-seal",
  "id-delist",
  "id-buy",
]);
const TOKEN_MARKETPLACE_MUTATION_KINDS = new Set([
  "token-listing",
  "token-listing-sealed",
  "token-listing-closed",
]);
const INFINITY_BOND_MEMO = "powb";
const INFINITY_BOND_KIND = "infinity-bond";
const INCEPTION_BOND_MEMO = "incb";
const INCEPTION_BOND_KIND = "inception-bond";
const WORK_TOKEN_TICKER = "WORK";
const MAIL_WORK_ATTACHMENT_KINDS = new Set([
  "attachment",
  "browser",
  "file",
  INCEPTION_BOND_KIND,
  INFINITY_BOND_KIND,
  "mail",
  "reply",
]);
const BOND_TAGS = [
  {
    createdAt: POWB_TOKEN_CREATED_AT,
    kind: INFINITY_BOND_KIND,
    label: "Infinity Bond",
    memo: INFINITY_BOND_MEMO,
    registryId: POWB_REGISTRY_ID,
    ticker: "POWB",
    tokenId: POWB_TOKEN_ID,
    tokenMaxSupplyStorage: BOND_UNCAPPED_MAX_SUPPLY_STORAGE,
  },
  {
    createdAt: INCB_TOKEN_CREATED_AT,
    issuanceAccountingModel: INCB_ISSUANCE_ACCOUNTING_MODEL,
    kind: INCEPTION_BOND_KIND,
    label: "Inception Bond",
    memo: INCEPTION_BOND_MEMO,
    registryId: INCB_REGISTRY_ID,
    ticker: "INCB",
    tokenId: INCB_TOKEN_ID,
    tokenMaxSupplyStorage: BOND_UNCAPPED_MAX_SUPPLY_STORAGE,
  },
];
const BOND_TOKEN_IDS = new Set(BOND_TAGS.map((tag) => tag.tokenId));
const BOND_TOKEN_TICKERS = new Set(BOND_TAGS.map((tag) => tag.ticker));
const DEFAULT_MAIL_BACKFILL_ADDRESSES = [
  "1BPVvi1GK4QkfqFMU4jHGjsQjyGwjJJJ7x",
  "1KNkUBREnfno2BeV7QsBf8XCWZN6YFfxPH",
  "bc1p0uxp0axptr8rg9dndgtlwxn00j4hq8m88kg80tqd0t6045putwhq5ca7ed",
  "bc1p8ddc3s6z09ktchgdxxht8l0tt7gs7jn90w004uw2hrxuue39lp7qlxrd3q",
];
const CONFIGURED_MAIL_BACKFILL_ADDRESSES = String(
  process.env.POW_INDEX_BACKFILL_MAIL_ADDRESSES ?? "",
)
  .split(/[,\s]+/u)
  .map((value) => value.trim())
  .filter(Boolean);
const TOKEN_HISTORY_SNAPSHOT_KINDS = [
  "tokens",
  "mints",
  "transfers",
  "listings",
  "closedListings",
  "sales",
  "market-log",
  "holders",
  "invalidEvents",
];
const TOKEN_HISTORY_SNAPSHOT_SCOPES = [
  { key: "all", params: {} },
  { key: WORK_TOKEN_ID, params: { asset: WORK_TOKEN_ID } },
  { key: POWB_TOKEN_ID, params: { asset: POWB_TOKEN_ID } },
  { key: INCB_TOKEN_ID, params: { asset: INCB_TOKEN_ID } },
];
const REGISTRY_HISTORY_SNAPSHOT_KINDS = ["activity", "listings", "records", "sales"];
const SUMMARY_SNAPSHOT_SOURCES = [
  { key: "growthSummary", path: "/api/v1/growth-summary" },
  { key: "inceptionSummary", path: "/api/v1/inception-summary" },
  { key: "infinitySummary", path: "/api/v1/infinity-summary" },
  { key: "logSummary", path: "/api/v1/log-summary" },
  { key: "marketplaceSummary", path: "/api/v1/marketplace-summary" },
  { key: "tokenSummary", path: "/api/v1/token-summary" },
  { key: "workFloor", path: "/api/v1/work-floor" },
  { key: "workSummary", path: "/api/v1/work-summary" },
];

async function canonicalPwtRangeReplayRuntime(client) {
  const rebuild = await proofIndexerMetaValue(
    client,
    CANONICAL_REBUILD_META_KEY,
  );
  if (
    PREPARE_CANONICAL_PWT_RANGE_REPLAY_ONLY &&
    legacyCompletedPwtRangeReplayCanBeReprepared(
      rebuild,
      BLOCK_SCAN_FROM_HEIGHT,
    )
  ) {
    return {
      active: false,
      preparing: true,
      rebuild,
      state: "legacy-complete",
    };
  }
  const state = assertCanonicalPwtRangeReplayState(rebuild);
  if (state !== "active") {
    return { active: false, rebuild, state };
  }
  await assertCanonicalWorkAtomicSource(
    client,
    "Active PWT range replay",
  );
  if (PREPARE_CANONICAL_PWT_RANGE_REPLAY_ONLY) {
    return { active: true, preparing: true, rebuild, state };
  }
  const incompatibleMode =
    HYDRATE_TRANSACTION_DETAILS_ONLY ||
    AUDIT_WORK_ATOMS_ONLY ||
    MIGRATE_WORK_ATOMS_ONLY ||
    VERIFY_WORK_ATOMS_POST_BOOTSTRAP_ONLY ||
    RUSH_BOOTSTRAP_ONLY ||
    PREPARE_CANONICAL_REBUILD_ONLY ||
    REPAIR_CANONICAL_TXIDS_ONLY ||
    REPAIR_ID_TXIDS_ONLY ||
    REPAIR_INCB_ISSUANCE_ONLY ||
    REPAIR_WORK_PARTICIPANTS_ONLY ||
    DB_SUMMARY_REPAIR ||
    CANONICAL_REBUILD;
  const blockScanOnly =
    SOURCES.length === 1 &&
    SOURCES[0]?.blockScan === true &&
    SOURCES[0]?.label === "block-scan";
  if (
    incompatibleMode ||
    !blockScanOnly ||
    STORE_LEDGER_SNAPSHOT ||
    STORE_CANONICAL_SUMMARY_SNAPSHOT
  ) {
    throw new Error(
      "Active PWT range replay requires an ordinary block-scan-only pass with POW_INDEX_BACKFILL_SOURCES=block-scan and ledger/general canonical-summary storage disabled.",
    );
  }
  const verifierBinding = activatePwtRangeReplayVerifierBinding(rebuild);
  return {
    active: true,
    preparing: false,
    rebuild,
    state,
    verifierBinding,
  };
}

function objectValue(value) {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value
    : {};
}

function legacyCompletedPwtRangeReplayCanBeReprepared(
  rebuild,
  requestedRangeReplayFromHeight,
) {
  const source = objectValue(rebuild);
  const fromHeight = Number(source.fromHeight);
  const bootstrapHeight = Number(source.bootstrapHeight);
  const rangeReplayFromHeight = Number(source.rangeReplayFromHeight);
  const indexedThroughBlock = Number(source.indexedThroughBlock);
  const requestedFromHeight = Number(requestedRangeReplayFromHeight);
  const validHash = (value) =>
    /^[0-9a-f]{64}$/u.test(String(value ?? "").trim().toLowerCase());
  const validDate = (value) => {
    const text = String(value ?? "").trim();
    return text.length > 0 && Number.isFinite(Date.parse(text));
  };
  const startedAtMs = Date.parse(String(source.startedAt ?? "").trim());
  const rangeReplayStartedAtMs = Date.parse(
    String(source.rangeReplayStartedAt ?? "").trim(),
  );
  const completedAtMs = Date.parse(String(source.completedAt ?? "").trim());

  // This is deliberately narrower than the ordinary replay-state parser.
  // It recognizes only the inactive, internally consistent completion tuple
  // written before verifier bindings and exact completion certificates existed.
  // The shape may be superseded only by the explicit supervised prepare mode;
  // public/runtime readers continue to reject it as uncertified.
  return (
    source.mode === "pwt-range-replay" &&
    source.network === NETWORK &&
    source.status === "complete" &&
    source.active === false &&
    source.complete === true &&
    source.fault == null &&
    source.verifierBinding == null &&
    source.incbRangeReplayVerification == null &&
    source.transactionNormalization === "canonical-raw-tx-only" &&
    validDate(source.startedAt) &&
    validDate(source.rangeReplayStartedAt) &&
    validDate(source.completedAt) &&
    startedAtMs <= rangeReplayStartedAtMs &&
    rangeReplayStartedAtMs <= completedAtMs &&
    Number.isSafeInteger(fromHeight) &&
    fromHeight === LEGACY_PWT_CANONICAL_FROM_HEIGHT &&
    Number.isSafeInteger(bootstrapHeight) &&
    bootstrapHeight === LEGACY_PWT_CANONICAL_BOOTSTRAP_HEIGHT &&
    bootstrapHeight === fromHeight - 1 &&
    String(source.bootstrapHash ?? "").trim().toLowerCase() ===
      LEGACY_PWT_CANONICAL_BOOTSTRAP_HASH &&
    Number.isSafeInteger(rangeReplayFromHeight) &&
    rangeReplayFromHeight === LEGACY_PWT_RANGE_REPLAY_FROM_HEIGHT &&
    Number.isSafeInteger(requestedFromHeight) &&
    requestedFromHeight === CANONICAL_INCB_PWT_RANGE_REPLAY_FROM_HEIGHT &&
    Number.isSafeInteger(indexedThroughBlock) &&
    indexedThroughBlock >= requestedFromHeight - 1 &&
    validHash(source.indexedThroughBlockHash)
  );
}

function canonicalPwtRangeReplayVerificationIsValid(rebuild) {
  const source = objectValue(rebuild);
  const verification = objectValue(source.incbRangeReplayVerification);
  const verifierBinding = objectValue(source.verifierBinding);
  const rangeReplayFromHeight = Number(source.rangeReplayFromHeight);
  const bindingRangeReplayFromHeight = Number(
    verifierBinding.rangeReplayFromHeight,
  );
  const bindingId = String(verifierBinding.bindingId ?? "")
    .trim()
    .toLowerCase();
  const bindingCreatedAt = String(verifierBinding.createdAt ?? "").trim();
  const expectedWitnessMetaKey = /^[0-9a-f]{64}$/u.test(bindingId)
    ? incbRangeReplayWitnessMetaKey(NETWORK, bindingId)
    : "";
  const witnessSetHash = String(verifierBinding.witnessSetHash ?? "")
    .trim()
    .toLowerCase();
  const witnessedThroughBlock = Number(
    verifierBinding.witnessedThroughBlock,
  );
  const witnessedThroughBlockHash = String(
    verifierBinding.witnessedThroughBlockHash ?? "",
  )
    .trim()
    .toLowerCase();
  const witnessCount = Number(verifierBinding.witnessCount);
  const witnessPreserveCount = Number(
    verifierBinding.witnessPreserveCount,
  );
  const consumedPreserveCount = Number(
    verification.consumedPreserveCount,
  );
  const preservedWitnesses = Array.isArray(verification.preservedWitnesses)
    ? verification.preservedWitnesses
    : [];
  const rederivedWitnessCount = Number(
    verification.rederivedWitnessCount,
  );
  const rederivedWitnesses = Array.isArray(verification.rederivedWitnesses)
    ? verification.rederivedWitnesses
    : [];
  const coreFacts = Array.isArray(verification.coreFacts)
    ? verification.coreFacts
    : [];
  const targets = Array.isArray(verification.targets)
    ? verification.targets
    : [];
  if (
    source.network !== NETWORK ||
    !Number.isSafeInteger(rangeReplayFromHeight) ||
    rangeReplayFromHeight <= 0 ||
    verifierBinding.model !== PWT_RANGE_REPLAY_VERIFIER_BINDING_MODEL ||
    verifierBinding.network !== NETWORK ||
    !/^[0-9a-f]{64}$/u.test(bindingId) ||
    !Number.isFinite(Date.parse(bindingCreatedAt)) ||
    !Number.isSafeInteger(bindingRangeReplayFromHeight) ||
    bindingRangeReplayFromHeight !== rangeReplayFromHeight ||
    verifierBinding.witnessModel !==
      INCB_RANGE_REPLAY_WITNESS_MANIFEST_MODEL ||
    String(verifierBinding.witnessSetMetaKey ?? "") !==
      expectedWitnessMetaKey ||
    !/^[0-9a-f]{64}$/u.test(witnessSetHash) ||
    !Number.isSafeInteger(witnessCount) ||
    witnessCount < 0 ||
    !Number.isSafeInteger(witnessPreserveCount) ||
    witnessPreserveCount < 0 ||
    witnessPreserveCount > witnessCount ||
    !Number.isSafeInteger(witnessedThroughBlock) ||
    witnessedThroughBlock < rangeReplayFromHeight - 1 ||
    !/^[0-9a-f]{64}$/u.test(witnessedThroughBlockHash) ||
    verification.verified !== true ||
    verification.accountingModel !== INCB_ISSUANCE_ACCOUNTING_MODEL ||
    Number(verification.rangeReplayFromHeight) !== rangeReplayFromHeight ||
    String(verification.witnessSetHash ?? "").trim().toLowerCase() !==
      witnessSetHash ||
    Number(verification.witnessCount) !== witnessCount ||
    Number(verification.witnessPreserveCount) !== witnessPreserveCount ||
    !Number.isSafeInteger(consumedPreserveCount) ||
    consumedPreserveCount !== witnessPreserveCount ||
    preservedWitnesses.length !== witnessPreserveCount ||
    !Number.isSafeInteger(rederivedWitnessCount) ||
    rederivedWitnessCount !== witnessCount - witnessPreserveCount ||
    rederivedWitnesses.length !== rederivedWitnessCount ||
    Number(verification.witnessedThroughBlock) !== witnessedThroughBlock ||
    String(verification.witnessedThroughBlockHash ?? "")
      .trim()
      .toLowerCase() !== witnessedThroughBlockHash ||
    coreFacts.length === 0 ||
    coreFacts.length !== targets.length
  ) {
    return false;
  }

  const rederivedIdentities = new Set();
  let previousRederivedIdentity = "";
  for (const witness of rederivedWitnesses) {
    const txid = String(witness?.txid ?? "").trim().toLowerCase();
    const vout = Number(witness?.bondRecipientVout);
    const identity = `${txid}:${vout}`;
    const disposition = String(witness?.disposition ?? "");
    const mintShapeValid =
      disposition === "mint" &&
      /^[0-9a-f]{64}$/u.test(
        String(witness?.mintPayloadHash ?? "").trim().toLowerCase(),
      ) &&
      String(witness?.snapshotId ?? "").trim().length > 0 &&
      /^[0-9a-f]{64}$/u.test(
        String(witness?.snapshotFingerprint ?? "")
          .trim()
          .toLowerCase(),
      ) &&
      witness?.invalidPayloadHash == null;
    const invalidShapeValid =
      disposition === "invalid" &&
      /^[0-9a-f]{64}$/u.test(
        String(witness?.invalidPayloadHash ?? "").trim().toLowerCase(),
      ) &&
      witness?.mintPayloadHash == null &&
      witness?.snapshotId == null &&
      witness?.snapshotFingerprint == null;
    if (
      !/^[0-9a-f]{64}$/u.test(txid) ||
      !Number.isSafeInteger(vout) ||
      vout < 0 ||
      String(witness?.identity ?? "") !== identity ||
      (!mintShapeValid && !invalidShapeValid) ||
      rederivedIdentities.has(identity) ||
      (previousRederivedIdentity &&
        identity.localeCompare(previousRederivedIdentity) <= 0)
    ) {
      return false;
    }
    rederivedIdentities.add(identity);
    previousRederivedIdentity = identity;
  }

  const preservedIdentities = new Set();
  let previousPreservedIdentity = "";
  for (const witness of preservedWitnesses) {
    const txid = String(witness?.txid ?? "").trim().toLowerCase();
    const vout = Number(witness?.bondRecipientVout);
    const identity = `${txid}:${vout}`;
    if (
      !/^[0-9a-f]{64}$/u.test(txid) ||
      !Number.isSafeInteger(vout) ||
      vout < 0 ||
      String(witness?.identity ?? "") !== identity ||
      !/^[0-9a-f]{64}$/u.test(
        String(witness?.mintPayloadHash ?? "").trim().toLowerCase(),
      ) ||
      !String(witness?.snapshotId ?? "").trim() ||
      !/^[0-9a-f]{64}$/u.test(
        String(witness?.snapshotFingerprint ?? "")
          .trim()
          .toLowerCase(),
      ) ||
      preservedIdentities.has(identity) ||
      (previousPreservedIdentity &&
        identity.localeCompare(previousPreservedIdentity) <= 0)
    ) {
      return false;
    }
    preservedIdentities.add(identity);
    previousPreservedIdentity = identity;
  }
  if ([...rederivedIdentities].some((identity) =>
    preservedIdentities.has(identity)
  )) {
    return false;
  }

  const positiveIntegerText = (value) => {
    const text = String(value ?? "").trim();
    return /^[1-9][0-9]*$/u.test(text) ? BigInt(text).toString() : "";
  };
  const coreByTxid = new Map();
  for (const item of coreFacts) {
    const txid = String(item?.txid ?? "").trim().toLowerCase();
    const blockHash = String(item?.blockHash ?? "").trim().toLowerCase();
    const blockHeight = Number(item?.blockHeight);
    const blockIndex = Number(item?.blockIndex);
    const workAmountAtoms = positiveIntegerText(item?.workAmountAtoms);
    if (
      !/^[0-9a-f]{64}$/u.test(txid) ||
      !/^[0-9a-f]{64}$/u.test(blockHash) ||
      !Number.isSafeInteger(blockHeight) ||
      blockHeight < rangeReplayFromHeight ||
      !Number.isSafeInteger(blockIndex) ||
      blockIndex < 0 ||
      !workAmountAtoms ||
      coreByTxid.has(txid)
    ) {
      return false;
    }
    coreByTxid.set(txid, {
      blockHash,
      blockHeight,
      blockIndex,
      workAmountAtoms,
    });
  }

  const targetTxids = new Set();
  for (const item of targets) {
    const txid = String(item?.txid ?? "").trim().toLowerCase();
    const workAmountAtoms = positiveIntegerText(item?.workAmountAtoms);
    const confirmedIssuanceUnits = positiveIntegerText(
      item?.confirmedIssuanceUnits,
    );
    const issuanceNetworkValueQ8 = positiveIntegerText(
      item?.issuanceNetworkValueQ8,
    );
    if (
      !coreByTxid.has(txid) ||
      targetTxids.has(txid) ||
      !workAmountAtoms ||
      coreByTxid.get(txid).workAmountAtoms !== workAmountAtoms ||
      !confirmedIssuanceUnits ||
      !issuanceNetworkValueQ8 ||
      BigInt(issuanceNetworkValueQ8) / VALUE_Q8_SCALE !==
        BigInt(confirmedIssuanceUnits)
    ) {
      return false;
    }
    targetTxids.add(txid);
  }
  const expectedTargets = canonicalIncbPwtRangeReplayTargets(
    rangeReplayFromHeight,
  );
  if (
    rangeReplayFromHeight !== CANONICAL_INCB_PWT_RANGE_REPLAY_FROM_HEIGHT ||
    expectedTargets.length === 0 ||
    targetTxids.size !== coreByTxid.size ||
    targetTxids.size !== expectedTargets.length
  ) {
    return false;
  }
  return expectedTargets.every((expected) => {
    const core = coreByTxid.get(expected.txid);
    return (
      targetTxids.has(expected.txid) &&
      core?.blockHash === expected.blockHash &&
      core?.blockHeight === expected.blockHeight &&
      core?.blockIndex === expected.blockIndex &&
      core?.workAmountAtoms === expected.workAmountAtoms
    );
  });
}

function canonicalPwtRangeReplayState(rebuild) {
  const source = objectValue(rebuild);
  if (source.mode !== "pwt-range-replay") {
    return null;
  }
  const commonStateIsValid =
    source.network === NETWORK &&
    Number.isSafeInteger(Number(source.rangeReplayFromHeight)) &&
    Number(source.rangeReplayFromHeight) > 0;
  if (
    commonStateIsValid &&
    source.status === "active" &&
    source.active === true &&
    source.complete === false &&
    source.completedAt == null &&
    source.incbRangeReplayVerification == null
  ) {
    return "active";
  }
  if (
    commonStateIsValid &&
    source.status === "complete" &&
    source.active === false &&
    source.complete === true &&
    String(source.completedAt ?? "").trim().length > 0 &&
    Number.isFinite(Date.parse(String(source.completedAt).trim())) &&
    canonicalPwtRangeReplayVerificationIsValid(source)
  ) {
    return "complete";
  }
  return "invalid";
}

function assertCanonicalPwtRangeReplayState(rebuild) {
  const state = canonicalPwtRangeReplayState(rebuild);
  if (state === "invalid") {
    throw new Error(
      "PWT range replay metadata is malformed; refusing to disable its database binding or exact H-1 barriers.",
    );
  }
  return state;
}

function canonicalPwtRangeReplayVerifierBinding(rebuild) {
  const source = objectValue(rebuild);
  const replayState = assertCanonicalPwtRangeReplayState(source);
  if (!replayState) {
    return null;
  }
  const binding = objectValue(source.verifierBinding);
  const bindingId = String(binding.bindingId ?? "").trim().toLowerCase();
  const createdAt = String(binding.createdAt ?? "").trim();
  const rangeReplayFromHeight = Number(binding.rangeReplayFromHeight);
  const witnessCount = Number(binding.witnessCount);
  const witnessPreserveCount = Number(binding.witnessPreserveCount);
  const witnessedThroughBlock = Number(binding.witnessedThroughBlock);
  const witnessSetHash = String(binding.witnessSetHash ?? "")
    .trim()
    .toLowerCase();
  const witnessedThroughBlockHash = String(
    binding.witnessedThroughBlockHash ?? "",
  )
    .trim()
    .toLowerCase();
  const expectedWitnessMetaKey = /^[0-9a-f]{64}$/u.test(bindingId)
    ? incbRangeReplayWitnessMetaKey(NETWORK, bindingId)
    : "";
  if (
    binding.model !== PWT_RANGE_REPLAY_VERIFIER_BINDING_MODEL ||
    binding.network !== NETWORK ||
    !/^[0-9a-f]{64}$/u.test(bindingId) ||
    !Number.isSafeInteger(rangeReplayFromHeight) ||
    rangeReplayFromHeight <= 0 ||
    rangeReplayFromHeight !== Number(source.rangeReplayFromHeight) ||
    !Number.isFinite(Date.parse(createdAt)) ||
    binding.witnessModel !== INCB_RANGE_REPLAY_WITNESS_MANIFEST_MODEL ||
    !/^[0-9a-f]{64}$/u.test(witnessSetHash) ||
    !Number.isSafeInteger(witnessCount) ||
    witnessCount < 0 ||
    !Number.isSafeInteger(witnessPreserveCount) ||
    witnessPreserveCount < 0 ||
    witnessPreserveCount > witnessCount ||
    !Number.isSafeInteger(witnessedThroughBlock) ||
    witnessedThroughBlock < rangeReplayFromHeight - 1 ||
    !/^[0-9a-f]{64}$/u.test(witnessedThroughBlockHash) ||
    String(binding.witnessSetMetaKey ?? "") !== expectedWitnessMetaKey
  ) {
    return null;
  }
  return {
    bindingId,
    createdAt,
    model: PWT_RANGE_REPLAY_VERIFIER_BINDING_MODEL,
    network: NETWORK,
    rangeReplayFromHeight,
    witnessCount,
    witnessModel: INCB_RANGE_REPLAY_WITNESS_MANIFEST_MODEL,
    witnessPreserveCount,
    witnessSetHash,
    witnessSetMetaKey: expectedWitnessMetaKey,
    witnessedThroughBlock,
    witnessedThroughBlockHash,
  };
}

function activePwtRangeReplay(rebuild) {
  return assertCanonicalPwtRangeReplayState(rebuild) === "active";
}

function newPwtRangeReplayVerifierBinding(rangeReplayFromHeight, createdAt) {
  return {
    bindingId: randomBytes(32).toString("hex"),
    createdAt,
    model: PWT_RANGE_REPLAY_VERIFIER_BINDING_MODEL,
    network: NETWORK,
    rangeReplayFromHeight,
  };
}

function activatePwtRangeReplayVerifierBinding(rebuild) {
  const replayState = assertCanonicalPwtRangeReplayState(rebuild);
  if (!["active", "complete"].includes(replayState)) {
    ACTIVE_PWT_RANGE_REPLAY_VERIFIER_BINDING = null;
    return null;
  }
  if (!explicitLoopbackApiBaseConfigured()) {
    throw new Error(
      "PWT range replay verification requires an explicit loopback POW_API_BASE; the default API address is not replay-safe.",
    );
  }
  const binding = canonicalPwtRangeReplayVerifierBinding(rebuild);
  if (!binding) {
    throw new Error(
      "PWT range replay is missing its canonical verifier database binding.",
    );
  }
  ACTIVE_PWT_RANGE_REPLAY_VERIFIER_BINDING = binding;
  return binding;
}

function assertInternalReplayVerifierResponseBinding(payload, url) {
  const expected = ACTIVE_PWT_RANGE_REPLAY_VERIFIER_BINDING;
  if (!expected || !String(url?.pathname ?? "").startsWith("/api/v1/internal/")) {
    return payload;
  }
  const actual = objectValue(payload?.replayVerifierBinding);
  if (
    canonicalIncbReplaySha256(actual) !==
      canonicalIncbReplaySha256(expected)
  ) {
    throw new Error(
      `Internal replay verifier ${String(url?.pathname ?? "request")} is connected to the wrong ProofOfWork database.`,
    );
  }
  return payload;
}

function workDefinitionStorage(item) {
  const source = objectValue(item);
  const maxSupplyAtoms =
    source.maxSupplyAtoms !== undefined && source.maxSupplyAtoms !== null
      ? normalizeWorkAtoms(source.maxSupplyAtoms, { allowZero: true })
      : parseWorkAmountToAtoms(source.maxSupply ?? 0, { allowZero: true });
  const mintAmountAtoms =
    source.mintAmountAtoms !== undefined && source.mintAmountAtoms !== null
      ? normalizeWorkAtoms(source.mintAmountAtoms, { allowZero: true })
      : parseWorkAmountToAtoms(source.mintAmount ?? 0, { allowZero: true });
  return {
    maxSupplyAtoms,
    metadata: withWorkPrecisionMetadata({
      ...source,
      maxSupply: formatWorkAtoms(maxSupplyAtoms),
      maxSupplyAtoms,
      mintAmount: formatWorkAtoms(mintAmountAtoms),
      mintAmountAtoms,
    }),
    mintAmountAtoms,
  };
}

function legacyWorkDefinitionPayload(item) {
  const {
    amountStorageModel: _amountStorageModel,
    decimals: _decimals,
    maxSupplyAtoms: _maxSupplyAtoms,
    mintAmountAtoms: _mintAmountAtoms,
    unitScale: _unitScale,
    ...legacy
  } = objectValue(item);
  return legacy;
}

function workProjectionItem(item, options = {}) {
  const source = objectValue(item);
  if (!isWorkTokenId(source.tokenId)) {
    return source;
  }
  const saleAuthorization = objectValue(source.saleAuthorization);
  if (
    [
      source.amount,
      source.tokenAmount,
      source.amountAtoms,
      source.tokenAmountAtoms,
      saleAuthorization.amount,
      saleAuthorization.amountAtoms,
    ].every(
      (value) => value === undefined || value === null || value === "",
    )
  ) {
    return source;
  }
  try {
    return {
      ...source,
      ...workAmountFields(source, options),
    };
  } catch (error) {
    if (source.valid === false || options.strict === false) {
      return source;
    }
    throw error;
  }
}

function workBalanceAtoms(item, fieldNames, { signed = false } = {}) {
  const source = objectValue(item);
  const atomField = fieldNames.find(
    (field) =>
      field.endsWith("Atoms") &&
      source[field] !== undefined &&
      source[field] !== null &&
      source[field] !== "",
  );
  if (atomField) {
    return normalizeWorkAtoms(source[atomField], {
      allowNegative: signed,
      allowZero: true,
    });
  }
  const amountField = fieldNames.find(
    (field) =>
      !field.endsWith("Atoms") &&
      source[field] !== undefined &&
      source[field] !== null &&
      source[field] !== "",
  );
  const amount = amountField ? source[amountField] : 0;
  return signed
    ? parseSignedWorkAmountToAtoms(amount)
    : parseWorkAmountToAtoms(amount, { allowZero: true });
}

const workAtomicProjectionReadyByClient = new WeakMap();

async function workAtomicProjectionReady(client, { refresh = false } = {}) {
  if (!refresh && workAtomicProjectionReadyByClient.has(client)) {
    return workAtomicProjectionReadyByClient.get(client);
  }
  const result = await client.query(
    `
      SELECT max_supply::text, mint_amount::text, metadata
      FROM proof_indexer.credit_definitions
      WHERE network = $1 AND token_id = $2
      LIMIT 1
    `,
    [NETWORK, WORK_TOKEN_ID],
  );
  const metadata = objectValue(result.rows[0]?.metadata);
  const ready =
    String(result.rows[0]?.max_supply ?? "") ===
      WORK_TOKEN_MAX_SUPPLY_ATOMS &&
    String(result.rows[0]?.mint_amount ?? "") ===
      WORK_TOKEN_MINT_AMOUNT_ATOMS &&
    metadata.amountStorageModel === WORK_ATOMIC_PROJECTION_MODEL &&
    Number(metadata.decimals) === WORK_DECIMALS &&
    String(metadata.unitScale ?? "") === WORK_UNIT_SCALE_TEXT;
  workAtomicProjectionReadyByClient.set(client, ready);
  return ready;
}

async function assertCanonicalWorkAtomicProjection(client, context) {
  if (await workAtomicProjectionReady(client, { refresh: true })) {
    return true;
  }
  throw new Error(
    `${context} requires the exact canonical WORK work-atoms-v1 definition.`,
  );
}

function legacyWholeWorkAmount(item, fields, { signed = false } = {}) {
  const source = objectValue(item);
  const field = fields.find(
    (name) =>
      source[name] !== undefined &&
      source[name] !== null &&
      source[name] !== "",
  );
  const value = String(field ? source[field] : "0").trim();
  const pattern = signed
    ? /^-?(?:0|[1-9]\d*)$/u
    : /^(?:0|[1-9]\d*)$/u;
  if (!pattern.test(value) || value === "-0") {
    throw new Error(
      "Fractional WORK cannot enter a legacy whole-unit projection before the atomic migration.",
    );
  }
  return value;
}

function endpoint(pathname, params = {}) {
  const url = new URL(`${API_BASE}${pathname}`);
  url.searchParams.set("network", NETWORK);
  url.searchParams.set("limit", String(PAGE_LIMIT));
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== "") {
      url.searchParams.set(key, String(value));
    }
  }
  if (
    ACTIVE_PWT_RANGE_REPLAY_VERIFIER_BINDING &&
    url.pathname.startsWith("/api/v1/internal/")
  ) {
    url.searchParams.set(
      "replayBindingId",
      ACTIVE_PWT_RANGE_REPLAY_VERIFIER_BINDING.bindingId,
    );
  }
  return url;
}

function unpagedEndpoint(pathname, params = {}) {
  const url = endpoint(pathname, params);
  url.searchParams.delete("limit");
  return url;
}

function readCanonicalSummaryJsonViaLoopbackHttp(url, options = {}) {
  const maxBytes = Number.isFinite(options.maxBytes)
    ? Math.max(1, Math.floor(Number(options.maxBytes)))
    : CANONICAL_SUMMARY_RESPONSE_MAX_BYTES;

  return new Promise((resolve, reject) => {
    let request;
    let settled = false;
    const settle = (callback, value) => {
      if (settled) {
        return;
      }
      settled = true;
      callback(value);
    };
    const responseTooLargeError = (receivedBytes) => {
      const error = new Error(
        `${url.pathname} response exceeded the ${maxBytes}-byte limit`,
      );
      error.code = "POW_CANONICAL_SUMMARY_RESPONSE_TOO_LARGE";
      error.maxBytes = maxBytes;
      error.receivedBytes = receivedBytes;
      return error;
    };

    try {
      request = httpRequest(
        url,
        {
          agent: false,
          headers: options.headers,
          method: "GET",
          signal: options.signal,
        },
        (response) => {
          const statusCode = Number(response.statusCode ?? 0);
          const declaredLength = Number(response.headers["content-length"]);
          if (Number.isFinite(declaredLength) && declaredLength > maxBytes) {
            const error = responseTooLargeError(declaredLength);
            settle(reject, error);
            response.destroy(error);
            request?.destroy(error);
            return;
          }

          const chunks = [];
          let receivedBytes = 0;
          response.on("data", (chunk) => {
            if (settled) {
              return;
            }
            const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
            receivedBytes += buffer.length;
            if (receivedBytes > maxBytes) {
              const error = responseTooLargeError(receivedBytes);
              settle(reject, error);
              response.destroy(error);
              request?.destroy(error);
              return;
            }
            chunks.push(buffer);
          });
          response.on("end", () => {
            if (settled) {
              return;
            }
            if (response.complete !== true) {
              const error = new Error(
                `${url.pathname} response ended before the HTTP message was complete`,
              );
              error.code = "POW_CANONICAL_SUMMARY_RESPONSE_INCOMPLETE";
              settle(reject, error);
              response.destroy(error);
              request?.destroy(error);
              return;
            }
            const responseText = Buffer.concat(chunks, receivedBytes).toString(
              "utf8",
            );
            if (statusCode === 404 && options.allowNotFound === true) {
              settle(resolve, { items: [] });
              return;
            }
            if (statusCode < 200 || statusCode >= 300) {
              const requestError = new Error(
                `${url.pathname} returned HTTP ${statusCode}`,
              );
              requestError.statusCode = statusCode;
              requestError.responseText = responseText;
              settle(reject, requestError);
              return;
            }
            try {
              settle(resolve, JSON.parse(responseText));
            } catch (error) {
              settle(reject, error);
            }
          });
          response.on("aborted", () => {
            const error = new Error(
              `${url.pathname} response was aborted before completion`,
            );
            error.code = "POW_CANONICAL_SUMMARY_RESPONSE_ABORTED";
            settle(reject, error);
            request?.destroy(error);
          });
          response.on("close", () => {
            if (settled || response.complete === true) {
              return;
            }
            const error = new Error(
              `${url.pathname} response closed before completion`,
            );
            error.code = "POW_CANONICAL_SUMMARY_RESPONSE_INCOMPLETE";
            settle(reject, error);
            response.destroy(error);
            request?.destroy(error);
          });
          response.on("error", (error) => {
            request?.destroy(error);
            settle(reject, error);
          });
        },
      );
      request.on("error", (error) => settle(reject, error));
      request.end();
    } catch (error) {
      settle(reject, error);
    }
  });
}

async function readJson(url, options = {}) {
  let lastError = null;
  const retries = Number.isFinite(options.retries)
    ? Math.max(0, Math.floor(options.retries))
    : REQUEST_RETRIES;

  for (let attempt = 0; attempt <= retries; attempt += 1) {
    const controller = new AbortController();
    const timeoutMs = Number.isFinite(options.timeoutMs)
      ? Math.max(1, Number(options.timeoutMs))
      : REQUEST_TIMEOUT_MS;
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const internalVerifier = url.pathname.startsWith("/api/v1/internal/");
      const loopbackApi = ["127.0.0.1", "::1", "[::1]", "localhost"].includes(
        url.hostname.toLowerCase(),
      );
      if (internalVerifier && INTERNAL_VERIFIER_TOKEN.length < 32) {
        throw new Error(
          "POW_INTERNAL_VERIFIER_TOKEN is required for canonical verifier calls",
        );
      }
      const headers = loopbackApi && INTERNAL_VERIFIER_TOKEN.length >= 32
        ? { "X-PoW-Internal-Verifier": INTERNAL_VERIFIER_TOKEN }
        : undefined;
      if (
        internalVerifier &&
        url.pathname === "/api/v1/internal/canonical-summary" &&
        loopbackApi &&
        url.protocol === "http:"
      ) {
        const payload = await readCanonicalSummaryJsonViaLoopbackHttp(url, {
          allowNotFound: options.allowNotFound,
          headers,
          maxBytes: CANONICAL_SUMMARY_RESPONSE_MAX_BYTES,
          signal: controller.signal,
        });
        return assertInternalReplayVerifierResponseBinding(payload, url);
      }
      const response = await fetch(url, {
        headers,
        signal: controller.signal,
      });
      if (response.status === 404 && options.allowNotFound === true) {
        return assertInternalReplayVerifierResponseBinding({ items: [] }, url);
      }
      if (!response.ok) {
        const responseText = await response.text().catch(() => "");
        const requestError = new Error(
          `${url.pathname} returned HTTP ${response.status}`,
        );
        requestError.statusCode = response.status;
        requestError.responseText = responseText;
        throw requestError;
      }
      const payload = await response.json();
      return assertInternalReplayVerifierResponseBinding(payload, url);
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

async function bitcoinRpcOnce(method, params = []) {
  if (!BITCOIN_RPC_URL) {
    throw new Error("BITCOIN_RPC_URL is not configured.");
  }

  const headers = { "content-type": "application/json" };
  if (BITCOIN_RPC_USER || BITCOIN_RPC_PASSWORD) {
    headers.authorization = `Basic ${Buffer.from(
      `${BITCOIN_RPC_USER}:${BITCOIN_RPC_PASSWORD}`,
    ).toString("base64")}`;
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), BITCOIN_RPC_TIMEOUT_MS);
  try {
    const response = await fetch(BITCOIN_RPC_URL, {
      body: JSON.stringify({
        id: "proof-indexer-backfill",
        jsonrpc: "1.0",
        method,
        params,
      }),
      headers,
      method: "POST",
      signal: controller.signal,
    });
    if (!response.ok) {
      throw new Error(`Bitcoin RPC ${method} returned HTTP ${response.status}`);
    }
    const payload = await response.json();
    if (payload?.error) {
      throw new Error(
        `Bitcoin RPC ${method} failed: ${payload.error.message ?? payload.error.code}`,
      );
    }
    return payload.result;
  } finally {
    clearTimeout(timeout);
  }
}

async function bitcoinRpc(method, params = []) {
  let lastError = null;
  for (let attempt = 0; attempt <= BITCOIN_RPC_RETRIES; attempt += 1) {
    try {
      return await bitcoinRpcOnce(method, params);
    } catch (error) {
      lastError = error;
      if (attempt >= BITCOIN_RPC_RETRIES) {
        break;
      }
      const delayMs = Math.min(5_000, 250 * 2 ** attempt);
      console.error(
        JSON.stringify({
          attempt,
          delayMs,
          error: error?.message ?? String(error),
          method,
          phase: "bitcoin-rpc",
          retrying: true,
        }),
      );
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }
  throw lastError;
}

const RAW_TRANSACTION_CACHE = new Map();
const RAW_TRANSACTION_CACHE_LIMIT = Math.min(
  20_000,
  Math.max(
    100,
    Math.floor(
      Number(process.env.POW_INDEX_RAW_TRANSACTION_CACHE_LIMIT ?? 2_000) ||
        2_000,
    ),
  ),
);

async function rawTransactionFromCore(txid) {
  const normalizedTxid = String(txid ?? "").trim().toLowerCase();
  if (!isHexTxid(normalizedTxid) || !BITCOIN_RPC_URL) {
    return null;
  }
  if (!RAW_TRANSACTION_CACHE.has(normalizedTxid)) {
    const pending = bitcoinRpc("getrawtransaction", [normalizedTxid, true]).catch(
      (error) => {
        RAW_TRANSACTION_CACHE.delete(normalizedTxid);
        console.error(
          JSON.stringify({
            error: error?.message ?? String(error),
            phase: "raw-transaction-hydration",
            txid: normalizedTxid,
          }),
        );
        return null;
      },
    );
    RAW_TRANSACTION_CACHE.set(normalizedTxid, pending);
    while (RAW_TRANSACTION_CACHE.size > RAW_TRANSACTION_CACHE_LIMIT) {
      RAW_TRANSACTION_CACHE.delete(RAW_TRANSACTION_CACHE.keys().next().value);
    }
  }
  return RAW_TRANSACTION_CACHE.get(normalizedTxid);
}

async function freshRawTransactionFromCore(txid) {
  const normalizedTxid = String(txid ?? "").trim().toLowerCase();
  if (!isHexTxid(normalizedTxid) || !BITCOIN_RPC_URL) {
    return null;
  }
  try {
    const transaction = await bitcoinRpc("getrawtransaction", [
      normalizedTxid,
      true,
    ]);
    if (
      String(transaction?.txid ?? "").trim().toLowerCase() !== normalizedTxid
    ) {
      throw new Error("Bitcoin Core returned a mismatched transaction id.");
    }
    return transaction;
  } catch (error) {
    console.error(
      JSON.stringify({
        error: error?.message ?? String(error),
        phase: "fresh-mempool-transaction-hydration",
        txid: normalizedTxid,
      }),
    );
    return null;
  }
}

function transactionHasConfirmedBlockEvidence(transaction) {
  const observedBlockHash = String(
    transaction?.blockhash ?? transaction?.blockHash ?? "",
  )
    .trim()
    .toLowerCase();
  return (
    Number(transaction?.confirmations) > 0 || isHexTxid(observedBlockHash)
  );
}

async function boundedMapWithConcurrency(items, concurrency, mapper) {
  const values = Array.from(items ?? []);
  if (values.length === 0) {
    return [];
  }
  const results = new Array(values.length);
  let cursor = 0;
  const worker = async () => {
    while (cursor < values.length) {
      const index = cursor;
      cursor += 1;
      results[index] = await mapper(values[index], index);
    }
  };
  await Promise.all(
    Array.from(
      {
        length: Math.min(
          values.length,
          Math.max(1, Math.floor(Number(concurrency) || 1)),
        ),
      },
      worker,
    ),
  );
  return results;
}

function prevoutFromOutput(vout) {
  if (!vout || typeof vout !== "object") {
    return null;
  }
  const numericValue = Number(vout.value);
  if (!Number.isFinite(numericValue) || numericValue < 0) {
    return null;
  }
  const coreScript = vout?.scriptPubKey;
  const mempoolScriptHex = vout?.scriptpubkey;
  const explicitValueSats = Number(vout?.valueSats);
  const valueSats = Number.isSafeInteger(explicitValueSats) && explicitValueSats >= 0
    ? BigInt(explicitValueSats)
    : coreScript && typeof coreScript === "object"
      ? satsFromVoutValue(vout.value)
      : BigInt(Math.round(numericValue));
  if (valueSats > BigInt(Number.MAX_SAFE_INTEGER)) {
    return null;
  }
  const scriptHex =
    coreScript && typeof coreScript === "object"
      ? coreScript.hex
      : mempoolScriptHex;
  if (
    typeof scriptHex !== "string" ||
    scriptHex.length % 2 !== 0 ||
    !/^[0-9a-f]*$/iu.test(scriptHex)
  ) {
    return null;
  }
  return {
    scriptPubKey:
      coreScript && typeof coreScript === "object"
        ? coreScript
        : {
            address: String(vout?.scriptpubkey_address ?? ""),
            asm: String(vout?.scriptpubkey_asm ?? ""),
            hex: scriptHex,
            type: String(vout?.scriptpubkey_type ?? ""),
          },
    value: vout.value,
    valueSats: Number(valueSats),
  };
}

async function transactionWithInputPrevouts(tx) {
  if (!tx || typeof tx !== "object") {
    return tx;
  }
  const vin = Array.isArray(tx.vin) ? tx.vin : [];
  if (vin.length === 0) {
    return tx;
  }

  const previousTxids = [
    ...new Set(
      vin.flatMap((input) => {
        if (input?.prevout) {
          return [];
        }
        const prevTxid = String(input?.txid ?? "").trim().toLowerCase();
        const prevVout = Number(input?.vout);
        return isHexTxid(prevTxid) &&
          Number.isSafeInteger(prevVout) &&
          prevVout >= 0
          ? [prevTxid]
          : [];
      }),
    ),
  ];
  const previousTransactions = new Map(
    await boundedMapWithConcurrency(
      previousTxids,
      PREVOUT_HYDRATION_CONCURRENCY,
      async (prevTxid) => [prevTxid, await rawTransactionFromCore(prevTxid)],
    ),
  );

  const hydratedVin = vin.map((input) => {
    if (input?.prevout) {
      const prevout = prevoutFromOutput(input.prevout);
      return prevout ? { ...input, prevout } : input;
    }
    const prevTxid = String(input?.txid ?? "").trim().toLowerCase();
    const prevVout = Number(input?.vout);
    if (!isHexTxid(prevTxid) || !Number.isSafeInteger(prevVout) || prevVout < 0) {
      return input;
    }
    const previousOutput = previousTransactions.get(prevTxid)?.vout?.[prevVout];
    const prevout = prevoutFromOutput(previousOutput);
    return prevout ? { ...input, prevout } : input;
  });

  return { ...tx, vin: hydratedVin };
}

function assertCanonicalProtocolTransactionContent(tx) {
  const txid = String(tx?.txid ?? "").trim().toLowerCase();
  const inputs = Array.isArray(tx?.vin) ? tx.vin : null;
  if (!isHexTxid(txid) || !inputs || inputs.length === 0) {
    throw new CanonicalTransactionContentInvariantError(
      `Canonical protocol transaction ${txid || "unknown"} has an invalid transaction envelope`,
    );
  }
  for (const [index, input] of inputs.entries()) {
    if (input?.coinbase) {
      continue;
    }
    const previousTxid = String(input?.txid ?? "").trim().toLowerCase();
    const previousVout = Number(input?.vout);
    if (
      !isHexTxid(previousTxid) ||
      !Number.isSafeInteger(previousVout) ||
      previousVout < 0
    ) {
      throw new CanonicalTransactionContentInvariantError(
        `Canonical protocol transaction ${txid} input ${index} has an invalid outpoint`,
      );
    }
  }
}

function assertHydratedProtocolTransaction(tx) {
  for (const [index, input] of (tx?.vin ?? []).entries()) {
    if (input?.coinbase) {
      continue;
    }
    const prevout = input?.prevout;
    const previousTxid = String(input?.txid ?? "").trim().toLowerCase();
    const previousVout = Number(input?.vout);
    const scriptHex = String(prevout?.scriptPubKey?.hex ?? "");
    if (
      !isHexTxid(previousTxid) ||
      !Number.isSafeInteger(previousVout) ||
      previousVout < 0 ||
      !prevout ||
      !Number.isSafeInteger(Number(prevout.valueSats)) ||
      Number(prevout.valueSats) < 0 ||
      scriptHex.length % 2 !== 0 ||
      !/^[0-9a-f]*$/iu.test(scriptHex) ||
      typeof prevout?.scriptPubKey?.hex !== "string"
    ) {
      throw new Error(
        `Canonical protocol transaction ${tx?.txid ?? "unknown"} input ${index} has no complete canonical prevout`,
      );
    }
  }
}

function canonicalBlockScanVerificationFailureRecord(
  error,
  { height, txid },
) {
  const trustedDeterministicFailure =
    error instanceof CanonicalTransactionContentInvariantError &&
    error?.code === CANONICAL_TX_CONTENT_FAILURE_CODE &&
    error?.name === CANONICAL_TX_CONTENT_FAILURE_CLASS;
  const statusCode = Number(error?.statusCode);
  return {
    error: error?.message ?? String(error),
    errorName: String(error?.name ?? "Error"),
    ...(trustedDeterministicFailure
      ? {
          failureClass: CANONICAL_TX_CONTENT_FAILURE_CLASS,
          failureCode: CANONICAL_TX_CONTENT_FAILURE_CODE,
        }
      : {}),
    height,
    phase: "block-scan-verification",
    ...(Number.isSafeInteger(statusCode) && statusCode > 0
      ? { statusCode }
      : {}),
    txid,
  };
}

function assertCanonicalBlockEnvelope(block, height, blockHash) {
  const transactions = Array.isArray(block?.tx) ? block.tx : [];
  const returnedHash = String(block?.hash ?? "").trim().toLowerCase();
  if (
    returnedHash !== String(blockHash ?? "").trim().toLowerCase() ||
    Number(block?.height) !== height ||
    transactions.length === 0 ||
    Number(block?.nTx) !== transactions.length ||
    transactions.some((tx) => !isHexTxid(tx?.txid))
  ) {
    throw new Error(`Bitcoin Core returned an invalid block envelope at ${height}`);
  }
}

function opReturnTextFromVout(vout) {
  const asm = String(
    vout?.scriptPubKey?.asm ?? vout?.scriptpubkey_asm ?? "",
  ).trim();
  if (!asm.startsWith("OP_RETURN")) {
    return "";
  }

  const chunks = [];
  for (const part of asm.split(/\s+/u).slice(1)) {
    if (/^(?:[0-9a-f]{2})+$/iu.test(part)) {
      chunks.push(Buffer.from(part, "hex"));
    }
  }
  if (chunks.length === 0) {
    return "";
  }
  return Buffer.concat(chunks).toString("utf8");
}

function protocolMessagesFromTx(tx) {
  const messages = [];
  for (const [voutIndex, vout] of (tx?.vout ?? []).entries()) {
    const text = opReturnTextFromVout(vout);
    const prefix = PROTOCOL_PREFIXES.find((candidate) =>
      text.startsWith(candidate),
    );
    if (prefix) {
      messages.push({ prefix, text, voutIndex });
    }
  }
  return messages;
}

function protocolMessagesContainInceptionBond(messages) {
  return (Array.isArray(messages) ? messages : []).some((message) => {
    const text = String(
      typeof message === "string" ? message : message?.text ?? "",
    ).trim().toLowerCase();
    return text === "pwm1:m:incb";
  });
}

function satsFromVoutValue(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric <= 0) {
    return 0n;
  }
  if (Number.isInteger(numeric) && numeric > 21_000_000) {
    return BigInt(numeric);
  }
  return BigInt(Math.round(numeric * 100_000_000));
}

function addressFromVout(vout) {
  return String(
    vout?.scriptPubKey?.address ??
      vout?.scriptpubkey_address ??
      vout?.scriptPubKey?.addresses?.[0] ??
      "",
  );
}

function paymentOutputsBeforeProtocol(tx, protocolIndex) {
  return (tx?.vout ?? [])
    .filter((_vout, index) =>
      Number.isSafeInteger(Number(protocolIndex))
        ? index < Number(protocolIndex)
        : true,
    )
    .map((vout) => ({
      address: addressFromVout(vout),
      amountSats: satsFromVoutValue(vout.value),
      vout: Number(vout.n ?? 0),
    }))
    .filter((output) => output.address && output.amountSats > 0n);
}

function senderAddressFromTx(tx) {
  for (const vin of tx?.vin ?? []) {
    const address = String(
      vin?.prevout?.scriptPubKey?.address ??
        vin?.prevout?.scriptpubkey_address ??
        vin?.prevout?.scriptPubKey?.addresses?.[0] ??
        "",
    );
    if (address) {
      return address;
    }
  }
  return "";
}

function blockEventTime(tx) {
  const time = Number(tx?.blocktime ?? tx?.status?.block_time ?? 0);
  return Number.isFinite(time) && time > 0
    ? new Date(time * 1000).toISOString()
    : new Date().toISOString();
}

function decodeBase64UrlText(value) {
  try {
    const normalized = String(value ?? "").replace(/-/gu, "+").replace(/_/gu, "/");
    const padded = normalized.padEnd(
      Math.ceil(normalized.length / 4) * 4,
      "=",
    );
    return Buffer.from(padded, "base64").toString("utf8");
  } catch {
    return "";
  }
}

function decodeBase64UrlJson(value) {
  try {
    const normalized = String(value ?? "").replace(/-/gu, "+").replace(/_/gu, "/");
    const padded = normalized.padEnd(
      Math.ceil(normalized.length / 4) * 4,
      "=",
    );
    return JSON.parse(Buffer.from(padded, "base64").toString("utf8"));
  } catch {
    return null;
  }
}

function normalizedPowId(value) {
  return String(value ?? "")
    .trim()
    .replace(/@proofofwork\.me$/iu, "")
    .toLowerCase();
}

function baseProtocolItem(tx, message, kind) {
  const payments = paymentOutputsBeforeProtocol(tx, message?.voutIndex);
  const amountSats = payments.reduce(
    (sum, output) => sum + output.amountSats,
    0n,
  );
  return {
    amountSats: amountSats.toString(),
    blockHeight: Number(tx?.status?.block_height ?? tx?.height ?? 0) || null,
    blockIndex: Number.isSafeInteger(Number(tx?._powBlockIndex))
      ? Number(tx._powBlockIndex)
      : undefined,
    blockTime: blockEventTime(tx),
    confirmed:
      Number(tx?.confirmations ?? 0) > 0 ||
      Number(tx?.status?.block_height ?? tx?.height ?? 0) > 0,
    dataBytes: Buffer.byteLength(message.text, "utf8"),
    kind,
    network: NETWORK,
    payload: message.text,
    protocol: message.prefix.replace(/:$/u, ""),
    protocolVout: Number(message?.voutIndex),
    recipients: payments.map((output) => ({
      address: output.address,
      amountSats: output.amountSats.toString(),
      vout: output.vout,
    })),
    senderAddress: senderAddressFromTx(tx),
    timestamp: blockEventTime(tx),
    txid: tx.txid,
  };
}

function decodedBase64UrlBytes(value) {
  const encoded = String(value ?? "");
  if (!/^[A-Za-z0-9_-]*$/u.test(encoded)) {
    return null;
  }
  try {
    const normalized = encoded.replace(/-/gu, "+").replace(/_/gu, "/");
    const padded = normalized.padEnd(
      Math.ceil(normalized.length / 4) * 4,
      "=",
    );
    return Buffer.from(padded, "base64");
  } catch {
    return null;
  }
}

function aggregatePwmProtocolItem(tx, messages) {
  const pwmMessages = messages.filter((message) => message?.prefix === "pwm1:");
  if (pwmMessages.length === 0) {
    return null;
  }

  let attachmentAccumulator = null;
  let attachmentMalformed = false;
  let parentTxid = "";
  let replyTo = "";
  let subject = "";
  const memoChunks = [];
  for (const message of pwmMessages) {
    const payload = String(message?.text ?? "").slice("pwm1:".length);
    if (payload.startsWith("s:")) {
      subject = decodeBase64UrlText(payload.slice(2)).trim();
      continue;
    }
    if (payload.startsWith("m:")) {
      memoChunks.push(payload.slice(2));
      continue;
    }
    if (/^r:[0-9a-f]{64}$/iu.test(payload)) {
      parentTxid = payload.slice(2).toLowerCase();
      continue;
    }
    if (payload.startsWith("f:")) {
      replyTo = payload.slice(2).trim();
      continue;
    }
    if (!payload.startsWith("a:")) {
      continue;
    }

    const parts = payload.split(":");
    const size = Number(parts[3]);
    const sha256 = String(parts[4] ?? "").toLowerCase();
    const part = String(parts[5] ?? "").match(/^(\d+)\/(\d+)$/u);
    const index = Number(part?.[1]);
    const total = Number(part?.[2]);
    const mime = decodeBase64UrlText(parts[1]).trim();
    const name = decodeBase64UrlText(parts[2]).trim();
    if (
      parts.length !== 7 ||
      !mime ||
      !name ||
      !Number.isSafeInteger(size) ||
      size <= 0 ||
      size > MAIL_ATTACHMENT_MAX_BYTES ||
      !/^[0-9a-f]{64}$/u.test(sha256) ||
      !part ||
      !Number.isSafeInteger(index) ||
      !Number.isSafeInteger(total) ||
      total < 1 ||
      index < 0 ||
      index >= total
    ) {
      attachmentMalformed = true;
      continue;
    }
    if (!attachmentAccumulator) {
      attachmentAccumulator = {
        chunks: Array.from({ length: total }, () => ""),
        mime,
        name,
        sha256,
        size,
        total,
      };
    }
    if (
      attachmentAccumulator.mime !== mime ||
      attachmentAccumulator.name !== name ||
      attachmentAccumulator.sha256 !== sha256 ||
      attachmentAccumulator.size !== size ||
      attachmentAccumulator.total !== total ||
      attachmentAccumulator.chunks[index]
    ) {
      attachmentMalformed = true;
      continue;
    }
    attachmentAccumulator.chunks[index] = parts[6];
  }

  let attachment;
  if (
    !attachmentMalformed &&
    attachmentAccumulator &&
    attachmentAccumulator.chunks.every(Boolean)
  ) {
    const data = attachmentAccumulator.chunks.join("");
    const bytes = decodedBase64UrlBytes(data);
    if (
      bytes &&
      bytes.byteLength === attachmentAccumulator.size &&
      createHash("sha256").update(bytes).digest("hex") ===
        attachmentAccumulator.sha256
    ) {
      attachment = {
        data,
        mime: attachmentAccumulator.mime,
        name: attachmentAccumulator.name,
        sha256: attachmentAccumulator.sha256,
        size: attachmentAccumulator.size,
      };
    }
  }

  const memo = memoChunks.join("");
  if (!memo && !subject && !parentTxid && !replyTo && !attachment) {
    return null;
  }
  const kind = attachment
    ? "file"
    : parentTxid
      ? "reply"
      : bondTagForMemo(memo)?.kind
        ? bondTagForMemo(memo).kind
        : "mail";
  return {
    ...baseProtocolItem(tx, pwmMessages[0], kind),
    ...(attachment ? { attachment } : {}),
    dataBytes: pwmMessages.reduce(
      (total, message) =>
        total + Buffer.byteLength(String(message?.text ?? ""), "utf8"),
      0,
    ),
    memo,
    ...(parentTxid ? { parentTxid } : {}),
    payload: pwmMessages.map((message) => message.text).join("\n"),
    ...(replyTo ? { replyTo } : {}),
    ...(subject ? { subject } : {}),
  };
}

function canonicalBondMintItemsFromMailItem(item) {
  const bondTag = bondTagForKind(item?.kind);
  if (!bondTag || item?.confirmed !== true) {
    return [];
  }
  return (Array.isArray(item?.recipients) ? item.recipients : []).flatMap(
    (recipient) => {
      const minterAddress = String(recipient?.address ?? "").trim();
      const amount = String(recipient?.amountSats ?? "").trim();
      if (!minterAddress || !/^[1-9]\d*$/u.test(amount)) {
        return [];
      }
      return [
        {
          amount,
          // The PWM event carries the bond proofs. The companion only projects
          // bond credit units and must never count the same proofs a second time.
          amountSats: 0,
          blockHeight: item.blockHeight,
          blockIndex: item.blockIndex,
          blockTime: item.blockTime,
          confirmed: true,
          dataBytes: 0,
          kind: "token-mint",
          bondRecipientAddress: minterAddress,
          bondRecipientAmountSats: amount,
          bondRecipientVout: Number(recipient?.vout),
          minterAddress,
          network: item.network,
          protocol: "pwt1",
          sourceBondTxid: item.txid,
          ticker: bondTag.ticker,
          timestamp: item.timestamp,
          tokenId: bondTag.tokenId,
          txid: item.txid,
          valid: true,
          validationMode: `canonical-${bondTag.ticker.toLowerCase()}-bond-projection`,
          ...(bondTag.issuanceAccountingModel
            ? {
                issuanceAccountingModel: bondTag.issuanceAccountingModel,
                issuanceUnitSats: 1,
                issuanceValuationFixedAtSend: true,
              }
            : {}),
        },
      ];
    },
  );
}

function tokenListingItemFromTicket(tx, message, ticket) {
  const base = baseProtocolItem(tx, message, "token-listing");
  const tokenId = String(ticket?.tokenId ?? ticket?.asset ?? "").toLowerCase();
  if (!isHexTxid(tokenId)) {
    return null;
  }
  return workProjectionItem({
    ...base,
    amount: String(ticket?.amount ?? ticket?.quantity ?? ticket?.units ?? 0),
    amountAtoms: ticket?.amountAtoms,
    listingId: tx.txid,
    priceSats: String(
      ticket?.priceSats ??
        ticket?.price ??
        ticket?.totalPriceSats ??
        ticket?.totalSats ??
        0,
    ),
    saleAuthorization: ticket,
    saleTicketTxid: tx.txid,
    saleTicketValueSats: String(ticket?.saleTicketValueSats ?? 546),
    saleTicketVout: Number(ticket?.saleTicketVout ?? 2),
    sellerAddress:
      ticket?.sellerAddress ?? ticket?.seller ?? base.senderAddress ?? "",
    tokenId,
  }, { strict: false });
}

function protocolItemsFromTx(tx, message) {
  const parts = String(message.text ?? "").split(":");
  const action = String(parts[1] ?? "").toLowerCase();
  if (message.prefix === "pwm1:") {
    const memo = parts.slice(2).join(":");
    return [
      {
        ...baseProtocolItem(
          tx,
          message,
          action === "a"
            ? "attachment"
            : action === "r"
              ? "reply"
              : bondTagForMemo(memo)?.kind
                ? bondTagForMemo(memo).kind
                : "mail",
        ),
        memo,
        subject: action === "s" ? decodeBase64UrlText(parts[2]) : "",
      },
    ];
  }

  if (message.prefix === "pwid1:") {
    const base = baseProtocolItem(
      tx,
      message,
      action === "r" || action === "r2"
        ? "id-register"
        : action === "u"
          ? "id-update"
          : action === "t"
            ? "id-transfer"
            : `id-${action || "event"}`,
    );
    const id = normalizedPowId(
      action === "r" ? parts[2] : decodeBase64UrlText(parts[2]),
    );
    if (action === "r" || action === "r2") {
      const ownerAddress = String(parts[3] ?? "").trim();
      const receiveAddress = String(parts[4] ?? ownerAddress).trim();
      const pgpPublicKey = parts[5]
        ? decodeBase64UrlText(parts[5]).trim()
        : "";
      return [{
        ...base,
        id,
        ownerAddress,
        pgpPublicKey: pgpPublicKey || undefined,
        receiveAddress,
      }];
    }
    if (action === "u") {
      return [{
        ...base,
        id,
        receiveAddress: String(parts[3] ?? "").trim(),
      }];
    }
    if (action === "t") {
      const ownerAddress = String(parts[3] ?? "").trim();
      return [{
        ...base,
        id,
        ownerAddress,
        receiveAddress: String(parts[4] ?? ownerAddress).trim(),
      }];
    }
    if (action === "buy5") {
      const ownerAddress = String(parts[3] ?? "").trim();
      return [{
        ...base,
        kind: "id-buy",
        listingId: String(parts[2] ?? "").trim().toLowerCase(),
        ownerAddress,
        receiveAddress: String(parts[4] ?? ownerAddress).trim(),
        transferVersion: "buy5",
      }];
    }
    if (["list5", "seal5", "delist5"].includes(action)) {
      return [{
        ...base,
        kind:
          action === "list5"
            ? "id-list"
            : action === "seal5"
              ? "id-seal"
              : "id-delist",
        listingId: String(parts[2] ?? tx.txid ?? "").trim().toLowerCase(),
      }];
    }
    return [{ ...base, id }];
  }

  if (message.prefix === "pwr1:") {
    const base = baseProtocolItem(tx, message, "rush-mint");
    const registryPaymentSats = (Array.isArray(base.recipients)
      ? base.recipients
      : []
    ).reduce(
      (total, recipient) =>
        String(recipient?.address ?? "") === RUSH_REGISTRY_ADDRESS
          ? total + BigInt(String(recipient?.amountSats ?? "0"))
          : total,
      0n,
    );
    const minterAddress = senderAddressFromTx(tx);
    const item = {
      ...base,
      amountSats: RUSH_MINT_PRICE_SATS.toString(),
      minterAddress,
      paidSats: RUSH_MINT_PRICE_SATS.toString(),
      registryAddress: RUSH_REGISTRY_ADDRESS,
      validationMode: "canonical-ordered-rush-index",
    };
    if (
      String(message.text ?? "") !== RUSH_MINT_PAYLOAD ||
      !minterAddress ||
      registryPaymentSats < RUSH_MINT_PRICE_SATS
    ) {
      return [
        invalidProtocolItem(
          item,
          "Malformed RUSH mint or missing canonical registry payment.",
        ),
      ];
    }
    return [{ ...item, valid: true }];
  }

  if (message.prefix !== "pwt1:") {
    return [baseProtocolItem(tx, message, `${message.prefix.replace(/:$/u, "")}-event`)];
  }

  if (action === "create") {
    return [
      {
        ...baseProtocolItem(tx, message, "token-create"),
        createTxid: tx.txid,
        creatorAddress: senderAddressFromTx(tx),
        maxSupply: parts[3] ?? "0",
        mintAmount: parts[4] ?? "0",
        mintPriceSats: parts[5] ?? "0",
        registryAddress: parts[6] ?? "",
        ticker: parts[2] ?? "",
        tokenId: tx.txid,
      },
    ];
  }
  if (action === "mint") {
    return [
      workProjectionItem({
        ...baseProtocolItem(tx, message, "token-mint"),
        amount: parts[3] ?? "0",
        minterAddress: senderAddressFromTx(tx),
        tokenId: String(parts[2] ?? "").toLowerCase(),
      }, { strict: false }),
    ];
  }
  if (action === "send" || action === "send2") {
    const tokenId = String(parts[2] ?? "").toLowerCase();
    const atomic = action === "send2";
    return [
      workProjectionItem({
        ...baseProtocolItem(tx, message, "token-transfer"),
        ...(atomic
          ? { amountAtoms: parts[3] ?? "" }
          : { amount: parts[3] ?? "0" }),
        recipientAddress: parts[4] ?? "",
        senderAddress: senderAddressFromTx(tx),
        tokenId,
        transferVersion: atomic ? "send2" : "send",
      }, { strict: false }),
    ];
  }
  if (action === "list5") {
    const item = tokenListingItemFromTicket(tx, message, decodeBase64UrlJson(parts[2]));
    return item ? [item] : [baseProtocolItem(tx, message, "token-listing")];
  }
  if (action === "seal5") {
    const ticket = decodeBase64UrlJson(parts[3]);
    const item = tokenListingItemFromTicket(tx, message, ticket);
    const listingId = String(
      parts[2] ?? ticket?.anchorTxid ?? item?.listingId ?? "",
    )
      .trim()
      .toLowerCase();
    return [
      {
        ...(item ?? baseProtocolItem(tx, message, "token-listing-sealed")),
        kind: "token-listing-sealed",
        closeTxid: undefined,
        closedTxid: undefined,
        listingId,
        saleTicketTxid:
          ticket?.anchorTxid ?? listingId ?? item?.saleTicketTxid ?? "",
        saleTicketValueSats:
          ticket?.anchorValueSats ?? item?.saleTicketValueSats ?? 546,
        saleTicketVout: ticket?.anchorVout ?? item?.saleTicketVout ?? 2,
        sealConfirmed: true,
        sealTxid: tx.txid,
      },
    ];
  }
  if (action === "delist5") {
    return [
      {
        ...baseProtocolItem(tx, message, "token-listing-closed"),
        closedTxid: tx.txid,
        listingId: parts[2] ?? "",
      },
    ];
  }
  if (action === "buy5") {
    return [
      {
        ...baseProtocolItem(tx, message, "token-sale"),
        buyerAddress: parts[3] ?? "",
        listingId: parts[2] ?? "",
        saleTxid: tx.txid,
      },
    ];
  }
  return [baseProtocolItem(tx, message, "token-event")];
}

function rawProtocolItemsForTx(tx, messages) {
  const mailItem = aggregatePwmProtocolItem(tx, messages);
  const pwmMessages = messages.filter((message) => message?.prefix === "pwm1:");
  const rushMessage =
    messages.find(
      (message) =>
        message?.prefix === "pwr1:" && message?.text === "pwr1:m:rush",
    ) ?? messages.find((message) => message?.prefix === "pwr1:");
  const invalidMailItem =
    pwmMessages.length > 0 && !mailItem
      ? invalidProtocolItem(
          {
            ...baseProtocolItem(tx, pwmMessages[0], "mail"),
            dataBytes: pwmMessages.reduce(
              (total, message) =>
                total + Buffer.byteLength(String(message?.text ?? ""), "utf8"),
              0,
            ),
            payload: pwmMessages.map((message) => message.text).join("\n"),
          },
          "Malformed or unknown aggregated PWM protocol payload.",
        )
      : null;
  return [
    ...(mailItem ? [mailItem] : []),
    ...(invalidMailItem ? [invalidMailItem] : []),
    ...canonicalBondMintItemsFromMailItem(mailItem),
    ...(rushMessage ? protocolItemsFromTx(tx, rushMessage) : []),
    ...messages
      .filter((message) =>
        ["pwid1:", "pwt1:"].includes(message?.prefix),
      )
      .flatMap((message) => protocolItemsFromTx(tx, message)),
  ];
}

function sourceLabelForProtocolItem(item) {
  const kind = String(item?.kind ?? "").toLowerCase();
  if (kind.endsWith("-invalid")) {
    return kind.startsWith("token-") ? "token-invalid-events" : "log";
  }
  if (kind === "token-create") {
    return "tokens";
  }
  if (kind === "token-mint") {
    return "token-mints";
  }
  if (kind === "token-transfer") {
    return "token-transfers";
  }
  if (kind === "token-sale") {
    return "token-sales";
  }
  if (kind === "token-listing-closed") {
    return "token-closed-listings";
  }
  if (kind.startsWith("token-listing")) {
    return "token-listings";
  }
  if (["id-register", "id-update", "id-transfer"].includes(kind)) {
    return "registry-records";
  }
  if (kind.includes("list")) {
    return "registry-listings";
  }
  if (kind.includes("buy") || kind.includes("transfer")) {
    return "registry-sales";
  }
  return "log";
}

function tokenScopesForProtocolMessage(txid, text) {
  const parts = String(text ?? "").split(":");
  const action = String(parts[1] ?? "").toLowerCase();
  const scopes = new Set();
  if (action === "create" && isHexTxid(txid)) {
    scopes.add(txid);
  }
  if (["mint", "send", "send2"].includes(action) && isHexTxid(parts[2])) {
    scopes.add(parts[2].toLowerCase());
  }
  if (action === "list5") {
    const ticket = decodeBase64UrlJson(parts[2]);
    if (isHexTxid(ticket?.tokenId)) {
      scopes.add(String(ticket.tokenId).toLowerCase());
    }
  }
  if (action === "seal5") {
    const ticket = decodeBase64UrlJson(parts[3]);
    if (isHexTxid(ticket?.tokenId)) {
      scopes.add(String(ticket.tokenId).toLowerCase());
    }
  }
  if (scopes.size === 0) {
    scopes.add("all");
  }
  return [...scopes];
}

function tokenRecoveryKindsForProtocolMessage(text) {
  const action = String(String(text ?? "").split(":")[1] ?? "").toLowerCase();
  if (action === "create") {
    return [{ kind: "tokens", label: "tokens" }];
  }
  if (action === "mint") {
    return [{ kind: "mints", label: "token-mints" }];
  }
  if (action === "send" || action === "send2") {
    return [{ kind: "transfers", label: "token-transfers" }];
  }
  if (action === "list5" || action === "seal5") {
    return [{ kind: "listings", label: "token-listings" }];
  }
  if (action === "delist5") {
    return [{ kind: "closed-listings", label: "token-closed-listings" }];
  }
  if (action === "buy5") {
    return [
      { kind: "sales", label: "token-sales" },
      { kind: "closed-listings", label: "token-closed-listings" },
    ];
  }
  return [
    { kind: "tokens", label: "tokens" },
    { kind: "mints", label: "token-mints" },
    { kind: "transfers", label: "token-transfers" },
    { kind: "listings", label: "token-listings" },
    { kind: "closed-listings", label: "token-closed-listings" },
    { kind: "sales", label: "token-sales" },
    { kind: "invalid-events", label: "token-invalid-events" },
  ];
}

function recoveryEndpointSpecs(txid, message) {
  if (
    message.prefix === "pwm1:" &&
    String(message.text ?? "").trim().toLowerCase() ===
      `pwm1:m:${INCEPTION_BOND_MEMO}`
  ) {
    return [
      {
        label: "token-verifier",
        params: { asset: INCB_TOKEN_ID, txid },
        path: "/api/v1/internal/token-verifier",
      },
    ];
  }
  if (message.prefix === "pwid1:") {
    return [
      {
        label: "id-verifier",
        params: { txid },
        path: "/api/v1/internal/id-verifier",
      },
    ];
  }
  if (message.prefix === "pwt1:") {
    const action = String(message.text ?? "").split(":")[1]?.toLowerCase() ?? "";
    if (
      ![
        "create",
        "mint",
        "send",
        "send2",
        "list5",
        "seal5",
        "delist5",
        "buy5",
      ].includes(action)
    ) {
      return [];
    }
    const scopes = tokenScopesForProtocolMessage(txid, message.text);
    return [{
      label: "token-verifier",
      params: { asset: scopes[0] ?? "all", txid },
      path: "/api/v1/internal/token-verifier",
    }];
  }
  return [];
}

function invalidProtocolItem(item, reason) {
  const kind = String(item?.kind ?? "event").toLowerCase();
  return {
    ...item,
    kind: kind.endsWith("-invalid") ? kind : `${kind}-invalid`,
    reason,
    valid: false,
  };
}

function canonicalIntegerText(value, { positive = false } = {}) {
  const text = String(value ?? "").trim();
  if (!(positive ? /^[1-9]\d*$/u : /^\d+$/u).test(text)) {
    return "";
  }
  return text;
}

function canonicalWorkAtomsText(value, { allowZero = false } = {}) {
  const text = String(value ?? "").trim();
  try {
    const normalized = normalizeWorkAtoms(text, { allowZero });
    return normalized === text &&
      BigInt(normalized) <= BigInt(WORK_TOKEN_MAX_SUPPLY_ATOMS)
      ? normalized
      : "";
  } catch {
    return "";
  }
}

function canonicalIncbIssuanceQ8Projection({
  attachedWorkAmountAtoms,
  directProofIssuanceUnits,
  workNetworkValueQ8,
}) {
  const atomsText = canonicalWorkAtomsText(attachedWorkAmountAtoms, {
    allowZero: true,
  });
  const directText = canonicalIntegerText(directProofIssuanceUnits, {
    positive: true,
  });
  const workNetworkValueQ8Text = canonicalIntegerText(workNetworkValueQ8, {
    positive: true,
  });
  if (!atomsText || !directText || !workNetworkValueQ8Text) {
    throw new Error("Canonical INCB Q8 issuance inputs are noncanonical.");
  }
  const atoms = BigInt(atomsText);
  const direct = BigInt(directText);
  const workNetworkValue = BigInt(workNetworkValueQ8Text);
  const attachedValueQ8 =
    (atoms * workNetworkValue) /
    (BigInt(WORK_TOKEN_MAX_SUPPLY) * WORK_UNIT_SCALE);
  const issuanceValueQ8 = direct * VALUE_Q8_SCALE + attachedValueQ8;
  return {
    attachedWorkIssuanceUnits: (
      attachedValueQ8 / VALUE_Q8_SCALE
    ).toString(),
    attachedWorkLiveValueAtSendQ8: attachedValueQ8.toString(),
    confirmedIssuanceUnits: (issuanceValueQ8 / VALUE_Q8_SCALE).toString(),
    issuanceDustQ8: (issuanceValueQ8 % VALUE_Q8_SCALE).toString(),
    issuanceNetworkValueQ8: issuanceValueQ8.toString(),
  };
}

function incbIssuanceMetadataInvalidReason(item) {
  if (
    String(item?.issuanceAccountingModel ?? "") !==
    INCB_ISSUANCE_ACCOUNTING_MODEL
  ) {
    return "missing canonical INCB issuance accounting model";
  }
  const minterAddress = String(item?.minterAddress ?? "").trim();
  const bondRecipientAddress = String(
    item?.bondRecipientAddress ?? "",
  ).trim();
  const bondRecipientAmountText = canonicalIntegerText(
    item?.bondRecipientAmountSats,
    { positive: true },
  );
  const bondRecipientVoutText = canonicalIntegerText(
    item?.bondRecipientVout,
  );
  if (
    !minterAddress ||
    bondRecipientAddress !== minterAddress ||
    !bondRecipientAmountText ||
    !bondRecipientVoutText ||
    item?.issuanceValuationFixedAtSend !== true ||
    Number(item?.issuanceUnitSats) !== 1
  ) {
    return "INCB issuance is missing its exact bond recipient or fixed one-proof unit binding";
  }
  const amountText = canonicalIntegerText(item?.amount, { positive: true });
  const issuanceAmountText = canonicalIntegerText(item?.issuanceAmount, {
    positive: true,
  });
  const confirmedIssuanceText = canonicalIntegerText(
    item?.confirmedIssuanceUnits,
    { positive: true },
  );
  const directText = canonicalIntegerText(item?.directProofIssuanceUnits);
  const attachedText = canonicalIntegerText(item?.attachedWorkIssuanceUnits);
  if (
    !amountText ||
    amountText !== issuanceAmountText ||
    amountText !== confirmedIssuanceText ||
    !directText ||
    !attachedText
  ) {
    return "INCB issuance units are missing or inconsistent";
  }
  const amount = BigInt(amountText);
  const direct = BigInt(directText);
  const attached = BigInt(attachedText);
  if (direct <= 0n || direct + attached !== amount) {
    return "INCB direct and attached issuance units do not conserve supply";
  }
  const atomicMetadataPresent = [
    item?.attachedWorkAmountAtoms,
    item?.attachedWorkLiveValueAtSendQ8,
    item?.issuanceDustQ8,
    item?.issuanceNetworkValueQ8,
    item?.issuanceValueSnapshotWorkNetworkValueQ8,
  ].some((value) => value !== undefined && value !== null && value !== "");
  let attachedWorkAmountAtoms = null;
  let attachedWorkLiveValueAtSendQ8 = null;
  let issuanceDustQ8 = null;
  let issuanceNetworkValueQ8 = null;
  let snapshotWorkNetworkValueQ8 = null;
  if (atomicMetadataPresent) {
    const attachedWorkAmountAtomsText = canonicalWorkAtomsText(
      item?.attachedWorkAmountAtoms,
      { allowZero: true },
    );
    const attachedWorkLiveValueAtSendQ8Text = canonicalIntegerText(
      item?.attachedWorkLiveValueAtSendQ8,
    );
    const issuanceDustQ8Text = canonicalIntegerText(item?.issuanceDustQ8);
    const issuanceNetworkValueQ8Text = canonicalIntegerText(
      item?.issuanceNetworkValueQ8,
    );
    const snapshotWorkNetworkValueQ8Text = canonicalIntegerText(
      item?.issuanceValueSnapshotWorkNetworkValueQ8,
    );
    if (
      !attachedWorkAmountAtomsText ||
      !attachedWorkLiveValueAtSendQ8Text ||
      !issuanceDustQ8Text ||
      !issuanceNetworkValueQ8Text ||
      !snapshotWorkNetworkValueQ8Text
    ) {
      return "INCB exact atomic issuance metadata is incomplete or noncanonical";
    }
    attachedWorkAmountAtoms = BigInt(attachedWorkAmountAtomsText);
    attachedWorkLiveValueAtSendQ8 = BigInt(
      attachedWorkLiveValueAtSendQ8Text,
    );
    issuanceDustQ8 = BigInt(issuanceDustQ8Text);
    issuanceNetworkValueQ8 = BigInt(issuanceNetworkValueQ8Text);
    snapshotWorkNetworkValueQ8 = BigInt(snapshotWorkNetworkValueQ8Text);
    const expected = canonicalIncbIssuanceQ8Projection({
      attachedWorkAmountAtoms: attachedWorkAmountAtomsText,
      directProofIssuanceUnits: directText,
      workNetworkValueQ8: snapshotWorkNetworkValueQ8Text,
    });
    if (
      expected.attachedWorkLiveValueAtSendQ8 !==
        attachedWorkLiveValueAtSendQ8.toString() ||
      expected.issuanceNetworkValueQ8 !== issuanceNetworkValueQ8.toString() ||
      expected.confirmedIssuanceUnits !== amount.toString() ||
      expected.attachedWorkIssuanceUnits !== attached.toString() ||
      expected.issuanceDustQ8 !== issuanceDustQ8.toString()
    ) {
      return "INCB exact atomic issuance metadata does not conserve value";
    }
  }
  const safeAmount = atomicMetadataPresent ? null : Number(amount);
  const safeDirect = atomicMetadataPresent ? null : Number(direct);
  const safeAttached = atomicMetadataPresent ? null : Number(attached);
  if (
    !atomicMetadataPresent &&
    (!Number.isSafeInteger(safeAmount) ||
      !Number.isSafeInteger(safeDirect) ||
      !Number.isSafeInteger(safeAttached))
  ) {
    return "Legacy INCB issuance exceeds exact JavaScript integer range without Q8 metadata";
  }
  const issuanceNetworkValueSats = atomicMetadataPresent
    ? null
    : Number(item?.issuanceNetworkValueSats);
  const issuanceDustSats = atomicMetadataPresent
    ? null
    : Number(item?.issuanceDustSats);
  const issuanceFloorSats = atomicMetadataPresent
    ? null
    : Number(item?.issuanceFloorSats);
  const attachedWorkLiveValueAtSendSats = atomicMetadataPresent
    ? null
    : Number(item?.attachedWorkLiveValueAtSendSats);
  if (
    !atomicMetadataPresent &&
    (!Number.isFinite(issuanceNetworkValueSats) ||
      issuanceNetworkValueSats <= 0 ||
      Math.floor(issuanceNetworkValueSats) !== safeAmount ||
      !Number.isFinite(issuanceDustSats) ||
      issuanceDustSats < 0 ||
      issuanceDustSats >= 1 ||
      Math.abs(
        issuanceDustSats - (issuanceNetworkValueSats - safeAmount),
      ) > 1e-6 ||
      !Number.isFinite(issuanceFloorSats) ||
      issuanceFloorSats <= 0 ||
      Math.abs(issuanceFloorSats - issuanceNetworkValueSats / safeAmount) >
        1e-9 ||
      !Number.isFinite(attachedWorkLiveValueAtSendSats) ||
      attachedWorkLiveValueAtSendSats < 0 ||
      Math.abs(
        issuanceNetworkValueSats -
          (safeDirect + attachedWorkLiveValueAtSendSats),
      ) > 1e-6 ||
      Math.floor(attachedWorkLiveValueAtSendSats) !== safeAttached)
  ) {
    return "INCB issuance value, dust, or one-proof unit floor is inconsistent";
  }
  const directPaymentText = canonicalIntegerText(
    item?.proofPaymentSats ?? item?.paidSats,
    { positive: true },
  );
  if (
    !directPaymentText ||
    directPaymentText !== directText ||
    BigInt(bondRecipientAmountText) !== direct
  ) {
    return "INCB direct proof issuance is not bound to the confirmed payment";
  }
  if (!atomicMetadataPresent && attached > 0n) {
    const attachedWorkAmount = Number(item?.attachedWorkAmount);
    const attachedWorkLiveFloorAtSendSats = Number(
      item?.attachedWorkLiveFloorAtSendSats,
    );
    if (
      !Number.isSafeInteger(attachedWorkAmount) ||
      attachedWorkAmount <= 0 ||
      !Number.isFinite(attachedWorkLiveFloorAtSendSats) ||
      attachedWorkLiveFloorAtSendSats <= 0 ||
      Math.abs(
        attachedWorkLiveValueAtSendSats -
          attachedWorkAmount * attachedWorkLiveFloorAtSendSats,
      ) > 1e-5
    ) {
      return "INCB attached WORK issuance basis is missing or inconsistent";
    }
  } else if (
    !atomicMetadataPresent &&
    attachedWorkLiveValueAtSendSats !== 0
  ) {
    return "INCB proof-only issuance carries unexpected attached WORK value";
  }
  const checkpointMode = String(item?.issuanceCheckpointMode ?? "");
  const checkpointHeight = Number(item?.issuanceCheckpointBlockHeight);
  const checkpointHash = String(item?.issuanceCheckpointBlockHash ?? "")
    .trim()
    .toLowerCase();
  const checkpointIndex = Number(item?.issuanceCheckpointBlockIndex);
  const checkpointWorkNetworkValueSats = atomicMetadataPresent
    ? null
    : Number(item?.issuanceValueSnapshotWorkNetworkValueSats);
  const attachedWorkLiveFloorAtSendSats = atomicMetadataPresent
    ? null
    : Number(item?.attachedWorkLiveFloorAtSendSats);
  const attachedWorkLiveFloorAtSendQ8Text = canonicalIntegerText(
    item?.attachedWorkLiveFloorAtSendQ8,
  );
  const exactCheckpointFloorMatches =
    atomicMetadataPresent && attachedWorkLiveFloorAtSendQ8Text
      ? BigInt(attachedWorkLiveFloorAtSendQ8Text) ===
        snapshotWorkNetworkValueQ8 / BigInt(WORK_TOKEN_MAX_SUPPLY)
      : false;
  const eventHeight = Number(item?.blockHeight ?? item?.height);
  const eventHash = String(item?.blockHash ?? item?._powBlockHash ?? "")
    .trim()
    .toLowerCase();
  const eventIndex = Number(item?.blockIndex ?? item?._powBlockIndex);
  if (
    checkpointMode !== "bond-transaction-provenance" ||
    !Number.isSafeInteger(checkpointHeight) ||
    checkpointHeight <= 0 ||
    !/^[0-9a-f]{64}$/u.test(checkpointHash) ||
    !Number.isSafeInteger(checkpointIndex) ||
    checkpointIndex < 0 ||
    (atomicMetadataPresent
      ? !exactCheckpointFloorMatches
      : !Number.isFinite(checkpointWorkNetworkValueSats) ||
        checkpointWorkNetworkValueSats <= 0 ||
        !Number.isFinite(attachedWorkLiveFloorAtSendSats) ||
        attachedWorkLiveFloorAtSendSats <= 0 ||
        Math.abs(
          attachedWorkLiveFloorAtSendSats -
            checkpointWorkNetworkValueSats / WORK_TOKEN_MAX_SUPPLY,
        ) > 1e-9) ||
    eventHeight !== checkpointHeight ||
    eventHash !== checkpointHash ||
    eventIndex !== checkpointIndex
  ) {
    return "INCB pre-bond valuation checkpoint is missing or inconsistent";
  }
  const valueSnapshotHeight = Number(
    item?.issuanceValueSnapshotBlockHeight,
  );
  const valueSnapshotHash = String(
    item?.issuanceValueSnapshotBlockHash ?? "",
  )
    .trim()
    .toLowerCase();
  const valueSnapshotCanonicalSummaryHash = String(
    item?.issuanceValueSnapshotCanonicalSummaryHash ?? "",
  )
    .trim()
    .toLowerCase();
  const valueSnapshotGeneratedAt = String(
    item?.issuanceValueSnapshotGeneratedAt ?? "",
  ).trim();
  if (
    item?.issuanceValueSnapshotModel !== INCB_VALUE_SNAPSHOT_MODEL ||
    item?.issuanceValueSnapshotMode !== "canonical-summary-refresh" ||
    !Number.isSafeInteger(valueSnapshotHeight) ||
    valueSnapshotHeight !== checkpointHeight - 1 ||
    !/^[0-9a-f]{64}$/u.test(valueSnapshotHash) ||
    !/^[0-9a-f]{64}$/u.test(valueSnapshotCanonicalSummaryHash) ||
    !String(item?.issuanceValueSnapshotId ?? "").trim() ||
    !Number.isFinite(Date.parse(valueSnapshotGeneratedAt))
  ) {
    return "INCB H-1 canonical WORK value snapshot provenance is missing or inconsistent";
  }
  return "";
}

function canonicalIncbIssuanceMintProjection(item) {
  return (
    String(item?.tokenId ?? "").trim().toLowerCase() === INCB_TOKEN_ID &&
    !incbIssuanceMetadataInvalidReason(item)
  );
}

function canonicalBondMintProjectionStructure(item) {
  const tokenId = String(item?.tokenId ?? "").trim().toLowerCase();
  const bondTag = BOND_TAGS.find((candidate) => candidate.tokenId === tokenId);
  const txid = String(item?.txid ?? "").trim().toLowerCase();
  const sourceBondTxid = String(item?.sourceBondTxid ?? "")
    .trim()
    .toLowerCase();
  return Boolean(
    bondTag &&
      String(item?.kind ?? "").toLowerCase() === "token-mint" &&
      String(item?.protocol ?? "").toLowerCase() === "pwt1" &&
      item?.confirmed === true &&
      String(item?.ticker ?? "").trim().toUpperCase() === bondTag.ticker &&
      String(item?.validationMode ?? "") ===
        `canonical-${bondTag.ticker.toLowerCase()}-bond-projection` &&
      /^[0-9a-f]{64}$/u.test(txid) &&
      sourceBondTxid === txid &&
      String(item?.minterAddress ?? "").trim().length > 0 &&
      /^[1-9]\d*$/u.test(String(item?.amount ?? "").trim()) &&
      Number(item?.amountSats ?? 0) === 0,
  );
}

function canonicalBondMintProjection(item) {
  const tokenId = String(item?.tokenId ?? "").trim().toLowerCase();
  const bondTag = BOND_TAGS.find((candidate) => candidate.tokenId === tokenId);
  return (
    canonicalBondMintProjectionStructure(item) &&
    (bondTag.ticker !== "INCB" || canonicalIncbIssuanceMintProjection(item))
  );
}

function canonicalBondMintProjectionInvalidReason(item) {
  if (!canonicalBondMintProjectionStructure(item)) {
    return "";
  }
  return String(item?.tokenId ?? "").trim().toLowerCase() === INCB_TOKEN_ID
    ? incbIssuanceMetadataInvalidReason(item)
    : "";
}

function reservedBondCreditViolationReason(item) {
  // A first-party, transaction-bound bond projection with malformed metadata
  // is not a generic namespace violation. It is rejected below with its exact
  // canonical-projection fault so the UI can never mislabel a real bond as an
  // attempted generic pwt1 mint.
  if (item?.valid === false || canonicalBondMintProjectionStructure(item)) {
    return "";
  }
  const kind = String(item?.kind ?? "").trim().toLowerCase();
  const tokenId = String(item?.tokenId ?? "").trim().toLowerCase();
  const ticker = String(item?.ticker ?? "").trim().toUpperCase();
  if (
    (kind === "token-create" && BOND_TOKEN_TICKERS.has(ticker)) ||
    (kind === "token-mint" && BOND_TOKEN_IDS.has(tokenId))
  ) {
    return "POWB and INCB are reserved synthetic bond credits; generic pwt1 create and mint actions cannot create their supply.";
  }
  return "";
}

function tokenProtocolIntegrityInvalidItem(item, reason, reasonCode) {
  return {
    ...item,
    attemptedKind: String(item?.attemptedKind ?? item?.kind ?? "token-event"),
    kind: "token-event-invalid",
    reason,
    reasonCode,
    valid: false,
  };
}

async function tokenMintDefinitionOrderInvalidReason(client, item) {
  if (
    item?.valid === false ||
    String(item?.kind ?? "").toLowerCase() !== "token-mint" ||
    canonicalBondMintProjection(item)
  ) {
    return "";
  }
  const tokenId = String(item?.tokenId ?? "").trim().toLowerCase();
  if (!isHexTxid(tokenId)) {
    return "The credit mint does not reference a valid credit definition txid.";
  }
  const definitionResult = await client.query(
    `
      SELECT confirmed, created_height, metadata
      FROM proof_indexer.credit_definitions
      WHERE network = $1
        AND token_id = $2
      LIMIT 1
    `,
    [NETWORK, tokenId],
  );
  const definition = definitionResult.rows[0];
  if (!definition || definition.confirmed !== true) {
    return "The credit definition was not confirmed before this mint action.";
  }
  if (definition?.metadata?.canonicalSynthetic === true) {
    return "";
  }
  if (item?.confirmed !== true) {
    return "";
  }
  const definitionHeight = Number(definition.created_height);
  const definitionBlockIndex = Number(definition?.metadata?.blockIndex);
  const mintHeight = Number(item?.blockHeight ?? item?.height);
  const mintBlockIndex = Number(item?.blockIndex);
  if (
    !Number.isSafeInteger(definitionHeight) ||
    definitionHeight < 0 ||
    !Number.isSafeInteger(mintHeight) ||
    mintHeight < 0
  ) {
    return "The credit definition and mint do not have a complete canonical order.";
  }
  if (definitionHeight > mintHeight) {
    return "The credit mint appears before its confirmed credit definition.";
  }
  if (definitionHeight < mintHeight) {
    return "";
  }
  if (
    !Number.isSafeInteger(definitionBlockIndex) ||
    definitionBlockIndex < 0 ||
    !Number.isSafeInteger(mintBlockIndex) ||
    mintBlockIndex < 0
  ) {
    return "The same-block credit definition and mint do not have a complete transaction order.";
  }
  return definitionBlockIndex < mintBlockIndex
    ? ""
    : "The credit mint does not appear after its confirmed credit definition.";
}

async function protocolIntegrityItemForPersistence(client, item) {
  const projectionReason = canonicalBondMintProjectionInvalidReason(item);
  if (projectionReason) {
    return tokenProtocolIntegrityInvalidItem(
      item,
      `Canonical INCB bond projection rejected: ${projectionReason}.`,
      "canonical-incb-bond-projection-invalid",
    );
  }
  const reservedReason = reservedBondCreditViolationReason(item);
  if (reservedReason) {
    return tokenProtocolIntegrityInvalidItem(
      item,
      reservedReason,
      "reserved-bond-credit-namespace",
    );
  }
  const definitionOrderReason = await tokenMintDefinitionOrderInvalidReason(
    client,
    item,
  );
  return definitionOrderReason
    ? tokenProtocolIntegrityInvalidItem(
        item,
        definitionOrderReason,
        "token-definition-not-prior",
      )
    : item;
}

function disambiguateDuplicateProtocolItems(items) {
  const seen = new Map();
  return items.map((item, eventIndex) => {
    const key = [
      item?.protocol,
      item?.kind,
      item?.tokenId,
      item?.id,
      item?.parentTxid,
      item?.attachmentIndex,
    ]
      .map((value) => String(value ?? ""))
      .join(":")
      .toLowerCase();
    const ordinal = seen.get(key) ?? 0;
    seen.set(key, ordinal + 1);
    return ordinal === 0
      ? { ...item, _powEventIndex: eventIndex }
      : {
          ...item,
          _powEventIndex: eventIndex,
          eventKeyVout: ordinal,
        };
  });
}

function canonicalRecoveryItemMatchesTxid(item, txid) {
  return [
    item?.txid,
    item?.eventTxid,
    item?.lastEventTxid,
    item?.listingId,
    item?.closedTxid,
    item?.sealTxid,
    item?.saleTxid,
    item?.tokenId,
    item?.listing?.listingId,
    item?.sale?.txid,
    item?.closedListing?.closedTxid,
  ].some(
    (candidate) =>
      String(candidate ?? "").trim().toLowerCase() === txid,
  );
}

function canonicalKindForSourceLabel(sourceLabel, item) {
  const explicit = String(item?.kind ?? "").trim().toLowerCase();
  if (explicit) {
    return explicit;
  }
  return {
    tokens: "token-create",
    "token-mints": "token-mint",
    "token-transfers": "token-transfer",
    "token-listings": "token-listing",
    "token-closed-listings": "token-listing-closed",
    "token-sales": "token-sale",
    "token-invalid-events": "token-event-invalid",
  }[sourceLabel] ?? "";
}

function rawProtocolItemMatchesCanonical(rawItem, canonicalItem, kind) {
  const rawKind = String(rawItem?.kind ?? "").toLowerCase();
  if (
    rawKind !== kind &&
    !(kind === "token-listing" && rawKind.startsWith("token-listing")) &&
    !(
      kind.endsWith("-invalid") &&
      (rawKind.startsWith("token-") || rawKind.startsWith("id-"))
    )
  ) {
    return false;
  }
  for (const field of [
    "id",
    "tokenId",
    "listingId",
    "recipientAddress",
    "buyerAddress",
  ]) {
    const canonicalValue = String(canonicalItem?.[field] ?? "").trim();
    const rawValue = String(rawItem?.[field] ?? "").trim();
    if (canonicalValue && rawValue && canonicalValue !== rawValue) {
      return false;
    }
  }
  const canonicalAmount = String(canonicalItem?.amount ?? "").trim();
  const rawAmount = String(rawItem?.amount ?? "").trim();
  if (
    kind === "token-mint" &&
    String(rawItem?.tokenId ?? "").trim().toLowerCase() === INCB_TOKEN_ID &&
    String(canonicalItem?.tokenId ?? "").trim().toLowerCase() ===
      INCB_TOKEN_ID &&
    canonicalBondMintProjectionStructure(rawItem) &&
    canonicalBondMintProjectionStructure(canonicalItem)
  ) {
    const rawMinterAddress = String(rawItem?.minterAddress ?? "").trim();
    const canonicalMinterAddress = String(
      canonicalItem?.minterAddress ?? "",
    ).trim();
    return Boolean(
      rawMinterAddress &&
        canonicalMinterAddress &&
        rawMinterAddress === canonicalMinterAddress,
    );
  }
  const tokenId = String(
    canonicalItem?.tokenId ?? rawItem?.tokenId ?? "",
  )
    .trim()
    .toLowerCase();
  if (isWorkTokenId(tokenId)) {
    try {
      return (
        workAmountAtomsFromRecord(canonicalItem) ===
        workAmountAtomsFromRecord(rawItem)
      );
    } catch {
      return !canonicalAmount || !rawAmount || canonicalAmount === rawAmount;
    }
  }
  return !canonicalAmount || !rawAmount || canonicalAmount === rawAmount;
}

async function canonicalRecoveryItemsForTx(tx, messages, options = {}) {
  const txid = String(tx?.txid ?? "").trim().toLowerCase();
  const pendingTransaction = Number(tx?.height ?? 0) <= 0;
  const pendingEnvelopeCanStandAlone =
    pendingTransaction &&
    messages.some((message) => message?.prefix === "pwm1:");
  let deferredPendingVerifier = false;
  const specs = new Map();
  for (const message of messages) {
    for (const spec of recoveryEndpointSpecs(txid, message)) {
      const key = `${spec.label}:${spec.path}:${JSON.stringify(spec.params ?? {})}`;
      specs.set(key, spec);
    }
  }
  if (specs.size === 0) {
    return [];
  }

  const recovered = [];
  for (const spec of specs.values()) {
    let payload;
    try {
      payload = await readJson(
        endpoint(spec.path, {
          ...(spec.params ?? {}),
          blockHash: Number(tx?.height ?? 0) > 0
            ? String(tx?._powBlockHash ?? "").trim().toLowerCase()
            : undefined,
          blockHeight: Number(tx?.height ?? 0) || undefined,
          confirmed: Number(tx?.height ?? 0) > 0 ? "1" : "0",
          fresh: "1",
          previousBlockHash: Number(tx?.height ?? 0) > 0
            ? String(tx?._powPreviousBlockHash ?? "").trim().toLowerCase()
            : undefined,
        }),
        {
          retries: 0,
          timeoutMs:
            Number(tx?.height ?? 0) > 0
              ? 30_000
              : Math.min(
                  PENDING_LEGACY_VERIFIER_TIMEOUT_MS,
                  Math.max(
                    PENDING_VERIFIER_TIMEOUT_MS,
                    Number(options?.pendingVerifierTimeoutMs) ||
                      PENDING_VERIFIER_TIMEOUT_MS,
                  ),
                ),
        },
      );
    } catch (error) {
      if (pendingEnvelopeCanStandAlone) {
        console.error(
          JSON.stringify({
            error: error?.message ?? String(error),
            phase: "pending-envelope-verifier-deferred",
            txid,
          }),
        );
        deferredPendingVerifier = true;
        continue;
      }
      throw error;
    }
    if (Number(tx?.height ?? 0) > 0) {
      const coverageHeight = Number(payload?.indexedThroughBlock ?? 0);
      const expectedBlockHash = String(tx?._powBlockHash ?? "")
        .trim()
        .toLowerCase();
      const expectedPreviousBlockHash = String(tx?._powPreviousBlockHash ?? "")
        .trim()
        .toLowerCase();
      const strictSource = String(payload?.source ?? "");
      const expectedSource = spec.path.endsWith("/id-verifier")
        ? "canonical-block-scan-db-core-id-verifier"
        : "canonical-block-scan-db-core-credit-verifier";
      if (
        !Number.isSafeInteger(coverageHeight) ||
        coverageHeight !== Number(tx.height) ||
        String(payload?.network ?? "") !== NETWORK ||
        String(payload?.txid ?? "").trim().toLowerCase() !== txid ||
        String(payload?.blockHash ?? "").trim().toLowerCase() !==
          expectedBlockHash ||
        String(payload?.previousBlockHash ?? "").trim().toLowerCase() !==
          expectedPreviousBlockHash ||
        strictSource !== expectedSource
      ) {
        throw new Error(
          `Canonical verifier coverage is unproven for ${txid} at block ${tx.height}`,
        );
      }
    }
    for (const item of Array.isArray(payload?.items) ? payload.items : []) {
      if (
        canonicalRecoveryItemMatchesTxid(item, txid) &&
        (Number(tx?.height ?? 0) <= 0 || item?.confirmed === true)
      ) {
        recovered.push({
          item: {
            ...item,
            canonicalVerifier: spec.path,
            validationMode:
              item?.validationMode ?? "canonical-first-party-state",
          },
          sourceLabel: spec.label,
        });
      }
    }
  }
  const rawItems = disambiguateDuplicateProtocolItems(
    rawProtocolItemsForTx(tx, messages),
  );
  if (
    recovered.length === 0 &&
    !(
      deferredPendingVerifier &&
      rawItems.some((rawItem) => rawItem?.protocol === "pwm1")
    )
  ) {
    throw new Error(`Canonical verifier did not resolve protocol transaction ${txid}`);
  }
  const usedRawItems = new Set();
  const normalizedRecovered = [];
  for (const recoveredItem of recovered) {
    const canonicalItem = recoveredItem.item;
    const kind = canonicalKindForSourceLabel(
      recoveredItem.sourceLabel,
      canonicalItem,
    );
    const rawIndex = rawItems.findIndex(
      (rawItem, index) =>
        !usedRawItems.has(index) &&
        rawProtocolItemMatchesCanonical(rawItem, canonicalItem, kind),
    );
    const rawItem = rawIndex >= 0 ? rawItems[rawIndex] : null;
    if (rawIndex >= 0) {
      usedRawItems.add(rawIndex);
    }
    const normalizedKind =
      String(canonicalItem?.kind ?? "").trim().toLowerCase() ||
      rawItem?.kind ||
      kind;
    if (!normalizedKind) {
      throw new Error(`Canonical verifier returned an untyped item for ${txid}`);
    }
    let normalizedAmountSats = canonicalItem?.amountSats;
    if (String(normalizedKind).startsWith("token-")) {
      if (
        normalizedKind === "token-mint" &&
        String(canonicalItem?.tokenId ?? "").trim().toLowerCase() ===
          INCB_TOKEN_ID &&
        canonicalBondMintProjectionStructure(canonicalItem)
      ) {
        // The INCB units are a synthetic projection over the bond's fixed
        // pre-bond live network value. The underlying PWM/PWT events
        // carry the proof value; the mint companion must stay zero-value.
        normalizedAmountSats = 0;
      } else if (normalizedKind === "token-sale") {
        // Sale volume is the seller price only. The sale-ticket anchor refund
        // is not revenue/value, and the 546 registry mutation is projected by
        // the closed-listing companion below.
        normalizedAmountSats = canonicalItem?.priceSats ?? 0;
      } else if (
        normalizedKind === "token-listing" ||
        normalizedKind === "token-listing-sealed" ||
        (normalizedKind === "token-listing-closed" && rawItem)
      ) {
        normalizedAmountSats = 546;
      } else if (normalizedKind === "token-listing-closed" && !rawItem) {
        // A buy produces a synthetic close companion for the registry fee.
        // The sale row carries only seller price; the 546 anchor refund is
        // intentionally excluded from both rows.
        normalizedAmountSats = 546;
      } else {
        normalizedAmountSats =
          canonicalItem?.amountSats ??
          canonicalItem?.paidSats ??
          canonicalItem?.creationFeeSats ??
          canonicalItem?.mutationFeeSats ??
          canonicalItem?.feeSats ??
          0;
      }
    }
    const normalizedItem = {
      ...(rawItem ?? {}),
      ...canonicalItem,
      amountSats: normalizedAmountSats,
      blockHeight:
        canonicalItem?.blockHeight ??
        canonicalItem?.closedBlockHeight ??
        rawItem?.blockHeight ??
        tx?.height,
      kind: normalizedKind,
      ownerAddress:
        canonicalItem?.ownerAddress ??
        rawItem?.ownerAddress ??
        (normalizedKind === "id-update" ? canonicalItem?.actor : undefined),
      protocol: rawItem?.protocol ?? canonicalItem?.protocol,
      txid,
    };
    if (
      normalizedKind === "token-mint" &&
      String(normalizedItem?.tokenId ?? "").trim().toLowerCase() ===
        INCB_TOKEN_ID &&
      canonicalBondMintProjectionStructure(normalizedItem)
    ) {
      normalizedItem.amountSats = 0;
      normalizedItem.protocol = "pwt1";
      normalizedItem.sourceBondTxid = txid;
      normalizedItem.validationMode =
        "canonical-incb-bond-projection";
    }
    const reservedReason = reservedBondCreditViolationReason(normalizedItem);
    const integrityItem = reservedReason
      ? tokenProtocolIntegrityInvalidItem(
          normalizedItem,
          reservedReason,
          "reserved-bond-credit-namespace",
        )
      : normalizedItem;
    normalizedRecovered.push({
      ...recoveredItem,
      item: integrityItem,
      sourceLabel: sourceLabelForProtocolItem(integrityItem),
    });
  }

  rawItems.forEach((rawItem, index) => {
    if (usedRawItems.has(index)) {
      return;
    }
    if (rawItem?.protocol === "pwm1") {
      normalizedRecovered.push({
        item: rawItem,
        sourceLabel: sourceLabelForProtocolItem(rawItem),
      });
      return;
    }
    if (deferredPendingVerifier && pendingTransaction) {
      // Preserve the independently parseable pending PWM envelope while its
      // staged credit/ID companion remains unresolved. Never label an
      // unresolved pending mutation invalid, and never apply this exception
      // to confirmed canonical block processing.
      return;
    }
    if (String(rawItem?.validationMode ?? "").endsWith("-bond-projection")) {
      if (
        rawItem?.confirmed === true &&
        String(rawItem?.tokenId ?? "").trim().toLowerCase() === INCB_TOKEN_ID
      ) {
        const invalidItem = tokenProtocolIntegrityInvalidItem(
          rawItem,
          "Canonical INCB bond projection rejected: the canonical first-party verifier omitted the issuance projection.",
          "canonical-incb-bond-projection-missing",
        );
        normalizedRecovered.push({
          item: invalidItem,
          sourceLabel: sourceLabelForProtocolItem(invalidItem),
        });
        return;
      }
      normalizedRecovered.push({
        item: rawItem,
        sourceLabel: sourceLabelForProtocolItem(rawItem),
      });
      return;
    }
    const invalidItem = invalidProtocolItem(
      rawItem,
      "The canonical first-party verifier rejected this protocol event.",
    );
    normalizedRecovered.push({
      item: invalidItem,
      sourceLabel: sourceLabelForProtocolItem(invalidItem),
    });
  });
  return normalizedRecovered;
}

function sameCanonicalPaymentAddress(left, right) {
  const leftAddress = String(left ?? "").trim();
  const rightAddress = String(right ?? "").trim();
  if (!leftAddress || !rightAddress) {
    return false;
  }
  if (leftAddress === rightAddress) {
    return true;
  }
  const leftLower = leftAddress.toLowerCase();
  const rightLower = rightAddress.toLowerCase();
  return (
    /^(?:bc1|tb1|bcrt1)/u.test(leftLower) &&
    /^(?:bc1|tb1|bcrt1)/u.test(rightLower) &&
    leftLower === rightLower
  );
}

function preparedProtocolItemsWithCanonicalMailAttachments(
  preparedItems,
) {
  const prepared = Array.isArray(preparedItems) ? preparedItems : [];
  const canonicalWorkTransfersByTxid = new Map();
  const ambiguousWorkTransferTxids = new Set();

  for (const entry of prepared) {
    const item = entry?.item ?? entry;
    const txid = String(item?.txid ?? "").trim().toLowerCase();
    const amountAtoms = canonicalWorkAtomsText(item?.amountAtoms);
    const protocolVout = Number(item?.protocolVout);
    const recipientAddress = String(item?.recipientAddress ?? "").trim();
    if (
      item?.kind !== "token-transfer" ||
      item?.confirmed !== true ||
      item?.valid === false ||
      String(item?.tokenId ?? "").trim().toLowerCase() !== WORK_TOKEN_ID ||
      !isHexTxid(txid) ||
      !amountAtoms ||
      !Number.isSafeInteger(protocolVout) ||
      protocolVout < 0 ||
      !recipientAddress
    ) {
      continue;
    }
    const transfers = canonicalWorkTransfersByTxid.get(txid) ?? [];
    const transfer = withWorkPrecisionMetadata({
      ...(Number.isSafeInteger(Number(item?._powEventIndex)) &&
      Number(item._powEventIndex) >= 0
        ? { _powEventIndex: Number(item._powEventIndex) }
        : {}),
      amount: formatWorkAtoms(amountAtoms),
      amountAtoms,
      paidSats: item?.paidSats,
      protocolVout,
      recipientAddress,
      registryAddress: item?.registryAddress,
      ticker: item?.ticker ?? WORK_TOKEN_TICKER,
      tokenId: WORK_TOKEN_ID,
    });
    const existing = transfers.find(
      (candidate) => Number(candidate?.protocolVout) === protocolVout,
    );
    if (existing) {
      if (
        existing.amountAtoms !== transfer.amountAtoms ||
        !sameCanonicalPaymentAddress(
          existing.recipientAddress,
          transfer.recipientAddress,
        )
      ) {
        ambiguousWorkTransferTxids.add(txid);
      }
      continue;
    }
    transfers.push(transfer);
    canonicalWorkTransfersByTxid.set(txid, transfers);
  }

  return prepared.map((entry) => {
    const item = entry?.item ?? entry;
    if (
      !MAIL_WORK_ATTACHMENT_KINDS.has(String(item?.kind ?? "").toLowerCase())
    ) {
      return entry;
    }
    if (item?.confirmed !== true) {
      const { attachedCredits: _untrustedAttachedCredits, ...pendingItem } = item;
      return entry?.item
        ? { ...entry, item: pendingItem }
        : pendingItem;
    }
    const txid = String(item?.txid ?? "").trim().toLowerCase();
    const recipients = Array.isArray(item?.recipients) ? item.recipients : [];
    const attachedCredits = (ambiguousWorkTransferTxids.has(txid)
      ? []
      : canonicalWorkTransfersByTxid.get(txid) ?? [])
      .filter((credit) =>
        recipients.some((recipient) =>
          sameCanonicalPaymentAddress(
            recipient?.address,
            credit.recipientAddress,
          ),
        ),
      )
      .sort(
        (left, right) =>
          left.protocolVout - right.protocolVout ||
          left.recipientAddress.localeCompare(right.recipientAddress),
      );
    const nextItem = {
      ...item,
      attachedCredits:
        attachedCredits.length > 0 ? attachedCredits : undefined,
    };
    return entry?.item
      ? { ...entry, item: nextItem }
      : nextItem;
  });
}

async function preparedProtocolItemsForTx(tx, messages, options = {}) {
  const recovered = await canonicalRecoveryItemsForTx(tx, messages, options);
  if (recovered.length > 0) {
    return preparedProtocolItemsWithCanonicalMailAttachments(recovered);
  }
  return preparedProtocolItemsWithCanonicalMailAttachments(
    disambiguateDuplicateProtocolItems(
      rawProtocolItemsForTx(tx, messages),
    ).map((item) => {
      const statefulUnknown =
        (item?.protocol === "pwt1" || item?.protocol === "pwid1") &&
        !String(item?.validationMode ?? "").endsWith("-bond-projection");
      const normalizedItem = statefulUnknown
        ? invalidProtocolItem(item, "Unknown or malformed stateful protocol action.")
        : item;
      return {
        item: normalizedItem,
        sourceLabel: sourceLabelForProtocolItem(normalizedItem),
      };
    }),
  );
}

async function persistPreparedProtocolItems(client, preparedItems) {
  let indexed = 0;
  let skipped = 0;
  for (const prepared of preparedItems) {
    const originalItem = prepared.item ?? prepared;
    const item = await protocolIntegrityItemForPersistence(
      client,
      originalItem,
    );
    const sourceLabel =
      item === originalItem && prepared.sourceLabel
        ? prepared.sourceLabel
        : sourceLabelForProtocolItem(item);
    const result = await upsertEvent(client, sourceLabel, item);
    if (result.skipped) {
      skipped += 1;
    } else {
      indexed += 1;
    }
    const bondTag = BOND_TAGS.find(
      (candidate) =>
        String(item?.id ?? "").trim().toLowerCase() === candidate.registryId,
    );
    if (
      bondTag &&
      String(item?.kind ?? "").startsWith("id-") &&
      item?.confirmed !== false
    ) {
      await seedCanonicalBondDefinition(client, bondTag);
    }
  }
  return { indexed, skipped };
}

async function upsertCanonicalSyntheticCreditDefinition(
  client,
  definition,
  options = {},
) {
  const requireAtomicWork =
    isWorkTokenId(definition?.tokenId) &&
    options.requireAtomicWork === true;
  const atomicReady =
    isWorkTokenId(definition?.tokenId) &&
    (requireAtomicWork || await workAtomicProjectionReady(client));
  const workStorage = atomicReady
    ? workDefinitionStorage(definition)
    : null;
  const storedDefinition = workStorage?.metadata ?? definition;
  const maxSupplyStorage = workStorage?.maxSupplyAtoms ??
    String(
      storedDefinition.maxSupplyStorage ?? storedDefinition.maxSupply ?? "",
    ).trim();
  const uncappedSyntheticBond =
    BOND_TOKEN_IDS.has(
      String(storedDefinition.tokenId ?? "").trim().toLowerCase(),
    ) &&
    storedDefinition.maxSupplyModel === "uncapped" &&
    storedDefinition.uncapped === true;
  if (
    (uncappedSyntheticBond &&
      maxSupplyStorage !== BOND_UNCAPPED_MAX_SUPPLY_STORAGE) ||
    (!uncappedSyntheticBond && !/^[1-9]\d*$/u.test(maxSupplyStorage))
  ) {
    throw new Error(
      `Canonical ${storedDefinition.ticker || storedDefinition.tokenId} definition is missing exact max-supply storage.`,
    );
  }
  const {
    maxSupplyStorage: _maxSupplyStorage,
    ...storedDefinitionMetadata
  } = storedDefinition;
  await client.query(
    `
      INSERT INTO proof_indexer.credit_definitions (
        network,
        token_id,
        ticker,
        creator_address,
        registry_address,
        max_supply,
        mint_amount,
        mint_price_sats,
        create_txid,
        confirmed,
        created_height,
        metadata
      )
      VALUES ($1, $2, $3, NULLIF($4, ''), $5, $6, $7, $8, $2, true, NULL, $9::jsonb)
      ON CONFLICT (network, token_id)
      DO UPDATE SET
        ticker = EXCLUDED.ticker,
        creator_address = EXCLUDED.creator_address,
        registry_address = EXCLUDED.registry_address,
        max_supply = EXCLUDED.max_supply,
        mint_amount = EXCLUDED.mint_amount,
        mint_price_sats = EXCLUDED.mint_price_sats,
        confirmed = true,
        metadata = EXCLUDED.metadata
    `,
    [
      NETWORK,
      storedDefinition.tokenId,
      storedDefinition.ticker,
      storedDefinition.creatorAddress ?? "",
      storedDefinition.registryAddress,
      maxSupplyStorage,
      workStorage?.mintAmountAtoms ?? String(storedDefinition.mintAmount),
      String(storedDefinition.mintPriceSats),
      JSON.stringify({
        ...storedDefinitionMetadata,
        canonicalSynthetic: true,
        confirmed: true,
        network: NETWORK,
        txid: storedDefinition.tokenId,
      }),
    ],
  );
}

async function seedCanonicalWorkDefinition(client) {
  await upsertCanonicalSyntheticCreditDefinition(client, {
    createdAt: WORK_TOKEN_CREATED_AT,
    creationFeeSats: 546,
    creatorAddress: "",
    dataBytes: 70,
    maxSupply: WORK_TOKEN_MAX_SUPPLY,
    mintAmount: WORK_TOKEN_MINT_AMOUNT,
    mintPriceSats: WORK_TOKEN_MINT_PRICE_SATS,
    registryAddress: WORK_TOKEN_REGISTRY_ADDRESS,
    ticker: "WORK",
    tokenId: WORK_TOKEN_ID,
  }, {
    requireAtomicWork: true,
  });
  // Range preparation clears the definition table before reseeding it, so the
  // old row cannot be used to infer the storage model. Refresh from the row we
  // just wrote and fail the transaction before any atom-denominated balance is
  // replayed if the exact definition did not persist. Full rebuild uses the
  // same deterministic seed and cannot fall back to legacy whole-WORK units.
  await assertCanonicalWorkAtomicProjection(
    client,
    "Canonical rebuild seed",
  );
}

async function seedCanonicalPowbDefinition(client, options = {}) {
  return seedCanonicalBondDefinition(
    client,
    BOND_TAGS.find((tag) => tag.tokenId === POWB_TOKEN_ID),
    options,
  );
}

async function seedCanonicalIncbDefinition(client, options = {}) {
  return seedCanonicalBondDefinition(
    client,
    BOND_TAGS.find((tag) => tag.tokenId === INCB_TOKEN_ID),
    options,
  );
}

async function seedCanonicalBondDefinitions(client, options = {}) {
  const results = [];
  for (const bondTag of BOND_TAGS) {
    results.push(await seedCanonicalBondDefinition(client, bondTag, options));
  }
  return results.every(Boolean);
}

async function seedCanonicalBondDefinition(client, bondTag, options = {}) {
  if (!bondTag) {
    return false;
  }
  const result = await client.query(
    `
      SELECT owner_address, receive_address
      FROM proof_indexer.id_records
      WHERE network = $1
        AND id_lower = $2
      LIMIT 1
    `,
    [NETWORK, bondTag.registryId],
  );
  const row = result.rows[0];
  const registryAddress = String(
    row?.receive_address ?? row?.owner_address ?? "",
  ).trim();
  if (!registryAddress) {
    if (options.required === true) {
      throw new Error(
        `Canonical rebuild cannot publish ${bondTag.ticker} without the confirmed ${bondTag.registryId} ID receiver`,
      );
    }
    return false;
  }
  await upsertCanonicalSyntheticCreditDefinition(client, {
    createdAt: bondTag.createdAt,
    creationFeeSats: 0,
    creatorAddress: registryAddress,
    dataBytes: 0,
    ...(bondTag.issuanceAccountingModel
      ? {
          issuanceAccountingModel: bondTag.issuanceAccountingModel,
          issuanceValuationFixedAtSend: true,
          issuanceUnitSats: 1,
        }
      : {}),
    maxSupply: null,
    maxSupplyModel: "uncapped",
    maxSupplyStorage: bondTag.tokenMaxSupplyStorage,
    mintAmount: 1,
    mintPriceSats: 1,
    registryAddress,
    ticker: bondTag.ticker,
    tokenId: bondTag.tokenId,
    uncapped: true,
  });
  return true;
}

async function rebuildConfirmedCreditBalancesFromCanonicalEvents(
  client,
  options = {},
) {
  const requestedTokenIds = [
    ...new Set(
      (Array.isArray(options.tokenIds) ? options.tokenIds : [])
        .map((tokenId) => String(tokenId ?? "").trim().toLowerCase())
        .filter((tokenId) => /^[0-9a-f]{64}$/u.test(tokenId)),
    ),
  ].sort();
  const scopedReplay = requestedTokenIds.length > 0;
  const supplyCorrectionMode = String(
    options.supplyCorrectionMode ?? "",
  ).trim();
  const supplyCorrectionTokenIds = [
    ...new Set(
      (Array.isArray(options.supplyCorrectionTokenIds)
        ? options.supplyCorrectionTokenIds
        : [])
        .map((tokenId) => String(tokenId ?? "").trim().toLowerCase())
        .filter(Boolean),
    ),
  ].sort();
  if (
    supplyCorrectionMode ||
    supplyCorrectionTokenIds.length > 0
  ) {
    if (
      supplyCorrectionMode !== "canonical-incb-issuance-repair" ||
      !scopedReplay ||
      requestedTokenIds.length !== 1 ||
      requestedTokenIds[0] !== INCB_TOKEN_ID ||
      supplyCorrectionTokenIds.length !== 1 ||
      supplyCorrectionTokenIds[0] !== INCB_TOKEN_ID
    ) {
      throw new Error(
        "Canonical credit supply correction is restricted to the explicit scoped INCB issuance repair.",
      );
    }
  }
  const supplyCorrectionSet = new Set(supplyCorrectionTokenIds);
  const integerAmount = (value, label) => {
    if (typeof value === "bigint") {
      if (value > 0n) return value;
      throw new Error(`${label} must be a positive integer`);
    }
    if (typeof value === "number") {
      if (Number.isSafeInteger(value) && value > 0) return BigInt(value);
      throw new Error(`${label} must be a positive safe integer`);
    }
    const text = String(value ?? "").trim();
    if (!/^[1-9]\d*$/u.test(text)) {
      throw new Error(`${label} must be a positive integer`);
    }
    return BigInt(text);
  };
  const nonnegativeInteger = (value, label) => {
    const text = String(value ?? "0").trim();
    if (!/^\d+$/u.test(text)) {
      throw new Error(`${label} must be a non-negative integer`);
    }
    return BigInt(text);
  };
  const normalizedAddress = (value, label) => {
    const address = String(value ?? "").trim();
    if (!address) {
      throw new Error(`${label} is missing`);
    }
    return address;
  };

  const definitionsResult = await client.query(
    `
      SELECT token_id, ticker, max_supply, confirmed, created_height, metadata
      FROM proof_indexer.credit_definitions
      WHERE network = $1
        AND confirmed = true
        ${scopedReplay ? "AND token_id = ANY($2::text[])" : ""}
    `,
    scopedReplay ? [NETWORK, requestedTokenIds] : [NETWORK],
  );
  const definitions = new Map(
    definitionsResult.rows.map((row) => {
      const tokenId = String(row.token_id ?? "").trim().toLowerCase();
      const metadata = objectValue(row.metadata);
      const atomicProjection =
        isWorkTokenId(tokenId) &&
        metadata.amountStorageModel === WORK_ATOMIC_PROJECTION_MODEL &&
        Number(metadata.decimals) === WORK_DECIMALS &&
        String(metadata.unitScale ?? "") === WORK_UNIT_SCALE_TEXT;
      const maxSupply = isWorkTokenId(tokenId) && !atomicProjection
        ? BigInt(
            parseWorkAmountToAtoms(row.max_supply, { allowZero: true }),
          )
        : nonnegativeInteger(
            row.max_supply,
            `credit ${row.token_id} max supply`,
          );
      return [
        tokenId,
        {
        atomicProjection,
        canonicalSynthetic: row?.metadata?.canonicalSynthetic === true,
        confirmed: row.confirmed === true,
        createdBlockIndex: Number(row?.metadata?.blockIndex),
        createdHeight: Number(row.created_height),
        maxSupply,
        ticker: String(row.ticker ?? "").trim().toUpperCase(),
        uncapped: row?.metadata?.uncapped === true,
        issuanceAccountingModel: String(
          row?.metadata?.issuanceAccountingModel ?? "",
        ),
        issuanceUnitSats: Number(row?.metadata?.issuanceUnitSats),
        issuanceValuationFixedAtSend:
          row?.metadata?.issuanceValuationFixedAtSend === true,
        },
      ];
    }),
  );
  if (
    scopedReplay &&
    requestedTokenIds.some((tokenId) => !definitions.has(tokenId))
  ) {
    throw new Error(
      `Canonical credit replay is missing definitions for ${requestedTokenIds
        .filter((tokenId) => !definitions.has(tokenId))
        .join(", ")}`,
    );
  }
  const eventsResult = await client.query(
    `
      SELECT
        e.event_id,
        e.event_key,
        e.txid,
        e.kind,
        COALESCE(e.block_height, t.block_height) AS canonical_block_height,
        e.payload
      FROM proof_indexer.events e
      LEFT JOIN proof_indexer.transactions t
        ON t.network = e.network
       AND t.txid = e.txid
      WHERE e.network = $1
        AND e.protocol = 'pwt1'
        AND e.valid = true
        AND COALESCE(t.status, e.status) = 'confirmed'
        AND e.kind IN ('token-mint', 'token-transfer', 'token-sale')
        ${
          scopedReplay
            ? "AND lower(COALESCE(e.payload->>'tokenId', '')) = ANY($2::text[])"
            : ""
        }
      ORDER BY
        COALESCE(e.block_height, t.block_height) ASC NULLS LAST,
        CASE
          WHEN e.payload->>'blockIndex' ~ '^[0-9]+$'
            THEN (e.payload->>'blockIndex')::integer
          ELSE 2147483647
        END ASC,
        CASE
          WHEN e.payload->>'_powEventIndex' ~ '^[0-9]+$'
            THEN (e.payload->>'_powEventIndex')::integer
          ELSE 2147483647
        END ASC,
        e.event_key ASC
    `,
    scopedReplay ? [NETWORK, requestedTokenIds] : [NETWORK],
  );
  const existingResult = await client.query(
    `
      SELECT token_id, COALESCE(sum(confirmed_balance), 0) AS confirmed_supply
      FROM proof_indexer.credit_balances
      WHERE network = $1
        ${scopedReplay ? "AND token_id = ANY($2::text[])" : ""}
      GROUP BY token_id
    `,
    scopedReplay ? [NETWORK, requestedTokenIds] : [NETWORK],
  );
  const existingSupply = new Map(
    existingResult.rows.map((row) => {
      const tokenId = String(row.token_id ?? "").trim().toLowerCase();
      const storedSupply = nonnegativeInteger(
        row.confirmed_supply,
        `credit ${row.token_id} stored supply`,
      );
      return [
        tokenId,
        isWorkTokenId(tokenId) &&
        definitions.get(tokenId)?.atomicProjection !== true
          ? storedSupply * WORK_UNIT_SCALE
          : storedSupply,
      ];
    }),
  );
  const pendingDeltas = new Map();
  if (options.preservePendingDeltas === true) {
    const pendingResult = await client.query(
      `
        SELECT token_id, address, pending_delta
        FROM proof_indexer.credit_balances
        WHERE network = $1
          ${scopedReplay ? "AND token_id = ANY($2::text[])" : ""}
          AND pending_delta <> 0
      `,
      scopedReplay ? [NETWORK, requestedTokenIds] : [NETWORK],
    );
    for (const row of pendingResult.rows) {
      const tokenId = String(row.token_id ?? "").trim().toLowerCase();
      const pendingDelta = BigInt(String(row.pending_delta ?? "0"));
      pendingDeltas.set(`${tokenId}:${row.address}`, pendingDelta);
    }
  }
  const balancesByToken = new Map();
  const mintedByToken = new Map();
  const balanceMap = (tokenId) => {
    if (!balancesByToken.has(tokenId)) {
      balancesByToken.set(tokenId, new Map());
    }
    return balancesByToken.get(tokenId);
  };
  const addBalance = (tokenId, address, delta, eventLabel) => {
    const balances = balanceMap(tokenId);
    const next = (balances.get(address) ?? 0n) + delta;
    if (next < 0n) {
      throw new Error(
        `Canonical credit replay would make ${tokenId}:${address} negative at ${eventLabel}`,
      );
    }
    balances.set(address, next);
  };

  const orderedEvents = [...eventsResult.rows].sort(
    (left, right) =>
      Number(left.canonical_block_height ?? 0) -
        Number(right.canonical_block_height ?? 0) ||
      Number(left?.payload?.blockIndex ?? Number.MAX_SAFE_INTEGER) -
        Number(right?.payload?.blockIndex ?? Number.MAX_SAFE_INTEGER) ||
      Number(left?.payload?._powEventIndex ?? Number.MAX_SAFE_INTEGER) -
        Number(right?.payload?._powEventIndex ?? Number.MAX_SAFE_INTEGER) ||
      String(left.event_key ?? "").localeCompare(String(right.event_key ?? "")),
  );
  for (const row of orderedEvents) {
    const payload =
      row?.payload && typeof row.payload === "object" && !Array.isArray(row.payload)
        ? row.payload
        : {};
    if (
      !Number.isSafeInteger(Number(row.canonical_block_height)) ||
      Number(row.canonical_block_height) < 0 ||
      !Number.isSafeInteger(Number(payload.blockIndex)) ||
      Number(payload.blockIndex) < 0 ||
      !Number.isSafeInteger(Number(payload._powEventIndex)) ||
      Number(payload._powEventIndex) < 0
    ) {
      throw new Error(
        `Canonical credit event ${row.txid ?? row.event_key ?? row.event_id} is missing block/event order`,
      );
    }
    const tokenId = String(payload.tokenId ?? "").trim().toLowerCase();
    const eventLabel = `${row.kind}:${row.txid ?? row.event_key ?? row.event_id}`;
    if (!/^[0-9a-f]{64}$/u.test(tokenId) || !definitions.has(tokenId)) {
      throw new Error(`Canonical credit event ${eventLabel} has no confirmed definition`);
    }
    const definition = definitions.get(tokenId);
    if (row.kind === "token-mint") {
      const expectedBondProjection =
        definition.ticker === "INCB"
          ? definition.issuanceAccountingModel ===
              INCB_ISSUANCE_ACCOUNTING_MODEL &&
            definition.issuanceValuationFixedAtSend === true &&
            definition.issuanceUnitSats === 1 &&
            canonicalBondMintProjection(payload)
          : definition.ticker === "POWB" &&
            payload.confirmed === true &&
            String(payload.ticker ?? "").trim().toUpperCase() ===
              definition.ticker &&
            String(payload.validationMode ?? "") ===
              `canonical-${definition.ticker.toLowerCase()}-bond-projection` &&
            String(payload.sourceBondTxid ?? "").trim().toLowerCase() ===
              String(row.txid ?? "").trim().toLowerCase() &&
            String(payload.minterAddress ?? "").trim().length > 0 &&
            /^[1-9]\d*$/u.test(String(payload.amount ?? "").trim()) &&
            Number(payload.amountSats ?? 0) === 0;
      if (["POWB", "INCB"].includes(definition.ticker) && !expectedBondProjection) {
        throw new Error(
          `Canonical credit event ${eventLabel} attempts a generic mint in the reserved ${definition.ticker} namespace`,
        );
      }
      if (!definition.canonicalSynthetic) {
        const eventHeight = Number(row.canonical_block_height);
        const eventBlockIndex = Number(payload.blockIndex);
        if (
          !definition.confirmed ||
          !Number.isSafeInteger(eventHeight) ||
          eventHeight < 0 ||
          !Number.isSafeInteger(definition.createdHeight) ||
          definition.createdHeight < 0 ||
          definition.createdHeight > eventHeight ||
          (definition.createdHeight === eventHeight &&
            (!Number.isSafeInteger(eventBlockIndex) ||
              eventBlockIndex < 0 ||
              !Number.isSafeInteger(definition.createdBlockIndex) ||
              definition.createdBlockIndex < 0 ||
              definition.createdBlockIndex >= eventBlockIndex))
        ) {
          throw new Error(
            `Canonical credit event ${eventLabel} does not appear after its confirmed definition`,
          );
        }
      }
    }
    const amount = isWorkTokenId(tokenId)
      ? BigInt(workAmountAtomsFromRecord(payload))
      : integerAmount(payload.amount, `${eventLabel} amount`);
    if (row.kind === "token-mint") {
      const minter = normalizedAddress(
        payload.minterAddress,
        `${eventLabel} minter`,
      );
      mintedByToken.set(tokenId, (mintedByToken.get(tokenId) ?? 0n) + amount);
      addBalance(tokenId, minter, amount, eventLabel);
      continue;
    }
    const sender = normalizedAddress(
      row.kind === "token-sale" ? payload.sellerAddress : payload.senderAddress,
      `${eventLabel} sender`,
    );
    const recipient = normalizedAddress(
      row.kind === "token-sale" ? payload.buyerAddress : payload.recipientAddress,
      `${eventLabel} recipient`,
    );
    addBalance(tokenId, sender, -amount, eventLabel);
    addBalance(tokenId, recipient, amount, eventLabel);
  }

  if (scopedReplay) {
    const missingReplayTokenIds = requestedTokenIds.filter(
      (tokenId) => !balancesByToken.has(tokenId),
    );
    if (missingReplayTokenIds.length > 0) {
      throw new Error(
        `Canonical scoped credit replay found no mint history for ${missingReplayTokenIds.join(", ")}`,
      );
    }
  }

  for (const [tokenId, balances] of balancesByToken) {
    const minted = mintedByToken.get(tokenId) ?? 0n;
    const definition = definitions.get(tokenId);
    if (
      !definition.uncapped &&
      definition.maxSupply > 0n &&
      minted > definition.maxSupply
    ) {
      throw new Error(
        `Canonical credit replay supply ${minted} exceeds ${tokenId} max ${definition.maxSupply}`,
      );
    }
    const replayedSupply = [...balances.values()].reduce(
      (total, balance) => total + balance,
      0n,
    );
    if (replayedSupply !== minted) {
      throw new Error(
        `Canonical credit replay supply mismatch for ${tokenId}: balances ${replayedSupply}, mints ${minted}`,
      );
    }
    const storedSupply = existingSupply.get(tokenId) ?? 0n;
    if (storedSupply > minted && !supplyCorrectionSet.has(tokenId)) {
      throw new Error(
        `Canonical credit replay for ${tokenId} is incomplete: stored ${storedSupply}, replayed ${minted}`,
      );
    }
  }

  const replayedTokenIds = [...balancesByToken.keys()].sort();
  if (replayedTokenIds.length === 0) {
    return { holders: 0, tokens: 0 };
  }
  await client.query(
    `
      DELETE FROM proof_indexer.credit_balances
      WHERE network = $1
        AND token_id = ANY($2::text[])
    `,
    [NETWORK, replayedTokenIds],
  );
  let holders = 0;
  const insertedBalanceKeys = new Set();
  for (const tokenId of replayedTokenIds) {
    const balances = balancesByToken.get(tokenId);
    for (const [address, balance] of [...balances.entries()].sort((left, right) =>
      left[0].localeCompare(right[0]),
    )) {
      if (balance === 0n) {
        continue;
      }
      await client.query(
        `
          INSERT INTO proof_indexer.credit_balances (
            network,
            token_id,
            address,
            confirmed_balance,
            pending_delta,
            updated_at
          )
          VALUES ($1, $2, $3, $4, $5, now())
        `,
        [
          NETWORK,
          tokenId,
          address,
          balance.toString(),
          (
            pendingDeltas.get(`${tokenId}:${address}`) ?? 0n
          ).toString(),
        ],
      );
      insertedBalanceKeys.add(`${tokenId}:${address}`);
      holders += 1;
    }
  }
  for (const [key, pendingDelta] of pendingDeltas) {
    if (pendingDelta === 0n || insertedBalanceKeys.has(key)) {
      continue;
    }
    const separator = key.indexOf(":");
    const tokenId = key.slice(0, separator);
    const address = key.slice(separator + 1);
    if (!replayedTokenIds.includes(tokenId) || !address) {
      continue;
    }
    await client.query(
      `
        INSERT INTO proof_indexer.credit_balances (
          network,
          token_id,
          address,
          confirmed_balance,
          pending_delta,
          updated_at
        )
        VALUES ($1, $2, $3, 0, $4, now())
      `,
      [NETWORK, tokenId, address, pendingDelta.toString()],
    );
  }
  return {
    correctedSupplyTokenIds: replayedTokenIds.filter((tokenId) =>
      supplyCorrectionSet.has(tokenId),
    ),
    holders,
    tokens: replayedTokenIds.length,
  };
}

function workAtomicDefinitionReady(row) {
  const metadata = objectValue(row?.metadata);
  return (
    String(row?.max_supply ?? "") === WORK_TOKEN_MAX_SUPPLY_ATOMS &&
    String(row?.mint_amount ?? "") === WORK_TOKEN_MINT_AMOUNT_ATOMS &&
    metadata.amountStorageModel === WORK_ATOMIC_PROJECTION_MODEL &&
    Number(metadata.decimals) === WORK_DECIMALS &&
    String(metadata.unitScale ?? "") === WORK_UNIT_SCALE_TEXT
  );
}

function canonicalJsonText(value) {
  if (Array.isArray(value)) {
    return `[${value.map((item) => canonicalJsonText(item)).join(",")}]`;
  }
  if (value && typeof value === "object") {
    return `{${Object.keys(value)
      .sort()
      .map(
        (key) =>
          `${JSON.stringify(key)}:${canonicalJsonText(value[key])}`,
      )
      .join(",")}}`;
  }
  return JSON.stringify(value ?? null);
}

async function workAtomicBalanceMigrationRows(client) {
  const result = await client.query(
    `
      SELECT
        address,
        confirmed_balance::text,
        pending_delta::text
      FROM proof_indexer.credit_balances
      WHERE network = $1 AND token_id = $2
      ORDER BY address ASC
    `,
    [NETWORK, WORK_TOKEN_ID],
  );
  return result.rows.map((row) => ({
    address: String(row?.address ?? ""),
    confirmedBalance: String(row?.confirmed_balance ?? ""),
    pendingDelta: String(row?.pending_delta ?? ""),
  }));
}

function assertWorkAtomicBalanceMigration(
  beforeRows,
  afterRows,
  { alreadyAtomic = false } = {},
) {
  const before = Array.isArray(beforeRows) ? beforeRows : [];
  const after = Array.isArray(afterRows) ? afterRows : [];
  if (before.length !== after.length) {
    throw new Error("WORK atomic migration changed the balance address set.");
  }
  const afterByAddress = new Map(
    after.map((row) => [String(row?.address ?? ""), row]),
  );
  for (const beforeRow of before) {
    const address = String(beforeRow?.address ?? "");
    const afterRow = afterByAddress.get(address);
    if (!address || !afterRow) {
      throw new Error("WORK atomic migration changed the balance address set.");
    }
    const multiplier = alreadyAtomic ? 1n : WORK_UNIT_SCALE;
    const expectedConfirmed =
      BigInt(String(beforeRow?.confirmedBalance ?? "0")) * multiplier;
    const expectedPending =
      BigInt(String(beforeRow?.pendingDelta ?? "0")) * multiplier;
    if (
      BigInt(String(afterRow?.confirmedBalance ?? "0")) !==
        expectedConfirmed ||
      BigInt(String(afterRow?.pendingDelta ?? "0")) !== expectedPending
    ) {
      throw new Error(
        `WORK atomic migration changed balance ${address} by something other than the exact unit scale.`,
      );
    }
  }
}

async function workAtomicListingMigrationRows(client) {
  const result = await client.query(
    `
      SELECT
        listing_id,
        status,
        seller_address,
        buyer_address,
        amount::text,
        price_sats::text,
        sale_ticket_txid,
        sale_ticket_vout,
        sale_ticket_value_sats::text,
        seal_txid,
        close_txid,
        payload
      FROM proof_indexer.credit_listings
      WHERE network = $1 AND token_id = $2
      ORDER BY listing_id ASC
    `,
    [NETWORK, WORK_TOKEN_ID],
  );
  return result.rows.map((row) => ({
    amount: String(row?.amount ?? ""),
    buyerAddress:
      row?.buyer_address === null || row?.buyer_address === undefined
        ? null
        : String(row.buyer_address),
    closeTxid:
      row?.close_txid === null || row?.close_txid === undefined
        ? null
        : String(row.close_txid),
    listingId: String(row?.listing_id ?? ""),
    payload: objectValue(row?.payload),
    priceSats: String(row?.price_sats ?? ""),
    saleTicketTxid:
      row?.sale_ticket_txid === null ||
      row?.sale_ticket_txid === undefined
        ? null
        : String(row.sale_ticket_txid),
    saleTicketValueSats:
      row?.sale_ticket_value_sats === null ||
      row?.sale_ticket_value_sats === undefined
        ? null
        : String(row.sale_ticket_value_sats),
    saleTicketVout:
      row?.sale_ticket_vout === null ||
      row?.sale_ticket_vout === undefined
        ? null
        : Number(row.sale_ticket_vout),
    sealTxid:
      row?.seal_txid === null || row?.seal_txid === undefined
        ? null
        : String(row.seal_txid),
    sellerAddress: String(row?.seller_address ?? ""),
    status: String(row?.status ?? ""),
  }));
}

function assertWorkAtomicListingMigration(
  beforeRows,
  afterRows,
  { alreadyAtomic = false } = {},
) {
  const before = Array.isArray(beforeRows) ? beforeRows : [];
  const after = Array.isArray(afterRows) ? afterRows : [];
  if (before.length !== after.length) {
    throw new Error("WORK atomic migration changed the listing identity set.");
  }
  const afterById = new Map(
    after.map((row) => [String(row?.listingId ?? ""), row]),
  );
  const immutableFields = [
    "buyerAddress",
    "closeTxid",
    "listingId",
    "priceSats",
    "saleTicketTxid",
    "saleTicketValueSats",
    "saleTicketVout",
    "sealTxid",
    "sellerAddress",
    "status",
  ];
  for (const beforeRow of before) {
    const listingId = String(beforeRow?.listingId ?? "");
    const afterRow = afterById.get(listingId);
    if (
      !listingId ||
      !afterRow ||
      immutableFields.some(
        (field) =>
          canonicalJsonText(afterRow?.[field]) !==
          canonicalJsonText(beforeRow?.[field]),
      )
    ) {
      throw new Error(
        `WORK atomic migration changed immutable listing ${listingId || "unknown"} state.`,
      );
    }
    const expectedAmount =
      BigInt(String(beforeRow?.amount ?? "0")) *
      (alreadyAtomic ? 1n : WORK_UNIT_SCALE);
    if (BigInt(String(afterRow?.amount ?? "0")) !== expectedAmount) {
      throw new Error(
        `WORK atomic migration did not scale listing ${listingId} exactly.`,
      );
    }
    const beforePayload = objectValue(beforeRow?.payload);
    const expectedPayload = alreadyAtomic
      ? beforePayload
      : {
          ...beforePayload,
          amount:
            String(beforePayload.amount ?? "").trim() ||
            String(beforeRow?.amount ?? "0"),
          amountAtoms:
            String(beforePayload.amountAtoms ?? "").trim() ||
            expectedAmount.toString(),
          decimals: WORK_DECIMALS,
          unitScale: WORK_UNIT_SCALE_TEXT,
        };
    if (
      canonicalJsonText(afterRow?.payload) !==
      canonicalJsonText(expectedPayload)
    ) {
      throw new Error(
        `WORK atomic migration changed listing ${listingId} payload outside its exact amount projection.`,
      );
    }
  }
}

async function workAtomicIssuanceOracleSnapshotState(client) {
  const result = await client.query(
    `
      WITH referenced AS MATERIALIZED (
        SELECT DISTINCT payload->>'issuanceValueSnapshotId' AS snapshot_id
        FROM proof_indexer.events
        WHERE network = $1
          AND COALESCE(payload->>'issuanceValueSnapshotId', '') <> ''
        UNION
        SELECT DISTINCT entry->'snapshot'->>'snapshotId' AS snapshot_id
        FROM proof_indexer.meta rebuild
        JOIN proof_indexer.meta witness
          ON witness.key = rebuild.value->'verifierBinding'->>'witnessSetMetaKey'
        CROSS JOIN LATERAL jsonb_array_elements(
          COALESCE(witness.value->'entries', '[]'::jsonb)
        ) entry
        WHERE rebuild.key = $2
          AND rebuild.value->>'network' = $1
          AND witness.value->>'network' = $1
          AND witness.value->>'model' = $3
          AND entry->>'disposition' = 'preserve'
      )
      SELECT
        referenced.snapshot_id,
        snapshot.snapshot_id IS NOT NULL AS resolved,
        CASE
          WHEN snapshot.snapshot_id IS NULL THEN NULL
          ELSE to_jsonb(snapshot)::text
        END AS fingerprint
      FROM referenced
      LEFT JOIN proof_indexer.ledger_snapshots snapshot
        ON snapshot.network = $1
       AND snapshot.snapshot_id = referenced.snapshot_id
      ORDER BY referenced.snapshot_id ASC
    `,
    [
      NETWORK,
      CANONICAL_REBUILD_META_KEY,
      INCB_RANGE_REPLAY_WITNESS_MANIFEST_MODEL,
    ],
  );
  return result.rows.map((row) => ({
    fingerprint:
      row?.fingerprint === null || row?.fingerprint === undefined
        ? null
        : String(row.fingerprint),
    resolved: row?.resolved === true,
    snapshotId: String(row?.snapshot_id ?? ""),
  }));
}

function assertWorkAtomicIssuanceOracleSnapshots(
  beforeRows,
  afterRows = beforeRows,
) {
  const before = Array.isArray(beforeRows) ? beforeRows : [];
  const after = Array.isArray(afterRows) ? afterRows : [];
  if (
    before.some(
      (row) =>
        !row?.snapshotId ||
        row?.resolved !== true ||
        !String(row?.fingerprint ?? ""),
    ) ||
    after.length !== before.length
  ) {
    throw new Error(
      "WORK atomic migration cannot resolve every INCB H-1 issuance oracle.",
    );
  }
  const afterById = new Map(
    after.map((row) => [String(row?.snapshotId ?? ""), row]),
  );
  for (const beforeRow of before) {
    const afterRow = afterById.get(beforeRow.snapshotId);
    if (
      !afterRow ||
      afterRow.resolved !== true ||
      afterRow.fingerprint !== beforeRow.fingerprint
    ) {
      throw new Error(
        `WORK atomic migration changed H-1 issuance oracle ${beforeRow.snapshotId}.`,
      );
    }
  }
}

function assertWorkAtomicEventMigration(beforeEvents, afterEvents) {
  const before = objectValue(beforeEvents);
  const after = objectValue(afterEvents);
  const invariantCounters = [
    "amount_events",
    "confirmed_mints",
    "confirmed_transfers",
    "confirmed_sales",
  ];
  for (const counter of invariantCounters) {
    if (Number(after[counter] ?? 0) !== Number(before[counter] ?? 0)) {
      throw new Error(
        `WORK atomic migration changed the ${counter} event counter.`,
      );
    }
  }
}

async function auditWorkAtomicProjection(client, { lock = false } = {}) {
  const definitionResult = await client.query(
    `
      SELECT
        token_id,
        max_supply::text,
        mint_amount::text,
        metadata
      FROM proof_indexer.credit_definitions
      WHERE network = $1 AND token_id = $2
      ${lock ? "FOR UPDATE" : ""}
    `,
    [NETWORK, WORK_TOKEN_ID],
  );
  const definition = definitionResult.rows[0];
  if (!definition) {
    throw new Error("Canonical WORK definition is missing.");
  }
  const atomic = workAtomicDefinitionReady(definition);
  const legacy =
    String(definition.max_supply ?? "") === String(WORK_TOKEN_MAX_SUPPLY) &&
    String(definition.mint_amount ?? "") === String(WORK_TOKEN_MINT_AMOUNT) &&
    !objectValue(definition.metadata).amountStorageModel;
  if (!atomic && !legacy) {
    throw new Error(
      "WORK definition is neither the exact legacy projection nor work-atoms-v1.",
    );
  }

  // node-postgres 9 deprecates overlapping queries on one transaction-bound
  // client. Keep every audit read on this exact transaction snapshot, but
  // issue them serially so prepare/replay cannot depend on queued client work.
  const atomicAuditQueries = [
    () => client.query(
        `
          SELECT
            count(*)::integer AS rows,
            count(*) FILTER (WHERE confirmed_balance > 0)::integer AS holders,
            count(*) FILTER (WHERE confirmed_balance < 0)::integer AS negative_balances,
            COALESCE(sum(confirmed_balance), 0)::text AS confirmed_supply,
            COALESCE(sum(pending_delta), 0)::text AS pending_delta,
            COALESCE(max(confirmed_balance), 0)::text AS max_balance,
            COALESCE(min(confirmed_balance), 0)::text AS min_balance
          FROM proof_indexer.credit_balances
          WHERE network = $1 AND token_id = $2
        `,
        [NETWORK, WORK_TOKEN_ID],
      ),
    () => client.query(
        `
          SELECT
            count(*)::integer AS rows,
            count(*) FILTER (WHERE amount <= 0)::integer AS invalid_amounts,
            COALESCE(min(amount), 0)::text AS min_amount,
            COALESCE(max(amount), 0)::text AS max_amount,
            jsonb_object_agg(status, status_count ORDER BY status) AS statuses
          FROM (
            SELECT status, amount, count(*) OVER (PARTITION BY status) AS status_count
            FROM proof_indexer.credit_listings
            WHERE network = $1 AND token_id = $2
          ) listings
        `,
        [NETWORK, WORK_TOKEN_ID],
      ),
    () => client.query(
        `
          SELECT
            count(*)::integer AS amount_events,
            count(*) FILTER (
              WHERE COALESCE(payload->>'amountAtoms', '') ~ '^(0|[1-9][0-9]*)$'
            )::integer AS atom_events,
            count(*) FILTER (
              WHERE COALESCE(payload->>'amountAtoms', '') <> ''
                AND COALESCE(payload->>'amountAtoms', '') !~ '^(0|[1-9][0-9]*)$'
            )::integer AS invalid_atom_events,
            count(*) FILTER (
              WHERE COALESCE(payload->>'amountAtoms', '') ~ '^(0|[1-9][0-9]*)$'
                AND COALESCE(payload->>'amount', '') ~
                  '^(0|[1-9][0-9]*)(\\.[0-9]{1,8})?$'
                AND (payload->>'amountAtoms')::numeric <>
                  ((payload->>'amount')::numeric * $3::numeric)
            )::integer AS mismatched_atom_events,
            count(*) FILTER (
              WHERE COALESCE(payload->>'amountAtoms', '') = ''
                AND COALESCE(payload->>'amount', '') !~
                  '^(0|[1-9][0-9]*)(\\.[0-9]{1,8})?$'
            )::integer AS invalid_legacy_events,
            count(*) FILTER (
              WHERE kind = 'token-mint'
                AND e.valid = true
                AND COALESCE(t.status, e.status) = 'confirmed'
            )::integer AS confirmed_mints,
            count(*) FILTER (
              WHERE kind = 'token-transfer'
                AND e.valid = true
                AND COALESCE(t.status, e.status) = 'confirmed'
            )::integer AS confirmed_transfers,
            count(*) FILTER (
              WHERE kind = 'token-sale'
                AND e.valid = true
                AND COALESCE(t.status, e.status) = 'confirmed'
            )::integer AS confirmed_sales
          FROM proof_indexer.events e
          LEFT JOIN proof_indexer.transactions t
            ON t.network = e.network AND t.txid = e.txid
          WHERE e.network = $1
            AND lower(COALESCE(e.payload->>'tokenId', '')) = $2
            AND (e.payload ? 'amount' OR e.payload ? 'amountAtoms')
        `,
        [NETWORK, WORK_TOKEN_ID, WORK_UNIT_SCALE_TEXT],
      ),
    () => client.query(
        `
          WITH reserved AS (
            SELECT seller_address, sum(amount) AS amount
            FROM proof_indexer.credit_listings
            WHERE network = $1
              AND token_id = $2
              AND status IN ('active', 'pending', 'sealing')
            GROUP BY seller_address
          )
          SELECT count(*)::integer AS oversubscribed_sellers
          FROM reserved
          LEFT JOIN proof_indexer.credit_balances balance
            ON balance.network = $1
           AND balance.token_id = $2
           AND balance.address = reserved.seller_address
          WHERE reserved.amount >
            GREATEST(0, COALESCE(balance.confirmed_balance, 0) +
              LEAST(0, COALESCE(balance.pending_delta, 0)))
        `,
        [NETWORK, WORK_TOKEN_ID],
      ),
    () => client.query(
        `
          WITH referenced AS MATERIALIZED (
            SELECT DISTINCT payload->>'issuanceValueSnapshotId' AS snapshot_id
            FROM proof_indexer.events
            WHERE network = $1
              AND COALESCE(payload->>'issuanceValueSnapshotId', '') <> ''
            UNION
            SELECT DISTINCT entry->'snapshot'->>'snapshotId' AS snapshot_id
            FROM proof_indexer.meta rebuild
            JOIN proof_indexer.meta witness
              ON witness.key = rebuild.value->'verifierBinding'->>'witnessSetMetaKey'
            CROSS JOIN LATERAL jsonb_array_elements(
              COALESCE(witness.value->'entries', '[]'::jsonb)
            ) entry
            WHERE rebuild.key = $3
              AND rebuild.value->>'network' = $1
              AND witness.value->>'network' = $1
              AND witness.value->>'model' = $4
              AND entry->>'disposition' = 'preserve'
          ),
          classified AS MATERIALIZED (
            SELECT
              snapshot.snapshot_id,
              (
                snapshot.source_hashes ? 'canonicalSummary'
                OR snapshot.payload ? 'activityPayload'
                OR snapshot.payload ? 'registryHistoryPayloads'
                OR snapshot.payload ? 'summaryPayloads'
                OR snapshot.payload ? 'tokenHistoryPayloads'
                OR snapshot.payload ? 'tokenStatePayloads'
                OR snapshot.consistency->>'status' =
                  'summary-snapshot-fallback'
              ) AS derived,
              COALESCE(
                snapshot.payload->>'workAmountStorageModel',
                ''
              ) = $2 AS marked,
              referenced.snapshot_id IS NOT NULL AS issuance_locked
            FROM proof_indexer.ledger_snapshots snapshot
            LEFT JOIN referenced
              ON referenced.snapshot_id = snapshot.snapshot_id
            WHERE snapshot.network = $1
          )
          SELECT
            count(*)::integer AS total,
            count(*) FILTER (WHERE derived)::integer AS derived,
            count(*) FILTER (WHERE marked)::integer AS marked,
            count(*) FILTER (WHERE issuance_locked)::integer AS issuance_locked,
            count(*) FILTER (
              WHERE derived AND NOT marked
            )::integer AS unmarked_derived,
            count(*) FILTER (
              WHERE derived AND NOT marked AND issuance_locked
            )::integer AS unmarked_derived_referenced,
            count(*) FILTER (
              WHERE derived AND NOT marked AND NOT issuance_locked
            )::integer AS unmarked_non_oracle_derived
          FROM classified
        `,
        [
          NETWORK,
          WORK_ATOMIC_PROJECTION_MODEL,
          CANONICAL_REBUILD_META_KEY,
          INCB_RANGE_REPLAY_WITNESS_MANIFEST_MODEL,
        ],
      ),
  ];
  const atomicAuditResults = [];
  for (const query of atomicAuditQueries) {
    atomicAuditResults.push(await query());
  }
  const [
    balancesResult,
    listingsResult,
    eventsResult,
    reservationsResult,
    snapshotsResult,
  ] = atomicAuditResults;

  const balances = balancesResult.rows[0] ?? {};
  const listings = listingsResult.rows[0] ?? {};
  const events = eventsResult.rows[0] ?? {};
  const reservations = reservationsResult.rows[0] ?? {};
  const snapshots = snapshotsResult.rows[0] ?? {};
  if (
    Number(balances.negative_balances ?? 0) !== 0 ||
    Number(listings.invalid_amounts ?? 0) !== 0 ||
    Number(events.invalid_atom_events ?? 0) !== 0 ||
    Number(events.invalid_legacy_events ?? 0) !== 0 ||
    Number(events.mismatched_atom_events ?? 0) !== 0
  ) {
    throw new Error(
      "WORK atomic audit found negative balances or malformed event/listing amounts.",
    );
  }
  if (
    atomic &&
    Number(events.atom_events ?? 0) !== Number(events.amount_events ?? 0)
  ) {
    throw new Error(
      "Atomic WORK projection contains amount-bearing events without amountAtoms.",
    );
  }
  if (Number(reservations.oversubscribed_sellers ?? 0) !== 0) {
    throw new Error(
      "WORK atomic migration preflight found oversubscribed listing reservations.",
    );
  }
  if (legacy && Number(snapshots.marked ?? 0) !== 0) {
    throw new Error(
      "Legacy WORK projection contains a prematurely marked atomic snapshot.",
    );
  }
  return {
    atomic,
    balances,
    definition: {
      decimals: objectValue(definition.metadata).decimals ?? null,
      maxSupply: String(definition.max_supply ?? ""),
      mintAmount: String(definition.mint_amount ?? ""),
      model: objectValue(definition.metadata).amountStorageModel ?? "",
      unitScale: String(objectValue(definition.metadata).unitScale ?? ""),
    },
    events,
    legacy,
    listings,
    reservations,
    snapshots,
  };
}

async function canonicalWorkAtomicConservation(client) {
  const result = await client.query(
    `
      WITH mint_state AS MATERIALIZED (
        SELECT
          count(*)::integer AS mint_events,
          count(*) FILTER (
            WHERE COALESCE(e.payload->>'amountAtoms', '') !~ '^[1-9][0-9]*$'
          )::integer AS invalid_mint_amounts,
          COALESCE(sum(
            CASE
              WHEN COALESCE(e.payload->>'amountAtoms', '') ~ '^[1-9][0-9]*$'
                THEN (e.payload->>'amountAtoms')::numeric
              ELSE 0
            END
          ), 0)::text AS minted_supply
        FROM proof_indexer.events e
        LEFT JOIN proof_indexer.transactions t
          ON t.network = e.network
         AND t.txid = e.txid
        WHERE e.network = $1
          AND e.protocol = 'pwt1'
          AND e.kind = 'token-mint'
          AND e.valid = true
          AND COALESCE(t.status, e.status) = 'confirmed'
          AND lower(COALESCE(e.payload->>'tokenId', '')) = $2
      ),
      balance_state AS MATERIALIZED (
        SELECT
          count(*) FILTER (WHERE confirmed_balance < 0)::integer AS negative_balances,
          COALESCE(sum(confirmed_balance), 0)::text AS balance_supply
        FROM proof_indexer.credit_balances
        WHERE network = $1 AND token_id = $2
      )
      SELECT
        mint_state.mint_events,
        mint_state.invalid_mint_amounts,
        mint_state.minted_supply,
        balance_state.negative_balances,
        balance_state.balance_supply
      FROM mint_state
      CROSS JOIN balance_state
    `,
    [NETWORK, WORK_TOKEN_ID],
  );
  const row = result.rows[0] ?? {};
  const mintedSupply = String(row.minted_supply ?? "");
  const balanceSupply = String(row.balance_supply ?? "");
  if (
    !/^\d+$/u.test(mintedSupply) ||
    !/^\d+$/u.test(balanceSupply) ||
    Number(row.mint_events ?? 0) <= 0 ||
    Number(row.invalid_mint_amounts ?? 0) !== 0 ||
    Number(row.negative_balances ?? 0) !== 0 ||
    BigInt(mintedSupply) !== BigInt(balanceSupply)
  ) {
    throw new Error(
      `Canonical WORK atomic conservation failed: mints ${mintedSupply || "invalid"}, balances ${balanceSupply || "invalid"}.`,
    );
  }
  return {
    balanceSupply,
    mintedSupply,
    mintEvents: Number(row.mint_events),
  };
}

async function assertCanonicalWorkAtomicSource(client, context) {
  await assertCanonicalWorkAtomicProjection(client, context);
  const audit = await auditWorkAtomicProjection(client);
  if (!audit.atomic || audit.legacy) {
    throw new Error(
      `${context} requires a fully atomic WORK source projection.`,
    );
  }
  return {
    audit,
    conservation: await canonicalWorkAtomicConservation(client),
  };
}

async function invalidateWorkAtomicDerivedSnapshots(client) {
  const result = await client.query(
    `
      WITH issuance_locked AS MATERIALIZED (
        SELECT DISTINCT payload->>'issuanceValueSnapshotId' AS snapshot_id
        FROM proof_indexer.events
        WHERE network = $1
          AND COALESCE(payload->>'issuanceValueSnapshotId', '') <> ''
        UNION
        SELECT DISTINCT entry->'snapshot'->>'snapshotId' AS snapshot_id
        FROM proof_indexer.meta rebuild
        JOIN proof_indexer.meta witness
          ON witness.key = rebuild.value->'verifierBinding'->>'witnessSetMetaKey'
        CROSS JOIN LATERAL jsonb_array_elements(
          COALESCE(witness.value->'entries', '[]'::jsonb)
        ) entry
        WHERE rebuild.key = $3
          AND rebuild.value->>'network' = $1
          AND witness.value->>'network' = $1
          AND witness.value->>'model' = $4
          AND entry->>'disposition' = 'preserve'
      )
      DELETE FROM proof_indexer.ledger_snapshots snapshot
      WHERE snapshot.network = $1
        AND COALESCE(
          snapshot.payload->>'workAmountStorageModel',
          ''
        ) <> $2
        AND NOT EXISTS (
          SELECT 1
          FROM issuance_locked locked
          WHERE locked.snapshot_id = snapshot.snapshot_id
        )
        AND (
          snapshot.source_hashes ? 'canonicalSummary'
          OR snapshot.payload ? 'activityPayload'
          OR snapshot.payload ? 'registryHistoryPayloads'
          OR snapshot.payload ? 'summaryPayloads'
          OR snapshot.payload ? 'tokenHistoryPayloads'
          OR snapshot.payload ? 'tokenStatePayloads'
          OR snapshot.consistency->>'status' = 'summary-snapshot-fallback'
        )
      RETURNING snapshot_id
    `,
    [
      NETWORK,
      WORK_ATOMIC_PROJECTION_MODEL,
      CANONICAL_REBUILD_META_KEY,
      INCB_RANGE_REPLAY_WITNESS_MANIFEST_MODEL,
    ],
  );
  return result.rows.map((row) => String(row.snapshot_id ?? ""));
}

function assertWorkAtomicSnapshotMigrationState(audit) {
  const snapshots = objectValue(audit?.snapshots);
  const unmarkedDerived = Number(snapshots.unmarked_derived ?? 0);
  const unmarkedReferenced = Number(
    snapshots.unmarked_derived_referenced ?? 0,
  );
  const unmarkedNonOracle = Number(
    snapshots.unmarked_non_oracle_derived ?? 0,
  );
  if (
    unmarkedNonOracle !== 0 ||
    unmarkedDerived !== unmarkedReferenced
  ) {
    throw new Error(
      "WORK atomic migration left an unmarked derived snapshot that is not an INCB issuance oracle.",
    );
  }
}

async function markedExactTipWorkAtomicSummary(client) {
  const result = await client.query(
    `
      WITH latest_scan AS MATERIALIZED (
        SELECT
          indexed_through_block,
          lower(COALESCE(
            NULLIF(payload->>'indexedThroughBlockHash', ''),
            NULLIF(payload->>'blockHash', ''),
            NULLIF(source_hashes->>'blockScan', '')
          )) AS block_hash
        FROM proof_indexer.ledger_snapshots
        WHERE network = $1
          AND NOT COALESCE(source_hashes ? 'canonicalSummary', false)
          AND (
            COALESCE(source_hashes ? 'blockScan', false)
            OR payload->>'source' = 'proof-indexer-block-scan'
          )
          AND COALESCE(
            NULLIF(payload->>'indexedThroughBlockHash', ''),
            NULLIF(payload->>'blockHash', ''),
            NULLIF(source_hashes->>'blockScan', '')
          ) IS NOT NULL
        ORDER BY indexed_through_block DESC, generated_at DESC
        LIMIT 1
      )
      SELECT
        snapshot.snapshot_id,
        snapshot.indexed_through_block,
        latest_scan.block_hash
      FROM proof_indexer.ledger_snapshots snapshot
      JOIN latest_scan
        ON latest_scan.indexed_through_block =
          snapshot.indexed_through_block
      WHERE snapshot.network = $1
        AND snapshot.payload->>'workAmountStorageModel' = $2
        AND COALESCE(
          snapshot.consistency->>'ok',
          snapshot.payload->>'ok',
          'false'
        ) = 'true'
        AND COALESCE(
          snapshot.consistency->>'status',
          snapshot.payload->>'status',
          ''
        ) = 'green'
        AND snapshot.source_hashes ? 'canonicalSummary'
        AND snapshot.payload->'summaryRefresh'->>'mode' =
          'canonical-summary-refresh'
        AND snapshot.payload->'totals'->>'workNetworkValueAccountingModel' =
          'canonical-exact-work-network-q8-v1'
        AND snapshot.payload->'summaryPayloads'->'workFloor'
          ->>'workNetworkValueAccountingModel' =
          'canonical-exact-work-network-q8-v1'
        AND snapshot.payload->'summaryPayloads'->'workFloor'
          ->'actualValue'->>'workNetworkValueAccountingModel' =
          'canonical-exact-work-network-q8-v1'
        AND snapshot.payload->'totals'->>'workNetworkValueQ8' ~
          '^[1-9][0-9]*$'
        AND snapshot.payload->'summaryPayloads'->'workFloor'
          ->>'networkValueQ8' =
          snapshot.payload->'totals'->>'workNetworkValueQ8'
        AND snapshot.payload->'summaryPayloads'->'workFloor'
          ->>'liveNetworkValueQ8' =
          snapshot.payload->'totals'->>'workNetworkValueQ8'
        AND snapshot.payload->'summaryPayloads'->'workFloor'
          ->'actualValue'->>'networkValueQ8' =
          snapshot.payload->'totals'->>'workNetworkValueQ8'
        AND snapshot.payload->'summaryPayloads'->'workFloor'
          ->'actualValue'->>'liveNetworkValueQ8' =
          snapshot.payload->'totals'->>'workNetworkValueQ8'
        AND snapshot.payload->'summaryPayloads'->'workFloor'
          ->'actualValue'->>'totalQ8' =
          snapshot.payload->'totals'->>'workNetworkValueQ8'
        AND snapshot.payload->'summaryPayloads'->'workFloor'
          ->'actualValue'->>'liveTotalQ8' =
          snapshot.payload->'totals'->>'workNetworkValueQ8'
        AND snapshot.payload->>'snapshotId' = snapshot.snapshot_id
        AND lower(COALESCE(
          snapshot.source_hashes->>'blockScan',
          ''
        )) = latest_scan.block_hash
        AND lower(COALESCE(
          snapshot.payload->>'indexedThroughBlockHash',
          ''
        )) = latest_scan.block_hash
        AND lower(COALESCE(
          snapshot.payload->'summaryRefresh'->>'indexedThroughBlockHash',
          ''
        )) = latest_scan.block_hash
        AND lower(COALESCE(
          snapshot.payload->'summaryPayloads'->'workFloor'
            ->>'indexedThroughBlockHash',
          ''
        )) = latest_scan.block_hash
        AND jsonb_typeof(
          snapshot.payload->'summaryPayloads'
        ) = 'object'
        AND jsonb_typeof(
          snapshot.payload->'summaryPayloads'->'growthSummary'
        ) = 'object'
        AND jsonb_typeof(
          snapshot.payload->'summaryPayloads'->'inceptionSummary'
        ) = 'object'
        AND jsonb_typeof(
          snapshot.payload->'summaryPayloads'->'infinitySummary'
        ) = 'object'
        AND jsonb_typeof(
          snapshot.payload->'summaryPayloads'->'logSummary'
        ) = 'object'
        AND jsonb_typeof(
          snapshot.payload->'summaryPayloads'->'marketplaceSummary'
        ) = 'object'
        AND jsonb_typeof(
          snapshot.payload->'summaryPayloads'->'tokenSummary'
        ) = 'object'
        AND jsonb_typeof(
          snapshot.payload->'summaryPayloads'->'workFloor'
        ) = 'object'
        AND jsonb_typeof(
          snapshot.payload->'summaryPayloads'->'workSummary'
        ) = 'object'
        AND EXISTS (
          SELECT 1
          FROM jsonb_array_elements(
            COALESCE(snapshot.consistency->'checks', '[]'::jsonb)
          ) AS check_item
          WHERE check_item->>'name' =
              'token-components-cover-confirmed-activity'
            AND COALESCE(check_item->>'ok', 'false') = 'true'
        )
        AND EXISTS (
          SELECT 1
          FROM jsonb_array_elements(
            COALESCE(snapshot.consistency->'checks', '[]'::jsonb)
          ) AS check_item
          WHERE check_item->>'name' =
              'canonical-activity-count-matches-public-log'
            AND COALESCE(check_item->>'ok', 'false') = 'true'
        )
      ORDER BY snapshot.generated_at DESC, snapshot.snapshot_id DESC
      LIMIT 1
    `,
    [NETWORK, WORK_ATOMIC_PROJECTION_MODEL],
  );
  const row = result.rows[0];
  return row
    ? {
        indexedThroughBlock: Number(row.indexed_through_block),
        indexedThroughBlockHash: String(row.block_hash ?? ""),
        snapshotId: String(row.snapshot_id ?? ""),
      }
    : null;
}

async function verifyWorkAtomicPostBootstrap(client) {
  const audit = await auditWorkAtomicProjection(client);
  if (!audit.atomic) {
    throw new Error(
      "WORK atomic post-bootstrap verification requires work-atoms-v1.",
    );
  }
  assertWorkAtomicSnapshotMigrationState(audit);
  const issuanceOracles =
    await workAtomicIssuanceOracleSnapshotState(client);
  assertWorkAtomicIssuanceOracleSnapshots(issuanceOracles);
  const exactTipSummary = await markedExactTipWorkAtomicSummary(client);
  if (
    !exactTipSummary ||
    !exactTipSummary.snapshotId ||
    !Number.isSafeInteger(exactTipSummary.indexedThroughBlock) ||
    exactTipSummary.indexedThroughBlock <= 0 ||
    !/^[0-9a-f]{64}$/u.test(
      exactTipSummary.indexedThroughBlockHash,
    )
  ) {
    throw new Error(
      "WORK atomic post-bootstrap verification requires a marked green exact-tip canonical summary.",
    );
  }
  return {
    audit,
    exactTipSummary,
    issuanceOracleSnapshotIds: issuanceOracles.map(
      (row) => row.snapshotId,
    ),
    issuanceOracleSnapshots: issuanceOracles.length,
  };
}

async function migrateWorkAtomicProjection(client) {
  await client.query("BEGIN ISOLATION LEVEL SERIALIZABLE");
  try {
    await client.query(
      "SELECT pg_advisory_xact_lock(hashtext($1), hashtext($2))",
      ["proof-indexer-work-atoms-v1", NETWORK],
    );
    await client.query(
      `
        LOCK TABLE
          proof_indexer.credit_definitions,
          proof_indexer.credit_balances,
          proof_indexer.credit_listings,
          proof_indexer.events,
          proof_indexer.ledger_snapshots,
          proof_indexer.transactions
        IN SHARE ROW EXCLUSIVE MODE
      `,
    );
    const before = await auditWorkAtomicProjection(client, { lock: true });
    const [
      beforeBalances,
      beforeListings,
      issuanceOraclesBefore,
    ] = await Promise.all([
      workAtomicBalanceMigrationRows(client),
      workAtomicListingMigrationRows(client),
      workAtomicIssuanceOracleSnapshotState(client),
    ]);
    assertWorkAtomicIssuanceOracleSnapshots(issuanceOraclesBefore);
    if (before.atomic) {
      const invalidatedSnapshotIds =
        await invalidateWorkAtomicDerivedSnapshots(client);
      const after = await auditWorkAtomicProjection(client);
      const [
        afterBalances,
        afterListings,
        issuanceOraclesAfter,
      ] = await Promise.all([
        workAtomicBalanceMigrationRows(client),
        workAtomicListingMigrationRows(client),
        workAtomicIssuanceOracleSnapshotState(client),
      ]);
      assertWorkAtomicBalanceMigration(beforeBalances, afterBalances, {
        alreadyAtomic: true,
      });
      assertWorkAtomicListingMigration(beforeListings, afterListings, {
        alreadyAtomic: true,
      });
      assertWorkAtomicIssuanceOracleSnapshots(
        issuanceOraclesBefore,
        issuanceOraclesAfter,
      );
      assertWorkAtomicEventMigration(before.events, after.events);
      assertWorkAtomicSnapshotMigrationState(after);
      await client.query("COMMIT");
      return {
        alreadyApplied: true,
        after,
        before,
        bootstrapRequired: true,
        cacheInvalidationRequired: [
          "restart the staging proof-api after clearing process/disk response caches",
          "run the worker once and publish a marked exact-tip canonical summary",
          "run indexer:verify-work-atoms-post-bootstrap before public exposure",
        ],
        invalidatedSnapshotIds,
      };
    }
    if (!before.legacy) {
      throw new Error("WORK atomic migration requires the exact legacy state.");
    }

    await client.query(
      `
        UPDATE proof_indexer.events
        SET
          payload = payload || jsonb_build_object(
            'amountAtoms',
            CASE
              WHEN COALESCE(payload->>'amountAtoms', '') <> ''
                THEN payload->>'amountAtoms'
              ELSE (
                trunc((payload->>'amount')::numeric * $3::numeric)
              )::text
            END,
            'decimals', $4::integer,
            'unitScale', $3::text
          ),
          updated_at = now()
        WHERE network = $1
          AND lower(COALESCE(payload->>'tokenId', '')) = $2
          AND (payload ? 'amount' OR payload ? 'amountAtoms')
      `,
      [NETWORK, WORK_TOKEN_ID, WORK_UNIT_SCALE_TEXT, WORK_DECIMALS],
    );

    await client.query(
      `
        UPDATE proof_indexer.credit_balances
        SET
          confirmed_balance = confirmed_balance * $3::numeric,
          pending_delta = pending_delta * $3::numeric,
          updated_at = now()
        WHERE network = $1 AND token_id = $2
      `,
      [NETWORK, WORK_TOKEN_ID, WORK_UNIT_SCALE_TEXT],
    );

    await client.query(
      `
        UPDATE proof_indexer.credit_listings
        SET
          amount = CASE
            WHEN COALESCE(payload->>'amountAtoms', '') <> ''
              THEN (payload->>'amountAtoms')::numeric
            ELSE amount * $3::numeric
          END,
          payload = payload || jsonb_build_object(
            'amount',
            COALESCE(NULLIF(payload->>'amount', ''), amount::text),
            'amountAtoms',
            CASE
              WHEN COALESCE(payload->>'amountAtoms', '') <> ''
                THEN payload->>'amountAtoms'
              ELSE trunc(amount * $3::numeric)::text
            END,
            'decimals', $4::integer,
            'unitScale', $3::text
          ),
          updated_at = now()
        WHERE network = $1 AND token_id = $2
      `,
      [NETWORK, WORK_TOKEN_ID, WORK_UNIT_SCALE_TEXT, WORK_DECIMALS],
    );

    await client.query(
      `
        UPDATE proof_indexer.credit_definitions
        SET
          max_supply = $3::numeric,
          mint_amount = $4::numeric,
          metadata = metadata || $5::jsonb
        WHERE network = $1
          AND token_id = $2
          AND max_supply = $6::numeric
          AND mint_amount = $7::numeric
      `,
      [
        NETWORK,
        WORK_TOKEN_ID,
        WORK_TOKEN_MAX_SUPPLY_ATOMS,
        WORK_TOKEN_MINT_AMOUNT_ATOMS,
        JSON.stringify(
          withWorkPrecisionMetadata({
            maxSupply: String(WORK_TOKEN_MAX_SUPPLY),
            maxSupplyAtoms: WORK_TOKEN_MAX_SUPPLY_ATOMS,
            mintAmount: String(WORK_TOKEN_MINT_AMOUNT),
            mintAmountAtoms: WORK_TOKEN_MINT_AMOUNT_ATOMS,
          }),
        ),
        String(WORK_TOKEN_MAX_SUPPLY),
        String(WORK_TOKEN_MINT_AMOUNT),
      ],
    );
    workAtomicProjectionReadyByClient.delete(client);
    if (!(await workAtomicProjectionReady(client, { refresh: true }))) {
      throw new Error("WORK definition atomic marker did not commit in-transaction.");
    }

    const replay = await rebuildConfirmedCreditBalancesFromCanonicalEvents(
      client,
      {
        preservePendingDeltas: true,
        tokenIds: [WORK_TOKEN_ID],
      },
    );
    const invalidatedSnapshotIds =
      await invalidateWorkAtomicDerivedSnapshots(client);
    const after = await auditWorkAtomicProjection(client);
    const [
      afterBalances,
      afterListings,
      issuanceOraclesAfter,
    ] = await Promise.all([
      workAtomicBalanceMigrationRows(client),
      workAtomicListingMigrationRows(client),
      workAtomicIssuanceOracleSnapshotState(client),
    ]);
    assertWorkAtomicBalanceMigration(beforeBalances, afterBalances);
    assertWorkAtomicListingMigration(beforeListings, afterListings);
    assertWorkAtomicIssuanceOracleSnapshots(
      issuanceOraclesBefore,
      issuanceOraclesAfter,
    );
    assertWorkAtomicEventMigration(before.events, after.events);
    assertWorkAtomicSnapshotMigrationState(after);
    const expectedSupply = (
      BigInt(String(before.balances.confirmed_supply ?? "0")) *
      WORK_UNIT_SCALE
    ).toString();
    const expectedPendingDelta = (
      BigInt(String(before.balances.pending_delta ?? "0")) *
      WORK_UNIT_SCALE
    ).toString();
    if (
      !after.atomic ||
      String(after.balances.confirmed_supply ?? "") !== expectedSupply ||
      String(after.balances.pending_delta ?? "") !== expectedPendingDelta ||
      Number(after.balances.rows ?? 0) !== Number(before.balances.rows ?? 0) ||
      Number(after.listings.rows ?? 0) !== Number(before.listings.rows ?? 0) ||
      Number(after.snapshots?.marked ?? 0) !== 0 ||
      Number(after.reservations.oversubscribed_sellers ?? 0) !== 0
    ) {
      throw new Error(
        "WORK atomic migration verification failed; transaction will roll back.",
      );
    }
    await client.query("COMMIT");
    return {
      after,
      alreadyApplied: false,
      before,
      bootstrapRequired: true,
      cacheInvalidationRequired: [
        "restart the staging proof-api after clearing process/disk response caches",
        "run the worker once and publish a marked exact-tip canonical summary",
        "run indexer:verify-work-atoms-post-bootstrap before public exposure",
      ],
      invalidatedSnapshotIds,
      replay,
    };
  } catch (error) {
    await client.query("ROLLBACK");
    workAtomicProjectionReadyByClient.delete(client);
    throw error;
  }
}

function snapshotSourceParams(params = {}) {
  return REFRESH_SNAPSHOT_SOURCES ? { ...params, fresh: "1" } : params;
}

function tokenSnapshotSourceParams(params = {}) {
  return REFRESH_TOKEN_SNAPSHOT_SOURCES ? { ...params, fresh: "1" } : params;
}

function scopedTokenSnapshotSourceParams(scope, params = {}) {
  if (scope?.key === "all" && !REFRESH_ALL_TOKEN_SNAPSHOT_SOURCES) {
    return snapshotSourceParams(params);
  }
  return tokenSnapshotSourceParams(params);
}

function summarySnapshotSourceParams(params = {}) {
  return REFRESH_SUMMARY_SNAPSHOT_SOURCES
    ? { ...params, fresh: "1" }
    : snapshotSourceParams(params);
}

function backfillSourceParams(params = {}) {
  return REFRESH_SOURCE_READS ? { ...params, fresh: "1" } : params;
}

async function readHistorySnapshot(
  pathname,
  params = {},
  sourceParams = snapshotSourceParams,
) {
  let cursor = "";
  let firstPayload = null;
  let page = 0;
  const items = [];

  while (page < MAX_PAGES) {
    const payload = await readJson(
      endpoint(pathname, sourceParams({ ...params, cursor })),
    );
    if (!firstPayload) {
      firstPayload = payload;
    }
    items.push(...(Array.isArray(payload.items) ? payload.items : []));
    cursor = String(payload.nextCursor ?? "");
    page += 1;
    if (!cursor) {
      break;
    }
  }

  const payloadTotalCount = Number(firstPayload?.totalCount);
  const totalCount = Math.max(
    Number.isFinite(payloadTotalCount) ? payloadTotalCount : 0,
    items.length,
  );
  return {
    ...(firstPayload ?? {}),
    complete: !cursor,
    cursor: "0",
    end: items.length,
    items,
    limit: items.length,
    nextCursor: "",
    page: 0,
    pageCount: 1,
    pageSize: items.length,
    totalCount,
  };
}

function isHexTxid(value) {
  return /^[0-9a-f]{64}$/u.test(String(value ?? "").toLowerCase());
}

function itemTxid(item) {
  const tokenId = String(item?.tokenId ?? "").trim().toLowerCase();
  const candidates = [
    item?.txid,
    item?.eventTxid,
    item?.listingId,
    item?.closedTxid,
    item?.sealTxid,
  ];
  const directTxid = String(candidates.find(isHexTxid) ?? "").toLowerCase();
  if (directTxid) {
    return BOND_TOKEN_IDS.has(tokenId) && directTxid === tokenId
      ? ""
      : directTxid;
  }
  return isHexTxid(tokenId) && !BOND_TOKEN_IDS.has(tokenId) ? tokenId : "";
}

function itemStatus(item) {
  const raw = String(item?.status ?? "").toLowerCase();
  if (["pending", "confirmed", "dropped", "orphaned"].includes(raw)) {
    return raw;
  }
  if (item?.dropped === true) {
    return "dropped";
  }
  return item?.confirmed === false ? "pending" : "confirmed";
}

function itemTime(item) {
  const kind = String(item?.kind ?? item?.action ?? "").toLowerCase();
  const plausibleTime = (...values) => {
    for (const value of values) {
      if (value === null || value === undefined || value === "") {
        continue;
      }
      const parsed = Date.parse(value);
      if (Number.isFinite(parsed) && parsed >= Date.UTC(2009, 0, 3, 18, 15, 5)) {
        return value;
      }
    }
    return null;
  };
  if (kind === "token-listing-sealed") {
    const sealTime = plausibleTime(item?.sealAt);
    if (sealTime) {
      return sealTime;
    }
  }
  if (kind === "token-listing-closed") {
    const closedTime = plausibleTime(item?.closedAt);
    if (closedTime) {
      return closedTime;
    }
  }
  return plausibleTime(
    item?.createdAt,
    item?.blockTime,
    item?.timestamp,
    item?.confirmedAt,
    item?.indexedAt,
    item?.updatedAt,
  );
}

function normalizedText(value) {
  return String(value ?? "").trim();
}

function normalizedLowerText(value) {
  return normalizedText(value).toLowerCase();
}

function rawEventKind(item, fallback) {
  return normalizedLowerText(item?.kind ?? item?.action ?? fallback ?? "event");
}

function bondTagForMemo(value) {
  const memo = normalizedLowerText(value);
  return BOND_TAGS.find((tag) => tag.memo === memo) ?? null;
}

function bondTagForKind(value) {
  const kind = normalizedLowerText(value);
  return BOND_TAGS.find((tag) => tag.kind === kind) ?? null;
}

function bondTagForItem(item, kind = rawEventKind(item)) {
  const direct = bondTagForKind(kind);
  if (direct) {
    return direct;
  }
  if (kind !== "mail") {
    return null;
  }
  for (const value of [item?.detail, item?.memo, item?.body, item?.message]) {
    const tag = bondTagForMemo(value);
    if (tag) {
      return tag;
    }
  }
  return null;
}

function isInfinityBondMemoText(value) {
  return bondTagForMemo(value)?.kind === INFINITY_BOND_KIND;
}

function isInfinityBondItem(item, kind = rawEventKind(item)) {
  return bondTagForItem(item, kind)?.kind === INFINITY_BOND_KIND;
}

function stableEventKeyKind(item, kind, fallback) {
  const rawKind = rawEventKind(item, fallback);
  return bondTagForItem(item, rawKind)?.kind ?? bondTagForKind(kind)?.kind ?? kind;
}

function normalizedBondTags(tags, bondTag) {
  const bondLabels = new Set(BOND_TAGS.map((tag) => tag.label.toLowerCase()));
  const normalized = [];
  for (const tag of Array.isArray(tags) ? tags : []) {
    const value = normalizedText(tag);
    if (!value) {
      continue;
    }
    if (bondLabels.has(value.toLowerCase())) {
      continue;
    }
    normalized.push(/^message$/iu.test(value) ? bondTag.label : value);
  }
  if (!normalized.some((tag) => tag.toLowerCase() === bondTag.label.toLowerCase())) {
    normalized.push(bondTag.label);
  }
  return normalized;
}

function normalizedBondTitle(item, status, bondTag) {
  const title = normalizedText(item?.title);
  if (title && !/^(?:mail|message)\b/iu.test(title)) {
    return title;
  }
  return `${bondTag.label} ${status === "confirmed" ? "sent" : "pending"}`;
}

function normalizedEventItem(item, kind, status) {
  const eventTime = itemTime(item);
  const timestampedItem = {
    ...item,
    ...(eventTime ? { createdAt: eventTime } : {}),
    confirmed: status === "confirmed",
    dropped: status === "dropped",
    status,
  };
  const bondTag = bondTagForKind(kind);
  if (!bondTag) {
    return timestampedItem;
  }
  return {
    ...timestampedItem,
    detail: normalizedText(timestampedItem?.detail) || bondTag.memo,
    kind: bondTag.kind,
    tags: normalizedBondTags(timestampedItem?.tags, bondTag),
    title: normalizedBondTitle(timestampedItem, status, bondTag),
  };
}

function tokenMarketLogItemConfirmed(item) {
  if (item?.kind === "closed-listing") {
    return item.closedListing?.closedConfirmed ?? item.closedListing?.confirmed;
  }
  if (item?.kind === "sale") {
    return item.sale?.confirmed;
  }
  return item?.listing?.confirmed;
}

function tokenMarketLogItemCreatedAt(item) {
  if (item?.kind === "closed-listing") {
    return String(
      item.closedListing?.closedAt ?? item.closedListing?.createdAt ?? "",
    );
  }
  if (item?.kind === "sale") {
    return String(item.sale?.createdAt ?? "");
  }
  return String(item?.listing?.createdAt ?? "");
}

function tokenMarketLogItemTxid(item) {
  if (item?.kind === "closed-listing") {
    return String(
      item.closedListing?.closedTxid ?? item.closedListing?.listingId ?? "",
    );
  }
  if (item?.kind === "sale") {
    return String(item.sale?.txid ?? "");
  }
  return String(item?.listing?.listingId ?? "");
}

function tokenMarketLogItemsFromState(state) {
  const listings = Array.isArray(state?.listings) ? state.listings : [];
  const closedListings = Array.isArray(state?.closedListings)
    ? state.closedListings
    : [];
  const sales = Array.isArray(state?.sales) ? state.sales : [];

  return [
    ...listings.map((listing) => ({
      createdAt: listing.createdAt,
      kind: "listing",
      listing,
      txid: listing.listingId,
    })),
    ...closedListings.map((closedListing) => ({
      closedListing,
      createdAt: closedListing.closedAt ?? closedListing.createdAt,
      kind: "closed-listing",
      txid: closedListing.closedTxid || closedListing.listingId,
    })),
    ...sales.map((sale) => ({
      createdAt: sale.createdAt,
      kind: "sale",
      sale,
      txid: sale.txid,
    })),
  ].sort(
    (left, right) =>
      Date.parse(tokenMarketLogItemCreatedAt(right)) -
        Date.parse(tokenMarketLogItemCreatedAt(left)) ||
      Number(tokenMarketLogItemConfirmed(right)) -
        Number(tokenMarketLogItemConfirmed(left)) ||
      tokenMarketLogItemTxid(left).localeCompare(tokenMarketLogItemTxid(right)),
  );
}

function tokenHistoryItemsFromState(state, kind) {
  if (kind === "market-log") {
    return tokenMarketLogItemsFromState(state);
  }
  return Array.isArray(state?.[kind]) ? state[kind] : [];
}

function tokenHistorySnapshotFromState(state, kind) {
  const items = tokenHistoryItemsFromState(state, kind);
  return {
    complete: true,
    consistency: state?.consistency,
    cursor: "0",
    end: items.length,
    indexedAt: state?.indexedAt ?? new Date().toISOString(),
    indexedThroughBlock: state?.indexedThroughBlock,
    items,
    kind,
    ledgerGeneratedAt: state?.ledgerGeneratedAt,
    limit: items.length,
    network: state?.network ?? NETWORK,
    nextCursor: "",
    page: 0,
    pageCount: 1,
    pageSize: items.length,
    query: "",
    snapshotId: state?.snapshotId,
    source: state?.source ?? API_BASE,
    start: 0,
    totalCount: items.length,
  };
}

async function tokenHistorySnapshotsForScope(scope) {
  const state = await readJson(
    endpoint(
      "/api/v1/token",
      scopedTokenSnapshotSourceParams(scope, scope.params),
    ),
  );
  const snapshots = Object.fromEntries(
    TOKEN_HISTORY_SNAPSHOT_KINDS.map((kind) => [
      kind,
      tokenHistorySnapshotFromState(state, kind),
    ]),
  );
  if (REFRESH_SNAPSHOT_SOURCES || REFRESH_TOKEN_SNAPSHOT_SOURCES) {
    try {
      snapshots["market-log"] = await readHistorySnapshot(
        "/api/v1/token-history",
        {
          ...scope.params,
          kind: "market-log",
        },
        (params) => scopedTokenSnapshotSourceParams(scope, params),
      );
    } catch (error) {
      console.error(
        JSON.stringify({
          error: error?.message ?? String(error),
          kind: "market-log",
          phase: "token-history-snapshot",
          scope: scope.key,
        }),
      );
      delete snapshots["market-log"];
    }
  }
  return {
    historyPayloads: snapshots,
    statePayload: state,
  };
}

async function summarySnapshots() {
  const payloads = {};
  for (const source of SUMMARY_SNAPSHOT_SOURCES) {
    try {
      payloads[source.key] = await readJson(
        unpagedEndpoint(source.path, summarySnapshotSourceParams()),
      );
    } catch (error) {
      console.error(
        JSON.stringify({
          error: error?.message ?? String(error),
          phase: "summary-snapshot",
          source: source.key,
        }),
      );
    }
  }
  if (!REFRESH_SUMMARY_SNAPSHOT_SOURCES) {
    return payloads;
  }

  for (const source of SUMMARY_SNAPSHOT_SOURCES) {
    try {
      const currentPayload = await readJson(unpagedEndpoint(source.path));
      payloads[source.key] = strongerSummaryPayload(
        payloads[source.key],
        currentPayload,
      );
    } catch (error) {
      console.error(
        JSON.stringify({
          error: error?.message ?? String(error),
          phase: "summary-snapshot-current",
          source: source.key,
        }),
      );
    }
  }
  return payloads;
}

async function currentSummarySnapshots() {
  const payloads = {};
  for (const source of SUMMARY_SNAPSHOT_SOURCES) {
    try {
      payloads[source.key] = await readJson(unpagedEndpoint(source.path));
    } catch (error) {
      console.error(
        JSON.stringify({
          error: error?.message ?? String(error),
          phase: "summary-snapshot-current-only",
          source: source.key,
        }),
      );
    }
  }
  return payloads;
}

async function registryHistorySnapshots() {
  const entries = [];
  for (const kind of REGISTRY_HISTORY_SNAPSHOT_KINDS) {
    try {
      entries.push([
        kind,
        await readHistorySnapshot("/api/v1/registry-history", { kind }),
      ]);
    } catch (error) {
      console.error(
        JSON.stringify({
          error: error?.message ?? String(error),
          kind,
          phase: "registry-history-snapshot",
        }),
      );
    }
  }
  return Object.fromEntries(entries);
}

async function storedLedgerSnapshotPayload(client, snapshotId = "", options = {}) {
  const requestedSnapshotId = String(snapshotId ?? "").trim();
  const params = [NETWORK];
  const snapshotFilter = requestedSnapshotId
    ? "AND snapshot_id = $2"
    : "AND payload->>'workAmountStorageModel' = $2";
  if (requestedSnapshotId) {
    params.push(requestedSnapshotId);
  } else {
    params.push(WORK_ATOMIC_PROJECTION_MODEL);
  }
  const result = await client.query(
    `
      SELECT payload
      FROM proof_indexer.ledger_snapshots
      WHERE network = $1
      ${snapshotFilter}
      ${options.requireSummaryPayloads ? "AND payload ? 'summaryPayloads'" : ""}
      ORDER BY generated_at DESC
      LIMIT 1
    `,
    params,
  );
  const payload = result.rows[0]?.payload;
  return payload && typeof payload === "object" && !Array.isArray(payload)
    ? payload
    : {};
}

async function activitySnapshot(previousPayload) {
  if (!REFRESH_ACTIVITY_SNAPSHOT && objectPayload(previousPayload?.activityPayload)) {
    return previousPayload.activityPayload;
  }
  try {
    return await readJson(endpoint("/api/v1/log", { fresh: "1" }));
  } catch (error) {
    console.error(
      JSON.stringify({
        error: error?.message ?? String(error),
        phase: "activity-snapshot",
        preservedPrevious: Boolean(previousPayload?.activityPayload),
      }),
    );
    return previousPayload?.activityPayload ?? null;
  }
}

function numberOrNull(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function bigintOrZero(value) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.trunc(number) : 0;
}

function eventKind(item, fallback) {
  const kind = rawEventKind(item, fallback);
  return bondTagForItem(item, kind)?.kind ?? kind;
}

function protocolForItem(item, kind) {
  if (item?.protocol) {
    return String(item.protocol);
  }
  if (kind.startsWith("token") || item?.tokenId || item?.ticker) {
    return "pwt1";
  }
  if (kind.startsWith("id") || item?.id || item?.ownerAddress || item?.receiveAddress) {
    return "pwid1";
  }
  if (kind.startsWith("rush")) {
    return "pwr1";
  }
  if (
    ["mail", "reply", "file", "attachment", "browser"].includes(kind) ||
    Boolean(bondTagForKind(kind))
  ) {
    return "pwm1";
  }
  return "proof";
}

function amountSats(item) {
  return bigintOrZero(
    item?.amountSats ??
      item?.paidSats ??
      item?.priceSats ??
      item?.mintPriceSats ??
      item?.creationFeeSats ??
      item?.mutationFeeSats ??
      item?.feeSats,
  );
}

function dataBytes(item) {
  return bigintOrZero(item?.dataBytes ?? item?.protocolBytes ?? item?.sizeBytes);
}

function subjectOnlyMailBody(value) {
  return /^Subject:\s*/iu.test(String(value ?? "").trim());
}

function mailItemBodyText(item) {
  const direct = normalizedText(item?.body ?? item?.message ?? item?.memo ?? "");
  if (direct) {
    return direct;
  }

  const detail = normalizedText(item?.detail ?? "");
  return detail && !subjectOnlyMailBody(detail) ? detail : null;
}

function addressMailMessageKind(message) {
  const explicit = normalizedLowerText(message?.protocolKind ?? message?.kind);
  if (
    ["mail", "reply", "file", "attachment", "browser"].includes(explicit) ||
    Boolean(bondTagForKind(explicit))
  ) {
    return explicit === "attachment" ? "file" : explicit;
  }
  if (message?.attachment) {
    return "file";
  }
  if (message?.parentTxid) {
    return "reply";
  }
  return bondTagForMemo(message?.memo)?.kind ?? "mail";
}

function normalizedMailRecipients(message, fallbackAddress = "") {
  const recipients = Array.isArray(message?.recipients)
    ? message.recipients
        .map((recipient) => ({
          address: normalizedText(recipient?.address ?? recipient?.display),
          amountSats: bigintOrZero(recipient?.amountSats),
          display: normalizedText(recipient?.display ?? recipient?.address),
        }))
        .filter((recipient) => recipient.address)
    : [];
  if (recipients.length > 0) {
    return recipients;
  }
  const to = normalizedText(message?.to ?? fallbackAddress);
  return to
    ? [
        {
          address: to,
          amountSats: amountSats(message),
          display: to,
        },
      ]
    : [];
}

function addressMailMessageToEvent(message, address, folder) {
  const txid = itemTxid(message);
  if (!txid) {
    return null;
  }
  const kind = addressMailMessageKind(message);
  const recipients = normalizedMailRecipients(message, address);
  const actor = normalizedText(message?.from) || address;
  const counterparty =
    normalizedText(message?.to) ||
    (recipients.length === 1
      ? recipients[0].display || recipients[0].address
      : recipients.length > 1
        ? `${recipients[0].display || recipients[0].address} +${recipients.length - 1}`
        : "Unknown");
  const status = itemStatus(message);
  const memo = normalizedText(message?.memo);
  const detail =
    message?.attachment
      ? `${message.attachment.name ?? "Attachment"}`
      : normalizedText(message?.subject)
        ? `Subject: ${message.subject}`
        : memo || "No message body";
  const totalSats =
    amountSats(message) ||
    recipients.reduce((total, recipient) => total + amountSats(recipient), 0);

  return {
    amountSats: totalSats,
    actor,
    attachment: message?.attachment,
    confirmed: status === "confirmed",
    counterparty,
    createdAt: itemTime(message),
    detail,
    indexedFromMailboxFolder: folder,
    kind,
    memo,
    network: NETWORK,
    parentTxid: message?.parentTxid,
    participants: [
      actor,
      ...recipients.map((recipient) => recipient.address),
    ].filter(Boolean),
    recipients,
    senderAddress: actor,
    status,
    subject: message?.subject,
    title: bondTagForKind(kind)?.label
      ? `${bondTagForKind(kind).label} sent`
      : "Mail sent",
    txid,
  };
}

function addressMailPayloadEvents(payload, address) {
  const events = [
    ...(Array.isArray(payload?.inboxMessages)
      ? payload.inboxMessages.map((message) =>
          addressMailMessageToEvent(message, address, "inbox"),
        )
      : []),
    ...(Array.isArray(payload?.sentMessages)
      ? payload.sentMessages.map((message) =>
          addressMailMessageToEvent(message, address, "sent"),
        )
      : []),
  ].filter(Boolean);
  const byKey = new Map();
  for (const event of events) {
    byKey.set(`${event.kind}:${event.txid}`, event);
  }
  return [...byKey.values()];
}

function stableEventKey({ item, kind, protocol, sourceLabel, txid }) {
  const parts = [
    protocol,
    kind,
    txid,
    item?.listingId,
    item?.tokenId,
    item?.id,
    item?.parentTxid,
    item?.attachmentIndex,
    item?.eventKeyVout,
  ]
    .filter((value) => value !== undefined && value !== null && value !== "")
    .map(String);
  if (parts.length >= 3) {
    return parts.join(":").toLowerCase();
  }
  const digest = createHash("sha256")
    .update(JSON.stringify({ item, sourceLabel }))
    .digest("hex")
    .slice(0, 24);
  return `${sourceLabel}:${digest}`;
}

function participantsForItem(item) {
  const participants = [];
  const add = (address, role, powid = "") => {
    const value = String(address ?? "").trim();
    if (value) {
      participants.push({ address: value, powid: String(powid ?? ""), role });
    }
  };
  for (const address of Array.isArray(item?.participants) ? item.participants : []) {
    add(address, "participant");
  }
  for (const recipient of Array.isArray(item?.recipients)
    ? item.recipients
    : []) {
    add(recipient?.address ?? recipient?.display, "recipient");
  }
  add(item?.address, "address");
  add(item?.actor, "actor");
  add(item?.counterparty, "counterparty");
  add(item?.senderAddress, "sender");
  add(item?.recipientAddress, "recipient");
  add(item?.ownerAddress, "owner", item?.id);
  add(item?.receiveAddress, "receiver", item?.id);
  add(item?.sellerAddress, "seller");
  add(item?.buyerAddress, "buyer");
  add(item?.registryAddress, "registry");
  add(item?.creatorAddress, "creator");
  add(item?.minterAddress, "minter");
  const unique = new Map();
  for (const participant of participants) {
    unique.set(
      `${participant.address}:${participant.role}:${participant.powid}`,
      participant,
    );
  }
  return [...unique.values()];
}

function refsForItem(item) {
  const refs = [];
  const add = (refType, refValue) => {
    const value = String(refValue ?? "").trim();
    if (value) {
      refs.push({ refType, refValue: value });
    }
  };
  add("powid", item?.id);
  add("token-id", item?.tokenId);
  add("ticker", item?.ticker);
  add("listing-id", item?.listingId);
  add("parent-txid", item?.parentTxid);
  add("closed-txid", item?.closedTxid);
  add("seal-txid", item?.sealTxid);
  if (item?.saleTicketTxid && item?.saleTicketVout !== undefined) {
    add("sale-ticket-outpoint", `${item.saleTicketTxid}:${item.saleTicketVout}`);
  }
  return refs;
}

function canonicalOpReturnPayloadFromVout(vout) {
  const scriptHex = String(
    vout?.scriptPubKey?.hex ?? vout?.scriptpubkey ?? "",
  )
    .trim()
    .toLowerCase();
  if (
    scriptHex.length < 2 ||
    scriptHex.length % 2 !== 0 ||
    !/^[0-9a-f]+$/u.test(scriptHex)
  ) {
    return null;
  }

  const script = Buffer.from(scriptHex, "hex");
  if (script[0] !== 0x6a) {
    return null;
  }

  const chunks = [];
  let cursor = 1;
  while (cursor < script.length) {
    const opcode = script[cursor];
    cursor += 1;
    let length;
    if (opcode === 0) {
      length = 0;
    } else if (opcode <= 0x4b) {
      length = opcode;
    } else if (opcode === 0x4c) {
      if (cursor + 1 > script.length) {
        return null;
      }
      length = script[cursor];
      cursor += 1;
    } else if (opcode === 0x4d) {
      if (cursor + 2 > script.length) {
        return null;
      }
      length = script.readUInt16LE(cursor);
      cursor += 2;
    } else if (opcode === 0x4e) {
      if (cursor + 4 > script.length) {
        return null;
      }
      length = script.readUInt32LE(cursor);
      cursor += 4;
    } else {
      return null;
    }
    if (length > script.length - cursor) {
      return null;
    }
    chunks.push(script.subarray(cursor, cursor + length));
    cursor += length;
  }

  const payload = Buffer.concat(chunks);
  if (payload.length === 0) {
    return null;
  }
  const decodedText = payload.toString("utf8");
  const payloadText =
    !decodedText.includes("\u0000") &&
    Buffer.from(decodedText, "utf8").equals(payload)
      ? decodedText
      : null;
  return {
    dataBytes: payload.length,
    payloadHex: payload.toString("hex"),
    payloadText,
  };
}

function canonicalTransactionDetailRows(tx) {
  const txid = String(tx?.txid ?? "").trim().toLowerCase();
  if (!isHexTxid(txid)) {
    throw new Error("Canonical transaction details have an invalid transaction id.");
  }
  if (!Array.isArray(tx?.vin) || tx.vin.length === 0) {
    throw new Error(`Canonical transaction ${txid} has no inputs.`);
  }
  if (!Array.isArray(tx?.vout) || tx.vout.length === 0) {
    throw new Error(`Canonical transaction ${txid} has no outputs.`);
  }

  const safeUnsignedInteger = (value, label, { optional = false } = {}) => {
    if ((value === undefined || value === null || value === "") && optional) {
      return null;
    }
    const numeric = Number(value);
    if (!Number.isSafeInteger(numeric) || numeric < 0) {
      throw new Error(`Canonical transaction ${txid} has an invalid ${label}.`);
    }
    return numeric;
  };
  const safeHex = (value, label, { optional = false } = {}) => {
    if ((value === undefined || value === null || value === "") && optional) {
      return null;
    }
    const hex = String(value ?? "").trim().toLowerCase();
    if (hex.length % 2 !== 0 || !/^[0-9a-f]*$/u.test(hex)) {
      throw new Error(`Canonical transaction ${txid} has an invalid ${label}.`);
    }
    return hex;
  };

  const inputs = tx.vin.map((input, vin) => {
    if (!input || typeof input !== "object") {
      throw new Error(`Canonical transaction ${txid} has an invalid input ${vin}.`);
    }
    const coinbase = typeof input.coinbase === "string";
    const prevTxid = String(input?.txid ?? "").trim().toLowerCase();
    const prevVout = Number(input?.vout);
    const prevout = input?.prevout;
    if (
      !coinbase &&
      (!isHexTxid(prevTxid) ||
        !Number.isSafeInteger(prevVout) ||
        prevVout < 0 ||
        !prevout ||
        !Number.isSafeInteger(Number(prevout?.valueSats)) ||
        Number(prevout.valueSats) < 0)
    ) {
      throw new Error(
        `Canonical transaction ${txid} input ${vin} has incomplete prevout details.`,
      );
    }

    const scriptSigValue =
      input?.scriptSig?.hex ?? input?.scriptsig ?? input?.coinbase;
    const witnessValue = input?.txinwitness ?? input?.witness ?? [];
    if (!Array.isArray(witnessValue)) {
      throw new Error(
        `Canonical transaction ${txid} input ${vin} has an invalid witness.`,
      );
    }
    const witness = witnessValue.map((value, witnessIndex) =>
      safeHex(value, `input ${vin} witness ${witnessIndex}`),
    );
    const address = coinbase ? "" : addressFromVout(prevout).trim();

    return {
      address: address || null,
      prev_txid: coinbase ? null : prevTxid,
      prev_vout: coinbase ? null : prevVout,
      script_sig: safeHex(scriptSigValue, `input ${vin} script signature`, {
        optional: true,
      }),
      sequence: safeUnsignedInteger(input?.sequence, `input ${vin} sequence`, {
        optional: true,
      }),
      value_sats: coinbase ? null : Number(prevout.valueSats),
      vin,
      witness,
    };
  });

  const opReturns = [];
  const outputs = tx.vout.map((vout, index) => {
    if (!vout || typeof vout !== "object") {
      throw new Error(`Canonical transaction ${txid} has an invalid output ${index}.`);
    }
    const declaredVout =
      vout?.n === undefined || vout?.n === null
        ? index
        : safeUnsignedInteger(vout.n, `output ${index} index`);
    if (declaredVout !== index) {
      throw new Error(
        `Canonical transaction ${txid} output ${index} has a mismatched index.`,
      );
    }
    const normalized = prevoutFromOutput(vout);
    if (!normalized) {
      throw new Error(
        `Canonical transaction ${txid} output ${index} is incomplete.`,
      );
    }
    const address = addressFromVout(vout).trim();
    const script = normalized.scriptPubKey;
    const payload = canonicalOpReturnPayloadFromVout(vout);
    if (payload) {
      const prefix = PROTOCOL_PREFIXES.find((candidate) =>
        payload.payloadText?.startsWith(candidate),
      );
      opReturns.push({
        data_bytes: payload.dataBytes,
        output_index: 0,
        payload_hex: payload.payloadHex,
        payload_text: payload.payloadText,
        protocol: prefix ? prefix.slice(0, -1) : null,
        vout: index,
      });
    }
    return {
      address: address || null,
      scriptpubkey: safeHex(script?.hex, `output ${index} script`),
      scriptpubkey_asm: String(script?.asm ?? "").trim() || null,
      scriptpubkey_type: String(script?.type ?? "").trim() || null,
      value_sats: Number(normalized.valueSats),
      vout: index,
    };
  });

  return { inputs, opReturns, outputs };
}

async function persistCanonicalTransactionDetails(
  client,
  tx,
  { details = canonicalTransactionDetailRows(tx), spentAt = null } = {},
) {
  const txid = String(tx?.txid ?? "").trim().toLowerCase();
  if (!isHexTxid(txid)) {
    throw new Error("Canonical transaction details have an invalid transaction id.");
  }
  const inputRows = JSON.stringify(details.inputs);
  if (details.inputs.length > 0) {
    await client.query(
      `
        INSERT INTO proof_indexer.tx_inputs (
          network,
          txid,
          vin,
          prev_txid,
          prev_vout,
          address,
          value_sats,
          sequence,
          script_sig,
          witness
        )
        SELECT
          $1,
          $2,
          input_row.vin,
          input_row.prev_txid,
          input_row.prev_vout,
          input_row.address,
          input_row.value_sats,
          input_row.sequence,
          input_row.script_sig,
          input_row.witness
        FROM jsonb_to_recordset($3::jsonb) AS input_row (
          vin integer,
          prev_txid text,
          prev_vout integer,
          address text,
          value_sats bigint,
          sequence bigint,
          script_sig text,
          witness jsonb
        )
        ON CONFLICT (network, txid, vin)
        DO UPDATE SET
          prev_txid = EXCLUDED.prev_txid,
          prev_vout = EXCLUDED.prev_vout,
          address = EXCLUDED.address,
          value_sats = EXCLUDED.value_sats,
          sequence = EXCLUDED.sequence,
          script_sig = EXCLUDED.script_sig,
          witness = EXCLUDED.witness
      `,
      [NETWORK, txid, inputRows],
    );
  }
  if (details.outputs.length > 0) {
    await client.query(
      `
        INSERT INTO proof_indexer.tx_outputs (
          network,
          txid,
          vout,
          value_sats,
          address,
          scriptpubkey,
          scriptpubkey_asm,
          scriptpubkey_type
        )
        SELECT
          $1,
          $2,
          output_row.vout,
          output_row.value_sats,
          output_row.address,
          output_row.scriptpubkey,
          output_row.scriptpubkey_asm,
          output_row.scriptpubkey_type
        FROM jsonb_to_recordset($3::jsonb) AS output_row (
          vout integer,
          value_sats bigint,
          address text,
          scriptpubkey text,
          scriptpubkey_asm text,
          scriptpubkey_type text
        )
        ON CONFLICT (network, txid, vout)
        DO UPDATE SET
          value_sats = EXCLUDED.value_sats,
          address = EXCLUDED.address,
          scriptpubkey = EXCLUDED.scriptpubkey,
          scriptpubkey_asm = EXCLUDED.scriptpubkey_asm,
          scriptpubkey_type = EXCLUDED.scriptpubkey_type
      `,
      [NETWORK, txid, JSON.stringify(details.outputs)],
    );
  }
  if (details.opReturns.length > 0) {
    await client.query(
      `
        INSERT INTO proof_indexer.op_returns (
          network,
          txid,
          vout,
          output_index,
          protocol,
          payload_text,
          payload_hex,
          data_bytes
        )
        SELECT
          $1,
          $2,
          op_return_row.vout,
          op_return_row.output_index,
          op_return_row.protocol,
          op_return_row.payload_text,
          op_return_row.payload_hex,
          op_return_row.data_bytes
        FROM jsonb_to_recordset($3::jsonb) AS op_return_row (
          vout integer,
          output_index integer,
          protocol text,
          payload_text text,
          payload_hex text,
          data_bytes integer
        )
        ON CONFLICT (network, txid, vout, output_index)
        DO UPDATE SET
          protocol = EXCLUDED.protocol,
          payload_text = EXCLUDED.payload_text,
          payload_hex = EXCLUDED.payload_hex,
          data_bytes = EXCLUDED.data_bytes
      `,
      [NETWORK, txid, JSON.stringify(details.opReturns)],
    );
  }
  if (details.inputs.some((input) => input.prev_txid !== null)) {
    const lockedSpendLinks = await client.query(
      `
        WITH incoming AS (
          SELECT input_row.vin, input_row.prev_txid, input_row.prev_vout
          FROM jsonb_to_recordset($2::jsonb) AS input_row (
            vin integer,
            prev_txid text,
            prev_vout integer
          )
          WHERE input_row.prev_txid IS NOT NULL
            AND input_row.prev_vout IS NOT NULL
        )
        SELECT
          spent_output.txid AS prev_txid,
          spent_output.vout AS prev_vout,
          spent_output.spent_by_txid,
          spent_output.spent_by_vin,
          incoming.vin AS incoming_vin
        FROM proof_indexer.tx_outputs AS spent_output
        JOIN incoming
          ON incoming.prev_txid = spent_output.txid
         AND incoming.prev_vout = spent_output.vout
        WHERE spent_output.network = $1
        FOR UPDATE OF spent_output
      `,
      [NETWORK, inputRows],
    );
    const conflictingSpend = lockedSpendLinks.rows.find((row) => {
      const existingTxid = String(row?.spent_by_txid ?? "")
        .trim()
        .toLowerCase();
      if (!existingTxid) {
        return false;
      }
      return (
        existingTxid !== txid ||
        Number(row?.spent_by_vin) !== Number(row?.incoming_vin)
      );
    });
    if (conflictingSpend) {
      throw new Error(
        `Canonical spend-link conflict for ${conflictingSpend.prev_txid}:${conflictingSpend.prev_vout}; ` +
          `stored ${conflictingSpend.spent_by_txid}:${conflictingSpend.spent_by_vin}, ` +
          `incoming ${txid}:${conflictingSpend.incoming_vin}.`,
      );
    }
    await client.query(
      `
        WITH incoming AS (
          SELECT input_row.vin, input_row.prev_txid, input_row.prev_vout
          FROM jsonb_to_recordset($3::jsonb) AS input_row (
            vin integer,
            prev_txid text,
            prev_vout integer
          )
          WHERE input_row.prev_txid IS NOT NULL
            AND input_row.prev_vout IS NOT NULL
        )
        UPDATE proof_indexer.tx_outputs AS spent_output
        SET
          spent_by_txid = $2,
          spent_by_vin = incoming.vin,
          spent_at = COALESCE(
            $4::timestamptz,
            spent_output.spent_at,
            now()
          )
        FROM incoming
        WHERE spent_output.network = $1
          AND spent_output.txid = incoming.prev_txid
          AND spent_output.vout = incoming.prev_vout
          AND (
            spent_output.spent_by_txid IS NULL
            OR (
              lower(spent_output.spent_by_txid) = $2
              AND spent_output.spent_by_vin IS NOT DISTINCT FROM incoming.vin
            )
          )
      `,
      [NETWORK, txid, inputRows, spentAt],
    );
  }
  return {
    inputs: details.inputs.length,
    opReturns: details.opReturns.length,
    outputs: details.outputs.length,
    txid,
  };
}

async function persistCanonicalBlock(client, block, height, blockHash) {
  const blockTime = Number(block?.time);
  const medianTime = Number(block?.mediantime);
  await client.query(
    `
      INSERT INTO proof_indexer.blocks (
        network,
        block_hash,
        height,
        previous_block_hash,
        block_time,
        median_time,
        tx_count,
        canonical,
        indexed_at
      )
      VALUES ($1, $2, $3, NULLIF($4, ''), $5::timestamptz, $6::timestamptz, $7, true, now())
      ON CONFLICT (network, block_hash)
      DO UPDATE SET
        height = EXCLUDED.height,
        previous_block_hash = EXCLUDED.previous_block_hash,
        block_time = EXCLUDED.block_time,
        median_time = EXCLUDED.median_time,
        tx_count = EXCLUDED.tx_count,
        canonical = true,
        indexed_at = now()
    `,
    [
      NETWORK,
      String(blockHash ?? "").trim().toLowerCase(),
      height,
      String(block?.previousblockhash ?? "").trim().toLowerCase(),
      Number.isFinite(blockTime) && blockTime > 0
        ? new Date(blockTime * 1000).toISOString()
        : null,
      Number.isFinite(medianTime) && medianTime > 0
        ? new Date(medianTime * 1000).toISOString()
        : null,
      Array.isArray(block?.tx) ? block.tx.length : null,
    ],
  );
}

async function persistCanonicalRawTransaction(
  client,
  tx,
  { blockHash, blockTime, height },
) {
  const txid = String(tx?.txid ?? "").trim().toLowerCase();
  if (!isHexTxid(txid)) {
    throw new Error("Canonical block scan produced an invalid transaction id.");
  }
  const canonicalRawTx = {
    ...tx,
    canonicalBlockScan: {
      blockHash: String(blockHash ?? "").trim().toLowerCase(),
      height,
      network: NETWORK,
    },
  };
  const eventTime =
    Number.isFinite(Number(blockTime)) && Number(blockTime) > 0
      ? new Date(Number(blockTime) * 1000).toISOString()
      : itemTime(tx);
  const details = canonicalTransactionDetailRows(tx);
  const coinbase = details.inputs.some(
    (input) => input.prev_txid === null && input.value_sats === null,
  );
  const inputValueSats = coinbase
    ? null
    : details.inputs.reduce((total, input) => {
        if (!Number.isSafeInteger(input.value_sats)) {
          throw new Error(
            `Canonical transaction ${txid} has an input without a value.`,
          );
        }
        return total + input.value_sats;
      }, 0);
  const outputValueSats = coinbase
    ? null
    : details.outputs.reduce(
        (total, output) => total + output.value_sats,
        0,
      );
  const feeSats = coinbase ? null : inputValueSats - outputValueSats;
  if (
    feeSats !== null &&
    (!Number.isSafeInteger(feeSats) || feeSats < 0)
  ) {
    throw new Error(`Canonical transaction ${txid} has an invalid miner fee.`);
  }
  await client.query(
    `
      INSERT INTO proof_indexer.transactions (
        network,
        txid,
        status,
        first_seen_at,
        last_seen_at,
        confirmed_at,
        block_hash,
        block_height,
        block_time,
        fee_sats,
        vsize,
        weight,
        version,
        locktime,
        source,
        raw_tx
      )
      VALUES (
        $1,
        $2,
        'confirmed',
        now(),
        now(),
        COALESCE($3::timestamptz, now()),
        $4,
        $5,
        $3::timestamptz,
        $6,
        $7,
        $8,
        $9,
        $10,
        'canonical-block-scan',
        $11::jsonb
      )
      ON CONFLICT (network, txid)
      DO UPDATE SET
        status = 'confirmed',
        last_seen_at = now(),
        confirmed_at = COALESCE(EXCLUDED.confirmed_at, proof_indexer.transactions.confirmed_at),
        block_hash = EXCLUDED.block_hash,
        block_height = EXCLUDED.block_height,
        block_time = EXCLUDED.block_time,
        fee_sats = EXCLUDED.fee_sats,
        vsize = COALESCE(EXCLUDED.vsize, proof_indexer.transactions.vsize),
        weight = COALESCE(EXCLUDED.weight, proof_indexer.transactions.weight),
        version = COALESCE(EXCLUDED.version, proof_indexer.transactions.version),
        locktime = COALESCE(EXCLUDED.locktime, proof_indexer.transactions.locktime),
        source = EXCLUDED.source,
        raw_tx = EXCLUDED.raw_tx,
        updated_at = now()
    `,
    [
      NETWORK,
      txid,
      eventTime,
      String(blockHash ?? "").trim().toLowerCase(),
      height,
      feeSats,
      numberOrNull(tx?.vsize),
      numberOrNull(tx?.weight),
      numberOrNull(tx?.version),
      numberOrNull(tx?.locktime),
      JSON.stringify(canonicalRawTx),
    ],
  );
  await persistCanonicalTransactionDetails(client, tx, {
    details,
    spentAt: eventTime,
  });
}

function rushElectrumScriptHash() {
  const script = bitcoin.address.toOutputScript(
    RUSH_REGISTRY_ADDRESS,
    bitcoin.networks.bitcoin,
  );
  return Buffer.from(createHash("sha256").update(script).digest())
    .reverse()
    .toString("hex");
}

function rushElectrumHistory() {
  return new Promise((resolve, reject) => {
    const socket = net.createConnection({
      host: RUSH_ELECTRUM_HOST,
      port: RUSH_ELECTRUM_PORT,
    });
    let buffer = "";
    let settled = false;
    const finish = (error, value) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timer);
      socket.destroy();
      if (error) {
        reject(error);
      } else {
        resolve(value);
      }
    };
    const timer = setTimeout(
      () => finish(new Error("RUSH Electrum history discovery timed out.")),
      RUSH_ELECTRUM_TIMEOUT_MS,
    );
    socket.setKeepAlive(true, 30_000);
    socket.setNoDelay(true);
    socket.on("connect", () => {
      socket.write(
        `${JSON.stringify({
          id: "rush-canonical-bootstrap",
          jsonrpc: "2.0",
          method: "blockchain.scripthash.get_history",
          params: [rushElectrumScriptHash()],
        })}\n`,
      );
    });
    socket.on("data", (chunk) => {
      buffer += chunk.toString("utf8");
      if (Buffer.byteLength(buffer, "utf8") > 32 * 1024 * 1024) {
        finish(new Error("RUSH Electrum history exceeded the response limit."));
        return;
      }
      const newline = buffer.indexOf("\n");
      if (newline < 0) {
        return;
      }
      try {
        const response = JSON.parse(buffer.slice(0, newline));
        if (response?.error) {
          finish(
            new Error(
              response.error.message ?? "RUSH Electrum history failed.",
            ),
          );
          return;
        }
        if (!Array.isArray(response?.result)) {
          finish(new Error("RUSH Electrum history returned an invalid result."));
          return;
        }
        finish(null, response.result);
      } catch (error) {
        finish(error);
      }
    });
    socket.on("error", (error) => finish(error));
    socket.on("end", () => {
      if (!settled) {
        finish(new Error("RUSH Electrum history connection ended early."));
      }
    });
  });
}

function canonicalRushHistoryEntries(history, indexedThroughBlock) {
  if (!Number.isSafeInteger(indexedThroughBlock) || indexedThroughBlock <= 0) {
    throw new Error("RUSH discovery requires a positive canonical checkpoint.");
  }
  const entriesByTxid = new Map();
  for (const entry of Array.isArray(history) ? history : []) {
    const txid = String(entry?.tx_hash ?? "").trim().toLowerCase();
    const height = Number(entry?.height);
    if (!isHexTxid(txid) || !Number.isSafeInteger(height)) {
      throw new Error("RUSH Electrum history contains a malformed entry.");
    }
    if (height <= 0 || height > indexedThroughBlock) {
      continue;
    }
    const previous = entriesByTxid.get(txid);
    if (previous !== undefined && previous !== height) {
      throw new Error(`RUSH history has conflicting heights for ${txid}.`);
    }
    entriesByTxid.set(txid, height);
  }
  return [...entriesByTxid]
    .map(([txid, height]) => ({ height, txid }))
    .sort((left, right) => left.height - right.height || left.txid.localeCompare(right.txid));
}

function rushDiscoveryHash(entries) {
  return createHash("sha256").update(JSON.stringify(entries)).digest("hex");
}

async function validRushMintCountThroughHeight(client, height) {
  const result = await client.query(
    `
      SELECT count(*)::int AS count
      FROM proof_indexer.events
      WHERE network = $1
        AND protocol = 'pwr1'
        AND kind = 'rush-mint'
        AND status = 'confirmed'
        AND valid = true
        AND block_height <= $2
    `,
    [NETWORK, height],
  );
  return Number(result.rows[0]?.count ?? 0);
}

async function canonicalRushBootstrapIsComplete(client, checkpoint) {
  const marker = await proofIndexerMetaValue(client, RUSH_BOOTSTRAP_META_KEY);
  if (
    marker?.version !== RUSH_BOOTSTRAP_VERSION ||
    marker?.network !== NETWORK ||
    marker?.registryAddress !== RUSH_REGISTRY_ADDRESS ||
    !Number.isSafeInteger(Number(marker?.indexedThroughBlock)) ||
    Number(marker.indexedThroughBlock) <= 0 ||
    !isHexTxid(marker?.indexedThroughBlockHash) ||
    Number(marker.indexedThroughBlock) > Number(checkpoint?.height) ||
    !Number.isSafeInteger(Number(marker?.mintCount)) ||
    Number(marker.mintCount) < 0
  ) {
    return null;
  }
  const canonicalHash = String(
    await bitcoinRpc("getblockhash", [Number(marker.indexedThroughBlock)]),
  )
    .trim()
    .toLowerCase();
  if (canonicalHash !== marker.indexedThroughBlockHash) {
    return null;
  }
  const mintCount = await validRushMintCountThroughHeight(
    client,
    Number(marker.indexedThroughBlock),
  );
  return mintCount === Number(marker.mintCount)
    ? { ...marker, complete: true }
    : null;
}

async function canonicalRushDiscovery(client, checkpoint) {
  const stored = await proofIndexerMetaValue(client, RUSH_DISCOVERY_META_KEY);
  if (
    stored?.version === RUSH_BOOTSTRAP_VERSION &&
    stored?.network === NETWORK &&
    stored?.registryAddress === RUSH_REGISTRY_ADDRESS &&
    Number.isSafeInteger(Number(stored?.indexedThroughBlock)) &&
    Number(stored.indexedThroughBlock) > 0 &&
    isHexTxid(stored?.indexedThroughBlockHash) &&
    Array.isArray(stored?.entries) &&
    Number.isSafeInteger(Number(stored?.cursor)) &&
    Number(stored.cursor) >= 0 &&
    Number(stored.cursor) <= stored.entries.length &&
    stored?.historyHash === rushDiscoveryHash(stored.entries)
  ) {
    const canonicalHash = String(
      await bitcoinRpc("getblockhash", [Number(stored.indexedThroughBlock)]),
    )
      .trim()
      .toLowerCase();
    if (canonicalHash === stored.indexedThroughBlockHash) {
      return stored;
    }
  }

  const history = await rushElectrumHistory();
  const entries = canonicalRushHistoryEntries(history, checkpoint.height);
  const checkpointHash = String(
    await bitcoinRpc("getblockhash", [checkpoint.height]),
  )
    .trim()
    .toLowerCase();
  if (checkpointHash !== checkpoint.blockHash) {
    throw new Error(
      `RUSH discovery checkpoint ${checkpoint.height} changed before persistence.`,
    );
  }
  const discovery = {
    cursor: 0,
    discoveredAt: new Date().toISOString(),
    entries,
    historyEntryCount: entries.length,
    historyHash: rushDiscoveryHash(entries),
    indexedTransactions: 0,
    indexedThroughBlock: checkpoint.height,
    indexedThroughBlockHash: checkpoint.blockHash,
    network: NETWORK,
    registryAddress: RUSH_REGISTRY_ADDRESS,
    version: RUSH_BOOTSTRAP_VERSION,
  };
  await storeProofIndexerMeta(client, RUSH_DISCOVERY_META_KEY, discovery);
  return discovery;
}

async function canonicalRushBootstrapTransaction(entry, blockCache) {
  const height = Number(entry?.height);
  const txid = String(entry?.txid ?? "").trim().toLowerCase();
  if (!Number.isSafeInteger(height) || height <= 0 || !isHexTxid(txid)) {
    throw new Error("RUSH bootstrap received an invalid history entry.");
  }
  const blockHash = String(await bitcoinRpc("getblockhash", [height]))
    .trim()
    .toLowerCase();
  const raw = await rawTransactionFromCore(txid);
  if (
    !isHexTxid(blockHash) ||
    !raw ||
    Number(raw.confirmations) <= 0 ||
    String(raw.blockhash ?? "").trim().toLowerCase() !== blockHash
  ) {
    throw new Error(`Bitcoin Core rejected RUSH transaction ${txid}.`);
  }
  const messages = protocolMessagesFromTx(raw).filter(
    (message) => message?.prefix === RUSH_PROTOCOL_PREFIX,
  );
  if (messages.length === 0) {
    return null;
  }

  // The registry history contains unrelated payments. Only actual pwr1
  // candidates need a full block envelope, canonical transaction position,
  // and input-prevout hydration.
  if (!blockCache.has(height)) {
    blockCache.set(
      height,
      (async () => {
        const block = await bitcoinRpc("getblock", [blockHash, 1]);
        const txids = Array.isArray(block?.tx) ? block.tx : [];
        if (
          !isHexTxid(blockHash) ||
          String(block?.hash ?? "").trim().toLowerCase() !== blockHash ||
          Number(block?.height) !== height ||
          txids.length === 0 ||
          txids.some((candidate) => !isHexTxid(candidate))
        ) {
          throw new Error(`Bitcoin Core returned an invalid RUSH block ${height}.`);
        }
        return { block, blockHash, txids };
      })(),
    );
  }
  const { block, txids } = await blockCache.get(height);
  const blockIndex = txids.findIndex(
    (candidate) => String(candidate).toLowerCase() === txid,
  );
  if (blockIndex < 0) {
    throw new Error(`RUSH transaction ${txid} is absent from block ${height}.`);
  }
  const hydrated = await transactionWithInputPrevouts({
    ...raw,
    _powBlockHash: blockHash,
    _powBlockIndex: blockIndex,
    _powPreviousBlockHash: String(block?.previousblockhash ?? "")
      .trim()
      .toLowerCase(),
    blocktime: block?.time,
    height,
  });
  assertHydratedProtocolTransaction(hydrated);
  const hydratedMessages = protocolMessagesFromTx(hydrated).filter(
    (message) => message?.prefix === RUSH_PROTOCOL_PREFIX,
  );
  if (
    hydratedMessages.length !== messages.length ||
    hydratedMessages.some(
      (message, index) =>
        message.text !== messages[index]?.text ||
        message.voutIndex !== messages[index]?.voutIndex,
    )
  ) {
    throw new Error(`RUSH transaction ${txid} changed during hydration.`);
  }
  return {
    block,
    blockHash,
    height,
    hydrated,
    items: await preparedProtocolItemsForTx(hydrated, hydratedMessages),
    txid,
  };
}

async function ensureCanonicalRushBootstrap(client) {
  if (!RUSH_BOOTSTRAP_ENABLED || NETWORK !== "livenet") {
    return {
      complete: NETWORK !== "livenet",
      disabled: true,
      source: "rush-canonical-bootstrap",
    };
  }
  const checkpoint = await latestBlockScanCheckpoint(client, {
    useStoredCheckpoint: true,
  });
  if (!Number.isSafeInteger(checkpoint?.height) || !isHexTxid(checkpoint?.blockHash)) {
    throw new Error("RUSH bootstrap requires a canonical block-scan checkpoint.");
  }
  const complete = await canonicalRushBootstrapIsComplete(client, checkpoint);
  if (complete) {
    return {
      complete: true,
      indexedThroughBlock: checkpoint.height,
      mintCount: complete.mintCount,
      source: "rush-canonical-bootstrap",
    };
  }

  let discovery = await canonicalRushDiscovery(client, checkpoint);
  let processedThisRun = 0;
  while (
    discovery.cursor < discovery.entries.length &&
    (RUSH_BOOTSTRAP_MAX_TXIDS === 0 ||
      processedThisRun < RUSH_BOOTSTRAP_MAX_TXIDS)
  ) {
    const remainingBudget =
      RUSH_BOOTSTRAP_MAX_TXIDS === 0
        ? RUSH_BOOTSTRAP_BATCH_SIZE
        : Math.min(
            RUSH_BOOTSTRAP_BATCH_SIZE,
            RUSH_BOOTSTRAP_MAX_TXIDS - processedThisRun,
          );
    const entries = discovery.entries.slice(
      discovery.cursor,
      discovery.cursor + remainingBudget,
    );
    const blockCache = new Map();
    const prepared = await mapWithConcurrency(
      entries,
      PREVOUT_HYDRATION_CONCURRENCY,
      (entry) => canonicalRushBootstrapTransaction(entry, blockCache),
    );
    const canonicalAtCommit = String(
      await bitcoinRpc("getblockhash", [discovery.indexedThroughBlock]),
    )
      .trim()
      .toLowerCase();
    if (canonicalAtCommit !== discovery.indexedThroughBlockHash) {
      throw new Error("RUSH bootstrap checkpoint changed before batch commit.");
    }

    await client.query("BEGIN");
    try {
      let indexedTransactions = Number(discovery.indexedTransactions) || 0;
      for (const item of prepared.filter(Boolean)) {
        await persistCanonicalBlock(
          client,
          item.block,
          item.height,
          item.blockHash,
        );
        await persistCanonicalRawTransaction(client, item.hydrated, {
          blockHash: item.blockHash,
          blockTime: item.block?.time,
          height: item.height,
        });
        await persistPreparedProtocolItems(client, item.items);
        indexedTransactions += 1;
      }
      discovery = {
        ...discovery,
        cursor: discovery.cursor + entries.length,
        indexedTransactions,
        updatedAt: new Date().toISOString(),
      };
      await storeProofIndexerMeta(client, RUSH_DISCOVERY_META_KEY, discovery);
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    }
    processedThisRun += entries.length;
    console.log(
      JSON.stringify({
        cursor: discovery.cursor,
        historyEntryCount: discovery.entries.length,
        indexedTransactions: discovery.indexedTransactions,
        phase: "rush-canonical-bootstrap",
      }),
    );
  }

  if (discovery.cursor < discovery.entries.length) {
    return {
      complete: false,
      cursor: discovery.cursor,
      historyEntryCount: discovery.entries.length,
      indexedTransactions: discovery.indexedTransactions,
      source: "rush-canonical-bootstrap",
    };
  }

  const canonicalHash = String(
    await bitcoinRpc("getblockhash", [discovery.indexedThroughBlock]),
  )
    .trim()
    .toLowerCase();
  if (canonicalHash !== discovery.indexedThroughBlockHash) {
    throw new Error("RUSH bootstrap checkpoint changed before completion.");
  }
  const mintCount = await validRushMintCountThroughHeight(
    client,
    discovery.indexedThroughBlock,
  );
  const marker = {
    completedAt: new Date().toISOString(),
    historyEntryCount: discovery.historyEntryCount,
    historyHash: discovery.historyHash,
    indexedThroughBlock: discovery.indexedThroughBlock,
    indexedThroughBlockHash: discovery.indexedThroughBlockHash,
    indexedTransactions: discovery.indexedTransactions,
    mintCount,
    network: NETWORK,
    registryAddress: RUSH_REGISTRY_ADDRESS,
    version: RUSH_BOOTSTRAP_VERSION,
  };
  const checkpointBlock = await bitcoinRpc("getblock", [canonicalHash, 1]);
  if (
    String(checkpointBlock?.hash ?? "").trim().toLowerCase() !== canonicalHash ||
    Number(checkpointBlock?.height) !== discovery.indexedThroughBlock
  ) {
    throw new Error("Bitcoin Core returned an invalid RUSH completion block.");
  }
  await client.query("BEGIN");
  try {
    await persistCanonicalBlock(
      client,
      checkpointBlock,
      discovery.indexedThroughBlock,
      canonicalHash,
    );
    await storeProofIndexerMeta(client, RUSH_BOOTSTRAP_META_KEY, marker);
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  }
  return {
    complete: true,
    indexedThroughBlock: checkpoint.height,
    mintCount,
    source: "rush-canonical-bootstrap",
  };
}

async function hydrateHistoricalCanonicalTransactionDetails(client) {
  let afterHeight = TX_DETAIL_HYDRATION_AFTER_HEIGHT;
  let afterBlockIndex = TX_DETAIL_HYDRATION_AFTER_BLOCK_INDEX;
  let afterTxid = TX_DETAIL_HYDRATION_AFTER_TXID;
  let batches = 0;
  let hydrated = 0;
  let inputs = 0;
  let opReturns = 0;
  let outputs = 0;
  let limitReached = false;

  while (hydrated < TX_DETAIL_HYDRATION_MAX_ROWS) {
    const limit = Math.min(
      TX_DETAIL_HYDRATION_BATCH_SIZE,
      TX_DETAIL_HYDRATION_MAX_ROWS - hydrated,
    );
    const result = await client.query(
      `
        WITH candidates AS (
          SELECT
            transaction_row.txid,
            transaction_row.block_hash,
            transaction_row.block_height,
            transaction_row.block_time,
            transaction_row.raw_tx,
            canonical_block.block_hash AS canonical_block_hash,
            canonical_block.canonical AS block_canonical,
            CASE
              WHEN transaction_row.raw_tx->>'_powBlockIndex' ~ '^[0-9]+$'
                THEN (transaction_row.raw_tx->>'_powBlockIndex')::integer
              ELSE -1
            END AS block_index
          FROM proof_indexer.transactions AS transaction_row
          JOIN proof_indexer.blocks AS canonical_block
            ON canonical_block.network = transaction_row.network
           AND canonical_block.block_hash = transaction_row.block_hash
           AND canonical_block.height = transaction_row.block_height
           AND canonical_block.canonical = true
          WHERE transaction_row.network = $1
            AND transaction_row.status = 'confirmed'
            AND transaction_row.block_height IS NOT NULL
            AND transaction_row.block_hash IS NOT NULL
            AND jsonb_typeof(transaction_row.raw_tx) = 'object'
            AND jsonb_typeof(transaction_row.raw_tx->'vin') = 'array'
            AND jsonb_typeof(transaction_row.raw_tx->'vout') = 'array'
            AND jsonb_typeof(transaction_row.raw_tx->'canonicalBlockScan') = 'object'
            AND transaction_row.raw_tx->'canonicalBlockScan'->>'network' = $1
            AND transaction_row.raw_tx->'canonicalBlockScan'->>'height' ~ '^[0-9]+$'
            AND (transaction_row.raw_tx->'canonicalBlockScan'->>'height')::integer =
              transaction_row.block_height
            AND transaction_row.raw_tx->'canonicalBlockScan'->>'blockHash' ~
              '^[0-9a-fA-F]{64}$'
            AND lower(transaction_row.raw_tx->'canonicalBlockScan'->>'blockHash') =
              lower(transaction_row.block_hash)
        )
        SELECT
          txid,
          block_hash,
          block_height,
          block_time,
          block_index,
          raw_tx,
          canonical_block_hash,
          block_canonical
        FROM candidates
        WHERE block_index >= 0
          AND (block_height, block_index, txid) >
            ($2::integer, $3::integer, $4::text)
        ORDER BY block_height, block_index, txid
        LIMIT $5
      `,
      [NETWORK, afterHeight, afterBlockIndex, afterTxid, limit],
    );
    if (result.rows.length === 0) {
      break;
    }

    const prepared = result.rows.map((row) => {
      const tx = row?.raw_tx;
      const txid = String(row?.txid ?? "").trim().toLowerCase();
      const blockHash = String(row?.block_hash ?? "").trim().toLowerCase();
      const canonicalBlockHash = String(row?.canonical_block_hash ?? "")
        .trim()
        .toLowerCase();
      const blockHeight = Number(row?.block_height);
      const blockIndex = Number(row?.block_index);
      if (
        !tx ||
        typeof tx !== "object" ||
        String(tx?.txid ?? "").trim().toLowerCase() !== txid ||
        !isHexTxid(txid) ||
        !Number.isSafeInteger(blockHeight) ||
        blockHeight < 0 ||
        row?.block_canonical !== true ||
        !isHexTxid(blockHash) ||
        canonicalBlockHash !== blockHash ||
        String(tx?.canonicalBlockScan?.blockHash ?? "")
          .trim()
          .toLowerCase() !== blockHash ||
        Number(tx?.canonicalBlockScan?.height) !== blockHeight ||
        String(tx?.canonicalBlockScan?.network ?? "") !== NETWORK ||
        !Number.isSafeInteger(blockIndex) ||
        blockIndex < 0 ||
        Number(tx?._powBlockIndex) !== blockIndex
      ) {
        throw new Error(
          `Stored canonical transaction detail envelope is invalid for ${txid || "unknown"}.`,
        );
      }
      assertHydratedProtocolTransaction(tx);
      if (protocolMessagesFromTx(tx).length === 0) {
        throw new Error(
          `Stored canonical transaction ${txid} has no recognized protocol output.`,
        );
      }
      return {
        blockHeight,
        blockIndex,
        details: canonicalTransactionDetailRows(tx),
        spentAt: row?.block_time ?? itemTime(tx),
        tx,
        txid,
      };
    });

    await client.query("BEGIN");
    try {
      for (const item of prepared) {
        const persisted = await persistCanonicalTransactionDetails(
          client,
          item.tx,
          { details: item.details, spentAt: item.spentAt },
        );
        hydrated += 1;
        inputs += persisted.inputs;
        opReturns += persisted.opReturns;
        outputs += persisted.outputs;
      }
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    }

    batches += 1;
    const last = prepared.at(-1);
    afterHeight = last.blockHeight;
    afterBlockIndex = last.blockIndex;
    afterTxid = last.txid;
    if (result.rows.length < limit) {
      break;
    }
    if (hydrated >= TX_DETAIL_HYDRATION_MAX_ROWS) {
      limitReached = true;
      break;
    }
  }

  return {
    batches,
    cursor: {
      afterBlockIndex,
      afterHeight,
      afterTxid,
    },
    hydrated,
    inputs,
    limitReached,
    opReturns,
    outputs,
    source: "historical-canonical-transaction-details",
  };
}

async function upsertTransaction(client, item, txid, status, sourceLabel) {
  const eventTime = itemTime(item);
  await client.query(
    `
      INSERT INTO proof_indexer.transactions (
        network,
        txid,
        status,
        first_seen_at,
        last_seen_at,
        confirmed_at,
        block_height,
        block_time,
        source,
        raw_tx
      )
      VALUES (
        $1,
        $2,
        $3,
        now(),
        now(),
        CASE WHEN $3 = 'confirmed' THEN COALESCE($4::timestamptz, now()) ELSE NULL END,
        CASE WHEN $3 = 'confirmed' THEN $5::integer ELSE NULL END,
        CASE WHEN $3 = 'confirmed' THEN $4::timestamptz ELSE NULL END,
        $6,
        $7::jsonb
      )
      ON CONFLICT (network, txid)
      DO UPDATE SET
        status = CASE
          WHEN proof_indexer.transactions.raw_tx ? 'canonicalBlockScan'
            AND proof_indexer.transactions.status = 'confirmed'
          THEN proof_indexer.transactions.status
          ELSE EXCLUDED.status
        END,
        last_seen_at = now(),
        confirmed_at = CASE
          WHEN proof_indexer.transactions.raw_tx ? 'canonicalBlockScan'
            THEN proof_indexer.transactions.confirmed_at
          WHEN EXCLUDED.status = 'confirmed'
            THEN COALESCE(proof_indexer.transactions.confirmed_at, EXCLUDED.confirmed_at)
          ELSE NULL
        END,
        dropped_at = CASE
          WHEN EXCLUDED.status IN ('pending', 'confirmed') THEN NULL
          ELSE proof_indexer.transactions.dropped_at
        END,
        dropped_reason = CASE
          WHEN EXCLUDED.status IN ('pending', 'confirmed') THEN NULL
          ELSE proof_indexer.transactions.dropped_reason
        END,
        replaced_by_txid = CASE
          WHEN EXCLUDED.status IN ('pending', 'confirmed') THEN NULL
          ELSE proof_indexer.transactions.replaced_by_txid
        END,
        block_height = CASE
          WHEN proof_indexer.transactions.raw_tx ? 'canonicalBlockScan'
            THEN proof_indexer.transactions.block_height
          WHEN EXCLUDED.status = 'confirmed'
            THEN COALESCE(EXCLUDED.block_height, proof_indexer.transactions.block_height)
          ELSE NULL
        END,
        block_time = CASE
          WHEN proof_indexer.transactions.raw_tx ? 'canonicalBlockScan'
            THEN proof_indexer.transactions.block_time
          WHEN EXCLUDED.status = 'confirmed'
            THEN COALESCE(EXCLUDED.block_time, proof_indexer.transactions.block_time)
          ELSE NULL
        END,
        source = CASE
          WHEN proof_indexer.transactions.raw_tx ? 'canonicalBlockScan'
            THEN proof_indexer.transactions.source
          ELSE COALESCE(EXCLUDED.source, proof_indexer.transactions.source)
        END,
        raw_tx = CASE
          WHEN proof_indexer.transactions.raw_tx ? 'canonicalBlockScan'
            THEN proof_indexer.transactions.raw_tx
          WHEN EXCLUDED.status IN ('pending', 'confirmed')
            THEN COALESCE(
              proof_indexer.transactions.raw_tx,
              EXCLUDED.raw_tx,
              '{}'::jsonb
            ) - 'statusObservation'
          ELSE COALESCE(proof_indexer.transactions.raw_tx, EXCLUDED.raw_tx)
        END,
        updated_at = now()
    `,
    [
      NETWORK,
      txid,
      status,
      eventTime,
      numberOrNull(item?.blockHeight ?? item?.height),
      sourceLabel,
      JSON.stringify({ indexedFrom: sourceLabel, item }),
    ],
  );
}

async function upsertEvent(client, sourceLabel, item) {
  const txid = itemTxid(item);
  const status = itemStatus(item);
  if (!txid) {
    await upsertProjection(client, sourceLabel, item, status);
    return { projected: true, skipped: true };
  }

  const kind = eventKind(item, sourceLabel);
  const normalizedItem = workProjectionItem(
    normalizedEventItem(item, kind, status),
    { strict: item?.valid !== false },
  );
  const indexedInput = {
    ...normalizedItem,
    participants: [
      ...new Set([
        ...(Array.isArray(normalizedItem?.participants)
          ? normalizedItem.participants
          : []),
        normalizedItem?.actor,
        normalizedItem?.counterparty,
        normalizedItem?.senderAddress,
        normalizedItem?.recipientAddress,
        normalizedItem?.ownerAddress,
        normalizedItem?.receiveAddress,
        normalizedItem?.sellerAddress,
        normalizedItem?.buyerAddress,
      ].filter(Boolean)),
    ],
  };
  const protocol = protocolForItem(item, kind);
  const eventKey = stableEventKey({
    item: indexedInput,
    kind: stableEventKeyKind(item, kind, sourceLabel),
    protocol,
    sourceLabel,
    txid,
  });
  const eventTime = itemTime(indexedInput);

  await upsertTransaction(client, indexedInput, txid, status, sourceLabel);

  const result = await client.query(
    `
      INSERT INTO proof_indexer.events (
        network,
        event_key,
        txid,
        protocol,
        kind,
        status,
        valid,
        validation_errors,
        amount_sats,
        data_bytes,
        block_height,
        block_time,
        event_time,
        raw_payload,
        payload
      )
      VALUES (
        $1,
        $2,
        $3,
        $4,
        $5,
        $6,
        $7,
        $8::text[],
        $9,
        $10,
        $11,
        $12::timestamptz,
        $13::timestamptz,
        $14,
        $15::jsonb
      )
      ON CONFLICT (network, event_key)
      DO UPDATE SET
        status = EXCLUDED.status,
        valid = EXCLUDED.valid,
        validation_errors = EXCLUDED.validation_errors,
        amount_sats = EXCLUDED.amount_sats,
        data_bytes = EXCLUDED.data_bytes,
        block_height = CASE
          WHEN EXCLUDED.status = 'confirmed'
            THEN COALESCE(EXCLUDED.block_height, proof_indexer.events.block_height)
          ELSE NULL
        END,
        block_time = CASE
          WHEN EXCLUDED.status = 'confirmed'
            THEN COALESCE(EXCLUDED.block_time, proof_indexer.events.block_time)
          ELSE NULL
        END,
        event_time = CASE
          WHEN EXCLUDED.status = 'confirmed'
            THEN COALESCE(EXCLUDED.block_time, EXCLUDED.event_time, proof_indexer.events.event_time)
          WHEN proof_indexer.events.status = 'pending'
            AND proof_indexer.events.event_time >= TIMESTAMPTZ '2009-01-03 18:15:05+00'
          THEN proof_indexer.events.event_time
          ELSE COALESCE(EXCLUDED.event_time, proof_indexer.events.event_time)
        END,
        raw_payload = EXCLUDED.raw_payload,
        payload =
          (proof_indexer.events.payload || EXCLUDED.payload)
          || jsonb_strip_nulls(
            jsonb_build_object(
              'senderAddress', COALESCE(
                NULLIF(EXCLUDED.payload->>'senderAddress', ''),
                NULLIF(proof_indexer.events.payload->>'senderAddress', '')
              ),
              'actor', COALESCE(
                NULLIF(EXCLUDED.payload->>'actor', ''),
                NULLIF(proof_indexer.events.payload->>'actor', '')
              ),
              'counterparty', COALESCE(
                NULLIF(EXCLUDED.payload->>'counterparty', ''),
                NULLIF(proof_indexer.events.payload->>'counterparty', '')
              ),
              'recipientAddress', COALESCE(
                NULLIF(EXCLUDED.payload->>'recipientAddress', ''),
                NULLIF(proof_indexer.events.payload->>'recipientAddress', '')
              ),
              'ownerAddress', COALESCE(
                NULLIF(EXCLUDED.payload->>'ownerAddress', ''),
                NULLIF(proof_indexer.events.payload->>'ownerAddress', '')
              ),
              'receiveAddress', COALESCE(
                NULLIF(EXCLUDED.payload->>'receiveAddress', ''),
                NULLIF(proof_indexer.events.payload->>'receiveAddress', '')
              ),
              'sellerAddress', COALESCE(
                NULLIF(EXCLUDED.payload->>'sellerAddress', ''),
                NULLIF(proof_indexer.events.payload->>'sellerAddress', '')
              ),
              'buyerAddress', COALESCE(
                NULLIF(EXCLUDED.payload->>'buyerAddress', ''),
                NULLIF(proof_indexer.events.payload->>'buyerAddress', '')
              ),
              'participants', CASE
                WHEN NULLIF(EXCLUDED.payload->>'senderAddress', '') IS NULL
                  AND NULLIF(proof_indexer.events.payload->>'senderAddress', '') IS NOT NULL
                THEN COALESCE(
                  proof_indexer.events.payload->'participants',
                  EXCLUDED.payload->'participants',
                  '[]'::jsonb
                )
                ELSE COALESCE(
                  EXCLUDED.payload->'participants',
                  proof_indexer.events.payload->'participants',
                  '[]'::jsonb
                )
              END
            )
          ),
        updated_at = now()
      WHERE NOT (
        proof_indexer.events.status = 'confirmed'
        AND EXCLUDED.status <> 'confirmed'
        AND EXISTS (
          SELECT 1
          FROM proof_indexer.transactions canonical_transaction
          JOIN proof_indexer.blocks canonical_block
            ON canonical_block.network = canonical_transaction.network
           AND canonical_block.block_hash = canonical_transaction.block_hash
           AND canonical_block.height = canonical_transaction.block_height
           AND canonical_block.canonical = true
          WHERE canonical_transaction.network = proof_indexer.events.network
            AND canonical_transaction.txid = proof_indexer.events.txid
            AND canonical_transaction.status = 'confirmed'
            AND canonical_transaction.raw_tx ? 'canonicalBlockScan'
        )
      )
      RETURNING event_id, payload, status
    `,
    [
      NETWORK,
      eventKey,
      txid,
      protocol,
      kind,
      status,
      indexedInput?.valid !== false && !String(kind).includes("invalid"),
      indexedInput?.reason ? [String(indexedInput.reason)] : [],
      amountSats(indexedInput),
      dataBytes(indexedInput),
      status === "confirmed"
        ? numberOrNull(indexedInput?.blockHeight ?? indexedInput?.height)
        : null,
      status === "confirmed" ? eventTime : null,
      eventTime,
      indexedInput?.payload ? String(indexedInput.payload) : "",
      JSON.stringify({ ...indexedInput, indexedFrom: sourceLabel }),
    ],
  );
  if (result.rows.length === 0) {
    return { canonicalConfirmed: true, skipped: true };
  }
  const eventId = result.rows[0].event_id;
  const indexedItem = result.rows[0].payload ?? indexedInput;
  const indexedStatus = itemStatus({ status: result.rows[0].status });

  await client.query("DELETE FROM proof_indexer.event_participants WHERE event_id = $1", [
    eventId,
  ]);
  for (const participant of participantsForItem(indexedItem)) {
    await client.query(
      `
        INSERT INTO proof_indexer.event_participants (event_id, address, role, powid)
        VALUES ($1, $2, $3, NULLIF($4, ''))
        ON CONFLICT DO NOTHING
      `,
      [eventId, participant.address, participant.role, participant.powid],
    );
  }

  await client.query("DELETE FROM proof_indexer.event_refs WHERE event_id = $1", [
    eventId,
  ]);
  for (const ref of refsForItem(indexedItem)) {
    await client.query(
      `
        INSERT INTO proof_indexer.event_refs (event_id, ref_type, ref_value)
        VALUES ($1, $2, $3)
        ON CONFLICT DO NOTHING
      `,
      [eventId, ref.refType, ref.refValue],
    );
  }

  if (indexedItem?.valid !== false) {
    await upsertProjection(client, sourceLabel, indexedItem, indexedStatus);
  }
  return { skipped: false };
}

async function upsertProjection(client, sourceLabel, item, status) {
  const projectionKind = eventKind(item, sourceLabel);
  if (
    projectionKind === "id-register" &&
    item?.id &&
    item?.ownerAddress &&
    status === "confirmed"
  ) {
    await client.query(
      `
        INSERT INTO proof_indexer.id_records (
          network,
          id_lower,
          display_id,
          owner_address,
          receive_address,
          pgp_public_key,
          registration_txid,
          last_event_txid,
          registered_height,
          updated_height,
          updated_at
        )
        VALUES ($1, lower($2), $2, $3, $4, $5, $6, $6, $7, $7, now())
        ON CONFLICT (network, id_lower)
        DO NOTHING
      `,
      [
        NETWORK,
        String(item.id),
        item.ownerAddress,
        item.receiveAddress ?? item.ownerAddress,
        item.pgpPublicKey ?? null,
        item.txid,
        numberOrNull(item.blockHeight ?? item.height),
      ],
    );
  }

  if (
    ["id-update", "id-transfer", "id-buy"].includes(projectionKind) &&
    item?.id &&
    status === "confirmed"
  ) {
    await client.query(
      `
        UPDATE proof_indexer.id_records
        SET
          display_id = COALESCE(NULLIF($2, ''), display_id),
          owner_address = COALESCE(NULLIF($3, ''), owner_address),
          receive_address = COALESCE(NULLIF($4, ''), receive_address),
          pgp_public_key = COALESCE(NULLIF($5, ''), pgp_public_key),
          last_event_txid = $6,
          updated_height = COALESCE($7, updated_height),
          updated_at = now()
        WHERE network = $1
          AND id_lower = lower($2)
      `,
      [
        NETWORK,
        String(item.id),
        item.ownerAddress ?? item.actor ?? "",
        item.receiveAddress ?? item.ownerAddress ?? item.actor ?? "",
        item.pgpPublicKey ?? "",
        item.txid,
        numberOrNull(item.blockHeight ?? item.height),
      ],
    );
  }

  if (sourceLabel === "tokens" && item?.tokenId && item?.ticker) {
    const atomicReady =
      isWorkTokenId(item.tokenId) &&
      await workAtomicProjectionReady(client);
    const workStorage = atomicReady
      ? workDefinitionStorage(item)
      : null;
    const definitionPayload =
      workStorage?.metadata ??
      (isWorkTokenId(item.tokenId)
        ? legacyWorkDefinitionPayload(item)
        : item);
    await client.query(
      `
        INSERT INTO proof_indexer.credit_definitions (
          network,
          token_id,
          ticker,
          creator_address,
          registry_address,
          max_supply,
          mint_amount,
          mint_price_sats,
          create_txid,
          confirmed,
          created_height,
          metadata
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12::jsonb)
        ON CONFLICT (network, token_id)
        DO UPDATE SET
          ticker = EXCLUDED.ticker,
          creator_address = EXCLUDED.creator_address,
          registry_address = EXCLUDED.registry_address,
          max_supply = EXCLUDED.max_supply,
          mint_amount = EXCLUDED.mint_amount,
          mint_price_sats = EXCLUDED.mint_price_sats,
          confirmed = EXCLUDED.confirmed,
          created_height = COALESCE(EXCLUDED.created_height, proof_indexer.credit_definitions.created_height),
          metadata = EXCLUDED.metadata
      `,
      [
        NETWORK,
        definitionPayload.tokenId,
        definitionPayload.ticker,
        definitionPayload.creatorAddress ?? null,
        definitionPayload.registryAddress,
        workStorage?.maxSupplyAtoms ?? String(definitionPayload.maxSupply ?? 0),
        workStorage?.mintAmountAtoms ?? String(definitionPayload.mintAmount ?? 0),
        bigintOrZero(definitionPayload.mintPriceSats),
        definitionPayload.txid ?? definitionPayload.tokenId,
        status === "confirmed",
        numberOrNull(definitionPayload.blockHeight ?? definitionPayload.height),
        JSON.stringify(definitionPayload),
      ],
    );
  }

  if (sourceLabel === "token-holders" && item?.tokenId && item?.address) {
    const atomicReady =
      isWorkTokenId(item.tokenId) &&
      await workAtomicProjectionReady(client);
    const workBalance = atomicReady
      ? workBalanceAtoms(item, [
          "balanceAtoms",
          "confirmedBalanceAtoms",
          "balance",
          "confirmedBalance",
        ])
      : isWorkTokenId(item.tokenId)
        ? legacyWholeWorkAmount(item, ["balance", "confirmedBalance"])
        : String(item.balance ?? item.confirmedBalance ?? 0);
    const workPendingDelta = atomicReady
      ? workBalanceAtoms(
          item,
          [
            "pendingDeltaAtoms",
            "pendingBalanceAtoms",
            "pendingDelta",
            "pendingBalance",
          ],
          { signed: true },
        )
      : isWorkTokenId(item.tokenId)
        ? legacyWholeWorkAmount(
            item,
            ["pendingDelta", "pendingBalance"],
            { signed: true },
          )
        : String(item.pendingDelta ?? item.pendingBalance ?? 0);
    await client.query(
      `
        INSERT INTO proof_indexer.credit_balances (
          network,
          token_id,
          address,
          confirmed_balance,
          pending_delta,
          updated_at
        )
        VALUES ($1, $2, $3, $4, $5, now())
        ON CONFLICT (network, token_id, address)
        DO UPDATE SET
          confirmed_balance = EXCLUDED.confirmed_balance,
          pending_delta = EXCLUDED.pending_delta,
          updated_at = now()
      `,
      [
        NETWORK,
        item.tokenId,
        item.address,
        workBalance,
        workPendingDelta,
      ],
    );
  }

  const projectsCreditListing =
    ["token-listings", "token-closed-listings", "token-sales"].includes(
      sourceLabel,
    ) ||
    projectionKind === "token-sale" ||
    projectionKind === "token-listing-closed" ||
    projectionKind === "closed-listing";
  if (projectsCreditListing && item?.listingId && item?.tokenId) {
    const projectedStatus = listingStatus(item, sourceLabel);
    const atomicItem = workProjectionItem(item);
    const atomicReady =
      isWorkTokenId(atomicItem.tokenId) &&
      await workAtomicProjectionReady(client);
    const projectedPayload = creditListingProjectionPayload(
      atomicItem,
      projectedStatus,
    );
    await client.query(
      `
        INSERT INTO proof_indexer.credit_listings (
          network,
          listing_id,
          token_id,
          status,
          seller_address,
          buyer_address,
          amount,
          price_sats,
          sale_ticket_txid,
          sale_ticket_vout,
          sale_ticket_value_sats,
          seal_txid,
          close_txid,
          payload,
          updated_at
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14::jsonb, now())
        ON CONFLICT (network, listing_id)
        DO UPDATE SET
          status = EXCLUDED.status,
          seller_address = EXCLUDED.seller_address,
          buyer_address = COALESCE(EXCLUDED.buyer_address, proof_indexer.credit_listings.buyer_address),
          amount = EXCLUDED.amount,
          price_sats = EXCLUDED.price_sats,
          sale_ticket_txid = COALESCE(EXCLUDED.sale_ticket_txid, proof_indexer.credit_listings.sale_ticket_txid),
          sale_ticket_vout = COALESCE(EXCLUDED.sale_ticket_vout, proof_indexer.credit_listings.sale_ticket_vout),
          sale_ticket_value_sats = COALESCE(EXCLUDED.sale_ticket_value_sats, proof_indexer.credit_listings.sale_ticket_value_sats),
          seal_txid = COALESCE(NULLIF(EXCLUDED.seal_txid, ''), proof_indexer.credit_listings.seal_txid),
          close_txid = COALESCE(NULLIF(EXCLUDED.close_txid, ''), proof_indexer.credit_listings.close_txid),
          payload = proof_indexer.credit_listings.payload || EXCLUDED.payload,
          updated_at = now()
      `,
      [
        NETWORK,
        atomicItem.listingId,
        atomicItem.tokenId,
        projectedStatus,
        atomicItem.sellerAddress ?? "",
        atomicItem.buyerAddress ?? null,
        atomicReady
          ? atomicItem.amountAtoms
          : isWorkTokenId(atomicItem.tokenId)
            ? legacyWholeWorkAmount(atomicItem, ["amount"])
            : String(atomicItem.amount ?? 0),
        bigintOrZero(atomicItem.priceSats),
        atomicItem.saleTicketTxid ??
          atomicItem.saleAuthorization?.saleTicketTxid ??
          null,
        numberOrNull(
          atomicItem.saleTicketVout ??
            atomicItem.saleAuthorization?.saleTicketVout,
        ),
        bigintOrZero(
          atomicItem.saleTicketValueSats ??
            atomicItem.saleAuthorization?.saleTicketValueSats,
        ),
        atomicItem.sealTxid ?? null,
        creditListingCloseTxid(
          atomicItem,
          projectedStatus,
          projectionKind,
          sourceLabel,
        ),
        JSON.stringify(projectedPayload),
      ],
    );
  }

  if (
    ["mail", "reply", "file", "attachment", "browser"].includes(
      projectionKind,
    ) || Boolean(bondTagForKind(projectionKind))
  ) {
    const txid = itemTxid(item);
    if (txid) {
      await client.query(
        `
          INSERT INTO proof_indexer.mail_items (
            network,
            txid,
            status,
            sender_address,
            subject,
            parent_txid,
            body_text,
            amount_sats,
            data_bytes,
            message,
            event_time
          )
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::jsonb, $11::timestamptz)
          ON CONFLICT (network, txid)
          DO UPDATE SET
            status = EXCLUDED.status,
            sender_address = COALESCE(EXCLUDED.sender_address, proof_indexer.mail_items.sender_address),
            subject = COALESCE(EXCLUDED.subject, proof_indexer.mail_items.subject),
            parent_txid = COALESCE(EXCLUDED.parent_txid, proof_indexer.mail_items.parent_txid),
            body_text = COALESCE(EXCLUDED.body_text, proof_indexer.mail_items.body_text),
            amount_sats = EXCLUDED.amount_sats,
            data_bytes = EXCLUDED.data_bytes,
            message = EXCLUDED.message,
            event_time = COALESCE(EXCLUDED.event_time, proof_indexer.mail_items.event_time)
        `,
        [
          NETWORK,
          txid,
          status,
          item.senderAddress ?? null,
          item.subject ?? null,
          item.parentTxid ?? null,
          mailItemBodyText(item),
          amountSats(item),
          dataBytes(item),
          JSON.stringify(item),
          itemTime(item),
        ],
      );
    }
  }
}

function listingStatus(item, sourceLabel) {
  const kind = eventKind(item, sourceLabel);
  if (item?.dropped) {
    return "dropped";
  }
  if (
    sourceLabel === "token-sales" ||
    kind === "token-sale" ||
    sourceLabel === "token-closed-listings" ||
    kind === "token-listing-closed" ||
    kind === "closed-listing"
  ) {
    if (
      item?.confirmed === false ||
      item?.closedConfirmed === false ||
      item?.closedListing?.closedConfirmed === false
    ) {
      return "pending";
    }
    if (item?.saleTxid || item?.buyerAddress) {
      return "sold";
    }
    return "delisted";
  }
  if (item?.sealTxid || item?.sealPending) {
    return "sealing";
  }
  return item?.confirmed === false ? "pending" : "active";
}

function creditListingCloseTxid(
  item,
  projectedStatus,
  projectionKind,
  sourceLabel,
) {
  const kind = eventKind(item, sourceLabel);
  const isSealProjection =
    projectionKind === "token-listing-sealed" ||
    kind === "token-listing-sealed";
  if (isSealProjection) {
    return null;
  }
  const direct =
    item?.closedTxid ?? item?.closeTxid ?? item?.closedListing?.closedTxid;
  if (isHexTxid(direct)) {
    return String(direct).toLowerCase();
  }
  const isCloseProjection =
    sourceLabel === "token-sales" ||
    projectionKind === "token-sale" ||
    sourceLabel === "token-closed-listings" ||
    projectionKind === "token-listing-closed" ||
    projectionKind === "closed-listing";
  if (isCloseProjection && isHexTxid(item?.txid)) {
    return String(item.txid).toLowerCase();
  }
  if (
    !["active", "pending"].includes(projectedStatus) &&
    isHexTxid(item?.txid)
  ) {
    return String(item.txid).toLowerCase();
  }
  return null;
}

function creditListingProjectionPayload(item, projectedStatus) {
  const payload = { ...(item ?? {}) };
  if (projectedStatus === "sold" || projectedStatus === "delisted") {
    payload.closedConfirmed = true;
  }
  if (
    projectedStatus === "pending" &&
    isHexTxid(payload.closedTxid ?? payload.closeTxid)
  ) {
    payload.closedConfirmed = false;
  }
  return payload;
}

function canonicalNonNegativeQ8Text(value, { positive = false } = {}) {
  if (typeof value !== "string" && typeof value !== "bigint") {
    return "";
  }
  const text = String(value ?? "").trim();
  if (!/^(?:0|[1-9][0-9]*)$/u.test(text)) {
    return "";
  }
  if (positive && text === "0") {
    return "";
  }
  return BigInt(text).toString();
}

function exactWorkNetworkValueSummaryBinding(summaryPayloads = {}) {
  const workFloor = objectPayload(
    summaryPayloads.workFloor ??
      summaryPayloads.workSummary?.floor ??
      summaryPayloads.marketplaceSummary?.workFloor,
  );
  const actualValue = objectPayload(workFloor?.actualValue);
  if (
    !workFloor ||
    !actualValue ||
    workFloor.workNetworkValueAccountingModel !==
      WORK_NETWORK_VALUE_ACCOUNTING_MODEL ||
    actualValue.workNetworkValueAccountingModel !==
      WORK_NETWORK_VALUE_ACCOUNTING_MODEL
  ) {
    return null;
  }

  // Every current alias is required. An absent alias is not permission to
  // rebuild Q8 from a compatibility Number; canonical snapshots fail closed.
  const aliases = [
    workFloor.networkValueQ8,
    workFloor.liveNetworkValueQ8,
    actualValue.networkValueQ8,
    actualValue.liveNetworkValueQ8,
    actualValue.totalQ8,
    actualValue.liveTotalQ8,
  ].map((value) => canonicalNonNegativeQ8Text(value, { positive: true }));
  if (aliases.some((value) => !value)) {
    return null;
  }
  const [workNetworkValueQ8] = aliases;
  if (aliases.some((value) => value !== workNetworkValueQ8)) {
    return null;
  }

  return {
    workNetworkValueAccountingModel: WORK_NETWORK_VALUE_ACCOUNTING_MODEL,
    workNetworkValueQ8,
    workNetworkValueSats: decimalTextFromQ8(workNetworkValueQ8),
  };
}

function summarySnapshotTotals(summaryPayloads = {}) {
  const binding = exactWorkNetworkValueSummaryBinding(summaryPayloads);
  if (!binding) {
    throw new Error(
      "Canonical summary totals require stored exact WORK network Q8 aliases and the current accounting model.",
    );
  }
  const {
    workNetworkValueAccountingModel,
    workNetworkValueQ8,
    workNetworkValueSats,
  } = binding;
  return {
    growthActualValueQ8: workNetworkValueQ8,
    growthActualValueSats: workNetworkValueSats,
    growthWorkFloorValueQ8: workNetworkValueQ8,
    growthWorkFloorValueSats: workNetworkValueSats,
    workActualValueQ8: workNetworkValueQ8,
    workActualValueSats: workNetworkValueSats,
    workNetworkValueAccountingModel,
    workNetworkValueQ8,
    workNetworkValueSats,
  };
}

function exactSummarySnapshotTotalsCurrent(payload) {
  const binding = exactWorkNetworkValueSummaryBinding(
    payload?.summaryPayloads,
  );
  const totals = objectPayload(payload?.totals);
  if (
    !binding ||
    !totals ||
    totals.workNetworkValueAccountingModel !==
      WORK_NETWORK_VALUE_ACCOUNTING_MODEL
  ) {
    return false;
  }
  return [
    totals.workNetworkValueQ8,
    totals.workActualValueQ8,
    totals.growthActualValueQ8,
    totals.growthWorkFloorValueQ8,
  ].every(
    (value) =>
      canonicalNonNegativeQ8Text(value, { positive: true }) ===
      binding.workNetworkValueQ8,
  );
}

function objectPayload(value) {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value
    : null;
}

function finiteSummaryNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function workFloorTotalSats(workFloor) {
  return finiteSummaryNumber(
    workFloor?.actualValue?.totalSats ?? workFloor?.networkValueSats,
  );
}

function workFloorLiveSats(workFloor, totalSats) {
  return finiteSummaryNumber(
    workFloor?.actualValue?.liveTotalSats ??
      workFloor?.actualValue?.liveNetworkValueSats ??
      workFloor?.liveNetworkValueSats ??
      totalSats,
  );
}

function workFloorFrozenSats(workFloor) {
  return finiteSummaryNumber(
    workFloor?.actualValue?.frozenTotalSats ??
      workFloor?.actualValue?.frozenNetworkValueSats ??
      workFloor?.frozenNetworkValueSats,
  );
}

function summaryPayloadSnapshotId(payload) {
  const id = String(
    payload?.snapshotId ??
      payload?.floor?.snapshotId ??
      payload?.workFloor?.snapshotId ??
      "",
  ).trim();
  return id || null;
}

function summaryPayloadValue(payload) {
  return finiteSummaryNumber(
    payload?.actualValue?.totalSats ??
      payload?.floor?.actualValue?.totalSats ??
      payload?.workFloor?.actualValue?.totalSats ??
      payload?.networkValueSats,
  );
}

function summaryPayloadFreshnessMs(payload) {
  return Math.max(
    Date.parse(payload?.indexedAt ?? ""),
    Date.parse(payload?.generatedAt ?? ""),
    Date.parse(payload?.btcUsdIndexedAt ?? ""),
    Date.parse(payload?.actualValue?.indexedAt ?? ""),
    0,
  );
}

function summaryPayloadBtcUsd(payload) {
  return finiteSummaryNumber(
    payload?.btcUsd ??
      payload?.floor?.btcUsd ??
      payload?.workFloor?.btcUsd,
  );
}

function strongerSummaryPayload(basePayload, candidatePayload) {
  const base = objectPayload(basePayload);
  const candidate = objectPayload(candidatePayload);
  if (!base) {
    return candidate ?? basePayload;
  }
  if (!candidate) {
    return base;
  }

  const baseSnapshotId = summaryPayloadSnapshotId(base);
  const candidateSnapshotId = summaryPayloadSnapshotId(candidate);
  if (
    baseSnapshotId &&
    candidateSnapshotId &&
    baseSnapshotId !== candidateSnapshotId
  ) {
    return base;
  }

  const baseValue = summaryPayloadValue(base);
  const candidateValue = summaryPayloadValue(candidate);
  if (candidateValue === null) {
    return base;
  }
  if (baseValue === null || candidateValue > baseValue + 0.0001) {
    return candidate;
  }
  if (Math.abs(candidateValue - baseValue) <= 0.0001) {
    const baseBtcUsd = summaryPayloadBtcUsd(base);
    const candidateBtcUsd = summaryPayloadBtcUsd(candidate);
    if (
      candidateBtcUsd !== null &&
      baseBtcUsd !== null &&
      Math.abs(candidateBtcUsd - baseBtcUsd) > 0.000001
    ) {
      return candidate;
    }
    const baseFreshness = summaryPayloadFreshnessMs(base);
    const candidateFreshness = summaryPayloadFreshnessMs(candidate);
    if (candidateFreshness > baseFreshness) {
      return candidate;
    }
  }
  return base;
}

function strongerSummaryPayloads(basePayloads, candidatePayloads) {
  const base = objectPayload(basePayloads) ?? {};
  const candidate = objectPayload(candidatePayloads) ?? {};
  const next = { ...candidate };
  const keys = new Set([...Object.keys(base), ...Object.keys(candidate)]);
  for (const key of keys) {
    next[key] = strongerSummaryPayload(base[key], candidate[key]);
  }
  return next;
}

function ledgerConsistencyValue(payload) {
  return finiteSummaryNumber(
    payload?.totals?.workNetworkValueSats ??
      payload?.totals?.workActualValueSats ??
      payload?.totals?.growthActualValueSats,
  );
}

function strongerLedgerConsistencyPayload(basePayload, candidatePayload) {
  const base = objectPayload(basePayload);
  const candidate = objectPayload(candidatePayload);
  if (!base) {
    return candidate ?? basePayload;
  }
  if (!candidate) {
    return base;
  }
  if (
    base.snapshotId &&
    candidate.snapshotId &&
    base.snapshotId !== candidate.snapshotId
  ) {
    return base;
  }

  const baseValue = ledgerConsistencyValue(base);
  const candidateValue = ledgerConsistencyValue(candidate);
  if (candidateValue === null) {
    return base;
  }
  if (baseValue === null || candidateValue > baseValue + 0.0001) {
    return candidate;
  }
  const baseGeneratedAt = Date.parse(base.generatedAt ?? "");
  const candidateGeneratedAt = Date.parse(candidate.generatedAt ?? "");
  if (
    Number.isFinite(candidateGeneratedAt) &&
    (!Number.isFinite(baseGeneratedAt) ||
      candidateGeneratedAt > baseGeneratedAt)
  ) {
    return candidate;
  }
  return base;
}

function growthSummaryWithAlignedWorkFloor(growthSummary, workFloor) {
  const summary = objectPayload(growthSummary);
  const floor = objectPayload(workFloor);
  if (!summary || !floor) {
    return growthSummary;
  }

  const totalSats = workFloorTotalSats(floor);
  if (totalSats === null) {
    return { ...summary, workFloor: floor };
  }

  const liveSats = workFloorLiveSats(floor, totalSats);
  const frozenSats = workFloorFrozenSats(floor);
  const actualValue = {
    ...(objectPayload(summary.actualValue) ?? {}),
    networkValueSats: totalSats,
    totalSats,
  };
  if (liveSats !== null) {
    actualValue.liveNetworkValueSats = liveSats;
    actualValue.liveTotalSats = liveSats;
  }
  if (frozenSats !== null) {
    actualValue.frozenFloorSats = frozenSats / 21_000_000;
    actualValue.frozenNetworkValueSats = frozenSats;
    actualValue.frozenTotalSats = frozenSats;
  }
  const floorUsd = finiteSummaryNumber(floor?.actualValue?.totalUsd);
  if (floorUsd !== null) {
    actualValue.totalUsd = floorUsd;
  }

  return {
    ...summary,
    actualValue,
    btcUsd: floor.btcUsd ?? summary.btcUsd,
    btcUsdIndexedAt: floor.btcUsdIndexedAt ?? summary.btcUsdIndexedAt,
    frozenNetworkValueSats:
      frozenSats !== null ? frozenSats : summary.frozenNetworkValueSats,
    liveNetworkValueSats:
      liveSats !== null ? liveSats : summary.liveNetworkValueSats,
    networkValueSats: totalSats,
    usdSource: floor.usdSource ?? summary.usdSource,
    workFloor: floor,
  };
}

function summaryPayloadsWithAlignedWorkFloor(summaryPayloads = {}) {
  const payloads = objectPayload(summaryPayloads) ?? {};
  const workFloor = objectPayload(payloads.workFloor);
  if (!workFloor) {
    return payloads;
  }

  const next = { ...payloads };
  if (objectPayload(next.workSummary)) {
    next.workSummary = {
      ...next.workSummary,
      floor: workFloor,
    };
  }
  if (objectPayload(next.growthSummary)) {
    next.growthSummary = growthSummaryWithAlignedWorkFloor(
      next.growthSummary,
      workFloor,
    );
  }
  if (objectPayload(next.marketplaceSummary)) {
    next.marketplaceSummary = {
      ...next.marketplaceSummary,
      workFloor,
    };
  }
  return next;
}

async function fallbackLedgerSnapshotPayload(
  client,
  previousPayload,
  summaryPayloads,
  error,
) {
  const indexedThroughBlock =
    (await latestIndexedBlockHeight(client).catch(() => 0)) ||
    numberOrNull(previousPayload?.indexedThroughBlock) ||
    numberOrNull(previousPayload?.metrics?.indexedThroughBlock) ||
    0;
  const generatedAt = new Date().toISOString();
  const summaryHash = createHash("sha256")
    .update(JSON.stringify(summaryPayloads ?? {}))
    .digest("hex");
  const snapshotId = createHash("sha256")
    .update(
      JSON.stringify({
        indexedThroughBlock,
        network: NETWORK,
        summaryHash,
      }),
    )
    .digest("hex");
  const metrics = {
    ...(previousPayload?.metrics ?? {}),
    indexedThroughBlock,
  };
  const totals = exactWorkNetworkValueSummaryBinding(summaryPayloads)
    ? summarySnapshotTotals(summaryPayloads)
    : {};
  return {
    checks: previousPayload?.checks ?? [],
    generatedAt,
    indexedThroughBlock,
    metrics,
    missingLogEvents: previousPayload?.missingLogEvents ?? [],
    network: NETWORK,
    ok: false,
    snapshotId,
    sourceHashes: {
      ...(previousPayload?.sourceHashes ?? {}),
      summarySnapshotFallback: summaryHash,
    },
    status: "summary-snapshot-fallback",
    totals,
    warning: `Ledger consistency refresh failed: ${error?.message ?? String(error)}`,
  };
}

async function storeLedgerSnapshot(client, options = {}) {
  const includeDerivedSnapshots = options.includeDerivedSnapshots !== false;
  const atomicWorkProjectionReady =
    await workAtomicProjectionReady(client);
  const tokenHistoryPayloads = {};
  const tokenStatePayloads = {};
  let payload = null;
  let ledgerSnapshotError = null;
  try {
    payload = await readJson(
      unpagedEndpoint("/api/v1/ledger-consistency", summarySnapshotSourceParams()),
    );
    if (REFRESH_SUMMARY_SNAPSHOT_SOURCES) {
      try {
        payload = strongerLedgerConsistencyPayload(
          payload,
          await readJson(unpagedEndpoint("/api/v1/ledger-consistency")),
        );
      } catch (error) {
        console.error(
          JSON.stringify({
            error: error?.message ?? String(error),
            phase: "ledger-snapshot-current",
          }),
        );
      }
    }
  } catch (error) {
    ledgerSnapshotError = error;
    console.error(
      JSON.stringify({
        error: error?.message ?? String(error),
        phase: "ledger-snapshot",
      }),
    );
  }
  const previousPayload = await storedLedgerSnapshotPayload(
    client,
    payload?.snapshotId ?? "",
  );
  const [activityPayload, registryHistoryPayloads, rawSummaryPayloads] =
    includeDerivedSnapshots
      ? await Promise.all([
          activitySnapshot(previousPayload),
          registryHistorySnapshots(),
          summarySnapshots(),
        ])
      : [
          previousPayload?.activityPayload ?? null,
          previousPayload?.registryHistoryPayloads ?? {},
          previousPayload?.summaryPayloads ?? {},
        ];
  const summaryPayloads = summaryPayloadsWithAlignedWorkFloor(
    strongerSummaryPayloads(previousPayload?.summaryPayloads, rawSummaryPayloads),
  );
  const latestIndexedHeight = await latestIndexedBlockHeight(client).catch(() => 0);
  const mergedIndexedThroughBlock = Math.max(
    numberOrNull(payload?.indexedThroughBlock) ?? 0,
    numberOrNull(payload?.metrics?.indexedThroughBlock) ?? 0,
    latestIndexedHeight,
  );
  if (mergedIndexedThroughBlock > 0 && payload) {
    payload = {
      ...payload,
      indexedThroughBlock: mergedIndexedThroughBlock,
      metrics: {
        ...(payload.metrics ?? {}),
        indexedThroughBlock: mergedIndexedThroughBlock,
      },
    };
  }
  if (!payload) {
    payload = await fallbackLedgerSnapshotPayload(
      client,
      previousPayload,
      summaryPayloads,
      ledgerSnapshotError,
    );
  }
  if (includeDerivedSnapshots) {
    for (const scope of TOKEN_HISTORY_SNAPSHOT_SCOPES) {
      try {
        const tokenSnapshot = await tokenHistorySnapshotsForScope(scope);
        tokenHistoryPayloads[scope.key] = tokenSnapshot.historyPayloads;
        tokenStatePayloads[scope.key] = tokenSnapshot.statePayload;
      } catch (error) {
        console.error(
          JSON.stringify({
            error: error?.message ?? String(error),
            phase: "token-history-snapshot",
            scope: scope.key,
          }),
        );
        tokenHistoryPayloads[scope.key] = {};
        tokenStatePayloads[scope.key] = {};
      }
    }
  }
  const indexedAt = new Date().toISOString();
  const basePayload =
    previousPayload && typeof previousPayload === "object" && !Array.isArray(previousPayload)
      ? previousPayload
      : {};
  const {
    summaryRefresh: _canonicalSummaryRefresh,
    workAmountStorageModel: _workAmountStorageModel,
    ...legacyBasePayload
  } = basePayload;
  const {
    workAmountStorageModel: _incomingWorkAmountStorageModel,
    ...currentLedgerPayload
  } = objectValue(payload);
  const snapshotPayload = {
    ...legacyBasePayload,
    ...currentLedgerPayload,
    ...(atomicWorkProjectionReady
      ? { workAmountStorageModel: WORK_ATOMIC_PROJECTION_MODEL }
      : {}),
    ...(activityPayload
      ? {
          activityIndexedAt:
            activityPayload === previousPayload?.activityPayload
              ? previousPayload.activityIndexedAt ?? indexedAt
              : indexedAt,
          activityPayload,
        }
      : {}),
    ...(includeDerivedSnapshots
      ? {
          registryHistoryIndexedAt: indexedAt,
          registryHistoryPayloads,
          summaryPayloads,
          summaryPayloadsIndexedAt: indexedAt,
          tokenHistoryIndexedAt: indexedAt,
          tokenHistoryPayloads,
          tokenStatePayloads,
          tokenStatePayloadsIndexedAt: indexedAt,
        }
      : {}),
  };
  await client.query(
    `
      INSERT INTO proof_indexer.ledger_snapshots (
        network,
        snapshot_id,
        generated_at,
        indexed_through_block,
        source_hashes,
        metrics,
        consistency,
        payload
      )
      VALUES ($1, $2, COALESCE($3::timestamptz, now()), $4, $5::jsonb, $6::jsonb, $7::jsonb, $8::jsonb)
      ON CONFLICT (network, snapshot_id)
      DO UPDATE SET
        generated_at = EXCLUDED.generated_at,
        indexed_through_block = EXCLUDED.indexed_through_block,
        source_hashes = EXCLUDED.source_hashes,
        metrics = EXCLUDED.metrics,
        consistency = EXCLUDED.consistency,
        payload = EXCLUDED.payload
      WHERE NOT EXISTS (
        SELECT 1
        FROM proof_indexer.events issuance_event
        WHERE issuance_event.network = EXCLUDED.network
          AND issuance_event.payload->>'issuanceValueSnapshotId' =
            EXCLUDED.snapshot_id
      )
        AND NOT EXISTS (
          SELECT 1
          FROM proof_indexer.meta rebuild
          JOIN proof_indexer.meta witness
            ON witness.key =
              rebuild.value->'verifierBinding'->>'witnessSetMetaKey'
          CROSS JOIN LATERAL jsonb_array_elements(
            COALESCE(witness.value->'entries', '[]'::jsonb)
          ) entry
          WHERE rebuild.key = $9
            AND rebuild.value->>'network' = EXCLUDED.network
            AND witness.value->>'network' = EXCLUDED.network
            AND witness.value->>'model' = $10
            AND entry->>'disposition' = 'preserve'
            AND entry->'snapshot'->>'snapshotId' = EXCLUDED.snapshot_id
        )
    `,
    [
      NETWORK,
      payload.snapshotId ?? "unknown",
      payload.generatedAt ?? null,
      numberOrNull(payload.indexedThroughBlock),
      JSON.stringify(payload.sourceHashes ?? {}),
      JSON.stringify(payload.metrics ?? {}),
      JSON.stringify({
        checks: payload.checks ?? [],
        missingLogEvents: payload.missingLogEvents ?? [],
        ok: payload.ok,
        status: payload.status,
      }),
      JSON.stringify(snapshotPayload),
      CANONICAL_REBUILD_META_KEY,
      INCB_RANGE_REPLAY_WITNESS_MANIFEST_MODEL,
    ],
  );
  return snapshotPayload;
}

const REQUIRED_CURRENT_SUMMARY_KEYS = [
  "growthSummary",
  "inceptionSummary",
  "infinitySummary",
  "logSummary",
  "marketplaceSummary",
  "tokenSummary",
  "workFloor",
  "workSummary",
];

function summaryPayloadConservativeCoverage(payload, key) {
  const item = objectPayload(payload);
  if (!item) {
    return 0;
  }
  const parentCoverage = Math.max(
    numberOrNull(item.indexedThroughBlock) ?? 0,
    numberOrNull(item.metrics?.indexedThroughBlock) ?? 0,
    numberOrNull(item.stats?.indexedThroughBlock) ?? 0,
  );
  if (parentCoverage <= 0) {
    return 0;
  }
  const nested =
    key === "workSummary"
      ? objectPayload(item.floor)
      : key === "growthSummary" || key === "marketplaceSummary"
        ? objectPayload(item.workFloor)
        : null;
  if (
    !nested &&
    ![
      "inceptionSummary",
      "infinitySummary",
      "logSummary",
      "tokenSummary",
      "workFloor",
    ].includes(key)
  ) {
    return 0;
  }
  if (!nested) {
    return parentCoverage;
  }
  const nestedCoverage = Math.max(
    numberOrNull(nested.indexedThroughBlock) ?? 0,
    numberOrNull(nested.metrics?.indexedThroughBlock) ?? 0,
    numberOrNull(nested.stats?.indexedThroughBlock) ?? 0,
  );
  return nestedCoverage > 0
    ? Math.min(parentCoverage, nestedCoverage)
    : 0;
}

function canonicalSummaryCoverage(summaryPayloads = {}) {
  const coverages = REQUIRED_CURRENT_SUMMARY_KEYS.map((key) =>
    summaryPayloadConservativeCoverage(summaryPayloads?.[key], key),
  );
  return coverages.every((height) => height > 0)
    ? Math.min(...coverages)
    : 0;
}

function canonicalSummaryAccountingModelsCurrent(summaryPayloads = {}) {
  const q8Scale = 100_000_000n;
  const exactWorkNetworkValue =
    exactWorkNetworkValueSummaryBinding(summaryPayloads);
  const hasValue = (object, field) =>
    object &&
    Object.prototype.hasOwnProperty.call(object, field) &&
    object[field] !== undefined &&
    object[field] !== null &&
    object[field] !== "";
  const exactInteger = (
    value,
    { allowZero = true, positive = false } = {},
  ) => {
    if (typeof value === "bigint") {
      if ((positive && value <= 0n) || (!allowZero && value === 0n)) {
        return null;
      }
      return value < 0n ? null : value;
    }
    if (typeof value === "number") {
      if (
        !Number.isSafeInteger(value) ||
        value < 0 ||
        (positive && value <= 0) ||
        (!allowZero && value === 0)
      ) {
        return null;
      }
      return BigInt(value);
    }
    const text = String(value ?? "").trim();
    if (!/^(?:0|[1-9][0-9]*)$/u.test(text)) {
      return null;
    }
    const integer = BigInt(text);
    if ((positive && integer <= 0n) || (!allowZero && integer === 0n)) {
      return null;
    }
    return integer;
  };
  const decimalQ8 = (value) => {
    if (typeof value === "number") {
      if (!Number.isFinite(value) || value < 0) return null;
      value = value.toFixed(8).replace(/\.?0+$/u, "");
    }
    const text = String(value ?? "").trim();
    const match = /^(0|[1-9][0-9]*)(?:\.([0-9]{1,8}))?$/u.exec(text);
    if (!match) return null;
    return (
      BigInt(match[1]) * q8Scale +
      BigInt((match[2] ?? "").padEnd(8, "0") || "0")
    );
  };
  const exactQ8 = (object, q8Field, decimalField) => {
    if (hasValue(object, q8Field)) {
      return exactInteger(object[q8Field]);
    }
    return decimalQ8(object?.[decimalField]);
  };
  const exactQ8AliasesAgree = (object, q8Field, decimalField) => {
    if (!hasValue(object, q8Field) || !hasValue(object, decimalField)) {
      return true;
    }
    const q8 = exactInteger(object[q8Field]);
    const decimal = decimalQ8(object[decimalField]);
    return q8 !== null && decimal !== null && q8 === decimal;
  };
  const coverage =
    summaryPayloads?.workFloor?.actualValue?.creditMinerFeeCoverage;
  const inceptionActualCandidate =
    summaryPayloads?.inceptionSummary?.actualValue;
  const inceptionActual =
    inceptionActualCandidate &&
    typeof inceptionActualCandidate === "object" &&
    !Array.isArray(inceptionActualCandidate)
      ? inceptionActualCandidate
      : null;
  const confirmedEvents = Number(coverage?.confirmedEvents);
  const coveredConfirmedEvents = Number(coverage?.coveredConfirmedEvents);
  const confirmedTransactions = Number(coverage?.confirmedTransactions);
  const coveredConfirmedTransactions = Number(
    coverage?.coveredConfirmedTransactions,
  );
  const issuanceCheckpointBlockHeight = Number(
    inceptionActual?.issuanceCheckpointBlockHeight,
  );
  const issuanceValueSnapshotBlockHeight = Number(
    inceptionActual?.issuanceValueSnapshotBlockHeight,
  );
  const confirmedInceptionMints = Number(
    summaryPayloads?.inceptionSummary?.token?.stats?.confirmedMints,
  );
  const workTransferProjection =
    summaryPayloads?.workSummary?.workTransferValueProjection;
  const workTransferProjectionItems = Array.isArray(
    workTransferProjection?.items,
  )
    ? workTransferProjection.items
    : [];
  const confirmedWorkTransfers = Number(
    summaryPayloads?.workSummary?.token?.stats?.confirmedTransfers,
  );
  const workLiveFloorSats = Number(
    summaryPayloads?.workSummary?.floor?.liveFloorSats ??
      summaryPayloads?.workSummary?.floor?.floorSats,
  );
  const workTransferProjectionItemKeys = workTransferProjectionItems.map(
    (item) => {
      const identity = [
        item?._powEventIndex,
        item?.eventKeyVout,
        item?.protocolVout,
        item?.eventId,
      ]
        .filter(
          (value) => value !== undefined && value !== null && value !== "",
        )
        .map((value) => Number(value))
        .find((value) => Number.isSafeInteger(value) && value >= 0);
      const fallback = [
        Number(item?.amount),
        String(item?.senderAddress ?? "").trim().toLowerCase(),
        String(item?.recipientAddress ?? "").trim().toLowerCase(),
      ].join(":");
      return [
        String(item?.tokenId ?? "").trim().toLowerCase(),
        String(item?.txid ?? "").trim().toLowerCase(),
        identity === undefined ? `movement:${fallback}` : `event:${identity}`,
      ].join(":");
    },
  );
  const workTransferProjectionIdentitiesCurrent =
    workTransferProjectionItemKeys.every(Boolean) &&
    new Set(workTransferProjectionItemKeys).size ===
      workTransferProjectionItems.length;
  const workTransferProjectionCurrent =
    workTransferProjection?.model === WORK_TRANSFER_VALUE_PROJECTION_MODEL &&
    Number.isSafeInteger(confirmedWorkTransfers) &&
    confirmedWorkTransfers >= 0 &&
    (confirmedWorkTransfers === 0 ||
      (Number.isFinite(workLiveFloorSats) && workLiveFloorSats > 0)) &&
    workTransferProjectionIdentitiesCurrent &&
    workTransferProjectionItems.length === confirmedWorkTransfers &&
    workTransferProjectionItems.every((item) => {
      const confirmationModel = String(
        item?.creditFloorAtConfirmModel ?? "",
      );
      const inceptionBound =
        confirmationModel === "canonical-incb-h-minus-one-live-work-v1";
      const creditAmountMoved = Number(item?.creditAmountMoved);
      const creditFloorAtConfirmSats = Number(
        item?.creditFloorAtConfirmSats,
      );
      const creditLiveFloorSats = Number(item?.creditLiveFloorSats);
      const creditRevaluationFloorSats = Number(
        item?.creditRevaluationFloorSats,
      );
      const creditValueAtConfirmSats = Number(
        item?.creditValueAtConfirmSats,
      );
      const creditLiveValueSats = Number(item?.creditLiveValueSats);
      const frozenNetworkValueSats = Number(item?.frozenNetworkValueSats);
      const liveNetworkValueSats = Number(item?.liveNetworkValueSats);
      if (
        ![
          creditAmountMoved,
          creditFloorAtConfirmSats,
          creditLiveFloorSats,
          creditRevaluationFloorSats,
          creditValueAtConfirmSats,
          creditLiveValueSats,
          frozenNetworkValueSats,
          liveNetworkValueSats,
        ].every(Number.isFinite)
      ) {
        return false;
      }
      let creditAmountAtoms;
      try {
        creditAmountAtoms = BigInt(workAmountAtomsFromRecord(item));
      } catch {
        return false;
      }
      const expectedCreditAmountMoved = Number(
        formatWorkAtoms(creditAmountAtoms),
      );
      const creditFloorAtConfirmQ8 = exactInteger(
        item?.creditFloorAtConfirmQ8,
        { positive: true },
      );
      const creditLiveFloorQ8 = exactInteger(item?.creditLiveFloorQ8, {
        positive: true,
      });
      const creditRevaluationFloorQ8 = exactInteger(
        item?.creditRevaluationFloorQ8,
        { positive: true },
      );
      const creditValueAtConfirmQ8 = exactInteger(
        item?.creditValueAtConfirmQ8,
        { positive: true },
      );
      const creditLiveValueQ8 = exactInteger(item?.creditLiveValueQ8, {
        positive: true,
      });
      const frozenNetworkValueQ8 = exactInteger(
        item?.frozenNetworkValueQ8,
        { positive: true },
      );
      const liveNetworkValueQ8 = exactInteger(item?.liveNetworkValueQ8, {
        positive: true,
      });
      const networkValueBeforeEventQ8 = exactInteger(
        item?.networkValueBeforeEventQ8,
        { positive: true },
      );
      const liveNetworkValueBeforeEventQ8 = inceptionBound
        ? exactInteger(item?.liveNetworkValueBeforeEventQ8, {
            positive: true,
          })
        : networkValueBeforeEventQ8;
      const fixedEventFlowSats = exactInteger(item?.fixedEventFlowSats);
      const projectionDecimalQ8 = (value) => {
        const text = String(value ?? "").trim();
        const match = /^(0|[1-9][0-9]*)(?:\.([0-9]+))?$/u.exec(text);
        if (!match) return null;
        return (
          BigInt(match[1]) * q8Scale +
          BigInt((match[2] ?? "").padEnd(8, "0").slice(0, 8) || "0")
        );
      };
      const currentLiveFloorQ8 = projectionDecimalQ8(
        summaryPayloads?.workSummary?.floor?.liveFloorSats ??
          summaryPayloads?.workSummary?.floor?.floorSats,
      );
      const expectedCreditFloorAtConfirmQ8 =
        liveNetworkValueBeforeEventQ8 === null
          ? null
          : liveNetworkValueBeforeEventQ8 /
            BigInt(WORK_TOKEN_MAX_SUPPLY);
      const expectedCreditValueAtConfirmQ8 =
        liveNetworkValueBeforeEventQ8 === null
          ? null
          : (creditAmountAtoms * liveNetworkValueBeforeEventQ8) /
            (BigInt(WORK_TOKEN_MAX_SUPPLY) * WORK_UNIT_SCALE);
      const expectedCreditLiveValueQ8 =
        creditLiveFloorQ8 === null
          ? null
          : (creditAmountAtoms * creditLiveFloorQ8) / WORK_UNIT_SCALE;
      const fixedEventFlowQ8 =
        fixedEventFlowSats === null
          ? null
          : fixedEventFlowSats * q8Scale;
      const aliasesCurrent = [
        ["creditFloorAtConfirmQ8", "creditFloorAtConfirmSats"],
        ["creditLiveFloorQ8", "creditLiveFloorSats"],
        ["creditLiveValueQ8", "creditLiveValueSats"],
        ["creditRevaluationFloorQ8", "creditRevaluationFloorSats"],
        ["creditValueAtConfirmQ8", "creditValueAtConfirmSats"],
        ["frozenNetworkValueQ8", "frozenNetworkValueSats"],
        ["liveNetworkValueQ8", "liveNetworkValueSats"],
        ["networkValueBeforeEventQ8", "networkValueBeforeEventSats"],
        [
          "liveNetworkValueBeforeEventQ8",
          "liveNetworkValueBeforeEventSats",
        ],
      ].every(([q8Field, decimalField]) =>
        exactQ8AliasesAgree(item, q8Field, decimalField),
      );
      return (
        item?.confirmed === true &&
        String(item?.tokenId ?? "").trim().toLowerCase() === WORK_TOKEN_ID &&
        /^[0-9a-f]{64}$/u.test(
          String(item?.txid ?? "").trim().toLowerCase(),
        ) &&
        creditAmountMoved > 0 &&
        Number(item?.amount) === creditAmountMoved &&
        creditAmountMoved === expectedCreditAmountMoved &&
        networkValueBeforeEventQ8 !== null &&
        expectedCreditFloorAtConfirmQ8 !== null &&
        creditFloorAtConfirmQ8 === expectedCreditFloorAtConfirmQ8 &&
        currentLiveFloorQ8 !== null &&
        creditLiveFloorQ8 === currentLiveFloorQ8 &&
        creditRevaluationFloorQ8 === currentLiveFloorQ8 &&
        expectedCreditValueAtConfirmQ8 !== null &&
        creditValueAtConfirmQ8 === expectedCreditValueAtConfirmQ8 &&
        expectedCreditLiveValueQ8 !== null &&
        creditLiveValueQ8 === expectedCreditLiveValueQ8 &&
        fixedEventFlowQ8 !== null &&
        frozenNetworkValueQ8 ===
          creditValueAtConfirmQ8 + fixedEventFlowQ8 &&
        liveNetworkValueQ8 === creditLiveValueQ8 + fixedEventFlowQ8 &&
        aliasesCurrent &&
        confirmationModel.length > 0 &&
        (!inceptionBound ||
          (Number.isSafeInteger(Number(item?.valueSnapshotBlockHeight)) &&
            Number(item.valueSnapshotBlockHeight) > 0 &&
            /^[0-9a-f]{64}$/u.test(
              String(item?.valueSnapshotBlockHash ?? "")
                .trim()
                .toLowerCase(),
            ) &&
            /^[0-9a-f]{64}$/u.test(
              String(item?.valueSnapshotCanonicalSummaryHash ?? "")
                .trim()
                .toLowerCase(),
            ) &&
            Number.isFinite(
              Date.parse(String(item?.valueSnapshotGeneratedAt ?? "")),
            ) &&
            String(item?.valueSnapshotId ?? "").trim().length > 0))
      );
    });
  const confirmedIssuanceUnits = exactInteger(
    inceptionActual?.confirmedIssuanceUnits,
    { positive: true },
  );
  const directProofIssuanceUnits = exactInteger(
    inceptionActual?.directProofIssuanceUnits,
    { positive: true },
  );
  const attachedWorkIssuanceUnits = exactInteger(
    inceptionActual?.attachedWorkIssuanceUnits,
  );
  const attachedWorkLiveValueAtSendQ8 = exactQ8(
    inceptionActual,
    "attachedWorkLiveValueAtSendQ8",
    "attachedWorkLiveValueAtSendSats",
  );
  const issuanceNetworkValueQ8 = exactQ8(
    inceptionActual,
    "issuanceNetworkValueQ8",
    "issuanceNetworkValueSats",
  );
  const issuanceDustQ8 = exactQ8(
    inceptionActual,
    "issuanceDustQ8",
    "issuanceDustSats",
  );
  const issuanceFloorQ8 = exactQ8(
    inceptionActual,
    "issuanceFloorQ8",
    "issuanceFloorSats",
  );
  const issuanceValueSnapshotWorkNetworkValueQ8 = exactQ8(
    inceptionActual,
    "issuanceValueSnapshotWorkNetworkValueQ8",
    "issuanceValueSnapshotWorkNetworkValueSats",
  );
  const inceptionConfirmedSupply = exactInteger(
    summaryPayloads?.inceptionSummary?.stats?.confirmedSupply,
    { positive: true },
  );
  const inceptionBondSaleVolumeSats = exactInteger(
    inceptionActual?.bondSaleVolumeSats,
  );
  const inceptionBondTransferFeeSats = exactInteger(
    inceptionActual?.bondTransferFeeSats,
  );
  const inceptionBondMarketplaceMutationFeeSats = exactInteger(
    inceptionActual?.bondMarketplaceMutationFeeSats,
  );
  const inceptionNetworkValueQ8 = exactQ8(
    inceptionActual,
    "networkValueQ8",
    "networkValueSats",
  );
  const inceptionLiveNetworkValueQ8 = exactQ8(
    inceptionActual,
    "liveNetworkValueQ8",
    "liveNetworkValueSats",
  );
  const inceptionFrozenNetworkValueQ8 = exactQ8(
    inceptionActual,
    "frozenNetworkValueQ8",
    "frozenNetworkValueSats",
  );
  const inceptionFloorQ8 = exactQ8(
    inceptionActual,
    "floorQ8",
    "floorSats",
  );
  const inceptionLiveFloorQ8 = exactQ8(
    inceptionActual,
    "liveFloorQ8",
    "liveFloorSats",
  );
  const inceptionFrozenFloorQ8 = exactQ8(
    inceptionActual,
    "frozenFloorQ8",
    "frozenFloorSats",
  );
  const topLevelInceptionNetworkValueQ8 = exactQ8(
    summaryPayloads?.inceptionSummary,
    "networkValueQ8",
    "networkValueSats",
  );
  const confirmedInceptionMintsBigInt = Number.isSafeInteger(
    confirmedInceptionMints,
  )
    ? BigInt(confirmedInceptionMints)
    : null;
  const exactInceptionAliasesCurrent = [
    ["attachedWorkLiveValueAtSendQ8", "attachedWorkLiveValueAtSendSats"],
    ["issuanceNetworkValueQ8", "issuanceNetworkValueSats"],
    ["issuanceDustQ8", "issuanceDustSats"],
    ["issuanceFloorQ8", "issuanceFloorSats"],
    [
      "issuanceValueSnapshotWorkNetworkValueQ8",
      "issuanceValueSnapshotWorkNetworkValueSats",
    ],
    ["networkValueQ8", "networkValueSats"],
    ["liveNetworkValueQ8", "liveNetworkValueSats"],
    ["frozenNetworkValueQ8", "frozenNetworkValueSats"],
    ["floorQ8", "floorSats"],
    ["liveFloorQ8", "liveFloorSats"],
    ["frozenFloorQ8", "frozenFloorSats"],
  ].every(([q8Field, decimalField]) =>
    exactQ8AliasesAgree(inceptionActual, q8Field, decimalField),
  ) &&
    exactQ8AliasesAgree(
      summaryPayloads?.inceptionSummary,
      "networkValueQ8",
      "networkValueSats",
    );
  const attachedWorkIssuanceDustQ8 =
    attachedWorkLiveValueAtSendQ8 !== null &&
    attachedWorkIssuanceUnits !== null
      ? attachedWorkLiveValueAtSendQ8 -
        attachedWorkIssuanceUnits * q8Scale
      : null;
  const issuanceAggregateDustQ8 =
    issuanceNetworkValueQ8 !== null && confirmedIssuanceUnits !== null
      ? issuanceNetworkValueQ8 - confirmedIssuanceUnits * q8Scale
      : null;
  const inceptionIssuanceCurrent =
    inceptionActual?.attachmentAccountingModel ===
      INCB_ISSUANCE_ACCOUNTING_MODEL &&
    inceptionActual?.issuanceAccountingModel ===
      INCB_ISSUANCE_ACCOUNTING_MODEL &&
    inceptionActual?.issuanceCheckpointMode ===
      "bond-transaction-provenance" &&
    inceptionActual?.issuanceValueSnapshotModel ===
      INCB_VALUE_SNAPSHOT_MODEL &&
    inceptionActual?.issuanceValueSnapshotMode ===
      "canonical-summary-refresh" &&
    Number.isSafeInteger(issuanceCheckpointBlockHeight) &&
    issuanceCheckpointBlockHeight > 1 &&
    issuanceValueSnapshotBlockHeight ===
      issuanceCheckpointBlockHeight - 1 &&
    /^[0-9a-f]{64}$/u.test(
      String(inceptionActual?.issuanceValueSnapshotBlockHash ?? "")
        .trim()
        .toLowerCase(),
    ) &&
    /^[0-9a-f]{64}$/u.test(
      String(
        inceptionActual?.issuanceValueSnapshotCanonicalSummaryHash ?? "",
      )
        .trim()
        .toLowerCase(),
    ) &&
    String(inceptionActual?.issuanceValueSnapshotId ?? "").trim().length > 0 &&
    Number.isFinite(
      Date.parse(
        String(inceptionActual?.issuanceValueSnapshotGeneratedAt ?? ""),
      ),
    ) &&
    issuanceValueSnapshotWorkNetworkValueQ8 !== null &&
    issuanceValueSnapshotWorkNetworkValueQ8 > 0n &&
    Number.isSafeInteger(confirmedInceptionMints) &&
    confirmedInceptionMints > 0 &&
    confirmedInceptionMintsBigInt !== null &&
    confirmedIssuanceUnits !== null &&
    confirmedIssuanceUnits > 0n &&
    directProofIssuanceUnits !== null &&
    directProofIssuanceUnits > 0n &&
    attachedWorkIssuanceUnits !== null &&
    attachedWorkIssuanceUnits >= 0n &&
    directProofIssuanceUnits + attachedWorkIssuanceUnits ===
      confirmedIssuanceUnits &&
    attachedWorkLiveValueAtSendQ8 !== null &&
    attachedWorkLiveValueAtSendQ8 >= 0n &&
    attachedWorkIssuanceDustQ8 !== null &&
    attachedWorkIssuanceDustQ8 >= 0n &&
    attachedWorkIssuanceDustQ8 < confirmedInceptionMintsBigInt * q8Scale &&
    issuanceNetworkValueQ8 !== null &&
    issuanceNetworkValueQ8 ===
      directProofIssuanceUnits * q8Scale +
        attachedWorkLiveValueAtSendQ8 &&
    issuanceAggregateDustQ8 !== null &&
    issuanceAggregateDustQ8 >= 0n &&
    issuanceAggregateDustQ8 < confirmedInceptionMintsBigInt * q8Scale &&
    issuanceDustQ8 !== null &&
    issuanceDustQ8 === issuanceAggregateDustQ8 &&
    issuanceDustQ8 === attachedWorkIssuanceDustQ8 &&
    issuanceFloorQ8 !== null &&
    issuanceFloorQ8 >= q8Scale &&
    issuanceFloorQ8 ===
      issuanceNetworkValueQ8 / confirmedIssuanceUnits &&
    exactInceptionAliasesCurrent;
  const expectedInceptionNetworkValueQ8 =
    issuanceNetworkValueQ8 !== null &&
    inceptionBondSaleVolumeSats !== null &&
    inceptionBondTransferFeeSats !== null &&
    inceptionBondMarketplaceMutationFeeSats !== null
      ? issuanceNetworkValueQ8 +
        (inceptionBondSaleVolumeSats +
          inceptionBondTransferFeeSats +
          inceptionBondMarketplaceMutationFeeSats) *
          q8Scale
      : null;
  const expectedInceptionFloorQ8 =
    inceptionNetworkValueQ8 !== null &&
    inceptionConfirmedSupply !== null &&
    inceptionConfirmedSupply > 0n
      ? inceptionNetworkValueQ8 / inceptionConfirmedSupply
      : null;
  const inceptionNetworkValueCurrent =
    inceptionActual?.networkValueAccountingModel ===
      INCB_NETWORK_VALUE_ACCOUNTING_MODEL &&
    inceptionConfirmedSupply !== null &&
    inceptionConfirmedSupply === confirmedIssuanceUnits &&
    [
      inceptionBondSaleVolumeSats,
      inceptionBondTransferFeeSats,
      inceptionBondMarketplaceMutationFeeSats,
    ].every((value) => value !== null && value >= 0n) &&
    expectedInceptionNetworkValueQ8 !== null &&
    inceptionNetworkValueQ8 === expectedInceptionNetworkValueQ8 &&
    inceptionLiveNetworkValueQ8 === inceptionNetworkValueQ8 &&
    inceptionFrozenNetworkValueQ8 === inceptionNetworkValueQ8 &&
    topLevelInceptionNetworkValueQ8 === inceptionNetworkValueQ8 &&
    expectedInceptionFloorQ8 !== null &&
    inceptionFloorQ8 === expectedInceptionFloorQ8 &&
    inceptionLiveFloorQ8 === expectedInceptionFloorQ8 &&
    inceptionFrozenFloorQ8 === expectedInceptionFloorQ8;
  return (
    exactWorkNetworkValue !== null &&
    String(
      summaryPayloads?.workFloor?.actualValue
        ?.creditMinerFeeAccountingModel ?? "",
    ) === "canonical-unique-tx-input-output-v1" &&
    workTransferProjectionCurrent &&
    inceptionIssuanceCurrent &&
    inceptionNetworkValueCurrent &&
    coverage?.complete === true &&
    coverage?.source ===
      "proof-indexer-normalized-input-output-totals" &&
    Number.isSafeInteger(confirmedEvents) &&
    confirmedEvents > 0 &&
    coveredConfirmedEvents === confirmedEvents &&
    Number(coverage?.missingConfirmedEvents) === 0 &&
    Number.isSafeInteger(confirmedTransactions) &&
    confirmedTransactions > 0 &&
    coveredConfirmedTransactions === confirmedTransactions &&
    Number(coverage?.missingConfirmedTransactions) === 0 &&
    Array.isArray(coverage?.missingConfirmedTxids) &&
    coverage.missingConfirmedTxids.length === 0
  );
}

function eligibleCanonicalSummarySnapshotPayload(payload) {
  const item = objectPayload(payload);
  const tokenComponentCheck = (Array.isArray(item?.checks) ? item.checks : []).find(
    (check) => check?.name === "token-components-cover-confirmed-activity",
  );
  const publicLogCountCheck = (Array.isArray(item?.checks) ? item.checks : []).find(
    (check) => check?.name === "canonical-activity-count-matches-public-log",
  );
  const inceptionIssuanceCheck = (
    Array.isArray(item?.checks) ? item.checks : []
  ).find(
    (check) => check?.name === "inception-live-issuance-matches-incb-supply",
  );
  const inceptionFixedValueCheck = (
    Array.isArray(item?.checks) ? item.checks : []
  ).find((check) => check?.name === "inception-fixed-value-reconciles");
  return Boolean(
    item &&
      item.ok === true &&
      item.status !== "summary-snapshot-fallback" &&
      tokenComponentCheck?.ok === true &&
      publicLogCountCheck?.ok === true &&
      inceptionIssuanceCheck?.ok === true &&
      inceptionFixedValueCheck?.ok === true &&
      item.summaryRefresh?.mode === "canonical-summary-refresh" &&
      /^[0-9a-f]{64}$/u.test(
        String(item.indexedThroughBlockHash ?? "").toLowerCase(),
      ) &&
      String(item.summaryRefresh?.indexedThroughBlockHash ?? "").toLowerCase() ===
        String(item.indexedThroughBlockHash ?? "").toLowerCase() &&
      /^[0-9a-f]{64}$/u.test(String(item.sourceHashes?.canonicalSummary ?? "")) &&
      canonicalSummaryCoverage(item.summaryPayloads) > 0 &&
      canonicalSummaryAccountingModelsCurrent(item.summaryPayloads) &&
      exactSummarySnapshotTotalsCurrent(item),
  );
}

async function publicLogRelationalFingerprint(client) {
  const result = await client.query(
    `
      SELECT
        e.event_id,
        e.txid,
        e.protocol,
        e.kind,
        e.status,
        e.valid,
        e.block_height,
        e.block_time,
        e.event_time,
        e.created_at,
        md5(e.payload::text) AS payload_hash
      FROM proof_indexer.events e
      WHERE e.network = $1
        AND e.valid = true
        AND e.status IN ('confirmed', 'pending')
        AND e.kind = ANY($2::text[])
      ORDER BY e.event_id ASC
    `,
    [NETWORK, [...PUBLIC_LOG_EVENT_KINDS]],
  );
  const hash = createHash("sha256");
  let pending = 0;
  for (const row of result.rows) {
    if (row.status === "pending") {
      pending += 1;
    }
    hash.update(
      JSON.stringify([
        String(row.event_id),
        row.txid,
        row.protocol,
        row.kind,
        row.status,
        row.valid,
        row.block_height,
        row.block_time,
        row.event_time,
        row.created_at,
        row.payload_hash,
      ]),
    );
    hash.update("\n");
  }
  return {
    contract: "proof-index-public-log-fingerprint-v1",
    count: result.rows.length,
    hash: hash.digest("hex"),
    pending,
  };
}

function publicLogFingerprintsMatch(left, right) {
  return Boolean(
    left?.contract === "proof-index-public-log-fingerprint-v1" &&
      right?.contract === left.contract &&
      Number(right.count) === Number(left.count) &&
      Number(right.pending) === Number(left.pending) &&
      /^[0-9a-f]{64}$/u.test(String(left.hash ?? "")) &&
      right.hash === left.hash,
  );
}

async function storedEligibleCanonicalSummarySnapshotPayload(client) {
  const result = await client.query(
    `
      SELECT payload
      FROM proof_indexer.ledger_snapshots
      WHERE network = $1
        AND payload->>'workAmountStorageModel' = $2
        AND COALESCE(consistency->>'ok', payload->>'ok', 'false') = 'true'
        AND COALESCE(consistency->>'status', payload->>'status', '') <> 'summary-snapshot-fallback'
        AND payload->'summaryRefresh'->>'mode' = 'canonical-summary-refresh'
        AND payload->'totals'->>'workNetworkValueAccountingModel' = 'canonical-exact-work-network-q8-v1'
        AND payload->'summaryPayloads'->'workFloor'->>'workNetworkValueAccountingModel' = 'canonical-exact-work-network-q8-v1'
        AND payload->'summaryPayloads'->'workFloor'->'actualValue'->>'workNetworkValueAccountingModel' = 'canonical-exact-work-network-q8-v1'
        AND payload->>'indexedThroughBlockHash' ~ '^[0-9a-fA-F]{64}$'
        AND payload->'summaryRefresh'->>'indexedThroughBlockHash' = payload->>'indexedThroughBlockHash'
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
      ORDER BY generated_at DESC
      LIMIT 1
    `,
    [NETWORK, WORK_ATOMIC_PROJECTION_MODEL],
  );
  const payload = result.rows[0]?.payload;
  return eligibleCanonicalSummarySnapshotPayload(payload) ? payload : null;
}

function canonicalSummaryRefreshCanDefer(error) {
  const statusCode = Number(error?.statusCode ?? 0);
  const errorText = [error?.message, error?.responseText]
    .filter(Boolean)
    .join(" ");
  return (
    error?.name === "AbortError" ||
    /operation was aborted/iu.test(errorText) ||
    (statusCode === 503 &&
      /(?:not exactly at the Bitcoin Core tip|tip changed during canonical summary construction|canonical summary.*(?:timed out|catching up))/iu.test(
        errorText,
      ))
  );
}

async function pruneLedgerSnapshots(
  client,
  {
    canonicalSummaryLimit = LEDGER_CANONICAL_SUMMARY_RETENTION,
    scanSnapshotLimit = LEDGER_SCAN_SNAPSHOT_RETENTION,
  } = {},
) {
  const boundedCanonicalSummaryLimit = Math.max(
    1,
    Math.floor(Number(canonicalSummaryLimit) || 0),
  );
  const boundedScanSnapshotLimit = Math.max(
    1,
    Math.floor(Number(scanSnapshotLimit) || 0),
  );
  const result = await client.query(
    `
      WITH ranked AS MATERIALIZED (
        SELECT
          snapshot_id,
          source_hashes ? 'canonicalSummary' AS canonical_summary,
          row_number() OVER (
            PARTITION BY (source_hashes ? 'canonicalSummary')
            ORDER BY generated_at DESC, snapshot_id DESC
          ) AS retention_rank
        FROM proof_indexer.ledger_snapshots
        WHERE network = $1
      ),
      referenced AS MATERIALIZED (
        SELECT DISTINCT payload->>'issuanceValueSnapshotId' AS snapshot_id
        FROM proof_indexer.events
        WHERE network = $1
          AND COALESCE(payload->>'issuanceValueSnapshotId', '') <> ''
        UNION
        SELECT DISTINCT entry->'snapshot'->>'snapshotId' AS snapshot_id
        FROM proof_indexer.meta rebuild
        JOIN proof_indexer.meta witness
          ON witness.key = rebuild.value->'verifierBinding'->>'witnessSetMetaKey'
        CROSS JOIN LATERAL jsonb_array_elements(
          COALESCE(witness.value->'entries', '[]'::jsonb)
        ) entry
        WHERE rebuild.key = $4
          AND rebuild.value->>'network' = $1
          AND witness.value->>'network' = $1
          AND witness.value->>'model' = $5
          AND entry->>'disposition' = 'preserve'
      )
      DELETE FROM proof_indexer.ledger_snapshots snapshot
      USING ranked
      WHERE snapshot.network = $1
        AND snapshot.snapshot_id = ranked.snapshot_id
        AND (
          (
            ranked.canonical_summary
            AND ranked.retention_rank > $2::integer
          )
          OR (
            NOT ranked.canonical_summary
            AND ranked.retention_rank > $3::integer
          )
        )
        AND NOT EXISTS (
          SELECT 1
          FROM referenced
          WHERE referenced.snapshot_id = snapshot.snapshot_id
        )
      RETURNING
        snapshot.snapshot_id,
        snapshot.source_hashes ? 'canonicalSummary' AS canonical_summary
    `,
    [
      NETWORK,
      boundedCanonicalSummaryLimit,
      boundedScanSnapshotLimit,
      CANONICAL_REBUILD_META_KEY,
      INCB_RANGE_REPLAY_WITNESS_MANIFEST_MODEL,
    ],
  );
  return {
    canonicalSummaries: result.rows.filter(
      (row) => row?.canonical_summary === true,
    ).length,
    scanOrDerived: result.rows.filter(
      (row) => row?.canonical_summary !== true,
    ).length,
    total: result.rows.length,
  };
}

async function storeCanonicalSummarySnapshot(client, options = {}) {
  const latestCheckpoint = await latestBlockScanCheckpoint(client, {
    useStoredCheckpoint: true,
  });
  const latestIndexedHeight = latestCheckpoint.height;
  const latestIndexedThroughBlockHash = String(latestCheckpoint.blockHash ?? "")
    .trim()
    .toLowerCase();
  const requiredCheckpoint = objectPayload(options.requiredCheckpoint);
  const requiredCheckpointHeight = Number(requiredCheckpoint?.height);
  const requiredCheckpointHash = String(requiredCheckpoint?.blockHash ?? "")
    .trim()
    .toLowerCase();
  const checkpointRequired = requiredCheckpoint !== null;
  if (
    checkpointRequired &&
    (!Number.isSafeInteger(requiredCheckpointHeight) ||
      requiredCheckpointHeight <= 0 ||
      !/^[0-9a-f]{64}$/u.test(requiredCheckpointHash) ||
      latestIndexedHeight !== requiredCheckpointHeight ||
      latestIndexedThroughBlockHash !== requiredCheckpointHash)
  ) {
    throw new Error(
      `Canonical summary checkpoint ${latestIndexedHeight}:${latestIndexedThroughBlockHash || "missing"} does not match required checkpoint ${requiredCheckpointHeight}:${requiredCheckpointHash || "missing"}`,
    );
  }
  const previousPayload = await storedEligibleCanonicalSummarySnapshotPayload(
    client,
  );
  const previousCoverage = previousPayload
    ? canonicalSummaryCoverage(previousPayload.summaryPayloads)
    : 0;
  const previousIndexedThroughBlockHash = String(
    previousPayload?.indexedThroughBlockHash ?? "",
  )
    .trim()
    .toLowerCase();
  const currentPublicLogFingerprint = await publicLogRelationalFingerprint(
    client,
  );
  const previousPublicLogFingerprint = objectPayload(
    previousPayload?.summaryRefresh?.publicLogFingerprint,
  );
  if (
    previousCoverage === latestIndexedHeight &&
    previousIndexedThroughBlockHash === latestIndexedThroughBlockHash &&
    canonicalSummaryAccountingModelsCurrent(previousPayload?.summaryPayloads) &&
    publicLogFingerprintsMatch(
      currentPublicLogFingerprint,
      previousPublicLogFingerprint,
    )
  ) {
    return {
      indexedThroughBlock: previousCoverage,
      indexedThroughBlockHash: previousIndexedThroughBlockHash,
      reason: "already-current",
      skipped: true,
      snapshotId: previousPayload?.snapshotId ?? null,
    };
  }

  let canonicalBundle;
  try {
    const canonicalSummaryUrl = unpagedEndpoint(
      "/api/v1/internal/canonical-summary",
    );
    if (checkpointRequired) {
      canonicalSummaryUrl.searchParams.set(
        "checkpointHeight",
        String(requiredCheckpointHeight),
      );
      canonicalSummaryUrl.searchParams.set(
        "checkpointHash",
        requiredCheckpointHash,
      );
    }
    canonicalBundle = await readJson(
      canonicalSummaryUrl,
      {
        retries: 0,
        timeoutMs: CANONICAL_SUMMARY_REFRESH_TIMEOUT_MS,
      },
    );
  } catch (error) {
    if (
      checkpointRequired ||
      !previousPayload ||
      !canonicalSummaryRefreshCanDefer(error)
    ) {
      throw error;
    }
    console.error(
      JSON.stringify({
        error: error?.message ?? String(error),
        indexedThroughBlock: previousCoverage,
        latestIndexedHeight,
        phase: "canonical-summary-refresh",
        retryingNextCycle: true,
      }),
    );
    return {
      indexedThroughBlock: previousCoverage,
      indexedThroughBlockHash: previousIndexedThroughBlockHash,
      latestIndexedHeight,
      reason: "canonical-summary-deferred",
      skipped: true,
      snapshotId: previousPayload.snapshotId ?? null,
    };
  }
  const ledger = objectPayload(canonicalBundle?.ledger);
  const canonicalBundleHash = String(
    canonicalBundle?.indexedThroughBlockHash ?? "",
  )
    .trim()
    .toLowerCase();
  const ledgerHash = String(ledger?.indexedThroughBlockHash ?? "")
    .trim()
    .toLowerCase();
  const ledgerCoverage = Math.max(
    numberOrNull(ledger?.indexedThroughBlock) ?? 0,
    numberOrNull(ledger?.metrics?.indexedThroughBlock) ?? 0,
  );
  if (
    ledger?.ok !== true ||
    ledger?.status === "summary-snapshot-fallback" ||
    ledgerCoverage !== latestIndexedHeight ||
    numberOrNull(canonicalBundle?.indexedThroughBlock) !== latestIndexedHeight ||
    canonicalBundleHash !== latestIndexedThroughBlockHash ||
    ledgerHash !== latestIndexedThroughBlockHash
  ) {
    throw new Error(
      `Canonical ledger summary refresh is not current through block ${latestIndexedHeight}`,
    );
  }

  const summaryPayloads = summaryPayloadsWithAlignedWorkFloor(
    canonicalBundle?.summaryPayloads,
  );
  const finalPublicLogFingerprint = await publicLogRelationalFingerprint(client);
  const indexedThroughBlock = canonicalSummaryCoverage(summaryPayloads);
  const snapshotId = String(canonicalBundle?.snapshotId ?? "").trim();
  const summarySnapshotIds = REQUIRED_CURRENT_SUMMARY_KEYS.map((key) =>
    summaryPayloadSnapshotId(summaryPayloads?.[key]),
  );
  const summaryCheckpointHashes = REQUIRED_CURRENT_SUMMARY_KEYS.map((key) =>
    String(summaryPayloads?.[key]?.indexedThroughBlockHash ?? "")
      .trim()
      .toLowerCase(),
  );
  const logSummary = objectPayload(summaryPayloads.logSummary);
  const logSummaryTotal = Number(
    logSummary?.totalCount ?? logSummary?.stats?.total ?? -1,
  );
  const logSummaryPending = Number(logSummary?.stats?.pending ?? -1);
  if (
    indexedThroughBlock !== latestIndexedHeight ||
    !publicLogFingerprintsMatch(
      currentPublicLogFingerprint,
      finalPublicLogFingerprint,
    ) ||
    logSummaryTotal !== finalPublicLogFingerprint.count ||
    logSummaryPending !== finalPublicLogFingerprint.pending ||
    !canonicalSummaryAccountingModelsCurrent(summaryPayloads) ||
    !snapshotId ||
    String(ledger.snapshotId ?? "").trim() !== snapshotId ||
    summarySnapshotIds.some((value) => value !== snapshotId) ||
    summaryCheckpointHashes.some(
      (value) => value !== latestIndexedThroughBlockHash,
    )
  ) {
    throw new Error(
      `Canonical summary refresh is not one exact snapshot through block ${latestIndexedHeight}`,
    );
  }
  const sameSnapshotPayload = await storedLedgerSnapshotPayload(
    client,
    snapshotId,
  );
  const atomicWorkProjectionReady =
    await workAtomicProjectionReady(client);
  const {
    workAmountStorageModel: _previousWorkAmountStorageModel,
    ...previousSnapshotPayload
  } = objectPayload(previousPayload) ?? {};
  const {
    workAmountStorageModel: _sameSnapshotWorkAmountStorageModel,
    ...sameStoredSnapshotPayload
  } = objectPayload(sameSnapshotPayload) ?? {};
  const {
    workAmountStorageModel: _ledgerWorkAmountStorageModel,
    ...canonicalLedgerPayload
  } = objectPayload(ledger) ?? {};

  const generatedAt = new Date().toISOString();
  const summaryHash = createHash("sha256")
    .update(JSON.stringify(summaryPayloads))
    .digest("hex");
  const snapshotPayload = {
    ...previousSnapshotPayload,
    ...sameStoredSnapshotPayload,
    ...canonicalLedgerPayload,
    ...(atomicWorkProjectionReady
      ? { workAmountStorageModel: WORK_ATOMIC_PROJECTION_MODEL }
      : {}),
    generatedAt,
    indexedThroughBlockHash: latestIndexedThroughBlockHash,
    snapshotId,
    sourceHashes: {
      ...(ledger.sourceHashes ?? {}),
      blockScan: latestIndexedThroughBlockHash,
      canonicalSummary: summaryHash,
      publicLogRelational: finalPublicLogFingerprint.hash,
    },
    summaryPayloads,
    summaryPayloadsIndexedAt: generatedAt,
    summaryRefresh: {
      indexedThroughBlock,
      indexedThroughBlockHash: latestIndexedThroughBlockHash,
      mode: "canonical-summary-refresh",
      previousCoverage,
      publicLogFingerprint: finalPublicLogFingerprint,
    },
    totals: summarySnapshotTotals(summaryPayloads),
  };
  await client.query(
    `
      INSERT INTO proof_indexer.ledger_snapshots (
        network,
        snapshot_id,
        generated_at,
        indexed_through_block,
        source_hashes,
        metrics,
        consistency,
        payload
      )
      VALUES ($1, $2, $3::timestamptz, $4, $5::jsonb, $6::jsonb, $7::jsonb, $8::jsonb)
      ON CONFLICT (network, snapshot_id)
      DO UPDATE SET
        generated_at = EXCLUDED.generated_at,
        indexed_through_block = EXCLUDED.indexed_through_block,
        source_hashes = EXCLUDED.source_hashes,
        metrics = EXCLUDED.metrics,
        consistency = EXCLUDED.consistency,
        payload = EXCLUDED.payload
      WHERE NOT EXISTS (
        SELECT 1
        FROM proof_indexer.events issuance_event
        WHERE issuance_event.network = EXCLUDED.network
          AND issuance_event.payload->>'issuanceValueSnapshotId' =
            EXCLUDED.snapshot_id
      )
        AND NOT EXISTS (
          SELECT 1
          FROM proof_indexer.meta rebuild
          JOIN proof_indexer.meta witness
            ON witness.key =
              rebuild.value->'verifierBinding'->>'witnessSetMetaKey'
          CROSS JOIN LATERAL jsonb_array_elements(
            COALESCE(witness.value->'entries', '[]'::jsonb)
          ) entry
          WHERE rebuild.key = $9
            AND rebuild.value->>'network' = EXCLUDED.network
            AND witness.value->>'network' = EXCLUDED.network
            AND witness.value->>'model' = $10
            AND entry->>'disposition' = 'preserve'
            AND entry->'snapshot'->>'snapshotId' = EXCLUDED.snapshot_id
        )
    `,
    [
      NETWORK,
      snapshotId,
      generatedAt,
      ledgerCoverage,
      JSON.stringify(snapshotPayload.sourceHashes ?? {}),
      JSON.stringify(ledger.metrics ?? {}),
      JSON.stringify({
        checks: ledger.checks ?? [],
        missingLogEvents: ledger.missingLogEvents ?? [],
        ok: ledger.ok,
        status: ledger.status,
      }),
      JSON.stringify(snapshotPayload),
      CANONICAL_REBUILD_META_KEY,
      INCB_RANGE_REPLAY_WITNESS_MANIFEST_MODEL,
    ],
  );
  const snapshotRetention = await pruneLedgerSnapshots(client);
  return {
    indexedThroughBlock,
    indexedThroughBlockHash: latestIndexedThroughBlockHash,
    previousCoverage,
    skipped: false,
    snapshotId,
    snapshotRetention,
  };
}

async function repairStoredSummarySnapshot(client) {
  await storeCanonicalSummarySnapshot(client);
  const snapshotPayload = await storedEligibleCanonicalSummarySnapshotPayload(
    client,
  );
  if (!snapshotPayload) {
    throw new Error("Canonical summary refresh did not publish an eligible snapshot.");
  }
  return snapshotPayload;
}

async function latestIndexedBlockHeight(client) {
  const result = await client.query(
    `
      SELECT GREATEST(
        COALESCE((
          SELECT max(block_height)
          FROM proof_indexer.transactions
          WHERE network = $1 AND status = 'confirmed'
        ), 0),
        COALESCE((
          SELECT max(indexed_through_block)
          FROM proof_indexer.ledger_snapshots
          WHERE network = $1
        ), 0)
      ) AS height
    `,
    [NETWORK],
  );
  const height = Number(result.rows[0]?.height ?? 0);
  return Number.isSafeInteger(height) && height > 0 ? height : 0;
}

const CANONICAL_REBUILD_META_KEY = "canonical:rebuild";
const CANONICAL_FAULT_META_KEY = "canonical:fault";

async function proofIndexerMetaValue(client, key) {
  const result = await client.query(
    `SELECT value FROM proof_indexer.meta WHERE key = $1 LIMIT 1`,
    [key],
  );
  const value = result.rows[0]?.value;
  return value && typeof value === "object" && !Array.isArray(value)
    ? value
    : null;
}

async function storeProofIndexerMeta(client, key, value) {
  await client.query(
    `
      INSERT INTO proof_indexer.meta (key, value, updated_at)
      VALUES ($1, $2::jsonb, now())
      ON CONFLICT (key)
      DO UPDATE SET value = EXCLUDED.value, updated_at = now()
    `,
    [key, JSON.stringify(value)],
  );
}

async function migrateUnboundedCreditUnitStorage(client) {
  const expectedColumns = [
    ["credit_definitions", "max_supply"],
    ["credit_definitions", "mint_amount"],
    ["credit_balances", "confirmed_balance"],
    ["credit_balances", "pending_delta"],
    ["credit_listings", "amount"],
  ];
  const expectedColumnKeys = new Set(
    expectedColumns.map(([tableName, columnName]) =>
      `${tableName}.${columnName}`
    ),
  );
  const inspectColumns = async () => {
    const result = await client.query(
      `
        SELECT
          c.relname AS table_name,
          a.attname AS column_name,
          a.atttypmod,
          format_type(a.atttypid, a.atttypmod) AS formatted_type
        FROM pg_attribute a
        JOIN pg_class c ON c.oid = a.attrelid
        JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'proof_indexer'
          AND c.relname = ANY($1::text[])
          AND a.attname = ANY($2::text[])
          AND NOT a.attisdropped
      `,
      [
        ["credit_definitions", "credit_balances", "credit_listings"],
        [
          "max_supply",
          "mint_amount",
          "confirmed_balance",
          "pending_delta",
          "amount",
        ],
      ],
    );
    const rows = result.rows.filter((row) =>
      expectedColumnKeys.has(`${row.table_name}.${row.column_name}`)
    );
    const rowByKey = new Map(
      rows.map((row) => [`${row.table_name}.${row.column_name}`, row]),
    );
    const missing = [...expectedColumnKeys].filter((key) => !rowByKey.has(key));
    const wrongType = rows.filter(
      (row) => !/^numeric(?:\(|$)/u.test(String(row.formatted_type ?? "")),
    );
    if (missing.length > 0 || wrongType.length > 0) {
      throw new Error(
        `Credit-unit storage migration found an unexpected schema: missing=${missing.join(",") || "none"} wrongType=${wrongType
          .map((row) => `${row.table_name}.${row.column_name}:${row.formatted_type}`)
          .join(",") || "none"}`,
      );
    }
    return rows;
  };

  const before = await inspectColumns();
  const constrainedKeys = before
    .filter((row) => Number(row.atttypmod) !== -1)
    .map((row) => `${row.table_name}.${row.column_name}`)
    .sort();
  if (
    constrainedKeys.some((key) => key.startsWith("credit_definitions."))
  ) {
    await client.query(
      `
        ALTER TABLE proof_indexer.credit_definitions
          ALTER COLUMN max_supply TYPE numeric USING max_supply::numeric,
          ALTER COLUMN mint_amount TYPE numeric USING mint_amount::numeric
      `,
    );
  }
  if (constrainedKeys.some((key) => key.startsWith("credit_balances."))) {
    await client.query(
      `
        ALTER TABLE proof_indexer.credit_balances
          ALTER COLUMN confirmed_balance TYPE numeric
            USING confirmed_balance::numeric,
          ALTER COLUMN pending_delta TYPE numeric USING pending_delta::numeric
      `,
    );
  }
  if (constrainedKeys.includes("credit_listings.amount")) {
    await client.query(
      `
        ALTER TABLE proof_indexer.credit_listings
          ALTER COLUMN amount TYPE numeric USING amount::numeric
      `,
    );
  }

  const constraintSpecs = [
    {
      name: "credit_definitions_max_supply_integer",
      table: "credit_definitions",
      expression: "max_supply::text ~ '^(0|[1-9][0-9]*)$'",
    },
    {
      name: "credit_definitions_mint_amount_integer",
      table: "credit_definitions",
      expression: "mint_amount::text ~ '^[1-9][0-9]*$'",
    },
    {
      name: "credit_balances_confirmed_balance_integer",
      table: "credit_balances",
      expression: "confirmed_balance::text ~ '^(0|[1-9][0-9]*)$'",
    },
    {
      name: "credit_balances_pending_delta_integer",
      table: "credit_balances",
      expression: "pending_delta::text ~ '^-?(0|[1-9][0-9]*)$'",
    },
    {
      name: "credit_listings_amount_integer",
      table: "credit_listings",
      expression: "amount::text ~ '^[1-9][0-9]*$'",
    },
  ];
  const existingConstraints = await client.query(
    `
      SELECT c.relname AS table_name, p.conname, p.convalidated
      FROM pg_constraint p
      JOIN pg_class c ON c.oid = p.conrelid
      JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'proof_indexer'
        AND p.conname = ANY($1::text[])
    `,
    [constraintSpecs.map((spec) => spec.name)],
  );
  const existingConstraintNames = new Set(
    existingConstraints.rows.map((row) => String(row.conname ?? "")),
  );
  const addedConstraints = [];
  for (const spec of constraintSpecs) {
    if (!existingConstraintNames.has(spec.name)) {
      await client.query(
        `ALTER TABLE proof_indexer.${spec.table} ADD CONSTRAINT ${spec.name} CHECK (${spec.expression}) NOT VALID`,
      );
      addedConstraints.push(spec.name);
    }
    await client.query(
      `ALTER TABLE proof_indexer.${spec.table} VALIDATE CONSTRAINT ${spec.name}`,
    );
  }

  const normalizedBonds = await client.query(
    `
      UPDATE proof_indexer.credit_definitions
      SET
        max_supply = 0,
        metadata = (metadata - 'maxSupplyStorage') || jsonb_build_object(
          'maxSupply', NULL,
          'maxSupplyModel', 'uncapped',
          'uncapped', true
        )
      WHERE network = $1
        AND (
          (token_id = $2 AND upper(ticker) = 'POWB')
          OR (token_id = $3 AND upper(ticker) = 'INCB')
        )
        AND (
          max_supply <> 0
          OR metadata ? 'maxSupplyStorage'
          OR metadata->'maxSupply' IS DISTINCT FROM 'null'::jsonb
          OR metadata->>'maxSupplyModel' IS DISTINCT FROM 'uncapped'
          OR metadata->>'uncapped' IS DISTINCT FROM 'true'
        )
    `,
    [NETWORK, POWB_TOKEN_ID, INCB_TOKEN_ID],
  );
  const after = await inspectColumns();
  const remainingConstrained = after.filter(
    (row) => Number(row.atttypmod) !== -1,
  );
  if (remainingConstrained.length > 0) {
    throw new Error(
      `Credit-unit storage migration left constrained columns: ${remainingConstrained
        .map((row) => `${row.table_name}.${row.column_name}`)
        .join(",")}`,
    );
  }
  const verifiedConstraints = await client.query(
    `
      SELECT p.conname, p.convalidated
      FROM pg_constraint p
      JOIN pg_class c ON c.oid = p.conrelid
      JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'proof_indexer'
        AND p.conname = ANY($1::text[])
    `,
    [constraintSpecs.map((spec) => spec.name)],
  );
  const validatedNames = new Set(
    verifiedConstraints.rows
      .filter((row) => row.convalidated === true)
      .map((row) => String(row.conname ?? "")),
  );
  const unvalidated = constraintSpecs
    .map((spec) => spec.name)
    .filter((name) => !validatedNames.has(name));
  if (unvalidated.length > 0) {
    throw new Error(
      `Credit-unit storage migration did not validate: ${unvalidated.join(",")}`,
    );
  }
  const bondDefinitions = await client.query(
    `
      SELECT token_id, max_supply::text AS max_supply, metadata
      FROM proof_indexer.credit_definitions
      WHERE network = $1 AND token_id = ANY($2::text[])
    `,
    [NETWORK, [POWB_TOKEN_ID, INCB_TOKEN_ID]],
  );
  for (const row of bondDefinitions.rows) {
    if (
      String(row.max_supply ?? "") !== BOND_UNCAPPED_MAX_SUPPLY_STORAGE ||
      row?.metadata?.maxSupply !== null ||
      row?.metadata?.maxSupplyModel !== "uncapped" ||
      row?.metadata?.uncapped !== true
    ) {
      throw new Error(
        `Synthetic bond ${row.token_id} did not migrate to the uncapped storage contract.`,
      );
    }
  }
  return {
    addedConstraints: addedConstraints.sort(),
    alteredColumns: constrainedKeys,
    normalizedBondDefinitions: Number(normalizedBonds.rowCount ?? 0),
    storageModel: "unconstrained-integer-numeric-v1",
  };
}

function canonicalIncbPwtRangeReplayTargets(fromHeight) {
  const normalizedHeight = Number(fromHeight);
  if (
    !Number.isSafeInteger(normalizedHeight) ||
    normalizedHeight > CANONICAL_INCB_PWT_RANGE_REPLAY_FROM_HEIGHT
  ) {
    return [];
  }
  return CANONICAL_INCB_PWT_RANGE_REPLAY_TARGETS.filter(
    (target) => target.blockHeight >= normalizedHeight,
  );
}

async function verifyCanonicalIncbPwtRangeReplayCoreFacts(targets) {
  const verified = [];
  const blockByHash = new Map();
  for (const target of Array.isArray(targets) ? targets : []) {
    const canonicalHash = String(
      await bitcoinRpc("getblockhash", [target.blockHeight]),
    )
      .trim()
      .toLowerCase();
    if (canonicalHash !== target.blockHash) {
      throw new Error(
        `Pinned INCB replay block ${target.blockHeight} changed from ${target.blockHash} to ${canonicalHash || "unknown"}.`,
      );
    }
    let block = blockByHash.get(target.blockHash);
    if (!block) {
      block = await bitcoinRpc("getblock", [target.blockHash, 2]);
      assertCanonicalBlockEnvelope(block, target.blockHeight, target.blockHash);
      blockByHash.set(target.blockHash, block);
    }
    if (
      Number(block?.time) !== target.blockTime ||
      String(block?.tx?.[target.blockIndex]?.txid ?? "")
        .trim()
        .toLowerCase() !== target.txid
    ) {
      throw new Error(
        `Pinned INCB replay transaction ${target.txid} changed exact Core block position.`,
      );
    }
    const hydrated = await transactionWithInputPrevouts({
      ...block.tx[target.blockIndex],
      _powBlockHash: target.blockHash,
      _powBlockIndex: target.blockIndex,
      _powPreviousBlockHash: String(block?.previousblockhash ?? "")
        .trim()
        .toLowerCase(),
      blocktime: block.time,
      height: target.blockHeight,
    });
    assertHydratedProtocolTransaction(hydrated);
    const messages = protocolMessagesFromTx(hydrated);
    const expectedWorkPayload = [
      "pwt1",
      "send2",
      WORK_TOKEN_ID,
      target.workAmountAtoms,
      target.bondRecipientAddress,
    ].join(":");
    const memoMessages = messages.filter(
      (message) =>
        message?.text === `pwm1:m:${INCEPTION_BOND_MEMO}` &&
        Number(message?.voutIndex) === target.bondMemoVout,
    );
    const workMessages = messages.filter(
      (message) =>
        message?.text === expectedWorkPayload &&
        Number(message?.voutIndex) === target.workProtocolVout,
    );
    const bondOutput = hydrated.vout?.[target.bondRecipientVout];
    const registryOutput = hydrated.vout?.[target.workRegistryPaymentVout];
    if (
      memoMessages.length !== 1 ||
      workMessages.length !== 1 ||
      addressFromVout(bondOutput) !== target.bondRecipientAddress ||
      satsFromVoutValue(bondOutput?.value) !==
        BigInt(target.bondRecipientAmountSats) ||
      addressFromVout(registryOutput) !== WORK_TOKEN_REGISTRY_ADDRESS ||
      satsFromVoutValue(registryOutput?.value) !== 546n ||
      senderAddressFromTx(hydrated) !== target.bondRecipientAddress
    ) {
      throw new Error(
        `Pinned INCB replay transaction ${target.txid} changed immutable bond or WORK attachment facts.`,
      );
    }
    verified.push({
      blockHash: target.blockHash,
      blockHeight: target.blockHeight,
      blockIndex: target.blockIndex,
      txid: target.txid,
      workAmountAtoms: target.workAmountAtoms,
    });
  }
  return verified;
}

function canonicalIncbReplayAttachedWorkAtoms(rawTx, recipientAddress) {
  const canonicalRecipient = String(recipientAddress ?? "").trim();
  let total = 0n;
  for (const message of protocolMessagesFromTx(objectValue(rawTx))) {
    const parts = String(message?.text ?? "").split(":");
    if (
      parts[0] !== "pwt1" ||
      String(parts[2] ?? "").trim().toLowerCase() !== WORK_TOKEN_ID ||
      String(parts[4] ?? "").trim() !== canonicalRecipient
    ) {
      continue;
    }
    if (parts[1] === "send2") {
      const atoms = canonicalWorkAtomsText(parts[3]);
      if (!atoms) {
        throw new Error(
          `Canonical INCB bond attachment for ${canonicalRecipient} has malformed WORK atoms.`,
        );
      }
      total += BigInt(atoms);
      continue;
    }
    if (parts[1] === "send") {
      const units = canonicalIntegerText(parts[3], { positive: true });
      if (!units) {
        throw new Error(
          `Canonical INCB bond attachment for ${canonicalRecipient} has malformed legacy WORK units.`,
        );
      }
      total += BigInt(units) * WORK_UNIT_SCALE;
    }
  }
  return total.toString();
}

function canonicalIncbReplayRawSnapshotMaterial(row) {
  return {
    consistencyJson: String(row?.raw_consistency_json ?? ""),
    generatedAt: new Date(row?.generated_at).toISOString(),
    indexedThroughBlock: Number(row?.indexed_through_block),
    metricsJson: String(row?.raw_metrics_json ?? ""),
    payloadJson: String(row?.raw_payload_json ?? ""),
    snapshotId: String(row?.snapshot_id ?? ""),
    sourceHashesJson: String(row?.raw_source_hashes_json ?? ""),
  };
}

function canonicalIncbReplaySnapshotDescriptorFromRow(row, binding = null) {
  const storedWorkNetworkValue =
    lockedCanonicalIncbSnapshotWorkNetworkValueQ8(row);
  const exactMintQ8 = canonicalNonNegativeQ8Text(
    binding?.workNetworkValueQ8,
    { positive: true },
  );
  const hasAccountingMarker = [
    row?.totals_work_network_value_model,
    row?.work_floor_network_value_model,
    row?.work_actual_network_value_model,
  ].some((value) => String(value ?? "").trim().length > 0);
  const canBindLegacySnapshotToExactMint = Boolean(
    binding?.workNetworkValueWitnessMode ===
      WORK_NETWORK_VALUE_ACCOUNTING_MODEL &&
      exactMintQ8 &&
      !hasAccountingMarker,
  );
  const workNetworkValue =
    storedWorkNetworkValue?.valueQ8 === exactMintQ8
      ? storedWorkNetworkValue
      : canBindLegacySnapshotToExactMint
        ? {
            mode: INCB_RANGE_REPLAY_EXACT_MINT_LEGACY_SNAPSHOT_MODE,
            valueQ8: exactMintQ8,
          }
        : storedWorkNetworkValue;
  return normalizeIncbReplaySnapshotDescriptor({
    canonicalSummaryHash: String(
      row?.canonical_summary_hash ?? "",
    ).trim().toLowerCase(),
    consistencyOk: String(row?.consistency_ok ?? "") === "true",
    consistencyStatus: String(row?.consistency_status ?? ""),
    generatedAt: new Date(row?.generated_at).toISOString(),
    indexedThroughBlock: Number(row?.indexed_through_block),
    payloadBlockHash: String(row?.payload_block_hash ?? "")
      .trim().toLowerCase(),
    payloadSnapshotId: String(row?.payload_snapshot_id ?? ""),
    rawSnapshotFingerprint: incbReplayRawSnapshotFingerprint(
      canonicalIncbReplayRawSnapshotMaterial(row),
    ),
    snapshotId: String(row?.snapshot_id ?? ""),
    sourceBlockHash: String(row?.source_block_hash ?? "")
      .trim().toLowerCase(),
    summaryRefreshBlockHash: String(
      row?.summary_refresh_block_hash ?? "",
    ).trim().toLowerCase(),
    summaryRefreshMode: String(row?.summary_refresh_mode ?? ""),
    workFloorBlockHash: String(row?.work_floor_block_hash ?? "")
      .trim().toLowerCase(),
    workFloorHeight: Number(row?.work_floor_height),
    workFloorSnapshotId: String(row?.work_floor_snapshot_id ?? ""),
    workNetworkValueMode: workNetworkValue?.mode ?? "",
    workNetworkValueQ8: workNetworkValue?.valueQ8 ?? "",
  });
}

function canonicalIncbReplayMintIsExact(
  mint,
  { bond },
) {
  const attachedWorkAmountAtoms = String(
    bond?.attachedWorkAmountAtoms ?? "",
  );
  const exactFields = {
    attachedWorkAmountAtoms: canonicalWorkAtomsText(
      mint?.attachedWorkAmountAtoms,
      { allowZero: true },
    ),
    attachedWorkLiveFloorAtSendQ8: canonicalIntegerText(
      mint?.attachedWorkLiveFloorAtSendQ8,
      { positive: true },
    ),
    attachedWorkLiveValueAtSendQ8: canonicalIntegerText(
      mint?.attachedWorkLiveValueAtSendQ8,
    ),
    issuanceDustQ8: canonicalIntegerText(mint?.issuanceDustQ8),
    issuanceNetworkValueQ8: canonicalIntegerText(
      mint?.issuanceNetworkValueQ8,
      { positive: true },
    ),
    issuanceValueSnapshotWorkNetworkValueQ8: canonicalIntegerText(
      mint?.issuanceValueSnapshotWorkNetworkValueQ8,
      { positive: true },
    ),
  };
  return Boolean(
    canonicalIncbIssuanceMintProjection(mint) &&
      Object.values(exactFields).every(Boolean) &&
      exactFields.attachedWorkAmountAtoms === attachedWorkAmountAtoms &&
      String(mint?.txid ?? "").trim().toLowerCase() === bond.txid &&
      String(mint?.sourceBondTxid ?? "").trim().toLowerCase() === bond.txid &&
      String(mint?.minterAddress ?? "").trim() ===
        bond.bondRecipientAddress &&
      String(mint?.bondRecipientAddress ?? "").trim() ===
        bond.bondRecipientAddress &&
      canonicalIntegerText(mint?.bondRecipientAmountSats, {
        positive: true,
      }) === bond.bondRecipientAmountSats &&
      canonicalIntegerText(mint?.directProofIssuanceUnits, {
        positive: true,
      }) === bond.bondRecipientAmountSats &&
      canonicalIntegerText(mint?.proofPaymentSats ?? mint?.paidSats, {
        positive: true,
      }) === bond.bondRecipientAmountSats &&
      Number(mint?.bondRecipientVout) === bond.bondRecipientVout &&
      Number(mint?.blockHeight ?? mint?.height) === bond.blockHeight &&
      Number(mint?.blockIndex ?? mint?._powBlockIndex) === bond.blockIndex &&
      String(mint?.blockHash ?? mint?._powBlockHash ?? "")
        .trim()
        .toLowerCase() === bond.blockHash &&
      Number(mint?.issuanceValueSnapshotBlockHeight) ===
        bond.blockHeight - 1 &&
      String(mint?.issuanceValueSnapshotBlockHash ?? "")
        .trim()
        .toLowerCase() === bond.previousBlockHash
  );
}

function canonicalIncbReplayRejectedSibling(row) {
  const payload = objectValue(row?.payload);
  const tokenId = String(payload?.tokenId ?? "").trim().toLowerCase();
  const sourceKind = String(payload?.sourceKind ?? "").trim().toLowerCase();
  const attemptedKind = String(payload?.attemptedKind ?? "")
    .trim()
    .toLowerCase();
  return Boolean(
    row?.valid === false &&
      String(row?.status ?? "") === "confirmed" &&
      ((String(row?.kind ?? "") === "token-mint" &&
        tokenId === INCB_TOKEN_ID) ||
        (String(row?.kind ?? "") === "token-event-invalid" &&
          (tokenId === INCB_TOKEN_ID ||
            (sourceKind === INCEPTION_BOND_KIND &&
              attemptedKind === "token-mint"))))
  );
}

function canonicalIncbReplayRejectedSiblingForBond(row, bond) {
  if (!canonicalIncbReplayRejectedSibling(row)) {
    return false;
  }
  const payload = objectValue(row?.payload);
  const recipientAddress = String(
    payload?.bondRecipientAddress ?? payload?.minterAddress ?? "",
  ).trim();
  const recipientVout = canonicalIntegerText(payload?.bondRecipientVout);
  if (!recipientAddress && !recipientVout) {
    return true;
  }
  return (
    (!recipientAddress || recipientAddress === bond.bondRecipientAddress) &&
    (!recipientVout || Number(recipientVout) === bond.bondRecipientVout)
  );
}

async function verifyCanonicalIncbReplayManifestCoreEntries(entries) {
  const blockByHash = new Map();
  for (const entry of Array.isArray(entries) ? entries : []) {
    const bond = objectValue(entry?.bond);
    const canonicalHash = String(
      await bitcoinRpc("getblockhash", [Number(bond.blockHeight)]),
    ).trim().toLowerCase();
    if (canonicalHash !== bond.blockHash) {
      throw new Error(
        `INCB witness bond ${bond.txid || "unknown"} is no longer on its canonical Core block.`,
      );
    }
    let block = blockByHash.get(canonicalHash);
    if (!block) {
      block = await bitcoinRpc("getblock", [canonicalHash, 2]);
      assertCanonicalBlockEnvelope(
        block,
        Number(bond.blockHeight),
        canonicalHash,
      );
      blockByHash.set(canonicalHash, block);
    }
    const transaction = block?.tx?.[Number(bond.blockIndex)];
    const recipientOutputs = Array.isArray(bond.bondRecipientOutputs)
      ? bond.bondRecipientOutputs
      : [];
    const committedRecipientAmount = recipientOutputs.reduce(
      (total, committed) => {
        const output = transaction?.vout?.[Number(committed.vout)];
        if (
          addressFromVout(output) !== bond.bondRecipientAddress ||
          satsFromVoutValue(output?.value) !== BigInt(committed.amountSats)
        ) {
          return -1n;
        }
        return total < 0n ? total : total + BigInt(committed.amountSats);
      },
      0n,
    );
    const inceptionMemos = protocolMessagesFromTx(objectValue(transaction))
      .filter((message) => message?.text === `pwm1:m:${INCEPTION_BOND_MEMO}`);
    if (
      String(block?.previousblockhash ?? "").trim().toLowerCase() !==
        bond.previousBlockHash ||
      String(transaction?.txid ?? "").trim().toLowerCase() !== bond.txid ||
      recipientOutputs.length === 0 ||
      committedRecipientAmount !== BigInt(bond.bondRecipientAmountSats) ||
      inceptionMemos.length !== 1 ||
      recipientOutputs.some(
        (committed) =>
          Number(committed.vout) >= Number(inceptionMemos[0]?.voutIndex),
      ) ||
      canonicalIncbReplayAttachedWorkAtoms(
        transaction,
        bond.bondRecipientAddress,
      ) !== bond.attachedWorkAmountAtoms
    ) {
      throw new Error(
        `INCB witness bond ${bond.txid || "unknown"} changed Core position, predecessor, memo, recipient amount, or WORK attachment.`,
      );
    }
  }
}

async function captureCanonicalIncbRangeReplayWitnessManifest(
  client,
  {
    bindingId,
    createdAt,
    rangeReplayFromHeight,
    throughHash,
    throughHeight,
  },
) {
  const bondResult = await client.query(
    `
      SELECT
        e.event_id,
        e.txid,
        e.payload,
        t.raw_tx,
        t.block_height,
        lower(t.block_hash) AS block_hash,
        CASE
          WHEN t.raw_tx->>'_powBlockIndex' ~ '^[0-9]+$'
            THEN (t.raw_tx->>'_powBlockIndex')::integer
          ELSE NULL
        END AS block_index,
        lower(block.previous_block_hash) AS previous_block_hash
      FROM proof_indexer.events e
      JOIN proof_indexer.transactions t
        ON t.network = e.network
       AND t.txid = e.txid
       AND t.status = 'confirmed'
       AND t.block_height = e.block_height
      JOIN proof_indexer.blocks block
        ON block.network = t.network
       AND block.height = t.block_height
       AND block.block_hash = t.block_hash
       AND block.canonical = true
      WHERE e.network = $1
        AND e.protocol = 'pwm1'
        AND e.kind = $2
        AND e.status = 'confirmed'
        AND e.valid = true
        AND t.block_height BETWEEN $3 AND $4
      ORDER BY t.block_height, block_index, e.txid, e.event_id
    `,
    [
      NETWORK,
      INCEPTION_BOND_KIND,
      rangeReplayFromHeight,
      throughHeight,
    ],
  );
  const rawMemoCandidateResult = await client.query(
    `
      SELECT DISTINCT t.txid, t.raw_tx
      FROM proof_indexer.transactions t
      JOIN proof_indexer.blocks block
        ON block.network = t.network
       AND block.height = t.block_height
       AND block.block_hash = t.block_hash
       AND block.canonical = true
      WHERE t.network = $1
        AND t.status = 'confirmed'
        AND t.block_height BETWEEN $3 AND $4
        AND jsonb_typeof(t.raw_tx->'vout') = 'array'
        AND EXISTS (
          SELECT 1
          FROM jsonb_array_elements(t.raw_tx->'vout') output
          WHERE lower(COALESCE(output #>> '{scriptPubKey,asm}', ''))
            LIKE ('%' || $2 || '%')
        )
      ORDER BY t.txid
    `,
    [
      NETWORK,
      Buffer.from(`pwm1:m:${INCEPTION_BOND_MEMO}`, "utf8")
        .toString("hex"),
      rangeReplayFromHeight,
      throughHeight,
    ],
  );
  const rawMemoTxids = new Set(
    rawMemoCandidateResult.rows
      .filter((row) =>
        protocolMessagesFromTx(objectValue(row?.raw_tx)).some(
          (message) => message?.text === `pwm1:m:${INCEPTION_BOND_MEMO}`,
        )
      )
      .map((row) => String(row?.txid ?? "").trim().toLowerCase()),
  );
  const bondEventTxids = new Set(
    bondResult.rows.map((row) =>
      String(row?.txid ?? "").trim().toLowerCase()
    ),
  );
  const missingBondEventTxids = [...rawMemoTxids]
    .filter((txid) => !bondEventTxids.has(txid));
  const bondEventsWithoutRawMemo = [...bondEventTxids]
    .filter((txid) => !rawMemoTxids.has(txid));
  if (missingBondEventTxids.length > 0) {
    throw new Error(
      `Canonical INCB replay witness capture found Core memo transactions without canonical bond events: ${missingBondEventTxids.join(",")}.`,
    );
  }
  if (bondEventsWithoutRawMemo.length > 0) {
    throw new Error(
      `Canonical INCB replay witness capture found bond events without exact canonical raw transaction memos: ${bondEventsWithoutRawMemo.join(",")}.`,
    );
  }
  const txids = [...new Set(
    bondResult.rows.map((row) => String(row?.txid ?? "").trim().toLowerCase()),
  )];
  const siblingResult = txids.length > 0
    ? await client.query(
        `
          SELECT txid, event_id, protocol, kind, status, valid, payload
          FROM proof_indexer.events
          WHERE network = $1
            AND txid = ANY($2::text[])
          ORDER BY txid, event_id
        `,
        [NETWORK, txids],
      )
    : { rows: [] };
  const siblingsByTxid = new Map();
  for (const row of siblingResult.rows) {
    const txid = String(row?.txid ?? "").trim().toLowerCase();
    const siblings = siblingsByTxid.get(txid) ?? [];
    siblings.push(row);
    siblingsByTxid.set(txid, siblings);
  }

  const candidates = [];
  for (const row of bondResult.rows) {
    const payload = objectValue(row?.payload);
    const txid = String(row?.txid ?? "").trim().toLowerCase();
    const blockHeight = Number(row?.block_height);
    const blockIndex = Number(row?.block_index);
    const blockHash = String(row?.block_hash ?? "").trim().toLowerCase();
    const previousBlockHash = String(row?.previous_block_hash ?? "")
      .trim()
      .toLowerCase();
    const recipients = Array.isArray(payload?.recipients)
      ? payload.recipients
      : [];
    if (
      !/^[0-9a-f]{64}$/u.test(txid) ||
      !Number.isSafeInteger(blockHeight) ||
      !Number.isSafeInteger(blockIndex) ||
      blockIndex < 0 ||
      !/^[0-9a-f]{64}$/u.test(blockHash) ||
      !/^[0-9a-f]{64}$/u.test(previousBlockHash) ||
      recipients.length === 0
    ) {
      throw new Error(
        `Canonical INCB bond ${txid || "unknown"} cannot be represented in the replay witness set.`,
      );
    }
    const recipientGroups = new Map();
    for (const recipient of recipients) {
      const bondRecipientAddress = String(recipient?.address ?? "").trim();
      const bondRecipientVout = Number(recipient?.vout);
      const bondRecipientAmountSats = canonicalIntegerText(
        recipient?.amountSats,
        { positive: true },
      );
      if (
        !bondRecipientAddress ||
        !bondRecipientAmountSats ||
        !Number.isSafeInteger(bondRecipientVout) ||
        bondRecipientVout < 0
      ) {
        throw new Error(
          `Canonical INCB bond ${txid} has an invalid recipient identity.`,
        );
      }
      const group = recipientGroups.get(bondRecipientAddress) ?? {
        address: bondRecipientAddress,
        amountSats: 0n,
        outputs: [],
      };
      group.amountSats += BigInt(bondRecipientAmountSats);
      group.outputs.push({
        amountSats: bondRecipientAmountSats,
        vout: bondRecipientVout,
      });
      recipientGroups.set(bondRecipientAddress, group);
    }
    for (const group of recipientGroups.values()) {
      group.outputs.sort((left, right) => left.vout - right.vout);
      const bondRecipientAddress = group.address;
      const bondRecipientAmountSats = group.amountSats.toString();
      const bondRecipientVout = group.outputs[0].vout;
      const attachedWorkAmountAtoms =
        canonicalIncbReplayAttachedWorkAtoms(
          row.raw_tx,
          bondRecipientAddress,
        );
      candidates.push({
        bond: {
          attachedWorkAmountAtoms,
          blockHash,
          blockHeight,
          blockIndex,
          bondRecipientAddress,
          bondRecipientAmountSats,
          bondRecipientOutputs: group.outputs,
          bondRecipientVout,
          previousBlockHash,
          txid,
        },
        siblings: siblingsByTxid.get(txid) ?? [],
      });
    }
  }

  const candidateSnapshotIds = [...new Set(
    candidates.flatMap(({ bond, siblings }) =>
      siblings
        .filter((row) => {
          const mint = objectValue(row?.payload);
          return (
            row?.valid === true &&
            row?.status === "confirmed" &&
            row?.protocol === "pwt1" &&
            row?.kind === "token-mint" &&
            String(mint?.tokenId ?? "").trim().toLowerCase() === INCB_TOKEN_ID &&
            Number(mint?.bondRecipientVout) === bond.bondRecipientVout &&
            String(mint?.bondRecipientAddress ?? "").trim() ===
              bond.bondRecipientAddress
          );
        })
        .map((row) => String(row?.payload?.issuanceValueSnapshotId ?? "").trim())
        .filter(Boolean)
    ),
  )].sort();
  const snapshotRows = await lockedCanonicalIncbValueSnapshots(
    client,
    candidateSnapshotIds,
  );
  const snapshotsById = new Map(
    snapshotRows.map((row) => [String(row?.snapshot_id ?? ""), row]),
  );

  const entries = [];
  for (const candidate of candidates) {
    const { bond, siblings } = candidate;
    const rejectedSibling = siblings.some((row) =>
      canonicalIncbReplayRejectedSiblingForBond(row, bond)
    );
    const matchingMints = siblings.filter((row) => {
      const mint = objectValue(row?.payload);
      return (
        row?.valid === true &&
        row?.status === "confirmed" &&
        row?.protocol === "pwt1" &&
        row?.kind === "token-mint" &&
        String(mint?.tokenId ?? "").trim().toLowerCase() === INCB_TOKEN_ID &&
        Number(mint?.bondRecipientVout) === bond.bondRecipientVout &&
        String(mint?.bondRecipientAddress ?? "").trim() ===
          bond.bondRecipientAddress
      );
    });
    let reason = rejectedSibling
      ? "rederive-rejected-sibling"
      : matchingMints.length !== 1
        ? "rederive-missing-or-ambiguous-v2-mint"
        : "rederive-malformed-v2-mint";
    let preserved = null;
    if (matchingMints.length === 1) {
      const mintPayload = objectValue(matchingMints[0].payload);
      if (canonicalIncbReplayMintIsExact(mintPayload, candidate)) {
        try {
          const binding = canonicalIncbValueSnapshotBinding(mintPayload);
          const snapshotRow = snapshotsById.get(binding.snapshotId);
          const snapshot = canonicalIncbReplaySnapshotDescriptorFromRow(
            snapshotRow,
            binding,
          );
          if (
            binding.mode !== "canonical-summary-refresh" ||
            binding.model !== INCB_VALUE_SNAPSHOT_MODEL ||
            snapshot.snapshotId !== binding.snapshotId ||
            snapshot.indexedThroughBlock !== binding.blockHeight ||
            snapshot.sourceBlockHash !== binding.blockHash ||
            snapshot.canonicalSummaryHash !== binding.canonicalSummaryHash ||
            snapshot.generatedAt !== binding.generatedAt ||
            snapshot.workNetworkValueQ8 !== binding.workNetworkValueQ8
          ) {
            throw new Error("locked H-1 snapshot does not match mint binding");
          }
          preserved = {
            mintPayload,
            mintPayloadHash: canonicalIncbReplaySha256(mintPayload),
            snapshot,
            snapshotFingerprint: incbReplaySnapshotFingerprint(snapshot),
          };
          reason =
            snapshot.workNetworkValueMode ===
              INCB_RANGE_REPLAY_EXACT_MINT_LEGACY_SNAPSHOT_MODE
              ? "preserve-valid-exact-v2-with-raw-bound-legacy-green-snapshot"
              : "preserve-valid-exact-v2";
        } catch {
          reason = "rederive-unresolved-h-minus-one-snapshot";
        }
      }
    }
    entries.push(
      preserved
        ? {
            bond,
            disposition: "preserve",
            reason,
            ...preserved,
          }
        : { bond, disposition: "rederive", reason },
    );
  }

  const dispositionsByTxid = new Map();
  for (const entry of entries) {
    const group = dispositionsByTxid.get(entry.bond.txid) ?? [];
    group.push(entry);
    dispositionsByTxid.set(entry.bond.txid, group);
  }
  const groupedEntries = entries.map((entry) => {
    const group = dispositionsByTxid.get(entry.bond.txid) ?? [];
    const preserveCheckpointIdentities = new Set(
      group
        .filter((candidate) => candidate.disposition === "preserve")
        .map((candidate) => canonicalIncbReplaySha256({
          canonicalSummaryHash:
            candidate.snapshot.canonicalSummaryHash,
          generatedAt: candidate.snapshot.generatedAt,
          indexedThroughBlock: candidate.snapshot.indexedThroughBlock,
          snapshotId: candidate.snapshot.snapshotId,
          sourceBlockHash: candidate.snapshot.sourceBlockHash,
          workNetworkValueQ8: candidate.snapshot.workNetworkValueQ8,
        })),
    );
    if (
      group.length > 1 &&
      (group.some((candidate) => candidate.disposition !== "preserve") ||
        preserveCheckpointIdentities.size !== 1)
    ) {
      return {
        bond: entry.bond,
        disposition: "rederive",
        reason: "rederive-whole-multi-recipient-bond",
      };
    }
    return entry;
  });

  const manifest = buildIncbRangeReplayWitnessManifest({
    bindingId,
    createdAt,
    entries: groupedEntries,
    network: NETWORK,
    rangeReplayFromHeight,
    throughHash,
    throughHeight,
  });
  await verifyCanonicalIncbReplayManifestCoreEntries(manifest.entries);
  return manifest;
}

async function assertCanonicalIncbRangeReplayWitnessManifestUnchanged(
  client,
  manifest,
  metaKey,
) {
  const expected = verifyIncbRangeReplayWitnessManifest(manifest, {
    bindingId: manifest.bindingId,
    count: manifest.count,
    hash: manifest.commitment.hash,
    metaKey,
    network: NETWORK,
    preserveCount: manifest.preserveCount,
    rangeReplayFromHeight: manifest.rangeReplayFromHeight,
    throughHash: manifest.throughHash,
    throughHeight: manifest.throughHeight,
  });
  const stored = await proofIndexerMetaValue(client, metaKey);
  const verifiedStored = verifyIncbRangeReplayWitnessManifest(stored, {
    bindingId: expected.bindingId,
    count: expected.count,
    hash: expected.commitment.hash,
    metaKey,
    network: expected.network,
    preserveCount: expected.preserveCount,
    rangeReplayFromHeight: expected.rangeReplayFromHeight,
    throughHash: expected.throughHash,
    throughHeight: expected.throughHeight,
  });
  const preserved = verifiedStored.entries.filter(
    (entry) => entry.disposition === "preserve",
  );
  const snapshotRows = await lockedCanonicalIncbValueSnapshots(
    client,
    [...new Set(preserved.map((entry) => entry.snapshot.snapshotId))].sort(),
  );
  const snapshotsById = new Map(
    snapshotRows.map((row) => [String(row?.snapshot_id ?? ""), row]),
  );
  for (const entry of preserved) {
    const row = snapshotsById.get(entry.snapshot.snapshotId);
    const descriptor = canonicalIncbReplaySnapshotDescriptorFromRow(row, {
      workNetworkValueQ8: entry.snapshot.workNetworkValueQ8,
      workNetworkValueWitnessMode:
        entry.snapshot.workNetworkValueMode ===
        INCB_RANGE_REPLAY_EXACT_MINT_LEGACY_SNAPSHOT_MODE
          ? WORK_NETWORK_VALUE_ACCOUNTING_MODEL
          : entry.snapshot.workNetworkValueMode,
    });
    if (
      incbReplaySnapshotFingerprint(descriptor) !==
        entry.snapshotFingerprint ||
      canonicalIncbReplaySha256(entry.mintPayload) !== entry.mintPayloadHash
    ) {
      throw new Error(
        `Preserved INCB replay witness ${entry.bond.txid}:${entry.bond.bondRecipientVout} changed before commit.`,
      );
    }
  }
  await verifyCanonicalIncbReplayManifestCoreEntries(verifiedStored.entries);
  return verifiedStored;
}

async function canonicalIncbRangeReplayCompletionWitnesses(client, rebuild) {
  const binding = canonicalPwtRangeReplayVerifierBinding(rebuild);
  if (!binding) {
    throw new Error(
      "Canonical INCB replay completion has no valid immutable witness binding.",
    );
  }
  const manifest = verifyIncbRangeReplayWitnessManifest(
    await proofIndexerMetaValue(client, binding.witnessSetMetaKey),
    {
      bindingId: binding.bindingId,
      count: binding.witnessCount,
      hash: binding.witnessSetHash,
      metaKey: binding.witnessSetMetaKey,
      network: NETWORK,
      preserveCount: binding.witnessPreserveCount,
      rangeReplayFromHeight: binding.rangeReplayFromHeight,
      throughHash: binding.witnessedThroughBlockHash,
      throughHeight: binding.witnessedThroughBlock,
    },
  );
  await verifyCanonicalIncbReplayManifestCoreEntries(manifest.entries);
  const txids = [...new Set(
    manifest.entries.map((entry) => entry.bond.txid),
  )].sort();
  const result = txids.length > 0
    ? await client.query(
        `
          SELECT
            e.txid,
            e.protocol,
            e.kind,
            e.status,
            e.valid,
            e.payload,
            t.status AS transaction_status,
            t.block_height AS transaction_block_height,
            lower(t.block_hash) AS transaction_block_hash
          FROM proof_indexer.events e
          JOIN proof_indexer.transactions t
            ON t.network = e.network
           AND t.txid = e.txid
          JOIN proof_indexer.blocks block
            ON block.network = t.network
           AND block.height = t.block_height
           AND block.block_hash = t.block_hash
           AND block.canonical = true
          WHERE e.network = $1
            AND e.txid = ANY($2::text[])
          ORDER BY e.txid, e.event_id
        `,
        [NETWORK, txids],
      )
    : { rows: [] };
  const rowsByTxid = new Map();
  for (const row of result.rows) {
    const txid = String(row?.txid ?? "").trim().toLowerCase();
    const rows = rowsByTxid.get(txid) ?? [];
    rows.push(row);
    rowsByTxid.set(txid, rows);
  }
  const preservedWitnesses = [];
  const rederivedWitnesses = [];
  const finalMintWitnesses = [];
  for (const entry of manifest.entries) {
    const { bond } = entry;
    const rows = rowsByTxid.get(bond.txid) ?? [];
    if (
      rows.length === 0 ||
      rows.some(
        (row) =>
          row?.transaction_status !== "confirmed" ||
          Number(row?.transaction_block_height) !== bond.blockHeight ||
          String(row?.transaction_block_hash ?? "")
            .trim()
            .toLowerCase() !== bond.blockHash,
      )
    ) {
      throw new Error(
        `INCB replay witness ${bond.txid}:${bond.bondRecipientVout} has no canonical final transaction projection.`,
      );
    }
    const matchingBonds = rows.filter((row) => {
      if (
        row?.protocol !== "pwm1" ||
        row?.kind !== INCEPTION_BOND_KIND ||
        row?.valid !== true ||
        row?.status !== "confirmed"
      ) {
        return false;
      }
      const recipients = (Array.isArray(row?.payload?.recipients)
        ? row.payload.recipients
        : []
      )
        .filter(
          (recipient) =>
            String(recipient?.address ?? "").trim() ===
              bond.bondRecipientAddress,
        )
        .map((recipient) => ({
          amountSats: canonicalIntegerText(recipient?.amountSats, {
            positive: true,
          }),
          vout: Number(recipient?.vout),
        }))
        .sort((left, right) => left.vout - right.vout);
      return (
        recipients.length === bond.bondRecipientOutputs.length &&
        recipients.every(
          (recipient, index) =>
            recipient.amountSats ===
              bond.bondRecipientOutputs[index].amountSats &&
            recipient.vout === bond.bondRecipientOutputs[index].vout,
        )
      );
    });
    if (matchingBonds.length !== 1) {
      throw new Error(
        `INCB replay witness ${bond.txid}:${bond.bondRecipientVout} lost its exact bond recipient projection.`,
      );
    }
    const matchingMints = rows.filter((row) => {
      const mint = objectValue(row?.payload);
      return (
        row?.protocol === "pwt1" &&
        row?.kind === "token-mint" &&
        row?.valid === true &&
        row?.status === "confirmed" &&
        String(mint?.tokenId ?? "").trim().toLowerCase() === INCB_TOKEN_ID &&
        String(mint?.bondRecipientAddress ?? "").trim() ===
          bond.bondRecipientAddress &&
        Number(mint?.bondRecipientVout) === bond.bondRecipientVout
      );
    });
    const rejectedRows = rows.filter(canonicalIncbReplayRejectedSibling);
    const rejected = rejectedRows.length > 0;
    if (entry.disposition === "preserve") {
      if (
        rejected ||
        matchingMints.length !== 1 ||
        !canonicalIncbReplayMintIsExact(
          objectValue(matchingMints[0].payload),
          { bond },
        ) ||
        canonicalIncbReplaySha256(matchingMints[0].payload) !==
          entry.mintPayloadHash
      ) {
        throw new Error(
          `Preserved INCB replay witness ${bond.txid}:${bond.bondRecipientVout} was not consumed byte-for-byte.`,
        );
      }
      const finalBinding = canonicalIncbValueSnapshotBinding(
        matchingMints[0].payload,
      );
      if (
        finalBinding.snapshotId !== entry.snapshot.snapshotId ||
        finalBinding.blockHeight !== entry.snapshot.indexedThroughBlock ||
        finalBinding.blockHash !== entry.snapshot.sourceBlockHash ||
        finalBinding.canonicalSummaryHash !==
          entry.snapshot.canonicalSummaryHash ||
        finalBinding.generatedAt !== entry.snapshot.generatedAt ||
        finalBinding.workNetworkValueQ8 !==
          entry.snapshot.workNetworkValueQ8
      ) {
        throw new Error(
          `Preserved INCB replay witness ${bond.txid}:${bond.bondRecipientVout} changed its locked H-1 snapshot binding.`,
        );
      }
      preservedWitnesses.push({
        bondRecipientVout: bond.bondRecipientVout,
        identity: `${bond.txid}:${bond.bondRecipientVout}`,
        mintPayloadHash: entry.mintPayloadHash,
        snapshotFingerprint: entry.snapshotFingerprint,
        snapshotId: entry.snapshot.snapshotId,
        txid: bond.txid,
      });
      finalMintWitnesses.push({
        binding: finalBinding,
        entry,
        mintPayload: matchingMints[0].payload,
        preserved: true,
      });
    } else {
      const validRederivedMint =
        matchingMints.length === 1 &&
        !rejected &&
        canonicalIncbReplayMintIsExact(
          objectValue(matchingMints[0].payload),
          { bond },
        );
      const validRejectedDisposition =
        matchingMints.length === 0 && rejectedRows.length === 1;
      if (!validRederivedMint && !validRejectedDisposition) {
        throw new Error(
          `Rederived INCB replay witness ${bond.txid}:${bond.bondRecipientVout} has no unambiguous canonical final disposition.`,
        );
      }
      if (validRederivedMint) {
        finalMintWitnesses.push({
          binding: canonicalIncbValueSnapshotBinding(
            matchingMints[0].payload,
          ),
          entry,
          mintPayload: matchingMints[0].payload,
          preserved: false,
        });
      } else {
        rederivedWitnesses.push({
          bondRecipientVout: bond.bondRecipientVout,
          disposition: "invalid",
          identity: `${bond.txid}:${bond.bondRecipientVout}`,
          invalidPayloadHash: canonicalIncbReplaySha256(
            rejectedRows[0].payload,
          ),
          txid: bond.txid,
        });
      }
    }
  }
  const finalSnapshotIds = [...new Set(
    finalMintWitnesses.map((witness) => witness.binding.snapshotId),
  )].sort();
  const finalSnapshotRows = await lockedCanonicalIncbValueSnapshots(
    client,
    finalSnapshotIds,
  );
  const finalSnapshotRowsById = new Map(
    finalSnapshotRows.map((row) => [String(row?.snapshot_id ?? ""), row]),
  );
  if (finalSnapshotRowsById.size !== finalSnapshotIds.length) {
    throw new Error(
      "Canonical INCB replay completion cannot resolve every final H-1 snapshot.",
    );
  }
  for (const witness of finalMintWitnesses) {
    const { binding: finalBinding, entry, mintPayload, preserved } = witness;
    const snapshot = canonicalIncbReplaySnapshotDescriptorFromRow(
      finalSnapshotRowsById.get(finalBinding.snapshotId),
      finalBinding,
    );
    if (
      finalBinding.mode !== "canonical-summary-refresh" ||
      finalBinding.model !== INCB_VALUE_SNAPSHOT_MODEL ||
      snapshot.snapshotId !== finalBinding.snapshotId ||
      snapshot.indexedThroughBlock !== finalBinding.blockHeight ||
      snapshot.sourceBlockHash !== finalBinding.blockHash ||
      snapshot.canonicalSummaryHash !== finalBinding.canonicalSummaryHash ||
      snapshot.generatedAt !== finalBinding.generatedAt ||
      snapshot.workNetworkValueQ8 !== finalBinding.workNetworkValueQ8
    ) {
      throw new Error(
        `Canonical INCB replay completion H-1 snapshot ${finalBinding.snapshotId} is not bound to its exact final mint.`,
      );
    }
    const snapshotFingerprint = incbReplaySnapshotFingerprint(snapshot);
    if (preserved) {
      if (
        snapshotFingerprint !== entry.snapshotFingerprint ||
        canonicalIncbReplaySha256(snapshot) !==
          canonicalIncbReplaySha256(entry.snapshot)
      ) {
        throw new Error(
          `Preserved INCB replay witness ${entry.bond.txid}:${entry.bond.bondRecipientVout} changed its raw H-1 snapshot row during replay.`,
        );
      }
      continue;
    }
    if (snapshot.workNetworkValueMode !== WORK_NETWORK_VALUE_ACCOUNTING_MODEL) {
      throw new Error(
        `Rederived INCB replay witness ${entry.bond.txid}:${entry.bond.bondRecipientVout} did not use a forced exact green H-1 snapshot.`,
      );
    }
    rederivedWitnesses.push({
      bondRecipientVout: entry.bond.bondRecipientVout,
      disposition: "mint",
      identity: `${entry.bond.txid}:${entry.bond.bondRecipientVout}`,
      mintPayloadHash: canonicalIncbReplaySha256(mintPayload),
      snapshotFingerprint,
      snapshotId: snapshot.snapshotId,
      txid: entry.bond.txid,
    });
  }
  preservedWitnesses.sort((left, right) =>
    left.identity.localeCompare(right.identity)
  );
  rederivedWitnesses.sort((left, right) =>
    left.identity.localeCompare(right.identity)
  );
  if (preservedWitnesses.length !== manifest.preserveCount) {
    throw new Error(
      "Canonical INCB replay completion did not consume every preserved witness.",
    );
  }
  if (rederivedWitnesses.length !== manifest.rederiveCount) {
    throw new Error(
      "Canonical INCB replay completion did not consume every rederive disposition.",
    );
  }
  return {
    binding,
    manifest,
    preservedWitnesses,
    rederivedWitnesses,
  };
}

async function verifyCanonicalIncbPwtRangeReplayProjection(client, rebuild) {
  const rangeReplayFromHeight = Number(rebuild?.rangeReplayFromHeight ?? 0);
  const targets = canonicalIncbPwtRangeReplayTargets(rangeReplayFromHeight);
  if (rebuild?.mode !== "pwt-range-replay" || targets.length === 0) {
    return null;
  }
  const coreFacts =
    await verifyCanonicalIncbPwtRangeReplayCoreFacts(targets);
  const targetByTxid = new Map(targets.map((target) => [target.txid, target]));
  const result = await client.query(
    `
      SELECT
        e.txid,
        e.protocol,
        e.kind,
        e.status,
        e.valid,
        e.payload,
        t.status AS transaction_status,
        t.block_hash AS transaction_block_hash,
        t.block_height AS transaction_block_height
      FROM proof_indexer.events e
      JOIN proof_indexer.transactions t
        ON t.network = e.network
       AND t.txid = e.txid
      WHERE e.network = $1
        AND e.txid = ANY($2::text[])
      ORDER BY e.txid, e.event_id
    `,
    [NETWORK, targets.map((target) => target.txid)],
  );
  const rowsByTxid = new Map();
  for (const row of result.rows) {
    const txid = String(row?.txid ?? "").trim().toLowerCase();
    const rows = rowsByTxid.get(txid) ?? [];
    rows.push(row);
    rowsByTxid.set(txid, rows);
  }
  const verified = [];
  for (const [txid, target] of targetByTxid) {
    const rows = rowsByTxid.get(txid) ?? [];
    if (
      rows.length === 0 ||
      rows.some(
        (row) =>
          row?.transaction_status !== "confirmed" ||
          Number(row?.transaction_block_height) !== target.blockHeight ||
          String(row?.transaction_block_hash ?? "").trim().toLowerCase() !==
            target.blockHash ||
          row?.status !== "confirmed" ||
          row?.valid !== true ||
          String(row?.kind ?? "").toLowerCase().endsWith("-invalid"),
      )
    ) {
      throw new Error(
        `Canonical INCB range replay left an invalid alias or noncanonical sibling for ${txid}.`,
      );
    }
    const bonds = rows.filter(
      (row) => row.protocol === "pwm1" && row.kind === INCEPTION_BOND_KIND,
    );
    const transfers = rows.filter(
      (row) =>
        row.protocol === "pwt1" &&
        row.kind === "token-transfer" &&
        String(row?.payload?.tokenId ?? "").trim().toLowerCase() ===
          WORK_TOKEN_ID,
    );
    const mints = rows.filter(
      (row) =>
        row.protocol === "pwt1" &&
        row.kind === "token-mint" &&
        String(row?.payload?.tokenId ?? "").trim().toLowerCase() ===
          INCB_TOKEN_ID,
    );
    if (bonds.length !== 1 || transfers.length !== 1 || mints.length !== 1) {
      throw new Error(
        `Canonical INCB range replay expected one bond, WORK transfer, and INCB mint for ${txid}.`,
      );
    }
    const bond = objectValue(bonds[0].payload);
    const transfer = objectValue(transfers[0].payload);
    const mint = objectValue(mints[0].payload);
    const attachedCredits = Array.isArray(bond?.attachedCredits)
      ? bond.attachedCredits
      : [];
    if (
      String(transfer?.amountAtoms ?? "") !== target.workAmountAtoms ||
      String(transfer?.transferVersion ?? "") !== "send2" ||
      Number(transfer?.protocolVout) !== target.workProtocolVout ||
      String(transfer?.senderAddress ?? "").trim() !==
        target.bondRecipientAddress ||
      String(transfer?.recipientAddress ?? "").trim() !==
        target.bondRecipientAddress ||
      attachedCredits.length !== 1 ||
      String(attachedCredits[0]?.tokenId ?? "").trim().toLowerCase() !==
        WORK_TOKEN_ID ||
      String(attachedCredits[0]?.amountAtoms ?? "") !==
        target.workAmountAtoms ||
      Number(attachedCredits[0]?.protocolVout) !== target.workProtocolVout ||
      String(attachedCredits[0]?.recipientAddress ?? "").trim() !==
        target.bondRecipientAddress
    ) {
      throw new Error(
        `Canonical INCB range replay did not bind the exact WORK send2 attachment for ${txid}.`,
      );
    }
    const expected = canonicalIncbIssuanceQ8Projection({
      attachedWorkAmountAtoms: target.workAmountAtoms,
      directProofIssuanceUnits: String(target.bondRecipientAmountSats),
      workNetworkValueQ8: mint.issuanceValueSnapshotWorkNetworkValueQ8,
    });
    if (
      !canonicalBondMintProjection(mint) ||
      incbIssuanceMetadataInvalidReason(mint) ||
      String(mint?.sourceBondTxid ?? "").trim().toLowerCase() !== txid ||
      String(mint?.minterAddress ?? "").trim() !==
        target.bondRecipientAddress ||
      String(mint?.bondRecipientAddress ?? "").trim() !==
        target.bondRecipientAddress ||
      Number(mint?.bondRecipientVout) !== target.bondRecipientVout ||
      String(mint?.bondRecipientAmountSats ?? "") !==
        String(target.bondRecipientAmountSats) ||
      Number(mint?.issuanceValueSnapshotBlockHeight) !==
        target.blockHeight - 1 ||
      String(mint?.attachedWorkLiveValueAtSendQ8 ?? "") !==
        expected.attachedWorkLiveValueAtSendQ8 ||
      String(mint?.attachedWorkIssuanceUnits ?? "") !==
        expected.attachedWorkIssuanceUnits ||
      String(mint?.issuanceNetworkValueQ8 ?? "") !==
        expected.issuanceNetworkValueQ8 ||
      String(mint?.issuanceDustQ8 ?? "") !== expected.issuanceDustQ8 ||
      String(mint?.amount ?? "") !== expected.confirmedIssuanceUnits ||
      String(mint?.issuanceAmount ?? "") !==
        expected.confirmedIssuanceUnits ||
      String(mint?.confirmedIssuanceUnits ?? "") !==
        expected.confirmedIssuanceUnits
    ) {
      throw new Error(
        `Canonical INCB range replay failed the exact H-1 Q8 issuance formula for ${txid}.`,
      );
    }
    verified.push({
      confirmedIssuanceUnits: expected.confirmedIssuanceUnits,
      issuanceNetworkValueQ8: expected.issuanceNetworkValueQ8,
      txid,
      workAmountAtoms: target.workAmountAtoms,
    });
  }
  const witnessCompletion =
    await canonicalIncbRangeReplayCompletionWitnesses(client, rebuild);
  return {
    accountingModel: INCB_ISSUANCE_ACCOUNTING_MODEL,
    consumedPreserveCount:
      witnessCompletion.preservedWitnesses.length,
    coreFacts,
    preservedWitnesses: witnessCompletion.preservedWitnesses,
    rangeReplayFromHeight,
    rederivedWitnessCount:
      witnessCompletion.rederivedWitnesses.length,
    rederivedWitnesses: witnessCompletion.rederivedWitnesses,
    targets: verified,
    verified: true,
    witnessCount: witnessCompletion.manifest.count,
    witnessPreserveCount: witnessCompletion.manifest.preserveCount,
    witnessSetHash: witnessCompletion.manifest.commitment.hash,
    witnessedThroughBlock: witnessCompletion.manifest.throughHeight,
    witnessedThroughBlockHash: witnessCompletion.manifest.throughHash,
  };
}

async function prepareCanonicalRebuild(client) {
  if (!CANONICAL_REBUILD) {
    return null;
  }
  const existing = await proofIndexerMetaValue(
    client,
    CANONICAL_REBUILD_META_KEY,
  );
  if (
    existing?.network === NETWORK &&
    Number(existing?.fromHeight) === BLOCK_SCAN_FROM_HEIGHT &&
    (existing?.status === "active" ||
      (existing?.status === "complete" && !PREPARE_CANONICAL_REBUILD_ONLY))
  ) {
    await assertCanonicalWorkAtomicProjection(
      client,
      "Resumed canonical rebuild",
    );
    return { resumed: true, value: existing };
  }

  const bootstrapHeight = BLOCK_SCAN_FROM_HEIGHT - 1;
  const bootstrapHash = String(
    await bitcoinRpc("getblockhash", [bootstrapHeight]),
  )
    .trim()
    .toLowerCase();
  if (!isHexTxid(bootstrapHash)) {
    throw new Error(
      `Bitcoin Core returned an invalid canonical bootstrap hash for block ${bootstrapHeight}`,
    );
  }
  const tipHeight = Number(await bitcoinRpc("getblockcount"));
  const startedAt = new Date().toISOString();
  const value = {
    active: true,
    bootstrapHash,
    bootstrapHeight,
    complete: false,
    fromHeight: BLOCK_SCAN_FROM_HEIGHT,
    indexedThroughBlock: bootstrapHeight,
    indexedThroughBlockHash: bootstrapHash,
    network: NETWORK,
    startedAt,
    status: "active",
    transactionNormalization: "canonical-raw-tx-only",
    updatedAt: startedAt,
  };

  let creditUnitStorageMigration = null;
  await client.query("BEGIN");
  try {
    await client.query("SET LOCAL lock_timeout = '10s'");
    creditUnitStorageMigration =
      await migrateUnboundedCreditUnitStorage(client);
    await client.query(
      `
        DELETE FROM proof_indexer.events
        WHERE network = $1
          AND protocol = ANY($2::text[])
      `,
      [NETWORK, ["pwid1", "pwt1", "pwm1", "pwr1"]],
    );
    await client.query(`DELETE FROM proof_indexer.id_records WHERE network = $1`, [
      NETWORK,
    ]);
    await client.query(
      `DELETE FROM proof_indexer.credit_balances WHERE network = $1`,
      [NETWORK],
    );
    await client.query(
      `DELETE FROM proof_indexer.credit_listings WHERE network = $1`,
      [NETWORK],
    );
    await client.query(
      `DELETE FROM proof_indexer.credit_definitions WHERE network = $1`,
      [NETWORK],
    );
    await seedCanonicalWorkDefinition(client);
    await client.query(`DELETE FROM proof_indexer.mail_items WHERE network = $1`, [
      NETWORK,
    ]);
    await client.query(
      `DELETE FROM proof_indexer.file_attachments WHERE network = $1`,
      [NETWORK],
    );
    await client.query(
      `
        UPDATE proof_indexer.transactions
        SET raw_tx = NULL, updated_at = now()
        WHERE network = $1
          AND raw_tx ? 'canonicalBlockScan'
      `,
      [NETWORK],
    );
    await client.query(
      `
        UPDATE proof_indexer.blocks
        SET canonical = false, indexed_at = now()
        WHERE network = $1
      `,
      [NETWORK],
    );
    await client.query(
      `
        DELETE FROM proof_indexer.ledger_snapshots
        WHERE network = $1
      `,
      [NETWORK],
    );
    await client.query(`DELETE FROM proof_indexer.meta WHERE key = $1`, [
      CANONICAL_FAULT_META_KEY,
    ]);
    await client.query(`DELETE FROM proof_indexer.meta WHERE key = $1`, [
      `mempoolScan:${NETWORK}`,
    ]);
    await client.query(`DELETE FROM proof_indexer.meta WHERE key = ANY($1::text[])`, [
      [
        `rushCanonicalBootstrap:${NETWORK}`,
        `rushCanonicalDiscovery:${NETWORK}`,
      ],
    ]);
    await storeProofIndexerMeta(client, CANONICAL_REBUILD_META_KEY, value);
    await storeBlockScanSnapshot(client, {
      complete: false,
      indexed: 0,
      indexedThroughBlock: bootstrapHeight,
      indexedThroughBlockHash: bootstrapHash,
      protocolTxids: 0,
      rebuild: value,
      scannedBlocks: 0,
      skipped: 0,
      stopReason: "canonical-rebuild-bootstrap",
      tipHeight: Number.isSafeInteger(tipHeight) ? tipHeight : null,
    });
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  }
  return { creditUnitStorageMigration, resumed: false, value };
}

async function prepareCanonicalPwtRangeReplay(client) {
  if (!PREPARE_CANONICAL_PWT_RANGE_REPLAY_ONLY) {
    return null;
  }
  const existing = await proofIndexerMetaValue(
    client,
    CANONICAL_REBUILD_META_KEY,
  );
  const existingFault = await proofIndexerMetaValue(
    client,
    CANONICAL_FAULT_META_KEY,
  );
  if (existingFault?.network === NETWORK && existingFault?.active === true) {
    throw new Error(
      "PWT range replay cannot bypass an active canonical fault; use full reorg recovery.",
    );
  }
  const legacyCompletedReplay =
    legacyCompletedPwtRangeReplayCanBeReprepared(
      existing,
      BLOCK_SCAN_FROM_HEIGHT,
    );
  const existingReplayState =
    legacyCompletedReplay
      ? "legacy-complete"
      : assertCanonicalPwtRangeReplayState(existing);
  if (
    existingReplayState === "active" &&
    Number(existing?.rangeReplayFromHeight) !== BLOCK_SCAN_FROM_HEIGHT
  ) {
    throw new Error(
      "An active PWT range replay cannot be replaced with a different replay boundary.",
    );
  }
  if (existingReplayState === "active") {
    if (!canonicalPwtRangeReplayVerifierBinding(existing)) {
      throw new Error(
        "Existing PWT range replay metadata is missing its canonical verifier database binding.",
      );
    }
    await assertCanonicalWorkAtomicSource(
      client,
      "Resumed PWT range replay",
    );
    return { resumed: true, value: existing };
  }
  if (existingReplayState === "complete") {
    throw new Error(
      "A certified PWT range replay is permanent and cannot be replaced by replay preparation.",
    );
  }
  if (
    existingReplayState === null &&
    String(existing?.mode ?? "").trim().length > 0
  ) {
    throw new Error(
      "PWT range replay preparation cannot replace metadata from an unknown rebuild mode.",
    );
  }

  const canonicalFromHeight = Number(existing?.fromHeight ?? 0);
  const canonicalBootstrapHeight = Number(existing?.bootstrapHeight ?? 0);
  const canonicalBootstrapHash = String(existing?.bootstrapHash ?? "")
    .trim()
    .toLowerCase();
  const canonicalIndexedHeight = Number(existing?.indexedThroughBlock ?? 0);
  const canonicalIndexedHash = String(existing?.indexedThroughBlockHash ?? "")
    .trim()
    .toLowerCase();
  if (
    existing?.network !== NETWORK ||
    !["active", "complete"].includes(existing?.status) ||
    !Number.isSafeInteger(canonicalFromHeight) ||
    canonicalFromHeight <= 0 ||
    canonicalFromHeight > BLOCK_SCAN_FROM_HEIGHT ||
    !Number.isSafeInteger(canonicalBootstrapHeight) ||
    canonicalBootstrapHeight !== canonicalFromHeight - 1 ||
    !isHexTxid(canonicalBootstrapHash) ||
    !Number.isSafeInteger(canonicalIndexedHeight) ||
    canonicalIndexedHeight < canonicalBootstrapHeight ||
    !isHexTxid(canonicalIndexedHash)
  ) {
    throw new Error(
      "PWT range replay requires the original hashed canonical rebuild metadata.",
    );
  }

  const rangeBootstrapHeight = BLOCK_SCAN_FROM_HEIGHT - 1;
  const rangeBootstrapHash = String(
    await bitcoinRpc("getblockhash", [rangeBootstrapHeight]),
  )
    .trim()
    .toLowerCase();
  if (!isHexTxid(rangeBootstrapHash)) {
    throw new Error(
      `Bitcoin Core returned an invalid PWT range checkpoint hash for block ${rangeBootstrapHeight}`,
    );
  }
  const tipHeight = Number(await bitcoinRpc("getblockcount"));
  if (
    !Number.isSafeInteger(tipHeight) ||
    tipHeight < BLOCK_SCAN_FROM_HEIGHT
  ) {
    throw new Error("Bitcoin Core tip is below the requested PWT replay range.");
  }
  const predecessorBootstrapCoreHash = String(
    await bitcoinRpc("getblockhash", [canonicalBootstrapHeight]),
  )
    .trim()
    .toLowerCase();
  const predecessorIndexedCoreHash = String(
    await bitcoinRpc("getblockhash", [canonicalIndexedHeight]),
  )
    .trim()
    .toLowerCase();
  if (
    predecessorBootstrapCoreHash !== canonicalBootstrapHash ||
    predecessorIndexedCoreHash !== canonicalIndexedHash ||
    tipHeight < canonicalIndexedHeight ||
    BLOCK_SCAN_FROM_HEIGHT > canonicalIndexedHeight + 1
  ) {
    throw new Error(
      "Stored PWT replay predecessor lineage is not an exact ancestor of the current Bitcoin Core tip.",
    );
  }

  const startedAt = new Date().toISOString();
  let verifierBinding = newPwtRangeReplayVerifierBinding(
    BLOCK_SCAN_FROM_HEIGHT,
    startedAt,
  );
  const {
    completedAt: _completedAt,
    incbRangeReplayVerification: _incbRangeReplayVerification,
    ...existingBase
  } = existing;
  let value = {
    ...existingBase,
    active: true,
    bootstrapHash: canonicalBootstrapHash,
    bootstrapHeight: canonicalBootstrapHeight,
    complete: false,
    fromHeight: canonicalFromHeight,
    indexedThroughBlock: rangeBootstrapHeight,
    indexedThroughBlockHash: rangeBootstrapHash,
    mode: "pwt-range-replay",
    network: NETWORK,
    rangeReplayFromHeight: BLOCK_SCAN_FROM_HEIGHT,
    rangeReplayStartedAt: startedAt,
    status: "active",
    transactionNormalization: "canonical-raw-tx-only",
    updatedAt: startedAt,
    verifierBinding,
  };

  const incidentTargets = canonicalIncbPwtRangeReplayTargets(
    BLOCK_SCAN_FROM_HEIGHT,
  );
  const existingPredecessorFingerprint = canonicalIncbReplaySha256(existing);
  let creditUnitStorageMigration = null;
  let replayWitnessManifest = null;
  let replayWitnessMetaKey = "";
  await client.query("BEGIN ISOLATION LEVEL SERIALIZABLE");
  try {
    await client.query("SET LOCAL lock_timeout = '10s'");
    await client.query(
      "SELECT pg_advisory_xact_lock(hashtext($1), hashtext($2))",
      ["proof-indexer-pwt-range-replay", NETWORK],
    );
    creditUnitStorageMigration =
      await migrateUnboundedCreditUnitStorage(client);
    await client.query(
      `
        LOCK TABLE
          proof_indexer.blocks,
          proof_indexer.credit_balances,
          proof_indexer.credit_definitions,
          proof_indexer.credit_listings,
          proof_indexer.events,
          proof_indexer.ledger_snapshots,
          proof_indexer.meta,
          proof_indexer.transactions
        IN SHARE ROW EXCLUSIVE MODE
      `,
    );
    const lockedExisting = await proofIndexerMetaValue(
      client,
      CANONICAL_REBUILD_META_KEY,
    );
    if (
      !lockedExisting ||
      canonicalIncbReplaySha256(lockedExisting) !==
        existingPredecessorFingerprint
    ) {
      throw new Error(
        "PWT range replay predecessor metadata changed before the stopped-writer lock was acquired.",
      );
    }
    await assertCanonicalWorkAtomicSource(
      client,
      "PWT range replay source projection",
    );
    const coreFactsBefore =
      await verifyCanonicalIncbPwtRangeReplayCoreFacts(incidentTargets);
    replayWitnessManifest =
      await captureCanonicalIncbRangeReplayWitnessManifest(client, {
        bindingId: verifierBinding.bindingId,
        createdAt: startedAt,
        rangeReplayFromHeight: BLOCK_SCAN_FROM_HEIGHT,
        throughHash: canonicalIndexedHash,
        throughHeight: canonicalIndexedHeight,
      });
    replayWitnessMetaKey = incbRangeReplayWitnessMetaKey(
      NETWORK,
      verifierBinding.bindingId,
    );
    verifierBinding = {
      ...verifierBinding,
      ...incbRangeReplayWitnessBindingFields(
        replayWitnessManifest,
        replayWitnessMetaKey,
      ),
    };
    value = { ...value, verifierBinding };
    await storeProofIndexerMeta(
      client,
      replayWitnessMetaKey,
      replayWitnessManifest,
    );
    const firstMarketplaceEvent = await client.query(
      `
        SELECT min(COALESCE(e.block_height, t.block_height)) AS first_height
        FROM proof_indexer.events e
        LEFT JOIN proof_indexer.transactions t
          ON t.network = e.network
         AND t.txid = e.txid
        WHERE e.network = $1
          AND e.protocol = 'pwt1'
          AND e.valid = true
          AND COALESCE(t.status, e.status) = 'confirmed'
          AND e.kind = ANY($2::text[])
      `,
      [
        NETWORK,
        [
          "token-listing",
          "token-listings",
          "token-listing-sealed",
          "token-listing-closed",
          "token-sale",
        ],
      ],
    );
    const firstMarketplaceHeight = Number(
      firstMarketplaceEvent.rows[0]?.first_height ?? 0,
    );
    // A later replay boundary is safe only because every retained pre-range
    // definition/listing is projected below and every retained credit event is
    // replayed into balances before commit. Never preserve the old derived
    // tables themselves.
    const preRangeFalseClose = await client.query(
      `
        SELECT min(COALESCE(e.block_height, t.block_height)) AS first_false_height
        FROM proof_indexer.events e
        JOIN proof_indexer.transactions t
          ON t.network = e.network
         AND t.txid = e.txid
        WHERE e.network = $1
          AND e.protocol = 'pwt1'
          AND e.valid = true
          AND COALESCE(t.status, e.status) = 'confirmed'
          AND e.kind = 'token-listing-closed'
          AND COALESCE(e.block_height, t.block_height, 0) < $2
          AND e.payload->'saleAuthorization'->>'anchorVout' ~ '^[0-9]+$'
          AND EXISTS (
            SELECT 1
            FROM jsonb_array_elements(
              CASE
                WHEN jsonb_typeof(t.raw_tx->'vin') = 'array'
                  THEN t.raw_tx->'vin'
                ELSE '[]'::jsonb
              END
            ) vin
            WHERE vin->>'txid' = e.payload->>'sealTxid'
              AND (vin->>'vout')::integer =
                (e.payload->'saleAuthorization'->>'anchorVout')::integer
          )
          AND NOT EXISTS (
            SELECT 1
            FROM jsonb_array_elements(
              CASE
                WHEN jsonb_typeof(t.raw_tx->'vin') = 'array'
                  THEN t.raw_tx->'vin'
                ELSE '[]'::jsonb
              END
            ) vin
            WHERE vin->>'txid' = e.payload->>'listingId'
              AND (vin->>'vout')::integer =
                (e.payload->'saleAuthorization'->>'anchorVout')::integer
          )
      `,
      [NETWORK, BLOCK_SCAN_FROM_HEIGHT],
    );
    const firstPreRangeFalseCloseHeight = Number(
      preRangeFalseClose.rows[0]?.first_false_height ?? 0,
    );
    if (
      Number.isSafeInteger(firstPreRangeFalseCloseHeight) &&
      firstPreRangeFalseCloseHeight > 0
    ) {
      throw new Error(
        `PWT range replay starts too late; a false sale-ticket close already exists at block ${firstPreRangeFalseCloseHeight}`,
      );
    }
    const baseDefinitions = await client.query(
      `
        SELECT e.payload, e.status
        FROM proof_indexer.events e
        LEFT JOIN proof_indexer.transactions t
          ON t.network = e.network
         AND t.txid = e.txid
        WHERE e.network = $1
          AND e.protocol = 'pwt1'
          AND e.valid = true
          AND COALESCE(t.status, e.status) = 'confirmed'
          AND e.kind = 'token-create'
          AND COALESCE(e.block_height, t.block_height, 0) < $2
        ORDER BY
          COALESCE(e.block_height, t.block_height, 0),
          e.event_id
      `,
      [NETWORK, BLOCK_SCAN_FROM_HEIGHT],
    );
    const baseMarketplace = await client.query(
      `
        SELECT e.payload, e.status
        FROM proof_indexer.events e
        LEFT JOIN proof_indexer.transactions t
          ON t.network = e.network
         AND t.txid = e.txid
        WHERE e.network = $1
          AND e.protocol = 'pwt1'
          AND e.valid = true
          AND COALESCE(t.status, e.status) = 'confirmed'
          AND e.kind = ANY($2::text[])
          AND COALESCE(e.block_height, t.block_height, 0) < $3
        ORDER BY
          COALESCE(e.block_height, t.block_height, 0),
          CASE
            WHEN e.payload->>'blockIndex' ~ '^[0-9]+$'
              THEN (e.payload->>'blockIndex')::integer
            ELSE 2147483647
          END,
          CASE
            WHEN e.payload->>'_powEventIndex' ~ '^[0-9]+$'
              THEN (e.payload->>'_powEventIndex')::integer
            ELSE 2147483647
          END,
          e.event_key
      `,
      [
        NETWORK,
        [
          "token-listing",
          "token-listings",
          "token-listing-sealed",
          "token-listing-closed",
          "token-sale",
        ],
        BLOCK_SCAN_FROM_HEIGHT,
      ],
    );

    await client.query(
      `
        WITH replay_txids AS (
          SELECT DISTINCT e.txid
          FROM proof_indexer.events e
          LEFT JOIN proof_indexer.transactions t
            ON t.network = e.network
           AND t.txid = e.txid
          WHERE e.network = $1
            AND e.protocol = 'pwt1'
            AND (
              COALESCE(t.status, e.status) <> 'confirmed'
              OR COALESCE(e.block_height, t.block_height, 0) >= $2
            )
        )
        DELETE FROM proof_indexer.events e
        USING replay_txids r
        WHERE e.network = $1
          AND e.txid = r.txid
      `,
      [NETWORK, BLOCK_SCAN_FROM_HEIGHT],
    );
    await client.query(
      `DELETE FROM proof_indexer.credit_balances WHERE network = $1`,
      [NETWORK],
    );
    await client.query(
      `DELETE FROM proof_indexer.credit_listings WHERE network = $1`,
      [NETWORK],
    );
    await client.query(
      `DELETE FROM proof_indexer.credit_definitions WHERE network = $1`,
      [NETWORK],
    );
    await seedCanonicalWorkDefinition(client);
    await seedCanonicalBondDefinitions(client, { required: true });
    for (const row of baseDefinitions.rows) {
      await upsertProjection(client, "tokens", row.payload, row.status);
    }
    await assertCanonicalWorkAtomicProjection(
      client,
      "PWT range replay retained definitions",
    );
    for (const row of baseMarketplace.rows) {
      await upsertProjection(
        client,
        sourceLabelForProtocolItem(row.payload),
        row.payload,
        row.status,
      );
    }
    const baseCreditReplay =
      await rebuildConfirmedCreditBalancesFromCanonicalEvents(client);
    const baseWorkAtomicSource = await assertCanonicalWorkAtomicSource(
      client,
      "PWT range replay retained state",
    );
    const preservedWitnessSnapshotIds = replayWitnessManifest.entries
      .filter((entry) => entry.disposition === "preserve")
      .map((entry) => entry.snapshot.snapshotId);
    await client.query(
      `
        DELETE FROM proof_indexer.ledger_snapshots
        WHERE network = $1
          AND NOT (snapshot_id = ANY($2::text[]))
      `,
      [NETWORK, preservedWitnessSnapshotIds],
    );
    await client.query(`DELETE FROM proof_indexer.meta WHERE key = $1`, [
      CANONICAL_FAULT_META_KEY,
    ]);
    await client.query(`DELETE FROM proof_indexer.meta WHERE key = $1`, [
      `mempoolScan:${NETWORK}`,
    ]);
    await storeProofIndexerMeta(client, CANONICAL_REBUILD_META_KEY, value);
    await storeBlockScanSnapshot(client, {
      complete: false,
      indexed: 0,
      indexedThroughBlock: rangeBootstrapHeight,
      indexedThroughBlockHash: rangeBootstrapHash,
      protocolTxids: 0,
      rebuild: value,
      scannedBlocks: 0,
      skipped: 0,
      stopReason: "canonical-pwt-range-replay-bootstrap",
      tipHeight,
    });
    const coreFactsAfter =
      await verifyCanonicalIncbPwtRangeReplayCoreFacts(incidentTargets);
    if (JSON.stringify(coreFactsAfter) !== JSON.stringify(coreFactsBefore)) {
      throw new Error(
        "Pinned INCB replay Core facts changed during transactional preparation.",
      );
    }
    await assertCanonicalWorkAtomicProjection(
      client,
      "PWT range replay pre-commit projection",
    );
    const predecessorCoreHashBeforeCommit = String(
      await bitcoinRpc("getblockhash", [canonicalIndexedHeight]),
    ).trim().toLowerCase();
    if (predecessorCoreHashBeforeCommit !== canonicalIndexedHash) {
      throw new Error(
        "PWT range replay predecessor checkpoint changed before commit.",
      );
    }
    replayWitnessManifest =
      await assertCanonicalIncbRangeReplayWitnessManifestUnchanged(
        client,
        replayWitnessManifest,
        replayWitnessMetaKey,
      );
    const lockedReplayValue = await proofIndexerMetaValue(
      client,
      CANONICAL_REBUILD_META_KEY,
    );
    if (
      !lockedReplayValue ||
      canonicalIncbReplaySha256(lockedReplayValue) !==
        canonicalIncbReplaySha256(value)
    ) {
      throw new Error(
        "PWT range replay verifier binding changed before commit.",
      );
    }
    await client.query("COMMIT");
    return {
      baseCreditReplay,
      baseWorkAtomicSource,
      baseDefinitions: baseDefinitions.rows.length,
      baseMarketplaceEvents: baseMarketplace.rows.length,
      creditUnitStorageMigration,
      firstMarketplaceHeight:
        Number.isSafeInteger(firstMarketplaceHeight) &&
        firstMarketplaceHeight > 0
          ? firstMarketplaceHeight
          : null,
      pinnedIncbTargets: coreFactsAfter,
      replayWitnessManifest: {
        count: replayWitnessManifest.count,
        hash: replayWitnessManifest.commitment.hash,
        preserveCount: replayWitnessManifest.preserveCount,
        rederiveCount: replayWitnessManifest.rederiveCount,
        throughHash: replayWitnessManifest.throughHash,
        throughHeight: replayWitnessManifest.throughHeight,
      },
      resumed: false,
      value,
    };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  }
}

async function storeCanonicalReorgFault(client, details) {
  const detectedAt = new Date().toISOString();
  const fault = {
    active: true,
    detectedAt,
    network: NETWORK,
    status: "fault",
    type: "reorg",
    ...details,
  };
  await storeProofIndexerMeta(client, CANONICAL_FAULT_META_KEY, fault);
  const rebuild = await proofIndexerMetaValue(
    client,
    CANONICAL_REBUILD_META_KEY,
  );
  if (rebuild?.network === NETWORK && rebuild?.status === "active") {
    await storeProofIndexerMeta(client, CANONICAL_REBUILD_META_KEY, {
      ...rebuild,
      active: false,
      fault,
      status: "fault",
      updatedAt: detectedAt,
    });
  }
  return fault;
}

function canonicalRebuildCheckpointValue(
  rebuild,
  { blockHash, complete, height },
) {
  if (!rebuild || typeof rebuild !== "object") {
    return null;
  }
  // A completed PWT range replay is a permanent recovery certificate, not an
  // ordinary scan batch. Later canonical blocks must advance the checkpoint
  // covered by that certificate without reopening the replay or replacing its
  // immutable completion evidence. The strict replay-state readers in this
  // worker and proof-api intentionally reject an active tuple that still
  // carries a completion certificate.
  if (
    rebuild.mode === "pwt-range-replay" &&
    canonicalPwtRangeReplayState(rebuild) === "complete"
  ) {
    return {
      ...rebuild,
      indexedThroughBlock: height,
      indexedThroughBlockHash: blockHash,
      updatedAt: new Date().toISOString(),
    };
  }
  const { completedAt: _previousCompletedAt, ...baseRebuild } = rebuild;
  const updatedAt = new Date().toISOString();
  return {
    ...baseRebuild,
    active: !complete,
    ...(complete ? { completedAt: updatedAt } : {}),
    complete,
    indexedThroughBlock: height,
    indexedThroughBlockHash: blockHash,
    status: complete ? "complete" : "active",
    updatedAt,
  };
}

async function latestBlockScanCheckpoint(client, options = {}) {
  if (
    options.useStoredCheckpoint !== true &&
    Number.isSafeInteger(BLOCK_SCAN_FROM_HEIGHT) &&
    BLOCK_SCAN_FROM_HEIGHT > 0
  ) {
    return { blockHash: "", height: BLOCK_SCAN_FROM_HEIGHT - 1 };
  }
  const result = await client.query(
    `
      SELECT
        indexed_through_block,
        COALESCE(
          NULLIF(payload->>'indexedThroughBlockHash', ''),
          NULLIF(payload->>'blockHash', '')
        ) AS block_hash
      FROM proof_indexer.ledger_snapshots
      WHERE network = $1
        AND NOT COALESCE(source_hashes ? 'canonicalSummary', false)
        AND (
          COALESCE(source_hashes ? 'blockScan', false)
          OR COALESCE(
            payload->>'source' = 'proof-indexer-block-scan',
            false
          )
        )
        AND COALESCE(
          NULLIF(payload->>'indexedThroughBlockHash', ''),
          NULLIF(payload->>'blockHash', '')
        ) IS NOT NULL
      ORDER BY indexed_through_block DESC, generated_at DESC
      LIMIT 1
    `,
    [NETWORK],
  );
  const height = Number(result.rows[0]?.indexed_through_block ?? 0);
  if (
    result.rows.length === 0 ||
    !Number.isSafeInteger(height) ||
    height < 0
  ) {
    throw new Error(
      "No hashed authoritative block-scan checkpoint exists; set POW_INDEX_BACKFILL_BLOCK_SCAN_FROM_HEIGHT only for an explicit supervised replay",
    );
  }
  const blockHash = String(result.rows[0]?.block_hash ?? "")
    .trim()
    .toLowerCase();
  if (!/^[0-9a-f]{64}$/u.test(blockHash)) {
    throw new Error(
      "The stored block-scan checkpoint has no canonical block hash; an explicit supervised replay is required",
    );
  }
  return {
    blockHash,
    height,
  };
}

async function storeBlockScanSnapshot(client, payload) {
  const snapshotId = createHash("sha256")
    .update(
      JSON.stringify({
        indexedThroughBlock: payload.indexedThroughBlock,
        indexedThroughBlockHash: payload.indexedThroughBlockHash ?? "",
        network: NETWORK,
        source: "block-scan",
      }),
    )
    .digest("hex")
    .slice(0, 24);
  const generatedAt = new Date().toISOString();
  await client.query(
    `
      INSERT INTO proof_indexer.ledger_snapshots (
        network,
        snapshot_id,
        generated_at,
        indexed_through_block,
        source_hashes,
        metrics,
        consistency,
        payload
      )
      VALUES ($1, $2, $3::timestamptz, $4, $5::jsonb, $6::jsonb, $7::jsonb, $8::jsonb)
      ON CONFLICT (network, snapshot_id)
      DO UPDATE SET
        generated_at = EXCLUDED.generated_at,
        indexed_through_block = EXCLUDED.indexed_through_block,
        source_hashes = EXCLUDED.source_hashes,
        metrics = EXCLUDED.metrics,
        consistency = EXCLUDED.consistency,
        payload = EXCLUDED.payload
    `,
    [
      NETWORK,
      snapshotId,
      generatedAt,
      numberOrNull(payload.indexedThroughBlock),
      JSON.stringify({
        blockScan: payload.indexedThroughBlockHash || snapshotId,
      }),
      JSON.stringify({
        complete: payload.complete,
        indexed: payload.indexed,
        indexedThroughBlock: payload.indexedThroughBlock,
        indexedThroughBlockHash: payload.indexedThroughBlockHash ?? "",
        protocolTxids: payload.protocolTxids,
        scannedBlocks: payload.scannedBlocks,
        skipped: payload.skipped,
        stopReason: payload.stopReason ?? "",
        tipHeight: payload.tipHeight,
      }),
      JSON.stringify({
        ok: payload.complete === true,
        status: payload.complete === true
          ? "block-scan-current"
          : "block-scan-partial",
      }),
      JSON.stringify({
        complete: payload.complete === true,
        generatedAt,
        indexedThroughBlock: payload.indexedThroughBlock,
        indexedThroughBlockHash: payload.indexedThroughBlockHash ?? "",
        network: NETWORK,
        ...(payload.rebuild ? { rebuild: payload.rebuild } : {}),
        snapshotId,
        source: "proof-indexer-block-scan",
        stopReason: payload.stopReason ?? "",
        tipHeight: payload.tipHeight,
      }),
    ],
  );
  return snapshotId;
}

async function backfillBlockScanSource(client, source) {
  if (!BITCOIN_RPC_URL) {
    throw new Error(
      `BITCOIN_RPC_URL is required for ${source.label}; no block scan was performed`,
    );
  }

  const canonicalRebuildState = CANONICAL_REBUILD
    ? await prepareCanonicalRebuild(client)
    : null;
  const storedRebuild = canonicalRebuildState?.value ??
    (await proofIndexerMetaValue(client, CANONICAL_REBUILD_META_KEY));
  const storedPwtRangeReplayState =
    assertCanonicalPwtRangeReplayState(storedRebuild);
  const storedFault = await proofIndexerMetaValue(
    client,
    CANONICAL_FAULT_META_KEY,
  );
  if (storedFault?.network === NETWORK && storedFault?.active === true) {
    throw new Error(
      "Canonical indexing is faulted; run a new supervised canonical rebuild.",
    );
  }
  let canonicalRebuild =
    storedRebuild?.network === NETWORK &&
    ["active", "complete"].includes(storedRebuild?.status)
      ? storedRebuild
      : null;
  const completedPwtRangeReplay = storedPwtRangeReplayState === "complete";
  activatePwtRangeReplayVerifierBinding(canonicalRebuild);
  const checkpoint = await latestBlockScanCheckpoint(client, {
    useStoredCheckpoint: CANONICAL_REBUILD,
  });
  const latestIndexedHeight = checkpoint.height;
  const tipHeight = Number(await bitcoinRpc("getblockcount"));
  if (!Number.isSafeInteger(tipHeight) || tipHeight < latestIndexedHeight) {
    await storeCanonicalReorgFault(client, {
      checkpointHeight: latestIndexedHeight,
      nodeTipHeight: Number.isSafeInteger(tipHeight) ? tipHeight : null,
      phase: "checkpoint-ahead-of-tip",
    });
    throw new Error(
      `Block-scan checkpoint ${latestIndexedHeight} is ahead of node tip ${tipHeight}`,
    );
  }
  let indexedThroughBlockHash = checkpoint.blockHash;
  if (latestIndexedHeight > 0) {
    const canonicalCheckpointHash = String(
      await bitcoinRpc("getblockhash", [latestIndexedHeight]),
    )
      .trim()
      .toLowerCase();
    if (
      indexedThroughBlockHash &&
      canonicalCheckpointHash !== indexedThroughBlockHash
    ) {
      await storeCanonicalReorgFault(client, {
        actualBlockHash: canonicalCheckpointHash,
        expectedBlockHash: indexedThroughBlockHash,
        height: latestIndexedHeight,
        phase: "checkpoint",
      });
      throw new Error(
        `Bitcoin reorg detected at indexed checkpoint ${latestIndexedHeight}; operator replay is required`,
      );
    }
    indexedThroughBlockHash = canonicalCheckpointHash;
  }
  if (!Number.isSafeInteger(tipHeight) || tipHeight <= latestIndexedHeight) {
    if (canonicalRebuild?.status === "active") {
      const completedRebuildBase = canonicalRebuildCheckpointValue(
        canonicalRebuild,
        {
          blockHash: indexedThroughBlockHash,
          complete: true,
          height: latestIndexedHeight,
        },
      );
      await client.query("BEGIN");
      try {
        await seedCanonicalBondDefinitions(client, { required: true });
        await rebuildConfirmedCreditBalancesFromCanonicalEvents(client);
        const incbRangeReplayVerification =
          await verifyCanonicalIncbPwtRangeReplayProjection(
            client,
            // The completion verifier must consume the still-active replay
            // binding. A provisional complete tuple is intentionally invalid
            // until the returned certificate is attached below.
            canonicalRebuild,
          );
        const completedRebuild = incbRangeReplayVerification
          ? {
              ...completedRebuildBase,
              incbRangeReplayVerification,
            }
          : completedRebuildBase;
        await storeProofIndexerMeta(
          client,
          CANONICAL_REBUILD_META_KEY,
          completedRebuild,
        );
        await storeBlockScanSnapshot(client, {
          complete: true,
          indexed: 0,
          indexedThroughBlock: latestIndexedHeight,
          indexedThroughBlockHash,
          protocolTxids: 0,
          rebuild: completedRebuild,
          scannedBlocks: 0,
          skipped: 0,
          stopReason: "",
          tipHeight,
        });
        await client.query("COMMIT");
        canonicalRebuild = completedRebuild;
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      }
    }
    if (latestIndexedHeight > 0 && !checkpoint.blockHash) {
      await storeBlockScanSnapshot(client, {
        complete: tipHeight === latestIndexedHeight,
        indexed: 0,
        indexedThroughBlock: latestIndexedHeight,
        indexedThroughBlockHash,
        protocolTxids: 0,
        scannedBlocks: 0,
        skipped: 0,
        stopReason: "checkpoint-hash-bootstrap",
        tipHeight,
      });
    }
    return {
      blocks: 0,
      indexed: 0,
      latestIndexedHeight,
      skipped: 0,
      source: source.label,
      tipHeight,
      txids: 0,
    };
  }

  const maxBlocks = Math.max(0, BLOCK_SCAN_MAX_BLOCKS);
  const firstHeight = latestIndexedHeight + 1;
  const lastHeight = maxBlocks > 0
    ? Math.min(tipHeight, firstHeight + Math.floor(maxBlocks) - 1)
    : tipHeight;
  const maxProtocolTxids = Number.isFinite(BLOCK_SCAN_MAX_TXIDS) &&
    BLOCK_SCAN_MAX_TXIDS > 0
    ? Math.floor(BLOCK_SCAN_MAX_TXIDS)
    : Number.POSITIVE_INFINITY;
  let indexed = 0;
  let indexedThroughBlock = latestIndexedHeight;
  let protocolTxids = 0;
  let scanError = null;
  let skipped = 0;
  let scannedBlocks = 0;
  let stopReason = "";

  scanBlocks: for (let height = firstHeight; height <= lastHeight; height += 1) {
    if (protocolTxids >= maxProtocolTxids && scannedBlocks > 0) {
      stopReason = "protocol-txid-limit";
      break;
    }
    const blockHash = await bitcoinRpc("getblockhash", [height]);
    // Verbosity 2 is sufficient to identify protocol transactions. Hydrate
    // prevouts only for those transactions below instead of asking Core to
    // materialize every input in every unrelated transaction in the block.
    const block = await bitcoinRpc("getblock", [blockHash, 2]);
    assertCanonicalBlockEnvelope(block, height, blockHash);
    if (
      indexedThroughBlockHash &&
      String(block?.previousblockhash ?? "").toLowerCase() !==
        indexedThroughBlockHash
    ) {
      await storeCanonicalReorgFault(client, {
        actualPreviousBlockHash: String(
          block?.previousblockhash ?? "",
        ).toLowerCase(),
        expectedPreviousBlockHash: indexedThroughBlockHash,
        height,
        phase: "before-block",
        proposedBlockHash: String(blockHash ?? "").toLowerCase(),
      });
      throw new Error(
        `Bitcoin reorg detected before block ${height}; operator replay is required`,
      );
    }
    const protocolCandidates = (block?.tx ?? []).flatMap((tx, blockIndex) => {
      const messages = protocolMessagesFromTx(tx);
      return messages.length > 0 ? [{ blockIndex, messages, tx }] : [];
    });
    if (
      ((typeof STORE_CANONICAL_SUMMARY_SNAPSHOT !== "undefined" &&
        STORE_CANONICAL_SUMMARY_SNAPSHOT) ||
        activePwtRangeReplay(canonicalRebuild)) &&
      protocolCandidates.some(({ messages }) =>
        protocolMessagesContainInceptionBond(messages)
      )
    ) {
      const requiredCheckpoint = {
        blockHash: String(block?.previousblockhash ?? "").trim().toLowerCase(),
        height: height - 1,
      };
      await client.query("BEGIN");
      try {
        await rebuildConfirmedCreditBalancesFromCanonicalEvents(client);
        await client.query("COMMIT");
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      }
      const barrier = await storeCanonicalSummarySnapshot(client, {
        requiredCheckpoint,
      });
      if (
        Number(barrier?.indexedThroughBlock) !== requiredCheckpoint.height ||
        String(barrier?.indexedThroughBlockHash ?? "").trim().toLowerCase() !==
          requiredCheckpoint.blockHash
      ) {
        throw new Error(
          `Canonical Inception H-1 summary barrier failed at block ${height}`,
        );
      }
    }
    if (
      scannedBlocks > 0 &&
      Number.isFinite(maxProtocolTxids) &&
      protocolTxids + protocolCandidates.length > maxProtocolTxids
    ) {
      stopReason = "protocol-txid-limit";
      break;
    }
    scannedBlocks += 1;
    let foundInBlock = protocolCandidates.length;
    let blockIndexed = 0;
    let blockSkipped = 0;
    let currentTxid = "";
    const preparedTransactions = [];
    try {
      for (const { blockIndex, messages, tx } of protocolCandidates) {
        currentTxid = String(tx.txid ?? "");
        protocolTxids += 1;
        assertCanonicalProtocolTransactionContent(tx);
        const hydratedTx = await transactionWithInputPrevouts({
          ...tx,
          _powBlockIndex: blockIndex,
          _powBlockHash: String(blockHash ?? "").trim().toLowerCase(),
          _powPreviousBlockHash: String(block?.previousblockhash ?? "")
            .trim()
            .toLowerCase(),
          blocktime: block?.time,
          height,
        });
        assertHydratedProtocolTransaction(hydratedTx);
        preparedTransactions.push({
          items: await preparedProtocolItemsForTx(hydratedTx, messages),
          rawTx: hydratedTx,
          txid: currentTxid,
        });
      }
    } catch (error) {
      skipped += 1;
      scanError = error;
      stopReason = "protocol-verification-failed";
      console.error(
        JSON.stringify(canonicalBlockScanVerificationFailureRecord(error, {
          height,
          txid: currentTxid,
        })),
      );
      break scanBlocks;
    }

    const commitBlockHash = String(
      await bitcoinRpc("getblockhash", [height]),
    )
      .trim()
      .toLowerCase();
    if (commitBlockHash !== String(blockHash ?? "").trim().toLowerCase()) {
      await storeCanonicalReorgFault(client, {
        actualBlockHash: commitBlockHash,
        height,
        phase: "before-block-commit",
        proposedBlockHash: String(blockHash ?? "").trim().toLowerCase(),
      });
      throw new Error(
        `Bitcoin reorg detected before committing block ${height}; operator replay is required`,
      );
    }

    await client.query("BEGIN");
    try {
      await persistCanonicalBlock(client, block, height, blockHash);
      for (const prepared of preparedTransactions) {
        currentTxid = prepared.txid;
        await persistCanonicalRawTransaction(client, prepared.rawTx, {
          blockHash,
          blockTime: block?.time,
          height,
        });
        await removeVolatileWorkMintDecisionEvents(
          client,
          prepared.items,
          prepared.txid,
        );
        const result = await persistPreparedProtocolItems(client, prepared.items);
        blockIndexed += result.indexed;
        blockSkipped += result.skipped;
      }
      const nextIndexedThroughBlockHash = String(blockHash).trim().toLowerCase();
      const nextComplete = height >= tipHeight;
      const nextStopReason = nextComplete
        ? ""
        : protocolTxids >= maxProtocolTxids
          ? "protocol-txid-limit"
          : height >= lastHeight
            ? "block-limit"
            : "";
      const nextRebuild = canonicalRebuildCheckpointValue(canonicalRebuild, {
        blockHash: nextIndexedThroughBlockHash,
        complete: nextComplete,
        height,
      });
      let completedIncbRangeReplayVerification = null;
      if (nextComplete && !completedPwtRangeReplay) {
        if (canonicalRebuild) {
          await seedCanonicalBondDefinitions(client, { required: true });
        }
        await rebuildConfirmedCreditBalancesFromCanonicalEvents(client);
        completedIncbRangeReplayVerification =
          await verifyCanonicalIncbPwtRangeReplayProjection(
            client,
            // Keep the active replay binding authoritative while producing the
            // certificate. `nextRebuild` becomes a valid complete tuple only
            // after that certificate is attached below.
            canonicalRebuild,
          );
      }
      const verifiedNextRebuild =
        nextRebuild && completedIncbRangeReplayVerification
          ? {
              ...nextRebuild,
              incbRangeReplayVerification:
                completedIncbRangeReplayVerification,
            }
          : nextRebuild;
      if (verifiedNextRebuild) {
        await storeProofIndexerMeta(
          client,
          CANONICAL_REBUILD_META_KEY,
          verifiedNextRebuild,
        );
      }
      await storeBlockScanSnapshot(client, {
        complete: nextComplete,
        indexed: indexed + blockIndexed,
        indexedThroughBlock: height,
        indexedThroughBlockHash: nextIndexedThroughBlockHash,
        protocolTxids,
        rebuild: verifiedNextRebuild,
        scannedBlocks,
        skipped: skipped + blockSkipped,
        stopReason: nextStopReason,
        tipHeight,
      });
      await client.query("COMMIT");
      indexed += blockIndexed;
      skipped += blockSkipped;
      indexedThroughBlock = height;
      indexedThroughBlockHash = nextIndexedThroughBlockHash;
      canonicalRebuild = verifiedNextRebuild;
    } catch (error) {
      await client.query("ROLLBACK");
      skipped += 1;
      scanError = error;
      stopReason = "block-transaction-failed";
      console.error(
        JSON.stringify({
          error: error?.message ?? String(error),
          height,
          phase: "block-scan",
          txid: currentTxid,
        }),
      );
      break scanBlocks;
    }
    if (foundInBlock > 0 || scannedBlocks % 25 === 0 || height === lastHeight) {
      console.log(
        JSON.stringify({
          foundInBlock,
          height,
          indexed,
          protocolTxids,
          scannedBlocks,
          skipped,
          source: source.label,
          tipHeight,
        }),
      );
    }
  }

  const complete = indexedThroughBlock >= tipHeight;
  if (!stopReason && !complete) {
    stopReason = "block-limit";
  }
  const summary = {
    blocks: scannedBlocks,
    complete,
    fromHeight: firstHeight,
    indexed,
    indexedThroughBlock,
    indexedThroughBlockHash,
    latestIndexedHeight,
    skipped,
    source: source.label,
    stopReason,
    tipHeight,
    toHeight: lastHeight,
    txids: protocolTxids,
  };
  if (scanError) {
    throw new Error(
      `Block scan stopped at ${indexedThroughBlock}; ${scanError.message ?? String(scanError)}`,
      { cause: scanError },
    );
  }
  return summary;
}

async function mempoolScanState(client) {
  const key = `mempoolScan:${NETWORK}`;
  const result = await client.query(
    `SELECT value FROM proof_indexer.meta WHERE key = $1`,
    [key],
  );
  const value = result.rows[0]?.value;
  return {
    cursor: normalizedMempoolScanCursor(value?.cursor),
    key,
    priorityCursor: normalizedMempoolScanCursor(value?.priorityCursor),
    processedTxids: new Set(
      Array.isArray(value?.processedTxids)
        ? value.processedTxids
        : [],
    ),
  };
}

function normalizedMempoolScanCursor(value) {
  const txid = String(value?.txid ?? "").trim().toLowerCase();
  const time = Number(value?.time);
  if (!isHexTxid(txid) || !Number.isFinite(time) || time < 0) {
    return null;
  }
  return { time, txid };
}

function mempoolScanCursorForEntry(entry) {
  const [txid, metadata] = Array.isArray(entry) ? entry : [];
  return normalizedMempoolScanCursor({
    time: metadata?.time,
    txid,
  });
}

function mempoolEntriesAfterCursor(entries, cursor) {
  const normalizedCursor = normalizedMempoolScanCursor(cursor);
  if (!normalizedCursor || entries.length === 0) {
    return entries;
  }
  const exactIndex = entries.findIndex(
    ([txid]) => String(txid).trim().toLowerCase() === normalizedCursor.txid,
  );
  let startIndex = exactIndex >= 0
    ? exactIndex + 1
    : entries.findIndex(([txid, metadata]) => {
        const time = Number(metadata?.time);
        return (
          time < normalizedCursor.time ||
          (time === normalizedCursor.time &&
            String(txid).localeCompare(normalizedCursor.txid) > 0)
        );
      });
  if (startIndex < 0 || startIndex >= entries.length) {
    startIndex = 0;
  }
  return [
    ...entries.slice(startIndex),
    ...entries.slice(0, startIndex),
  ];
}

function plannedMempoolScanCandidates(
  entries,
  state,
  priorityTxids,
  { candidateLimit, seenLimit },
) {
  const limit = Number.isFinite(candidateLimit)
    ? Math.max(0, Math.floor(candidateLimit))
    : 500;
  if (limit === 0 || entries.length === 0) {
    return [];
  }
  const retainedHeadSize = Number.isFinite(seenLimit)
    ? Math.max(0, Math.floor(seenLimit))
    : 10_000;
  const processedTxids = typeof state?.processedTxids?.has === "function"
    ? state.processedTxids
    : new Set();
  const selected = new Set();
  const candidates = [];
  const urgentLimit = Math.max(0, limit - 1);
  const addCandidate = (entry, lane) => {
    const txid = String(entry?.[0] ?? "").trim().toLowerCase();
    if (!isHexTxid(txid) || selected.has(txid) || candidates.length >= limit) {
      return false;
    }
    selected.add(txid);
    candidates.push({ entry, lane });
    return true;
  };

  // Known rows that are stale or missing their event projection are
  // high-signal. Revalidate them first even when an old scanner checkpoint
  // says the txid was already seen.
  const prioritySet = new Set(
    (Array.isArray(priorityTxids) ? priorityTxids : [])
      .map((txid) => String(txid ?? "").trim().toLowerCase())
      .filter(isHexTxid),
  );
  for (const entry of mempoolEntriesAfterCursor(
    entries,
    state?.priorityCursor,
  )) {
    if (candidates.length >= urgentLimit) {
      break;
    }
    const txid = String(entry[0]).trim().toLowerCase();
    if (prioritySet.has(txid)) {
      addCandidate(entry, "priority");
    }
  }

  // Preserve low-latency discovery for new arrivals, but restrict this lane
  // to the retained head window so it cannot repeatedly consume the old tail.
  const headBudget = Math.min(
    100,
    Math.floor(limit / 5),
    urgentLimit - candidates.length,
  );
  let headAdded = 0;
  for (const entry of entries.slice(0, retainedHeadSize)) {
    if (headAdded >= headBudget) {
      break;
    }
    const txid = String(entry[0]).trim().toLowerCase();
    if (processedTxids.has(txid) || selected.has(txid)) {
      continue;
    }
    if (addCandidate(entry, "head")) {
      headAdded += 1;
    }
    if (candidates.length >= urgentLimit) {
      break;
    }
  }

  // The persisted cursor is independent of the bounded processed set. It
  // guarantees that a mempool larger than the seen limit is still swept in a
  // finite number of cycles, and its time/txid fallback survives removal of
  // the exact cursor transaction between cycles.
  for (const entry of mempoolEntriesAfterCursor(entries, state?.cursor)) {
    const txid = String(entry[0]).trim().toLowerCase();
    if (processedTxids.has(txid) || selected.has(txid)) {
      continue;
    }
    addCandidate(entry, "cursor");
    if (candidates.length >= limit) {
      break;
    }
  }
  const firstCursorIndex = candidates.findIndex(
    (candidate) => candidate.lane === "cursor",
  );
  if (firstCursorIndex > 0) {
    const [firstCursor] = candidates.splice(firstCursorIndex, 1);
    candidates.unshift(firstCursor);
  }
  return candidates;
}

function mempoolRecoveryTxidsFromRows(rows, mempool) {
  const currentRows = (Array.isArray(rows) ? rows : [])
    .map((row) => ({
      attemptedMints: Number(row?.attempted_mints ?? 0),
      confirmedSupply: Number(row?.confirmed_supply),
      eventCount: Number(row?.event_count ?? 0),
      inspectionVersion: Number(row?.inspection_version ?? 0),
      invalidDecisions: Number(row?.invalid_decisions ?? 0),
      protocolResolvedInvalid: row?.protocol_resolved_invalid === true,
      recoveryNeeded: row?.recovery_needed === true,
      resolvedInvalid: row?.resolved_invalid === true,
      status: String(row?.status ?? "").trim().toLowerCase(),
      txid: String(row?.txid ?? "").trim().toLowerCase(),
      validDecisions: Number(row?.valid_decisions ?? 0),
    }))
    .filter((row) => isHexTxid(row.txid) && Boolean(mempool?.[row.txid]));
  if (currentRows.length === 0) {
    return [];
  }
  const confirmedSupplies = new Set(
    currentRows.map((row) => row.confirmedSupply),
  );
  const confirmedSupply = currentRows[0].confirmedSupply;
  if (
    confirmedSupplies.size !== 1 ||
    !Number.isSafeInteger(confirmedSupply) ||
    confirmedSupply < 0 ||
    confirmedSupply > WORK_TOKEN_MAX_SUPPLY ||
    currentRows.some((row) =>
      [
        row.attemptedMints,
        row.eventCount,
        row.inspectionVersion,
        row.invalidDecisions,
        row.validDecisions,
      ].some((value) => !Number.isSafeInteger(value) || value < 0),
    ) ||
    currentRows.some(
      (row) =>
        (row.recoveryNeeded || row.resolvedInvalid) &&
        row.attemptedMints < 1,
    ) ||
    currentRows.some((row) => row.recoveryNeeded && row.resolvedInvalid)
  ) {
    throw new Error("Pending WORK mint recovery rows are inexact.");
  }

  const recoveryTxids = new Set();
  for (const row of currentRows) {
    if (row.inspectionVersion < 1) {
      recoveryTxids.add(row.txid);
    } else if (["dropped", "orphaned"].includes(row.status)) {
      recoveryTxids.add(row.txid);
    } else if (
      row.status === "pending" &&
      row.eventCount === 0 &&
      !row.protocolResolvedInvalid &&
      !row.resolvedInvalid
    ) {
      recoveryTxids.add(row.txid);
    }
  }

  let remainingSlots = Math.floor(
    (WORK_TOKEN_MAX_SUPPLY - confirmedSupply) / WORK_TOKEN_MINT_AMOUNT,
  );
  const decisions = currentRows
    .filter(
      (row) =>
        row.status === "pending" &&
        (row.recoveryNeeded ||
          (
            row.attemptedMints > 0 &&
            row.validDecisions + row.invalidDecisions === 0 &&
            !row.resolvedInvalid
          ) ||
          row.validDecisions + row.invalidDecisions > 0),
    )
    .sort((left, right) => left.txid.localeCompare(right.txid));
  let orderingUncertain = false;
  for (const row of decisions) {
    if (orderingUncertain) {
      recoveryTxids.add(row.txid);
      continue;
    }
    if (row.recoveryNeeded) {
      // A sibling protocol envelope was persisted while the WORK verifier
      // deferred. Until that WORK decision exists, neither this transaction's
      // slot use nor any later txid decision is safe to infer.
      recoveryTxids.add(row.txid);
      orderingUncertain = true;
      continue;
    }
    const attemptedMints = Math.max(
      1,
      row.attemptedMints,
      row.validDecisions,
      row.invalidDecisions,
    );
    if (attemptedMints > 1) {
      // Raw message count is deliberately not treated as payable mint count:
      // one transaction can carry several mint messages while funding fewer
      // of them, and earlier messages for another token can share the same
      // registry payment. Reverify this transaction and every later WORK
      // decision instead of consuming an unproven number of supply slots.
      recoveryTxids.add(row.txid);
      orderingUncertain = true;
      continue;
    }
    const expectedValidDecisions = Math.min(
      attemptedMints,
      remainingSlots,
    );
    remainingSlots -= expectedValidDecisions;
    const expectedInvalidDecisions = expectedValidDecisions === 0 ? 1 : 0;
    if (
      row.validDecisions !== expectedValidDecisions ||
      row.invalidDecisions !== expectedInvalidDecisions
    ) {
      recoveryTxids.add(row.txid);
    }
  }
  return [...recoveryTxids];
}

async function knownMempoolRecoveryTxids(client, mempool) {
  const result = await client.query(
    `
      WITH confirmed_work AS (
        SELECT count(*)::bigint * $3::bigint AS confirmed_supply
        FROM proof_indexer.events e
        JOIN proof_indexer.transactions confirmed_transaction
          ON confirmed_transaction.network = e.network
         AND confirmed_transaction.txid = e.txid
        WHERE e.network = $1
          AND confirmed_transaction.status = 'confirmed'
          AND e.status = 'confirmed'
          AND e.protocol = 'pwt1'
          AND e.kind = 'token-mint'
          AND e.valid = true
          AND lower(COALESCE(e.payload->>'tokenId', '')) = $2
      )
      SELECT
        t.txid,
        t.status,
        count(e.event_id)::integer AS event_count,
        COALESCE(max(
          CASE
            WHEN t.raw_tx->>'pendingWorkMintInspectionVersion' ~ '^[1-9][0-9]*$'
              THEN (t.raw_tx->>'pendingWorkMintInspectionVersion')::integer
            ELSE 0
          END
        ), 0)::integer AS inspection_version,
        count(*) FILTER (
          WHERE e.status = 'pending'
            AND e.protocol = 'pwt1'
            AND e.kind = 'token-mint'
            AND e.valid = true
            AND lower(COALESCE(e.payload->>'tokenId', '')) = $2
        )::integer AS valid_decisions,
        count(*) FILTER (
          WHERE e.status = 'pending'
            AND e.protocol = 'pwt1'
            AND e.kind = 'token-event-invalid'
            AND e.valid = false
            AND e.payload->>'provisionalReason' = 'supply-cap'
            AND lower(COALESCE(e.payload->>'tokenId', '')) = $2
        )::integer AS invalid_decisions,
        GREATEST(
          COALESCE(max(
            CASE
              WHEN e.payload->>'pendingWorkMintAttemptCount' ~ '^[1-9][0-9]*$'
                THEN (e.payload->>'pendingWorkMintAttemptCount')::integer
              ELSE 0
            END
          ), 0),
          COALESCE(max(
            CASE
              WHEN t.raw_tx->>'pendingWorkMintAttemptCount' ~ '^[1-9][0-9]*$'
                THEN (t.raw_tx->>'pendingWorkMintAttemptCount')::integer
              ELSE 0
            END
          ), 0)
        )::integer AS attempted_mints,
        bool_or(
          t.raw_tx->>'pendingWorkMintRecoveryNeeded' = 'true'
        ) AS recovery_needed,
        bool_or(
          t.raw_tx->>'pendingWorkMintResolvedInvalid' = 'true'
        ) AS resolved_invalid,
        bool_or(
          t.raw_tx->>'pendingProtocolResolvedInvalid' = 'true'
        ) AS protocol_resolved_invalid,
        confirmed_work.confirmed_supply
      FROM proof_indexer.transactions t
      CROSS JOIN confirmed_work
      LEFT JOIN proof_indexer.events e
        ON e.network = t.network
       AND e.txid = t.txid
      WHERE t.network = $1
        AND t.status IN ('pending', 'dropped', 'orphaned')
      GROUP BY
        t.txid,
        t.status,
        t.last_seen_at,
        confirmed_work.confirmed_supply
      ORDER BY t.last_seen_at ASC, t.txid ASC
    `,
    [NETWORK, WORK_TOKEN_ID, WORK_TOKEN_MINT_AMOUNT],
  );
  return mempoolRecoveryTxidsFromRows(result.rows, mempool);
}

async function storeMempoolScanState(
  client,
  key,
  processedTxids,
  cursor,
  priorityCursor,
) {
  await client.query(
    `
      INSERT INTO proof_indexer.meta (key, value, updated_at)
      VALUES ($1, $2::jsonb, now())
      ON CONFLICT (key)
      DO UPDATE SET value = EXCLUDED.value, updated_at = now()
    `,
    [
      key,
      JSON.stringify({
        cursor: normalizedMempoolScanCursor(cursor),
        priorityCursor: normalizedMempoolScanCursor(priorityCursor),
        processedTxids,
        scannedAt: new Date().toISOString(),
      }),
    ],
  );
}

function pendingTransactionObservationItem(preparedItems, txid) {
  const prepared = Array.isArray(preparedItems) ? preparedItems : [];
  const items = prepared.map((entry) => entry?.item ?? entry).filter(Boolean);
  if (items.length === 0 || items.some((item) => item?.valid !== false)) {
    return null;
  }
  return {
    ...items[0],
    confirmed: false,
    dropped: false,
    status: "pending",
    txid,
  };
}

function pendingTransactionWriteItem(preparedItems, txid) {
  const invalidObservation = pendingTransactionObservationItem(
    preparedItems,
    txid,
  );
  if (invalidObservation) {
    return invalidObservation;
  }
  const item = (Array.isArray(preparedItems) ? preparedItems : [])
    .map((entry) => entry?.item ?? entry)
    .find(Boolean);
  return item
    ? {
        ...item,
        confirmed: false,
        dropped: false,
        status: "pending",
        txid,
      }
    : null;
}

function pendingWorkMintAttemptCount(messages) {
  return (Array.isArray(messages) ? messages : []).filter((message) => {
    if (message?.prefix !== "pwt1:") {
      return false;
    }
    const parts = String(message?.text ?? "").split(":");
    return (
      String(parts[1] ?? "").trim().toLowerCase() === "mint" &&
      String(parts[2] ?? "").trim().toLowerCase() === WORK_TOKEN_ID &&
      canonicalIntegerText(parts[3], { positive: true }) ===
        String(WORK_TOKEN_MINT_AMOUNT)
    );
  }).length;
}

function pendingCoreMarketplaceVerifierNeeded(messages) {
  return (Array.isArray(messages) ? messages : []).some((message) => {
    if (message?.prefix !== "pwt1:") {
      return false;
    }
    const action = String(message?.text ?? "")
      .split(":")[1]
      ?.trim()
      .toLowerCase();
    return ["buy5", "delist5", "list5", "seal5"].includes(action);
  });
}

function pendingWorkMintVerifierResolved(preparedItems) {
  return (Array.isArray(preparedItems) ? preparedItems : [])
    .map((entry) => entry?.item ?? entry)
    .some(
      (item) =>
        ["token-mint", "token-event-invalid"].includes(item?.kind) &&
        String(item?.tokenId ?? "").trim().toLowerCase() === WORK_TOKEN_ID,
    );
}

function pendingProtocolTransactionObservation(
  txid,
  workMintAttemptCount,
  workMintRecoveryNeeded,
  workMintResolvedInvalid,
) {
  return {
    confirmed: false,
    dropped: false,
    kind: "pending-protocol-transaction",
    pendingWorkMintAttemptCount: workMintAttemptCount,
    pendingWorkMintInspectionVersion: 1,
    pendingWorkMintRecoveryNeeded: workMintRecoveryNeeded,
    pendingWorkMintResolvedInvalid: workMintResolvedInvalid,
    status: "pending",
    txid,
    valid: false,
  };
}

async function storePendingWorkMintInspection(
  client,
  txid,
  attemptCount,
  recoveryNeeded,
  resolvedInvalid,
  protocolResolvedInvalid = false,
) {
  const result = await client.query(
    `
      UPDATE proof_indexer.transactions t
      SET
        raw_tx = COALESCE(t.raw_tx, '{}'::jsonb) || jsonb_build_object(
          'pendingWorkMintAttemptCount', $3::integer,
          'pendingWorkMintInspectionVersion', 1,
          'pendingWorkMintRecoveryNeeded', $4::boolean,
          'pendingWorkMintResolvedInvalid', $5::boolean,
          'pendingProtocolResolvedInvalid', $6::boolean
        ),
        updated_at = now()
      WHERE t.network = $1
        AND t.txid = $2
        AND t.status = 'pending'
        AND NOT (COALESCE(t.raw_tx, '{}'::jsonb) ? 'canonicalBlockScan')
      RETURNING t.txid
    `,
    [
      NETWORK,
      txid,
      attemptCount,
      recoveryNeeded,
      resolvedInvalid,
      protocolResolvedInvalid,
    ],
  );
  if (result.rowCount !== 1) {
    throw new Error(
      `Pending WORK inspection could not bind transaction ${txid}.`,
    );
  }
}

async function storePendingWorkMintAttemptPreinspection(
  client,
  txid,
  attemptCount,
) {
  if (!Number.isSafeInteger(attemptCount) || attemptCount < 1) {
    return 0;
  }
  const result = await client.query(
    `
      UPDATE proof_indexer.transactions t
      SET
        raw_tx = COALESCE(t.raw_tx, '{}'::jsonb) || jsonb_build_object(
          'pendingWorkMintAttemptCount', $3::integer,
          'pendingWorkMintInspectionVersion', 1,
          'pendingWorkMintRecoveryNeeded', true,
          'pendingWorkMintResolvedInvalid', false
        ),
        updated_at = now()
      WHERE t.network = $1
        AND t.txid = $2
        AND t.status = 'pending'
        AND NOT (COALESCE(t.raw_tx, '{}'::jsonb) ? 'canonicalBlockScan')
        AND COALESCE(
          t.raw_tx->>'pendingWorkMintInspectionVersion',
          '0'
        ) !~ '^[1-9][0-9]*$'
      RETURNING t.txid
    `,
    [NETWORK, txid, attemptCount],
  );
  return Number(result.rowCount ?? 0);
}

async function lockedCanonicalTransactionForMempool(client, txid) {
  const result = await client.query(
    `
      SELECT
        t.status,
        (
          t.status = 'confirmed'
          AND t.raw_tx ? 'canonicalBlockScan'
          AND EXISTS (
            SELECT 1
            FROM proof_indexer.blocks b
            WHERE b.network = t.network
              AND b.block_hash = t.block_hash
              AND b.height = t.block_height
              AND b.canonical = true
          )
        ) AS canonical_confirmed
      FROM proof_indexer.transactions t
      WHERE t.network = $1
        AND t.txid = $2
      FOR UPDATE
    `,
    [NETWORK, txid],
  );
  return result.rows[0]?.canonical_confirmed === true;
}

function pendingWorkMintDecision(preparedItems, workMintAttemptCount = 0) {
  const items = (Array.isArray(preparedItems) ? preparedItems : [])
    .map((entry) => entry?.item ?? entry)
    .filter(Boolean);
  const validMints = items.filter(
    (item) =>
      item?.kind === "token-mint" &&
      item?.valid !== false &&
      item?.confirmed === false &&
      String(item?.tokenId ?? "").trim().toLowerCase() === WORK_TOKEN_ID,
  );
  const supplyCapInvalids = items.filter(
    (item) =>
      item?.kind === "token-event-invalid" &&
      item?.valid === false &&
      item?.confirmed === false &&
      String(item?.tokenId ?? "").trim().toLowerCase() === WORK_TOKEN_ID &&
      (item?.provisionalReason === "supply-cap" ||
        String(item?.reason ?? "").startsWith(
          "WORK mint exceeds max supply:",
        )),
  );
  const resolvedInvalids = items.filter(
    (item) =>
      item?.kind === "token-event-invalid" &&
      item?.valid === false &&
      item?.confirmed === false &&
      String(item?.tokenId ?? "").trim().toLowerCase() === WORK_TOKEN_ID,
  );
  if (validMints.length > 0 && supplyCapInvalids.length > 0) {
    throw new Error(
      "Pending WORK mint verifier returned conflicting valid and supply-cap decisions.",
    );
  }
  if (validMints.length > 0) {
    return { kind: "valid", persistInvalid: false };
  }
  if (supplyCapInvalids.length > 0) {
    return { kind: "supply-cap-invalid", persistInvalid: true };
  }
  if (
    Number.isSafeInteger(workMintAttemptCount) &&
    workMintAttemptCount > 0 &&
    resolvedInvalids.length > 0
  ) {
    return { kind: "resolved-invalid", persistInvalid: false };
  }
  return null;
}

async function reconcilePendingWorkMintDecision(
  client,
  preparedItems,
  txid,
  workMintAttemptCount,
) {
  const decision = pendingWorkMintDecision(
    preparedItems,
    workMintAttemptCount,
  );
  if (!decision) {
    return { deleted: 0, persistInvalid: false, reconciled: false };
  }
  const result = await client.query(
    `
      WITH canonical_guard AS (
        SELECT 1
        FROM proof_indexer.transactions canonical_transaction
        JOIN proof_indexer.blocks canonical_block
          ON canonical_block.network = canonical_transaction.network
         AND canonical_block.block_hash = canonical_transaction.block_hash
         AND canonical_block.height = canonical_transaction.block_height
         AND canonical_block.canonical = true
        WHERE canonical_transaction.network = $1
          AND canonical_transaction.txid = $2
          AND canonical_transaction.status = 'confirmed'
          AND canonical_transaction.raw_tx ? 'canonicalBlockScan'
        LIMIT 1
      ), deleted AS (
        DELETE FROM proof_indexer.events e
        WHERE e.network = $1
          AND e.txid = $2
          AND e.protocol = 'pwt1'
          AND e.status IN ('pending', 'dropped', 'orphaned')
          AND (
            e.kind = 'token-mint'
            OR (
              e.kind = 'token-event-invalid'
              AND (
                e.payload->>'provisionalReason' = 'supply-cap'
                OR e.payload->>'reason' LIKE 'WORK mint exceeds max supply:%'
              )
            )
          )
          AND lower(COALESCE(e.payload->>'tokenId', '')) = $3
          AND NOT EXISTS (SELECT 1 FROM canonical_guard)
        RETURNING e.event_id
      )
      SELECT
        EXISTS (SELECT 1 FROM canonical_guard) AS canonical_confirmed,
        count(*)::integer AS deleted
      FROM deleted
    `,
    [NETWORK, txid, WORK_TOKEN_ID],
  );
  if (result.rows[0]?.canonical_confirmed === true) {
    throw new Error(
      `Canonical confirmed transaction ${txid} cannot be reconciled from the mempool.`,
    );
  }
  return {
    deleted: Number(result.rows[0]?.deleted ?? 0),
    persistInvalid: decision.persistInvalid,
    reconciled: true,
  };
}

async function removeVolatileWorkMintDecisionEvents(
  client,
  preparedItems,
  txid,
) {
  const items = (Array.isArray(preparedItems) ? preparedItems : [])
    .map((entry) => entry?.item ?? entry)
    .filter(Boolean);
  const hasCanonicalWorkMintDecision = items.some(
    (item) =>
      String(item?.tokenId ?? "").trim().toLowerCase() === WORK_TOKEN_ID &&
      ["token-mint", "token-event-invalid"].includes(item?.kind),
  );
  if (!hasCanonicalWorkMintDecision) {
    return 0;
  }
  const result = await client.query(
    `
      DELETE FROM proof_indexer.events e
      WHERE e.network = $1
        AND e.txid = $2
        AND e.protocol = 'pwt1'
        AND e.status IN ('pending', 'dropped', 'orphaned')
        AND (
          e.kind = 'token-mint'
          OR (
            e.kind = 'token-event-invalid'
            AND (
              e.payload->>'provisionalReason' = 'supply-cap'
              OR e.payload->>'reason' LIKE 'WORK mint exceeds max supply:%'
            )
          )
        )
        AND lower(COALESCE(e.payload->>'tokenId', '')) = $3
    `,
    [NETWORK, txid, WORK_TOKEN_ID],
  );
  return Number(result.rowCount ?? 0);
}

async function backfillMempoolScanSource(client, source) {
  if (!BITCOIN_RPC_URL) {
    return {
      error: "BITCOIN_RPC_URL is not configured",
      indexed: 0,
      source: source.label,
      unresolved: 0,
    };
  }
  let mempool;
  try {
    mempool = await bitcoinRpc("getrawmempool", [true]);
  } catch (error) {
    console.error(
      JSON.stringify({
        error: error?.message ?? String(error),
        phase: "mempool-scan",
      }),
    );
    return {
      error: error?.message ?? String(error),
      indexed: 0,
      source: source.label,
      unresolved: 0,
    };
  }

  const state = await mempoolScanState(client);
  const entries = Object.entries(mempool ?? {})
    .filter(([txid]) => isHexTxid(txid))
    .sort(
      (left, right) =>
        Number(right[1]?.time ?? 0) - Number(left[1]?.time ?? 0) ||
        left[0].localeCompare(right[0]),
    );
  const candidateLimit = Number.isFinite(MEMPOOL_SCAN_MAX_TXIDS)
    ? Math.max(0, Math.floor(MEMPOOL_SCAN_MAX_TXIDS))
    : 500;
  const seenLimit = Number.isFinite(MEMPOOL_SCAN_SEEN_LIMIT)
    ? Math.max(100, Math.floor(MEMPOOL_SCAN_SEEN_LIMIT))
    : 10_000;
  const priorityTxids = await knownMempoolRecoveryTxids(client, mempool);
  const candidates = plannedMempoolScanCandidates(
    entries,
    state,
    priorityTxids,
    { candidateLimit, seenLimit },
  );
  const processed = new Set(
    [...state.processedTxids].filter((txid) => mempool?.[txid]),
  );
  let cursor = state.cursor;
  let priorityCursor = state.priorityCursor;
  let canonicalDeferred = 0;
  let cursorScanned = 0;
  let headScanned = 0;
  let indexed = 0;
  let priorityScanned = 0;
  let protocolTxids = 0;
  let scanned = 0;
  let unresolved = 0;

  for (const candidate of candidates) {
    if (protocolTxids >= Math.max(1, MEMPOOL_SCAN_MAX_PROTOCOL_TXIDS)) {
      break;
    }
    const [txid] = candidate.entry;
    scanned += 1;
    if (candidate.lane === "cursor") {
      cursorScanned += 1;
    } else if (candidate.lane === "head") {
      headScanned += 1;
    } else if (candidate.lane === "priority") {
      priorityScanned += 1;
      priorityCursor =
        mempoolScanCursorForEntry(candidate.entry) ?? priorityCursor;
    }
    const tx = await freshRawTransactionFromCore(txid);
    if (!tx) {
      continue;
    }
    if (candidate.lane === "cursor") {
      cursor = mempoolScanCursorForEntry(candidate.entry) ?? cursor;
    }
    if (transactionHasConfirmedBlockEvidence(tx)) {
      // The transaction confirmed after the mempool snapshot. Only the
      // canonical block scanner may persist confirmed state and block proof.
      canonicalDeferred += 1;
      continue;
    }
    const messages = protocolMessagesFromTx(tx);
    if (messages.length === 0) {
      processed.add(txid);
      continue;
    }
    protocolTxids += 1;
    let transactionOpen = false;
    try {
      const workMintAttemptCount = pendingWorkMintAttemptCount(messages);
      const legacyWorkInspection =
        await storePendingWorkMintAttemptPreinspection(
          client,
          txid,
          workMintAttemptCount,
        );
      const extendedPendingVerifier =
        legacyWorkInspection > 0 ||
        pendingCoreMarketplaceVerifierNeeded(messages);
      const hydrated = await transactionWithInputPrevouts(tx);
      const rawVerifiedPrepared = await preparedProtocolItemsForTx(
        hydrated,
        messages,
        extendedPendingVerifier
          ? { pendingVerifierTimeoutMs: PENDING_LEGACY_VERIFIER_TIMEOUT_MS }
          : undefined,
      );
      const workMintResolvedInvalid =
        workMintAttemptCount > 0 &&
        pendingWorkMintDecision(
          rawVerifiedPrepared,
          workMintAttemptCount,
        )?.kind === "resolved-invalid";
      const workMintRecoveryNeeded =
        workMintAttemptCount > 0 &&
        !pendingWorkMintVerifierResolved(rawVerifiedPrepared);
      const protocolResolvedInvalid =
        rawVerifiedPrepared.length > 0 &&
        rawVerifiedPrepared.every(
          (entry) => (entry?.item ?? entry)?.valid === false,
        );
      const verifiedPrepared = rawVerifiedPrepared.map((entry) => {
        const item = entry?.item ?? entry;
        const workMintDecision =
          workMintAttemptCount > 0 &&
          ["token-mint", "token-event-invalid"].includes(item?.kind) &&
          String(item?.tokenId ?? "").trim().toLowerCase() === WORK_TOKEN_ID;
        if (!workMintDecision) {
          return entry;
        }
        const annotatedItem = {
          ...item,
          pendingWorkMintAttemptCount: workMintAttemptCount,
        };
        return entry?.item ? { ...entry, item: annotatedItem } : annotatedItem;
      });
      const transactionObservation = pendingTransactionWriteItem(
        verifiedPrepared,
        txid,
      ) ?? pendingProtocolTransactionObservation(
        txid,
        workMintAttemptCount,
        workMintRecoveryNeeded,
        workMintResolvedInvalid,
      );
      const beforeWrite = await freshRawTransactionFromCore(txid);
      if (!beforeWrite) {
        throw new Error(
          `Fresh mempool status is unavailable before writing ${txid}.`,
        );
      }
      if (transactionHasConfirmedBlockEvidence(beforeWrite)) {
        canonicalDeferred += 1;
        continue;
      }
      await client.query("BEGIN");
      transactionOpen = true;
      // The upsert takes the transaction-row lock in the same order as the
      // canonical block scanner. Re-read under that lock before replacing
      // any volatile event decision so confirmation cannot race this write.
      await upsertTransaction(
        client,
        transactionObservation,
        txid,
        "pending",
        source.label,
      );
      if (await lockedCanonicalTransactionForMempool(client, txid)) {
        await client.query("ROLLBACK");
        transactionOpen = false;
        canonicalDeferred += 1;
        continue;
      }
      await storePendingWorkMintInspection(
        client,
        txid,
        workMintAttemptCount,
        workMintRecoveryNeeded,
        workMintResolvedInvalid,
        protocolResolvedInvalid,
      );
      const pendingWorkReconciliation =
        await reconcilePendingWorkMintDecision(
          client,
          verifiedPrepared,
          txid,
          workMintAttemptCount,
        );
      const prepared = verifiedPrepared.flatMap((entry) => {
        const item = entry?.item ?? entry;
        if (item?.valid !== false) {
          return [entry];
        }
        const supplyCapInvalid =
          pendingWorkReconciliation.persistInvalid &&
          item?.kind === "token-event-invalid" &&
          String(item?.tokenId ?? "").trim().toLowerCase() === WORK_TOKEN_ID &&
          (item?.provisionalReason === "supply-cap" ||
            String(item?.reason ?? "").startsWith(
              "WORK mint exceeds max supply:",
            ));
        if (!supplyCapInvalid) {
          return [];
        }
        const normalizedItem = {
          ...item,
          confirmed: false,
          provisional: true,
          provisionalReason: "supply-cap",
          status: "pending",
        };
        return [
          entry?.item ? { ...entry, item: normalizedItem } : normalizedItem,
        ];
      });
      const result = await persistPreparedProtocolItems(client, prepared);
      const beforeCommit = await freshRawTransactionFromCore(txid);
      if (!beforeCommit) {
        throw new Error(
          `Fresh mempool status is unavailable before committing ${txid}.`,
        );
      }
      if (transactionHasConfirmedBlockEvidence(beforeCommit)) {
        await client.query("ROLLBACK");
        transactionOpen = false;
        canonicalDeferred += 1;
        continue;
      }
      await client.query("COMMIT");
      transactionOpen = false;
      indexed += result.indexed;
      processed.add(txid);
    } catch (error) {
      if (transactionOpen) {
        await client.query("ROLLBACK").catch(() => {});
      }
      unresolved += 1;
      console.error(
        JSON.stringify({
          error: error?.message ?? String(error),
          phase: "mempool-protocol-verification",
          txid,
        }),
      );
    }
  }

  const nextProcessed = entries
    .map(([txid]) => txid)
    .filter((txid) => processed.has(txid))
    .slice(0, seenLimit);
  await storeMempoolScanState(
    client,
    state.key,
    nextProcessed,
    cursor,
    priorityCursor,
  );
  return {
    canonicalDeferred,
    cursor,
    cursorScanned,
    headScanned,
    indexed,
    mempoolSize: entries.length,
    priorityCandidates: priorityTxids.length,
    priorityCursor,
    priorityScanned,
    protocolTxids,
    scanned,
    source: source.label,
    unresolved,
  };
}

async function backfillSource(client, source) {
  if (source.mempoolScan) {
    return backfillMempoolScanSource(client, source);
  }
  if (source.blockScan) {
    return backfillBlockScanSource(client, source);
  }

  if (source.addressMail) {
    return backfillAddressMailSource(client, source);
  }

  let cursor = "";
  let page = 0;
  let seen = 0;
  let skipped = 0;

  while (page < MAX_PAGES) {
    const url = endpoint(
      source.path,
      backfillSourceParams({ ...(source.params ?? {}), cursor }),
    );
    const payload = await readJson(url);
    const items = Array.isArray(payload.items) ? payload.items : [];

    await client.query("BEGIN");
    try {
      for (const item of items) {
        const result = await upsertEvent(client, source.label, item);
        if (result.skipped) {
          skipped += 1;
        } else {
          seen += 1;
        }
      }
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    }

    console.log(
      JSON.stringify({
        cursor: payload.cursor,
        indexed: seen,
        page,
        skipped,
        source: source.label,
        totalCount: payload.totalCount,
      }),
    );

    cursor = String(payload.nextCursor ?? "");
    page += 1;
    if (!cursor || items.length === 0) {
      break;
    }
  }

  return { indexed: seen, skipped, source: source.label };
}

async function addressMailBackfillAddresses(client) {
  const addresses = new Set([
    ...DEFAULT_MAIL_BACKFILL_ADDRESSES,
    ...CONFIGURED_MAIL_BACKFILL_ADDRESSES,
  ]);

  const remaining = Math.max(0, MAIL_BACKFILL_ADDRESS_LIMIT - addresses.size);
  if (remaining > 0) {
    const result = await client.query(
      `
        SELECT owner_address, receive_address
        FROM proof_indexer.id_records
        WHERE network = $1
        ORDER BY updated_at DESC NULLS LAST, display_id ASC
        LIMIT $2
      `,
      [NETWORK, remaining],
    );
    for (const row of result.rows) {
      if (row.owner_address) {
        addresses.add(row.owner_address);
      }
      if (row.receive_address) {
        addresses.add(row.receive_address);
      }
    }
  }

  return [...addresses].slice(0, Math.max(0, MAIL_BACKFILL_ADDRESS_LIMIT));
}

async function backfillAddressMailSource(client, source) {
  let seen = 0;
  let skipped = 0;
  const addresses = await addressMailBackfillAddresses(client);

  for (const [index, address] of addresses.entries()) {
    const payload = await readJson(
      endpoint(`/api/v1/address/${encodeURIComponent(address)}/mail`),
    ).catch((error) => {
      console.error(
        JSON.stringify({
          address,
          error: error?.message ?? String(error),
          source: source.label,
        }),
      );
      return null;
    });
    const items = addressMailPayloadEvents(payload, address);

    await client.query("BEGIN");
    try {
      for (const item of items) {
        const result = await upsertEvent(client, source.label, item);
        if (result.skipped) {
          skipped += 1;
        } else {
          seen += 1;
        }
      }
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    }

    console.log(
      JSON.stringify({
        address,
        indexed: seen,
        page: index,
        skipped,
        source: source.label,
        totalCount: items.length,
      }),
    );
  }

  return {
    addresses: addresses.length,
    indexed: seen,
    skipped,
    source: source.label,
  };
}

async function backfillScopedTokenHolders(client) {
  if (!INCLUDE_SCOPED_HOLDERS) {
    return { indexed: 0, skipped: 0, source: "token-holders" };
  }

  const tokenResult = await client.query(
    `
      SELECT token_id
      FROM proof_indexer.credit_definitions
      WHERE network = $1
      ORDER BY token_id
    `,
    [NETWORK],
  );
  let indexed = 0;
  let skipped = 0;
  let tokenCount = 0;

  for (const row of tokenResult.rows) {
    const tokenId = row.token_id;
    let cursor = "";
    let page = 0;

    while (page < MAX_PAGES) {
      const url = endpoint("/api/v1/token-history", {
        ...backfillSourceParams({
          asset: tokenId,
          cursor,
          kind: "holders",
        }),
      });
      const payload = await readJson(url);
      const items = Array.isArray(payload.items) ? payload.items : [];

      await client.query("BEGIN");
      try {
        for (const item of items) {
          if (item?.address) {
            await upsertProjection(
              client,
              "token-holders",
              { ...item, tokenId },
              "confirmed",
            );
            indexed += 1;
          } else {
            skipped += 1;
          }
        }
        await client.query("COMMIT");
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      }

      cursor = String(payload.nextCursor ?? "");
      page += 1;
      if (!cursor || items.length === 0) {
        break;
      }
    }

    tokenCount += 1;
    console.log(
      JSON.stringify({
        indexed,
        skipped,
        source: "token-holders",
        tokenCount,
        tokenId,
        totalTokens: tokenResult.rows.length,
      }),
    );
  }

  return { indexed, skipped, source: "token-holders", tokens: tokenResult.rows.length };
}

async function repairConfirmedWorkTransferParticipants(client) {
  if (!REPAIR_WORK_PARTICIPANTS) {
    return { indexed: 0, skipped: 0, source: "repair-work-participants" };
  }
  if (!BITCOIN_RPC_URL) {
    throw new Error("BITCOIN_RPC_URL is required for WORK participant repair.");
  }

  const limit = Number.isFinite(REPAIR_WORK_PARTICIPANTS_LIMIT)
    ? Math.max(1, Math.floor(REPAIR_WORK_PARTICIPANTS_LIMIT))
    : 500;
  const explicit = REPAIR_WORK_PARTICIPANTS_TXIDS.length > 0;
  const repairFilter = explicit
    ? "lower(e.txid) = ANY($3::text[])"
    : `(
        COALESCE(NULLIF(e.payload->>'senderAddress', ''), '') = ''
        OR NOT EXISTS (
          SELECT 1
          FROM proof_indexer.event_participants ep
          WHERE ep.event_id = e.event_id
            AND ep.role = 'sender'
        )
        OR (
          COALESCE(NULLIF(e.payload->>'recipientAddress', ''), '') <> ''
          AND NOT EXISTS (
            SELECT 1
            FROM proof_indexer.event_participants ep
            WHERE ep.event_id = e.event_id
              AND ep.role = 'recipient'
              AND ep.address = e.payload->>'recipientAddress'
          )
        )
      )`;
  const limitParam = explicit ? "$4" : "$3";
  const params = explicit
    ? [NETWORK, WORK_TOKEN_ID, REPAIR_WORK_PARTICIPANTS_TXIDS, limit]
    : [NETWORK, WORK_TOKEN_ID, limit];
  const result = await client.query(
    `
      SELECT DISTINCT ON (lower(e.txid))
        e.txid,
        e.block_height,
        e.block_time,
        e.event_time
      FROM proof_indexer.events e
      LEFT JOIN proof_indexer.transactions t
        ON t.network = e.network
       AND t.txid = e.txid
      LEFT JOIN proof_indexer.credit_definitions cd
        ON cd.network = e.network
       AND cd.token_id = lower(e.payload->>'tokenId')
      WHERE e.network = $1
        AND e.valid IS DISTINCT FROM false
        AND e.kind = 'token-transfer'
        AND COALESCE(t.status, e.status) = 'confirmed'
        AND (
          lower(e.payload->>'tokenId') = $2
          OR lower(cd.token_id) = $2
          OR lower(cd.ticker) = 'work'
        )
        AND ${repairFilter}
      ORDER BY
        lower(e.txid),
        COALESCE(e.block_time, t.block_time, e.event_time, t.confirmed_at, e.created_at) DESC
      LIMIT ${limitParam}
    `,
    params,
  );

  const rowsByTxid = new Map(
    result.rows.map((row) => [String(row.txid ?? "").toLowerCase(), row]),
  );
  const missingRequested = REPAIR_WORK_PARTICIPANTS_TXIDS.filter(
    (txid) => !rowsByTxid.has(txid),
  );
  if (missingRequested.length > 0) {
    throw new Error(
      `WORK participant repair cannot proceed; confirmed valid event row is missing for: ${missingRequested.join(",")}`,
    );
  }

  let indexed = 0;
  let skipped = 0;
  const failures = [];
  for (const row of rowsByTxid.values()) {
    const txid = String(row.txid ?? "").trim().toLowerCase();
    try {
      const tx = await rawTransactionFromCore(txid);
      if (!tx) {
        throw new Error("transaction is unavailable from Bitcoin Core");
      }
      if (
        !String(tx.blockhash ?? "").trim() ||
        !Number.isFinite(Number(tx.confirmations)) ||
        Number(tx.confirmations) <= 0
      ) {
        throw new Error("transaction is not confirmed in Bitcoin Core");
      }
      let blockHeight = numberOrNull(row.block_height);
      if (!blockHeight) {
        const header = await bitcoinRpc("getblockheader", [tx.blockhash, true]);
        blockHeight = numberOrNull(header?.height);
      }
      const hydratedTx = await transactionWithInputPrevouts({
        ...tx,
        blocktime:
          tx.blocktime ??
          tx.time ??
          Math.floor(Date.parse(row.block_time ?? row.event_time ?? "") / 1000),
        height: blockHeight,
      });
      const items = protocolMessagesFromTx(hydratedTx)
        .flatMap((message) => protocolItemsFromTx(hydratedTx, message))
        .filter(
          (item) =>
            item?.kind === "token-transfer" &&
            String(item?.tokenId ?? "").toLowerCase() === WORK_TOKEN_ID &&
            item?.senderAddress &&
            item?.recipientAddress,
        )
        .map((item) => ({
          ...item,
          validationMode: "confirmed-event-participant-repair",
        }));
      if (items.length === 0) {
        throw new Error(
          "transaction does not contain a confirmed WORK transfer with resolvable participants",
        );
      }

      await client.query("BEGIN");
      try {
        for (const item of items) {
          const upsert = await upsertEvent(
            client,
            sourceLabelForProtocolItem(item),
            item,
          );
          if (upsert.skipped) {
            skipped += 1;
          } else {
            indexed += 1;
          }
        }
        await client.query("COMMIT");
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      }
    } catch (error) {
      skipped += 1;
      failures.push({ error: error?.message ?? String(error), txid });
      console.error(
        JSON.stringify({
          error: error?.message ?? String(error),
          phase: "repair-work-participants",
          txid,
        }),
      );
    }
  }
  if (failures.length > 0) {
    throw new Error(
      `WORK participant repair failed for ${failures.length} transaction(s): ${failures
        .map((failure) => failure.txid)
        .join(",")}`,
    );
  }
  return {
    indexed,
    requested: REPAIR_WORK_PARTICIPANTS_TXIDS.length,
    scanned: rowsByTxid.size,
    skipped,
    source: "repair-work-participants",
  };
}

async function repairMailParticipants(client) {
  const result = await client.query(
    `
      WITH participant_candidates AS (
        SELECT
          e.event_id,
          NULLIF(btrim(m.sender_address), '') AS address,
          'sender'::text AS role
        FROM proof_indexer.mail_items m
        JOIN proof_indexer.events e
          ON e.network = m.network
         AND e.txid = m.txid
        WHERE e.network = $1
          AND e.protocol = 'pwm1'
          AND e.valid IS DISTINCT FROM false

        UNION

        SELECT
          e.event_id,
          NULLIF(btrim(COALESCE(
            m.message->>'senderAddress',
            m.message->>'from'
          )), '') AS address,
          'sender'::text AS role
        FROM proof_indexer.mail_items m
        JOIN proof_indexer.events e
          ON e.network = m.network
         AND e.txid = m.txid
        WHERE e.network = $1
          AND e.protocol = 'pwm1'
          AND e.valid IS DISTINCT FROM false

        UNION

        SELECT
          e.event_id,
          NULLIF(btrim(COALESCE(
            m.message->>'recipientAddress',
            m.message->>'to'
          )), '') AS address,
          'recipient'::text AS role
        FROM proof_indexer.mail_items m
        JOIN proof_indexer.events e
          ON e.network = m.network
         AND e.txid = m.txid
        WHERE e.network = $1
          AND e.protocol = 'pwm1'
          AND e.valid IS DISTINCT FROM false

        UNION

        SELECT
          e.event_id,
          NULLIF(btrim(COALESCE(
            recipient.record->>'address',
            recipient.record->>'display'
          )), '') AS address,
          'recipient'::text AS role
        FROM proof_indexer.mail_items m
        JOIN proof_indexer.events e
          ON e.network = m.network
         AND e.txid = m.txid
        CROSS JOIN LATERAL jsonb_array_elements(
          CASE
            WHEN jsonb_typeof(m.message->'recipients') = 'array'
              THEN m.message->'recipients'
            ELSE '[]'::jsonb
          END
        ) recipient(record)
        WHERE e.network = $1
          AND e.protocol = 'pwm1'
          AND e.valid IS DISTINCT FROM false
      )
      INSERT INTO proof_indexer.event_participants (
        event_id,
        address,
        role,
        powid
      )
      SELECT
        event_id,
        address,
        role,
        ''
      FROM participant_candidates
      WHERE address IS NOT NULL
        AND address !~ '\\s'
      ON CONFLICT (event_id, address, role) DO NOTHING
      RETURNING event_id
    `,
    [NETWORK],
  );
  return {
    indexed: result.rows.length,
    skipped: 0,
    source: "repair-mail-participants",
  };
}

async function repairConfirmedListingSealMetadata(client) {
  const result = await client.query(
    `
      WITH confirmed_seals AS (
        SELECT DISTINCT ON (lower(e.payload->>'listingId'))
          lower(e.payload->>'listingId') AS listing_id,
          lower(COALESCE(NULLIF(e.payload->>'sealTxid', ''), e.txid)) AS seal_txid,
          e.payload
        FROM proof_indexer.events e
        WHERE e.network = $1
          AND e.protocol = 'pwt1'
          AND e.kind = 'token-listing-sealed'
          AND e.status = 'confirmed'
          AND e.valid = true
          AND e.payload->>'listingId' ~ '^[0-9a-fA-F]{64}$'
        ORDER BY
          lower(e.payload->>'listingId'),
          e.block_height DESC NULLS LAST,
          e.event_id DESC
      )
      UPDATE proof_indexer.credit_listings cl
      SET
        sale_ticket_txid = CASE
          WHEN cl.sale_ticket_txid IS NULL OR cl.sale_ticket_txid = seals.seal_txid
            THEN seals.listing_id
          ELSE cl.sale_ticket_txid
        END,
        sale_ticket_vout = COALESCE(
          cl.sale_ticket_vout,
          CASE
            WHEN seals.payload->>'saleTicketVout' ~ '^[0-9]+$'
              THEN (seals.payload->>'saleTicketVout')::integer
            ELSE NULL
          END,
          2
        ),
        sale_ticket_value_sats = COALESCE(
          cl.sale_ticket_value_sats,
          CASE
            WHEN seals.payload->>'saleTicketValueSats' ~ '^[0-9]+$'
              THEN (seals.payload->>'saleTicketValueSats')::bigint
            ELSE NULL
          END,
          546
        ),
        seal_txid = seals.seal_txid,
        payload = cl.payload || jsonb_strip_nulls(
          jsonb_build_object(
            'saleAuthorization', seals.payload->'saleAuthorization',
            'sealAt', NULLIF(seals.payload->>'sealAt', ''),
            'sealBlockHeight', CASE
              WHEN seals.payload->>'sealBlockHeight' ~ '^[0-9]+$'
                THEN (seals.payload->>'sealBlockHeight')::integer
              ELSE NULL
            END,
            'sealConfirmed', true,
            'sealDataBytes', CASE
              WHEN seals.payload->>'sealDataBytes' ~ '^[0-9]+$'
                THEN (seals.payload->>'sealDataBytes')::integer
              ELSE NULL
            END,
            'sealMinerFeeSats', CASE
              WHEN seals.payload->>'sealMinerFeeSats' ~ '^[0-9]+$'
                THEN (seals.payload->>'sealMinerFeeSats')::bigint
              ELSE NULL
            END,
            'sealTxid', seals.seal_txid
          )
        ),
        updated_at = now()
      FROM confirmed_seals seals
      WHERE cl.network = $1
        AND cl.listing_id = seals.listing_id
        AND (
          COALESCE(cl.seal_txid, '') <> seals.seal_txid
          OR COALESCE(cl.payload->>'sealTxid', '') <> seals.seal_txid
          OR cl.payload->>'sealConfirmed' IS DISTINCT FROM 'true'
        )
      RETURNING cl.listing_id
    `,
    [NETWORK],
  );
  return {
    indexed: result.rows.length,
    skipped: 0,
    source: "repair-listing-seal-metadata",
  };
}

async function repairWorkMintMinterAttribution(client) {
  if (!REPAIR_MINT_MINTERS) {
    return { indexed: 0, skipped: 0, source: "repair-mint-minters" };
  }
  if (!BITCOIN_RPC_URL) {
    throw new Error("BITCOIN_RPC_URL is required for mint minter repair.");
  }

  const limit = Number.isFinite(REPAIR_MINT_MINTERS_LIMIT)
    ? Math.max(1, Math.floor(REPAIR_MINT_MINTERS_LIMIT))
    : 500;
  const result = await client.query(
    `
      SELECT DISTINCT ON (lower(e.txid))
        e.txid,
        COALESCE(e.payload->>'tokenId', cd.token_id) AS token_id
      FROM proof_indexer.events e
      LEFT JOIN proof_indexer.transactions t
        ON t.network = e.network
       AND t.txid = e.txid
      LEFT JOIN proof_indexer.credit_definitions cd
        ON cd.network = e.network
       AND cd.token_id = lower(e.payload->>'tokenId')
      WHERE e.network = $1
        AND e.valid IS DISTINCT FROM false
        AND e.kind = 'token-mint'
        AND COALESCE(t.status, e.status) = 'confirmed'
        AND (
          lower(e.payload->>'tokenId') = $2
          OR lower(cd.token_id) = $2
          OR lower(cd.ticker) = 'work'
        )
        AND COALESCE(
          NULLIF(e.payload->>'minterAddress', ''),
          NULLIF(e.payload->>'senderAddress', ''),
          NULLIF(e.payload->>'actor', ''),
          ''
        ) = ''
      ORDER BY
        lower(e.txid),
        COALESCE(e.block_time, t.block_time, e.event_time, t.confirmed_at, e.created_at) DESC
      LIMIT $3
    `,
    [NETWORK, WORK_TOKEN_ID, limit],
  );

  let indexed = 0;
  let skipped = 0;
  for (const row of result.rows) {
    const txid = String(row.txid ?? "").trim().toLowerCase();
    const tx = await rawTransactionFromCore(txid);
    if (!tx) {
      skipped += 1;
      continue;
    }
    const hydratedTx = await transactionWithInputPrevouts({
      ...tx,
      blocktime: tx.blocktime ?? tx.time,
      height: tx.blockheight ?? tx.height,
    });
    const messages = protocolMessagesFromTx(hydratedTx);
    const items = messages
      .flatMap((message) => protocolItemsFromTx(hydratedTx, message))
      .filter(
        (item) =>
          item?.kind === "token-mint" &&
          String(item?.tokenId ?? "").toLowerCase() === WORK_TOKEN_ID &&
          item?.minterAddress,
      );
    if (items.length === 0) {
      skipped += 1;
      continue;
    }

    try {
      await client.query("BEGIN");
      for (const item of items) {
        const upsert = await upsertEvent(
          client,
          sourceLabelForProtocolItem(item),
          item,
        );
        if (upsert.skipped) {
          skipped += 1;
        } else {
          indexed += 1;
        }
      }
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      skipped += 1;
      console.error(
        JSON.stringify({
          error: error?.message ?? String(error),
          phase: "repair-mint-minters",
          txid,
        }),
      );
    }
  }

  return {
    indexed,
    scanned: result.rows.length,
    skipped,
    source: "repair-mint-minters",
  };
}

async function canonicalIncbIssuanceRepairTarget(txid) {
  const expectation = CANONICAL_INCB_ISSUANCE_REPAIR_EXPECTATIONS.get(txid);
  if (!expectation) {
    throw new Error(
      `Canonical INCB issuance repair has no pinned full-node oracle for ${txid}.`,
    );
  }
  const raw = await rawTransactionFromCore(txid);
  const blockHash = String(raw?.blockhash ?? "").trim().toLowerCase();
  if (
    !raw ||
    Number(raw?.confirmations) <= 0 ||
    !/^[0-9a-f]{64}$/u.test(blockHash)
  ) {
    throw new Error(
      `Canonical INCB issuance repair transaction ${txid} is not confirmed.`,
    );
  }
  const block = await bitcoinRpc("getblock", [blockHash, 2]);
  const height = Number(block?.height);
  assertCanonicalBlockEnvelope(block, height, blockHash);
  const canonicalBlockHash = String(
    await bitcoinRpc("getblockhash", [height]),
  )
    .trim()
    .toLowerCase();
  if (canonicalBlockHash !== blockHash) {
    throw new Error(
      `Canonical INCB issuance repair block ${height} no longer matches Bitcoin Core.`,
    );
  }
  if (
    height !== expectation.blockHeight ||
    blockHash !== expectation.blockHash
  ) {
    throw new Error(
      `Canonical INCB issuance repair ${txid} does not match its pinned block ${expectation.blockHeight}:${expectation.blockHash}.`,
    );
  }
  const blockIndex = (Array.isArray(block?.tx) ? block.tx : []).findIndex(
    (candidate) => String(candidate?.txid ?? "").trim().toLowerCase() === txid,
  );
  if (blockIndex < 0) {
    throw new Error(
      `Canonical INCB issuance repair transaction ${txid} is absent from block ${blockHash}.`,
    );
  }
  if (blockIndex !== expectation.blockIndex) {
    throw new Error(
      `Canonical INCB issuance repair ${txid} moved from pinned block index ${expectation.blockIndex} to ${blockIndex}.`,
    );
  }
  const hydrated = await transactionWithInputPrevouts({
    ...block.tx[blockIndex],
    _powBlockHash: blockHash,
    _powBlockIndex: blockIndex,
    _powPreviousBlockHash: String(block?.previousblockhash ?? "")
      .trim()
      .toLowerCase(),
    blocktime: block?.time,
    height,
  });
  assertHydratedProtocolTransaction(hydrated);
  const messages = protocolMessagesFromTx(hydrated);
  const mailItem = aggregatePwmProtocolItem(hydrated, messages);
  if (
    !mailItem ||
    mailItem.kind !== INCEPTION_BOND_KIND ||
    String(mailItem.txid ?? "").trim().toLowerCase() !== txid
  ) {
    throw new Error(
      `Canonical INCB issuance repair transaction ${txid} is not an Inception Bond.`,
    );
  }
  const prepared = await preparedProtocolItemsForTx(hydrated, messages);
  if (prepared.length === 0 || prepared.some((entry) => entry?.item?.valid === false)) {
    throw new Error(
      `Canonical INCB issuance verifier returned an invalid projection for ${txid}.`,
    );
  }
  const preparedItems = prepared.map((entry) => entry?.item ?? entry);
  const bondItems = preparedItems.filter(
    (item) =>
      String(item?.kind ?? "").trim().toLowerCase() ===
        INCEPTION_BOND_KIND &&
      String(item?.txid ?? "").trim().toLowerCase() === txid,
  );
  if (bondItems.length !== 1) {
    throw new Error(
      `Canonical INCB issuance verifier did not return exactly one bond event for ${txid}.`,
    );
  }
  const [bondItem] = bondItems;
  const bondRecipients = Array.isArray(mailItem?.recipients)
    ? mailItem.recipients
    : [];
  if (
    bondRecipients.length !== 1 ||
    String(bondRecipients[0]?.address ?? "").trim() !==
      expectation.recipientAddress ||
    Number(bondRecipients[0]?.amountSats) !== expectation.recipientAmountSats ||
    Number(bondRecipients[0]?.vout) !== expectation.recipientVout
  ) {
    throw new Error(
      `Canonical INCB issuance repair ${txid} does not match its pinned bond recipient payment.`,
    );
  }
  const workAttachmentItems = preparedItems.filter(
    (item) =>
      String(item?.kind ?? "").trim().toLowerCase() === "token-transfer" &&
      String(item?.tokenId ?? "").trim().toLowerCase() ===
        expectation.workAttachmentTokenId,
  );
  if (
    workAttachmentItems.length !== 1 ||
    Number(workAttachmentItems[0]?.amount) !== expectation.workAttachmentAmount ||
    Number(workAttachmentItems[0]?.protocolVout) !==
      expectation.workAttachmentProtocolVout ||
    String(workAttachmentItems[0]?.recipientAddress ?? "").trim() !==
      expectation.workAttachmentRecipientAddress
  ) {
    throw new Error(
      `Canonical INCB issuance repair ${txid} does not match its pinned WORK attachment transfer.`,
    );
  }
  const [workAttachmentItem] = workAttachmentItems;
  const attachedCredits = Array.isArray(bondItem?.attachedCredits)
    ? bondItem.attachedCredits
    : [];
  if (
    attachedCredits.length !== 1 ||
    Number(attachedCredits[0]?.amount) !== expectation.workAttachmentAmount ||
    Number(attachedCredits[0]?.protocolVout) !==
      expectation.workAttachmentProtocolVout ||
    String(attachedCredits[0]?.recipientAddress ?? "").trim() !==
      expectation.workAttachmentRecipientAddress ||
    String(attachedCredits[0]?.tokenId ?? "").trim().toLowerCase() !==
      expectation.workAttachmentTokenId
  ) {
    throw new Error(
      `Canonical INCB issuance verifier did not bind the exact WORK attachment to the bond event for ${txid}.`,
    );
  }
  const mintItems = preparedItems
    .filter(
      (item) =>
        String(item?.kind ?? "").trim().toLowerCase() === "token-mint" &&
        String(item?.tokenId ?? "").trim().toLowerCase() === INCB_TOKEN_ID,
    );
  if (
    mintItems.length !== 1 ||
    mintItems.some(
      (item) =>
        !canonicalBondMintProjection(item) ||
        incbIssuanceMetadataInvalidReason(item),
    )
  ) {
    throw new Error(
      `Canonical INCB issuance verifier did not return complete ${INCB_ISSUANCE_ACCOUNTING_MODEL} mint metadata for ${txid}.`,
    );
  }
  const [mintItem] = mintItems;
  if (
    String(mintItem?.minterAddress ?? "").trim() !==
      expectation.recipientAddress ||
    String(mintItem?.bondRecipientAddress ?? "").trim() !==
      expectation.recipientAddress ||
    String(mintItem?.minterAddress ?? "").trim() !==
      String(workAttachmentItem?.recipientAddress ?? "").trim() ||
    Number(mintItem?.bondRecipientAmountSats) !==
      expectation.recipientAmountSats ||
    Number(mintItem?.bondRecipientVout) !== expectation.recipientVout
  ) {
    throw new Error(
      `Canonical INCB issuance verifier did not bind the mint recipient to the bond payment and WORK attachment for ${txid}.`,
    );
  }
  const closeTo = (actual, expected, tolerance = 1e-6) =>
    Number.isFinite(Number(actual)) &&
    Math.abs(Number(actual) - expected) <= tolerance;
  if (
    String(mintItem.issuanceCheckpointMode ?? "") !==
      "bond-transaction-provenance" ||
    Number(mintItem.issuanceCheckpointBlockHeight) !== expectation.blockHeight ||
    String(mintItem.issuanceCheckpointBlockHash ?? "")
      .trim()
      .toLowerCase() !== expectation.blockHash ||
    Number(mintItem.issuanceCheckpointBlockIndex) !== expectation.blockIndex ||
    String(mintItem.issuanceValueSnapshotId ?? "").trim() !==
      expectation.issuanceValueSnapshotId ||
    Number(mintItem.issuanceValueSnapshotBlockHeight) !==
      expectation.issuanceValueSnapshotBlockHeight ||
    String(mintItem.issuanceValueSnapshotBlockHash ?? "")
      .trim()
      .toLowerCase() !== expectation.issuanceValueSnapshotBlockHash ||
    String(mintItem.issuanceValueSnapshotCanonicalSummaryHash ?? "")
      .trim()
      .toLowerCase() !==
      expectation.issuanceValueSnapshotCanonicalSummaryHash ||
    String(mintItem.issuanceValueSnapshotMode ?? "") !==
      expectation.issuanceValueSnapshotMode ||
    String(mintItem.issuanceValueSnapshotModel ?? "") !==
      expectation.issuanceValueSnapshotModel ||
    new Date(mintItem.issuanceValueSnapshotGeneratedAt).toISOString() !==
      expectation.issuanceValueSnapshotGeneratedAt ||
    !closeTo(
      mintItem.issuanceValueSnapshotWorkNetworkValueSats,
      expectation.issuanceValueSnapshotWorkNetworkValueSats,
    ) ||
    Number(mintItem.attachedWorkAmount) !== expectation.attachedWorkAmount ||
    Number(mintItem.attachedWorkIssuanceUnits) !==
      expectation.attachedWorkIssuanceUnits ||
    !closeTo(
      mintItem.attachedWorkLiveFloorAtSendSats,
      expectation.attachedWorkLiveFloorAtSendSats,
      1e-9,
    ) ||
    !closeTo(
      mintItem.attachedWorkLiveValueAtSendSats,
      expectation.attachedWorkLiveValueAtSendSats,
    ) ||
    Number(mintItem.directProofIssuanceUnits) !==
      expectation.directProofIssuanceUnits ||
    Number(mintItem.confirmedIssuanceUnits) !==
      expectation.confirmedIssuanceUnits ||
    Number(mintItem.amount) !== expectation.confirmedIssuanceUnits ||
    !closeTo(
      mintItem.issuanceNetworkValueSats,
      expectation.issuanceNetworkValueSats,
    ) ||
    !closeTo(
      mintItem.issuanceFloorSats,
      expectation.issuanceFloorSats,
      1e-12,
    ) ||
    !closeTo(mintItem.issuanceDustSats, expectation.issuanceDustSats)
  ) {
    throw new Error(
      `Canonical INCB issuance verifier disagrees with the pinned pre-bond oracle for ${txid}.`,
    );
  }
  const issuanceUnits = mintItems.reduce(
    (total, item) => total + BigInt(String(item.amount)),
    0n,
  );
  if (issuanceUnits <= 0n) {
    throw new Error(
      `Canonical INCB issuance repair transaction ${txid} has zero issuance.`,
    );
  }
  return {
    blockHash,
    blockIndex,
    height,
    hydrated,
    issuanceUnits,
    bondItem,
    mintItems,
    oracle: expectation,
    txid,
  };
}

function canonicalIncbValueSnapshotBinding(item) {
  const invalidReason = incbIssuanceMetadataInvalidReason(item);
  if (invalidReason) {
    throw new Error(
      `Canonical INCB value snapshot binding is invalid: ${invalidReason}.`,
    );
  }
  const exactWorkNetworkValueQ8 = canonicalNonNegativeQ8Text(
    item.issuanceValueSnapshotWorkNetworkValueQ8,
    { positive: true },
  );
  const legacyStoredDecimalQ8 =
    !exactWorkNetworkValueQ8 &&
    typeof item.issuanceValueSnapshotWorkNetworkValueSats === "string"
      ? q8TextFromDecimal(
          item.issuanceValueSnapshotWorkNetworkValueSats.trim(),
        )
      : "";
  const workNetworkValueQ8 =
    exactWorkNetworkValueQ8 || legacyStoredDecimalQ8;
  if (!workNetworkValueQ8) {
    throw new Error(
      "Canonical INCB value snapshot binding has no stored exact WORK Q8 witness.",
    );
  }
  return {
    blockHash: String(item.issuanceValueSnapshotBlockHash).toLowerCase(),
    blockHeight: Number(item.issuanceValueSnapshotBlockHeight),
    canonicalSummaryHash: String(
      item.issuanceValueSnapshotCanonicalSummaryHash,
    ).toLowerCase(),
    generatedAt: new Date(item.issuanceValueSnapshotGeneratedAt).toISOString(),
    mode: String(item.issuanceValueSnapshotMode),
    model: String(item.issuanceValueSnapshotModel),
    snapshotId: String(item.issuanceValueSnapshotId).trim(),
    workNetworkValueWitnessMode: exactWorkNetworkValueQ8
      ? WORK_NETWORK_VALUE_ACCOUNTING_MODEL
      : "locked-bound-legacy-work-value-v1",
    workNetworkValueQ8,
  };
}

function canonicalIncbValueSnapshotBindings(targets) {
  const bindings = new Map();
  for (const target of targets) {
    for (const item of target.mintItems) {
      const binding = canonicalIncbValueSnapshotBinding(item);
      const previous = bindings.get(binding.snapshotId);
      if (
        previous &&
        JSON.stringify(previous) !== JSON.stringify(binding)
      ) {
        throw new Error(
          `Canonical INCB issuance targets disagree about value snapshot ${binding.snapshotId}.`,
        );
      }
      bindings.set(binding.snapshotId, binding);
    }
  }
  return bindings;
}

async function lockedCanonicalIncbValueSnapshots(client, snapshotIds) {
  if (!Array.isArray(snapshotIds) || snapshotIds.length === 0) {
    return [];
  }
  const result = await client.query(
    `
      SELECT
        snapshot_id,
        indexed_through_block,
        generated_at,
        source_hashes->>'blockScan' AS source_block_hash,
        source_hashes->>'canonicalSummary' AS canonical_summary_hash,
        consistency->>'ok' AS consistency_ok,
        COALESCE(consistency->>'status', payload->>'status', '') AS consistency_status,
        payload->>'snapshotId' AS payload_snapshot_id,
        payload->>'indexedThroughBlockHash' AS payload_block_hash,
        payload->'summaryRefresh'->>'mode' AS summary_refresh_mode,
        payload->'summaryRefresh'->>'indexedThroughBlockHash' AS summary_refresh_block_hash,
        payload->'summaryPayloads'->'workFloor'->>'snapshotId' AS work_floor_snapshot_id,
        payload->'summaryPayloads'->'workFloor'->>'indexedThroughBlock' AS work_floor_height,
        payload->'summaryPayloads'->'workFloor'->>'indexedThroughBlockHash' AS work_floor_block_hash,
        payload->'totals'->>'workNetworkValueAccountingModel' AS totals_work_network_value_model,
        payload->'totals'->>'workNetworkValueQ8' AS totals_work_network_value_q8,
        payload->'summaryPayloads'->'workFloor'->>'workNetworkValueAccountingModel' AS work_floor_network_value_model,
        payload->'summaryPayloads'->'workFloor'->>'networkValueQ8' AS work_floor_network_value_q8,
        payload->'summaryPayloads'->'workFloor'->>'liveNetworkValueQ8' AS work_floor_live_network_value_q8,
        payload->'summaryPayloads'->'workFloor'->'actualValue'->>'workNetworkValueAccountingModel' AS work_actual_network_value_model,
        payload->'summaryPayloads'->'workFloor'->'actualValue'->>'networkValueQ8' AS work_actual_network_value_q8,
        payload->'summaryPayloads'->'workFloor'->'actualValue'->>'liveNetworkValueQ8' AS work_actual_live_network_value_q8,
        payload->'summaryPayloads'->'workFloor'->'actualValue'->>'totalQ8' AS work_actual_total_q8,
        payload->'summaryPayloads'->'workFloor'->'actualValue'->>'liveTotalQ8' AS work_actual_live_total_q8,
        COALESCE(
          NULLIF(payload #>> '{summaryPayloads,workFloor,liveNetworkValueSats}', ''),
          NULLIF(payload #>> '{summaryPayloads,workFloor,actualValue,liveNetworkValueSats}', ''),
          NULLIF(payload #>> '{summaryPayloads,workFloor,actualValue,liveTotalSats}', ''),
          NULLIF(payload #>> '{summaryPayloads,workFloor,actualValue,totalSats}', '')
        ) AS work_network_value_sats_text,
        CASE
          WHEN payload #> '{summaryPayloads,workFloor,liveNetworkValueSats}' IS NOT NULL
            THEN jsonb_typeof(payload #> '{summaryPayloads,workFloor,liveNetworkValueSats}')
          WHEN payload #> '{summaryPayloads,workFloor,actualValue,liveNetworkValueSats}' IS NOT NULL
            THEN jsonb_typeof(payload #> '{summaryPayloads,workFloor,actualValue,liveNetworkValueSats}')
          WHEN payload #> '{summaryPayloads,workFloor,actualValue,liveTotalSats}' IS NOT NULL
            THEN jsonb_typeof(payload #> '{summaryPayloads,workFloor,actualValue,liveTotalSats}')
          WHEN payload #> '{summaryPayloads,workFloor,actualValue,totalSats}' IS NOT NULL
            THEN jsonb_typeof(payload #> '{summaryPayloads,workFloor,actualValue,totalSats}')
          ELSE NULL
        END AS work_network_value_sats_type,
        payload::text AS raw_payload_json,
        source_hashes::text AS raw_source_hashes_json,
        consistency::text AS raw_consistency_json,
        metrics::text AS raw_metrics_json
      FROM proof_indexer.ledger_snapshots
      WHERE network = $1
        AND snapshot_id = ANY($2::text[])
      ORDER BY snapshot_id ASC
      FOR UPDATE
    `,
    [NETWORK, snapshotIds],
  );
  return result.rows;
}

function lockedCanonicalIncbSnapshotWorkNetworkValueQ8(row) {
  const floorModel = String(row?.work_floor_network_value_model ?? "");
  const actualModel = String(row?.work_actual_network_value_model ?? "");
  const totalsModel = String(row?.totals_work_network_value_model ?? "");
  const currentModel =
    floorModel === WORK_NETWORK_VALUE_ACCOUNTING_MODEL &&
    actualModel === WORK_NETWORK_VALUE_ACCOUNTING_MODEL &&
    (!totalsModel || totalsModel === WORK_NETWORK_VALUE_ACCOUNTING_MODEL);
  if (
    !currentModel &&
    [floorModel, actualModel, totalsModel].some(Boolean)
  ) {
    return null;
  }

  const rawAliases = [
    row?.totals_work_network_value_q8,
    row?.work_floor_network_value_q8,
    row?.work_floor_live_network_value_q8,
    row?.work_actual_network_value_q8,
    row?.work_actual_live_network_value_q8,
    row?.work_actual_total_q8,
    row?.work_actual_live_total_q8,
  ];
  const presentAliases = rawAliases
    .filter((value) => value !== undefined && value !== null && value !== "")
    .map((value) => canonicalNonNegativeQ8Text(value, { positive: true }));
  if (
    presentAliases.some((value) => !value) ||
    (currentModel && presentAliases.length !== rawAliases.length)
  ) {
    return null;
  }
  const exactQ8 = presentAliases[0] ?? "";
  if (exactQ8 && presentAliases.some((value) => value !== exactQ8)) {
    return null;
  }
  if (currentModel) {
    return exactQ8
      ? { mode: WORK_NETWORK_VALUE_ACCOUNTING_MODEL, valueQ8: exactQ8 }
      : null;
  }

  // Locked pre-marker rows are immutable issuance witnesses. Their exception
  // is snapshot-id bound and read under a table lock. Interpret the stored
  // JSON decimal text directly, never a JavaScript Number, and require it to
  // agree with any transitional stored Q8 alias plus the mint's exact Q8.
  const legacyDecimalQ8 =
    row?.work_network_value_sats_type === "string" &&
    typeof row?.work_network_value_sats_text === "string"
      ? q8TextFromDecimal(row.work_network_value_sats_text.trim())
      : "";
  const valueQ8 = exactQ8 || legacyDecimalQ8;
  if (
    !valueQ8 ||
    (exactQ8 && legacyDecimalQ8 && exactQ8 !== legacyDecimalQ8)
  ) {
    return null;
  }
  return { mode: "locked-bound-legacy-work-value-v1", valueQ8 };
}

function canonicalIncbValueSnapshotFingerprint(row) {
  const workNetworkValue =
    lockedCanonicalIncbSnapshotWorkNetworkValueQ8(row);
  return JSON.stringify({
    canonicalSummaryHash: String(row?.canonical_summary_hash ?? "").toLowerCase(),
    consistencyOk: String(row?.consistency_ok ?? ""),
    consistencyStatus: String(row?.consistency_status ?? ""),
    generatedAt: new Date(row?.generated_at).toISOString(),
    indexedThroughBlock: Number(row?.indexed_through_block),
    payloadBlockHash: String(row?.payload_block_hash ?? "").toLowerCase(),
    payloadSnapshotId: String(row?.payload_snapshot_id ?? ""),
    snapshotId: String(row?.snapshot_id ?? ""),
    sourceBlockHash: String(row?.source_block_hash ?? "").toLowerCase(),
    summaryRefreshBlockHash: String(
      row?.summary_refresh_block_hash ?? "",
    ).toLowerCase(),
    summaryRefreshMode: String(row?.summary_refresh_mode ?? ""),
    workFloorBlockHash: String(row?.work_floor_block_hash ?? "").toLowerCase(),
    workFloorHeight: Number(row?.work_floor_height),
    workFloorSnapshotId: String(row?.work_floor_snapshot_id ?? ""),
    workNetworkValueMode: workNetworkValue?.mode ?? "invalid",
    workNetworkValueQ8: workNetworkValue?.valueQ8 ?? "",
  });
}

function verifiedCanonicalIncbValueSnapshotFingerprints(rows, bindings) {
  if (rows.length !== bindings.size) {
    throw new Error(
      `INCB issuance repair expected ${bindings.size} locked value snapshots but found ${rows.length}.`,
    );
  }
  const fingerprints = new Map();
  for (const row of rows) {
    const snapshotId = String(row?.snapshot_id ?? "");
    const binding = bindings.get(snapshotId);
    const generatedAt = new Date(row?.generated_at).toISOString();
    const workNetworkValue =
      lockedCanonicalIncbSnapshotWorkNetworkValueQ8(row);
    const blockHashes = [
      row?.source_block_hash,
      row?.payload_block_hash,
      row?.summary_refresh_block_hash,
      row?.work_floor_block_hash,
    ].map((value) => String(value ?? "").trim().toLowerCase());
    if (
      !binding ||
      String(row?.consistency_ok ?? "") !== "true" ||
      row?.consistency_status !== "green" ||
      row?.summary_refresh_mode !== "canonical-summary-refresh" ||
      String(row?.payload_snapshot_id ?? "") !== snapshotId ||
      String(row?.work_floor_snapshot_id ?? "") !== snapshotId ||
      Number(row?.indexed_through_block) !== binding.blockHeight ||
      Number(row?.work_floor_height) !== binding.blockHeight ||
      blockHashes.some((hash) => hash !== binding.blockHash) ||
      String(row?.canonical_summary_hash ?? "").trim().toLowerCase() !==
        binding.canonicalSummaryHash ||
      generatedAt !== binding.generatedAt ||
      binding.mode !== "canonical-summary-refresh" ||
      binding.model !== INCB_VALUE_SNAPSHOT_MODEL ||
      !workNetworkValue ||
      workNetworkValue.valueQ8 !== binding.workNetworkValueQ8
    ) {
      throw new Error(
        `INCB issuance repair value snapshot ${snapshotId || "unknown"} does not match its mint provenance.`,
      );
    }
    fingerprints.set(
      snapshotId,
      canonicalIncbValueSnapshotFingerprint(row),
    );
  }
  return fingerprints;
}

async function repairCanonicalIncbIssuance(client) {
  const targets = [];
  for (const txid of REPAIR_INCB_ISSUANCE_TXIDS) {
    targets.push(await canonicalIncbIssuanceRepairTarget(txid));
  }
  targets.sort(
    (left, right) =>
      left.height - right.height ||
      left.blockIndex - right.blockIndex ||
      left.txid.localeCompare(right.txid),
  );
  const targetTxids = targets.map((target) => target.txid);
  const targetByTxid = new Map(
    targets.map((target) => [target.txid, target]),
  );
  const expectedIssuance = targets.reduce(
    (total, target) => total + target.issuanceUnits,
    0n,
  );
  const valueSnapshotBindings = canonicalIncbValueSnapshotBindings(targets);
  const valueSnapshotIds = [...valueSnapshotBindings.keys()].sort();

  await client.query("BEGIN");
  try {
    // Coordinate with every snapshot INSERT/UPDATE/DELETE writer. PostgreSQL
    // RowExclusive locks taken by those writers conflict with this mode, so a
    // writer already in flight completes before the repair reads snapshots and
    // no new snapshot can race the selective invalidation before COMMIT.
    await client.query(
      "LOCK TABLE proof_indexer.ledger_snapshots IN SHARE ROW EXCLUSIVE MODE",
    );
    const lockedValueSnapshotsBefore =
      await lockedCanonicalIncbValueSnapshots(client, valueSnapshotIds);
    const valueSnapshotFingerprintsBefore =
      verifiedCanonicalIncbValueSnapshotFingerprints(
        lockedValueSnapshotsBefore,
        valueSnapshotBindings,
      );
    const transactionRows = await client.query(
      `
        SELECT txid, status, block_hash, block_height
        FROM proof_indexer.transactions
        WHERE network = $1
          AND txid = ANY($2::text[])
        FOR UPDATE
      `,
      [NETWORK, targetTxids],
    );
    const transactionByTxid = new Map(
      transactionRows.rows.map((row) => [String(row.txid), row]),
    );
    for (const target of targets) {
      const row = transactionByTxid.get(target.txid);
      if (
        row?.status !== "confirmed" ||
        Number(row?.block_height) !== target.height ||
        String(row?.block_hash ?? "").trim().toLowerCase() !== target.blockHash
      ) {
        throw new Error(
          `Stored INCB transaction ${target.txid} does not match the confirmed Bitcoin Core block.`,
        );
      }
    }

    const existingBonds = await client.query(
      `
        SELECT event_id, txid, payload, status, valid
        FROM proof_indexer.events
        WHERE network = $1
          AND txid = ANY($2::text[])
          AND protocol = 'pwm1'
          AND kind = 'inception-bond'
        FOR UPDATE
      `,
      [NETWORK, targetTxids],
    );
    if (existingBonds.rows.length !== targets.length) {
      throw new Error(
        `INCB issuance repair expected ${targets.length} stored bond rows but found ${existingBonds.rows.length}.`,
      );
    }
    const existingBondByTxid = new Map();
    for (const row of existingBonds.rows) {
      const txid = String(row?.txid ?? "").trim().toLowerCase();
      if (
        !txid ||
        existingBondByTxid.has(txid) ||
        row?.status !== "confirmed" ||
        row?.valid !== true
      ) {
        throw new Error(
          `INCB issuance repair requires one valid confirmed bond row per target; rejected ${txid || "unknown"}.`,
        );
      }
      existingBondByTxid.set(txid, row);
    }

    const existingEvents = await client.query(
      `
        SELECT event_id, txid, payload
        FROM proof_indexer.events
        WHERE network = $1
          AND txid = ANY($2::text[])
          AND protocol = 'pwt1'
          AND kind = 'token-mint'
          AND lower(COALESCE(payload->>'tokenId', '')) = $3
        FOR UPDATE
      `,
      [NETWORK, targetTxids, INCB_TOKEN_ID],
    );
    const expectedRows = targets.reduce(
      (total, target) => total + target.mintItems.length,
      0,
    );
    if (existingEvents.rows.length !== expectedRows) {
      throw new Error(
        `INCB issuance repair expected ${expectedRows} stored mint rows but found ${existingEvents.rows.length}.`,
      );
    }
    const existingEventByTxid = new Map();
    for (const row of existingEvents.rows) {
      const txid = String(row?.txid ?? "").trim().toLowerCase();
      if (!txid || existingEventByTxid.has(txid)) {
        throw new Error(
          `INCB issuance repair requires exactly one stored mint row per target transaction; duplicate ${txid || "unknown"}.`,
        );
      }
      existingEventByTxid.set(txid, row);
    }
    const beforeTargetIssuance = existingEvents.rows.reduce((total, row) => {
      const amountText = canonicalIntegerText(row?.payload?.amount, {
        positive: true,
      });
      if (!amountText) {
        throw new Error(
          `Stored INCB mint ${row?.txid ?? "unknown"} has no exact positive amount.`,
        );
      }
      return total + BigInt(amountText);
    }, 0n);
    const beforeCanonicalMintRows = existingEvents.rows.filter(
      (row) => canonicalIncbIssuanceMintProjection(row?.payload),
    ).length;
    const beforeBalances = await client.query(
      `
        SELECT address, confirmed_balance
        FROM proof_indexer.credit_balances
        WHERE network = $1
          AND token_id = $2
        FOR UPDATE
      `,
      [NETWORK, INCB_TOKEN_ID],
    );
    const beforeBalanceSupply = beforeBalances.rows.reduce((total, row) => {
      const balanceText = canonicalIntegerText(row?.confirmed_balance);
      if (!balanceText) {
        throw new Error(
          `Stored INCB balance for ${row?.address ?? "unknown"} is not an exact non-negative integer.`,
        );
      }
      return total + BigInt(balanceText);
    }, 0n);

    await seedCanonicalIncbDefinition(client, { required: true });
    for (const target of targets) {
      const existingBond = existingBondByTxid.get(target.txid);
      const attachedCredits = Array.isArray(target?.bondItem?.attachedCredits)
        ? target.bondItem.attachedCredits
        : [];
      if (!existingBond || attachedCredits.length === 0) {
        throw new Error(
          `INCB issuance repair has no canonical attachment-bound bond row for ${target.txid}.`,
        );
      }
      const updated = await client.query(
        `
          UPDATE proof_indexer.events
          SET payload = jsonb_set(
            COALESCE(payload, '{}'::jsonb),
            '{attachedCredits}',
            $4::jsonb,
            true
          )
          WHERE network = $1
            AND event_id = $2
            AND txid = $3
            AND protocol = 'pwm1'
            AND kind = 'inception-bond'
            AND status = 'confirmed'
            AND valid = true
          RETURNING event_id
        `,
        [
          NETWORK,
          existingBond.event_id,
          target.txid,
          JSON.stringify(attachedCredits),
        ],
      );
      if (updated.rowCount !== 1) {
        throw new Error(
          `INCB issuance repair could not update the locked bond row for ${target.txid}.`,
        );
      }
    }
    for (const target of targets) {
      for (const item of target.mintItems) {
        const integrityItem = await protocolIntegrityItemForPersistence(
          client,
          item,
        );
        if (
          integrityItem?.valid === false ||
          !canonicalBondMintProjection(integrityItem)
        ) {
          throw new Error(
            `INCB issuance repair rejected canonical mint ${target.txid}.`,
          );
        }
        const existingEvent = existingEventByTxid.get(target.txid);
        if (!existingEvent) {
          throw new Error(
            `INCB issuance repair has no locked mint row for ${target.txid}.`,
          );
        }
        const normalizedMint = normalizedEventItem(
          integrityItem,
          "token-mint",
          "confirmed",
        );
        const updated = await client.query(
          `
            UPDATE proof_indexer.events
            SET
              status = 'confirmed',
              valid = true,
              validation_errors = ARRAY[]::text[],
              amount_sats = 0,
              data_bytes = COALESCE($4, data_bytes),
              payload = (
                payload
                  - 'attachedWorkFloorAtConfirmationSats'
                  - 'attachedWorkLiveValueAtConfirmationSats'
                  - 'issuanceFixedAtConfirmation'
                  - 'issuanceCheckpointWorkNetworkValueSats'
              ) || $5::jsonb
            WHERE network = $1
              AND event_id = $2
              AND txid = $3
              AND protocol = 'pwt1'
              AND kind = 'token-mint'
              AND lower(COALESCE(payload->>'tokenId', '')) = $6
            RETURNING event_id
          `,
          [
            NETWORK,
            existingEvent.event_id,
            target.txid,
            numberOrNull(normalizedMint?.dataBytes),
            JSON.stringify(normalizedMint),
            INCB_TOKEN_ID,
          ],
        );
        if (updated.rowCount !== 1) {
          throw new Error(
            `INCB issuance repair could not update the locked mint row for ${target.txid}.`,
          );
        }
      }
    }

    const repairedBonds = await client.query(
      `
        SELECT txid, payload, status, valid
        FROM proof_indexer.events
        WHERE network = $1
          AND txid = ANY($2::text[])
          AND protocol = 'pwm1'
          AND kind = 'inception-bond'
        FOR UPDATE
      `,
      [NETWORK, targetTxids],
    );
    if (
      repairedBonds.rows.length !== targets.length ||
      repairedBonds.rows.some((row) => {
        const target = targetByTxid.get(
          String(row?.txid ?? "").trim().toLowerCase(),
        );
        const attachedCredits = Array.isArray(row?.payload?.attachedCredits)
          ? row.payload.attachedCredits
          : [];
        return (
          !target ||
          row?.status !== "confirmed" ||
          row?.valid !== true ||
          attachedCredits.length !== 1 ||
          Number(attachedCredits[0]?.amount) !==
            target.oracle.workAttachmentAmount ||
          Number(attachedCredits[0]?.protocolVout) !==
            target.oracle.workAttachmentProtocolVout ||
          String(attachedCredits[0]?.recipientAddress ?? "").trim() !==
            target.oracle.workAttachmentRecipientAddress ||
          String(attachedCredits[0]?.tokenId ?? "")
            .trim()
            .toLowerCase() !== target.oracle.workAttachmentTokenId
        );
      })
    ) {
      throw new Error(
        "INCB issuance repair did not persist the exact WORK attachment on the canonical bond row.",
      );
    }

    const repairedEvents = await client.query(
      `
        SELECT txid, payload, status, valid
        FROM proof_indexer.events
        WHERE network = $1
          AND txid = ANY($2::text[])
          AND protocol = 'pwt1'
          AND kind = 'token-mint'
          AND lower(COALESCE(payload->>'tokenId', '')) = $3
        FOR UPDATE
      `,
      [NETWORK, targetTxids, INCB_TOKEN_ID],
    );
    if (
      repairedEvents.rows.length !== expectedRows ||
      repairedEvents.rows.some(
        (row) => {
          const target = targetByTxid.get(
            String(row?.txid ?? "").trim().toLowerCase(),
          );
          const expectedBinding = valueSnapshotBindings.get(
            String(row?.payload?.issuanceValueSnapshotId ?? "").trim(),
          );
          const persistedBinding = target
            ? canonicalIncbValueSnapshotBinding(row.payload)
            : null;
          return (
            !target ||
            !expectedBinding ||
            JSON.stringify(persistedBinding) !==
              JSON.stringify(expectedBinding) ||
            row?.status !== "confirmed" ||
            row?.valid !== true ||
            !canonicalIncbIssuanceMintProjection(row?.payload) ||
            String(row?.payload?.minterAddress ?? "").trim() !==
              target.oracle.recipientAddress ||
            String(row?.payload?.bondRecipientAddress ?? "").trim() !==
              target.oracle.recipientAddress ||
            Number(row?.payload?.bondRecipientAmountSats) !==
              target.oracle.recipientAmountSats ||
            Number(row?.payload?.bondRecipientVout) !==
              target.oracle.recipientVout
          );
        },
      )
    ) {
      throw new Error(
        "INCB issuance repair did not persist the exact confirmed canonical mint row set.",
      );
    }
    const repairedTargetIssuance = repairedEvents.rows.reduce(
      (total, row) => total + BigInt(String(row.payload.amount)),
      0n,
    );
    if (repairedTargetIssuance !== expectedIssuance) {
      throw new Error(
        `INCB issuance repair target mismatch: expected=${expectedIssuance}, stored=${repairedTargetIssuance}.`,
      );
    }

    const replay = await rebuildConfirmedCreditBalancesFromCanonicalEvents(
      client,
      {
        supplyCorrectionMode: "canonical-incb-issuance-repair",
        supplyCorrectionTokenIds: [INCB_TOKEN_ID],
        tokenIds: [INCB_TOKEN_ID],
      },
    );
    const verification = await client.query(
      `
        SELECT
          COALESCE((
            SELECT sum((e.payload->>'amount')::numeric)
            FROM proof_indexer.events e
            LEFT JOIN proof_indexer.transactions t
              ON t.network = e.network
             AND t.txid = e.txid
            WHERE e.network = $1
              AND e.protocol = 'pwt1'
              AND e.kind = 'token-mint'
              AND e.valid = true
              AND COALESCE(t.status, e.status) = 'confirmed'
              AND lower(COALESCE(e.payload->>'tokenId', '')) = $2
              AND e.payload->>'issuanceAccountingModel' = $3
              AND e.payload->>'amount' ~ '^[1-9][0-9]*$'
          ), 0)::text AS minted_supply,
          COALESCE((
            SELECT sum(cb.confirmed_balance)
            FROM proof_indexer.credit_balances cb
            WHERE cb.network = $1
              AND cb.token_id = $2
          ), 0)::text AS balance_supply
      `,
      [NETWORK, INCB_TOKEN_ID, INCB_ISSUANCE_ACCOUNTING_MODEL],
    );
    const mintedSupply = BigInt(verification.rows[0]?.minted_supply ?? "0");
    const balanceSupply = BigInt(verification.rows[0]?.balance_supply ?? "0");
    if (
      mintedSupply < expectedIssuance ||
      balanceSupply !== mintedSupply
    ) {
      throw new Error(
        `INCB issuance repair conservation failed: target=${expectedIssuance}, mints=${mintedSupply}, balances=${balanceSupply}.`,
      );
    }

    // Re-read the canonical block hash and target transaction from Bitcoin Core
    // after every database write and conservation check. A reorg between the
    // initial oracle read and this point aborts and rolls back the transaction.
    for (const target of targets) {
      const finalBlockHash = String(
        await bitcoinRpc("getblockhash", [target.height]),
      )
        .trim()
        .toLowerCase();
      const finalRaw = await bitcoinRpc("getrawtransaction", [
        target.txid,
        true,
      ]);
      if (
        finalBlockHash !== target.blockHash ||
        Number(finalRaw?.confirmations) <= 0 ||
        String(finalRaw?.blockhash ?? "").trim().toLowerCase() !==
          target.blockHash
      ) {
        throw new Error(
          `Canonical INCB issuance repair ${target.txid} changed chain position before commit.`,
        );
      }
    }

    const canonicalBlockScanSnapshotPredicate = `
      NOT COALESCE(source_hashes ? 'canonicalSummary', false)
      AND (
        COALESCE(source_hashes ? 'blockScan', false)
        OR COALESCE(
          payload->>'source' = 'proof-indexer-block-scan',
          false
        )
      )
    `;
    const preservedBefore = await client.query(
      `
        SELECT snapshot_id, indexed_through_block
        FROM proof_indexer.ledger_snapshots
        WHERE network = $1
          AND (${canonicalBlockScanSnapshotPredicate})
        ORDER BY indexed_through_block DESC, generated_at DESC, snapshot_id DESC
      `,
      [NETWORK],
    );
    // Invalidate only derived read-model/value snapshots. Pure block-scan
    // checkpoints are canonical resume anchors and must survive the repair.
    const invalidated = await client.query(
      `
        WITH manifest_locked AS MATERIALIZED (
          SELECT DISTINCT entry->'snapshot'->>'snapshotId' AS snapshot_id
          FROM proof_indexer.meta rebuild
          JOIN proof_indexer.meta witness
            ON witness.key =
              rebuild.value->'verifierBinding'->>'witnessSetMetaKey'
          CROSS JOIN LATERAL jsonb_array_elements(
            COALESCE(witness.value->'entries', '[]'::jsonb)
          ) entry
          WHERE rebuild.key = $3
            AND rebuild.value->>'network' = $1
            AND witness.value->>'network' = $1
            AND witness.value->>'model' = $4
            AND entry->>'disposition' = 'preserve'
        )
        DELETE FROM proof_indexer.ledger_snapshots snapshot
        WHERE snapshot.network = $1
          AND NOT (${canonicalBlockScanSnapshotPredicate})
          AND NOT (snapshot.snapshot_id = ANY($2::text[]))
          AND NOT EXISTS (
            SELECT 1
            FROM manifest_locked locked
            WHERE locked.snapshot_id = snapshot.snapshot_id
          )
      `,
      [
        NETWORK,
        valueSnapshotIds,
        CANONICAL_REBUILD_META_KEY,
        INCB_RANGE_REPLAY_WITNESS_MANIFEST_MODEL,
      ],
    );
    const preservedAfter = await client.query(
      `
        SELECT snapshot_id, indexed_through_block
        FROM proof_indexer.ledger_snapshots
        WHERE network = $1
          AND (${canonicalBlockScanSnapshotPredicate})
        ORDER BY indexed_through_block DESC, generated_at DESC, snapshot_id DESC
      `,
      [NETWORK],
    );
    const preservedBeforeIds = preservedBefore.rows.map((row) =>
      String(row?.snapshot_id ?? ""),
    );
    const preservedAfterIds = preservedAfter.rows.map((row) =>
      String(row?.snapshot_id ?? ""),
    );
    if (
      preservedBeforeIds.length !== preservedAfterIds.length ||
      preservedBeforeIds.some(
        (snapshotId, index) => snapshotId !== preservedAfterIds[index],
      ) ||
      String(preservedBefore.rows[0]?.snapshot_id ?? "") !==
        String(preservedAfter.rows[0]?.snapshot_id ?? "") ||
      Number(preservedBefore.rows[0]?.indexed_through_block ?? 0) !==
        Number(preservedAfter.rows[0]?.indexed_through_block ?? 0)
    ) {
      throw new Error(
        "INCB issuance repair changed an authoritative block-scan checkpoint.",
      );
    }
    const lockedValueSnapshotsAfter =
      await lockedCanonicalIncbValueSnapshots(client, valueSnapshotIds);
    const valueSnapshotFingerprintsAfter =
      verifiedCanonicalIncbValueSnapshotFingerprints(
        lockedValueSnapshotsAfter,
        valueSnapshotBindings,
      );
    if (
      valueSnapshotFingerprintsAfter.size !==
        valueSnapshotFingerprintsBefore.size ||
      [...valueSnapshotFingerprintsBefore].some(
        ([snapshotId, fingerprint]) =>
          valueSnapshotFingerprintsAfter.get(snapshotId) !== fingerprint,
      )
    ) {
      throw new Error(
        "INCB issuance repair changed a locked issuance value snapshot.",
      );
    }

    // This is intentionally the final operation before COMMIT. Prove both the
    // current canonical block hash and the target's exact transaction index
    // again after snapshot invalidation so a reorg cannot commit a stale mint.
    for (const target of targets) {
      const finalBlockHash = String(
        await bitcoinRpc("getblockhash", [target.height]),
      )
        .trim()
        .toLowerCase();
      const finalBlock = await bitcoinRpc("getblock", [finalBlockHash, 1]);
      const finalTxids = Array.isArray(finalBlock?.tx) ? finalBlock.tx : [];
      const finalRaw = await bitcoinRpc("getrawtransaction", [
        target.txid,
        true,
      ]);
      if (
        finalBlockHash !== target.blockHash ||
        Number(finalBlock?.height) !== target.height ||
        String(finalTxids[target.blockIndex] ?? "").trim().toLowerCase() !==
          target.txid ||
        Number(finalRaw?.confirmations) <= 0 ||
        String(finalRaw?.blockhash ?? "").trim().toLowerCase() !==
          target.blockHash
      ) {
        throw new Error(
          `Canonical INCB issuance repair ${target.txid} changed exact chain position before commit.`,
        );
      }
    }
    await client.query("COMMIT");
    return {
      after: {
        balanceSupply: balanceSupply.toString(),
        canonicalTargetBondRows: repairedBonds.rows.length,
        canonicalTargetMintRows: repairedEvents.rows.length,
        targetIssuanceUnits: repairedTargetIssuance.toString(),
      },
      balanceSupply: balanceSupply.toString(),
      before: {
        balanceSupply: beforeBalanceSupply.toString(),
        canonicalTargetBondRows: existingBonds.rows.length,
        canonicalTargetMintRows: beforeCanonicalMintRows,
        targetIssuanceUnits: beforeTargetIssuance.toString(),
      },
      holders: replay.holders,
      invalidatedSnapshots: invalidated.rowCount,
      latestPreservedBlockScanSnapshot: {
        indexedThroughBlock: Number(
          preservedAfter.rows[0]?.indexed_through_block ?? 0,
        ),
        snapshotId: String(preservedAfter.rows[0]?.snapshot_id ?? ""),
      },
      preservedBlockScanSnapshots: preservedAfterIds.length,
      preservedIssuanceValueSnapshotIds: valueSnapshotIds,
      preservedIssuanceValueSnapshots: valueSnapshotIds.length,
      issuanceAccountingModel: INCB_ISSUANCE_ACCOUNTING_MODEL,
      mintedSupply: mintedSupply.toString(),
      targetIssuanceUnits: expectedIssuance.toString(),
      targets: targets.map((target) => ({
        blockHash: target.blockHash,
        blockHeight: target.height,
        blockIndex: target.blockIndex,
        issuanceUnits: target.issuanceUnits.toString(),
        oracle: target.oracle,
        txid: target.txid,
      })),
    };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  }
}

async function canonicalTransactionRepairTarget(txid) {
  const raw = await bitcoinRpc("getrawtransaction", [txid, true]);
  const blockHash = String(raw?.blockhash ?? "").trim().toLowerCase();
  if (
    String(raw?.txid ?? "").trim().toLowerCase() !== txid ||
    Number(raw?.confirmations) <= 0 ||
    !isHexTxid(blockHash)
  ) {
    throw new Error(
      `Canonical transaction-row repair target ${txid} is not confirmed in Bitcoin Core.`,
    );
  }

  const block = await bitcoinRpc("getblock", [blockHash, 2]);
  const height = Number(block?.height);
  if (!Number.isSafeInteger(height) || height < 0) {
    throw new Error(
      `Canonical transaction-row repair target ${txid} has no exact block height.`,
    );
  }
  assertCanonicalBlockEnvelope(block, height, blockHash);
  const canonicalBlockHash = String(
    await bitcoinRpc("getblockhash", [height]),
  )
    .trim()
    .toLowerCase();
  if (canonicalBlockHash !== blockHash) {
    throw new Error(
      `Canonical transaction-row repair target ${txid} is not in the canonical block at height ${height}.`,
    );
  }

  const matchingIndexes = block.tx.flatMap((candidate, index) =>
    String(candidate?.txid ?? "").trim().toLowerCase() === txid ? [index] : [],
  );
  if (matchingIndexes.length !== 1) {
    throw new Error(
      `Canonical transaction-row repair target ${txid} does not have one exact block membership.`,
    );
  }
  const blockIndex = matchingIndexes[0];
  const blockTransaction = block.tx[blockIndex];
  const rawHash = String(raw?.hash ?? "").trim().toLowerCase();
  const memberHash = String(blockTransaction?.hash ?? "").trim().toLowerCase();
  if (
    (rawHash && memberHash && rawHash !== memberHash) ||
    (raw?.hex && blockTransaction?.hex && raw.hex !== blockTransaction.hex)
  ) {
    throw new Error(
      `Canonical transaction-row repair target ${txid} differs from its exact block member.`,
    );
  }

  const hydrated = await transactionWithInputPrevouts({
    ...blockTransaction,
    _powBlockHash: blockHash,
    _powBlockIndex: blockIndex,
    _powPreviousBlockHash: String(block?.previousblockhash ?? "")
      .trim()
      .toLowerCase(),
    blocktime: block?.time,
    height,
  });
  assertHydratedProtocolTransaction(hydrated);
  return {
    block,
    blockHash,
    blockIndex,
    details: canonicalTransactionDetailRows(hydrated),
    height,
    hydrated,
    txid,
  };
}

function canonicalTransactionRepairDetailsFingerprint(details) {
  const nullableText = (value) =>
    value === undefined || value === null ? null : String(value);
  const normalized = {
    inputs: (Array.isArray(details?.inputs) ? details.inputs : [])
      .map((row) => ({
        address: nullableText(row?.address),
        prev_txid: nullableText(row?.prev_txid),
        prev_vout: nullableText(row?.prev_vout),
        script_sig: nullableText(row?.script_sig),
        sequence: nullableText(row?.sequence),
        value_sats: nullableText(row?.value_sats),
        vin: Number(row?.vin),
        witness: Array.isArray(row?.witness) ? row.witness.map(String) : [],
      }))
      .sort((left, right) => left.vin - right.vin),
    opReturns: (Array.isArray(details?.opReturns) ? details.opReturns : [])
      .map((row) => ({
        data_bytes: Number(row?.data_bytes),
        output_index: Number(row?.output_index),
        payload_hex: nullableText(row?.payload_hex),
        payload_text: nullableText(row?.payload_text),
        protocol: nullableText(row?.protocol),
        vout: Number(row?.vout),
      }))
      .sort(
        (left, right) =>
          left.vout - right.vout || left.output_index - right.output_index,
      ),
    outputs: (Array.isArray(details?.outputs) ? details.outputs : [])
      .map((row) => ({
        address: nullableText(row?.address),
        scriptpubkey: nullableText(row?.scriptpubkey),
        scriptpubkey_asm: nullableText(row?.scriptpubkey_asm),
        scriptpubkey_type: nullableText(row?.scriptpubkey_type),
        value_sats: nullableText(row?.value_sats),
        vout: Number(row?.vout),
      }))
      .sort((left, right) => left.vout - right.vout),
  };
  return createHash("sha256").update(JSON.stringify(normalized)).digest("hex");
}

async function storedCanonicalTransactionRepairDetails(client, txid) {
  const inputs = await client.query(
    `
      SELECT
        vin, prev_txid, prev_vout, address, value_sats, sequence,
        script_sig, witness
      FROM proof_indexer.tx_inputs
      WHERE network = $1 AND txid = $2
      ORDER BY vin
    `,
    [NETWORK, txid],
  );
  const outputs = await client.query(
    `
      SELECT
        vout, value_sats, address, scriptpubkey, scriptpubkey_asm,
        scriptpubkey_type
      FROM proof_indexer.tx_outputs
      WHERE network = $1 AND txid = $2
      ORDER BY vout
    `,
    [NETWORK, txid],
  );
  const opReturns = await client.query(
    `
      SELECT
        vout, output_index, protocol, payload_text, payload_hex, data_bytes
      FROM proof_indexer.op_returns
      WHERE network = $1 AND txid = $2
      ORDER BY vout, output_index
    `,
    [NETWORK, txid],
  );
  return {
    inputs: inputs.rows,
    opReturns: opReturns.rows,
    outputs: outputs.rows,
  };
}

async function canonicalTransactionRepairEventState(client, txids) {
  const result = await client.query(
    `
      SELECT event_id, to_jsonb(event_row) AS snapshot
      FROM proof_indexer.events AS event_row
      WHERE network = $1 AND txid = ANY($2::text[])
      ORDER BY event_id
      FOR SHARE
    `,
    [NETWORK, txids],
  );
  return {
    count: result.rows.length,
    fingerprint: createHash("sha256")
      .update(JSON.stringify(result.rows))
      .digest("hex"),
  };
}

async function assertCanonicalTransactionRepairStillCurrent(target) {
  const currentBlockHash = String(
    await bitcoinRpc("getblockhash", [target.height]),
  )
    .trim()
    .toLowerCase();
  if (currentBlockHash !== target.blockHash) {
    throw new Error(
      `Canonical transaction-row repair target ${target.txid} changed block before commit.`,
    );
  }
  const [block, raw] = await Promise.all([
    bitcoinRpc("getblock", [currentBlockHash, 1]),
    bitcoinRpc("getrawtransaction", [target.txid, true]),
  ]);
  const txids = (Array.isArray(block?.tx) ? block.tx : []).map((candidate) =>
    String(candidate?.txid ?? candidate ?? "").trim().toLowerCase(),
  );
  if (
    String(block?.hash ?? "").trim().toLowerCase() !== target.blockHash ||
    Number(block?.height) !== target.height ||
    Number(block?.nTx) !== txids.length ||
    txids.filter((txid) => txid === target.txid).length !== 1 ||
    txids[target.blockIndex] !== target.txid ||
    String(raw?.txid ?? "").trim().toLowerCase() !== target.txid ||
    String(raw?.blockhash ?? "").trim().toLowerCase() !== target.blockHash ||
    Number(raw?.confirmations) <= 0
  ) {
    throw new Error(
      `Canonical transaction-row repair target ${target.txid} changed exact chain position before commit.`,
    );
  }
}

async function repairCanonicalTransactions(client) {
  const targets = [];
  for (const txid of REPAIR_CANONICAL_TXIDS) {
    targets.push(await canonicalTransactionRepairTarget(txid));
  }
  targets.sort(
    (left, right) =>
      left.height - right.height ||
      left.blockIndex - right.blockIndex ||
      left.txid.localeCompare(right.txid),
  );
  const txids = targets.map((target) => target.txid);

  await client.query("BEGIN");
  try {
    const stored = await client.query(
      `
        SELECT txid, status
        FROM proof_indexer.transactions
        WHERE network = $1 AND txid = ANY($2::text[])
        FOR UPDATE
      `,
      [NETWORK, txids],
    );
    const previousStatusByTxid = new Map(
      stored.rows.map((row) => [String(row?.txid ?? "").toLowerCase(), row?.status]),
    );
    if (
      stored.rows.length !== targets.length ||
      targets.some((target) => !previousStatusByTxid.has(target.txid))
    ) {
      throw new Error(
        `Canonical transaction-row repair requires all ${targets.length} target rows to already exist.`,
      );
    }
    if (
      targets.some(
        (target) => previousStatusByTxid.get(target.txid) !== "confirmed",
      )
    ) {
      throw new Error(
        "Canonical transaction-row repair requires every target row to already be confirmed.",
      );
    }
    const eventStateBefore = await canonicalTransactionRepairEventState(
      client,
      txids,
    );

    for (const target of targets) {
      await persistCanonicalBlock(
        client,
        target.block,
        target.height,
        target.blockHash,
      );
      await persistCanonicalRawTransaction(client, target.hydrated, {
        blockHash: target.blockHash,
        blockTime: target.block?.time,
        height: target.height,
      });

      const verified = await client.query(
        `
          SELECT
            transaction_row.status,
            transaction_row.block_hash,
            transaction_row.block_height,
            transaction_row.source,
            transaction_row.raw_tx,
            canonical_block.canonical AS block_canonical,
            (
              SELECT count(*)
              FROM proof_indexer.blocks AS competing_block
              WHERE competing_block.network = transaction_row.network
                AND competing_block.height = transaction_row.block_height
                AND competing_block.canonical = true
            ) AS canonical_block_count
          FROM proof_indexer.transactions AS transaction_row
          JOIN proof_indexer.blocks AS canonical_block
            ON canonical_block.network = transaction_row.network
           AND canonical_block.block_hash = transaction_row.block_hash
           AND canonical_block.height = transaction_row.block_height
          WHERE transaction_row.network = $1 AND transaction_row.txid = $2
          FOR UPDATE OF transaction_row
        `,
        [NETWORK, target.txid],
      );
      const row = verified.rows[0];
      const rawTx = row?.raw_tx;
      const storedDetails = await storedCanonicalTransactionRepairDetails(
        client,
        target.txid,
      );
      if (
        verified.rows.length !== 1 ||
        row?.status !== "confirmed" ||
        String(row?.block_hash ?? "").trim().toLowerCase() !== target.blockHash ||
        Number(row?.block_height) !== target.height ||
        row?.source !== "canonical-block-scan" ||
        row?.block_canonical !== true ||
        Number(row?.canonical_block_count) !== 1 ||
        String(rawTx?.txid ?? "").trim().toLowerCase() !== target.txid ||
        Number(rawTx?._powBlockIndex) !== target.blockIndex ||
        String(rawTx?._powBlockHash ?? "").trim().toLowerCase() !==
          target.blockHash ||
        String(rawTx?.canonicalBlockScan?.blockHash ?? "")
          .trim()
          .toLowerCase() !== target.blockHash ||
        Number(rawTx?.canonicalBlockScan?.height) !== target.height ||
        rawTx?.canonicalBlockScan?.network !== NETWORK ||
        canonicalTransactionRepairDetailsFingerprint(storedDetails) !==
          canonicalTransactionRepairDetailsFingerprint(target.details)
      ) {
        throw new Error(
          `Canonical transaction-row repair verification failed for ${target.txid}.`,
        );
      }
    }

    const eventStateAfter = await canonicalTransactionRepairEventState(
      client,
      txids,
    );
    if (
      eventStateAfter.count !== eventStateBefore.count ||
      eventStateAfter.fingerprint !== eventStateBefore.fingerprint
    ) {
      throw new Error(
        "Canonical transaction-row repair changed an event row and was rolled back.",
      );
    }
    // Make the final full-node canonicality proof the last operation before
    // commit so a reorg cannot land between that proof and other verification.
    for (const target of targets) {
      await assertCanonicalTransactionRepairStillCurrent(target);
    }
    await client.query("COMMIT");
    return {
      eventRowsPreserved: eventStateAfter.count,
      repaired: targets.length,
      source: "repair-canonical-transactions",
      targets: targets.map((target) => ({
        blockHash: target.blockHash,
        blockHeight: target.height,
        blockIndex: target.blockIndex,
        previousStatus: previousStatusByTxid.get(target.txid),
        txid: target.txid,
      })),
    };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  }
}

async function canonicalIdRepairTarget(txid) {
  const raw = await rawTransactionFromCore(txid);
  const blockHash = String(raw?.blockhash ?? "").trim().toLowerCase();
  if (
    !raw ||
    Number(raw?.confirmations) <= 0 ||
    !/^[0-9a-f]{64}$/u.test(blockHash)
  ) {
    throw new Error(`Canonical ID repair transaction ${txid} is not confirmed.`);
  }
  const block = await bitcoinRpc("getblock", [blockHash, 2]);
  const height = Number(block?.height);
  assertCanonicalBlockEnvelope(block, height, blockHash);
  const blockIndex = (Array.isArray(block?.tx) ? block.tx : []).findIndex(
    (candidate) => String(candidate?.txid ?? "").trim().toLowerCase() === txid,
  );
  if (blockIndex < 0) {
    throw new Error(
      `Canonical ID repair transaction ${txid} is absent from block ${blockHash}.`,
    );
  }
  const hydrated = await transactionWithInputPrevouts({
    ...block.tx[blockIndex],
    _powBlockHash: blockHash,
    _powBlockIndex: blockIndex,
    _powPreviousBlockHash: String(block?.previousblockhash ?? "")
      .trim()
      .toLowerCase(),
    blocktime: block?.time,
    height,
  });
  assertHydratedProtocolTransaction(hydrated);
  const messages = protocolMessagesFromTx(hydrated).filter(
    (message) => message?.prefix === "pwid1:",
  );
  const rawItems = messages.flatMap((message) =>
    protocolItemsFromTx(hydrated, message),
  );
  const ids = [
    ...new Set(
      rawItems
        .map((item) => normalizedPowId(item?.id))
        .filter(Boolean),
    ),
  ];
  if (messages.length === 0 || rawItems.length === 0 || ids.length === 0) {
    throw new Error(
      `Canonical ID repair transaction ${txid} has no parseable pwid1 event.`,
    );
  }
  return { block, blockHash, height, hydrated, ids, messages, rawItems, txid };
}

async function repairCanonicalIdTransactions(client) {
  const targets = [];
  for (const txid of REPAIR_ID_TXIDS) {
    targets.push(await canonicalIdRepairTarget(txid));
  }
  targets.sort(
    (left, right) =>
      left.height - right.height ||
      Number(left.hydrated?._powBlockIndex ?? 0) -
        Number(right.hydrated?._powBlockIndex ?? 0) ||
      left.txid.localeCompare(right.txid),
  );
  const affectedIds = [
    ...new Set(targets.flatMap((target) => target.ids)),
  ];
  for (const id of affectedIds) {
    if (
      !targets.some((target) =>
        target.rawItems.some(
          (item) => item?.kind === "id-register" && normalizedPowId(item?.id) === id,
        ),
      )
    ) {
      throw new Error(
        `Canonical ID repair for ${id} must include its registration transaction.`,
      );
    }
  }

  await client.query("BEGIN");
  try {
    await client.query(
      `
        DELETE FROM proof_indexer.event_participants
        WHERE event_id IN (
          SELECT event_id
          FROM proof_indexer.events
          WHERE network = $1
            AND txid = ANY($2::text[])
            AND (protocol = 'pwid1' OR kind LIKE 'id-%')
        )
      `,
      [NETWORK, REPAIR_ID_TXIDS],
    );
    await client.query(
      `
        DELETE FROM proof_indexer.event_refs
        WHERE event_id IN (
          SELECT event_id
          FROM proof_indexer.events
          WHERE network = $1
            AND txid = ANY($2::text[])
            AND (protocol = 'pwid1' OR kind LIKE 'id-%')
        )
      `,
      [NETWORK, REPAIR_ID_TXIDS],
    );
    await client.query(
      `
        DELETE FROM proof_indexer.events
        WHERE network = $1
          AND txid = ANY($2::text[])
          AND (protocol = 'pwid1' OR kind LIKE 'id-%')
      `,
      [NETWORK, REPAIR_ID_TXIDS],
    );
    await client.query(
      `
        DELETE FROM proof_indexer.id_records
        WHERE network = $1
          AND id_lower = ANY($2::text[])
      `,
      [NETWORK, affectedIds],
    );
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  }

  let indexed = 0;
  for (const target of targets) {
    const prepared = await preparedProtocolItemsForTx(
      target.hydrated,
      target.messages,
    );
    if (
      prepared.length === 0 ||
      prepared.some(
        (entry) =>
          entry?.item?.valid === false ||
          !String(entry?.item?.kind ?? "").startsWith("id-"),
      )
    ) {
      throw new Error(
        `Canonical ID repair verifier did not return only valid ID events for ${target.txid}.`,
      );
    }
    await client.query("BEGIN");
    try {
      await persistCanonicalBlock(
        client,
        target.block,
        target.height,
        target.blockHash,
      );
      await persistCanonicalRawTransaction(client, target.hydrated, {
        blockHash: target.blockHash,
        blockTime: target.block?.time,
        height: target.height,
      });
      const result = await persistPreparedProtocolItems(client, prepared);
      indexed += result.indexed;
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    }
  }

  const verification = await client.query(
    `
      SELECT
        (SELECT count(*)
         FROM proof_indexer.id_records
         WHERE network = $1
           AND id_lower = ANY($2::text[])) AS records,
        (SELECT count(*)
         FROM proof_indexer.events
         WHERE network = $1
           AND txid = ANY($3::text[])
           AND (valid = false OR kind LIKE '%-invalid')) AS invalid_events
    `,
    [NETWORK, affectedIds, REPAIR_ID_TXIDS],
  );
  const records = Number(verification.rows[0]?.records ?? 0);
  const invalidEvents = Number(verification.rows[0]?.invalid_events ?? 0);
  if (records !== affectedIds.length || invalidEvents !== 0) {
    throw new Error(
      `Canonical ID repair verification failed: records=${records}/${affectedIds.length}, invalidEvents=${invalidEvents}.`,
    );
  }
  return {
    affectedIds,
    indexed,
    invalidEvents,
    records,
    source: "repair-canonical-id-transactions",
    txids: targets.map((target) => target.txid),
  };
}

if (DRY_RUN) {
  console.log(
    JSON.stringify(
      {
        apiBase: API_BASE,
        auditWorkAtomsOnly: AUDIT_WORK_ATOMS_ONLY,
        dryRun: true,
        hydrateTransactionDetailsOnly: HYDRATE_TRANSACTION_DETAILS_ONLY,
        maxPages: MAX_PAGES,
        migrateWorkAtomsOnly: MIGRATE_WORK_ATOMS_ONLY,
        verifyWorkAtomsPostBootstrapOnly:
          VERIFY_WORK_ATOMS_POST_BOOTSTRAP_ONLY,
        network: NETWORK,
        pageLimit: PAGE_LIMIT,
        repairCanonicalTxids: REPAIR_CANONICAL_TXIDS,
        repairCanonicalTxidsOnly: REPAIR_CANONICAL_TXIDS_ONLY,
        repairMintMinters: REPAIR_MINT_MINTERS,
        rushBootstrap: {
          batchSize: RUSH_BOOTSTRAP_BATCH_SIZE,
          enabled: RUSH_BOOTSTRAP_ENABLED,
          maxTxids: RUSH_BOOTSTRAP_MAX_TXIDS,
          only: RUSH_BOOTSTRAP_ONLY,
        },
        repairIdTxids: REPAIR_ID_TXIDS,
        repairIdTxidsOnly: REPAIR_ID_TXIDS_ONLY,
        repairIncbIssuance: REPAIR_INCB_ISSUANCE_ONLY,
        repairIncbIssuanceTxids: REPAIR_INCB_ISSUANCE_TXIDS,
        repairWorkParticipants: REPAIR_WORK_PARTICIPANTS,
        repairWorkParticipantsOnly: REPAIR_WORK_PARTICIPANTS_ONLY,
        repairWorkParticipantsTxids: REPAIR_WORK_PARTICIPANTS_TXIDS,
        scopedHolders: INCLUDE_SCOPED_HOLDERS,
        prepareCanonicalRebuildOnly: PREPARE_CANONICAL_REBUILD_ONLY,
        prepareCanonicalPwtRangeReplayOnly:
          PREPARE_CANONICAL_PWT_RANGE_REPLAY_ONLY,
        sources: SOURCES.map((source) => source.label),
        storeCanonicalSummarySnapshot: STORE_CANONICAL_SUMMARY_SNAPSHOT,
        storeLedgerSnapshot: STORE_LEDGER_SNAPSHOT,
        transactionDetailHydration: {
          afterBlockIndex: TX_DETAIL_HYDRATION_AFTER_BLOCK_INDEX,
          afterHeight: TX_DETAIL_HYDRATION_AFTER_HEIGHT,
          afterTxid: TX_DETAIL_HYDRATION_AFTER_TXID,
          batchSize: TX_DETAIL_HYDRATION_BATCH_SIZE,
          maxRows: TX_DETAIL_HYDRATION_MAX_ROWS,
        },
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
      process.env.POW_INDEX_DB_APP_NAME ?? "proof-indexer-backfill",
  },
});

try {
  const client = await pool.connect();
  try {
    const pwtRangeReplayRuntime =
      await canonicalPwtRangeReplayRuntime(client);
    if (HYDRATE_TRANSACTION_DETAILS_ONLY) {
      const hydration = await hydrateHistoricalCanonicalTransactionDetails(
        client,
      );
      console.log(
        JSON.stringify(
          {
            historicalTransactionDetailHydration: true,
            hydration,
            network: NETWORK,
            ok: true,
          },
          null,
          2,
        ),
      );
    } else if (AUDIT_WORK_ATOMS_ONLY) {
      const audit = await auditWorkAtomicProjection(client);
      console.log(
        JSON.stringify(
          {
            audit,
            network: NETWORK,
            ok: true,
            workAtomicProjectionAudit: true,
          },
          null,
          2,
        ),
      );
    } else if (MIGRATE_WORK_ATOMS_ONLY) {
      const migration = await migrateWorkAtomicProjection(client);
      console.log(
        JSON.stringify(
          {
            migration,
            network: NETWORK,
            ok: true,
            workAtomicProjectionMigration: true,
          },
          null,
          2,
        ),
      );
    } else if (VERIFY_WORK_ATOMS_POST_BOOTSTRAP_ONLY) {
      const verification = await verifyWorkAtomicPostBootstrap(client);
      console.log(
        JSON.stringify(
          {
            network: NETWORK,
            ok: true,
            verification,
            workAtomicPostBootstrapVerification: true,
          },
          null,
          2,
        ),
      );
    } else if (RUSH_BOOTSTRAP_ONLY) {
      const rushBootstrap = await ensureCanonicalRushBootstrap(client);
      console.log(
        JSON.stringify(
          {
            apiBase: API_BASE,
            network: NETWORK,
            ok: rushBootstrap.complete === true,
            rushBootstrap,
          },
          null,
          2,
        ),
      );
      if (rushBootstrap.complete !== true) {
        process.exitCode = 1;
      }
    } else if (PREPARE_CANONICAL_PWT_RANGE_REPLAY_ONLY) {
      const prepared = await prepareCanonicalPwtRangeReplay(client);
      console.log(
        JSON.stringify(
          {
            canonicalPwtRangeReplayPrepared: true,
            network: NETWORK,
            ok: true,
            resumed: prepared?.resumed === true,
            state: prepared?.value ?? null,
            baseDefinitions: prepared?.baseDefinitions ?? null,
            baseMarketplaceEvents: prepared?.baseMarketplaceEvents ?? null,
            creditUnitStorageMigration:
              prepared?.creditUnitStorageMigration ?? null,
          },
          null,
          2,
        ),
      );
    } else if (PREPARE_CANONICAL_REBUILD_ONLY) {
      const prepared = await prepareCanonicalRebuild(client);
      console.log(
        JSON.stringify(
          {
            canonicalRebuildPrepared: true,
            network: NETWORK,
            ok: true,
            resumed: prepared?.resumed === true,
            state: prepared?.value ?? null,
            creditUnitStorageMigration:
              prepared?.creditUnitStorageMigration ?? null,
          },
          null,
          2,
        ),
      );
    } else if (REPAIR_CANONICAL_TXIDS_ONLY) {
      const repair = await repairCanonicalTransactions(client);
      console.log(
        JSON.stringify(
          {
            apiBase: API_BASE,
            canonicalTransactionRepair: true,
            network: NETWORK,
            ok: true,
            repair,
          },
          null,
          2,
        ),
      );
    } else if (REPAIR_INCB_ISSUANCE_ONLY) {
      const repair = await repairCanonicalIncbIssuance(client);
      console.log(
        JSON.stringify(
          {
            apiBase: API_BASE,
            canonicalIncbIssuanceRepair: true,
            network: NETWORK,
            ok: true,
            repair,
          },
          null,
          2,
        ),
      );
    } else if (REPAIR_ID_TXIDS_ONLY) {
      const repair = await repairCanonicalIdTransactions(client);
      console.log(
        JSON.stringify(
          {
            apiBase: API_BASE,
            canonicalIdRepair: true,
            network: NETWORK,
            ok: true,
            repair,
          },
          null,
          2,
        ),
      );
    } else if (DB_SUMMARY_REPAIR) {
      const snapshot = await repairStoredSummarySnapshot(client);
      console.log(
        JSON.stringify(
          {
            dbSummaryRepair: true,
            network: NETWORK,
            ok: true,
            snapshotId: snapshot.snapshotId,
            totals: summarySnapshotTotals(snapshot.summaryPayloads),
          },
          null,
          2,
        ),
      );
    } else if (pwtRangeReplayRuntime.active) {
      const result = await backfillSource(client, SOURCES[0]);
      console.log(
        JSON.stringify(
          {
            activePwtRangeReplay: true,
            apiBase: API_BASE,
            network: NETWORK,
            ok: true,
            result,
            verifierBinding:
              pwtRangeReplayRuntime.verifierBinding ?? null,
          },
          null,
          2,
        ),
      );
    } else {
      const results = [];
      let rushBootstrap = null;
      if (!REPAIR_WORK_PARTICIPANTS_ONLY) {
        for (const source of SOURCES) {
          results.push(await backfillSource(client, source));
        }
        rushBootstrap = await ensureCanonicalRushBootstrap(client);
        results.push(rushBootstrap);
        results.push(await repairMailParticipants(client));
        results.push(await repairConfirmedListingSealMetadata(client));
      }
      results.push(await repairConfirmedWorkTransferParticipants(client));
      if (REPAIR_WORK_PARTICIPANTS_ONLY) {
        console.log(
          JSON.stringify(
            {
              apiBase: API_BASE,
              network: NETWORK,
              ok: true,
              repairWorkParticipantsOnly: true,
              results,
            },
            null,
            2,
          ),
        );
        process.exitCode = 0;
      } else {
        results.push(await repairWorkMintMinterAttribution(client));
        results.push(await backfillScopedTokenHolders(client));
        const snapshot = STORE_LEDGER_SNAPSHOT
          ? await storeLedgerSnapshot(client)
          : null;
        const canonicalSummarySnapshot =
          STORE_CANONICAL_SUMMARY_SNAPSHOT && rushBootstrap?.complete === true
          ? await storeCanonicalSummarySnapshot(client)
          : STORE_CANONICAL_SUMMARY_SNAPSHOT
            ? {
                reason: "rush-canonical-bootstrap-in-progress",
                skipped: true,
              }
            : null;
        console.log(
          JSON.stringify(
            {
              apiBase: API_BASE,
              network: NETWORK,
              ok: true,
              results,
              canonicalSummarySnapshot,
              snapshotId: snapshot?.snapshotId ?? null,
              storeCanonicalSummarySnapshot: STORE_CANONICAL_SUMMARY_SNAPSHOT,
              storeLedgerSnapshot: STORE_LEDGER_SNAPSHOT,
            },
            null,
            2,
          ),
        );
      }
    }
  } finally {
    client.release();
  }
} finally {
  await pool.end();
}
