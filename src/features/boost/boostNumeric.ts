export function boostPaymentAmountSats(value: unknown): number | null {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0
    ? value
    : null;
}

export function boostListingPriceSats(value: unknown): number | null {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 1
    ? value
    : null;
}

export function normalizeBoostSpentOutpoint(value: {
  txid?: unknown;
  vout?: unknown;
}): string {
  const txid = typeof value?.txid === "string"
    ? value.txid.trim().toLowerCase()
    : "";
  const vout = value?.vout;
  return /^[0-9a-f]{64}$/u.test(txid) &&
    typeof vout === "number" &&
    Number.isSafeInteger(vout) &&
    vout >= 0
    ? `${txid}:${vout}`
    : "";
}
