import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import * as bitcoin from "bitcoinjs-lib";
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import * as icons from "lucide-react";
import ts from "typescript";
import * as expandedLiquidity from "../src/shared/protocol/workAmoExpandedLiquidity.mjs";
import * as payProtocol from "../src/shared/protocol/pay.mjs";

const root = new URL("../", import.meta.url);
const tsModuleCache = new Map();
async function loadTypeScript(path) {
  function load(file) {
    if (tsModuleCache.has(file.href)) return tsModuleCache.get(file.href);
    const source = readFileSync(file, "utf8");
    const compiled = ts.transpileModule(source, {
      compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
    }).outputText;
    const exports = {};
    tsModuleCache.set(file.href, exports);
    vm.runInNewContext(compiled, { exports, TextEncoder, TextDecoder, require: name => {
      if (name === "bitcoinjs-lib") return bitcoin;
      if (name === "buffer") return { Buffer };
      if (name === "../protocol/pay.mjs") return payProtocol;
      if (name === "../protocol/workAmoExpandedLiquidity.mjs") return expandedLiquidity;
      if (!name.startsWith(".")) throw new Error("Unexpected fixture dependency: " + name);
      return load(new URL(name + ".ts", file));
    } }, { filename: file.pathname });
    return exports;
  }
  return load(new URL(path, root));
}
const work = await loadTypeScript("src/workAmount.ts");
const exact = await loadTypeScript("src/exactAmount.ts");
const capacity = await loadTypeScript("src/shared/work/canonicalWorkCapacity.ts");
const attachmentSource = readFileSync(new URL("src/shared/protocol/mailAttachment.ts", root), "utf8");
const MAX_ATTACHMENT_BYTES = Number(attachmentSource.match(/export const MAX_ATTACHMENT_BYTES = ([\d_]+);/u)[1].replaceAll("_", ""));
const limits = await loadTypeScript("src/shared/bitcoin/protocolLimits.ts");
const utxos = await loadTypeScript("src/walletUtxos.ts");
const encoding = await loadTypeScript("src/shared/utils/encoding.ts");
const { inspectPreparedPayment } = await loadTypeScript("src/shared/wallet/paymentReview.ts");
const source = readFileSync(new URL("src/App.tsx", root), "utf8");
const parsed = ts.createSourceFile("App.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const declarations = new Map();
const appIcons = {};
function findWalletActions(node) {
  if (ts.isFunctionDeclaration(node) && ["listToken", "sealTokenListing", "marketplaceFields"].includes(node.name?.text)) {
    declarations.set(node.name.text, node);
    return;
  }
  ts.forEachChild(node, findWalletActions);
}
findWalletActions(parsed);
for (const node of parsed.statements) {
  if (ts.isImportDeclaration(node) && node.moduleSpecifier.text === "lucide-react") {
    for (const item of node.importClause.namedBindings.elements) appIcons[item.name.text] = icons[item.name.text];
  }
  if (ts.isFunctionDeclaration(node) && node.name) declarations.set(node.name.text, node);
  if (ts.isVariableStatement(node)) {
    for (const declaration of node.declarationList.declarations) {
      if (ts.isIdentifier(declaration.name)) declarations.set(declaration.name.text, node);
    }
  }
}

// Execute the actual transitive App functions and constants. No arithmetic,
// listing merge, normalization, Wallet display or preflight function is mocked.
function client(entries, overrides = {}) {
  const context = vm.createContext({ ...work, ...exact, ...capacity, ...limits, ...utxos, ...encoding, ...expandedLiquidity, ...React, ...appIcons, React, bitcoin, Buffer, URLSearchParams, MAX_ATTACHMENT_BYTES, ...overrides });
  const selected = new Set();
  const ordered = [];
  function visit(name) {
    if (name in context || selected.has(name) || !declarations.has(name)) return;
    selected.add(name);
    const node = declarations.get(name);
    function dependency(child) {
      if (ts.isIdentifier(child) && child.text !== name) visit(child.text);
      ts.forEachChild(child, dependency);
    }
    dependency(node);
    ordered.push(node.getText(parsed).replace(/^export\s+(?:default\s+)?/u, ""));
  }
  entries.forEach(visit);
  const compiled = ts.transpileModule(ordered.join("\n"), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None, jsx: ts.JsxEmit.React },
  }).outputText;
  vm.runInContext(`${compiled}\nthis.checked = {${entries.join(",")}};`, context);
  return context.checked;
}

const audit = JSON.parse(readFileSync(new URL("scripts/fixtures/h19-work-wallet-reservations.json", root), "utf8"));
function fixture() {
  const token = { ...audit.token };
  const address = audit.holder.address;
  const row = ([listingId, amountSubatoms]) => ({
    ...token, listingId, amountSubatoms, amount: work.workDecimalFromAtoms(amountSubatoms),
    confirmed: true, sealConfirmed: true, createdAt: "2026-09-13T22:58:10.000Z",
    sellerAddress: address, saleAuthorization: { ...audit.saleAuthorization },
  });
  const state = {
    ...token, indexedThroughBlock: audit.indexedThroughBlock,
    indexedThroughBlockHash: audit.indexedThroughBlockHash,
    holders: [{ ...audit.holder }], tokens: [token], mints: [], transfers: [], sales: [],
    listings: audit.activeReservations.map(row),
    closedListings: audit.closedReservations.map((item) => ({ ...row(item), closedConfirmed: true })),
  };
  state.canonicalWorkCapacities = [{
    model: "canonical-work-wallet-capacity-v1", network: token.network, tokenId: token.tokenId, address,
    indexedThroughBlock: state.indexedThroughBlock, indexedThroughBlockHash: state.indexedThroughBlockHash,
    confirmedBalanceSubatoms: "999980000000000", reservedBalanceSubatoms: "89507365978",
    transferableBalanceSubatoms: "999890492634022",
    pendingListingNetworkValueQ8: (25000n * 21000000n * 10000000000000000n * 100000000n / 1000n).toString(),
    pendingListingReserveSubatoms: "1000",
    reservations: [...audit.activeReservations, ...audit.closedReservations].map(([listingId, amountSubatoms]) => ({ listingId, amountSubatoms })),
    // Structural test envelope, not a claim that the saved public response
    // already contained this new API field or a full commitment preimage.
    tokenStateCommitment: { model: "canonical-work-amo-payload-sha256-v1", sha256: "a".repeat(64), payloadBytes: 1234 },
  }];
  return { token, address, state };
}
const entries = ["tokenSpendabilityForWallet", "tokenWalletBalancesFor", "tokenWalletBalanceUnitSummary", "tokenWalletBalanceSpendableUnits", "tokenWalletBalanceReservedUnits", "tokenAmountDisplayFromUnits", "tokenSummaryMetadata", "tokenRequiresCanonicalWorkCapacity"];
const app = client(entries);

test("Audit 19 exact 105 active / 38 closed reservation gap is retained in every Wallet capacity consumer", () => {
  const { address, token, state } = fixture();
  assert.equal(state.listings.length, 105);
  assert.equal(state.closedListings.length, 38);
  const active = audit.activeReservations.reduce((sum, [, amount]) => sum + BigInt(amount), 0n);
  const closed = audit.closedReservations.reduce((sum, [, amount]) => sum + BigInt(amount), 0n);
  assert.equal(active, 65722187250n);
  assert.equal(closed, 23785178728n);
  const result = app.tokenSpendabilityForWallet(address, token, state);
  assert.equal(result.reservedBalanceSubatoms, "89507365978");
  assert.equal(result.spendableBalanceSubatoms, "999890492634022");
  const balance = app.tokenWalletBalancesFor(address, [token], [], [], [], state.holders, state)[0];
  const units = app.tokenWalletBalanceSpendableUnits(balance, state.listings, address);
  assert.equal(units, 999890492634022n);
  assert.equal(app.tokenWalletBalanceReservedUnits(balance, state.listings, address), 89507365978n);
  assert.equal(app.tokenWalletBalanceUnitSummary(balance, state.listings, address).spendableUnits, units);
  assert.equal(app.tokenAmountDisplayFromUnits(token, units), "0.0999890492634022");
  assert.equal(app.tokenSummaryMetadata(state).canonicalWorkCapacities, state.canonicalWorkCapacities);
  assert.ok(999914277812750n > units, "the previously displayed maximum must now fail preflight");
});

test("missing or inconsistent receipts fail closed in action and display paths", () => {
  const mutations = [
    (s) => { delete s.canonicalWorkCapacities; },
    (s) => { s.canonicalWorkCapacities = []; },
    (s) => { s.canonicalWorkCapacities.push(structuredClone(s.canonicalWorkCapacities[0])); },
    (s) => { s.indexedThroughBlock++; },
    (s) => { s.indexedThroughBlock = 0; s.canonicalWorkCapacities[0].indexedThroughBlock = 0; },
    (s) => { s.indexedThroughBlockHash = "b".repeat(64); },
    ...["model", "network", "address", "tokenId"].map((key) => (s) => { s.canonicalWorkCapacities[0][key] = "wrong"; }),
    ...["confirmedBalanceSubatoms", "reservedBalanceSubatoms", "transferableBalanceSubatoms"].map((key) => (s) => { s.canonicalWorkCapacities[0][key] = "0"; }),
    (s) => { s.canonicalWorkCapacities[0].reservations.pop(); },
    (s) => { s.canonicalWorkCapacities[0].reservations.push(s.canonicalWorkCapacities[0].reservations[0]); },
    (s) => { s.canonicalWorkCapacities[0].reservations[0].amountSubatoms = "-1"; },
    (s) => { s.canonicalWorkCapacities[0].reservations[0].amountSubatoms = "01"; },
    (s) => { s.canonicalWorkCapacities[0].tokenStateCommitment.sha256 = "bad"; },
    (s) => { s.canonicalWorkCapacities[0].tokenStateCommitment.model = "canonical-work-token-state-subatoms-v3"; },
    (s) => { s.canonicalWorkCapacities[0].tokenStateCommitment.payloadBytes = 0; },
  ];
  for (const mutate of mutations) {
    const { address, token, state } = fixture();
    mutate(state);
    assert.throws(() => app.tokenSpendabilityForWallet(address, token, state), /capacity/iu);
    const balance = app.tokenWalletBalancesFor(address, [token], [], [], [], state.holders, state)[0];
    assert.ok(balance.canonicalWorkCapacityError);
    assert.equal(app.tokenWalletBalanceSpendableUnits(balance, state.listings, address), null);
    assert.equal(app.tokenWalletBalanceReservedUnits(balance, state.listings, address), null);
    assert.equal(app.tokenAmountDisplayFromUnits(token, null), "Unavailable");
  }
});

test("pending transfers and new listings remain held while known canonical reservations are counted once", () => {
  const { address, token, state } = fixture();
  const pendingListing = { ...state.listings[0], saleAuthorization: { ...state.listings[0].saleAuthorization, unitFaceProofs: 25000 }, confirmed: false, sealConfirmed: false, listingId: "b".repeat(64), amountSubatoms: "1000", amount: "0.0000000000001", createdAt: new Date().toISOString() };
  const transfer = { ...token, senderAddress: address, recipientAddress: "recipient", txid: "c".repeat(64), amountSubatoms: "2000", amount: "0.0000000000002", confirmed: false };
  state.transfers = [transfer];
  const sale = { ...token, sellerAddress: address, buyerAddress: "buyer", txid: "d".repeat(64), listingId: state.closedListings[0].listingId, amount: state.closedListings[0].amount, amountSubatoms: state.closedListings[0].amountSubatoms, confirmed: false };
  state.sales = [sale];
  const result = app.tokenSpendabilityForWallet(address, token, state, [pendingListing], [], [transfer], [sale]);
  assert.equal(result.reservedBalanceSubatoms, "89507366978");
  assert.equal(result.pendingOutgoingSubatoms, "2000");
  assert.equal(result.spendableBalanceSubatoms, "999890492631022");
  const knownPending = { ...state.listings[0], confirmed: false };
  assert.equal(app.tokenSpendabilityForWallet(address, token, state, [knownPending]).reservedBalanceSubatoms, "89507365978");
  const balance = app.tokenWalletBalancesFor(address, [token], [], state.transfers, state.sales, state.holders, state)[0];
  assert.equal(balance.pendingOutgoingSubatoms, "2000");
  assert.equal(app.tokenWalletBalanceSpendableUnits(balance, [...state.listings, pendingListing], address), 999890492631022n);
});

test("address selection preserves Base58 case and accepts a uniformly uppercase Bech32 address", () => {
  const { address, token, state } = fixture();
  assert.equal(app.tokenSpendabilityForWallet(address.toUpperCase(), token, state).spendableBalanceSubatoms, "999890492634022");
  state.holders[0].address = "1CaseSensitiveWallet";
  state.canonicalWorkCapacities[0].address = "1casesensitivewallet";
  assert.throws(() => app.tokenSpendabilityForWallet("1CaseSensitiveWallet", token, state), /capacity/iu);
});

test("distinct uppercase and lowercase historical holders remain separate while wallet input maps to the Core key", () => {
  const { address, token, state } = fixture();
  state.holders.unshift({ ...state.holders[0], address: address.toUpperCase(), balance: "3", balanceSubatoms: "30000000000000000" });
  for (const input of [address, address.toUpperCase()]) {
    const result = app.tokenSpendabilityForWallet(input, token, state);
    assert.equal(result.confirmedBalanceSubatoms, "999980000000000");
    assert.equal(result.spendableBalanceSubatoms, "999890492634022");
    const balance = app.tokenWalletBalancesFor(input, [token], [], [], [], state.holders, state)[0];
    assert.equal(balance.confirmedBalanceSubatoms, "999980000000000");
    assert.equal(app.tokenWalletBalanceSpendableUnits(balance, state.listings, input), 999890492634022n);
  }
  state.canonicalWorkCapacities[0].address = address.toUpperCase();
  assert.throws(() => app.tokenSpendabilityForWallet(address, token, state), /capacity/iu);
  state.canonicalWorkCapacities[0].address = address;
  state.holders.pop();
  assert.throws(() => app.tokenSpendabilityForWallet(address, token, state), /verify.*balance/iu);
});

test("current WORK uses exact recipient spelling for pending debits and deduplication", () => {
  const { address, token, state } = fixture();
  const upper = { ...token, senderAddress: address, recipientAddress: address.toUpperCase(), txid: "c".repeat(64), amount: "0.0000000000002", amountSubatoms: "2000", confirmed: false };
  const lower = { ...upper, recipientAddress: address };
  state.transfers = [upper];
  assert.equal(app.tokenSpendabilityForWallet(address, token, state).pendingOutgoingSubatoms, "2000");
  assert.equal(app.tokenSpendabilityForWallet(address, token, state, [], [], [lower]).pendingOutgoingSubatoms, "2000");
  state.transfers = [lower];
  assert.equal(app.tokenSpendabilityForWallet(address, token, state).pendingOutgoingSubatoms, "0");
  state.transfers = [{ ...upper, senderAddress: address.toUpperCase() }];
  assert.equal(app.tokenSpendabilityForWallet(address, token, state).pendingOutgoingSubatoms, "2000");
});

test("duplicate holders and malformed local debits cannot silently become spendable capacity", () => {
  const { address, token, state } = fixture();
  state.holders.push({ ...state.holders[0] });
  assert.throws(() => app.tokenSpendabilityForWallet(address, token, state), /verify.*balance/iu);
  state.holders.pop();
  for (const amount of [undefined, "-1", "bad"]) {
    state.transfers = [{ ...token, senderAddress: address, recipientAddress: "recipient", txid: "c".repeat(64), amount: "bad", amountSubatoms: amount, confirmed: false }];
    assert.throws(() => app.tokenSpendabilityForWallet(address, token, state), /pending WORK transfer/iu);
    const balance = app.tokenWalletBalancesFor(address, [token], [], state.transfers, [], state.holders, state)[0];
    assert.equal(app.tokenWalletBalanceSpendableUnits(balance, state.listings, address), null);
  }
});

test("other credits and pre-Q16 WORK retain their existing reservation arithmetic", () => {
  const { address, token, state } = fixture();
  delete token.amountStorageModel; delete token.precisionModel;
  delete state.amountStorageModel; delete state.precisionModel; delete state.canonicalWorkCapacities;
  assert.equal(app.tokenSpendabilityForWallet(address, token, state).spendableBalanceSubatoms, "999914277812750");
  const other = { ...token, tokenId: "9".repeat(64), ticker: "TEST" };
  const otherState = { holders: [{ address, tokenId: other.tokenId, balance: "100" }], listings: [], closedListings: [], transfers: [], sales: [] };
  assert.equal(app.tokenSpendabilityForWallet(address, other, otherState).spendableBalanceAtoms, "100");
});

test("actual fresh preflight preserves receipt scope and the final broadcast fence rejects changed capacity", async () => {
  const { address, token, state } = fixture();
  let reads = 0;
  const api = client(["fetchFreshWalletTokenPreflightState", "requireFreshWorkCapacityBeforeBroadcast"], {
    fetchProofApiJson: async () => {
      reads++;
      return { ...state, authoritativeWallet: true, walletScoped: true, source: "proof-indexer-wallet-token-overlay" };
    },
  });
  const fresh = await api.fetchFreshWalletTokenPreflightState(address, token.tokenId);
  assert.equal(fresh.indexedThroughBlock, state.indexedThroughBlock);
  assert.equal(fresh.canonicalWorkCapacities, state.canonicalWorkCapacities);
  await api.requireFreshWorkCapacityBeforeBroadcast(address, token, 999890492634022n, [], [], [], []);
  await assert.rejects(api.requireFreshWorkCapacityBeforeBroadcast(address, token, 999914277812750n, [], [], [], []), /No transaction was broadcast/u);
  state.transfers.push({ ...token, txid: "3".repeat(64), senderAddress: address, recipientAddress: "recipient",
    amountSubatoms: (999890492634022n - 1000n).toString(), confirmed: false });
  await api.requireFreshWorkCapacityBeforeBroadcast(address, token, 1n, [], [], [], [], 25000);
  await assert.rejects(api.requireFreshWorkCapacityBeforeBroadcast(address, token, 1n, [], [], [], [], 250000), /No transaction was broadcast/u);
  state.indexedThroughBlock++;
  await assert.rejects(api.requireFreshWorkCapacityBeforeBroadcast(address, token, 1n, [], [], [], []), /capacity/iu);
  assert.equal(reads, 6);
});

test("actual composer renders missing capacity as unavailable while keeping the draft and disabled Send visible", () => {
  const { ComposePane } = client(["ComposePane"], {
    formatBytes: (value) => `${value} bytes`,
    FeeRateControl: () => null, PowcatLink: () => null,
  });
  const props = {
    amountSats: 546, busy: false, ccRecipient: "", ccRecipientError: false,
    ccRecipientNote: "", contacts: [], dataCarrierBytes: 10, feeRate: 1,
    memo: "Draft", network: "livenet", recipient: "", recipientError: false,
    recipientNote: "", sendState: "disabled", sendStatus: "Canonical WORK capacity is unavailable.",
    sender: audit.holder.address, subject: "Draft", socialMode: false,
    workAmount: "0.1", workAttachmentTotalAtoms: "1000000000000000", workVisible: true,
    workSpendableAtoms: undefined,
  };
  for (const key of ["setAttachment", "setAttachmentFile", "setAmountSats", "setCcRecipient", "setFeeRate", "setMemo", "setParentTxid", "setRecipient", "setSocialMode", "setSubject", "setWorkAmount", "submit"]) props[key] = () => {};
  const html = renderToStaticMarkup(React.createElement(ComposePane, props));
  assert.match(html, /Spendable WORK: Unavailable/u);
  assert.match(html, /value="0\.1"/u);
  assert.match(html, /disabled="" type="submit"/u);
  assert.match(html, /Canonical WORK capacity is unavailable/u);
});


test("pending V8 zero amounts reserve a canonical bound, keep a second listing possible, and never trust an estimate", () => {
  const { address, token, state } = fixture();
  const pending = { ...state.listings[0], confirmed: false, sealConfirmed: false,
    saleAuthorization: { ...state.listings[0].saleAuthorization, unitFaceProofs: 25000 },
    listingId: "e".repeat(64), amount: 0, amountSubatoms: undefined,
    createdAt: new Date().toISOString(), estimate: { estimateOnly: true, unitAmountSubatoms: "1" } };
  const result = app.tokenSpendabilityForWallet(address, token, state, [pending]);
  assert.equal(result.pendingWorkListingAmountUnknown, false);
  assert.equal(result.spendableBalanceSubatoms, "999890492633022");
  assert.ok(BigInt(result.spendableBalanceSubatoms) >= 1000n);
  state.listings.push(pending);
  assert.equal(app.tokenSpendabilityForWallet(address, token, state, [pending]).spendableBalanceSubatoms, result.spendableBalanceSubatoms);
  const second = { ...pending, listingId: "f".repeat(64) };
  assert.equal(app.tokenSpendabilityForWallet(address, token, state, [second]).spendableBalanceSubatoms, "999890492632022");
  const large = { ...second, saleAuthorization: { ...second.saleAuthorization, unitFaceProofs: 250000 } };
  assert.equal(app.tokenSpendabilityForWallet(address, token, state, [large]).spendableBalanceSubatoms, "999890492623022");
  state.listings.push(large, large);
  assert.equal(app.tokenSpendabilityForWallet(address, token, state, [large]).spendableBalanceSubatoms, "999890492623022");
  assert.equal(app.tokenSpendabilityForWallet(address, token, state, [second]).spendableBalanceSubatoms, "0");
  for (const unknown of [undefined, 500000]) {
    const ambiguous = { ...second, listingId: "d".repeat(64), saleAuthorization: { ...second.saleAuthorization, unitFaceProofs: unknown } };
    assert.equal(app.tokenSpendabilityForWallet(address, token, state, [ambiguous]).pendingWorkListingAmountUnknown, true);
  }
  delete state.canonicalWorkCapacities[0].pendingListingNetworkValueQ8;
  delete state.canonicalWorkCapacities[0].pendingListingReserveSubatoms;
  assert.equal(app.tokenSpendabilityForWallet(address, token, state).spendableBalanceSubatoms, "0");
  const balance = app.tokenWalletBalancesFor(address, [token], [], [], [], state.holders, state)[0];
  assert.equal(balance.confirmedBalanceSubatoms, "999980000000000");
  assert.equal(balance.canonicalWorkCapacityError, undefined);
});

test("malformed pending reservation bounds fail closed", () => {
  for (const [key, value] of [["pendingListingReserveSubatoms", "999"], ["pendingListingNetworkValueQ8", "0"], ["pendingListingReserveSubatoms", "01"]]) {
    const { address, token, state } = fixture();
    state.canonicalWorkCapacities[0][key] = value;
    assert.throws(() => app.tokenSpendabilityForWallet(address, token, state), /capacity/iu);
  }
});


test("List builds and reviews one unsigned intent per face; Seal preserves frozen terms and its two reviews", async () => {
  const { token, state } = fixture();
  const seller = bitcoin.payments.p2pkh({ hash: Buffer.alloc(20, 17) });
  const address = seller.address;
  state.holders[0].address = address;
  state.canonicalWorkCapacities[0].address = address;
  const funding = new bitcoin.Transaction();
  funding.addInput(Buffer.alloc(32), 0xffffffff);
  funding.addOutput(seller.output, 100_000n);
  const quote = { workAmoV8: {
    version: "pwt-sale-v8", activation: { reached: true, active: true, evidenceComplete: true },
    protocolReady: true, writeAdmission: true, listingWritesEnabled: true, settlementWritesEnabled: true,
    networkValueBeforeQ8: state.canonicalWorkCapacities[0].pendingListingNetworkValueQ8,
  } };
  let currentReview, sealReviews, status;
  const fixtureWallet = { getPublicKey: () => audit.saleAuthorization.sellerPublicKey,
    signPsbt: () => assert.fail("Unsigned fixture must stop before signing") };
  const context = {
    window: { unisat: fixtureWallet }, network: "livenet", address, feeRate: 1, walletTransferToken: token,
    workFloorQuote: quote, tokenListPriceSats: 0, tokenListBuyerAddress: "", tokenListAmount: "",
    tokenListings: [], tokenClosedListings: [], tokenTransfers: [], tokenSales: [],
    beginWalletScopedTokenAction: () => ({ isCurrent: () => true, setStatus: value => { status = value; }, finish() {} }),
    captureActionContext: () => ({}), ensureWalletNetwork: () => {}, assertActiveWalletAddress: () => {},
    fetchFreshWalletTokenPreflightState: async () => state,
    freshWorkWriteMode: async () => ({ mode: "native-q16", quote }),
    fetchUtxos: async () => [{ txid: funding.getId(), vout: 0, value: 100000, status: { confirmed: true } }],
    fetchFreshProofOfWorkListingAnchorOutpoints: async () => [], fetchBroadcastStatus: async () => "confirmed",
    fetchTransactionHex: async () => funding.toHex(),
    setTokenAction() {}, setBusy() {}, setTokenListingActionNotes() {}, setStatus: value => { status = value; },
    errorMessage: error => error.message, isPlainRecord: item => !!item && typeof item === "object" && !Array.isArray(item),
    reviewMarketplaceSeal: async (listing, kind, task, sign, admission) => {
      await admission(); sealReviews.push("authorization"); return "aa".repeat(64);
    },
    reviewAndSendMarketplace: async request => {
      currentReview = request;
      throw new Error("Fixture stops at the transaction review");
    },
  };
  const resolve = face => client(["listToken", "sealTokenListing", "workAmoV8UnitTerms", "tokenSellerPaymentRequiredSats",
    "workAmoListingCanAttemptFreshPreflight", "assertWorkAmoListingEnabled", "workAmoV8FrozenProjection"], { ...context, tokenListFaceProofs: face });
  const unavailable = resolve(250000);
  for (const gate of [undefined, { listingWritesEnabled: false }]) {
    quote.workAmoV8.expandedLiquidity = gate;
    assert.equal(unavailable.workAmoListingCanAttemptFreshPreflight(quote, 250000), false);
    assert.equal(unavailable.workAmoListingCanAttemptFreshPreflight(quote, 25000), true);
    await unavailable.listToken({ preventDefault() {} });
    assert.match(status.text, /verified declaration, index and live admission/u);
    assert.equal(currentReview, undefined);
  }

  // One legacy 25k created before additive admission, then a fresh 25k and 250k.
  for (const [face, active] of [[25000, false], [25000, true], [250000, true]]) {
    quote.workAmoV8.expandedLiquidity = { listingWritesEnabled: active };
    const api = resolve(face);
    await api.listToken({ preventDefault() {} });
    assert.equal(status.text, "Fixture stops at the transaction review");
    const list = currentReview;
    assert.equal(list.title, "Review marketplace listing intent");
    assert.deepEqual(Array.from(list.labels), ["Listing registry fee", "Seller-controlled ticket locked until purchase or delisting",
      ...(face === 250000 ? ["Liquidity fee"] : [])]);
    const evidence = inspectPreparedPayment({ ...list.prepared, network: bitcoin.networks.bitcoin, paymentCount: list.payments.length, registryPaymentCount: 0 });
    assert.deepEqual(Array.from(evidence.outputs.filter(out => out.kind === "payment"), out => [out.index, out.address, out.proofs]),
      [[0, token.registryAddress, "546"], [2, address, "546"], ...(face === 250000 ? [[3, "1GrrXUmBftWhGCF7XfVUQENY8Js6vUiueR", "5460"]] : [])]);
    assert.equal(evidence.outputs[1].kind, "record");
    assert.equal(evidence.records[0], list.payload);
    assert.ok(BigInt(evidence.feeProofs) > 0n);
    assert.equal(BigInt(evidence.totalSpendProofs) - BigInt(evidence.feeProofs), face === 250000 ? 6552n : 1092n);
    const authorization = JSON.parse(Buffer.from(list.payload.split(":")[2], "base64url"));
    assert.equal(authorization.unitFaceProofs, face);
    assert.equal(authorization.anchorScriptPubKey, Buffer.from(seller.output).toString("hex"));
    assert.equal(authorization.anchorVout, 2);
    for (const key of ["priceSats", "amountSubatoms", "unitAmountSubatoms", "liquidityFeeSats"]) assert.equal(key in authorization, false);
    if (face === 250000) {
      quote.workAmoV8.expandedLiquidity = undefined;
      await assert.rejects(list.revalidate(), /verified declaration, index and live admission/u);
      quote.workAmoV8.expandedLiquidity = { listingWritesEnabled: true };
      quote.workAmoV8.listingWritesEnabled = false;
      await assert.rejects(list.revalidate(), /listing writes are paused/u);
      quote.workAmoV8.listingWritesEnabled = true;
    }
    await list.revalidate();

    const { version, unitModel, stateOrderModel, amountModel, bondTransitionModel, unitWorkOracleModel, blockSequencerModel } = authorization;
    const before = quote.workAmoV8.networkValueBeforeQ8;
    const terms = api.workAmoV8UnitTerms(face, before);
    const frozenTerms = { version, unitModel, stateOrderModel, amountModel, bondTransitionModel, unitWorkOracleModel, blockSequencerModel,
      ...terms, listingBlockHeight: 123, listingBlockIndex: 7, listingBlockHash: "f".repeat(64), listingProtocolVout: 1, listingRecordOrdinal: 0,
      listingNetworkValueBeforeQ8: before, listingBondContributionQ8: "54600000000", listingNetworkValueAfterQ8: (BigInt(before) + 54600000000n).toString() };
    const listing = { ...token, listingId: (face === 250000 ? "e" : "d").repeat(64), sellerAddress: address, unitFaceProofs: face,
      saleAuthorization: authorization, confirmed: true, priceSats: face, amountSubatoms: terms.unitAmountSubatoms, frozenTerms };
    assert.equal(api.workAmoV8FrozenProjection({ ...listing, unitFaceProofs: face === 25000 ? 250000 : 25000 }), null);
    assert.equal(api.workAmoV8FrozenProjection({ ...listing, saleAuthorization: { ...authorization, unitFaceProofs: String(face) } }), null);
    // Original 25k seals after activation, and a confirmed larger intent seals during a fresh-List pause.
    quote.workAmoV8.expandedLiquidity = { listingWritesEnabled: face === 25000 };
    sealReviews = []; currentReview = undefined;
    await api.sealTokenListing(listing);
    assert.equal(status.text, "Fixture stops at the transaction review");
    assert.deepEqual(sealReviews, ["authorization"]);
    assert.equal(currentReview.title, "Review marketplace seal publication");
    assert.equal(currentReview.payments.length, 1);
    const sealEvidence = inspectPreparedPayment({ ...currentReview.prepared, network: bitcoin.networks.bitcoin, paymentCount: 1, registryPaymentCount: 0 });
    assert.equal(sealEvidence.outputs[0].address, token.registryAddress);
    assert.equal(sealEvidence.totalPaymentProofs, "546");
    const sealed = JSON.parse(Buffer.from(currentReview.payload.split(":")[3], "base64url"));
    assert.equal(sealed.anchorTxid, listing.listingId);
    assert.equal(sealed.anchorSignature, "aa".repeat(64));
    assert.deepEqual({ ...sealed, anchorTxid: "", anchorSignature: "" }, authorization);
    assert.equal(api.tokenSellerPaymentRequiredSats(listing), face + 546);
    currentReview = undefined;
  }
});
