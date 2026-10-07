import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import ts from "typescript";
import * as bitcoin from "bitcoinjs-lib";
import * as ecc from "@bitcoinerlab/secp256k1";
import {
  SOCIAL_IDENTITY_REQUEST,
  SOCIAL_IDENTITY_RESPONSE,
  SOCIAL_IDENTITY_CHANGED,
  SOCIAL_IDENTITY_STORAGE_KEY,
  newestSocialIdentityIntent,
  readSocialIdentityIntent,
  socialIdentityAccountKey,
  socialIdentityIntentMessage,
  storeSocialIdentityIntent,
  trustedSocialIdentityOrigin,
  validSocialIdentityRequest,
  verifiedSocialIdentityIntent,
} from "../src/features/identity/socialIdentityCore.mjs";
import { verifyBitcoinMessageSignature, verifyBitcoinIdentityMessageSignature } from "../src/features/identity/bitcoinMessageVerifier.mjs";

bitcoin.initEccLib(ecc);
// Public, disposable deterministic fixture keys. They never come from a wallet.
const fixtureKey = Buffer.alloc(32, 1);
const fixtureOtherKey = Buffer.alloc(32, 2);
const fixturePublicKey = ecc.pointFromScalar(fixtureKey, true);
const fixtureAddress = bitcoin.payments.p2pkh({ pubkey: fixturePublicKey }).address;
const fixtureSegwit = bitcoin.payments.p2wpkh({ pubkey: fixturePublicKey }).address;
const fixtureTaproot = bitcoin.payments.p2tr({ internalPubkey: fixturePublicKey.subarray(1) }).address;
const createdAt = new Date(Date.now() - 60_000).toISOString();
const laterAt = new Date(Date.parse(createdAt) + 1000).toISOString();

function fixtureIntent({ address = fixtureAddress, id = "alice", time = createdAt, key = fixtureKey } = {}) {
  const fields = { address, createdAt: time, id, network: "livenet" };
  const message = socialIdentityIntentMessage(fields);
  const bytes = Buffer.from(message);
  const length = Buffer.alloc(3);
  length[0] = 0xfd;
  length.writeUInt16LE(bytes.length, 1);
  const hash = bitcoin.crypto.hash256(Buffer.concat([
    Buffer.from("\u0018Bitcoin Signed Message:\n"),
    bytes.length < 0xfd ? Buffer.from([bytes.length]) : length,
    bytes,
  ]));
  const signature = ecc.signRecoverable(hash, key);
  return { ...fields, message, signature: Buffer.concat([Buffer.from([31 + signature.recoveryId]), signature.signature]).toString("base64") };
}

function memoryStorage() {
  const map = new Map();
  return { getItem: key => map.get(key) ?? null, setItem: (key, value) => map.set(key, value) };
}

test("signed selection proves exact account, network, ID and creation time", () => {
  const intent = fixtureIntent();
  assert.deepEqual(verifiedSocialIdentityIntent(intent, fixtureAddress, "livenet"), intent);
  for (const change of [
    { address: fixtureSegwit }, { network: "testnet" }, { id: "bob" },
    { createdAt: laterAt }, { signature: fixtureIntent({ key: fixtureOtherKey }).signature },
    { message: `${intent.message}\nextra` }, { id: "ALICE" },
  ]) assert.equal(verifiedSocialIdentityIntent({ ...intent, ...change }, fixtureAddress, "livenet"), undefined);
  const future = fixtureIntent({ time: new Date(Date.now() + 600_000).toISOString() });
  assert.equal(verifiedSocialIdentityIntent(future), undefined, "future intent cannot suppress later choices");
});

test("legacy UniSat Taproot intent remains verifiable without relaxing sale signatures", () => {
  const intent = fixtureIntent({ address: fixtureTaproot });
  assert.equal(verifyBitcoinMessageSignature(intent.address, intent.message, intent.signature), false);
  assert.equal(verifyBitcoinIdentityMessageSignature(intent.address, intent.message, intent.signature), true);
  assert.deepEqual(verifiedSocialIdentityIntent(intent), intent);
  const wrong = fixtureIntent({ address: fixtureTaproot, key: fixtureOtherKey });
  assert.equal(verifiedSocialIdentityIntent(wrong), undefined);
});

test("storage migration preserves exact Base58 casing and other accounts", () => {
  const storage = memoryStorage();
  const intent = fixtureIntent();
  storage.setItem(SOCIAL_IDENTITY_STORAGE_KEY, JSON.stringify({
    [`livenet:${fixtureAddress.toLowerCase()}`]: intent,
    preserved: { historical: true },
  }));
  assert.deepEqual(readSocialIdentityIntent(storage, fixtureAddress, "livenet"), intent);
  assert.equal(readSocialIdentityIntent(storage, fixtureAddress.toLowerCase(), "livenet"), undefined);
  assert.equal(storeSocialIdentityIntent(storage, intent), true);
  assert.deepEqual(JSON.parse(storage.getItem(SOCIAL_IDENTITY_STORAGE_KEY)).preserved, { historical: true });
  assert.deepEqual(JSON.parse(storage.getItem(SOCIAL_IDENTITY_STORAGE_KEY))[socialIdentityAccountKey(fixtureAddress, "livenet")], intent);
  assert.equal(storeSocialIdentityIntent(storage, { ...intent, signature: "forged" }), false);
});

test("selection comparison is chronological and exact origins are allowlisted", () => {
  const first = fixtureIntent();
  const second = fixtureIntent({ id: "bob", time: laterAt });
  assert.deepEqual(newestSocialIdentityIntent(first, second), second);
  assert.deepEqual(newestSocialIdentityIntent(second, first), second);
  assert.equal(trustedSocialIdentityOrigin("https://boost.proofofwork.me", "https://computer.proofofwork.me"), true);
  assert.equal(trustedSocialIdentityOrigin("https://code.proofofwork.me", "https://computer.proofofwork.me"), true);
  for (const origin of ["https://evil.proofofwork.me", "https://boost.proofofwork.me.evil.test", "http://boost.proofofwork.me", "null"]) {
    assert.equal(trustedSocialIdentityOrigin(origin, "https://computer.proofofwork.me"), false);
  }
  assert.equal(trustedSocialIdentityOrigin("http://localhost:5173", "http://localhost:5173"), true);
  assert.equal(trustedSocialIdentityOrigin("http://localhost:5174", "http://localhost:5173"), false);
  const request = { type: SOCIAL_IDENTITY_REQUEST, nonce: "a".repeat(32), operation: "sync", address: fixtureAddress, network: "livenet" };
  assert.equal(validSocialIdentityRequest(request), true);
  for (const change of [{ nonce: "wrong" }, { operation: "sign" }, { network: "regtest" }, { type: "wrong" }]) {
    assert.equal(validSocialIdentityRequest({ ...request, ...change }), false);
  }
});

const coreUrl = new URL("../src/features/identity/socialIdentityCore.mjs", import.meta.url).href;
const apiStubUrl = `data:text/javascript,${encodeURIComponent("export async function fetchProofApiJson(path, network, options) { return globalThis.__identityRead(path, network, options); }")}`;
const identitySource = (await readFile(new URL("../src/features/identity/socialIdentity.ts", import.meta.url), "utf8"))
  .replace('"../../shared/api/proofApiClient"', JSON.stringify(apiStubUrl))
  .replace('"./socialIdentityCore.mjs"', JSON.stringify(coreUrl));
const transpile = (source, fileName) => ts.transpileModule(source, {
  fileName,
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
}).outputText;
const identityUrl = `data:text/javascript;base64,${Buffer.from(transpile(identitySource, "socialIdentity.ts")).toString("base64")}`;
const identity = await import(identityUrl);

test("fresh current ownership rejects a transferred ID and pending or cross-network records", async () => {
  const intent = fixtureIntent();
  const fresh = { network: "livenet", record: { confirmed: true, ownerAddress: fixtureAddress, id: "alice", network: "livenet" } };
  globalThis.__identityRead = async (path, network, options) => {
    assert.equal(path, "/api/v1/ids/alice?current=1&fresh=1");
    assert.equal(network, "livenet");
    assert.equal(options.timeoutMs, 15_000);
    return fresh;
  };
  assert.equal(await identity.confirmSocialIdentityOwner(intent), true);
  for (const record of [
    { ...fresh.record, confirmed: false }, { ...fresh.record, ownerAddress: fixtureSegwit },
    { ...fresh.record, network: "testnet" }, { ...fresh.record, id: "bob" }, null,
  ]) {
    globalThis.__identityRead = async () => ({ ...fresh, record });
    assert.equal(await identity.confirmSocialIdentityOwner(intent), false);
  }
});

const effectStub = `data:text/javascript,${encodeURIComponent("export function useEffect(fn) { globalThis.__identityCleanup = fn(); }")}`;
const bridgeSource = (await readFile(new URL("../src/features/identity/SocialIdentityBridge.tsx", import.meta.url), "utf8"))
  .replace('"react"', JSON.stringify(effectStub))
  .replace('"./socialIdentity"', JSON.stringify(identityUrl))
  .replace('"./socialIdentityCore.mjs"', JSON.stringify(coreUrl));
const bridgeJs = transpile(bridgeSource, "SocialIdentityBridge.tsx").replace('"react/jsx-runtime"', JSON.stringify(import.meta.resolve("react/jsx-runtime")));
const { default: Bridge } = await import(`data:text/javascript;base64,${Buffer.from(bridgeJs).toString("base64")}`);

test("bridge shares latest signed choices both ways and rejects forged parent messages", async () => {
  const storage = memoryStorage();
  const messages = [];
  const handlers = new Map();
  const parent = { postMessage: (value, origin) => messages.push({ value, origin }) };
  globalThis.window = {
    location: { origin: "https://computer.proofofwork.me" }, localStorage: storage, parent,
    addEventListener: (name, fn) => handlers.set(name, fn),
    removeEventListener: (name, fn) => { if (handlers.get(name) === fn) handlers.delete(name); },
  };
  globalThis.__identityRead = async (path, network) => ({ network, record: {
    confirmed: true, ownerAddress: fixtureAddress, id: decodeURIComponent(path.split("/").at(-1).split("?")[0]), network,
  } });
  Bridge();
  const send = (data, origin = "https://boost.proofofwork.me", source = parent) => handlers.get("message")({ data, origin, source });
  const request = { type: SOCIAL_IDENTITY_REQUEST, nonce: "a".repeat(32), operation: "sync", address: fixtureAddress, network: "livenet", intent: fixtureIntent() };
  await send(request, "https://evil.test");
  await send(request, "https://boost.proofofwork.me", {});
  assert.equal(messages.length, 0);
  assert.equal(storage.getItem(SOCIAL_IDENTITY_STORAGE_KEY), null);
  await send(request);
  assert.deepEqual(messages.at(-1), { value: { type: SOCIAL_IDENTITY_RESPONSE, nonce: request.nonce, address: fixtureAddress, network: "livenet", intent: request.intent }, origin: "https://boost.proofofwork.me" });
  const second = fixtureIntent({ id: "bob", time: laterAt });
  await send({ ...request, nonce: "b".repeat(32), intent: second }, "https://publish.proofofwork.me");
  assert.deepEqual(messages.at(-1).value.intent, second);
  await send({ ...request, nonce: "c".repeat(32), intent: request.intent });
  assert.deepEqual(messages.at(-1).value.intent, second, "revisiting Boost cannot replace a newer Publish selection");
  await send({ ...request, nonce: "d".repeat(32), operation: "subscribe", intent: undefined });
  handlers.get("storage")({ key: SOCIAL_IDENTITY_STORAGE_KEY, storageArea: storage });
  assert.equal(messages.at(-1).value.type, SOCIAL_IDENTITY_CHANGED);
  assert.equal(messages.at(-1).value.nonce, "d".repeat(32));
  globalThis.__identityCleanup();
  delete globalThis.window;
});

test("bridge refuses forged signatures and signatures whose ID changed owner", async () => {
  const storage = memoryStorage();
  const responses = [];
  const handlers = new Map();
  const parent = { postMessage: response => responses.push(response) };
  globalThis.window = {
    location: { origin: "https://computer.proofofwork.me" }, localStorage: storage, parent,
    addEventListener: (name, fn) => handlers.set(name, fn), removeEventListener: name => handlers.delete(name),
  };
  globalThis.__identityRead = async () => ({ network: "livenet", record: { confirmed: true, ownerAddress: fixtureSegwit, id: "alice" } });
  Bridge();
  for (const intent of [fixtureIntent(), { ...fixtureIntent(), signature: "forged" }]) {
    await handlers.get("message")({ source: parent, origin: "https://publish.proofofwork.me", data: {
      type: SOCIAL_IDENTITY_REQUEST, nonce: "a".repeat(32), operation: "sync", address: fixtureAddress, network: "livenet", intent,
    } });
    assert.equal(responses.at(-1).intent, undefined);
    assert.equal(storage.getItem(SOCIAL_IDENTITY_STORAGE_KEY), null);
  }
  globalThis.__identityCleanup();
  delete globalThis.window;
});

test("client imports only exact bridge source, origin, nonce, account and verified ownership", async () => {
  const handlers = new Map();
  const storage = memoryStorage();
  const expected = fixtureIntent({ id: "bob", time: laterAt });
  const forgedPreference = fixtureIntent({ id: "malicious", time: new Date(Date.parse(laterAt) + 1000).toISOString() });
  const dispatch = event => { for (const handler of handlers.get("message") ?? []) handler(event); };
  const frameWindow = {
    postMessage: (request, targetOrigin) => {
      assert.equal(targetOrigin, "https://computer.proofofwork.me");
      const response = { type: SOCIAL_IDENTITY_RESPONSE, nonce: request.nonce, address: request.address, network: request.network, intent: forgedPreference };
      dispatch({ origin: "https://evil.test", source: frameWindow, data: response });
      dispatch({ origin: targetOrigin, source: {}, data: response });
      dispatch({ origin: targetOrigin, source: frameWindow, data: { ...response, nonce: "f".repeat(32) } });
      dispatch({ origin: targetOrigin, source: frameWindow, data: { ...response, address: fixtureSegwit } });
      dispatch({ origin: targetOrigin, source: frameWindow, data: { ...response, network: "testnet" } });
      dispatch({ origin: targetOrigin, source: frameWindow, data: { ...response, intent: expected } });
    },
  };
  const frame = { contentWindow: frameWindow, remove() {} };
  globalThis.window = {
    location: { origin: "https://boost.proofofwork.me" }, localStorage: storage,
    setTimeout, clearTimeout, setInterval, clearInterval,
    addEventListener: (name, handler) => {
      if (!handlers.has(name)) handlers.set(name, new Set());
      handlers.get(name).add(handler);
    },
    removeEventListener: (name, handler) => handlers.get(name)?.delete(handler),
  };
  globalThis.document = {
    createElement: name => { assert.equal(name, "iframe"); return frame; },
    body: { append: value => { assert.equal(value, frame); queueMicrotask(() => frame.onload()); } },
  };
  globalThis.__identityRead = async (path, network) => ({ network, record: { id: "bob", confirmed: true, ownerAddress: fixtureAddress, network } });
  assert.deepEqual(await identity.syncSocialIdentityIntent(fixtureAddress, "livenet"), expected);
  assert.deepEqual(readSocialIdentityIntent(storage, fixtureAddress, "livenet"), expected);
  assert.equal((handlers.get("message") ?? new Set()).size, 0, "request listener is removed after settlement");
  assert.equal(await identity.syncSocialIdentityIntent(fixtureAddress, "livenet", async () => false), undefined, "receiver rejects a signed choice after ownership changes");
  delete globalThis.window;
  delete globalThis.document;
});
