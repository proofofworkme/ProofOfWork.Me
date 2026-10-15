import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { test } from "node:test";
import { renderArticleDocument, renderDirectoryDocument, renderUnavailableDocument, renderArticleSitemap } from "./document.mjs";
import { publishArticleMetadata, publishArticleSeoFacts } from "../../src/app/publishArticleSeo.mjs";

const template = '<!doctype html><html lang="en"><head><!--proof-seo:start--><title>Generic</title><!--proof-seo:end--><script src="/theme.js"></script><script type="module" src="/assets/app-123.js"></script><link rel="modulepreload" href="/assets/chunk-123.js"><link rel="stylesheet" href="/assets/app-123.css"></head><body><div id="root"><!--proof-seo-body:start--><p>Loading</p><!--proof-seo-body:end--></div></body></html>';
const txid = "a".repeat(64), authorAddress = "bc1qexampleoriginalauthor";
const checkpoint = { height: 970000, hash: "b".repeat(64), snapshotId: "confirmed-snapshot", indexedAt: "2026-10-15T12:00:00.000Z" };
const record = (body = "\nExact café 東京 🧭\r\nKeep\rthese\nspaces.  \n", fields = {}) => ({ txid, title: "Exact article", body,
  size: Buffer.byteLength(body), sha256: createHash("sha256").update(body).digest("hex"), authorAddress,
  authorDisplay: "Original writer", publishedAt: null, checkpoint, ...fields });
const jsonRecord = html => JSON.parse(/<script type="application\/ld\+json" data-proof-seo="structured-data">(.*?)<\/script>/su.exec(html)[1]);

test("article document preserves assets, exact CR entities, original authorship, canonical metadata and one Article schema", () => {
  const article = record();
  const html = renderArticleDocument(template, article);
  assert.match(html, /class="publish-server-body" data-publish-exact-body>\nExact café 東京 🧭&#13;\nKeep&#13;these\nspaces\.  \n<\/div>/u);
  assert.match(html, /<main id="publish-server-content">/u);
  assert.ok(html.indexOf('<main id="publish-server-content">') < html.indexOf('<div id="root">'));
  assert.match(html, /<html data-publish-server-pending="true"/u);
  for (const asset of ["/theme.js", "/assets/app-123.js", "/assets/chunk-123.js", "/assets/app-123.css"]) assert.ok(html.includes(asset));
  assert.equal((html.match(/<title>/gu) || []).length, 1);
  assert.equal((html.match(/data-proof-seo="structured-data"/gu) || []).length, 1);
  assert.match(html, new RegExp(`<link rel="canonical" href="https://publish.proofofwork.me/\\?article=${txid}"`));
  assert.match(html, /property="og:type" content="article"/u);
  assert.deepEqual(jsonRecord(html), publishArticleMetadata(article).structuredData[0]);
  assert.equal(jsonRecord(html).author.identifier, authorAddress);
  assert.equal(jsonRecord(html).datePublished, undefined);
  const bootstrap = JSON.parse(/id="publish-server-metadata" type="application\/json">(.*?)<\/script>/su.exec(html)[1]);
  assert.deepEqual(bootstrap, publishArticleSeoFacts(article));
  assert.equal(bootstrap.body, undefined); assert.equal(bootstrap.checkpoint, undefined);
  assert.equal(bootstrap.currentOwnerAddress, undefined);
  assert.ok(!html.includes("Loading"));
});

test("untrusted title, author and body are escaped without changing exact source text", () => {
  const body = '<script>window.evil=1</script>\r\n& &#13; " \' </div><img src="https://evil.test/track">\u2028\u2029';
  const article = record(body, { title: '</title><script>bad</script>', authorDisplay: '<img src=x onerror="bad">' });
  const html = renderArticleDocument(template, article);
  assert.ok(!html.includes('<script>bad</script>'));
  assert.ok(!html.includes('<script>window.evil'));
  assert.ok(!html.includes('<img src='));
  assert.match(html, /&lt;script&gt;window.evil=1&lt;\/script&gt;&#13;\n&amp; &amp;#13;/u);
  assert.equal(jsonRecord(html).headline, article.title);
  assert.equal(jsonRecord(html).author.name, article.authorDisplay);
  assert.equal(jsonRecord(html).description, publishArticleMetadata(article).description);
  assert.match(html, /\\u003c\/title>/u);
});

test("only lexical .pow references become safe native links and all other text stays literal", () => {
  const html = renderArticleDocument(template, record('Visit Alice.pow and app.alice.pow. $WORK #tag @alice https://evil.test/image.png `code.pow` person@mail.pow\n```\nfenced.pow\n```'));
  const body = /data-publish-exact-body>(.*?)<\/div>/su.exec(html)[1];
  assert.equal((body.match(/<a /gu) || []).length, 2);
  assert.match(body, /name=alice.pow&amp;network=livenet/u);
  assert.match(body, />Alice.pow<\/a>/u);
  assert.match(body, /\$WORK #tag @alice https:\/\/evil.test\/image.png `code.pow` person@mail.pow/u);
  assert.ok(!/<(?:img|iframe|video)\b/u.test(body));
});

test("renderer refuses missing verification, corrupt bodies, bad facts and reused documents", () => {
  for (const article of [record("changed", { size: 1 }), record("changed", { sha256: "0".repeat(64) }), record("ok", { checkpoint: undefined }),
    record("ok", { checkpoint: { ...checkpoint, height: 0 } }), record("a\u0000b"), record("\ud800"), record("ok", { title: "" }),
    record("ok", { txid: "../" }), record("ok", { authorAddress: "" })]) assert.throws(() => renderArticleDocument(template, article));
  assert.throws(() => renderArticleDocument("<html></html>", record()));
  assert.throws(() => renderArticleDocument(renderArticleDocument(template, record()), record()));
});

test("excerpt is bounded by Unicode characters and unknown publication times are omitted", () => {
  const article = record("🧭 ".repeat(200));
  const metadata = publishArticleMetadata(article);
  assert.ok(Array.from(metadata.description).length <= 160);
  assert.ok(!metadata.description.includes("\ufffd"));
  assert.equal(metadata.structuredData[0].datePublished, undefined);
  assert.equal(publishArticleMetadata({ ...article, publishedAt: "not a date" }).structuredData[0].datePublished, undefined);
  assert.equal(publishArticleMetadata({ ...article, publishedAt: "2026-10-14T10:00:00Z" }).structuredData[0].datePublished, "2026-10-14T10:00:00.000Z");
  assert.equal(publishArticleMetadata(record(" \n\t ")).description, "");
});

test("maximum size text is retained completely through worst-case HTML escaping", () => {
  const article = record("<&\r\n'".repeat(20_000));
  assert.equal(article.size, 100_000);
  const html = renderArticleDocument(template, article);
  const body = /data-publish-exact-body>(.*?)<\/div>/su.exec(html)[1];
  assert.equal(body, "&lt;&amp;&#13;\n&#39;".repeat(20_000));
  assert.ok(Buffer.byteLength(html) < 1024 * 1024);
});

test("directory is readable without JavaScript and pagination does not misstate deduped article counts", () => {
  const first = renderDirectoryDocument(template, { articles: [record()], checkpoint, start: 0, end: 2, totalCount: 3, hasMore: true, nextCursor: "boost-feed-v1.abc-_" });
  assert.match(first, /<h1>Published articles<\/h1>/u);
  assert.match(first, new RegExp(`href="https://publish.proofofwork.me/\\?article=${txid}"`));
  assert.match(first, /href="https:\/\/publish.proofofwork.me\/articles\?cursor=boost-feed-v1.abc-_"/u);
  assert.match(first, /rel="canonical" href="https:\/\/publish.proofofwork.me\/articles"/u);
  assert.ok(!first.includes('type="module"')); assert.ok(!first.includes('rel="modulepreload"'));
  assert.ok(first.includes('/theme.js')); assert.ok(first.includes('/assets/app-123.css'));
  assert.ok(!first.includes('of 3')); assert.ok(!first.includes('publish-server-metadata'));
  const next = renderDirectoryDocument(template, { articles: [], checkpoint, start: 2, end: 3, totalCount: 4, hasMore: true, nextCursor: "next" });
  assert.match(next, /No additional articles are available on this page/u);
  assert.match(next, /name="robots" content="noindex, follow"/u);
  assert.ok(!next.includes('rel="canonical"')); assert.ok(!next.includes('property="og:url"'));
  assert.throws(() => renderDirectoryDocument(template, { articles: [record(), record()], start: 0, end: 2, totalCount: 2, hasMore: false }));
});

test("unavailable documents cannot retain content, schema, canonical or executable app modules", () => {
  for (const status of [404, 503]) {
    const html = renderUnavailableDocument(template, { status, message: '<script>bad</script>' });
    assert.match(html, /name="robots" content="noindex, follow"/u);
    assert.ok(!html.includes('rel="canonical"')); assert.ok(!html.includes('property="og:url"'));
    assert.ok(!html.includes('application/ld+json')); assert.ok(!html.includes('type="module"'));
    assert.ok(!html.includes('data-publish-exact-body')); assert.ok(!html.includes('publish-server-metadata'));
    assert.match(html, /&lt;script&gt;bad&lt;\/script&gt;/u);
    assert.match(html, status === 404 ? /Article not found/u : /Article unavailable/u);
  }
});

test("article sitemap contains deduplicated lowercase canonical originals only", () => {
  const xml = renderArticleSitemap([record(), record("same", { txid: txid.toUpperCase() }), record("other", { txid: "c".repeat(64) })]);
  assert.equal((xml.match(/<loc>/gu) || []).length, 2);
  assert.match(xml, new RegExp(`<loc>https://publish.proofofwork.me/\\?article=${txid}</loc>`));
  assert.ok(!xml.includes("lastmod")); assert.ok(!xml.includes("profile="));
  assert.throws(() => renderArticleSitemap([{ txid: "invalid" }]));
});
