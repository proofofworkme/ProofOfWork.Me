import { WORK_TOKEN_ID } from "./work-units.mjs";
import workMarketV1RefundSnapshot from "../WORK_MARKET_V1_REFUNDS_959061.json" with {
  type: "json",
};

export const WORK_MARKET_V2_AUTH_VERSION = "pwt-sale-v3";
export const WORK_MARKET_V2_ORACLE_MODEL =
  "canonical-work-market-h-minus-one-v1";
export const WORK_MARKET_V2_DECLARATION_TXID =
  "4c53252c6e9279726e1456f4d846274bfa33f778b633d32a68ed36906b38083f";
export const WORK_MARKET_V2_DECLARATION_HEIGHT = 959_061;
export const WORK_MARKET_V2_DECLARATION_BLOCK_HASH =
  "000000000000000000022645eee1e171b271a92e6527728e85441efc88fa04a5";
export const WORK_MARKET_V2_ACTIVATION_HEIGHT =
  WORK_MARKET_V2_DECLARATION_HEIGHT + 1;
export const WORK_MARKET_V4_AUTH_VERSION = "pwt-sale-v4";
export const WORK_MARKET_V4_ORACLE_MODEL =
  "canonical-work-market-confirmation-floor-v1";
export const WORK_MARKET_V4_MAX_QUOTE_AGE_BLOCKS = 480;
export const WORK_MARKET_V4_DECLARATION_AUTHORITY =
  "1F1p9UEHuH5KTFR7Zsx93Khdrqhj6t5nFv";
export const WORK_MARKET_V4_DECLARATION_REGISTRY_ADDRESS =
  "1638Vn6KtmK8p5r4oGvAXq9nmZb1emU1DV";
export const WORK_MARKET_V4_DECLARATION_MIN_PAYMENT_SATS = 546;
export const WORK_MARKET_V4_DECLARATION_MEMO = `ProofOfWork.Me WORK Marketplace Pricing Protocol V4

Effective from the block after this declaration confirms, governed WORK marketplace list5, seal5, and buy5 actions require pwt-sale-v4 with oracleModel canonical-work-market-confirmation-floor-v1.

Each authorization commits a historical canonical WORK quote block height, block hash, live network value Q8, amountAtoms, quote minimumPriceSats, and total priceSats. The committed quote must match its own hash-bound green canonical summary.

The quote block must be one of the 480 blocks immediately before the action's confirmation block. A quote 480 blocks old remains valid; a quote 481 or more blocks old is expired.

For an action confirmed at block H:

confirmationMinimumPriceSats =
ceil(
  amountAtoms * liveNetworkValueQ8(H-1)
  / (21000000 * 100000000 * 100000000)
)

priceSats must be greater than or equal to confirmationMinimumPriceSats. The committed quote need not equal H-1. Within that quote-age bound, delayed confirmation remains valid only when the signed total seller price still meets the canonical H-1 floor.

pwt-sale-v3 remains immutable historical protocol state and is not reinterpreted. From activation, new governed WORK list, seal, and buy actions require pwt-sale-v4. Existing pwt-sale-v3 listings become read-only relics: their sale tickets may be delisted or recovered, but they must be relisted under pwt-sale-v4 before sealing or purchase.

Missing, hash-mismatched, inconsistent, unavailable, expired-quote, or below-confirmation-floor actions are invalid and cause no canonical WORK balance, ownership transfer, sale, Log, Growth, or network-value mutation. Independently, any confirmed spend of a sale-ticket outpoint closes or retires its listing as canonical outpoint state, including when the attempted buy is rejected.

Confirmed chain history is authoritative. Pending transactions provide visibility only.`;
export const WORK_MARKET_V4_DECLARATION_PAYLOAD =
  `pwm1:m:${WORK_MARKET_V4_DECLARATION_MEMO}`;
export const WORK_MARKET_V2_MAX_SUPPLY = 21_000_000n;
export const WORK_MARKET_V2_ATOMS_PER_WORK = 100_000_000n;
export const WORK_MARKET_V2_VALUE_Q8_SCALE = 100_000_000n;

const TXID_PATTERN = /^[0-9a-f]{64}$/u;
const LEGACY_WORK_MARKET_AUTH_VERSIONS = new Set([
  "pwt-sale-v1",
  "pwt-sale-v2",
]);
const WORK_MARKET_SUCCESSOR_AUTH_VERSIONS = new Set([
  "pwt-sale-v5",
  "pwt-sale-v6",
  "pwt-sale-v8",
]);
const WORK_MARKET_V1_REFUND_LISTINGS_BY_ID = new Map(
  workMarketV1RefundSnapshot.listings.flatMap((listing) => {
    const listingId = String(listing?.listingId ?? "").trim().toLowerCase();
    return TXID_PATTERN.test(listingId) ? [[listingId, listing]] : [];
  }),
);

export function workMarketV1RefundSnapshotIncludes(listingId) {
  return WORK_MARKET_V1_REFUND_LISTINGS_BY_ID.has(
    String(listingId ?? "").trim().toLowerCase(),
  );
}

function configuredTxid(value) {
  const txid = String(value ?? "").trim().toLowerCase();
  return TXID_PATTERN.test(txid) ? txid : "";
}

function configuredBlockHeight(value) {
  const height = Number(value);
  return Number.isSafeInteger(height) && height > 0 ? height : 0;
}

export const WORK_MARKET_V4_DECLARATION_TXID = configuredTxid(
  process.env.WORK_MARKET_V4_DECLARATION_TXID,
);
export const WORK_MARKET_V4_DECLARATION_HEIGHT = configuredBlockHeight(
  process.env.WORK_MARKET_V4_DECLARATION_HEIGHT,
);
export const WORK_MARKET_V4_DECLARATION_BLOCK_HASH = configuredTxid(
  process.env.WORK_MARKET_V4_DECLARATION_BLOCK_HASH,
);
export const WORK_MARKET_V4_ACTIVATION_HEIGHT =
  WORK_MARKET_V4_DECLARATION_TXID &&
  WORK_MARKET_V4_DECLARATION_HEIGHT > 0 &&
  WORK_MARKET_V4_DECLARATION_BLOCK_HASH
    ? WORK_MARKET_V4_DECLARATION_HEIGHT + 1
    : 0;

export function workMarketV4ConfiguredDeclaration() {
  if (WORK_MARKET_V4_ACTIVATION_HEIGHT < 1) {
    return null;
  }
  return {
    activationHeight: WORK_MARKET_V4_ACTIVATION_HEIGHT,
    declarationBlockHash: WORK_MARKET_V4_DECLARATION_BLOCK_HASH,
    declarationHeight: WORK_MARKET_V4_DECLARATION_HEIGHT,
    declarationTxid: WORK_MARKET_V4_DECLARATION_TXID,
  };
}

export function workMarketV4ActivationReached(
  activation,
  checkpointBlockHeight,
) {
  const activationHeight = Number(activation?.activationHeight);
  const checkpointHeight = Number(checkpointBlockHeight);
  return (
    Number.isSafeInteger(activationHeight) &&
    activationHeight > 0 &&
    Number.isSafeInteger(checkpointHeight) &&
    checkpointHeight >= activationHeight
  );
}

export function workMarketV4ActivationFromDeclaration(declaration) {
  const configured = workMarketV4ConfiguredDeclaration();
  const txid = String(declaration?.txid ?? "").trim().toLowerCase();
  const blockHash = String(declaration?.blockHash ?? "").trim().toLowerCase();
  const blockHeight = Number(declaration?.blockHeight);
  const firstInputAddress = String(
    declaration?.firstInputAddress ?? "",
  ).trim();
  const registryPaymentSats = Number(declaration?.registryPaymentSats);
  if (
    declaration?.confirmed !== true ||
    declaration?.payload !== WORK_MARKET_V4_DECLARATION_PAYLOAD ||
    firstInputAddress !== WORK_MARKET_V4_DECLARATION_AUTHORITY ||
    !Number.isSafeInteger(registryPaymentSats) ||
    registryPaymentSats < WORK_MARKET_V4_DECLARATION_MIN_PAYMENT_SATS ||
    !TXID_PATTERN.test(txid) ||
    !TXID_PATTERN.test(blockHash) ||
    !Number.isSafeInteger(blockHeight) ||
    blockHeight < 1
  ) {
    return null;
  }
  const discovered = {
    activationHeight: blockHeight + 1,
    declarationBlockHash: blockHash,
    declarationHeight: blockHeight,
    declarationTxid: txid,
  };
  if (
    configured &&
    (discovered.activationHeight !== configured.activationHeight ||
      discovered.declarationBlockHash !== configured.declarationBlockHash ||
      discovered.declarationHeight !== configured.declarationHeight ||
      discovered.declarationTxid !== configured.declarationTxid)
  ) {
    return null;
  }
  return configured ?? discovered;
}

export function workMarketplaceV4StatusFromEvidence(
  declaration,
  { tipHeight = null, writesConfigured = false } = {},
) {
  const configured = workMarketV4ConfiguredDeclaration();
  const base = {
    active: false,
    authVersion: WORK_MARKET_V4_AUTH_VERSION,
    declarationBlockHash: configured?.declarationBlockHash ?? "",
    declarationConfirmed: false,
    declarationHeight: configured?.declarationHeight ?? null,
    declarationTxid: configured?.declarationTxid ?? "",
    activationHeight: configured?.activationHeight ?? null,
    oracleModel: WORK_MARKET_V4_ORACLE_MODEL,
    writesEnabled: false,
  };
  if (!configured) {
    return base;
  }
  const activation = workMarketV4ActivationFromDeclaration(declaration);
  const declarationConfirmed =
    activation !== null &&
    activation.activationHeight === configured.activationHeight &&
    activation.declarationBlockHash === configured.declarationBlockHash &&
    activation.declarationHeight === configured.declarationHeight &&
    activation.declarationTxid === configured.declarationTxid;
  const active =
    declarationConfirmed &&
    workMarketV4ActivationReached(activation, Number(tipHeight));
  return {
    ...base,
    active,
    declarationConfirmed,
    writesEnabled:
      active && declarationConfirmed && writesConfigured === true,
  };
}

export function workMarketV4DeclarationCanonicalHeight({
  blockHash,
  blockHeight,
  canonicalBlockHash,
} = {}) {
  const observedHeight = Number(blockHeight);
  if (Number.isSafeInteger(observedHeight) && observedHeight > 0) {
    return observedHeight;
  }
  const configured = workMarketV4ConfiguredDeclaration();
  const observedHash = String(blockHash ?? "").trim().toLowerCase();
  const canonicalHash = String(canonicalBlockHash ?? "").trim().toLowerCase();
  return configured &&
    observedHash === configured.declarationBlockHash &&
    canonicalHash === configured.declarationBlockHash
    ? configured.declarationHeight
    : 0;
}

export function workMarketOracleActionKey(txid, protocolVout) {
  return `${String(txid ?? "").trim().toLowerCase()}:${Number(protocolVout)}`;
}

export function workMarketOracleCacheKey(action, network) {
  const blockHash = String(action?.blockHash ?? "").trim().toLowerCase();
  const blockHeight = Number(action?.blockHeight);
  const quoteHeight = Number(action?.authorization?.oracleBlockHeight);
  const version = String(action?.authorization?.version ?? "").trim();
  if (
    !TXID_PATTERN.test(blockHash) ||
    !Number.isSafeInteger(blockHeight) ||
    blockHeight < 1 ||
    !Number.isSafeInteger(quoteHeight) ||
    quoteHeight < 1 ||
    ![WORK_MARKET_V2_AUTH_VERSION, WORK_MARKET_V4_AUTH_VERSION].includes(
      version,
    )
  ) {
    return "";
  }
  return `${String(network ?? "").trim().toLowerCase()}:${blockHeight}:${blockHash}:${version}:${quoteHeight}`;
}

export function workMarketCachedOracleContext(cache, action, network) {
  const key = workMarketOracleCacheKey(action, network);
  const cached = key && cache instanceof Map ? cache.get(key) : null;
  const confirmationHeight = Number(action?.blockHeight) - 1;
  const quoteHeight =
    action?.authorization?.version === WORK_MARKET_V4_AUTH_VERSION
      ? Number(action?.authorization?.oracleBlockHeight)
      : confirmationHeight;
  return cached?.confirmationOracle?.blockHeight === confirmationHeight &&
    cached?.quoteOracle?.blockHeight === quoteHeight
    ? cached
    : null;
}

function unsignedInteger(value, { positive = false } = {}) {
  const text = String(value ?? "").trim();
  if (!/^(?:0|[1-9][0-9]*)$/u.test(text)) {
    return null;
  }
  const integer = BigInt(text);
  return positive && integer < 1n ? null : integer;
}

export function workMarketV2MinimumPriceSats(amountAtoms, networkValueQ8) {
  const amount = unsignedInteger(amountAtoms, { positive: true });
  const value = unsignedInteger(networkValueQ8, { positive: true });
  if (amount === null || value === null) {
    return null;
  }
  const denominator =
    WORK_MARKET_V2_MAX_SUPPLY *
    WORK_MARKET_V2_ATOMS_PER_WORK *
    WORK_MARKET_V2_VALUE_Q8_SCALE;
  return (amount * value + denominator - 1n) / denominator;
}

export function workMarketV4QuoteHeightWithinBound(
  actionBlockHeight,
  quoteBlockHeight,
) {
  const actionHeight = Number(actionBlockHeight);
  const quoteHeight = Number(quoteBlockHeight);
  return (
    Number.isSafeInteger(actionHeight) &&
    Number.isSafeInteger(quoteHeight) &&
    quoteHeight > 0 &&
    quoteHeight < actionHeight &&
    actionHeight - quoteHeight <= WORK_MARKET_V4_MAX_QUOTE_AGE_BLOCKS
  );
}

export function workMarketV2ActivationFromDeclaration(declaration) {
  const txid = String(declaration?.txid ?? "").trim().toLowerCase();
  const blockHash = String(declaration?.blockHash ?? "").trim().toLowerCase();
  const blockHeight = Number(declaration?.blockHeight);
  if (
    declaration?.confirmed !== true ||
    txid !== WORK_MARKET_V2_DECLARATION_TXID ||
    !TXID_PATTERN.test(blockHash) ||
    !Number.isSafeInteger(blockHeight) ||
    blockHeight < 1
  ) {
    return null;
  }
  return {
    activationHeight: blockHeight + 1,
    declarationBlockHash: blockHash,
    declarationHeight: blockHeight,
    declarationTxid: txid,
  };
}

export function workMarketV2ActivationForReplay(network, declaration = null) {
  if (String(network ?? "").trim().toLowerCase() === "livenet") {
    return {
      activationHeight: WORK_MARKET_V2_ACTIVATION_HEIGHT,
      declarationBlockHash: WORK_MARKET_V2_DECLARATION_BLOCK_HASH,
      declarationHeight: WORK_MARKET_V2_DECLARATION_HEIGHT,
      declarationTxid: WORK_MARKET_V2_DECLARATION_TXID,
    };
  }
  return declaration
    ? workMarketV2ActivationFromDeclaration(declaration)
    : null;
}

export function validateGovernedWorkMarketAction(
  authorization,
  {
    actionBlockHeight,
    activationHeight,
    expectedConfirmationNetworkValueQ8,
    expectedConfirmationOracleBlockHash,
    expectedOracleBlockHash,
    expectedNetworkValueQ8,
    expectedQuoteNetworkValueQ8,
    expectedQuoteOracleBlockHash,
    v4ActivationHeight,
  } = {},
) {
  const actionHeight = Number(actionBlockHeight);
  const governedFrom = Number(activationHeight);
  if (
    String(authorization?.tokenId ?? "").trim().toLowerCase() !==
      WORK_TOKEN_ID ||
    !Number.isSafeInteger(actionHeight) ||
    !Number.isSafeInteger(governedFrom) ||
    actionHeight < governedFrom
  ) {
    return { valid: true };
  }
  const v4GovernedFrom = Number(v4ActivationHeight);
  if (
    Number.isSafeInteger(v4GovernedFrom) &&
    v4GovernedFrom > 0 &&
    actionHeight >= v4GovernedFrom
  ) {
    if (authorization?.version !== WORK_MARKET_V4_AUTH_VERSION) {
      return {
        reasonCode: "work-market-v4-version-required",
        valid: false,
      };
    }
    return validateWorkMarketV4Authorization(authorization, {
      actionBlockHeight: actionHeight,
      expectedConfirmationNetworkValueQ8,
      expectedConfirmationOracleBlockHash,
      expectedQuoteNetworkValueQ8,
      expectedQuoteOracleBlockHash,
    });
  }
  if (authorization?.version !== WORK_MARKET_V2_AUTH_VERSION) {
    return validateWorkMarketV2Authorization(authorization, {
      actionBlockHeight: actionHeight,
    });
  }
  const expectedHash = String(expectedOracleBlockHash ?? "")
    .trim()
    .toLowerCase();
  const expectedValue = unsignedInteger(expectedNetworkValueQ8, {
    positive: true,
  });
  if (!TXID_PATTERN.test(expectedHash) || expectedValue === null) {
    return {
      reasonCode: "work-market-v2-canonical-oracle-unavailable",
      valid: false,
    };
  }
  return validateWorkMarketV2Authorization(authorization, {
    actionBlockHeight: actionHeight,
    expectedNetworkValueQ8: expectedValue,
    expectedOracleBlockHash: expectedHash,
  });
}

function listingId(listing) {
  return String(listing?.listingId ?? listing?.txid ?? "")
    .trim()
    .toLowerCase();
}

function transactionId(item) {
  return String(item?.txid ?? item?.listingId ?? "")
    .trim()
    .toLowerCase();
}

function listingBlockHeight(listing) {
  const height = Number(
    listing?.listingBlockHeight ?? listing?.blockHeight,
  );
  return Number.isSafeInteger(height) && height > 0 ? height : null;
}

function listingAuthorizationVersion(listing) {
  return String(listing?.saleAuthorization?.version ?? listing?.version ?? "")
    .trim()
    .toLowerCase();
}

function listingNetwork(listing, state) {
  return String(listing?.network ?? state?.network ?? "")
    .trim()
    .toLowerCase();
}

function listingTokenId(listing) {
  return String(
    listing?.tokenId ?? listing?.saleAuthorization?.tokenId ?? "",
  )
    .trim()
    .toLowerCase();
}

function workListingAmount(listing) {
  const atoms = unsignedInteger(
    listing?.amountAtoms ?? listing?.saleAuthorization?.amountAtoms,
    { positive: true },
  );
  if (atoms !== null) {
    return Number(atoms) / Number(WORK_MARKET_V2_ATOMS_PER_WORK);
  }
  const amount = Number(
    listing?.amount ?? listing?.saleAuthorization?.amount,
  );
  return Number.isFinite(amount) && amount > 0 ? amount : 0;
}

function activeWorkListingMetrics(listings) {
  const workListings = listings.filter(
    (listing) => listingTokenId(listing) === WORK_TOKEN_ID,
  );
  let lowestAskPricePerToken = 0;
  for (const listing of workListings) {
    if (listing?.sealConfirmed !== true) {
      continue;
    }
    const amount = workListingAmount(listing);
    const priceSats = Number(
      listing?.priceSats ?? listing?.saleAuthorization?.priceSats,
    );
    const ask =
      amount > 0 && Number.isFinite(priceSats) && priceSats > 0
        ? priceSats / amount
        : 0;
    if (ask > 0) {
      lowestAskPricePerToken =
        lowestAskPricePerToken > 0
          ? Math.min(lowestAskPricePerToken, ask)
          : ask;
    }
  }
  return {
    confirmedOpenListings: workListings.filter(
      (listing) => listing?.confirmed === true,
    ).length,
    lowestAskPricePerToken,
    openListings: workListings.length,
    pendingOpenListings: workListings.filter(
      (listing) => listing?.confirmed !== true,
    ).length,
  };
}

function finiteListingCount(value) {
  const count = Number(value);
  return Number.isSafeInteger(count) && count >= 0 ? count : null;
}

export function isLegacyWorkMarketListing(listing) {
  return (
    listingTokenId(listing) === WORK_TOKEN_ID &&
    LEGACY_WORK_MARKET_AUTH_VERSIONS.has(
      listingAuthorizationVersion(listing),
    )
  );
}

function auditSats(value) {
  const sats = Number(value);
  return Number.isSafeInteger(sats) && sats >= 0 ? sats : 0;
}

function invalidAuditCosts(minerFeeSats, registryPaymentSats) {
  const auditMinerFeeSats = auditSats(minerFeeSats);
  const auditRegistryPaymentSats = auditSats(registryPaymentSats);
  return {
    amountSats: 0,
    auditMinerFeeSats,
    auditRegistryPaymentSats,
    auditTotalCostSats: auditMinerFeeSats + auditRegistryPaymentSats,
    frozenNetworkValueSats: 0,
    liveNetworkValueSats: 0,
    marketplaceMutationFeeSats: 0,
    minerFeeSats: 0,
    proofPaymentSats: 0,
    registryMutationFeeSats: 0,
    salePaymentSats: 0,
  };
}

function cutoverInvalidEvent(
  listing,
  reasonCode = "work-market-v2-version-required",
) {
  const confirmed = listing?.confirmed === true;
  const id = listingId(listing);
  return {
    ...listing,
    ...invalidAuditCosts(
      listing?.minerFeeSats,
      listing?.registryMutationFeeSats ??
        listing?.marketplaceMutationFeeSats ??
        listing?.amountSats,
    ),
    attemptedKind: "list",
    confirmed,
    kind: "token-event-invalid",
    listingId: id,
    reason: reasonCode,
    reasonCode,
    refundEligible: false,
    relic: false,
    status: confirmed ? "confirmed" : "pending",
    txid: id,
    valid: false,
    validationErrors: [reasonCode],
  };
}

function postActivationLegacySeal(listing) {
  const txid = String(listing?.sealTxid ?? "").trim().toLowerCase();
  if (!TXID_PATTERN.test(txid)) {
    return null;
  }
  const confirmed = listing?.sealConfirmed === true;
  const blockHeight = Number(listing?.sealBlockHeight);
  if (
    confirmed &&
    (!Number.isSafeInteger(blockHeight) ||
      blockHeight < WORK_MARKET_V2_ACTIVATION_HEIGHT)
  ) {
    return null;
  }
  return { blockHeight: confirmed ? blockHeight : null, confirmed, txid };
}

function cutoverInvalidSealEvent(
  listing,
  seal,
  reasonCode = "work-market-v2-version-required",
) {
  return {
    ...invalidAuditCosts(
      listing?.sealMinerFeeSats,
      listing?.sealPaymentSats ??
        listing?.marketplaceMutationFeeSats ??
        listing?.amountSats,
    ),
    attemptedKind: "token-listing-sealed",
    blockHash: String(listing?.sealBlockHash ?? "").trim().toLowerCase(),
    blockHeight: seal.blockHeight,
    confirmed: seal.confirmed,
    createdAt: listing?.sealAt ?? listing?.createdAt,
    kind: "token-event-invalid",
    listingId: listingId(listing),
    network: listing?.network,
    reason: reasonCode,
    reasonCode,
    registryAddress: listing?.registryAddress,
    refundEligible: false,
    relic: false,
    saleAuthorization: listing?.saleAuthorization,
    sellerAddress: listing?.sellerAddress,
    status: seal.confirmed ? "confirmed" : "pending",
    ticker: listing?.ticker,
    tokenId:
      listing?.tokenId ?? listing?.saleAuthorization?.tokenId ?? WORK_TOKEN_ID,
    txid: seal.txid,
    valid: false,
    validationErrors: [reasonCode],
  };
}

function cutoverRelicListing(listing, { discardSeal = false } = {}) {
  const id = listingId(listing);
  const relic = {
    ...listing,
    closedConfirmed: true,
    confirmed: true,
    disabledAtBlockHeight: WORK_MARKET_V2_ACTIVATION_HEIGHT,
    disabledByTxid: WORK_MARKET_V2_DECLARATION_TXID,
    disabledReason: "work-market-v2-cutover",
    listingId: id,
    refundEligible: true,
    relic: true,
    status: "disabled",
    txid: id,
  };
  if (!discardSeal) {
    return relic;
  }
  return {
    ...relic,
    blockTime: undefined,
    kind:
      relic.kind === "token-listing-sealed" ? "token-listing" : relic.kind,
    sealAt: undefined,
    sealBlockHash: undefined,
    sealBlockHeight: undefined,
    sealBlockIndex: undefined,
    sealConfirmed: false,
    sealDataBytes: 0,
    sealFrozenNetworkValueSats: 0,
    sealLiveNetworkValueSats: 0,
    sealMinerFeeCanonical: false,
    sealMinerFeeSats: 0,
    sealMinerFeeSource: "",
    sealPaymentSats: 0,
    sealTxid: "",
    timestamp: undefined,
  };
}

function cutoverSnapshotExcludedListing(listing) {
  const id = listingId(listing);
  return {
    ...listing,
    closedConfirmed: true,
    confirmed: true,
    disabledAtBlockHeight: WORK_MARKET_V2_ACTIVATION_HEIGHT,
    disabledByTxid: WORK_MARKET_V2_DECLARATION_TXID,
    disabledReason: "work-market-v1-refund-snapshot-excluded",
    listingId: id,
    refundEligible: false,
    relic: false,
    status: "closed",
    txid: id,
  };
}

function v4RelicListing(listing, activation) {
  const id = listingId(listing);
  return {
    ...listing,
    closedConfirmed: true,
    confirmed: true,
    disabledAtBlockHeight: activation.activationHeight,
    disabledByTxid: activation.declarationTxid,
    disabledReason: "work-market-v4-cutover",
    listingId: id,
    refundEligible: false,
    relic: true,
    status: "disabled",
    txid: id,
  };
}

/**
 * Applies the confirmed Marketplace V2 boundary to an already-built token
 * state. This is deliberately idempotent so every database/canonical merge can
 * call it after choosing its authoritative listing projection.
 */
export function applyWorkMarketV2CutoverToTokenState(state) {
  if (!state || typeof state !== "object" || Array.isArray(state)) {
    return state;
  }
  const indexedThroughBlock = Number(
    state.indexedThroughBlock ?? state.stats?.indexedThroughBlock,
  );
  if (
    !Number.isSafeInteger(indexedThroughBlock) ||
    indexedThroughBlock < WORK_MARKET_V2_ACTIVATION_HEIGHT
  ) {
    return state;
  }

  const stateNetwork = String(state.network ?? "").trim().toLowerCase();
  const stateListings = Array.isArray(state.listings) ? state.listings : [];
  if (
    stateNetwork !== "livenet" &&
    !stateListings.some((listing) => listingNetwork(listing, state) === "livenet")
  ) {
    return state;
  }

  const listings = [];
  const closedListings = Array.isArray(state.closedListings)
    ? state.closedListings.map((listing) => {
        if (!isLegacyWorkMarketListing(listing)) {
          return listing;
        }
        const id = listingId(listing);
        const refundSnapshotListing =
          WORK_MARKET_V1_REFUND_LISTINGS_BY_ID.get(id);
        if (refundSnapshotListing) {
          const alreadyCanonicalRelic =
            listing?.status === "disabled" &&
            listing?.relic === true &&
            listing?.refundEligible === true &&
            listing?.disabledAtBlockHeight ===
              WORK_MARKET_V2_ACTIVATION_HEIGHT &&
            listing?.disabledByTxid === WORK_MARKET_V2_DECLARATION_TXID &&
            listing?.disabledReason === "work-market-v2-cutover" &&
            (refundSnapshotListing.sealed === true ||
              (listing?.sealConfirmed !== true &&
                !String(listing?.sealTxid ?? "").trim()));
          if (alreadyCanonicalRelic) {
            return {
              ...listing,
              closedConfirmed: true,
            };
          }
          return cutoverRelicListing(listing, {
            discardSeal: refundSnapshotListing.sealed !== true,
          });
        }
        return listing?.refundEligible === true ||
          listing?.relic === true ||
          listing?.disabledReason === "work-market-v2-cutover"
          ? cutoverSnapshotExcludedListing(listing)
          : listing;
      })
    : [];
  const invalidEvents = Array.isArray(state.invalidEvents)
    ? [...state.invalidEvents]
    : [];
  const closedIds = new Set(closedListings.map(listingId).filter(Boolean));
  const invalidIds = new Set(invalidEvents.map(transactionId).filter(Boolean));
  const configuredV4Declaration = workMarketV4ConfiguredDeclaration();
  const stateV4Activation =
    state.workMarketV4Activation &&
    typeof state.workMarketV4Activation === "object"
      ? state.workMarketV4Activation
      : null;
  const stateV4ActivationShapeValid =
    Number.isSafeInteger(Number(stateV4Activation?.activationHeight)) &&
    Number(stateV4Activation?.activationHeight) > 0 &&
    Number.isSafeInteger(Number(stateV4Activation?.declarationHeight)) &&
    Number(stateV4Activation?.declarationHeight) > 0 &&
    Number(stateV4Activation?.activationHeight) ===
      Number(stateV4Activation?.declarationHeight) + 1 &&
    TXID_PATTERN.test(
      String(stateV4Activation?.declarationBlockHash ?? "")
        .trim()
        .toLowerCase(),
    ) &&
    TXID_PATTERN.test(
      String(stateV4Activation?.declarationTxid ?? "")
        .trim()
        .toLowerCase(),
    );
  const stateV4ActivationMatchesConfiguration =
    configuredV4Declaration === null ||
    (stateV4Activation?.activationHeight ===
      configuredV4Declaration.activationHeight &&
      stateV4Activation?.declarationBlockHash ===
        configuredV4Declaration.declarationBlockHash &&
      stateV4Activation?.declarationHeight ===
        configuredV4Declaration.declarationHeight &&
      stateV4Activation?.declarationTxid ===
        configuredV4Declaration.declarationTxid);
  const v4Active =
    stateV4ActivationShapeValid &&
    stateV4ActivationMatchesConfiguration &&
    indexedThroughBlock >= Number(stateV4Activation.activationHeight);
  const currentAuthorizationVersion = v4Active
    ? WORK_MARKET_V4_AUTH_VERSION
    : WORK_MARKET_V2_AUTH_VERSION;

  for (const listing of stateListings) {
    const workListing = listingTokenId(listing) === WORK_TOKEN_ID;
    const authorizationVersion = listingAuthorizationVersion(listing);
    if (
      listingNetwork(listing, state) !== "livenet" ||
      !workListing ||
      authorizationVersion === currentAuthorizationVersion ||
      WORK_MARKET_SUCCESSOR_AUTH_VERSIONS.has(authorizationVersion)
    ) {
      listings.push(listing);
      continue;
    }

    const id = listingId(listing);
    const blockHeight = listingBlockHeight(listing);
    if (
      v4Active &&
      authorizationVersion === WORK_MARKET_V2_AUTH_VERSION &&
      listing?.confirmed === true &&
      blockHeight !== null &&
      blockHeight < stateV4Activation.activationHeight
    ) {
      if (id && !closedIds.has(id)) {
        closedListings.push(v4RelicListing(listing, stateV4Activation));
        closedIds.add(id);
      }
      continue;
    }
    const legacyListing = isLegacyWorkMarketListing(listing);
    const invalidSeal = legacyListing
      ? postActivationLegacySeal(listing)
      : null;
    if (invalidSeal && !invalidIds.has(invalidSeal.txid)) {
      invalidEvents.push(cutoverInvalidSealEvent(listing, invalidSeal));
      invalidIds.add(invalidSeal.txid);
    }
    if (
      legacyListing &&
      listing?.confirmed === true &&
      blockHeight !== null &&
      blockHeight <= WORK_MARKET_V2_DECLARATION_HEIGHT
    ) {
      if (id && !closedIds.has(id)) {
        closedListings.push(
          workMarketV1RefundSnapshotIncludes(id)
            ? cutoverRelicListing(listing, {
                discardSeal: Boolean(invalidSeal),
              })
            : cutoverSnapshotExcludedListing(listing),
        );
        closedIds.add(id);
      }
      continue;
    }

    if (id && !invalidIds.has(id)) {
      invalidEvents.push(
        cutoverInvalidEvent(
          listing,
          v4Active &&
            blockHeight !== null &&
            blockHeight >= stateV4Activation.activationHeight
            ? "work-market-v4-version-required"
            : "work-market-v2-version-required",
        ),
      );
      invalidIds.add(id);
    }
  }

  const confirmedInvalidEvents = invalidEvents.filter(
    (event) => event?.confirmed === true,
  ).length;
  const workListingMetrics = activeWorkListingMetrics(listings);
  const tokens = Array.isArray(state.tokens)
    ? state.tokens.map((token) =>
        listingTokenId(token) === WORK_TOKEN_ID
          ? { ...token, ...workListingMetrics }
          : token,
      )
    : state.tokens;
  const tokenListingCounts = Array.isArray(tokens)
    ? tokens.map((token) => finiteListingCount(token?.openListings))
    : [];
  const summarizedListingCount =
    tokenListingCounts.length > 0 &&
    tokenListingCounts.every((count) => count !== null)
      ? tokenListingCounts.reduce((total, count) => total + count, 0)
      : null;
  const tokenMetricTotal = (key) => {
    if (!Array.isArray(tokens) || tokens.length === 0) {
      return null;
    }
    const counts = tokens.map((token) => finiteListingCount(token?.[key]));
    return counts.every((count) => count !== null)
      ? counts.reduce((total, count) => total + count, 0)
      : null;
  };
  const confirmedListingCount =
    tokenMetricTotal("confirmedOpenListings") ??
    listings.filter((listing) => listing?.confirmed === true).length;
  const pendingListingCount =
    tokenMetricTotal("pendingOpenListings") ??
    listings.filter((listing) => listing?.confirmed !== true).length;
  const removedNonCurrentWorkListings = stateListings.filter(
    (listing) =>
      listingNetwork(listing, state) === "livenet" &&
      listingTokenId(listing) === WORK_TOKEN_ID &&
      listingAuthorizationVersion(listing) !== currentAuthorizationVersion &&
      !WORK_MARKET_SUCCESSOR_AUTH_VERSIONS.has(
        listingAuthorizationVersion(listing),
      ),
  ).length;
  const existingListingCount = finiteListingCount(
    state.totalCounts?.listings,
  );
  const totalListingCount =
    summarizedListingCount ??
    (existingListingCount === null
      ? listings.length
      : Math.max(0, existingListingCount - removedNonCurrentWorkListings));
  const totalCounts =
    state.totalCounts && typeof state.totalCounts === "object"
      ? { ...state.totalCounts, listings: totalListingCount }
      : state.totalCounts;
  const collectionHasMore =
    state.collectionHasMore && typeof state.collectionHasMore === "object"
      ? {
          ...state.collectionHasMore,
          listings: totalListingCount > listings.length,
        }
      : state.collectionHasMore;
  return {
    ...state,
    closedListings,
    ...(collectionHasMore
      ? {
          collectionHasMore,
          hasMore: Object.values(collectionHasMore).some(Boolean),
        }
      : {}),
    invalidEvents,
    listings,
    ...(tokens ? { tokens } : {}),
    ...(totalCounts ? { totalCounts } : {}),
    workMarketV2Activation: {
      activationHeight: WORK_MARKET_V2_ACTIVATION_HEIGHT,
      declarationHeight: WORK_MARKET_V2_DECLARATION_HEIGHT,
      declarationTxid: WORK_MARKET_V2_DECLARATION_TXID,
    },
    ...(v4Active
      ? {
          workMarketV4Activation: stateV4Activation,
        }
      : {}),
    ...(state.stats && typeof state.stats === "object"
      ? {
          stats: {
            ...state.stats,
            activeListings: totalListingCount,
            confirmedOpenListings: confirmedListingCount,
            invalidEvents: confirmedInvalidEvents,
            openListings: totalListingCount,
            pendingOpenListings: pendingListingCount,
            relicListings: closedListings.filter(
              (listing) => listing?.relic === true,
            ).length,
          },
        }
      : {}),
  };
}

export function validateWorkMarketV2Authorization(
  authorization,
  { actionBlockHeight, expectedOracleBlockHash, expectedNetworkValueQ8 } = {},
) {
  const oracleBlockHeight = Number(authorization?.oracleBlockHeight);
  const oracleBlockHash = String(authorization?.oracleBlockHash ?? "")
    .trim()
    .toLowerCase();
  const oracleNetworkValueQ8 = unsignedInteger(
    authorization?.oracleNetworkValueQ8,
    { positive: true },
  );
  const amountAtoms = unsignedInteger(authorization?.amountAtoms, {
    positive: true,
  });
  const minimumPriceSats = unsignedInteger(authorization?.minimumPriceSats, {
    positive: true,
  });
  const priceSats = unsignedInteger(authorization?.priceSats, {
    positive: true,
  });
  if (authorization?.version !== WORK_MARKET_V2_AUTH_VERSION) {
    return { reasonCode: "work-market-v2-version-required", valid: false };
  }
  if (authorization?.oracleModel !== WORK_MARKET_V2_ORACLE_MODEL) {
    return { reasonCode: "work-market-v2-oracle-model-invalid", valid: false };
  }
  if (
    !Number.isSafeInteger(oracleBlockHeight) ||
    oracleBlockHeight < 1 ||
    !TXID_PATTERN.test(oracleBlockHash) ||
    oracleNetworkValueQ8 === null ||
    amountAtoms === null ||
    minimumPriceSats === null ||
    priceSats === null
  ) {
    return { reasonCode: "work-market-v2-oracle-fields-invalid", valid: false };
  }
  if (
    Number.isSafeInteger(Number(actionBlockHeight)) &&
    oracleBlockHeight !== Number(actionBlockHeight) - 1
  ) {
    return { reasonCode: "work-market-v2-oracle-height-stale", valid: false };
  }
  const expectedHash = String(expectedOracleBlockHash ?? "")
    .trim()
    .toLowerCase();
  if (expectedHash && oracleBlockHash !== expectedHash) {
    return { reasonCode: "work-market-v2-oracle-hash-mismatch", valid: false };
  }
  const expectedValue = unsignedInteger(expectedNetworkValueQ8, {
    positive: true,
  });
  if (expectedNetworkValueQ8 !== undefined && expectedValue === null) {
    return { reasonCode: "work-market-v2-canonical-oracle-unavailable", valid: false };
  }
  if (expectedValue !== null && oracleNetworkValueQ8 !== expectedValue) {
    return { reasonCode: "work-market-v2-network-value-mismatch", valid: false };
  }
  const calculatedMinimum = workMarketV2MinimumPriceSats(
    amountAtoms,
    oracleNetworkValueQ8,
  );
  if (calculatedMinimum === null || minimumPriceSats !== calculatedMinimum) {
    return { reasonCode: "work-market-v2-minimum-price-mismatch", valid: false };
  }
  if (priceSats < calculatedMinimum) {
    return {
      minimumPriceSats: calculatedMinimum.toString(),
      reasonCode: "work-market-v2-below-floor",
      valid: false,
    };
  }
  return {
    minimumPriceSats: calculatedMinimum.toString(),
    oracleBlockHash,
    oracleBlockHeight,
    oracleNetworkValueQ8: oracleNetworkValueQ8.toString(),
    valid: true,
  };
}

export function validateWorkMarketV4Authorization(
  authorization,
  {
    actionBlockHeight,
    expectedConfirmationNetworkValueQ8,
    expectedConfirmationOracleBlockHash,
    expectedQuoteNetworkValueQ8,
    expectedQuoteOracleBlockHash,
  } = {},
) {
  const actionHeight = Number(actionBlockHeight);
  const oracleBlockHeight = Number(authorization?.oracleBlockHeight);
  const oracleBlockHash = String(authorization?.oracleBlockHash ?? "")
    .trim()
    .toLowerCase();
  const oracleNetworkValueQ8 = unsignedInteger(
    authorization?.oracleNetworkValueQ8,
    { positive: true },
  );
  const amountAtoms = unsignedInteger(authorization?.amountAtoms, {
    positive: true,
  });
  const minimumPriceSats = unsignedInteger(authorization?.minimumPriceSats, {
    positive: true,
  });
  const priceSats = unsignedInteger(authorization?.priceSats, {
    positive: true,
  });
  if (authorization?.version !== WORK_MARKET_V4_AUTH_VERSION) {
    return { reasonCode: "work-market-v4-version-required", valid: false };
  }
  if (authorization?.oracleModel !== WORK_MARKET_V4_ORACLE_MODEL) {
    return { reasonCode: "work-market-v4-oracle-model-invalid", valid: false };
  }
  if (
    !Number.isSafeInteger(oracleBlockHeight) ||
    oracleBlockHeight < 1 ||
    !TXID_PATTERN.test(oracleBlockHash) ||
    oracleNetworkValueQ8 === null ||
    amountAtoms === null ||
    minimumPriceSats === null ||
    priceSats === null
  ) {
    return { reasonCode: "work-market-v4-oracle-fields-invalid", valid: false };
  }
  if (
    Number.isSafeInteger(actionHeight) &&
    oracleBlockHeight >= actionHeight
  ) {
    return { reasonCode: "work-market-v4-oracle-height-invalid", valid: false };
  }
  if (
    Number.isSafeInteger(actionHeight) &&
    !workMarketV4QuoteHeightWithinBound(actionHeight, oracleBlockHeight)
  ) {
    return { reasonCode: "work-market-v4-quote-expired", valid: false };
  }

  const expectedQuoteHash = String(expectedQuoteOracleBlockHash ?? "")
    .trim()
    .toLowerCase();
  const expectedQuoteValue = unsignedInteger(expectedQuoteNetworkValueQ8, {
    positive: true,
  });
  if (
    !TXID_PATTERN.test(expectedQuoteHash) ||
    expectedQuoteValue === null
  ) {
    return {
      reasonCode: "work-market-v4-quote-oracle-unavailable",
      valid: false,
    };
  }
  if (oracleBlockHash !== expectedQuoteHash) {
    return { reasonCode: "work-market-v4-oracle-hash-mismatch", valid: false };
  }
  if (oracleNetworkValueQ8 !== expectedQuoteValue) {
    return {
      reasonCode: "work-market-v4-network-value-mismatch",
      valid: false,
    };
  }

  const quotedMinimum = workMarketV2MinimumPriceSats(
    amountAtoms,
    oracleNetworkValueQ8,
  );
  if (quotedMinimum === null || minimumPriceSats !== quotedMinimum) {
    return {
      reasonCode: "work-market-v4-minimum-price-mismatch",
      valid: false,
    };
  }
  if (priceSats < quotedMinimum) {
    return {
      minimumPriceSats: quotedMinimum.toString(),
      reasonCode: "work-market-v4-below-quote-floor",
      valid: false,
    };
  }

  const expectedConfirmationHash = String(
    expectedConfirmationOracleBlockHash ?? "",
  )
    .trim()
    .toLowerCase();
  const expectedConfirmationValue = unsignedInteger(
    expectedConfirmationNetworkValueQ8,
    { positive: true },
  );
  if (
    !Number.isSafeInteger(actionHeight) ||
    actionHeight < 2 ||
    !TXID_PATTERN.test(expectedConfirmationHash) ||
    expectedConfirmationValue === null
  ) {
    return {
      reasonCode: "work-market-v4-confirmation-oracle-unavailable",
      valid: false,
    };
  }
  const confirmationMinimum = workMarketV2MinimumPriceSats(
    amountAtoms,
    expectedConfirmationValue,
  );
  if (confirmationMinimum === null) {
    return {
      reasonCode: "work-market-v4-confirmation-oracle-unavailable",
      valid: false,
    };
  }
  if (priceSats < confirmationMinimum) {
    return {
      confirmationMinimumPriceSats: confirmationMinimum.toString(),
      confirmationOracleBlockHash: expectedConfirmationHash,
      confirmationOracleBlockHeight: actionHeight - 1,
      confirmationOracleNetworkValueQ8: expectedConfirmationValue.toString(),
      minimumPriceSats: quotedMinimum.toString(),
      reasonCode: "work-market-v4-below-confirmation-floor",
      valid: false,
    };
  }
  return {
    confirmationMinimumPriceSats: confirmationMinimum.toString(),
    confirmationOracleBlockHash: expectedConfirmationHash,
    confirmationOracleBlockHeight: actionHeight - 1,
    confirmationOracleNetworkValueQ8: expectedConfirmationValue.toString(),
    minimumPriceSats: quotedMinimum.toString(),
    oracleBlockHash,
    oracleBlockHeight,
    oracleNetworkValueQ8: oracleNetworkValueQ8.toString(),
    valid: true,
  };
}

export function workMarketplaceBroadcastDecision(
  actions,
  { metadata = null, network = "livenet" } = {},
) {
  const governedActions = Array.isArray(actions) ? actions : [];
  if (
    String(network ?? "").trim().toLowerCase() !== "livenet" ||
    governedActions.length === 0
  ) {
    return { allowed: true };
  }
  if (metadata?.writesEnabled !== true) {
    return {
      allowed: false,
      code: "WORK_MARKETPLACE_WRITES_PAUSED",
      statusCode: 503,
    };
  }
  if (
    governedActions.some(
      (action) =>
        action?.canonicalParsed === false ||
        String(action?.authVersion ?? "").trim() !==
        WORK_MARKET_V4_AUTH_VERSION,
    )
  ) {
    return {
      allowed: false,
      code: "WORK_MARKETPLACE_V4_REQUIRED",
      statusCode: 400,
    };
  }
  if (
    governedActions.some(
      (action) =>
        action?.paysWorkRegistry !== true ||
        String(action?.tokenId ?? "").trim().toLowerCase() !== WORK_TOKEN_ID ||
        String(action?.ticker ?? "").trim().toUpperCase() !== "WORK" ||
        String(action?.registryAddress ?? "").trim() !==
          WORK_MARKET_V4_DECLARATION_REGISTRY_ADDRESS ||
        Number(action?.tokenProtocolMessageCount) !== 1 ||
        action?.signedShapeValid !== true,
    )
  ) {
    return {
      allowed: false,
      code: "WORK_MARKETPLACE_V4_TRANSACTION_INVALID",
      statusCode: 400,
    };
  }
  return { allowed: true };
}

export function workMarketplaceWriteActionIsGoverned(
  action,
  { paysWorkRegistry = false } = {},
) {
  const actionName = String(action?.action ?? "").trim().toLowerCase();
  if (!["list5", "seal5", "buy5", "delist5"].includes(actionName)) {
    return false;
  }
  const tokenId = String(action?.tokenId ?? "").trim().toLowerCase();
  return tokenId === WORK_TOKEN_ID || paysWorkRegistry === true;
}
