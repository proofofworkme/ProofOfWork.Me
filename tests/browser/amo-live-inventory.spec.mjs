import { expect, test } from "@playwright/test";

// Opt-in, read-only verification against the actual first-party API.
const live = process.env.POW_AMO_LIVE === "1";
const WORK = "d4e5ebf11d104d6a63fb74e42094364b25a5f7199a09e5c0e71408972466a8b8";
const POWB = "a3d0bc8528f91dfc52400a885bed7e49235396aa82aa9f95db41be629f1d5562";
const INCB = "3cb25745f937f2b4e5508e5400189fe8fe679cd8e84bfa1e9176d70c9761f15d";
for (const route of ["/?marketplace=1", `/?marketplace=1&asset=${WORK}`, `/?folder=marketplace&asset=${WORK}`]) {
  test(`live complete AMO inventory ${route}`, async ({ page }, testInfo) => {
    test.skip(!live, "Set POW_AMO_LIVE=1 with a first-party API-backed server");
    test.setTimeout(300_000);
    const pages = [];
    const pending = [];
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    page.on("response", (response) => {
      const url = new URL(response.url());
      if (url.pathname.endsWith("/api/v1/token-history") && url.searchParams.get("kind") === "listings" && response.ok()) {
        pending.push(response.json().then((payload) => pages.push(payload)));
      }
    });
    await page.goto(route);
    const verification = page.getByLabel("AMO summary verification");
    await expect(verification).toHaveAttribute("data-state", "ready", { timeout: 240_000 });
    await Promise.all(pending);
    const last = pages.findLast((entry) => entry.hasMore === false);
    expect(last).toBeTruthy();
    const bookPages = pages.filter((entry) => entry.snapshotId === last.snapshotId);
    const rows = [...new Map(bookPages.flatMap((entry) => entry.items).map((item) => [item.listingId, item])).values()];
    expect(rows.length).toBe(last.totalCount);
    expect(rows.length).toBeGreaterThan(40);
    const tabs = page.getByLabel("AMO asset tabs");
    await tabs.getByRole("button", { name: /^Credits/u }).click();
    if (!route.includes("asset=")) {
      await page.getByRole("button", { name: "Market", exact: true }).first().click();
    }
    const search = page.getByPlaceholder("Search sale tickets, sellers, txids");
    await expect(search).toBeVisible();
    if (route.includes("asset=")) {
      const work = rows.filter((item) => item.tokenId === WORK);
      await search.fill(work.at(-1).listingId);
      await expect(page.locator("#credit-market-book .token-market-row")).toHaveCount(1);
      await search.fill("");
    }
    for (const width of [390, 1280, 1920]) {
      await page.setViewportSize({ width, height: 1080 });
      await expect.poll(() => page.locator(".token-market-row dd:visible").evaluateAll(
        (fields) => fields.filter((field) => field.scrollWidth > field.clientWidth + 1).length,
      )).toBe(0);
    }
    await tabs.getByRole("button", { name: /^Bonds/u }).click();
    for (const [label, ticker, id] of [["Inception", "INCB", INCB], ["Infinity", "POWB", POWB]]) {
      const count = rows.filter((row) => row.tokenId === id).length;
      const tab = page.getByLabel("Bond listing tabs").getByRole("button", { name: new RegExp(`^${label}\\s*${count}$`) });
      await expect(tab).toBeVisible();
      await tab.click();
      const market = page.getByLabel(`${ticker} sale-ticket market`);
      await expect(market).toBeVisible();
      await expect(market).toContainText(`proofs / ${ticker}`, { timeout: 90_000 });
      await expect(market).not.toContainText("Verifying reference");
    }
    await page.screenshot({ path: testInfo.outputPath("complete-bond-market.png"), fullPage: true });
    expect(errors).toEqual([]);
    console.log(JSON.stringify({ route, total: rows.length, pages: bookPages.length,
      work: rows.filter((row) => row.tokenId === WORK).length,
      powb: rows.filter((row) => row.tokenId === POWB).length,
      incb: rows.filter((row) => row.tokenId === INCB).length }));
  });
}
