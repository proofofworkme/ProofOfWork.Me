import { useLayoutEffect, useSyncExternalStore } from "react";
import { detectAppSurface } from "./routeRegistry";
import { NOINDEX_ROBOTS, resolvePageMetadata } from "./seoMetadata.mjs";
import { PUBLISH_SERVER_CONTENT_ID, PUBLISH_SERVER_METADATA_ID, publishArticleMetadata, publishArticleSeoFacts, type PublishArticleSeoFacts } from "./publishArticleSeo.mjs";

const LOCATION_EVENT = "proofofwork:metadata-location";
type Metadata = ReturnType<typeof resolvePageMetadata> & { ogType?: string; authorUrl?: string; publishedAt?: string | null };
type VerifiedMetadata = { title: string; description?: string; article?: PublishArticleSeoFacts };
let initialized = false;
let locationRevision = 0;
let activeView: { owner: symbol; href: string; metadata?: VerifiedMetadata; privateView?: boolean } | undefined;
let serverArticle: { href: string; facts: PublishArticleSeoFacts } | undefined;

/** Removes presentation-only server content. It is never fed into wallet actions. */
export function finishServerArticleRead() {
  serverArticle = undefined;
  document.getElementById(PUBLISH_SERVER_CONTENT_ID)?.remove();
  document.getElementById(PUBLISH_SERVER_METADATA_ID)?.remove();
  document.documentElement.removeAttribute("data-publish-server-pending");
  if (initialized) refreshDocumentMetadata();
}

export function failServerArticleRead() {
  finishServerArticleRead();
  if (detectAppSurface() === "publish" && new URL(window.location.href).searchParams.has("article")) {
    activeView = { owner: Symbol("unavailable article"), href: window.location.href, privateView: true };
    refreshDocumentMetadata();
  }
}

function readServerArticle() {
  const bootstrap = document.getElementById(PUBLISH_SERVER_METADATA_ID);
  if (!bootstrap || !document.getElementById(PUBLISH_SERVER_CONTENT_ID)) {
    if (bootstrap || document.documentElement.hasAttribute("data-publish-server-pending")) finishServerArticleRead();
    return;
  }
  try {
    const facts = publishArticleSeoFacts(JSON.parse(bootstrap.textContent ?? ""));
    const url = new URL(window.location.href);
    const policy = resolvePageMetadata(detectAppSurface(), url);
    if (detectAppSurface() !== "publish" || policy.kind !== "public-detail" ||
        url.searchParams.get("article")?.toLowerCase() !== facts.txid) throw new Error("Server article route changed.");
    serverArticle = { href: window.location.href, facts };
  } catch {
    finishServerArticleRead();
  }
}

function setMeta(attribute: "name" | "property", key: string, content: string) {
  const selector = `meta[${attribute}="${key}"]`;
  const matches = [...document.head.querySelectorAll<HTMLMetaElement>(selector)];
  const meta = matches.shift() ?? document.createElement("meta");
  matches.forEach(item => item.remove());
  meta.setAttribute(attribute, key);
  meta.content = content;
  if (!meta.parentNode) document.head.append(meta);
}

function applyMetadata(metadata: Metadata) {
  document.title = metadata.title;
  setMeta("name", "description", metadata.description);
  setMeta("name", "robots", metadata.robots);
  setMeta("property", "og:title", metadata.title);
  setMeta("property", "og:description", metadata.description);
  setMeta("property", "og:type", metadata.ogType ?? "website");
  for (const [key, content] of [["article:author", metadata.authorUrl], ["article:published_time", metadata.publishedAt]]) {
    if (content) setMeta("property", key!, content);
    else document.head.querySelectorAll(`meta[property="${key}"]`).forEach(item => item.remove());
  }
  setMeta("property", "og:site_name", metadata.siteName);
  setMeta("property", "og:image", metadata.imageUrl);
  setMeta("property", "og:image:alt", metadata.imageAlt);
  setMeta("name", "twitter:card", "summary");
  setMeta("name", "twitter:title", metadata.title);
  setMeta("name", "twitter:description", metadata.description);
  setMeta("name", "twitter:image", metadata.imageUrl);
  setMeta("name", "twitter:image:alt", metadata.imageAlt);
  const canonicals = [...document.head.querySelectorAll<HTMLLinkElement>('link[rel="canonical"]')];
  const canonical = canonicals.shift() ?? document.createElement("link");
  canonicals.forEach(item => item.remove());
  if (metadata.canonicalUrl) {
    canonical.rel = "canonical";
    canonical.href = metadata.canonicalUrl;
    if (!canonical.parentNode) document.head.append(canonical);
    setMeta("property", "og:url", metadata.canonicalUrl);
  } else {
    canonical.remove();
    document.head.querySelectorAll('meta[property="og:url"]').forEach(item => item.remove());
  }
  // Replace only first-party SEO records. User documents remain in their sandbox.
  document.head.querySelectorAll('script[data-proof-seo="structured-data"]').forEach(item => item.remove());
  for (const record of metadata.structuredData) {
    const script = document.createElement("script");
    script.type = "application/ld+json";
    script.dataset.proofSeo = "structured-data";
    script.textContent = JSON.stringify(record);
    document.head.append(script);
  }
}

function refreshDocumentMetadata() {
  const href = window.location.href;
  const view = activeView?.href === href ? activeView : undefined;
  let metadata: Metadata = resolvePageMetadata(detectAppSurface(), href, view?.metadata);
  const facts = view?.metadata?.article ?? (serverArticle?.href === href ? serverArticle.facts : undefined);
  if (facts && metadata.kind === "public-detail" && metadata.canonicalUrl === publishArticleMetadata(facts).canonicalUrl) {
    metadata = publishArticleMetadata(facts);
  }
  if (view?.privateView) {
    metadata.robots = NOINDEX_ROBOTS;
    metadata.canonicalUrl = null;
    metadata.structuredData = [];
  }
  applyMetadata(metadata);
}

/** Set the correct product before its lazy chunk loads; keep native history intact. */
export function initializeDocumentMetadata() {
  if (initialized) return;
  readServerArticle();
  initialized = true;
  const locationChanged = () => {
    // An old record must never describe a newly selected URL while it loads.
    activeView = undefined;
    finishServerArticleRead();
    refreshDocumentMetadata();
    locationRevision++;
    window.dispatchEvent(new Event(LOCATION_EVENT));
  };
  for (const method of ["pushState", "replaceState"] as const) {
    const original = window.history[method];
    window.history[method] = function (...args: Parameters<History[typeof method]>) {
      original.apply(this, args);
      locationChanged();
    };
  }
  window.addEventListener("popstate", locationChanged);
  window.addEventListener("pageshow", event => { if (event.persisted) locationChanged(); });
  window.addEventListener("error", () => { if (serverArticle) failServerArticleRead(); });
  window.addEventListener("unhandledrejection", () => { if (serverArticle) failServerArticleRead(); });
  refreshDocumentMetadata();
}

const subscribe = (listener: () => void) => {
  window.addEventListener(LOCATION_EVENT, listener);
  return () => window.removeEventListener(LOCATION_EVENT, listener);
};
const currentRevision = () => locationRevision;

function descriptionExcerpt(text: string | undefined) {
  if (!text) return undefined;
  const characters = Array.from(text.replace(/\s+/gu, " ").trim());
  return characters.length > 160 ? `${characters.slice(0, 159).join("").trimEnd()}…` : characters.join("");
}

/** Only committed public records may supply detail text; never pass drafts here. */
export function useVerifiedDocumentMetadata({ parameter, id, network, metadata, privateView = false }: {
  parameter: "article" | "repo" | "job";
  id?: string;
  network: string;
  metadata?: VerifiedMetadata;
  privateView?: boolean;
}) {
  const revision = useSyncExternalStore(subscribe, currentRevision, currentRevision);
  const href = window.location.href;
  const title = metadata?.title;
  const description = descriptionExcerpt(metadata?.description);
  const articleKey = metadata?.article ? JSON.stringify(metadata.article) : undefined;
  useLayoutEffect(() => {
    const url = new URL(href);
    const routeMatches = Boolean(id && url.searchParams.get(parameter)?.toLowerCase() === id.toLowerCase() &&
      (url.searchParams.get("network") || "livenet") === network);
    const owner = Symbol("document view");
    activeView = { owner, href, privateView,
      metadata: routeMatches && title && !privateView ? { title, description,
        ...(articleKey ? { article: JSON.parse(articleKey) as PublishArticleSeoFacts } : {}) } : undefined };
    refreshDocumentMetadata();
    return () => {
      if (activeView?.owner === owner) {
        activeView = undefined;
        refreshDocumentMetadata();
      }
    };
  }, [revision, href, parameter, id, network, title, description, privateView, articleKey]);
}

/** Anchor navigation preserves native new-tab behavior and existing local leave guards. */
export function followInternalLink(event: { button: number; metaKey: boolean; ctrlKey: boolean; altKey: boolean; shiftKey: boolean; preventDefault(): void }, navigate: () => void) {
  if (event.button !== 0 || event.metaKey || event.ctrlKey || event.altKey || event.shiftKey) return;
  event.preventDefault();
  navigate();
}
