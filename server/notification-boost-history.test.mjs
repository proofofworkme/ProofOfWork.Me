import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";
import * as bitcoin from "bitcoinjs-lib";
import { boostAddressIdentityKey, compareBoostCanonicalEvents, qualifyBoostPaidActions } from "./boost-projection.mjs";
import { notificationDnsHistoryRelations, notificationIdHistoryRelations } from "./notification-dns-history.mjs";

// Exercise the production replay without starting proof-api's HTTP server or
// its node/database clients. The TypeScript parser selects full declarations.
const source = readFileSync(new URL("./proof-api.mjs", import.meta.url), "utf8");
const parsed = ts.createSourceFile("proof-api.mjs", source, ts.ScriptTarget.Latest, true);
const functions = new Map(parsed.statements.filter(ts.isFunctionDeclaration).map(node => [node.name.text, node.getText(parsed)]));
const constants = new Map(parsed.statements.filter(ts.isVariableStatement)
  .flatMap(node => node.declarationList.declarations.map(declaration => [declaration.name.getText(parsed), node.getText(parsed)])));
const runtime = vm.createContext({ boostAddressIdentityKey, compareBoostCanonicalEvents, qualifyBoostPaidActions,
  freshDataUnavailableError: message => Object.assign(new Error(message), { statusCode: 503 }),
  isValidBitcoinAddress(value) { try { bitcoin.address.toOutputScript(value, bitcoin.networks.bitcoin); return true; } catch { return false; } },
});
vm.runInContext([
  ...["BOOST_EVENT_KINDS", "BOOST_INDEX_EVENT_KINDS", "BOOST_VISIBLE_EVENT_KINDS"].map(name => { assert.ok(constants.has(name)); return constants.get(name); }),
  ...["boostHexTxid", "boostAddress", "boostPostTxid", "boostTargetTxid", "boostQuoteTxid", "boostOwnerSignalSats", "boostPriceSats", "boostOwnershipState",
    "notificationBoostQualification"]
    .map(name => { assert.ok(functions.has(name)); return functions.get(name); }),
].join("\n"), runtime);

const AUTHOR = "1F1zepCJ8VPcPoeMt6G4BPKuE3CYAxCKNY";
const OWNER = "1638Vn6KtmK8p5r4oGvAXq9nmZb1emU1DV";
const READER = "bc1qfwytlzyr3ym3enz2eutwtjsf9kkf6uqkjydk3e";
const hash = number => number.toString(16).padStart(64, "0");
const event = (number, fields = {}) => ({ txid: hash(number), eventId: number, protocol: "pwb1",
  kind: "boost-post", authorAddress: AUTHOR, actor: AUTHOR, senderAddress: AUTHOR,
  confirmed: true, valid: true, blockHeight: number + 100, blockIndex: 0, protocolVout: 1, recordOrdinal: 0, ...fields });

test("quote notifications retain the target owner at their canonical position across later transfers", () => {
  const original = event(1), firstQuote = event(2, { authorAddress: READER, quoteTxid: original.txid });
  const transfer = event(3, { kind: "boost-transfer", targetTxid: original.txid, newOwnerAddress: OWNER });
  const secondQuote = event(4, { authorAddress: READER, quoteTxid: original.txid });
  const result = runtime.boostOwnershipState([secondQuote, transfer, original, firstQuote]);
  assert.equal(result.actionOwners.get(String(firstQuote.eventId)), AUTHOR);
  assert.equal(result.actionOwners.get(String(secondQuote.eventId)), OWNER);
  assert.equal(result.states.get(original.txid).ownerAddress, OWNER);
  assert.equal(result.states.get(firstQuote.txid).ownerAddress, READER, "A quote remains its own asset.");
  assert.equal(result.states.get(secondQuote.txid).ownerAddress, READER);
});

test("unauthorized, rejected and pending transfers cannot redirect later confirmed quote notifications", () => {
  const original = event(1), unauthorized = event(2, { kind: "boost-transfer", targetTxid: original.txid,
    senderAddress: READER, newOwnerAddress: OWNER });
  const rejected = event(3, { kind: "boost-transfer", targetTxid: original.txid, newOwnerAddress: OWNER, valid: false });
  const pending = event(4, { kind: "boost-transfer", targetTxid: original.txid, newOwnerAddress: OWNER, confirmed: false });
  const quote = event(5, { authorAddress: READER, quoteTxid: original.txid, currentOwnerAddress: OWNER });
  const result = runtime.boostOwnershipState([quote, pending, rejected, unauthorized, original]);
  assert.equal(result.actionOwners.get(String(quote.eventId)), AUTHOR);
  assert.equal(result.states.get(original.txid).ownerAddress, AUTHOR);
});

test("pending quote notifications use the confirmed target owner without following pending transfers", () => {
  const original = event(1), transfer = event(2, { kind: "boost-transfer", targetTxid: original.txid, newOwnerAddress: OWNER });
  const pendingTransfer = event(3, { kind: "boost-transfer", targetTxid: original.txid, senderAddress: OWNER,
    newOwnerAddress: READER, confirmed: false });
  const quote = event(4, { authorAddress: READER, quoteTxid: original.txid, confirmed: false });
  const result = runtime.boostOwnershipState([quote, pendingTransfer, transfer, original]);
  assert.equal(result.actionOwners.get(String(quote.eventId)), OWNER);
  assert.equal(result.states.get(original.txid).ownerAddress, OWNER);
  assert.equal(result.states.has(quote.txid), false, "A pending quote does not create canonical asset ownership.");
});

test("a fee-rejected transfer cannot redirect later paid actions or quotes", () => {
  const registryAddress = "1BoatSLRHtKNngkdXEeobR76b53LETtpyT";
  const registry = event(0, { protocol: "pwid1", kind: "id-register", id: "boost", receiveAddress: registryAddress });
  const payment = (address, amountSats = "546") => [{ vout: 0, address, amountSats }];
  const original = event(1), rejectedTransfer = event(2, { kind: "boost-transfer", targetTxid: original.txid,
    newOwnerAddress: OWNER, recipients: payment(registryAddress, "545") });
  const like = event(3, { kind: "boost-like", targetTxid: original.txid, authorAddress: READER, recipients: payment(AUTHOR) });
  const quote = event(4, { authorAddress: READER, quoteTxid: original.txid });
  const validTransfer = event(5, { kind: "boost-transfer", targetTxid: original.txid,
    newOwnerAddress: OWNER, recipients: payment(registryAddress) });
  const laterLike = event(6, { kind: "boost-like", targetTxid: original.txid, authorAddress: READER, recipients: payment(OWNER) });
  const laterQuote = event(7, { authorAddress: READER, quoteTxid: original.txid });
  const { ownership, result } = runtime.notificationBoostQualification(
    [laterQuote, rejectedTransfer, quote, laterLike, original, validTransfer, like], [registry], new Set(), "livenet");
  assert.equal(result.rejected.find(item => item.eventId === rejectedTransfer.eventId)?.reason, "boost-registry-payment-missing");
  assert.ok(result.accepted.some(item => item.eventId === like.eventId), "A correctly paid original owner must remain admissible.");
  assert.ok(result.accepted.some(item => item.eventId === laterLike.eventId));
  for (const item of [like, quote]) assert.equal(ownership.actionOwners.get(String(item.eventId)), AUTHOR);
  for (const item of [laterLike, laterQuote]) assert.equal(ownership.actionOwners.get(String(item.eventId)), OWNER);
  assert.equal(ownership.states.get(original.txid).ownerAddress, OWNER);
});

test("unverifiable transfer payment evidence cannot establish ownership for pending notifications", () => {
  const registryAddress = "1BoatSLRHtKNngkdXEeobR76b53LETtpyT";
  const registry = event(0, { protocol: "pwid1", kind: "id-register", id: "boost", receiveAddress: registryAddress });
  const original = event(1), transfer = event(2, { kind: "boost-transfer", targetTxid: original.txid,
    newOwnerAddress: OWNER, recipients: [{ address: registryAddress, amountSats: "546" }] });
  const quote = event(3, { authorAddress: READER, quoteTxid: original.txid, confirmed: false });
  const { ownership, result } = runtime.notificationBoostQualification([quote, transfer, original], [registry], new Set(), "livenet");
  assert.equal(result.rejected.find(item => item.eventId === transfer.eventId)?.reason, "unverifiable-payment-outputs");
  assert.equal(ownership.actionOwners.get(String(quote.eventId)), AUTHOR);
  assert.equal(ownership.states.get(original.txid).ownerAddress, AUTHOR);
});

test("actual ID and DNS public formatters preserve the carrier positions consumed by historical notification relations", () => {
  const formatters = vm.createContext({
    activityStatusTag: confirmed => confirmed ? "Confirmed" : "Pending",
    networkLabel: network => network,
    shortAddress: address => address,
  });
  vm.runInContext(["idActivityItemsFromEvents", "dnsActivityItemsFromEvents"].map(name => functions.get(name)).join("\n"), formatters);
  const registration = { ...event(11), kind: "register", id: "alice", ownerAddress: OWNER, receiveAddress: AUTHOR,
    inputAddresses: [OWNER], amountSats: 1000, protocolVout: 4, recordOrdinal: 0 };
  const update = { ...event(12), kind: "update", id: "alice", ownerAddress: OWNER, receiveAddress: READER,
    currentReceiveAddress: AUTHOR, currentOwnerAddress: OWNER, inputAddresses: [OWNER], amountSats: 546,
    protocolVout: 7, recordOrdinal: 1 };
  for (const [name, relation] of [
    ["idActivityItemsFromEvents", rows => notificationIdHistoryRelations(rows, AUTHOR)],
    ["dnsActivityItemsFromEvents", rows => notificationDnsHistoryRelations({ activity: rows }, AUTHOR)],
  ]) {
    const rows = formatters[name]([update, registration]);
    assert.deepEqual(Array.from(rows, row => [row.txid, row.blockHeight, row.blockIndex, row.protocolVout, row.recordOrdinal]),
      [update, registration].map(row => [row.txid, row.blockHeight, row.blockIndex, row.protocolVout, row.recordOrdinal]));
    const result = relation(rows);
    assert.deepEqual(result.txids, [registration.txid, update.txid]);
    const previous = result.participants.find(person => person.txid === update.txid && person.role === "previous-receiver");
    assert.equal(previous.protocolVout, 7); assert.equal(previous.recordOrdinal, 1);
  }
});

test("paid but unauthorized or unapplied asset mutations remain rejected while pending stays observational", () => {
  const registryAddress = "1BoatSLRHtKNngkdXEeobR76b53LETtpyT";
  const registry = event(0, { protocol: "pwid1", kind: "id-register", id: "boost", receiveAddress: registryAddress });
  const original = event(1);
  const mutation = (id, kind, fields = {}) => event(id, { kind, targetTxid: original.txid,
    recipients: [{ vout: 0, address: registryAddress, amountSats: "546" }], ...fields });
  const unauthorized = mutation(2, "boost-transfer", { senderAddress: READER, newOwnerAddress: OWNER });
  const wrongSeller = mutation(3, "boost-list", { sellerAddress: READER, priceSats: "1000" });
  const listing = mutation(4, "boost-list", { sellerAddress: AUTHOR, priceSats: "1000" });
  const wrongSeal = mutation(5, "boost-seal", { listingId: listing.txid, sellerAddress: AUTHOR, priceSats: "2000" });
  const unverifiedClose = mutation(6, "boost-delist", { listingId: listing.txid });
  const unverifiedBuy = mutation(7, "boost-buy", { listingId: listing.txid, newOwnerAddress: OWNER });
  const verifiedClose = mutation(8, "boost-delist", { listingId: listing.txid });
  const transfer = mutation(9, "boost-transfer", { newOwnerAddress: OWNER });
  const wrongHide = mutation(10, "boost-hide", { senderAddress: READER });
  const hide = mutation(11, "boost-hide");
  const pending = mutation(12, "boost-transfer", { confirmed: false, senderAddress: OWNER, newOwnerAddress: READER });
  const { result, ownership } = runtime.notificationBoostQualification(
    [original, unauthorized, wrongSeller, listing, wrongSeal, unverifiedClose, unverifiedBuy, verifiedClose, transfer, wrongHide, hide, pending],
    [registry], new Set([String(verifiedClose.eventId)]), "livenet");
  for (const item of [unauthorized, wrongSeller, wrongSeal, unverifiedClose, unverifiedBuy, wrongHide]) {
    const rejected = result.rejected.find(entry => entry.eventId === item.eventId);
    assert.equal(rejected?.reason, "boost-asset-mutation-not-applied", item.kind);
    assert.equal(rejected.applied, false);
  }
  for (const item of [listing, verifiedClose, transfer, hide]) {
    assert.ok(result.accepted.some(entry => entry.eventId === item.eventId), item.kind);
    assert.ok(ownership.appliedMutationIds.has(String(item.eventId)), item.kind);
  }
  assert.ok(result.accepted.some(entry => entry.eventId === pending.eventId));
  assert.ok(!ownership.appliedMutationIds.has(String(pending.eventId)));
  assert.equal(ownership.states.get(original.txid).ownerAddress, OWNER);
});
