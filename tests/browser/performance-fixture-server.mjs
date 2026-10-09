import { createHash } from "node:crypto";
import { readFile, readdir, realpath, stat } from "node:fs/promises";
import { createServer } from "node:http";
import { extname, relative, resolve, sep } from "node:path";
import { gzipSync } from "node:zlib";

const TYPES = {
  ".css": "text/css; charset=utf-8", ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8", ".json": "application/json",
  ".map": "application/json", ".svg": "image/svg+xml", ".png": "image/png",
  ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".gif": "image/gif",
  ".webp": "image/webp", ".avif": "image/avif", ".ico": "image/x-icon",
  ".woff": "font/woff", ".woff2": "font/woff2", ".txt": "text/plain; charset=utf-8",
};
const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
const inside = (root, path) => path === root || path.startsWith(`${root}${sep}`);

// CLS uses the largest unexpected-shift burst, not a lifetime sum. Retain raw
// entries as well; this value covers only the lab's observed page interval.
export function layoutShiftSessionMaximum(entries) {
  let maximum = 0;
  let sum = 0;
  let first;
  let last;
  for (const entry of entries) {
    if (entry.hadRecentInput) continue;
    if (first !== undefined && entry.startTime - last < 1_000 && entry.startTime - first < 5_000) sum += entry.value;
    else { first = entry.startTime; sum = entry.value; }
    last = entry.startTime;
    maximum = Math.max(maximum, sum);
  }
  return maximum;
}

export function rejectPerformanceFixtureTunnel(request, socket, blocked) {
  const entry = { method: "CONNECT", authority: request.url };
  blocked.push(entry);
  // Chrome may abandon a denied background probe before receiving our reply.
  // This socket leaves HTTP server ownership on CONNECT, so own its errors.
  socket.on("error", (error) => { entry.transportError = error.code || "SOCKET_ERROR"; socket.destroy(); });
  socket.end("HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n");
}

export async function productionBuildEvidence(buildRoot) {
  const root = await realpath(resolve(buildRoot));
  const files = [];
  async function visit(directory) {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const path = resolve(directory, entry.name);
      if (entry.isSymbolicLink()) throw new Error(`Build evidence rejects symlink: ${path}`);
      if (entry.isDirectory()) await visit(path);
      else if (entry.isFile()) {
        const bytes = await readFile(path);
        files.push({ path: relative(root, path), bytes: bytes.length, sha256: sha256(bytes) });
      }
    }
  }
  await visit(root);
  files.sort((a, b) => a.path.localeCompare(b.path));
  const source = JSON.parse(await readFile(resolve(root, "source-provenance.json"), "utf8"));
  if (source.format !== "proof-of-work-ui-source-v1" || !/^[a-f0-9]{40}$/.test(source.commit) || !/^[a-f0-9]{40}$/.test(source.tree)) {
    throw new Error("Performance profile requires exact production-build source provenance.");
  }
  return { root, source, files, manifestSha256: sha256(JSON.stringify(files)) };
}

// Direct HTTP fixtures retain browser caching. The same listener also acts as
// a rejecting proxy: an accidental absolute API origin can never reach it.
// Supply it as BrowserContext.proxy; do not install page/context.route.
export async function startPerformanceFixtureServer({ buildRoot, apiHandler, maxRequests = 20_000 }) {
  const build = await productionBuildEvidence(buildRoot);
  const requests = [];
  const blocked = [];
  const compressed = new Map();
  let origin;
  const server = createServer(async (request, response) => {
    const startedAt = Date.now();
    let url;
    const record = { method: request.method, path: request.url, startedAt };
    if (requests.length >= maxRequests) {
      response.writeHead(429, { "Content-Type": "text/plain", "Cache-Control": "no-store" });
      response.end("Fixture request budget exceeded");
      return;
    }
    requests.push(record);
    const transportClosed = (error) => {
      record.transportError = error.code || "SOCKET_ERROR";
      response.destroy();
    };
    request.on("error", transportClosed);
    response.on("error", transportClosed);
    let finished = false;
    response.once("finish", () => { finished = true; record.completed = true; record.durationMs = Date.now() - startedAt; });
    response.once("close", () => { if (!finished) { record.aborted = true; record.durationMs = Date.now() - startedAt; } });
    function send(status, body, contentType, cacheControl = "no-store", etag) {
      const bytes = Buffer.isBuffer(body) ? body : Buffer.from(body ?? "");
      record.status = status;
      record.contentType = contentType;
      record.decodedBodyBytes = request.method === "HEAD" ? 0 : bytes.length;
      const headers = { "Content-Type": contentType, "Cache-Control": cacheControl, "X-Content-Type-Options": "nosniff" };
      if (etag) headers.ETag = etag;
      if (etag && request.headers["if-none-match"] === etag) {
        record.status = 304; record.encodedBodyBytes = 0;
        response.writeHead(304, headers); response.end(); return;
      }
      let encoded = bytes;
      if (/\bgzip\b/u.test(request.headers["accept-encoding"] || "") && /^(text\/|application\/json)/u.test(contentType)) {
        const key = `${sha256(bytes)}:gzip`;
        if (etag && compressed.size < 256) {
          if (!compressed.has(key)) compressed.set(key, gzipSync(bytes));
          encoded = compressed.get(key);
        } else encoded = gzipSync(bytes);
        headers["Content-Encoding"] = "gzip";
        headers.Vary = "Accept-Encoding";
      }
      headers["Content-Length"] = encoded.length;
      record.encodedBodyBytes = request.method === "HEAD" ? 0 : encoded.length;
      response.writeHead(status, headers);
      response.end(request.method === "HEAD" ? undefined : encoded);
    }
    try {
      url = new URL(request.url, origin);
      record.path = `${url.pathname}${url.search}`;
      if (url.origin !== origin || request.headers.host !== new URL(origin).host) {
        blocked.push({ method: request.method, origin: url.origin });
        send(403, "External origin blocked by fixture proxy", "text/plain"); return;
      }
      if (!["GET", "HEAD"].includes(request.method)) {
        send(405, "Read-only fixture server", "text/plain"); return;
      }
      if (url.pathname.startsWith("/api/v1/")) {
        let fulfilled = false;
        await apiHandler({
          request: () => ({ url: () => url.href, method: () => request.method }),
          fulfill: async ({ body, contentType = "application/json", status = 200 }) => {
            if (fulfilled) throw new Error("Fixture response fulfilled twice");
            fulfilled = true; send(status, body, contentType);
          },
        });
        if (!fulfilled) send(500, "API fixture did not fulfill response", "text/plain");
        return;
      }
      const pathname = decodeURIComponent(url.pathname === "/" ? "/index.html" : url.pathname);
      const file = resolve(build.root, `.${pathname}`);
      if (!inside(build.root, file)) { send(403, "Invalid asset path", "text/plain"); return; }
      let realFile;
      try { realFile = await realpath(file); } catch (error) {
        if (["ENOENT", "ENOTDIR"].includes(error.code)) { send(404, "Asset not found", "text/plain"); return; }
        throw error;
      }
      if (!inside(build.root, realFile) || !(await stat(realFile)).isFile()) {
        send(404, "Asset not found", "text/plain"); return;
      }
      const bytes = await readFile(realFile);
      const immutable = /^\/assets\/[^/]+-[a-zA-Z0-9_-]+\.[a-z0-9]+$/u.test(pathname);
      send(200, bytes, TYPES[extname(realFile)] || "application/octet-stream",
        immutable ? "public, max-age=31536000, immutable" : "no-cache", `"${sha256(bytes)}"`);
    } catch (error) {
      record.error = String(error);
      if (!response.headersSent) send(500, "Fixture server error", "text/plain");
      else response.destroy(error);
    }
  });
  server.on("connect", (request, socket) => rejectPerformanceFixtureTunnel(request, socket, blocked));
  await new Promise((resolveListen, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolveListen);
  });
  origin = `http://127.0.0.1:${server.address().port}`;
  return {
    origin, build, requests, blocked,
    proxy: { server: origin },
    async close() {
      server.closeAllConnections();
      await new Promise((resolveClose, reject) => server.close((error) => error ? reject(error) : resolveClose()));
    },
  };
}
