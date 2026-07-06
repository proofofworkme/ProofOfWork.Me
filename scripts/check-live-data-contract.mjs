import { readFileSync } from "node:fs";

const server = readFileSync("server/proof-api.mjs", "utf8");
const proofIndexReader = readFileSync("server/db/proof-index-reader.mjs", "utf8");
const proofIndexerBackfill = readFileSync("scripts/backfill-proof-indexer.mjs", "utf8");
const app = readFileSync("src/App.tsx", "utf8");
const routeRegistry = readFileSync("src/app/routeRegistry.ts", "utf8");
const proofIndexDeploy = readFileSync("deploy/proofofwork-api-proof-index.conf", "utf8");
const packageJson = readFileSync("package.json", "utf8");
const failures = [];

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

expectAll("Log summary preserves full activity stats before compaction", compactActivitySummarySource, [
  /const activity = Array\.isArray\(payload\?\.activity\) \? payload\.activity : \[\]/,
  /activityStatsFromItems\(activity,\s*payload\?\.stats \?\? \{\}\)/,
  /activity:\s*recentByCreatedAt\(activity,\s*SUMMARY_ACTIVITY_LIMIT\)/,
  /stats,/,
]);

expectAll("canonical ledger builder owns shared state", server, [
  /async function buildCanonicalLedgerPayload\(network,\s*fresh\s*=\s*false\)/,
  /activityStateForCanonicalLedger\(network,\s*fresh\)/,
  /const valueTokenState = tokenStateWithScopedTokenOverride\(/,
  /let ledgerTokenState = valueTokenState/,
  /powbMintsFromActivity\(baseActivity,\s*powbRegistryAddress,\s*network\)/,
  /tokenStateWithScopedTokenOverride\([\s\S]*POWB_TOKEN_ID/,
  /const seededMailActivityState = activityStateIsProofIndexCanonical\(activityState\)[\s\S]*seededMailActivityPayloadFromIndexedActivity\([\s\S]*seededMailActivityPayload\(network,\s*seedAddresses\)/,
  /\.\.\.\(Array\.isArray\(seededMailActivityState\?\.activity\)/,
  /tokenActivityItemsFromState\(\s*ledgerTokenState/,
  /workFloorPayloadFromState\(/,
  /growthSummaryPayloadFromLedger\(/,
  /infinitySummaryPayloadFromLedger\(/,
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
  /const selectedRemoteHolderPage =[\s\S]*historyPageToPagedItems\([\s\S]*activeRemoteHolderPage/,
  /const detailRemoteHolderPage =[\s\S]*historyPageToPagedItems\([\s\S]*activeRemoteHolderPage/,
  /renderHolderList = \([\s\S]*loadingRemotePage = false/,
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

expectAll("server POWB activity rejects stale proof-index seed data", server, [
  /const POWB_ACTIVITY_FRESH_WAIT_MS = Number\(/,
  /async function indexedPowbActivityForTokenState\(network\)[\s\S]*indexedThroughBlock[\s\S]*stats:\s*{[\s\S]*indexedThroughBlock/,
  /async function powbActivityForTokenState\(network,[\s\S]*proofIndexPayloadCoversConfirmedTip\([\s\S]*"powb-activity"[\s\S]*payloadWithFallbackAfterMs\([\s\S]*globalActivityPayload\(network,\s*true\)/,
]);

expectAll("server POWB listings recover confirmed Infinity Bond parent mints", server, [
  /async function powbSeedMintsWithSaleTicketParents\([\s\S]*fetchTransactionWithSourceFallback\(parentTxid,\s*network\)[\s\S]*mailActivityItemFromTransaction\(parentTx,\s*network\)[\s\S]*isInfinityBondActivityItem\(activityItem\)/,
  /const seedMints = await powbSeedMintsWithSaleTicketParents\([\s\S]*powbSeed\.seedMints[\s\S]*registryTxs[\s\S]*POWB_TOKEN_ID[\s\S]*seedMints/,
  /function powbRegistryAddressFromTokenTransactions\(txs,\s*network\)[\s\S]*tokenPaymentAmountBeforeProtocol\(vout,\s*registryAddress\)/,
  /async function recoveredPowbTokenPayloadFromTransactions\(network,\s*recoveryTxs\)[\s\S]*powbRegistryAddressFromTokenTransactions\(confirmedTxs,\s*network\)[\s\S]*powbSeedMintsWithSaleTicketParents\([\s\S]*first-party-powb-txid-recovery/,
  /scope === POWB_TOKEN_ID &&[\s\S]*recoveryTxids\.length > 0[\s\S]*recoveredPowbTokenPayloadFromTransactions\(/,
]);

expectAll("server POWB fresh scoped reads do not return stale cached fallback", server, [
  /const scopedRefreshWaitMs = Number\.isFinite\(options\.scopedRefreshWaitMs\)[\s\S]*scope === POWB_TOKEN_ID[\s\S]*WORK_TOKEN_CANONICAL_FRESH_WAIT_MS/,
  /fallback &&[\s\S]*scope !== POWB_TOKEN_ID[\s\S]*scoped-token-fallback/,
]);

expectAll("server token reads preserve canonical ledger rows when table state regresses", server, [
  /function tokenPayloadWithCanonicalHistoryFloor\(canonicalPayload,\s*payload\)[\s\S]*confirmedSupplyRegressed[\s\S]*holdersRegressed[\s\S]*mergeCanonicalHistoryItems/,
  /function mergeTokenPayloadWithCanonicalFloor\(canonicalPayload,\s*payload,\s*scope\)[\s\S]*const canonicalScopedPayload = scopedTokenPayloadFromState[\s\S]*const scopedState = tokenPayloadWithCanonicalHistoryFloor/,
  /async function indexedTokenPayloadFreshnessFloor\(network,\s*scope,\s*options = \{\}\)[\s\S]*tokenPayloadWithCanonicalLedgerFloor\([\s\S]*`token-state fresh-floor:\$\{scope \|\| "all"\}`/,
  /const flooredScopedPayload =[\s\S]*tokenPayloadWithCanonicalLedgerFloor\([\s\S]*`scoped-token:\$\{scope\}`[\s\S]*tokenPayloadReadResult\(\s*flooredScopedPayload/,
  /payload = await tokenPayloadWithCanonicalLedgerFloor\([\s\S]*`token-payload:\$\{scope \|\| "all"\}`/,
]);

expectAll("server fresh token reads fall back to valid cached snapshots", server, [
  /async function cachedTokenPayloadFallbackForRead\([\s\S]*cachedTokenPayloadSnapshotNoRefresh\(network,\s*scope\)[\s\S]*rejectEmptyMainnetTokenPayload\(network,\s*payload,\s*scope,\s*label\)[\s\S]*existingCurrentCanonicalLedgerPayloadWithinMs\([\s\S]*existingCanonicalLedgerPayload\(network\)[\s\S]*ledgerPayloadForFreshnessCompare\(ledger,\s*scope\)[\s\S]*refreshTokenPayloadCacheInBackground\(network,\s*scope\)/,
  /async function tokenSummaryPayload\([\s\S]*"token-summary-fresh-memory"[\s\S]*cachedTokenPayloadFallbackForRead\([\s\S]*"token-summary-fresh-cache"[\s\S]*Fresh credit summary is still catching up/,
  /url\.pathname === "\/api\/v1\/token"[\s\S]*"token-state-fresh-memory"[\s\S]*cachedTokenPayloadFallbackForRead\([\s\S]*"token-state-fresh-cache"[\s\S]*Fresh credit state is still catching up/,
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
  /async function addressUtxoPayload\(address,\s*network\)[\s\S]*for \(const base of firstPartyAddressReadBases\(network\)\)/,
]);
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
  /knownMailAddress\(payload\.actor\) \|\| knownMailAddress\(rawPayload\.actor\)/,
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
  /closedListings: recentClosedTokenListings\([\s\S]*closedListingLimit/,
  /function tokenStateWithPreservedListingRecords\(state,\s*sourceState\)[\s\S]*const preservedClosedListingIds = new Set\([\s\S]*sourceState\?\.closedListings[\s\S]*if \(!preservedClosedListingIds\.has\(listingId\)\)/,
  /async function tokenPayloadWithIndexedWalletOverlay\([\s\S]*proofIndexWalletTokenOverlayPayload\([\s\S]*mergeTokenStateItemsByKey\([\s\S]*transfers/,
  /async function walletScopedTokenPayload\([\s\S]*currentProofIndexTokenPayloadForRead\([\s\S]*tokenPayloadScopedToAddresses[\s\S]*tokenPayloadWithIndexedWalletOverlay[\s\S]*tokenPayloadWithIndexedWalletClosedListings/,
  /async function walletScopedTokenSummaryPayload\([\s\S]*currentProofIndexTokenPayloadForRead\([\s\S]*tokenPayloadScopedToAddresses[\s\S]*tokenPayloadWithIndexedWalletOverlay/,
  /async function indexedWalletClosedListings\([\s\S]*kind: "token-closed-listings"[\s\S]*proofIndexEventHistoryPayload/,
  /async function tokenPayloadWithIndexedWalletClosedListings\([\s\S]*tokenStateWithPreservedListingRecords/,
  /url\.pathname === "\/api\/v1\/token"[\s\S]*if \(walletScoped\) \{[\s\S]*walletScopedTokenPayload/,
  /url\.pathname === "\/api\/v1\/token-summary"[\s\S]*const walletScoped =[\s\S]*walletScopedTokenSummaryPayload/,
]);
expectAll("proof index wallet token overlay reads balances and events", proofIndexReader, [
  /export async function proofIndexWalletTokenOverlayPayload\(/,
  /proof_indexer\.credit_balances cb/,
  /e\.kind IN \([\s\S]*'token-transfer'[\s\S]*'token-sale'[\s\S]*'token-listing'[\s\S]*'token-listing-closed'[\s\S]*\)/,
  /export async function proofIndexTokenMarketSummaryOverlayPayload\(/,
  /e\.kind = ANY\(\$2::text\[\]\)/,
  /"proof-indexer-token-market-summary-overlay"/,
]);
expectAll("marketplace summary and tabs keep confirmed sealed inventory canonical", server + app, [
  /const MARKETPLACE_SUMMARY_FRESH_HARD_CAP_MS = Number\([\s\S]*12_000/,
  /const MARKETPLACE_SUMMARY_FRESH_WAIT_MS_UNCAPPED = Number\([\s\S]*const MARKETPLACE_SUMMARY_FRESH_WAIT_MS =[\s\S]*MARKETPLACE_SUMMARY_FRESH_HARD_CAP_MS > 0[\s\S]*MARKETPLACE_SUMMARY_FRESH_WAIT_MS_UNCAPPED/,
  /async function marketplaceSummaryFastFallbackPayload\(network\)[\s\S]*payloadWithFallbackAfterMs\([\s\S]*cachedMarketplaceSummaryPayloadNoRefresh/,
  /async function marketplaceSummaryPayloadWithIndexedMarketOverlay\([\s\S]*indexedTokenMarketSummaryOverlay\([\s\S]*compactTokenSummaryPayload\(tokenState\)/,
  /async function marketplaceSummaryWithCurrentBtcUsd\([\s\S]*workFloorWithCurrentBtcUsd\(/,
  /function tokenStateWithIndexedMarketSummaryOverlay\([\s\S]*overlay\.listings[\s\S]*tokenListingItemKey/,
  /async function workTokenStateForSummaryRead\([\s\S]*tokenPayloadForRead\([\s\S]*reconcileListingStatus:\s*fresh[\s\S]*reconcileSpendable:\s*fresh/,
  /async function tokenSummaryPayload\([\s\S]*summaryRecoveryAddresses\.length === 0 &&[\s\S]*scope !== WORK_TOKEN_ID/,
  /async function reconciledLivenetMarketplaceSummaryPayload\([\s\S]*workTokenStateForSummaryRead\([\s\S]*tokenStateWithPreservedListingRecords/,
  /const includeAllActiveListings = walletScopedSummary \|\| Boolean\(scope\)/,
  /openListings: mergedTokenSummaryMetric\([\s\S]*"openListings"[\s\S]*false/,
  /function workFloorWithIndexedMarketSummaryOverlay\([\s\S]*tokenSaleVolumeSats[\s\S]*marketplaceSaleVolumeSats/,
  /function marketplaceSummaryHasIndexedMarketOverlay\([\s\S]*proof-indexer-token-market-summary-overlay/,
  /function compactTokenSummaryPayload\([\s\S]*sealedActiveListingsByKey[\s\S]*closedTxid[\s\S]*activeListing\.sealTxid/,
  /function tokenSummaryListings\(items,\s*limit = SUMMARY_MARKET_LIMIT\)[\s\S]*tokenListingHasConfirmedSaleTicketSeal\(listing\)/,
  /listings:\s*tokenSummaryListings\(listings,\s*listingLimit\)/,
  /const indexedAt = newerIso\(ledger\.generatedAt,\s*tokenState\?\.indexedAt\)/,
  /async function currentProofIndexMarketplaceSummaryFallbackPayload\([\s\S]*currentProofIndexSummarySnapshotFallbackPayload\([\s\S]*"marketplaceSummary"[\s\S]*"marketplace-summary"[\s\S]*workFloorWithSummaryMarketOverlay\([\s\S]*indexedPayload\.workFloor[\s\S]*marketplaceSummaryPayloadWithIndexedMarketOverlay/,
  /async function marketplaceSummaryFastFallbackPayload\([\s\S]*currentProofIndexMarketplaceSummaryFallbackPayload\(network,\s*false,\s*\{[\s\S]*fast:\s*true/,
  /if \(fresh\) \{[\s\S]*const fallback = await payloadWithFallbackAfterMs\([\s\S]*marketplaceSummaryFastFallbackPayload\(network\)[\s\S]*refreshMarketplaceSummaryPayloadCache\(network,\s*true\)[\s\S]*summaryPayloadHasFiniteNetworkValue\([\s\S]*"marketplaceSummary"[\s\S]*refreshed[\s\S]*return refreshed[\s\S]*summaryPayloadHasFiniteNetworkValue\([\s\S]*"marketplaceSummary"[\s\S]*fallback[\s\S]*return fallback/,
  /url\.pathname === "\/api\/v1\/marketplace-summary"[\s\S]*await marketplaceSummaryPayload\(network,\s*freshRead\)/,
  /const sealedListings = marketListings\.filter\(\s*tokenListingHasConfirmedSaleTicketSeal,\s*\)/,
  /const unsealedListings = marketListings\.filter\(\s*\(listing\) => !tokenListingHasConfirmedSaleTicketSeal\(listing\),\s*\)/,
]);
expect(
  "marketplace summary must not serve stale proof-index summary snapshots before reconciliation",
  !/proofIndexSnapshotPayload\(\s*network,\s*"marketplaceSummary"/.test(server),
);
expect(
  "summary proof-index snapshots use a dedicated lookback window",
  /const SUMMARY_SNAPSHOT_LOOKBACK_LIMIT = 5_000/.test(proofIndexReader),
);
expect(
  "payload-bearing proof-index snapshots use a dedicated lookback window",
  /const LEDGER_SNAPSHOT_PAYLOAD_LOOKBACK_LIMIT = 5_000/.test(proofIndexReader),
);
expectAll("summary proof-index snapshots are selected from the dedicated lookback", proofIndexSnapshotPayloadSource, [
  /WITH recent AS \([\s\S]*FROM proof_indexer\.ledger_snapshots[\s\S]*WHERE network = \$1[\s\S]*ORDER BY generated_at DESC[\s\S]*LIMIT \$\{SUMMARY_SNAPSHOT_LOOKBACK_LIMIT\}/,
  /FROM recent[\s\S]*WHERE payload \? 'summaryPayloads'[\s\S]*AND payload->'summaryPayloads' \? \$2[\s\S]*ORDER BY generated_at DESC[\s\S]*LIMIT 1/,
]);
expectAll("generic payload snapshots are selected from the dedicated payload lookback", ledgerSnapshotWithPayloadSource, [
  /WITH recent AS \([\s\S]*FROM proof_indexer\.ledger_snapshots[\s\S]*WHERE network = \$1[\s\S]*ORDER BY generated_at DESC[\s\S]*LIMIT \$\{LEDGER_SNAPSHOT_PAYLOAD_LOOKBACK_LIMIT\}/,
  /FROM recent[\s\S]*WHERE payload \? \$2[\s\S]*ORDER BY generated_at DESC[\s\S]*LIMIT 1/,
]);
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
expectAll("summary value-event deltas carry scan coverage into nested WORK/Growth payloads", server, [
  /function workFloorWithProofIndexEventDelta\([\s\S]*Number\(deltaPayload\.indexedThroughBlock\)[\s\S]*const coveredWorkFloor[\s\S]*if \(numericValue\(deltaPayload\?\.totalSats\) <= 0\) \{[\s\S]*return coveredWorkFloor/,
  /function growthSummaryWithProofIndexEventDelta\([\s\S]*Number\(deltaPayload\.indexedThroughBlock\)[\s\S]*const coveredGrowthSummary[\s\S]*if \(numericValue\(deltaPayload\?\.totalSats\) <= 0\) \{[\s\S]*return coveredGrowthSummary/,
  /async function proofIndexSummaryPayloadWithValueEventDelta\([\s\S]*key === "workSummary"[\s\S]*workFloorWithProofIndexEventDelta\(payload\.floor,\s*deltaPayload\)[\s\S]*key === "growthSummary"[\s\S]*growthSummaryWithProofIndexEventDelta\(payload,\s*deltaPayload\)[\s\S]*key === "marketplaceSummary"[\s\S]*workFloorWithProofIndexEventDelta\([\s\S]*payload\.workFloor/,
]);
expectAll("fresh token history can use checked proof-index snapshots", tokenHistoryRouteSource, [
  /const proofIndexTokenHistoryEligibility =[\s\S]*proofIndexTokenHistoryReadEligibility\(/,
  /const freshProofIndexTokenHistoryRead =[\s\S]*freshRead[\s\S]*!exactProofIndexHistoryRead[\s\S]*!proofIndexMintHistoryRead[\s\S]*proofIndexTokenHistoryEligibility\.eligible/,
  /\(!freshRead \|\|[\s\S]*exactProofIndexHistoryRead \|\|[\s\S]*proofIndexMintHistoryRead \|\|[\s\S]*freshProofIndexTokenHistoryRead\)/,
  /proofIndexPayloadCoversConfirmedTip\([\s\S]*responsePayload[\s\S]*`token-history:\$\{tokenScope \|\| "all"\}:\$\{historyKind\}`/,
  /freshProofIndexTokenHistoryRead[\s\S]*\? FRESH_READ_CACHE_CONTROL[\s\S]*: TOKEN_READ_CACHE_CONTROL/,
]);
expectAll("token history pages carry snapshot scan coverage", proofIndexReader, [
  /function historyPageFromStoredPayload\([\s\S]*Math\.max\([\s\S]*indexedThroughBlockFromItems\(filtered\) \?\? 0[\s\S]*rowNumber\(snapshot,\s*"indexed_through_block"\) \?\? 0/,
  /function tokenHistoryPageFromSnapshot\([\s\S]*Math\.max\([\s\S]*indexedThroughBlockFromItems\(filtered\) \?\? 0[\s\S]*rowNumber\(snapshot,\s*"indexed_through_block"\) \?\? 0/,
]);
expectAll("token history freshness uses current scan coverage only when no newer relevant events exist", proofIndexReader, [
  /function tokenHistoryFreshnessEventKinds\([\s\S]*safeKind === "tokens"[\s\S]*"token-create"[\s\S]*safeKind === "holders"[\s\S]*"token-mint"[\s\S]*"token-transfer"[\s\S]*"token-sale"/,
  /async function tokenHistoryScanCoverageAfterSnapshot\([\s\S]*ORDER BY indexed_through_block DESC NULLS LAST,\s*generated_at DESC[\s\S]*e\.block_height > \$2[\s\S]*e\.kind = ANY\(\$3::text\[\]\)/,
  /function tokenHistoryPageWithScanCoverage\([\s\S]*coverage\.eventCount > 0[\s\S]*proof-indexer-scan-coverage/,
  /export async function proofIndexTokenHistoryPayload\([\s\S]*tokenHistoryPageWithScanCoverage\([\s\S]*tokenHistoryScanCoverageAfterSnapshot\(/,
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
  /async function indexedRegistryPayload\(network\)[\s\S]*proofIndexReadFeatureEnabled\([\s\S]*registry-history[\s\S]*proofIndexRegistryPayload\(network,\s*\{ registryAddress \}\)/,
  /async function indexedRegistryPayload\(network\)[\s\S]*registryIndexedPayloadRejectReason\([\s\S]*Rejected proof-index registry payload/,
  /async function safeRegistryPayload\(network\)[\s\S]*registryConfirmedCount\(nextPayload\) <= 0[\s\S]*Current livenet registry is unavailable/,
  /async function registrySummaryPayload\(network,\s*fresh\s*=\s*false\)[\s\S]*await indexedRegistryPayload\(network\)[\s\S]*fastJsonBackedPayload/,
  /url\.pathname === "\/api\/v1\/registry" \|\| url\.pathname === "\/api\/v1\/ids"[\s\S]*const indexedPayload = await indexedRegistryPayload\(network\)[\s\S]*if \(indexedPayload\)/,
]);

expectAll("WORK floor USD uses live price metadata", server, [
  /function satsToUsdAtBtcUsd\(sats,\s*btcUsd\)/,
  /function btcUsdResponseMetadata\(quote\)/,
  /btcUsdPricePayload\(network,\s*\{\s*fresh\s*\}\)/,
  /async function workSummaryWithCurrentBtcUsd\([\s\S]*floor: await workFloorWithCurrentBtcUsd\(payload\.floor,\s*network,\s*fresh\)/,
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
  /"work-floor-actual-total"/,
  /"growth-actual-total"/,
  /"growth-work-floor-total"/,
  /"marketplace-mutation-fees-counted"/,
  /"marketplace-value-includes-mutation-fees"/,
  /"computer-event-flow-excludes-marketplace"/,
  /"token-events-logged"/,
  /"token-sales-logged"/,
  /"seeded-mail-events-logged"/,
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
  /missingSeededInfinityBondEvents\.push\(missing\)/,
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
expectAll("canonical ledger can read direct proof-index event rows", proofIndexReader, [
  /export async function proofIndexCanonicalActivityPayload\(network\)/,
  /FROM proof_indexer\.events e/,
  /normalizeHistoryEventRows\(result\.rows,\s*network\)/,
  /source:\s*"proof-indexer-events"/,
]);
expectAll("Infinity Bond mail normalization spans DB reads", proofIndexReader, [
  /const INFINITY_BOND_MEMO = "powb"/,
  /function isInfinityBondEventPayload\(payload,\s*row = \{\}\)/,
  /function normalizeEventPayload\(payload,\s*row = \{\}\)/,
  /function normalizeHistoryEventItem\(item,\s*network,\s*\{ publicOnly = false \} = \{\}\)/,
  /function normalizeHistoryEventRows\(rows,\s*network,\s*options = \{\}\)/,
  /function eventKindSqlCondition\(kind,\s*addValue\)/,
  /normalizeHistoryEventItem\(normalizeEventPayload\(item\),\s*network,\s*\{/,
  /filters\.push\(eventKindSqlCondition\(kind,\s*addValue\)\)/,
  /items: normalizeHistoryEventRows\(rowsResult\.rows,\s*network/,
]);
expectAll("Infinity Bond POWB recipient-credit market is wired", server + app + routeRegistry, [
  /const POWB_TOKEN_TICKER = "POWB"/,
  /const POWB_REGISTRY_ID = "infinity@proofofwork.me"/,
  /function powbRecipientMintsFromActivityItem\(item,\s*network\)/,
  /function infinityBondChartPointsFromEvents\(/,
  /const chartPoints = infinityBondChartPointsFromEvents\(/,
  /async function infinitySummaryFromCanonicalLedger\(ledger,\s*network,\s*fresh\s*=\s*false\)/,
  /infinitySummaryPayloadFromLedger\(\{\s*\.\.\.ledger,[\s\S]*btcUsdQuote,[\s\S]*\}\)/,
  /async function infinitySummaryPayload\(network,\s*fresh\s*=\s*false\)[\s\S]*summaryCanonicalLedgerPayload\(network,\s*fresh\)[\s\S]*infinitySummaryFromCanonicalLedger\(ledger,\s*network,\s*fresh\)[\s\S]*Current Infinity summary ledger is unavailable/,
  /item\.recipients[\s\S]*recipient\.amountSats[\s\S]*recipient\.address/,
  /minterAddress:\s*recipientMint\.minterAddress/,
  /url\.pathname === "\/api\/v1\/infinity-summary"/,
  /function isInfinityRoute\(\)/,
  /function InfinityApp\(/,
  /embedded\?:\s*boolean/,
  /activeFolder === "infinity"/,
  /openFolder\("infinity"\)/,
  /refreshInfinity\(false,\s*true\)/,
  /function InfinityBondChart\(/,
  /function InfinityBondMarketPanel\(/,
  /POWB Sale Tickets/,
  /POWB Sales & Listings Log/,
  /fetchInfinitySummary\(fresh\)/,
  /submitBond=\{createInfinityBond\}/,
  /address:\s*resolvedRecipient\.paymentAddress/,
  /minterAddress:\s*mailRecipient\.address/,
]);
expect(
  "Infinity app must use the POWB-only market panel",
  /<InfinityBondMarketPanel/.test(infinityAppSource) &&
    !/<TokenMarketplacePanel/.test(infinityAppSource),
);
expectAll("Growth surfaces Infinity Bond value as a first-class product lane", app, [
  /\|\s*"infinity-bond"/,
  /infinityBondFlowSats:\s*number/,
  /infinityBondSats:\s*number/,
  /infinityBondActions:\s*number/,
  /function isInfinityBondActivityItem\(item:\s*PowActivityItem\)/,
  /confirmedValueTokenMints = confirmedTokenMints\.filter\([\s\S]*mint\.tokenId !== POWB_TOKEN_ID/,
  /const infinityBondFlowSats = confirmedActivity[\s\S]*\.filter\(isInfinityBondActivityItem\)/,
  /const infinityBondSats =[\s\S]*infinityBondFlowSats \* GROWTH_MODEL_INPUTS\.valueMultiple/,
  /infinityBondSats \+/,
  /infinityBondActions =[\s\S]*confirmedActivity\.filter\(isInfinityBondActivityItem\)\.length/,
]);
expect(
  "Growth product cards include Infinity/POWB bond value",
  /name="Infinity"/.test(growthWorkspaceSource) &&
    /InfinityIcon/.test(growthWorkspaceSource) &&
    /actualValue\.infinityBondSats/.test(growthWorkspaceSource) &&
    /actualValue\.infinityBondFlowSats/.test(growthWorkspaceSource) &&
    /bond actions/.test(growthWorkspaceSource),
);
expectAll("backfill writes powb mail as Infinity Bond projections", proofIndexerBackfill, [
  /const INFINITY_BOND_MEMO = "powb"/,
  /function isInfinityBondItem\(item,\s*kind = rawEventKind\(item\)\)/,
  /return isInfinityBondItem\(item,\s*kind\) \? INFINITY_BOND_KIND : kind/,
  /stableEventKeyKind\(item,\s*kind,\s*sourceLabel\)/,
  /\["mail",\s*"reply",\s*"file",\s*"attachment",\s*"browser",\s*INFINITY_BOND_KIND\]\.includes/,
  /mailItemBodyText\(item\)/,
]);

expectAll("all confirmed token state rows must be searchable in Log", server, [
  /function tokenStateLogExpectations\(tokenState\)/,
  /kind:\s*"token-transfer"/,
  /kind:\s*"token-listing-sealed"/,
  /activityByTxidKind\.get\(`\$\{expected\.kind\}:\$\{expected\.txid\}`\)/,
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
  /reason:\s*"no-valid-work-token-event"/,
  /\["invalid-events",\s*"invalidEvents"\]/,
  /invalidTokenEvents:\s*confirmedItemCount\(tokenState\?\.invalidEvents\)/,
]);

expectAll("WORK fresh replay favors correctness over recent-page luck", server, [
  /WORK_TOKEN_CANONICAL_FRESH_WAIT_MS/,
  /WORK_TOKEN_LIVE_HISTORY_MAX_TXS[\s\S]*WORK_TOKEN_LIVE_DELTA_MAX_TXS/,
  /scope === WORK_TOKEN_ID[\s\S]*WORK_TOKEN_CANONICAL_FRESH_WAIT_MS[\s\S]*WORK_FLOOR_FRESH_WAIT_MS/,
]);

expectAll("endpoint caches cannot bypass the ledger", server, [
  /jsonResponse\(\s*response,\s*200,\s*await mergedLogActivityPayload\(network\)/,
  /jsonResponse\(\s*response,\s*200,\s*await growthSummaryPayload\(network,\s*freshRead\)/,
  /attachLedgerMetadata\(\s*\{[\s\S]*ledgerTokenStateForScope\(ledger,\s*scope\)[\s\S]*indexedAt:\s*ledger\.generatedAt[\s\S]*\},\s*ledger,?\s*\)/,
  /return payload\.snapshotId[\s\S]*\.\.\.page[\s\S]*ledgerGeneratedAt:\s*payload\.ledgerGeneratedAt[\s\S]*snapshotId:\s*payload\.snapshotId/,
]);

expectAll("fresh reads do not rebuild the ledger in a tight loop", server, [
  /ledgerPayloadAgeMs\(cached\.payload,\s*now\)\s*<\s*LEDGER_FRESH_MIN_INTERVAL_MS/,
  /if \(url\.pathname === "\/api\/v1\/activity" \|\| url\.pathname === "\/api\/v1\/log"\)[\s\S]*await mergedLogActivityPayload\(network,\s*true\)/,
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
