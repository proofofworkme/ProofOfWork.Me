import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { canonicalProtocolCandidateFromOutput } from "../server/canonical-op-return.mjs";
import {
  expandedLiquidityForReplay, expandedLiquidityDeclarationRecord, expandedLiquidityPositionEligible, expandedLiquidityReadiness,
  normalizeExpandedLiquidityPins, verifyExpandedLiquidityDeclaration,
} from "../server/work-amo-expanded-liquidity.mjs";
import { WORK_AMO_LISTING_REGISTRY_SCRIPT } from "../src/shared/protocol/workAmoExpandedLiquidity.mjs";
import assert from "node:assert/strict";
import {
  WORK_AMO_V8_ALLOWED_FACE_PROOFS,
  WORK_AMO_V8_AMOUNT_MODEL,
  WORK_AMO_V8_AUTH_VERSION,
  WORK_AMO_V8_BLOCK_SEQUENCER_MODEL,
  WORK_AMO_V8_DECIMALS,
  WORK_AMO_V8_GLOBAL_PRECISION_MODEL,
  WORK_AMO_V8_LEGACY_ATOM_TO_SUBATOM_SCALE,
  WORK_AMO_V8_MAX_SUPPLY_SUBATOMS,
  WORK_AMO_V8_MINT_AMOUNT_SUBATOMS,
  WORK_AMO_V8_MODELS,
  WORK_AMO_V8_PRECISION_MIGRATION_MODEL,
  WORK_AMO_V8_PRECISION_MODEL,
  WORK_AMO_V8_SUBATOMS_PER_WORK,
  WORK_AMO_V8_TOKEN_STATE_PREIMAGE_MODEL,
  WORK_AMO_V8_TRANSFER_VERSION,
  WORK_AMO_V8_UNIT_MODEL,
  calculateWorkAmoV8UnitTerms,
  compareWorkAmoV8CanonicalPositions,
  deriveWorkAmoV8FrozenTerms,
  replayWorkAmoV8CanonicalBlock,
  validateWorkAmoV8DeclarationEvidence,
  validateWorkAmoV8BoundaryTransitionPayload,
  validateWorkAmoV8FrozenTerms,
  validateWorkAmoV8ListingCutover,
  validateWorkAmoV8SealOrBuyTerms,
  validateWorkAmoV8StaticAuthorization,
  workAmoV8ActivationFromEvidence,
  workAmoV8BroadcastDecision,
  workAmoV8CanonicalTokenStateCommitment,
  workAmoV8CanonicalTokenStatePreimage,
  workAmoV8StatusFromEvidence,
  workAmoV8TransferEraDecision,
} from "../server/work-amo-v8.mjs";
import {
  WORK_AMO_V5_BASE_STATE_FIELDS,
  WORK_AMO_V5_ATOM_MOVEMENT_DENOMINATOR,
  WORK_AMO_V5_SUBATOM_MOVEMENT_DENOMINATOR,
  WORK_AMO_V5_DECLARATION_AUTHORITY_SCRIPT_PUBKEY,
  WORK_AMO_V5_DECLARATION_REGISTRY_ADDRESS,
  WORK_AMO_V5_MAX_SUPPLY,
  WORK_AMO_V5_NETWORK_ACCUMULATOR_MODEL,
  WORK_AMO_V5_NETWORK_VALUE_Q8_SCALE,
  WORK_AMO_V5_PAYLOAD_COMMITMENT_MODEL,
  WORK_AMO_V5_STATE_COMMITMENT_MODEL,
  workAmoV5CanonicalStateCommitment,
  workAmoV5MovementAmountUnits,
  workAmoV5MovementValueAtNetworkQ8,
} from "../server/work-amo-v5.mjs";
import {
  WORK_AMO_V6_AUTH_VERSION,
  WORK_AMO_V6_MODELS,
} from "../server/work-amo-v6.mjs";
import {
  workAmoV8DeclarationCarrierEvidence,
  workAmoV8DeclarationCommitment,
} from "../server/work-amo-v8-declaration.mjs";
import {
  exactWorkAmoV8WorkerLastSuccessReadiness,
  exactWorkAmoV8WorkerReadiness,
} from "../server/work-amo-v8-worker-readiness.mjs";
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
  WORK_AMO_V8_SUBATOMS_PER_WORK *
  WORK_AMO_V5_NETWORK_VALUE_Q8_SCALE;

function workAmoV8BoundaryFixture({ blockHash, blockHeight, previousBlockHash }) {
  const closingTokenState = {
    confirmedSupplySubatoms: "0",
    holders: [],
    listings: [],
  };
  const tokenStateCommitment =
    workAmoV8CanonicalTokenStateCommitment(closingTokenState);
  const commonState = {
    baseState: Object.fromEntries(
      WORK_AMO_V5_BASE_STATE_FIELDS.map((field) => [field, "0"]),
    ),
    creditFixedQ8: "1",
    creditMovementFrozenValueQ8: "0",
    genericTokenStateCommitment: {
      model: WORK_AMO_V5_PAYLOAD_COMMITMENT_MODEL,
      payloadBytes: 1,
      sha256: "51".repeat(32),
    },
    idStateCommitment: {
      model: WORK_AMO_V5_PAYLOAD_COMMITMENT_MODEL,
      payloadBytes: 1,
      sha256: "52".repeat(32),
    },
    model: WORK_AMO_V5_NETWORK_ACCUMULATOR_MODEL,
    movements: [],
    network: "livenet",
    networkValueQ8: "1",
    quoteHead: null,
    tokenStateCommitment,
  };
  const openingSufficientState = {
    ...structuredClone(commonState),
    throughBlockHash: previousBlockHash,
    throughBlockHeight: blockHeight - 1,
  };
  const closingSufficientState = {
    ...structuredClone(commonState),
    throughBlockHash: blockHash,
    throughBlockHeight: blockHeight,
  };
  const openingStateCommitment =
    workAmoV5CanonicalStateCommitment(openingSufficientState);
  const closingStateCommitment =
    workAmoV5CanonicalStateCommitment(closingSufficientState);
  return {
    blockAtomic: true,
    blockHash,
    blockHeight,
    closingNetworkValueQ8: "1",
    closingStatePayloadBytes: closingStateCommitment.payloadBytes,
    closingStateSha256: closingStateCommitment.sha256,
    complete: true,
    feeOnce: true,
    invalidZero: true,
    model: WORK_AMO_V8_BLOCK_SEQUENCER_MODEL,
    network: "livenet",
    openingNetworkValueQ8: "1",
    openingStatePayloadBytes: openingStateCommitment.payloadBytes,
    openingStateSha256: openingStateCommitment.sha256,
    payload: {
      blockAtomic: true,
      blockHash,
      blockHeight,
      closingStateCommitment,
      closingSufficientState,
      closingTokenState,
      complete: true,
      feeOnce: true,
      invalidZero: true,
      model: WORK_AMO_V8_BLOCK_SEQUENCER_MODEL,
      network: "livenet",
      openingStateCommitment,
      openingSufficientState,
      previousBlockHash,
      workTokenStateModel: WORK_AMO_V8_TOKEN_STATE_PREIMAGE_MODEL,
    },
    previousBlockHash,
    stateCommitmentModel: WORK_AMO_V5_STATE_COMMITMENT_MODEL,
    workTokenStateModel: WORK_AMO_V8_TOKEN_STATE_PREIMAGE_MODEL,
  };
}

const activationBoundaryFixture = workAmoV8BoundaryFixture({
  blockHash: "61".repeat(32),
  blockHeight: activationHeight,
  previousBlockHash: declarationBlockHash,
});
const latestBoundaryFixture = workAmoV8BoundaryFixture({
  blockHash: "62".repeat(32),
  blockHeight: activationHeight + 1,
  previousBlockHash: activationBoundaryFixture.blockHash,
});
for (const [label, fixture] of [
  ["activation", activationBoundaryFixture],
  ["latest", latestBoundaryFixture],
]) {
  assert.equal(
    validateWorkAmoV8BoundaryTransitionPayload(fixture).valid,
    true,
    `${label} boundary payload must be fully valid`,
  );
  const payloadMutations = [
    ["model", "broken-model"],
    ["network", "testnet"],
    ["blockHeight", fixture.blockHeight + 1],
    ["blockHash", "63".repeat(32)],
    ["previousBlockHash", "64".repeat(32)],
    ["blockAtomic", false],
    ["feeOnce", false],
    ["invalidZero", false],
    ["complete", false],
    ["workTokenStateModel", "broken-token-state-model"],
  ];
  for (const [field, value] of payloadMutations) {
    const changed = structuredClone(fixture);
    changed.payload[field] = value;
    assert.equal(
      validateWorkAmoV8BoundaryTransitionPayload(changed).valid,
      false,
      `${label} boundary payload tamper must fail: ${field}`,
    );
  }
  for (const [field, value] of [
    ["stateCommitmentModel", "broken-state-commitment-model"],
    ["workTokenStateModel", "broken-token-state-model"],
    ["openingNetworkValueQ8", "2"],
    ["closingNetworkValueQ8", "2"],
    ["openingStateSha256", "67".repeat(32)],
    ["closingStateSha256", "68".repeat(32)],
    ["openingStatePayloadBytes", fixture.openingStatePayloadBytes + 1],
    ["closingStatePayloadBytes", fixture.closingStatePayloadBytes + 1],
  ]) {
    const changed = structuredClone(fixture);
    changed[field] = value;
    assert.equal(
      validateWorkAmoV8BoundaryTransitionPayload(changed).valid,
      false,
      `${label} boundary scalar tamper must fail: ${field}`,
    );
  }
  for (const side of ["opening", "closing"]) {
    const stateField = `${side}SufficientState`;
    const commitmentField = `${side}StateCommitment`;
    for (const [field, value] of [
      ["model", "broken-state-model"],
      ["throughBlockHeight", fixture.blockHeight + 2],
      ["throughBlockHash", "65".repeat(32)],
      ["networkValueQ8", "2"],
    ]) {
      const changed = structuredClone(fixture);
      changed.payload[stateField][field] = value;
      assert.equal(
        validateWorkAmoV8BoundaryTransitionPayload(changed).valid,
        false,
        `${label} ${side} state tamper must fail: ${field}`,
      );
    }
    const extraStateField = structuredClone(fixture);
    extraStateField.payload[stateField].unexpected = true;
    assert.equal(
      validateWorkAmoV8BoundaryTransitionPayload(extraStateField).valid,
      false,
      `${label} ${side} state extra field must fail`,
    );
    for (const [field, value] of [
      ["model", "broken-commitment-model"],
      ["sha256", "66".repeat(32)],
      ["payloadBytes", fixture.payload[commitmentField].payloadBytes + 1],
    ]) {
      const changed = structuredClone(fixture);
      changed.payload[commitmentField][field] = value;
      assert.equal(
        validateWorkAmoV8BoundaryTransitionPayload(changed).valid,
        false,
        `${label} ${side} commitment tamper must fail: ${field}`,
      );
    }
  }
  const tokenStateModelTamper = structuredClone(fixture);
  tokenStateModelTamper.payload.closingTokenState.model =
    "broken-token-state-model";
  assert.equal(
    validateWorkAmoV8BoundaryTransitionPayload(tokenStateModelTamper).valid,
    false,
    `${label} closing token-state model tamper must fail`,
  );
}

assert.equal(WORK_AMO_V8_AUTH_VERSION, "pwt-sale-v8");
assert.equal(
  WORK_AMO_V8_UNIT_MODEL,
  "canonical-work-amo-proof-unit-v3",
);
assert.equal(
  WORK_AMO_V8_AMOUNT_MODEL,
  "canonical-work-amo-proof-unit-amount-v3",
);
assert.equal(WORK_AMO_V8_DECIMALS, 16);
assert.equal(
  WORK_AMO_V8_SUBATOMS_PER_WORK,
  10_000_000_000_000_000n,
);
assert.equal(
  WORK_AMO_V8_LEGACY_ATOM_TO_SUBATOM_SCALE,
  100_000_000n,
);
assert.equal(
  WORK_AMO_V8_MAX_SUPPLY_SUBATOMS,
  210_000_000_000_000_000_000_000n,
);
assert.equal(
  WORK_AMO_V8_MINT_AMOUNT_SUBATOMS,
  10_000_000_000_000_000_000n,
);
assert.equal(
  WORK_AMO_V8_PRECISION_MODEL,
  WORK_SUBATOM_PROJECTION_MODEL,
);
assert.equal(
  WORK_AMO_V8_GLOBAL_PRECISION_MODEL,
  WORK_PRECISION_V2_MODEL,
);
assert.equal(
  WORK_AMO_V8_PRECISION_MIGRATION_MODEL,
  WORK_PRECISION_V2_MIGRATION_MODEL,
);
assert.equal(WORK_AMO_V8_TRANSFER_VERSION, "send3");
assert.equal(WORK_SUBATOM_DECIMALS, 16);
assert.equal(
  WORK_SUBATOM_UNIT_SCALE,
  WORK_AMO_V8_SUBATOMS_PER_WORK,
);
assert.equal(
  WORK_SUBATOM_CONVERSION_FACTOR,
  WORK_AMO_V8_LEGACY_ATOM_TO_SUBATOM_SCALE,
);
const q16OnlyMovement = {
  amountStorageModel: WORK_SUBATOM_PROJECTION_MODEL,
  amountSubatoms: "10000000000000000000",
  identity:
    "transfer:7d55cdba551ff257cb662f6d6799407b9679e34056f9e18fb771a440f09923ca:1:0",
};
const q16OnlyMovementUnits =
  workAmoV5MovementAmountUnits(q16OnlyMovement);
assert.equal(
  q16OnlyMovementUnits.amount.toString(),
  q16OnlyMovement.amountSubatoms,
);
assert.equal(
  q16OnlyMovementUnits.denominator,
  WORK_AMO_V5_SUBATOM_MOVEMENT_DENOMINATOR,
);
assert.equal(
  q16OnlyMovementUnits.amountStorageModel,
  WORK_SUBATOM_PROJECTION_MODEL,
);
assert.equal(
  workAmoV5MovementValueAtNetworkQ8(
    q16OnlyMovement,
    WORK_AMO_V5_SUBATOM_MOVEMENT_DENOMINATOR,
  ).toString(),
  q16OnlyMovement.amountSubatoms,
);
const oneSubatomMovement = {
  amountStorageModel: WORK_SUBATOM_PROJECTION_MODEL,
  amountSubatoms: "1",
};
assert.equal(
  workAmoV5MovementValueAtNetworkQ8(
    oneSubatomMovement,
    WORK_AMO_V5_SUBATOM_MOVEMENT_DENOMINATOR,
  ).toString(),
  "1",
);
assert.equal(
  workAmoV5MovementAmountUnits({
    amountAtoms: "1",
    amountStorageModel: WORK_SUBATOM_PROJECTION_MODEL,
  }),
  null,
);
assert.equal(
  workAmoV5MovementAmountUnits({
    amountAtoms: "1",
    amountSubatoms: "1",
  }),
  null,
);
assert.equal(
  workAmoV5MovementAmountUnits({
    amountAtoms: "100000000",
  }).denominator,
  WORK_AMO_V5_ATOM_MOVEMENT_DENOMINATOR,
);
assert.deepEqual(
  WORK_AMO_V8_ALLOWED_FACE_PROOFS,
  [25_000],
);
assert.equal(
  workAmoV8TransferEraDecision({
    activationHeight: 101,
    blockHeight: 100,
    confirmed: true,
    projectionModel: WORK_SUBATOM_PROJECTION_MODEL,
    transferVersion: "send2",
  }).valid,
  true,
);
assert.equal(
  workAmoV8TransferEraDecision({
    activationHeight: 101,
    blockHeight: 101,
    confirmed: true,
    projectionModel: WORK_SUBATOM_PROJECTION_MODEL,
    transferVersion: "send2",
  }).reasonCode,
  "work-amo-v8-send3-required",
);
assert.equal(
  workAmoV8TransferEraDecision({
    activationHeight: 101,
    blockHeight: 100,
    confirmed: true,
    projectionModel: WORK_LEGACY_ATOMIC_PROJECTION_MODEL,
    transferVersion: WORK_AMO_V8_TRANSFER_VERSION,
  }).reasonCode,
  "work-amo-v8-send3-before-activation",
);
assert.equal(
  workAmoV8TransferEraDecision({
    activationHeight: 101,
    blockHeight: 101,
    confirmed: true,
    projectionModel: WORK_SUBATOM_PROJECTION_MODEL,
    transferVersion: WORK_AMO_V8_TRANSFER_VERSION,
  }).valid,
  true,
);

const declarationCommitment = workAmoV8DeclarationCommitment();
assert.equal(
  declarationCommitment.protocolRecord,
  `pwm1:m:${declarationCommitment.text}`,
);
assert.equal(declarationCommitment.payloadBytes, 5_586);
assert.equal(
  declarationCommitment.payloadSha256,
  "0ef1432816fb93480b02a5302ce1c074d38f84a38e01150d57cf1df87d68024d",
);
assert.equal(declarationCommitment.protocolRecordBytes, 5_593);
assert.equal(
  declarationCommitment.protocolRecordSha256,
  "1ba53b285f95f8d69f0272c8e75c76b09cd3bd26281c68e665749368e7694528",
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
  /unitIdentity=one historical atom is exactly 0\.00000001 WORK and converts to exactly 100000000 subatoms; one subatom is exactly 0\.0000000000000001 WORK/u,
);
assert.match(
  declarationCommitment.text,
  /pwt1:send3:<token-id>:<amount-subatoms>:<recipient>/u,
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
  /no legacy precision or listing protocol is re-enabled after activation/u,
);
assert.match(
  declarationCommitment.text,
  /earliest exact valid declaration transaction by confirmed block height then transaction index is authoritative/u,
);

function opReturnOutput(text) {
  const payload = Buffer.from(text, "utf8");
  let pushData;
  if (payload.length <= 0x4b) {
    pushData = Buffer.from([payload.length]);
  } else if (payload.length <= 0xff) {
    pushData = Buffer.from([0x4c, payload.length]);
  } else if (payload.length <= 0xffff) {
    pushData = Buffer.alloc(3);
    pushData[0] = 0x4d;
    pushData.writeUInt16LE(payload.length, 1);
  } else {
    throw new RangeError("test OP_RETURN payload exceeds PUSHDATA2");
  }
  return {
    scriptPubKey: {
      hex: Buffer.concat([
        Buffer.from([0x6a]),
        pushData,
        payload,
      ]).toString("hex"),
    },
  };
}

// Local declaration parameters deliberately select a same-block boundary, independent of the historical V8 H+1 rule.
const expandedPins = normalizeExpandedLiquidityPins({
  txid: "e1".repeat(32), blockHash: "a1".repeat(32), blockHeight: 1_000_000,
  blockTransactionIndex: 3, protocolVout: 1, recordOrdinal: 0, registryPaymentVout: 0,
  firstEligibleBlockOffset: 0, firstEligibleTransactionIndex: 1,
});
const expandedRecord = expandedLiquidityDeclarationRecord(expandedPins);
const fixturePayment = { value: 546, scriptpubkey: WORK_AMO_LISTING_REGISTRY_SCRIPT };
const expandedEvidence = {
  transaction: { txid: expandedPins.txid,
    status: { confirmed: true, block_hash: expandedPins.blockHash, block_height: expandedPins.blockHeight },
    vin: [{ prevout: { scriptpubkey: WORK_AMO_V5_DECLARATION_AUTHORITY_SCRIPT_PUBKEY } }],
    vout: [fixturePayment, opReturnOutput(expandedRecord)] },
  canonicalBlock: { hash: expandedPins.blockHash, height: expandedPins.blockHeight,
    tx: [null, null, null, expandedPins.txid] },
  canonicalHash: expandedPins.blockHash,
  indexedPosition: { txid: expandedPins.txid, blockHash: expandedPins.blockHash,
    blockHeight: expandedPins.blockHeight, blockIndex: 3 },
};
assert.deepEqual(verifyExpandedLiquidityDeclaration(expandedPins, expandedEvidence), expandedPins);
for (const change of [
  { canonicalHash: "de".repeat(32) },
  { indexedPosition: null },
  { indexedPosition: { ...expandedEvidence.indexedPosition, blockIndex: 2 } },
  { canonicalBlock: { ...expandedEvidence.canonicalBlock, tx: [] } },
  { transaction: { ...expandedEvidence.transaction, vin: [] } },
  { transaction: { ...expandedEvidence.transaction, status: { confirmed: false } } },
  { transaction: { ...expandedEvidence.transaction, vout: [fixturePayment, opReturnOutput(expandedRecord + "!")] } },
  { transaction: { ...expandedEvidence.transaction, vout: [...expandedEvidence.transaction.vout, fixturePayment] } },
  { transaction: { ...expandedEvidence.transaction, vout: [...expandedEvidence.transaction.vout, opReturnOutput(expandedRecord)] } },
]) assert.equal(verifyExpandedLiquidityDeclaration(expandedPins, { ...expandedEvidence, ...change }), null);
assert.equal(verifyExpandedLiquidityDeclaration({ ...expandedPins, firstEligibleBlockOffset: 1 }, expandedEvidence), null);
for (const [height, index, eligible] of [[999999, 100, false], [1000000, 2, false], [1000000, 3, false],
  [1000000, 4, true], [1000000, 5, true], [1000001, 0, true]]) {
  assert.equal(expandedLiquidityPositionEligible(expandedPins, { blockHash: expandedPins.blockHash,
    blockHeight: height, blockTransactionIndex: index }), eligible);
}
const expandedTip = { height: 1_000_001, blockHash: "a2".repeat(32) };
const expandedReadyInputs = {
  declaration: expandedPins, tipHeight: expandedTip.height, tipHash: expandedTip.blockHash,
  writesEnabled: true, baseAdmissionReady: true, readTip: async () => expandedTip,
  readSchema: async () => true, readCanonicalHash: async () => expandedPins.blockHash,
  readTransition: async (blockHeight, blockHash) => ({ payload: { network: "livenet", blockHeight, blockHash,
    expandedLiquidity: expandedPins, complete: true, blockAtomic: true, invalidZero: true, feeOnce: true,
    transitionChainCommitment: { model: "canonical-work-amo-raw-transition-chain-sha256-v1", sha256: "12".repeat(32) } } }),
};
assert.equal((await expandedLiquidityReadiness(expandedReadyInputs)).listingWritesEnabled, true);
const boundaryInputs = { blockHeight: expandedPins.blockHeight, previousBlockHash: "bc".repeat(32),
  priorTransition: null, configuredPins: expandedPins, readBoundary: async () => expandedPins };
assert.deepEqual(await expandedLiquidityForReplay(boundaryInputs), expandedPins);
const nextReplay = { ...boundaryInputs, blockHeight: expandedPins.blockHeight + 1,
  previousBlockHash: expandedPins.blockHash, configuredPins: null,
  priorTransition: await expandedReadyInputs.readTransition(expandedPins.blockHeight, expandedPins.blockHash),
  readBoundary: async () => { throw new Error("unavailable"); } };
assert.deepEqual(await expandedLiquidityForReplay(nextReplay), expandedPins);
assert.equal(await expandedLiquidityForReplay({ ...nextReplay, previousBlockHash: "de".repeat(32) }), null);
assert.equal(await expandedLiquidityForReplay({ ...nextReplay, blockHeight: nextReplay.blockHeight + 1 }), null);
assert.equal(await expandedLiquidityForReplay({ ...nextReplay, priorTransition: null, configuredPins: expandedPins,
  readBoundary: async () => expandedPins }), null);
for (const height of [expandedPins.blockHeight, expandedTip.height]) {
  assert.equal((await expandedLiquidityReadiness({ ...expandedReadyInputs,
    readTransition: async (h, hash) => h === height ? null : expandedReadyInputs.readTransition(h, hash),
  })).listingWritesEnabled, false);
}
for (const change of [{ declaration: null }, { writesEnabled: false }, { baseAdmissionReady: false },
  { readSchema: async () => false }, { readTip: async () => ({ ...expandedTip, blockHash: "de".repeat(32) }) },
  { readTransition: async () => { throw new Error("fixture offline"); } }]) {
  assert.equal((await expandedLiquidityReadiness({ ...expandedReadyInputs, ...change })).listingWritesEnabled, false);
}

{
  const recordUrl = new URL("../declarations/work-amo-expanded-liquidity.txt", import.meta.url);
  const savedBytes = readFileSync(recordUrl);
  const boundary = { firstEligibleBlockOffset: 1, firstEligibleTransactionIndex: 0 };
  const approvedRecord = expandedLiquidityDeclarationRecord(boundary);
  const expectedHash = "3da8dd990f9beaafa2d1b296924e7ec0065b5ba0701bb39ee9ac0f05b4d11fd4";
  assert.equal(savedBytes.length, 1407);
  assert.notEqual(savedBytes.at(-1), 0x0a);
  assert.deepEqual(savedBytes, Buffer.from(approvedRecord, "utf8"));
  assert.equal(createHash("sha256").update(savedBytes).digest("hex"), expectedHash);

  const pins = normalizeExpandedLiquidityPins({ ...expandedPins, ...boundary });
  assert.equal(pins.recordSha256, expectedHash);
  const carrier = opReturnOutput(savedBytes.toString("utf8"));
  const parsed = canonicalProtocolCandidateFromOutput(carrier);
  assert.equal(parsed.decodeValid, true);
  assert.equal(parsed.text, approvedRecord);

  const evidence = { ...expandedEvidence, transaction: {
    ...expandedEvidence.transaction, vout: [fixturePayment, carrier],
  } };
  const verified = verifyExpandedLiquidityDeclaration(pins, evidence);
  assert.deepEqual(verified, pins);
  const declarationPosition = { blockHash: pins.blockHash, blockHeight: pins.blockHeight,
    blockTransactionIndex: pins.blockTransactionIndex };
  const opening = { blockHash: expandedTip.blockHash, blockHeight: pins.blockHeight + 1, blockTransactionIndex: 0 };
  assert.equal(expandedLiquidityPositionEligible(verified, declarationPosition), false);
  assert.equal(expandedLiquidityPositionEligible(verified, { ...declarationPosition,
    blockTransactionIndex: declarationPosition.blockTransactionIndex + 1 }), false);
  assert.equal(expandedLiquidityPositionEligible(verified, opening), true);
  assert.equal(expandedLiquidityPositionEligible(verified, { ...opening, blockTransactionIndex: 1 }), true);
  for (const unavailable of [{ ...evidence, canonicalHash: "de".repeat(32) }, { ...evidence, indexedPosition: null }]) {
    assert.equal(expandedLiquidityPositionEligible(verifyExpandedLiquidityDeclaration(pins, unavailable), opening), false);
  }
}

{
  // Public transaction fields. The block vector is sparse except for the verified transaction index.
  const txid = "57eb549372f2318bfc3ade62c62e9e1092cd42702e9ffb5e2733659acc241f33";
  const blockHeight = 977229;
  const blockHash = "0000000000000000000113f979011a14bdcecdb509671b763fc60a02ebaccbc9";
  const blockTransactionIndex = 591;
  const configured = { txid, blockHeight, blockHash, blockTransactionIndex, protocolVout: 1, recordOrdinal: 0,
    registryPaymentVout: null, firstEligibleBlockOffset: 1, firstEligibleTransactionIndex: 0 };
  const authority = WORK_AMO_V5_DECLARATION_AUTHORITY_SCRIPT_PUBKEY;
  const record = readFileSync(new URL("../declarations/work-amo-expanded-liquidity.txt", import.meta.url), "utf8");
  const mailOutput = (text) => ({ value: 0, scriptpubkey: opReturnOutput(text).scriptPubKey.hex });
  const wrapped = "pwm1:m:" + record;
  const carrier = mailOutput(wrapped);
  assert.equal(createHash("sha256").update(Buffer.from(carrier.scriptpubkey, "hex")).digest("hex"),
    "27638b9bdd1f312cf8eb68f419174b4a83b45ef42ce4072803abefbc759fc900");
  const self = { value: 546, scriptpubkey: authority };
  const change = { value: 2222, scriptpubkey: authority };
  const input = { txid: "c61b5aec19fc4c66b4653a30b48a5ffc8f19b96c978e871ed661ae45479cb582",
    vout: 0, prevout: { value: 3019, scriptpubkey: authority } };
  const transaction = { txid, vin: [input], vout: [self, carrier, change],
    status: { confirmed: true, block_height: blockHeight, block_hash: blockHash } };
  const blockTransactions = Array(blockTransactionIndex + 1).fill(null);
  blockTransactions[blockTransactionIndex] = txid;
  const evidence = { transaction, canonicalHash: blockHash,
    canonicalBlock: { hash: blockHash, height: blockHeight, tx: blockTransactions },
    indexedPosition: { txid, blockHash, blockHeight, blockIndex: blockTransactionIndex } };
  const verified = verifyExpandedLiquidityDeclaration(configured, evidence);
  assert.ok(verified, "only the confirmed, canonical and indexed published envelope can qualify");
  assert.deepEqual(verified, normalizeExpandedLiquidityPins(configured));
  assert.equal(verified.recordSha256, "3da8dd990f9beaafa2d1b296924e7ec0065b5ba0701bb39ee9ac0f05b4d11fd4");
  assert.equal(verified.carrierPayloadSha256, "d046f13915f8fd9d2422d8fd41134b2f6447649b289982cd2e27fd6321488476");
  assert.equal(verified.recognition, "exact-declaration-txid-exception");
  assert.equal(verified.registryPaymentVout, null);
  assert.equal(verified.registryPaymentSats, 0);
  assert.equal(verified.selfPaymentVout, 0);
  assert.equal(verified.selfPaymentSats, 546);

  for (const [label, outputs] of [
    ["missing outer wrapper", [self, mailOutput(record), change]],
    ["extra wrapper", [self, mailOutput("pwm1:m:" + wrapped), change]],
    ["different inner bytes", [self, mailOutput(wrapped + "\n"), change]],
    ["same text with an extra empty push", [self, { ...carrier, scriptpubkey: carrier.scriptpubkey + "00" }, change]],
    ["carrier at a different output", [self, change, carrier]],
    ["nonzero carrier", [self, { ...carrier, value: 1 }, change]],
    ["self output has wrong value", [{ ...self, value: 545 }, carrier, change]],
    ["self output has wrong script", [{ ...self, scriptpubkey: "51" }, carrier, change]],
    ["self output at wrong index", [change, carrier, self]],
    ["different change output", [self, carrier, { ...change, value: 2221 }]],
    ["different change script", [self, carrier, { ...change, scriptpubkey: "51" }]],
    ["extra registry payment", [self, carrier, change, fixturePayment]],
    ["extra matching carrier", [self, carrier, change, carrier]],
    ["standard declaration substituted at the pinned txid", [fixturePayment, mailOutput(record), change]],
  ]) {
    assert.equal(verifyExpandedLiquidityDeclaration(configured, {
      ...evidence, transaction: { ...transaction, vout: outputs },
    }), null, label);
  }
  for (const vin of [[], [{ ...input, prevout: { ...input.prevout, scriptpubkey: "51" } }],
    [{ ...input, txid: expandedPins.txid }], [{ ...input, vout: 1 }],
    [{ ...input, prevout: { ...input.prevout, value: 3018 } }], [input, input]]) {
    assert.equal(verifyExpandedLiquidityDeclaration(configured, { ...evidence, transaction: { ...transaction, vin } }), null);
  }
  const { registryPaymentVout, ...omittedRegistryPin } = configured;
  for (const wrongPins of [omittedRegistryPin, { ...configured, registryPaymentVout: 0 },
    { ...configured, protocolVout: 2 }, { ...configured, recordOrdinal: 1 },
    { ...configured, firstEligibleBlockOffset: 0, firstEligibleTransactionIndex: 1 },
    { ...configured, blockHash: expandedPins.blockHash }, { ...configured, blockHeight: blockHeight + 1 },
    { ...configured, blockTransactionIndex: blockTransactionIndex + 1 }]) {
    assert.equal(verifyExpandedLiquidityDeclaration(wrongPins, evidence), null);
  }
  for (const patch of [{ transaction: { ...transaction, status: { confirmed: false } } },
    { canonicalHash: expandedPins.blockHash }, { canonicalHash: null }, { canonicalBlock: null },
    { canonicalBlock: { ...evidence.canonicalBlock, tx: [] } }, { indexedPosition: null },
    { indexedPosition: { ...evidence.indexedPosition, blockHash: expandedPins.blockHash } },
    { indexedPosition: { ...evidence.indexedPosition, blockIndex: blockTransactionIndex + 1 } }]) {
    assert.equal(verifyExpandedLiquidityDeclaration(configured, { ...evidence, ...patch }), null);
  }

  // Even self-consistent chain and index evidence cannot transfer this exception to a different txid.
  const otherTxid = expandedPins.txid;
  const otherEvidence = { ...evidence, transaction: { ...transaction, txid: otherTxid },
    canonicalBlock: { ...evidence.canonicalBlock, tx: blockTransactions.with(blockTransactionIndex, otherTxid) },
    indexedPosition: { ...evidence.indexedPosition, txid: otherTxid } };
  const otherPins = { ...configured, txid: otherTxid };
  assert.equal(verifyExpandedLiquidityDeclaration(otherPins, otherEvidence), null);
  const normalPins = { ...otherPins, registryPaymentVout: 0 };
  assert.equal(verifyExpandedLiquidityDeclaration(normalPins, otherEvidence), null);
  const standard = verifyExpandedLiquidityDeclaration(normalPins, { ...otherEvidence,
    transaction: { ...otherEvidence.transaction, vout: [fixturePayment, mailOutput(record)] } });
  assert.deepEqual(standard, normalizeExpandedLiquidityPins(normalPins));
  assert.equal(standard.registryPaymentVout, 0);
  assert.equal(verifyExpandedLiquidityDeclaration({ ...configured, registryPaymentVout: 0 }, { ...evidence,
    transaction: { ...transaction, vout: [fixturePayment, mailOutput(record)] } }), null);

  // The following descendant hashes and transition receipts are synthetic local replay fixtures.
  const first = { blockHeight: blockHeight + 1, blockHash: expandedTip.blockHash, blockTransactionIndex: 0 };
  assert.equal(expandedLiquidityPositionEligible(verified, { blockHeight, blockHash, blockTransactionIndex: 592 }), false);
  assert.equal(expandedLiquidityPositionEligible(verified, first), true);
  assert.equal(expandedLiquidityPositionEligible(verified, { ...first, blockTransactionIndex: 1 }), true);
  const replay = { ...boundaryInputs, configuredPins: configured, previousBlockHash: blockHash,
    readBoundary: async () => verifyExpandedLiquidityDeclaration(configured, evidence) };
  assert.equal(await expandedLiquidityForReplay({ ...replay, blockHeight }), null);
  assert.deepEqual(await expandedLiquidityForReplay({ ...replay, blockHeight: first.blockHeight }), verified);
  assert.equal(await expandedLiquidityForReplay({ ...replay, blockHeight: first.blockHeight,
    readBoundary: async () => verifyExpandedLiquidityDeclaration(configured, { ...evidence, indexedPosition: null }) }), null);
  const nextTip = { height: first.blockHeight + 1, blockHash: "cd".repeat(32) };
  const readTransition = async (height, hash) => {
    if (!((height === first.blockHeight && hash === first.blockHash) ||
          (height === nextTip.height && hash === nextTip.blockHash))) return null;
    const transition = await expandedReadyInputs.readTransition(height, hash);
    transition.payload.expandedLiquidity = verified;
    return transition;
  };
  const priorTransition = await readTransition(first.blockHeight, first.blockHash);
  const nextReplay = { blockHeight: nextTip.height, previousBlockHash: first.blockHash, priorTransition,
    configuredPins: null, readBoundary: async () => { throw new Error("unexpected boundary re-read"); } };
  assert.deepEqual(await expandedLiquidityForReplay(nextReplay), verified);
  for (const wrong of [{ registryPaymentVout: 0 }, { selfPaymentSats: 545 }, { carrierPayloadSha256: verified.recordSha256 }]) {
    const altered = { ...priorTransition, payload: { ...priorTransition.payload, expandedLiquidity: { ...verified, ...wrong } } };
    assert.equal(await expandedLiquidityForReplay({ ...nextReplay, priorTransition: altered }), null);
  }
  assert.equal(await expandedLiquidityForReplay({ ...nextReplay, previousBlockHash: expandedPins.blockHash }), null);
  const ready = { ...expandedReadyInputs, declaration: verified, tipHeight: nextTip.height, tipHash: nextTip.blockHash,
    readCanonicalHash: async () => first.blockHash, readTransition, readTip: async () => nextTip };
  assert.equal((await expandedLiquidityReadiness(ready)).listingWritesEnabled, true);
  for (const [height, hash, enabled] of [[blockHeight, blockHash, false], [first.blockHeight, first.blockHash, true]]) {
    assert.equal((await expandedLiquidityReadiness({ ...ready, tipHeight: height, tipHash: hash,
      readTip: async () => ({ height, blockHash: hash }) })).listingWritesEnabled, enabled);
  }
  for (const missingHeight of [first.blockHeight, nextTip.height]) {
    const missing = async (height, hash) => height === missingHeight ? null : readTransition(height, hash);
    assert.equal((await expandedLiquidityReadiness({ ...ready, readTransition: missing })).listingWritesEnabled, false);
    const incomplete = async (height, hash) => {
      const transition = await readTransition(height, hash);
      if (height === missingHeight) {
        const { recognition, ...partial } = verified;
        transition.payload.expandedLiquidity = partial;
      }
      return transition;
    };
    const admission = await expandedLiquidityReadiness({ ...ready, readTransition: incomplete });
    assert.equal(admission.replayReady, false);
    assert.equal(admission.listingWritesEnabled, false);
  }
  for (const patch of [{ declaration: null }, { writesEnabled: false }, { baseAdmissionReady: false },
    { readCanonicalHash: async () => null }, { readCanonicalHash: async () => expandedPins.blockHash },
    { readSchema: async () => false }, { readTip: async () => ({ ...nextTip, blockHash: expandedPins.blockHash }) }]) {
    assert.equal((await expandedLiquidityReadiness({ ...ready, ...patch })).listingWritesEnabled, false);
  }
}

const declarationMailEnvelope = {
  vout: [
    { scriptPubKey: { hex: "76a914" + "11".repeat(20) + "88ac" } },
    opReturnOutput("pwm1:s:VjggRGVjbGFyYXRpb24"),
    opReturnOutput(`pwm1:r:${"ab".repeat(32)}`),
    opReturnOutput(declarationCommitment.protocolRecord),
    { scriptPubKey: { hex: "76a914" + "22".repeat(20) + "88ac" } },
    opReturnOutput(
      `pwt1:send2:${WORK_TOKEN_ID}:100000000:1F1p9UEHuH5KTFR7Zsx93Khdrqhj6t5nFv`,
    ),
  ],
};
const declarationCarrier = workAmoV8DeclarationCarrierEvidence(
  declarationMailEnvelope,
  {
    commitment: declarationCommitment,
    protocolVout: 3,
    recordOrdinal: 0,
  },
);
assert.equal(declarationCarrier?.protocol, "pwm1");
assert.equal(declarationCarrier?.protocolVout, 3);
assert.equal(declarationCarrier?.recordOrdinal, 0);
assert.equal(
  declarationCarrier?.payloadSha256,
  declarationCommitment.protocolRecordSha256,
);
assert.equal(
  workAmoV8DeclarationCarrierEvidence(declarationMailEnvelope, {
    commitment: declarationCommitment,
    protocolVout: 1,
    recordOrdinal: 0,
  }),
  null,
  "the subject-position PWM aggregate must not replace the exact declaration carrier",
);
assert.equal(
  workAmoV8DeclarationCarrierEvidence(
    {
      vout: [
        ...declarationMailEnvelope.vout,
        opReturnOutput(declarationCommitment.protocolRecord),
      ],
    },
    {
      commitment: declarationCommitment,
      protocolVout: 3,
      recordOrdinal: 0,
    },
  ),
  null,
  "duplicate exact declaration carriers must fail closed",
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
    ...WORK_AMO_V8_MODELS,
    anchorScriptPubKey: `5120${"ab".repeat(32)}`,
    anchorSigHashType: 0x83,
    anchorType: "sale-ticket-v1",
    anchorValueSats: 546,
    anchorVout: 2,
    buyerAddress: "",
    expiresAt: "",
    network: "livenet",
    nonce: "amo-v8-q16-check",
    registryAddress: WORK_AMO_V5_DECLARATION_REGISTRY_ADDRESS,
    sellerAddress,
    sellerPublicKey:
      "0306baa226e3a87a99547df2144f2e6206a4a479a46df41ec1618945c064568237",
    ticker: "WORK",
    tokenId: WORK_TOKEN_ID,
    unitFaceProofs: 25_000,
    version: WORK_AMO_V8_AUTH_VERSION,
    ...overrides,
  };
}

for (const face of WORK_AMO_V8_ALLOWED_FACE_PROOFS) {
  const terms = calculateWorkAmoV8UnitTerms({
    networkValueBeforeQ8:
      WORK_AMO_V5_MAX_SUPPLY *
      WORK_AMO_V5_NETWORK_VALUE_Q8_SCALE,
    unitFaceProofs: face,
  });
  assert.equal(terms.valid, true);
  assert.equal(terms.unitPriceSats, String(face));
  assert.equal(
    terms.unitAmountSubatoms,
    (BigInt(face) * WORK_AMO_V8_SUBATOMS_PER_WORK).toString(),
  );
  assert.equal(terms.unitMinimumPriceSats, String(face));
  assert.equal(terms.unitAmountAtoms, undefined);
}
for (const face of [20_000, 24_999, 25_001, 50_000, 100_000]) {
  assert.equal(
    calculateWorkAmoV8UnitTerms({
      networkValueBeforeQ8:
        WORK_AMO_V5_MAX_SUPPLY *
        WORK_AMO_V5_NETWORK_VALUE_Q8_SCALE,
      unitFaceProofs: face,
    }).reasonCode,
    "work-amo-v8-face-unit-invalid",
  );
}

const roundingNetworkValue =
  WORK_AMO_V5_MAX_SUPPLY *
    WORK_AMO_V5_NETWORK_VALUE_Q8_SCALE +
  1n;
const roundingTerms = calculateWorkAmoV8UnitTerms({
  networkValueBeforeQ8: roundingNetworkValue,
  unitFaceProofs: 25_000,
});
assert.equal(
  BigInt(roundingTerms.unitAmountSubatoms),
  (25_000n * formulaDenominator) / roundingNetworkValue,
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
    WORK_AMO_V8_LEGACY_ATOM_TO_SUBATOM_SCALE,
  0n,
  "V8 must preserve derived precision below the historical atom",
);

assert.equal(
  validateWorkAmoV8StaticAuthorization(authorization()).valid,
  true,
);
assert.equal(
  validateWorkAmoV8StaticAuthorization(
    authorization({ unitAmountSubatoms: "1" }),
  ).reasonCode,
  "work-amo-v8-derived-fields-not-signable",
);
assert.equal(
  validateWorkAmoV8StaticAuthorization(
    authorization({ version: WORK_AMO_V6_AUTH_VERSION }),
  ).reasonCode,
  "work-amo-v8-version-required",
);
assert.equal(
  validateWorkAmoV8StaticAuthorization(
    authorization({ amountModel: "wrong" }),
  ).reasonCode,
  "work-amo-v8-models-invalid",
);

assert.equal(
  validateWorkAmoV8ListingCutover({
    activationHeight,
    authorizationVersion: WORK_AMO_V6_AUTH_VERSION,
    listingPosition: listingPosition({
      blockHeight: activationHeight - 1,
    }),
  }).valid,
  true,
);
assert.equal(
  validateWorkAmoV8ListingCutover({
    activationHeight,
    authorizationVersion: WORK_AMO_V6_AUTH_VERSION,
    listingPosition: listingPosition(),
  }).reasonCode,
  "work-amo-v8-version-required",
);
assert.equal(
  validateWorkAmoV8ListingCutover({
    activationHeight,
    authorizationVersion: WORK_AMO_V8_AUTH_VERSION,
    listingPosition: listingPosition({
      blockHeight: activationHeight - 1,
    }),
  }).reasonCode,
  "work-amo-v8-listing-before-activation",
);
assert.equal(
  validateWorkAmoV8ListingCutover({
    activationHeight,
    authorizationVersion: WORK_AMO_V8_AUTH_VERSION,
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
  25_000n * WORK_AMO_V8_SUBATOMS_PER_WORK;
const derived = deriveWorkAmoV8FrozenTerms(authorization(), {
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
  validateWorkAmoV8FrozenTerms(derived.frozenTerms, {
    authorization: authorization(),
    listingBondContributionQ8,
    listingPosition: listingPosition(),
    networkValueBeforeQ8,
  }).valid,
  true,
);
assert.equal(
  deriveWorkAmoV8FrozenTerms(authorization(), {
    activationHeight,
    listingBondContributionQ8,
    listingPosition: listingPosition(),
    networkValueBeforeQ8,
    spendableAmountSubatoms: expectedAmountSubatoms - 1n,
  }).reasonCode,
  "work-amo-v8-insufficient-spendable-balance",
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
      priceSats: "25000",
      saleAuthorization: authorization(),
      sellerAddress,
    },
  ],
};
const v7Preimage = workAmoV8CanonicalTokenStatePreimage(v7State);
assert.equal(
  v7Preimage.definition.amountStorageModel,
  "work-subatoms-v2",
);
assert.equal(v7Preimage.definition.decimals, 16);
assert.equal(
  v7Preimage.definition.maxSupplySubatoms,
  WORK_AMO_V8_MAX_SUPPLY_SUBATOMS.toString(),
);
assert.equal(
  v7Preimage.definition.mintAmountSubatoms,
  WORK_AMO_V8_MINT_AMOUNT_SUBATOMS.toString(),
);
assert.equal(
  v7Preimage.definition.precisionModel,
  WORK_AMO_V8_GLOBAL_PRECISION_MODEL,
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
  workAmoV8CanonicalTokenStatePreimage(v7Preimage),
  v7Preimage,
);
const v7Commitment =
  workAmoV8CanonicalTokenStateCommitment(v7State);
assert.deepEqual(
  v7Commitment,
  workAmoV8CanonicalTokenStateCommitment(v7Preimage),
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
  confirmedSupplySubatoms: WORK_AMO_V8_SUBATOMS_PER_WORK.toString(),
  holders: [
    {
      address: firstV6ListingSeller,
      balanceSubatoms:
        WORK_AMO_V8_SUBATOMS_PER_WORK.toString(),
    },
  ],
  listings: [
    {
      amountSubatoms: (
        10n * WORK_AMO_V8_LEGACY_ATOM_TO_SUBATOM_SCALE
      ).toString(),
      frozenTerms: firstV6ListingFrozenTerms,
      listingId: firstV6ListingTxid,
      priceSats: "20000",
      saleAuthorization: firstV6ListingAuthorization,
      sellerAddress: firstV6ListingSeller,
    },
  ],
};
assert.throws(
  () => workAmoV8CanonicalTokenStatePreimage(migratedFirstV6State),
  /work-amo-v8-token-state-listing-invalid/u,
  "pre-V8 listings cannot enter the active V8 reservation state",
);

const actionPosition = {
  blockHash: actionBlockHash,
  blockHeight: listingBlockHeight + 1,
  blockTransactionIndex: 0,
  protocolVout: 1,
  recordOrdinal: 0,
};
assert.equal(
  validateWorkAmoV8SealOrBuyTerms({
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
  validateWorkAmoV8SealOrBuyTerms({
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
  }).reasonCode,
  "work-amo-v8-relic-listing-nonsettleable",
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
  compareWorkAmoV8CanonicalPositions(
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
const replay = replayWorkAmoV8CanonicalBlock({
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
assert.equal(replay.model, WORK_AMO_V8_BLOCK_SEQUENCER_MODEL);
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
  validateWorkAmoV8DeclarationEvidence(declarationEvidence, {
    expectedDeclaration,
  }).valid,
  true,
);
assert.equal(
  workAmoV8ActivationFromEvidence(declarationEvidence, {
    expectedDeclaration,
    indexedThroughBlock: listingBlockHeight,
  }).active,
  true,
);
const declarationBlockStatus = workAmoV8StatusFromEvidence({
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
  workAmoV8StatusFromEvidence({
    evidence: declarationEvidence,
    expectedDeclaration,
    indexedThroughBlock: listingBlockHeight,
    precisionMigrationReady: false,
    protocolWritesEnabled: true,
  }).reasonCode,
  "work-amo-v8-precision-migration-not-ready",
);
const readyStatus = workAmoV8StatusFromEvidence({
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
const reachedWithoutEvidence = workAmoV8StatusFromEvidence({
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
assert.equal(
  reachedWithoutEvidence.activation.reasonCode,
  "work-amo-v8-declaration-evidence-unavailable",
);
assert.equal(reachedWithoutEvidence.protocolReady, false);
assert.equal(reachedWithoutEvidence.writeAdmission, false);
assert.equal(
  workAmoV8StatusFromEvidence({
    evidence: { ...declarationEvidence, payloadBytes: 1 },
    expectedDeclaration,
    indexedThroughBlock: listingBlockHeight,
    precisionMigrationReady: true,
    protocolWritesEnabled: true,
  }).activation.reasonCode,
  "work-amo-v8-declaration-evidence-mismatch",
);
assert.deepEqual(
  workAmoV8BroadcastDecision(
    [
      {
        action: "list5",
        authVersion: WORK_AMO_V8_AUTH_VERSION,
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
assert.deepEqual(
  workAmoV8BroadcastDecision(
    [
      {
        action: "seal5",
        authVersion: WORK_AMO_V8_AUTH_VERSION,
        canonicalParsed: true,
        paysWorkRegistry: true,
        registryAddress:
          WORK_AMO_V5_DECLARATION_REGISTRY_ADDRESS,
        signedShapeChecks: {
          actorMatches: false,
          buyerLockMatches: true,
          delistSpendsListingAnchor: true,
          frozenPaymentMatches: true,
          frozenTermsReady: true,
          referencedTermsMatch: true,
          staticShapeValid: true,
        },
        signedShapeValid: false,
        ticker: "WORK",
        tokenId: WORK_TOKEN_ID,
        tokenProtocolMessageCount: 1,
      },
    ],
    { metadata: readyStatus },
  ),
  {
    allowed: false,
    code: "WORK_AMO_V8_TRANSACTION_INVALID",
    hint: "Signed WORK AMO V8 shape failed actorMatches.",
    reasonCode: "work-amo-v8-actor-proof-invalid",
    shapeChecks: {
      actorMatches: false,
      buyerLockMatches: true,
      delistSpendsListingAnchor: true,
      frozenPaymentMatches: true,
      frozenTermsReady: true,
      referencedTermsMatch: true,
      staticShapeValid: true,
    },
    statusCode: 400,
  },
);
assert.deepEqual(
  workAmoV8BroadcastDecision(
    [
      {
        action: "seal5",
        authVersion: WORK_AMO_V8_AUTH_VERSION,
        canonicalParsed: true,
        paysWorkRegistry: true,
        registryAddress:
          WORK_AMO_V5_DECLARATION_REGISTRY_ADDRESS,
        signedShapeChecks: {
          actorMatches: false,
          buyerLockMatches: true,
          delistSpendsListingAnchor: true,
          frozenPaymentMatches: true,
          frozenTermsReady: false,
          referencedTermsMatch: false,
          staticShapeValid: true,
        },
        signedShapeValid: false,
        ticker: "WORK",
        tokenId: WORK_TOKEN_ID,
        tokenProtocolMessageCount: 1,
      },
    ],
    { metadata: readyStatus },
  ),
  {
    allowed: false,
    code: "WORK_AMO_V8_TRANSACTION_INVALID",
    hint: "Signed WORK AMO V8 shape failed frozenTermsReady.",
    reasonCode: "work-amo-v8-frozen-terms-unavailable",
    shapeChecks: {
      actorMatches: false,
      buyerLockMatches: true,
      delistSpendsListingAnchor: true,
      frozenPaymentMatches: true,
      frozenTermsReady: false,
      referencedTermsMatch: false,
      staticShapeValid: true,
    },
    statusCode: 400,
  },
);
assert.equal(
  workAmoV8BroadcastDecision(
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
  "work-amo-v8-version-required",
);
const validV8DelistAction = {
  action: "delist5",
  authVersion: WORK_AMO_V8_AUTH_VERSION,
  canonicalParsed: true,
  listingAuthorization: authorization(),
  listingFrozenTerms: derived.frozenTerms,
  listingPosition: listingPosition(),
  paysWorkRegistry: true,
  registryAddress: WORK_AMO_V5_DECLARATION_REGISTRY_ADDRESS,
  saleAuthorization: authorization(),
  signedShapeValid: true,
  ticker: "WORK",
  tokenId: WORK_TOKEN_ID,
  tokenProtocolMessageCount: 1,
};
assert.deepEqual(
  workAmoV8BroadcastDecision([validV8DelistAction], {
    metadata: readyStatus,
  }),
  { allowed: true },
  "an exact seller-signed V8 sale-ticket delist remains available",
);
assert.equal(
  workAmoV8BroadcastDecision(
    [{
      ...validV8DelistAction,
      authVersion: WORK_AMO_V6_AUTH_VERSION,
      listingAuthorization: firstV6ListingAuthorization,
      listingFrozenTerms: firstV6ListingFrozenTerms,
      saleAuthorization: firstV6ListingAuthorization,
    }],
    { metadata: readyStatus },
  ).reasonCode,
  "work-amo-v8-relic-listing-nonsettleable",
  "pre-V8 relics cannot re-enter governed mutation through delist5",
);
assert.equal(
  workAmoV8BroadcastDecision([validV8DelistAction], {
    metadata: {
      ...readyStatus,
      protocolWritesEnabled: false,
      reasonCode: "work-amo-v8-writes-paused",
    },
  }).reasonCode,
  "work-amo-v8-writes-paused",
  "V8 delist admission fails closed with every other governed write",
);

const readinessTipHeight = 1_200_321;
const readinessTipHash = "ab".repeat(32);
const readinessFinishedAt = "2026-08-01T12:34:56.000Z";
const successfulWorkPrecision = {
  era: "q16",
  replay: {
    era: "q16",
    mempoolCount: 12,
    mempoolSha256: "bc".repeat(32),
    pendingMembershipCount: 3,
    pendingMembershipSha256: "cd".repeat(32),
    pendingProjectionSha256: "de".repeat(32),
    ready: true,
    replayRequired: true,
    tipHash: readinessTipHash,
    tipHeight: readinessTipHeight,
  },
};
const successfulWorker = {
  finishedAt: readinessFinishedAt,
  lastSuccess: {
    finishedAt: readinessFinishedAt,
    workPrecision: successfulWorkPrecision,
  },
  lastSuccessAt: readinessFinishedAt,
  network: "livenet",
  ok: true,
  state: "idle",
  workPrecision: successfulWorkPrecision,
};
const readinessOptions = {
  liveMempoolSnapshot: {
    count: 12,
    model: "canonical-core-mempool-txid-set-v1",
    sha256: "bc".repeat(32),
  },
  network: "livenet",
  tipHash: readinessTipHash,
  tipHeight: readinessTipHeight,
};
assert.equal(
  exactWorkAmoV8WorkerReadiness(
    { network: "livenet", worker: successfulWorker },
    readinessOptions,
  ).ready,
  true,
  "the exact idle Q16 worker proof is ready",
);
for (const state of ["starting", "running", "canonical-phase-complete"]) {
  const transientWorker = {
    ...successfulWorker,
    finishedAt: undefined,
    ok: state === "canonical-phase-complete" ? false : true,
    state,
    workPrecision: {
      era: "q16",
      replay: {
        era: "q16",
        pendingRequired: true,
        ready: false,
        replayRequired: true,
      },
    },
  };
  assert.equal(
    exactWorkAmoV8WorkerReadiness(
      { network: "livenet", worker: transientWorker },
      readinessOptions,
    ).ready,
    true,
    `${state} preserves the last fully successful Q16 proof`,
  );
}
assert.equal(
  exactWorkAmoV8WorkerReadiness(
    {
      network: "livenet",
      worker: {
        ...successfulWorker,
        finishedAt: undefined,
        lastSuccess: {
          finishedAt: readinessFinishedAt,
          workPrecision: {
            era: "q16",
            replay: {
              confirmed: {
                era: "q16",
                ready: true,
                replayRequired: true,
                tipHash: readinessTipHash,
                tipHeight: readinessTipHeight,
              },
              era: "q16",
              pendingError: "pending witness unavailable",
              pendingReady: false,
              pendingRequired: true,
              ready: false,
              replayRequired: true,
            },
          },
        },
        workPrecision: {
          era: "q16",
          replay: {
            era: "q16",
            pendingReady: false,
            pendingRequired: true,
            ready: false,
            replayRequired: true,
          },
        },
      },
    },
    readinessOptions,
  ).ready,
  true,
  "idle Q16 readiness preserves a matching durable confirmed proof while pending remains unavailable",
);
for (const [label, workerPatch] of [
  ["active error", { error: "pending verifier failed" }],
  ["consecutive failure", { consecutiveFailures: 1 }],
  ["containment", { noProgress: { active: true } }],
  ["precision recovery error", { workPrecisionRecoveryError: "repair failed" }],
  [
    "precision recovery requirement",
    {
      workPrecision: {
        ...successfulWorkPrecision,
        readinessRecoveryRequired: true,
      },
    },
  ],
  [
    "precision readiness error",
    {
      workPrecision: {
        ...successfulWorkPrecision,
        readinessError: "recovery incomplete",
      },
    },
  ],
]) {
  assert.equal(
    exactWorkAmoV8WorkerLastSuccessReadiness(
      {
        network: "livenet",
        worker: {
          ...successfulWorker,
          finishedAt: undefined,
          ok: false,
          state: "canonical-phase-complete",
          ...workerPatch,
        },
      },
      readinessOptions,
    ).ready,
    false,
    `${label} closes durable transitional readiness`,
  );
}
assert.equal(
  exactWorkAmoV8WorkerReadiness(
    {
      network: "livenet",
      worker: { ...successfulWorker, state: "failed-retrying" },
    },
    readinessOptions,
  ).ready,
  false,
  "an explicit worker failure state closes readiness",
);
assert.equal(
  exactWorkAmoV8WorkerReadiness(
    {
      network: "livenet",
      worker: {
        ...successfulWorker,
        lastSuccess: { finishedAt: readinessFinishedAt },
        state: "running",
      },
    },
    readinessOptions,
  ).ready,
  false,
  "a transient state without a durable successful proof is closed",
);
assert.equal(
  exactWorkAmoV8WorkerReadiness(
    { network: "livenet", worker: successfulWorker },
    { ...readinessOptions, tipHeight: readinessTipHeight + 1 },
  ).ready,
  false,
  "a new canonical tip invalidates the prior worker proof",
);
assert.equal(
  exactWorkAmoV8WorkerReadiness(
    {
      network: "livenet",
      worker: {
        ...successfulWorker,
        workPrecision: {
          ...successfulWorkPrecision,
          replay: {
            ...successfulWorkPrecision.replay,
            pendingProjectionSha256: "ef".repeat(32),
          },
        },
      },
    },
    readinessOptions,
  ).ready,
  false,
  "idle metadata cannot disagree with its durable proof",
);

process.stdout.write(
  `${JSON.stringify(
    {
      allowedFaceProofs: WORK_AMO_V8_ALLOWED_FACE_PROOFS,
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
      precisionModel: WORK_AMO_V8_PRECISION_MODEL,
      status: "ok",
      subatomsPerWork:
        WORK_AMO_V8_SUBATOMS_PER_WORK.toString(),
      version: WORK_AMO_V8_AUTH_VERSION,
    },
    null,
    2,
  )}\n`,
);
