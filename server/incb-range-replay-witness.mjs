import { createHash } from "node:crypto";

export const INCB_RANGE_REPLAY_WITNESS_MANIFEST_MODEL =
  "canonical-incb-range-replay-witness-set-v1";
export const INCB_RANGE_REPLAY_WITNESS_COMMITMENT_MODEL =
  "sha256-canonical-json-v1";
export const INCB_RANGE_REPLAY_WITNESS_META_PREFIX =
  "canonical:incb-range-replay-witness:";
export const INCB_RANGE_REPLAY_BOUND_WITNESS_SOURCE =
  "proof-indexer-canonical-incb-bound-witnesses-v1";
export const INCB_RANGE_REPLAY_EXACT_MINT_LEGACY_SNAPSHOT_MODE =
  "exact-mint-q8-bound-to-legacy-green-snapshot-v1";

const HASH_PATTERN = /^[0-9a-f]{64}$/u;
const POSITIVE_INTEGER_PATTERN = /^[1-9][0-9]*$/u;
const NON_NEGATIVE_INTEGER_PATTERN = /^(?:0|[1-9][0-9]*)$/u;
const PRESERVE_DISPOSITION = "preserve";
const REDERIVE_DISPOSITION = "rederive";
const VALID_DISPOSITIONS = new Set([
  PRESERVE_DISPOSITION,
  REDERIVE_DISPOSITION,
]);
const VALID_WORK_VALUE_WITNESS_MODES = new Set([
  "canonical-exact-work-network-q8-v1",
  "locked-bound-legacy-work-value-v1",
  INCB_RANGE_REPLAY_EXACT_MINT_LEGACY_SNAPSHOT_MODE,
]);

function plainObject(value) {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value
    : null;
}

function canonicalHash(value, label) {
  const text = String(value ?? "").trim().toLowerCase();
  if (!HASH_PATTERN.test(text)) {
    throw new Error(`${label} must be a canonical 32-byte lowercase hash.`);
  }
  return text;
}

function canonicalText(value, label) {
  const text = String(value ?? "").trim();
  if (!text) {
    throw new Error(`${label} must be nonempty.`);
  }
  return text;
}

function canonicalInteger(value, label, { positive = false } = {}) {
  const text = String(value ?? "").trim();
  const pattern = positive
    ? POSITIVE_INTEGER_PATTERN
    : NON_NEGATIVE_INTEGER_PATTERN;
  if (!pattern.test(text)) {
    throw new Error(`${label} must be a canonical integer string.`);
  }
  return text;
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

function canonicalIsoDate(value, label) {
  const text = canonicalText(value, label);
  const timestamp = Date.parse(text);
  if (!Number.isFinite(timestamp)) {
    throw new Error(`${label} must be an ISO timestamp.`);
  }
  const iso = new Date(timestamp).toISOString();
  if (iso !== text) {
    throw new Error(`${label} must use canonical ISO formatting.`);
  }
  return iso;
}

function canonicalJsonValue(value, path = "value") {
  if (value === null || typeof value === "string" || typeof value === "boolean") {
    return value;
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new Error(`${path} contains a non-finite number.`);
    }
    return value;
  }
  if (typeof value === "bigint") {
    return value.toString();
  }
  if (Array.isArray(value)) {
    return value.map((item, index) =>
      canonicalJsonValue(item, `${path}[${index}]`)
    );
  }
  const object = plainObject(value);
  if (!object) {
    throw new Error(`${path} is not canonical JSON data.`);
  }
  const result = {};
  for (const key of Object.keys(object).sort()) {
    if (object[key] === undefined) {
      throw new Error(`${path}.${key} is undefined.`);
    }
    result[key] = canonicalJsonValue(object[key], `${path}.${key}`);
  }
  return result;
}

export function canonicalIncbReplayJson(value) {
  return JSON.stringify(canonicalJsonValue(value));
}

export function canonicalIncbReplaySha256(value) {
  return createHash("sha256")
    .update(canonicalIncbReplayJson(value))
    .digest("hex");
}

export function incbRangeReplayWitnessMetaKey(network, bindingId) {
  const canonicalNetwork = canonicalText(network, "manifest network")
    .toLowerCase();
  const canonicalBindingId = canonicalHash(bindingId, "manifest binding id");
  return `${INCB_RANGE_REPLAY_WITNESS_META_PREFIX}${canonicalNetwork}:${canonicalBindingId}`;
}

export function incbReplayRawSnapshotFingerprint(value) {
  const source = plainObject(value);
  if (!source) {
    throw new Error("Preserved INCB raw snapshot material is missing.");
  }
  return canonicalIncbReplaySha256({
    consistencyJson: canonicalText(
      source.consistencyJson,
      "raw snapshot consistency JSON",
    ),
    generatedAt: canonicalIsoDate(
      source.generatedAt,
      "raw snapshot generatedAt",
    ),
    indexedThroughBlock: canonicalSafeInteger(
      source.indexedThroughBlock,
      "raw snapshot indexed height",
      { positive: true },
    ),
    metricsJson: canonicalText(
      source.metricsJson,
      "raw snapshot metrics JSON",
    ),
    payloadJson: canonicalText(
      source.payloadJson,
      "raw snapshot payload JSON",
    ),
    snapshotId: canonicalText(source.snapshotId, "raw snapshot id"),
    sourceHashesJson: canonicalText(
      source.sourceHashesJson,
      "raw snapshot source hashes JSON",
    ),
  });
}

export function normalizeIncbReplaySnapshotDescriptor(value) {
  const source = plainObject(value);
  if (!source) {
    throw new Error("Preserved INCB witness snapshot is missing.");
  }
  const snapshotId = canonicalText(source.snapshotId, "snapshot id");
  const indexedThroughBlock = canonicalSafeInteger(
    source.indexedThroughBlock,
    "snapshot indexed height",
    { positive: true },
  );
  const sourceBlockHash = canonicalHash(
    source.sourceBlockHash,
    "snapshot source block hash",
  );
  const canonicalSummaryHash = canonicalHash(
    source.canonicalSummaryHash,
    "snapshot canonical summary hash",
  );
  const payloadSnapshotId = canonicalText(
    source.payloadSnapshotId,
    "snapshot payload id",
  );
  const payloadBlockHash = canonicalHash(
    source.payloadBlockHash,
    "snapshot payload block hash",
  );
  const summaryRefreshMode = canonicalText(
    source.summaryRefreshMode,
    "snapshot refresh mode",
  );
  const summaryRefreshBlockHash = canonicalHash(
    source.summaryRefreshBlockHash,
    "snapshot refresh block hash",
  );
  const workFloorSnapshotId = canonicalText(
    source.workFloorSnapshotId,
    "snapshot WORK floor id",
  );
  const workFloorHeight = canonicalSafeInteger(
    source.workFloorHeight,
    "snapshot WORK floor height",
    { positive: true },
  );
  const workFloorBlockHash = canonicalHash(
    source.workFloorBlockHash,
    "snapshot WORK floor block hash",
  );
  const workNetworkValueMode = canonicalText(
    source.workNetworkValueMode,
    "snapshot WORK value witness mode",
  );
  const workNetworkValueQ8 = canonicalInteger(
    source.workNetworkValueQ8,
    "snapshot WORK network value Q8",
    { positive: true },
  );
  const rawSnapshotFingerprint = canonicalHash(
    source.rawSnapshotFingerprint,
    "raw snapshot fingerprint",
  );
  if (
    source.consistencyOk !== true ||
    String(source.consistencyStatus ?? "") !== "green" ||
    summaryRefreshMode !== "canonical-summary-refresh" ||
    payloadSnapshotId !== snapshotId ||
    workFloorSnapshotId !== snapshotId ||
    workFloorHeight !== indexedThroughBlock ||
    [payloadBlockHash, summaryRefreshBlockHash, workFloorBlockHash].some(
      (hash) => hash !== sourceBlockHash,
    ) ||
    !VALID_WORK_VALUE_WITNESS_MODES.has(workNetworkValueMode)
  ) {
    throw new Error(
      `Preserved INCB snapshot ${snapshotId} is not one locked green H-1 witness.`,
    );
  }
  return {
    canonicalSummaryHash,
    consistencyOk: true,
    consistencyStatus: "green",
    generatedAt: canonicalIsoDate(source.generatedAt, "snapshot generatedAt"),
    indexedThroughBlock,
    payloadBlockHash,
    payloadSnapshotId,
    rawSnapshotFingerprint,
    snapshotId,
    sourceBlockHash,
    summaryRefreshBlockHash,
    summaryRefreshMode,
    workFloorBlockHash,
    workFloorHeight,
    workFloorSnapshotId,
    workNetworkValueMode,
    workNetworkValueQ8,
  };
}

export function incbReplaySnapshotFingerprint(value) {
  return canonicalIncbReplaySha256(
    normalizeIncbReplaySnapshotDescriptor(value),
  );
}

function normalizeBondDescriptor(value) {
  const source = plainObject(value);
  if (!source) {
    throw new Error("INCB replay witness bond descriptor is missing.");
  }
  const txid = canonicalHash(source.txid, "bond txid");
  const blockHeight = canonicalSafeInteger(
    source.blockHeight,
    "bond block height",
    { positive: true },
  );
  const blockIndex = canonicalSafeInteger(
    source.blockIndex,
    "bond block index",
  );
  const bondRecipientVout = canonicalSafeInteger(
    source.bondRecipientVout,
    "bond recipient vout",
  );
  if (!Array.isArray(source.bondRecipientOutputs) ||
      source.bondRecipientOutputs.length === 0) {
    throw new Error("Bond recipient output commitment is missing.");
  }
  const bondRecipientOutputs = source.bondRecipientOutputs
    .map((output, index) => {
      const candidate = plainObject(output);
      if (!candidate) {
        throw new Error(`Bond recipient output ${index} is malformed.`);
      }
      return {
        amountSats: canonicalInteger(
          candidate.amountSats,
          `bond recipient output ${index} amount`,
          { positive: true },
        ),
        vout: canonicalSafeInteger(
          candidate.vout,
          `bond recipient output ${index} vout`,
        ),
      };
    })
    .sort((left, right) => left.vout - right.vout);
  const outputVouts = new Set(
    bondRecipientOutputs.map((output) => output.vout),
  );
  const outputAmount = bondRecipientOutputs.reduce(
    (total, output) => total + BigInt(output.amountSats),
    0n,
  );
  if (
    outputVouts.size !== bondRecipientOutputs.length ||
    bondRecipientOutputs[0].vout !== bondRecipientVout ||
    outputAmount !== BigInt(String(source.bondRecipientAmountSats ?? ""))
  ) {
    throw new Error(
      "Bond recipient outputs do not reconcile to the first vout and total amount.",
    );
  }
  return {
    attachedWorkAmountAtoms: canonicalInteger(
      source.attachedWorkAmountAtoms,
      "bond attached WORK atoms",
    ),
    blockHash: canonicalHash(source.blockHash, "bond block hash"),
    blockHeight,
    blockIndex,
    bondRecipientAddress: canonicalText(
      source.bondRecipientAddress,
      "bond recipient address",
    ),
    bondRecipientAmountSats: canonicalInteger(
      source.bondRecipientAmountSats,
      "bond recipient amount",
      { positive: true },
    ),
    bondRecipientOutputs,
    bondRecipientVout,
    previousBlockHash: canonicalHash(
      source.previousBlockHash,
      "bond previous block hash",
    ),
    txid,
  };
}

export function incbReplayBondIdentity(value) {
  const source = plainObject(value);
  if (!source) {
    throw new Error("INCB replay witness bond identity is missing.");
  }
  const txid = canonicalHash(source.txid, "bond identity txid");
  const bondRecipientVout = canonicalSafeInteger(
    source.bondRecipientVout,
    "bond identity recipient vout",
  );
  return `${txid}:${bondRecipientVout}`;
}

function normalizeManifestEntry(value) {
  const source = plainObject(value);
  if (!source) {
    throw new Error("INCB replay witness entry is missing.");
  }
  const bond = normalizeBondDescriptor(source.bond);
  const disposition = String(source.disposition ?? "").trim().toLowerCase();
  const reason = canonicalText(source.reason, "witness disposition reason");
  if (!VALID_DISPOSITIONS.has(disposition)) {
    throw new Error("INCB replay witness disposition is invalid.");
  }
  if (disposition === REDERIVE_DISPOSITION) {
    if (
      source.mintPayload != null ||
      source.mintPayloadHash != null ||
      source.snapshot != null ||
      source.snapshotFingerprint != null
    ) {
      throw new Error("A rederive disposition cannot carry preserved state.");
    }
    return { bond, disposition, reason };
  }

  const mintPayload = plainObject(source.mintPayload);
  if (!mintPayload) {
    throw new Error("A preserve disposition requires its exact mint payload.");
  }
  const normalizedMintPayload = canonicalJsonValue(
    mintPayload,
    "witness mint payload",
  );
  const mintPayloadHash = canonicalHash(
    source.mintPayloadHash,
    "mint payload hash",
  );
  if (canonicalIncbReplaySha256(normalizedMintPayload) !== mintPayloadHash) {
    throw new Error("Preserved INCB mint payload commitment does not match.");
  }
  const snapshot = normalizeIncbReplaySnapshotDescriptor(source.snapshot);
  const snapshotFingerprint = canonicalHash(
    source.snapshotFingerprint,
    "snapshot fingerprint",
  );
  if (incbReplaySnapshotFingerprint(snapshot) !== snapshotFingerprint) {
    throw new Error("Preserved INCB snapshot fingerprint does not match.");
  }
  return {
    bond,
    disposition,
    mintPayload: normalizedMintPayload,
    mintPayloadHash,
    reason,
    snapshot,
    snapshotFingerprint,
  };
}

function entryOrder(left, right) {
  return (
    left.bond.blockHeight - right.bond.blockHeight ||
    left.bond.blockIndex - right.bond.blockIndex ||
    left.bond.txid.localeCompare(right.bond.txid) ||
    left.bond.bondRecipientVout - right.bond.bondRecipientVout
  );
}

function normalizeManifestBody(value) {
  const source = plainObject(value);
  if (!source) {
    throw new Error("INCB replay witness manifest is missing.");
  }
  const model = String(source.model ?? "");
  if (model !== INCB_RANGE_REPLAY_WITNESS_MANIFEST_MODEL) {
    throw new Error("INCB replay witness manifest model is invalid.");
  }
  const network = canonicalText(source.network, "manifest network")
    .toLowerCase();
  const bindingId = canonicalHash(source.bindingId, "manifest binding id");
  const rangeReplayFromHeight = canonicalSafeInteger(
    source.rangeReplayFromHeight,
    "manifest replay height",
    { positive: true },
  );
  const throughHeight = canonicalSafeInteger(
    source.throughHeight,
    "manifest through height",
    { positive: true },
  );
  if (throughHeight < rangeReplayFromHeight - 1) {
    throw new Error("INCB replay witness manifest ends before its boundary.");
  }
  const throughHash = canonicalHash(source.throughHash, "manifest through hash");
  const createdAt = canonicalIsoDate(source.createdAt, "manifest createdAt");
  if (!Array.isArray(source.entries)) {
    throw new Error("INCB replay witness manifest entries are missing.");
  }
  const entries = source.entries.map(normalizeManifestEntry).sort(entryOrder);
  const identities = new Set();
  for (const entry of entries) {
    const identity = incbReplayBondIdentity(entry.bond);
    if (identities.has(identity)) {
      throw new Error(`Duplicate INCB replay witness identity ${identity}.`);
    }
    identities.add(identity);
    if (
      entry.bond.blockHeight < rangeReplayFromHeight ||
      entry.bond.blockHeight > throughHeight
    ) {
      throw new Error(
        `INCB replay witness ${identity} lies outside the committed range.`,
      );
    }
  }
  const preserveCount = entries.filter(
    (entry) => entry.disposition === PRESERVE_DISPOSITION,
  ).length;
  const rederiveCount = entries.length - preserveCount;
  if (
    Number(source.count) !== entries.length ||
    Number(source.preserveCount) !== preserveCount ||
    Number(source.rederiveCount) !== rederiveCount
  ) {
    throw new Error("INCB replay witness manifest counters do not reconcile.");
  }
  return {
    bindingId,
    count: entries.length,
    createdAt,
    entries,
    model,
    network,
    preserveCount,
    rangeReplayFromHeight,
    rederiveCount,
    throughHash,
    throughHeight,
  };
}

export function buildIncbRangeReplayWitnessManifest({
  bindingId,
  createdAt,
  entries,
  network,
  rangeReplayFromHeight,
  throughHash,
  throughHeight,
}) {
  const sourceEntries = Array.isArray(entries) ? entries : [];
  const preserveCount = sourceEntries.filter(
    (entry) => String(entry?.disposition ?? "").toLowerCase() === PRESERVE_DISPOSITION,
  ).length;
  const body = normalizeManifestBody({
    bindingId,
    count: sourceEntries.length,
    createdAt,
    entries: sourceEntries,
    model: INCB_RANGE_REPLAY_WITNESS_MANIFEST_MODEL,
    network,
    preserveCount,
    rangeReplayFromHeight,
    rederiveCount: sourceEntries.length - preserveCount,
    throughHash,
    throughHeight,
  });
  const hash = canonicalIncbReplaySha256(body);
  return {
    ...body,
    commitment: {
      algorithm: "sha256",
      hash,
      model: INCB_RANGE_REPLAY_WITNESS_COMMITMENT_MODEL,
    },
  };
}

export function verifyIncbRangeReplayWitnessManifest(value, expected = {}) {
  const source = plainObject(value);
  const commitment = plainObject(source?.commitment);
  if (
    !source ||
    !commitment ||
    commitment.algorithm !== "sha256" ||
    commitment.model !== INCB_RANGE_REPLAY_WITNESS_COMMITMENT_MODEL
  ) {
    throw new Error("INCB replay witness commitment is missing or invalid.");
  }
  const {
    commitment: _commitment,
    ...manifestBody
  } = source;
  const body = normalizeManifestBody(manifestBody);
  const hash = canonicalHash(commitment.hash, "manifest commitment hash");
  if (canonicalIncbReplaySha256(body) !== hash) {
    throw new Error("INCB replay witness manifest commitment does not match.");
  }
  const expectedBindingId = expected.bindingId
    ? canonicalHash(expected.bindingId, "expected binding id")
    : null;
  const expectedNetwork = expected.network
    ? canonicalText(expected.network, "expected network").toLowerCase()
    : null;
  const expectedMetaKey = expected.metaKey
    ? canonicalText(expected.metaKey, "expected manifest meta key")
    : null;
  const actualMetaKey = incbRangeReplayWitnessMetaKey(
    body.network,
    body.bindingId,
  );
  if (
    (expectedBindingId && body.bindingId !== expectedBindingId) ||
    (expectedNetwork && body.network !== expectedNetwork) ||
    (expectedMetaKey && actualMetaKey !== expectedMetaKey) ||
    (expected.hash && canonicalHash(expected.hash, "expected manifest hash") !== hash) ||
    (expected.count != null && Number(expected.count) !== body.count) ||
    (expected.preserveCount != null &&
      Number(expected.preserveCount) !== body.preserveCount) ||
    (expected.throughHeight != null &&
      Number(expected.throughHeight) !== body.throughHeight) ||
    (expected.throughHash &&
      canonicalHash(expected.throughHash, "expected through hash") !==
        body.throughHash) ||
    (expected.rangeReplayFromHeight != null &&
      Number(expected.rangeReplayFromHeight) !== body.rangeReplayFromHeight)
  ) {
    throw new Error("INCB replay witness manifest does not match its binding.");
  }
  return { ...body, commitment: { ...commitment, hash } };
}

export function incbRangeReplayWitnessBindingFields(manifest, metaKey) {
  const verified = verifyIncbRangeReplayWitnessManifest(manifest, { metaKey });
  return {
    witnessCount: verified.count,
    witnessModel: INCB_RANGE_REPLAY_WITNESS_MANIFEST_MODEL,
    witnessSetHash: verified.commitment.hash,
    witnessSetMetaKey: metaKey,
    witnessPreserveCount: verified.preserveCount,
    witnessedThroughBlock: verified.throughHeight,
    witnessedThroughBlockHash: verified.throughHash,
  };
}

export function preservedIncbReplaySnapshotIds(manifest) {
  const verified = verifyIncbRangeReplayWitnessManifest(manifest);
  return verified.entries
    .filter((entry) => entry.disposition === PRESERVE_DISPOSITION)
    .map((entry) => entry.snapshot.snapshotId)
    .sort();
}
