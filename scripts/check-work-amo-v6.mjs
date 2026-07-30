import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import * as bitcoin from "bitcoinjs-lib";
import {
  canonicalRawProtocolRecordSetFromTransaction,
} from "../server/canonical-op-return.mjs";
import {
  WORK_AMO_V6_ALLOWED_FACE_PROOFS,
  WORK_AMO_V6_AUTH_VERSION,
  WORK_AMO_V6_BLOCK_SEQUENCER_MODEL,
  WORK_AMO_V6_MODELS,
  WORK_AMO_V6_ATOMS_PER_WORK,
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
  workAmoV6CanonicalTokenStateCommitment,
  workAmoV6CanonicalTokenStatePreimage,
  workAmoV6FrozenTermsMatch,
  workAmoV6StatusFromEvidence,
} from "../server/work-amo-v6.mjs";
import {
  WORK_AMO_V4_AUTH_VERSION,
  WORK_AMO_V4_ORACLE_MODEL,
  WORK_AMO_V4_UNIT_MODEL,
  WORK_AMO_V5_ACTIVATION_HEIGHT,
  WORK_AMO_V5_AMOUNT_MODEL,
  WORK_AMO_V5_ATOMS_PER_WORK,
  WORK_AMO_V5_AUTH_VERSION,
  WORK_AMO_V5_BASE_STATE_FIELDS,
  WORK_AMO_V5_DECLARATION_AUTHORITY_SCRIPT_PUBKEY,
  WORK_AMO_V5_DECLARATION_MIN_PAYMENT_SATS,
  WORK_AMO_V5_DECLARATION_REGISTRY_ADDRESS,
  WORK_AMO_V5_BOND_TRANSITION_MODEL,
  WORK_AMO_V5_MAX_SUPPLY,
  WORK_AMO_V5_NETWORK_ACCUMULATOR_MODEL,
  WORK_AMO_V5_NETWORK_VALUE_Q8_SCALE,
  WORK_AMO_V5_STATE_ORDER_MODEL,
  WORK_AMO_V5_UNIT_MODEL,
  WORK_AMO_V5_UNIT_USD_ORACLE_MODEL,
  WORK_AMO_V5_UNIT_WORK_ORACLE_MODEL,
  WORK_AMO_V5_V1_DECLARATION_TXID,
  deriveWorkAmoV5FrozenTerms,
  validateWorkAmoUsdQuoteEvidence,
  workAmoV5CanonicalTokenStateCommitment,
  workAmoV5CanonicalTokenStatePreimage,
} from "../server/work-amo-v5.mjs";
import {
  normalizeWorkAmoV5RawGenericState,
  normalizeWorkAmoV5RawIdState,
  normalizeWorkAmoV5RawWorkState,
  replayWorkAmoV5RawBlock,
  workAmoV5RawGenericStateCommitment,
  workAmoV5RawIdStateCommitment,
} from "../server/work-amo-v5-raw.mjs";
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
  WORK_AMO_V5_MAX_SUPPLY * WORK_AMO_V6_ATOMS_PER_WORK;
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
    (BigInt(face) * WORK_AMO_V6_ATOMS_PER_WORK).toString(),
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
const expectedAmount = 20_000n * WORK_AMO_V6_ATOMS_PER_WORK;
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
  unitAmountAtoms: "1031775518",
  unitFaceProofs: 20_000,
  unitMinimumPriceSats: "20000",
  unitPriceSats: "20000",
  version: WORK_AMO_V6_AUTH_VERSION,
};
const firstV6ListingAmountAtoms = firstV6ListingFrozenTerms.unitAmountAtoms;
const firstV6ListingState = {
  confirmedSupplyAtoms: firstV6ListingAmountAtoms,
  holders: [
    {
      address: firstV6ListingSeller,
      balanceAtoms: firstV6ListingAmountAtoms,
    },
  ],
  listings: [
    {
      amountAtoms: firstV6ListingAmountAtoms,
      frozenTerms: firstV6ListingFrozenTerms,
      listingId: firstV6ListingTxid,
      priceSats: "20000",
      saleAuthorization: firstV6ListingAuthorization,
      sellerAddress: firstV6ListingSeller,
    },
  ],
};
assert.equal(
  validateWorkAmoV6StaticAuthorization(
    firstV6ListingAuthorization,
  ).valid,
  true,
);
assert.equal(
  validateWorkAmoV6FrozenTerms(firstV6ListingFrozenTerms, {
    authorization: firstV6ListingAuthorization,
  }).valid,
  true,
);
assert.throws(
  () =>
    workAmoV5CanonicalTokenStateCommitment(
      firstV6ListingState,
    ),
  /work-amo-v5-token-state-listing-invalid/u,
  "The historical V4/V5-only canonicalizer must remain closed to V6",
);
const firstV6ListingClosingPreimage =
  workAmoV6CanonicalTokenStatePreimage(
    firstV6ListingState,
  );
const firstV6ListingClosingCommitment =
  workAmoV6CanonicalTokenStateCommitment(
    firstV6ListingState,
  );
assert.equal(
  firstV6ListingClosingPreimage.listings[0].listingId,
  firstV6ListingTxid,
);
assert.equal(
  firstV6ListingClosingPreimage.listings[0].amountAtoms,
  "1031775518",
);
assert.equal(
  firstV6ListingClosingPreimage.listings[0].priceSats,
  "20000",
);
assert.deepEqual(firstV6ListingClosingCommitment, {
  model: "canonical-work-amo-payload-sha256-v1",
  payloadBytes: 2_342,
  sha256:
    "18568d7004a05b9706970ac270d5f475af1f55612c2fd594f040ae05d3d6564c",
});
assert.deepEqual(
  workAmoV6CanonicalTokenStatePreimage(
    firstV6ListingClosingPreimage,
  ),
  firstV6ListingClosingPreimage,
  "Block 960258 closing WORK state must reopen canonically at the next block",
);
assert.deepEqual(
  workAmoV6CanonicalTokenStateCommitment(
    firstV6ListingClosingPreimage,
  ),
  firstV6ListingClosingCommitment,
  "The next block must reopen the exact block 960258 closing commitment",
);

for (const [label, mutate] of [
  [
    "authorization",
    (state) => {
      state.listings[0].saleAuthorization.unitFaceProofs = 50_000;
    },
  ],
  [
    "seller address",
    (state) => {
      const mismatchedSeller =
        "1F1p9UEHuH5KTFR7Zsx93Khdrqhj6t5nFv";
      state.holders[0].address = mismatchedSeller;
      state.listings[0].sellerAddress = mismatchedSeller;
    },
  ],
  [
    "frozen terms",
    (state) => {
      state.listings[0].frozenTerms.unitMinimumPriceSats = "19386";
    },
  ],
  [
    "amount",
    (state) => {
      state.listings[0].amountAtoms = "11";
    },
  ],
  [
    "price",
    (state) => {
      state.listings[0].priceSats = "20001";
    },
  ],
]) {
  const tamperedState = structuredClone(firstV6ListingState);
  mutate(tamperedState);
  assert.throws(
    () =>
      workAmoV6CanonicalTokenStateCommitment(tamperedState),
    /work-amo-v5-token-state-listing-invalid/u,
    `The first V6 listing ${label} must be commitment-invalid`,
  );
}

const firstV6OnchainAuthorization = {
  amountModel: firstV6ListingAuthorization.amountModel,
  anchorScriptPubKey:
    firstV6ListingAuthorization.anchorScriptPubKey,
  anchorSigHashType:
    firstV6ListingAuthorization.anchorSigHashType,
  anchorType: firstV6ListingAuthorization.anchorType,
  anchorValueSats:
    firstV6ListingAuthorization.anchorValueSats,
  anchorVout: firstV6ListingAuthorization.anchorVout,
  bondTransitionModel:
    firstV6ListingAuthorization.bondTransitionModel,
  buyerAddress: firstV6ListingAuthorization.buyerAddress,
  expiresAt: firstV6ListingAuthorization.expiresAt,
  network: firstV6ListingAuthorization.network,
  nonce: firstV6ListingAuthorization.nonce,
  registryAddress:
    firstV6ListingAuthorization.registryAddress,
  sellerAddress: firstV6ListingAuthorization.sellerAddress,
  sellerPublicKey:
    firstV6ListingAuthorization.sellerPublicKey,
  stateOrderModel:
    firstV6ListingAuthorization.stateOrderModel,
  ticker: firstV6ListingAuthorization.ticker,
  tokenId: firstV6ListingAuthorization.tokenId,
  unitFaceProofs:
    firstV6ListingAuthorization.unitFaceProofs,
  unitModel: firstV6ListingAuthorization.unitModel,
  unitWorkOracleModel:
    firstV6ListingAuthorization.unitWorkOracleModel,
  version: firstV6ListingAuthorization.version,
  anchorSignature:
    firstV6ListingAuthorization.anchorSignature,
  anchorTxid: firstV6ListingAuthorization.anchorTxid,
};
assert.deepEqual(
  firstV6OnchainAuthorization,
  firstV6ListingAuthorization,
);
const firstV6ListingMessage =
  `pwt1:list5:${Buffer.from(
    JSON.stringify(firstV6OnchainAuthorization),
    "utf8",
  ).toString("base64url")}`;
const firstV6ListingTransaction = new bitcoin.Transaction();
firstV6ListingTransaction.version = 2;
firstV6ListingTransaction.locktime = 0;
firstV6ListingTransaction.addInput(
  Buffer.from(
    "324bbd943a3d17f291d8dbf33b4fba1017f305269a6821a6a457287b96fe0b8a",
    "hex",
  ).reverse(),
  0,
  0xffffffff,
  Buffer.from(
    "483045022100c49d1309075a6a71b2a15e72e9442479d72c4fb591ba75b7d58d1239037a7be902206bb335cc269396046ac61e2bb6e10adc58b2646f383b3fdee012723f9d8d464e012103322f3132310abe49fd21dbb4987c7a5f327afc0224bc74851e06b0f5cf4bf945",
    "hex",
  ),
);
firstV6ListingTransaction.addOutput(
  Buffer.from(
    "76a914373fb7e4166289b3e09a82ac74c4d2c4dccdaa0288ac",
    "hex",
  ),
  546n,
);
firstV6ListingTransaction.addOutput(
  Buffer.from(
    opReturnOutput(firstV6ListingMessage).scriptPubKey.hex,
    "hex",
  ),
  0n,
);
firstV6ListingTransaction.addOutput(
  Buffer.from(
    firstV6ListingAuthorization.anchorScriptPubKey,
    "hex",
  ),
  546n,
);
firstV6ListingTransaction.addOutput(
  Buffer.from(
    firstV6ListingAuthorization.anchorScriptPubKey,
    "hex",
  ),
  196_406n,
);
assert.equal(firstV6ListingTransaction.getId(), firstV6ListingTxid);

function rawV6TransactionEnvelope(
  transaction,
  inputPrevouts = [],
) {
  return {
    hex: transaction.toHex(),
    locktime: transaction.locktime,
    txid: transaction.getId(),
    version: transaction.version,
    vin: transaction.ins.map((input, index) =>
      transaction.isCoinbase()
        ? {
            coinbase: Buffer.from(input.script).toString("hex"),
            sequence: input.sequence,
          }
        : {
            ...(inputPrevouts[index]
              ? { prevout: inputPrevouts[index] }
              : {}),
            scriptsig: Buffer.from(input.script).toString("hex"),
            sequence: input.sequence,
            txid: Buffer.from(input.hash)
              .reverse()
              .toString("hex"),
            vout: input.index,
          },
    ),
    vout: transaction.outs.map((output) => ({
      scriptpubkey: Buffer.from(output.script).toString("hex"),
      value: output.value.toString(),
    })),
  };
}

function rawV6Coinbase(unique) {
  const transaction = new bitcoin.Transaction();
  transaction.version = 2;
  transaction.addInput(
    Buffer.alloc(32),
    0xffffffff,
    0xffffffff,
    Buffer.from(
      Number(unique).toString(16).padStart(8, "0"),
      "hex",
    ),
  );
  transaction.addOutput(Buffer.from("51", "hex"), 0n);
  return rawV6TransactionEnvelope(transaction);
}

function rawV6NeutralTransaction(unique) {
  const transaction = new bitcoin.Transaction();
  transaction.version = 2;
  transaction.addInput(
    createHash("sha256")
      .update(`work-amo-v6-neutral-${unique}`, "utf8")
      .digest(),
    0,
    0xffffffff,
  );
  transaction.addOutput(Buffer.from("51", "hex"), 0n);
  return rawV6TransactionEnvelope(transaction);
}

function rawV6DoubleSha256(bytes) {
  return createHash("sha256")
    .update(createHash("sha256").update(bytes).digest())
    .digest();
}

function rawV6MerkleRoot(txids) {
  let level = txids.map((txid) =>
    Buffer.from(txid, "hex").reverse(),
  );
  while (level.length > 1) {
    if (level.length % 2 === 1) {
      level.push(Buffer.from(level.at(-1)));
    }
    level = Array.from(
      { length: level.length / 2 },
      (_, index) =>
        rawV6DoubleSha256(
          Buffer.concat([
            level[index * 2],
            level[index * 2 + 1],
          ]),
        ),
    );
  }
  return Buffer.from(level[0]).reverse().toString("hex");
}

function rawV6BlockContext({
  blockTimeSeconds,
  blockTransactions,
  previousBlockHash,
}) {
  const header = Buffer.alloc(80);
  header.writeInt32LE(1, 0);
  Buffer.from(previousBlockHash, "hex")
    .reverse()
    .copy(header, 4);
  Buffer.from(
    rawV6MerkleRoot(
      blockTransactions.map((transaction) => transaction.txid),
    ),
    "hex",
  )
    .reverse()
    .copy(header, 36);
  header.writeUInt32LE(blockTimeSeconds, 68);
  header.writeUInt32LE(0x1d00ffff, 72);
  header.writeUInt32LE(0, 76);
  return {
    blockHash: Buffer.from(rawV6DoubleSha256(header))
      .reverse()
      .toString("hex"),
    blockHeaderHex: header.toString("hex"),
    blockTransactions,
    previousBlockHash,
  };
}

const firstV6ListingTransactionEnvelope =
  rawV6TransactionEnvelope(firstV6ListingTransaction, [
    {
      scriptpubkey:
        firstV6ListingAuthorization.anchorScriptPubKey,
      scriptpubkey_address: firstV6ListingSeller,
      value: 199_000,
    },
  ]);
const firstV6ListingRawRecord =
  canonicalRawProtocolRecordSetFromTransaction(
    firstV6ListingTransactionEnvelope,
  ).records[0];
assert.equal(firstV6ListingRawRecord.message, firstV6ListingMessage);
assert.equal(firstV6ListingRawRecord.protocolVout, 1);
assert.equal(firstV6ListingRawRecord.recordOrdinal, 0);

const firstV6SyntheticPreviousBlockHash = "cc".repeat(32);
const firstV6SyntheticBlockTransactions = [
  rawV6Coinbase(960_258),
  ...Array.from({ length: 4_092 }, (_, index) =>
    rawV6NeutralTransaction(index + 1),
  ),
  firstV6ListingTransactionEnvelope,
];
const firstV6SyntheticBlock = rawV6BlockContext({
  blockTimeSeconds: 1_785_415_534,
  blockTransactions: firstV6SyntheticBlockTransactions,
  previousBlockHash: firstV6SyntheticPreviousBlockHash,
});
const firstV6SyntheticRecord = {
  message: firstV6ListingRawRecord.message,
  payload: structuredClone(firstV6ListingRawRecord.payload),
  position: {
    blockHash: firstV6SyntheticBlock.blockHash,
    blockHeight: 960_258,
    blockTransactionIndex: 4_093,
    protocolVout: firstV6ListingRawRecord.protocolVout,
    recordOrdinal: firstV6ListingRawRecord.recordOrdinal,
  },
  protocol: firstV6ListingRawRecord.protocol,
  protocolVout: firstV6ListingRawRecord.protocolVout,
  rawDecodeReasonCode:
    firstV6ListingRawRecord.rawDecodeReasonCode,
  rawDecodeValid: firstV6ListingRawRecord.rawDecodeValid,
  rawPayloadHex: firstV6ListingRawRecord.rawRecordParts
    .map((part) => part.payloadHex)
    .join(""),
  rawRecordParts: structuredClone(
    firstV6ListingRawRecord.rawRecordParts,
  ),
  rawScriptPubKeyHex:
    firstV6ListingRawRecord.rawRecordParts[0]?.scriptPubKeyHex ??
    "",
  recordOrdinal: firstV6ListingRawRecord.recordOrdinal,
  transactionMinerFeeSats: "1502",
  transactionProtocolRecordCount: 1,
  tx: firstV6ListingTransactionEnvelope,
  txid: firstV6ListingTxid,
};
const firstV6RawOpeningGenericState =
  normalizeWorkAmoV5RawGenericState({
    holders: [],
    listings: [],
    tokens: [],
  });
const firstV6RawOpeningIdState =
  normalizeWorkAmoV5RawIdState({
    listings: [],
    records: [],
  });
const firstV6RawOpeningWorkState =
  normalizeWorkAmoV5RawWorkState({
    confirmedSupplyAtoms: firstV6ListingAmountAtoms,
    holders: [
      {
        address: firstV6ListingSeller,
        balanceAtoms: firstV6ListingAmountAtoms,
      },
    ],
    listings: [],
  });
const firstV6RawOpeningEconomicState = {
  baseState: Object.fromEntries(
    WORK_AMO_V5_BASE_STATE_FIELDS.map((field) => [field, "0"]),
  ),
  creditFixedQ8:
    firstV6ListingFrozenTerms.listingNetworkValueBeforeQ8,
  creditMovementFrozenValueQ8: "0",
  genericTokenStateCommitment:
    workAmoV5RawGenericStateCommitment(
      firstV6RawOpeningGenericState,
    ),
  idStateCommitment: workAmoV5RawIdStateCommitment(
    firstV6RawOpeningIdState,
  ),
  model: WORK_AMO_V5_NETWORK_ACCUMULATOR_MODEL,
  movements: [],
  network: "livenet",
  networkValueQ8:
    firstV6ListingFrozenTerms.listingNetworkValueBeforeQ8,
  quoteHead: null,
  throughBlockHash: firstV6SyntheticPreviousBlockHash,
  throughBlockHeight: 960_257,
  tokenStateCommitment:
    workAmoV6CanonicalTokenStateCommitment(
      firstV6RawOpeningWorkState,
    ),
};
const firstV6RawClosingReplay = replayWorkAmoV5RawBlock({
  blockHeaderHex: firstV6SyntheticBlock.blockHeaderHex,
  blockTransactions:
    firstV6SyntheticBlock.blockTransactions,
  expectedBlockHash: firstV6SyntheticBlock.blockHash,
  expectedBlockHeight: 960_258,
  expectedPreviousBlockHash:
    firstV6SyntheticPreviousBlockHash,
  openingEconomicState: firstV6RawOpeningEconomicState,
  openingGenericState: firstV6RawOpeningGenericState,
  openingIdState: firstV6RawOpeningIdState,
  openingWorkState: firstV6RawOpeningWorkState,
  records: [firstV6SyntheticRecord],
  workAmoV6: { activationHeight: 960_219 },
});
assert.equal(firstV6RawClosingReplay.events[0].valid, true);
const firstV6RawClosingListing =
  firstV6RawClosingReplay.workState.listings.find(
    (listing) => listing.listingId === firstV6ListingTxid,
  );
assert.ok(firstV6RawClosingListing);
assert.deepEqual(
  {
    amountAtoms: firstV6RawClosingListing.amountAtoms,
    blockHeight:
      firstV6RawClosingListing.frozenTerms.listingBlockHeight,
    blockTransactionIndex:
      firstV6RawClosingListing.frozenTerms.listingBlockIndex,
    listingBondContributionQ8:
      firstV6RawClosingListing.frozenTerms
        .listingBondContributionQ8,
    listingNetworkValueAfterQ8:
      firstV6RawClosingListing.frozenTerms
        .listingNetworkValueAfterQ8,
    listingNetworkValueBeforeQ8:
      firstV6RawClosingListing.frozenTerms
        .listingNetworkValueBeforeQ8,
    priceSats: firstV6RawClosingListing.priceSats,
    protocolVout:
      firstV6RawClosingListing.frozenTerms.listingProtocolVout,
    recordOrdinal:
      firstV6RawClosingListing.frozenTerms.listingRecordOrdinal,
  },
  {
    amountAtoms: firstV6ListingAmountAtoms,
    blockHeight: 960_258,
    blockTransactionIndex: 4_093,
    listingBondContributionQ8: "327600000000",
    listingNetworkValueAfterQ8:
      "407065289490674476605636246",
    listingNetworkValueBeforeQ8:
      "407065289490674149005636246",
    priceSats: "20000",
    protocolVout: 1,
    recordOrdinal: 0,
  },
);
assert.deepEqual(
  normalizeWorkAmoV5RawWorkState(
    firstV6RawClosingReplay.workState,
  ),
  firstV6RawClosingReplay.workState,
);

const firstV6NextBlock = rawV6BlockContext({
  blockTimeSeconds: 1_785_416_134,
  blockTransactions: [rawV6Coinbase(960_259)],
  previousBlockHash: firstV6SyntheticBlock.blockHash,
});
const firstV6NextBlockReplay = replayWorkAmoV5RawBlock({
  blockHeaderHex: firstV6NextBlock.blockHeaderHex,
  blockTransactions: firstV6NextBlock.blockTransactions,
  expectedBlockHash: firstV6NextBlock.blockHash,
  expectedBlockHeight: 960_259,
  expectedPreviousBlockHash:
    firstV6SyntheticBlock.blockHash,
  openingEconomicState:
    firstV6RawClosingReplay.economicState,
  openingGenericState: firstV6RawClosingReplay.genericState,
  openingIdState: firstV6RawClosingReplay.idState,
  openingWorkState: firstV6RawClosingReplay.workState,
  records: [],
  workAmoV6: { activationHeight: 960_219 },
});
assert.deepEqual(
  firstV6NextBlockReplay.tokenStateCommitment,
  firstV6RawClosingReplay.tokenStateCommitment,
  "The next raw block must reopen and close the V6 listing state",
);
assert.equal(
  firstV6NextBlockReplay.workState.listings[0].listingId,
  firstV6ListingTxid,
);

const compatibilityBlockHash = "77".repeat(32);
const compatibilityNetworkValueBeforeQ8 = "210000000000000000";
const compatibilityQuoteTxid = "88".repeat(32);
const compatibilityQuotePayload =
  `pwa1:usd1:${WORK_AMO_V5_V1_DECLARATION_TXID}:1:` +
  `${WORK_AMO_V5_V1_DECLARATION_TXID}:100000000`;
const compatibilityQuoteValidation =
  validateWorkAmoUsdQuoteEvidence({
    blockHash: compatibilityBlockHash,
    blockHeight: WORK_AMO_V5_ACTIVATION_HEIGHT,
    blockTransactionIndex: 1,
    canonical: true,
    confirmed: true,
    firstInputPrevoutScriptPubKey:
      WORK_AMO_V5_DECLARATION_AUTHORITY_SCRIPT_PUBKEY,
    payload: compatibilityQuotePayload,
    protocolVout: 1,
    recordCount: 1,
    recordOrdinal: 0,
    registryAddress: WORK_AMO_V5_DECLARATION_REGISTRY_ADDRESS,
    registryPaymentSats: WORK_AMO_V5_DECLARATION_MIN_PAYMENT_SATS,
    txid: compatibilityQuoteTxid,
  });
assert.equal(compatibilityQuoteValidation.valid, true);
const compatibilityV5Authorization = {
  amountModel: WORK_AMO_V5_AMOUNT_MODEL,
  anchorScriptPubKey:
    "76a914111111111111111111111111111111111111111188ac",
  anchorSigHashType: 0x83,
  anchorType: "sale-ticket-v1",
  anchorValueSats: 546,
  anchorVout: 2,
  bondTransitionModel: WORK_AMO_V5_BOND_TRANSITION_MODEL,
  buyerAddress: "",
  expiresAt: "",
  network: "livenet",
  nonce: "amo-v5-token-state-compatibility",
  registryAddress: WORK_AMO_V5_DECLARATION_REGISTRY_ADDRESS,
  sellerAddress: "1F1p9UEHuH5KTFR7Zsx93Khdrqhj6t5nFv",
  sellerPublicKey: `02${"11".repeat(32)}`,
  stateOrderModel: WORK_AMO_V5_STATE_ORDER_MODEL,
  ticker: "WORK",
  tokenId: WORK_TOKEN_ID,
  unitFaceUsdCents: 2_000,
  unitModel: WORK_AMO_V5_UNIT_MODEL,
  unitUsdOracleModel: WORK_AMO_V5_UNIT_USD_ORACLE_MODEL,
  unitWorkOracleModel: WORK_AMO_V5_UNIT_WORK_ORACLE_MODEL,
  version: WORK_AMO_V5_AUTH_VERSION,
};
const compatibilityV5Frozen = deriveWorkAmoV5FrozenTerms(
  compatibilityV5Authorization,
  {
    listingBondContributionQ8: "109200000000",
    listingPosition: {
      blockHash: compatibilityBlockHash,
      blockHeight: WORK_AMO_V5_ACTIVATION_HEIGHT,
      blockTransactionIndex: 2,
      protocolVout: 2,
      recordOrdinal: 0,
    },
    networkValueBeforeQ8: compatibilityNetworkValueBeforeQ8,
    quote: compatibilityQuoteValidation.quote,
    spendableAmountAtoms: (
      WORK_AMO_V5_MAX_SUPPLY * WORK_AMO_V5_ATOMS_PER_WORK
    ).toString(),
  },
);
assert.equal(
  compatibilityV5Frozen.valid,
  true,
);
const compatibilityV5AmountAtoms =
  compatibilityV5Frozen.frozenTerms.unitAmountAtoms;
const compatibilityV5State = {
  confirmedSupplyAtoms: compatibilityV5AmountAtoms,
  holders: [
    {
      address: compatibilityV5Authorization.sellerAddress,
      balanceAtoms: compatibilityV5AmountAtoms,
    },
  ],
  listings: [
    {
      amountAtoms: compatibilityV5AmountAtoms,
      frozenTerms: compatibilityV5Frozen.frozenTerms,
      listingId: "99".repeat(32),
      priceSats: compatibilityV5Frozen.frozenTerms.unitPriceSats,
      saleAuthorization: compatibilityV5Authorization,
      sellerAddress: compatibilityV5Authorization.sellerAddress,
    },
  ],
};
assert.deepEqual(
  workAmoV6CanonicalTokenStatePreimage(compatibilityV5State),
  workAmoV5CanonicalTokenStatePreimage(compatibilityV5State),
  "V5 canonical token-state bytes must remain unchanged",
);
assert.deepEqual(
  workAmoV6CanonicalTokenStateCommitment(compatibilityV5State),
  workAmoV5CanonicalTokenStateCommitment(compatibilityV5State),
  "V5 canonical token-state commitments must remain unchanged",
);

const {
  amountModel: _compatibilityV5AmountModel,
  bondTransitionModel: _compatibilityV5BondTransitionModel,
  stateOrderModel: _compatibilityV5StateOrderModel,
  unitModel: _compatibilityV5UnitModel,
  unitUsdOracleModel: _compatibilityV5UsdOracleModel,
  unitWorkOracleModel: _compatibilityV5WorkOracleModel,
  ...compatibilityV4Identity
} = compatibilityV5Authorization;
const compatibilityV4Authorization = {
  ...compatibilityV4Identity,
  amountAtoms: WORK_AMO_V5_ATOMS_PER_WORK.toString(),
  minimumPriceSats: "1",
  oracleModel: WORK_AMO_V4_ORACLE_MODEL,
  priceSats: "1000",
  unitFaceUsd: 10,
  unitFaceUsdCents: 1_000,
  unitModel: WORK_AMO_V4_UNIT_MODEL,
  unitNetworkValueQ8: compatibilityNetworkValueBeforeQ8,
  unitUsdOracleModel: WORK_AMO_V5_UNIT_USD_ORACLE_MODEL,
  version: WORK_AMO_V4_AUTH_VERSION,
};
const compatibilityV4FrozenTerms = {
  authorizationVersion: WORK_AMO_V4_AUTH_VERSION,
  canonical: true,
  confirmed: true,
  listingBlockHash: "aa".repeat(32),
  listingBlockHeight: WORK_AMO_V5_ACTIVATION_HEIGHT - 1,
  listingBlockIndex: 100,
  listingProtocolVout: 3,
  listingRecordOrdinal: 0,
  tokenId: WORK_TOKEN_ID,
  unitAmountAtoms: compatibilityV4Authorization.amountAtoms,
  unitFaceUsd: 10,
  unitFaceUsdCents: 1_000,
  unitMinimumPriceSats:
    compatibilityV4Authorization.minimumPriceSats,
  unitNetworkValueBeforeQ8:
    compatibilityV4Authorization.unitNetworkValueQ8,
  unitPriceSats: compatibilityV4Authorization.priceSats,
  valid: true,
};
const compatibilityV4State = {
  confirmedSupplyAtoms: compatibilityV4Authorization.amountAtoms,
  holders: [
    {
      address: compatibilityV4Authorization.sellerAddress,
      balanceAtoms: compatibilityV4Authorization.amountAtoms,
    },
  ],
  listings: [
    {
      amountAtoms: compatibilityV4Authorization.amountAtoms,
      frozenTerms: compatibilityV4FrozenTerms,
      listingId: "bb".repeat(32),
      priceSats: compatibilityV4Authorization.priceSats,
      saleAuthorization: compatibilityV4Authorization,
      sellerAddress: compatibilityV4Authorization.sellerAddress,
    },
  ],
};
assert.deepEqual(
  workAmoV6CanonicalTokenStatePreimage(compatibilityV4State),
  workAmoV5CanonicalTokenStatePreimage(compatibilityV4State),
  "V4 canonical token-state bytes must remain unchanged",
);
assert.deepEqual(
  workAmoV6CanonicalTokenStateCommitment(compatibilityV4State),
  workAmoV5CanonicalTokenStateCommitment(compatibilityV4State),
  "V4 canonical token-state commitments must remain unchanged",
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
