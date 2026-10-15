#!/usr/bin/env node
// Bounded public-document reads only: no wallet, API, or user-content requests.
import assert from "node:assert/strict";
import { PUBLIC_SEO_SURFACES, SEO_IMAGE_URL } from "../src/app/seoMetadata.mjs";

async function read(url, expectedStatus = 200) {
  const response = await fetch(url, { redirect: "manual", signal: AbortSignal.timeout(20_000), headers: { "User-Agent": "ProofOfWork-SEO-verification/1" } });
  assert.equal(response.status, expectedStatus, `${url}: HTTP status`);
  let bytes = 0;
  const chunks = [];
  for await (const chunk of response.body) {
    bytes += chunk.byteLength;
    if (bytes > 512_000) throw new Error(`${url}: document exceeds verification bound`);
    chunks.push(chunk);
  }
  return { body: Buffer.concat(chunks).toString("utf8"), headers: response.headers };
}

function decodeHtml(value) {
  return value?.replace(/&(amp|lt|gt|quot|#39);/gu, (_, entity) => ({ amp: "&", lt: "<", gt: ">", quot: '"', "#39": "'" })[entity]);
}
function attribute(tag, name) {
  return decodeHtml(new RegExp(`\\b${name}=["']([^"']*)["']`, "iu").exec(tag)?.[1]);
}
function meta(html, key) {
  const tags = [...html.matchAll(/<meta\b[^>]*>/giu)].map(match => match[0]).filter(tag => attribute(tag, "name") === key || attribute(tag, "property") === key);
  assert.equal(tags.length, 1, `Expected one ${key}`);
  return attribute(tags[0], "content");
}
function canonicals(html) {
  return [...html.matchAll(/<link\b[^>]*>/giu)].map(match => match[0]).filter(tag => attribute(tag, "rel") === "canonical").map(tag => attribute(tag, "href"));
}
async function verifySurface(surface) {
  const origin = surface.origin;
  const root = await read(`${origin}/`);
  assert.match(root.headers.get("content-type") ?? "", /text\/html/iu, origin);
  assert.equal(decodeHtml(/<title>(.*?)<\/title>/isu.exec(root.body)?.[1]), surface.title, origin);
  assert.equal(meta(root.body, "description"), surface.description, origin);
  assert.deepEqual(canonicals(root.body), [`${origin}/`], origin);
  assert.equal(meta(root.body, "og:url"), `${origin}/`, origin);
  assert.equal(meta(root.body, "og:image"), SEO_IMAGE_URL, origin);
  assert.equal(meta(root.body, "twitter:title"), surface.title, origin);
  assert.doesNotMatch(meta(root.body, "robots"), /noindex/iu, origin);
  assert.doesNotMatch(root.headers.get("x-robots-tag") ?? "", /noindex/iu, origin);
  assert.match(root.body, /<h1\b[^>]*>[^<]+<\/h1>/u, `${origin}: meaningful initial heading`);
  for (const product of PUBLIC_SEO_SURFACES) assert(root.body.includes(`href="${product.origin}/"`), `${origin}: missing initial ${product.label} link`);
  const records = [...root.body.matchAll(/<script\b[^>]*type="application\/ld\+json"[^>]*>(.*?)<\/script>/gsu)].map(match => JSON.parse(match[1]));
  assert.equal(records.length, 1, `${origin}: structured data`);
  assert(records[0]["@graph"].some(record => record["@type"] === "WebPage" && record.url === `${origin}/`), `${origin}: structured page URL`);
  const robots = await read(`${origin}/robots.txt`);
  assert.match(robots.headers.get("content-type") ?? "", /text\/plain/iu, origin);
  assert(robots.body.includes(`Sitemap: ${origin}/sitemap.xml`), origin);
  assert.doesNotMatch(robots.body, /Disallow:\s*\/\s*$/imu, origin);
  const sitemap = await read(`${origin}/sitemap.xml`);
  assert.match(sitemap.headers.get("content-type") ?? "", /(?:application|text)\/xml/iu, origin);
  assert.deepEqual([...sitemap.body.matchAll(/<loc>([^<]+)<\/loc>/gu)].map(match => match[1]), [`${origin}/`, ...(surface.surface === "publish" ? [`${origin}/articles`] : [])], origin);
  await read(`${origin}/__seo_missing_page__.html`, 404);
  const privateView = await read(`${origin}/?network=testnet`);
  assert.match(meta(privateView.body, "robots"), /noindex/iu, origin);
  assert.match(privateView.headers.get("x-robots-tag") ?? "", /noindex/iu, origin);
  assert.deepEqual(canonicals(privateView.body), [], origin);
  return { surface: surface.surface, title: surface.title, origin, initialHtmlBytes: Buffer.byteLength(root.body) };
}

const results = [];
const queue = [...PUBLIC_SEO_SURFACES];
await Promise.all(Array.from({ length: 3 }, async () => {
  while (queue.length) results.push(await verifySurface(queue.shift()));
}));
const sampleId = "1".repeat(64);
for (const url of [`https://code.proofofwork.me/?repo=${sampleId}`, `https://jobs.proofofwork.me/?job=${sampleId}`, `https://browser.proofofwork.me/tx/${sampleId}`]) {
  const response = await read(url);
  assert.deepEqual(canonicals(response.body), [], `${url}: no incorrect initial product canonical`);
  assert.doesNotMatch(meta(response.body, "robots"), /noindex/iu, url);
  assert.doesNotMatch(response.headers.get("x-robots-tag") ?? "", /noindex/iu, url);
}
const missingArticle = await read(`https://publish.proofofwork.me/?article=${sampleId}&network=livenet`, 404);
assert.match(meta(missingArticle.body, "robots"), /noindex/iu);
assert.deepEqual(canonicals(missingArticle.body), []);
for (const url of ["https://publish.proofofwork.me/write", "https://computer.proofofwork.me/?folder=drafts", "https://computer.proofofwork.me/?social-identity-bridge=1"]) {
  const response = await read(url);
  assert.match(meta(response.body, "robots"), /noindex/iu, url);
  assert.match(response.headers.get("x-robots-tag") ?? "", /noindex/iu, url);
  assert.deepEqual(canonicals(response.body), [], url);
}
assert.equal(new Set(results.map(item => item.title)).size, PUBLIC_SEO_SURFACES.length, "All product titles must be distinct");
console.log(JSON.stringify({ ok: true, checkedAt: new Date().toISOString(), surfaces: results.sort((a, b) => a.surface.localeCompare(b.surface)), publicDetails: 3, missingArticles: 1, privateRoutes: 3 }, null, 2));
