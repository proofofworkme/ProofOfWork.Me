import {
  WORK_AMO_V4_AUTH_VERSION,
  WORK_AMO_V5_AUTH_VERSION,
  WORK_AMO_V5_DECLARATION_REGISTRY_ADDRESS,
  WORK_AMO_V5_MAX_SUPPLY,
  WORK_AMO_V5_NETWORK_VALUE_Q8_SCALE,
  compareWorkAmoCanonicalPositions,
  isWorkAmoV5LivenetAddress,
  normalizeWorkAmoCanonicalPosition,
  replayWorkAmoV5CanonicalBlock,
  validateWorkAmoV5FrozenTerms,
  workAmoCanonicalPositionPrecedes,
  workAmoCeilDiv,
  workAmoFloorDiv,
  workAmoV5CanonicalTokenStateCommitment,
  workAmoV5CanonicalTokenStatePreimage,
  workAmoV5CanonicalExpiryMs,
} from "./work-amo-v5.mjs";
import { WORK_TOKEN_ID } from "./work-units.mjs";

export const WORK_AMO_V6_AUTH_VERSION = "pwt-sale-v6";
export const WORK_AMO_V6_UNIT_MODEL =
  "canonical-work-amo-proof-unit-v1";
export const WORK_AMO_V6_STATE_ORDER_MODEL =
  "canonical-proof-state-order-v1";
export const WORK_AMO_V6_AMOUNT_MODEL =
  "canonical-confirmed-position-derived-work-amount-v1";
export const WORK_AMO_V6_UNIT_WORK_ORACLE_MODEL =
  "canonical-work-prefix-before-action-v1";
export const WORK_AMO_V6_BOND_TRANSITION_MODEL =
  "canonical-compute-then-bond-v1";
export const WORK_AMO_V6_BLOCK_SEQUENCER_MODEL =
  "canonical-work-amo-full-position-block-sequencer-v2";
export const WORK_AMO_V6_DECLARATION_EVIDENCE_MODEL =
  "canonical-work-amo-v6-declaration-evidence-v1";
export const WORK_AMO_V6_ATOMS_PER_WORK = 10_000_000_000_000_000n;
export const WORK_AMO_V6_ALLOWED_FACE_PROOFS = Object.freeze([
  20_000,
  50_000,
  100_000,
]);
export const WORK_AMO_V6_MODELS = Object.freeze({
  amountModel: WORK_AMO_V6_AMOUNT_MODEL,
  bondTransitionModel: WORK_AMO_V6_BOND_TRANSITION_MODEL,
  stateOrderModel: WORK_AMO_V6_STATE_ORDER_MODEL,
  unitModel: WORK_AMO_V6_UNIT_MODEL,
  unitWorkOracleModel: WORK_AMO_V6_UNIT_WORK_ORACLE_MODEL,
});
export const WORK_AMO_V6_STATIC_AUTHORIZATION_FIELDS = Object.freeze([
  "version",
  "unitModel",
  "stateOrderModel",
  "amountModel",
  "bondTransitionModel",
  "unitWorkOracleModel",
  "tokenId",
  "ticker",
  "network",
  "registryAddress",
  "sellerAddress",
  "sellerPublicKey",
  "buyerAddress",
  "nonce",
  "expiresAt",
  "unitFaceProofs",
  "anchorType",
  "anchorVout",
  "anchorValueSats",
  "anchorSigHashType",
  "anchorScriptPubKey",
  "anchorTxid",
  "anchorSignature",
]);

export const WORK_AMO_V6_FROZEN_TERM_FIELDS = Object.freeze([
  "version",
  "unitModel",
  "stateOrderModel",
  "amountModel",
  "bondTransitionModel",
  "unitWorkOracleModel",
  "unitFaceProofs",
  "listingBlockHeight",
  "listingBlockHash",
  "listingBlockIndex",
  "listingProtocolVout",
  "listingRecordOrdinal",
  "listingNetworkValueBeforeQ8",
  "unitAmountAtoms",
  "unitPriceSats",
  "unitMinimumPriceSats",
  "listingBondContributionQ8",
  "listingNetworkValueAfterQ8",
]);

const TXID_PATTERN = /^[0-9a-f]{64}$/u;
const HASH_PATTERN = /^[0-9a-f]{64}$/u;
const HEX_PATTERN = /^(?:[0-9a-f]{2})+$/u;
const UNSIGNED_INTEGER_PATTERN = /^(?:0|[1-9][0-9]*)$/u;
const V6_DERIVED_AUTHORIZATION_FIELDS = Object.freeze([
  "amount",
  "amountAtoms",
  "minimumPriceSats",
  "priceSats",
  "unitAmountAtoms",
  "unitFaceUsd",
  "unitFaceUsdCents",
  "unitMinimumPriceSats",
  "unitNetworkValueAfterQ8",
  "unitNetworkValueBeforeQ8",
  "unitPriceSats",
  "unitUsdPer100mProofsQ8",
  "unitUsdAttestation",
  "unitUsdOracleModel",
]);
const V6_STATIC_AUTHORIZATION_FIELD_SET = new Set(
  WORK_AMO_V6_STATIC_AUTHORIZATION_FIELDS,
);
const V6_FROZEN_TERM_FIELD_SET = new Set(
  WORK_AMO_V6_FROZEN_TERM_FIELDS,
);

function invalid(reasonCode, detail = {}) {
  return { ...detail, reasonCode, valid: false };
}

function normalizedLowerText(value) {
  return String(value ?? "").trim().toLowerCase();
}

function normalizedTxid(value) {
  const txid = normalizedLowerText(value);
  return TXID_PATTERN.test(txid) ? txid : "";
}

function canonicalSafeInteger(value, { positive = false } = {}) {
  if (
    typeof value !== "number" ||
    !Number.isSafeInteger(value) ||
    value < (positive ? 1 : 0)
  ) {
    return null;
  }
  return value;
}

function canonicalUnsignedIntegerText(value, { positive = false } = {}) {
  if (
    typeof value !== "string" &&
    typeof value !== "bigint" &&
    typeof value !== "number"
  ) {
    return "";
  }
  if (typeof value === "number" && !Number.isSafeInteger(value)) {
    return "";
  }
  const text = String(value).trim();
  if (!UNSIGNED_INTEGER_PATTERN.test(text)) {
    return "";
  }
  if (positive && text === "0") {
    return "";
  }
  return BigInt(text).toString();
}

function positiveBigInt(value) {
  const text = canonicalUnsignedIntegerText(value, { positive: true });
  return text ? BigInt(text) : null;
}

function nonNegativeBigInt(value) {
  const text = canonicalUnsignedIntegerText(value);
  return text ? BigInt(text) : null;
}

function samePosition(left, right) {
  const normalizedLeft = normalizeWorkAmoCanonicalPosition(left);
  const normalizedRight = normalizeWorkAmoCanonicalPosition(right);
  return Boolean(
    normalizedLeft &&
      normalizedRight &&
      normalizedLeft.blockHash === normalizedRight.blockHash &&
      compareWorkAmoCanonicalPositions(
        normalizedLeft,
        normalizedRight,
      ) === 0,
  );
}

function authorizationModelsValid(authorization) {
  return Object.entries(WORK_AMO_V6_MODELS).every(
    ([field, expected]) => authorization?.[field] === expected,
  );
}

export function validateWorkAmoV6StaticAuthorization(
  authorization,
) {
  if (
    !authorization ||
    typeof authorization !== "object" ||
    Array.isArray(authorization) ||
    Object.getPrototypeOf(authorization) !== Object.prototype
  ) {
    return invalid("work-amo-v6-authorization-invalid");
  }
  if (authorization.version !== WORK_AMO_V6_AUTH_VERSION) {
    return invalid("work-amo-v6-version-required");
  }
  if (!authorizationModelsValid(authorization)) {
    return invalid("work-amo-v6-models-invalid");
  }
  const unitFaceProofs = canonicalSafeInteger(
    authorization.unitFaceProofs,
    { positive: true },
  );
  if (
    !WORK_AMO_V6_ALLOWED_FACE_PROOFS.includes(unitFaceProofs)
  ) {
    return invalid("work-amo-v6-face-unit-invalid");
  }
  if (
    V6_DERIVED_AUTHORIZATION_FIELDS.some(
      (field) =>
        authorization[field] !== undefined &&
        authorization[field] !== null &&
        authorization[field] !== "",
    )
  ) {
    return invalid("work-amo-v6-derived-fields-not-signable");
  }
  if (
    Object.keys(authorization).some(
      (field) => !V6_STATIC_AUTHORIZATION_FIELD_SET.has(field),
    )
  ) {
    return invalid("work-amo-v6-authorization-shape-invalid");
  }
  const tokenId = normalizedLowerText(authorization.tokenId);
  const ticker = String(authorization.ticker ?? "").trim().toUpperCase();
  const registryAddress = String(
    authorization.registryAddress ?? "",
  ).trim();
  const sellerAddress = String(
    authorization.sellerAddress ?? "",
  ).trim();
  const buyerAddress = String(authorization.buyerAddress ?? "").trim();
  const nonce = String(authorization.nonce ?? "").trim();
  const expiresAt = String(authorization.expiresAt ?? "").trim();
  const expiresAtMs = workAmoV5CanonicalExpiryMs(expiresAt);
  const anchorScriptPubKey = normalizedLowerText(
    authorization.anchorScriptPubKey,
  );
  const sellerPublicKey = normalizedLowerText(
    authorization.sellerPublicKey,
  );
  const anchorTxid = authorization.anchorTxid
    ? normalizedTxid(authorization.anchorTxid)
    : "";
  const anchorSignature = authorization.anchorSignature
    ? normalizedLowerText(authorization.anchorSignature)
    : "";
  if (
    tokenId !== WORK_TOKEN_ID ||
    ticker !== "WORK" ||
    authorization.network !== "livenet" ||
    registryAddress !== WORK_AMO_V5_DECLARATION_REGISTRY_ADDRESS ||
    !isWorkAmoV5LivenetAddress(sellerAddress) ||
    (buyerAddress && !isWorkAmoV5LivenetAddress(buyerAddress)) ||
    !nonce ||
    nonce.length > 160 ||
    (expiresAt && !Number.isSafeInteger(expiresAtMs)) ||
    authorization.anchorType !== "sale-ticket-v1" ||
    authorization.anchorVout !== 2 ||
    authorization.anchorValueSats !== 546 ||
    authorization.anchorSigHashType !== 0x83 ||
    !HEX_PATTERN.test(anchorScriptPubKey) ||
    !/^(?:[0-9a-f]{64}|(?:02|03)[0-9a-f]{64}|04[0-9a-f]{128})$/u.test(
      sellerPublicKey,
    ) ||
    (authorization.anchorTxid && !anchorTxid) ||
    (authorization.anchorSignature &&
      !HEX_PATTERN.test(anchorSignature))
  ) {
    return invalid("work-amo-v6-static-fields-invalid");
  }
  return {
    authorization: {
      ...WORK_AMO_V6_MODELS,
      anchorScriptPubKey,
      anchorSigHashType: 0x83,
      anchorType: "sale-ticket-v1",
      anchorValueSats: 546,
      anchorVout: 2,
      buyerAddress,
      expiresAt,
      network: "livenet",
      nonce,
      registryAddress,
      sellerAddress,
      sellerPublicKey,
      ticker: "WORK",
      tokenId: WORK_TOKEN_ID,
      unitFaceProofs,
      version: WORK_AMO_V6_AUTH_VERSION,
      ...(anchorTxid ? { anchorTxid } : {}),
      ...(anchorSignature ? { anchorSignature } : {}),
    },
    valid: true,
  };
}

export function workAmoV6UnitTerms({
  networkValueBeforeQ8,
  unitFaceProofs,
} = {}) {
  const face = canonicalSafeInteger(unitFaceProofs, {
    positive: true,
  });
  const networkValue = positiveBigInt(networkValueBeforeQ8);
  if (!WORK_AMO_V6_ALLOWED_FACE_PROOFS.includes(face)) {
    return invalid("work-amo-v6-face-unit-invalid");
  }
  if (networkValue === null) {
    return invalid("work-amo-v6-network-value-before-invalid");
  }
  const denominator =
    WORK_AMO_V5_MAX_SUPPLY *
    WORK_AMO_V6_ATOMS_PER_WORK *
    WORK_AMO_V5_NETWORK_VALUE_Q8_SCALE;
  const unitPriceSats = BigInt(face);
  const unitAmountAtoms = workAmoFloorDiv(
    unitPriceSats * denominator,
    networkValue,
  );
  const unitMinimumPriceSats = workAmoCeilDiv(
    unitAmountAtoms * networkValue,
    denominator,
  );
  if (
    unitPriceSats <= 0n ||
    unitAmountAtoms <= 0n ||
    unitMinimumPriceSats <= 0n
  ) {
    return invalid("work-amo-v6-unit-result-nonpositive");
  }
  if (
    unitAmountAtoms >
    WORK_AMO_V5_MAX_SUPPLY * WORK_AMO_V6_ATOMS_PER_WORK
  ) {
    return invalid("work-amo-v6-unit-amount-exceeds-supply");
  }
  if (unitPriceSats < unitMinimumPriceSats) {
    return invalid("work-amo-v6-unit-price-below-minimum");
  }
  return {
    unitAmountAtoms: unitAmountAtoms.toString(),
    unitMinimumPriceSats: unitMinimumPriceSats.toString(),
    unitPriceSats: unitPriceSats.toString(),
    valid: true,
  };
}

export const calculateWorkAmoV6UnitTerms = workAmoV6UnitTerms;

export function validateWorkAmoV6ListingCutover({
  activationHeight,
  authorizationVersion,
  listingPosition,
} = {}) {
  const activation = canonicalSafeInteger(activationHeight, {
    positive: true,
  });
  const listing = normalizeWorkAmoCanonicalPosition(listingPosition);
  const version = String(authorizationVersion ?? "").trim();
  if (activation === null || !listing) {
    return invalid("work-amo-v6-listing-cutover-unavailable");
  }
  if (listing.blockHeight < activation) {
    return version === WORK_AMO_V6_AUTH_VERSION
      ? invalid("work-amo-v6-listing-before-activation")
      : {
          historical: true,
          listingPosition: listing,
          valid: [
            WORK_AMO_V4_AUTH_VERSION,
            WORK_AMO_V5_AUTH_VERSION,
          ].includes(version),
          ...(version === WORK_AMO_V4_AUTH_VERSION ||
          version === WORK_AMO_V5_AUTH_VERSION
            ? {}
            : {
                reasonCode:
                  "work-amo-v6-historical-listing-version-invalid",
              }),
        };
  }
  if (version !== WORK_AMO_V6_AUTH_VERSION) {
    return invalid("work-amo-v6-version-required");
  }
  return {
    historical: false,
    listingPosition: listing,
    valid: true,
  };
}

export function deriveWorkAmoV6FrozenTerms(
  authorization,
  {
    activationHeight,
    listingBondContributionQ8,
    listingPosition,
    networkValueBeforeQ8,
    spendableAmountAtoms,
  } = {},
) {
  const listing = normalizeWorkAmoCanonicalPosition(listingPosition);
  if (!listing) {
    return invalid("work-amo-v6-listing-position-unavailable");
  }
  const cutover = validateWorkAmoV6ListingCutover({
    activationHeight,
    authorizationVersion: authorization?.version,
    listingPosition: listing,
  });
  if (!cutover.valid || cutover.historical === true) {
    return cutover.valid
      ? invalid("work-amo-v6-listing-before-activation")
      : cutover;
  }
  const staticValidation = validateWorkAmoV6StaticAuthorization(
    authorization,
  );
  if (!staticValidation.valid) {
    return staticValidation;
  }
  const networkValue = positiveBigInt(networkValueBeforeQ8);
  if (networkValue === null) {
    return invalid("work-amo-v6-network-value-before-invalid");
  }
  const bondContribution = positiveBigInt(
    listingBondContributionQ8,
  );
  if (bondContribution === null) {
    return invalid(
      "work-amo-v6-listing-bond-contribution-invalid",
    );
  }
  const unit = workAmoV6UnitTerms({
    networkValueBeforeQ8: networkValue.toString(),
    unitFaceProofs:
      staticValidation.authorization.unitFaceProofs,
  });
  if (!unit.valid) {
    return unit;
  }
  const spendable = nonNegativeBigInt(spendableAmountAtoms);
  if (spendable === null) {
    return invalid("work-amo-v6-spendable-balance-unavailable");
  }
  if (spendable < BigInt(unit.unitAmountAtoms)) {
    return invalid("work-amo-v6-insufficient-spendable-balance", {
      requiredAmountAtoms: unit.unitAmountAtoms,
      spendableAmountAtoms: spendable.toString(),
    });
  }
  const networkAfter = networkValue + bondContribution;
  return {
    frozenTerms: {
      ...WORK_AMO_V6_MODELS,
      listingBlockHash: listing.blockHash,
      listingBlockHeight: listing.blockHeight,
      listingBlockIndex: listing.blockTransactionIndex,
      listingBondContributionQ8: bondContribution.toString(),
      listingNetworkValueAfterQ8: networkAfter.toString(),
      listingNetworkValueBeforeQ8: networkValue.toString(),
      listingProtocolVout: listing.protocolVout,
      listingRecordOrdinal: listing.recordOrdinal,
      unitAmountAtoms: unit.unitAmountAtoms,
      unitFaceProofs:
        staticValidation.authorization.unitFaceProofs,
      unitMinimumPriceSats: unit.unitMinimumPriceSats,
      unitPriceSats: unit.unitPriceSats,
      version: WORK_AMO_V6_AUTH_VERSION,
    },
    valid: true,
  };
}

function normalizeWorkAmoV6FrozenTerms(value) {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    Object.getPrototypeOf(value) !== Object.prototype ||
    Object.keys(value).some(
      (field) => !V6_FROZEN_TERM_FIELD_SET.has(field),
    ) ||
    value.version !== WORK_AMO_V6_AUTH_VERSION ||
    !authorizationModelsValid(value)
  ) {
    return null;
  }
  const unitFaceProofs = canonicalSafeInteger(value.unitFaceProofs, {
    positive: true,
  });
  const listingPosition = normalizeWorkAmoCanonicalPosition({
    blockHash: value.listingBlockHash,
    blockHeight: value.listingBlockHeight,
    blockTransactionIndex: value.listingBlockIndex,
    protocolVout: value.listingProtocolVout,
    recordOrdinal: value.listingRecordOrdinal,
  });
  const networkBefore = positiveBigInt(
    value.listingNetworkValueBeforeQ8,
  );
  const networkAfter = positiveBigInt(
    value.listingNetworkValueAfterQ8,
  );
  const bond = positiveBigInt(value.listingBondContributionQ8);
  const amount = positiveBigInt(value.unitAmountAtoms);
  const price = positiveBigInt(value.unitPriceSats);
  const minimum = positiveBigInt(value.unitMinimumPriceSats);
  if (
    !WORK_AMO_V6_ALLOWED_FACE_PROOFS.includes(unitFaceProofs) ||
    !listingPosition ||
    networkBefore === null ||
    networkAfter === null ||
    bond === null ||
    amount === null ||
    price === null ||
    minimum === null ||
    networkAfter !== networkBefore + bond
  ) {
    return null;
  }
  const unit = workAmoV6UnitTerms({
    networkValueBeforeQ8: networkBefore.toString(),
    unitFaceProofs,
  });
  if (
    !unit.valid ||
    unit.unitAmountAtoms !== amount.toString() ||
    unit.unitPriceSats !== price.toString() ||
    unit.unitMinimumPriceSats !== minimum.toString()
  ) {
    return null;
  }
  return {
    ...WORK_AMO_V6_MODELS,
    listingBlockHash: listingPosition.blockHash,
    listingBlockHeight: listingPosition.blockHeight,
    listingBlockIndex: listingPosition.blockTransactionIndex,
    listingBondContributionQ8: bond.toString(),
    listingNetworkValueAfterQ8: networkAfter.toString(),
    listingNetworkValueBeforeQ8: networkBefore.toString(),
    listingProtocolVout: listingPosition.protocolVout,
    listingRecordOrdinal: listingPosition.recordOrdinal,
    unitAmountAtoms: amount.toString(),
    unitFaceProofs,
    unitMinimumPriceSats: minimum.toString(),
    unitPriceSats: price.toString(),
    version: WORK_AMO_V6_AUTH_VERSION,
  };
}

export function validateWorkAmoV6FrozenTerms(
  frozenTerms,
  {
    authorization = null,
    listingBondContributionQ8,
    listingPosition = null,
    networkValueBeforeQ8,
  } = {},
) {
  const normalized = normalizeWorkAmoV6FrozenTerms(frozenTerms);
  if (!normalized) {
    return invalid("work-amo-v6-frozen-terms-invalid");
  }
  if (
    listingPosition &&
    !samePosition(listingPosition, {
      blockHash: normalized.listingBlockHash,
      blockHeight: normalized.listingBlockHeight,
      blockTransactionIndex: normalized.listingBlockIndex,
      protocolVout: normalized.listingProtocolVout,
      recordOrdinal: normalized.listingRecordOrdinal,
    })
  ) {
    return invalid(
      "work-amo-v6-frozen-listing-position-mismatch",
    );
  }
  const expectedNetwork =
    networkValueBeforeQ8 === undefined
      ? ""
      : canonicalUnsignedIntegerText(networkValueBeforeQ8, {
          positive: true,
        });
  if (
    networkValueBeforeQ8 !== undefined &&
    expectedNetwork !== normalized.listingNetworkValueBeforeQ8
  ) {
    return invalid("work-amo-v6-frozen-network-value-mismatch");
  }
  const expectedBond =
    listingBondContributionQ8 === undefined
      ? ""
      : canonicalUnsignedIntegerText(listingBondContributionQ8, {
          positive: true,
        });
  if (
    listingBondContributionQ8 !== undefined &&
    expectedBond !== normalized.listingBondContributionQ8
  ) {
    return invalid(
      "work-amo-v6-frozen-bond-contribution-mismatch",
    );
  }
  if (authorization) {
    if (
      authorization.version !== WORK_AMO_V6_AUTH_VERSION ||
      !authorizationModelsValid(authorization) ||
      canonicalSafeInteger(authorization.unitFaceProofs, {
        positive: true,
      }) !== normalized.unitFaceProofs
    ) {
      return invalid(
        "work-amo-v6-frozen-authorization-mismatch",
      );
    }
  }
  return { frozenTerms: normalized, valid: true };
}

function canonicalWorkAmoV6TokenStateListing({
  authorization,
  frozenTerms,
  sellerAddress,
} = {}) {
  const staticValidation =
    validateWorkAmoV6StaticAuthorization(authorization);
  if (
    !staticValidation.valid ||
    staticValidation.authorization.sellerAddress !== sellerAddress
  ) {
    return null;
  }
  const frozenValidation = validateWorkAmoV6FrozenTerms(
    frozenTerms,
    {
      authorization: staticValidation.authorization,
    },
  );
  if (!frozenValidation.valid) {
    return null;
  }
  return {
    amountAtoms: frozenValidation.frozenTerms.unitAmountAtoms,
    frozenTerms: frozenValidation.frozenTerms,
    priceSats: frozenValidation.frozenTerms.unitPriceSats,
    saleAuthorization: staticValidation.authorization,
  };
}

export function workAmoV6CanonicalTokenStatePreimage(tokenState) {
  return workAmoV5CanonicalTokenStatePreimage(tokenState, {
    canonicalizeAdditionalListing:
      canonicalWorkAmoV6TokenStateListing,
  });
}

export function workAmoV6CanonicalTokenStateCommitment(tokenState) {
  return workAmoV5CanonicalTokenStateCommitment(tokenState, {
    canonicalizeAdditionalListing:
      canonicalWorkAmoV6TokenStateListing,
  });
}

export function workAmoV6FrozenTermsMatch(left, right) {
  const normalizedLeft = normalizeWorkAmoV6FrozenTerms(left);
  const normalizedRight = normalizeWorkAmoV6FrozenTerms(right);
  return Boolean(
    normalizedLeft &&
      normalizedRight &&
      WORK_AMO_V6_FROZEN_TERM_FIELDS.every(
        (field) => normalizedLeft[field] === normalizedRight[field],
      ),
  );
}

export function validateWorkAmoV6LegacyListingReference(
  {
    actionAuthorization = null,
    activationHeight,
    legacyValidation = null,
    listingAuthorization,
    listingFrozenTerms,
    listingPosition,
  } = {},
) {
  const activation = canonicalSafeInteger(activationHeight, {
    positive: true,
  });
  const position = normalizeWorkAmoCanonicalPosition(
    listingPosition ?? {
      blockHash: listingFrozenTerms?.listingBlockHash,
      blockHeight: listingFrozenTerms?.listingBlockHeight,
      blockTransactionIndex: listingFrozenTerms?.listingBlockIndex,
      protocolVout: listingFrozenTerms?.listingProtocolVout,
      recordOrdinal: listingFrozenTerms?.listingRecordOrdinal,
    },
  );
  const version = String(
    listingAuthorization?.version ??
      listingFrozenTerms?.authorizationVersion ??
      listingFrozenTerms?.version ??
      "",
  ).trim();
  if (
    activation === null ||
    !position ||
    position.blockHeight >= activation ||
    ![WORK_AMO_V4_AUTH_VERSION, WORK_AMO_V5_AUTH_VERSION].includes(
      version,
    )
  ) {
    return invalid("work-amo-v6-legacy-reference-invalid");
  }
  if (version === WORK_AMO_V5_AUTH_VERSION) {
    const validation = validateWorkAmoV5FrozenTerms(
      listingFrozenTerms,
      {
        authorization: listingAuthorization,
        listingPosition: position,
      },
    );
    if (!validation.valid) {
      return invalid(
        "work-amo-v6-legacy-v5-frozen-terms-invalid",
        { legacyReasonCode: validation.reasonCode },
      );
    }
    return {
      frozenTerms: validation.frozenTerms,
      listingAuthorizationVersion: version,
      listingPosition: position,
      valid: true,
    };
  }
  if (typeof legacyValidation !== "function") {
    return invalid(
      "work-amo-v6-legacy-v4-validator-unavailable",
    );
  }
  let validation;
  try {
    validation = legacyValidation({
      actionAuthorization,
      listingAuthorization,
      listingFrozenTerms,
      listingPosition: position,
    });
  } catch {
    return invalid("work-amo-v6-legacy-v4-validation-failed");
  }
  if (validation?.valid !== true) {
    return invalid("work-amo-v6-legacy-v4-frozen-terms-invalid", {
      legacyReasonCode: String(validation?.reasonCode ?? ""),
    });
  }
  return {
    frozenTerms:
      validation.frozenTerms ?? listingFrozenTerms,
    listingAuthorizationVersion: version,
    listingPosition: position,
    valid: true,
  };
}

/**
 * Settlements validate only the listing's already-frozen canonical terms.
 * They never select or compare a current network-value estimate.
 */
export function validateWorkAmoV6SealOrBuyTerms({
  actionAuthorization = null,
  actionFrozenTerms = null,
  actionPosition,
  activationHeight,
  legacyValidation = null,
  listingAuthorization,
  listingFrozenTerms,
  listingPosition,
  referencesListingFrozenTerms = false,
} = {}) {
  const listingVersion = String(
    listingAuthorization?.version ??
      listingFrozenTerms?.authorizationVersion ??
      listingFrozenTerms?.version ??
      "",
  ).trim();
  let listingValidation;
  if (listingVersion === WORK_AMO_V6_AUTH_VERSION) {
    listingValidation = validateWorkAmoV6FrozenTerms(
      listingFrozenTerms,
      {
        authorization: listingAuthorization,
        listingPosition,
      },
    );
  } else {
    listingValidation =
      validateWorkAmoV6LegacyListingReference({
        actionAuthorization,
        activationHeight,
        legacyValidation,
        listingAuthorization,
        listingFrozenTerms,
        listingPosition,
      });
  }
  if (!listingValidation.valid) {
    return listingValidation;
  }
  const normalizedListingPosition = normalizeWorkAmoCanonicalPosition(
    listingPosition ?? {
      blockHash: listingValidation.frozenTerms.listingBlockHash,
      blockHeight: listingValidation.frozenTerms.listingBlockHeight,
      blockTransactionIndex:
        listingValidation.frozenTerms.listingBlockIndex,
      protocolVout:
        listingValidation.frozenTerms.listingProtocolVout,
      recordOrdinal:
        listingValidation.frozenTerms.listingRecordOrdinal,
    },
  );
  const normalizedActionPosition =
    normalizeWorkAmoCanonicalPosition(actionPosition);
  if (
    !normalizedListingPosition ||
    !normalizedActionPosition ||
    !workAmoCanonicalPositionPrecedes(
      normalizedListingPosition,
      normalizedActionPosition,
    )
  ) {
    return invalid("work-amo-v6-action-not-after-listing");
  }
  if (referencesListingFrozenTerms === true && !actionFrozenTerms) {
    return {
      frozenTerms: listingValidation.frozenTerms,
      listingAuthorizationVersion: listingVersion,
      referenced: true,
      valid: true,
    };
  }
  if (
    listingVersion !== WORK_AMO_V6_AUTH_VERSION ||
    !actionFrozenTerms ||
    !workAmoV6FrozenTermsMatch(
      listingValidation.frozenTerms,
      actionFrozenTerms,
    )
  ) {
    return invalid(
      "work-amo-v6-action-frozen-terms-mismatch",
    );
  }
  return {
    frozenTerms: listingValidation.frozenTerms,
    listingAuthorizationVersion: listingVersion,
    referenced: false,
    valid: true,
  };
}

export function replayWorkAmoV6CanonicalBlock({
  activationHeight,
  ...options
} = {}) {
  const activation = canonicalSafeInteger(activationHeight, {
    positive: true,
  });
  const blockHeight = canonicalSafeInteger(options.blockHeight, {
    positive: true,
  });
  if (
    activation === null ||
    blockHeight === null ||
    blockHeight < activation
  ) {
    const error = new Error(
      "work-amo-v6-sequencer-before-activation",
    );
    error.code = "work-amo-v6-sequencer-before-activation";
    throw error;
  }
  const replay = replayWorkAmoV5CanonicalBlock(options);
  return {
    ...replay,
    activationHeight: activation,
    model: WORK_AMO_V6_BLOCK_SEQUENCER_MODEL,
  };
}

export const compareWorkAmoV6CanonicalPositions =
  compareWorkAmoCanonicalPositions;
export const workAmoV6CanonicalPositionPrecedes =
  workAmoCanonicalPositionPrecedes;

function normalizeExpectedDeclaration(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  const txid = normalizedTxid(value.txid ?? value.declarationTxid);
  const blockHash = normalizedTxid(value.blockHash);
  const blockHeight = canonicalSafeInteger(value.blockHeight, {
    positive: true,
  });
  const blockTransactionIndex = canonicalSafeInteger(
    value.blockTransactionIndex ?? value.blockIndex,
  );
  const protocolVout = canonicalSafeInteger(value.protocolVout);
  const recordOrdinal = canonicalSafeInteger(value.recordOrdinal);
  const activationHeight = canonicalSafeInteger(
    value.activationHeight,
    { positive: true },
  );
  const payloadSha256 = normalizedLowerText(value.payloadSha256);
  const payloadBytes = canonicalSafeInteger(value.payloadBytes, {
    positive: true,
  });
  const authorityScriptPubKey = normalizedLowerText(
    value.authorityScriptPubKey,
  );
  const registryAddress = String(value.registryAddress ?? "").trim();
  const registryPaymentVout = canonicalSafeInteger(
    value.registryPaymentVout,
  );
  const minimumPaymentSats = canonicalSafeInteger(
    value.minimumPaymentSats,
    { positive: true },
  );
  if (
    !txid ||
    !blockHash ||
    blockHeight === null ||
    blockTransactionIndex === null ||
    protocolVout === null ||
    recordOrdinal === null ||
    activationHeight !== blockHeight + 1 ||
    !HASH_PATTERN.test(payloadSha256) ||
    payloadBytes === null ||
    !HEX_PATTERN.test(authorityScriptPubKey) ||
    registryAddress !== WORK_AMO_V5_DECLARATION_REGISTRY_ADDRESS ||
    registryPaymentVout === null ||
    minimumPaymentSats !== 546
  ) {
    return null;
  }
  return {
    activationHeight,
    authorityScriptPubKey,
    blockHash,
    blockHeight,
    blockTransactionIndex,
    minimumPaymentSats,
    payloadBytes,
    payloadSha256,
    protocolVout,
    recordOrdinal,
    registryAddress,
    registryPaymentVout,
    txid,
  };
}

export function validateWorkAmoV6DeclarationEvidence(
  evidence,
  { expectedDeclaration } = {},
) {
  const expected = normalizeExpectedDeclaration(expectedDeclaration);
  if (!expected) {
    return invalid(
      "work-amo-v6-declaration-commitment-unconfigured",
    );
  }
  const evidencePosition = normalizeWorkAmoCanonicalPosition({
    blockHash: evidence?.blockHash,
    blockHeight: evidence?.blockHeight,
    blockTransactionIndex:
      evidence?.blockTransactionIndex ?? evidence?.blockIndex,
    protocolVout: evidence?.protocolVout,
    recordOrdinal: evidence?.recordOrdinal,
  });
  if (
    evidence?.confirmed !== true ||
    evidence?.canonical !== true ||
    evidence?.evidenceComplete !== true ||
    normalizedTxid(evidence?.txid ?? evidence?.declarationTxid) !==
      expected.txid ||
    !samePosition(evidencePosition, expected) ||
    Number(evidence?.activationHeight) !== expected.activationHeight ||
    normalizedLowerText(evidence?.payloadSha256) !==
      expected.payloadSha256 ||
    Number(evidence?.payloadBytes) !== expected.payloadBytes ||
    normalizedLowerText(evidence?.authorityScriptPubKey) !==
      expected.authorityScriptPubKey ||
    String(evidence?.registryAddress ?? "").trim() !==
      expected.registryAddress ||
    Number(evidence?.registryPaymentVout) !==
      expected.registryPaymentVout ||
    Number(evidence?.minimumPaymentSats) !==
      expected.minimumPaymentSats
  ) {
    return invalid("work-amo-v6-declaration-evidence-mismatch");
  }
  return {
    activationHeight: expected.activationHeight,
    declaration: expected,
    model: WORK_AMO_V6_DECLARATION_EVIDENCE_MODEL,
    valid: true,
  };
}

export function workAmoV6ActivationFromEvidence(
  evidence,
  {
    expectedDeclaration,
    indexedThroughBlock,
  } = {},
) {
  const validation = validateWorkAmoV6DeclarationEvidence(evidence, {
    expectedDeclaration,
  });
  if (!validation.valid) {
    return {
      active: false,
      reasonCode: validation.reasonCode,
    };
  }
  const indexed = canonicalSafeInteger(indexedThroughBlock, {
    positive: true,
  });
  if (
    indexed === null ||
    indexed < validation.activationHeight
  ) {
    return {
      active: false,
      activationHeight: validation.activationHeight,
      declaration: validation.declaration,
      reasonCode: "work-amo-v6-activation-not-indexed",
    };
  }
  return {
    active: true,
    activationHeight: validation.activationHeight,
    canonical: true,
    confirmed: true,
    declaration: validation.declaration,
    evidenceComplete: true,
  };
}

export function workAmoV6StatusFromEvidence({
  evidence,
  expectedDeclaration,
  indexedThroughBlock,
  protocolWritesEnabled = false,
} = {}) {
  const activation = workAmoV6ActivationFromEvidence(evidence, {
    expectedDeclaration,
    indexedThroughBlock,
  });
  const ready = activation.active === true;
  const settlementWritesEnabled =
    ready && protocolWritesEnabled === true;
  const listingWritesEnabled = settlementWritesEnabled;
  return {
    activation,
    listingWritesEnabled,
    protocolWritesEnabled: settlementWritesEnabled,
    settlementWritesEnabled,
    reasonCode: listingWritesEnabled
      ? ""
      : activation.active !== true
        ? activation.reasonCode
        : "work-amo-v6-writes-paused",
    ready,
    version: WORK_AMO_V6_AUTH_VERSION,
  };
}

export function workAmoV6BroadcastDecision(
  actions,
  {
    legacyValidation = null,
    metadata = null,
    network = "livenet",
  } = {},
) {
  const candidates = Array.isArray(actions) ? actions : [];
  if (
    String(network).trim().toLowerCase() !== "livenet" ||
    candidates.length === 0
  ) {
    return { allowed: true };
  }
  if (metadata?.protocolWritesEnabled !== true) {
    return {
      allowed: false,
      code: "WORK_AMO_V6_WRITES_PAUSED",
      reasonCode:
        metadata?.reasonCode ?? "work-amo-v6-writes-paused",
      statusCode: 503,
    };
  }
  const activationHeight = canonicalSafeInteger(
    metadata?.activation?.activationHeight ??
      metadata?.activationHeight,
    { positive: true },
  );
  if (activationHeight === null) {
    return {
      allowed: false,
      code: "WORK_AMO_V6_EVIDENCE_NOT_READY",
      reasonCode: "work-amo-v6-evidence-not-ready",
      statusCode: 503,
    };
  }
  for (const action of candidates) {
    const actionName = String(action?.action ?? "").trim().toLowerCase();
    if (!["list5", "seal5", "buy5"].includes(actionName)) {
      return {
        allowed: false,
        code: "WORK_AMO_V6_TRANSACTION_INVALID",
        reasonCode: "work-amo-v6-action-invalid",
        statusCode: 400,
      };
    }
    if (
      action?.canonicalParsed !== true ||
      action?.paysWorkRegistry !== true ||
      normalizedLowerText(action?.tokenId) !== WORK_TOKEN_ID ||
      String(action?.ticker ?? "").trim().toUpperCase() !== "WORK" ||
      String(action?.registryAddress ?? "").trim() !==
        WORK_AMO_V5_DECLARATION_REGISTRY_ADDRESS ||
      action?.tokenProtocolMessageCount !== 1 ||
      action?.signedShapeValid !== true
    ) {
      return {
        allowed: false,
        code: "WORK_AMO_V6_TRANSACTION_INVALID",
        reasonCode: "work-amo-v6-transaction-shape-invalid",
        statusCode: 400,
      };
    }
    if (actionName === "list5") {
      if (metadata?.listingWritesEnabled !== true) {
        return {
          allowed: false,
          code: "WORK_AMO_V6_WRITES_PAUSED",
          reasonCode:
            metadata?.reasonCode ?? "work-amo-v6-writes-paused",
          statusCode: 503,
        };
      }
      if (
        action?.authVersion !== WORK_AMO_V6_AUTH_VERSION ||
        action?.saleAuthorization?.version !==
          WORK_AMO_V6_AUTH_VERSION
      ) {
        return {
          allowed: false,
          code: "WORK_AMO_V6_REQUIRED",
          reasonCode: "work-amo-v6-version-required",
          statusCode: 400,
        };
      }
      const staticValidation =
        validateWorkAmoV6StaticAuthorization(
          action.saleAuthorization,
        );
      if (!staticValidation.valid) {
        return {
          allowed: false,
          code: "WORK_AMO_V6_STATIC_AUTHORIZATION_INVALID",
          reasonCode: staticValidation.reasonCode,
          statusCode: 400,
        };
      }
      continue;
    }
    const settlementValidation =
      validateWorkAmoV6SealOrBuyTerms({
        actionAuthorization: action.saleAuthorization,
        actionFrozenTerms: action.actionFrozenTerms,
        actionPosition: action.actionPosition,
        activationHeight,
        legacyValidation,
        listingAuthorization: action.listingAuthorization,
        listingFrozenTerms: action.listingFrozenTerms,
        listingPosition: action.listingPosition,
        referencesListingFrozenTerms:
          action.referencesListingFrozenTerms === true,
      });
    if (!settlementValidation.valid) {
      return {
        allowed: false,
        code: "WORK_AMO_V6_FROZEN_TERMS_INVALID",
        reasonCode: settlementValidation.reasonCode,
        statusCode: 400,
      };
    }
  }
  return { allowed: true };
}
