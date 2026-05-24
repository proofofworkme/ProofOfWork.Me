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

expectAll("WORK floor is not separated from confirmed marketplace/log events", server, [
  /tokenSalesIncludingSealedClosedListings\(tokenState\)/,
  /registryState\.sales/,
  /tokenState\.transfers/,
  /tokenState\.mints/,
  /activityForGrowth/,
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

expectAll("real paginated history contract is present", server, [
  /function paginatedHistoryPayload\(/,
  /totalCount/,
  /pageCount/,
  /nextCursor/,
  /indexedThroughBlock/,
  /\/api\/v1\/log-history/,
  /\/api\/v1\/token-history/,
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
