import { test, expect } from "@playwright/test";
import * as bitcoin from "bitcoinjs-lib";
import { createHash } from "node:crypto";
const owner = "1KNkUBREnfno2BeV7QsBf8XCWZN6YFfxPH", wallet = "1F1zepCJ8VPcPoeMt6G4BPKuE3CYAxCKNY";
const txid = "a".repeat(64), body = "A confirmed article worth supporting.";
const article = { v: 1, title: "Support the writer", source: "same-tx-pwm1-message", size: Buffer.byteLength(body), sha256: createHash("sha256").update(body).digest("hex") };
const funding = new bitcoin.Transaction(); funding.addInput(Buffer.alloc(32, 1), 0); funding.addOutput(bitcoin.address.toOutputScript(wallet), 2_000_000n);
const utxo = { txid: funding.getId(), vout: 0, value: 2_000_000, status: { confirmed: true } };
async function fixture(page, { unknown = false, changeOwner = false, signed = false } = {}) {
  if (signed) await page.exposeFunction("tipFixtureSign", hex => {
    const psbt = bitcoin.Psbt.fromHex(hex);
    for (let index = 0; index < psbt.inputCount; index++) psbt.updateInput(index, { finalScriptSig: bitcoin.script.compile([Buffer.from("disposable-fixture-signature")]) });
    return psbt.toHex();
  });
  await page.addInitScript(({ wallet, utxo, unknown, target, signed }) => {
    window.tipPsbtCalls = [];
    window.unisat = { getAccounts: async () => [wallet], requestAccounts: async () => [wallet], getNetwork: async () => "livenet",
      getBitcoinUtxos: async () => [utxo], on() {}, removeListener() {},
      signPsbt: async psbt => { window.tipPsbtCalls.push(psbt); if (signed) return window.tipFixtureSign(psbt); throw new Error("Fixture signing rejected"); } };
    if (unknown) localStorage.setItem("proofofwork-action-receipts-v1", JSON.stringify([{ address: wallet, txid: "d".repeat(64), network: "livenet", key: `boost-tip:${target}`, title: "Content tip", status: "unknown", createdAt: new Date().toISOString(), fields: [["Target", target], ["Tip amount", "546"]] }]));
  }, { wallet, utxo, unknown, target: txid, signed });
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
    if (url.pathname !== "/api/v1/boost") return route.fulfill({ json: { records: [], listings: [] } });
    const post = { txid, boostTxid: txid, authorAddress: owner, currentOwnerAddress: changeOwner && url.searchParams.has("detail") ? wallet : owner,
      confirmed: true, createdAt: "2026-10-06T12:00:00Z", kind: "boost-post", text: article.title,
      article, articleBody: body, articleVerification: "canonical-same-tx-pwm1-message-v1", proofSignalQ8: "177900000000", totalSignalQ8: "177900000000", tipCount: 2, tipSatsExact: "1233" };
    const common = { complete: true, snapshotId: "tips-fixture", network: "livenet", hasMore: false, start: 0, indexedAt: post.createdAt };
    if (url.searchParams.has("detail")) return route.fulfill({ json: { ...common, mode: "detail", post, items: url.searchParams.get("activity") === "tips" ? [{ address: wallet, displayName: wallet, txid: "c".repeat(64), eventId: 3, createdAt: post.createdAt, confirmed: true, kind: "boost-tip", amountSatsExact: "1233" }] : [], totalCount: url.searchParams.get("activity") === "tips" ? 1 : 0 } });
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
    await amount.fill("0"); await expect(dialog.getByRole("button", { name: "Tip · 0 proofs" })).toBeDisabled();
    await amount.fill("12345");
    await dialog.getByRole("button", { name: "Tip · 12345 proofs" }).dblclick();
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
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width + 1);
    await page.screenshot({ path: info.outputPath("article-tips.png"), fullPage: true });
    await page.getByRole("link", { name: "Back to articles" }).click(); await expect(page).not.toHaveURL(/article=/);
  });
}
test("unknown signed tips prevent a new payment", async ({ page }) => {
  await fixture(page, { unknown: true }); await page.goto("/?boost=1");
  await page.getByRole("button", { name: "Connect UniSat", exact: true }).click();
  await page.getByRole("button", { name: "Tip, 2 tips" }).click();
  await page.getByRole("button", { name: "Tip · 546 proofs" }).click();
  await expect(page.getByRole("alert").filter({ hasText: "unknown outcome" })).toBeVisible();
  expect(await page.evaluate(() => window.tipPsbtCalls.length)).toBe(0);
});
test("changed confirmed owner prevents stale-recipient signing", async ({ page }) => {
  await fixture(page, { changeOwner: true }); await page.goto("/?boost=1");
  await page.getByRole("button", { name: "Connect UniSat", exact: true }).click();
  await page.getByRole("button", { name: "Tip, 2 tips" }).click();
  await page.getByRole("button", { name: "Tip · 546 proofs" }).click();
  await expect(page.getByRole("alert").filter({ hasText: "ownership changed" })).toBeVisible();
  expect(await page.evaluate(() => window.tipPsbtCalls.length)).toBe(0);
});

test("a signed tip is retained before a failed broadcast and blocks blind retry", async ({ page }) => {
  await fixture(page, { signed: true }); await page.goto("/?boost=1");
  await page.getByRole("button", { name: "Connect UniSat", exact: true }).click();
  await page.getByRole("button", { name: "Tip, 2 tips" }).click();
  await page.getByRole("button", { name: "Tip · 546 proofs" }).click();
  await expect(page.getByRole("alert").filter({ hasText: "Fixture refused broadcast" })).toBeVisible();
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem("proofofwork-action-receipts-v1") ?? "[]"));
  expect(saved[0].status).toBe("unknown"); expect(saved[0].fields).toContainEqual(["Tip amount", "546"]);
  await page.getByRole("button", { name: "Tip · 546 proofs" }).click();
  await expect(page.getByRole("alert").filter({ hasText: "unknown outcome" })).toBeVisible();
  expect(await page.evaluate(() => window.tipPsbtCalls.length)).toBe(1);
});
