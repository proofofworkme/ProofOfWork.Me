import {
  WORK_AMO_V4_AUTH_VERSION,
  WORK_AMO_V5_AUTH_VERSION,
  WORK_AMO_V5_DECLARATION_REGISTRY_ADDRESS,
  WORK_AMO_V5_MAX_SUPPLY,
  WORK_AMO_V5_NETWORK_VALUE_Q8_SCALE,
  compareWorkAmoCanonicalPositions,
  compareWorkAmoUtf8,
  normalizeWorkAmoCanonicalPosition,
  replayWorkAmoV5CanonicalBlock,
  validateWorkAmoV5FrozenTerms,
  validateWorkAmoV5StaticAuthorization,
  workAmoCanonicalPositionPrecedes,
  workAmoCeilDiv,
  workAmoFloorDiv,
  workAmoV5CanonicalHistoricalV4ListingWitness,
  workAmoV5CanonicalPayloadCommitment,
} from "./work-amo-v5.mjs";
import {
  WORK_AMO_V6_AUTH_VERSION,
  WORK_AMO_V6_MODELS,
  WORK_AMO_V6_STATIC_AUTHORIZATION_FIELDS,
  validateWorkAmoV6FrozenTerms,
  validateWorkAmoV6LegacyListingReference,
  validateWorkAmoV6SealOrBuyTerms,
  validateWorkAmoV6StaticAuthorization,
} from "./work-amo-v6.mjs";
import {
  WORK_LEGACY_ATOMIC_PROJECTION_MODEL,
  WORK_SUBATOM_CONVERSION_FACTOR,
  WORK_SUBATOM_DECIMALS,
  WORK_SUBATOM_PROJECTION_MODEL,
  WORK_SUBATOM_UNIT_SCALE,
  WORK_PRECISION_V2_MIGRATION_MODEL,
  WORK_PRECISION_V2_MODEL,
  WORK_TOKEN_ID,
  legacyWorkAtomsToSubatoms,
} from "./work-units.mjs";

export const WORK_AMO_V7_AUTH_VERSION = "pwt-sale-v7";
export const WORK_AMO_V7_PRECISION_MODEL =
  WORK_SUBATOM_PROJECTION_MODEL;
export const WORK_AMO_V7_GLOBAL_PRECISION_MODEL =
  WORK_PRECISION_V2_MODEL;
export const WORK_AMO_V7_PRECISION_MIGRATION_MODEL =
  WORK_PRECISION_V2_MIGRATION_MODEL;
export const WORK_AMO_V7_TRANSFER_VERSION = "send3";
export const WORK_AMO_V7_UNIT_MODEL =
  "canonical-work-amo-proof-unit-v2";
export const WORK_AMO_V7_STATE_ORDER_MODEL =
  "canonical-proof-state-order-v1";
export const WORK_AMO_V7_AMOUNT_MODEL =
  "canonical-work-amo-proof-unit-amount-v2";
export const WORK_AMO_V7_UNIT_WORK_ORACLE_MODEL =
  "canonical-work-prefix-before-action-v1";
export const WORK_AMO_V7_BOND_TRANSITION_MODEL =
  "canonical-compute-then-bond-v1";
export const WORK_AMO_V7_BLOCK_SEQUENCER_MODEL =
  "canonical-work-amo-full-position-block-sequencer-v3";
export const WORK_AMO_V7_DECLARATION_EVIDENCE_MODEL =
  "canonical-work-amo-v7-declaration-evidence-v1";
export const WORK_AMO_V7_TOKEN_STATE_PREIMAGE_MODEL =
  "canonical-work-token-state-subatoms-v2";
export const WORK_AMO_V7_DECIMALS = WORK_SUBATOM_DECIMALS;
export const WORK_AMO_V7_SUBATOMS_PER_WORK =
  WORK_SUBATOM_UNIT_SCALE;
export const WORK_AMO_V7_LEGACY_ATOM_TO_SUBATOM_SCALE =
  WORK_SUBATOM_CONVERSION_FACTOR;
export const WORK_AMO_V7_MAX_SUPPLY_SUBATOMS =
  WORK_AMO_V5_MAX_SUPPLY * WORK_AMO_V7_SUBATOMS_PER_WORK;
export const WORK_AMO_V7_MINT_AMOUNT_SUBATOMS =
  1_000n * WORK_AMO_V7_SUBATOMS_PER_WORK;
export const WORK_AMO_V7_ALLOWED_FACE_PROOFS = Object.freeze([
  20_000,
  50_000,
  100_000,
]);
export const WORK_AMO_V7_LEGACY_AUTH_VERSIONS = Object.freeze([
  WORK_AMO_V4_AUTH_VERSION,
  WORK_AMO_V5_AUTH_VERSION,
  WORK_AMO_V6_AUTH_VERSION,
]);
export const WORK_AMO_V7_MODELS = Object.freeze({
  amountModel: WORK_AMO_V7_AMOUNT_MODEL,
  bondTransitionModel: WORK_AMO_V7_BOND_TRANSITION_MODEL,
  stateOrderModel: WORK_AMO_V7_STATE_ORDER_MODEL,
  unitModel: WORK_AMO_V7_UNIT_MODEL,
  unitWorkOracleModel: WORK_AMO_V7_UNIT_WORK_ORACLE_MODEL,
});
export const WORK_AMO_V7_STATIC_AUTHORIZATION_FIELDS = Object.freeze([
  ...WORK_AMO_V6_STATIC_AUTHORIZATION_FIELDS,
]);
export const WORK_AMO_V7_FROZEN_TERM_FIELDS = Object.freeze([
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
  "unitAmountSubatoms",
  "unitPriceSats",
  "unitMinimumPriceSats",
  "listingBondContributionQ8",
  "listingNetworkValueAfterQ8",
]);

const TXID_PATTERN = /^[0-9a-f]{64}$/u;
const HASH_PATTERN = /^[0-9a-f]{64}$/u;
const HEX_PATTERN = /^(?:[0-9a-f]{2})+$/u;
const UNSIGNED_INTEGER_PATTERN = /^(?:0|[1-9][0-9]*)$/u;
const V7_STATIC_AUTHORIZATION_FIELD_SET = new Set(
  WORK_AMO_V7_STATIC_AUTHORIZATION_FIELDS,
);
const V7_FROZEN_TERM_FIELD_SET = new Set(
  WORK_AMO_V7_FROZEN_TERM_FIELDS,
);
const V7_DERIVED_AUTHORIZATION_FIELDS = Object.freeze([
  "amount",
  "amountAtoms",
  "amountSubatoms",
  "minimumPriceSats",
  "priceSats",
  "unitAmountAtoms",
  "unitAmountSubatoms",
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
  if (typeof value !== "string" && typeof value !== "bigint") {
    return "";
  }
  if (typeof value === "string" && value !== value.trim()) {
    return "";
  }
  const text = String(value);
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
  return Object.entries(WORK_AMO_V7_MODELS).every(
    ([field, expected]) => authorization?.[field] === expected,
  );
}

function v7ReasonCode(value) {
  return String(value ?? "")
    .replaceAll("work-amo-v6", "work-amo-v7")
    .replaceAll("WORK_AMO_V6", "WORK_AMO_V7");
}

function asV7Invalid(validation) {
  return invalid(v7ReasonCode(validation?.reasonCode), {
    ...(validation?.legacyReasonCode
      ? { legacyReasonCode: validation.legacyReasonCode }
      : {}),
  });
}

function v6AuthorizationFromV7(authorization) {
  return {
    ...authorization,
    ...WORK_AMO_V6_MODELS,
    version: WORK_AMO_V6_AUTH_VERSION,
  };
}

function v7AuthorizationFromV6(authorization) {
  return {
    ...authorization,
    ...WORK_AMO_V7_MODELS,
    version: WORK_AMO_V7_AUTH_VERSION,
  };
}

export function validateWorkAmoV7StaticAuthorization(
  authorization,
) {
  if (
    !authorization ||
    typeof authorization !== "object" ||
    Array.isArray(authorization) ||
    Object.getPrototypeOf(authorization) !== Object.prototype
  ) {
    return invalid("work-amo-v7-authorization-invalid");
  }
  if (authorization.version !== WORK_AMO_V7_AUTH_VERSION) {
    return invalid("work-amo-v7-version-required");
  }
  if (!authorizationModelsValid(authorization)) {
    return invalid("work-amo-v7-models-invalid");
  }
  if (
    V7_DERIVED_AUTHORIZATION_FIELDS.some(
      (field) =>
        authorization[field] !== undefined &&
        authorization[field] !== null &&
        authorization[field] !== "",
    )
  ) {
    return invalid("work-amo-v7-derived-fields-not-signable");
  }
  if (
    Object.keys(authorization).some(
      (field) => !V7_STATIC_AUTHORIZATION_FIELD_SET.has(field),
    )
  ) {
    return invalid("work-amo-v7-authorization-shape-invalid");
  }
  const v6Validation = validateWorkAmoV6StaticAuthorization(
    v6AuthorizationFromV7(authorization),
  );
  if (!v6Validation.valid) {
    return asV7Invalid(v6Validation);
  }
  if (
    !WORK_AMO_V7_ALLOWED_FACE_PROOFS.includes(
      v6Validation.authorization.unitFaceProofs,
    )
  ) {
    return invalid("work-amo-v7-face-unit-invalid");
  }
  return {
    authorization: v7AuthorizationFromV6(
      v6Validation.authorization,
    ),
    valid: true,
  };
}

export function workAmoV7UnitTerms({
  networkValueBeforeQ8,
  unitFaceProofs,
} = {}) {
  const face = canonicalSafeInteger(unitFaceProofs, {
    positive: true,
  });
  const networkValue = positiveBigInt(networkValueBeforeQ8);
  if (!WORK_AMO_V7_ALLOWED_FACE_PROOFS.includes(face)) {
    return invalid("work-amo-v7-face-unit-invalid");
  }
  if (networkValue === null) {
    return invalid("work-amo-v7-network-value-before-invalid");
  }
  const denominator =
    WORK_AMO_V5_MAX_SUPPLY *
    WORK_AMO_V7_SUBATOMS_PER_WORK *
    WORK_AMO_V5_NETWORK_VALUE_Q8_SCALE;
  const unitPriceSats = BigInt(face);
  const unitAmountSubatoms = workAmoFloorDiv(
    unitPriceSats * denominator,
    networkValue,
  );
  const unitMinimumPriceSats = workAmoCeilDiv(
    unitAmountSubatoms * networkValue,
    denominator,
  );
  if (
    unitPriceSats <= 0n ||
    unitAmountSubatoms <= 0n ||
    unitMinimumPriceSats <= 0n
  ) {
    return invalid("work-amo-v7-unit-result-nonpositive");
  }
  if (unitAmountSubatoms > WORK_AMO_V7_MAX_SUPPLY_SUBATOMS) {
    return invalid("work-amo-v7-unit-amount-exceeds-supply");
  }
  if (unitPriceSats < unitMinimumPriceSats) {
    return invalid("work-amo-v7-unit-price-below-minimum");
  }
  return {
    unitAmountSubatoms: unitAmountSubatoms.toString(),
    unitMinimumPriceSats: unitMinimumPriceSats.toString(),
    unitPriceSats: unitPriceSats.toString(),
    valid: true,
  };
}

export const calculateWorkAmoV7UnitTerms = workAmoV7UnitTerms;

export function validateWorkAmoV7ListingCutover({
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
    return invalid("work-amo-v7-listing-cutover-unavailable");
  }
  if (listing.blockHeight < activation) {
    return version === WORK_AMO_V7_AUTH_VERSION
      ? invalid("work-amo-v7-listing-before-activation")
      : {
          historical: true,
          listingPosition: listing,
          valid: WORK_AMO_V7_LEGACY_AUTH_VERSIONS.includes(version),
          ...(!WORK_AMO_V7_LEGACY_AUTH_VERSIONS.includes(version)
            ? {
                reasonCode:
                  "work-amo-v7-historical-listing-version-invalid",
              }
            : {}),
        };
  }
  if (version !== WORK_AMO_V7_AUTH_VERSION) {
    return invalid("work-amo-v7-version-required");
  }
  return {
    historical: false,
    listingPosition: listing,
    valid: true,
  };
}

export function deriveWorkAmoV7FrozenTerms(
  authorization,
  {
    activationHeight,
    listingBondContributionQ8,
    listingPosition,
    networkValueBeforeQ8,
    spendableAmountSubatoms,
  } = {},
) {
  const listing = normalizeWorkAmoCanonicalPosition(listingPosition);
  if (!listing) {
    return invalid("work-amo-v7-listing-position-unavailable");
  }
  const cutover = validateWorkAmoV7ListingCutover({
    activationHeight,
    authorizationVersion: authorization?.version,
    listingPosition: listing,
  });
  if (!cutover.valid || cutover.historical === true) {
    return cutover.valid
      ? invalid("work-amo-v7-listing-before-activation")
      : cutover;
  }
  const staticValidation = validateWorkAmoV7StaticAuthorization(
    authorization,
  );
  if (!staticValidation.valid) {
    return staticValidation;
  }
  const networkValue = positiveBigInt(networkValueBeforeQ8);
  if (networkValue === null) {
    return invalid("work-amo-v7-network-value-before-invalid");
  }
  const bondContribution = positiveBigInt(
    listingBondContributionQ8,
  );
  if (bondContribution === null) {
    return invalid(
      "work-amo-v7-listing-bond-contribution-invalid",
    );
  }
  const unit = workAmoV7UnitTerms({
    networkValueBeforeQ8: networkValue.toString(),
    unitFaceProofs:
      staticValidation.authorization.unitFaceProofs,
  });
  if (!unit.valid) {
    return unit;
  }
  const spendable = nonNegativeBigInt(spendableAmountSubatoms);
  if (spendable === null) {
    return invalid("work-amo-v7-spendable-balance-unavailable");
  }
  if (spendable < BigInt(unit.unitAmountSubatoms)) {
    return invalid("work-amo-v7-insufficient-spendable-balance", {
      requiredAmountSubatoms: unit.unitAmountSubatoms,
      spendableAmountSubatoms: spendable.toString(),
    });
  }
  const networkAfter = networkValue + bondContribution;
  return {
    frozenTerms: {
      ...WORK_AMO_V7_MODELS,
      listingBlockHash: listing.blockHash,
      listingBlockHeight: listing.blockHeight,
      listingBlockIndex: listing.blockTransactionIndex,
      listingBondContributionQ8: bondContribution.toString(),
      listingNetworkValueAfterQ8: networkAfter.toString(),
      listingNetworkValueBeforeQ8: networkValue.toString(),
      listingProtocolVout: listing.protocolVout,
      listingRecordOrdinal: listing.recordOrdinal,
      unitAmountSubatoms: unit.unitAmountSubatoms,
      unitFaceProofs:
        staticValidation.authorization.unitFaceProofs,
      unitMinimumPriceSats: unit.unitMinimumPriceSats,
      unitPriceSats: unit.unitPriceSats,
      version: WORK_AMO_V7_AUTH_VERSION,
    },
    valid: true,
  };
}

function normalizeWorkAmoV7FrozenTerms(value) {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    Object.getPrototypeOf(value) !== Object.prototype ||
    Object.keys(value).some(
      (field) => !V7_FROZEN_TERM_FIELD_SET.has(field),
    ) ||
    value.version !== WORK_AMO_V7_AUTH_VERSION ||
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
  const amount = positiveBigInt(value.unitAmountSubatoms);
  const price = positiveBigInt(value.unitPriceSats);
  const minimum = positiveBigInt(value.unitMinimumPriceSats);
  if (
    !WORK_AMO_V7_ALLOWED_FACE_PROOFS.includes(unitFaceProofs) ||
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
  const unit = workAmoV7UnitTerms({
    networkValueBeforeQ8: networkBefore.toString(),
    unitFaceProofs,
  });
  if (
    !unit.valid ||
    unit.unitAmountSubatoms !== amount.toString() ||
    unit.unitPriceSats !== price.toString() ||
    unit.unitMinimumPriceSats !== minimum.toString()
  ) {
    return null;
  }
  return {
    ...WORK_AMO_V7_MODELS,
    listingBlockHash: listingPosition.blockHash,
    listingBlockHeight: listingPosition.blockHeight,
    listingBlockIndex: listingPosition.blockTransactionIndex,
    listingBondContributionQ8: bond.toString(),
    listingNetworkValueAfterQ8: networkAfter.toString(),
    listingNetworkValueBeforeQ8: networkBefore.toString(),
    listingProtocolVout: listingPosition.protocolVout,
    listingRecordOrdinal: listingPosition.recordOrdinal,
    unitAmountSubatoms: amount.toString(),
    unitFaceProofs,
    unitMinimumPriceSats: minimum.toString(),
    unitPriceSats: price.toString(),
    version: WORK_AMO_V7_AUTH_VERSION,
  };
}

export function validateWorkAmoV7FrozenTerms(
  frozenTerms,
  {
    authorization = null,
    listingBondContributionQ8,
    listingPosition = null,
    networkValueBeforeQ8,
  } = {},
) {
  const normalized = normalizeWorkAmoV7FrozenTerms(frozenTerms);
  if (!normalized) {
    return invalid("work-amo-v7-frozen-terms-invalid");
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
      "work-amo-v7-frozen-listing-position-mismatch",
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
    return invalid("work-amo-v7-frozen-network-value-mismatch");
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
      "work-amo-v7-frozen-bond-contribution-mismatch",
    );
  }
  if (authorization) {
    if (
      authorization.version !== WORK_AMO_V7_AUTH_VERSION ||
      !authorizationModelsValid(authorization) ||
      canonicalSafeInteger(authorization.unitFaceProofs, {
        positive: true,
      }) !== normalized.unitFaceProofs
    ) {
      return invalid(
        "work-amo-v7-frozen-authorization-mismatch",
      );
    }
  }
  return { frozenTerms: normalized, valid: true };
}

export function workAmoV7FrozenTermsMatch(left, right) {
  const normalizedLeft = normalizeWorkAmoV7FrozenTerms(left);
  const normalizedRight = normalizeWorkAmoV7FrozenTerms(right);
  return Boolean(
    normalizedLeft &&
      normalizedRight &&
      WORK_AMO_V7_FROZEN_TERM_FIELDS.every(
        (field) => normalizedLeft[field] === normalizedRight[field],
      ),
  );
}

export function validateWorkAmoV7LegacyListingReference(
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
    !WORK_AMO_V7_LEGACY_AUTH_VERSIONS.includes(version)
  ) {
    return invalid("work-amo-v7-legacy-reference-invalid");
  }
  if (version === WORK_AMO_V6_AUTH_VERSION) {
    const validation = validateWorkAmoV6FrozenTerms(
      listingFrozenTerms,
      {
        authorization: listingAuthorization,
        listingPosition: position,
      },
    );
    if (!validation.valid) {
      return invalid(
        "work-amo-v7-legacy-v6-frozen-terms-invalid",
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
  const validation = validateWorkAmoV6LegacyListingReference({
    actionAuthorization,
    activationHeight,
    legacyValidation,
    listingAuthorization,
    listingFrozenTerms,
    listingPosition: position,
  });
  return validation.valid
    ? validation
    : invalid("work-amo-v7-legacy-reference-invalid", {
        legacyReasonCode: validation.reasonCode,
      });
}

/**
 * Settlements validate only the listing's already-frozen canonical terms.
 * They never select or compare a current network-value estimate.
 */
export function validateWorkAmoV7SealOrBuyTerms({
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
  if (listingVersion === WORK_AMO_V7_AUTH_VERSION) {
    listingValidation = validateWorkAmoV7FrozenTerms(
      listingFrozenTerms,
      {
        authorization: listingAuthorization,
        listingPosition,
      },
    );
  } else {
    listingValidation =
      validateWorkAmoV7LegacyListingReference({
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
    return invalid("work-amo-v7-action-not-after-listing");
  }
  if (referencesListingFrozenTerms === true && !actionFrozenTerms) {
    return {
      frozenTerms: listingValidation.frozenTerms,
      listingAuthorizationVersion: listingVersion,
      referenced: true,
      valid: true,
    };
  }
  if (listingVersion === WORK_AMO_V7_AUTH_VERSION) {
    if (
      !actionFrozenTerms ||
      !workAmoV7FrozenTermsMatch(
        listingValidation.frozenTerms,
        actionFrozenTerms,
      )
    ) {
      return invalid(
        "work-amo-v7-action-frozen-terms-mismatch",
      );
    }
    return {
      frozenTerms: listingValidation.frozenTerms,
      listingAuthorizationVersion: listingVersion,
      referenced: false,
      valid: true,
    };
  }
  const legacySettlement = validateWorkAmoV6SealOrBuyTerms({
    actionAuthorization,
    actionFrozenTerms,
    actionPosition,
    activationHeight,
    legacyValidation,
    listingAuthorization,
    listingFrozenTerms,
    listingPosition,
    referencesListingFrozenTerms,
  });
  return legacySettlement.valid
    ? legacySettlement
    : invalid("work-amo-v7-action-frozen-terms-mismatch", {
        legacyReasonCode: legacySettlement.reasonCode,
      });
}

function canonicalWorkAmoV7TokenStateListing({
  authorization,
  frozenTerms,
  sellerAddress,
} = {}) {
  const version = String(authorization?.version ?? "").trim();
  if (version === WORK_AMO_V7_AUTH_VERSION) {
    const staticValidation =
      validateWorkAmoV7StaticAuthorization(authorization);
    const frozenValidation = validateWorkAmoV7FrozenTerms(
      frozenTerms,
      {
        authorization: staticValidation.valid
          ? staticValidation.authorization
          : null,
      },
    );
    if (
      !staticValidation.valid ||
      !frozenValidation.valid ||
      staticValidation.authorization.sellerAddress !== sellerAddress
    ) {
      return null;
    }
    return {
      amountSubatoms:
        frozenValidation.frozenTerms.unitAmountSubatoms,
      frozenTerms: frozenValidation.frozenTerms,
      priceSats: frozenValidation.frozenTerms.unitPriceSats,
      saleAuthorization: staticValidation.authorization,
    };
  }
  if (version === WORK_AMO_V6_AUTH_VERSION) {
    const staticValidation =
      validateWorkAmoV6StaticAuthorization(authorization);
    const frozenValidation = validateWorkAmoV6FrozenTerms(
      frozenTerms,
      {
        authorization: staticValidation.valid
          ? staticValidation.authorization
          : null,
      },
    );
    if (
      !staticValidation.valid ||
      !frozenValidation.valid ||
      staticValidation.authorization.sellerAddress !== sellerAddress
    ) {
      return null;
    }
    return {
      amountSubatoms: legacyWorkAtomsToSubatoms(
        frozenValidation.frozenTerms.unitAmountAtoms,
      ),
      frozenTerms: frozenValidation.frozenTerms,
      priceSats: frozenValidation.frozenTerms.unitPriceSats,
      saleAuthorization: staticValidation.authorization,
    };
  }
  if (version === WORK_AMO_V5_AUTH_VERSION) {
    const staticValidation =
      validateWorkAmoV5StaticAuthorization(authorization);
    const frozenValidation = validateWorkAmoV5FrozenTerms(
      frozenTerms,
      {
        authorization: staticValidation.valid
          ? staticValidation.authorization
          : null,
      },
    );
    if (
      !staticValidation.valid ||
      !frozenValidation.valid ||
      staticValidation.authorization.sellerAddress !== sellerAddress
    ) {
      return null;
    }
    return {
      amountSubatoms: legacyWorkAtomsToSubatoms(
        frozenValidation.frozenTerms.unitAmountAtoms,
      ),
      frozenTerms: frozenValidation.frozenTerms,
      priceSats: frozenValidation.frozenTerms.unitPriceSats,
      saleAuthorization: staticValidation.authorization,
    };
  }
  if (version === WORK_AMO_V4_AUTH_VERSION) {
    const witness = workAmoV5CanonicalHistoricalV4ListingWitness(
      authorization,
      frozenTerms,
    );
    if (
      !witness ||
      witness.saleAuthorization.sellerAddress !== sellerAddress
    ) {
      return null;
    }
    return {
      amountSubatoms: legacyWorkAtomsToSubatoms(
        witness.frozenTerms.unitAmountAtoms,
      ),
      frozenTerms: witness.frozenTerms,
      priceSats: witness.frozenTerms.unitPriceSats,
      saleAuthorization: witness.saleAuthorization,
    };
  }
  return null;
}

export function workAmoV7CanonicalTokenStatePreimage(tokenState) {
  const confirmedSupplySubatoms = canonicalUnsignedIntegerText(
    tokenState?.confirmedSupplySubatoms,
  );
  if (
    !confirmedSupplySubatoms ||
    BigInt(confirmedSupplySubatoms) >
      WORK_AMO_V7_MAX_SUPPLY_SUBATOMS
  ) {
    throw new TypeError("work-amo-v7-token-state-supply-invalid");
  }
  const holders = [];
  const holderAddresses = new Set();
  for (const holder of Array.isArray(tokenState?.holders)
    ? tokenState.holders
    : []) {
    const address = String(holder?.address ?? "").trim();
    const balanceSubatoms = canonicalUnsignedIntegerText(
      holder?.balanceSubatoms,
      { positive: true },
    );
    if (
      !address ||
      address.length > 128 ||
      !balanceSubatoms ||
      BigInt(balanceSubatoms) >
        WORK_AMO_V7_MAX_SUPPLY_SUBATOMS ||
      holderAddresses.has(address)
    ) {
      throw new TypeError("work-amo-v7-token-state-holder-invalid");
    }
    holderAddresses.add(address);
    holders.push({ address, balanceSubatoms });
  }
  holders.sort((left, right) =>
    compareWorkAmoUtf8(left.address, right.address),
  );

  const listings = [];
  const listingIds = new Set();
  for (const listing of Array.isArray(tokenState?.listings)
    ? tokenState.listings
    : []) {
    const listingId = normalizedTxid(
      listing?.listingId ?? listing?.txid,
    );
    const sellerAddress = String(
      listing?.sellerAddress ?? "",
    ).trim();
    const amountSubatoms = canonicalUnsignedIntegerText(
      listing?.amountSubatoms,
      { positive: true },
    );
    const priceSats = canonicalUnsignedIntegerText(
      listing?.priceSats,
      { positive: true },
    );
    const authorization =
      listing?.saleAuthorization &&
      typeof listing.saleAuthorization === "object" &&
      !Array.isArray(listing.saleAuthorization)
        ? listing.saleAuthorization
        : null;
    const frozenTerms =
      listing?.frozenTerms &&
      typeof listing.frozenTerms === "object" &&
      !Array.isArray(listing.frozenTerms)
        ? listing.frozenTerms
        : null;
    const witness = canonicalWorkAmoV7TokenStateListing({
      authorization,
      frozenTerms,
      sellerAddress,
    });
    const listingAuthorizationPresent =
      listing?.listingAuthorization !== undefined &&
      listing?.listingAuthorization !== null;
    const listingAuthorization =
      listingAuthorizationPresent &&
      typeof listing.listingAuthorization === "object" &&
      !Array.isArray(listing.listingAuthorization)
        ? listing.listingAuthorization
        : null;
    if (
      !listingId ||
      !sellerAddress ||
      sellerAddress.length > 128 ||
      !amountSubatoms ||
      BigInt(amountSubatoms) >
        WORK_AMO_V7_MAX_SUPPLY_SUBATOMS ||
      !priceSats ||
      !witness ||
      witness.amountSubatoms !== amountSubatoms ||
      witness.priceSats !== priceSats ||
      (
        listingAuthorizationPresent &&
        (
          !listingAuthorization ||
          String(listingAuthorization.version ?? "").trim() !==
            String(authorization?.version ?? "").trim() ||
          workAmoV5CanonicalPayloadCommitment(
            listingAuthorization,
          ).sha256 !==
            workAmoV5CanonicalPayloadCommitment(
              authorization,
            ).sha256
        )
      ) ||
      listingIds.has(listingId)
    ) {
      throw new TypeError("work-amo-v7-token-state-listing-invalid");
    }
    listingIds.add(listingId);
    listings.push({
      amountSubatoms,
      frozenTerms: witness.frozenTerms,
      listingId,
      priceSats,
      saleAuthorization: witness.saleAuthorization,
      sellerAddress,
    });
  }
  listings.sort((left, right) =>
    compareWorkAmoUtf8(left.listingId, right.listingId),
  );

  const holderTotal = holders.reduce(
    (total, holder) =>
      total + BigInt(holder.balanceSubatoms),
    0n,
  );
  const reservedSubatoms = listings.reduce(
    (total, listing) =>
      total + BigInt(listing.amountSubatoms),
    0n,
  );
  const holderBalanceByAddress = new Map(
    holders.map((holder) => [
      holder.address,
      BigInt(holder.balanceSubatoms),
    ]),
  );
  const reservedBySeller = new Map();
  for (const listing of listings) {
    reservedBySeller.set(
      listing.sellerAddress,
      (reservedBySeller.get(listing.sellerAddress) ?? 0n) +
        BigInt(listing.amountSubatoms),
    );
  }
  if (
    holderTotal !== BigInt(confirmedSupplySubatoms) ||
    reservedSubatoms > holderTotal ||
    [...reservedBySeller].some(
      ([sellerAddress, reserved]) =>
        !holderBalanceByAddress.has(sellerAddress) ||
        reserved > holderBalanceByAddress.get(sellerAddress),
    )
  ) {
    throw new TypeError(
      "work-amo-v7-token-state-balance-parity-invalid",
    );
  }
  return {
    confirmedSupplySubatoms,
    definition: {
      amountStorageModel: WORK_AMO_V7_PRECISION_MODEL,
      decimals: WORK_AMO_V7_DECIMALS,
      maxSupplySubatoms:
        WORK_AMO_V7_MAX_SUPPLY_SUBATOMS.toString(),
      mintAmountSubatoms:
        WORK_AMO_V7_MINT_AMOUNT_SUBATOMS.toString(),
      precisionModel: WORK_AMO_V7_GLOBAL_PRECISION_MODEL,
      registryAddress:
        WORK_AMO_V5_DECLARATION_REGISTRY_ADDRESS,
      ticker: "WORK",
      tokenId: WORK_TOKEN_ID,
      unitScale: WORK_AMO_V7_SUBATOMS_PER_WORK.toString(),
    },
    holders,
    listings,
    model: WORK_AMO_V7_TOKEN_STATE_PREIMAGE_MODEL,
    reservedSubatoms: reservedSubatoms.toString(),
  };
}

export function workAmoV7CanonicalTokenStateCommitment(tokenState) {
  return workAmoV5CanonicalPayloadCommitment(
    workAmoV7CanonicalTokenStatePreimage(tokenState),
  );
}

export function replayWorkAmoV7CanonicalBlock({
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
      "work-amo-v7-sequencer-before-activation",
    );
    error.code = "work-amo-v7-sequencer-before-activation";
    throw error;
  }
  const replay = replayWorkAmoV5CanonicalBlock(options);
  return {
    ...replay,
    activationHeight: activation,
    model: WORK_AMO_V7_BLOCK_SEQUENCER_MODEL,
  };
}

export const compareWorkAmoV7CanonicalPositions =
  compareWorkAmoCanonicalPositions;
export const workAmoV7CanonicalPositionPrecedes =
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

export function validateWorkAmoV7DeclarationEvidence(
  evidence,
  { expectedDeclaration } = {},
) {
  const expected = normalizeExpectedDeclaration(expectedDeclaration);
  if (!expected) {
    return invalid(
      "work-amo-v7-declaration-commitment-unconfigured",
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
    return invalid("work-amo-v7-declaration-evidence-mismatch");
  }
  return {
    activationHeight: expected.activationHeight,
    declaration: expected,
    model: WORK_AMO_V7_DECLARATION_EVIDENCE_MODEL,
    valid: true,
  };
}

export function workAmoV7ActivationFromEvidence(
  evidence,
  {
    expectedDeclaration,
    indexedThroughBlock,
  } = {},
) {
  const validation = validateWorkAmoV7DeclarationEvidence(evidence, {
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
      reasonCode: "work-amo-v7-activation-not-indexed",
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

export function workAmoV7TransferEraDecision({
  activationHeight,
  blockHeight,
  confirmed,
  projectionModel,
  transferVersion,
} = {}) {
  const activation = canonicalSafeInteger(activationHeight, {
    positive: true,
  });
  const version = String(transferVersion ?? "")
    .trim()
    .toLowerCase();
  if (
    activation === null ||
    !["send", "send2", WORK_AMO_V7_TRANSFER_VERSION].includes(
      version,
    )
  ) {
    return invalid("work-amo-v7-transfer-era-input-invalid");
  }
  let v7Required;
  if (confirmed === true) {
    const height = canonicalSafeInteger(blockHeight, {
      positive: true,
    });
    if (height === null) {
      return invalid(
        "work-amo-v7-transfer-confirmed-height-invalid",
      );
    }
    v7Required = height >= activation;
  } else {
    if (
      projectionModel !== WORK_SUBATOM_PROJECTION_MODEL &&
      projectionModel !== WORK_LEGACY_ATOMIC_PROJECTION_MODEL
    ) {
      return invalid(
        "work-amo-v7-transfer-projection-model-invalid",
      );
    }
    v7Required =
      projectionModel === WORK_SUBATOM_PROJECTION_MODEL;
  }
  const nativeV7 =
    version === WORK_AMO_V7_TRANSFER_VERSION;
  if (nativeV7 !== v7Required) {
    return invalid(
      v7Required
        ? "work-amo-v7-send3-required"
        : "work-amo-v7-send3-before-activation",
    );
  }
  return {
    convertLegacyAtoms:
      !nativeV7 &&
      projectionModel === WORK_SUBATOM_PROJECTION_MODEL,
    nativeV7,
    valid: true,
  };
}

export function workAmoV7StatusFromEvidence({
  evidence,
  expectedDeclaration,
  indexedThroughBlock,
  precisionMigrationReady = false,
  protocolWritesEnabled = false,
} = {}) {
  const activationResult = workAmoV7ActivationFromEvidence(evidence, {
    expectedDeclaration,
    indexedThroughBlock,
  });
  const expected = normalizeExpectedDeclaration(expectedDeclaration);
  const indexed = canonicalSafeInteger(indexedThroughBlock, {
    positive: true,
  });
  const activation = {
    ...activationResult,
    reached: Boolean(
      expected &&
        indexed !== null &&
        indexed >= expected.activationHeight,
    ),
  };
  const declarationReady = activation.active === true;
  const evidenceComplete =
    activation.evidenceComplete === true;
  const ready =
    declarationReady &&
    evidenceComplete &&
    precisionMigrationReady === true;
  const settlementWritesEnabled =
    ready && protocolWritesEnabled === true;
  const listingWritesEnabled = settlementWritesEnabled;
  return {
    activation,
    declarationReady,
    evidenceComplete,
    listingWritesEnabled,
    precisionMigrationReady: precisionMigrationReady === true,
    protocolReady: ready,
    protocolWritesEnabled: settlementWritesEnabled,
    settlementWritesEnabled,
    writeAdmission: settlementWritesEnabled,
    reasonCode: listingWritesEnabled
      ? ""
      : activation.active !== true
        ? activation.reasonCode
        : precisionMigrationReady !== true
          ? "work-amo-v7-precision-migration-not-ready"
          : "work-amo-v7-writes-paused",
    ready,
    version: WORK_AMO_V7_AUTH_VERSION,
  };
}

export function workAmoV7BroadcastDecision(
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
      code: "WORK_AMO_V7_WRITES_PAUSED",
      reasonCode:
        metadata?.reasonCode ?? "work-amo-v7-writes-paused",
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
      code: "WORK_AMO_V7_EVIDENCE_NOT_READY",
      reasonCode: "work-amo-v7-evidence-not-ready",
      statusCode: 503,
    };
  }
  for (const action of candidates) {
    const actionName = String(action?.action ?? "").trim().toLowerCase();
    if (!["list5", "seal5", "buy5"].includes(actionName)) {
      return {
        allowed: false,
        code: "WORK_AMO_V7_TRANSACTION_INVALID",
        reasonCode: "work-amo-v7-action-invalid",
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
        code: "WORK_AMO_V7_TRANSACTION_INVALID",
        reasonCode: "work-amo-v7-transaction-shape-invalid",
        statusCode: 400,
      };
    }
    if (actionName === "list5") {
      if (metadata?.listingWritesEnabled !== true) {
        return {
          allowed: false,
          code: "WORK_AMO_V7_WRITES_PAUSED",
          reasonCode:
            metadata?.reasonCode ?? "work-amo-v7-writes-paused",
          statusCode: 503,
        };
      }
      if (
        action?.authVersion !== WORK_AMO_V7_AUTH_VERSION ||
        action?.saleAuthorization?.version !==
          WORK_AMO_V7_AUTH_VERSION
      ) {
        return {
          allowed: false,
          code: "WORK_AMO_V7_REQUIRED",
          reasonCode: "work-amo-v7-version-required",
          statusCode: 400,
        };
      }
      const staticValidation =
        validateWorkAmoV7StaticAuthorization(
          action.saleAuthorization,
        );
      if (!staticValidation.valid) {
        return {
          allowed: false,
          code: "WORK_AMO_V7_STATIC_AUTHORIZATION_INVALID",
          reasonCode: staticValidation.reasonCode,
          statusCode: 400,
        };
      }
      continue;
    }
    const settlementValidation =
      validateWorkAmoV7SealOrBuyTerms({
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
        code: "WORK_AMO_V7_FROZEN_TERMS_INVALID",
        reasonCode: settlementValidation.reasonCode,
        statusCode: 400,
      };
    }
  }
  return { allowed: true };
}
