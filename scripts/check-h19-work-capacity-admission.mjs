#!/usr/bin/env node
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";
import * as bitcoin from "bitcoinjs-lib";
import * as ecc from "@bitcoinerlab/secp256k1";
import { WORK_TOKEN_ID, WORK_SUBATOM_PROJECTION_MODEL } from "../server/work-units.mjs";
bitcoin.initEccLib(ecc);

// Execute the API's actual functions without starting a server or contacting a node.
const source = readFileSync(new URL("../server/proof-api.mjs", import.meta.url), "utf8");
const ast = ts.createSourceFile("proof-api.mjs", source, ts.ScriptTarget.Latest, true);
const names = [
  "canonicalWorkCapacityUnavailable",
  "walletPayloadWithCanonicalWorkCapacities", "assertCanonicalWorkTransferAmounts",
  "assertCanonicalWorkTransferCapacity", "assertWorkMarketplaceBroadcastAllowed",
];
const definitions = names.map((name) => {
  const node = ast.statements.find((item) => ts.isFunctionDeclaration(item) && item.name?.text === name);
  assert.ok(node, `Missing production function ${name}`);
  return node.getText(ast);
}).join("\n");
const sender = "bc1pkevddah5jg3lygrwl2ggzqvn4vh0pxkg8933kth9mamu7cz6efuqnn0r60";
const recipient = "bc1qrecipient";
const hash = "000000000000000000000db7b326be3daf3c65b20eef5e0bc09e8fd63ea907fe";
const checkpoint = { indexedThroughBlock: 967846, indexedThroughBlockHash: hash };
const capacity = {
  ...checkpoint, address: sender, model: "canonical-work-wallet-capacity-v1",
  network: "livenet", tokenId: WORK_TOKEN_ID,
  confirmedBalanceSubatoms: "999980000000000",
  reservedBalanceSubatoms: "89507365978",
  transferableBalanceSubatoms: "999890492634022",
};
let gate = { ready: true, atTip: true, indexedThroughBlock: 967846, canonicalHash: hash };
let tip = { height: 967846, blockHash: hash };
let capacities = [capacity];
const senderScript = Buffer.from(bitcoin.address.toOutputScript(sender, bitcoin.networks.bitcoin)).toString("hex");
let parent = { vout: [{ scriptpubkey: senderScript }] };
let inputs = [{ txid: "a".repeat(64), vout: 0 }];
let actions = [];
let reads = 0;
const transfer = (amount = capacity.transferableBalanceSubatoms, to = recipient, vout = 1) => ({
  amountSubatoms: amount, amountVersion: "send3", canonicalParsed: true,
  protocolVout: vout, recipientAddress: to,
});
let transfers = [transfer()];
const context = vm.createContext({
  console, Buffer, bitcoin, WORK_TOKEN_ID,
  TOKEN_SEND_SUBATOMS_ACTION: "send3", TOKEN_DELIST_ACTION: "delist5", TOKEN_LIST_ACTION: "list5",
  TOKEN_SALE_AUTH_WORK_AMO_V8_VERSION: "v8", WORK_AMO_V8_DECLARATION_PINS_CONFIGURED: true,
  WORK_AMO_V8_DECLARATION_PINS_REQUESTED: true, WORK_TOKEN_MINT_AMOUNT: "1000",
  workAmoV8SignedMutationShape: () => ({ workMintActions: [], workTransferActions: transfers }),
  signedWorkMarketplaceWriteActions: async () => actions,
  workAmoV8Metadata: async () => ({ activation: { reached: true }, writeAdmission: true,
    protocolReady: true, evidenceComplete: true, protocolWritesEnabled: true, listingWritesEnabled: true }),
  workAmoV8ActiveMutationDecision: () => ({ allowed: true }),
  canonicalPublicReadGate: async (_network, options) => {
    assert.equal(options.force, true);
    return gate;
  },
  signedTransactionInputOutpoints: () => inputs,
  fetchTransactionFromBitcoinRpc: async (_txid, _network, options) => {
    assert.equal(options.bypassCache, true);
    assert.equal(options.includeRawHex, true);
    assert.equal(options.requireCanonicalPrevouts, true);
    return parent;
  },
  addressFromVout: (output) => output?.scriptPubKey?.address ?? "",
  isValidBitcoinAddress: (address) => address === sender,
  proofIndexWorkWalletCapacities: async (network, options) => {
    reads += 1;
    assert.equal(network, "livenet");
    assert.equal(options.blockHeight, 967846);
    assert.equal(options.blockHash, hash);
    assert.equal(options.addresses[0], sender);
    return capacities;
  },
  bitcoinRpc: async (method) => { assert.equal(method, "getblockchaininfo"); return tip; },
  exactCoreTipFromBlockchainInfo: (value) => value,
  isWorkTokenId: (value) => value === WORK_TOKEN_ID,
  workRecordUsesSubatoms: (value) => value.amountStorageModel === WORK_SUBATOM_PROJECTION_MODEL,
});
vm.runInContext(`${definitions}\nthis.fns = { ${names.join(",")} };`, context);
const fns = context.fns;
const exceeded = (error) => error.statusCode === 400 && error.details.code === "CANONICAL_WORK_CAPACITY_EXCEEDED";
const unavailable = (error) => error.statusCode === 503 && error.details.code === "CANONICAL_WORK_CAPACITY_UNAVAILABLE";

fns.assertCanonicalWorkTransferAmounts(capacity, [transfer()], sender);
for (const amount of ["999890492634023", "999914277812750"]) {
  assert.throws(() => fns.assertCanonicalWorkTransferAmounts(capacity, [transfer(amount)], sender), exceeded);
}
assert.throws(() => fns.assertCanonicalWorkTransferAmounts(capacity,
  [transfer("999890492634022", recipient, 1), transfer("1", recipient, 2)], sender), exceeded);
fns.assertCanonicalWorkTransferAmounts(capacity,
  [transfer(undefined, sender, 1), transfer(undefined, recipient, 2)], sender);
assert.throws(() => fns.assertCanonicalWorkTransferAmounts(capacity,
  [transfer("999890492634023", sender)], sender), exceeded);
assert.throws(() => fns.assertCanonicalWorkTransferAmounts(capacity,
  [transfer(undefined, sender.toUpperCase(), 1), transfer("1", recipient, 2)], sender), exceeded);
for (const malformed of ["0", "-1", "01", "1e5", "0.1", 1, undefined]) {
  assert.throws(() => fns.assertCanonicalWorkTransferAmounts(capacity,
    [{ ...transfer(), amountSubatoms: malformed }], sender), unavailable);
}
const huge = { ...capacity, transferableBalanceSubatoms: "999999999999999999999999999999" };
fns.assertCanonicalWorkTransferAmounts(huge, [transfer(huge.transferableBalanceSubatoms)], sender);
assert.throws(() => fns.assertCanonicalWorkTransferAmounts(huge,
  [transfer((BigInt(huge.transferableBalanceSubatoms) + 1n).toString())], sender), exceeded);

await fns.assertWorkMarketplaceBroadcastAllowed("fixture", "livenet");
assert.equal(reads, 1, "Active broadcast must invoke capacity admission");
transfers = [transfer("999914277812750")];
await assert.rejects(fns.assertWorkMarketplaceBroadcastAllowed("fixture", "livenet"), exceeded);
transfers = [transfer()];
gate = { ...gate, ready: false };
await assert.rejects(fns.assertCanonicalWorkTransferCapacity("fixture", "livenet", transfers), unavailable);
gate = { ...gate, ready: true };
parent = null;
await assert.rejects(fns.assertCanonicalWorkTransferCapacity("fixture", "livenet", transfers), unavailable);
parent = { vout: [{ scriptpubkey: senderScript }] };
inputs = [{ txid: "a".repeat(64), vout: 1 }, { txid: "a".repeat(64), vout: 0 }];
parent.vout.push({ scriptpubkey: "51", scriptpubkey_address: sender });
await fns.assertCanonicalWorkTransferCapacity("fixture", "livenet", transfers);
inputs = [{ txid: "a".repeat(64), vout: 0 }];
capacities = null;
await assert.rejects(fns.assertCanonicalWorkTransferCapacity("fixture", "livenet", transfers), unavailable);
capacities = [capacity];
tip = { height: 967846, blockHash: "f".repeat(64) };
await assert.rejects(fns.assertCanonicalWorkTransferCapacity("fixture", "livenet", transfers), unavailable);
tip = { height: 967847, blockHash: hash };
await assert.rejects(fns.assertCanonicalWorkTransferCapacity("fixture", "livenet", transfers), unavailable);
tip = { height: 967846, blockHash: hash };

const payload = { ...checkpoint,
  tokens: [{ tokenId: WORK_TOKEN_ID, amountStorageModel: WORK_SUBATOM_PROJECTION_MODEL }],
  holders: [{ tokenId: WORK_TOKEN_ID, address: sender, balanceSubatoms: capacity.confirmedBalanceSubatoms }],
};
const enriched = await fns.walletPayloadWithCanonicalWorkCapacities(payload, "livenet", [sender]);
assert.equal(enriched.canonicalWorkCapacities[0], capacity);
assert.equal(payload.canonicalWorkCapacities, undefined, "Do not mutate the source projection");
const distinctKeys = { ...payload, holders: [
  { ...payload.holders[0], address: sender.toUpperCase(), balanceSubatoms: "123" },
  ...payload.holders,
] };
assert.equal((await fns.walletPayloadWithCanonicalWorkCapacities(distinctKeys, "livenet", [sender]))
  .canonicalWorkCapacities[0], capacity, "Canonical holder keys must not be case-folded together");
for (const holders of [[], [...payload.holders, ...payload.holders],
  [{ ...payload.holders[0], balanceSubatoms: "999980000000001" }]]) {
  await assert.rejects(fns.walletPayloadWithCanonicalWorkCapacities(
    { ...payload, holders }, "livenet", [sender]), unavailable);
}
const nonWork = { tokens: [{ tokenId: "other" }] };
assert.equal(await fns.walletPayloadWithCanonicalWorkCapacities(nonWork, "livenet", [sender]), nonWork);
const beforeNonWork = reads;
transfers = [];
await fns.assertWorkMarketplaceBroadcastAllowed("fixture", "livenet");
await fns.assertWorkMarketplaceBroadcastAllowed("fixture", "testnet");
assert.equal(reads, beforeNonWork);
const shapeFunction = ast.statements.find((item) => ts.isFunctionDeclaration(item) &&
  item.name?.text === "workAmoV8SignedMutationShape");
const shapeContext = vm.createContext({
  WORK_TOKEN_ID, TOKEN_PROTOCOL_PREFIX: "pwt1:", PROTOCOL_PREFIX: "pwm1:",
  TOKEN_MIN_MUTATION_PRICE_SATS: 546, WORK_AMO_V5_DECLARATION_REGISTRY_ADDRESS: "registry",
  signedTransactionOutputs: (outputs) => outputs,
  signedWorkAmoEconomicOutputs: (outputs) => outputs,
  decodedOpReturnMessages: ([output]) => output.message ? [output.message] : [],
  decodedProtocolMessages: ([output]) => output.message ? [output.message] : [],
  parseTokenPayload: () => ({ kind: "send", tokenId: WORK_TOKEN_ID,
    amountSubatoms: "999890492634023", amountVersion: "send3", recipientAddress: recipient }),
  selectWorkAmoV5DistinctRegistryPayment: () => ({ registryPaymentVout: 0, registryPaymentSats: 546 }),
});
vm.runInContext(shapeFunction.getText(ast), shapeContext);
const shape = shapeContext.workAmoV8SignedMutationShape([{}, { message: "pwt1:send3:fixture" }], "livenet");
assert.equal(shape.workTransferActions[0].amountSubatoms, "999890492634023");
assert.equal(shape.workTransferActions[0].recipientAddress, recipient);
assert.equal(shape.workTransferActions[0].protocolVout, 1);
assert.match(source, /broadcastNodePayload[\s\S]*assertWorkMarketplaceBroadcastAllowed/u);
assert.match(source, /broadcastSlipstreamPayload[\s\S]*assertWorkMarketplaceBroadcastAllowed/u);
console.log("H19-04 API capacity regression checks passed: exact boundaries, batches, self sends, Core/checkpoint failure, holder parity, broadcast wiring.");
