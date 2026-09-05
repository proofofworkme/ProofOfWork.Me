import { expect, test } from "@playwright/test";

const CHECKPOINT = { blockHeight: 965563, blockHash: "a".repeat(64), snapshotId: "growth-ui-fixture" };
const NOW = "2026-09-05T04:05:00.000Z";
function growthFixture(mode = "ready") {
  const actualValue = {
    powids: 94,
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
    actualValue[`${name}Q8`] = "2100000000000000";
    actualValue[`${name}Sats`] = 21000000;
    actualValue[`${name}SatsExact`] = "21000000";
  }
  for (const name of ["floor", "frozenFloor", "liveFloor"]) {
    actualValue[`${name}Q8`] = "100000000";
    actualValue[`${name}Sats`] = 1;
    actualValue[`${name}SatsExact`] = "1";
  }
  for (const name of ["creditEventFrozenValue", "creditEventLiveValue", "creditFrozenNetworkValue", "creditLiveNetworkValue", "creditMovementFrozenValue", "creditMovementLiveValue", "creditNetworkValue"]) {
    actualValue[`${name}Q8`] = "0";
  }
  const boost = {
    model: "boost-growth-observation-v1", source: "proof-indexer-confirmed-boost-growth",
    countScope: "confirmed-indexed-shape-valid-records", ready: true, complete: true,
    economicMetricsVerified: false, checkpoint: CHECKPOINT,
    counts: { events: 3, transactions: 2, posts: 1, replies: 0, likes: 1, reboosts: 0, follows: 0,
      unfollows: 0, profiles: 0, hides: 1, transfers: 0, listings: 0, seals: 0, delistings: 0, sales: 0, socialActions: 1 },
    directProofSignalSats: null, registryFeeSats: null, saleVolumeSats: "0",
    attachedWorkSubatoms: "1", attributedMailSats: "546", attributedWorkSubatoms: "1",
    metricReasons: { directProofSignalSats: "Economic validation unavailable.", registryFeeSats: "Economic validation unavailable." },
  };
  if (mode === "mismatch") boost.checkpoint = { ...CHECKPOINT, blockHash: "b".repeat(64) };
  const payload = {
    actualValue, boost, btcUsd: 100000, btcUsdIndexedAt: NOW, counts: { powids: 94 }, events: [],
    indexedAt: NOW, ledgerGeneratedAt: NOW, snapshotId: CHECKPOINT.snapshotId,
    indexedThroughBlock: CHECKPOINT.blockHeight, indexedThroughBlockHash: CHECKPOINT.blockHash,
    network: "livenet", registry: { records: [], listings: [], sales: [], activity: [] },
    token: { tokens: [], mints: [], transfers: [], sales: [], listings: [] }, activity: { activity: [] },
    workFloor: { ...actualValue, actualValue, indexedAt: NOW, indexedThroughBlock: CHECKPOINT.blockHeight,
      indexedThroughBlockHash: CHECKPOINT.blockHash, snapshotId: CHECKPOINT.snapshotId, network: "livenet",
      chartPoints: [{ label: "Confirmed fixture", years: 0.3, networkValueSats: 21000000, networkValueQ8: "2100000000000000", floorSats: 1, floorQ8: "100000000" }] },
  };
  if (mode === "legacy") delete payload.boost;
  return payload;
}

async function openGrowth(page, mode = "ready") {
  await page.route("**/api/v1/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    const payload = growthFixture(mode);
    const json = path === "/api/v1/growth-summary" ? payload
      : path === "/api/v1/prices/btc-usd" ? { USD: 100000, usd: 100000, indexedAt: NOW }
      : path === "/api/v1/work-floor" ? payload.workFloor
      : path === "/api/v1/work-summary" ? { floor: payload.workFloor, token: payload.token, indexedAt: NOW }
      : { items: [], activity: [], records: [], tokens: [], indexedAt: NOW };
    await route.fulfill({ contentType: "application/json", body: JSON.stringify(json) });
  });
  await page.goto("/?growth=1");
  await expect(page.getByRole("combobox", { name: "Growth forecast" })).toBeVisible({ timeout: 45_000 });
}

test("Growth versions change the forecast and preserve canonical real value", async ({ page }) => {
  await openGrowth(page);
  const infinity = page.locator(".growth-product-card").filter({ has: page.getByRole("heading", { name: "Infinity", exact: true }) });
  const inception = page.locator(".growth-product-card").filter({ has: page.getByRole("heading", { name: "Inception", exact: true }) });
  const wallet = page.locator(".growth-product-card").filter({ has: page.getByRole("heading", { name: "Wallet", exact: true }) });
  for (const card of [infinity, inception, wallet]) {
    await expect(card).not.toContainText("Tracked");
    await expect(card).not.toContainText("Not modeled");
    await expect(card.locator(".growth-product-metrics > div").nth(1)).toContainText("proofs");
  }
  const boost = page.locator(".growth-product-card").filter({ has: page.getByRole("heading", { name: "Boost", exact: true }) });
  await expect(boost).toContainText("1 post");
  const real = page.locator(".growth-stat-grid > div").first();
  const beforeReal = await real.innerText();
  const model = page.locator(".growth-stat-grid > div").nth(1);
  const beforeModel = await model.innerText();
  await page.getByRole("combobox", { name: "Growth forecast" }).selectOption("legacy");
  await expect(boost).toContainText("Not modeled");
  await expect(infinity).toContainText("Not modeled");
  await expect(real).toHaveText(beforeReal, { useInnerText: true });
  await expect(model).not.toHaveText(beforeModel, { useInnerText: true });
  await page.getByRole("combobox", { name: "Growth forecast" }).selectOption("all-products");
  await expect(model).toHaveText(beforeModel, { useInnerText: true });
  await expect(real).toHaveText(beforeReal, { useInnerText: true });
  await boost.locator("summary").click();
  await expect(boost).toContainText("546 proofs");
  await expect(boost).toContainText("0.0000000000000001 WORK");
  await expect(boost).toContainText("Economic validation unavailable.");
  await expect(boost.getByRole("link", { name: "Open Boost" })).toHaveAttribute("href", "/?boost=1");
});

for (const mode of ["legacy", "mismatch"]) {
  test(`Growth keeps missing or mismatched Boost metrics unavailable: ${mode}`, async ({ page }) => {
    await openGrowth(page, mode);
    const boost = page.locator(".growth-product-card").filter({ has: page.getByRole("heading", { name: "Boost", exact: true }) });
    await expect(boost).toContainText("Unavailable");
    await expect(boost).not.toContainText("0 posts");
    await expect(page.locator(".growth-stat-grid > div").first()).toContainText("21,000,000");
  });
}

test("Boost details and assumptions fit a narrow Growth viewport", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await openGrowth(page);
  await page.locator(".growth-boost-details summary").click();
  await page.getByText("Usage, value, and blockspace assumptions", { exact: true }).click();
  await page.getByText("Where each app enters the model", { exact: true }).click();
  const coverage = page.locator(".growth-product-coverage");
  for (const name of ["Computer", "Desktop", "Boost", "Infinity", "Inception", "Wallet", "WORK"]) {
    await expect(coverage.getByRole("heading", { name, exact: true })).toBeVisible();
  }
  const widths = await page.evaluate(() => ({ viewport: innerWidth,
    document: document.documentElement.scrollWidth, body: document.body.scrollWidth }));
  expect(Math.max(widths.document, widths.body)).toBeLessThanOrEqual(widths.viewport + 1);
  await page.locator(".growth-boost-details").screenshot({ path: "/tmp/boost-growth-details-mobile.png" });
  await page.locator(".growth-model-details").screenshot({ path: "/tmp/all-product-growth-assumptions-mobile.png" });
});
