import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { test } from "node:test";
import { createPublishReader, PublishReadError } from "./reader.mjs";

const TX = "a".repeat(64), OTHER = "b".repeat(64), THIRD = "c".repeat(64);
const AUTHOR = "bc1qfwytlzyr3ym3enz2eutwtjsf9kkf6uqkjydk3e";
const point = { network: "livenet", snapshotId: "confirmed-snapshot", indexedThroughBlock: 970000,
  indexedThroughBlockHash: "d".repeat(64), indexedAt: "2026-10-15T10:00:00.000Z" };
const hash = text => createHash("sha256").update(text).digest("hex");
const encodedCursor = (offset, fields = {}) => `boost-feed-v1.${Buffer.from(JSON.stringify({
  fingerprint: "e".repeat(64), offset, snapshotId: point.snapshotId, ...fields,
})).toString("base64url")}`;
function post(body = "  Exact café 東京\r\n\tarticle.  \n", txid = TX) {
  return { txid, boostTxid: txid, kind: "boost-post", network: "livenet", confirmed: true,
    authorAddress: AUTHOR, authorDisplay: "writer@proofofwork.me", currentOwnerAddress: "different-owner",
    createdAt: "2026-10-14T09:00:00.000Z", articleBody: body,
    article: { v: 1, title: "An exact article", source: "same-tx-pwm1-message", size: Buffer.byteLength(body), sha256: hash(body) },
    articleVerification: "canonical-same-tx-pwm1-message-v1" };
}
function detail(record = post()) {
  return { ...point, complete: true, mode: "detail", post: record, items: [], start: 0, end: 0,
    totalCount: 0, hasMore: false, nextCursor: "",
    provenance: { ...point, model: "boost-complete-events-v1", eventCount: 200, totalCount: 200, pages: 1 } };
}
function directory(items = [post()]) {
  return { ...detail(), mode: "timeline", format: "article", sort: "newest", valueWindow: "all", view: "all",
    source: "proof-indexer-events", items, totalCount: items.length, end: items.length };
}
const json = (payload, options = {}) => new Response(JSON.stringify(payload), {
  headers: { "content-type": "application/json" }, ...options,
});
const readerFor = (payload, options = {}) => createPublishReader({ apiOrigin: "https://api.example.test",
  fetchImpl: async () => json(payload), ...options });
const unavailable = error => error instanceof PublishReadError && error.statusCode === 503;
const absent = error => error instanceof PublishReadError && error.statusCode === 404;
const tick = () => new Promise(resolve => setImmediate(resolve));

test("detail reads preserve exact UTF-8 and CRLF with original authorship and fixed request parameters", async () => {
  const record = post('  <script>alert("x")</script>\r\n東京\t& end  ');
  record.article.title = '</title><script>injection</script>';
  let requests = 0;
  const reader = readerFor(null, { fetchImpl: async (url, options) => {
    requests++;
    assert.equal(new URL(url).origin, "https://api.example.test");
    assert.equal(new URL(url).pathname, "/api/v1/boost");
    assert.deepEqual(Object.fromEntries(new URL(url).searchParams), { network: "livenet", fresh: "1", detail: TX, activity: "replies", limit: "1" });
    assert.equal(options.redirect, "error"); assert.equal(options.credentials, "omit"); assert.equal(options.cache, "no-store");
    return json(detail(record));
  } });
  const value = await reader.readArticle(TX);
  assert.equal(value.body, record.articleBody); assert.equal(value.title, record.article.title);
  assert.equal(value.authorAddress, AUTHOR); assert.equal(value.sha256, hash(record.articleBody));
  assert.equal(value.publishedAt, null); assert.equal(value.currentOwnerAddress, undefined);
  assert.equal(Object.isFrozen(value), true); assert.equal(Object.isFrozen(value.checkpoint), true);
  await reader.readArticle(TX); assert.equal(requests, 2, "completed results are never cached");
});

test("invalid paths and origins cannot control the upstream request", async () => {
  let fetched = 0;
  const reader = readerFor(null, { fetchImpl: async () => { fetched++; return json(detail()); } });
  for (const txid of ["", TX.toUpperCase(), `${TX}&network=testnet4`, `../${TX}`, `https://evil.test/${TX}`, null, {}, 5]) {
    await assert.rejects(reader.readArticle(txid), absent);
  }
  assert.equal(fetched, 0);
  for (const apiOrigin of ["file:///tmp/x", "https://user:password@api.example", "https://api.example/path", "https://api.example?x=1", "https://api.example#x", "https://api.\nexample", "not a URL"]) {
    assert.throws(() => createPublishReader({ apiOrigin }), TypeError);
  }
  for (const options of [{ timeoutMs: 0 }, { timeoutMs: 60_001 }, { maxConcurrent: 17 }, { maxConcurrent: 0 }, { maxResponseBytes: Infinity }]) {
    assert.throws(() => readerFor(null, options), TypeError);
  }
});

test("missing and nonarticle records are 404; transient and malformed evidence are 503", async () => {
  await assert.rejects(readerFor(null, { fetchImpl: async () => new Response(null, { status: 404 }) }).readArticle(TX), absent);
  const ordinary = post(); delete ordinary.article; delete ordinary.articleVerification;
  await assert.rejects(readerFor(detail(ordinary)).readArticle(TX), absent);
  for (const status of [301, 302, 307, 409, 429, 500, 503]) {
    await assert.rejects(readerFor(null, { fetchImpl: async () => new Response(null, { status }) }).readArticle(TX), unavailable);
  }
  for (const modify of [
    p => { p.complete = false; }, p => { p.mode = "timeline"; }, p => { p.network = "testnet4"; },
    p => { p.provenance.snapshotId = "other"; }, p => { p.provenance.indexedThroughBlockHash = OTHER; },
    p => { p.provenance.eventCount++; }, p => { p.indexedAt = "invalid"; }, p => { p.indexedThroughBlock = 0; },
    p => { p.post.txid = OTHER; }, p => { p.post.confirmed = false; }, p => { p.post.network = "testnet4"; },
    p => { p.post.articleVerification = "unverified"; }, p => { p.post.article.size++; }, p => { p.post.article.sha256 = OTHER; },
    p => { p.post.articleBody += " "; }, p => { p.post.articleBody = "\ud800"; }, p => { p.post.articleBody = "nul\0"; },
    p => { p.post.article.title = "\ud800"; }, p => { p.post.article.extra = "x"; },
    p => { p.post.authorAddress = "<script>"; }, p => { p.post.authorDisplay = "\ud800"; },
    p => { p.end = 5; }, p => { p.hasMore = true; }, p => { p.nextCursor = encodedCursor(5); },
  ]) {
    const payload = detail(); modify(payload);
    await assert.rejects(readerFor(payload).readArticle(TX), unavailable);
  }
});

test("publication dates are never synthesized from the request or checkpoint clock", async () => {
  for (const createdAt of [undefined, "yesterday", "2026-02-30T00:00:00.000Z", "2027-01-01T00:00:00.000Z", "2026-10-14T09:00:00.000Z"]) {
    const payload = detail(); payload.post.createdAt = createdAt;
    assert.equal((await readerFor(payload).readArticle(TX)).publishedAt, null);
  }
});

test("redirected responses, invalid UTF-8, non-JSON and byte excess fail closed", async () => {
  let cancelled = false;
  const responses = [
    () => { const response = json(detail()); Object.defineProperty(response, "redirected", { value: true }); return response; },
    () => { const response = json(detail()); Object.defineProperty(response, "url", { value: "https://evil.test/" }); return response; },
    () => new Response("<html>unavailable</html>", { headers: { "content-type": "text/html" } }),
    () => new Response(Uint8Array.from([0xc3, 0x28]), { headers: { "content-type": "application/json" } }),
    () => new Response("not json", { headers: { "content-type": "application/json" } }),
    () => new Response("{}", { headers: { "content-type": "application/json", "content-length": "99999" } }),
    () => new Response(new ReadableStream({ start(stream) { stream.enqueue(new Uint8Array(101)); }, cancel() { cancelled = true; } }),
      { headers: { "content-type": "application/json" } }),
  ];
  for (const response of responses) await assert.rejects(readerFor(null, { maxResponseBytes: 100,
    fetchImpl: async () => response() }).readArticle(TX), unavailable);
  assert.equal(cancelled, true);
  const payload = detail(), length = Buffer.byteLength(JSON.stringify(payload));
  assert.equal((await readerFor(payload, { maxResponseBytes: length }).readArticle(TX)).txid, TX);
  await assert.rejects(readerFor(payload, { maxResponseBytes: length - 1 }).readArticle(TX), unavailable);
});

test("directory deduplicates original articles and confirmed reboost targets while retaining event pagination", async () => {
  const original = post(); delete original.articleBody;
  const reboost = { txid: OTHER, boostTxid: TX, targetTxid: TX, kind: "boost-reboost", confirmed: true,
    network: "livenet", reboostedPost: original };
  const payload = directory([reboost, original]);
  payload.totalCount = 3; payload.hasMore = true; payload.nextCursor = encodedCursor(2);
  let observed;
  const reader = readerFor(null, { fetchImpl: async url => { observed = new URL(url); return json(payload); } });
  const result = await reader.readDirectory();
  assert.equal(result.articles.length, 1); assert.equal(result.articles[0].txid, TX);
  assert.equal(result.articles[0].body, undefined); assert.equal(result.end, 2); assert.equal(result.totalCount, 3);
  assert.equal(Object.isFrozen(result.articles), true);
  assert.deepEqual(Object.fromEntries(observed.searchParams), { network: "livenet", fresh: "1", format: "article", limit: "100", sort: "newest", window: "all", view: "all" });
  const next = directory([post("next", THIRD)]); next.start = 2; next.end = 3; next.totalCount = 3;
  const nextReader = readerFor(next);
  assert.equal((await nextReader.readDirectory({ cursor: result.nextCursor })).articles[0].txid, THIRD);
});

test("directory cursor, checkpoint, duplicate, pending and reboost corruption never become links", async () => {
  let fetched = 0;
  const reader = readerFor(null, { fetchImpl: async () => { fetched++; return json(directory()); } });
  for (const cursor of ["x", "x".repeat(2049), encodedCursor(1) + "=", encodedCursor(0), encodedCursor(1, { extra: true }), null]) {
    await assert.rejects(reader.readDirectory({ cursor }), unavailable);
  }
  assert.equal(fetched, 0);
  for (const modify of [
    p => { p.mode = "profile"; }, p => { p.format = ""; }, p => { p.sort = "value"; },
    p => { p.items.push(p.items[0]); p.end++; p.totalCount++; }, p => { p.items[0].confirmed = false; },
    p => { p.items[0].kind = "boost-reboost"; p.items[0].reboostedPost = post(); p.items[0].targetTxid = OTHER; },
    p => { p.totalCount = 3; p.hasMore = true; p.nextCursor = encodedCursor(1, { snapshotId: "wrong" }); },
    p => { p.totalCount = 3; p.hasMore = true; p.nextCursor = encodedCursor(2); },
  ]) {
    const payload = directory(); modify(payload);
    await assert.rejects(readerFor(payload).readDirectory(), unavailable);
  }
  const changed = directory(); changed.start = 1; changed.end = 2; changed.totalCount = 2;
  await assert.rejects(readerFor(changed).readDirectory({ cursor: encodedCursor(1, { snapshotId: "old" }) }), unavailable);
});

test("same-key coalescing bounds waiters and concurrency, and does not retain completed results", async () => {
  const pending = []; let calls = 0;
  const reader = readerFor(null, { fetchImpl: (url, { signal }) => {
    calls++; return new Promise((resolve, reject) => { pending.push({ url, resolve }); signal.addEventListener("abort", () => reject(signal.reason), { once: true }); });
  } });
  const shared = Array.from({ length: 16 }, () => reader.readArticle(TX));
  await assert.rejects(reader.readArticle(TX), error => error.code === "PUBLISH_BUSY");
  const other = reader.readArticle(OTHER);
  await assert.rejects(reader.readArticle(THIRD), error => error.code === "PUBLISH_BUSY");
  await tick(); assert.equal(calls, 2);
  pending[0].resolve(json(detail())); pending[1].resolve(json(detail(post("other", OTHER))));
  const completed = await Promise.all(shared); await other;
  assert.ok(completed.every(value => value === completed[0]));
  const reread = reader.readArticle(TX); await tick(); assert.equal(calls, 3);
  pending[2].resolve(json(detail())); await reread;
  reader.close(); await assert.rejects(reader.readArticle(TX), unavailable);
});

test("timeouts cover response streaming, retain occupied abort-ignoring slots and close aborts readers", async () => {
  let signal;
  const blocked = readerFor(null, { timeoutMs: 15, maxConcurrent: 1,
    fetchImpl: (_url, options) => { signal = options.signal; return new Promise(() => {}); } });
  await assert.rejects(blocked.readArticle(TX), error => error.code === "PUBLISH_TIMEOUT");
  assert.equal(signal.aborted, true);
  await assert.rejects(blocked.readArticle(OTHER), error => error.code === "PUBLISH_BUSY"); blocked.close();
  const streaming = readerFor(null, { timeoutMs: 15, fetchImpl: async (_url, { signal: abort }) => new Response(
    new ReadableStream({ start(controller) { abort.addEventListener("abort", () => controller.error(abort.reason)); } }),
    { headers: { "content-type": "application/json" } }) });
  await assert.rejects(streaming.readArticle(TX), error => error.code === "PUBLISH_TIMEOUT"); streaming.close();
  const closing = readerFor(null, { fetchImpl: (_url, { signal: abort }) => new Promise((_, reject) => abort.addEventListener("abort", () => reject(abort.reason))) });
  const read = closing.readArticle(TX); await tick(); closing.close(); await assert.rejects(read, unavailable);
});
