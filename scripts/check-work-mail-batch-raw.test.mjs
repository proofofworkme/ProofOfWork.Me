import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import * as bitcoin from "bitcoinjs-lib";
import { ACTOR, REGISTRY, FEE, transaction, recipients, hydrated } from "../tests/fixtures/workMailBatch.mjs";
import { canonicalRawProtocolRecordSetFromTransaction } from "../server/canonical-op-return.mjs";
import {
  normalizeWorkAmoV5RawGenericState,
  normalizeWorkAmoV5RawIdState,
  normalizeWorkAmoV5RawWorkState,
  projectWorkAmoV5RawEvents,
  replayWorkAmoV5RawBlock,
  workAmoV5RawGenericStateCommitment,
  workAmoV5RawIdStateCommitment,
} from "../server/work-amo-v5-raw.mjs";
import {
  WORK_AMO_V5_BASE_STATE_FIELDS,
  WORK_AMO_V5_DECLARATION_REGISTRY_ADDRESS,
  WORK_AMO_V5_NETWORK_ACCUMULATOR_MODEL,
  workAmoV5CanonicalPayloadCommitment,
} from "../server/work-amo-v5.mjs";
import { workAmoV8CanonicalTokenStateCommitment } from "../server/work-amo-v8.mjs";
import { WORK_SUBATOM_PROJECTION_MODEL, WORK_TOKEN_ID } from "../server/work-units.mjs";
import { validateWorkMailBatchProjectionEvents } from "../server/db/work-mail-batch-reader.mjs";
import { WORK_MAIL_BATCH_DECLARATION_COMMITMENT_MODEL } from "../server/work-mail-batch-declaration.mjs";
const HEIGHT = 1_200_000;
const PRIOR_HASH = "21".repeat(32);
const OPENING_VALUE = 2_100_000_000_000_000n;
const MOVEMENT_DENOMINATOR = 21_000_000n * 10_000_000_000_000_000n;
const SUPPLY = 21_000_000n * 10_000_000_000_000_000n;
const sha256d = (bytes) => createHash("sha256").update(createHash("sha256").update(bytes).digest()).digest();
const ACTIVE = {
  canonical: true,
  confirmed: true,
  evidenceComplete: true,
  activationHeight: HEIGHT,
  declaration: { txid: "31".repeat(32), blockHash: PRIOR_HASH, blockHeight: HEIGHT - 1,
    blockTransactionIndex: 1, protocolVout: 1, recordOrdinal: 0, registryPaymentVout: 0 },
  evidenceCommitment: { model: WORK_MAIL_BATCH_DECLARATION_COMMITMENT_MODEL, payloadBytes: 1, sha256: "32".repeat(32) },
};

function block(transactions, height = HEIGHT) {
  const coinbase = new bitcoin.Transaction();
  coinbase.addInput(Buffer.alloc(32), 0xffffffff, 0xffffffff, Buffer.from("0401020304", "hex"));
  coinbase.addOutput(Buffer.from("51", "hex"), 0n);
  const blockTransactions = [hydrated(coinbase), ...transactions].map((tx, index) => ({ ...tx, _powBlockIndex: index }));
  let hashes = blockTransactions.map(tx => Buffer.from(tx.txid, "hex").reverse());
  while (hashes.length > 1) {
    if (hashes.length % 2) hashes.push(Buffer.from(hashes.at(-1)));
    hashes = Array.from({ length: hashes.length / 2 }, (_, index) => sha256d(Buffer.concat([hashes[index * 2], hashes[index * 2 + 1]])));
  }
  const header = Buffer.alloc(80);
  header.writeInt32LE(1, 0);
  Buffer.from(PRIOR_HASH, "hex").reverse().copy(header, 4);
  hashes[0].copy(header, 36);
  header.writeUInt32LE(1_700_000_000, 68);
  header.writeUInt32LE(0x1d00ffff, 72);
  return {
    blockTransactions,
    blockHeight: height,
    blockHash: Buffer.from(sha256d(header)).reverse().toString("hex"),
    blockHeaderHex: header.toString("hex"),
  };
}

function openingState(height, amount = SUPPLY.toString()) {
  const generic = normalizeWorkAmoV5RawGenericState({ holders: [], listings: [], tokens: [] });
  const ids = normalizeWorkAmoV5RawIdState({ records: [], listings: [] });
  const work = normalizeWorkAmoV5RawWorkState({
    amountStorageModel: WORK_SUBATOM_PROJECTION_MODEL,
    confirmedSupplySubatoms: amount,
    holders: [{ address: ACTOR, balanceSubatoms: amount }],
    listings: [],
  });
  return {
    openingGenericState: generic,
    openingIdState: ids,
    openingWorkState: work,
    openingEconomicState: {
      baseState: Object.fromEntries(WORK_AMO_V5_BASE_STATE_FIELDS.map(field => [field, field === "computerEventFlowSats" ? "4200000" : "0"])),
      creditFixedQ8: "0", creditMovementFrozenValueQ8: "0",
      genericTokenStateCommitment: workAmoV5RawGenericStateCommitment(generic),
      idStateCommitment: workAmoV5RawIdStateCommitment(ids),
      model: WORK_AMO_V5_NETWORK_ACCUMULATOR_MODEL, movements: [], network: "livenet",
      networkValueQ8: OPENING_VALUE.toString(), quoteHead: null,
      throughBlockHash: PRIOR_HASH, throughBlockHeight: height - 1,
      tokenStateCommitment: workAmoV8CanonicalTokenStateCommitment(work),
    },
  };
}

function replay(transactions, { height = HEIGHT, amount, workMailBatchV1 = ACTIVE, ...overrides } = {}) {
  const context = block(transactions, height);
  const records = context.blockTransactions.flatMap((tx, blockTransactionIndex) => {
    const reconstructed = canonicalRawProtocolRecordSetFromTransaction(tx);
    return reconstructed.records.map(record => ({
      ...record,
      tx, txid: tx.txid,
      position: { blockHash: context.blockHash, blockHeight: height, blockTransactionIndex,
        protocolVout: record.protocolVout, recordOrdinal: record.recordOrdinal },
      transactionMinerFeeSats: tx.feeSats,
      transactionProtocolRecordCount: reconstructed.records.length,
    }));
  });
  return replayWorkAmoV5RawBlock({
    blockHeaderHex: context.blockHeaderHex, blockTransactions: context.blockTransactions,
    expectedBlockHash: context.blockHash, expectedBlockHeight: height,
    expectedPreviousBlockHash: PRIOR_HASH, records, ...openingState(height, amount),
    workAmoV8: { activationHeight: HEIGHT - 100 }, workMailBatchV1, ...overrides,
  });
}


const attachmentEvent = result => result.events.find(event => event.protocol === "pwt1");
test("78 Mail attachments conserve WORK atomically, own one registry payment and preserve Mail proofs", () => {
  const vector = recipients(78), result = replay([transaction({ vector })]);
  const mail = result.events[0], batch = attachmentEvent(result);
  assert.equal(mail.valid, true); assert.equal(batch.valid, true, batch.reasonCode);
  assert.equal(result.protocolRecordCount, 2);
  assert.equal(result.derivedEventCount, 78);
  assert.equal(result.economicState.baseState.mailFlowSats, String(78 * 546));
  assert.equal(result.economicState.baseState.tokenTransferFlowSats, "546");
  assert.equal(result.feeTransitions.length, 1);
  assert.equal(result.feeTransitions[0].transactionMinerFeeSats, String(FEE));
  assert.equal(result.economicState.movements.length, 1);
  assert.equal(batch.output.mailEnvelope.recipients.length, 78);
  assert.equal(batch.stateDelta.economicOutputs.length, 1);
  assert.equal(batch.stateDelta.economicOutputs[0].vout, 79);
  const balances = new Map(result.workState.holders.map(row => [row.address, BigInt(row.balanceSubatoms)]));
  const total = BigInt(batch.parsed.totalAmountSubatoms);
  assert.equal(balances.get(ACTOR), SUPPLY - total);
  assert.equal([...balances.values()].reduce((a, b) => a + b), SUPPLY);
  const trace = [...result.outcomes.values()].find(row => row.parsed?.kind === "mail-batch");
  assert.equal(result.economicState.creditMovementFrozenValueQ8,
    (total * BigInt(trace.networkValueBeforeQ8) / MOVEMENT_DENOMINATOR).toString());
  const projected = projectWorkAmoV5RawEvents({}, result.events, result.workState);
  assert.equal(projected.transfers.length, 78); assert.equal(projected.transferBatches.length, 1);
  assert.equal(projected.transferBatches[0].transferVersion, "mailbatch1");
  for (const [index, child] of projected.transfers.entries()) {
    assert.equal(child.transferVersion, "mailbatch1"); assert.equal(child.batchRecipientIndex, index);
    for (const key of ["paidSats", "minerFeeSats", "dataBytes", "registryMutationFeeSats"]) assert.equal(child[key], 0);
    assert.equal(child.economicDelta, false); assert.equal(child.rawCandidate, false);
    assert.deepEqual(child.mailEnvelope, batch.output.mailEnvelope);
  }
  assert.deepEqual(replay([transaction({ vector })]).transitionChainCommitment, result.transitionChainCommitment);
});

test("WORK rejection leaves independently valid Mail and all WORK balances unchanged", () => {
  for (const tx of [transaction(), transaction({ fee: 545 }), transaction({ payments: recipients().reverse().map(row => ({ address: row.recipientAddress, value: 546 })) })]) {
    const result = replay([tx], { amount: "1" });
    assert.equal(result.events[0].valid, true);
    assert.equal(attachmentEvent(result).valid, false);
    assert.equal(attachmentEvent(result).derived.length, 0);
    assert.deepEqual(result.workState.holders, [{ address: ACTOR, balanceSubatoms: "1" }]);
    assert.equal(result.economicState.baseState.mailFlowSats, "1092");
    assert.equal(result.economicState.baseState.tokenTransferFlowSats, "0");
  }
});

test("self-recipient consumes opening capacity without creating a second movement", () => {
  const vector = [{ recipientAddress: ACTOR, amountSubatoms: "5" }, ...recipients(1, "5")];
  const tx = transaction({ vector });
  assert.equal(attachmentEvent(replay([tx], { amount: "5" })).valid, false);
  const result = replay([tx], { amount: "10" });
  assert.equal(attachmentEvent(result).valid, true);
  assert.equal(result.economicState.movements[0].amountSubatoms, "5");
});

test("new authority activates only at its D+1 and absent context retains legacy transition bytes", () => {
  const tx = transaction(), absent = replay([tx], { workMailBatchV1: null });
  assert.equal(attachmentEvent(absent).valid, false);
  assert.equal(attachmentEvent(absent).reasonCode, "work-amo-v5-raw-pwt-record-invalid");
  for (const bad of [ { ...ACTIVE, confirmed: false }, { ...ACTIVE, evidenceCommitment: { ...ACTIVE.evidenceCommitment, model: "wrong" } },
    { ...ACTIVE, activationHeight: HEIGHT + 1, declaration: { ...ACTIVE.declaration, blockHeight: HEIGHT } } ]) {
    assert.deepEqual(replay([tx], { workMailBatchV1: bad }).transitionChainCommitment, absent.transitionChainCommitment);
  }
  assert.equal(attachmentEvent(replay([tx], { workMailBatchV1: { ...ACTIVE, writesEnabled: false } })).valid, true);
  assert.equal(attachmentEvent(replay([tx], { height: HEIGHT - 1 })).valid, false);
});


test("actual raw native descriptors qualify the complete confirmed Mail attachment projection", () => {
  const tx = transaction({ vector: [{ recipientAddress: REGISTRY, amountSubatoms: "1" }, ...recipients(2)] });
  const result = replay([tx]);
  const native = result.records.map(record => {
    const event = result.events.find(event => event.txid === record.txid &&
      event.position.protocolVout === record.position.protocolVout && event.position.recordOrdinal === record.position.recordOrdinal);
    return { txid: record.txid, protocol: record.protocol, position: record.position, rawCandidate: true,
      output: event.output, rawWitness: record.payload, derived: event.derived,
      transitionChainCommitmentAfter: event.transitionChainCommitmentAfter,
      outcome: { valid: event.valid, kind: `${record.protocol}-valid`, semanticKind: event.semanticKind } };
  });
  const parentRecord = native.find(record => record.protocol === "pwt1");
  const mailRecord = native.find(record => record.protocol === "pwm1");
  const parent = { ...parentRecord.output.projection, confirmed: true, _workAmoV5ReplayBound: true,
    workAmoV5RawCandidate: true, payload: result.records.find(record => record.protocol === "pwt1").message,
    workAmoV5ReplayOutput: parentRecord.output };
  const children = parentRecord.derived.map(descriptor => ({ ...descriptor, txid: tx.txid,
    protocol: "pwt1", valid: true, confirmed: true, derived: true, position: descriptor.projectionPosition,
    _workAmoV5ReplayBound: true, workAmoV5RawCandidate: false,
    workAmoV5ReplayOutcome: { kind: "pwt1-valid", valid: true },
    workAmoV5ReplayRawWitness: { model: "canonical-work-amo-v5-derived-child-v1", descriptor,
      parentPosition: parentRecord.position, parentProtocol: "pwt1" } }));
  const evidence = { transaction: tx, parent, children, parentRecord, mailRecord, activationContext: result.workMailBatchV1 };
  assert.equal(validateWorkMailBatchProjectionEvents(evidence).valid, true);
  assert.equal(result.economicState.baseState.mailFlowSats, "1638", "ordinary registry-address recipient is still a Mail payment");
  assert.equal(result.economicState.baseState.tokenTransferFlowSats, "546");
  const forged = structuredClone(evidence); forged.children[0].amountSubatoms = "2";
  assert.equal(validateWorkMailBatchProjectionEvents(forged).valid, false);
});
