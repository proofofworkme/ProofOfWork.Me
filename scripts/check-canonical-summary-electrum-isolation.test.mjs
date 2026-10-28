import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { isAbsolute } from "node:path";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";
import * as bitcoin from "bitcoinjs-lib";
import { electrumAddressHistoryCoverage } from "../server/address-chain-pagination.mjs";

// Extract the actual production functions without opening API listeners, RPC
// connections, or background jobs. Only unrelated hydration/projection is stubbed.
const args = process.argv.slice(2);
assert.ok(args.length === 0 || (args.length === 2 && args[0] === "--api-source" && isAbsolute(args[1])),
  "Optional source override must be --api-source /absolute/path");
const source = readFileSync(args[1] ?? new URL("../server/proof-api.mjs", import.meta.url), "utf8");
const parsed = ts.createSourceFile("proof-api.mjs", source, ts.ScriptTarget.Latest, true);
const declarations = new Map(parsed.statements.filter(ts.isFunctionDeclaration)
  .map(node => [node.name.text, node]));
const constants = new Map(parsed.statements.filter(ts.isVariableStatement)
  .flatMap(node => node.declarationList.declarations)
  .map(node => [node.name.getText(parsed), node.getText(parsed)]));
const hasRootOverlay = declarations.has("dnsRegistryRootRead");
assert.equal(hasRootOverlay, declarations.has("dnsRegistryRootPayloadForCanonicalLedger"),
  "Accepted root-only DNS overlay must be complete");
const canonicalDnsName = hasRootOverlay ? "dnsRegistryRootPayloadForCanonicalLedger" : "dnsRegistryPayload";
const fn = name => {
  assert.ok(declarations.has(name), `Missing actual function ${name}`);
  return declarations.get(name).getText(parsed);
};
const plain = value => JSON.parse(JSON.stringify(value));
const limitContext = vm.createContext({});
vm.runInContext(fn("electrumReadLaneLimits"), limitContext);

for (const [inFlight, queue, shared, summary] of [
  [8, 256, { maxInFlight: 6, maxQueue: 248 }, { maxInFlight: 2, maxQueue: 8 }],
  [2, 8, { maxInFlight: 1, maxQueue: 0 }, { maxInFlight: 1, maxQueue: 8 }],
  [2, 0, { maxInFlight: 1, maxQueue: 0 }, { maxInFlight: 1, maxQueue: 0 }],
  [1, 256, { maxInFlight: 1, maxQueue: 256 }, null],
  [1, 0, { maxInFlight: 1, maxQueue: 0 }, null],
]) {
  test(`lane reservation preserves configured ${inFlight}/${queue} totals`, () => {
    const actual = plain(limitContext.electrumReadLaneLimits(inFlight, queue));
    assert.deepEqual(actual, { shared, summary });
    assert.equal(actual.shared.maxInFlight + (actual.summary?.maxInFlight ?? 0), inFlight);
    assert.equal(actual.shared.maxQueue + (actual.summary?.maxQueue ?? 0), queue);
  });
}

test("invalid existing Electrum limits still refuse before creating clients", () => {
  for (const value of [0, -1, 1.5, NaN, Infinity, 1025, "8"]) {
    assert.throws(() => limitContext.electrumReadLaneLimits(value, 256), /maxInFlight/);
  }
  for (const value of [-1, 1.5, NaN, Infinity, 100001, "256"]) {
    assert.throws(() => limitContext.electrumReadLaneLimits(8, value), /maxQueue/);
  }
});

function clients(inFlight = 8, queue = 256) {
  const created = [], calls = [];
  const context = vm.createContext({
    ELECTRUM_HOST: "127.0.0.1", ELECTRUM_PORT: 50001,
    ELECTRUM_MAX_IN_FLIGHT: inFlight, ELECTRUM_MAX_QUEUE: queue,
    ELECTRUM_MAX_RESPONSE_BYTES: 16_777_216,
    ELECTRUM_INTERACTIVE_MAX_IN_FLIGHT: 4, ELECTRUM_INTERACTIVE_MAX_QUEUE: 32,
    createElectrumClient: options => {
      const value = { options: plain(options), request(...args) { calls.push({ value, args }); return value; } };
      created.push(value);
      return value;
    },
  });
  vm.runInContext([
    fn("electrumReadLaneLimits"),
    ...["ELECTRUM_READ_LANE_LIMITS", "ELECTRUM_CLIENT", "ELECTRUM_CANONICAL_SUMMARY_CLIENT",
      "ELECTRUM_INTERACTIVE_CLIENT"].map(name => `const ${constants.get(name)};`),
    ...["electrumRequest", "canonicalSummaryElectrumRequest", "interactiveElectrumRequest"].map(fn),
  ].join("\n"), context);
  return { context, created, calls };
}

test("actual client construction reserves capacity and leaves interactive settings intact", () => {
  const { context, created, calls } = clients();
  assert.equal(created.length, 3);
  assert.deepEqual(created.map(item => item.options), [
    { host: "127.0.0.1", port: 50001, maxResponseBytes: 16_777_216, maxInFlight: 6, maxQueue: 248 },
    { host: "127.0.0.1", port: 50001, maxResponseBytes: 16_777_216, maxInFlight: 2, maxQueue: 8 },
    { host: "127.0.0.1", port: 50001, maxResponseBytes: 16_777_216, maxInFlight: 4, maxQueue: 32 },
  ]);
  for (let index = 0; index < 2; index += 1) {
    assert.equal(context.electrumRequest("general", [], 123), created[0]);
    assert.equal(context.canonicalSummaryElectrumRequest("summary", [], 456), created[1]);
    assert.equal(context.interactiveElectrumRequest("interactive", [], 789), created[2]);
  }
  assert.equal(created.length, 3, "requests do not allocate clients");
  assert.deepEqual(calls.map(row => row.args[2]), [123, 456, 789, 123, 456, 789]);
});

test("one configured slot reuses the shared client without increasing capacity", () => {
  const { context, created } = clients(1, 0);
  assert.equal(created.length, 2, "only original shared and interactive clients exist");
  assert.equal(context.electrumRequest("general", []), context.canonicalSummaryElectrumRequest("summary", []));
});

for (const name of ["buildIndexedCanonicalLedgerPayload", "buildCanonicalLedgerPayload"]) {
  test(`${name} routes its actual DNS call to the canonical-summary requester`, () => {
    const calls = [];
    function visit(node) {
      if (ts.isCallExpression(node) && ["dnsRegistryPayload", "dnsRegistryRootPayloadForCanonicalLedger"]
        .includes(node.expression.getText(parsed))) calls.push(node);
      ts.forEachChild(node, visit);
    }
    visit(declarations.get(name));
    assert.equal(calls.length, 1);
    assert.equal(calls[0].expression.getText(parsed), canonicalDnsName);
    const requester = () => {};
    const context = vm.createContext({ network: "livenet", canonicalSummaryElectrumRequest: requester,
      [canonicalDnsName](network, options) { return { network, request: options?.request }; } });
    const actual = vm.runInContext(calls[0].getText(parsed), context);
    assert.equal(actual.network, "livenet");
    assert.equal(actual.request, requester);
  });
}

const ADDRESS = "1F1zepCJ8VPcPoeMt6G4BPKuE3CYAxCKNY";
const HEADER = Buffer.alloc(80, 7);
const HASH = Buffer.from(bitcoin.crypto.hash256(HEADER)).reverse().toString("hex");
const HEIGHT = 973537;
const HISTORY = [{ tx_hash: "11".repeat(32), height: 973000 }];
function dnsFixture({ failure, mutateHistory = false, mutateCore = false, badHeader = false,
  invalidHistory = false, badClosingHeader = false, mutateClosingCore = false } = {}) {
  const calls = [], hydration = [], additive = [];
  let historyCount = 0, coreCount = 0, headerCount = 0;
  const request = async (lane, method, params, timeout) => {
    calls.push({ lane, method, params: plain(params), timeout });
    if (failure) throw failure;
    if (method === "blockchain.block.header") {
      headerCount += 1;
      return badHeader || (badClosingHeader && headerCount === 3)
        ? Buffer.alloc(80, 8).toString("hex") : HEADER.toString("hex");
    }
    assert.equal(method, "blockchain.scripthash.get_history");
    historyCount += 1;
    if (invalidHistory) return {};
    return mutateHistory && historyCount === 2 ? [...HISTORY, { tx_hash: "22".repeat(32), height: 973001 }] : HISTORY;
  };
  const context = vm.createContext({
    Buffer, bitcoin, createHash, electrumAddressHistoryCoverage,
    ELECTRUM_HOST: "127.0.0.1", ELECTRUM_PORT: 50001, ADDRESS_ELECTRUM_HISTORY_TIMEOUT_MS: 30000,
    ID_MUTATION_PRICE_SATS: 546, ID_REGISTRATION_PRICE_SATS: 1000,
    DNS_PROTOCOL_PREFIX: "pwdns1:", DNS_REGISTRY_ID: "domains@proofofwork.me", DNS_SALE_AUTH_VERSION_TICKET: "buy5",
    electrumRequest: (...args) => request("shared", ...args),
    canonicalSummaryElectrumRequest: (...args) => request("summary", ...args),
    dnsRegistryAddressForNetwork: () => ADDRESS,
    bitcoinNetwork: () => bitcoin.networks.bitcoin,
    bitcoinRpc: async method => {
      assert.equal(method, "getblockchaininfo");
      coreCount += 1;
      return { ok: true, result: { blocks: HEIGHT, headers: HEIGHT, chain: "main", initialblockdownload: false,
        verificationprogress: 1, bestblockhash: (mutateCore && coreCount === 2) || (mutateClosingCore && coreCount === 3)
          ? "ab".repeat(32) : HASH } };
    },
    // Core transaction hydration and additive discovery remain separate proof
    // boundaries; assert their original inputs and refuse any propagated error.
    hydrateExactConfirmedRegistryHistory: async (entries, network, options) => {
      hydration.push({ entries: plain(entries), network, options: plain(options) });
      return [{ txid: HISTORY[0].tx_hash }];
    },
    mapWithConcurrency: async (items, concurrency, producer) => Promise.all(items.map(producer)),
    hydrateExactPendingRegistryTransaction: async () => { throw new Error("unexpected pending fixture"); },
    idRegistryStateFromTransactions: (transactions, address, network) => {
      assert.equal(transactions.length, 1); assert.equal(address, ADDRESS); assert.equal(network, "livenet");
      return { listings: [], records: [], activity: [] };
    },
    dnsActivityItemsFromEvents: () => [], parseDnsEventPayload: () => null,
    filterSpendableListings: async value => value,
    registryPayloadFromState: (state, metadata) => ({ ...state, ...metadata }),
    mempoolBase: () => "http://fixture.invalid", indexedThroughBlockFromTransactions: () => 973000,
    dnsPayloadWithAdditiveRecords: async (payload, state, checkpoint) => {
      assert.deepEqual(plain(checkpoint), { height: HEIGHT, blockHash: HASH });
      additive.push({ payload, state, checkpoint });
      return payload;
    },
  });
  vm.runInContext(["scriptHashForAddress", "exactCoreTipFromBlockchainInfo", "registryAuditInteger", "registryAuditTxid",
    "registryAuditElectrumCheckpoint", "fetchExactAddressHistoryFromElectrum", "dnsRegistryPayload",
    ...(hasRootOverlay ? ["dnsRegistryRootRead", "dnsRegistryRootPayloadForCanonicalLedger"] : [])].map(fn).join("\n"), context);
  return { context, calls, hydration, additive };
}

test(`all ${hasRootOverlay ? "five" : "four"} DNS history/header proofs use the reserved requester and retain exact evidence`, async () => {
  const { context, calls, hydration, additive } = dnsFixture();
  const result = await context[canonicalDnsName]("livenet", { request: context.canonicalSummaryElectrumRequest });
  assert.deepEqual(calls.map(row => row.method), ["blockchain.block.header", "blockchain.scripthash.get_history",
    "blockchain.scripthash.get_history", "blockchain.block.header", ...(hasRootOverlay ? ["blockchain.block.header"] : [])]);
  assert.equal(additive.length, hasRootOverlay ? 0 : 1, "accepted root-only ledger keeps additive discovery separate");
  assert.ok(calls.every(row => row.lane === "summary" && row.timeout === 30000));
  assert.deepEqual(calls[0].params, [HEIGHT]);
  assert.deepEqual(calls[1].params, ["34a4762bbb9e585c0e9f3c84d87801adcc287b79c48976cd2f75d829412eca93"]);
  assert.deepEqual(hydration, [{ entries: [{ height: 973000, txid: HISTORY[0].tx_hash }], network: "livenet",
    options: { allHeights: true, registryAddress: ADDRESS } }]);
  assert.equal(result.checkpointHash, HASH);
  assert.equal(result.indexedThroughBlock, HEIGHT);
  assert.deepEqual(plain(result.coverage), { complete: true, historySha256: electrumAddressHistoryCoverage(HISTORY).snapshotSha256 });
});

test("ordinary DNS callers still use the original shared request path", async () => {
  const { context, calls, additive } = dnsFixture();
  await context.dnsRegistryPayload("livenet");
  assert.equal(calls.length, 4);
  assert.ok(calls.every(row => row.lane === "shared"));
  assert.equal(additive.length, 1, "full public DNS still includes additive records");
});

for (const [label, options, expected] of [
  ["changed history", { mutateHistory: true }, /chain\/history changed/],
  ["changed Core checkpoint", { mutateCore: true }, /chain\/history changed/],
  ["mismatched Electrum header", { badHeader: true }, /not bound to Bitcoin Core checkpoint/],
  ["malformed history", { invalidHistory: true }, /invalid address history/],
]) {
  test(`isolated DNS still refuses ${label}`, async () => {
    const { context } = dnsFixture(options);
    await assert.rejects(context[canonicalDnsName]("livenet", { request: context.canonicalSummaryElectrumRequest }), expected);
  });
}

test("isolated DNS propagates its own timeout instead of returning partial history", async () => {
  const failure = new Error("fixture DNS deadline");
  const { context, calls } = dnsFixture({ failure });
  await assert.rejects(context[canonicalDnsName]("livenet", { request: context.canonicalSummaryElectrumRequest }), error => error === failure);
  assert.equal(calls.length, 1);
});

for (const [label, options, expected] of [
  ["fifth closing header", { badClosingHeader: true }, /not bound to Bitcoin Core checkpoint/],
  ["final root Core checkpoint", { mutateClosingCore: true }, /changed during the root ledger read/],
]) {
  test(`accepted root-only overlay refuses a changed ${label}`, { skip: !hasRootOverlay }, async () => {
    const { context, calls, additive } = dnsFixture(options);
    await assert.rejects(context[canonicalDnsName]("livenet", { request: context.canonicalSummaryElectrumRequest }), expected);
    assert.equal(calls.length, 5);
    assert.ok(calls.every(row => row.lane === "summary"));
    assert.equal(additive.length, 0);
  });
}
