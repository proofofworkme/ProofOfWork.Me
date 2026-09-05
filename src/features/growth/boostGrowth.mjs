export const BOOST_GROWTH_COUNT_FIELDS = [
  "events", "transactions", "posts", "replies", "likes", "reboosts",
  "follows", "unfollows", "profiles", "hides", "transfers", "listings",
  "seals", "delistings", "sales", "socialActions",
];

export const BOOST_GROWTH_AMOUNT_FIELDS = [
  "directProofSignalSats", "registryFeeSats", "saleVolumeSats",
  "attachedWorkSubatoms", "attributedMailSats", "attributedWorkSubatoms",
];

function object(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

// These are observations alongside the canonical ledger, never inputs to it.
// Reject partial/mismatched snapshots instead of showing a convincing zero.
export function normalizeBoostGrowth(value, checkpoint) {
  const input = object(value);
  const actualCheckpoint = object(input.checkpoint);
  const expected = object(checkpoint);
  const unavailable = (reason) => ({
    model: "boost-growth-observation-v1",
    source: "proof-indexer-confirmed-boost-growth",
    countScope: "confirmed-indexed-shape-valid-records",
    ready: false,
    complete: false,
    reason,
    economicMetricsVerified: false,
    checkpoint: null,
    counts: null,
    metricReasons: {},
    ...Object.fromEntries(BOOST_GROWTH_AMOUNT_FIELDS.map((field) => [field, null])),
  });
  if (input.model !== "boost-growth-observation-v1") {
    return unavailable("Confirmed Boost metrics are not available in this ledger snapshot.");
  }
  if (input.ready !== true || input.complete !== true) {
    return unavailable(typeof input.reason === "string" && input.reason
      ? input.reason
      : "Complete confirmed Boost history is unavailable for this snapshot.");
  }
  if (
    input.source !== "proof-indexer-confirmed-boost-growth" ||
    input.countScope !== "confirmed-indexed-shape-valid-records" ||
    !Number.isSafeInteger(expected.blockHeight) || expected.blockHeight <= 0 ||
    !/^[0-9a-f]{64}$/.test(expected.blockHash ?? "") ||
    typeof expected.snapshotId !== "string" || !expected.snapshotId ||
    actualCheckpoint.blockHeight !== expected.blockHeight ||
    actualCheckpoint.blockHash !== expected.blockHash ||
    actualCheckpoint.snapshotId !== expected.snapshotId
  ) {
    return unavailable("Boost metrics do not match the Growth ledger snapshot.");
  }
  const counts = object(input.counts);
  if (BOOST_GROWTH_COUNT_FIELDS.some((field) =>
    !Number.isSafeInteger(counts[field]) || counts[field] < 0
  ) || counts.transactions > counts.events) {
    return unavailable("Complete confirmed Boost counts could not be verified.");
  }
  const metricReasons = object(input.metricReasons);
  const amounts = {};
  const reasons = {};
  for (const field of BOOST_GROWTH_AMOUNT_FIELDS) {
    const amount = input[field];
    amounts[field] = typeof amount === "string" && /^(0|[1-9][0-9]{0,79})$/.test(amount)
      ? amount : null;
    if (amounts[field] === null) {
      reasons[field] = typeof metricReasons[field] === "string" && metricReasons[field]
        ? metricReasons[field] : "Verified payment attribution is unavailable.";
    }
  }
  return {
    model: input.model,
    source: input.source,
    countScope: input.countScope,
    ready: true,
    complete: true,
    reason: null,
    economicMetricsVerified: input.economicMetricsVerified === true &&
      BOOST_GROWTH_AMOUNT_FIELDS.every((field) => amounts[field] !== null),
    checkpoint: { ...expected },
    counts: Object.fromEntries(BOOST_GROWTH_COUNT_FIELDS.map((field) => [field, counts[field]])),
    ...amounts,
    metricReasons: reasons,
  };
}

export function boostProofsDisplay(value) {
  return value === null ? "Unavailable" : `${BigInt(value).toLocaleString("en-US")} proofs`;
}

export function boostWorkDisplay(value) {
  if (value === null) return "Unavailable";
  const subatoms = BigInt(value);
  const scale = 10n ** 16n;
  const fraction = (subatoms % scale).toString().padStart(16, "0").replace(/0+$/, "");
  return `${(subatoms / scale).toLocaleString("en-US")}${fraction ? `.${fraction}` : ""} WORK`;
}
