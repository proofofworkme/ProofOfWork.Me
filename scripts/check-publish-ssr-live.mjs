#!/usr/bin/env node
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { writeFile } from "node:fs/promises";
import { chromium } from "@playwright/test";
import { createPublishReader } from "../server/publish-render/reader.mjs";
import { publishArticleMetadata, PUBLISH_ORIGIN } from "../src/app/publishArticleSeo.mjs";

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
async function responseText(path) {
  const response = await fetch(new URL(path, config.origin), { redirect: "error", credentials: "omit", cache: "no-store", signal: AbortSignal.timeout(20_000) });
  const chunks = [];
  let size = 0;
  for await (const chunk of response.body) {
    size += chunk.byteLength;
    if (size > 2 * 1024 ** 2) throw new Error(`Response exceeds 2 MiB: ${path}`);
    chunks.push(Buffer.from(chunk));
  }
  return { response, text: Buffer.concat(chunks).toString("utf8") };
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
    const body = await page.locator("[data-publish-exact-body]").textContent();
    const hash = createHash("sha256").update(body, "utf8").digest("hex");
    check(`${article.txid}: full HTML text preserves exact canonical bytes`, body === article.body && Buffer.byteLength(body) === article.size && hash === article.sha256);
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
    check(`${article.txid}: article body has no automatic external media`, await page.locator('[data-publish-exact-body] img, [data-publish-exact-body] iframe, [data-publish-exact-body] video, [data-publish-exact-body] audio').count() === 0);
    report.articles.push({ txid: article.txid, title: article.title, size: article.size, sha256: hash, checkpoint: article.checkpoint, canonicalUrl: expected.canonicalUrl });
  }
  const absent = await page.goto(`${config.origin}/?article=${"0".repeat(64)}`, { waitUntil: "load", timeout: 30_000 });
  check("unknown article returns honest HTTP404", absent?.status() === 404);
  check("unknown article does not retain body, canonical, or structured data", await page.locator('[data-publish-exact-body], link[rel="canonical"], script[data-proof-seo="structured-data"]').count() === 0);
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
