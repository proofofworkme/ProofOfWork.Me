import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { request as httpRequest } from "node:http";
import { EventEmitter } from "node:events";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { gunzipSync } from "node:zlib";
import { layoutShiftSessionMaximum, rejectPerformanceFixtureTunnel, startPerformanceFixtureServer } from "../tests/browser/performance-fixture-server.mjs";

async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), "pow-performance-server-test-"));
  await mkdir(join(root, "assets"));
  await writeFile(join(root, "source-provenance.json"), JSON.stringify({
    format: "proof-of-work-ui-source-v1", commit: "a".repeat(40), tree: "b".repeat(40), trackedDirty: false,
  }));
  await writeFile(join(root, "index.html"), "<!doctype html><p>fixture</p>");
  await writeFile(join(root, "assets/app-12345678.js"), "export const fixture = true;");
  const image = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jUxkAAAAASUVORK5CYII=", "base64");
  await writeFile(join(root, "proof.png"), image);
  const server = await startPerformanceFixtureServer({ buildRoot: root,
    apiHandler: async (route) => route.fulfill({ body: JSON.stringify({ fixture: true }) }),
  });
  t.after(async () => { await server.close(); await rm(root, { recursive: true }); });
  return { server, image };
}

test("production fixture serves real public image bytes, correct MIME and missing-asset 404", async (t) => {
  const { server, image } = await fixture(t);
  const response = await fetch(`${server.origin}/proof.png`);
  assert.equal(response.headers.get("content-type"), "image/png");
  assert.deepEqual(Buffer.from(await response.arrayBuffer()), image);
  for (const path of ["/missing-image.png", "/assets/missing.js", "/not-a-route"]) {
    const missing = await fetch(`${server.origin}${path}`);
    assert.equal(missing.status, 404);
    assert.equal(await missing.text(), "Asset not found");
  }
  assert.equal((await fetch(`${server.origin}/assets/app-12345678.js`)).headers.get("cache-control"), "public, max-age=31536000, immutable");
  assert.equal((await fetch(`${server.origin}/api/v1/registry-summary`)).headers.get("cache-control"), "no-store");
  assert.equal((await fetch(`${server.origin}/api/v1/broadcast`, { method: "POST" })).status, 405);
});

function rawRequest(server, options) {
  return new Promise((resolve, reject) => {
    const request = httpRequest({ hostname: "127.0.0.1", port: new URL(server.origin).port, ...options }, (response) => {
      const chunks = [];
      response.on("data", (chunk) => chunks.push(chunk));
      response.on("end", () => resolve({ status: response.statusCode, headers: response.headers, bytes: Buffer.concat(chunks) }));
    });
    request.on("error", reject); request.end();
  });
}

test("fixture preserves gzip/ETag cache behavior and rejects external proxy authority without forwarding", async (t) => {
  const { server } = await fixture(t);
  const encoded = await rawRequest(server, { path: "/assets/app-12345678.js", headers: { "Accept-Encoding": "gzip" } });
  assert.equal(encoded.status, 200);
  assert.equal(encoded.headers["content-encoding"], "gzip");
  assert.equal(gunzipSync(encoded.bytes).toString(), "export const fixture = true;");
  const cached = await rawRequest(server, { path: "/assets/app-12345678.js", headers: { "If-None-Match": encoded.headers.etag } });
  assert.equal(cached.status, 304); assert.equal(cached.bytes.length, 0);
  const forbidden = await rawRequest(server, { path: "http://external.invalid/api/v1/registry", headers: { Host: "external.invalid" } });
  assert.equal(forbidden.status, 403);
  assert.equal(server.blocked.length, 1);
  const traversal = await rawRequest(server, { path: "/%2e%2e%2fsecret" });
  assert.equal(traversal.status, 403);
  const tunnelStatus = await new Promise((resolveTunnel, reject) => {
    const request = httpRequest({ hostname: "127.0.0.1", port: new URL(server.origin).port,
      method: "CONNECT", path: "wallet.proofofwork.me:443" });
    request.once("connect", (response, socket) => { socket.destroy(); resolveTunnel(response.statusCode); });
    request.once("error", reject); request.end();
  });
  assert.equal(tunnelStatus, 403);
  assert.equal(server.blocked.length, 2);
});

test("CLS diagnostics use maximum session windows and exclude recent input", () => {
  const value = layoutShiftSessionMaximum([
    { startTime: 0, value: 0.1 }, { startTime: 900, value: 0.05 },
    { startTime: 2_000, value: 0.2 }, { startTime: 2_600, value: 0.2 },
  ]);
  assert.ok(Math.abs(value - 0.4) < 1e-12);
  assert.ok(Math.abs(layoutShiftSessionMaximum(Array.from({ length: 7 }, (_, i) =>
    ({ startTime: i * 900, value: 0.1 }))) - 0.6) < 1e-12);
  assert.equal(layoutShiftSessionMaximum([{ startTime: 0, value: 0.1 },
    { startTime: 600, value: 9, hadRecentInput: true }, { startTime: 900, value: 0.1 }]), 0.2);
  assert.equal(layoutShiftSessionMaximum([]), 0);
});

test("a client abandoning a denied CONNECT is contained and remains recorded", () => {
  const socket = new EventEmitter();
  let reply = "";
  let destroyed = false;
  socket.end = (value) => { reply = value; };
  socket.destroy = () => { destroyed = true; };
  const blocked = [];
  rejectPerformanceFixtureTunnel({ url: "www.google.com:443" }, socket, blocked);
  const error = Object.assign(new Error("read ECONNRESET"), { code: "ECONNRESET" });
  assert.doesNotThrow(() => socket.emit("error", error));
  assert.equal(destroyed, true);
  assert.match(reply, /^HTTP\/1\.1 403 Forbidden\r\n/u);
  assert.deepEqual(blocked, [{ method: "CONNECT", authority: "www.google.com:443", transportError: "ECONNRESET" }]);
});
