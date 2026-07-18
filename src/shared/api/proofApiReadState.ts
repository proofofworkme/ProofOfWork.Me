export type ProofApiErrorOptions = {
  code?: string;
  details?: Record<string, unknown>;
  status: number;
  timedOut?: boolean;
};

export type ProofApiLastGoodStatusOptions = {
  indexedAt?: string;
  indexedThroughBlock?: number;
  label?: string;
  snapshotId?: string;
};

export type ProofApiReadWarning = {
  attempt: number;
  source: string;
  text: string;
};

export type ProofApiReadWarningStore = Map<
  string,
  Map<string, ProofApiReadWarning>
>;

export class ProofApiRequestError extends Error {
  readonly code: string;
  readonly details: Record<string, unknown>;
  readonly status: number;
  readonly timedOut: boolean;

  constructor(message: string, options: ProofApiErrorOptions) {
    super(message);
    this.name = "ProofApiRequestError";
    this.code = options.code ?? "";
    this.details = options.details ?? {};
    this.status = options.status;
    this.timedOut = options.timedOut === true;
  }
}

function objectValue(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function stringValue(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function safeNonNegativeInteger(value: unknown) {
  const numberValue = Number(value);
  return Number.isSafeInteger(numberValue) && numberValue >= 0
    ? numberValue
    : undefined;
}

export function isTransientProofApiReadError(error: unknown) {
  if (error instanceof ProofApiRequestError) {
    return (
      error.code === "CANONICAL_INDEX_UNAVAILABLE" ||
      error.code === "CANONICAL_INDEX_CATCHING_UP" ||
      error.code === "CANONICAL_SUMMARY_UNAVAILABLE" ||
      error.status === 502 ||
      error.status === 503 ||
      error.status === 504
    );
  }

  return (
    error instanceof Error &&
    (/Failed to fetch/iu.test(error.message) ||
      /ProofOfWork API refresh took too long/iu.test(error.message))
  );
}

export function proofApiLastGoodReadStatus(
  error: unknown,
  options: ProofApiLastGoodStatusOptions = {},
) {
  if (!isTransientProofApiReadError(error)) {
    return "";
  }

  const details = error instanceof ProofApiRequestError ? error.details : {};
  const summarySnapshot = objectValue(details.summarySnapshot);
  const indexedThroughBlock =
    safeNonNegativeInteger(details.indexedThroughBlock) ??
    safeNonNegativeInteger(summarySnapshot?.indexedThroughBlock) ??
    safeNonNegativeInteger(options.indexedThroughBlock);
  const tipHeight = safeNonNegativeInteger(details.tipHeight);
  const explicitLagBlocks = safeNonNegativeInteger(details.lagBlocks);
  const lagBlocks =
    explicitLagBlocks ??
    (indexedThroughBlock !== undefined && tipHeight !== undefined
      ? Math.max(0, tipHeight - indexedThroughBlock)
      : undefined);
  const snapshotId =
    stringValue(summarySnapshot?.snapshotId) || stringValue(options.snapshotId);
  const indexedAt =
    stringValue(summarySnapshot?.indexedAt) || stringValue(options.indexedAt);
  const references: string[] = [];

  if (indexedThroughBlock !== undefined) {
    references.push(`block ${indexedThroughBlock.toLocaleString()}`);
  }
  if (snapshotId) {
    references.push(`snapshot ${snapshotId}`);
  }
  if (references.length === 0 && indexedAt) {
    const indexedDate = new Date(indexedAt);
    references.push(
      Number.isNaN(indexedDate.getTime())
        ? `snapshot indexed ${indexedAt}`
        : `snapshot indexed ${indexedDate.toLocaleString()}`,
    );
  }

  const label = options.label?.trim() || "ProofOfWork";
  const code = error instanceof ProofApiRequestError ? error.code : "";
  const explicitlyUnavailable =
    code === "CANONICAL_INDEX_UNAVAILABLE" ||
    code === "CANONICAL_SUMMARY_UNAVAILABLE";
  const isCatchingUp =
    !explicitlyUnavailable &&
    (code === "CANONICAL_INDEX_CATCHING_UP" ||
      (explicitLagBlocks !== undefined && explicitLagBlocks > 0));
  const lagText =
    isCatchingUp && lagBlocks !== undefined && lagBlocks > 0
      ? `, ${lagBlocks.toLocaleString()} block${lagBlocks === 1 ? "" : "s"} behind the full-node tip${tipHeight !== undefined ? ` at ${tipHeight.toLocaleString()}` : ""}`
      : "";
  const referenceText =
    references.length > 0 ? ` ${references.join(", ")}` : " indexed data";

  return `${label} exact-tip refresh ${isCatchingUp ? "is catching up" : "is temporarily unavailable"}${lagText}. Showing verified last-good${referenceText}. This view is not current. Exact-tip actions remain unavailable.`;
}

export function setProofApiReadWarning(
  store: ProofApiReadWarningStore,
  workspace: string,
  warning: ProofApiReadWarning,
) {
  const bySource = store.get(workspace) ?? new Map<string, ProofApiReadWarning>();
  const current = bySource.get(warning.source);
  if (current && current.attempt > warning.attempt) {
    return false;
  }
  bySource.set(warning.source, warning);
  store.set(workspace, bySource);
  return true;
}

export function clearProofApiReadWarning(
  store: ProofApiReadWarningStore,
  workspace: string,
  source: string,
  successfulAttempt: number,
) {
  const bySource = store.get(workspace);
  const current = bySource?.get(source);
  if (!bySource || !current || current.attempt > successfulAttempt) {
    return false;
  }

  bySource.delete(source);
  if (bySource.size === 0) {
    store.delete(workspace);
  }
  return true;
}

export function currentProofApiReadWarning(
  store: ProofApiReadWarningStore,
  workspace: string,
) {
  const warnings = [...(store.get(workspace)?.values() ?? [])];
  return warnings.reduce<ProofApiReadWarning | undefined>(
    (latest, warning) =>
      !latest || warning.attempt > latest.attempt ? warning : latest,
    undefined,
  );
}
