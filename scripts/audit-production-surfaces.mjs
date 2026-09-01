#!/usr/bin/env node

const DEFAULT_TIMEOUT_MS = 20_000;
const API_BASE = String(
  process.env.POW_API_BASE || "https://computer.proofofwork.me",
).replace(/\/+$/u, "");
const FRESH = process.env.POW_SURFACE_AUDIT_FRESH !== "0";
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
    htmlMatch: [/ProofOfWork/iu],
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
    htmlMatch: [/ProofOfWork IDs|Connect UniSat|Register/iu],
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
    htmlMatch: [/ProofOfWork Desktop|Desktop|Inbox/iu],
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
    htmlMatch: [/ProofOfWork|txid|verified HTML/iu],
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
    htmlMatch: [/ProofOfWork AMO|WORK AMO|Credit Markets/iu],
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
    htmlMatch: [/Credits|Create credit|Credit index/iu],
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
    htmlMatch: [/Wallet|Connect UniSat|Balances/iu],
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
    htmlMatch: [/WORK|Live WORK floor|Mint WORK/iu],
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
    htmlMatch: [/Infinity Bonds|POWB|Bond Market/iu],
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
    htmlMatch: [/Inception Bonds|INCB|Bond Market/iu],
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
    htmlMatch: [/Log|computer actions|ProofOfWork/iu],
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
    htmlMatch: [/Growth|network value|ProofOfWork/iu],
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
    htmlMatch: [/ProofOfWork|Computer|Install UniSat|Connect UniSat/iu],
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
  validateTokenSummary(json);
  assertCondition(
    json?.listingAuthority?.model === "proof-token-market-core-gettxout-v1",
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

function htmlResult(surface, fetched) {
  const title = /<title[^>]*>([^<]*)<\/title>/iu.exec(fetched.body)?.[1]?.trim() ?? "";
  const matched = surface.htmlMatch.some((pattern) => pattern.test(fetched.body));
  assertCondition(
    fetched.status >= 200 && fetched.status < 400,
    `HTTP ${fetched.status}`,
  );
  assertCondition(matched, "required page text was not found");
  return {
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
    result.html = htmlResult(
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
    const probes = result.probes
      .map((probe) => `${probe.label} ${probe.elapsedMs}ms`)
      .join(", ");
    console.log(
      `${result.ok ? "ok" : "fail"} ${result.title} html=${htmlMs}${
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
