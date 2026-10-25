import { expect, test } from "@playwright/test";
import { createAmoBrowseFixture, BROWSE_ASSETS } from "../fixtures/amoBrowseFixture.mjs";

const NOW = "2026-10-25T14:00:00.000Z";
const HASH = "b".repeat(64);
const HEIGHT = 973079;
const SELLER = "1BPVvi1GK4QkfqFMU4jHGjsQjyGwjJJJ7x";
const WORK = BROWSE_ASSETS.work;
const metadata = { indexedAt: NOW, indexedThroughBlock: HEIGHT, indexedThroughBlockHash: HASH,
  snapshotId: "amo-browse-browser-fixture", network: "livenet" };
const floor = { ...metadata, floorSats: 1, liveFloorSats: 1, frozenFloorSats: 1,
  workNetworkValueAccountingModel: "canonical-exact-work-network-q8-v1",
  creditMinerFeeAccountingModel: "canonical-unique-tx-input-output-v1",
  creditMinerFeeCoverage: { complete: true, confirmedEvents: 1, confirmedTransactions: 1,
    coveredConfirmedEvents: 1, coveredConfirmedTransactions: 1, missingConfirmedEvents: 0,
    missingConfirmedTransactions: 0, missingConfirmedTxids: [], source: "proof-indexer-normalized-input-output-totals" } };
for (const name of ["baseNetworkValue", "baseTotal", "frozenNetworkValue", "frozenTotal", "liveNetworkValue", "liveTotal", "networkValue", "total", "floor", "frozenFloor", "liveFloor"]) {
  const value = name.toLowerCase().includes("floor") ? 1 : 21000000;
  floor[`${name}Q8`] = String(BigInt(value) * 100000000n);
  floor[`${name}Sats`] = value;
  floor[`${name}SatsExact`] = String(value);
}
for (const name of ["creditEventFrozenValue", "creditEventLiveValue", "creditFrozenNetworkValue", "creditLiveNetworkValue", "creditMovementFrozenValue", "creditMovementLiveValue", "creditNetworkValue"]) floor[`${name}Q8`] = "0";
const WORK_FLOOR = { ...floor, actualValue: { ...floor }, workAmoV8: {
  version: "pwt-sale-v8", pinsRequested: true, pinsConfigured: true, protocolReady: true,
  writeAdmission: false, activation: { active: true, reached: true, tipVerified: true, evidenceComplete: true },
} };
const txid = number => number.toString(16).padStart(64, "0");
function source() {
  const listings = Array.from({ length: 60 }, (_, index) => ({
    network: "livenet", listingId: txid(index + 1), txid: txid(index + 1),
    tokenId: WORK, ticker: "WORK", sellerAddress: SELLER, registryAddress: "1638Vn6KtmK8p5r4oGvAXq9nmZb1emU1DV",
    confirmed: true, createdAt: new Date(Date.parse(NOW) - index * 1000).toISOString(),
    amount: "0.0000000749030366", amountSubatoms: "749030366", amountStorageModel: "work-subatoms-v2",
    decimals: 16, unitScale: "10000000000000000", precisionModel: "canonical-work-subatoms-v2", priceSats: 25000,
    sealConfirmed: index < 40, sealTxid: index < 40 ? txid(index + 1000) : undefined,
    saleAuthorization: { version: "pwt-sale-v8", network: "livenet", tokenId: WORK, ticker: "WORK",
      sellerAddress: SELLER, nonce: `browse-${index}`, unitFaceProofs: 25000,
      anchorType: "sale-ticket-v1", anchorValueSats: 546, anchorVout: 2, anchorSigHashType: 131,
      anchorScriptPubKey: "76a9144752142b83faf13d526a59212f3f228012890dbe88ac",
      sellerPublicKey: "02777b8fd3dc524694c52f2b505d14eacf289430f42b5785c48b7cb4948db8499b",
      anchorSignature: index < 40 ? "aa".repeat(64) : "", anchorTxid: index < 40 ? txid(index + 1) : "" },
  }));
  return { ...metadata, registry: { ...metadata, records: [{ id: "fixture", ownerAddress: SELLER,
    receiveAddress: SELLER, confirmed: true, txid: "a".repeat(64), amountSats: 1000, createdAt: NOW }],
    listings: [], activity: [], sales: [], pendingEvents: [] }, workFloor: WORK_FLOOR,
    token: { ...metadata, tokens: [{ network: "livenet", tokenId: WORK, txid: WORK, ticker: "WORK",
      registryAddress: "1638Vn6KtmK8p5r4oGvAXq9nmZb1emU1DV", creatorAddress: SELLER,
      confirmed: true, decimals: 16, unitScale: "10000000000000000", precisionModel: "canonical-work-subatoms-v2",
      amountStorageModel: "work-subatoms-v2", maxSupply: 21000000, confirmedSupply: "21000000",
      confirmedSupplySubatoms: "210000000000000000000000", maxSupplySubatoms: "210000000000000000000000",
      mintAmount: 1000, mintAmountSubatoms: "10000000000000000000", mintPriceSats: 1000,
      confirmedMints: 21000, pendingMints: 0, pendingSupply: "0", pendingSupplySubatoms: "0",
      openListings: 60, confirmedOpenListings: 60, pendingOpenListings: 0, holderCount: 1, createdAt: NOW }],
      listings, mints: [], sales: [], closedListings: [], transfers: [], holders: [], invalidEvents: [],
      stats: { totalTokens: 1, confirmedTokens: 1, openListings: 60, confirmedOpenListings: 60, pendingOpenListings: 0,
        confirmedSales: 0, pendingSales: 0 }, totalCounts: { listings: 60, tokens: 1 }, summaryOnly: true },
  };
}
function deferred() { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; }
async function install(page, options = {}) {
  const state = { source: source(), reads: [], pageGate: options.pageGate, priceGate: options.priceGate,
    warm: Boolean(options.warm), expired: false, pageFailure: false, refreshRequested: false };
  const respond = createAmoBrowseFixture(() => state.source);
  await page.route("**/api/v1/**", async route => {
    const url = new URL(route.request().url());
    state.reads.push(url);
    if (route.request().method() !== "GET") return route.fulfill({ status: 405, json: { error: "Read-only fixture" } });
    if (url.pathname === "/api/v1/marketplace-browse") {
      if (url.searchParams.get("refresh") === "1") state.refreshRequested = true;
      if (state.warm) return route.fulfill({ status: 503, json: { error: "Snapshot warming", details: { code: "AMO_BROWSE_WARMING" } } });
      if (url.searchParams.get("includeSummary") === "0") {
        await state.pageGate?.promise;
        if (state.expired) { state.expired = false; state.source.snapshotId = "amo-browse-rotated-fixture"; return route.fulfill({ status: 409,
          json: { error: "Snapshot expired", details: { code: "AMO_BROWSE_VERSION_EXPIRED" } } }); }
        if (state.pageFailure) return route.fulfill({ status: 503, json: { error: "Page unavailable" } });
      }
      try { return route.fulfill({ json: await respond(url) }); }
      catch (error) { return route.fulfill({ status: error.statusCode ?? 500, json: { error: error.message, details: error.details } }); }
    }
    if (url.pathname === "/api/v1/prices/btc-usd") {
      await state.priceGate?.promise;
      return route.fulfill({ status: 503, json: { error: "Optional display price unavailable" } });
    }
    if (url.pathname === "/api/v1/token-history") {
      if (url.searchParams.get("kind") === "listings") return route.fulfill({ status: 503, json: { error: "Browsing must not fetch whole authority inventory" } });
      return route.fulfill({ json: { ...metadata, kind: url.searchParams.get("kind"), authoritative: true,
        complete: true, items: [], totalCount: 0, start: 0, end: 0, limit: 25, hasMore: false } });
    }
    if (url.pathname === "/api/v1/marketplace-summary") return route.fulfill({ status: 503, json: { error: "Strict authority reads unavailable" } });
    if (url.pathname === "/api/v1/registry" || url.pathname === "/api/v1/registry-summary") return route.fulfill({ json: state.source.registry });
    return route.fulfill({ json: {} });
  });
  return state;
}
const verification = page => page.locator(".marketplace-summary-read-state").first();
const pageReads = state => state.reads.filter(url => url.pathname.endsWith("/marketplace-browse") && url.searchParams.get("includeSummary") === "0");
const strictListingReads = state => state.reads.filter(url => url.pathname.endsWith("/token-history") && url.searchParams.get("kind") === "listings");
for (const [route, width, theme] of [["/?marketplace=1", 1440, "light"], ["/?marketplace=1", 320, "dark"],
  ["/?folder=marketplace", 1440, "dark"], ["/?folder=marketplace", 390, "light"]]) {
  test(`AMO summary and IDs are independent of page and price loading ${route} ${width} ${theme}`, async ({ page }) => {
    await page.setViewportSize({ width, height: width === 320 ? 480 : 900 });
    await page.emulateMedia({ colorScheme: theme });
    const pageGate = deferred(); const priceGate = deferred();
    const state = await install(page, { pageGate, priceGate });
    try {
      await page.goto(route, { waitUntil: "domcontentloaded" });
      await expect(verification(page)).toHaveAttribute("data-state", "last-verified");
      await expect(page.locator(".marketplace-summary-gate")).toHaveCount(0);
      await expect(page.getByLabel("AMO asset tabs").getByRole("button", { name: /^IDs/u })).toBeVisible();
      await page.getByLabel("AMO asset tabs").getByRole("button", { name: /^IDs/u }).click();
      await expect(page.getByRole("heading", { name: "List an ID", exact: true })).toBeVisible();
      expect(strictListingReads(state)).toHaveLength(0);
      expect(state.reads.some(url => url.pathname.endsWith("/marketplace-summary"))).toBe(false);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
    } finally { pageGate.resolve(); priceGate.resolve(); }
  });
}

test("AMO fetches only the selected page and filters the complete server snapshot", async ({ page }) => {
  const state = await install(page);
  await page.goto(`/?marketplace=1&asset=${WORK}`, { waitUntil: "domcontentloaded" });
  await expect(verification(page)).toHaveAttribute("data-state", "last-verified");
  const book = page.locator(".token-market-card").filter({ has: page.getByRole("heading", { name: "AMO Units" }) }).first();
  await expect(book.getByRole("button", { name: "All 60", exact: true })).toBeVisible();
  await expect(book.locator(".token-market-grid .token-market-row")).toHaveCount(25);
  expect(strictListingReads(state)).toHaveLength(0);
  expect(pageReads(state)).toHaveLength(1);
  await book.getByRole("button", { name: "Sealed 40", exact: true }).click();
  await expect.poll(() => pageReads(state).at(-1)?.searchParams.get("status")).toBe("sealed");
  await expect(book.locator(".token-market-grid .token-market-row")).toHaveCount(25);
  await book.getByRole("button", { name: /^Page 1 \/ /u }).click();
  await expect(book.locator(".token-market-grid .token-market-row")).toHaveCount(15);
  expect(pageReads(state).at(-1).searchParams.get("cursor")).toBeTruthy();
  expect(new Set(pageReads(state).map(url => url.searchParams.get("version"))).size).toBe(1);
  await book.getByPlaceholder("Search sale tickets, sellers, txids").fill(txid(40));
  await expect(book.locator(".token-market-grid .token-market-row")).toHaveCount(1);
  expect(pageReads(state).at(-1).searchParams.has("cursor")).toBe(false);
  expect(strictListingReads(state)).toHaveLength(0);
});

test("AMO cold startup retries warming without waiting for the normal minute cycle", async ({ page }) => {
  const state = await install(page, { warm: true });
  await page.goto("/?marketplace=1", { waitUntil: "domcontentloaded" });
  await expect(verification(page)).toHaveAttribute("data-state", "loading");
  expect(await page.getByText("No credit listings yet", { exact: true }).count()).toBe(0);
  state.warm = false;
  await expect(verification(page)).toHaveAttribute("data-state", "last-verified", { timeout: 8000 });
  expect(strictListingReads(state)).toHaveLength(0);
});

test("AMO expired listing version restarts automatically without losing summary", async ({ page }) => {
  const state = await install(page);
  await page.goto(`/?marketplace=1&asset=${WORK}`, { waitUntil: "domcontentloaded" });
  await expect(verification(page)).toHaveAttribute("data-state", "last-verified");
  const book = page.locator(".token-market-card").filter({ has: page.getByRole("heading", { name: "AMO Units" }) }).first();
  await expect(book.locator(".token-market-grid .token-market-row")).toHaveCount(25);
  const before = state.reads.length;
  const oldVersion = pageReads(state).at(-1).searchParams.get("version");
  state.expired = true;
  await book.getByRole("button", { name: /^Page 1 \/ /u }).click();
  await expect.poll(() => state.reads.slice(before).filter(url => url.pathname.endsWith("/marketplace-browse") && url.searchParams.get("includeSummary") !== "0").length).toBeGreaterThan(0);
  await expect.poll(() => pageReads(state).at(-1)?.searchParams.get("version")).not.toBe(oldVersion);
  expect(pageReads(state).at(-1).searchParams.has("cursor")).toBe(false);
  await expect(book.locator(".token-market-grid .token-market-row")).toHaveCount(25);
  await expect(book.getByRole("button", { name: "Retry listings", exact: true })).toHaveCount(0);
  await expect(verification(page)).toHaveAttribute("data-state", "last-verified");
  expect(strictListingReads(state)).toHaveLength(0);
});

for (const route of ["/?marketplace=1", "/?folder=marketplace"]) {
  test(`AMO manual refresh cancellation releases its own busy state after returning visible ${route}`, async ({ page }) => {
    const state = await install(page);
    const surface = page.locator(route.includes("folder=") ? ".marketplace-workspace" : ".marketplace-app");
    await page.goto(`${route}&asset=${WORK}`, { waitUntil: "domcontentloaded" });
    await expect(verification(page)).toHaveAttribute("data-state", "last-verified");
    await expect(page.locator("#credit-market-book .token-market-row")).toHaveCount(25);
    state.warm = true;
    await surface.getByRole("button", { name: "Refresh", exact: true }).first().click();
    await expect.poll(() => state.refreshRequested).toBe(true);
    await expect(surface.getByRole("button", { name: "Refreshing", exact: true }).first()).toBeDisabled();
    await page.evaluate(() => {
      Object.defineProperty(document, "visibilityState", { configurable: true, get: () => "hidden" });
      document.dispatchEvent(new Event("visibilitychange"));
    });
    // Hidden reads stop; return starts a silent read, which must not inherit manual busy.
    const beforeReturn = state.reads.length;
    state.warm = false;
    await page.evaluate(() => {
      Object.defineProperty(document, "visibilityState", { configurable: true, get: () => "visible" });
      document.dispatchEvent(new Event("visibilitychange"));
    });
    await expect.poll(() => state.reads.length).toBeGreaterThan(beforeReturn);
    await expect(verification(page)).toHaveAttribute("data-state", "last-verified");
    const refresh = surface.getByRole("button", { name: "Refresh", exact: true }).first();
    await expect(refresh).toBeEnabled();
    await expect(page.locator("#credit-market-book .token-market-row")).toHaveCount(25);
    state.refreshRequested = false;
    await refresh.click();
    await expect.poll(() => state.refreshRequested).toBe(true);
    await expect(refresh).toBeEnabled();
    expect(strictListingReads(state)).toHaveLength(0);
  });
}


for (const [ticker, asset, route] of [["WORK", WORK, "/?marketplace=1"], ["POWB", BROWSE_ASSETS.powb, "/?folder=marketplace"]]) {
  test(`AMO ${ticker} retains rows but withholds references until the matching snapshot page arrives`, async ({ page }) => {
    const state = await install(page);
    if (ticker === "WORK") {
      const models = { amountModel: "canonical-work-amo-proof-unit-amount-v3",
        blockSequencerModel: "canonical-work-amo-full-position-block-sequencer-v4",
        bondTransitionModel: "canonical-compute-then-bond-v1", stateOrderModel: "canonical-proof-state-order-v1",
        unitModel: "canonical-work-amo-proof-unit-v3", unitWorkOracleModel: "canonical-work-prefix-before-action-v1" };
      state.source.token.listings = state.source.token.listings.map(listing => ({ ...listing,
        amount: "0.0000000752009741", amountAtoms: "752009741", amountSubatoms: "752009741",
        saleAuthorization: { ...listing.saleAuthorization, ...models },
        frozenTerms: { ...models, version: "pwt-sale-v8", listingBlockHash: HASH, listingBlockHeight: 962104,
          listingBlockIndex: 567, listingProtocolVout: 1, listingRecordOrdinal: 0,
          listingBondContributionQ8: "2969148577200", listingNetworkValueBeforeQ8: "698129253763344438743503765",
          listingNetworkValueAfterQ8: "698129253763347407892080965", unitAmountSubatoms: "752009741",
          unitFaceProofs: 25000, unitMinimumPriceSats: "25000", unitPriceSats: "25000" },
      }));
    } else {
      state.source.token.tokens.push({ ...state.source.token.tokens[0], ticker, tokenId: asset, txid: asset,
        decimals: 0, unitScale: "1", precisionModel: undefined, amountStorageModel: undefined,
        confirmedSupply: "1000", confirmedSupplySubatoms: undefined, maxSupplySubatoms: undefined,
        mintAmount: 1, mintAmountSubatoms: undefined, mintPriceSats: 1 });
      state.source.token.listings = state.source.token.listings.map(listing => ({ ...listing,
        ticker, tokenId: asset, amount: 1, amountAtoms: "1", amountSubatoms: undefined, decimals: 0,
        unitScale: "1", precisionModel: undefined, amountStorageModel: undefined, priceSats: 2,
        saleAuthorization: { ...listing.saleAuthorization, version: "pwt-sale-v3", ticker, tokenId: asset },
      }));
    }
    await page.goto(`${route}&asset=${asset}`, { waitUntil: "domcontentloaded" });
    const surface = page.locator(route.includes("folder=") ? ".marketplace-workspace" : ".marketplace-app");
    const book = page.locator(".token-market-card").filter({ has: page.getByRole("heading", {
      name: ticker === "WORK" ? "AMO Units" : "POWB Sale Tickets", exact: true }) }).first();
    const rows = book.locator(".token-market-grid .token-market-row");
    await expect(rows).toHaveCount(25);
    const expectOldReference = async () => {
      if (ticker === "WORK") await expect(rows.getByTestId("work-buyer-arb")).toHaveText(Array(25).fill("-24,999.9999999247990259 proofs"));
      else await expect(rows.locator("p.field-note")).toHaveText(Array(25).fill("Reference: 1 proofs / POWB bond floor"));
    };
    await expectOldReference();
    // A same-version filter request must keep its already coherent reference.
    const filterGate = deferred(); state.pageGate = filterGate;
    try {
      await book.getByRole("button", { name: "Sealed 40", exact: true }).click();
      await expect.poll(() => pageReads(state).at(-1)?.searchParams.get("status")).toBe("sealed");
      await expectOldReference();
      await expect(rows.getByText("Updating reference", { exact: true })).toHaveCount(0);
    } finally { filterGate.resolve(); state.pageGate = undefined; }
    await expect(book.locator(".marketplace-summary-inline-state")).toHaveAttribute("aria-busy", "false");
    const oldLinks = await rows.getByRole("link", { name: "Listing TX", exact: true }).evaluateAll(nodes => nodes.map(node => node.href));
    const oldVersion = pageReads(state).at(-1).searchParams.get("version");
    const nextGate = deferred(); state.pageGate = nextGate;
    state.source = structuredClone(state.source);
    state.source.snapshotId = `amo-${ticker}-new-reference`;
    state.source.token.listings = state.source.token.listings.map((listing, index) => ({ ...listing,
      listingId: txid(index + 10000), txid: txid(index + 10000), saleAuthorization: { ...listing.saleAuthorization,
        anchorTxid: listing.sealConfirmed ? txid(index + 10000) : "" } }));
    if (ticker === "WORK") {
      for (const quote of [state.source.workFloor, state.source.workFloor.actualValue]) {
        for (const name of ["baseNetworkValue", "baseTotal", "frozenNetworkValue", "frozenTotal", "liveNetworkValue", "liveTotal", "networkValue", "total", "floor", "frozenFloor", "liveFloor"]) {
          const value = name.toLowerCase().includes("floor") ? 2 : 42000000;
          quote[`${name}Q8`] = String(BigInt(value) * 100000000n);
          quote[`${name}Sats`] = value; quote[`${name}SatsExact`] = String(value);
        }
      }
    } else state.source.browseBondReferences = { [asset]: { floorQ8: "200000000", floorSats: "2" } };
    try {
      await surface.getByRole("button", { name: "Refresh", exact: true }).first().click();
      await expect.poll(() => pageReads(state).at(-1)?.searchParams.get("version")).not.toBe(oldVersion);
      await expect(rows).toHaveCount(25);
      expect(await rows.getByRole("link", { name: "Listing TX", exact: true }).evaluateAll(nodes => nodes.map(node => node.href))).toEqual(oldLinks);
      await expect(rows.getByText("Updating reference", { exact: true })).toHaveCount(25);
      if (ticker === "WORK") await expect(rows.getByTestId("work-buyer-arb")).toHaveCount(0);
      else {
        await expect(rows.locator("p.field-note")).toHaveText(Array(25).fill("Reference: updating for these listings"));
        await expect(rows).not.toContainText(Array(25).fill("Reference: 2 proofs / POWB bond floor"));
      }
    } finally { nextGate.resolve(); state.pageGate = undefined; }
    await expect(rows.getByText("Updating reference", { exact: true })).toHaveCount(0);
    if (ticker === "WORK") await expect(rows.getByTestId("work-buyer-arb")).toHaveText(Array(25).fill("-24,999.9999998495980518 proofs"));
    else await expect(rows.locator("p.field-note")).toHaveText(Array(25).fill("Reference: 2 proofs / POWB bond floor"));
    expect(await rows.getByRole("link", { name: "Listing TX", exact: true }).evaluateAll(nodes => nodes.map(node => node.href))).not.toEqual(oldLinks);
    expect(strictListingReads(state)).toHaveLength(0);
  });
}
