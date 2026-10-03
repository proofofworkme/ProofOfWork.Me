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

async function fixture(page, { wallet = false, alteredBody = false, recovery = false, selectedIdentity = false, emptyWalletDraft = false } = {}) {
  if (wallet) await page.addInitScript(({ address, utxo, recovery, identity, emptyWalletDraft }) => {
    if (window !== window.top) return;
    window.publishSignatureCalls = 0;
    window.unisat = { getAccounts: async () => [address], requestAccounts: async () => [address],
      getNetwork: async () => "livenet", getBitcoinUtxos: async () => [utxo], on() {}, removeListener() {},
      signPsbt: async () => { window.publishSignatureCalls++; throw new Error("Rejected by test wallet"); } };
    if (recovery) localStorage.setItem("proofofwork-action-receipts-v1", JSON.stringify([{ txid: "d".repeat(64), address, network: "livenet", title: "Publish article", key: "publish:unknown", createdAt: "2026-10-03T12:00:00Z", status: "unknown", fields: [["Title", "Retained article"], ["Body", "Retained work"]] }]));
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
    if (url.searchParams.has("detail")) return route.fulfill({ json: { complete: true, snapshotId: "article-detail", mode: "detail", post: { ...post, articleBody: alteredBody ? body.slice(0, -2) : body }, items: [], totalCount: 0, hasMore: false, start: 0 } });
    const items = url.searchParams.has("listings") ? [] : [post];
    return route.fulfill({ json: { complete: true, snapshotId: "articles", items, totalCount: items.length, hasMore: false, start: 0, network: "livenet", indexedAt: post.createdAt } });
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
  await page.getByRole("button", { name: "Save draft and close" }).click();
  await page.getByRole("button", { name: "Write your next article" }).click();
  await expect(page.getByRole("textbox", { name: "Article text", exact: true })).toHaveValue("x".repeat(100_000));
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
