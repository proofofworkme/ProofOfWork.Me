import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";
import * as bitcoin from "bitcoinjs-lib";
import * as ecc from "@bitcoinerlab/secp256k1";
import { validateBoostAuthority, boostAuthorityWitness } from "../server/boost-authority.mjs";
import { tokenEventIsPending } from "../server/token-event-lifecycle.mjs";
import { proofIndexEventParticipantsForItem, proofIndexEventRefsForItem } from "../server/proof-index-event-relations.mjs";
import { WORK_AMO_V5_DECLARATION_REGISTRY_ADDRESS } from "../server/work-amo-v5.mjs";
import { WORK_TOKEN_ID, WORK_SUBATOM_PROJECTION_MODEL } from "../server/work-units.mjs";

const id = (n) => n.toString(16).padStart(64, "0");
const hash = "a".repeat(64);
const secret = Buffer.from(id(1), "hex");
const pubkey = Buffer.from(ecc.pointFromScalar(secret, true));
const seller = bitcoin.payments.p2wpkh({ pubkey }).address;
const buyer = bitcoin.payments.p2wpkh({ pubkey: Buffer.from(ecc.pointFromScalar(Buffer.from(id(2), "hex"), true)) }).address;
const target = bitcoin.payments.p2wpkh({ pubkey: Buffer.from(ecc.pointFromScalar(Buffer.from(id(3), "hex"), true)) }).address;
const sellerScript = Buffer.from(bitcoin.address.toOutputScript(seller)).toString("hex");
const parsedSources = new Map();
function definition(source, name) {
  if (!parsedSources.has(source)) parsedSources.set(source, ts.createSourceFile("fixture.mjs", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS));
  const ast = parsedSources.get(source);
  const node = ast.statements.find((node) => ts.isFunctionDeclaration(node) && node.name?.text === name);
  assert.ok(node, `actual function ${name}`);
  return node.getText(ast).replace(/^export\s+/u, "");
}

function fixture() {
  const witnesses = new Map(); const items = [];
  const registryActivity = [{ id: "boost", kind: "id-register", confirmed: true, valid: true, blockHeight: 964000, blockIndex: 1, protocolVout: 1, recordOrdinal: 0, receiveAddress: "registry" }];
  function add(n, kind, fields = {}, options = {}) {
    const item = { txid: id(n), eventId: n, kind: `boost-${kind}`, protocol: "pwb1", confirmed: true, valid: true, status: "confirmed", network: "livenet", blockHash: hash, blockHeight: 965000, blockIndex: n, protocolVout: 2, recordOrdinal: 0, senderAddress: seller, authorAddress: seller, payload: `pwb1:fixture:${n}`, createdAt: "2026-09-08T00:00:00Z", ...fields };
    const outputs = options.outputs ?? (kind === "post" ? [{ vout: 0, address: seller, valueSats: "546" }] : [{ vout: 0, address: "registry", valueSats: "546" }]);
    const witness = { actor: item.senderAddress, blockHeight: item.blockHeight, blockIndex: item.blockIndex, blockHash: item.blockHash, carriers: new Map([[item.protocolVout, item.payload]]), outputs, inputs: options.inputs ?? [], workTransfers: options.workTransfers ?? [] };
    witnesses.set(item.txid, witness); items.push(item); return item;
  }
  function listing(n, asset, extra = {}) {
    const terms = { version: "pwb-sale-v1", boostTxid: asset.txid, sellerAddress: seller, sellerPublicKey: pubkey.toString("hex"), priceSats: 1000, nonce: "nonce", anchorType: "sale-ticket-v1", anchorSigHashType: 0x83, anchorVout: 3, saleTicketVout: 3, anchorValueSats: 546, saleTicketValueSats: 546, anchorScriptPubKey: sellerScript, ...extra };
    return add(n, "list", { boostTxid: asset.txid, saleAuthorization: terms, priceSats: 1000 }, { outputs: [{ vout: 0, address: "registry", valueSats: "546" }, { vout: 1, address: "", valueSats: "0" }, { vout: 2, address: "", valueSats: "0" }, { vout: 3, address: seller, valueSats: "546", script: sellerScript }] });
  }
  function seal(n, listing) {
    const terms = listing.saleAuthorization;
    const tx = new bitcoin.Transaction(); tx.version = 2;
    tx.addInput(Buffer.from(listing.txid, "hex").reverse(), terms.anchorVout, 0xffffffff);
    tx.addOutput(Buffer.from(sellerScript, "hex"), 1546n);
    const script = bitcoin.payments.p2pkh({ pubkey }).output;
    const signature = bitcoin.script.signature.encode(ecc.sign(tx.hashForWitnessV0(0, script, 546n, 0x83), secret), 0x83);
    return add(n, "seal", { listingId: listing.txid, saleAuthorization: { ...terms, anchorTxid: listing.txid, anchorSignature: Buffer.from(signature).toString("hex") }, priceSats: 1000 });
  }
  return { add, listing, seal, items, witnesses, registryActivity, run: (extra = {}) => validateBoostAuthority(items, { witnesses, registryActivity, ...extra }) };
}

test("terminal token attempts never increment pending counters", () => {
  const records = [{ confirmed: true }, { confirmed: false, status: "pending" }, { confirmed: false }, ...["dropped", "orphaned", "invalid", "rejected", "confirmed", "conflicted"].map((status) => ({ confirmed: false, status })), { confirmed: false, dropped: true }, { confirmed: false, orphaned: true }, { confirmed: false, status: "pending", valid: false }, {}];
  assert.equal(records.filter(tokenEventIsPending).length, 2);
  assert.equal(tokenEventIsPending({ confirmed: false, valid: true, status: "dropped", dropped: true }), false);
});

test("terminal WORK mint history neither consumes pending cap nor adds pending supply", () => {
  const source = readFileSync(new URL("../server/proof-api.mjs", import.meta.url), "utf8");
  const context = vm.createContext({ tokenEventIsPending, WORK_TOKEN_MAX_SUPPLY: 21_000_000, compareCanonicalUtf8: (a, b) => a.localeCompare(b) });
  vm.runInContext(["sortWorkMintsForPendingCap", "workMintRowsWithinPendingCap", "workMintSupplyTotals"].map((name) => definition(source, name)).join("\n") + ";this.cap=workMintRowsWithinPendingCap;this.totals=workMintSupplyTotals;", context);
  const rows = [{ txid: id(5), confirmed: true, amount: 20_999_000 }, { txid: id(1), confirmed: false, status: "dropped", amount: 1000 }, { txid: id(2), confirmed: false, status: "pending", amount: 1000 }, { txid: id(3), confirmed: false, status: "orphaned", amount: 1000 }];
  assert.equal(context.cap(rows).length, 4, "terminal attempts remain inspectable history");
  assert.equal(context.totals(rows).confirmedSupply, 20_999_000);
  assert.equal(context.totals(rows).pendingSupply, 1000);
  assert.equal(context.totals(rows).pendingMints, 1);
});

test("token definitions, mints, transfers and bond pending supply share the lifecycle boundary", () => {
  const reader = readFileSync(new URL("../server/db/proof-index-reader.mjs", import.meta.url), "utf8");
  const api = readFileSync(new URL("../server/proof-api.mjs", import.meta.url), "utf8");
  const context = vm.createContext({ tokenEventIsPending, isBondTokenId: (id) => id === "POWB", tokenLedgerAmountFromRecord: (_id, row) => BigInt(row.amount), numericValue: (v) => Number(v) || 0 });
  vm.runInContext(definition(reader, "tokenStateStats") + definition(api, "tokenStateWithPendingStats") + ";this.stats=tokenStateStats;this.pending=tokenStateWithPendingStats;", context);
  const events = [{ confirmed: true, tokenId: "POWB", amount: "7", priceSats: 5 }, { confirmed: false, tokenId: "POWB", amount: "2", priceSats: 11 }, { confirmed: false, tokenId: "POWB", status: "dropped", amount: "9007199254740993", priceSats: 13 }, { confirmed: false, tokenId: "POWB", status: "pending", valid: false, amount: "3", priceSats: 17 }];
  const stats = context.stats({}, events, events, events, []);
  assert.equal(stats.pendingTokens, 1); assert.equal(stats.pendingMints, 1); assert.equal(stats.pendingTransfers, 1);
  const result = context.pending({ tokens: [events[0]], mints: events, transfers: events, sales: events });
  assert.equal(result.pendingSupply, "2"); assert.equal(result.stats.pendingMints, 1); assert.equal(result.stats.pendingSales, 1); assert.equal(result.stats.pendingTransfers, 1);
  assert.equal(result.mints.length, 4);
});

test("raw Log Boost validity is explicitly shape-only and does not claim a rejection", () => {
  const reader = readFileSync(new URL("../server/db/proof-index-reader.mjs", import.meta.url), "utf8");
  const context = vm.createContext({ normalizedLowerText: (value) => String(value ?? "").toLowerCase(), bondTagForEventPayload: () => null });
  vm.runInContext(definition(reader, "normalizeEventPayload") + ";this.normalize=normalizeEventPayload;", context);
  const raw = context.normalize({ valid: true, protocol: "pwb1", kind: "boost-transfer", txid: id(1) });
  assert.equal(raw.valid, true); assert.equal(raw.validationScope, "wire-shape-only"); assert.equal(raw.stateTransitionVerified, false); assert.equal(raw.authorityEndpoint, "/api/v1/boost");
});

test("unfollow targets remain discoverable without a target payment", () => {
  const item = { protocol: "pwb1", kind: "boost-unfollow", senderAddress: "follower", authorAddress: "follower", followerAddress: "follower", targetAddress: "target", targetId: "friend", recipients: [{ address: "registry", amountSats: "546" }] };
  const participants = proofIndexEventParticipantsForItem(item);
  assert.ok(participants.some((row) => row.address === "target" && row.role === "target" && row.powid === "friend"));
  assert.ok(participants.some((row) => row.address === "follower" && row.role === "follower"));
  const refs = proofIndexEventRefsForItem(item);
  assert.ok(refs.some((row) => row.refType === "target-address" && row.refValue === "target"));
  assert.ok(refs.some((row) => row.refType === "powid" && row.refValue === "friend"));
  assert.deepEqual(proofIndexEventParticipantsForItem({ ...item, protocol: "other", kind: "other" }).filter((row) => row.role === "target"), []);
});

test("Boost ownership rejects a funded attacker and accepts only the current author", () => {
  const f = fixture(); const post = f.add(1, "post");
  f.add(2, "transfer", { targetTxid: post.txid, senderAddress: "attacker", authorAddress: "attacker", newOwnerAddress: "attacker" });
  f.add(3, "transfer", { targetTxid: post.txid, newOwnerAddress: buyer });
  f.add(4, "transfer", { targetTxid: post.txid, newOwnerAddress: "stale-owner" });
  const result = f.run();
  assert.deepEqual(result.outcomes.map((row) => row.accepted), [true, false, true, false]);
  assert.equal(result.outcomes[1].reason, "current-owner-required");
  assert.equal(result.outcomes[3].reason, "current-owner-required");
});

test("Boost payments use the receiver before the event's physical chain position", () => {
  const f = fixture(); const post = f.add(1, "post");
  f.registryActivity.push({ id: "boost", kind: "id-update", confirmed: true, blockHeight: 965000, blockIndex: 3, protocolVout: 1, recordOrdinal: 0, receiveAddress: "new-registry" });
  f.add(2, "like", { targetTxid: post.txid });
  f.add(3, "like", { targetTxid: post.txid });
  f.add(4, "like", { targetTxid: post.txid }, { outputs: [{ vout: 0, address: "new-registry", valueSats: "546" }] });
  const result = f.run();
  assert.deepEqual(result.outcomes.map((row) => row.accepted), [true, true, false, true]);
  assert.equal(result.outcomes[2].reason, "boost-registry-fee-missing");
  assert.equal(f.items[2].valid, true, "raw history is not rewritten");
});

test("Boost extra signal cannot go to a stale owner; unfollow has no target-payment requirement", () => {
  const f = fixture(); const post = f.add(1, "post");
  f.add(2, "transfer", { targetTxid: post.txid, newOwnerAddress: buyer });
  f.add(3, "like", { targetTxid: post.txid }, { outputs: [{ vout: 0, address: "registry", valueSats: "546" }, { vout: 1, address: seller, valueSats: "546" }] });
  f.add(4, "like", { targetTxid: post.txid }, { outputs: [{ vout: 0, address: "registry", valueSats: "546" }, { vout: 1, address: buyer, valueSats: "546" }] });
  f.add(5, "follow", { targetAddress: target });
  f.add(6, "unfollow", { targetAddress: target });
  assert.deepEqual(f.run().outcomes.map((row) => row.accepted), [true, true, false, true, false, true]);
});

test("Boost hide remains author-owned after transfer and pending actions cannot mutate it", () => {
  const f = fixture(); const post = f.add(1, "post");
  f.add(2, "transfer", { targetTxid: post.txid, newOwnerAddress: buyer });
  f.add(3, "hide", { targetTxid: post.txid, senderAddress: buyer, authorAddress: buyer });
  f.add(4, "hide", { targetTxid: post.txid });
  f.add(5, "hide", { targetTxid: post.txid, confirmed: false, status: "pending" });
  const result = f.run();
  assert.deepEqual(result.outcomes.map((row) => row.accepted), [true, true, false, true]);
  assert.equal(result.items.at(-1).boostAuthority.pending, true);
});

test("Boost WORK signals require exact accepted self-send/owner-send credit evidence", () => {
  const f = fixture();
  const amount = "9007199254740993";
  f.add(1, "post", { workSignalSubatoms: amount });
  f.add(2, "post", { workSignalSubatoms: amount }, { workTransfers: [{ tokenId: WORK_TOKEN_ID, fromAddress: seller, recipientAddress: seller, amountSubatoms: amount, amountStorageModel: WORK_SUBATOM_PROJECTION_MODEL }] });
  const result = f.run();
  assert.deepEqual(result.outcomes.map((row) => row.accepted), [false, true]);
  assert.equal(result.items[0].workSignalSubatoms, amount);
});

test("Boost purchase needs a verified seal, exact ticket spend and one full seller settlement", () => {
  const f = fixture(); const post = f.add(1, "post"); const listing = f.listing(2, post);
  const buy = (n, amount, inputs = [{ txid: listing.txid, vout: 3 }]) => f.add(n, "buy", { listingId: listing.txid, buyerAddress: buyer }, { inputs, outputs: [{ vout: 0, address: "registry", valueSats: "546" }, { vout: 1, address: seller, valueSats: amount }] });
  buy(3, "1546"); f.seal(4, listing); buy(5, "1000"); buy(6, "1546", []); buy(7, "1546"); buy(8, "1546");
  const result = f.run();
  assert.deepEqual(result.outcomes.map((row) => row.accepted), [true, true, false, true, false, false, true, false]);
  assert.equal(result.items.find((item) => item.txid === id(7)).newOwnerAddress, buyer);
  assert.equal(result.items.find((item) => item.kind === "boost-list").listingActive, false);
});

test("unrelated canonical spends and expiry retire tickets; split seller payments do not settle", () => {
  const f = fixture(); const post = f.add(1, "post"); const listing = f.listing(2, post, { expiresAt: "2026-09-09T00:00:00Z" }); f.seal(3, listing);
  f.add(4, "buy", { listingId: listing.txid, buyerAddress: buyer, protocolVout: 3 }, { inputs: [{ txid: listing.txid, vout: 3 }], outputs: [{ vout: 0, address: "registry", valueSats: "546" }, { vout: 1, address: seller, valueSats: "1000" }, { vout: 2, address: seller, valueSats: "546" }] });
  f.add(5, "buy", { listingId: listing.txid, buyerAddress: buyer, createdAt: "2026-09-10T00:00:00Z" }, { inputs: [{ txid: listing.txid, vout: 3 }], outputs: [{ vout: 0, address: "registry", valueSats: "546" }, { vout: 1, address: seller, valueSats: "1546" }] });
  assert.deepEqual(f.run().outcomes.map((row) => row.accepted), [true, true, true, false, false]);
  const retired = f.run({ ticketSpends: [{ prevTxid: listing.txid, prevVout: 3, txid: id(99), blockHeight: 965000, blockIndex: 6, protocolVout: 0, recordOrdinal: 0 }] });
  assert.equal(retired.items.find((item) => item.kind === "boost-list").listingActive, false);
});

test("missing/mismatched canonical Boost witnesses fail closed", () => {
  const f = fixture(); f.add(1, "post");
  f.witnesses.get(id(1)).blockHash = id(2);
  assert.throws(() => f.run(), /canonical transaction/u);
  assert.throws(() => boostAuthorityWitness({ txid: id(1), status: "confirmed", raw_tx: {} }, { indexedThroughBlock: 965000 }), /wire evidence/u);
});

test("two Boost carriers cannot reuse the same proof signal", () => {
  const f = fixture(); const first = f.add(1, "post");
  const second = f.add(2, "post", { txid: first.txid, blockIndex: first.blockIndex, protocolVout: 3 });
  const witness = f.witnesses.get(first.txid);
  witness.carriers.set(first.protocolVout, first.payload);
  const result = f.run();
  assert.deepEqual(result.outcomes.map((item) => item.accepted), [true, false]);
  assert.equal(result.outcomes[1].reason, "post-self-send-missing");
  assert.equal(result.items[0].proofSignalSats, 546);
});

test("a separately accepted WORK fee before both carriers is not misattributed as Boost signal", () => {
  const amount = "1000000000";
  const boostPayload = `pwb1:post:${Buffer.from(JSON.stringify({ text: "composite", workSignalSubatoms: amount })).toString("base64url")}`;
  const workPayload = `pwt1:send3:${WORK_TOKEN_ID}:${amount}:${seller}`;
  // Use the protocol's configured receiver rather than a fabricated address.
  const tx = new bitcoin.Transaction(); tx.version = 2;
  tx.addInput(Buffer.from(id(90), "hex").reverse(), 0);
  tx.addOutput(bitcoin.address.toOutputScript(WORK_AMO_V5_DECLARATION_REGISTRY_ADDRESS), 546n);
  tx.addOutput(Buffer.from(sellerScript, "hex"), 546n);
  tx.addOutput(bitcoin.script.compile([bitcoin.opcodes.OP_RETURN, Buffer.from(boostPayload)]), 0n);
  tx.addOutput(bitcoin.script.compile([bitcoin.opcodes.OP_RETURN, Buffer.from(workPayload)]), 0n);
  const txid = tx.getId();
  const transfer = { tokenId: WORK_TOKEN_ID, fromAddress: seller, recipientAddress: seller, amountSubatoms: amount, amountStorageModel: WORK_SUBATOM_PROJECTION_MODEL, protocolVout: 3, recordOrdinal: 0, payload: workPayload, paidSats: 546 };
  const row = { txid, status: "confirmed", block_height: 965000, block_index: 1, block_hash: hash, raw_tx: { txid, hex: tx.toHex(), canonicalBlockScan: { network: "livenet", height: 965000, blockHash: hash }, _powBlockIndex: 1, vin: [{ txid: id(90), vout: 0, prevout: { scriptpubkey: sellerScript } }], vout: tx.outs.map((output) => ({ scriptpubkey: Buffer.from(output.script).toString("hex"), value: output.value.toString() })) }, events: [{ protocol: "pwt1", kind: "token-transfer", status: "confirmed", valid: true, op_return_vout: 3, record_ordinal: 0, raw_payload: workPayload, payload: transfer }] };
  transfer._workAmoV5ReplayBound = true; transfer.workAmoV5RawCandidate = true;
  transfer.workAmoV5ReplayOutcome = { valid: true, kind: "pwt1-valid", reasonCode: "" };
  transfer.workAmoV5ReplayOutput = { projection: { txid, kind: "token-transfer", tokenId: WORK_TOKEN_ID, valid: true, amountSubatoms: amount, senderAddress: seller, recipientAddress: seller, parsed: { payload: workPayload }, position: { blockHeight: 965000, blockHash: hash, blockTransactionIndex: 1, protocolVout: 3, recordOrdinal: 0 } } };
  const checkpoint = { network: "livenet", indexedThroughBlock: 965000 };
  const witness = boostAuthorityWitness(row, checkpoint);
  assert.equal(witness.workFeeOutputs.get(0), 546n);
  const item = { txid, kind: "boost-post", protocol: "pwb1", confirmed: true, status: "confirmed", valid: true, blockHeight: 965000, blockIndex: 1, blockHash: hash, protocolVout: 2, recordOrdinal: 0, payload: boostPayload, authorAddress: seller, workSignalSubatoms: amount };
  const result = validateBoostAuthority([item], { witnesses: new Map([[txid, witness]]) });
  assert.equal(result.outcomes[0].accepted, true); assert.equal(result.items[0].proofSignalSats, 546); assert.equal(result.items[0].workSignalSubatoms, amount);
  assert.throws(() => boostAuthorityWitness({ ...row, events: [{ ...row.events[0], raw_payload: "pwt1:changed" }] }, checkpoint), /raw carrier/u);
  assert.throws(() => boostAuthorityWitness({ ...row, events: [{ ...row.events[0], payload: { ...transfer, workAmoV5ReplayOutcome: { valid: false } } }] }, checkpoint), /accepted canonical replay/u);
  assert.throws(() => boostAuthorityWitness({ ...row, events: [{ ...row.events[0], payload: { ...transfer, amountSubatoms: "1000000001" } }] }, checkpoint), /conflicts with its accepted replay/u);

  assert.throws(() => boostAuthorityWitness({ ...row, raw_tx: { ...row.raw_tx, vin: [{ ...row.raw_tx.vin[0], txid: id(91) }] } }, checkpoint), /outpoint/u);
});

test("ambiguous original asset identities fail closed without replacing an earlier post", () => {
  const f = fixture(); const first = f.add(1, "post", { protocolVout: 1 });
  const second = f.add(2, "post", { txid: first.txid, blockIndex: first.blockIndex, protocolVout: 3 }, { outputs: [{ vout: 0, address: seller, valueSats: "546" }, { vout: 1, address: "", valueSats: "0" }, { vout: 2, address: seller, valueSats: "546" }] });
  f.witnesses.get(first.txid).carriers.set(1, first.payload);
  assert.throws(() => f.run(), /ambiguous original asset/u);
  assert.equal(first.valid, true); assert.equal(second.valid, true);
});

test("malformed owner/target and conflicting ticket aliases cannot change authority", () => {
  const f = fixture(); const post = f.add(1, "post");
  f.add(2, "transfer", { targetTxid: post.txid, newOwnerAddress: "malformed" });
  f.add(3, "unfollow", { targetAddress: "malformed" });
  f.listing(4, post, { anchorVout: 4 });
  const result = f.run();
  assert.deepEqual(result.outcomes.map((row) => row.accepted), [true, false, false, false]);
  assert.deepEqual(result.outcomes.slice(1).map((row) => row.reason), ["new-owner-address-invalid", "follow-target-invalid", "sale-ticket-terms-invalid"]);
});

test("ticket expiry is evaluated at the canonical checkpoint; Bech32 targets normalize without changing Base58", () => {
  const f = fixture(); const post = f.add(1, "post"); const listing = f.listing(2, post, { expiresAt: "2026-09-09T00:00:00Z" }); f.seal(3, listing);
  assert.equal(f.run({ checkpointTime: "2026-09-08T00:00:00Z" }).items.find((item) => item.kind === "boost-list").listingActive, true);
  assert.equal(f.run({ checkpointTime: "2026-09-09T00:00:00Z" }).items.find((item) => item.kind === "boost-list").listingActive, false);
  f.add(4, "follow", { targetAddress: buyer.toUpperCase() }, { outputs: [{ vout: 0, address: "registry", valueSats: "546" }, { vout: 1, address: buyer, valueSats: "546" }] });
  assert.equal(f.run().outcomes.at(-1).accepted, true);
});

test("WORK delta and recovery exact supply folds exclude retained terminal mints", () => {
  const source = readFileSync(new URL("../server/proof-api.mjs", import.meta.url), "utf8");
  const rows = [{ confirmed: true, amount: "7" }, { confirmed: false, amount: "2" }, { confirmed: false, status: "dropped", amount: "9007199254740993" }];
  for (const name of ["workTokenStateWithDeltaTransactions", "liveWorkTokenState"]) {
    const ast = ts.createSourceFile("function.mjs", definition(source, name), ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
    let arrow;
    function visit(node) { if (ts.isVariableDeclaration(node) && node.name.getText(ast) === "exactMintSupply") arrow = node.initializer; else ts.forEachChild(node, visit); }
    visit(ast); assert.ok(arrow, name);
    const context = vm.createContext({ tokenEventIsPending, sortedMints: rows, mergedMints: rows, ledgerAmountFromRecord: (row) => BigInt(row.amount), tokenLedgerAmountFromRecord: (_id, row) => BigInt(row.amount), WORK_TOKEN_ID, workAmountStorageModel: WORK_SUBATOM_PROJECTION_MODEL });
    vm.runInContext(`this.fold = ${arrow.getText(ast)};`, context);
    assert.equal(context.fold(true), 7n, name); assert.equal(context.fold(false), 2n, name);
  }
});
