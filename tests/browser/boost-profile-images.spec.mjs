import { expect, test } from "@playwright/test";
import { createHash } from "node:crypto";
import { Transaction, Psbt, address as bitcoinAddress } from "bitcoinjs-lib";
const ADDRESS = "1KNkUBREnfno2BeV7QsBf8XCWZN6YFfxPH";
const funding = new Transaction();
funding.addInput(Buffer.alloc(32, 1), 0);
funding.addOutput(bitcoinAddress.toOutputScript(ADDRESS), 100_000n);
const txid = "a".repeat(64);
const bytes = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aOt8AAAAASUVORK5CYII=", "base64");
const attachment = { name: "sun.png", mime: "image/png", size: bytes.length,
  sha256: createHash("sha256").update(bytes).digest("hex"), data: bytes.toString("base64url") };
const pointer = { ...attachment, data: undefined, txid, source: "confirmed-pwm1-attachment", positionX: 20, positionY: 70 };
async function fixture(page, { confirmed = true, corrupt = false } = {}) {
  await page.addInitScript(address => {
    window.unisat = { getAccounts: async () => [address], requestAccounts: async () => [address], getNetwork: async () => "livenet",
      on() {}, removeListener() {}, signPsbt: async hex => {
        window.testUnsignedPsbt = hex;
        await new Promise(resolve => { window.testCancelSigning = resolve; });
        throw new Error("Test canceled wallet signing");
      } };
  }, ADDRESS);
  await page.route("**/api/v1/**", route => {
    const path = new URL(route.request().url()).pathname;
    let json = { records: [], listings: [] };
    if (path.endsWith("/utxo") || path.endsWith("/utxos")) json = [{ txid: funding.getId(), vout: 0, value: 100_000, status: { confirmed: true } }];
    if (path === `/api/v1/tx/${funding.getId()}/hex`) json = { hex: funding.toHex() };
    if (path === `/api/v1/tx/${funding.getId()}/status`) json = { status: "confirmed" };
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
    const fee = dialog.getByLabel("Fee sat/vB");
    for (const preset of [0.1, 0.5, 1, 2]) {
      await dialog.getByRole("button", { name: `${preset} sat`, exact: true }).click();
      await expect(fee).toHaveValue(String(preset));
    }
    await fee.fill("0");
    await expect(dialog.getByRole("button", { name: "Publish images" })).toBeDisabled();
    await expect(dialog.getByRole("alert")).toContainText("at least 0.1");
    for (const value of ["0.35", "0.45", "0.12345678"]) {
      await fee.fill(value);
      expect(await fee.evaluate(el => el.checkValidity())).toBe(true);
    }
    await fee.fill("0.123456789");
    expect(await fee.evaluate(el => el.checkValidity())).toBe(false);
    const rate = width === 1440 ? 0.12345678 : 0.35;
    await fee.fill(String(rate));
    expect(await dialog.evaluate(el => el.scrollWidth <= el.clientWidth + 1)).toBe(true);
    await dialog.getByRole("button", { name: "Publish images" }).click();
    await expect.poll(() => page.evaluate(() => Boolean(window.testUnsignedPsbt))).toBe(true);
    await expect(fee).toBeDisabled();
    await expect(dialog.getByRole("button", { name: "2 sat", exact: true })).toBeDisabled();
    const psbt = Psbt.fromHex(await page.evaluate(() => window.testUnsignedPsbt));
    const outputs = psbt.txOutputs;
    const feePaid = 100_000 - Number(outputs.reduce((sum, output) => sum + output.value, 0n));
    const estimatedVbytes = 10 + 160 + outputs.reduce((sum, output) => sum + 8 + (output.script.length < 253 ? 1 : 3) + output.script.length, 0);
    expect(feePaid).toBe(Math.ceil(estimatedVbytes * rate));
    expect(outputs[0].value).toBe(546n);
    await page.evaluate(() => window.testCancelSigning());
    await expect(fee).toBeEnabled();
    await expect(dialog).toContainText("Test canceled wallet signing");
    await dialog.getByRole("button", { name: "Close", exact: true }).click();
    await expect(dialog).toHaveCount(0);
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
