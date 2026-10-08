import { expect, test } from "@playwright/test";
import * as bitcoin from "bitcoinjs-lib";
import { createHash } from "node:crypto";
import { encodePermissionRecord, PERMISSION_ACTIVATION_HEIGHT, PERMISSION_ACTIVATION_PREVIOUS_BLOCK_HASH, PERMISSION_FEE_RATE_ACTIVATION_HEIGHT, PERMISSION_FEE_RATE_ACTIVATION_PREVIOUS_BLOCK_HASH } from "../../src/shared/protocol/permissions.mjs";

const id = value => value.toString(16).padStart(64, "0");
// Disposable public fixture account; no connected wallet is used.
const owner = "1FvyAqqELFiQyaEWdhFbWF8MZapKPZS8J7";
const unsupportedOwner = "bc1qfwytlzyr3ym3enz2eutwtjsf9kkf6uqkjydk3e";
const foreign = "1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa";
const height = Math.max(PERMISSION_ACTIVATION_HEIGHT + 2, PERMISSION_FEE_RATE_ACTIVATION_HEIGHT + 2, 100);
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
    activationPreviousBlockHash: PERMISSION_ACTIVATION_PREVIOUS_BLOCK_HASH, minimumSelfPaymentProofs: "546", autonomousSigningEnabled: false, supportedRecordVersions: [1, 2], feeRatePolicyReady: true,
    feeRateActivationHeight: PERMISSION_FEE_RATE_ACTIVATION_HEIGHT, feeRateActivationPreviousBlockHash: PERMISSION_FEE_RATE_ACTIVATION_PREVIOUS_BLOCK_HASH },
  budget: { available: false, reason: "protected-controller-required" } };
function fundingFor(address) {
  const transaction = new bitcoin.Transaction(); transaction.addInput(Buffer.alloc(32, 1), 0);
  transaction.addOutput(bitcoin.address.toOutputScript(address), 2_000_000n); return transaction;
}

async function fixture(page, { unavailable = false, wallet = false, empty = false, raw = false, malformed = false, unsupportedWallet = false, legacyBackend = false } = {}) {
  const walletAddress = unsupportedWallet ? unsupportedOwner : owner;
  const fixtureEvidence = legacyBackend ? { ...evidence, admission: { ...evidence.admission, supportedRecordVersions: [1], feeRatePolicyReady: false } } : evidence;
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
      : { json: { ...fixtureEvidence, permissions: empty ? [] : [grant], pagination: { hasMore: false, total: empty ? 0 : 1 } } });
    if (url.pathname === "/api/v1/permission") {
      if (url.searchParams.get("inspect") === "1") return raw ? route.fulfill({ json: { network: "livenet", complete: false, currentStatusVerified: false,
        authorityVerified: true, source: "first-party-raw-permission-record", record: { ...event, applied: false } } }) : route.fulfill({ status: 503, json: { error: "Raw inspection unavailable" } });
      if (raw || unavailable) return route.fulfill({ status: 503, json: { error: "Canonical Permission candidate discovery is incomplete" } });
      return route.fulfill({ json: { ...fixtureEvidence, permission: malformed ? { ...grant, walletAddress: "" } : grant,
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


const legacyDraft = { action: "grant", grant: "", parent: "", label: "Historical unsent task", signingEnabled: true,
  allowedActions: ["mail.send"], maxTransactionProofs: "5000", dailyLimitProofs: "30000", maxMinerFeeProofs: "1000",
  recipientMode: "any", recipients: "", workEnabled: false, maxAmountSubatoms: "0", minSaleProofs: "25000",
  maxPurchaseProofs: "25000", maxOpenListings: "1", feeRate: 2 };

for (const route of ["/?permission-app=1", "/?folder=permission"]) {
  test(`agent presets and exact custom rate persist separately from publication fees at ${route}`, async ({ page }) => {
    await fixture(page); await page.goto(route); await page.getByRole("button", { name: "New permission", exact: true }).click();
    await page.getByRole("textbox", { name: "Permission label", exact: true }).fill("Exact custom agent rate");
    const agentPresets = page.getByLabel("Agent transaction fee presets", { exact: true });
    const publicationRate = page.getByLabel("Permission publication fee rate (proofs/vB)", { exact: true });
    for (const rate of ["0.1", "0.5", "1", "2"]) {
      await agentPresets.getByRole("button", { name: `${rate} proofs/vB`, exact: true }).click();
      await expect(page.getByLabel("Permission terms preview")).toContainText(`AGENT_MINER_FEE_RATE_PROOFS_PER_VBYTE=${rate}`);
      await expect(publicationRate).toHaveValue("1");
    }
    await page.getByLabel("Agent transaction fee rate (proofs/vB)", { exact: true }).fill("0.10000001");
    await expect(agentPresets.locator('[aria-pressed="true"]')).toHaveCount(0);
    await page.getByLabel("Agent transaction fee rate (proofs/vB)", { exact: true }).fill("0.12345678");
    await publicationRate.fill("0.5");
    await expect(page.getByLabel("Permission terms preview")).toContainText("AGENT_MINER_FEE_RATE_PROOFS_PER_VBYTE=0.12345678");
    await expect(page.getByLabel("Permission terms preview")).not.toContainText("AGENT_MAX_MINER_FEE_PROOFS");
    await page.getByRole("button", { name: "Save draft and back", exact: true }).click();
    await page.reload(); await page.getByRole("button", { name: "Resume draft", exact: true }).click();
    await expect(page.getByLabel("Agent transaction fee rate (proofs/vB)", { exact: true })).toHaveValue("0.12345678");
    await expect(publicationRate).toHaveValue("0.5");
    await expect(page.getByText("Autonomous signing is closed", { exact: true })).toBeVisible();
  });
}

test("legacy unsent draft retains its cap and requires an explicit rate selection", async ({ page }) => {
  await page.addInitScript(value => {
    const key = "proofofwork.permission.draft.v1:livenet:disconnected";
    if (!localStorage.getItem(key)) localStorage.setItem(key, JSON.stringify(value));
  }, legacyDraft);
  await fixture(page); await page.goto("/?permission-app=1"); await page.getByRole("button", { name: "Resume draft", exact: true }).click();
  await expect(page.getByLabel("Agent transaction fee rate (proofs/vB)", { exact: true })).toHaveValue("");
  await expect(page.getByText(/Historical total miner-fee cap: 1000 proofs/)).toBeVisible();
  await expect(page.getByLabel("Permission publication fee rate (proofs/vB)", { exact: true })).toHaveValue("2");
  await expect(page.getByText(/Choose an agent transaction fee rate to upgrade this legacy draft/)).toBeVisible();
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem("proofofwork.permission.draft.v1:livenet:disconnected")))).toEqual(legacyDraft);
  await page.getByLabel("Agent transaction fee presets", { exact: true }).getByRole("button", { name: "0.5 proofs/vB", exact: true }).click();
  await expect(page.getByLabel("Permission terms preview")).toContainText("AGENT_MINER_FEE_RATE_PROOFS_PER_VBYTE=0.5");
  await expect(page.getByLabel("Permission publication fee rate (proofs/vB)", { exact: true })).toHaveValue("2");
  const upgraded = await page.evaluate(() => JSON.parse(localStorage.getItem("proofofwork.permission.draft.v1:livenet:disconnected")));
  expect(upgraded.feePolicyVersion).toBe(2); expect(upgraded.minerFeeRateProofsPerVbyte).toBe("0.5");
  expect(upgraded.legacyMaxMinerFeeProofs).toBe("1000"); expect(upgraded.maxMinerFeeProofs).toBeUndefined();
  await page.reload(); await page.getByRole("button", { name: "Resume draft", exact: true }).click();
  await expect(page.getByLabel("Agent transaction fee rate (proofs/vB)", { exact: true })).toHaveValue("0.5");
  await expect(page.getByLabel("Permission terms preview")).toContainText("AGENT_MINER_FEE_RATE_PROOFS_PER_VBYTE=0.5");
});

test("replacing a legacy grant requires a chosen rate without changing confirmed terms", async ({ page }) => {
  await fixture(page, { wallet: true }); await page.goto(`/?permission-app=1&permission=${grant.txid}`);
  await page.getByRole("button", { name: "Connect UniSat", exact: true }).click();
  await expect(page.getByLabel("Confirmed permission terms")).toContainText("AGENT_MAX_MINER_FEE_PROOFS=1000");
  await page.getByRole("button", { name: "Replace", exact: true }).click();
  await expect(page.getByLabel("Agent transaction fee rate (proofs/vB)", { exact: true })).toHaveValue("");
  await expect(page.getByRole("button", { name: "Review permission", exact: true })).toBeDisabled();
  await page.getByLabel("Agent transaction fee presets", { exact: true }).getByRole("button", { name: "2 proofs/vB", exact: true }).click();
  await page.getByRole("button", { name: "Review permission", exact: true }).click();
  const review = page.getByRole("dialog", { name: "Replace permission grant", exact: true });
  await expect(review).toContainText("AGENT_MINER_FEE_RATE_PROOFS_PER_VBYTE=2");
  await expect(review).not.toContainText("AGENT_MAX_MINER_FEE_PROOFS=1000");
  expect(await page.evaluate(() => window.permissionSignatureCalls)).toBe(0);
});

test("old backend support cannot prepare a new fee-rate grant", async ({ page }) => {
  await fixture(page, { wallet: true, legacyBackend: true }); await page.goto("/?permission-app=1");
  await page.getByRole("button", { name: "Connect UniSat", exact: true }).click();
  await page.getByRole("button", { name: "New permission", exact: true }).click();
  await page.getByRole("textbox", { name: "Permission label", exact: true }).fill("New rate, old backend");
  await page.getByRole("button", { name: "Review permission", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("Permission fee-rate publication is closed until the backend verifies this record version");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  expect(await page.evaluate(() => window.permissionSignatureCalls)).toBe(0);
});

test("unknown legacy signed task stays protected after explicit rate upgrade", async ({ page }) => {
  const receipt = { txid: id(900), address: owner, network: "livenet", title: "Create permission grant", key: `permission:grant:${"d".repeat(64)}`,
    createdAt: "2026-10-08T12:00:00.000Z", status: "unknown", fields: [["Permission draft", JSON.stringify(legacyDraft)]] };
  await page.addInitScript(value => localStorage.setItem("proofofwork-action-receipts-v1", JSON.stringify([value])), receipt);
  await fixture(page, { wallet: true }); await page.goto("/?permission-app=1");
  await page.getByRole("button", { name: "Connect UniSat", exact: true }).click();
  await page.getByText("Transaction recovery · 1 unresolved", { exact: true }).click();
  await page.getByRole("button", { name: "Restore task fields", exact: true }).click();
  await expect(page.getByLabel("Agent transaction fee rate (proofs/vB)", { exact: true })).toHaveValue("");
  await expect(page.getByLabel("Permission publication fee rate (proofs/vB)", { exact: true })).toHaveValue("2");
  await page.getByLabel("Agent transaction fee presets", { exact: true }).getByRole("button", { name: "0.5 proofs/vB", exact: true }).click();
  await page.getByRole("button", { name: "Review permission", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("A signed Permission transaction for this task is unresolved or pending");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  expect(await page.evaluate(() => window.permissionSignatureCalls)).toBe(0);
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem("proofofwork-action-receipts-v1")))).toEqual([receipt]);
});


test("custom agent rates reject extra precision and low values while preserving entered text", async ({ page }) => {
  await fixture(page, { wallet: true }); await page.goto("/?permission-app=1");
  await page.getByRole("button", { name: "Connect UniSat", exact: true }).click();
  await page.getByRole("button", { name: "New permission", exact: true }).click();
  await page.getByRole("textbox", { name: "Permission label", exact: true }).fill("Invalid rate fixture");
  const rate = page.getByLabel("Agent transaction fee rate (proofs/vB)", { exact: true });
  for (const value of ["0.05", "0.123456789"]) {
    await rate.fill(value); await expect(rate).toHaveValue(value);
    await expect(page.getByRole("button", { name: "Review permission", exact: true })).toBeDisabled();
    await expect(page.getByText(/Choose an agent fee rate of at least 0.1 proofs/)).toBeVisible();
  }
  await rate.fill("0.50000000");
  await expect(page.getByLabel("Permission terms preview")).toContainText("AGENT_MINER_FEE_RATE_PROOFS_PER_VBYTE=0.5");
  await expect(page.getByRole("button", { name: "Review permission", exact: true })).toBeEnabled();
  expect(await page.evaluate(() => window.permissionSignatureCalls)).toBe(0);
});


for (const editFirst of [false, true]) {
  test(`autosaved legacy draft cannot bypass its unresolved signed receipt after fee upgrade (edit first: ${editFirst})`, async ({ page }) => {
    const legacyPolicy = { signingEnabled: legacyDraft.signingEnabled, allowedActions: legacyDraft.allowedActions,
      maxTransactionProofs: legacyDraft.maxTransactionProofs, dailyLimitProofs: legacyDraft.dailyLimitProofs,
      maxMinerFeeProofs: legacyDraft.maxMinerFeeProofs, allowedRecipients: null, workLimits: null };
    const legacyBody = encodePermissionRecord("grant", { v: 1, network: "livenet", label: legacyDraft.label, policy: legacyPolicy });
    const originalKey = `permission:grant:${createHash("sha256").update(legacyBody).digest("hex")}`;
    const receipt = { txid: id(editFirst ? 902 : 901), address: owner, network: "livenet", title: "Create permission grant", key: originalKey,
      createdAt: "2026-10-08T12:00:00.000Z", status: editFirst ? "pending" : "unknown", fields: [["Permission draft", JSON.stringify(legacyDraft)]] };
    await page.addInitScript(({ draft, receipt, owner }) => {
      const key = `proofofwork.permission.draft.v1:livenet:${owner}`;
      if (!localStorage.getItem(key)) localStorage.setItem(key, JSON.stringify(draft));
      if (!localStorage.getItem("proofofwork-action-receipts-v1")) localStorage.setItem("proofofwork-action-receipts-v1", JSON.stringify([receipt]));
    }, { draft: legacyDraft, receipt, owner });
    await fixture(page, { wallet: true }); await page.goto("/?permission-app=1");
    await page.getByRole("button", { name: "Connect UniSat", exact: true }).click();
    await page.getByRole("button", { name: "Resume draft", exact: true }).click();
    if (editFirst) await page.getByRole("textbox", { name: "Permission label", exact: true }).fill("Edited signed task label");
    await page.getByLabel("Agent transaction fee presets", { exact: true }).getByRole("button", { name: "0.5 proofs/vB", exact: true }).click();
    await expect(page.getByLabel("Permission terms preview")).toContainText("AGENT_MINER_FEE_RATE_PROOFS_PER_VBYTE=0.5");
    const saved = await page.evaluate(owner => JSON.parse(localStorage.getItem(`proofofwork.permission.draft.v1:livenet:${owner}`)), owner);
    expect(saved.recoveryKey).toBe(originalKey); expect(saved.maxMinerFeeProofs).toBeUndefined();
    await page.getByRole("button", { name: "Review permission", exact: true }).click();
    await expect(page.getByRole("alert")).toContainText("A signed Permission transaction for this task is unresolved or pending");
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await page.reload(); await page.getByRole("button", { name: "Connect UniSat", exact: true }).click();
    await page.getByRole("button", { name: "Resume draft", exact: true }).click();
    await expect(page.getByLabel("Agent transaction fee rate (proofs/vB)", { exact: true })).toHaveValue("0.5");
    await page.getByRole("button", { name: "Review permission", exact: true }).click();
    await expect(page.getByRole("alert")).toContainText("A signed Permission transaction for this task is unresolved or pending");
    await expect(page.getByRole("dialog")).toHaveCount(0);
    expect(await page.evaluate(() => window.permissionSignatureCalls)).toBe(0);
    expect(await page.evaluate(() => JSON.parse(localStorage.getItem("proofofwork-action-receipts-v1")))).toEqual([receipt]);
  });
}
