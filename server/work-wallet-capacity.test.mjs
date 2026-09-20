import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { test } from "node:test";
import * as bitcoin from "bitcoinjs-lib";
import {
  canonicalWorkWalletCapacitiesFromTransition,
  createCanonicalWorkWalletCapacityReader,
} from "./work-wallet-capacity.mjs";
import {
  WORK_AMO_V5_BASE_STATE_FIELDS,
  WORK_AMO_V5_DECLARATION_REGISTRY_ADDRESS,
  WORK_AMO_V5_NETWORK_ACCUMULATOR_MODEL,
  WORK_AMO_V5_PAYLOAD_COMMITMENT_MODEL,
  WORK_AMO_V5_STATE_COMMITMENT_MODEL,
  workAmoV5CanonicalStateCommitment,
} from "./work-amo-v5.mjs";
import {
  WORK_AMO_V8_AUTH_VERSION,
  WORK_AMO_V8_BLOCK_SEQUENCER_MODEL,
  WORK_AMO_V8_MODELS,
  WORK_AMO_V8_TOKEN_STATE_PREIMAGE_MODEL,
  deriveWorkAmoV8FrozenTerms,
  workAmoV8CanonicalTokenStateCommitment,
} from "./work-amo-v8.mjs";
import { WORK_SUBATOM_PROJECTION_MODEL, WORK_TOKEN_ID } from "./work-units.mjs";
import {
  normalizeWorkAmoV5RawGenericState,
  normalizeWorkAmoV5RawIdState,
  normalizeWorkAmoV5RawWorkState,
  replayWorkAmoV5RawBlock,
  workAmoV5RawGenericStateCommitment,
  workAmoV5RawIdStateCommitment,
} from "./work-amo-v5-raw.mjs";

const seller = "bc1p0uxp0axptr8rg9dndgtlwxn00j4hq8m88kg80tqd0t6045putwhq5ca7ed";
const base58 = "18xvbj6mpPpYYjWibcqsXdV7SCwBQNrqMW";
const absent = "1H1arP2xpam6MZmHt6k1tB83stqVdH6ANK";
const scope = { network: "livenet", blockHeight: 1200001, blockHash: "44".repeat(32), addresses: [seller] };

function fixture() {
  const authorization = {
    ...WORK_AMO_V8_MODELS,
    anchorScriptPubKey: `5120${"ab".repeat(32)}`,
    anchorSigHashType: 0x83, anchorType: "sale-ticket-v1", anchorValueSats: 546,
    anchorVout: 2, buyerAddress: "", expiresAt: "", network: "livenet",
    nonce: "wallet-capacity-fixture", registryAddress: WORK_AMO_V5_DECLARATION_REGISTRY_ADDRESS,
    sellerAddress: seller, sellerPublicKey: "0306baa226e3a87a99547df2144f2e6206a4a479a46df41ec1618945c064568237",
    ticker: "WORK", tokenId: WORK_TOKEN_ID, unitFaceProofs: 25000, version: WORK_AMO_V8_AUTH_VERSION,
  };
  const terms = deriveWorkAmoV8FrozenTerms(authorization, {
    activationHeight: 1200000, listingBondContributionQ8: 54600000000n,
    listingPosition: { blockHeight: 1200000, blockHash: "33".repeat(32), blockTransactionIndex: 7,
      protocolVout: 1, recordOrdinal: 0 },
    networkValueBeforeQ8: 21000000n * 100000000n,
    spendableAmountSubatoms: 1000000000000000000000n,
  });
  assert.equal(terms.valid, true);
  const tokenState = {
    confirmedSupplySubatoms: "1000000000000000012387",
    holders: [{ address: seller, balanceSubatoms: "1000000000000000012345" },
      { address: base58, balanceSubatoms: "42" }],
    // One externally spent ticket can remain in replay. Core book membership is
    // deliberately absent from this reader's accounting inputs.
    listings: ["55", "66"].map((byte) => ({ listingId: byte.repeat(32), sellerAddress: seller,
      amountSubatoms: terms.frozenTerms.unitAmountSubatoms, priceSats: "25000",
      frozenTerms: terms.frozenTerms, saleAuthorization: authorization })),
  };
  const common = {
    baseState: Object.fromEntries(WORK_AMO_V5_BASE_STATE_FIELDS.map((field) => [field, "0"])),
    creditFixedQ8: "1", creditMovementFrozenValueQ8: "0", movements: [],
    genericTokenStateCommitment: { model: WORK_AMO_V5_PAYLOAD_COMMITMENT_MODEL, payloadBytes: 1, sha256: "51".repeat(32) },
    idStateCommitment: { model: WORK_AMO_V5_PAYLOAD_COMMITMENT_MODEL, payloadBytes: 1, sha256: "52".repeat(32) },
    model: WORK_AMO_V5_NETWORK_ACCUMULATOR_MODEL, network: "livenet", networkValueQ8: "1", quoteHead: null,
    tokenStateCommitment: workAmoV8CanonicalTokenStateCommitment(tokenState),
  };
  const opening = { ...structuredClone(common), throughBlockHash: "33".repeat(32), throughBlockHeight: scope.blockHeight - 1 };
  const closing = { ...structuredClone(common), throughBlockHash: scope.blockHash, throughBlockHeight: scope.blockHeight };
  const openingCommitment = workAmoV5CanonicalStateCommitment(opening);
  const closingCommitment = workAmoV5CanonicalStateCommitment(closing);
  return {
    network: scope.network, blockHeight: scope.blockHeight, blockHash: scope.blockHash,
    previousBlockHash: opening.throughBlockHash, model: WORK_AMO_V8_BLOCK_SEQUENCER_MODEL,
    stateCommitmentModel: WORK_AMO_V5_STATE_COMMITMENT_MODEL,
    workTokenStateModel: WORK_AMO_V8_TOKEN_STATE_PREIMAGE_MODEL,
    blockAtomic: true, feeOnce: true, invalidZero: true, complete: true,
    openingNetworkValueQ8: "1", closingNetworkValueQ8: "1",
    openingStatePayloadBytes: openingCommitment.payloadBytes, openingStateSha256: openingCommitment.sha256,
    closingStatePayloadBytes: closingCommitment.payloadBytes, closingStateSha256: closingCommitment.sha256,
    payload: { network: scope.network, blockHeight: scope.blockHeight, blockHash: scope.blockHash,
      previousBlockHash: opening.throughBlockHash, model: WORK_AMO_V8_BLOCK_SEQUENCER_MODEL,
      workTokenStateModel: WORK_AMO_V8_TOKEN_STATE_PREIMAGE_MODEL,
      blockAtomic: true, feeOnce: true, invalidZero: true, complete: true,
      openingSufficientState: opening, closingSufficientState: closing,
      openingStateCommitment: openingCommitment, closingStateCommitment: closingCommitment,
      closingTokenState: tokenState },
  };
}

function checkpoint(transition) {
  return { network: transition.network, blockHeight: transition.blockHeight, blockHash: transition.blockHash,
    closingStateSha256: transition.closingStateSha256, closingStatePayloadBytes: transition.closingStatePayloadBytes,
    tokenStateCommitment: transition.payload.closingSufficientState.tokenStateCommitment };
}

test("capacity includes every canonical reservation and preserves exact Q16 above safe Number range", () => {
  const transition = fixture();
  const before = JSON.stringify(transition);
  const [capacity] = canonicalWorkWalletCapacitiesFromTransition(transition, scope);
  assert.equal(capacity.model, "canonical-work-wallet-capacity-v1");
  assert.equal(capacity.tokenStateCommitment.model, "canonical-work-amo-payload-sha256-v1");
  assert.equal(capacity.confirmedBalanceSubatoms, "1000000000000000012345");
  assert.equal(capacity.reservedBalanceSubatoms, "500000000000000000000");
  assert.equal(capacity.transferableBalanceSubatoms, "500000000000000012345");
  assert.equal(capacity.reservations.length, 2);
  assert.equal(capacity.reservations.reduce((n, row) => n + BigInt(row.amountSubatoms), 0n).toString(), capacity.reservedBalanceSubatoms);
  assert.equal(JSON.stringify(transition), before);
});

test("batch addresses normalize bech32 only, preserve Base58 and prove empty capacity", () => {
  const result = canonicalWorkWalletCapacitiesFromTransition(fixture(), { ...scope, addresses: [seller.toUpperCase(), base58, absent] });
  assert.deepEqual(result.map((row) => row.address), [seller, base58, absent]);
  assert.deepEqual(result.map((row) => row.confirmedBalanceSubatoms), ["1000000000000000012345", "42", "0"]);
  assert.deepEqual(result[2].reservations, []);
  assert.equal(canonicalWorkWalletCapacitiesFromTransition(fixture(), { ...scope, addresses: [base58.toLowerCase()] }), null);
  assert.equal(canonicalWorkWalletCapacitiesFromTransition(fixture(), { ...scope, addresses: [seller, seller.toUpperCase()] }), null);
});

test("checkpoint, commitment, canonical row, duplicate and oversubscription faults fail closed", () => {
  const mutations = [
    (t) => { t.blockHash = "77".repeat(32); },
    (t) => { t.complete = false; },
    (t) => { t.closingStateSha256 = "77".repeat(32); },
    (t) => { t.closing_state_sha256 = "77".repeat(32); },
    (t) => { t.payload.closingSufficientState.tokenStateCommitment.sha256 = "77".repeat(32); },
    (t) => { t.payload.closingTokenState.holders.push(structuredClone(t.payload.closingTokenState.holders[0])); },
    (t) => { t.payload.closingTokenState.listings.push(structuredClone(t.payload.closingTokenState.listings[0])); },
    (t) => { t.payload.closingTokenState.holders[0].balanceSubatoms = "1"; },
    (t) => { t.payload.closingTokenState.listings[0].amountSubatoms = "-1"; },
    (t) => { t.payload.closingTokenState.listings[0].amountSubatoms = "1.1"; },
    (t) => { t.payload.closingTokenState.listings[0].listingId = "bad"; },
    (t) => { t.payload.closingTokenState.reservedSubatoms = "0"; },
    (t) => { t.payload.closingTokenState.holders = null; },
  ];
  for (const mutate of mutations) {
    const transition = fixture(); mutate(transition);
    assert.equal(canonicalWorkWalletCapacitiesFromTransition(transition, scope), null);
  }
  for (const badScope of [{ ...scope, blockHeight: scope.blockHeight - 1 },
    { ...scope, network: "testnet" }, { ...scope, addresses: ["not-an-address"] }]) {
    assert.equal(canonicalWorkWalletCapacitiesFromTransition(fixture(), badScope), null);
  }
});

test("snake-case DB envelope is validated without coercing conflicting aliases", () => {
  const transition = fixture();
  transition.closing_state_sha256 = transition.closingStateSha256;
  transition.closing_state_payload_bytes = transition.closingStatePayloadBytes;
  delete transition.closingStateSha256;
  delete transition.closingStatePayloadBytes;
  assert.equal(canonicalWorkWalletCapacitiesFromTransition(transition, scope)[0].reservations.length, 2);
});

test("cached capacities still require canonical fence and cannot be poisoned by callers", async () => {
  const transition = fixture();
  let current = checkpoint(transition), fenceReads = 0, transitionReads = 0;
  const reader = createCanonicalWorkWalletCapacityReader({
    readCheckpoint: async () => { fenceReads++; return current; },
    readTransition: async () => { transitionReads++; return transition; },
  });
  const first = await reader("livenet", scope);
  first[0].reservedBalanceSubatoms = "0";
  first[0].reservations.length = 0;
  const second = await reader("livenet", scope);
  assert.equal(second[0].reservations.length, 2);
  assert.equal(transitionReads, 1);
  assert.equal(fenceReads, 2);
  current = null;
  assert.equal(await reader("livenet", scope), null);
  current = { ...checkpoint(transition), blockHash: "77".repeat(32) };
  assert.equal(await reader("livenet", scope), null);
  current = { ...checkpoint(transition), closingStateSha256: "77".repeat(32) };
  assert.equal(await reader("livenet", scope), null);
  assert.equal(transitionReads, 2);
});

test("concurrent addresses share one bounded full-state verification", async () => {
  const transition = fixture();
  let loads = 0, release;
  const blocked = new Promise((resolve) => { release = resolve; });
  const reader = createCanonicalWorkWalletCapacityReader({
    readCheckpoint: async () => checkpoint(transition),
    readTransition: async () => { loads++; await blocked; return transition; },
  });
  const first = reader("livenet", scope);
  const second = reader("livenet", { ...scope, addresses: [base58] });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(loads, 1);
  release();
  const results = await Promise.all([first, second]);
  assert.equal(results[0][0].address, seller);
  assert.equal(results[1][0].confirmedBalanceSubatoms, "42");
});

function rawReplayedFixture(changeTokenState = () => {}) {
  const transition = fixture();
  changeTokenState(transition.payload.closingTokenState);
  const generic = normalizeWorkAmoV5RawGenericState({ holders: [], listings: [], tokens: [] });
  const ids = normalizeWorkAmoV5RawIdState({ listings: [], records: [] });
  const work = normalizeWorkAmoV5RawWorkState({
    ...transition.payload.closingTokenState, amountStorageModel: WORK_SUBATOM_PROJECTION_MODEL,
  });
  const opening = { ...transition.payload.openingSufficientState,
    genericTokenStateCommitment: workAmoV5RawGenericStateCommitment(generic),
    idStateCommitment: workAmoV5RawIdStateCommitment(ids),
    tokenStateCommitment: workAmoV8CanonicalTokenStateCommitment(work),
  };
  const tx = new bitcoin.Transaction();
  tx.addInput(Buffer.alloc(32), 0xffffffff, 0xffffffff, Buffer.from("0400000000", "hex"));
  tx.addOutput(Buffer.from("51", "hex"), 0n);
  const header = Buffer.alloc(80);
  header.writeInt32LE(1, 0);
  Buffer.from(opening.throughBlockHash, "hex").reverse().copy(header, 4);
  Buffer.from(tx.getId(), "hex").reverse().copy(header, 36);
  header.writeUInt32LE(1700000000, 68);
  header.writeUInt32LE(0x1d00ffff, 72);
  const sha256 = (value) => createHash("sha256").update(value).digest();
  const blockHash = Buffer.from(sha256(sha256(header))).reverse().toString("hex");
  const replay = replayWorkAmoV5RawBlock({
    blockHeaderHex: header.toString("hex"),
    blockTransactions: [{ hex: tx.toHex(), txid: tx.getId(), _powBlockIndex: 0,
      vin: [{ coinbase: "0400000000", sequence: 0xffffffff }],
      vout: [{ scriptpubkey: "51", value: "0" }] }],
    expectedBlockHash: blockHash, expectedBlockHeight: scope.blockHeight,
    expectedPreviousBlockHash: opening.throughBlockHash, records: [],
    openingEconomicState: opening, openingGenericState: generic,
    openingIdState: ids, openingWorkState: work,
    workAmoV8: { activationHeight: scope.blockHeight - 1 },
  });
  const openingCommitment = workAmoV5CanonicalStateCommitment(opening);
  Object.assign(transition, { blockHash,
    openingStatePayloadBytes: openingCommitment.payloadBytes, openingStateSha256: openingCommitment.sha256,
    closingStatePayloadBytes: replay.stateCommitment.payloadBytes, closingStateSha256: replay.stateCommitment.sha256,
    closingNetworkValueQ8: replay.economicState.networkValueQ8,
  });
  Object.assign(transition.payload, { blockHash,
    openingSufficientState: opening, openingStateCommitment: openingCommitment,
    closingSufficientState: replay.economicState, closingStateCommitment: replay.stateCommitment,
    closingTokenState: replay.workState,
  });
  return { transition, replay, blockHash };
}

test("capacity validates a complete boundary produced by actual raw-block replay", () => {
  const { transition, replay, blockHash } = rawReplayedFixture();
  const [capacity] = canonicalWorkWalletCapacitiesFromTransition(transition, { ...scope, blockHash });
  assert.equal(replay.blockTransactionCount, 1);
  assert.equal(replay.protocolRecordCount, 0);
  assert.equal(capacity.reservedBalanceSubatoms, "500000000000000000000");
  assert.equal(capacity.transferableBalanceSubatoms, "500000000000000012345");
  assert.deepEqual(capacity.tokenStateCommitment, replay.tokenStateCommitment);
});

test("raw replay's distinct uppercase Bech32 balance keys never inflate Core-derived sender capacity", () => {
  const distinct = rawReplayedFixture((state) => {
    state.holders.push({ address: seller.toUpperCase(), balanceSubatoms: "7" });
    state.confirmedSupplySubatoms = (BigInt(state.confirmedSupplySubatoms) + 7n).toString();
  });
  const [lower] = canonicalWorkWalletCapacitiesFromTransition(distinct.transition,
    { ...scope, blockHash: distinct.blockHash, addresses: [seller.toUpperCase()] });
  assert.equal(lower.address, seller);
  assert.equal(lower.confirmedBalanceSubatoms, "1000000000000000012345");
  assert.equal(lower.reservedBalanceSubatoms, "500000000000000000000");
  assert.equal(distinct.replay.workState.holders.find((row) => row.address === seller.toUpperCase()).balanceSubatoms, "7");

  const uppercaseOnly = rawReplayedFixture((state) => {
    state.holders = [{ address: seller.toUpperCase(), balanceSubatoms: "7" }];
    state.listings = [];
    state.confirmedSupplySubatoms = "7";
  });
  const [empty] = canonicalWorkWalletCapacitiesFromTransition(uppercaseOnly.transition,
    { ...scope, blockHash: uppercaseOnly.blockHash });
  assert.equal(empty.confirmedBalanceSubatoms, "0");
  assert.equal(empty.transferableBalanceSubatoms, "0");
});
