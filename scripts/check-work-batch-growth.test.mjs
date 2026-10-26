import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";
import * as bitcoin from "bitcoinjs-lib";
import * as units from "../server/work-units.mjs";
import * as bonds from "../server/bond-units.mjs";
import { WORK_AMO_V5_ACTIVATION_HEIGHT, compareWorkAmoUtf8, workAmoV5CanonicalPayloadCommitment } from "../server/work-amo-v5.mjs";
import { buildWorkBatchPayload } from "../src/shared/protocol/workBatch.mjs";

// Execute the actual API projection and accounting functions without starting
// its server, database clients, background workers, or wallet operations.
const source = readFileSync(new URL("../server/proof-api.mjs", import.meta.url), "utf8");
const parsed = ts.createSourceFile("proof-api.mjs", source, ts.ScriptTarget.Latest, true);
const functions = new Map(parsed.statements.filter(ts.isFunctionDeclaration)
  .map((node) => [node.name.text, node.getText(parsed)]));
const constants = new Map(parsed.statements.filter(ts.isVariableStatement)
  .flatMap((node) => node.declarationList.declarations)
  .map((node) => [node.name.getText(parsed), node.getText(parsed)]));
const names = [
  "isWorkBatchTransferParent", "isWorkBatchTransferChild", "workBatchChildIdentityFields",
  "workBatchEconomicTransfer", "economicTokenTransfersFromState", "zeroWorkBatchChildEconomicFields",
  "canonicalNonNegativeIntegerText", "canonicalWorkSubatomsText", "canonicalWorkAtomsText",
  "workRecordUsesSubatoms", "workSubatomsBigIntFromRecord", "workAtomsBigIntFromRecord",
  "workAmountFieldsFromSubatoms", "workAmountFieldsFromAtoms", "tokenLedgerAmountFromRecord",
  "tokenLedgerAmountFields", "tokenAmountFieldsFromRecord", "tokenCreditAmountMovedFields",
  "numericValue", "proofFlowBigInt", "activityAmountSatsBigInt", "activityKindHasDedicatedGrowthBucket",
  "growthActualBaseNetworkValueEvents", "growthDeltaForProofIndexEvents",
  "canonicalEventIdentityDetails", "canonicalCreditValueFieldsFromRecord", "shortAddress",
  "networkLabel", "activityStatusTag", "isBondTokenId", "tokenActivityItemsFromState",
  "canonicalTokenReplayPosition", "creditMovementIdentity", "creditReplayRecordIdentity",
  "creditValueEventMs", "creditValueEventPosition", "compareCreditValueReplayEvents",
  "assertUniqueCreditValueReplayPositions", "presentNonNegativeNumber",
  "creditReplayTransactionMinerFeeSats", "verifiedCanonicalMinerFeeCoverage",
  "tokenCanUseCreditNetworkFloor", "isTokenActivityItem", "creditNetworkValueMetrics",
  "creditNetworkValueEventDetailFor", "tokenAmountValueAtFloor", "tokenStateWithCreditNetworkValueDetails",
  "growthActualLiveTotalSatsAtProvider", "canonicalReplayTimeline", "canonicalReplayPrefixLengthAtMs",
  "workAmoV5HistoricalMovements",
];
const constantNames = [
  "TOKEN_MIN_MUTATION_PRICE_SATS", "WORK_TOKEN_MAX_SUPPLY", "WORK_TOKEN_MAX_SUPPLY_ATOMS",
  "WORK_TOKEN_MAX_SUPPLY_SUBATOMS", "CREDIT_MINER_FEE_ACCOUNTING_MODEL", "GROWTH_MODEL_INPUTS",
  "ID_MARKETPLACE_MUTATION_KINDS", "TOKEN_MARKETPLACE_MUTATION_KINDS",
  "DNS_REGISTRY_ACTIVITY_KINDS", "DNS_MARKETPLACE_MUTATION_KINDS", "MARKETPLACE_MUTATION_KINDS",
  "BOOST_EVENT_KINDS", "TOKEN_ACTIVITY_KINDS",
];
const api = vm.createContext({
  ...units, ...bonds, Buffer, WORK_AMO_V5_ACTIVATION_HEIGHT, compareWorkAmoUtf8,
  VALUE_Q8_SCALE: 100_000_000n,
  TOKEN_SEND_SUBATOMS_ACTION: "send3", TOKEN_SALE_AUTH_WORK_AMO_V8_VERSION: "buy5",
  INFINITY_BOND_KIND: "infinity-bond", INCEPTION_BOND_KIND: "inception-bond",
  BOND_TOKEN_IDS: new Set(),
  compareCanonicalUtf8: (a, b) => Buffer.compare(Buffer.from(a), Buffer.from(b)),
  // These unrelated product boundaries have no rows in this WORK-only fixture.
  isBrowserActivityItem: () => false, isBondActivityItem: () => false,
  isInceptionBondActivityItem: () => false, isInfinityBondActivityItem: () => false,
  uniqueMarketplaceMutationActivity: () => [], publicMarketplaceSales: (rows) => rows,
  canonicalInceptionWorkMovementOracleByIdentity: () => new Map(),
  // Pending aggregate bookkeeping is separately tested; preserve the actual
  // enrichment output here so it cannot obscure recipient-level regressions.
  tokenStateWithPendingStats: (state) => state,
  // Isolate the live credit replay from base-history acquisition. The actual
  // base-event classifier is exercised above; both exact Q8 boundaries here
  // deliberately expose the same known floor used by the metrics fixture.
  growthActualBaseNetworkValueAtProvider: () => Object.assign(
    () => units.q8ToNumber(BASE_Q8), { q8At: () => BASE_Q8 }),
  growthActualBaseNetworkValueBeforeCanonicalItemProvider: () => Object.assign(
    () => units.q8ToNumber(BASE_Q8), { q8At: () => BASE_Q8 }),
});
vm.runInContext([
  ...constantNames.map((name) => {
    assert.ok(constants.has(name), `Missing actual API constant ${name}`);
    return `const ${constants.get(name)};`;
  }),
  ...names.map((name) => {
    assert.ok(functions.has(name), `Missing actual API function ${name}`);
    return functions.get(name);
  }),
].join("\n"), api);

const plain = (value) => JSON.parse(JSON.stringify(value));
const address = (byte) => bitcoin.payments.p2wpkh({ hash: Buffer.alloc(20, byte) }).address;
const SENDER = address(1);
const TOKEN = { tokenId: units.WORK_TOKEN_ID, ticker: "WORK", maxSupply: 21_000_000, valid: true };
const CREATED = "2026-10-26T20:00:00.000Z";
const BASE_Q8 = 21_000_000n * units.WORK_SUBATOM_UNIT_SCALE / 100_000_000n;
function family({ allSelf = false, confirmed = true } = {}) {
  const recipients = allSelf
    ? [{ recipientAddress: SENDER, amountSubatoms: "1" }, { recipientAddress: SENDER, amountSubatoms: "2" }]
    : [{ recipientAddress: SENDER, amountSubatoms: "10000000000000000" },
      { recipientAddress: address(2), amountSubatoms: "50000001" },
      { recipientAddress: address(3), amountSubatoms: "50000001" }];
  // Only the defensive zero-movement test uses a deliberately non-wire fixture.
  const payload = allSelf ? "synthetic-zero-movement-boundary" : buildWorkBatchPayload(recipients);
  const total = recipients.reduce((sum, row) => sum + BigInt(row.amountSubatoms), 0n);
  const movement = recipients.filter((row) => row.recipientAddress !== SENDER)
    .reduce((sum, row) => sum + BigInt(row.amountSubatoms), 0n);
  const parent = {
    ...plain(api.workAmountFieldsFromSubatoms(total.toString())),
    kind: "token-transfer-batch", transferVersion: "batch1", amountVersion: "batch1",
    tokenId: units.WORK_TOKEN_ID, ticker: "WORK", network: "livenet",
    txid: "ab".repeat(32), blockHash: "cd".repeat(32), blockHeight: 1_200_000,
    blockIndex: 7, protocolVout: 1, recordOrdinal: 0, createdAt: CREATED,
    valid: true, confirmed, senderAddress: SENDER, registryAddress: address(4),
    recipients, recipientCount: recipients.length, totalAmountSubatoms: total.toString(),
    movementAmountSubatoms: movement.toString(), paidSats: 546, registryMutationFeeSats: 546,
    batchRegistryPaymentSats: 546, minerFeeSats: 47, canonicalMinerFeeSats: 47,
    canonicalMinerFeeCovered: true,
    batchPayloadCommitment: workAmoV5CanonicalPayloadCommitment({ payload }),
  };
  const children = recipients.map((row, index) => ({
    ...parent, ...plain(api.workAmountFieldsFromSubatoms(row.amountSubatoms)), ...row,
    kind: "token-transfer", recordOrdinal: index + 1, batchRecipientIndex: index,
    batchRecipientCount: recipients.length, batchTotalAmountSubatoms: total.toString(),
    containerPosition: { protocolVout: parent.protocolVout, recordOrdinal: parent.recordOrdinal },
    derived: true, derivedId: `${parent.txid}:${index}`, rawCandidate: false,
    economicDelta: false, chargesTransactionFee: false, claimsEconomicOutputs: false,
    paidSats: 0, registryMutationFeeSats: 0, minerFeeSats: 0, canonicalMinerFeeSats: 0,
  }));
  return { tokens: [TOKEN], transfers: children, transferBatches: [parent],
    mints: [], sales: [], listings: [], closedListings: [], stats: {} };
}
function metrics(state) {
  return api.creditNetworkValueMetrics({
    tokenDefinitions: state.tokens, tokenTransfers: api.economicTokenTransfersFromState(state),
    confirmedActivity: api.tokenActivityItemsFromState(state, address(4)),
    baseValueAt: () => Number(BASE_Q8) / 1e8, baseValueQ8At: () => BASE_Q8,
    baseValueBeforeEventQ8: () => BASE_Q8, cutoffMs: Date.parse(CREATED) + 1000,
    includeEvents: true,
  });
}

test("batch parent contributes one registry payment to WORK, never Computer", () => {
  const state = family();
  const activity = api.tokenActivityItemsFromState(state, address(4));
  const economic = api.economicTokenTransfersFromState(state);
  const events = api.growthActualBaseNetworkValueEvents([], activity, [], [], [], economic, []);
  assert.deepEqual(Array.from(events, (event) => ({
    field: event.contribution.field, value: event.contribution.value.toString(),
    protocolVout: event.protocolVout, recordOrdinal: event.recordOrdinal,
  })), [{ field: "tokenTransferFlowSats", value: "546", protocolVout: 1, recordOrdinal: 0 }]);
  const delta = api.growthDeltaForProofIndexEvents(activity.map((item) => ({ ...item, totalSats: item.amountSats })));
  assert.equal(delta.tokenTransferFlowSats, 546);
  assert.equal(delta.walletFlowSats, 546);
  assert.equal(delta.computerEventFlowSats, 0);
  assert.equal(delta.totalSats, 546 * 5);
});

test("economic view excludes self and children without changing recipient history", () => {
  const state = family(); const before = plain(state);
  const rows = api.economicTokenTransfersFromState(state);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].amountSubatoms, "100000002");
  assert.equal(rows[0].totalAmountSubatoms, "10000000100000002");
  for (const key of ["txid", "blockHash", "blockHeight", "blockIndex", "protocolVout", "recordOrdinal"]) {
    assert.equal(rows[0][key], state.transferBatches[0][key]);
  }
  assert.deepEqual(state, before);
});

test("fractional batch movement rounds once and attributes one miner fee", () => {
  const value = metrics(family());
  assert.equal(value.events.length, 1);
  assert.equal(value.events[0].amountSubatoms, "100000002");
  assert.equal(value.events[0].sourceKind, "token-transfer-batch");
  assert.equal(value.creditMovementFrozenValueQ8, "1");
  assert.equal(50000001n * BASE_Q8 / (21_000_000n * units.WORK_SUBATOM_UNIT_SCALE), 0n);
  assert.equal(value.creditRegistryMutationFlowSats, 546);
  assert.equal(value.creditMinerFeeFlowSats, 47);
  assert.equal(value.creditEventFrozenValueQ8, (593n * 100_000_000n + 1n).toString());
});

test("defensive zero-movement parent retains its fee; duplicate-self wire stays invalid", () => {
  const state = family({ allSelf: true });
  assert.throws(() => buildWorkBatchPayload(state.transferBatches[0].recipients));
  const value = metrics(state);
  assert.equal(value.events.length, 1);
  assert.equal(value.events[0].amountSubatoms, "0");
  assert.equal(value.creditMovementFrozenValueQ8, "0");
  assert.equal(value.creditRegistryMutationFlowSats, 546);
  assert.equal(value.creditMinerFeeFlowSats, 47);
  assert.equal(value.creditEventFrozenValueQ8, (593n * 100_000_000n).toString());
});

for (const allSelf of [false, true]) {
  test(`actual live provider preserves one parent fee and ${allSelf ? "defensive zero" : "aggregate fractional"} movement`, () => {
    const state = family({ allSelf });
    const transfers = api.economicTokenTransfersFromState(state);
    const liveAt = api.growthActualLiveTotalSatsAtProvider(
      [], api.tokenActivityItemsFromState(state, address(4)), [], state.tokens, [], transfers, [],
    );
    const movement = BigInt(transfers[0].amountSubatoms);
    const denominator = 21_000_000n * units.WORK_SUBATOM_UNIT_SCALE;
    const fixedQ8 = 593n * 100_000_000n;
    const frozenQ8 = fixedQ8 + movement * BASE_Q8 / denominator;
    const expectedQ8 = BASE_Q8 + fixedQ8 + (BASE_Q8 + frozenQ8) * movement / denominator;
    const at = Date.parse(CREATED);
    assert.equal(liveAt(at - 1), units.q8ToNumber(BASE_Q8));
    assert.equal(liveAt(at), units.q8ToNumber(expectedQ8));
    // Seeking backwards must not retain or double-count the parent's fee.
    assert.equal(liveAt(at - 1), units.q8ToNumber(BASE_Q8));
    assert.equal(liveAt(at + 1), units.q8ToNumber(expectedQ8));
  });
}

test("canonical movement identity survives economic projection and separates historical legacy identity", () => {
  const state = family();
  const parent = state.transferBatches[0];
  const projected = api.economicTokenTransfersFromState(state)[0];
  const activity = api.tokenActivityItemsFromState(state, address(4));
  const parentActivity = activity.find((row) => row.kind === "token-transfer-batch");
  const expected = `livenet:${parent.txid}:v5:1200000:7:1:0`;
  for (const row of [parent, projected, parentActivity]) {
    assert.equal(api.creditMovementIdentity(row, "transfer"), expected);
    assert.equal(api.creditReplayRecordIdentity(row), expected);
  }
  assert.equal(new Set(activity.map((row) => api.creditMovementIdentity(row, "transfer"))).size, 4);
  const historical = { ...parent, transferVersion: "send3", kind: "token-transfer",
    blockHeight: WORK_AMO_V5_ACTIVATION_HEIGHT - 1, protocolVout: undefined,
    recordOrdinal: undefined, amount: 7, recipientAddress: address(2), _powEventIndex: 4 };
  assert.equal(api.creditReplayRecordIdentity(historical), `tx:${parent.txid}`);
  assert.equal(api.creditMovementIdentity(historical, "transfer"),
    ["transfer", units.WORK_TOKEN_ID.toLowerCase(), parent.txid, "7", SENDER.toLowerCase(), address(2).toLowerCase(), "", "4"].join(":"));
});

test("historical opening movements contain the aggregate parent once and retain legacy transfers", () => {
  const state = family();
  const legacy = { ...state.transfers[1], transferVersion: "send3", amountVersion: "send3",
    txid: "ef".repeat(32), blockIndex: 6, protocolVout: 2, recordOrdinal: 0 };
  state.transfers.push(legacy);
  const movements = plain(api.workAmoV5HistoricalMovements(state, 1_200_000));
  assert.deepEqual(movements.map((row) => ({ identity: row.identity, amountSubatoms: row.amountSubatoms })), [
    { identity: `transfer:${legacy.txid}:2:0`, amountSubatoms: "50000001" },
    { identity: `batch-transfer:${state.transferBatches[0].txid}:1:0`, amountSubatoms: "100000002" },
  ]);
  assert.equal(movements[1].blockHeight, 1_200_000);
  assert.equal(movements[1].blockIndex, 7);
  assert.equal(movements[1].protocolVout, 1);
  assert.equal(movements[1].recordOrdinal, 0);
  assert.deepEqual(plain(api.workAmoV5HistoricalMovements(state, 1_199_999)), []);
});

test("activity projects the complete parent/child family and original positions", () => {
  const state = family();
  const rows = api.tokenActivityItemsFromState(state, address(4));
  const parent = rows.find((row) => row.kind === "token-transfer-batch");
  const children = rows.filter((row) => row.kind === "token-transfer");
  assert.equal(rows.length, 4); assert.equal(parent.recordOrdinal, 0);
  assert.equal(parent.amountSats, 546); assert.equal(parent.creditAmountMovedSubatoms, "100000002");
  assert.equal(parent.batchPayloadCommitment.sha256, state.transferBatches[0].batchPayloadCommitment.sha256);
  for (const [index, child] of children.entries()) {
    assert.equal(child.protocolVout, 1); assert.equal(child.recordOrdinal, index + 1);
    assert.equal(child.batchRecipientIndex, index); assert.equal(child.batchRecipientCount, 3);
    assert.deepEqual(plain(child.containerPosition), { protocolVout: 1, recordOrdinal: 0 });
    assert.equal(child.amountSubatoms, state.transfers[index].amountSubatoms);
    assert.equal(child.amountSats, 0); assert.equal(child.registryMutationFeeSats, 0);
    assert.equal(child.creditAmountMovedSubatoms, "0");
  }
});

test("credit enrichment cannot charge children or value their amounts again", () => {
  const state = family(); const value = metrics(state);
  const enriched = api.tokenStateWithCreditNetworkValueDetails(state, value);
  assert.equal(enriched.transferBatches.length, 1);
  assert.equal(enriched.transferBatches[0].creditValueAtConfirmQ8, "1");
  assert.equal(enriched.transferBatches[0].registryMutationFeeSats, 546);
  assert.equal(enriched.transferBatches[0].minerFeeSats, 47);
  for (const child of enriched.transfers) {
    for (const key of ["paidSats", "registryMutationFeeSats", "minerFeeSats", "creditLiveValueSats", "frozenNetworkValueSats", "liveNetworkValueSats"]) assert.equal(child[key], 0, key);
    for (const key of ["creditAmountMovedSubatoms", "creditLiveValueQ8", "frozenNetworkValueQ8", "liveNetworkValueQ8"]) assert.equal(child[key], "0", key);
    assert.equal(child.amountSubatoms, state.transfers[child.batchRecipientIndex].amountSubatoms);
  }
});

test("legacy send3 transfer keeps its own economic event and fee", () => {
  const legacy = { ...family().transfers[1], transferVersion: "send3", amountVersion: "send3",
    recordOrdinal: 0, paidSats: 546, registryMutationFeeSats: 546, minerFeeSats: 29, canonicalMinerFeeSats: 29 };
  const state = { ...family(), transfers: [legacy], transferBatches: [] };
  const rows = api.economicTokenTransfersFromState(state);
  assert.equal(rows.length, 1); assert.equal(rows[0], legacy);
  const value = metrics(state);
  assert.equal(value.events.length, 1); assert.equal(value.events[0].sourceKind, "token-transfer");
  assert.equal(value.creditRegistryMutationFlowSats, 546); assert.equal(value.creditMinerFeeFlowSats, 29);
});

for (const [name, mutate] of [
  ["missing sibling", (state) => state.transfers.pop()],
  ["duplicate sibling", (state) => state.transfers.push({ ...state.transfers[0] })],
  ["orphan children", (state) => { state.transferBatches = []; }],
  ["parent total", (state) => { state.transferBatches[0].totalAmountSubatoms = "1"; }],
  ["parent movement", (state) => { state.transferBatches[0].movementAmountSubatoms = "1"; }],
  ["parent fee", (state) => { state.transferBatches[0].batchRegistryPaymentSats = 547; }],
  ["child fee", (state) => { state.transfers[0].paidSats = 546; }],
  ["child position", (state) => { state.transfers[0].recordOrdinal = 9; }],
  ["child block", (state) => { state.transfers[0].blockHash = "ef".repeat(32); }],
  ["child commitment", (state) => { state.transfers[0].batchPayloadCommitment = { ...state.transfers[0].batchPayloadCommitment, sha256: "00".repeat(32) }; }],
]) {
  test(`economic projection refuses ${name} corruption`, () => {
    const state = family(); mutate(state);
    assert.throws(() => api.economicTokenTransfersFromState(state), /Canonical WORK batch/);
  });
}

test("base accounting still refuses a missing canonical parent position", () => {
  const economic = api.economicTokenTransfersFromState(family());
  delete economic[0].recordOrdinal;
  assert.throws(() => api.growthActualBaseNetworkValueEvents([], [], [], [], [], economic, []), /position is incomplete/);
});
