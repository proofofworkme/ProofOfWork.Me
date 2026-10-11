import { expect, test } from "@playwright/test";

const STORAGE_KEY = "proofofwork-me-appearance-v1";

async function fixture(page) {
  await page.route("**/api/**", route => {
    if (!/^\/(?:test-api\/)?api\//u.test(new URL(route.request().url()).pathname)) return route.continue();
    return route.fulfill({ status: 503, json: { error: "Appearance fixture has no verified data for this read" } });
  });
}

async function choose(page, label) {
  await page.getByRole("button", { name: /^Appearance: /u }).click();
  await page.getByRole("menuitemradio", { name: label, exact: true }).click();
  await expect(page.getByRole("button", { name: `Appearance: ${label}`, exact: true })).toBeFocused();
}

async function expectTheme(page, theme, preference = theme) {
  await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
  await expect(page.locator("html")).toHaveAttribute("data-appearance", preference);
  await expect(page.locator("html")).toHaveCSS("background-color", theme === "dark" ? "rgb(33, 33, 33)" : "rgb(247, 247, 245)");
  await expect(page.locator('meta[name="theme-color"]').first()).toHaveAttribute("content", theme === "dark" ? "#212121" : "#f7f7f5");
}

test("appearance overrides the system, survives reload, and preserves an unsent Browser address", async ({ page }) => {
  await fixture(page);
  await page.emulateMedia({ colorScheme: "dark" });
  await page.goto("/?folder=browser");
  await expectTheme(page, "dark", "system");
  const address = page.getByLabel("Transaction ID or .pow name", { exact: true });
  await address.fill("unsent.pow");
  await choose(page, "Light");
  await expectTheme(page, "light");
  await expect(address).toHaveValue("unsent.pow");
  await page.emulateMedia({ colorScheme: "light" });
  await choose(page, "Dark");
  await expectTheme(page, "dark");
  await expect(address).toHaveValue("unsent.pow");
  await page.emulateMedia({ colorScheme: "dark" });
  await page.emulateMedia({ colorScheme: "light" });
  await expectTheme(page, "dark");
  await page.reload();
  await expectTheme(page, "dark");
  await choose(page, "System");
  await expectTheme(page, "light", "system");
  await page.emulateMedia({ colorScheme: "dark" });
  await expectTheme(page, "dark", "system");
});

test("saved appearance is applied before the application module starts", async ({ page }) => {
  await page.addInitScript(key => localStorage.setItem(key, "dark"), STORAGE_KEY);
  await page.emulateMedia({ colorScheme: "light" });
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  await page.route("**/src/main.tsx*", async route => { await gate; await route.continue(); });
  try {
    await page.goto("/?landing=1", { waitUntil: "commit" });
    await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
    await expect(page.locator("html")).toHaveAttribute("data-appearance", "dark");
    await expect(page.locator("#root")).toBeEmpty();
  } finally { release(); }
});

test("appearance menu supports keyboard selection, dismissal, and 320px touch targets", async ({ page }) => {
  await fixture(page);
  await page.setViewportSize({ width: 320, height: 700 });
  await page.goto("/?folder=browser");
  const trigger = page.getByRole("button", { name: /^Appearance: /u });
  await trigger.focus();
  await page.keyboard.press("ArrowDown");
  await expect(page.getByRole("menuitemradio", { name: "System", exact: true })).toBeFocused();
  await page.keyboard.press("Home");
  await expect(page.getByRole("menuitemradio", { name: "Light", exact: true })).toBeFocused();
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("Enter");
  await expectTheme(page, "dark");
  await trigger.click();
  const menu = page.getByRole("menu", { name: "Appearance", exact: true });
  const box = await menu.boundingBox();
  expect(box.x).toBeGreaterThanOrEqual(0);
  expect(box.x + box.width).toBeLessThanOrEqual(320);
  const target = await trigger.boundingBox();
  expect(target.width).toBeGreaterThanOrEqual(44);
  expect(target.height).toBeGreaterThanOrEqual(44);
  await page.keyboard.press("Escape");
  await expect(menu).toHaveCount(0);
  await expect(trigger).toBeFocused();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});

for (const storage of ["invalid", "blocked"]) {
  test(`${storage} persistence leaves the default and manual appearance usable`, async ({ page }) => {
    await page.addInitScript(({ key, storage }) => {
      if (storage === "invalid") localStorage.setItem(key, "ultraviolet");
      else {
        const get = Storage.prototype.getItem;
        const set = Storage.prototype.setItem;
        Storage.prototype.getItem = function (value) {
          if (value === key) throw new Error("Fixture blocks appearance reads");
          return get.call(this, value);
        };
        Storage.prototype.setItem = function (value, content) {
          if (value === key) throw new Error("Fixture blocks appearance writes");
          return set.call(this, value, content);
        };
      }
    }, { key: STORAGE_KEY, storage });
    await fixture(page);
    await page.emulateMedia({ colorScheme: "dark" });
    await page.goto("/?landing=1");
    await expectTheme(page, "dark", "system");
    await choose(page, "Light");
    await expectTheme(page, "light");
  });
}

test("appearance synchronizes existing tabs on the same origin", async ({ page, context }) => {
  await fixture(page);
  await page.goto("/?landing=1");
  const other = await context.newPage();
  await fixture(other);
  await other.goto("/?boost=1");
  await expect(other.getByRole("button", { name: "Appearance: System", exact: true })).toBeVisible();
  await choose(page, "Dark");
  await expectTheme(other, "dark");
  await expect(other.getByRole("button", { name: "Appearance: Dark", exact: true })).toBeVisible();
});

test("public product hosts share only a secure display preference cookie", async ({ page, context, baseURL }) => {
  // Route the simulated HTTPS production hosts exclusively to the local app;
  // this test never requests or changes the actual production sites.
  await context.routeWebSocket("**/*", socket => socket.close());
  await context.route("**/*", async route => {
    const original = new URL(route.request().url());
    if (!original.hostname.endsWith(".proofofwork.me")) return route.abort();
    if (original.pathname.startsWith("/api/")) return route.fulfill({ status: 503, json: { error: "Read-only appearance fixture" } });
    const local = new URL(original.pathname + original.search, baseURL);
    await route.fulfill({ response: await route.fetch({ url: local.href, maxRetries: 2 }) });
  });
  await page.goto("https://boost.proofofwork.me/");
  await choose(page, "Dark");
  const cookie = (await context.cookies()).find(item => item.name === "proofofwork_appearance");
  expect(cookie).toMatchObject({ value: "dark", domain: ".proofofwork.me", path: "/", secure: true, sameSite: "Lax" });
  const other = await context.newPage();
  await other.goto("https://publish.proofofwork.me/");
  await expectTheme(other, "dark");
  await expect(other.getByRole("button", { name: "Appearance: Dark", exact: true })).toBeVisible();
  await choose(page, "Light");
  // Returning to an already-open host refreshes the shared preference even
  // though browser storage events cannot cross origins.
  await other.evaluate(() => window.dispatchEvent(new Event("focus")));
  await expectTheme(other, "light");
});
