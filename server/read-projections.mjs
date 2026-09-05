// Display projections never define protocol authority. Their source payloads
// must pass the existing canonical and Core admission checks first.
export const TOKEN_LISTING_DISPLAY_OMITTED_FIELDS = Object.freeze([
  "workAmoV5ReplayOutput",
  "workAmoV5ReplayRawWitness",
  "workAmoV5RawScriptWitness",
]);

function projectionUnavailable(message) {
  const error = new Error(message);
  error.statusCode = 503;
  error.details = { code: "CANONICAL_INDEX_UNAVAILABLE" };
  return error;
}

export function registryCountsProjection(payload) {
  const records = payload?.records;
  if (!Array.isArray(records) || payload.collectionHasMore?.records === true ||
      records.some((record) => typeof record?.confirmed !== "boolean") ||
      !Number.isSafeInteger(payload.stats?.total) || payload.stats.total !== records.length) {
    throw projectionUnavailable("Complete ID registry counts are unavailable.");
  }
  const confirmedCount = records.filter((record) => record.confirmed).length;
  // Pending registration count is distinct from pending receiver/owner changes.
  const registryCounts = {
    model: "proof-registry-counts-v1", complete: true,
    confirmedCount, pendingCount: records.length - confirmedCount, totalCount: records.length,
  };
  const metadataKeys = ["consistency", "indexedAt", "indexedThroughBlock", "indexedThroughBlockHash",
    "ledgerGeneratedAt", "network", "provenance", "registryAddress", "snapshotId", "source", "stats"];
  return { ...Object.fromEntries(metadataKeys.filter((key) => key in payload).map((key) => [key, payload[key]])), registryCounts };
}

export function withTokenDirectoryQualification(payload) {
  const tokens = payload?.tokens;
  const totalCount = payload?.totalCounts?.tokens;
  const complete = Array.isArray(tokens) && Number.isSafeInteger(totalCount) && totalCount >= 0 &&
    totalCount === tokens.length && payload.collectionHasMore?.tokens !== true &&
    tokens.every((token) => typeof token?.tokenId === "string" && token.tokenId.length > 0) &&
    new Set(tokens.map((token) => token.tokenId)).size === tokens.length;
  return { ...payload, directory: { model: "proof-token-directory-v1", complete, totalCount } };
}

export function tokenDirectoryProjection(payload) {
  const qualified = withTokenDirectoryQualification(payload);
  if (qualified.directory.complete !== true) {
    throw projectionUnavailable("The complete credit directory is unavailable.");
  }
  const result = { ...qualified, collectionHasMore: { ...qualified.collectionHasMore },
    directoryOnly: true, listingBookComplete: false, summaryOnly: true };
  // A directory is not a market book or event history. Keep their known counts
  // and indicate omitted rows so no consumer can treat the arrays as complete.
  for (const key of ["activity", "closedListings", "holders", "invalidEvents", "listings", "mints", "sales", "transfers"]) {
    result.collectionHasMore[key] = qualified.collectionHasMore?.[key] === true ||
      (Array.isArray(qualified[key]) && qualified[key].length > 0) ||
      (Number.isSafeInteger(qualified.totalCounts?.[key]) && qualified.totalCounts[key] > 0);
    result[key] = [];
  }
  result.hasMore = Object.values(result.collectionHasMore).some(Boolean);
  return result;
}

export function tokenListingDisplayProjection(listing, { fullRecordSha256, network, tokenScope = "" }) {
  if (!/^[0-9a-f]{64}$/u.test(fullRecordSha256)) {
    throw projectionUnavailable("Full token listing evidence digest is unavailable.");
  }
  const omittedFields = TOKEN_LISTING_DISPLAY_OMITTED_FIELDS.filter((key) => Object.hasOwn(listing, key));
  const detailQuery = new URLSearchParams({
    kind: "listings", network, q: String(listing.listingId ?? listing.txid ?? ""),
    listingId: String(listing.listingId ?? listing.txid ?? ""), projection: "full",
  });
  if (tokenScope) detailQuery.set("asset", tokenScope);
  return {
    ...Object.fromEntries(Object.entries(listing).filter(([key]) => !TOKEN_LISTING_DISPLAY_OMITTED_FIELDS.includes(key))),
    displayEvidence: {
      model: "proof-token-listing-display-v1", fullRecordSha256, omittedFields,
      fullDetailPath: `/api/v1/token-history?${detailQuery}`,
    },
  };
}
