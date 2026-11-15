import assert from "node:assert/strict";
import { createServer } from "node:http";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { createHash } from "node:crypto";
import { test } from "node:test";
import { createPublishReader } from "../server/publish-render/reader.mjs";
import { createPublishDocumentHandler } from "../server/publish-render/handler.mjs";
import { renderRobots } from "../src/app/seoMetadata.mjs";

const run = promisify(execFile);
const txid = "a".repeat(64);
const shortBody = '\nA checked article\r\nwith exact café 🧭 text. <script>bad</script> & &#13;  \n';
const longBody = "x".repeat(16383) + "\r\nA complete article ends here!";
const fixtures = [
  { name: "exact article", body: shortBody, kind: "exact" },
  { name: "partial article with a CRLF boundary and full download", body: longBody, kind: "partial", end: 16383 },
  { name: "partial article with a surrogate boundary and full download", body: "x".repeat(16383) + "🧭 trailing text", kind: "partial", end: 16383 },
  { name: "malformed partial offset", body: longBody, fault: "offset", error: /Partial source range exceeds the bounded view/u },
  { name: "HTML served for the full download", body: longBody, fault: "html-download", error: /Full download content type differs/u },
  { name: "corrupted full download bytes", body: longBody, fault: "download-digest", error: /Full download digest differs/u },
];
const point = { network: "livenet", snapshotId: "fixture-snapshot", indexedThroughBlock: 970000,
  indexedThroughBlockHash: "b".repeat(64), indexedAt: "2026-10-15T12:00:00.000Z" };
const base = { ...point, complete: true, start: 0, end: 0, totalCount: 0, hasMore: false, nextCursor: "", items: [],
  provenance: { ...point, model: "boost-complete-events-v1", eventCount: 1, totalCount: 1, pages: 1 } };
const template = '<!doctype html><html><head><!--proof-seo:start--><title>Publish</title><!--proof-seo:end--></head><body><div id="root"><!--proof-seo-body:start-->Loading<!--proof-seo-body:end--></div></body></html>';

for (const fixture of fixtures) test(`live checker ${fixture.error ? "rejects" : "verifies"} ${fixture.name}`, { timeout: 60_000 }, async () => {
  const body = fixture.body;
  const post = { txid, boostTxid: txid, kind: "boost-post", network: "livenet", confirmed: true,
    authorAddress: "bc1qexampleoriginalauthor", authorDisplay: "Original writer", articleBody: body,
    article: { v: 1, source: "same-tx-pwm1-message", title: "A checked article", size: Buffer.byteLength(body), sha256: createHash("sha256").update(body).digest("hex") },
    articleVerification: "canonical-same-tx-pwm1-message-v1" };
  let documents;
  const server = createServer(async (request, response) => {
    const url = new URL(request.url, "http://localhost");
    if (url.pathname === "/api/v1/boost") {
      response.setHeader("Content-Type", "application/json");
      if (url.searchParams.has("detail")) {
        if (url.searchParams.get("detail") !== txid) { response.statusCode = 404; response.end('{"error":"Not found"}'); return; }
        response.end(JSON.stringify({ ...base, mode: "detail", post })); return;
      }
      response.end(JSON.stringify({ ...base, mode: "timeline", format: "article", sort: "newest", valueWindow: "all", view: "all", source: "proof-indexer-events", end: 1, totalCount: 1, items: [post] })); return;
    }
    if (url.pathname === "/robots.txt") { response.end(renderRobots("publish")); return; }
    const result = await documents({ url, method: request.method });
    if (!result) { response.statusCode = 404; response.end("Not found"); return; }
    if (fixture.fault === "offset" && url.searchParams.has("article") && !url.searchParams.has("download") && result.status === 200) {
      result.body = result.body.replace(/data-source-end="[0-9]+"/u, 'data-source-end="16385"');
    }
    if (url.searchParams.get("download") === "text" && result.status === 200) {
      if (fixture.fault === "html-download") {
        response.writeHead(200, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" });
        response.end('<!doctype html><html><body><div id="root"></div></body></html>'); return;
      }
      if (fixture.fault === "download-digest") {
        result.body = Buffer.from(result.body); result.body[result.body.length - 1] ^= 1;
      }
    }
    response.writeHead(result.status, result.headers); response.end(result.body);
  });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const reader = createPublishReader({ apiOrigin: origin });
  documents = createPublishDocumentHandler({ reader, readTemplate: () => template });
  try {
    let stdout;
    try {
      ({ stdout } = await run(process.execPath, ["scripts/check-publish-ssr-live.mjs", "--origin", origin, "--api-origin", origin], { maxBuffer: 1024 * 1024 }));
      assert.equal(Boolean(fixture.error), false, "Malformed response unexpectedly passed the live checker");
    } catch (error) {
      if (!fixture.error) throw error;
      assert.equal(error.code, 1); stdout = error.stdout;
    }
    const report = JSON.parse(stdout);
    assert.deepEqual(report.blockedExternalRequests, []);
    if (fixture.error) {
      assert.equal(report.failed, 1); assert.match(report.error, fixture.error); assert.equal(report.articles.length, 0);
    } else {
      assert.equal(report.failed, 0); assert.ok(report.passed >= 18);
      assert.equal(report.articles.length, 1); assert.equal(report.articles[0].sha256, post.article.sha256);
      assert.equal(report.articles[0].bodyVerification.kind, fixture.kind);
      assert.equal(report.articles[0].bodyVerification.fullBytes, post.article.size);
      assert.equal(report.articles[0].bodyVerification.fullDownloadVerified, fixture.kind === "partial");
      if (fixture.end) assert.equal(report.articles[0].bodyVerification.sourceEnd, fixture.end);
    }
  } finally {
    reader.close(); server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
  }
});
