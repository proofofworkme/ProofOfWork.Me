import { expect, test } from "@playwright/test";
import { createHash } from "node:crypto";

const LAYOUT_KEY = "proofofwork-me-computer-layout-v1";
const ADDRESS = "1BPVvi1GK4QkfqFMU4jHGjsQjyGwjJJJ7x";
const RECIPIENT = "1F1p9UEHuH5KTFR7Zsx93Khdrqhj6t5nFv";
const HASH = "a".repeat(64);
const NOW = "2026-10-10T16:00:00.000Z";
const REPO_ID = "b".repeat(64);
const FILE_TXID = "c".repeat(64);
const SOURCE = "# Layout fixture\n\nExact retained source.  \n";
const FILE = { path: "README.md", txid: FILE_TXID, size: Buffer.byteLength(SOURCE),
  sha256: createHash("sha256").update(SOURCE).digest("hex") };
const REPOSITORY = { txid: REPO_ID, repoTxid: REPO_ID, name: "Layout fixture repository",
  description: "Public source for layout continuity", ownerAddress: ADDRESS,
  headTxid: FILE_TXID, fileCount: 1, commitCount: 1 };
const CODE_EVIDENCE = { network: "livenet", complete: true,
  source: "proof-indexer-exact-canonical-code-replay",
  snapshot: { id: "layout-fixture-snapshot", checkpointHeight: 970546, checkpointHash: HASH },
  indexedThroughBlock: 970546, indexedThroughBlockHash: HASH };
const REGISTRY = { network: "livenet", records: [], listings: [], pendingEvents: [],
  activity: [], sales: [], coverage: { complete: true }, indexedAt: NOW,
  indexedThroughBlock: 970546, checkpointHash: HASH, collectionHasMore: { listings: false } };
const TOKEN_STATE = { network: "livenet", tokens: [], holders: [], mints: [], transfers: [],
  listings: [], closedListings: [], sales: [], invalidEvents: [],
  source: "proof-indexer-wallet-token-overlay+proof-indexer-wallet-address-state",
  authoritativeWallet: true, walletScoped: true, summaryOnly: true };

async function fixture(page, { wallet = false, mailUnavailable = false, holdMail = false, withFile = false } = {}) {
  let releaseMail;
  const mailGate = new Promise(resolve => { releaseMail = resolve; });
  const state = { reads: [], writes: [], mailUnavailable, releaseMail };
  if (wallet) await page.addInitScript(address => {
    let connected = false;
    window.__computerLayoutFixture = { signatures: 0, accountRequests: 0 };
    window.unisat = {
      getAccounts: async () => connected ? [address] : [],
      requestAccounts: async () => {
        window.__computerLayoutFixture.accountRequests++;
        connected = true;
        return [address];
      },
      getChain: async () => ({ enum: "BITCOIN_MAINNET" }),
      getNetwork: async () => "livenet", on() {}, removeListener() {},
      signPsbt: async () => {
        window.__computerLayoutFixture.signatures++;
        throw new Error("Read-only layout fixtures must never sign");
      },
    };
  }, ADDRESS);
  await page.route("**/api/**", async route => {
    const request = route.request();
    const url = new URL(request.url());
    // Vite module imports can include /shared/api/; only intercept HTTP API routes.
    if (!url.pathname.startsWith("/api/")) return route.continue();
    if (request.method() !== "GET") {
      state.writes.push(`${request.method()} ${url.pathname}`);
      return route.abort("blockedbyclient");
    }
    state.reads.push(url);
    const fulfill = json => route.fulfill({ json });
    if (url.pathname === "/api/v1/code-repositories") return fulfill({ ...CODE_EVIDENCE,
      repositories: [REPOSITORY], pagination: { total: 1, limit: 30, hasMore: false, nextCursor: null } });
    if (url.pathname === "/api/v1/code-repository") return fulfill({ ...CODE_EVIDENCE,
      repository: REPOSITORY, version: FILE_TXID, files: [FILE], filesComplete: true,
      commits: [], events: [], pagination: { total: 0, limit: 30, hasMore: false, nextCursor: null },
      ...(url.searchParams.has("path") ? { file: { ...FILE, content: SOURCE,
        contentBase64: Buffer.from(SOURCE).toString("base64") } } : {}) });
    if (url.pathname === "/api/v1/registry" || url.pathname === "/api/v1/registry-summary" ||
        url.pathname === "/api/v1/dns" || url.pathname === "/api/v1/dns-summary") return fulfill(REGISTRY);
    if (url.pathname === "/api/v1/token" || url.pathname === "/api/v1/token-summary") return fulfill(TOKEN_STATE);
    if (url.pathname.endsWith(`/address/${ADDRESS}/mail`)) {
      if (holdMail) await mailGate;
      if (state.mailUnavailable) return route.fulfill({ status: 503, json: { error: "Fixture mailbox unavailable" } });
      return fulfill({ address: ADDRESS, network: "livenet", inboxMessages: withFile ? [{
        txid: FILE_TXID, confirmed: true, network: "livenet", from: RECIPIENT, to: ADDRESS,
        amountSats: 546, createdAt: NOW, memo: "Verified fixture attachment", replyTo: RECIPIENT,
        attachment: { name: "layout-fixture.txt", mime: "text/plain", size: FILE.size,
          sha256: FILE.sha256, data: Buffer.from(SOURCE).toString("base64url") },
      }] : [], sentMessages: [],
        historyCoverage: { complete: true, model: "proof-index-address-mail-complete-v1" } });
    }
    if (url.pathname.endsWith("/utxo")) return fulfill([]);
    if (url.pathname === "/api/v1/marketplace-summary") return fulfill({ network: "livenet",
      indexedAt: NOW, registry: REGISTRY, token: TOKEN_STATE });
    return route.fulfill({ status: 503, json: { error: "Fixture has no verified data for this read" } });
  });
  return state;
}

function layoutButton(page, name) {
  return page.getByRole("group", { name: "Computer layout", exact: true })
    .getByRole("button", { name, exact: true });
}

async function setLayout(page, name) {
  await layoutButton(page, name).click();
  await expect(layoutButton(page, name)).toHaveAttribute("aria-pressed", "true");
}

async function openApp(page, name) {
  await page.getByRole("button", { name: "Find an app", exact: true }).click();
  const launcher = page.getByRole("dialog", { name: "Computer apps", exact: true });
  await expect(launcher.getByLabel("Find an app", { exact: true })).toBeFocused();
  await launcher.getByLabel("Find an app", { exact: true }).fill(name);
  await launcher.getByRole("button", { name, exact: true }).click();
  await expect(launcher).toHaveCount(0);
}

async function expectNavigationRetainsShortcut(page, openerName) {
  const opener = page.getByRole("button", { name: openerName, exact: true });
  await opener.click();
  const navigation = page.getByRole("dialog", { name: "Computer navigation", exact: true });
  await expect(navigation).toBeVisible();
  await expect(navigation).toHaveAttribute("aria-modal", "true");
  await page.keyboard.press("Control+k");
  await expect(page.getByRole("dialog", { name: "Computer apps", exact: true })).toHaveCount(0);
  await page.keyboard.press("Meta+k");
  await expect(page.getByRole("dialog", { name: "Computer apps", exact: true })).toHaveCount(0);
  await page.keyboard.press("Tab");
  await expect.poll(() => navigation.evaluate(element => element.contains(document.activeElement))).toBe(true);
  await page.keyboard.press("Shift+Tab");
  await expect.poll(() => navigation.evaluate(element => element.contains(document.activeElement))).toBe(true);
  await page.keyboard.press("Escape");
  await expect(navigation).toHaveCount(0);
  await expect(opener).toBeFocused();
}

async function expectReadOnly(page, state) {
  expect(state.writes).toEqual([]);
  const calls = await page.evaluate(() => window.__computerLayoutFixture?.signatures ?? 0);
  expect(calls).toBe(0);
}

test("Focus defaults on first visit and Desktop persists through reload without changing workspace", async ({ page }) => {
  const state = await fixture(page);
  await page.goto("/?folder=browser");
  await expect(layoutButton(page, "Focus")).toHaveAttribute("aria-pressed", "true");
  await setLayout(page, "Desktop");
  await expect(page).toHaveURL(/folder=browser/);
  await page.reload();
  await expect(layoutButton(page, "Desktop")).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByRole("region", { name: "ProofOfWork Browser", exact: true })).toBeVisible();
  await setLayout(page, "Focus");
  await page.reload();
  await expect(layoutButton(page, "Focus")).toHaveAttribute("aria-pressed", "true");
  await expectReadOnly(page, state);
});

for (const storage of ["invalid", "blocked"]) {
  test(`${storage} appearance storage preserves a usable first-visit layout and switch`, async ({ page }) => {
    await page.addInitScript(({ key, storage }) => {
      if (storage === "invalid") localStorage.setItem(key, "floating-windows");
      else {
        const get = Storage.prototype.getItem;
        const set = Storage.prototype.setItem;
        Storage.prototype.getItem = function (value) {
          if (value === key) throw new Error("Fixture blocked appearance storage");
          return get.call(this, value);
        };
        Storage.prototype.setItem = function (value, content) {
          if (value === key) throw new Error("Fixture blocked appearance storage");
          return set.call(this, value, content);
        };
      }
    }, { key: LAYOUT_KEY, storage });
    const state = await fixture(page);
    await page.goto("/?folder=browser");
    await expect(layoutButton(page, "Focus")).toHaveAttribute("aria-pressed", "true");
    await setLayout(page, "Desktop");
    await page.getByLabel("Transaction ID or .pow name", { exact: true }).fill("unsent.pow");
    await setLayout(page, "Focus");
    await expect(page.getByLabel("Transaction ID or .pow name", { exact: true })).toHaveValue("unsent.pow");
    await expectReadOnly(page, state);
  });
}

test("switching layouts retains Browser tabs, active tab, address entry and expanded viewport", async ({ page }) => {
  const state = await fixture(page);
  await page.goto("/?folder=browser");
  const browser = page.getByRole("region", { name: "ProofOfWork Browser", exact: true });
  await browser.getByRole("button", { name: "New tab", exact: true }).click();
  await browser.getByRole("button", { name: "New tab", exact: true }).click();
  await browser.getByLabel("Transaction ID or .pow name", { exact: true }).fill("keep-this-entry.pow");
  await browser.getByRole("button", { name: "Expand viewport", exact: true }).click();
  for (const mode of ["Desktop", "Focus"]) {
    await setLayout(page, mode);
    await expect(browser.getByRole("tab")).toHaveCount(3);
    await expect(browser.getByRole("tab").nth(2)).toHaveAttribute("aria-selected", "true");
    await expect(browser.getByLabel("Transaction ID or .pow name", { exact: true })).toHaveValue("keep-this-entry.pow");
    await expect(browser.getByRole("button", { name: "Restore viewport", exact: true })).toHaveAttribute("aria-pressed", "true");
    await expect(page).toHaveURL(/folder=browser/);
  }
  await expectReadOnly(page, state);
});

test("Code repository selection and unsent editor state survive both layout changes", async ({ page }) => {
  const state = await fixture(page);
  await page.goto(`/?folder=code&repo=${REPO_ID}&path=README.md`);
  await expect(page.getByLabel("Exact source text", { exact: true })).toHaveText(SOURCE);
  const sourceUrl = page.url();
  await setLayout(page, "Desktop");
  await expect(page).toHaveURL(sourceUrl);
  await expect(page.getByLabel("Exact source text", { exact: true })).toHaveText(SOURCE);
  await page.getByRole("button", { name: "New repository", exact: true }).click();
  await page.getByLabel("Repository name", { exact: true }).fill("Unsent repository");
  await page.getByRole("textbox", { name: "Description", exact: true }).fill("Exact unsent description.  \n");
  await setLayout(page, "Focus");
  await expect(page.getByLabel("Repository name", { exact: true })).toHaveValue("Unsent repository");
  await expect(page.getByRole("textbox", { name: "Description", exact: true })).toHaveValue("Exact unsent description.  \n");
  await setLayout(page, "Desktop");
  await expect(page.getByLabel("Repository name", { exact: true })).toHaveValue("Unsent repository");
  await expect(page).toHaveURL(sourceUrl);
  await expectReadOnly(page, state);
});

test("layout changes preserve wallet connection and the complete open Mail draft without signing", async ({ page }) => {
  const state = await fixture(page, { wallet: true });
  await page.goto("/?folder=inbox");
  await page.locator(".topbar-wallet-button").click();
  await expect(page.locator(".topbar-wallet-button")).toContainText("1BPVvi1G");
  await page.getByRole("button", { name: "Compose", exact: true }).first().click();
  await page.getByLabel("To", { exact: true }).fill(RECIPIENT);
  await page.getByLabel("CC", { exact: true }).fill(ADDRESS);
  await page.getByLabel("Subject", { exact: true }).fill("Unsent private draft");
  await page.getByRole("textbox", { name: "Message", exact: true }).fill("Retain these exact draft bytes.  \n");
  await page.getByLabel("Proofs each", { exact: true }).fill("765");
  await page.locator('form.compose-pane input[type="file"]').setInputFiles({
    name: "local-draft.txt", mimeType: "text/plain", buffer: Buffer.from("Unsent attachment"),
  });
  for (const mode of ["Desktop", "Focus"]) {
    await setLayout(page, mode);
    await expect(page.locator(".topbar-wallet-button")).toContainText("1BPVvi1G");
    await expect(page.getByLabel("To", { exact: true })).toHaveValue(RECIPIENT);
    await expect(page.getByLabel("CC", { exact: true })).toHaveValue(ADDRESS);
    await expect(page.getByLabel("Subject", { exact: true })).toHaveValue("Unsent private draft");
    await expect(page.getByRole("textbox", { name: "Message", exact: true })).toHaveValue("Retain these exact draft bytes.  \n");
    await expect(page.getByLabel("Proofs each", { exact: true })).toHaveValue("765");
    await expect(page.locator(".compose-pane")).toContainText("local-draft.txt");
  }
  expect(await page.evaluate(() => window.__computerLayoutFixture.accountRequests)).toBe(1);
  await expectReadOnly(page, state);
});

for (const mode of ["Focus", "Desktop"]) {
  test(`${mode} launcher reaches Search, IDs, DNS and AMO as separate real workspaces`, async ({ page }) => {
    const state = await fixture(page);
    await page.goto("/?folder=browser");
    await setLayout(page, mode);
    for (const [app, folder, ready] of [
      ["Search", "search", () => page.getByLabel("Search the Computer", { exact: true })],
      ["IDs", "ids", () => page.getByRole("heading", { name: "ProofOfWork IDs", exact: true, level: 2 })],
      ["DNS", "dns", () => page.getByRole("heading", { name: "Claim your .pow name.", exact: true })],
      ["AMO", "marketplace", () => page.getByRole("heading", { name: "AMO", exact: true, level: 2 })],
    ]) {
      await openApp(page, app);
      await expect.poll(() => new URL(page.url()).searchParams.get("folder")).toBe(folder);
      await expect(ready()).toBeVisible();
      await expect(layoutButton(page, mode)).toHaveAttribute("aria-pressed", "true");
    }
    await expectReadOnly(page, state);
  });
}

test("disconnected Desktop overviews qualify account data instead of displaying zero balances or files", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  const state = await fixture(page);
  await page.goto("/?folder=browser");
  await setLayout(page, "Desktop");
  const wallet = page.getByRole("region", { name: "Wallet overview", exact: true });
  const files = page.getByRole("region", { name: "Files overview", exact: true });
  await expect(wallet).toBeVisible();
  await expect(files).toBeVisible();
  await expect(wallet).toContainText(/connect|disconnected|unknown|not connected/iu);
  await expect(files).toContainText(/connect|disconnected|unknown|not connected/iu);
  await expect(wallet).not.toContainText(/\b0(?:\.0+)?\s*(?:proofs|WORK|POWB|INCB)\b/u);
  await expect(files).not.toContainText(/\b0\s*(?:files|confirmed files)\b/u);
  await expectReadOnly(page, state);
});

test("Desktop Files waits for verified mailbox bytes before showing recent attachments", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  const state = await fixture(page, { wallet: true, holdMail: true, withFile: true });
  await page.goto("/?folder=inbox");
  await setLayout(page, "Desktop");
  await page.locator(".topbar-wallet-button").click();
  await expect(page.locator(".topbar-wallet-button")).toContainText("1BPVvi1G");
  const files = page.getByRole("region", { name: "Files overview", exact: true });
  try {
    await expect.poll(() => state.reads.some(url => url.pathname.endsWith(`/address/${ADDRESS}/mail`))).toBe(true);
    await expect(files).toContainText(/loading|verifying|not verified/iu);
    await expect(files).not.toContainText("No verified recent attachments available.");
    await expect(files).not.toContainText("layout-fixture.txt");
  } finally { state.releaseMail(); }
  await expect(files).toContainText("layout-fixture.txt");
  await expect(files).toContainText("Confirmed");
  await setLayout(page, "Focus");
  await setLayout(page, "Desktop");
  await expect(files).toContainText("layout-fixture.txt");
  await expectReadOnly(page, state);
});

test("unavailable Desktop Files avoids an empty claim and recovers through the retained Refresh action", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  const state = await fixture(page, { wallet: true, mailUnavailable: true, withFile: true });
  await page.goto("/?folder=inbox");
  await setLayout(page, "Desktop");
  await page.locator(".topbar-wallet-button").click();
  await expect(page.locator(".status-text").first()).toContainText("Fixture mailbox unavailable");
  const files = page.getByRole("region", { name: "Files overview", exact: true });
  await expect(files).toContainText(/unavailable|not verified/iu);
  await expect(files).not.toContainText("No verified recent attachments available.");
  await expect(files).not.toContainText("layout-fixture.txt");
  state.mailUnavailable = false;
  await page.locator(".topbar-refresh-button").click();
  await expect(files).toContainText("layout-fixture.txt");
  await expectReadOnly(page, state);
});

test("Local data keeps modal keyboard authority on wide screens in both layouts", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  const state = await fixture(page);
  await page.goto("/?folder=browser");
  for (const mode of ["Focus", "Desktop"]) {
    await setLayout(page, mode);
    await expectNavigationRetainsShortcut(page, "Local data");
  }
  await expectReadOnly(page, state);
});

test("Import review retains keyboard focus above Local data and excludes layout preference from restore", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const contactsKey = "proofofwork.contacts.v1";
  const retainedContacts = JSON.stringify([{ address: ADDRESS, network: "livenet", name: "Retained contact" }]);
  await page.addInitScript(({ key, value }) => localStorage.setItem(key, value),
    { key: contactsKey, value: retainedContacts });
  const state = await fixture(page);
  await page.goto("/?folder=browser");
  await setLayout(page, "Desktop");
  const localData = page.getByRole("button", { name: "Local data", exact: true });
  await localData.click();
  const navigation = page.getByRole("dialog", { name: "Computer navigation", exact: true });
  await expect(navigation).toBeVisible();
  const importButton = navigation.getByRole("button", { name: "Import", exact: true });
  const chooserPromise = page.waitForEvent("filechooser");
  await importButton.click();
  const chooser = await chooserPromise;
  await chooser.setFiles({ name: "layout-review-backup.json", mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify({ app: "ProofOfWork.Me", version: 1,
      data: { [contactsKey]: "[]", [LAYOUT_KEY]: "focus" } })) });
  const review = page.getByRole("dialog", { name: "Review local restore", exact: true });
  await expect(review).toBeVisible();
  await expect(review.getByRole("button", { name: "Cancel", exact: true })).toBeFocused();
  await expect(review).toContainText(/1 unsupported keys? ignored/u);
  for (const key of ["Tab", "Shift+Tab"]) {
    await page.keyboard.press(key);
    await expect.poll(() => review.evaluate(element => element.contains(document.activeElement))).toBe(true);
  }
  await page.keyboard.press("Control+k");
  await expect(page.getByRole("dialog", { name: "Computer apps", exact: true })).toHaveCount(0);
  await page.keyboard.press("Escape");
  await expect(review).toHaveCount(0);
  await expect(navigation).toBeVisible();
  await expect(importButton).toBeFocused();
  expect(await page.evaluate(key => localStorage.getItem(key), contactsKey)).toBe(retainedContacts);
  expect(await page.evaluate(key => localStorage.getItem(key), LAYOUT_KEY)).toBe("desktop");
  await page.keyboard.press("Escape");
  await expect(navigation).toHaveCount(0);
  await expect(localData).toBeFocused();
  await expect(layoutButton(page, "Desktop")).toHaveAttribute("aria-pressed", "true");
  await expectReadOnly(page, state);
});

for (const width of [320, 390]) {
  test(`${width}px launcher supports keyboard selection, Escape and focus return in either layout`, async ({ page }) => {
    await page.setViewportSize({ width, height: 844 });
    const state = await fixture(page);
    await page.goto("/?folder=browser");
    for (const mode of ["Desktop", "Focus"]) {
      await setLayout(page, mode);
      const opener = page.getByRole("button", { name: "Find an app", exact: true });
      await opener.focus();
      await page.keyboard.press("Enter");
      const launcher = page.getByRole("dialog", { name: "Computer apps", exact: true });
      await expect(launcher.getByLabel("Find an app", { exact: true })).toBeFocused();
      await launcher.getByLabel("Find an app", { exact: true }).fill("Code");
      await page.keyboard.press("Escape");
      await expect(launcher).toHaveCount(0);
      await expect(opener).toBeFocused();
      await page.keyboard.press("Enter");
      await launcher.getByLabel("Find an app", { exact: true }).fill("Browser");
      await launcher.getByRole("button", { name: "Browser", exact: true }).focus();
      await page.keyboard.press("Enter");
      await expect(launcher).toHaveCount(0);
      await expect(page.getByLabel("Transaction ID or .pow name", { exact: true })).toBeVisible();
      await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
      await expectNavigationRetainsShortcut(page, "Local data");
      await expectNavigationRetainsShortcut(page, "More");
    }
    await expectReadOnly(page, state);
  });
}
