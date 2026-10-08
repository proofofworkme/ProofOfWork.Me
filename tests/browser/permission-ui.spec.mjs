import { expect, test } from "@playwright/test";
import * as bitcoin from "bitcoinjs-lib";
import { encodePermissionRecord, PERMISSION_ACTIVATION_HEIGHT, PERMISSION_ACTIVATION_PREVIOUS_BLOCK_HASH } from "../../src/shared/protocol/permissions.mjs";

const id = value => value.toString(16).padStart(64, "0");
// Disposable public fixture account; no connected wallet is used.
const owner = "1FvyAqqELFiQyaEWdhFbWF8MZapKPZS8J7";
const unsupportedOwner = "bc1qfwytlzyr3ym3enz2eutwtjsf9kkf6uqkjydk3e";
const foreign = "1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa";
const height = Math.max(PERMISSION_ACTIVATION_HEIGHT + 2, 100);
const policy = { signingEnabled: true, allowedActions: ["amo.buywork", "amo.listwork", "amo.sealwork", "boost.post", "mail.send", "publish.article"],
  maxTransactionProofs: "5000", dailyLimitProofs: "30000", maxMinerFeeProofs: "1000", allowedRecipients: null, workLimits: null };
const grant = { txid: id(1), rootTxid: id(1), headTxid: id(1), walletAddress: owner,
  label: "Fixture Computer permission", policy, status: "active", blockHeight: height - 1, blockHash: "b".repeat(64), blockTransactionIndex: 1 };
const metadata = { v: 1, network: "livenet", label: grant.label, policy };
const rawBody = encodePermissionRecord("grant", metadata);
const event = { txid: grant.txid, action: "grant", walletAddress: owner, authorAddress: owner, metadata, rawBody,
  rootTxid: grant.txid, parentTxid: "", selfPaymentProofs: "546", confirmed: true, valid: true, applied: true, validationErrors: [], blockHeight: height - 1 };
const evidence = { network: "livenet", complete: true, source: "proof-indexer-exact-canonical-permission-replay",
  coverage: { complete: true, indexedThroughBlock: height, checkpointHash: "a".repeat(64), activationHeight: PERMISSION_ACTIVATION_HEIGHT, witnessSha256: "c".repeat(64) },
  admission: { ready: PERMISSION_ACTIVATION_HEIGHT > 0, writesEnabled: true, activationHeight: PERMISSION_ACTIVATION_HEIGHT,
    activationPreviousBlockHash: PERMISSION_ACTIVATION_PREVIOUS_BLOCK_HASH, minimumSelfPaymentProofs: "546", autonomousSigningEnabled: false },
  budget: { available: false, reason: "protected-controller-required" } };
function fundingFor(address) {
  const transaction = new bitcoin.Transaction(); transaction.addInput(Buffer.alloc(32, 1), 0);
  transaction.addOutput(bitcoin.address.toOutputScript(address), 2_000_000n); return transaction;
}

async function fixture(page, { unavailable = false, wallet = false, empty = false, raw = false, malformed = false, unsupportedWallet = false } = {}) {
  const walletAddress = unsupportedWallet ? unsupportedOwner : owner;
  const funding = fundingFor(walletAddress);
  const utxo = { txid: funding.getId(), vout: 0, value: 2_000_000, status: { confirmed: true } };
  if (wallet) await page.addInitScript(({ owner, utxo }) => {
    const handlers = new Map(); window.permissionSignatureCalls = 0; window.permissionAccounts = [owner];
    window.permissionWalletEvent = (event, values) => { if (event === "accountsChanged") window.permissionAccounts = values; for (const handler of handlers.get(event) ?? []) handler(values); };
    window.unisat = { getAccounts: async () => window.permissionAccounts, requestAccounts: async () => window.permissionAccounts,
      getNetwork: async () => "livenet", getBitcoinUtxos: async () => [utxo],
      on: (event, handler) => handlers.set(event, [...(handlers.get(event) ?? []), handler]),
      removeListener: (event, handler) => handlers.set(event, (handlers.get(event) ?? []).filter(value => value !== handler)),
      signPsbt: async () => { window.permissionSignatureCalls++; throw new Error("Rejected by disposable test wallet"); } };
  }, { owner: walletAddress, utxo });
  await page.route("**/api/v1/**", async route => {
    const url = new URL(route.request().url());
    if (route.request().method() !== "GET") return route.abort("blockedbyclient");
    if (url.pathname === "/api/v1/permissions") return route.fulfill(unavailable
      ? { status: 503, json: { error: "Canonical Permission candidate discovery is incomplete", details: { code: "PERMISSION_DISCOVERY_INCOMPLETE" } } }
      : { json: { ...evidence, permissions: empty ? [] : [grant], pagination: { hasMore: false, total: empty ? 0 : 1 } } });
    if (url.pathname === "/api/v1/permission") {
      if (url.searchParams.get("inspect") === "1") return raw ? route.fulfill({ json: { network: "livenet", complete: false, currentStatusVerified: false,
        authorityVerified: true, source: "first-party-raw-permission-record", record: { ...event, applied: false } } }) : route.fulfill({ status: 503, json: { error: "Raw inspection unavailable" } });
      if (raw || unavailable) return route.fulfill({ status: 503, json: { error: "Canonical Permission candidate discovery is incomplete" } });
      return route.fulfill({ json: { ...evidence, permission: malformed ? { ...grant, walletAddress: "" } : grant,
        currentPermission: grant, currentStatusVerified: true, events: [event], eventsComplete: true } });
    }
    if (url.pathname.endsWith("/utxo")) return route.fulfill({ json: [utxo] });
    if (url.pathname.endsWith("/hex")) return route.fulfill({ json: { hex: funding.toHex() } });
    if (url.pathname.endsWith("/status")) return route.fulfill({ json: { status: "confirmed", confirmed: true } });
    if (url.pathname === "/api/v1/registry") return route.fulfill({ json: { network: "livenet", records: [], listings: [], coverage: { complete: true }, collectionHasMore: { listings: false } } });
    if (url.pathname === "/api/v1/token") return route.fulfill({ json: { network: "livenet", listings: [], source: "proof-indexer-wallet-token-overlay+proof-indexer-wallet-address-state", walletScoped: true, authoritativeWallet: true, summaryOnly: true } });
    if (url.pathname === "/api/v1/boost") return route.fulfill({ json: { network: "livenet", complete: true, items: [], hasMore: false } });
    return route.fulfill({ json: { records: [], items: [], listings: [], complete: true, minimumFee: 0.1, fastestFee: 1, halfHourFee: 1, hourFee: 1 } });
  });
}

test("incomplete discovery stays unavailable instead of claiming no grants", async ({ page }) => {
  await fixture(page, { unavailable: true }); await page.goto("/?permission-app=1");
  await expect(page.getByRole("heading", { name: "Permission evidence unavailable", exact: true })).toBeVisible();
  await expect(page.getByText(/Canonical Permission candidate discovery is incomplete/)).toBeVisible();
  await expect(page.getByRole("heading", { name: "No confirmed permissions yet", exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Retry confirmed read", exact: true })).toBeVisible();
});

for (const width of [390, 1440]) {
  test(`wallet terms and protected controller status fit ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 }); await fixture(page); await page.goto("/?permission-app=1");
    await page.getByRole("button", { name: grant.label, exact: true }).click();
    await expect(page.getByLabel("Confirmed permission terms", { exact: true })).toContainText("AGENT_DAILY_LIMIT_PROOFS=30000");
    await expect(page.getByText("Autonomous signing is closed", { exact: true })).toBeVisible();
    await expect(page.getByLabel("Controller budget accounting").getByText("Unavailable", { exact: true })).toHaveCount(3);
    await expect(page.getByRole("button", { name: "Replace", exact: true })).toBeDisabled();
    await page.getByText("Local wallet setup and agent configuration", { exact: true }).click();
    await expect(page.getByLabel("Local configuration example")).toContainText('unisat_password_secret="unisat_local"');
    await expect(page.locator('input[type="password"]')).toHaveCount(0);
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.screenshot({ path: `/tmp/proofofwork-permission-fixture-${width}.png`, fullPage: true });
    const dimensions = await page.evaluate(() => ({ document: document.documentElement.scrollWidth, viewport: window.innerWidth }));
    expect(dimensions.document).toBeLessThanOrEqual(dimensions.viewport + 1);
  });
}

test("isolated raw record shows terms without current authority or lifecycle controls", async ({ page }) => {
  await fixture(page, { raw: true }); await page.goto(`/?permission-app=1&permission=${grant.txid}`);
  await expect(page.getByText("Current status unverified", { exact: true })).toBeVisible();
  await expect(page.getByLabel("Recorded permission terms")).toContainText("AGENT_ALLOWED_ACTIONS=");
  await expect(page.getByLabel("Raw permission inspection").getByText(/Verified input-authorizing wallet/)).toBeVisible();
  await expect(page.getByRole("button", { name: "Replace", exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Revoke", exact: true })).toHaveCount(0);
});

test("malformed wallet authority never appears as a verified grant", async ({ page }) => {
  await fixture(page, { malformed: true }); await page.goto(`/?permission-app=1&permission=${grant.txid}`);
  await expect(page.getByRole("heading", { name: "Permission evidence unavailable", exact: true })).toBeVisible();
  await expect(page.getByLabel("Confirmed permission terms")).toHaveCount(0);
});

test("embedded local draft survives reload and refuses to leave when storage cannot save", async ({ page }) => {
  await fixture(page); await page.goto("/?folder=permission");
  await page.getByRole("button", { name: "New permission", exact: true }).click();
  await page.getByRole("textbox", { name: "Permission label", exact: true }).fill("Retained grant draft");
  await expect(page.getByLabel("Permission terms preview")).toContainText("AGENT_MAX_TRANSACTION_PROOFS=5000");
  const allowed = await page.evaluate(() => {
    const original = Storage.prototype.setItem;
    Storage.prototype.setItem = function (key, value) { if (key.startsWith("proofofwork.permission.draft")) throw new Error("Fixture storage quota"); return original.call(this, key, value); };
    const result = window.dispatchEvent(new Event("proofofwork:before-permission-writer-leave", { cancelable: true }));
    Storage.prototype.setItem = original; return result;
  });
  expect(allowed).toBe(false); await expect(page.getByRole("textbox", { name: "Permission label", exact: true })).toHaveValue("Retained grant draft");
  await page.reload(); await page.getByRole("button", { name: "Resume draft", exact: true }).click();
  await expect(page.getByRole("textbox", { name: "Permission label", exact: true })).toHaveValue("Retained grant draft");
});

test("public label text stays inert", async ({ page }) => {
  await fixture(page); await page.goto("/?permission-app=1"); await page.getByRole("button", { name: "New permission", exact: true }).click();
  await page.getByRole("textbox", { name: "Permission label", exact: true }).fill('<script>window.permissionInjected=true</script>');
  await expect(page.getByLabel("Permission terms preview")).toContainText("AGENT_SIGNING_ENABLED=true");
  expect(await page.evaluate(() => window.permissionInjected)).toBeUndefined();
  await expect(page.getByRole("button", { name: "Review permission", exact: true })).toBeDisabled();
});

test("wallet grant review requests no signature and account switch invalidates review", async ({ page }) => {
  test.skip(PERMISSION_ACTIVATION_HEIGHT === 0, "Source activation is deliberately closed until canonical pin review.");
  await fixture(page, { wallet: true }); await page.goto("/?permission-app=1");
  await page.getByRole("button", { name: "Connect UniSat", exact: true }).click(); await page.getByRole("button", { name: "New permission", exact: true }).click();
  await page.getByRole("textbox", { name: "Permission label", exact: true }).fill("Reviewed wallet grant");
  await page.getByRole("button", { name: "Review permission", exact: true }).click();
  await expect(page.getByRole("dialog", { name: "Create permission grant", exact: true })).toBeVisible();
  expect(await page.evaluate(() => window.permissionSignatureCalls)).toBe(0);
  await page.evaluate(value => window.permissionWalletEvent("accountsChanged", [value]), foreign);
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page.getByText("Wallet account changed. Review Permission actions again.", { exact: true })).toBeVisible();
  expect(await page.evaluate(() => window.permissionSignatureCalls)).toBe(0);
});

test("unsupported wallet shows its reason and cannot prepare a permission review", async ({ page }) => {
  await fixture(page, { wallet: true, empty: true, unsupportedWallet: true }); await page.goto("/?permission-app=1");
  await page.getByRole("button", { name: "Connect UniSat", exact: true }).click();
  await page.getByRole("button", { name: "New permission", exact: true }).click();
  await page.getByRole("textbox", { name: "Permission label", exact: true }).fill("Unsupported wallet fixture");
  await expect(page.getByRole("status").filter({ hasText: "Permission v1 requires a mainnet P2PKH UniSat address beginning with 1." })).toBeVisible();
  await expect(page.getByRole("button", { name: "Review permission", exact: true })).toBeDisabled();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  expect(await page.evaluate(() => window.permissionSignatureCalls)).toBe(0);
});
