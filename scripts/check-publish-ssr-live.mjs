#!/usr/bin/env node
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { writeFile } from "node:fs/promises";
import { chromium } from "@playwright/test";
import { createPublishReader } from "../server/publish-render/reader.mjs";
import { publishArticleMetadata, PUBLISH_ORIGIN } from "../src/app/publishArticleSeo.mjs";
import { READER_PAGE_UNITS, buildReaderModel, verifiedReaderPage } from "../src/shared/protocol/publishReaderPage.mjs";
import { POWCAT_MAX_FILE_BYTES } from "../src/shared/protocol/powcatLimits.mjs";

function options(args) {
  const result = { origin: PUBLISH_ORIGIN, apiOrigin: PUBLISH_ORIGIN, output: null };
  for (let index = 0; index < args.length; index++) {
    const key = { "--origin": "origin", "--api-origin": "apiOrigin", "--output": "output" }[args[index]];
    if (!key || !args[index + 1]) throw new Error("Usage: node scripts/check-publish-ssr-live.mjs [--origin URL] [--api-origin URL] [--output FILE]");
    result[key] = args[++index];
  }
  for (const key of ["origin", "apiOrigin"]) {
    const url = new URL(result[key]);
    assert.ok(["http:", "https:"].includes(url.protocol) && !url.username && !url.password &&
      url.pathname === "/" && !url.search && !url.hash, `${key} must be a plain HTTP(S) origin`);
    result[key] = url.origin;
  }
  return result;
}

const config = options(process.argv.slice(2));
const report = { startedAt: new Date().toISOString(), origin: config.origin, apiOrigin: config.apiOrigin,
  checks: [], articles: [], blockedExternalRequests: [], passed: 0, failed: 0 };
let browser;
const reader = createPublishReader({ apiOrigin: config.apiOrigin });
function check(name, condition, detail) {
  report.checks.push({ name, pass: Boolean(condition), ...(detail ? { detail } : {}) });
  assert.ok(condition, name);
}
async function responseText(path, maxBytes = 2 * 1024 ** 2) {
  assert.ok(Number.isSafeInteger(maxBytes) && maxBytes > 0 && maxBytes <= POWCAT_MAX_FILE_BYTES, "Response bound must stay within the native article limit");
  const response = await fetch(new URL(path, config.origin), { redirect: "error", credentials: "omit", cache: "no-store", signal: AbortSignal.timeout(20_000) });
  const chunks = [];
  let size = 0;
  for await (const chunk of response.body) {
    size += chunk.byteLength;
    if (size > maxBytes) throw new Error(`Response exceeds ${maxBytes} bytes: ${path}`);
    chunks.push(Buffer.from(chunk));
  }
  const bytes = Buffer.concat(chunks);
  return { response, text: bytes.toString("utf8"), bytes };
}

function verifyArticleBodyView(article, view, download) {
  const canonical = Buffer.from(article.body, "utf8");
  assert.equal(canonical.length, article.size, "Canonical article byte count differs");
  assert.equal(createHash("sha256").update(canonical).digest("hex"), article.sha256, "Canonical article digest differs");
  const partial = article.body.length > READER_PAGE_UNITS;
  const expected = verifiedReaderPage(buildReaderModel(article.body));
  assert.equal(view.exactCount, partial ? 0 : 1, "Exact body marker count differs");
  assert.equal(view.partialCount, partial ? 1 : 0, "Partial body marker count differs");
  assert.equal(view.text, partial ? expected.raw : article.body, "HTML text differs from the verified source view");
  if (partial) {
    assert.equal(view.start, "0", "Initial partial view must start at zero");
    assert.match(view.end, /^[1-9][0-9]*$/u, "Partial end must be a canonical positive offset");
    const end = Number(view.end);
    assert.ok(Number.isSafeInteger(end) && end <= READER_PAGE_UNITS && end < article.body.length, "Partial source range exceeds the bounded view");
    assert.equal(view.text.length, end, "Partial rendered UTF-16 length differs from the declared range");
    assert.equal(view.text, article.body.slice(0, end), "Partial text differs from the independent canonical slice");
    assert.ok(!(/[\uD800-\uDBFF]/u.test(article.body[end - 1]) && /[\uDC00-\uDFFF]/u.test(article.body[end])), "Partial boundary splits a surrogate pair");
    assert.ok(!(article.body[end - 1] === "\r" && article.body[end] === "\n"), "Partial boundary splits CRLF");
    assert.equal(view.start, String(expected.start), "Partial start offset differs");
    assert.equal(view.end, String(expected.end), "Partial end offset differs");
    const notice = `Partial reading view: text positions 1–${expected.end} of ${expected.total} (UTF-16 units). The complete verified article contains ${article.size} UTF-8 bytes.`;
    assert.ok(view.notices.some(text => text.includes(notice)), "Partial reading disclosure differs");
    assert.ok(view.downloadHrefs.includes(`/?article=${article.txid}&download=text`), "Full verified download link differs");
    assert.ok(download && Buffer.isBuffer(download.bytes), "Full download bytes are required");
    assert.equal(download.status, 200, "Full download HTTP status differs");
    assert.match(download.contentType, /^text\/plain(?:;|$)/u, "Full download content type differs");
    assert.match(download.cacheControl, /no-store/u, "Full download must not be stored");
    assert.equal(download.contentDisposition, `attachment; filename="proofofwork-article-${article.txid}.txt"`, "Full download disposition differs");
    assert.equal(download.bytes.length, article.size, "Full download byte count differs");
    assert.equal(createHash("sha256").update(download.bytes).digest("hex"), article.sha256, "Full download digest differs");
    assert.ok(download.bytes.equals(canonical), "Full download bytes differ from the verified article");
  } else {
    assert.equal(Buffer.byteLength(view.text), article.size, "Full HTML byte count differs");
    assert.equal(createHash("sha256").update(view.text, "utf8").digest("hex"), article.sha256, "Full HTML digest differs");
  }
  return { kind: partial ? "partial" : "exact", sourceStart: expected.start, sourceEnd: expected.end,
    totalUnits: expected.total, displayedUtf8Bytes: Buffer.byteLength(view.text),
    displayedSha256: createHash("sha256").update(view.text, "utf8").digest("hex"),
    fullBytes: article.size, fullSha256: article.sha256, fullDownloadVerified: partial };
}

try {
  const directory = await reader.readDirectory();
  check("fresh confirmed directory contains an article to verify", directory.articles.length > 0);
  const sitemap = await responseText("/articles-sitemap.xml");
  check("article sitemap returns XML 200 without a stored response", sitemap.response.status === 200 &&
    /application\/xml/u.test(sitemap.response.headers.get("content-type") || "") && /no-store/u.test(sitemap.response.headers.get("cache-control") || ""));
  const locations = [...sitemap.text.matchAll(/<loc>([^<]+)<\/loc>/gu)].map(match => match[1]);
  check("sitemap contains bounded, unique, lowercase canonical article URLs", locations.length > 0 && locations.length <= 5000 &&
    new Set(locations).size === locations.length && locations.every(url => /^https:\/\/publish\.proofofwork\.me\/\?article=[a-f0-9]{64}$/u.test(url)));
  check("sitemap discovers every original on the fresh first directory page", directory.articles.every(article => locations.includes(`${PUBLISH_ORIGIN}/?article=${article.txid}`)));
  const robots = await responseText("/robots.txt");
  check("robots advertises the article sitemap", robots.response.status === 200 && robots.text.includes(`Sitemap: ${PUBLISH_ORIGIN}/articles-sitemap.xml`));

  browser = await chromium.launch({ channel: process.env.POW_PLAYWRIGHT_CHANNEL || "chrome", headless: true });
  const context = await browser.newContext({ javaScriptEnabled: false, viewport: { width: 390, height: 844 } });
  await context.route("**/*", route => {
    const url = new URL(route.request().url());
    if (url.origin !== config.origin) {
      report.blockedExternalRequests.push(url.href);
      return route.abort("blockedbyclient");
    }
    return route.continue();
  });
  const page = await context.newPage();
  const directoryResponse = await page.goto(`${config.origin}/articles`, { waitUntil: "load", timeout: 30_000 });
  check("directory is a public HTML 200", directoryResponse?.status() === 200);
  check("directory is readable without application JavaScript", await page.locator("h1").textContent() === "Published articles" && await page.locator('script[type="module"]').count() === 0);
  check("directory has its own canonical", await page.locator('link[rel="canonical"]').getAttribute("href") === `${PUBLISH_ORIGIN}/articles`);
  const directoryLinks = await page.locator("#publish-server-content a").evaluateAll(anchors => anchors.map(anchor => anchor.getAttribute("href")));
  check("directory exposes native canonical article links", directory.articles.every(article => directoryLinks.includes(`${PUBLISH_ORIGIN}/?article=${article.txid}`)));
  if (directory.hasMore) {
    check("directory exposes its confirmed next cursor", await page.locator('a[rel="next"]').getAttribute("href") === `${PUBLISH_ORIGIN}/articles?cursor=${encodeURIComponent(directory.nextCursor)}`);
  }

  for (const summary of directory.articles.slice(0, 3)) {
    const article = await reader.readArticle(summary.txid);
    const expected = publishArticleMetadata(article);
    const response = await page.goto(`${config.origin}/?article=${article.txid}`, { waitUntil: "load", timeout: 30_000 });
    check(`${article.txid}: initial article is a fresh HTML 200`, response?.status() === 200 && /no-store/u.test(response.headers()["cache-control"] || ""));
    const partial = article.body.length > READER_PAGE_UNITS;
    const bodyLocator = page.locator("[data-publish-exact-body], [data-publish-partial-body]");
    check(`${article.txid}: initial HTML contains one verified body view`, await bodyLocator.count() === 1);
    const view = { text: await bodyLocator.textContent(),
      exactCount: await page.locator("[data-publish-exact-body]").count(),
      partialCount: await page.locator("[data-publish-partial-body]").count(),
      start: await bodyLocator.getAttribute("data-source-start"), end: await bodyLocator.getAttribute("data-source-end"),
      notices: await page.locator(".publish-server-status").allTextContents(),
      downloadHrefs: await page.locator("a[href]").evaluateAll(anchors => anchors.map(anchor => anchor.getAttribute("href"))) };
    let download = null;
    if (partial) {
      const full = await responseText(`/?article=${article.txid}&download=text`, POWCAT_MAX_FILE_BYTES);
      download = { bytes: full.bytes, status: full.response.status,
        contentType: full.response.headers.get("content-type") || "", cacheControl: full.response.headers.get("cache-control") || "",
        contentDisposition: full.response.headers.get("content-disposition") || "" };
    }
    const bodyVerification = verifyArticleBodyView(article, view, download);
    const hash = bodyVerification.fullSha256;
    check(`${article.txid}: ${partial ? "bounded HTML view and full download preserve verified canonical bytes" : "full HTML text preserves exact canonical bytes"}`, true);
    check(`${article.txid}: exact article heading and tab title`, await page.locator("h1").count() === 1 && await page.locator("h1").textContent() === article.title && await page.title() === expected.title);
    const head = await page.locator("head").evaluate(element => ({
      description: [...element.querySelectorAll('meta[name="description"]')].map(meta => meta.content),
      canonical: [...element.querySelectorAll('link[rel="canonical"]')].map(link => link.href),
      robots: [...element.querySelectorAll('meta[name="robots"]')].map(meta => meta.content),
      ogTitle: [...element.querySelectorAll('meta[property="og:title"]')].map(meta => meta.content),
      ogUrl: [...element.querySelectorAll('meta[property="og:url"]')].map(meta => meta.content),
      ogType: [...element.querySelectorAll('meta[property="og:type"]')].map(meta => meta.content),
      twitterTitle: [...element.querySelectorAll('meta[name="twitter:title"]')].map(meta => meta.content),
      schema: [...element.querySelectorAll('script[data-proof-seo="structured-data"]')].map(script => JSON.parse(script.textContent)),
    }));
    check(`${article.txid}: unique metadata matches verified article facts`,
      JSON.stringify(head.description) === JSON.stringify([expected.description]) && JSON.stringify(head.canonical) === JSON.stringify([expected.canonicalUrl]) &&
      JSON.stringify(head.robots) === JSON.stringify([expected.robots]) && JSON.stringify(head.ogTitle) === JSON.stringify([expected.title]) &&
      JSON.stringify(head.ogUrl) === JSON.stringify([expected.canonicalUrl]) && JSON.stringify(head.ogType) === JSON.stringify(["article"]) &&
      JSON.stringify(head.twitterTitle) === JSON.stringify([expected.title]));
    check(`${article.txid}: Article schema attributes the original author without invented dates`, JSON.stringify(head.schema) === JSON.stringify(expected.structuredData));
    check(`${article.txid}: article body has no automatic external media`, await page.locator('[data-publish-exact-body] img, [data-publish-exact-body] iframe, [data-publish-exact-body] video, [data-publish-exact-body] audio, [data-publish-partial-body] img, [data-publish-partial-body] iframe, [data-publish-partial-body] video, [data-publish-partial-body] audio').count() === 0);
    report.articles.push({ txid: article.txid, title: article.title, size: article.size, sha256: hash, checkpoint: article.checkpoint, canonicalUrl: expected.canonicalUrl, bodyVerification });
  }
  const absent = await page.goto(`${config.origin}/?article=${"0".repeat(64)}`, { waitUntil: "load", timeout: 30_000 });
  check("unknown article returns honest HTTP404", absent?.status() === 404);
  check("unknown article does not retain body, canonical, or structured data", await page.locator('[data-publish-exact-body], [data-publish-partial-body], link[rel="canonical"], script[data-proof-seo="structured-data"]').count() === 0);
  check("unknown article is not indexable", /noindex/u.test(await page.locator('meta[name="robots"]').getAttribute("content")) && /noindex/u.test(absent.headers()["x-robots-tag"] || ""));
  check("no off-origin resources were requested", report.blockedExternalRequests.length === 0);
} catch (error) {
  report.error = error instanceof Error ? error.message : String(error);
  if (!report.checks.some(item => !item.pass)) report.checks.push({ name: report.error, pass: false });
  process.exitCode = 1;
} finally {
  reader.close();
  await browser?.close();
  report.completedAt = new Date().toISOString();
  report.passed = report.checks.filter(item => item.pass).length;
  report.failed = report.checks.filter(item => !item.pass).length;
  const output = `${JSON.stringify(report, null, 2)}\n`;
  if (config.output) await writeFile(config.output, output, "utf8");
  process.stdout.write(output);
}
