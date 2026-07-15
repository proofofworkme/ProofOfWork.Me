#!/usr/bin/env node

import { readFileSync } from "node:fs";

const server = readFileSync("server/proof-api.mjs", "utf8");
const reader = readFileSync("server/db/proof-index-reader.mjs", "utf8");
const backfill = readFileSync("scripts/backfill-proof-indexer.mjs", "utf8");
const worker = readFileSync("scripts/run-proof-indexer-worker.mjs", "utf8");
const ledgerAudit = readFileSync(
  "scripts/audit-ledger-consistency.mjs",
  "utf8",
);
const service = readFileSync("deploy/proofofwork-api-proof-index.conf", "utf8");
const failures = [];
const readerPublicLogKinds =
  /const PUBLIC_LOG_EVENT_KINDS = new Set\(\[([\s\S]*?)\]\);/u.exec(
    reader,
  )?.[1] ?? "";
const backfillPublicLogKinds =
  /const PUBLIC_LOG_EVENT_KINDS = new Set\(\[([\s\S]*?)\]\);/u.exec(
    backfill,
  )?.[1] ?? "";
const normalizedQuotedItems = (value) =>
  [...String(value).matchAll(/"([^"]+)"/gu)]
    .map((match) => match[1])
    .sort()
    .join(",");

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
const pendingWorkSupplyCapVerifier = sliceBetween(
  /function pendingWorkMintFromHydratedTransaction/,
  /async function tokenVerifierDeterministicInvalidReason/,
);
const stableCrossLedgerAudit = (() => {
  const start = ledgerAudit.indexOf("async function readStableCrossLedgerBatch");
  const end = ledgerAudit.indexOf("function isGullishBuyerTokenSale", start);
  return start < 0 ? "" : ledgerAudit.slice(start, end < 0 ? undefined : end);
})();

expect(
  "fresh canonical summaries require an exact-tip ledger",
  /exactTipLedgerPayloadOrNull/u.test(summaryRead) &&
    /Fresh canonical ledger is catching up/u.test(summaryRead),
);
expect(
  "fresh ledger token fallback starts from the exact relational token state",
  /async function ledgerTokenPayload[\s\S]*indexedTokenStateForCanonicalLedger\(network, scope\)[\s\S]*tokenStateWithLivePendingTransactionCheck\(indexedFallback, network\)[\s\S]*fastTokenPayloadSnapshot/u.test(
    server,
  ),
);
expect(
  "pending credit liveness only drops after affirmative Core absence proof",
  /async function tokenStateWithLivePendingTransactionCheck[\s\S]*bitcoinCoreTxStatusPayload\(txid, network\)[\s\S]*status\.absenceProven === true[\s\S]*pending-liveness-core-proof/u.test(
    server,
  ),
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
  "fresh full Log reads use canonical transaction truth bound to the exact summary",
  /async function freshProofIndexLogPayload/u.test(server) &&
    /proofIndexCanonicalActivityPayload\(network, \{[\s\S]*snapshotId: summarySnapshotId/u.test(
      server,
    ) &&
    /pageSnapshotTotal !== summaryTotal/u.test(server) &&
    /activity\.length !== summaryTotal/u.test(server) &&
    /pagePending !== summaryPending/u.test(server) &&
    /verifiedCanonicalMinerFeeCoverage/u.test(server) &&
    /verifiedFreshLogCheckpointAfterRead\(summary, network, "log"\)/u.test(
      server,
    ) &&
    /await freshProofIndexLogPayload\(network\)/u.test(logRoute) &&
    /e\.updated_at <= \$4::timestamptz/u.test(reader) &&
    /snapshotTotalCount: requestedSnapshotId \? items\.length/u.test(reader),
);
expect(
  "fresh standalone Log history uses the same exact-summary relational gate",
  (server.match(/freshRead && !exactLogQueryTxid/gu) ?? []).length >= 2 &&
    (server.match(/\? await freshProofIndexLogHistoryPayload/gu) ?? [])
      .length >= 2 &&
    /logHistoryEligibility\.eligible \|\|[\s\S]*freshRead && !exactLogQueryTxid/u.test(
      server,
    ) &&
    /verifiedFreshLogCheckpointAfterRead\([\s\S]*"log-history"/u.test(
      server,
    ) &&
    /CANONICAL_LOG_HISTORY_TIP_CHANGED/u.test(server),
);
expect(
  "Core and Electrum pending reads preserve Bitcoin Core mempool admission time",
  (server.match(/bitcoinRpc\("getmempoolentry"/gu) ?? []).length >= 2 &&
    (server.match(/mempool_time: mempoolTime/gu) ?? []).length >= 2,
);
expect(
  "transaction status requires authoritative v2 evidence and never maps dependency failure to dropped",
  /async function bitcoinCoreTxStatusPayload/u.test(server) &&
    /proof-of-work-tx-status-v2/u.test(server) &&
    /TX_STATUS_UNAVAILABLE/u.test(server) &&
    /absenceProven: true/u.test(server) &&
    /bitcoinRpc\("getindexinfo", \["txindex"\]\)/u.test(server) &&
    /chain\.chain !== "main"/u.test(server) &&
    /txindex\.synced !== true/u.test(server) &&
    /bitcoinRpc\("getblockhash"/u.test(server) &&
    /bitcoinRpc\("getblock"/u.test(server) &&
    /canonical_scan_proof/u.test(reader),
);
expect(
  "worker status transitions are locked, evidence-gated, and canonical promotions are deferred",
  /const PENDING_DROP_CONFIRMATION_MS = pendingDropConfirmationMs\(\s*process\.env\.POW_INDEX_PENDING_DROP_CONFIRMATION_MS/u.test(
    worker,
  ) &&
    /function pendingDropConfirmationMs[\s\S]*Math\.max\(\s*5 \* 60_000,[\s\S]*Number\.isFinite\(configured\)/u.test(
      worker,
    ) &&
    /function authoritativeDroppedStatusEvidence[\s\S]*sources\.length === requiredSources\.length[\s\S]*requiredSources\.every/u.test(
      worker,
    ) &&
    [
      "absent-from-synced-unpruned-mainnet-bitcoin-core-txindex-and-mempool",
      "bitcoin-core:getrawtransaction",
      "bitcoin-core:getmempoolentry",
      "bitcoin-core:getblockchaininfo",
      "bitcoin-core:getindexinfo:txindex",
    ].every((value) => worker.includes(value)) &&
    /SELECT status, raw_tx[\s\S]*FOR UPDATE/u.test(worker) &&
    /WHERE network = \$1 AND txid = \$2 AND status = 'pending'/u.test(worker) &&
    /canonical-block-scan-required/u.test(worker) &&
    /repeat-absence-required/u.test(worker) &&
    /priorObservation\?\.absenceStartedAt \?\? ""/u.test(
      worker,
    ) &&
    /evidence\.absenceStartedAt = new Date\(absenceStartedAtMs\)\.toISOString\(\)/u.test(
      worker,
    ) &&
    /observedAtMs >= absenceStartedAtMs \+ PENDING_DROP_CONFIRMATION_MS/u.test(
      worker,
    ) &&
    /normalizedStatus === "confirmed"[\s\S]*statusObservation[\s\S]*canonical-block-scan-required/u.test(
      worker,
    ) &&
    /absenceProven:[\s\S]*normalizedStatus === "dropped" \? payload\.absenceProven : undefined/u.test(
      worker,
    ) &&
    /priorObservation\?\.status === "dropped" &&[\s\S]*authoritativeDroppedStatusEvidence\(priorObservation\)/u.test(
      worker,
    ) &&
    (worker.match(/'dropped', true/gu) ?? []).length >= 3 &&
    /block_hash = NULL/u.test(worker) &&
    !/SET status = 'dropped'[\s\S]*\(listing_id = \$2 OR seal_txid = \$2 OR close_txid = \$2\)/u.test(
      worker,
    ),
);
expect(
  "dropped token definitions cannot remain in current token state",
  (reader.match(
    /definition_transaction\.status IN \('confirmed', 'pending'\)/gu,
  ) ?? []).length >= 2 &&
    (reader.match(/metadata->>'canonicalSynthetic' = 'true'/gu) ?? [])
      .length >= 2,
);
expect(
  "same-height pending Log membership versions the canonical summary",
  normalizedQuotedItems(backfillPublicLogKinds) ===
    normalizedQuotedItems(readerPublicLogKinds) &&
    /async function publicLogRelationalFingerprint/u.test(backfill) &&
    /publicLogFingerprintsMatch\([\s\S]*currentPublicLogFingerprint[\s\S]*previousPublicLogFingerprint/u.test(
      backfill,
    ) &&
    /publicLogRelational: finalPublicLogFingerprint\.hash/u.test(backfill) &&
    /publicLogFingerprint: finalPublicLogFingerprint/u.test(backfill) &&
    /const pendingStatus = await refreshPendingStatuses\(pool\);[\s\S]*await runBackfillWithRetries\(backfillEnv\);/u.test(
      worker,
    ),
);
expect(
  "rebroadcasts and dropped listing actions cannot retain stale terminal state",
  /dropped_at = CASE[\s\S]*EXCLUDED\.status IN \('pending', 'confirmed'\)[\s\S]*THEN NULL/u.test(
    backfill,
  ) &&
    /- 'statusObservation'/u.test(backfill) &&
    /WITH affected AS[\s\S]*base_event\.payload AS base_payload/u.test(
      worker,
    ) &&
    /buyer_address = NULL/u.test(worker) &&
    /- 'closeTxid'[\s\S]*- 'closedTxid'[\s\S]*- 'buyerAddress'/u.test(
      worker,
    ),
);
expect(
  "event block heights are inserted with an explicit integer parameter type",
  /CASE WHEN \$3 = 'confirmed' THEN \$5::integer ELSE NULL END/u.test(
    backfill,
  ),
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
  "pending WORK supply-cap classification is Core-current and exact-tip indexed",
  /network !== "livenet"[\s\S]*tokenScope !== WORK_TOKEN_ID/u.test(
    pendingWorkSupplyCapVerifier,
  ) &&
    /fetchTransactionFromBitcoinRpc[\s\S]*requireCanonicalPrevouts: true[\s\S]*getmempoolentry/u.test(
      pendingWorkSupplyCapVerifier,
    ) &&
    /inputAddresses\(vin\)\[0\][\s\S]*isValidBitcoinAddress\(actorAddress, network\)/u.test(
      pendingWorkSupplyCapVerifier,
    ) &&
    /proofIndexExactlyCoversCoreTip/u.test(pendingWorkSupplyCapVerifier) &&
    /targetPendingMints !== 0/u.test(pendingWorkSupplyCapVerifier) &&
    /pendingCandidatesComplete !== true/u.test(pendingWorkSupplyCapVerifier) &&
    /candidate\.txid\.localeCompare\(normalizedTargetTxid\) >= 0/u.test(
      pendingWorkSupplyCapVerifier,
    ) &&
    (pendingWorkSupplyCapVerifier.match(
      /proofIndexTokenMintStatsPayload\(/gu,
    ) ?? []).length === 2 &&
    /validatedWitnessSupply !== witnessProof\.witnessSupply/u.test(
      pendingWorkSupplyCapVerifier,
    ) &&
    /finalMempoolMembership\.some\(\(present\) => present !== true\)/u.test(
      pendingWorkSupplyCapVerifier,
    ) &&
    /finalWitnessProof\.witnesses\.some/u.test(
      pendingWorkSupplyCapVerifier,
    ) &&
    !/supply\.acceptedSupply/u.test(pendingWorkSupplyCapVerifier) &&
    /proof-indexer-pending-work-supply-cap-verifier/u.test(
      pendingWorkSupplyCapVerifier,
    ),
);
expect(
  "ledger audit brackets fresh cross-ledger reads with stable sentinels",
  /CROSS_LEDGER_AUDIT_MAX_ATTEMPTS = 3/u.test(ledgerAudit) &&
    (stableCrossLedgerAudit.match(
      /readJson\(\s*"\/api\/v1\/work-floor\?fresh=1"/gu,
    ) ?? []).length === 2 &&
    [
      '"/api/v1/consistency"',
      '"/api/v1/marketplace-summary?fresh=1"',
      '"/api/v1/infinity-summary?fresh=1"',
      '"/api/v1/inception-summary?fresh=1"',
      '"/api/v1/growth-summary?fresh=1"',
      "`/api/v1/token?asset=${POWB_TOKEN_ID}&fresh=1`",
      "`/api/v1/token?asset=${INCB_TOKEN_ID}&fresh=1`",
    ].every((path) => stableCrossLedgerAudit.includes(path)) &&
    /if \(snapshotSentinelsMatch\(before, after\)\) \{[\s\S]*return \{/u.test(
      stableCrossLedgerAudit,
    ) &&
    /payloadMatchesAuditSentinel\(payload, after, false\)/u.test(
      stableCrossLedgerAudit,
    ) &&
    /cross-ledger payloads diverged inside one stable canonical snapshot/u.test(
      stableCrossLedgerAudit,
    ) &&
    (stableCrossLedgerAudit.match(/\bcontinue;/gu) ?? []).length === 1 &&
    /if \(attempt < CROSS_LEDGER_AUDIT_MAX_ATTEMPTS\)[\s\S]*continue;/u.test(
      stableCrossLedgerAudit,
    ),
);
expect(
  "WORK pending cap ordering matches canonical pending transaction replay",
  /function sortWorkMintsForPendingCap[\s\S]*String\(left\.txid[\s\S]*localeCompare\(String\(right\.txid[\s\S]*Date\.parse\(left\.createdAt\)/u.test(
    server,
  ),
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
