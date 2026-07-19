import { BOND_VALUE_Q8_SCALE } from "../server/bond-units.mjs";
import { WORK_UNIT_SCALE } from "../server/work-units.mjs";

const INCB_ISSUANCE_ACCOUNTING_MODEL =
  "canonical-pre-bond-live-network-value-v2";
const INCB_NETWORK_VALUE_ACCOUNTING_MODEL =
  "fixed-incb-issuance-plus-market-flow-v1";
const INCB_VALUE_SNAPSHOT_MODEL =
  "canonical-summary-h-minus-one-v1";

function exactUnsignedString(value, { positive = false } = {}) {
  // Current bond summaries deliberately publish economic integers as strings.
  // Reject Numbers even when they happen to be safe so this audit can never
  // silently regain a 2^53 or finite-float ceiling.
  if (typeof value !== "string") {
    return null;
  }
  const text = value.trim();
  if (!(positive ? /^[1-9][0-9]*$/u : /^(?:0|[1-9][0-9]*)$/u).test(text)) {
    return null;
  }
  return BigInt(text);
}

function allExact(values) {
  return values.every((value) => value !== null);
}

function exactUnsignedInteger(value) {
  if (typeof value === "bigint") {
    return value >= 0n ? value : null;
  }
  if (typeof value === "number") {
    return Number.isSafeInteger(value) && value >= 0 ? BigInt(value) : null;
  }
  return exactUnsignedString(value);
}

export function exactCreditFrozenValueState(actualValue) {
  const source = actualValue && typeof actualValue === "object"
    ? actualValue
    : {};
  const eventValueQ8 = exactUnsignedString(
    source.creditEventFrozenValueQ8,
  );
  const movementValueQ8 = exactUnsignedString(
    source.creditMovementFrozenValueQ8,
  );
  const flowValues = [
    source.creditProofPaymentFlowSats,
    source.creditRegistryMutationFlowSats,
    source.creditMarketplaceMutationFlowSats,
    source.creditSalePaymentFlowSats,
    source.creditMinerFeeFlowSats,
  ].map(exactUnsignedInteger);
  const q8FieldsAbsent =
    source.creditEventFrozenValueQ8 == null &&
    source.creditMovementFrozenValueQ8 == null;
  const exactFieldsPresent = allExact([
    eventValueQ8,
    movementValueQ8,
    ...flowValues,
  ]);
  const fixedFlowSats = allExact(flowValues)
    ? flowValues.reduce((total, value) => total + value, 0n)
    : null;
  const expectedEventValueQ8 =
    movementValueQ8 !== null && fixedFlowSats !== null
      ? movementValueQ8 + fixedFlowSats * BOND_VALUE_Q8_SCALE
      : null;

  return {
    componentsAgree:
      exactFieldsPresent && eventValueQ8 === expectedEventValueQ8,
    eventValueQ8,
    exactFieldsPresent,
    fixedFlowSats,
    movementValueQ8,
    q8FieldsAbsent,
  };
}

export function exactBondSupplyState(summary, tokenState) {
  const summaryConfirmed = exactUnsignedString(
    summary?.stats?.confirmedSupply,
  );
  const summaryPending = exactUnsignedString(summary?.stats?.pendingSupply);
  const tokenConfirmed = exactUnsignedString(tokenState?.confirmedSupply);
  const tokenPending = exactUnsignedString(tokenState?.pendingSupply);
  const exactFieldsPresent = allExact([
    summaryConfirmed,
    summaryPending,
    tokenConfirmed,
    tokenPending,
  ]);

  return {
    confirmedMatches:
      exactFieldsPresent && summaryConfirmed === tokenConfirmed,
    exactFieldsPresent,
    pendingMatches: exactFieldsPresent && summaryPending === tokenPending,
    summaryConfirmed,
    summaryPending,
    tokenConfirmed,
    tokenPending,
  };
}

export function exactInceptionLedgerState(summary, tokenState) {
  const supply = exactBondSupplyState(summary, tokenState);
  const actual = summary?.actualValue ?? {};
  const confirmedIssuance = exactUnsignedString(
    actual.confirmedIssuanceUnits,
    { positive: true },
  );
  const directIssuance = exactUnsignedString(
    actual.directProofIssuanceUnits,
    { positive: true },
  );
  const attachedIssuance = exactUnsignedString(
    actual.attachedWorkIssuanceUnits,
  );
  const attachedWorkAmountAtoms = exactUnsignedString(
    actual.attachedWorkAmountAtoms,
  );
  const attachedAtSendQ8 = exactUnsignedString(
    actual.attachedWorkLiveValueAtSendQ8,
  );
  const attachedFrozenQ8 = exactUnsignedString(
    actual.attachedWorkFrozenValueQ8,
  );
  const attachedLiveQ8 = exactUnsignedString(
    actual.attachedWorkLiveValueQ8,
  );
  const attachedFloorAtSendQ8 = exactUnsignedString(
    actual.attachedWorkLiveFloorAtSendQ8,
  );
  const snapshotWorkNetworkValueQ8 = exactUnsignedString(
    actual.issuanceValueSnapshotWorkNetworkValueQ8,
    { positive: true },
  );
  const issuanceValueQ8 = exactUnsignedString(
    actual.issuanceNetworkValueQ8,
    { positive: true },
  );
  const issuanceDustQ8 = exactUnsignedString(actual.issuanceDustQ8);
  const issuanceFloorQ8 = exactUnsignedString(actual.issuanceFloorQ8, {
    positive: true,
  });
  const mintFlow = exactUnsignedString(actual.bondMintFlowSats, {
    positive: true,
  });
  const saleFlow = exactUnsignedString(actual.bondSaleVolumeSats);
  const transferFlow = exactUnsignedString(actual.bondTransferFeeSats);
  const mutationFlow = exactUnsignedString(
    actual.bondMarketplaceMutationFeeSats,
  );
  const baseValueQ8 = exactUnsignedString(actual.baseNetworkValueQ8, {
    positive: true,
  });
  const frozenValueQ8 = exactUnsignedString(actual.frozenNetworkValueQ8, {
    positive: true,
  });
  const liveValueQ8 = exactUnsignedString(actual.liveNetworkValueQ8, {
    positive: true,
  });
  const networkValueQ8 = exactUnsignedString(actual.networkValueQ8, {
    positive: true,
  });
  const frozenFloorQ8 = exactUnsignedString(actual.frozenFloorQ8, {
    positive: true,
  });
  const liveFloorQ8 = exactUnsignedString(actual.liveFloorQ8, {
    positive: true,
  });
  const floorQ8 = exactUnsignedString(actual.floorQ8, { positive: true });
  const topFrozenValueQ8 = exactUnsignedString(summary?.frozenNetworkValueQ8, {
    positive: true,
  });
  const topLiveValueQ8 = exactUnsignedString(summary?.liveNetworkValueQ8, {
    positive: true,
  });
  const topNetworkValueQ8 = exactUnsignedString(summary?.networkValueQ8, {
    positive: true,
  });
  const topFrozenFloorQ8 = exactUnsignedString(summary?.frozenFloorQ8, {
    positive: true,
  });
  const topLiveFloorQ8 = exactUnsignedString(summary?.liveFloorQ8, {
    positive: true,
  });
  const topFloorQ8 = exactUnsignedString(summary?.floorQ8, {
    positive: true,
  });
  const attachedWorkActions = Number(actual.attachedWorkActions);
  const unmatchedActions = Number(actual.attachedWorkUnmatchedActions);
  const unvaluedActions = Number(actual.attachedWorkUnvaluedActions);
  const actionCountsPresent =
    Number.isSafeInteger(attachedWorkActions) &&
    attachedWorkActions >= 0 &&
    Number.isSafeInteger(unmatchedActions) &&
    unmatchedActions >= 0 &&
    Number.isSafeInteger(unvaluedActions) &&
    unvaluedActions >= 0;
  const exactFieldsPresent =
    supply.exactFieldsPresent &&
    actionCountsPresent &&
    allExact([
      confirmedIssuance,
      directIssuance,
      attachedIssuance,
      attachedWorkAmountAtoms,
      attachedAtSendQ8,
      attachedFrozenQ8,
      attachedLiveQ8,
      attachedFloorAtSendQ8,
      snapshotWorkNetworkValueQ8,
      issuanceValueQ8,
      issuanceDustQ8,
      issuanceFloorQ8,
      mintFlow,
      saleFlow,
      transferFlow,
      mutationFlow,
      baseValueQ8,
      frozenValueQ8,
      liveValueQ8,
      networkValueQ8,
      frozenFloorQ8,
      liveFloorQ8,
      floorQ8,
      topFrozenValueQ8,
      topLiveValueQ8,
      topNetworkValueQ8,
      topFrozenFloorQ8,
      topLiveFloorQ8,
      topFloorQ8,
    ]);
  const currentV2 =
    exactFieldsPresent &&
    actual.issuanceAccountingModel === INCB_ISSUANCE_ACCOUNTING_MODEL &&
    actual.attachmentAccountingModel === INCB_ISSUANCE_ACCOUNTING_MODEL &&
    actual.networkValueAccountingModel === INCB_NETWORK_VALUE_ACCOUNTING_MODEL &&
    actual.issuanceValueSnapshotModel === INCB_VALUE_SNAPSHOT_MODEL &&
    actual.issuanceValueSnapshotMode === "canonical-summary-refresh" &&
    actual.issuanceCheckpointMode === "bond-transaction-provenance" &&
    actual.issuanceValuationFixedAtSend === true &&
    Number(actual.issuanceUnitSats) === 1;

  if (!currentV2 || supply.summaryConfirmed <= 0n) {
    return {
      currentV2: false,
      exactFieldsPresent,
      floorConserves: false,
      issuanceConserves: false,
      marketValueConserves: false,
      supply,
    };
  }

  const marketFlowQ8 =
    (saleFlow + transferFlow + mutationFlow) * BOND_VALUE_Q8_SCALE;
  const expectedNetworkValueQ8 = issuanceValueQ8 + marketFlowQ8;
  const expectedBaseValueQ8 =
    (mintFlow + saleFlow + transferFlow + mutationFlow) *
    BOND_VALUE_Q8_SCALE;
  const confirmedSupply = supply.summaryConfirmed;
  const issuanceConserves =
    supply.confirmedMatches &&
    confirmedIssuance === confirmedSupply &&
    directIssuance === mintFlow &&
    directIssuance + attachedIssuance === confirmedIssuance &&
    issuanceValueQ8 ===
      directIssuance * BOND_VALUE_Q8_SCALE + attachedAtSendQ8 &&
    issuanceDustQ8 ===
      issuanceValueQ8 - confirmedIssuance * BOND_VALUE_Q8_SCALE &&
    (attachedWorkAmountAtoms > 0n
      ? attachedWorkActions > 0 &&
        attachedFloorAtSendQ8 ===
          (attachedAtSendQ8 * WORK_UNIT_SCALE) / attachedWorkAmountAtoms
      : attachedWorkActions === 0 &&
        attachedAtSendQ8 === 0n &&
        attachedIssuance === 0n) &&
    unmatchedActions === 0 &&
    unvaluedActions === 0 &&
    attachedFrozenQ8 === attachedAtSendQ8 &&
    attachedLiveQ8 === attachedAtSendQ8;
  const marketValueConserves =
    baseValueQ8 === expectedBaseValueQ8 &&
    frozenValueQ8 === expectedNetworkValueQ8 &&
    liveValueQ8 === expectedNetworkValueQ8 &&
    networkValueQ8 === expectedNetworkValueQ8 &&
    topFrozenValueQ8 === expectedNetworkValueQ8 &&
    topLiveValueQ8 === expectedNetworkValueQ8 &&
    topNetworkValueQ8 === expectedNetworkValueQ8;
  const expectedIssuanceFloorQ8 = issuanceValueQ8 / confirmedIssuance;
  const expectedNetworkFloorQ8 = expectedNetworkValueQ8 / confirmedSupply;
  const floorConserves =
    issuanceFloorQ8 === expectedIssuanceFloorQ8 &&
    frozenFloorQ8 === expectedNetworkFloorQ8 &&
    liveFloorQ8 === expectedNetworkFloorQ8 &&
    floorQ8 === expectedNetworkFloorQ8 &&
    topFrozenFloorQ8 === expectedNetworkFloorQ8 &&
    topLiveFloorQ8 === expectedNetworkFloorQ8 &&
    topFloorQ8 === expectedNetworkFloorQ8;

  return {
    currentV2,
    exactFieldsPresent,
    floorConserves,
    issuanceConserves,
    marketValueConserves,
    supply,
  };
}

export function exactBondLedgerState({
  incbTokenState,
  inceptionSummary,
  infinitySummary,
  powbTokenState,
}) {
  return {
    incb: exactInceptionLedgerState(inceptionSummary, incbTokenState),
    powb: exactBondSupplyState(infinitySummary, powbTokenState),
  };
}
