const TXID_PATTERN = /^[0-9a-f]{64}$/u;

export function tokenListingHistoryQueryScope({
  listingId = "",
  query = "",
  cursor = "",
} = {}) {
  const requestedListingId = String(listingId ?? "").trim().toLowerCase();
  if (requestedListingId && !TXID_PATTERN.test(requestedListingId)) {
    throw new TypeError("Exact token listing ID must be a 64-character txid.");
  }

  const normalizedQuery = String(query ?? "").trim().toLowerCase();
  const listingIdFromQuery = TXID_PATTERN.test(normalizedQuery)
    ? normalizedQuery
    : "";
  const exactListingId = requestedListingId || listingIdFromQuery;
  const hasCursor = String(cursor ?? "").trim() !== "";

  return {
    exactListingId,
    narrowToExactListing: Boolean(exactListingId) && !hasCursor,
  };
}
