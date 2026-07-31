import assert from "node:assert/strict";
import {
  WORK_AMO_V7_ALLOWED_FACE_PROOFS,
  WORK_AMO_V7_AMOUNT_MODEL,
  WORK_AMO_V7_AUTH_VERSION,
  WORK_AMO_V7_BLOCK_SEQUENCER_MODEL,
  WORK_AMO_V7_DECIMALS,
  WORK_AMO_V7_GLOBAL_PRECISION_MODEL,
  WORK_AMO_V7_LEGACY_ATOM_TO_SUBATOM_SCALE,
  WORK_AMO_V7_MAX_SUPPLY_SUBATOMS,
  WORK_AMO_V7_MINT_AMOUNT_SUBATOMS,
  WORK_AMO_V7_MODELS,
  WORK_AMO_V7_PRECISION_MIGRATION_MODEL,
  WORK_AMO_V7_PRECISION_MODEL,
  WORK_AMO_V7_SUBATOMS_PER_WORK,
  WORK_AMO_V7_TRANSFER_VERSION,
  WORK_AMO_V7_UNIT_MODEL,
  calculateWorkAmoV7UnitTerms,
  compareWorkAmoV7CanonicalPositions,
  deriveWorkAmoV7FrozenTerms,
  replayWorkAmoV7CanonicalBlock,
  validateWorkAmoV7DeclarationEvidence,
  validateWorkAmoV7FrozenTerms,
  validateWorkAmoV7ListingCutover,
  validateWorkAmoV7SealOrBuyTerms,
  validateWorkAmoV7StaticAuthorization,
  workAmoV7ActivationFromEvidence,
  workAmoV7BroadcastDecision,
  workAmoV7CanonicalTokenStateCommitment,
  workAmoV7CanonicalTokenStatePreimage,
  workAmoV7StatusFromEvidence,
  workAmoV7TransferEraDecision,
} from "../server/work-amo-v7.mjs";
import {
  WORK_AMO_V5_DECLARATION_AUTHORITY_SCRIPT_PUBKEY,
  WORK_AMO_V5_DECLARATION_REGISTRY_ADDRESS,
  WORK_AMO_V5_MAX_SUPPLY,
  WORK_AMO_V5_NETWORK_VALUE_Q8_SCALE,
} from "../server/work-amo-v5.mjs";
import {
  WORK_AMO_V6_AUTH_VERSION,
  WORK_AMO_V6_MODELS,
} from "../server/work-amo-v6.mjs";
import {
  workAmoV7DeclarationCommitment,
} from "../server/work-amo-v7-declaration.mjs";
import {
  WORK_LEGACY_ATOMIC_PROJECTION_MODEL,
  WORK_PRECISION_V2_MIGRATION_MODEL,
  WORK_PRECISION_V2_MODEL,
  WORK_SUBATOM_CONVERSION_FACTOR,
  WORK_SUBATOM_DECIMALS,
  WORK_SUBATOM_PROJECTION_MODEL,
  WORK_SUBATOM_UNIT_SCALE,
  WORK_TOKEN_ID,
} from "../server/work-units.mjs";

const declarationTxid = "11".repeat(32);
const declarationBlockHash = "12".repeat(32);
const listingBlockHash = "33".repeat(32);
const actionBlockHash = "44".repeat(32);
const listingBlockHeight = 1_200_000;
const activationHeight = listingBlockHeight;
const sellerAddress =
  "bc1p0uxp0axptr8rg9dndgtlwxn00j4hq8m88kg80tqd0t6045putwhq5ca7ed";
const formulaDenominator =
  WORK_AMO_V5_MAX_SUPPLY *
  WORK_AMO_V7_SUBATOMS_PER_WORK *
  WORK_AMO_V5_NETWORK_VALUE_Q8_SCALE;

assert.equal(WORK_AMO_V7_AUTH_VERSION, "pwt-sale-v7");
assert.equal(
  WORK_AMO_V7_UNIT_MODEL,
  "canonical-work-amo-proof-unit-v2",
);
assert.equal(
  WORK_AMO_V7_AMOUNT_MODEL,
  "canonical-work-amo-proof-unit-amount-v2",
);
assert.equal(WORK_AMO_V7_DECIMALS, 16);
assert.equal(
  WORK_AMO_V7_SUBATOMS_PER_WORK,
  10_000_000_000_000_000n,
);
assert.equal(
  WORK_AMO_V7_LEGACY_ATOM_TO_SUBATOM_SCALE,
  100_000_000n,
);
assert.equal(
  WORK_AMO_V7_MAX_SUPPLY_SUBATOMS,
  210_000_000_000_000_000_000_000n,
);
assert.equal(
  WORK_AMO_V7_MINT_AMOUNT_SUBATOMS,
  10_000_000_000_000_000_000n,
);
assert.equal(
  WORK_AMO_V7_PRECISION_MODEL,
  WORK_SUBATOM_PROJECTION_MODEL,
);
assert.equal(
  WORK_AMO_V7_GLOBAL_PRECISION_MODEL,
  WORK_PRECISION_V2_MODEL,
);
assert.equal(
  WORK_AMO_V7_PRECISION_MIGRATION_MODEL,
  WORK_PRECISION_V2_MIGRATION_MODEL,
);
assert.equal(WORK_AMO_V7_TRANSFER_VERSION, "send3");
assert.equal(WORK_SUBATOM_DECIMALS, 16);
assert.equal(
  WORK_SUBATOM_UNIT_SCALE,
  WORK_AMO_V7_SUBATOMS_PER_WORK,
);
assert.equal(
  WORK_SUBATOM_CONVERSION_FACTOR,
  WORK_AMO_V7_LEGACY_ATOM_TO_SUBATOM_SCALE,
);
assert.deepEqual(
  WORK_AMO_V7_ALLOWED_FACE_PROOFS,
  [20_000, 50_000, 100_000],
);
assert.equal(
  workAmoV7TransferEraDecision({
    activationHeight: 101,
    blockHeight: 100,
    confirmed: true,
    projectionModel: WORK_SUBATOM_PROJECTION_MODEL,
    transferVersion: "send2",
  }).valid,
  true,
);
assert.equal(
  workAmoV7TransferEraDecision({
    activationHeight: 101,
    blockHeight: 101,
    confirmed: true,
    projectionModel: WORK_SUBATOM_PROJECTION_MODEL,
    transferVersion: "send2",
  }).reasonCode,
  "work-amo-v7-send3-required",
);
assert.equal(
  workAmoV7TransferEraDecision({
    activationHeight: 101,
    blockHeight: 100,
    confirmed: true,
    projectionModel: WORK_LEGACY_ATOMIC_PROJECTION_MODEL,
    transferVersion: WORK_AMO_V7_TRANSFER_VERSION,
  }).reasonCode,
  "work-amo-v7-send3-before-activation",
);
assert.equal(
  workAmoV7TransferEraDecision({
    activationHeight: 101,
    blockHeight: 101,
    confirmed: true,
    projectionModel: WORK_SUBATOM_PROJECTION_MODEL,
    transferVersion: WORK_AMO_V7_TRANSFER_VERSION,
  }).valid,
  true,
);

const declarationCommitment = workAmoV7DeclarationCommitment();
assert.equal(
  declarationCommitment.protocolRecord,
  `pwm1:m:${declarationCommitment.text}`,
);
assert.equal(declarationCommitment.payloadBytes, 8_136);
assert.equal(
  declarationCommitment.payloadSha256,
  "48d154fd53ba70163771607b7bb43a1786f78cdcad02f260ab5806e9f2f195b0",
);
assert.equal(declarationCommitment.protocolRecordBytes, 8_143);
assert.equal(
  declarationCommitment.protocolRecordSha256,
  "e85a332b2647381e5e69c5e85be59bb873adc89d1745c768643af0f0bfd75527",
);
assert.match(
  declarationCommitment.text,
  /workDecimals=16/u,
);
assert.match(
  declarationCommitment.text,
  /mintAmountSubatoms=10000000000000000000/u,
);
assert.match(
  declarationCommitment.text,
  /unitIdentity=one historical atom is 0\.00000001 WORK and converts to exactly 100000000 subatoms; one subatom is 0\.0000000000000001 WORK/u,
);
assert.match(
  declarationCommitment.text,
  /pwt1:send3:<token-id>:<amount-subatoms>:<recipient>/u,
);
assert.match(
  declarationCommitment.text,
  /mintRule=the WORK mint wire record remains pwt1:mint:<token-id>:1000; before activation it credits exactly 100000000000 historical atoms and from activation it credits exactly 10000000000000000000 subatoms/u,
);
assert.match(
  declarationCommitment.text,
  /unitAmountSubatoms=floor\(F\*S\*A\*Q\/N\)/u,
);
assert.match(
  declarationCommitment.text,
  /unitFormula=unitPriceSats=F;unitAmountSubatoms=floor\(F\*S\*A\*Q\/N\);unitMinimumPriceSats=ceil/u,
);
assert.doesNotMatch(
  declarationCommitment.text,
  /unitPriceProofs=|unitMinimumPriceProofs=/u,
);
assert.match(
  declarationCommitment.text,
  /network value remains exact Q8 integer proof accounting/u,
);
assert.doesNotMatch(
  declarationCommitment.text,
  /pending canonical delta/u,
);
assert.match(
  declarationCommitment.text,
  /volatile pending WORK event listing action and balance-delta projections are purged while noncanonical transaction envelopes remain raw recovery input/u,
);
assert.match(
  declarationCommitment.text,
  /pre-activation canonical event and state commitments[\s\S]*provisional or wrong-era derived projections at D\+1 or later are invalidated/u,
);
assert.match(
  declarationCommitment.text,
  /canonical D\+1 activation boundary is observed or persistently latched[\s\S]*never re-enables legacy send send2/u,
);
assert.match(
  declarationCommitment.text,
  /earliest exact valid declaration transaction by confirmed block height then transaction index is authoritative/u,
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
    ...WORK_AMO_V7_MODELS,
    anchorScriptPubKey: `5120${"ab".repeat(32)}`,
    anchorSigHashType: 0x83,
    anchorType: "sale-ticket-v1",
    anchorValueSats: 546,
    anchorVout: 2,
    buyerAddress: "",
    expiresAt: "",
    network: "livenet",
    nonce: "amo-v7-q16-check",
    registryAddress: WORK_AMO_V5_DECLARATION_REGISTRY_ADDRESS,
    sellerAddress,
    sellerPublicKey:
      "0306baa226e3a87a99547df2144f2e6206a4a479a46df41ec1618945c064568237",
    ticker: "WORK",
    tokenId: WORK_TOKEN_ID,
    unitFaceProofs: 20_000,
    version: WORK_AMO_V7_AUTH_VERSION,
    ...overrides,
  };
}

for (const face of WORK_AMO_V7_ALLOWED_FACE_PROOFS) {
  const terms = calculateWorkAmoV7UnitTerms({
    networkValueBeforeQ8:
      WORK_AMO_V5_MAX_SUPPLY *
      WORK_AMO_V5_NETWORK_VALUE_Q8_SCALE,
    unitFaceProofs: face,
  });
  assert.equal(terms.valid, true);
  assert.equal(terms.unitPriceSats, String(face));
  assert.equal(
    terms.unitAmountSubatoms,
    (BigInt(face) * WORK_AMO_V7_SUBATOMS_PER_WORK).toString(),
  );
  assert.equal(terms.unitMinimumPriceSats, String(face));
  assert.equal(terms.unitAmountAtoms, undefined);
}
for (const face of [5_000, 10_000, 200_000]) {
  assert.equal(
    calculateWorkAmoV7UnitTerms({
      networkValueBeforeQ8:
        WORK_AMO_V5_MAX_SUPPLY *
        WORK_AMO_V5_NETWORK_VALUE_Q8_SCALE,
      unitFaceProofs: face,
    }).reasonCode,
    "work-amo-v7-face-unit-invalid",
  );
}

const roundingNetworkValue =
  WORK_AMO_V5_MAX_SUPPLY *
    WORK_AMO_V5_NETWORK_VALUE_Q8_SCALE +
  1n;
const roundingTerms = calculateWorkAmoV7UnitTerms({
  networkValueBeforeQ8: roundingNetworkValue,
  unitFaceProofs: 20_000,
});
assert.equal(
  BigInt(roundingTerms.unitAmountSubatoms),
  (20_000n * formulaDenominator) / roundingNetworkValue,
);
assert.equal(
  BigInt(roundingTerms.unitMinimumPriceSats),
  (
    BigInt(roundingTerms.unitAmountSubatoms) *
      roundingNetworkValue +
    formulaDenominator -
    1n
  ) / formulaDenominator,
);
assert.notEqual(
  BigInt(roundingTerms.unitAmountSubatoms) %
    WORK_AMO_V7_LEGACY_ATOM_TO_SUBATOM_SCALE,
  0n,
  "V7 must preserve derived precision below the historical atom",
);

assert.equal(
  validateWorkAmoV7StaticAuthorization(authorization()).valid,
  true,
);
assert.equal(
  validateWorkAmoV7StaticAuthorization(
    authorization({ unitAmountSubatoms: "1" }),
  ).reasonCode,
  "work-amo-v7-derived-fields-not-signable",
);
assert.equal(
  validateWorkAmoV7StaticAuthorization(
    authorization({ version: WORK_AMO_V6_AUTH_VERSION }),
  ).reasonCode,
  "work-amo-v7-version-required",
);
assert.equal(
  validateWorkAmoV7StaticAuthorization(
    authorization({ amountModel: "wrong" }),
  ).reasonCode,
  "work-amo-v7-models-invalid",
);

assert.equal(
  validateWorkAmoV7ListingCutover({
    activationHeight,
    authorizationVersion: WORK_AMO_V6_AUTH_VERSION,
    listingPosition: listingPosition({
      blockHeight: activationHeight - 1,
    }),
  }).valid,
  true,
);
assert.equal(
  validateWorkAmoV7ListingCutover({
    activationHeight,
    authorizationVersion: WORK_AMO_V6_AUTH_VERSION,
    listingPosition: listingPosition(),
  }).reasonCode,
  "work-amo-v7-version-required",
);
assert.equal(
  validateWorkAmoV7ListingCutover({
    activationHeight,
    authorizationVersion: WORK_AMO_V7_AUTH_VERSION,
    listingPosition: listingPosition({
      blockHeight: activationHeight - 1,
    }),
  }).reasonCode,
  "work-amo-v7-listing-before-activation",
);
assert.equal(
  validateWorkAmoV7ListingCutover({
    activationHeight,
    authorizationVersion: WORK_AMO_V7_AUTH_VERSION,
    listingPosition: listingPosition(),
  }).valid,
  true,
);

const networkValueBeforeQ8 =
  WORK_AMO_V5_MAX_SUPPLY *
  WORK_AMO_V5_NETWORK_VALUE_Q8_SCALE;
const listingBondContributionQ8 =
  546n * WORK_AMO_V5_NETWORK_VALUE_Q8_SCALE;
const expectedAmountSubatoms =
  20_000n * WORK_AMO_V7_SUBATOMS_PER_WORK;
const derived = deriveWorkAmoV7FrozenTerms(authorization(), {
  activationHeight,
  listingBondContributionQ8,
  listingPosition: listingPosition(),
  networkValueBeforeQ8,
  spendableAmountSubatoms: expectedAmountSubatoms,
});
assert.equal(derived.valid, true);
assert.equal(
  derived.frozenTerms.unitAmountSubatoms,
  expectedAmountSubatoms.toString(),
);
assert.equal(derived.frozenTerms.unitAmountAtoms, undefined);
assert.equal(
  derived.frozenTerms.listingNetworkValueBeforeQ8,
  networkValueBeforeQ8.toString(),
);
assert.equal(
  derived.frozenTerms.listingNetworkValueAfterQ8,
  (networkValueBeforeQ8 + listingBondContributionQ8).toString(),
);
assert.equal(
  validateWorkAmoV7FrozenTerms(derived.frozenTerms, {
    authorization: authorization(),
    listingBondContributionQ8,
    listingPosition: listingPosition(),
    networkValueBeforeQ8,
  }).valid,
  true,
);
assert.equal(
  deriveWorkAmoV7FrozenTerms(authorization(), {
    activationHeight,
    listingBondContributionQ8,
    listingPosition: listingPosition(),
    networkValueBeforeQ8,
    spendableAmountSubatoms: expectedAmountSubatoms - 1n,
  }).reasonCode,
  "work-amo-v7-insufficient-spendable-balance",
);

const v7ListingId = "55".repeat(32);
const v7State = {
  confirmedSupplySubatoms: expectedAmountSubatoms.toString(),
  holders: [
    {
      address: sellerAddress,
      balanceSubatoms: expectedAmountSubatoms.toString(),
    },
  ],
  listings: [
    {
      amountSubatoms: expectedAmountSubatoms.toString(),
      frozenTerms: derived.frozenTerms,
      listingId: v7ListingId,
      priceSats: "20000",
      saleAuthorization: authorization(),
      sellerAddress,
    },
  ],
};
const v7Preimage = workAmoV7CanonicalTokenStatePreimage(v7State);
assert.equal(
  v7Preimage.definition.amountStorageModel,
  "work-subatoms-v2",
);
assert.equal(v7Preimage.definition.decimals, 16);
assert.equal(
  v7Preimage.definition.maxSupplySubatoms,
  WORK_AMO_V7_MAX_SUPPLY_SUBATOMS.toString(),
);
assert.equal(
  v7Preimage.definition.mintAmountSubatoms,
  WORK_AMO_V7_MINT_AMOUNT_SUBATOMS.toString(),
);
assert.equal(
  v7Preimage.definition.precisionModel,
  WORK_AMO_V7_GLOBAL_PRECISION_MODEL,
);
assert.equal(
  v7Preimage.definition.unitScale,
  "10000000000000000",
);
assert.equal(
  v7Preimage.reservedSubatoms,
  expectedAmountSubatoms.toString(),
);
assert.deepEqual(
  workAmoV7CanonicalTokenStatePreimage(v7Preimage),
  v7Preimage,
);
const v7Commitment =
  workAmoV7CanonicalTokenStateCommitment(v7State);
assert.deepEqual(
  v7Commitment,
  workAmoV7CanonicalTokenStateCommitment(v7Preimage),
);

const firstV6ListingTxid =
  "b259fa601676287eca2ea94c9142cd13b45fde7031ec98967f15306df6ef7936";
const firstV6ListingSeller =
  "18hkqE81wQuq75UEBKhB4JjAuQg47jN7Aa";
const firstV6ListingAuthorization = {
  ...WORK_AMO_V6_MODELS,
  anchorScriptPubKey:
    "76a914547e1b8e5303c69a1fd07e87305b5b71fbaac0ee88ac",
  anchorSigHashType: 0x83,
  anchorSignature: "",
  anchorTxid: "",
  anchorType: "sale-ticket-v1",
  anchorValueSats: 546,
  anchorVout: 2,
  buyerAddress: "",
  expiresAt: "",
  network: "livenet",
  nonce: "ms7i747w-93nwbex7",
  registryAddress: WORK_AMO_V5_DECLARATION_REGISTRY_ADDRESS,
  sellerAddress: firstV6ListingSeller,
  sellerPublicKey:
    "03322f3132310abe49fd21dbb4987c7a5f327afc0224bc74851e06b0f5cf4bf945",
  ticker: "WORK",
  tokenId: WORK_TOKEN_ID,
  unitFaceProofs: 20_000,
  version: WORK_AMO_V6_AUTH_VERSION,
};
const firstV6ListingFrozenTerms = {
  ...WORK_AMO_V6_MODELS,
  listingBlockHash:
    "00000000000000000000a5ea8861570ed551f77ed3cc0bddc3db3958d2700b44",
  listingBlockHeight: 960_258,
  listingBlockIndex: 4_093,
  listingBondContributionQ8: "2940553839600",
  listingNetworkValueAfterQ8:
    "407065289490677089559475846",
  listingNetworkValueBeforeQ8:
    "407065289490674149005636246",
  listingProtocolVout: 1,
  listingRecordOrdinal: 0,
  unitAmountAtoms: "10",
  unitFaceProofs: 20_000,
  unitMinimumPriceSats: "19385",
  unitPriceSats: "20000",
  version: WORK_AMO_V6_AUTH_VERSION,
};
const migratedFirstV6State = {
  confirmedSupplySubatoms: WORK_AMO_V7_SUBATOMS_PER_WORK.toString(),
  holders: [
    {
      address: firstV6ListingSeller,
      balanceSubatoms:
        WORK_AMO_V7_SUBATOMS_PER_WORK.toString(),
    },
  ],
  listings: [
    {
      amountSubatoms: (
        10n * WORK_AMO_V7_LEGACY_ATOM_TO_SUBATOM_SCALE
      ).toString(),
      frozenTerms: firstV6ListingFrozenTerms,
      listingId: firstV6ListingTxid,
      priceSats: "20000",
      saleAuthorization: firstV6ListingAuthorization,
      sellerAddress: firstV6ListingSeller,
    },
  ],
};
const migratedFirstV6Preimage =
  workAmoV7CanonicalTokenStatePreimage(migratedFirstV6State);
assert.equal(
  migratedFirstV6Preimage.listings[0].amountSubatoms,
  "1000000000",
);
assert.equal(
  migratedFirstV6Preimage.listings[0].frozenTerms.unitAmountAtoms,
  "10",
);
assert.equal(
  migratedFirstV6Preimage.listings[0].frozenTerms.unitAmountSubatoms,
  undefined,
);
assert.throws(
  () =>
    workAmoV7CanonicalTokenStatePreimage({
      ...migratedFirstV6State,
      listings: [
        {
          ...migratedFirstV6State.listings[0],
          amountSubatoms: "1000000001",
        },
      ],
    }),
  /work-amo-v7-token-state-listing-invalid/u,
);

const actionPosition = {
  blockHash: actionBlockHash,
  blockHeight: listingBlockHeight + 1,
  blockTransactionIndex: 0,
  protocolVout: 1,
  recordOrdinal: 0,
};
assert.equal(
  validateWorkAmoV7SealOrBuyTerms({
    actionFrozenTerms: structuredClone(derived.frozenTerms),
    actionPosition,
    activationHeight,
    listingAuthorization: authorization(),
    listingFrozenTerms: derived.frozenTerms,
    listingPosition: listingPosition(),
  }).valid,
  true,
);
assert.equal(
  validateWorkAmoV7SealOrBuyTerms({
    actionPosition,
    activationHeight,
    listingAuthorization: firstV6ListingAuthorization,
    listingFrozenTerms: firstV6ListingFrozenTerms,
    listingPosition: {
      blockHash: firstV6ListingFrozenTerms.listingBlockHash,
      blockHeight: firstV6ListingFrozenTerms.listingBlockHeight,
      blockTransactionIndex:
        firstV6ListingFrozenTerms.listingBlockIndex,
      protocolVout:
        firstV6ListingFrozenTerms.listingProtocolVout,
      recordOrdinal:
        firstV6ListingFrozenTerms.listingRecordOrdinal,
    },
    referencesListingFrozenTerms: true,
  }).valid,
  true,
);

const unorderedRecords = [
  {
    position: listingPosition({
      blockTransactionIndex: 2,
      protocolVout: 1,
      recordOrdinal: 0,
    }),
    txid: "02".repeat(32),
  },
  {
    position: listingPosition({
      blockTransactionIndex: 1,
      protocolVout: 3,
      recordOrdinal: 0,
    }),
    txid: "01".repeat(32),
  },
  {
    position: listingPosition({
      blockTransactionIndex: 1,
      protocolVout: 1,
      recordOrdinal: 1,
    }),
    txid: "01".repeat(32),
  },
  {
    position: listingPosition({
      blockTransactionIndex: 1,
      protocolVout: 1,
      recordOrdinal: 0,
    }),
    txid: "01".repeat(32),
  },
];
const orderedRecords = [...unorderedRecords].sort((left, right) =>
  compareWorkAmoV7CanonicalPositions(
    left.position,
    right.position,
  ),
);
assert.deepEqual(
  orderedRecords.map((record) => [
    record.position.blockTransactionIndex,
    record.position.protocolVout,
    record.position.recordOrdinal,
  ]),
  [
    [1, 1, 0],
    [1, 1, 1],
    [1, 3, 0],
    [2, 1, 0],
  ],
);
const replay = replayWorkAmoV7CanonicalBlock({
  activationHeight,
  applyTransactionFee: ({ state }) => ({ state }),
  blockHash: listingBlockHash,
  blockHeight: listingBlockHeight,
  evaluateRecord: ({ entry, state }) => ({
    output: entry.txid,
    state: {
      ...state,
      count: state.count + 1,
    },
    valid: true,
  }),
  openingState: { count: 0, networkValueQ8: 1n },
  records: unorderedRecords.map((record) => ({
    ...record,
    transactionMinerFeeSats: "0",
    transactionProtocolRecordCount:
      record.txid === "01".repeat(32) ? 3 : 1,
  })),
  valueFromState: (state) => state.networkValueQ8,
});
assert.equal(replay.model, WORK_AMO_V7_BLOCK_SEQUENCER_MODEL);
assert.equal(replay.state.count, 4);

const expectedDeclaration = {
  activationHeight: listingBlockHeight,
  authorityScriptPubKey:
    WORK_AMO_V5_DECLARATION_AUTHORITY_SCRIPT_PUBKEY,
  blockHash: declarationBlockHash,
  blockHeight: listingBlockHeight - 1,
  blockTransactionIndex: 12,
  minimumPaymentSats: 546,
  payloadBytes: declarationCommitment.payloadBytes,
  payloadSha256: declarationCommitment.payloadSha256,
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
  validateWorkAmoV7DeclarationEvidence(declarationEvidence, {
    expectedDeclaration,
  }).valid,
  true,
);
assert.equal(
  workAmoV7ActivationFromEvidence(declarationEvidence, {
    expectedDeclaration,
    indexedThroughBlock: listingBlockHeight,
  }).active,
  true,
);
const declarationBlockStatus = workAmoV7StatusFromEvidence({
  evidence: declarationEvidence,
  expectedDeclaration,
  indexedThroughBlock: listingBlockHeight - 1,
  precisionMigrationReady: false,
  protocolWritesEnabled: false,
});
assert.equal(declarationBlockStatus.activation.reached, false);
assert.equal(declarationBlockStatus.activation.active, false);
assert.equal(declarationBlockStatus.writeAdmission, false);
assert.equal(
  workAmoV7StatusFromEvidence({
    evidence: declarationEvidence,
    expectedDeclaration,
    indexedThroughBlock: listingBlockHeight,
    precisionMigrationReady: false,
    protocolWritesEnabled: true,
  }).reasonCode,
  "work-amo-v7-precision-migration-not-ready",
);
const readyStatus = workAmoV7StatusFromEvidence({
  evidence: declarationEvidence,
  expectedDeclaration,
  indexedThroughBlock: listingBlockHeight,
  precisionMigrationReady: true,
  protocolWritesEnabled: true,
});
assert.equal(readyStatus.activation.reached, true);
assert.equal(readyStatus.ready, true);
assert.equal(readyStatus.protocolReady, true);
assert.equal(readyStatus.writeAdmission, true);
assert.equal(readyStatus.listingWritesEnabled, true);
const reachedWithoutEvidence = workAmoV7StatusFromEvidence({
  evidence: {
    ...declarationEvidence,
    evidenceComplete: false,
  },
  expectedDeclaration,
  indexedThroughBlock: listingBlockHeight,
  precisionMigrationReady: true,
  protocolWritesEnabled: true,
});
assert.equal(reachedWithoutEvidence.activation.reached, true);
assert.equal(reachedWithoutEvidence.activation.active, false);
assert.equal(reachedWithoutEvidence.protocolReady, false);
assert.equal(reachedWithoutEvidence.writeAdmission, false);
assert.deepEqual(
  workAmoV7BroadcastDecision(
    [
      {
        action: "list5",
        authVersion: WORK_AMO_V7_AUTH_VERSION,
        canonicalParsed: true,
        paysWorkRegistry: true,
        registryAddress:
          WORK_AMO_V5_DECLARATION_REGISTRY_ADDRESS,
        saleAuthorization: authorization(),
        signedShapeValid: true,
        ticker: "WORK",
        tokenId: WORK_TOKEN_ID,
        tokenProtocolMessageCount: 1,
      },
    ],
    { metadata: readyStatus },
  ),
  { allowed: true },
);
assert.equal(
  workAmoV7BroadcastDecision(
    [
      {
        action: "list5",
        authVersion: WORK_AMO_V6_AUTH_VERSION,
        canonicalParsed: true,
        paysWorkRegistry: true,
        registryAddress:
          WORK_AMO_V5_DECLARATION_REGISTRY_ADDRESS,
        saleAuthorization: firstV6ListingAuthorization,
        signedShapeValid: true,
        ticker: "WORK",
        tokenId: WORK_TOKEN_ID,
        tokenProtocolMessageCount: 1,
      },
    ],
    { metadata: readyStatus },
  ).reasonCode,
  "work-amo-v7-version-required",
);

process.stdout.write(
  `${JSON.stringify(
    {
      allowedFaceProofs: WORK_AMO_V7_ALLOWED_FACE_PROOFS,
      amountField: "unitAmountSubatoms",
      declarationPayloadBytes:
        declarationCommitment.payloadBytes,
      declarationPayloadSha256:
        declarationCommitment.payloadSha256,
      legacyV6AmountAtoms: "10",
      migratedV6AmountSubatoms: "1000000000",
      networkValueScale: "Q8",
      ordering:
        "block-height,transaction-index,protocol-vout,record-ordinal",
      precisionModel: WORK_AMO_V7_PRECISION_MODEL,
      status: "ok",
      subatomsPerWork:
        WORK_AMO_V7_SUBATOMS_PER_WORK.toString(),
      version: WORK_AMO_V7_AUTH_VERSION,
    },
    null,
    2,
  )}\n`,
);
