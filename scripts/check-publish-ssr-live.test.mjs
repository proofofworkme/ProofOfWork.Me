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
const txid = "a".repeat(64), body = '\nA checked article\r\nwith exact café 🧭 text. <script>bad</script> & &#13;  \n';
const point = { network: "livenet", snapshotId: "fixture-snapshot", indexedThroughBlock: 970000,
  indexedThroughBlockHash: "b".repeat(64), indexedAt: "2026-10-15T12:00:00.000Z" };
const post = { txid, boostTxid: txid, kind: "boost-post", network: "livenet", confirmed: true,
  authorAddress: "bc1qexampleoriginalauthor", authorDisplay: "Original writer", articleBody: body,
  article: { v: 1, source: "same-tx-pwm1-message", title: "A checked article", size: Buffer.byteLength(body), sha256: createHash("sha256").update(body).digest("hex") },
  articleVerification: "canonical-same-tx-pwm1-message-v1" };
const base = { ...point, complete: true, start: 0, end: 0, totalCount: 0, hasMore: false, nextCursor: "", items: [],
  provenance: { ...point, model: "boost-complete-events-v1", eventCount: 1, totalCount: 1, pages: 1 } };
const template = '<!doctype html><html><head><!--proof-seo:start--><title>Publish</title><!--proof-seo:end--></head><body><div id="root"><!--proof-seo-body:start-->Loading<!--proof-seo-body:end--></div></body></html>';

test("live checker verifies a full bounded fixture release without JavaScript or external traffic", { timeout: 60_000 }, async () => {
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
    response.writeHead(result.status, result.headers); response.end(result.body);
  });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const reader = createPublishReader({ apiOrigin: origin });
  documents = createPublishDocumentHandler({ reader, readTemplate: () => template });
  try {
    const { stdout } = await run(process.execPath, ["scripts/check-publish-ssr-live.mjs", "--origin", origin, "--api-origin", origin], { maxBuffer: 1024 * 1024 });
    const report = JSON.parse(stdout);
    assert.equal(report.failed, 0); assert.ok(report.passed >= 18);
    assert.equal(report.articles.length, 1); assert.equal(report.articles[0].sha256, post.article.sha256);
    assert.deepEqual(report.blockedExternalRequests, []);
  } finally {
    reader.close(); server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
  }
});
