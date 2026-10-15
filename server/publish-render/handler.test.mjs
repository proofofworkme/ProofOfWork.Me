import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { test } from "node:test";
import { createPublishDocumentHandler, resolvePublishRenderRequest } from "./handler.mjs";

const TX = "a".repeat(64), OTHER = "b".repeat(64);
const template = '<!doctype html><html><head><!--proof-seo:start--><!--proof-seo-surface:publish--><title>Generic</title><!--proof-seo:end--><script type="module" src="/assets/app.js"></script></head><body><div id="root"><!--proof-seo-body:start--><!--proof-seo-body:end--></div></body></html>';
const checkpoint = { snapshotId: "confirmed-snapshot", height: 970000, hash: "c".repeat(64), indexedAt: "2026-10-15T12:00:00.000Z" };
const hash = value => createHash("sha256").update(value).digest("hex");
const article = (txid = TX, body = "Exact café 東京\r\nAlice.pow & <script>no()</script> &#13;  ") => ({
  txid, body, title: "An exact title", size: Buffer.byteLength(body), sha256: hash(body),
  authorAddress: "bc1qoriginalauthor", authorDisplay: "Original author", publishedAt: null, checkpoint,
});
const cursor = offset => `boost-feed-v1.${Buffer.from(JSON.stringify({ fingerprint: "d".repeat(64), offset, snapshotId: checkpoint.snapshotId })).toString("base64url")}`;
const page = (articles = [article()], fields = {}) => ({ articles, checkpoint, start: 0, end: articles.length,
  totalCount: articles.length, hasMore: false, nextCursor: "", ...fields });
const handler = (reader = {}, readTemplate = () => template) => createPublishDocumentHandler({
  reader: { readArticle: async () => article(), readDirectory: async () => page(), ...reader }, readTemplate,
});
const request = (url, method = "GET") => ({ url, method });
const articleUrl = `/?article=${TX}`;
const tick = () => new Promise(resolve => setImmediate(resolve));

test("only public article addresses and qualified directory routes enter the renderer", async () => {
  for (const url of [articleUrl, `/index.html?article=${TX}`, `/?article=${TX.toUpperCase()}&network=livenet&utm_source=test`, `/?%61rticle=${TX}`]) {
    assert.deepEqual(resolvePublishRenderRequest(url), { kind: "article", txid: TX });
  }
  for (const url of ["/", "/index.html", "/write", "/write/", "/app.html", "/noindex-app.html", "/missing", "/?profile=writer",
    `/?article=${TX}&write=1`, `/?article=${TX}&network=testnet4`, `/?article=${TX}&wallet=local`,
    `/?article=${TX}&profile=writer`, `/?article=${TX}&article=${OTHER}`, `/?article=${TX}&network=livenet&network=livenet`,
    "/?article=../private", "/?article=%00", "/articles/unknown"]) assert.equal(resolvePublishRenderRequest(url), null, url);
  for (const url of ["/articles", "/articles/", "/articles?network=livenet&utm_source=reader"]) {
    assert.deepEqual(resolvePublishRenderRequest(url), { kind: "directory", cursor: undefined });
  }
  assert.deepEqual(resolvePublishRenderRequest(`/articles?cursor=${cursor(100)}`), { kind: "directory", cursor: cursor(100) });
  assert.deepEqual(resolvePublishRenderRequest("/articles-sitemap.xml?network=livenet"), { kind: "sitemap", cursor: undefined });
  for (const url of ["/articles?network=testnet4", "/articles?write=1", "/articles?cursor=bad", "/articles?cursor=",
    `/articles?cursor=${cursor(1)}&cursor=${cursor(2)}`, "/articles?cursor=" + "a".repeat(2049),
    "/articles-sitemap.xml?cursor=anything", "/articles-sitemap.xml?viewer=local"]) {
    assert.equal(resolvePublishRenderRequest(url)?.kind, "invalid", url);
  }
  let calls = 0, templates = 0;
  const render = handler({ readArticle: async () => { calls++; return article(); } }, () => { templates++; return template; });
  assert.equal(await render(request(`/?article=${TX}&write=1`)), null);
  assert.equal(calls, 0); assert.equal(templates, 0);
  const invalid = await render(request("/articles?viewer=local"));
  assert.equal(invalid.status, 400); assert.equal(calls, 0);
  assert.match(invalid.headers["X-Robots-Tag"], /noindex/u);
});

test("successful article HTTP documents retain exact decoded body bytes and original metadata", async () => {
  const source = article();
  const response = await handler()(request(articleUrl));
  assert.equal(response.status, 200); assert.equal(response.headers["Cache-Control"], "no-store");
  assert.equal(response.headers["Content-Type"], "text/html; charset=utf-8");
  const body = /data-publish-exact-body>(.*?)<\/div>/su.exec(response.body)[1];
  assert.ok(!body.includes("\r")); assert.ok(!body.includes("<script>"));
  const plain = body.replace(/<a\b[^>]*>|<\/a>/gu, "").replace(/&(amp|lt|gt|quot|#39|#13);/gu,
    (_, entity) => ({ amp: "&", lt: "<", gt: ">", quot: '"', "#39": "'", "#13": "\r" })[entity]);
  assert.equal(plain, source.body); assert.equal(hash(Buffer.from(plain)), source.sha256);
  assert.match(response.body, new RegExp(`rel="canonical" href="https://publish.proofofwork.me/\\?article=${TX}"`));
  assert.match(response.body, /property="og:type" content="article"/u);
  assert.match(response.body, /Original author/u); assert.ok(!response.body.includes('datePublished'));
  assert.ok(!response.body.includes('<title>Generic'));
});

test("methods, HEAD, error statuses and private routes preserve the HTTP contract", async () => {
  let calls = 0;
  const render = handler({ readArticle: async () => { calls++; return article(); } });
  for (const method of ["POST", "PUT", "DELETE", "OPTIONS"]) {
    const result = await render(request(articleUrl, method));
    assert.equal(result.status, 405); assert.equal(result.headers.Allow, "GET, HEAD");
    assert.match(result.headers["X-Robots-Tag"], /noindex/u);
  }
  assert.equal(calls, 0);
  assert.equal((await render(request(articleUrl, "HEAD"))).status, 200);
  assert.equal(calls, 1, "HEAD verifies the same current content; the HTTP server removes its body");
  for (const statusCode of [404, 409, 429, 500, 503]) {
    const fail = async () => { throw Object.assign(new Error("private upstream detail"), { statusCode }); };
    const result = await handler({ readArticle: fail })(request(articleUrl));
    assert.equal(result.status, statusCode === 404 ? 404 : 503);
    assert.equal(result.headers["Retry-After"], statusCode === 404 ? undefined : "30");
    assert.match(result.headers["X-Robots-Tag"], /noindex/u);
    assert.ok(!result.body.includes("private upstream detail"));
    assert.ok(!result.body.includes('rel="canonical"')); assert.ok(!result.body.includes('application/ld+json'));
    assert.ok(!result.body.includes('data-publish-exact-body')); assert.ok(!result.body.includes('type="module"'));
    assert.equal((await handler({ readDirectory: fail })(request("/articles"))).status, 503);
  }
  assert.equal((await handler({ readArticle: async () => ({ ...article(), body: "changed" }) })(request(articleUrl))).status, 503);
  await assert.rejects(handler({}, () => { throw new Error("template failed"); })(request(articleUrl)), /template failed/u);
});

test("directory continuation uses the real cursor and is noindex without dropping crawlable article links", async () => {
  let options;
  const result = await handler({ readDirectory: async value => {
    options = value; return page([article()], { start: 100, end: 101, totalCount: 101 });
  } })(request(`/articles?cursor=${cursor(100)}`));
  assert.equal(result.status, 200); assert.deepEqual(options, { cursor: cursor(100) });
  assert.equal(result.headers["X-Robots-Tag"], "noindex, follow");
  assert.match(result.body, new RegExp(`href="https://publish.proofofwork.me/\\?article=${TX}"`));
  assert.ok(!result.body.includes('rel="canonical"'));
});

test("sitemap enumerates a contiguous checkpoint, deduplicates reboost targets and never caches completion", async () => {
  const seen = [];
  const render = handler({ readDirectory: async ({ cursor: requested }) => {
    seen.push(requested);
    return requested ? page([article(), article(OTHER)], { start: 2, end: 4, totalCount: 4 })
      : page([article()], { end: 2, totalCount: 4, hasMore: true, nextCursor: cursor(2) });
  } });
  const response = await render(request("/articles-sitemap.xml"));
  assert.equal(response.status, 200); assert.equal(response.headers["Content-Type"], "application/xml; charset=utf-8");
  assert.deepEqual(seen, [undefined, cursor(2)]); assert.equal((response.body.match(/<loc>/gu) ?? []).length, 2);
  for (const txid of [TX, OTHER]) assert.ok(response.body.includes(`https://publish.proofofwork.me/?article=${txid}`));
  assert.ok(!response.body.includes("lastmod")); assert.ok(!response.body.includes("reboost"));
  assert.equal((await render(request("/articles-sitemap.xml"))).status, 200); assert.equal(seen.length, 4);
});

test("sitemap rejects gaps, changing checkpoints, conflicting originals, loops and unavailable pages", async () => {
  const first = page([article()], { totalCount: 2, hasMore: true, nextCursor: cursor(1) });
  const next = () => page([article(OTHER)], { start: 1, end: 2, totalCount: 2 });
  for (const modify of [
    value => { value.start = 2; value.end = 3; }, value => { value.totalCount = 3; },
    value => { value.checkpoint = { ...checkpoint, snapshotId: "changed" }; },
    value => { value.checkpoint = { ...checkpoint, hash: OTHER }; },
    value => { value.checkpoint = { ...checkpoint, height: checkpoint.height + 1 }; },
    value => { value.checkpoint = { ...checkpoint, indexedAt: "2026-10-15T12:01:00.000Z" }; },
    value => { value.articles = [{ ...article(), title: "Changed immutable title" }]; },
    value => { value.end = 1; value.articles = []; },
    value => { value.hasMore = true; value.nextCursor = cursor(1); },
    value => { value.nextCursor = cursor(2); },
  ]) {
    const changed = next(); modify(changed); let calls = 0;
    const result = await handler({ readDirectory: async () => ++calls === 1 ? first : changed })(request("/articles-sitemap.xml"));
    assert.equal(result.status, 503, JSON.stringify(changed));
    assert.match(result.headers["X-Robots-Tag"], /noindex/u); assert.ok(!result.body.includes("<urlset"));
  }
  let calls = 0;
  const unavailable = await handler({ readDirectory: async () => {
    if (++calls === 1) return first; throw new Error("upstream unavailable");
  } })(request("/articles-sitemap.xml"));
  assert.equal(unavailable.status, 503); assert.equal(calls, 2);
});

test("sitemap bounds page count and rejects completion beyond its wall-clock deadline", async t => {
  let calls = 0;
  const bounded = await handler({ readDirectory: async () => {
    const start = calls++ * 100;
    return page([article()], { start, end: start + 100, totalCount: 5001, hasMore: true, nextCursor: cursor(start + 100) });
  } })(request("/articles-sitemap.xml"));
  assert.equal(bounded.status, 503); assert.equal(calls, 50);
  let now = 0; t.mock.method(Date, "now", () => now);
  const expired = await handler({ readDirectory: async () => { now = 45_001; return page(); } })(request("/articles-sitemap.xml"));
  assert.equal(expired.status, 503);
});

test("sitemap deadline interrupts an unavailable page and never continues it in the background", async () => {
  let release, calls = 0;
  const pending = new Promise(resolve => { release = resolve; });
  const render = createPublishDocumentHandler({ readTemplate: () => template, sitemapDeadlineMs: 15,
    reader: { readDirectory: async () => { calls++; return pending; } } });
  const response = await render(request("/articles-sitemap.xml"));
  assert.equal(response.status, 503); assert.equal(response.headers["Retry-After"], "30"); assert.equal(calls, 1);
  release(page([article()], { totalCount: 2, hasMore: true, nextCursor: cursor(1) }));
  await tick(); assert.equal(calls, 1);
  for (const sitemapDeadlineMs of [0, -1, 45_001, 1.5, NaN]) {
    assert.throws(() => createPublishDocumentHandler({ reader: {}, readTemplate: () => template, sitemapDeadlineMs }), /deadline/u);
  }
});

test("only ongoing sitemap reads coalesce, and the request ceiling returns bounded retry responses", async () => {
  let release, calls = 0;
  const pending = new Promise(resolve => { release = resolve; });
  const render = handler({ readDirectory: async () => { calls++; await pending; return page(); } });
  const first = render(request("/articles-sitemap.xml")), second = render(request("/articles-sitemap.xml"));
  await tick(); assert.equal(calls, 1); release();
  assert.equal((await first).status, 200); assert.equal((await second).status, 200);
  await render(request("/articles-sitemap.xml")); assert.equal(calls, 2);
  let finish;
  const waiting = new Promise(resolve => { finish = resolve; });
  const busy = handler({ readArticle: async () => { await waiting; return article(); } });
  const readers = Array.from({ length: 32 }, () => busy(request(articleUrl)));
  const rejected = await busy(request(articleUrl));
  assert.equal(rejected.status, 503); assert.equal(rejected.headers["Retry-After"], "30");
  finish(); assert.ok((await Promise.all(readers)).every(result => result.status === 200));
  assert.equal((await busy(request(articleUrl))).status, 200);
});
