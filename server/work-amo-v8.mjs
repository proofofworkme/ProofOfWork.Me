import {
  WORK_AMO_V4_AUTH_VERSION,
  WORK_AMO_V5_AUTH_VERSION,
  WORK_AMO_V5_DECLARATION_REGISTRY_ADDRESS,
  WORK_AMO_V5_MAX_SUPPLY,
  WORK_AMO_V5_NETWORK_ACCUMULATOR_MODEL,
  WORK_AMO_V5_NETWORK_VALUE_Q8_SCALE,
  WORK_AMO_V5_PAYLOAD_COMMITMENT_MODEL,
  WORK_AMO_V5_STATE_COMMITMENT_MODEL,
  compareWorkAmoCanonicalPositions,
  compareWorkAmoUtf8,
  normalizeWorkAmoCanonicalPosition,
  replayWorkAmoV5CanonicalBlock,
  validateWorkAmoV5FrozenTerms,
  validateWorkAmoV5SufficientState,
  validateWorkAmoV5StaticAuthorization,
  workAmoCanonicalPositionPrecedes,
  workAmoCeilDiv,
  workAmoFloorDiv,
  workAmoV5CanonicalHistoricalV4ListingWitness,
  workAmoV5CanonicalPayloadCommitment,
  workAmoV5CanonicalStateCommitment,
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

export const WORK_AMO_V8_AUTH_VERSION = "pwt-sale-v8";
export const WORK_AMO_V8_PRECISION_MODEL =
  WORK_SUBATOM_PROJECTION_MODEL;
export const WORK_AMO_V8_GLOBAL_PRECISION_MODEL =
  WORK_PRECISION_V2_MODEL;
export const WORK_AMO_V8_PRECISION_MIGRATION_MODEL =
  WORK_PRECISION_V2_MIGRATION_MODEL;
export const WORK_AMO_V8_TRANSFER_VERSION = "send3";
export const WORK_AMO_V8_UNIT_MODEL =
  "canonical-work-amo-proof-unit-v3";
export const WORK_AMO_V8_STATE_ORDER_MODEL =
  "canonical-proof-state-order-v1";
export const WORK_AMO_V8_AMOUNT_MODEL =
  "canonical-work-amo-proof-unit-amount-v3";
export const WORK_AMO_V8_UNIT_WORK_ORACLE_MODEL =
  "canonical-work-prefix-before-action-v1";
export const WORK_AMO_V8_BOND_TRANSITION_MODEL =
  "canonical-compute-then-bond-v1";
export const WORK_AMO_V8_BLOCK_SEQUENCER_MODEL =
  "canonical-work-amo-full-position-block-sequencer-v4";
export const WORK_AMO_V8_DECLARATION_EVIDENCE_MODEL =
  "canonical-work-amo-v8-declaration-evidence-v1";
export const WORK_AMO_V8_TOKEN_STATE_PREIMAGE_MODEL =
  "canonical-work-token-state-subatoms-v3";
export const WORK_AMO_V8_RELIC_CUTOVER_MODEL =
  "canonical-work-amo-v8-preactivation-relic-cutover-v1";
export const WORK_AMO_V8_DECIMALS = WORK_SUBATOM_DECIMALS;
export const WORK_AMO_V8_SUBATOMS_PER_WORK =
  WORK_SUBATOM_UNIT_SCALE;
export const WORK_AMO_V8_LEGACY_ATOM_TO_SUBATOM_SCALE =
  WORK_SUBATOM_CONVERSION_FACTOR;
export const WORK_AMO_V8_MAX_SUPPLY_SUBATOMS =
  WORK_AMO_V5_MAX_SUPPLY * WORK_AMO_V8_SUBATOMS_PER_WORK;
export const WORK_AMO_V8_MINT_AMOUNT_SUBATOMS =
  1_000n * WORK_AMO_V8_SUBATOMS_PER_WORK;
export const WORK_AMO_V8_ALLOWED_FACE_PROOFS = Object.freeze([
  25_000,
]);
export const WORK_AMO_V8_LEGACY_AUTH_VERSIONS = Object.freeze([
  WORK_AMO_V4_AUTH_VERSION,
  WORK_AMO_V5_AUTH_VERSION,
  WORK_AMO_V6_AUTH_VERSION,
]);
export const WORK_AMO_V8_MODELS = Object.freeze({
  amountModel: WORK_AMO_V8_AMOUNT_MODEL,
  blockSequencerModel: WORK_AMO_V8_BLOCK_SEQUENCER_MODEL,
  bondTransitionModel: WORK_AMO_V8_BOND_TRANSITION_MODEL,
  stateOrderModel: WORK_AMO_V8_STATE_ORDER_MODEL,
  unitModel: WORK_AMO_V8_UNIT_MODEL,
  unitWorkOracleModel: WORK_AMO_V8_UNIT_WORK_ORACLE_MODEL,
});
export const WORK_AMO_V8_STATIC_AUTHORIZATION_FIELDS = Object.freeze([
  ...WORK_AMO_V6_STATIC_AUTHORIZATION_FIELDS,
  "blockSequencerModel",
]);
export const WORK_AMO_V8_FROZEN_TERM_FIELDS = Object.freeze([
  "version",
  "unitModel",
  "stateOrderModel",
  "amountModel",
  "blockSequencerModel",
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
const V8_STATIC_AUTHORIZATION_FIELD_SET = new Set(
  WORK_AMO_V8_STATIC_AUTHORIZATION_FIELDS,
);
const V8_FROZEN_TERM_FIELD_SET = new Set(
  WORK_AMO_V8_FROZEN_TERM_FIELDS,
);
const V8_DERIVED_AUTHORIZATION_FIELDS = Object.freeze([
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
  return Object.entries(WORK_AMO_V8_MODELS).every(
    ([field, expected]) => authorization?.[field] === expected,
  );
}

function v8ReasonCode(value) {
  return String(value ?? "")
    .replaceAll("work-amo-v6", "work-amo-v8")
    .replaceAll("WORK_AMO_V6", "WORK_AMO_V8");
}

function asV8Invalid(validation) {
  return invalid(v8ReasonCode(validation?.reasonCode), {
    ...(validation?.legacyReasonCode
      ? { legacyReasonCode: validation.legacyReasonCode }
      : {}),
  });
}

function v6AuthorizationFromV8(authorization) {
  const {
    blockSequencerModel: _blockSequencerModel,
    ...sharedAuthorization
  } = authorization;
  void _blockSequencerModel;
  return {
    ...sharedAuthorization,
    ...WORK_AMO_V6_MODELS,
    // V6 validates the shared static sale-ticket shape but owns a different
    // face set. V8 validates its singleton face independently below.
    unitFaceProofs: 20_000,
    version: WORK_AMO_V6_AUTH_VERSION,
  };
}

function v8AuthorizationFromV6(authorization) {
  return {
    ...authorization,
    ...WORK_AMO_V8_MODELS,
    version: WORK_AMO_V8_AUTH_VERSION,
  };
}

export function validateWorkAmoV8StaticAuthorization(
  authorization,
) {
  if (
    !authorization ||
    typeof authorization !== "object" ||
    Array.isArray(authorization) ||
    Object.getPrototypeOf(authorization) !== Object.prototype
  ) {
    return invalid("work-amo-v8-authorization-invalid");
  }
  if (authorization.version !== WORK_AMO_V8_AUTH_VERSION) {
    return invalid("work-amo-v8-version-required");
  }
  if (!authorizationModelsValid(authorization)) {
    return invalid("work-amo-v8-models-invalid");
  }
  if (
    V8_DERIVED_AUTHORIZATION_FIELDS.some(
      (field) =>
        authorization[field] !== undefined &&
        authorization[field] !== null &&
        authorization[field] !== "",
    )
  ) {
    return invalid("work-amo-v8-derived-fields-not-signable");
  }
  if (
    Object.keys(authorization).some(
      (field) => !V8_STATIC_AUTHORIZATION_FIELD_SET.has(field),
    )
  ) {
    return invalid("work-amo-v8-authorization-shape-invalid");
  }
  const requestedFace = canonicalSafeInteger(
    authorization.unitFaceProofs,
    { positive: true },
  );
  if (!WORK_AMO_V8_ALLOWED_FACE_PROOFS.includes(requestedFace)) {
    return invalid("work-amo-v8-face-unit-invalid");
  }
  const v6Validation = validateWorkAmoV6StaticAuthorization(
    v6AuthorizationFromV8(authorization),
  );
  if (!v6Validation.valid) {
    return asV8Invalid(v6Validation);
  }
  return {
    authorization: {
      ...v8AuthorizationFromV6(v6Validation.authorization),
      unitFaceProofs: requestedFace,
    },
    valid: true,
  };
}

export function workAmoV8UnitTerms({
  networkValueBeforeQ8,
  unitFaceProofs,
} = {}) {
  const face = canonicalSafeInteger(unitFaceProofs, {
    positive: true,
  });
  const networkValue = positiveBigInt(networkValueBeforeQ8);
  if (!WORK_AMO_V8_ALLOWED_FACE_PROOFS.includes(face)) {
    return invalid("work-amo-v8-face-unit-invalid");
  }
  if (networkValue === null) {
    return invalid("work-amo-v8-network-value-before-invalid");
  }
  const denominator =
    WORK_AMO_V5_MAX_SUPPLY *
    WORK_AMO_V8_SUBATOMS_PER_WORK *
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
    return invalid("work-amo-v8-unit-result-nonpositive");
  }
  if (unitAmountSubatoms > WORK_AMO_V8_MAX_SUPPLY_SUBATOMS) {
    return invalid("work-amo-v8-unit-amount-exceeds-supply");
  }
  if (unitPriceSats < unitMinimumPriceSats) {
    return invalid("work-amo-v8-unit-price-below-minimum");
  }
  return {
    unitAmountSubatoms: unitAmountSubatoms.toString(),
    unitMinimumPriceSats: unitMinimumPriceSats.toString(),
    unitPriceSats: unitPriceSats.toString(),
    valid: true,
  };
}

export const calculateWorkAmoV8UnitTerms = workAmoV8UnitTerms;

export function validateWorkAmoV8ListingCutover({
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
    return invalid("work-amo-v8-listing-cutover-unavailable");
  }
  if (listing.blockHeight < activation) {
    return version === WORK_AMO_V8_AUTH_VERSION
      ? invalid("work-amo-v8-listing-before-activation")
      : {
          historical: true,
          listingPosition: listing,
          valid: WORK_AMO_V8_LEGACY_AUTH_VERSIONS.includes(version),
          ...(!WORK_AMO_V8_LEGACY_AUTH_VERSIONS.includes(version)
            ? {
                reasonCode:
                  "work-amo-v8-historical-listing-version-invalid",
              }
            : {}),
        };
  }
  if (version !== WORK_AMO_V8_AUTH_VERSION) {
    return invalid("work-amo-v8-version-required");
  }
  return {
    historical: false,
    listingPosition: listing,
    valid: true,
  };
}

export function deriveWorkAmoV8FrozenTerms(
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
    return invalid("work-amo-v8-listing-position-unavailable");
  }
  const cutover = validateWorkAmoV8ListingCutover({
    activationHeight,
    authorizationVersion: authorization?.version,
    listingPosition: listing,
  });
  if (!cutover.valid || cutover.historical === true) {
    return cutover.valid
      ? invalid("work-amo-v8-listing-before-activation")
      : cutover;
  }
  const staticValidation = validateWorkAmoV8StaticAuthorization(
    authorization,
  );
  if (!staticValidation.valid) {
    return staticValidation;
  }
  const networkValue = positiveBigInt(networkValueBeforeQ8);
  if (networkValue === null) {
    return invalid("work-amo-v8-network-value-before-invalid");
  }
  const bondContribution = positiveBigInt(
    listingBondContributionQ8,
  );
  if (bondContribution === null) {
    return invalid(
      "work-amo-v8-listing-bond-contribution-invalid",
    );
  }
  const unit = workAmoV8UnitTerms({
    networkValueBeforeQ8: networkValue.toString(),
    unitFaceProofs:
      staticValidation.authorization.unitFaceProofs,
  });
  if (!unit.valid) {
    return unit;
  }
  const spendable = nonNegativeBigInt(spendableAmountSubatoms);
  if (spendable === null) {
    return invalid("work-amo-v8-spendable-balance-unavailable");
  }
  if (spendable < BigInt(unit.unitAmountSubatoms)) {
    return invalid("work-amo-v8-insufficient-spendable-balance", {
      requiredAmountSubatoms: unit.unitAmountSubatoms,
      spendableAmountSubatoms: spendable.toString(),
    });
  }
  const networkAfter = networkValue + bondContribution;
  return {
    frozenTerms: {
      ...WORK_AMO_V8_MODELS,
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
      version: WORK_AMO_V8_AUTH_VERSION,
    },
    valid: true,
  };
}

function normalizeWorkAmoV8FrozenTerms(value) {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    Object.getPrototypeOf(value) !== Object.prototype ||
    Object.keys(value).some(
      (field) => !V8_FROZEN_TERM_FIELD_SET.has(field),
    ) ||
    value.version !== WORK_AMO_V8_AUTH_VERSION ||
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
    !WORK_AMO_V8_ALLOWED_FACE_PROOFS.includes(unitFaceProofs) ||
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
  const unit = workAmoV8UnitTerms({
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
    ...WORK_AMO_V8_MODELS,
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
    version: WORK_AMO_V8_AUTH_VERSION,
  };
}

export function validateWorkAmoV8FrozenTerms(
  frozenTerms,
  {
    authorization = null,
    listingBondContributionQ8,
    listingPosition = null,
    networkValueBeforeQ8,
  } = {},
) {
  const normalized = normalizeWorkAmoV8FrozenTerms(frozenTerms);
  if (!normalized) {
    return invalid("work-amo-v8-frozen-terms-invalid");
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
      "work-amo-v8-frozen-listing-position-mismatch",
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
    return invalid("work-amo-v8-frozen-network-value-mismatch");
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
      "work-amo-v8-frozen-bond-contribution-mismatch",
    );
  }
  if (authorization) {
    if (
      authorization.version !== WORK_AMO_V8_AUTH_VERSION ||
      !authorizationModelsValid(authorization) ||
      canonicalSafeInteger(authorization.unitFaceProofs, {
        positive: true,
      }) !== normalized.unitFaceProofs
    ) {
      return invalid(
        "work-amo-v8-frozen-authorization-mismatch",
      );
    }
  }
  return { frozenTerms: normalized, valid: true };
}

export function workAmoV8FrozenTermsMatch(left, right) {
  const normalizedLeft = normalizeWorkAmoV8FrozenTerms(left);
  const normalizedRight = normalizeWorkAmoV8FrozenTerms(right);
  return Boolean(
    normalizedLeft &&
      normalizedRight &&
      WORK_AMO_V8_FROZEN_TERM_FIELDS.every(
        (field) => normalizedLeft[field] === normalizedRight[field],
      ),
  );
}

export function validateWorkAmoV8LegacyListingReference(
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
    !WORK_AMO_V8_LEGACY_AUTH_VERSIONS.includes(version)
  ) {
    return invalid("work-amo-v8-legacy-reference-invalid");
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
        "work-amo-v8-legacy-v6-frozen-terms-invalid",
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
    : invalid("work-amo-v8-legacy-reference-invalid", {
        legacyReasonCode: validation.reasonCode,
      });
}

/**
 * Settlements validate only the listing's already-frozen canonical terms.
 * They never select or compare a current network-value estimate.
 */
export function validateWorkAmoV8SealOrBuyTerms({
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
  if (listingVersion !== WORK_AMO_V8_AUTH_VERSION) {
    return invalid("work-amo-v8-relic-listing-nonsettleable", {
      listingAuthorizationVersion: listingVersion,
    });
  }
  const listingValidation = validateWorkAmoV8FrozenTerms(
    listingFrozenTerms,
    {
      authorization: listingAuthorization,
      listingPosition,
    },
  );
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
    return invalid("work-amo-v8-action-not-after-listing");
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
    !actionFrozenTerms ||
    !workAmoV8FrozenTermsMatch(
      listingValidation.frozenTerms,
      actionFrozenTerms,
    )
  ) {
    return invalid(
      "work-amo-v8-action-frozen-terms-mismatch",
    );
  }
  return {
    frozenTerms: listingValidation.frozenTerms,
    listingAuthorizationVersion: listingVersion,
    referenced: false,
    valid: true,
  };
}

function canonicalWorkAmoV8TokenStateListing({
  authorization,
  frozenTerms,
  sellerAddress,
} = {}) {
  const version = String(authorization?.version ?? "").trim();
  if (version === WORK_AMO_V8_AUTH_VERSION) {
    const staticValidation =
      validateWorkAmoV8StaticAuthorization(authorization);
    const frozenValidation = validateWorkAmoV8FrozenTerms(
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
  return null;
}

export function workAmoV8CanonicalTokenStatePreimage(tokenState) {
  const confirmedSupplySubatoms = canonicalUnsignedIntegerText(
    tokenState?.confirmedSupplySubatoms,
  );
  if (
    !confirmedSupplySubatoms ||
    BigInt(confirmedSupplySubatoms) >
      WORK_AMO_V8_MAX_SUPPLY_SUBATOMS
  ) {
    throw new TypeError("work-amo-v8-token-state-supply-invalid");
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
        WORK_AMO_V8_MAX_SUPPLY_SUBATOMS ||
      holderAddresses.has(address)
    ) {
      throw new TypeError("work-amo-v8-token-state-holder-invalid");
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
    const witness = canonicalWorkAmoV8TokenStateListing({
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
        WORK_AMO_V8_MAX_SUPPLY_SUBATOMS ||
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
      throw new TypeError("work-amo-v8-token-state-listing-invalid");
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
      "work-amo-v8-token-state-balance-parity-invalid",
    );
  }
  return {
    confirmedSupplySubatoms,
    definition: {
      amountStorageModel: WORK_AMO_V8_PRECISION_MODEL,
      decimals: WORK_AMO_V8_DECIMALS,
      maxSupplySubatoms:
        WORK_AMO_V8_MAX_SUPPLY_SUBATOMS.toString(),
      mintAmountSubatoms:
        WORK_AMO_V8_MINT_AMOUNT_SUBATOMS.toString(),
      precisionModel: WORK_AMO_V8_GLOBAL_PRECISION_MODEL,
      registryAddress:
        WORK_AMO_V5_DECLARATION_REGISTRY_ADDRESS,
      ticker: "WORK",
      tokenId: WORK_TOKEN_ID,
      unitScale: WORK_AMO_V8_SUBATOMS_PER_WORK.toString(),
    },
    holders,
    listings,
    model: WORK_AMO_V8_TOKEN_STATE_PREIMAGE_MODEL,
    reservedSubatoms: reservedSubatoms.toString(),
  };
}

export function workAmoV8CanonicalTokenStateCommitment(tokenState) {
  return workAmoV5CanonicalPayloadCommitment(
    workAmoV8CanonicalTokenStatePreimage(tokenState),
  );
}

function exactWorkAmoV8BoundaryHash(value) {
  return typeof value === "string" && HASH_PATTERN.test(value) ? value : "";
}

function exactWorkAmoV8BoundaryCommitment(value, expectedModel) {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    Object.keys(value).sort().join(",") !== "model,payloadBytes,sha256" ||
    value.model !== expectedModel ||
    canonicalSafeInteger(value.payloadBytes, { positive: true }) === null ||
    exactWorkAmoV8BoundaryHash(value.sha256) === ""
  ) {
    return null;
  }
  return {
    model: value.model,
    payloadBytes: value.payloadBytes,
    sha256: value.sha256,
  };
}

function exactWorkAmoV8BoundaryCommitmentsEqual(left, right) {
  return Boolean(
    left &&
      right &&
      left.model === right.model &&
      left.payloadBytes === right.payloadBytes &&
      left.sha256 === right.sha256
  );
}

export function validateWorkAmoV8BoundaryTransitionPayload(value) {
  const transition =
    value && typeof value === "object" && !Array.isArray(value)
      ? value
      : {};
  const payload =
    transition.payload &&
    typeof transition.payload === "object" &&
    !Array.isArray(transition.payload)
      ? transition.payload
      : null;
  const blockHeight = canonicalSafeInteger(transition.blockHeight, {
    positive: true,
  });
  const blockHash = exactWorkAmoV8BoundaryHash(transition.blockHash);
  const previousBlockHash = exactWorkAmoV8BoundaryHash(
    transition.previousBlockHash,
  );
  const openingNetworkValueQ8 = canonicalUnsignedIntegerText(
    transition.openingNetworkValueQ8,
    { positive: true },
  );
  const closingNetworkValueQ8 = canonicalUnsignedIntegerText(
    transition.closingNetworkValueQ8,
    { positive: true },
  );
  const openingStateSha256 = exactWorkAmoV8BoundaryHash(
    transition.openingStateSha256,
  );
  const closingStateSha256 = exactWorkAmoV8BoundaryHash(
    transition.closingStateSha256,
  );
  const openingStatePayloadBytes = canonicalSafeInteger(
    transition.openingStatePayloadBytes,
    { positive: true },
  );
  const closingStatePayloadBytes = canonicalSafeInteger(
    transition.closingStatePayloadBytes,
    { positive: true },
  );
  if (
    !payload ||
    blockHeight === null ||
    !blockHash ||
    !previousBlockHash ||
    !openingNetworkValueQ8 ||
    !closingNetworkValueQ8 ||
    BigInt(closingNetworkValueQ8) < BigInt(openingNetworkValueQ8) ||
    !openingStateSha256 ||
    !closingStateSha256 ||
    openingStatePayloadBytes === null ||
    closingStatePayloadBytes === null ||
    transition.network !== "livenet" ||
    transition.model !== WORK_AMO_V8_BLOCK_SEQUENCER_MODEL ||
    transition.stateCommitmentModel !==
      WORK_AMO_V5_STATE_COMMITMENT_MODEL ||
    transition.workTokenStateModel !==
      WORK_AMO_V8_TOKEN_STATE_PREIMAGE_MODEL ||
    transition.blockAtomic !== true ||
    transition.feeOnce !== true ||
    transition.invalidZero !== true ||
    transition.complete !== true ||
    payload.model !== WORK_AMO_V8_BLOCK_SEQUENCER_MODEL ||
    payload.network !== transition.network ||
    payload.blockHeight !== blockHeight ||
    payload.blockHash !== blockHash ||
    payload.previousBlockHash !== previousBlockHash ||
    payload.blockAtomic !== true ||
    payload.feeOnce !== true ||
    payload.invalidZero !== true ||
    payload.complete !== true ||
    payload.workTokenStateModel !==
      WORK_AMO_V8_TOKEN_STATE_PREIMAGE_MODEL
  ) {
    return invalid("work-amo-v8-boundary-transition-envelope-invalid");
  }
  const openingValidation = validateWorkAmoV5SufficientState(
    payload.openingSufficientState,
  );
  const closingValidation = validateWorkAmoV5SufficientState(
    payload.closingSufficientState,
  );
  const openingCommitment = exactWorkAmoV8BoundaryCommitment(
    payload.openingStateCommitment,
    WORK_AMO_V5_STATE_COMMITMENT_MODEL,
  );
  const closingCommitment = exactWorkAmoV8BoundaryCommitment(
    payload.closingStateCommitment,
    WORK_AMO_V5_STATE_COMMITMENT_MODEL,
  );
  if (
    openingValidation.valid !== true ||
    closingValidation.valid !== true ||
    openingValidation.state.model !==
      WORK_AMO_V5_NETWORK_ACCUMULATOR_MODEL ||
    closingValidation.state.model !==
      WORK_AMO_V5_NETWORK_ACCUMULATOR_MODEL ||
    payload.openingSufficientState.model !==
      WORK_AMO_V5_NETWORK_ACCUMULATOR_MODEL ||
    payload.closingSufficientState.model !==
      WORK_AMO_V5_NETWORK_ACCUMULATOR_MODEL ||
    payload.openingSufficientState.network !== transition.network ||
    payload.closingSufficientState.network !== transition.network ||
    payload.openingSufficientState.throughBlockHeight !==
      blockHeight - 1 ||
    payload.openingSufficientState.throughBlockHash !==
      previousBlockHash ||
    payload.closingSufficientState.throughBlockHeight !== blockHeight ||
    payload.closingSufficientState.throughBlockHash !== blockHash ||
    payload.openingSufficientState.networkValueQ8 !==
      openingNetworkValueQ8 ||
    payload.closingSufficientState.networkValueQ8 !==
      closingNetworkValueQ8 ||
    !openingCommitment ||
    !closingCommitment
  ) {
    return invalid("work-amo-v8-boundary-transition-state-invalid");
  }
  try {
    const canonicalOpeningCommitment =
      workAmoV5CanonicalStateCommitment(openingValidation.state);
    const canonicalClosingCommitment =
      workAmoV5CanonicalStateCommitment(closingValidation.state);
    const rawOpeningStateCommitment =
      workAmoV5CanonicalPayloadCommitment(
        payload.openingSufficientState,
      );
    const normalizedOpeningStateCommitment =
      workAmoV5CanonicalPayloadCommitment(openingValidation.state);
    const rawClosingStateCommitment =
      workAmoV5CanonicalPayloadCommitment(
        payload.closingSufficientState,
      );
    const normalizedClosingStateCommitment =
      workAmoV5CanonicalPayloadCommitment(closingValidation.state);
    const closingTokenStateCommitment =
      workAmoV8CanonicalTokenStateCommitment(
        payload.closingTokenState,
      );
    if (
      openingCommitment.sha256 !== openingStateSha256 ||
      openingCommitment.payloadBytes !== openingStatePayloadBytes ||
      closingCommitment.sha256 !== closingStateSha256 ||
      closingCommitment.payloadBytes !== closingStatePayloadBytes ||
      !exactWorkAmoV8BoundaryCommitmentsEqual(
        openingCommitment,
        canonicalOpeningCommitment,
      ) ||
      !exactWorkAmoV8BoundaryCommitmentsEqual(
        closingCommitment,
        canonicalClosingCommitment,
      ) ||
      !exactWorkAmoV8BoundaryCommitmentsEqual(
        rawOpeningStateCommitment,
        normalizedOpeningStateCommitment,
      ) ||
      !exactWorkAmoV8BoundaryCommitmentsEqual(
        rawClosingStateCommitment,
        normalizedClosingStateCommitment,
      ) ||
      !exactWorkAmoV8BoundaryCommitmentsEqual(
        closingValidation.state.tokenStateCommitment,
        closingTokenStateCommitment,
      ) ||
      (
        payload.closingTokenState?.model !== undefined &&
        payload.closingTokenState.model !==
          WORK_AMO_V8_TOKEN_STATE_PREIMAGE_MODEL
      )
    ) {
      return invalid(
        "work-amo-v8-boundary-transition-commitment-invalid",
      );
    }
    return {
      closingState: closingValidation.state,
      closingTokenState: payload.closingTokenState,
      openingState: openingValidation.state,
      valid: true,
    };
  } catch {
    return invalid("work-amo-v8-boundary-transition-commitment-invalid");
  }
}

export function replayWorkAmoV8CanonicalBlock({
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
      "work-amo-v8-sequencer-before-activation",
    );
    error.code = "work-amo-v8-sequencer-before-activation";
    throw error;
  }
  const replay = replayWorkAmoV5CanonicalBlock(options);
  return {
    ...replay,
    activationHeight: activation,
    model: WORK_AMO_V8_BLOCK_SEQUENCER_MODEL,
  };
}

export const compareWorkAmoV8CanonicalPositions =
  compareWorkAmoCanonicalPositions;
export const workAmoV8CanonicalPositionPrecedes =
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

export function validateWorkAmoV8DeclarationEvidence(
  evidence,
  { expectedDeclaration } = {},
) {
  const expected = normalizeExpectedDeclaration(expectedDeclaration);
  if (!expected) {
    return invalid(
      "work-amo-v8-declaration-commitment-unconfigured",
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
    return invalid("work-amo-v8-declaration-evidence-mismatch");
  }
  return {
    activationHeight: expected.activationHeight,
    declaration: expected,
    model: WORK_AMO_V8_DECLARATION_EVIDENCE_MODEL,
    valid: true,
  };
}

export function workAmoV8ActivationFromEvidence(
  evidence,
  {
    expectedDeclaration,
    indexedThroughBlock,
  } = {},
) {
  const validation = validateWorkAmoV8DeclarationEvidence(evidence, {
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
      reasonCode: "work-amo-v8-activation-not-indexed",
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

export function workAmoV8TransferEraDecision({
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
    !["send", "send2", WORK_AMO_V8_TRANSFER_VERSION].includes(
      version,
    )
  ) {
    return invalid("work-amo-v8-transfer-era-input-invalid");
  }
  let v8Required;
  if (confirmed === true) {
    const height = canonicalSafeInteger(blockHeight, {
      positive: true,
    });
    if (height === null) {
      return invalid(
        "work-amo-v8-transfer-confirmed-height-invalid",
      );
    }
    v8Required = height >= activation;
  } else {
    if (
      projectionModel !== WORK_SUBATOM_PROJECTION_MODEL &&
      projectionModel !== WORK_LEGACY_ATOMIC_PROJECTION_MODEL
    ) {
      return invalid(
        "work-amo-v8-transfer-projection-model-invalid",
      );
    }
    v8Required =
      projectionModel === WORK_SUBATOM_PROJECTION_MODEL;
  }
  const nativeV8 =
    version === WORK_AMO_V8_TRANSFER_VERSION;
  if (nativeV8 !== v8Required) {
    return invalid(
      v8Required
        ? "work-amo-v8-send3-required"
        : "work-amo-v8-send3-before-activation",
    );
  }
  return {
    convertLegacyAtoms:
      !nativeV8 &&
      projectionModel === WORK_SUBATOM_PROJECTION_MODEL,
    nativeV8,
    valid: true,
  };
}

export function workAmoV8StatusFromEvidence({
  evidence,
  expectedDeclaration,
  indexedThroughBlock,
  precisionMigrationReady = false,
  protocolWritesEnabled = false,
} = {}) {
  const activationResult = workAmoV8ActivationFromEvidence(evidence, {
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
          ? "work-amo-v8-precision-migration-not-ready"
          : "work-amo-v8-writes-paused",
    ready,
    version: WORK_AMO_V8_AUTH_VERSION,
  };
}

function workAmoV8SignedShapeRejection(action) {
  const shapeChecks =
    action?.signedShapeChecks && typeof action.signedShapeChecks === "object"
      ? action.signedShapeChecks
      : null;
  const failedShapeCheck = shapeChecks
    ? [
        ["staticShapeValid", "work-amo-v8-static-shape-invalid"],
        [
          "delistSpendsListingAnchor",
          "work-amo-v8-delist-anchor-not-spent",
        ],
        ["actorMatches", "work-amo-v8-actor-proof-invalid"],
        ["buyerLockMatches", "work-amo-v8-buyer-lock-mismatch"],
        ["referencedTermsMatch", "work-amo-v8-listing-terms-mismatch"],
        ["frozenTermsReady", "work-amo-v8-frozen-terms-unavailable"],
        ["frozenPaymentMatches", "work-amo-v8-frozen-payment-mismatch"],
      ].find(([key]) => shapeChecks[key] === false)
    : null;
  const reasonCode =
    action?.canonicalParsed !== true
      ? "work-amo-v8-canonical-parse-invalid"
      : action?.paysWorkRegistry !== true
        ? "work-amo-v8-registry-payment-missing"
        : normalizedLowerText(action?.tokenId) !== WORK_TOKEN_ID
          ? "work-amo-v8-token-id-invalid"
          : String(action?.ticker ?? "").trim().toUpperCase() !== "WORK"
            ? "work-amo-v8-ticker-invalid"
            : String(action?.registryAddress ?? "").trim() !==
                WORK_AMO_V5_DECLARATION_REGISTRY_ADDRESS
              ? "work-amo-v8-registry-address-invalid"
              : action?.tokenProtocolMessageCount !== 1
                ? "work-amo-v8-protocol-message-count-invalid"
                : failedShapeCheck
                  ? failedShapeCheck[1]
                  : String(action?.signedShapeReasonCode ?? "").trim() ||
                    "work-amo-v8-transaction-shape-invalid";
  return {
    ...(failedShapeCheck
      ? {
          hint: `Signed WORK AMO V8 shape failed ${failedShapeCheck[0]}.`,
        }
      : {}),
    reasonCode,
    ...(shapeChecks ? { shapeChecks } : {}),
  };
}

export function workAmoV8BroadcastDecision(
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
      code: "WORK_AMO_V8_WRITES_PAUSED",
      reasonCode:
        metadata?.reasonCode ?? "work-amo-v8-writes-paused",
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
      code: "WORK_AMO_V8_EVIDENCE_NOT_READY",
      reasonCode: "work-amo-v8-evidence-not-ready",
      statusCode: 503,
    };
  }
  for (const action of candidates) {
    const actionName = String(action?.action ?? "").trim().toLowerCase();
    if (!["list5", "seal5", "buy5", "delist5"].includes(actionName)) {
      return {
        allowed: false,
        code: "WORK_AMO_V8_TRANSACTION_INVALID",
        reasonCode: "work-amo-v8-action-invalid",
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
      const rejection = workAmoV8SignedShapeRejection(action);
      return {
        ...rejection,
        allowed: false,
        code: "WORK_AMO_V8_TRANSACTION_INVALID",
        statusCode: 400,
      };
    }
    if (actionName === "list5") {
      if (metadata?.listingWritesEnabled !== true) {
        return {
          allowed: false,
          code: "WORK_AMO_V8_WRITES_PAUSED",
          reasonCode:
            metadata?.reasonCode ?? "work-amo-v8-writes-paused",
          statusCode: 503,
        };
      }
      if (
        action?.authVersion !== WORK_AMO_V8_AUTH_VERSION ||
        action?.saleAuthorization?.version !==
          WORK_AMO_V8_AUTH_VERSION
      ) {
        return {
          allowed: false,
          code: "WORK_AMO_V8_REQUIRED",
          reasonCode: "work-amo-v8-version-required",
          statusCode: 400,
        };
      }
      const staticValidation =
        validateWorkAmoV8StaticAuthorization(
          action.saleAuthorization,
        );
      if (!staticValidation.valid) {
        return {
          allowed: false,
          code: "WORK_AMO_V8_STATIC_AUTHORIZATION_INVALID",
          reasonCode: staticValidation.reasonCode,
          statusCode: 400,
        };
      }
      continue;
    }
    if (actionName === "delist5") {
      if (
        action?.authVersion !== WORK_AMO_V8_AUTH_VERSION ||
        action?.listingAuthorization?.version !==
          WORK_AMO_V8_AUTH_VERSION
      ) {
        return {
          allowed: false,
          code: "WORK_AMO_V8_RELIC_LISTING_NONSETTLEABLE",
          reasonCode: "work-amo-v8-relic-listing-nonsettleable",
          statusCode: 400,
        };
      }
      const staticValidation =
        validateWorkAmoV8StaticAuthorization(
          action.listingAuthorization,
        );
      const frozenValidation = staticValidation.valid
        ? validateWorkAmoV8FrozenTerms(
            action.listingFrozenTerms,
            {
              authorization: staticValidation.authorization,
              listingPosition: action.listingPosition,
            },
          )
        : staticValidation;
      if (!staticValidation.valid || !frozenValidation.valid) {
        return {
          allowed: false,
          code: "WORK_AMO_V8_FROZEN_TERMS_INVALID",
          reasonCode:
            staticValidation.reasonCode ?? frozenValidation.reasonCode,
          statusCode: 400,
        };
      }
      continue;
    }
    const settlementValidation =
      validateWorkAmoV8SealOrBuyTerms({
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
        code: "WORK_AMO_V8_FROZEN_TERMS_INVALID",
        reasonCode: settlementValidation.reasonCode,
        statusCode: 400,
      };
    }
  }
  return { allowed: true };
}
