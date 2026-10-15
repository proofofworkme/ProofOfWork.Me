import { expect, test } from "@playwright/test";

import { fixture, expectNoSignature } from "../fixtures/pagesFixture.mjs";
import { pagesStorageKey } from "../../src/features/pages/pagesModel.mjs";

function isPagesModule(url) {
  return /(?:\/src\/features\/pages\/PagesWorkspace\.tsx|\/assets\/PagesWorkspace-[^/]+\.js)$/u.test(url.pathname);
}

async function openApp(page, name) {
  await page.getByRole("button", { name: "Find an app", exact: true }).click();
  const launcher = page.getByRole("dialog", { name: "Computer apps", exact: true });
  await launcher.getByLabel("Find an app", { exact: true }).fill(name);
  await launcher.getByRole("button", { name, exact: true }).click();
  await expect(launcher).toHaveCount(0);
}

test("Pages loads on demand while Computer remains usable and a late module cannot reopen it", async ({ page }) => {
  const state = await fixture(page);
  let releaseModule;
  let moduleRequests = 0;
  const moduleGate = new Promise(resolve => { releaseModule = resolve; });
  await page.route(isPagesModule, async route => {
    moduleRequests++;
    await moduleGate;
    await route.continue();
  });
  try {
    await page.goto("/?folder=inbox");
    await expect(page.getByRole("region", { name: "Mail workspace", exact: true })).toBeVisible();
    expect(moduleRequests).toBe(0);

    await openApp(page, "Pages");
    await expect(page.getByRole("status").filter({ hasText: "Loading Pages…" })).toBeVisible();
    await expect(page.locator(".topbar-wallet-button")).toBeVisible();
    expect(moduleRequests).toBe(1);
    await openApp(page, "Mail");
    await expect(page.getByRole("region", { name: "Mail workspace", exact: true })).toBeVisible();
    const moduleResponse = page.waitForResponse(response => isPagesModule(new URL(response.url())));
    releaseModule();
    await (await moduleResponse).finished();
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    await expect(page.getByRole("region", { name: "Mail workspace", exact: true })).toBeVisible();
    await expect(page.locator(".pages-workspace")).toHaveCount(0);

    await openApp(page, "Pages");
    await expect(page.getByLabel("Page title", { exact: true })).toBeVisible();
    expect(moduleRequests).toBe(1);
    await expect(page.locator('iframe[title="Pages app preview"]')).toHaveCount(0);
    await expectNoSignature(page, state);
  } finally {
    releaseModule();
  }
});

test("a failed Pages module offers the shared reload recovery and preserves the saved draft", async ({ page }) => {
  const state = await fixture(page);
  const html = "<!doctype html><html><body>Exact saved draft.  </body></html>\n";
  const title = "Saved before loading";
  await page.addInitScript(({ key, html, title }) => {
    if (!localStorage.getItem(key)) localStorage.setItem(key, JSON.stringify({
      version: 1, activeId: "saved-loading-draft",
      drafts: [{ id: "saved-loading-draft", title, html, updatedAt: 1 }],
    }));
  }, { key: pagesStorageKey("livenet"), html, title });
  await page.route(isPagesModule, route => route.abort("connectionfailed"));
  await page.goto("/?pages=1");
  await expect(page.getByRole("alert")).toContainText("This workspace could not render.");
  await expectNoSignature(page, state);

  await page.unroute(isPagesModule);
  await page.getByRole("button", { name: "Reload workspace", exact: true }).click();
  await expect(page.getByLabel("Page title", { exact: true })).toHaveValue(title);
  await expect(page.getByLabel("HTML source", { exact: true })).toHaveValue(html);
  await expect(page.locator('iframe[title="Pages app preview"]')).toHaveCount(0);
  await expectNoSignature(page, state);
});
