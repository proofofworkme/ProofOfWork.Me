export type CanonicalWorkCapacity = {
  model: "canonical-work-wallet-capacity-v1";
  network: string;
  address: string;
  tokenId: string;
  indexedThroughBlock: number;
  indexedThroughBlockHash: string;
  confirmedBalanceSubatoms: string;
  reservedBalanceSubatoms: string;
  transferableBalanceSubatoms: string;
  reservations: Array<{ listingId: string; amountSubatoms: string }>;
  tokenStateCommitment: { model: string; sha256: string; payloadBytes: number };
};

export function canonicalWorkCapacityAddress(address: string) {
  const value = address.trim();
  // Base58 addresses are case-sensitive. Bech32 accepts uniformly cased input.
  return /^(bc1|tb1|bcrt1)/iu.test(value) &&
    (value === value.toLowerCase() || value === value.toUpperCase())
    ? value.toLowerCase()
    : value;
}

export function requireCanonicalWorkCapacity(
  capacities: unknown,
  expected: {
    network: string;
    address: string;
    tokenId: string;
    indexedThroughBlock?: number;
    indexedThroughBlockHash?: string;
    confirmedBalanceSubatoms: bigint;
  },
) {
  const unavailable = () => {
    throw new Error("Canonical WORK capacity is unavailable or inconsistent. Refresh the wallet before spending WORK.");
  };
  const hash = (value: unknown): value is string =>
    typeof value === "string" && /^[0-9a-f]{64}$/u.test(value);
  const units = (value: unknown) => {
    if (typeof value !== "string" || !/^(0|[1-9][0-9]*)$/u.test(value)) return unavailable();
    return BigInt(value);
  };
  if (!Array.isArray(capacities) || !expected.address ||
      !Number.isSafeInteger(expected.indexedThroughBlock) ||
      Number(expected.indexedThroughBlock) < 1 || !hash(expected.indexedThroughBlockHash)) {
    return unavailable();
  }
  const address = canonicalWorkCapacityAddress(expected.address);
  const selected = capacities.filter((item) => item && item.address === address);
  if (selected.length !== 1) return unavailable();
  const capacity = selected[0] as CanonicalWorkCapacity;
  if (capacity.model !== "canonical-work-wallet-capacity-v1" ||
      capacity.network !== expected.network || capacity.tokenId !== expected.tokenId ||
      capacity.address !== capacity.address.trim() ||
      capacity.indexedThroughBlock !== expected.indexedThroughBlock ||
      capacity.indexedThroughBlockHash !== expected.indexedThroughBlockHash ||
      !Array.isArray(capacity.reservations) ||
      capacity.tokenStateCommitment?.model !== "canonical-work-amo-payload-sha256-v1" ||
      !hash(capacity.tokenStateCommitment.sha256) ||
      !Number.isSafeInteger(capacity.tokenStateCommitment.payloadBytes) ||
      capacity.tokenStateCommitment.payloadBytes <= 0) return unavailable();
  const confirmed = units(capacity.confirmedBalanceSubatoms);
  const reserved = units(capacity.reservedBalanceSubatoms);
  const transferable = units(capacity.transferableBalanceSubatoms);
  const reservations = new Map<string, bigint>();
  let reservationTotal = 0n;
  for (const item of capacity.reservations) {
    if (!item || !hash(item.listingId) || reservations.has(item.listingId)) return unavailable();
    const amount = units(item.amountSubatoms);
    if (amount <= 0n) return unavailable();
    reservations.set(item.listingId, amount);
    reservationTotal += amount;
  }
  if (confirmed !== expected.confirmedBalanceSubatoms || reserved !== reservationTotal ||
      reserved > confirmed || confirmed - reserved !== transferable) return unavailable();
  // The server binds this receipt to canonical replay. The client checks its
  // scope and exact arithmetic; it does not re-hash the full token-state preimage.
  return { confirmed, reserved, transferable, reservations };
}
