import { assertNoSealedWorkBatchAuthority } from "../server/db/work-batch-reader.mjs";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { isDeepStrictEqual } from "node:util";
import vm from "node:vm";
import test from "node:test";
import * as bitcoin from "bitcoinjs-lib";
import {
  createOwnerOutputCommitmentFixture,
  signOwnerOutputCommitmentPsbt,
} from "../tests/fixtures/ownerOutputCommitment.mjs";
import { buildWorkBatchPayload, parseWorkBatchPayload } from "../src/shared/protocol/workBatch.mjs";
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
import { validateWorkBatchV1RawTransaction, validateWorkBatchV1PendingDecision } from "../server/work-batch-transaction.mjs";
import {
  WORK_BATCH_ACTIVATION_META_KEY, WORK_BATCH_DECLARATION_COMMITMENT_MODEL, WORK_BATCH_MIN_DECLARATION_BLOCK_HEIGHT,
  normalizeWorkBatchDeclarationPins, validateWorkBatchActivationMarker, workBatchActivationMarkerFromTransition,
  WORK_BATCH_DECLARATION_ORDER_COMPATIBILITY, workBatchDeclarationPaymentOrderValid,
} from "../server/work-batch-declaration.mjs";

const ACTOR = createOwnerOutputCommitmentFixture().ownerAddress;
const REGISTRY = WORK_AMO_V5_DECLARATION_REGISTRY_ADDRESS;
const HEIGHT = 1_200_000;
const PRIOR_HASH = "21".repeat(32);
const FEE = 47;
const OPENING_VALUE = 2_100_000_000_000_000n;
const MOVEMENT_DENOMINATOR = 21_000_000n * 10_000_000_000_000_000n;
const SUPPLY = 21_000_000n * 10_000_000_000_000_000n;
const sha256d = (bytes) => createHash("sha256").update(createHash("sha256").update(bytes).digest()).digest();
const script = (address) => bitcoin.address.toOutputScript(address, bitcoin.networks.bitcoin);
const carrier = (message) => bitcoin.script.compile([bitcoin.opcodes.OP_RETURN, Buffer.from(message)]);
const recipients = (count = 2, amount = "50000001") => Array.from({ length: count }, (_, index) => ({
  recipientAddress: bitcoin.payments.p2wpkh({
    hash: createHash("sha256").update(`work-batch-raw-recipient:${index}`).digest().subarray(0, 20),
  }).address,
  amountSubatoms: amount,
}));
const BATCH = buildWorkBatchPayload(recipients());
const ACTIVE = {
  canonical: true,
  confirmed: true,
  evidenceComplete: true,
  activationHeight: HEIGHT,
  declaration: { txid: "31".repeat(32), blockHash: PRIOR_HASH, blockHeight: HEIGHT - 1,
    blockTransactionIndex: 1, protocolVout: 1, recordOrdinal: 0, registryPaymentVout: 0 },
  evidenceCommitment: { model: "work-batch-v1-synthetic-evidence", payloadBytes: 1, sha256: "32".repeat(32) },
};

function hydrated(transaction, prevouts = []) {
  return {
    txid: transaction.getId(),
    hex: transaction.toHex(),
    vin: transaction.ins.map((input, index) => ({
      ...(bitcoin.Transaction.isCoinbaseHash(input.hash)
        ? { coinbase: Buffer.from(input.script).toString("hex") }
        : {
            txid: Buffer.from(input.hash).reverse().toString("hex"),
            vout: input.index,
            scriptsig: Buffer.from(input.script).toString("hex"),
            sequence: input.sequence,
            prevout: prevouts[index],
          }),
    })),
    vout: transaction.outs.map((output) => ({
      scriptpubkey: Buffer.from(output.script).toString("hex"),
      value: output.value.toString(),
    })),
  };
}

function transaction({ message = BATCH, registryPayments = [546], extraOutputs = [], hashType = 1,
  carrierFirst = false, carrierValue = 0, change = true, inputCount = 1 } = {}) {
  const funding = new bitcoin.Transaction();
  funding.addInput(Buffer.alloc(32), 0xffffffff, 0xffffffff, Buffer.from("00", "hex"));
  for (let index = 0; index < inputCount; index += 1) funding.addOutput(script(ACTOR), 100_000n);
  const psbt = new bitcoin.Psbt();
  for (let index = 0; index < inputCount; index += 1) {
    psbt.addInput({ hash: funding.getId(), index, nonWitnessUtxo: funding.toBuffer(), sequence: 0xfffffffd });
  }
  const registry = registryPayments.map(value => ({ script: script(REGISTRY), value: BigInt(value) }));
  const opReturn = { script: carrier(message), value: BigInt(carrierValue) };
  const outputs = [
    ...(carrierFirst ? [opReturn, ...registry] : [...registry, opReturn]),
    ...extraOutputs.map(output => ({ script: output.script, value: BigInt(output.value ?? 0) })),
  ];
  const spent = outputs.reduce((total, output) => total + output.value, 0n);
  if (change) outputs.push({ script: script(ACTOR), value: BigInt(inputCount) * 100_000n - spent - BigInt(FEE) });
  outputs.forEach(output => psbt.addOutput(output));
  const signed = bitcoin.Psbt.fromHex(signOwnerOutputCommitmentPsbt(psbt.toHex(), { hashType })).extractTransaction();
  const prevout = { scriptpubkey: Buffer.from(script(ACTOR)).toString("hex"), value: "100000" };
  const result = hydrated(signed, Array.from({ length: inputCount }, () => prevout));
  result.feeSats = (BigInt(inputCount) * 100_000n - signed.outs.reduce((total, output) => total + output.value, 0n)).toString();
  return result;
}

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

function replay(transactions, { height = HEIGHT, amount, workBatchV1 = ACTIVE, ...overrides } = {}) {
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
    workAmoV8: { activationHeight: HEIGHT - 100 }, workBatchV1, ...overrides,
  });
}

function assertInvalidBatch(result, reason, { allowSiblingEffects = false } = {}) {
  const batch = result.events.find(event => event.semanticKind === "token-transfer-batch") ?? result.events[0];
  assert.equal(batch.valid, false);
  if (reason) assert.equal(batch.reasonCode, reason);
  assert.equal(batch.derived.length, 0);
  assert.deepEqual(batch.stateDelta.baseContributions, []);
  assert.equal(result.economicState.movements.filter(row => row.identity.startsWith("batch-transfer:")).length, 0);
  if (!allowSiblingEffects) {
    assert.equal(result.economicState.movements.length, 0);
    assert.equal(result.workState.holders.length, 1);
    assert.equal(result.workState.holders[0].address, ACTOR);
  }
  return batch;
}

test("batch freezes one aggregate movement, applies all Q16 recipients and charges both fees once", () => {
  const result = replay([transaction()]);
  const event = result.events[0];
  assert.equal(event.valid, true);
  assert.equal(event.semanticKind, "token-transfer-batch");
  assert.equal(result.protocolRecordCount, 1);
  assert.equal(result.derivedEventCount, 2);
  assert.equal(result.economicState.movements.length, 1);
  const total = 100_000_002n;
  assert.equal(result.economicState.movements[0].amountSubatoms, total.toString());
  assert.equal(result.economicState.creditMovementFrozenValueQ8, (total * OPENING_VALUE / MOVEMENT_DENOMINATOR).toString());
  assert.notEqual(total * OPENING_VALUE / MOVEMENT_DENOMINATOR, 2n * (50_000_001n * OPENING_VALUE / MOVEMENT_DENOMINATOR), "fixture distinguishes aggregate rounding from per-recipient rounding");
  assert.equal(result.economicState.baseState.tokenTransferFlowSats, "546");
  assert.equal(result.economicState.creditFixedQ8, (BigInt(546 + FEE) * 100_000_000n).toString());
  assert.equal(result.feeTransitions.length, 1);
  assert.equal(result.feeTransitions[0].transactionMinerFeeSats, String(FEE));
  assert.equal(event.stateDelta.economicOutputs.length, 1);
  assert.equal(event.stateDelta.economicOutputs[0].attributedSats, "546");
  assert.equal(event.output.batchRegistryPaymentSats, 546);
  const balances = new Map(result.workState.holders.map(row => [row.address, BigInt(row.balanceSubatoms)]));
  assert.equal(balances.get(ACTOR), SUPPLY - total);
  for (const recipient of recipients()) assert.equal(balances.get(recipient.recipientAddress), 50_000_001n);
  assert.equal([...balances.values()].reduce((a, b) => a + b), SUPPLY);
  assert.equal(result.workState.confirmedSupplySubatoms, SUPPLY.toString());
  assert.deepEqual(result.workBatchV1.evidenceCommitment, ACTIVE.evidenceCommitment);
});

test("recipient projections are bound children, carry zero economic fees and cannot impersonate send3", () => {
  const result = replay([transaction()]);
  const event = result.events[0];
  const projection = projectWorkAmoV5RawEvents({}, result.events, result.workState);
  assert.equal(projection.transfers.length, 2);
  assert.equal(projection.transferBatches.length, 1);
  assert.equal(projection.transferBatches[0].paidSats, 546);
  assert.equal(projection.transferBatches[0].totalAmountSubatoms, event.parsed.totalAmountSubatoms);
  const next = projectWorkAmoV5RawEvents(projection, [], result.workState);
  assert.deepEqual(next.transferBatches, projection.transferBatches);
  assert.notEqual(next.transferBatches, projection.transferBatches);
  assert.equal(projectWorkAmoV5RawEvents(projection, result.events, result.workState).transferBatches.length, 1);
  assert.deepEqual(projection.transfers.map(row => row.recordOrdinal), [1, 2]);
  for (const [index, child] of event.derived.entries()) {
    assert.equal(child.rawCandidate, false);
    assert.equal(child.economicDelta, false);
    assert.equal(child.claimsEconomicOutputs, false);
    assert.equal(child.chargesTransactionFee, false);
    assert.equal(child.paidSats, 0);
    assert.equal(child.registryMutationFeeSats, 0);
    assert.equal(child.batchRegistryPaymentSats, undefined);
    assert.equal(child.transferVersion, "batch1");
    assert.equal(child.amountVersion, "batch1");
    assert.equal(child.batchRecipientIndex, index);
    assert.deepEqual(child.containerPosition, event.position);
    assert.deepEqual(child.parentTransitionChainCommitmentAfter, event.transitionChainCommitmentAfter);
    assert.equal(projection.transfers[index].derivedId, child.derivedId);
    assert.equal(projection.transfers[index].minerFeeSats, 0);
    assert.equal(projection.transfers[index].dataBytes, 0);
  }
  assert.deepEqual(replay([transaction()]).transitionChainCommitment, result.transitionChainCommitment);
});

test("declaration is required, activates at D+1 and reads do not depend on the write gate", () => {
  const tx = transaction();
  assertInvalidBatch(replay([tx], { workBatchV1: null }), "work-amo-v5-raw-pwt-record-invalid");
  assertInvalidBatch(replay([tx], { height: HEIGHT - 1 }), "work-amo-v5-raw-pwt-record-invalid");
  for (const field of ["canonical", "confirmed", "evidenceComplete"]) {
    assertInvalidBatch(replay([tx], { workBatchV1: { ...ACTIVE, [field]: false } }), "work-amo-v5-raw-pwt-record-invalid");
  }
  assertInvalidBatch(replay([tx], { workBatchV1: { ...ACTIVE, evidenceCommitment: null } }), "work-amo-v5-raw-pwt-record-invalid");
  for (const field of ["blockTransactionIndex", "protocolVout", "recordOrdinal", "registryPaymentVout"]) {
    assertInvalidBatch(replay([tx], { workBatchV1: { ...ACTIVE,
      declaration: { ...ACTIVE.declaration, [field]: undefined } } }), "work-amo-v5-raw-pwt-record-invalid");
  }
  assertInvalidBatch(replay([tx], { workBatchV1: { ...ACTIVE, activationHeight: HEIGHT - 1 } }), "work-amo-v5-raw-pwt-record-invalid");
  const active = replay([tx], { workBatchV1: { ...ACTIVE, writesEnabled: false } });
  assert.equal(active.events[0].valid, true);
  const changedAuthority = replay([tx], { workBatchV1: { ...ACTIVE, evidenceCommitment: { ...ACTIVE.evidenceCommitment, sha256: "33".repeat(32) } } });
  assert.notDeepEqual(changedAuthority.transitionChainCommitment, active.transitionChainCommitment);
  assert.deepEqual(changedAuthority.tokenStateCommitment, active.tokenStateCommitment);
});

test("pre-activation batch-looking history retains the exact legacy invalid event and transition commitment", () => {
  const tx = transaction();
  const absent = replay([tx], { workBatchV1: null, height: HEIGHT - 1 });
  const declaredFuture = replay([tx], { height: HEIGHT - 1 });
  assert.equal(absent.events[0].semanticKind, "token-event-invalid");
  assert.equal(absent.events[0].reasonCode, "work-amo-v5-raw-pwt-record-invalid");
  assert.equal(absent.events[0].parsed, null);
  assert.equal(absent.workBatchV1, undefined);
  assert.deepEqual(declaredFuture.transitionChainCommitment, absent.transitionChainCommitment);
  assert.deepEqual(declaredFuture.events, absent.events);
});

test("batch balance rejection is atomic even when an initial recipient could be paid", () => {
  const result = replay([transaction()], { amount: "50000001" });
  assertInvalidBatch(result, "work-batch-v1-insufficient-spendable-balance");
  assert.equal(result.workState.holders[0].balanceSubatoms, "50000001");
  assert.equal(result.economicState.creditFixedQ8, "0");
  assert.equal(result.feeTransitions[0].valid, false);
  const own = buildWorkBatchPayload([{ recipientAddress: ACTOR, amountSubatoms: "5" }, { ...recipients(1)[0], amountSubatoms: "1" }]);
  assertInvalidBatch(replay([transaction({ message: own })], { amount: "5" }), "work-batch-v1-insufficient-spendable-balance");
  const funded = replay([transaction({ message: own })], { amount: "6" });
  assert.equal(funded.events[0].valid, true);
  assert.equal(funded.workState.holders.find(row => row.address === ACTOR).balanceSubatoms, "5");
});

test("standalone shape requires one exact fee before a sole zero-value carrier", () => {
  for (const options of [
    { registryPayments: [] }, { registryPayments: [545] }, { registryPayments: [547] },
    { registryPayments: [1092] }, { registryPayments: [546, 546] },
    { carrierFirst: true }, { carrierValue: 1 },
    { extraOutputs: [{ script: script(recipients(1)[0].recipientAddress), value: 546 }] },
    { extraOutputs: [{ script: carrier("unknown:extra") }] },
    { extraOutputs: [{ script: carrier("pwm1:m:mail") }] },
    { extraOutputs: [{ script: carrier(BATCH) }] },
    { extraOutputs: [{ script: carrier(`pwt1:send3:${WORK_TOKEN_ID}:1:${ACTOR}`) }] },
  ]) {
    assertInvalidBatch(replay([transaction(options)]), "work-batch-v1-transaction-shape-invalid", { allowSiblingEffects: true });
  }
});

test("batch uses exact owner output commitment evidence and rejects output-unbound signatures", () => {
  for (const hashType of [bitcoin.Transaction.SIGHASH_NONE, bitcoin.Transaction.SIGHASH_SINGLE,
    bitcoin.Transaction.SIGHASH_ALL | bitcoin.Transaction.SIGHASH_ANYONECANPAY]) {
    assertInvalidBatch(replay([transaction({ hashType })]), "owner-output-commitment-sighash-policy-invalid");
  }
  assert.equal(replay([transaction({ inputCount: 2 })]).events[0].valid, true);
  const tampered = transaction();
  const raw = bitcoin.Transaction.fromHex(tampered.hex);
  raw.ins[0].script[4] ^= 1;
  const invalidSignature = { ...hydrated(raw, tampered.vin.map(input => input.prevout)), feeSats: tampered.feeSats };
  assertInvalidBatch(replay([invalidSignature]), "owner-output-commitment-signature-invalid");
  const forgedOutput = transaction();
  forgedOutput.vout.at(-1).value = "1";
  assert.equal(validateWorkBatchV1RawTransaction({ transaction: forgedOutput, protocolVout: 1 }).reasonCode,
    "work-batch-v1-raw-output-witness-mismatch");
});

test("self-recipient balances conserve but only non-self WORK contributes aggregate frozen and live movement", () => {
  const rows = [{ recipientAddress: ACTOR, amountSubatoms: "99999999999999999999" },
    { ...recipients(1)[0], amountSubatoms: "100000002" }];
  const result = replay([transaction({ message: buildWorkBatchPayload(rows) })]);
  assert.equal(result.events[0].valid, true);
  assert.equal(result.economicState.movements.length, 1);
  assert.equal(result.economicState.movements[0].amountSubatoms, "100000002");
  assert.equal(result.events[0].output.movementAmountSubatoms, "100000002");
  assert.equal(result.economicState.creditMovementFrozenValueQ8, (100_000_002n * OPENING_VALUE / MOVEMENT_DENOMINATOR).toString());
  const nonSelf = replay([transaction({ message: buildWorkBatchPayload(recipients()) })]);
  assert.equal(result.economicState.networkValueQ8, nonSelf.economicState.networkValueQ8,
    "adding a self-recipient cannot create a second live or frozen movement value");
  assert.equal(result.workState.holders.find(row => row.address === ACTOR).balanceSubatoms, (SUPPLY - 100_000_002n).toString());
});

test("legacy send3 remains valid without batch authority and keeps its single transfer accounting", () => {
  const result = replay([transaction({ message: `pwt1:send3:${WORK_TOKEN_ID}:1:${recipients(1)[0].recipientAddress}` })], { workBatchV1: null });
  assert.equal(result.events[0].valid, true);
  assert.equal(result.events[0].semanticKind, "token-transfer");
  assert.equal(result.events[0].parsed.amountVersion, "send3");
  assert.equal(result.derivedEventCount, 0);
  assert.equal(projectWorkAmoV5RawEvents({}, result.events, result.workState).transferBatches, undefined);
  assert.equal(result.economicState.baseState.tokenTransferFlowSats, "546");
});

test("78 recipient batch has one source record, one registry payment and exact conserved ownership", () => {
  const rows = recipients(78, "10000000000000000");
  const result = replay([transaction({ message: buildWorkBatchPayload(rows) })]);
  assert.equal(result.events.length, 1);
  assert.equal(result.events[0].valid, true);
  assert.equal(result.derivedEventCount, 78);
  assert.equal(result.economicState.movements.length, 1);
  assert.equal(result.economicState.baseState.tokenTransferFlowSats, "546");
  const projected = projectWorkAmoV5RawEvents({}, result.events, result.workState);
  assert.equal(projected.transfers.length, 78);
  assert.equal(new Set(projected.transfers.map(row => row.derivedId)).size, 78);
  assert.equal(projected.transfers.reduce((sum, row) => sum + BigInt(row.amountSubatoms), 0n), 780_000_000_000_000_000n);
  assert.equal(result.workState.holders.reduce((sum, row) => sum + BigInt(row.balanceSubatoms), 0n), SUPPLY);
});

function pendingBatchFunctions() {
  const source = readFileSync(new URL("../server/proof-api.mjs", import.meta.url), "utf8");
  const names = ["workBatchReadContextActive", "workBatchProjectionRecords", "pendingWorkVerifierStageReplayState",
    "pendingWorkVerifierStageCanonicalItem"];
  const definitions = names.map(name => {
    const start = new RegExp(`^function ${name}\\(`, "m").exec(source).index;
    const next = /\n(?:async )?function \w+\(/u.exec(source.slice(start + 1));
    return source.slice(start, next ? start + 1 + next.index : source.length);
  }).join("\n");
  const context = vm.createContext({
    WORK_TOKEN_ID, WORK_SUBATOM_PROJECTION_MODEL, WORK_TOKEN_DEFAULT_REGISTRY_ADDRESS: REGISTRY,
    WORK_TOKEN_TICKER: "WORK", TOKEN_MIN_MUTATION_PRICE_SATS: 546,
    canonicalRawProtocolRecordSetFromTransaction, validateWorkBatchV1RawTransaction,
    parseTokenPayload: payload => parseWorkBatchPayload(payload),
    workAmoV5CanonicalPayloadCommitment, workBatchDeclarationPaymentOrderValid, isDeepStrictEqual,
    transactionTxid: tx => tx.txid, transactionConfirmed: tx => tx.status?.confirmed === true,
    transactionBlockHash: tx => tx.status?.block_hash, transactionBlockHeight: tx => tx.status?.block_height,
    transactionBlockIndex: tx => tx._powBlockIndex, tokenTransactionTime: () => 1_700_000_000_000,
    transactionMinerFeeSats: tx => Number(tx.feeSats), proofProtocolDataBytesForVout: () => 1,
    workAmountFieldsFromSubatoms: value => ({ amountSubatoms: String(value), amountStorageModel: WORK_SUBATOM_PROJECTION_MODEL }),
    workBalanceFieldsFromSubatoms: value => ({ balanceSubatoms: String(value), amountStorageModel: WORK_SUBATOM_PROJECTION_MODEL }),
    formatWorkSubatoms: value => String(value), tokenListingIsExpired: () => false,
    pendingWorkVerifierStageCanonicalIso: value => ({ value }),
    pendingWorkVerifierStageStableDecisionItem: item => item,
    pendingWorkVerifierStageJsonClone: value => JSON.parse(JSON.stringify(value)),
    pendingWorkVerifierStageError: (code, message) => Object.assign(new Error(message), { code }),
  });
  return new vm.Script(`${definitions}\n({${names.join(",")}})`).runInContext(context);
}

test("pending batch replay is atomic, declaration bound, idempotent and isolated from confirmed state", () => {
  const { pendingWorkVerifierStageReplayState: stage } = pendingBatchFunctions();
  const state = { amountStorageModel: WORK_SUBATOM_PROJECTION_MODEL, coverageHeight: HEIGHT,
    holders: [{ address: ACTOR, tokenId: WORK_TOKEN_ID, balanceSubatoms: "200000004" }], listings: [], transfers: [] };
  const tx = transaction();
  assert.equal(stage(state, tx, "livenet", null), state);
  const result = stage(state, tx, "livenet", ACTIVE);
  assert.equal(state.holders[0].balanceSubatoms, "200000004");
  assert.equal(result.holders.find(row => row.address === ACTOR).balanceSubatoms, "100000002");
  assert.equal(result.transferBatches.length, 1);
  assert.equal(result.transfers.length, 2);
  assert.equal(result.transferBatches[0].paidSats, 546);
  assert.ok(result.transfers.every(row => row.paidSats === 0 && row.confirmed === false));
  assert.equal(stage(result, tx, "livenet", ACTIVE), result);
  const tooMuch = transaction({ message: buildWorkBatchPayload(recipients(2, "50000002")) });
  assert.equal(stage(result, tooMuch, "livenet", ACTIVE), result);
});

test("pending recipient decisions require their exact parent carrier and zero-fee derived semantics", () => {
  const { pendingWorkVerifierStageReplayState: stage, pendingWorkVerifierStageCanonicalItem: canonical } = pendingBatchFunctions();
  const tx = transaction();
  const state = stage({ amountStorageModel: WORK_SUBATOM_PROJECTION_MODEL, coverageHeight: HEIGHT,
    holders: [{ address: ACTOR, tokenId: WORK_TOKEN_ID, balanceSubatoms: "200000004" }], listings: [], transfers: [] }, tx, "livenet", ACTIVE);
  const records = canonicalRawProtocolRecordSetFromTransaction(tx).records;
  const child = { ...state.transfers[0], valid: true };
  assert.equal(canonical(child, tx.txid, records, "2026-10-24T00:00:00.000Z").recordOrdinal, 1);
  for (const mutation of [{ amountSubatoms: "1" }, { recipientAddress: ACTOR }, { paidSats: 546 },
    { economicDelta: true }, { batchRecipientIndex: 1 }, { batchPayloadCommitment: null }]) {
    assert.throws(() => canonical({ ...child, ...mutation }, tx.txid, records, "2026-10-24T00:00:00.000Z"),
      error => error.code === "PENDING_WORK_STAGE_DECISION_INVALID");
  }
});

test("pending persistence requires the complete exact parent and recipient set", () => {
  const { pendingWorkVerifierStageReplayState: stage, pendingWorkVerifierStageCanonicalItem: canonical } = pendingBatchFunctions();
  const tx = transaction();
  const state = stage({ amountStorageModel: WORK_SUBATOM_PROJECTION_MODEL, coverageHeight: HEIGHT,
    holders: [{ address: ACTOR, tokenId: WORK_TOKEN_ID, balanceSubatoms: "200000004" }], listings: [], transfers: [] }, tx, "livenet", ACTIVE);
  const records = canonicalRawProtocolRecordSetFromTransaction(tx).records;
  const items = [...state.transferBatches, ...state.transfers].map(item =>
    canonical({ ...item, valid: true }, tx.txid, records, "2026-10-24T00:00:00.000Z"));
  const check = candidate => validateWorkBatchV1PendingDecision({ transaction: tx, items: candidate });
  assert.equal(check(items).valid, true);
  assert.equal(check(items.slice(0, -1)).valid, false);
  assert.equal(check([items[0], items[1], items[1]]).valid, false);
  assert.equal(check(items.slice(1)).valid, false);
  for (const mutation of [{ amountSubatoms: "1" }, { senderAddress: REGISTRY }, { paidSats: 546 },
    { economicDelta: true }, { amountStorageModel: "canonical-work-atoms-v1" }, { recordOrdinal: 0 }, { containerPosition: { protocolVout: 0, recordOrdinal: 0 } },
    { parentTransitionChainCommitmentAfter: {} }, { derivedId: "unbound" }]) {
    assert.equal(check([items[0], { ...items[1], ...mutation }, items[2]]).valid, false);
  }
  assert.equal(check([{ ...items[0], totalAmountSubatoms: "1" }, ...items.slice(1)]).valid, false);
  assert.equal(check([{ ...items[0], recipients: [] }, ...items.slice(1)]).valid, false);
  assert.equal(check([{ kind: "token-event-invalid", valid: false }]).applicable, false);
});


test("pending backfill binds every synthetic child to its sole freshly hydrated carrier", async () => {
  const { pendingWorkVerifierStageReplayState: stage, pendingWorkVerifierStageCanonicalItem: canonical } = pendingBatchFunctions();
  const tx = transaction();
  const state = stage({ amountStorageModel: WORK_SUBATOM_PROJECTION_MODEL, coverageHeight: HEIGHT,
    holders: [{ address: ACTOR, tokenId: WORK_TOKEN_ID, balanceSubatoms: "200000004" }], listings: [], transfers: [] }, tx, "livenet", ACTIVE);
  const records = canonicalRawProtocolRecordSetFromTransaction(tx).records;
  const items = [...state.transferBatches, ...state.transfers].map(item =>
    canonical({ ...item, valid: true }, tx.txid, records, "2026-10-24T00:00:00.000Z"));
  const source = readFileSync(new URL("./backfill-proof-indexer.mjs", import.meta.url), "utf8");
  const start = source.indexOf("async function preparedWorkQ16PendingStageDecisions(");
  const end = source.indexOf("\nasync function clearWorkQ16PendingStageDecision(", start);
  assert.ok(start >= 0 && end > start);
  const context = vm.createContext({
    boundedMapWithConcurrency: (values, _concurrency, callback) => Promise.all(values.map(callback)),
    freshRawTransactionFromCore: async txid => txid === tx.txid ? tx : null,
    transactionHasConfirmedBlockEvidence: () => false,
    transactionWithInputPrevouts: async value => value,
    canonicalRawProtocolRecordSetFromTransaction, validateWorkBatchV1PendingDecision,
    assertWorkQ16PendingStatefulCompanionIsolation: () => {},
    protocolMessagesFromTx: () => records.map(record => ({ prefix: "pwt1:", text: record.message })),
    assertWorkQ16PendingCompanionCoverage: () => {},
    pendingWorkMintAttemptCount: () => 0,
    sourceLabelForProtocolItem: item => item.kind === "token-transfer-batch" ? "token-transfer-batches" : "token-transfers",
    pendingWorkMintDecision: () => null,
    pendingTransactionWriteItem: () => null,
    pendingProtocolTransactionObservation: txid => ({ txid }),
  });
  const prepare = new vm.Script(`${source.slice(start, end)}\npreparedWorkQ16PendingStageDecisions`).runInContext(context);
  const result = await prepare({ decisions: [{ txid: tx.txid, items }] });
  assert.equal(result.length, 1);
  assert.equal(result[0].prepared.length, 3);
  assert.equal(result[0].prepared[0].sourceLabel, "token-transfer-batches");
  assert.equal(result[0].prepared[2].item.recordOrdinal, 2);
  for (const invalidItems of [items.slice(0, -1), [items[0], items[1], items[1]],
    [items[0], { ...items[1], containerPosition: { protocolVout: 0, recordOrdinal: 0 } }, items[2]]]) {
    await assert.rejects(() => prepare({ decisions: [{ txid: tx.txid, items: invalidItems }] }),
      /complete signed carrier/u);
  }
});


test("canonical block persistence creates one immutable D+1 batch marker and rejects authority loss", async () => {
  const source = readFileSync(new URL("./backfill-proof-indexer.mjs", import.meta.url), "utf8");
  const start = source.indexOf("async function persistWorkBatchActivationMarker(");
  const end = source.indexOf("\nasync function persistWorkAmoV5BlockTransition(", start);
  assert.ok(start >= 0 && end > start);
  const persist = new vm.Script(`${source.slice(start, end)}\npersistWorkBatchActivationMarker`).runInContext(vm.createContext({
    NETWORK: "livenet", WORK_BATCH_ACTIVATION_META_KEY, assertNoSealedWorkBatchAuthority,
    normalizeWorkBatchDeclarationPins, validateWorkBatchActivationMarker, workBatchActivationMarkerFromTransition,
    workAmoV5CanonicalPayloadCommitment,
  }));
  const payload = { network: "livenet", complete: true, blockAtomic: true, feeOnce: true, invalidZero: true,
    blockHeight: HEIGHT, blockHash: "ab".repeat(32), previousBlockHash: PRIOR_HASH,
    transitionChainCommitment: { model: "canonical-work-amo-raw-transition-chain-sha256-v1", payloadBytes: 100, sha256: "cd".repeat(32) },
    workBatchV1: { ...ACTIVE, evidenceCommitment: { ...ACTIVE.evidenceCommitment, model: WORK_BATCH_DECLARATION_COMMITMENT_MODEL } } };
  const wrapper = value => ({ blockHeight: value.blockHeight, blockHash: value.blockHash,
    previousBlockHash: value.previousBlockHash, payload: value });
  const fakeClient = (initial = null, prior = []) => ({ saved: initial, inserts: 0, prior, async query(sql, params) {
    if (sql.includes("work_batch_missing_marker_sealed_head")) {
      assert.equal(params[0], "livenet");
      assert.ok(Number.isSafeInteger(params[1]));
      assert.match(sql, /transition.block_height < \$2/u);
      return { rows: this.prior.filter(row => row.block_height < params[1]) };
    }
    assert.equal(params[0], WORK_BATCH_ACTIVATION_META_KEY);
    if (sql.startsWith("INSERT")) { this.inserts++; this.saved ??= JSON.parse(params[1]); return { rows: [] }; }
    if (params.length === 2 && JSON.stringify(this.saved) !== params[1]) return { rows: [] };
    return { rows: this.saved ? [{ value: this.saved }] : [] };
  } });
  const client = fakeClient();
  assert.equal(await persist(client, wrapper({ ...payload, workBatchV1: undefined })), null);
  const marker = await persist(client, wrapper(payload));
  assert.equal(validateWorkBatchActivationMarker(marker).valid, true);
  assert.equal(client.inserts, 1);
  await persist(client, wrapper(payload));
  assert.equal(client.inserts, 1);
  const later = { ...payload, blockHeight: HEIGHT + 1, previousBlockHash: payload.blockHash, blockHash: "ef".repeat(32) };
  await persist(client, wrapper(later));
  await assert.rejects(() => persist(client, wrapper({ ...later, workBatchV1: undefined })), /omitted active/u);
  await assert.rejects(() => persist(fakeClient(), wrapper(later)), /missing after the exact D\+1/u);
  const priorSeal = { block_height: HEIGHT, block_hash: payload.blockHash,
    canonical_block_hash: payload.blockHash, complete: true, block_atomic: true, fee_once: true,
    invalid_zero: true, has_batch_context: true };
  const lost = fakeClient(null, [priorSeal]);
  await assert.rejects(() => persist(lost, wrapper({ ...later, workBatchV1: undefined })), /marker is missing/u);
  assert.equal(lost.inserts, 0);
  await assert.rejects(() => persist(fakeClient(null, [{ ...priorSeal, canonical_block_hash: null }]),
    wrapper({ ...later, workBatchV1: undefined })), /orphaned/u);
  assert.equal(await persist(fakeClient(null, [{ ...priorSeal, has_batch_context: false }]),
    wrapper({ ...later, workBatchV1: undefined })), null);

  await assert.rejects(() => persist(fakeClient({ ...marker, activationHeight: HEIGHT + 1 }), wrapper(later)), /malformed/u);
  const changed = { ...later, workBatchV1: { ...later.workBatchV1,
    evidenceCommitment: { ...later.workBatchV1.evidenceCommitment, sha256: "99".repeat(32) } } };
  await assert.rejects(() => persist(client, wrapper(changed)), /conflicts with immutable/u);
  await assert.rejects(() => persist(client, wrapper({ ...payload, blockHash: "88".repeat(32) })), /conflicts with immutable/u);
  const earlierAuthority = { ...payload, blockHeight: HEIGHT - 1, workBatchV1: { ...payload.workBatchV1,
    activationHeight: HEIGHT - 1, declaration: { ...ACTIVE.declaration, blockHeight: HEIGHT - 2 } } };
  await assert.rejects(() => persist(client, wrapper(earlierAuthority)), /conflicts with immutable/u);
  const transitionFunction = source.slice(end, source.indexOf("\nasync function advanceCodeDiscoveryCheckpoint(", end));
  assert.ok(transitionFunction.indexOf("await persistWorkBatchActivationMarker(client, transition)") >
    transitionFunction.indexOf("if (exact.rows.length !== 1)"), "marker must follow exact canonical transition persistence");
});


test("raw replay rejects declaration authority below the declared history floor", () => {
  const preFloor = { ...ACTIVE, activationHeight: WORK_BATCH_MIN_DECLARATION_BLOCK_HEIGHT,
    declaration: { ...ACTIVE.declaration, blockHeight: WORK_BATCH_MIN_DECLARATION_BLOCK_HEIGHT - 1 } };
  const result = replay([transaction()], { workBatchV1: preFloor });
  assertInvalidBatch(result, "work-amo-v5-raw-pwt-record-invalid");
  assert.equal(result.workBatchV1, undefined);
  const floor = { ...ACTIVE, activationHeight: WORK_BATCH_MIN_DECLARATION_BLOCK_HEIGHT + 1,
    declaration: { ...ACTIVE.declaration, blockHeight: WORK_BATCH_MIN_DECLARATION_BLOCK_HEIGHT } };
  assert.equal(replay([transaction()], { workBatchV1: floor }).events[0].valid, true);
});


test("bootstrap compatibility reaches confirmed replay and API admission but never changes batch payment order", () => {
  const context = { ...ACTIVE,
    declaration: { ...ACTIVE.declaration, ...WORK_BATCH_DECLARATION_ORDER_COMPATIBILITY } };
  const active = replay([transaction()], { workBatchV1: context });
  assert.equal(active.events[0].valid, true);
  assert.equal(active.economicState.baseState.tokenTransferFlowSats, "546");
  assert.equal(active.feeTransitions.length, 1);
  assert.deepEqual(active.workBatchV1.declaration, context.declaration);
  const { workBatchReadContextActive } = pendingBatchFunctions();
  assert.equal(workBatchReadContextActive(context, HEIGHT), true);
  assert.equal(workBatchReadContextActive(context, HEIGHT - 1), false);
  assertInvalidBatch(replay([transaction()], { workBatchV1: context, height: HEIGHT - 1 }));
  for (const mutation of [{ txid: "f".repeat(64) }, { protocolVout: 0 },
    { registryPaymentVout: 3 }, { recordOrdinal: 1 }]) {
    const invalid = { ...context, declaration: { ...context.declaration, ...mutation } };
    assert.equal(workBatchReadContextActive(invalid, HEIGHT), false);
    assertInvalidBatch(replay([transaction()], { workBatchV1: invalid }));
  }
  assertInvalidBatch(replay([transaction({ carrierFirst: true })], { workBatchV1: context }));
});
