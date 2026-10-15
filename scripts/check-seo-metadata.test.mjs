import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  PUBLIC_SEO_SURFACES, SEO_SURFACES, escapeHtml, getSurfaceSeo, renderRobots,
  renderSeoHead, renderSeoOverview, renderSitemap, resolveDocumentVariant,
  resolvePageMetadata, resolveSeoRoute, resolveSeoSurface, serializeJsonLd,
} from "../src/app/seoMetadata.mjs";

const TX = "a".repeat(64);
const VERSION = "b".repeat(64);
const route = (surface, path) => resolveSeoRoute({ surface, url: `${getSurfaceSeo(surface).origin}${path}` });

test("every public product and focused release build has one unique SEO definition", () => {
  const links = readFileSync(new URL("../src/app/appLinks.ts", import.meta.url), "utf8");
  const publicOrigins = [...links.matchAll(/export const [A-Z_]+_APP_URL = "(https:\/\/[^"/]+)\/?";/gu)].map(match => match[1]);
  assert.deepEqual(new Set(publicOrigins), new Set(PUBLIC_SEO_SURFACES.map(item => item.origin)));
  assert.equal(PUBLIC_SEO_SURFACES.length, 21);
  assert.equal(new Set(PUBLIC_SEO_SURFACES.map(item => item.title)).size, 21);
  assert.equal(new Set(PUBLIC_SEO_SURFACES.map(item => item.description)).size, 21);
  for (const item of PUBLIC_SEO_SURFACES) {
    assert.ok(item.title.length > 15 && item.title.length <= 80);
    assert.ok(item.description.length >= 80 && item.description.length <= 220);
    assert.ok(item.heading && item.intro && item.label);
    assert.equal(resolveSeoSurface({ hostname: new URL(item.origin).hostname }), item.surface);
  }
});

test("aliases and focused build flags resolve to the canonical public product", () => {
  const aliases = { "proofofwork.me": "landing", "marketplace.proofofwork.me": "marketplace", "tokens.proofofwork.me": "token", "token.proofofwork.me": "token", "domain.proofofwork.me": "dns-launch", "domains.proofofwork.me": "dns-launch", "nft.proofofwork.me": "computer" };
  for (const [hostname, surface] of Object.entries(aliases)) {
    assert.equal(resolveSeoSurface({ hostname }), surface);
    assert.equal(resolvePageMetadata(surface, `https://${hostname}/`).canonicalUrl, `${getSurfaceSeo(surface).origin}/`);
  }
  const builder = readFileSync(new URL("../deploy/publish/build.py", import.meta.url), "utf8");
  const builds = [...builder.matchAll(/'([a-z]+)': \('([a-z]+)', (?:'([^']+)'|(None))\)/gu)];
  assert.equal(builds.length, 21);
  for (const [, , hostname, flag] of builds) {
    const surface = resolveSeoSurface({ hostname: `${hostname}.proofofwork.me` });
    assert.equal(resolveSeoSurface({ env: flag ? { [flag]: "1" } : {} }), surface);
  }
});

test("root metadata has canonical identity, matching social values and parseable truthful JSON-LD", () => {
  for (const item of PUBLIC_SEO_SURFACES) {
    const metadata = resolvePageMetadata(item.surface, `${item.origin}/?utm_source=share&network=livenet`);
    assert.equal(metadata.kind, "root");
    assert.equal(metadata.canonicalUrl, `${item.origin}/`);
    assert.match(metadata.robots, /^index,/u);
    const html = renderSeoHead(item.surface);
    assert.equal([...html.matchAll(/<title>/gu)].length, 1);
    assert.ok(html.includes(`href="${item.origin}/"`));
    assert.match(html, /og:image" content="https:\/\//u);
    assert.match(html, /twitter:site" content="@proofofworkme"/u);
    const json = [...html.matchAll(/<script type="application\/ld\+json"[^>]*>(.*?)<\/script>/gsu)].map(match => JSON.parse(match[1]));
    assert.equal(json.length, 1);
    assert.ok(json[0]["@graph"].some(value => value["@type"] === "WebPage" && value.url === `${item.origin}/`));
    assert.ok(!JSON.stringify(json).includes("aggregateRating"));
    assert.ok(!JSON.stringify(json).includes('"offers"'));
    const intro = renderSeoOverview(item.surface);
    assert.ok(intro.includes(escapeHtml(item.intro)));
    assert.equal([...intro.matchAll(/<a href=/gu)].length, PUBLIC_SEO_SURFACES.length);
  }
});

test("initial query documents never incorrectly canonicalize to a product root", () => {
  for (const variant of ["app", "noindex", "not-found"]) {
    const html = renderSeoHead("publish", { variant });
    assert.doesNotMatch(html, /rel="canonical"|og:url|application\/ld\+json/u);
    assert.equal(/name="robots" content="noindex/u.test(html), variant !== "app");
  }
});

test("public article/job/credit/source references preserve distinct canonical identities", () => {
  assert.equal(route("publish", `/?article=${TX}&network=livenet&utm_campaign=read`).canonicalUrl, `https://publish.proofofwork.me/?article=${TX}`);
  assert.equal(route("jobs", `/?job=${TX}`).canonicalUrl, `https://jobs.proofofwork.me/?job=${TX}`);
  assert.equal(route("token", `/?asset=${TX}`).canonicalUrl, `https://credit.proofofwork.me/?asset=${TX}`);
  const path = "src/a & b.ts";
  const code = route("code", `/?repo=${TX}&path=${encodeURIComponent(path)}&version=${VERSION}`);
  assert.equal(code.kind, "public-detail");
  assert.equal(new URL(code.canonicalUrl).searchParams.get("path"), path);
  assert.equal(new URL(code.canonicalUrl).searchParams.get("version"), VERSION);
  assert.notEqual(code.canonicalUrl, route("code", `/?repo=${TX}`).canonicalUrl);
  assert.equal(route("publish", "/?profile=alice%40proofofwork.me").kind, "public-detail");
  assert.equal(route("publish", "/?profile=alice%40proofofwork.me").canonicalUrl, null);
});

test("Browser keeps current and historical valid transaction/name routes", () => {
  for (const path of [`/tx/${TX}`, `/${TX}`, `/?tx=${TX}`, `/?txid=${TX}`, `/tx/${TX.toUpperCase()}/`]) {
    assert.equal(route("browser", path).canonicalUrl, `https://browser.proofofwork.me/tx/${TX}`);
  }
  for (const path of ["/name/App.Alice.pow", "/app.alice.pow/", "/?name=app.alice.pow"]) {
    assert.equal(route("browser", path).canonicalUrl, "https://browser.proofofwork.me/name/app.alice.pow");
  }
  for (const path of ["/name/a.b.c.pow", "/tx/wrong", "/not-a-page", "/name/-alice.pow", "/tx/alice.pow"]) assert.equal(route("browser", path).kind, "not-found");
  assert.equal(route("browser", `/?txid=${TX}&tx=${TX}`).kind, "private");
  assert.equal(route("browser", `/tx/${TX}?txid=${VERSION}`).canonicalUrl, `https://browser.proofofwork.me/tx/${VERSION}`);
});

test("private, writer, local and test-network state cannot acquire indexable metadata", () => {
  const cases = [["publish", "/write"], ["publish", "/write/"], ["publish", "/?write=1"], ["computer", "/?folder=code"], ["computer", "/?social-identity-bridge=1"], ["pages", "/?draft=private"], ["search", "/?q=anything"], ["jobs", "/?mode=create"], ["publish", `/?article=${TX}&network=testnet4`], ["code", `/?repo=${TX}&repo=${TX}`], ["publish", `/?article=${TX}&unexpected=1`], ["browser", "/pages-runner.html"]];
  for (const [surface, path] of cases) {
    const metadata = resolvePageMetadata(surface, `${getSurfaceSeo(surface).origin}${path}`, { title: "Private draft text", description: "Do not expose this" });
    assert.equal(metadata.kind, "private", path);
    assert.equal(metadata.canonicalUrl, null, path);
    assert.match(metadata.robots, /^noindex,/u, path);
    assert.deepEqual(metadata.structuredData, [], path);
    assert.notEqual(metadata.title, "Private draft text", path);
  }
  assert.equal(resolvePageMetadata("computer", "/?folder=drafts").title, "Drafts | ProofOfWork Computer");
  assert.equal(resolvePageMetadata("computer", "/?folder=custom").title, "Mail | ProofOfWork Computer");
  assert.equal(resolvePageMetadata("publish", "/write").title, "Write an article | ProofOfWork Publish");
});

test("verified detail overrides stay bounded, escaped and isolated from private draft state", () => {
  const raw = "  public\n\narticle  " + "text ".repeat(1000);
  const metadata = resolvePageMetadata("publish", `/?article=${TX}`, { title: 'A </title><script>alert("x")</script>', description: raw });
  assert.ok(metadata.description.length <= 190);
  assert.match(metadata.description, /^public article text/u);
  assert.equal(raw.length > 4000, true);
  assert.equal(resolvePageMetadata("publish", `/?article=${TX}`, { description: " \n " }).description, SEO_SURFACES.publish.description);
  assert.equal(escapeHtml(metadata.title).includes("<script>"), false);
  assert.equal(serializeJsonLd({ title: "</script><script>alert(1)</script>" }).includes("</script>"), false);
  const embedded = resolvePageMetadata("computer", `/?folder=publish&article=${TX}&network=livenet`, { title: "Verified article | ProofOfWork Publish" });
  assert.equal(embedded.title, "Verified article | ProofOfWork Publish");
  assert.equal(embedded.canonicalUrl, null);
  assert.match(embedded.robots, /^noindex,/u);
  assert.deepEqual(embedded.structuredData, []);
  assert.notEqual(resolvePageMetadata("computer", `/?folder=publish&article=${TX}&write=1`, { title: "Private draft" }).title, "Private draft");
});

test("crawl files contain only the canonical host root without invented update dates", () => {
  for (const item of PUBLIC_SEO_SURFACES) {
    assert.match(renderRobots(item.surface), /^User-agent: \*\nAllow: \/\n/u);
    assert.ok(renderRobots(item.surface).includes(`Sitemap: ${item.origin}/sitemap.xml`));
    const xml = renderSitemap(item.surface);
    assert.match(xml, /^<\?xml version="1.0" encoding="UTF-8"\?>/u);
    assert.ok(xml.includes(`<loc>${item.origin}/</loc>`));
    assert.equal([...xml.matchAll(/<url>/gu)].length, 1);
    assert.doesNotMatch(xml.slice(xml.indexOf("<urlset")), /lastmod|priority|changefreq|\?/u);
  }
});

test("local preview selects products without canonicalizing localhost or preview flags", () => {
  assert.equal(resolveSeoSurface({ hostname: "localhost", search: "?publish=1" }), "publish");
  assert.equal(resolvePageMetadata("publish", `http://localhost:4173/?publish=1&article=${TX}`).canonicalUrl, `https://publish.proofofwork.me/?article=${TX}`);
  assert.equal(resolveDocumentVariant("landing", "http://localhost:4173/?landing=1"), "root");
  assert.equal(resolveDocumentVariant("landing", "/?utm_source=share"), "app");
  assert.equal(resolveDocumentVariant("publish", "/write"), "noindex");
  assert.equal(resolveDocumentVariant("landing", "/missing-page"), "not-found");
});
