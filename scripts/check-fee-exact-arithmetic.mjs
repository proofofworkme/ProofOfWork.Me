import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";
import * as bitcoin from "bitcoinjs-lib";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";

const compilerOptions = {
  module: ts.ModuleKind.CommonJS,
  target: ts.ScriptTarget.ES2022,
  jsx: ts.JsxEmit.React,
};
function evaluate(source, dependencies = {}) {
  const context = { exports: {}, ...dependencies };
  vm.runInNewContext(ts.transpileModule(source, { compilerOptions }).outputText, context);
  return context;
}
const read = (path) => readFileSync(new URL(path, import.meta.url), "utf8");
const wallet = evaluate(read("../src/walletUtxos.ts")).exports;

// Independent decimal-string oracle: no Number multiplication or production parser.
function rationalFee(vbytes, decimalRate) {
  const [whole, fraction = ""] = decimalRate.split(".");
  const denominator = 10n ** BigInt(fraction.length);
  const numerator = BigInt(vbytes) * BigInt(whole + fraction);
  return Number(numerator / denominator + (numerator % denominator === 0n ? 0n : 1n));
}
const rates = ["0", "0.00000001", "0.1", "0.28", "0.35", "0.45", "0.12345678",
  "1.00000001", "2", "2.2", "4.4", "8.8", "9.8", "10000000000"];
let vectors = 0;
for (const rate of rates) {
  for (const vbytes of [0, 1, 205, 210, 238, 241, 275, 1000]) {
    assert.equal(wallet.feeForEstimatedVbytes(vbytes, Number(rate)), rationalFee(vbytes, rate));
    vectors++;
  }
}
for (let q8 = 1n; q8 <= 999n; q8++) {
  const rate = `0.${(q8 * 100001n).toString().padStart(8, "0")}`;
  const vbytes = Number(204n + q8 % 797n);
  assert.equal(wallet.feeForEstimatedVbytes(vbytes, Number(rate)), rationalFee(vbytes, rate));
  vectors++;
}
// toFixed(8) itself exposes binary tails at large magnitudes: this accepted
// rate's canonical decimal is .0001, not the .00012207 binary rendering.
for (const [vbytes, rate] of [[9000, "1000000000000.0001"], [1000, "100000000000.1"]]) {
  assert.equal(wallet.feeForEstimatedVbytes(vbytes, Number(rate)), rationalFee(vbytes, rate));
  vectors++;
}
const utxo = (value) => ({ txid: "a".repeat(64), vout: 0, value,
  source: "wallet-curated", status: { confirmed: true } });
for (const rate of rates.slice(0, -1)) {
  const selected = wallet.selectUtxos([utxo(100_000)], 546, Number(rate), 34, 34);
  assert.equal(selected.feeSats, rationalFee(238, rate));
  assert.equal(selected.changeSats, 100_000 - 546 - selected.feeSats);
}
for (const rate of [0.123456789, 0.100000001, NaN, Infinity, -0.35]) {
  assert.throws(() => wallet.selectUtxos([utxo(100_000)], 546, rate, 34, 34), /up to 8 decimal places/);
  assert.equal(wallet.previewFeeForEstimatedVbytes(275, rate), null);
}
for (const size of [-1, 0.1, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1]) {
  assert.throws(() => wallet.feeForEstimatedVbytes(size, 0.28), /safe integer/);
  assert.equal(wallet.previewFeeForEstimatedVbytes(size, 0.28), null);
}
// Rate validation is unchanged, including exponent notation. Unsafe fees fail
// before entering a Number-valued transaction; they never become rounded fees.
assert.doesNotThrow(() => wallet.assertFeeRatePrecision(1e21));
assert.equal(wallet.feeForEstimatedVbytes(0, 1e21), 0);
assert.throws(() => wallet.feeForEstimatedVbytes(1, 1e21), /safe whole-proof range/);
assert.equal(wallet.previewFeeForEstimatedVbytes(1, 1e21), null);
assert.equal(wallet.feeForEstimatedVbytes(1, Number.MAX_SAFE_INTEGER), Number.MAX_SAFE_INTEGER);
assert.throws(() => wallet.feeForEstimatedVbytes(2, Number.MAX_SAFE_INTEGER), /safe whole-proof range/);

// Exact 546-proof change survives; genuinely below-dust change retains the
// established no-change absorption behavior.
for (const [input, fee, change, dust] of [[100000, 77, 99377, 0], [1169, 77, 546, 0], [1168, 622, 0, 554]]) {
  const selected = wallet.selectUtxos([utxo(input)], 546, 0.28, 71, 34);
  assert.deepEqual([selected.feeSats, selected.changeSats, selected.dustFeeSats], [fee, change, dust]);
}
assert.throws(() => wallet.selectUtxos([utxo(613)], 546, 0.28, 71, 34), /Need about 623 proofs/);
assert.equal(wallet.selectSmallestSingleConfirmedUtxo([utxo(1169), utxo(100000)], 546, 0.28, 71, 34).changeSats, 546);

function sourceTree(path) {
  const source = read(path);
  return { source, tree: ts.createSourceFile(path, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX) };
}
function nodes(parsed, predicate) {
  const found = [];
  function visit(node) {
    if (predicate(node)) found.push(node);
    ts.forEachChild(node, visit);
  }
  visit(parsed.tree);
  return found;
}
function unique(parsed, predicate) {
  const found = nodes(parsed, predicate);
  assert.equal(found.length, 1, "Expected one actual source node");
  return found[0];
}
function text(parsed, node) {
  return parsed.source.slice(node.getStart(parsed.tree), node.end);
}
function functions(parsed, names, dependencies) {
  return evaluate(names.map((name) => text(parsed, unique(parsed,
    (node) => ts.isFunctionDeclaration(node) && node.name?.text === name))).join("\n"), dependencies);
}
function initializer(parsed, name) {
  return text(parsed, unique(parsed, (node) => ts.isVariableDeclaration(node) &&
    ts.isIdentifier(node.name) && node.name.text === name).initializer);
}
const appSource = sourceTree("../src/App.tsx");
const boostSource = sourceTree("../src/features/boost/boostWallet.ts");
const boostNumeric = evaluate(read("../src/features/boost/boostNumeric.ts")).exports;
const fromAddress = "1638Vn6KtmK8p5r4oGvAXq9nmZb1emU1DV";
const toAddress = "1F1zepCJ8VPcPoeMt6G4BPKuE3CYAxCKNY";
const payload = "pwm1:m:" + "a".repeat(19);
let fixture;
const dependencies = {
  bitcoin, Buffer, DUST_SATS: 546, MAX_DATA_CARRIER_BYTES: 100000,
  ...wallet, ...boostNumeric,
  fetchUtxos: async () => [fixture.utxo],
  fetchFreshProofOfWorkListingAnchorOutpoints: async () => [],
  mergeListingAnchorOutpoints: (left, right) => [...left, ...right],
  loadUtxoPreviousOutput: async (input) => ({ ...input,
    previousOutput: fixture.previous.outs[0], previousTxHex: fixture.previous.toHex() }),
};
const sharedNames = ["bitcoinNetwork", "networkLabel", "scriptForAddress", "varIntSize",
  "outputVbytesForScript", "opReturnScriptForPayload", "isNativeWitnessScript", "utxoInputData"];
const app = functions(appSource, [...sharedNames, "protocolOutputScripts", "buildPaymentPsbt",
  "chainedMintInputData", "buildChainedMintPsbt"], dependencies);
const boost = functions(boostSource, [...sharedNames, "normalizeOutput", "buildBoostPaymentPsbt"], dependencies);
const fromScript = bitcoin.address.toOutputScript(fromAddress, bitcoin.networks.bitcoin);
function setFixture(value) {
  const previous = new bitcoin.Transaction();
  previous.version = 2;
  previous.addInput(Buffer.alloc(32, 2), 0, 0xfffffffd);
  previous.addOutput(fromScript, BigInt(value));
  fixture = { previous, utxo: { ...utxo(value), txid: previous.getId() } };
}
function verifyPsbt(prepared, input, expectedFee, expectedOutputs) {
  const psbt = bitcoin.Psbt.fromHex(prepared.psbtHex, { network: bitcoin.networks.bitcoin });
  assert.deepEqual(psbt.txOutputs.map((output) => Number(output.value)), expectedOutputs);
  assert.equal(BigInt(input) - psbt.txOutputs.reduce((sum, output) => sum + output.value, 0n), BigInt(expectedFee));
  assert.equal(prepared.feeSats, expectedFee);
}
let unsignedFixtures = 0;
for (const [input, fee, outputs] of [[100000, 77, [546, 0, 99377]], [1169, 77, [546, 0, 546]], [1168, 622, [546, 0]]]) {
  setFixture(input);
  const preparedApp = await app.buildPaymentPsbt({ amountSats: 546, feeRate: 0.28,
    fromAddress, toAddress, network: "livenet", prefetchedWalletUtxos: [fixture.utxo], protocolPayloads: [payload] });
  verifyPsbt(preparedApp, input, fee, outputs);
  const preparedBoost = await boost.buildBoostPaymentPsbt({ feeRate: 0.28, fromAddress,
    network: "livenet", payments: [{ address: toAddress, amountSats: 546 }], protocolPayloads: [payload] });
  verifyPsbt(preparedBoost, input, fee, outputs);
  unsignedFixtures += 2;
  const chained = app.buildChainedMintPsbt({ feeRate: 0.28, fromAddress, network: "livenet", isLast: true,
    inputs: [{ ...fixture.utxo, previousOutput: fixture.previous.outs[0], previousTxHex: fixture.previous.toHex() }],
    fixedOutputs: [{ address: toAddress, amountSats: 546 }, { script: app.opReturnScriptForPayload(payload), amountSats: 0 }] });
  verifyPsbt(chained, input, fee, outputs);
  unsignedFixtures++;
}
setFixture(1168);
assert.throws(() => app.buildChainedMintPsbt({ feeRate: 0.28, fromAddress, network: "livenet", isLast: false,
  inputs: [{ ...fixture.utxo, previousOutput: fixture.previous.outs[0], previousTxHex: fixture.previous.toHex() }],
  fixedOutputs: [{ address: toAddress, amountSats: 546 }, { script: app.opReturnScriptForPayload(payload), amountSats: 0 }] }), /below dust/);

// Run actual budget/preview expressions and every repeated dashboard JSX.
// Invalid drafts render unavailable and disable preparation without throwing.
const expression = (source, context) => evaluate(`exports.value = (${source});`, context).exports.value;
assert.equal(expression(initializer(appSource, "estimatedFeePerMint"), {
  ...wallet, fixedOutputVbytes: 71, changeOutputVbytes: 34, feeRate: 0.28,
}), 77);
const previewContext = { ...wallet, estimatedTransferSplitVbytes: 275, estimatedSplitVbytes: 275 };
const strongNodes = nodes(appSource, (node) => ts.isJsxElement(node) &&
  node.openingElement.tagName.getText(appSource.tree) === "strong" &&
  /estimatedTransferSplitFeeSats|estimatedSplitFeeSats|estimatedTotalSats/.test(text(appSource, node)));
assert.equal(strongNodes.length, 5);
for (const [rate, expected] of [[0.28, 77], [0.123456789, null], [1e21, null]]) {
  const context = { ...previewContext, normalizedPrepareTransferFeeRate: rate, normalizedPrepareFeeRate: rate };
  const transfer = expression(initializer(appSource, "estimatedTransferSplitFeeSats"), context);
  const mint = expression(initializer(appSource, "estimatedSplitFeeSats"), context);
  assert.equal(transfer, expected);
  assert.equal(mint, expected);
  const values = { estimatedTransferSplitFeeSats: transfer, estimatedSplitFeeSats: mint };
  values.estimatedTotalSats = expression(initializer(appSource, "estimatedTotalSats"), { ...values, totalPreparedSats: 546 });
  assert.equal(values.estimatedTotalSats, expected === null ? null : 623);
  for (const node of strongNodes) {
    const markup = renderToStaticMarkup(expression(text(appSource, node), { ...values, React }));
    assert.equal(markup, expected === null ? "<strong>Unavailable</strong>" :
      `<strong>${/estimatedTotalSats/.test(text(appSource, node)) ? 623 : 77} proofs</strong>`);
  }
  assert.equal(expression(initializer(appSource, "helperCanPrepare"), {
    canPrepareMintUtxos: true, helperTokenSelected: true, estimatedSplitFeeSats: mint,
  }), expected !== null);
  const disabled = unique(appSource, (node) => ts.isJsxAttribute(node) &&
    node.name.getText(appSource.tree) === "disabled" &&
    /estimatedTransferSplitFeeSats/.test(text(appSource, node))).initializer.expression;
  assert.equal(expression(text(appSource, disabled), { canPrepareTransferUtxos: true,
    estimatedTransferSplitFeeSats: transfer }), expected === null);
}
console.log(JSON.stringify({ ok: true, rationalVectors: vectors, unsignedPsbtFixtures: unsignedFixtures,
  scope: "Actual wallet, Computer, Boost and chained-mint source; exact fees, dust, bounds and safe preview rendering. Local unsigned fixtures only; no network, signature or broadcast." }));
