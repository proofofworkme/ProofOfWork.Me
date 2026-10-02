import { expect, test } from "@playwright/test";
import * as bitcoin from "bitcoinjs-lib";

const OWNER = "1BPVvi1GK4QkfqFMU4jHGjsQjyGwjJJJ7x";
const RESOLVER = "1F1p9UEHuH5KTFR7Zsx93Khdrqhj6t5nFv";
const TESTNET_OWNER = "mipcBbFg9gMiCh81Kj8tqqdgoZub1ZJRfn";
const DNS_REGISTRY = "1F1zepCJ8VPcPoeMt6G4BPKuE3CYAxCKNY";
const HASH = "a".repeat(64);
const NOW = "2026-10-02T16:00:00Z";
const EPOCH = { txid: HASH, protocolVout: 1, recordOrdinal: 0 };
const ROOT = { id: "alice", ownerAddress: OWNER, receiveAddress: RESOLVER,
  confirmed: true, network: "livenet", txid: HASH, amountSats: 1000,
  createdAt: NOW, ownershipEpoch: EPOCH };
const REGISTRY = { network: "livenet", activity: [], listings: [], pendingEvents: [], records: [], sales: [],
  coverage: { complete: true }, indexedThroughBlock: 970000, checkpointHash: HASH, indexedAt: NOW };
const CHILD = { name: "abc.alice.pow", parent: "alice", label: "abc", epoch: EPOCH,
  ownerAddress: OWNER, receiveAddress: RESOLVER, resolver: null,
  confirmed: true, active: true, txid: "b".repeat(64) };
const funding = new bitcoin.Transaction();
funding.addInput(Buffer.alloc(32), 0xffffffff);
funding.addOutput(bitcoin.address.toOutputScript(OWNER), 100000n);

function deferred() {
  let release;
  const promise = new Promise(resolve => { release = resolve; });
  return { promise, release };
}

async function fixture(page, overrides = {}) {
  const state = { records: [ROOT,
    { ...ROOT, id: "bob", ownerAddress: RESOLVER, txid: "c".repeat(64) },
    { ...ROOT, id: "pending", ownerAddress: RESOLVER, confirmed: false, txid: "d".repeat(64) }],
    children: [CHILD], idRecords: [], network: "livenet", initiallyConnected: false, delayAccounts: false,
    complete: true, fail: false, gate: null,
    reads: [], nonGet: [], ...overrides };
  await page.addInitScript(({ owner, network, initiallyConnected, delayAccounts }) => {
    window.__computerDnsFixture = { signCalls: 0, switchCalls: 0, connected: initiallyConnected };
    window.unisat = {
      getAccounts: async () => window.__computerDnsFixture.connected ? [owner] : [],
      requestAccounts: async () => {
        if (delayAccounts) await new Promise(resolve => { window.__computerDnsFixture.releaseAccounts = resolve; });
        window.__computerDnsFixture.connected = true;
        return [owner];
      },
      getChain: async () => ({ enum: network === "livenet" ? "BITCOIN_MAINNET" : "BITCOIN_TESTNET" }),
      getNetwork: async () => network, on() {}, removeListener() {},
      switchChain: async () => { window.__computerDnsFixture.switchCalls++; throw new Error("Fixture must not switch networks"); },
      switchNetwork: async () => { window.__computerDnsFixture.switchCalls++; throw new Error("Fixture must not switch networks"); },
      signPsbt: async () => { window.__computerDnsFixture.signCalls++; throw new Error("This integration test must not sign"); },
    };
  }, { owner: state.network === "livenet" ? OWNER : TESTNET_OWNER, network: state.network,
    initiallyConnected: state.initiallyConnected, delayAccounts: state.delayAccounts });
  await page.route("**/api/v1/**", async route => {
    const request = route.request();
    const url = new URL(request.url());
    state.reads.push(url);
    if (request.method() !== "GET") {
      state.nonGet.push(`${request.method()} ${url.pathname}`);
      return route.fulfill({ status: 405, contentType: "application/json", body: JSON.stringify({ error: "Read-only fixture" }) });
    }
    let response = { ...REGISTRY, records: [] };
    if (url.pathname === "/api/v1/dns" || url.pathname === "/api/v1/dns-summary") {
      if (state.gate) await state.gate.promise;
      if (state.fail) return route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ error: "DNS fixture unavailable" }) });
      response = { ...REGISTRY, records: state.records, coverage: { complete: state.complete } };
    } else if (url.pathname === "/api/v1/registry" || url.pathname === "/api/v1/registry-summary") {
      response = { ...REGISTRY, records: state.idRecords };
    } else if (url.pathname.startsWith("/api/v1/dns/")) {
      expect(url.searchParams.get("current")).toBe("1");
      expect(url.searchParams.get("fresh")).toBe("1");
      const query = decodeURIComponent(url.pathname.slice("/api/v1/dns/".length));
      const isChild = query.includes(".");
      const root = state.records.find(record => record.id === (isChild ? query.split(".")[1] : query));
      const record = isChild ? state.children.find(item => item.name === `${query}.pow` || item.name === query) : root;
      response = { ...REGISTRY, records: root ? [root] : [], record: record ?? null,
        parentRecord: root ?? null, subdomains: root ? state.children : [], subdomainEvents: [],
        subdomainPendingEvents: [], subdomainCoverage: { complete: true }, subdomainAdmission: { ready: true },
        status: record ? "confirmed" : "available" };
    } else if (url.pathname.endsWith(`/address/${OWNER}/utxo`)) {
      response = [{ txid: funding.getId(), vout: 0, value: 100000,
        status: { confirmed: true, block_height: 969999, block_hash: HASH } }];
    } else if (url.pathname === `/api/v1/tx/${funding.getId()}/hex`) {
      response = { hex: funding.toHex() };
    } else if (url.pathname === "/api/v1/token" || url.pathname === "/api/v1/token-summary") {
      response = { source: "fixture", authoritativeWallet: true, walletScoped: true,
        tokens: [], holders: [], mints: [], transfers: [], listings: [], sales: [], invalidEvents: [] };
    } else if (url.pathname.endsWith("/mail")) {
      response = { inboxMessages: [], sentMessages: [] };
    } else if (url.pathname.endsWith("/status")) {
      response = { status: url.pathname.includes(funding.getId()) ? "confirmed" : "dropped" };
    } else if (url.pathname === "/api/v1/marketplace-summary") {
      response = { network: "livenet", indexedAt: NOW, registry: REGISTRY,
        token: { tokens: [], listings: [], sales: [], mints: [], holders: [], transfers: [] } };
    }
    await route.fulfill({ contentType: "application/json", body: JSON.stringify(response) });
  });
  return state;
}

async function connect(page, path = "/?folder=dns", network = "livenet") {
  await page.goto(path);
  const button = page.locator(".topbar-wallet-button");
  await expect(button).toBeVisible();
  if (await button.getAttribute("aria-label") === "Connect UniSat") await button.click();
  await expect(page.locator(".topbar-wallet-button")).toContainText(network === "livenet" ? "1BPVvi1G" : "mipcBbFg");
}

async function expectReadOnly(page, state) {
  expect(await page.evaluate(() => window.__computerDnsFixture.signCalls)).toBe(0);
  expect(state.nonGet).toEqual([]);
}

test("Computer DNS deep link shares claims, owned names, public search and confirmed subdomains", async ({ page }) => {
  const state = await fixture(page);
  await connect(page);
  await expect(page).toHaveURL(/\?folder=dns$/);
  await expect(page.locator(".sidebar")).toBeVisible();
  await expect(page.locator(".id-launch-app")).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "Claim your .pow name.", exact: true })).toBeVisible();
  await expect(page.getByLabel("DNS registry stats").locator("strong")).toHaveText(["2", "1", "3"]);
  await expect(page.locator(".status-text").first()).not.toContainText("Verifying public ProofOfWork data.");
  await expect(page.locator(".status-text").first()).not.toContainText("Workspace selected. Refresh to load verified ProofOfWork data.");
  const claim = page.locator("#dns-register");
  await expect(claim).toContainText("1,000 proofs");
  await expect(claim.getByLabel("Owner", { exact: true })).toHaveValue(OWNER);
  await expect(page.locator(".dns-workspace")).toContainText(DNS_REGISTRY);
  await expect(page.locator(".dns-workspace")).toContainText("pwdns1:r1");
  const owned = page.locator("#dns-owned");
  await expect(owned.locator(".id-record strong")).toHaveText(["alice.pow"]);
  await owned.getByPlaceholder("Search your .pow").fill("absent");
  await expect(owned).toContainText("No records match this search.");
  await owned.getByPlaceholder("Search your .pow").fill("alice");
  await expect(owned.locator(".id-record")).toHaveCount(1);
  const publicRegistry = page.locator("#dns-registry");
  await publicRegistry.getByRole("textbox").fill("bob");
  await expect(publicRegistry.locator(".id-record strong")).toHaveText(["bob.pow"]);
  await claim.getByLabel(/^Name/).fill("ALICE.POW");
  await expect(claim).toContainText("alice.pow is taken");
  await expect(claim.getByRole("button", { name: ".pow taken", exact: true })).toBeDisabled();
  await claim.getByLabel(/^Name/).fill("pending");
  await expect(claim).toContainText("pending.pow is pending");
  await expect(claim).toContainText("Pending is not final. First confirmed valid registration wins.");
  await expect(claim.getByRole("button", { name: ".pow pending", exact: true })).toBeDisabled();
  const management = page.getByRole("form", { name: "Manage DNS subdomains" });
  await expect(management.getByLabel("Parent .pow name")).toHaveValue("alice");
  await expect(page.locator("#dns-subdomains")).toContainText("546-proof self-payment plus miner fee");
  await expect(page.locator("#dns-subdomains")).toContainText("abc.alice.pow");
  const search = page.getByRole("form", { name: "Search DNS subdomains" });
  await search.getByLabel("Full subdomain name").fill("ABC.ALICE.POW");
  await search.getByRole("button", { name: "Find subdomain" }).click();
  await expect(page.locator("#dns-subdomains")).toContainText("abc.alice.pow is active and confirmed.");
  await expect(page.locator("#dns-subdomains")).toContainText("Inherits the current parent resolver.");
  await expect(page.locator(".dns-workspace").getByRole("heading", { name: "List a .pow name" })).toHaveCount(0);
  await expectReadOnly(page, state);
});

for (const [label, path] of [["native Computer", "/?folder=dns"], ["focused DNS", "/?dns-launch=1"]]) {
  test(`${label} searches .pow names with their DNS suffix without matching the ID namespace`, async ({ page }) => {
    const names = [ROOT, { ...ROOT, id: "work", ownerAddress: RESOLVER, txid: "c".repeat(64) }];
    const state = await fixture(page, { records: names, idRecords: names });
    await connect(page, path);
    const registry = page.locator("#dns-registry");
    await expect(registry.locator(".id-record strong")).toHaveText(["alice.pow", "work.pow"]);
    const search = registry.getByPlaceholder("Search .pow names, addresses, txids");
    for (const query of ["work", "work.pow", "WORK.POW"]) {
      await search.fill(query);
      await expect(registry.locator(".id-record strong")).toHaveText(["work.pow"]);
    }
    const owned = page.locator("#dns-owned");
    await owned.getByPlaceholder("Search your .pow").fill("alice.pow");
    await expect(owned.locator(".id-record strong")).toHaveText(["alice.pow"]);
    await search.fill("work@proofofwork.me");
    await expect(registry.locator(".id-record")).toHaveCount(0);
    await expect(registry).toContainText("No records match this search.");
    await owned.getByPlaceholder("Search your .pow").fill("alice@proofofwork.me");
    await expect(owned.locator(".id-record")).toHaveCount(0);
    await expect(owned).toContainText("No records match this search.");
    if (label === "native Computer") {
      await page.locator(".sidebar").getByRole("button", { name: /^IDs/ }).click();
      await expect(page).toHaveURL(/folder=ids/);
      const ids = page.locator(".ids-registry-card");
      await expect(ids.locator(".id-record strong")).toHaveText(["alice@proofofwork.me", "work@proofofwork.me"]);
      await ids.getByRole("textbox").fill("work");
      await expect(ids.locator(".id-record strong")).toHaveText(["alice@proofofwork.me", "work@proofofwork.me"]);
      await ids.getByRole("textbox").fill("work@proofofwork.me");
      await expect(ids.locator(".id-record strong")).toHaveText(["work@proofofwork.me"]);
      const ownedIds = page.locator(".id-card").filter({ has: page.getByRole("heading", { name: "Your IDs", exact: true }) });
      await ownedIds.getByPlaceholder("Search your IDs").fill("alice@proofofwork.me");
      await expect(ownedIds.locator(".id-record strong")).toHaveText(["alice@proofofwork.me"]);
      await ids.getByRole("textbox").fill("work.pow");
      await expect(ids.locator(".id-record")).toHaveCount(0);
    }
    await expectReadOnly(page, state);
  });
}

test("Computer DNS registration prepares the canonical payment review without signing", async ({ page }) => {
  const state = await fixture(page);
  await connect(page);
  const claim = page.locator("#dns-register");
  await claim.getByLabel(/^Name/).fill("new-claim");
  await claim.getByLabel("Resolves to", { exact: true }).fill(RESOLVER);
  await claim.getByRole("button", { name: "Verify and register for 1,000 proofs", exact: true }).click();
  const review = page.getByRole("dialog", { name: "Review .pow registration" });
  await expect(review).toBeVisible();
  await expect(review).toContainText("new-claim.pow");
  await expect(review).toContainText(DNS_REGISTRY);
  const payment = review.locator(".review-list").first().locator("li").filter({ hasText: "Registry payment" });
  await expect(payment.locator("code").first()).toHaveText(DNS_REGISTRY);
  await expect(payment.locator("code").last()).toHaveText("1000 proofs");
  await expect(review).toContainText(RESOLVER);
  expect(state.reads.some(url => url.pathname === "/api/v1/dns/new-claim")).toBe(true);
  await page.keyboard.press("Escape");
  await expect(review).toHaveCount(0);
  await expect(claim.getByLabel(/^Name/)).toHaveValue("new-claim");
  await expectReadOnly(page, state);
});

for (const [label, viewport] of [["desktop", { width: 1440, height: 1000 }], ["phone", { width: 390, height: 844 }]]) {
  test(`Computer ${label} navigation keeps DNS beside IDs and opens AMO separately`, async ({ page }, testInfo) => {
    await page.setViewportSize(viewport);
    const state = await fixture(page);
    await connect(page, "/?folder=ids");
    if (label === "phone") {
      await page.getByRole("button", { name: "More", exact: true }).click();
      await expect(page.getByRole("dialog", { name: "Computer navigation" })).toBeVisible();
    }
    const sidebar = page.locator(".sidebar");
    const buttons = await sidebar.locator("button").allTextContents();
    const ids = buttons.findIndex(text => /^IDs/.test(text.trim()));
    expect(buttons[ids + 1].trim()).toBe("DNS");
    expect(buttons[ids + 2].trim()).toMatch(/^AMO/);
    await sidebar.getByRole("button", { name: "DNS", exact: true }).click();
    await expect(page).toHaveURL(/folder=dns/);
    await expect(page.locator("#dns-owned")).toContainText("alice.pow");
    await expect(page.locator(".topbar-wallet-button")).toContainText("1BPVvi1G");
    const sectionNav = page.getByRole("navigation", { name: "DNS registry sections", exact: true });
    await expect(sectionNav).toBeVisible();
    expect((await sectionNav.boundingBox()).height).toBeGreaterThanOrEqual(44);
    if (label === "phone") {
      await expect(page.getByRole("dialog", { name: "Computer navigation" })).toHaveCount(0);
      await expect(page.getByRole("button", { name: "More", exact: true })).toHaveAttribute("aria-expanded", "false");
    } else {
      await expect(sidebar.getByRole("button", { name: "DNS", exact: true })).toHaveAttribute("aria-current", "true");
    }
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
    await page.screenshot({ path: testInfo.outputPath(`computer-dns-${label}.png`) });
    await page.screenshot({ path: testInfo.outputPath(`computer-dns-${label}-full.png`), fullPage: true });
    await page.getByRole("button", { name: "Open DNS in AMO", exact: true }).click();
    await expect.poll(() => new URL(page.url()).searchParams.get("folder")).toBe("marketplace");
    await expect.poll(() => new URL(page.url()).searchParams.get("tab")).toBe("dns");
    await expect(page.getByRole("heading", { name: "List a .pow name", exact: true })).toBeVisible();
    await expect(page.locator("#dns-register")).toHaveCount(0);
    await expect(page.locator(".topbar-wallet-button")).toContainText("1BPVvi1G");
    await expectReadOnly(page, state);
  });
}

test("Computer DNS waits for verified registry coverage before displaying an empty result", async ({ page }) => {
  const gate = deferred();
  const state = await fixture(page, { gate });
  try {
    await connect(page);
    await expect(page.getByLabel("DNS registry stats").locator("strong")).toHaveText(["Verifying...", "Verifying...", "Verifying..."]);
    await expect(page.locator("#dns-owned")).toContainText("Verifying your .pow names against the registry...");
    await expect(page.locator("#dns-registry")).toContainText("Verifying DNS registry...");
    await expect(page.locator(".dns-workspace")).not.toContainText("No .pow names for this wallet yet.");
  } finally {
    gate.release();
  }
  await expect(page.locator("#dns-owned")).toContainText("alice.pow");
  await expect(page.getByLabel("DNS registry stats").locator("strong")).toHaveText(["2", "1", "3"]);
  await expectReadOnly(page, state);
});

test("A DNS read started in AMO resolves the native DNS entry status after navigation", async ({ page }) => {
  const gate = deferred();
  const state = await fixture(page, { gate });
  const dnsReads = () => state.reads.filter(url => url.pathname === "/api/v1/dns" || url.pathname === "/api/v1/dns-summary");
  try {
    await connect(page, "/?folder=marketplace&tab=dns");
    await expect.poll(() => dnsReads().length).toBeGreaterThan(0);
    const beforeHandoff = dnsReads().length;
    await page.locator(".sidebar").getByRole("button", { name: "DNS", exact: true }).click();
    await expect(page).toHaveURL(/folder=dns/);
    await expect(page.getByLabel("DNS registry stats").locator("strong")).toHaveText(["Verifying...", "Verifying...", "Verifying..."]);
    expect(dnsReads()).toHaveLength(beforeHandoff);
  } finally {
    gate.release();
  }
  await expect(page.getByLabel("DNS registry stats").locator("strong")).toHaveText(["2", "1", "3"]);
  await expect(page.locator(".status-text").first()).toContainText("DNS registry loaded. 2 confirmed, 1 pending, 0 in flight.");
  await expect(page.locator("#dns-owned")).toContainText("alice.pow");
  await expectReadOnly(page, state);
});

test("Computer DNS rejects incomplete registry evidence and recovers on refresh", async ({ page }) => {
  const state = await fixture(page, { complete: false });
  await connect(page);
  await expect(page.getByLabel("DNS registry stats").locator("strong")).toHaveText(["Unavailable", "Unavailable", "Unavailable"]);
  await expect(page.locator(".dns-workspace")).toContainText("No zero-count result is available.");
  await expect(page.locator("#dns-owned")).toContainText("Registry unavailable; your .pow names could not be verified.");
  await expect(page.locator("#dns-registry .id-record")).toHaveCount(0);
  state.complete = true;
  await page.locator("#dns-registry").getByRole("button", { name: "Refresh", exact: true }).click();
  await expect(page.locator("#dns-owned")).toContainText("alice.pow");
  await expect(page.getByLabel("DNS registry stats").locator("strong")).toHaveText(["2", "1", "3"]);
  await expectReadOnly(page, state);
});

test("Computer DNS preserves and qualifies its last verified snapshot after a failed refresh", async ({ page }) => {
  const state = await fixture(page);
  await connect(page);
  await expect(page.locator("#dns-owned")).toContainText("alice.pow");
  state.fail = true;
  await page.locator("#dns-registry").getByRole("button", { name: "Refresh", exact: true }).click();
  await expect(page.locator(".dns-workspace")).toContainText("Showing the last verified DNS snapshot; refresh is unavailable.");
  await expect(page.locator("#dns-owned")).toContainText("alice.pow");
  await expect(page.getByLabel("DNS registry stats").locator("strong")).toHaveText(["2", "1", "3"]);
  const management = page.getByRole("form", { name: "Manage DNS subdomains" });
  await management.getByLabel("Subdomain label").fill("new");
  await expect(management.getByRole("button", { name: "Review subdomain transaction" })).toBeDisabled();
  await expect(management).toContainText("A current verified DNS registry is required.");
  await expectReadOnly(page, state);
});

test("Computer DNS blocks registration when a Testnet wallet refuses the Mainnet switch", async ({ page }) => {
  const state = await fixture(page, { network: "testnet" });
  await page.goto("/?folder=dns");
  await page.locator(".topbar-wallet-button").click();
  await expect(page.locator(".status-text")).toContainText("Fixture must not switch networks");
  await expect(page.locator(".topbar-wallet-button")).toHaveText("Connect UniSat");
  const claim = page.locator("#dns-register");
  await expect(claim.getByLabel("Owner", { exact: true })).toHaveValue("Connect UniSat");
  await claim.getByLabel(/^Name/).fill("new-claim");
  await claim.getByLabel("Resolves to", { exact: true }).fill(RESOLVER);
  await expect(claim.getByRole("button", { name: "Connect UniSat first", exact: true })).toBeDisabled();
  await expect(page.getByRole("form", { name: "Manage DNS subdomains" }).getByRole("button", { name: "Review subdomain transaction" })).toBeDisabled();
  expect(await page.evaluate(() => window.__computerDnsFixture.switchCalls)).toBe(1);
  await expectReadOnly(page, state);
});

test("Mail connect cannot bypass DNS Mainnet admission when the user changes workspaces mid-request", async ({ page }) => {
  const state = await fixture(page, { network: "testnet", delayAccounts: true });
  await page.goto("/?folder=inbox");
  await page.locator(".topbar-wallet-button").click();
  await expect.poll(() => page.evaluate(() => typeof window.__computerDnsFixture.releaseAccounts)).toBe("function");
  await page.locator(".sidebar").getByRole("button", { name: "DNS", exact: true }).click();
  await expect(page).toHaveURL(/folder=dns/);
  await page.evaluate(() => window.__computerDnsFixture.releaseAccounts());
  await expect(page.locator(".status-text")).toContainText("Fixture must not switch networks");
  await expect(page.locator(".dns-workspace")).toContainText("The canonical .pow registry is available on Mainnet.");
  await expect(page.locator("#dns-register")).toHaveCount(0);
  await expect(page.getByRole("form", { name: "Manage DNS subdomains" })).toHaveCount(0);
  expect(await page.evaluate(() => window.__computerDnsFixture.switchCalls)).toBeGreaterThan(0);
  await expectReadOnly(page, state);
});

for (const kind of ["registration", "subdomain"]) {
  test(`Computer restores a retained DNS ${kind} receipt directly into its native workspace`, async ({ page }) => {
    const receipt = kind === "registration"
      ? { title: "Review .pow registration", key: "registerDns:restored-name", fields: [["Name", "restored-name.pow"], ["Resolver address", RESOLVER]] }
      : { title: "Review subdomain update", key: "dns-subdomain:alice:abc", fields: [["Subdomain", "abc.alice.pow"], ["Subdomain action", "update"], ["Resolver override", OWNER]] };
    await page.addInitScript(({ owner, now, receipt }) => {
      localStorage.setItem("proofofwork-action-receipts-v1", JSON.stringify([{ ...receipt,
        address: owner, network: "livenet", txid: "f".repeat(64), createdAt: now, status: "dropped" }]));
    }, { owner: OWNER, now: NOW, receipt });
    const state = await fixture(page);
    await connect(page, "/?folder=inbox");
    const recovery = page.getByRole("region", { name: "Transaction recovery" });
    await recovery.locator(".action-recovery-disclosure > summary").click();
    await recovery.locator(".action-recovery-history > summary").click();
    await recovery.getByRole("button", { name: "Restore task fields", exact: true }).click();
    await expect(page).toHaveURL(/folder=dns/);
    if (kind === "registration") {
      await expect(page.locator("#dns-register").getByLabel(/^Name/)).toHaveValue("restored-name");
      await expect(page.locator("#dns-register").getByLabel("Resolves to", { exact: true })).toHaveValue(RESOLVER);
    } else {
      const form = page.getByRole("form", { name: "Manage DNS subdomains" });
      await expect(form.getByLabel("Parent .pow name")).toHaveValue("alice");
      await expect(form.getByLabel("Subdomain label")).toHaveValue("abc");
      await expect(form.getByLabel("Subdomain action")).toHaveValue("update");
      await expect(form.getByLabel("Resolver override (optional)")).toHaveValue(OWNER);
    }
    await expect(page.locator("#dns-owned")).toContainText("alice.pow");
    await expect(page.locator(".status-text").first()).toContainText("Retained task restored for inspection.");
    await expect(page.getByRole("dialog", { name: /Review/ })).toHaveCount(0);
    await expectReadOnly(page, state);
  });
}
