import { expect, test } from "@playwright/test";
import { createHash } from "node:crypto";
const ADDRESS = "1KNkUBREnfno2BeV7QsBf8XCWZN6YFfxPH";
const txid = "a".repeat(64);
const bytes = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aOt8AAAAASUVORK5CYII=", "base64");
const attachment = { name: "sun.png", mime: "image/png", size: bytes.length,
  sha256: createHash("sha256").update(bytes).digest("hex"), data: bytes.toString("base64url") };
const pointer = { ...attachment, data: undefined, txid, source: "confirmed-pwm1-attachment", positionX: 20, positionY: 70 };
async function fixture(page, { confirmed = true, corrupt = false } = {}) {
  await page.addInitScript(address => {
    window.unisat = { getAccounts: async () => [address], requestAccounts: async () => [address], getNetwork: async () => "livenet",
      on() {}, removeListener() {}, signPsbt: async () => { throw new Error("Test cannot sign"); } };
  }, ADDRESS);
  await page.route("**/api/v1/**", route => {
    const path = new URL(route.request().url()).pathname;
    let json = { records: [], listings: [] };
    if (path.endsWith("/mail")) json = { inboxMessages: [{ txid, confirmed: true, attachment },
      { txid: "b".repeat(64), confirmed: false, attachment: { ...attachment, name: "pending.png" } }], sentMessages: [{ txid, status: "confirmed", attachment }] };
    if (path === `/api/v1/tx/${txid}`) json = { tx: { status: { confirmed } }, attachment: corrupt ? { ...attachment, data: "bad" } : attachment };
    if (path === "/api/v1/boost") json = { complete: true, network: "livenet", items: [], totalCount: 0, hasMore: false,
      stats: { total: 0, confirmed: 0, pending: 0 }, profileSubject: { address: ADDRESS, id: "armyofyouth", displayName: "armyofyouth",
        boostCount: 0, followerCount: 0, followingCount: 0, totalSignalQ8: "0", profile: { address: ADDRESS, image: pointer, banner: pointer } },
      profileTabs: { boosts: 0, replies: 0, purchased: 0, likes: 0, "replies-to": 0 } };
    return route.fulfill({ json });
  });
}
for (const width of [1440, 390]) {
  test(`profile images load verified files and picker previews crop at ${width}`, async ({ page }) => {
    await page.setViewportSize({ width, height: 950 }); await fixture(page);
    await page.goto(`/?boost=1&profile=${ADDRESS}`);
    await expect(page.locator("img.boost-profile-avatar")).toBeVisible();
    await expect(page.locator("img.boost-profile-cover")).toBeVisible();
    expect(await page.locator(".boost-profile-avatar").evaluate(el => getComputedStyle(el).objectPosition)).toBe("20% 70%");
    const tools = page.getByRole("button", { name: "Tools", exact: true });
    if (await tools.isVisible()) await tools.click();
    await page.locator(".boost-sidebar").getByRole("button", { name: "Connect", exact: true }).click();
    await page.getByRole("button", { name: "Profile images", exact: true }).click();
    const dialog = page.locator("dialog"); await expect(dialog).toBeVisible();
    await expect(dialog.getByRole("button", { name: "sun.png" })).toHaveCount(1);
    await expect(dialog).not.toContainText("pending.png");
    await dialog.getByRole("button", { name: "sun.png" }).click();
    await expect(dialog.getByAltText("Profile picture preview")).toBeVisible();
    await dialog.getByLabel("Horizontal crop").fill("30");
    expect(await dialog.getByAltText("Profile picture preview").evaluate(el => getComputedStyle(el).objectPosition)).toBe("30% 50%");
    await dialog.getByRole("button", { name: "Banner", exact: true }).click();
    await dialog.getByRole("button", { name: "sun.png" }).click();
    await expect(dialog.getByAltText("Banner preview")).toBeVisible();
    await expect(dialog.getByRole("button", { name: "Publish images" })).toBeEnabled();
    expect(await dialog.evaluate(el => el.scrollWidth <= el.clientWidth + 1)).toBe(true);
    await page.keyboard.press("Escape"); await expect(dialog).toHaveCount(0);
  });
}
for (const options of [{ confirmed: false }, { corrupt: true }]) {
  test(`unverified profile files fall back opaquely ${JSON.stringify(options)}`, async ({ page }) => {
    await fixture(page, options); await page.goto(`/?boost=1&profile=${ADDRESS}`);
    await expect(page.locator(".boost-profile-avatar")).toHaveText("AR");
    await expect(page.locator("img.boost-profile-avatar")).toHaveCount(0);
    const background = await page.locator(".boost-profile-avatar").evaluate(el => getComputedStyle(el).backgroundColor);
    expect(background).toMatch(/^rgb\(/);
  });
}
