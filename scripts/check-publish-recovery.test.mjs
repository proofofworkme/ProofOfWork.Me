import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import ts from "typescript";
import * as bitcoin from "bitcoinjs-lib";
import * as ecc from "@bitcoinerlab/secp256k1";

bitcoin.initEccLib(ecc);
const dataModule = (source, filename) => `data:text/javascript;base64,${Buffer.from(ts.transpileModule(source, {
  fileName: filename,
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
}).outputText).toString("base64")}`;
const moduleStub = source => `data:text/javascript,${encodeURIComponent(source)}`;
const numeric = dataModule(await readFile(new URL("../src/features/boost/boostNumeric.ts", import.meta.url), "utf8"), "boostNumeric.ts");
const networks = dataModule(await readFile(new URL("../src/shared/bitcoin/networks.ts", import.meta.url), "utf8"), "networks.ts");
const source = (await readFile(new URL("../src/features/boost/boostWallet.ts", import.meta.url), "utf8"))
  .replace('"bitcoinjs-lib"', JSON.stringify(import.meta.resolve("bitcoinjs-lib")))
  .replace('"@bitcoinerlab/secp256k1"', JSON.stringify(import.meta.resolve("@bitcoinerlab/secp256k1")))
  .replace('"buffer"', '"node:buffer"')
  .replace('"../../walletUtxos"', JSON.stringify(moduleStub("export const enrichWalletCuratedUtxoConfirmations = () => {}; export const normalizeWalletUtxos = () => {}; export const selectUtxos = () => {};")))
  .replace('"../../functions"', JSON.stringify(moduleStub("export const errorMessage = (cause, fallback) => cause instanceof Error ? cause.message : fallback; export const shortAddress = value => value;")))
  .replace('"../../shared/bitcoin/networks"', JSON.stringify(networks))
  .replace('"../../shared/api/proofApiClient"', JSON.stringify(moduleStub("export const fetchProofApiJson = () => {}; export const proofApiUrl = (path, network) => `https://publish.proofofwork.me${path}?network=${network}`;")))
  .replace('"../../shared/bitcoin/protocolLimits"', JSON.stringify(moduleStub("export const MAX_DATA_CARRIER_BYTES = 100000;")))
  .replace('"./boostNumeric"', JSON.stringify(numeric));
const { signAndBroadcastBoostPsbt } = await import(dataModule(source, "boostWallet.ts"));
const recovery = await import(dataModule(await readFile(new URL("../src/shared/wallet/actionRecovery.ts", import.meta.url), "utf8"), "actionRecovery.ts"));

// Disposable public deterministic signing fixture, never a connected wallet key.
const fixtureKey = Buffer.alloc(32, 7);
const fixturePublicKey = ecc.pointFromScalar(fixtureKey, true);
const payment = bitcoin.payments.p2wpkh({ pubkey: fixturePublicKey });
const body = "  Exact article body with café and 東京.\n";
const article = { v: 1, title: "Recovery fixture", source: "same-tx-pwm1-message", size: Buffer.byteLength(body), sha256: Buffer.from(bitcoin.crypto.sha256(Buffer.from(body))).toString("hex") };
const record = `pwb1:post:${Buffer.from(JSON.stringify({ v: 1, text: article.title, article, proofSignalSats: 546 })).toString("base64url")}`;
function unsigned(bodyValue = body) {
  const psbt = new bitcoin.Psbt();
  psbt.addInput({ hash: "a".repeat(64), index: 0, witnessUtxo: { script: payment.output, value: 200000n } });
  psbt.addOutput({ address: payment.address, value: 546n });
  for (const text of [record, `pwm1:m:${bodyValue}`]) psbt.addOutput({
    script: bitcoin.payments.embed({ data: [Buffer.from(text)] }).output, value: 0n,
  });
  psbt.addOutput({ address: payment.address, value: 198454n });
  return psbt;
}
function signed(hex) {
  const psbt = bitcoin.Psbt.fromHex(hex);
  psbt.signAllInputs({ publicKey: fixturePublicKey, sign: hash => ecc.sign(hash, fixtureKey) });
  psbt.finalizeAllInputs();
  return psbt;
}
const unsignedHex = unsigned().toHex();
const knownSignedTxid = signed(unsignedHex).extractTransaction().getId();
const parameters = {
  inputCount: 1, network: "livenet", psbtHex: unsignedHex, signInputIndexes: [0], signingAddress: payment.address,
};
function storageFixture() {
  const values = new Map();
  return { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value) };
}
function receipt(txid) {
  return { txid, address: payment.address, network: "livenet", title: "Publish article", key: `publish:${article.sha256}`,
    createdAt: new Date().toISOString(), status: "unknown", fields: [["Title", article.title], ["Body", body]] };
}

test("verified signed txid is durably retained before final fresh checks and broadcast", async () => {
  const storage = storageFixture();
  const steps = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, options) => {
    steps.push("broadcast");
    assert.match(url, /\/api\/v1\/broadcast\/tx\?network=livenet$/u);
    assert.equal(recovery.readActionReceipts(storage)[0].txid, knownSignedTxid);
    const transaction = bitcoin.Transaction.fromHex(JSON.parse(options.body).txHex);
    assert.equal(transaction.getId(), knownSignedTxid);
    assert.equal(Buffer.from(transaction.outs[2].script).includes(Buffer.from(body)), true);
    return { ok: true, status: 200, text: async () => JSON.stringify({ txid: knownSignedTxid }) };
  };
  try {
    const result = await signAndBroadcastBoostPsbt({ ...parameters,
      wallet: { signPsbt: async hex => { steps.push("sign"); return signed(hex).toHex(); } },
      onSigned: txid => { steps.push("receipt"); recovery.saveActionReceipt(storage, receipt(txid)); },
      beforeBroadcast: async () => { steps.push("recheck"); assert.equal(recovery.readActionReceipts(storage)[0].txid, knownSignedTxid); },
    });
    assert.equal(result.txid, knownSignedTxid);
    assert.deepEqual(steps, ["sign", "receipt", "recheck", "broadcast"]);
    assert.equal(recovery.readActionReceipts(storage)[0].fields[1][1], body);
  } finally { globalThis.fetch = originalFetch; }
});

test("failed durable receipt prevents every broadcast after local signing", async () => {
  const originalFetch = globalThis.fetch;
  let posted = false;
  let signedId;
  globalThis.fetch = async () => { posted = true; assert.fail("receipt failure must prevent broadcast"); };
  try {
    await assert.rejects(signAndBroadcastBoostPsbt({ ...parameters,
      wallet: { signPsbt: async hex => signed(hex).toHex() },
      onSigned: txid => {
        signedId = txid;
        recovery.saveActionReceipt({ getItem: () => null, setItem: () => { throw new Error("Storage quota exceeded"); } }, receipt(txid));
      },
    }), /Storage quota exceeded/u);
    assert.equal(signedId, knownSignedTxid);
    assert.equal(posted, false);
  } finally { globalThis.fetch = originalFetch; }
});

test("fresh check failure keeps signed evidence and performs no broadcast", async () => {
  const storage = storageFixture();
  const originalFetch = globalThis.fetch;
  let posted = false;
  globalThis.fetch = async () => { posted = true; assert.fail("fresh safety failure must prevent broadcast"); };
  try {
    await assert.rejects(signAndBroadcastBoostPsbt({ ...parameters,
      wallet: { signPsbt: async hex => signed(hex).toHex() },
      onSigned: txid => recovery.saveActionReceipt(storage, receipt(txid)),
      beforeBroadcast: async () => { throw new Error("Reviewed identity changed"); },
    }), /Reviewed identity changed/u);
    assert.equal(posted, false);
    assert.equal(recovery.readActionReceipts(storage)[0].txid, knownSignedTxid);
    assert.equal(recovery.readActionReceipts(storage)[0].status, "unknown");
  } finally { globalThis.fetch = originalFetch; }
});

test("uncertain POST result retains exact signed txid for first-party status recovery", async () => {
  const storage = storageFixture();
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => ({ ok: true, status: 200, text: async () => "Malformed broadcast acknowledgement" });
  try {
    await assert.rejects(signAndBroadcastBoostPsbt({ ...parameters,
      wallet: { signPsbt: async hex => signed(hex).toHex() },
      onSigned: txid => recovery.saveActionReceipt(storage, receipt(txid)),
    }), /Malformed broadcast acknowledgement/u);
    assert.equal(recovery.readActionReceipts(storage)[0].txid, knownSignedTxid);
    assert.equal(recovery.readActionReceipts(storage)[0].status, "unknown");
  } finally { globalThis.fetch = originalFetch; }
});

test("wallet alteration of exact article output cannot create a receipt or broadcast", async () => {
  const originalFetch = globalThis.fetch;
  let receiptCalled = false;
  let posted = false;
  globalThis.fetch = async () => { posted = true; assert.fail("altered signed transaction must not broadcast"); };
  try {
    await assert.rejects(signAndBroadcastBoostPsbt({ ...parameters,
      wallet: { signPsbt: async () => signed(unsigned(`${body}altered`).toHex()).toHex() },
      onSigned: () => { receiptCalled = true; },
    }), /UniSat changed the transaction/u);
    assert.equal(receiptCalled, false);
    assert.equal(posted, false);
  } finally { globalThis.fetch = originalFetch; }
});
