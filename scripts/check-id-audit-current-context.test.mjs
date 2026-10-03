#!/usr/bin/env node
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";

const source = readFileSync(new URL("../server/proof-api.mjs", import.meta.url), "utf8");
const parsed = ts.createSourceFile("proof-api.mjs", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
function declaration(name) {
  const node = parsed.statements.find((item) => ts.isFunctionDeclaration(item) && item.name?.text === name);
  assert.ok(node, `Missing function ${name}`);
  return node;
}
function load(name, bindings) {
  return new Function(...Object.keys(bindings), `return (${declaration(name).getText(parsed)});`)(...Object.values(bindings));
}
const current = "a".repeat(64), previous = "b".repeat(64), txid = "c".repeat(64);
function bundleFixture({ precisionActivationHeight = 200, latch = { reached: true, markerReady: true, activationHeight: 200, pins: { activationHeight: 200 } }, projection = null } = {}) {
  const calls = [];
  const make = (kind) => async (...args) => {
    calls.push([kind, args]);
    return { blockHash: current, previousBlockHash: previous, coverageHeight: args[1], indexedThroughBlock: args[1], transactions: kind === "history" ? [{ txid: "old" }, { txid }] : [{ txid }] };
  };
  const fn = load("completeIdVerifierStateBundle", {
    registryAddressForNetwork: () => "registry", WORK_AMO_V5_ACTIVATION_HEIGHT: 100,
    configuredWorkAmoV8Declaration: () => precisionActivationHeight === null ? null : ({ activationHeight: precisionActivationHeight }),
    proofIndexWorkAmoV8ActivationLatch: async (...args) => { calls.push(["precision-latch", args]); if (latch instanceof Error) throw latch; return latch; },
    canonicalVerifierCurrentBlockContextFromCheckpoint: make("current"), canonicalVerifierContextFromCheckpoint: make("history"),
    cachedWorkAmoV5BlockProjection: async (context) => { calls.push(["projection", context]); return projection ? projection(context) : { transition: { complete: true } }; },
    workAmoV5IdVerifierStateFromProjection: () => ({ records: [] }),
    idRegistryStateFromTransactions: (transactions) => ({ historicalTransactions: transactions }),
  });
  return { fn, calls };
}
for (const [label, height, options, expected] of [
  ["default post-activation retains full historical context", 101, undefined, "history"],
  ["explicit false retains full historical context", 101, { auditCurrentBlockOnly: false }, "history"],
  ["truthy nonboolean does not narrow context", 101, { auditCurrentBlockOnly: 1 }, "history"],
  ["opted pre-activation retains full historical context", 99, { auditCurrentBlockOnly: true }, "history"],
  ["activation uses full shared projection with current context", 100, { auditCurrentBlockOnly: true }, "current"],
  ["post-activation audit uses current context", 101, { auditCurrentBlockOnly: true }, "current"],
]) test(label, async () => {
  const { fn, calls } = bundleFixture();
  const value = await fn("livenet", height, current, previous, options);
  assert.equal(calls[0][0], expected); assert.deepEqual(calls[0][1], ["livenet", height, current, previous]);
  assert.equal(value.transactions.length, expected === "history" ? 2 : 1);
  assert.equal(calls.filter(([kind]) => kind === "projection").length, height >= 100 ? 1 : 0);
  if (height < 100) assert.deepEqual(value.state.historicalTransactions, value.transactions);
});
test("audit post-precision requires a ready exact persistent latch before shared projection", async () => {
  const { fn, calls } = bundleFixture(); await fn("livenet", 201, current, previous, { auditCurrentBlockOnly: true });
  assert.deepEqual(calls[1], ["precision-latch", ["livenet", { activationHeight: 200 }]]); assert.equal(calls[2][0], "projection");
});
for (const [name, latch] of [["absent latch", null], ["unreached latch", { reached: false }], ["missing marker", { reached: true, markerReady: false }], ["wrong activation", { reached: true, markerReady: true, activationHeight: 199, pins: { activationHeight: 200 } }], ["wrong declaration pins", { reached: true, markerReady: true, activationHeight: 200, pins: { activationHeight: 199 } }], ["latch read unavailable", new Error("unavailable")]]) test(`audit refuses ${name} even if stored legacy payload would match`, async () => {
  const { fn, calls } = bundleFixture({ latch });
  await assert.rejects(fn("livenet", 201, current, previous, { auditCurrentBlockOnly: true }), /requires the active persistent Q16 migration latch/u);
  assert.equal(calls.some(([kind]) => kind === "projection"), false);
});
test("default post-precision behavior retains existing full-history path", async () => {
  const { fn, calls } = bundleFixture({ latch: null }); await fn("livenet", 201, current, previous); assert.equal(calls[0][0], "history"); assert.equal(calls.some(([kind]) => kind === "precision-latch"), false);
});
for (const configured of [null, 0, 1.5]) test(`unconfigured or invalid precision pins (${configured}) retain full historical discovery`, async () => {
  const { fn, calls } = bundleFixture({ precisionActivationHeight: configured, latch: null }); await fn("livenet", 201, current, previous, { auditCurrentBlockOnly: true }); assert.equal(calls[0][0], "history"); assert.equal(calls.some(([kind]) => kind === "precision-latch"), false);
});
function contextFixture({ checkpoint = {}, core = previous } = {}) {
  const calls = [];
  const carrier = { txid, blockIndex: 2, rawHex: "unchanged-carrier" };
  const fn = load("canonicalVerifierCurrentBlockContextFromCheckpoint", {
    proofIndexCanonicalCheckpointPayload: async (...args) => { calls.push(["checkpoint", args]); return { indexedThroughBlock: 200, checkpointHash: previous, fault: { active: false }, ...checkpoint }; },
    bitcoinRpc: async (...args) => { calls.push(["core-parent", args]); return { ok: true, result: core }; },
    canonicalVerifierCurrentBlock: async (...args) => { calls.push(["core-current", args]); return { blockHash: current, blockHeaderHex: "header", blockTransactions: [carrier], transactions: [carrier] }; },
  });
  return { fn, calls, carrier };
}
test("current context binds DB parent, fresh Core parent and full carrier positions", async () => {
  const { fn, calls, carrier } = contextFixture(); const result = await fn("livenet", 201, current, previous);
  assert.deepEqual(calls, [["checkpoint", ["livenet", 200]], ["core-parent", ["getblockhash", [200]]], ["core-current", ["livenet", 201, previous, current]]]);
  assert.equal(result.transactions[0], carrier); assert.equal(result.blockTransactions[0], carrier);
  assert.equal(result.coverageHeight, 201); assert.equal(result.indexedThroughBlock, 201); assert.equal(result.previousBlockHash, previous);
});
for (const [name, height, hash, prev] of [["zero height", 0, current, previous], ["fractional height", 1.5, current, previous], ["missing current hash", 201, "", previous], ["missing previous hash", 201, current, ""]]) test(`current context refuses ${name} before reads`, async () => {
  const { fn, calls } = contextFixture(); await assert.rejects(fn("livenet", height, hash, prev)); assert.deepEqual(calls, []);
});
for (const [name, checkpoint] of [["wrong parent height", { indexedThroughBlock: 199 }], ["wrong DB parent hash", { checkpointHash: current }], ["active DB fault", { fault: { active: true } }]]) test(`current context refuses ${name} before Core replay`, async () => {
  const { fn, calls } = contextFixture({ checkpoint }); await assert.rejects(fn("livenet", 201, current, previous), /DB coverage/u); assert.equal(calls.length, 1);
});
test("current context refuses fresh Core parent mismatch before current block", async () => {
  const { fn, calls } = contextFixture({ core: current }); await assert.rejects(fn("livenet", 201, current, previous), /no longer matches/u); assert.equal(calls.length, 2);
});
function precisionFixture({ reached = true, ready = true, discovery = { checked: true, declaration: null }, configuredHeight = 200 } = {}) {
  const calls = [];
  const fn = load("workAmoV8ReplayInputsForBlock", {
    configuredWorkAmoV8Declaration: () => ({ txid, blockHash: previous, activationHeight: configuredHeight, memoSha256: current }),
    cachedWorkAmoV8ReplayInputs: null,
    proofIndexWorkAmoV8ActivationLatch: async () => { calls.push("latch"); return { reached, markerReady: ready, activationHeight: 200, pins: { activationHeight: 200 } }; },
    discoverExactWorkAmoV8Declaration: async (network, options) => { calls.push([network, options]); return discovery; },
    WORK_SUBATOM_PROJECTION_MODEL: "work-subatom-q16-v1",
  });
  return { fn, calls };
}
const context = { coverageHeight: 201, indexedThroughBlock: 201, transactions: [{ txid }] };
test("precision path uses persistent ready Q16 latch", async () => {
  const { fn, calls } = precisionFixture(); assert.deepEqual(await fn(context, 201), { workAmoV8: { activationHeight: 200, amountStorageModel: "work-subatom-q16-v1" } }); assert.deepEqual(calls, ["latch"]);
});
test("configured activation does not apply Q16 to historical preceding block", async () => {
  const { fn, calls } = precisionFixture(); assert.deepEqual(await fn({ coverageHeight: 199, indexedThroughBlock: 199 }, 199), { workAmoV8: null }); assert.deepEqual(calls, []);
});
test("reached latch without ready migration marker refuses", async () => { const { fn } = precisionFixture({ ready: false }); await assert.rejects(fn(context, 201), /migration evidence is unavailable/u); });
test("missing latch with discovered historical declaration refuses", async () => { const { fn } = precisionFixture({ reached: false, discovery: { checked: true, declaration: { activationHeight: 200 } } }); await assert.rejects(fn(context, 201), /without a persistent Q16 migration latch/u); });
test("unavailable declaration discovery refuses", async () => { const { fn } = precisionFixture({ reached: false, discovery: { checked: false } }); await assert.rejects(fn(context, 201), /discovery is unavailable/u); });
test("precision context height drift refuses before latch", async () => { const { fn, calls } = precisionFixture(); await assert.rejects(fn({ ...context, coverageHeight: 200 }, 201), /does not match/u); assert.deepEqual(calls, []); });
const canonicalBindings = { createHash, compareCanonicalUtf8: (a, b) => Buffer.compare(Buffer.from(a), Buffer.from(b)) };
canonicalBindings.registryAuditCanonicalJson = load("registryAuditCanonicalJson", canonicalBindings);
const projectionHash = load("registryAuditProjectionSha256", canonicalBindings);
function replayPage(bundle) {
  let arrow;
  function find(node) { if (ts.isPropertyAssignment(node) && node.name.getText(parsed) === "onPage" && ts.isArrowFunction(node.initializer)) arrow = node.initializer; ts.forEachChild(node, find); }
  find(declaration("registryAuditCanonicalRawReplay")); assert.ok(arrow);
  const bindings = {
    network: "livenet", checkpoint: { height: 201, blockHash: current },
    mapWithConcurrency: async (items, concurrency, callback) => { assert.equal(concurrency, 2); return Promise.all(items.map(callback)); },
    completeIdVerifierStateBundle: async (...args) => { assert.deepEqual(args, ["livenet", 201, current, previous, { auditCurrentBlockOnly: true }]); return bundle; },
    registryAuditProjectionSha256: projectionHash,
    registryAuditTxid: (value) => value, transactionTxid: (transaction) => transaction.txid,
    registryAuditRawReplayOutcome: (record) => ({ txid: record.txid }),
    advanceIdRegistryAuditRollingHash: (hash, descriptor) => [...hash, descriptor],
  };
  return new Function(...Object.keys(bindings), `let currentRange=null, tipTransition=null, descriptorRolling=[], replayBlockCount=0; const acceptedEvents=[], legacyRows=[]; return (${arrow.getText(parsed)});`)(...Object.values(bindings));
}
const record = { protocol: "pwid1", rawCandidate: true, txid, outcome: { valid: false }, position: { blockIndex: 2, protocolVout: 1, recordOrdinal: 0 } };
const stored = { blockHeight: 201, blockHash: current, previousBlockHash: previous, payload: { complete: true, amountStorageModel: "work-subatom-q16-v1", openingSufficientState: { supply: "10000000000000000" }, replayRecords: [record] } };
const page = { kind: "transitions", rangeStart: 201, rangeEnd: 201, transitions: [stored] };
const goodBundle = { canonicalCoverage: true, coverageHeight: 201, blockHash: current, previousBlockHash: previous, workAmoV5BlockTransition: stored.payload, transactions: [{ txid, blockIndex: 2 }] };
test("full raw PWID payload/positions remain required with current-block context", async () => { await replayPage(goodBundle)(page); });
test("configured active precision with missing latch and current-only prefix cannot falsely pass stored Q16", async () => {
  const { fn, calls } = precisionFixture({ reached: false });
  const inputs = await fn(context, 201); assert.deepEqual(inputs, { workAmoV8: null }); assert.equal(calls[1][1].canonicalPrefix, context);
  // A checked current-only prefix without the historical declaration returns legacy inputs.
  // The existing full-payload parity gate must refuse the resulting legacy replay against Q16 storage.
  const legacy = { ...stored.payload, amountStorageModel: "legacy-q8", openingSufficientState: { supply: "100000000" } };
  await assert.rejects(replayPage({ ...goodBundle, workAmoV5BlockTransition: legacy })(page), /disagrees with fresh Core replay/u);
});
for (const [name, mutation] of [
  ["wrong coverage", { canonicalCoverage: false }], ["wrong height", { coverageHeight: 200 }],
  ["wrong block hash", { blockHash: previous }], ["wrong parent hash", { previousBlockHash: current }],
  ["incomplete transition", { workAmoV5BlockTransition: { ...stored.payload, complete: false } }],
  ["opening state mutation", { workAmoV5BlockTransition: { ...stored.payload, openingSufficientState: { supply: "1" } } }],
  ["raw record ordinal mutation", { workAmoV5BlockTransition: { ...stored.payload, replayRecords: [{ ...record, position: { ...record.position, recordOrdinal: 1 } }] } }],
]) test(`fresh raw replay refuses ${name}`, async () => { await assert.rejects(replayPage({ ...goodBundle, ...mutation })(page), /disagrees with fresh Core replay/u); });
test("absent configured precision pins retain historical discovery and refuse coherent legacy downgrade", async () => {
  const inputs = load("workAmoV8ReplayInputsForBlock", {
    configuredWorkAmoV8Declaration: () => null, cachedWorkAmoV8ReplayInputs: null,
    proofIndexWorkAmoV8ActivationLatch: async () => null,
    discoverExactWorkAmoV8Declaration: async (network, options) => ({ checked: true, declaration: options.canonicalPrefix.transactions.some((transaction) => transaction.txid === "old") ? { activationHeight: 200 } : null }),
    WORK_SUBATOM_PROJECTION_MODEL: "work-subatom-q16-v1",
  });
  const coherentLegacy = { ...stored.payload, amountStorageModel: "legacy-q8", openingSufficientState: { supply: "100000000" } };
  const { fn, calls } = bundleFixture({ precisionActivationHeight: null, latch: null, projection: async (historicalContext) => {
    await inputs(historicalContext, 201); return { transition: coherentLegacy };
  } });
  await assert.rejects(fn("livenet", 201, current, previous, { auditCurrentBlockOnly: true }), /without a persistent Q16 migration latch/u);
  assert.equal(calls[0][0], "history"); assert.equal(calls[1][0], "projection");
});
test("omitted raw PWID carrier refuses even with identical full transition", async () => { await assert.rejects(replayPage({ ...goodBundle, transactions: [] })(page), /omitted a PWID transaction/u); });
test("audit-only option has exactly the two full raw replay callsites", () => {
  const calls = [];
  function find(node) { if (ts.isCallExpression(node) && node.expression.getText(parsed) === "completeIdVerifierStateBundle") calls.push(node); ts.forEachChild(node, find); }
  find(parsed); assert.equal(calls.length, 3);
  assert.equal(calls.filter((node) => node.arguments.length === 5 && /auditCurrentBlockOnly:\s*true/u.test(node.arguments[4].getText(parsed))).length, 2);
  assert.equal(calls.filter((node) => node.arguments.length === 4).length, 1);
});
