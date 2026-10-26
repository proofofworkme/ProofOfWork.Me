import assert from "node:assert/strict";
import test from "node:test";
import { createHash } from "node:crypto";
import { address, networks, script } from "bitcoinjs-lib";
import {
  workMailBatchActivationMarkerFromTransition, validateWorkMailBatchActivationMarker,
  WORK_MAIL_BATCH_MIN_DECLARATION_BLOCK_HEIGHT,
  WORK_MAIL_BATCH_DECLARATION_AUTHORITY_SCRIPT_PUBKEY,
  WORK_MAIL_BATCH_DECLARATION_REGISTRY_ADDRESS,
  buildWorkMailBatchDeclarationText, normalizeWorkMailBatchDeclarationPins,
  validateWorkMailBatchDeclarationEvidence, workMailBatchActivationFromEvidence,
  workMailBatchDeclarationCarrierEvidence, workMailBatchDeclarationCommitment,
  workMailBatchDeclarationEvidenceFromTransaction, workMailBatchDeclarationStatus,
} from "./work-mail-batch-declaration.mjs";

const pins = {
  txid: "a".repeat(64), blockHeight: 1_000_000, blockHash: "b".repeat(64),
  blockTransactionIndex: 3, protocolVout: 1, recordOrdinal: 0,
  registryPaymentVout: 0, activationHeight: 1_000_001,
};
const carrier = (text) => ({ value: 0, scriptpubkey: Buffer.from(script.compile([106, Buffer.from(text)])).toString("hex") });
const transaction = () => ({
  txid: pins.txid, _powCanonicalRpcHydration: true, _powBlockIndex: pins.blockTransactionIndex,
  status: { confirmed: true, block_height: pins.blockHeight, block_hash: pins.blockHash },
  vin: [{ prevout: { scriptpubkey: WORK_MAIL_BATCH_DECLARATION_AUTHORITY_SCRIPT_PUBKEY, value: 10000 } }],
  vout: [{ value: 546, scriptpubkey: Buffer.from(address.toOutputScript(WORK_MAIL_BATCH_DECLARATION_REGISTRY_ADDRESS, networks.bitcoin)).toString("hex") }, carrier(workMailBatchDeclarationCommitment().protocolRecord)],
});
const evidence = () => workMailBatchDeclarationEvidenceFromTransaction(transaction(), pins, { canonical: true });

test("declaration text and protocol carrier have exact separate hash commitments", () => {
  const commitment = workMailBatchDeclarationCommitment();
  assert.equal(commitment.payloadBytes, 6737);
  assert.equal(commitment.payloadSha256, "a0575735de14a55ff29a30d4f6dbdd49f33914e950dfc3b912242f5767be6edf");
  assert.equal(commitment.protocolRecordBytes, 6744);
  assert.equal(commitment.protocolRecordSha256, "8df01b4fbb1c4610923c7cf12ad43298b5c19e45a3853b75c42e7c0a46e77413");
  assert.equal(commitment.text, buildWorkMailBatchDeclarationText());
  assert.equal(commitment.protocolRecord, `pwm1:m:${commitment.text}`);
  for (const [value, length, sha] of [[commitment.text, commitment.payloadBytes, commitment.payloadSha256], [commitment.protocolRecord, commitment.protocolRecordBytes, commitment.protocolRecordSha256]]) {
    assert.equal(Buffer.byteLength(value), length);
    assert.equal(createHash("sha256").update(value).digest("hex"), sha);
  }
});

test("empty, noncanonical, incomplete or wrong-position pins cannot activate", () => {
  assert.equal(normalizeWorkMailBatchDeclarationPins(), null);
  for (const mutation of [{ txid: "" }, { txid: "A".repeat(64) }, { blockHeight: "1000000" }, { blockHash: "" },
    { activationHeight: pins.blockHeight }, { recordOrdinal: 1 }, { registryPaymentVout: 1 },
    { payloadSha256: "c".repeat(64) }, { payloadBytes: 1 }, { authorityScriptPubKey: "00" }]) {
    assert.equal(normalizeWorkMailBatchDeclarationPins({ ...pins, ...mutation }), null);
  }
  assert.equal(workMailBatchActivationFromEvidence(evidence(), { indexedThroughBlock: pins.activationHeight }).active, false);
});

test("exact Core hydration, independently fenced canonical position and physical carrier are required", () => {
  const good = evidence();
  assert.equal(good.evidenceComplete, true);
  assert.equal(workMailBatchDeclarationEvidenceFromTransaction(transaction(), pins).evidenceComplete, false);
  for (const mutate of [
    tx => { tx._powCanonicalRpcHydration = false; }, tx => { tx.status.confirmed = false; },
    tx => { tx.status.block_hash = "c".repeat(64); }, tx => { tx._powBlockIndex += 1; },
    tx => { tx.vin[0].prevout.scriptpubkey = "00"; }, tx => { tx.vout[0].value = 545; },
    tx => { tx.vout.push(tx.vout[0]); }, tx => { tx.vout.push(tx.vout[1]); },
    tx => { tx.vout[1] = carrier(workMailBatchDeclarationCommitment().protocolRecord + "\n"); },
  ]) {
    const tx = transaction(); mutate(tx);
    assert.equal(workMailBatchDeclarationEvidenceFromTransaction(tx, pins, { canonical: true }).evidenceComplete, false);
  }
  assert.equal(workMailBatchDeclarationCarrierEvidence(transaction(), { protocolVout: 0, recordOrdinal: 0 }), null);
  assert.equal(validateWorkMailBatchDeclarationEvidence({ ...good, payloadSha256: "d".repeat(64) }, { expectedDeclaration: pins }).valid, false);
});

test("activation starts at D+1 and binds deterministic exact authority independently of writes", () => {
  const item = evidence();
  assert.equal(workMailBatchActivationFromEvidence(item, { expectedDeclaration: pins, indexedThroughBlock: pins.blockHeight }).active, false);
  const active = workMailBatchActivationFromEvidence(item, { expectedDeclaration: pins, indexedThroughBlock: pins.activationHeight });
  assert.equal(active.active, true);
  assert.deepEqual(active.evidenceCommitment, workMailBatchActivationFromEvidence(evidence(), { expectedDeclaration: pins, indexedThroughBlock: pins.activationHeight }).evidenceCommitment);
  assert.match(active.evidenceCommitment.sha256, /^[0-9a-f]{64}$/u);
  assert.ok(active.evidenceCommitment.payloadBytes > 0);
  const context = { evidence: item, expectedDeclaration: pins, indexedThroughBlock: pins.activationHeight };
  assert.equal(workMailBatchDeclarationStatus(context).active, true);
  assert.equal(workMailBatchDeclarationStatus(context).writesAllowed, false);
  assert.equal(workMailBatchDeclarationStatus({ ...context, writesEnabled: true, replayReady: true }).writesAllowed, false);
  assert.equal(workMailBatchDeclarationStatus({ ...context, writesEnabled: true, replayReady: true, exactTipReady: true }).writesAllowed, true);
  assert.equal(workMailBatchDeclarationStatus({ ...context, writesEnabled: "true", replayReady: true, exactTipReady: true }).writesAllowed, false);
});

test("persistent activation marker binds only the exact D+1 transition and rejects wrapper disagreement", () => {
  const context = workMailBatchActivationFromEvidence(evidence(), { expectedDeclaration: pins, indexedThroughBlock: pins.activationHeight });
  const transition = { network: "livenet", complete: true, blockAtomic: true, feeOnce: true, invalidZero: true,
    blockHeight: pins.activationHeight, blockHash: "e".repeat(64), previousBlockHash: pins.blockHash,
    transitionChainCommitment: { model: "canonical-work-amo-raw-transition-chain-sha256-v1", payloadBytes: 100, sha256: "f".repeat(64) },
    workMailBatchV1: context };
  const marker = workMailBatchActivationMarkerFromTransition(transition);
  assert.equal(validateWorkMailBatchActivationMarker(marker).valid, true);
  assert.deepEqual(workMailBatchActivationMarkerFromTransition({ blockHeight: transition.blockHeight, blockHash: transition.blockHash,
    previousBlockHash: transition.previousBlockHash, payload: transition }), marker);
  assert.throws(() => workMailBatchActivationMarkerFromTransition({ blockHeight: transition.blockHeight + 1, payload: transition }));
  assert.equal(workMailBatchActivationMarkerFromTransition({ ...transition, blockHeight: transition.blockHeight + 1 }), null);
  assert.throws(() => workMailBatchActivationMarkerFromTransition({ ...transition, complete: false }));
  for (const mutate of [
    value => { value.activationBlock.height++; },
    value => { value.activationBlock.previousBlockHash = "0".repeat(64); },
    value => { value.evidenceCommitment.sha256 = ""; },
    value => { value.declaration.recordOrdinal = 1; },
  ]) { const value = structuredClone(marker); mutate(value); assert.equal(validateWorkMailBatchActivationMarker(value).valid, false); }
});

test("only unpublished declarations at or after the fixed floor can establish authority", () => {
  const minimum = WORK_MAIL_BATCH_MIN_DECLARATION_BLOCK_HEIGHT;
  assert.equal(minimum, 973283);
  assert.equal(normalizeWorkMailBatchDeclarationPins({ ...pins, blockHeight: minimum - 1,
    activationHeight: minimum }), null);
  assert.ok(normalizeWorkMailBatchDeclarationPins({ ...pins, blockHeight: minimum, activationHeight: minimum + 1 }));
  assert.match(buildWorkMailBatchDeclarationText(), /minimumDeclarationBlockHeight=973283/u);
  assert.match(buildWorkMailBatchDeclarationText(), /earliest exact valid declaration at or after minimumDeclarationBlockHeight/u);
});


test("declaration permits attached proofs and legacy WORK signal on either side of its unique carrier", () => {
  for (const after of [false, true]) {
    const tx = transaction();
    const payment = tx.vout[0], exact = tx.vout[1];
    tx.vout = [
      { value: 546, scriptpubkey: WORK_MAIL_BATCH_DECLARATION_AUTHORITY_SCRIPT_PUBKEY },
      ...(after ? [exact, payment] : [payment, exact]),
      carrier("pwt1:send3:d4e5ebf11d104d6a63fb74e42094364b25a5f7199a09e5c0e71408972466a8b8:10000:1F1p9UEHuH5KTFR7Zsx93Khdrqhj6t5nFv"),
    ];
    const selected = { ...pins, protocolVout: after ? 1 : 2, registryPaymentVout: after ? 2 : 1 };
    assert.equal(workMailBatchDeclarationEvidenceFromTransaction(tx, selected, { canonical: true }).evidenceComplete, true);
    tx.vout.push(payment);
    assert.equal(workMailBatchDeclarationEvidenceFromTransaction(tx, selected, { canonical: true }).evidenceComplete, false);
  }
});
