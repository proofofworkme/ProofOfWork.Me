import { createHash } from "node:crypto";
import { compareCanonicalUtf8 } from "./canonical-order.mjs";

const WORK_AMO_V8_TRANSIENT_WORKER_STATES = new Set([
  "canonical-phase-complete",
  "running",
  "starting",
]);

const WORK_AMO_V8_WORKER_AUTHORITY_DOMAIN =
  "ProofOfWork.Me/WORK-AMO-V8-WORKER-AUTHORITY/v1";
const WORK_AMO_V8_PENDING_PUBLICATION_AUTHORITY_DOMAIN =
  "ProofOfWork.Me/WORK-AMO-V8-PENDING-PUBLICATION-AUTHORITY/v1";
const WORK_Q16_PENDING_ATTEMPT_MODEL =
  "canonical-work-q16-pending-publication-attempt-v1";
const WORK_Q16_PENDING_REBUILD_MODEL =
  "canonical-work-q16-pending-rebuild-v2";
const WORK_Q16_PENDING_MEMBERSHIP_MODEL =
  "canonical-work-q16-pending-membership-v2";
const WORK_Q16_PENDING_MEMPOOL_MODEL =
  "canonical-core-mempool-txid-set-v1";
const WORK_Q16_PENDING_PROJECTION_MODEL =
  "canonical-work-q16-pending-projection-v5";
const WORK_PRECISION_READINESS_EPOCH_CHECKPOINT_MODEL =
  "proof-index-worker-readiness-epoch-checkpoint-v1";

function canonicalIso(value) {
  if (typeof value !== "string") {
    return "";
  }
  const timeMs = Date.parse(value);
  return Number.isFinite(timeMs) && new Date(timeMs).toISOString() === value
    ? value
    : "";
}

function stableAuthorityJson(value) {
  if (Array.isArray(value)) {
    return `[${value.map(stableAuthorityJson).join(",")}]`;
  }
  if (value && typeof value === "object") {
    return "{" +
      Object.keys(value)
        .sort(compareCanonicalUtf8)
        .map(
          (key) =>
            `${JSON.stringify(key)}:${stableAuthorityJson(value[key])}`,
        )
        .join(",") +
      "}";
  }
  return JSON.stringify(value);
}

function authoritySha256(domain, value) {
  return createHash("sha256")
    .update(`${domain}\n${stableAuthorityJson(value)}`, "utf8")
    .digest("hex");
}

function exactObjectKeys(value, expectedKeys) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }
  const actual = Object.keys(value).sort(compareCanonicalUtf8);
  const expected = [...expectedKeys].sort(compareCanonicalUtf8);
  return JSON.stringify(actual) === JSON.stringify(expected);
}

function readinessEpochCheckpointCore(value, network) {
  const checkpoint = objectRecord(value);
  const readinessEpochs = Array.isArray(checkpoint.readinessEpochs)
    ? checkpoint.readinessEpochs.map((entry) =>
        Array.isArray(entry) &&
          entry.length === 2 &&
          Number.isSafeInteger(entry[0]) &&
          entry[0] >= 0 &&
          entry[0] < 64 &&
          typeof entry[1] === "string" &&
          /^[1-9][0-9]*$/u.test(entry[1])
          ? [entry[0], entry[1]]
          : null
      )
    : [];
  const core = {
    maxPreparedTransactions: checkpoint.maxPreparedTransactions,
    model: checkpoint.model,
    network: checkpoint.network,
    postmasterStartedAt: checkpoint.postmasterStartedAt,
    queueCount: checkpoint.queueCount,
    readinessEpochs,
    searchPath: checkpoint.searchPath,
  };
  if (
    !exactObjectKeys(checkpoint, [
      "maxPreparedTransactions",
      "model",
      "network",
      "postmasterStartedAt",
      "queueCount",
      "readinessEpochs",
      "searchPath",
      "sha256",
    ]) ||
    checkpoint.model !== WORK_PRECISION_READINESS_EPOCH_CHECKPOINT_MODEL ||
    checkpoint.network !== network ||
    checkpoint.maxPreparedTransactions !== "0" ||
    checkpoint.queueCount !== 0 ||
    checkpoint.searchPath !== "pg_catalog, pg_temp" ||
    !canonicalIso(checkpoint.postmasterStartedAt) ||
    !/^[0-9a-f]{64}$/u.test(String(checkpoint.sha256 ?? "")) ||
    readinessEpochs.length !== 64 ||
    readinessEpochs.some(
      (entry, index) => !entry || entry[0] !== index,
    )
  ) {
    return null;
  }
  const sha256 = createHash("sha256")
    .update(
      `${
        "ProofOfWork.Me/PROOF-INDEX-WORKER-READINESS-EPOCH-CHECKPOINT/v1"
      }\n${stableAuthorityJson(core)}`,
      "utf8",
    )
    .digest("hex");
  return checkpoint.sha256 === sha256 ? { ...core, sha256 } : null;
}

export function workAmoV8WorkerAuthorityIdentity(value) {
  const readiness = objectRecord(value);
  const finishedAt = canonicalIso(readiness.finishedAt);
  const tipHash = normalizedHash(readiness.tipHash);
  const mempoolSha256 = normalizedHash(readiness.mempoolSha256);
  const pendingMembershipSha256 = normalizedHash(
    readiness.pendingMembershipSha256,
  );
  const pendingProjectionSha256 = normalizedHash(
    readiness.pendingProjectionSha256,
  );
  const tipHeight = readiness.tipHeight;
  const mempoolCount = readiness.mempoolCount;
  const pendingMembershipCount = readiness.pendingMembershipCount;
  if (
    readiness.ready !== true ||
    readiness.failureActive === true ||
    readiness.era !== "q16" ||
    !finishedAt ||
    !Number.isSafeInteger(tipHeight) ||
    tipHeight <= 0 ||
    !/^[0-9a-f]{64}$/u.test(tipHash) ||
    !Number.isSafeInteger(mempoolCount) ||
    mempoolCount < 0 ||
    !/^[0-9a-f]{64}$/u.test(mempoolSha256) ||
    !Number.isSafeInteger(pendingMembershipCount) ||
    pendingMembershipCount < 0 ||
    !/^[0-9a-f]{64}$/u.test(pendingMembershipSha256) ||
    !/^[0-9a-f]{64}$/u.test(pendingProjectionSha256)
  ) {
    return "";
  }
  return authoritySha256(WORK_AMO_V8_WORKER_AUTHORITY_DOMAIN, [
    "canonical-work-amo-v8-worker-authority-v1",
    finishedAt,
    tipHeight,
    tipHash,
    mempoolCount,
    mempoolSha256,
    pendingMembershipCount,
    pendingMembershipSha256,
    pendingProjectionSha256,
  ]);
}

export function workAmoV8PendingPublicationAuthorityIdentity(
  value,
  options = {},
) {
  const readiness = objectRecord(value);
  const witness = objectRecord(readiness.pendingWitness);
  const attempt = objectRecord(readiness.pendingAttempt);
  const canonicalTip = objectRecord(witness.canonicalTip);
  const mempool = objectRecord(witness.mempoolSnapshot);
  const membership = objectRecord(witness.membershipSnapshot);
  const projection = objectRecord(witness.projection);
  const verifierStage = objectRecord(witness.verifierStage);
  const initialMempool = objectRecord(attempt.initialMempool);
  const network = String(options.network ?? witness.network ?? "");
  const tipHeight = canonicalTip.height;
  const tipHash = normalizedHash(canonicalTip.hash);
  const generatedAt = canonicalIso(witness.generatedAt);
  const stageSha256 = normalizedHash(verifierStage.stageSha256);
  const membershipCount = membership.count;
  const membershipSha256 = normalizedHash(membership.sha256);
  const mempoolCount = mempool.count;
  const mempoolSha256 = normalizedHash(mempool.sha256);
  const projectionSha256 = normalizedHash(projection.commitmentSha256);
  const attemptId = normalizedHash(attempt.attemptId);
  const requestSha256 = normalizedHash(attempt.requestSha256);
  const startedAt = canonicalIso(attempt.startedAt);
  const completedAt = canonicalIso(attempt.completedAt);
  const stage = objectRecord(options.pendingStage);
  const checkpoint = readinessEpochCheckpointCore(
    attempt.publicationReadinessEpochCheckpoint,
    network,
  );
  const currentCheckpoint = options.currentReadinessEpochCheckpoint
    ? readinessEpochCheckpointCore(
        options.currentReadinessEpochCheckpoint,
        network,
      )
    : checkpoint;
  if (
    readiness.ready !== true ||
    readiness.pendingReady !== true ||
    witness.model !== WORK_Q16_PENDING_REBUILD_MODEL ||
    witness.network !== network ||
    witness.ready !== true ||
    attempt.model !== WORK_Q16_PENDING_ATTEMPT_MODEL ||
    attempt.network !== network ||
    attempt.status !== "published" ||
    !/^[0-9a-f]{64}$/u.test(attemptId) ||
    !/^[0-9a-f]{64}$/u.test(requestSha256) ||
    !startedAt ||
    !completedAt ||
    completedAt !== generatedAt ||
    attempt.witnessGeneratedAt !== generatedAt ||
    Date.parse(completedAt) < Date.parse(startedAt) ||
    !Number.isSafeInteger(tipHeight) ||
    tipHeight <= 0 ||
    (options.tipHeight !== undefined &&
      options.tipHeight !== tipHeight) ||
    !/^[0-9a-f]{64}$/u.test(tipHash) ||
    (options.tipHash !== undefined &&
      normalizedHash(options.tipHash) !== tipHash) ||
    !generatedAt ||
    !/^[0-9a-f]{64}$/u.test(stageSha256) ||
    normalizedHash(attempt.stageSha256) !== stageSha256 ||
    normalizedHash(stage.stageSha256) !== stageSha256 ||
    stableAuthorityJson(stage) !== stableAuthorityJson(verifierStage) ||
    initialMempool.model !== WORK_Q16_PENDING_MEMPOOL_MODEL ||
    !Number.isSafeInteger(initialMempool.count) ||
    initialMempool.count < 0 ||
    !/^[0-9a-f]{64}$/u.test(
      normalizedHash(initialMempool.sha256),
    ) ||
    mempool.model !== WORK_Q16_PENDING_MEMPOOL_MODEL ||
    !Number.isSafeInteger(mempoolCount) ||
    mempoolCount < 0 ||
    !/^[0-9a-f]{64}$/u.test(mempoolSha256) ||
    membership.model !== WORK_Q16_PENDING_MEMBERSHIP_MODEL ||
    !Number.isSafeInteger(membershipCount) ||
    membershipCount < 0 ||
    !/^[0-9a-f]{64}$/u.test(membershipSha256) ||
    projection.model !== WORK_Q16_PENDING_PROJECTION_MODEL ||
    !/^[0-9a-f]{64}$/u.test(projectionSha256) ||
    !checkpoint ||
    !currentCheckpoint ||
    stableAuthorityJson(checkpoint) !== stableAuthorityJson(currentCheckpoint) ||
    [
      options.pendingWitnessUpdatedAt,
      options.pendingAttemptUpdatedAt,
      options.pendingStageUpdatedAt,
    ].some((updatedAt) => canonicalIso(updatedAt) !== generatedAt)
  ) {
    return "";
  }
  return authoritySha256(
    WORK_AMO_V8_PENDING_PUBLICATION_AUTHORITY_DOMAIN,
    {
      model: "canonical-work-amo-v8-pending-publication-authority-v1",
      network,
      pendingAttempt: attempt,
      pendingStage: stage,
      pendingWitness: witness,
      publicationReadinessEpochCheckpoint: currentCheckpoint,
      publishedAt: generatedAt,
    },
  );
}

function objectRecord(value) {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value
    : {};
}

function normalizedHash(value) {
  return String(value ?? "").trim().toLowerCase();
}

function replayCommitments(value) {
  const replay = objectRecord(value);
  return {
    mempoolCount: replay.mempoolCount,
    mempoolSha256: normalizedHash(replay.mempoolSha256),
    pendingMembershipCount: replay.pendingMembershipCount,
    pendingMembershipSha256: normalizedHash(
      replay.pendingMembershipSha256,
    ),
    pendingProjectionSha256: normalizedHash(
      replay.pendingProjectionSha256,
    ),
    tipHash: normalizedHash(replay.tipHash),
    tipHeight: replay.tipHeight,
  };
}

function replayCommitmentsEqual(leftValue, rightValue) {
  const left = replayCommitments(leftValue);
  const right = replayCommitments(rightValue);
  return Object.keys(left).every((key) => left[key] === right[key]);
}

export function exactWorkAmoV8WorkerLastSuccessReadiness(
  operationalStatus,
  { network, tipHash, tipHeight },
) {
  const worker = objectRecord(operationalStatus?.worker);
  const workerState = String(worker.state ?? "");
  const lastSuccess = objectRecord(worker.lastSuccess);
  const durableWorkPrecision = objectRecord(lastSuccess.workPrecision);
  const durableReplay = objectRecord(durableWorkPrecision.replay);
  const currentWorkPrecision = objectRecord(worker.workPrecision);
  const currentReplay = objectRecord(currentWorkPrecision.replay);
  const noProgress = objectRecord(worker.noProgress);
  const finishedAt = String(lastSuccess.finishedAt ?? "");
  const failureActive =
    String(worker.error ?? "").trim().length > 0 ||
    Number(worker.consecutiveFailures ?? 0) > 0 ||
    noProgress.active === true ||
    String(worker.workPrecisionRecoveryError ?? "").trim().length > 0 ||
    currentWorkPrecision.readinessRecoveryRequired === true ||
    String(currentWorkPrecision.readinessError ?? "").trim().length > 0;
  const transientState = WORK_AMO_V8_TRANSIENT_WORKER_STATES.has(
    workerState,
  );
  const idleState = workerState === "idle";
  const stateReady = (idleState || transientState) && !failureActive;
  const idleProofReady =
    !idleState ||
    (worker.ok === true &&
      String(worker.finishedAt ?? "") === finishedAt &&
      currentWorkPrecision.era === "q16" &&
      currentReplay.era === "q16" &&
      currentReplay.ready === true &&
      replayCommitmentsEqual(currentReplay, durableReplay));
  const replay = replayCommitments(durableReplay);
  const ready =
    operationalStatus?.network === network &&
    worker.network === network &&
    stateReady &&
    idleProofReady &&
    finishedAt.length > 0 &&
    String(worker.lastSuccessAt ?? "") === finishedAt &&
    durableWorkPrecision.era === "q16" &&
    durableReplay.era === "q16" &&
    durableReplay.ready === true &&
    durableReplay.replayRequired === true &&
    Number.isSafeInteger(replay.tipHeight) &&
    replay.tipHeight === tipHeight &&
    /^[0-9a-f]{64}$/u.test(replay.tipHash) &&
    replay.tipHash === normalizedHash(tipHash) &&
    Number.isSafeInteger(replay.mempoolCount) &&
    replay.mempoolCount >= 0 &&
    /^[0-9a-f]{64}$/u.test(replay.mempoolSha256) &&
    Number.isSafeInteger(replay.pendingMembershipCount) &&
    replay.pendingMembershipCount >= 0 &&
    /^[0-9a-f]{64}$/u.test(replay.pendingMembershipSha256) &&
    /^[0-9a-f]{64}$/u.test(replay.pendingProjectionSha256);
  return {
    era: String(durableWorkPrecision.era ?? ""),
    failureActive,
    finishedAt,
    mempoolCount: Number.isSafeInteger(replay.mempoolCount)
      ? replay.mempoolCount
      : null,
    mempoolSha256: replay.mempoolSha256,
    pendingMembershipCount:
      Number.isSafeInteger(replay.pendingMembershipCount)
        ? replay.pendingMembershipCount
        : null,
    pendingMembershipSha256: replay.pendingMembershipSha256,
    pendingProjectionSha256: replay.pendingProjectionSha256,
    proofSource: idleState ? "idle-last-success" : "last-success",
    ready,
    state: workerState,
    tipHash: replay.tipHash,
    tipHeight: Number.isSafeInteger(replay.tipHeight)
      ? replay.tipHeight
      : null,
  };
}

export function exactWorkAmoV8WorkerReadiness(
  operationalStatus,
  { liveMempoolSnapshot, network, tipHash, tipHeight },
) {
  const durable = exactWorkAmoV8WorkerLastSuccessReadiness(
    operationalStatus,
    { network, tipHash, tipHeight },
  );
  return {
    ...durable,
    ready:
      durable.ready === true &&
      liveMempoolSnapshot?.model ===
        "canonical-core-mempool-txid-set-v1",
  };
}
