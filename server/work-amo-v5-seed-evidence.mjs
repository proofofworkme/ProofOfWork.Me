import {
  WORK_AMO_V5_ACTIVATION_HEIGHT,
  WORK_AMO_V5_DECLARATION_BLOCK_HASH,
  WORK_AMO_V5_STATE_COMMITMENT_MODEL,
  validateWorkAmoV5SufficientState,
  workAmoV5CanonicalPayloadCommitment,
  workAmoV5CanonicalStateCommitment,
  workAmoV5CanonicalTokenStateCommitment,
  workAmoV5WorkStateWithoutLegacyListingReservations,
} from "./work-amo-v5.mjs";
import {
  normalizeWorkAmoV5RawGenericState,
  normalizeWorkAmoV5RawIdState,
  normalizeWorkAmoV5RawWorkState,
  workAmoV5RawGenericStateCommitment,
  workAmoV5RawIdStateCommitment,
} from "./work-amo-v5-raw.mjs";

export const WORK_AMO_V5_H_MINUS_ONE_SEED_EVIDENCE_MODEL =
  "canonical-work-amo-v5-h-minus-one-seed-evidence-v1";
export const WORK_AMO_V5_H_MINUS_ONE_SEED_EVIDENCE_SOURCE =
  "proof-indexer-work-amo-v5-h-minus-one-seed-evidence";
export const WORK_AMO_V5_H_MINUS_ONE_SEED_EVIDENCE_STATUS =
  "work-amo-v5-h-minus-one-seed-evidence";

const BODY_KEYS = Object.freeze([
  "canonicalSummary",
  "commitments",
  "indexedThroughBlock",
  "indexedThroughBlockHash",
  "model",
  "network",
  "seedGenericTokenState",
  "seedIdState",
  "seedSufficientState",
  "seedTokenState",
  "seedWorkProjection",
]);
const ENVELOPE_KEYS = new Set([
  ...BODY_KEYS,
  "complete",
  "evidenceCommitment",
  "snapshotId",
  "source",
]);

function exactPositiveIntegerText(value) {
  const text = String(value ?? "").trim();
  return /^[1-9][0-9]*$/u.test(text) ? BigInt(text).toString() : "";
}

function exactCommitment(value, model) {
  const sha256 = String(value?.sha256 ?? "").trim().toLowerCase();
  const payloadBytes = Number(value?.payloadBytes);
  return value?.model === model &&
    /^[0-9a-f]{64}$/u.test(sha256) &&
    Number.isSafeInteger(payloadBytes) &&
    payloadBytes > 0
    ? { model, payloadBytes, sha256 }
    : null;
}

function jsonNumbersAreExact(value) {
  if (typeof value === "number") {
    return Number.isSafeInteger(value);
  }
  if (Array.isArray(value)) {
    return value.every(jsonNumbersAreExact);
  }
  if (value && typeof value === "object") {
    return Object.values(value).every(jsonNumbersAreExact);
  }
  return true;
}

function payloadsMatch(left, right) {
  const leftCommitment = workAmoV5CanonicalPayloadCommitment(left);
  const rightCommitment = workAmoV5CanonicalPayloadCommitment(right);
  return (
    leftCommitment.sha256 === rightCommitment.sha256 &&
    leftCommitment.payloadBytes === rightCommitment.payloadBytes
  );
}

function canonicalSummaryEvidence(value) {
  const source =
    value && typeof value === "object" && !Array.isArray(value)
      ? value
      : {};
  const snapshotId = String(source.snapshotId ?? "").trim();
  const canonicalSummaryHash = String(
    source.canonicalSummaryHash ?? source.summaryHash ?? "",
  )
    .trim()
    .toLowerCase();
  const networkValueQ8 = exactPositiveIntegerText(
    source.networkValueQ8,
  );
  if (
    !snapshotId ||
    snapshotId.length > 128 ||
    /\s/u.test(snapshotId) ||
    !/^[0-9a-f]{64}$/u.test(canonicalSummaryHash) ||
    !networkValueQ8
  ) {
    throw new Error(
      "Canonical AMO H-1 seed evidence summary binding is invalid.",
    );
  }
  return {
    canonicalSummaryHash,
    networkValueQ8,
    snapshotId,
  };
}

function canonicalEvidenceBody(value) {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    !jsonNumbersAreExact(value)
  ) {
    throw new Error(
      "Canonical AMO H-1 seed evidence contains an unsafe JSON number.",
    );
  }
  const indexedThroughBlock = Number(
    value.indexedThroughBlock ??
      value.seedSufficientState?.throughBlockHeight,
  );
  const indexedThroughBlockHash = String(
    value.indexedThroughBlockHash ??
      value.seedSufficientState?.throughBlockHash ??
      "",
  )
    .trim()
    .toLowerCase();
  const canonicalSummary = canonicalSummaryEvidence(
    value.canonicalSummary,
  );
  const stateValidation = validateWorkAmoV5SufficientState(
    value.seedSufficientState,
  );
  if (
    value.network !== undefined &&
    String(value.network ?? "") !== "livenet"
  ) {
    throw new Error(
      "Canonical AMO H-1 seed evidence network is invalid.",
    );
  }
  if (
    value.model !== undefined &&
    value.model !== WORK_AMO_V5_H_MINUS_ONE_SEED_EVIDENCE_MODEL
  ) {
    throw new Error(
      "Canonical AMO H-1 seed evidence model is invalid.",
    );
  }
  if (
    !Number.isSafeInteger(indexedThroughBlock) ||
    indexedThroughBlock !== WORK_AMO_V5_ACTIVATION_HEIGHT - 1 ||
    indexedThroughBlockHash !== WORK_AMO_V5_DECLARATION_BLOCK_HASH ||
    !stateValidation.valid ||
    stateValidation.state.network !== "livenet" ||
    stateValidation.state.throughBlockHeight !== indexedThroughBlock ||
    stateValidation.state.throughBlockHash !== indexedThroughBlockHash ||
    stateValidation.state.networkValueQ8 !==
      canonicalSummary.networkValueQ8
  ) {
    throw new Error(
      "Canonical AMO H-1 seed evidence checkpoint is invalid.",
    );
  }
  const seedGenericTokenState = normalizeWorkAmoV5RawGenericState(
    value.seedGenericTokenState,
  );
  const seedIdState = normalizeWorkAmoV5RawIdState(
    value.seedIdState,
  );
  const seedTokenState = normalizeWorkAmoV5RawWorkState(
    value.seedTokenState,
  );
  const seedWorkProjection = normalizeWorkAmoV5RawWorkState(
    workAmoV5WorkStateWithoutLegacyListingReservations(
      value.seedWorkProjection,
    ),
  );
  const commitments = {
    genericTokenState:
      workAmoV5RawGenericStateCommitment(seedGenericTokenState),
    idState: workAmoV5RawIdStateCommitment(seedIdState),
    sufficientState:
      workAmoV5CanonicalStateCommitment(stateValidation.state),
    tokenState:
      workAmoV5CanonicalTokenStateCommitment(seedTokenState),
    workProjection:
      workAmoV5CanonicalTokenStateCommitment(seedWorkProjection),
  };
  if (
    stateValidation.state.genericTokenStateCommitment.sha256 !==
      commitments.genericTokenState.sha256 ||
    stateValidation.state.genericTokenStateCommitment.payloadBytes !==
      commitments.genericTokenState.payloadBytes ||
    stateValidation.state.idStateCommitment.sha256 !==
      commitments.idState.sha256 ||
    stateValidation.state.idStateCommitment.payloadBytes !==
      commitments.idState.payloadBytes ||
    stateValidation.state.tokenStateCommitment.sha256 !==
      commitments.tokenState.sha256 ||
    stateValidation.state.tokenStateCommitment.payloadBytes !==
      commitments.tokenState.payloadBytes ||
    commitments.tokenState.sha256 !== commitments.workProjection.sha256 ||
    commitments.tokenState.payloadBytes !==
      commitments.workProjection.payloadBytes
  ) {
    throw new Error(
      "Canonical AMO H-1 seed evidence preimages diverge from their state commitments.",
    );
  }
  return {
    canonicalSummary,
    commitments,
    indexedThroughBlock,
    indexedThroughBlockHash,
    model: WORK_AMO_V5_H_MINUS_ONE_SEED_EVIDENCE_MODEL,
    network: "livenet",
    seedGenericTokenState,
    seedIdState,
    seedSufficientState: stateValidation.state,
    seedTokenState,
    seedWorkProjection,
  };
}

export function canonicalWorkAmoV5HMinusOneSeedEvidence(value) {
  const body = canonicalEvidenceBody(value);
  const evidenceCommitment =
    workAmoV5CanonicalPayloadCommitment(body);
  return {
    ...body,
    complete: true,
    evidenceCommitment,
    snapshotId:
      `amo-v5-h1-${evidenceCommitment.sha256.slice(0, 24)}`,
    source: WORK_AMO_V5_H_MINUS_ONE_SEED_EVIDENCE_SOURCE,
  };
}

export function validatedWorkAmoV5HMinusOneSeedEvidence(value) {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    Object.keys(value).some((key) => !ENVELOPE_KEYS.has(key)) ||
    BODY_KEYS.some((key) => !Object.hasOwn(value, key)) ||
    value.complete !== true ||
    value.source !== WORK_AMO_V5_H_MINUS_ONE_SEED_EVIDENCE_SOURCE
  ) {
    return null;
  }
  let canonical;
  try {
    canonical = canonicalWorkAmoV5HMinusOneSeedEvidence(value);
  } catch {
    return null;
  }
  const declaredCommitment = exactCommitment(
    value.evidenceCommitment,
    canonical.evidenceCommitment.model,
  );
  const declaredStateCommitment = exactCommitment(
    value.commitments?.sufficientState,
    WORK_AMO_V5_STATE_COMMITMENT_MODEL,
  );
  const providedBody = Object.fromEntries(
    BODY_KEYS.map((key) => [key, value[key]]),
  );
  if (
    !declaredCommitment ||
    !declaredStateCommitment ||
    value.snapshotId !== canonical.snapshotId ||
    declaredCommitment.sha256 !==
      canonical.evidenceCommitment.sha256 ||
    declaredCommitment.payloadBytes !==
      canonical.evidenceCommitment.payloadBytes ||
    !payloadsMatch(providedBody, canonicalEvidenceBody(value)) ||
    !payloadsMatch(value.commitments, canonical.commitments)
  ) {
    return null;
  }
  return canonical;
}
