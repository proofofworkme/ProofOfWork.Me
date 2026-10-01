#!/usr/bin/env node

import fs from "node:fs";
import { createHash, randomUUID } from "node:crypto";

const DEFAULT_TIMEOUT_MS = 20_000;
const RESUME_SCHEMA_VERSION = 1;
const MAX_RESUME_AGE_MS = 60 * 60 * 1_000;
const SOURCE_SHA256 = createHash("sha256")
  .update(fs.readFileSync(new URL(import.meta.url)))
  .digest("hex");
const API_BASE = String(
  process.env.POW_API_BASE || "https://computer.proofofwork.me",
).replace(/\/+$/u, "");
const FRESH = process.env.POW_SURFACE_AUDIT_FRESH !== "0";
const HTML_CONTENT_TYPE_PATTERN = /\btext\/html\b/iu;
const MODULE_CONTENT_TYPE_PATTERN =
  /\b(?:application|text)\/(?:javascript|ecmascript)\b/iu;
const STYLESHEET_CONTENT_TYPE_PATTERN = /\btext\/css\b/iu;
const JSON_OUTPUT =
  process.argv.includes("--json") || process.env.POW_SURFACE_AUDIT_JSON === "1";
const PAGE_ONLY =
  process.argv.includes("--page-only") ||
  process.env.POW_SURFACE_AUDIT_PAGE_ONLY === "1";
const SURFACE_ARG = process.argv.find((value) => value.startsWith("--surface="));
const RESUME_ARG = process.argv.find((value) => value.startsWith("--resume-file="));
const SELECTED_SURFACE = SURFACE_ARG ? SURFACE_ARG.slice("--surface=".length) : "";
const RESUME_FILE = RESUME_ARG ? RESUME_ARG.slice("--resume-file=".length) : "";
const USER_AGENT = "ProofOfWork.Me read-only surface audit/1.0";

function usage() {
  console.log(`Usage: node scripts/audit-production-surfaces.mjs [--json] [--page-only] [--timeout-ms=20000] [--surface=key] [--resume-file=path]

Read-only production surface audit in canonical host order.

Environment:
  POW_API_BASE=https://computer.proofofwork.me
  POW_SURFACE_AUDIT_FRESH=1
  POW_SURFACE_AUDIT_JSON=1
  POW_SURFACE_AUDIT_PAGE_ONLY=1
  POW_SURFACE_AUDIT_TIMEOUT_MS=20000

--surface runs one named surface (for example --surface=computer).
--resume-file writes completed per-surface results after each surface so an
interrupted audit can resume without repeating successful surfaces. Receipts
must match this script, settings and ordered surface plan, and be less than one
hour old from the original audit start. Reused observations keep their original
timestamps and are explicitly labeled; failed surfaces are retried.`);
}

if (process.argv.includes("--help") || process.argv.includes("-h")) {
  usage();
  process.exit(0);
}

function timeoutMs() {
  const arg = process.argv.find((value) => value.startsWith("--timeout-ms="));
  const raw = arg ? arg.slice("--timeout-ms=".length) : process.env.POW_SURFACE_AUDIT_TIMEOUT_MS;
  const parsed = Number(raw);
  return Number.isSafeInteger(parsed) && parsed >= 1_000
    ? parsed
    : DEFAULT_TIMEOUT_MS;
}

function apiUrl(path) {
  const separator = path.includes("?") ? "&" : "?";
  const fresh = FRESH ? `${separator}fresh=1` : "";
  return `${API_BASE}${path}${fresh}`;
}

const SURFACES = [
  {
    key: "home",
    title: "proofofwork.me",
    url: "https://proofofwork.me/",
    probes: [
      {
        label: "registry summary",
        url: apiUrl("/api/v1/registry-summary?network=livenet"),
        validate: validateRegistrySummary,
      },
    ],
  },
  {
    key: "id",
    title: "id.proofofwork.me",
    url: "https://id.proofofwork.me/",
    probes: [
      {
        label: "ids summary",
        url: apiUrl("/api/v1/ids-summary?network=livenet"),
        validate: validateRegistrySummary,
      },
    ],
  },
  {
    key: "dns",
    title: "dns.proofofwork.me",
    url: "https://dns.proofofwork.me/",
    probes: [
      {
        label: "dns summary",
        url: apiUrl("/api/v1/dns-summary?network=livenet"),
        validate: validateDnsRegistrySummary,
      },
    ],
  },
  {
    key: "desktop",
    title: "desktop.proofofwork.me",
    url: "https://desktop.proofofwork.me/",
    probes: [
      {
        label: "log summary",
        url: apiUrl("/api/v1/log-summary?network=livenet"),
        validate: validateIndexedJson,
      },
    ],
  },
  {
    key: "browser",
    title: "browser.proofofwork.me",
    url: "https://browser.proofofwork.me/",
    probes: [
      {
        label: "activity summary",
        url: apiUrl("/api/v1/activity-summary?network=livenet"),
        validate: validateIndexedJson,
      },
    ],
  },
  {
    key: "boost",
    title: "boost.proofofwork.me",
    url: "https://boost.proofofwork.me/",
    probes: [
      {
        label: "boost feed",
        url: apiUrl("/api/v1/boost?network=livenet&limit=1"),
        validate: validateIndexedJson,
      },
    ],
  },
  {
    key: "amo",
    title: "amo.proofofwork.me",
    url: "https://amo.proofofwork.me/",
    probes: [
      {
        label: "marketplace summary",
        url: apiUrl("/api/v1/marketplace-summary?network=livenet&compact=1"),
        validate: validateMarketplaceSummary,
      },
    ],
  },
  {
    key: "credit",
    title: "credit.proofofwork.me",
    url: "https://credit.proofofwork.me/",
    probes: [
      {
        label: "token summary",
        url: apiUrl("/api/v1/token-summary?network=livenet&compact=1"),
        validate: validateTokenSummary,
      },
    ],
  },
  {
    key: "wallet",
    title: "wallet.proofofwork.me",
    url: "https://wallet.proofofwork.me/",
    probes: [
      {
        label: "WORK token",
        url: apiUrl("/api/v1/token?network=livenet&asset=WORK"),
        validate: validateWorkToken,
      },
    ],
  },
  {
    key: "work",
    title: "work.proofofwork.me",
    url: "https://work.proofofwork.me/",
    probes: [
      {
        label: "work summary",
        url: apiUrl("/api/v1/work-summary?network=livenet&compact=1"),
        validate: validateWorkSummary,
      },
      {
        label: "work floor",
        url: apiUrl("/api/v1/work-floor?network=livenet"),
        validate: validateIndexedJson,
      },
    ],
  },
  {
    key: "infinity",
    title: "infinity.proofofwork.me",
    url: "https://infinity.proofofwork.me/",
    probes: [
      {
        label: "infinity summary",
        url: apiUrl("/api/v1/infinity-summary?network=livenet"),
        validate: validateBondSummary,
      },
    ],
  },
  {
    key: "inception",
    title: "inception.proofofwork.me",
    url: "https://inception.proofofwork.me/",
    probes: [
      {
        label: "inception summary",
        url: apiUrl("/api/v1/inception-summary?network=livenet"),
        validate: validateBondSummary,
      },
    ],
  },
  {
    key: "log",
    title: "log.proofofwork.me",
    url: "https://log.proofofwork.me/",
    probes: [
      {
        label: "log summary",
        url: apiUrl("/api/v1/log-summary?network=livenet"),
        validate: validateIndexedJson,
      },
    ],
  },
  {
    key: "growth",
    title: "growth.proofofwork.me",
    url: "https://growth.proofofwork.me/",
    probes: [
      {
        label: "growth summary",
        url: apiUrl("/api/v1/growth-summary?network=livenet"),
        validate: validateGrowthSummary,
      },
    ],
  },
  {
    key: "computer",
    title: "computer.proofofwork.me",
    url: "https://computer.proofofwork.me/",
    probes: [
      {
        label: "health",
        url: `${API_BASE}/health?network=livenet`,
        validate: validateHealth,
      },
      {
        label: "consistency",
        url: apiUrl("/api/v1/consistency?network=livenet"),
        validate: validateConsistency,
      },
    ],
  },
];

function assertCondition(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function jsonErrorMessage(json) {
  const value = json?.error ?? json?.message;
  return typeof value === "string" && value.trim() ? value.trim() : "";
}

function firstNonNegativeInteger(json, keys) {
  for (const key of keys) {
    const parts = key.split(".");
    let value = json;
    for (const part of parts) {
      value = value?.[part];
    }
    if (
      typeof value !== "number" &&
      !(typeof value === "string" && /^(?:0|[1-9][0-9]*)$/u.test(value))
    ) {
      continue;
    }
    const number = Number(value);
    if (Number.isSafeInteger(number) && number >= 0) {
      return number;
    }
  }
  return null;
}

function validateIndexedJson(json) {
  assertCondition(!jsonErrorMessage(json), `API error: ${jsonErrorMessage(json)}`);
  const checkpoint = firstNonNegativeInteger(json, [
    "indexedThroughBlock",
    "summarySnapshot.indexedThroughBlock",
    "stats.indexedThroughBlock",
    "tipHeight",
  ]);
  assertCondition(checkpoint !== null, "missing indexed block checkpoint");
}

function validateRegistrySummary(json) {
  validateIndexedJson(json);
  const count = firstNonNegativeInteger(json, [
    "stats.records",
    "records",
    "totalCount",
    "confirmedRecords",
  ]);
  assertCondition(count !== null, "missing registry record count");
}

function validateDnsRegistrySummary(json) {
  validateIndexedJson(json);
  assertCondition(json.coverage?.complete === true, "DNS history coverage is incomplete");
  assertCondition(/^[0-9a-f]{64}$/u.test(json.checkpointHash ?? ""), "missing DNS checkpoint hash");
  assertCondition(Array.isArray(json.records), "missing DNS records");
  const count = firstNonNegativeInteger(json, ["stats.total"]);
  assertCondition(count === json.records.length, "DNS record count disagrees with records");
}

function validateTokenSummary(json) {
  validateIndexedJson(json);
  const tokenCount = firstNonNegativeInteger(json, [
    "stats.tokens",
    "totalCounts.tokens",
    "tokens.length",
  ]);
  assertCondition(tokenCount !== null, "missing token count");
}

function validateMarketplaceSummary(json) {
  validateIndexedJson(json);
  const tokenCount = firstNonNegativeInteger(json, [
    "token.stats.confirmedTokens",
    "token.totalCounts.tokens",
    "token.tokens.length",
    "registry.stats.records",
    "registry.totalCount",
  ]);
  assertCondition(tokenCount !== null, "missing AMO token or registry count");
  const listingCount = firstNonNegativeInteger(json, [
    "token.stats.openListings",
    "token.totalCounts.listings",
    "token.listings.length",
    "registry.stats.activeListings",
    "registry.totalCounts.listings",
    "registry.listings.length",
  ]);
  assertCondition(listingCount !== null, "missing AMO listing count");
  assertCondition(
    json?.listingAuthority?.model === "proof-token-market-core-gettxout-v1" ||
      json?.token?.listingAuthority?.model ===
        "proof-token-market-core-gettxout-v1",
    "missing Core token listing authority",
  );
}

function validateWorkToken(json) {
  validateIndexedJson(json);
  assertCondition(
    json?.listingAuthority?.model === "proof-token-market-core-gettxout-v1",
    "missing WORK Core token listing authority",
  );
}

function validateWorkSummary(json) {
  validateIndexedJson(json);
  assertCondition(
    json?.token || json?.work || json?.floor || json?.workFloor,
    "missing WORK summary fields",
  );
}

function validateBondSummary(json) {
  validateIndexedJson(json);
  assertCondition(
    json?.token || json?.bond || json?.summary || json?.floor,
    "missing bond summary fields",
  );
}

function validateGrowthSummary(json) {
  validateIndexedJson(json);
  assertCondition(
    json?.networkValueSats !== undefined ||
      json?.networkValue !== undefined ||
      json?.actualValue !== undefined,
    "missing growth value fields",
  );
}

function validateHealth(json) {
  assertCondition(json?.ok === true, "health ok is not true");
  assertCondition(json?.ready === true, "health ready is not true");
  validateIndexedJson(json);
}

function validateConsistency(json) {
  assertCondition(json?.ok === true, "consistency ok is not true");
  const failed = Array.isArray(json?.failedChecks) ? json.failedChecks : [];
  assertCondition(failed.length === 0, `failed checks: ${failed.join(", ")}`);
  validateIndexedJson(json);
}

function responseOriginMatchesRequest(requestedUrl, observedUrl, allowHomeWww = false) {
  const requested = new URL(requestedUrl);
  const observed = new URL(observedUrl);
  return requested.origin === observed.origin || (allowHomeWww &&
    requested.origin === "https://proofofwork.me" &&
    observed.origin === "https://www.proofofwork.me");
}

async function fetchText(url, signal) {
  const startedAt = performance.now();
  const response = await fetch(url, {
    headers: { "user-agent": USER_AGENT },
    redirect: "follow",
    signal,
  });
  const body = await response.text();
  return {
    body,
    contentType: response.headers.get("content-type") ?? "",
    elapsedMs: Math.round(performance.now() - startedAt),
    status: response.status,
    url: response.url,
  };
}

async function withTimeout(task) {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), timeoutMs());
  try {
    return await task(controller.signal);
  } finally {
    clearTimeout(id);
  }
}

function decodeHtmlAttribute(value) {
  return value
    .replaceAll("&amp;", "&")
    .replaceAll("&quot;", '"')
    .replaceAll("&#39;", "'")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">");
}

function parseTagAttributes(text) {
  const attributes = new Map();
  const pattern = /([^\s"'<>/=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/gu;
  for (const match of text.matchAll(pattern)) {
    const key = String(match[1] ?? "").toLowerCase();
    if (!key) {
      continue;
    }
    attributes.set(
      key,
      decodeHtmlAttribute(String(match[2] ?? match[3] ?? match[4] ?? "")),
    );
  }
  return attributes;
}

function sameOriginUrl(raw, pageUrl) {
  if (!raw || /^(?:data|blob|mailto|tel|javascript):/iu.test(raw)) {
    return null;
  }
  const resolved = new URL(raw, pageUrl);
  const page = new URL(pageUrl);
  assertCondition(
    resolved.origin === page.origin,
    `cross-origin shell asset ${resolved.href}`,
  );
  return resolved.href;
}

function collectShellAssets(body, pageUrl) {
  const assets = [];
  for (const match of body.matchAll(/<script\b([^>]*)>/giu)) {
    const attributes = parseTagAttributes(match[1] ?? "");
    const type = attributes.get("type")?.toLowerCase() ?? "";
    const src = sameOriginUrl(attributes.get("src"), pageUrl);
    if (src && type === "module") {
      assets.push({ kind: "module", url: src });
    }
  }
  for (const match of body.matchAll(/<link\b([^>]*)>/giu)) {
    const attributes = parseTagAttributes(match[1] ?? "");
    const rel = (attributes.get("rel") ?? "")
      .toLowerCase()
      .split(/\s+/u)
      .filter(Boolean);
    const href = sameOriginUrl(attributes.get("href"), pageUrl);
    if (!href) {
      continue;
    }
    if (rel.includes("stylesheet")) {
      assets.push({ kind: "stylesheet", url: href });
    } else if (rel.includes("modulepreload")) {
      assets.push({ kind: "modulepreload", url: href });
    }
  }
  const deduped = new Map();
  for (const asset of assets) {
    deduped.set(`${asset.kind}:${asset.url}`, asset);
  }
  return [...deduped.values()];
}

function validateAssetResponse(asset, fetched) {
  assertCondition(
    fetched.status >= 200 && fetched.status < 400,
    `HTTP ${fetched.status}`,
  );
  assertCondition(fetched.body.length > 0, "empty asset response");
  if (asset.kind === "stylesheet") {
    assertCondition(
      STYLESHEET_CONTENT_TYPE_PATTERN.test(fetched.contentType),
      `unexpected stylesheet content-type ${fetched.contentType || "<empty>"}`,
    );
  } else {
    assertCondition(
      MODULE_CONTENT_TYPE_PATTERN.test(fetched.contentType),
      `unexpected module content-type ${fetched.contentType || "<empty>"}`,
    );
  }
}

async function checkShellAsset(asset) {
  const fetched = await withTimeout((signal) => fetchText(asset.url, signal));
  try {
    validateAssetResponse(asset, fetched);
    return {
      elapsedMs: fetched.elapsedMs,
      kind: asset.kind,
      ok: true,
      status: fetched.status,
      url: fetched.url,
    };
  } catch (error) {
    throw new Error(
      `${asset.kind} asset ${asset.url}: ${String(error?.message ?? error)}`,
    );
  }
}

async function htmlResult(surface, fetched) {
  const title =
    /<title[^>]*>([^<]*)<\/title>/iu.exec(fetched.body)?.[1]?.trim() ?? "";
  assertCondition(
    fetched.status >= 200 && fetched.status < 400,
    `HTTP ${fetched.status}`,
  );
  assertCondition(
    HTML_CONTENT_TYPE_PATTERN.test(fetched.contentType),
    `unexpected HTML content-type ${fetched.contentType || "<empty>"}`,
  );
  assertCondition(
    responseOriginMatchesRequest(surface.url, fetched.url, true),
    `unexpected HTML response origin ${fetched.url}`,
  );
  assertCondition(title.length > 0, "missing document title");
  assertCondition(
    /<div\b[^>]*\bid=(?:"root"|'root')[^>]*>/iu.test(fetched.body),
    "missing React root mount",
  );
  const assets = collectShellAssets(fetched.body, fetched.url);
  const moduleCount = assets.filter((asset) => asset.kind === "module").length;
  const modulepreloadCount = assets.filter(
    (asset) => asset.kind === "modulepreload",
  ).length;
  const stylesheetCount = assets.filter(
    (asset) => asset.kind === "stylesheet",
  ).length;
  assertCondition(moduleCount > 0, "missing Vite module entry asset");
  const assetResults = await Promise.all(assets.map(checkShellAsset));
  return {
    assets: {
      checked: assetResults.length,
      modules: moduleCount,
      modulepreloads: modulepreloadCount,
      stylesheets: stylesheetCount,
    },
    contentType: fetched.contentType,
    elapsedMs: fetched.elapsedMs,
    ok: true,
    requestedUrl: surface.url,
    status: fetched.status,
    title,
    url: fetched.url,
  };
}

async function runProbe(probe) {
  const fetched = await withTimeout((signal) => fetchText(probe.url, signal));
  assertCondition(
    responseOriginMatchesRequest(probe.url, fetched.url),
    `unexpected API response origin ${fetched.url}`,
  );
  let json;
  try {
    json = JSON.parse(fetched.body);
  } catch (error) {
    throw new Error(`invalid JSON: ${error.message}`);
  }
  assertCondition(
    fetched.status >= 200 && fetched.status < 400,
    `HTTP ${fetched.status}: ${jsonErrorMessage(json) || fetched.body.slice(0, 140)}`,
  );
  probe.validate(json);
  return {
    elapsedMs: fetched.elapsedMs,
    ok: true,
    requestedUrl: probe.url,
    status: fetched.status,
    url: fetched.url,
  };
}

async function runSurface(surface) {
  const result = {
    evidence: "current-run",
    startedAt: new Date().toISOString(),
    html: null,
    key: surface.key,
    ok: false,
    probes: [],
    title: surface.title,
  };
  try {
    result.html = await htmlResult(
      surface,
      await withTimeout((signal) => fetchText(surface.url, signal)),
    );
    if (!PAGE_ONLY) {
      for (const probe of surface.probes) {
        const probeResult = await runProbe(probe);
        result.probes.push({ label: probe.label, ...probeResult });
      }
    }
    result.ok = true;
  } catch (error) {
    result.error = String(error?.message ?? error);
  }
  result.finishedAt = new Date().toISOString();
  return result;
}

function receiptTimestamp(value, label) {
  const time = typeof value === "string" ? Date.parse(value) : NaN;
  assertCondition(
    Number.isFinite(time) && new Date(time).toISOString() === value,
    `invalid ${label} timestamp`,
  );
  return time;
}

function validateResumeResult(result, surface, bounds, allowHistory = true) {
  assertCondition(result?.key === surface.key && result.title === surface.title,
    "resume surface identity disagrees with the ordered plan");
  assertCondition(typeof result.ok === "boolean", "invalid resume surface status");
  assertCondition(result.evidence === "current-run" || result.evidence === "reused",
    "missing resume observation provenance");
  const started = receiptTimestamp(result.startedAt, "surface start");
  const finished = receiptTimestamp(result.finishedAt, "surface finish");
  assertCondition(started >= bounds.started && finished >= started && finished <= bounds.finished,
    "resume observation is outside the original audit interval");
  if (result.evidence === "reused") {
    const reused = receiptTimestamp(result.reusedAt, "surface reuse");
    assertCondition(reused >= finished && reused <= bounds.finished,
      "invalid resume observation reuse interval");
  }
  assertCondition(Array.isArray(result.probes), "missing resume probe evidence");
  const probes = PAGE_ONLY ? [] : surface.probes;
  assertCondition(result.probes.length <= probes.length &&
    (!result.ok || result.probes.length === probes.length),
  "resume probe evidence does not cover the requested mode");
  for (const [index, probe] of result.probes.entries()) {
    assertCondition(probe.label === probes[index].label && probe.requestedUrl === probes[index].url &&
      responseOriginMatchesRequest(probe.requestedUrl, probe.url) &&
      probe.ok === true && Number.isInteger(probe.status) &&
      probe.status >= 200 && probe.status < 400 &&
      Number.isSafeInteger(probe.elapsedMs) && probe.elapsedMs >= 0,
    "invalid resume probe evidence");
  }
  if (result.html !== null) {
    const html = result.html;
    assertCondition(html?.ok === true && Number.isInteger(html.status) &&
      html.status >= 200 && html.status < 400 &&
      HTML_CONTENT_TYPE_PATTERN.test(html.contentType ?? "") &&
      typeof html.title === "string" && html.title.trim().length > 0 &&
      Number.isSafeInteger(html.elapsedMs) && html.elapsedMs >= 0 &&
      html.requestedUrl === surface.url &&
      responseOriginMatchesRequest(html.requestedUrl, html.url, true),
    "invalid resume HTML evidence");
    const assets = html.assets;
    assertCondition(assets && [assets.checked, assets.modules, assets.modulepreloads, assets.stylesheets]
      .every((value) => Number.isSafeInteger(value) && value >= 0) &&
      assets.modules > 0 &&
      assets.checked === assets.modules + assets.modulepreloads + assets.stylesheets,
    "invalid resume shell asset evidence");
  }
  assertCondition(result.ok ? result.html?.ok === true && result.error === undefined :
    typeof result.error === "string" && result.error.length > 0,
  "resume status disagrees with its evidence");
  if (result.previousAttempts !== undefined) {
    assertCondition(allowHistory && Array.isArray(result.previousAttempts),
      "invalid resume attempt history");
    for (const attempt of result.previousAttempts) {
      assertCondition(attempt.ok === false, "resume history must retain failed attempts only");
      validateResumeResult(attempt, surface, { ...bounds, finished: started }, false);
    }
  }
}

function validateResumeReceipt(prior, surfacePlan, now) {
  assertCondition(prior?.schemaVersion === RESUME_SCHEMA_VERSION,
    "unsupported resume receipt schema");
  assertCondition(prior.sourceSha256 === SOURCE_SHA256, "resume script digest differs");
  assertCondition(prior.apiBase === API_BASE && prior.fresh === FRESH &&
    prior.pageOnly === PAGE_ONLY && prior.timeoutMs === timeoutMs(),
  "resume origin or audit settings differ");
  assertCondition(JSON.stringify(prior.surfacePlan) === JSON.stringify(surfacePlan),
    "resume ordered surface plan differs");
  assertCondition(typeof prior.auditId === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u.test(prior.auditId),
  "missing resume audit identity");
  const started = receiptTimestamp(prior.startedAt, "audit start");
  const finished = receiptTimestamp(prior.finishedAt, "audit finish");
  assertCondition(started <= finished && finished <= now && now - started <= MAX_RESUME_AGE_MS,
    "resume receipt is stale or has an invalid audit interval");
  assertCondition(Array.isArray(prior.results) && prior.results.length <= surfacePlan.length,
    "invalid resume result population");
  for (const [index, result] of prior.results.entries()) {
    validateResumeResult(result, selectedSurfaces[index], { started, finished });
  }
  const complete = prior.results.length === surfacePlan.length;
  assertCondition(prior.complete === complete &&
    prior.ok === (complete && prior.results.every((result) => result.ok)),
  "resume aggregate status disagrees with its observations");
  return prior;
}

const runStartedAt = new Date();
const selectedSurfaces = SELECTED_SURFACE
  ? SURFACES.filter((surface) => surface.key === SELECTED_SURFACE)
  : SURFACES;
if (SELECTED_SURFACE && selectedSurfaces.length === 0) {
  throw new Error(`Unknown surface: ${SELECTED_SURFACE}`);
}
const surfacePlan = selectedSurfaces.map((surface) => ({
  key: surface.key,
  title: surface.title,
  url: surface.url,
  probes: surface.probes.map(({ label, url }) => ({ label, url })),
}));
let prior = null;
if (RESUME_FILE) {
  try {
    prior = validateResumeReceipt(
      JSON.parse(fs.readFileSync(RESUME_FILE, "utf8")), surfacePlan, runStartedAt.getTime(),
    );
  } catch (error) {
    if (error?.code !== "ENOENT") {
      throw new Error(`Invalid resume evidence: ${error.message}`);
    }
  }
}
const startedAt = prior?.startedAt ?? runStartedAt.toISOString();
const auditId = prior?.auditId ?? randomUUID();
const previous = new Map((prior?.results ?? []).map((result) => [result.key, result]));
const results = [];

function auditPayload(finishedAt) {
  const complete = results.length === selectedSurfaces.length;
  const currentRun = results.filter((result) => result.evidence === "current-run").length;
  return {
    schemaVersion: RESUME_SCHEMA_VERSION,
    sourceSha256: SOURCE_SHA256,
    auditId,
    apiBase: API_BASE,
    complete,
    currentRunComplete: complete && currentRun === selectedSurfaces.length,
    finishedAt,
    fresh: FRESH,
    ok: complete && results.every((result) => result.ok),
    pageOnly: PAGE_ONLY,
    results,
    startedAt,
    runStartedAt: runStartedAt.toISOString(),
    resumedAt: prior ? runStartedAt.toISOString() : null,
    resumeSourceFinishedAt: prior?.finishedAt ?? null,
    observations: {
      currentRun,
      reused: results.filter((result) => result.evidence === "reused").length,
    },
    surfacePlan,
    timeoutMs: timeoutMs(),
  };
}

for (const surface of selectedSurfaces) {
  const previousResult = previous.get(surface.key);
  if (previousResult?.ok === true) {
    results.push({ ...previousResult, evidence: "reused", reusedAt: runStartedAt.toISOString() });
    console.error(`resume reuse ${surface.title} observed=${previousResult.finishedAt}`);
    continue;
  }
  console.error(`audit start ${surface.title}`);
  const result = await runSurface(surface);
  if (previousResult) {
    const { previousAttempts = [], ...lastAttempt } = previousResult;
    result.previousAttempts = [...previousAttempts, lastAttempt];
  }
  results.push(result);
  console.error(`audit ${result.ok ? "complete" : "failed"} ${surface.title}`);
  if (RESUME_FILE) {
    const checkpoint = auditPayload(new Date().toISOString());
    const temporary = `${RESUME_FILE}.tmp`;
    fs.writeFileSync(temporary, `${JSON.stringify(checkpoint, null, 2)}\n`);
    fs.renameSync(temporary, RESUME_FILE);
  }
}

const failed = results.filter((result) => !result.ok);
const payload = auditPayload(new Date().toISOString());

if (JSON_OUTPUT) {
  console.log(JSON.stringify(payload, null, 2));
} else {
  for (const result of results) {
    const htmlMs = result.html ? `${result.html.elapsedMs}ms` : "failed";
    const assets = result.html?.assets
      ? ` assets=${result.html.assets.checked}`
      : "";
    const probes = result.probes
      .map((probe) => `${probe.label} ${probe.elapsedMs}ms`)
      .join(", ");
    console.log(
      `${result.ok ? "ok" : "fail"} ${result.title} evidence=${result.evidence} observed=${result.finishedAt} html=${htmlMs}${assets}${
        probes ? ` api=[${probes}]` : ""
      }${result.error ? ` error=${result.error}` : ""}`,
    );
  }
  console.log(
    JSON.stringify({
      failed: failed.map((result) => result.title),
      ok: payload.ok,
      surfaces: results.length,
    }),
  );
}

if (failed.length > 0) {
  process.exitCode = 1;
}
