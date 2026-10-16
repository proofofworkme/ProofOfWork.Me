import { expect, test } from "@playwright/test";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import * as bitcoin from "bitcoinjs-lib";

const id = value => value.toString(16).padStart(64, "0");
const owner = "bc1qfwytlzyr3ym3enz2eutwtjsf9kkf6uqkjydk3e";
const pageTxid = id(40);
const html = '\ufeff<!doctype html>\r\n<h1>Published café</h1>\r\n<script>window.pageReferenceExecuted = true</script>\r\n<p>Exact trailing spaces.  </p>\r\n';
const priorHtml = '<!doctype html>\r\n<h1>Previous page</h1>\r\n';
const attachmentHtml = '<!doctype html>\n<h1>Attachment source</h1>\n<script>window.pageReferenceExecuted = true</script>\n';
const digest = value => createHash("sha256").update(Buffer.from(value)).digest("hex");
const source = (content = html, kind = "body", vout = 1) => ({ kind, vout,
  name: kind === "body" ? "HTML message body" : "published.html", sha256: digest(content),
  size: Buffer.byteLength(content), content, contentBase64: Buffer.from(content).toString("base64") });
const currentSource = source();
const file = { path: "site/index.html", txid: id(3), sha256: currentSource.sha256, size: currentSource.size,
  sourceTxid: pageTxid, sourceKind: "body", sourceVout: 1 };
const priorFile = { path: file.path, txid: id(2), sha256: digest(priorHtml), size: Buffer.byteLength(priorHtml) };
const repo = { txid: id(1), repoTxid: id(1), name: "Referenced Pages repository", description: "Exact published HTML",
  ownerAddress: owner, headTxid: id(3), fileCount: 1, commitCount: 2 };
const snapshot = { id: "fixture-page-reference-snapshot", checkpointHeight: 971660, checkpointHash: "a".repeat(64) };
const evidence = { network: "livenet", complete: true, source: "proof-indexer-exact-canonical-code-replay", snapshot,
  indexedThroughBlock: snapshot.checkpointHeight, indexedThroughBlockHash: snapshot.checkpointHash };
const pageEvidence = (sources = [currentSource], sourceTxid = pageTxid) => ({ network: "livenet", complete: true,
  referenceEnabled: true, snapshot, sourceTxid, blockHeight: 971650, blockHash: "b".repeat(64), blockTransactionIndex: 8, sources });
const events = [{ txid: id(1), applied: true, confirmed: true, status: "confirmed", blockHeight: 971649 },
  { ...priorFile, parentTxid: id(1), message: "Upload original HTML", op: "put", applied: true, confirmed: true, status: "confirmed", blockHeight: 971650 },
  { ...file, parentTxid: id(2), message: "Reference published page", op: "reference", applied: true, confirmed: true, status: "confirmed", blockHeight: 971655 }];
const pagination = { limit: 30, total: events.length, hasMore: false, nextCursor: null };
const funding = new bitcoin.Transaction();
funding.addInput(Buffer.alloc(32, 1), 0);
funding.addOutput(bitcoin.address.toOutputScript(owner), 2_000_000n);
const utxo = { txid: funding.getId(), vout: 0, value: 2_000_000, status: { confirmed: true } };

async function fixture(page, options = {}) {
  const state = { pageReads: 0, writes: [], ...options };
  await page.addInitScript(({ owner, utxo, theme }) => {
    localStorage.setItem("proofofwork-me-appearance-v1", theme);
    const handlers = new Map();
    window.codeSignatureCalls = 0;
    window.codeAccounts = [owner];
    window.codeNetwork = "livenet";
    window.codeWalletEvent = (event, values) => {
      if (event === "accountsChanged") window.codeAccounts = values;
      if (event === "networkChanged") window.codeNetwork = values;
      for (const handler of handlers.get(event) ?? []) handler(values);
    };
    window.unisat = { getAccounts: async () => window.codeAccounts, requestAccounts: async () => window.codeAccounts,
      getNetwork: async () => window.codeNetwork, getBitcoinUtxos: async () => [utxo],
      getChain: async () => ({ enum: window.codeNetwork === "livenet" ? "BITCOIN_MAINNET" : window.codeNetwork === "testnet4" ? "BITCOIN_TESTNET4" : "BITCOIN_TESTNET" }),
      on: (event, handler) => handlers.set(event, [...(handlers.get(event) ?? []), handler]),
      removeListener: (event, handler) => handlers.set(event, (handlers.get(event) ?? []).filter(value => value !== handler)),
      signPsbt: async () => { window.codeSignatureCalls++; throw new Error("Rejected by disposable test wallet"); } };
  }, { owner, utxo, theme: options.theme ?? "dark" });
  await page.route("**/api/v1/**", async route => {
    const url = new URL(route.request().url());
    url.pathname = url.pathname.replace(/^\/test-api(?=\/api\/)/u, "");
    if (route.request().method() !== "GET") { state.writes.push(route.request().url()); return route.abort("blockedbyclient"); }
    if (url.pathname === "/api/v1/code-page-source") {
      state.pageReads++;
      if (state.readPage) return state.readPage(route, url, state.pageReads);
      return route.fulfill({ json: pageEvidence(state.sources, url.searchParams.get("txid")) });
    }
    if (url.pathname === "/api/v1/code-repositories") return route.fulfill({ json: { ...evidence, repositories: [repo], pagination: { ...pagination, total: 1 } } });
    if (url.pathname === "/api/v1/code-repository") {
      const version = url.searchParams.get("version") || repo.headTxid;
      const selected = version === id(1) ? null : version === id(2) ? priorFile : file;
      const content = version === id(2) ? priorHtml : html;
      const path = url.searchParams.get("path");
      return route.fulfill({ json: { ...evidence, repository: repo, version, files: selected ? [selected] : [], filesComplete: true,
        commits: events, events, pagination, ...(path !== null ? { file: selected && path === selected.path
          ? { ...selected, content, contentBase64: Buffer.from(content).toString("base64") } : null } : {}) } });
    }
    if (url.pathname.endsWith("/utxo")) return route.fulfill({ json: [utxo] });
    if (url.pathname.endsWith("/hex")) return route.fulfill({ json: { hex: funding.toHex() } });
    if (url.pathname.endsWith("/status")) return route.fulfill({ json: { status: "confirmed", confirmed: true } });
    if (url.pathname === "/api/v1/registry") return route.fulfill({ json: { network: "livenet", records: [], listings: [], coverage: { complete: true }, collectionHasMore: { listings: false } } });
    if (url.pathname === "/api/v1/token") return route.fulfill({ json: { network: "livenet", listings: [], source: "proof-indexer-wallet-token-overlay+proof-indexer-wallet-address-state", walletScoped: true, authoritativeWallet: true, summaryOnly: true } });
    if (url.pathname === "/api/v1/boost") return route.fulfill({ json: { network: "livenet", complete: true, items: [], hasMore: false } });
    return route.fulfill({ json: { records: [], items: [], listings: [], complete: true, minimumFee: 0.1, fastestFee: 1, halfHourFee: 1, hourFee: 1 } });
  });
  return state;
}

async function openReference(page, embedded = false) {
  await page.goto(`/?${embedded ? "folder=code" : "code=1"}&repo=${repo.txid}`);
  await page.getByRole("button", { name: "Connect UniSat", exact: true }).first().click();
  await page.getByRole("button", { name: "Add existing page", exact: true }).click();
  await page.getByRole("textbox", { name: "Exact file path", exact: true }).fill("pages/new.html");
  await page.getByRole("textbox", { name: "Published page TXID", exact: true }).fill(pageTxid);
  await page.getByRole("textbox", { name: "Commit message", exact: true }).fill("Reference this published page");
}

async function verifyPage(page) {
  await page.getByRole("button", { name: "Verify page", exact: true }).click();
  await expect(page.getByRole("button", { name: "Review commit", exact: true })).toBeEnabled();
}

async function inspectReview(page, selected = currentSource) {
  await page.getByRole("button", { name: "Review commit", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Add existing page to repository", exact: true });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByText("Existing transaction; HTML bytes are not republished", { exact: true })).toBeVisible();
  await dialog.getByText("Inspect exact transaction evidence", { exact: true }).click();
  const records = await dialog.locator(".review-protocol").allTextContents();
  expect(records).toHaveLength(2);
  expect(records[0]).toMatch(/^pwm1:m:/u);
  expect(records[1]).toMatch(/^pwc1:commit2:/u);
  const commitment = JSON.parse(Buffer.from(records[1].split(":")[2], "base64url").toString("utf8"));
  expect(commitment).toMatchObject({ v: 2, op: "reference", sourceTxid: pageTxid, sourceKind: selected.kind,
    sourceVout: selected.vout, sha256: selected.sha256, size: selected.size, path: "pages/new.html" });
  expect(records.some(value => value.startsWith("pwm1:a:") || value.includes(selected.content) || value.includes(selected.contentBase64))).toBe(false);
  expect(await page.evaluate(() => window.codeSignatureCalls)).toBe(0);
  return dialog;
}

for (const { width, theme, embedded } of [
  { width: 320, theme: "light", embedded: false }, { width: 320, theme: "dark", embedded: true },
  { width: 800, theme: "light", embedded: false }, { width: 800, theme: "dark", embedded: true },
  { width: 1440, theme: "dark", embedded: false }, { width: 1440, theme: "light", embedded: true },
]) {
  test(`existing page review is inert and reachable at ${width}px ${theme} ${embedded ? "Computer" : "standalone"}`, async ({ page }) => {
    await page.setViewportSize({ width, height: width < 1000 ? 480 : 900 });
    const state = await fixture(page, { theme });
    await openReference(page, embedded);
    await expect(page.getByRole("button", { name: "Review commit", exact: true })).toBeDisabled();
    await verifyPage(page);
    await expect(page.locator(".code-page-reference .code-source")).toHaveText(html);
    expect(await page.locator(".code-page-reference .code-source").textContent()).toBe(html);
    expect(await page.evaluate(() => window.pageReferenceExecuted)).toBeUndefined();
    await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
    expect(await page.evaluate(async () => {
      await document.fonts.ready;
      return { ui: document.fonts.check('16px "Inter Variable"'), mono: document.fonts.check('14px "IBM Plex Mono"') };
    })).toEqual({ ui: true, mono: true });
    await page.getByRole("textbox", { name: "Published page TXID", exact: true }).scrollIntoViewIfNeeded();
    await page.screenshot({ path: `/tmp/proofofwork-code-reference-editor-${width}-${theme}-${embedded ? "computer" : "standalone"}.png`, fullPage: true });
    const before = await page.evaluate(() => ({ width: document.documentElement.scrollWidth, viewport: innerWidth }));
    expect(before.width).toBeLessThanOrEqual(before.viewport + 1);
    const dialog = await inspectReview(page);
    await dialog.getByRole("button", { name: "Continue to wallet", exact: true }).focus();
    await page.keyboard.press("Tab");
    await expect(dialog.getByRole("button", { name: "Cancel", exact: true })).toBeFocused();
    await dialog.getByRole("heading", { name: "Add existing page to repository", exact: true }).scrollIntoViewIfNeeded();
    await page.screenshot({ path: `/tmp/proofofwork-code-reference-review-top-${width}-${theme}-${embedded ? "computer" : "standalone"}.png` });
    await dialog.getByRole("button", { name: "Continue to wallet", exact: true }).scrollIntoViewIfNeeded();
    await expect(dialog.getByRole("button", { name: "Continue to wallet", exact: true })).toBeInViewport();
    const dimensions = await dialog.evaluate(element => ({ scroll: element.scrollWidth, client: element.clientWidth }));
    expect(dimensions.scroll).toBeLessThanOrEqual(dimensions.client + 1);
    await page.screenshot({ path: `/tmp/proofofwork-code-reference-review-${width}-${theme}-${embedded ? "computer" : "standalone"}.png` });
    await page.keyboard.press("Escape");
    await expect(dialog).toHaveCount(0);
    await expect(page.getByRole("textbox", { name: "Published page TXID", exact: true })).toHaveValue(pageTxid);
    expect(state.pageReads).toBeGreaterThanOrEqual(3);
    expect(state.writes).toEqual([]);
  });
}

test("a page with both HTML carriers requires an explicit source selection", async ({ page }) => {
  await page.setViewportSize({ width: 800, height: 480 });
  const attachment = source(attachmentHtml, "attachment", 4);
  await fixture(page, { sources: [currentSource, attachment] });
  await openReference(page);
  await page.getByRole("button", { name: "Verify page", exact: true }).click();
  const chooser = page.getByRole("combobox", { name: "HTML source", exact: true });
  await expect(chooser).toHaveValue("");
  await expect(page.getByRole("button", { name: "Review commit", exact: true })).toBeDisabled();
  await chooser.selectOption("attachment:4");
  await expect(page.locator(".code-page-reference .code-source")).toHaveText(attachmentHtml);
  await inspectReview(page, attachment);
  expect(await page.evaluate(() => window.pageReferenceExecuted)).toBeUndefined();
});

test("a restored reference draft requires fresh verification before review", async ({ page }) => {
  const state = await fixture(page);
  await openReference(page);
  await verifyPage(page);
  await expect.poll(() => page.evaluate(owner => JSON.parse(localStorage.getItem(`proofofwork.code.draft.v1:livenet:${owner}`) ?? "{}").sourceTxid, owner)).toBe(pageTxid);
  await page.reload();
  await page.getByRole("button", { name: "Connect UniSat", exact: true }).first().click();
  await page.getByRole("link", { name: "All repositories", exact: true }).click();
  await page.getByRole("button", { name: "Resume draft", exact: true }).click();
  await expect(page.getByRole("textbox", { name: "Published page TXID", exact: true })).toHaveValue(pageTxid);
  await expect(page.getByRole("button", { name: "Review commit", exact: true })).toBeDisabled();
  await expect(page.locator(".code-page-reference .code-source")).toHaveCount(0);
  expect(state.pageReads).toBe(1);
  await verifyPage(page);
  expect(state.pageReads).toBe(2);
  expect(await page.evaluate(() => window.codeSignatureCalls)).toBe(0);
});

for (const reason of ["mismatch", "unavailable"]) {
  test(`fresh ${reason} page evidence prevents preparation after successful preview`, async ({ page }) => {
    await fixture(page, { readPage: (route, _url, count) => {
      if (count === 1) return route.fulfill({ json: pageEvidence() });
      return reason === "mismatch" ? route.fulfill({ json: pageEvidence([source(attachmentHtml)]) })
        : route.fulfill({ status: 503, json: { error: "Confirmed Page source is unavailable" } });
    } });
    await openReference(page);
    await verifyPage(page);
    await page.getByRole("button", { name: "Review commit", exact: true }).click();
    await expect(page.locator(".code-notice.is-error")).toContainText(reason === "mismatch" ? "differs from this reference" : "unavailable");
    await expect(page.getByRole("dialog")).toHaveCount(0);
    expect(await page.evaluate(() => window.codeSignatureCalls)).toBe(0);
  });
}

test("a corrupt preview never enables reference review", async ({ page }) => {
  await fixture(page, { sources: [{ ...currentSource, content: html.slice(1) }] });
  await openReference(page);
  await page.getByRole("button", { name: "Verify page", exact: true }).click();
  await expect(page.getByText("Source bytes do not match the confirmed file commitment.", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Review commit", exact: true })).toBeDisabled();
  await expect(page.locator(".code-page-reference .code-source")).toHaveCount(0);
});

for (const change of ["txid", "network"]) {
  test(`a late page response cannot revive verification after ${change} changes`, async ({ page }) => {
    let release;
    const gate = new Promise(resolve => { release = resolve; });
    const state = await fixture(page, { readPage: async (route, url) => {
      await gate;
      return route.fulfill({ json: pageEvidence(undefined, url.searchParams.get("txid")) });
    } });
    await openReference(page);
    await page.getByRole("button", { name: "Verify page", exact: true }).click();
    await expect.poll(() => state.pageReads).toBe(1);
    if (change === "txid") await page.getByRole("textbox", { name: "Published page TXID", exact: true }).fill(id(41));
    else await page.evaluate(() => window.codeWalletEvent("networkChanged", "testnet4"));
    const response = page.waitForResponse(value => new URL(value.url()).pathname.endsWith("/code-page-source"));
    release();
    await response;
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(resolve)));
    await expect(page.getByRole("button", { name: "Verifying page…", exact: true })).toHaveCount(0);
    await expect(page.locator(".code-page-reference .code-source")).toHaveCount(0);
    await expect(page.getByRole("dialog")).toHaveCount(0);
    if (change === "txid") await expect(page.getByRole("button", { name: "Review commit", exact: true })).toBeDisabled();
    else await expect(page.getByRole("button", { name: "Review repository", exact: true })).toBeDisabled();
    expect(await page.evaluate(() => window.codeSignatureCalls)).toBe(0);
  });
}

test("referenced files preserve source bytes in reads, downloads, ZIP and historical comparisons", async ({ page }) => {
  await fixture(page);
  await page.goto(`/?code=1&repo=${repo.txid}&path=${encodeURIComponent(file.path)}`);
  await expect(page.locator(".code-source")).toHaveText(html);
  expect(await page.locator(".code-source").textContent()).toBe(html);
  await expect(page.getByRole("link", { name: "Inspect page transaction", exact: true })).toHaveAttribute("href", new RegExp(pageTxid));
  expect(await page.evaluate(() => window.pageReferenceExecuted)).toBeUndefined();
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download exact source", exact: true }).click();
  expect(await readFile(await (await download).path())).toEqual(Buffer.from(html));
  const archive = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download ZIP", exact: true }).click();
  const zip = await readFile(await (await archive).path());
  expect(zip.readUInt32LE(0)).toBe(0x04034b50);
  expect(zip.includes(Buffer.from(html))).toBe(true);
  expect(zip.includes(Buffer.from(file.path))).toBe(true);
  await page.getByRole("button", { name: "History", exact: true }).click();
  await page.locator(".code-history-entry").filter({ hasText: "Reference published page" }).getByRole("button", { name: "Inspect change", exact: true }).click();
  await expect(page.locator(".code-diff-removed")).toContainText("Previous page");
  await expect(page.locator(".code-diff-added")).toContainText("Published café");
  await expect(page.locator(".code-history-inspector")).toContainText(pageTxid);
  await expect(page.locator(".code-diff-added")).toContainText("window.pageReferenceExecuted = true");
  expect(await page.evaluate(() => window.pageReferenceExecuted)).toBeUndefined();
  await page.locator(".code-history-entry").filter({ hasText: "Upload original HTML" }).getByRole("link", { name: "View version", exact: true }).click();
  await expect(page.locator(".code-source")).toHaveText(priorHtml);
});
