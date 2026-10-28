import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";
import * as bitcoin from "bitcoinjs-lib";
import * as units from "../server/work-units.mjs";
import * as bonds from "../server/bond-units.mjs";
import { buildWorkBatchPayload, parseWorkBatchPayload } from "../src/shared/protocol/workBatch.mjs";
import { workAmoV5CanonicalPayloadCommitment } from "../server/work-amo-v5.mjs";
import * as amoV5 from "../server/work-amo-v5.mjs";
import * as amoV8 from "../server/work-amo-v8.mjs";

// Run both production boundaries without starting either entrypoint or clients.
function declarations(relative) {
  const text = readFileSync(new URL(relative, import.meta.url), "utf8");
  const source = ts.createSourceFile(relative, text, ts.ScriptTarget.Latest, true);
  return {
    functions: new Map(source.statements.filter(ts.isFunctionDeclaration)
      .map(node => [node.name.text, node.getText(source).replace(/^export\s+/u, "")])),
    constants: new Map(source.statements.filter(ts.isVariableStatement)
      .flatMap(node => node.declarationList.declarations)
      .map(node => [node.name.getText(source), node.getText(source)])),
  };
}
function load(context, source, functions, constants = []) {
  vm.runInContext([
    ...constants.map(name => { assert.ok(source.constants.has(name), name); return `const ${source.constants.get(name)};`; }),
    ...functions.map(name => { assert.ok(source.functions.has(name), name); return source.functions.get(name); }),
  ].join("\n"), context);
}
const apiSource = declarations("../server/proof-api.mjs");
const workerSource = declarations("./backfill-proof-indexer.mjs");
const common = { ...units, ...bonds, Buffer, buildWorkBatchPayload, parseWorkBatchPayload,
  workAmoV5CanonicalPayloadCommitment, VALUE_Q8_SCALE: 100_000_000n,
  normalizeTokenScope: value => String(value ?? "").trim().toLowerCase(),
  isBondTokenId: () => false };
const api = vm.createContext(common);
load(api, apiSource, [
  "canonicalWorkTransferValueProjectionFromState", "zeroWorkBatchProjectionEconomicFields",
  "isWorkBatchTransferParent", "isWorkBatchTransferChild", "workBatchEconomicTransfer",
  "economicTokenTransfersFromState", "zeroWorkBatchChildEconomicFields",
  "canonicalNonNegativeIntegerText", "canonicalWorkSubatomsText", "canonicalWorkAtomsText",
  "workRecordUsesSubatoms", "workSubatomsBigIntFromRecord", "workAtomsBigIntFromRecord",
  "workAmountFieldsFromSubatoms", "workAmountFieldsFromAtoms", "tokenLedgerAmountFromRecord",
  "tokenLedgerAmountFields", "tokenCreditAmountMovedFields", "numericValue",
], ["TOKEN_MIN_MUTATION_PRICE_SATS", "WORK_TOKEN_MAX_SUPPLY", "WORK_TOKEN_MAX_SUPPLY_ATOMS",
  "WORK_TOKEN_MAX_SUPPLY_SUBATOMS", "CREDIT_NETWORK_VALUE_FIELD_NAMES",
  "WORK_TRANSFER_VALUE_PROJECTION_MODEL", "WORK_TRANSFER_VALUE_PROJECTION_FIELD_NAMES",
  "WORK_BATCH_TRANSFER_VALUE_PROJECTION_MODEL", "WORK_BATCH_TRANSFER_VALUE_PROJECTION_FIELD_NAMES"]);
const worker = vm.createContext({ ...common,
  objectPayload: value => value && typeof value === "object" && !Array.isArray(value) ? value : null,
  canonicalSummaryCoverage: () => 973_284,
  WORK_AMO_V8_DECLARATION_PINS_CONFIGURED: true,
  WORK_AMO_V8_CONFIGURED_ACTIVATION_HEIGHT: 1,
});
load(worker, workerSource, ["canonicalNonNegativeQ8Text", "exactWorkNetworkValueSummaryBinding",
  "canonicalSummaryAccountingModelsCurrent"], ["WORK_TOKEN_MAX_SUPPLY", "WORK_NETWORK_VALUE_ACCOUNTING_MODEL",
  "WORK_TRANSFER_VALUE_PROJECTION_MODEL", "INCB_ISSUANCE_ACCOUNTING_MODEL",
  "INCB_NETWORK_VALUE_ACCOUNTING_MODEL", "INCB_VALUE_SNAPSHOT_MODEL"]);
const plain = value => JSON.parse(JSON.stringify(value));
const address = value => bitcoin.payments.p2wpkh({ hash: Buffer.alloc(20, value) }).address;
const sender = address(1);
const q8 = value => units.q8ToCanonicalDecimal(value);
const metadata = amount => plain(api.workAmountFieldsFromSubatoms(amount.toString()));
const CHAIN = { model: "canonical-work-amo-raw-transition-chain-sha256-v1", sha256: "ef".repeat(32), payloadBytes: 21_834 };
function stateFixture({ count = 3, amount = 50_000_001n, self = true } = {}) {
  const recipients = Array.from({ length: count }, (_, index) => ({
    recipientAddress: index === 0 && self ? sender : address(index + 2),
    amountSubatoms: (index === 0 && self ? units.WORK_SUBATOM_UNIT_SCALE : amount).toString(),
  }));
  const total = recipients.reduce((sum, row) => sum + BigInt(row.amountSubatoms), 0n);
  const movement = recipients.reduce((sum, row) => sum + (row.recipientAddress === sender ? 0n : BigInt(row.amountSubatoms)), 0n);
  const network = 21_000_000n * 100_000_000n;
  const confirmValue = movement * network / (21_000_000n * units.WORK_SUBATOM_UNIT_SCALE);
  const parent = { ...metadata(total), kind: "token-transfer-batch", transferVersion: "batch1", amountVersion: "batch1",
    tokenId: units.WORK_TOKEN_ID, network: "livenet", txid: "ab".repeat(32), blockHash: "cd".repeat(32),
    blockHeight: 973_284, blockIndex: 7, protocolVout: 1, recordOrdinal: 0, valid: true, confirmed: true,
    senderAddress: sender, recipients, recipientCount: count, totalAmountSubatoms: total.toString(),
    movementAmountSubatoms: movement.toString(), batchPayloadCommitment: workAmoV5CanonicalPayloadCommitment({
      payload: buildWorkBatchPayload(recipients) }), transitionChainCommitmentAfter: CHAIN,
    paidSats: 546, registryMutationFeeSats: 546, batchRegistryPaymentSats: 546,
    minerFeeSats: 47, canonicalMinerFeeSats: 47, attributedMinerFeeSats: 47, canonicalMinerFeeCovered: true,
    fixedEventFlowSats: 593, creditFloorAtConfirmModel: "canonical-frozen-credit-replay-v1",
    creditFloorAtConfirmQ8: "100000000", creditFloorAtConfirmSats: "1",
    creditValueAtConfirmQ8: confirmValue.toString(), creditValueAtConfirmSats: q8(confirmValue),
    networkValueBeforeEventQ8: network.toString(), networkValueBeforeEventSats: q8(network),
    liveNetworkValueBeforeEventQ8: network.toString(), liveNetworkValueBeforeEventSats: q8(network),
  };
  const children = recipients.map((row, index) => ({
    ...metadata(BigInt(row.amountSubatoms)), ...row, kind: "token-transfer", transferVersion: "batch1", amountVersion: "batch1",
    tokenId: parent.tokenId, network: parent.network, txid: parent.txid, blockHash: parent.blockHash,
    blockHeight: parent.blockHeight, blockIndex: parent.blockIndex, protocolVout: parent.protocolVout,
    recordOrdinal: index + 1, valid: true, confirmed: true, senderAddress: sender,
    batchRecipientIndex: index, batchRecipientCount: count, batchTotalAmountSubatoms: total.toString(),
    batchPayloadCommitment: parent.batchPayloadCommitment, parentTransitionChainCommitmentAfter: CHAIN,
    containerPosition: { blockHeight: parent.blockHeight, blockHash: parent.blockHash,
      blockTransactionIndex: parent.blockIndex, protocolVout: parent.protocolVout, recordOrdinal: 0 },
    derived: true, derivedId: `${parent.txid}:${index}`, rawCandidate: false, economicDelta: false,
    chargesTransactionFee: false, claimsEconomicOutputs: false,
    paidSats: 0, registryMutationFeeSats: 0, minerFeeSats: 0,
  }));
  return { amountStorageModel: units.WORK_SUBATOM_PROJECTION_MODEL, transfers: children, transferBatches: [parent] };
}
function summary(projection) {
  const networkQ8 = "6300000000000000";
  const floor = { liveFloorSats: "3", networkValueQ8: networkQ8, liveNetworkValueQ8: networkQ8,
    workNetworkValueAccountingModel: vm.runInContext("WORK_NETWORK_VALUE_ACCOUNTING_MODEL", worker),
    actualValue: { networkValueQ8: networkQ8, liveNetworkValueQ8: networkQ8, totalQ8: networkQ8, liveTotalQ8: networkQ8,
      workNetworkValueAccountingModel: vm.runInContext("WORK_NETWORK_VALUE_ACCOUNTING_MODEL", worker),
      creditMinerFeeAccountingModel: "canonical-unique-tx-input-output-v1", creditMinerFeeCoverage: {
        complete: true, source: "proof-indexer-normalized-input-output-totals", confirmedEvents: 13,
        coveredConfirmedEvents: 13, missingConfirmedEvents: 0, confirmedTransactions: 1,
        coveredConfirmedTransactions: 1, missingConfirmedTransactions: 0, missingConfirmedTxids: [],
      } } };
  const actual = { attachmentAccountingModel: "canonical-pre-bond-live-network-value-v2",
    issuanceAccountingModel: "canonical-pre-bond-live-network-value-v2", issuanceCheckpointMode: "bond-transaction-provenance",
    networkValueAccountingModel: "fixed-incb-issuance-plus-market-flow-v1",
    attachedWorkAmountStorageModel: units.WORK_SUBATOM_PROJECTION_MODEL,
    attachedWorkAmountDecimals: units.WORK_SUBATOM_DECIMALS, attachedWorkAmountPrecisionModel: units.WORK_PRECISION_V2_MODEL,
    attachedWorkAmountUnitScale: units.WORK_SUBATOM_UNIT_SCALE_TEXT, attachedWorkAmountSubatoms: "0",
  };
  for (const field of ["confirmedIssuanceUnits", "directProofIssuanceUnits", "attachedWorkIssuanceUnits",
    "bondSaleVolumeSats", "bondTransferFeeSats", "bondMarketplaceMutationFeeSats"]) actual[field] = "0";
  for (const prefix of ["attachedWorkLiveValueAtSend", "issuanceNetworkValue", "issuanceDust", "issuanceFloor",
    "issuanceValueSnapshotWorkNetworkValue", "networkValue", "liveNetworkValue", "frozenNetworkValue",
    "floor", "liveFloor", "frozenFloor"]) {
    actual[`${prefix}Q8`] = "0"; actual[`${prefix}Sats`] = "0";
  }
  return { workFloor: floor,
    workSummary: { floor, token: { stats: { confirmedTransfers: projection.items.length } }, workTransferValueProjection: projection },
    inceptionSummary: { actualValue: actual, networkValueQ8: "0", networkValueSats: "0",
      stats: { confirmedSupply: "0" }, token: { stats: { confirmedMints: 0 } } },
  };
}
const produce = state => plain(api.canonicalWorkTransferValueProjectionFromState(state, "3"));
const accepts = projection => worker.canonicalSummaryAccountingModelsCurrent(summary(projection));

test("actual producer to actual publication guard values one batch parent and keeps all physical recipients", () => {
  const state = stateFixture(); const original = JSON.stringify(state); const projection = produce(state);
  assert.equal(JSON.stringify(state), original);
  assert.equal(projection.items.length, 3); assert.equal(projection.transferBatches.length, 1);
  assert.equal(projection.transferBatches[0].amountSubatoms, state.transferBatches[0].totalAmountSubatoms);
  assert.equal(projection.transferBatches[0].creditAmountMovedSubatoms, "100000002");
  assert.equal(projection.transferBatches[0].creditValueAtConfirmQ8, "1", "floor aggregate movement once, not each child");
  assert.equal(projection.transferBatches[0].creditLiveValueQ8, "3");
  assert.ok(projection.items.every(row => row.creditValueAtConfirmQ8 === "0" && row.creditLiveValueQ8 === "0"));
  assert.equal(accepts(projection), true);
});

test("sub-proof aggregate values may round to zero without waiving parent fees or exact equations", () => {
  const projection = produce(stateFixture({ amount: 1n }));
  assert.equal(projection.transferBatches[0].creditValueAtConfirmQ8, "0");
  assert.equal(projection.transferBatches[0].creditLiveValueQ8, "0");
  assert.equal(projection.transferBatches[0].frozenNetworkValueQ8, "59300000000");
  assert.equal(accepts(projection), true);
});

test("twelve child positions sharing one carrier remain unique only within their fully qualified batch", () => {
  const projection = produce(stateFixture({ count: 12, amount: 100_000_000_000_000n, self: false }));
  assert.equal(accepts(projection), true);
  const old = structuredClone(projection); delete old.batchModel; delete old.transferBatches;
  for (const row of old.items) {
    for (const field of ["kind", "network", "transferVersion", "batchRecipientIndex", "batchRecipientCount",
      "batchTotalAmountSubatoms", "containerPosition", "derivedId", "parentTransitionChainCommitmentAfter",
      "batchPayloadCommitment", "economicDelta", "chargesTransactionFee", "claimsEconomicOutputs", "rawCandidate"]) delete row[field];
    row.creditLiveValueQ8 = "2468098403541245402"; row.creditLiveValueSats = q8(row.creditLiveValueQ8);
    row.liveNetworkValueQ8 = row.creditLiveValueQ8; row.liveNetworkValueSats = row.creditLiveValueSats;
  }
  assert.equal(accepts(old), false, "observed legacy producer shape remains unpublishable");
});

test("actual reader constructors preserve a publishable complete family without fabricated child kind", () => {
  const reader = vm.createContext({ ...common, ...amoV5, ...amoV8 });
  load(reader, declarations("../server/db/proof-index-reader.mjs"), [
    "tokenBatchFromEventPayload", "tokenTransferFromEventPayload",
    "canonicalEventIdentityDetails", "canonicalMovementPositionFromEventRow",
    "workAmountProjectionMetadataForAmount", "workAmountProjection", "workAmountProjectionMetadata",
    "formatWorkAmountByProjectionMeta", "objectRecord", "rowNumber", "dateIso",
    "tokenRegistryAddressFromPayload",
  ]);
  const input = stateFixture({ count: 12, amount: 100_000_000_000_000n, self: false });
  const relation = item => ({
    network: item.network, txid: item.txid, status: "confirmed", transaction_status: "confirmed",
    effective_status: "confirmed", block_height: item.blockHeight, transaction_block_height: item.blockHeight,
    block_index: item.blockIndex, transaction_block_index: item.blockIndex,
    op_return_vout: item.protocolVout, record_ordinal: item.recordOrdinal,
    block_hash: item.blockHash, canonical_block_hash: item.blockHash,
    event_id: 9000 + item.recordOrdinal, ticker: "WORK", token_id: item.tokenId,
  });
  const reconstructed = {
    amountStorageModel: input.amountStorageModel,
    transferBatches: input.transferBatches.map(item =>
      plain(reader.tokenBatchFromEventPayload(item, relation(item)))),
    transfers: input.transfers.map(item =>
      plain(reader.tokenTransferFromEventPayload(item, relation(item)))),
  };
  assert.ok(reconstructed.transfers.every(item => !Object.hasOwn(item, "kind")));
  assert.ok(reconstructed.transfers.every(item => !Object.hasOwn(item, "valid")));
  const projection = produce(reconstructed);
  assert.equal(projection.transferBatches.length, 1);
  assert.equal(projection.items.length, 12);
  assert.ok(projection.items.every(item => item.kind === "token-transfer"));
  assert.equal(accepts(projection), true);
  const missingChild = structuredClone(reconstructed);
  missingChild.transfers.pop();
  assert.throws(() => produce(missingChild), /incomplete recipient set/u,
    "normalizing reader output must still require the complete canonical family");
});

const mutations = {
  "missing parent": value => { value.transferBatches = []; },
  "missing child": value => { value.items.pop(); },
  "duplicated child": value => { value.items[1] = structuredClone(value.items[0]); },
  "duplicated parent": value => { value.transferBatches.push(structuredClone(value.transferBatches[0])); },
  "unknown model": value => { value.batchModel = "unreviewed"; },
  "missing child transfer version": value => { delete value.items[1].transferVersion; },
  "missing child zero fee": value => { delete value.items[1].canonicalMinerFeeSats; },
  "child floor repricing": value => { value.items[1].creditLiveFloorQ8 = "1"; },
  "recipient mismatch": value => { value.items[1].recipientAddress = address(30); },
  "child amount mismatch": value => { value.items[1].amountSubatoms = "7"; },
  "child amount alias mismatch": value => { value.items[1].amount = "7"; },
  "ordinal mismatch": value => { value.items[1].recordOrdinal++; },
  "block position mismatch": value => { value.items[1].blockIndex++; },
  "container position mismatch": value => { value.items[1].containerPosition.blockHeight++; },
  "chain mismatch": value => { value.items[1].parentTransitionChainCommitmentAfter.sha256 = "12".repeat(32); },
  "payload commitment mismatch": value => { value.transferBatches[0].batchPayloadCommitment.sha256 = "12".repeat(32); },
  "derived id duplicated": value => { value.items[1].derivedId = value.items[0].derivedId; },
  "child fees": value => { value.items[1].minerFeeSats = 1; },
  "child live repricing": value => { value.items[1].creditLiveValueQ8 = "1"; value.items[1].creditLiveValueSats = "0.00000001"; },
  "child economic ownership": value => { value.items[1].economicDelta = true; },
  "child registry ownership": value => { value.items[1].claimsEconomicOutputs = true; },
  "parent registry fee": value => { value.transferBatches[0].paidSats = 1092; },
  "parent extraneous payment": value => { value.transferBatches[0].proofPaymentSats = 546; },
  "parent fixed fee alias": value => { value.transferBatches[0].fixedEventFlowQ8 = "0"; },
  "parent miner coverage": value => { value.transferBatches[0].canonicalMinerFeeCovered = false; },
  "parent attributed miner": value => { value.transferBatches[0].attributedMinerFeeSats++; },
  "parent movement includes self": value => { value.transferBatches[0].movementAmountSubatoms = value.transferBatches[0].totalAmountSubatoms; },
  "parent individual rounding": value => { value.transferBatches[0].creditValueAtConfirmQ8 = "0"; value.transferBatches[0].creditValueAtConfirmSats = "0"; },
  "parent extra transaction": value => { value.items.push({ ...value.items[0], transferVersion: "send3", amountVersion: "send3" }); },
};
for (const [name, mutate] of Object.entries(mutations)) test(`publication refuses ${name}`, () => {
  const projection = produce(stateFixture()); mutate(projection); assert.equal(accepts(projection), false);
});

test("ordinary legacy projection retains its strict individual valuation and duplicate guard", () => {
  const state = stateFixture(); const parent = state.transferBatches[0];
  const ordinary = { ...parent, ...metadata(units.WORK_SUBATOM_UNIT_SCALE), kind: "token-transfer",
    transferVersion: "send3", amountVersion: "send3", recipientAddress: address(2),
    creditValueAtConfirmQ8: "100000000", creditValueAtConfirmSats: "1" };
  const projection = produce({ amountStorageModel: units.WORK_SUBATOM_PROJECTION_MODEL, transfers: [ordinary] });
  assert.equal(projection.batchModel, undefined); assert.equal(projection.transferBatches, undefined);
  assert.equal(accepts(projection), true);
  projection.items.push(structuredClone(projection.items[0])); assert.equal(accepts(projection), false);
  projection.items.pop(); projection.items[0].creditValueAtConfirmQ8 = "0";
  projection.items[0].creditValueAtConfirmSats = "0"; assert.equal(accepts(projection), false);
});


test("a zero-movement exception cannot admit an invalid duplicate self-recipient wire family", () => {
  const projection = produce(stateFixture());
  const parent = projection.transferBatches[0];
  for (const row of parent.recipients) row.recipientAddress = sender;
  const payload = `pwt1:batch1:${units.WORK_TOKEN_ID}:` +
    Buffer.from(JSON.stringify(parent.recipients.map(row => [row.recipientAddress, row.amountSubatoms]))).toString("base64url");
  parent.batchPayloadCommitment = workAmoV5CanonicalPayloadCommitment({ payload });
  parent.movementAmountSubatoms = "0"; parent.creditAmountMovedSubatoms = "0"; parent.creditAmountMoved = "0";
  for (const row of projection.items) { row.recipientAddress = sender; row.batchPayloadCommitment = parent.batchPayloadCommitment; }
  assert.equal(accepts(projection), false);
});
