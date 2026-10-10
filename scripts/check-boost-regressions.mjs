import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import vm from "node:vm";
import ts from "typescript";
import * as projection from "../server/boost-projection.mjs";
import { verifiedBoostTicketClosures } from "../server/boost-marketplace-proof.mjs";
import { decimalValueToQ8, formatWorkSubatoms, q8ToCanonicalDecimal, q8ToNumber, WORK_SUBATOM_UNIT_SCALE } from "../server/work-units.mjs";
import { parseBoostText, parsePowDnsText, boostTextMatchesTag } from "../src/shared/protocol/boostText.mjs";

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
  const context = vm.createContext({ console, URLSearchParams, ...projection, verifiedBoostTicketClosures, boostTextMatchesTag,
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

test("Boost text links retain source text, all tag symbols and case-insensitive PowIDs", () => {
  const text = "($wOrK), #WORK #東京 #café #credit_2 $NEW123 @ArmyOfYouth armyofyouth@ProofOfWork.Me! @hello.name @hello-world @alice+label @☕";
  const parsed = parseBoostText(text);
  assert.equal(parsed.map(segment => segment.text).join(""), text);
  assert.deepEqual(parsed.filter(segment => segment.kind !== "text").map(segment => [segment.kind, segment.value]), [
    ["cashtag", "$work"], ["hashtag", "#work"], ["hashtag", "#東京"], ["hashtag", "#café"],
    ["hashtag", "#credit_2"], ["cashtag", "$new123"], ["mention", "armyofyouth"], ["mention", "armyofyouth"],
    ["mention", "hello.name"], ["mention", "hello-world"], ["mention", "alice+label"], ["mention", "☕"],
  ]);
  assert.equal(boostTextMatchesTag("$WORK #workshop", "$work"), true);
  assert.equal(boostTextMatchesTag("$WORK #workshop", "#work"), false);
  assert.equal(boostTextMatchesTag("$WORKER #WORK", "$work"), false);
  assert.equal(boostTextMatchesTag("$WORKER #WORK", "#work"), true);
  assert.equal(boostTextMatchesTag("#café", "#CAFÉ"), true);
});

test("Boost token parsing excludes partial URLs, foreign emails and digit-only cash amounts", () => {
  const text = 'https://example.com/$WORK/#work/@armyofyouth www.example.com/#work example.com/$WORK name@example.com work@proofofwork.me.evil "space name"@example.com "space name"@proofofwork.me.evil $100 $12.50 a$WORK a#work a@armyofyouth ##work';
  assert.deepEqual(parseBoostText(text), [{ kind: "text", text, value: text }]);
  assert.equal(boostTextMatchesTag(text, "$work"), false);
  assert.equal(boostTextMatchesTag(text, "#work"), false);
  assert.equal(parseBoostText('https://example.com/@"armyofyouth"').filter(segment => segment.kind !== "text").length, 0);
  assert.deepEqual(parseBoostText(""), []);
});

test("bare .pow roots and one-level children preserve source bytes and use lowercase Browser targets", () => {
  // The reported Boost transaction contains the bare name armyofyouth.pow.
  const label = "a".repeat(63);
  const text = `Visit (armyofyouth.pow), App.ArmyOfYouth.POW! a.pow; ${label}.pow. see: armyofyouth.pow: ; www.armyofyouth.pow WWW.ArmyOfYouth.POW café 🧭  \n`;
  for (const parse of [parseBoostText, parsePowDnsText]) {
    const parsed = parse(text);
    const restored = parsed.map(segment => segment.text).join("");
    assert.equal(restored, text);
    assert.equal(createHash("sha256").update(restored).digest("hex"), createHash("sha256").update(text).digest("hex"));
    assert.deepEqual(parsed.filter(segment => segment.kind === "dns").map(segment => [segment.text, segment.value]), [
      ["armyofyouth.pow", "armyofyouth.pow"], ["App.ArmyOfYouth.POW", "app.armyofyouth.pow"],
      ["a.pow", "a.pow"], [`${label}.pow`, `${label}.pow`], ["armyofyouth.pow", "armyofyouth.pow"],
      ["www.armyofyouth.pow", "www.armyofyouth.pow"], ["WWW.ArmyOfYouth.POW", "www.armyofyouth.pow"],
    ]);
  }
  assert.deepEqual(parsePowDnsText(""), []);
});

test("DNS links do not extract partial names from URLs, emails, mentions or invalid labels", () => {
  const invalid = [
    "https://armyofyouth.pow", "https://www.armyofyouth.pow/path", "www.example.com/path/armyofyouth.pow", "armyofyouth.pow/path", "armyofyouth.pow?q=1", "armyofyouth.pow#section",
    "person@armyofyouth.pow", "armyofyouth.pow@example.com", '"space name"@armyofyouth.pow',
    "@armyofyouth.pow", '@"armyofyouth.pow"', '"armyofyouth.pow"@proofofwork.me', "$armyofyouth.pow", "#armyofyouth.pow",
    "deep.app.armyofyouth.pow", "app..armyofyouth.pow", "armyofyouth.pow.evil", "armyofyouth.powders", ".armyofyouth.pow",
    "-armyofyouth.pow", "armyofyouth-.pow", "armyofyouth.pow-", "army_of_youth.pow", "名armyofyouth.pow", "armyofyouth.pow名", "ſite.pow",
    `${"a".repeat(64)}.pow`, `${"a".repeat(64)}.armyofyouth.pow`, "armyofyouth.pow:443", "folder/armyofyouth.pow",
    "see:armyofyouth.pow", "fake:alice.pow", "armyofyouth.pow:word",
  ];
  for (const text of invalid) {
    for (const parse of [parseBoostText, parsePowDnsText]) {
      const parsed = parse(text);
      assert.equal(parsed.map(segment => segment.text).join(""), text);
      assert.equal(parsed.filter(segment => segment.kind === "dns").length, 0, text);
    }
  }
});

test("DNS-only projection handles a maximum-size mixed article without altering any source bytes", () => {
  const unit = "armyofyouth.pow https://example.com/hidden.pow person@email.pow `inline.pow` #proof @alice\n";
  const text = unit.repeat(Math.ceil(100_000 / unit.length)).slice(0, 100_000);
  const parsed = parsePowDnsText(text);
  assert.equal(Buffer.byteLength(text), 100_000);
  assert.equal(parsed.map(segment => segment.text).join(""), text);
  assert.ok(parsed.filter(segment => segment.kind === "dns").length > 1_000);
  assert.ok(parsed.filter(segment => segment.kind === "dns").every(segment => segment.value === "armyofyouth.pow"));
  const unbroken = `${"x".repeat(99_984)} armyofyouth.pow`;
  assert.equal(Buffer.byteLength(unbroken), 100_000);
  assert.deepEqual(parsePowDnsText(unbroken).filter(segment => segment.kind === "dns").map(segment => segment.value), ["armyofyouth.pow"]);
});

test("DNS-only article projection leaves tags and mentions literal and excludes code regions", () => {
  const text = "$WORK #proof @alice armyofyouth.pow\n`inline.pow` ``code ` nested.pow``\n```text\nfenced.pow\n```\n~~~\ntilde.pow\n~~~\nApp.ArmyOfYouth.POW.  \n";
  const parsed = parsePowDnsText(text);
  assert.equal(parsed.map(segment => segment.text).join(""), text);
  assert.deepEqual(parsed.filter(segment => segment.kind !== "text").map(segment => [segment.kind, segment.value]), [
    ["dns", "armyofyouth.pow"], ["dns", "app.armyofyouth.pow"],
  ]);
  for (const text of ["`unfinished.pow", "```\nunfinished.pow", "~~~\nunfinished.pow", "``code.pow``"]) {
    assert.equal(parsePowDnsText(text).filter(segment => segment.kind === "dns").length, 0, text);
  }
  assert.equal(boostTextMatchesTag("armyofyouth.pow $WORK", "$work"), true);
  assert.equal(boostTextMatchesTag("armyofyouth.pow", "$work"), false);
  assert.equal(boostTextMatchesTag("`$WORK` armyofyouth.pow", "$work"), true, "existing tag search semantics are unchanged");
});

test("quoted Boost mentions support arbitrary ID delimiters, whitespace and JSON escapes", () => {
  const ids = ["Space Name", "a/b & c!?", "double\"quote\\backslash", "name\nwith\ttabs", "#tag $cash https://example.com @foreign", "colon:name"];
  for (const id of ids) {
    for (const text of [`@${JSON.stringify(id)}!`, `${JSON.stringify(id)}@proofofwork.me.`]) {
      const parsed = parseBoostText(text);
      assert.equal(parsed.map(segment => segment.text).join(""), text);
      const mentions = parsed.filter(segment => segment.kind === "mention");
      assert.equal(mentions.length, 1, text);
      assert.equal(mentions[0].identityKind, "id");
      assert.equal(mentions[0].value, identityNormalizer(id));
    }
  }
});

test("Boost address mentions preserve Base58 case and canonicalize unmixed Bech32", () => {
  const base58 = "1BoatSLRHtKNngkdXEeobR76b53LETtpyT";
  const bech32 = "bc1qfwytlzyr3ym3enz2eutwtjsf9kkf6uqkjydk3e";
  const parsed = parseBoostText(`@${base58} @${bech32.toUpperCase()}`).filter(segment => segment.kind === "mention");
  assert.deepEqual(parsed.map(segment => [segment.identityKind, segment.value]), [["address", base58], ["address", bech32]]);
  const mixed = `bC${bech32.slice(2)}`;
  assert.equal(parseBoostText(`@${mixed}`)[0].identityKind, "address");
  assert.equal(parseBoostText(`@${mixed}`)[0].value, mixed, "invalid mixed-case address cannot silently target lowercase Bech32");
  const quotedId = parseBoostText(`@${JSON.stringify(base58)}`)[0];
  assert.equal(quotedId.identityKind, "id");
  assert.equal(quotedId.value, base58.toLowerCase(), "explicit quoted syntax denotes a case-insensitive PowID");
});

test("emoji and adjacent complete tags delimit Boost tag links without creating word fragments", () => {
  const text = "🚀$work🔥 #work🎉 $POWB$INCB #build#proof a$WORK a#work";
  assert.deepEqual(parseBoostText(text).filter(segment => segment.kind !== "text").map(segment => segment.value),
    ["$work", "#work", "$powb", "$incb", "#build", "#proof"]);
});

test("tag search matches full visible tokens across complete history, replies and reboost originals", async () => {
  const events = [
    event(1, "boost-post", { text: "work #WORKSHOP $WORKER" }),
    event(2, "boost-post", { text: "$wOrK #東京" }),
    event(3, "boost-post", { text: "#WORK $USD" }),
    event(4, "boost-post", { text: "https://example.com/$WORK #work@example.com" }),
    event(5, "boost-reply", { targetTxid: txid(2), text: "$work!" }),
    event(6, "boost-reboost", { targetTxid: txid(2), text: `reboost ${txid(2)}` }),
    event(7, "boost-post", { text: "$100 $12.50" }),
    event(8, "boost-post", { text: "$WORK hidden" }),
    event(9, "boost-post", { text: "other", title: "$WORK" }),
    event(10, "boost-post", { text: "$WORK", confirmed: false, status: "pending" }),
    event(11, "boost-post", { text: "$WORK", valid: false }),
    event(12, "boost-hide", { targetTxid: txid(8) }),
    ...Array.from({ length: 240 }, (_, index) => event(13 + index, "boost-post", { text: index === 225 ? "older $WORK" : `unrelated ${index}` })),
    event(253, "boost-post", { text: "quoting another post", quoteTxid: txid(3) }),
    event(254, "boost-post", { text: undefined, memo: "visible legacy #tag" }),
    event(255, "boost-reboost", { text: "$phantom metadata", targetTxid: txid(1) }),
  ];
  const api = server(reader(events).read);
  const search = async query => api.boostFeedPayload("livenet", new URLSearchParams({ q: query, sort: "oldest" }));
  const cash = await search("$work");
  assert.equal(cash.provenance.pages, 2);
  assert.deepEqual(Array.from(cash.items, item => item.txid), [txid(2), txid(5), txid(6), txid(238)]);
  assert.deepEqual(Array.from((await search("#work")).items, item => item.txid), [txid(3), txid(253)]);
  assert.deepEqual(Array.from((await search("#東京")).items, item => item.txid), [txid(2), txid(6)]);
  assert.equal((await search("$100")).totalCount, 1, "numeric cash text keeps ordinary search behavior without tag links");
  assert.deepEqual(Array.from((await search("$work #東京")).items, item => item.txid), [txid(2), txid(6)], "compound query keeps ordinary literal substring semantics");
  assert.equal((await search("#work $usd")).items[0].txid, txid(3));
  assert.equal((await search("#tag")).items[0].txid, txid(254), "legacy displayed body fallback uses the same tag rules");
  assert.equal((await search("$phantom")).totalCount, 0, "reboost metadata is not visible post text");
  assert.ok((await search("work")).items.some(item => item.txid === txid(9)), "ordinary text/metadata lookup stays compatible");
});

test("profile preview resolution requires a current confirmed owner or a valid network address", async () => {
  const base58 = "1BoatSLRHtKNngkdXEeobR76b53LETtpyT";
  const testnet = "mipcBbFg9gMiCh81Kj8tqqdgoZub1ZJRfn";
  const bech32 = "bc1qfwytlzyr3ym3enz2eutwtjsf9kkf6uqkjydk3e";
  const events = [event(1, "boost-post", { authorAddress: "old-owner", profileId: "transferred" }),
    event(2, "boost-profile", { authorAddress: "old-owner", profile: { name: "unregistered@proofofwork.me" } })];
  const api = server(reader(events).read, {
    isValidBitcoinAddress: (value, network) => (network === "livenet" && [base58, bech32].includes(value)) || (network === "testnet" && value === testnet),
    proofIndexRegistryPayload: async () => identityRegistry([
      { id: "transferred", ownerAddress: "new-owner", confirmed: true },
      { id: "pending", ownerAddress: "old-owner", confirmed: false },
      { id: "space name", ownerAddress: "quoted-owner", confirmed: true },
      { id: base58, ownerAddress: "named-address-owner", confirmed: true },
    ]),
  });
  const profile = async value => (await api.boostFeedPayload("livenet", new URLSearchParams({ profile: value }))).profileSubject;
  const transferred = await profile("TRANSFERRED@proofofwork.me");
  assert.equal(transferred.resolved, true);
  assert.equal(transferred.address, "new-owner");
  assert.equal((await profile("space name")).resolved, true);
  for (const value of ["unregistered", "pending", "old-owner", `${base58.slice(0, -1)}x`, testnet, `bC${bech32.slice(2)}`]) {
    assert.equal((await profile(value)).resolved, false, value);
  }
  assert.equal((await profile(base58)).resolved, true);
  assert.equal((await profile(base58)).address, base58);
  const namedAddress = await profile(`${base58}@proofofwork.me`);
  assert.equal(namedAddress.resolved, true);
  assert.equal(namedAddress.address, "named-address-owner", "explicit full-ID lookup resolves its registry owner instead of the raw address");
  const connections = await api.boostFeedPayload("livenet", new URLSearchParams({ profile: "transferred", connections: "followers" }));
  assert.equal(connections.profileSubject.resolved, true);
});

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
  assert.equal(first.signalStats.totalSignalQ8, ((125n + 120n) * 546n * 100_000_000n).toString());
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

test("reboost projection carries the canonical original post for retweet-style rendering", async () => {
  const original = event(1, "boost-post", {
    authorAddress: "original-author",
    text: "the original post survives the reboost",
    media: { mime: "image/jpeg", name: "original.jpg", sha256: "a".repeat(64), size: 1234,
      source: "same-tx-pwm1-attachment" },
  });
  const reboost = event(2, "boost-reboost", {
    authorAddress: "rebooster",
    targetTxid: original.txid,
    text: `reboost ${original.txid}`,
  });
  const payload = await server(reader([original, reboost]).read).boostFeedPayload(
    "livenet",
    new URLSearchParams("sort=oldest"),
  );
  const item = payload.items.find((candidate) => candidate.txid === reboost.txid);
  assert.ok(item);
  assert.equal(item.kind, "boost-reboost");
  assert.equal(item.text, "");
  assert.equal(item.targetTxid, original.txid);
  assert.equal(item.reboostedPost?.txid, original.txid);
  assert.equal(item.reboostedPost?.authorAddress, original.authorAddress);
  assert.equal(item.reboostedPost?.text, original.text);
  assert.equal(item.reboostedPost?.media?.name, "original.jpg");
  assert.equal(item.reboostedPost?.media?.source, "same-tx-pwm1-attachment");
  assert.equal(item.reboostCount, 1);
});

test("new social actions qualify against the confirmed current owner without a registry fee", () => {
  const registration = event(900001, "id-register", {
    id: "boost",
    receiveAddress: "registry",
    blockHeight: 964000,
  });
  const original = event(1, "boost-post", { authorAddress: "owner" });
  const transfer = event(2, "boost-transfer", {
    authorAddress: "owner",
    senderAddress: "owner",
    targetTxid: original.txid,
    newOwnerAddress: "buyer",
  });
  const like = event(3, "boost-like", {
    authorAddress: "actor",
    targetTxid: original.txid,
    recipients: [{ address: "buyer", vout: 0, amountSats: "546" }],
  });
  const follow = event(4, "boost-follow", {
    authorAddress: "actor",
    targetAddress: "buyer",
    recipients: [{ address: "buyer", vout: 0, amountSats: "546" }],
  });
  const owners = new Map([[String(like.eventId), "buyer"]]);
  const qualified = projection.qualifyBoostPaidActions(
    [transfer, like, follow],
    [registration],
    owners,
  );
  assert.deepEqual(qualified.rejected, []);
  const qualifiedLike = qualified.accepted.find((item) => item.txid === like.txid);
  assert.equal(qualifiedLike.applicationBoostOwnerReceiver, "buyer");
  assert.equal(qualifiedLike.applicationBoostOwnerPaymentSats, "546");
  assert.equal(qualifiedLike.applicationBoostRegistryReceiver, undefined);
  assert.equal(qualified.accepted.find((item) => item.txid === follow.txid).applicationBoostOwnerReceiver, "buyer");
});

test("social signal follows the original Boost across an ownership transfer", async () => {
  const original = event(1, "boost-post", { authorAddress: "first-owner" });
  const reboost = event(2, "boost-reboost", {
    authorAddress: "actor",
    targetTxid: original.txid,
    recipients: [{ address: "first-owner", vout: 0, amountSats: "546" }],
  });
  const transfer = event(3, "boost-transfer", {
    authorAddress: "first-owner",
    senderAddress: "first-owner",
    targetTxid: original.txid,
    newOwnerAddress: "current-owner",
  });
  const like = event(4, "boost-like", {
    authorAddress: "actor",
    targetTxid: original.txid,
    recipients: [{ address: "current-owner", vout: 0, amountSats: "546" }],
  });
  const payload = await server(reader([original, reboost, transfer, like]).read)
    .boostFeedPayload("livenet", new URLSearchParams({ sort: "oldest" }));
  const originalItem = payload.items.find((item) => item.txid === original.txid);
  const reboostItem = payload.items.find((item) => item.txid === reboost.txid);
  assert.ok(reboostItem);
  assert.equal(originalItem.currentOwnerAddress, "current-owner");
  assert.equal(originalItem.likeCount, 1);
  assert.equal(originalItem.proofSignalSatsExact, "1638");
  assert.equal(reboostItem.signalIncrementSatsExact, "546");
  assert.equal(reboostItem.reboostedPost.proofSignalSatsExact, "1638");
});

test("confirmed ownership routes engagement, quote rendering, and viewer action state", async () => {
  const quoted = event(1, "boost-post", {
    authorAddress: "quoted-author",
    text: "quoted proof-backed thought",
  });
  const original = event(2, "boost-post", {
    authorAddress: "owner",
    quoteTxid: quoted.txid,
    text: "my quoted Boost",
  });
  const transfer = event(3, "boost-transfer", {
    authorAddress: "owner",
    senderAddress: "owner",
    targetTxid: original.txid,
    newOwnerAddress: "buyer",
  });
  const like = event(4, "boost-like", {
    authorAddress: "viewer",
    proofSignalSats: 0,
    targetTxid: original.txid,
    recipients: [{ address: "buyer", vout: 0, amountSats: "546" }],
  });
  const reboost = event(5, "boost-reboost", {
    authorAddress: "viewer",
    proofSignalSats: 0,
    targetTxid: original.txid,
    recipients: [{ address: "buyer", vout: 0, amountSats: "546" }],
  });
  const reply = event(6, "boost-reply", {
    authorAddress: "viewer",
    proofSignalSats: 0,
    targetTxid: original.txid,
    recipients: [{ address: "buyer", vout: 0, amountSats: "800" }],
    text: "A proof-backed reply",
  });
  const payload = await server(reader([quoted, original, transfer, like, reboost, reply]).read)
    .boostFeedPayload("livenet", new URLSearchParams({ sort: "oldest", viewer: "viewer" }));
  const item = payload.items.find((candidate) => candidate.txid === original.txid);
  assert.ok(item);
  assert.equal(item.currentOwnerAddress, "buyer");
  assert.equal(item.likeCount, 1);
  assert.equal(item.reboostCount, 1);
  assert.equal(item.viewerLiked, true);
  assert.equal(item.viewerReboosted, true);
  assert.equal(item.quotedPost?.txid, quoted.txid);
  assert.equal(item.quotedPost?.text, quoted.text);
  assert.equal(item.proofSignalSatsExact, "2438");
  assert.equal(item.proofSignalQ8, "243800000000");
  const reboostItem = payload.items.find((candidate) => candidate.txid === reboost.txid);
  assert.equal(reboostItem.signalIncrementSatsExact, "546");
  assert.equal(reboostItem.reboostedPost.proofSignalSatsExact, "2438");
  const replyItem = payload.items.find((candidate) => candidate.txid === reply.txid);
  assert.equal(replyItem.signalIncrementSatsExact, "800");
  assert.equal(payload.signalStats.proofSignalSatsExact, "2984");
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

test("WORK-only originals preserve zero Proof and exact WORK value in the read model", async () => {
  const workOnly = event(1, "boost-post", {
    proofSignalSats: 0,
    recipients: [],
    workSignalSubatoms: "10000000000000000",
    workSignalVerification: "canonical-same-tx-work-self-transfer-v1",
  });
  const page = await server(reader([workOnly]).read).boostFeedPayload("livenet", new URLSearchParams());
  assert.equal(page.items.length, 1);
  assert.equal(page.items[0].proofSignalQ8, "0");
  assert.equal(page.items[0].workSignalSubatoms, "10000000000000000");
  assert.equal(page.items[0].workSignalValueQ8, "100000000");
  assert.equal(page.items[0].totalSignalQ8, "100000000");
  assert.equal(page.signalStats.proofSignalQ8, "0");
  assert.equal(page.signalStats.totalSignalQ8, "100000000");
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

test("Following includes the viewer's own boosts and never creates a self-follow edge", async () => {
  const own = event(1, "boost-post", { authorAddress: "viewer" });
  const followed = event(2, "boost-post", { authorAddress: "friend" });
  const stranger = event(3, "boost-post", { authorAddress: "stranger" });
  const follow = event(4, "boost-follow", { authorAddress: "viewer", targetAddress: "friend" });
  const selfFollow = event(5, "boost-follow", { authorAddress: "viewer", targetAddress: "viewer" });
  const events = [own, followed, stranger, follow, selfFollow];
  const graph = server(reader(events).read).boostOwnershipState(events);
  assert.equal(graph.followingByFollower.get("viewer")?.has("viewer"), false);
  assert.equal(graph.followersByTarget.has("viewer"), false);
  const page = await server(reader(events).read).boostFeedPayload(
    "livenet", new URLSearchParams("viewer=viewer&view=following&sort=oldest"),
  );
  assert.deepEqual(Array.from(page.items, item => item.txid), [own.txid, followed.txid]);
  assert.equal(page.graph.followingCount, 1);
  assert.ok(page.provenance.applicationRejectedEvents.some(
    row => row.txid === selfFollow.txid && row.reason === "boost-self-follow",
  ));
  const selfUnfollow = event(6, "boost-unfollow", { authorAddress: "viewer", targetAddress: "viewer" });
  const qualified = projection.qualifyBoostPaidActions([selfFollow, selfUnfollow], [
    event(900001, "id-register", { id: "boost", receiveAddress: "registry", blockHeight: 964000 }),
  ]);
  assert.deepEqual(qualified.rejected.map(row => row.reason), ["boost-self-follow", "boost-self-follow"]);
});

test("Bech32 case aliases retain own boosts in Following and profile views", async () => {
  const owner = "bc1qqyqszqgpqyqszqgpqyqszqgpqyqszqgpyfl4f3";
  const ownerAlias = owner.toUpperCase();
  const own = event(1, "boost-post", {
    authorAddress: owner,
    recipients: [{ address: ownerAlias, amountSats: "546", vout: 0 }],
  });
  const api = server(reader([own]).read);
  const following = await api.boostFeedPayload(
    "livenet", new URLSearchParams({ viewer: ownerAlias, view: "following" }),
  );
  assert.deepEqual(Array.from(following.items, item => item.txid), [own.txid]);
  const profile = await api.boostFeedPayload(
    "livenet", new URLSearchParams({ profile: ownerAlias }),
  );
  assert.deepEqual(Array.from(profile.items, item => item.txid), [own.txid]);
});

test("Bech32 case aliases cannot follow themselves and still credit the real target", () => {
  const owner = "bc1qqyqszqgpqyqszqgpqyqszqgpqyqszqgpyfl4f3";
  const ownerAlias = owner.toUpperCase();
  const base58 = "1KNkUBREnfno2BeV7QsBf8XCWZN6YFfxPH";
  assert.equal(projection.boostAddressIdentityKey(ownerAlias), owner);
  assert.equal(projection.boostAddressIdentityKey(owner), owner);
  assert.notEqual(projection.boostAddressIdentityKey(base58), projection.boostAddressIdentityKey(base58.toLowerCase()));

  const registry = event(900001, "id-register", {
    id: "boost", receiveAddress: "registry", blockHeight: 964000,
  });
  const selfFollow = event(1, "boost-follow", {
    authorAddress: owner,
    targetAddress: ownerAlias,
    recipients: [{ address: owner, amountSats: "546", vout: 0 }],
  });
  const selfUnfollow = event(2, "boost-unfollow", {
    authorAddress: ownerAlias,
    targetAddress: owner,
    recipients: [{ address: owner, amountSats: "546", vout: 0 }],
  });
  const acceptedFollow = event(3, "boost-follow", {
    authorAddress: base58,
    targetAddress: ownerAlias,
    recipients: [{ address: owner, amountSats: "546", vout: 0 }],
  });
  const qualified = projection.qualifyBoostPaidActions(
    [selfFollow, selfUnfollow, acceptedFollow], [registry],
  );
  assert.deepEqual(qualified.rejected.map(row => row.reason),
    ["boost-self-follow", "boost-self-follow"]);
  assert.deepEqual(qualified.accepted.map(row => row.txid), [acceptedFollow.txid]);
  assert.equal(qualified.accepted[0].applicationBoostOwnerReceiver, ownerAlias);
  assert.equal(qualified.accepted[0].applicationBoostOwnerPaymentSats, "546");
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
  const follow = event(5, "boost-follow", { targetAddress: "target", recipients: [{ address: "registry", amountSats: "546", vout: 0 }] });
  assert.equal(projection.qualifyBoostPaidActions([follow], [registration]).accepted.length, 0);
  follow.recipients.push({ address: "target", amountSats: "546", vout: 2 });
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
  const numeric = await importTs("../src/features/boost/boostNumeric.ts");
  const mod = await import(await importTs("../src/features/boost/boostProtocol.ts", {
    '"../../shared/utils/encoding"': JSON.stringify(encoding),
    '"./boostNumeric"': JSON.stringify(numeric),
  }));
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

test("Boost composers encode quote posts and direct owner transfers", async () => {
  const encoding = await importTs("../src/shared/utils/encoding.ts", { '"bitcoinjs-lib"': JSON.stringify(import.meta.resolve("bitcoinjs-lib")), '"buffer"': '"node:buffer"' });
  const numeric = await importTs("../src/features/boost/boostNumeric.ts");
  const mod = await import(await importTs("../src/features/boost/boostProtocol.ts", {
    '"../../shared/utils/encoding"': JSON.stringify(encoding),
    '"./boostNumeric"': JSON.stringify(numeric),
  }));
  const quotedTxid = "a".repeat(64);
  const postPayload = mod.buildBoostPostPayload({ message: "quoted proof", proofSignalSats: 546, quoteTxid: quotedTxid });
  const decoded = JSON.parse(Buffer.from(postPayload.slice("pwb1:post:".length), "base64url").toString("utf8"));
  assert.deepEqual(decoded, { v: 1, text: "quoted proof", proofSignalSats: 546, quoteTxid: quotedTxid });
  const workOnly = mod.buildBoostPostPayload({
    message: "WORK-only proof", proofSignalSats: 0,
    workSignalSubatoms: "10000000000000000",
  });
  assert.deepEqual(JSON.parse(Buffer.from(workOnly.slice("pwb1:post:".length), "base64url").toString("utf8")), {
    v: 1, text: "WORK-only proof", workSignalSubatoms: "10000000000000000",
  });
  const attachment = { mime: "text/plain", name: "proof.txt", sha256: "b".repeat(64), size: 5 };
  const mediaPayload = mod.buildBoostPostPayload({
    attachment,
    message: "",
    proofSignalSats: 1,
    workSignalSubatoms: "10000000000000000",
  });
  assert.deepEqual(JSON.parse(Buffer.from(mediaPayload.slice("pwb1:post:".length), "base64url").toString("utf8")), {
    v: 1,
    text: "",
    media: { ...attachment, source: "same-tx-pwm1-attachment" },
    proofSignalSats: 1,
    workSignalSubatoms: "10000000000000000",
  });
  assert.equal(mod.buildBoostTransferPayload(quotedTxid, "bc1qrecipient"), `pwb1:t:${quotedTxid}:bc1qrecipient`);
  assert.throws(() => mod.buildBoostPostPayload({ message: "" }), /Enter a Boost post/u);
  assert.throws(() => mod.buildBoostPostPayload({ message: "exact", proofSignalSats: 1.5 }), /non-negative whole/u);
});


test("Boost WORK signal binds exactly to a canonical same-transaction self-transfer", async () => {
  const source = await readFile(new URL("../scripts/backfill-proof-indexer.mjs", import.meta.url), "utf8");
  const start = source.indexOf("function preparedProtocolItemsWithCanonicalMailAttachments(");
  const end = source.indexOf("\nasync function preparedProtocolItemsForTx(", start);
  assert.ok(start > 0 && end > start);
  const workId = "d4e5ebf11d104d6a63fb74e42094364b25a5f7199a09e5c0e71408972466a8b8";
  const context = vm.createContext({
    BigInt, Map, Set, createHash,
    decodedBase64UrlBytes: (data) => /^[A-Za-z0-9_-]*$/u.test(String(data ?? ""))
      ? Buffer.from(data, "base64url") : null,
    WORK_TOKEN_ID: workId,
    WORK_TOKEN_TICKER: "WORK",
    WORK_SUBATOM_PROJECTION_MODEL: "work-subatoms-v2",
    WORK_AMO_V8_TRANSFER_VERSION: "send3",
    WORK_AMO_V8_GLOBAL_PRECISION_MODEL: "work-subatoms-v2",
    WORK_ATOM_TO_SUBATOM_SCALE: 100000000n,
    MAIL_WORK_ATTACHMENT_KINDS: new Set(["mail"]),
    canonicalWorkAtomsText: () => "",
    canonicalWorkSubatomsText: (value) => /^[1-9][0-9]*$/u.test(String(value ?? "")) ? String(value) : "",
    isHexTxid: (value) => /^[0-9a-f]{64}$/u.test(value),
    withWorkSubatomPrecisionMetadata: (item) => item,
    formatWorkSubatoms,
    sameCanonicalPaymentAddress: (left, right) => Boolean(left && right && left === right),
    compareCanonicalUtf8: (left, right) => Buffer.compare(Buffer.from(left), Buffer.from(right)),
    boostSelfSend: (item, sender) => (item.recipients ?? []).some((payment) => payment.address === sender),
    invalidProtocolItem: (item, reason) => ({ ...item, kind: `${item.kind}-invalid`, reason, valid: false }),
  });
  vm.runInContext(`${source.slice(start, end)}\nthis.prepare = preparedProtocolItemsWithCanonicalMailAttachments;`, context);
  const tx = "d".repeat(64);
  const author = "1AuthorWorkSelfSignal";
  const post = (overrides = {}) => ({
    action: "post", authorAddress: author, confirmed: true, kind: "boost-post",
    protocol: "pwb1", recipients: [], txid: tx, valid: true,
    workSignalSubatoms: "123", ...overrides,
  });
  const transfer = (overrides = {}) => ({
    amountStorageModel: "work-subatoms-v2", amountSubatoms: "123",
    canonicalVerifier: "/api/v1/internal/token-verifier", confirmed: true,
    kind: "token-transfer", protocol: "pwt1", protocolVout: 3,
    recipientAddress: author, senderAddress: author,
    tokenId: workId, transferVersion: "send3", txid: tx, valid: true,
    ...overrides,
  });
  const selfSendStart = source.indexOf("function boostSelfSend(");
  const parserStart = source.indexOf("function boostPostItemFromJson(");
  const parserEnd = source.indexOf("\nfunction boostItemFromMessage(", parserStart);
  assert.ok(selfSendStart > 0 && parserStart > selfSendStart && parserEnd > parserStart);
  const parserContext = vm.createContext({
    BOOST_ACTION_REGISTRY_FEE_SATS: 546,
    BOOST_POST_MAX_CHARS: 140,
    baseProtocolItem: (rawTx, _message, kind) => ({
      amountSats: "0", kind, recipients: rawTx.payments ?? [], txid: rawTx.txid,
    }),
    senderAddressFromTx: () => author,
    boostText: (value) => String(value ?? "").trim(),
    boostMediaPointer: () => null,
    boostTxidText: (value) => /^[0-9a-f]{64}$/u.test(String(value ?? "")) ? String(value) : "",
    boostSignalSats: () => 0,
    canonicalIntegerText: (value) => /^[1-9][0-9]*$/u.test(String(value ?? "")) ? String(value) : "",
    canonicalWorkSubatomsText: (value) => /^[1-9][0-9]*$/u.test(String(value ?? "")) ? String(value) : "",
    normalizedText: (value) => String(value ?? "").trim(),
    boostPaymentToAddressSats: (item, sender) => (item.recipients ?? []).reduce(
      (sum, payment) => sum + (payment.address === sender ? BigInt(payment.amountSats) : 0n), 0n,
    ),
    invalidProtocolItem: (item, reason) => ({ ...item, kind: `${item.kind}-invalid`, reason, valid: false }),
    validBoostSocialItem: (item) => ({ ...item, valid: true }),
  });
  vm.runInContext(`${source.slice(selfSendStart, parserEnd)}\nthis.parse = boostPostItemFromJson;`, parserContext);
  const parsedWorkOnly = parserContext.parse({ txid: tx, payments: [] }, { text: "pwb1:post:fixture" }, "post", {
    text: "WORK-only post", workSignalSubatoms: "123",
  });
  assert.equal(parsedWorkOnly.valid, true);
  assert.equal(parsedWorkOnly.proofSignalSats, 0);
  assert.equal(parserContext.parse({ txid: tx, payments: [] }, { text: "pwb1:post:fixture" }, "post", {
    text: "Unsignalled post",
  }).valid, false);
  assert.equal(parserContext.parse({ txid: tx, payments: [{ address: author, amountSats: "0" }] }, { text: "pwb1:post:fixture" }, "post", {
    text: "Zero Proof post",
  }).valid, false);
  for (const workSignalSubatoms of ["bad", "01", "", null, 1, "-1"]) {
    assert.equal(parserContext.parse({ txid: tx, payments: [{ address: author, amountSats: "546" }] }, { text: "pwb1:post:fixture" }, "post", {
      text: "Malformed WORK claim", workSignalSubatoms,
    }).valid, false);
  }
  assert.equal(parserContext.parse({ txid: tx, payments: [{ address: author, amountSats: "546" }] }, { text: "pwb1:post:fixture" }, "post", {
    text: "Proof-only with explicit zero WORK", workSignalSubatoms: "0",
  }).valid, true);
  assert.match(source.slice(source.indexOf("rawItems.forEach((rawItem, index) =>", source.indexOf("async function canonicalRecoveryItemsForTx("))), /rawItem\?\.protocol === "pwb1"/u);
  const prepared = (boost, work) => context.prepare([boost, ...(work ? [work] : [])])[0];
  const workOnly = prepared(post(), transfer());
  assert.equal(workOnly.valid, true);
  assert.equal(workOnly.proofSignalSats, undefined);
  assert.equal(workOnly.workSignalSubatoms, "123");
  assert.equal(workOnly.workSignalVerification, "canonical-same-tx-work-self-transfer-v1");
  assert.deepEqual(Array.from(workOnly.workSignalTransferVouts), [3]);
  const proofAndWork = prepared(post({ recipients: [{ address: author, amountSats: "546" }], proofSignalSats: 546 }), transfer());
  assert.equal(proofAndWork.valid, true);
  assert.equal(proofAndWork.proofSignalSats, 546);
  const proofOnly = prepared(post({ recipients: [{ address: author, amountSats: "546" }], workSignalSubatoms: undefined }), null);
  assert.equal(proofOnly.valid, true);
  assert.equal(proofOnly.workSignalVerification, undefined);
  for (const invalidTransfer of [
    null,
    transfer({ canonicalVerifier: undefined }),
    transfer({ recipientAddress: "someone-else" }),
    transfer({ senderAddress: "someone-else" }),
    transfer({ amountSubatoms: "124" }),
    transfer({ transferVersion: "send2" }),
  ]) {
    assert.equal(prepared(post(), invalidTransfer).valid, false);
  }
  const duplicate = context.prepare([post(), post(), transfer()]);
  assert.equal(duplicate[0].valid, false);
  assert.equal(duplicate[1].valid, false);
  const ambiguousTransfer = context.prepare([post(), transfer(), transfer({ canonicalVerifier: undefined })]);
  assert.equal(ambiguousTransfer[0].valid, false);

  const bytes = Buffer.from("verified Boost image bytes");
  const media = {
    mime: "image/png", name: "proof.png", size: bytes.length,
    sha256: createHash("sha256").update(bytes).digest("hex"),
    source: "same-tx-pwm1-attachment",
  };
  const mail = (overrides = {}) => ({
    protocol: "pwm1", confirmed: true, txid: tx, valid: true,
    attachment: { ...media, data: bytes.toString("base64url") },
    ...overrides,
  });
  const mediaPost = (overrides = {}) => post({
    recipients: [{ address: author, amountSats: "546" }],
    workSignalSubatoms: undefined, media, ...overrides,
  });
  const preparedMedia = (boost, pwm) => context.prepare([boost, ...(pwm ? [pwm] : [])])[0];
  assert.equal(preparedMedia(mediaPost(), mail()).valid, true);
  assert.equal(preparedMedia(mediaPost(), null).valid, false);
  assert.equal(preparedMedia(mediaPost(), mail({ confirmed: false })).valid, false);
  assert.equal(preparedMedia(mediaPost({ confirmed: false }), mail({ confirmed: false })).valid, true,
    "pending media is byte-verified before confirmation");
  assert.equal(preparedMedia(mediaPost(), mail({ txid: "e".repeat(64) })).valid, false);
  assert.equal(preparedMedia(mediaPost(), mail({ attachment: { ...mail().attachment, data: "dGFtcGVyZWQ" } })).valid, false);
  for (const field of ["sha256", "size", "mime", "name"]) {
    const changed = { ...media, [field]: field === "size" ? media.size + 1 : "mismatch" };
    assert.equal(preparedMedia(mediaPost({ media: changed }), mail()).valid, false, field);
  }
  assert.equal(preparedMedia(mediaPost({ media: { txid: "e".repeat(64) } }), null).valid, true,
    "legacy external media pointers retain their prior behavior");
});

test("Boost client renders same-tx media only when verified attachment bytes match its pointer", async () => {
  const encodingUrl = await importTs("../src/shared/utils/encoding.ts", {
    '"bitcoinjs-lib"': JSON.stringify(import.meta.resolve("bitcoinjs-lib")),
    '"buffer"': '"node:buffer"',
  });
  const mediaUrl = await importTs("../src/features/boost/boostMedia.ts", {
    '"../../shared/utils/encoding"': JSON.stringify(encodingUrl),
  });
  const { boostMediaUrl } = await import(mediaUrl);
  const bytes = Buffer.from("verified image data");
  const pointer = {
    mime: "image/png", name: "proof.png", size: bytes.length,
    sha256: createHash("sha256").update(bytes).digest("hex"),
    source: "same-tx-pwm1-attachment",
  };
  const attachment = { ...pointer, data: bytes.toString("base64url") };
  assert.match(boostMediaUrl(pointer, attachment), /^data:image\/png;base64,/u);
  assert.equal(boostMediaUrl(pointer, undefined), "");
  for (const field of ["sha256", "size", "mime", "name"]) {
    const changed = { ...attachment, [field]: field === "size" ? bytes.length + 1 : "mismatch" };
    assert.equal(boostMediaUrl(pointer, changed), "", field);
  }
  assert.equal(boostMediaUrl(pointer, { ...attachment, data: Buffer.from("tampered").toString("base64url") }), "");
  assert.equal(boostMediaUrl({ mime: "image/png" }, attachment).startsWith("data:image/png"), true,
    "legacy external media keeps its prior rendering behavior");
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

test("profile acquired assets exclude other authors' replies and reboosts of the same asset", async () => {
  const owner = "1KNkUBREnfno2BeV7QsBf8XCWZN6YFfxPH";
  const buyer = "18xvbj6mpPpYYjWibcqsXdV7SCwBQNrqMW";
  const original = event(1, "boost-post", { authorAddress: owner });
  const actions = [event(2, "boost-reboost", { authorAddress: buyer, targetTxid: txid(1) }),
    event(3, "boost-reply", { authorAddress: buyer, targetTxid: txid(1) })];
  const before = await server(reader([original, ...actions]).read).boostFeedPayload("livenet", new URLSearchParams({ profile: owner, profileTab: "purchased" }));
  assert.equal(before.profileSubject.purchasedCount, 0);
  assert.equal(before.profileTabs.purchased, 0);
  assert.equal(before.items.length, 0);
  const transfer = event(4, "boost-transfer", { authorAddress: owner, targetTxid: txid(1), newOwnerAddress: buyer });
  const after = await server(reader([original, ...actions, transfer]).read).boostFeedPayload("livenet", new URLSearchParams({ profile: buyer, profileTab: "purchased" }));
  assert.equal(after.profileSubject.purchasedCount, 1);
  assert.equal(after.profileTabs.purchased, 1);
  assert.deepEqual(Array.from(after.items, item => item.txid), [txid(1)]);
});


test("Boost satoshi and outpoint writers reject fractional or unsafe inputs", async () => {
  const numericUrl = await importTs("../src/features/boost/boostNumeric.ts");
  const numeric = await import(numericUrl);
  assert.equal(numeric.boostPaymentAmountSats(0), 0);
  assert.equal(numeric.boostPaymentAmountSats(Number.MAX_SAFE_INTEGER), Number.MAX_SAFE_INTEGER);
  for (const value of [0.9, 1.9, Number.MAX_SAFE_INTEGER + 1, "1", null]) {
    assert.equal(numeric.boostPaymentAmountSats(value), null);
  }
  assert.equal(numeric.boostListingPriceSats(1), 1);
  for (const value of [0, 0.9, 1.9, Number.MAX_SAFE_INTEGER + 1, "2"]) {
    assert.equal(numeric.boostListingPriceSats(value), null);
  }
  const txid = "a".repeat(64);
  assert.equal(numeric.normalizeBoostSpentOutpoint({ txid: txid.toUpperCase(), vout: 2 }), `${txid}:2`);
  for (const vout of [1.9, -1, Number.MAX_SAFE_INTEGER + 1, "2"]) {
    assert.equal(numeric.normalizeBoostSpentOutpoint({ txid, vout }), "");
  }

  const encoding = await importTs("../src/shared/utils/encoding.ts", {
    '"bitcoinjs-lib"': JSON.stringify(import.meta.resolve("bitcoinjs-lib")),
    '"buffer"': '"node:buffer"',
  });
  const protocolUrl = await importTs("../src/features/boost/boostProtocol.ts", {
    '"../../shared/utils/encoding"': JSON.stringify(encoding),
    '"./boostNumeric"': JSON.stringify(numericUrl),
  });
  const protocol = await import(protocolUrl);
  const profilePayload = protocol.buildBoostProfilePayload({ image: { txid, name: "photo.png" }, banner: null });
  const decodedProfile = JSON.parse(Buffer.from(profilePayload.split(":")[2], "base64url"));
  assert.equal(decodedProfile.image.txid, txid);
  assert.equal(decodedProfile.banner, null);
  assert.equal(Object.hasOwn(decodedProfile, "id"), false, "media-only updates do not overwrite identity");
  const identityPayload = protocol.buildBoostProfilePayload({ id: "alice" });
  const decodedIdentity = JSON.parse(Buffer.from(identityPayload.split(":")[2], "base64url"));
  assert.equal(Object.hasOwn(decodedIdentity, "image"), false, "identity updates do not clear images");
  assert.equal(Object.hasOwn(decodedIdentity, "banner"), false);

  const authorization = protocol.boostSaleAuthorizationDraft({
    boostTxid: txid,
    priceSats: 1,
    sellerAddress: "owner",
  });
  assert.equal(authorization.priceSats, 1);
  for (const priceSats of [0.9, 1.9, Number.MAX_SAFE_INTEGER + 1]) {
    assert.throws(() => protocol.boostSaleAuthorizationDraft({
      boostTxid: txid, priceSats, sellerAddress: "owner",
    }), /price must be at least 1 proof/u);
  }

  const walletSource = await readFile(new URL("../src/features/boost/boostWallet.ts", import.meta.url), "utf8");
  const outputStart = walletSource.indexOf("function normalizeOutput(");
  const outputEnd = walletSource.indexOf("\n}", outputStart) + 2;
  const outputNormalizer = walletSource.slice(outputStart, outputEnd);
  assert.match(outputNormalizer, /boostPaymentAmountSats\(payment\.amountSats\)/u);
  const paymentBuilder = walletSource.slice(
    walletSource.indexOf("export async function buildBoostPaymentPsbt("),
    walletSource.indexOf("\ntype UnsignedTransactionIntent"),
  );
  assert.match(paymentBuilder, /excludeOutpoints\.map\(\s*normalizeBoostSpentOutpoint[\s\S]*?some\(\(outpoint\) => !outpoint\)[\s\S]*?throw new Error/u);
  assert.doesNotMatch(walletSource, /Math\.floor\((?:payment\.amountSats|outpoint\.vout)/u);
});

test("profile media updates preserve identity and untouched slots; null clears and pending cannot overwrite", () => {
  const image = { txid: txid(100), sha256: "a".repeat(64), size: 12, mime: "image/png", name: "avatar.png" };
  const banner = { ...image, name: "banner.png" };
  const api = server(reader([]).read);
  const events = [
    event(1, "boost-profile", { profile: { image, banner } }),
    event(2, "boost-profile", { profileId: "alice", profile: { id: "alice", name: "Alice" } }),
    event(3, "boost-profile", { profile: { banner: null } }),
    event(4, "boost-profile", { confirmed: false, profile: { image: null } }),
  ];
  const profile = api.boostOwnershipState(events).profiles.get("owner");
  assert.equal(profile.id, "alice");
  assert.equal(profile.image.sha256, image.sha256);
  assert.equal(profile.banner, null);
  assert.equal(profile.name, "Alice");
  assert.equal(api.boostOwnershipState(events.slice(0, 1)).profiles.get("owner").image.txid, image.txid,
    "addresses without IDs may publish images");
});

test("profile file choices require confirmed verified raster files and deduplicate Inbox/Sent", async () => {
  const encodingUrl = await importTs("../src/shared/utils/encoding.ts", {
    '"bitcoinjs-lib"': JSON.stringify(import.meta.resolve("bitcoinjs-lib")), '"buffer"': '"node:buffer"',
  });
  const mediaUrl = await importTs("../src/features/boost/boostMedia.ts", { '"../../shared/utils/encoding"': JSON.stringify(encodingUrl) });
  const profileUrl = await importTs("../src/features/boost/boostProfileMedia.ts", { '"./boostMedia"': JSON.stringify(mediaUrl) });
  const { profileImageChoices, verifiedProfileImage } = await import(profileUrl);
  const bytes = Buffer.from("image bytes");
  const attachment = { name: "photo.png", mime: "image/png", size: bytes.length,
    sha256: createHash("sha256").update(bytes).digest("hex"), data: bytes.toString("base64url") };
  const message = { txid: txid(300), confirmed: true, attachment };
  const files = profileImageChoices({ inboxMessages: [message, { ...message, txid: txid(301), confirmed: false }],
    sentMessages: [{ ...message, status: "confirmed" }, { ...message, txid: txid(302), attachment: { ...attachment, data: "invalid" } }] });
  assert.equal(files.length, 1);
  assert.match(files[0].url, /^data:image\/png;base64,/u);
  assert.equal(files[0].pointer.source, "confirmed-pwm1-attachment");
  assert.equal(verifiedProfileImage({ ...files[0].pointer, mime: "image/svg+xml" }, { ...attachment, mime: "image/svg+xml" }), "");
  for (const field of ["txid", "sha256", "size", "mime", "name"]) {
    assert.equal(verifiedProfileImage({ ...files[0].pointer, [field]: field === "size" ? 99 : "invalid" }, attachment), "", field);
  }
});

test("profile carrier binds images to the transaction sender and preserves clear/crop metadata", async () => {
  const source = await readFile(new URL("./backfill-proof-indexer.mjs", import.meta.url), "utf8");
  const take = name => {
    const start = source.indexOf(`function ${name}(`);
    const end = source.indexOf("\nfunction ", start + 1);
    assert.ok(start >= 0 && end > start);
    return source.slice(start, end);
  };
  const context = vm.createContext({
    normalizedText: value => String(value ?? "").trim(), normalizedLowerText: value => String(value ?? "").trim().toLowerCase(),
    normalizedPowId: identityNormalizer, decodeCanonicalBase64UrlJsonObject: value => JSON.parse(Buffer.from(value, "base64url")),
    baseProtocolItem: (tx, message, kind) => ({ txid: tx.txid, kind, confirmed: true }),
    senderAddressFromTx: () => "actual-wallet", invalidProtocolItem: (item, reason) => ({ ...item, valid: false, reason }),
  });
  vm.runInContext(["boostTxidText", "boostMediaPointer", "boostJsonPayload", "boostText", "boostSignalSats", "boostItemFromMessage"].map(take).join("\n") + "\nthis.parse = boostItemFromMessage;", context);
  const profile = { address: "forged-wallet", image: { txid: txid(1), mime: "image/png", name: "file.png", size: 12,
    sha256: "b".repeat(64), positionX: 25, positionY: 100, url: "https://untrusted.example/tracker" }, banner: null };
  const [item] = context.parse({ txid: txid(2) }, { text: `pwb1:profile:${Buffer.from(JSON.stringify(profile)).toString("base64url")}` });
  assert.equal(item.authorAddress, "actual-wallet");
  assert.equal(item.profile.image.positionX, 25);
  assert.equal(item.profile.image.positionY, 100);
  assert.equal(item.profile.image.url, undefined);
  assert.equal(item.profile.banner, null);
  assert.equal(item.valid, true);
});

test("transaction-scoped Boost detail exhausts history independently of profile, filters and feed pagination", async () => {
  const events = [event(1), ...Array.from({ length: 120 }, (_, i) => event(i + 2, "boost-reply", { authorAddress: "reply-author", targetTxid: txid(1) })),
    event(122, "boost-like", { authorAddress: "liker", targetTxid: txid(1) }),
    event(123, "boost-reboost", { authorAddress: "rebooster", targetTxid: txid(1) }),
    event(124, "boost-reply", { authorAddress: "pending", targetTxid: txid(1), confirmed: false, status: "pending" }),
    event(125, "boost-like", { targetTxid: txid(1), valid: false })];
  const api = server(reader(events).read, { proofIndexRegistryPayload: async () => identityRegistry([
    { id: "reply-id", ownerAddress: "reply-author", confirmed: true }, { id: "liker-id", ownerAddress: "liker", confirmed: true },
  ]) });
  const params = new URLSearchParams({ detail: txid(1), profile: "owner", q: "no match", window: "day", pending: "1", limit: "50" });
  const first = await api.boostFeedPayload("livenet", params);
  assert.equal(first.mode, "detail");
  assert.equal(first.totalCount, 120);
  assert.equal(first.post.replyCount, 120);
  assert.equal(first.post.likeCount, 1);
  assert.equal(first.post.reboostCount, 1);
  assert.equal(first.items[0].id, "reply-id");
  assert.equal(first.items[0].post.kind, "boost-reply");
  assert.equal(first.items[0].txid, txid(2));
  const second = await api.boostFeedPayload("livenet", new URLSearchParams({ ...Object.fromEntries(params), cursor: first.nextCursor }));
  const third = await api.boostFeedPayload("livenet", new URLSearchParams({ ...Object.fromEntries(params), cursor: second.nextCursor }));
  assert.equal(new Set([...first.items, ...second.items, ...third.items].map(row => row.eventId)).size, 120);
  assert.equal(third.hasMore, false);
  for (const [activity, actor] of [["likes", "liker"], ["reboosts", "rebooster"]]) {
    const result = await api.boostFeedPayload("livenet", new URLSearchParams({ detail: txid(1), activity }));
    assert.equal(result.totalCount, 1);
    assert.equal(result.items[0].address, actor);
    assert.equal(result.items[0].confirmed, true);
  }
  await assert.rejects(api.boostFeedPayload("livenet", new URLSearchParams({ detail: txid(1), activity: "likes", cursor: first.nextCursor })), /changed/u);
  await assert.rejects(api.boostFeedPayload("livenet", new URLSearchParams({ detail: txid(999) })), /unavailable/u);
  await assert.rejects(api.boostFeedPayload("livenet", new URLSearchParams({ detail: "bad" })), /Invalid/u);
});

test("connection lists use latest confirmed edges and show qualified IDs, relationship flags and follow evidence", async () => {
  const events = [event(1, "boost-follow", { authorAddress: "alice", targetAddress: "subject" }),
    event(2, "boost-follow", { authorAddress: "bob", targetAddress: "subject" }),
    event(3, "boost-unfollow", { authorAddress: "bob", targetAddress: "subject" }),
    event(4, "boost-follow", { authorAddress: "pending", targetAddress: "subject", confirmed: false, status: "pending" }),
    event(5, "boost-follow", { authorAddress: "subject", targetAddress: "alice" }),
    event(6, "boost-follow", { authorAddress: "subject", targetAddress: "subject" }),
    event(7, "boost-follow", { authorAddress: "alice", targetAddress: "subject" })];
  const api = server(reader(events).read, { proofIndexRegistryPayload: async () => identityRegistry([
    { id: "alice-id", ownerAddress: "alice", confirmed: true }, { id: "subject-id", ownerAddress: "subject", confirmed: true },
    { id: "pending-id", ownerAddress: "alice", confirmed: false },
  ]) });
  for (const connections of ["followers", "following"]) {
    const result = await api.boostFeedPayload("livenet", new URLSearchParams({ profile: "subject-id", connections, viewer: "subject", pending: "1" }));
    assert.equal(result.totalCount, 1);
    assert.equal(result.items[0].address, "alice");
    assert.equal(result.items[0].id, "alice-id");
    assert.equal(result.items[0].viewerFollowsProfile, true);
    assert.equal(result.items[0].followsViewer, true);
    assert.equal(result.items[0].txid, txid(connections === "followers" ? 7 : 5));
    assert.equal(result.profileSubject.address, "subject");
  }
  await assert.rejects(api.boostFeedPayload("livenet", new URLSearchParams({ connections: "followers" })), /Invalid/u);
});

test("tips bind exact owner payments at chain position and accumulate once on content", async () => {
  const original = event(1);
  const tip = event(2, "boost-tip", { targetTxid: txid(1), authorAddress: "reader", tipAmountSats: "12345",
    recipients: [{ address: "owner", amountSats: "12345", vout: 0 }] });
  const moved = event(3, "boost-transfer", { newOwnerAddress: "buyer", targetTxid: txid(1), authorAddress: "owner" });
  const later = event(4, "boost-tip", { targetTxid: txid(1), authorAddress: "reader", tipAmountSats: "1",
    recipients: [{ address: "buyer", amountSats: "1", vout: 0 }] });
  const wrong = event(5, "boost-tip", { ...later, eventId: 5, txid: txid(5), recipients: [{ address: "owner", amountSats: "1", vout: 0 }] });
  const excess = event(6, "boost-tip", { ...later, eventId: 6, txid: txid(6), recipients: [{ address: "buyer", amountSats: "2", vout: 0 }] });
  const pending = event(7, "boost-tip", { ...later, eventId: 7, txid: txid(7), confirmed: false });
  const api = server(reader([original, tip, moved, later, wrong, excess, pending]).read, { proofIndexRegistryPayload: async () => identityRegistry([]) });
  const feed = await api.boostFeedPayload("livenet", new URLSearchParams());
  assert.equal(feed.items.length, 1);
  assert.equal(feed.items[0].tipCount, 2);
  assert.equal(feed.items[0].replyCount, 0);
  assert.equal(feed.items[0].likeCount, 0);
  assert.equal(feed.items[0].reboostCount, 0);
  assert.equal(feed.items[0].tipSatsExact, "12346");
  assert.equal(feed.items[0].proofSignalSatsExact, "12892");
  assert.equal(feed.items[0].currentOwnerAddress, "buyer");
  assert.equal(feed.provenance.applicationRejectedEvents.length, 2);
  const detail = await api.boostFeedPayload("livenet", new URLSearchParams({ detail: txid(1), activity: "tips" }));
  assert.equal(detail.totalCount, 2);
  assert.deepEqual(Array.from(detail.items, item => item.amountSatsExact), ["12345", "1"]);
  assert.ok(detail.items.every(item => item.targetTxid === txid(1) && item.confirmed));
});

test("tip parser rejects malformed, unpaid and duplicate tip carriers", async () => {
  const { parseBoostTip } = await import("../src/shared/protocol/boostTip.mjs");
  const source = await readFile(new URL("./backfill-proof-indexer.mjs", import.meta.url), "utf8");
  const start = source.indexOf("function boostItemFromMessage(");
  const end = source.indexOf("\nfunction ", start + 1);
  const context = vm.createContext({ parseBoostTip, normalizedLowerText: value => String(value).toLowerCase(),
    normalizedText: value => String(value ?? "").trim(), boostTxidText: value => /^[0-9a-f]{64}$/.test(value ?? "") ? value : "",
    baseProtocolItem: (tx, message, kind) => ({ kind, amountSats: tx.amountSats, recipients: tx.recipients }),
    senderAddressFromTx: () => "reader", protocolMessagesFromTx: tx => tx.records,
    invalidProtocolItem: (item, reason) => ({ ...item, valid: false, reason }) });
  vm.runInContext(source.slice(start, end) + "\nthis.parse = boostItemFromMessage;", context);
  const message = { text: `pwb1:tip:${txid(1)}:12345` };
  const tx = { amountSats: "12345", records: [message] };
  assert.equal(context.parse(tx, message)[0].valid, true);
  assert.equal(context.parse({ ...tx, amountSats: "12344" }, message)[0].valid, false);
  assert.equal(context.parse({ ...tx, records: [message, message] }, message)[0].valid, false);
  for (const amount of ["0", "-1", "1.5", "01", "1e3", "2100000000000001"]) {
    assert.equal(context.parse(tx, { text: `pwb1:tip:${txid(1)}:${amount}` })[0].valid, false);
  }
});

test("tip associations add no second canonical Growth payment over their Mail companion", () => {
  const context = vm.createContext({ numericValue: value => Number(value) || 0,
    uniqueMarketplaceMutationActivity: () => [], MARKETPLACE_MUTATION_KINDS: new Set(),
    ID_MARKETPLACE_MUTATION_KINDS: new Set(), TOKEN_MARKETPLACE_MUTATION_KINDS: new Set(),
    GROWTH_MODEL_INPUTS: { valueMultiple: 5 }, INFINITY_BOND_KIND: "infinity-bond", INCEPTION_BOND_KIND: "inception-bond" });
  vm.runInContext(definition("BOOST_EVENT_KINDS") + "\n" + definition("growthDeltaForProofIndexEvents") + "\nthis.delta = growthDeltaForProofIndexEvents;", context);
  const mail = { kind: "mail", totalSats: 12345 };
  const tip = { kind: "boost-tip", totalSats: 12345 };
  assert.deepEqual(context.delta([mail, tip]), context.delta([mail]));
  assert.equal(context.delta([mail, tip]).mailFlowSats, 12345);
  assert.equal(context.delta([mail, tip]).totalSats, 61725);
  assert.equal(context.delta([tip]).totalSats, 0);
});
