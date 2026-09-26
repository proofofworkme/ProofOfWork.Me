#!/usr/bin/env node

const DEFAULT_BASE = "https://computer.proofofwork.me";

const BASE = normalizedBase(process.env.POW_SUMMARY_ROUTE_BASE || DEFAULT_BASE);
const NETWORK = process.env.POW_SUMMARY_ROUTE_NETWORK || "livenet";
const TIMEOUT_MS = integerEnv("POW_SUMMARY_ROUTE_TIMEOUT_MS", 30000);
const WARN_MS = integerEnv("POW_SUMMARY_ROUTE_WARN_MS", 2500);
const CRITICAL_MS = integerEnv("POW_SUMMARY_ROUTE_CRITICAL_MS", 10000);
const MAX_LAG_BLOCKS = integerEnv("POW_SUMMARY_ROUTE_MAX_LAG_BLOCKS", 2);
const HEALTH_MAX_LAG_BLOCKS = integerEnv(
  "POW_SUMMARY_ROUTE_HEALTH_MAX_LAG_BLOCKS",
  1,
);

const WORK_AMO_V8_DECLARATION_TXID =
  "f90e1faf572ef8253ca5959731b9d9e99c74bced4397380059878936712bee7a";

function integerEnv(name, fallback) {
  const value = Number.parseInt(process.env[name] || "", 10);
  return Number.isFinite(value) && value >= 0 ? value : fallback;
}

function normalizedBase(base) {
  return String(base).replace(/\/+$/u, "");
}

function routeUrl(pathname, searchParams = {}) {
  const url = new URL(pathname, `${BASE}/`);
  for (const [key, value] of Object.entries(searchParams)) {
    url.searchParams.set(key, String(value));
  }
  return url;
}

async function fetchJson(label, url) {
  const startedAt = performance.now();
  let response = null;
  let text = "";
  try {
    response = await fetch(url, {
      headers: { accept: "application/json" },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    text = await response.text();
    const payload = text ? JSON.parse(text) : null;
    return {
      label,
      url: url.toString(),
      status: response.status,
      ok: response.ok,
      elapsedMs: Math.round(performance.now() - startedAt),
      payload,
    };
  } catch (error) {
    return {
      label,
      url: url.toString(),
      status: response?.status ?? 0,
      ok: false,
      elapsedMs: Math.round(performance.now() - startedAt),
      error: error instanceof Error ? error.message : String(error),
      bodyPrefix: text.slice(0, 200),
      payload: null,
    };
  }
}

function asInt(value) {
  if (Number.isInteger(value)) return value;
  if (typeof value === "string" && /^\d+$/u.test(value)) {
    const parsed = Number.parseInt(value, 10);
    return Number.isSafeInteger(parsed) ? parsed : null;
  }
  return null;
}

function asString(value) {
  return typeof value === "string" && value ? value : null;
}

function firstValue(...values) {
  for (const value of values) {
    if (value !== undefined && value !== null && value !== "") return value;
  }
  return null;
}

function isBlockHash(value) {
  return typeof value === "string" && /^[0-9a-f]{64}$/iu.test(value);
}

function checkpointFromPayload(payload, nestedKey) {
  const nested = payload?.[nestedKey] ?? null;
  const floor = payload?.floor ?? payload?.workFloor ?? nested?.workFloor ?? null;
  const token = payload?.token ?? null;
  const provenance = payload?.provenance ?? payload?.canonicalProvenance ?? null;
  return {
    snapshotId: asString(
      firstValue(
        payload?.snapshotId,
        payload?.summarySnapshotId,
        provenance?.snapshotId,
        floor?.snapshotId,
        token?.snapshotId,
      ),
    ),
    indexedThroughBlock: asInt(
      firstValue(
        payload?.indexedThroughBlock,
        payload?.indexedThroughHeight,
        provenance?.indexedThroughBlock,
        floor?.indexedThroughBlock,
        floor?.indexedThroughHeight,
        token?.indexedThroughBlock,
      ),
    ),
    indexedThroughBlockHash: asString(
      firstValue(
        payload?.indexedThroughBlockHash,
        payload?.indexedThroughHash,
        payload?.blockHash,
        provenance?.indexedThroughBlockHash,
        floor?.indexedThroughBlockHash,
        floor?.indexedThroughHash,
        token?.indexedThroughBlockHash,
      ),
    ),
    indexedAt: asString(
      firstValue(
        payload?.indexedAt,
        provenance?.indexedAt,
        floor?.indexedAt,
        token?.indexedAt,
      ),
    ),
  };
}

function healthCheckpoint(payload) {
  const index = payload?.checks?.index ?? payload?.index ?? null;
  const summary = index?.summarySnapshot ?? payload?.summarySnapshot ?? null;
  const node = payload?.checks?.node ?? payload?.node ?? null;
  return {
    ready: Boolean(payload?.ready ?? payload?.ok),
    available: Boolean(payload?.available ?? payload?.ok),
    lagBlocks: asInt(firstValue(payload?.lagBlocks, index?.lagBlocks)),
    indexedThroughBlock: asInt(
      firstValue(
        payload?.indexedThroughBlock,
        index?.indexedThroughBlock,
        summary?.indexedThroughBlock,
      ),
    ),
    indexedThroughBlockHash: asString(
      firstValue(
        payload?.indexedThroughBlockHash,
        index?.checkpointHash,
        summary?.blockHash,
      ),
    ),
    tipHeight: asInt(firstValue(payload?.tipHeight, node?.tipHeight)),
    tipHash: asString(firstValue(payload?.tipHash, node?.bestBlockHash)),
    summarySnapshotId: asString(summary?.snapshotId),
    summarySnapshotOk: summary?.ok === undefined ? null : Boolean(summary.ok),
  };
}

function workAmoV8FromPayload(payload) {
  return (
    payload?.workAmoV8 ??
    payload?.floor?.workAmoV8 ??
    payload?.workFloor?.workAmoV8 ??
    payload?.token?.workAmoV8 ??
    null
  );
}

function declarationEvidence(v8) {
  const latch = v8?.persistentActivationLatch ?? null;
  const evidence =
    v8?.declarationEvidence ??
    v8?.workerReadiness?.declarationEvidence ??
    v8?.migrationReadiness?.declarationEvidence ??
    latch;
  return {
    declarationTxid: asString(
      firstValue(
        evidence?.declarationTxid,
        evidence?.pins?.declarationTxid,
        latch?.declarationTxid,
        v8?.declarationTxid,
      ),
    ),
    declarationHeight: asInt(
      firstValue(
        evidence?.declarationHeight,
        evidence?.pins?.declarationHeight,
        latch?.declarationHeight,
      ),
    ),
    activationHeight: asInt(
      firstValue(
        evidence?.activationHeight,
        evidence?.pins?.activationHeight,
        latch?.activationHeight,
        v8?.activationHeight,
      ),
    ),
    evidenceComplete: Boolean(
      evidence?.evidenceComplete ??
        latch?.evidenceComplete ??
        v8?.evidenceComplete,
    ),
    coreVerified: Boolean(evidence?.coreVerified ?? latch?.coreVerified),
    indexVerified: Boolean(evidence?.indexVerified ?? latch?.indexVerified),
    configuredPinsMatch: Boolean(
      evidence?.configuredPinsMatch ?? latch?.configuredPinsMatch,
    ),
  };
}

function v8Summary(v8) {
  if (!v8 || typeof v8 !== "object") return null;
  const worker = v8.workerReadiness ?? null;
  const migration = v8.migrationReadiness ?? null;
  const activation = v8.activation ?? v8.persistentActivationLatch ?? null;
  return {
    ready: Boolean(v8.ready),
    status: asString(v8.status),
    indexReady: Boolean(v8.indexReady ?? v8.indexReadiness?.ready),
    migrationReady: Boolean(v8.migrationReady ?? migration?.ready),
    declarationReady: Boolean(v8.declarationReady ?? v8.definitionReady),
    evidenceComplete: Boolean(
      v8.evidenceComplete ??
        v8.persistentActivationLatch?.evidenceComplete,
    ),
    pendingWitnessReady: Boolean(v8.pendingWitnessReady),
    workerReady: Boolean(worker?.ready),
    workerState: asString(worker?.state),
    workerTipHeight: asInt(worker?.tipHeight),
    workerTipHash: asString(worker?.tipHash),
    migrationTipHeight: asInt(migration?.tipHeight),
    migrationTipHash: asString(migration?.tipHash),
    tipHeight: asInt(v8.tipHeight),
    tipHash: asString(v8.tipHash),
    snapshotHeight: asInt(
      firstValue(v8.snapshotHeight, v8.replayHeight, v8.indexedThroughBlock),
    ),
    snapshotHash: asString(
      firstValue(
        v8.snapshotHash,
        v8.replayHash,
        v8.indexedThroughBlockHash,
      ),
    ),
    activationTipVerified: Boolean(
      activation?.tipVerified ?? v8.activationTipVerified,
    ),
    declarationEvidence: declarationEvidence(v8),
  };
}

function routeSummary(fetchResult, nestedKey) {
  return {
    label: fetchResult.label,
    status: fetchResult.status,
    ok: fetchResult.ok,
    elapsedMs: fetchResult.elapsedMs,
    checkpoint: checkpointFromPayload(fetchResult.payload, nestedKey),
    workAmoV8: v8Summary(workAmoV8FromPayload(fetchResult.payload)),
    error: asString(fetchResult.payload?.error) ?? asString(fetchResult.error),
    errorCode: asString(fetchResult.payload?.details?.code),
    reason: asString(fetchResult.payload?.details?.reason),
  };
}

function compactIssue(severity, kind, message, details = {}) {
  return { severity, kind, message, details };
}

function checkpointMismatch(a, b) {
  return (
    a.indexedThroughBlock !== null &&
    b.indexedThroughBlock !== null &&
    (a.indexedThroughBlock !== b.indexedThroughBlock ||
      a.indexedThroughBlockHash !== b.indexedThroughBlockHash ||
      a.snapshotId !== b.snapshotId)
  );
}

function pushLatencyIssues(issues, measurements) {
  for (const measurement of measurements) {
    if (measurement.elapsedMs > CRITICAL_MS) {
      issues.push(
        compactIssue(
          "error",
          "route-latency-critical",
          `${measurement.label} exceeded critical latency threshold`,
          { elapsedMs: measurement.elapsedMs, criticalMs: CRITICAL_MS },
        ),
      );
    } else if (measurement.elapsedMs > WARN_MS) {
      issues.push(
        compactIssue(
          "warning",
          "route-latency-slow-correct",
          `${measurement.label} exceeded warning latency threshold`,
          { elapsedMs: measurement.elapsedMs, warnMs: WARN_MS },
        ),
      );
    }
  }
}

function pushHttpIssues(issues, route) {
  if (route.ok) return;
  const staleError =
    route.errorCode === "REGISTRY_AUTHORITY_UNAVAILABLE" ||
    /checkpoint|catching up|behind|stale/iu.test(
      `${route.error ?? ""} ${route.reason ?? ""}`,
    );
  issues.push(
    compactIssue(
      "error",
      staleError ? "stale-readiness" : "route-http",
      `${route.label} did not return an OK payload`,
      {
        status: route.status,
        error: route.error,
        errorCode: route.errorCode,
        reason: route.reason,
      },
    ),
  );
}

function pushCheckpointIssues(issues, health, work, marketplace) {
  for (const route of [work, marketplace]) {
    const checkpoint = route.checkpoint;
    if (!route.ok) continue;
    if (
      checkpoint.indexedThroughBlock === null ||
      !isBlockHash(checkpoint.indexedThroughBlockHash)
    ) {
      issues.push(
        compactIssue(
          "error",
          "route-checkpoint-missing",
          `${route.label} is missing a verifiable indexed checkpoint`,
          { checkpoint },
        ),
      );
      continue;
    }
    if (
      health.indexedThroughBlock !== null &&
      checkpoint.indexedThroughBlock !== health.indexedThroughBlock
    ) {
      const lag = health.indexedThroughBlock - checkpoint.indexedThroughBlock;
      if (lag > MAX_LAG_BLOCKS) {
        issues.push(
          compactIssue(
            "error",
            "stale-readiness",
            `${route.label} checkpoint is behind health/index checkpoint`,
            {
              routeHeight: checkpoint.indexedThroughBlock,
              healthHeight: health.indexedThroughBlock,
              lag,
              maxLagBlocks: MAX_LAG_BLOCKS,
            },
          ),
        );
      }
    }
  }

  if (work.ok && marketplace.ok && checkpointMismatch(work.checkpoint, marketplace.checkpoint)) {
    issues.push(
      compactIssue(
        "error",
        "cross-route-checkpoint-mismatch",
        "work-summary and marketplace-summary do not share the same checkpoint",
        { work: work.checkpoint, marketplace: marketplace.checkpoint },
      ),
    );
  }
}

function pushHealthIssues(issues, health) {
  if (!health.available) {
    issues.push(
      compactIssue("error", "health-unavailable", "API health is unavailable"),
    );
  }
  if (!health.ready) {
    issues.push(
      compactIssue("error", "stale-readiness", "API health is not ready", {
        lagBlocks: health.lagBlocks,
        indexedThroughBlock: health.indexedThroughBlock,
        tipHeight: health.tipHeight,
      }),
    );
  }
  if (health.lagBlocks !== null && health.lagBlocks > HEALTH_MAX_LAG_BLOCKS) {
    issues.push(
      compactIssue(
        "error",
        "stale-readiness",
        "API health lag exceeds the readiness threshold",
        { lagBlocks: health.lagBlocks, maxLagBlocks: HEALTH_MAX_LAG_BLOCKS },
      ),
    );
  }
  if (health.summarySnapshotOk === false) {
    issues.push(
      compactIssue(
        "error",
        "stale-readiness",
        "Health summary snapshot is not marked OK",
        { summarySnapshotId: health.summarySnapshotId },
      ),
    );
  }
}

function pushV8Issues(issues, work, marketplace) {
  if (!work.ok || !marketplace.ok) return;
  for (const route of [work, marketplace]) {
    const v8 = route.workAmoV8;
    if (!v8) {
      issues.push(
        compactIssue(
          "error",
          "work-amo-v8-missing",
          `${route.label} is missing WORK AMO V8 readiness metadata`,
        ),
      );
      continue;
    }
    const evidence = v8.declarationEvidence;
    if (evidence.declarationTxid !== WORK_AMO_V8_DECLARATION_TXID) {
      issues.push(
        compactIssue(
          "error",
          "work-amo-v8-declaration-mismatch",
          `${route.label} does not expose the canonical V8 declaration txid`,
          { declarationTxid: evidence.declarationTxid },
        ),
      );
    }
    if (
      !evidence.evidenceComplete ||
      !evidence.coreVerified ||
      !evidence.indexVerified ||
      !evidence.configuredPinsMatch
    ) {
      issues.push(
        compactIssue(
          "error",
          "work-amo-v8-declaration-evidence",
          `${route.label} V8 declaration evidence is incomplete`,
          evidence,
        ),
      );
    }
    if (
      v8.workerTipHeight !== null &&
      route.checkpoint.indexedThroughBlock !== null &&
      v8.workerTipHeight !== route.checkpoint.indexedThroughBlock
    ) {
      issues.push(
        compactIssue(
          "error",
          "stale-readiness",
          `${route.label} worker readiness checkpoint differs from the route checkpoint`,
          {
            workerTipHeight: v8.workerTipHeight,
            routeHeight: route.checkpoint.indexedThroughBlock,
          },
        ),
      );
    }
  }

  const workV8 = work.workAmoV8;
  const marketplaceV8 = marketplace.workAmoV8;
  if (!workV8 || !marketplaceV8) return;

  const comparableFields = [
    "ready",
    "status",
    "workerReady",
    "workerTipHeight",
    "workerTipHash",
    "tipHeight",
    "tipHash",
    "pendingWitnessReady",
  ];
  for (const field of comparableFields) {
    if (workV8[field] !== marketplaceV8[field]) {
      issues.push(
        compactIssue(
          "error",
          "work-amo-v8-cross-route-mismatch",
          `WORK AMO V8 ${field} differs across summary routes`,
          { work: workV8[field], marketplace: marketplaceV8[field] },
        ),
      );
    }
  }

  const workEvidence = workV8.declarationEvidence;
  const marketplaceEvidence = marketplaceV8.declarationEvidence;
  for (const field of ["declarationTxid", "declarationHeight", "activationHeight"]) {
    if (workEvidence[field] !== marketplaceEvidence[field]) {
      issues.push(
        compactIssue(
          "error",
          "work-amo-v8-declaration-cross-route-mismatch",
          `WORK AMO V8 declaration ${field} differs across summary routes`,
          { work: workEvidence[field], marketplace: marketplaceEvidence[field] },
        ),
      );
    }
  }
}

function summarizeIssues(issues) {
  const activeInvariantFailures = issues.filter(
    (issue) =>
      issue.severity === "error" &&
      !["stale-readiness", "route-latency-critical"].includes(issue.kind),
  );
  const staleReadiness = issues.filter((issue) => issue.kind === "stale-readiness");
  const latency = issues.filter((issue) => issue.kind.startsWith("route-latency"));
  const warnings = issues.filter((issue) => issue.severity === "warning");
  return {
    ok: activeInvariantFailures.length === 0 && staleReadiness.length === 0,
    activeInvariantFailures,
    staleReadiness,
    latency,
    warnings,
    counts: {
      activeInvariantFailures: activeInvariantFailures.length,
      staleReadiness: staleReadiness.length,
      latencyWarnings: latency.filter((issue) => issue.severity === "warning").length,
      latencyErrors: latency.filter((issue) => issue.severity === "error").length,
      warnings: warnings.length,
      total: issues.length,
    },
  };
}

async function main() {
  const [healthFetch, workFetch, marketplaceFetch] = await Promise.all([
    fetchJson("health", routeUrl("/health")),
    fetchJson(
      "work-summary",
      routeUrl("/api/v1/work-summary", { network: NETWORK, compact: "1" }),
    ),
    fetchJson(
      "marketplace-summary",
      routeUrl("/api/v1/marketplace-summary", {
        network: NETWORK,
        compact: "1",
      }),
    ),
  ]);

  const health = healthCheckpoint(healthFetch.payload);
  const work = routeSummary(workFetch, "workSummary");
  const marketplace = routeSummary(marketplaceFetch, "marketplaceSummary");
  const issues = [];

  pushLatencyIssues(issues, [healthFetch, workFetch, marketplaceFetch]);
  pushHttpIssues(issues, work);
  pushHttpIssues(issues, marketplace);
  pushHealthIssues(issues, health);
  pushCheckpointIssues(issues, health, work, marketplace);
  pushV8Issues(issues, work, marketplace);

  const summary = summarizeIssues(issues);
  const result = {
    checkedAt: new Date().toISOString(),
    base: BASE,
    network: NETWORK,
    ok: summary.ok,
    thresholds: {
      timeoutMs: TIMEOUT_MS,
      warnMs: WARN_MS,
      criticalMs: CRITICAL_MS,
      maxLagBlocks: MAX_LAG_BLOCKS,
      healthMaxLagBlocks: HEALTH_MAX_LAG_BLOCKS,
    },
    summary,
    health,
    routes: {
      work,
      marketplace,
    },
  };

  console.log(JSON.stringify(result, null, 2));

  if (!summary.ok) {
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack : String(error));
  process.exitCode = 1;
});
