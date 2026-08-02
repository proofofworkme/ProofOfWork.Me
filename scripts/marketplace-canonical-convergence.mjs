const RETRYABLE_CANONICAL_READ_CODES = new Set([
  "CANONICAL_INDEX_CATCHING_UP",
  "CANONICAL_SUMMARY_CATCHING_UP",
  "CANONICAL_SUMMARY_CHECKPOINT_UNAVAILABLE",
  "CANONICAL_SUMMARY_TIP_CHANGED",
  "CANONICAL_SUMMARY_UNAVAILABLE",
  "CANONICAL_WALLET_INDEX_UNAVAILABLE",
]);

const RETRYABLE_CANONICAL_READ_MESSAGES = [
  /^Fresh credit state is still catching up for [^.]+\.$/u,
  /^The canonical ProofOfWork index is catching up to the Bitcoin Core tip\.$/u,
  /^The canonical ProofOfWork summary snapshot is catching up\.$/u,
];

const MARKETPLACE_REGRESSION_FRESH_CANONICAL_PATHS = new Set([
  "/api/v1/growth-summary",
  "/api/v1/log",
  "/api/v1/log-history",
  "/api/v1/marketplace-summary",
  "/api/v1/token",
  "/api/v1/token-history",
  "/api/v1/token-summary",
  "/api/v1/work-summary",
]);

function positiveFiniteDuration(value, label) {
  const duration = Number(value);
  if (!Number.isFinite(duration) || duration <= 0) {
    throw new TypeError(`${label} must be a positive finite duration.`);
  }
  return duration;
}

function defaultSleep(delayMs) {
  return new Promise((resolve) => setTimeout(resolve, delayMs));
}

function canonicalHash(value) {
  const hash = String(value ?? "")
    .trim()
    .toLowerCase();
  return /^[0-9a-f]{64}$/u.test(hash) ? hash : "";
}

function canonicalRebuildIsComplete(value) {
  return (
    value &&
    typeof value === "object" &&
    value.active !== true &&
    value.complete === true &&
    String(value.status ?? "").trim().toLowerCase() === "complete"
  );
}

function canonicalReadDetailsHaveHardFailure(details) {
  if (!details || typeof details !== "object") {
    return false;
  }
  if (
    details.timedOut === true ||
    details.readModelsOk === false ||
    details.fault?.active === true
  ) {
    return true;
  }
  const storedHash = canonicalHash(details.storedHash);
  const canonicalTipHash = canonicalHash(details.canonicalHash);
  if (storedHash && canonicalTipHash && storedHash !== canonicalTipHash) {
    return true;
  }
  if (
    details.rebuild &&
    typeof details.rebuild === "object" &&
    !canonicalRebuildIsComplete(details.rebuild)
  ) {
    return true;
  }
  return ["firstGate", "finalGate"].some((key) =>
    canonicalReadDetailsHaveHardFailure(details[key]),
  );
}

function canonicalIndexUnavailableProvesTipCatchUp(details) {
  if (
    !details ||
    typeof details !== "object" ||
    canonicalReadDetailsHaveHardFailure(details) ||
    details.readModelsOk !== true ||
    !canonicalRebuildIsComplete(details.rebuild)
  ) {
    return false;
  }
  const indexedThroughBlock = Number(details.indexedThroughBlock);
  const tipHeight = Number(details.tipHeight);
  const lagBlocks = Number(details.lagBlocks);
  const storedHash = canonicalHash(details.storedHash);
  const indexedCanonicalHash = canonicalHash(details.canonicalHash);
  return (
    Number.isSafeInteger(indexedThroughBlock) &&
    Number.isSafeInteger(tipHeight) &&
    Number.isSafeInteger(lagBlocks) &&
    indexedThroughBlock > 0 &&
    tipHeight > indexedThroughBlock &&
    lagBlocks === tipHeight - indexedThroughBlock &&
    lagBlocks > 0 &&
    storedHash !== "" &&
    storedHash === indexedCanonicalHash &&
    details.fault?.active !== true
  );
}

function convergenceTimeout(label, maxWaitMs, cause) {
  return new CanonicalConvergenceTimeoutError(label, maxWaitMs, cause);
}

export class MarketplaceRegressionHttpError extends Error {
  constructor(url, statusCode, payload = null) {
    const serverMessage = String(
      payload?.error ?? payload?.message ?? "",
    ).trim();
    const code = String(
      payload?.details?.code ?? payload?.code ?? "",
    ).trim();
    super(
      `${url} returned HTTP ${statusCode}${
        code ? ` (${code})` : ""
      }${serverMessage ? `: ${serverMessage}` : ""}`,
    );
    this.name = "MarketplaceRegressionHttpError";
    this.code = code;
    this.responsePayload = payload;
    this.serverMessage = serverMessage;
    this.statusCode = statusCode;
    this.url = String(url);
  }
}

export class CanonicalConvergenceTimeoutError extends Error {
  constructor(label, maxWaitMs, cause) {
    super(
      `${label} did not converge within ${maxWaitMs}ms${
        cause?.message ? `: ${cause.message}` : ""
      }`,
      cause ? { cause } : undefined,
    );
    this.name = "CanonicalConvergenceTimeoutError";
    this.maxWaitMs = maxWaitMs;
  }
}

export function createCanonicalConvergenceBudget(maxWaitMs) {
  const boundedMaxWaitMs = positiveFiniteDuration(maxWaitMs, "maxWaitMs");
  return {
    maxWaitMs: boundedMaxWaitMs,
    remainingMs: boundedMaxWaitMs,
  };
}

export function marketplaceRegressionCanonicalReadKind({
  params,
  path,
  workTokenId,
}) {
  if (
    String(params?.network ?? "livenet").trim().toLowerCase() !==
      "livenet" ||
    !/^(?:1|true|yes)$/iu.test(String(params?.fresh ?? "").trim()) ||
    !MARKETPLACE_REGRESSION_FRESH_CANONICAL_PATHS.has(String(path ?? ""))
  ) {
    return "";
  }
  const asset = String(
    params?.asset ?? params?.tokenId ?? params?.ticker ?? "",
  )
    .trim()
    .toLowerCase();
  return (
    path === "/api/v1/token" &&
    asset !== "" &&
    asset === String(workTokenId ?? "").trim().toLowerCase()
  )
    ? "work-token"
    : "canonical";
}

export function isRetryableWorkAmoV5TipRaceStatus(
  status,
  {
    activationHeight,
    allowedFaceUsdCents,
    authVersion,
    declarationBlockHash,
    declarationBlockIndex,
    declarationHeight,
    declarationTxid,
    maxQuoteAgeBlocks,
    models,
  } = {},
) {
  return (
    status?.active === true &&
    status.authVersion === authVersion &&
    status.declarationConfirmed === true &&
    status.declarationTxid === declarationTxid &&
    status.declarationBlockHash === declarationBlockHash &&
    Number(status.declarationHeight) === declarationHeight &&
    Number(status.declarationBlockIndex) === declarationBlockIndex &&
    Number(status.activationHeight) === activationHeight &&
    JSON.stringify(status.allowedFaceUsdCents) ===
      JSON.stringify(allowedFaceUsdCents) &&
    Number(status.maxQuoteAgeBlocks) === maxQuoteAgeBlocks &&
    models &&
    typeof models === "object" &&
    Object.entries(models).every(
      ([key, value]) => status.models?.[key] === value,
    ) &&
    status.indexReady === false &&
    status.quoteReady === false &&
    status.quoteHead === null &&
    status.protocolWritesEnabled === false &&
    status.listingWritesEnabled === false &&
    status.writesEnabled === false &&
    status.reasonCode === "work-amo-v5-index-not-ready"
  );
}

export function isRetryableCanonicalReadError(error) {
  if (
    !(error instanceof MarketplaceRegressionHttpError) ||
    error.statusCode !== 503
  ) {
    return false;
  }
  const details = error.responsePayload?.details;
  if (canonicalReadDetailsHaveHardFailure(details)) {
    return false;
  }
  if (error.code === "CANONICAL_INDEX_UNAVAILABLE") {
    return canonicalIndexUnavailableProvesTipCatchUp(details);
  }
  if (RETRYABLE_CANONICAL_READ_CODES.has(error.code)) {
    return true;
  }
  return RETRYABLE_CANONICAL_READ_MESSAGES.some((pattern) =>
    pattern.test(error.serverMessage),
  );
}

export async function waitForCanonicalConvergence({
  isReady,
  isRetryableValue,
  label,
  maxWaitMs,
  now = Date.now,
  onRetry = () => {},
  pollIntervalMs,
  read,
  sleep = defaultSleep,
}) {
  if (typeof read !== "function") {
    throw new TypeError("Canonical convergence read must be a function.");
  }
  if (typeof isReady !== "function") {
    throw new TypeError("Canonical convergence readiness must be a function.");
  }
  if (typeof isRetryableValue !== "function") {
    throw new TypeError(
      "Canonical convergence value classifier must be a function.",
    );
  }
  const boundedMaxWaitMs = positiveFiniteDuration(maxWaitMs, "maxWaitMs");
  const boundedPollIntervalMs = positiveFiniteDuration(
    pollIntervalMs,
    "pollIntervalMs",
  );
  const startedAt = now();
  let attempt = 0;
  let lastRetryableError = null;

  while (true) {
    const elapsedBeforeRead = Math.max(0, now() - startedAt);
    if (elapsedBeforeRead >= boundedMaxWaitMs) {
      throw convergenceTimeout(
        label,
        boundedMaxWaitMs,
        lastRetryableError,
      );
    }
    attempt += 1;
    const remainingBeforeRead = Math.max(
      1,
      Math.ceil(boundedMaxWaitMs - elapsedBeforeRead),
    );
    try {
      const value = await read({
        attempt,
        elapsedMs: elapsedBeforeRead,
        remainingMs: remainingBeforeRead,
      });
      const elapsedAfterRead = Math.max(0, now() - startedAt);
      if (elapsedAfterRead >= boundedMaxWaitMs) {
        throw convergenceTimeout(
          label,
          boundedMaxWaitMs,
          lastRetryableError,
        );
      }
      if (isReady(value)) {
        return value;
      }
      if (!isRetryableValue(value)) {
        return value;
      }
      lastRetryableError = null;
    } catch (error) {
      if (error instanceof CanonicalConvergenceTimeoutError) {
        throw error;
      }
      if (!isRetryableCanonicalReadError(error)) {
        throw error;
      }
      lastRetryableError = error;
    }

    const elapsedMs = Math.max(0, now() - startedAt);
    if (elapsedMs >= boundedMaxWaitMs) {
      throw convergenceTimeout(
        label,
        boundedMaxWaitMs,
        lastRetryableError,
      );
    }
    const delayMs = Math.min(
      boundedPollIntervalMs,
      boundedMaxWaitMs - elapsedMs,
    );
    onRetry({
      attempt,
      delayMs,
      elapsedMs,
      error: lastRetryableError,
    });
    await sleep(delayMs);
  }
}

export async function waitForCanonicalConvergenceWithinBudget({
  budget,
  now = Date.now,
  onRetry = () => {},
  ...options
}) {
  if (
    !budget ||
    typeof budget !== "object" ||
    !Number.isFinite(Number(budget.maxWaitMs)) ||
    !Number.isFinite(Number(budget.remainingMs))
  ) {
    throw new TypeError(
      "Canonical convergence budget must be created by createCanonicalConvergenceBudget().",
    );
  }
  const remainingAtStart = Math.max(0, Number(budget.remainingMs));
  if (remainingAtStart <= 0) {
    throw convergenceTimeout(
      options.label,
      Number(budget.maxWaitMs),
      null,
    );
  }
  const startedAt = now();
  let convergenceObserved = false;
  let timedOut = false;
  try {
    return await waitForCanonicalConvergence({
      ...options,
      maxWaitMs: remainingAtStart,
      now,
      onRetry: (retry) => {
        convergenceObserved = true;
        onRetry(retry);
      },
    });
  } catch (error) {
    timedOut = error instanceof CanonicalConvergenceTimeoutError;
    throw error;
  } finally {
    if (convergenceObserved || timedOut) {
      const elapsedMs = Math.max(0, now() - startedAt);
      budget.remainingMs = Math.max(
        0,
        remainingAtStart - Math.min(remainingAtStart, elapsedMs),
      );
    }
  }
}
