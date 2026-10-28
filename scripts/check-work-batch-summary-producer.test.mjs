import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";
import * as bitcoin from "bitcoinjs-lib";
import * as units from "../server/work-units.mjs";
import * as bonds from "../server/bond-units.mjs";
import { WORK_AMO_V5_ACTIVATION_HEIGHT, workAmoV5CanonicalPayloadCommitment } from "../server/work-amo-v5.mjs";
import { buildWorkMailBatchPayload, workMailBatchEnvelopeMatches } from "../src/shared/protocol/workMailBatch.mjs";
import { buildWorkBatchPayload } from "../src/shared/protocol/workBatch.mjs";

const source = readFileSync(new URL("../server/proof-api.mjs", import.meta.url), "utf8");
const names = [
  "canonicalWorkTransferValueProjectionFromState", "canonicalWorkTransferValueProjectionIsUsable",
  "tokenStateWithCanonicalWorkTransferValues", "zeroWorkBatchProjectionEconomicFields",
  "isWorkBatchTransferParent", "isWorkBatchTransferChild", "workBatchEconomicTransfer",
  "economicTokenTransfersFromState", "zeroWorkBatchChildEconomicFields", "tokenCreditAmountMovedFields",
  "canonicalNonNegativeIntegerText", "canonicalWorkSubatomsText", "canonicalWorkAtomsText",
  "workRecordUsesSubatoms", "workSubatomsBigIntFromRecord", "workAtomsBigIntFromRecord",
  "workAmountFieldsFromSubatoms", "workAmountFieldsFromAtoms", "tokenLedgerAmountFields",
  "tokenLedgerAmountFromRecord", "topLevelWorkAmountRecord", "mergedCreditRecordWithExactWorkAmount",
  "mergeCreditNetworkValueRecord", "mergeTokenTransferRecord", "transferMergeString", "transferMergeNumber",
  "mergeTokenStateItemsByKey", "tokenTransferHistoryItemKey", "canonicalTokenReplayPosition",
  "numericValue", "newerIso", "normalizeTokenScope", "isBondTokenId",
  "tokenTransferFromIndexedActivityItem", "canonicalEventIdentityDetails", "workBatchChildIdentityFields",
  "canonicalMinerFeeDetailsFromActivity", "canonicalCreditValueFieldsFromRecord", "indexedActivityValue",
];
const constants = ["WORK_TOKEN_MAX_SUPPLY", "WORK_TOKEN_MAX_SUPPLY_ATOMS", "WORK_TOKEN_MAX_SUPPLY_SUBATOMS",
  "TOKEN_MIN_MUTATION_PRICE_SATS", "WORK_TRANSFER_VALUE_PROJECTION_MODEL", "CREDIT_NETWORK_VALUE_FIELD_NAMES",
  "WORK_TRANSFER_VALUE_PROJECTION_FIELD_NAMES", "WORK_BATCH_TRANSFER_VALUE_PROJECTION_MODEL",
  "WORK_MAIL_BATCH_TRANSFER_VALUE_PROJECTION_MODEL", "WORK_BATCH_TRANSFER_VALUE_PROJECTION_FIELD_NAMES"];
function context(text = source) {
  const parsed = ts.createSourceFile("api.mjs", text, ts.ScriptTarget.Latest, true);
  const functions = new Map(parsed.statements.filter(ts.isFunctionDeclaration).map(n => [n.name.text, n.getText(parsed)]));
  const values = new Map(parsed.statements.filter(ts.isVariableStatement).flatMap(n => n.declarationList.declarations)
    .map(n => [n.name.getText(parsed), n.getText(parsed)]));
  const result = vm.createContext({ ...units, ...bonds, Buffer, WORK_AMO_V5_ACTIVATION_HEIGHT, buildWorkMailBatchPayload, workMailBatchEnvelopeMatches, workAmoV5CanonicalPayloadCommitment,
    VALUE_Q8_SCALE: 100_000_000n, TOKEN_SEND_SUBATOMS_ACTION: "send3",
    TOKEN_SALE_AUTH_WORK_AMO_V8_VERSION: "buy5", BOND_TOKEN_IDS: new Set(),
    // Ordering and pending totals are outside the snapshot-value merge boundary.
    compareTokenHistoryPageItems: (a, b) => (a.recordOrdinal ?? 0) - (b.recordOrdinal ?? 0),
    tokenStateWithPendingStats: state => state,
  });
  vm.runInContext([...constants.filter(n => values.has(n)).map(n => `const ${values.get(n)};`),
    ...names.filter(n => functions.has(n)).map(n => functions.get(n))].join("\n"), result);
  return result;
}
const api = context();
const plain = value => JSON.parse(JSON.stringify(value));
const address = byte => bitcoin.payments.p2wpkh({ hash: Buffer.alloc(20, byte) }).address;
const sender = address(1);
const chain = { model: "canonical-work-amo-raw-transition-chain-sha256-v1", sha256: "aa".repeat(32), payloadBytes: 123 };
const floorQ8 = 100_000_001n;
function fixture() {
  const recipients = [{ recipientAddress: sender, amountSubatoms: "10000000000000000" },
    { recipientAddress: address(2), amountSubatoms: "50000000" },
    { recipientAddress: address(3), amountSubatoms: "50000000" }];
  const total = recipients.reduce((s, x) => s + BigInt(x.amountSubatoms), 0n);
  const parent = { ...plain(api.workAmountFieldsFromSubatoms(total.toString())),
    kind: "token-transfer-batch", transferVersion: "batch1", amountVersion: "batch1",
    network: "livenet", tokenId: units.WORK_TOKEN_ID, txid: "ab".repeat(32),
    blockHeight: 973284, blockHash: "cd".repeat(32), blockIndex: 4, protocolVout: 1, recordOrdinal: 0,
    confirmed: true, valid: true, senderAddress: sender, registryAddress: address(4),
    recipients, recipientCount: 3, totalAmountSubatoms: total.toString(), movementAmountSubatoms: "100000000",
    paidSats: 546, batchRegistryPaymentSats: 546, registryMutationFeeSats: 546,
    minerFeeSats: 47, canonicalMinerFeeSats: 47, attributedMinerFeeSats: 47,
    canonicalMinerFeeCovered: true, fixedEventFlowSats: 593,
    batchPayloadCommitment: workAmoV5CanonicalPayloadCommitment({ payload: buildWorkBatchPayload(recipients) }),
    transitionChainCommitmentAfter: chain, creditFloorAtConfirmModel: "canonical-work-v5",
    creditFloorAtConfirmQ8: floorQ8.toString(), creditValueAtConfirmQ8: "1",
    networkValueBeforeEventQ8: (floorQ8 * 21_000_000n).toString() };
  const transfers = recipients.map((recipient, index) => ({ ...parent,
    ...plain(api.workAmountFieldsFromSubatoms(recipient.amountSubatoms)), ...recipient,
    kind: "token-transfer", recordOrdinal: index + 1, containerPosition: { protocolVout: 1, recordOrdinal: 0 },
    batchRecipientIndex: index, batchRecipientCount: 3, batchTotalAmountSubatoms: total.toString(),
    derived: true, derivedId: `${parent.txid}:${index + 1}`, parentTransitionChainCommitmentAfter: chain,
    rawCandidate: false, economicDelta: false, chargesTransactionFee: false, claimsEconomicOutputs: false,
    paidSats: 0, registryMutationFeeSats: 0, minerFeeSats: 0, canonicalMinerFeeSats: 0 }));
  return { amountStorageModel: units.WORK_SUBATOM_PROJECTION_MODEL, transfers, transferBatches: [parent] };
}
const project = state => plain(api.canonicalWorkTransferValueProjectionFromState(state, units.q8ToCanonicalDecimal(floorQ8)));

test("physical quantities survive, children remain zero, and aggregate parent rounds once", () => {
  const state = fixture(); const before = JSON.stringify(state); const result = project(state);
  assert.equal(JSON.stringify(state), before); assert.equal(result.items.length, 3);
  assert.equal(result.transferBatches.length, 1);
  for (let i = 0; i < 3; i++) {
    const child = result.items[i]; assert.equal(child.amountSubatoms, state.transfers[i].amountSubatoms);
    assert.equal(child.recordOrdinal, i + 1); assert.deepEqual(child.parentTransitionChainCommitmentAfter, chain);
    assert.equal(child.creditAmountMoved, "0"); assert.equal(child.creditAmountMovedSubatoms, "0");
    for (const [key, value] of Object.entries(child)) {
      if (key.endsWith("Sats")) assert.equal(value, 0, key);
      if (key.endsWith("Q8")) assert.equal(value, "0", key);
    }
  }
  const parent = result.transferBatches[0];
  assert.equal(parent.amountSubatoms, state.transferBatches[0].totalAmountSubatoms);
  assert.equal(parent.creditAmountMovedSubatoms, "100000000");
  assert.equal(parent.creditLiveValueQ8, "1"); assert.equal(parent.fixedEventFlowSats, 593);
  assert.equal(parent.frozenNetworkValueQ8, "59300000001"); assert.equal(parent.liveNetworkValueQ8, "59300000001");
  assert.equal(parent.paidSats, 546); assert.equal(parent.minerFeeSats, 47);
  assert.equal(api.canonicalWorkTransferValueProjectionIsUsable(result), true);
});
for (const [name, change] of [
  ["missing sibling", s => s.transfers.pop()],
  ["duplicate child", s => { s.transfers[1] = { ...s.transfers[0] }; }],
  ["orphan child", s => { s.transferBatches = []; }],
  ["missing all children", s => { s.transfers = []; }],
  ["wrong recipient amount", s => { s.transfers[0].amountSubatoms = "1"; }],
  ["charged child fee", s => { s.transfers[0].minerFeeSats = 1; }],
  ["wrong parent movement", s => { s.transferBatches[0].movementAmountSubatoms = "1"; }],
  ["wrong child commitment", s => { s.transfers[0].batchPayloadCommitment = { ...s.transfers[0].batchPayloadCommitment, sha256: "ff".repeat(32) }; }],
]) test(`producer refuses ${name} before emitting a zero child`, () => {
  const state = fixture(); change(state); assert.throws(() => project(state), /Canonical WORK batch/u);
});
test("snapshot merge restores parent values and cannot resurrect stale child economics", () => {
  const state = fixture(); const projection = project(state);
  for (const child of state.transfers) Object.assign(child, { creditLiveValueQ8: "999", minerFeeSats: 9 });
  const restored = plain(api.tokenStateWithCanonicalWorkTransferValues(state, projection));
  assert.equal(restored.transferBatches.length, 1);
  assert.equal(restored.transferBatches[0].creditAmountMovedSubatoms, "100000000");
  assert.equal(restored.transferBatches[0].creditLiveValueQ8, "1");
  for (const child of restored.transfers) { assert.equal(child.creditLiveValueQ8, "0"); assert.equal(child.minerFeeSats, 0); }
  assert.equal(api.economicTokenTransfersFromState(restored).length, 1);
});
test("actual indexed-activity reconstruction restores child role only for a complete family", () => {
  const state = fixture();
  state.transfers = state.transfers.map(child => plain(api.tokenTransferFromIndexedActivityItem(
    child, { tokenId: units.WORK_TOKEN_ID, ticker: "WORK", amountStorageModel: units.WORK_SUBATOM_PROJECTION_MODEL },
    "livenet", units.WORK_SUBATOM_PROJECTION_MODEL,
  )));
  assert.ok(state.transfers.every(child => child.kind === undefined));
  const result = project(state);
  assert.ok(result.items.every(child => child.kind === "token-transfer" && child.creditLiveValueQ8 === "0"));
  state.transfers.pop();
  assert.throws(() => project(state), /incomplete recipient set/u);
});
test("unmarked batch projection is rejected; ordinary Q8/Q16 output is byte-compatible", () => {
  const projection = project(fixture()); delete projection.batchModel;
  assert.equal(api.canonicalWorkTransferValueProjectionIsUsable(projection), false);
  const baseline = context(execFileSync("git", ["show", "7ce30976f8c615111da0ecc54cb0e5823994ab43:server/proof-api.mjs"],
    { encoding: "utf8", maxBuffer: 16 * 1024 * 1024 }));
  for (const q16 of [false, true]) {
    const ordinary = fixture().transferBatches[0];
    Object.assign(ordinary, { kind: "token-transfer", transferVersion: q16 ? "send3" : "send2",
      amountVersion: q16 ? "send3" : "send2", recipientAddress: address(2) });
    if (!q16) { delete ordinary.amountSubatoms; delete ordinary.precisionModel;
      Object.assign(ordinary, plain(api.workAmountFieldsFromAtoms("100000000"))); }
    const input = { amountStorageModel: q16 ? units.WORK_SUBATOM_PROJECTION_MODEL : units.WORK_ATOMIC_PROJECTION_MODEL,
      transfers: [ordinary] };
    assert.deepEqual(project(input), plain(baseline.canonicalWorkTransferValueProjectionFromState(input,
      units.q8ToCanonicalDecimal(floorQ8))));
  }
});
