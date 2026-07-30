import { createHash } from "node:crypto";
import { constants as fsConstants } from "node:fs";
import { lstat, open, realpath } from "node:fs/promises";
import { isAbsolute, resolve } from "node:path";
import { createInterface } from "node:readline";
import { pathToFileURL } from "node:url";

import { q8TextFromDecimal } from "../server/bond-units.mjs";
import { createProofIndexPool } from "../server/db/postgres.mjs";
import { incbReplayRawSnapshotFingerprint } from
  "../server/incb-range-replay-witness.mjs";

export const RESTORE_INCB_ORACLE_SNAPSHOTS_MODEL =
  "proof-indexer-incb-oracle-snapshot-selective-restore-v1";
export const RESTORE_INCB_ORACLE_SNAPSHOTS_ARTIFACT_SHA256 =
  "4bdc01059114110396bdf666b68dd24d2c074c4c48e382b18a0f3a61849430bd";
export const RESTORE_INCB_ORACLE_SNAPSHOTS_APPLY_ENV =
  "POW_RESTORE_INCB_ORACLE_SNAPSHOTS_APPLY";
export const RESTORE_INCB_ORACLE_SNAPSHOTS_DATABASE_ENV =
  "POW_INDEX_DATABASE_URL";

export const EXPECTED_INCB_ORACLE_SNAPSHOT_IDS = Object.freeze([
  "0d013316972dea627a571cfa",
  "2aab25ca991f1d53895b5cb2",
  "34f3d816786f7e8f2f81b505",
  "40cd14abee715e4b9074a474",
  "7b937a7a603b1332d22b06e1",
  "80e84ace387f63fa1c34aa22",
  "88598ea2c4cd03c3641c9493",
  "8ff476fff4f2fb14373a34e3",
  "94f8316c91af164ebf92c179",
  "9a7831112b60da8ba8a6d5d1",
  "a5a3faedaa796de67db5dee2",
  "b5d36ee98bcbef4fc7a54aed",
  "b8e77cd30cbed6855977c514",
  "c8b800384da576c962ae82a5",
  "dca7e548d87d04940c1635ee",
  "e59bf41d4ced5cb965cb0cb6",
  "efbf9a05058307f1fb35802a",
  "f92c69962c409d55ba1b103c",
]);

const NETWORK = "livenet";
const INCB_TOKEN_ID =
  "3cb25745f937f2b4e5508e5400189fe8fe679cd8e84bfa1e9176d70c9761f15d";
const INCB_VALUE_SNAPSHOT_MODEL = "canonical-summary-h-minus-one-v1";
const INCB_VALUE_SNAPSHOT_MODE = "canonical-summary-refresh";
const LEGACY_REFERENCE_CUTOFF_HEIGHT = 958_383;
const EXPECTED_LEGACY_REFERENCE_COUNT = 30;
const EXPECTED_ALL_REFERENCE_ID_COUNT = 29;
const LEGACY_WORK_VALUE_MODE = "locked-bound-legacy-work-value-v1";
const WORK_NETWORK_VALUE_ACCOUNTING_MODEL =
  "canonical-exact-work-network-q8-v1";
const LEGACY_WORK_VALUE_MODEL_PATHS = Object.freeze([
  ["totals", "workNetworkValueAccountingModel"],
  [
    "summaryPayloads",
    "workFloor",
    "workNetworkValueAccountingModel",
  ],
  [
    "summaryPayloads",
    "workFloor",
    "actualValue",
    "workNetworkValueAccountingModel",
  ],
]);
const LEGACY_WORK_VALUE_DECIMAL_PATHS = Object.freeze([
  ["summaryPayloads", "workFloor", "liveNetworkValueSats"],
  [
    "summaryPayloads",
    "workFloor",
    "actualValue",
    "liveNetworkValueSats",
  ],
  ["summaryPayloads", "workFloor", "actualValue", "liveTotalSats"],
  ["summaryPayloads", "workFloor", "actualValue", "totalSats"],
]);
const LEGACY_WORK_VALUE_Q8_PATHS = Object.freeze([
  ["totals", "workNetworkValueQ8"],
  ["summaryPayloads", "workFloor", "networkValueQ8"],
  ["summaryPayloads", "workFloor", "liveNetworkValueQ8"],
  [
    "summaryPayloads",
    "workFloor",
    "actualValue",
    "networkValueQ8",
  ],
  [
    "summaryPayloads",
    "workFloor",
    "actualValue",
    "liveNetworkValueQ8",
  ],
  ["summaryPayloads", "workFloor", "actualValue", "totalQ8"],
  ["summaryPayloads", "workFloor", "actualValue", "liveTotalQ8"],
]);
const HASH_PATTERN = /^[0-9a-f]{64}$/u;
const SNAPSHOT_ID_PATTERN = /^[0-9a-f]{24}$/u;
const POSITIVE_INTEGER_PATTERN = /^[1-9][0-9]*$/u;
const ARTIFACT_COLUMNS = Object.freeze([
  "consistency",
  "generated_at",
  "indexed_through_block",
  "metrics",
  "network",
  "payload",
  "snapshot_id",
  "source_hashes",
]);
const MAX_ARTIFACT_BYTES = 512 * 1024 * 1024;
const ADVISORY_LOCK_KEY =
  "proof-indexer:restore-incb-oracle-snapshots:v1";
const CANONICAL_REBUILD_META_KEY = "canonical:rebuild";
const CANONICAL_FAULT_META_KEY = "canonical:fault";
const PWT_RANGE_REPLAY_VERIFIER_BINDING_MODEL =
  "proof-indexer-pwt-range-replay-verifier-binding-v1";

function plainObject(value) {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value
    : null;
}

function canonicalHash(value, label) {
  const text = String(value ?? "").trim().toLowerCase();
  if (!HASH_PATTERN.test(text)) {
    throw new Error(`${label} must be one lowercase 32-byte hash.`);
  }
  return text;
}

function canonicalSnapshotId(value, label = "snapshot id") {
  const text = String(value ?? "").trim().toLowerCase();
  if (!SNAPSHOT_ID_PATTERN.test(text)) {
    throw new Error(`${label} must be one lowercase 12-byte identifier.`);
  }
  return text;
}

function canonicalTimestamp(value, label) {
  const text = String(value ?? "").trim();
  const timestamp = Date.parse(text);
  if (!text || !Number.isFinite(timestamp)) {
    throw new Error(`${label} must be a valid timestamp.`);
  }
  return new Date(timestamp).toISOString();
}

function canonicalSafeInteger(value, label, { positive = false } = {}) {
  const number = Number(value);
  if (
    !Number.isSafeInteger(number) ||
    number < (positive ? 1 : 0)
  ) {
    throw new Error(`${label} must be a safe canonical integer.`);
  }
  return number;
}

function canonicalPositiveIntegerText(value, label) {
  const text = String(value ?? "").trim();
  if (!POSITIVE_INTEGER_PATTERN.test(text)) {
    throw new Error(`${label} must be a canonical positive integer.`);
  }
  return text;
}

function sortedUnique(values) {
  return [...new Set(values)].sort();
}

export function requiredIncbOracleRestoreDatabaseUrl(env = process.env) {
  const databaseUrl = String(
    env[RESTORE_INCB_ORACLE_SNAPSHOTS_DATABASE_ENV] ?? "",
  ).trim();
  if (!databaseUrl) {
    throw new Error(
      `${RESTORE_INCB_ORACLE_SNAPSHOTS_DATABASE_ENV} is required; legacy and generic database variables are not accepted.`,
    );
  }
  return databaseUrl;
}

function sameStringArray(left, right) {
  return left.length === right.length &&
    left.every((value, index) => value === right[index]);
}

function skipJsonWhitespace(text, start) {
  let index = start;
  while (index < text.length && /\s/u.test(text[index])) index += 1;
  return index;
}

function scanJsonString(text, start) {
  if (text[start] !== "\"") {
    throw new Error("Expected a JSON string.");
  }
  let escaped = false;
  for (let index = start + 1; index < text.length; index += 1) {
    const character = text[index];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (character === "\\") {
      escaped = true;
      continue;
    }
    if (character === "\"") return index + 1;
  }
  throw new Error("Unterminated JSON string.");
}

function scanJsonValue(text, start) {
  const first = text[start];
  if (first === "\"") return scanJsonString(text, start);
  if (first === "{" || first === "[") {
    const stack = [first];
    let inString = false;
    let escaped = false;
    for (let index = start + 1; index < text.length; index += 1) {
      const character = text[index];
      if (inString) {
        if (escaped) {
          escaped = false;
        } else if (character === "\\") {
          escaped = true;
        } else if (character === "\"") {
          inString = false;
        }
        continue;
      }
      if (character === "\"") {
        inString = true;
        continue;
      }
      if (character === "{" || character === "[") {
        stack.push(character);
        continue;
      }
      if (character === "}" || character === "]") {
        const opening = stack.pop();
        if (
          (opening === "{" && character !== "}") ||
          (opening === "[" && character !== "]")
        ) {
          throw new Error("Mismatched JSON container.");
        }
        if (stack.length === 0) return index + 1;
      }
    }
    throw new Error("Unterminated JSON container.");
  }
  let index = start;
  while (
    index < text.length &&
    text[index] !== "," &&
    text[index] !== "}"
  ) {
    index += 1;
  }
  const raw = text.slice(start, index).trim();
  if (!raw) throw new Error("Missing JSON value.");
  JSON.parse(raw);
  return index;
}

export function rawTopLevelJsonFields(text) {
  let index = skipJsonWhitespace(text, 0);
  if (text[index] !== "{") {
    throw new Error("Artifact row must be one JSON object.");
  }
  index += 1;
  const fields = new Map();
  while (true) {
    index = skipJsonWhitespace(text, index);
    if (text[index] === "}") {
      index = skipJsonWhitespace(text, index + 1);
      if (index !== text.length) {
        throw new Error("Artifact row has trailing JSON data.");
      }
      return fields;
    }
    const keyEnd = scanJsonString(text, index);
    const key = JSON.parse(text.slice(index, keyEnd));
    if (fields.has(key)) {
      throw new Error(`Artifact row contains duplicate field ${key}.`);
    }
    index = skipJsonWhitespace(text, keyEnd);
    if (text[index] !== ":") {
      throw new Error(`Artifact row field ${key} has no value separator.`);
    }
    index = skipJsonWhitespace(text, index + 1);
    const valueEnd = scanJsonValue(text, index);
    fields.set(key, text.slice(index, valueEnd).trim());
    index = skipJsonWhitespace(text, valueEnd);
    if (text[index] === ",") {
      index += 1;
      continue;
    }
    if (text[index] !== "}") {
      throw new Error(`Artifact row field ${key} has no closing delimiter.`);
    }
  }
}

export function parseIncbOracleArtifactLine(
  line,
  {
    expectedSnapshotIds = EXPECTED_INCB_ORACLE_SNAPSHOT_IDS,
    lineNumber = 0,
  } = {},
) {
  if (!String(line).trim()) {
    throw new Error(`Artifact line ${lineNumber || "unknown"} is blank.`);
  }
  let value;
  try {
    value = JSON.parse(line);
  } catch (error) {
    throw new Error(
      `Artifact line ${lineNumber || "unknown"} is not valid JSON: ${error.message}`,
    );
  }
  if (!plainObject(value)) {
    throw new Error(`Artifact line ${lineNumber || "unknown"} is not an object.`);
  }
  const keys = Object.keys(value).sort();
  if (!sameStringArray(keys, ARTIFACT_COLUMNS)) {
    throw new Error(
      `Artifact line ${lineNumber || "unknown"} has an unexpected column set.`,
    );
  }
  const rawFields = rawTopLevelJsonFields(line);
  if (!sameStringArray([...rawFields.keys()].sort(), ARTIFACT_COLUMNS)) {
    throw new Error(
      `Artifact line ${lineNumber || "unknown"} has ambiguous raw columns.`,
    );
  }
  if (value.network !== NETWORK) {
    throw new Error(
      `Artifact line ${lineNumber || "unknown"} is not ${NETWORK}.`,
    );
  }
  const snapshotId = canonicalSnapshotId(
    value.snapshot_id,
    `artifact line ${lineNumber || "unknown"} snapshot id`,
  );
  if (!expectedSnapshotIds.includes(snapshotId)) {
    throw new Error(`Artifact contains unexpected snapshot ${snapshotId}.`);
  }
  for (const key of ["source_hashes", "metrics", "consistency", "payload"]) {
    if (!plainObject(value[key])) {
      throw new Error(`Artifact ${snapshotId} ${key} must be an object.`);
    }
  }
  return {
    consistency: value.consistency,
    generatedAt: canonicalTimestamp(
      value.generated_at,
      `artifact ${snapshotId} generated_at`,
    ),
    indexedThroughBlock: canonicalSafeInteger(
      value.indexed_through_block,
      `artifact ${snapshotId} indexed_through_block`,
      { positive: true },
    ),
    metrics: value.metrics,
    network: NETWORK,
    payload: value.payload,
    rawConsistencyJson: rawFields.get("consistency"),
    rawMetricsJson: rawFields.get("metrics"),
    rawPayloadJson: rawFields.get("payload"),
    rawSourceHashesJson: rawFields.get("source_hashes"),
    snapshotId,
    sourceHashes: value.source_hashes,
  };
}

function sameFileIdentity(before, after) {
  return before.dev === after.dev &&
    before.ino === after.ino &&
    before.size === after.size &&
    before.mtimeNs === after.mtimeNs;
}

async function sha256ForFileHandle(handle) {
  const hash = createHash("sha256");
  for await (
    const chunk of handle.createReadStream({ autoClose: false, start: 0 })
  ) {
    hash.update(chunk);
  }
  return hash.digest("hex");
}

export async function loadIncbOracleSnapshotArtifact(
  artifactPath,
  suppliedSha256,
  {
    expectedArtifactSha256 =
      RESTORE_INCB_ORACLE_SNAPSHOTS_ARTIFACT_SHA256,
    expectedSnapshotIds = EXPECTED_INCB_ORACLE_SNAPSHOT_IDS,
  } = {},
) {
  const requestedPath = String(artifactPath ?? "").trim();
  if (!requestedPath || !isAbsolute(requestedPath)) {
    throw new Error("A required absolute --artifact path is missing.");
  }
  const canonicalPath = resolve(requestedPath);
  const sourceLstat = await lstat(canonicalPath);
  if (!sourceLstat.isFile() || sourceLstat.isSymbolicLink()) {
    throw new Error("The recovery artifact must be a non-symlink regular file.");
  }
  if (await realpath(canonicalPath) !== canonicalPath) {
    throw new Error("The recovery artifact path is not canonical.");
  }
  const suppliedHash = canonicalHash(
    suppliedSha256,
    "supplied artifact SHA-256",
  );
  const pinnedHash = canonicalHash(
    expectedArtifactSha256,
    "pinned artifact SHA-256",
  );
  if (suppliedHash !== pinnedHash) {
    throw new Error("The supplied artifact SHA-256 does not match the pinned recovery artifact.");
  }
  const handle = await open(
    canonicalPath,
    fsConstants.O_RDONLY | (fsConstants.O_NOFOLLOW ?? 0),
  );
  try {
    const before = await handle.stat({ bigint: true });
    if (
      !before.isFile() ||
      before.size <= 0n ||
      before.size > BigInt(MAX_ARTIFACT_BYTES)
    ) {
      throw new Error("The recovery artifact size is outside the guarded range.");
    }
    const actualSha256 = await sha256ForFileHandle(handle);
    if (actualSha256 !== pinnedHash) {
      throw new Error(
        `Recovery artifact SHA-256 mismatch: expected ${pinnedHash}, received ${actualSha256}.`,
      );
    }
    const rows = new Map();
    const input = handle.createReadStream({ autoClose: false, start: 0 });
    const parsedBytesHash = createHash("sha256");
    input.on("data", (chunk) => parsedBytesHash.update(chunk));
    const lines = createInterface({ crlfDelay: Infinity, input });
    let lineNumber = 0;
    for await (const line of lines) {
      lineNumber += 1;
      const row = parseIncbOracleArtifactLine(line, {
        expectedSnapshotIds,
        lineNumber,
      });
      if (rows.has(row.snapshotId)) {
        throw new Error(`Artifact duplicates snapshot ${row.snapshotId}.`);
      }
      rows.set(row.snapshotId, row);
    }
    const parsedBytesSha256 = parsedBytesHash.digest("hex");
    if (parsedBytesSha256 !== pinnedHash) {
      throw new Error(
        `Recovery artifact changed before parsing completed: expected ${pinnedHash}, received ${parsedBytesSha256}.`,
      );
    }
    const foundIds = [...rows.keys()].sort();
    const requiredIds = [...expectedSnapshotIds].sort();
    if (
      rows.size !== requiredIds.length ||
      !sameStringArray(foundIds, requiredIds)
    ) {
      throw new Error(
        `Artifact must contain exactly ${requiredIds.length} pinned snapshot rows.`,
      );
    }
    const after = await handle.stat({ bigint: true });
    if (!sameFileIdentity(before, after)) {
      throw new Error("The recovery artifact changed while it was being read.");
    }
    return {
      bytes: Number(before.size),
      path: canonicalPath,
      rows,
      sha256: actualSha256,
    };
  } finally {
    await handle.close();
  }
}

function bindingFromEventRow(row) {
  const snapshotId = canonicalSnapshotId(
    row?.snapshot_id,
    "INCB mint snapshot id",
  );
  const snapshotHeightText = canonicalPositiveIntegerText(
    row?.snapshot_block_height,
    `INCB mint ${snapshotId} snapshot height`,
  );
  const blockHeight = canonicalSafeInteger(
    snapshotHeightText,
    `INCB mint ${snapshotId} snapshot height`,
    { positive: true },
  );
  const eventBlockHeight = canonicalSafeInteger(
    row?.block_height,
    `INCB mint ${snapshotId} block height`,
    { positive: true },
  );
  const transactionBlockHeight = canonicalSafeInteger(
    row?.transaction_block_height,
    `INCB mint ${snapshotId} transaction block height`,
    { positive: true },
  );
  const currentBlockHeight = canonicalSafeInteger(
    row?.canonical_current_block_height,
    `INCB mint ${snapshotId} canonical current block height`,
    { positive: true },
  );
  const canonicalSnapshotBlockHeight = canonicalSafeInteger(
    row?.canonical_snapshot_block_height,
    `INCB mint ${snapshotId} canonical snapshot block height`,
    { positive: true },
  );
  const issuedSnapshotBlockHash = canonicalHash(
    row?.snapshot_block_hash,
    `INCB mint ${snapshotId} snapshot block hash`,
  );
  const transactionBlockHash = canonicalHash(
    row?.transaction_block_hash,
    `INCB mint ${snapshotId} transaction block hash`,
  );
  const currentBlockHash = canonicalHash(
    row?.canonical_current_block_hash,
    `INCB mint ${snapshotId} canonical current block hash`,
  );
  const currentPreviousBlockHash = canonicalHash(
    row?.canonical_previous_block_hash,
    `INCB mint ${snapshotId} canonical previous block hash`,
  );
  const canonicalSnapshotBlockHash = canonicalHash(
    row?.canonical_snapshot_block_hash,
    `INCB mint ${snapshotId} canonical snapshot block hash`,
  );
  if (
    row?.transaction_status !== "confirmed" ||
    row?.canonical_current_block !== true ||
    row?.canonical_snapshot_block !== true ||
    transactionBlockHeight !== eventBlockHeight ||
    currentBlockHeight !== eventBlockHeight ||
    canonicalSnapshotBlockHeight !== blockHeight ||
    eventBlockHeight !== blockHeight + 1 ||
    eventBlockHeight >= LEGACY_REFERENCE_CUTOFF_HEIGHT ||
    transactionBlockHash !== currentBlockHash ||
    currentPreviousBlockHash !== canonicalSnapshotBlockHash ||
    canonicalSnapshotBlockHash !== issuedSnapshotBlockHash
  ) {
    throw new Error(
      `INCB mint ${snapshotId} is not an exact confirmed canonical H-1 reference.`,
    );
  }
  const model = String(row?.snapshot_model ?? "").trim();
  const mode = String(row?.snapshot_mode ?? "").trim();
  if (
    model !== INCB_VALUE_SNAPSHOT_MODEL ||
    mode !== INCB_VALUE_SNAPSHOT_MODE
  ) {
    throw new Error(`INCB mint ${snapshotId} has the wrong snapshot model.`);
  }
  const q8Text = String(row?.snapshot_work_network_value_q8 ?? "").trim();
  const decimalText = String(
    row?.snapshot_work_network_value_sats ?? "",
  ).trim();
  const exactQ8 = q8Text
    ? canonicalPositiveIntegerText(
        q8Text,
        `INCB mint ${snapshotId} snapshot Q8`,
      )
    : "";
  const decimalQ8 = decimalText ? q8TextFromDecimal(decimalText) : "";
  if (
    (!exactQ8 && !decimalQ8) ||
    (exactQ8 && decimalQ8 && exactQ8 !== decimalQ8)
  ) {
    throw new Error(`INCB mint ${snapshotId} has no exact WORK Q8 binding.`);
  }
  return {
    blockHash: issuedSnapshotBlockHash,
    blockHeight,
    canonicalSummaryHash: canonicalHash(
      row?.snapshot_canonical_summary_hash,
      `INCB mint ${snapshotId} canonical summary hash`,
    ),
    generatedAt: canonicalTimestamp(
      row?.snapshot_generated_at,
      `INCB mint ${snapshotId} generatedAt`,
    ),
    mode,
    model,
    snapshotId,
    workNetworkValueQ8: exactQ8 || decimalQ8,
  };
}

export function verifiedLegacyIncbSnapshotBindings(
  rows,
  {
    expectedSnapshotIds = EXPECTED_INCB_ORACLE_SNAPSHOT_IDS,
    expectedReferenceCount = EXPECTED_LEGACY_REFERENCE_COUNT,
  } = {},
) {
  if (!Array.isArray(rows) || rows.length !== expectedReferenceCount) {
    throw new Error(
      `Expected ${expectedReferenceCount} legacy INCB snapshot references; found ${rows?.length ?? 0}.`,
    );
  }
  const bindings = new Map();
  for (const row of rows) {
    const binding = bindingFromEventRow(row);
    if (!expectedSnapshotIds.includes(binding.snapshotId)) {
      throw new Error(
        `Legacy INCB reference contains unexpected snapshot ${binding.snapshotId}.`,
      );
    }
    const previous = bindings.get(binding.snapshotId);
    if (
      previous &&
      JSON.stringify(previous) !== JSON.stringify(binding)
    ) {
      throw new Error(
        `Legacy INCB references diverge for snapshot ${binding.snapshotId}.`,
      );
    }
    bindings.set(binding.snapshotId, binding);
  }
  const foundIds = [...bindings.keys()].sort();
  const requiredIds = [...expectedSnapshotIds].sort();
  if (!sameStringArray(foundIds, requiredIds)) {
    throw new Error("Legacy INCB references do not cover the exact pinned snapshot set.");
  }
  return bindings;
}

function jsonPathValue(object, path) {
  let value = object;
  for (const key of path) {
    if (!plainObject(value)) return undefined;
    value = value[key];
  }
  return value;
}

function legacyWorkValueEvidenceSql(payloadExpression) {
  const evidenceEntry = (path) => {
    const jsonPath = `{${path.join(",")}}`;
    return `
      jsonb_build_object(
        'type',
        jsonb_typeof(${payloadExpression} #> '${jsonPath}'),
        'text',
        ${payloadExpression} #>> '${jsonPath}'
      )
    `;
  };
  const evidenceArray = (paths) =>
    `jsonb_build_array(${paths.map(evidenceEntry).join(",")})`;
  return `
    jsonb_build_object(
      'models',
      ${evidenceArray(LEGACY_WORK_VALUE_MODEL_PATHS)},
      'decimals',
      ${evidenceArray(LEGACY_WORK_VALUE_DECIMAL_PATHS)},
      'q8',
      ${evidenceArray(LEGACY_WORK_VALUE_Q8_PATHS)}
    )
  `;
}

function exactLegacyEvidenceEntries(row, key, expectedLength) {
  const evidence = plainObject(row.exactLegacyWorkValueEvidence);
  if (!evidence) return null;
  const entries = evidence[key];
  if (!Array.isArray(entries) || entries.length !== expectedLength) {
    throw new Error(
      `Snapshot ${row.snapshotId ?? row.snapshot_id ?? "unknown"} has malformed exact legacy ${key} evidence.`,
    );
  }
  return entries.map((entry) => {
    const object = plainObject(entry);
    if (!object) {
      throw new Error(
        `Snapshot ${row.snapshotId ?? row.snapshot_id ?? "unknown"} has malformed exact legacy ${key} evidence.`,
      );
    }
    return {
      text: object.text === null || object.text === undefined
        ? null
        : String(object.text),
      type: object.type === null || object.type === undefined
        ? null
        : String(object.type),
    };
  });
}

function exactLegacyWorkNetworkValueQ8(row, binding) {
  const exactModels = exactLegacyEvidenceEntries(
    row,
    "models",
    LEGACY_WORK_VALUE_MODEL_PATHS.length,
  );
  const modelMarkerPresent = exactModels
    ? exactModels.some(({ text, type }) => {
        if (type === null && text === null) return false;
        if (type !== "string" || text === null) return true;
        return text.trim().length > 0;
      })
    : LEGACY_WORK_VALUE_MODEL_PATHS.some((path) =>
        String(jsonPathValue(row.payload, path) ?? "").trim().length > 0
      );
  if (modelMarkerPresent) {
    throw new Error(
      `Snapshot ${binding.snapshotId} is not a legacy exact WORK-value row.`,
    );
  }
  const exactDecimals = exactLegacyEvidenceEntries(
    row,
    "decimals",
    LEGACY_WORK_VALUE_DECIMAL_PATHS.length,
  );
  const decimalValues = exactDecimals
    ? exactDecimals
        .filter(({ text, type }) => type !== null || text !== null)
        .map(({ text, type }) => {
          if (
            (type !== "number" && type !== "string") ||
            text === null ||
            !q8TextFromDecimal(text)
          ) {
            throw new Error(
              `Snapshot ${binding.snapshotId} has malformed exact legacy decimal WORK evidence.`,
            );
          }
          return text;
        })
    : LEGACY_WORK_VALUE_DECIMAL_PATHS
        .map((path) => jsonPathValue(row.payload, path))
        .filter(
          (value) =>
            value !== undefined &&
            value !== null &&
            value !== "",
        );
  if (
    decimalValues.length === 0 ||
    decimalValues.some(
      (value) => typeof value !== "string" || !q8TextFromDecimal(value),
    )
  ) {
    throw new Error(
      `Snapshot ${binding.snapshotId} has no exact legacy decimal WORK value.`,
    );
  }
  const decimalQ8 = decimalValues.map((value) => q8TextFromDecimal(value));
  if (decimalQ8.some((value) => value !== binding.workNetworkValueQ8)) {
    throw new Error(
      `Snapshot ${binding.snapshotId} legacy decimal does not match its mint Q8 binding.`,
    );
  }
  const exactQ8Entries = exactLegacyEvidenceEntries(
    row,
    "q8",
    LEGACY_WORK_VALUE_Q8_PATHS.length,
  );
  const q8Values = exactQ8Entries
    ? exactQ8Entries
        .filter(({ text, type }) => type !== null || text !== null)
        .map(({ text, type }) => {
          if (
            (type !== "number" && type !== "string") ||
            text === null
          ) {
            throw new Error(
              `Snapshot ${binding.snapshotId} has malformed exact Q8 evidence.`,
            );
          }
          return text;
        })
    : LEGACY_WORK_VALUE_Q8_PATHS
        .map((path) => jsonPathValue(row.payload, path))
        .filter(
          (value) =>
            value !== undefined &&
            value !== null &&
            value !== "",
        );
  for (const value of q8Values) {
    if (
      canonicalPositiveIntegerText(
        value,
        `snapshot ${binding.snapshotId} Q8 alias`,
      ) !== binding.workNetworkValueQ8
    ) {
      throw new Error(
        `Snapshot ${binding.snapshotId} has a divergent Q8 alias.`,
      );
    }
  }
  return {
    mode: LEGACY_WORK_VALUE_MODE,
    valueQ8: binding.workNetworkValueQ8,
  };
}

export function verifyIncbOracleSnapshotRow(row, binding) {
  if (!plainObject(row) || !plainObject(binding)) {
    throw new Error("Snapshot row and binding are required.");
  }
  const snapshotId = canonicalSnapshotId(
    row.snapshotId ?? row.snapshot_id,
    "candidate snapshot id",
  );
  if (snapshotId !== binding.snapshotId || row.network !== NETWORK) {
    throw new Error(`Snapshot ${snapshotId} has the wrong row identity.`);
  }
  const sourceHashes = plainObject(row.sourceHashes ?? row.source_hashes);
  const consistency = plainObject(row.consistency);
  const payload = plainObject(row.payload);
  const workFloor = plainObject(
    payload?.summaryPayloads?.workFloor,
  );
  const summaryRefresh = plainObject(payload?.summaryRefresh);
  if (
    !sourceHashes ||
    !consistency ||
    !payload ||
    !workFloor ||
    !summaryRefresh
  ) {
    throw new Error(`Snapshot ${snapshotId} is missing canonical nested state.`);
  }
  const generatedAt = canonicalTimestamp(
    row.generatedAt ?? row.generated_at,
    `snapshot ${snapshotId} generatedAt`,
  );
  const indexedThroughBlock = canonicalSafeInteger(
    row.indexedThroughBlock ?? row.indexed_through_block,
    `snapshot ${snapshotId} indexed height`,
    { positive: true },
  );
  const blockHashes = [
    sourceHashes.blockScan,
    payload.indexedThroughBlockHash,
    summaryRefresh.indexedThroughBlockHash,
    workFloor.indexedThroughBlockHash,
  ].map((value, index) =>
    canonicalHash(value, `snapshot ${snapshotId} block hash ${index + 1}`)
  );
  const nestedHeights = [
    payload.indexedThroughBlock,
    summaryRefresh.indexedThroughBlock,
    workFloor.indexedThroughBlock,
  ].map((value, index) =>
    canonicalSafeInteger(
      value,
      `snapshot ${snapshotId} nested height ${index + 1}`,
      { positive: true },
    )
  );
  const nestedSnapshotIds = [
    payload.snapshotId,
    workFloor.snapshotId,
  ].map((value) => String(value ?? "").trim());
  const payloadGeneratedAt = canonicalTimestamp(
    payload.generatedAt,
    `snapshot ${snapshotId} payload generatedAt`,
  );
  if (
    consistency.ok !== true ||
    String(consistency.status ?? payload.status ?? "") !== "green" ||
    payload.ok !== true ||
    payload.status !== "green" ||
    payload.network !== NETWORK ||
    workFloor.network !== NETWORK ||
    summaryRefresh.mode !== INCB_VALUE_SNAPSHOT_MODE ||
    generatedAt !== binding.generatedAt ||
    payloadGeneratedAt !== generatedAt ||
    indexedThroughBlock !== binding.blockHeight ||
    nestedHeights.some((height) => height !== binding.blockHeight) ||
    blockHashes.some((hash) => hash !== binding.blockHash) ||
    nestedSnapshotIds.some((id) => id !== snapshotId) ||
    canonicalHash(
      sourceHashes.canonicalSummary,
      `snapshot ${snapshotId} canonical summary hash`,
    ) !== binding.canonicalSummaryHash
  ) {
    throw new Error(
      `Snapshot ${snapshotId} does not match its immutable INCB mint binding.`,
    );
  }
  const workNetworkValue = exactLegacyWorkNetworkValueQ8(
    {
      ...row,
      payload,
    },
    binding,
  );
  return {
    canonicalSummaryHash: binding.canonicalSummaryHash,
    consistencyOk: true,
    consistencyStatus: "green",
    generatedAt,
    indexedThroughBlock,
    payloadBlockHash: binding.blockHash,
    payloadSnapshotId: snapshotId,
    snapshotId,
    sourceBlockHash: binding.blockHash,
    summaryRefreshBlockHash: binding.blockHash,
    summaryRefreshMode: INCB_VALUE_SNAPSHOT_MODE,
    workFloorBlockHash: binding.blockHash,
    workFloorHeight: binding.blockHeight,
    workFloorSnapshotId: snapshotId,
    workNetworkValueMode: workNetworkValue.mode,
    workNetworkValueQ8: workNetworkValue.valueQ8,
  };
}

function rawRowFingerprint(row) {
  return incbReplayRawSnapshotFingerprint({
    consistencyJson: row.rawConsistencyJson,
    generatedAt: row.generatedAt,
    indexedThroughBlock: row.indexedThroughBlock,
    metricsJson: row.rawMetricsJson,
    payloadJson: row.rawPayloadJson,
    snapshotId: row.snapshotId,
    sourceHashesJson: row.rawSourceHashesJson,
  });
}

async function canonicalizeCandidateJson(client, row) {
  const normalized = await client.query(
    `
      WITH candidate AS (
        SELECT
          $1::jsonb AS source_hashes,
          $2::jsonb AS metrics,
          $3::jsonb AS consistency,
          $4::jsonb AS payload
      )
      SELECT
        source_hashes::text AS source_hashes_json,
        metrics::text AS metrics_json,
        consistency::text AS consistency_json,
        payload::text AS payload_json,
        ${legacyWorkValueEvidenceSql("payload")}
          AS legacy_work_value_evidence
      FROM candidate
    `,
    [
      row.rawSourceHashesJson,
      row.rawMetricsJson,
      row.rawConsistencyJson,
      row.rawPayloadJson,
    ],
  );
  const canonical = normalized.rows[0] ?? {};
  return {
    ...row,
    exactLegacyWorkValueEvidence:
      canonical.legacy_work_value_evidence,
    rawConsistencyJson: String(canonical.consistency_json ?? ""),
    rawMetricsJson: String(canonical.metrics_json ?? ""),
    rawPayloadJson: String(canonical.payload_json ?? ""),
    rawSourceHashesJson: String(canonical.source_hashes_json ?? ""),
  };
}

const LEGACY_REFERENCE_SQL = `
  SELECT
    event_row.event_id,
    event_row.txid,
    event_row.block_height,
    event_tx.status AS transaction_status,
    event_tx.block_height AS transaction_block_height,
    lower(event_tx.block_hash) AS transaction_block_hash,
    current_block.canonical AS canonical_current_block,
    current_block.height AS canonical_current_block_height,
    lower(current_block.block_hash) AS canonical_current_block_hash,
    lower(current_block.previous_block_hash)
      AS canonical_previous_block_hash,
    snapshot_block.canonical AS canonical_snapshot_block,
    snapshot_block.height AS canonical_snapshot_block_height,
    lower(snapshot_block.block_hash) AS canonical_snapshot_block_hash,
    event_row.payload->>'issuanceValueSnapshotId' AS snapshot_id,
    event_row.payload->>'issuanceValueSnapshotBlockHeight'
      AS snapshot_block_height,
    event_row.payload->>'issuanceValueSnapshotBlockHash'
      AS snapshot_block_hash,
    event_row.payload->>'issuanceValueSnapshotCanonicalSummaryHash'
      AS snapshot_canonical_summary_hash,
    event_row.payload->>'issuanceValueSnapshotGeneratedAt'
      AS snapshot_generated_at,
    event_row.payload->>'issuanceValueSnapshotModel' AS snapshot_model,
    event_row.payload->>'issuanceValueSnapshotMode' AS snapshot_mode,
    event_row.payload->>'issuanceValueSnapshotWorkNetworkValueSats'
      AS snapshot_work_network_value_sats,
    event_row.payload->>'issuanceValueSnapshotWorkNetworkValueQ8'
      AS snapshot_work_network_value_q8
  FROM proof_indexer.events event_row
  JOIN proof_indexer.transactions event_tx
    ON event_tx.network = event_row.network
   AND event_tx.txid = event_row.txid
   AND event_tx.status = 'confirmed'
   AND event_tx.block_height = event_row.block_height
   AND event_tx.block_index = event_row.block_index
  JOIN proof_indexer.blocks current_block
    ON current_block.network = event_tx.network
   AND current_block.block_hash = event_tx.block_hash
   AND current_block.height = event_tx.block_height
   AND current_block.canonical = true
  JOIN proof_indexer.blocks snapshot_block
    ON snapshot_block.network = current_block.network
   AND snapshot_block.height = current_block.height - 1
   AND snapshot_block.canonical = true
  WHERE event_row.network = $1
    AND event_row.protocol = 'pwt1'
    AND event_row.kind = 'token-mint'
    AND event_row.status = 'confirmed'
    AND event_row.valid = true
    AND event_row.block_height < $2
    AND lower(COALESCE(event_row.payload->>'tokenId', '')) = $3
    AND COALESCE(event_row.payload->>'issuanceValueSnapshotId', '') <> ''
  ORDER BY
    event_row.block_height,
    event_row.block_index,
    event_row.op_return_vout,
    event_row.record_ordinal,
    event_row.event_id
`;

const REFERENCE_COVERAGE_SQL = `
  WITH refs AS MATERIALIZED (
    SELECT DISTINCT
      event_row.payload->>'issuanceValueSnapshotId' AS snapshot_id
    FROM proof_indexer.events event_row
    JOIN proof_indexer.transactions event_tx
      ON event_tx.network = event_row.network
     AND event_tx.txid = event_row.txid
     AND event_tx.status = 'confirmed'
     AND event_tx.block_height = event_row.block_height
     AND event_tx.block_index = event_row.block_index
    JOIN proof_indexer.blocks current_block
      ON current_block.network = event_tx.network
     AND current_block.block_hash = event_tx.block_hash
     AND current_block.height = event_tx.block_height
     AND current_block.canonical = true
    WHERE event_row.network = $1
      AND event_row.protocol = 'pwt1'
      AND event_row.kind = 'token-mint'
      AND event_row.status = 'confirmed'
      AND event_row.valid = true
      AND lower(COALESCE(event_row.payload->>'tokenId', '')) = $2
      AND COALESCE(
        event_row.payload->>'issuanceValueSnapshotId',
        ''
      ) <> ''
  )
  SELECT
    count(*)::integer AS referenced_ids,
    COALESCE(
      array_agg(refs.snapshot_id ORDER BY refs.snapshot_id)
        FILTER (WHERE snapshot.snapshot_id IS NULL),
      ARRAY[]::text[]
    ) AS unresolved_ids
  FROM refs
  LEFT JOIN proof_indexer.ledger_snapshots snapshot
    ON snapshot.network = $1
   AND snapshot.snapshot_id = refs.snapshot_id
`;

const SNAPSHOT_ROWS_SQL = `
  SELECT
    network,
    snapshot_id,
    generated_at,
    indexed_through_block,
    source_hashes,
    metrics,
    consistency,
    payload,
    ${legacyWorkValueEvidenceSql("payload")}
      AS legacy_work_value_evidence,
    source_hashes::text AS raw_source_hashes_json,
    metrics::text AS raw_metrics_json,
    consistency::text AS raw_consistency_json,
    payload::text AS raw_payload_json
  FROM proof_indexer.ledger_snapshots
  WHERE network = $1
    AND snapshot_id = ANY($2::text[])
  ORDER BY snapshot_id
  FOR UPDATE
`;

const CANONICAL_RECOVERY_META_SQL = `
  SELECT key, value
  FROM proof_indexer.meta
  WHERE key = ANY($1::text[])
  ORDER BY key
  FOR UPDATE
`;

function storedSnapshotRow(row) {
  return {
    consistency: row.consistency,
    generatedAt: canonicalTimestamp(
      row.generated_at,
      `stored snapshot ${row.snapshot_id} generated_at`,
    ),
    indexedThroughBlock: Number(row.indexed_through_block),
    metrics: row.metrics,
    network: row.network,
    payload: row.payload,
    exactLegacyWorkValueEvidence: row.legacy_work_value_evidence,
    rawConsistencyJson: String(row.raw_consistency_json ?? ""),
    rawMetricsJson: String(row.raw_metrics_json ?? ""),
    rawPayloadJson: String(row.raw_payload_json ?? ""),
    rawSourceHashesJson: String(row.raw_source_hashes_json ?? ""),
    snapshotId: String(row.snapshot_id ?? ""),
    sourceHashes: row.source_hashes,
  };
}

export function verifiedCanonicalRecoveryMetaState(rows) {
  if (!Array.isArray(rows)) {
    throw new Error("Canonical recovery metadata rows are required.");
  }
  const values = new Map();
  for (const row of rows) {
    const key = String(row?.key ?? "");
    if (
      ![CANONICAL_REBUILD_META_KEY, CANONICAL_FAULT_META_KEY].includes(key) ||
      values.has(key) ||
      !plainObject(row?.value)
    ) {
      throw new Error("Canonical recovery metadata is malformed or ambiguous.");
    }
    values.set(key, row.value);
  }

  const fault = values.get(CANONICAL_FAULT_META_KEY);
  if (fault) {
    if (fault.network !== NETWORK || typeof fault.active !== "boolean") {
      throw new Error("Canonical fault metadata is malformed.");
    }
    if (fault.active) {
      throw new Error(
        "INCB oracle snapshot restore is blocked by an active canonical fault.",
      );
    }
  }

  const rebuild = values.get(CANONICAL_REBUILD_META_KEY);
  if (!rebuild) {
    return {
      fault: fault ? "inactive" : "absent",
      rebuild: "absent",
    };
  }
  const indexedThroughBlock = Number(rebuild.indexedThroughBlock);
  if (
    rebuild.network !== NETWORK ||
    rebuild.active !== false ||
    rebuild.complete !== true ||
    rebuild.status !== "complete" ||
    !Number.isFinite(Date.parse(String(rebuild.completedAt ?? ""))) ||
    !Number.isSafeInteger(indexedThroughBlock) ||
    indexedThroughBlock <= 0
  ) {
    throw new Error(
      "INCB oracle snapshot restore requires an inactive completed canonical rebuild state.",
    );
  }
  canonicalHash(
    rebuild.indexedThroughBlockHash,
    "completed canonical rebuild indexed-through hash",
  );

  if (rebuild.mode === "pwt-range-replay") {
    const verifierBinding = plainObject(rebuild.verifierBinding);
    const verification = plainObject(
      rebuild.incbRangeReplayVerification,
    );
    const rangeReplayFromHeight = Number(rebuild.rangeReplayFromHeight);
    if (
      !verifierBinding ||
      !verification ||
      verifierBinding.model !==
        PWT_RANGE_REPLAY_VERIFIER_BINDING_MODEL ||
      verifierBinding.network !== NETWORK ||
      verification.verified !== true ||
      !Number.isSafeInteger(rangeReplayFromHeight) ||
      rangeReplayFromHeight <= 0 ||
      Number(verifierBinding.rangeReplayFromHeight) !==
        rangeReplayFromHeight
    ) {
      throw new Error(
        "INCB oracle snapshot restore requires a certified completed PWT range replay.",
      );
    }
    canonicalHash(
      verifierBinding.bindingId,
      "completed PWT range replay binding id",
    );
    canonicalHash(
      verifierBinding.witnessSetHash,
      "completed PWT range replay witness-set hash",
    );
  } else if (
    rebuild.mode !== undefined &&
    rebuild.mode !== null &&
    String(rebuild.mode).trim() !== ""
  ) {
    throw new Error("Canonical rebuild metadata has an unsupported mode.");
  }

  return {
    fault: fault ? "inactive" : "absent",
    rebuild: rebuild.mode === "pwt-range-replay"
      ? "certified-complete-pwt-range-replay"
      : "complete",
  };
}

export function classifyIncbOracleRecoveryState({
  actualFingerprints,
  expectedFingerprints,
  existingSnapshotIds,
  unresolvedSnapshotIds,
  expectedSnapshotIds = EXPECTED_INCB_ORACLE_SNAPSHOT_IDS,
}) {
  const expected = [...expectedSnapshotIds].sort();
  const existing = sortedUnique(existingSnapshotIds);
  const unresolved = sortedUnique(unresolvedSnapshotIds);
  if (existing.length === 0) {
    if (!sameStringArray(unresolved, expected)) {
      throw new Error(
        "First apply requires exactly all 18 pinned snapshots to be absent and unresolved.",
      );
    }
    return "first-apply";
  }
  if (!sameStringArray(existing, expected) || unresolved.length !== 0) {
    throw new Error(
      "Recovery state is partial or mixed; only fully absent or fully identical is allowed.",
    );
  }
  for (const snapshotId of expected) {
    if (
      actualFingerprints.get(snapshotId) !==
      expectedFingerprints.get(snapshotId)
    ) {
      throw new Error(
        `Existing snapshot ${snapshotId} is not byte-identical to the pinned artifact.`,
      );
    }
  }
  return "already-applied";
}

async function referenceCoverage(client) {
  const result = await client.query(REFERENCE_COVERAGE_SQL, [
    NETWORK,
    INCB_TOKEN_ID,
  ]);
  const row = result.rows[0] ?? {};
  return {
    referencedIds: Number(row.referenced_ids ?? 0),
    unresolvedIds: sortedUnique(
      Array.isArray(row.unresolved_ids) ? row.unresolved_ids : [],
    ),
  };
}

async function readStoredSnapshots(client) {
  const result = await client.query(SNAPSHOT_ROWS_SQL, [
    NETWORK,
    EXPECTED_INCB_ORACLE_SNAPSHOT_IDS,
  ]);
  return result.rows.map(storedSnapshotRow);
}

async function readCanonicalRecoveryMetaState(client) {
  const result = await client.query(CANONICAL_RECOVERY_META_SQL, [[
    CANONICAL_REBUILD_META_KEY,
    CANONICAL_FAULT_META_KEY,
  ]]);
  return verifiedCanonicalRecoveryMetaState(result.rows);
}

async function insertSnapshot(client, row) {
  const result = await client.query(
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
      VALUES (
        $1,
        $2,
        $3::timestamptz,
        $4,
        $5::jsonb,
        $6::jsonb,
        $7::jsonb,
        $8::jsonb
      )
      RETURNING snapshot_id
    `,
    [
      row.network,
      row.snapshotId,
      row.generatedAt,
      row.indexedThroughBlock,
      row.rawSourceHashesJson,
      row.rawMetricsJson,
      row.rawConsistencyJson,
      row.rawPayloadJson,
    ],
  );
  if (
    result.rowCount !== 1 ||
    result.rows[0]?.snapshot_id !== row.snapshotId
  ) {
    throw new Error(`Failed to insert exact snapshot ${row.snapshotId}.`);
  }
}

export async function restoreIncbOracleSnapshots({
  apply = false,
  artifactPath,
  artifactSha256,
  expectedArtifactSha256 =
    RESTORE_INCB_ORACLE_SNAPSHOTS_ARTIFACT_SHA256,
  pool: suppliedPool,
}) {
  const databaseUrl = suppliedPool
    ? ""
    : requiredIncbOracleRestoreDatabaseUrl();
  const artifact = await loadIncbOracleSnapshotArtifact(
    artifactPath,
    artifactSha256,
    { expectedArtifactSha256 },
  );
  const pool = suppliedPool ?? createProofIndexPool({
    connectionString: databaseUrl,
    env: {
      ...process.env,
      POW_INDEX_DB_APP_NAME: "restore-incb-oracle-snapshots",
      POW_INDEX_DB_POOL_MAX: "1",
    },
  });
  const ownsPool = !suppliedPool;
  let client = null;
  let transactionOpen = false;
  try {
    client = await pool.connect();
    await client.query("BEGIN ISOLATION LEVEL SERIALIZABLE");
    transactionOpen = true;
    await client.query("SET LOCAL lock_timeout = '10s'");
    await client.query("SET LOCAL statement_timeout = '15min'");
    await client.query(
      "SELECT pg_advisory_xact_lock(hashtextextended($1, 0))",
      [ADVISORY_LOCK_KEY],
    );
    await client.query(`
      LOCK TABLE
        proof_indexer.blocks,
        proof_indexer.events,
        proof_indexer.ledger_snapshots,
        proof_indexer.meta,
        proof_indexer.transactions
      IN SHARE ROW EXCLUSIVE MODE
    `);
    const canonicalRecoveryMeta =
      await readCanonicalRecoveryMetaState(client);

    const legacyReferences = await client.query(LEGACY_REFERENCE_SQL, [
      NETWORK,
      LEGACY_REFERENCE_CUTOFF_HEIGHT,
      INCB_TOKEN_ID,
    ]);
    const bindings = verifiedLegacyIncbSnapshotBindings(
      legacyReferences.rows,
    );

    const candidates = new Map();
    const expectedFingerprints = new Map();
    for (const snapshotId of EXPECTED_INCB_ORACLE_SNAPSHOT_IDS) {
      const rawCandidate = artifact.rows.get(snapshotId);
      const candidate = await canonicalizeCandidateJson(client, rawCandidate);
      verifyIncbOracleSnapshotRow(candidate, bindings.get(snapshotId));
      const fingerprint = rawRowFingerprint(candidate);
      candidates.set(snapshotId, candidate);
      expectedFingerprints.set(snapshotId, fingerprint);
    }

    const coverageBefore = await referenceCoverage(client);
    if (coverageBefore.referencedIds !== EXPECTED_ALL_REFERENCE_ID_COUNT) {
      throw new Error(
        `Expected ${EXPECTED_ALL_REFERENCE_ID_COUNT} referenced INCB snapshot ids; found ${coverageBefore.referencedIds}.`,
      );
    }
    const storedBefore = await readStoredSnapshots(client);
    const actualFingerprints = new Map();
    for (const row of storedBefore) {
      const binding = bindings.get(row.snapshotId);
      verifyIncbOracleSnapshotRow(row, binding);
      actualFingerprints.set(row.snapshotId, rawRowFingerprint(row));
    }
    const state = classifyIncbOracleRecoveryState({
      actualFingerprints,
      existingSnapshotIds: storedBefore.map((row) => row.snapshotId),
      expectedFingerprints,
      unresolvedSnapshotIds: coverageBefore.unresolvedIds,
    });

    let inserted = 0;
    if (apply && state === "first-apply") {
      for (const snapshotId of EXPECTED_INCB_ORACLE_SNAPSHOT_IDS) {
        await insertSnapshot(client, candidates.get(snapshotId));
        inserted += 1;
      }
    }
    if (!apply) {
      await client.query("ROLLBACK");
      transactionOpen = false;
      return {
        apply: false,
        artifact: {
          bytes: artifact.bytes,
          path: artifact.path,
          rows: artifact.rows.size,
          sha256: artifact.sha256,
        },
        committed: false,
        canonicalRecoveryMeta,
        expectedSnapshotIds: EXPECTED_INCB_ORACLE_SNAPSHOT_IDS,
        fingerprints: [...expectedFingerprints]
          .map(([snapshotId, sha256]) => ({ sha256, snapshotId })),
        inserted: 0,
        model: RESTORE_INCB_ORACLE_SNAPSHOTS_MODEL,
        ok: true,
        referencedIds: coverageBefore.referencedIds,
        state,
        targetReferences: legacyReferences.rows.length,
        unresolvedBefore: coverageBefore.unresolvedIds,
        wouldInsert: state === "first-apply"
          ? EXPECTED_INCB_ORACLE_SNAPSHOT_IDS.length
          : 0,
      };
    }

    const coverageAfter = await referenceCoverage(client);
    if (
      coverageAfter.referencedIds !== EXPECTED_ALL_REFERENCE_ID_COUNT ||
      coverageAfter.unresolvedIds.length !== 0
    ) {
      throw new Error(
        "Selective restore did not resolve all 29 referenced INCB snapshot ids.",
      );
    }
    const finalLegacyReferences = await client.query(LEGACY_REFERENCE_SQL, [
      NETWORK,
      LEGACY_REFERENCE_CUTOFF_HEIGHT,
      INCB_TOKEN_ID,
    ]);
    verifiedLegacyIncbSnapshotBindings(finalLegacyReferences.rows);
    const storedAfter = await readStoredSnapshots(client);
    if (storedAfter.length !== EXPECTED_INCB_ORACLE_SNAPSHOT_IDS.length) {
      throw new Error("Selective restore did not leave all 18 exact snapshot rows.");
    }
    for (const row of storedAfter) {
      verifyIncbOracleSnapshotRow(row, bindings.get(row.snapshotId));
      if (
        rawRowFingerprint(row) !== expectedFingerprints.get(row.snapshotId)
      ) {
        throw new Error(
          `Stored snapshot ${row.snapshotId} changed from its artifact fingerprint.`,
        );
      }
    }
    await client.query("COMMIT");
    transactionOpen = false;
    return {
      apply: true,
      artifact: {
        bytes: artifact.bytes,
        path: artifact.path,
        rows: artifact.rows.size,
        sha256: artifact.sha256,
      },
      committed: true,
      canonicalRecoveryMeta,
      expectedSnapshotIds: EXPECTED_INCB_ORACLE_SNAPSHOT_IDS,
      fingerprints: [...expectedFingerprints]
        .map(([snapshotId, sha256]) => ({ sha256, snapshotId })),
      inserted,
      model: RESTORE_INCB_ORACLE_SNAPSHOTS_MODEL,
      ok: true,
      referencedIds: coverageAfter.referencedIds,
      state,
      targetReferences: finalLegacyReferences.rows.length,
      unresolvedAfter: coverageAfter.unresolvedIds,
      unresolvedBefore: coverageBefore.unresolvedIds,
      wouldInsert: 0,
    };
  } catch (error) {
    if (transactionOpen && client) {
      try {
        await client.query("ROLLBACK");
      } catch (rollbackError) {
        error.message =
          `${error.message}; rollback failed: ${rollbackError.message}`;
      }
    }
    throw error;
  } finally {
    if (client) client.release();
    if (ownsPool) await pool.end();
  }
}

export function parseRestoreIncbOracleSnapshotArgs(
  argv = process.argv.slice(2),
  env = process.env,
) {
  let apply = false;
  let artifactPath = "";
  let artifactSha256 = "";
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--apply") {
      apply = true;
      continue;
    }
    if (argument === "--artifact" || argument === "--sha256") {
      const value = String(argv[index + 1] ?? "").trim();
      if (!value) throw new Error(`${argument} requires a value.`);
      index += 1;
      if (argument === "--artifact") artifactPath = value;
      else artifactSha256 = value;
      continue;
    }
    if (argument.startsWith("--artifact=")) {
      artifactPath = argument.slice("--artifact=".length);
      continue;
    }
    if (argument.startsWith("--sha256=")) {
      artifactSha256 = argument.slice("--sha256=".length);
      continue;
    }
    throw new Error(`Unknown recovery argument: ${argument}`);
  }
  if (!artifactPath || !artifactSha256) {
    throw new Error("--artifact and --sha256 are both required.");
  }
  if (
    apply &&
    String(env[RESTORE_INCB_ORACLE_SNAPSHOTS_APPLY_ENV] ?? "") !== "1"
  ) {
    throw new Error(
      `--apply requires ${RESTORE_INCB_ORACLE_SNAPSHOTS_APPLY_ENV}=1.`,
    );
  }
  if (
    env.NETWORK !== undefined &&
    String(env.NETWORK).trim() !== NETWORK
  ) {
    throw new Error("INCB oracle snapshot restore is pinned to livenet.");
  }
  requiredIncbOracleRestoreDatabaseUrl(env);
  return {
    apply,
    artifactPath,
    artifactSha256,
  };
}

async function main() {
  const args = parseRestoreIncbOracleSnapshotArgs();
  const result = await restoreIncbOracleSnapshots(args);
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}

const executedPath = process.argv[1]
  ? pathToFileURL(resolve(process.argv[1])).href
  : "";
if (executedPath === import.meta.url) {
  main().catch((error) => {
    process.stderr.write(`${JSON.stringify({
      error: error?.message ?? String(error),
      model: RESTORE_INCB_ORACLE_SNAPSHOTS_MODEL,
      ok: false,
    })}\n`);
    process.exitCode = 1;
  });
}
