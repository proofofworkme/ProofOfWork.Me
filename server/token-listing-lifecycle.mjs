const TXID_PATTERN = /^[0-9a-f]{64}$/u;

export function tokenListingTransactionCanProjectActive(status) {
  return ["confirmed", "pending"].includes(
    String(status ?? "").trim().toLowerCase(),
  );
}

export function tokenListingCanProjectCloseActivity(listing) {
  const closedTxid = String(listing?.closedTxid ?? "")
    .trim()
    .toLowerCase();
  return (
    listing?.closedConfirmed === true &&
    TXID_PATTERN.test(closedTxid)
  );
}
