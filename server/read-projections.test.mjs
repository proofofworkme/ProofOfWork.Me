import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { test } from "node:test";
import { registryCountsProjection, tokenDirectoryProjection, tokenListingDisplayProjection, withTokenDirectoryQualification } from "./read-projections.mjs";

test("registry counts preserve full registration state and checkpoint without transporting IDs", () => {
  const source = { records: [{ confirmed: true, id: "a" }, { confirmed: false, id: "b" }],
    stats: { confirmed: 1, pending: 9, total: 2 }, snapshotId: "snapshot", indexedThroughBlockHash: "a".repeat(64),
    activity: [{ huge: "payload" }], listings: [{ huge: "payload" }] };
  const result = registryCountsProjection(source);
  assert.deepEqual(result.registryCounts, { model: "proof-registry-counts-v1", complete: true, confirmedCount: 1, pendingCount: 1, totalCount: 2 });
  assert.equal(result.snapshotId, source.snapshotId);
  assert.equal(result.indexedThroughBlockHash, source.indexedThroughBlockHash);
  assert.ok(!("records" in result) && !("listings" in result) && !("activity" in result));
  assert.equal(source.records.length, 2);
});
test("unknown, truncated and malformed registry state never becomes a successful zero count", () => {
  for (const source of [{}, { records: [], stats: { total: 1 } },
    { records: [{}], stats: { total: 1 } }, { records: [], stats: { total: 0 }, collectionHasMore: { records: true } }]) {
    assert.throws(() => registryCountsProjection(source), (error) => error.statusCode === 503);
  }
  assert.equal(registryCountsProjection({ records: [], stats: { total: 0 } }).registryCounts.totalCount, 0);
});
test("directory qualification keeps exact supply and distinguishes complete, empty, unknown and preview", () => {
  const tokens = [{ tokenId: "work", confirmedSupplySubatoms: "210000000000000000000000", confirmedMints: 21000 }];
  const result = withTokenDirectoryQualification({ tokens, totalCounts: { tokens: 1 } });
  assert.equal(result.directory.complete, true);
  assert.equal(result.tokens, tokens);
  for (const source of [{}, { tokens, totalCounts: { tokens: 2 } },
    { tokens, totalCounts: { tokens: 1 }, collectionHasMore: { tokens: true } },
    { tokens: [...tokens, ...tokens], totalCounts: { tokens: 2 } }]) {
    assert.equal(withTokenDirectoryQualification(source).directory.complete, false);
  }
  assert.equal(withTokenDirectoryQualification({ tokens: [], totalCounts: { tokens: 0 } }).directory.complete, true);
});
test("display listing removes only replay transport fields while preserving frozen terms, authorization and evidence references", () => {
  const original = {
    listingId: "a".repeat(64), tokenId: "b".repeat(64), confirmed: true, amountSubatoms: "9007199254740993",
    listingFrozenTerms: { priceSats: "25000", prefixValueQ8: "813148268234259249036194922" },
    listingAuthorization: { sellerSignature: "frozen-signature", sighash: 0x83 },
    workAmoV5ReplayOutput: { large: "x".repeat(10000) }, workAmoV5ReplayRawWitness: "a".repeat(10000),
    workAmoV5RawScriptWitness: "b".repeat(10000), futureUnknownField: { retain: true },
  };
  const before = JSON.stringify(original);
  const fullRecordSha256 = createHash("sha256").update(before).digest("hex");
  const projected = tokenListingDisplayProjection(original, { fullRecordSha256, network: "livenet", tokenScope: original.tokenId });
  for (const [key, value] of Object.entries(original)) {
    if (!projected.displayEvidence.omittedFields.includes(key)) assert.deepEqual(projected[key], value);
  }
  assert.equal(projected.displayEvidence.fullRecordSha256, fullRecordSha256);
  const detail = new URL(projected.displayEvidence.fullDetailPath, "https://example.test");
  assert.equal(detail.searchParams.get("q"), original.listingId);
  assert.equal(detail.searchParams.get("listingId"), original.listingId);
  assert.equal(detail.searchParams.get("asset"), original.tokenId);
  assert.equal(detail.searchParams.get("projection"), "full");
  assert.ok(JSON.stringify(projected).length < before.length / 10);
  assert.equal(JSON.stringify(original), before);
});

test("directory-only transport preserves exact aggregates while explicitly omitting history authority", () => {
  const tokens = [{ tokenId: "work", confirmedSupplySubatoms: "210000000000000000000000", confirmedMints: 21000 }];
  const source = { tokens, totalCounts: { tokens: 1, mints: 21000, listings: 600 },
    collectionHasMore: { mints: true, tokens: false }, snapshotId: "snapshot",
    listings: [{ amountSubatoms: "9007199254740993", witness: "a".repeat(100000) }],
    stats: { confirmedSupplySubatoms: "210000000000000000000000" } };
  const projected = tokenDirectoryProjection(source);
  assert.equal(projected.tokens, tokens);
  assert.deepEqual(projected.stats, source.stats);
  assert.deepEqual(projected.totalCounts, source.totalCounts);
  assert.equal(projected.snapshotId, source.snapshotId);
  assert.equal(projected.directory.complete, true);
  assert.equal(projected.directoryOnly, true);
  assert.equal(projected.listingBookComplete, false);
  assert.equal(projected.collectionHasMore.listings, true);
  assert.equal(projected.collectionHasMore.mints, true);
  assert.deepEqual(projected.listings, []);
  assert.ok(JSON.stringify(projected).length < JSON.stringify(source).length / 10);
  assert.equal(source.listings.length, 1);
  assert.throws(() => tokenDirectoryProjection({ tokens: [] }), (error) => error.statusCode === 503);
});
