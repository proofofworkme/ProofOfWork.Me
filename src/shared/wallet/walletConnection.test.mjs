import assert from "node:assert/strict";
import { test } from "node:test";
import { createWalletConnectionController } from "./walletConnection.mjs";

const ADDRESS = "bc1qconnected";
function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
function provider(overrides = {}) {
  const calls = [];
  const wallet = {
    requestAccounts: async () => { calls.push("requestAccounts"); return [ADDRESS]; },
    getAccounts: async () => { calls.push("getAccounts"); return [ADDRESS]; },
    getChain: async () => { calls.push("getChain"); return { enum: "BITCOIN_MAINNET" }; },
    ...overrides,
  };
  return { wallet, calls };
}
const createFast = () => createWalletConnectionController({ authorizationTimeoutMs: 25, stageTimeoutMs: 25, switchTimeoutMs: 25 });

test("connection completes only after fresh account and final network verification", async () => {
  const { wallet, calls } = provider();
  const stages = [];
  const controller = createFast();
  const result = await controller.connect(wallet, { onStage: ({ stage }) => stages.push(stage) });
  assert.deepEqual(result, { address: ADDRESS, network: "livenet" });
  assert.deepEqual(calls, ["requestAccounts", "getChain", "getAccounts", "getChain"]);
  assert.deepEqual(stages, ["accounts", "network", "verify", "network"]);
  assert.equal(controller.isConnecting, false);
});

test("simultaneous clicks own one attempt and authorization prompt", async () => {
  const gate = deferred();
  let requests = 0;
  const { wallet } = provider({ requestAccounts: () => { requests += 1; return gate.promise; } });
  const controller = createFast();
  const first = controller.connect(wallet);
  const second = controller.connect(wallet);
  assert.equal(first, second);
  await Promise.resolve(); await Promise.resolve();
  assert.equal(controller.isConnecting, true);
  assert.equal(requests, 1);
  gate.resolve([ADDRESS]);
  await first;
  assert.equal(controller.isConnecting, false);
});

test("an authorization timeout releases local busy ownership and retry reuses its pending prompt", async () => {
  const gate = deferred();
  let requests = 0;
  let authorized = false;
  const { wallet } = provider({
    requestAccounts: () => { requests += 1; return gate.promise.then((accounts) => { authorized = true; return accounts; }); },
    getAccounts: async () => authorized ? [ADDRESS] : [],
  });
  const controller = createFast();
  await assert.rejects(controller.connect(wallet), (error) => error.code === "timeout" && error.stage === "accounts" && /then retry/u.test(error.message));
  assert.equal(controller.isConnecting, false);
  const retry = controller.connect(wallet);
  await Promise.resolve(); await Promise.resolve();
  assert.equal(requests, 1);
  gate.resolve([ADDRESS]);
  assert.deepEqual(await retry, { address: ADDRESS, network: "livenet" });
  assert.equal(requests, 1);
});

test("retry can recover an authorized account even when the original authorization never resolves", async () => {
  const gate = deferred(); let requests = 0; let authorized = false;
  const { wallet } = provider({
    requestAccounts: () => { requests += 1; return gate.promise; },
    getAccounts: async () => authorized ? [ADDRESS] : [],
  });
  const controller = createFast();
  await assert.rejects(controller.connect(wallet), (error) => error.code === "timeout");
  authorized = true;
  assert.deepEqual(await controller.connect(wallet), { address: ADDRESS, network: "livenet" });
  assert.equal(requests, 1);
  gate.resolve(["bc1qobsolete"]);
  await Promise.resolve(); await Promise.resolve();
  assert.equal(controller.isConnecting, false);
});

test("late authorization cannot start network calls or publish stages after cancellation", async () => {
  const gate = deferred();
  let networks = 0;
  const stages = [];
  const { wallet } = provider({ requestAccounts: () => gate.promise, getChain: async () => { networks += 1; return { enum: "BITCOIN_MAINNET" }; } });
  const controller = createFast();
  const old = controller.connect(wallet, { onStage: ({ stage }) => stages.push(stage) });
  await Promise.resolve(); await Promise.resolve();
  controller.invalidate();
  await assert.rejects(old, (error) => error.code === "stale");
  gate.resolve([ADDRESS]);
  await Promise.resolve(); await Promise.resolve();
  assert.equal(networks, 0);
  assert.deepEqual(stages, ["accounts"]);
  assert.equal(controller.isConnecting, false);
});

test("a stale completion cannot clear a newer attempt's ownership", async () => {
  const oldGate = deferred(); const newGate = deferred();
  const oldWallet = provider({ requestAccounts: () => oldGate.promise }).wallet;
  const newWallet = provider({ requestAccounts: () => newGate.promise }).wallet;
  const controller = createFast();
  const first = controller.connect(oldWallet);
  const failed = assert.rejects(first, (error) => error.code === "stale");
  await Promise.resolve(); await Promise.resolve();
  const second = controller.connect(newWallet);
  await failed;
  assert.equal(controller.isConnecting, true);
  oldGate.resolve(["bc1qobsolete"]);
  newGate.resolve([ADDRESS]);
  assert.deepEqual(await second, { address: ADDRESS, network: "livenet" });
});

test("network discovery has its own bounded, retryable stage", async () => {
  const gate = deferred();
  let reads = 0;
  const { wallet } = provider({ getChain: () => { reads += 1; return gate.promise; } });
  const controller = createFast();
  await assert.rejects(controller.connect(wallet), (error) => error.code === "timeout" && error.stage === "network");
  const retry = controller.connect(wallet);
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(reads, 2);
  gate.resolve({ enum: "BITCOIN_MAINNET" });
  await retry;
  assert.equal(reads, 3); // retry and final verification are fresh provider reads
});

test("retry starts fresh network discovery instead of remaining tied to an unresolved read", async () => {
  const gate = deferred(); let reads = 0;
  const { wallet } = provider({ getChain: () => ++reads === 1 ? gate.promise : Promise.resolve({ enum: "BITCOIN_MAINNET" }) });
  const controller = createFast();
  await assert.rejects(controller.connect(wallet), (error) => error.code === "timeout" && error.stage === "network");
  assert.deepEqual(await controller.connect(wallet), { address: ADDRESS, network: "livenet" });
  assert.equal(reads, 3);
  gate.resolve({ enum: "BITCOIN_TESTNET" });
  await Promise.resolve(); await Promise.resolve();
  assert.equal(controller.isConnecting, false);
});

test("account read-only synchronization never requests authorization", async () => {
  const { wallet, calls } = provider();
  await createFast().connect(wallet, { authorize: false });
  assert.deepEqual(calls, ["getAccounts", "getChain", "getAccounts", "getChain"]);
});

test("older providers fall back to supported legacy network discovery", async () => {
  const { wallet } = provider({ getChain: async () => { throw new Error("Method not supported"); }, getNetwork: async () => "testnet" });
  assert.deepEqual(await createFast().connect(wallet), { address: ADDRESS, network: "testnet" });
});

test("a prototype property or unsupported network never becomes network authority", async () => {
  const { wallet } = provider({ getChain: async () => ({ enum: "toString" }), getNetwork: async () => "fractal-mainnet" });
  await assert.rejects(createFast().connect(wallet), (error) => error.code === "network-unavailable");
});

test("required mainnet switching verifies both the final account and chain", async () => {
  let chain = "BITCOIN_TESTNET4";
  const switches = [];
  const { wallet } = provider({
    getChain: async () => ({ enum: chain }),
    switchChain: async (target) => { switches.push(target); chain = target; },
  });
  assert.deepEqual(await createFast().connect(wallet, { requiredNetwork: "livenet" }), { address: ADDRESS, network: "livenet" });
  assert.deepEqual(switches, ["BITCOIN_MAINNET"]);
});

test("network switch timeout cannot issue a second matching switch prompt on retry", async () => {
  const gate = deferred(); let chain = "BITCOIN_TESTNET4"; let switches = 0;
  const { wallet } = provider({
    getChain: async () => ({ enum: chain }),
    switchChain: () => { switches += 1; return gate.promise.then(() => { chain = "BITCOIN_MAINNET"; }); },
  });
  const controller = createFast();
  await assert.rejects(controller.connect(wallet, { requiredNetwork: "livenet" }), (error) => error.code === "timeout" && error.stage === "switch");
  const retry = controller.connect(wallet, { requiredNetwork: "livenet" });
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(switches, 1);
  gate.resolve();
  await retry;
  assert.equal(switches, 1);
});

test("resolved switch is not accepted if the provider remains on the wrong network", async () => {
  const { wallet } = provider({ getChain: async () => ({ enum: "BITCOIN_TESTNET" }), switchChain: async () => undefined });
  await assert.rejects(createFast().connect(wallet, { requiredNetwork: "livenet" }), (error) => error.code === "network-mismatch");
});

test("Testnet4 cannot be claimed through the ambiguous legacy switch API", async () => {
  let switched = false;
  const { wallet } = provider({ switchNetwork: async () => { switched = true; return "testnet"; } });
  await assert.rejects(createFast().connect(wallet, { requiredNetwork: "testnet4" }), (error) => error.code === "network-mismatch");
  assert.equal(switched, false);
});

test("account changes during network verification fail closed", async () => {
  const { wallet } = provider({ getAccounts: async () => ["bc1qdifferent"] });
  await assert.rejects(createFast().connect(wallet), (error) => error.code === "account-changed");
});

test("network changes during final account verification fail closed", async () => {
  let reads = 0;
  const { wallet } = provider({ getChain: async () => ({ enum: ++reads === 1 ? "BITCOIN_MAINNET" : "BITCOIN_TESTNET" }) });
  await assert.rejects(createFast().connect(wallet), (error) => error.code === "network-changed");
});

test("a rejected authorization recovers on a later independent attempt", async () => {
  let requests = 0;
  const { wallet } = provider({ requestAccounts: async () => {
    if (++requests === 1) throw new Error("User rejected the request.");
    return [ADDRESS];
  } });
  const controller = createFast();
  await assert.rejects(controller.connect(wallet), /User rejected/u);
  assert.equal(controller.isConnecting, false);
  assert.deepEqual(await controller.connect(wallet), { address: ADDRESS, network: "livenet" });
});

test("external account/workspace generations fence subsequent reads and results", async () => {
  const gate = deferred(); let current = true; let networks = 0;
  const { wallet } = provider({ requestAccounts: () => gate.promise, getChain: async () => { networks += 1; return { enum: "BITCOIN_MAINNET" }; } });
  const controller = createFast();
  const result = controller.connect(wallet, { isCurrent: () => current });
  await Promise.resolve(); await Promise.resolve();
  current = false;
  gate.resolve([ADDRESS]);
  await assert.rejects(result, (error) => error.code === "stale");
  assert.equal(networks, 0);
});

test("fresh account verification is required even when authorization returned an account", async () => {
  const { wallet } = provider({ getAccounts: undefined });
  await assert.rejects(createFast().connect(wallet), (error) => error.code === "account-unavailable");
});

test("late provider rejection after a deadline is contained", async () => {
  const gate = deferred();
  const { wallet } = provider({ requestAccounts: () => gate.promise });
  const controller = createFast();
  await assert.rejects(controller.connect(wallet), (error) => error.code === "timeout");
  gate.reject(new Error("Late user rejection"));
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(controller.isConnecting, false);
});

test("replacement immediately settles externally stale ownership instead of waiting for its deadline", async () => {
  const gate = deferred(); let current = true;
  const { wallet } = provider({ requestAccounts: () => gate.promise });
  const controller = createWalletConnectionController({ authorizationTimeoutMs: 10_000 });
  const obsolete = controller.connect(wallet, { isCurrent: () => current });
  const rejected = assert.rejects(obsolete, (error) => error.code === "stale");
  await Promise.resolve(); await Promise.resolve();
  current = false;
  const freshWallet = provider().wallet;
  const replacement = controller.connect(freshWallet);
  await rejected;
  assert.deepEqual(await replacement, { address: ADDRESS, network: "livenet" });
  gate.reject(new Error("Obsolete provider rejection"));
  await new Promise((resolve) => setTimeout(resolve, 0));
});

test("provider rejection is converted to stale after an external generation change", async () => {
  const gate = deferred(); let current = true;
  const { wallet } = provider({ requestAccounts: () => gate.promise });
  const controller = createFast();
  const obsolete = controller.connect(wallet, { isCurrent: () => current });
  await Promise.resolve(); await Promise.resolve();
  current = false;
  gate.reject(new Error("Old account failure"));
  await assert.rejects(obsolete, (error) => error.code === "stale");
});
