import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";

const source = readFileSync(new URL("./proof-api.mjs", import.meta.url), "utf8");
function extract(name) {
  const match = new RegExp(`(?:async )?function ${name}\\(`).exec(source);
  assert.ok(match, name);
  return source.slice(match.index, source.indexOf("\n}", match.index) + 2);
}
const HASH = "a".repeat(64);
const plain = (value) => JSON.parse(JSON.stringify(value));
function fixture({ coreFailure, legacyTimeout = false, mutateProof, latePending = false } = {}) {
  const calls = [], warnings = [];
  const listings = ["a", "b", "c"].map((id, index) => ({
    listingId: id.repeat(64), tokenId: "fixture-token", confirmed: true,
    anchor: { txid: id.repeat(64), vout: index },
    saleAuthorization: { anchorScriptPubKey: "51", anchorValueSats: 546 },
  }));
  const closure = { ...listings[1], closedTxid: "d".repeat(64), closedConfirmed: true };
  const payload = {
    listings, closedListings: [closure], sales: [{ txid: "e".repeat(64), historical: true }],
    stats: { activeListings: 3, listings: 3, openListings: 3 },
    totalCounts: { listings: 3 }, collectionHasMore: { listings: false },
    tokens: [{ tokenId: "fixture-token", openListings: 3, confirmedOpenListings: 3, pendingOpenListings: 0 }],
    indexedThroughBlock: 100, indexedThroughBlockHash: HASH, snapshotId: "unchanged-input",
  };
  let tipReads = 0, batchReads = 0, spentAll = false;
  const context = vm.createContext({
    console: { error: (message) => warnings.push(message) },
    TX_FETCH_CONCURRENCY: 4, SUMMARY_SPENDABLE_CURRENT_FALLBACK_WAIT_MS: 2500,
    reconcileCachedTokenMarketPayload: async (value) => { calls.push("canonical-history"); return value; },
    tokenListingHasConfirmedSaleTicketSeal: () => true,
    tokenListingAnchorOutpoint: (listing) => listing.anchor,
    tokenSaleAuthorizationUsesSpendableSaleTicketAnchor: () => true,
    tokenSaleAuthorizationUsesSaleTicketAnchor: () => true,
    compareCanonicalUtf8: (a, b) => a.localeCompare(b),
    registryAuditProjectionSha256: (value) => createHash("sha256").update(JSON.stringify(value)).digest("hex"),
    exactCoreTipFromBlockchainInfo: (value) => value,
    exactBitcoinRpcOutputSats: (value) => value,
    errorSummary: (error) => String(error?.message ?? error),
    mapWithConcurrency: async (items, _limit, run) => Promise.all(items.map(run)),
    bitcoinRpc: async () => {
      calls.push("tip"); tipReads++;
      if (coreFailure === "rpc") throw new Error("fixture RPC unavailable");
      return coreFailure === "tip-changed"
        ? { height: 100 + tipReads, blockHash: String(tipReads).repeat(64) }
        : { height: 100, blockHash: HASH };
    },
    bitcoinRpcGetTxOutBatch: async (anchors) => {
      calls.push("batch"); batchReads++;
      assert.deepEqual(plain(anchors), listings.map((listing) => listing.anchor));
      if (coreFailure === "partial") return [];
      return anchors.map((_, index) => ({ ok: true, result: index === 2 || spentAll ? null : {
        bestblock: coreFailure === "tip-changed" ? String(tipReads).repeat(64) : HASH,
        confirmations: 1, coinbase: false, value: 546,
        scriptPubKey: { hex: coreFailure === "script" ? "52" : "51" },
      } }));
    },
    filterSpendableTokenListings: async (selected) => {
      calls.push("individual-enrichment");
      return { listings: latePending ? [] : selected, closedListings: [] };
    },
    payloadWithFallbackAfterMs: async (pending, fallback, timeout) => {
      calls.push("enrichment-budget"); assert.equal(timeout, 2500);
      await pending;
      return legacyTimeout ? fallback : pending;
    },
    sortClosedTokenListings: (rows) => [...rows].sort((a, b) => a.listingId.localeCompare(b.listingId)),
    tokenSalesWithCanonicalOutspendClosures: (sales, closed) => [...sales, ...closed.map((row) => ({ closedTxid: row.closedTxid }))],
    tokenAggregateSummaries: (value) => new Map([["fixture-token", {
      openListings: value.listings.length,
      confirmedOpenListings: value.listings.filter((listing) => listing.confirmed).length,
      pendingOpenListings: value.listings.filter((listing) => !listing.confirmed).length,
    }]]),
    isWorkTokenId: () => false,
  });
  const names = [
    "tokenListingAuthorityUnavailable", "tokenListingRequiresCoreBuyabilityProof",
    "strictCoreTokenListingReconciliation", "stableTipCoreTokenListingAuthorityComplete",
    "coreProvenTokenSummarySelection", "spendableTokenListingsPayload",
    "tokenPayloadWithReconciledActiveListingCounts", "boundedSpendableTokenListingsPayload",
    "tokenPayloadWithSpendableListings", "tokenPayloadWithSpendableActiveListings",
  ];
  vm.runInContext(names.map(extract).join("\n"), context);
  if (mutateProof) {
    const strict = context.strictCoreTokenListingReconciliation;
    context.strictCoreTokenListingReconciliation = async (...args) => {
      const result = await strict(...args);
      mutateProof(result, listings);
      return result;
    };
  }
  return {
    calls, warnings, payload, context, counts: () => ({ tipReads, batchReads }),
    spendAll: () => { spentAll = true; },
    run: (options = { useCurrentCoreSummaryEvidence: true }, network = "livenet") =>
      context.tokenPayloadWithSpendableActiveListings(payload, network, options),
  };
}

test("fast summary equals the existing legitimate Core timeout fallback, preserving history and exact counts", async () => {
  const fast = fixture(), legacy = fixture({ legacyTimeout: true });
  const before = plain(fast.payload);
  const result = await fast.run();
  assert.deepEqual(plain(result), plain(await legacy.run({})));
  assert.deepEqual(plain(fast.payload), before);
  assert.deepEqual(fast.calls, ["canonical-history", "tip", "batch", "tip"]);
  assert.equal(fast.warnings.length, 0);
  assert.equal(legacy.warnings.length, 1);
  assert.deepEqual(plain(result.listings.map((listing) => listing.listingId)), ["a".repeat(64)]);
  assert.deepEqual(plain(result.closedListings), before.closedListings);
  assert.equal(result.sales[0].historical, true);
  assert.deepEqual(plain(result.stats), { activeListings: 1, listings: 1, openListings: 1 });
  assert.equal(result.totalCounts.listings, 1);
  assert.equal(result.tokens[0].openListings, 1);
  assert.equal(result.hasMore, false);
  assert.equal(result.listingAuthority.checkedListingCount, 3);
  assert.equal(result.listingAuthority.spentListingCount, 1);
  assert.equal(result.listingAuthority.outputListingCount, 2);
});

test("ordinary enrichment and the fast summary agree when individual reads confirm the same Core snapshot", async () => {
  assert.deepEqual(plain(await fixture().run()), plain(await fixture().run({})));
});

test("the option is explicit, livenet-only, and leaves ordinary token-market reads unchanged", async () => {
  for (const options of [{}, { useCurrentCoreSummaryEvidence: false }, { useCurrentCoreSummaryEvidence: "true" }]) {
    const sample = fixture(); await sample.run(options);
    assert.ok(sample.calls.includes("individual-enrichment"));
  }
  const testnet = fixture(); await testnet.run(undefined, "testnet");
  assert.ok(testnet.calls.includes("individual-enrichment"));
  assert.equal(testnet.counts().batchReads, 0);
  const ordinary = fixture();
  await ordinary.context.tokenPayloadWithSpendableListings(ordinary.payload, "livenet");
  assert.ok(ordinary.calls.includes("individual-enrichment"));
});

for (const coreFailure of ["rpc", "partial", "script", "tip-changed"]) {
  test(`fast summary rejects ${coreFailure} Core evidence without starting enrichment`, async () => {
    const sample = fixture({ coreFailure });
    await assert.rejects(sample.run(), (error) => error.statusCode === 503 && error.details.code === "TOKEN_LISTING_AUTHORITY_UNAVAILABLE");
    assert.ok(!sample.calls.includes("individual-enrichment"));
    if (coreFailure === "tip-changed") assert.deepEqual(sample.counts(), { tipReads: 6, batchReads: 3 });
  });
}

const malformedProofs = [
  (result) => { result.evidence.includeMempool = false; },
  (result) => { result.evidence.checkedListingCount = 2; },
  (result) => { result.evidence.checkedListingCount = "3"; },
  (result) => { result.evidence.checkpoint.height = "100"; },
  (result) => { result.evidence.checkedOutpointsSha256 = "missing"; },
  (result) => { result.listings = [result.listings[0]]; },
  (result) => { result.listings[1] = result.listings[0]; },
  (result) => { result.listings[1] = { ...result.listings[1] }; },
];
test("partial, malformed, duplicated or substituted selections never qualify for the fast path", async () => {
  for (const mutateProof of malformedProofs) {
    const sample = fixture({ mutateProof });
    await assert.rejects(sample.run(), (error) => error.statusCode === 503);
    assert.ok(!sample.calls.includes("individual-enrichment"));
  }
});

test("each request proves its own current outputs; a later pending spend removes them", async () => {
  const sample = fixture();
  assert.equal((await sample.run()).listings.length, 1);
  sample.spendAll();
  assert.equal((await sample.run()).listings.length, 0);
  assert.deepEqual(sample.counts(), { tipReads: 4, batchReads: 2 });
});

test("a valid empty book still obtains both current tip fences and an empty Core batch", async () => {
  const sample = fixture();
  sample.payload.listings.length = 0;
  sample.payload.totalCounts.listings = 0;
  const result = await sample.run();
  assert.equal(result.listings.length, 0);
  assert.equal(result.totalCounts.listings, 0);
  assert.equal(result.listingAuthority.checkedListingCount, 0);
  assert.equal(result.listingAuthority.outputListingCount, 0);
  assert.deepEqual(sample.counts(), { tipReads: 2, batchReads: 1 });
  assert.ok(!sample.calls.includes("individual-enrichment"));
  assert.equal(result.closedListings.length, 1);
});

test("a spend arriving after the Core batch has the same observation point as the existing timeout fallback", async () => {
  const fast = fixture({ latePending: true });
  const timedOut = fixture({ latePending: true, legacyTimeout: true });
  assert.deepEqual(plain(await fast.run()), plain(await timedOut.run({})));
  assert.equal((await fixture({ latePending: true }).run({})).listings.length, 0);
});
