import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";

// Exercise the functions used by the app, including nested action closures.
// No duplicated request builder, live wallet or broadcast is used here.
const source = await readFile("src/App.tsx", "utf8");
const ast = ts.createSourceFile("App.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
function declaration(name) {
  let found;
  const visit = node => {
    if (ts.isFunctionDeclaration(node) && node.name?.text === name) found = node;
    ts.forEachChild(node, visit);
  };
  visit(ast);
  assert.ok(found, `Actual app function ${name} exists`);
  return found;
}
function compile(name, bindings = {}) {
  const js = ts.transpileModule(declaration(name).getText(ast), { compilerOptions: {
    target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext,
  } }).outputText;
  return new Function(...Object.keys(bindings), `${js}; return ${name}`)(...Object.values(bindings));
}
const surfaceSource = await readFile("src/shared/api/surfaceReadState.ts", "utf8");
const surfaceJs = ts.transpileModule(surfaceSource, { compilerOptions: {
  target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext,
} }).outputText;
const { assertCompleteIdReservations } = await import(`data:text/javascript;base64,${Buffer.from(surfaceJs).toString("base64")}`);
const owner = "1BPVvi1GK4QkfqFMU4jHGjsQjyGwjJJJ7x";
const record = { id: "carbonz", network: "livenet", ownerAddress: owner, receiveAddress: owner, confirmed: true };
const listing = { listingId: "a".repeat(64), id: record.id, network: "livenet", confirmed: true,
  sellerAddress: owner, priceSats: 25000, listingVersion: "list4", saleAuthorization: {} };
const payload = () => ({ record, records: [record], listings: [listing], sales: [], activity: [], pendingEvents: [],
  indexedThroughBlock: 971542, indexedThroughBlockHash: "b".repeat(64) });
function readers(respond = () => payload()) {
  const calls = [];
  const bindings = {
    network: "livenet", URLSearchParams,
    normalizePowId: compile("normalizePowId"),
    normalizeRegistryApiState: compile("normalizeRegistryApiState"),
    assertCompleteIdReservations,
    fetchProofApiJson: async (path, network, options) => {
      const request = { url: new URL(path, "https://fixture.invalid"), network, options };
      calls.push(request);
      return respond(request);
    },
  };
  return { calls, fetchIdRecordState: compile("fetchIdRecordState", bindings),
    fetchActionRegistryRecord: compile("fetchActionRegistryRecord", bindings) };
}

test("AMO confirmed ownership bypasses only new-name availability and preserves response evidence", async () => {
  const refused = new Error("ID_AVAILABILITY_UNPROVEN: stale worker failure");
  const fixture = readers(({ url }) => {
    if (url.searchParams.has("current")) throw refused;
    return payload();
  });
  const signal = new AbortController().signal;
  const prepared = await fixture.fetchIdRecordState("livenet", " @CARBONZ@proofofwork.me ", signal, "confirmed-ownership");
  const revalidated = await fixture.fetchActionRegistryRecord("ids", "carbonz", "confirmed-ownership");
  for (const state of [prepared, revalidated]) {
    assert.equal(state.record, record);
    assert.deepEqual(state.listings, [listing]);
    assert.deepEqual(state.pendingEvents, []);
  }
  for (const call of fixture.calls) {
    assert.equal(call.url.pathname, "/api/v1/ids/carbonz");
    assert.equal(call.url.searchParams.get("fresh"), "1");
    assert.equal(call.url.searchParams.has("current"), false);
    assert.equal(call.network, "livenet");
  }
  assert.equal(fixture.calls[0].options.signal, signal);
  await assert.rejects(fixture.fetchIdRecordState("livenet", "carbonz"), error => error === refused);
  await assert.rejects(fixture.fetchActionRegistryRecord("ids", "carbonz"), error => error === refused);
});

test("registration, default direct-ID actions and DNS retain strict current+fresh reads", async () => {
  const fixture = readers();
  await fixture.fetchIdRecordState("testnet", "carbonz");
  await fixture.fetchIdRecordState("livenet", "carbonz", undefined, "availability");
  await fixture.fetchActionRegistryRecord("ids", "carbonz");
  await fixture.fetchActionRegistryRecord("dns", "carbonz", "confirmed-ownership");
  for (const call of fixture.calls) {
    assert.equal(call.url.searchParams.get("fresh"), "1");
    assert.equal(call.url.searchParams.get("current"), "1");
  }
  assert.equal(fixture.calls[0].network, "testnet");
  assert.equal(fixture.calls.at(-1).url.pathname, "/api/v1/dns/carbonz");
});

for (const reason of ["canonical lag", "checkpoint hash mismatch", "registry fault", "transport unavailable"]) {
  test(`confirmed ownership propagates ${reason} refusal without fallback`, async () => {
    const failure = new Error(reason);
    const fixture = readers(() => { throw failure; });
    await assert.rejects(fixture.fetchIdRecordState("livenet", "carbonz", undefined, "confirmed-ownership"), error => error === failure);
    await assert.rejects(fixture.fetchActionRegistryRecord("ids", "carbonz", "confirmed-ownership"), error => error === failure);
    assert.equal(fixture.calls.length, 2, "Neither failed read retries a weaker endpoint");
  });
}

test("pre-sign AMO read continues to reject incomplete reservation evidence", async () => {
  for (const broken of [{ records: undefined }, { pendingEvents: undefined }, { sales: undefined },
    { summaryOnly: true }, { collectionHasMore: { listings: true } }, { totalCounts: { listings: 2 } }]) {
    const fixture = readers(() => ({ ...payload(), ...broken }));
    await assert.rejects(fixture.fetchActionRegistryRecord("ids", "carbonz", "confirmed-ownership"), /incomplete|reservations/);
  }
});

test("shared seal, delist and purchase revalidation requires unchanged confirmed ownership and terms", async () => {
  let current = payload();
  const fixture = readers(() => current);
  const revalidate = compile("revalidateMarketplaceListing", {
    fetchActionRegistryRecord: fixture.fetchActionRegistryRecord,
    marketplaceTerms: compile("marketplaceTerms"),
    listingAnchorOutpoint: () => undefined,
  });
  await revalidate(listing, "ids");
  assert.equal(fixture.calls[0].url.searchParams.has("current"), false);
  current = { ...payload(), record: { ...record, ownerAddress: "changed-owner" }, records: [] };
  await assert.rejects(revalidate(listing, "ids"), /ownership changed/);
  current = { ...payload(), record: null, records: [{ ...record, confirmed: false }] };
  await assert.rejects(revalidate(listing, "ids"), /ownership changed/);
  current = { ...payload(), listings: [{ ...listing, priceSats: 25001 }] };
  await assert.rejects(revalidate(listing, "ids"), /terms changed/);
  current = { ...payload(), listings: [] };
  await assert.rejects(revalidate(listing, "ids"), /terms changed/);
});

test("the actual reviewed action revalidates confirmed ID ownership before signing and before broadcast", async () => {
  for (const changeAfterSigning of ["none", "owner", "refused"]) {
    let signed = 0;
    let broadcast = 0;
    const fixture = readers(() => {
      if (signed && changeAfterSigning === "refused") throw new Error("canonical read unavailable");
      if (signed && changeAfterSigning === "owner") return { ...payload(), record: { ...record, ownerAddress: "changed-owner" } };
      return payload();
    });
    const revalidate = compile("revalidateMarketplaceListing", {
      fetchActionRegistryRecord: fixture.fetchActionRegistryRecord,
      marketplaceTerms: compile("marketplaceTerms"), listingAnchorOutpoint: () => undefined,
    });
    const actionReviewResolverRef = { current: undefined };
    const actionInFlightRef = { current: false };
    const evidence = { inputs: [{ outpoint: "funding:0", proofs: "10000" }],
      outputs: [{ kind: "payment", address: "registry", proofs: "546" }, { kind: "payment", address: owner, proofs: "546" }],
      records: ["fixture-listing"], totalSpendProofs: "1200" };
    const run = compile("reviewAndSendAction", {
      address: owner, network: "livenet", feeRate: 1, actionInFlightRef, actionReviewResolverRef,
      actionReturnFocusRef: { current: null }, localStorage: {},
      readActionReceipts: () => [], inspectPreparedPayment: () => evidence,
      bitcoinNetwork: () => ({}), bitcoin: { Psbt: { fromHex: () => ({}) } },
      psbtUnsignedTransactionIntent: () => ({}),
      assertTransactionIntentDoesNotSpendReservedListingAnchors: async () => {},
      setStatus() {}, networkLabel: () => "Mainnet",
      setActionReview: () => queueMicrotask(() => actionReviewResolverRef.current(true)),
      ensureWalletNetwork: async () => {}, assertActiveWalletAddress: async () => {},
      fetchAddressApiUtxos: async () => [{ txid: "funding", vout: 0, value: 10000, status: { confirmed: true } }],
      signAndBroadcastPsbtDetailed: async options => {
        signed++;
        await options.beforeBroadcast();
        broadcast++;
        return { txid: "d".repeat(64) };
      },
    });
    const action = run({ prepared: { psbtHex: "fixture", dustFeeSats: 0 }, title: "Fixture listing",
      fields: [["Asset", "carbonz"]], payload: "fixture-listing", registry: "registry", registryProofs: 546,
      key: "marketplace:fixture", context: { wallet: {}, assertCurrent() {}, trigger: null },
      revalidate: () => revalidate(listing, "ids"),
      marketplace: { payments: [{ address: "registry", amountSats: 546 }, { address: owner, amountSats: 546 }], labels: [] },
    });
    if (changeAfterSigning === "none") assert.equal(await action, "d".repeat(64));
    else await assert.rejects(action, changeAfterSigning === "owner" ? /ownership changed/ : /canonical read unavailable/);
    assert.equal(signed, 1);
    assert.equal(broadcast, changeAfterSigning === "none" ? 1 : 0);
    assert.equal(fixture.calls.length, 2);
    assert.ok(fixture.calls.every(({ url }) => url.searchParams.get("fresh") === "1" && !url.searchParams.has("current")));
    assert.equal(actionInFlightRef.current, false, "A failed late check releases the reviewed action guard");
  }
});

function callsIn(name, callee) {
  const calls = [];
  const visit = node => {
    if (ts.isCallExpression(node) && node.expression.getText(ast) === callee) calls.push(node);
    ts.forEachChild(node, visit);
  };
  visit(declaration(name));
  return calls;
}
test("every AMO ID preparation opts into ownership reads and leaves pending display evidence intact", () => {
  for (const name of ["prepareIdSaleAuthorization", "sealIdListing", "delistIdListing", "purchaseId"]) {
    const calls = callsIn(name, "fetchIdRecordState");
    assert.equal(calls.length, 1, `${name} verifies one current ID state`);
    assert.equal(calls[0].arguments[3]?.text, "confirmed-ownership", `${name} uses confirmed ownership`);
    assert.equal(callsIn(name, "setIdPendingEvents").length, 0, `${name} cannot erase pending display state with confirmed-only evidence`);
  }
  const listingRead = callsIn("publishIdListing", "fetchActionRegistryRecord");
  assert.equal(listingRead.length, 1);
  assert.equal(listingRead[0].arguments[2]?.text, "confirmed-ownership");
  const legacyDelist = callsIn("delistIdListing", "broadcastIdMutation");
  assert.equal(legacyDelist.length, 1);
  const purpose = legacyDelist[0].arguments[0].properties.find(property => property.name?.getText(ast) === "readPurpose");
  assert.equal(purpose?.initializer?.text, "confirmed-ownership");
  assert.equal(callsIn("registerId", "fetchIdRecordState")[0].arguments.length, 2);
});
