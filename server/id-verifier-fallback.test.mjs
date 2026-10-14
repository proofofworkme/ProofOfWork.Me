import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import vm from "node:vm";
import * as bitcoin from "bitcoinjs-lib";
import ts from "typescript";
import { canonicalProtocolCandidateFromOutput } from "./canonical-op-return.mjs";
import { workAmoV5HasNoTextStorageNul } from "./work-amo-v5.mjs";

// Extract the production parser and verifier without starting the API or a DB.
const source = readFileSync(new URL("./proof-api.mjs", import.meta.url), "utf8");
const parsedSource = ts.createSourceFile("proof-api.mjs", source, ts.ScriptTarget.Latest, true);
const functions = new Map(parsedSource.statements.filter(ts.isFunctionDeclaration)
  .map(node => [node.name.text, node.getText(parsedSource)]));
const constants = new Map(parsedSource.statements.filter(ts.isVariableStatement)
  .flatMap(node => node.declarationList.declarations)
  .map(node => [node.name.getText(parsedSource), node.initializer?.getText(parsedSource)]));
const TXID = "a".repeat(64);
const OTHER_TXID = "b".repeat(64);
const ADDRESS = "1F1zepCJ8VPcPoeMt6G4BPKuE3CYAxCKNY";
const ID = Buffer.from("satsfund").toString("base64url");
const REGISTRATION = `pwid1:r2:${ID}:${ADDRESS}:${ADDRESS}`;
const MALFORMED_REASON = "Malformed ProofOfWork ID protocol payload.";
const PAYMENT_REASON = "Required ProofOfWork ID registry payment is missing or misplaced.";

function transaction(messages = [REGISTRATION], { payment = 1000, paymentAfter = false } = {}) {
  const carriers = messages.map(message => {
    const script = bitcoin.script.compile([bitcoin.opcodes.OP_RETURN, Buffer.from(message)]);
    return { value: 0, scriptpubkey: Buffer.from(script).toString("hex"),
      scriptpubkey_type: "op_return", scriptpubkey_asm: bitcoin.script.toASM(script) };
  });
  const paid = { value: payment, scriptpubkey_address: ADDRESS,
    scriptpubkey: Buffer.from(bitcoin.address.toOutputScript(ADDRESS)).toString("hex") };
  return { txid: TXID, status: { confirmed: false },
    vout: paymentAfter ? [...carriers, paid] : [paid, ...carriers] };
}

function runtime(tx, { bundle = { state: { activity: [], sales: [], listings: [] }, transactions: [] },
  rpcFailure = false, bundleFailure = false } = {}) {
  let rpcReads = 0;
  const context = vm.createContext({
    Buffer, bitcoin, canonicalProtocolCandidateFromOutput, workAmoV5HasNoTextStorageNul,
    BITCOIN_ADDRESS_VALIDATION_CACHE: new Map(), BITCOIN_ADDRESS_VALIDATION_CACHE_MAX: 20_000,
    INTERNAL_VERIFIER_STATE_CACHE: new Map(), WORK_AMO_V5_ACTIVATION_HEIGHT: 959621,
    registryAddressForNetwork: () => ADDRESS,
    cachedInternalVerifierState: async (_key, loader) => loader(),
    idVerifierStateBundle: async () => {
      if (bundleFailure) throw new Error("Registry hydration unavailable.");
      return bundle;
    },
    fetchTransactionFromBitcoinRpc: async () => {
      rpcReads += 1;
      if (rpcFailure) throw new Error("Core unavailable.");
      return tx;
    },
  });
  const names = [
    "bitcoinNetwork", "isValidBitcoinAddress", "normalizePowId", "base64FromBase64Url",
    "base64UrlDecodeBytes", "decodeTextBase64Url", "decodeHex", "decodedOpReturnMessages",
    "decodedProtocolMessages", "firstRegistryProtocolOutputIndex", "firstIdProtocolOutputIndex",
    "paymentAmountBeforeIdProtocol", "parseIdRegistrationPayload", "parseIdReceiverUpdatePayload",
    "parseIdTransferPayload", "parseIdMarketplaceTransferPayload", "parseIdListingPayload",
    "parseIdSaleSealPayload", "parseIdDelistingPayload", "parseIdEventPayload",
    "transactionTxid", "transactionConfirmed", "transactionBlockHeight", "indexedThroughBlockFromTransactions",
    "exactVerifierPositionInteger", "canonicalVerifierItemPosition", "idVerifierItemsFromState",
    "idVerifierDeterministicInvalidReason", "idVerifierPayload",
  ];
  const constantNames = ["ID_PROTOCOL_PREFIX", "ID_REGISTRATION_PRICE_SATS", "ID_MUTATION_PRICE_SATS"];
  vm.runInContext([
    ...constantNames.map(name => { assert.ok(constants.has(name)); return `const ${name} = ${constants.get(name)};`; }),
    ...names.map(name => { assert.ok(functions.has(name)); return functions.get(name); }),
  ].join("\n"), context);
  return { api: context, rpcReads: () => rpcReads };
}

async function invalidReason(tx, options) {
  return runtime(tx, options).api.idVerifierDeterministicInvalidReason("livenet", {}, TXID, false);
}

function unresolved(error) {
  return error.statusCode === 503 && error.details?.code === "ID_VERIFIER_UNRESOLVED" &&
    error.details.txid === TXID;
}

test("valid prefixed historical/current registrations and mutations are not malformed", async () => {
  for (const [message, payment] of [
    [`pwid1:r:satsfund:${ADDRESS}:${ADDRESS}`, 1000], [REGISTRATION, 1000],
    [`pwid1:u:${ID}:${ADDRESS}`, 546], [`pwid1:t:${ID}:${ADDRESS}:${ADDRESS}`, 546],
  ]) {
    assert.equal(await invalidReason(transaction([message], { payment })), "", message);
  }
});

test("malformed payloads and invalid addresses still have deterministic rejection", async () => {
  for (const message of ["pwid1:r2:broken", `pwid1:r2:${ID}:invalid:${ADDRESS}`, "pwid1:unsupported:record"]) {
    assert.equal(await invalidReason(transaction([message])), MALFORMED_REASON);
  }
});

test("registry fees remain exact per carrier and must precede the protocol", async () => {
  for (const tx of [transaction([REGISTRATION], { payment: 999 }),
    transaction([REGISTRATION], { paymentAfter: true }),
    transaction([REGISTRATION, REGISTRATION], { payment: 1000 }),
    transaction([`pwid1:u:${ID}:${ADDRESS}`], { payment: 545 })]) {
    assert.equal(await invalidReason(tx), PAYMENT_REASON);
  }
  assert.equal(await invalidReason(transaction([REGISTRATION, REGISTRATION], { payment: 2000 })), "");
});

test("missing raw evidence or a different protocol cannot establish invalid ID state", async () => {
  assert.equal(await invalidReason(null), "");
  assert.equal(await invalidReason(null, { rpcFailure: true }), "");
  assert.equal(await invalidReason(transaction([`pwdns1:r1:${ID}:${ADDRESS}:${ADDRESS}`])), "");
});

test("a valid pending target omitted from cached state remains retryable, never terminal invalid", async () => {
  const tx = transaction();
  for (const transactions of [[], [tx], [{ ...tx, txid: OTHER_TXID }]]) {
    const bundle = { state: { activity: [], sales: [], listings: [] }, transactions };
    const { api } = runtime(tx, { bundle });
    await assert.rejects(api.idVerifierPayload("livenet", TXID), unresolved);
  }
});

test("unavailable Core or registry hydration cannot produce a terminal-invalid response", async () => {
  const unavailableCore = runtime(null, { rpcFailure: true });
  await assert.rejects(unavailableCore.api.idVerifierPayload("livenet", TXID), unresolved);
  const unavailableBundle = runtime(transaction(), { bundleFailure: true });
  await assert.rejects(unavailableBundle.api.idVerifierPayload("livenet", TXID), /Registry hydration unavailable/u);
  assert.equal(unavailableBundle.rpcReads(), 0);
});

test("proven malformed or unpaid pending targets still return invalid verifier evidence", async () => {
  for (const [tx, expected] of [[transaction(["pwid1:r2:broken"]), MALFORMED_REASON],
    [transaction([REGISTRATION], { payment: 999 }), PAYMENT_REASON]]) {
    const { api } = runtime(tx);
    const result = await api.idVerifierPayload("livenet", TXID);
    assert.equal(result.items.length, 1);
    assert.equal(result.items[0].kind, "id-event-invalid");
    assert.equal(result.items[0].valid, false);
    assert.equal(result.items[0].confirmed, false);
    assert.equal(result.items[0].reason, expected);
  }
});

test("an accepted pending target retains its exact evidence without invoking fallback", async () => {
  const item = { txid: TXID, kind: "id-register", confirmed: false, valid: true,
    id: "satsfund", ownerAddress: ADDRESS, receiveAddress: ADDRESS,
    protocolVout: 1, recordOrdinal: 0, createdAt: "2026-09-16T12:00:00.000Z" };
  const bundle = { state: { activity: [item], sales: [], listings: [] }, transactions: [transaction()] };
  const { api, rpcReads } = runtime(null, { bundle, rpcFailure: true });
  const result = await api.idVerifierPayload("livenet", TXID);
  assert.equal(result.items.length, 1);
  for (const [key, value] of Object.entries(item)) assert.equal(result.items[0][key], value, key);
  assert.equal(rpcReads(), 0);
});
