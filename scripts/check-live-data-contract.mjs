import { readFileSync } from "node:fs";

const server = readFileSync("server/proof-api.mjs", "utf8");
const app = readFileSync("src/App.tsx", "utf8");
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
  /async function nodeMailPayload\(address,\s*network\)[\s\S]*let scanError = ""[\s\S]*fetchAddressTransactions\([\s\S]*MAX_ADDRESS_TX_PAGES,[\s\S]*\{ includeExternal: false \}[\s\S]*First-party mail scan failed[\s\S]*scanFailed: Boolean\(scanError\)/,
  /async function indexedMailPayload\(address,\s*network\)[\s\S]*proofIndexReadFeatureEnabled\("address-mail,mail,event-history,events"\)[\s\S]*proofIndexAddressMailPayload\(network,\s*address\)/,
  /async function mailPayload\(address,\s*network,\s*options = \{\}\)[\s\S]*const indexedPayload = await indexedMailPayload\(address,\s*network\)[\s\S]*if \(!fresh && indexedPayload\) \{[\s\S]*return indexedPayload/,
  /mailPayload\(address,\s*network,\s*\{ fresh: freshRead \}\)/,
  /async function addressUtxoPayload\(address,\s*network\)[\s\S]*for \(const base of firstPartyAddressReadBases\(network\)\)/,
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

if (failures.length) {
  console.error("Live data contract failed:");
  for (const failure of failures) {
    console.error(`- ${failure}`);
  }
  process.exit(1);
}

console.log("Live data contract passed.");
