#!/usr/bin/env node

const DEFAULT_TIMEOUT_MS = 20_000;
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
const USER_AGENT = "ProofOfWork.Me read-only surface audit/1.0";

function usage() {
  console.log(`Usage: node scripts/audit-production-surfaces.mjs [--json] [--page-only] [--timeout-ms=20000]

Read-only production surface audit in canonical host order.

Environment:
  POW_API_BASE=https://computer.proofofwork.me
  POW_SURFACE_AUDIT_FRESH=1
  POW_SURFACE_AUDIT_JSON=1
  POW_SURFACE_AUDIT_PAGE_ONLY=1
  POW_SURFACE_AUDIT_TIMEOUT_MS=20000`);
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
    status: fetched.status,
    title,
    url: fetched.url,
  };
}

async function runProbe(probe) {
  const fetched = await withTimeout((signal) => fetchText(probe.url, signal));
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
    status: fetched.status,
    url: fetched.url,
  };
}

async function runSurface(surface) {
  const result = {
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
  return result;
}

const startedAt = new Date();
const results = [];
for (const surface of SURFACES) {
  results.push(await runSurface(surface));
}

const failed = results.filter((result) => !result.ok);
const payload = {
  apiBase: API_BASE,
  finishedAt: new Date().toISOString(),
  fresh: FRESH,
  ok: failed.length === 0,
  pageOnly: PAGE_ONLY,
  results,
  startedAt: startedAt.toISOString(),
  timeoutMs: timeoutMs(),
};

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
      `${result.ok ? "ok" : "fail"} ${result.title} html=${htmlMs}${assets}${
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
