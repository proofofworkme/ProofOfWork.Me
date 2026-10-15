import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { build, createServer, preview } from "vite";
import { seoPlugin } from "./seo-vite-plugin.mjs";
import { getSurfaceSeo, PUBLIC_SEO_SURFACES } from "../src/app/seoMetadata.mjs";

const fixture = async () => {
  const root = await mkdtemp(join(tmpdir(), "pow-seo-test-"));
  const source = await readFile(new URL("../index.html", import.meta.url), "utf8");
  await writeFile(join(root, "index.html"), source.replace("/src/main.tsx", "/entry.js"));
  await writeFile(join(root, "entry.js"), 'document.documentElement.dataset.test = "loaded";');
  await mkdir(join(root, "public"));
  await writeFile(join(root, "public", "real.txt"), "real asset\n");
  await writeFile(join(root, "public", "pages-runner.html"), await readFile(new URL("../public/pages-runner.html", import.meta.url)));
  return root;
};

test("the focused Vite build emits complete SEO artifacts for all 21 production surfaces", async () => {
  const root = await fixture();
  try {
    const builder = await readFile(new URL("../deploy/publish/build.py", import.meta.url), "utf8");
    const builds = [...builder.matchAll(/'([a-z]+)': \('([a-z]+)', (?:'([^']+)'|(None))\)/gu)];
    assert.equal(builds.length, PUBLIC_SEO_SURFACES.length);
    for (const [, name, hostname, flag] of builds) {
      const item = PUBLIC_SEO_SURFACES.find(value => value.origin === `https://${hostname}.proofofwork.me`);
      assert.ok(item, name);
      const outDir = join(root, "builds", name);
      await build({ root, configFile: false, logLevel: "silent", plugins: [seoPlugin(flag ? { [flag]: "1" } : {})], build: { outDir, emptyOutDir: true, minify: false } });
      const [index, app, privateApp, missing, robots, sitemap] = await Promise.all(["index.html", "app.html", "noindex-app.html", "404.html", "robots.txt", "sitemap.xml"].map(file => readFile(join(outDir, file), "utf8")));
      assert.ok(index.includes(`<title>${item.title}</title>`), name);
      assert.ok(index.includes(`href="${item.origin}/"`), name);
      assert.ok(index.includes(item.heading), name);
      assert.match(index, /<script type="module"[^>]+src="\/assets\/[^"/]+-[^"/]+\.js"/u);
      assert.match(app, /<script type="module"[^>]+src="\/assets\/[^"/]+-[^"/]+\.js"/u);
      assert.doesNotMatch(app, /rel="canonical"|application\/ld\+json|og:url/u);
      assert.match(privateApp, /name="robots" content="noindex, follow"/u);
      assert.doesNotMatch(privateApp, /rel="canonical"|application\/ld\+json/u);
      assert.match(missing, /Page not found/u);
      assert.doesNotMatch(missing, /type="module"|id="root"/u);
      assert.ok(robots.includes(`${item.origin}/sitemap.xml`));
      assert.ok(sitemap.includes(`<loc>${item.origin}/</loc>`));
    }
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("Vite dev and preview serve crawl types, valid routes, private headers and real 404s", async () => {
  const root = await fixture();
  const servers = [];
  try {
    const env = { VITE_BROWSER_ONLY: "1" };
    const outDir = join(root, "dist");
    await build({ root, configFile: false, logLevel: "silent", plugins: [seoPlugin(env)], build: { outDir, emptyOutDir: true } });
    const dev = await createServer({ root, configFile: false, logLevel: "silent", plugins: [seoPlugin(env)], server: { host: "127.0.0.1", port: 0, strictPort: true } });
    servers.push(dev); await dev.listen();
    const built = await preview({ root, configFile: false, logLevel: "silent", plugins: [seoPlugin({})], build: { outDir }, preview: { host: "127.0.0.1", port: 0, strictPort: true } });
    servers.push(built);
    for (const server of servers) {
      const address = server.httpServer.address();
      const base = `http://127.0.0.1:${address.port}`;
      const request = async path => { const response = await fetch(`${base}${path}`); return { response, body: await response.text() }; };
      const home = await request("/");
      assert.equal(home.response.status, 200);
      assert.ok(home.body.includes(getSurfaceSeo("browser").title));
      const robots = await request("/robots.txt");
      assert.match(robots.response.headers.get("content-type"), /^text\/plain/u);
      assert.match(robots.body, /browser.proofofwork.me\/sitemap.xml/u);
      const sitemap = await request("/sitemap.xml");
      assert.match(sitemap.response.headers.get("content-type"), /^application\/xml/u);
      assert.match(sitemap.body, /<urlset/u);
      const detail = await request(`/tx/${"a".repeat(64)}`);
      assert.equal(detail.response.status, 200);
      assert.doesNotMatch(detail.body, /rel="canonical"|application\/ld\+json/u);
      const privateView = await request(`/?txid=${"a".repeat(64)}&network=testnet4`);
      assert.equal(privateView.response.status, 200);
      assert.match(privateView.response.headers.get("x-robots-tag"), /noindex/u);
      const indexedPrivate = await request("/index.html?write=1");
      assert.equal(indexedPrivate.response.status, 200);
      assert.doesNotMatch(indexedPrivate.body, /rel="canonical"/u);
      assert.match(indexedPrivate.response.headers.get("x-robots-tag"), /noindex/u);
      const unknown = await request("/definitely-not-a-page");
      assert.equal(unknown.response.status, 404);
      assert.match(unknown.body, /Page not found/u);
      assert.doesNotMatch(unknown.body, /type="module"/u);
      for (const path of ["/.missing-file", "/assets/not-present.js?q=anything", "/missing.css?network=testnet4"]) {
        const missingAsset = await request(path);
        assert.equal(missingAsset.response.status, 404, path);
        assert.doesNotMatch(missingAsset.body, /id="root"/u, path);
      }
      for (const file of ["app.html", "noindex-app.html", "404.html"]) {
        const asset = await request(`/${file}`);
        assert.equal(asset.response.status, 200);
        assert.match(asset.response.headers.get("x-robots-tag"), /noindex/u);
      }
      assert.equal((await request("/real.txt")).body, "real asset\n");
      assert.equal((await request("/real.txt?unknown=1")).body, "real asset\n");
      assert.match((await request("/pages-runner.html")).response.headers.get("x-robots-tag"), /noindex, nofollow/u);
    }
  } finally {
    for (const server of servers) {
      if (server.close) await server.close();
      else await new Promise(resolve => server.httpServer.close(resolve));
    }
    await rm(root, { recursive: true, force: true });
  }
});
