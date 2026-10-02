import { expect, test } from "@playwright/test";

const SUBJECT = "1KNkUBREnfno2BeV7QsBf8XCWZN6YFfxPH";
const OTHER = "1BoatSLRHtKNngkdXEeobR76b53LETtpyT";
async function fixtures(page, { displayName = "carbonz@proofofwork.me", unavailable = false } = {}) {
  await page.route("**/api/v1/**", async (route) => {
    if (route.request().method() !== "GET") return route.abort("blockedbyclient");
    const url = new URL(route.request().url());
    if (url.pathname !== "/api/v1/boost") return route.fulfill({ json: { records: [], listings: [] } });
    if (unavailable) return route.fulfill({ status: 503, json: { error: "Profile temporarily unavailable" } });
    const items = Array.from({ length: 12 }, (_, i) => ({
      authorAddress: i === 11 ? OTHER : SUBJECT, authorId: i === 11 ? "another" : "carbonz",
      confirmed: true, createdAt: "2026-09-27T12:00:00Z", kind: "boost-post",
      txid: (i + 1).toString(16).padStart(64, "0"),
      text: `Profile post ${i + 1}. ProofOfWork keeps the record.`,
      proofSignalQ8: "109200000000", totalSignalQ8: "109200000000", followerCount: 22,
    }));
    await route.fulfill({ json: {
      complete: true, network: "livenet", items, totalCount: items.length, hasMore: false,
      mode: "profile", indexedAt: "2026-09-27T12:00:00Z", stats: { total: 12, confirmed: 12, pending: 0 },
      profileSubject: { address: SUBJECT, id: "carbonz", displayName, query: SUBJECT,
        followerCount: 22, followingCount: 6, boostCount: 35, totalSignalQ8: "109200000000" },
      profileTabs: { boosts: 35, replies: 2, purchased: 0, likes: 3, "replies-to": 1 },
      signalStats: { proofSignalQ8: "109200000000", totalSignalQ8: "109200000000", workSignalSubatoms: "0" },
    } });
  });
}

for (const [width, embedded] of [[1920, false], [1440, false], [960, false], [768, false], [390, false], [320, false], [1440, true], [390, true]]) {
  test(`profile hierarchy and actions fit ${width}px ${embedded ? "Computer" : "standalone"}`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height: 1000 });
    await fixtures(page);
    await page.goto(`/?${embedded ? "folder=boost" : "boost=1"}&profile=carbonz`);
    const surface = page.locator(".boost-profile-surface");
    const header = surface.locator(".boost-profile-titlebar");
    await expect(header).toContainText("35 Boosts");
    await expect(surface.locator(".boost-profile-copy h2")).toHaveText("carbonz");
    await expect(surface.locator(".boost-profile-copy > p")).toHaveText("@carbonz");
    await expect(surface.getByLabel("Profile connections")).toHaveText("6 Following22 Followers");
    await expect(surface.locator(".boost-profile-main > .boost-follow-button")).toHaveCount(1);
    await expect(surface.getByTestId("boost-post").first().locator(".boost-follow-button")).toHaveCount(0);
    await expect(surface.getByTestId("boost-post").last().locator(".boost-follow-button")).toHaveCount(1);
    const discovery = surface.locator(".boost-discovery-details");
    if (!(await discovery.getAttribute("open") !== null)) await discovery.locator("summary").click();
    const suggestions = surface.locator(".boost-rail-panel").filter({ hasText: "Who To Follow" });
    await expect(suggestions).not.toContainText("carbonz");
    await expect(suggestions).toContainText("another");
    const bounds = await surface.evaluate((element) => {
      const panel = element.querySelector(".boost-feed-panel").getBoundingClientRect();
      const banner = element.querySelector(".boost-profile-cover").getBoundingClientRect();
      const avatar = element.querySelector(".boost-profile-avatar").getBoundingClientRect();
      return { surface: element.clientWidth, panel: panel.width, banner: { width: banner.width, height: banner.height }, avatar: { width: avatar.width, top: avatar.top, bottom: avatar.bottom }, bannerBottom: banner.bottom };
    });
    expect(bounds.panel).toBeLessThanOrEqual(640);
    expect(bounds.banner.width / bounds.banner.height).toBeCloseTo(3, 1);
    expect(bounds.avatar.width).toBe(bounds.surface <= 600 ? 96 : 128);
    expect(bounds.avatar.top).toBeLessThan(bounds.bannerBottom);
    expect(bounds.avatar.bottom).toBeGreaterThan(bounds.bannerBottom);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width + 1);
    const toolbar = surface.locator(".boost-feed-toolbar");
    await expect(toolbar.getByRole("combobox", { name: "Boost sort" })).toBeVisible();
    await expect(toolbar.getByRole("combobox", { name: "Boost value window" })).toBeVisible();
    await expect(toolbar.getByRole("button", { name: "Refresh", exact: true })).toHaveCount(embedded ? 1 : 0);
    const sortRequest = page.waitForRequest(request => new URL(request.url()).searchParams.get("sort") === "newest");
    await toolbar.getByRole("combobox", { name: "Boost sort" }).selectOption("newest");
    expect(new URL((await sortRequest).url()).searchParams.get("profile")).toBe("carbonz");
    const periodRequest = page.waitForRequest(request => new URL(request.url()).searchParams.get("window") === "week");
    await toolbar.getByRole("combobox", { name: "Boost value window" }).selectOption("week");
    await periodRequest;
    await expect(header).toContainText("35 Boosts");
    const searchButton = header.getByRole("button", { name: "Search this profile" });
    await searchButton.click();
    const search = surface.getByRole("textbox", { name: "Search this profile" });
    await expect(search).toBeFocused();
    const searchRequest = page.waitForRequest(request => new URL(request.url()).searchParams.get("q") === "proof");
    await search.fill("proof");
    expect(new URL((await searchRequest).url()).searchParams.get("profile")).toBe("carbonz");
    if (bounds.surface <= 1120) {
      await page.keyboard.press("Escape");
      await expect(searchButton).toBeFocused();
    }
    await surface.locator(".boost-profile-identity > summary").click();
    await expect(surface.locator(".boost-profile-identity")).toContainText("carbonz@proofofwork.me");
    await expect(surface.locator(".boost-profile-identity")).toContainText(SUBJECT);
    await surface.locator(".boost-profile-identity > summary").click();
    await page.evaluate(() => { document.activeElement?.blur(); window.scrollTo(0, 0); });
    await page.screenshot({ path: testInfo.outputPath("profile.png") });
    if (!embedded) {
      await page.evaluate(() => window.scrollTo(0, 700));
      const titleRect = await header.boundingBox();
      expect(titleRect.y).toBeGreaterThanOrEqual(0);
      expect(titleRect.y).toBeLessThan(180);
    }
    const backHref = await header.getByRole("link", { name: "Back to timeline" }).getAttribute("href");
    const backParams = new URL(backHref, page.url()).searchParams;
    expect(backParams.get(embedded ? "folder" : "boost")).toBe(embedded ? "boost" : "1");
    expect(backParams.has(embedded ? "boost" : "folder")).toBe(false);
  });
}

test("explicit display names remain intact and unavailable counts are not invented", async ({ page }) => {
  await fixtures(page, { displayName: "Carbonz Studio" });
  await page.goto("/?boost=1&profile=carbonz");
  await expect(page.locator(".boost-profile-copy h2")).toHaveText("Carbonz Studio");
  await expect(page.locator(".boost-profile-titlebar")).toContainText("Carbonz Studio");
  await page.unrouteAll();
  await fixtures(page, { unavailable: true });
  await page.reload();
  await expect(page.locator(".boost-profile-titlebar")).toContainText("— Boosts");
  await expect(page.getByLabel("Profile connections")).toHaveText("— Following— Followers");
  await expect(page.locator(".boost-public-app .app-status-row")).toHaveClass(/bad/);
});
