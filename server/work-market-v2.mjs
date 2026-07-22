import { WORK_TOKEN_ID } from "./work-units.mjs";

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
export const WORK_MARKET_V2_MAX_SUPPLY = 21_000_000n;
export const WORK_MARKET_V2_ATOMS_PER_WORK = 100_000_000n;
export const WORK_MARKET_V2_VALUE_Q8_SCALE = 100_000_000n;

const TXID_PATTERN = /^[0-9a-f]{64}$/u;
const LEGACY_WORK_MARKET_AUTH_VERSIONS = new Set([
  "pwt-sale-v1",
  "pwt-sale-v2",
]);

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
    expectedOracleBlockHash,
    expectedNetworkValueQ8,
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

function cutoverInvalidEvent(listing) {
  const confirmed = listing?.confirmed === true;
  const reasonCode = "work-market-v2-version-required";
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

function cutoverInvalidSealEvent(listing, seal) {
  const reasonCode = "work-market-v2-version-required";
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
    ? [...state.closedListings]
    : [];
  const invalidEvents = Array.isArray(state.invalidEvents)
    ? [...state.invalidEvents]
    : [];
  const closedIds = new Set(closedListings.map(listingId).filter(Boolean));
  const invalidIds = new Set(invalidEvents.map(transactionId).filter(Boolean));

  for (const listing of stateListings) {
    const workListing = listingTokenId(listing) === WORK_TOKEN_ID;
    const authorizationVersion = listingAuthorizationVersion(listing);
    if (
      listingNetwork(listing, state) !== "livenet" ||
      !workListing ||
      authorizationVersion === WORK_MARKET_V2_AUTH_VERSION
    ) {
      listings.push(listing);
      continue;
    }

    const id = listingId(listing);
    const blockHeight = listingBlockHeight(listing);
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
          cutoverRelicListing(listing, { discardSeal: Boolean(invalidSeal) }),
        );
        closedIds.add(id);
      }
      continue;
    }

    if (id && !invalidIds.has(id)) {
      invalidEvents.push(cutoverInvalidEvent(listing));
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
  const removedNonV3WorkListings = stateListings.filter(
    (listing) =>
      listingNetwork(listing, state) === "livenet" &&
      listingTokenId(listing) === WORK_TOKEN_ID &&
      listingAuthorizationVersion(listing) !== WORK_MARKET_V2_AUTH_VERSION,
  ).length;
  const existingListingCount = finiteListingCount(
    state.totalCounts?.listings,
  );
  const totalListingCount =
    summarizedListingCount ??
    (existingListingCount === null
      ? listings.length
      : Math.max(0, existingListingCount - removedNonV3WorkListings));
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
