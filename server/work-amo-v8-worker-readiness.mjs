const WORK_AMO_V8_TRANSIENT_WORKER_STATES = new Set([
  "canonical-phase-complete",
  "running",
  "starting",
]);

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

function hasOwnRecordProperty(record, key) {
  return Object.prototype.hasOwnProperty.call(record, key);
}

function confirmedReplayProof(value, { requireExplicit = false } = {}) {
  const replay = objectRecord(value);
  const hasConfirmed = hasOwnRecordProperty(replay, "confirmed");
  const confirmed = objectRecord(replay.confirmed);
  const proof = hasConfirmed ? confirmed : requireExplicit ? {} : replay;
  const tipHeight = Number(proof.tipHeight);
  const tipHash = normalizedHash(proof.tipHash);
  return {
    ready:
      (!requireExplicit || hasConfirmed) &&
      proof.ready === true &&
      proof.replayRequired === true &&
      Number.isSafeInteger(tipHeight) &&
      /^[0-9a-f]{64}$/u.test(tipHash),
    tipHash,
    tipHeight: Number.isSafeInteger(tipHeight) ? tipHeight : null,
  };
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
  const durableConfirmedReplay = confirmedReplayProof(durableReplay);
  const currentConfirmedReplay = confirmedReplayProof(currentReplay, {
    requireExplicit: true,
  });
  const normalizedTargetHash = normalizedHash(tipHash);
  const currentConfirmedProofReady =
    operationalStatus?.network === network &&
    worker.network === network &&
    stateReady &&
    transientState &&
    currentWorkPrecision.era === "q16" &&
    currentConfirmedReplay.ready === true &&
    currentConfirmedReplay.tipHeight === tipHeight &&
    currentConfirmedReplay.tipHash === normalizedTargetHash;
  const currentFullReplayReady = currentReplay.ready === true;
  const currentConfirmedReplayReady =
    currentConfirmedReplay.ready === true;
  const currentConfirmedMatchesDurable =
    currentConfirmedReplayReady &&
    durableConfirmedReplay.ready === true &&
    currentConfirmedReplay.tipHeight === durableConfirmedReplay.tipHeight &&
    currentConfirmedReplay.tipHash === durableConfirmedReplay.tipHash;
  const idleDurableConfirmedProofReady =
    !currentFullReplayReady &&
    !currentConfirmedReplayReady &&
    currentReplay.replayRequired === true &&
    durableConfirmedReplay.ready === true &&
    durableConfirmedReplay.tipHeight === tipHeight &&
    durableConfirmedReplay.tipHash === normalizedTargetHash;
  const idleProofReady =
    !idleState ||
    (worker.ok === true &&
      String(worker.lastSuccessAt ?? "") === finishedAt &&
      currentWorkPrecision.era === "q16" &&
      (currentFullReplayReady
        ? replayCommitmentsEqual(currentReplay, durableReplay)
        : currentConfirmedReplayReady
          ? currentConfirmedMatchesDurable
          : idleDurableConfirmedProofReady));
  const replay = replayCommitments(durableReplay);
  const durableConfirmedProofReady =
    operationalStatus?.network === network &&
    worker.network === network &&
    stateReady &&
    idleProofReady &&
    finishedAt.length > 0 &&
    String(worker.lastSuccessAt ?? "") === finishedAt &&
    durableWorkPrecision.era === "q16" &&
    durableConfirmedReplay.ready === true &&
    durableConfirmedReplay.tipHeight === tipHeight &&
    durableConfirmedReplay.tipHash === normalizedTargetHash;
  const pendingReady =
    durableConfirmedProofReady &&
    durableReplay.era === "q16" &&
    durableReplay.ready === true &&
    durableReplay.replayRequired === true &&
    Number.isSafeInteger(replay.tipHeight) &&
    replay.tipHeight === tipHeight &&
    /^[0-9a-f]{64}$/u.test(replay.tipHash) &&
    replay.tipHash === normalizedTargetHash &&
    Number.isSafeInteger(replay.mempoolCount) &&
    replay.mempoolCount >= 0 &&
    /^[0-9a-f]{64}$/u.test(replay.mempoolSha256) &&
    Number.isSafeInteger(replay.pendingMembershipCount) &&
    replay.pendingMembershipCount >= 0 &&
    /^[0-9a-f]{64}$/u.test(replay.pendingMembershipSha256) &&
    /^[0-9a-f]{64}$/u.test(replay.pendingProjectionSha256);
  const ready = currentConfirmedProofReady || durableConfirmedProofReady;
  const proofReplay = currentConfirmedProofReady
    ? currentConfirmedReplay
    : durableConfirmedReplay;
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
    pendingReady,
    proofSource: currentConfirmedProofReady
      ? "current-confirmed-replay"
      : idleState
        ? "idle-confirmed-replay"
        : "last-success-confirmed-replay",
    ready,
    state: workerState,
    tipHash: proofReplay.tipHash,
    tipHeight: proofReplay.tipHeight,
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
