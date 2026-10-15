/** Public presentation only. This catalog never supplies chain or wallet authority. */
const records = [
  ["landing", "Home", "www", "ProofOfWork.Me | The on-chain computer", "Use the ProofOfWork Computer for on-chain identity, mail, files, publishing, applications and public records. Review transactions and sign locally.", "The ProofOfWork Computer", "ProofOfWork.Me brings identity, mail, files, publishing, applications and public records into one local-first computer. Confirmed chain records provide evidence that people and agents can inspect. Wallet signing stays local."],
  ["computer", "Computer", "computer", "ProofOfWork Computer | Mail, files and applications", "Open the ProofOfWork Computer for mail, files, identity, publishing and connected workspaces. Keep local drafts and review transactions before wallet signing.", "Mail, files and applications in one computer", "Computer brings the ProofOfWork applications into a shared workspace with mail, files, local drafts and connected tools. Review exact transaction details before signing with your local wallet."],
  ["id-launch", "ID", "id", "ProofOfWork IDs | Claim your on-chain identity", "Claim a ProofOfWork ID, inspect confirmed registrations and choose its receiving address. Registration uses the canonical on-chain registry and local signing.", "Claim your ProofOfWork ID", "Register a human-readable ProofOfWork ID that resolves to a receiving address. Confirmed registry records establish ownership; registration is reviewed and signed locally. Manage existing IDs in Computer and trade them in AMO."],
  ["dns-launch", "DNS", "dns", "ProofOfWork DNS | Claim and manage .pow names", "Claim and search .pow names, manage owner-controlled subdomains and inspect verified page links through the ProofOfWork DNS registry.", "Names and page links on ProofOfWork", "ProofOfWork DNS provides .pow names, owner-controlled subdomains and confirmed page links. Inspect the registry, claim an available name and manage its records with local wallet signing."],
  ["desktop", "Desktop", "desktop", "ProofOfWork Desktop | Explore public verified files", "Search an address or confirmed ProofOfWork ID to explore public files and inspect their transaction evidence. File content is verified against its chain record.", "Explore public files by address", "Desktop is a public view of confirmed files associated with an address or ProofOfWork ID. Inspect file content and its transaction evidence without connecting a wallet."],
  ["browser", "Browser", "browser", "ProofOfWork Browser | Read verified pages and apps", "Open verified HTML pages by transaction ID or .pow name. Inspect their source and proof, with static viewing and an isolated option to run supported apps.", "Read verified pages and applications", "Browser opens HTML messages and verified attachments from ProofOfWork transactions and confirmed .pow page links. Static viewing is the default; running supported inline apps requires an explicit choice in an isolated environment."],
  ["pages", "Pages", "pages", "ProofOfWork Pages | Create and publish HTML pages", "Create HTML pages and apps, preview local drafts and prepare publication through ProofOfWork Mail and Files. Connect confirmed pages to owner-controlled .pow names.", "Create and publish HTML pages", "Pages provides local drafts, source editing and isolated previews for HTML pages and applications. Publication uses the existing Mail and Files review flow, with optional links from owner-controlled .pow names."],
  ["boost", "Boost", "boost", "ProofOfWork Boost | Proof-ranked posts and people", "Explore ProofOfWork posts, profiles and public conversations ranked by proof signal or time. Publish and interact through locally signed on-chain records.", "Posts and people with proof", "Boost presents public posts, profiles and conversations recorded on ProofOfWork. Read their confirmed evidence, explore proof-ranked activity and review any paid interaction before local wallet signing."],
  ["publish", "Publish", "publish", "ProofOfWork Publish | Read and publish on-chain articles", "Read verified public articles and write with local drafts on ProofOfWork. Articles share profiles, replies and proof signals with Boost.", "Read and publish on-chain articles", "Publish is the long-form writing and reading surface for ProofOfWork. Articles use verified public transaction content and share identity and conversation with Boost; unpublished drafts remain local."],
  ["search", "Search", "search", "ProofOfWork Search | Discover public chain records", "Search ProofOfWork protocols, public content, files and transaction evidence. Inspect confirmation, validity and coverage alongside each result.", "Discover public ProofOfWork records", "Search brings together public protocol records, content, files and transaction evidence. Its results expose confirmation, validity and coverage so an indexed match is not mistaken for verified authority."],
  ["code", "Code", "code", "ProofOfWork Code | Public source and verified history", "Explore public source repositories with wallet ownership, exact file contents and confirmed revision history recorded on ProofOfWork.", "Public source with verifiable history", "Code provides public source repositories with an address owner, exact file contents and confirmed revision history. Inspect source and its evidence, or prepare a reviewed commit using your local wallet."],
  ["jobs", "Jobs", "jobs", "ProofOfWork Jobs | Work briefs and payment receipts", "Explore public work briefs, proposed scope, delivery evidence and payment receipts. Commission and deliver work in proofs or canonical WORK credit.", "Work briefs, delivery and payment evidence", "Jobs connects public briefs, proposed scope and reward, assignment, delivery and client acceptance. Direct payment receipts provide inspectable evidence; an offered reward is a promise, not escrow."],
  ["permission", "Permission", "permission", "ProofOfWork Permission | Wallet-bound agent grants", "Inspect and manage wallet-bound on-chain agent permission grants. Review scope, budgets, lifecycle and verified authority before local signing.", "Inspect wallet-bound agent permissions", "Permission lets owners inspect and manage on-chain agent grants, including their scope, budgets and lifecycle. Confirmed evidence establishes authority; creating a grant requires owner review and local signing."],
  ["marketplace", "AMO", "amo", "ProofOfWork AMO | On-chain asset markets", "Explore ProofOfWork AMO listings, seals and sales for IDs, .pow names, credits, bonds and Boost records. Inspect exact terms before local wallet settlement.", "Markets with inspectable sale terms", "AMO is the Autonomous Money Organization surface for ProofOfWork asset markets. Inspect listings, sealed terms and sales for supported assets, with exact transaction review and local wallet signing."],
  ["token", "Credit", "credit", "ProofOfWork Credit | Create and mint on-chain credits", "Explore, create and mint ProofOfWork credits through their owner registries. Inspect supply rules, mint terms and confirmed transaction history.", "Create and inspect ProofOfWork credits", "Credit provides public credit definitions, supply rules and mint terms. Creators define their registry and terms; users review the corresponding transaction before signing locally."],
  ["wallet", "Wallet", "wallet", "ProofOfWork Wallet | Credits, bonds and transfers", "Review ProofOfWork credit and bond balances, transfer owned assets and manage sale tickets. Wallet authority and transaction signing stay local.", "Balances, transfers and sale tickets", "Wallet brings together credit and bond balances, transfers and sale-ticket history. Confirmed records determine balances, and every transaction remains under local wallet review and signing."],
  ["work", "WORK", "work", "ProofOfWork WORK | Supply, network value and floor", "Inspect canonical WORK supply, holders, network-value floor, AMO units and confirmed history. Distinguish mint terms, floor values and pending activity.", "Inspect the WORK dashboard", "The WORK dashboard presents canonical supply, holders, network value, floor calculations and confirmed history. Mint terms, derived values and pending activity remain separately identified."],
  ["infinity", "Infinity", "infinity", "ProofOfWork Infinity | POWB bonds and market", "Create and inspect Infinity Bonds, confirmed POWB balances and their sale-ticket market. Review bond payments and transaction evidence with local signing.", "Infinity Bonds and POWB", "Infinity provides the bond composer, confirmed POWB balances and the associated sale-ticket market. Inspect the underlying proof payments and confirmed transaction evidence before acting."],
  ["inception", "Inception", "inception", "ProofOfWork Inception | INCB bonds and market", "Create and inspect Inception Bonds, confirmed INCB balances and their sale-ticket market. Issuance retains its fixed confirmation-time valuation.", "Inception Bonds and INCB", "Inception provides the bond composer, confirmed INCB balances and the associated sale-ticket market. Bond issuance retains its confirmation-time valuation, with exact terms and evidence available for inspection."],
  ["log", "Log", "log", "ProofOfWork Log | Inspect on-chain activity", "Search transaction-backed ProofOfWork Computer activity by address, confirmed ID or transaction. Inspect confirmed records and clearly identified pending observations.", "Inspect the public activity record", "Log is the read-only record of transaction-backed ProofOfWork Computer actions. Search by address, confirmed ID or transaction and inspect the evidence and status behind each result."],
  ["growth", "Growth", "growth", "ProofOfWork Growth | Network activity and value", "Inspect confirmed ProofOfWork Computer activity, network value and growth scenarios. Explore current evidence separately from modeled adoption assumptions.", "Measure activity and inspect growth scenarios", "Growth presents confirmed Computer activity and network value alongside explicitly modeled scenarios. Read-only views and shared records do not create additional economic value, and forecasts remain assumptions rather than chain facts."],
];

export const SEO_SURFACES = Object.freeze(Object.fromEntries(records.map(([surface, label, host, title, description, heading, intro]) => [surface, Object.freeze({ surface, label, origin: `https://${host}.proofofwork.me`, title, description, heading, intro })])));
export const PUBLIC_SEO_SURFACES = Object.freeze(Object.values(SEO_SURFACES));
export const SEO_IMAGE_URL = "https://www.proofofwork.me/brand/20261011/social-logo.jpg";
export const SEO_IMAGE_ALT = "ProofOfWork.Me rounded W mark";
export const INDEX_ROBOTS = "index, follow, max-image-preview:large";
export const NOINDEX_ROBOTS = "noindex, follow";
export const PUBLIC_QUERY_KEYS = Object.freeze({ publish: ["article", "profile"], boost: ["profile"], code: ["repo", "version", "path"], jobs: ["job"], browser: ["txid", "tx", "name"], token: ["asset"] });
export const TRACKING_QUERY_PATTERN = /^(?:utm_[a-z0-9_]+|gclid|fbclid|msclkid)$/iu;
const HASH = /^[a-f0-9]{64}$/iu;
const NAME = /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.){1,2}pow$/iu;
const FLAGS = Object.freeze({ landing: "VITE_LANDING_ONLY", "id-launch": "VITE_ID_LAUNCH_ONLY", "dns-launch": "VITE_DNS_LAUNCH_ONLY", desktop: "VITE_DESKTOP_ONLY", browser: "VITE_BROWSER_ONLY", pages: "VITE_PAGES_ONLY", boost: "VITE_BOOST_ONLY", publish: "VITE_PUBLISH_ONLY", search: "VITE_SEARCH_ONLY", code: "VITE_CODE_ONLY", jobs: "VITE_JOBS_ONLY", permission: "VITE_PERMISSION_ONLY", marketplace: "VITE_MARKETPLACE_ONLY", token: "VITE_TOKEN_ONLY", wallet: "VITE_WALLET_ONLY", work: "VITE_WORK_TOKEN_ONLY", infinity: "VITE_INFINITY_ONLY", inception: "VITE_INCEPTION_ONLY", log: "VITE_LOG_ONLY", growth: "VITE_GROWTH_ONLY" });
const PREVIEW_FLAGS = Object.freeze({ landing: "landing", "id-launch": "id-launch", "dns-launch": "dns-launch", desktop: "desktop", browser: "browser", pages: "pages", boost: "boost", publish: "publish", search: "search-app", code: "code", jobs: "jobs", permission: "permission-app", marketplace: "marketplace", token: "credit", wallet: "wallet", work: "work", infinity: "infinity", inception: "inception", log: "log", growth: "growth" });
const ALIASES = Object.freeze({ "proofofwork.me": "landing", "marketplace.proofofwork.me": "marketplace", "domain.proofofwork.me": "dns-launch", "domains.proofofwork.me": "dns-launch", "token.proofofwork.me": "token", "tokens.proofofwork.me": "token", "nft.proofofwork.me": "computer", "activity.proofofwork.me": "log" });
const WORKSPACE_LABELS = Object.freeze({ inbox: "Inbox", incoming: "Incoming", sent: "Sent", outbox: "Outbox", drafts: "Drafts", favorites: "Favorites", archive: "Archive", files: "Files", desktop: "Desktop", browser: "Browser", pages: "Pages", boost: "Boost", publish: "Publish", search: "Search", code: "Code", jobs: "Jobs", permission: "Permission", ids: "IDs", dns: "DNS", marketplace: "AMO", token: "Credit", wallet: "Wallet", work: "WORK", infinity: "Infinity", inception: "Inception", log: "Log", contacts: "Contacts", custom: "Mail" });

export function getSurfaceSeo(surface) { return SEO_SURFACES[surface] ?? SEO_SURFACES.computer; }
export function isLocalSeoHost(host) { return host === "localhost" || host === "127.0.0.1" || host === "::1" || host === "[::1]" || host.endsWith(".localhost"); }
export function resolveSeoSurface({ hostname = "", env = {}, search = "" } = {}) {
  for (const [surface, flag] of Object.entries(FLAGS)) if (env[flag] === "1") return surface;
  if (env.VITE_AMO_ONLY === "1") return "marketplace";
  if (env.VITE_ACTIVITY_ONLY === "1") return "log";
  const host = hostname.toLowerCase();
  if (isLocalSeoHost(host)) {
    const params = new URLSearchParams(search);
    for (const [surface, flag] of Object.entries(PREVIEW_FLAGS)) if (params.get(flag) === "1") return surface;
    if (params.get("token") === "1") return "token";
    if (params.get("amo") === "1") return "marketplace";
    if (params.get("activity") === "1") return "log";
  }
  return ALIASES[host] ?? PUBLIC_SEO_SURFACES.find(item => new URL(item.origin).hostname === host)?.surface ?? "computer";
}

function pageUrl(value, surface) { return new URL(String(value), `${getSurfaceSeo(surface).origin}/`); }
function publicParams(url) {
  const params = new URLSearchParams(url.search);
  if (isLocalSeoHost(url.hostname)) for (const key of [...Object.values(PREVIEW_FLAGS), "token", "amo", "activity"]) if (params.get(key) === "1") params.delete(key);
  return params;
}
function route(kind, canonicalUrl = null) { return { kind, canonicalUrl, robots: kind === "private" || kind === "not-found" ? NOINDEX_ROBOTS : INDEX_ROBOTS }; }
function browserTarget(value) { const text = String(value ?? "").toLowerCase(); return HASH.test(text) || NAME.test(text) ? text : null; }
function browserPathTarget(pathname) {
  let path;
  try { path = decodeURIComponent(pathname); } catch { return null; }
  const match = /^\/(?:(tx|name)\/)?([^/]+)\/?$/iu.exec(path);
  if (!match) return null;
  const target = browserTarget(match[2]);
  if (!target || match[1]?.toLowerCase() === "tx" && !HASH.test(target) || match[1]?.toLowerCase() === "name" && !NAME.test(target)) return null;
  return target;
}

export function resolveSeoRoute({ surface, url: value }) {
  const seo = getSurfaceSeo(surface);
  const url = pageUrl(value, surface);
  const path = url.pathname;
  const params = publicParams(url);
  if (surface === "identity-bridge" || path === "/pages-runner.html" || path === "/app.html" || path === "/noindex-app.html") return route("private");
  if (surface === "publish" && /^\/write\/?$/u.test(path)) return route("private");
  const pathTarget = surface === "browser" && path !== "/" && path !== "/index.html" ? browserPathTarget(path) : null;
  if (path !== "/" && path !== "/index.html" && !pathTarget) return route("not-found");
  const allowed = new Set(["network", ...(PUBLIC_QUERY_KEYS[surface] ?? [])]);
  for (const [key, value] of params) {
    if (TRACKING_QUERY_PATTERN.test(key)) continue;
    if (!allowed.has(key) || params.getAll(key).length !== 1 || key === "network" && value !== "livenet") return route("private");
  }
  const detail = [...params.keys()].filter(key => !TRACKING_QUERY_PATTERN.test(key) && key !== "network");
  if (pathTarget || surface === "browser" && detail.length) {
    if (detail.length > 1) return route("private");
    // Browser's reader gives its explicit query target precedence over the path.
    const target = detail.length ? browserTarget(params.get(detail[0])) : pathTarget;
    if (!target) return route("private");
    return route("public-detail", `${seo.origin}/${HASH.test(target) ? "tx" : "name"}/${encodeURIComponent(target)}`);
  }
  if (!detail.length) return route("root", `${seo.origin}/`);
  if ((surface === "publish" || surface === "boost") && params.has("profile")) {
    // A display ID can transfer. Do not invent a stable address identity before verification.
    return detail.length === 1 && params.get("profile")?.trim() && params.get("profile").length <= 256 ? route("public-detail") : route("private");
  }
  const idKey = { publish: "article", jobs: "job", code: "repo", token: "asset" }[surface];
  if (!idKey || !HASH.test(params.get(idKey) ?? "")) return route("private");
  const canonical = new URL(`${seo.origin}/`);
  canonical.searchParams.set(idKey, params.get(idKey).toLowerCase());
  if (surface === "code") {
    if (params.has("version")) {
      if (!HASH.test(params.get("version") ?? "")) return route("private");
      canonical.searchParams.set("version", params.get("version").toLowerCase());
    }
    if (params.has("path")) {
      const sourcePath = params.get("path");
      if (!sourcePath || /[\u0000-\u001f\u007f]/u.test(sourcePath)) return route("private");
      canonical.searchParams.set("path", sourcePath);
    }
  } else if (detail.length !== 1) return route("private");
  return route("public-detail", canonical.href);
}

export function structuredDataForSurface(surface) {
  const seo = getSurfaceSeo(surface);
  const organization = { "@type": "Organization", "@id": "https://www.proofofwork.me/#organization", name: "ProofOfWork.Me", url: "https://www.proofofwork.me/", logo: SEO_IMAGE_URL, sameAs: ["https://github.com/proofofworkme", "https://x.com/proofofworkme", "https://www.youtube.com/@proofofworkme"] };
  const website = { "@type": "WebSite", "@id": `${seo.origin}/#website`, url: `${seo.origin}/`, name: surface === "landing" ? "ProofOfWork.Me" : `ProofOfWork ${seo.label}`, publisher: { "@id": organization["@id"] } };
  const webpage = { "@type": "WebPage", "@id": `${seo.origin}/#webpage`, url: `${seo.origin}/`, name: seo.title, description: seo.description, isPartOf: { "@id": website["@id"] } };
  return [{ "@context": "https://schema.org", "@graph": [organization, website, webpage, ...(surface === "landing" ? [] : [{ "@type": "WebApplication", "@id": `${seo.origin}/#application`, name: `ProofOfWork ${seo.label}`, url: `${seo.origin}/`, description: seo.description, applicationCategory: "BrowserApplication", operatingSystem: "Web browser", browserRequirements: "Requires JavaScript. Transaction signing requires a compatible local wallet.", publisher: { "@id": organization["@id"] } }])] }];
}

export function resolvePageMetadata(surface, value, overrides = {}) {
  const seo = getSurfaceSeo(surface);
  const url = pageUrl(value, surface);
  const policy = resolveSeoRoute({ surface, url });
  let title = seo.title;
  if (surface === "computer" && url.searchParams.has("folder")) title = `${WORKSPACE_LABELS[url.searchParams.get("folder")] ?? "Mail"} | ProofOfWork Computer`;
  if ((surface === "publish" || surface === "computer") && (url.searchParams.get("write") === "1" || /^\/write\/?$/u.test(url.pathname))) title = "Write an article | ProofOfWork Publish";
  let allowVerifiedOverride = policy.kind === "public-detail";
  const workspace = url.searchParams.get("folder");
  if (surface === "computer" && ["publish", "code", "jobs"].includes(workspace)) {
    const publicUrl = new URL(url);
    publicUrl.searchParams.delete("folder");
    allowVerifiedOverride = resolveSeoRoute({ surface: workspace, url: publicUrl }).kind === "public-detail";
  }
  const excerpt = String(overrides.description ?? "").replace(/\s+/gu, " ").trim();
  const description = excerpt.length > 190 ? `${excerpt.slice(0, 187).trimEnd()}…` : excerpt;
  return { ...policy, title: allowVerifiedOverride && overrides.title ? String(overrides.title) : title, description: allowVerifiedOverride && description ? description : seo.description, imageUrl: SEO_IMAGE_URL, imageAlt: SEO_IMAGE_ALT, siteName: "ProofOfWork.Me", structuredData: policy.kind === "root" ? structuredDataForSurface(surface) : [] };
}

export function escapeHtml(value) { return String(value).replace(/[&<>"']/gu, char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]); }
export function serializeJsonLd(value) { return JSON.stringify(value).replace(/</gu, "\\u003c").replace(/\u2028/gu, "\\u2028").replace(/\u2029/gu, "\\u2029"); }
export function renderSeoHead(surface, { variant = "root" } = {}) {
  const seo = getSurfaceSeo(surface);
  const metadata = resolvePageMetadata(surface, `${seo.origin}/`);
  const canonical = variant === "root" ? `${seo.origin}/` : null;
  const robots = variant === "noindex" || variant === "not-found" ? NOINDEX_ROBOTS : INDEX_ROBOTS;
  return [
    `<title>${escapeHtml(variant === "not-found" ? `Page not found | ProofOfWork ${seo.label}` : seo.title)}</title>`,
    `<meta name="description" content="${escapeHtml(seo.description)}" />`,
    `<meta name="robots" content="${robots}" />`,
    canonical && `<link rel="canonical" href="${canonical}" />`,
    `<meta property="og:title" content="${escapeHtml(seo.title)}" />`,
    `<meta property="og:description" content="${escapeHtml(seo.description)}" />`,
    canonical && `<meta property="og:url" content="${canonical}" />`,
    `<meta property="og:type" content="website" />`,
    `<meta property="og:site_name" content="ProofOfWork.Me" />`,
    `<meta property="og:locale" content="en_US" />`,
    `<meta property="og:image" content="${SEO_IMAGE_URL}" />`,
    `<meta property="og:image:width" content="1200" />`,
    `<meta property="og:image:height" content="1200" />`,
    `<meta property="og:image:type" content="image/jpeg" />`,
    `<meta property="og:image:alt" content="${SEO_IMAGE_ALT}" />`,
    `<meta name="twitter:card" content="summary" />`,
    `<meta name="twitter:site" content="@proofofworkme" />`,
    `<meta name="twitter:title" content="${escapeHtml(seo.title)}" />`,
    `<meta name="twitter:description" content="${escapeHtml(seo.description)}" />`,
    `<meta name="twitter:image" content="${SEO_IMAGE_URL}" />`,
    `<meta name="twitter:image:alt" content="${SEO_IMAGE_ALT}" />`,
    ...(variant === "root" ? metadata.structuredData.map(value => `<script type="application/ld+json" data-proof-seo="structured-data">${serializeJsonLd(value)}</script>`) : []),
  ].filter(Boolean).join("\n    ");
}

export function renderSeoOverview(surface) {
  const seo = getSurfaceSeo(surface);
  return `<main class="product-overview"><h1>${escapeHtml(seo.heading)}</h1><p>${escapeHtml(seo.intro)}</p><nav class="product-directory" aria-label="ProofOfWork products">${PUBLIC_SEO_SURFACES.map(item => `<a href="${item.origin}/">${escapeHtml(item.label)}</a>`).join(" ")}</nav><p>Interactive tools require JavaScript. Transaction signing stays in your local wallet.</p></main>`;
}
export function renderRobots(surface) { const origin = getSurfaceSeo(surface).origin; return `User-agent: *\nAllow: /\nDisallow: /api/\nDisallow: /health\nSitemap: ${origin}/sitemap.xml\n`; }
export function renderSitemap(surface) { const origin = getSurfaceSeo(surface).origin; return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"><url><loc>${escapeHtml(origin)}/</loc></url></urlset>\n`; }
export function resolveDocumentVariant(surface, value) {
  const url = pageUrl(value, surface);
  const policy = resolveSeoRoute({ surface, url });
  if (policy.kind === "not-found") return "not-found";
  if (policy.kind === "private") return "noindex";
  return publicParams(url).size || policy.kind === "public-detail" ? "app" : "root";
}
