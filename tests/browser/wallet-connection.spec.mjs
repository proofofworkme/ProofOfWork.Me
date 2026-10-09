import { expect, test } from "@playwright/test";

const ADDRESS = "bc1qvst5k9cr82guxz53wkmt6yll8xd8lk5qpeq5ur";

async function fixture(page, { stallNetwork = false } = {}) {
  // Exercise real application controls and helper deadlines without a real
  // extension, transaction signature, or production data. Failed chain reads
  // deliberately remain unavailable; connection is never spend authority.
  await page.clock.install();
  await page.addInitScript(({ address, stallNetwork }) => {
    const listeners = new Map();
    let resolveAccounts, resolveNetwork;
    const accountPromise = new Promise((resolve) => { resolveAccounts = resolve; });
    const networkPromise = new Promise((resolve) => { resolveNetwork = resolve; });
    window.__walletFixture = {
      approved: false, promptCount: 0, networkReads: 0, networkPending: stallNetwork,
      emit(event) { for (const listener of listeners.get(event) ?? []) listener([address]); },
      grantWithoutCompletion() { this.approved = true; },
      approve() { this.approved = true; this.emit("accountsChanged"); resolveAccounts([address]); },
      finishNetwork() { this.networkPending = false; resolveNetwork({ enum: "BITCOIN_MAINNET" }); },
    };
    window.unisat = {
      requestAccounts() { window.__walletFixture.promptCount += 1; return accountPromise; },
      getAccounts: async () => window.__walletFixture.approved ? [address] : [],
      getChain() {
        window.__walletFixture.networkReads += 1;
        return window.__walletFixture.approved && window.__walletFixture.networkPending
          ? networkPromise : Promise.resolve({ enum: "BITCOIN_MAINNET" });
      },
      on(event, listener) { listeners.set(event, [...(listeners.get(event) ?? []), listener]); },
      removeListener(event, listener) { listeners.set(event, (listeners.get(event) ?? []).filter((value) => value !== listener)); },
      disconnect: async () => { window.__walletFixture.approved = false; },
    };
  }, { address: ADDRESS, stallNetwork });
  await page.route("**/api/**", (route) => route.fulfill({
    status: 503, contentType: "application/json",
    body: JSON.stringify({ error: "Fixture verified chain data unavailable." }),
  }));
}

for (const route of ["/?wallet=1", "/?folder=wallet"]) {
  test(`${route}: timed-out authorization can retry without duplicate prompts or late state`, async ({ page }) => {
    await fixture(page);
    await page.goto(route);
    const connect = page.getByRole("button", { name: "Connect UniSat", exact: true }).first();
    await connect.click();
    await expect(page.locator(".status-text").filter({ hasText: "Waiting for UniSat account approval..." })).toBeVisible();
    await expect(connect).toBeDisabled();
    await expect.poll(() => page.evaluate(() => window.__walletFixture.promptCount)).toBe(1);

    await page.clock.runFor(60_001);
    await expect(page.locator(".status-text").filter({ hasText: /account approval did not finish/u })).toBeVisible();
    await expect(connect).toBeEnabled();
    await connect.click();
    await expect(page.locator(".status-text").filter({ hasText: "Waiting for UniSat account approval..." })).toBeVisible();
    expect(await page.evaluate(() => window.__walletFixture.promptCount)).toBe(1);
    await page.evaluate(() => window.__walletFixture.approve());
    await expect(page.getByRole("button", { name: "Disconnect UniSat", exact: true }).first()).toBeVisible();
    expect(await page.evaluate(() => window.__walletFixture.promptCount)).toBe(1);
    await expect(page.getByText(/did not finish within/u)).toHaveCount(0);
  });
}

test("retry reads an approved account even if the extension authorization promise stays unresolved", async ({ page }) => {
  await fixture(page);
  await page.goto("/?wallet=1");
  const connect = page.getByRole("button", { name: "Connect UniSat", exact: true }).first();
  await connect.click();
  await expect(page.locator(".status-text").filter({ hasText: "Waiting for UniSat account approval..." })).toBeVisible();
  await page.clock.runFor(60_001);
  await expect(connect).toBeEnabled();
  await page.evaluate(() => window.__walletFixture.grantWithoutCompletion());
  await connect.click();
  await expect(page.getByRole("button", { name: "Disconnect UniSat", exact: true }).first()).toBeVisible();
  expect(await page.evaluate(() => window.__walletFixture.promptCount)).toBe(1);
  await expect(page.getByText(/did not finish within/u)).toHaveCount(0);
});

test("a blocked network stage releases the connection control and can retry with fresh discovery", async ({ page }) => {
  await fixture(page, { stallNetwork: true });
  await page.goto("/?wallet=1");
  const connect = page.getByRole("button", { name: "Connect UniSat", exact: true }).first();
  await connect.click();
  await page.evaluate(() => window.__walletFixture.approve());
  await expect(page.locator(".status-text").filter({ hasText: "Verifying the UniSat network..." })).toBeVisible();
  await page.clock.runFor(15_001);
  await expect(page.locator(".status-text").filter({ hasText: /UniSat network did not finish/u })).toBeVisible();
  await expect(connect).toBeEnabled();
  await connect.click();
  await expect(page.locator(".status-text").filter({ hasText: "Verifying the UniSat network..." })).toBeVisible();
  await page.evaluate(() => window.__walletFixture.finishNetwork());
  await expect(page.getByRole("button", { name: "Disconnect UniSat", exact: true }).first()).toBeVisible();
  await expect(page.getByText(/did not finish within/u)).toHaveCount(0);
});

test("workspace changes invalidate pending connection results", async ({ page }) => {
  await fixture(page);
  await page.goto("/?folder=wallet");
  await page.getByRole("button", { name: "Connect UniSat", exact: true }).first().click();
  await expect(page.locator(".status-text").filter({ hasText: "Waiting for UniSat account approval..." })).toBeVisible();
  await page.getByRole("button", { name: /^Contacts/u }).first().click();
  await page.evaluate(() => window.__walletFixture.approve());
  // A new wallet event may legitimately synchronize the new workspace. The
  // abandoned attempt must not overwrite it with Wallet-specific ready text.
  await page.clock.runFor(60_001);
  await expect(page.getByText("UniSat connected. Credit wallet ready.", { exact: true })).toHaveCount(0);
  await expect(page.getByText(/did not finish within/u)).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "Contacts", level: 2, exact: true })).toBeVisible();
});
