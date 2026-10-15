import http from "node:http";
import { readFileSync, statSync } from "node:fs";
import { createHash } from "node:crypto";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createPublishReader } from "./reader.mjs";
import { createPublishDocumentHandler } from "./handler.mjs";

const HASH = /^[0-9a-f]{40}$/u;
const FILE_HASH = /^[0-9a-f]{64}$/u;
const SOURCE_FILES = Object.freeze([
  "server/publish-render/reader.mjs", "server/publish-render/document.mjs",
  "server/publish-render/handler.mjs", "server/publish-render/server.mjs",
  "src/app/seoMetadata.mjs", "src/app/publishArticleSeo.mjs",
  "src/shared/protocol/publishArticle.mjs", "src/shared/protocol/boostText.mjs",
]);

function boundedRead(path, limit) {
  if (!statSync(path).isFile() || statSync(path).size > limit) throw new Error("Invalid renderer file.");
  const bytes = readFileSync(path);
  if (bytes.length > limit) throw new Error("Renderer file is too large.");
  return bytes;
}

export function loadRendererSource(root, manifestPath) {
  const manifest = JSON.parse(boundedRead(manifestPath, 65536));
  if (manifest.format !== "proof-of-work-publish-render-source-v1" || !HASH.test(manifest.commit) || !HASH.test(manifest.tree) ||
      !manifest.files || Object.keys(manifest.files).sort().join("\n") !== [...SOURCE_FILES].sort().join("\n")) {
    throw new Error("Invalid renderer source manifest.");
  }
  for (const name of SOURCE_FILES) {
    if (!FILE_HASH.test(manifest.files[name]) || createHash("sha256").update(boundedRead(resolve(root, name), 512 * 1024)).digest("hex") !== manifest.files[name]) {
      throw new Error("Renderer source differs from its release manifest.");
    }
  }
  return Object.freeze({ commit: manifest.commit, tree: manifest.tree, files: Object.freeze(manifest.files) });
}

export function readUiTemplate(root) {
  const provenancePath = resolve(root, "source-provenance.json");
  const before = boundedRead(provenancePath, 4096);
  const html = boundedRead(resolve(root, "app.html"), 256 * 1024).toString("utf8");
  const after = boundedRead(provenancePath, 4096);
  const ui = JSON.parse(after);
  if (!before.equals(after) || ui.format !== "proof-of-work-ui-source-v1" || !HASH.test(ui.commit) ||
      !HASH.test(ui.tree) || ui.trackedDirty !== false || !html.includes("<!--proof-seo-surface:publish-->")) {
    throw new Error("The Publish template has no consistent clean release provenance.");
  }
  return { html, ui };
}

export function startPublishRenderServer({ host = "127.0.0.1", port = 8084, apiOrigin, uiRoot, source, reader: suppliedReader } = {}) {
  if (host !== "127.0.0.1" || !Number.isSafeInteger(port) || port < 1024 || port > 65535) throw new Error("Renderer requires a loopback port.");
  const reader = suppliedReader ?? createPublishReader({ apiOrigin });
  const render = createPublishDocumentHandler({ reader, readTemplate: () => readUiTemplate(uiRoot).html });
  const server = http.createServer({ maxHeaderSize: 16 * 1024 }, async (request, response) => {
    response.setHeader("Cache-Control", "no-store");
    response.setHeader("X-Content-Type-Options", "nosniff");
    const method = request.method ?? "GET";
    const send = (status, headers, body) => {
      if (response.destroyed) return;
      response.writeHead(status, headers);
      response.end(method === "HEAD" ? undefined : body);
    };
    if (!request.url || request.url.length > 12 * 1024) return send(414, { "X-Robots-Tag": "noindex, nofollow", "Content-Type": "text/plain; charset=utf-8" }, "Address is too long.\n");
    try {
      const url = new URL(request.url, "https://publish.proofofwork.me");
      if (["/healthz", "/publish-render-provenance.json"].includes(url.pathname)) {
        if (!["GET", "HEAD"].includes(method) || url.search) return send(400, { "X-Robots-Tag": "noindex, nofollow" }, "Invalid health request.\n");
        const { ui } = readUiTemplate(uiRoot);
        return send(200, { "Content-Type": "application/json; charset=utf-8", "X-Robots-Tag": "noindex, nofollow" }, JSON.stringify({ format: "proof-of-work-publish-render-source-v1", ok: true, ...source, ui }) + "\n");
      }
      const result = await render({ url, method });
      if (!result) return send(404, { "Content-Type": "text/plain; charset=utf-8", "X-Robots-Tag": "noindex, nofollow" }, "Document not found.\n");
      return send(result.status, { ...result.headers, "X-Publish-Render-Source": source.commit }, result.body);
    } catch {
      return send(503, { "Content-Type": "text/plain; charset=utf-8", "X-Robots-Tag": "noindex, nofollow", "Retry-After": "30" }, "The verified article reader is temporarily unavailable.\n");
    }
  });
  server.maxConnections = 64;
  server.requestTimeout = 65_000;
  server.headersTimeout = 10_000;
  server.keepAliveTimeout = 5_000;
  server.maxRequestsPerSocket = 100;
  server.on("close", () => reader.close?.());
  server.listen(port, host);
  return server;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const root = process.env.POW_PUBLISH_RENDER_ROOT;
  const uiRoot = process.env.POW_PUBLISH_RENDER_UI_ROOT;
  const manifest = process.env.POW_PUBLISH_RENDER_MANIFEST;
  if (!root || !uiRoot || !manifest || !process.env.POW_PUBLISH_RENDER_API) throw new Error("Renderer deployment configuration is required.");
  const source = loadRendererSource(root, manifest);
  readUiTemplate(uiRoot);
  const server = startPublishRenderServer({ source, uiRoot,
    host: process.env.POW_PUBLISH_RENDER_HOST || "127.0.0.1",
    port: Number(process.env.POW_PUBLISH_RENDER_PORT || 8084),
    apiOrigin: process.env.POW_PUBLISH_RENDER_API });
  for (const signal of ["SIGTERM", "SIGINT"]) process.once(signal, () => {
    server.close(() => process.exit(0));
    setTimeout(() => { server.closeAllConnections(); process.exit(0); }, 5000).unref();
  });
}
