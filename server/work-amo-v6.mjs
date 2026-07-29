import {
  WORK_AMO_V4_AUTH_VERSION,
  WORK_AMO_V5_ATOMS_PER_WORK,
  WORK_AMO_V5_AUTH_VERSION,
  WORK_AMO_V5_DECLARATION_REGISTRY_ADDRESS,
  WORK_AMO_V5_MAX_SUPPLY,
  WORK_AMO_V5_NETWORK_VALUE_Q8_SCALE,
  WORK_AMO_V5_PROOFS_PER_QUOTE_UNIT,
  WORK_AMO_V5_USD_QUOTE_Q8_SCALE,
  compareWorkAmoCanonicalPositions,
  isWorkAmoV5LivenetAddress,
  normalizeWorkAmoCanonicalPosition,
  replayWorkAmoV5CanonicalBlock,
  validateWorkAmoV5FrozenTerms,
  workAmoCanonicalPositionPrecedes,
  workAmoCeilDiv,
  workAmoFloorDiv,
  workAmoV5CanonicalExpiryMs,
} from "./work-amo-v5.mjs";
import { WORK_TOKEN_ID } from "./work-units.mjs";
import {
  WORK_USD_ATTESTATION_MODEL,
  WORK_USD_ATTESTATION_VERSION,
  WORK_USD_ORACLE_FRESHNESS_WINDOW_MS,
  WORK_USD_ORACLE_MAX_SPREAD_BPS,
  WORK_USD_ORACLE_MAX_VALIDITY_BLOCKS,
  WORK_USD_ORACLE_MINIMUM_SOURCES,
  WORK_USD_ORACLE_SOURCE_IDS,
  verifyWorkUsdAttestation,
} from "./work-usd-oracle.mjs";

export const WORK_AMO_V6_AUTH_VERSION = "pwt-sale-v6";
export const WORK_AMO_V6_INLINE_ATTESTATION_VERSION =
  WORK_USD_ATTESTATION_VERSION;
export const WORK_AMO_V6_UNIT_MODEL =
  "canonical-work-amo-usd-unit-v3";
export const WORK_AMO_V6_STATE_ORDER_MODEL =
  "canonical-proof-state-order-v1";
export const WORK_AMO_V6_AMOUNT_MODEL =
  "canonical-confirmed-position-derived-work-amount-v1";
export const WORK_AMO_V6_UNIT_USD_ORACLE_MODEL =
  WORK_USD_ATTESTATION_MODEL;
export const WORK_AMO_V6_UNIT_WORK_ORACLE_MODEL =
  "canonical-work-prefix-before-action-v1";
export const WORK_AMO_V6_BOND_TRANSITION_MODEL =
  "canonical-compute-then-bond-v1";
export const WORK_AMO_V6_BLOCK_SEQUENCER_MODEL =
  "canonical-work-amo-full-position-block-sequencer-v2";
export const WORK_AMO_V6_DECLARATION_EVIDENCE_MODEL =
  "canonical-work-amo-v6-declaration-evidence-v1";
export const WORK_AMO_V6_ALLOWED_FACE_USD_CENTS = Object.freeze([
  2_000,
  5_000,
  10_000,
]);
export const WORK_AMO_V6_MAX_ATTESTATION_VALIDITY_BLOCKS =
  WORK_USD_ORACLE_MAX_VALIDITY_BLOCKS;
export const WORK_AMO_V6_MODELS = Object.freeze({
  amountModel: WORK_AMO_V6_AMOUNT_MODEL,
  bondTransitionModel: WORK_AMO_V6_BOND_TRANSITION_MODEL,
  stateOrderModel: WORK_AMO_V6_STATE_ORDER_MODEL,
  unitModel: WORK_AMO_V6_UNIT_MODEL,
  unitUsdOracleModel: WORK_AMO_V6_UNIT_USD_ORACLE_MODEL,
  unitWorkOracleModel: WORK_AMO_V6_UNIT_WORK_ORACLE_MODEL,
});
export const WORK_AMO_V6_STATIC_AUTHORIZATION_FIELDS = Object.freeze([
  "version",
  "unitModel",
  "stateOrderModel",
  "amountModel",
  "bondTransitionModel",
  "unitUsdOracleModel",
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
  "unitFaceUsdCents",
  "unitUsdAttestation",
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
  "unitUsdOracleModel",
  "unitWorkOracleModel",
  "unitFaceUsd",
  "unitFaceUsdCents",
  "unitUsdAttestationVersion",
  "unitUsdAttestationModel",
  "unitUsdAttestationId",
  "unitUsdDeclarationTxid",
  "unitUsdOracleKeyId",
  "unitUsdOraclePublicKey",
  "unitUsdReferenceBlockHeight",
  "unitUsdReferenceBlockHash",
  "unitUsdValidFromHeight",
  "unitUsdValidThroughHeight",
  "unitUsdSourceSetSha256",
  "unitUsdAttestationSignature",
  "unitUsdPer100mProofsQ8",
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
const PUBLIC_KEY_PATTERN = /^[0-9a-f]{64}$/u;
const SIGNATURE_PATTERN = /^[0-9a-f]{128}$/u;
const HEX_PATTERN = /^(?:[0-9a-f]{2})+$/u;
const UNSIGNED_INTEGER_PATTERN = /^(?:0|[1-9][0-9]*)$/u;
const V6_DERIVED_AUTHORIZATION_FIELDS = Object.freeze([
  "amount",
  "amountAtoms",
  "minimumPriceSats",
  "priceSats",
  "unitAmountAtoms",
  "unitFaceUsd",
  "unitMinimumPriceSats",
  "unitNetworkValueAfterQ8",
  "unitNetworkValueBeforeQ8",
  "unitPriceSats",
  "unitUsdPer100mProofsQ8",
]);
const V6_STATIC_AUTHORIZATION_FIELD_SET = new Set(
  WORK_AMO_V6_STATIC_AUTHORIZATION_FIELDS,
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

function sameStringArray(left, right) {
  return (
    Array.isArray(left) &&
    Array.isArray(right) &&
    left.length === right.length &&
    left.every((value, index) => value === right[index])
  );
}

function authorizationModelsValid(authorization) {
  return Object.entries(WORK_AMO_V6_MODELS).every(
    ([field, expected]) => authorization?.[field] === expected,
  );
}

function normalizeOraclePolicy(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  const declarationTxid = normalizedTxid(value.declarationTxid);
  const oracleKeyId = normalizedLowerText(value.oracleKeyId);
  const publicKey = normalizedLowerText(value.publicKey);
  const model = String(value.model ?? "").trim();
  const freshnessWindowMs = canonicalSafeInteger(
    value.freshnessWindowMs,
    { positive: true },
  );
  const maxSpreadBps = canonicalSafeInteger(value.maxSpreadBps, {
    positive: true,
  });
  const minimumSources = canonicalSafeInteger(value.minimumSources, {
    positive: true,
  });
  const maxValidityBlocks = canonicalSafeInteger(
    value.maxValidityBlocks ??
      WORK_AMO_V6_MAX_ATTESTATION_VALIDITY_BLOCKS,
    { positive: true },
  );
  const allowedSourceIds = Array.isArray(value.allowedSourceIds)
    ? value.allowedSourceIds.map((sourceId) =>
        String(sourceId ?? "").trim(),
      )
    : [];
  if (
    !declarationTxid ||
    !HASH_PATTERN.test(oracleKeyId) ||
    !PUBLIC_KEY_PATTERN.test(publicKey) ||
    !model ||
    freshnessWindowMs === null ||
    maxSpreadBps === null ||
    minimumSources === null ||
    maxValidityBlocks === null ||
    model !== WORK_USD_ATTESTATION_MODEL ||
    freshnessWindowMs !== WORK_USD_ORACLE_FRESHNESS_WINDOW_MS ||
    maxSpreadBps !== WORK_USD_ORACLE_MAX_SPREAD_BPS ||
    minimumSources !== WORK_USD_ORACLE_MINIMUM_SOURCES ||
    maxValidityBlocks !== WORK_USD_ORACLE_MAX_VALIDITY_BLOCKS ||
    allowedSourceIds.length < minimumSources ||
    allowedSourceIds.some((sourceId) => !sourceId) ||
    new Set(allowedSourceIds).size !== allowedSourceIds.length ||
    !sameStringArray(
      allowedSourceIds,
      allowedSourceIds.slice().sort(),
    ) ||
    !sameStringArray(allowedSourceIds, WORK_USD_ORACLE_SOURCE_IDS)
  ) {
    return null;
  }
  return {
    allowedSourceIds,
    declarationTxid,
    freshnessWindowMs,
    maxSpreadBps,
    maxValidityBlocks,
    minimumSources,
    model,
    oracleKeyId,
    publicKey,
  };
}

function oracleReasonCode(error) {
  const code = String(error?.code ?? "").trim();
  return code
    ? `work-amo-v6-${code.toLowerCase().replaceAll("_", "-")}`
    : "work-amo-v6-attestation-invalid";
}

function normalizedVerifiedAttestation(result) {
  const attestation = result?.attestation;
  if (
    result?.valid !== true ||
    !attestation ||
    typeof attestation !== "object" ||
    Array.isArray(attestation)
  ) {
    return null;
  }
  const referenceBlockHeight = canonicalSafeInteger(
    attestation.referenceBlockHeight,
    { positive: true },
  );
  const validFromHeight = canonicalSafeInteger(
    attestation.validFromHeight,
    { positive: true },
  );
  const validThroughHeight = canonicalSafeInteger(
    attestation.validThroughHeight,
    { positive: true },
  );
  const usdPer100mProofsQ8 = canonicalUnsignedIntegerText(
    attestation.usdPer100mProofsQ8,
    { positive: true },
  );
  const normalized = {
    ...attestation,
    attestationId: normalizedLowerText(attestation.attestationId),
    declarationTxid: normalizedTxid(attestation.declarationTxid),
    model: String(attestation.model ?? "").trim(),
    network: String(attestation.network ?? "").trim().toLowerCase(),
    oracleKeyId: normalizedLowerText(attestation.oracleKeyId),
    publicKey: normalizedLowerText(attestation.publicKey),
    referenceBlockHash: normalizedTxid(
      attestation.referenceBlockHash,
    ),
    referenceBlockHeight,
    signature: normalizedLowerText(attestation.signature),
    sourceSetSha256: normalizedLowerText(
      attestation.sourceSetSha256,
    ),
    usdPer100mProofsQ8,
    validFromHeight,
    validThroughHeight,
    version: String(attestation.version ?? "").trim(),
  };
  if (
    normalized.version !== WORK_AMO_V6_INLINE_ATTESTATION_VERSION ||
    normalized.network !== "livenet" ||
    !normalized.declarationTxid ||
    !HASH_PATTERN.test(normalized.oracleKeyId) ||
    !PUBLIC_KEY_PATTERN.test(normalized.publicKey) ||
    referenceBlockHeight === null ||
    !normalized.referenceBlockHash ||
    validFromHeight === null ||
    validThroughHeight === null ||
    !HASH_PATTERN.test(normalized.sourceSetSha256) ||
    !HASH_PATTERN.test(normalized.attestationId) ||
    !SIGNATURE_PATTERN.test(normalized.signature) ||
    !usdPer100mProofsQ8
  ) {
    return null;
  }
  return normalized;
}

/**
 * Verifies the signed inline USD attestation and then independently binds its
 * anchor to canonical chain data. `canonicalBlockHashAtHeight` must read the
 * canonical block index, never a caller-supplied transaction projection.
 */
export function validateWorkAmoV6InlineAttestation(
  attestation,
  {
    canonicalBlockHashAtHeight,
    listingPosition = null,
    oraclePolicy,
    verifyAttestation = verifyWorkUsdAttestation,
  } = {},
) {
  const policy = normalizeOraclePolicy(oraclePolicy);
  if (!policy) {
    return invalid("work-amo-v6-oracle-policy-unavailable");
  }
  if (typeof verifyAttestation !== "function") {
    return invalid("work-amo-v6-attestation-verifier-unavailable");
  }
  const listing = listingPosition
    ? normalizeWorkAmoCanonicalPosition(listingPosition)
    : null;
  if (listingPosition && !listing) {
    return invalid("work-amo-v6-listing-position-unavailable");
  }
  let verified;
  try {
    verified = verifyAttestation(attestation, {
      allowedSourceIds: policy.allowedSourceIds,
      ...(listing ? { blockHeight: listing.blockHeight } : {}),
      expectedDeclarationTxid: policy.declarationTxid,
      expectedFreshnessWindowMs: policy.freshnessWindowMs,
      expectedMaxValidityBlocks: policy.maxValidityBlocks,
      expectedMaxSpreadBps: policy.maxSpreadBps,
      expectedMinimumSources: policy.minimumSources,
      expectedModel: policy.model,
      expectedNetwork: "livenet",
      expectedOracleKeyId: policy.oracleKeyId,
      expectedPublicKey: policy.publicKey,
    });
  } catch (error) {
    return invalid(oracleReasonCode(error), {
      oracleCode: String(error?.code ?? ""),
    });
  }
  const normalized = normalizedVerifiedAttestation(verified);
  if (!normalized) {
    return invalid("work-amo-v6-attestation-result-invalid");
  }
  if (
    normalized.validFromHeight !==
      normalized.referenceBlockHeight + 1 ||
    normalized.validThroughHeight < normalized.validFromHeight ||
    normalized.validThroughHeight - normalized.referenceBlockHeight >
      policy.maxValidityBlocks
  ) {
    return invalid("work-amo-v6-attestation-window-invalid");
  }
  if (
    typeof canonicalBlockHashAtHeight !== "function"
  ) {
    return invalid("work-amo-v6-attestation-anchor-unavailable");
  }
  let canonicalHash;
  try {
    canonicalHash = normalizedTxid(
      canonicalBlockHashAtHeight(normalized.referenceBlockHeight),
    );
  } catch {
    return invalid("work-amo-v6-attestation-anchor-unavailable");
  }
  if (!canonicalHash) {
    return invalid("work-amo-v6-attestation-anchor-unavailable");
  }
  if (canonicalHash !== normalized.referenceBlockHash) {
    return invalid("work-amo-v6-attestation-anchor-noncanonical");
  }
  if (
    listing &&
    (
      normalized.referenceBlockHeight >= listing.blockHeight ||
      listing.blockHeight < normalized.validFromHeight ||
      listing.blockHeight > normalized.validThroughHeight
    )
  ) {
    return invalid("work-amo-v6-attestation-not-valid-at-listing");
  }
  return { attestation: normalized, oraclePolicy: policy, valid: true };
}

export function validateWorkAmoV6StaticAuthorization(
  authorization,
  {
    canonicalBlockHashAtHeight,
    oraclePolicy,
    requireCanonicalAnchor = true,
    verifyAttestation = verifyWorkUsdAttestation,
  } = {},
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
  const unitFaceUsdCents = canonicalSafeInteger(
    authorization.unitFaceUsdCents,
    { positive: true },
  );
  if (
    !WORK_AMO_V6_ALLOWED_FACE_USD_CENTS.includes(unitFaceUsdCents)
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
  let attestationValidation;
  if (requireCanonicalAnchor) {
    attestationValidation = validateWorkAmoV6InlineAttestation(
      authorization.unitUsdAttestation,
      {
        canonicalBlockHashAtHeight,
        oraclePolicy,
        verifyAttestation,
      },
    );
    if (!attestationValidation.valid) {
      return attestationValidation;
    }
  } else {
    const policy = normalizeOraclePolicy(oraclePolicy);
    if (!policy) {
      return invalid("work-amo-v6-oracle-policy-unavailable");
    }
    let verified;
    try {
      verified = verifyAttestation(
        authorization.unitUsdAttestation,
        {
          allowedSourceIds: policy.allowedSourceIds,
          expectedDeclarationTxid: policy.declarationTxid,
          expectedFreshnessWindowMs: policy.freshnessWindowMs,
          expectedMaxValidityBlocks: policy.maxValidityBlocks,
          expectedMaxSpreadBps: policy.maxSpreadBps,
          expectedMinimumSources: policy.minimumSources,
          expectedModel: policy.model,
          expectedNetwork: "livenet",
          expectedOracleKeyId: policy.oracleKeyId,
          expectedPublicKey: policy.publicKey,
        },
      );
    } catch (error) {
      return invalid(oracleReasonCode(error), {
        oracleCode: String(error?.code ?? ""),
      });
    }
    const attestation = normalizedVerifiedAttestation(verified);
    if (!attestation) {
      return invalid("work-amo-v6-attestation-result-invalid");
    }
    attestationValidation = {
      attestation,
      oraclePolicy: policy,
      valid: true,
    };
  }
  return {
    attestation: attestationValidation.attestation,
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
      unitFaceUsdCents,
      unitUsdAttestation: attestationValidation.attestation,
      version: WORK_AMO_V6_AUTH_VERSION,
      ...(anchorTxid ? { anchorTxid } : {}),
      ...(anchorSignature ? { anchorSignature } : {}),
    },
    valid: true,
  };
}

export function workAmoV6UnitTerms({
  networkValueBeforeQ8,
  unitFaceUsdCents,
  usdPer100mProofsQ8,
} = {}) {
  const face = canonicalSafeInteger(unitFaceUsdCents, {
    positive: true,
  });
  const priceQuote = positiveBigInt(usdPer100mProofsQ8);
  const networkValue = positiveBigInt(networkValueBeforeQ8);
  if (!WORK_AMO_V6_ALLOWED_FACE_USD_CENTS.includes(face)) {
    return invalid("work-amo-v6-face-unit-invalid");
  }
  if (priceQuote === null) {
    return invalid("work-amo-v6-usd-quote-value-invalid");
  }
  if (networkValue === null) {
    return invalid("work-amo-v6-network-value-before-invalid");
  }
  const targetNumerator =
    BigInt(face) *
    WORK_AMO_V5_PROOFS_PER_QUOTE_UNIT *
    WORK_AMO_V5_USD_QUOTE_Q8_SCALE;
  const targetDenominator = 100n * priceQuote;
  const unitPriceSats = workAmoCeilDiv(
    targetNumerator,
    targetDenominator,
  );
  const unitAmountAtoms = workAmoFloorDiv(
    targetNumerator *
      WORK_AMO_V5_MAX_SUPPLY *
      WORK_AMO_V5_ATOMS_PER_WORK *
      WORK_AMO_V5_NETWORK_VALUE_Q8_SCALE,
    targetDenominator * networkValue,
  );
  const unitMinimumPriceSats = workAmoCeilDiv(
    unitAmountAtoms * networkValue,
    WORK_AMO_V5_MAX_SUPPLY *
      WORK_AMO_V5_ATOMS_PER_WORK *
      WORK_AMO_V5_NETWORK_VALUE_Q8_SCALE,
  );
  if (
    unitPriceSats <= 0n ||
    unitAmountAtoms <= 0n ||
    unitMinimumPriceSats <= 0n
  ) {
    return invalid("work-amo-v6-unit-result-nonpositive");
  }
  if (unitPriceSats < unitMinimumPriceSats) {
    return invalid("work-amo-v6-unit-price-below-minimum");
  }
  return {
    targetDenominator: targetDenominator.toString(),
    targetNumerator: targetNumerator.toString(),
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
    canonicalBlockHashAtHeight,
    listingBondContributionQ8,
    listingPosition,
    networkValueBeforeQ8,
    oraclePolicy,
    spendableAmountAtoms,
    verifyAttestation = verifyWorkUsdAttestation,
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
    {
      canonicalBlockHashAtHeight,
      oraclePolicy,
      requireCanonicalAnchor: true,
      verifyAttestation,
    },
  );
  if (!staticValidation.valid) {
    return staticValidation;
  }
  const attestationValidation =
    validateWorkAmoV6InlineAttestation(
      staticValidation.authorization.unitUsdAttestation,
      {
        canonicalBlockHashAtHeight,
        listingPosition: listing,
        oraclePolicy,
        verifyAttestation,
      },
    );
  if (!attestationValidation.valid) {
    return attestationValidation;
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
    unitFaceUsdCents:
      staticValidation.authorization.unitFaceUsdCents,
    usdPer100mProofsQ8:
      attestationValidation.attestation.usdPer100mProofsQ8,
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
  const attestation = attestationValidation.attestation;
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
      unitFaceUsd:
        staticValidation.authorization.unitFaceUsdCents / 100,
      unitFaceUsdCents:
        staticValidation.authorization.unitFaceUsdCents,
      unitMinimumPriceSats: unit.unitMinimumPriceSats,
      unitPriceSats: unit.unitPriceSats,
      unitUsdAttestationId: attestation.attestationId,
      unitUsdAttestationModel: attestation.model,
      unitUsdAttestationSignature: attestation.signature,
      unitUsdAttestationVersion: attestation.version,
      unitUsdDeclarationTxid: attestation.declarationTxid,
      unitUsdOracleKeyId: attestation.oracleKeyId,
      unitUsdOraclePublicKey: attestation.publicKey,
      unitUsdPer100mProofsQ8: attestation.usdPer100mProofsQ8,
      unitUsdReferenceBlockHash: attestation.referenceBlockHash,
      unitUsdReferenceBlockHeight: attestation.referenceBlockHeight,
      unitUsdSourceSetSha256: attestation.sourceSetSha256,
      unitUsdValidFromHeight: attestation.validFromHeight,
      unitUsdValidThroughHeight: attestation.validThroughHeight,
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
    value.version !== WORK_AMO_V6_AUTH_VERSION ||
    !authorizationModelsValid(value)
  ) {
    return null;
  }
  const unitFaceUsdCents = canonicalSafeInteger(
    value.unitFaceUsdCents,
    { positive: true },
  );
  const unitFaceUsd = canonicalSafeInteger(value.unitFaceUsd, {
    positive: true,
  });
  const listingPosition = normalizeWorkAmoCanonicalPosition({
    blockHash: value.listingBlockHash,
    blockHeight: value.listingBlockHeight,
    blockTransactionIndex: value.listingBlockIndex,
    protocolVout: value.listingProtocolVout,
    recordOrdinal: value.listingRecordOrdinal,
  });
  const referenceBlockHeight = canonicalSafeInteger(
    value.unitUsdReferenceBlockHeight,
    { positive: true },
  );
  const validFromHeight = canonicalSafeInteger(
    value.unitUsdValidFromHeight,
    { positive: true },
  );
  const validThroughHeight = canonicalSafeInteger(
    value.unitUsdValidThroughHeight,
    { positive: true },
  );
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
  const quote = positiveBigInt(value.unitUsdPer100mProofsQ8);
  const referenceBlockHash = normalizedTxid(
    value.unitUsdReferenceBlockHash,
  );
  const declarationTxid = normalizedTxid(
    value.unitUsdDeclarationTxid,
  );
  const oracleKeyId = normalizedLowerText(value.unitUsdOracleKeyId);
  const publicKey = normalizedLowerText(
    value.unitUsdOraclePublicKey,
  );
  const sourceSetSha256 = normalizedLowerText(
    value.unitUsdSourceSetSha256,
  );
  const attestationId = normalizedLowerText(
    value.unitUsdAttestationId,
  );
  const signature = normalizedLowerText(
    value.unitUsdAttestationSignature,
  );
  if (
    !WORK_AMO_V6_ALLOWED_FACE_USD_CENTS.includes(
      unitFaceUsdCents,
    ) ||
    unitFaceUsd !== unitFaceUsdCents / 100 ||
    !listingPosition ||
    referenceBlockHeight === null ||
    validFromHeight !== referenceBlockHeight + 1 ||
    validThroughHeight === null ||
    validThroughHeight < validFromHeight ||
    validThroughHeight - referenceBlockHeight >
      WORK_AMO_V6_MAX_ATTESTATION_VALIDITY_BLOCKS ||
    listingPosition.blockHeight < validFromHeight ||
    listingPosition.blockHeight > validThroughHeight ||
    !referenceBlockHash ||
    !declarationTxid ||
    !HASH_PATTERN.test(oracleKeyId) ||
    !PUBLIC_KEY_PATTERN.test(publicKey) ||
    !HASH_PATTERN.test(sourceSetSha256) ||
    !HASH_PATTERN.test(attestationId) ||
    !SIGNATURE_PATTERN.test(signature) ||
    value.unitUsdAttestationVersion !==
      WORK_AMO_V6_INLINE_ATTESTATION_VERSION ||
    !String(value.unitUsdAttestationModel ?? "").trim() ||
    networkBefore === null ||
    networkAfter === null ||
    bond === null ||
    amount === null ||
    price === null ||
    minimum === null ||
    quote === null ||
    networkAfter !== networkBefore + bond
  ) {
    return null;
  }
  const unit = workAmoV6UnitTerms({
    networkValueBeforeQ8: networkBefore.toString(),
    unitFaceUsdCents,
    usdPer100mProofsQ8: quote.toString(),
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
    unitFaceUsd,
    unitFaceUsdCents,
    unitMinimumPriceSats: minimum.toString(),
    unitPriceSats: price.toString(),
    unitUsdAttestationId: attestationId,
    unitUsdAttestationModel: String(
      value.unitUsdAttestationModel,
    ).trim(),
    unitUsdAttestationSignature: signature,
    unitUsdAttestationVersion:
      WORK_AMO_V6_INLINE_ATTESTATION_VERSION,
    unitUsdDeclarationTxid: declarationTxid,
    unitUsdOracleKeyId: oracleKeyId,
    unitUsdOraclePublicKey: publicKey,
    unitUsdPer100mProofsQ8: quote.toString(),
    unitUsdReferenceBlockHash: referenceBlockHash,
    unitUsdReferenceBlockHeight: referenceBlockHeight,
    unitUsdSourceSetSha256: sourceSetSha256,
    unitUsdValidFromHeight: validFromHeight,
    unitUsdValidThroughHeight: validThroughHeight,
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
      canonicalSafeInteger(authorization.unitFaceUsdCents, {
        positive: true,
      }) !== normalized.unitFaceUsdCents
    ) {
      return invalid(
        "work-amo-v6-frozen-authorization-mismatch",
      );
    }
    const attestation = authorization.unitUsdAttestation;
    if (
      String(attestation?.version ?? "").trim() !==
        normalized.unitUsdAttestationVersion ||
      String(attestation?.model ?? "").trim() !==
        normalized.unitUsdAttestationModel ||
      normalizedLowerText(attestation?.attestationId) !==
        normalized.unitUsdAttestationId ||
      normalizedLowerText(attestation?.oracleKeyId) !==
        normalized.unitUsdOracleKeyId ||
      normalizedLowerText(attestation?.publicKey) !==
        normalized.unitUsdOraclePublicKey ||
      canonicalSafeInteger(attestation?.referenceBlockHeight, {
        positive: true,
      }) !== normalized.unitUsdReferenceBlockHeight ||
      normalizedTxid(attestation?.referenceBlockHash) !==
        normalized.unitUsdReferenceBlockHash ||
      canonicalSafeInteger(attestation?.validFromHeight, {
        positive: true,
      }) !== normalized.unitUsdValidFromHeight ||
      canonicalSafeInteger(attestation?.validThroughHeight, {
        positive: true,
      }) !== normalized.unitUsdValidThroughHeight ||
      normalizedLowerText(attestation?.sourceSetSha256) !==
        normalized.unitUsdSourceSetSha256 ||
      canonicalUnsignedIntegerText(
        attestation?.usdPer100mProofsQ8,
        { positive: true },
      ) !== normalized.unitUsdPer100mProofsQ8 ||
      normalizedLowerText(attestation?.signature) !==
        normalized.unitUsdAttestationSignature ||
      normalizedTxid(attestation?.declarationTxid) !==
        normalized.unitUsdDeclarationTxid
    ) {
      return invalid(
        "work-amo-v6-frozen-attestation-mismatch",
      );
    }
  }
  return { frozenTerms: normalized, valid: true };
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
 * They never select or compare a current USD quote.
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
  const oraclePolicy = normalizeOraclePolicy(value.oraclePolicy);
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
    minimumPaymentSats !== 546 ||
    !oraclePolicy ||
    oraclePolicy.declarationTxid !== txid
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
    oraclePolicy,
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
    oraclePolicy: expected.oraclePolicy,
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
    oraclePolicy: validation.oraclePolicy,
  };
}

export function workAmoV6StatusFromEvidence({
  evidence,
  expectedDeclaration,
  indexedThroughBlock,
  oracleReady = false,
  protocolWritesEnabled = false,
} = {}) {
  const activation = workAmoV6ActivationFromEvidence(evidence, {
    expectedDeclaration,
    indexedThroughBlock,
  });
  const ready = activation.active === true;
  const settlementWritesEnabled =
    ready && protocolWritesEnabled === true;
  const listingWritesEnabled =
    settlementWritesEnabled && oracleReady === true;
  return {
    activation,
    listingWritesEnabled,
    oracleReady: oracleReady === true,
    protocolWritesEnabled: settlementWritesEnabled,
    settlementWritesEnabled,
    reasonCode: listingWritesEnabled
      ? ""
      : activation.active !== true
        ? activation.reasonCode
        : protocolWritesEnabled !== true
          ? "work-amo-v6-writes-paused"
          : "work-amo-v6-oracle-not-ready",
    ready,
    version: WORK_AMO_V6_AUTH_VERSION,
  };
}

export function workAmoV6BroadcastDecision(
  actions,
  {
    canonicalBlockHashAtHeight,
    legacyValidation = null,
    metadata = null,
    network = "livenet",
    verifyAttestation = verifyWorkUsdAttestation,
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
  const oraclePolicy =
    metadata?.activation?.oraclePolicy ??
    metadata?.oraclePolicy;
  if (activationHeight === null || !normalizeOraclePolicy(oraclePolicy)) {
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
            metadata?.reasonCode ?? "work-amo-v6-oracle-not-ready",
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
          {
            canonicalBlockHashAtHeight,
            oraclePolicy,
            requireCanonicalAnchor: true,
            verifyAttestation,
          },
        );
      if (!staticValidation.valid) {
        return {
          allowed: false,
          code: "WORK_AMO_V6_STATIC_AUTHORIZATION_INVALID",
          reasonCode: staticValidation.reasonCode,
          statusCode: 400,
        };
      }
      if (action.expectedConfirmationHeight !== undefined) {
        const expectedConfirmationHeight = canonicalSafeInteger(
          action.expectedConfirmationHeight,
          { positive: true },
        );
        const confirmationValidation =
          expectedConfirmationHeight === null
            ? invalid(
                "work-amo-v6-expected-confirmation-height-invalid",
              )
            : validateWorkAmoV6InlineAttestation(
                staticValidation.authorization
                  .unitUsdAttestation,
                {
                  canonicalBlockHashAtHeight,
                  listingPosition: {
                    blockHash: "00".repeat(32),
                    blockHeight: expectedConfirmationHeight,
                    blockTransactionIndex: 0,
                    protocolVout: 0,
                    recordOrdinal: 0,
                  },
                  oraclePolicy,
                  verifyAttestation,
                },
              );
        if (!confirmationValidation.valid) {
          return {
            allowed: false,
            code: "WORK_AMO_V6_ATTESTATION_NOT_CURRENT",
            reasonCode: confirmationValidation.reasonCode,
            statusCode: 400,
          };
        }
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
