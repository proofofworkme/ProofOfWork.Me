import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import vm from "node:vm";
import ts from "typescript";
import {
  BOND_VALUE_Q8_SCALE,
  canonicalIntegerText,
  decimalTextFromQ8,
  integerBigInt,
} from "./bond-units.mjs";
import { q8ToCanonicalDecimal, q8ToNumber } from "./work-units.mjs";

// Execute the actual API functions without starting the server, a database,
// background workers, or network clients.
const source = readFileSync(new URL("./proof-api.mjs", import.meta.url), "utf8");
const parsed = ts.createSourceFile("proof-api.mjs", source, ts.ScriptTarget.Latest, true);
const functions = new Map(parsed.statements.filter(ts.isFunctionDeclaration)
  .map((node) => [node.name.text, node.getText(parsed)]));
const coreFunctions = [
  "canonicalClosingCreditAggregatePrefixes",
  "tokenStateWithVerifiedClosingCreditAggregates",
  "canonicalClosingCreditAggregateConsistency",
  "assertCanonicalCreditAggregateResponse",
  "payloadIndexedThroughBlockHash",
  "workAmoV5ExactValueAliases",
];
function runtime(names = [], globals = {}) {
  const context = vm.createContext({
    Buffer,
    BOND_VALUE_Q8_SCALE,
    VALUE_Q8_SCALE: BOND_VALUE_Q8_SCALE,
    canonicalIntegerText,
    decimalTextFromQ8,
    integerBigInt,
    q8ToCanonicalDecimal,
    q8ToNumber,
    tokenCanUseCreditNetworkFloor: () => false,
    freshDataUnavailableError: (message) => Object.assign(new Error(message), { statusCode: 503 }),
    ...globals,
  });
  vm.runInContext([...new Set([...coreFunctions, ...names])].map((name) => {
    assert.ok(functions.has(name), `missing API function ${name}`);
    return functions.get(name);
  }).join("\n"), context);
  return context;
}

const HEIGHT = 967846;
const HASH = "000000000000000000000db7b326be3daf3c65b20eef5e0bc09e8fd63ea907fe";
const aggregateQ8 = {
  creditEventFrozenValueQ8: "103731127226109176156137879",
  creditEventLiveValueQ8: "838762214502555077956660935",
  creditFrozenNetworkValueQ8: "103731127226109176156137879",
  creditLiveNetworkValueQ8: "838762214502555077956660935",
  creditMovementFrozenValueQ8: "103731127221891972156137879",
  creditMovementLiveValueQ8: "838762214498337873956660935",
  creditNetworkValueQ8: "838762214502555077956660935",
  creditFixedQ8: "4217204000000000",
  legacyBootstrapCreditFixedQ8: "276200000000",
  postActivationCreditFixedQ8: "3974200000000",
};
function closingFloor() {
  const actualValue = {
    totalSats: "8387622148430181388.26228612",
    creditMinerFeeFlowSats: 10175330,
    creditMarketplaceMutationFlowSats: 1253070,
    creditProofPaymentFlowSats: 21000546,
    creditRegistryMutationFlowSats: 122304,
    creditSalePaymentFlowSats: 9578286,
  };
  for (const [field, value] of Object.entries(aggregateQ8)) {
    const prefix = field.slice(0, -2);
    actualValue[field] = value;
    actualValue[`${prefix}Sats`] = decimalTextFromQ8(value);
    actualValue[`${prefix}SatsExact`] = decimalTextFromQ8(value);
    actualValue[`${prefix}SatsApproximate`] = Number(decimalTextFromQ8(value));
  }
  return {
    actualValue,
    indexedThroughBlock: HEIGHT,
    indexedThroughBlockHash: HASH,
    networkValueSats: actualValue.totalSats,
    snapshotId: "audit19-fixture",
    workAmoV5Transition: { blockHeight: HEIGHT, blockHash: HASH },
  };
}
function staleState() {
  return {
    indexedThroughBlock: HEIGHT,
    indexedThroughBlockHash: HASH,
    snapshotId: "audit19-fixture",
    amountStorageModel: "fixture-q16",
    tokens: [], mints: [], transfers: [], sales: [], listings: [], closedListings: [],
    stats: {
      pendingTransfers: 3,
      creditEventFrozenValueQ8: "35018484903593979776250105",
      creditMovementFrozenValueQ8: "35018484899381026176250105",
      creditEventFrozenValueSats: 350184849035939800,
      creditEventLiveValueSats: 2831568779898690600,
      creditLiveNetworkValueSats: 2831568779898690600,
      creditNetworkValueSats: 2831568779898690600,
    },
  };
}
const guardName = "token-credit-aggregates-match-verified-closing-state";
function checkedState(api, state = staleState()) {
  return api.tokenStateWithVerifiedClosingCreditAggregates(state, closingFloor());
}
function closingCheck() {
  return { name: guardName, ok: true, details: {
    aggregates: { ...aggregateQ8 }, blockHeight: HEIGHT, blockHash: HASH, mismatches: [],
  } };
}

test("Audit19 closing aggregates replace both projections without touching event history", () => {
  const api = runtime();
  const state = staleState();
  state.transfers.push({ txid: "historical", frozenNetworkValueSats: "17.00000001" });
  state.listings.push({ listingId: "retained-reservation", amountSubatoms: "23" });
  const original = structuredClone(state);
  assert.equal(api.canonicalClosingCreditAggregateConsistency(state, state, closingFloor()).ok, false);
  const global = checkedState(api, state);
  const work = checkedState(api, structuredClone(state));
  assert.equal(api.canonicalClosingCreditAggregateConsistency(global, work, closingFloor()).ok, true);
  assert.equal(global.stats.creditEventFrozenValueSats, "1037311272261091761.56137879");
  assert.equal(global.stats.creditEventLiveValueSats, "8387622145025550779.56660935");
  assert.equal(global.stats.creditMovementLiveValueQ8, aggregateQ8.creditMovementLiveValueQ8);
  assert.equal(global.stats.creditFixedSats, "42172040");
  assert.equal(global.stats.pendingTransfers, 3);
  assert.equal(global.transfers, state.transfers);
  assert.equal(global.listings, state.listings);
  assert.deepEqual(state, original, "enrichment must not mutate its input or historical records");
});

test("one Q8 unit and stale aliases cannot hide behind equal floating point values", () => {
  const api = runtime();
  const good = checkedState(api);
  for (const field of ["creditNetworkValueQ8", "creditEventFrozenValueQ8"]) {
    const wrong = structuredClone(good);
    wrong.stats[field] = (BigInt(wrong.stats[field]) + 1n).toString();
    assert.equal(Number(wrong.stats[field]), Number(good.stats[field]));
    assert.equal(api.canonicalClosingCreditAggregateConsistency(good, wrong, closingFloor()).ok, false);
  }
  for (const [field, value] of [
    ["creditNetworkValueSats", Number(good.stats.creditNetworkValueSats)],
    ["creditNetworkValueSatsExact", "8387622145025550779.56660936"],
    ["creditNetworkValueSatsApproximate", 0],
    ["creditMovementLiveValueQ8", undefined],
  ]) {
    const wrong = structuredClone(good);
    wrong.stats[field] = value;
    assert.equal(api.canonicalClosingCreditAggregateConsistency(good, wrong, closingFloor()).ok, false, field);
  }
});

test("missing or malformed closing Q8 fails closed, zero and pre-closing history remain valid", () => {
  const api = runtime();
  for (const value of [undefined, "", "1e8", "-1", "01", Number.MAX_SAFE_INTEGER + 1]) {
    const floor = closingFloor();
    floor.actualValue.creditEventLiveValueQ8 = value;
    assert.throws(() => api.tokenStateWithVerifiedClosingCreditAggregates(staleState(), floor),
      (error) => error.statusCode === 503);
  }
  const zero = closingFloor();
  for (const field of Object.keys(aggregateQ8)) zero.actualValue[field] = "0";
  assert.equal(api.tokenStateWithVerifiedClosingCreditAggregates(staleState(), zero).stats.creditEventLiveValueSats, "0");
  const state = staleState();
  assert.equal(api.tokenStateWithVerifiedClosingCreditAggregates(state, { actualValue: aggregateQ8 }), state);
});

test("preliminary enrichment preserves all seven exact credit aggregate Q8 fields", () => {
  const api = runtime(["tokenStateWithCreditNetworkValueDetails"], {
    numericValue: (value) => Number(value) || 0,
    tokenStateWithPendingStats: (state) => state,
  });
  const state = api.tokenStateWithCreditNetworkValueDetails(staleState(), aggregateQ8);
  for (const field of Object.keys(aggregateQ8).slice(0, 7)) {
    assert.equal(state.stats[field], aggregateQ8[field]);
  }
  assert.equal(state.stats.pendingTransfers, 3);
});

test("read guard rejects the captured old green contradiction without mutating it", () => {
  const api = runtime();
  const state = staleState();
  state.consistency = { ok: true, status: "green", checks: [{
    name: "credit-frozen-value-includes-event-components", ok: true,
    details: { creditEventFrozenValueQ8: aggregateQ8.creditEventFrozenValueQ8 },
  }] };
  const original = structuredClone(state);
  assert.throws(() => api.assertCanonicalCreditAggregateResponse(state, "livenet"),
    (error) => error.statusCode === 503 && error.details.code === "CANONICAL_CREDIT_AGGREGATE_MISMATCH");
  assert.deepEqual(state, original);
  const summary = { ...state, stats: {}, token: state, floor: closingFloor() };
  assert.throws(() => api.assertCanonicalCreditAggregateResponse(summary, "livenet"));
  state.stats.creditEventFrozenValueQ8 = aggregateQ8.creditEventFrozenValueQ8;
  assert.doesNotThrow(() => api.assertCanonicalCreditAggregateResponse(state, "livenet"),
    "older matching available evidence retains its compatibility path");
  assert.doesNotThrow(() => api.assertCanonicalCreditAggregateResponse(original, "testnet"));
});

test("new read evidence is exact and bound to both height and block hash", () => {
  const api = runtime();
  const state = checkedState(api);
  state.consistency = { ok: true, status: "green", checks: [closingCheck()] };
  assert.doesNotThrow(() => api.assertCanonicalCreditAggregateResponse(state, "livenet"));
  const nested = structuredClone(state);
  nested.consistency = { ok: true, checks: [] };
  nested.stats.creditEventLiveValueSatsExact = "0";
  assert.throws(() => api.assertCanonicalCreditAggregateResponse({
    ...state, stats: {}, token: nested,
  }, "livenet"), "an empty nested check list cannot bypass the parent checkpoint evidence");
  for (const mutate of [
    (value) => { value.indexedThroughBlock++; },
    (value) => { value.indexedThroughBlockHash = "f".repeat(64); },
    (value) => { value.consistency.checks[0].ok = false; },
    (value) => { value.consistency.checks[0].details.blockHash = "f".repeat(64); },
    (value) => { value.stats.creditEventLiveValueQ8 = (BigInt(value.stats.creditEventLiveValueQ8) + 1n).toString(); },
    (value) => { delete value.stats.creditEventLiveValueSatsExact; },
  ]) {
    const wrong = structuredClone(state);
    mutate(wrong);
    assert.throws(() => api.assertCanonicalCreditAggregateResponse(wrong, "livenet"));
  }
  const old = staleState();
  old.stats.creditEventFrozenValueQ8 = aggregateQ8.creditEventFrozenValueQ8;
  const movedFloor = closingFloor();
  movedFloor.workAmoV5Transition.blockHeight--;
  assert.throws(() => api.assertCanonicalCreditAggregateResponse({ ...old, token: old, floor: movedFloor }, "livenet"));
});

test("actual token, wallet-summary and canonical-summary response entrypoints reject stale green values", async () => {
  const state = staleState();
  state.consistency = { ok: true, status: "green", checks: [{
    name: "credit-frozen-value-includes-event-components", ok: true,
    details: { creditEventFrozenValueQ8: aggregateQ8.creditEventFrozenValueQ8 },
  }] };
  const api = runtime([
    "tokenReadResponsePayload", "walletScopedTokenSummaryPayload", "summaryPayloadWithCanonicalProvenance",
  ], {
    WORK_TOKEN_ID: "WORK",
    normalizeTokenScope: (value) => value,
    compactTokenSummaryPayload: (value) => value,
    walletScopedTokenPayload: async () => state,
  });
  for (const read of [
    () => api.tokenReadResponsePayload(state, "livenet", ""),
    () => api.walletScopedTokenSummaryPayload("livenet", "", ["fixture-address"]),
    () => api.summaryPayloadWithCanonicalProvenance(state, "livenet", false, "token-summary:all"),
  ]) {
    await assert.rejects(read, (error) => error.statusCode === 503 &&
      error.details.code === "CANONICAL_CREDIT_AGGREGATE_MISMATCH");
  }
});

test("closing floor and every stored green proof must agree on all aggregate Q8 fields", () => {
  const api = runtime();
  const state = checkedState(api);
  state.consistency = { ok: true, status: "green", checks: [closingCheck()] };
  const summary = { ...state, stats: {}, token: state, floor: closingFloor() };
  assert.doesNotThrow(() => api.assertCanonicalCreditAggregateResponse(summary, "livenet"));
  for (const field of Object.keys(aggregateQ8)) {
    for (const corrupt of [
      (proof) => { proof[field] = (BigInt(proof[field]) + 1n).toString(); },
      (proof) => { delete proof[field]; },
    ]) {
      const wrong = structuredClone(summary);
      corrupt(wrong.consistency.checks[0].details.aggregates);
      assert.throws(() => api.assertCanonicalCreditAggregateResponse(wrong, "livenet"),
        (error) => error.statusCode === 503 && error.details.mismatches.some(
          (mismatch) => mismatch.plane === "closingCheck" && mismatch.field === field,
        ), `${field} proof must match the floor even when token statistics are correct`);
    }
  }
  const wrongParent = structuredClone(summary);
  wrongParent.consistency = structuredClone(state.consistency);
  wrongParent.consistency.checks[0].details.aggregates.creditNetworkValueQ8 =
    (BigInt(aggregateQ8.creditNetworkValueQ8) + 1n).toString();
  assert.equal(Number(wrongParent.consistency.checks[0].details.aggregates.creditNetworkValueQ8),
    Number(aggregateQ8.creditNetworkValueQ8));
  assert.throws(() => api.assertCanonicalCreditAggregateResponse(wrongParent, "livenet"),
    "an agreeing nested proof cannot mask a contradictory parent proof");
});

function ledgerGlobals() {
  return {
    numericValue: (value) => Number(value) || 0,
    numbersAgree: (left, right) => left === right,
    WORK_TOKEN_ID: "WORK", POWB_TOKEN_ID: "POWB", INCB_TOKEN_ID: "INCB",
    WORK_AMO_V5_ACTIVATION_HEIGHT: 959621,
    WORK_AMO_V5_LEGACY_BOOTSTRAP_CARRY_MODEL: "fixture",
    LIVENET_INCB_HISTORICAL_BASELINE: { parentBondEvents: 40 },
    INCEPTION_NETWORK_VALUE_ACCOUNTING_MODEL: "fixture",
    CREDIT_MINER_FEE_ACCOUNTING_MODEL: "fixture",
    PROOF_INDEX_CONFIRMED_READ_MAX_LAG_BLOCKS: 6,
    GROWTH_MODEL_INPUTS: { valueMultiple: 5 },
    MARKETPLACE_MUTATION_KINDS: new Set(),
    TOKEN_MARKETPLACE_MUTATION_KINDS: new Set(),
    canonicalNonNegativeIntegerText: canonicalIntegerText,
    scopedTokenPayloadFromState: (state, token) => token === "WORK" ? state : {
      ...state, confirmedSupply: token === "POWB" ? "1" : "0", mints: [], sales: [], transfers: [],
    },
    inceptionIssuanceMetadataFromMints: () => ({ complete: true, confirmedIssuanceUnits: "0", confirmedMints: 0 }),
    tokenComponentCoverageFromConfirmedActivity: () => ({ ok: true }),
    canonicalActivityCountCoverage: () => ({ ok: true }),
    isInceptionBondActivityItem: () => false,
    isInfinityBondActivityItem: (item) => item.kind === "infinity-bond",
    activityAmountSats: (item) => item.amountSats ?? 0,
    confirmedActivityFlowSats: () => 0,
    marketplaceMutationFeesCountedOk: () => true,
    workAmoV5LegacyBootstrapEvidenceMatches: () => true,
    unbucketedConfirmedComputerLogFlowSats: () => 0,
    workFloorPayloadHasFiniteNetworkValue: () => true,
    growthSummaryPayloadHasFiniteNetworkValue: () => true,
    verifiedCanonicalMinerFeeCoverage: () => true,
    activityCoverageByTxidKind: () => new Map(),
    tokenStateLogExpectations: () => [],
  };
}
function ledgerInput(tokenState, workTokenState, floor = closingFloor()) {
  return {
    activity: [{ kind: "infinity-bond", confirmed: true, amountSats: 1 }],
    growthSummary: { actualValue: floor.actualValue, workFloor: floor },
    metrics: { activityItems: 1, indexedThroughBlock: HEIGHT },
    network: "livenet", sourceHashes: {}, seededMailActivityState: { activity: [] },
    tokenState, workTokenState, workFloor: floor,
  };
}

test("actual ledger checks turn the same-response green mismatch red and distinguish one Q8 unit", () => {
  const api = runtime(["ledgerSnapshotChecks", "exactCreditFrozenValueComponentsAgree"], ledgerGlobals());
  const good = checkedState(api);
  const old = api.ledgerSnapshotChecks(ledgerInput(staleState(), staleState()));
  assert.equal(old.checks.find((check) => check.name === "credit-frozen-value-includes-event-components").ok, true);
  assert.equal(old.checks.find((check) => check.name === guardName).ok, false);
  assert.equal(old.status, "red");
  const valid = api.ledgerSnapshotChecks(ledgerInput(good, good));
  assert.equal(valid.status, "green", JSON.stringify(valid.checks.filter((check) => !check.ok)));
  assert.equal(valid.checks.find((check) => check.name === guardName).details.blockHash, HASH);
  const wrongFloor = closingFloor();
  wrongFloor.actualValue.creditNetworkValueQ8 = (BigInt(aggregateQ8.creditNetworkValueQ8) + 1n).toString();
  const wrong = api.ledgerSnapshotChecks(ledgerInput(good, good, wrongFloor));
  assert.equal(wrong.checks.find((check) => check.name === "credit-live-value-is-active-network-value").ok, false);
  assert.equal(wrong.status, "red");
  const wrongAlias = closingFloor();
  wrongAlias.actualValue.creditEventFrozenValueSats = "1037311272261091761.5613788";
  const aliasResult = api.ledgerSnapshotChecks(ledgerInput(good, good, wrongAlias));
  assert.equal(aliasResult.checks.find((check) => check.name === guardName).ok, false);
});

test("actual indexed builder reconciles both token states before metrics, hashes and consistency", async () => {
  const state = staleState();
  const phases = [];
  const global = ledgerGlobals();
  const api = runtime([
    "buildIndexedCanonicalLedgerPayload", "tokenStateWithCreditNetworkValueDetails",
    "ledgerSnapshotChecks", "exactCreditFrozenValueComponentsAgree",
  ], {
    ...global,
    console: { error() {} },
    WORK_ATOMIC_PROJECTION_MODEL: "fixture-q8", WORK_SUBATOM_PROJECTION_MODEL: "fixture-q16",
    SUMMARY_PROOF_INDEX_READ_WAIT_MS: 1, CANONICAL_CONFIRMED_TIP_CUTOFF_MS: 1,
    workAmoV8ReplayPrecisionOptions: async () => ({ workAmountStorageModel: "fixture-q16" }),
    indexedActivityStateForCanonicalLedger: async () => ({ activity: ledgerInput().activity }),
    indexedRegistryStateForCanonicalLedger: async () => ({ records: [], sales: [], activity: [] }),
    btcUsdPricePayload: async () => null,
    payloadWithFallbackAfterMs: (value) => value,
    exactTokenTablePayloadForCanonicalLedger: async () => state,
    indexedTokenMarketSummaryOverlay: async () => null,
    exactWorkAmountStorageModelFromState: (value) => value.amountStorageModel,
    tokenValueStateFromIndexedActivity: async () => state,
    mergeTokenPayloadWithCanonicalFloor: (value) => value,
    tokenStateWithAuthoritativeCurrentListings: (value) => value,
    tokenStateWithScopedTokenOverride: (value) => value,
    canonicalMailSeedAddresses: () => [],
    seededMailActivityPayloadFromIndexedActivity: () => ({ activity: [], stats: {} }),
    dedupeActivityItems: (items) => items,
    tokenActivityItemsFromStateForCanonicalLedger: () => [],
    mergedSourceLabel: () => "fixture",
    activityStatsFromItems: () => ({}),
    growthActualBaseNetworkValueAtProvider: () => () => 0,
    creditNetworkValueMetrics: () => ({ ...state.stats }),
    tokenStateWithPendingStats: (value) => value,
    workFloorPayloadFromState: () => ({ actualValue: {} }),
    workFloorWithVerifiedWorkAmoV5ClosingState: async () => {
      phases.push("closing");
      return closingFloor();
    },
    ledgerMetricsFromState: ({ tokenState }) => {
      assert.equal(tokenState.stats.creditEventLiveValueQ8, aggregateQ8.creditEventLiveValueQ8);
      phases.push("metrics");
      return { activityItems: 1, indexedThroughBlock: HEIGHT };
    },
    ledgerSourceHashes: ({ tokenState, workTokenState }) => {
      assert.equal(tokenState.stats.creditEventFrozenValueQ8, aggregateQ8.creditEventFrozenValueQ8);
      assert.equal(workTokenState.stats.creditEventFrozenValueQ8, aggregateQ8.creditEventFrozenValueQ8);
      phases.push("hashes");
      return {};
    },
    sha256Hex: () => "a".repeat(64),
    growthSummaryPayloadFromLedger: (ledger) => ({ actualValue: ledger.workFloor.actualValue, workFloor: ledger.workFloor }),
    inceptionSummaryPayloadFromLedger: () => ({}), infinitySummaryPayloadFromLedger: () => ({}),
    attachLedgerMetadata: (payload, ledger) => ({ ...payload, consistency: ledger.consistency }),
  });
  const ledger = await api.buildIndexedCanonicalLedgerPayload("livenet", "local fixture", { exactHeight: HEIGHT, exactHash: HASH });
  assert.deepEqual(phases, ["closing", "metrics", "hashes"]);
  assert.equal(ledger.consistency.status, "green");
  assert.equal(ledger.tokenState.stats.creditEventFrozenValueSats, "1037311272261091761.56137879");
  assert.equal(ledger.workTokenState.stats.creditEventLiveValueSats, "8387622145025550779.56660935");
  assert.equal(state.stats.creditEventFrozenValueQ8, "35018484903593979776250105");
});
