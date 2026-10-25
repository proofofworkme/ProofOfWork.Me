import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";
import { createAmoBrowseSnapshotStore } from "./amo-browse-snapshot.mjs";

const hash = (number) => number.toString(16).padStart(64, "0");
const assets = { work: hash(1), powb: hash(2), incb: hash(3) };
const credit = hash(4);
const emptyCredit = hash(5);
const checkpoint = { height: 980000, blockHash: hash(100) };
const start = Date.parse("2026-10-25T12:00:00Z");
const isSealed = (item) => item.sealConfirmed === true;
function listing(number, fields = {}) {
  const listingId = hash(number + 1000);
  return {
    listingId, tokenId: credit, amount: "10", priceSats: 100,
    createdAt: "2026-10-25T11:00:00Z", network: "livenet", confirmed: true,
    sealConfirmed: true, sellerAddress: "seller", saleAuthorization: { version: "pwt-sale-v1" },
    displayEvidence: { model: "proof-token-listing-display-v2", fullRecordSha256: hash(90), omittedFields: [],
      fullDetailPath: `/api/v1/token-history?kind=listings&network=livenet&q=${listingId}&listingId=${listingId}&projection=full` },
    ...fields,
  };
}
function candidate(items = [listing(1), listing(2), listing(3)], now = start) {
  const component = { snapshotId: "source-snapshot", indexedThroughBlock: checkpoint.height, indexedThroughBlockHash: checkpoint.blockHash };
  return {
    observedAt: new Date(now).toISOString(), checkpoint: { ...checkpoint },
    summary: {
      ...component, network: "livenet", indexedAt: new Date(now).toISOString(),
      registry: { ...component, listings: [], records: [], stats: {} },
      token: { ...component, listings: [listing(100)], tokens: [
        { tokenId: assets.work, ticker: "WORK", mintAmount: 1000, mintPriceSats: 1000 },
        { tokenId: credit, ticker: "CREDIT", mintAmount: 1, mintPriceSats: 5 },
        { tokenId: emptyCredit, ticker: "EMPTY", mintAmount: 1, mintPriceSats: 1 },
      ], worker: { privateDiagnostic: "must be omitted" }, stats: {} },
      workFloor: { ...component, liveFloorQ8: "1000000000", workAmoV8: {
        version: "pwt-sale-v8", ready: true, protocolReady: true, writeAdmission: true,
        protocolWritesEnabled: true, settlementWritesEnabled: true, listingWritesEnabled: true,
        activation: { reached: true, active: true, evidenceComplete: true, tipVerified: true },
      } },
      provenance: { ...component, coherent: true, ready: true, served: "exact-tip" },
      browseBondReferences: Object.fromEntries([assets.powb, assets.incb].map((id) => [id, {
        ...component, displayOnly: true, indexedAt: new Date(now).toISOString(), floorQ8: "100000000", floorSats: "1",
      }])),
    },
    book: {
      ...component, snapshotId: "listing-snapshot", indexedAt: new Date(now).toISOString(),
      items, totalCount: items.length, hasMore: false, start: 0, end: items.length,
      listingProjection: { scope: "complete-book", activeListingCount: items.length, membershipSha256: hash(8), coreUnspentListingCount: items.length, excludedByProtocolCount: 0 },
      itemProjection: { model: "proof-token-listing-display-v2", fullMembershipSha256: hash(9), fullSourceSha256: hash(10) },
      listingAuthority: { model: "proof-token-market-core-gettxout-v1", includeMempool: true,
        checkedListingCount: items.length, inputListingCount: items.length, outputListingCount: items.length,
        unspentListingCount: items.length, spentListingCount: 0,
        checkpoint: { ...checkpoint }, checkedOutpointsSha256: hash(11) },
    },
  };
}
function harness(options = {}) {
  let time = start;
  let source = candidate();
  let builds = 0;
  let observations = 0;
  const store = createAmoBrowseSnapshotStore({
    assets, isSealed, now: () => time, minimumRefreshMs: 0,
    build: async () => { builds += 1; if (source instanceof Error) throw source; return source; },
    observe: async () => { observations += 1; return { ...checkpoint, invalidVersions: [] }; },
    ...options,
  });
  return { store, advance: (ms) => { time += ms; }, set: (value) => { source = value; },
    stats: () => ({ builds, observations }), now: () => time };
}
const params = (values = {}) => new URLSearchParams(values);
const code = (expected) => (error) => error.details?.code === expected;

test("cold read returns unavailable without starting or waiting for database work", () => {
  const h = harness();
  assert.throws(() => h.store.read(), code("AMO_BROWSE_WARMING"));
  assert.deepEqual(h.stats(), { builds: 0, observations: 0 });
});

test("complete immutable snapshot pages and summary are compact, qualified and perform no authority reads", async () => {
  const h = harness();
  const original = candidate();
  original.summary.registry.activity = [{ txid: hash(30) }];
  original.summary.token.invalidEvents = [{ reason: "historical diagnostic" }];
  original.summary.token.mints = [{ txid: hash(31) }];
  original.summary.token.closedListings = [{ listingId: hash(32), lifecycle: "relic",
    frozenTerms: { version: "pwt-sale-v6" }, workAmoV5RawScriptWitness: "large historical witness" }];
  h.set(original);
  assert.equal(await h.store.refresh(), true);
  const first = h.store.read(params({ limit: "1" }));
  assert.match(first.version, /^[0-9a-f]{64}$/u);
  assert.equal(first.displayOnly, true);
  assert.equal(first.provenance.authoritative, false);
  assert.equal(first.summary.provenance.ready, false);
  assert.equal(first.summary.token.worker, undefined);
  assert.equal(first.summary.registry.activity[0].txid, hash(30));
  assert.deepEqual(first.summary.token.mints, []);
  assert.deepEqual(first.summary.token.invalidEvents, []);
  assert.equal(first.summary.token.collectionHasMore.invalidEvents, true);
  assert.equal(first.summary.token.closedListings[0].lifecycle, "relic");
  assert.equal(first.summary.token.closedListings[0].frozenTerms.version, "pwt-sale-v6");
  assert.equal(first.summary.token.closedListings[0].workAmoV5RawScriptWitness, undefined);
  assert.equal(first.summary.workFloor.workAmoV8.activation.evidenceComplete, true);
  assert.equal(first.summary.workFloor.workAmoV8.activation.reached, true);
  assert.equal(first.summary.workFloor.workAmoV8.writeAdmission, false);
  assert.equal(first.summary.workFloor.workAmoV8.settlementWritesEnabled, false);
  assert.equal(first.summary.workFloor.workAmoV8.reasonCode, "amo-browse-display-requires-fresh-preflight");
  assert.deepEqual(first.summary.token.listings, []);
  assert.equal(first.book.totalCount, 3);
  assert.equal(first.book.items.length, 1);
  assert.equal(first.book.assetCounts[emptyCredit].all, 0);
  assert.equal(first.summary.token.stats.activeListings, 3);
  assert.equal(first.summary.token.tokens.find((token) => token.tokenId === credit).confirmedOpenListings, 3);
  assert.equal(first.summary.token.tokens.find((token) => token.tokenId === emptyCredit).openListings, 0);
  original.book.items[1].priceSats = 999999;
  const stats = h.stats();
  const next = h.store.read(params({ limit: "1", includeSummary: "0", cursor: first.book.nextCursor }));
  assert.equal(next.summary, undefined);
  assert.equal(next.book.items[0].priceSats, 100);
  assert.deepEqual(h.stats(), stats);
  assert.throws(() => { next.book.items[0].priceSats = 0; }, TypeError);
});

test("browse summaries omit batch recipient history without losing totals or prior truncation evidence", async () => {
  for (const [rows, previouslyTruncated, hasMore] of [
    [[{ txid: hash(40), recipients: Array.from({ length: 256 }, (_, index) => ({
      recipientAddress: `recipient-${index}`, amountSubatoms: "10000000000000000",
    })) }], false, true],
    [[], true, true],
    [[], false, false],
  ]) {
    const h = harness();
    const source = candidate();
    const totalBatches = hasMore ? 42 : 0;
    source.summary.token.transferBatches = rows;
    source.summary.token.totalCounts = { transferBatches: totalBatches, transfers: totalBatches * 256 };
    source.summary.token.collectionHasMore = { transferBatches: previouslyTruncated };
    source.summary.token.stats.confirmedTransferBatches = totalBatches;
    h.set(source);
    assert.equal(await h.store.refresh(), true);
    const summary = h.store.read().summary;
    assert.deepEqual(summary.token.transferBatches, []);
    assert.equal(summary.token.collectionHasMore.transferBatches, hasMore);
    assert.equal(summary.token.totalCounts.transferBatches, totalBatches);
    assert.equal(summary.token.totalCounts.transfers, totalBatches * 256);
    assert.equal(summary.token.stats.confirmedTransferBatches, totalBatches);
    assert.equal(summary.token.snapshotId, source.summary.token.snapshotId);
    assert.equal(JSON.stringify(summary).includes("recipient-"), false);
    assert.deepEqual(source.summary.token.transferBatches, rows);
  }
});

test("scope counts and global token counts use the full book independently of query and status", async () => {
  const h = harness();
  h.set(candidate([listing(1), listing(2, { sealConfirmed: false }), listing(3, { tokenId: assets.powb })]));
  await h.store.refresh();
  const page = h.store.read(params({ asset: "credits", status: "sealed", q: "seller" }));
  assert.deepEqual(page.book.counts, { all: 2, sealed: 1, unsealed: 1 });
  assert.equal(page.book.totalCount, 1);
  assert.equal(page.book.assetCounts[assets.powb].all, 1);
  assert.equal(h.store.read(params({ asset: credit })).book.totalCount, 2);
  assert.equal(h.store.read(params({ q: "no match" })).book.totalCount, 0);
});

test("old version continues after publication; eviction and cursor changes require restart", async () => {
  const h = harness();
  await h.store.refresh();
  const first = h.store.read(params({ limit: "1" }));
  h.advance(1);
  h.set(candidate([listing(8), listing(9)], h.now()));
  await h.store.refresh();
  const old = h.store.read(params({ cursor: first.book.nextCursor, limit: "1" }));
  assert.equal(old.version, first.version);
  assert.equal(old.book.totalCount, 3);
  for (const change of [{ sort: "price-asc" }, { q: "seller" }, { status: "sealed" }, { asset: credit }, { limit: "2" }]) {
    assert.throws(() => h.store.read(params({ cursor: first.book.nextCursor, limit: "1", ...change })), code("AMO_BROWSE_CURSOR_CONFLICT"));
  }
  assert.throws(() => h.store.read(params({ cursor: first.book.nextCursor, limit: "1", version: h.store.read().version })), code("AMO_BROWSE_CURSOR_CONFLICT"));
  h.advance(1);
  h.set(candidate([listing(10)], h.now()));
  await h.store.refresh();
  assert.throws(() => h.store.read(params({ cursor: first.book.nextCursor, limit: "1" })), code("AMO_BROWSE_VERSION_EXPIRED"));
});

test("failed builds retain explicitly last-verified state, then expire at the age limit", async () => {
  const h = harness({ maxAgeMs: 1000 });
  await h.store.refresh();
  const version = h.store.read().version;
  h.advance(800);
  h.set(new Error("canonical source unavailable"));
  assert.equal(await h.store.refresh(), false);
  const retained = h.store.read();
  assert.equal(retained.version, version);
  assert.equal(retained.state, "last-verified");
  assert.equal(retained.refreshError.code, "AMO_BROWSE_REFRESH_UNAVAILABLE");
  assert.equal(retained.provenance.ageMs, 800);
  h.advance(201);
  assert.throws(() => h.store.read(), code("AMO_BROWSE_WARMING"));
  assert.throws(() => h.store.read(params({ version })), code("AMO_BROWSE_VERSION_EXPIRED"));
});

test("a checkpoint mismatch, incomplete membership or duplicate identity cannot replace a verified version", async () => {
  const h = harness();
  await h.store.refresh();
  const version = h.store.read().version;
  const mutations = [
    (v) => { v.book.indexedThroughBlock += 1; },
    (v) => { v.summary.provenance.ready = false; },
    (v) => { v.summary.token.snapshotId = "mixed"; },
    (v) => { v.book.totalCount += 1; },
    (v) => { v.book.hasMore = true; },
    (v) => { v.book.items[1] = v.book.items[0]; },
    (v) => { v.book.listingAuthority.includeMempool = false; },
    (v) => { v.book.listingAuthority.checkedListingCount += 1; },
    (v) => { v.book.items[0].network = "testnet"; },
    (v) => { v.book.items[0].confirmed = false; },
    (v) => { v.book.items[0].displayEvidence.fullRecordSha256 = "invalid"; },
  ];
  for (const mutate of mutations) {
    const invalid = candidate(); mutate(invalid); h.set(invalid);
    assert.equal(await h.store.refresh(), false);
    assert.equal(h.store.read().version, version);
  }
});

test("concurrent rebuild requests coalesce while an existing snapshot remains immediately readable", async () => {
  let release;
  let blocked = false;
  let builds = 0;
  const h = harness({ build: async () => {
    builds += 1;
    if (blocked) await new Promise((resolve) => { release = resolve; });
    return candidate();
  } });
  await h.store.refresh();
  blocked = true;
  const first = h.store.refresh();
  const second = h.store.refresh();
  assert.equal(first, second);
  await Promise.resolve();
  assert.equal(h.store.read().refreshing, true);
  assert.equal(builds, 2);
  release();
  await first;
  assert.equal(h.store.read().refreshing, false);
});

test("completion cooldown prevents visitors from forcing back-to-back full rebuilds", async () => {
  const h = harness({ minimumRefreshMs: 15000 });
  await h.store.refresh();
  assert.equal(await h.store.refresh(), false);
  assert.equal(h.stats().builds, 1);
  h.advance(15000);
  assert.equal(await h.store.refresh(), true);
  assert.equal(h.stats().builds, 2);
});

test("stopping an in-flight warmer cancels publication and does not schedule another timer", async () => {
  let release;
  const h = harness({ build: async () => { await new Promise((resolve) => { release = resolve; }); return candidate(); } });
  const running = h.store.refresh();
  await Promise.resolve();
  h.store.stop();
  release();
  assert.equal(await running, false);
  assert.throws(() => h.store.read(), code("AMO_BROWSE_WARMING"));
});

test("reorg observations evict revoked versions; unavailable observers retain qualification", async () => {
  let revoked = false;
  let failed = false;
  const h = harness({ minimumRefreshMs: 15000, observe: async (values) => {
    if (failed) throw new Error("RPC unavailable");
    return { ...checkpoint, invalidVersions: revoked ? values.map((v) => v.version) : [] };
  } });
  await h.store.refresh();
  failed = true;
  await h.store.poll();
  assert.equal(h.store.read().provenance.currentChain.available, false);
  failed = false; revoked = true;
  await h.store.poll();
  assert.throws(() => h.store.read(), code("AMO_BROWSE_WARMING"));
});

test("a reorg during candidate preparation refuses atomic publication", async () => {
  const h = harness({ observe: async (values) => ({ ...checkpoint, invalidVersions: values.map((v) => v.version) }) });
  assert.equal(await h.store.refresh(), false);
  assert.throws(() => h.store.read(), code("AMO_BROWSE_WARMING"));
});

test("exact price sorting uses unit quantities, including WORK Q16, beyond Number precision", async () => {
  const items = [
    listing(1, { tokenId: assets.work, amountSubatoms: "90071992547409930000000000000000", priceSats: 100 }),
    listing(2, { tokenId: assets.work, amountSubatoms: "90071992547409930000000000000001", priceSats: 100 }),
    listing(3, { amount: "2", priceSats: 10 }),
    listing(4, { amount: "100", priceSats: 100 }),
  ];
  const h = harness(); h.set(candidate(items)); await h.store.refresh();
  assert.deepEqual(h.store.read(params({ sort: "price-asc" })).book.items.map((item) => item.listingId),
    [items[1], items[0], items[3], items[2]].map((item) => item.listingId));
});

test("exact buyer arb sorting preserves negative values and leaves unsealed values last", async () => {
  const work = (n, amount, price) => listing(n, {
    tokenId: assets.work, amountSubatoms: amount, priceSats: price,
    frozenTerms: { version: "pwt-sale-v8", unitAmountSubatoms: amount, unitPriceSats: String(price) },
  });
  const items = [work(1, "10000000000000000", 12), work(2, "10000000000000001", 12),
    work(3, "10000000000000000", 9), listing(4, { sealConfirmed: false })];
  const h = harness(); h.set(candidate(items)); await h.store.refresh();
  assert.deepEqual(h.store.read(params({ sort: "arb-desc" })).book.items.map((item) => item.listingId),
    [items[2], items[1], items[0], items[3]].map((item) => item.listingId));
  assert.deepEqual(h.store.read(params({ sort: "arb-asc" })).book.items.map((item) => item.listingId),
    [items[0], items[1], items[2], items[3]].map((item) => item.listingId));
});

test("bond buyer arb uses its pinned exact floor instead of token mint or last-sale prices", async () => {
  for (const tokenId of [assets.powb, assets.incb]) {
    const items = [listing(1, { tokenId, amount: "10", priceSats: 20 }),
      listing(2, { tokenId, amount: "1", priceSats: 1 })];
    const source = candidate(items);
    source.summary.token.tokens.push({ tokenId, mintAmount: 1, mintPriceSats: 1, lastSalePricePerToken: "1" });
    Object.assign(source.summary.browseBondReferences[tokenId], { floorQ8: "1000000000", floorSats: "10" });
    const h = harness(); h.set(source); assert.equal(await h.store.refresh(), true);
    const page = h.store.read(params({ asset: tokenId, sort: "arb-desc" }));
    assert.deepEqual(page.book.items.map((item) => item.listingId), items.map((item) => item.listingId));
    assert.equal(page.summary.browseBondReferences[tokenId].floorQ8, "1000000000");
    for (const mutate of [
      (v) => { v.summary.browseBondReferences[tokenId].indexedThroughBlock -= 1; },
      (v) => { delete v.summary.browseBondReferences[tokenId]; },
      (v) => { v.summary.browseBondReferences[tokenId].floorQ8 = "1.5"; },
    ]) {
      const invalid = structuredClone(source); mutate(invalid); h.set(invalid);
      assert.equal(await h.store.refresh(), false);
      assert.equal(h.store.read().version, page.version);
    }
  }
});

test("snapshot memory, row, and request budgets refuse unsafe input", async () => {
  const h = harness({ maxBytes: 1000 });
  assert.equal(await h.store.refresh(), false);
  const rows = harness({ maxListings: 2 });
  assert.equal(await rows.store.refresh(), false);
  const normal = harness(); await normal.store.refresh();
  for (const values of [{ limit: "101" }, { page: "1" }, { offset: "1" }, { sort: "unknown" }, { q: "q".repeat(513) }]) {
    assert.throws(() => normal.store.read(params(values)), code("AMO_BROWSE_REQUEST_INVALID"));
  }
  assert.throws(() => normal.store.read(params({ cursor: "invalid" })), code("AMO_BROWSE_CURSOR_CONFLICT"));
});

test("integration keeps browse before the request authority gate and startup warming configuration-scoped", async () => {
  const source = await readFile(new URL("./proof-api.mjs", import.meta.url), "utf8");
  const route = source.indexOf('if (url.pathname === "/api/v1/marketplace-browse")');
  const gate = source.indexOf("canonicalPublicReadGateApplies(url.pathname)", route);
  assert.ok(route > 0 && gate > route);
  const body = source.slice(route, gate);
  assert.match(body, /amoBrowseStore\.read\(url\.searchParams\)/u);
  assert.doesNotMatch(body, /await .*amoBrowseStore/u);
  assert.match(source, /if \(amoBrowseEnabled\(\)\) amoBrowseStore\.start\(\);/u);
  assert.match(source, /request\.limit = TOKEN_LISTING_LIFECYCLE_MATERIALIZATION_LIMIT;/u);
});

test("actual browse route accepts refresh scheduling, rejects fresh authority, and never invokes the canonical gate", async () => {
  const source = await readFile(new URL("./proof-api.mjs", import.meta.url), "utf8");
  const beginning = source.indexOf('if (url.pathname === "/api/v1/marketplace-browse")');
  const ending = source.indexOf("const authenticatedLoopbackRead", beginning);
  const route = source.slice(beginning, ending);
  const h = harness();
  await h.store.refresh();
  let refreshes = 0;
  let response;
  const run = (query, network = "livenet") => {
    const context = {
      url: new URL(`https://example.invalid/api/v1/marketplace-browse?${query}`), network,
      response: {}, amoBrowseEnabled: () => true,
      booleanSearchParam: (search, key) => ["1", "true", "yes"].includes(String(search.get(key)).toLowerCase()),
      amoBrowseStore: { read: h.store.read, refresh: () => { refreshes += 1; return Promise.resolve(); } },
      jsonResponse: (_response, status, body) => { response = { status, body }; },
      errorResponse: (_response, status, message, details) => { response = { status, message, details }; },
    };
    return vm.runInNewContext(`(async () => { ${route}\n throw new Error("fell through to canonical gate"); })()`, context);
  };
  await run("refresh=1&includeSummary=0&limit=1");
  assert.equal(response.status, 200);
  assert.equal(refreshes, 1);
  assert.equal(response.body.summary, undefined);
  assert.equal(response.body.book.items.length, 1);
  assert.equal(response.body.book.page, 0);
  assert.deepEqual(response.body.query, { asset: "all", status: "all", q: "", sort: "arb-desc" });
  await run("fresh=1");
  assert.equal(response.status, 400);
  await run("nocache=1");
  assert.equal(response.status, 400);
  await run("", "testnet");
  assert.equal(response.status, 400);
  await assert.rejects(run("version=missing"), code("AMO_BROWSE_VERSION_EXPIRED"));
});
