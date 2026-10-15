import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { once } from "node:events";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import http from "node:http";
import net from "node:net";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { loadRendererSource, readUiTemplate, startPublishRenderServer } from "./server.mjs";

const TX = "a".repeat(64), COMMIT = "b".repeat(40), TREE = "c".repeat(40);
const sourceFiles = ["server/publish-render/reader.mjs", "server/publish-render/document.mjs",
  "server/publish-render/handler.mjs", "server/publish-render/server.mjs", "src/app/seoMetadata.mjs",
  "src/app/publishArticleSeo.mjs", "src/shared/protocol/publishArticle.mjs", "src/shared/protocol/boostText.mjs"];
const repo = fileURLToPath(new URL("../../", import.meta.url));
const template = '<!doctype html><html><head><!--proof-seo:start--><!--proof-seo-surface:publish--><title>Generic</title><!--proof-seo:end--><script type="module" src="/assets/app.js"></script></head><body><div id="root"><!--proof-seo-body:start--><!--proof-seo-body:end--></div></body></html>';
const ui = { format: "proof-of-work-ui-source-v1", commit: COMMIT, tree: TREE, trackedDirty: false };
const hash = value => createHash("sha256").update(value).digest("hex");
const body = "Exact server-rendered café 東京\r\nKeep these bytes.";
const article = { txid: TX, title: "Confirmed server article", body, size: Buffer.byteLength(body), sha256: hash(body),
  authorAddress: "bc1qoriginalauthor", authorDisplay: "Original writer", publishedAt: null,
  checkpoint: { snapshotId: "confirmed-snapshot", height: 970000, hash: "d".repeat(64), indexedAt: "2026-10-15T12:00:00.000Z" } };
const source = { commit: COMMIT, tree: TREE, files: Object.fromEntries(sourceFiles.map(name => [name, "e".repeat(64)])) };

function temporary(t) {
  const root = mkdtempSync(join(tmpdir(), "pow-publish-render-test-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  return root;
}

function templateFixture(t) {
  const root = temporary(t);
  writeFileSync(join(root, "app.html"), template);
  writeFileSync(join(root, "source-provenance.json"), JSON.stringify(ui));
  return root;
}

function sourceFixture(t) {
  const root = temporary(t), files = {};
  for (const name of sourceFiles) {
    const bytes = readFileSync(join(repo, name));
    mkdirSync(dirname(join(root, name)), { recursive: true }); writeFileSync(join(root, name), bytes);
    files[name] = hash(bytes);
  }
  const manifest = { format: "proof-of-work-publish-render-source-v1", commit: COMMIT, tree: TREE, files };
  const path = join(root, "release.json"); writeFileSync(path, JSON.stringify(manifest));
  return { root, path, manifest };
}

async function freeLoopbackPort() {
  const reservation = net.createServer(); reservation.listen(0, "127.0.0.1");
  await once(reservation, "listening"); const port = reservation.address().port;
  await new Promise((resolve, reject) => reservation.close(error => error ? reject(error) : resolve()));
  return port;
}

async function service(t, reader = {}) {
  const uiRoot = templateFixture(t), port = await freeLoopbackPort();
  let closed = false;
  const server = startPublishRenderServer({ port, uiRoot, source, reader: {
    readArticle: async () => article,
    readDirectory: async () => ({ articles: [article], checkpoint: article.checkpoint,
      start: 0, end: 1, totalCount: 1, hasMore: false, nextCursor: "" }),
    close: () => { closed = true; }, ...reader,
  } });
  await once(server, "listening");
  t.after(async () => {
    if (server.listening) await new Promise((resolve, reject) => {
      server.close(error => error ? reject(error) : resolve()); server.closeAllConnections();
    });
    assert.equal(closed, true, "closing the HTTP server also closes its reader");
  });
  return { server, uiRoot, port };
}

function request(port, path, method = "GET", headers = {}) {
  return new Promise((resolve, reject) => {
    const outgoing = http.request({ host: "127.0.0.1", port, path, method,
      headers: { Connection: "close", ...headers } }, response => {
      const chunks = [];
      response.on("data", chunk => chunks.push(chunk));
      response.on("error", reject);
      response.on("end", () => resolve({ status: response.statusCode, headers: response.headers, body: Buffer.concat(chunks).toString("utf8") }));
    });
    outgoing.on("error", reject); outgoing.end();
  });
}

test("source release manifest binds exactly the eight packaged dependencies and their bytes", t => {
  const fixture = sourceFixture(t);
  const loaded = loadRendererSource(fixture.root, fixture.path);
  assert.deepEqual(loaded, { commit: COMMIT, tree: TREE, files: fixture.manifest.files });
  assert.equal(Object.isFrozen(loaded), true); assert.equal(Object.isFrozen(loaded.files), true);
  for (const mutate of [
    value => { value.format = "other"; }, value => { value.commit = "not-a-commit"; }, value => { value.tree = TREE.toUpperCase(); },
    value => { delete value.files[sourceFiles[0]]; }, value => { value.files["../../outside"] = "e".repeat(64); },
    value => { value.files[sourceFiles[0]] = "e".repeat(64); }, value => { value.files[sourceFiles[0]] = "invalid"; },
  ]) {
    const altered = structuredClone(fixture.manifest); mutate(altered);
    writeFileSync(fixture.path, JSON.stringify(altered));
    assert.throws(() => loadRendererSource(fixture.root, fixture.path));
  }
  writeFileSync(fixture.path, JSON.stringify(fixture.manifest));
  writeFileSync(join(fixture.root, sourceFiles[0]), "changed source bytes");
  assert.throws(() => loadRendererSource(fixture.root, fixture.path), /differs/u);
  writeFileSync(join(fixture.root, sourceFiles[0]), Buffer.alloc(512 * 1024 + 1));
  assert.throws(() => loadRendererSource(fixture.root, fixture.path), /Invalid renderer file/u);
  rmSync(join(fixture.root, sourceFiles[0])); assert.throws(() => loadRendererSource(fixture.root, fixture.path));
  writeFileSync(fixture.path, "{"); assert.throws(() => loadRendererSource(fixture.root, fixture.path));
  writeFileSync(fixture.path, Buffer.alloc(65537)); assert.throws(() => loadRendererSource(fixture.root, fixture.path), /Invalid renderer file/u);
});

test("UI templates require clean valid source provenance, the Publish surface and bounded regular files", t => {
  const root = templateFixture(t);
  assert.deepEqual(readUiTemplate(root), { html: template, ui });
  for (const changed of [{ ...ui, trackedDirty: true }, { ...ui, trackedDirty: undefined }, { ...ui, commit: "invalid" },
    { ...ui, tree: "" }, { ...ui, format: "other" }]) {
    writeFileSync(join(root, "source-provenance.json"), JSON.stringify(changed)); assert.throws(() => readUiTemplate(root));
  }
  writeFileSync(join(root, "source-provenance.json"), JSON.stringify(ui));
  writeFileSync(join(root, "app.html"), template.replace("surface:publish", "surface:computer")); assert.throws(() => readUiTemplate(root));
  writeFileSync(join(root, "app.html"), Buffer.alloc(256 * 1024 + 1)); assert.throws(() => readUiTemplate(root));
  rmSync(join(root, "app.html")); mkdirSync(join(root, "app.html")); assert.throws(() => readUiTemplate(root));
});

test("server rejects external binds and privileged or invalid ports", () => {
  for (const options of [{ host: "0.0.0.0" }, { host: "::" }, { host: "localhost" }, { port: 80 }, { port: 1023 },
    { port: 65536 }, { port: -1 }, { port: 1.5 }, { port: "8084" }]) {
    assert.throws(() => startPublishRenderServer(options), /loopback port/u);
  }
});

test("loopback health publishes source and live UI provenance with noindex and no reader calls", async t => {
  let calls = 0;
  const { server, port } = await service(t, { readArticle: async () => { calls++; return article; } });
  assert.equal(server.address().address, "127.0.0.1");
  for (const path of ["/healthz", "/publish-render-provenance.json"]) {
    const health = await request(port, path);
    assert.equal(health.status, 200); assert.deepEqual(JSON.parse(health.body), {
      format: "proof-of-work-publish-render-source-v1", ok: true, ...source, ui,
    });
    assert.equal(health.headers["cache-control"], "no-store"); assert.equal(health.headers["x-content-type-options"], "nosniff");
    assert.equal(health.headers["x-robots-tag"], "noindex, nofollow");
    const head = await request(port, path, "HEAD"); assert.equal(head.status, 200); assert.equal(head.body, "");
    assert.equal((await request(port, path + "?private=1")).status, 400);
    assert.equal((await request(port, path, "POST")).status, 400);
  }
  assert.equal(calls, 0);
});

test("HTTP article responses and HEAD share verification while method and private routes stay isolated", async t => {
  let calls = 0;
  const { port } = await service(t, { readArticle: async txid => { calls++; assert.equal(txid, TX); return article; } });
  const positive = await request(port, `/?article=${TX}`, "GET", { Host: "untrusted-host.example" });
  assert.equal(positive.status, 200); assert.equal(positive.headers["x-publish-render-source"], COMMIT);
  assert.equal(positive.headers["cache-control"], "no-store"); assert.match(positive.body, /data-publish-exact-body/u);
  assert.ok(positive.body.includes(`https://publish.proofofwork.me/?article=${TX}`)); assert.ok(!positive.body.includes("untrusted-host"));
  const head = await request(port, `/?article=${TX}`, "HEAD");
  assert.equal(head.status, 200); assert.equal(head.body, ""); assert.equal(head.headers["content-type"], positive.headers["content-type"]);
  assert.equal(calls, 2);
  const method = await request(port, `/?article=${TX}`, "POST"); assert.equal(method.status, 405); assert.equal(method.headers.allow, "GET, HEAD");
  for (const path of ["/", "/write", "/app.html", "/unknown", `/?article=${TX}&write=1`, `/?article=${TX}&network=testnet4`, `/?article=${TX}&profile=writer`]) {
    const privateResult = await request(port, path); assert.equal(privateResult.status, 404, path);
    assert.match(privateResult.headers["x-robots-tag"], /noindex/u); assert.ok(!privateResult.body.includes("data-publish-exact-body"));
  }
  assert.equal(calls, 2);
  assert.equal((await request(port, "/articles")).status, 200);
  const sitemap = await request(port, "/articles-sitemap.xml"); assert.equal(sitemap.status, 200);
  assert.equal(sitemap.headers["content-type"], "application/xml; charset=utf-8");
  const long = await request(port, "/" + "x".repeat(12 * 1024)); assert.equal(long.status, 414);
});

test("confirmed missing articles return404 while unavailable evidence returns503 with retry guidance", async t => {
  let failure = Object.assign(new Error("confirmed record missing"), { statusCode: 404 });
  const { port } = await service(t, { readArticle: async () => { throw failure; } });
  const missing = await request(port, `/?article=${TX}`);
  assert.equal(missing.status, 404); assert.equal(missing.headers["retry-after"], undefined);
  assert.ok(!missing.body.includes('rel="canonical"')); assert.ok(!missing.body.includes('application/ld+json'));
  failure = new Error("secret upstream detail");
  const unavailable = await request(port, `/?article=${TX}`);
  assert.equal(unavailable.status, 503); assert.equal(unavailable.headers["retry-after"], "30");
  assert.match(unavailable.headers["x-robots-tag"], /noindex/u); assert.ok(!unavailable.body.includes("secret upstream detail"));
  assert.equal((await request(port, `/?article=${TX}`, "HEAD")).body, "");
});

test("live template provenance failures fail health and documents closed without fetching article content", async t => {
  let calls = 0;
  const { port, uiRoot } = await service(t, { readArticle: async () => { calls++; return article; } });
  for (const invalid of [{ ...ui, trackedDirty: true }, { ...ui, commit: "invalid" }]) {
    writeFileSync(join(uiRoot, "source-provenance.json"), JSON.stringify(invalid));
    for (const path of ["/healthz", "/publish-render-provenance.json", `/?article=${TX}`]) {
      const result = await request(port, path); assert.equal(result.status, 503);
      assert.equal(result.headers["retry-after"], "30"); assert.match(result.headers["x-robots-tag"], /noindex/u);
      assert.ok(!result.body.includes("data-publish-exact-body")); assert.ok(!result.body.includes(COMMIT));
    }
  }
  assert.equal(calls, 0);
  writeFileSync(join(uiRoot, "source-provenance.json"), JSON.stringify(ui));
  writeFileSync(join(uiRoot, "app.html"), template.replace("surface:publish", "surface:computer"));
  assert.equal((await request(port, "/healthz")).status, 503);
  assert.equal((await request(port, `/?article=${TX}`)).status, 503); assert.equal(calls, 0);
  writeFileSync(join(uiRoot, "app.html"), template);
  assert.equal((await request(port, "/healthz")).status, 200);
  assert.equal((await request(port, `/?article=${TX}`)).status, 200); assert.equal(calls, 1);
});
