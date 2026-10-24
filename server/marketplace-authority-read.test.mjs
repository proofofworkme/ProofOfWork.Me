import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import vm from "node:vm";

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
