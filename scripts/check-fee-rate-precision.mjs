import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";

function load(path, require = () => { throw new Error("Unexpected import"); }) {
  const exports = {};
  const source = readFileSync(new URL(path, import.meta.url), "utf8");
  const js = ts.transpileModule(source, { compilerOptions: {
    module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022,
  } }).outputText;
  vm.runInNewContext(js, { exports, require });
  return exports;
}
const wallet = load("../src/walletUtxos.ts");
const utxos = [{ txid: "a".repeat(64), vout: 0, value: 100_000, status: { confirmed: true } }];
for (const rate of [0.1, 0.35, 0.45, 0.12345678, 1.00000001, 2]) {
  const selected = wallet.selectUtxos(utxos, 546, rate, 34, 34);
  assert.equal(selected.feeSats, Math.ceil(238 * rate));
  assert.equal(selected.changeSats, 100_000 - 546 - selected.feeSats);
}
for (const rate of [0.123456789, 0.100000001, NaN, Infinity, -0.35]) {
  assert.throws(() => wallet.selectUtxos(utxos, 546, rate, 34, 34), /up to 8 decimal places/);
}
console.log("Fee precision and whole-proof transaction fee checks passed.");
