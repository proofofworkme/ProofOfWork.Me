export const WORK_MARKET_V2_AUTH_VERSION = "pwt-sale-v3";
export const WORK_MARKET_V2_ORACLE_MODEL =
  "canonical-work-market-h-minus-one-v1";
export const WORK_MARKET_V2_DECLARATION_TXID =
  "4c53252c6e9279726e1456f4d846274bfa33f778b633d32a68ed36906b38083f";
export const WORK_MARKET_V2_MAX_SUPPLY = 21_000_000n;
export const WORK_MARKET_V2_ATOMS_PER_WORK = 100_000_000n;
export const WORK_MARKET_V2_VALUE_Q8_SCALE = 100_000_000n;

const TXID_PATTERN = /^[0-9a-f]{64}$/u;

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
