import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import vm from "node:vm";
import { marketplaceSummarySetAligned } from "../scripts/ledger-audit-snapshot.mjs";

const source = readFileSync(new URL("./proof-api.mjs", import.meta.url), "utf8");
function extract(name) {
  const match = new RegExp(`(?:async )?function ${name}\\(`).exec(source);
  assert.ok(match, name);
  return source.slice(match.index, source.indexOf("\n}", match.index) + 2);
}

test("asynchronous marketplace enrichment rebinds every immutable snapshot component", async () => {
  const snapshotId = "original-snapshot";
  const payload = { snapshotId, token: { snapshotId }, registry: { snapshotId },
    floor: { snapshotId }, workFloor: { snapshotId, totalQ8: "900719925474099312345" } };
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  const authority = { checkpoint: { height: 100, blockHash: "a".repeat(64) } };
  const context = vm.createContext({
    Buffer,
    measureMarketplaceReadPhase: (_name, run) => run(),
    sha256Hex: (value) => createHash("sha256").update(value).digest("hex"),
    payloadSnapshotId: (value) => value?.snapshotId ?? "",
    canonicalWorkMarketV2TokenSummary: (token) => token,
    indexedTokenMarketSummaryOverlay: async () => ({ indexedAt: "now" }),
    tokenSummaryListingIdsMissingFromMarketLifecycle: () => [],
    tokenStateWithIndexedMarketSummaryOverlay: (token) => token,
    tokenPayloadWithSpendableActiveListings: async (token) => ({ ...token, listingAuthority: authority }),
    tokenPayloadWithCurrentWorkActiveListingPolicy: (token) => token,
    tokenStateWithCanonicalWorkListingBookForMarketplaceSummary: async (token) => token,
    compactTokenSummaryPayload: (token) => token,
    workFloorWithIndexedMarketSummaryOverlay: (floor) => floor,
    newerIso: (_before, after) => after,
    marketplaceSummaryWithCurrentBtcUsd: async (value) => { await gate; return value; },
  });
  const read = vm.runInContext(`${extract("summaryWithDerivedSnapshot")}\n${extract("marketplaceSummaryPayloadWithIndexedMarketOverlay")}\nmarketplaceSummaryPayloadWithIndexedMarketOverlay`, context);
  const pending = read(payload, "livenet", { fast: true });
  release();
  const result = await pending;
  assert.notEqual(result.snapshotId, snapshotId);
  assert.equal(result.derivedFromSnapshotId, snapshotId);
  for (const key of ["token", "registry", "floor", "workFloor"]) {
    assert.equal(result[key].snapshotId, result.snapshotId, key);
    assert.equal(payload[key].snapshotId, snapshotId);
  }
  assert.equal(result.workFloor.totalQ8, "900719925474099312345");
  assert.equal(result.token.listingAuthority, authority);
  assert.equal((await read(payload, "livenet", { fast: true, allowSnapshotMutation: true })).snapshotId, snapshotId);
});

test("four fresh summaries accept one proven marketplace child at the same canonical checkpoint", async () => {
  const tokenId = "ab".repeat(32);
  const snapshotId = "11".repeat(12);
  const checkpoint = { indexedThroughBlock: 100, indexedThroughBlockHash: "aa".repeat(32) };
  const network = "livenet";
  const component = () => ({ network, snapshotId, ...checkpoint });
  const context = vm.createContext({
    Buffer,
    assertCanonicalCreditAggregateResponse() {},
    payloadSnapshotId: (payload) => payload?.snapshotId ?? "",
    sha256Hex: (value) => createHash("sha256").update(value).digest("hex"),
    verifiedSummaryPayloadCheckpoint: async () => ({
      ...checkpoint, exactTip: true, tipHeight: checkpoint.indexedThroughBlock, tipHash: checkpoint.indexedThroughBlockHash,
    }),
  });
  const { provenance, derive } = vm.runInContext([
    extract("summaryWithDerivedSnapshot"), extract("summaryPayloadRequiredComponents"),
    extract("summaryPayloadWithCanonicalProvenance"),
    "({ provenance: summaryPayloadWithCanonicalProvenance, derive: summaryWithDerivedSnapshot })",
  ].join("\n"), context);
  const fresh = (payload, surface) => provenance(payload, network, true, surface);
  const authority = { checkpoint };
  const market = {
    ...component(), registry: { ...component(), listings: [{ listingId: "listing" }] },
    token: { ...component(), listingAuthority: authority }, workFloor: component(),
  };
  const work = { ...component(), token: component(), floor: component() };
  const growth = { ...component(), activity: component(), registry: component(), token: component(), workFloor: component() };
  const set = {
    marketplace: await fresh(market, "marketplace-summary"),
    token: await fresh(component(), `token-summary:${tokenId}`),
    work: await fresh(work, "work-summary"), growth: await fresh(growth, "growth-summary"),
  };
  assert.equal(marketplaceSummarySetAligned(set, tokenId), true);
  const reconciled = derive(market, "marketplace-id-listing-reconciliation", ["listing"]);
  assert.equal(marketplaceSummarySetAligned({
    ...set, marketplace: await fresh(reconciled, "marketplace-summary"),
  }, tokenId), true);
  const enriched = derive(market, "marketplace-token-listing-authority", authority);
  set.marketplace = await fresh(enriched, "marketplace-summary");
  assert.notEqual(enriched.snapshotId, snapshotId);
  assert.equal(marketplaceSummarySetAligned(set, tokenId), true);
  const sibling = derive(market, "marketplace-token-listing-authority", { checkpoint, other: true });
  const secondGeneration = derive(enriched, "marketplace-id-listing-reconciliation", ["listing"]);
  assert.equal(marketplaceSummarySetAligned({
    ...set, marketplace: await fresh(secondGeneration, "marketplace-summary"),
  }, tokenId), false);
  for (const corrupt of [
    (s) => { delete s.marketplace.derivedFromSnapshotId; },
    (s) => { s.marketplace.derivedFromSnapshotId = sibling.snapshotId; },
    (s) => { s.marketplace.derivedFromSnapshotId = [snapshotId]; },
    (s) => { s.marketplace.derivedFromSnapshotId = null; },
    (s) => { s.marketplace.derivedFromSnapshotId = ""; },
    (s) => { s.marketplace.token.listingAuthority.checkpoint.indexedThroughBlock -= 1; },
    (s) => { s.marketplace.token.snapshotId = [s.marketplace.snapshotId]; },
    (s) => { s.marketplace.provenance.componentSnapshotIds.registry = [s.marketplace.snapshotId]; },
    (s) => { s.marketplace.provenance.derivedFromSnapshotId = snapshotId; delete s.marketplace.derivedFromSnapshotId; },
    (s) => { s.marketplace.provenance.snapshotId = snapshotId; },
    (s) => { s.marketplace.registry.snapshotId = snapshotId; },
    (s) => { s.marketplace.token.indexedThroughBlockHash = "bb".repeat(32); },
    (s) => { s.work.derivedFromSnapshotId = sibling.snapshotId; },
    (s) => { s.token.snapshotId = sibling.snapshotId; },
    (s) => { s.token.provenance.surface = "token-summary:all"; },
    (s) => { s.token.provenance.served = "last-good"; },
    (s) => { s.work.provenance.tipHash = "bb".repeat(32); },
    (s) => { s.work.provenance.tipHeight += 1; },
    (s) => { delete s.growth.provenance.componentSnapshotIds.activity; },
    (s) => { s.growth.activity.indexedThroughBlock -= 1; },
    (s) => { s.growth.network = "testnet"; },
  ]) {
    const copy = structuredClone(set);
    corrupt(copy);
    assert.equal(marketplaceSummarySetAligned(copy, tokenId), false);
  }
});

function completeBookFixture({ missing = false, duplicate = false, coreHeight = 100, coreHash = "a".repeat(64) } = {}) {
  const listingId = "b".repeat(64);
  const listing = { listingId, confirmed: true, tokenId: "work", saleAuthorization: { version: "v8" } };
  let batchCalls = 0;
  const context = vm.createContext({
    TOKEN_LISTING_HISTORY_CURSOR_PREFIX: "cursor", WORK_TOKEN_ID: "work",
    WORK_AMO_V8_ACTIVATION_HEIGHT: 90, TOKEN_LISTING_LIFECYCLE_MATERIALIZATION_LIMIT: 5000,
    TOKEN_SALE_AUTH_WORK_AMO_V8_VERSION: "v8",
    checkpointHistoryRequest: () => ({}), normalizeTokenScope: (value) => value,
    tokenListingHistoryQueryScope: () => ({}), tokenListingLifecycleCapacityStats: () => ({}),
    logTokenListingLifecycleCapacity: () => {},
    completeTokenListingRelationalRead: async () => ({
      items: [listing], totalCount: 1, indexedThroughBlock: 100, indexedThroughBlockHash: "a".repeat(64),
      stats: { complete: true, workMarketAuthorizationReady: true, workMarketAuthorizationVersions: ["v8"] },
    }),
    proofIndexCanonicalWorkAmoV8ListingsByIds: async (_network, ids) => {
      batchCalls++;
      assert.deepEqual(Array.from(ids), [listingId]);
      return missing ? [] : [{ ...listing, valid: true, unspent: true, version: "v8",
        listingFrozenTerms: { amountSubatoms: "900719925474099312345" }, listingAuthorization: {} }];
    },
    tokenListingWithCanonicalWorkAmoV8Witness: (row, witness) => ({ ...row, frozenTerms: witness.listingFrozenTerms }),
    strictCoreTokenListingReconciliation: async (listings) => ({ listings,
      evidence: { model: "proof-token-market-core-gettxout-v1", includeMempool: true,
        checkpoint: { height: coreHeight, blockHash: coreHash }, checkedOutpointsSha256: "c".repeat(64),
        checkedListingCount: duplicate ? 2 : 1, inputListingCount: 1, outputListingCount: 1,
        spentListingCount: 0, unspentListingCount: 1 } }),
    applyWorkMarketV2CutoverToTokenState: () => { throw Error("authority-fences-passed"); },
  });
  const names = ["tokenListingHistoryUnavailable", "workAmoV8ListingHistoryRecord", "completeTokenListingHistoryPayload"];
  const read = vm.runInContext(`${names.map(extract).join("\n")}\ncompleteTokenListingHistoryPayload`, context);
  return { run: () => read("livenet", "work", new URLSearchParams()), calls: () => batchCalls };
}

test("batched witnesses retain missing-witness and exact Core checkpoint failure gates", async () => {
  for (const options of [{ missing: true }, { duplicate: true }, { coreHeight: 101 }, { coreHash: "d".repeat(64) }]) {
    const fixture = completeBookFixture(options);
    await assert.rejects(fixture.run(), (error) => error.statusCode === 503 && error.details.code === "TOKEN_LISTING_HISTORY_UNAVAILABLE");
    assert.equal(fixture.calls(), 1);
  }
  const good = completeBookFixture();
  await assert.rejects(good.run(), /authority-fences-passed/);
  assert.equal(good.calls(), 1);
});

test("overlapping registry reads share SQL but isolate mutations, checkpoints and later reads", async () => {
  let release, calls = 0;
  const gate = new Promise((resolve) => { release = resolve; });
  const context = vm.createContext({
    structuredClone, IN_FLIGHT_SUMMARY_READS: new Map(),
    proofIndexReadFeatureEnabled: () => true, registryAddressForNetwork: () => "registry",
    proofIndexRegistryPayload: async () => {
      calls++;
      await gate;
      return { records: [{ id: "one", evidence: { blockHash: "original" } }] };
    },
    compareRegistryRecordDisplayOrder: () => 0,
    registryIndexedPayloadRejectReason: () => "", registryConfirmedCount: () => 1,
    proofIndexPayloadIndexedThroughBlock: () => 100,
  });
  const read = vm.runInContext(`${extract("deduplicatedSummaryRead")}\n${extract("indexedRegistryPayload")}\nindexedRegistryPayload`, context);
  const pending = [read("livenet"), read("livenet"), read("livenet", { exactHeight: 100, exactHash: "a".repeat(64) })];
  await Promise.resolve(); await Promise.resolve();
  assert.equal(calls, 2);
  release();
  const results = await Promise.all(pending);
  results[0].records[0].evidence.blockHash = "changed";
  assert.equal(results[1].records[0].evidence.blockHash, "original");
  await read("livenet");
  assert.equal(calls, 3);
});

test("marketplace fallback does not repeat a failed indexed snapshot within the same fallback chain", async () => {
  for (const attempted of [false, true]) {
    let indexedCalls = 0;
    const context = vm.createContext({
      currentProofIndexMarketplaceSummaryFallbackPayload: async () => { indexedCalls++; return null; },
      payloadWithFallbackAfterMs: async (promise) => promise,
      cachedMarketplaceSummaryPayloadNoRefresh: async () => null,
      existingCurrentCanonicalLedgerPayload: async () => null,
      marketplaceSummaryPayloadFromLedger: () => null,
      proofIndexWorkFloorPayload: async () => ({ totalQ8: "900719925474099312345" }),
      emptyMarketplaceSummaryPayload: () => ({}),
      marketplaceSummaryPayloadWithIndexedMarketOverlay: async (payload) => payload,
      MARKETPLACE_SUMMARY_FRESH_WAIT_MS: 2500,
    });
    const read = vm.runInContext(`${extract("marketplaceSummaryFastFallbackPayload")}\nmarketplaceSummaryFastFallbackPayload`, context);
    const result = await read("livenet", { indexedFallbackAttempted: attempted });
    assert.equal(indexedCalls, attempted ? 0 : 1);
    assert.equal(result.workFloor.totalQ8, "900719925474099312345");
  }
});
