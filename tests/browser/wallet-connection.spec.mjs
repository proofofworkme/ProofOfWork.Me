import { expect, test } from "@playwright/test";

const ADDRESS = "bc1qvst5k9cr82guxz53wkmt6yll8xd8lk5qpeq5ur";
const OTHER_ADDRESS = "1F1p9UEHuH5KTFR7Zsx93Khdrqhj6t5nFv";

async function fixture(page, { stallNetwork = false, stallIdentity = false, socialPost = false, walletAddress = ADDRESS, rejection } = {}) {
  // Exercise real application controls and helper deadlines without a real
  // extension, transaction signature, or production data. Failed chain reads
  // deliberately remain unavailable; connection is never spend authority.
  await page.clock.install();
  await page.addInitScript(({ address, stallNetwork, rejection }) => {
    const listeners = new Map();
    let resolveAccounts, resolveNetwork;
    const accountPromise = new Promise((resolve) => { resolveAccounts = resolve; });
    const networkPromise = new Promise((resolve) => { resolveNetwork = resolve; });
    window.__walletFixture = {
      address, approved: false, promptCount: 0, networkReads: 0, networkPending: stallNetwork,
      rejection, signatureCalls: 0,
      emit(event) { for (const listener of listeners.get(event) ?? []) listener([this.address]); },
      grantWithoutCompletion() { this.approved = true; },
      approve() { this.approved = true; this.emit("accountsChanged"); resolveAccounts([address]); },
      approveQuietly() { this.approved = true; resolveAccounts([address]); },
      changeAccount(nextAddress) { this.address = nextAddress; },
      finishNetwork() { this.networkPending = false; resolveNetwork({ enum: "BITCOIN_MAINNET" }); },
    };
    window.unisat = {
      requestAccounts() {
        window.__walletFixture.promptCount += 1;
        return window.__walletFixture.rejection ? Promise.reject(window.__walletFixture.rejection) : accountPromise;
      },
      getAccounts: async () => window.__walletFixture.approved ? [window.__walletFixture.address] : [],
      getChain() {
        window.__walletFixture.networkReads += 1;
        return window.__walletFixture.approved && window.__walletFixture.networkPending
          ? networkPromise : Promise.resolve({ enum: "BITCOIN_MAINNET" });
      },
      on(event, listener) { listeners.set(event, [...(listeners.get(event) ?? []), listener]); },
      removeListener(event, listener) { listeners.set(event, (listeners.get(event) ?? []).filter((value) => value !== listener)); },
      disconnect: async () => { window.__walletFixture.approved = false; },
      signPsbt: async () => { window.__walletFixture.signatureCalls++; throw new Error("Connection tests must not sign."); },
      signMessage: async () => { window.__walletFixture.signatureCalls++; throw new Error("Connection tests must not sign."); },
    };
  }, { address: walletAddress, stallNetwork, rejection });
  let releaseIdentity;
  const identityGate = new Promise(resolve => { releaseIdentity = resolve; });
  await page.route("**/api/**", async route => {
    const path = new URL(route.request().url()).pathname;
    // Vite source imports can also contain /api/; only intercept HTTP API
    // endpoints so the same fixture works with source and production builds.
    if (!/^\/(?:test-api\/)?api\//u.test(path)) return route.fallback();
    if (socialPost && path.endsWith("/boost")) return route.fulfill({ json: {
      complete: true, snapshotId: "wallet-connection-post", network: "livenet", hasMore: false, start: 0, totalCount: 1,
      items: [{ txid: "a".repeat(64), authorAddress: OTHER_ADDRESS, currentOwnerAddress: OTHER_ADDRESS,
        confirmed: true, kind: "boost-post", text: "A fixture post for following from a disconnected wallet.",
        createdAt: "2026-10-14T12:00:00Z", proofSignalQ8: "54600000000", totalSignalQ8: "54600000000" }],
    } });
    if (stallIdentity && path.endsWith("/registry")) await identityGate;
    await route.fulfill({
      status: 503, contentType: "application/json",
      body: JSON.stringify({ error: "Fixture verified chain data unavailable." }),
    });
  });
  return { releaseIdentity };
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

const socialSurfaces = [
  { name: "Boost", route: "/?boost=1", writer: false },
  { name: "Publish", route: "/?publish=1&write=1", writer: true },
  { name: "Computer Publish", route: "/?folder=publish&write=1", writer: true },
];
const draftTitle = "Keep the article while UniSat connects";
const draftBody = "The exact draft survives a rejected or stalled connection. Café 🧭.  \n";

async function openSocialSurface(page, surface) {
  await page.goto(surface.route);
  const app = page.locator(".boost-public-app");
  await expect(app).toBeVisible();
  if (surface.writer) {
    await app.getByRole("textbox", { name: "Article title", exact: true }).fill(draftTitle);
    await app.getByRole("textbox", { name: "Article text", exact: true }).fill(draftBody);
  }
  return {
    app,
    // Publish's writer and Computer's writer must use the same connection
    // controller as the standalone header, including their disabled states.
    connect: app.getByRole("button", { name: surface.writer ? /^(?:Connect to publish|Connecting…)$/u : "Connect UniSat", exact: true }),
    status: app.locator(".status-text"),
  };
}

async function expectSocialDraft(page, surface) {
  if (surface.writer) {
    await expect(page.getByRole("textbox", { name: "Article title", exact: true })).toHaveValue(draftTitle);
    await expect(page.getByRole("textbox", { name: "Article text", exact: true })).toHaveValue(draftBody);
  }
  expect(await page.evaluate(() => window.__walletFixture.signatureCalls)).toBe(0);
}

async function expectSocialConnected(app, surface) {
  await expect(app.getByRole("button", { name: surface.writer ? "Review publication" : "Disconnect UniSat", exact: true })).toBeVisible();
}

for (const surface of socialSurfaces) {
  test(`${surface.name}: provider error objects preserve their message and code and allow retry`, async ({ page }) => {
    await fixture(page, { rejection: { code: 4001, message: "Fixture connection approval rejected." } });
    const { app, connect, status } = await openSocialSurface(page, surface);
    await connect.click();
    await expect(status).toContainText("Fixture connection approval rejected.");
    await expect(status).toContainText("4001");
    await expect(connect).toBeEnabled();
    await expectSocialDraft(page, surface);

    await page.evaluate(() => { window.__walletFixture.rejection = null; });
    await connect.click();
    await expect(status).toContainText("Waiting for UniSat account approval...");
    await page.evaluate(() => window.__walletFixture.approveQuietly());
    await expectSocialConnected(app, surface);
    expect(await page.evaluate(() => window.__walletFixture.promptCount)).toBe(2);
    await expectSocialDraft(page, surface);
  });

  test(`${surface.name}: timeout and retry retain one prompt, release controls, and preserve the draft`, async ({ page }) => {
    await fixture(page);
    const { app, connect, status } = await openSocialSurface(page, surface);
    await connect.click();
    await expect(status).toContainText("Waiting for UniSat account approval...");
    await expect(connect).toBeDisabled();
    expect(await page.evaluate(() => window.__walletFixture.promptCount)).toBe(1);
    await page.clock.runFor(60_001);
    await expect(status).toContainText("account approval did not finish within 60 seconds");
    await expect(connect).toBeEnabled();
    await expectSocialDraft(page, surface);

    await connect.click();
    await expect(status).toContainText("Waiting for UniSat account approval...");
    await expect(connect).toBeDisabled();
    expect(await page.evaluate(() => window.__walletFixture.promptCount)).toBe(1);
    await page.evaluate(() => window.__walletFixture.approveQuietly());
    await expectSocialConnected(app, surface);
    expect(await page.evaluate(() => window.__walletFixture.promptCount)).toBe(1);
    await expectSocialDraft(page, surface);
  });

  test(`${surface.name}: account approval arriving after timeout cannot commit a late connection`, async ({ page }) => {
    await fixture(page);
    const { app, connect, status } = await openSocialSurface(page, surface);
    await connect.click();
    await expect(status).toContainText("Waiting for UniSat account approval...");
    await page.clock.runFor(60_001);
    await expect(connect).toBeEnabled();
    await page.evaluate(() => window.__walletFixture.approveQuietly());
    await page.clock.runFor(1_000);
    await expect(connect).toBeEnabled();
    await expect(app.getByRole("button", { name: surface.writer ? "Review publication" : "Disconnect UniSat", exact: true })).toHaveCount(0);
    await expect(status).toContainText("account approval did not finish within 60 seconds");
    await expectSocialDraft(page, surface);
  });

  test(`${surface.name}: a changed account fails final verification and preserves the draft`, async ({ page }) => {
    await fixture(page, { stallNetwork: true });
    const { app, connect, status } = await openSocialSurface(page, surface);
    await connect.click();
    await page.evaluate(() => window.__walletFixture.approveQuietly());
    await expect(status).toContainText("Verifying the UniSat network...");
    await page.evaluate(nextAddress => {
      window.__walletFixture.changeAccount(nextAddress);
      window.__walletFixture.finishNetwork();
    }, OTHER_ADDRESS);
    await expect(status).toContainText("active UniSat account changed while connecting");
    await expect(connect).toBeEnabled();
    await expect(app.getByRole("button", { name: surface.writer ? "Review publication" : "Disconnect UniSat", exact: true })).toHaveCount(0);
    await expectSocialDraft(page, surface);
  });

  test(`${surface.name}: identity data failure leaves a verified wallet connected and releases its controls`, async ({ page }) => {
    await fixture(page);
    const { app, connect, status } = await openSocialSurface(page, surface);
    await connect.click();
    await page.evaluate(() => window.__walletFixture.approveQuietly());
    await expectSocialConnected(app, surface);
    await expect(status).toContainText(/UniSat is connected/iu);
    await expect(status).toContainText(/identity.*unavailable/iu);
    await expect(app.getByRole("button", { name: surface.writer ? "Review publication" : "Disconnect UniSat", exact: true })).toBeEnabled();
    await expectSocialDraft(page, surface);
  });

  test(`${surface.name}: successful connection releases its controls while identity data is still loading`, async ({ page }) => {
    const { releaseIdentity } = await fixture(page, { stallIdentity: true });
    const { app, connect, status } = await openSocialSurface(page, surface);
    try {
      await connect.click();
      await page.evaluate(() => window.__walletFixture.approveQuietly());
      await expectSocialConnected(app, surface);
      await expect(status).toContainText("Loading verified identity data");
      await expect(app.getByRole("button", { name: surface.writer ? "Review publication" : "Disconnect UniSat", exact: true })).toBeEnabled();
      await expectSocialDraft(page, surface);
    } finally {
      releaseIdentity();
    }
    await expect(status).toContainText("Verified identity data is unavailable");
    await expectSocialConnected(app, surface);
  });
}

for (const surface of socialSurfaces.filter(value => value.writer)) {
  test(`${surface.name}: retry recovers already-granted access without another authorization prompt`, async ({ page }) => {
    await fixture(page);
    const { app, connect, status } = await openSocialSurface(page, surface);
    await connect.click();
    await expect(status).toContainText("Waiting for UniSat account approval...");
    await page.clock.runFor(60_001);
    await expect(connect).toBeEnabled();
    await page.evaluate(() => window.__walletFixture.grantWithoutCompletion());
    await connect.click();
    await expectSocialConnected(app, surface);
    expect(await page.evaluate(() => window.__walletFixture.promptCount)).toBe(1);
    await expectSocialDraft(page, surface);
  });

  test(`${surface.name}: a stalled network read times out and retries with fresh network discovery`, async ({ page }) => {
    await fixture(page, { stallNetwork: true });
    const { app, connect, status } = await openSocialSurface(page, surface);
    await connect.click();
    await page.evaluate(() => window.__walletFixture.approveQuietly());
    await expect(status).toContainText("Verifying the UniSat network...");
    await page.clock.runFor(15_001);
    await expect(status).toContainText("UniSat network did not finish within 15 seconds");
    await expect(connect).toBeEnabled();
    await expectSocialDraft(page, surface);
    await connect.click();
    await expect(status).toContainText("Verifying the UniSat network...");
    await page.evaluate(() => window.__walletFixture.finishNetwork());
    await expectSocialConnected(app, surface);
    await expectSocialDraft(page, surface);
  });
}

test("Computer Publish: leaving the workspace invalidates a pending connection without losing its saved draft", async ({ page }) => {
  await fixture(page);
  const surface = socialSurfaces[2];
  const { connect, status } = await openSocialSurface(page, surface);
  await connect.click();
  await expect(status).toContainText("Waiting for UniSat account approval...");
  await page.getByRole("button", { name: /^Contacts/u }).first().click();
  await expect(page.getByRole("heading", { name: "Contacts", level: 2, exact: true })).toBeVisible();
  await page.evaluate(() => window.__walletFixture.approveQuietly());
  await page.clock.runFor(60_001);
  await expect(page.getByText(/did not finish within/u)).toHaveCount(0);
  await expect(page.getByText(/connected\. (?:Boost|Publish)/u)).toHaveCount(0);
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem("proofofwork.publish.draft.v1:livenet:disconnected")).body)).toBe(draftBody);
  expect(await page.evaluate(() => window.__walletFixture.signatureCalls)).toBe(0);
});

test("a disconnected Boost follow opens one authorization prompt and retains action control", async ({ page }) => {
  await fixture(page, { socialPost: true, walletAddress: "1F1zepCJ8VPcPoeMt6G4BPKuE3CYAxCKNY" });
  await page.goto("/?boost=1");
  const follow = page.getByRole("button", { name: "Follow", exact: true });
  const status = page.locator(".boost-public-app .status-text");
  await follow.click();
  await expect(status).toContainText("Waiting for UniSat account approval...");
  await expect(follow).toBeDisabled();
  expect(await page.evaluate(() => window.__walletFixture.promptCount)).toBe(1);
  await page.evaluate(() => window.__walletFixture.approveQuietly());
  await expect(page.getByRole("button", { name: "Disconnect UniSat", exact: true })).toBeVisible();
  // Connection completes, then the independent unavailable funding/registry
  // evidence stops the paid action before any signature can be requested.
  await expect(status).toContainText("Fixture verified chain data unavailable.");
  await expect(follow).toBeEnabled();
  expect(await page.evaluate(() => window.__walletFixture.promptCount)).toBe(1);
  expect(await page.evaluate(() => window.__walletFixture.signatureCalls)).toBe(0);
});

test("a disconnected Boost follow preserves a pending-provider error through its action handler", async ({ page }) => {
  await fixture(page, { socialPost: true, rejection: { code: -32603, message: "Another approval request is already pending" } });
  await page.goto("/?boost=1");
  const follow = page.getByRole("button", { name: "Follow", exact: true });
  await follow.click();
  await expect(page.locator(".boost-public-app .status-text")).toHaveText("Another approval request is already pending (code -32603). Finish or close that prompt in UniSat, then retry this site's connection. No transaction was requested.");
  await expect(follow).toBeEnabled();
  await expect(page.getByRole("button", { name: "Connect UniSat", exact: true })).toBeEnabled();
  expect(await page.evaluate(() => window.__walletFixture.promptCount)).toBe(1);
  expect(await page.evaluate(() => window.__walletFixture.signatureCalls)).toBe(0);
});
