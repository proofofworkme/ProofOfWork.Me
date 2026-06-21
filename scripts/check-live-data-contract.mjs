import { readFileSync } from "node:fs";

const server = readFileSync("server/proof-api.mjs", "utf8");
const proofIndexReader = readFileSync("server/db/proof-index-reader.mjs", "utf8");
const proofIndexerBackfill = readFileSync("scripts/backfill-proof-indexer.mjs", "utf8");
const app = readFileSync("src/App.tsx", "utf8");
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

expectAll("canonical ledger builder owns shared state", server, [
  /async function buildCanonicalLedgerPayload\(network,\s*fresh\s*=\s*false\)/,
  /const valueTokenState = tokenStateWithScopedTokenOverride\(/,
  /const seededMailActivityState = await seededMailActivityPayload\(/,
  /\.\.\.\(Array\.isArray\(seededMailActivityState\?\.activity\)/,
  /tokenActivityItemsFromState\(\s*valueTokenState/,
  /workFloorPayloadFromState\(/,
  /growthSummaryPayloadFromLedger\(/,
  /ledgerSnapshotChecks\(/,
  /snapshotId/,
]);

expectAll("canonical ledger directly merges seeded Computer mail", server, [
  /function canonicalMailSeedAddresses\(/,
  /function addTokenStateActivityAddresses\(/,
  /async function seededMailActivityPayload\(/,
  /async function buildSeededMailActivityPayload\(/,
  /seededMailActivityState/,
  /sourceCollectionFingerprint\(seededMailActivityState\?\.activity\)/,
]);

expectAll("WORK Growth Log and token views use the same ledger", server, [
  /async function canonicalLedgerPayload\(network,\s*fresh\s*=\s*false\)/,
  /async function summaryCanonicalLedgerPayload\(network,\s*fresh\s*=\s*false\)[\s\S]*existingCanonicalLedgerPayload\(network\)[\s\S]*refreshCanonicalLedgerPayloadInBackground\(network,\s*true\)/,
  /async function activityPayloadWithLiveWorkTokenOverlay\(ledger,\s*fresh\s*=\s*false\)[\s\S]*liveWorkTokenStateWithFallbackAfterMs\([\s\S]*tokenActivityItemsFromState\(/,
  /async function mergedLogActivityPayload\(network,\s*fresh\s*=\s*false\)[\s\S]*summaryCanonicalLedgerPayload\(network,\s*fresh\)[\s\S]*activityPayloadWithLiveWorkTokenOverlay\(ledger,\s*fresh\)[\s\S]*canonicalLedgerPayload\(network,\s*false\)/,
  /async function cachedWorkFloorPayload\(network,\s*fresh\s*=\s*false\)[\s\S]*summaryCanonicalLedgerPayload\(network,\s*true\)[\s\S]*existingCanonicalLedgerPayload\(network\)[\s\S]*workFloorWithCurrentBtcUsd\(ledger\.workFloor,\s*network,\s*fresh\)/,
  /async function growthSummaryPayload\(network,\s*fresh\s*=\s*false\)[\s\S]*summaryCanonicalLedgerPayload\(network,\s*fresh\)[\s\S]*growthSummaryWithCurrentBtcUsd\(ledger\.growthSummary,\s*network,\s*fresh\)[\s\S]*canonicalLedgerPayload\(network,\s*false\)\)\.growthSummary/,
  /async function tokenPayloadForRead[\s\S]*summaryCanonicalLedgerPayload\(network,\s*true\)[\s\S]*existingCanonicalLedgerPayload\(network\)[\s\S]*ledgerTokenStateForScope\(ledger,\s*scope\)/,
  /function liveWorkReadWaitMs\(options[\s\S]*Number\.isFinite\(options\.liveWorkWaitMs\)[\s\S]*liveWorkTokenStateWithFallbackAfterMs\([\s\S]*liveWorkReadWaitMs\(options\)/,
  /async function tokenSummaryPayload[\s\S]*let payload = await tokenPayloadForRead\(network,\s*scope,\s*fresh/,
  /async function tokenHistoryPayload[\s\S]*let payload = await tokenPayloadForRead\(network,\s*scope,\s*fresh/,
  /url\.pathname === "\/api\/v1\/token"[\s\S]*const tokenFreshRead[\s\S]*const payload = await tokenPayloadForRead\(network,\s*tokenScope,\s*tokenFreshRead/,
]);

expectAll("searched WORK balance history uses exact recovery inputs", server, [
  /function recoveryAddressesFromSearchParams\(searchParams,\s*network\)[\s\S]*for \(const key of \["q",\s*"search"\]\)/,
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

expectAll("Desktop public search stays on first-party ProofOfWork API", app, [
  /function DesktopApp\([\s\S]*<DesktopWorkspace[\s\S]*onSearch=\{onSearch\}/,
]);
expectAll("Desktop address mail read stays first-party", fetchAddressMailSource, [
  /async function fetchAddressMail\(\s*targetAddress:\s*string,\s*targetNetwork:\s*BitcoinNetwork,\s*\)/,
  /fetchProofApiJson<[\s\S]*`\/api\/v1\/address\/\$\{encodeURIComponent\(targetAddress\)\}\/mail`/,
]);
expectAll("Desktop search loader uses address mail read", loadDesktopTargetSource, [
  /async function loadDesktopTarget\(target = desktopQuery\)/,
  /fetchAddressMail\(resolved\.paymentAddress,\s*network\)/,
]);
expect("Desktop public search must keep fetchAddressMail source present", Boolean(fetchAddressMailSource));
expect("Desktop public search must keep loadDesktopTarget source present", Boolean(loadDesktopTargetSource));
expect("Desktop public app source must stay present", Boolean(desktopAppSource));
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
  /function mailPayloadHasMessages\(payload\)/,
  /async function mailPayload\(address,\s*network,\s*options = \{\}\)[\s\S]*const indexedPayload = await indexedMailPayload\(address,\s*network\)[\s\S]*if \(!fresh && indexedPayload && mailPayloadHasMessages\(indexedPayload\)\) \{[\s\S]*return indexedPayload/,
  /async function mailPayload\(address,\s*network,\s*options = \{\}\)[\s\S]*const indexedWasEmpty = Boolean\(indexedPayload\) && !mailPayloadHasMessages\(indexedPayload\)[\s\S]*includeExternal:\s*indexedWasEmpty \|\| fresh \|\| !indexedPayload[\s\S]*preferExternal:\s*indexedWasEmpty/,
  /async function mailPayload\(address,\s*network,\s*options = \{\}\)[\s\S]*mergeMailPayloads\(indexedPayload,\s*scannedPayload\)/,
  /mailPayload\(address,\s*network,\s*\{ fresh: freshRead \}\)/,
  /async function addressUtxoPayload\(address,\s*network\)[\s\S]*for \(const base of firstPartyAddressReadBases\(network\)\)/,
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
  /async function walletScopedTokenPayload\([\s\S]*proofIndexTokenPayload\([\s\S]*tokenPayloadScopedToAddresses[\s\S]*tokenPayloadWithIndexedWalletClosedListings/,
  /async function walletScopedTokenSummaryPayload\([\s\S]*proofIndexTokenPayload\([\s\S]*tokenPayloadScopedToAddresses/,
  /async function indexedWalletClosedListings\([\s\S]*kind: "token-closed-listings"[\s\S]*proofIndexEventHistoryPayload/,
  /async function tokenPayloadWithIndexedWalletClosedListings\([\s\S]*tokenStateWithPreservedListingRecords/,
  /url\.pathname === "\/api\/v1\/token"[\s\S]*if \(walletScoped\) \{[\s\S]*walletScopedTokenPayload/,
  /url\.pathname === "\/api\/v1\/token-summary"[\s\S]*const walletScoped =[\s\S]*walletScopedTokenSummaryPayload/,
]);
expectAll("DB mail reads use indexed address matching and self-send folders", proofIndexReader, [
  /function addressMailRowPayloads\(row,\s*address,\s*network\)/,
  /target\.address = ANY\(\$2::text\[\]\)/,
  /const targetIsRecipient =[\s\S]*\["recipient",\s*"receiver",\s*"counterparty"\]/,
  /if \(actorKey && actorKey === targetKey\)[\s\S]*folder: "sent"/,
  /if \(!actorKey \|\| actorKey !== targetKey \|\| targetIsRecipient\)[\s\S]*folder: "inbox"/,
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
  /async function indexedRegistryPayload\(network\)[\s\S]*proofIndexReadFeatureEnabled\([\s\S]*registry-history[\s\S]*proofIndexRegistryPayload\(network,\s*\{ registryAddress \}\)/,
  /async function registrySummaryPayload\(network,\s*fresh\s*=\s*false\)[\s\S]*await indexedRegistryPayload\(network\)[\s\S]*fastJsonBackedPayload/,
  /url\.pathname === "\/api\/v1\/registry" \|\| url\.pathname === "\/api\/v1\/ids"[\s\S]*const indexedPayload = await indexedRegistryPayload\(network\)[\s\S]*if \(indexedPayload\)/,
]);

expectAll("WORK floor USD uses live price metadata", server, [
  /function satsToUsdAtBtcUsd\(sats,\s*btcUsd\)/,
  /function btcUsdResponseMetadata\(quote\)/,
  /btcUsdPricePayload\(network,\s*\{\s*fresh\s*\}\)/,
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
expectAll("Infinity Bond mail normalization spans DB reads", proofIndexReader, [
  /const INFINITY_BOND_MEMO = "powb"/,
  /function isInfinityBondEventPayload\(payload,\s*row = \{\}\)/,
  /function normalizeEventPayload\(payload,\s*row = \{\}\)/,
  /function eventKindSqlCondition\(kind,\s*addValue\)/,
  /activityPayload\.activity\.map\(\(item\) => normalizeEventPayload\(item\)\)/,
  /filters\.push\(eventKindSqlCondition\(kind,\s*addValue\)\)/,
  /items: rowsResult\.rows\.map\(\(row\) => eventRowPayload\(row,\s*network\)\)/,
]);
expectAll("backfill writes powb mail as Infinity Bond projections", proofIndexerBackfill, [
  /const INFINITY_BOND_MEMO = "powb"/,
  /function isInfinityBondItem\(item,\s*kind = rawEventKind\(item\)\)/,
  /return isInfinityBondItem\(item,\s*kind\) \? INFINITY_BOND_KIND : kind/,
  /stableEventKeyKind\(item,\s*kind,\s*sourceLabel\)/,
  /\["mail",\s*"reply",\s*"file",\s*"attachment",\s*"browser",\s*INFINITY_BOND_KIND\]\.includes/,
  /item\.body \?\? item\.message \?\? item\.memo \?\? item\.detail/,
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
