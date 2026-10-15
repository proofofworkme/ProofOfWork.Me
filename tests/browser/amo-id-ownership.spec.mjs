import { expect, test } from "@playwright/test";
import * as bitcoin from "bitcoinjs-lib";
import * as ecc from "@bitcoinerlab/secp256k1";

// Public disposable test material. Every API request is intercepted, signatures
// are rejected locally, and no test can submit a transaction to a live service.
const publicKey = Buffer.from(ecc.pointFromScalar(Buffer.alloc(32, 1), true)).toString("hex");
const OWNER = bitcoin.payments.p2pkh({ pubkey: Buffer.from(publicKey, "hex") }).address;
const OTHER = bitcoin.payments.p2pkh({ pubkey: ecc.pointFromScalar(Buffer.alloc(32, 2), true) }).address;
const ID = "carbonz";
const HASH = "b".repeat(64);
const NOW = "2026-10-15T10:00:00Z";
const HEIGHT = 971542;
const record = { id: ID, ownerAddress: OWNER, receiveAddress: OWNER, network: "livenet",
  confirmed: true, txid: "a".repeat(64), amountSats: 1000, createdAt: NOW };
const pending = { id: ID, network: "livenet", txid: "c".repeat(64), kind: "update", confirmed: false,
  ownerAddress: OWNER, currentOwnerAddress: OWNER, receiveAddress: OWNER, senderAddress: OWNER,
  inputAddresses: [OWNER], createdAt: NOW, amountSats: 546 };
const funding = new bitcoin.Transaction();
funding.addInput(Buffer.alloc(32, 1), 0);
funding.addOutput(bitcoin.address.toOutputScript(OWNER), 1_000_000n);
const utxo = { txid: funding.getId(), vout: 0, value: 1_000_000, status: { confirmed: true } };
const checkpoint = { indexedAt: NOW, indexedThroughBlock: HEIGHT, indexedThroughBlockHash: HASH };
function registry() { return { network: "livenet", source: "proof-indexer", ...checkpoint,
  record, records: [record], listings: [], sales: [], activity: [], pendingEvents: [pending] }; }
const token = { ...checkpoint, network: "livenet", tokens: [], listings: [], closedListings: [], sales: [],
  holders: [], mints: [], transfers: [], invalidEvents: [], authoritativeWallet: true, walletScoped: true,
  source: "proof-indexer-wallet-token-overlay", listingBookComplete: true };
const actualValue = { workNetworkValueAccountingModel: "canonical-exact-work-network-q8-v1",
  creditMinerFeeAccountingModel: "canonical-unique-tx-input-output-v1",
  creditMinerFeeCoverage: { complete: true, confirmedEvents: 1, confirmedTransactions: 1,
    coveredConfirmedEvents: 1, coveredConfirmedTransactions: 1, missingConfirmedEvents: 0,
    missingConfirmedTransactions: 0, missingConfirmedTxids: [], source: "proof-indexer-normalized-input-output-totals" } };
for (const name of ["baseNetworkValue", "baseTotal", "frozenNetworkValue", "frozenTotal", "liveNetworkValue", "liveTotal", "networkValue", "total", "floor", "frozenFloor", "liveFloor"]) {
  const value = name.toLowerCase().includes("floor") ? 1 : 21000000;
  actualValue[`${name}Q8`] = String(BigInt(value) * 100000000n);
  actualValue[`${name}Sats`] = value;
  actualValue[`${name}SatsExact`] = String(value);
}
for (const name of ["creditEventFrozenValue", "creditEventLiveValue", "creditFrozenNetworkValue", "creditLiveNetworkValue", "creditMovementFrozenValue", "creditMovementLiveValue", "creditNetworkValue"]) actualValue[`${name}Q8`] = "0";
const workFloor = { ...checkpoint, ...actualValue, actualValue, network: "livenet",
  workAmoV8: { version: "pwt-sale-v8", pinsRequested: true, pinsConfigured: true, protocolReady: true,
    writeAdmission: true, activation: { active: true, reached: true, tipVerified: true, evidenceComplete: true } } };
function emptyListingPage(limit) { return { ...checkpoint, network: "livenet", source: "proof-indexer-complete-core-reconciled-token-listings",
  kind: "listings", items: [], totalCount: 0, start: 0, end: 0, limit, page: 0, pageCount: 1,
  cursor: "", nextCursor: "", hasMore: false, snapshotId: HASH,
  listingAuthority: { model: "proof-token-market-core-gettxout-v1", includeMempool: true,
    checkpoint: { height: HEIGHT, blockHash: HASH }, checkedOutpointsSha256: HASH,
    checkedListingCount: 0, inputListingCount: 0, outputListingCount: 0, spentListingCount: 0, unspentListingCount: 0 },
  listingProjection: { model: "proof-token-market-cutover-after-core-v1", membershipSha256: HASH,
    activeListingCount: 0, coreUnspentListingCount: 0, excludedByProtocolCount: 0 },
  itemProjection: { model: "proof-token-listing-display-v2", fullMembershipSha256: HASH, fullSourceSha256: HASH },
}; }

async function fixture(page) {
  page.on("pageerror", error => { throw error; });
  const state = { owner: OWNER, refused: "", reads: [], posts: [] };
  await page.addInitScript(({ owner, publicKey, utxo }) => {
    window.amoFixtureSignatures = [];
    window.unisat = {
      getAccounts: async () => [owner], requestAccounts: async () => [owner],
      getNetwork: async () => "livenet", getPublicKey: async () => publicKey,
      getBitcoinUtxos: async () => [utxo], on() {}, removeListener() {},
      signPsbt: async hex => { window.amoFixtureSignatures.push(hex); throw new Error("Fixture wallet rejected signing"); },
      pushPsbt: async () => { throw new Error("Fixture cannot broadcast"); },
      pushTx: async () => { throw new Error("Fixture cannot broadcast"); },
    };
  }, { owner: OWNER, publicKey, utxo });
  await page.route("**/api/v1/**", async route => {
    const request = route.request();
    const url = new URL(request.url());
    if (request.method() !== "GET") {
      state.posts.push(url.pathname);
      return route.fulfill({ status: 405, json: { error: "Fixture cannot broadcast" } });
    }
    state.reads.push(url);
    let json = {};
    if (url.pathname.startsWith("/api/v1/ids/")) {
      // The historical worker error affects availability, although confirmed
      // exact-tip ownership is healthy. This reproduces the incident contract.
      if (url.searchParams.has("current") || state.refused) return route.fulfill({ status: 503,
        json: { error: state.refused || "Confirmed ID availability is unproven: old worker failure", details: { code: "ID_AVAILABILITY_UNPROVEN" } } });
      json = { ...registry(), record: { ...record, ownerAddress: state.owner }, records: [{ ...record, ownerAddress: state.owner }], pendingEvents: [] };
    } else if (url.pathname === "/api/v1/registry" || url.pathname === "/api/v1/registry-summary") json = registry();
    else if (url.pathname === "/api/v1/marketplace-summary") json = { ...checkpoint, network: "livenet", registry: registry(), token, workFloor };
    else if (url.pathname === "/api/v1/token-history") json = emptyListingPage(Number(url.searchParams.get("limit")));
    else if (url.pathname === "/api/v1/token" || url.pathname === "/api/v1/token-summary") json = token;
    else if (url.pathname.endsWith("/utxo")) json = [utxo];
    else if (url.pathname.endsWith("/hex")) json = { hex: funding.toHex() };
    else if (url.pathname.endsWith("/status")) json = { status: "confirmed" };
    else if (url.pathname.endsWith("/mail")) json = { inboxMessages: [], sentMessages: [] };
    return route.fulfill({ json });
  });
  return state;
}
async function prepare(page, path) {
  await page.goto(path);
  await expect(page.getByRole("button", { name: "Disconnect UniSat", exact: true })).toBeVisible();
  await expect(page.getByLabel("AMO summary verification")).toHaveAttribute("data-state", "ready");
  await page.getByLabel("AMO asset tabs").getByRole("button", { name: /^IDs/u }).click();
  await expect(page.getByRole("heading", { name: "List an ID", exact: true })).toBeVisible();
  await expect(page.getByRole("combobox", { name: "ID", exact: true })).toHaveValue(ID);
  await page.getByRole("spinbutton", { name: "Seller price proofs", exact: true }).fill("25000");
  await page.getByRole("button", { name: "Publish On-Chain", exact: true }).click();
  return page.getByRole("dialog", { name: "Review marketplace listing intent", exact: true });
}
for (const path of ["/?marketplace=1", "/?folder=marketplace"]) {
  test(`AMO ID listing reaches review and pre-sign ownership check despite stale worker failure at ${path}`, async ({ page }, info) => {
    const state = await fixture(page);
    const review = await prepare(page, path);
    await expect(review).toBeVisible();
    await expect(review).toContainText(ID);
    await expect(review).toContainText("25000 proofs");
    await expect(review).toContainText("546 proofs");
    await expect(review).toContainText(OWNER);
    expect(await page.evaluate(() => window.amoFixtureSignatures.length)).toBe(0);
    // Empty confirmed-only pendingEvents must not erase the loaded mempool row.
    await expect(page.locator("section.id-card").filter({ has: page.locator("h3").filter({ hasText: "Pending Transfers" }) }).locator(".id-record").filter({ hasText: ID })).toHaveCount(1);
    await page.screenshot({ path: info.outputPath("amo-id-review.png"), fullPage: true });
    await review.getByRole("button", { name: "Continue to wallet", exact: true }).click();
    await expect.poll(() => page.evaluate(() => window.amoFixtureSignatures.length)).toBe(1);
    await expect(page.locator(".app-status-row").first()).toContainText("Fixture wallet rejected signing");
    const reads = state.reads.filter(url => url.pathname === `/api/v1/ids/${ID}`);
    expect(reads.length).toBeGreaterThanOrEqual(2);
    for (const url of reads) {
      expect(url.searchParams.get("fresh")).toBe("1");
      expect(url.searchParams.has("current")).toBe(false);
    }
    expect(state.posts).toEqual([]);
  });
}
for (const failure of ["owner", "canonical read unavailable"]) {
  test(`AMO ID ${failure} after review prevents signing`, async ({ page }) => {
    const state = await fixture(page);
    const review = await prepare(page, "/?marketplace=1");
    await expect(review).toBeVisible();
    if (failure === "owner") state.owner = OTHER;
    else state.refused = failure;
    await review.getByRole("button", { name: "Continue to wallet", exact: true }).click();
    await expect(page.locator(".app-status-row").first()).toContainText(failure === "owner" ? "ownership changed" : failure);
    expect(await page.evaluate(() => window.amoFixtureSignatures.length)).toBe(0);
    expect(state.posts).toEqual([]);
  });
}
