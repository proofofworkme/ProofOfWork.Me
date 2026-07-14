#!/usr/bin/env node

import { readFileSync } from "node:fs";

const server = readFileSync("server/proof-api.mjs", "utf8");
const reader = readFileSync("server/db/proof-index-reader.mjs", "utf8");
const service = readFileSync("deploy/proofofwork-api-proof-index.conf", "utf8");
const failures = [];

function expect(name, condition) {
  if (!condition) {
    failures.push(name);
  }
}

function sliceBetween(startPattern, endPattern) {
  const start = server.search(startPattern);
  if (start < 0) {
    return "";
  }
  const rest = server.slice(start);
  const end = rest.search(endPattern);
  return end < 0 ? rest : rest.slice(0, end);
}

const summaryRead = sliceBetween(
  /async function summaryCanonicalLedgerPayload/,
  /async function activityPayloadWithLiveWorkTokenOverlay/,
);
const freshSummaryRead = summaryRead.split('\n  if (network === "livenet")')[0];
const provenance = sliceBetween(
  /async function summaryPayloadWithCanonicalProvenance/,
  /function growthSummaryPayloadFromLedger/,
);
const compaction = sliceBetween(
  /function compactTokenSummaryPayload/,
  /function workTokenLiveSeenTxids/,
);
const publicGate = sliceBetween(
  /async function loadCanonicalPublicReadGate/,
  /async function canonicalPublicReadGate/,
);
const requestGate = sliceBetween(
  /const authenticatedLoopbackRead = internalVerifierRequestAllowed/,
  /if \(url\.pathname === "\/api\/v1\/internal\/token-verifier"\)/,
);
const logRoute = sliceBetween(
  /url\.pathname === "\/api\/v1\/activity" \|\| url\.pathname === "\/api\/v1\/log"/,
  /url\.pathname === "\/api\/v1\/activity-history"/,
);
const broadcastAdmission = sliceBetween(
  /function broadcastOriginAllowed/,
  /async function broadcastSlipstreamPayload/,
);
const requestBodyRead = sliceBetween(
  /function requestBodyReadError/,
  /function normalizeBroadcastTxid/,
);
const tokenReplay = sliceBetween(
  /function tokenStateFromTransactions/,
  /function workTransfersFromTransactions/,
);
const verifier = sliceBetween(
  /async function completeTokenVerifierState/,
  /async function completeIdVerifierStateBundle/,
);

expect(
  "fresh canonical summaries require an exact-tip ledger",
  /exactTipLedgerPayloadOrNull/u.test(summaryRead) &&
    /Fresh canonical ledger is catching up/u.test(summaryRead),
);
expect(
  "fresh canonical summaries do not return the finite stale fallback",
  !/return ledgerPayloadHasFiniteNetworkValues\(fallback\) \? fallback : null/u.test(
    freshSummaryRead,
  ),
);
expect(
  "summary responses expose one canonical provenance contract",
  /proof-of-work-canonical-summary-v1/u.test(provenance) &&
    /missingSnapshotIds\.length === 0 && snapshotIds\.length === 1/u.test(
      provenance,
    ) &&
    /verifiedSummaryPayloadCheckpoint/u.test(provenance) &&
    /served: ready \? "exact-tip" : "last-good"/u.test(provenance),
);
expect(
  "stable summaries also reject incoherent or unidentified snapshots",
  /if \(!coherent \|\| \(network === "livenet" && !snapshotId\)\)/u.test(
    provenance,
  ) && /CANONICAL_SUMMARY_INCOHERENT/u.test(provenance),
);
expect(
  "fresh summary provenance fails closed while catching up",
  /if \(requestedFresh && !ready\)/u.test(provenance) &&
    /CANONICAL_SUMMARY_CATCHING_UP/u.test(provenance),
);
expect(
  "truncated credit summaries preserve authoritative statistics",
  /const authoritativeStat/u.test(compaction) &&
    /preserveExistingTokenMetrics && existing !== undefined/u.test(
      compaction,
    ) &&
    /if \(!preserveExistingTokenMetrics\) \{[\s\S]*return computed/u.test(
      compaction,
    ) && /return null/u.test(compaction),
);
expect(
  "credit summaries expose collection totals and continuation state",
  /totalCounts/u.test(compaction) &&
    /collectionHasMore/u.test(compaction) &&
    /hasMore: Object\.values\(collectionHasMore\)\.some\(Boolean\)/u.test(
      compaction,
    ),
);
expect(
  "stable canonical reads use a canonical checkpoint while readiness remains exact-tip",
  /const available =/u.test(publicGate) &&
    /const ready =/u.test(publicGate) &&
    /indexedThroughBlock <= tipHeight/u.test(publicGate),
);
expect(
  "block-scan selectors cannot mistake canonical summary rows for checkpoints",
  (reader.match(/AND NOT \(source_hashes \? 'canonicalSummary'\)/gu) ?? [])
    .length >= 5,
);
expect(
  "only fresh reads require exact-tip readiness at the public gate",
  /if \(freshRead && gate\.ready !== true\)/u.test(requestGate) &&
    /CANONICAL_INDEX_CATCHING_UP/u.test(requestGate),
);
expect(
  "fresh paginated Log reads use relational state bound to the exact summary",
  /"limit"/u.test(logRoute) &&
    /"offset"/u.test(logRoute) &&
    /freshRead && !exactLogQueryTxid[\s\S]*freshProofIndexLogHistoryPayload/u.test(
      logRoute,
    ) &&
    /exactLogHistoryMissPayload/u.test(logRoute) &&
    /if \(exactLogQueryTxid\)[\s\S]*indexed exact Log lookup is temporarily unavailable/u.test(
      logRoute,
    ) &&
    /activityHistoryPayload/u.test(logRoute) &&
    /pageSnapshotTotal !== summaryTotal/u.test(server) &&
    /boundSearchParams\.set\("snapshot", summarySnapshotId\)/u.test(
      server,
    ) &&
    /e\.updated_at <= \$\{snapshotTimeParam\}::timestamptz/u.test(reader) &&
    /snapshotTotalCount/u.test(reader) &&
    /offsetRaw[\s\S]*transactionId/u.test(server) &&
    /offsetRaw[\s\S]*transactionId/u.test(reader),
);
expect(
  "Core and Electrum pending reads preserve Bitcoin Core mempool admission time",
  (server.match(/bitcoinRpc\("getmempoolentry"/gu) ?? []).length >= 2 &&
    (server.match(/mempool_time: mempoolTime/gu) ?? []).length >= 2,
);
expect(
  "browser broadcast origins are validated",
  /hostname\.endsWith\("\.proofofwork\.me"\)/u.test(broadcastAdmission) &&
    /BROADCAST_ORIGIN_REJECTED/u.test(broadcastAdmission) &&
    /return BROADCAST_ALLOW_MISSING_ORIGIN/u.test(broadcastAdmission),
);
expect(
  "broadcast has per-client, global, and concurrency limits",
  /BROADCAST_CLIENT_RATE_LIMIT/u.test(broadcastAdmission) &&
    /BROADCAST_GLOBAL_RATE_LIMIT/u.test(broadcastAdmission) &&
    /BROADCAST_CONCURRENCY_LIMIT/u.test(broadcastAdmission),
);
expect(
  "livenet broadcast requires an exact-tip verified canonical gate",
  /canonicalPublicReadGate\(network, \{ force: true \}\)/u.test(
    broadcastAdmission,
  ) &&
    /beforeSubmit/u.test(broadcastAdmission) &&
    /BROADCAST_CANONICAL_CHECKPOINT_CHANGED/u.test(broadcastAdmission),
);
expect(
  "broadcast uploads and HTTP request intake have explicit deadlines",
  /REQUEST_BODY_TIMEOUT/u.test(requestBodyRead) &&
    /clearTimeout\(timer\)/u.test(requestBodyRead) &&
    /request\.off\("data", onData\)/u.test(requestBodyRead) &&
    /request\.destroy\(\)/u.test(requestBodyRead) &&
    /timeoutMs: BROADCAST_BODY_TIMEOUT_MS/u.test(server) &&
    /server\.headersTimeout = HTTP_HEADERS_TIMEOUT_MS/u.test(server) &&
    /server\.requestTimeout = HTTP_REQUEST_TIMEOUT_MS/u.test(server) &&
    [
      "POW_API_BROADCAST_BODY_TIMEOUT_MS=10000",
      "POW_API_HEADERS_TIMEOUT_MS=10000",
      "POW_API_REQUEST_TIMEOUT_MS=30000",
    ].every((setting) => service.includes(setting)),
);
expect(
  "proof-index API service confinement is self-contained",
  [
    "NoNewPrivileges=true",
    "PrivateTmp=true",
    "ProtectSystem=strict",
    "ProtectHome=true",
    "UMask=0027",
  ].every((setting) => service.includes(setting)),
);
expect(
  "generic credit mints reject reserved bond assets",
  /BOND_TOKEN_IDS\.has\(parsed\.tokenId\)/u.test(tokenReplay),
);
expect(
  "generic credit mints require their definition to precede the event",
  /tokenDefinitionPrecedesTransaction\(mintedToken, tx\)/u.test(tokenReplay),
);
expect(
  "the ordered verifier seeds every configured bond family",
  /for \(const config of BOND_TOKEN_CONFIGS\)/u.test(verifier) &&
    /bondMintsFromActivity/u.test(verifier),
);
expect(
  "live USD remains derived from actual total proofs",
  /totalUsd: satsToUsdAtBtcUsd\(totalSats, btcUsdMetadata\.btcUsd\)/u.test(
    server,
  ),
);

async function optionalLiveChecks() {
  const base = String(process.env.POW_API_BASE ?? "").replace(/\/+$/u, "");
  if (!base) {
    return;
  }
  const getJson = async (path) => {
    const response = await fetch(`${base}${path}`, {
      signal: AbortSignal.timeout(90_000),
    });
    if (!response.ok) {
      throw new Error(`${path} returned HTTP ${response.status}`);
    }
    return response.json();
  };
  for (const route of [
    "/api/v1/log-summary?network=livenet",
    "/api/v1/token-summary?network=livenet",
    "/api/v1/work-floor?network=livenet",
    "/api/v1/marketplace-summary?network=livenet",
    "/api/v1/growth-summary?network=livenet",
  ]) {
    const payload = await getJson(route);
    expect(`${route} exposes coherent provenance`, payload?.provenance?.coherent === true);
    expect(`${route} exposes a snapshot id`, Boolean(payload?.provenance?.snapshotId));
  }
  const logPage = await getJson("/api/v1/log?network=livenet&limit=1");
  const items = Array.isArray(logPage?.items)
    ? logPage.items
    : Array.isArray(logPage?.activity)
      ? logPage.activity
      : [];
  expect("legacy Log limit=1 returns at most one row", items.length <= 1);
  expect(
    "legacy Log pagination exposes totalCount",
    Number.isFinite(Number(logPage?.totalCount)),
  );
}

await optionalLiveChecks();

if (failures.length > 0) {
  console.error("API truth contract check failed:");
  for (const failure of failures) {
    console.error(`- ${failure}`);
  }
  process.exit(1);
}

console.log("API truth contract check passed.");
