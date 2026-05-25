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
  /correctedNetworkValueSats\s*\/\s*WORK_TOKEN_MAX_SUPPLY/,
  /networkValueSats:\s*correctedNetworkValueSats/,
]);

expectAll("WORK floor counts confirmed token sale records only", server, [
  /const tokenSalesForValue = Array\.isArray\(tokenState\.sales\)/,
  /registryState\.sales/,
  /tokenState\.transfers/,
  /tokenState\.mints/,
  /activityForGrowth/,
]);

expect(
  "closed token listings are not synthetic growth sales",
  !/tokenSalesIncludingSealedClosedListings/.test(server) &&
    !/inferredFromClosedListing/.test(server),
);

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
  /fresh\s*\?\s*await refreshTokenPayload\(network,\s*scope\)/,
  /tokenSummaryPayload\(network,\s*WORK_TOKEN_ID,\s*fresh\)/,
  /tokenSummaryPayload\(network,\s*"",\s*fresh\)/,
  /async function tokenHistoryPayload[\s\S]*fresh\s*\?\s*await refreshTokenPayload\(network,\s*scope\)/,
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

expectAll("marketplace sort modes cover price and arb", app, [
  /"price-desc"/,
  /"price-asc"/,
  /"arb-desc"/,
  /"arb-asc"/,
  /sortTokenListings\(/,
  /sortTokenMarketplaceRows\(/,
]);

expectAll("token marketplace log uses API-backed pagination", app, [
  /type TokenMarketLogItem\s*=/,
  /kind:\s*"closed-listing"/,
  /fetchTokenHistoryPage<TokenMarketLogItem>\(network,\s*"market-log"/,
  /tokenMarketLogDataVersion/,
  /historyPageToPagedItems\(/,
  /Token Sales & Listings Log/,
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
