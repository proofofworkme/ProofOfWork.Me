import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";
import { address, networks, payments } from "bitcoinjs-lib";
import { assertSameWorkBatchRoutes, assertWorkBatchReady, readWorkBatchStatus, resolveWorkBatchDraft, splitWorkBatchInputs, workBatchAmountSubatoms } from "./workBatchClient.mjs";
import { buildWorkBatchPayload, parseWorkBatchPayload } from "../../shared/protocol/workBatch.mjs";

const hash = number => number.toString(16).padStart(64, "0");
const wallet = number => payments.p2wpkh({ hash: Buffer.from(number.toString(16).padStart(40, "0"), "hex") }).address;
const validateAddress = value => { try { address.toOutputScript(value, networks.bitcoin); return true; } catch { return false; } };
const ready = () => ({ protocol: "work-batch-v1", network: "livenet", active: true, writeEnabled: true, ready: true, reasonCode: null,
  declarationTxid: hash(2), activationHeight: 100, checkedTipHeight: 101, checkedTipHash: hash(3), registryFeeProofs: 546,
  limits: { minRecipients: 2, maxRecipients: 256, maxPayloadBytes: 65536 } });

test("status requires explicit activation, exact configured protocol limits and a coherent checkpoint", () => {
  assert.equal(assertWorkBatchReady(ready()).ready, true);
  const inactive = { ...ready(), active: false, ready: false, writeEnabled: false, declarationTxid: null, activationHeight: null, reasonCode: "declaration-unconfirmed" };
  assert.equal(readWorkBatchStatus(inactive).ready, false);
  assert.throws(() => assertWorkBatchReady(inactive), /not active/u);
  for (const mutate of [
    value => { value.active = false; }, value => { value.writeEnabled = false; }, value => { delete value.ready; },
    value => { value.declarationTxid = null; }, value => { value.activationHeight = 102; },
    value => { value.checkedTipHash = ""; }, value => { value.network = "testnet"; },
    value => { value.registryFeeProofs = 5460; }, value => { value.limits.maxRecipients = 1000; },
  ]) { const value = ready(); mutate(value); assert.throws(() => assertWorkBatchReady(value)); }
  assert.throws(() => assertWorkBatchReady({ ...ready(), checkedTipHash: hash(4) }, ready()), /checkpoint/u);
  assert.throws(() => assertWorkBatchReady({ ...ready(), checkedTipHeight: 100 }, ready()), /checkpoint/u);
  assert.throws(() => assertWorkBatchReady({ ...ready(), declarationTxid: hash(5) }, ready()), /activation/u);
});

test("recipient parsing preserves spaces and punctuation in IDs, and exact one-subatom quantities", async () => {
  assert.deepEqual(splitWorkBatchInputs("!@proofofwork.me, flat fish@proofofwork.me; bob\ncarol"), ["!@proofofwork.me", "flat fish@proofofwork.me", "bob", "carol"]);
  const draft = await resolveWorkBatchDraft("!@proofofwork.me, flat fish@proofofwork.me", "0.0000000000000001", {
    validateAddress, resolveId: async id => ({ id, network: "livenet", confirmed: true, receiveAddress: wallet(id === "!" ? 1 : 2) }),
  });
  assert.equal(draft.totalAmountSubatoms, "2");
  assert.equal(draft.destinations[1].id, "flat fish");
  assert.equal(parseWorkBatchPayload(buildWorkBatchPayload(draft.recipients)).totalAmountSubatoms, "2");
  for (const value of ["0", "-1", "1e2", "0.00000000000000001", "21000001", "Infinity", "1,000"]) assert.throws(() => workBatchAmountSubatoms(value));
});

test("78 recipients resolve in input order with bounded reads and exact total", async () => {
  let active = 0, peak = 0;
  const draft = await resolveWorkBatchDraft(Array.from({ length: 78 }, (_, i) => `id${i}`).join(", "), "2.1234567890123456", {
    validateAddress, resolveId: async id => {
      active++; peak = Math.max(peak, active); await new Promise(resolve => setTimeout(resolve, 1)); active--;
      return { id, confirmed: true, network: "livenet", receiveAddress: wallet(Number(id.slice(2)) + 1) };
    },
  });
  assert.equal(draft.recipientCount, 78);
  assert.equal(draft.totalAmountSubatoms, (21234567890123456n * 78n).toString());
  assert.equal(draft.destinations[77].recipientAddress, wallet(78));
  assert.ok(peak <= 4 && peak > 1);
});

test("duplicate wallets, pending IDs, receiver changes and cancelled reads cannot become a batch", async () => {
  const options = { validateAddress, resolveId: async id => ({ id, confirmed: true, network: "livenet", receiveAddress: wallet(1) }) };
  await assert.rejects(resolveWorkBatchDraft("alice,bob", "1", options), /duplicate/iu);
  await assert.rejects(resolveWorkBatchDraft(`${wallet(1)},${wallet(1).toUpperCase()}`, "1", options), /duplicate/iu);
  await assert.rejects(resolveWorkBatchDraft("alice,bob", "1", { ...options, resolveId: async id => ({ id, confirmed: false, network: "livenet", receiveAddress: wallet(1) }) }), /confirmed/u);
  const draft = await resolveWorkBatchDraft(`${wallet(1)},${wallet(2)}`, "1", options);
  const changed = await resolveWorkBatchDraft(`${wallet(1)},${wallet(3)}`, "1", options);
  assert.throws(() => assertSameWorkBatchRoutes(draft, changed), /changed/u);
  const controller = new AbortController(); controller.abort();
  await assert.rejects(resolveWorkBatchDraft("alice,bob", "1", { ...options, signal: controller.signal }), /abort/iu);
});

function tsModule(path, dependencies) {
  const source = ts.transpileModule(readFileSync(new URL(path, import.meta.url), "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText;
  const module = { exports: {} };
  vm.runInNewContext(source, { module, exports: module.exports, require: name => dependencies[name], Map, Set, BigInt });
  return module.exports;
}
const recovery = tsModule("../../shared/wallet/actionRecovery.ts", {});
const batchRecovery = tsModule("../../shared/work/workBatchRecovery.ts", { "../wallet/actionRecovery": recovery });
const storage = rows => ({ getItem: key => key === recovery.ACTION_RECEIPTS_KEY ? JSON.stringify(rows) : null });
const receipt = status => ({ txid: hash(7), address: wallet(1), network: "livenet", title: "WORK batch", key: "credit-transfer:work", createdAt: "2026-10-24T00:00:00Z", status,
  fields: [["Transfer mode", batchRecovery.WORK_BATCH_RECEIPT_MARKER], ["Total subatoms", "780000000000000000"]] });

test("the entire unresolved batch stays protected across retries; only exact signed txid or verified terminal status releases it", () => {
  for (const state of ["unknown", "pending"]) {
    const current = storage([receipt(state)]);
    assert.throws(() => batchRecovery.assertNoUnresolvedWorkBatch(current, wallet(1).toUpperCase()), /full batch/u);
    assert.throws(() => batchRecovery.assertNoUnresolvedWorkBatch(current, wallet(1), hash(8)), /full batch/u);
    assert.doesNotThrow(() => batchRecovery.assertNoUnresolvedWorkBatch(current, wallet(1), hash(7)));
    assert.doesNotThrow(() => batchRecovery.assertNoUnresolvedWorkBatch(current, wallet(2)));
  }
  for (const state of ["confirmed", "dropped"]) assert.doesNotThrow(() => batchRecovery.assertNoUnresolvedWorkBatch(storage([receipt(state)]), wallet(1)));
  assert.throws(() => batchRecovery.assertNoUnresolvedWorkBatch({ getItem: () => "corrupt" }, wallet(1)));
});
