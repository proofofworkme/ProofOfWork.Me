import { readFileSync } from "node:fs";

const server = readFileSync("server/proof-api.mjs", "utf8");
const electrumClient = readFileSync("server/electrum-client.mjs", "utf8");
const proofIndexReader = readFileSync("server/db/proof-index-reader.mjs", "utf8");
const proofIndexerBackfill = readFileSync("scripts/backfill-proof-indexer.mjs", "utf8");
const proofIndexerWorker = readFileSync("scripts/run-proof-indexer-worker.mjs", "utf8");
const proofIndexerWorkerService = readFileSync(
  "deploy/proofofwork-indexer-worker.service",
  "utf8",
);
const proofIndexerSchema = readFileSync(
  "server/sql/proof-indexer-v1.sql",
  "utf8",
);
const app = readFileSync("src/App.tsx", "utf8");
const routeRegistry = readFileSync("src/app/routeRegistry.ts", "utf8");
const proofIndexDeploy = readFileSync("deploy/proofofwork-api-proof-index.conf", "utf8");
const proofIndexDbRoleLimits = readFileSync(
  "deploy/proof-indexer-db-role-limits.sql",
  "utf8",
);
const packageJson = readFileSync("package.json", "utf8");
const failures = [];

expectAll("API Electrum reads use one bounded persistent client", server, [
  /import \{ createElectrumClient \} from "\.\/electrum-client\.mjs"/,
  /const ELECTRUM_CLIENT = createElectrumClient\(\{[\s\S]*maxInFlight:[\s\S]*maxQueue:[\s\S]*maxResponseBytes:/,
  /function electrumRequest\(method, params, timeoutMs = 30_000\) \{[\s\S]*ELECTRUM_CLIENT\.request\(method, params, timeoutMs\)/,
]);
expectAll("Electrum transport is multiplexed and capacity bounded", electrumClient, [
  /class ElectrumClient/,
  /#operationsById = new Map\(\)/,
  /#queue = \[\]/,
  /#singleflight = new Map\(\)/,
  /new ElectrumQueueFullError/,
  /setKeepAlive\?\.\(true/,
  /this\.#operationsById\.set\(String\(id\), operation\)/,
]);
expectAll("canonical summary work is linear and latency-overlapped", server, [
  /function growthActualLiveTotalSatsAtProvider/,
  /function growthActualBaseNetworkValueBeforeCanonicalItemProvider/,
  /const baseValueBeforeCanonicalItem =\s*growthActualBaseNetworkValueBeforeCanonicalItemProvider\(/,
  /canonicalBaseLookup: canonicalBaseLookupDiagnostics/,
  /invalidCreatedAtRows/,
  /This provider preserves the same frozen\/live credit math/,
  /const BITCOIN_ADDRESS_VALIDATION_CACHE_MAX = 20_000/,
  /addresses\.size >= SEEDED_MAIL_ACTIVITY_MAX_ADDRESSES/,
  /currentTokenTableState,[\s\S]*currentMarketOverlay,[\s\S]*= await Promise\.all/,
  /workFloorWithIndexedMarketSummaryOverlay\([\s\S]*currentMarketOverlay/,
]);
const canonicalLedgerBuilderSource = sourceSliceBetween(
  server,
  /async function buildIndexedCanonicalLedgerPayload/,
  /function internalCanonicalWorkSummaryPayload/,
);
const ledgerSnapshotChecksSource = sourceSliceBetween(
  server,
  /function ledgerSnapshotChecks\(/,
  /function attachLedgerMetadata/,
);
expect(
  "canonical ledger builds the expensive WORK floor exactly once",
  (canonicalLedgerBuilderSource.match(/workFloorPayloadFromState\(/gu) ?? [])
    .length === 1,
);
expect(
  "frozen credit component reconciliation uses only a sub-proof local tolerance",
  /"credit-frozen-value-includes-event-components"[\s\S]*creditMinerFeeFlowSats,[\s\S]*0\.01,/u.test(
    ledgerSnapshotChecksSource,
  ),
);

if (/\bWORK_TOKEN_REGISTRY_ADDRESS\b/u.test(server)) {
  failures.push(
    "proof-api references the removed WORK_TOKEN_REGISTRY_ADDRESS identifier",
  );
}

function expect(name, condition) {
  if (!condition) {
    failures.push(name);
  }
}

function expectAll(name, text, patterns) {
  for (const pattern of patterns) {
    expect(`${name}: ${pattern}`, pattern.test(text));
  }
}

function sourceSliceBetween(text, startPattern, endPattern) {
  const start = text.search(startPattern);
  if (start === -1) {
    return "";
  }
  const rest = text.slice(start);
  const end = rest.search(endPattern);
  return end === -1 ? rest : rest.slice(0, end);
}

function serviceEnvironmentNumber(name) {
  const matches = [
    ...proofIndexerWorkerService.matchAll(
      new RegExp(`^Environment=${name}=([0-9]+)\\s*$`, "gmu"),
    ),
  ];
  if (matches.length !== 1) {
    return Number.NaN;
  }
  return Number(matches[0][1]);
}

const fetchAddressMailSource = sourceSliceBetween(
  app,
  /async function fetchAddressMail/,
  /async function fetchTransactionJson/,
);
const loadDesktopTargetSource = sourceSliceBetween(
  app,
  /\n  async function loadDesktopTarget/,
  /\n  function clearDesktop/,
);
const desktopAppSource = sourceSliceBetween(
  app,
  /function DesktopApp/,
  /function ActivityApp/,
);
const pendingMempoolBasesSource = sourceSliceBetween(
  server,
  /function pendingMempoolBases/,
  /function firstPartyAddressReadBases/,
);
const txHexPayloadSource = sourceSliceBetween(
  server,
  /async function txHexPayload/,
  /async function directTxOutspendPayload/,
);
const infinityAppSource = sourceSliceBetween(
  app,
  /function InfinityApp\(/,
  /function TokenWalletApp\(/,
);
const growthWorkspaceSource = sourceSliceBetween(
  app,
  /function GrowthWorkspace\(/,
  /function IdLaunchApp\(/,
);
const workFloorRouteSource = sourceSliceBetween(
  server,
  /url\.pathname === "\/api\/v1\/work-floor"/,
  /url\.pathname === "\/api\/v1\/work-summary"/,
);
const tokenHistoryRouteSource = sourceSliceBetween(
  server,
  /url\.pathname === "\/api\/v1\/token-history"/,
  /url\.pathname === "\/api\/v1\/work-floor"/,
);
const ledgerSnapshotWithPayloadSource = sourceSliceBetween(
  proofIndexReader,
  /async function ledgerSnapshotWithPayload/,
  /async function tokenStateSnapshotForScope/,
);
const compactActivitySummarySource = sourceSliceBetween(
  server,
  /function compactActivitySummaryPayload/,
  /function activityStatsFromItems/,
);
const proofIndexSnapshotPayloadSource = sourceSliceBetween(
  proofIndexReader,
  /export async function proofIndexSnapshotPayload/,
  /export async function proofIndexValueSummaryPayload/,
);
const fetchIdRecordStateSource = sourceSliceBetween(
  app,
  /async function fetchIdRecordState/,
  /async function fetchGlobalActivity/,
);
const registerIdSource = sourceSliceBetween(
  app,
  /\n  async function registerId/,
  /\n  async function broadcastIdMutation/,
);
const broadcastIdMutationSource = sourceSliceBetween(
  app,
  /\n  async function broadcastIdMutation/,
  /\n  async function prepareIdSaleAuthorization/,
);
const idSalePreflightSource = sourceSliceBetween(
  app,
  /\n  async function prepareIdSaleAuthorization/,
  /\n  async function publishIdListing/,
);
const idLaunchAppSource = sourceSliceBetween(
  app,
  /function IdLaunchApp\(/,
  /function finitePositiveNumber\(/,
);
const storedHistoryPageSource = sourceSliceBetween(
  proofIndexReader,
  /function historyPageFromStoredPayload\(/,
  /function tokenHistoryItemsFromSnapshot\(/,
);
const snapshotTokenHistoryPageSource = sourceSliceBetween(
  proofIndexReader,
  /function tokenHistoryPageFromSnapshot\(/,
  /export async function proofIndexTokenMarketHistoryOverlayPayload\(/,
);
const exactTransferRecoverySource = sourceSliceBetween(
  server,
  /function exactTransferHistoryNeedsCanonicalRecovery\(/,
  /async function tokenHistoryPageWithCanonicalCreditValueOverlay\(/,
);
const repairWorkParticipantsSource = sourceSliceBetween(
  proofIndexerBackfill,
  /async function repairConfirmedWorkTransferParticipants\(/,
  /async function repairWorkMintMinterAttribution\(/,
);
const canonicalIdRepairSource = sourceSliceBetween(
  proofIndexerBackfill,
  /async function canonicalIdRepairTarget\(/,
  /\nif \(DRY_RUN\)/,
);
const tokenHistoryCoverageProjectionSource = sourceSliceBetween(
  proofIndexReader,
  /function tokenHistoryPageWithScanCoverage\(/,
  /function tokenListingId\(/,
);
const canonicalRecoverySource = sourceSliceBetween(
  proofIndexerBackfill,
  /function recoveryEndpointSpecs\(/,
  /async function replaceCreditBalancesFromVerifier\(/,
);
const blockScanCheckpointSource = sourceSliceBetween(
  proofIndexerBackfill,
  /async function latestBlockScanCheckpoint\(/,
  /async function backfillBlockScanSource\(/,
);
const blockScanSource = sourceSliceBetween(
  proofIndexerBackfill,
  /async function backfillBlockScanSource\(/,
  /async function mempoolScanState\(/,
);
const mempoolScanSource = sourceSliceBetween(
  proofIndexerBackfill,
  /async function backfillMempoolScanSource\(/,
  /async function backfillSource\(/,
);
const livePendingRegistrySource = sourceSliceBetween(
  server,
  /async function livePendingRegistryPayload\(/,
  /async function proveCurrentIdAbsence\(/,
);
const currentIdCoverageSource = sourceSliceBetween(
  server,
  /async function proveCurrentIdAbsence\(/,
  /function promiseOutcomeWithin\(/,
);
const exactIdRouteSource = sourceSliceBetween(
  server,
  /const id = normalizePowId\(decodeURIComponent\(pathParts\[3\]\)\);/,
  /\n    if \(\n      pathParts\.length === 5/,
);
const tokenVerifierPayloadSource = sourceSliceBetween(
  server,
  /async function tokenVerifierPayload\(/,
  /async function idVerifierStateBundle\(/,
);
const idVerifierPayloadSource = sourceSliceBetween(
  server,
  /async function idVerifierPayload\(/,
  /function internalVerifierRequestAllowed\(/,
);
const indexedRegistryPayloadSource = sourceSliceBetween(
  server,
  /async function indexedRegistryPayload\(/,
  /function transactionInputAddresses\(/,
);
const internalVerifierRoutesSource = sourceSliceBetween(
  server,
  /if \(url\.pathname === "\/api\/v1\/internal\/token-verifier"\)/,
  /if \(url\.pathname === "\/api\/v1\/prices\/btc-usd"\)/,
);
const operationalScanMetadataSource = sourceSliceBetween(
  proofIndexReader,
  /async function latestProofIndexScanMetadata\(/,
  /async function latestProofIndexOperationalMetadata\(/,
);
const operationalHealthMetadataSource = sourceSliceBetween(
  proofIndexReader,
  /async function latestProofIndexOperationalMetadata\(/,
  /export async function proofIndexOperationalStatusPayload\(/,
);
const canonicalSummaryLedgerPayloadSource = sourceSliceBetween(
  proofIndexReader,
  /export async function proofIndexCanonicalSummaryLedgerPayload\(/,
  /export async function proofIndexSnapshotPayload\(/,
);
const addressIndexHealthSource = sourceSliceBetween(
  server,
  /async function addressIndexHealthPayload\(/,
  /async function electrumHealthPayload\(/,
);
const electrumHealthSource = sourceSliceBetween(
  server,
  /async function electrumHealthPayload\(/,
  /async function boundedHealthElectrumPayload\(/,
);
const boundedHealthElectrumSource = sourceSliceBetween(
  server,
  /async function boundedHealthElectrumPayload\(/,
  /async function filesystemHealthPayload\(/,
);
const fetchAddressUtxosFromElectrumSource = sourceSliceBetween(
  server,
  /async function fetchAddressUtxosFromElectrum\(/,
  /async function fetchAddressUtxosFromBlockchainInfo\(/,
);
const firstPartyAddressUtxoSource = sourceSliceBetween(
  server,
  /async function firstPartyAddressUtxoPayload\(/,
  /async function addressUtxoPayload\(/,
);
const addressUtxoPayloadSource = sourceSliceBetween(
  server,
  /async function addressUtxoPayload\(/,
  /async function txHexPayload\(/,
);
const healthPayloadSource = sourceSliceBetween(
  server,
  /async function loadHealthPayload\(/,
  /const CANONICAL_PUBLIC_READ_GATE_TTL_MS/,
);
const canonicalRebuildSource = sourceSliceBetween(
  proofIndexerBackfill,
  /async function prepareCanonicalRebuild\(/,
  /async function latestBlockScanCheckpoint\(/,
);
const canonicalTransactionDetailsSource = sourceSliceBetween(
  proofIndexerBackfill,
  /function canonicalOpReturnPayloadFromVout\(/,
  /async function persistCanonicalBlock\(/,
);
const canonicalRawPersistenceSource = sourceSliceBetween(
  proofIndexerBackfill,
  /async function persistCanonicalBlock\(/,
  /async function upsertTransaction\(/,
);
const historicalTransactionDetailHydrationSource = sourceSliceBetween(
  proofIndexerBackfill,
  /async function hydrateHistoricalCanonicalTransactionDetails\(/,
  /async function upsertTransaction\(/,
);
const canonicalBalanceReplaySource = sourceSliceBetween(
  proofIndexerBackfill,
  /async function rebuildConfirmedCreditBalancesFromCanonicalEvents\(/,
  /function snapshotSourceParams\(/,
);
const canonicalTransactionsReaderSource = sourceSliceBetween(
  proofIndexReader,
  /async function canonicalStateMetaFromPool\(/,
  /function tokenDefinitionFromRow\(/,
);
const pwmAggregationSource = sourceSliceBetween(
  proofIndexerBackfill,
  /function aggregatePwmProtocolItem\(/,
  /function protocolItemsFromTx\(/,
);
const indexedWalletTokenOverlaySource = sourceSliceBetween(
  proofIndexReader,
  /export async function proofIndexWalletTokenOverlayPayload\(/,
  /async function proofIndexScopedHolderHistoryPayload\(/,
);
const walletTokenOverlayMergeSource = sourceSliceBetween(
  server,
  /async function tokenPayloadWithIndexedWalletOverlay\(/,
  /function transferBalanceDeltaForAddress\(/,
);

expectAll("canonical ledger cache is first-class", server, [
  /LEDGER_CACHE_TTL_MS/,
  /LEDGER_CACHE_STALE_MS/,
  /LEDGER_FRESH_MIN_INTERVAL_MS/,
  /cacheKey === "ledger:livenet"/,
  /`payload:ledger:\$\{network\}`/,
  /`json:ledger:\$\{network\}`/,
  /function ledgerPayloadHasCurrentChecks\(/,
  /function ledgerPayloadAgeMs\(/,
]);

expectAll("live index worker confirms blocks before best-effort mempool visibility", proofIndexerWorker, [
  /const DEFAULT_WORKER_BACKFILL_SOURCES = "block-scan,mempool-scan"/,
  /const BACKFILL_RETRIES = Math\.min\(/,
  /async function runBackfillWithRetries\([\s\S]*await runScript\("backfill-proof-indexer\.mjs"[\s\S]*phase: "worker-backfill-retry"/,
  /await runBackfillWithRetries\(backfillEnv\)/,
  /POW_INDEX_BACKFILL_STORE_CANONICAL_SUMMARY_SNAPSHOT:[\s\S]*BACKFILL_STORE_CANONICAL_SUMMARY_SNAPSHOT/,
  /POW_INDEX_BACKFILL_STORE_LEDGER_SNAPSHOT: BACKFILL_STORE_LEDGER_SNAPSHOT/,
  /const MAX_CONSECUTIVE_FAILURES = Math\.max\([\s\S]*3/,
  /consecutiveFailures >= MAX_CONSECUTIVE_FAILURES[\s\S]*throw error/,
]);
expectAll("worker child processes and pending cleanup have strict wall-clock budgets", proofIndexerWorker, [
  /const STATUS_REQUEST_TIMEOUT_MS = Number\([\s\S]*Math\.min\([\s\S]*5_000/,
  /const PENDING_STATUS_BUDGET_MS = Number\([\s\S]*15_000/,
  /const PENDING_STATUS_CONCURRENCY = Math\.min\([\s\S]*5/,
  /const BACKFILL_CHILD_TIMEOUT_MS = Math\.min\([\s\S]*15 \* 60_000[\s\S]*4 \* 60_000/,
  /function runScript\([\s\S]*child\.kill\("SIGTERM"\)[\s\S]*child\.kill\("SIGKILL"\)[\s\S]*wall-clock budget/,
  /const deadlineMs = Date\.now\(\) \+ PENDING_STATUS_BUDGET_MS[\s\S]*await Promise\.all\([\s\S]*PENDING_STATUS_CONCURRENCY/,
  /runScript\("backfill-proof-indexer\.mjs"[\s\S]*timeoutMs: BACKFILL_CHILD_TIMEOUT_MS/,
  /runScript\("check-proof-indexer-parity\.mjs"[\s\S]*timeoutMs: PARITY_CHILD_TIMEOUT_MS/,
]);
expectAll("cold canonical-summary rebuilds retain a finite supervised budget", proofIndexerBackfill, [
  /const CANONICAL_SUMMARY_REFRESH_TIMEOUT_MS = Math\.min\([\s\S]*10 \* 60_000[\s\S]*120_000/,
  /import \{ request as httpRequest \} from "node:http"/,
  /const CANONICAL_SUMMARY_RESPONSE_MAX_BYTES = 64 \* 1024 \* 1024/,
  /function readCanonicalSummaryJsonViaLoopbackHttp\([\s\S]*agent: false[\s\S]*method: "GET"[\s\S]*signal: options\.signal/,
  /response\.headers\["content-length"\][\s\S]*receivedBytes > maxBytes[\s\S]*response\.complete !== true/,
  /url\.pathname === "\/api\/v1\/internal\/canonical-summary"[\s\S]*loopbackApi[\s\S]*url\.protocol === "http:"[\s\S]*readCanonicalSummaryJsonViaLoopbackHttp/,
]);
expectAll("production worker pins confirmed-first and liveness budgets", proofIndexerWorkerService, [
  /POW_INDEX_WORKER_BACKFILL_SOURCES=block-scan,mempool-scan/,
  /POW_INDEX_BACKFILL_BLOCK_SCAN_MAX_BLOCKS=250/,
  /POW_INDEX_BACKFILL_BLOCK_SCAN_MAX_TXIDS=250/,
  /POW_INDEX_WORKER_BACKFILL_STORE_CANONICAL_SUMMARY_SNAPSHOT=1/,
  /POW_INDEX_MEMPOOL_SCAN_MAX_PROTOCOL_TXIDS=5/,
  /POW_INDEX_PENDING_VERIFIER_TIMEOUT_MS=5000/,
  /POW_INDEX_STATUS_FETCH_TIMEOUT_MS=5000/,
  /POW_INDEX_PENDING_STATUS_BUDGET_MS=15000/,
  /POW_INDEX_PENDING_STATUS_CONCURRENCY=5/,
  /POW_INDEX_CANONICAL_SUMMARY_REFRESH_TIMEOUT_MS=600000/,
  /POW_INDEX_WORKER_BACKFILL_TIMEOUT_MS=900000/,
  /POW_INDEX_WORKER_PARITY_TIMEOUT_MS=120000/,
]);
const canonicalSummaryRefreshTimeoutMs = serviceEnvironmentNumber(
  "POW_INDEX_CANONICAL_SUMMARY_REFRESH_TIMEOUT_MS",
);
const workerBackfillTimeoutMs = serviceEnvironmentNumber(
  "POW_INDEX_WORKER_BACKFILL_TIMEOUT_MS",
);
expect(
  "production worker canonical-summary timeout parses as the configured 600000ms",
  canonicalSummaryRefreshTimeoutMs === 600_000,
);
expect(
  "production worker child timeout leaves at least 300000ms beyond canonical-summary work",
  Number.isSafeInteger(workerBackfillTimeoutMs) &&
    workerBackfillTimeoutMs >= canonicalSummaryRefreshTimeoutMs + 300_000,
);
expectAll("hot worker summary publication is canonical, conservative, and health-gated", proofIndexerBackfill + proofIndexReader + server, [
  /STORE_CANONICAL_SUMMARY_SNAPSHOT/,
  /function canonicalSummaryRefreshCanDefer\([\s\S]*statusCode === 503[\s\S]*Bitcoin Core tip/,
  /async function storeCanonicalSummarySnapshot\(/,
  /canonicalSummaryRefreshCanDefer\(error\)[\s\S]*reason: "canonical-summary-deferred"/,
  /unpagedEndpoint\(\s*"\/api\/v1\/internal\/canonical-summary",?\s*\)/,
  /async function internalCanonicalSummaryPayload\([\s\S]*buildIndexedCanonicalLedgerPayload\(/,
  /const before = await exactCanonicalSummaryCheckpoint\([\s\S]*const after = await exactCanonicalSummaryCheckpoint\(/,
  /exactCanonicalSummaryCheckpoint\([\s\S]*indexedThroughBlock !== tipHeight[\s\S]*storedHash !== tipHash/,
  /buildIndexedCanonicalLedgerPayload\([\s\S]*strictCanonicalRushPayload\(network, exactHeight\)[\s\S]*exactTokenTablePayloadForCanonicalLedger\(/,
  /async function strictCanonicalRushPayload\([\s\S]*proofIndexRushPayload\([\s\S]*proof-indexer-rush-canonical[\s\S]*rushStateFromIndexedMintEvents\(/,
  /RUSH_BOOTSTRAP_META_KEY[\s\S]*RUSH_DISCOVERY_META_KEY[\s\S]*async function ensureCanonicalRushBootstrap\([\s\S]*canonicalRushDiscovery\([\s\S]*canonicalRushBootstrapTransaction\([\s\S]*persistCanonicalRawTransaction\([\s\S]*RUSH_BOOTSTRAP_META_KEY/,
  /const PROTOCOL_PREFIXES = \["pwm1:", "pwid1:", "pwr1:", "pwt1:"\]/,
  /function tokenTablePayloadHasConservedBalances\([\s\S]*!tokenIds\.has\(tokenId\)[\s\S]*minted === held[\s\S]*mintedSupply === heldSupply/,
  /currentProofIndexTokenTablePayloadForLedger\([\s\S]*options\.exactHeight[\s\S]*proofIndexPayloadIndexedThroughBlock\(payload\) !== exactHeight/,
  /indexedActivityStateForCanonicalLedger\([\s\S]*options\.exactHeight[\s\S]*proofIndexPayloadIndexedThroughBlock\(payload\) !== exactHeight/,
  /indexedRegistryStateForCanonicalLedger\([\s\S]*options\.exactHeight[\s\S]*proofIndexPayloadIndexedThroughBlock\(payload\) !== exactHeight/,
  /summarySnapshotIds[\s\S]*value !== snapshotId/,
  /summaryRefresh: _canonicalSummaryRefresh[\s\S]*legacyBasePayload/,
  /storedLedgerSnapshotPayload\([\s\S]*snapshotId[\s\S]*sameSnapshotPayload/,
  /mode: "canonical-summary-refresh"/,
  /payload->'summaryRefresh'->>'mode' = 'canonical-summary-refresh'/,
  /previousCoverage === latestIndexedHeight[\s\S]*previousIndexedThroughBlockHash === latestIndexedThroughBlockHash/,
  /indexedThroughBlockHash: latestIndexedThroughBlockHash[\s\S]*blockScan: latestIndexedThroughBlockHash/,
  /"inceptionSummary"/,
  /"infinitySummary"/,
  /function summaryPayloadConservativeCoverage\([\s\S]*Math\.min\(parentCoverage, nestedCoverage\)/,
  /COALESCE\(consistency->>'ok', payload->>'ok', 'false'\) = 'true'/,
  /summary-snapshot-fallback/,
  /latest_summary AS \([\s\S]*payload->'summaryPayloads'/,
  /summarySnapshot:[\s\S]*coverageByKey/,
  /function summarySnapshotCoversCanonicalReadModels\([\s\S]*summaryIndexedThroughBlock === indexedThroughBlock[\s\S]*indexedThroughBlock === scanTipHeight[\s\S]*summaryBlockHash === scanBlockHash/,
  /confirmed_events AS \([\s\S]*confirmed_event_max_block/,
  /readModelsOk &&[\s\S]*summarySnapshotOk/,
]);
expectAll("ledger snapshot retention is bounded and preserves issuance oracles", proofIndexerBackfill, [
  /POW_INDEX_LEDGER_CANONICAL_SUMMARY_RETENTION[\s\S]*4_096/,
  /POW_INDEX_LEDGER_SCAN_SNAPSHOT_RETENTION[\s\S]*20_000/,
  /async function pruneLedgerSnapshots\([\s\S]*row_number\(\) OVER[\s\S]*source_hashes \? 'canonicalSummary'[\s\S]*DELETE FROM proof_indexer\.ledger_snapshots/,
  /payload->>'issuanceValueSnapshotId'[\s\S]*NOT EXISTS/,
  /const snapshotRetention = await pruneLedgerSnapshots\(client\)/,
]);
expectAll("the production database role has finite temp-file safeguards", proofIndexDbRoleLimits, [
  /ALTER ROLE proof_indexer IN DATABASE proof_indexer[\s\S]*SET temp_file_limit = '1GB'/,
  /ALTER ROLE proof_indexer IN DATABASE proof_indexer[\s\S]*SET log_temp_files = '256MB'/,
]);
expectAll("canonical read gate timeouts recover without a pinned public outage", server, [
  /const CANONICAL_PUBLIC_READ_GATE_TIMEOUT_MS = Math\.min\([\s\S]*15_000/,
  /const CANONICAL_PUBLIC_READ_GATE_TIMEOUT_TTL_MS = Math\.min\(/,
  /loadCanonicalPublicReadGate\(network\),[\s\S]*CANONICAL_PUBLIC_READ_GATE_TIMEOUT_MS/,
  /outcome\.timedOut[\s\S]*CANONICAL_PUBLIC_READ_GATE_TIMEOUT_TTL_MS[\s\S]*CANONICAL_PUBLIC_READ_GATE_TTL_MS/,
]);
expectAll("backfill source execution keeps confirmed blocks ahead of mempool work", proofIndexerBackfill, [
  /const ALL_SOURCES = \[[\s\S]*\{ blockScan: true, label: "block-scan" \}[\s\S]*\{ label: "mempool-scan", mempoolScan: true \}/,
]);
expectAll("stateful block discoveries require the first-party ordered verifier", canonicalRecoverySource, [
  /path: "\/api\/v1\/internal\/id-verifier"/,
  /path: "\/api\/v1\/internal\/token-verifier"/,
  /payload = await readJson\([\s\S]*confirmed:[\s\S]*fresh: "1"[\s\S]*retries: 0/,
  /recovered\.length === 0[\s\S]*throw new Error\(`Canonical verifier did not resolve protocol transaction/,
  /validationMode: "canonical-first-party-state"/,
]);
expectAll("ordered credit verifier distinguishes deterministic invalidity from unresolved state", tokenVerifierPayloadSource, [
  /tokenVerifierItemsFromState\(state, normalizedTxid\)/,
  /tokenVerifierDeterministicInvalidReason\(/,
  /if \(invalidReason\) \{[\s\S]*valid: false/,
  /if \(items\.length === 0\) \{[\s\S]*error\.statusCode = 503[\s\S]*code: "TOKEN_VERIFIER_UNRESOLVED"/,
]);
expectAll("pending WORK marketplace verification replays only Core-current exact evidence", server, [
  /async function pendingCoreWorkMarketplaceVerifierContext\([\s\S]*requireCanonicalPrevouts: true/,
  /bitcoinRpc\("getmempoolentry", \[normalizedTxid\]\)[\s\S]*coreMempoolEntryPresent\(initialMempoolResponse\)/,
  /marketplaceKinds = new Set\(\["buy", "delist", "list", "seal"\]\)/,
  /tokenIds\.size !== 1 \|\| !tokenIds\.has\(WORK_TOKEN_ID\)/,
  /coreMempoolEntryPresent\(finalMempoolResponse\)[\s\S]*cachePendingTokenTransaction\(/,
  /token-indexed-current:[\s\S]*currentProofIndexTokenPayloadForRead\([\s\S]*pending-core-work-marketplace-verifier[\s\S]*10_000[\s\S]*PENDING_WORK_MARKETPLACE_BASE_UNAVAILABLE/,
  /token-pending-core:[\s\S]*workTokenStateWithDeltaTransactions\(/,
  /confirmedClosedListing[\s\S]*Referenced ProofOfWork credit listing is already closed/,
]);
expect(
  "credit verifier must not turn a current node tip into a negative state verdict",
  !/nodeTip|tipHeight|ledgerTipHeight/.test(tokenVerifierPayloadSource),
);
expectAll("ordered ID verifier fails closed when registry replay has no verdict", idVerifierPayloadSource, [
  /idVerifierItemsFromState\(bundle\.state, normalizedTxid\)/,
  /idVerifierDeterministicInvalidReason\(/,
  /if \(invalidReason\) \{[\s\S]*valid: false/,
  /if \(items\.length === 0\) \{[\s\S]*error\.statusCode = 503[\s\S]*code: "ID_VERIFIER_UNRESOLVED"/,
]);
expectAll("internal ordered verifier routes are loopback-only and uncached", internalVerifierRoutesSource, [
  /internalVerifierRequestAllowed\(request\)[\s\S]*errorResponse\(response, 404, "Not found\."\)/,
  /await tokenVerifierPayload\(/,
  /await idVerifierPayload\(/,
  /"no-store"/,
]);
expectAll("authenticated loopback snapshot bootstrap bypasses only the rebuilding public gate", server + proofIndexerBackfill, [
  /const loopbackApi = \["127\.0\.0\.1", "::1", "\[::1\]", "localhost"\]/,
  /const headers = loopbackApi && INTERNAL_VERIFIER_TOKEN\.length >= 32/,
  /const authenticatedLoopbackRead = internalVerifierRequestAllowed\(request\)/,
  /canonicalPublicReadGateApplies\(url\.pathname\) &&[\s\S]*!authenticatedLoopbackRead/,
]);
expectAll("confirmed verifier context is shared per block without eviction by token scopes", server, [
  /key\.startsWith\("canonical-context:"\)/,
  /entry\?\.settled && !key\.startsWith\("canonical-context:"\)/,
  /async function loadCanonicalVerifierContextFromCheckpoint\(/,
  /`canonical-context:\$\{network\}:h\$\{height\}:\$\{previousBlockHash\}:\$\{blockHash\}`/,
  /cachedInternalVerifierState\([\s\S]*loadCanonicalVerifierContextFromCheckpoint\([\s\S]*network,[\s\S]*height,[\s\S]*blockHash,[\s\S]*previousBlockHash/,
]);
expectAll("confirmed block scan bootstraps explicitly and checkpoints canonical hashes", blockScanCheckpointSource + blockScanSource, [
  /POW_INDEX_BACKFILL_BLOCK_SCAN_FROM_HEIGHT/,
  /source_hashes \? 'blockScan'[\s\S]*payload->>'source' = 'proof-indexer-block-scan'/,
  /NULLIF\([\s\S]*payload->>'indexedThroughBlockHash'[\s\S]*payload->>'blockHash'[\s\S]*IS NOT NULL/,
  /No hashed authoritative block-scan checkpoint exists/,
  /!\/\^\[0-9a-f\]\{64\}\$\/u\.test\(blockHash\)[\s\S]*explicit supervised replay is required/,
  /indexedThroughBlockHash/,
  /status: payload\.complete === true[\s\S]*"block-scan-current"[\s\S]*"block-scan-partial"/,
  /BITCOIN_RPC_URL is required for \$\{source\.label\}; no block scan was performed/,
  /Bitcoin reorg detected at indexed checkpoint[\s\S]*operator replay is required/,
  /const firstHeight = latestIndexedHeight \+ 1/,
]);
expectAll("operational health prefers hashed replay checkpoints over newer legacy rows", operationalScanMetadataSource, [
  /ORDER BY[\s\S]*CASE[\s\S]*payload->>'indexedThroughBlockHash'[\s\S]*payload->>'blockHash'[\s\S]*source_hashes->>'blockScan'[\s\S]*IS NOT NULL THEN 0[\s\S]*ELSE 1[\s\S]*indexed_through_block DESC NULLS LAST/,
]);
expectAll("operational health uses compact indexed snapshot projections", operationalHealthMetadataSource, [
  /source_hashes \? 'blockScan'[\s\S]*ORDER BY[\s\S]*CASE[\s\S]*payload->>'indexedThroughBlockHash'[\s\S]*payload->>'blockHash'[\s\S]*source_hashes->>'blockScan'[\s\S]*IS NOT NULL THEN 0[\s\S]*ELSE 1[\s\S]*indexed_through_block DESC NULLS LAST[\s\S]*generated_at DESC/,
  /COALESCE\([\s\S]*payload->>'indexedThroughBlockHash'[\s\S]*payload->>'blockHash'[\s\S]*source_hashes->>'blockScan'[\s\S]*AS scan_block_hash/,
  /payload \? 'summaryPayloads'/,
  /ORDER BY[\s\S]*indexed_through_block DESC NULLS LAST[\s\S]*generated_at DESC[\s\S]*LIMIT 1/,
  /jsonb_build_object\([\s\S]*AS summary_coverage/,
  /\{summaryPayloads,growthSummary,indexedThroughBlock\}/,
  /\{summaryPayloads,growthSummary,workFloor,indexedThroughBlock\}/,
  /\{summaryPayloads,inceptionSummary,indexedThroughBlock\}/,
  /\{summaryPayloads,infinitySummary,indexedThroughBlock\}/,
  /\{summaryPayloads,marketplaceSummary,indexedThroughBlock\}/,
  /\{summaryPayloads,marketplaceSummary,workFloor,indexedThroughBlock\}/,
  /\{summaryPayloads,workFloor,indexedThroughBlock\}/,
  /\{summaryPayloads,workSummary,indexedThroughBlock\}/,
  /\{summaryPayloads,workSummary,floor,indexedThroughBlock\}/,
  /confirmed_id_count[\s\S]*confirmed_id_max_block/,
  /confirmed_transfer_count[\s\S]*confirmed_transfer_max_block/,
  /confirmed_event_count[\s\S]*confirmed_event_max_block/,
  /worker_meta\.value AS worker[\s\S]*worker_meta\.updated_at AS worker_updated_at/,
]);
expect(
  "operational health must not hydrate full ledger or summary snapshot JSON",
  !/latest_scan\.(?:payload|metrics|consistency|source_hashes)|latest_summary\.summary_payloads|payload->'summaryPayloads'\s+AS\s+summary_payloads/u.test(
    operationalHealthMetadataSource,
  ),
);
expectAll("snapshot health reads have order-matching spill guards", proofIndexerSchema, [
  /CREATE INDEX IF NOT EXISTS ledger_snapshots_scan_health_idx[\s\S]*payload->>'indexedThroughBlockHash'[\s\S]*payload->>'blockHash'[\s\S]*source_hashes->>'blockScan'[\s\S]*indexed_through_block DESC NULLS LAST,[\s\S]*generated_at DESC/,
  /CREATE INDEX IF NOT EXISTS ledger_snapshots_canonical_payload_latest_idx[\s\S]*payload->>'snapshotId' = snapshot_id[\s\S]*payload \? 'activityPayload'[\s\S]*payload \? 'registryHistoryPayloads'[\s\S]*payload \? 'summaryPayloads'[\s\S]*payload \? 'tokenHistoryPayloads'[\s\S]*payload \? 'tokenStatePayloads'[\s\S]*generated_at DESC[\s\S]*WHERE payload \? 'snapshotId'/,
]);
expect(
  "canonical scan metadata does not hydrate an unused summary snapshot",
  !/latest_summary|summary_payloads|summary_snapshot_id/u.test(
    operationalScanMetadataSource,
  ),
);
expectAll("canonical summary ledger reads imply their indexed payload class", canonicalSummaryLedgerPayloadSource, [
  /source_hashes \? 'canonicalSummary'[\s\S]*payload \? 'summaryPayloads'/,
  /ORDER BY[\s\S]*indexed_through_block DESC NULLS LAST,[\s\S]*generated_at DESC/,
]);
expectAll("health probes use bounded Electrum balance checks", addressIndexHealthSource, [
  /blockchain\.scripthash\.get_balance/,
  /ELECTRUM_HEALTH_SCRIPTHASH/,
  /Number\.isSafeInteger\(confirmedSats\)[\s\S]*confirmedSats === 0/,
  /Number\.isSafeInteger\(unconfirmedSats\)[\s\S]*unconfirmedSats === 0/,
  /canary:/,
  /confirmedSats:/,
  /unconfirmedSats:/,
  /timedOut: balanceOutcome\.timedOut === true/,
]);
expect(
  "health probes must not hydrate full Electrum address histories",
  !/blockchain\.scripthash\.(?:get_history|listunspent)/u.test(
    addressIndexHealthSource,
  ),
);
expectAll("Electrum health proves the exact Core tip with one bounded header", electrumHealthSource, [
  /async function electrumHealthPayload\(\s*expectedHeight,\s*expectedHash,\s*timeoutMs = HEALTH_CHECK_TIMEOUT_MS,\s*\)/,
  /blockchain\.block\.header/,
  /\[height\]/,
  /\^\[0-9a-f\]\{160\}\$/,
  /bitcoin\.crypto\.hash256/,
  /headerHash === coreHash/,
]);
expect(
  "Electrum health must not create one-shot subscriptions or version sessions",
  !/server\.version|blockchain\.headers\.subscribe/u.test(electrumHealthSource),
);
expectAll("health Electrum probes share one deadline and fail without a second socket", boundedHealthElectrumSource, [
  /addressIndex\?\.ok !== true/,
  /tip proof was skipped/,
  /Number\(deadlineMs\) - Date\.now\(\)/,
  /remainingMs <= 0/,
  /electrumHealthPayload\([\s\S]*Math\.min\(HEALTH_CHECK_TIMEOUT_MS, remainingMs\)/,
]);
expectAll("health calls bind Electrum to the sampled Core checkpoint", server, [
  /loadHealthPayload\(\)[\s\S]*boundedHealthElectrumPayload\([\s\S]*addressIndex,[\s\S]*tipHeight,[\s\S]*sampledBestBlockHash/,
]);
expectAll("concurrent and adjacent health requests share one dependency sweep", healthPayloadSource, [
  /let healthPayloadCache = null/,
  /!healthPayloadCache\.settled \|\| healthPayloadCache\.expiresAt > now/,
  /return healthPayloadCache\.promise/,
  /entry\.promise = loadHealthPayload\(\)[\s\S]*healthPayloadCache = entry/,
  /entry\.expiresAt = Date\.now\(\) \+ HEALTH_PAYLOAD_CACHE_TTL_MS/,
  /entry\.settled = true/,
]);
expectAll("each confirmed block persists events and its checkpoint atomically", blockScanSource, [
  /bitcoinRpc\("getblock", \[blockHash, 2\]\)/,
  /transactionWithInputPrevouts\([\s\S]*assertHydratedProtocolTransaction/,
  /preparedTransactions\.push\([\s\S]*preparedProtocolItemsForTx\(hydratedTx, messages\)[\s\S]*rawTx: hydratedTx/,
  /await client\.query\("BEGIN"\)[\s\S]*persistCanonicalBlock\(client,[\s\S]*persistCanonicalRawTransaction\(client,[\s\S]*persistPreparedProtocolItems\(client, prepared\.items\)[\s\S]*storeBlockScanSnapshot\(client,[\s\S]*await client\.query\("COMMIT"\)/,
  /await client\.query\("ROLLBACK"\)[\s\S]*stopReason = "block-transaction-failed"/,
]);
expectAll("supervised canonical rebuild resets mixed-era state behind a hashed bootstrap", canonicalRebuildSource + proofIndexerBackfill, [
  /POW_INDEX_BACKFILL_CANONICAL_REBUILD/,
  /--prepare-canonical-rebuild/,
  /requires NETWORK=livenet and an explicit positive POW_INDEX_BACKFILL_BLOCK_SCAN_FROM_HEIGHT/,
  /DELETE FROM proof_indexer\.events[\s\S]*\["pwid1", "pwt1", "pwm1", "pwr1"\]/,
  /DELETE FROM proof_indexer\.id_records/,
  /DELETE FROM proof_indexer\.credit_balances/,
  /DELETE FROM proof_indexer\.credit_listings/,
  /DELETE FROM proof_indexer\.credit_definitions/,
  /DELETE FROM proof_indexer\.mail_items/,
  /DELETE FROM proof_indexer\.file_attachments/,
  /UPDATE proof_indexer\.blocks[\s\S]*canonical = false/,
  /DELETE FROM proof_indexer\.ledger_snapshots[\s\S]*WHERE network = \$1/,
  /`mempoolScan:\$\{NETWORK\}`/,
  /seedCanonicalWorkDefinition\(client\)/,
  /stopReason: "canonical-rebuild-bootstrap"/,
  /await client\.query\("BEGIN"\)[\s\S]*storeBlockScanSnapshot\(client,[\s\S]*await client\.query\("COMMIT"\)/,
]);
expect(
  "canonical rebuild preserves relational tx details for idempotent raw replay",
  !/DELETE FROM proof_indexer\.(?:tx_inputs|tx_outputs|op_returns)/.test(
    canonicalRebuildSource,
  ),
);
expectAll("canonical block raw transactions replace legacy wrappers", canonicalRawPersistenceSource + blockScanSource, [
  /canonicalBlockScan:[\s\S]*blockHash[\s\S]*height[\s\S]*network: NETWORK/,
  /raw_tx = EXCLUDED\.raw_tx/,
  /_powBlockIndex: blockIndex/,
  /assertHydratedProtocolTransaction\(hydratedTx\)/,
  /assertCanonicalBlockEnvelope\(block, height, blockHash\)/,
]);
expectAll(
  "canonical raw transactions materialize full-node relational details idempotently",
  canonicalTransactionDetailsSource + canonicalRawPersistenceSource,
  [
    /function canonicalTransactionDetailRows\(tx\)/,
    /input\?\.txinwitness \?\? input\?\.witness/,
    /address: address \|\| null,[\s\S]*prev_txid:[\s\S]*prev_vout:[\s\S]*sequence:[\s\S]*value_sats:[\s\S]*witness/,
    /scriptpubkey:[\s\S]*scriptpubkey_asm:[\s\S]*scriptpubkey_type:[\s\S]*value_sats:[\s\S]*vout/,
    /INSERT INTO proof_indexer\.tx_inputs[\s\S]*ON CONFLICT \(network, txid, vin\)[\s\S]*witness = EXCLUDED\.witness/,
    /INSERT INTO proof_indexer\.tx_outputs[\s\S]*ON CONFLICT \(network, txid, vout\)[\s\S]*scriptpubkey_type = EXCLUDED\.scriptpubkey_type/,
    /function canonicalOpReturnPayloadFromVout\(vout\)[\s\S]*script\[0\] !== 0x6a[\s\S]*payloadHex: payload\.toString\("hex"\)/,
    /INSERT INTO proof_indexer\.op_returns[\s\S]*ON CONFLICT \(network, txid, vout, output_index\)[\s\S]*data_bytes = EXCLUDED\.data_bytes/,
    /SELECT[\s\S]*spent_output\.spent_by_txid[\s\S]*FOR UPDATE OF spent_output/,
    /Canonical spend-link conflict/,
    /UPDATE proof_indexer\.tx_outputs AS spent_output[\s\S]*spent_by_txid = \$2[\s\S]*spent_by_vin = incoming\.vin[\s\S]*spent_by_txid IS NULL[\s\S]*spent_by_vin IS NOT DISTINCT FROM incoming\.vin/,
  ],
);
expectAll(
  "historical canonical transaction details hydrate explicitly in bounded batches",
  proofIndexerBackfill + historicalTransactionDetailHydrationSource,
  [
    /--hydrate-transaction-details/,
    /POW_INDEX_TX_DETAIL_HYDRATION_BATCH_SIZE/,
    /POW_INDEX_TX_DETAIL_HYDRATION_MAX_ROWS/,
    /Historical transaction-detail hydration is exclusive with rebuild and repair modes/,
    /JOIN proof_indexer\.blocks AS canonical_block[\s\S]*canonical_block\.network = transaction_row\.network[\s\S]*canonical_block\.block_hash = transaction_row\.block_hash[\s\S]*canonical_block\.height = transaction_row\.block_height[\s\S]*canonical_block\.canonical = true/,
    /jsonb_typeof\(transaction_row\.raw_tx->'canonicalBlockScan'\) = 'object'/,
    /canonicalBlockScan'->>'network' = \$1[\s\S]*canonicalBlockScan'->>'height'[\s\S]*transaction_row\.block_height[\s\S]*canonicalBlockScan'->>'blockHash'[\s\S]*transaction_row\.block_hash/,
    /AND \(block_height, block_index, txid\) >[\s\S]*ORDER BY block_height, block_index, txid[\s\S]*LIMIT \$5/,
    /await client\.query\("BEGIN"\)[\s\S]*persistCanonicalTransactionDetails\([\s\S]*await client\.query\("COMMIT"\)/,
    /await client\.query\("ROLLBACK"\)/,
    /historicalTransactionDetailHydration: true/,
  ],
);
expect(
  "historical transaction hydration cannot mutate checkpoints or event projections",
  !/\b(?:INSERT\s+INTO|UPDATE|DELETE\s+FROM)\s+proof_indexer\.(?:meta|events|credit_|id_records|ledger_snapshots|blocks)\b/iu.test(
    historicalTransactionDetailHydrationSource,
  ),
);
expectAll("canonical replay faults before crossing a reorg", blockScanSource, [
  /await storeCanonicalReorgFault\(client,[\s\S]*phase: "checkpoint"[\s\S]*throw new Error\([\s\S]*Bitcoin reorg detected at indexed checkpoint/,
  /await storeCanonicalReorgFault\(client,[\s\S]*phase: "before-block"[\s\S]*throw new Error\([\s\S]*Bitcoin reorg detected before block/,
]);
expectAll("canonical balances replay by chain order and fail before publication", canonicalBalanceReplaySource, [
  /e\.valid = true/,
  /COALESCE\(t\.status, e\.status\) = 'confirmed'/,
  /e\.payload->>'blockIndex'/,
  /e\.payload->>'_powEventIndex'/,
  /Canonical credit replay would make[\s\S]*negative/,
  /replayedSupply !== minted/,
  /storedSupply > minted/,
  /DELETE FROM proof_indexer\.credit_balances/,
]);
expectAll("PWM block parsing aggregates value once and projects bond credits without value duplication", pwmAggregationSource + proofIndexerBackfill, [
  /const pwmMessages = messages\.filter/,
  /const memo = memoChunks\.join\(""\)/,
  /dataBytes: pwmMessages\.reduce/,
  /validationMode: `canonical-\$\{bondTag\.ticker\.toLowerCase\(\)\}-bond-projection`/,
  /amountSats: 0/,
  /eventKeyVout: ordinal/,
  /Malformed or unknown aggregated PWM protocol payload/,
]);
expectAll("reader exposes exact canonical raw chain state", canonicalTransactionsReaderSource, [
  /export async function proofIndexCanonicalStateMetaPayload\(/,
  /export async function proofIndexCanonicalTransactionsPayload\(/,
  /indexed_through_block = \$2/,
  /!checkpoint[\s\S]*boundedHeight > Number\(rebuild\?\.bootstrapHeight\)[\s\S]*boundedHeight <= Number\(rebuild\?\.indexedThroughBlock\)/,
  /FROM proof_indexer\.blocks[\s\S]*height = \$2[\s\S]*canonical = true/,
  /WITH RECURSIVE canonical_chain/,
  /raw_tx->'canonicalBlockScan'/,
  /canonicalCoreValueSats/,
  /scriptpubkey_type: canonicalCoreScriptType/,
  /Duplicate canonical transaction position/,
  /CANONICAL_BLOCK_CHAIN_INCOMPLETE/,
]);
expectAll("mempool discovery is bounded and unresolved pending state is retried", mempoolScanSource, [
  /bitcoinRpc\("getrawmempool", \[true\]\)/,
  /MEMPOOL_SCAN_MAX_TXIDS/,
  /MEMPOOL_SCAN_MAX_PROTOCOL_TXIDS/,
  /preparedProtocolItemsForTx\([\s\S]*hydrated,[\s\S]*messages/,
  /unresolved \+= 1/,
]);
expectAll("mempool priority recovery rotates independently and preserves invalid pending observations", proofIndexerBackfill, [
  /priorityCursor: normalizedMempoolScanCursor\(value\?\.priorityCursor\)/,
  /mempoolEntriesAfterCursor\([\s\S]*state\?\.priorityCursor/,
  /candidate\.lane === "priority"[\s\S]*priorityCursor =[\s\S]*mempoolScanCursorForEntry/,
  /function pendingTransactionObservationItem\([\s\S]*items\.some\(\(item\) => item\?\.valid !== false\)[\s\S]*status: "pending"/,
  /const transactionObservation = pendingTransactionWriteItem\([\s\S]*\?\? pendingProtocolTransactionObservation\([\s\S]*upsertTransaction\([\s\S]*transactionObservation[\s\S]*"pending"/,
  /function mempoolRecoveryTxidsFromRows\([\s\S]*Boolean\(mempool\?\.\[row\.txid\]\)[\s\S]*remainingSlots/,
  /const attemptedMints = Math\.max\([\s\S]*row\.attemptedMints[\s\S]*row\.validDecisions[\s\S]*row\.invalidDecisions/,
  /let orderingUncertain = false[\s\S]*if \(row\.recoveryNeeded\) \{[\s\S]*orderingUncertain = true[\s\S]*if \(attemptedMints > 1\) \{[\s\S]*orderingUncertain = true/,
  /pendingWorkMintInspectionVersion[\s\S]*AS inspection_version[\s\S]*pendingWorkMintAttemptCount[\s\S]*AS attempted_mints[\s\S]*pendingWorkMintRecoveryNeeded[\s\S]*AS recovery_needed[\s\S]*pendingWorkMintResolvedInvalid[\s\S]*AS resolved_invalid[\s\S]*pendingProtocolResolvedInvalid[\s\S]*AS protocol_resolved_invalid/,
  /function storePendingWorkMintInspection\([\s\S]*jsonb_build_object\([\s\S]*pendingWorkMintInspectionVersion[\s\S]*pendingWorkMintRecoveryNeeded[\s\S]*pendingWorkMintResolvedInvalid[\s\S]*pendingProtocolResolvedInvalid[\s\S]*canonicalBlockScan/,
  /function storePendingWorkMintAttemptPreinspection\([\s\S]*pendingWorkMintAttemptCount[\s\S]*pendingWorkMintInspectionVersion[\s\S]*pendingWorkMintRecoveryNeeded', true[\s\S]*pendingWorkMintResolvedInvalid', false[\s\S]*canonicalBlockScan[\s\S]*!~ '\^\[1-9\]\[0-9\]\*\$'/,
  /const PENDING_LEGACY_VERIFIER_TIMEOUT_MS = 30_000[\s\S]*async function canonicalRecoveryItemsForTx\(tx, messages, options = \{\}\)[\s\S]*options\?\.pendingVerifierTimeoutMs/,
  /const workMintAttemptCount = pendingWorkMintAttemptCount\(messages\)[\s\S]*storePendingWorkMintAttemptPreinspection\([\s\S]*PENDING_LEGACY_VERIFIER_TIMEOUT_MS[\s\S]*preparedProtocolItemsForTx/,
  /function pendingCoreMarketplaceVerifierNeeded\([\s\S]*buy5[\s\S]*delist5[\s\S]*list5[\s\S]*seal5[\s\S]*const extendedPendingVerifier =[\s\S]*pendingCoreMarketplaceVerifierNeeded\(messages\)[\s\S]*PENDING_LEGACY_VERIFIER_TIMEOUT_MS/,
  /const protocolResolvedInvalid =[\s\S]*rawVerifiedPrepared\.length > 0[\s\S]*rawVerifiedPrepared\.every\([\s\S]*valid === false[\s\S]*storePendingWorkMintInspection\([\s\S]*protocolResolvedInvalid/,
  /row\.status === "pending"[\s\S]*row\.eventCount === 0[\s\S]*!row\.protocolResolvedInvalid[\s\S]*!row\.resolvedInvalid/,
  /const resolvedInvalids = items\.filter\([\s\S]*token-event-invalid[\s\S]*Number\.isSafeInteger\(workMintAttemptCount\)[\s\S]*workMintAttemptCount > 0[\s\S]*return \{ kind: "resolved-invalid", persistInvalid: false \}/,
  /function reconcilePendingWorkMintDecision\([\s\S]*WITH canonical_guard AS[\s\S]*e\.status IN \('pending', 'dropped', 'orphaned'\)[\s\S]*e\.kind = 'token-mint'[\s\S]*provisionalReason'[\s\S]*supply-cap/,
  /function lockedCanonicalTransactionForMempool\([\s\S]*FOR UPDATE/,
  /upsertTransaction\([\s\S]*transactionObservation[\s\S]*lockedCanonicalTransactionForMempool[\s\S]*storePendingWorkMintInspection/,
  /pendingWorkReconciliation\.persistInvalid/,
  /function removeVolatileWorkMintDecisionEvents\([\s\S]*e\.status IN \('pending', 'dropped', 'orphaned'\)[\s\S]*e\.kind = 'token-mint'[\s\S]*provisionalReason'[\s\S]*supply-cap/,
  /persistCanonicalRawTransaction\([\s\S]*removeVolatileWorkMintDecisionEvents\([\s\S]*persistPreparedProtocolItems/,
]);
expectAll("ordered credit verifier classifies supply-saturated pending mints", server, [
  /acceptedMints[\s\S]*confirmedSupply[\s\S]*pendingSupply/,
  /confirmedSupply \+ pendingSupply \+ parsed\.amount > maxSupply/,
  /mint exceeds max supply:[\s\S]*confirmed[\s\S]*pending[\s\S]*requested/,
]);
const pendingWorkSupplyCapVerifierSource = sourceSliceBetween(
  server,
  /function pendingWorkMintFromHydratedTransaction/,
  /async function tokenVerifierDeterministicInvalidReason/,
);
expectAll("proof-index mint stats expose a complete bounded pending witness set", proofIndexReader, [
  /const TOKEN_PENDING_MINT_WITNESS_LIMIT = 32/,
  /const pendingCandidatesByTxid = new Map\(\)/,
  /pendingCandidateCount: pendingCandidateRows\.length/,
  /pendingCandidates: pendingCandidateRows\.slice/,
  /pendingCandidatesComplete:[\s\S]*TOKEN_PENDING_MINT_WITNESS_LIMIT/,
  /pendingCandidateSupply/,
  /targetMintStats/,
]);
expectAll("pending WORK supply-cap fast path fails closed on exact live truth", pendingWorkSupplyCapVerifierSource, [
  /network !== "livenet"[\s\S]*options\.requireConfirmed === true[\s\S]*tokenScope !== WORK_TOKEN_ID/,
  /messages\.length !== 1/,
  /parsed\.amount !== WORK_TOKEN_MINT_AMOUNT/,
  /WORK_TOKEN_DEFAULT_REGISTRY_ADDRESS[\s\S]*!== WORK_TOKEN_MINT_PRICE_SATS/,
  /fetchTransactionFromBitcoinRpc[\s\S]*requireCanonicalPrevouts: true[\s\S]*getmempoolentry/,
  /inputAddresses\(vin\)\[0\]/,
  /transactionHasCompleteCanonicalPrevouts\(tx\)/,
  /isValidBitcoinAddress\(actorAddress, network\)/,
  /proofIndexExactlyCoversCoreTip/,
  /targetConfirmedMints !== 0[\s\S]*!\[0, 1\]\.includes\(targetPendingMints\)/,
  /candidate\.txid !== normalizedTxid/,
  /pendingCandidatesComplete !== true/,
  /pendingCandidateCount !== pendingMints/,
  /pendingCandidateSupply !== pendingSupply/,
  /candidate\.txid\.localeCompare\(normalizedTargetTxid\) >= 0/,
  /witnessMint\?\.amount === candidate\.amount/,
  /validatedWitnessSupply !== witnessProof\.witnessSupply/,
  /finalSupply\.confirmedSupply !== supply\.confirmedSupply/,
  /finalSupply\.targetPendingMints !== supply\.targetPendingMints/,
  /finalWitnessProof\.witnesses\.some/,
  /finalMempoolMembership\.some\(\(present\) => present !== true\)/,
  /proof-indexer-pending-work-supply-cap-verifier/,
]);
expect(
  "pending WORK supply-cap fast path never trusts aggregate pending supply",
  !/supply\.acceptedSupply/u.test(pendingWorkSupplyCapVerifierSource) &&
    !/supply\.confirmedSupply \+ supply\.pendingSupply/u.test(
      pendingWorkSupplyCapVerifierSource,
    ),
);
expect(
  "WORK pending cap ordering matches canonical txid replay before display time",
  /function sortWorkMintsForPendingCap[\s\S]*String\(left\.txid[\s\S]*localeCompare\(String\(right\.txid[\s\S]*Date\.parse\(left\.createdAt\)/u.test(
    server,
  ),
);
expect(
  "pending WORK supply-cap fast path verifies mint membership twice",
  (pendingWorkSupplyCapVerifierSource.match(
    /proofIndexTokenMintStatsPayload\(/gu,
  ) ?? []).length === 2,
);
expectAll("pending ordered-verifier work has bounded normal and one-time legacy delay budgets", proofIndexerBackfill + canonicalRecoverySource, [
  /const MEMPOOL_SCAN_MAX_PROTOCOL_TXIDS = Math\.min\([\s\S]*5/,
  /const PENDING_VERIFIER_TIMEOUT_MS = Math\.min\([\s\S]*5_000[\s\S]*Math\.max\([\s\S]*1_000/,
  /Number\(tx\?\.height \?\? 0\) > 0[\s\S]*\? 30_000[\s\S]*: Math\.min\([\s\S]*PENDING_LEGACY_VERIFIER_TIMEOUT_MS[\s\S]*options\?\.pendingVerifierTimeoutMs/,
]);

expectAll("Log summary preserves full activity stats before compaction", compactActivitySummarySource, [
  /const activity = Array\.isArray\(payload\?\.activity\) \? payload\.activity : \[\]/,
  /activityStatsFromItems\(activity,\s*payload\?\.stats \?\? \{\}\)/,
  /const compactActivity = recentByCreatedAt\(activity,\s*SUMMARY_ACTIVITY_LIMIT\)[\s\S]*activity:\s*compactActivity/,
  /stats,/,
]);

expectAll("Growth and consistency preserve the canonical public Log action count", server, [
  /const canonicalConfirmedComputerActions = Number\(\s*computerActivity\?\.stats\?\.confirmed,?\s*\)/,
  /Number\.isSafeInteger\(canonicalConfirmedComputerActions\)[\s\S]*\? canonicalConfirmedComputerActions[\s\S]*activityForGrowth\.filter/,
  /const workFloorConfirmedComputerActions = Number\([\s\S]*workFloor\?\.stats\?\.confirmedComputerActions/,
  /function tokenActivityItemsFromState[\s\S]*token\?\.tokenId !== WORK_TOKEN_ID[\s\S]*!BOND_TOKEN_IDS\.has\(token\?\.tokenId\)/,
  /function tokenStateLogExpectations[\s\S]*token\.tokenId === WORK_TOKEN_ID[\s\S]*BOND_TOKEN_IDS\.has\(token\.tokenId\)/,
]);

expectAll("current canonical registry coverage outlives wall-clock cache age", server, [
  /rejectReason\.startsWith\("stale indexedAt"\)/,
  /proofIndexPayloadHasExplicitCurrentCoverage\([\s\S]*indexed-registry-current-coverage/,
  /function proofIndexPayloadHasExplicitCurrentCoverage[\s\S]*!Number\.isSafeInteger\(tipHeight\)[\s\S]*return false/,
]);

expectAll("canonical ledger builder owns shared state", server, [
  /async function buildCanonicalLedgerPayload\(network,\s*fresh\s*=\s*false\)/,
  /activityStateForCanonicalLedger\(network,\s*fresh\)/,
  /const valueTokenState = tokenStateWithScopedTokenOverride\(/,
  /let ledgerTokenState = valueTokenState/,
  /const indexedPowbState = ledgerTokenTableState[\s\S]*POWB_TOKEN_ID/,
  /const indexedIncbState = ledgerTokenTableState[\s\S]*INCB_TOKEN_ID/,
  /tokenStateWithScopedTokenOverride\([\s\S]*indexedPowbState[\s\S]*POWB_TOKEN_ID/,
  /tokenStateWithScopedTokenOverride\([\s\S]*indexedIncbState[\s\S]*INCB_TOKEN_ID/,
  /const seededMailActivityState = activityStateIsProofIndexCanonical\(activityState\)[\s\S]*seededMailActivityPayloadFromIndexedActivity\([\s\S]*seededMailActivityPayload\(network,\s*seedAddresses\)/,
  /\.\.\.\(Array\.isArray\(seededMailActivityState\?\.activity\)/,
  /tokenActivityItemsFromState\(\s*ledgerTokenState/,
  /workFloorPayloadFromState\(/,
  /growthSummaryPayloadFromLedger\(/,
  /infinitySummaryPayloadFromLedger\(/,
  /inceptionSummaryPayloadFromLedger\(/,
  /ledgerSnapshotChecks\(/,
  /snapshotId/,
]);

expectAll("canonical ledger directly merges seeded Computer mail", server, [
  /function canonicalMailSeedAddresses\(/,
  /function addTokenStateActivityAddresses\(/,
  /async function seededMailActivityPayload\(/,
  /function seededMailActivityPayloadFromIndexedActivity\(/,
  /async function buildSeededMailActivityPayload\(/,
  /seededMailActivityState/,
  /sourceCollectionFingerprint\(seededMailActivityState\?\.activity\)/,
]);

expectAll("WORK Growth Log and token views use the same ledger", server, [
  /async function canonicalLedgerPayload\(network,\s*fresh\s*=\s*false\)/,
  /async function summaryCanonicalLedgerPayload\(network,\s*fresh\s*=\s*false\)[\s\S]*currentLedgerPayloadOrNull\([\s\S]*"canonical ledger fallback"[\s\S]*refreshCanonicalLedgerPayloadInBackground\(network,\s*true\)/,
  /async function activityPayloadWithLiveWorkTokenOverlay\(ledger,\s*fresh\s*=\s*false\)[\s\S]*liveWorkTokenStateWithFallbackAfterMs\([\s\S]*tokenActivityItemsFromState\(/,
  /async function mergedLogActivityPayload\(network,\s*fresh\s*=\s*false\)[\s\S]*summaryCanonicalLedgerPayload\(network,\s*fresh\)[\s\S]*activityPayloadWithLiveWorkTokenOverlay\(ledger,\s*fresh\)[\s\S]*Current Log ledger is unavailable/,
  /async function proofIndexWorkFloorPayload\(network\)[\s\S]*canonical ledger required[\s\S]*return null/,
  /async function cachedWorkFloorPayload\(network,\s*fresh\s*=\s*false\)[\s\S]*existingCurrentCanonicalLedgerPayloadWithinMs\([\s\S]*"work-floor canonical ledger"[\s\S]*Current WORK floor ledger is unavailable[\s\S]*summaryCanonicalLedgerPayload\(network,\s*fresh\)[\s\S]*Fresh WORK floor ledger is unavailable/,
  /async function growthSummaryPayload\(network,\s*fresh\s*=\s*false\)[\s\S]*summaryCanonicalLedgerPayload\(network,\s*fresh\)[\s\S]*workFloorWithSummaryMarketOverlay\([\s\S]*growthSummaryWithCanonicalWorkFloor\([\s\S]*Current Growth summary ledger is unavailable/,
  /async function tokenPayloadForRead[\s\S]*summaryCanonicalLedgerPayload\(network,\s*true\)[\s\S]*existingCanonicalLedgerPayload\(network\)[\s\S]*ledgerTokenStateForScope\(ledger,\s*scope\)/,
  /function liveWorkReadWaitMs\(options[\s\S]*Number\.isFinite\(options\.liveWorkWaitMs\)[\s\S]*liveWorkTokenStateWithFallbackAfterMs\([\s\S]*liveWorkReadWaitMs\(options\)/,
  /async function tokenSummaryPayload[\s\S]*let payload = await tokenPayloadForRead\(network,\s*scope,\s*fresh/,
  /async function tokenHistoryPayload[\s\S]*proofIndexTokenMarketHistoryOverlayPayload\([\s\S]*proofIndexWalletTokenOverlayPayload\([\s\S]*workTokenStateWithIndexedActiveListings\([\s\S]*let payload = await tokenPayloadForRead\(\s*network,\s*scope,\s*fresh \|\| scopedWorkMarketHistory/,
  /url\.pathname === "\/api\/v1\/token"[\s\S]*const tokenFreshRead[\s\S]*const payload = await tokenPayloadForRead\(network,\s*tokenScope,\s*tokenFreshRead/,
]);
expectAll("livenet summaries prefer one exact stored canonical snapshot", server, [
  /async function workSummaryPayload\(network,\s*fresh\s*=\s*false\)[\s\S]*currentProofIndexSummarySnapshotFallbackPayload\([\s\S]*"workSummary"[\s\S]*if \(!fresh\)/,
  /async function livenetMarketplaceSummaryPayload\(network,\s*fresh\s*=\s*false\)[\s\S]*currentProofIndexMarketplaceSummaryFallbackPayload\([\s\S]*if \(exactIndexedPayload\)[\s\S]*if \(!fresh\)/,
  /async function growthSummaryPayload\(network,\s*fresh\s*=\s*false\)[\s\S]*if \(network === "livenet"\)[\s\S]*currentProofIndexSummarySnapshotFallbackPayload\([\s\S]*"growthSummary"/,
]);

expectAll("searched WORK balance history uses exact recovery inputs", server, [
  /function recoveryAddressCandidateValuesFromSearchParams\(searchParams\)[\s\S]*for \(const key of \["q",\s*"search"\]\)/,
  /function recoveryAddressHintsFromSearchParams\(searchParams,\s*network\)[\s\S]*addressLooksRecoverable\(value,\s*network\)/,
  /function recoveryAddressesFromSearchParams\(searchParams,\s*network\)[\s\S]*recoveryAddressCandidateValuesFromSearchParams\(searchParams\)[\s\S]*isValidBitcoinAddress\(value,\s*network\)/,
  /function recoveryTxidsFromSearchParams\(searchParams\)/,
  /async function liveWorkTokenState\(network,\s*cachedWorkTokenState,\s*options = \{\}\)[\s\S]*const recoveryTxids = Array\.isArray\(options\.recoveryTxids\)/,
  /const \[confirmedPendingTxs,\s*recoveredTxidTxs\] = await Promise\.all/,
  /async function tokenPayloadForRead[\s\S]*hasRecoveryTxids[\s\S]*recoveryTxids: options\.recoveryTxids/,
  /async function tokenHistoryPayload[\s\S]*const recoveryTxids = recoveryTxidsFromSearchParams\(searchParams\)[\s\S]*recoveryTxids,/,
]);

expectAll("frontend holder searches use remote holder history", app, [
  /const \[remoteHolderPage,\s*setRemoteHolderPage\] = useState/,
  /fetchTokenHistoryPage<PowTokenHolder>\(network,\s*"holders"/,
  /fresh:\s*true/,
  /holderHistoryTotalHint > holderHistoryLocalCount/,
  /const selectedRemoteHolderPage =[\s\S]*historyPageToPagedItems\([\s\S]*activeRemoteHolderPage/,
  /const detailRemoteHolderPage =[\s\S]*historyPageToPagedItems\([\s\S]*activeRemoteHolderPage/,
  /renderHolderList = \([\s\S]*loadingRemotePage = false/,
]);

expectAll("scoped token holder identity survives summary compaction and paging", server + proofIndexReader, [
  /function tokenPayloadWithScopedHolderIdentity\([\s\S]*tokens\.length !== 1[\s\S]*ticker: token\.ticker[\s\S]*tokenId: token\.tokenId/,
  /function scopedTokenPayloadFromState\([\s\S]*return tokenPayloadWithScopedHolderIdentity\([\s\S]*normalizedScope\)/,
  /function compactTokenSummaryPayload\([\s\S]*return tokenPayloadWithScopedHolderIdentity\([\s\S]*scope\)/,
  /async function workSummaryWithCurrentBtcUsd\([\s\S]*tokenPayloadWithScopedHolderIdentity\([\s\S]*WORK_TOKEN_ID/,
  /async function scopedHoldersFromBalances\([\s\S]*JOIN proof_indexer\.credit_definitions[\s\S]*ticker: row\.ticker[\s\S]*tokenId:/,
  /async function proofIndexScopedHolderHistoryPayload\([\s\S]*ticker: token\.ticker[\s\S]*tokenId: token\.token_id/,
]);

expectAll("frontend scoped credit mint supply ignores global summary totals", app, [
  /function nonNegativeSafeInteger\(value:\s*unknown\)/,
  /function tokenSupplyValue\([\s\S]*key:\s*"confirmedSupply" \| "pendingSupply"/,
  /function scopedTopLevelSupplyValue\([\s\S]*supply > maxSupply[\s\S]*return undefined/,
  /const tokenRowConfirmedSupply = tokenSupplyValue\([\s\S]*"confirmedSupply"/,
  /const scopedTopLevelConfirmedSupply = summaryOnly[\s\S]*scopedTopLevelSupplyValue\(state\.confirmedSupply,\s*tokens\[0\]\)/,
  /confirmedSupply: scopedConfirmedSupply \?\?[\s\S]*scopedTopLevelConfirmedSupply \?\?[\s\S]*topLevelConfirmedSupply \?\?/,
  /pendingSupply: scopedPendingSupply \?\?[\s\S]*scopedTopLevelPendingSupply \?\?[\s\S]*topLevelPendingSupply \?\?/,
]);

expectAll("server scoped credit fresh reads use direct scoped refresh before ledger", server, [
  /fresh &&[\s\S]*scope &&[\s\S]*scope !== WORK_TOKEN_ID &&[\s\S]*options\.preferScopedRefresh !== false[\s\S]*refreshTokenPayload\(network,\s*scope\)/,
]);

expectAll("server bond activity rejects stale proof-index seed data", server, [
  /const POWB_ACTIVITY_FRESH_WAIT_MS = Number\(/,
  /async function indexedBondActivityForTokenState\(network,\s*config\)[\s\S]*indexedThroughBlock[\s\S]*stats:\s*{[\s\S]*indexedThroughBlock/,
  /async function bondActivityForTokenState\([\s\S]*proofIndexPayloadCoversConfirmedTip\([\s\S]*`\$\{config\.ticker\.toLowerCase\(\)\}-activity`[\s\S]*payloadWithFallbackAfterMs\([\s\S]*globalActivityPayload\(network,\s*true\)/,
]);

expectAll("server bond listings recover confirmed parent mints", server, [
  /async function bondSeedMintsWithSaleTicketParents\([\s\S]*fetchTransactionWithSourceFallback\(parentTxid,\s*network\)[\s\S]*mailActivityItemFromTransaction\(parentTx,\s*network\)[\s\S]*isBondActivityItem\(activityItem,\s*config\)/,
  /const seedMints = await bondSeedMintsWithSaleTicketParents\([\s\S]*bondSeed\.seedMints[\s\S]*registryTxs[\s\S]*config/,
  /function bondRegistryAddressFromTokenTransactions\(txs,\s*network,\s*config\)[\s\S]*tokenPaymentAmountBeforeProtocol\(vout,\s*registryAddress\)/,
  /async function recoveredBondTokenPayloadFromTransactions\([\s\S]*bondRegistryAddressFromTokenTransactions\(confirmedTxs,\s*network,\s*config\)[\s\S]*bondSeedMintsWithSaleTicketParents\([\s\S]*first-party-\$\{config\.ticker\.toLowerCase\(\)\}-txid-recovery/,
  /BOND_TOKEN_IDS\.has\(scope\)[\s\S]*recoveryTxids\.length > 0[\s\S]*recoveredBondTokenPayloadFromTransactions\(/,
]);

expectAll("server bond fresh scoped reads do not return stale cached fallback", server, [
  /const scopedRefreshWaitMs = Number\.isFinite\(options\.scopedRefreshWaitMs\)[\s\S]*BOND_TOKEN_IDS\.has\(scope\)[\s\S]*WORK_TOKEN_CANONICAL_FRESH_WAIT_MS/,
  /fallback &&[\s\S]*!BOND_TOKEN_IDS\.has\(scope\)[\s\S]*scoped-token-fallback/,
]);

expectAll("server token reads preserve canonical ledger rows when table state regresses", server, [
  /function tokenPayloadWithCanonicalHistoryFloor\(canonicalPayload,\s*payload\)[\s\S]*confirmedSupplyRegressed[\s\S]*holdersRegressed[\s\S]*mergeCanonicalHistoryItems/,
  /function mergeTokenPayloadWithCanonicalFloor\(canonicalPayload,\s*payload,\s*scope\)[\s\S]*const canonicalScopedPayload = scopedTokenPayloadFromState[\s\S]*const scopedState = tokenPayloadWithCanonicalHistoryFloor/,
  /async function indexedTokenPayloadFreshnessFloor\(network,\s*scope,\s*options = \{\}\)[\s\S]*tokenPayloadWithCanonicalLedgerFloor\([\s\S]*`token-state fresh-floor:\$\{scope \|\| "all"\}`/,
  /const flooredScopedPayload =[\s\S]*tokenPayloadWithCanonicalLedgerFloor\([\s\S]*`scoped-token:\$\{scope\}`[\s\S]*tokenPayloadReadResult\(\s*flooredScopedPayload/,
  /payload = await tokenPayloadWithCanonicalLedgerFloor\([\s\S]*`token-payload:\$\{scope \|\| "all"\}`/,
]);

expectAll("server fresh token state reads fall back to valid cached snapshots", server, [
  /async function cachedTokenPayloadFallbackForRead\([\s\S]*cachedTokenPayloadSnapshotNoRefresh\(network,\s*scope\)[\s\S]*rejectEmptyMainnetTokenPayload\(network,\s*payload,\s*scope,\s*label\)[\s\S]*existingCurrentCanonicalLedgerPayloadWithinMs\([\s\S]*existingCanonicalLedgerPayload\(network\)[\s\S]*ledgerPayloadForFreshnessCompare\(ledger,\s*scope\)[\s\S]*refreshTokenPayloadCacheInBackground\(network,\s*scope\)/,
  /url\.pathname === "\/api\/v1\/token"[\s\S]*"token-state-fresh-memory"[\s\S]*cachedTokenPayloadFallbackForRead\([\s\S]*"token-state-fresh-cache"[\s\S]*Fresh credit state is still catching up/,
]);

expectAll("server canonical summaries require hash-bound database snapshots", server, [
  /async function storedCanonicalTokenSummaryPayload\([\s\S]*proofIndexSnapshotPayload\([\s\S]*payloadIndexedThroughBlockHash/,
  /async function tokenSummaryPayload\([\s\S]*storedCanonicalTokenSummaryPayload\([\s\S]*Fresh hash-bound credit summary is still catching up/,
  /async function activitySummaryPayload\([\s\S]*"logSummary"[\s\S]*payloadIndexedThroughBlockHash\(storedSummary\)/,
]);

expectAll("server WORK transfer txid history recovers without full ledger rebuild", server, [
  /const WORK_TOKEN_TRANSFER_RECOVERY_TXIDS = new Set\(/,
  /const TOKEN_ADDRESS_TRANSFER_RECOVERY_MAX_PAGES = Number\(/,
  /const TOKEN_ADDRESS_TRANSFER_RECOVERY_WAIT_MS = Number\(/,
  /function workTransfersFromTransactions\(txs,\s*network\)[\s\S]*parsed\?\.kind !== "send"[\s\S]*WORK_TOKEN_DEFAULT_REGISTRY_ADDRESS/,
  /async function recoveredWorkTransfersForAddresses\(addresses,\s*network\)[\s\S]*WORK_TOKEN_TRANSFER_RECOVERY_TXIDS[\s\S]*fetchAddressTransactionsViaMempoolPagination\([\s\S]*TOKEN_ADDRESS_TRANSFER_RECOVERY_WAIT_MS[\s\S]*workTransfersFromTransactions/,
  /scope === WORK_TOKEN_ID &&[\s\S]*recoveryTxids\.length > 0[\s\S]*safeKind === "transfers"[\s\S]*first-party-work-transfer-txid-recovery/,
  /scope === WORK_TOKEN_ID &&[\s\S]*recoveryAddresses\.length > 0[\s\S]*safeKind === "transfers"[\s\S]*first-party-work-transfer-address-recovery/,
]);

expectAll("server WORK market invalid txid history recovers related listings", server, [
  /function workRelatedListingTxidsFromTransactions\(txs,\s*network\)[\s\S]*parsed\?\.kind === "seal"[\s\S]*listingTxids\.add\(listingId\)/,
  /async function recoveredWorkMarketPayloadFromTransactions\([\s\S]*workRelatedListingTxidsFromTransactions\([\s\S]*workTokenStateWithRecoveredListingSeals\(/,
  /safeKind === "invalidEvents"[\s\S]*recoveredWorkMarketPayloadFromTransactions\([\s\S]*hasRecoveredValidMarketEvent/,
]);

expectAll("server compact token summaries preserve existing row supply metrics", server, [
  /function tokenSummaryMetricValue\(value\)[\s\S]*Number\.isFinite\(number\) && number >= 0/,
  /function mergedTokenSummaryMetric\(token,\s*summary,\s*key,\s*preserveExisting\)[\s\S]*preserveExisting && tokenValue !== undefined/,
  /const preserveExistingTokenMetrics = payload\.summaryOnly === true/,
  /confirmedSupply:\s*mergedTokenSummaryMetric\(\s*token,\s*summary,\s*"confirmedSupply",\s*preserveExistingTokenMetrics,\s*\)/,
  /pendingSupply:\s*mergedTokenSummaryMetric\(\s*token,\s*summary,\s*"pendingSupply",\s*preserveExistingTokenMetrics,\s*\)/,
  /nextConfirmedSupply > scopedConfirmedSupply[\s\S]*nextPendingSupply > scopedPendingSupply/,
]);

expectAll("Desktop public search stays on first-party ProofOfWork API", app, [
  /function DesktopApp\([\s\S]*<DesktopWorkspace[\s\S]*onSearch=\{onSearch\}/,
]);
expectAll("Desktop address mail read stays first-party", fetchAddressMailSource, [
  /async function fetchAddressMail\(\s*targetAddress:\s*string,\s*targetNetwork:\s*BitcoinNetwork,\s*fresh = false,\s*\)/,
  /const suffix = fresh \? "\?fresh=1" : ""/,
  /fetchProofApiJson<[\s\S]*`\/api\/v1\/address\/\$\{encodeURIComponent\(targetAddress\)\}\/mail\$\{suffix\}`/,
]);
expectAll("Desktop search loader uses address mail read", loadDesktopTargetSource, [
  /async function loadDesktopTarget\(target = desktopQuery\)/,
  /fetchAddressMail\(resolved\.paymentAddress,\s*network\)/,
]);
expect("Desktop public search must keep fetchAddressMail source present", Boolean(fetchAddressMailSource));
expect("Desktop public search must keep loadDesktopTarget source present", Boolean(loadDesktopTargetSource));
expect("Desktop public app source must stay present", Boolean(desktopAppSource));
expect("Desktop public route must not expose network switching controls", !/onNetworkChange/.test(desktopAppSource));
expectAll("Desktop public route has dedicated metadata", app, [
  /desktopRoute[\s\S]*Search public confirmed ProofOfWork files by address or confirmed ProofOfWork ID\./,
  /title:\s*"ProofOfWork Desktop"/,
  /\},\s*\[browserRoute,\s*desktopRoute,\s*idLaunchMode\]\)/,
]);
expectAll("Browser public route has dedicated metadata", app, [
  /browserRoute[\s\S]*Render ProofOfWork HTML message bodies and verified HTML attachments by transaction ID\./,
  /title:\s*"ProofOfWork Browser"/,
  /\},\s*\[browserRoute,\s*desktopRoute,\s*idLaunchMode\]\)/,
]);
expect("fetchAddressMail must not call public mempool.space", !/mempool\.space/i.test(fetchAddressMailSource));
expect("loadDesktopTarget must not call public mempool.space", !/mempool\.space/i.test(loadDesktopTargetSource));
expect("DesktopApp must not call public mempool.space", !/mempool\.space/i.test(desktopAppSource));
expect(
  "frontend app reads must not call public mempool.space address APIs",
  !/mempool\.space\/api\/address/i.test(app),
);
expectAll("API address app reads stay first-party", server, [
  /const ADDRESS_ELECTRUM_HISTORY_TIMEOUT_MS = Number\([\s\S]*30_000/,
  /function firstPartyAddressReadBases\(network\)[\s\S]*mempoolBase\(network\)[\s\S]*pendingMempoolBases\(network\)\.filter/,
  /async function fetchAddressMempoolTransactions\(address,\s*network,\s*options = \{\}\)[\s\S]*options\.includeExternal === false[\s\S]*firstPartyAddressReadBases\(network\)/,
  /async function fetchAddressTransactionsViaMempoolPagination\([\s\S]*options = \{\}[\s\S]*options\.includeExternal === false[\s\S]*firstPartyAddressReadBases\(network\)/,
  /async function fetchAddressTransactions\([\s\S]*const includeExternal = options\.includeExternal !== false[\s\S]*fetchAddressMempoolTransactions\(address,\s*network,\s*\{[\s\S]*includeExternal/,
  /async function fetchAddressTransactions\([\s\S]*if \(!includeExternal\) \{[\s\S]*throw error;[\s\S]*\}/,
  /proofIndexAddressMailPayload/,
  /async function nodeMailPayload\(address,\s*network,\s*options = \{\}\)[\s\S]*let scanError = ""[\s\S]*MAIL_ADDRESS_TX_PAGES[\s\S]*includeExternal:\s*options\.includeExternal !== false[\s\S]*preferExternal:\s*options\.preferExternal === true[\s\S]*Mail scan failed[\s\S]*scanFailed: Boolean\(scanError\)/,
  /async function indexedMailPayload\(address,\s*network\)[\s\S]*proofIndexReadFeatureEnabled\("address-mail,mail,event-history,events"\)[\s\S]*proofIndexAddressMailPayload\(network,\s*address\)/,
  /async function reconcileMailPayloadStatuses\(payload,\s*network\)[\s\S]*txStatusPayload\(txid,\s*network\)[\s\S]*status\?\.status === "dropped"[\s\S]*return \[\]/,
  /function mailActivityItemFromTransaction\(tx,\s*network\)[\s\S]*memo: protocolMessage\.memo[\s\S]*subject: protocolMessage\.subject/,
  /function mailPayloadHasMessages\(payload\)/,
  /function mailMessageNeedsAttachmentRepair\(message\)[\s\S]*return !message\?\.attachment/,
  /function mailMessageNeedsContentRepair\(message\)[\s\S]*mailMessageNeedsBodyRepair\(message\)[\s\S]*mailMessageNeedsAttachmentRepair\(message\)/,
  /async function repairMailPayloadBodies\(payload,\s*address,\s*network\)[\s\S]*mailMessageNeedsContentRepair[\s\S]*fetchTransactionWithSourceFallback\(txid,\s*network\)[\s\S]*inboxMessagesFromTransactions\(\[tx\],\s*address,\s*network\)[\s\S]*repairedAttachments/,
  /function livenetAddressMailRequiresProofIndex\(network\)[\s\S]*proofIndexReadFeatureEnabled\("address-mail,mail,event-history,events"\)/,
  /async function mailPayload\(address,\s*network,\s*options = \{\}\)[\s\S]*const indexedPayload = await indexedMailPayload\(address,\s*network\)[\s\S]*const requiresIndexedMail = livenetAddressMailRequiresProofIndex\(network\)[\s\S]*if \(indexedPayload && \(!fresh \|\| requiresIndexedMail\)\) \{[\s\S]*return enrichIndexedPayload\(\)/,
  /async function mailPayload\(address,\s*network,\s*options = \{\}\)[\s\S]*if \(requiresIndexedMail\) \{[\s\S]*Current indexed mailbox is unavailable/,
  /async function mailPayload\(address,\s*network,\s*options = \{\}\)[\s\S]*const indexedWasEmpty = Boolean\(indexedPayload\) && !mailPayloadHasMessages\(indexedPayload\)[\s\S]*includeExternal:\s*indexedWasEmpty \|\| fresh \|\| !indexedPayload[\s\S]*preferExternal:\s*indexedWasEmpty/,
  /async function mailPayload\(address,\s*network,\s*options = \{\}\)[\s\S]*mergeMailPayloads\(indexedPayload,\s*scannedPayload\)/,
  /mailPayload\(address,\s*network,\s*\{ fresh: freshRead \}\)/,
  /async function firstPartyAddressUtxoPayload\(address,\s*network\)[\s\S]*firstPartyAddressReadBases\(network\)/,
]);
expectAll("interactive wallet UTXO reads use an isolated local Electrum lane", server, [
  /const ELECTRUM_INTERACTIVE_CLIENT = createElectrumClient\(\{[\s\S]*maxInFlight: ELECTRUM_INTERACTIVE_MAX_IN_FLIGHT[\s\S]*maxQueue: ELECTRUM_INTERACTIVE_MAX_QUEUE/,
  /function interactiveElectrumRequest\(method,\s*params,\s*timeoutMs = 30_000\)[\s\S]*ELECTRUM_INTERACTIVE_CLIENT\.request\(method,\s*params,\s*timeoutMs\)/,
]);
expectAll("interactive wallet UTXO reads prefer authoritative Electrum", fetchAddressUtxosFromElectrumSource, [
  /interactiveElectrumRequest\([\s\S]*"blockchain\.scripthash\.listunspent"/,
  /ADDRESS_UTXO_FETCH_TIMEOUT_MS/,
]);
expectAll("mainnet wallet UTXO resolution fails closed on the first-party lane", firstPartyAddressUtxoSource + addressUtxoPayloadSource, [
  /network === "livenet"[\s\S]*return await requireUtxoArray\([\s\S]*"Electrum"[\s\S]*fetchAddressUtxosFromElectrum\(address,\s*network\)[\s\S]*catch \(error\)[\s\S]*throw error/,
  /const candidates = firstPartyAddressReadBases\(network\)[\s\S]*for \(const candidate of candidates\)[\s\S]*return await candidate\.read\(\)/,
  /network !== "livenet"[\s\S]*fetchAddressUtxosFromSecondaryExplorers\(address,\s*network\)/,
  /async function addressUtxoPayload\(address,\s*network\)[\s\S]*return await firstPartyAddressUtxoPayload\(address,\s*network\)/,
]);
expect(
  "interactive wallet UTXO resolution must not wait for every slow fallback",
  !/Promise\.all/.test(firstPartyAddressUtxoSource + addressUtxoPayloadSource),
);
expect(
  "mainnet wallet UTXO resolution must not call external explorer fallbacks",
  !/fetchAddressUtxosFromBlockchainInfo|Blockchain\.info/.test(
    firstPartyAddressUtxoSource + addressUtxoPayloadSource,
  ),
);
expectAll("proof index mail body projection separates subject from body", proofIndexReader + proofIndexerBackfill, [
  /function mailMemoFromEvent\(row,\s*payload\)[\s\S]*payload\.body \?\? payload\.message \?\? payload\.memo[\s\S]*!subjectOnlyMailBody\(storedBody\)/,
  /function mailItemBodyText\(item\)[\s\S]*item\?\.body \?\? item\?\.message \?\? item\?\.memo[\s\S]*!subjectOnlyMailBody\(detail\)/,
]);
expectAll("proof index address mail exposes file kinds for Desktop repair", proofIndexReader, [
  /protocolKind:\s*row\.kind/,
]);
expectAll("proof index address mail recovers sender-only file rows", proofIndexReader, [
  /\{\s*address:\s*row\.sender_address,\s*role:\s*"sender"\s*\}/,
  /function rawTransactionItemPayload\(row\)/,
  /knownMailAddress\(payload\.actor\)[\s\S]*knownMailAddress\(payload\.senderAddress\)[\s\S]*knownMailAddress\(rawPayload\.senderAddress\)[\s\S]*knownMailAddress\(row\.sender_address\)/,
  /m\.sender_address/,
  /t\.raw_tx AS transaction_raw_tx/,
  /WITH candidate_events AS \([\s\S]*proof_indexer\.event_participants ep[\s\S]*ep\.address = ANY\(\$2::text\[\]\)[\s\S]*UNION[\s\S]*proof_indexer\.mail_items m[\s\S]*m\.sender_address = ANY\(\$2::text\[\]\)[\s\S]*JOIN candidate_events ce/,
]);
expect("pending mempool bases must not hardcode public explorer data sources", !/explorerBase|explorerReadBases|mempool\.space/i.test(pendingMempoolBasesSource));
expectAll("transaction hex PSBT reads stay first-party", txHexPayloadSource, [
  /fetchTransactionHexFromBitcoinRpc\(txid,\s*network\)/,
  /fetchTransactionHexFromElectrum\(txid,\s*network\)/,
  /for \(const base of firstPartyAddressReadBases\(network\)\)/,
]);
expect("transaction hex PSBT reads must not call public explorer fallbacks", !/explorerBase|explorerReadBases|fetchTextViaHttps|mempool\.space/i.test(txHexPayloadSource));
expectAll("wallet scoped token reads keep confirmed lifecycle history", server, [
  /function compactTokenSummaryPayload\(payload,\s*tokenScope = ""\)[\s\S]*const walletScopedSummary =[\s\S]*payload\.walletScoped === true \|\| stats\.walletScoped === true/,
  /const closedListingLimit = walletScopedSummary[\s\S]*Math\.max\(closedListings\.length,\s*SUMMARY_MARKET_LIMIT\)/,
  /const compactClosedListings = recentClosedTokenListings\([\s\S]*closedListingLimit[\s\S]*closedListings:\s*compactClosedListings/,
  /function tokenStateWithPreservedListingRecords\(state,\s*sourceState\)[\s\S]*const preservedClosedListingIds = new Set\([\s\S]*sourceState\?\.closedListings[\s\S]*if \(!preservedClosedListingIds\.has\(listingId\)\)/,
  /async function tokenPayloadWithIndexedWalletOverlay\([\s\S]*proofIndexWalletTokenOverlayPayload\([\s\S]*mergeTokenStateItemsByKey\([\s\S]*transfers/,
  /async function tokenPayloadWithIndexedWalletOverlay\([\s\S]*const invalidEvents = mergeTokenStateItemsByKey\([\s\S]*overlay\.invalidEvents[\s\S]*invalidEvents: invalidEvents\.length/,
  /async function tokenPayloadWithIndexedWalletOverlay\([\s\S]*sourceTokens = \[\][\s\S]*walletTokenIds[\s\S]*const tokens = mergeTokenStateItemsByKey/,
  /async function walletScopedTokenPayload\([\s\S]*currentProofIndexTokenPayloadForRead\([\s\S]*tokenPayloadScopedToAddresses[\s\S]*tokenPayloadWithIndexedWalletOverlay[\s\S]*tokenPayloadWithIndexedWalletClosedListings/,
  /async function walletScopedTokenPayload\([\s\S]*requireCurrent[\s\S]*Fresh wallet credit state is still catching up[\s\S]*authoritativeWallet: true/,
  /async function walletScopedTokenSummaryPayload\([\s\S]*currentProofIndexTokenPayloadForRead\([\s\S]*tokenPayloadScopedToAddresses[\s\S]*tokenPayloadWithIndexedWalletOverlay/,
  /async function indexedWalletClosedListings\([\s\S]*kind: "token-closed-listings"[\s\S]*proofIndexEventHistoryPayload/,
  /async function tokenPayloadWithIndexedWalletClosedListings\([\s\S]*tokenStateWithPreservedListingRecords/,
  /url\.pathname === "\/api\/v1\/token"[\s\S]*if \(walletScoped\) \{[\s\S]*walletScopedTokenPayload/,
  /url\.pathname === "\/api\/v1\/token"[\s\S]*walletScopedTokenPayload\([\s\S]*requireCurrent: freshRead/,
  /url\.pathname === "\/api\/v1\/token-summary"[\s\S]*const walletScoped =[\s\S]*walletScopedTokenSummaryPayload/,
]);
expectAll("proof index wallet token overlay reads balances and events", proofIndexReader, [
  /export async function proofIndexWalletTokenOverlayPayload\(/,
  /proof_indexer\.credit_balances cb/,
  /const invalidResult = await pool\.query\([\s\S]*tokenInvalidEventSelectSql\(\)[\s\S]*ep_wallet_invalid[\s\S]*invalidEvents/,
  /e\.kind IN \([\s\S]*'token-transfer'[\s\S]*'token-sale'[\s\S]*'token-listing'[\s\S]*'token-listing-closed'[\s\S]*\)/,
  /export async function proofIndexTokenMarketSummaryOverlayPayload\(/,
  /proofIndexTokenMarketSummaryOverlayPayload\([\s\S]*latestProofIndexScanMetadata\(pool,\s*network\)[\s\S]*scanIndexedThroughBlock[\s\S]*stats:[\s\S]*complete:/,
  /export async function proofIndexCreditListingsPayload\([\s\S]*latestProofIndexScanMetadata\(pool,\s*network\)[\s\S]*proof_indexer\.credit_listings[\s\S]*stats:[\s\S]*complete:/,
  /e\.kind = ANY\(\$2::text\[\]\)/,
  /"proof-indexer-token-market-summary-overlay"/,
]);
expectAll("wallet token overlays publish canonical token definitions", proofIndexReader, [
  /async function proofIndexTokenDefinitionsByIds\(pool,\s*network,\s*tokenIds\)[\s\S]*normalizedTokenIds/,
  /FROM proof_indexer\.credit_definitions[\s\S]*token_id = ANY\(\$2::text\[\]\)/,
  /const tokens = result\.rows[\s\S]*\.map\(tokenDefinitionFromRow\)[\s\S]*\.filter\(\(token\) => token\.tokenId\)/,
]);
expectAll("wallet token overlays enforce the holder-to-definition invariant", proofIndexReader, [
  /const definedTokenIds = new Set\(tokens\.map\(\(token\) => token\.tokenId\)\)/,
  /const missingTokenIds = normalizedTokenIds\.filter\([\s\S]*!definedTokenIds\.has\(tokenId\)/,
  /if \(missingTokenIds\.length > 0\) \{[\s\S]*throw new Error\([\s\S]*without canonical definitions/,
]);
expectAll("wallet token overlay definitions cover every returned token-bearing row", indexedWalletTokenOverlaySource, [
  /const tokenBearingItems = \[[\s\S]*\.\.\.holders,[\s\S]*\.\.\.transfers,[\s\S]*\.\.\.sales,[\s\S]*\.\.\.listings,[\s\S]*\.\.\.closedListings,[\s\S]*\]/,
  /proofIndexWalletTokenDefinitions\([\s\S]*scope,[\s\S]*tokenBearingItems\.map\(\(item\) => item\?\.tokenId\)/,
  /return \{[\s\S]*tokens,[\s\S]*transfers:/,
]);
expectAll("scoped zero-balance wallet projections retain their canonical definition", proofIndexReader, [
  /async function proofIndexWalletTokenDefinitions\(/,
  /scoped[\s\S]*proofIndexTokenDefinitionsFromTables\(pool, network, scope\)/,
  /for \(const token of \[\.\.\.itemDefinitions, \.\.\.scopedDefinitions\]\)/,
]);
expectAll("wallet token overlays use indexed exact-address lookups", indexedWalletTokenOverlaySource, [
  /cb\.address = ANY\(\$2::text\[\]\)/,
  /ep_wallet_invalid\.address = ANY\([^)]*::text\[\]\)/,
  /ep\.address = ANY\(\$2::text\[\]\)/,
  /cl\.seller_address = ANY\(\$2::text\[\]\)/,
]);
expectAll("authoritative wallet projections fail closed before row caps can hide spendability", indexedWalletTokenOverlaySource, [
  /walletAuthoritativeRowLimit = 500/,
  /walletAuthoritativeRowLimit \+ 1/,
  /CASE WHEN e\.status = 'pending' THEN 0 ELSE 1 END ASC/,
  /walletProjectionExceedsLimit\([\s\S]*eventResult\.rows[\s\S]*"pending"[\s\S]*throw new Error/,
  /walletProjectionExceedsLimit\([\s\S]*listingResult\.rows[\s\S]*throw new Error/,
]);
expect(
  "wallet token overlays must not bypass address indexes with lower expressions",
  !/lower\((?:cb|ep|ep_wallet_invalid|cl)\.(?:address|seller_address)\)/.test(
    indexedWalletTokenOverlaySource,
  ),
);
expectAll("API wallet overlay merge consumes indexed canonical token definitions", walletTokenOverlayMergeSource, [
  /const definitionCandidates = \[[\s\S]*sourceTokens[\s\S]*overlay\.tokens/,
  /const tokens = mergeTokenStateItemsByKey\([\s\S]*definitionCandidates\.filter\(/,
]);
expectAll("wallet balance reads require an exact hashed index checkpoint", server, [
  /function walletTokenOverlayHasExactCheckpoint\(overlay\)[\s\S]*checkpointComplete === true[\s\S]*Number\.isSafeInteger\(indexedThroughBlock\)[\s\S]*sourceBlockHash === indexedThroughBlockHash[\s\S]*snapshotId/,
  /function walletTokenOverlayMatchesPayloadCheckpoint\(payload,\s*overlay\)[\s\S]*walletTokenOverlayHasExactCheckpoint\(overlay\)[\s\S]*payloadHeight === overlayHeight[\s\S]*\^\[0-9a-f\]\{64\}[\s\S]*payloadHash === overlay\.indexedThroughBlockHash/,
  /function walletTokenOverlayMatchesCanonicalGate\(overlay,\s*gate\)[\s\S]*gate\?\.ready !== true[\s\S]*gate\?\.tipHeight[\s\S]*canonicalHash === overlayHash[\s\S]*storedHash === overlayHash/,
  /async function proofIndexWalletScopedTokenPayloadForRead\([\s\S]*if \(!walletTokenOverlayHasExactCheckpoint\(overlay\)\)[\s\S]*return null/,
  /proofIndexWalletScopedTokenPayloadForRead\([\s\S]*\{ requireCurrent \}[\s\S]*authoritativeWallet:\s*true/,
  /if \(requireCurrent\) \{[\s\S]*CANONICAL_WALLET_INDEX_UNAVAILABLE[\s\S]*throw unavailable/,
  /function walletScopedTokenPayloadFromOverlay\(overlay,\s*network,\s*tokenScope\)[\s\S]*walletTokenPayloadWithCanonicalDefinitions\([\s\S]*confirmedTokens:\s*tokens\.filter/,
]);
expectAll("fresh wallet overlays preserve their exact checkpoint proof", walletTokenOverlayMergeSource, [
  /walletTokenOverlayMatchesPayloadCheckpoint\(payload,\s*overlay\)/,
  /checkpointComplete:\s*true/,
  /indexedThroughBlock:\s*overlay\.indexedThroughBlock/,
  /indexedThroughBlockHash:\s*overlay\.indexedThroughBlockHash/,
  /snapshotId:\s*overlay\.snapshotId/,
  /sourceHashes:\s*overlay\.sourceHashes/,
]);
expectAll("marketplace summary and tabs keep confirmed sealed inventory canonical", server + app, [
  /const MARKETPLACE_SUMMARY_FRESH_HARD_CAP_MS = Number\([\s\S]*12_000/,
  /const MARKETPLACE_SUMMARY_FRESH_WAIT_MS_UNCAPPED = Number\([\s\S]*const MARKETPLACE_SUMMARY_FRESH_WAIT_MS =[\s\S]*MARKETPLACE_SUMMARY_FRESH_HARD_CAP_MS > 0[\s\S]*MARKETPLACE_SUMMARY_FRESH_WAIT_MS_UNCAPPED/,
  /async function marketplaceSummaryFastFallbackPayload\(network\)[\s\S]*payloadWithFallbackAfterMs\([\s\S]*cachedMarketplaceSummaryPayloadNoRefresh/,
  /async function marketplaceSummaryPayloadWithIndexedMarketOverlay\([\s\S]*indexedTokenMarketSummaryOverlay\([\s\S]*compactTokenSummaryPayload\(tokenState\)/,
  /async function indexedTokenMarketSummaryOverlay\([\s\S]*tokenMarketLifecycleOverlayFromCreditListings\([\s\S]*proofIndexPayloadCoversConfirmedTip\(/,
  /function tokenMarketLifecycleOverlayFromCreditListings\([\s\S]*closedListings\.push\([\s\S]*sales\.push\(/,
  /async function indexedTokenMarketSummaryOverlay\([\s\S]*proofIndexCreditListingsPayload\(network,\s*tokenScope,\s*\{ limit: 5000 \}\)/,
  /const fast = options\.fast === true;[\s\S]*if \(fast\) \{[\s\S]*indexedTokenMarketSummaryOverlay\(network\)[\s\S]*return null;[\s\S]*tokenStateWithIndexedMarketSummaryOverlay\(/,
  /async function marketplaceSummaryWithCurrentBtcUsd\([\s\S]*workFloorWithCurrentBtcUsd\(/,
  /function tokenStateWithIndexedMarketSummaryOverlay\([\s\S]*overlay\.listings[\s\S]*tokenListingItemKey/,
  /async function workTokenStateForSummaryRead\([\s\S]*tokenPayloadForRead\([\s\S]*reconcileListingStatus:\s*fresh[\s\S]*reconcileSpendable:\s*fresh/,
  /async function tokenSummaryPayload\([\s\S]*summaryRecoveryAddresses\.length === 0 &&[\s\S]*scope !== WORK_TOKEN_ID/,
  /async function reconciledLivenetMarketplaceSummaryPayload\([\s\S]*workTokenStateForSummaryRead\([\s\S]*tokenStateWithPreservedListingRecords/,
  /const includeAllActiveListings = walletScopedSummary \|\| Boolean\(scope\)/,
  /openListings: mergedTokenSummaryMetric\([\s\S]*"openListings"[\s\S]*preserveExistingTokenMetrics/,
  /function workFloorWithIndexedMarketSummaryOverlay\([\s\S]*tokenSaleVolumeSats[\s\S]*marketplaceSaleVolumeSats/,
  /function marketplaceSummaryHasIndexedMarketOverlay\([\s\S]*proof-indexer-token-market-summary-overlay/,
  /function compactTokenSummaryPayload\([\s\S]*sealedActiveListingsByKey[\s\S]*closedTxid[\s\S]*activeListing\.sealTxid/,
  /function tokenSummaryListings\(items,\s*limit = SUMMARY_MARKET_LIMIT\)[\s\S]*tokenListingHasConfirmedSaleTicketSeal\(listing\)/,
  /const compactListings = tokenSummaryListings\(listings,\s*listingLimit\)[\s\S]*listings:\s*compactListings/,
  /const indexedAt = newerIso\(ledger\.generatedAt,\s*tokenState\?\.indexedAt\)/,
  /async function currentProofIndexMarketplaceSummaryFallbackPayload\([\s\S]*currentProofIndexSummarySnapshotFallbackPayload\([\s\S]*"marketplaceSummary"[\s\S]*"marketplace-summary"[\s\S]*workFloorWithSummaryMarketOverlay\([\s\S]*indexedPayload\.workFloor[\s\S]*marketplaceSummaryPayloadWithIndexedMarketOverlay/,
  /async function marketplaceSummaryFastFallbackPayload\([\s\S]*currentProofIndexMarketplaceSummaryFallbackPayload\(network,\s*false,\s*\{[\s\S]*fast:\s*true/,
  /if \(fresh\) \{[\s\S]*refreshMarketplaceSummaryPayloadCache\(network,\s*true\)[\s\S]*summaryPayloadHasFiniteNetworkValue\([\s\S]*"marketplaceSummary"[\s\S]*refreshed[\s\S]*return refreshed[\s\S]*throw freshDataUnavailableError\([\s\S]*"Fresh marketplace summary is unavailable\."/,
  /url\.pathname === "\/api\/v1\/marketplace-summary"[\s\S]*await marketplaceSummaryPayload\(network,\s*freshRead\)/,
  /const sealedListings = marketListings\.filter\(\s*tokenListingHasConfirmedSaleTicketSeal,\s*\)/,
  /const unsealedListings = marketListings\.filter\(\s*\(listing\) => !tokenListingHasConfirmedSaleTicketSeal\(listing\),\s*\)/,
  /tokenMarketHistoryRefreshNonce[\s\S]*fresh:\s*tokenMarketHistoryRefreshNonce > 0/,
]);
expect(
  "marketplace summary must not serve stale proof-index summary snapshots before reconciliation",
  !/proofIndexSnapshotPayload\(\s*network,\s*"marketplaceSummary"/.test(server),
);
expect(
  "summary proof-index snapshots use a dedicated lookback window",
  /const SUMMARY_SNAPSHOT_LOOKBACK_LIMIT = 5_000/.test(proofIndexReader),
);
expectAll("summary proof-index snapshots prefer latest summary scan rows before historical fallback", proofIndexSnapshotPayloadSource, [
  /FROM proof_indexer\.ledger_snapshots[\s\S]*WHERE network = \$1[\s\S]*payload \? 'summaryPayloads'[\s\S]*payload->'summaryPayloads' \? \$2[\s\S]*ORDER BY indexed_through_block DESC NULLS LAST,\s*generated_at DESC[\s\S]*LIMIT 1/,
  /if \(!snapshot\) \{[\s\S]*WITH recent AS \([\s\S]*FROM proof_indexer\.ledger_snapshots[\s\S]*ORDER BY generated_at DESC[\s\S]*LIMIT \$\{SUMMARY_SNAPSHOT_LOOKBACK_LIMIT\}[\s\S]*FROM recent[\s\S]*WHERE payload \? 'summaryPayloads'[\s\S]*AND payload->'summaryPayloads' \? \$2[\s\S]*ORDER BY generated_at DESC[\s\S]*LIMIT 1/,
]);
expectAll("generic payload snapshots select the latest matching payload without a finite lookback", ledgerSnapshotWithPayloadSource, [
  /FROM proof_indexer\.ledger_snapshots[\s\S]*WHERE network = \$1[\s\S]*AND payload \? \$2[\s\S]*ORDER BY generated_at DESC[\s\S]*LIMIT 1/,
]);
expect(
  "payload-bearing snapshot lookup must not hide old derived payloads behind a recent-row window",
  !/WITH recent AS|LEDGER_SNAPSHOT_PAYLOAD_LOOKBACK_LIMIT/.test(
    ledgerSnapshotWithPayloadSource,
  ),
);
expect(
  "summary proof-index snapshot age must be validated by API coverage, not DB wall-clock freshness",
  !/snapshotPayloadFresh/.test(proofIndexSnapshotPayloadSource),
);
expect(
  "summary proof-index snapshots must not be hidden by the generic recent window",
  !/LIMIT \$\{LEDGER_SNAPSHOT_RECENT_READ_LIMIT\}/.test(
    proofIndexSnapshotPayloadSource,
  ),
);
expectAll("summary proof-index reads reject stale snapshot ids", server, [
  /function payloadSnapshotMatchesLedger\(payload,\s*ledger\)[\s\S]*payloadSnapshotId\(payload\)[\s\S]*payloadSnapshotId\(ledger\)/,
  /async function currentProofIndexSummarySnapshotPayload\(\s*network,\s*key,\s*label,\s*options = \{\},\s*\)[\s\S]*existingCurrentCanonicalLedgerPayloadWithinMs\([\s\S]*`canonical snapshot check for \$\{label\}`[\s\S]*summaryKeyRequiresCanonicalLedger\(network,\s*key\)[\s\S]*options\.allowWithoutCanonicalLedger !== true[\s\S]*!payloadSnapshotMatchesLedger\(indexedPayload,\s*ledger\)/,
  /async function currentProofIndexSummarySnapshotFallbackPayload\([\s\S]*allowWithoutCanonicalLedger:\s*true[\s\S]*refreshCanonicalLedgerPayloadInBackground\(network,\s*true\)/,
  /async function currentProofIndexWorkFloorFallbackPayload\([\s\S]*currentProofIndexSummarySnapshotFallbackPayload\([\s\S]*"workSummary"[\s\S]*workFloorWithSummaryMarketOverlay\([\s\S]*currentProofIndexSummarySnapshotFallbackPayload\([\s\S]*"growthSummary"/,
  /url\.pathname === "\/api\/v1\/work-floor"[\s\S]*cachedWorkFloorPayload\(network,\s*true\)[\s\S]*cachedWorkFloorPayload\(network,\s*false\)/,
  /url\.pathname === "\/api\/v1\/work-summary"[\s\S]*currentProofIndexSummarySnapshotPayload\([\s\S]*"workSummary"[\s\S]*"work-summary"/,
  /url\.pathname === "\/api\/v1\/growth-summary"[\s\S]*currentProofIndexSummarySnapshotPayload\([\s\S]*"growthSummary"[\s\S]*"growth-summary"/,
  /async function cachedMarketplaceSummaryPayloadNoRefresh\(network\)[\s\S]*existingCanonicalLedgerPayload\(network\)[\s\S]*payloadSnapshotMatchesLedger\(cachedPayload,\s*ledger\)[\s\S]*payloadSnapshotMatchesLedger\(persistedPayload,\s*ledger\)/,
]);
expect(
  "work-floor route must stay mediated by the checked cached payload helper",
  !/currentProofIndexSummarySnapshotPayload/.test(workFloorRouteSource),
);
expect(
  "work-floor fallback must not use raw proof-index value summaries",
  !/async function currentProofIndexWorkFloorFallbackPayload\([\s\S]*proofIndexValueSummaryPayload/.test(server),
);
expectAll("legacy request fallback deltas keep nested WORK/Growth coverage aligned", server, [
  /function workFloorWithProofIndexEventDelta\([\s\S]*Number\(deltaPayload\.indexedThroughBlock\)[\s\S]*const coveredWorkFloor[\s\S]*if \(numericValue\(deltaPayload\?\.totalSats\) <= 0\) \{[\s\S]*return coveredWorkFloor/,
  /function growthSummaryWithProofIndexEventDelta\([\s\S]*const coveredWorkFloor[\s\S]*workFloorWithProofIndexEventDelta\(growthSummary\.workFloor,\s*deltaPayload\)[\s\S]*const coveredGrowthSummary[\s\S]*workFloor: coveredWorkFloor[\s\S]*return coveredWorkFloor[\s\S]*growthSummaryWithCanonicalWorkFloor\(coveredGrowthSummary,\s*coveredWorkFloor\)/,
  /async function proofIndexSummaryPayloadWithValueEventDelta\([\s\S]*key === "workSummary"[\s\S]*workFloorWithProofIndexEventDelta\(payload\.floor,\s*deltaPayload\)[\s\S]*key === "growthSummary"[\s\S]*growthSummaryWithProofIndexEventDelta\(payload,\s*deltaPayload\)[\s\S]*key === "marketplaceSummary"[\s\S]*workFloorWithProofIndexEventDelta\([\s\S]*payload\.workFloor/,
]);
expectAll("fresh token history can use checked proof-index snapshots", tokenHistoryRouteSource, [
  /const proofIndexTokenHistoryEligibility =[\s\S]*proofIndexTokenHistoryReadEligibility\(/,
  /const freshProofIndexTokenHistoryRead =[\s\S]*freshRead[\s\S]*!exactProofIndexHistoryRead[\s\S]*!proofIndexMintHistoryRead[\s\S]*proofIndexTokenHistoryEligibility\.eligible/,
  /\(!freshRead \|\|[\s\S]*exactProofIndexHistoryRead \|\|[\s\S]*proofIndexMintHistoryRead \|\|[\s\S]*freshProofIndexTokenHistoryRead\)/,
  /proofIndexPayloadCoversConfirmedTip\([\s\S]*responsePayload[\s\S]*`token-history:\$\{tokenScope \|\| "all"\}:\$\{historyKind\}`/,
  /freshProofIndexTokenHistoryRead[\s\S]*\? FRESH_READ_CACHE_CONTROL[\s\S]*: TOKEN_READ_CACHE_CONTROL/,
]);
expectAll("token history pages carry embedded payload coverage instead of outer snapshot height", proofIndexReader, [
  /function embeddedHistoryIndexedThroughBlock\([\s\S]*storedPayload\.indexedThroughBlock[\s\S]*storedPayload\.stats\?\.indexedThroughBlock[\s\S]*indexedThroughBlockFromItems\(storedPayload\.items\)/,
  /function historyPageFromStoredPayload\([\s\S]*indexedThroughBlockFromItems\(filtered\) \?\? 0[\s\S]*embeddedHistoryIndexedThroughBlock\(storedPayload\)/,
  /function tokenHistoryPageFromSnapshot\([\s\S]*indexedThroughBlockFromItems\(filtered\) \?\? 0[\s\S]*embeddedHistoryIndexedThroughBlock\(source\.payload\)/,
]);
expect(
  "outer ledger snapshot height must not be promoted into embedded token-history coverage",
  !/rowNumber\(snapshot,\s*"indexed_through_block"\)/.test(
    storedHistoryPageSource + snapshotTokenHistoryPageSource,
  ),
);
expect(
  "block-scan checkpoints must not relabel an older history payload as current",
  /void coverage;[\s\S]*return page/.test(tokenHistoryCoverageProjectionSource) &&
    !/indexedThroughBlock|mergedSourceLabel|proof-indexer-scan-coverage/.test(
      tokenHistoryCoverageProjectionSource,
    ),
);
expectAll("unpinned transfer history reads the current event and participant tables", proofIndexReader, [
  /async function currentTokenTransferHistoryPage\(/,
  /e\.valid = true/,
  /e\.kind = 'token-transfer'/,
  /COALESCE\(t\.status, e\.status\) IN \('confirmed', 'pending'\)/,
  /FROM proof_indexer\.event_participants epq[\s\S]*lower\(epq\.address\) LIKE/,
  /eligibility\.kind === "transfers"[\s\S]*!eligibility\.pagination\.snapshotId[\s\S]*return currentTokenTransferHistoryPage\(/,
]);
expectAll("exact WORK transfer reads recover when a requested tx is absent or incomplete", exactTransferRecoverySource, [
  /const txids = new Set\(recoveryTxidsFromSearchParams\(searchParams\)\)/,
  /const itemsByTxid = new Map\(/,
  /return \[\.\.\.txids\]\.some\(\(requestedTxid\) =>/,
  /const item = itemsByTxid\.get\(requestedTxid\)[\s\S]*if \(!item\) \{[\s\S]*return true/,
  /!isValidBitcoinAddress\(item\?\.senderAddress, network\)[\s\S]*!isValidBitcoinAddress\(item\?\.recipientAddress, network\)/,
]);
expectAll("targeted WORK participant repair fails closed on missing or unverifiable txids", repairWorkParticipantsSource, [
  /const explicit = REPAIR_WORK_PARTICIPANTS_TXIDS\.length > 0/,
  /const missingRequested = REPAIR_WORK_PARTICIPANTS_TXIDS\.filter\([\s\S]*!rowsByTxid\.has\(txid\)/,
  /if \(missingRequested\.length > 0\) \{[\s\S]*throw new Error\([\s\S]*confirmed valid event row is missing/,
  /const tx = await rawTransactionFromCore\(txid\)[\s\S]*Number\(tx\.confirmations\) <= 0[\s\S]*transaction is not confirmed in Bitcoin Core/,
  /await client\.query\("BEGIN"\)[\s\S]*await client\.query\("COMMIT"\)[\s\S]*await client\.query\("ROLLBACK"\)/,
  /if \(failures\.length > 0\) \{[\s\S]*throw new Error\([\s\S]*WORK participant repair failed/,
]);
expectAll("canonical replay preserves readable legacy pwid1:r registrations", proofIndexerBackfill, [
  /action === "r" \|\| action === "r2"[\s\S]*"id-register"/,
  /action === "r" \? parts\[2\] : decodeBase64UrlText\(parts\[2\]\)/,
  /if \(action === "r" \|\| action === "r2"\)[\s\S]*ownerAddress[\s\S]*receiveAddress/,
]);
expectAll("targeted canonical ID repair replaces aliases and rebuilds projections", canonicalIdRepairSource + proofIndexerBackfill, [
  /rawTransactionFromCore\(txid\)[\s\S]*Number\(raw\?\.confirmations\) <= 0/,
  /bitcoinRpc\("getblock", \[blockHash, 2\]\)[\s\S]*assertCanonicalBlockEnvelope/,
  /protocolMessagesFromTx\(hydrated\)\.filter\([\s\S]*message\?\.prefix === "pwid1:"/,
  /must include its registration transaction/,
  /DELETE FROM proof_indexer\.events[\s\S]*protocol = 'pwid1'/,
  /DELETE FROM proof_indexer\.id_records/,
  /preparedProtocolItemsForTx\([\s\S]*entry\?\.item\?\.valid === false/,
  /persistCanonicalRawTransaction\([\s\S]*persistPreparedProtocolItems/,
  /invalidEvents !== 0/,
  /--repair-id-txids requires POW_INDEX_REPAIR_ID_TXIDS/,
]);
expectAll("closed token listings preserve and repair canonical seal metadata", proofIndexerBackfill + proofIndexReader, [
  /seal_txid = COALESCE\(NULLIF\(EXCLUDED\.seal_txid, ''\), proof_indexer\.credit_listings\.seal_txid\)/,
  /payload = proof_indexer\.credit_listings\.payload \|\| EXCLUDED\.payload/,
  /async function repairConfirmedListingSealMetadata\([\s\S]*kind = 'token-listing-sealed'[\s\S]*UPDATE proof_indexer\.credit_listings[\s\S]*'sealConfirmed', true[\s\S]*'sealTxid', seals\.seal_txid/,
  /results\.push\(await repairConfirmedListingSealMetadata\(client\)\)/,
  /function tokenClosedListingFromEventPayload\(payload\)[\s\S]*payload\?\.closedAt[\s\S]*saleAuthorization: objectRecord\(payload\?\.saleAuthorization\)[\s\S]*sealConfirmed:[\s\S]*sealTxid:/,
  /const closedListings = uniqueTokenItems\([\s\S]*marketEvents\.closedListings[\s\S]*listingProjection\.closedListings[\s\S]*mergeTokenListingRecord/,
]);
expectAll("unpinned ID history reads current records and event projections", proofIndexReader, [
  /async function currentRegistryEventHistoryPage\(/,
  /e\.kind = ANY\(\$2::text\[\]\)/,
  /e\.valid = true/,
  /COALESCE\(t\.status, e\.status\) IN \('confirmed', 'pending'\)/,
  /FROM proof_indexer\.event_participants epq[\s\S]*lower\(epq\.address\) LIKE/,
  /async function currentRegistryRecordsHistoryPage\([\s\S]*confirmedIdRecordsFromCurrentTables\(/,
  /if \(!eligibility\.pagination\.snapshotId\)[\s\S]*currentRegistryRecordsHistoryPage\([\s\S]*currentRegistryEventHistoryPage\(/,
]);
expectAll("wallet token listing refresh preserves bounded spendable local pending marketplace rows", app, [
  /const TOKEN_LOCAL_PENDING_LISTING_TTL_MS = 30 \* 60_000/,
  /function tokenListingShouldSurviveRefresh\(listing:\s*PowTokenListing\)[\s\S]*tokenListingHasPendingSaleTicketSeal\(listing\)[\s\S]*tokenListingHasSpendableSaleTicketAnchor\(listing\)[\s\S]*TOKEN_LOCAL_PENDING_LISTING_TTL_MS/,
  /function tokenListingsWithPreservedLocalPending\([\s\S]*tokenListingShouldSurviveRefresh\(listing\)[\s\S]*mergeTokenListingsById\(incoming,\s*preserved\)/,
  /function replaceTokenListingsForOwnerScope\([\s\S]*tokenListingShouldSurviveRefresh\(listing\)/,
  /function applyTokenState\([\s\S]*preserveListings = true[\s\S]*tokenListingsWithPreservedLocalPending\([\s\S]*current\.listings[\s\S]*applyPendingTokenListingSeals\(state\.listings\)[\s\S]*state\.closedListings[\s\S]*setTokenListings\(accepted\.listings\)/,
]);
expectAll("current ledger reads reject non-OK summary snapshot fallback rows", server + proofIndexerBackfill, [
  /status:\s*"summary-snapshot-fallback"/,
  /ok:\s*false/,
  /function ledgerPayloadHasCurrentChecks\(payload\)[\s\S]*payload\?\.consistency\?\.status !== "summary-snapshot-fallback"[\s\S]*checkNames\.has\("ledger-covers-node-tip"\)/,
]);
expectAll("DB mail reads use indexed address matching and self-send folders", proofIndexReader, [
  /function addressMailRowPayloads\(row,\s*address,\s*network\)/,
  /WITH candidate_events AS \([\s\S]*proof_indexer\.event_participants ep[\s\S]*ep\.address = ANY\(\$2::text\[\]\)/,
  /LEFT JOIN proof_indexer\.transactions t[\s\S]*AND t\.txid = e\.txid/,
  /WHEN 'confirmed' = ANY\(ARRAY\[e\.status,\s*m\.status,\s*t\.status\]\) THEN 'confirmed'/,
  /const targetIsRecipient =[\s\S]*\["recipient",\s*"receiver",\s*"counterparty"\]/,
  /if \(actorKey && actorKey === targetKey\)[\s\S]*folder: "sent"/,
  /deliveryStatus !== "dropped"[\s\S]*\(!actorKey \|\| actorKey !== targetKey \|\| targetIsRecipient\)[\s\S]*folder: "inbox"/,
]);
expectAll("local self-send broadcasts appear in Incoming immediately", app, [
  /function samePaymentAddress\(left:\s*string,\s*right:\s*string\)/,
  /const selfRecipient = mailRecipients\.find\([\s\S]*samePaymentAddress\(mailRecipient\.address,\s*address\)/,
  /const selfIncomingMessage: InboxMessage \| undefined = selfRecipient/,
  /setInbox\(\(current\) => \[/,
]);
expectAll("proof index deploy flags keep mailbox DB reads enabled", proofIndexDeploy, [
  /POW_INDEX_READS=[^\n]*event-history/,
  /POW_INDEX_READS=[^\n]*address-mail/,
  /POW_INDEX_TOKEN_HISTORY_MAX_AGE_MS=86400000/,
]);

expectAll("registry default reads use proof index with canonical fallback", server, [
  /proofIndexRegistryPayload/,
  /function duplicateRegistryRecordIds\(payload\)[\s\S]*duplicates\.add\(id\)/,
  /function registryIndexedPayloadRejectReason\(payload,\s*previousPayload\s*=\s*null\)[\s\S]*duplicateRegistryRecordIds\(payload\)[\s\S]*stale indexedAt[\s\S]*registryPayloadLooksWorse/,
  /async function indexedRegistryPayload\(network,\s*options\s*=\s*\{\}\)[\s\S]*proofIndexReadFeatureEnabled\([\s\S]*registry-history[\s\S]*proofIndexRegistryPayload\(network,\s*\{[\s\S]*allowIncompleteScan:\s*true[\s\S]*expectedHash:\s*exactHash[\s\S]*expectedHeight:\s*exactHeight[\s\S]*registryAddress/,
  /async function indexedRegistryPayload\(network,\s*options\s*=\s*\{\}\)[\s\S]*records:[\s\S]*sort\(compareRegistryRecordDisplayOrder\)[\s\S]*registryIndexedPayloadRejectReason\(orderedPayload\)[\s\S]*exactCheckpointMatches[\s\S]*Rejected proof-index registry payload/,
  /async function safeRegistryPayload\(network\)[\s\S]*registryConfirmedCount\(nextPayload\) <= 0[\s\S]*Current livenet registry is unavailable/,
  /async function registrySummaryPayload\(network,\s*fresh\s*=\s*false\)[\s\S]*await indexedRegistryPayload\(network\)[\s\S]*fastJsonBackedPayload/,
  /url\.pathname === "\/api\/v1\/registry" \|\| url\.pathname === "\/api\/v1\/ids"[\s\S]*const indexedPayload = await indexedRegistryPayload\(network\)[\s\S]*if \(indexedPayload\)/,
]);
expectAll("current ID tables must agree with canonical registration events", proofIndexReader, [
  /const registeredEventIds = new Set\([\s\S]*item\?\.confirmed === true[\s\S]*"id-register"/,
  /const missingRelationalIds = \[\.\.\.registeredEventIds\][\s\S]*!confirmedIds\.has\(id\)/,
  /const orphanRelationalIds = \[\.\.\.confirmedIds\][\s\S]*!registeredEventIds\.has\(id\)/,
  /missingRelationalIds\.length > 0 \|\| orphanRelationalIds\.length > 0[\s\S]*return null/,
]);
expectAll("checkpoint registry reads are exact and default reads stay complete-only", proofIndexReader, [
  /async function currentProofIndexRegistryPayload\(pool,\s*network,\s*options\s*=\s*\{\}\)/,
  /expectedCheckpointOptionPresent[\s\S]*exactCheckpointRequested[\s\S]*allowIncompleteExactCheckpoint/,
  /scanPayload\.complete !== true && !allowIncompleteExactCheckpoint/,
  /scanIndexedThroughBlock !== expectedHeight[\s\S]*scanBlockHash !== expectedHash/,
]);
expect(
  "canonical proof-index registry reads can correct a stale higher cached count",
  /registryIndexedPayloadRejectReason\(orderedPayload\)/.test(
    indexedRegistryPayloadSource,
  ) && !/existingRegistryPayload/.test(indexedRegistryPayloadSource),
);

expectAll("exact ID availability requires healthy confirmed and pending coverage", currentIdCoverageSource + livePendingRegistrySource, [
  /proofIndexOperationalStatusPayload\(network\)/,
  /healthNodeTipHeight\(\)/,
  /livePendingRegistryPayload\(network\)/,
  /scan\?\.scan\?\.complete === true/,
  /Boolean\(String\(scan\?\.scan\?\.blockHash \?\? ""\)\)/,
  /indexedThroughBlock === tipHeight/,
  /scan\?\.worker\?\.ok === true/,
  /workerFresh/,
  /Number\(scan\?\.readModels\?\.confirmedIds\?\.count\) > 0/,
  /No healthy first-party pending registry reader is available/,
  /error\.statusCode = 503[\s\S]*code: "ID_AVAILABILITY_UNPROVEN"/,
]);
expectAll("exact ID route fails closed before declaring a name available", exactIdRouteSource, [
  /try \{[\s\S]*proofIndexIdRecordPayload\(network, id\)[\s\S]*catch \(error\)[\s\S]*unavailable\.statusCode = 503/,
  /const requireCurrent =[\s\S]*const currentProof = requireCurrent[\s\S]*await proveCurrentIdAbsence\(network\)/,
  /if \(!records\.some\(\(record\) => record\.confirmed === true\)\) \{[\s\S]*currentProof \?\? \(await proveCurrentIdAbsence\(network\)\)[\s\S]*livePendingRecords/,
  /status: confirmed \? "confirmed" : pending \? "pending" : "available"/,
]);

expectAll("ID registration performs a fresh exact preflight", fetchIdRecordStateSource + registerIdSource, [
  /new URLSearchParams\(\{ current: "1", fresh: "1" \}\)/,
  /\/api\/v1\/ids\/\$\{encodeURIComponent\(normalizedId\)\}\?\$\{params\.toString\(\)\}/,
  /const latestState = await fetchIdRecordState\(network,\s*normalizedIdName\)/,
]);
expectAll("ID owner and sale actions require current exact coverage", fetchIdRecordStateSource + broadcastIdMutationSource + idSalePreflightSource, [
  /new URLSearchParams\(\{ current: "1", fresh: "1" \}\)/,
  /fetchIdRecordState\(network,\s*id\)/,
  /fetchIdRecordState\(network,\s*managedIdRecord\.id\)/,
]);
expectAll("ID launch does not declare cache misses available", idLaunchAppSource, [
  /needs a live check/,
  /Submit to verify the exact ID against current chain coverage before signing/,
  /Verify and register for 1,000 proofs/,
]);
expect(
  "ID launch must not show a cache-derived open claim",
  !/\$\{normalizedId\}@proofofwork\.me is open|Claimable now/.test(idLaunchAppSource),
);

expectAll("WORK floor USD uses live price metadata", server, [
  /function satsToUsdAtBtcUsd\(sats,\s*btcUsd\)/,
  /function btcUsdResponseMetadata\(quote\)/,
  /btcUsdPricePayload\(network,\s*\{\s*fresh\s*\}\)/,
  /async function workSummaryWithCurrentBtcUsd\([\s\S]*floor: await workFloorWithCurrentBtcUsd\([\s\S]*scopedPayload\.floor,[\s\S]*network,[\s\S]*fresh/,
  /url\.pathname === "\/api\/v1\/work-summary"[\s\S]*await workSummaryWithCurrentBtcUsd\([\s\S]*workFloorWithSummaryMarketOverlay\([\s\S]*indexedPayload\.floor/,
  /url\.pathname === "\/api\/v1\/growth-summary"[\s\S]*await growthSummaryWithCurrentBtcUsd\([\s\S]*indexedPayload[\s\S]*network[\s\S]*false/,
  /modelTotalUsd/,
  /totalUsd:\s*liveTotalUsd/,
  /btcUsdIndexedAt/,
  /usdSource/,
]);

expectAll("consistency endpoint guards the public invariant", server, [
  /function ledgerSnapshotChecks\(/,
  /"livenet-confirmed-history-present"/,
  /"token-definitions-cover-confirmed-mints"/,
  /"token-components-cover-confirmed-activity"/,
  /"inception-live-issuance-matches-incb-supply"/,
  /"infinity-bond-flow-matches-powb-supply"/,
  /"work-floor-actual-total"/,
  /"growth-actual-total"/,
  /"growth-work-floor-total"/,
  /"marketplace-mutation-fees-counted"/,
  /"marketplace-value-includes-mutation-fees"/,
  /"computer-event-flow-excludes-marketplace"/,
  /"token-events-logged"/,
  /"token-sales-logged"/,
  /"seeded-mail-events-logged"/,
  /"seeded-inception-bonds-logged"/,
  /"seeded-infinity-bonds-logged"/,
  /"ledger-covers-node-tip"/,
  /async function ledgerConsistencyPayload\(network,\s*fresh\s*=\s*false\)/,
  /url\.pathname === "\/api\/v1\/consistency"/,
  /url\.pathname === "\/api\/v1\/ledger-consistency"/,
]);

expectAll("seeded mail coverage guards confirmed Computer message value", server, [
  /async function buildSeededMailActivityPayload[\s\S]*return await fetchAddressTransactions\(address,\s*network\);[\s\S]*fetchAddressTransactionsViaMempoolPagination\(/,
  /const seededConfirmedMail = \(seededMailActivityState\?\.activity \?\? \[\]\)\.filter/,
  /missingSeededMailEvents\.push\(missing\)/,
  /missingSeededInceptionBondEvents\.push\(missing\)/,
  /missingSeededInfinityBondEvents\.push\(missing\)/,
  /loggedInceptionBondFlowSats >= seededInceptionBondFlowSats/,
  /loggedInfinityBondFlowSats >= seededInfinityBondFlowSats/,
]);

expectAll("token sales must be searchable in Log by txid and participants", server, [
  /participants:\s*\[\s*sale\.buyerAddress,\s*sale\.sellerAddress,\s*sale\.registryAddress,\s*\]/,
  /kind:\s*"token-sale"/,
  /tokenId:\s*sale\.tokenId/,
  /tokenStateLogExpectations\(tokenState\)/,
  /missingTokenLogEvents\.push\(missing\)/,
]);

expectAll("token market history reads merge direct DB event overlays", server, [
  /proofIndexTokenMarketHistoryOverlayPayload/,
  /async function tokenHistoryPayload[\s\S]*if \(workMarketHistoryKind && network === "livenet"\)[\s\S]*proofIndexTokenMarketHistoryOverlayPayload\(/,
  /mergeTokenHistoryPageWithOverlay\(page,\s*overlayPage,\s*pagination\)/,
]);

expectAll("proof index token history merges market event rows", proofIndexReader, [
  /export async function proofIndexTokenMarketHistoryOverlayPayload/,
  /e\.kind = ANY\(\$2::text\[\]\)/,
  /tokenHistoryItemFromMarketEventPayload/,
  /mergeTokenHistoryPages\(\s*snapshotPage,\s*marketOverlayPage/,
]);

expectAll("log history searches fall back to direct DB event rows", proofIndexReader, [
  /logHistoryPageFromSnapshot/,
  /requestedKind \|\| pagination\.query/,
  /lower\(e\.payload::text\) LIKE/,
  /source:\s*"proof-indexer"/,
]);
const publicLogKinds = /const PUBLIC_LOG_EVENT_KINDS = new Set\(\[([\s\S]*?)\]\);/u.exec(
  proofIndexReader,
)?.[1] ?? "";
expect(
  "public Log must exclude invalid protocol attempts",
  !/"token-event-invalid"/u.test(publicLogKinds),
);
expectAll("public Log SQL counts valid confirmed or pending actions only", proofIndexReader, [
  /const conditions = \[[\s\S]*"e\.valid = true"[\s\S]*"e\.status IN \('confirmed', 'pending'\)"[\s\S]*"e\.kind = ANY\(\$2::text\[\]\)"/,
  /export async function proofIndexCanonicalActivityPayload\(\s*network,\s*options = \{\},?\s*\)[\s\S]*AND e\.valid = true[\s\S]*AND e\.status IN \('confirmed', 'pending'\)[\s\S]*AND e\.kind = ANY\(\$2::text\[\]\)/,
]);
expectAll("canonical ledger can read direct proof-index event rows", proofIndexReader, [
  /export async function proofIndexCanonicalActivityPayload\(\s*network,\s*options = \{\},?\s*\)/,
  /FROM proof_indexer\.events e/,
  /normalizeHistoryEventRows\(result\.rows,\s*network\)/,
  /source:\s*"proof-indexer-events"/,
]);
expectAll("bond-family mail normalization spans DB reads", proofIndexReader, [
  /const INFINITY_BOND_MEMO = "powb"/,
  /const INCEPTION_BOND_MEMO = "incb"/,
  /const BOND_TAGS = \[/,
  /function bondTagForEventPayload\(payload,\s*row = \{\}\)/,
  /function normalizeEventPayload\(payload,\s*row = \{\}\)/,
  /function normalizeHistoryEventItem\(item,\s*network,\s*\{ publicOnly = false \} = \{\}\)/,
  /function normalizeHistoryEventRows\(rows,\s*network,\s*options = \{\}\)/,
  /function eventKindSqlCondition\(kind,\s*addValue\)/,
  /normalizeHistoryEventItem\(normalizeEventPayload\(item\),\s*network,\s*\{/,
  /filters\.push\(eventKindSqlCondition\(kind,\s*addValue\)\)/,
  /items: normalizeHistoryEventRows\(rowsResult\.rows,\s*network/,
]);
expectAll("Infinity and Inception recipient-credit markets are wired", server + app + routeRegistry, [
  /const POWB_TOKEN_TICKER = "POWB"/,
  /const POWB_REGISTRY_ID = "infinity@proofofwork.me"/,
  /const INCB_TOKEN_TICKER = "INCB"/,
  /const INCB_REGISTRY_ID = "inception@proofofwork.me"/,
  /const BOND_TOKEN_CONFIGS = \[INFINITY_BOND_CONFIG, INCEPTION_BOND_CONFIG\]/,
  /function tokenPayloadHasKnownMainnetHistory[\s\S]*hasCanonicalEmptyDefinition[\s\S]*INCB_TOKEN_ID/,
  /function bondRecipientMintsFromActivityItem\(item,\s*network,\s*config\)/,
  /function infinityBondChartPointsFromEvents\(/,
  /const chartPoints = infinityBondChartPointsFromEvents\([\s\S]*config/,
  /const confirmedBondActions = confirmedActivity\.filter\([\s\S]*isBondActivityItem\(item,\s*config\)/,
  /const bondMintFlowSats = confirmedBondActions\.reduce\([\s\S]*activityAmountSats\(item\)/,
  /async function bondSummaryFromCanonicalLedger\([\s\S]*bondSummaryPayloadFromLedger\(\{[\s\S]*btcUsdQuote,[\s\S]*\},\s*config\)/,
  /async function bondSummaryPayload\(network,\s*fresh\s*=\s*false,\s*config\)[\s\S]*summaryCanonicalLedgerPayload\(network,\s*fresh\)[\s\S]*bondSummaryFromCanonicalLedger\(\s*ledger,\s*network,\s*fresh,\s*config,?\s*\)[\s\S]*config\.displayName/,
  /item\.recipients[\s\S]*recipient\.amountSats[\s\S]*recipient\.address/,
  /minterAddress:\s*recipientMint\.minterAddress/,
  /url\.pathname === "\/api\/v1\/infinity-summary"/,
  /url\.pathname === "\/api\/v1\/inception-summary"/,
  /function isInfinityRoute\(\)/,
  /function isInceptionRoute\(\)/,
  /function InfinityApp\(/,
  /embedded\?:\s*boolean/,
  /activeFolder === "infinity"/,
  /activeFolder === "inception"/,
  /openFolder\("infinity"\)/,
  /openFolder\("inception"\)/,
  /refreshInfinity\(false,\s*true,\s*activeBondConfig\)/,
  /function InfinityBondChart\(/,
  /function InfinityBondMarketPanel\(/,
  /\{bondConfig\.ticker\} Sale Tickets/,
  /\{bondConfig\.ticker\} Sales & Listings Log/,
  /fetchBondSummary\(config,\s*fresh\)/,
  /submitBond=\{createInfinityBond\}/,
  /address:\s*resolvedRecipient\.paymentAddress/,
  /minterAddress:\s*mailRecipient\.address/,
]);
expectAll("Inception issuance is fixed from the exact green H-1 WORK snapshot", server, [
  /"canonical-pre-bond-live-network-value-v2"/,
  /"canonical-summary-h-minus-one-v1"/,
  /function canonicalInceptionValueSnapshotCheckpoint\(/,
  /async function canonicalInceptionIssuanceOptions\(/,
  /function inceptionIssuanceCheckpoint\(/,
  /issuanceCheckpointMode:\s*"bond-transaction-provenance"/,
  /issuanceCheckpointBlockHeight/,
  /issuanceCheckpointBlockHash/,
  /issuanceCheckpointBlockIndex/,
  /issuanceValueSnapshotId/,
  /issuanceValueSnapshotBlockHeight/,
  /issuanceValueSnapshotBlockHash/,
  /issuanceValueSnapshotCanonicalSummaryHash/,
  /issuanceValueSnapshotWorkNetworkValueSats/,
  /attachedWorkLiveFloorAtSendSats/,
  /attachedWorkLiveValueAtSendSats/,
  /issuanceValuationFixedAtSend:\s*true/,
]);
expectAll(
  "INCB index repair is exact, transactional, scoped, and pre-bond pinned",
  proofIndexerBackfill + proofIndexReader,
  [
    /--repair-incb-issuance/,
    /dd743fb69c519200cc190627219ba34ca2e63e6893e600b73e9aee8d4dac8fa4/,
    /000000000000000000016ea78b0d57a7979de3542518c8690a1e5a808e691cc5/,
    /recipientAddress:\s*"1BPVvi1GK4QkfqFMU4jHGjsQjyGwjJJJ7x"/,
    /recipientVout:\s*0/,
    /workAttachmentAmount:\s*3_644_060/,
    /workAttachmentProtocolVout:\s*3/,
    /confirmedIssuanceUnits:\s*1_421_799_461/,
    /issuanceValueSnapshotId:\s*"b8e77cd30cbed6855977c514"/,
    /issuanceValueSnapshotCanonicalSummaryHash:[\s\S]*"4f00b3494afb46ef88990948784a0ba8f2a22856615a39e15c3131f0ec979bdc"/,
    /issuanceValueSnapshotWorkNetworkValueSats:[\s\S]*8_193_547_095\.322113/,
    /async function canonicalIncbIssuanceRepairTarget\(/,
    /async function repairCanonicalIncbIssuance\(/,
    /await client\.query\("BEGIN"\)/,
    /LOCK TABLE proof_indexer\.ledger_snapshots IN SHARE ROW EXCLUSIVE MODE/,
    /UPDATE proof_indexer\.events[\s\S]*attachedWorkLiveValueAtConfirmationSats[\s\S]*issuanceCheckpointWorkNetworkValueSats[\s\S]*\|\| \$5::jsonb/,
    /rebuildConfirmedCreditBalancesFromCanonicalEvents\([\s\S]*supplyCorrectionMode:\s*"canonical-incb-issuance-repair"[\s\S]*supplyCorrectionTokenIds:\s*\[INCB_TOKEN_ID\][\s\S]*tokenIds:\s*\[INCB_TOKEN_ID\]/,
    /finalBlockHash[\s\S]*bitcoinRpc\("getblockhash",\s*\[target\.height\]\)[\s\S]*finalBlock[\s\S]*bitcoinRpc\("getblock",\s*\[finalBlockHash,\s*1\]\)[\s\S]*finalTxids\[target\.blockIndex\]/,
    /finalRaw[\s\S]*bitcoinRpc\("getrawtransaction",\s*\[[\s\S]*target\.txid[\s\S]*true/,
    /canonicalBlockScanSnapshotPredicate[\s\S]*NOT COALESCE\(source_hashes \? 'canonicalSummary', false\)[\s\S]*COALESCE\(source_hashes \? 'blockScan', false\)[\s\S]*payload->>'source' = 'proof-indexer-block-scan'/,
    /DELETE FROM proof_indexer\.ledger_snapshots[\s\S]*AND NOT \(\$\{canonicalBlockScanSnapshotPredicate\}\)[\s\S]*snapshot_id = ANY\(\$2::text\[\]\)/,
    /await client\.query\("ROLLBACK"\)/,
    /function incbIssuanceMetadataFault\(/,
    /function assertCanonicalIncbCurrentProjection\(/,
    /issuanceValuationFixedAtSend/,
  ],
);
const canonicalIncbRepairSource = sourceSliceBetween(
  proofIndexerBackfill,
  /async function repairCanonicalIncbIssuance\(/,
  /async function canonicalIdRepairTarget\(/,
);
expect(
  "INCB repair must not delete pure block-scan checkpoints wholesale",
  !/DELETE FROM proof_indexer\.ledger_snapshots WHERE network = \$1/.test(
    canonicalIncbRepairSource,
  ),
);
expect(
  "bond apps must use the dedicated parameterized market panel",
  /<InfinityBondMarketPanel/.test(infinityAppSource) &&
    !/<TokenMarketplacePanel/.test(infinityAppSource),
);
expectAll("Growth surfaces both bond families as first-class product lanes", app, [
  /\|\s*"infinity-bond"/,
  /\|\s*"inception-bond"/,
  /infinityBondFlowSats:\s*number/,
  /infinityBondSats:\s*number/,
  /infinityBondActions:\s*number/,
  /inceptionBondFlowSats:\s*number/,
  /inceptionBondSats:\s*number/,
  /inceptionBondActions:\s*number/,
  /function isInfinityBondActivityItem\(item:\s*PowActivityItem\)/,
  /function isInceptionBondActivityItem\(item:\s*PowActivityItem\)/,
  /confirmedValueTokenMints = confirmedTokenMints\.filter\([\s\S]*!BOND_TOKEN_IDS\.has\(mint\.tokenId\)/,
  /const infinityBondFlowSats = confirmedActivity[\s\S]*\.filter\(isInfinityBondActivityItem\)/,
  /const inceptionBondFlowSats = confirmedActivity[\s\S]*\.filter\(isInceptionBondActivityItem\)/,
  /const infinityBondSats =[\s\S]*infinityBondFlowSats \* GROWTH_MODEL_INPUTS\.valueMultiple/,
  /const inceptionBondSats =[\s\S]*inceptionBondFlowSats \* GROWTH_MODEL_INPUTS\.valueMultiple/,
  /infinityBondSats \+/,
  /inceptionBondSats \+/,
  /infinityBondActions =[\s\S]*confirmedActivity\.filter\(isInfinityBondActivityItem\)\.length/,
  /inceptionBondActions =[\s\S]*confirmedActivity\.filter\(isInceptionBondActivityItem\)\.length/,
]);
expect(
  "Growth product cards include Infinity/POWB and Inception/INCB bond value",
  /name="Infinity"/.test(growthWorkspaceSource) &&
    /InfinityIcon/.test(growthWorkspaceSource) &&
    /actualValue\.infinityBondSats/.test(growthWorkspaceSource) &&
    /actualValue\.infinityBondFlowSats/.test(growthWorkspaceSource) &&
    /name="Inception"/.test(growthWorkspaceSource) &&
    /actualValue\.inceptionBondSats/.test(growthWorkspaceSource) &&
    /actualValue\.inceptionBondFlowSats/.test(growthWorkspaceSource) &&
    /bond actions/.test(growthWorkspaceSource),
);
expectAll("backfill writes both mail bond families as projections", proofIndexerBackfill, [
  /const INFINITY_BOND_MEMO = "powb"/,
  /const INCEPTION_BOND_MEMO = "incb"/,
  /const BOND_TAGS = \[/,
  /function bondTagForItem\(item,\s*kind = rawEventKind\(item\)\)/,
  /return bondTagForItem\(item,\s*kind\)\?\.kind \?\? kind/,
  /stableEventKeyKind\(item,\s*kind,\s*sourceLabel\)/,
  /Boolean\(bondTagForKind\(projectionKind\)\)/,
  /mailItemBodyText\(item\)/,
]);

expectAll("all confirmed token state rows must be searchable in Log", server, [
  /function tokenStateLogExpectations\(tokenState\)/,
  /function activityCoverageByTxidKind\(activity\)/,
  /kind:\s*"token-transfer"/,
  /kind:\s*"token-listing-sealed"/,
  /activityByTxidKind\.get\(\s*`\$\{expected\.kind\}:\$\{expected\.txid\}`/,
  /"token-events-logged"/,
]);

expectAll("marketplace mutation fees are first-class network value", server, [
  /const MARKETPLACE_MUTATION_KINDS = new Set/,
  /MARKETPLACE_MUTATION_KINDS\.has\(item\.kind\)/,
  /const marketplaceFlowSats =\s*marketplaceSaleVolumeSats \+ marketplaceMutationFeeSats/,
  /marketplaceFlowSats \* GROWTH_MODEL_INPUTS\.valueMultiple/,
  /"marketplace-mutation-fees-counted"/,
  /"marketplace-value-includes-mutation-fees"/,
]);

expectAll("confirmed token protocol failures stay diagnosable", server, [
  /invalidEvents:\s*\[\]/,
  /reason:\s*"no-valid-token-event"/,
  /reasonCode:\s*"insufficient-spendable-balance"/,
  /availableAmount:\s*spendableBalance/,
  /function insufficientTokenBalanceInvalidEvent\([\s\S]*attemptedAmount:\s*amount/,
  /auditMinerFeeSats:\s*minerFeeSats/,
  /auditRegistryPaymentSats:\s*originalRegistrySats/,
  /auditTotalCostSats:\s*minerFeeSats \+ originalRegistrySats/,
  /\["invalid-events",\s*"invalidEvents"\]/,
  /invalidTokenEvents:\s*confirmedItemCount\(tokenState\?\.invalidEvents\)/,
]);
expectAll("invalid credit costs stay audit-only", proofIndexReader, [
  /function tokenInvalidAuditCosts\([\s\S]*auditMinerFeeSats[\s\S]*auditRegistryPaymentSats[\s\S]*auditTotalCostSats/,
  /function canonicalRawTransactionMinerFeeSats\([\s\S]*canonicalBlockScan[\s\S]*valueSats[\s\S]*100_000_000/,
  /function eventRowPayload\([\s\S]*invalidTokenEvent[\s\S]*amountSats:\s*0[\s\S]*minerFeeSats:\s*0[\s\S]*registryMutationFeeSats:\s*0/,
  /function tokenInvalidEventFromRow\([\s\S]*amountSats:\s*0[\s\S]*auditCosts[\s\S]*minerFeeSats:\s*0[\s\S]*registryMutationFeeSats:\s*0/,
]);

expectAll("WORK fresh replay favors correctness over recent-page luck", server, [
  /WORK_TOKEN_CANONICAL_FRESH_WAIT_MS/,
  /WORK_TOKEN_LIVE_HISTORY_MAX_TXS[\s\S]*WORK_TOKEN_LIVE_DELTA_MAX_TXS/,
  /scope === WORK_TOKEN_ID[\s\S]*WORK_TOKEN_CANONICAL_FRESH_WAIT_MS[\s\S]*WORK_FLOOR_FRESH_WAIT_MS/,
]);

expectAll("endpoint caches cannot bypass the ledger", server, [
  /jsonResponse\(\s*response,\s*200,\s*await mergedLogActivityPayload\(network\)/,
  /summaryPayloadWithCanonicalProvenance\(\s*await growthSummaryPayload\(network,\s*freshRead\)/,
  /attachLedgerMetadata\(\s*\{[\s\S]*ledgerTokenStateForScope\(ledger,\s*scope\)[\s\S]*indexedAt:\s*ledger\.generatedAt[\s\S]*\},\s*ledger,?\s*\)/,
  /return payload\.snapshotId[\s\S]*\.\.\.page[\s\S]*ledgerGeneratedAt:\s*payload\.ledgerGeneratedAt[\s\S]*snapshotId:\s*payload\.snapshotId/,
]);

expectAll("fresh reads do not rebuild the ledger in a tight loop", server, [
  /ledgerPayloadAgeMs\(cached\.payload,\s*now\)\s*<\s*LEDGER_FRESH_MIN_INTERVAL_MS/,
  /if \(url\.pathname === "\/api\/v1\/activity" \|\| url\.pathname === "\/api\/v1\/log"\)[\s\S]*if \(freshRead\)[\s\S]*await freshProofIndexLogPayload\(network\)/,
]);

expect(
  "growth-summary route no longer uses its old per-endpoint JSON cache",
  !/cachedJsonResponse\(\s*response,\s*`growth-summary:\$\{network\}`/.test(
    server,
  ),
);

expect(
  "activity route no longer uses its old per-endpoint JSON cache for normal reads",
  !/cachedJsonResponse\(\s*response,\s*`activity:\$\{network\}`/.test(server),
);

expectAll("frontend log search keeps server-backed tx and participant search", app, [
  /participants\?:\s*string\[\]/,
  /tokenId\?:\s*string/,
  /fetchGlobalActivityHistoryPage\(network,\s*\{[\s\S]*query/,
  /Log search found/,
]);

expect(
  "package exposes this live-data regression contract",
  /"check:live-data":\s*"node scripts\/check-live-data-contract\.mjs"/.test(
    packageJson,
  ),
);
expect(
  "package exposes credit mint regression checks",
  /"check:credit-mint-regressions":\s*"node scripts\/check-credit-mint-regressions\.mjs"/.test(
    packageJson,
  ),
);

if (failures.length) {
  console.error("Live data contract failed:");
  for (const failure of failures) {
    console.error(`- ${failure}`);
  }
  process.exit(1);
}

console.log("Live data contract passed.");
