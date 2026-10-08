import { expect, test } from "@playwright/test";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";

import { ADDRESS, OTHER_ADDRESS, HASH, PAGE_TXID, FILE_TXID, LINK_TXID, CODE_REPO, CODE_VERSION,
  CODE_FILE_TXID, DNS_EPOCH, NOW, CHAIN_HTML, FILE_HTML, CODE_HTML, fixture, connect,
  activeDnsPageLink, expectNoSignature, RUNNER_POLICY } from "../fixtures/pagesFixture.mjs";
import { dnsChildPageSnapshot } from "../fixtures/dnsChildPageSnapshot.mjs";
import { parseDnsSubdomainPageLinkPayload } from "../../src/shared/protocol/dnsSubdomainPages.mjs";

async function source(page, html, title = "My local page") {
  const button = page.getByRole("button", { name: "Source", exact: true });
  try {
    await button.click();
  } catch (error) {
    if (!page.isClosed()) {
      const evidence = await button.evaluate(element => {
        const rect = element.getBoundingClientRect();
        const hit = document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2);
        return { source: rect.toJSON(), interceptor: hit?.outerHTML.slice(0, 1000),
          containers: [".pages-workspace", ".pages-editor-card", ".pages-status", ".mail-workspace"].map(selector => ({
            selector, rect: document.querySelector(selector)?.getBoundingClientRect().toJSON(),
            overflow: document.querySelector(selector) ? getComputedStyle(document.querySelector(selector)).overflow : undefined,
          })) };
      });
      const screenshot = `/tmp/pages-source-interception-${Date.now()}.png`;
      await page.screenshot({ path: screenshot, fullPage: true });
      console.error("Pages Source click evidence", JSON.stringify({ screenshot, ...evidence }));
    }
    throw error;
  }
  await page.getByLabel("Page title", { exact: true }).fill(title);
  await page.getByLabel("HTML source", { exact: true }).fill(html);
}


test("Pages keeps exact edited and imported source across reload and HTML download", async ({ page }) => {
  const state = await fixture(page);
  await page.goto("/?pages=1");
  const html = '<!doctype html>\n<html><body><h1>Alice &amp; the proofs</h1><style>h1 { color: olive; }</style></body></html>\n  ';
  await source(page, html, "Alice’s proof page");
  await expect.poll(() => page.evaluate(() => Object.keys(localStorage).some(key => key.startsWith("proofofwork.pages.drafts.v1.")))).toBe(true);
  await page.reload();
  await expect(page.getByLabel("Page title", { exact: true })).toHaveValue("Alice’s proof page");
  await expect(page.getByLabel("HTML source", { exact: true })).toHaveValue(html);
  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download HTML", exact: true }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toMatch(/\.html$/u);
  expect(await readFile(await download.path(), "utf8")).toBe(html);

  const imported = '<!doctype html>\n<html><body><h1>Imported source</h1><script>document.body.dataset.executed="yes"</script></body></html>\n\n';
  await page.getByTestId("pages-import").setInputFiles({ name: "imported-source.html", mimeType: "text/html", buffer: Buffer.from(imported) });
  await expect(page.getByLabel("HTML source", { exact: true })).toHaveValue(imported);
  await page.getByRole("button", { name: "Preview", exact: true }).click();
  await expect(page.locator('iframe[title="Pages app preview"]')).toHaveCount(0);
  const staticFrame = page.frameLocator(".pages-workspace iframe");
  await expect(staticFrame.getByRole("heading", { name: "Imported source", exact: true })).toBeVisible();
  await expect(staticFrame.locator("body")).not.toHaveAttribute("data-executed", "yes");
  await expectNoSignature(page, state);
});

test("Pages local drafts stay separate for disconnected and exact wallet accounts", async ({ page }) => {
  const state = await fixture(page);
  await page.goto("/?pages=1");
  await source(page, "<!doctype html><html><body>Disconnected work</body></html>", "Disconnected work");
  await connect(page);
  await expect(page.getByLabel("Page title", { exact: true })).not.toHaveValue("Disconnected work");
  await source(page, "<!doctype html><html><body>First account work</body></html>", "First account work");
  await page.evaluate(other => window.__pagesFixture.changeAccount(other), OTHER_ADDRESS);
  await expect(page.locator(".topbar-wallet-button")).toContainText("1F1p9UEH");
  await expect(page.getByLabel("Page title", { exact: true })).not.toHaveValue("First account work");
  await source(page, "<!doctype html><html><body>Second account work</body></html>", "Second account work");
  await page.evaluate(first => window.__pagesFixture.changeAccount(first), ADDRESS);
  await expect(page.getByLabel("Page title", { exact: true })).toHaveValue("First account work");
  const titles = await page.evaluate(() => Object.keys(localStorage).filter(key => key.startsWith("proofofwork.pages.drafts.v1."))
    .map(key => JSON.parse(localStorage.getItem(key)).drafts.map(draft => draft.title)).flat());
  expect(titles).toEqual(expect.arrayContaining(["Disconnected work", "First account work", "Second account work"]));
  await expectNoSignature(page, state);
});

test("Run app enables local interaction while isolating parent, storage, wallet and network", async ({ page }) => {
  const state = await fixture(page);
  await page.goto("/?pages=1");
  const html = `<!doctype html><html><body><button id="add">Add proof</button><output id="counter">0</output><pre id="scope"></pre>
    <script>let count=0; document.querySelector('#add').onclick=()=>document.querySelector('#counter').textContent=String(++count);
    const evidence={wallet:typeof window.unisat};
    try { parent.document.body.dataset.pagesEscape='yes'; evidence.parent='exposed'; } catch { evidence.parent='blocked'; }
    try { localStorage.setItem('pages-escape','yes'); evidence.storage='exposed'; } catch { evidence.storage='blocked'; }
    document.querySelector('#scope').textContent=JSON.stringify(evidence);
    fetch('https://example.invalid/pages-test-network/fetch').catch(()=>{});
    </script><img src="https://example.invalid/pages-test-network/image"></body></html>`;
  await source(page, html, "Local counter");
  await page.getByRole("button", { name: "Preview", exact: true }).click();
  await expect(page.frameLocator(".pages-workspace iframe").locator("#counter")).toHaveText("0");
  await page.getByRole("button", { name: "Run app", exact: true }).click();
  const iframe = page.locator('iframe[title="Pages app preview"]');
  await expect(iframe).toHaveAttribute("sandbox", "allow-scripts");
  const app = page.frameLocator('iframe[title="Pages app preview"]');
  await expect(app.locator("#scope")).toHaveText('{"wallet":"undefined","parent":"blocked","storage":"blocked"}');
  await app.getByRole("button", { name: "Add proof", exact: true }).click();
  await expect(app.locator("#counter")).toHaveText("1");
  expect(await page.evaluate(() => ({ escaped: document.body.dataset.pagesEscape, storage: localStorage.getItem("pages-escape") }))).toEqual({ escaped: undefined, storage: null });
  expect(state.external).toEqual([]);
  await page.getByRole("button", { name: "Stop app", exact: true }).click();
  await expect(iframe).toHaveCount(0);
  await page.getByRole("button", { name: "Run app", exact: true }).click();
  await expect(app.locator("#counter")).toHaveText("0");
  await page.getByRole("button", { name: "Source", exact: true }).click();
  await page.getByRole("button", { name: "Preview", exact: true }).click();
  await expect(iframe).toHaveCount(0);
  await expect(page.frameLocator(".pages-workspace iframe").locator("#counter")).toHaveText("0");
  await page.getByRole("button", { name: "Run app", exact: true }).click();
  await expect(app.locator("#counter")).toHaveText("0");
  await page.getByRole("button", { name: "Source", exact: true }).click();
  await page.getByLabel("HTML source", { exact: true }).fill(html.replace("Local counter", "Edited counter") + "\n");
  await expect(iframe).toHaveCount(0);
  await expectNoSignature(page, state);
});

test("Pages parent frame policy contains external document navigation", async ({ page }) => {
  const state = await fixture(page);
  await page.goto("/?pages=1");
  const html = '<!doctype html><html><body><button id="navigate">Navigate app</button><script>document.querySelector("#navigate").onclick=()=>location.assign("https://example.invalid/pages-test-network/document");</script></body></html>';
  await source(page, html, "Navigation boundary");
  await page.getByRole("button", { name: "Preview", exact: true }).click();
  await page.getByRole("button", { name: "Run app", exact: true }).click();
  const app = page.frameLocator('iframe[title="Pages app preview"]');
  await app.getByRole("button", { name: "Navigate app", exact: true }).click();
  await page.waitForTimeout(250); // allow the browser's attempted navigation to be refused
  await expect(page).toHaveURL(/\?pages=1$/u);
  expect(state.external).toEqual([]);
  await expectNoSignature(page, state);
});

test("Direct Pages runner opening retains its HTTP sandbox and exposes no wallet or storage", async ({ page }) => {
  const directHtml = '<!doctype html><html><body><pre id="scope"></pre><script>let result;try{localStorage.setItem("runner-escape","yes");result="exposed"}catch{result="blocked"}document.querySelector("#scope").textContent=result+":"+typeof window.unisat;</script></body></html>';
  const response = await page.request.get("/pages-runner.html");
  expect(response.status()).toBe(200);
  expect(response.headers()["content-security-policy"]).toBe(RUNNER_POLICY);
  await page.goto(`/pages-runner.html#${encodeURIComponent(directHtml)}`, { waitUntil: "commit" });
  await expect(page.locator("#scope")).toHaveText("blocked:undefined");
});

for (const confirmed of [true, false]) {
  test(`Pages loads ${confirmed ? "confirmed" : "pending"} chain HTML as inert local source with preserved bytes`, async ({ page }) => {
    const state = await fixture(page, { chainConfirmed: confirmed });
    await page.goto("/?pages=1");
    await page.getByLabel("Transaction ID", { exact: true }).fill(PAGE_TXID);
    await page.getByRole("button", { name: "Load HTML", exact: true }).click();
    await expect(page.getByLabel("HTML source", { exact: true })).toHaveValue(CHAIN_HTML);
    await expect(page.locator(".pages-workspace")).toContainText(confirmed ? "Confirmed" : "Pending");
    await page.getByRole("button", { name: "Preview", exact: true }).click();
    await expect(page.locator('iframe[title="Pages app preview"]')).toHaveCount(0);
    await expect(page.frameLocator(".pages-workspace iframe").getByRole("heading", { name: "Chain source", exact: true })).toBeVisible();
    await expect(page.frameLocator(".pages-workspace iframe").locator("body")).not.toHaveAttribute("data-executed", "yes");
    await expectNoSignature(page, state);
  });
}

test("Pages inserts confirmed identity fields and refuses pending identities without changing source", async ({ page }) => {
  const state = await fixture(page);
  await page.goto("/?pages=1");
  await source(page, "<!doctype html><html><body><h1>My identity</h1></body></html>");
  await page.getByLabel("ProofOfWork ID", { exact: true }).fill("alice@proofofwork.me");
  await page.getByRole("button", { name: "Insert identity", exact: true }).click();
  await expect(page.getByLabel("HTML source", { exact: true })).toHaveValue(new RegExp(ADDRESS));
  await expect(page.getByLabel("HTML source", { exact: true })).toHaveValue(new RegExp(OTHER_ADDRESS));
  const confirmedSource = await page.getByLabel("HTML source", { exact: true }).inputValue();
  await page.getByLabel("ProofOfWork ID", { exact: true }).fill("pending@proofofwork.me");
  await page.getByRole("button", { name: "Insert identity", exact: true }).click();
  await expect(page.locator(".pages-workspace")).toContainText("Pending IDs cannot establish identity");
  await expect(page.getByLabel("HTML source", { exact: true })).toHaveValue(confirmedSource);
  await expectNoSignature(page, state);
});

async function chooseCodeHtml(page, version = "") {
  await page.getByLabel("Repository creation txid", { exact: true }).fill(CODE_REPO);
  await page.getByLabel("HTML file path", { exact: true }).fill("site/index.html");
  await page.getByLabel("Version txid (optional)", { exact: true }).fill(version);
  await page.getByRole("button", { name: "Import Code HTML", exact: true }).click();
}

for (const [label, path] of [["standalone", "/?pages=1"], ["Computer", "/?folder=pages"]]) {
  test(`${label} Pages imports exact confirmed Code HTML without treating a Code commit as a page transaction`, async ({ page }) => {
    const state = await fixture(page);
    await page.goto(path);
    if (label === "Computer") await connect(page);
    await chooseCodeHtml(page);
    await expect(page.getByLabel("HTML source", { exact: true })).toHaveValue(CODE_HTML);
    await expect(page.getByLabel("Page title", { exact: true })).toHaveValue("index");
    await expect(page.locator(".pages-status")).toContainText("Verified Code HTML imported");
    await expect(page.getByLabel("Published page txid", { exact: true })).toHaveValue("");
    await expect(page.locator(".pages-source-evidence")).toHaveCount(0);
    const reads = state.requests.filter(url => url.pathname === "/api/v1/code-repository");
    expect(reads).toHaveLength(2);
    expect(reads[0].searchParams.get("fresh")).toBe("1");
    expect(reads[1].searchParams.get("snapshot")).toBe("fixture-code-snapshot");
    expect(reads[1].searchParams.get("version")).toBe(CODE_VERSION);
    expect(reads[1].searchParams.get("path")).toBe("site/index.html");
    await expect(page.getByRole("link", { name: "Open Code", exact: true })).toHaveAttribute("href", /code=1.*repo=/u);
    await page.getByRole("button", { name: "Preview", exact: true }).click();
    await expect(page.frameLocator(".pages-workspace iframe").getByRole("heading", { name: "Confirmed Code source" })).toBeVisible();
    await expect(page.frameLocator(".pages-workspace iframe").locator("body")).not.toHaveAttribute("data-executed", "yes");
    await page.reload();
    if (label === "Computer") await connect(page);
    await expect(page.getByLabel("HTML source", { exact: true })).toHaveValue(CODE_HTML);
    await expectNoSignature(page, state);
  });
}

for (const [label, alter, errorText] of [
  ["incomplete history", (_url, json) => ({ ...json, complete: false }), "Complete confirmed Code evidence is unavailable"],
  ["changed source bytes", (url, json) => url.searchParams.has("path") ? { ...json, file: { ...json.file, contentBase64: Buffer.from("tampered").toString("base64") } } : json, "Source bytes do not match"],
  ["snapshot drift", (url, json) => url.searchParams.has("path") ? { ...json, snapshot: { ...json.snapshot, id: "different-snapshot" } } : json, "Repository snapshot changed"],
  ["version drift", (url, json) => url.searchParams.has("path") ? { ...json, version: PAGE_TXID, selectedVersionTxid: PAGE_TXID } : json, "returned repository version differs"],
  ["tree commitment drift", (url, json) => url.searchParams.has("path") ? { ...json, file: { ...json.file, sha256: PAGE_TXID } } : json, "Returned source evidence differs"],
]) {
  test(`Pages refuses Code import with ${label} and preserves the local source`, async ({ page }) => {
    const state = await fixture(page);
    state.codeReply = alter;
    await page.goto("/?pages=1");
    const html = "<!doctype html><html><body>Work to keep</body></html>";
    await source(page, html);
    await chooseCodeHtml(page, CODE_VERSION);
    await expect(page.locator(".pages-status")).toContainText(errorText);
    await expect(page.getByLabel("HTML source", { exact: true })).toHaveValue(html);
    await expect(page.getByLabel("Published page txid", { exact: true })).toHaveValue("");
    await expectNoSignature(page, state);
  });
}

test("Pages fences a delayed Code import when the connected wallet changes", async ({ page }) => {
  const state = await fixture(page);
  let releaseReply;
  const replyGate = new Promise(resolve => { releaseReply = resolve; });
  let fileRequested;
  const fileGate = new Promise(resolve => { fileRequested = resolve; });
  state.codeReply = async (url, json) => {
    if (url.searchParams.has("path")) { fileRequested(); await replyGate; }
    return json;
  };
  await page.goto("/?pages=1");
  await connect(page);
  await chooseCodeHtml(page);
  await fileGate;
  await page.evaluate(other => window.__pagesFixture.changeAccount(other), OTHER_ADDRESS);
  await expect(page.locator(".topbar-wallet-button")).toContainText("1F1p9UEH");
  releaseReply();
  await expect(page.getByLabel("Page title", { exact: true })).not.toHaveValue("index");
  await expect(page.getByLabel("HTML source", { exact: true })).not.toHaveValue(CODE_HTML);
  await expect(page.getByRole("button", { name: "Import Code HTML", exact: true })).toBeDisabled();
  const sources = await page.evaluate(() => Object.keys(localStorage).filter(key => key.startsWith("proofofwork.pages.drafts.v1."))
    .flatMap(key => JSON.parse(localStorage.getItem(key)).drafts.map(draft => draft.html)));
  expect(sources).not.toContain(CODE_HTML);
  await expectNoSignature(page, state);
});

test("Pages DNS linking requires a connected Mainnet owner and accepts roots and one child level", async ({ page }) => {
  const state = await fixture(page);
  await page.goto("/?pages=1");
  const card = page.getByRole("region", { name: "DNS page linking", exact: true });
  await card.getByLabel(".pow name", { exact: true }).fill(" ALICE.POW ");
  await card.getByLabel("Published page txid", { exact: true }).fill(PAGE_TXID);
  await expect(card.getByRole("button", { name: "Review page link", exact: true })).toBeDisabled();
  await expect(card.getByRole("link", { name: "Open name in Browser", exact: true })).toHaveAttribute("href", /name=alice\.pow/u);
  await connect(page);
  await expect(card.getByLabel(".pow name", { exact: true })).toHaveValue("");
  await card.getByLabel(".pow name", { exact: true }).fill(" ALICE.POW ");
  await card.getByLabel("Published page txid", { exact: true }).fill(PAGE_TXID);
  await expect(card.getByRole("button", { name: "Review page link", exact: true })).toBeEnabled();
  await card.getByLabel(".pow name", { exact: true }).fill("child.alice.pow");
  await expect(card.getByRole("button", { name: "Review page link", exact: true })).toBeEnabled();
  await expect(card.getByRole("link", { name: "Open name in Browser", exact: true })).toHaveAttribute("href", /name=child\.alice\.pow/u);
  await card.getByLabel(".pow name", { exact: true }).fill("deep.child.alice.pow");
  await expect(card.getByRole("button", { name: "Review page link", exact: true })).toBeDisabled();
  await expect(card.getByRole("link", { name: "Open name in Browser", exact: true })).toHaveCount(0);
  await expectNoSignature(page, state);
});

test("Pages suggests a DNS txid only for unchanged confirmed imported source", async ({ page }) => {
  const state = await fixture(page);
  await page.goto(`/?pages=1&txid=${PAGE_TXID}`);
  const txid = page.getByLabel("Published page txid", { exact: true });
  await expect(txid).toHaveValue(PAGE_TXID);
  await source(page, CHAIN_HTML.replace("Chain source", "Changed source"));
  await expect(txid).toHaveValue("");
  await txid.fill(FILE_TXID);
  await source(page, CHAIN_HTML.replace("Chain source", "Another local edit"));
  await expect(txid).toHaveValue(FILE_TXID);
  await page.getByLabel("Transaction ID", { exact: true }).fill(PAGE_TXID);
  state.chainConfirmed = false;
  await page.getByRole("button", { name: "Load HTML", exact: true }).click();
  await expect(page.locator(".pages-source-evidence")).toContainText("Status at import: Pending");
  await txid.fill("");
  await source(page, CHAIN_HTML.replace("Chain source", "Pending source edit"));
  await expect(txid).toHaveValue("");
  await expectNoSignature(page, state);
});

for (const [label, path] of [["standalone", "/?pages=1"], ["Computer", "/?folder=pages"]]) {
  test(`${label} Pages reviews a root DNS link without publishing the local draft or requesting a signature`, async ({ page }) => {
    const state = await fixture(page);
    await page.goto(path);
    await connect(page);
    const html = "<!doctype html><html><body>Unpublished local work</body></html>";
    await source(page, html, "Unpublished local work");
    const card = page.getByRole("region", { name: "DNS page linking", exact: true });
    await card.getByLabel(".pow name", { exact: true }).fill(" ALICE.POW ");
    await card.getByLabel("Published page txid", { exact: true }).fill(PAGE_TXID.toUpperCase());
    await card.getByRole("button", { name: "Review page link", exact: true }).click();
    const review = page.getByRole("dialog", { name: "Review .pow page link", exact: true });
    await expect(review).toBeVisible();
    await expect(review).toContainText("alice.pow");
    await expect(review).toContainText(PAGE_TXID);
    await expect(review).toContainText(`${DNS_EPOCH.txid}:1:0`);
    await expect(review).toContainText("546 proofs");
    await expect(review).toContainText(ADDRESS);
    await review.getByText("Inspect exact transaction evidence", { exact: true }).click();
    await expect(review).toContainText("pwdns1:page1:");
    await expect(review).not.toContainText("Unpublished local work");
    await expectNoSignature(page, state);
    await review.getByRole("button", { name: "Cancel", exact: true }).click();
    await expect(review).toHaveCount(0);
    await expect(page.getByLabel("HTML source", { exact: true })).toHaveValue(html);
    expect(await page.evaluate(address => localStorage.getItem(`proofofwork.draft.v1:livenet:${address}`), ADDRESS)).toBeNull();
    await expectNoSignature(page, state);
  });
}

for (const [label, path] of [["standalone", "/?pages=1"], ["Computer", "/?folder=pages"]]) {
  test(`${label} Pages reviews an exact child content link and owner self-payment`, async ({ page }) => {
    const state = await fixture(page); state.dns = dnsChildPageSnapshot();
    await page.goto(path); await connect(page);
    const card = page.getByRole("region", { name: "DNS page linking", exact: true });
    await card.getByLabel(".pow name", { exact: true }).fill(" APP.ALICE.POW ");
    await card.getByLabel("Published page txid", { exact: true }).fill(PAGE_TXID);
    await card.getByRole("button", { name: "Review page link", exact: true }).click();
    const review = page.getByRole("dialog", { name: "Review .pow page link", exact: true });
    await expect(review).toBeVisible();
    await expect(review).toContainText("app.alice.pow");
    await expect(review).toContainText("546 proofs");
    await expect(review).toContainText(`${state.dns.record.childLifecycle.txid}:1:0`);
    await review.getByText("Inspect exact transaction evidence", { exact: true }).click();
    const payload = await review.locator("pre").filter({ hasText: /^pwdns1:subpage1:/u }).textContent();
    expect(parseDnsSubdomainPageLinkPayload(payload)).toEqual({ action: "set", parent: "alice", label: "app",
      epoch: state.dns.parentRecord.ownershipEpoch, child: state.dns.record.childLifecycle, pageTxid: PAGE_TXID });
    await expectNoSignature(page, state);
    await review.getByRole("button", { name: "Cancel", exact: true }).click();
    await expectNoSignature(page, state);
  });
}

test("Pages clears only an active confirmed link and preserves payment resolver state", async ({ page }) => {
  const state = await fixture(page);
  state.dns.pageLink = activeDnsPageLink();
  await page.goto("/?pages=1");
  await connect(page);
  const card = page.getByRole("region", { name: "DNS page linking", exact: true });
  await card.getByLabel(".pow name", { exact: true }).fill("alice");
  await card.getByRole("button", { name: "Review clear link", exact: true }).click();
  const review = page.getByRole("dialog", { name: "Review .pow page unlink", exact: true });
  await expect(review).toBeVisible();
  await expect(review).toContainText("alice.pow");
  await expect(review).toContainText("546 proofs");
  await expect(review).toContainText(OTHER_ADDRESS);
  await review.getByText("Inspect exact transaction evidence", { exact: true }).click();
  await expect(review).toContainText("pwdns1:page1:");
  await expectNoSignature(page, state);
  await review.getByRole("button", { name: "Cancel", exact: true }).click();
  expect(state.dns.record.receiveAddress).toBe(OTHER_ADDRESS);
  state.dns.pageLink = null;
  await card.getByRole("button", { name: "Review clear link", exact: true }).click();
  await expect(page.locator(".pages-status")).toContainText("no active Pages link to clear");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expectNoSignature(page, state);
});

for (const [label, change, reason] of [
  ["disabled activation", state => { state.dns.pageLinkAdmission = { ready: false, reason: "Page-link activation is not pinned." }; }, "activation is not pinned"],
  ["incomplete discovery", state => { state.dns.pageLinkCoverage.complete = false; }, "coverage is unavailable"],
  ["different checkpoint", state => { state.dns.pageLinkCoverage.checkpointHash = FILE_TXID; }, "coverage is unavailable"],
  ["other owner", state => { state.dns.record.ownerAddress = OTHER_ADDRESS; }, "Only the current confirmed .pow owner"],
  ["contradictory confirmed root row", state => { state.dns.records = [{ ...state.dns.record, ownerAddress: OTHER_ADDRESS }]; }, "records disagree"],
  ["pending target", state => { state.chainConfirmed = false; }, "confirmed"],
  ["non-HTML target", state => { state.chainHtml = "An ordinary message with no page markup"; }, "HTML"],
]) {
  test(`Pages refuses DNS link review for ${label}`, async ({ page }) => {
    const state = await fixture(page); change(state);
    await page.goto("/?pages=1");
    await connect(page);
    const card = page.getByRole("region", { name: "DNS page linking", exact: true });
    await card.getByLabel(".pow name", { exact: true }).fill("alice.pow");
    await card.getByLabel("Published page txid", { exact: true }).fill(PAGE_TXID);
    await card.getByRole("button", { name: "Review page link", exact: true }).click();
    await expect(page.locator(".pages-status")).toContainText(reason);
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await expectNoSignature(page, state);
  });
}

test("Pages rechecks the DNS ownership epoch before requesting a wallet signature", async ({ page }) => {
  const state = await fixture(page);
  await page.goto("/?pages=1");
  await connect(page);
  const card = page.getByRole("region", { name: "DNS page linking", exact: true });
  await card.getByLabel(".pow name", { exact: true }).fill("alice.pow");
  await card.getByLabel("Published page txid", { exact: true }).fill(PAGE_TXID);
  await card.getByRole("button", { name: "Review page link", exact: true }).click();
  const review = page.getByRole("dialog", { name: "Review .pow page link", exact: true });
  await expect(review).toBeVisible();
  await expect(page.getByLabel("HTML source", { exact: true })).toBeDisabled();
  await expect(page.getByRole("button", { name: "Source", exact: true })).toBeDisabled();
  state.dns.record.ownershipEpoch = { ...DNS_EPOCH, txid: FILE_TXID };
  await review.getByRole("button", { name: "Continue to wallet", exact: true }).click();
  await expect(page.locator(".pages-status")).toContainText("ownership period changed");
  await expectNoSignature(page, state);
});

test("Repeated Pages DNS submission prepares one review and requests no signature", async ({ page }) => {
  const state = await fixture(page);
  await page.goto("/?pages=1");
  await connect(page);
  const card = page.getByRole("region", { name: "DNS page linking", exact: true });
  await card.getByLabel(".pow name", { exact: true }).fill("alice.pow");
  await card.getByLabel("Published page txid", { exact: true }).fill(PAGE_TXID);
  const before = state.requests.filter(url => url.pathname === "/api/v1/dns/alice").length;
  await card.locator("form").evaluate(form => {
    form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
  });
  const review = page.getByRole("dialog", { name: "Review .pow page link", exact: true });
  await expect(review).toBeVisible();
  expect(state.requests.filter(url => url.pathname === "/api/v1/dns/alice").length - before).toBe(1);
  await expectNoSignature(page, state);
  await review.getByRole("button", { name: "Cancel", exact: true }).click();
});

test("Pages restores a retained DNS link task for inspection and fences it from another wallet account", async ({ page }) => {
  const state = await fixture(page);
  const receipt = { txid: LINK_TXID, address: ADDRESS, network: "livenet",
    title: "Review .pow page link", key: "dns-page-link:alice", createdAt: NOW, status: "dropped",
    fields: [["DNS name", "alice.pow"], ["Link action", "set"], ["Confirmed owner", ADDRESS],
      ["Ownership period", `${DNS_EPOCH.txid}:1:0`], ["Pages transaction", PAGE_TXID]] };
  await page.addInitScript(receipt => {
    if (window === window.top) localStorage.setItem("proofofwork-action-receipts-v1", JSON.stringify([receipt]));
  }, receipt);
  await page.goto("/?pages=1");
  await connect(page);
  const recovery = page.getByRole("region", { name: "Transaction recovery", exact: true });
  await expect(recovery).toBeVisible();
  await recovery.locator(".action-recovery-disclosure > summary").click();
  await recovery.locator(".action-recovery-history > summary").click();
  await recovery.getByRole("button", { name: "Restore task fields", exact: true }).click();
  const card = page.getByRole("region", { name: "DNS page linking", exact: true });
  await expect(card.getByLabel(".pow name", { exact: true })).toHaveValue("alice.pow");
  await expect(card.getByLabel("Published page txid", { exact: true })).toHaveValue(PAGE_TXID);
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expectNoSignature(page, state);
  await page.evaluate(other => window.__pagesFixture.changeAccount(other), OTHER_ADDRESS);
  await expect(page.locator(".topbar-wallet-button")).toContainText("1F1p9UEH");
  await expect(card.getByLabel(".pow name", { exact: true })).toHaveValue("");
  await expect(card.getByLabel("Published page txid", { exact: true })).toHaveValue("");
  await expect(recovery).toHaveCount(0);
  await expectNoSignature(page, state);
});

test("Computer Pages imports confirmed Files HTML and preserves the original source record", async ({ page }) => {
  const state = await fixture(page);
  await page.goto("/?folder=pages");
  await connect(page);
  const files = page.getByRole("combobox", { name: "Verified HTML file", exact: true });
  await expect(files.locator("option")).toContainText(["Choose a file", "verified-source.html"]);
  await files.selectOption({ label: "verified-source.html" });
  await page.getByRole("button", { name: "Import from Files", exact: true }).click();
  await expect(page.getByLabel("HTML source", { exact: true })).toHaveValue(FILE_HTML);
  await source(page, FILE_HTML.replace("Verified file source", "Local file edit"));
  await page.locator(".sidebar").getByRole("button", { name: /^Files/ }).click();
  await expect(page.locator(".file-tile")).toHaveCount(1);
  await expect(page.locator(".file-inspector")).toContainText("verified-source.html");
  expect(state.writes).toEqual([]);
  await expectNoSignature(page, state);
});

for (const [label, path] of [["standalone", "/?pages=1"], ["Computer", "/?folder=pages"]]) {
  test(`${label} Pages stages exact HTML into reviewed Mail without requesting a signature`, async ({ page }) => {
    const state = await fixture(page);
    await page.goto(path);
    await connect(page);
    const html = "<!doctype html>\n<html><body><h1>Publication source</h1></body></html>\n ";
    await source(page, html, "Publication source");
    await page.getByRole("button", { name: "Review publication", exact: true }).click();
    const composer = label === "standalone" ? page.getByRole("region", { name: "Page publication", exact: true }) : page.locator(".compose-pane");
    await expect(composer.getByLabel("To", { exact: true })).toHaveValue(ADDRESS);
    await expect(composer.getByLabel("Subject", { exact: true })).toHaveValue("Publication source");
    await expect(composer.getByRole("textbox", { name: "Message", exact: true })).toHaveValue(html);
    await expect(composer.getByRole("button", { name: "Send", exact: true })).toBeEnabled();
    await composer.getByRole("button", { name: "Send", exact: true }).click();
    const review = page.getByRole("dialog", { name: "Review mail transaction", exact: true });
    await expect(review).toBeVisible();
    await expect(review).toContainText(ADDRESS);
    await expect(review).toContainText("546 proofs");
    await expectNoSignature(page, state);
    await review.getByRole("button", { name: "Cancel", exact: true }).click();
    await expect(review).toHaveCount(0);
    await expect(composer.getByRole("textbox", { name: "Message", exact: true })).toHaveValue(html);
    if (label === "Computer") await page.locator(".sidebar").getByRole("button", { name: "Pages", exact: true }).click();
    await expect(page.getByLabel("HTML source", { exact: true })).toHaveValue(html);
    await expectNoSignature(page, state);
  });
}

test("Pages stages an exact HTML attachment with reviewed filename, byte count and digest", async ({ page }) => {
  const state = await fixture(page);
  await page.goto("/?pages=1");
  await connect(page);
  const html = "<!doctype html>\n<html><body><h1>Attachment proofs é</h1></body></html>\n  ";
  const bytes = Buffer.from(html);
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  await source(page, html, "Attachment proofs");
  await page.getByRole("combobox", { name: "Publication format", exact: true }).selectOption("attachment");
  await page.getByRole("button", { name: "Review publication", exact: true }).click();
  const composer = page.getByRole("region", { name: "Page publication", exact: true });
  await expect(composer.getByRole("textbox", { name: "Message", exact: true })).toHaveValue("");
  await expect(composer.locator(".attachment-card")).toContainText("Attachment-proofs.html");
  await expect(composer.locator(".attachment-card")).toContainText(`text/html · ${bytes.length} B`);
  const draft = await page.evaluate(address => JSON.parse(localStorage.getItem(`proofofwork.draft.v1:livenet:${address}`)), ADDRESS);
  expect(draft.attachment).toMatchObject({ name: "Attachment-proofs.html", mime: "text/html", size: bytes.length, sha256 });
  expect(Buffer.from(draft.attachment.data, "base64url")).toEqual(bytes);
  await composer.getByRole("button", { name: "Send", exact: true }).click();
  const review = page.getByRole("dialog", { name: "Review mail transaction", exact: true });
  await expect(review).toBeVisible();
  await review.getByText("Inspect message and transaction evidence", { exact: true }).click();
  await expect(review).toContainText(`File: Attachment-proofs.html · ${bytes.length} bytes`);
  await expect(review).toContainText(`SHA-256: ${sha256}`);
  await expectNoSignature(page, state);
  await review.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(review).toHaveCount(0);
  await expect(composer.locator(".attachment-card")).toContainText("Attachment-proofs.html");
  await expectNoSignature(page, state);
});

test("Pages preserves an existing Mail draft and lets the user resume it instead of replacing it", async ({ page }) => {
  const mailDraft = { network: "livenet", from: ADDRESS, recipient: OTHER_ADDRESS,
    subject: "Existing Mail task", memo: "Keep this unsent message", amountSats: 546,
    feeRate: 1, workAmount: "0", updatedAt: NOW };
  const state = await fixture(page, { mailDraft });
  await page.goto("/?pages=1");
  await connect(page);
  await source(page, "<!doctype html><html><body>Separate Pages work</body></html>", "Separate Pages work");
  await page.getByRole("button", { name: "Review publication", exact: true }).click();
  await expect(page.locator(".pages-workspace")).toContainText("Your saved publication is preserved");
  await expect(page.getByRole("region", { name: "Page publication", exact: true })).toHaveCount(0);
  const retained = await page.evaluate(address => JSON.parse(localStorage.getItem(`proofofwork.draft.v1:livenet:${address}`)), ADDRESS);
  expect(retained.memo).toBe(mailDraft.memo);
  expect(retained.recipient).toBe(mailDraft.recipient);
  expect(retained.subject).toBe(mailDraft.subject);
  await page.getByRole("button", { name: "Resume saved publication", exact: true }).click();
  const composer = page.getByRole("region", { name: "Page publication", exact: true });
  await expect(composer.getByRole("textbox", { name: "Message", exact: true })).toHaveValue(mailDraft.memo);
  await expect(composer.getByLabel("To", { exact: true })).toHaveValue(mailDraft.recipient);
  await expectNoSignature(page, state);
});

test("Pages closes a staged publication when the wallet changes and preserves its original account draft", async ({ page }) => {
  const state = await fixture(page);
  await page.goto("/?pages=1");
  await connect(page);
  const html = "<!doctype html><html><body>First account publication</body></html>";
  await source(page, html, "First account publication");
  await page.getByRole("button", { name: "Review publication", exact: true }).click();
  await expect(page.getByRole("region", { name: "Page publication", exact: true })).toBeVisible();
  await expect.poll(() => page.evaluate(address => JSON.parse(localStorage.getItem(`proofofwork.draft.v1:livenet:${address}`))?.memo, ADDRESS)).toBe(html);
  await page.evaluate(other => window.__pagesFixture.changeAccount(other), OTHER_ADDRESS);
  await expect(page.locator(".topbar-wallet-button")).toContainText("1F1p9UEH");
  await expect(page.getByRole("region", { name: "Page publication", exact: true })).toHaveCount(0);
  await expect(page.getByLabel("HTML source", { exact: true })).not.toHaveValue(html);
  const drafts = await page.evaluate(({ first, second }) => ({
    first: JSON.parse(localStorage.getItem(`proofofwork.draft.v1:livenet:${first}`)),
    second: JSON.parse(localStorage.getItem(`proofofwork.draft.v1:livenet:${second}`)),
  }), { first: ADDRESS, second: OTHER_ADDRESS });
  expect(drafts.first.memo).toBe(html);
  expect(drafts.second?.memo).not.toBe(html);
  await expectNoSignature(page, state);
});

test("Pages preserves unreadable local draft storage and exports work from the current session", async ({ page }) => {
  const state = await fixture(page);
  const storageKey = "proofofwork.pages.drafts.v1.livenet.disconnected";
  const corrupt = '{"version":99,"evidence":"keep this record"}';
  await page.addInitScript(({ storageKey, corrupt }) => { if (window === window.top) localStorage.setItem(storageKey, corrupt); }, { storageKey, corrupt });
  await page.goto("/?pages=1");
  await expect(page.getByRole("alert")).toContainText("Existing storage is preserved");
  const html = "<!doctype html><html><body>Recoverable session source</body></html>\n";
  await source(page, html, "Recoverable session source");
  expect(await page.evaluate(key => localStorage.getItem(key), storageKey)).toBe(corrupt);
  const downloadPromise = page.waitForEvent("download");
  await page.locator(".pages-editor-tools").getByRole("button", { name: "Download HTML", exact: true }).click();
  expect(await readFile(await (await downloadPromise).path(), "utf8")).toBe(html);
  await expectNoSignature(page, state);
});

test("Pages reports storage quota failure while keeping source and its last saved draft", async ({ page }) => {
  const state = await fixture(page);
  await page.goto("/?pages=1");
  await source(page, "<!doctype html><html><body>Last saved source</body></html>", "Last saved source");
  const before = await page.evaluate(() => {
    const key = Object.keys(localStorage).find(key => key.startsWith("proofofwork.pages.drafts.v1."));
    const stored = localStorage.getItem(key);
    const original = Storage.prototype.setItem;
    Storage.prototype.setItem = function(nextKey, value) {
      if (nextKey.startsWith("proofofwork.pages.drafts.v1.")) throw new DOMException("Pages storage quota reached", "QuotaExceededError");
      return original.call(this, nextKey, value);
    };
    return { key, stored };
  });
  const html = "<!doctype html><html><body>Unsaved session source</body></html>\n";
  await source(page, html, "Unsaved session source");
  await expect(page.getByRole("alert")).toContainText("Local autosave unavailable");
  await expect(page.getByLabel("HTML source", { exact: true })).toHaveValue(html);
  expect(await page.evaluate(key => localStorage.getItem(key), before.key)).toBe(before.stored);
  const downloadPromise = page.waitForEvent("download");
  await page.locator(".pages-editor-tools").getByRole("button", { name: "Download HTML", exact: true }).click();
  expect(await readFile(await (await downloadPromise).path(), "utf8")).toBe(html);
  await expectNoSignature(page, state);
});

for (const [label, viewport] of [["desktop", { width: 1440, height: 1000 }], ["phone", { width: 390, height: 844 }]]) {
  test(`Pages ${label} routes and Computer navigation retain reachable source controls`, async ({ page }, testInfo) => {
    await page.setViewportSize(viewport);
    const state = await fixture(page);
    await page.goto("/?pages=1");
    await expect(page.locator(".pages-workspace")).toBeVisible();
    await expect(page.locator(".sidebar")).toHaveCount(0);
    await expect(page.getByLabel("HTML source", { exact: true })).toBeVisible();
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
    await page.screenshot({ path: testInfo.outputPath(`pages-${label}.png`), fullPage: true });
    await page.goto("/?folder=files");
    if (label === "phone") await page.getByRole("button", { name: "More", exact: true }).click();
    await page.locator(".sidebar").getByRole("button", { name: "Pages", exact: true }).click();
    await expect(page).toHaveURL(/folder=pages/u);
    await expect(page.getByLabel("HTML source", { exact: true })).toBeVisible();
    if (label === "phone") await expect(page.getByRole("dialog", { name: "Computer navigation" })).toHaveCount(0);
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
    await page.screenshot({ path: testInfo.outputPath(`computer-pages-${label}.png`), fullPage: true });
    await expectNoSignature(page, state);
  });
}
