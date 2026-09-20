import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import * as bitcoin from "bitcoinjs-lib";
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import * as icons from "lucide-react";
import ts from "typescript";

const root = new URL("../", import.meta.url);
async function loadTypeScript(path) {
  const source = readFileSync(new URL(path, root), "utf8");
  const compiled = ts.transpileModule(source, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
  }).outputText;
  return import(`data:text/javascript;base64,${Buffer.from(compiled).toString("base64")}`);
}
const work = await loadTypeScript("src/workAmount.ts");
const exact = await loadTypeScript("src/exactAmount.ts");
const capacity = await loadTypeScript("src/shared/work/canonicalWorkCapacity.ts");
const limits = await loadTypeScript("src/shared/bitcoin/protocolLimits.ts");
const source = readFileSync(new URL("src/App.tsx", root), "utf8");
const parsed = ts.createSourceFile("App.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const declarations = new Map();
const appIcons = {};
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
  const context = vm.createContext({ ...work, ...exact, ...capacity, ...limits, ...React, ...appIcons, React, bitcoin, Buffer, URLSearchParams, ...overrides });
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
  const pendingListing = { ...state.listings[0], confirmed: false, sealConfirmed: false, listingId: "b".repeat(64), amountSubatoms: "1000", amount: "0.0000000000001", createdAt: new Date().toISOString() };
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
  state.indexedThroughBlock++;
  await assert.rejects(api.requireFreshWorkCapacityBeforeBroadcast(address, token, 1n, [], [], [], []), /capacity/iu);
  assert.equal(reads, 4);
});

test("actual composer renders missing capacity as unavailable while keeping the draft and disabled Send visible", () => {
  const { ComposePane } = client(["ComposePane"], {
    formatBytes: (value) => `${value} bytes`,
    FeeRateControl: () => null,
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
