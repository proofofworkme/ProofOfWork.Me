import { expect, test } from "@playwright/test";

// These deterministic read fixtures exercise display behavior only. They do not
// establish chain authority and no test connects, signs, or broadcasts a wallet.
const HASH = "1".repeat(64);
const NOW = "2026-10-20T12:00:00.000Z";
const ADDRESS = "1BPVvi1GK4QkfqFMU4jHGjsQjyGwjJJJ7x";
const WORK = "d4e5ebf11d104d6a63fb74e42094364b25a5f7199a09e5c0e71408972466a8b8";
const POWB = "a3d0bc8528f91dfc52400a885bed7e49235396aa82aa9f95db41be629f1d5562";
const INCB = "3cb25745f937f2b4e5508e5400189fe8fe679cd8e84bfa1e9176d70c9761f15d";
const CREDIT = "c".repeat(64);
const SUPPLY = "90071992547409931234567890";
const txid = (value) => value.toString(16).padStart(64, "0");
const time = (index) => new Date(Date.parse(NOW) - (3 - index) * 86_400_000).toISOString();
const exactText = (text) => text.replaceAll(",", "");

function token(tokenId, ticker) {
  const work = tokenId === WORK;
  const bond = tokenId === POWB || tokenId === INCB;
  return {
    tokenId, txid: tokenId, ticker, network: "livenet", confirmed: true,
    createdAt: time(0), creatorAddress: ADDRESS, registryAddress: ADDRESS,
    creationFeeSats: 1000, mintAmount: work ? 1000 : 1, mintPriceSats: work ? 1000 : 10,
    maxSupply: bond ? null : 21_000_000, maxSupplyModel: bond ? "uncapped" : "fixed",
    uncapped: bond, confirmedSupply: bond ? SUPPLY : work ? "21000000" : "10000",
    pendingSupply: 0, confirmedMints: 1, pendingMints: 0, holderCount: 1,
    confirmedSales: 1, pendingSales: 0, confirmedOpenListings: 2, pendingOpenListings: 0,
    openListings: 2, transferCount: 0,
    ...(work ? {
      amountStorageModel: "work-subatoms-v2", precisionModel: "canonical-work-subatoms-v2",
      decimals: 16, unitScale: "10000000000000000",
      confirmedSupplySubatoms: "210000000000000000000000",
      maxSupplySubatoms: "210000000000000000000000", mintAmountSubatoms: "10000000000000000000",
      pendingSupplySubatoms: "0",
    } : { decimals: 0, unitScale: "1" }),
  };
}

function workFloor({ zero = false } = {}) {
  const actualValue = {
    workNetworkValueAccountingModel: "canonical-exact-work-network-q8-v1",
    creditMinerFeeAccountingModel: "canonical-unique-tx-input-output-v1",
    creditMinerFeeCoverage: {
      complete: true, confirmedEvents: 1, confirmedTransactions: 1,
      coveredConfirmedEvents: 1, coveredConfirmedTransactions: 1,
      missingConfirmedEvents: 0, missingConfirmedTransactions: 0, missingConfirmedTxids: [],
      source: "proof-indexer-normalized-input-output-totals",
    },
  };
  for (const name of ["baseNetworkValue", "baseTotal", "frozenNetworkValue", "frozenTotal", "liveNetworkValue", "liveTotal", "networkValue", "total"]) {
    actualValue[`${name}Q8`] = "210000000021000000";
    actualValue[`${name}Sats`] = 2100000000.21;
    actualValue[`${name}SatsExact`] = "2100000000.21000000";
  }
  for (const name of ["floor", "frozenFloor", "liveFloor"]) {
    actualValue[`${name}Q8`] = "10000000001";
    actualValue[`${name}Sats`] = 100.00000001;
    actualValue[`${name}SatsExact`] = "100.00000001";
  }
  for (const name of ["creditEventFrozenValue", "creditEventLiveValue", "creditFrozenNetworkValue", "creditLiveNetworkValue", "creditMovementFrozenValue", "creditMovementLiveValue", "creditNetworkValue"]) {
    actualValue[`${name}Q8`] = "0";
  }
  return {
    ...actualValue, actualValue, network: "livenet", indexedAt: NOW,
    indexedThroughBlock: 972100, indexedThroughBlockHash: HASH,
    snapshotId: "ledger-charts-fixture", stats: { confirmedComputerActions: 3 },
    chartPoints: [zero ? "0" : "100000000", "1000000000", "10000000001"].map((floorQ8, index) => ({
      floorQ8, floorSats: Number(floorQ8) / 1e8,
      networkValueQ8: (BigInt(floorQ8) * 21_000_000n).toString(),
      networkValueSats: Number(floorQ8) / 1e8 * 21_000_000,
      label: `Confirmed checkpoint ${index + 1}`, years: 0.1 + index / 365,
    })),
  };
}

function creditListing(index, sealed) {
  const listingId = txid(100 + index);
  return {
    listingId, tokenId: CREDIT, ticker: "TEST", network: "livenet",
    amount: 3, priceSats: 100 + index, confirmed: true, createdAt: time(index + 1),
    registryAddress: ADDRESS, sellerAddress: ADDRESS,
    saleAuthorization: {
      version: "pwt-sale-v1", tokenId: CREDIT, ticker: "TEST", registryAddress: ADDRESS,
      amount: 3, priceSats: 100 + index, sellerAddress: ADDRESS,
      sellerPublicKey: "02777b8fd3dc524694c52f2b505d14eacf289430f42b5785c48b7cb4948db8499b",
      buyerAddress: "", expiresAt: "", nonce: `chart-${index}`, network: "livenet",
      anchorType: "sale-ticket-v1", anchorVout: 2, anchorValueSats: 546,
      anchorScriptPubKey: "76a9144752142b83faf13d526a59212f3f228012890dbe88ac",
      anchorSigHashType: 131, anchorTxid: sealed ? listingId : "",
      anchorSignature: sealed ? "aa".repeat(64) : "",
    },
    ...(sealed ? { sealConfirmed: true, sealTxid: txid(200 + index), sealAt: time(index + 1) } : {}),
  };
}

function tokenState() {
  return {
    tokens: [token(WORK, "WORK"), token(POWB, "POWB"), token(INCB, "INCB"), token(CREDIT, "TEST")],
    listings: [creditListing(0, true), creditListing(1, false)],
    sales: [{
      tokenId: CREDIT, ticker: "TEST", network: "livenet", confirmed: true,
      txid: txid(300), listingId: txid(99), amount: 3, priceSats: 77, paidSats: 77,
      createdAt: time(1), sellerAddress: ADDRESS, buyerAddress: ADDRESS, registryAddress: ADDRESS,
    }],
    closedListings: [], mints: [], holders: [], transfers: [], invalidEvents: [],
    creationSats: 4000, indexedAt: NOW, indexedThroughBlock: 972100,
    indexedThroughBlockHash: HASH, summaryOnly: false,
    directory: { model: "proof-token-directory-v1", complete: true, totalCount: 4 },
    collectionHasMore: { listings: false, sales: false, tokens: false },
    totalCounts: { tokens: 4, listings: 2, sales: 1 },
  };
}

function bondSummary(tokenId, state, { invalid = false, invalidLast = false } = {}) {
  const ticker = tokenId === POWB ? "POWB" : "INCB";
  return {
    network: "livenet", indexedAt: NOW, indexedThroughBlock: 972100,
    indexedThroughBlockHash: HASH, token: state, ticker, tokenId, registryAddress: ADDRESS,
    floorSats: "1.00000001", floorQ8: "100000001",
    networkValueSats: SUPPLY, networkValueQ8: `${SUPPLY}00000000`,
    stats: { confirmedSupply: SUPPLY, pendingSupply: 0, confirmedBondActions: 3, holders: 1 },
    actualValue: {
      floorSats: "1.00000001", floorQ8: "100000001",
      networkValueSats: SUPPLY, networkValueQ8: `${SUPPLY}00000000`,
      issuanceAccountingModel: "canonical-pre-bond-live-network-value-v2",
      issuanceValuationFixedAtSend: true, issuanceCheckpointMode: "bond-transaction-provenance",
      issuanceValueSnapshotMode: "canonical-summary-refresh",
      issuanceValueSnapshotModel: "canonical-summary-h-minus-one-v1",
      networkValueAccountingModel: "fixed-incb-issuance-plus-market-flow-v1",
      confirmedIssuanceUnits: SUPPLY, issuanceNetworkValueSats: SUPPLY,
      issuanceCheckpointBlockHeight: 972100, issuanceCheckpointBlockIndex: 1,
      issuanceCheckpointBlockHash: HASH, issuanceValueSnapshotBlockHeight: 972099,
      issuanceValueSnapshotBlockHash: HASH, issuanceValueSnapshotCanonicalSummaryHash: HASH,
      issuanceValueSnapshotGeneratedAt: NOW, issuanceValueSnapshotId: "chart-h-minus-one",
      issuanceValueSnapshotWorkNetworkValueSats: "2100000000.21",
      issuanceValueSnapshotWorkNetworkValueQ8: "210000000021000000",
    },
    chartPoints: [0n, 1n, 10000n].map((delta, index) => ({
      createdAt: time(index), txid: txid(400 + index), bondActions: index + 1,
      confirmedSupply: (invalid && index === 1) || (invalidLast && index === 2) ? "unavailable" : (BigInt(SUPPLY) + delta).toString(),
      floorSats: invalidLast && index === 2 ? "unavailable" : index === 0 ? "0" : "1.00000001",
      floorQ8: invalidLast && index === 2 ? "unavailable" : index === 0 ? "0" : "100000001",
      networkValueSats: (BigInt(SUPPLY) + delta).toString(),
      networkValueQ8: `${BigInt(SUPPLY) + delta}00000000`,
      blockHeight: 972098 + index, blockIndex: index,
    })),
  };
}

async function fixtures(page, options = {}) {
  const state = tokenState();
  const floor = workFloor(options);
  await page.route("**/api/v1/**", async (route) => {
    const url = new URL(route.request().url());
    const path = url.pathname.replace(/^\/test-api/u, "");
    let payload;
    if (path === "/api/v1/work-floor") payload = floor;
    else if (path === "/api/v1/work-summary") payload = { floor, token: state, indexedAt: NOW, network: "livenet" };
    else if (path === "/api/v1/infinity-summary") payload = bondSummary(POWB, state, options);
    else if (path === "/api/v1/inception-summary") payload = bondSummary(INCB, state, options);
    else if (path === "/api/v1/token" || path === "/api/v1/token-summary") payload = state;
    else if (path === "/api/v1/prices/btc-usd") {
      if (options.usdUnavailable) return route.fulfill({ status: 503, json: { error: "Fixture quote unavailable" } });
      payload = { USD: 100000, usd: 100000, indexedAt: NOW };
    } else if (path === "/api/v1/marketplace-summary") {
      payload = { token: state, workFloor: floor, indexedAt: NOW, network: "livenet",
        registry: { records: [], activity: [], pendingEvents: [], listings: [], sales: [], stats: {} } };
    } else if (path === "/api/v1/token-history") {
      const kind = url.searchParams.get("kind");
      // Chart preview rows live in the summary. This deliberately refuses the
      // complete-book witness rather than fabricating Core listing authority.
      if (kind === "listings") return route.fulfill({ status: 503, json: { error: "Complete book unavailable in chart fixture" } });
      payload = { kind, items: [], totalCount: 0, page: 0, limit: 25, hasMore: false,
        indexedAt: NOW, authoritative: true, complete: true };
    } else payload = {
      records: [], pendingEvents: [], activity: [], tokens: [], items: [], listings: [], sales: [],
      stats: {}, indexedAt: NOW, indexedThroughBlock: 972100, indexedThroughBlockHash: HASH,
    };
    return route.fulfill({ json: payload });
  });
}

const surfaces = [
  { name: "WORK", standalone: "/?work=1", computer: "/?folder=work" },
  { name: "Credit", standalone: `/?credit=1&asset=${CREDIT}`, computer: "/?folder=token" },
  { name: "POWB", standalone: "/?infinity=1", computer: "/?folder=infinity" },
  { name: "INCB", standalone: "/?inception=1", computer: "/?folder=inception" },
];

async function openSurface(page, surface, host) {
  await page.goto(surface[host]);
  // Open the directory first so Computer credit coverage includes its actual
  // Details navigation, URL asset state, and return to the factory.
  if (surface.name === "Credit" && host === "computer") {
    await page.locator(".token-record").filter({ hasText: "TEST" })
      .getByRole("button", { name: "Details", exact: true }).click();
    await expect(page).toHaveURL(new RegExp(`folder=token.*asset=${CREDIT}`));
  }
}

for (const surface of surfaces) {
  for (const host of ["standalone", "computer"]) {
    test(`${surface.name} ${host} exposes shared scales and exact observations`, async ({ page }, testInfo) => {
      await fixtures(page);
      await openSurface(page, surface, host);
      const chart = page.locator(".ledger-chart").first();
      await expect(chart).toBeVisible({ timeout: 45000 });
      await chart.getByRole("button", { name: "Linear", exact: true }).click();
      await expect(chart.getByRole("button", { name: "Linear", exact: true })).toHaveAttribute("aria-pressed", "true");
      const inspector = chart.getByRole("slider", { name: /^Inspect observation/u });
      await inspector.focus();
      await page.keyboard.press("Home");
      const first = await inspector.getAttribute("aria-valuetext");
      await page.keyboard.press("End");
      expect(await inspector.getAttribute("aria-valuetext")).not.toBe(first);
      await chart.locator("summary").filter({ hasText: "View data" }).click();
      await expect(chart.getByRole("table")).toBeVisible();
      const data = exactText(await chart.getByRole("table").innerText());
      if (surface.name === "WORK") expect(data).toContain("100.00000001");
      else if (surface.name === "POWB" || surface.name === "INCB") {
        expect(data).toContain(SUPPLY);
        expect(data).toContain((BigInt(SUPPLY) + 1n).toString());
        await expect(chart.getByRole("table").getByRole("link").first()).toHaveAttribute("href", new RegExp(txid(400)));
        await chart.getByRole("button", { name: "Network value", exact: true }).click();
        expect(exactText(await chart.getByRole("table").innerText())).toContain(SUPPLY);
        await chart.getByRole("button", { name: "Floor", exact: true }).click();
        expect(exactText(await chart.getByRole("table").innerText())).toContain("1.00000001");
        await expect(chart.getByRole("button", { name: "Log", exact: true })).toBeDisabled();
        await chart.getByRole("button", { name: "Supply", exact: true }).click();
      } else {
        expect(data).toMatch(/mint/iu);
        expect(data).toMatch(/sale/iu);
        expect(data).toMatch(/unsealed/iu);
        await expect(chart.locator(".ledger-chart-svg .ledger-chart-line:not(.is-reference)")).toHaveCount(0);
        expect(data).toContain("Seller payment 77 proofs");
        expect(data).toContain("Quantity 3 TEST");
      }
      await chart.locator("summary").filter({ hasText: "View data" }).click();
      const screenshot = testInfo.outputPath(`${surface.name}-${host}.png`);
      await chart.screenshot({ path: screenshot });
      await testInfo.attach(`${surface.name}-${host}`, { path: screenshot, contentType: "image/png" });
      if (surface.name === "Credit" && host === "computer") {
        await page.getByRole("button", { name: "Factory", exact: true }).click();
        await expect(page.locator(".token-record").filter({ hasText: "TEST" })
          .getByRole("button", { name: "Details", exact: true })).toBeVisible();
        expect(new URL(page.url()).searchParams.has("asset")).toBe(false);
      }
    });
  }
}

test("WORK Auto discloses log scale and an explicit linear choice changes the geometry", async ({ page }) => {
  await fixtures(page);
  await page.goto("/?work=1");
  const chart = page.locator(".ledger-chart").first();
  await expect(chart).toBeVisible({ timeout: 45000 });
  await expect(chart).toContainText(/log/iu);
  const before = await chart.locator("svg").innerHTML();
  await chart.getByRole("button", { name: "Linear", exact: true }).click();
  expect(await chart.locator("svg").innerHTML()).not.toBe(before);
  await chart.getByRole("button", { name: "Log", exact: true }).click();
  await expect(chart.getByRole("button", { name: "Log", exact: true })).toHaveAttribute("aria-pressed", "true");
});

test("zero prevents log without replacing the observation, and unavailable USD never becomes zero", async ({ page }) => {
  await fixtures(page, { zero: true, usdUnavailable: true });
  await page.goto("/?work=1");
  const chart = page.locator(".ledger-chart").first();
  await expect(chart).toBeVisible({ timeout: 45000 });
  await expect(chart.getByRole("button", { name: "Log", exact: true })).toBeDisabled();
  await expect(chart).toContainText(/zero|positive/iu);
  await chart.locator("summary").filter({ hasText: "View data" }).click();
  expect(exactText(await chart.getByRole("table").innerText())).toMatch(/\b0\b/u);
  const usd = page.getByRole("button", { name: "USD", exact: true }).first();
  if (await usd.isEnabled()) {
    await usd.click();
    await expect(chart).toContainText(/unavailable/iu);
    await expect(chart.locator("svg")).toHaveCount(0);
  } else await expect(usd).toBeDisabled();
});

test("missing bond values remain unavailable observations and break the line", async ({ page }) => {
  await fixtures(page, { invalid: true });
  await page.goto("/?infinity=1");
  const chart = page.locator(".ledger-chart").first();
  await expect(chart).toBeVisible({ timeout: 45000 });
  await chart.locator("summary").filter({ hasText: "View data" }).click();
  const rows = chart.getByRole("table").locator("tbody tr");
  await expect(rows).toHaveCount(3);
  await expect(rows.nth(1)).toContainText("Unavailable");
  await expect(chart).toContainText("1 observation with an unavailable value or time");
  const line = await chart.locator(".ledger-chart-svg .ledger-chart-line").getAttribute("d");
  expect(line.match(/M /gu)).toHaveLength(2);
  expect(line).not.toContain("L ");

  await fixtures(page, { invalidLast: true });
  await page.reload();
  await expect(chart).toBeVisible({ timeout: 45000 });
  await chart.locator("summary").filter({ hasText: "View data" }).click();
  await expect(chart.getByRole("table").locator("tbody tr").last()).toContainText("Unavailable");
  const details = page.locator(".chart-accounting-details");
  await details.getByText("Bond history details", { exact: true }).click();
  for (const label of ["Latest supply", "Latest floor"]) {
    await expect(details.locator("div").filter({ has: page.locator("span", { hasText: new RegExp(`^${label}$`) }) }).last()
      .locator("strong")).toHaveText("Unavailable");
  }
});

for (const theme of ["light", "dark"]) {
  test(`shared charts stay readable at 320px and short height in ${theme}`, async ({ page }, testInfo) => {
    await fixtures(page);
    await page.addInitScript((appearance) => localStorage.setItem("proofofwork-me-appearance-v1", appearance), theme);
    await page.setViewportSize({ width: 320, height: 480 });
    for (const surface of surfaces) {
      await openSurface(page, surface, "computer");
      const chart = page.locator(".ledger-chart").first();
      await expect(chart).toBeVisible({ timeout: 45000 });
      await chart.scrollIntoViewIfNeeded();
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
      for (const label of ["Auto", "Linear", "Log"]) {
        const box = await chart.getByRole("button", { name: label, exact: true }).boundingBox();
        expect(box.width).toBeGreaterThanOrEqual(44);
        expect(box.height).toBeGreaterThanOrEqual(44);
      }
      const labels = await chart.locator("svg text").evaluateAll((nodes) => nodes.map((node) => ({
        font: parseFloat(getComputedStyle(node).fontSize),
        x: node.getBoundingClientRect().x, right: node.getBoundingClientRect().right,
      })));
      for (const label of labels) {
        expect(label.font).toBeGreaterThanOrEqual(12);
        expect(label.x).toBeGreaterThanOrEqual(0);
        expect(label.right).toBeLessThanOrEqual(321);
      }
      const screenshot = testInfo.outputPath(`${surface.name}-${theme}-320.png`);
      await chart.screenshot({ path: screenshot });
      await testInfo.attach(`${surface.name}-${theme}-320`, { path: screenshot, contentType: "image/png" });
    }
  });
}
