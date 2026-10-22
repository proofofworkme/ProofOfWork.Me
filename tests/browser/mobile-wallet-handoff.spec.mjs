import { expect, test } from "@playwright/test";

const android = "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36";
const address = "bc1qvst5k9cr82guxz53wkmt6yll8xd8lk5qpeq5ur";

async function unavailableApi(page) {
  await page.route("**/api/**", route => /^\/(?:test-api\/)?api\//u.test(new URL(route.request().url()).pathname)
    ? route.fulfill({ status: 503, json: { error: "Fixture chain data unavailable." } }) : route.fallback());
}

async function provider(page) {
  await page.addInitScript(address => {
    window.__connectionCalls = 0;
    window.__signatureCalls = 0;
    let approved = false;
    window.unisat = {
      getAccounts: async () => approved ? [address] : [],
      requestAccounts: async () => { window.__connectionCalls++; approved = true; return [address]; },
      getChain: async () => ({ enum: "BITCOIN_MAINNET" }),
      on() {}, removeListener() {},
      signPsbt: async () => { window.__signatureCalls++; throw new Error("Must not sign"); },
    };
  }, address);
}

test.describe("mobile handoff", () => {
  test.use({ userAgent: android, viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  test.beforeEach(async ({ page }) => unavailableApi(page));

  for (const route of ["/?wallet=1", "/?folder=wallet", "/?folder=inbox", "/?id-launch=1", "/?dns-launch=1", "/?boost=1", "/?publish=1", "/?code=1", "/?jobs=1", "/?permission=1", "/?pages=1", "/?marketplace=1", "/?work=1", "/?token=1", "/?infinity=1", "/?inception=1"]) {
    test(`${route}: opens the current public destination without asserting connection`, async ({ page }) => {
      await page.goto(route);
      await page.getByRole("button", { name: "Open in UniSat", exact: true }).first().click();
      const dialog = page.getByRole("dialog", { name: "Continue in UniSat" });
      await expect(dialog).toBeVisible();
      await expect(dialog).toContainText("This browser stays disconnected");
      const href = await dialog.getByRole("link", { name: "Open in UniSat", exact: true }).getAttribute("href");
      const link = new URL(href);
      expect(link.origin).toBe("https://app.unisat.cloud");
      expect(link.searchParams.get("method")).toBe("openDapp");
      expect(JSON.parse(Buffer.from(link.searchParams.get("data"), "base64").toString())).toEqual([page.url().split("#")[0]]);
      await expect(dialog.getByRole("link", { name: "Install UniSat" })).toHaveAttribute("href", "https://unisat.io/download");
      await expect(page.getByRole("button", { name: "Disconnect UniSat" })).toHaveCount(0);
      await page.keyboard.press("Escape");
      await expect(dialog).toHaveCount(0);
      await expect(page.getByRole("button", { name: "Open in UniSat", exact: true }).first()).toBeFocused();
    });
  }

  test("handoff navigation uses the app link and returning does not connect or clear storage", async ({ page }) => {
    await page.goto("/?wallet=1&draft=private#private");
    await page.evaluate(() => localStorage.setItem("handoff-preservation-test", "local draft evidence"));
    await page.getByRole("button", { name: "Open in UniSat", exact: true }).first().click();
    await page.route("https://app.unisat.cloud/request?**", route => route.fulfill({ contentType: "text/html", body: "App-link navigation intercepted; no native wallet is running." }));
    await page.getByRole("dialog").getByRole("link", { name: "Open in UniSat", exact: true }).click();
    await expect(page).toHaveURL(/^https:\/\/app\.unisat\.cloud\/request\?/u);
    const target = JSON.parse(Buffer.from(new URL(page.url()).searchParams.get("data"), "base64").toString())[0];
    expect(target).not.toContain("private");
    await page.goBack();
    await expect(page.getByRole("button", { name: "Open in UniSat", exact: true }).first()).toBeVisible();
    expect(await page.evaluate(() => localStorage.getItem("handoff-preservation-test"))).toBe("local draft evidence");
    await expect(page.getByRole("button", { name: "Disconnect UniSat" })).toHaveCount(0);
  });

  test("a mobile injected provider uses normal explicit approval, without handoff or signing", async ({ page }) => {
    await provider(page);
    await page.goto("/?wallet=1");
    await expect(page.getByRole("button", { name: "Open in UniSat", exact: true })).toHaveCount(0);
    expect(await page.evaluate(() => window.__connectionCalls)).toBe(0);
    await page.getByRole("button", { name: "Connect UniSat", exact: true }).click();
    await expect(page.getByRole("button", { name: "Disconnect UniSat" })).toBeVisible();
    expect(await page.evaluate(() => [window.__connectionCalls, window.__signatureCalls])).toEqual([1, 0]);
  });

  test("a provider injected after page load replaces the handoff on return", async ({ page }) => {
    await page.goto("/?wallet=1");
    await expect(page.getByRole("button", { name: "Open in UniSat", exact: true })).toBeVisible();
    await page.evaluate(() => {
      window.unisat = { getAccounts: async () => [], getChain: async () => ({ enum: "BITCOIN_MAINNET" }) };
      window.dispatchEvent(new Event("focus"));
    });
    await expect(page.getByRole("button", { name: "Open in UniSat", exact: true })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Connect UniSat", exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "Disconnect UniSat" })).toHaveCount(0);
  });

  test("handoff reads the latest workspace URL rather than the initial page", async ({ page }) => {
    await page.goto("/?folder=wallet");
    await expect(page.getByRole("button", { name: "Open in UniSat", exact: true })).toBeVisible();
    await page.evaluate(() => history.replaceState(history.state, "", "/?folder=contacts&network=testnet4"));
    await page.getByRole("button", { name: "Open in UniSat", exact: true }).click();
    const href = await page.getByRole("dialog").getByRole("link", { name: "Open in UniSat", exact: true }).getAttribute("href");
    expect(JSON.parse(Buffer.from(new URL(href).searchParams.get("data"), "base64").toString())).toEqual([page.url()]);
  });

  test("Publish handoff cancellation retains the exact draft and keyboard focus", async ({ page }) => {
    await page.goto("/?publish=1&write=1");
    const text = "A local draft. Café 🧭.  \n";
    await page.getByRole("textbox", { name: "Article text", exact: true }).fill(text);
    const open = page.locator(".publish-composer").getByRole("button", { name: "Open in UniSat", exact: true });
    await open.click();
    const dialog = page.getByRole("dialog");
    await expect(dialog).toContainText("They do not move with you");
    await dialog.getByRole("button", { name: "Close", exact: true }).focus();
    await page.keyboard.press("Shift+Tab");
    await expect(dialog.getByRole("link", { name: "Open in UniSat", exact: true })).toBeFocused();
    await page.keyboard.press("Tab");
    await expect(dialog.getByRole("button", { name: "Close", exact: true })).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(open).toBeFocused();
    await expect(page.getByRole("textbox", { name: "Article text", exact: true })).toHaveValue(text);
  });

  for (const [width, height, colorScheme] of [[320, 568, "dark"], [390, 844, "light"], [740, 360, "dark"]]) {
    test(`handoff layout ${width}x${height} ${colorScheme}`, async ({ page }) => {
      await page.setViewportSize({ width, height });
      await page.emulateMedia({ colorScheme, reducedMotion: "reduce" });
      await page.goto("/?folder=wallet");
      await page.getByRole("button", { name: "Open in UniSat", exact: true }).first().click();
      const dialog = page.getByRole("dialog");
      await expect(dialog).toBeVisible();
      expect(await dialog.evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true);
      await dialog.getByRole("link", { name: "Open in UniSat", exact: true }).scrollIntoViewIfNeeded();
      await expect(dialog.getByRole("link", { name: "Open in UniSat", exact: true })).toBeInViewport();
      await page.screenshot({ path: `/tmp/unisat-handoff-${width}-${colorScheme}.png` });
    });
  }
});

test.describe("desktop unchanged", () => {
  test.beforeEach(async ({ page }) => unavailableApi(page));
  test("without a provider the original install link remains", async ({ page }) => {
    await page.goto("/?wallet=1");
    await expect(page.getByRole("link", { name: "Install UniSat", exact: true })).toHaveAttribute("href", "https://unisat.io/download");
    await expect(page.getByRole("button", { name: "Open in UniSat", exact: true })).toHaveCount(0);
  });
  test("with a provider the original connection remains", async ({ page }) => {
    await provider(page);
    await page.goto("/?wallet=1");
    await page.getByRole("button", { name: "Connect UniSat", exact: true }).click();
    await expect(page.getByRole("button", { name: "Disconnect UniSat" })).toBeVisible();
    expect(await page.evaluate(() => [window.__connectionCalls, window.__signatureCalls])).toEqual([1, 0]);
  });
});
