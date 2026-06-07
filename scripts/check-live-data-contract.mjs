import { readFileSync } from "node:fs";

const server = readFileSync("server/proof-api.mjs", "utf8");
const app = readFileSync("src/App.tsx", "utf8");
const packageJson = readFileSync("package.json", "utf8");
const failures = [];
const invalidateWorkFloorBlock = server.slice(
  server.indexOf("function invalidateWorkFloorCaches"),
  server.indexOf("function invalidateDerivedCachesForBaseCache"),
);

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

expectAll("WORK floor oracle stays confirmed Computer value based", server, [
  /WORK_TOKEN_MAX_SUPPLY\s*=\s*21_000_000/,
  /workFloorPayload\(network,\s*fresh\s*=\s*false\)/,
  /confirmedComputerActionCount\(/,
  /growthActualNetworkValue\(/,
  /INFINITY_BOND_MEMO\s*=\s*"powb"/,
  /FULL_ACTIVITY_HISTORY_ADDRESSES/,
  /1H1arP2xpam6MZmHt6k1tB83stqVdH6ANK/,
  /isInfinityBondActivityItem\(/,
  /infinityBondFlowSats/,
  /infinityBondSats/,
  /correctedNetworkValueSats\s*\/\s*WORK_TOKEN_MAX_SUPPLY/,
  /networkValueSats:\s*correctedNetworkValueSats/,
]);

expectAll("fresh WORK and Growth reads use canonical confirmed activity", server, [
  /globalActivityPayload\(network,\s*fresh\s*=\s*false\)/,
  /shouldFetchFullActivityHistory\(address,\s*network\)[\s\S]*fetchAddressTransactions\(address,\s*network\)/,
  /fetchAddressTransactionsViaMempoolPagination\(\s*address,\s*network,\s*MAX_ADDRESS_TX_PAGES/s,
  /activitySummaryPayload\(network,\s*fresh\s*=\s*false\)[\s\S]*await globalActivityPayload\(network,\s*true\)/,
  /cachedWorkFloorPayload\(network,\s*fresh\s*=\s*false\)[\s\S]*if \(fresh\) \{\s*return refreshPromise;\s*\}/,
  /growthSummaryPayload\(network,\s*fresh\s*=\s*false\)[\s\S]*fresh\s*\?\s*globalActivityPayload\(network,\s*true\)/,
  /growthSummaryPayload\(network,\s*fresh\s*=\s*false\)[\s\S]*fresh\s*\?\s*refreshTokenPayload\(network,\s*WORK_TOKEN_ID\)/,
  /growthSummaryPayload\(network,\s*fresh\s*=\s*false\)[\s\S]*workFloorPayloadFromState\(/,
  /workFloorPayload\(network,\s*fresh\s*=\s*false\)[\s\S]*fresh\s*\?\s*globalActivityPayload\(network,\s*true\)/,
  /function workFloorPayloadFromState\(/,
  /refreshedJsonResponse\(\s*response,\s*`activity:\$\{network\}`,\s*await globalActivityPayload\(network,\s*true\)/,
]);

expectAll("WORK floor counts confirmed token sale records only", server, [
  /const tokenSalesForValue = Array\.isArray\(valueTokenState\.sales\)/,
  /registryState\.sales/,
  /valueTokenState\.transfers/,
  /valueTokenState\.mints/,
  /activityForGrowth/,
]);

expect(
  "closed token listings are not synthetic growth sales",
  !/tokenSalesIncludingSealedClosedListings/.test(server) &&
    !/inferredFromClosedListing/.test(server),
);

expectAll("marketplace sale volume is separate from marketplace fees", server, [
  /marketplaceSaleVolumeSats\s*=\s*idMarketplaceVolumeSats\s*\+\s*tokenSaleVolumeSats/,
  /marketplaceVolumeSats\s*=\s*marketplaceSaleVolumeSats/,
  /idMarketplaceFeeSats\s*=\s*confirmedActivityFlowSats/,
  /tokenMarketplaceFeeSats\s*=\s*confirmedActivityFlowSats/,
  /marketplaceMutationFeeSats\s*=\s*marketplaceFeeSats/,
]);

expectAll("WORK floor overlays scoped WORK token truth", server, [
  /function tokenStateWithScopedTokenOverride\(/,
  /const valueTokenState = tokenStateWithScopedTokenOverride\(/,
  /valueTokenState\.sales/,
]);

expectAll("token sale-ticket fees remain confirmed network events", server, [
  /sealAt:\s*createdAt/,
  /sealConfirmed:\s*confirmed/,
  /kind:\s*"token-listing-sealed"/,
  /"token-listing-closed"/,
]);

expectAll("heavy live reads are background-throttled", server, [
  /BACKGROUND_ACTIVITY_REFRESH_INTERVAL_MS/,
  /BACKGROUND_TOKEN_REFRESH_INTERVAL_MS/,
  /BACKGROUND_WORK_TOKEN_REFRESH_INTERVAL_MS/,
  /BACKGROUND_REFRESH_LAST_STARTED/,
  /backgroundRefreshRecentlyStarted\(/,
  /scheduleWarmJsonCache\(/,
]);

expect(
  "derived WORK/growth cache invalidation keeps stale snapshots available",
  /expireResponseCacheEntry\(\s*`payload:work-floor/.test(
    invalidateWorkFloorBlock,
  ) && !/RESPONSE_CACHE\.delete/.test(invalidateWorkFloorBlock),
);

expectAll("request paths can paint from persisted snapshots", server, [
  /fastJsonBackedPayload\(/,
  /fastGlobalActivityPayload\(/,
  /fastCachedTokenPayload\(/,
  /fastTokenPayloadSnapshot\(/,
  /return emptyWorkFloorPayload\(network\);/,
]);

expectAll("spent marketplace tickets invalidate live listings", server, [
  /tokenListingAnchorOutspend\(/,
  /filterSpendableTokenListings\(/,
  /tokenPayloadWithSpendableListings\(/,
  /filterSpendableListings\(state\.listings,\s*network\)/,
  /listingAnchorSpent\(/,
]);

expectAll("token marketplace summaries refresh from live token truth", server, [
  /function cacheTokenPayload\(/,
  /async function refreshTokenPayload\(/,
  /cacheTokenPayload\(network,\s*scope,\s*payload\)/,
  /function shouldAutoRefreshTokenScope\([^)]*\)\s*{\s*return true;/s,
  /async function workTokenPayload\(/,
  /canonicalWorkTokenDefinition\(network\)/,
  /fresh\s*\?\s*await freshTokenPayloadOrSnapshot\(network,\s*scope\)/,
  /fresh\s*\?\s*refreshTokenPayload\(network\)\s*:\s*fastCachedTokenPayload\(network\)/,
  /fresh\s*\?\s*refreshTokenPayload\(network\)\s*:\s*fastTokenPayloadSnapshot\(network\)/,
  /fresh\s*\?\s*refreshTokenPayload\(network,\s*WORK_TOKEN_ID\)\s*:\s*fastCachedTokenPayload\(network,\s*WORK_TOKEN_ID\)/,
  /tokenSummaryPayload\(network,\s*WORK_TOKEN_ID,\s*fresh\)/,
  /tokenSummaryPayload\(network,\s*"",\s*fresh\)/,
  /async function tokenHistoryPayload[\s\S]*fresh\s*\?\s*await freshTokenPayloadOrSnapshot\(network,\s*scope\)/,
]);

expectAll("real paginated history contract is present", server, [
  /function paginatedHistoryPayload\(/,
  /totalCount/,
  /pageCount/,
  /nextCursor/,
  /indexedThroughBlock/,
  /\/api\/v1\/log-history/,
  /\/api\/v1\/token-history/,
]);

expectAll("token market history paginates closed listings and sales", server, [
  /function tokenMarketLogItemsFromState\(/,
  /kind:\s*"closed-listing"/,
  /\["closedlistings",\s*"closedListings"\]/,
  /\["market-log",\s*"market-log"\]/,
  /safeKind\s*===\s*"market-log"/,
]);

expectAll("frontend shows live freshness metadata", app, [
  /indexedThroughBlock\?:\s*number/,
  /Refreshed \$\{formatDate\(indexedAt\)\}/,
  /through block/,
  /Refreshed \{formatDate\(chainMetricsIndexedAt\)\}/,
  /confirmed\s+Computer events/,
]);

expectAll("frontend refresh routes hit shared live surfaces", app, [
  /refreshMarketplaceSummary\(/,
  /fetchMarketplaceSummary\(fresh\)/,
  /refreshLogSurface\(/,
  /loadLogHead\(true,\s*fresh\)/,
  /loadLogHistoryPage\(currentPageIndex,\s*true\)/,
]);

expectAll("marketplace listing sort modes cover price and arb", app, [
  /"price-desc"/,
  /"price-asc"/,
  /"arb-desc"/,
  /"arb-asc"/,
  /sortTokenListings\(/,
  /sortIdMarketplaceListings\(/,
]);

expectAll("token directory sorts by confirmed supply and mint progress", app, [
  /type TokenDirectorySortMode\s*=\s*"mint-progress"\s*\|\s*"confirmed-supply"/,
  /TokenDirectorySortTabs\(/,
  /sortTokenDirectoryRows\(/,
  /tokenProgressLabel\(token\.confirmedSupply,\s*token\.maxSupply\)/,
]);

expectAll("token marketplace log uses API-backed pagination", app, [
  /type TokenMarketLogItem\s*=/,
  /kind:\s*"closed-listing"/,
  /fetchTokenHistoryPage<TokenMarketLogItem>\(network,\s*"market-log"/,
  /tokenMarketLogDataVersion/,
  /historyPageToPagedItems\(/,
  /Credit Sales & Listings Log/,
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
