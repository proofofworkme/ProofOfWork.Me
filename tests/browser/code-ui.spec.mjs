import { expect, test } from "@playwright/test";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import * as bitcoin from "bitcoinjs-lib";

const id = value => value.toString(16).padStart(64, "0");
const owner = "bc1qfwytlzyr3ym3enz2eutwtjsf9kkf6uqkjydk3e";
const foreign = "1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa";
const content = "\ufeff# Fixture README\r\n\r\n<script>window.codeInjected = true</script>\r\nExact trailing spaces.  \r\n";
const bytes = Buffer.from(content);
const sha256 = createHash("sha256").update(bytes).digest("hex");
const file = { path: "README.md", txid: id(2), size: bytes.length, sha256 };
const empty = { path: "工程/empty.ts", txid: id(3), size: 0, sha256: createHash("sha256").update("").digest("hex") };
const repo = { txid: id(1), repoTxid: id(1), name: "Fixture repository", description: "Exact public source",
  ownerAddress: owner, headTxid: id(3), fileCount: 2, commitCount: 2 };
const snapshot = { id: "fixture-code-snapshot", checkpointHeight: 100, checkpointHash: "a".repeat(64) };
const evidence = { network: "livenet", complete: true, source: "proof-indexer-exact-canonical-code-replay", snapshot,
  indexedThroughBlock: 100, indexedThroughBlockHash: snapshot.checkpointHash };
const pagination = { limit: 30, total: 3, hasMore: false, nextCursor: null };
const events = [{ txid: id(1), applied: true, confirmed: true, status: "confirmed", blockHeight: 100 },
  { txid: id(2), parentTxid: id(1), path: file.path, message: "Add exact README", op: "put", applied: true, confirmed: true, status: "confirmed", blockHeight: 100, sha256, size: bytes.length },
  { txid: id(3), parentTxid: id(2), path: empty.path, message: "Add empty source", op: "put", applied: true, confirmed: true, status: "confirmed", blockHeight: 100, sha256: empty.sha256, size: 0 },
  { txid: id(4), parentTxid: id(1), path: file.path, message: "Stale competing edit", op: "put", applied: false, status: "confirmed", validationErrors: ["code-parent-stale"] }];
const funding = new bitcoin.Transaction();
funding.addInput(Buffer.alloc(32, 1), 0);
funding.addOutput(bitcoin.address.toOutputScript(owner), 2_000_000n);
const utxo = { txid: funding.getId(), vout: 0, value: 2_000_000, status: { confirmed: true } };

async function fixture(page, { unavailable = false, wallet = false, corruptSource = false } = {}) {
  if (wallet) await page.addInitScript(({ owner, utxo }) => {
    const handlers = new Map();
    window.codeSignatureCalls = 0;
    window.codeAccounts = [owner];
    window.codeWalletEvent = (event, values) => { if (event === "accountsChanged") window.codeAccounts = values; for (const handler of handlers.get(event) ?? []) handler(values); };
    window.unisat = { getAccounts: async () => window.codeAccounts, requestAccounts: async () => window.codeAccounts,
      getNetwork: async () => "livenet", getBitcoinUtxos: async () => [utxo],
      on: (event, handler) => handlers.set(event, [...(handlers.get(event) ?? []), handler]),
      removeListener: (event, handler) => handlers.set(event, (handlers.get(event) ?? []).filter(value => value !== handler)),
      signPsbt: async () => { window.codeSignatureCalls++; throw new Error("Rejected by disposable test wallet"); } };
  }, { owner, utxo });
  await page.route("**/api/v1/**", async route => {
    const url = new URL(route.request().url());
    url.pathname = url.pathname.replace(/^\/test-api(?=\/api\/)/u, "");
    if (route.request().method() !== "GET") return route.abort("blockedbyclient");
    if (url.pathname === "/api/v1/code-repositories") return route.fulfill(unavailable
      ? { status: 503, json: { error: "Historical Code candidate discovery is incomplete", details: { code: "CODE_DISCOVERY_INCOMPLETE" } } }
      : { json: { ...evidence, repositories: [repo], pagination: { ...pagination, total: 1 } } });
    if (url.pathname === "/api/v1/code-repository") {
      const version = url.searchParams.get("version") || repo.headTxid;
      const files = version === id(1) ? [] : version === id(2) ? [file] : [file, empty];
      const path = url.searchParams.get("path");
      const selected = files.find(value => value.path === path);
      const source = selected?.path === file.path ? content : "";
      return route.fulfill({ json: { ...evidence, repository: repo, version, files, filesComplete: true,
        commits: events, events, pagination, ...(path !== null ? { file: selected ? { ...selected,
          content: corruptSource && source ? source.slice(1) : source, contentBase64: Buffer.from(source).toString("base64") } : null } : {}) } });
    }
    if (url.pathname.endsWith("/utxo")) return route.fulfill({ json: [utxo] });
    if (url.pathname.endsWith("/hex")) return route.fulfill({ json: { hex: funding.toHex() } });
    if (url.pathname.endsWith("/status")) return route.fulfill({ json: { status: "confirmed", confirmed: true } });
    if (url.pathname === "/api/v1/registry") return route.fulfill({ json: { network: "livenet", records: [], listings: [], coverage: { complete: true }, collectionHasMore: { listings: false } } });
    if (url.pathname === "/api/v1/token") return route.fulfill({ json: { network: "livenet", listings: [], source: "proof-indexer-wallet-token-overlay+proof-indexer-wallet-address-state", walletScoped: true, authoritativeWallet: true, summaryOnly: true } });
    if (url.pathname === "/api/v1/boost") return route.fulfill({ json: { network: "livenet", complete: true, items: [], hasMore: false } });
    return route.fulfill({ json: { records: [], items: [], listings: [], complete: true, minimumFee: 0.1, fastestFee: 1, halfHourFee: 1, hourFee: 1 } });
  });
}

test("unready discovery shows unavailable evidence instead of an empty repository claim", async ({ page }) => {
  await fixture(page, { unavailable: true });
  await page.goto("/?code=1");
  await expect(page.getByText("Code evidence unavailable", { exact: true })).toBeVisible();
  await expect(page.getByText(/Historical Code candidate discovery is incomplete/)).toBeVisible();
  await expect(page.getByRole("heading", { name: "No confirmed repositories yet" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Retry confirmed read" })).toBeVisible();
});

for (const width of [390, 1440]) {
  test(`verified source, history, revisions and ZIP fit ${width}px without executing source`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await fixture(page, { wallet: true });
    await page.goto("/?code=1");
    await page.getByRole("link", { name: repo.name, exact: true }).click();
    await expect(page.locator(".code-source")).toContainText("window.codeInjected = true");
    await expect(page).toHaveTitle(`${repo.name} | ProofOfWork Code`);
    await expect(page.locator('meta[name="description"]')).toHaveAttribute("content", repo.description);
    await expect(page.locator('link[rel="canonical"]')).toHaveAttribute("href", new RegExp(`^https://code\\.proofofwork\\.me/\\?repo=${id(1)}`));
    await expect(page.locator('.code-file-tree a').first()).toHaveAttribute("href", /[?&]path=/);
    await page.screenshot({ path: `/tmp/proofofwork-code-fixture-repository-${width}.png`, fullPage: true });
    expect(await page.evaluate(() => window.codeInjected)).toBeUndefined();
    const exact = page.waitForEvent("download");
    await page.getByRole("button", { name: "Download exact source" }).click();
    const sourceDownload = await exact;
    expect(await readFile(await sourceDownload.path())).toEqual(bytes);
    await page.getByRole("button", { name: "History", exact: true }).click();
    await expect(page.getByText("Stale competing edit", { exact: true })).toBeVisible();
    await expect(page.getByText("Unapplied", { exact: true })).toBeVisible();
    await page.locator(".code-history-entry").filter({ hasText: "Add exact README" }).getByRole("link", { name: "View version" }).click();
    await expect(page.getByText("Historical confirmed version", { exact: true })).toBeVisible();
    await expect(page.locator(".code-file-tree a")).toHaveCount(1);
    await page.getByRole("link", { name: "Return to main head", exact: true }).click();
    await expect(page.locator(".code-file-tree a")).toHaveCount(2);
    const archiveDownload = page.waitForEvent("download");
    await page.getByRole("button", { name: "Download ZIP", exact: true }).click();
    const zip = await archiveDownload;
    const archived = await readFile(await zip.path());
    expect(archived.readUInt32LE(0)).toBe(0x04034b50);
    expect(archived.includes(bytes)).toBe(true);
    expect(archived.includes(Buffer.from(empty.path))).toBe(true);
    await page.getByRole("button", { name: "Connect UniSat", exact: true }).first().click();
    await page.getByRole("button", { name: "Add file", exact: true }).click();
    await expect(page).not.toHaveTitle(`${repo.name} | ProofOfWork Code`);
    await expect(page.locator('meta[name="robots"]')).toHaveAttribute("content", /noindex/);
    await expect(page.locator('link[rel="canonical"]')).toHaveCount(0);
    const editor = page.getByRole("textbox", { name: "Source text", exact: true });
    await expect(editor).toHaveCSS("font-size", width <= 860 ? "16px" : "14px");
    await expect(editor).toHaveCSS("font-family", /IBM Plex Mono/);
    const draftSource = "Exact unsent source · café\nTrailing spaces.  \n";
    await editor.fill(draftSource);
    await expect(editor).toHaveValue(draftSource);
    expect(await page.evaluate(() => window.codeSignatureCalls)).toBe(0);
    const dimensions = await page.evaluate(() => ({ document: document.documentElement.scrollWidth, viewport: window.innerWidth }));
    expect(dimensions.document).toBeLessThanOrEqual(dimensions.viewport + 1);
  });
}

test("source commitment mismatch never renders or downloads forged source", async ({ page }) => {
  await fixture(page, { corruptSource: true });
  await page.goto(`/?code=1&repo=${id(1)}&path=README.md`);
  await expect(page.getByText("Source bytes do not match the confirmed file commitment.", { exact: true })).toBeVisible();
  await expect(page.locator(".code-source")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Download exact source" })).toHaveCount(0);
});

test("repository links and native history restore verified titles without stale metadata", async ({ page }) => {
  await fixture(page);
  await page.goto("/?code=1");
  const repository = page.getByRole("link", { name: repo.name, exact: true });
  await expect(repository).toHaveAttribute("href", new RegExp(`[?&]repo=${id(1)}`));
  await repository.click();
  await expect(page).toHaveTitle(`${repo.name} | ProofOfWork Code`);
  await page.goBack();
  await expect(repository).toBeVisible();
  await expect(page).toHaveTitle("ProofOfWork Code | Public source and verified history");
  await expect(page.locator('link[rel="canonical"]')).toHaveAttribute("href", "https://code.proofofwork.me/");
  await expect(page.locator('script[data-proof-seo="structured-data"]')).toHaveCount(1);
  await page.goForward();
  await expect(page).toHaveTitle(`${repo.name} | ProofOfWork Code`);
  await expect(page.locator('script[data-proof-seo="structured-data"]')).toHaveCount(0);
});

test("embedded editor preserves drafts and prevents leaving when storage cannot save", async ({ page }) => {
  await fixture(page);
  await page.goto("/?folder=code");
  await page.getByRole("button", { name: "New repository", exact: true }).click();
  await page.getByRole("textbox", { name: "Repository name", exact: true }).fill("Retained local draft");
  await page.getByRole("textbox", { name: "Description", exact: true }).fill("Exact unsent work");
  await page.screenshot({ path: "/tmp/proofofwork-code-fixture-editor.png", fullPage: true });
  await expect.poll(async () => page.evaluate(() => JSON.parse(localStorage.getItem("proofofwork.code.draft.v1:livenet:disconnected") ?? "{}").name)).toBe("Retained local draft");
  const permitted = await page.evaluate(() => window.dispatchEvent(new Event("proofofwork:before-code-writer-leave", { cancelable: true })));
  expect(permitted).toBe(true);
  const prevented = await page.evaluate(() => {
    const original = Storage.prototype.setItem;
    Storage.prototype.setItem = function (key, value) { if (key.startsWith("proofofwork.code.draft")) throw new Error("Fixture quota"); return original.call(this, key, value); };
    const allowed = window.dispatchEvent(new Event("proofofwork:before-code-writer-leave", { cancelable: true }));
    Storage.prototype.setItem = original;
    return allowed;
  });
  expect(prevented).toBe(false);
  await expect(page.getByRole("textbox", { name: "Repository name", exact: true })).toHaveValue("Retained local draft");
  await page.reload();
  await page.getByRole("button", { name: "Resume draft", exact: true }).click();
  await expect(page.getByRole("textbox", { name: "Description", exact: true })).toHaveValue("Exact unsent work");
});

for (const url of ["/?code=1", "/?folder=code"]) {
  test(`${url} authoritative wallet summaries permit repository review before signing`, async ({ page }) => {
    await fixture(page, { wallet: true });
    await page.goto(url);
    await page.getByRole("button", { name: "Connect UniSat", exact: true }).first().click();
    await page.getByRole("button", { name: "New repository", exact: true }).click();
    await page.getByRole("textbox", { name: "Repository name", exact: true }).fill("Wallet summary regression");
    await page.getByRole("button", { name: "Review repository", exact: true }).click();
    await expect(page.getByRole("dialog", { name: "Create public repository", exact: true })).toBeVisible();
    expect(await page.evaluate(() => window.codeSignatureCalls)).toBe(0);
  });
}

test("wallet account change invalidates an exact review before any signature", async ({ page }) => {
  await fixture(page, { wallet: true });
  await page.goto("/?code=1");
  await page.getByRole("button", { name: "Connect UniSat", exact: true }).click();
  await page.getByRole("button", { name: "New repository", exact: true }).click();
  await page.getByRole("textbox", { name: "Repository name", exact: true }).fill("Local wallet review");
  await page.getByRole("button", { name: "Review repository", exact: true }).click();
  await expect(page.getByRole("dialog", { name: "Create public repository", exact: true })).toBeVisible();
  expect(await page.evaluate(() => window.codeSignatureCalls)).toBe(0);
  await page.evaluate(address => window.codeWalletEvent("accountsChanged", [address]), foreign);
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page.getByText("Wallet account changed. Review Code actions again.", { exact: true })).toBeVisible();
  expect(await page.evaluate(() => window.codeSignatureCalls)).toBe(0);
});

const savedDraftKey = `proofofwork.code.draft.v1:livenet:${owner}`;
async function savedDraft(page) {
  return page.evaluate(key => JSON.parse(localStorage.getItem(key) ?? "{}"), savedDraftKey);
}
async function writeSourceDraft(page) {
  await page.getByRole("button", { name: "Add file", exact: true }).click();
  await page.getByRole("textbox", { name: "Exact file path", exact: true }).fill("src/retained.ts");
  await page.getByRole("textbox", { name: "Source text", exact: true }).fill("\ufeff// Exact unsent café\nconst retained = true;  \n");
  await page.getByRole("textbox", { name: "Commit message", exact: true }).fill("Keep every unsent byte");
  await page.getByRole("spinbutton", { name: "Fee proofs/vB", exact: true }).fill("0.2");
  await expect.poll(async () => (await savedDraft(page)).feeRate).toBe(0.2);
  return savedDraft(page);
}

for (const surface of ["code=1", "folder=code"]) {
  test(`${surface} restores the exact repository draft after back and reload without replacing its parent`, async ({ page }) => {
    await fixture(page, { wallet: true });
    await page.goto(`/?${surface}&repo=${id(1)}`);
    await page.getByRole("button", { name: "Connect UniSat", exact: true }).first().click();
    const retained = await writeSourceDraft(page);
    await page.getByRole("button", { name: "Save draft and back", exact: true }).click();
    await expect(page.getByRole("button", { name: "Resume draft", exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Add file", exact: true }).click();
    await expect(page.getByRole("textbox", { name: "Source text", exact: true })).toHaveValue(retained.content);
    expect(await savedDraft(page)).toEqual(retained);
    await page.getByRole("button", { name: "Save draft and back", exact: true }).click();
    await page.reload();
    await page.getByRole("button", { name: "Connect UniSat", exact: true }).first().click();
    await expect(page.getByRole("button", { name: "Resume draft", exact: true })).toBeVisible();
    const freshBaseline = page.waitForRequest(request => {
      const url = new URL(request.url());
      return url.pathname.endsWith("/api/v1/code-repository") && url.searchParams.get("fresh") === "1" &&
        url.searchParams.get("version") === retained.parent && url.searchParams.get("path") === retained.path;
    });
    await page.getByRole("button", { name: "Resume draft", exact: true }).click();
    await freshBaseline;
    await expect(page.getByRole("textbox", { name: "Exact file path", exact: true })).toHaveValue(retained.path);
    await expect(page.getByRole("textbox", { name: "Source text", exact: true })).toHaveValue(retained.content);
    await expect(page.getByRole("textbox", { name: "Commit message", exact: true })).toHaveValue(retained.message);
    await expect(page.getByRole("spinbutton", { name: "Fee proofs/vB", exact: true })).toHaveValue("0.2");
    expect(await savedDraft(page)).toEqual(retained);
    await page.getByRole("button", { name: "Changes", exact: true }).click();
    await expect(page.locator(".code-diff-added")).toContainText("const retained = true;");
    expect(await page.evaluate(() => window.codeSignatureCalls)).toBe(0);
  });

  test(`${surface} keeps a saved draft until an explicit replacement decision`, async ({ page }) => {
    const standalone = surface === "code=1";
    await page.setViewportSize({ width: standalone ? 320 : 800, height: 480 });
    await page.emulateMedia({ colorScheme: standalone ? "dark" : "light", reducedMotion: "reduce" });
    await fixture(page, { wallet: true });
    await page.goto(`/?${surface}&repo=${id(1)}`);
    await page.getByRole("button", { name: "Connect UniSat", exact: true }).first().click();
    const retained = await writeSourceDraft(page);
    await page.getByRole("button", { name: "Save draft and back", exact: true }).click();
    const edit = page.getByRole("button", { name: "Edit", exact: true });
    await edit.click();
    const decision = page.getByRole("dialog", { name: "Keep your saved draft?", exact: true });
    await expect(decision).toBeVisible();
    await expect(decision.getByRole("button", { name: "Keep draft", exact: true })).toBeFocused();
    await expect(decision.getByRole("button", { name: "Discard draft and continue", exact: true })).toBeInViewport();
    await page.screenshot({ path: `/tmp/proofofwork-code-draft-decision-${standalone ? "standalone-dark" : "computer-light"}.png` });
    expect(await savedDraft(page)).toEqual(retained);
    await page.keyboard.press("Escape");
    await expect(decision).toHaveCount(0);
    await expect(edit).toBeFocused();
    await page.getByRole("button", { name: "New repository", exact: true }).click();
    await expect(decision).toBeVisible();
    await decision.getByRole("button", { name: "Resume saved draft", exact: true }).click();
    await expect(page.getByRole("textbox", { name: "Source text", exact: true })).toHaveValue(retained.content);
    expect(await savedDraft(page)).toEqual(retained);
    await page.getByRole("button", { name: "Save draft and back", exact: true }).click();
    await page.getByRole("button", { name: "New repository", exact: true }).click();
    await decision.getByRole("button", { name: "Discard draft and continue", exact: true }).click();
    await expect(page.getByRole("textbox", { name: "Repository name", exact: true })).toHaveValue("");
    await expect.poll(async () => (await savedDraft(page)).content).toBe("");
    await page.getByRole("textbox", { name: "Repository name", exact: true }).fill("Another saved repository");
    await page.getByRole("button", { name: "Save draft and back", exact: true }).click();
    await page.getByRole("button", { name: "New repository", exact: true }).click();
    await expect(decision).toBeVisible();
    await decision.getByRole("button", { name: "Keep draft", exact: true }).click();
    expect((await savedDraft(page)).name).toBe("Another saved repository");
    expect(await page.evaluate(() => window.codeSignatureCalls)).toBe(0);
  });

  test(`${surface} shows reservation failures at the review action and preserves the draft`, async ({ page }) => {
    const standalone = surface === "code=1";
    const unavailableMessage = "Fresh wallet credit state is temporarily unavailable for d4e5ebf11d104d6a63fb74e42094364b25a5f7199a09e5c0e71408972466a8b8.";
    await page.setViewportSize({ width: standalone ? 320 : 1440, height: 480 });
    await page.emulateMedia({ colorScheme: standalone ? "light" : "dark", reducedMotion: "reduce" });
    await fixture(page, { wallet: true });
    await page.route("**/api/v1/token?**", route => route.fulfill({ status: 503,
      json: { error: unavailableMessage } }));
    await page.goto(`/?${surface}&repo=${id(1)}`);
    await page.getByRole("button", { name: "Connect UniSat", exact: true }).first().click();
    const retained = await writeSourceDraft(page);
    await page.getByRole("button", { name: "Review commit", exact: true }).click();
    const failure = page.getByRole("alert").filter({ hasText: unavailableMessage });
    await expect(failure).toBeVisible();
    await expect(failure).toBeFocused();
    await expect(failure).toBeInViewport();
    await expect(page.getByRole("button", { name: "Review commit", exact: true })).toBeInViewport();
    expect(await savedDraft(page)).toEqual(retained);
    expect(await page.evaluate(() => window.codeSignatureCalls)).toBe(0);
    await expect(page.getByRole("dialog")).toHaveCount(0);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
    await page.screenshot({ path: `/tmp/proofofwork-code-review-failure-${standalone ? "standalone-light" : "computer-dark"}.png` });
  });
}

test("a restored CRLF draft keeps its exact bytes while its old parent is being verified", async ({ page }) => {
  await fixture(page, { wallet: true });
  await page.goto(`/?code=1&repo=${id(1)}`);
  const retained = { kind: "put", name: "", description: "", repo: id(1), parent: id(2),
    path: "README.md", message: "Unsent older-parent change", content, feeRate: 0.2 };
  await page.evaluate(({ key, retained }) => localStorage.setItem(key, JSON.stringify(retained)), { key: savedDraftKey, retained });
  await page.getByRole("button", { name: "Connect UniSat", exact: true }).click();
  let releaseBaseline;
  const baselineGate = new Promise(resolve => { releaseBaseline = resolve; });
  await page.route("**/api/v1/code-repository?**", async route => {
    const url = new URL(route.request().url());
    if (url.searchParams.get("version") === id(2) && url.searchParams.get("path") === "README.md") await baselineGate;
    await route.fallback();
  });
  await page.getByRole("button", { name: "Resume draft", exact: true }).click();
  const editor = page.getByRole("textbox", { name: "Source text", exact: true });
  await expect(editor).toHaveValue(content.replace(/\r\n/gu, "\n"));
  expect(await savedDraft(page)).toEqual(retained);
  await editor.fill(`${content.replace(/\r\n/gu, "\n")}Another line.\n`);
  expect((await savedDraft(page)).content).toBe(`${content}Another line.\r\n`);
  expect((await savedDraft(page)).parent).toBe(id(2));
  releaseBaseline();
  await page.getByRole("button", { name: "Changes", exact: true }).click();
  await expect(page.locator(".code-diff-added")).toContainText("Another line.");
});

test("a wallet change dismisses replacement consent and preserves both scoped drafts", async ({ page }) => {
  await fixture(page, { wallet: true });
  await page.goto(`/?code=1&repo=${id(1)}`);
  await page.getByRole("button", { name: "Connect UniSat", exact: true }).click();
  const retained = await writeSourceDraft(page);
  const other = { ...retained, path: "foreign.ts", content: "Other wallet's exact draft\n" };
  await page.evaluate(({ foreign, other }) => localStorage.setItem(`proofofwork.code.draft.v1:livenet:${foreign}`, JSON.stringify(other)), { foreign, other });
  await page.getByRole("button", { name: "Save draft and back", exact: true }).click();
  await page.getByRole("button", { name: "New repository", exact: true }).click();
  await expect(page.getByRole("dialog", { name: "Keep your saved draft?", exact: true })).toBeVisible();
  await page.evaluate(address => window.codeWalletEvent("accountsChanged", [address]), foreign);
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await page.getByRole("button", { name: "Resume draft", exact: true }).click();
  await expect(page.getByRole("textbox", { name: "Source text", exact: true })).toHaveValue(other.content);
  expect(await savedDraft(page)).toEqual(retained);
  await page.evaluate(address => window.codeWalletEvent("accountsChanged", [address]), owner);
  await expect(page.getByRole("textbox", { name: "Source text", exact: true })).toHaveValue(retained.content);
  expect(await page.evaluate(address => JSON.parse(localStorage.getItem(`proofofwork.code.draft.v1:livenet:${address}`)), foreign)).toEqual(other);
});
