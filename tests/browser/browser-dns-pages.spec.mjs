import { expect, test } from "@playwright/test";
import * as bitcoin from "bitcoinjs-lib";

const OWNER = "1BPVvi1GK4QkfqFMU4jHGjsQjyGwjJJJ7x";
const OTHER = "1F1p9UEHuH5KTFR7Zsx93Khdrqhj6t5nFv";
const HASH = "a".repeat(64);
const PAGE = "b".repeat(64);
const SECOND = "c".repeat(64);
const LINK = "d".repeat(64);
const EPOCH = { txid: HASH, protocolVout: 1, recordOrdinal: 0 };
const HEIGHT = 970000;
const ACTIVATION = 969998;
const fixtureStates = new WeakMap();

test.afterEach(async ({ page }) => {
  const state = fixtureStates.get(page);
  if (!state) return;
  expect(state.writes).toEqual([]);
  expect(await page.evaluate(() => window.__browserDnsFixture?.signCalls ?? 0)).toBe(0);
});

function dnsSnapshot(name = "alice.pow", pageTxid = PAGE) {
  const snapshot = { network: "livenet", id: name.slice(0, -4), name, routable: true, status: "confirmed",
    coverage: { complete: true }, indexedThroughBlock: HEIGHT, checkpointHash: HASH,
    record: { id: name.slice(0, -4), network: "livenet", ownerAddress: OWNER, receiveAddress: OTHER,
      confirmed: true, txid: HASH, ownershipEpoch: EPOCH, ownershipEpochBlockHeight: ACTIVATION - 1 },
    pageLink: { name, pageTxid, network: "livenet", confirmed: true, status: "active", active: true,
      valid: true, ownerAddress: OWNER, epoch: EPOCH, ownershipEpoch: EPOCH, txid: LINK,
      blockHeight: HEIGHT - 1, protocolVout: 1, recordOrdinal: 0 },
    pageLinkCoverage: { network: "livenet", complete: true, activationHeight: ACTIVATION,
      indexedThroughBlock: HEIGHT, checkpointHash: HASH, witnessSha256: HASH,
      pageLinkSha256: HASH, blockCount: HEIGHT - ACTIVATION + 1,
      model: "dns-page-link-core-raw-block-coverage-v1" },
    pageLinkAdmission: { network: "livenet", ready: true, activationHeight: ACTIVATION,
      minSelfPaymentSats: 546, indexedThroughBlock: HEIGHT, checkpointHash: HASH,
      protocolPrefix: "pwdns1:page1:" },
    pageLinkEvents: [], pageLinkPendingEvents: [], pageLinkHistoricalRecords: [] };
  snapshot.records = [snapshot.record];
  return snapshot;
}

function pageTransaction(txid, { confirmed = true, html = true } = {}) {
  const memo = html ? `<!doctype html><html><body><h1>${txid === PAGE ? "Alice page" : "Updated page"}</h1><script>document.body.dataset.executed="yes"</script></body></html>` : "An ordinary message";
  return { txid, vin: [{ prevout: { scriptpubkey_address: OWNER, value: 1000 } }],
    vout: [{ scriptpubkey_address: OWNER, value: 546 }, {
      scriptpubkey_type: "op_return", value: 0,
      scriptpubkey: Buffer.from(bitcoin.script.compile([bitcoin.opcodes.OP_RETURN, Buffer.from(`pwm1:m:${memo}`)])).toString("hex"),
      scriptpubkey_asm: `OP_RETURN OP_PUSHDATA1 ${Buffer.from(`pwm1:m:${memo}`).toString("hex")}`,
    }], status: { confirmed, block_height: confirmed ? HEIGHT - 2 : undefined,
      block_hash: confirmed ? HASH : undefined, block_time: 1791388800 } };
}

async function fixture(page) {
  const state = { dns: dnsSnapshot(), requests: [], writes: [], pageOptions: {}, gate: null };
  fixtureStates.set(page, state);
  await page.addInitScript(() => {
    if (window !== window.top) return;
    window.__browserDnsFixture = { signCalls: 0 };
    window.unisat = { getAccounts: async () => [], requestAccounts: async () => [], on() {}, removeListener() {},
      signPsbt: async () => { window.__browserDnsFixture.signCalls++; throw new Error("Browser fixture cannot sign"); } };
  });
  await page.route("**/api/v1/**", async route => {
    const url = new URL(route.request().url()); state.requests.push(url);
    if (route.request().method() !== "GET") {
      state.writes.push(`${route.request().method()} ${url.pathname}`);
      return route.fulfill({ status: 405, contentType: "application/json", body: '{"error":"Read-only Browser fixture"}' });
    }
    if (url.pathname.startsWith("/api/v1/dns/")) {
      expect(url.searchParams.get("current")).toBe("1");
      expect(url.searchParams.get("fresh")).toBe("1");
      const response = structuredClone(state.dns);
      if (state.gate?.kind === "dns") await state.gate.promise;
      return route.fulfill({ contentType: "application/json", body: JSON.stringify(response) }).catch(() => {});
    }
    const txid = url.pathname.match(/^\/api\/v1\/tx\/([a-f0-9]{64})$/u)?.[1];
    if (txid) {
      const response = pageTransaction(txid, state.pageOptions);
      if (state.gate?.kind === "page" && txid === PAGE) await state.gate.promise;
      return route.fulfill({ contentType: "application/json", body: JSON.stringify({ tx: response }) }).catch(() => {});
    }
    const response = { network: "livenet", records: [], activity: [], pendingEvents: [], listings: [], sales: [],
      coverage: { complete: true }, indexedThroughBlock: HEIGHT, checkpointHash: HASH,
      registryCounts: { model: "proof-registry-counts-v1", complete: true, confirmedCount: 0, pendingCount: 0, totalCount: 0 },
      tokens: [], holders: [], mints: [], transfers: [], invalidEvents: [],
      directory: { model: "proof-token-directory-v1", complete: true, totalCount: 0 } };
    return route.fulfill({ contentType: "application/json", body: JSON.stringify(response) });
  });
  if (process.env.POW_PLAYWRIGHT_PRODUCTION_BUILD === "1") {
    await page.route("**/*", async route => {
      if (!route.request().isNavigationRequest() || new URL(route.request().url()).pathname !== "/") return route.fallback();
      const response = await route.fetch();
      return route.fulfill({ response, headers: { ...response.headers(),
        "content-security-policy": "default-src 'self'; base-uri 'self'; object-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob: https:; media-src 'self' data: blob: https:; font-src 'self' data:; connect-src 'self'; frame-src 'self'; worker-src 'self' blob:",
        "referrer-policy": "no-referrer" } });
    });
  }
  return state;
}

async function search(page, value) {
  await page.getByLabel("Transaction ID or .pow name", { exact: true }).fill(value);
  await page.getByRole("button", { name: "View Page", exact: true }).click();
}

async function expectPage(page, title = "Alice page") {
  await expect(page.locator(".browser-page-grid")).toBeVisible();
  await expect(page.frameLocator(".browser-preview-card iframe").getByRole("heading", { name: title, exact: true })).toBeVisible();
  await expect(page.locator(".browser-preview-card iframe")).toHaveAttribute("sandbox", "");
  const frame = page.frames().find(item => item !== page.mainFrame());
  expect(await frame.evaluate(() => document.body.dataset.executed)).toBeUndefined();
}

for (const route of ["/?browser=1", "/?folder=browser"]) {
  test(`Confirmed .pow links load verified static HTML in ${route}`, async ({ page }) => {
    const state = await fixture(page);
    await page.goto(route);
    await search(page, " ALICE.POW ");
    await expectPage(page);
    await expect(page.getByLabel("Transaction ID or .pow name", { exact: true })).toHaveValue("alice.pow");
    await expect(page.locator(".browser-proof-card")).toContainText("alice.pow");
    await expect(page.locator(".browser-proof-card")).toContainText(PAGE);
    await expect(page.locator(".browser-proof-card")).toContainText(LINK);
    expect(state.requests.some(url => url.pathname === "/api/v1/dns/alice")).toBe(true);
    if (route.includes("browser=1")) {
      await expect(page).toHaveURL(/name=alice\.pow/u);
      await page.screenshot({ path: "/tmp/pages-dns-browser-desktop.png", fullPage: true });
    }
  });
}

const invalidSnapshots = [
  ["cleared link", state => { state.dns.pageLink = null; }],
  ["pending link", state => { state.dns.pageLink.confirmed = false; }],
  ["new owner", state => { state.dns.record.ownerAddress = OTHER; }],
  ["new ownership epoch", state => { state.dns.record.ownershipEpoch = { ...EPOCH, txid: SECOND }; }],
  ["incomplete coverage", state => { state.dns.pageLinkCoverage.complete = false; }],
  ["different checkpoint", state => { state.dns.pageLinkCoverage.checkpointHash = SECOND; }],
  ["different network", state => { state.dns.pageLink.network = "testnet4"; }],
  ["unready admission", state => { state.dns.pageLinkAdmission.ready = false; }],
  ["noncanonical name", state => { state.dns.pageLink.name = "bob.pow"; }],
];
for (const [label, mutate] of invalidSnapshots) {
  test(`Browser rejects ${label} before requesting page content`, async ({ page }) => {
    const state = await fixture(page); mutate(state);
    await page.goto("/?browser=1");
    await search(page, "alice.pow");
    await expect(page.getByRole("button", { name: "View Page", exact: true })).toBeEnabled();
    await expect(page.locator(".browser-page-grid")).toHaveCount(0);
    expect(state.requests.some(url => url.pathname === `/api/v1/tx/${PAGE}`)).toBe(false);
  });
}

for (const options of [{ confirmed: false }, { html: false }]) {
  test(`A .pow link cannot open ${options.html === false ? "non-HTML" : "pending"} target content`, async ({ page }) => {
    const state = await fixture(page); state.pageOptions = options;
    await page.goto("/?browser=1");
    await search(page, "alice.pow");
    await expect(page.getByRole("button", { name: "View Page", exact: true })).toBeEnabled();
    await expect(page.locator(".browser-page-grid")).toHaveCount(0);
    expect(state.requests.some(url => url.pathname === `/api/v1/tx/${PAGE}`)).toBe(true);
  });
}

test("Name URL reload and Back resolve the current link rather than a saved target", async ({ page }) => {
  const state = await fixture(page);
  await page.goto("/?browser=1&name=alice.pow");
  await expectPage(page);
  state.dns = dnsSnapshot("alice.pow", SECOND);
  await page.reload();
  await expectPage(page, "Updated page");
  await search(page, PAGE);
  await expectPage(page);
  await page.goBack();
  await expectPage(page, "Updated page");
  await expect(page.getByLabel("Transaction ID or .pow name", { exact: true })).toHaveValue("alice.pow");
});

for (const kind of ["dns", "page"]) {
  test(`Network changes discard stale ${kind} responses`, async ({ page }) => {
    const state = await fixture(page);
    let release;
    state.gate = { kind, promise: new Promise(resolve => { release = resolve; }) };
    await page.goto("/?browser=1");
    await search(page, "alice.pow");
    await expect.poll(() => state.requests.some(url => url.pathname === (kind === "dns" ? "/api/v1/dns/alice" : `/api/v1/tx/${PAGE}`))).toBe(true);
    await page.getByLabel("Browser ProofOfWork network", { exact: true }).selectOption("testnet4");
    release(); state.gate = null;
    await expect(page.getByRole("button", { name: "View Page", exact: true })).toBeEnabled();
    await expect(page.locator(".browser-page-grid")).toHaveCount(0);
    await search(page, SECOND);
    await expectPage(page, "Updated page");
    await expect(page.locator(".browser-proof-card")).toContainText("Testnet4");
    await expect(page.locator(".browser-proof-card")).not.toContainText("alice.pow");
  });
}

test("Direct txids retain pending preview and skip DNS resolution", async ({ page }) => {
  const state = await fixture(page); state.pageOptions = { confirmed: false };
  await page.goto(`/?browser=1&txid=${PAGE}`);
  await expectPage(page);
  await expect(page.locator(".browser-proof-card")).toContainText("Pending");
  expect(state.requests.some(url => url.pathname.startsWith("/api/v1/dns/"))).toBe(false);
});

test("Mobile Browser keeps linked-name evidence readable within the viewport", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await fixture(page);
  await page.goto("/?browser=1&name=alice.pow");
  await expectPage(page);
  await expect(page.locator(".browser-proof-card")).toContainText("alice.pow");
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
  await page.screenshot({ path: "/tmp/pages-dns-browser-mobile.png", fullPage: true });
});

test("Unsupported names and non-Mainnet DNS never request domain content", async ({ page }) => {
  const state = await fixture(page);
  await page.goto("/?browser=1");
  await search(page, "abc.alice.pow");
  await expect(page.getByRole("button", { name: "View Page", exact: true })).toBeEnabled();
  expect(state.requests.some(url => url.pathname.startsWith("/api/v1/dns/"))).toBe(false);
  await page.getByLabel("Browser ProofOfWork network", { exact: true }).selectOption("testnet4");
  await search(page, "alice.pow");
  await expect(page.locator(".desktop-route-status")).toContainText("Mainnet only");
  expect(state.requests.some(url => url.pathname.startsWith("/api/v1/dns/"))).toBe(false);
});
