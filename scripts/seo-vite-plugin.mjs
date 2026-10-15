import { readFileSync, statSync } from "node:fs";
import { resolve, sep } from "node:path";
import {
  escapeHtml, getSurfaceSeo, renderRobots, renderSeoHead, renderSeoOverview,
  renderSitemap, resolveDocumentVariant, resolveSeoSurface,
} from "../src/app/seoMetadata.mjs";

const HEAD_START = "<!--proof-seo:start-->";
const HEAD_END = "<!--proof-seo:end-->";
const BODY_START = "<!--proof-seo-body:start-->";
const BODY_END = "<!--proof-seo-body:end-->";
const HEAD_BLOCK = /<!--proof-seo:start-->[\s\S]*?<!--proof-seo:end-->/u;
const BODY_BLOCK = /<!--proof-seo-body:start-->[\s\S]*?<!--proof-seo-body:end-->/u;

function initialContent(surface, variant) {
  if (variant === "root") return renderSeoOverview(surface);
  const seo = getSurfaceSeo(surface);
  if (variant === "not-found") return `<main class="product-overview"><h1>Page not found</h1><p>This address does not match a ProofOfWork page.</p><a href="${seo.origin}/">Open ${escapeHtml(seo.label)}</a> <a href="https://www.proofofwork.me/">Explore ProofOfWork</a></main>`;
  return `<p role="status">Loading ProofOfWork ${escapeHtml(seo.label)}…</p><noscript><p>This view requires JavaScript. <a href="${seo.origin}/">Open the ${escapeHtml(seo.label)} introduction</a>.</p></noscript>`;
}

/** Reuses the already transformed asset URLs when making alternate documents. */
export function renderSeoDocument(html, surface, variant = "root") {
  const head = `${HEAD_START}\n    <!--proof-seo-surface:${getSurfaceSeo(surface).surface}-->\n    ${renderSeoHead(surface, { variant })}\n    ${HEAD_END}`;
  const body = `${BODY_START}${initialContent(surface, variant)}${BODY_END}`;
  let output = html.includes("<!--proof-seo-head-->") ? html.replace("<!--proof-seo-head-->", head) : html.replace(HEAD_BLOCK, head);
  output = output.includes("<!--proof-seo-root-->") ? output.replace("<!--proof-seo-root-->", body) : output.replace(BODY_BLOCK, body);
  if (variant === "not-found") {
    output = output.replace(/<script\b[^>]*\btype="module"[^>]*>[\s\S]*?<\/script>/giu, "")
      .replace(/<link\b[^>]*\brel="modulepreload"[^>]*>/giu, "")
      .replace('id="root"', 'id="not-found"');
  }
  return output;
}

function realFile(root, pathname) {
  let decoded;
  try { decoded = decodeURIComponent(pathname); } catch { return false; }
  const file = resolve(root, `.${decoded}`);
  if (file !== root && !file.startsWith(`${root}${sep}`)) return false;
  try { return statSync(file).isFile(); } catch { return false; }
}

export function seoPlugin(environment = {}) {
  const buildSurface = resolveSeoSurface({ env: environment, hostname: "computer.proofofwork.me" });
  function install(server, preview) {
    const root = preview ? resolve(server.config.root, server.config.build.outDir) : server.config.root;
    const templatePath = resolve(root, "index.html");
    server.middlewares.use(async (request, response, next) => {
      if (!["GET", "HEAD"].includes(request.method ?? "GET")) return next();
      let url;
      try { url = new URL(request.url ?? "/", `http://${request.headers.host ?? "localhost"}`); } catch { return next(); }
      const pathname = url.pathname;
      if (/^\/(?:api(?:\/|$)|health(?:\/|$))/u.test(pathname)) return next();
      if (!preview && /^\/(?:@|src\/|node_modules\/|__vite)/u.test(pathname)) return next();
      if (pathname === "/pages-runner.html") {
        response.setHeader("X-Robots-Tag", "noindex, nofollow");
        return next();
      }
      let template;
      try { template = readFileSync(templatePath, "utf8"); } catch { return next(); }
      const compiledSurface = /<!--proof-seo-surface:([a-z-]+)-->/u.exec(template)?.[1];
      const focusedSurface = preview && compiledSurface && compiledSurface !== "computer" ? compiledSurface : null;
      const surface = focusedSurface ?? resolveSeoSurface({ hostname: url.hostname, env: environment, search: url.search });
      const send = (body, contentType, status = 200) => {
        response.statusCode = status;
        response.setHeader("Content-Type", contentType);
        response.setHeader("Cache-Control", "no-cache, must-revalidate");
        if (status === 404) response.setHeader("X-Robots-Tag", "noindex, follow");
        response.end(request.method === "HEAD" ? undefined : body);
      };
      if (pathname === "/robots.txt") return send(renderRobots(surface), "text/plain; charset=utf-8");
      if (pathname === "/sitemap.xml") return send(renderSitemap(surface), "application/xml; charset=utf-8");
      const internalDocument = ["/app.html", "/noindex-app.html", "/404.html"].includes(pathname);
      // Real assets keep Vite's ordinary content types and security handling.
      if (!internalDocument && pathname !== "/" && pathname !== "/index.html" && realFile(preview ? root : resolve(root, "public"), pathname)) return next();
      const variant = internalDocument ? ({ "/app.html": "app", "/noindex-app.html": "noindex", "/404.html": "not-found" })[pathname] : resolveDocumentVariant(surface, url);
      let html = renderSeoDocument(template, surface, variant);
      if (variant === "noindex" || internalDocument) response.setHeader("X-Robots-Tag", "noindex, follow");
      if (!preview && variant !== "not-found") {
        try { html = await server.transformIndexHtml(request.url ?? "/", html); }
        catch (error) { return next(error); }
      }
      return send(html, "text/html; charset=utf-8", variant === "not-found" && !internalDocument ? 404 : 200);
    });
  }
  return {
    name: "proof-seo-documents",
    transformIndexHtml: {
      order: "pre",
      handler(html) {
        // The development middleware already selected the request's exact route.
        return html.includes("<!--proof-seo-head-->") ? renderSeoDocument(html, buildSurface) : html;
      },
    },
    configureServer(server) { install(server, false); },
    configurePreviewServer(server) { install(server, true); },
    generateBundle: {
      order: "post",
      handler(_options, bundle) {
        const index = bundle["index.html"];
        if (!index || index.type !== "asset") throw new Error("SEO generation requires the built index.html.");
        const html = String(index.source);
        if (!html.includes(HEAD_START) || !html.includes(BODY_START)) throw new Error("SEO source markers are missing from the built HTML.");
        for (const [fileName, variant] of [["app.html", "app"], ["noindex-app.html", "noindex"], ["404.html", "not-found"]]) this.emitFile({ type: "asset", fileName, source: renderSeoDocument(html, buildSurface, variant) });
        this.emitFile({ type: "asset", fileName: "robots.txt", source: renderRobots(buildSurface) });
        this.emitFile({ type: "asset", fileName: "sitemap.xml", source: renderSitemap(buildSurface) });
      },
    },
  };
}
