import { expect, test } from "@playwright/test";

const ADDRESS = "bc1qvst5k9cr82guxz53wkmt6yll8xd8lk5qpeq5ur";
const TXID = "1".repeat(64);

async function installReadFixture(page) {
  const reads = [];
  await page.clock.install();
  await page.addInitScript(({ address, txid }) => {
    let approved = false;
    const originalFetch = window.fetch;
    const fetchTraces = [];
    window.fetch = (...args) => {
      if (String(args[0]).includes("/api/")) fetchTraces.push({ url: String(args[0]), stack: new Error().stack });
      return originalFetch(...args);
    };
    window.__readFixture = { walletReads: 0, signCalls: 0, fetchTraces, setVisibility(value) {
      Object.defineProperty(document, "visibilityState", { configurable: true, get: () => value });
      document.dispatchEvent(new Event("visibilitychange"));
    } };
    window.unisat = {
      requestAccounts: async () => { approved = true; return [address]; },
      getAccounts: async () => approved ? [address] : [],
      getChain: async () => ({ enum: "BITCOIN_MAINNET" }),
      getBitcoinUtxos: async () => {
        window.__readFixture.walletReads += 1;
        // Curated membership needs matching node confirmation evidence.
        return [{ txid, vout: 0, value: 100_000 }];
      },
      on() {}, removeListener() {},
      signPsbt: async () => { window.__readFixture.signCalls += 1; throw new Error("Signing is outside the fixture"); },
    };
  }, { address: ADDRESS, txid: TXID });
  await page.route("**/api/**", async (route) => {
    const url = new URL(route.request().url());
    reads.push({ path: url.pathname, search: url.search });
    const utxo = url.pathname.endsWith("/utxo");
    if (utxo) await new Promise((resolve) => setTimeout(resolve, 100));
    await route.fulfill({ status: utxo ? 200 : 503, contentType: "application/json",
      body: JSON.stringify(utxo ? [{ txid: TXID, vout: 0, value: 100_000, status: { confirmed: true } }]
        : { error: "Fixture verified protocol state unavailable." }),
    }).catch(() => {});
  });
  return reads;
}

for (const route of ["/?folder=contacts", "/?wallet=1"]) {
  test(`${route}: connected display reads pause while hidden and resume once`, async ({ page }) => {
    const reads = await installReadFixture(page);
    await page.goto(route);
    await page.getByRole("button", { name: "Connect UniSat", exact: true }).first().click();
    await expect(page.getByRole("button", { name: "Disconnect UniSat", exact: true }).first()).toBeVisible();
    await expect.poll(() => reads.filter((row) => row.path.endsWith("/utxo")).length).toBeGreaterThan(0);
    // Finish initial fixture work before measuring automatic idle traffic.
    await page.clock.runFor(3_000);
    await page.waitForTimeout(250);
    await page.evaluate(() => window.__readFixture.setVisibility("hidden"));
    const before = reads.length;
    const beforeWallet = await page.evaluate(() => window.__readFixture.walletReads);
    await page.clock.runFor(180_000);
    await page.waitForTimeout(150);
    const hiddenAdditionalRequests = reads.length - before;
    const fetchTraces = await page.evaluate(() => window.__readFixture.fetchTraces.slice(-8));
    expect(hiddenAdditionalRequests, JSON.stringify({ requests: reads.slice(before), fetchTraces })).toBe(0);
    expect(await page.evaluate(() => window.__readFixture.walletReads)).toBe(beforeWallet);
    const utxosBefore = reads.filter((row) => row.path.endsWith("/utxo")).length;
    await page.evaluate(() => {
      window.__readFixture.setVisibility("visible");
      window.dispatchEvent(new Event("focus"));
      window.dispatchEvent(new Event("focus"));
    });
    await expect.poll(() => reads.filter((row) => row.path.endsWith("/utxo")).length).toBe(utxosBefore + 1);
    await page.waitForTimeout(150);
    expect(reads.filter((row) => row.path.endsWith("/utxo")).length).toBe(utxosBefore + 1);
    // Unavailable protocol state never becomes usable simply from connection.
    expect(await page.evaluate(() => window.__readFixture.signCalls)).toBe(0);
    await test.info().attach("read-lifecycle.json", { body: Buffer.from(JSON.stringify({
      simulatedVisibility: true, hiddenVirtualMs: 180_000, hiddenAdditionalRequests,
      resumeUtxoRequests: reads.filter((row) => row.path.endsWith("/utxo")).length - utxosBefore, reads,
    })), contentType: "application/json" });
  });
}

test("disconnected Computer schedules no account reads", async ({ page }) => {
  const reads = await installReadFixture(page);
  await page.goto("/?folder=contacts");
  await page.clock.runFor(180_000);
  expect(reads.some((row) => row.path.startsWith(`/api/v1/address/${ADDRESS}/`))).toBe(false);
  expect(await page.evaluate(() => window.__readFixture.walletReads)).toBe(0);
});
