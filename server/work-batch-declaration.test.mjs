import assert from "node:assert/strict";
import test from "node:test";
import { createHash } from "node:crypto";
import { address, networks, script } from "bitcoinjs-lib";
import {
  workBatchActivationMarkerFromTransition, validateWorkBatchActivationMarker,
  WORK_BATCH_MIN_DECLARATION_BLOCK_HEIGHT,
  WORK_BATCH_DECLARATION_AUTHORITY_SCRIPT_PUBKEY,
  WORK_BATCH_DECLARATION_REGISTRY_ADDRESS,
  buildWorkBatchDeclarationText, normalizeWorkBatchDeclarationPins,
  validateWorkBatchDeclarationEvidence, workBatchActivationFromEvidence,
  workBatchDeclarationCarrierEvidence, workBatchDeclarationCommitment,
  workBatchDeclarationEvidenceFromTransaction, workBatchDeclarationStatus,
} from "./work-batch-declaration.mjs";

const pins = {
  txid: "a".repeat(64), blockHeight: 1_000_000, blockHash: "b".repeat(64),
  blockTransactionIndex: 3, protocolVout: 1, recordOrdinal: 0,
  registryPaymentVout: 0, activationHeight: 1_000_001,
};
const carrier = (text) => ({ value: 0, scriptpubkey: Buffer.from(script.compile([106, Buffer.from(text)])).toString("hex") });
const transaction = () => ({
  txid: pins.txid, _powCanonicalRpcHydration: true, _powBlockIndex: pins.blockTransactionIndex,
  status: { confirmed: true, block_height: pins.blockHeight, block_hash: pins.blockHash },
  vin: [{ prevout: { scriptpubkey: WORK_BATCH_DECLARATION_AUTHORITY_SCRIPT_PUBKEY, value: 10000 } }],
  vout: [{ value: 546, scriptpubkey: Buffer.from(address.toOutputScript(WORK_BATCH_DECLARATION_REGISTRY_ADDRESS, networks.bitcoin)).toString("hex") }, carrier(workBatchDeclarationCommitment().protocolRecord)],
});
const evidence = () => workBatchDeclarationEvidenceFromTransaction(transaction(), pins, { canonical: true });

test("declaration text and protocol carrier have exact separate hash commitments", () => {
  const commitment = workBatchDeclarationCommitment();
  assert.equal(commitment.payloadBytes, 5958);
  assert.equal(commitment.payloadSha256, "c6ba8368dfec5312770946b358ce93040f4a27f8b1f6b970f99dee7962dbd793");
  assert.equal(commitment.protocolRecordBytes, 5965);
  assert.equal(commitment.protocolRecordSha256, "f1527f240dcc7210ef7bb5ebd33417fbecb1c8ea8dcc1b2bf2917f42b7e20ae4");
  assert.equal(commitment.text, buildWorkBatchDeclarationText());
  assert.equal(commitment.protocolRecord, `pwm1:m:${commitment.text}`);
  for (const [value, length, sha] of [[commitment.text, commitment.payloadBytes, commitment.payloadSha256], [commitment.protocolRecord, commitment.protocolRecordBytes, commitment.protocolRecordSha256]]) {
    assert.equal(Buffer.byteLength(value), length);
    assert.equal(createHash("sha256").update(value).digest("hex"), sha);
  }
});

test("empty, noncanonical, incomplete or wrong-position pins cannot activate", () => {
  assert.equal(normalizeWorkBatchDeclarationPins(), null);
  for (const mutation of [{ txid: "" }, { txid: "A".repeat(64) }, { blockHeight: "1000000" }, { blockHash: "" },
    { activationHeight: pins.blockHeight }, { recordOrdinal: 1 }, { registryPaymentVout: 1 },
    { payloadSha256: "c".repeat(64) }, { payloadBytes: 1 }, { authorityScriptPubKey: "00" }]) {
    assert.equal(normalizeWorkBatchDeclarationPins({ ...pins, ...mutation }), null);
  }
  assert.equal(workBatchActivationFromEvidence(evidence(), { indexedThroughBlock: pins.activationHeight }).active, false);
});

test("exact Core hydration, independently fenced canonical position and physical carrier are required", () => {
  const good = evidence();
  assert.equal(good.evidenceComplete, true);
  assert.equal(workBatchDeclarationEvidenceFromTransaction(transaction(), pins).evidenceComplete, false);
  for (const mutate of [
    tx => { tx._powCanonicalRpcHydration = false; }, tx => { tx.status.confirmed = false; },
    tx => { tx.status.block_hash = "c".repeat(64); }, tx => { tx._powBlockIndex += 1; },
    tx => { tx.vin[0].prevout.scriptpubkey = "00"; }, tx => { tx.vout[0].value = 545; },
    tx => { tx.vout.push(tx.vout[0]); }, tx => { tx.vout.push(tx.vout[1]); },
    tx => { tx.vout[1] = carrier(workBatchDeclarationCommitment().protocolRecord + "\n"); },
  ]) {
    const tx = transaction(); mutate(tx);
    assert.equal(workBatchDeclarationEvidenceFromTransaction(tx, pins, { canonical: true }).evidenceComplete, false);
  }
  assert.equal(workBatchDeclarationCarrierEvidence(transaction(), { protocolVout: 0, recordOrdinal: 0 }), null);
  assert.equal(validateWorkBatchDeclarationEvidence({ ...good, payloadSha256: "d".repeat(64) }, { expectedDeclaration: pins }).valid, false);
});

test("activation starts at D+1 and binds deterministic exact authority independently of writes", () => {
  const item = evidence();
  assert.equal(workBatchActivationFromEvidence(item, { expectedDeclaration: pins, indexedThroughBlock: pins.blockHeight }).active, false);
  const active = workBatchActivationFromEvidence(item, { expectedDeclaration: pins, indexedThroughBlock: pins.activationHeight });
  assert.equal(active.active, true);
  assert.deepEqual(active.evidenceCommitment, workBatchActivationFromEvidence(evidence(), { expectedDeclaration: pins, indexedThroughBlock: pins.activationHeight }).evidenceCommitment);
  assert.match(active.evidenceCommitment.sha256, /^[0-9a-f]{64}$/u);
  assert.ok(active.evidenceCommitment.payloadBytes > 0);
  const context = { evidence: item, expectedDeclaration: pins, indexedThroughBlock: pins.activationHeight };
  assert.equal(workBatchDeclarationStatus(context).active, true);
  assert.equal(workBatchDeclarationStatus(context).writesAllowed, false);
  assert.equal(workBatchDeclarationStatus({ ...context, writesEnabled: true, replayReady: true }).writesAllowed, false);
  assert.equal(workBatchDeclarationStatus({ ...context, writesEnabled: true, replayReady: true, exactTipReady: true }).writesAllowed, true);
  assert.equal(workBatchDeclarationStatus({ ...context, writesEnabled: "true", replayReady: true, exactTipReady: true }).writesAllowed, false);
});

test("persistent activation marker binds only the exact D+1 transition and rejects wrapper disagreement", () => {
  const context = workBatchActivationFromEvidence(evidence(), { expectedDeclaration: pins, indexedThroughBlock: pins.activationHeight });
  const transition = { network: "livenet", complete: true, blockAtomic: true, feeOnce: true, invalidZero: true,
    blockHeight: pins.activationHeight, blockHash: "e".repeat(64), previousBlockHash: pins.blockHash,
    transitionChainCommitment: { model: "canonical-work-amo-raw-transition-chain-sha256-v1", payloadBytes: 100, sha256: "f".repeat(64) },
    workBatchV1: context };
  const marker = workBatchActivationMarkerFromTransition(transition);
  assert.equal(validateWorkBatchActivationMarker(marker).valid, true);
  assert.deepEqual(workBatchActivationMarkerFromTransition({ blockHeight: transition.blockHeight, blockHash: transition.blockHash,
    previousBlockHash: transition.previousBlockHash, payload: transition }), marker);
  assert.throws(() => workBatchActivationMarkerFromTransition({ blockHeight: transition.blockHeight + 1, payload: transition }));
  assert.equal(workBatchActivationMarkerFromTransition({ ...transition, blockHeight: transition.blockHeight + 1 }), null);
  assert.throws(() => workBatchActivationMarkerFromTransition({ ...transition, complete: false }));
  for (const mutate of [
    value => { value.activationBlock.height++; },
    value => { value.activationBlock.previousBlockHash = "0".repeat(64); },
    value => { value.evidenceCommitment.sha256 = ""; },
    value => { value.declaration.recordOrdinal = 1; },
  ]) { const value = structuredClone(marker); mutate(value); assert.equal(validateWorkBatchActivationMarker(value).valid, false); }
});

test("only unpublished declarations at or after the fixed floor can establish authority", () => {
  const minimum = WORK_BATCH_MIN_DECLARATION_BLOCK_HEIGHT;
  assert.equal(minimum, 972965);
  assert.equal(normalizeWorkBatchDeclarationPins({ ...pins, blockHeight: minimum - 1,
    activationHeight: minimum }), null);
  assert.ok(normalizeWorkBatchDeclarationPins({ ...pins, blockHeight: minimum, activationHeight: minimum + 1 }));
  assert.match(buildWorkBatchDeclarationText(), /minimumDeclarationBlockHeight=972965/u);
  assert.match(buildWorkBatchDeclarationText(), /earliest exact valid declaration at or after minimumDeclarationBlockHeight/u);
});
