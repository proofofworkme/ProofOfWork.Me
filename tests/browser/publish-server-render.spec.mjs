import { expect, test } from "@playwright/test";
import { createHash } from "node:crypto";
import { renderArticleDocument, renderDirectoryDocument } from "../../server/publish-render/document.mjs";
import { publishArticleMetadata } from "../../src/app/publishArticleSeo.mjs";

const txid = "a".repeat(64);
const body = '\nExact café 東京 🧭\r\nKeep\rthese spaces.  \nVisit Alice.pow. $WORK #tag @alice\n<script>window.injected = true</script> & &#13; </div><img src="https://evil.test/pixel">\n';
const article = { txid, title: "Exact <article> & source", body, size: Buffer.byteLength(body), sha256: createHash("sha256").update(body).digest("hex"),
  authorAddress: "1BoatSLRHtKNngkdXEeobR76b53LETtpyT", authorDisplay: "Original writer", publishedAt: null,
  checkpoint: { snapshotId: "article-fixture", height: 970000, hash: "b".repeat(64), indexedAt: "2026-10-15T12:00:00.000Z" } };
const post = { txid, article: { v: 1, title: article.title, source: "same-tx-pwm1-message", size: article.size, sha256: article.sha256 },
  articleBody: body, articleVerification: "canonical-same-tx-pwm1-message-v1", confirmed: true, kind: "boost-post", text: article.title,
  authorAddress: article.authorAddress, authorDisplay: article.authorDisplay, currentOwnerAddress: "different-owner",
  createdAt: "2026-10-14T12:00:00.000Z", proofSignalQ8: "54600000000", totalSignalQ8: "54600000000", likeCount: 0, replyCount: 0, reboostCount: 0 };

async function install(page, request, { failure, corrupted = false, chunkFailure = false } = {}) {
  let readFailure = failure;
  const response = await request.get("/?publish=1");
  expect(response.ok()).toBeTruthy();
  const template = await response.text();
  let releaseRead;
  const gate = new Promise(resolve => { releaseRead = resolve; });
  let startedRead;
  const started = new Promise(resolve => { startedRead = resolve; });
  const external = [];
  await page.route("**/*", async route => {
    const url = new URL(route.request().url());
    if (!['127.0.0.1', 'localhost'].includes(url.hostname)) {
      external.push(url.href); return route.abort("blockedbyclient");
    }
    if (route.request().isNavigationRequest() && url.searchParams.has("article")) return route.fulfill({ contentType: "text/html", body: renderArticleDocument(template, article) });
    if (chunkFailure && url.pathname.endsWith("/features/publish/PublishRoot.tsx")) return route.abort("failed");
    if (/^\/(?:test-api\/)?api\//u.test(url.pathname)) {
      if (url.pathname.endsWith("/boost") && url.searchParams.has("detail")) {
        startedRead(); await gate;
        return readFailure ? route.fulfill({ status: readFailure, json: { error: "Confirmed article evidence unavailable in fixture." } }) :
          route.fulfill({ json: { complete: true, snapshotId: "article-fixture", mode: "detail", post: { ...post, articleBody: corrupted ? `${body}changed` : body }, items: [], totalCount: 0, hasMore: false, start: 0 } });
      }
      if (url.pathname.endsWith("/boost")) return route.fulfill({ json: { complete: true, snapshotId: "article-fixture", items: [], totalCount: 0, hasMore: false, start: 0, network: "livenet" } });
      return route.fulfill({ json: { records: [], listings: [], items: [] } });
    }
    return route.continue();
  });
  return { releaseRead, started, external, template, recover: () => { readFailure = undefined; } };
}

test("server text and metadata survive initial JS loading then agree with the independently verified reader", async ({ page, request }) => {
  const fixture = await install(page, request);
  await page.goto(`/?publish=1&article=${txid.toUpperCase()}`);
  await fixture.started;
  const initial = page.locator("[data-publish-exact-body]");
  await expect(initial).toBeVisible();
  expect(await initial.textContent()).toBe(body);
  expect(await page.locator('script[data-proof-seo="structured-data"]').textContent()).toBe(JSON.stringify(publishArticleMetadata(article).structuredData[0]));
  await expect(page).toHaveTitle(`${article.title} | ProofOfWork Publish`);
  await expect(page.locator('meta[property="og:type"]')).toHaveAttribute("content", "article");
  await expect(page.locator('link[rel="canonical"]')).toHaveAttribute("href", `https://publish.proofofwork.me/?article=${txid}`);
  const before = await page.locator('meta[name="description"]').getAttribute("content");
  fixture.releaseRead();
  await expect(page.locator("#publish-server-content")).toHaveCount(0);
  await expect(page.locator(".publish-article-body")).toBeVisible();
  expect(await page.locator(".publish-article-body").textContent()).toBe(body);
  expect(await page.locator('meta[name="description"]').getAttribute("content")).toBe(before);
  expect(JSON.parse(await page.locator('script[data-proof-seo="structured-data"]').textContent())).toEqual(publishArticleMetadata(article).structuredData[0]);
  await expect(page.getByRole("heading", { level: 1 })).toHaveCount(1);
  await expect(page.locator(".publish-byline")).toContainText("Original writer");
  expect(await page.evaluate(() => window.injected)).toBeUndefined();
  expect(fixture.external).toEqual([]);
  await page.evaluate(() => history.pushState({}, "", "/?publish=1&write=1"));
  await expect(page.locator('meta[property="article:author"]')).toHaveCount(0);
  await expect(page.locator('script[data-proof-seo="structured-data"]')).toHaveCount(0);
  await expect(page.locator('link[rel="canonical"]')).toHaveCount(0);
  await expect(page.locator('meta[name="robots"]')).toHaveAttribute("content", /noindex/u);
});

for (const failure of [404, 503, "mismatch"]) {
  test(`failed client verification removes server body and article metadata (${failure})`, async ({ page, request }) => {
    const fixture = await install(page, request, { failure: typeof failure === "number" ? failure : undefined, corrupted: failure === "mismatch" });
    await page.goto(`/?publish=1&article=${txid}`);
    await fixture.started;
    await expect(page.locator("[data-publish-exact-body]")).toBeVisible();
    fixture.releaseRead();
    await expect(page.locator("#publish-server-content")).toHaveCount(0);
    await expect(page.locator(".publish-article-body")).toHaveCount(0);
    await expect(page.locator('[role="alert"]')).toBeVisible();
    await expect(page.locator('script[data-proof-seo="structured-data"]')).toHaveCount(0);
    await expect(page.locator('meta[property="og:type"]')).toHaveAttribute("content", "website");
    await expect(page.locator('meta[name="robots"]')).toHaveAttribute("content", /noindex/u);
    await expect(page.locator('link[rel="canonical"]')).toHaveCount(0);
    await expect(page).not.toHaveTitle(`${article.title} | ProofOfWork Publish`);
    if (failure === 503) {
      fixture.recover();
      await page.getByRole("button", { name: "Retry from first page" }).click();
      await expect(page.locator(".publish-article-body")).toBeVisible();
      await expect(page.locator('meta[name="robots"]')).toHaveAttribute("content", /^index,/u);
      await expect(page.locator('link[rel="canonical"]')).toHaveAttribute("href", `https://publish.proofofwork.me/?article=${txid}`);
      await expect(page.locator('script[data-proof-seo="structured-data"]')).toHaveCount(1);
    }
    expect(fixture.external).toEqual([]);
  });
}

test("a failed lazy reader chunk removes the server article and reports a render failure", async ({ page, request }) => {
  const fixture = await install(page, request, { chunkFailure: true });
  await page.goto(`/?publish=1&article=${txid}`);
  await expect(page.getByRole("heading", { name: "This workspace could not render." })).toBeVisible();
  await expect(page.locator("#publish-server-content")).toHaveCount(0);
  await expect(page.locator('script[data-proof-seo="structured-data"]')).toHaveCount(0);
  expect(fixture.external).toEqual([]);
});

test("without JavaScript the exact article and paginated directory remain readable on mobile", async ({ browser, request }) => {
  const template = await (await request.get("/?publish=1")).text();
  const context = await browser.newContext({ javaScriptEnabled: false, viewport: { width: 320, height: 800 } });
  const page = await context.newPage();
  const base = new URL((await request.get("/?publish=1")).url()).origin;
  const external = [];
  await page.route("**/*", route => {
    const url = new URL(route.request().url());
    if (!['127.0.0.1', 'localhost'].includes(url.hostname)) { external.push(url.href); return route.abort("blockedbyclient"); }
    if (route.request().isNavigationRequest()) return route.fulfill({ contentType: "text/html", body: url.pathname === "/articles"
      ? renderDirectoryDocument(template, { articles: [article], checkpoint: article.checkpoint, start: 0, end: 2, totalCount: 3, hasMore: true, nextCursor: "boost-feed-v1.cursor" })
      : renderArticleDocument(template, article) });
    return route.continue();
  });
  await page.goto(`${base}/?publish=1&article=${txid}`);
  expect(await page.locator("[data-publish-exact-body]").textContent()).toBe(body);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(article.title);
  await expect(page.locator("[data-publish-exact-body] img")).toHaveCount(0);
  await page.goto(`${base}/articles`);
  await expect(page.getByRole("heading", { name: "Published articles" })).toBeVisible();
  await expect(page.getByRole("link", { name: article.title, exact: true })).toHaveAttribute("href", `https://publish.proofofwork.me/?article=${txid}`);
  await expect(page.getByRole("link", { name: "Next articles" })).toHaveAttribute("href", /\/articles\?cursor=boost-feed-v1.cursor$/u);
  await expect(page.locator('script[type="module"]')).toHaveCount(0);
  expect(external).toEqual([]);
  await context.close();
});
