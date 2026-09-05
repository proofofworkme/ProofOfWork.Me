// A displayed zero is a fact only after its complete, qualified source loaded.
export function completeRegistryCounts(payload: {
  registryCounts?: {
    model?: unknown;
    complete?: unknown;
    confirmedCount?: unknown;
    pendingCount?: unknown;
    totalCount?: unknown;
  };
}) {
  const counts = payload.registryCounts;
  const values = [counts?.confirmedCount, counts?.pendingCount, counts?.totalCount];
  if (
    counts?.model !== "proof-registry-counts-v1" || counts.complete !== true ||
    !values.every((value) => typeof value === "number" && Number.isSafeInteger(value) && value >= 0) ||
    Number(counts.confirmedCount) + Number(counts.pendingCount) !== counts.totalCount
  ) {
    throw new Error("The complete ID counts are unavailable. Keeping the last verified counts.");
  }
  return {
    confirmedCount: counts.confirmedCount as number,
    pendingCount: counts.pendingCount as number,
    totalCount: counts.totalCount as number,
  };
}

export function assertCompleteTokenDirectory(payload: {
  directory?: { model?: unknown; complete?: unknown; totalCount?: unknown };
  tokens?: unknown;
}) {
  const directory = payload.directory;
  if (
    directory?.model !== "proof-token-directory-v1" || directory.complete !== true ||
    !Number.isSafeInteger(directory.totalCount) || !Array.isArray(payload.tokens) ||
    directory.totalCount !== payload.tokens.length
  ) {
    throw new Error("The complete credit directory is unavailable. Keeping the last verified directory.");
  }
}

export function walletReservationsReady(
  currentScope: string,
  idReservations: { scope: string; loaded: boolean; loading: boolean; error: string },
  lanes: Record<string, { loaded: boolean; loading: boolean; error: string }>,
) {
  return currentScope === idReservations.scope && idReservations.loaded &&
    !idReservations.loading && !idReservations.error &&
    ["all", "work", "powb", "incb"].every((lane) =>
      lanes[lane]?.loaded && !lanes[lane].loading && !lanes[lane].error,
    );
}

export function listingDisplayProjectionFingerprint(page: {
  itemProjection?: { model?: unknown; fullMembershipSha256?: unknown; fullSourceSha256?: unknown };
  items?: Array<{ listingId?: string; displayEvidence?: {
    model?: unknown; fullRecordSha256?: unknown; omittedFields?: unknown; fullDetailPath?: unknown;
  } }>;
}) {
  const projection = page.itemProjection;
  const hash = (value: unknown) => typeof value === "string" && /^[0-9a-f]{64}$/u.test(value);
  if (projection?.model !== "proof-token-listing-display-v1" ||
      !hash(projection.fullMembershipSha256) || !hash(projection.fullSourceSha256)) {
    throw new Error("Listing display projection lacks full evidence digests.");
  }
  const allowed = new Set(["workAmoV5ReplayOutput", "workAmoV5ReplayRawWitness", "workAmoV5RawScriptWitness"]);
  for (const item of page.items ?? []) {
    const evidence = item.displayEvidence;
    if (evidence?.model !== projection.model || !hash(evidence.fullRecordSha256) ||
        !Array.isArray(evidence.omittedFields) || !evidence.omittedFields.every((field) => allowed.has(field)) ||
        typeof evidence.fullDetailPath !== "string" || !evidence.fullDetailPath.startsWith("/api/v1/token-history?")) {
      throw new Error("Listing display row lacks retrievable full evidence.");
    }
    const query = new URL(evidence.fullDetailPath, "https://proof.invalid").searchParams;
    if (query.get("kind") !== "listings" || query.get("projection") !== "full" ||
        query.get("q") !== item.listingId || query.get("listingId") !== item.listingId) {
      throw new Error("Listing full evidence reference does not match its ID.");
    }
  }
  return JSON.stringify([projection.model, projection.fullMembershipSha256, projection.fullSourceSha256]);
}

export function assertCompleteIdReservations(payload: {
  listings?: unknown;
  summaryOnly?: boolean;
  collectionHasMore?: { listings?: boolean };
  totalCounts?: { listings?: number | null };
}) {
  const count = payload.totalCounts?.listings;
  if (!Array.isArray(payload.listings) || payload.summaryOnly === true ||
      payload.collectionHasMore?.listings === true ||
      (count !== undefined && count !== null &&
        (!Number.isSafeInteger(count) || count < 0 || count !== payload.listings.length))) {
    throw new Error("Complete ID reservations are unavailable.");
  }
}
