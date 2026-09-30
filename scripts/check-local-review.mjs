import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";
import * as bitcoin from "bitcoinjs-lib";

function load(path, imports = {}) {
  const exports = {};
  const js = ts.transpileModule(readFileSync(new URL(path, import.meta.url), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  vm.runInNewContext(js, { exports, require: name => {
    if (name === "buffer") return { Buffer };
    if (imports[name]) return imports[name];
    throw new Error(`Unexpected import ${name}`);
  }});
  return exports;
}
const backup = load("../src/shared/localBackup.ts");
class StorageFixture {
  data = new Map(); failAt = null; recoveryFailure = false; calls = 0;
  get length() { return this.data.size; }
  key(index) { return [...this.data.keys()][index] ?? null; }
  getItem(key) { return this.data.get(key) ?? null; }
  setItem(key, value) {
    this.calls++;
    if (this.calls === this.failAt || this.recoveryFailure && this.calls > this.failAt) throw new Error("quota fixture");
    this.data.set(key, value);
  }
  removeItem(key) { this.data.delete(key); }
}
const { contacts, sent, folders } = backup.BACKUP_KEYS;
let storage = new StorageFixture();
storage.data.set(contacts, '["old"]'); storage.data.set(folders, '["keep"]'); storage.data.set("unrelated", "preserve");
let plan = backup.prepareLocalRestore(storage, { [contacts]: '["new"]', [sent]: '[]' });
assert.equal(storage.calls, 0, "preparation and cancellation write nothing");
backup.applyLocalRestore(storage, plan);
assert.equal(storage.getItem(contacts), '["new"]'); assert.equal(storage.getItem(folders), '["keep"]'); assert.equal(storage.getItem("unrelated"), "preserve");
assert.throws(() => backup.prepareLocalRestore(storage, { unrelated: '[]' }), /Unsupported/);
plan = backup.prepareLocalRestore(storage, { [contacts]: '[]' });
storage.data.set(contacts, '["changed"]');
assert.throws(() => backup.applyLocalRestore(storage, plan), /changed after this preview/);
plan = backup.prepareLocalRestore(storage, { [contacts]: '[]' });
storage.data.set(`${backup.BACKUP_KEYS.draftPrefix}:livenet:wallet`, '{}');
assert.throws(() => backup.applyLocalRestore(storage, plan), /changed after this preview/);
for (const existing of [false, true]) {
  storage = new StorageFixture();
  if (existing) storage.data.set(contacts, '["before"]');
  plan = backup.prepareLocalRestore(storage, { [contacts]: '["after"]', [sent]: '[]' });
  storage.failAt = 2;
  assert.throws(() => backup.applyLocalRestore(storage, plan), /Previous local data was recovered/);
  assert.equal(storage.getItem(contacts), existing ? '["before"]' : null);
  assert.equal(storage.getItem(sent), null);
}
storage = new StorageFixture(); storage.data.set(contacts, '["before"]');
plan = backup.prepareLocalRestore(storage, { [contacts]: '["after"]', [sent]: '[]' });
storage.failAt = 2; storage.recoveryFailure = true;
assert.throws(() => backup.applyLocalRestore(storage, plan), error => error.unrecoveredKeys.includes(contacts) && /recovery is incomplete/.test(error.message));

const { inspectPreparedPayment } = load("../src/shared/wallet/paymentReview.ts", { "bitcoinjs-lib": bitcoin });
const sender = "1BPVvi1GK4QkfqFMU4jHGjsQjyGwjJJJ7x";
const recipient = "1F1p9UEHuH5KTFR7Zsx93Khdrqhj6t5nFv";
const previous = new bitcoin.Transaction();
previous.addInput(Buffer.alloc(32), 0xffffffff);
previous.addOutput(bitcoin.address.toOutputScript(sender), 9007199254740993n);
const psbt = new bitcoin.Psbt();
psbt.addInput({ hash: previous.getId(), index: 0, nonWitnessUtxo: previous.toBuffer() });
psbt.addOutput({ address: recipient, value: 546n });
psbt.addOutput({ script: bitcoin.payments.embed({ data: [Buffer.from("pwm1:m:fixture")] }).output, value: 0n });
psbt.addOutput({ address: sender, value: 9007199254740347n });
// Exact totals exceed Number precision; individual expected change must stay within existing API's safe integer contract.
const evidence = inspectPreparedPayment({ psbtHex: psbt.toHex(), network: bitcoin.networks.bitcoin,
  paymentCount: 1, registryPaymentCount: 0, feeSats: 100, changeSats: 9007199254740347 });
assert.equal(evidence.inputProofs, "9007199254740993"); assert.equal(evidence.totalSpendProofs, "646");
assert.equal(evidence.changeProofs, "9007199254740347"); assert.equal(evidence.records[0], "pwm1:m:fixture");
assert.throws(() => inspectPreparedPayment({ psbtHex: psbt.toHex(), network: bitcoin.networks.bitcoin,
  paymentCount: 1, registryPaymentCount: 0, feeSats: 99, changeSats: 9007199254740347 }), /do not match/);
const missing = new bitcoin.Psbt();
missing.addInput({ hash: previous.getId(), index: 0 }); missing.addOutput({ address: recipient, value: 546n });
assert.throws(() => inspectPreparedPayment({ psbtHex: missing.toHex(), network: bitcoin.networks.bitcoin,
  paymentCount: 1, registryPaymentCount: 0, feeSats: 100, changeSats: 0 }), /unavailable or inconsistent/);
console.log("Local restore replacement, conflict, rollback/recovery, and exact PSBT review checks passed.");
