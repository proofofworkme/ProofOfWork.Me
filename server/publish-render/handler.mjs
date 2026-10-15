import { resolveSeoRoute } from "../../src/app/seoMetadata.mjs";
import { renderArticleDocument, renderDirectoryDocument, renderUnavailableDocument, renderArticleSitemap } from "./document.mjs";

const ORIGIN = "https://publish.proofofwork.me";
const TRACKING = /^(?:utm_[a-z0-9_]+|gclid|fbclid|msclkid)$/iu;
const MAX_CURSOR_LENGTH = 2048;
const MAX_SITEMAP_PAGES = 50;
const SITEMAP_DEADLINE_MS = 45_000;

/** Only public Publish documents enter the renderer. Private app states keep their existing shell. */
export function resolvePublishRenderRequest(value) {
  let url;
  try { url = new URL(value, ORIGIN); } catch { return null; }
  if (["/", "/index.html"].includes(url.pathname)) {
    const policy = resolveSeoRoute({ surface: "publish", url });
    if (policy.kind !== "public-detail" || !url.searchParams.has("article")) return null;
    return { kind: "article", txid: url.searchParams.get("article").toLowerCase() };
  }
  if (!["/articles", "/articles/", "/articles-sitemap.xml"].includes(url.pathname)) return null;
  const kind = url.pathname === "/articles-sitemap.xml" ? "sitemap" : "directory";
  for (const [key, value] of url.searchParams) {
    if (TRACKING.test(key)) continue;
    if (url.searchParams.getAll(key).length !== 1 ||
        !(key === "network" && value === "livenet" || kind === "directory" && key === "cursor" &&
          value.length > 0 && value.length <= MAX_CURSOR_LENGTH && /^boost-feed-v1\.[A-Za-z0-9_-]+$/u.test(value))) {
      return { kind: "invalid" };
    }
  }
  return { kind, cursor: url.searchParams.get("cursor") || undefined };
}

async function completeArticleDirectory(reader, deadlineMs) {
  const started = Date.now();
  const articles = new Map();
  const cursors = new Set();
  let cursor, snapshot, previousEnd = 0, expectedTotal;
  for (let pageNumber = 0; pageNumber < MAX_SITEMAP_PAGES; pageNumber++) {
    const remaining = deadlineMs - (Date.now() - started);
    if (remaining <= 0) throw new Error("Article discovery timed out.");
    let timer;
    // A timed-out page remains bounded by the reader's own request timeout;
    // this enumeration stops here and never starts another background page.
    const page = await Promise.race([
      reader.readDirectory({ cursor }),
      new Promise((_, reject) => { timer = setTimeout(() => reject(new Error("Article discovery timed out.")), remaining); }),
    ]).finally(() => clearTimeout(timer));
    if (Date.now() - started >= deadlineMs) throw new Error("Article discovery timed out.");
    const point = JSON.stringify([page.checkpoint.snapshotId, page.checkpoint.height, page.checkpoint.hash, page.checkpoint.indexedAt]);
    if (!snapshot) { snapshot = point; expectedTotal = page.totalCount; }
    if (point !== snapshot || page.start !== previousEnd || page.totalCount !== expectedTotal ||
        !Number.isSafeInteger(page.end) || page.end < page.start || page.end > page.totalCount) {
      throw new Error("Article discovery changed during pagination.");
    }
    for (const article of page.articles) {
      const previous = articles.get(article.txid);
      if (previous && JSON.stringify(previous) !== JSON.stringify(article)) throw new Error("Article evidence changed during pagination.");
      articles.set(article.txid, article);
    }
    if (articles.size > 5000) throw new Error("Article sitemap exceeds its bounded inventory.");
    if (!page.hasMore) {
      if (page.nextCursor || page.end !== page.totalCount) throw new Error("Article discovery is incomplete.");
      return [...articles.values()];
    }
    if (!page.nextCursor || cursors.has(page.nextCursor) || page.end <= previousEnd) throw new Error("Article discovery did not advance.");
    cursors.add(page.nextCursor);
    cursor = page.nextCursor;
    previousEnd = page.end;
  }
  throw new Error("Article sitemap exceeds its bounded pagination.");
}

/** Shared by the loopback production service and Vite dev/preview. No wallet or local-user state enters this path. */
export function createPublishDocumentHandler({ reader, readTemplate, sitemapDeadlineMs = SITEMAP_DEADLINE_MS }) {
  if (!Number.isSafeInteger(sitemapDeadlineMs) || sitemapDeadlineMs < 1 || sitemapDeadlineMs > SITEMAP_DEADLINE_MS) throw new TypeError("Invalid sitemap deadline.");
  let sitemapInFlight;
  let activeRequests = 0;
  return async function renderRequest({ url, method = "GET" }) {
    const target = resolvePublishRenderRequest(url);
    if (!target) return null;
    const headers = { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" };
    if (!["GET", "HEAD"].includes(method)) return { status: 405, headers: { ...headers, Allow: "GET, HEAD", "X-Robots-Tag": "noindex, nofollow" }, body: "Method not allowed.\n" };
    if (activeRequests >= 32) return { status: 503, headers: { ...headers, "Retry-After": "30", "X-Robots-Tag": "noindex, nofollow" }, body: "Article reader is busy. Please try again.\n" };
    activeRequests++;
    try {
      const template = await readTemplate();
      if (target.kind === "invalid") return { status: 400, headers: { ...headers, "X-Robots-Tag": "noindex, nofollow" }, body: renderUnavailableDocument(template, { status: 400, message: "This article address is not supported." }) };
      try {
        if (target.kind === "article") {
          const article = await reader.readArticle(target.txid);
          return { status: 200, headers, body: renderArticleDocument(template, article) };
        }
        if (target.kind === "directory") {
          const directory = await reader.readDirectory({ cursor: target.cursor });
          if (target.cursor) headers["X-Robots-Tag"] = "noindex, follow";
          return { status: 200, headers, body: renderDirectoryDocument(template, directory) };
        }
        // Share only an ongoing verified enumeration; never retain a completed/stale sitemap.
        if (!sitemapInFlight) sitemapInFlight = completeArticleDirectory(reader, sitemapDeadlineMs).finally(() => { sitemapInFlight = undefined; });
        const articles = await sitemapInFlight;
        return { status: 200, headers: { ...headers, "Content-Type": "application/xml; charset=utf-8" }, body: renderArticleSitemap(articles) };
      } catch (error) {
        const status = target.kind === "article" && error?.statusCode === 404 ? 404 : 503;
        const message = status === 404 ? "A confirmed article was not found at this address." : "Confirmed article evidence is temporarily unavailable. Please try again.";
        return { status, headers: { ...headers, "X-Robots-Tag": "noindex, follow", ...(status === 503 ? { "Retry-After": "30" } : {}) }, body: renderUnavailableDocument(template, { status, message }) };
      }
    } finally { activeRequests--; }
  };
}
