import assert from "node:assert/strict";
import {
  WORK_AMO_V6_ALLOWED_FACE_USD_CENTS,
  WORK_AMO_V6_AUTH_VERSION,
  WORK_AMO_V6_BLOCK_SEQUENCER_MODEL,
  WORK_AMO_V6_MODELS,
  calculateWorkAmoV6UnitTerms,
  deriveWorkAmoV6FrozenTerms,
  replayWorkAmoV6CanonicalBlock,
  validateWorkAmoV6DeclarationEvidence,
  validateWorkAmoV6FrozenTerms,
  validateWorkAmoV6InlineAttestation,
  validateWorkAmoV6ListingCutover,
  validateWorkAmoV6SealOrBuyTerms,
  validateWorkAmoV6StaticAuthorization,
  workAmoV6ActivationFromEvidence,
  workAmoV6BroadcastDecision,
  workAmoV6FrozenTermsMatch,
  workAmoV6StatusFromEvidence,
} from "../server/work-amo-v6.mjs";
import {
  WORK_AMO_V5_ATOMS_PER_WORK,
  WORK_AMO_V5_AUTH_VERSION,
  WORK_AMO_V5_DECLARATION_REGISTRY_ADDRESS,
  WORK_AMO_V5_MAX_SUPPLY,
  WORK_AMO_V5_NETWORK_VALUE_Q8_SCALE,
  WORK_AMO_V5_PROOFS_PER_QUOTE_UNIT,
  WORK_AMO_V5_USD_QUOTE_Q8_SCALE,
} from "../server/work-amo-v5.mjs";
import { WORK_TOKEN_ID } from "../server/work-units.mjs";
import {
  WORK_USD_ATTESTATION_MODEL,
  buildSignedWorkUsdAttestation,
  buildWorkUsdConsensus,
  deriveWorkUsdOracleIdentity,
  verifyWorkUsdAttestation,
} from "../server/work-usd-oracle.mjs";
import {
  workAmoV6DeclarationCommitment,
} from "../server/work-amo-v6-declaration.mjs";

const declarationTxid = "11".repeat(32);
const declarationBlockHash = "12".repeat(32);
const referenceBlockHash = "22".repeat(32);
const listingBlockHash = "33".repeat(32);
const actionBlockHash = "44".repeat(32);
const allowedSourceIds = Object.freeze([
  "bitfinex",
  "bitflyer",
  "coinbase",
  "gemini",
  "kraken",
]);
const oraclePrivateKey = "01".repeat(32);
const oracleIdentity = deriveWorkUsdOracleIdentity(oraclePrivateKey);
const oracleKeyId = oracleIdentity.oracleKeyId;
const oraclePublicKey = oracleIdentity.publicKey;
const declarationCommitment =
  workAmoV6DeclarationCommitment({
    oracleKeyId,
    oraclePublicKey,
  });
assert.match(
  declarationCommitment.text,
  /allowedFaceUsdCents=2000,5000,10000/u,
);
assert.match(
  declarationCommitment.text,
  /declarationMinimumRegistryPaymentProofs=546/u,
);
assert.equal(
  declarationCommitment.protocolRecord,
  `pwm1:m:${declarationCommitment.text}`,
);
assert.match(
  declarationCommitment.text,
  /apply each transaction's miner-fee contribution exactly once after all protocol records in that transaction and before the next transaction/u,
);
assert.throws(
  () =>
    workAmoV6DeclarationCommitment({
      oracleKeyId: "ff".repeat(32),
      oraclePublicKey,
    }),
  /does not match/u,
);
const oraclePolicy = Object.freeze({
  allowedSourceIds,
  declarationTxid,
  freshnessWindowMs: 120_000,
  maxSpreadBps: 200,
  maxValidityBlocks: 12,
  minimumSources: 3,
  model: WORK_USD_ATTESTATION_MODEL,
  oracleKeyId,
  publicKey: oraclePublicKey,
});
const referenceBlockHeight = 999_999;
const listingBlockHeight = 1_000_000;
const usdPer100mProofsQ8 = "6000000000000";
const canonicalHashAtHeight = (height) =>
  height === referenceBlockHeight ? referenceBlockHash : "";

const consensus = buildWorkUsdConsensus({
  allowedSourceIds,
  freshnessWindowMs: 120_000,
  issuedAtUnixMs: 1_785_326_400_000,
  maxSpreadBps: 200,
  minimumSources: 3,
  observations: [
    {
      observedAtUnixMs: 1_785_326_399_100,
      sourceId: "bitfinex",
      usdPer100mProofsQ8: "5999000000000",
    },
    {
      observedAtUnixMs: 1_785_326_399_200,
      sourceId: "bitflyer",
      usdPer100mProofsQ8: "6000000000000",
    },
    {
      observedAtUnixMs: 1_785_326_399_300,
      sourceId: "coinbase",
      usdPer100mProofsQ8: "6000000000000",
    },
  ],
});
const attestation = buildSignedWorkUsdAttestation({
  auxRand: Buffer.alloc(32, 7),
  consensus,
  declarationTxid,
  maxValidityBlocks: 12,
  network: "livenet",
  privateKey: oraclePrivateKey,
  referenceBlockHash,
  referenceBlockHeight,
  validFromHeight: listingBlockHeight,
  validThroughHeight: listingBlockHeight + 11,
});
const attestationId = attestation.attestationId;
const fixtureVerifier = verifyWorkUsdAttestation;

function listingPosition(overrides = {}) {
  return {
    blockHash: listingBlockHash,
    blockHeight: listingBlockHeight,
    blockTransactionIndex: 7,
    protocolVout: 1,
    recordOrdinal: 0,
    ...overrides,
  };
}

function authorization(overrides = {}) {
  return {
    ...WORK_AMO_V6_MODELS,
    anchorScriptPubKey: `5120${"ab".repeat(32)}`,
    anchorSigHashType: 0x83,
    anchorType: "sale-ticket-v1",
    anchorValueSats: 546,
    anchorVout: 2,
    buyerAddress: "",
    expiresAt: "",
    network: "livenet",
    nonce: "amo-v6-check",
    registryAddress: WORK_AMO_V5_DECLARATION_REGISTRY_ADDRESS,
    sellerAddress:
      "bc1p0uxp0axptr8rg9dndgtlwxn00j4hq8m88kg80tqd0t6045putwhq5ca7ed",
    sellerPublicKey:
      "0306baa226e3a87a99547df2144f2e6206a4a479a46df41ec1618945c064568237",
    ticker: "WORK",
    tokenId: WORK_TOKEN_ID,
    unitFaceUsdCents: 2_000,
    unitUsdAttestation: structuredClone(attestation),
    version: WORK_AMO_V6_AUTH_VERSION,
    ...overrides,
  };
}

function verifierOptions(overrides = {}) {
  return {
    canonicalBlockHashAtHeight: canonicalHashAtHeight,
    oraclePolicy,
    verifyAttestation: fixtureVerifier,
    ...overrides,
  };
}

assert.deepEqual(
  WORK_AMO_V6_ALLOWED_FACE_USD_CENTS,
  [2_000, 5_000, 10_000],
);
for (const face of WORK_AMO_V6_ALLOWED_FACE_USD_CENTS) {
  assert.equal(
    calculateWorkAmoV6UnitTerms({
      networkValueBeforeQ8:
        21_000_000n * WORK_AMO_V5_NETWORK_VALUE_Q8_SCALE,
      unitFaceUsdCents: face,
      usdPer100mProofsQ8,
    }).valid,
    true,
  );
}
for (const face of [500, 1_000, 20_000]) {
  assert.equal(
    calculateWorkAmoV6UnitTerms({
      networkValueBeforeQ8: "2100000000000000",
      unitFaceUsdCents: face,
      usdPer100mProofsQ8,
    }).reasonCode,
    "work-amo-v6-face-unit-invalid",
  );
}

const formulaInput = {
  networkValueBeforeQ8:
    21_000_000n * WORK_AMO_V5_NETWORK_VALUE_Q8_SCALE,
  unitFaceUsdCents: 2_000,
  usdPer100mProofsQ8,
};
const formula = calculateWorkAmoV6UnitTerms(formulaInput);
const numerator =
  2_000n *
  WORK_AMO_V5_PROOFS_PER_QUOTE_UNIT *
  WORK_AMO_V5_USD_QUOTE_Q8_SCALE;
const denominator = 100n * BigInt(usdPer100mProofsQ8);
const expectedPrice = (numerator + denominator - 1n) / denominator;
const expectedAmount =
  (
    numerator *
    WORK_AMO_V5_MAX_SUPPLY *
    WORK_AMO_V5_ATOMS_PER_WORK *
    WORK_AMO_V5_NETWORK_VALUE_Q8_SCALE
  ) /
  (
    denominator *
    BigInt(formulaInput.networkValueBeforeQ8)
  );
const minimumDenominator =
  WORK_AMO_V5_MAX_SUPPLY *
  WORK_AMO_V5_ATOMS_PER_WORK *
  WORK_AMO_V5_NETWORK_VALUE_Q8_SCALE;
const expectedMinimum =
  (
    expectedAmount *
      BigInt(formulaInput.networkValueBeforeQ8) +
    minimumDenominator -
    1n
  ) /
  minimumDenominator;
assert.equal(formula.valid, true);
assert.equal(formula.unitPriceSats, expectedPrice.toString());
assert.equal(formula.unitAmountAtoms, expectedAmount.toString());
assert.equal(
  formula.unitMinimumPriceSats,
  expectedMinimum.toString(),
);
assert.ok(expectedPrice >= expectedMinimum);

const staticValidation = validateWorkAmoV6StaticAuthorization(
  authorization(),
  verifierOptions(),
);
assert.equal(staticValidation.valid, true);
assert.equal(
  staticValidation.authorization.unitFaceUsdCents,
  2_000,
);
assert.equal(
  validateWorkAmoV6StaticAuthorization(
    authorization({ amountAtoms: "1" }),
    verifierOptions(),
  ).reasonCode,
  "work-amo-v6-derived-fields-not-signable",
);
assert.equal(
  validateWorkAmoV6StaticAuthorization(
    authorization({ uncommittedPriceHint: "1" }),
    verifierOptions(),
  ).reasonCode,
  "work-amo-v6-authorization-shape-invalid",
);
assert.equal(
  validateWorkAmoV6StaticAuthorization(
    authorization({ unitFaceUsdCents: 1_000 }),
    verifierOptions(),
  ).reasonCode,
  "work-amo-v6-face-unit-invalid",
);
assert.equal(
  validateWorkAmoV6StaticAuthorization(
    authorization(),
    verifierOptions({
      oraclePolicy: {
        ...oraclePolicy,
        maxValidityBlocks: 13,
      },
    }),
  ).reasonCode,
  "work-amo-v6-oracle-policy-unavailable",
);

const attestationValidation =
  validateWorkAmoV6InlineAttestation(
    structuredClone(attestation),
    {
      ...verifierOptions(),
      listingPosition: listingPosition(),
    },
  );
assert.equal(attestationValidation.valid, true);
assert.equal(
  attestationValidation.attestation.attestationId,
  attestationId,
);
const tamperedAttestation = structuredClone(attestation);
tamperedAttestation.usdPer100mProofsQ8 =
  (BigInt(usdPer100mProofsQ8) + 1n).toString();
assert.equal(
  validateWorkAmoV6InlineAttestation(tamperedAttestation, {
    ...verifierOptions(),
    listingPosition: listingPosition(),
  }).reasonCode,
  "work-amo-v6-work-usd-consensus",
);
const signatureTamperedAttestation = structuredClone(attestation);
signatureTamperedAttestation.signature =
  `${signatureTamperedAttestation.signature.slice(0, -2)}${
    signatureTamperedAttestation.signature.endsWith("00")
      ? "01"
      : "00"
  }`;
assert.equal(
  validateWorkAmoV6InlineAttestation(
    signatureTamperedAttestation,
    {
      ...verifierOptions(),
      listingPosition: listingPosition(),
    },
  ).reasonCode,
  "work-amo-v6-work-usd-signature",
);
assert.equal(
  validateWorkAmoV6InlineAttestation(attestation, {
    ...verifierOptions({
      canonicalBlockHashAtHeight: () => "aa".repeat(32),
    }),
    listingPosition: listingPosition(),
  }).reasonCode,
  "work-amo-v6-attestation-anchor-noncanonical",
);
assert.equal(
  validateWorkAmoV6InlineAttestation(attestation, {
    ...verifierOptions(),
    listingPosition: listingPosition({
      blockHeight: attestation.validThroughHeight + 1,
    }),
  }).reasonCode,
  "work-amo-v6-work-usd-validity",
);

const networkValueBeforeQ8 =
  21_000_000n * WORK_AMO_V5_NETWORK_VALUE_Q8_SCALE;
const bondContributionQ8 = 546n * WORK_AMO_V5_NETWORK_VALUE_Q8_SCALE;
const frozen = deriveWorkAmoV6FrozenTerms(authorization(), {
  activationHeight: listingBlockHeight,
  ...verifierOptions(),
  listingBondContributionQ8: bondContributionQ8,
  listingPosition: listingPosition(),
  networkValueBeforeQ8,
  spendableAmountAtoms: expectedAmount,
});
assert.equal(frozen.valid, true);
assert.equal(
  frozen.frozenTerms.listingNetworkValueBeforeQ8,
  networkValueBeforeQ8.toString(),
);
assert.equal(
  frozen.frozenTerms.listingNetworkValueAfterQ8,
  (networkValueBeforeQ8 + bondContributionQ8).toString(),
);
assert.equal(
  frozen.frozenTerms.unitUsdAttestationId,
  attestationId,
);
assert.equal(
  frozen.frozenTerms.unitUsdPer100mProofsQ8,
  usdPer100mProofsQ8,
);
assert.equal(
  validateWorkAmoV6ListingCutover({
    activationHeight: listingBlockHeight,
    authorizationVersion: WORK_AMO_V5_AUTH_VERSION,
    listingPosition: listingPosition(),
  }).reasonCode,
  "work-amo-v6-version-required",
);
assert.equal(
  validateWorkAmoV6ListingCutover({
    activationHeight: listingBlockHeight,
    authorizationVersion: WORK_AMO_V5_AUTH_VERSION,
    listingPosition: listingPosition({
      blockHeight: listingBlockHeight - 1,
    }),
  }).historical,
  true,
);
assert.equal(
  validateWorkAmoV6FrozenTerms(frozen.frozenTerms, {
    authorization: authorization(),
    listingBondContributionQ8: bondContributionQ8,
    listingPosition: listingPosition(),
    networkValueBeforeQ8,
  }).valid,
  true,
);

const actionPosition = {
  blockHash: actionBlockHash,
  blockHeight: listingBlockHeight + 100,
  blockTransactionIndex: 1,
  protocolVout: 1,
  recordOrdinal: 0,
};
assert.equal(
  validateWorkAmoV6SealOrBuyTerms({
    actionPosition,
    activationHeight: listingBlockHeight,
    listingAuthorization: authorization(),
    listingFrozenTerms: frozen.frozenTerms,
    listingPosition: listingPosition(),
    referencesListingFrozenTerms: true,
  }).valid,
  true,
);
assert.equal(
  validateWorkAmoV6SealOrBuyTerms({
    actionFrozenTerms: structuredClone(frozen.frozenTerms),
    actionPosition,
    activationHeight: listingBlockHeight,
    listingAuthorization: authorization(),
    listingFrozenTerms: frozen.frozenTerms,
    listingPosition: listingPosition(),
  }).valid,
  true,
);
const tamperedFrozen = structuredClone(frozen.frozenTerms);
tamperedFrozen.unitPriceSats = (
  BigInt(tamperedFrozen.unitPriceSats) + 1n
).toString();
assert.equal(
  validateWorkAmoV6FrozenTerms(tamperedFrozen).reasonCode,
  "work-amo-v6-frozen-terms-invalid",
);
assert.equal(
  workAmoV6FrozenTermsMatch(
    frozen.frozenTerms,
    tamperedFrozen,
  ),
  false,
);
const identityTamperedFrozen = structuredClone(frozen.frozenTerms);
identityTamperedFrozen.unitUsdValidThroughHeight -= 1;
assert.equal(
  validateWorkAmoV6FrozenTerms(identityTamperedFrozen, {
    authorization: authorization(),
  }).reasonCode,
  "work-amo-v6-frozen-attestation-mismatch",
);

const legacyListingPosition = listingPosition({
  blockHeight: listingBlockHeight - 1,
});
const legacyActionAuthorization = {
  version: WORK_AMO_V5_AUTH_VERSION,
};
let observedLegacyActionAuthorization = null;
assert.equal(
  validateWorkAmoV6SealOrBuyTerms({
    actionAuthorization: legacyActionAuthorization,
    actionPosition,
    activationHeight: listingBlockHeight,
    legacyValidation: ({ actionAuthorization }) => {
      observedLegacyActionAuthorization = actionAuthorization;
      return {
        frozenTerms: { historical: true },
        valid: true,
      };
    },
    listingAuthorization: { version: "pwt-sale-v4" },
    listingFrozenTerms: {
      authorizationVersion: "pwt-sale-v4",
      listingBlockHash: legacyListingPosition.blockHash,
      listingBlockHeight: legacyListingPosition.blockHeight,
      listingBlockIndex:
        legacyListingPosition.blockTransactionIndex,
      listingProtocolVout: legacyListingPosition.protocolVout,
      listingRecordOrdinal: legacyListingPosition.recordOrdinal,
    },
    listingPosition: legacyListingPosition,
    referencesListingFrozenTerms: true,
  }).valid,
  true,
);
assert.equal(
  observedLegacyActionAuthorization,
  legacyActionAuthorization,
  "the historical V4 validator must receive the signed settlement authorization",
);
assert.equal(
  validateWorkAmoV6SealOrBuyTerms({
    actionPosition,
    activationHeight: listingBlockHeight,
    legacyValidation: () => ({
      frozenTerms: { historical: true },
      valid: true,
    }),
    listingAuthorization: { version: "pwt-sale-v4" },
    listingFrozenTerms: {
      authorizationVersion: "pwt-sale-v4",
      listingBlockHash,
      listingBlockHeight,
      listingBlockIndex: 7,
      listingProtocolVout: 1,
      listingRecordOrdinal: 0,
    },
    listingPosition: listingPosition(),
    referencesListingFrozenTerms: true,
  }).reasonCode,
  "work-amo-v6-legacy-reference-invalid",
);

const sequencedBlockHeight = listingBlockHeight + 200;
const sequencedBlockHash = "aa".repeat(32);
const sequencedRecords = [
  {
    bondQ8: "300",
    position: {
      blockHash: sequencedBlockHash,
      blockHeight: sequencedBlockHeight,
      blockTransactionIndex: 3,
      protocolVout: 1,
      recordOrdinal: 0,
    },
    transactionMinerFeeSats: "0",
    transactionProtocolRecordCount: 1,
    txid: "03".repeat(32),
  },
  {
    bondQ8: "200",
    position: {
      blockHash: sequencedBlockHash,
      blockHeight: sequencedBlockHeight,
      blockTransactionIndex: 2,
      protocolVout: 1,
      recordOrdinal: 0,
    },
    transactionMinerFeeSats: "0",
    transactionProtocolRecordCount: 1,
    txid: "02".repeat(32),
  },
  {
    bondQ8: "100",
    position: {
      blockHash: sequencedBlockHash,
      blockHeight: sequencedBlockHeight,
      blockTransactionIndex: 1,
      protocolVout: 1,
      recordOrdinal: 0,
    },
    transactionMinerFeeSats: "0",
    transactionProtocolRecordCount: 1,
    txid: "01".repeat(32),
  },
];
const sequence = replayWorkAmoV6CanonicalBlock({
  activationHeight: listingBlockHeight,
  applyTransactionFee: ({ state }) => ({ state }),
  blockHash: sequencedBlockHash,
  blockHeight: sequencedBlockHeight,
  evaluateRecord: ({ entry, networkValueBeforeQ8, state }) => ({
    output: {
      networkValueBeforeQ8: networkValueBeforeQ8.toString(),
    },
    state: {
      ...state,
      networkValueQ8:
        BigInt(state.networkValueQ8) + BigInt(entry.bondQ8),
    },
    valid: true,
  }),
  openingState: { networkValueQ8: 1_000n },
  records: sequencedRecords,
  valueFromState: (state) => state.networkValueQ8,
});
assert.equal(sequence.model, WORK_AMO_V6_BLOCK_SEQUENCER_MODEL);
assert.deepEqual(
  sequence.traces
    .filter((trace) => trace.kind === "protocol-record")
    .map((trace) => trace.txid),
  ["01".repeat(32), "02".repeat(32), "03".repeat(32)],
);
assert.deepEqual(
  sequence.traces
    .filter((trace) => trace.kind === "protocol-record")
    .map((trace) => trace.networkValueBeforeQ8),
  ["1000", "1100", "1300"],
);
assert.equal(sequence.closingNetworkValueQ8, "1600");
const intraTransactionTxid = "06".repeat(32);
const intraTransaction = replayWorkAmoV6CanonicalBlock({
  activationHeight: listingBlockHeight,
  applyTransactionFee: ({ state }) => ({ state }),
  blockHash: sequencedBlockHash,
  blockHeight: sequencedBlockHeight,
  evaluateRecord: ({ entry, state }) => ({
    output: { marker: entry.marker },
    state: {
      ...state,
      networkValueQ8:
        BigInt(state.networkValueQ8) + BigInt(entry.bondQ8),
    },
    valid: true,
  }),
  openingState: { networkValueQ8: 10n },
  records: [
    {
      bondQ8: "4",
      marker: "vout-2-ordinal-0",
      position: {
        blockHash: sequencedBlockHash,
        blockHeight: sequencedBlockHeight,
        blockTransactionIndex: 6,
        protocolVout: 2,
        recordOrdinal: 0,
      },
      transactionMinerFeeSats: "0",
      transactionProtocolRecordCount: 3,
      txid: intraTransactionTxid,
    },
    {
      bondQ8: "3",
      marker: "vout-1-ordinal-1",
      position: {
        blockHash: sequencedBlockHash,
        blockHeight: sequencedBlockHeight,
        blockTransactionIndex: 6,
        protocolVout: 1,
        recordOrdinal: 1,
      },
      transactionMinerFeeSats: "0",
      transactionProtocolRecordCount: 3,
      txid: intraTransactionTxid,
    },
    {
      bondQ8: "2",
      marker: "vout-1-ordinal-0",
      position: {
        blockHash: sequencedBlockHash,
        blockHeight: sequencedBlockHeight,
        blockTransactionIndex: 6,
        protocolVout: 1,
        recordOrdinal: 0,
      },
      transactionMinerFeeSats: "0",
      transactionProtocolRecordCount: 3,
      txid: intraTransactionTxid,
    },
  ],
  valueFromState: (state) => state.networkValueQ8,
});
assert.deepEqual(
  intraTransaction.traces
    .filter((trace) => trace.kind === "protocol-record")
    .map((trace) => trace.output.marker),
  [
    "vout-1-ordinal-0",
    "vout-1-ordinal-1",
    "vout-2-ordinal-0",
  ],
);
assert.deepEqual(
  intraTransaction.traces
    .filter((trace) => trace.kind === "protocol-record")
    .map((trace) => trace.networkValueBeforeQ8),
  ["10", "12", "15"],
);
assert.throws(
  () =>
    replayWorkAmoV6CanonicalBlock({
      activationHeight: sequencedBlockHeight + 1,
      applyTransactionFee: ({ state }) => ({ state }),
      blockHash: sequencedBlockHash,
      blockHeight: sequencedBlockHeight,
      evaluateRecord: () => ({ valid: false }),
      openingState: { networkValueQ8: 1_000n },
      records: [],
      valueFromState: (state) => state.networkValueQ8,
    }),
  { code: "work-amo-v6-sequencer-before-activation" },
);

const expectedDeclaration = {
  activationHeight: listingBlockHeight,
  authorityScriptPubKey: `76a914${"cd".repeat(20)}88ac`,
  blockHash: declarationBlockHash,
  blockHeight: listingBlockHeight - 1,
  blockTransactionIndex: 5,
  minimumPaymentSats: 546,
  oraclePolicy,
  payloadBytes: 12_345,
  payloadSha256: "de".repeat(32),
  protocolVout: 3,
  recordOrdinal: 0,
  registryAddress: WORK_AMO_V5_DECLARATION_REGISTRY_ADDRESS,
  registryPaymentVout: 4,
  txid: declarationTxid,
};
const declarationEvidence = {
  activationHeight: listingBlockHeight,
  authorityScriptPubKey: expectedDeclaration.authorityScriptPubKey,
  blockHash: declarationBlockHash,
  blockHeight: listingBlockHeight - 1,
  blockTransactionIndex: 5,
  canonical: true,
  confirmed: true,
  evidenceComplete: true,
  minimumPaymentSats: 546,
  payloadBytes: 12_345,
  payloadSha256: expectedDeclaration.payloadSha256,
  protocolVout: 3,
  recordOrdinal: 0,
  registryAddress: WORK_AMO_V5_DECLARATION_REGISTRY_ADDRESS,
  registryPaymentVout: 4,
  txid: declarationTxid,
};
assert.equal(
  validateWorkAmoV6DeclarationEvidence(declarationEvidence, {
    expectedDeclaration,
  }).valid,
  true,
);
assert.equal(
  validateWorkAmoV6DeclarationEvidence(
    { ...declarationEvidence, payloadBytes: 12_346 },
    { expectedDeclaration },
  ).reasonCode,
  "work-amo-v6-declaration-evidence-mismatch",
);
const activation = workAmoV6ActivationFromEvidence(
  declarationEvidence,
  {
    expectedDeclaration,
    indexedThroughBlock: listingBlockHeight,
  },
);
assert.equal(activation.active, true);
const status = workAmoV6StatusFromEvidence({
  evidence: declarationEvidence,
  expectedDeclaration,
  indexedThroughBlock: listingBlockHeight,
  oracleReady: true,
  protocolWritesEnabled: true,
});
assert.equal(status.protocolWritesEnabled, true);
const oracleOutageStatus = workAmoV6StatusFromEvidence({
  evidence: declarationEvidence,
  expectedDeclaration,
  indexedThroughBlock: listingBlockHeight,
  oracleReady: false,
  protocolWritesEnabled: true,
});
assert.equal(oracleOutageStatus.protocolWritesEnabled, true);
assert.equal(oracleOutageStatus.settlementWritesEnabled, true);
assert.equal(oracleOutageStatus.listingWritesEnabled, false);

const commonBroadcastAction = {
  canonicalParsed: true,
  paysWorkRegistry: true,
  registryAddress: WORK_AMO_V5_DECLARATION_REGISTRY_ADDRESS,
  signedShapeValid: true,
  ticker: "WORK",
  tokenId: WORK_TOKEN_ID,
  tokenProtocolMessageCount: 1,
};
assert.equal(
  workAmoV6BroadcastDecision(
    [
      {
        ...commonBroadcastAction,
        action: "list5",
        authVersion: WORK_AMO_V5_AUTH_VERSION,
        saleAuthorization: {
          version: WORK_AMO_V5_AUTH_VERSION,
        },
      },
    ],
    {
      canonicalBlockHashAtHeight: canonicalHashAtHeight,
      metadata: status,
      verifyAttestation: fixtureVerifier,
    },
  ).code,
  "WORK_AMO_V6_REQUIRED",
);
assert.equal(
  workAmoV6BroadcastDecision(
    [
      {
        ...commonBroadcastAction,
        action: "list5",
        authVersion: WORK_AMO_V6_AUTH_VERSION,
        saleAuthorization: authorization(),
      },
    ],
    {
      canonicalBlockHashAtHeight: canonicalHashAtHeight,
      metadata: status,
      verifyAttestation: fixtureVerifier,
    },
  ).allowed,
  true,
);
assert.equal(
  workAmoV6BroadcastDecision(
    [
      {
        ...commonBroadcastAction,
        action: "seal5",
        actionPosition,
        listingAuthorization: authorization(),
        listingFrozenTerms: frozen.frozenTerms,
        listingPosition: listingPosition(),
        referencesListingFrozenTerms: true,
      },
    ],
    {
      metadata: oracleOutageStatus,
    },
  ).allowed,
  true,
  "a current oracle outage must not block settlement of frozen listings",
);
assert.equal(
  workAmoV6BroadcastDecision(
    [
      {
        ...commonBroadcastAction,
        action: "list5",
        authVersion: WORK_AMO_V6_AUTH_VERSION,
        saleAuthorization: authorization(),
      },
    ],
    {
      canonicalBlockHashAtHeight: canonicalHashAtHeight,
      metadata: oracleOutageStatus,
      verifyAttestation: fixtureVerifier,
    },
  ).code,
  "WORK_AMO_V6_WRITES_PAUSED",
);
assert.equal(
  workAmoV6BroadcastDecision(
    [
      {
        ...commonBroadcastAction,
        action: "seal5",
        actionPosition,
        listingAuthorization: authorization(),
        listingFrozenTerms: frozen.frozenTerms,
        listingPosition: listingPosition(),
        referencesListingFrozenTerms: true,
      },
    ],
    {
      metadata: status,
    },
  ).allowed,
  true,
);

console.log(
  JSON.stringify(
    {
      activationEvidence: "exact-and-fail-closed",
      allowedFacesUsdCents: WORK_AMO_V6_ALLOWED_FACE_USD_CENTS,
      attestation: "inline-signed-canonical-anchor",
      formula: "integer-q8-identical-to-v5",
      legacySettlement: "pre-v6-only",
      listingNBefore: frozen.frozenTerms.listingNetworkValueBeforeQ8,
      ordering:
        "block-height,transaction-index,protocol-vout,record-ordinal",
      settlement: "frozen-no-current-quote",
      status: "ok",
      version: WORK_AMO_V6_AUTH_VERSION,
    },
    null,
    2,
  ),
);
