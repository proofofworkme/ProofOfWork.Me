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
    if (url.pathname === "/api/v1/token") return route.fulfill({ json: { network: "livenet", records: [], listings: [], source: "proof-indexer-fixture", walletScoped: true, authoritativeWallet: true, collectionHasMore: { listings: false } } });
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
    await fixture(page);
    await page.goto("/?code=1");
    await page.getByRole("button", { name: repo.name, exact: true }).click();
    await expect(page.locator(".code-source")).toContainText("window.codeInjected = true");
    await page.screenshot({ path: `/tmp/proofofwork-code-fixture-repository-${width}.png`, fullPage: true });
    expect(await page.evaluate(() => window.codeInjected)).toBeUndefined();
    const exact = page.waitForEvent("download");
    await page.getByRole("button", { name: "Download exact source" }).click();
    const sourceDownload = await exact;
    expect(await readFile(await sourceDownload.path())).toEqual(bytes);
    await page.getByRole("button", { name: "History", exact: true }).click();
    await expect(page.getByText("Stale competing edit", { exact: true })).toBeVisible();
    await expect(page.getByText("Unapplied", { exact: true })).toBeVisible();
    await page.locator(".code-history-entry").filter({ hasText: "Add exact README" }).getByRole("button", { name: "View version" }).click();
    await expect(page.getByText("Historical confirmed version", { exact: true })).toBeVisible();
    await expect(page.locator(".code-file-tree button")).toHaveCount(1);
    await page.getByRole("button", { name: "Return to main head", exact: true }).click();
    await expect(page.locator(".code-file-tree button")).toHaveCount(2);
    const archiveDownload = page.waitForEvent("download");
    await page.getByRole("button", { name: "Download ZIP", exact: true }).click();
    const zip = await archiveDownload;
    const archived = await readFile(await zip.path());
    expect(archived.readUInt32LE(0)).toBe(0x04034b50);
    expect(archived.includes(bytes)).toBe(true);
    expect(archived.includes(Buffer.from(empty.path))).toBe(true);
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
