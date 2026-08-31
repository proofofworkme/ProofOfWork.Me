import { createHash } from "node:crypto";
import {
  WORK_PRECISION_V2_MIGRATION_META_KEY,
} from "./work-units.mjs";
import {
  WORK_AMO_V5_PAYLOAD_COMMITMENT_MODEL,
} from "./work-amo-v5.mjs";
import {
  WORK_AMO_V8_BLOCK_SEQUENCER_MODEL,
  WORK_AMO_V8_TOKEN_STATE_PREIMAGE_MODEL,
  validateWorkAmoV8BoundaryTransitionPayload,
} from "./work-amo-v8.mjs";

export const PWID_RAW_REPLAY_ACTIVATION_HEIGHT = 959_621;
export const ID_REGISTRY_AUDIT_TRANSITION_PAGE_SIZE = 64;
export const ID_REGISTRY_AUDIT_ROW_PAGE_SIZE = 256;
const ID_REGISTRY_AUDIT_ROLLING_HASH_MODEL =
  "proof-id-audit-rolling-sha256-v1";
const LEGACY_MIXED_DIAGNOSTIC_REASON =
  "The canonical first-party verifier rejected this protocol event.";
const LEGACY_MALFORMED_REASON =
  "Malformed ProofOfWork ID protocol payload.";
const LEGACY_MIXED_KIND_PATTERN =
  /^id-(?:buy2|list2|list3|list)-invalid$/u;

function emptyReplayMetadata(row) {
  return (
    row?.replayMetadataPresent === false &&
    !row?.payloadSource &&
    row?.replayBound !== true &&
    !row?.replayOutcomeKind &&
    row?.replayOutcomeValid === null &&
    row?.replayRawCandidate === null
  );
}

function replayMetadataValuesAreEmpty(row) {
  return (
    row?.replayBound === false &&
    !row?.replayOutcomeKind &&
    row?.replayOutcomeValid === null &&
    row?.replayRawCandidate === null
  );
}

function exactReplayMetadata(row, outcome) {
  return (
    row?.replayMetadataPresent === true &&
    row?.replayBound === true &&
    row?.replayRawCandidate === true &&
    row?.replayOutcomeKind === outcome.consensusKind &&
    row?.replayOutcomeValid === outcome.valid
  );
}

function exactAttemptedPwidKind(carrier, outcome) {
  if (outcome?.semanticKind !== "protocol-event-invalid") {
    return outcome?.semanticKind;
  }
  if (carrier?.rawDecodeValid !== true) {
    return "id-event";
  }
  const action = String(carrier?.rawPayload ?? "")
    .split(":")[1]
    ?.trim()
    .toLowerCase() ?? "";
  return action === "r" || action === "r2"
    ? "id-register"
    : action === "u"
      ? "id-update"
      : action === "t"
        ? "id-transfer"
        : action === "buy5"
          ? "id-buy"
          : action === "list5"
            ? "id-list"
            : action === "seal5"
              ? "id-seal"
              : action === "delist5"
                ? "id-delist"
                : `id-${action || "event"}`;
}

/**
 * Qualify one post-activation PWID relational row against the exact Core
 * carrier and canonical raw-block replay outcome. A single historical valid
 * row can legitimately predate redundant replay metadata materialization;
 * that exception is accepted only when every replay metadata key is absent
 * and the transition semantic, accepted lifecycle event, row kind, position,
 * and byte witness already agree. Invalid outcomes never receive that
 * exception: they must preserve the complete consensus rejection metadata.
 */
export function qualifiedPostActivationPwidOutcome({
  acceptedEvent,
  carrier,
  outcome,
  row,
}) {
  const dbSafePayload = carrier?.rawDecodeValid === true
    ? carrier.rawPayload
    : "pwid1:";
  const dbSafePayloadSha256 = createHash("sha256")
    .update(String(dbSafePayload ?? ""), "utf8")
    .digest("hex");
  const expectedEventKey = [
    "pwid1",
    row?.kind,
    carrier?.txid,
    "v5",
    carrier?.blockHeight,
    carrier?.blockIndex,
    carrier?.protocolVout,
    carrier?.recordOrdinal,
  ].join(":").toLowerCase();
  const expectedAttemptedKind = exactAttemptedPwidKind(carrier, outcome);
  if (
    !carrier ||
    !outcome ||
    !row ||
    !Number.isSafeInteger(carrier.blockHeight) ||
    carrier.blockHeight < PWID_RAW_REPLAY_ACTIVATION_HEIGHT ||
    outcome.rawCandidate !== true ||
    typeof outcome.valid !== "boolean" ||
    outcome.consensusKind !== `pwid1-${outcome.valid ? "valid" : "invalid"}` ||
    outcome.projectionKind !== outcome.semanticKind ||
    outcome.rawPayloadHex !== carrier.rawPayloadHex ||
    outcome.rawPayloadSha256 !== carrier.rawPayloadSha256 ||
    outcome.scriptPubKeyHex !== carrier.scriptPubKeyHex ||
    outcome.scriptPubKeySha256 !== carrier.scriptPubKeySha256 ||
    outcome.rawDecodeValid !== carrier.rawDecodeValid ||
    outcome.rawDecodeReasonCode !== carrier.rawDecodeReasonCode ||
    outcome.rawDecodeDetail !== carrier.rawDecodeDetail ||
    row.rawDecodeValid !== carrier.rawDecodeValid ||
    row.rawDecodeReasonCode !== carrier.rawDecodeReasonCode ||
    row.rawScriptWitnessPresent !== true ||
    row.rawScriptDecodeValid !== carrier.rawDecodeValid ||
    row.rawScriptDecodeDetail !== carrier.rawDecodeDetail ||
    row.rawScriptPayloadHex !== carrier.rawPayloadHex ||
    row.rawScriptPubKeyHex !== carrier.scriptPubKeyHex ||
    row.rawScriptReasonCode !== carrier.rawDecodeReasonCode ||
    row.reasonCode !== outcome.reasonCode ||
    row.replayOutcomeReasonCode !== outcome.reasonCode ||
    row.payloadReasonCode !== outcome.reasonCode ||
    row.payloadReason !== outcome.reasonCode ||
    row.eventKey !== expectedEventKey ||
    row.storedRawPayloadPresent !== true ||
    row.storedRawPayload !== dbSafePayload ||
    row.storedRawPayloadSha256 !== dbSafePayloadSha256 ||
    row.payloadRawPayloadPresent !== true ||
    row.payloadRawPayload !== dbSafePayload ||
    row.payloadRawPayloadSha256 !== dbSafePayloadSha256
  ) {
    throw new Error(
      "Post-activation PWID outcome is not exactly bound to its Core carrier and replay transition.",
    );
  }

  if (outcome.valid) {
    if (
      !acceptedEvent ||
      row.valid !== true ||
      row.kind !== outcome.semanticKind ||
      acceptedEvent.kind !== outcome.semanticKind ||
      outcome.reasonCode !== "" ||
      row.attemptedKind !== "" ||
      !Array.isArray(row.validationErrors) ||
      row.validationErrors.length !== 0 ||
      row.amountSats !== outcome.attributedRegistrySats ||
      acceptedEvent.amountSats !== outcome.attributedRegistrySats
    ) {
      throw new Error(
        "Post-activation valid PWID outcome disagrees with its accepted lifecycle projection.",
      );
    }
    if (row.replayMetadataPresent === false) {
      if (!replayMetadataValuesAreEmpty(row)) {
        throw new Error(
          "Post-activation PWID replay metadata is only partially absent.",
        );
      }
      return "post-activation-valid-transition-bound-metadata-absent";
    }
    if (!exactReplayMetadata(row, outcome)) {
      throw new Error(
        "Post-activation valid PWID replay metadata disagrees with consensus.",
      );
    }
    return "post-activation-valid-replay-bound";
  }

  if (
    acceptedEvent ||
    row.valid !== false ||
    row.kind !== "id-event-invalid" ||
    !outcome.reasonCode ||
    row.attemptedKind !== expectedAttemptedKind ||
    !Array.isArray(row.validationErrors) ||
    row.validationErrors.length !== 1 ||
    row.validationErrors[0] !== outcome.reasonCode ||
    row.amountSats !== outcome.attributedRegistrySats ||
    !exactReplayMetadata(row, outcome)
  ) {
    throw new Error(
      "Post-activation invalid PWID row is not the exact canonical replay rejection.",
    );
  }
  return "post-activation-invalid-replay-bound";
}

export function qualifiedLegacyPwidOutcome({
  accepted,
  blockHeight,
  invalidRow,
  parsedAttempt,
}) {
  if (
    !Number.isSafeInteger(blockHeight) ||
    blockHeight < 1 ||
    blockHeight >= PWID_RAW_REPLAY_ACTIVATION_HEIGHT ||
    !invalidRow ||
    typeof invalidRow !== "object" ||
    !emptyReplayMetadata(invalidRow)
  ) {
    throw new Error("PWID outcome is outside the qualified legacy audit domain.");
  }
  if (accepted === true) {
    if (
      invalidRow.reasonCode !== LEGACY_MIXED_DIAGNOSTIC_REASON ||
      !LEGACY_MIXED_KIND_PATTERN.test(String(invalidRow.kind ?? "")) ||
      invalidRow.validationMode
    ) {
      throw new Error(
        "Mixed PWID outcome is not an explicitly qualified historical diagnostic row.",
      );
    }
    return "same-carrier-contradictory-diagnostic-row";
  }
  if (
    parsedAttempt ||
    invalidRow.kind !== "id-event-invalid" ||
    invalidRow.reasonCode !== LEGACY_MALFORMED_REASON ||
    invalidRow.validationMode !== "canonical-first-party-state"
  ) {
    throw new Error(
      "Rejected PWID outcome is not independently qualified by the legacy parser.",
    );
  }
  return "legacy-malformed-parser-rejection";
}

function auditCanonicalJson(value) {
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "boolean"
  ) {
    return JSON.stringify(value);
  }
  if (typeof value === "number") {
    if (!Number.isSafeInteger(value)) {
      throw new Error("ID audit evidence contains an inexact number.");
    }
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map(auditCanonicalJson).join(",")}]`;
  }
  if (value && typeof value === "object") {
    return `{${Object.keys(value)
      .filter((key) => value[key] !== undefined)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${auditCanonicalJson(value[key])}`)
      .join(",")}}`;
  }
  throw new Error("ID audit evidence contains an unsupported value.");
}

function auditHash(value) {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function exactInteger(value, minimum = 0) {
  if (
    value === undefined ||
    value === null ||
    value === "" ||
    typeof value === "boolean"
  ) {
    return null;
  }
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed >= minimum ? parsed : null;
}

function exactHash(value) {
  const normalized = String(value ?? "").trim().toLowerCase();
  return /^[0-9a-f]{64}$/u.test(normalized) ? normalized : "";
}

function exactIntegerText(value) {
  const normalized = String(value ?? "").trim();
  return /^(?:0|[1-9][0-9]*)$/u.test(normalized) ? normalized : "";
}

function exactCommitment(value, expectedModel = "") {
  const model = String(value?.model ?? "").trim();
  const sha256 = exactHash(value?.sha256);
  const payloadBytes = exactInteger(value?.payloadBytes, 1);
  if (
    !model ||
    (expectedModel && model !== expectedModel) ||
    !sha256 ||
    payloadBytes === null
  ) {
    throw new Error("ID audit transition commitment is incomplete.");
  }
  return { model, payloadBytes, sha256 };
}

/**
 * A resumable, domain-separated rolling hash. Each item is length framed and
 * chained to the prior digest, so callers can process an arbitrary number of
 * pages without retaining the history in memory.
 */
export function createIdRegistryAuditRollingHash(domain) {
  const normalizedDomain = String(domain ?? "").trim();
  if (!normalizedDomain || normalizedDomain.length > 256) {
    throw new Error("ID audit rolling-hash domain is invalid.");
  }
  return {
    count: 0,
    domain: normalizedDomain,
    model: ID_REGISTRY_AUDIT_ROLLING_HASH_MODEL,
    sha256: auditHash(
      `${ID_REGISTRY_AUDIT_ROLLING_HASH_MODEL}\u0000${normalizedDomain}\u00000`,
    ),
  };
}

export function advanceIdRegistryAuditRollingHash(state, items) {
  if (
    state?.model !== ID_REGISTRY_AUDIT_ROLLING_HASH_MODEL ||
    !String(state?.domain ?? "").trim() ||
    exactInteger(state?.count) === null ||
    !exactHash(state?.sha256)
  ) {
    throw new Error("ID audit rolling-hash state is invalid.");
  }
  let next = { ...state };
  for (const item of Array.isArray(items) ? items : [items]) {
    const canonical = auditCanonicalJson(item);
    const length = Buffer.byteLength(canonical, "utf8");
    const count = next.count + 1;
    next = {
      ...next,
      count,
      sha256: auditHash(
        [
          ID_REGISTRY_AUDIT_ROLLING_HASH_MODEL,
          next.domain,
          next.sha256,
          String(count),
          String(length),
          canonical,
        ].join("\u0000"),
      ),
    };
  }
  return next;
}

export function idRegistryAuditRollingHashFingerprint(state) {
  if (
    state?.model !== ID_REGISTRY_AUDIT_ROLLING_HASH_MODEL ||
    exactInteger(state?.count) === null ||
    !exactHash(state?.sha256)
  ) {
    throw new Error("ID audit rolling-hash fingerprint is invalid.");
  }
  return {
    count: state.count,
    model: state.model,
    sha256: state.sha256,
  };
}

function transitionPayloadEvidence(transition) {
  const payload = transition?.payload;
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    throw new Error("ID audit transition payload is unavailable.");
  }
  const blockHeight = exactInteger(transition.blockHeight, 1);
  const blockHash = exactHash(transition.blockHash);
  const previousBlockHash = exactHash(transition.previousBlockHash);
  const canonicalPreviousBlockHash = exactHash(
    transition.canonicalPreviousBlockHash,
  );
  const model = String(transition.model ?? "").trim();
  const stateCommitmentModel = String(
    transition.stateCommitmentModel ?? "",
  ).trim();
  const eventSetModel = String(transition.eventSetModel ?? "").trim();
  const openingStateCommitment = exactCommitment(
    payload.openingStateCommitment,
    stateCommitmentModel,
  );
  const closingStateCommitment = exactCommitment(
    payload.closingStateCommitment,
    stateCommitmentModel,
  );
  const eventSetCommitment = exactCommitment(
    payload.eventSetCommitment,
    eventSetModel,
  );
  const replayDescriptorCommitment = exactCommitment(
    payload.replayDescriptorCommitment,
  );
  const transitionChainCommitment = exactCommitment(
    payload.transitionChainCommitment,
    String(payload.transitionChainModel ?? "").trim(),
  );
  const blockDescriptorCommitment = exactCommitment(
    payload.blockDescriptorCommitment,
  );
  const openingNetworkValueQ8 = exactIntegerText(
    transition.openingNetworkValueQ8,
  );
  const closingNetworkValueQ8 = exactIntegerText(
    transition.closingNetworkValueQ8,
  );
  const counts = {
    eventCount: exactInteger(transition.eventCount),
    protocolRecordCount: exactInteger(transition.protocolRecordCount),
    rawProtocolCandidateCount: exactInteger(
      transition.rawProtocolCandidateCount,
    ),
    transactionCount: exactInteger(transition.transactionCount),
  };
  if (
    blockHeight === null ||
    !blockHash ||
    !previousBlockHash ||
    !canonicalPreviousBlockHash ||
    previousBlockHash !== canonicalPreviousBlockHash ||
    !model ||
    !stateCommitmentModel ||
    !eventSetModel ||
    !openingNetworkValueQ8 ||
    !closingNetworkValueQ8 ||
    Object.values(counts).some((value) => value === null) ||
    transition.blockAtomic !== true ||
    transition.feeOnce !== true ||
    transition.invalidZero !== true ||
    transition.complete !== true ||
    payload.blockHeight !== blockHeight ||
    exactHash(payload.blockHash) !== blockHash ||
    exactHash(payload.previousBlockHash) !== previousBlockHash ||
    payload.model !== model ||
    (transition.workTokenStateModel ?? null) !==
      (payload.workTokenStateModel ?? null) ||
    exactIntegerText(payload.openingNetworkValueQ8) !==
      openingNetworkValueQ8 ||
    exactIntegerText(payload.closingNetworkValueQ8) !==
      closingNetworkValueQ8 ||
    payload.blockAtomic !== true ||
    payload.feeOnce !== true ||
    payload.invalidZero !== true ||
    payload.complete !== true ||
    exactInteger(payload.eventCount) !== counts.eventCount ||
    exactInteger(payload.protocolRecordCount) !== counts.protocolRecordCount ||
    exactInteger(payload.rawProtocolCandidateCount) !==
      counts.rawProtocolCandidateCount ||
    exactInteger(payload.transactionCount) !== counts.transactionCount ||
    exactHash(transition.openingStateSha256) !==
      openingStateCommitment.sha256 ||
    exactInteger(transition.openingStatePayloadBytes, 1) !==
      openingStateCommitment.payloadBytes ||
    exactHash(transition.closingStateSha256) !==
      closingStateCommitment.sha256 ||
    exactInteger(transition.closingStatePayloadBytes, 1) !==
      closingStateCommitment.payloadBytes ||
    exactHash(transition.eventSetSha256) !== eventSetCommitment.sha256 ||
    exactInteger(transition.eventSetPayloadBytes, 1) !==
      eventSetCommitment.payloadBytes ||
    !Array.isArray(payload.replayRecords)
  ) {
    throw new Error(
      `ID audit transition ${blockHeight ?? "(unknown)"} disagrees with its stored commitments.`,
    );
  }
  return {
    blockDescriptorCommitment,
    blockHash,
    blockHeight,
    closingNetworkValueQ8,
    closingStateCommitment,
    counts,
    eventSetCommitment,
    openingNetworkValueQ8,
    openingStateCommitment,
    previousBlockHash,
    replayDescriptorCommitment,
    transitionChainCommitment,
  };
}

function commitmentsEqual(left, right) {
  return Boolean(
    left &&
      right &&
      left.model === right.model &&
      left.payloadBytes === right.payloadBytes &&
      left.sha256 === right.sha256
  );
}

function idRegistryAuditPrecisionRebindingAllowed(state, transition, evidence) {
  const precisionHeight = exactInteger(
    state?.precisionMigrationActivationHeight,
    1,
  );
  if (
    precisionHeight === null ||
    state?.precisionMigrationRebindingConsumed === true ||
    evidence.blockHeight !== precisionHeight ||
    transition?.model !== WORK_AMO_V8_BLOCK_SEQUENCER_MODEL ||
    transition?.workTokenStateModel !== WORK_AMO_V8_TOKEN_STATE_PREIMAGE_MODEL
  ) {
    return false;
  }
  const payload =
    transition?.payload &&
    typeof transition.payload === "object" &&
    !Array.isArray(transition.payload)
      ? transition.payload
      : null;
  if (
    !payload ||
    payload.precisionMigrationMarkerKey !==
      WORK_PRECISION_V2_MIGRATION_META_KEY ||
    exactInteger(payload.activationHeight, 1) !== precisionHeight ||
    exactInteger(payload.workAmoV8?.activationHeight, 1) !== precisionHeight
  ) {
    return false;
  }
  const boundaryValidation =
    validateWorkAmoV8BoundaryTransitionPayload(transition);
  if (boundaryValidation.valid !== true) {
    return false;
  }
  try {
    const precisionOpeningCommitment = exactCommitment(
      payload.precisionOpeningTokenStateCommitment,
      WORK_AMO_V5_PAYLOAD_COMMITMENT_MODEL,
    );
    const openingTokenCommitment = exactCommitment(
      payload.openingSufficientState?.tokenStateCommitment,
      WORK_AMO_V5_PAYLOAD_COMMITMENT_MODEL,
    );
    return commitmentsEqual(
      precisionOpeningCommitment,
      openingTokenCommitment,
    );
  } catch {
    return false;
  }
}

export function createIdRegistryAuditTransitionChain({
  activationHeight = PWID_RAW_REPLAY_ACTIVATION_HEIGHT,
  checkpointHash,
  checkpointHeight,
  precisionMigrationActivationHeight,
} = {}) {
  const height = exactInteger(activationHeight, 1);
  const tipHeight = exactInteger(checkpointHeight, 1);
  const tipHash = exactHash(checkpointHash);
  const precisionHeightSpecified =
    precisionMigrationActivationHeight !== undefined &&
    precisionMigrationActivationHeight !== null &&
    String(precisionMigrationActivationHeight).trim() !== "";
  const precisionHeight = precisionHeightSpecified
    ? exactInteger(precisionMigrationActivationHeight, 1)
    : null;
  if (height === null || tipHeight === null || tipHeight < height || !tipHash) {
    throw new Error("ID audit transition-chain checkpoint is invalid.");
  }
  if (
    precisionHeightSpecified &&
    (
      precisionHeight === null ||
      precisionHeight < height ||
      precisionHeight > tipHeight
    )
  ) {
    throw new Error("ID audit precision transition boundary is invalid.");
  }
  return {
    activationHeight: height,
    checkpointHash: tipHash,
    checkpointHeight: tipHeight,
    lastBlockHash: "",
    lastClosingNetworkValueQ8: "",
    lastClosingStatePayloadBytes: null,
    lastClosingStateSha256: "",
    nextHeight: height,
    precisionMigrationActivationHeight: precisionHeight,
    precisionMigrationRebindingConsumed: false,
    rolling: createIdRegistryAuditRollingHash(
      "proof-indexer-work-amo-block-transitions",
    ),
  };
}

export function advanceIdRegistryAuditTransitionChain(state, transitions) {
  if (!state || !Array.isArray(transitions) || transitions.length < 1) {
    throw new Error("ID audit transition page is empty or invalid.");
  }
  let next = { ...state, rolling: { ...state.rolling } };
  for (const transition of transitions) {
    const evidence = transitionPayloadEvidence(transition);
    const heightContiguous = evidence.blockHeight === next.nextHeight;
    const previousHashContiguous =
      !next.lastBlockHash ||
      evidence.previousBlockHash === next.lastBlockHash;
    const networkValueContiguous =
      !next.lastClosingNetworkValueQ8 ||
      evidence.openingNetworkValueQ8 === next.lastClosingNetworkValueQ8;
    const payloadBytesContiguous =
      next.lastClosingStatePayloadBytes === null ||
      evidence.openingStateCommitment.payloadBytes ===
        next.lastClosingStatePayloadBytes;
    const stateHashContiguous =
      !next.lastClosingStateSha256 ||
      evidence.openingStateCommitment.sha256 ===
        next.lastClosingStateSha256;
    const precisionRebinding =
      !stateHashContiguous &&
      heightContiguous &&
      previousHashContiguous &&
      networkValueContiguous &&
      payloadBytesContiguous &&
      idRegistryAuditPrecisionRebindingAllowed(next, transition, evidence);
    if (
      !heightContiguous ||
      !previousHashContiguous ||
      !networkValueContiguous ||
      !payloadBytesContiguous ||
      (!stateHashContiguous && !precisionRebinding)
    ) {
      throw new Error(
        `ID audit transition chain is not contiguous at height ${evidence.blockHeight}.`,
      );
    }
    next.precisionMigrationRebindingConsumed =
      next.precisionMigrationRebindingConsumed || precisionRebinding;
    next.rolling = advanceIdRegistryAuditRollingHash(next.rolling, {
      blockDescriptorCommitment: evidence.blockDescriptorCommitment,
      blockHash: evidence.blockHash,
      blockHeight: evidence.blockHeight,
      closingNetworkValueQ8: evidence.closingNetworkValueQ8,
      closingStateCommitment: evidence.closingStateCommitment,
      counts: evidence.counts,
      eventSetCommitment: evidence.eventSetCommitment,
      openingNetworkValueQ8: evidence.openingNetworkValueQ8,
      openingStateCommitment: evidence.openingStateCommitment,
      previousBlockHash: evidence.previousBlockHash,
      replayDescriptorCommitment: evidence.replayDescriptorCommitment,
      transitionChainCommitment: evidence.transitionChainCommitment,
    });
    next.lastBlockHash = evidence.blockHash;
    next.lastClosingNetworkValueQ8 = evidence.closingNetworkValueQ8;
    next.lastClosingStatePayloadBytes =
      evidence.closingStateCommitment.payloadBytes;
    next.lastClosingStateSha256 = evidence.closingStateCommitment.sha256;
    next.nextHeight = evidence.blockHeight + 1;
  }
  return next;
}

export function finalizeIdRegistryAuditTransitionChain(state) {
  if (
    !state ||
    state.nextHeight !== state.checkpointHeight + 1 ||
    state.lastBlockHash !== state.checkpointHash
  ) {
    throw new Error(
      "ID audit transition chain does not end at the exact pinned checkpoint.",
    );
  }
  return {
    activationHeight: state.activationHeight,
    checkpointHash: state.checkpointHash,
    checkpointHeight: state.checkpointHeight,
    transitionCount: state.rolling.count,
    transitionSha256: state.rolling.sha256,
  };
}

export function assertIdRegistryAuditFinalFence(initial, final) {
  const normalized = (value) => auditCanonicalJson(value);
  if (normalized(initial) !== normalized(final)) {
    throw new Error("ID audit final relational fence drifted during verification.");
  }
  return true;
}

function auditPositionKey(value) {
  const txid = exactHash(value?.txid);
  const blockHeight = exactInteger(value?.blockHeight, 1);
  const blockIndex = exactInteger(value?.blockIndex);
  const protocolVout = exactInteger(value?.protocolVout);
  const recordOrdinal = exactInteger(value?.recordOrdinal);
  if (
    !txid ||
    blockHeight === null ||
    blockIndex === null ||
    protocolVout === null ||
    recordOrdinal === null
  ) {
    throw new Error("ID audit attempt position is incomplete.");
  }
  return [txid, blockHeight, blockIndex, protocolVout, recordOrdinal].join(":");
}

export function assertIdRegistryAuditAttemptPositionCoverage(
  discoveredOutcomes,
  relationalRows,
) {
  const discovered = new Set();
  for (const outcome of Array.isArray(discoveredOutcomes)
    ? discoveredOutcomes
    : []) {
    const key = auditPositionKey(outcome);
    if (discovered.has(key)) {
      throw new Error(`ID audit transition repeats discovered attempt ${key}.`);
    }
    discovered.add(key);
  }
  const relational = new Set();
  for (const row of Array.isArray(relationalRows) ? relationalRows : []) {
    const key = auditPositionKey(row);
    if (relational.has(key)) {
      throw new Error(`ID audit post-activation position ${key} has mixed rows.`);
    }
    relational.add(key);
  }
  if (
    discovered.size !== relational.size ||
    [...discovered].some((key) => !relational.has(key)) ||
    [...relational].some((key) => !discovered.has(key))
  ) {
    throw new Error(
      "ID audit transition-discovered attempts disagree with relational rows.",
    );
  }
  return { positionCount: discovered.size };
}
