import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import vm from "node:vm";
import ts from "typescript";
import * as projection from "../server/boost-projection.mjs";
import { decimalValueToQ8, formatWorkSubatoms, q8ToCanonicalDecimal, q8ToNumber, WORK_SUBATOM_UNIT_SCALE } from "../server/work-units.mjs";

const apiSource = await readFile(new URL("../server/proof-api.mjs", import.meta.url), "utf8");
function definition(name) {
  // Match the existing isolated-function regression harness without building
  // an AST for the entire API in every Node test worker.
  const match = new RegExp(`^(?:async )?function ${name}\\(`, "mu").exec(apiSource);
  if (match) {
    const rest = apiSource.slice(match.index + match[0].length);
    const next = /\n(?:async )?function [A-Za-z_$]/u.exec(rest);
    assert.ok(next, `boundary after ${name}`);
    return apiSource.slice(match.index, match.index + match[0].length + next.index);
  }
  const start = apiSource.indexOf(`const ${name} = new Set([`);
  assert.ok(start >= 0, `actual server definition ${name}`);
  return apiSource.slice(start, apiSource.indexOf("\n]);", start) + 4);
}
const boostSource = apiSource.slice(apiSource.indexOf("const BOOST_VISIBLE_EVENT_KINDS"), apiSource.indexOf("async function registrySummaryPayload", apiSource.indexOf("const BOOST_VISIBLE_EVENT_KINDS")));
const txid = (id) => id.toString(16).padStart(64, "0");
const event = (id, kind = "boost-post", fields = {}) => ({
  eventId: id, txid: txid(id), kind, protocol: "pwb1", confirmed: true, valid: true,
  status: "confirmed", blockHeight: 965000, blockIndex: id, protocolVout: 1, recordOrdinal: 0,
  authorAddress: "owner", proofSignalSats: 546,
  createdAt: new Date(Date.UTC(2026, 8, 1) + id * 1000).toISOString(), text: `post ${id}`, ...fields,
});
function reader(events, mutate = (page) => page) {
  const calls = [];
  const read = async (network, params) => {
    const offset = Number(params.get("cursor")?.replace("fixture-", "") ?? 0);
    const filtered = events.filter((item) => params.get("status") === "all" || item.confirmed);
    const ordered = [...filtered].sort((a, b) => b.eventId - a.eventId);
    const items = ordered.slice(offset, offset + 200);
    const end = offset + items.length;
    const page = { network, source: "proof-indexer-events", snapshotId: "fixture-snapshot",
      indexedThroughBlock: 965000, indexedThroughBlockHash: "a".repeat(64),
      indexedAt: "2026-09-01T00:10:00.000Z", maxEventId: events.length,
      maxUpdatedAt: "2026-09-01T00:10:00.000000Z", totalCount: ordered.length,
      items, start: offset, end, emitted: end, cursor: params.get("cursor") ?? "",
      hasMore: end < ordered.length, nextCursor: end < ordered.length ? `fixture-${end}` : "" };
    calls.push(new URLSearchParams(params));
    return mutate(page, calls.length);
  };
  return { read, calls };
}
function server(readPage, overrides = {}) {
  const context = vm.createContext({ console, URLSearchParams, ...projection,
    decimalValueToQ8, formatWorkSubatoms, q8ToCanonicalDecimal, q8ToNumber,
    WORK_SUBATOM_UNIT_SCALE, WORK_TOKEN_MAX_SUPPLY: 21_000_000,
    proofIndexReadFeatureEnabled: () => true, proofIndexEventHistoryPayload: readPage,
    btcUsdPricePayload: async () => ({ btcUsd: 1 }), cachedWorkFloorPayload: async () => ({ networkValueQ8: "2100000000000000", snapshotId: "fixture-snapshot", indexedThroughBlock: 965000, indexedThroughBlockHash: "a".repeat(64) }),
    btcUsdFromQuote: (quote) => quote?.btcUsd ?? 0,
    satsToUsdAtBtcUsd: (sats, usd) => sats * usd / 100_000_000,
    errorSummary: (error) => error.message,
    payloadIndexedThroughBlockHash: (payload) => payload?.indexedThroughBlockHash ?? "",
    numericValue: (value) => Number(value) || 0,
    boundedInteger: (value, fallback, min, max) => value === null ? fallback : Math.min(max, Math.max(min, Math.trunc(Number(value)) || fallback)),
    dateIso: (value, fallback) => new Date(value ?? fallback).toISOString(),
    normalizePowId: (value) => String(value).toLowerCase().replace(/@proofofwork\.me$/u, ""),
    compareCanonicalUtf8: (a, b) => Buffer.compare(Buffer.from(a), Buffer.from(b)),
    ...overrides,
  });
  vm.runInContext([definition("BOOST_EVENT_KINDS"), definition("canonicalNonNegativeIntegerText"), definition("workSubatomsValueAtNetworkQ8"), boostSource,
    "this.api = { boostFeedPayload, boostOwnershipState, compareBoostFeedItems, boostProfileSignalStats, boostWorkSignalValue };"].join("\n"), context);
  return context.api;
}

test("canonical Boost failures never become successful empty history", async () => {
  for (const read of [async () => null, async () => { throw new Error("database unavailable"); }]) {
    await assert.rejects(server(read).boostFeedPayload("livenet", new URLSearchParams()), /unavailable/u);
  }
  await assert.rejects(server(async () => assert.fail("reader must not run"), {
    proofIndexReadFeatureEnabled: () => false,
  }).boostFeedPayload("livenet", new URLSearchParams()), /unavailable/u);
  const empty = await server(reader([]).read).boostFeedPayload("livenet", new URLSearchParams());
  assert.equal(empty.complete, true);
  assert.equal(empty.totalCount, 0);
  assert.equal(empty.provenance.eventCount, 0);
});

test("complete projection handles 250+ actions, 125 posts, old listings and canonical ownership across pages", async () => {
  const posts = Array.from({ length: 125 }, (_, i) => event(i + 1));
  const actions = Array.from({ length: 120 }, (_, i) => event(i + 126, "boost-like", { targetTxid: txid(1) }));
  const events = [...posts, ...actions,
    event(246, "boost-list", { targetTxid: txid(2), priceSats: 1000, sellerAddress: "owner" }),
    event(247, "boost-list", { targetTxid: txid(1), priceSats: 2000, sellerAddress: "owner" }),
    event(248, "boost-transfer", { targetTxid: txid(1), newOwnerAddress: "buyer", createdAt: "2026-08-01T00:00:00.000Z" }),
    event(249, "boost-follow", { authorAddress: "viewer", targetAddress: "owner" }),
    event(250, "boost-unfollow", { authorAddress: "viewer", targetAddress: "owner", createdAt: "2026-08-01T00:00:00.000Z" }),
    event(251, "boost-transfer", { targetTxid: txid(2), newOwnerAddress: "pending-buyer", confirmed: false, status: "pending" }),
    event(252, "boost-list", { targetTxid: txid(3), priceSats: 9000, valid: false }),
  ];
  const pages = reader(events); const api = server(pages.read);
  const first = await api.boostFeedPayload("livenet", new URLSearchParams("limit=100&sort=oldest&viewer=viewer"));
  assert.equal(first.totalCount, 125);
  assert.equal(first.items.length, 100);
  assert.equal(first.provenance.eventCount, 251);
  assert.equal(first.provenance.pages, 2);
  assert.equal(first.signalStats.totalSignalQ8, (125n * 546n * 100_000_000n).toString());
  assert.equal(first.items[0].likeCount, 120);
  assert.equal(first.items[0].currentOwnerAddress, "buyer");
  assert.equal(first.items[0].listing, null);
  assert.equal(first.graph.followingCount, 0);
  const second = await api.boostFeedPayload("livenet", new URLSearchParams({ limit: "100", sort: "oldest", viewer: "viewer", cursor: first.nextCursor }));
  assert.equal(second.items.length, 25);
  assert.equal(second.hasMore, false);
  assert.equal(new Set([...first.items, ...second.items].map((item) => item.eventId)).size, 125);
  assert.equal(pages.calls.at(-1).get("snapshot"), "fixture-snapshot");
  const listings = await api.boostFeedPayload("livenet", new URLSearchParams("listings=1"));
  assert.equal(listings.complete, true);
  assert.equal(listings.mode, "listings");
  assert.deepEqual(Array.from(listings.items, (item) => item.txid), [txid(2)]);
  assert.equal(listings.items[0].currentOwnerAddress, "owner");
  const pending = await api.boostFeedPayload("livenet", new URLSearchParams("pending=1&sort=oldest"));
  assert.equal(pending.items[1].currentOwnerAddress, "owner", "pending transfers must not mutate canonical ownership");
  const searched = await api.boostFeedPayload("livenet", new URLSearchParams("q=post+125"));
  assert.equal(searched.items[0].txid, txid(125));
  const searchedTxid = await api.boostFeedPayload("livenet", new URLSearchParams({ q: txid(125) }));
  assert.equal(searchedTxid.items[0].txid, txid(125));
});

test("history cursor changes, duplicate rows and broken exhaustion fail closed", async () => {
  const events = Array.from({ length: 201 }, (_, i) => event(i + 1));
  for (const mutate of [
    (page, n) => n === 2 ? { ...page, snapshotId: "changed" } : page,
    (page, n) => n === 2 ? { ...page, maxUpdatedAt: "changed" } : page,
    (page, n) => n === 2 ? { ...page, items: [{ ...page.items[0], eventId: 201 }] } : page,
    (page) => ({ ...page, hasMore: false, nextCursor: "" }),
    (page) => ({ ...page, nextCursor: "" }),
  ]) await assert.rejects(projection.readCompleteBoostHistory("livenet", reader(events, mutate).read));
  await assert.rejects(projection.readCompleteBoostHistory("livenet", reader(events, (page, n) => {
    if (n === 2) throw Object.assign(new Error("reader fence conflict"), { statusCode: 409 });
    return page;
  }).read), /fence conflict/u);
});

test("complete AMO discovery has no 100-post cap and emits each original ticket once", async () => {
  const posts = Array.from({ length: 125 }, (_, i) => event(i + 1));
  const listings = posts.map((post, i) => event(i + 126, "boost-list", { boostTxid: post.txid, priceSats: 1000, sellerAddress: "owner" }));
  const events = [...posts, ...listings,
    event(251, "boost-reply", { targetTxid: txid(1) }),
    event(252, "boost-reboost", { targetTxid: txid(1) }),
  ];
  const result = await server(reader(events).read).boostFeedPayload("livenet", new URLSearchParams("listings=1&limit=100"));
  assert.equal(result.items.length, 125);
  assert.equal(result.totalCount, 125);
  assert.equal(result.hasMore, false);
  assert.equal(new Set(result.items.map((item) => item.listing.listingTxid)).size, 125);
  assert.ok(result.items.every((item) => item.kind === "boost-post"));
});

test("feed continuation rejects changed filters, valuation or history", async () => {
  const events = Array.from({ length: 101 }, (_, i) => event(i + 1));
  const api = server(reader(events).read);
  const first = await api.boostFeedPayload("livenet", new URLSearchParams("limit=100"));
  await assert.rejects(api.boostFeedPayload("livenet", new URLSearchParams({ cursor: first.nextCursor, sort: "oldest" })), /changed/u);
  const changed = server(reader([...events, event(102)]).read);
  await assert.rejects(changed.boostFeedPayload("livenet", new URLSearchParams({ cursor: first.nextCursor })), /changed/u);
  const changedFloor = server(reader(events).read, { cachedWorkFloorPayload: async () => ({ networkValueQ8: "2100000000000001" }) });
  await assert.rejects(changedFloor.boostFeedPayload("livenet", new URLSearchParams({ cursor: first.nextCursor })), /changed/u);
  assert.throws(() => projection.decodeBoostFeedCursor("bad"), /cursor/u);
});

test("exact Boost rank and aggregates retain sub-proof differences above floating precision", () => {
  const api = server(reader([]).read);
  const lower = { txid: txid(1), totalSignalQ8: "900719925474099200000001", totalSignalSatsExact: "9007199254740992.00000001", totalSignalSats: 9007199254740992, proofSignalQ8: "54600000000", workSignalSubatoms: "10000000000000001", createdAt: "2026-09-05T00:00:00Z" };
  const higher = { ...lower, txid: txid(2), totalSignalQ8: "900719925474099200000002", totalSignalSatsExact: "9007199254740992.00000002", createdAt: "2026-09-04T00:00:00Z" };
  assert.equal([lower, higher].sort(api.compareBoostFeedItems("value"))[0], higher);
  const stats = api.boostProfileSignalStats([lower, higher].map((feedItem) => ({ feedItem })));
  assert.equal(stats.totalSignalQ8, "1801439850948198400000003");
  assert.equal(stats.totalSignalSatsExact, "18014398509481984.00000003");
  assert.equal(stats.workSignalSubatoms, "20000000000000002");
  const value = api.boostWorkSignalValue("10000000000000001", { networkValueQ8: "2100000000000000000000000" });
  assert.equal(value.workSignalValueQ8, "100000000000000010");
  assert.throws(() => api.boostWorkSignalValue("1", null), /valuation is unavailable/u);
});

test("WORK valuation must bind the same exact checkpoint as complete Boost history", async () => {
  const events = [event(1, "boost-post", { workSignalSubatoms: "10000000000000000" })];
  const floor = { networkValueQ8: "2100000000000000", snapshotId: "fixture-snapshot", indexedThroughBlock: 965000, indexedThroughBlockHash: "a".repeat(64) };
  const good = await server(reader(events).read).boostFeedPayload("livenet", new URLSearchParams());
  assert.equal(good.valuationProvenance.used, true);
  assert.equal(good.valuationProvenance.snapshotId, good.snapshotId);
  for (const bad of [null, { ...floor, snapshotId: "changed" }, { ...floor, indexedThroughBlock: 965001 }, { ...floor, indexedThroughBlockHash: "b".repeat(64) }]) {
    await assert.rejects(server(reader(events).read, { cachedWorkFloorPayload: async () => bad }).boostFeedPayload("livenet", new URLSearchParams()), /one canonical checkpoint/u);
  }
});

async function importTs(path, replacements = {}) {
  let source = await readFile(new URL(path, import.meta.url), "utf8");
  for (const [from, to] of Object.entries(replacements)) source = source.replace(from, to);
  const js = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText;
  return `data:text/javascript;base64,${Buffer.from(js).toString("base64")}`;
}
test("client exact formatting and sums never round Q8 or subatoms through Number", async () => {
  const exactUrl = await importTs("../src/exactAmount.ts");
  const url = await importTs("../src/features/boost/boostAmounts.ts", { '"../../exactAmount"': JSON.stringify(exactUrl) });
  const { boostSignalQ8, formatBoostSignal } = await import(url);
  const value = boostSignalQ8("900719925474099200000001", "9007199254740992.00000001", 9007199254740992);
  assert.equal(formatBoostSignal(value), "9,007,199,254,740,992.00000001 proofs");
  assert.equal(formatBoostSignal(value + 1n), "9,007,199,254,740,992.00000002 proofs");
  assert.equal(boostSignalQ8(undefined, "546.00000001"), 54600000001n);
  assert.throws(() => boostSignalQ8(undefined, undefined, 9007199254740992), /missing its exact/u);
  assert.throws(() => boostSignalQ8("1", "0.00000002"), /disagree/u);
  assert.throws(() => boostSignalQ8("invalid", "0.00000001"), /invalid/u);
  assert.throws(() => boostSignalQ8("-1", "0"), /invalid/u);
  assert.throws(() => boostSignalQ8(-1n, "0"), /invalid/u);
});

test("reversed and aborted client reads cannot apply stale payload, status or completion", async () => {
  const { createBoostReadLifecycle } = await import(await importTs("../src/features/boost/boostReadLifecycle.ts"));
  const lifecycle = createBoostReadLifecycle();
  const state = { payload: "", status: "", busy: true };
  let finishOld;
  const old = lifecycle.begin();
  const oldRead = new Promise((resolve) => { finishOld = resolve; }).then(() => {
    if (old.current()) Object.assign(state, { payload: "old", status: "old success", busy: false });
  });
  const current = lifecycle.begin();
  assert.equal(old.signal.aborted, true);
  if (current.current()) Object.assign(state, { payload: "current", status: "current success", busy: false });
  finishOld(); await oldRead;
  assert.deepEqual(state, { payload: "current", status: "current success", busy: false });
  lifecycle.cancel();
  assert.equal(current.current(), false);
  assert.equal(current.signal.aborted, true);
});

test("server exact signal rejects malformed or conflicting provided Q8 instead of falling back", () => {
  for (const value of ["-1", "1.2", "01", "", 1, -1n]) {
    assert.throws(() => projection.boostExactQ8(value, "1"), /invalid exact Q8/u);
  }
  assert.throws(() => projection.boostExactQ8("100000000", "2"), /disagree/u);
  assert.equal(projection.boostExactQ8("100000001", "1.00000001"), 100000001n);
  assert.equal(projection.boostExactQ8(undefined, "0.00000001"), 1n);
});
