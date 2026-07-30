import assert from "node:assert/strict";
import {
  canonicalRawProtocolRecordSetFromTransaction,
} from "../server/canonical-op-return.mjs";
import {
  WORK_AMO_V6_ALLOWED_FACE_PROOFS,
  WORK_AMO_V6_AUTH_VERSION,
  WORK_AMO_V6_BLOCK_SEQUENCER_MODEL,
  WORK_AMO_V6_MODELS,
  calculateWorkAmoV6UnitTerms,
  deriveWorkAmoV6FrozenTerms,
  replayWorkAmoV6CanonicalBlock,
  validateWorkAmoV6DeclarationEvidence,
  validateWorkAmoV6FrozenTerms,
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
  WORK_AMO_V5_DECLARATION_AUTHORITY_SCRIPT_PUBKEY,
  WORK_AMO_V5_DECLARATION_REGISTRY_ADDRESS,
  WORK_AMO_V5_MAX_SUPPLY,
  WORK_AMO_V5_NETWORK_VALUE_Q8_SCALE,
} from "../server/work-amo-v5.mjs";
import { WORK_TOKEN_ID } from "../server/work-units.mjs";
import {
  workAmoV6DeclarationCommitment,
} from "../server/work-amo-v6-declaration.mjs";
import {
  coreWorkAmoV6DeclarationEvidence,
  exactWorkAmoV6DeclarationEvidence,
  indexedWorkAmoV6DeclarationEvidence,
} from "./migrate-work-amo-v6.mjs";

const declarationTxid = "11".repeat(32);
const declarationBlockHash = "12".repeat(32);
const listingBlockHash = "33".repeat(32);
const actionBlockHash = "44".repeat(32);
const listingBlockHeight = 1_000_000;
const supplyAtoms =
  WORK_AMO_V5_MAX_SUPPLY * WORK_AMO_V5_ATOMS_PER_WORK;
const formulaDenominator =
  supplyAtoms * WORK_AMO_V5_NETWORK_VALUE_Q8_SCALE;

const declarationCommitment = workAmoV6DeclarationCommitment();
assert.match(
  declarationCommitment.text,
  /allowedFaceProofs=20000,50000,100000/u,
);
assert.match(
  declarationCommitment.text,
  /unitPriceProofs=F;unitAmountAtoms=floor\(F\*S\*A\*Q\/N\);unitMinimumPriceProofs=ceil\(unitAmountAtoms\*N\/\(S\*A\*Q\)\)/u,
);
assert.match(
  declarationCommitment.text,
  /declarationMinimumRegistryPaymentProofs=546/u,
);
assert.match(
  declarationCommitment.text,
  /apply each transaction's miner-fee contribution exactly once after all protocol records in that transaction and before the next transaction/u,
);
assert.doesNotMatch(
  declarationCommitment.text,
  /USD|attestation|oraclePublicKey|oracleKeyId|oracleSources/u,
);
assert.equal(
  declarationCommitment.protocolRecord,
  `pwm1:m:${declarationCommitment.text}`,
);

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
    nonce: "amo-v6-proof-native-check",
    registryAddress: WORK_AMO_V5_DECLARATION_REGISTRY_ADDRESS,
    sellerAddress:
      "bc1p0uxp0axptr8rg9dndgtlwxn00j4hq8m88kg80tqd0t6045putwhq5ca7ed",
    sellerPublicKey:
      "0306baa226e3a87a99547df2144f2e6206a4a479a46df41ec1618945c064568237",
    ticker: "WORK",
    tokenId: WORK_TOKEN_ID,
    unitFaceProofs: 20_000,
    version: WORK_AMO_V6_AUTH_VERSION,
    ...overrides,
  };
}

assert.deepEqual(
  WORK_AMO_V6_ALLOWED_FACE_PROOFS,
  [20_000, 50_000, 100_000],
);
for (const face of WORK_AMO_V6_ALLOWED_FACE_PROOFS) {
  const terms = calculateWorkAmoV6UnitTerms({
    networkValueBeforeQ8:
      WORK_AMO_V5_MAX_SUPPLY *
      WORK_AMO_V5_NETWORK_VALUE_Q8_SCALE,
    unitFaceProofs: face,
  });
  assert.equal(terms.valid, true);
  assert.equal(terms.unitPriceSats, String(face));
  assert.equal(
    terms.unitAmountAtoms,
    (BigInt(face) * WORK_AMO_V5_ATOMS_PER_WORK).toString(),
  );
  assert.equal(terms.unitMinimumPriceSats, String(face));
}
for (const face of [2_000, 5_000, 10_000, 200_000]) {
  assert.equal(
    calculateWorkAmoV6UnitTerms({
      networkValueBeforeQ8:
        WORK_AMO_V5_MAX_SUPPLY *
        WORK_AMO_V5_NETWORK_VALUE_Q8_SCALE,
      unitFaceProofs: face,
    }).reasonCode,
    "work-amo-v6-face-unit-invalid",
  );
}

const roundingNetworkValue =
  WORK_AMO_V5_MAX_SUPPLY *
    WORK_AMO_V5_NETWORK_VALUE_Q8_SCALE +
  1n;
const roundingTerms = calculateWorkAmoV6UnitTerms({
  networkValueBeforeQ8: roundingNetworkValue,
  unitFaceProofs: 20_000,
});
assert.equal(roundingTerms.valid, true);
assert.equal(roundingTerms.unitPriceSats, "20000");
assert.ok(
  BigInt(roundingTerms.unitMinimumPriceSats) <=
    BigInt(roundingTerms.unitPriceSats),
);
assert.equal(
  BigInt(roundingTerms.unitAmountAtoms),
  (20_000n * formulaDenominator) / roundingNetworkValue,
);
assert.equal(
  calculateWorkAmoV6UnitTerms({
    networkValueBeforeQ8:
      20_000n * formulaDenominator + 1n,
    unitFaceProofs: 20_000,
  }).reasonCode,
  "work-amo-v6-unit-result-nonpositive",
);
assert.equal(
  calculateWorkAmoV6UnitTerms({
    networkValueBeforeQ8:
      20_000n * WORK_AMO_V5_NETWORK_VALUE_Q8_SCALE - 1n,
    unitFaceProofs: 20_000,
  }).reasonCode,
  "work-amo-v6-unit-amount-exceeds-supply",
);
assert.equal(
  calculateWorkAmoV6UnitTerms({
    networkValueBeforeQ8: "0",
    unitFaceProofs: 20_000,
  }).reasonCode,
  "work-amo-v6-network-value-before-invalid",
);

const staticValidation =
  validateWorkAmoV6StaticAuthorization(authorization());
assert.equal(staticValidation.valid, true);
assert.equal(staticValidation.authorization.unitFaceProofs, 20_000);
assert.equal(
  validateWorkAmoV6StaticAuthorization(
    authorization({ amountAtoms: "1" }),
  ).reasonCode,
  "work-amo-v6-derived-fields-not-signable",
);
assert.equal(
  validateWorkAmoV6StaticAuthorization(
    authorization({ unitFaceUsdCents: 2_000 }),
  ).reasonCode,
  "work-amo-v6-derived-fields-not-signable",
);
assert.equal(
  validateWorkAmoV6StaticAuthorization(
    authorization({ unitUsdAttestation: {} }),
  ).reasonCode,
  "work-amo-v6-derived-fields-not-signable",
);
assert.equal(
  validateWorkAmoV6StaticAuthorization(
    authorization({ uncommittedPriceHint: "1" }),
  ).reasonCode,
  "work-amo-v6-authorization-shape-invalid",
);
assert.equal(
  validateWorkAmoV6StaticAuthorization(
    authorization({ unitFaceProofs: 10_000 }),
  ).reasonCode,
  "work-amo-v6-face-unit-invalid",
);

const networkValueBeforeQ8 =
  WORK_AMO_V5_MAX_SUPPLY *
  WORK_AMO_V5_NETWORK_VALUE_Q8_SCALE;
const bondContributionQ8 =
  546n * WORK_AMO_V5_NETWORK_VALUE_Q8_SCALE;
const expectedAmount = 20_000n * WORK_AMO_V5_ATOMS_PER_WORK;
const frozen = deriveWorkAmoV6FrozenTerms(authorization(), {
  activationHeight: listingBlockHeight,
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
assert.equal(frozen.frozenTerms.unitFaceProofs, 20_000);
assert.equal(frozen.frozenTerms.unitPriceSats, "20000");
assert.equal(frozen.frozenTerms.unitAmountAtoms, expectedAmount.toString());
assert.equal(
  deriveWorkAmoV6FrozenTerms(authorization(), {
    activationHeight: listingBlockHeight,
    listingBondContributionQ8: bondContributionQ8,
    listingPosition: listingPosition(),
    networkValueBeforeQ8,
    spendableAmountAtoms: expectedAmount - 1n,
  }).reasonCode,
  "work-amo-v6-insufficient-spendable-balance",
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

const tamperedFrozen = structuredClone(frozen.frozenTerms);
tamperedFrozen.unitPriceSats = "20001";
assert.equal(
  validateWorkAmoV6FrozenTerms(tamperedFrozen).reasonCode,
  "work-amo-v6-frozen-terms-invalid",
);
assert.equal(
  workAmoV6FrozenTermsMatch(frozen.frozenTerms, tamperedFrozen),
  false,
);
const faceTamperedFrozen = structuredClone(frozen.frozenTerms);
faceTamperedFrozen.unitFaceProofs = 50_000;
assert.equal(
  validateWorkAmoV6FrozenTerms(faceTamperedFrozen).reasonCode,
  "work-amo-v6-frozen-terms-invalid",
);
assert.equal(
  validateWorkAmoV6FrozenTerms({
    ...structuredClone(frozen.frozenTerms),
    unitUsdAttestationId: "ff".repeat(32),
  }).reasonCode,
  "work-amo-v6-frozen-terms-invalid",
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
  validateWorkAmoV6ListingCutover({
    activationHeight: listingBlockHeight,
    authorizationVersion: WORK_AMO_V6_AUTH_VERSION,
    listingPosition: listingPosition({
      blockHeight: listingBlockHeight - 1,
    }),
  }).reasonCode,
  "work-amo-v6-listing-before-activation",
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
      listingBlockIndex: legacyListingPosition.blockTransactionIndex,
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
const sequence = replayWorkAmoV6CanonicalBlock({
  activationHeight: listingBlockHeight,
  applyTransactionFee: ({ state, transaction }) => ({
    state: {
      ...state,
      networkValueQ8:
        BigInt(state.networkValueQ8) +
        BigInt(transaction.transactionMinerFeeSats),
    },
  }),
  blockHash: sequencedBlockHash,
  blockHeight: sequencedBlockHeight,
  evaluateRecord: ({ entry, networkValueBeforeQ8, state }) => ({
    output: {
      marker: entry.marker,
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
  records: [
    {
      bondQ8: "300",
      marker: "tx-3",
      position: {
        blockHash: sequencedBlockHash,
        blockHeight: sequencedBlockHeight,
        blockTransactionIndex: 3,
        protocolVout: 1,
        recordOrdinal: 0,
      },
      transactionMinerFeeSats: "3",
      transactionProtocolRecordCount: 1,
      txid: "03".repeat(32),
    },
    {
      bondQ8: "200",
      marker: "tx-2",
      position: {
        blockHash: sequencedBlockHash,
        blockHeight: sequencedBlockHeight,
        blockTransactionIndex: 2,
        protocolVout: 1,
        recordOrdinal: 0,
      },
      transactionMinerFeeSats: "2",
      transactionProtocolRecordCount: 1,
      txid: "02".repeat(32),
    },
    {
      bondQ8: "100",
      marker: "tx-1",
      position: {
        blockHash: sequencedBlockHash,
        blockHeight: sequencedBlockHeight,
        blockTransactionIndex: 1,
        protocolVout: 1,
        recordOrdinal: 0,
      },
      transactionMinerFeeSats: "1",
      transactionProtocolRecordCount: 1,
      txid: "01".repeat(32),
    },
  ],
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
  ["1000", "1101", "1303"],
);
assert.equal(sequence.closingNetworkValueQ8, "1606");
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
  payloadBytes: declarationCommitment.protocolRecordBytes,
  payloadSha256: declarationCommitment.protocolRecordSha256,
  protocolVout: 3,
  recordOrdinal: 0,
  registryAddress: WORK_AMO_V5_DECLARATION_REGISTRY_ADDRESS,
  registryPaymentVout: 4,
  txid: declarationTxid,
};
const declarationEvidence = {
  ...expectedDeclaration,
  canonical: true,
  confirmed: true,
  evidenceComplete: true,
};
assert.equal(
  validateWorkAmoV6DeclarationEvidence(declarationEvidence, {
    expectedDeclaration,
  }).valid,
  true,
);
assert.equal(
  validateWorkAmoV6DeclarationEvidence(
    { ...declarationEvidence, payloadBytes: 1 },
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
assert.equal(Object.hasOwn(activation, "oraclePolicy"), false);
const status = workAmoV6StatusFromEvidence({
  evidence: declarationEvidence,
  expectedDeclaration,
  indexedThroughBlock: listingBlockHeight,
  protocolWritesEnabled: true,
});
assert.equal(status.protocolWritesEnabled, true);
assert.equal(status.listingWritesEnabled, true);
assert.equal(status.settlementWritesEnabled, true);
assert.equal(Object.hasOwn(status, "oracleReady"), false);

function opReturnOutput(text) {
  const payload = Buffer.from(text, "utf8");
  let push;
  if (payload.length <= 0x4b) {
    push = Buffer.from([payload.length]);
  } else if (payload.length <= 0xff) {
    push = Buffer.from([0x4c, payload.length]);
  } else if (payload.length <= 0xffff) {
    push = Buffer.alloc(3);
    push[0] = 0x4d;
    push.writeUInt16LE(payload.length, 1);
  } else {
    throw new Error("test OP_RETURN payload is too large");
  }
  return {
    value: 0,
    scriptPubKey: {
      hex: Buffer.concat([
        Buffer.from([0x6a]),
        push,
        payload,
      ]).toString("hex"),
    },
  };
}

const declarationCarrierPayload = Buffer.from(
  declarationCommitment.protocolRecord,
  "utf8",
);
const declarationAuthorityAddress =
  "1F1p9UEHuH5KTFR7Zsx93Khdrqhj6t5nFv";
const declarationCarrierPins = {
  activationHeight: listingBlockHeight,
  declarationBlockHash,
  declarationBlockIndex: 5,
  declarationHeight: listingBlockHeight - 1,
  declarationMemoBytes: declarationCommitment.protocolRecordBytes,
  declarationMemoSha256: declarationCommitment.protocolRecordSha256,
  declarationProtocolRecord: declarationCommitment.protocolRecord,
  declarationProtocolVout: 3,
  declarationRecordOrdinal: 0,
  declarationRegistryPaymentVout: 4,
  declarationTxid,
};
const declarationCarrierTx = {
  txid: declarationTxid,
  vin: [
    {
      prevout: {
        scriptPubKey: {
          hex: WORK_AMO_V5_DECLARATION_AUTHORITY_SCRIPT_PUBKEY,
        },
      },
    },
  ],
  vout: [
    {
      value: 0.00000546,
      scriptPubKey: {
        address: declarationAuthorityAddress,
      },
    },
    opReturnOutput("pwm1:s:VjYgZGVjbGFyYXRpb24"),
    opReturnOutput(
      `pwm1:r:${"b5".repeat(32)}`,
    ),
    opReturnOutput(declarationCommitment.protocolRecord),
    {
      value: 0.00000546,
      scriptPubKey: {
        address: WORK_AMO_V5_DECLARATION_REGISTRY_ADDRESS,
      },
    },
    opReturnOutput(
      `pwt1:send2:${WORK_TOKEN_ID}:1:${
        declarationAuthorityAddress
      }`,
    ),
  ],
};
function declarationCarrierRpc(
  tx = declarationCarrierTx,
  canonicalHash = declarationBlockHash,
) {
  return async (method) => {
    if (method === "getblockhash") {
      return canonicalHash;
    }
    if (method === "getblock") {
      return {
        hash: declarationBlockHash,
        height: declarationCarrierPins.declarationHeight,
        tx: [
          "01".repeat(32),
          "02".repeat(32),
          "03".repeat(32),
          "04".repeat(32),
          "05".repeat(32),
          tx,
        ],
      };
    }
    throw new Error(`unexpected test RPC method: ${method}`);
  };
}
function declarationCarrierIndexRow(overrides = {}) {
  return {
    authority_scriptpubkey:
      WORK_AMO_V5_DECLARATION_AUTHORITY_SCRIPT_PUBKEY,
    block_hash: declarationBlockHash,
    block_height: declarationCarrierPins.declarationHeight,
    block_index: declarationCarrierPins.declarationBlockIndex,
    data_bytes: declarationCarrierPayload.length,
    input_count: 1,
    output_count: declarationCarrierTx.vout.length,
    payload_hex: declarationCarrierPayload.toString("hex"),
    payload_text: declarationCommitment.protocolRecord,
    protocol: "pwm1",
    raw_carrier_count: 1,
    registry_address: WORK_AMO_V5_DECLARATION_REGISTRY_ADDRESS,
    registry_output_count: 1,
    registry_payment_sats: "546",
    status: "confirmed",
    txid: declarationTxid,
    ...overrides,
  };
}
async function indexedCarrierEvidence(row, pins = declarationCarrierPins) {
  let observedSql = "";
  let observedParams = null;
  const evidence = await indexedWorkAmoV6DeclarationEvidence(
    {
      query: async (sql, params) => {
        observedSql = sql;
        observedParams = params;
        return { rows: [row] };
      },
    },
    pins,
  );
  assert.match(
    observedSql,
    /FROM proof_indexer\.op_returns declaration_carrier/u,
  );
  assert.doesNotMatch(
    observedSql,
    /FROM proof_indexer\.events/u,
  );
  assert.deepEqual(observedParams, [
    pins.declarationTxid,
    pins.declarationHeight,
    pins.declarationBlockHash,
    pins.declarationBlockIndex,
    pins.declarationProtocolVout,
    pins.declarationRecordOrdinal,
    pins.declarationRegistryPaymentVout,
  ]);
  return evidence;
}

const indexedCarrier = await indexedCarrierEvidence(
  declarationCarrierIndexRow(),
);
const canonicalCarrierRecords =
  canonicalRawProtocolRecordSetFromTransaction(
    declarationCarrierTx,
  ).records;
const canonicalMail = canonicalCarrierRecords.find(
  (record) => record.protocol === "pwm1",
);
assert.equal(canonicalMail.protocolVout, 1);
assert.equal(canonicalMail.recordOrdinal, 0);
assert.deepEqual(
  canonicalMail.rawRecordParts.map((part) => part.protocolVout),
  [1, 2, 3],
);
assert.equal(canonicalMail.rawDecodeValid, true);
assert.deepEqual(
  canonicalCarrierRecords
    .filter((record) => record.protocol !== "pwm1")
    .map((record) => [record.protocol, record.protocolVout]),
  [["pwt1", 5]],
);
const coreCarrier = await coreWorkAmoV6DeclarationEvidence(
  declarationCarrierPins,
  declarationCarrierRpc(),
);
assert.equal(indexedCarrier.protocolVout, 3);
assert.equal(indexedCarrier.recordOrdinal, 0);
assert.equal(
  indexedCarrier.payloadSha256,
  declarationCommitment.protocolRecordSha256,
);
assert.equal(coreCarrier.protocolVout, 3);
assert.equal(coreCarrier.outputCount, 6);
assert.equal(
  exactWorkAmoV6DeclarationEvidence(indexedCarrier, coreCarrier)
    .evidenceComplete,
  true,
);

await assert.rejects(
  indexedCarrierEvidence(
    declarationCarrierIndexRow({
      payload_text: `${declarationCommitment.protocolRecord}x`,
    }),
  ),
  /raw carrier metadata diverges/iu,
);
await assert.rejects(
  indexedCarrierEvidence(
    declarationCarrierIndexRow({
      payload_hex: Buffer.from(
        `${declarationCommitment.protocolRecord}x`,
        "utf8",
      ).toString("hex"),
    }),
  ),
  /not the generated protocol record/iu,
);
await assert.rejects(
  indexedCarrierEvidence(
    declarationCarrierIndexRow({
      data_bytes: declarationCarrierPayload.length + 1,
    }),
  ),
  /raw carrier metadata diverges/iu,
);
await assert.rejects(
  indexedCarrierEvidence(
    declarationCarrierIndexRow({ raw_carrier_count: 0 }),
  ),
  /declaration evidence mismatch/iu,
);
await assert.rejects(
  indexedCarrierEvidence(
    declarationCarrierIndexRow({ registry_output_count: 0 }),
  ),
  /declaration evidence mismatch/iu,
);
await assert.rejects(
  indexedCarrierEvidence(
    declarationCarrierIndexRow({ raw_carrier_count: 0 }),
    {
      ...declarationCarrierPins,
      declarationProtocolVout: 2,
    },
  ),
  /declaration evidence mismatch/iu,
);
await assert.rejects(
  indexedCarrierEvidence(
    declarationCarrierIndexRow({ raw_carrier_count: 0 }),
    {
      ...declarationCarrierPins,
      declarationRecordOrdinal: 1,
    },
  ),
  /declaration evidence mismatch/iu,
);
await assert.rejects(
  coreWorkAmoV6DeclarationEvidence(
    declarationCarrierPins,
    declarationCarrierRpc(
      {
        ...declarationCarrierTx,
        vout: declarationCarrierTx.vout.map((output, index) =>
          index === declarationCarrierPins.declarationProtocolVout
            ? opReturnOutput(`${declarationCommitment.protocolRecord}x`)
            : output
        ),
      },
    ),
  ),
  /not the generated protocol record/iu,
);
await assert.rejects(
  coreWorkAmoV6DeclarationEvidence(
    declarationCarrierPins,
    declarationCarrierRpc(
      {
        ...declarationCarrierTx,
        vin: [
          {
            prevout: {
              scriptPubKey: {
                hex: `76a914${"00".repeat(20)}88ac`,
              },
            },
          },
        ],
      },
    ),
  ),
  /declaration evidence mismatch/iu,
);
await assert.rejects(
  coreWorkAmoV6DeclarationEvidence(
    declarationCarrierPins,
    declarationCarrierRpc(
      {
        ...declarationCarrierTx,
        vout: declarationCarrierTx.vout.map((output, index) =>
          index === declarationCarrierPins.declarationRegistryPaymentVout
            ? {
                value: 0.00000546,
                scriptPubKey: { address: "bc1qwrongregistry" },
              }
            : output
        ),
      },
    ),
  ),
  /declaration evidence mismatch/iu,
);
await assert.rejects(
  coreWorkAmoV6DeclarationEvidence(
    declarationCarrierPins,
    declarationCarrierRpc(
      {
        ...declarationCarrierTx,
        vout: declarationCarrierTx.vout.map((output, index) =>
          index === declarationCarrierPins.declarationRegistryPaymentVout
            ? {
                value: 0.00000545,
                scriptPubKey: {
                  address: WORK_AMO_V5_DECLARATION_REGISTRY_ADDRESS,
                },
              }
            : output
        ),
      },
    ),
  ),
  /declaration evidence mismatch/iu,
);
await assert.rejects(
  coreWorkAmoV6DeclarationEvidence(
    declarationCarrierPins,
    declarationCarrierRpc({
      ...declarationCarrierTx,
      txid: "ee".repeat(32),
    }),
  ),
  /block position does not match/iu,
);
await assert.rejects(
  coreWorkAmoV6DeclarationEvidence(
    declarationCarrierPins,
    declarationCarrierRpc(
      declarationCarrierTx,
      "ff".repeat(32),
    ),
  ),
  /no longer canonical/iu,
);

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
        saleAuthorization: { version: WORK_AMO_V5_AUTH_VERSION },
      },
    ],
    { metadata: status },
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
    { metadata: status },
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
    { metadata: status },
  ).allowed,
  true,
);

console.log(
  JSON.stringify(
    {
      activationEvidence: "exact-and-fail-closed",
      declarationCarrier:
        "exact-raw-pwm1-m-with-mail-and-credit-siblings",
      allowedFaceProofs: WORK_AMO_V6_ALLOWED_FACE_PROOFS,
      formula:
        "price=face;amount=floor(face*supply*q8/network);minimum=ceil(amount*network/(supply*q8))",
      legacySettlement: "pre-v6-v4-v5-frozen",
      listingNBefore:
        frozen.frozenTerms.listingNetworkValueBeforeQ8,
      ordering:
        "block-height,transaction-index,protocol-vout,record-ordinal",
      settlement: "frozen-no-current-value",
      status: "ok",
      version: WORK_AMO_V6_AUTH_VERSION,
    },
    null,
    2,
  ),
);
