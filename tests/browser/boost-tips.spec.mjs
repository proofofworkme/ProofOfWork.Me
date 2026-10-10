import { test, expect } from "@playwright/test";
import * as bitcoin from "bitcoinjs-lib";
import { createHash } from "node:crypto";
const owner = "1KNkUBREnfno2BeV7QsBf8XCWZN6YFfxPH", wallet = "1F1zepCJ8VPcPoeMt6G4BPKuE3CYAxCKNY";
const workToken = "d4e5ebf11d104d6a63fb74e42094364b25a5f7199a09e5c0e71408972466a8b8";
const workRegistry = "1638Vn6KtmK8p5r4oGvAXq9nmZb1emU1DV";
const txid = "a".repeat(64), body = "A confirmed article worth supporting.";
const article = { v: 1, title: "Support the writer", source: "same-tx-pwm1-message", size: Buffer.byteLength(body), sha256: createHash("sha256").update(body).digest("hex") };
const funding = new bitcoin.Transaction(); funding.addInput(Buffer.alloc(32, 1), 0); funding.addOutput(bitcoin.address.toOutputScript(wallet), 2_000_000n);
const utxo = { txid: funding.getId(), vout: 0, value: 2_000_000, status: { confirmed: true } };
async function fixture(page, { unknown = false, changeOwner = false, signed = false, workBalance = "100000000000000000", admission = true, pendingWork = "0", receiptCurrency, otherTarget = false, signedOwnerChange = false, signedWorkChange = false } = {}) {
  if (signed) await page.exposeFunction("tipFixtureSign", hex => {
    if (signedOwnerChange) changeOwner = true;
    if (signedWorkChange) workBalance = "0";
    const psbt = bitcoin.Psbt.fromHex(hex);
    for (let index = 0; index < psbt.inputCount; index++) psbt.updateInput(index, { finalScriptSig: bitcoin.script.compile([Buffer.from("disposable-fixture-signature")]) });
    return psbt.toHex();
  });
  await page.addInitScript(({ wallet, utxo, unknown, target, signed, receiptCurrency, otherTarget }) => {
    window.tipPsbtCalls = [];
    window.unisat = { getAccounts: async () => [wallet], requestAccounts: async () => [wallet], getNetwork: async () => "livenet",
      getBitcoinUtxos: async () => [utxo], on() {}, removeListener() {},
      signPsbt: async psbt => { window.tipPsbtCalls.push(psbt); if (signed) return window.tipFixtureSign(psbt); throw new Error("Fixture signing rejected"); } };
    if (unknown) localStorage.setItem("proofofwork-action-receipts-v1", JSON.stringify([{ address: wallet, txid: "d".repeat(64), network: "livenet", key: `boost-tip:${otherTarget ? "e".repeat(64) : target}`, title: "Content tip", status: "unknown", createdAt: new Date().toISOString(), fields: [["Target", target], ["Tip amount", "546"], ...(receiptCurrency ? [["Currency", receiptCurrency]] : [])] }]));
  }, { wallet, utxo, unknown, target: txid, signed, receiptCurrency, otherTarget });
  await page.route("**/api/v1/**", async route => {
    if (route.request().method() !== "GET") {
      if (!signed) throw new Error("Browser fixtures must never broadcast.");
      const saved = await page.evaluate(() => JSON.parse(localStorage.getItem("proofofwork-action-receipts-v1") ?? "[]"));
      expect(saved[0].key).toBe(`boost-tip:${txid}`); expect(saved[0].status).toBe("unknown");
      const localTxid = bitcoin.Transaction.fromHex(route.request().postDataJSON().txHex).getId();
      expect(saved[0].txid).toBe(localTxid);
      return route.fulfill({ status: 400, json: { error: "Fixture refused broadcast" } });
    }
    const url = new URL(route.request().url());
    if (url.pathname.endsWith("/utxo")) return route.fulfill({ json: [utxo] });
    if (url.pathname.endsWith("/hex")) return route.fulfill({ json: { hex: funding.toHex() } });
    if (url.pathname.endsWith("/status")) return route.fulfill({ json: { status: url.pathname.includes("d".repeat(64)) ? "unavailable" : "confirmed" } });
    if (url.pathname === "/api/v1/token" && url.searchParams.get("asset") === workToken) return route.fulfill({ json: {
      network: "livenet", authoritativeWallet: true, walletScoped: true,
      source: "proof-indexer-wallet-token-overlay+proof-indexer-wallet-address-state", checkpointComplete: true, listingBookComplete: true,
      indexedThroughBlock: 970555, indexedThroughBlockHash: "b".repeat(64), listings: [], closedListings: [], sales: [],
      transfers: pendingWork === "0" ? [] : [{ txid: "f".repeat(64), tokenId: workToken, senderAddress: wallet, recipientAddress: owner, amountSubatoms: pendingWork, confirmed: false }],
      holders: [{ address: wallet, tokenId: workToken, balanceSubatoms: workBalance }],
      canonicalWorkCapacities: [{ model: "canonical-work-wallet-capacity-v1", network: "livenet", address: wallet, tokenId: workToken,
        indexedThroughBlock: 970555, indexedThroughBlockHash: "b".repeat(64), confirmedBalanceSubatoms: workBalance,
        reservedBalanceSubatoms: "0", transferableBalanceSubatoms: workBalance, reservations: [],
        tokenStateCommitment: { model: "canonical-work-amo-payload-sha256-v1", sha256: "c".repeat(64), payloadBytes: 100 } }],
    } });
    if (url.pathname === "/api/v1/work-floor") return route.fulfill({ json: { workAmoV8: { version: "pwt-sale-v8", pinsRequested: true,
      pinsConfigured: true, protocolReady: admission, writeAdmission: admission, activation: { active: true, reached: true, tipVerified: true, evidenceComplete: true } } } });
    if (url.pathname !== "/api/v1/boost") return route.fulfill({ json: { records: [], listings: [] } });
    const post = { txid, boostTxid: txid, authorAddress: owner, currentOwnerAddress: changeOwner && url.searchParams.has("detail") ? wallet : owner,
      confirmed: true, createdAt: "2026-10-06T12:00:00Z", kind: "boost-post", text: article.title,
      article, articleBody: body, articleVerification: "canonical-same-tx-pwm1-message-v1", proofSignalQ8: "177900000000", totalSignalQ8: "177900000000", tipCount: 2, tipSatsExact: "1233", tipWorkSubatomsExact: "1" };
    const common = { complete: true, snapshotId: "tips-fixture", network: "livenet", hasMore: false, start: 0, indexedAt: post.createdAt };
    if (url.searchParams.has("detail")) return route.fulfill({ json: { ...common, mode: "detail", post, items: url.searchParams.get("activity") === "tips" ? [{ address: wallet, displayName: wallet, txid: "c".repeat(64), eventId: 3, createdAt: post.createdAt, confirmed: true, kind: "boost-tip", currency: "proofs", amountSatsExact: "1233" }, { address: wallet, displayName: wallet, txid: "e".repeat(64), eventId: 4, createdAt: post.createdAt, confirmed: true, kind: "boost-tip", currency: "WORK", amountSubatoms: "1" }] : [], totalCount: url.searchParams.get("activity") === "tips" ? 2 : 0 } });
    return route.fulfill({ json: { ...common, items: [post], totalCount: 1 } });
  });
}
for (const route of ["/?boost=1", "/?publish=1", "/?folder=boost", "/?folder=publish"]) {
  test(`custom tip reviews exact payment and carriers at ${route}`, async ({ page }) => {
    await fixture(page); await page.goto(route);
    await page.getByRole("button", { name: "Connect UniSat", exact: true }).click();
    await page.getByRole("button", { name: "Tip, 2 tips" }).first().click();
    const dialog = page.getByRole("dialog", { name: "Tip", exact: true });
    const amount = dialog.getByRole("textbox", { name: "Tip amount (proofs)" });
    await expect(amount).toHaveValue("546");
    await amount.fill("0"); await expect(dialog.getByRole("button", { name: "Review tip · 0 proofs" })).toBeDisabled();
    await amount.fill("12345");
    await dialog.getByRole("button", { name: "Review tip · 12345 proofs" }).dblclick();
    const review = page.getByRole("dialog", { name: "Review content tip" });
    await expect(review).toContainText("12345 proofs");
    expect(await page.evaluate(() => window.tipPsbtCalls.length)).toBe(0);
    await review.getByRole("button", { name: "Continue to wallet" }).dblclick();
    await expect.poll(() => page.evaluate(() => window.tipPsbtCalls.length)).toBe(1);
    const psbt = bitcoin.Psbt.fromHex(await page.evaluate(() => window.tipPsbtCalls[0]));
    expect(psbt.txOutputs[0].address).toBe(owner); expect(psbt.txOutputs[0].value).toBe(12345n);
    const carriers = psbt.txOutputs.filter(output => output.script[0] === 0x6a).map(output => Buffer.from(bitcoin.script.decompile(output.script)[1]).toString("utf8"));
    expect(carriers).toEqual([`pwb1:tip:${txid}:12345`, `pwm1:m:Tip 12345 proofs for ProofOfWork content ${txid}`]);
    await expect(amount).toHaveValue("12345");
  });
}
for (const width of [390, 1440]) {
  test(`article header and confirmed tip activity fit at ${width}px`, async ({ page }, info) => {
    await page.setViewportSize({ width, height: 900 }); await fixture(page);
    await page.goto(`/?publish=1&article=${txid}`);
    await expect(page.getByRole("link", { name: "Back to articles" })).toBeVisible();
    const head = page.locator(".publish-reader-titlebar");
    const arrow = await head.getByRole("link").boundingBox(), title = await head.locator("strong").boundingBox();
    expect(title.x - (arrow.x + arrow.width)).toBeGreaterThanOrEqual(15);
    await page.getByRole("tab", { name: "Tips 2" }).click();
    await expect(page.getByText("1233 proofs tipped")).toBeVisible();
    await expect(page.getByText("0.0000000000000001 WORK tipped")).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width + 1);
    await page.screenshot({ path: info.outputPath("article-tips.png"), fullPage: true });
    await page.getByRole("link", { name: "Back to articles" }).click(); await expect(page).not.toHaveURL(/article=/);
  });
}
test("unknown signed tips prevent a new payment", async ({ page }) => {
  await fixture(page, { unknown: true }); await page.goto("/?boost=1");
  await page.getByRole("button", { name: "Connect UniSat", exact: true }).click();
  await page.getByRole("button", { name: "Tip, 2 tips" }).click();
  await page.getByRole("button", { name: "Review tip · 546 proofs" }).click();
  await expect(page.getByRole("alert").filter({ hasText: "unknown outcome" })).toBeVisible();
  expect(await page.evaluate(() => window.tipPsbtCalls.length)).toBe(0);
});
test("changed confirmed owner prevents stale-recipient signing", async ({ page }) => {
  await fixture(page, { changeOwner: true }); await page.goto("/?boost=1");
  await page.getByRole("button", { name: "Connect UniSat", exact: true }).click();
  await page.getByRole("button", { name: "Tip, 2 tips" }).click();
  await page.getByRole("button", { name: "Review tip · 546 proofs" }).click();
  await expect(page.getByRole("alert").filter({ hasText: "ownership changed" })).toBeVisible();
  expect(await page.evaluate(() => window.tipPsbtCalls.length)).toBe(0);
});

test("a signed tip is retained before a failed broadcast and blocks blind retry", async ({ page }) => {
  await fixture(page, { signed: true }); await page.goto("/?boost=1");
  await page.getByRole("button", { name: "Connect UniSat", exact: true }).click();
  await page.getByRole("button", { name: "Tip, 2 tips" }).click();
  await page.getByRole("button", { name: "Review tip · 546 proofs" }).click();
  await page.getByRole("dialog", { name: "Review content tip" }).getByRole("button", { name: "Continue to wallet" }).click();
  await expect(page.getByRole("alert").filter({ hasText: "Fixture refused broadcast" })).toBeVisible();
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem("proofofwork-action-receipts-v1") ?? "[]"));
  expect(saved[0].status).toBe("unknown"); expect(saved[0].fields).toContainEqual(["Tip amount", "546"]);
  await page.getByRole("button", { name: "Review tip · 546 proofs" }).click();
  await expect(page.getByRole("alert").filter({ hasText: "unknown outcome" })).toBeVisible();
  expect(await page.evaluate(() => window.tipPsbtCalls.length)).toBe(1);
});

for (const appRoute of ["/?boost=1", "/?publish=1", "/?folder=boost", "/?folder=publish"]) {
  test(`WORK-only tip prepares exact Q16 credit and separate fee at ${appRoute}`, async ({ page }, info) => {
    await fixture(page); await page.goto(appRoute);
    await page.getByRole("button", { name: "Connect UniSat", exact: true }).click();
    await page.getByRole("button", { name: "Tip, 2 tips" }).first().click();
    let dialog = page.getByRole("dialog", { name: "Tip", exact: true });
    await dialog.getByLabel("Tip currency").selectOption("WORK");
    const amount = dialog.getByRole("textbox", { name: "Tip amount (WORK)" });
    await amount.fill("0.00000000000000001");
    await expect(dialog.getByRole("button", { name: "Review tip · 0.00000000000000001 WORK" })).toBeDisabled();
    await amount.fill("0.0000000000000001");
    await expect(dialog).toContainText("Spendable WORK: 10");
    await dialog.getByRole("button", { name: "Review tip · 0.0000000000000001 WORK" }).click();
    let review = page.getByRole("dialog", { name: "Review content tip" });
    await expect(review).toContainText("0.0000000000000001 WORK");
    await expect(review).toContainText("WORK registry mutation payment");
    await expect(review).toContainText("546 proofs");
    await expect(review).toContainText(owner);
    await page.screenshot({ path: info.outputPath("work-tip-review-desktop.png"), fullPage: true });
    expect(await page.evaluate(() => window.tipPsbtCalls.length)).toBe(0);
    await review.getByRole("button", { name: "Back to task" }).click();
    dialog = page.getByRole("dialog", { name: "Tip", exact: true });
    await expect(dialog.getByLabel("Tip currency")).toHaveValue("WORK");
    await expect(dialog.getByRole("textbox", { name: "Tip amount (WORK)" })).toHaveValue("0.0000000000000001");
    await dialog.getByRole("button", { name: "Review tip · 0.0000000000000001 WORK" }).click();
    review = page.getByRole("dialog", { name: "Review content tip" });
    await review.getByRole("button", { name: "Continue to wallet" }).dblclick();
    await expect.poll(() => page.evaluate(() => window.tipPsbtCalls.length)).toBe(1);
    const psbt = bitcoin.Psbt.fromHex(await page.evaluate(() => window.tipPsbtCalls[0]));
    const outputs = psbt.txOutputs;
    expect(outputs[0].script[0]).toBe(0x6a);
    expect(outputs[1].address).toBe(workRegistry); expect(outputs[1].value).toBe(546n);
    expect(outputs.filter(output => output.address === owner)).toHaveLength(0);
    const carriers = outputs.filter(output => output.script[0] === 0x6a).map(output => Buffer.from(bitcoin.script.decompile(output.script)[1]).toString("utf8"));
    expect(carriers).toEqual([`pwb1:tip2:${txid}:${workToken}:1`, `pwt1:send3:${workToken}:1:${owner}`]);
    await expect(page.getByRole("textbox", { name: "Tip amount (WORK)" })).toHaveValue("0.0000000000000001");
  });
}

test("WORK tipping reserves pending outgoing balance and fails closed on unavailable admission", async ({ page }) => {
  await fixture(page, { pendingWork: "90000000000000000", admission: false }); await page.goto("/?boost=1");
  await page.getByRole("button", { name: "Connect UniSat", exact: true }).click();
  await page.getByRole("button", { name: "Tip, 2 tips" }).click();
  const dialog = page.getByRole("dialog", { name: "Tip", exact: true });
  await dialog.getByLabel("Tip currency").selectOption("WORK");
  await expect(dialog).toContainText("Spendable WORK: 1");
  await dialog.getByRole("textbox", { name: "Tip amount (WORK)" }).fill("2");
  await expect(dialog.getByRole("button", { name: "Review tip · 2 WORK" })).toBeDisabled();
  await dialog.getByRole("textbox", { name: "Tip amount (WORK)" }).fill("1");
  await dialog.getByRole("button", { name: "Review tip · 1 WORK" }).click();
  await expect(page.getByRole("alert").filter({ hasText: "admission is unavailable" })).toBeVisible();
  expect(await page.evaluate(() => window.tipPsbtCalls.length)).toBe(0);
  await dialog.getByLabel("Tip currency").selectOption("proofs");
  await dialog.getByRole("button", { name: "Review tip · 546 proofs" }).click();
  await expect(page.getByRole("dialog", { name: "Review content tip" })).toBeVisible();
});

test("unknown WORK tip on another content target holds the wallet", async ({ page }) => {
  await fixture(page, { unknown: true, receiptCurrency: "WORK", otherTarget: true }); await page.goto("/?boost=1");
  await page.getByRole("button", { name: "Connect UniSat", exact: true }).click();
  await page.getByRole("button", { name: "Tip, 2 tips" }).click();
  const dialog = page.getByRole("dialog", { name: "Tip", exact: true });
  await dialog.getByLabel("Tip currency").selectOption("WORK");
  await expect(dialog).toContainText("An earlier signed WORK debit is unknown or pending");
  await expect(dialog.getByRole("button", { name: "Review tip · 1 WORK" })).toBeDisabled();
  expect(await page.evaluate(() => window.tipPsbtCalls.length)).toBe(0);
});

test("changed owner after tip review prevents wallet signing", async ({ page }) => {
  await fixture(page); await page.goto("/?boost=1");
  await page.getByRole("button", { name: "Connect UniSat", exact: true }).click();
  await page.getByRole("button", { name: "Tip, 2 tips" }).click();
  await page.getByRole("button", { name: "Review tip · 546 proofs" }).click();
  await expect(page.getByRole("dialog", { name: "Review content tip" })).toBeVisible();
  await page.route("**/api/v1/boost?**", async route => route.fulfill({ json: { post: { txid, confirmed: true, currentOwnerAddress: wallet } } }));
  await page.getByRole("dialog", { name: "Review content tip" }).getByRole("button", { name: "Continue to wallet" }).click();
  await expect(page.getByRole("alert").filter({ hasText: "ownership changed" })).toBeVisible();
  expect(await page.evaluate(() => window.tipPsbtCalls.length)).toBe(0);
});

for (const change of ["owner", "capacity"]) {
  test(`WORK tip retains its signed txid when ${change} changes before broadcast`, async ({ page }) => {
    const posts = [];
    page.on("request", request => { if (request.method() === "POST" && request.url().includes("/api/v1/")) posts.push(request.url()); });
    await fixture(page, { signed: true, signedOwnerChange: change === "owner", signedWorkChange: change === "capacity" });
    await page.goto("/?boost=1");
    await page.getByRole("button", { name: "Connect UniSat", exact: true }).click();
    await page.getByRole("button", { name: "Tip, 2 tips" }).click();
    let dialog = page.getByRole("dialog", { name: "Tip", exact: true });
    await dialog.getByLabel("Tip currency").selectOption("WORK");
    await dialog.getByRole("button", { name: "Review tip · 1 WORK" }).click();
    await page.getByRole("dialog", { name: "Review content tip" }).getByRole("button", { name: "Continue to wallet" }).click();
    await expect(page.getByRole("alert").filter({ hasText: change === "owner" ? "ownership changed" : "spendable WORK" })).toBeVisible();
    const saved = await page.evaluate(() => JSON.parse(localStorage.getItem("proofofwork-action-receipts-v1") ?? "[]"));
    expect(saved[0].key).toBe(`boost-tip:${txid}`); expect(saved[0].status).toBe("unknown");
    expect(saved[0].fields).toContainEqual(["Currency", "WORK"]);
    expect(saved[0].fields).toContainEqual(["WORK subatoms", "10000000000000000"]);
    expect(await page.evaluate(() => window.tipPsbtCalls.length)).toBe(1); expect(posts).toHaveLength(0);
    dialog = page.getByRole("dialog", { name: "Tip", exact: true });
    await expect(dialog.getByLabel("Tip currency")).toHaveValue("WORK");
    await dialog.getByLabel("Tip currency").selectOption("proofs");
    await dialog.getByRole("button", { name: "Review tip · 546 proofs" }).click();
    await expect(page.getByRole("alert").filter({ hasText: "unknown outcome" })).toBeVisible();
    expect(await page.evaluate(() => window.tipPsbtCalls.length)).toBe(1);
  });
}

test("signed WORK tip is retained before a refused broadcast", async ({ page }) => {
  await fixture(page, { signed: true }); await page.goto("/?boost=1");
  await page.getByRole("button", { name: "Connect UniSat", exact: true }).click();
  await page.getByRole("button", { name: "Tip, 2 tips" }).click();
  const dialog = page.getByRole("dialog", { name: "Tip", exact: true });
  await dialog.getByLabel("Tip currency").selectOption("WORK");
  await dialog.getByRole("button", { name: "Review tip · 1 WORK" }).click();
  await page.getByRole("dialog", { name: "Review content tip" }).getByRole("button", { name: "Continue to wallet" }).click();
  await expect(page.getByRole("alert").filter({ hasText: "Fixture refused broadcast" })).toBeVisible();
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem("proofofwork-action-receipts-v1") ?? "[]"));
  expect(saved[0].status).toBe("unknown"); expect(saved[0].fields).toContainEqual(["Currency", "WORK"]);
  expect(await page.evaluate(() => window.tipPsbtCalls.length)).toBe(1);
});

test("exact WORK tipping and prepared review fit the mobile Publish reader", async ({ page }, info) => {
  await page.setViewportSize({ width: 390, height: 844 }); await fixture(page);
  await page.goto(`/?publish=1&article=${txid}`);
  await page.getByRole("button", { name: "Connect UniSat", exact: true }).click();
  await page.getByRole("button", { name: "Tip, 2 tips" }).click();
  const dialog = page.getByRole("dialog", { name: "Tip", exact: true });
  await dialog.getByLabel("Tip currency").selectOption("WORK");
  await dialog.getByRole("textbox", { name: "Tip amount (WORK)" }).fill("1.0000000000000001");
  await dialog.getByRole("button", { name: "Review tip · 1.0000000000000001 WORK" }).click();
  const review = page.getByRole("dialog", { name: "Review content tip" });
  await expect(review).toContainText("1.0000000000000001 WORK");
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(391);
  const bounds = await review.boundingBox(); expect(bounds.x).toBeGreaterThanOrEqual(0); expect(bounds.x + bounds.width).toBeLessThanOrEqual(391);
  await page.screenshot({ path: info.outputPath("work-tip-review-mobile.png"), fullPage: true });
  await review.getByRole("button", { name: "Back to task" }).click();
  await expect(page.getByRole("textbox", { name: "Tip amount (WORK)" })).toHaveValue("1.0000000000000001");
});
