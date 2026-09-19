import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import vm from "node:vm";
import ts from "typescript";
import * as projection from "../server/boost-projection.mjs";
import { verifiedBoostTicketClosures } from "../server/boost-marketplace-proof.mjs";
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
  recipients: [{ address: "registry", vout: 0, amountSats: "546" }, { address: fields.targetAddress ?? "owner", vout: 2, amountSats: "546" }],
  createdAt: new Date(Date.UTC(2026, 8, 1) + id * 1000).toISOString(), text: `post ${id}`, ...fields,
});
function reader(events, mutate = (page) => page) {
  const calls = [];
  const read = async (network, params) => {
    const offset = Number(params.get("cursor")?.replace("fixture-", "") ?? 0);
    const registry = [event(900001, "id-register", { protocol: "pwid1", id: "boost", receiveAddress: "registry", blockHeight: 964000 })];
    const inventory = params.get("protocol") === "pwid1" ? registry : events;
    const filtered = inventory.filter((item) => params.get("status") === "all" || item.confirmed);
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
  const context = vm.createContext({ console, URLSearchParams, ...projection, verifiedBoostTicketClosures,
    decimalValueToQ8, formatWorkSubatoms, q8ToCanonicalDecimal, q8ToNumber,
    WORK_SUBATOM_UNIT_SCALE, WORK_TOKEN_MAX_SUPPLY: 21_000_000,
    proofIndexReadFeatureEnabled: () => true, proofIndexEventHistoryPayload: readPage,
    registryAddressForNetwork: () => "id-registry",
    btcUsdPricePayload: async () => ({ btcUsd: 1 }), cachedWorkFloorPayload: async () => ({ networkValueQ8: "2100000000000000", snapshotId: "fixture-snapshot", indexedThroughBlock: 965000, indexedThroughBlockHash: "a".repeat(64) }),
    btcUsdFromQuote: (quote) => quote?.btcUsd ?? 0,
    satsToUsdAtBtcUsd: (sats, usd) => sats * usd / 100_000_000,
    errorSummary: (error) => error.message,
    payloadIndexedThroughBlockHash: (payload) => payload?.indexedThroughBlockHash ?? "",
    numericValue: (value) => Number(value) || 0,
    isValidBitcoinAddress: value => Boolean(value),
    boundedInteger: (value, fallback, min, max) => value === null ? fallback : Math.min(max, Math.max(min, Math.trunc(Number(value)) || fallback)),
    dateIso: (value, fallback) => new Date(value ?? fallback).toISOString(),
    normalizePowId: (value) => String(value).toLowerCase().replace(/@proofofwork\.me$/u, ""),
    compareCanonicalUtf8: (a, b) => Buffer.compare(Buffer.from(a), Buffer.from(b)),
    ...overrides,
  });
  vm.runInContext([definition("BOOST_EVENT_KINDS"), definition("canonicalNonNegativeIntegerText"), definition("workSubatomsValueAtNetworkQ8"), boostSource,
    "this.api = { boostCanonicalMarketTransaction, boostFeedPayload, boostOwnershipState, compareBoostFeedItems, boostProfileSignalStats, boostWorkSignalValue };"].join("\n"), context);
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

const identityCheckpoint = { network: "livenet", snapshotId: "fixture-snapshot", indexedThroughBlock: 965000, indexedThroughBlockHash: "a".repeat(64) };
const identityRegistry = (records) => ({ ...identityCheckpoint, records, stats: { total: records.length } });
const identityNormalizer = value => String(value).trim().toLowerCase().replace(/^@/u, "").replace(/@proofofwork\.me$/u, "");

test("Boost identity claims require exact current confirmed ownership without rewriting history", () => {
  const records = [{ id: "alice", ownerAddress: "Owner", confirmed: true }, { id: "pending", ownerAddress: "Owner", confirmed: false }];
  const raw = [event(1, "boost-post", { authorAddress: "Owner", profileId: "alice" }),
    event(2, "boost-profile", { authorAddress: "owner", profileId: "alice", profile: { id: "alice", profileId: "alice", name: "Alice" } }),
    event(3, "boost-post", { authorAddress: "Owner", authorId: "pending" }),
    event(4, "boost-follow", { authorAddress: "follower", targetAddress: "Owner", targetId: "alice" })];
  const original = JSON.stringify(raw);
  const result = projection.qualifyBoostIdentityClaims(raw, identityRegistry(records), identityCheckpoint, identityNormalizer);
  assert.equal(result.items[0].profileId, "alice");
  assert.equal(result.items[1].profileId, undefined);
  assert.equal(result.items[1].profile.id, undefined);
  assert.equal(result.items[2].authorId, undefined);
  assert.equal(result.items[3].targetId, "alice");
  assert.equal(JSON.stringify(raw), original);
  const transferred = projection.qualifyBoostIdentityClaims(raw, identityRegistry([{ ...records[0], ownerAddress: "NewOwner" }]), identityCheckpoint, identityNormalizer);
  assert.equal(transferred.items[0].profileId, undefined);
  assert.equal(transferred.items[0].authorAddress, "Owner");
});

test("Boost identity checkpoint and duplicate ownership failures are unavailable, never fabricated labels", () => {
  const registry = identityRegistry([{ id: "alice", ownerAddress: "owner", confirmed: true }]);
  assert.equal(projection.qualifyBoostIdentityClaims([], { ...registry, snapshotId: "independent-registry-scan" }, identityCheckpoint, identityNormalizer).registrySnapshotId, "independent-registry-scan");
  for (const malformed of [{ ...registry, snapshotId: "" }, { ...registry, indexedThroughBlockHash: "b".repeat(64) },
    { ...registry, collectionHasMore: { records: true } }, { ...registry, stats: { total: 2 } },
    identityRegistry([...registry.records, ...registry.records]), identityRegistry([{ ...registry.records[0], confirmed: undefined }])]) {
    assert.throws(() => projection.qualifyBoostIdentityClaims([], malformed, identityCheckpoint, identityNormalizer));
  }
});

test("profile routes resolve confirmed owners, not another user's display name or follow actor", async () => {
  const events = [event(1, "boost-post", { authorAddress: "alice-owner", profileId: "alice" }),
    event(2, "boost-profile", { authorAddress: "bob-owner", profileId: "bob", profile: { id: "bob", name: "alice@proofofwork.me" } }),
    event(3, "boost-follow", { authorAddress: "bob-owner", targetAddress: "alice-owner", targetId: "alice" }),
    event(4, "boost-post", { authorAddress: "bob-owner", profileId: "alice" })];
  const api = server(reader(events).read, { proofIndexRegistryPayload: async (_network, options) => {
    assert.equal(options.expectedHeight, identityCheckpoint.indexedThroughBlock);
    assert.equal(options.expectedHash, identityCheckpoint.indexedThroughBlockHash);
    return identityRegistry([{ id: "alice", ownerAddress: "alice-owner", confirmed: true }, { id: "bob", ownerAddress: "bob-owner", confirmed: true }]);
  } });
  const payload = await api.boostFeedPayload("livenet", new URLSearchParams({ profile: "alice" }));
  assert.deepEqual(Array.from(payload.items, item => item.txid), [txid(1)]);
  assert.ok(payload.provenance.applicationRejectedIdentityClaims.some(row => row.eventId === 4));
  assert.equal(payload.provenance.identityRegistry.confirmedOwnerCount, 2);
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
  const events = Array.from({ length: 101 }, (_, i) => event(i + 1, "boost-post", { workSignalSubatoms: "10000000000000000" }));
  const api = server(reader(events).read);
  const first = await api.boostFeedPayload("livenet", new URLSearchParams("limit=100"));
  await assert.rejects(api.boostFeedPayload("livenet", new URLSearchParams({ cursor: first.nextCursor, sort: "oldest" })), /changed/u);
  const changed = server(reader([...events, event(102)]).read);
  await assert.rejects(changed.boostFeedPayload("livenet", new URLSearchParams({ cursor: first.nextCursor })), /changed/u);
  const changedFloor = server(reader(events).read, { cachedWorkFloorPayload: async () => ({ networkValueQ8: "2100000000000001", snapshotId: "fixture-snapshot", indexedThroughBlock: 965000, indexedThroughBlockHash: "a".repeat(64) }) });
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

test("follow and unfollow retain independent target address and ID relations", async () => {
  const { proofIndexEventParticipantsForItem, proofIndexEventRefsForItem } = await import("../server/proof-index-event-relations.mjs");
  for (const kind of ["boost-follow", "boost-unfollow"]) {
    const item = { kind, authorAddress: "actor", targetAddress: "target", targetId: "target-id", recipients: [{ address: "registry", amountSats: "546" }] };
    assert.ok(proofIndexEventParticipantsForItem(item).some(row => row.address === "target" && row.role === "follow-target" && row.powid === "target-id"));
    assert.ok(proofIndexEventRefsForItem(item).some(row => row.refType === "powid" && row.refValue === "target-id"));
  }
});

test("direct ownership transfers reject outsiders, missing actors and unknown parents", () => {
  const api = server(reader([]).read);
  const original = event(1);
  const transfer = (id, sender, target = txid(1)) => event(id, "boost-transfer", {
    targetTxid: target, senderAddress: sender, authorAddress: undefined,
    currentOwnerAddress: "buyer",
  });
  for (const sender of ["outsider", "", "Owner"]) {
    const state = api.boostOwnershipState([original, transfer(2, sender)]);
    assert.equal(state.states.get(txid(1)).ownerAddress, "owner");
  }
  assert.equal(api.boostOwnershipState([original, transfer(2, "owner")]).states.get(txid(1)).ownerAddress, "buyer");
  assert.equal(api.boostOwnershipState([transfer(2, "owner", txid(99))]).states.get(txid(99)).ownerAddress, "");
});


test("Base58 address identity remains exact across graph, profile and ownership views", async () => {
  const owner = "1KNkUBREnfno2BeV7QsBf8XCWZN6YFfxPH";
  const impostor = owner.toLowerCase();
  const events = [event(1, "boost-post", { authorAddress: owner }),
    event(2, "boost-post", { authorAddress: impostor }),
    event(3, "boost-follow", { authorAddress: "viewer", targetAddress: owner }),
    event(4, "boost-unfollow", { authorAddress: "Viewer", targetAddress: owner }),
  ];
  const api = server(reader(events).read);
  const state = api.boostOwnershipState(events);
  assert.equal(state.followingByFollower.get("viewer").has(owner), true);
  assert.equal(state.followersByTarget.has(impostor), false);
  const page = await api.boostFeedPayload("livenet", new URLSearchParams("viewer=viewer&view=following"));
  assert.equal(page.items.find(item => item.txid === txid(1)).viewerFollowsAuthor, true);
  const profile = await api.boostFeedPayload("livenet", new URLSearchParams({ profile: owner }));
  assert.deepEqual(Array.from(profile.items, item => item.txid), [txid(1)]);
});

test("only the confirmed original author can hide an asset; tombstones preserve ownership and history", async () => {
  const original = event(1);
  for (const sender of ["outsider", "Owner", "buyer", ""]) {
    const events = [original, event(2, "boost-transfer", { targetTxid: txid(1), newOwnerAddress: "buyer" }),
      event(3, "boost-hide", { targetTxid: txid(1), authorAddress: sender })];
    const api = server(reader(events).read);
    assert.equal((await api.boostFeedPayload("livenet", new URLSearchParams())).totalCount, 1);
  }
  for (const confirmed of [true, false]) {
    const events = [original, event(2, "boost-hide", { targetTxid: txid(1), confirmed, status: confirmed ? "confirmed" : "pending" })];
    const api = server(reader(events).read);
    const page = await api.boostFeedPayload("livenet", new URLSearchParams("pending=1"));
    assert.equal(page.totalCount, confirmed ? 0 : 1);
    assert.equal(page.provenance.eventCount, 2);
    assert.equal(api.boostOwnershipState(events).states.get(txid(1)).ownerAddress, "owner");
  }
  const events = [event(1, "boost-reboost", { targetTxid: txid(99), authorAddress: "outsider" }),
    event(2, "boost-transfer", { targetTxid: txid(99), authorAddress: "outsider", newOwnerAddress: "thief" })];
  assert.equal(server(reader(events).read).boostOwnershipState(events).states.get(txid(99)).ownerAddress, "");
});


test("paid actions require the historical receiver and distinct exact output accounting", () => {
  const registration = event(1, "id-register", { id: "boost", receiveAddress: "registry", blockHeight: 964000 });
  const update = event(10, "id-update", { id: "boost", receiveAddress: "new-registry" });
  const action = (id, address, amount = "546") => event(id, "boost-like", { recipients: [{ address, amountSats: amount, vout: 0 }] });
  const qualified = projection.qualifyBoostPaidActions([
    action(2, "registry"), action(3, "Registry"), action(4, "outsider", "10000000"),
    action(11, "registry"), action(12, "new-registry"), action(13, "new-registry", "545"),
  ], [registration, update]);
  assert.deepEqual(qualified.accepted.map(item => item.eventId), [2, 12]);
  assert.equal(qualified.rejected.length, 4);
  const follow = event(5, "boost-follow", { targetAddress: "registry", recipients: [{ address: "registry", amountSats: "546", vout: 0 }] });
  assert.equal(projection.qualifyBoostPaidActions([follow], [registration]).accepted.length, 0);
  follow.recipients.push({ address: "registry", amountSats: "546", vout: 2 });
  assert.equal(projection.qualifyBoostPaidActions([follow], [registration]).accepted.length, 1);
  follow.recipients[1].vout = 0;
  assert.equal(projection.qualifyBoostPaidActions([follow], [registration]).accepted.length, 0);
  assert.equal(projection.qualifyBoostPaidActions([action(2, "registry")], []).accepted.length, 0);
  assert.throws(() => projection.qualifyBoostPaidActions([action(2, "registry")], [{ ...registration, blockIndex: undefined }]), /exact chain position/u);
});

test("listing mutations require the exact owner and preserve original ticket identity and price", () => {
  const api = server(reader([]).read);
  const original = event(1);
  const list = event(2, "boost-list", { targetTxid: txid(1), sellerAddress: "owner", priceSats: "1000" });
  for (const actor of ["outsider", "Owner", ""]) {
    const state = api.boostOwnershipState([original, { ...list, authorAddress: actor }]);
    assert.equal(state.states.get(txid(1)).listing, null);
  }
  for (const priceSats of ["1.1", "1e3", "9007199254740993", "2100000000000001", "0", "01"]) {
    assert.equal(api.boostOwnershipState([original, { ...list, priceSats }]).states.get(txid(1)).listing, null);
  }
  const seal = event(3, "boost-seal", { listingId: txid(2), targetTxid: txid(1), sellerAddress: "owner", priceSats: "1000" });
  assert.equal(api.boostOwnershipState([original, list, seal]).states.get(txid(1)).listing.listingTxid, txid(2));
  const delist = event(4, "boost-delist", { listingId: txid(2), targetTxid: txid(2) });
  assert.equal(api.boostOwnershipState([original, list, { ...delist, authorAddress: "outsider" }]).states.get(txid(1)).listing.listingTxid, txid(2));
  assert.equal(api.boostOwnershipState([original, list, delist], new Set(["4"])).states.get(txid(1)).listing, null);
});

test("purchases require Core-bound ticket spend, wire terms and separate exact consideration", async () => {
  const bitcoin = await import("bitcoinjs-lib");
  const seller = "1KNkUBREnfno2BeV7QsBf8XCWZN6YFfxPH";
  const buyer = "18xvbj6mpPpYYjWibcqsXdV7SCwBQNrqMW";
  const registry = "1MwPXzhsU5gknikrfWipBAnndruTNhGskU";
  const script = value => Buffer.from(bitcoin.address.toOutputScript(value)).toString("hex");
  const output = (value, amount) => ({ scriptpubkey: script(value), scriptpubkey_address: value, value: amount });
  const opReturn = text => ({ scriptpubkey: Buffer.from(bitcoin.script.compile([bitcoin.opcodes.OP_RETURN, Buffer.from(text)])).toString("hex"), value: 0 });
  const terms = { version: "pwb-sale-v1", anchorType: "sale-ticket-v1", anchorVout: 2, saleTicketVout: 2,
    anchorSigHashType: 0x83, anchorValueSats: 546, saleTicketValueSats: 546,
    anchorScriptPubKey: script(seller), boostTxid: txid(1), priceSats: 1000, sellerAddress: seller };
  const original = event(1, "boost-post", { authorAddress: seller });
  const list = event(2, "boost-list", { authorAddress: seller, senderAddress: seller,
    targetTxid: txid(1), sellerAddress: seller, priceSats: "1000" });
  const buy = event(3, "boost-buy", { listingId: txid(2), targetTxid: txid(2), buyerAddress: buyer,
    protocolVout: 2, applicationBoostRegistryReceiver: registry });
  const listTx = { vin: [{ prevout: output(seller, 10000) }], vout: [output(registry, 546),
    opReturn("pwb1:list5:" + Buffer.from(JSON.stringify(terms)).toString("base64url")), output(seller, 546)] };
  const buyTx = { status: { block_time: 1_800_000_000 }, vin: [
    { txid: txid(99), vout: 0, prevout: output(buyer, 10000) },
    { txid: txid(2), vout: 2, prevout: output(seller, 546) }],
    vout: [output(registry, 546), output(seller, 1546), opReturn(`pwb1:buy5:${txid(2)}:${buyer}`)] };
  const proof = async (changedList = listTx, changedBuy = buyTx, changedEvent = buy) => verifiedBoostTicketClosures(
    [original, list, changedEvent], async item => item.kind === "boost-list" ? changedList : changedBuy);
  const verified = await proof(); assert.equal(verified.has("3"), true);
  const api = server(reader([]).read);
  assert.equal(api.boostOwnershipState([original, list, buy]).states.get(txid(1)).ownerAddress, seller);
  assert.equal(api.boostOwnershipState([original, list, buy], verified).states.get(txid(1)).ownerAddress, buyer);
  for (const mutate of [
    tx => { tx.vin[1].txid = txid(88); },
    tx => { tx.vin[1].prevout.value = 545; },
    tx => { tx.vout[1].value = 1545; },
    tx => { tx.vout[0].value = 545; },
    tx => { tx.vout[2] = opReturn(`pwb1:buy5:${txid(2)}:${seller}`); },
  ]) {
    const changed = structuredClone(buyTx); mutate(changed);
    assert.equal((await proof(listTx, changed)).size, 0);
  }
  const forgedList = structuredClone(listTx); forgedList.vout[2] = output(buyer, 546);
  assert.equal((await proof(forgedList)).size, 0);
  assert.equal((await proof(listTx, buyTx, { ...buy, confirmed: false })).size, 0);
  await assert.rejects(verifiedBoostTicketClosures([list, buy], async () => null), /unavailable/u);
  const delist = event(4, "boost-delist", { listingId: txid(2), targetTxid: txid(2), senderAddress: seller,
    authorAddress: seller, applicationBoostRegistryReceiver: registry });
  const delistTx = { vin: [{ txid: txid(2), vout: 2, prevout: output(seller, 546) }],
    vout: [output(registry, 546), opReturn(`pwb1:delist5:${txid(2)}`)] };
  const verifiedDelist = await verifiedBoostTicketClosures([list, delist], async item => item.kind === "boost-list" ? listTx : delistTx);
  assert.equal(verifiedDelist.has("4"), true);
  assert.equal(api.boostOwnershipState([original, list, delist], verifiedDelist).states.get(txid(1)).listing, null);
  delistTx.vin[0].txid = txid(99);
  assert.equal((await verifiedBoostTicketClosures([list, delist], async item => item.kind === "boost-list" ? listTx : delistTx)).size, 0);

});


test("market Core adapter fences block hash, height, transaction position and raw-byte hydration", async () => {
  const item = event(2, "boost-list", { blockHash: "a".repeat(64) });
  const tx = { txid: item.txid, status: { confirmed: true, block_hash: item.blockHash } };
  const block = { hash: item.blockHash, height: item.blockHeight, tx: [txid(99), txid(98), item.txid] };
  const apiFor = (change = {}) => {
    let hashes = 0;
    return server(reader([]).read, {
      bitcoinRpc: async (method) => method === "getblockhash"
        ? { ok: true, result: ++hashes === 2 && change.reorg ? "b".repeat(64) : item.blockHash }
        : { ok: true, result: { ...block, ...change.block } },
      fetchTransactionFromBitcoinRpc: async (id, network, options) => {
        assert.equal(options.includeRawHex, true); assert.equal(options.requireCanonicalPrevouts, true);
        assert.equal(options.bypassCache, true); assert.equal(options.cacheResult, false);
        return { ...tx, ...change.tx };
      },
    });
  };
  assert.equal((await apiFor().boostCanonicalMarketTransaction("livenet", item)).txid, item.txid);
  for (const change of [{ reorg: true }, { block: { height: 1 } }, { block: { tx: [] } }, { tx: { status: { confirmed: false } } }]) {
    await assert.rejects(apiFor(change).boostCanonicalMarketTransaction("livenet", item), /could not bind/u);
  }
  await assert.rejects(apiFor().boostCanonicalMarketTransaction("livenet", { ...item, blockIndex: undefined }), /exact confirmed position/u);
});


test("invalid direct-transfer destinations do not clear a valid owner or listing", () => {
  const api = server(reader([]).read, { isValidBitcoinAddress: () => false });
  const items = [event(1), event(2, "boost-list", { targetTxid: txid(1), sellerAddress: "owner", priceSats: "1000" }),
    event(3, "boost-transfer", { targetTxid: txid(1), newOwnerAddress: "not-an-address" })];
  const state = api.boostOwnershipState(items).states.get(txid(1));
  assert.equal(state.ownerAddress, "owner");
  assert.equal(state.listing.listingTxid, txid(2));
});


test("saved legacy profile intents preserve exact embedded address ownership", async () => {
  const encoding = await importTs("../src/shared/utils/encoding.ts", { '"bitcoinjs-lib"': JSON.stringify(import.meta.resolve("bitcoinjs-lib")), '"buffer"': '"node:buffer"' });
  const mod = await import(await importTs("../src/features/boost/boostProtocol.ts", { '"../../shared/utils/encoding"': JSON.stringify(encoding) }));
  const owner = "1KNkUBREnfno2BeV7QsBf8XCWZN6YFfxPH";
  const intent = { address: owner, network: "livenet", id: "owner", signature: "fixture" };
  const originalWindow = globalThis.window;
  try {
    globalThis.window = { localStorage: { getItem: () => JSON.stringify({ [`livenet:${owner.toLowerCase()}`]: intent }) } };
    assert.equal(mod.loadBoostIdentityIntent(owner, "livenet").address, owner);
    assert.equal(mod.loadBoostIdentityIntent(owner.toLowerCase(), "livenet"), undefined);
    assert.equal(mod.loadBoostIdentityIntent(owner, "testnet"), undefined);
    assert.equal(mod.idsOwnedByAddress([{ id: "owner", ownerAddress: owner, confirmed: true }], owner.toLowerCase(), "livenet").length, 0);
  } finally {
    if (originalWindow === undefined) delete globalThis.window;
    else globalThis.window = originalWindow;
  }
});


test("proof-only Boost reads do not start an unused WORK valuation query", async () => {
  const api = server(reader([event(1)]).read, {
    cachedWorkFloorPayload: async () => assert.fail("unused WORK valuation must not run"),
  });
  const page = await api.boostFeedPayload("livenet", new URLSearchParams());
  assert.equal(page.totalCount, 1);
  assert.equal(page.valuationProvenance.used, false);
  assert.equal(page.signalStats.totalSignalQ8, "54600000000");
});
