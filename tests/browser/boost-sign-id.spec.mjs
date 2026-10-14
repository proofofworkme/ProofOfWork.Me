import { expect, test } from "@playwright/test";
import * as bitcoin from "bitcoinjs-lib";
import * as ecc from "@bitcoinerlab/secp256k1";

bitcoin.initEccLib(ecc);
// Public disposable fixture key; these tests never use a connected wallet.
const fixtureKey = Buffer.alloc(32, 1);
const ADDRESS = bitcoin.payments.p2pkh({ pubkey: ecc.pointFromScalar(fixtureKey, true) }).address;
const OTHER_ADDRESS = bitcoin.payments.p2pkh({ pubkey: ecc.pointFromScalar(Buffer.alloc(32, 2), true) }).address;
const ID = "tutorials";

function signFixtureMessage(message) {
  const bytes = Buffer.from(message);
  const length = Buffer.alloc(3);
  length[0] = 0xfd;
  length.writeUInt16LE(bytes.length, 1);
  const hash = bitcoin.crypto.hash256(Buffer.concat([
    Buffer.from("\u0018Bitcoin Signed Message:\n"),
    bytes.length < 0xfd ? Buffer.from([bytes.length]) : length,
    bytes,
  ]));
  const signed = ecc.signRecoverable(hash, fixtureKey);
  return Buffer.concat([Buffer.from([31 + signed.recoveryId]), signed.signature]).toString("base64");
}

async function fixture(page, { ownerRead = "confirmed", forgedSignature = false } = {}) {
  const requests = [];
  const signatures = [];
  await page.exposeFunction("signIdentityFixture", (message, type) => {
    signatures.push({ message, type });
    return forgedSignature ? "invalid-signature" : signFixtureMessage(message);
  });
  await page.addInitScript(({ address }) => {
    const refuseTransaction = async () => { throw new Error("Identity fixture cannot sign or broadcast transactions."); };
    window.unisat = {
      getAccounts: async () => [address], requestAccounts: async () => [address],
      getNetwork: async () => "livenet", on() {}, removeListener() {},
      signMessage: (message, type) => window.signIdentityFixture(message, type),
      signPsbt: refuseTransaction, pushPsbt: refuseTransaction, pushTx: refuseTransaction,
    };
  }, { address: ADDRESS });
  await page.route("**/api/v1/**", async route => {
    if (route.request().method() !== "GET") return route.abort("blockedbyclient");
    const url = new URL(route.request().url());
    url.pathname = url.pathname.replace(/^\/test-api(?=\/api\/)/u, "");
    const record = { id: ID, ownerAddress: ADDRESS, receiveAddress: ADDRESS, confirmed: true, network: "livenet" };
    let json = {};
    if (url.pathname.includes("registry")) json = { records: [record], listings: [], stats: { total: 1 } };
    else if (url.pathname.startsWith("/api/v1/ids/")) {
      requests.push(url);
      // Reproduce the incident: availability is unavailable while confirmed ownership is current.
      if (url.searchParams.has("current") || ownerRead === "unavailable") {
        return route.fulfill({ status: 503, json: { ok: false, error: "Confirmed ID verification is temporarily unavailable.", details: { code: "ID_AVAILABILITY_UNPROVEN" } } });
      }
      json = { network: "livenet", record: { ...record, ...(ownerRead === "transferred" ? { ownerAddress: OTHER_ADDRESS } : {}) } };
    } else if (url.pathname === "/api/v1/boost") json = {
      complete: true, items: [], indexedAt: new Date().toISOString(), network: "livenet", snapshotId: "a".repeat(64),
      totalCount: 0, start: 0, end: 0, hasMore: false, nextCursor: "",
      stats: { total: 0, confirmed: 0, pending: 0 },
      signalStats: { totalSignalQ8: "0", proofSignalQ8: "0", workSignalValueQ8: "0", workSignalSubatoms: "0" },
    };
    return route.fulfill({ json });
  });
  return { requests, signatures };
}

async function selectAndSign(page, embedded) {
  await page.goto(`/?${embedded ? "folder=boost" : "boost=1"}`);
  await expect(page.locator(".boost-feed-panel")).toBeVisible();
  const rail = page.locator(".boost-sidebar");
  await rail.getByRole("button", { name: "Connect", exact: true }).click();
  await expect(rail.getByRole("combobox", { name: "ID", exact: true })).toHaveValue(ID);
  await rail.getByRole("button", { name: "Sign ID", exact: true }).click();
  return rail;
}

for (const embedded of [false, true]) {
  test(`Sign ID accepts fresh confirmed ownership when availability is unhealthy in ${embedded ? "Computer" : "Boost"}`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width: 1440, height: 1000 });
    const { requests, signatures } = await fixture(page);
    const rail = await selectAndSign(page, embedded);
    await expect(page.locator(".status-text").filter({ hasText: `${ID}@proofofwork.me selected for Boost and Publish.` })).toBeVisible();
    await expect(rail.getByRole("button", { name: "Publish", exact: true })).toBeEnabled();
    expect(signatures).toHaveLength(1);
    expect(signatures[0].type).toBe("ecdsa");
    const ownerRequests = requests.filter(url => url.pathname === `/api/v1/ids/${ID}`);
    expect(ownerRequests.length).toBeGreaterThan(0);
    for (const url of ownerRequests) {
      expect(url.searchParams.get("fresh")).toBe("1");
      expect(url.searchParams.has("current")).toBe(false);
    }
    const saved = await page.evaluate(address => JSON.parse(localStorage.getItem("proofofwork.boost.profileIntent.v1"))[`livenet:${address}`], ADDRESS);
    expect(saved.id).toBe(ID);
    expect(saved.address).toBe(ADDRESS);
    expect(saved.message).toBe(signatures[0].message);
    await page.screenshot({ path: testInfo.outputPath("signed-id.png") });
  });
}

for (const [name, options, error] of [
  ["unavailable ownership service", { ownerRead: "unavailable" }, /unavailable/i],
  ["transferred ID", { ownerRead: "transferred" }, /not.*owned|no longer.*owner/i],
  ["invalid wallet signature", { forgedSignature: true }, /signature.*verif|verif.*signature/i],
]) {
  test(`Sign ID reports ${name} and leaves the selection unpublished`, async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 1000 });
    const { signatures } = await fixture(page, options);
    const rail = await selectAndSign(page, false);
    await expect(page.locator(".app-status-row")).toContainText(error);
    await expect(rail.getByRole("button", { name: "Publish", exact: true })).toBeDisabled();
    expect(signatures).toHaveLength(1);
    expect(await page.evaluate(() => localStorage.getItem("proofofwork.boost.profileIntent.v1"))).toBeNull();
  });
}
