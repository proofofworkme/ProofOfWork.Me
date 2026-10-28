import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";
import * as bitcoin from "bitcoinjs-lib";
import * as units from "../server/work-units.mjs";
import * as bonds from "../server/bond-units.mjs";
import { buildWorkBatchPayload, parseWorkBatchPayload } from "../src/shared/protocol/workBatch.mjs";
import { buildWorkMailBatchPayload, parseWorkMailBatchPayload, workMailBatchEnvelopeMatches } from "../src/shared/protocol/workMailBatch.mjs";
import { workAmoV5CanonicalPayloadCommitment } from "../server/work-amo-v5.mjs";
import * as amoV5 from "../server/work-amo-v5.mjs";
import * as amoV8 from "../server/work-amo-v8.mjs";
import { replay as replayMail } from "../tests/fixtures/workMailBatchReplay.mjs";
import { ACTOR, FEE, transaction as mailTransaction, recipients as mailRecipients } from "../tests/fixtures/workMailBatch.mjs";
import { projectWorkAmoV5RawEvents } from "../server/work-amo-v5-raw.mjs";
import { verifiedWorkBatchEventIds } from "../server/db/work-batch-reader.mjs";
import { validateWorkMailBatchProjectionEvents, verifiedWorkMailBatchEventIds } from "../server/db/work-mail-batch-reader.mjs";


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
  buildWorkMailBatchPayload, parseWorkMailBatchPayload, workMailBatchEnvelopeMatches,
  workAmoV5CanonicalPayloadCommitment, VALUE_Q8_SCALE: 100_000_000n,
  normalizeTokenScope: value => String(value ?? "").trim().toLowerCase(),
  isBondTokenId: () => false };
const api = vm.createContext({ ...common, compareWorkAmoUtf8: amoV5.compareWorkAmoUtf8,
  WORK_AMO_V5_ACTIVATION_HEIGHT: amoV5.WORK_AMO_V5_ACTIVATION_HEIGHT,
  compareCanonicalUtf8: (a, b) => Buffer.compare(Buffer.from(a), Buffer.from(b)),
  tokenStateWithPendingStats: state => state,
  compareTokenHistoryPageItems: (a, b) => (a.recordOrdinal ?? 0) - (b.recordOrdinal ?? 0),
  TOKEN_SEND_SUBATOMS_ACTION: "send3", TOKEN_SALE_AUTH_WORK_AMO_V8_VERSION: "buy5",
  canonicalInceptionWorkMovementOracleByIdentity: () => new Map(),
  // Byte-size display does not affect raw/fee/family validation in this fixture.
  proofProtocolDataBytesForVout: () => 0,
});
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
  "WORK_BATCH_TRANSFER_VALUE_PROJECTION_MODEL", "WORK_MAIL_BATCH_TRANSFER_VALUE_PROJECTION_MODEL", "WORK_BATCH_TRANSFER_VALUE_PROJECTION_FIELD_NAMES"]);
load(api, apiSource, [
  "tokenStateWithCreditNetworkValueDetails", "creditNetworkValueEventDetailFor", "tokenCanUseCreditNetworkFloor",
  "creditNetworkValueMetrics", "tokenAmountValueAtFloor", "creditMovementIdentity", "canonicalTokenReplayPosition",
  "creditReplayRecordIdentity", "creditValueEventMs", "creditValueEventPosition", "compareCreditValueReplayEvents",
  "assertUniqueCreditValueReplayPositions", "creditReplayTransactionMinerFeeSats", "verifiedCanonicalMinerFeeCoverage",
  "isTokenActivityItem", "presentNonNegativeNumber", "proofFlowBigInt", "workAmoV5HistoricalMovements",
], ["CREDIT_MINER_FEE_ACCOUNTING_MODEL", "TOKEN_MARKETPLACE_MUTATION_KINDS", "TOKEN_ACTIVITY_KINDS"]);
load(api, apiSource, ["workBatchProjectionRecords", "transactionTxid", "transactionConfirmed", "transactionBlockHash",
  "transactionBlockHeight", "transactionBlockIndex", "transactionMinerFeeSats", "tokenTransactionTime"],
  ["WORK_TOKEN_DEFAULT_REGISTRY_ADDRESS", "WORK_TOKEN_TICKER"]);
load(api, apiSource, [
  "canonicalWorkTransferValueProjectionIsUsable", "tokenStateWithCanonicalWorkTransferValues",
  "topLevelWorkAmountRecord", "mergedCreditRecordWithExactWorkAmount", "mergeCreditNetworkValueRecord",
  "mergeTokenTransferRecord", "transferMergeString", "transferMergeNumber", "mergeTokenStateItemsByKey",
  "tokenTransferHistoryItemKey", "newerIso",
]);
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
const feeReader = vm.createContext({ ...common, ...amoV5, verifiedWorkBatchEventIds, verifiedWorkMailBatchEventIds });
load(feeReader, declarations("../server/db/proof-index-reader.mjs"), [
  "rowsWithCanonicalTransferFees", "eventRowPayload", "canonicalEventPayload", "normalizeEventPayload",
  "bondTagForEventPayload", "bondTagForKind", "bondTagForMemo", "normalizedLowerText", "normalizedText",
  "canonicalEventIdentityDetails", "canonicalMovementPositionFromEventRow", "rowNumber", "dateIso",
  "plausibleBitcoinEventTime", "idRegistryProtocolFeeSats", "eventPayloadParticipants", "objectRecord",
], ["VERIFIED_WORK_BATCH_EVENT_ROWS", "BITCOIN_GENESIS_TIME_MS", "INFINITY_BOND_MEMO", "INFINITY_BOND_KIND",
  "INCEPTION_BOND_MEMO", "INCEPTION_BOND_KIND", "BOND_TAGS"]);
const plain = value => JSON.parse(JSON.stringify(value));
const address = value => { const hash = Buffer.alloc(20); hash.writeUInt32BE(value, 16); return bitcoin.payments.p2wpkh({ hash }).address; };
const sender = address(1);
const q8 = value => units.q8ToCanonicalDecimal(value);
const metadata = amount => plain(api.workAmountFieldsFromSubatoms(amount.toString()));
const CHAIN = { model: "canonical-work-amo-raw-transition-chain-sha256-v1", sha256: "ef".repeat(32), payloadBytes: 21_834 };
function stateFixture({ count = 3, amount = 50_000_001n, self = true, version = "batch1" } = {}) {
  const recipients = Array.from({ length: count }, (_, index) => ({
    recipientAddress: index === 0 && self ? sender : address(index + 2),
    amountSubatoms: (index === 0 && self ? units.WORK_SUBATOM_UNIT_SCALE : amount).toString(),
  }));
  const total = recipients.reduce((sum, row) => sum + BigInt(row.amountSubatoms), 0n);
  const movement = recipients.reduce((sum, row) => sum + (row.recipientAddress === sender ? 0n : BigInt(row.amountSubatoms)), 0n);
  const network = 21_000_000n * 100_000_000n;
  const confirmValue = movement * network / (21_000_000n * units.WORK_SUBATOM_UNIT_SCALE);
  const parent = { ...metadata(total), kind: "token-transfer-batch", transferVersion: version, amountVersion: version,
    tokenId: units.WORK_TOKEN_ID, network: "livenet", txid: "ab".repeat(32), blockHash: "cd".repeat(32),
    blockHeight: 973_284, blockIndex: 7, protocolVout: version === "mailbatch1" ? count + 2 : 1, recordOrdinal: 0, valid: true, confirmed: true,
    senderAddress: sender, recipients, recipientCount: count, totalAmountSubatoms: total.toString(),
    movementAmountSubatoms: movement.toString(), batchPayloadCommitment: workAmoV5CanonicalPayloadCommitment({
      payload: (version === "mailbatch1" ? buildWorkMailBatchPayload : buildWorkBatchPayload)(recipients) }), transitionChainCommitmentAfter: CHAIN,
    paidSats: 546, registryMutationFeeSats: 546, batchRegistryPaymentSats: 546,
    minerFeeSats: 47, canonicalMinerFeeSats: 47, attributedMinerFeeSats: 47, canonicalMinerFeeCovered: true,
    fixedEventFlowSats: 593, creditFloorAtConfirmModel: "canonical-frozen-credit-replay-v1",
    creditFloorAtConfirmQ8: "100000000", creditFloorAtConfirmSats: "1",
    creditValueAtConfirmQ8: confirmValue.toString(), creditValueAtConfirmSats: q8(confirmValue),
    networkValueBeforeEventQ8: network.toString(), networkValueBeforeEventSats: q8(network),
    liveNetworkValueBeforeEventQ8: network.toString(), liveNetworkValueBeforeEventSats: q8(network),
  };
  if (version === "mailbatch1") parent.mailEnvelope = { protocolVout: count, lastProtocolVout: count, recordOrdinal: 0, kind: "mail",
    payloadCommitment: workAmoV5CanonicalPayloadCommitment({ parts: [{ protocolVout: count, text: "pwm1:m:Hello" }] }),
    recipients: recipients.map((row, vout) => ({ recipientAddress: row.recipientAddress, amountSats: "546", vout })) };
  const children = recipients.map((row, index) => ({
    ...metadata(BigInt(row.amountSubatoms)), ...row, kind: "token-transfer", transferVersion: version, amountVersion: version,
    tokenId: parent.tokenId, network: parent.network, txid: parent.txid, blockHash: parent.blockHash,
    blockHeight: parent.blockHeight, blockIndex: parent.blockIndex, protocolVout: parent.protocolVout,
    recordOrdinal: index + 1, valid: true, confirmed: true, senderAddress: sender,
    batchRecipientIndex: index, batchRecipientCount: count, batchTotalAmountSubatoms: total.toString(),
    batchPayloadCommitment: parent.batchPayloadCommitment, parentTransitionChainCommitmentAfter: CHAIN,
    ...(parent.mailEnvelope ? { mailEnvelope: parent.mailEnvelope } : {}),
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

function reconstructWithReader(input) {
  const reader = vm.createContext({ ...common, ...amoV5, ...amoV8 });
  load(reader, declarations("../server/db/proof-index-reader.mjs"), [
    "tokenBatchFromEventPayload", "tokenTransferFromEventPayload",
    "canonicalEventIdentityDetails", "canonicalMovementPositionFromEventRow",
    "workAmountProjectionMetadataForAmount", "workAmountProjection", "workAmountProjectionMetadata",
    "formatWorkAmountByProjectionMeta", "objectRecord", "rowNumber", "dateIso",
    "tokenRegistryAddressFromPayload",
  ]);
  const relation = item => ({
    network: item.network, txid: item.txid,
    status: item.confirmed === false ? "pending" : "confirmed",
    transaction_status: item.confirmed === false ? "pending" : "confirmed",
    effective_status: item.confirmed === false ? "pending" : "confirmed", block_height: item.blockHeight, transaction_block_height: item.blockHeight,
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
  return reconstructed;
}

test("actual reader constructors preserve a publishable complete family without fabricated child kind", () => {
  const reconstructed = reconstructWithReader(stateFixture({ count: 12, amount: 100_000_000_000_000n, self: false }));
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

for (const count of [1, 78, 256]) test(`Mail ${count} actual reader → producer → worker retains one parent and zero-valued recipients`, () => {
  const input = stateFixture({ count, self: false, version: "mailbatch1" });
  const projection = produce(reconstructWithReader(input));
  assert.equal(projection.batchModel, "canonical-work-batch-transfer-value-projection-v2");
  assert.equal(projection.items.length, count);
  assert.equal(projection.transferBatches.length, 1);
  assert.equal(projection.transferBatches[0].paidSats, 546);
  assert.deepEqual(projection.transferBatches[0].mailEnvelope, input.transferBatches[0].mailEnvelope);
  assert.ok(projection.items.every(item => item.minerFeeSats === 0 && item.paidSats === 0 && item.creditLiveValueQ8 === "0"));
  assert.equal(accepts(projection), true);
});

test("sole-self Mail has zero WORK movement while preserving its registry and miner charges", () => {
  const input = stateFixture({ count: 1, self: true, version: "mailbatch1" });
  const projection = produce(reconstructWithReader(input));
  const parent = projection.transferBatches[0];
  assert.equal(parent.movementAmountSubatoms, "0");
  assert.equal(parent.creditAmountMovedSubatoms, "0");
  assert.equal(parent.creditValueAtConfirmQ8, "0");
  assert.equal(parent.creditLiveValueQ8, "0");
  assert.equal(parent.frozenNetworkValueQ8, "59300000000");
  assert.equal(parent.liveNetworkValueQ8, "59300000000");
  assert.equal(accepts(projection), true);
});

const mailMutations = {
  "legacy marker with Mail": value => { value.batchModel = "canonical-work-batch-transfer-value-projection-v1"; },
  "child version downgrade": value => { value.items[0].transferVersion = "batch1"; value.items[0].amountVersion = "batch1"; },
  "parent version downgrade": value => { value.transferBatches[0].transferVersion = "batch1"; },
  "missing envelope": value => { delete value.transferBatches[0].mailEnvelope; },
  "child envelope omission": value => { delete value.items[0].mailEnvelope; },
  "child envelope commitment": value => { value.items[0].mailEnvelope.payloadCommitment.sha256 = "01".repeat(32); },
  "Mail payment amount zero": value => { value.transferBatches[0].mailEnvelope.recipients[0].amountSats = "0"; },
  "Mail payment recipient": value => { value.transferBatches[0].mailEnvelope.recipients[0].recipientAddress = address(999); },
  "Mail payment position": value => { value.transferBatches[0].mailEnvelope.recipients[0].vout = 1; },
  "Mail carrier adjacency": value => { value.transferBatches[0].mailEnvelope.lastProtocolVout++; },
  "Mail record ordinal": value => { value.transferBatches[0].mailEnvelope.recordOrdinal = 1; },
  "Mail envelope extra field": value => { value.transferBatches[0].mailEnvelope.unverified = true; },
  "Mail payload hash": value => { value.transferBatches[0].batchPayloadCommitment.sha256 = "01".repeat(32); },
  "missing sole child": value => { value.items = []; },
  "self movement repriced": value => { value.transferBatches[0].creditLiveValueQ8 = "1"; },
};
for (const [name, mutate] of Object.entries(mailMutations)) test(`Mail publication refuses ${name}`, () => {
  const projection = produce(stateFixture({ count: 1, version: "mailbatch1" }));
  mutate(projection); assert.equal(accepts(projection), false);
});


for (const [count, self] of [[1, false], [78, false], [256, false], [1, true], [2, true]]) {
  test(`signed Mail raw replay → sealed family → actual reader → credit enrichment → worker (${count}, self=${self})`, async () => {
    const vector = mailRecipients(count);
    if (self) vector[0].recipientAddress = ACTOR;
    const tx = mailTransaction({ vector });
    const replay = replayMail([tx]);
    const event = replay.events.find(row => row.protocol === "pwt1");
    assert.equal(event.valid, true);
    const native = replay.records.map(record => {
      const accepted = replay.events.find(row => row.txid === record.txid && row.position.protocolVout === record.position.protocolVout);
      return { txid: record.txid, protocol: record.protocol, position: record.position, rawCandidate: true,
        output: accepted.output, rawWitness: record.payload, derived: accepted.derived,
        transitionChainCommitmentAfter: accepted.transitionChainCommitmentAfter,
        outcome: { valid: accepted.valid, kind: `${record.protocol}-valid`, semanticKind: accepted.semanticKind } };
    });
    const parentRecord = native.find(row => row.protocol === "pwt1");
    const time = "2026-10-28T12:00:00.000Z";
    const indexedTx = { ...tx, status: { confirmed: true, block_height: parentRecord.position.blockHeight,
      block_hash: parentRecord.position.blockHash, block_time: Date.parse(time) / 1000,
      block_index: parentRecord.position.blockTransactionIndex } };
    const prepared = plain(api.workBatchProjectionRecords({ parsed: event.parsed, transaction: indexedTx,
      message: replay.records.find(row => row.protocol === "pwt1").message, protocolVout: parentRecord.position.protocolVout,
      network: "livenet", senderAddress: ACTOR, consensusOutcome: event, mailEnvelope: event.output.mailEnvelope }));
    const acceptedParent = { ...prepared.parent, ...parentRecord.output.projection, confirmed: true, _workAmoV5ReplayBound: true,
      workAmoV5RawCandidate: true, payload: replay.records.find(row => row.protocol === "pwt1").message,
      workAmoV5ReplayOutput: parentRecord.output };
    const acceptedChildren = parentRecord.derived.map((descriptor, index) => ({ ...prepared.children[index], ...descriptor, txid: tx.txid,
      protocol: "pwt1", valid: true, confirmed: true, derived: true, position: descriptor.projectionPosition,
      _workAmoV5ReplayBound: true, workAmoV5RawCandidate: false,
      workAmoV5ReplayOutcome: { kind: "pwt1-valid", valid: true },
      workAmoV5ReplayRawWitness: { model: "canonical-work-amo-v5-derived-child-v1", descriptor,
        parentPosition: parentRecord.position, parentProtocol: "pwt1" } }));
    assert.equal(validateWorkMailBatchProjectionEvents({ transaction: tx, parent: acceptedParent,
      children: acceptedChildren, parentRecord, mailRecord: native.find(row => row.protocol === "pwm1"),
      activationContext: replay.workMailBatchV1 }).valid, true);
    const evidence = { parent_event_id: "10", parent_payload: acceptedParent, parent_records: [parentRecord],
      mail_records: [native.find(row => row.protocol === "pwm1")], transaction: tx,
      carrier_output: tx.vout[parentRecord.position.protocolVout], activation_context: replay.workMailBatchV1,
      siblings: acceptedChildren.map((payload, index) => ({ event_id: String(11 + index), payload, position: payload.position })) };
    const rows = [acceptedParent, ...acceptedChildren].map((payload, index) => ({ event_id: 10 + index, payload,
      network: "livenet", protocol: "pwt1", kind: payload.kind, status: "confirmed", valid: true,
      txid: tx.txid, transaction_status: "confirmed", block_height: parentRecord.position.blockHeight,
      transaction_block_height: parentRecord.position.blockHeight, block_index: parentRecord.position.blockTransactionIndex,
      transaction_block_index: parentRecord.position.blockTransactionIndex, op_return_vout: parentRecord.position.protocolVout,
      record_ordinal: index, block_hash: parentRecord.position.blockHash, canonical_block_hash: parentRecord.position.blockHash,
      canonical_position_required: true, canonical_miner_fee_covered: true, canonical_miner_fee_sats: String(FEE) }));
    const originalRows = JSON.stringify(rows);
    assert.throws(() => feeReader.eventRowPayload(rows[1], "livenet"), /qualified parent evidence/u);
    const qualifiedRows = await feeReader.rowsWithCanonicalTransferFees({ query: async sql => {
      assert.match(sql, /canonical_work_mail_batch_parent_evidence/u); return { rows: [evidence] };
    } }, rows, "livenet");
    const activity = qualifiedRows.map(row => plain(feeReader.eventRowPayload(row, "livenet")));
    assert.equal(JSON.stringify(rows), originalRows);
    assert.equal(activity[0].canonicalMinerFeeSats, FEE);
    assert.ok(activity.slice(1).every(item => item.canonicalMinerFeeSats === 0 && item.minerFeeSats === 0));
    assert.throws(() => feeReader.eventRowPayload({ ...rows[1] }, "livenet"), /qualified parent evidence/u);
    const raw = projectWorkAmoV5RawEvents({}, replay.events, replay.workState);
    assert.equal(raw.transfers.length, count);
    // Use the actual API prepared records plus canonical native projection,
    // then qualified indexed activity, not manufactured fee or family fields.
    const state = reconstructWithReader({ amountStorageModel: units.WORK_SUBATOM_PROJECTION_MODEL,
      transferBatches: [activity[0]], transfers: activity.slice(1) });
    state.tokens = [{ tokenId: units.WORK_TOKEN_ID, ticker: "WORK", maxSupply: 21_000_000, valid: true }];
    const parent = state.transferBatches[0];
    assert.equal(parent.minerFeeSats, FEE);
    assert.equal(parent.canonicalMinerFeeCovered, true);
    const outcome = [...replay.outcomes.values()].find(row => row.parsed.kind === "mail-batch");
    const opening = BigInt(outcome.networkValueBeforeQ8);
    const credit = api.creditNetworkValueMetrics({ tokenDefinitions: state.tokens,
      tokenTransfers: api.economicTokenTransfersFromState(state), confirmedActivity: [parent],
      baseValueAt: () => Number(opening) / 1e8, baseValueQ8At: () => opening,
      baseValueBeforeEventQ8: () => opening, cutoffMs: Date.parse(time) + 1000, includeEvents: true });
    assert.equal(credit.events.length, 1);
    assert.equal(credit.events[0].registryMutationFeeSats, 546);
    assert.equal(credit.events[0].minerFeeSats, FEE);
    assert.equal(credit.events[0].creditValueAtConfirmQ8, replay.economicState.creditMovementFrozenValueQ8);
    const enriched = plain(api.tokenStateWithCreditNetworkValueDetails(state, credit));
    const projection = produce(enriched);
    assert.equal(projection.items.length, count);
    assert.equal(projection.transferBatches.length, 1);
    assert.equal(accepts(projection), true);
    const missing = structuredClone(projection); missing.items.pop(); assert.equal(accepts(missing), false);
    assert.equal(replay.feeTransitions.length, 1);
    assert.deepEqual(plain(api.workAmoV5HistoricalMovements(state, parent.blockHeight))
      .map(({ identity, amountSubatoms }) => ({ identity, amountSubatoms })),
      replay.economicState.movements.map(({ identity, amountSubatoms }) => ({ identity, amountSubatoms })));
  });
}


test("one summary may contain both versions without changing either family's wire or fee", () => {
  const ordinary = stateFixture();
  const mail = stateFixture({ count: 1, self: false, version: "mailbatch1" });
  for (const item of [...mail.transferBatches, ...mail.transfers]) {
    item.txid = "12".repeat(32);
    if (item.derivedId) item.derivedId = `${item.txid}:${item.recordOrdinal}`;
  }
  const projection = produce({ amountStorageModel: units.WORK_SUBATOM_PROJECTION_MODEL,
    transfers: [...ordinary.transfers, ...mail.transfers], transferBatches: [...ordinary.transferBatches, ...mail.transferBatches] });
  assert.equal(projection.batchModel, "canonical-work-batch-transfer-value-projection-v2");
  assert.equal(projection.items.length, 4);
  assert.equal(projection.transferBatches.length, 2);
  assert.equal(accepts(projection), true);
  const oldOnly = produce(ordinary);
  assert.equal(oldOnly.batchModel, "canonical-work-batch-transfer-value-projection-v1");
  oldOnly.batchModel = "canonical-work-batch-transfer-value-projection-v2";
  assert.equal(accepts(oldOnly), false);
});

for (const [count, self] of [[1, true], [1, false], [78, true], [256, false]])
  test(`Mail consumer replaces stale parent values and rezeros child overlays (${count}, self=${self})`, () => {
    const state = stateFixture({ count, self, version: "mailbatch1" });
    const projection = produce(state);
    assert.equal(projection.batchModel, "canonical-work-batch-transfer-value-projection-v2");
    assert.equal(accepts(projection), true);
    const stale = structuredClone(state);
    Object.assign(stale.transferBatches[0], { creditLiveValueQ8: "999999999", creditLiveValueSats: "9.99999999",
      creditAmountMovedSubatoms: stale.transferBatches[0].totalAmountSubatoms,
      creditAmountMoved: stale.transferBatches[0].amount });
    for (const child of stale.transfers) Object.assign(child, {
      creditLiveValueQ8: "999999999", creditLiveValueSats: "9.99999999", creditAmountMoved: child.amount,
      creditAmountMovedSubatoms: child.amountSubatoms, minerFeeSats: 47, canonicalMinerFeeSats: 47, paidSats: 546,
    });
    const before = JSON.stringify(stale);
    const result = plain(api.tokenStateWithCanonicalWorkTransferValues(stale, projection));
    assert.equal(JSON.stringify(stale), before, "consumer must not mutate the original history");
    assert.equal(result.transferBatches.length, 1);
    assert.equal(result.transferBatches[0].creditLiveValueQ8, projection.transferBatches[0].creditLiveValueQ8);
    assert.equal(result.transferBatches[0].creditAmountMovedSubatoms, projection.transferBatches[0].creditAmountMovedSubatoms);
    assert.equal(result.transferBatches[0].amountSubatoms, state.transferBatches[0].totalAmountSubatoms);
    for (const child of result.transfers) {
      assert.equal(child.creditLiveValueQ8, "0");assert.equal(child.creditAmountMovedSubatoms, "0");
      assert.equal(child.minerFeeSats, 0);assert.equal(child.canonicalMinerFeeSats, 0);assert.equal(child.paidSats, 0);
    }
    assert.equal(accepts(produce(result)), true);
  });
test("Mail consumer never repairs from an unqualified or relabelled v2 family", () => {
  const state = stateFixture({ count: 1, version: "mailbatch1" });
  for (const mutate of [p => p.items.pop(), p => p.batchModel = "canonical-work-batch-transfer-value-projection-v1",
    p => p.transferBatches[0].mailEnvelope.recipients[0].vout++]) {
    const projection = produce(state);mutate(projection);
    assert.equal(api.tokenStateWithCanonicalWorkTransferValues(state, projection), state);
  }
});


function identifiedFamily(count, txByte, { pending = false, version = "batch1" } = {}) {
  const state = stateFixture({ count, self: false, version });
  for (const item of [...state.transferBatches, ...state.transfers]) {
    item.txid = txByte.repeat(32);
    if (item.derivedId) item.derivedId = item.txid + ":" + item.recordOrdinal;
    item.confirmed = !pending;
    if (pending) {
      item.blockHash = "";
      delete item.blockHeight; delete item.blockIndex;
      if (item.containerPosition) {
        item.containerPosition.blockHash = "";
        delete item.containerPosition.blockHeight;
        delete item.containerPosition.blockTransactionIndex;
      }
    }
  }
  return reconstructWithReader(state);
}

async function canonicalTableBoundary(payload, { fallback = false } = {}) {
  let fallbackCalls = 0;
  const boundary = vm.createContext({
    URLSearchParams, console,
    SUMMARY_EXACT_CHECKPOINT_PROOF_INDEX_READ_WAIT_MS: 100,
    SUMMARY_PROOF_INDEX_READ_WAIT_MS: 100,
    proofIndexReadFeatureEnabled: () => true,
    payloadWithFallbackAfterMs: promise => promise,
    proofIndexCanonicalSummaryTokenTablePayload: async () => fallback ? null : payload,
    proofIndexTokenPayload: async () => { fallbackCalls++; return payload; },
    rejectEmptyMainnetTokenPayload: () => false,
    proofIndexPayloadIndexedThroughBlock: value => value.indexedThroughBlock,
    payloadIndexedThroughBlockHash: value => value.indexedThroughBlockHash,
  });
  load(boundary, apiSource, ["currentProofIndexTokenTablePayloadForLedger"]);
  const result = await boundary.currentProofIndexTokenTablePayloadForLedger("livenet", "pending family fixture", {
    exactHeight: payload.indexedThroughBlock, exactHash: payload.indexedThroughBlockHash,
  });
  assert.equal(fallbackCalls, Number(fallback));
  return result;
}

for (const fallback of [false, true])
  test("canonical token-table boundary excludes 189 pending children before merging (fallback=" + fallback + ")", async () => {
    const confirmed = [identifiedFamily(12, "12"), identifiedFamily(7, "07")];
    const pending = identifiedFamily(189, "89", { pending: true });
    // The real reader intentionally returns pending wallet/history records. In
    // particular an absent child block hash differs from the raw parent's "".
    assert.equal(pending.transferBatches[0].blockHash, "");
    assert.equal(pending.transfers[0].blockHash, undefined);
    const table = {
      amountStorageModel: units.WORK_SUBATOM_PROJECTION_MODEL,
      indexedThroughBlock: 973_574, indexedThroughBlockHash: "cd".repeat(32),
      transfers: [...confirmed.flatMap(value => value.transfers), ...pending.transfers],
      transferBatches: [...confirmed.flatMap(value => value.transferBatches), ...pending.transferBatches],
    };
    const before = JSON.stringify(table);
    const canonical = await canonicalTableBoundary(table, { fallback });
    assert.equal(canonical.transfers.length, 19);
    assert.equal(canonical.transferBatches.length, 2);
    const merged = {
      ...canonical,
      transfers: api.mergeTokenStateItemsByKey([], canonical.transfers, api.tokenTransferHistoryItemKey, api.mergeTokenTransferRecord),
      transferBatches: api.mergeTokenStateItemsByKey([], canonical.transferBatches, api.tokenTransferHistoryItemKey, api.mergeCreditNetworkValueRecord),
    };
    assert.equal(api.economicTokenTransfersFromState(merged).length, 2);
    assert.equal(accepts(produce(merged)), true);
    assert.equal(JSON.stringify(table), before, "canonical view does not erase public pending visibility");
    assert.equal(table.transfers.filter(item => item.confirmed === false).length, 189);
    const corrupt = structuredClone(table);
    corrupt.transfers[0].minerFeeSats = 1;
    const corruptCanonical = await canonicalTableBoundary(corrupt, { fallback });
    assert.throws(() => api.economicTokenTransfersFromState(corruptCanonical), /differs from its economic parent/u);
  });

for (const version of ["batch1", "mailbatch1"])
  test("pending " + version + " history preserves all 189 children across repeated merges", () => {
    const pending = identifiedFamily(189, "89", { pending: true, version });
    const keys = pending.transfers.map(api.tokenTransferHistoryItemKey);
    assert.equal(new Set(keys).size, 189);
    const merged = api.mergeTokenStateItemsByKey(pending.transfers, pending.transfers,
      api.tokenTransferHistoryItemKey, api.mergeTokenTransferRecord);
    assert.equal(merged.length, 189);
    assert.deepEqual(Array.from(merged, item => item.recordOrdinal), Array.from({ length: 189 }, (_, i) => i + 1));
    assert.ok(merged.every(item => item.confirmed === false && item.paidSats === 0 && item.minerFeeSats === 0));
  });

test("pending batch history refuses malformed positions without changing legacy identities", () => {
  const child = identifiedFamily(2, "89", { pending: true }).transfers[0];
  for (const mutate of [
    value => { delete value.recordOrdinal; },
    value => { value.recordOrdinal = "1"; },
    value => { value.protocolVout = -1; },
    value => { value.containerPosition.protocolVout++; },
    value => { value.containerPosition.recordOrdinal = -1; },
    value => { value.batchRecipientIndex = value.batchRecipientCount; },
    value => { value.batchRecipientCount = 257; },
    value => { value.txid = "invalid"; },
  ]) {
    const invalid = structuredClone(child); mutate(invalid);
    assert.throws(() => api.tokenTransferHistoryItemKey(invalid), /Pending WORK batch recipient position/u);
  }
  const legacy = { tokenId: "legacy", txid: "legacy-tx", confirmed: false, protocolVout: 3, recordOrdinal: 9 };
  assert.equal(api.tokenTransferHistoryItemKey(legacy), "legacy:legacy-tx:event:3");
});
