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
  if (mode === "large") {
    for (const name of ["baseNetworkValue", "baseTotal", "frozenNetworkValue", "frozenTotal", "liveNetworkValue", "liveTotal", "networkValue", "total"]) {
      actualValue[`${name}Q8`] = "900719925474099312345678";
      actualValue[`${name}Sats`] = "9007199254740993.12345678";
      actualValue[`${name}SatsExact`] = "9007199254740993.12345678";
    }
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

async function openGrowth(page, mode = "ready", fromComputer = false) {
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
  if (fromComputer) {
    await page.goto("/");
    await page.getByRole("button",{name:"Insights",exact:true}).click();
    const growthLink=page.getByRole("menuitem",{name:/^Growth\b/});
    await expect(growthLink).toHaveAttribute("href","/?growth=1");
    await growthLink.click();
  } else await page.goto("/?growth=1");
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
  const boost = page.locator(".growth-product-card").filter({ has: page.getByRole("heading", { name: "Boost & Publish", exact: true }) });
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
    const boost = page.locator(".growth-product-card").filter({ has: page.getByRole("heading", { name: "Boost & Publish", exact: true }) });
    await expect(boost).toContainText("Unavailable");
    await expect(boost).not.toContainText("0 posts");
    await expect(page.locator(".growth-stat-grid > div").first()).toContainText("21,000,000");
  });
}

test("Boost details and assumptions fit a narrow Growth viewport", async ({ page }, testInfo) => {
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
  await page.locator(".growth-boost-details").screenshot({ path: testInfo.outputPath("boost-growth-details-mobile.png") });
  await page.locator(".growth-model-details").screenshot({ path: testInfo.outputPath("all-product-growth-assumptions-mobile.png") });
});


test("Growth keeps every exact large-value digit readable and copyable on mobile", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.context().grantPermissions(["clipboard-read", "clipboard-write"]);
  await openGrowth(page, "large");
  const metric = page.locator(".growth-stat-grid > div").first();
  const exact = "9,007,199,254,740,993.12345678";
  await expect(metric.locator("data")).toHaveAttribute("value", exact);
  const geometry = await metric.locator("data > span").evaluate((element) => ({
    whiteSpace: getComputedStyle(element).whiteSpace,
    scrollable: element.parentElement.scrollWidth >= element.parentElement.clientWidth,
    documentWidth: document.documentElement.scrollWidth,
    viewportWidth: window.innerWidth,
  }));
  expect(geometry.whiteSpace).toBe("nowrap");
  expect(geometry.scrollable).toBe(true);
  expect(geometry.documentWidth).toBeLessThanOrEqual(geometry.viewportWidth);
  await metric.getByText("Exact value", { exact: true }).click();
  await metric.getByRole("button", { name: "Copy exact value" }).click();
  await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toBe(`${exact} proofs`);
});

for (const width of [320, 768, 1440]) {
  test(`Growth overview and full surface directory fit ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await openGrowth(page, "large");
    const baseline = page.locator(".growth-baseline-details");
    await expect(baseline).not.toHaveAttribute("open", "");
    await baseline.locator("summary").focus();
    await page.keyboard.press("Enter");
    await expect(baseline).toHaveAttribute("open", "");
    await baseline.locator("summary").click();
    const metric = page.locator(".growth-stat-grid > div").first();
    await expect(metric.locator("data > span")).toContainText("E");
    await metric.locator("summary").focus();
    await page.keyboard.press("Enter");
    await expect(metric.locator("code")).toContainText("9,007,199,254,740,993.12345678");
    const directory = page.locator(".growth-coverage-grid");
    await expect(directory.locator(":scope > li")).toHaveCount(23);
    for (const name of ["DNS", "Permission", "Code", "Jobs", "Home", "Growth"]) {
      await expect(directory.getByRole("link", { name, exact: true })).toBeVisible();
    }
    const widths = await page.evaluate(() => ({ viewport: innerWidth, document: document.documentElement.scrollWidth }));
    expect(widths.document).toBeLessThanOrEqual(widths.viewport + 1);
  });
}

test("Current product scenario exposes scope and keeps October comparison unchanged", async ({ page }) => {
  await openGrowth(page);
  const select=page.getByRole("combobox",{name:"Growth forecast"});
  await expect(select).toHaveValue("all-products");
  await expect(select.locator("option:checked")).toHaveText("Current products · 2026-11-12");
  await expect(page.locator(".growth-model-card")).toContainText("historical assumption was 0.00001");
  const real=page.locator(".growth-stat-grid > div").first();
  const before=await real.innerText();
  const model=page.locator(".growth-stat-grid > div").nth(1);
  const beforeModel=await model.innerText();
  await page.getByRole("combobox",{name:"Growth scenario fee rate"}).selectOption("2");
  await expect(model).not.toHaveText(beforeModel,{useInnerText:true});
  await expect(real).toHaveText(before,{useInnerText:true});
  await page.getByRole("combobox",{name:"Growth scenario fee rate"}).selectOption("0.1");
  await expect(model).toHaveText(beforeModel,{useInnerText:true});

  const activity=page.getByRole("region",{name:"Current product scenario activity"});
  await expect(activity).toContainText("Permission records");
  await expect(activity).toContainText("Linked 4 MB publications");
  const dns=page.locator(".growth-product-card").filter({has:page.getByRole("heading",{name:"DNS",exact:true})});
  await expect(dns).not.toContainText("Not modeled");
  await select.selectOption("october");
  await expect(activity).toHaveCount(0);
  await expect(dns).toContainText("Not modeled");
  await expect(real).toHaveText(before,{useInnerText:true});
  await select.selectOption("legacy");
  await expect(real).toHaveText(before,{useInnerText:true});
  await select.selectOption("all-products");
  await expect(activity).toBeVisible();
  await expect(real).toHaveText(before,{useInnerText:true});
});

for(const theme of ["light","dark"]) {
  test(`Current Growth assumptions and selectors fit 320px short viewport in ${theme}`,async({page},testInfo)=>{
    await page.addInitScript(value=>localStorage.setItem("proofofwork-me-appearance-v1",value),theme);
    await page.setViewportSize({width:320,height:480});
    await openGrowth(page);
    await page.getByText("Usage, value, and blockspace assumptions",{exact:true}).click();
    await page.getByText("Where each app enters the model",{exact:true}).click();
    await expect(page.locator(".growth-model-details")).toContainText("44 transactions");
    await expect(page.locator(".growth-model-details")).toContainText("linked delivery moves to Files");
    const width=await page.evaluate(()=>({viewport:innerWidth,document:document.documentElement.scrollWidth}));
    expect(width.document).toBeLessThanOrEqual(width.viewport+1);
    await page.locator(".growth-model-card").screenshot({path:testInfo.outputPath(`current-growth-${theme}.png`)});
  });
}


test("Computer links to current Growth and preserves fee sensitivity without wallet signing", async ({page}) => {
  await openGrowth(page,"ready",true);
  await expect(page.getByRole("combobox",{name:"Growth forecast"})).toHaveValue("all-products");
  const real=page.locator(".growth-stat-grid > div").first();
  const before=await real.innerText();
  await page.getByRole("combobox",{name:"Growth scenario fee rate"}).selectOption("0.5");
  await expect(real).toHaveText(before,{useInnerText:true});
  await page.getByRole("combobox",{name:"Growth forecast"}).selectOption("october");
  await expect(page.getByRole("combobox",{name:"Growth scenario fee rate"})).toHaveCount(0);
  await page.getByRole("combobox",{name:"Growth forecast"}).selectOption("all-products");
  await expect(page.getByRole("combobox",{name:"Growth scenario fee rate"})).toHaveValue("0.5");
  await expect(real).toHaveText(before,{useInnerText:true});
});
