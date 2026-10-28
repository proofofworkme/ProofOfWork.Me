import assert from "node:assert/strict";
import test from "node:test";
import { ACTOR, REGISTRY, FEE, transaction, recipients } from "../tests/fixtures/workMailBatch.mjs";
import { projectWorkAmoV5RawEvents } from "../server/work-amo-v5-raw.mjs";
import { validateWorkMailBatchProjectionEvents } from "../server/db/work-mail-batch-reader.mjs";
import { replay, HEIGHT, SUPPLY, ACTIVE } from "../tests/fixtures/workMailBatchReplay.mjs";
const MOVEMENT_DENOMINATOR = 21_000_000n * 10_000_000_000_000_000n;


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


test("sole-self Mail is valid with zero movement, independent Mail proofs and one WORK registry fee", () => {
  const vector = [{ recipientAddress: ACTOR, amountSubatoms: "5" }];
  const result = replay([transaction({ vector })], { amount: "5" });
  const batch = attachmentEvent(result);
  assert.equal(batch.valid, true, batch.reasonCode);
  assert.deepEqual(result.workState.holders, [{ address: ACTOR, balanceSubatoms: "5" }]);
  assert.equal(batch.output.movementAmountSubatoms, "0");
  assert.equal(result.economicState.creditMovementFrozenValueQ8, "0");
  assert.equal(result.economicState.baseState.mailFlowSats, "546");
  assert.equal(result.economicState.baseState.tokenTransferFlowSats, "546");
  assert.equal(result.feeTransitions.length, 1);
  assert.equal(result.feeTransitions[0].transactionMinerFeeSats, String(FEE));
});
