function sourceList(...values) {
  return [
    ...new Set(
      values
        .flatMap((value) => (Array.isArray(value) ? value : []))
        .map((value) => String(value ?? "").trim())
        .filter(Boolean),
    ),
  ];
}

export const TX_LIFECYCLE_INPUT_OUTPOINTS_MODEL =
  "proof-of-work-lifecycle-input-outpoints-v1";
export const TX_LIFECYCLE_MAX_INPUT_OUTPOINTS = 32;

const CANONICAL_MAIL_ATTACHED_CREDITS = Symbol(
  "proof-of-work-canonical-mail-attached-credits",
);

export function exactCoreTipFromBlockchainInfo(response) {
  const info = response?.ok === true ? response.result : null;
  const height = Number(info?.blocks);
  const headers = Number(info?.headers);
  const verificationProgress = Number(info?.verificationprogress);
  const blockHash = String(info?.bestblockhash ?? "").trim().toLowerCase();
  if (
    info?.chain !== "main" ||
    info?.initialblockdownload !== false ||
    !Number.isSafeInteger(height) ||
    height <= 0 ||
    !Number.isSafeInteger(headers) ||
    headers !== height ||
    !Number.isFinite(verificationProgress) ||
    verificationProgress < 0.999 ||
    !/^[0-9a-f]{64}$/u.test(blockHash)
  ) {
    return null;
  }
  return { blockHash, height };
}

export function exactCoreNodeAuthority(chainResponse, indexResponse) {
  const tip = exactCoreTipFromBlockchainInfo(chainResponse);
  const chain = chainResponse?.ok === true ? chainResponse.result : null;
  const txindex =
    indexResponse?.ok === true ? indexResponse.result?.txindex : null;
  const txindexHeight = Number(txindex?.best_block_height);
  if (
    !tip ||
    chain?.pruned !== false ||
    !txindex ||
    txindex.synced !== true ||
    !Number.isSafeInteger(txindexHeight) ||
    txindexHeight !== tip.height
  ) {
    return null;
  }
  return {
    ...tip,
    txindexHeight,
    verificationProgress: Number(chain.verificationprogress),
  };
}

function lifecycleTxid(value) {
  const txid = String(value ?? "").trim().toLowerCase();
  return /^[0-9a-f]{64}$/u.test(txid) ? txid : "";
}

function lifecycleInputLimit(value) {
  const limit = Number(value);
  return Number.isSafeInteger(limit) && limit > 0
    ? Math.min(limit, TX_LIFECYCLE_MAX_INPUT_OUTPOINTS)
    : TX_LIFECYCLE_MAX_INPUT_OUTPOINTS;
}

/** Build bounded, immutable input identity evidence while the tx is in Core. */
export function lifecycleInputOutpointsFromTransaction(
  transaction,
  { maxInputs = TX_LIFECYCLE_MAX_INPUT_OUTPOINTS } = {},
) {
  const vin = Array.isArray(transaction?.vin) ? transaction.vin : [];
  const maximum = lifecycleInputLimit(maxInputs);
  const inputCount = vin.length;
  const outpoints = [];
  const seen = new Set();
  let complete = inputCount > 0 && inputCount <= maximum;
  for (const input of vin.slice(0, maximum)) {
    const txid = lifecycleTxid(input?.txid);
    const vout = Number(input?.vout);
    const key = `${txid}:${vout}`;
    if (
      !txid ||
      !Number.isSafeInteger(vout) ||
      vout < 0 ||
      seen.has(key)
    ) {
      complete = false;
      continue;
    }
    seen.add(key);
    outpoints.push({ txid, vout });
  }
  if (outpoints.length !== inputCount) {
    complete = false;
  }
  return {
    complete,
    inputCount,
    model: TX_LIFECYCLE_INPUT_OUTPOINTS_MODEL,
    outpoints,
  };
}

export function canonicalLifecycleInputOutpointsEvidence(
  value,
  { maxInputs = TX_LIFECYCLE_MAX_INPUT_OUTPOINTS } = {},
) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  const maximum = lifecycleInputLimit(maxInputs);
  const inputCount = Number(value.inputCount);
  const sourceOutpoints = Array.isArray(value.outpoints)
    ? value.outpoints
    : null;
  if (
    value.model !== TX_LIFECYCLE_INPUT_OUTPOINTS_MODEL ||
    typeof value.complete !== "boolean" ||
    !Number.isSafeInteger(inputCount) ||
    inputCount < 0 ||
    !sourceOutpoints ||
    sourceOutpoints.length > maximum
  ) {
    return null;
  }
  const seen = new Set();
  const outpoints = [];
  for (const outpoint of sourceOutpoints) {
    const txid = lifecycleTxid(outpoint?.txid);
    const vout = Number(outpoint?.vout);
    const key = `${txid}:${vout}`;
    if (
      !txid ||
      !Number.isSafeInteger(vout) ||
      vout < 0 ||
      seen.has(key)
    ) {
      return null;
    }
    seen.add(key);
    outpoints.push({ txid, vout });
  }
  const complete = value.complete === true;
  if (
    complete &&
    (inputCount < 1 || inputCount > maximum || outpoints.length !== inputCount)
  ) {
    return null;
  }
  if (!complete && outpoints.length > inputCount) {
    return null;
  }
  return {
    complete,
    inputCount,
    model: TX_LIFECYCLE_INPUT_OUTPOINTS_MODEL,
    outpoints,
  };
}

/** Resolve only an exact, current single spender; ambiguity stays nonterminal. */
export function replacementDispositionFromSpenderEvidence({
  inputEvidence,
  originalTxid,
  spendingPrevouts,
} = {}) {
  const original = lifecycleTxid(originalTxid);
  const evidence = canonicalLifecycleInputOutpointsEvidence(inputEvidence);
  if (!original || !evidence?.complete) {
    return {
      kind: "unknown",
      reason: "original-input-outpoint-evidence-incomplete",
    };
  }
  if (
    !Array.isArray(spendingPrevouts) ||
    spendingPrevouts.length !== evidence.outpoints.length
  ) {
    return {
      kind: "unknown",
      reason: "bitcoin-core-spending-prevout-evidence-invalid",
    };
  }
  const expected = new Set(
    evidence.outpoints.map((outpoint) => `${outpoint.txid}:${outpoint.vout}`),
  );
  const observed = new Set();
  const candidates = new Set();
  for (const result of spendingPrevouts) {
    const txid = lifecycleTxid(result?.txid);
    const vout = Number(result?.vout);
    const key = `${txid}:${vout}`;
    const rawSpender = String(result?.spendingtxid ?? "").trim();
    const spender = rawSpender ? lifecycleTxid(rawSpender) : "";
    if (
      !txid ||
      !Number.isSafeInteger(vout) ||
      vout < 0 ||
      !expected.has(key) ||
      observed.has(key) ||
      (rawSpender && !spender)
    ) {
      return {
        kind: "unknown",
        reason: "bitcoin-core-spending-prevout-evidence-invalid",
      };
    }
    observed.add(key);
    if (spender && spender !== original) {
      candidates.add(spender);
    }
  }
  if (observed.size !== expected.size) {
    return {
      kind: "unknown",
      reason: "bitcoin-core-spending-prevout-evidence-invalid",
    };
  }
  const replacementCandidates = [...candidates].sort();
  if (replacementCandidates.length === 0) {
    return { kind: "none", replacementCandidates };
  }
  if (replacementCandidates.length !== 1) {
    return {
      kind: "unknown",
      reason: "ambiguous-current-input-spenders",
      replacementCandidates,
    };
  }
  return {
    kind: "replacement",
    replacementCandidates,
    replacementTxid: replacementCandidates[0],
  };
}

export function replacementDispositionFromTxOutEvidence({
  inputEvidence,
  txOutEvidence,
} = {}) {
  const evidence = canonicalLifecycleInputOutpointsEvidence(inputEvidence);
  if (
    !evidence?.complete ||
    !Array.isArray(txOutEvidence) ||
    txOutEvidence.length !== evidence.outpoints.length
  ) {
    return {
      kind: "unknown",
      reason: "bitcoin-core-utxo-evidence-invalid",
    };
  }
  const expected = new Set(
    evidence.outpoints.map((outpoint) => `${outpoint.txid}:${outpoint.vout}`),
  );
  const observed = new Set();
  let spent = false;
  for (const result of txOutEvidence) {
    const txid = lifecycleTxid(result?.txid);
    const vout = Number(result?.vout);
    const key = `${txid}:${vout}`;
    if (
      !txid ||
      !Number.isSafeInteger(vout) ||
      vout < 0 ||
      !expected.has(key) ||
      observed.has(key) ||
      typeof result?.unspent !== "boolean"
    ) {
      return {
        kind: "unknown",
        reason: "bitcoin-core-utxo-evidence-invalid",
      };
    }
    observed.add(key);
    spent ||= result.unspent === false;
  }
  if (observed.size !== expected.size) {
    return {
      kind: "unknown",
      reason: "bitcoin-core-utxo-evidence-invalid",
    };
  }
  return spent
    ? {
        kind: "unknown",
        reason: "full-node-input-spent-without-exact-replacement-txid",
      }
    : { kind: "none" };
}

export function verifiedReplacementLifecycle({
  candidateSource,
  coreAbsence,
  inputEvidence,
  originalTxid,
  replacementStatus,
  replacementTxid,
} = {}) {
  const original = lifecycleTxid(originalTxid);
  const replacement = lifecycleTxid(replacementTxid);
  const evidence = canonicalLifecycleInputOutpointsEvidence(inputEvidence);
  const currentStatus = String(replacementStatus?.status ?? "")
    .trim()
    .toLowerCase();
  if (
    !original ||
    !replacement ||
    original === replacement ||
    !evidence?.complete ||
    coreAbsence?.absenceProven !== true ||
    coreAbsence?.status !== "dropped" ||
    !["confirmed", "pending"].includes(currentStatus) ||
    ![
      "bitcoin-core-mempool-spender",
      "canonical-confirmed-input-index-and-bitcoin-core",
    ].includes(candidateSource)
  ) {
    throw new TypeError("Verified replacement lifecycle evidence is incomplete.");
  }
  const { droppedAt: _droppedAt, ...absence } = coreAbsence;
  return {
    ...absence,
    confirmed: false,
    reason: "original-input-spent-by-one-current-full-node-verified-transaction",
    replacedByTxid: replacement,
    replacementEvidence: {
      candidateSource,
      inputEvidenceModel: evidence.model,
      model: "proof-of-work-tx-replacement-v1",
      replacementStatus: currentStatus,
      replacementTxid: replacement,
    },
    replacementStatus: currentStatus,
    replacementTxid: replacement,
    sources: sourceList(coreAbsence.sources, ["bitcoin-core:gettxspendingprevout"], replacementStatus.sources),
    status: "replaced",
    txid: original,
    verified: true,
  };
}

const MAIL_LIFECYCLE_STATUSES = new Set([
  "confirmed",
  "dropped",
  "failed",
  "pending",
  "replaced",
  "unknown",
]);

function lifecycleTimestamp(lifecycle) {
  for (const value of [
    lifecycle?.observedAt,
    lifecycle?.indexedAt,
    lifecycle?.updatedAt,
  ]) {
    const timeMs = Date.parse(String(value ?? ""));
    if (Number.isFinite(timeMs)) {
      return new Date(timeMs).toISOString();
    }
  }
  return new Date().toISOString();
}

/** Mark credit attachments derived from confirmed canonical projection rows. */
export function withCanonicalMailAttachedCredits(message) {
  const confirmed =
    message?.confirmed === true || message?.status === "confirmed";
  if (
    !confirmed ||
    !Array.isArray(message?.attachedCredits) ||
    message.attachedCredits.length === 0
  ) {
    return message;
  }
  return {
    ...message,
    [CANONICAL_MAIL_ATTACHED_CREDITS]: true,
  };
}

/** Apply one current canonical lifecycle result without retaining stale terminal fields. */
export function mailMessageWithTxLifecycle(message, lifecycle) {
  const lifecycleStatus = String(lifecycle?.status ?? "").trim().toLowerCase();
  const status = MAIL_LIFECYCLE_STATUSES.has(lifecycleStatus)
    ? lifecycleStatus
    : "unknown";
  const observedAt = lifecycleTimestamp(lifecycle);
  const replacementTxid = String(
    lifecycle?.replacementTxid ?? lifecycle?.replacedByTxid ?? "",
  )
    .trim()
    .toLowerCase();
  const confirmed = status === "confirmed";
  const terminal = ["dropped", "failed", "replaced"].includes(status);
  const canonicalAttachedCredits =
    message?.[CANONICAL_MAIL_ATTACHED_CREDITS] === true &&
    Array.isArray(message?.attachedCredits) &&
    message.attachedCredits.length > 0;
  const {
    [CANONICAL_MAIL_ATTACHED_CREDITS]: _canonicalAttachedCredits,
    ...publicMessage
  } = message ?? {};
  return {
    ...publicMessage,
    attachedCredits:
      terminal || (confirmed && !canonicalAttachedCredits)
        ? undefined
        : message?.attachedCredits,
    confirmed,
    confirmedAt: confirmed
      ? lifecycle?.blockTime ?? message?.confirmedAt ?? observedAt
      : undefined,
    droppedAt:
      status === "dropped"
        ? lifecycle?.droppedAt ?? observedAt
        : undefined,
    failedAt:
      status === "failed"
        ? lifecycle?.failedAt ?? observedAt
        : undefined,
    lastCheckedAt: observedAt,
    lifecycleTransition: lifecycle?.lifecycleTransition ?? undefined,
    previousStatus: lifecycle?.previousStatus ?? undefined,
    reason: lifecycle?.reason ?? undefined,
    replacedByTxid:
      status === "replaced" && /^[0-9a-f]{64}$/u.test(replacementTxid)
        ? replacementTxid
        : undefined,
    replacementTxid:
      status === "replaced" && /^[0-9a-f]{64}$/u.test(replacementTxid)
        ? replacementTxid
        : undefined,
    status,
    verified: lifecycle?.verified,
  };
}

/**
 * Reconcile a current full-node observation with durable indexed lifecycle
 * metadata. The caller must fail closed before this point if Core is
 * unavailable or its evidence is incomplete.
 */
export function reconcileLivenetTxLifecycle({
  absenceObservation = false,
  coreStatus,
  indexedStatus = null,
  network = "livenet",
  txid,
} = {}) {
  if (!coreStatus || typeof coreStatus !== "object") {
    throw new TypeError("Current full-node transaction evidence is required.");
  }
  if (coreStatus.status !== "dropped") {
    const indexedConfirmationMismatch =
      indexedStatus?.status === "confirmed" &&
      (coreStatus.status !== "confirmed" ||
        indexedStatus.blockHash !== coreStatus.blockHash ||
        indexedStatus.blockHeight !== coreStatus.blockHeight);
    return {
      ...coreStatus,
      ...(indexedStatus
        ? {
            firstSeenAt:
              indexedStatus.firstSeenAt ?? coreStatus.mempoolFirstSeenAt,
            previousStatus: indexedStatus.status,
            previouslySeen: true,
          }
        : { previouslySeen: false }),
      ...(indexedConfirmationMismatch
        ? {
            indexedStatusMismatch: {
              blockHash: indexedStatus.blockHash ?? null,
              blockHeight: indexedStatus.blockHeight ?? null,
              status: indexedStatus.status,
            },
            lifecycleTransition: `confirmed-to-${coreStatus.status}`,
          }
        : {}),
    };
  }

  if (absenceObservation) {
    return {
      ...coreStatus,
      observationOnly: true,
      previousStatus: indexedStatus?.status ?? null,
      previouslySeen: Boolean(indexedStatus),
    };
  }

  if (
    indexedStatus?.status === "replaced" &&
    coreStatus?.replacementCheck?.model ===
      "proof-of-work-tx-replacement-check-v1"
  ) {
    return {
      confirmed: false,
      contract: "proof-of-work-tx-status-v2",
      currentAbsenceProven: true,
      firstSeenAt: indexedStatus.firstSeenAt,
      indexedAt: coreStatus.observedAt,
      lastSeenAt: indexedStatus.lastSeenAt,
      network,
      observedAt: coreStatus.observedAt,
      previousReplacementTxid:
        indexedStatus.replacementTxid ?? indexedStatus.replacedByTxid,
      previousStatus: "replaced",
      previouslySeen: true,
      reason: "previous-replacement-awaiting-durable-revalidation",
      replacementCheck: coreStatus.replacementCheck,
      sources: sourceList(indexedStatus.sources, coreStatus.sources),
      status: "unknown",
      txid,
      verified: false,
    };
  }

  if (
    indexedStatus?.status === "dropped" ||
    indexedStatus?.status === "replaced"
  ) {
    return {
      ...indexedStatus,
      currentAbsenceProven: true,
      observedAt: coreStatus.observedAt,
      ...(coreStatus.replacementCheck
        ? { replacementCheck: coreStatus.replacementCheck }
        : {}),
      sources: sourceList(indexedStatus.sources, coreStatus.sources),
    };
  }

  const previouslySeen = Boolean(indexedStatus);
  const staleIndexedConfirmation = indexedStatus?.status === "confirmed";
  return {
    confirmed: false,
    contract: "proof-of-work-tx-status-v2",
    currentAbsenceProven: true,
    ...(indexedStatus?.firstSeenAt
      ? { firstSeenAt: indexedStatus.firstSeenAt }
      : {}),
    indexedAt: coreStatus.observedAt,
    ...(indexedStatus?.lastSeenAt
      ? { lastSeenAt: indexedStatus.lastSeenAt }
      : {}),
    network,
    observedAt: coreStatus.observedAt,
    previousStatus: indexedStatus?.status ?? null,
    previouslySeen,
    reason: staleIndexedConfirmation
      ? "indexed-confirmation-no-longer-canonical-in-bitcoin-core"
      : previouslySeen
        ? "pending-transaction-absence-awaiting-durable-drop-threshold"
        : "transaction-has-no-durable-lifecycle-record",
    sources: sourceList(coreStatus.sources),
    status: "unknown",
    txid,
    verified: false,
    ...(coreStatus.replacementCheck
      ? { replacementCheck: coreStatus.replacementCheck }
      : {}),
    ...(staleIndexedConfirmation
      ? {
          indexedStatusMismatch: {
            blockHash: indexedStatus.blockHash ?? null,
            blockHeight: indexedStatus.blockHeight ?? null,
            status: indexedStatus.status,
          },
          lifecycleTransition: "confirmed-to-unknown",
        }
      : {}),
  };
}
