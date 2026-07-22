import { expect, test } from "@playwright/test";

const WORK_TOKEN_ID =
  "d4e5ebf11d104d6a63fb74e42094364b25a5f7199a09e5c0e71408972466a8b8";
const POWB_TOKEN_ID =
  "a3d0bc8528f91dfc52400a885bed7e49235396aa82aa9f95db41be629f1d5562";
const INCB_TOKEN_ID =
  "3cb25745f937f2b4e5508e5400189fe8fe679cd8e84bfa1e9176d70c9761f15d";
const VIEWPORT_WIDTHS = [
  768,
  860,
  861,
  1024,
  1100,
  1101,
  1180,
  1181,
  1440,
  1799,
  1800,
  1920,
];
const VIEWPORT_HEIGHT = 900;
const NOW = "2026-07-22T12:00:00.000Z";
const HASH = "1".repeat(64);
const MARKETPLACE_BASE_URL = (
  process.env.POW_MARKETPLACE_BASE_URL ||
  process.env.POW_UI_BASE_URL ||
  ""
).replace(/\/$/u, "");
const COMPUTER_BASE_URL = (
  process.env.POW_COMPUTER_BASE_URL ||
  process.env.POW_UI_BASE_URL ||
  ""
).replace(/\/$/u, "");

function surfaceUrl(baseUrl, path) {
  return baseUrl ? `${baseUrl}${path}` : path;
}

function tokenDefinition({ ticker, tokenId, registryAddress, uncapped = false }) {
  return {
    confirmed: true,
    confirmedMints: ticker === "WORK" ? 21_000 : 1,
    confirmedOpenListings: 0,
    confirmedSales: 0,
    confirmedSalesVolumeSats: 0,
    confirmedSupply: ticker === "WORK" ? 21_000_000 : "1000",
    createdAt: NOW,
    creatorAddress: "1L4xrDurN9VghknrbsSju2vQb6oXZe1Pbn",
    creationFeeSats: 1_000,
    decimals: ticker === "WORK" ? 8 : 0,
    holderCount: 1,
    maxSupply: uncapped ? null : 21_000_000,
    maxSupplyModel: uncapped ? "uncapped" : "fixed",
    mintAmount: ticker === "WORK" ? 1_000 : 1,
    mintPriceSats: 1_000,
    network: "livenet",
    openListings: 0,
    pendingMints: 0,
    pendingOpenListings: 0,
    pendingSales: 0,
    pendingSalesVolumeSats: 0,
    pendingSupply: 0,
    registryAddress,
    ticker,
    tokenId,
    transferCount: 0,
    txid: tokenId,
    uncapped,
    unitScale: ticker === "WORK" ? "100000000" : "1",
  };
}

const TOKENS = [
  tokenDefinition({
    registryAddress: "1638Vn6KtmK8p5r4oGvAXq9nmZb1emU1DV",
    ticker: "WORK",
    tokenId: WORK_TOKEN_ID,
  }),
  tokenDefinition({
    registryAddress: "1L4xrDurN9VghknrbsSju2vQb6oXZe1Pbn",
    ticker: "POWB",
    tokenId: POWB_TOKEN_ID,
    uncapped: true,
  }),
  tokenDefinition({
    registryAddress: "1L4xrDurN9VghknrbsSju2vQb6oXZe1Pbn",
    ticker: "INCB",
    tokenId: INCB_TOKEN_ID,
    uncapped: true,
  }),
];

const TOKEN_STATE = {
  authoritativeWallet: false,
  closedListings: [],
  creationSats: 3_000,
  holders: [],
  invalidEvents: [],
  listings: [],
  mints: [],
  pendingSupply: 0,
  sales: [],
  source: "responsive-layout-fixture",
  summaryOnly: false,
  tokens: TOKENS,
  transfers: [],
};

const REGISTRY_STATE = {
  activity: [],
  listings: [],
  pendingEvents: [],
  records: [],
  sales: [],
};

// Production-scale exact values make the rendered checks exercise the long
// numbers that exposed the original clipped metric-card regression.
const NETWORK_VALUE_EXACT = "1969375307586980910.74165320";
const NETWORK_VALUE = Number(NETWORK_VALUE_EXACT);
const NETWORK_VALUE_Q8 = "196937530758698091074165320";
const FLOOR_VALUE_EXACT = "93779776551.76099574";
const FLOOR_VALUE = Number(FLOOR_VALUE_EXACT);
const FLOOR_VALUE_Q8 = "9377977655176099574";
const WORK_ACCOUNTING_MODEL = "canonical-exact-work-network-q8-v1";

const WORK_ACTUAL_VALUE = {
  baseNetworkValueQ8: NETWORK_VALUE_Q8,
  baseNetworkValueSats: NETWORK_VALUE,
  baseNetworkValueSatsExact: NETWORK_VALUE_EXACT,
  baseTotalQ8: NETWORK_VALUE_Q8,
  baseTotalSats: NETWORK_VALUE,
  baseTotalSatsExact: NETWORK_VALUE_EXACT,
  creditMinerFeeAccountingModel: "canonical-unique-tx-input-output-v1",
  creditMinerFeeCoverage: {
    complete: true,
    confirmedEvents: 1,
    confirmedTransactions: 1,
    coveredConfirmedEvents: 1,
    coveredConfirmedTransactions: 1,
    missingConfirmedEvents: 0,
    missingConfirmedTransactions: 0,
    missingConfirmedTxids: [],
    source: "proof-indexer-normalized-input-output-totals",
  },
  floorQ8: FLOOR_VALUE_Q8,
  floorSats: FLOOR_VALUE,
  floorSatsExact: FLOOR_VALUE_EXACT,
  frozenFloorQ8: FLOOR_VALUE_Q8,
  frozenFloorSats: FLOOR_VALUE,
  frozenFloorSatsExact: FLOOR_VALUE_EXACT,
  frozenNetworkValueQ8: NETWORK_VALUE_Q8,
  frozenNetworkValueSats: NETWORK_VALUE,
  frozenNetworkValueSatsExact: NETWORK_VALUE_EXACT,
  frozenTotalQ8: NETWORK_VALUE_Q8,
  frozenTotalSats: NETWORK_VALUE,
  frozenTotalSatsExact: NETWORK_VALUE_EXACT,
  liveFloorQ8: FLOOR_VALUE_Q8,
  liveFloorSats: FLOOR_VALUE,
  liveFloorSatsExact: FLOOR_VALUE_EXACT,
  liveNetworkValueQ8: NETWORK_VALUE_Q8,
  liveNetworkValueSats: NETWORK_VALUE,
  liveNetworkValueSatsExact: NETWORK_VALUE_EXACT,
  liveTotalQ8: NETWORK_VALUE_Q8,
  liveTotalSats: NETWORK_VALUE,
  liveTotalSatsExact: NETWORK_VALUE_EXACT,
  networkValueQ8: NETWORK_VALUE_Q8,
  networkValueSats: NETWORK_VALUE,
  networkValueSatsExact: NETWORK_VALUE_EXACT,
  totalQ8: NETWORK_VALUE_Q8,
  totalSats: NETWORK_VALUE,
  totalSatsExact: NETWORK_VALUE_EXACT,
  workNetworkValueAccountingModel: WORK_ACCOUNTING_MODEL,
};

const WORK_FLOOR = {
  actualValue: WORK_ACTUAL_VALUE,
  chartPoints: [
    {
      floorQ8: FLOOR_VALUE_Q8,
      floorSats: FLOOR_VALUE,
      label: "Fixture",
      networkValueQ8: NETWORK_VALUE_Q8,
      networkValueSats: NETWORK_VALUE,
      years: 0,
    },
  ],
  floorQ8: FLOOR_VALUE_Q8,
  floorSats: FLOOR_VALUE,
  floorSatsExact: FLOOR_VALUE_EXACT,
  frozenFloorQ8: FLOOR_VALUE_Q8,
  frozenFloorSats: FLOOR_VALUE,
  frozenFloorSatsExact: FLOOR_VALUE_EXACT,
  frozenNetworkValueQ8: NETWORK_VALUE_Q8,
  frozenNetworkValueSats: NETWORK_VALUE,
  frozenNetworkValueSatsExact: NETWORK_VALUE_EXACT,
  indexedAt: NOW,
  indexedThroughBlock: 959_100,
  indexedThroughBlockHash: HASH,
  liveFloorQ8: FLOOR_VALUE_Q8,
  liveFloorSats: FLOOR_VALUE,
  liveFloorSatsExact: FLOOR_VALUE_EXACT,
  liveNetworkValueQ8: NETWORK_VALUE_Q8,
  liveNetworkValueSats: NETWORK_VALUE,
  liveNetworkValueSatsExact: NETWORK_VALUE_EXACT,
  network: "livenet",
  networkValueQ8: NETWORK_VALUE_Q8,
  networkValueSats: NETWORK_VALUE,
  networkValueSatsExact: NETWORK_VALUE_EXACT,
  powids: 1,
  snapshotId: "responsive-layout-fixture",
  stats: { indexedThroughBlock: 959_100 },
  tokenFlowSats: 0,
  totalQ8: NETWORK_VALUE_Q8,
  workNetworkValueAccountingModel: WORK_ACCOUNTING_MODEL,
};

function paginated(items = []) {
  return {
    end: items.length,
    hasMore: false,
    indexedAt: NOW,
    items,
    limit: 25,
    page: 0,
    snapshotId: "responsive-layout-fixture",
    start: 0,
    totalCount: items.length,
  };
}

async function installApiFixtures(page) {
  // Match HTTP API reads only. A broader `/api/` glob would also intercept
  // Vite's `/src/api/*.ts` JavaScript modules and prevent the app from loading.
  await page.route("**/api/v1/**", async (route) => {
    const url = new URL(route.request().url());
    const { pathname } = url;
    let json;

    if (pathname === "/api/v1/marketplace-summary") {
      json = {
        indexedAt: NOW,
        network: "livenet",
        registry: REGISTRY_STATE,
        summaryOnly: false,
        token: TOKEN_STATE,
        workFloor: WORK_FLOOR,
      };
    } else if (pathname === "/api/v1/work-summary") {
      json = {
        floor: WORK_FLOOR,
        indexedAt: NOW,
        network: "livenet",
        summaryOnly: false,
        token: TOKEN_STATE,
      };
    } else if (pathname === "/api/v1/work-floor") {
      json = WORK_FLOOR;
    } else if (pathname === "/api/v1/token-history") {
      json = paginated();
    } else if (
      pathname === "/api/v1/token" ||
      pathname === "/api/v1/token-summary"
    ) {
      json = TOKEN_STATE;
    } else if (
      pathname === "/api/v1/registry" ||
      pathname === "/api/v1/registry-summary"
    ) {
      json = REGISTRY_STATE;
    } else if (pathname === "/api/v1/prices/btc-usd") {
      json = { USD: 100_000, usd: 100_000 };
    } else if (pathname.endsWith("/status")) {
      json = {
        blockHash: HASH,
        blockHeight: 959_100,
        confirmed: true,
        status: "confirmed",
      };
    } else if (pathname.includes("-summary")) {
      json = {
        actualValue: {},
        indexedAt: NOW,
        network: "livenet",
        stats: {},
        token: TOKEN_STATE,
      };
    } else if (pathname.includes("history") || pathname.includes("/log")) {
      json = paginated();
    } else {
      json = {};
    }

    await route.fulfill({
      body: JSON.stringify(json),
      contentType: "application/json",
      status: 200,
    });
  });
}

async function assertNoDocumentOverflow(page, label) {
  const dimensions = await page.evaluate(() => ({
    bodyClientWidth: document.body.clientWidth,
    bodyScrollWidth: document.body.scrollWidth,
    documentClientWidth: document.documentElement.clientWidth,
    documentScrollWidth: document.documentElement.scrollWidth,
    innerWidth: window.innerWidth,
  }));
  expect(
    Math.max(dimensions.bodyScrollWidth, dimensions.documentScrollWidth),
    `${label} widened the document: ${JSON.stringify(dimensions)}`,
  ).toBeLessThanOrEqual(dimensions.innerWidth + 1);
}

async function assertElementContainsItsLayout(locator, label) {
  const dimensions = await locator.evaluate((element) => ({
    clientWidth: element.clientWidth,
    scrollWidth: element.scrollWidth,
  }));
  expect(
    dimensions.scrollWidth,
    `${label} clips horizontal content: ${JSON.stringify(dimensions)}`,
  ).toBeLessThanOrEqual(dimensions.clientWidth + 1);
}

async function assertFragmentOnOneRenderedLine(locator, fragment, label) {
  const result = await locator.evaluate((element, needle) => {
    const content = element.textContent ?? "";
    const startIndex = content.indexOf(needle);
    if (startIndex < 0) {
      return { found: false, lineCount: 0 };
    }

    const endIndex = startIndex + needle.length;
    const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
    let cursor = 0;
    let startNode;
    let startOffset = 0;
    let endNode;
    let endOffset = 0;

    while (walker.nextNode()) {
      const node = walker.currentNode;
      const length = node.textContent?.length ?? 0;
      const next = cursor + length;
      if (!startNode && startIndex >= cursor && startIndex <= next) {
        startNode = node;
        startOffset = startIndex - cursor;
      }
      if (!endNode && endIndex >= cursor && endIndex <= next) {
        endNode = node;
        endOffset = endIndex - cursor;
      }
      cursor = next;
    }

    if (!startNode || !endNode) {
      return { found: false, lineCount: 0 };
    }

    const range = document.createRange();
    range.setStart(startNode, startOffset);
    range.setEnd(endNode, endOffset);
    const lineTops = [];
    for (const rect of range.getClientRects()) {
      if (rect.width < 0.5 || rect.height < 0.5) {
        continue;
      }
      if (!lineTops.some((top) => Math.abs(top - rect.top) <= 1)) {
        lineTops.push(rect.top);
      }
    }

    return {
      clientWidth: element.clientWidth,
      found: true,
      lineCount: lineTops.length,
      scrollWidth: element.scrollWidth,
    };
  }, fragment);

  expect(result.found, `${label} exact fragment was not rendered`).toBe(true);
  expect(
    result.lineCount,
    `${label} numeric value split across lines: ${JSON.stringify(result)}`,
  ).toBe(1);
  expect(
    result.scrollWidth,
    `${label} overflows horizontally`,
  ).toBeLessThanOrEqual(result.clientWidth + 1);
}

async function assertComputerWorkExactMetrics(page, label) {
  const stats = page.locator(
    '.work-floor-metrics-card [aria-label="Live WORK floor"]',
  );
  await expect(
    stats,
    `${label} exact WORK floor metrics did not render`,
  ).toBeVisible();

  const checks = [
    ["Floor", "93,779,776,551.76099574"],
    ["Live network value", "1,969,375,307,586,980,910.7416532"],
    ["Frozen network value", "1,969,375,307,586,980,910.7416532"],
    ["Frozen floor", "93,779,776,551.76099574"],
  ];
  for (const [metricLabel, exactText] of checks) {
    const value = stats
      .getByText(metricLabel, { exact: true })
      .locator("xpath=..")
      .locator("strong");
    await expect(value, `${label} ${metricLabel} missing`).toHaveCount(1);
    await expect(value).toContainText(exactText);
    await assertFragmentOnOneRenderedLine(
      value,
      exactText,
      `${label} ${metricLabel}`,
    );
  }
}

async function assertTopbarGeometry(page, label, width) {
  const topbar = page.locator(".topbar");
  const brand = topbar.locator(".brand");
  const nav = topbar.locator(".domain-nav");
  const actions = topbar.locator(".topbar-actions");
  await expect(topbar, `${label} topbar did not render`).toBeVisible();
  await expect(brand, `${label} brand did not render`).toBeVisible();
  await expect(nav, `${label} app navigation did not render`).toBeVisible();
  await expect(actions, `${label} header actions did not render`).toBeVisible();

  const [brandBox, navBox, actionsBox] = await Promise.all([
    brand.boundingBox(),
    nav.boundingBox(),
    actions.boundingBox(),
  ]);
  expect(brandBox, `${label} brand has no geometry`).not.toBeNull();
  expect(navBox, `${label} app navigation has no geometry`).not.toBeNull();
  expect(actionsBox, `${label} header actions have no geometry`).not.toBeNull();
  expect(
    brandBox.x + brandBox.width,
    `${label} brand overlaps app navigation`,
  ).toBeLessThanOrEqual(navBox.x + 1);
  expect(
    navBox.x + navBox.width,
    `${label} app navigation overlaps header actions`,
  ).toBeLessThanOrEqual(actionsBox.x + 1);
  expect(
    actionsBox.x + actionsBox.width,
    `${label} header actions escape the viewport`,
  ).toBeLessThanOrEqual(width + 1);

  const links = nav.locator(".domain-nav-links");
  const menu = nav.locator(".app-menu-trigger");
  if (width <= 1799) {
    await expect(menu, `${label} compact app menu is missing`).toBeVisible();
    await expect(
      links,
      `${label} clipped desktop links are still active`,
    ).toBeHidden();
  } else {
    await expect(menu, `${label} compact app menu did not close`).toBeHidden();
    await expect(links, `${label} desktop app links are missing`).toBeVisible();
    await assertElementContainsItsLayout(links, `${label} desktop app links`);
  }
}

async function assertWorkMetricGeometry(
  page,
  label,
  {
    minimumCardWidth = 0,
    selector = ".marketplace-work-floor-card .token-floor-stats",
  } = {},
) {
  const stats = page.locator(selector);
  await expect(stats, `${label} WORK metrics did not render`).toBeVisible();
  await assertElementContainsItsLayout(stats, `${label} WORK metrics`);

  const cards = stats.locator(":scope > div");
  const cardCount = await cards.count();
  expect(cardCount, `${label} WORK metrics are empty`).toBeGreaterThan(0);
  const statsBox = await stats.boundingBox();
  expect(statsBox, `${label} WORK metrics have no geometry`).not.toBeNull();

  for (let index = 0; index < cardCount; index += 1) {
    const card = cards.nth(index);
    const value = card.locator("strong");
    const [cardBox, valueBox] = await Promise.all([
      card.boundingBox(),
      value.boundingBox(),
    ]);
    expect(cardBox, `${label} metric card ${index + 1} has no geometry`).not.toBeNull();
    expect(valueBox, `${label} metric value ${index + 1} has no geometry`).not.toBeNull();
    expect(
      cardBox.x + cardBox.width,
      `${label} metric card ${index + 1} escapes the metric grid`,
    ).toBeLessThanOrEqual(statsBox.x + statsBox.width + 1);
    expect(
      valueBox.x + valueBox.width,
      `${label} metric value ${index + 1} escapes its card`,
    ).toBeLessThanOrEqual(cardBox.x + cardBox.width + 1);
    if (minimumCardWidth > 0) {
      expect(
        cardBox.width,
        `${label} metric card ${index + 1} is too narrow for exact values`,
      ).toBeGreaterThanOrEqual(minimumCardWidth);
    }
    const wrapping = await value.evaluate((element) => {
      const style = getComputedStyle(element);
      return {
        overflowWrap: style.overflowWrap,
        wordBreak: style.wordBreak,
      };
    });
    expect(
      wrapping.overflowWrap,
      `${label} metric value ${index + 1} permits arbitrary digit breaks`,
    ).toBe("normal");
    expect(
      wrapping.wordBreak,
      `${label} metric value ${index + 1} permits broken words`,
    ).toBe("normal");
    await assertElementContainsItsLayout(
      card,
      `${label} metric card ${index + 1}`,
    );
    await assertElementContainsItsLayout(
      value,
      `${label} metric value ${index + 1}`,
    );
  }
}

async function assertComputerWorkspace(page, label, width) {
  await assertTopbarGeometry(page, label, width);
  const layout = page.locator(".mail-layout");
  await expect(layout, `${label} Computer shell did not render`).toBeVisible();
  const workspace = layout.locator(":scope > :not(.sidebar)");
  await expect(workspace, `${label} workspace did not render`).toHaveCount(1);
  await expect(workspace).toBeVisible();

  const [box, viewport] = await Promise.all([
    workspace.boundingBox(),
    page.evaluate(() => ({ height: window.innerHeight, width: window.innerWidth })),
  ]);
  expect(box, `${label} workspace has no geometry`).not.toBeNull();
  expect(box.x, `${label} workspace starts outside the viewport`).toBeLessThan(
    viewport.width,
  );
  expect(
    box.x + box.width,
    `${label} workspace extends beyond the viewport`,
  ).toBeLessThanOrEqual(viewport.width + 1);
  expect(box.width, `${label} workspace collapsed`).toBeGreaterThan(
    Math.min(320, viewport.width * 0.4),
  );
  await assertElementContainsItsLayout(workspace, `${label} workspace`);
  await assertNoDocumentOverflow(page, label);
}

async function openFixtureRoute(page, href, label) {
  await page.goto(href, { waitUntil: "domcontentloaded" });
  await expect(page.locator("#root"), `${label} root did not render`).not.toBeEmpty();
}

async function assertMarketplaceGeometry(page, mode, width) {
  const label = `Marketplace WORK ${mode} at ${width}px`;
  await assertTopbarGeometry(page, label, width);
  const tabs = page.locator(".work-marketplace-version-tabs");
  await expect(tabs, `${label} version controls did not render`).toBeVisible();

  if (mode === "V1") {
    await tabs.getByRole("button", { name: /V1 Relic/ }).click();
  }

  const panelHeading = mode === "V1" ? "Marketplace V1 Relic" : "Credit Sale Tickets";
  const panel = page
    .getByRole("heading", { exact: true, name: panelHeading })
    .locator("xpath=ancestor::section[1]");
  await expect(panel, `${label} panel did not render`).toBeVisible();

  const [tabsBox, panelBox] = await Promise.all([
    tabs.boundingBox(),
    panel.boundingBox(),
  ]);
  expect(tabsBox, `${label} tabs have no geometry`).not.toBeNull();
  expect(panelBox, `${label} panel has no geometry`).not.toBeNull();
  expect(tabsBox.height, `${label} tabs stretched vertically`).toBeLessThanOrEqual(96);
  expect(
    panelBox.y,
    `${label} panel is beside/behind its version controls`,
  ).toBeGreaterThanOrEqual(tabsBox.y + tabsBox.height - 1);

  await assertElementContainsItsLayout(tabs, `${label} version controls`);
  await assertElementContainsItsLayout(panel, `${label} panel`);
  await assertElementContainsItsLayout(
    page.locator(".token-market-content"),
    `${label} marketplace grid`,
  );
  await assertNoDocumentOverflow(page, label);

  if (width >= 1181) {
    await assertWorkMetricGeometry(page, label);
  }

  if (mode === "V1") {
    await expect(
      panel.locator(".token-market-row"),
      `${label} must render one 25-row page rather than all 94 relics`,
    ).toHaveCount(25);
    await expect(
      panel.locator('[aria-label="Marketplace V1 relic pagination"]'),
    ).toContainText("1-25 of 94");
  }
}

for (const mode of ["V2", "V1"]) {
  test(`standalone Marketplace WORK ${mode} geometry matrix`, async ({ page }) => {
    await installApiFixtures(page);
    for (const width of VIEWPORT_WIDTHS) {
      await test.step(`${width}px`, async () => {
        await page.setViewportSize({ height: VIEWPORT_HEIGHT, width });
        await openFixtureRoute(
          page,
          surfaceUrl(
            MARKETPLACE_BASE_URL,
            `/?marketplace=1&asset=${WORK_TOKEN_ID}`,
          ),
          `Marketplace WORK ${mode}`,
        );
        await assertMarketplaceGeometry(page, mode, width);
      });
    }
  });
}

const COMPUTER_ROUTES = [
  {
    folder: "marketplace",
    path: `/?folder=marketplace&asset=${WORK_TOKEN_ID}`,
  },
  { folder: "token", path: "/?folder=token" },
  { folder: "wallet", path: "/?folder=wallet" },
  { folder: "work", path: "/?folder=work" },
  { folder: "infinity", path: "/?folder=infinity" },
  { folder: "inception", path: "/?folder=inception" },
  { folder: "browser", path: "/?folder=browser" },
  { folder: "ids", path: "/?folder=ids" },
];

for (const route of COMPUTER_ROUTES) {
  test(`Computer ${route.folder} responsive boundary matrix`, async ({ page }) => {
    await installApiFixtures(page);
    for (const width of VIEWPORT_WIDTHS) {
      await test.step(`${width}px`, async () => {
        await page.setViewportSize({ height: VIEWPORT_HEIGHT, width });
        await openFixtureRoute(
          page,
          surfaceUrl(COMPUTER_BASE_URL, route.path),
          `Computer ${route.folder}`,
        );
        await assertComputerWorkspace(
          page,
          `Computer ${route.folder} at ${width}px`,
          width,
        );
        if (route.folder === "work") {
          await assertWorkMetricGeometry(
            page,
            `Computer WORK floor at ${width}px`,
            {
              minimumCardWidth: 280,
              selector: ".work-floor-metrics-card .token-floor-stats",
            },
          );
          if (width === 1024) {
            await assertComputerWorkExactMetrics(
              page,
              "Computer WORK floor at 1024px",
            );
          }
        }
      });
    }
  });
}
