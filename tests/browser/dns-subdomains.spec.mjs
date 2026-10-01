import { expect, test } from "@playwright/test";
import * as bitcoin from "bitcoinjs-lib";
import { parseDnsSubdomainPayload } from "../../src/shared/protocol/dnsSubdomains.mjs";

const OWNER = "1BPVvi1GK4QkfqFMU4jHGjsQjyGwjJJJ7x";
const RESOLVER = "1F1p9UEHuH5KTFR7Zsx93Khdrqhj6t5nFv";
const HASH = "a".repeat(64);
const EPOCH = { txid: HASH, protocolVout: 1, recordOrdinal: 0 };
const NOW = "2026-10-01T16:00:00Z";
const funding = new bitcoin.Transaction();
funding.addInput(Buffer.alloc(32), 0xffffffff);
funding.addOutput(bitcoin.address.toOutputScript(OWNER), 100000n);
const FUNDING = funding.getId();
const registry = { network: "livenet", activity: [], listings: [], pendingEvents: [], records: [], sales: [], coverage: { complete: true }, indexedThroughBlock: 970000, checkpointHash: HASH, indexedAt: NOW };
function child(root, overrides = {}) {
  return { name: "abc.alice.pow", parent: "alice", label: "abc", epoch: root.ownershipEpoch,
    ownerAddress: root.ownerAddress, receiveAddress: root.receiveAddress, resolver: null,
    confirmed: true, active: true, txid: "b".repeat(64), ...overrides };
}
async function fixture(page, overrides = {}) {
  const state = { root: { id: "alice", ownerAddress: OWNER, receiveAddress: RESOLVER, confirmed: true,
    network: "livenet", txid: HASH, amountSats: 1000, createdAt: NOW, ownershipEpoch: EPOCH },
    ready: true, complete: true, records: [], history: [], pending: [], childStatus: "available",
    reads: [], signCalls: 0, signed: [], broadcastCalls: 0, broadcastBodies: [], broadcastState: "unknown", ...overrides };
  await page.addInitScript(({ owner }) => {
    window.__dnsFixture = { signCalls: 0, signed: [] };
    window.unisat = { getAccounts: async () => [owner], requestAccounts: async () => [owner],
      getChain: async () => ({ enum: "BITCOIN_MAINNET" }), getNetwork: async () => "livenet", on() {}, removeListener() {},
      signPsbt: async hex => { window.__dnsFixture.signCalls++; window.__dnsFixture.signed.push(hex); throw new Error("User rejected subdomain signature"); } };
  }, { owner: OWNER });
  await page.exposeFunction("finalizeDnsFixture", hex => {
    const psbt = bitcoin.Psbt.fromHex(hex);
    for (let i = 0; i < psbt.inputCount; i++) psbt.updateInput(i, { finalScriptSig: bitcoin.script.compile([Buffer.alloc(72, 1), Buffer.alloc(33, 2)]) });
    state.signCalls++;
    state.signed.push(hex);
    state.afterSign?.();
    return psbt.toHex();
  });
  await page.route("**/api/v1/**", async route => {
    const url = new URL(route.request().url()); state.reads.push(url);
    let response = { ...registry };
    if (url.pathname.startsWith("/api/v1/dns/")) {
      expect(url.searchParams.get("fresh")).toBe("1"); expect(url.searchParams.get("current")).toBe("1");
      const isChild = decodeURIComponent(url.pathname.slice("/api/v1/dns/".length)).includes(".");
      response = { ...registry, records: [state.root], record: isChild ? state.records[0] ?? null : state.root,
        parentRecord: state.root, subdomains: state.records, subdomainEvents: state.history,
        pendingEvents: state.pending, subdomainPendingEvents: state.pending, subdomainCoverage: { complete: state.complete },
        subdomainAdmission: { ready: state.ready, reason: state.ready ? "" : "Subdomain activation has not been pinned." },
        status: isChild ? state.records.length ? "confirmed" : state.childStatus : "confirmed" };
    } else if (url.pathname === "/api/v1/dns" || url.pathname === "/api/v1/dns-summary") {
      response = { ...registry, records: [state.root] };
    } else if (url.pathname === "/api/v1/token" || url.pathname === "/api/v1/token-summary") {
      response = { source: "fixture", authoritativeWallet: true, walletScoped: true, tokens: [], holders: [], mints: [], transfers: [], listings: [], sales: [], invalidEvents: [] };
    } else if (url.pathname.endsWith(`/address/${OWNER}/utxo`)) {
      response = [{ txid: FUNDING, vout: 0, value: 100000, status: { confirmed: true, block_height: 969999, block_hash: HASH } }];
    } else if (url.pathname === `/api/v1/tx/${FUNDING}/hex`) {
      response = { hex: funding.toHex() };
    } else if (url.pathname.endsWith("/mail")) {
      response = { inboxMessages: [], sentMessages: [] };
    } else if (url.pathname.endsWith("/status")) {
      response = { status: url.pathname.includes(FUNDING) ? "confirmed" : state.broadcastState };
    } else if (url.pathname === "/api/v1/broadcast/tx") {
      state.broadcastCalls++;
      state.broadcastBodies.push(route.request().postData());
      return route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ error: "Fixture broadcast outcome unavailable" }) });
    } else if (url.pathname === "/api/v1/marketplace-summary") {
      response = { network: "livenet", indexedAt: NOW, registry, token: { tokens: [], listings: [], sales: [], mints: [], holders: [], transfers: [] } };
    }
    await route.fulfill({ contentType: "application/json", body: JSON.stringify(response) });
  });
  return state;
}
async function openOwner(page, route = "/?dns-launch=1") {
  await page.goto(route);
  const connect = page.getByRole("button", { name: /Connect (UniSat|wallet)/ }).first();
  if (await connect.isVisible().catch(() => false)) await connect.click();
  await expect(page.locator(".topbar-wallet-button")).toContainText("1BPVvi1G");
  const form = page.getByRole("form", { name: "Manage DNS subdomains" });
  await expect(form.getByLabel("Parent .pow name")).toHaveValue("alice");
  await form.getByLabel("Subdomain label").fill("abc");
  return form;
}
function decodedRecord(hex) {
  const psbt = bitcoin.Psbt.fromHex(hex);
  const outputs = psbt.txOutputs;
  expect(outputs[0].value).toBe(546n);
  expect(bitcoin.address.fromOutputScript(outputs[0].script)).toBe(OWNER);
  const records = outputs.flatMap(output => {
    const chunks = bitcoin.script.decompile(output.script);
    return chunks?.[0] === bitcoin.opcodes.OP_RETURN ? chunks.slice(1).filter(chunk => typeof chunk !== "number").map(chunk => Buffer.from(chunk).toString("utf8")) : [];
  });
  expect(records).toHaveLength(2);
  expect(records[0]).toBe("pwm1:m:abc.alice.pow");
  const parsed = parseDnsSubdomainPayload(records[1], { validateAddress: address => { try { bitcoin.address.toOutputScript(address); return true; } catch { return false; } } });
  expect(parsed).not.toBeNull();
  return parsed;
}

test("Public subdomain lookup keeps inherited resolution, expired history and pending visibility separate", async ({ page }) => {
  const state = await fixture(page);
  state.records = [child(state.root)];
  await page.goto("/?dns-launch=1");
  const search = page.getByRole("form", { name: "Search DNS subdomains" });
  await search.getByLabel("Full subdomain name").fill("ABC.ALICE.POW");
  await search.getByRole("button", { name: "Find subdomain" }).click();
  await expect(page.locator("#dns-subdomains")).toContainText("abc.alice.pow is active and confirmed.");
  await expect(page.locator("#dns-subdomains")).toContainText(RESOLVER);
  state.root = { ...state.root, receiveAddress: OWNER };
  state.records = [child(state.root)];
  await search.getByRole("button", { name: "Find subdomain" }).click();
  await expect(page.locator("#dns-subdomains")).toContainText(OWNER);
  state.root = { ...state.root, ownershipEpoch: { ...EPOCH, txid: "c".repeat(64) } };
  state.records = [];
  state.history = [{ name: "abc.alice.pow", action: "create", confirmed: true, txid: "b".repeat(64), epoch: EPOCH, reason: "parent-ownership-period-ended" }];
  state.pending = [{ name: "abc.alice.pow", action: "create", confirmed: false, txid: "d".repeat(64) }];
  state.childStatus = "invalid";
  await search.getByRole("button", { name: "Find subdomain" }).click();
  await expect(page.locator("#dns-subdomains")).toContainText("No active confirmed subdomain for this name (invalid).");
  await expect(page.locator("#dns-subdomains")).toContainText("Pending previews do not resolve.");
  await page.getByText("Inspect subdomain history (1)", { exact: true }).click();
  await expect(page.locator("#dns-subdomains")).toContainText(EPOCH.txid);
  const reads = state.reads.length;
  await search.getByLabel("Full subdomain name").fill("one.two.alice.pow");
  await search.getByRole("button", { name: "Find subdomain" }).click();
  await expect(page.locator("#dns-subdomains")).toContainText("Enter one child label and one parent");
  expect(state.reads.length).toBe(reads);
});

test("Subdomain owner writes fail closed for unpinned activation and incomplete coverage", async ({ page }) => {
  const state = await fixture(page, { ready: false });
  const form = await openOwner(page);
  await expect(form).toContainText("activation has not been pinned");
  await expect(form.getByRole("button", { name: "Review subdomain transaction" })).toBeDisabled();
  state.ready = true; state.complete = false;
  await form.getByRole("button", { name: "Refresh subdomains" }).click();
  await expect(form).toContainText("chain coverage is incomplete");
  await expect(form.getByRole("button", { name: "Review subdomain transaction" })).toBeDisabled();
  expect(await page.evaluate(() => window.__dnsFixture.signCalls)).toBe(0);
});

test("Public lookup rejects another child's record and an inconsistent inherited resolver", async ({ page }) => {
  const state = await fixture(page); state.records = [child(state.root)];
  await page.goto("/?dns-launch=1");
  const search = page.getByRole("form", { name: "Search DNS subdomains" });
  await search.getByLabel("Full subdomain name").fill("xyz.alice.pow");
  await search.getByRole("button", { name: "Find subdomain" }).click();
  await expect(page.locator("#dns-subdomains")).toContainText("do not match the confirmed parent ownership period");
  await expect(page.locator("#dns-subdomains")).not.toContainText("is active and confirmed");
  state.records = [child(state.root, { receiveAddress: OWNER })];
  await search.getByLabel("Full subdomain name").fill("abc.alice.pow");
  await search.getByRole("button", { name: "Find subdomain" }).click();
  await expect(page.locator("#dns-subdomains")).toContainText("do not match the confirmed parent ownership period");
  await expect(page.locator("#dns-subdomains")).not.toContainText("is active and confirmed");
});

test("Repeated subdomain form submission prepares one review and requests no duplicate signature", async ({ page }) => {
  const state = await fixture(page);
  const form = await openOwner(page);
  const before = state.reads.filter(url => url.pathname === "/api/v1/dns/alice").length;
  await form.evaluate(node => { node.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })); node.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })); });
  await expect(page.getByRole("dialog", { name: "Review subdomain create" })).toBeVisible();
  expect(state.reads.filter(url => url.pathname === "/api/v1/dns/alice").length - before).toBe(1);
  await page.keyboard.press("Escape");
  expect(await page.evaluate(() => window.__dnsFixture.signCalls)).toBe(0);
});

test("Subdomain creation reviews exact self-payment and record and blocks an ownership-period race", async ({ page }) => {
  const state = await fixture(page);
  const form = await openOwner(page);
  const review = page.getByRole("dialog", { name: "Review subdomain create" });
  await form.getByRole("button", { name: "Review subdomain transaction" }).click();
  await expect(review).toBeVisible();
  await expect(review).toContainText("546 proofs");
  await expect(review).toContainText("abc.alice.pow");
  await expect(review).toContainText(`${EPOCH.txid}:1:0`);
  const fee = await review.locator(".review-fields > div").filter({ has: page.getByText("Miner fee", { exact: true }) }).locator("dd > code").textContent();
  await expect(review.locator(".review-total code")).toHaveText(fee);
  await review.getByText("Inspect exact transaction evidence", { exact: true }).click();
  await expect(review).toContainText("pwm1:m:abc.alice.pow");
  await expect(review).toContainText("pwdns1:sub1:");
  await page.keyboard.press("Escape");
  await expect(form.getByLabel("Subdomain label")).toHaveValue("abc");
  expect(await page.evaluate(() => window.__dnsFixture.signCalls)).toBe(0);
  await form.getByRole("button", { name: "Review subdomain transaction" }).click();
  state.root = { ...state.root, ownershipEpoch: { ...EPOCH, txid: "c".repeat(64) } };
  await review.getByRole("button", { name: "Continue to wallet" }).click();
  await expect(page.locator(".status-text")).toContainText("ownership period changed");
  expect(await page.evaluate(() => window.__dnsFixture.signCalls)).toBe(0);
  await form.getByRole("button", { name: "Refresh subdomains" }).click();
  await form.getByLabel("Resolver override (optional)").fill(OWNER);
  await form.getByRole("button", { name: "Review subdomain transaction" }).click();
  await review.getByRole("button", { name: "Continue to wallet" }).click();
  await expect(page.locator(".status-text")).toContainText("User rejected subdomain signature");
  const hex = await page.evaluate(() => window.__dnsFixture.signed[0]);
  expect(decodedRecord(hex)).toEqual({ action: "create", parent: "alice", label: "abc", epoch: state.root.ownershipEpoch, resolver: OWNER });
  expect(state.broadcastCalls).toBe(0);
});

test("Subdomain update and revoke preserve exact resolver semantics in reviewed transactions", async ({ page }) => {
  const state = await fixture(page); state.records = [child(state.root)];
  const form = await openOwner(page);
  await form.getByLabel("Subdomain action").selectOption("update");
  await form.getByRole("button", { name: "Review subdomain transaction" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Continue to wallet" }).click();
  await expect(page.locator(".status-text")).toContainText("User rejected subdomain signature");
  expect(decodedRecord(await page.evaluate(() => window.__dnsFixture.signed[0]))).toEqual({ action: "update", parent: "alice", label: "abc", epoch: EPOCH, resolver: null });
  await form.getByLabel("Subdomain action").selectOption("revoke");
  await expect(form.getByLabel("Resolver override (optional)")).toHaveCount(0);
  await form.getByRole("button", { name: "Review subdomain transaction" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Continue to wallet" }).click();
  await expect.poll(() => page.evaluate(() => window.__dnsFixture.signCalls)).toBe(2);
  expect(decodedRecord(await page.evaluate(() => window.__dnsFixture.signed[1]))).toEqual({ action: "revoke", parent: "alice", label: "abc", epoch: EPOCH });
  expect(state.broadcastCalls).toBe(0);
});

test("Signed subdomain receipts retain uncertain outcomes across reload and require status before retry", async ({ page }) => {
  const state = await fixture(page);
  const form = await openOwner(page);
  await page.evaluate(() => { window.unisat.signPsbt = async hex => { window.__dnsFixture.signCalls++; return window.finalizeDnsFixture(hex); }; });
  await form.getByRole("button", { name: "Review subdomain transaction" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Continue to wallet" }).click();
  const recovery = page.getByRole("region", { name: "Transaction recovery" });
  await expect(recovery).toContainText("Broadcast outcome unknown");
  await expect(page.locator(".status-text")).toContainText("Broadcast outcome requires a status check", { timeout: 60000 });
  const attempts = state.broadcastCalls;
  expect(attempts).toBeGreaterThan(0);
  // Network retries reuse the same locally signed transaction; a second user task must not sign or broadcast anew.
  expect(new Set(state.broadcastBodies).size).toBe(1);
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem("proofofwork-action-receipts-v1")));
  expect(saved[0].key).toBe("dns-subdomain:alice:abc"); expect(saved[0].txid).toMatch(/^[a-f0-9]{64}$/);
  await form.getByRole("button", { name: "Review subdomain transaction" }).click();
  await expect(page.locator(".status-text")).toContainText("earlier transaction needs a status check");
  await openOwner(page);
  await expect(recovery).toContainText("Broadcast outcome unknown");
  await recovery.getByRole("button", { name: "Check transaction status" }).click();
  await expect(recovery).toContainText("Broadcast outcome unknown");
  state.broadcastState = "dropped";
  await recovery.getByRole("button", { name: "Check transaction status" }).click();
  await expect(recovery).toContainText("Dropped transaction");
  await recovery.getByRole("button", { name: "Restore task fields" }).click();
  await expect(page.getByRole("form", { name: "Manage DNS subdomains" }).getByLabel("Subdomain label")).toHaveValue("abc");
  expect(state.broadcastCalls).toBe(attempts);
});

test("Subdomain signing rechecks the ownership period before broadcast", async ({ page }) => {
  const state = await fixture(page);
  const form = await openOwner(page);
  state.afterSign = () => { state.root = { ...state.root, ownershipEpoch: { ...EPOCH, txid: "c".repeat(64) } }; };
  await page.evaluate(() => { window.unisat.signPsbt = hex => window.finalizeDnsFixture(hex); });
  await form.getByRole("button", { name: "Review subdomain transaction" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Continue to wallet" }).click();
  await expect(page.locator(".status-text")).toContainText("ownership period changed");
  expect(state.signCalls).toBe(1); expect(state.broadcastCalls).toBe(0);
  expect(await page.evaluate(() => localStorage.getItem("proofofwork-action-receipts-v1"))).toBeNull();
});

test("Computer recovery restores subdomain fields into the DNS tab without signing", async ({ page }) => {
  await page.addInitScript(({ owner, now }) => localStorage.setItem("proofofwork-action-receipts-v1", JSON.stringify([{ address: owner, network: "livenet", txid: "f".repeat(64),
    title: "Review subdomain update", key: "dns-subdomain:alice:abc", createdAt: now, status: "dropped",
    fields: [["Subdomain", "abc.alice.pow"], ["Subdomain action", "update"], ["Resolver override", owner]] }])), { owner: OWNER, now: NOW });
  await fixture(page);
  await page.goto("/?folder=marketplace&tab=tokens");
  const connect = page.getByRole("button", { name: /Connect (UniSat|wallet)/ }).first();
  if (await connect.isVisible().catch(() => false)) await connect.click();
  await expect(page.locator(".topbar-wallet-button")).toContainText("1BPVvi1G");
  await expect(page.getByRole("form", { name: "Manage DNS subdomains" })).toHaveCount(0);
  await page.getByRole("region", { name: "Transaction recovery" }).getByRole("button", { name: "Restore task fields" }).click();
  const form = page.getByRole("form", { name: "Manage DNS subdomains" });
  await expect(form.getByLabel("Subdomain label")).toHaveValue("abc");
  await expect(form.getByLabel("Subdomain action")).toHaveValue("update");
  await expect(form.getByLabel("Resolver override (optional)")).toHaveValue(OWNER);
  expect(await page.evaluate(() => window.__dnsFixture.signCalls)).toBe(0);
});

for (const [surface, route] of [["DNS", "/?dns-launch=1"], ["Computer AMO", "/?folder=marketplace&tab=dns"], ["AMO", "/?marketplace=1&tab=dns"]]) {
  test(`${surface} exposes the same owner subdomain review at phone width`, async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await fixture(page);
    const form = await openOwner(page, route);
    const reviewButton = form.getByRole("button", { name: "Review subdomain transaction" });
    await expect(reviewButton).toBeEnabled();
    await reviewButton.click();
    const review = page.getByRole("dialog", { name: "Review subdomain create" });
    await expect(review).toContainText("546-proof self-payment");
    await expect(review).toContainText("Inherit current parent resolver");
    await page.keyboard.press("Escape");
    await expect(reviewButton).toBeFocused();
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
    await form.scrollIntoViewIfNeeded();
    await page.screenshot({ path: `/tmp/pow-dns-subdomain-${surface.replace(/ /g, "-").toLowerCase()}-phone.png` });
    expect(await page.evaluate(() => window.__dnsFixture.signCalls)).toBe(0);
  });
}
