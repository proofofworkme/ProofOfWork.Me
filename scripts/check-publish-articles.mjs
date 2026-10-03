import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import vm from "node:vm";
import * as bitcoin from "bitcoinjs-lib";
import * as articleProtocol from "../src/shared/protocol/publishArticle.mjs";
import * as projection from "../server/boost-projection.mjs";
import { canonicalProtocolCandidateFromOutput } from "../server/canonical-op-return.mjs";
import { verifiedBoostTicketClosures } from "../server/boost-marketplace-proof.mjs";
import { boostTextMatchesTag } from "../src/shared/protocol/boostText.mjs";
import { boostGrowthObservedAction, createBoostGrowthObservation } from "../server/boost-growth.mjs";
import { decimalValueToQ8, formatWorkSubatoms, q8ToCanonicalDecimal, q8ToNumber, WORK_SUBATOM_UNIT_SCALE } from "../server/work-units.mjs";

const { normalizePublishArticleMetadata, publishArticleMetadataFromPayload, publishArticleBodyBytes,
  publishArticleBodyFromRecords, publishArticleDataCarrierBytes, PUBLISH_ARTICLE_VERIFICATION } = articleProtocol;
const hash = bytes => createHash("sha256").update(bytes).digest("hex");
const txid = id => id.toString(16).padStart(64, "0");
const blockHash = "a".repeat(64);
const address = "bc1qfwytlzyr3ym3enz2eutwtjsf9kkf6uqkjydk3e";
const opReturn = text => ({ value: 0, scriptpubkey: Buffer.from(bitcoin.script.compile([
  bitcoin.opcodes.OP_RETURN, Buffer.from(text, "utf8"),
])).toString("hex") });
const metadata = body => ({ v: 1, title: "An article", source: "same-tx-pwm1-message",
  size: Buffer.byteLength(body, "utf8"), sha256: hash(Buffer.from(body, "utf8")) });
const payload = article => `pwb1:post:${Buffer.from(JSON.stringify({ v: 1, text: article.title, article })).toString("base64url")}`;
const records = tx => tx.vout.map((output, voutIndex) => {
  const candidate = canonicalProtocolCandidateFromOutput(output);
  return candidate ? { ...candidate, voutIndex } : null;
}).filter(Boolean);
function transaction(body, splitAt = body.length) {
  const article = metadata(body);
  const chunks = [body.slice(0, splitAt), ...(splitAt < body.length ? [body.slice(splitAt)] : [])];
  return { txid: txid(1), status: { confirmed: true, block_hash: blockHash, block_height: 965000 },
    vin: [{ prevout: { scriptpubkey_address: address } }],
    vout: [{ value: 546, scriptpubkey_address: address,
      scriptpubkey: Buffer.from(bitcoin.address.toOutputScript(address)).toString("hex") },
    ...chunks.map(chunk => opReturn(`pwm1:m:${chunk}`)), opReturn(payload(article))] };
}

test("article commitment verifies complete exact UTF-8 bytes once without trimming", () => {
  const body = "  Title\r\n\nParagraph with café and 東京.\n\tSecond paragraph.  \n";
  const tx = transaction(body, 24);
  assert.equal(publishArticleBodyFromRecords(records(tx), metadata(body), hash), body);
  assert.equal(publishArticleBodyBytes(body).length, Buffer.byteLength(body));
  assert.deepEqual(publishArticleMetadataFromPayload(payload(metadata(body))), metadata(body));
  assert.equal(publishArticleBodyBytes("\ud800"), null);
  assert.equal(publishArticleBodyBytes("a\u0000b"), null);
  for (const change of [{ v: 2 }, { source: "https://mutable.example" }, { size: "1" },
    { size: 0 }, { sha256: "b".repeat(64) }, { title: "" }, { extra: true }]) {
    const claimed = { ...metadata(body), ...change };
    assert.equal(publishArticleBodyFromRecords(records(tx), claimed, hash), null);
  }
});

test("article roots reject incomplete, ambiguous, invalid and non-text carriers", () => {
  const mismatched = `pwb1:post:${Buffer.from(JSON.stringify({ v: 1, text: "Different title", article: metadata("Body") })).toString("base64url")}`;
  assert.equal(publishArticleMetadataFromPayload(mismatched), null);
  const body = "first\nlast\n";
  const tx = transaction(body, 6);
  const original = records(tx);
  const invalid = [
    original.filter(record => record.voutIndex !== 2),
    [...original, { ...original.at(-1), voutIndex: 4 }],
    original.map(record => record.voutIndex === 2 ? { ...record, decodeValid: false } : record),
    original.map(record => record.voutIndex === 2 ? { ...record, text: "pwm1:m:changed" } : record),
    original.map(record => record.voutIndex === 2 ? { ...record, text: "pwm1:a:attachment" } : record),
    original.map(record => record.voutIndex === 3 ? { ...record, voutIndex: 1 } : record),
    original.map(record => record.voutIndex === 2 ? { ...record, voutIndex: 4 } : record),
  ];
  for (const candidates of invalid) assert.equal(publishArticleBodyFromRecords(candidates, metadata(body), hash), null);
  assert.equal(publishArticleMetadataFromPayload(payload(metadata(body)) + "="), null);
  assert.equal(normalizePublishArticleMetadata({ ...metadata(body), title: "x".repeat(141) }), null);
});

const indexerSource = await readFile(new URL("./backfill-proof-indexer.mjs", import.meta.url), "utf8");
const parserStart = indexerSource.indexOf("function boostPostItemFromJson(");
const parserEnd = indexerSource.indexOf("\nfunction boostItemFromMessage(", parserStart);
function indexer() {
  const context = vm.createContext({ ...articleProtocol, createHash,
    BOOST_ACTION_REGISTRY_FEE_SATS: 546, BOOST_POST_MAX_CHARS: 140,
    baseProtocolItem: (tx, message, kind) => ({ txid: tx.txid, kind, protocolVout: message.voutIndex }),
    senderAddressFromTx: () => address, boostText: value => String(value ?? "").trim(),
    boostMediaPointer: value => value ?? null, boostTxidText: () => "", boostSignalSats: () => 546,
    canonicalWorkSubatomsText: value => /^[1-9]\d*$/u.test(String(value)) ? String(value) : "",
    boostSelfSend: () => true, protocolMessagesFromTx: records,
    invalidProtocolItem: (item, reason) => ({ ...item, valid: false, reason }),
    validBoostSocialItem: item => ({ ...item, valid: true }),
  });
  vm.runInContext(`${indexerSource.slice(parserStart, parserEnd)}\nthis.parse = boostPostItemFromJson;`, context);
  return context.parse;
}
function parseArticle(tx, body, overrides = {}, action = "post") {
  return indexer()(tx, records(tx).find(record => record.text.startsWith("pwb1:post:")), action, { v: 1, text: "An article", article: metadata(body), ...overrides });
}

test("indexer accepts article roots and retains legacy 140-character rules", () => {
  const body = "An exact body\n".repeat(200);
  const tx = transaction(body);
  const post = parseArticle(tx, body);
  assert.equal(post.valid, true);
  assert.deepEqual(post.article, metadata(body));
  assert.equal(post.articleVerification, PUBLISH_ARTICLE_VERIFICATION);
  assert.equal(post.articleBody, undefined, "index and feed must not duplicate the body");
  assert.equal(parseArticle(tx, body, { article: null }).valid, false);
  assert.equal(parseArticle(tx, body, {}, "reply").valid, false);
  assert.equal(parseArticle(tx, body, { media: { name: "media" } }).valid, false);
  assert.equal(parseArticle(tx, body, { text: "x".repeat(141) }).valid, false);
  const parse = indexer();
  assert.equal(parse(tx, records(tx).at(-1), "post", { v: 1, text: "x".repeat(140) }).valid, true);
  assert.equal(parse(tx, records(tx).at(-1), "post", { v: 1, text: "x".repeat(141) }).valid, false);
});

test("100,000 aggregate script bytes include metadata, prefixes and push overhead", () => {
  let length = 99000;
  let tx;
  for (let attempt = 0; attempt < 8; attempt += 1) {
    tx = transaction("x".repeat(length));
    const delta = 100000 - publishArticleDataCarrierBytes(tx);
    if (!delta) break;
    length += delta;
  }
  assert.equal(publishArticleDataCarrierBytes(tx), 100000);
  assert.ok(length < 100000);
  assert.equal(parseArticle(tx, "x".repeat(length)).valid, true);
  const over = transaction("x".repeat(length + 1));
  assert.equal(publishArticleDataCarrierBytes(over), 100001);
  assert.equal(parseArticle(over, "x".repeat(length + 1)).valid, false);
});

const apiSource = await readFile(new URL("../server/proof-api.mjs", import.meta.url), "utf8");
function definition(name) {
  const start = apiSource.indexOf(`function ${name}(`);
  if (start >= 0) return apiSource.slice(start, apiSource.indexOf("\nfunction ", start + 10));
  const constant = apiSource.indexOf(`const ${name} = new Set([`);
  return apiSource.slice(constant, apiSource.indexOf("\n]);", constant) + 4);
}
function api(events, rawTx = transaction("Exact full body.\n"), registryRecords = []) {
  const checkpoint = { network: "livenet", source: "proof-indexer-events", snapshotId: "fixture-snapshot",
    indexedThroughBlock: 965000, indexedThroughBlockHash: blockHash,
    indexedAt: "2026-09-01T00:10:00.000Z", maxEventId: events.length,
    maxUpdatedAt: "2026-09-01T00:10:00.000000Z" };
  const read = async (network, params) => {
    const inventory = params.get("protocol") === "pwid1"
      ? [{ ...event(999999), kind: "id-register", protocol: "pwid1", id: "boost", receiveAddress: "registry", blockHeight: 964000 }]
      : events;
    const offset = Number(params.get("cursor")?.replace("page-", "") ?? 0);
    const items = inventory.slice(offset, offset + 200), end = offset + items.length;
    return { ...checkpoint, network, totalCount: inventory.length, items, start: offset, end, emitted: end,
      cursor: params.get("cursor") ?? "", hasMore: end < inventory.length,
      nextCursor: end < inventory.length ? `page-${end}` : "" };
  };
  const context = vm.createContext({ console, Buffer, URLSearchParams, createHash, ...projection, ...articleProtocol,
    canonicalProtocolCandidateFromOutput, verifiedBoostTicketClosures, boostTextMatchesTag,
    decimalValueToQ8, formatWorkSubatoms, q8ToCanonicalDecimal, q8ToNumber, WORK_SUBATOM_UNIT_SCALE,
    WORK_TOKEN_MAX_SUPPLY: 21000000, proofIndexReadFeatureEnabled: () => true,
    proofIndexEventHistoryPayload: read, registryAddressForNetwork: () => "id-registry",
    proofIndexRegistryPayload: async () => ({ ...checkpoint, records: registryRecords, stats: { total: registryRecords.length } }),
    btcUsdPricePayload: async () => ({ btcUsd: 1 }), btcUsdFromQuote: quote => quote.btcUsd,
    satsToUsdAtBtcUsd: (sats, usd) => sats * usd / 100000000, errorSummary: error => error.message,
    payloadIndexedThroughBlockHash: value => value?.indexedThroughBlockHash ?? "",
    numericValue: value => Number(value) || 0, isValidBitcoinAddress: value => Boolean(value),
    boundedInteger: (value, fallback, min, max) => value === null ? fallback : Math.min(max, Math.max(min, Number(value) || fallback)),
    dateIso: (value, fallback) => new Date(value ?? fallback).toISOString(),
    normalizePowId: value => String(value).toLowerCase().replace(/@proofofwork\.me$/u, ""),
    compareCanonicalUtf8: (left, right) => Buffer.compare(Buffer.from(left), Buffer.from(right)),
    bitcoinRpc: async method => ({ ok: true, result: method === "getblockhash" ? blockHash :
      { hash: blockHash, height: 965000, tx: [null, rawTx.txid] } }),
    fetchTransactionFromBitcoinRpc: async () => rawTx,
  });
  const boostSource = apiSource.slice(apiSource.indexOf("const BOOST_VISIBLE_EVENT_KINDS"), apiSource.indexOf("async function registrySummaryPayload", apiSource.indexOf("const BOOST_VISIBLE_EVENT_KINDS")));
  vm.runInContext([definition("BOOST_EVENT_KINDS"), definition("canonicalNonNegativeIntegerText"),
    definition("workSubatomsValueAtNetworkQ8"), boostSource, "this.read = boostFeedPayload;"].join("\n"), context);
  return context.read;
}
function event(id, fields = {}) {
  return { eventId: String(id), txid: txid(id), kind: "boost-post", protocol: "pwb1", confirmed: true,
    valid: true, blockHeight: 965000, blockHash, blockIndex: id, protocolVout: 2, recordOrdinal: 0,
    authorAddress: address, text: "A short Boost", proofSignalSats: 546,
    recipients: [{ address, vout: 0, amountSats: "546" }], createdAt: new Date(Date.UTC(2026, 8, 1) + id * 1000).toISOString(), ...fields };
}

test("article feed uses complete canonical pagination and unchanged engagement counts", async () => {
  const body = "Exact full body.\n";
  const original = event(1, { article: metadata(body), articleVerification: PUBLISH_ARTICLE_VERIFICATION, payload: payload(metadata(body)) });
  const like = event(2, { kind: "boost-like", targetTxid: original.txid, authorAddress: "reader" });
  const reboost = event(3, { kind: "boost-reboost", targetTxid: original.txid, authorAddress: "reader" });
  const events = [original, like, reboost, event(4), ...Array.from({ length: 225 }, (_, index) =>
    event(index + 5, { article: metadata(body), articleVerification: PUBLISH_ARTICLE_VERIFICATION }))];
  const read = api(events);
  const params = new URLSearchParams({ format: "article", sort: "oldest", limit: "100" });
  const first = await read("livenet", params);
  assert.equal(first.totalCount, 227);
  assert.equal(first.items.length, 100);
  assert.equal(first.items[0].articleBody, undefined);
  assert.equal(first.items[0].likeCount, 1);
  assert.equal(first.items[0].reboostCount, 1);
  assert.equal(first.items[0].proofSignalSatsExact, "1638");
  assert.ok(first.items[1].reboostedPost.article);
  params.set("cursor", first.nextCursor);
  const second = await read("livenet", params);
  params.set("cursor", second.nextCursor);
  const third = await read("livenet", params);
  assert.equal(third.items.length, 27);
  assert.equal(third.hasMore, false);
  assert.equal(new Set([...first.items, ...second.items, ...third.items].map(item => item.txid)).size, 227);
  params.set("format", "");
  await assert.rejects(read("livenet", params), /changed/u);
  const profile = await read("livenet", new URLSearchParams({ format: "article", profile: address, sort: "oldest" }));
  assert.equal(profile.totalCount, 226);
});

test("article detail reads exact raw txid body and preserves the social activity lane", async () => {
  const body = "  Exact full body.\r\nTrailing whitespace.  \n";
  const tx = transaction(body);
  const original = event(1, { article: metadata(body), articleVerification: PUBLISH_ARTICLE_VERIFICATION, payload: payload(metadata(body)) });
  const like = event(2, { kind: "boost-like", authorAddress: "reader", targetTxid: original.txid });
  const read = api([original, like], tx);
  const detail = await read("livenet", new URLSearchParams({ detail: original.txid, activity: "likes" }));
  assert.equal(detail.post.articleBody, body);
  assert.equal(detail.items.length, 1);
  assert.equal(detail.items[0].txid, like.txid);
  const corrupted = { ...tx, vout: [...tx.vout] };
  corrupted.vout[1] = opReturn(`pwm1:m:${body.trim()}`);
  await assert.rejects(api([original], corrupted)("livenet", new URLSearchParams({ detail: original.txid })), /bytes disagree/u);
});

test("same-transaction selected ID profile gives an article its shared Boost byline", async () => {
  const body = "Published by a selected ID.\n";
  const tx = transaction(body);
  const profilePayload = `pwb1:profile:${Buffer.from(JSON.stringify({ v: 1, id: "writer", name: "writer@proofofwork.me" })).toString("base64url")}`;
  tx.vout.push(opReturn(profilePayload));
  assert.equal(publishArticleBodyFromRecords(records(tx), metadata(body), hash), body);
  assert.equal(parseArticle(tx, body).valid, true);
  const original = event(1, { article: metadata(body), articleVerification: PUBLISH_ARTICLE_VERIFICATION,
    payload: payload(metadata(body)) });
  const selectedProfile = event(1, { eventId: "2", kind: "boost-profile", protocolVout: 3,
    profileId: "writer", profile: { id: "writer", name: "writer@proofofwork.me" } });
  const feed = await api([original, selectedProfile], tx, [{ id: "writer", ownerAddress: address, confirmed: true }])("livenet", new URLSearchParams({ format: "article" }));
  assert.equal(feed.items.length, 1);
  assert.equal(feed.items[0].txid, original.txid);
  assert.equal(feed.items[0].profileId, "writer");
  assert.equal(feed.items[0].authorId, "writer");
  assert.equal(feed.items[0].authorDisplay, "writer@proofofwork.me");
  assert.equal(feed.items[0].proofSignalSatsExact, "546");
});

test("article ownership changes route existing engagement to the new owner and retain authorship", async () => {
  const body = "A transferred article.\n";
  const buyer = "1F1p9UEHuH5KTFR7Zsx93Khdrqhj6t5nFv";
  const original = event(1, { article: metadata(body), articleVerification: PUBLISH_ARTICLE_VERIFICATION });
  const transfer = event(2, { kind: "boost-transfer", targetTxid: original.txid,
    senderAddress: address, newOwnerAddress: buyer, recipients: [{ address: "registry", vout: 0, amountSats: "546" }] });
  const like = event(3, { kind: "boost-like", targetTxid: original.txid, authorAddress: "reader",
    recipients: [{ address: buyer, vout: 0, amountSats: "546" }] });
  const oldOwnerLike = event(4, { kind: "boost-like", targetTxid: original.txid, authorAddress: "reader" });
  const read = api([original, transfer, like, oldOwnerLike]);
  const feed = await read("livenet", new URLSearchParams({ format: "article" }));
  assert.equal(feed.items[0].currentOwnerAddress, buyer);
  assert.equal(feed.items[0].authorAddress, address);
  assert.equal(feed.items[0].likeCount, 1);
  assert.equal(feed.items[0].proofSignalSatsExact, "1092");
  const owned = await read("livenet", new URLSearchParams({ format: "article", profile: buyer, profileTab: "purchased" }));
  assert.equal(owned.totalCount, 1);
  assert.equal(owned.items[0].txid, original.txid);
});

test("Growth counts an article as one existing Boost post with nonadditive Mail attribution", () => {
  const body = "An article body.\n".repeat(80);
  const tx = transaction(body);
  const raw = payload(metadata(body));
  assert.equal(boostGrowthObservedAction(raw), "post");
  const checkpoint = { blockHeight: 965000, blockHash, snapshotId: "fixture-snapshot" };
  const row = { txid: tx.txid, status: "confirmed", block_height: 965000, block_hash: blockHash, block_index: 1,
    raw_tx: { ...tx, _powBlockIndex: 1, canonicalBlockScan: { network: "livenet", height: 965000, blockHash } },
    events: [{ protocol: "pwb1", kind: "boost-post", status: "confirmed", valid: true, raw_payload: raw,
      op_return_vout: 2, record_ordinal: 0, payload: {} },
    { protocol: "pwm1", kind: "mail", status: "confirmed", valid: true, raw_payload: `pwm1:m:${body}`,
      op_return_vout: 1, record_ordinal: 0, payload: { workAmoV5ReplayOutcome: { valid: true, kind: "pwm1-valid" },
        workAmoV5RawCandidate: true, workAmoV5ReplayOutput: { recipients: [{ vout: 0, address, amountSats: "546" }] } } }] };
  const observer = createBoostGrowthObservation(checkpoint);
  observer.addTransaction(row);
  const observed = observer.finish();
  assert.equal(observed.counts.posts, 1);
  assert.equal(observed.counts.articles, 1);
  assert.equal(observed.counts.transactions, 1);
  assert.equal(observed.directProofSignalSats, "546");
  assert.equal(observed.attributedMailSats, "546");
  row.raw_tx.vout[1] = opReturn(`pwm1:m:${body.trim()}`);
  assert.throws(() => createBoostGrowthObservation(checkpoint).addTransaction(row), /article body evidence/u);
});
