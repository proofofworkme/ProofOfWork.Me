import { expect, test } from "@playwright/test";
import { createHash } from "node:crypto";
import * as bitcoin from "bitcoinjs-lib";
import * as ecc from "@bitcoinerlab/secp256k1";
import { socialIdentityIntentMessage } from "../../src/features/identity/socialIdentityCore.mjs";

bitcoin.initEccLib(ecc);
// Public disposable fixture identity, never a user wallet.
const fixtureKey = Buffer.alloc(32, 1);
const address = bitcoin.payments.p2pkh({ pubkey: ecc.pointFromScalar(fixtureKey, true) }).address;
const identityFields = { address, id: "alice", network: "livenet", createdAt: new Date(Date.now() - 60_000).toISOString() };
const identityMessage = socialIdentityIntentMessage(identityFields);
const identityBytes = Buffer.from(identityMessage);
const identityHash = bitcoin.crypto.hash256(Buffer.concat([Buffer.from("\u0018Bitcoin Signed Message:\n"), Buffer.from([identityBytes.length]), identityBytes]));
const identitySignature = ecc.signRecoverable(identityHash, fixtureKey);
const signedIdentity = { ...identityFields, message: identityMessage, signature: Buffer.concat([Buffer.from([31 + identitySignature.recoveryId]), identitySignature.signature]).toString("base64") };
const txid = "a".repeat(64);
const body = `${"A story with proofs, café, and 🧭.\n\n".repeat(30)}Exact trailing whitespace.  \n`;
const article = { v: 1, title: "A long story on ProofOfWork", source: "same-tx-pwm1-message",
  size: Buffer.byteLength(body), sha256: createHash("sha256").update(body).digest("hex") };
const post = { authorAddress: address, authorId: "writer", confirmed: true,
  createdAt: "2026-10-03T12:00:00Z", kind: "boost-post", txid, text: article.title,
  article, articleVerification: "canonical-same-tx-pwm1-message-v1",
  proofSignalQ8: "54600000000", totalSignalQ8: "54600000000", likeCount: 3, replyCount: 2, reboostCount: 1 };
const funding = new bitcoin.Transaction();
funding.addInput(Buffer.alloc(32, 1), 0);
funding.addOutput(bitcoin.address.toOutputScript(address), 2_000_000n);
const fundingUtxo = { txid: funding.getId(), vout: 0, value: 2_000_000, status: { confirmed: true } };

async function fixture(page, { wallet = false, alteredBody = false, recovery = false, selectedIdentity = false, emptyWalletDraft = false,
  articleBody = body, articleTitle = article.title, network = "livenet" } = {}) {
  const fixtureArticle = { ...article, title: articleTitle, size: Buffer.byteLength(articleBody), sha256: createHash("sha256").update(articleBody).digest("hex") };
  const fixturePost = { ...post, article: fixtureArticle, text: articleTitle };
  if (wallet) await page.addInitScript(({ address, utxo, recovery, identity, emptyWalletDraft }) => {
    if (window !== window.top) return;
    window.publishSignatureCalls = 0;
    window.unisat = { getAccounts: async () => [address], requestAccounts: async () => [address],
      getNetwork: async () => "livenet", getBitcoinUtxos: async () => [utxo], on() {}, removeListener() {},
      signPsbt: async () => { window.publishSignatureCalls++; throw new Error("Rejected by test wallet"); } };
    if (recovery) localStorage.setItem("proofofwork-action-receipts-v1", JSON.stringify([{ txid: "d".repeat(64), address, network: "livenet", title: "Publish article", key: "publish:unknown", createdAt: "2026-10-03T12:00:00Z", status: recovery === "dropped" ? "dropped" : "unknown", fields: [["Title", "Retained article"], ["Body", "Retained work"]] }]));
    if (identity) localStorage.setItem("proofofwork.boost.profileIntent.v1", JSON.stringify({ [`livenet:${address}`]: identity }));
    if (emptyWalletDraft) localStorage.setItem(`proofofwork.publish.draft.v1:livenet:${address}`, JSON.stringify({ title: "", body: "", signal: 546, feeRate: 1 }));
  }, { address, utxo: fundingUtxo, recovery, identity: selectedIdentity ? signedIdentity : null, emptyWalletDraft });
  await page.route("**/api/v1/**", async route => {
    const url = new URL(route.request().url());
    if (route.request().method() !== "GET") return route.abort("blockedbyclient");
    if (url.pathname.endsWith("/utxo")) return route.fulfill({ json: [fundingUtxo] });
    if (url.pathname.endsWith("/hex")) return route.fulfill({ json: { hex: funding.toHex() } });
    if (url.pathname.endsWith("/status")) return route.fulfill({ json: { status: url.pathname.includes("d".repeat(64)) ? "unavailable" : "confirmed" } });
    if (url.pathname.startsWith("/api/v1/ids/alice")) return route.fulfill({ json: { network: "livenet", record: { id: "alice", confirmed: true, network: "livenet", ownerAddress: address } } });
    if (url.pathname !== "/api/v1/boost") return route.fulfill({ json: { records: selectedIdentity ? [{ id: "alice", ownerAddress: address, confirmed: true, network: "livenet" }] : [], listings: [] } });
    if (url.searchParams.has("detail")) return route.fulfill({ json: { complete: true, snapshotId: "article-detail", mode: "detail", post: { ...fixturePost, articleBody: alteredBody ? articleBody.slice(0, -2) : articleBody }, items: [], totalCount: 0, hasMore: false, start: 0 } });
    const items = url.searchParams.has("listings") ? [] : [fixturePost];
    return route.fulfill({ json: { complete: true, snapshotId: "articles", items, totalCount: items.length, hasMore: false, start: 0, network, indexedAt: post.createdAt } });
  });
}

for (const embedded of [false, true]) {
  test(`${embedded ? "Computer" : "standalone Publish"} linkifies only DNS names in verified article bodies`, async ({ page }) => {
    const network = embedded ? "testnet4" : "livenet";
    const exactBody = "Visit armyofyouth.pow and App.ArmyOfYouth.POW! $WORK #proof @alice\nhttps://armyofyouth.pow person@armyofyouth.pow `code.pow`\n```\nfenced.pow\n```\ndeep.app.armyofyouth.pow\nExact café 🧭 bytes.  \n";
    const title = "armyofyouth.pow is a literal article title";
    await fixture(page, { articleBody: exactBody, articleTitle: title, network });
    const dnsReads = [], profileReads = [];
    page.on("request", request => {
      const url = new URL(request.url());
      if (url.pathname.startsWith("/api/v1/dns/")) dnsReads.push(url.href);
      if (url.pathname === "/api/v1/boost" && url.searchParams.has("profile") && url.searchParams.get("limit") === "1") profileReads.push(url.href);
    });
    await page.context().route("**/*", route => {
      const url = new URL(route.request().url());
      return route.request().isNavigationRequest() && (url.hostname === "browser.proofofwork.me" || url.searchParams.get("browser") === "1")
        ? route.fulfill({ contentType: "text/html", body: "<!doctype html><title>Browser link fixture</title>" })
        : route.fallback();
    });
    await page.goto(`/?${embedded ? "folder=publish" : "publish=1"}&network=${network}`);
    const card = page.locator(".publish-article-card");
    await expect(card).toContainText(title);
    await expect(card.locator("a")).toHaveCount(0); // Do not create nested card/title links.
    await card.click();
    const sourceUrl = page.url(), reader = page.locator(".publish-article-body");
    expect(await reader.textContent()).toBe(exactBody);
    expect(createHash("sha256").update(await reader.textContent()).digest("hex")).toBe(createHash("sha256").update(exactBody).digest("hex"));
    await expect(reader.locator("a")).toHaveText(["armyofyouth.pow", "App.ArmyOfYouth.POW"]);
    await expect(page.locator(".publish-reading h1 a")).toHaveCount(0);
    const link = reader.getByRole("link", { name: "armyofyouth.pow (open in Browser, new tab)", exact: true });
    const href = new URL(await link.getAttribute("href"), sourceUrl), source = new URL(sourceUrl);
    const local = ["localhost", "127.0.0.1", "::1", "[::1]"].includes(source.hostname) || source.hostname.endsWith(".localhost");
    expect(href.origin).toBe(local ? source.origin : "https://browser.proofofwork.me");
    expect(href.searchParams.get("browser")).toBe(local ? "1" : null);
    expect(href.searchParams.get("name")).toBe("armyofyouth.pow");
    expect(href.searchParams.get("network")).toBe(network);
    expect(href.searchParams.has("folder")).toBe(false);
    await expect(link).toHaveAttribute("target", "_blank");
    await expect(link).toHaveAttribute("rel", "noopener noreferrer");
    await link.focus();
    await expect(link).toBeFocused();
    await link.hover();
    await page.waitForTimeout(400);
    expect(dnsReads).toHaveLength(0);
    expect(profileReads).toHaveLength(0);
    await expect(page.getByTestId("boost-mention-preview")).toHaveCount(0);
    const popupReady = page.waitForEvent("popup");
    await link.press("Enter");
    const popup = await popupReady;
    await popup.waitForURL(href.href, { waitUntil: "domcontentloaded" });
    expect(popup.url()).toBe(href.href);
    expect(page.url()).toBe(sourceUrl);
    expect(await reader.textContent()).toBe(exactBody);
    await popup.close();
  });
}

test("Publish does not expose DNS links when the article body commitment fails", async ({ page }) => {
  await fixture(page, { alteredBody: true, articleBody: "armyofyouth.pow  \n" });
  await page.goto(`/?publish=1&article=${txid}`);
  await expect(page.getByRole("heading", { name: "Article text unavailable" })).toBeVisible();
  await expect(page.locator(".publish-article-body, .boost-dns-link")).toHaveCount(0);
});

for (const { width, embedded } of [
  { width: 390, embedded: false },
  { width: 768, embedded: false },
  { width: 960, embedded: false },
  { width: 1440, embedded: false },
  { width: 1280, embedded: true },
]) {
  test(`Publish shares Boost navigation geometry at ${width}px${embedded ? " in Computer" : ""}`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await fixture(page);
    const layouts = [];
    for (const surface of ["boost", "publish"]) {
      await page.goto(`/?${embedded ? `folder=${surface}` : `${surface}=1`}`);
      await expect(page.locator(".boost-feed-panel")).toBeVisible();
      layouts.push(await page.evaluate(() => {
        const shell = document.querySelector(".boost-shell-instrument");
        const feed = document.querySelector(".boost-feed-panel").getBoundingClientRect();
        const nav = document.querySelector(".boost-compact-nav");
        const navBox = nav.getBoundingClientRect();
        return { display: getComputedStyle(shell).display,
          columns: getComputedStyle(shell).gridTemplateColumns,
          feedLeft: feed.left, feedWidth: feed.width,
          navWidth: navBox.width, navPosition: getComputedStyle(nav).position,
          documentWidth: document.documentElement.scrollWidth };
      }));
    }
    expect(layouts[1]).toEqual(layouts[0]);
    expect(layouts[1].documentWidth).toBeLessThanOrEqual(width + 1);
  });
}

for (const width of [390, 1440]) {
  test(`articles share Boost engagement and fit ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 1000 });
    await fixture(page);
    const read = page.waitForRequest(request => request.url().includes("/api/v1/boost?") && new URL(request.url()).searchParams.get("format") === "article");
    await page.goto("/?publish=1");
    await read;
    await expect(page.getByRole("heading", { name: article.title })).toBeVisible();
    await page.getByRole("tab", { name: "Following", exact: true }).click();
    await page.locator(".publish-article-card").click();
    await expect(page.locator(".publish-article-body")).toHaveText(body);
    await page.locator(".publish-article-body").click();
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Like, 3 likes", exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "Reboost, 1 reboosts", exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Reply, 2 replies", exact: true }).click();
    const reply = page.getByRole("dialog", { name: "Replying to Boost" });
    await expect(reply).toBeVisible();
    await expect(reply.getByRole("textbox")).toHaveAttribute("maxlength", "140");
    await page.keyboard.press("Escape");
    const layout = await page.evaluate(() => ({ width: document.documentElement.scrollWidth, overflow: [...document.querySelectorAll("body *")].filter(element => element.getBoundingClientRect().right > window.innerWidth + 1).map(element => ({ tag: element.tagName, class: element.className, right: element.getBoundingClientRect().right })).slice(0, 16) }));
    expect(layout.width, JSON.stringify(layout.overflow)).toBeLessThanOrEqual(width + 1);
  });
}

test("full text drafts autosave, preview, and enforce the complete carrier budget", async ({ page }) => {
  await fixture(page);
  await page.goto("/?publish=1");
  await page.getByRole("button", { name: "Write your next article" }).click();
  await page.getByRole("textbox", { name: "Article title", exact: true }).fill(article.title);
  await page.getByRole("textbox", { name: "Article text", exact: true }).fill(body);
  await expect(page.getByRole("textbox", { name: "Article text", exact: true })).not.toHaveAttribute("maxlength");
  await page.getByRole("button", { name: "Preview", exact: true }).click();
  await expect(page.locator(".publish-article-body")).toHaveText(body);
  await page.getByRole("button", { name: "Edit", exact: true }).click();
  await page.getByRole("textbox", { name: "Article text", exact: true }).fill("x".repeat(100_000));
  await expect(page.locator(".publish-budget")).toHaveClass(/is-over/);
  await page.getByRole("button", { name: "Save draft and back" }).click();
  await page.getByRole("button", { name: "Write your next article" }).click();
  await expect(page.getByRole("textbox", { name: "Article text", exact: true })).toHaveValue("x".repeat(100_000));
});

for (const width of [390, 1440]) {
  test(`writer is a normal page with draft-preserving history at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 800 });
    await fixture(page);
    await page.goto("/?publish=1");
    await page.getByRole("button", { name: "Write your next article" }).click();
    await expect(page).toHaveURL(/publish=1.*write=1/);
    await expect(page.getByRole("heading", { name: "New article", exact: true })).toBeVisible();
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await expect(page.locator(".boost-modal-backdrop")).toHaveCount(0);
    await expect(page.locator(".boost-feed-panel")).toHaveCount(0);
    await page.getByRole("textbox", { name: "Article title", exact: true }).fill(article.title);
    await page.getByRole("textbox", { name: "Article text", exact: true }).fill(body);
    await page.getByRole("button", { name: "Preview", exact: true }).click();
    await expect(page.locator(".publish-article-body")).toHaveText(body);
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await page.keyboard.press("Escape");
    await expect(page.getByRole("heading", { name: "Preview your article", exact: true })).toBeVisible();
    const layout = await page.evaluate(() => ({ width: document.documentElement.scrollWidth,
      bodyOverflow: getComputedStyle(document.body).overflow, scrollHeight: document.documentElement.scrollHeight }));
    expect(layout.width).toBeLessThanOrEqual(width + 1);
    expect(layout.bodyOverflow).not.toBe("hidden");
    expect(layout.scrollHeight).toBeGreaterThan(800);
    await page.goBack();
    await expect(page.getByRole("button", { name: "Write your next article" })).toBeVisible();
    await page.getByRole("button", { name: "Reply, 2 replies", exact: true }).click();
    await expect(page.getByRole("dialog", { name: "Replying to Boost" })).toBeVisible();
    await page.goForward();
    await expect(page.getByRole("textbox", { name: "Article text", exact: true })).toHaveValue(body);
    await expect(page.getByRole("dialog")).toHaveCount(0);
    expect(await page.evaluate(() => document.body.style.overflow)).not.toBe("hidden");
    await page.reload();
    await expect(page.getByRole("textbox", { name: "Article text", exact: true })).toHaveValue(body);
    await page.getByRole("button", { name: "Back to Articles", exact: true }).click();
    await expect(page.getByRole("button", { name: "Write your next article" })).toBeVisible();
  });
}

test("direct writer path restores the scoped draft and has a safe Articles fallback", async ({ page }) => {
  await fixture(page);
  await page.goto(`/write?publish=1&network=livenet&profile=writer&article=${txid}&q=story`);
  await expect(page.getByRole("textbox", { name: "Article title", exact: true })).toBeVisible();
  await page.getByRole("textbox", { name: "Article title", exact: true }).fill(article.title);
  await page.getByRole("textbox", { name: "Article text", exact: true }).fill(body);
  await page.reload();
  await expect(page.getByRole("textbox", { name: "Article text", exact: true })).toHaveValue(body);
  await page.evaluate(() => history.replaceState({ proofOfWorkPublishWriter: { v: 1,
    returnHref: "https://outside.example/", returnLabel: "Mail" } }, ""));
  await page.getByRole("button", { name: "Back to Articles", exact: true }).click();
  await expect(page).toHaveURL(/\/\?publish=1&network=livenet$/);
  await expect(page.getByRole("button", { name: "Write your next article" })).toBeVisible();
});

test("a dropped publication restores into the writer without reviving stale recovery text on Forward", async ({ page }) => {
  await fixture(page, { wallet: true, recovery: "dropped" });
  await page.goto("/?publish=1");
  await page.getByRole("button", { name: "Connect UniSat", exact: true }).click();
  await page.getByText("Transaction recovery · 0 unresolved · 1 resolved", { exact: true }).click();
  await page.getByText("Resolved transaction history (1)", { exact: true }).click();
  await page.getByRole("button", { name: "Restore task fields", exact: true }).click();
  await expect(page).toHaveURL(/write=1/);
  await expect(page.getByRole("textbox", { name: "Article text", exact: true })).toHaveValue("Retained work");
  await page.getByRole("textbox", { name: "Article text", exact: true }).fill("Continued recovered article");
  await page.getByRole("button", { name: "Save draft and back", exact: true }).click();
  await page.goForward();
  await expect(page.getByRole("textbox", { name: "Article text", exact: true })).toHaveValue("Continued recovered article");
  expect(await page.evaluate(() => window.publishSignatureCalls)).toBe(0);
});

test("storage failure preserves unsaved article text through manual, browser, and workspace Back", async ({ page }) => {
  await fixture(page);
  await page.goto("/?publish=1");
  await page.getByRole("button", { name: "Write your next article" }).click();
  await page.getByRole("textbox", { name: "Article title", exact: true }).fill(article.title);
  await page.evaluate(() => {
    window.publishOriginalSetItem = Storage.prototype.setItem;
    Storage.prototype.setItem = function(key, value) {
      if (key.startsWith("proofofwork.publish.draft.v1:")) throw new DOMException("Fixture storage full", "QuotaExceededError");
      return window.publishOriginalSetItem.call(this, key, value);
    };
  });
  await page.getByRole("textbox", { name: "Article text", exact: true }).fill(body);
  await expect(page.getByRole("alert").filter({ hasText: "autosave is unavailable" })).toBeVisible();
  await page.getByRole("button", { name: "Save draft and back", exact: true }).click();
  await expect(page).toHaveURL(/write=1/);
  await expect(page.getByRole("textbox", { name: "Article text", exact: true })).toHaveValue(body);
  expect(await page.evaluate(() => window.dispatchEvent(new Event("proofofwork:before-publish-writer-leave", { cancelable: true })))).toBe(false);
  await page.goBack();
  await expect(page).toHaveURL(/write=1/);
  await expect(page.getByRole("textbox", { name: "Article text", exact: true })).toHaveValue(body);
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await page.evaluate(() => { Storage.prototype.setItem = window.publishOriginalSetItem; });
  await page.getByRole("button", { name: "Save draft and back", exact: true }).click();
  await expect(page.getByRole("button", { name: "Write your next article" })).toBeVisible();
  await page.getByRole("button", { name: "Write your next article" }).click();
  await expect(page.getByRole("textbox", { name: "Article text", exact: true })).toHaveValue(body);
  await expect(page.getByRole("alert").filter({ hasText: "autosave is unavailable" })).toHaveCount(0);
});

test("article reader refuses text that does not match its exact on-chain commitment", async ({ page }) => {
  await fixture(page, { alteredBody: true });
  await page.goto(`/?publish=1&article=${txid}`);
  await expect(page.getByRole("heading", { name: "Article text unavailable" })).toBeVisible();
  await expect(page.locator(".publish-article-body")).toHaveCount(0);
});

test("publication review contains exact transaction evidence and wallet rejection preserves the draft", async ({ page }) => {
  await fixture(page, { wallet: true });
  await page.goto("/?publish=1");
  await page.getByRole("button", { name: "Connect UniSat", exact: true }).click();
  await page.getByRole("button", { name: "Write your next article" }).click();
  await page.getByRole("textbox", { name: "Article title", exact: true }).fill(article.title);
  await page.getByRole("textbox", { name: "Article text", exact: true }).fill(body);
  await page.getByRole("button", { name: "Review publication", exact: true }).click();
  const review = page.getByRole("dialog", { name: "Publish article", exact: true });
  await expect(review).toBeVisible();
  await expect(review).toContainText(article.sha256);
  expect(await page.evaluate(() => window.publishSignatureCalls)).toBe(0);
  await review.getByText("Inspect exact transaction evidence").click();
  await expect(review.locator("pre").filter({ hasText: "pwm1:m:" })).toHaveText(`pwm1:m:${body}`);
  await review.getByRole("button", { name: "Continue to wallet", exact: true }).click();
  await expect(page.getByRole("textbox", { name: "Article text", exact: true })).toHaveValue(body);
  expect(await page.evaluate(() => window.publishSignatureCalls)).toBe(1);
});

test("unknown signed publication blocks another article signature", async ({ page }) => {
  await fixture(page, { wallet: true, recovery: true });
  await page.goto("/?publish=1");
  await page.getByRole("button", { name: "Connect UniSat", exact: true }).click();
  await page.getByRole("button", { name: "Write your next article" }).click();
  await page.getByRole("textbox", { name: "Article title", exact: true }).fill(article.title);
  await page.getByRole("textbox", { name: "Article text", exact: true }).fill(body);
  await page.getByRole("button", { name: "Review publication", exact: true }).click();
  await expect(page.getByRole("alert").filter({ hasText: "known broadcast outcome" })).toBeVisible();
  expect(await page.evaluate(() => window.publishSignatureCalls)).toBe(0);
});

test("connecting preserves the active guest article over an existing empty wallet draft", async ({ page }) => {
  await fixture(page, { wallet: true, emptyWalletDraft: true });
  await page.goto("/?publish=1");
  await page.getByRole("button", { name: "Write your next article" }).click();
  await page.getByRole("textbox", { name: "Article title", exact: true }).fill(article.title);
  await page.getByRole("textbox", { name: "Article text", exact: true }).fill(body);
  await page.getByRole("button", { name: "Connect to publish", exact: true }).click();
  await expect(page.getByRole("button", { name: "Review publication", exact: true })).toBeVisible();
  await expect(page.getByRole("textbox", { name: "Article text", exact: true })).toHaveValue(body);
  await expect.poll(() => page.evaluate(address => JSON.parse(localStorage.getItem(`proofofwork.publish.draft.v1:livenet:${address}`)).body, address)).toBe(body);
});

test("selected confirmed PowID profile shares the article transaction and exact byte review", async ({ page }) => {
  await fixture(page, { wallet: true, selectedIdentity: true });
  await page.goto("/?publish=1");
  await page.getByRole("button", { name: "Connect UniSat", exact: true }).click();
  await page.getByRole("button", { name: "Write your next article" }).click();
  await expect(page.locator(".publish-editor-toolbar")).toContainText("alice@proofofwork.me");
  await page.getByRole("textbox", { name: "Article title", exact: true }).fill(article.title);
  await page.getByRole("textbox", { name: "Article text", exact: true }).fill(body);
  await page.getByRole("button", { name: "Review publication", exact: true }).click();
  const review = page.getByRole("dialog", { name: "Publish article", exact: true });
  await expect(review).toBeVisible();
  await review.getByText("Inspect exact transaction evidence").click();
  const records = await review.locator("pre.review-protocol").allTextContents();
  expect(records).toHaveLength(3);
  const profile = JSON.parse(Buffer.from(records[0].slice("pwb1:profile:".length), "base64url"));
  expect(profile.id).toBe("alice");
  expect(profile.intent.signature).toBe(signedIdentity.signature);
  expect(profile.image).toBeUndefined();
  expect(profile.banner).toBeUndefined();
  expect(records[2]).toBe(`pwm1:m:${body}`);
  const bytes = records.reduce((total, record) => total + bitcoin.payments.embed({ data: [Buffer.from(record)] }).output.length, 0);
  await expect(review).toContainText(`${bytes} / 100000 bytes`);
  expect(await page.evaluate(() => window.publishSignatureCalls)).toBe(0);
});
