import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";

const source = readFileSync(new URL("../src/App.tsx", import.meta.url), "utf8");
const ast = ts.createSourceFile("App.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
let effect;
function visit(node) {
  if (ts.isCallExpression(node) && node.expression.getText(ast) === "useEffect" &&
      node.arguments[0]?.getText(ast).includes("const loadAccountUtxos =")) effect = node.arguments[0];
  ts.forEachChild(node, visit);
}
visit(ast);
assert.ok(effect);
function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
function fixture() {
  const wallet = [], chain = [], state = {};
  let refresh;
  const context = { address: "wallet", network: "livenet",
    AbortController,
    createVisibleReadLoop(read) {
      const controllers = [];
      refresh = () => { const controller = new AbortController(); controllers.push(controller); void read(controller.signal); };
      refresh();
      return () => controllers.forEach((controller) => controller.abort());
    },
    fetchUtxos: () => { const d = deferred(); wallet.push(d); return d.promise; },
    fetchAddressApiUtxos: () => { const d = deferred(); chain.push(d); return d.promise; },
    errorMessage: (error) => error.message,
    window: { setInterval(fn) { refresh = fn; return 1; }, clearInterval() {}, addEventListener() {}, removeEventListener() {} },
  };
  for (const key of ["AccountUtxos", "AccountUtxosLoaded", "AccountUtxosError", "AccountChainUtxos", "AccountChainUtxosLoaded", "AccountChainUtxosError"]) {
    context["set" + key] = (value) => { state[key] = value; };
  }
  const script = ts.transpileModule(`(${effect.getText(ast)})()`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
  const cleanup = vm.runInNewContext(script, context);
  return { wallet, chain, state, cleanup, refresh: () => refresh() };
}
const flush = () => new Promise((resolve) => setImmediate(resolve));

test("late empty UTXO responses and errors cannot replace newer wallet balances", async () => {
  const f = fixture(); f.refresh();
  f.wallet[1].resolve([{ txid: "new-wallet", value: 10000 }]);
  f.chain[1].resolve([{ txid: "new-chain", value: 12000 }]);
  await flush();
  f.wallet[0].resolve([]); f.chain[0].reject(new Error("old timeout"));
  await flush();
  assert.equal(f.state.AccountUtxos[0].value, 10000);
  assert.equal(f.state.AccountChainUtxos[0].value, 12000);
  assert.equal(f.state.AccountChainUtxosError, "");
  f.refresh(); f.wallet[2].reject(new Error("current timeout"));
  await flush();
  assert.equal(f.state.AccountUtxosError, "current timeout");
  assert.equal(f.state.AccountUtxos[0].value, 10000);
  f.cleanup(); f.chain[2].resolve([]); await flush();
  assert.equal(f.state.AccountChainUtxos[0].value, 12000);
});
