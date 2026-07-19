#!/usr/bin/env node

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  BOND_VALUE_Q8_SCALE,
  addIntegerTexts,
  canonicalIntegerText,
  decimalTextFromQ8,
  floorQ8PerUnit,
  integerBigInt,
  maxIntegerTexts,
  q8TextFromDecimal,
  q8TextFromIntegerUnits,
  safeIntegerNumber,
} from "../server/bond-units.mjs";
import { exactBondTokenIdForMintOverlay } from "../server/db/proof-index-reader.mjs";
import {
  exactBondSupplyState,
  exactCreditFrozenValueState,
  exactInceptionLedgerState,
} from "./ledger-audit-exact.mjs";

const INCB_TOKEN_ID =
  "3cb25745f937f2b4e5508e5400189fe8fe679cd8e84bfa1e9176d70c9761f15d";
const unsafeSupply = "12692190658411190";

assert.equal(canonicalIntegerText(unsafeSupply), unsafeSupply);
assert.equal(integerBigInt(unsafeSupply), 12_692_190_658_411_190n);
assert.equal(safeIntegerNumber(unsafeSupply), null);
assert.equal(canonicalIntegerText(Number(unsafeSupply)), "");
assert.equal(addIntegerTexts(unsafeSupply, "810"), "12692190658412000");
assert.equal(maxIntegerTexts(unsafeSupply, "9007199254740991"), unsafeSupply);

const issuanceDustQ8 = "82282200";
const issuanceNetworkValueQ8 = addIntegerTexts(
  q8TextFromIntegerUnits(unsafeSupply),
  issuanceDustQ8,
);
assert.equal(
  issuanceNetworkValueQ8,
  (12_692_190_658_411_190n * BOND_VALUE_Q8_SCALE + 82_282_200n)
    .toString(),
);
assert.equal(
  decimalTextFromQ8(issuanceNetworkValueQ8),
  "12692190658411190.822822",
);
assert.equal(q8TextFromDecimal("18.92911351"), "1892911351");
assert.equal(
  floorQ8PerUnit(issuanceNetworkValueQ8, unsafeSupply),
  "100000000",
);

const conserved = ["9007199254740993", "3684991403670197"].reduce(
  addIntegerTexts,
  "0",
);
assert.equal(conserved, unsafeSupply);
assert.doesNotThrow(() =>
  JSON.stringify({
    balance: unsafeSupply,
    confirmedSupply: unsafeSupply,
    issuanceNetworkValueQ8,
  }),
);

const adjacentUnsafeSupply = exactBondSupplyState(
  {
    stats: {
      confirmedSupply: "9007199254740992",
      pendingSupply: "0",
    },
  },
  {
    confirmedSupply: "9007199254740993",
    pendingSupply: "0",
  },
);
assert.equal(Number("9007199254740992"), Number("9007199254740993"));
assert.equal(adjacentUnsafeSupply.exactFieldsPresent, true);
assert.equal(
  adjacentUnsafeSupply.confirmedMatches,
  false,
  "adjacent supplies above 2^53 must not compare through Number",
);
assert.equal(
  exactBondSupplyState(
    { stats: { confirmedSupply: 10, pendingSupply: "0" } },
    { confirmedSupply: "10", pendingSupply: "0" },
  ).exactFieldsPresent,
  false,
  "current bond supplies must use canonical exact strings",
);

const creditEventFrozenValueQ8 = "1662232770668615317979969";
const creditMovementFrozenValueQ8 = "1662232766847960017979969";
const creditFixedFlowSats = 38_206_553;
const creditFrozenFixture = {
  creditEventFrozenValueQ8,
  creditEventFrozenValueSats: Number(
    decimalTextFromQ8(creditEventFrozenValueQ8),
  ),
  creditMovementFrozenValueQ8,
  creditMovementFrozenValueSats: Number(
    decimalTextFromQ8(creditMovementFrozenValueQ8),
  ),
  creditProofPaymentFlowSats: creditFixedFlowSats,
  creditRegistryMutationFlowSats: 0,
  creditMarketplaceMutationFlowSats: 0,
  creditSalePaymentFlowSats: 0,
  creditMinerFeeFlowSats: 0,
};
assert.equal(
  creditFrozenFixture.creditEventFrozenValueSats -
    (creditFrozenFixture.creditMovementFrozenValueSats +
      creditFixedFlowSats),
  2,
  "production-scale Number aliases must reproduce the two-proof rounding gap",
);
assert.equal(
  exactCreditFrozenValueState(creditFrozenFixture).componentsAgree,
  true,
  "frozen credit components must reconcile through exact Q8 arithmetic",
);
assert.equal(
  exactCreditFrozenValueState({
    ...creditFrozenFixture,
    creditEventFrozenValueQ8: (
      BigInt(creditEventFrozenValueQ8) + 1n
    ).toString(),
  }).componentsAgree,
  false,
  "one Q8 of frozen credit drift must fail exact reconciliation",
);
assert.equal(
  exactCreditFrozenValueState({
    creditEventFrozenValueSats: 10,
    creditMovementFrozenValueSats: 5,
  }).q8FieldsAbsent,
  true,
  "historical payloads without Q8 aggregates may use the legacy audit path",
);

function exactInceptionFixture(
  confirmedSupply,
  { issuanceDustQ8 = 12_345_678n, attachedWorkActions = 1 } = {},
) {
  const supply = BigInt(confirmedSupply);
  const direct = 546n;
  const attached = supply - direct;
  const attachedAtSendQ8 =
    attached * BOND_VALUE_Q8_SCALE + issuanceDustQ8;
  const issuanceValueQ8 =
    direct * BOND_VALUE_Q8_SCALE + attachedAtSendQ8;
  const saleFlow = 2n;
  const transferFlow = 3n;
  const mutationFlow = 5n;
  const marketFlowQ8 =
    (saleFlow + transferFlow + mutationFlow) * BOND_VALUE_Q8_SCALE;
  const networkValueQ8 = issuanceValueQ8 + marketFlowQ8;
  const issuanceFloorQ8 = issuanceValueQ8 / supply;
  const networkFloorQ8 = networkValueQ8 / supply;
  const attachedWorkAmountAtoms = 2_100_000_000_000_000n;
  const attachedWorkLiveFloorAtSendQ8 =
    (attachedAtSendQ8 * 100_000_000n) / attachedWorkAmountAtoms;
  const actualValue = {
    attachedWorkActions,
    attachedWorkAmountAtoms: attachedWorkAmountAtoms.toString(),
    attachedWorkFrozenValueQ8: attachedAtSendQ8.toString(),
    attachedWorkIssuanceUnits: attached.toString(),
    attachedWorkLiveFloorAtSendQ8:
      attachedWorkLiveFloorAtSendQ8.toString(),
    attachedWorkLiveValueAtSendQ8: attachedAtSendQ8.toString(),
    attachedWorkLiveValueQ8: attachedAtSendQ8.toString(),
    attachedWorkUnmatchedActions: 0,
    attachedWorkUnvaluedActions: 0,
    attachmentAccountingModel:
      "canonical-pre-bond-live-network-value-v2",
    baseNetworkValueQ8: (
      (direct + saleFlow + transferFlow + mutationFlow) *
      BOND_VALUE_Q8_SCALE
    ).toString(),
    bondMarketplaceMutationFeeSats: mutationFlow.toString(),
    bondMintFlowSats: direct.toString(),
    bondSaleVolumeSats: saleFlow.toString(),
    bondTransferFeeSats: transferFlow.toString(),
    confirmedIssuanceUnits: supply.toString(),
    directProofIssuanceUnits: direct.toString(),
    floorQ8: networkFloorQ8.toString(),
    frozenFloorQ8: networkFloorQ8.toString(),
    frozenNetworkValueQ8: networkValueQ8.toString(),
    issuanceAccountingModel:
      "canonical-pre-bond-live-network-value-v2",
    issuanceCheckpointMode: "bond-transaction-provenance",
    issuanceDustQ8: issuanceDustQ8.toString(),
    issuanceFloorQ8: issuanceFloorQ8.toString(),
    issuanceNetworkValueQ8: issuanceValueQ8.toString(),
    issuanceUnitSats: 1,
    issuanceValuationFixedAtSend: true,
    issuanceValueSnapshotMode: "canonical-summary-refresh",
    issuanceValueSnapshotModel: "canonical-summary-h-minus-one-v1",
    issuanceValueSnapshotWorkNetworkValueQ8: (10n ** 330n).toString(),
    liveFloorQ8: networkFloorQ8.toString(),
    liveNetworkValueQ8: networkValueQ8.toString(),
    networkValueAccountingModel:
      "fixed-incb-issuance-plus-market-flow-v1",
    networkValueQ8: networkValueQ8.toString(),
  };
  const summary = {
    actualValue,
    floorQ8: networkFloorQ8.toString(),
    frozenFloorQ8: networkFloorQ8.toString(),
    frozenNetworkValueQ8: networkValueQ8.toString(),
    liveFloorQ8: networkFloorQ8.toString(),
    liveNetworkValueQ8: networkValueQ8.toString(),
    networkValueQ8: networkValueQ8.toString(),
    stats: { confirmedSupply: supply.toString(), pendingSupply: "0" },
  };
  return {
    actualValue,
    networkValueQ8,
    summary,
    tokenState: { confirmedSupply: supply.toString(), pendingSupply: "0" },
  };
}

const hugeExactAuditFixture = exactInceptionFixture(10n ** 321n + 12_345n);
const hugeExactAudit = exactInceptionLedgerState(
  hugeExactAuditFixture.summary,
  hugeExactAuditFixture.tokenState,
);
assert.equal(hugeExactAudit.currentV2, true);
assert.equal(hugeExactAudit.issuanceConserves, true);
assert.equal(hugeExactAudit.marketValueConserves, true);
assert.equal(hugeExactAudit.floorConserves, true);
assert.equal(
  Number.isFinite(Number(hugeExactAuditFixture.networkValueQ8)),
  false,
  "the exact audit fixture must exceed Number's finite range",
);

const oneQ8DriftSummary = {
  ...hugeExactAuditFixture.summary,
  actualValue: {
    ...hugeExactAuditFixture.actualValue,
    networkValueQ8: (hugeExactAuditFixture.networkValueQ8 + 1n).toString(),
  },
};
assert.equal(
  exactInceptionLedgerState(
    oneQ8DriftSummary,
    hugeExactAuditFixture.tokenState,
  ).marketValueConserves,
  false,
  "one Q8 of value drift must fail the full-node audit",
);
const oneQ8FloorDrift = (
  BigInt(hugeExactAuditFixture.summary.floorQ8) + 1n
).toString();
assert.equal(
  exactInceptionLedgerState(
    {
      ...hugeExactAuditFixture.summary,
      actualValue: {
        ...hugeExactAuditFixture.actualValue,
        floorQ8: oneQ8FloorDrift,
        frozenFloorQ8: oneQ8FloorDrift,
        liveFloorQ8: oneQ8FloorDrift,
      },
      floorQ8: oneQ8FloorDrift,
      frozenFloorQ8: oneQ8FloorDrift,
      liveFloorQ8: oneQ8FloorDrift,
    },
    hugeExactAuditFixture.tokenState,
  ).floorConserves,
  false,
  "one Q8 of coordinated floor drift must still fail exact division",
);
assert.equal(
  exactInceptionLedgerState(
    {
      ...hugeExactAuditFixture.summary,
      actualValue: {
        ...hugeExactAuditFixture.actualValue,
        issuanceNetworkValueQ8: (
          BigInt(hugeExactAuditFixture.actualValue.issuanceNetworkValueQ8) +
          1n
        ).toString(),
      },
    },
    hugeExactAuditFixture.tokenState,
  ).issuanceConserves,
  false,
  "one Q8 of issuance drift must fail exact conservation",
);
const multiMintCarryFixture = exactInceptionFixture(
  10n ** 321n + 12_345n,
  {
    // Two per-mint fractional remainders can legitimately sum above one
    // proof. Aggregate dust is the sum of those remainders, not total Q8
    // modulo one proof.
    attachedWorkActions: 2,
    issuanceDustQ8: BOND_VALUE_Q8_SCALE + 12_345_678n,
  },
);
assert.equal(
  exactInceptionLedgerState(
    multiMintCarryFixture.summary,
    multiMintCarryFixture.tokenState,
  ).issuanceConserves,
  true,
  "aggregate issuance dust may carry above one proof across multiple mints",
);
assert.equal(
  exactInceptionLedgerState(
    {
      ...multiMintCarryFixture.summary,
      actualValue: {
        ...multiMintCarryFixture.actualValue,
        issuanceDustQ8: (
          BigInt(multiMintCarryFixture.actualValue.issuanceDustQ8) + 1n
        ).toString(),
      },
    },
    multiMintCarryFixture.tokenState,
  ).issuanceConserves,
  false,
  "aggregate issuance dust must exactly reconcile issued Q8 and supply",
);

const malformedQ8Summary = {
  ...hugeExactAuditFixture.summary,
  actualValue: {
    ...hugeExactAuditFixture.actualValue,
    issuanceNetworkValueQ8: "1e400",
  },
};
assert.equal(
  exactInceptionLedgerState(
    malformedQ8Summary,
    hugeExactAuditFixture.tokenState,
  ).currentV2,
  false,
);
const missingQ8Actual = { ...hugeExactAuditFixture.actualValue };
delete missingQ8Actual.issuanceDustQ8;
assert.equal(
  exactInceptionLedgerState(
    {
      ...hugeExactAuditFixture.summary,
      actualValue: missingQ8Actual,
    },
    hugeExactAuditFixture.tokenState,
  ).exactFieldsPresent,
  false,
  "missing current-v2 Q8 fields must fail closed",
);

const nonBondPayload = {
  tokens: [{ tokenId: "generic-credit", ticker: "GEN" }],
};
assert.equal(
  exactBondTokenIdForMintOverlay("generic-credit", nonBondPayload, []),
  "",
);
assert.equal(
  exactBondTokenIdForMintOverlay(
    INCB_TOKEN_ID,
    { tokens: [{ tokenId: INCB_TOKEN_ID, ticker: "INCB" }] },
    [],
  ),
  "",
);
assert.equal(
  exactBondTokenIdForMintOverlay(
    INCB_TOKEN_ID,
    { tokens: [{ tokenId: INCB_TOKEN_ID, ticker: "INCB" }] },
    [{ amount: unsafeSupply, tokenId: INCB_TOKEN_ID }],
  ),
  INCB_TOKEN_ID,
);

const apiSource = readFileSync(
  new URL("../server/proof-api.mjs", import.meta.url),
  "utf8",
);
const readerSource = readFileSync(
  new URL("../server/db/proof-index-reader.mjs", import.meta.url),
  "utf8",
);
assert.match(
  apiSource,
  /const trackApproximateTopLevelSupply =[\s\S]*tokens\.length === 1[\s\S]*!isBondTokenId/,
);
assert.match(
  apiSource,
  /tokens\.length === 1\s*\? confirmedSupply\s*:\s*null/,
);
assert.match(
  apiSource,
  /if \(tokens\.length !== 1\) \{\s*return null;\s*\}/,
);
assert.match(
  apiSource,
  /function tokenSaleAuthorizationDraft[\s\S]*?const bond = isBondTokenId\(tokenId\)[\s\S]*?amount: bond[\s\S]*?canonicalIntegerText\(authorization\.amount, \{ allowZero: true \}\)/,
);
assert.match(
  apiSource,
  /const legacyAmountValid =[\s\S]*?isBondTokenId\(draft\.tokenId\)[\s\S]*?Boolean\(bondAmount\)/,
);
assert.match(
  apiSource,
  /parts\[0\] === TOKEN_SEND_ACTION[\s\S]*?const bond = isBondTokenId\(tokenId\)[\s\S]*?canonicalIntegerText\(parts\[2\], \{ allowZero: false \}\)[\s\S]*?const amount = bond \? exactAmount : Number\(parts\[2\]\)/,
);
assert.doesNotMatch(
  apiSource,
  /parts\[0\] === TOKEN_SEND_ACTION\) \{\s*const tokenId =[\s\S]{0,200}?const amount = Number\(parts\[2\]\)/,
);
assert.match(
  readerSource,
  /const genericScoped =[\s\S]*enrichedTokens\.length === 1[\s\S]*confirmedSupply:[\s\S]*genericScoped[\s\S]*:\s*null/,
);

console.log("Bond exact-arithmetic contract checks passed.");
