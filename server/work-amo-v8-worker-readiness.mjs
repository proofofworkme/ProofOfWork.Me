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

export function exactWorkAmoV8WorkerReadiness(
  operationalStatus,
  { liveMempoolSnapshot, network, tipHash, tipHeight },
) {
  const worker = objectRecord(operationalStatus?.worker);
  const workerState = String(worker.state ?? "");
  const lastSuccess = objectRecord(worker.lastSuccess);
  const durableWorkPrecision = objectRecord(lastSuccess.workPrecision);
  const durableReplay = objectRecord(durableWorkPrecision.replay);
  const currentWorkPrecision = objectRecord(worker.workPrecision);
  const currentReplay = objectRecord(currentWorkPrecision.replay);
  const finishedAt = String(lastSuccess.finishedAt ?? "");
  const transientState = WORK_AMO_V8_TRANSIENT_WORKER_STATES.has(
    workerState,
  );
  const idleState = workerState === "idle";
  const stateReady = idleState || transientState;
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
    liveMempoolSnapshot?.model ===
      "canonical-core-mempool-txid-set-v1" &&
    Number.isSafeInteger(replay.mempoolCount) &&
    replay.mempoolCount >= 0 &&
    /^[0-9a-f]{64}$/u.test(replay.mempoolSha256) &&
    Number.isSafeInteger(replay.pendingMembershipCount) &&
    replay.pendingMembershipCount >= 0 &&
    /^[0-9a-f]{64}$/u.test(replay.pendingMembershipSha256) &&
    /^[0-9a-f]{64}$/u.test(replay.pendingProjectionSha256);
  return {
    era: String(durableWorkPrecision.era ?? ""),
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
