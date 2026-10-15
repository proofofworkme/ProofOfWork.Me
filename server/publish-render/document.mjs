import { createHash } from "node:crypto";
import { escapeHtml, serializeJsonLd, resolvePageMetadata, INDEX_ROBOTS, NOINDEX_ROBOTS } from "../../src/app/seoMetadata.mjs";
import { PUBLISH_ORIGIN, PUBLISH_SERVER_CONTENT_ID, PUBLISH_SERVER_METADATA_ID, publishArticleMetadata, publishArticleSeoFacts } from "../../src/app/publishArticleSeo.mjs";
import { publishArticleBodyBytes } from "../../src/shared/protocol/publishArticle.mjs";
import { parsePowDnsText } from "../../src/shared/protocol/boostText.mjs";

// Character references prevent HTML's input preprocessing from folding CRLF.
const exactText = value => escapeHtml(value).replace(/\r/gu, "&#13;");
const HEAD_BLOCK = /<!--proof-seo:start-->[\s\S]*?<!--proof-seo:end-->/u;
const BODY_BLOCK = /<!--proof-seo-body:start-->[\s\S]*?<!--proof-seo-body:end-->/u;
const STYLE = `<style id="publish-server-style">
html[data-publish-server-pending] #root,#publish-server-content~#root{display:none}
#publish-server-content{box-sizing:border-box;width:min(860px,100%);margin:0 auto;padding:24px clamp(20px,4vw,46px) 64px;color:var(--text);font-family:var(--font-ui);overflow-wrap:anywhere}
#publish-server-content nav{display:flex;flex-wrap:wrap;align-items:center;gap:8px 24px;margin-bottom:32px}
#publish-server-content a,#publish-server-content summary{min-height:44px;display:inline-flex;align-items:center;color:inherit}
#publish-server-content h1{font-size:clamp(30px,4vw,47px);font-weight:500;line-height:1.2;letter-spacing:-.035em;margin:0 0 22px;white-space:normal;overflow:visible;text-overflow:clip}
#publish-server-content h2{font-size:24px;font-weight:500;line-height:1.3;white-space:normal;overflow:visible;text-overflow:clip}
#publish-server-content .publish-server-byline,#publish-server-content .publish-server-status,#publish-server-content details{font-size:14px;color:var(--text-muted);line-height:1.7}
#publish-server-content .publish-server-body{white-space:pre-wrap;overflow-wrap:anywhere;font-size:clamp(18px,2vw,21px);line-height:1.85;margin:28px 0}
#publish-server-content .publish-server-body a{display:inline;min-height:0}
#publish-server-content details{margin-top:28px}#publish-server-content code{display:block;overflow-wrap:anywhere;white-space:pre-wrap;margin-top:10px}
#publish-server-content ol{list-style:none;padding:0}#publish-server-content li{border-top:1px solid var(--border);padding:20px 0}#publish-server-content li h2{margin:0 0 8px}#publish-server-content li p{margin:0}
@media(prefers-color-scheme:dark){:root:not([data-theme]):has(#publish-server-content){color-scheme:dark;--bg:#212121;--surface:#2a2a2a;--text:#f1f1ef;--text-muted:#b5b5b2;--border:#414140;--accent:#d4d4d0;--focus-outline:#d4d4d0;--focus:0 0 0 3px #d4d4d035}}
</style>`;

function head(metadata) {
  const tag = (attribute, key, value) => `<meta ${attribute}="${key}" content="${exactText(value)}" />`;
  return [
    `<title>${exactText(metadata.title)}</title>`, tag("name", "description", metadata.description), tag("name", "robots", metadata.robots),
    metadata.canonicalUrl && `<link rel="canonical" href="${escapeHtml(metadata.canonicalUrl)}" />`,
    tag("property", "og:title", metadata.title), tag("property", "og:description", metadata.description),
    metadata.canonicalUrl && tag("property", "og:url", metadata.canonicalUrl),
    tag("property", "og:type", metadata.ogType ?? "website"), tag("property", "og:site_name", metadata.siteName),
    tag("property", "og:image", metadata.imageUrl), tag("property", "og:image:alt", metadata.imageAlt),
    tag("property", "og:image:width", "1200"), tag("property", "og:image:height", "1200"), tag("property", "og:image:type", "image/jpeg"),
    metadata.authorUrl && tag("property", "article:author", metadata.authorUrl),
    metadata.publishedAt && tag("property", "article:published_time", metadata.publishedAt),
    tag("name", "twitter:card", "summary"), tag("name", "twitter:site", "@proofofworkme"),
    tag("name", "twitter:title", metadata.title), tag("name", "twitter:description", metadata.description),
    tag("name", "twitter:image", metadata.imageUrl), tag("name", "twitter:image:alt", metadata.imageAlt),
    ...metadata.structuredData.map(value => `<script type="application/ld+json" data-proof-seo="structured-data">${serializeJsonLd(value)}</script>`),
  ].filter(Boolean).join("\n");
}

function document(template, metadata, content, facts) {
  if (typeof template !== "string" || !HEAD_BLOCK.test(template) || !BODY_BLOCK.test(template) ||
      !/<div\s+id="root"\s*>/u.test(template) || template.includes(`id="${PUBLISH_SERVER_CONTENT_ID}"`)) {
    throw new TypeError("Publish rendering requires a fresh built SEO document template.");
  }
  let output = template.replace(HEAD_BLOCK, () => `<!--proof-seo:start-->\n<!--proof-seo-surface:publish-->\n${head(metadata)}\n<!--proof-seo:end-->`)
    .replace(BODY_BLOCK, "<!--proof-seo-body:start--><!--proof-seo-body:end-->")
    .replace("</head>", `${STYLE}</head>`)
    .replace(/<div\s+id="root"\s*>/u, () => `<main id="${PUBLISH_SERVER_CONTENT_ID}">${content}</main>${facts ? `<script id="${PUBLISH_SERVER_METADATA_ID}" type="application/json">${serializeJsonLd(facts)}</script>` : ""}<div id="root">`);
  if (facts) output = output.replace(/<html\b/u, '<html data-publish-server-pending="true"');
  else output = output.replace(/<script\b[^>]*\btype="module"[^>]*>[\s\S]*?<\/script>/giu, "")
    .replace(/<link\b[^>]*\brel="modulepreload"[^>]*>/giu, "");
  return output;
}

const navigation = `<nav aria-label="Publish"><a href="${PUBLISH_ORIGIN}/">ProofOfWork Publish</a><a href="${PUBLISH_ORIGIN}/articles">All articles</a></nav>`;
const author = facts => `<a rel="author" href="${PUBLISH_ORIGIN}/?profile=${encodeURIComponent(facts.authorAddress)}">${exactText(facts.authorDisplay)}</a>`;
const date = facts => facts.publishedAt ? ` · <time datetime="${facts.publishedAt}">${facts.publishedAt.slice(0, 10)}</time>` : "";

export function renderArticleDocument(template, article) {
  const facts = publishArticleSeoFacts(article);
  const bytes = publishArticleBodyBytes(article.body);
  if (!bytes || bytes.length !== facts.size || createHash("sha256").update(bytes).digest("hex") !== facts.sha256 ||
      !Number.isSafeInteger(article.checkpoint?.height) || article.checkpoint.height <= 0 ||
      !/^[a-f0-9]{64}$/u.test(article.checkpoint?.hash ?? "") || !article.checkpoint.snapshotId) {
    throw new TypeError("Verified article bytes and checkpoint are required.");
  }
  const body = parsePowDnsText(article.body).map(segment => segment.kind === "dns"
    ? `<a href="https://browser.proofofwork.me/?name=${encodeURIComponent(segment.value)}&amp;network=livenet" target="_blank" rel="noopener noreferrer" aria-label="${exactText(segment.text)} (open in Browser, new tab)">${exactText(segment.text)}</a>`
    : exactText(segment.text)).join("");
  return document(template, publishArticleMetadata(facts), `${navigation}<article><h1>${exactText(facts.title)}</h1>
<p class="publish-server-byline">By ${author(facts)}${date(facts)} · Confirmed</p>
<div class="publish-server-body" data-publish-exact-body>${body}</div>
<p class="publish-server-status">Confirmed article text verified at block ${article.checkpoint.height}. Interactive features recheck the confirmed record when JavaScript loads.</p>
<details><summary>Exact article evidence</summary><p>${facts.size} UTF-8 bytes · Verified SHA-256</p><code>${facts.sha256}</code><code>${facts.txid}</code><p>Original author: ${exactText(facts.authorAddress)}</p></details></article>`, facts);
}

export function renderDirectoryDocument(template, directory) {
  if (!Array.isArray(directory?.articles) || !Number.isSafeInteger(directory.start) || directory.start < 0 ||
      !Number.isSafeInteger(directory.end) || directory.end < directory.start || !Number.isSafeInteger(directory.totalCount) ||
      directory.totalCount < directory.end || directory.end - directory.start < directory.articles.length ||
      directory.end - directory.start > 100 || typeof directory.hasMore !== "boolean" ||
      (directory.hasMore && (typeof directory.nextCursor !== "string" || !directory.nextCursor || directory.nextCursor.length > 8192))) {
    throw new TypeError("Complete confirmed article directory is required.");
  }
  const metadata = resolvePageMetadata("publish", `${PUBLISH_ORIGIN}/`);
  Object.assign(metadata, { title: "Articles | ProofOfWork Publish", description: "Read confirmed articles published on ProofOfWork. Open the full text and inspect its exact transaction evidence.",
    canonicalUrl: directory.start === 0 ? `${PUBLISH_ORIGIN}/articles` : null, robots: directory.start === 0 ? INDEX_ROBOTS : NOINDEX_ROBOTS, structuredData: [] });
  const articles = directory.articles.map(publishArticleSeoFacts);
  if (new Set(articles.map(item => item.txid)).size !== articles.length) throw new TypeError("Article directory repeated an original transaction.");
  const content = articles.map(item => `<li><article><h2><a href="${PUBLISH_ORIGIN}/?article=${item.txid}">${exactText(item.title)}</a></h2><p>By ${author(item)}${date(item)} · ${item.size} UTF-8 bytes</p></article></li>`).join("\n");
  return document(template, metadata, `${navigation}<h1>Published articles</h1><p>Confirmed articles with their exact published text and transaction evidence.</p>${articles.length ? `<ol>${content}</ol>` : `<p>${directory.totalCount === 0 ? "No confirmed articles are available in this directory." : "No additional articles are available on this page."}</p>`}${directory.hasMore ? `<a rel="next" href="${PUBLISH_ORIGIN}/articles?cursor=${encodeURIComponent(directory.nextCursor)}">Next articles</a>` : ""}`);
}

export function renderUnavailableDocument(template, { status, message }) {
  const metadata = resolvePageMetadata("publish", `${PUBLISH_ORIGIN}/`);
  const title = status === 404 ? "Article not found" : "Article unavailable";
  Object.assign(metadata, { title: `${title} | ProofOfWork Publish`, description: title, canonicalUrl: null, robots: NOINDEX_ROBOTS, structuredData: [] });
  return document(template, metadata, `${navigation}<h1>${title}</h1><p>${exactText(message || "The confirmed article record is unavailable. Please try again later.")}</p>`);
}

export function renderArticleSitemap(articles) {
  if (!Array.isArray(articles)) throw new TypeError("Confirmed articles are required.");
  const txids = [...new Set(articles.map(item => publishArticleSeoFacts(item).txid))];
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${txids.map(txid => `<url><loc>${PUBLISH_ORIGIN}/?article=${txid}</loc></url>`).join("")}</urlset>\n`;
}
