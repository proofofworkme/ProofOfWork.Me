import { expect, test } from "@playwright/test";

const ADDRESS = "1KNkUBREnfno2BeV7QsBf8XCWZN6YFfxPH";
const ID = "armyofyouth";
const NOW = "2026-09-05T07:00:00.000Z";
async function fixtures(page) {
  await page.addInitScript(({ address, id, now }) => {
    const refuseSigning = async () => { throw new Error("Layout fixture cannot sign or broadcast"); };
    window.unisat = { getAccounts: async () => [address], requestAccounts: async () => [address],
      getNetwork: async () => "livenet", on() {}, removeListener() {}, signPsbt: refuseSigning,
      signMessage: refuseSigning, pushPsbt: refuseSigning, pushTx: refuseSigning };
    localStorage.setItem("proofofwork.boost.profileIntent.v1", JSON.stringify({
      [`livenet:${address.toLowerCase()}`]: { address, id, network: "livenet", createdAt: now,
        message: "read-only layout fixture", signature: "fixture-not-a-signature" },
    }));
  }, { address: ADDRESS, id: ID, now: NOW });
  await page.route("**/api/v1/**", async (route) => {
    if (route.request().method() !== "GET") return route.abort("blockedbyclient");
    const url = new URL(route.request().url());
    let json = {};
    const records = [{ id: ID, ownerAddress: ADDRESS, receiveAddress: ADDRESS, confirmed: true, network: "livenet" },
      { id: "boost", ownerAddress: ADDRESS, receiveAddress: ADDRESS, confirmed: true, network: "livenet" }];
    if (url.pathname.includes("registry")) json = { records, listings: [], stats: { total: 2 }, indexedAt: NOW };
    else if (url.pathname.startsWith("/api/v1/id/")) json = { record: records[1] };
    else if (url.pathname === "/api/v1/boost") json = {
      complete: true, items: [], indexedAt: NOW, network: "livenet", snapshotId: "a".repeat(64),
      totalCount: 0, start: 0, end: 0, hasMore: false, nextCursor: "", stats: { total: 0, confirmed: 0, pending: 0 },
      signalStats: { totalSignalQ8: "0", proofSignalQ8: "0", workSignalValueQ8: "0", workSignalSubatoms: "0" },
      ...(url.searchParams.has("profile") ? { mode: "profile", profileSubject: { address: ADDRESS, query: ADDRESS,
        totalSignalQ8: "0", proofSignalQ8: "0", followerCount: 0, followingCount: 0 },
        profileTabs: { boosts: 0, replies: 0, purchased: 0, likes: 0, "replies-to": 0 } } : {}),
    };
    await route.fulfill({ json });
  });
}

for (const embedded of [false, true]) {
for (const width of embedded ? [1440, 390] : [1920, 1440, 1024, 960, 768, 390, 320]) {
  for (const profile of [false, true]) {
    test(`connected Boost ${embedded ? "embedded" : "standalone"} ${profile ? "profile" : "timeline"} controls fit at ${width}px`, async ({ page }, testInfo) => {
      await page.setViewportSize({ width, height: 1000 });
      await fixtures(page);
      await page.goto(`/?${embedded ? "folder=boost" : "boost=1"}${profile ? `&profile=${ADDRESS}` : ""}`);
      await expect(page.locator(".boost-feed-panel")).toBeVisible();
      const tools = page.getByRole("button", { name: "Tools", exact: true });
      if (await tools.isVisible()) await tools.click();
      const rail = page.locator(".boost-sidebar");
      await rail.getByRole("button", { name: "Connect", exact: true }).click();
      const select = rail.locator("select");
      await expect(select).toHaveValue(ID);
      await expect(rail.locator(".boost-action-panel-head")).toContainText(`${ID}@proofofwork.me`);
      await expect(rail.getByRole("button", { name: "Publish", exact: true })).toBeEnabled();
      expect(await select.locator("option:checked").textContent()).toBe(`${ID}@proofofwork.me`);
      const geometry = await rail.evaluate((element) => {
        const rect = element.getBoundingClientRect();
        return { width: element.clientWidth, scrollWidth: element.scrollWidth,
          controls: [...element.querySelectorAll("input,select,button,a.primary,a.secondary")]
            .filter((control) => control.getClientRects().length > 0).map((control) => {
              const box = control.getBoundingClientRect();
              return { name: control.textContent || control.getAttribute("placeholder"), height: box.height,
                left: box.left - rect.left, right: box.right - rect.right };
            }) };
      });
      expect(geometry.scrollWidth).toBeLessThanOrEqual(geometry.width + 1);
      for (const control of geometry.controls) {
        expect(control.left, control.name).toBeGreaterThanOrEqual(-1);
        expect(control.right, control.name).toBeLessThanOrEqual(1);
        expect(control.height, control.name).toBeGreaterThanOrEqual(43);
      }
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width + 1);
      await page.screenshot({ path: testInfo.outputPath("connected-layout.png") });
      if (await tools.isVisible()) {
        await select.focus();
        await page.keyboard.press("Escape");
        await expect(page.locator(".boost-tools-backdrop")).toHaveCount(0);
        await expect(tools).toBeFocused();
      }
    });
  }
}
}
