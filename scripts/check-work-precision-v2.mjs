import assert from "node:assert/strict";
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
  WORK_AMO_V7_ALLOWED_FACE_PROOFS,
  WORK_AMO_V7_AUTH_VERSION,
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
  deriveWorkAmoV7FrozenTerms,
  validateWorkAmoV7ListingCutover,
  validateWorkAmoV7FrozenTerms,
  workAmoV7CanonicalTokenStateCommitment,
  workAmoV7CanonicalTokenStatePreimage,
  workAmoV7UnitTerms,
} from "../server/work-amo-v7.mjs";
import {
  buildWorkAmoV7DeclarationText,
  workAmoV7DeclarationCommitment,
} from "../server/work-amo-v7-declaration.mjs";
import {
  WORK_AMO_V6_AUTH_VERSION,
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
  WORK_AMO_V5_DECLARATION_REGISTRY_ADDRESS,
} from "../server/work-amo-v5.mjs";
import {
  workPrecisionV2CurrentPayloadIsExact,
  workPrecisionV2ProjectCurrentPayload,
} from "../server/db/proof-index-reader.mjs";
import {
  canonicalWorkPrecisionV2Rows,
  scaleWorkPrecisionV2Rows,
  verifyWorkPrecisionV2RowsConserved,
  workPrecisionV2ConstraintAudit,
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

assert.equal(WORK_AMO_V7_AUTH_VERSION, "pwt-sale-v7");
assert.equal(WORK_AMO_V7_TRANSFER_VERSION, "send3");
assert.equal(WORK_AMO_V7_DECIMALS, 16);
assert.equal(
  WORK_AMO_V7_SUBATOMS_PER_WORK.toString(),
  WORK_SUBATOM_UNIT_SCALE_TEXT,
);
assert.equal(
  WORK_AMO_V7_LEGACY_ATOM_TO_SUBATOM_SCALE,
  WORK_SUBATOM_CONVERSION_FACTOR,
);
assert.equal(
  WORK_AMO_V7_MAX_SUPPLY_SUBATOMS.toString(),
  "210000000000000000000000",
);
assert.equal(
  WORK_AMO_V7_MINT_AMOUNT_SUBATOMS.toString(),
  "10000000000000000000",
);
assert.equal(WORK_AMO_V7_PRECISION_MODEL, WORK_SUBATOM_PROJECTION_MODEL);
assert.equal(WORK_AMO_V7_GLOBAL_PRECISION_MODEL, WORK_PRECISION_V2_MODEL);
assert.equal(
  WORK_AMO_V7_PRECISION_MIGRATION_MODEL,
  WORK_PRECISION_V2_MIGRATION_MODEL,
);
assert.deepEqual(
  [...WORK_AMO_V7_ALLOWED_FACE_PROOFS],
  [20_000, 50_000, 100_000],
);

const launchNetworkValueQ8 = 21_000_000n * 100_000_000n;
for (const face of WORK_AMO_V7_ALLOWED_FACE_PROOFS) {
  const terms = workAmoV7UnitTerms({
    networkValueBeforeQ8: launchNetworkValueQ8.toString(),
    unitFaceProofs: face,
  });
  assert.equal(terms.valid, true);
  assert.equal(
    terms.unitAmountSubatoms,
    (BigInt(face) * WORK_AMO_V7_SUBATOMS_PER_WORK).toString(),
  );
  assert.equal(terms.unitPriceSats, String(face));
  assert.equal(terms.unitMinimumPriceSats, String(face));
  assert.equal("unitAmountAtoms" in terms, false);
}
const nonLegacyAlignedNetworkValueQ8 =
  launchNetworkValueQ8 + 1n;
const preciseV7Terms = workAmoV7UnitTerms({
  networkValueBeforeQ8:
    nonLegacyAlignedNetworkValueQ8.toString(),
  unitFaceProofs: 20_000,
});
const v7FormulaDenominator =
  21_000_000n *
  WORK_AMO_V7_SUBATOMS_PER_WORK *
  100_000_000n;
assert.equal(preciseV7Terms.valid, true);
assert.equal(
  preciseV7Terms.unitAmountSubatoms,
  (
    (20_000n * v7FormulaDenominator) /
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
  "V7 must retain precision below one historical atom",
);
assert.equal(
  workAmoV7UnitTerms({
    networkValueBeforeQ8: "0",
    unitFaceProofs: 20_000,
  }).reasonCode,
  "work-amo-v7-network-value-before-invalid",
);
assert.equal(
  workAmoV7UnitTerms({
    networkValueBeforeQ8: "1",
    unitFaceProofs: 20_000,
  }).reasonCode,
  "work-amo-v7-unit-amount-exceeds-supply",
);
for (const networkValueBeforeQ8 of [
  ` ${launchNetworkValueQ8}`,
  `${launchNetworkValueQ8} `,
  `+${launchNetworkValueQ8}`,
  `0${launchNetworkValueQ8}`,
  "2.1e15",
]) {
  assert.equal(
    workAmoV7UnitTerms({
      networkValueBeforeQ8,
      unitFaceProofs: 20_000,
    }).reasonCode,
    "work-amo-v7-network-value-before-invalid",
    `V7 network value must reject integer alias ${JSON.stringify(networkValueBeforeQ8)}`,
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
  validateWorkAmoV7ListingCutover({
    activationHeight,
    authorizationVersion: "pwt-sale-v6",
    listingPosition: position(activationHeight - 1),
  }).valid,
  true,
);
assert.equal(
  validateWorkAmoV7ListingCutover({
    activationHeight,
    authorizationVersion: "pwt-sale-v6",
    listingPosition: position(activationHeight - 1),
  }).historical,
  true,
);
assert.equal(
  validateWorkAmoV7ListingCutover({
    activationHeight,
    authorizationVersion: WORK_AMO_V7_AUTH_VERSION,
    listingPosition: position(activationHeight - 1),
  }).valid,
  false,
);
assert.equal(
  validateWorkAmoV7ListingCutover({
    activationHeight,
    authorizationVersion: WORK_AMO_V7_AUTH_VERSION,
    listingPosition: position(activationHeight - 1),
  }).reasonCode,
  "work-amo-v7-listing-before-activation",
);
assert.equal(
  validateWorkAmoV7ListingCutover({
    activationHeight,
    authorizationVersion: "pwt-sale-v6",
    listingPosition: position(activationHeight),
  }).valid,
  false,
);
assert.equal(
  validateWorkAmoV7ListingCutover({
    activationHeight,
    authorizationVersion: "pwt-sale-v6",
    listingPosition: position(activationHeight),
  }).reasonCode,
  "work-amo-v7-version-required",
);
assert.equal(
  validateWorkAmoV7ListingCutover({
    activationHeight,
    authorizationVersion: WORK_AMO_V7_AUTH_VERSION,
    listingPosition: position(activationHeight),
  }).valid,
  true,
);

const strictV7Authorization = {
  ...WORK_AMO_V7_MODELS,
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
  unitFaceProofs: 20_000,
  version: WORK_AMO_V7_AUTH_VERSION,
};
const strictV7Position = {
  blockHash: "22".repeat(32),
  blockHeight: activationHeight,
  blockTransactionIndex: 1,
  protocolVout: 1,
  recordOrdinal: 0,
};
const strictV7BondQ8 = 546n * 100_000_000n;
const strictV7Derived = deriveWorkAmoV7FrozenTerms(
  strictV7Authorization,
  {
    activationHeight,
    listingBondContributionQ8: strictV7BondQ8.toString(),
    listingPosition: strictV7Position,
    networkValueBeforeQ8: launchNetworkValueQ8.toString(),
    spendableAmountSubatoms:
      WORK_AMO_V7_MAX_SUPPLY_SUBATOMS.toString(),
  },
);
assert.equal(strictV7Derived.valid, true);
assert.equal(
  deriveWorkAmoV7FrozenTerms(strictV7Authorization, {
    activationHeight,
    listingBondContributionQ8: strictV7BondQ8.toString(),
    listingPosition: strictV7Position,
    networkValueBeforeQ8: ` ${launchNetworkValueQ8}`,
    spendableAmountSubatoms:
      WORK_AMO_V7_MAX_SUPPLY_SUBATOMS.toString(),
  }).reasonCode,
  "work-amo-v7-network-value-before-invalid",
  "confirmed V7 derivation must reject whitespace in N-before",
);
assert.equal(
  deriveWorkAmoV7FrozenTerms(strictV7Authorization, {
    activationHeight,
    listingBondContributionQ8: strictV7BondQ8.toString(),
    listingPosition: strictV7Position,
    networkValueBeforeQ8: launchNetworkValueQ8.toString(),
    spendableAmountSubatoms:
      ` ${WORK_AMO_V7_MAX_SUPPLY_SUBATOMS}`,
  }).reasonCode,
  "work-amo-v7-spendable-balance-unavailable",
  "confirmed V7 derivation must reject whitespace in spendable subatoms",
);
assert.equal(
  deriveWorkAmoV7FrozenTerms(strictV7Authorization, {
    activationHeight,
    listingBondContributionQ8: strictV7BondQ8.toString(),
    listingPosition: strictV7Position,
    networkValueBeforeQ8: launchNetworkValueQ8.toString(),
    spendableAmountSubatoms: Number(
      WORK_AMO_V7_MAX_SUPPLY_SUBATOMS,
    ),
  }).reasonCode,
  "work-amo-v7-spendable-balance-unavailable",
  "unsafe Number must never authorize a V7 subatom spend",
);
assert.equal(
  validateWorkAmoV7FrozenTerms({
    ...strictV7Derived.frozenTerms,
    unitAmountSubatoms:
      ` ${strictV7Derived.frozenTerms.unitAmountSubatoms}`,
  }).reasonCode,
  "work-amo-v7-frozen-terms-invalid",
  "frozen V7 subatoms must be a canonical integer string",
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
  workAmoV7CanonicalTokenStatePreimage(oneLegacyAtomOpening);
assert.equal(openingPreimage.confirmedSupplySubatoms, "100000000");
assert.equal(openingPreimage.definition.decimals, 16);
assert.equal(
  openingPreimage.definition.amountStorageModel,
  WORK_SUBATOM_PROJECTION_MODEL,
);
assert.equal(openingPreimage.reservedSubatoms, "0");
assert.deepEqual(
  workAmoV7CanonicalTokenStateCommitment(oneLegacyAtomOpening),
  workAmoV7CanonicalTokenStateCommitment(openingPreimage),
);
assert.throws(() =>
  workAmoV7CanonicalTokenStatePreimage({
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
assert.deepEqual(
  workPrecisionV2ConstraintAudit({
    definitionPrecision:
      "work-atoms-v1 work-subatoms-v2 10000000000000000",
    transitionModels:
      "canonical-work-amo-full-position-block-sequencer-v3 canonical-work-token-state-subatoms-v2",
    v6Deactivation: "CHECK (listing_block_height < 1200000)",
    v6Values: "2100000000000000 100000000",
    v7Values:
      "210000000000000000000000 10000000000000000",
  }),
  {
    definitionPrecisionReady: true,
    v6DeactivationInstalled: true,
    v6Q8Ready: true,
    v7Q16Ready: true,
    v7TransitionReady: true,
  },
);
for (const [field, definitions] of [
  [
    "v6DeactivationInstalled",
    {
      definitionPrecision:
        "work-atoms-v1 work-subatoms-v2 10000000000000000",
      transitionModels:
        "canonical-work-amo-full-position-block-sequencer-v3 canonical-work-token-state-subatoms-v2",
      v6Values: "2100000000000000 100000000",
      v7Values:
        "210000000000000000000000 10000000000000000",
    },
  ],
  [
    "definitionPrecisionReady",
    {
      definitionPrecision: "work-subatoms-v2 10000000000000000",
      transitionModels:
        "canonical-work-amo-full-position-block-sequencer-v3 canonical-work-token-state-subatoms-v2",
      v6Values: "2100000000000000 100000000",
      v7Values:
        "210000000000000000000000 10000000000000000",
    },
  ],
  [
    "v6Q8Ready",
    {
      definitionPrecision:
        "work-atoms-v1 work-subatoms-v2 10000000000000000",
      transitionModels:
        "canonical-work-amo-full-position-block-sequencer-v3 canonical-work-token-state-subatoms-v2",
      v6Values:
        "2100000000000000 100000000 10000000000000000",
      v7Values:
        "210000000000000000000000 10000000000000000",
    },
  ],
  [
    "v7Q16Ready",
    {
      definitionPrecision:
        "work-atoms-v1 work-subatoms-v2 10000000000000000",
      transitionModels:
        "canonical-work-amo-full-position-block-sequencer-v3 canonical-work-token-state-subatoms-v2",
      v6Values: "2100000000000000 100000000",
      v7Values: "210000000000000000000000",
    },
  ],
  [
    "v7TransitionReady",
    {
      definitionPrecision:
        "work-atoms-v1 work-subatoms-v2 10000000000000000",
      transitionModels:
        "canonical-work-token-state-subatoms-v2",
      v6Values: "2100000000000000 100000000",
      v7Values:
        "210000000000000000000000 10000000000000000",
    },
  ],
]) {
  assert.equal(
    workPrecisionV2ConstraintAudit(definitions)[field],
    false,
    `${field} must fail closed when its exact schema evidence is absent`,
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
const migratedFirstV6Preimage =
  workAmoV7CanonicalTokenStatePreimage({
    confirmedSupplySubatoms:
      WORK_AMO_V7_SUBATOMS_PER_WORK.toString(),
    holders: [
      {
        address: firstV6ListingSeller,
        balanceSubatoms:
          WORK_AMO_V7_SUBATOMS_PER_WORK.toString(),
      },
    ],
    listings: [
      {
        amountSubatoms: "1000000000",
        frozenTerms: firstV6ListingFrozenTerms,
        listingId: firstV6ListingTxid,
        priceSats: "20000",
        saleAuthorization: firstV6ListingAuthorization,
        sellerAddress: firstV6ListingSeller,
      },
    ],
  });
assert.equal(
  migratedFirstV6Preimage.listings[0].amountSubatoms,
  "1000000000",
);
assert.equal(
  migratedFirstV6Preimage.listings[0].frozenTerms.unitAmountAtoms,
  "10",
);
assert.equal(
  "unitAmountSubatoms" in
    migratedFirstV6Preimage.listings[0].frozenTerms,
  false,
  "Q16 current-state migration must preserve immutable V6 frozen terms",
);

const v7Text = buildWorkAmoV7DeclarationText();
const v7Commitment = workAmoV7DeclarationCommitment();
assert.equal(v7Commitment.text, v7Text);
assert.equal(v7Commitment.payloadBytes, 8136);
assert.equal(
  v7Commitment.payloadSha256,
  "48d154fd53ba70163771607b7bb43a1786f78cdcad02f260ab5806e9f2f195b0",
);
assert.equal(v7Commitment.protocolRecordBytes, 8143);
assert.equal(
  v7Commitment.protocolRecordSha256,
  "e85a332b2647381e5e69c5e85be59bb873adc89d1745c768643af0f0bfd75527",
);
assert.match(v7Text, /authorizationVersion=pwt-sale-v7/u);
assert.match(v7Text, /transferVersion=send3/u);
assert.match(v7Text, /workDecimals=16/u);
assert.match(v7Text, /mintAmountSubatoms=10000000000000000000/u);
assert.match(
  v7Text,
  /volatile pending WORK event listing action and balance-delta projections are purged while noncanonical transaction envelopes remain raw recovery input/u,
);
assert.match(v7Text, /subatomsPerWork=10000000000000000/u);
assert.match(v7Text, /legacyAtomToSubatomScale=100000000/u);
assert.match(v7Text, /unitAmountSubatoms=floor/u);
assert.match(v7Text, /unitPriceSats=F/u);
assert.match(v7Text, /unitMinimumPriceSats=ceil/u);
assert.doesNotMatch(v7Text, /unitPriceProofs=|unitMinimumPriceProofs=/u);
assert.match(v7Text, /network value remains exact Q8/u);
assert.match(v7Text, /no external price feed/u);

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
assert.match(server, /WORK_AMO_V7_WRITES_ENABLED/u);
assert.match(server, /WORK_AMO_V7_LEGACY_WRITE_EMBARGO/u);
assert.match(server, /discoverExactWorkAmoV7Declaration/u);
assert.match(
  server,
  /canonicalSaleEvidence:[\s\S]*amountSubatoms: evidence\.amountSubatoms/u,
);
assert.match(reader, /workPrecisionV2Migration:livenet/u);
assert.match(reader, /canonical-work-q16-pending-parity-v1/u);
assert.match(
  reader,
  /proofIndexWorkAmoV7ActivationLatch\([\s\S]*configuredPrecisionPins \?\? precisionLatch\?\.pins/u,
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
assert.match(reader, /cd\.metadata AS token_metadata/u);
assert.match(
  reader,
  /export async function proofIndexWorkAmoV7ListingTerms/u,
);
assert.match(
  reader,
  /sourceSaleWorkAmount[\s\S]*targetStorageModel:[\s\S]*listingWorkAmount\.amountStorageModel/u,
);
assert.match(
  reader,
  /canonicalTokenListingEventJoinSql[\s\S]*WORK_AMO_V7_AUTH_VERSION[\s\S]*canonicalTokenListingSealEventJoinSql/u,
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
assert.match(backfill, /amountSubatoms/u);
assert.match(backfill, /canonical-work-q16-pending-parity-v1/u);
assert.match(backfill, /discoverIndexedWorkAmoV7DeclarationPins/u);
assert.match(sql, /work_amo_v7_listing_terms/u);
assert.match(sql, /unit_amount_subatoms/u);
assert.match(sql, /workPrecisionV2Migration:livenet/u);
assert.match(migration, /WORK_PRECISION_V2_MIGRATION_APPLY/u);
assert.match(migration, /work_amo_v6_terms_deactivation/u);
assert.match(migration, /listing_block_height < \$\{pins\.activationHeight\}/u);
assert.match(migration, /DELETE FROM proof_indexer\.events event/u);
assert.match(
  migration,
  /event\.status <> 'confirmed'[\s\S]*event\.block_height >= \$2/u,
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
  "WORK Precision Protocol V2 contract: global Q16 units, immutable Q8 conversion, V7 pricing, cutover, metadata and cross-plane wiring pass.",
);
