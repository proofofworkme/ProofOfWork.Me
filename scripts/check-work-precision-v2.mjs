import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";

import {
  WORK_LEGACY_ATOMIC_PROJECTION_MODEL,
  WORK_LEGACY_DECIMALS,
  WORK_LEGACY_UNIT_SCALE_TEXT,
  WORK_PRECISION_V2_MIGRATION_META_KEY,
  WORK_PRECISION_V2_MIGRATION_MODEL,
  WORK_PRECISION_V2_MODEL,
  WORK_SUBATOM_CONVERSION_FACTOR,
  WORK_SUBATOM_DECIMALS,
  WORK_SUBATOM_PROJECTION_MODEL,
  WORK_SUBATOM_UNIT_SCALE_TEXT,
  WORK_TOKEN_ID,
  formatWorkSubatoms,
  isCanonicalWorkSubatoms,
  legacyWorkAtomsToSubatoms,
  parseSignedWorkAmountToSubatoms,
  parseWorkAmountToSubatoms,
  validateWorkPrecisionMetadata,
  withWorkSubatomPrecisionMetadata,
  workAmountSubatomsFromRecord,
  workSubatomsToLegacyAtoms,
} from "../server/work-units.mjs";
import {
  WORK_AMO_V8_ALLOWED_FACE_PROOFS,
  WORK_AMO_V8_AUTH_VERSION,
  WORK_AMO_V8_DECIMALS,
  WORK_AMO_V8_GLOBAL_PRECISION_MODEL,
  WORK_AMO_V8_LEGACY_ATOM_TO_SUBATOM_SCALE,
  WORK_AMO_V8_MAX_SUPPLY_SUBATOMS,
  WORK_AMO_V8_MINT_AMOUNT_SUBATOMS,
  WORK_AMO_V8_MODELS,
  WORK_AMO_V8_PRECISION_MIGRATION_MODEL,
  WORK_AMO_V8_PRECISION_MODEL,
  WORK_AMO_V8_RELIC_CUTOVER_MODEL,
  WORK_AMO_V8_SUBATOMS_PER_WORK,
  WORK_AMO_V8_TRANSFER_VERSION,
  deriveWorkAmoV8FrozenTerms,
  validateWorkAmoV8ListingCutover,
  validateWorkAmoV8FrozenTerms,
  workAmoV8CanonicalTokenStateCommitment,
  workAmoV8CanonicalTokenStatePreimage,
  workAmoV8UnitTerms,
} from "../server/work-amo-v8.mjs";
import {
  workPrecisionV2MarkerReady,
  workPrecisionV2RelicCutoverReady,
} from "../server/work-precision-v2-marker.mjs";
import {
  WORK_AMO_V8_ACTIVATION_LATCH_MODEL,
  workAmoV8ActivationLatchReady,
} from "../server/work-amo-v8-activation-latch.mjs";
import {
  buildWorkAmoV8DeclarationText,
  workAmoV8DeclarationCommitment,
} from "../server/work-amo-v8-declaration.mjs";
import {
  WORK_PRECISION_V2_STATIC_CONSTRAINT_DEFINITIONS,
} from "../server/work-precision-v2-schema.mjs";
import {
  WORK_AMO_V6_AUTH_VERSION,
  WORK_AMO_V6_BLOCK_SEQUENCER_MODEL,
  WORK_AMO_V6_MODELS,
  validateWorkAmoV6FrozenTerms,
  validateWorkAmoV6StaticAuthorization,
  workAmoV6CanonicalTokenStateCommitment,
} from "../server/work-amo-v6.mjs";
import {
  workAmoV6DeclarationCommitment,
} from "../server/work-amo-v6-declaration.mjs";
import {
  WORK_AMO_V5_ATOMS_PER_WORK,
  WORK_AMO_V5_DECLARATION_AUTHORITY_SCRIPT_PUBKEY,
  WORK_AMO_V5_DECLARATION_MIN_PAYMENT_SATS,
  WORK_AMO_V5_DECLARATION_REGISTRY_ADDRESS,
  WORK_AMO_V5_PAYLOAD_COMMITMENT_MODEL,
} from "../server/work-amo-v5.mjs";
import {
  workPrecisionV2CurrentPayloadIsExact,
  workPrecisionV2ProjectCurrentPayload,
  workPrecisionV2RelicListingProjection,
} from "../server/db/proof-index-reader.mjs";
import {
  canonicalWorkPrecisionV2Rows,
  scaleWorkPrecisionV2TokenState,
  scaleWorkPrecisionV2Rows,
  verifyWorkPrecisionV2RowsConserved,
  workPrecisionV2ConstraintAudit,
  workPrecisionV2LegacyListingRepairs,
  workPrecisionV2RowsCommitment,
} from "./migrate-work-precision-v2.mjs";

assert.equal(WORK_LEGACY_DECIMALS, 8);
assert.equal(WORK_LEGACY_UNIT_SCALE_TEXT, "100000000");
assert.equal(WORK_LEGACY_ATOMIC_PROJECTION_MODEL, "work-atoms-v1");
assert.equal(WORK_SUBATOM_DECIMALS, 16);
assert.equal(WORK_SUBATOM_UNIT_SCALE_TEXT, "10000000000000000");
assert.equal(WORK_SUBATOM_CONVERSION_FACTOR, 100000000n);
assert.equal(WORK_SUBATOM_PROJECTION_MODEL, "work-subatoms-v2");
assert.equal(WORK_PRECISION_V2_MODEL, "canonical-work-subatoms-v2");
assert.equal(
  WORK_PRECISION_V2_MIGRATION_MODEL,
  "canonical-work-q8-to-q16-migration-v1",
);
assert.equal(
  WORK_PRECISION_V2_MIGRATION_META_KEY,
  "workPrecisionV2Migration:livenet",
);

assert.equal(parseWorkAmountToSubatoms("0.0000000000000001"), "1");
assert.equal(parseWorkAmountToSubatoms("0.00000001"), "100000000");
assert.equal(parseWorkAmountToSubatoms("1"), "10000000000000000");
assert.equal(
  parseWorkAmountToSubatoms("1.2345678901234567"),
  "12345678901234567",
);
assert.equal(
  parseWorkAmountToSubatoms("21000000"),
  "210000000000000000000000",
);
assert.equal(
  parseSignedWorkAmountToSubatoms("-1.0000000000000001"),
  "-10000000000000001",
);
assert.equal(formatWorkSubatoms("1"), "0.0000000000000001");
assert.equal(
  formatWorkSubatoms("1", { trim: false }),
  "0.0000000000000001",
);
assert.equal(
  formatWorkSubatoms("100000000", { trim: false }),
  "0.0000000100000000",
);
assert.equal(formatWorkSubatoms("10000000000000000"), "1");
const oneSubatomText = formatWorkSubatoms("1", { trim: false });
assert.equal(oneSubatomText, "0.0000000000000001");
assert.equal(
  parseWorkAmountToSubatoms(oneSubatomText),
  "1",
  "the smallest WORK unit must round-trip exactly without Number",
);
const q16CurrentMetadata = {
  amountStorageModel: WORK_SUBATOM_PROJECTION_MODEL,
  decimals: WORK_SUBATOM_DECIMALS,
  precisionModel: WORK_PRECISION_V2_MODEL,
  unitScale: WORK_SUBATOM_UNIT_SCALE_TEXT,
};
const migratedHistoricalCurrentPayload =
  workPrecisionV2ProjectCurrentPayload({
    ...q16CurrentMetadata,
    closedListings: [],
    confirmedSupplySubatoms: "100000000",
    holders: [{
      ...q16CurrentMetadata,
      address: "holder",
      balanceSubatoms: "100000000",
      pendingDeltaSubatoms: "0",
      tokenId: WORK_TOKEN_ID,
    }],
    listings: [],
    mints: [{
      amount: "0.00000001",
      amountAtoms: "1",
      amountStorageModel:
        WORK_LEGACY_ATOMIC_PROJECTION_MODEL,
      confirmed: true,
      decimals: WORK_LEGACY_DECIMALS,
      tokenId: WORK_TOKEN_ID,
      unitScale: WORK_LEGACY_UNIT_SCALE_TEXT,
    }],
    pendingSupplySubatoms: "0",
    sales: [],
    tokens: [{
      ...q16CurrentMetadata,
      confirmedSupplySubatoms: "100000000",
      pendingSupplySubatoms: "0",
      tokenId: WORK_TOKEN_ID,
    }],
    transfers: [],
  });
assert.equal(
  migratedHistoricalCurrentPayload.mints[0].amountSubatoms,
  "100000000",
);
assert.equal(
  migratedHistoricalCurrentPayload.mints[0]
    .sourceAmountEvidence.amountAtoms,
  "1",
);
assert.equal(
  workPrecisionV2CurrentPayloadIsExact(
    migratedHistoricalCurrentPayload,
    1,
  ),
  true,
  "current Q16 arrays must project immutable historical Q8 evidence one way",
);
assert.equal(
  formatWorkSubatoms(
    parseWorkAmountToSubatoms("21000000.0000000000000001"),
    { trim: false },
  ),
  "21000000.0000000000000001",
);
assert.equal(
  parseSignedWorkAmountToSubatoms(
    formatWorkSubatoms("-1", {
      allowNegative: true,
      trim: false,
    }),
  ),
  "-1",
);

for (const invalid of [
  "",
  "0",
  "-1",
  "+1",
  "01",
  "1e-16",
  "1,000",
  " 1",
  "1 ",
  "0.00000000000000001",
]) {
  assert.throws(
    () => parseWorkAmountToSubatoms(invalid),
    undefined,
    `Q16 parser must reject ${JSON.stringify(invalid)}`,
  );
}
assert.throws(() => parseWorkAmountToSubatoms(1e-16));
assert.equal(isCanonicalWorkSubatoms("1"), true);
assert.equal(isCanonicalWorkSubatoms("01"), false);
assert.equal(isCanonicalWorkSubatoms(" 1"), false);

const conversionSamples = [
  "1",
  "10",
  "100000000",
  "2100000000000000",
];
for (const legacyAtoms of conversionSamples) {
  const subatoms = legacyWorkAtomsToSubatoms(legacyAtoms);
  assert.equal(
    subatoms,
    (BigInt(legacyAtoms) * 100000000n).toString(),
  );
  assert.equal(workSubatomsToLegacyAtoms(subatoms), legacyAtoms);
}
assert.throws(() => workSubatomsToLegacyAtoms("1"));
assert.equal(
  workAmountSubatomsFromRecord(
    {
      amountAtoms: "10",
      amountStorageModel: WORK_LEGACY_ATOMIC_PROJECTION_MODEL,
    },
    { allowLegacy: true },
  ),
  "1000000000",
);
assert.equal(
  workAmountSubatomsFromRecord({
    amountStorageModel: WORK_SUBATOM_PROJECTION_MODEL,
    amountSubatoms: "1",
  }),
  "1",
);
assert.throws(() =>
  workAmountSubatomsFromRecord({ amountAtoms: "10" }),
);
assert.equal(
  workAmountSubatomsFromRecord(
    {
      amountAtoms: "10",
      amountStorageModel: WORK_LEGACY_ATOMIC_PROJECTION_MODEL,
      amountSubatoms: "1000000000",
    },
    { allowLegacy: true },
  ),
  "1000000000",
  "a normalized legacy projection may preserve atoms only when its Q16 alias is exact",
);
assert.throws(
  () =>
    workAmountSubatomsFromRecord(
      {
        amountAtoms: "10",
        amountStorageModel:
          WORK_LEGACY_ATOMIC_PROJECTION_MODEL,
        amountSubatoms: "1000000001",
      },
      { allowLegacy: true },
    ),
  undefined,
  "a conflicting normalized legacy alias must fail closed",
);
assert.throws(
  () =>
    workAmountSubatomsFromRecord({
      amountAtoms: "1",
      amountStorageModel: WORK_SUBATOM_PROJECTION_MODEL,
      amountSubatoms: "1",
    }),
  undefined,
  "native Q16 records must never carry a legacy atoms sibling",
);
assert.throws(
  () =>
    workAmountSubatomsFromRecord({
      amountStorageModel: WORK_SUBATOM_PROJECTION_MODEL,
      amountSubatoms: "1",
      tokenAmountSubatoms: "2",
    }),
  undefined,
  "conflicting Q16 aliases must fail closed",
);

const q16Metadata = withWorkSubatomPrecisionMetadata({
  precisionModel: WORK_PRECISION_V2_MODEL,
});
assert.deepEqual(q16Metadata, {
  amountStorageModel: WORK_SUBATOM_PROJECTION_MODEL,
  decimals: 16,
  precisionModel: WORK_PRECISION_V2_MODEL,
  unitScale: WORK_SUBATOM_UNIT_SCALE_TEXT,
});
assert.equal(validateWorkPrecisionMetadata(q16Metadata), true);
assert.equal(
  validateWorkPrecisionMetadata({
    ...q16Metadata,
    unitScale: WORK_LEGACY_UNIT_SCALE_TEXT,
  }),
  false,
);
assert.equal(
  validateWorkPrecisionMetadata({
    ...q16Metadata,
    decimals: "16",
  }),
  false,
  "precision metadata must not accept a string alias for the canonical decimal count",
);

assert.equal(WORK_AMO_V8_AUTH_VERSION, "pwt-sale-v8");
assert.equal(WORK_AMO_V8_TRANSFER_VERSION, "send3");
assert.equal(WORK_AMO_V8_DECIMALS, 16);
assert.equal(
  WORK_AMO_V8_SUBATOMS_PER_WORK.toString(),
  WORK_SUBATOM_UNIT_SCALE_TEXT,
);
assert.equal(
  WORK_AMO_V8_LEGACY_ATOM_TO_SUBATOM_SCALE,
  WORK_SUBATOM_CONVERSION_FACTOR,
);
assert.equal(
  WORK_AMO_V8_MAX_SUPPLY_SUBATOMS.toString(),
  "210000000000000000000000",
);
assert.equal(
  WORK_AMO_V8_MINT_AMOUNT_SUBATOMS.toString(),
  "10000000000000000000",
);
assert.equal(WORK_AMO_V8_PRECISION_MODEL, WORK_SUBATOM_PROJECTION_MODEL);
assert.equal(WORK_AMO_V8_GLOBAL_PRECISION_MODEL, WORK_PRECISION_V2_MODEL);
assert.equal(
  WORK_AMO_V8_PRECISION_MIGRATION_MODEL,
  WORK_PRECISION_V2_MIGRATION_MODEL,
);
assert.deepEqual(
  [...WORK_AMO_V8_ALLOWED_FACE_PROOFS],
  [25_000],
);

const launchNetworkValueQ8 = 21_000_000n * 100_000_000n;
for (const face of WORK_AMO_V8_ALLOWED_FACE_PROOFS) {
  const terms = workAmoV8UnitTerms({
    networkValueBeforeQ8: launchNetworkValueQ8.toString(),
    unitFaceProofs: face,
  });
  assert.equal(terms.valid, true);
  assert.equal(
    terms.unitAmountSubatoms,
    (BigInt(face) * WORK_AMO_V8_SUBATOMS_PER_WORK).toString(),
  );
  assert.equal(terms.unitPriceSats, String(face));
  assert.equal(terms.unitMinimumPriceSats, String(face));
  assert.equal("unitAmountAtoms" in terms, false);
}
const nonLegacyAlignedNetworkValueQ8 =
  launchNetworkValueQ8 + 1n;
const preciseV7Terms = workAmoV8UnitTerms({
  networkValueBeforeQ8:
    nonLegacyAlignedNetworkValueQ8.toString(),
  unitFaceProofs: 25_000,
});
const v7FormulaDenominator =
  21_000_000n *
  WORK_AMO_V8_SUBATOMS_PER_WORK *
  100_000_000n;
assert.equal(preciseV7Terms.valid, true);
assert.equal(
  preciseV7Terms.unitAmountSubatoms,
  (
    (25_000n * v7FormulaDenominator) /
    nonLegacyAlignedNetworkValueQ8
  ).toString(),
);
assert.equal(
  preciseV7Terms.unitMinimumPriceSats,
  (
    (
      BigInt(preciseV7Terms.unitAmountSubatoms) *
        nonLegacyAlignedNetworkValueQ8 +
      v7FormulaDenominator -
      1n
    ) / v7FormulaDenominator
  ).toString(),
);
assert.notEqual(
  BigInt(preciseV7Terms.unitAmountSubatoms) %
    WORK_SUBATOM_CONVERSION_FACTOR,
  0n,
  "V8 must retain precision below one historical atom",
);
assert.equal(
  workAmoV8UnitTerms({
    networkValueBeforeQ8: "0",
    unitFaceProofs: 25_000,
  }).reasonCode,
  "work-amo-v8-network-value-before-invalid",
);
assert.equal(
  workAmoV8UnitTerms({
    networkValueBeforeQ8: "1",
    unitFaceProofs: 25_000,
  }).reasonCode,
  "work-amo-v8-unit-amount-exceeds-supply",
);
for (const networkValueBeforeQ8 of [
  ` ${launchNetworkValueQ8}`,
  `${launchNetworkValueQ8} `,
  `+${launchNetworkValueQ8}`,
  `0${launchNetworkValueQ8}`,
  "2.1e15",
]) {
  assert.equal(
    workAmoV8UnitTerms({
      networkValueBeforeQ8,
      unitFaceProofs: 25_000,
    }).reasonCode,
    "work-amo-v8-network-value-before-invalid",
    `V8 network value must reject integer alias ${JSON.stringify(networkValueBeforeQ8)}`,
  );
}

const activationHeight = 1_000_000;
const position = (blockHeight) => ({
  blockHash: "11".repeat(32),
  blockHeight,
  blockTransactionIndex: 0,
  protocolVout: 1,
  recordOrdinal: 0,
});
assert.equal(
  validateWorkAmoV8ListingCutover({
    activationHeight,
    authorizationVersion: "pwt-sale-v6",
    listingPosition: position(activationHeight - 1),
  }).valid,
  true,
);
assert.equal(
  validateWorkAmoV8ListingCutover({
    activationHeight,
    authorizationVersion: "pwt-sale-v6",
    listingPosition: position(activationHeight - 1),
  }).historical,
  true,
);
assert.equal(
  validateWorkAmoV8ListingCutover({
    activationHeight,
    authorizationVersion: WORK_AMO_V8_AUTH_VERSION,
    listingPosition: position(activationHeight - 1),
  }).valid,
  false,
);
assert.equal(
  validateWorkAmoV8ListingCutover({
    activationHeight,
    authorizationVersion: WORK_AMO_V8_AUTH_VERSION,
    listingPosition: position(activationHeight - 1),
  }).reasonCode,
  "work-amo-v8-listing-before-activation",
);
assert.equal(
  validateWorkAmoV8ListingCutover({
    activationHeight,
    authorizationVersion: "pwt-sale-v6",
    listingPosition: position(activationHeight),
  }).valid,
  false,
);
assert.equal(
  validateWorkAmoV8ListingCutover({
    activationHeight,
    authorizationVersion: "pwt-sale-v6",
    listingPosition: position(activationHeight),
  }).reasonCode,
  "work-amo-v8-version-required",
);
assert.equal(
  validateWorkAmoV8ListingCutover({
    activationHeight,
    authorizationVersion: WORK_AMO_V8_AUTH_VERSION,
    listingPosition: position(activationHeight),
  }).valid,
  true,
);

const strictV7Authorization = {
  ...WORK_AMO_V8_MODELS,
  anchorScriptPubKey: `5120${"ab".repeat(32)}`,
  anchorSigHashType: 0x83,
  anchorType: "sale-ticket-v1",
  anchorValueSats: 546,
  anchorVout: 2,
  buyerAddress: "",
  expiresAt: "",
  network: "livenet",
  nonce: "work-precision-v2-strict-integers",
  registryAddress: WORK_AMO_V5_DECLARATION_REGISTRY_ADDRESS,
  sellerAddress:
    "bc1p0uxp0axptr8rg9dndgtlwxn00j4hq8m88kg80tqd0t6045putwhq5ca7ed",
  sellerPublicKey:
    "0306baa226e3a87a99547df2144f2e6206a4a479a46df41ec1618945c064568237",
  ticker: "WORK",
  tokenId: WORK_TOKEN_ID,
  unitFaceProofs: 25_000,
  version: WORK_AMO_V8_AUTH_VERSION,
};
const strictV7Position = {
  blockHash: "22".repeat(32),
  blockHeight: activationHeight,
  blockTransactionIndex: 1,
  protocolVout: 1,
  recordOrdinal: 0,
};
const strictV7BondQ8 = 546n * 100_000_000n;
const strictV7Derived = deriveWorkAmoV8FrozenTerms(
  strictV7Authorization,
  {
    activationHeight,
    listingBondContributionQ8: strictV7BondQ8.toString(),
    listingPosition: strictV7Position,
    networkValueBeforeQ8: launchNetworkValueQ8.toString(),
    spendableAmountSubatoms:
      WORK_AMO_V8_MAX_SUPPLY_SUBATOMS.toString(),
  },
);
assert.equal(strictV7Derived.valid, true);
assert.equal(
  deriveWorkAmoV8FrozenTerms(strictV7Authorization, {
    activationHeight,
    listingBondContributionQ8: strictV7BondQ8.toString(),
    listingPosition: strictV7Position,
    networkValueBeforeQ8: ` ${launchNetworkValueQ8}`,
    spendableAmountSubatoms:
      WORK_AMO_V8_MAX_SUPPLY_SUBATOMS.toString(),
  }).reasonCode,
  "work-amo-v8-network-value-before-invalid",
  "confirmed V8 derivation must reject whitespace in N-before",
);
assert.equal(
  deriveWorkAmoV8FrozenTerms(strictV7Authorization, {
    activationHeight,
    listingBondContributionQ8: strictV7BondQ8.toString(),
    listingPosition: strictV7Position,
    networkValueBeforeQ8: launchNetworkValueQ8.toString(),
    spendableAmountSubatoms:
      ` ${WORK_AMO_V8_MAX_SUPPLY_SUBATOMS}`,
  }).reasonCode,
  "work-amo-v8-spendable-balance-unavailable",
  "confirmed V8 derivation must reject whitespace in spendable subatoms",
);
assert.equal(
  deriveWorkAmoV8FrozenTerms(strictV7Authorization, {
    activationHeight,
    listingBondContributionQ8: strictV7BondQ8.toString(),
    listingPosition: strictV7Position,
    networkValueBeforeQ8: launchNetworkValueQ8.toString(),
    spendableAmountSubatoms: Number(
      WORK_AMO_V8_MAX_SUPPLY_SUBATOMS,
    ),
  }).reasonCode,
  "work-amo-v8-spendable-balance-unavailable",
  "unsafe Number must never authorize a V8 subatom spend",
);
assert.equal(
  validateWorkAmoV8FrozenTerms({
    ...strictV7Derived.frozenTerms,
    unitAmountSubatoms:
      ` ${strictV7Derived.frozenTerms.unitAmountSubatoms}`,
  }).reasonCode,
  "work-amo-v8-frozen-terms-invalid",
  "frozen V8 subatoms must be a canonical integer string",
);

const oneLegacyAtomOpening = {
  confirmedSupplySubatoms: "100000000",
  holders: [
    {
      address: "1Q16PrecisionHolder11111111111111111",
      balanceSubatoms: "100000000",
    },
  ],
  listings: [],
};
const openingPreimage =
  workAmoV8CanonicalTokenStatePreimage(oneLegacyAtomOpening);
assert.equal(openingPreimage.confirmedSupplySubatoms, "100000000");
assert.equal(openingPreimage.definition.decimals, 16);
assert.equal(
  openingPreimage.definition.amountStorageModel,
  WORK_SUBATOM_PROJECTION_MODEL,
);
assert.equal(openingPreimage.reservedSubatoms, "0");
assert.deepEqual(
  workAmoV8CanonicalTokenStateCommitment(oneLegacyAtomOpening),
  workAmoV8CanonicalTokenStateCommitment(openingPreimage),
);
assert.throws(() =>
  workAmoV8CanonicalTokenStatePreimage({
    ...oneLegacyAtomOpening,
    confirmedSupplySubatoms: "100000001",
  }),
);

const legacyBalanceRows = [
  {
    address: "holder-b",
    confirmed_balance: "10",
    pending_delta: "-1",
  },
  {
    address: "holder-a",
    confirmed_balance: "0",
    pending_delta: "2",
  },
];
const scaledBalanceRows = scaleWorkPrecisionV2Rows(legacyBalanceRows, {
  amountField: "confirmed_balance",
  keyField: "address",
  pendingField: "pending_delta",
});
assert.deepEqual(scaledBalanceRows, [
  {
    amount: "0",
    key: "holder-a",
    pending: "200000000",
  },
  {
    amount: "1000000000",
    key: "holder-b",
    pending: "-100000000",
  },
]);
assert.equal(
  scaledBalanceRows.reduce(
    (total, row) => total + BigInt(row.amount),
    0n,
  ),
  legacyBalanceRows.reduce(
    (total, row) =>
      total + BigInt(row.confirmed_balance),
    0n,
  ) * WORK_SUBATOM_CONVERSION_FACTOR,
  "aggregate confirmed supply must conserve exactly under atoms times 1e8",
);
assert.equal(
  scaledBalanceRows.reduce(
    (total, row) => total + BigInt(row.pending),
    0n,
  ),
  legacyBalanceRows.reduce(
    (total, row) => total + BigInt(row.pending_delta),
    0n,
  ) * WORK_SUBATOM_CONVERSION_FACTOR,
  "aggregate pending projection must conserve exactly under atoms times 1e8",
);
assert.deepEqual(
  canonicalWorkPrecisionV2Rows(legacyBalanceRows, {
    amountField: "confirmed_balance",
    keyField: "address",
    pendingField: "pending_delta",
  }),
  [
    { amount: "0", key: "holder-a", pending: "2" },
    { amount: "10", key: "holder-b", pending: "-1" },
  ],
);
const legacyRowsCommitment = workPrecisionV2RowsCommitment(
  legacyBalanceRows,
  {
    amountField: "confirmed_balance",
    keyField: "address",
    pendingField: "pending_delta",
  },
);
assert.deepEqual(legacyRowsCommitment, {
  count: 2,
  payloadBytes: 95,
  sha256:
    "f148d77b57df857e6149ba1be29e26a4df7bc77711bc8e0420dee7efab8a33bf",
});
assert.deepEqual(
  legacyRowsCommitment,
  workPrecisionV2RowsCommitment(
    [...legacyBalanceRows].reverse(),
    {
      amountField: "confirmed_balance",
      keyField: "address",
      pendingField: "pending_delta",
    },
  ),
  "migration row commitments must be independent of database return order",
);
assert.equal(
  verifyWorkPrecisionV2RowsConserved(
    legacyBalanceRows,
    scaledBalanceRows.map((row) => ({
      address: row.key,
      confirmed_balance: row.amount,
      pending_delta: row.pending,
    })),
    {
      amountField: "confirmed_balance",
      keyField: "address",
      pendingField: "pending_delta",
    },
  ),
  true,
);
assert.throws(() =>
  verifyWorkPrecisionV2RowsConserved(
    legacyBalanceRows,
    scaledBalanceRows.map((row, index) => ({
      address: row.key,
      confirmed_balance:
        index === 0 ? row.amount : String(BigInt(row.amount) + 1n),
      pending_delta: row.pending,
    })),
    {
      amountField: "confirmed_balance",
      keyField: "address",
      pendingField: "pending_delta",
    },
  ),
);
assert.throws(
  () =>
    verifyWorkPrecisionV2RowsConserved(
      legacyBalanceRows,
      scaledBalanceRows.map((row, index) => ({
        address: row.key,
        confirmed_balance: row.amount,
        pending_delta:
          index === 0
            ? String(BigInt(row.pending) + 1n)
            : row.pending,
      })),
      {
        amountField: "confirmed_balance",
        keyField: "address",
        pendingField: "pending_delta",
      },
    ),
  undefined,
  "one subatom of pending projection drift must fail migration conservation",
);
assert.throws(
  () =>
    scaleWorkPrecisionV2Rows(
      [
        {
          address: "negative-holder",
          confirmed_balance: "-1",
          pending_delta: "0",
        },
      ],
      {
        amountField: "confirmed_balance",
        keyField: "address",
        pendingField: "pending_delta",
      },
    ),
  undefined,
  "confirmed balances cannot be negative",
);
assert.throws(
  () =>
    scaleWorkPrecisionV2Rows(
      [
        {
          address: "aliased-holder",
          confirmed_balance: "01",
          pending_delta: "0",
        },
      ],
      {
        amountField: "confirmed_balance",
        keyField: "address",
        pendingField: "pending_delta",
      },
    ),
  undefined,
  "migration inputs must reject noncanonical integer aliases",
);
assert.notDeepEqual(
  workPrecisionV2RowsCommitment(legacyBalanceRows, {
    amountField: "confirmed_balance",
    keyField: "address",
    pendingField: "pending_delta",
  }),
  workPrecisionV2RowsCommitment(
    scaledBalanceRows.map((row) => ({
      address: row.key,
      confirmed_balance: row.amount,
      pending_delta: row.pending,
    })),
    {
      amountField: "confirmed_balance",
      keyField: "address",
      pendingField: "pending_delta",
    },
  ),
);
const legacyListingRawPayload = (authorization) =>
  `pwt1:list5:${Buffer.from(
    JSON.stringify(authorization),
    "utf8",
  ).toString("base64url")}`;
const legacyListingRepairRows = [
  {
    amount: "600000000000",
    event_count: "1",
    event_payload: {
      amount: "6000",
      amountAtoms: "600000000000",
      saleAuthorization: {
        amount: "6000",
        version: "pwt-sale-v1",
      },
      tokenId: WORK_TOKEN_ID,
    },
    event_raw_payload: legacyListingRawPayload({
      amount: "6000",
      tokenId: WORK_TOKEN_ID,
      version: "pwt-sale-v1",
    }),
    listing_id: "a".repeat(64),
    payload: {
      amount: "6000",
      amountAtoms: "600000000000",
      saleAuthorization: {
        amount: "6000",
        amountAtoms: "600000000000",
        version: "pwt-sale-v1",
      },
      tokenId: WORK_TOKEN_ID,
    },
  },
  {
    amount: "10000000000000000000",
    event_count: "1",
    event_payload: {
      amount: "1000",
      amountAtoms: "100000000000",
      saleAuthorization: {
        amount: "1000",
        version: "pwt-sale-v1",
      },
      tokenId: WORK_TOKEN_ID,
    },
    event_raw_payload: legacyListingRawPayload({
      amount: "1000",
      tokenId: WORK_TOKEN_ID,
      version: "pwt-sale-v1",
    }),
    listing_id: "b".repeat(64),
    payload: {
      amount: "1000",
      amountAtoms: "100000000000",
      legacyAmountAtoms: "100000000000",
      legacyAmountStorageModel:
        WORK_LEGACY_ATOMIC_PROJECTION_MODEL,
      precisionMigrationModel: WORK_PRECISION_V2_MIGRATION_MODEL,
      saleAuthorization: {
        amount: "1000",
        amountAtoms: "100000000000",
        version: "pwt-sale-v1",
      },
      tokenId: WORK_TOKEN_ID,
    },
  },
];
const legacyListingRepairs = workPrecisionV2LegacyListingRepairs(
  legacyListingRepairRows,
);
assert.equal(legacyListingRepairs.length, 1);
assert.deepEqual(
  {
    authorizationVersion:
      legacyListingRepairs[0].authorizationVersion,
    expectedAmountSubatoms:
      legacyListingRepairs[0].expectedAmountSubatoms,
    legacyAmountAtoms: legacyListingRepairs[0].legacyAmountAtoms,
    listingId: legacyListingRepairs[0].listingId,
    storedAmountSubatoms:
      legacyListingRepairs[0].storedAmountSubatoms,
  },
  {
    authorizationVersion: "pwt-sale-v1",
    expectedAmountSubatoms: "60000000000000000000",
    legacyAmountAtoms: "600000000000",
    listingId: "a".repeat(64),
    storedAmountSubatoms: "600000000000",
  },
  "legacy listing repair must derive Q8 atoms from immutable event payload rather than an ambiguous historical table amount",
);
assert.deepEqual(
  workPrecisionV2LegacyListingRepairs([
    {
      amount: "5100000000",
      event_count: "1",
      event_payload: {
        amount: "0.00000051",
        amountAtoms: "51",
        saleAuthorization: {
          tokenId: WORK_TOKEN_ID,
          unitFaceProofs: 100000,
          version: "pwt-sale-v6",
        },
        tokenId: WORK_TOKEN_ID,
      },
      event_raw_payload: legacyListingRawPayload({
        tokenId: WORK_TOKEN_ID,
        unitFaceProofs: 100000,
        version: "pwt-sale-v6",
      }),
      listing_id: "c".repeat(64),
      payload: {
        amount: "0.00000051",
        amountAtoms: "51",
        legacyAmountAtoms: "51",
        legacyAmountStorageModel:
          WORK_LEGACY_ATOMIC_PROJECTION_MODEL,
        precisionMigrationModel: WORK_PRECISION_V2_MIGRATION_MODEL,
        saleAuthorization: {
          tokenId: WORK_TOKEN_ID,
          unitFaceProofs: 100000,
          version: "pwt-sale-v6",
        },
        tokenId: WORK_TOKEN_ID,
      },
    },
  ]),
  [],
  "unit-era raw authorizations bind their inputs while canonical replay supplies the exact derived Q8 amount",
);
const metadataOnlyListingRepair =
  workPrecisionV2LegacyListingRepairs([
    {
      ...legacyListingRepairRows[1],
      payload: {
        ...legacyListingRepairRows[1].payload,
        legacyAmountAtoms: "wrong",
      },
    },
  ]);
assert.equal(metadataOnlyListingRepair.length, 1);
assert.equal(metadataOnlyListingRepair[0].metadataRepairRequired, true);
assert.equal(metadataOnlyListingRepair[0].valueRepairRequired, false);
assert.throws(
  () =>
    workPrecisionV2LegacyListingRepairs([
      {
        ...legacyListingRepairRows[0],
        event_payload: {
          ...legacyListingRepairRows[0].event_payload,
          amountAtoms: "600000000001",
        },
      },
    ]),
  /conflicting legacy amount aliases/u,
);
assert.throws(
  () =>
    workPrecisionV2LegacyListingRepairs([
      {
        ...legacyListingRepairRows[0],
        event_raw_payload: legacyListingRawPayload({
          amount: "6000",
          tokenId: WORK_TOKEN_ID,
          version: "pwt-sale-v7",
        }),
      },
    ]),
  /conflicting legacy listing authorization versions/u,
);
assert.throws(
  () => {
    const unsupportedAuthorization = {
      amount: "6000",
      tokenId: WORK_TOKEN_ID,
      version: "pwt-sale-v7",
    };
    return workPrecisionV2LegacyListingRepairs([
      {
        ...legacyListingRepairRows[0],
        event_payload: {
          ...legacyListingRepairRows[0].event_payload,
          saleAuthorization: unsupportedAuthorization,
        },
        event_raw_payload: legacyListingRawPayload(
          unsupportedAuthorization,
        ),
        payload: {
          ...legacyListingRepairRows[0].payload,
          saleAuthorization: unsupportedAuthorization,
        },
      },
    ]);
  },
  /unsupported legacy listing authorization pwt-sale-v7/u,
);
assert.throws(
  () =>
    workPrecisionV2LegacyListingRepairs([
      {
        ...legacyListingRepairRows[0],
        event_count: "2",
      },
    ]),
  /exactly one confirmed legacy listing event/u,
);
assert.throws(
  () =>
    workPrecisionV2LegacyListingRepairs([{
      amount: "1",
      listing_id: "invalid",
      payload: {
        amountAtoms: "1",
        authorizationVersion: "pwt-sale-v6",
      },
    }]),
  /invalid legacy listing identity/u,
);
const canonicalConstraintDefinitions = Object.freeze({
  ...WORK_PRECISION_V2_STATIC_CONSTRAINT_DEFINITIONS,
  v6Deactivation: "CHECK ((listing_block_height < 1200000))",
});
assert.deepEqual(workPrecisionV2ConstraintAudit(canonicalConstraintDefinitions), {
  definitionPrecisionReady: true,
  transitionReady: true,
  v6DeactivationInstalled: true,
  v6Q8Ready: true,
  v7Q16Ready: true,
  v7TransitionReady: true,
  v8FrozenReady: true,
  v8IdentityReady: true,
  v8PositionsReady: true,
  v8Q16Ready: true,
  v8TransitionReady: true,
  v8ValuesReady: true,
});
for (const [field, key, target] of [
  ["definitionPrecisionReady", "definitionPrecision", "10000000000000000000"],
  ["v6Q8Ready", "v6Values", "100000"],
  ["v6DeactivationInstalled", "v6Deactivation", "1200000"],
  ["v8ValuesReady", "v8Values", "25000"],
  ["v8IdentityReady", "v8Identity", WORK_AMO_V8_AUTH_VERSION],
  ["v8PositionsReady", "v8Positions", "listing_record_ordinal"],
  ["v8FrozenReady", "v8Frozen", WORK_AMO_V8_MODELS.unitModel],
  ["v8TransitionReady", "transitionModels", "canonical-work-amo-full-position-block-sequencer-v4"],
]) {
  const definitions = {
    ...canonicalConstraintDefinitions,
    [key]: canonicalConstraintDefinitions[key].replace(target, "mutated"),
  };
  assert.equal(
    workPrecisionV2ConstraintAudit(definitions)[field],
    false,
    `${field} must fail closed when its exact schema evidence is absent`,
  );
}

function wrappedConstraint(definition, operator) {
  const source = String(definition);
  assert.equal(source.startsWith("CHECK ("), true);
  assert.equal(source.endsWith(")"), true);
  const expression = source.slice("CHECK (".length, -1);
  return `CHECK ((${operator === "OR" ? "true OR " : ""}${expression}${
    operator === "AND" ? " AND true" : ""
  }))`;
}

for (const [field, key] of [
  ["definitionPrecisionReady", "definitionPrecision"],
  ["v6Q8Ready", "v6Values"],
  ["v8ValuesReady", "v8Values"],
  ["v8IdentityReady", "v8Identity"],
  ["v8PositionsReady", "v8Positions"],
  ["v8FrozenReady", "v8Frozen"],
  ["v8TransitionReady", "transitionModels"],
]) {
  for (const operator of ["OR", "AND"]) {
    const definitions = {
      ...canonicalConstraintDefinitions,
      [key]: wrappedConstraint(canonicalConstraintDefinitions[key], operator),
    };
    assert.equal(
      workPrecisionV2ConstraintAudit(definitions)[field],
      false,
      `${field} must reject an exact constraint hidden inside an ${
        operator === "OR" ? "always-true wrapper" : "extra-clause wrapper"
      }`,
    );
  }
}
for (const v6Deactivation of [
  "CHECK (((listing_block_height < 1200000) OR true))",
  "CHECK (((listing_block_height < 1200000) AND true))",
]) {
  assert.equal(
    workPrecisionV2ConstraintAudit({
      ...canonicalConstraintDefinitions,
      v6Deactivation,
    }).v6DeactivationInstalled,
    false,
    "the dynamic V6 boundary shape must reject tautologies and extra clauses",
  );
}

const v6Commitment = workAmoV6DeclarationCommitment();
assert.equal(v6Commitment.payloadBytes, 3343);
assert.equal(
  v6Commitment.payloadSha256,
  "f11779e8b76ad77047b23ff979b4a7e206a2b12a44983bea6835af938ed386f3",
);
assert.equal(v6Commitment.protocolRecordBytes, 3350);
assert.equal(
  v6Commitment.protocolRecordSha256,
  "b43daeea38fcacaf6afa6a48d3d0fde631497a4af9f3bb137fc07975d18bbe01",
);
assert.match(
  v6Commitment.text,
  /A=100000000 atoms per WORK/u,
);
assert.doesNotMatch(
  v6Commitment.text,
  /A=10000000000000000/u,
  "the confirmed V6 declaration must never be reinterpreted as Q16",
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
assert.equal(firstV6ListingTxid.length, 64);
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
assert.deepEqual(
  workAmoV6CanonicalTokenStateCommitment({
    confirmedSupplyAtoms: WORK_AMO_V5_ATOMS_PER_WORK.toString(),
    holders: [
      {
        address: firstV6ListingSeller,
        balanceAtoms: WORK_AMO_V5_ATOMS_PER_WORK.toString(),
      },
    ],
    listings: [
      {
        amountAtoms: "10",
        frozenTerms: firstV6ListingFrozenTerms,
        listingId: firstV6ListingTxid,
        priceSats: "20000",
        saleAuthorization: firstV6ListingAuthorization,
        sellerAddress: firstV6ListingSeller,
      },
    ],
  }),
  {
    model: "canonical-work-amo-payload-sha256-v1",
    payloadBytes: 2_316,
    sha256:
      "e3c735bfb17c69384de7d64acf3701cd9df36e20de8e27805bb712c17df14d1e",
  },
);
const migratedFirstV6 = scaleWorkPrecisionV2TokenState({
  confirmedSupplyAtoms: WORK_AMO_V5_ATOMS_PER_WORK.toString(),
  holders: [
    {
      address: firstV6ListingSeller,
      balanceAtoms: WORK_AMO_V5_ATOMS_PER_WORK.toString(),
    },
  ],
  listings: [
    {
      amountAtoms: "10",
      frozenTerms: firstV6ListingFrozenTerms,
      listingId: firstV6ListingTxid,
      priceSats: "20000",
      saleAuthorization: firstV6ListingAuthorization,
      sellerAddress: firstV6ListingSeller,
    },
  ],
});
assert.deepEqual(migratedFirstV6.subatomState.listings, []);
assert.equal(migratedFirstV6.subatomState.reservedSubatoms, "0");
assert.equal(migratedFirstV6.relicCutover.count, 1);
assert.equal(
  migratedFirstV6.relicCutover.items[0].listingId,
  firstV6ListingTxid,
);
assert.equal(migratedFirstV6.relicCutover.items[0].amountAtoms, "10");
assert.equal(
  migratedFirstV6.relicCutover.model,
  "canonical-work-amo-v8-preactivation-relic-cutover-v1",
);

const v7Text = buildWorkAmoV8DeclarationText();
const v7Commitment = workAmoV8DeclarationCommitment();
assert.equal(v7Commitment.text, v7Text);
assert.equal(v7Commitment.payloadBytes, 5586);
assert.equal(
  v7Commitment.payloadSha256,
  "0ef1432816fb93480b02a5302ce1c074d38f84a38e01150d57cf1df87d68024d",
);
assert.equal(v7Commitment.protocolRecordBytes, 5593);
assert.equal(
  v7Commitment.protocolRecordSha256,
  "1ba53b285f95f8d69f0272c8e75c76b09cd3bd26281c68e665749368e7694528",
);
assert.match(v7Text, /authorizationVersion=pwt-sale-v8/u);
assert.match(v7Text, /transferVersion=send3/u);
assert.match(v7Text, /workDecimals=16/u);
assert.match(v7Text, /mintAmountSubatoms=10000000000000000000/u);
assert.match(v7Text, /allowedFaceProofs=25000/u);
assert.match(v7Text, /subatomsPerWork=10000000000000000/u);
assert.match(v7Text, /legacyAtomToSubatomScale=100000000/u);
assert.match(v7Text, /unitAmountSubatoms=floor/u);
assert.match(v7Text, /unitPriceSats=F/u);
assert.match(v7Text, /unitMinimumPriceSats=ceil/u);
assert.doesNotMatch(v7Text, /unitPriceProofs=|unitMinimumPriceProofs=/u);
assert.match(v7Text, /network value remains exact Q8/u);
assert.match(v7Text, /no external price feed/u);

const fixtureSha256 = (value) =>
  createHash("sha256")
    .update(Buffer.from(value, "utf8"))
    .digest("hex");
const markerPins = Object.freeze({
  activationHeight: 1_200_000,
  declarationBlockHash: "cd".repeat(32),
  declarationBlockIndex: 3,
  declarationHeight: 1_199_999,
  declarationMemoBytes: v7Commitment.protocolRecordBytes,
  declarationMemoSha256: v7Commitment.protocolRecordSha256,
  declarationProtocolVout: 1,
  declarationRecordOrdinal: 0,
  declarationRegistryPaymentVout: 0,
  declarationTxid: "ab".repeat(32),
});
const declarationEvidenceCommitted = Object.freeze({
  authorityScriptPubKey:
    WORK_AMO_V5_DECLARATION_AUTHORITY_SCRIPT_PUBKEY,
  blockHash: markerPins.declarationBlockHash,
  blockHeight: markerPins.declarationHeight,
  blockTransactionIndex: markerPins.declarationBlockIndex,
  inputCount: 1,
  outputCount: 2,
  payloadBytes: markerPins.declarationMemoBytes,
  payloadSha256: markerPins.declarationMemoSha256,
  protocol: "pwm1",
  protocolVout: markerPins.declarationProtocolVout,
  recordOrdinal: markerPins.declarationRecordOrdinal,
  registryAddress: WORK_AMO_V5_DECLARATION_REGISTRY_ADDRESS,
  registryPaymentSats: String(
    WORK_AMO_V5_DECLARATION_MIN_PAYMENT_SATS,
  ),
  registryPaymentVout: markerPins.declarationRegistryPaymentVout,
  txid: markerPins.declarationTxid,
});
const declarationEvidenceCommitment = fixtureSha256(
  `ProofOfWork.Me/WORK-PRECISION-V2-DECLARATION-EVIDENCE/v1\n${JSON.stringify(
    declarationEvidenceCommitted,
  )}`,
);
const emptyRowsCommitment = Object.freeze({
  count: 0,
  payloadBytes: 2,
  sha256: fixtureSha256("[]"),
});
const exactMigrationMarker = Object.freeze({
  activationHeight: markerPins.activationHeight,
  activationOpening: {
    declarationClosingStatePayloadBytes: 1,
    declarationClosingStateSha256: "11".repeat(32),
    declarationTransitionModel: WORK_AMO_V6_BLOCK_SEQUENCER_MODEL,
    legacyTokenStateCommitment: {
      model: WORK_AMO_V5_PAYLOAD_COMMITMENT_MODEL,
      payloadBytes: 1,
      sha256: "22".repeat(32),
    },
    subatomTokenStateCommitment: {
      model: WORK_AMO_V5_PAYLOAD_COMMITMENT_MODEL,
      payloadBytes: 1,
      sha256: "33".repeat(32),
    },
  },
  after: {
    balances: emptyRowsCommitment,
    listings: emptyRowsCommitment,
  },
  before: {
    balances: emptyRowsCommitment,
    listings: emptyRowsCommitment,
  },
  completedAt: "2026-07-31T00:00:00.000Z",
  conversionFactor: "100000000",
  declarationBlockHash: markerPins.declarationBlockHash,
  declarationBlockIndex: markerPins.declarationBlockIndex,
  declarationEvidence: {
    ...declarationEvidenceCommitted,
    commitmentSha256: declarationEvidenceCommitment,
    coreVerified: true,
    evidenceComplete: true,
    indexVerified: true,
    model:
      "canonical-work-precision-v2-declaration-core-index-evidence-v1",
  },
  declarationHeight: markerPins.declarationHeight,
  declarationMemoBytes: markerPins.declarationMemoBytes,
  declarationMemoSha256: markerPins.declarationMemoSha256,
  declarationProtocolVout: markerPins.declarationProtocolVout,
  declarationRecordOrdinal: markerPins.declarationRecordOrdinal,
  declarationRegistryPaymentVout:
    markerPins.declarationRegistryPaymentVout,
  declarationTextBytes: v7Commitment.payloadBytes,
  declarationTextSha256: v7Commitment.payloadSha256,
  declarationTxid: markerPins.declarationTxid,
  decimals: 16,
  derivedProjectionPolicy: "invalidate-and-replay-from-activation",
  globalPrecisionModel: WORK_PRECISION_V2_MODEL,
  legacyDecimals: 8,
  legacyProjectionModel: WORK_LEGACY_ATOMIC_PROJECTION_MODEL,
  maxSupplySubatoms: WORK_AMO_V8_MAX_SUPPLY_SUBATOMS.toString(),
  migrationModel: WORK_PRECISION_V2_MIGRATION_MODEL,
  mintAmountSubatoms: WORK_AMO_V8_MINT_AMOUNT_SUBATOMS.toString(),
  model: WORK_PRECISION_V2_MIGRATION_MODEL,
  network: "livenet",
  projectionModel: WORK_SUBATOM_PROJECTION_MODEL,
  rawConfirmedHistoryMutation: "none",
  relicCutover: migratedFirstV6.relicCutover,
  replayFromHeight: markerPins.activationHeight,
  snapshotPolicy:
    "preserve-preactivation-canonical-invalidate-wrong-era-derived-require-post-migration-current-snapshot",
  status: "complete",
  transferVersion: WORK_AMO_V8_TRANSFER_VERSION,
  unitScale: WORK_SUBATOM_UNIT_SCALE_TEXT,
  updatedAt: "2026-07-31T00:00:00.000Z",
  version: WORK_AMO_V8_AUTH_VERSION,
});
assert.equal(
  workPrecisionV2MarkerReady(exactMigrationMarker, markerPins),
  true,
);
assert.equal(
  workPrecisionV2RelicCutoverReady(
    exactMigrationMarker.relicCutover,
  ),
  true,
);
assert.equal(
  workPrecisionV2MarkerReady(
    { ...exactMigrationMarker, unexpected: true },
    markerPins,
  ),
  false,
);
assert.equal(
  workPrecisionV2MarkerReady(
    {
      ...exactMigrationMarker,
      relicCutover: {
        ...exactMigrationMarker.relicCutover,
        items: exactMigrationMarker.relicCutover.items.map((item) => ({
          ...item,
          amountAtoms: "11",
        })),
      },
    },
    markerPins,
  ),
  false,
);
assert.equal(
  workPrecisionV2MarkerReady(
    { ...exactMigrationMarker, relicCutover: undefined },
    markerPins,
  ),
  false,
);

const firstV6ListingAmountSubatoms = legacyWorkAtomsToSubatoms(
  firstV6ListingFrozenTerms.unitAmountAtoms,
);
const exactRelicListing = Object.freeze({
  amount: formatWorkSubatoms(firstV6ListingAmountSubatoms),
  amountStorageModel: WORK_SUBATOM_PROJECTION_MODEL,
  amountSubatoms: firstV6ListingAmountSubatoms,
  blockHash: firstV6ListingFrozenTerms.listingBlockHash,
  blockHeight: firstV6ListingFrozenTerms.listingBlockHeight,
  blockIndex: firstV6ListingFrozenTerms.listingBlockIndex,
  buyerAddress: "must-not-survive",
  closeTxid: "ef".repeat(32),
  closedTxid: "ef".repeat(32),
  confirmed: true,
  decimals: WORK_SUBATOM_DECIMALS,
  listingId: firstV6ListingTxid,
  network: "livenet",
  precisionModel: WORK_PRECISION_V2_MODEL,
  priceSats: Number(firstV6ListingFrozenTerms.unitPriceSats),
  protocolVout: firstV6ListingFrozenTerms.listingProtocolVout,
  recordOrdinal: firstV6ListingFrozenTerms.listingRecordOrdinal,
  saleAuthorization: firstV6ListingAuthorization,
  saleTxid: "ef".repeat(32),
  sellerAddress: firstV6ListingSeller,
  status: "dropped",
  ticker: "WORK",
  tokenId: WORK_TOKEN_ID,
  txid: firstV6ListingTxid,
  unitScale: WORK_SUBATOM_UNIT_SCALE_TEXT,
});
const exactRelicPayload = Object.freeze({
  actionable: false,
  disabledAtBlockHeight: markerPins.activationHeight,
  disabledByTxid: markerPins.declarationTxid,
  disabledReason: "work-amo-v8-preactivation-relic",
  legacyAmountAtoms: firstV6ListingFrozenTerms.unitAmountAtoms,
  legacyAmountStorageModel: WORK_LEGACY_ATOMIC_PROJECTION_MODEL,
  precisionMigrationModel: WORK_PRECISION_V2_MIGRATION_MODEL,
  relic: true,
  relicCutoverModel: WORK_AMO_V8_RELIC_CUTOVER_MODEL,
  refundEligible: true,
  saleAuthorization: firstV6ListingAuthorization,
});
const exactRelicRow = Object.freeze({
  amount: firstV6ListingAmountSubatoms,
  listing_block_hash: firstV6ListingFrozenTerms.listingBlockHash,
  listing_block_height: firstV6ListingFrozenTerms.listingBlockHeight,
  listing_event_block_hash: firstV6ListingFrozenTerms.listingBlockHash,
  listing_event_block_height: firstV6ListingFrozenTerms.listingBlockHeight,
  listing_event_block_index: firstV6ListingFrozenTerms.listingBlockIndex,
  listing_event_match_count: "1",
  listing_event_protocol_vout:
    firstV6ListingFrozenTerms.listingProtocolVout,
  listing_event_record_ordinal:
    firstV6ListingFrozenTerms.listingRecordOrdinal,
  listing_event_status: "confirmed",
  listing_id: firstV6ListingTxid,
  listing_transaction_block_index:
    firstV6ListingFrozenTerms.listingBlockIndex,
  listing_tx_status: "confirmed",
  payload: exactRelicPayload,
  price_sats: firstV6ListingFrozenTerms.unitPriceSats,
  seller_address: firstV6ListingSeller,
  status: "dropped",
  token_id: WORK_TOKEN_ID,
});
const exactRelicProjectionInput = Object.freeze({
  listing: exactRelicListing,
  marker: exactMigrationMarker,
  network: "livenet",
  pins: markerPins,
  row: exactRelicRow,
});
const exactRelicProjection = workPrecisionV2RelicListingProjection(
  exactRelicProjectionInput,
);
assert.ok(exactRelicProjection);
assert.equal(exactRelicProjection.status, "disabled");
assert.equal(exactRelicProjection.actionable, false);
assert.equal(exactRelicProjection.relic, true);
assert.equal(exactRelicProjection.refundEligible, true);
assert.equal(exactRelicProjection.closedConfirmed, true);
assert.equal(exactRelicProjection.closeTxid, "");
assert.equal(exactRelicProjection.closedTxid, "");
assert.equal(exactRelicProjection.saleTxid, undefined);
assert.equal(exactRelicProjection.buyerAddress, "");
assert.equal(
  exactRelicProjection.amountSubatoms,
  firstV6ListingAmountSubatoms,
);
assert.equal(
  Object.prototype.hasOwnProperty.call(
    exactRelicProjection,
    "amountAtoms",
  ),
  false,
);

const relicProjectionWith = ({ listing, marker, network, pins, row }) =>
  workPrecisionV2RelicListingProjection({
    listing: listing ?? exactRelicListing,
    marker: marker ?? exactMigrationMarker,
    network: network ?? "livenet",
    pins: pins ?? markerPins,
    row: row ?? exactRelicRow,
  });
for (const [label, input] of [
  ["non-livenet", { network: "testnet" }],
  [
    "unexpected pin field",
    { pins: { ...markerPins, unexpected: true } },
  ],
  [
    "wrong declaration pin",
    { pins: { ...markerPins, declarationTxid: "00".repeat(32) } },
  ],
  [
    "unexpected marker field",
    { marker: { ...exactMigrationMarker, unexpected: true } },
  ],
  ["active relational status", { row: { ...exactRelicRow, status: "active" } }],
  [
    "off-by-one relational amount",
    { row: { ...exactRelicRow, amount: String(BigInt(firstV6ListingAmountSubatoms) + 1n) } },
  ],
  [
    "wrong relational seller",
    { row: { ...exactRelicRow, seller_address: "wrong" } },
  ],
  [
    "wrong relational price",
    { row: { ...exactRelicRow, price_sats: "20001" } },
  ],
  [
    "duplicate canonical listing event",
    { row: { ...exactRelicRow, listing_event_match_count: "2" } },
  ],
  [
    "post-activation listing position",
    {
      listing: {
        ...exactRelicListing,
        blockHeight: markerPins.activationHeight,
      },
      row: {
        ...exactRelicRow,
        listing_block_height: markerPins.activationHeight,
        listing_event_block_height: markerPins.activationHeight,
      },
    },
  ],
  [
    "wrong actionable overlay",
    {
      row: {
        ...exactRelicRow,
        payload: { ...exactRelicPayload, actionable: true },
      },
    },
  ],
  [
    "wrong disable height overlay",
    {
      row: {
        ...exactRelicRow,
        payload: {
          ...exactRelicPayload,
          disabledAtBlockHeight: markerPins.activationHeight + 1,
        },
      },
    },
  ],
  [
    "wrong disable tx overlay",
    {
      row: {
        ...exactRelicRow,
        payload: {
          ...exactRelicPayload,
          disabledByTxid: "00".repeat(32),
        },
      },
    },
  ],
  [
    "wrong legacy amount overlay",
    {
      row: {
        ...exactRelicRow,
        payload: { ...exactRelicPayload, legacyAmountAtoms: "11" },
      },
    },
  ],
  [
    "wrong legacy storage overlay",
    {
      row: {
        ...exactRelicRow,
        payload: {
          ...exactRelicPayload,
          legacyAmountStorageModel: WORK_SUBATOM_PROJECTION_MODEL,
        },
      },
    },
  ],
  [
    "wrong precision migration overlay",
    {
      row: {
        ...exactRelicRow,
        payload: {
          ...exactRelicPayload,
          precisionMigrationModel: "wrong",
        },
      },
    },
  ],
  [
    "wrong relic cutover overlay",
    {
      row: {
        ...exactRelicRow,
        payload: { ...exactRelicPayload, relicCutoverModel: "wrong" },
      },
    },
  ],
  [
    "missing relic flag",
    {
      row: {
        ...exactRelicRow,
        payload: { ...exactRelicPayload, relic: false },
      },
    },
  ],
  [
    "nonrefundable overlay",
    {
      row: {
        ...exactRelicRow,
        payload: { ...exactRelicPayload, refundEligible: false },
      },
    },
  ],
  [
    "off-by-one projected subatom amount",
    {
      listing: {
        ...exactRelicListing,
        amountSubatoms: String(BigInt(firstV6ListingAmountSubatoms) + 1n),
      },
    },
  ],
  [
    "special V3 nonrefundable relic",
    {
      listing: {
        ...exactRelicListing,
        saleAuthorization: {
          ...firstV6ListingAuthorization,
          version: "pwt-sale-v3",
        },
      },
      row: {
        ...exactRelicRow,
        payload: {
          ...exactRelicPayload,
          refundEligible: false,
          saleAuthorization: {
            ...firstV6ListingAuthorization,
            version: "pwt-sale-v3",
          },
        },
      },
    },
  ],
]) {
  assert.equal(
    relicProjectionWith(input),
    null,
    `${label} must never project as a refundable V8 relic`,
  );
}

const exactActivationLatch = Object.freeze({
  activationHeight: markerPins.activationHeight,
  authorityScriptPubKey:
    WORK_AMO_V5_DECLARATION_AUTHORITY_SCRIPT_PUBKEY,
  coreVerified: true,
  declarationBlockHash: markerPins.declarationBlockHash,
  declarationBlockIndex: markerPins.declarationBlockIndex,
  declarationHeight: markerPins.declarationHeight,
  declarationMemoBytes: markerPins.declarationMemoBytes,
  declarationMemoSha256: markerPins.declarationMemoSha256,
  declarationProtocolVout: markerPins.declarationProtocolVout,
  declarationRecordOrdinal: markerPins.declarationRecordOrdinal,
  declarationRegistryPaymentVout:
    markerPins.declarationRegistryPaymentVout,
  declarationTxid: markerPins.declarationTxid,
  evidenceComplete: true,
  firstObservedTipHash: "ef".repeat(32),
  firstObservedTipHeight: markerPins.activationHeight,
  indexVerified: true,
  inputCount: 1,
  model: WORK_AMO_V8_ACTIVATION_LATCH_MODEL,
  network: "livenet",
  observedAt: "2026-07-31T00:00:00.000Z",
  outputCount: 2,
  protocol: "pwm1",
  reached: true,
  registryAddress: WORK_AMO_V5_DECLARATION_REGISTRY_ADDRESS,
  registryPaymentSats: String(
    WORK_AMO_V5_DECLARATION_MIN_PAYMENT_SATS,
  ),
});
assert.equal(
  workAmoV8ActivationLatchReady(exactActivationLatch, markerPins),
  true,
);
assert.equal(
  workAmoV8ActivationLatchReady(
    { ...exactActivationLatch, unexpected: true },
    markerPins,
  ),
  false,
);
assert.equal(
  workAmoV8ActivationLatchReady(
    {
      ...exactActivationLatch,
      firstObservedTipHeight: markerPins.activationHeight + 1,
    },
    markerPins,
  ),
  false,
);
assert.equal(
  workAmoV8ActivationLatchReady(
    { ...exactActivationLatch, declarationMemoSha256: "00".repeat(32) },
    markerPins,
  ),
  false,
);

const repoRoot = new URL("../", import.meta.url);
const [server, reader, backfill, sql, app, migration] =
  await Promise.all([
    readFile(new URL("server/proof-api.mjs", repoRoot), "utf8"),
    readFile(
      new URL("server/db/proof-index-reader.mjs", repoRoot),
      "utf8",
    ),
    readFile(
      new URL("scripts/backfill-proof-indexer.mjs", repoRoot),
      "utf8",
    ),
    readFile(
      new URL("server/sql/proof-indexer-v1.sql", repoRoot),
      "utf8",
    ),
    readFile(new URL("src/App.tsx", repoRoot), "utf8"),
    readFile(
      new URL("scripts/migrate-work-precision-v2.mjs", repoRoot),
      "utf8",
    ),
  ]);

for (const [label, source] of [
  ["API", server],
  ["reader", reader],
  ["backfill", backfill],
  ["UI", app],
]) {
  assert.equal(
    /send3/u.test(source),
    true,
    `${label} must recognize send3`,
  );
  assert.equal(
    /work-subatoms-v2/u.test(source),
    true,
    `${label} must carry explicit Q16 metadata`,
  );
}
assert.match(server, /WORK_AMO_V8_WRITES_ENABLED/u);
assert.match(server, /WORK_AMO_V8_LEGACY_WRITE_EMBARGO/u);
assert.match(server, /discoverExactWorkAmoV8Declaration/u);
assert.match(
  server,
  /canonicalSaleEvidence:[\s\S]*amountSubatoms: evidence\.amountSubatoms/u,
);
assert.match(reader, /workPrecisionV2Migration:livenet/u);
assert.match(reader, /canonical-work-q16-pending-parity-v1/u);
assert.match(
  reader,
  /proofIndexWorkAmoV8ActivationLatch\([\s\S]*configuredPrecisionPins \?\? precisionLatch\?\.pins/u,
);
assert.match(
  reader,
  /function workListingAuthorizationAllowed\([\s\S]*WORK_MARKET_GOVERNED_AUTH_VERSIONS/u,
);
assert.match(reader, /work_amo_v6_terms_deactivation/u);
assert.match(
  reader,
  /exactHeightConstraint\([\s\S]*row\.v6_deactivation_constraint,[\s\S]*"<",[\s\S]*pins\.activationHeight/u,
);
assert.doesNotMatch(
  reader,
  /constraintHasEvery|logicalOrCount/u,
  "reader readiness must use exact shared schema attestation, not fragment matching",
);
assert.match(
  reader,
  /definition: sharedConstraintAudit\.definitionPrecisionReady[\s\S]*transition: sharedConstraintAudit\.transitionReady[\s\S]*v6: sharedConstraintAudit\.v6Q8Ready[\s\S]*sharedConstraintAudit\.v8ValuesReady/u,
);
assert.match(reader, /cd\.metadata AS token_metadata/u);
assert.match(
  reader,
  /export async function proofIndexWorkAmoV8ListingTerms/u,
);
assert.match(
  reader,
  /sourceSaleWorkAmount[\s\S]*targetStorageModel:[\s\S]*listingWorkAmount\.amountStorageModel/u,
);
assert.match(
  reader,
  /canonicalTokenListingEventJoinSql[\s\S]*WORK_AMO_V8_AUTH_VERSION[\s\S]*canonicalTokenListingSealEventJoinSql/u,
);
assert.match(
  reader,
  /workPrecisionV2ProjectCurrentPayload[\s\S]*targetStorageModel: WORK_SUBATOM_PROJECTION_MODEL/u,
);
assert.match(
  reader,
  /BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY[\s\S]*exactTipReady/u,
);
assert.match(
  reader,
  /proof-indexer-wallet-token-overlay[\s\S]*requireExactCheckpoint: true/u,
);
assert.match(
  reader,
  /proof-indexer-token-mint-stats[\s\S]*requireExactCheckpoint: true/u,
);
assert.match(
  reader,
  /exactWorkPrecisionObjectKeys\(marker, markerKeys\)/u,
);
assert.match(
  reader,
  /function tokenInvalidEventFromRow[\s\S]*workAmount = workAmountProjection\(payload, \{ allowZero: true \}\)[\s\S]*workAmountProjectionMetadataForAmount\(workAmount\)/u,
  "indexed invalid WORK events must preserve an exact Q16 amount projection instead of coercing through Number",
);
assert.match(
  server,
  /parsedTxAttemptedWorkAmountFields[\s\S]*attemptedAmountSubatoms:[\s\S]*attemptedPrecisionModel:[\s\S]*parsedTxAttemptedWorkAmountFields\?\.amount/u,
  "rejected canonical send3 records must retain attempted subatoms and precision metadata",
);
assert.match(
  app,
  /type PowTokenState = \{[\s\S]*confirmedSupplySubatoms\?: string;[\s\S]*pendingSupplySubatoms\?: string;[\s\S]*precisionModel\?: string;/u,
  "frontend state types must expose exact Q16 supply metadata",
);
assert.match(
  app,
  /function tokenSummaryMetadata[\s\S]*confirmedSupplySubatoms: state\.confirmedSupplySubatoms[\s\S]*pendingSupplySubatoms: state\.pendingSupplySubatoms[\s\S]*precisionModel: state\.precisionModel/u,
  "frontend summary normalization must retain exact Q16 top-level metadata",
);
assert.match(
  app,
  /const WORK_TOKEN_DEFINITION:[\s\S]*maxSupplySubatoms: WORK_TOKEN_MAX_SUPPLY_SUBATOMS[\s\S]*mintAmountSubatoms: WORK_TOKEN_MINT_AMOUNT_SUBATOMS[\s\S]*precisionModel: WORK_TOKEN_PRECISION_MODEL/u,
  "the frontend canonical WORK definition must expose Q16 max-supply and mint units",
);
assert.match(
  reader,
  /const relicListing = relicProjectionContext[\s\S]*closedListings\.push\(relicListing\);[\s\S]*continue;[\s\S]*row\.listing_tx_status === "confirmed"/u,
  "a marker-bound V8 relic must close before any later raw ticket spend is classified",
);
assert.match(backfill, /amountSubatoms/u);
assert.match(backfill, /canonical-work-q16-pending-parity-v1/u);
assert.match(backfill, /discoverIndexedWorkAmoV8DeclarationPins/u);
assert.match(sql, /work_amo_v8_listing_terms/u);
assert.match(sql, /unit_amount_subatoms/u);
assert.match(sql, /workPrecisionV2Migration:livenet/u);
assert.match(migration, /WORK_PRECISION_V2_MIGRATION_APPLY/u);
assert.match(migration, /work_amo_v6_terms_deactivation/u);
assert.match(migration, /listing_block_height < \$\{pins\.activationHeight\}/u);
assert.match(
  migration,
  /'legacyAmountStorageModel', \$4::text,[\s\S]*'precisionMigrationModel', \$5::text/u,
  "migration JSON construction must type text parameters explicitly for PostgreSQL",
);
assert.match(
  migration,
  /listing\.payload->>'legacyAmountAtoms' =\s*\(\$3::numeric\)::text/u,
  "migration relic matching must compare the reused numeric parameter as text",
);
assert.match(
  migration,
  /'disabledAtBlockHeight', \$2::integer,[\s\S]*'disabledByTxid', \$3::text,[\s\S]*'relicCutoverModel', \$5::text/u,
  "relic cutover JSON parameters must carry explicit PostgreSQL types",
);
assert.match(
  migration,
  /UPDATE proof_indexer\.credit_listings listing[\s\S]*listing\.status IN \('active', 'sealing'\)[\s\S]*IN \('pwt-sale-v1', 'pwt-sale-v2'\)/u,
  "migration must close only stale historical V1/V2 status projections outside the canonical V8 relic set",
);
assert.match(migration, /DELETE FROM proof_indexer\.events event/u);
assert.match(
  migration,
  /event\.status = 'pending'[\s\S]*event\.block_height >= \$2/u,
  "migration removes volatile pending and wrong-era derived events without deleting preactivation relic history",
);
assert.match(
  migration,
  /UPDATE proof_indexer\.credit_listings listing[\s\S]*amount = listing\.amount \* \$3::numeric[\s\S]*'legacyAmountAtoms'[\s\S]*listing_tx\.block_height < \$2/u,
  "every retained preactivation listing row must carry an exact Q8-to-Q16 amount conversion witness",
);
assert.match(
  migration,
  /DELETE FROM proof_indexer\.ledger_snapshots snapshot[\s\S]*snapshot\.indexed_through_block >= \$1[\s\S]*evidence_event\.payload::text[\s\S]*workAmoV5Migration:livenet/u,
);
assert.match(migration, /rawConfirmedHistoryMutation: "none"/u);
assert.match(
  migration,
  /derivedProjectionPolicy:\s*"invalidate-and-replay-from-activation"/u,
);
assert.match(migration, /100000000/u);
assert.match(migration, /conservation/iu);

console.log(
  "WORK Precision Protocol V2 contract: global Q16 units, immutable Q8 conversion, V8 pricing, cutover, metadata and cross-plane wiring pass.",
);
