import { expect, test } from "@playwright/test";

import {
  ADDRESS, OTHER_ADDRESS, PAGE_TXID, CODE_REPO, CODE_VERSION, CODE_HTML,
  fixture, expectNoSignature, htmlFileMessage,
} from "../fixtures/pagesFixture.mjs";

// These synthetic API records prove local task continuity only. They do not
// establish production discovery, consensus, or permission to sign or run.
const SECOND_PAGE = "2".repeat(64);
const COUNTER = '<!doctype html><html><body><h1>Continuity counter</h1><button id="add">Add one</button><output id="count">0</output><script>let n=0;document.querySelector("#add").onclick=()=>document.querySelector("#count").textContent=String(++n);</script></body></html>\n  ';

async function continuityFixture(page) {
  const state = await fixture(page);
  state.pageTxids.add(SECOND_PAGE);
  await page.route("**/api/v1/code-repositories?**", route => {
    const request = route.request();
    if (request.method() !== "GET") {
      state.writes.push(`${request.method()} ${new URL(request.url()).pathname}`);
      return route.abort("blockedbyclient");
    }
    state.requests.push(new URL(request.url()));
    return route.fulfill({ json: {
      network: state.code.network, source: state.code.source, complete: state.code.complete,
      indexedThroughBlock: state.code.indexedThroughBlock, indexedThroughBlockHash: state.code.indexedThroughBlockHash,
      snapshot: state.code.snapshot, repositories: [state.code.repository],
      pagination: { total: 1, limit: 30, hasMore: false, nextCursor: null },
    } });
  });
  return state;
}

async function connect(page) {
  await page.locator(".topbar-wallet-button").click();
  await expect(page.locator(".topbar-wallet-button")).toContainText(ADDRESS.slice(0, 8));
}

async function openApp(page, name) {
  await page.getByRole("button", { name: "Find an app", exact: true }).click();
  const launcher = page.getByRole("dialog", { name: "Computer apps", exact: true });
  await launcher.getByLabel("Find an app", { exact: true }).fill(name);
  await launcher.getByRole("button", { name, exact: true }).click();
  await expect(launcher).toHaveCount(0);
}

async function backTo(page, name) {
  await page.getByRole("button", { name: `Back to ${name}`, exact: true }).click();
}

async function browse(page, target) {
  const browser = page.getByRole("region", { name: "ProofOfWork Browser", exact: true });
  await browser.getByLabel("Transaction ID or .pow name", { exact: true }).fill(target);
  await browser.getByRole("button", { name: "View Page", exact: true }).click();
  await expect(browser.locator(".browser-preview-card iframe")).toBeVisible();
  return browser;
}

async function pageSource(page, html, title) {
  await page.getByRole("button", { name: "Source", exact: true }).click();
  await page.getByLabel("Page title", { exact: true }).fill(title);
  await page.getByLabel("HTML source", { exact: true }).fill(html);
}

for (const layout of ["Focus", "Desktop"]) {
  test(`${layout}: Mail's exact unsent draft resumes after another app without signing`, async ({ page }) => {
    const state = await continuityFixture(page);
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.goto("/?folder=inbox");
    await connect(page);
    await page.getByRole("group", { name: "Computer layout", exact: true })
      .getByRole("button", { name: layout, exact: true }).click();
    await page.getByRole("button", { name: "Compose", exact: true }).first().click();
    await expect(page.getByRole("button", { name: "Back to Mail", exact: true })).toHaveCount(0);
    await page.getByLabel("To", { exact: true }).fill(OTHER_ADDRESS);
    await page.getByLabel("CC", { exact: true }).fill(ADDRESS);
    await page.getByLabel("Subject", { exact: true }).fill("Unsent continuity draft");
    const body = "Exact unsent message · café\nTrailing spaces.  \n";
    await page.getByRole("textbox", { name: "Message", exact: true }).fill(body);
    await page.getByLabel("Proofs each", { exact: true }).fill("765");
    await page.locator('form.compose-pane input[type="file"]').setInputFiles({
      name: "continuity.txt", mimeType: "text/plain", buffer: Buffer.from("Unsent exact attachment\n"),
    });
    await openApp(page, "Code");
    await expect(page.getByRole("main", { name: "ProofOfWork Code workspace", exact: true })).toBeVisible();
    await backTo(page, "Mail");
    await expect(page.getByLabel("To", { exact: true })).toHaveValue(OTHER_ADDRESS);
    await expect(page.getByLabel("CC", { exact: true })).toHaveValue(ADDRESS);
    await expect(page.getByLabel("Subject", { exact: true })).toHaveValue("Unsent continuity draft");
    await expect(page.getByRole("textbox", { name: "Message", exact: true })).toHaveValue(body);
    await expect(page.getByLabel("Proofs each", { exact: true })).toHaveValue("765");
    await expect(page.locator(".compose-pane")).toContainText("continuity.txt");
    await expect(page.locator(".topbar-wallet-button")).toContainText(ADDRESS.slice(0, 8));
    await expectNoSignature(page, state);
    const appearance = layout === "Focus" ? "Light" : "Dark";
    await page.getByRole("button", { name: /^Appearance: /u }).click();
    await page.getByRole("menuitemradio", { name: appearance, exact: true }).click();
    await page.screenshot({ path: `/tmp/pow-continuity-qa/1440-${layout.toLowerCase()}-${appearance.toLowerCase()}.png`, fullPage: true });
  });
}

test("Mail resumes its selected record when reached through the app launcher", async ({ page }) => {
  const state = await continuityFixture(page);
  await page.route("**/api/v1/address/*/mail?**", route => route.fulfill({ json: {
    address: ADDRESS, network: "livenet", inboxMessages: [htmlFileMessage(), {
      txid: "3".repeat(64), confirmed: true, status: "confirmed", network: "livenet",
      from: OTHER_ADDRESS, to: ADDRESS, replyTo: OTHER_ADDRESS, amountSats: 100,
      createdAt: "2026-10-06T16:00:00Z", subject: "Retained selected message",
      memo: "Exact second message selected before leaving Mail.",
    }], sentMessages: [],
    historyCoverage: { model: "proof-index-address-mail-complete-v1", complete: true },
  } }));
  await page.goto("/?folder=inbox");
  await connect(page);
  const selected = page.locator(".message-row").filter({ hasText: "Retained selected message" });
  await expect(selected).toHaveAttribute("aria-current", "false");
  await selected.click();
  await expect(selected).toHaveAttribute("aria-current", "true");
  await openApp(page, "Pages");
  await openApp(page, "Mail");
  await expect(selected).toHaveAttribute("aria-current", "true");
  await expect(page.getByRole("region", { name: "Mail workspace", exact: true })).toContainText("Exact second message selected before leaving Mail.");
  await expectNoSignature(page, state);
});

test("Code retains exact repository, historical version and source path across app changes", async ({ page }) => {
  const state = await continuityFixture(page);
  state.code.repository.headTxid = SECOND_PAGE;
  await page.goto(`/?folder=code&repo=${CODE_REPO}&version=${CODE_VERSION}&path=site%2Findex.html&network=livenet`);
  await expect(page.getByLabel("Exact source text", { exact: true })).toHaveText(CODE_HTML);
  await expect(page.getByText("Historical confirmed version", { exact: true })).toBeVisible();
  const exactRoute = page.url();
  await openApp(page, "Pages");
  await backTo(page, "Code");
  await expect(page).toHaveURL(exactRoute);
  await expect(page.getByLabel("Exact source text", { exact: true })).toHaveText(CODE_HTML);
  await expect(page.getByText("Historical confirmed version", { exact: true })).toBeVisible();
  await expectNoSignature(page, state);
});

test("Code's unsent editor is resumed with its exact draft when reopening the app", async ({ page }) => {
  const state = await continuityFixture(page);
  await page.goto("/?folder=code");
  await page.getByRole("button", { name: "New repository", exact: true }).click();
  await page.getByLabel("Repository name", { exact: true }).fill("Unsent repository task");
  await page.getByRole("textbox", { name: "Description", exact: true }).fill("Exact description.  \n");
  await openApp(page, "Browser");
  await openApp(page, "Code");
  await expect(page.getByLabel("Repository name", { exact: true })).toHaveValue("Unsent repository task");
  await expect(page.getByRole("textbox", { name: "Description", exact: true })).toHaveValue("Exact description.  \n");
  await expectNoSignature(page, state);
});

test("Pages retains authoring form state and source while its app runtime stops on leave", async ({ page }) => {
  const state = await continuityFixture(page);
  await page.goto("/?folder=pages");
  await pageSource(page, COUNTER, "Unsent Pages task");
  await page.getByLabel("ProofOfWork ID", { exact: true }).fill("alice");
  await page.getByLabel("Transaction ID", { exact: true }).fill(PAGE_TXID);
  await page.getByLabel("Repository creation txid", { exact: true }).fill(CODE_REPO);
  await page.getByLabel("HTML file path", { exact: true }).fill("site/index.html");
  await page.getByLabel("Version txid (optional)", { exact: true }).fill(CODE_VERSION);
  await page.getByLabel(".pow name", { exact: true }).fill("alice.pow");
  await page.getByLabel("Published page txid", { exact: true }).fill(PAGE_TXID);
  await page.getByRole("combobox", { name: "Publication format", exact: true }).selectOption("attachment");
  await page.getByRole("button", { name: "Preview", exact: true }).click();
  await page.getByRole("button", { name: "Run app", exact: true }).click();
  await page.frameLocator('iframe[title="Pages app preview"]').getByRole("button", { name: "Add one", exact: true }).click();
  await expect(page.frameLocator('iframe[title="Pages app preview"]').locator("#count")).toHaveText("1");
  await openApp(page, "Browser");
  await expect(page.locator('iframe[title="Pages app preview"]')).toHaveCount(0);
  await backTo(page, "Pages");
  await expect(page.getByRole("button", { name: "Preview", exact: true })).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator('iframe[title="Pages app preview"]')).toHaveCount(0);
  await expect(page.frameLocator(".pages-workspace iframe").locator("#count")).toHaveText("0");
  await expect(page.getByLabel("Page title", { exact: true })).toHaveValue("Unsent Pages task");
  await expect(page.getByLabel("ProofOfWork ID", { exact: true })).toHaveValue("alice");
  await expect(page.getByLabel("Transaction ID", { exact: true })).toHaveValue(PAGE_TXID);
  await expect(page.getByLabel("Repository creation txid", { exact: true })).toHaveValue(CODE_REPO);
  await expect(page.getByLabel("HTML file path", { exact: true })).toHaveValue("site/index.html");
  await expect(page.getByLabel("Version txid (optional)", { exact: true })).toHaveValue(CODE_VERSION);
  await expect(page.getByLabel(".pow name", { exact: true })).toHaveValue("alice.pow");
  await expect(page.getByLabel("Published page txid", { exact: true })).toHaveValue(PAGE_TXID);
  await expect(page.getByRole("combobox", { name: "Publication format", exact: true })).toHaveValue("attachment");
  await page.getByRole("button", { name: "Source", exact: true }).click();
  await expect(page.getByLabel("HTML source", { exact: true })).toHaveValue(COUNTER);
  await expectNoSignature(page, state);
});

test("Browser resumes its active tab and independent history without restoring execution", async ({ page }) => {
  const state = await continuityFixture(page);
  state.chainHtml = COUNTER;
  await page.goto("/?folder=browser");
  let browser = await browse(page, PAGE_TXID);
  const template = browser.locator(".browser-template-disclosure");
  await template.locator("summary").click();
  await template.getByLabel("Title", { exact: true }).fill("Unsent Browser template");
  await template.getByLabel("Kicker", { exact: true }).fill("Exact local kicker");
  await template.getByRole("textbox", { name: "Body", exact: true }).fill("Exact template body.  \n");
  await template.locator("summary").click();
  await browse(page, SECOND_PAGE);
  await browser.getByRole("button", { name: "New tab", exact: true }).click();
  await browse(page, PAGE_TXID);
  await browser.getByRole("tab").first().click();
  await expect(browser.getByLabel("Transaction ID or .pow name", { exact: true })).toHaveValue(SECOND_PAGE);
  await browser.getByRole("button", { name: "Run app", exact: true }).click();
  await page.frameLocator('iframe[title="Published Pages app"]').getByRole("button", { name: "Add one", exact: true }).click();
  await openApp(page, "Pages");
  await expect(page.locator('iframe[title="Published Pages app"]')).toHaveCount(0);
  const beforeResume = state.requests.filter(url => url.pathname === `/api/v1/tx/${SECOND_PAGE}`).length;
  await backTo(page, "Browser");
  browser = page.getByRole("region", { name: "ProofOfWork Browser", exact: true });
  await expect(browser.getByRole("tab")).toHaveCount(2);
  await expect(browser.getByRole("tab").first()).toHaveAttribute("aria-selected", "true");
  await expect(browser.getByLabel("Transaction ID or .pow name", { exact: true })).toHaveValue(SECOND_PAGE);
  await expect(page.locator('iframe[title="Published Pages app"]')).toHaveCount(0);
  await expect(page.frameLocator(".browser-preview-card iframe").locator("#count")).toHaveText("0");
  await expect.poll(() => state.requests.filter(url => url.pathname === `/api/v1/tx/${SECOND_PAGE}`).length).toBeGreaterThan(beforeResume);
  await browser.getByRole("button", { name: "Back", exact: true }).click();
  await expect(browser.getByLabel("Transaction ID or .pow name", { exact: true })).toHaveValue(PAGE_TXID);
  await browser.getByRole("button", { name: "Forward", exact: true }).click();
  await expect(browser.getByLabel("Transaction ID or .pow name", { exact: true })).toHaveValue(SECOND_PAGE);
  await browser.getByRole("tab").nth(1).click();
  await expect(browser.getByLabel("Transaction ID or .pow name", { exact: true })).toHaveValue(PAGE_TXID);
  await expect(browser.getByRole("button", { name: "Back", exact: true })).toBeDisabled();
  await browser.getByLabel("Transaction ID or .pow name", { exact: true }).fill("unsent-address.pow");
  await openApp(page, "Mail");
  await openApp(page, "Browser");
  await expect(browser.getByLabel("Transaction ID or .pow name", { exact: true })).toHaveValue("unsent-address.pow");
  await template.locator("summary").click();
  await expect(template.getByLabel("Title", { exact: true })).toHaveValue("Unsent Browser template");
  await expect(template.getByLabel("Kicker", { exact: true })).toHaveValue("Exact local kicker");
  await expect(template.getByRole("textbox", { name: "Body", exact: true })).toHaveValue("Exact template body.  \n");
  await template.locator("summary").click();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: "/tmp/pow-continuity-qa/390-browser-resumed.png", fullPage: true });
  await expectNoSignature(page, state);
});

test("Code to Pages to Browser handoffs stay in Computer and retain their return context", async ({ page, context }) => {
  const state = await continuityFixture(page);
  await page.goto(`/?folder=code&repo=${CODE_REPO}&version=${CODE_VERSION}&path=site%2Findex.html&network=livenet`);
  await expect(page.getByLabel("Exact source text", { exact: true })).toHaveText(CODE_HTML);
  const codeRoute = page.url();
  const tabsBefore = context.pages().length;
  await page.getByRole("button", { name: "Continue in Pages", exact: true }).click();
  await expect(page).toHaveURL(/folder=pages/u);
  await expect(page.getByLabel("HTML source", { exact: true })).toHaveValue(CODE_HTML);
  await expect(page.locator('iframe[title="Pages app preview"]')).toHaveCount(0);
  await backTo(page, "Code");
  await expect(page).toHaveURL(codeRoute);
  await expect(page.getByLabel("Exact source text", { exact: true })).toHaveText(CODE_HTML);
  await openApp(page, "Pages");
  await page.getByLabel("Transaction ID", { exact: true }).fill(PAGE_TXID);
  await page.getByRole("button", { name: "Load HTML", exact: true }).click();
  await page.getByRole("button", { name: "Open source in Browser", exact: true }).click();
  await expect(page).toHaveURL(/folder=browser/u);
  await expect(page.getByRole("region", { name: "ProofOfWork Browser", exact: true })).toBeVisible();
  await expect(page.locator('iframe[title="Published Pages app"]')).toHaveCount(0);
  await backTo(page, "Pages");
  await expect(page.getByLabel("Transaction ID", { exact: true })).toHaveValue(PAGE_TXID);
  expect(context.pages()).toHaveLength(tabsBefore);
  await expectNoSignature(page, state);
});

test("Changing wallet account clears return context and never exposes another account's Pages form", async ({ page }) => {
  const state = await continuityFixture(page);
  await page.goto("/?folder=pages");
  await connect(page);
  await pageSource(page, COUNTER, "First account private task");
  await page.getByLabel(".pow name", { exact: true }).fill("private-first-account.pow");
  await openApp(page, "Browser");
  await page.getByRole("button", { name: "New tab", exact: true }).click();
  await page.evaluate(other => window.__pagesFixture.changeAccount(other), OTHER_ADDRESS);
  await expect(page.locator(".topbar-wallet-button")).toContainText(OTHER_ADDRESS.slice(0, 8));
  await expect(page.getByRole("button", { name: /^Back to /u })).toHaveCount(0);
  await openApp(page, "Pages");
  await expect(page.getByLabel("Page title", { exact: true })).not.toHaveValue("First account private task");
  await expect(page.getByLabel(".pow name", { exact: true })).toBeEmpty();
  await page.evaluate(first => window.__pagesFixture.changeAccount(first), ADDRESS);
  await expect(page.getByLabel("Page title", { exact: true })).toHaveValue("First account private task");
  await expect(page.getByLabel(".pow name", { exact: true })).toBeEmpty();
  await expectNoSignature(page, state);
});

test("A Browser page on a different network cannot silently change Computer's authoring scope", async ({ page }) => {
  const state = await continuityFixture(page);
  await page.goto("/?folder=browser");
  await page.getByLabel("Browser ProofOfWork network", { exact: true }).selectOption("testnet4");
  await browse(page, PAGE_TXID);
  await page.getByRole("link", { name: "Edit in Pages", exact: true }).click();
  await expect(page).toHaveURL(/folder=browser/u);
  await expect(page.getByRole("region", { name: "ProofOfWork Browser", exact: true })).toBeVisible();
  await expect(page.getByRole("region", { name: "Pages workspace", exact: true })).toHaveCount(0);
  await expect(page.getByLabel("Browser ProofOfWork network", { exact: true })).toHaveValue("testnet4");
  await expectNoSignature(page, state);
});


test("Native browser Back and Forward restore the same local Pages task", async ({ page }) => {
  const state = await continuityFixture(page);
  await page.goto("/?folder=pages");
  await pageSource(page, COUNTER, "Native history task");
  await page.getByLabel(".pow name", { exact: true }).fill("native-history.pow");
  await openApp(page, "Browser");
  await page.goBack();
  await expect(page).toHaveURL(/folder=pages/u);
  await expect(page.getByLabel("Page title", { exact: true })).toHaveValue("Native history task");
  await expect(page.getByLabel("HTML source", { exact: true })).toHaveValue(COUNTER);
  await expect(page.getByLabel(".pow name", { exact: true })).toHaveValue("native-history.pow");
  await page.goForward();
  await expect(page.getByRole("region", { name: "ProofOfWork Browser", exact: true })).toBeVisible();
  await page.goBack();
  await expect(page.getByLabel("HTML source", { exact: true })).toHaveValue(COUNTER);
  await expectNoSignature(page, state);
});

test("Native browser Back closes Mail transaction review and Forward restores only the draft", async ({ page }) => {
  const state = await continuityFixture(page);
  await page.goto("/?folder=pages");
  await connect(page);
  await pageSource(page, COUNTER, "Reviewed local publication");
  await page.getByRole("button", { name: "Review publication", exact: true }).click();
  const composer = page.locator(".compose-pane");
  await expect(composer.getByRole("textbox", { name: "Message", exact: true })).toHaveValue(COUNTER);
  await composer.getByRole("button", { name: "Send", exact: true }).click();
  await expect(page.getByRole("dialog", { name: "Review mail transaction", exact: true })).toBeVisible();
  await page.goBack();
  await expect(page.getByRole("dialog", { name: "Review mail transaction", exact: true })).toHaveCount(0);
  await expect(page.getByLabel("HTML source", { exact: true })).toHaveValue(COUNTER);
  await page.goForward();
  await expect(composer.getByRole("textbox", { name: "Message", exact: true })).toHaveValue(COUNTER);
  await expect(page.getByRole("dialog", { name: "Review mail transaction", exact: true })).toHaveCount(0);
  await expect(composer.getByRole("button", { name: "Send", exact: true })).toBeEnabled();
  await expectNoSignature(page, state);
});

test("Browser retains an unsubmitted network choice without reopening the old network's page", async ({ page }) => {
  const state = await continuityFixture(page);
  await page.goto("/?folder=browser");
  await browse(page, PAGE_TXID);
  await page.getByLabel("Browser ProofOfWork network", { exact: true }).selectOption("testnet");
  await openApp(page, "Mail");
  const readsBeforeResume = state.requests.filter(url => url.pathname === `/api/v1/tx/${PAGE_TXID}`).length;
  await backTo(page, "Browser");
  await expect(page.getByLabel("Browser ProofOfWork network", { exact: true })).toHaveValue("testnet");
  await expect(page.locator(".browser-preview-card iframe")).toHaveCount(0);
  expect(state.requests.filter(url => url.pathname === `/api/v1/tx/${PAGE_TXID}`).length).toBe(readsBeforeResume);
  await expectNoSignature(page, state);
});


test("Pages opens an explicit Code source even when Code has a retained unsent editor", async ({ page }) => {
  const state = await continuityFixture(page);
  await page.goto("/?folder=code");
  await page.getByRole("button", { name: "New repository", exact: true }).click();
  await page.getByLabel("Repository name", { exact: true }).fill("Preserved alongside source");
  await openApp(page, "Pages");
  await page.getByLabel("Repository creation txid", { exact: true }).fill(CODE_REPO);
  await page.getByLabel("HTML file path", { exact: true }).fill("site/index.html");
  await page.getByLabel("Version txid (optional)", { exact: true }).fill(CODE_VERSION);
  await page.getByRole("button", { name: "Open Code", exact: true }).click();
  await expect(page.getByLabel("Exact source text", { exact: true })).toHaveText(CODE_HTML);
  await expect(page.getByRole("region", { name: "Code editor", exact: true })).toHaveCount(0);
  await page.getByRole("link", { name: "All repositories", exact: true }).click();
  await page.getByRole("button", { name: "Resume draft", exact: true }).click();
  await expect(page.getByLabel("Repository name", { exact: true })).toHaveValue("Preserved alongside source");
  await expectNoSignature(page, state);
});

test("Editing a pending Code handoff cancels replay of that import after leaving Pages", async ({ page }) => {
  const state = await continuityFixture(page);
  await page.goto(`/?folder=code&repo=${CODE_REPO}&version=${CODE_VERSION}&path=site%2Findex.html&network=livenet`);
  await expect(page.getByLabel("Exact source text", { exact: true })).toHaveText(CODE_HTML);
  let releaseRead;
  let markStarted;
  const delayedRead = new Promise(resolve => { releaseRead = resolve; });
  const started = new Promise(resolve => { markStarted = resolve; });
  state.codeReply = async (_url, response) => { markStarted(); await delayedRead; return response; };
  await page.getByRole("button", { name: "Continue in Pages", exact: true }).click();
  await started;
  const edited = "<!doctype html><html><body>My replacement draft</body></html>\n  ";
  await pageSource(page, edited, "Retain my replacement");
  await openApp(page, "Browser");
  state.codeReply = undefined;
  await backTo(page, "Pages");
  await expect(page.getByRole("button", { name: "Import Code HTML", exact: true })).toBeEnabled();
  await expect(page.getByLabel("HTML source", { exact: true })).toHaveValue(edited);
  releaseRead();
  await expect(page.getByLabel("Page title", { exact: true })).toHaveValue("Retain my replacement");
  await expect(page.getByLabel("HTML source", { exact: true })).toHaveValue(edited);
  await expectNoSignature(page, state);
});


test("A custom Mail folder remains selected through native Back and Forward", async ({ page }) => {
  const state = await continuityFixture(page);
  await page.goto("/?folder=inbox");
  await connect(page);
  await page.getByLabel("New folder name", { exact: true }).fill("Continuity folder");
  await page.getByRole("button", { name: "Create folder", exact: true }).click();
  const folder = page.locator(".custom-folder-row").getByRole("button", { name: /^Continuity folder/u });
  await expect(folder).toHaveAttribute("aria-current", "true");
  await openApp(page, "Browser");
  await page.goBack();
  await expect(folder).toHaveAttribute("aria-current", "true");
  await page.goForward();
  await expect(page.getByRole("region", { name: "ProofOfWork Browser", exact: true })).toBeVisible();
  await page.goBack();
  await expect(folder).toHaveAttribute("aria-current", "true");
  await expectNoSignature(page, state);
});

test("Unavailable Mail draft storage preserves current fields and prevents an app switch", async ({ page }) => {
  const state = await continuityFixture(page);
  await page.goto("/?folder=inbox");
  await connect(page);
  await page.getByRole("button", { name: "Compose", exact: true }).first().click();
  await page.getByRole("textbox", { name: "Message", exact: true }).fill("Saved initial text");
  await page.evaluate(() => {
    const original = Storage.prototype.setItem;
    window.__restoreContinuityStorage = () => { Storage.prototype.setItem = original; };
    Storage.prototype.setItem = function (key, value) {
      if (key.startsWith("proofofwork.draft.v1:")) throw new Error("Fixture draft storage unavailable");
      return original.call(this, key, value);
    };
  });
  const unsaved = "Preserve my unsaved text exactly.  \n";
  await page.getByRole("textbox", { name: "Message", exact: true }).fill(unsaved);
  await expect(page.locator(".status-text")).toContainText("Mail could not save this draft");
  await page.getByRole("navigation", { name: "Computer apps", exact: true })
    .getByRole("button", { name: "Code", exact: true }).click();
  await expect(page.getByRole("textbox", { name: "Message", exact: true })).toHaveValue(unsaved);
  await expect(page.getByRole("main", { name: "ProofOfWork Code workspace", exact: true })).toHaveCount(0);
  await expect(page.locator(".status-text")).toContainText("Fixture draft storage unavailable");
  await page.evaluate(() => window.__restoreContinuityStorage());
  await expectNoSignature(page, state);
});


for (const origin of ["Code", "Browser"]) {
  test(`A pending ${origin} handoff never replays after the wallet scope changes away and back`, async ({ page }) => {
    const state = await continuityFixture(page);
    await page.goto("/?folder=pages");
    await connect(page);
    const retained = "<!doctype html><html><body>Keep the original account draft</body></html>\n  ";
    await pageSource(page, retained, "Original account local draft");
    await openApp(page, origin);
    if (origin === "Code") {
      await page.getByLabel("Repository creation transaction", { exact: true }).fill(CODE_REPO);
      await page.getByRole("button", { name: "Open", exact: true }).click();
      await expect(page.getByLabel("Exact source text", { exact: true })).toHaveText(CODE_HTML);
    } else await browse(page, PAGE_TXID);
    let releaseRead;
    let markStarted;
    const delayedRead = new Promise(resolve => { releaseRead = resolve; });
    const started = new Promise(resolve => { markStarted = resolve; });
    if (origin === "Code") {
      state.codeReply = async (_url, response) => { markStarted(); await delayedRead; return response; };
      await page.getByRole("button", { name: "Continue in Pages", exact: true }).click();
    } else {
      await page.route(`**/api/v1/tx/${PAGE_TXID}?**`, async route => {
        markStarted(); await delayedRead; await route.fallback();
      });
      await page.getByRole("link", { name: "Edit in Pages", exact: true }).click();
    }
    await started;
    await openApp(page, "Mail");
    await page.evaluate(other => window.__pagesFixture.changeAccount(other), OTHER_ADDRESS);
    await expect(page.locator(".topbar-wallet-button")).toContainText(OTHER_ADDRESS.slice(0, 8));
    await page.evaluate(first => window.__pagesFixture.changeAccount(first), ADDRESS);
    await expect(page.locator(".topbar-wallet-button")).toContainText(ADDRESS.slice(0, 8));
    state.codeReply = undefined;
    releaseRead();
    await openApp(page, "Pages");
    await expect(page.getByRole("button", { name: "Import Code HTML", exact: true })).toBeDisabled();
    await expect(page.getByLabel("Repository creation txid", { exact: true })).toBeEmpty();
    await expect(page.getByLabel("Transaction ID", { exact: true })).toBeEmpty();
    await expect(page.getByLabel("Page title", { exact: true })).toHaveValue("Original account local draft");
    await expect(page.getByLabel("HTML source", { exact: true })).toHaveValue(retained);
    await expect(page.getByRole("button", { name: /^Back to /u })).toHaveAccessibleName("Back to Mail");
    await expectNoSignature(page, state);
  });
}
