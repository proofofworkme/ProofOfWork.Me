import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";
import * as bitcoin from "bitcoinjs-lib";
import { createOwnerOutputCommitmentFixture, signOwnerOutputCommitmentPsbt } from "../../../tests/fixtures/ownerOutputCommitment.mjs";
import { verifyOwnerOutputCommitment } from "../../shared/protocol/ownerOutputCommitment.mjs";
import { buildWorkBatchPayload, WORK_BATCH_TOKEN_ID, WORK_BATCH_REGISTRY_ADDRESS } from "../../shared/protocol/workBatch.mjs";

const root = new URL("../../../", import.meta.url);
function loadTs(path, imports = {}) {
  const exports = {};
  const source = ts.transpileModule(readFileSync(new URL(path, root), "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  vm.runInNewContext(source, { exports, Buffer, require: name => { assert.ok(Object.hasOwn(imports, name), name); return imports[name]; } });
  return exports;
}
const recovery = loadTs("src/shared/wallet/actionRecovery.ts");
const batchRecovery = loadTs("src/shared/work/workBatchRecovery.ts", { "../wallet/actionRecovery": recovery });
const paymentReview = loadTs("src/shared/wallet/paymentReview.ts", { "bitcoinjs-lib": bitcoin, buffer: { Buffer } });
const app = readFileSync(new URL("src/App.tsx", root), "utf8");
const ast = ts.createSourceFile("App.tsx", app, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const functions = new Map();
function visit(node) {
  if (ts.isFunctionDeclaration(node) && node.name) functions.set(node.name.text, node.getText(ast));
  ts.forEachChild(node, visit);
}
visit(ast);
const selected = ["psbtUnsignedTransactionIntent", "rawUnsignedTransactionIntent", "assertSignedTransactionIntent", "ownerOutputEvidenceFromPreparedPayment", "signAndBroadcastPsbtDetailed", "reviewAndSendAction"];
const compiled = ts.transpileModule(selected.map(name => functions.get(name)).join("\n"), { compilerOptions: { module: ts.ModuleKind.None, target: ts.ScriptTarget.ES2022 } }).outputText;
const owner = createOwnerOutputCommitmentFixture({ spendPath: "p2wpkh" }).ownerAddress;
const recipients = [
  { recipientAddress: "1F1zepCJ8VPcPoeMt6G4BPKuE3CYAxCKNY", amountSubatoms: "1" },
  { recipientAddress: "1KNkUBREnfno2BeV7QsBf8XCWZN6YFfxPH", amountSubatoms: "1" },
];
const payload = buildWorkBatchPayload(recipients);

function fixture({ contextChanges = false, unknown = false, weakSignature = false, changeAfterFinalPreflight = false } = {}) {
  const storageValues = new Map();
  const storage = { getItem: key => storageValues.get(key) ?? null, setItem: (key, value) => storageValues.set(key, value) };
  const funding = new bitcoin.Transaction();
  funding.addInput(Buffer.alloc(32, 9), 0);
  const script = bitcoin.address.toOutputScript(owner);
  funding.addOutput(script, 20000n);
  const psbt = new bitcoin.Psbt();
  psbt.addInput({ hash: funding.getId(), index: 0, witnessUtxo: { script, value: 20000n }, sighashType: bitcoin.Transaction.SIGHASH_ALL });
  psbt.addOutput({ address: WORK_BATCH_REGISTRY_ADDRESS, value: 546n });
  psbt.addOutput({ script: bitcoin.script.compile([bitcoin.opcodes.OP_RETURN, Buffer.from(payload)]), value: 0n });
  psbt.addOutput({ address: owner, value: 18000n });
  const prepared = { psbtHex: psbt.toHex(), inputCount: 1, feeSats: 1454, changeSats: 18000, dustFeeSats: 0, strictOwnerOutputCommitment: true };
  let current = true, signCalls = 0, broadcastCalls = 0, ownerChecks = 0;
  const receiptStages = [], preflights = [];
  const actionReviewResolverRef = { current: null };
  const wallet = { signPsbt: async (hex, options) => {
    signCalls++; assert.equal(options.toSignInputs[0].sighashTypes[0], bitcoin.Transaction.SIGHASH_ALL);
    const signed = signOwnerOutputCommitmentPsbt(hex, { spendPath: "p2wpkh", hashType: weakSignature ? 2 : 1 });
    if (contextChanges) current = false;
    return signed;
  } };
  const context = vm.createContext({
    ...paymentReview, ...recovery, bitcoin, Buffer, verifyOwnerOutputCommitment,
    address: owner, network: "livenet", feeRate: 1, localStorage: storage, actionReviewResolverRef,
    actionInFlightRef: { current: false }, actionReturnFocusRef: { current: null },
    bitcoinNetwork: () => bitcoin.networks.bitcoin, networkLabel: () => "Mainnet",
    bytesToHex: bytes => Buffer.from(bytes).toString("hex"),
    errorMessage: (error, fallback) => error?.message || fallback,
    setStatus() {}, setActionRecoveryError() {}, setActionReceipts: rows => receiptStages.push(rows[0]?.status),
    setActionReview: review => { assert.equal(review.evidence.outputs.filter(row => row.kind === "payment").length, 1); actionReviewResolverRef.current(true); },
    ensureWalletNetwork: async () => {}, assertActiveWalletAddress: async () => {},
    fetchAddressApiUtxos: async () => [{ txid: funding.getId(), vout: 0, value: 20000, status: { confirmed: true } }],
    assertTransactionIntentDoesNotSpendReservedListingAnchors: async () => {
      ownerChecks++;
      // Calls: review preparation, pre-sign signature helper, post-sign helper.
      if (changeAfterFinalPreflight && ownerChecks === 3) current = false;
    },
    broadcastSignedRawTransaction: async raw => {
      broadcastCalls++;
      const saved = recovery.readActionReceipts(storage)[0];
      assert.equal(saved.status, "unknown");
      assert.equal(saved.txid, bitcoin.Transaction.fromHex(raw).getId());
      if (unknown) throw new Error("Fixture broadcast outcome unknown");
      return { txid: saved.txid, opReturnCount: 1 };
    },
  });
  vm.runInContext(compiled + "\nthis.run = reviewAndSendAction;", context);
  const run = () => context.run({
    prepared, title: "Review WORK batch", fields: [["Transfer mode", batchRecovery.WORK_BATCH_RECEIPT_MARKER], ["Total subatoms", "2"]],
    payload, registry: WORK_BATCH_REGISTRY_ADDRESS, registryProofs: 546, key: "credit-transfer:" + WORK_BATCH_TOKEN_ID,
    retainSignedReceipt: true, context: { wallet, trigger: null, assertCurrent: () => { if (!current) throw new Error("Wallet context changed"); } },
    revalidate: async ownTxid => {
      preflights.push(ownTxid);
      batchRecovery.assertNoUnresolvedWorkBatch(storage, owner, ownTxid);
    },
  });
  return { run, storage, preflights, receiptStages, counts: () => ({ signCalls, broadcastCalls }) };
}

test("an exact ALL-signed batch retains its receipt before revalidation and exempts only itself", async () => {
  const value = fixture();
  const txid = await value.run();
  assert.deepEqual(value.preflights, [undefined, txid]);
  assert.deepEqual(value.receiptStages, ["unknown", "pending"]);
  assert.deepEqual(value.counts(), { signCalls: 1, broadcastCalls: 1 });
  assert.throws(() => batchRecovery.assertNoUnresolvedWorkBatch(value.storage, owner), /full batch/);
});
test("a wallet context change during signing retains the captured wallet receipt and blocks broadcast", async () => {
  const value = fixture({ contextChanges: true });
  await assert.rejects(value.run(), /status check/);
  assert.equal(recovery.readActionReceipts(value.storage)[0].address, owner);
  assert.equal(recovery.readActionReceipts(value.storage)[0].status, "unknown");
  assert.equal(value.counts().broadcastCalls, 0);
});
test("a context change after final preflight cannot bypass the last broadcast guard", async () => {
  const value = fixture({ changeAfterFinalPreflight: true });
  await assert.rejects(value.run(), /context changed/);
  assert.equal(recovery.readActionReceipts(value.storage)[0].status, "unknown");
  assert.equal(value.counts().broadcastCalls, 0);
});
test("unknown broadcast persists the entire batch hold and refuses another signature", async () => {
  const value = fixture({ unknown: true });
  await assert.rejects(value.run(), /status check/);
  await assert.rejects(value.run(), /earlier transaction/);
  assert.equal(recovery.readActionReceipts(value.storage)[0].status, "unknown");
  assert.deepEqual(value.counts(), { signCalls: 1, broadcastCalls: 1 });
});
test("a wallet choosing a weak signature cannot broadcast or create a valid batch receipt", async () => {
  const value = fixture({ weakSignature: true });
  await assert.rejects(value.run(), /committing all reviewed outputs/);
  assert.equal(recovery.readActionReceipts(value.storage).length, 0);
  assert.deepEqual(value.counts(), { signCalls: 1, broadcastCalls: 0 });
});
