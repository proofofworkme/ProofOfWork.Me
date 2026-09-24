#!/usr/bin/env node

import assert from "node:assert/strict";
import { WORK_AMO_V8_AUTH_VERSION } from "../server/work-amo-v8.mjs";
import {
  WORK_MARKET_V2_ACTIVATION_HEIGHT,
  WORK_MARKET_V2_DECLARATION_TXID,
  workMarketV1RefundSnapshotIncludes,
} from "../server/work-market-v2.mjs";
import {
  activeReplayTokenTableBridgeEra,
  replayTokenTableWorkBridge,
} from "../server/replay-token-table-bridge.mjs";
import {
  WORK_ATOMIC_PROJECTION_MODEL,
  WORK_SUBATOM_CONVERSION_FACTOR,
  WORK_SUBATOM_PROJECTION_MODEL,
  WORK_SUBATOM_UNIT_SCALE_TEXT,
  WORK_TOKEN_ID,
  WORK_UNIT_SCALE_TEXT,
  formatWorkAtoms,
  formatWorkSubatoms,
} from "../server/work-units.mjs";

const hash = "a".repeat(64);
const activationHeight = 960_601;
const checkpoint = 958_382;
const binding = {
  activationHeight,
  currentBindingMatches: true,
  exactCheckpointHash: hash,
  exactCheckpointHeight: checkpoint,
  network: "livenet",
  rebuild: {
    active: true,
    complete: false,
    indexedThroughBlock: checkpoint,
    indexedThroughBlockHash: hash,
    mode: "pwt-range-replay",
    network: "livenet",
    rangeReplayFromHeight: 958_383,
    status: "active",
  },
  replayState: "active",
};
assert.equal(
  activeReplayTokenTableBridgeEra(binding),
  WORK_ATOMIC_PROJECTION_MODEL,
);
assert.equal(
  activeReplayTokenTableBridgeEra({
    ...binding,
    exactCheckpointHeight: activationHeight,
    rebuild: {
      ...binding.rebuild,
      indexedThroughBlock: activationHeight,
    },
  }),
  WORK_SUBATOM_PROJECTION_MODEL,
);
for (const mutation of [
  { currentBindingMatches: false },
  { replayState: "complete" },
  { exactCheckpointHash: "b".repeat(64) },
  { exactCheckpointHeight: checkpoint - 1 },
  { rebuild: { ...binding.rebuild, active: false } },
  { rebuild: { ...binding.rebuild, rangeReplayFromHeight: 958_384 } },
]) {
  assert.equal(activeReplayTokenTableBridgeEra({ ...binding, ...mutation }), "");
}

const factor = WORK_SUBATOM_CONVERSION_FACTOR;
const mint = (txid, minterAddress, atoms) => ({
  amount: formatWorkAtoms(atoms),
  amountAtoms: String(atoms),
  amountStorageModel: WORK_ATOMIC_PROJECTION_MODEL,
  confirmed: true,
  minterAddress,
  tokenId: WORK_TOKEN_ID,
  txid,
});
const movement = (atoms, senderAddress, recipientAddress) => ({
  amount: formatWorkAtoms(atoms),
  amountAtoms: String(atoms),
  amountStorageModel: WORK_ATOMIC_PROJECTION_MODEL,
  confirmed: true,
  recipientAddress,
  senderAddress,
  tokenId: WORK_TOKEN_ID,
});
const q16Movement = (item) => ({
  ...item,
  amount: formatWorkSubatoms(BigInt(item.amountAtoms) * factor),
  amountStorageModel: WORK_SUBATOM_PROJECTION_MODEL,
  amountSubatoms: (BigInt(item.amountAtoms) * factor).toString(),
  amountAtoms: undefined,
  // Event identity aliases are not guaranteed in relational market rows.
  _powEventIndex: undefined,
  eventId: undefined,
});
const mintA = mint("a".repeat(64), "alice", 100);
const mintB = mint("b".repeat(64), "bob", 200);
const saleTxid = "c".repeat(64);
const transferTxid = "0".repeat(64);
const soldListingId = "d".repeat(64);
const activeListingId = "e".repeat(64);
const listing = (listingId, atoms, blockIndex) => ({
  amount: formatWorkAtoms(atoms),
  amountAtoms: String(atoms),
  amountStorageModel: WORK_ATOMIC_PROJECTION_MODEL,
  blockHash: hash,
  blockHeight: checkpoint - 1,
  blockIndex,
  confirmed: true,
  listingId,
  protocolVout: 1,
  recordOrdinal: 0,
  saleAuthorization: {
    anchorType: "sale-ticket-v1",
    anchorVout: 2,
    version: "pwt-sale-v1",
  },
  status: "active",
  tokenId: WORK_TOKEN_ID,
  txid: listingId,
});
const soldOriginal = listing(soldListingId, 10, 1);
const activeOriginal = listing(activeListingId, 20, 2);
const tableListing = (original, status) => ({
  ...original,
  amount: formatWorkSubatoms(BigInt(original.amountAtoms) * factor),
  amountStorageModel: WORK_SUBATOM_PROJECTION_MODEL,
  amountSubatoms: (BigInt(original.amountAtoms) * factor).toString(),
  amountAtoms: undefined,
  decimals: 16,
  saleTicketTxid: original.listingId,
  saleTicketVout: 2,
  status,
  unitScale: WORK_SUBATOM_UNIT_SCALE_TEXT,
});
const historical = {
  indexedThroughBlock: checkpoint,
  closedListings: [{
    ...soldOriginal,
    closedBlockHash: hash,
    closedBlockHeight: checkpoint - 1,
    closedBlockIndex: 4,
    closedConfirmed: true,
    closedTxid: saleTxid,
    status: "sold",
  }],
  listings: [soldOriginal, activeOriginal],
  mints: [mintA, mintB],
  sales: [{
    ...movement(10, "bob", "charlie"),
    blockHash: hash,
    blockHeight: checkpoint - 1,
    blockIndex: 3,
    protocolVout: 1,
    recordOrdinal: 0,
    _powEventIndex: 3,
    eventId: 17,
    createdAt: "2026-09-23T23:59:59.000Z",
    paidSats: 2546,
    priceSats: 2000,
    buyerAddress: "charlie",
    listingId: soldListingId,
    sellerAddress: "bob",
    txid: saleTxid,
  }],
  tokens: [{
    amountStorageModel: WORK_ATOMIC_PROJECTION_MODEL,
    decimals: 8,
    tokenId: WORK_TOKEN_ID,
    unitScale: WORK_UNIT_SCALE_TEXT,
  }],
  transfers: [{
    ...movement(25, "alice", "bob"),
    blockHash: hash,
    blockHeight: checkpoint - 1,
    blockIndex: 5,
    protocolVout: 1,
    recordOrdinal: 0,
    _powEventIndex: 4,
    eventId: 18,
    createdAt: "2026-09-23T23:59:58.000Z",
    paidSats: 546,
    txid: transferTxid,
  }],
};
const holder = (address, atoms) => ({
  address,
  amountStorageModel: WORK_SUBATOM_PROJECTION_MODEL,
  balance: formatWorkSubatoms(BigInt(atoms) * factor),
  balanceSubatoms: (BigInt(atoms) * factor).toString(),
  pendingDelta: "0",
  pendingDeltaSubatoms: "0",
  tokenId: WORK_TOKEN_ID,
});
const table = {
  closedListings: [{
    ...tableListing(soldOriginal, "closed"),
    blockHash: undefined,
    blockHeight: undefined,
    blockIndex: undefined,
    protocolVout: undefined,
    recordOrdinal: undefined,
    closedBlockHash: hash,
    closedBlockHeight: checkpoint - 1,
    closedBlockIndex: 4,
    closedConfirmed: true,
    closedTxid: saleTxid,
    closedVin: 0,
  }],
  holders: [holder("alice", 75), holder("bob", 215), holder("charlie", 10)],
  listings: [tableListing(activeOriginal, "active")],
  mints: [mintA, mintB],
  sales: historical.sales.map((item) => ({
    ...q16Movement(item),
    createdAt: "2026-09-23T23:59:59Z",
  })),
  transfers: historical.transfers.map((item) => ({
    ...q16Movement(item),
    createdAt: "2026-09-23T23:59:58Z",
  })),
  source: "proof-indexer-token-state-tables",
  tokens: [{
    amountStorageModel: WORK_SUBATOM_PROJECTION_MODEL,
    confirmedSupplySubatoms: (300n * factor).toString(),
    decimals: 16,
    tokenId: WORK_TOKEN_ID,
    unitScale: WORK_SUBATOM_UNIT_SCALE_TEXT,
  }],
};
const bridge = (tableState, historicalState, model) =>
  replayTokenTableWorkBridge(
    tableState,
    historicalState,
    model,
    historicalState.indexedThroughBlock,
  );
const q8 = bridge(
  table,
  historical,
  WORK_ATOMIC_PROJECTION_MODEL,
);
assert.ok(q8);
assert.equal(q8.historicalSupplyAtoms, "300");
assert.deepEqual(
  q8.historicalHolders.map(({ address, balanceAtoms }) => [address, balanceAtoms]),
  [["alice", "75"], ["bob", "215"], ["charlie", "10"]],
);
assert.equal(q8.workSupplySubatoms, (300n * factor).toString());
assert.equal(q8.historicalClosedListings[0].status, "closed");
assert.equal(q8.historicalClosedListings[0].amountAtoms, "10");
assert.equal(q8.historicalClosedListings[0].blockHash, hash);
assert.equal(q8.historicalClosedListings[0].blockIndex, 1);
assert.equal(q8.historicalListings[0].status, "active");
assert.equal(q8.historicalListings[0].amountAtoms, "20");
assert.equal(q8.historicalListings[0].amountSubatoms, undefined);

// Legacy event-backed market rows can retain Q8 amounts even when the WORK
// definition and holder table have moved to Q16. Both explicit unit formats
// are valid witnesses at a Q8 checkpoint when their quantities match.
const q8PhysicalTable = {
  ...table,
  sales: historical.sales.map((item) => ({
    ...item,
    _powEventIndex: undefined,
    eventId: undefined,
  })),
  transfers: historical.transfers.map((item) => ({
    ...item,
    _powEventIndex: undefined,
    eventId: undefined,
  })),
};
assert.ok(bridge(q8PhysicalTable, historical, WORK_ATOMIC_PROJECTION_MODEL));
assert.ok(bridge({
  ...table,
  sales: q8PhysicalTable.sales,
}, historical, WORK_ATOMIC_PROJECTION_MODEL));
assert.ok(bridge({
  ...table,
  transfers: q8PhysicalTable.transfers,
}, historical, WORK_ATOMIC_PROJECTION_MODEL));
for (const [kind, bad] of [
  ["sales", { amountSubatoms: (10n * factor).toString() }],
  ["transfers", { amountSubatoms: (25n * factor).toString() }],
  ["sales", { amountAtoms: "10.5" }],
  ["transfers", { amountAtoms: "0" }],
  ["sales", { amountStorageModel: "unknown" }],
]) {
  assert.equal(bridge({
    ...q8PhysicalTable,
    [kind]: [{ ...q8PhysicalTable[kind][0], ...bad }],
  }, historical, WORK_ATOMIC_PROJECTION_MODEL), null);
}
for (const kind of ["sales", "transfers"]) {
  assert.equal(bridge({
    ...table,
    [kind]: [{ ...table[kind][0], amountAtoms: "1" }],
  }, historical, WORK_ATOMIC_PROJECTION_MODEL), null);
}

// Q8 history uses the bounded event's canonical position and quantity. The
// physical Q16 witness may omit old event aliases while carrying the same
// transaction, output position, actors, and exact Q8 multiple.
assert.equal(table.sales[0].eventId, undefined);
assert.equal(table.transfers[0]._powEventIndex, undefined);
for (const [kind, changes] of [
  ["sales", [
    { amountSubatoms: (11n * factor).toString() },
    { amountSubatoms: (10n * factor + 1n).toString() },
    { blockHash: "b".repeat(64) },
    { blockHeight: checkpoint + 1 },
    { blockIndex: 99 },
    { protocolVout: 2 },
    { recordOrdinal: 1 },
    { sellerAddress: "alice" },
    { buyerAddress: "alice" },
    { priceSats: 2001 },
    { paidSats: 2547 },
    { createdAt: "2026-09-23T23:59:57Z" },
    { txid: "9".repeat(64) },
  ]],
  ["transfers", [
    { amountSubatoms: (26n * factor).toString() },
    { amountSubatoms: (25n * factor + 1n).toString() },
    { blockHash: "b".repeat(64) },
    { blockHeight: checkpoint + 1 },
    { blockIndex: 99 },
    { protocolVout: 2 },
    { recordOrdinal: 1 },
    { senderAddress: "bob" },
    { recipientAddress: "charlie" },
    { paidSats: 547 },
    { createdAt: "2026-09-23T23:59:57Z" },
    { txid: "9".repeat(64) },
  ]],
]) {
  for (const change of changes) {
    assert.equal(bridge({
      ...table,
      [kind]: [{ ...table[kind][0], ...change }],
    }, historical, WORK_ATOMIC_PROJECTION_MODEL), null);
  }
  assert.equal(bridge({
    ...table,
    [kind]: [],
  }, historical, WORK_ATOMIC_PROJECTION_MODEL), null);
  assert.equal(bridge({
    ...table,
    [kind]: [table[kind][0], table[kind][0]],
  }, historical, WORK_ATOMIC_PROJECTION_MODEL), null);
  assert.equal(bridge({
    ...table,
    [kind]: [table[kind][0], {
      ...table[kind][0],
      txid: "9".repeat(64),
    }],
  }, historical, WORK_ATOMIC_PROJECTION_MODEL), null);
}

// Equal aggregate supply cannot hide a misallocated holder or mint identity.
assert.equal(bridge({
  ...table,
  holders: [holder("alice", 76), holder("bob", 214), holder("charlie", 10)],
}, historical, WORK_ATOMIC_PROJECTION_MODEL), null);
assert.equal(bridge({
  ...table,
  mints: [mintA, mint("c".repeat(64), "bob", 200)],
}, historical, WORK_ATOMIC_PROJECTION_MODEL), null);
assert.equal(bridge({
  ...table,
  holders: [{
    ...holder("alice", 75),
    balanceSubatoms: (75n * factor + 1n).toString(),
  }, holder("bob", 215), holder("charlie", 10)],
}, historical, WORK_ATOMIC_PROJECTION_MODEL), null);
assert.equal(bridge(
  table,
  { ...historical, sales: [] },
  WORK_ATOMIC_PROJECTION_MODEL,
), null);
assert.equal(bridge({
  ...table,
  listings: [{
    ...table.listings[0],
    amountSubatoms: (21n * factor).toString(),
  }],
}, historical, WORK_ATOMIC_PROJECTION_MODEL), null);
assert.equal(bridge({
  ...table,
  closedListings: [{
    ...table.closedListings[0],
    blockIndex: 3,
  }],
}, historical, WORK_ATOMIC_PROJECTION_MODEL), null);
assert.equal(bridge({
  ...table,
  closedListings: [{
    ...table.closedListings[0],
    closedTxid: "f".repeat(64),
  }],
}, historical, WORK_ATOMIC_PROJECTION_MODEL), null);
assert.equal(bridge({
  ...table,
  closedListings: [{
    ...tableListing(soldOriginal, "closed"),
    closedConfirmed: true,
    closedTxid: "f".repeat(64),
  }],
}, historical, WORK_ATOMIC_PROJECTION_MODEL), null);
assert.equal(bridge({
  ...table,
  closedListings: [{
    ...tableListing(soldOriginal, "active"),
    closedConfirmed: true,
    closedTxid: saleTxid,
  }],
}, historical, WORK_ATOMIC_PROJECTION_MODEL), null);
const delistedOriginal = listing("6".repeat(64), 7, 4);
const delistedCloseTxid = "7".repeat(64);
const delistedHistorical = {
  ...historical,
  listings: [...historical.listings, delistedOriginal],
  closedListings: [
    ...historical.closedListings,
    {
      ...delistedOriginal,
      closedBlockHash: hash,
      closedBlockHeight: checkpoint,
      closedBlockIndex: 5,
      closedConfirmed: true,
      closedTxid: delistedCloseTxid,
      status: "delisted",
    },
  ],
};
const delistedTable = {
  ...table,
  closedListings: [...table.closedListings, {
    ...tableListing(delistedOriginal, "delisted"),
    closedBlockHash: hash,
    closedBlockHeight: checkpoint,
    closedBlockIndex: 5,
    closedByCanonicalOutpointSpend: true,
    closedConfirmed: true,
    closedTxid: delistedCloseTxid,
    closedVin: 0,
  }],
};
assert.ok(bridge(
  delistedTable,
  delistedHistorical,
  WORK_ATOMIC_PROJECTION_MODEL,
));
assert.equal(bridge({
  ...delistedTable,
  closedListings: [delistedTable.closedListings[0], {
    ...delistedTable.closedListings[1],
    closedByCanonicalOutpointSpend: false,
  }],
}, delistedHistorical, WORK_ATOMIC_PROJECTION_MODEL), null);
assert.equal(bridge({
  ...delistedTable,
  closedListings: [delistedTable.closedListings[0], {
    ...delistedTable.closedListings[1],
    status: "sold",
  }],
}, delistedHistorical, WORK_ATOMIC_PROJECTION_MODEL), null);
assert.equal(bridge({
  ...delistedTable,
  closedListings: [delistedTable.closedListings[0], {
    ...delistedTable.closedListings[1],
    closedTxid: "",
  }],
}, delistedHistorical, WORK_ATOMIC_PROJECTION_MODEL), null);
assert.equal(bridge({
  ...table,
  listings: [table.closedListings[0]],
}, historical, WORK_ATOMIC_PROJECTION_MODEL), null);
assert.equal(bridge({
  ...table,
  sales: [{
    ...table.sales[0],
    amountSubatoms: (11n * factor).toString(),
  }],
}, historical, WORK_ATOMIC_PROJECTION_MODEL), null);

const eventlessOriginal = listing("8".repeat(64), 7, 6);
const eventlessClose = {
  ...tableListing(eventlessOriginal, "closed"),
  closedBlockHash: hash,
  closedBlockHeight: checkpoint,
  closedBlockIndex: 7,
  closedByCanonicalOutpointSpend: true,
  closedCanonicalMinerFeeSats: 805,
  closedConfirmed: true,
  closedMinerFeeCanonical: true,
  closedMinerFeeSats: 805,
  closedMinerFeeSource: "proof-indexer-canonical-outpoint-spend",
  closedTxid: "9".repeat(64),
  closedVin: 0,
};
const eventlessHistorical = {
  ...historical,
  listings: [...historical.listings, eventlessOriginal],
};
const eventlessTable = {
  ...table,
  closedListings: [...table.closedListings, eventlessClose],
};
const eventlessBridge = bridge(
  eventlessTable,
  eventlessHistorical,
  WORK_ATOMIC_PROJECTION_MODEL,
);
assert.ok(eventlessBridge);
assert.equal(eventlessBridge.historicalClosedListings.length, 2);
assert.equal(eventlessBridge.historicalListings.length, 1);
const eventlessAtCheckpoint = eventlessBridge.historicalClosedListings.find(
  (item) => item.listingId === eventlessOriginal.listingId,
);
assert.equal(eventlessAtCheckpoint.closedMinerFeeCanonical, true);
assert.equal(eventlessAtCheckpoint.closedMinerFeeSats, 805);
assert.equal(eventlessAtCheckpoint.closedCanonicalMinerFeeSats, 805);
assert.equal(
  eventlessAtCheckpoint.closedMinerFeeSource,
  "proof-indexer-canonical-outpoint-spend",
);
for (const mutation of [
  { closedMinerFeeCanonical: false },
  { closedMinerFeeSats: undefined },
  { closedMinerFeeSats: -1 },
  { closedMinerFeeSource: "payload" },
  { closedCanonicalMinerFeeSats: 806 },
]) {
  assert.equal(bridge({
    ...eventlessTable,
    closedListings: [
      eventlessTable.closedListings[0],
      { ...eventlessClose, ...mutation },
    ],
  }, eventlessHistorical, WORK_ATOMIC_PROJECTION_MODEL), null);
}

const futureOriginal = listing("4".repeat(64), 9, 8);
const futureClose = {
  ...tableListing(futureOriginal, "closed"),
  closedBlockHash: "b".repeat(64),
  closedBlockHeight: checkpoint + 1,
  closedBlockIndex: 9,
  closedByCanonicalOutpointSpend: true,
  closedConfirmed: true,
  closedTxid: "5".repeat(64),
  closedVin: 2,
};
const futureHistorical = {
  ...historical,
  listings: [...historical.listings, futureOriginal],
};
const futureTable = {
  ...table,
  closedListings: [...table.closedListings, futureClose],
};
const futureBridge = bridge(
  futureTable,
  futureHistorical,
  WORK_ATOMIC_PROJECTION_MODEL,
);
assert.ok(futureBridge);
assert.equal(futureBridge.historicalClosedListings.length, 1);
const futureAtCheckpoint = futureBridge.historicalListings.find(
  (item) => item.listingId === futureOriginal.listingId,
);
assert.equal(futureAtCheckpoint.status, "active");
assert.equal(futureAtCheckpoint.closedTxid, undefined);
assert.equal(futureAtCheckpoint.closedMinerFeeCanonical, undefined);
assert.equal(futureAtCheckpoint.closedMinerFeeSats, undefined);
assert.equal(futureAtCheckpoint.saleTicketTxid, futureOriginal.listingId);
assert.deepEqual(
  futureBridge.historicalListings.map((item) => item.listingId).sort(),
  [activeListingId, futureOriginal.listingId].sort(),
);
for (const mutation of [
  { closedVin: undefined },
  { saleTicketVout: 3 },
  { closedBlockHash: "" },
]) {
  assert.equal(bridge({
    ...futureTable,
    closedListings: [
      futureTable.closedListings[0],
      { ...futureClose, ...mutation },
    ],
  }, futureHistorical, WORK_ATOMIC_PROJECTION_MODEL), null);
}

// The physical tip has already applied the V2 refund policy. The bridge
// checks the pinned policy row against the bounded opening and returns the
// raw lifecycle; the final summary applies V2 at its own checkpoint.
const v2Checkpoint = 959_620;
const refundListingId =
  "d9ebbed6cf79275d91ca0caf8770ef783681cce917b69a63a9cf8af45f485a10";
const excludedListingId = "6".repeat(64);
assert.equal(workMarketV1RefundSnapshotIncludes(refundListingId), true);
assert.equal(workMarketV1RefundSnapshotIncludes(excludedListingId), false);
const refundOriginal = {
  ...listing(refundListingId, 7, 6),
  blockHeight: WORK_MARKET_V2_ACTIVATION_HEIGHT - 13,
};
const excludedOriginal = {
  ...listing(excludedListingId, 8, 7),
  blockHeight: WORK_MARKET_V2_ACTIVATION_HEIGHT - 12,
};
const refundCutover = {
  ...tableListing(refundOriginal, "disabled"),
  closedConfirmed: true,
  closedTxid: "",
  disabledAtBlockHeight: WORK_MARKET_V2_ACTIVATION_HEIGHT,
  disabledByTxid: WORK_MARKET_V2_DECLARATION_TXID,
  disabledReason: "work-market-v2-cutover",
  refundEligible: true,
  relic: true,
};
const excludedCutover = {
  ...tableListing(excludedOriginal, "closed"),
  closedConfirmed: true,
  closedTxid: "",
  disabledAtBlockHeight: WORK_MARKET_V2_ACTIVATION_HEIGHT,
  disabledByTxid: WORK_MARKET_V2_DECLARATION_TXID,
  disabledReason: "work-market-v1-refund-snapshot-excluded",
  refundEligible: false,
  relic: false,
};
const v2Historical = {
  ...historical,
  indexedThroughBlock: v2Checkpoint,
  listings: [...historical.listings, refundOriginal, excludedOriginal],
};
const v2Table = {
  ...table,
  closedListings: [
    ...table.closedListings,
    refundCutover,
    excludedCutover,
  ],
};
const v2Bridge = bridge(
  v2Table,
  v2Historical,
  WORK_ATOMIC_PROJECTION_MODEL,
);
assert.ok(v2Bridge);
assert.equal(v2Bridge.historicalClosedListings.length, 1);
for (const original of [refundOriginal, excludedOriginal]) {
  const atCheckpoint = v2Bridge.historicalListings.find(
    (item) => item.listingId === original.listingId,
  );
  assert.equal(atCheckpoint?.status, "active");
  assert.equal(atCheckpoint?.amountAtoms, original.amountAtoms);
  assert.equal(atCheckpoint?.blockHeight, original.blockHeight);
  assert.equal(atCheckpoint?.disabledReason, undefined);
  assert.equal(atCheckpoint?.closedConfirmed, undefined);
}
for (const mutation of [
  { disabledAtBlockHeight: WORK_MARKET_V2_ACTIVATION_HEIGHT + 1 },
  { disabledByTxid: "1".repeat(64) },
  { disabledReason: "arbitrary-cutover" },
  { refundEligible: false },
  { relic: false },
  { amountSubatoms: "1" },
  { blockIndex: 9 },
  { closedBlockHeight: v2Checkpoint },
  { closedTxid: "1".repeat(64) },
]) {
  assert.equal(bridge({
    ...v2Table,
    closedListings: [
      v2Table.closedListings[0],
      { ...refundCutover, ...mutation },
      excludedCutover,
    ],
  }, v2Historical, WORK_ATOMIC_PROJECTION_MODEL), null);
}
assert.equal(bridge({
  ...v2Table,
  listings: [...v2Table.listings, refundCutover],
}, v2Historical, WORK_ATOMIC_PROJECTION_MODEL), null);
assert.equal(bridge(v2Table, {
  ...v2Historical,
  listings: [...v2Historical.listings, {
    ...refundOriginal,
    listingId: "2".repeat(64),
    txid: "2".repeat(64),
  }],
}, WORK_ATOMIC_PROJECTION_MODEL), null);
const canonicalRefundClose = {
  ...refundCutover,
  closedBlockHash: "b".repeat(64),
  closedBlockHeight: v2Checkpoint - 1,
  closedBlockIndex: 7,
  closedByCanonicalOutpointSpend: true,
  closedMinerFeeCanonical: true,
  closedMinerFeeSats: 805,
  closedMinerFeeSource: "proof-indexer-canonical-outpoint-spend",
  closedTxid: "3".repeat(64),
  closedVin: 0,
};
const v2ClosedBridge = bridge({
  ...v2Table,
  closedListings: [
    v2Table.closedListings[0],
    canonicalRefundClose,
    excludedCutover,
  ],
}, v2Historical, WORK_ATOMIC_PROJECTION_MODEL);
assert.ok(v2ClosedBridge);
const v2ClosedAtCheckpoint = v2ClosedBridge.historicalClosedListings.find(
  (item) => item.listingId === refundListingId,
);
assert.equal(v2ClosedAtCheckpoint?.status, "closed");
assert.equal(v2ClosedAtCheckpoint?.closedMinerFeeSats, 805);
assert.equal(v2ClosedAtCheckpoint?.disabledReason, undefined);
for (const mutation of [
  { closedByCanonicalOutpointSpend: false },
  { closedVin: undefined },
  { closedMinerFeeSats: undefined },
  { closedMinerFeeSource: "payload" },
]) {
  assert.equal(bridge({
    ...v2Table,
    closedListings: [
      v2Table.closedListings[0],
      { ...canonicalRefundClose, ...mutation },
      excludedCutover,
    ],
  }, v2Historical, WORK_ATOMIC_PROJECTION_MODEL), null);
}
const futureRefundBridge = bridge({
  ...v2Table,
  closedListings: [
    v2Table.closedListings[0],
    { ...canonicalRefundClose, closedBlockHeight: v2Checkpoint + 1 },
    excludedCutover,
  ],
}, v2Historical, WORK_ATOMIC_PROJECTION_MODEL);
assert.ok(futureRefundBridge);
assert.equal(futureRefundBridge.historicalClosedListings.length, 1);
assert.equal(futureRefundBridge.historicalListings.find(
  (item) => item.listingId === refundListingId,
)?.closedTxid, undefined);

const v8ListingId = "f".repeat(64);
const v8CloseTxid = "1".repeat(64);
const v8Original = {
  ...q16Movement(activeOriginal),
  blockHeight: activationHeight + 1,
  listingId: v8ListingId,
  saleAuthorization: {
    ...activeOriginal.saleAuthorization,
    version: WORK_AMO_V8_AUTH_VERSION,
  },
  txid: v8ListingId,
};
const v8TableListing = {
  ...v8Original,
  saleTicketTxid: v8ListingId,
  saleTicketVout: 2,
  status: "active",
};
const q16Historical = {
  ...historical,
  indexedThroughBlock: activationHeight + 1,
  closedListings: historical.closedListings.map(q16Movement),
  listings: [...historical.listings.map(q16Movement), v8Original],
  mints: historical.mints.map(q16Movement),
  sales: historical.sales.map(q16Movement),
  tokens: [{
    amountStorageModel: WORK_SUBATOM_PROJECTION_MODEL,
    decimals: 16,
    tokenId: WORK_TOKEN_ID,
    unitScale: WORK_SUBATOM_UNIT_SCALE_TEXT,
  }],
  transfers: historical.transfers.map(q16Movement),
};
const q16Table = {
  ...table,
  listings: [...table.listings, v8TableListing],
  mints: table.mints.map(q16Movement),
  sales: table.sales,
  transfers: table.transfers,
};
const q16 = bridge(
  q16Table,
  q16Historical,
  WORK_SUBATOM_PROJECTION_MODEL,
);
assert.ok(q16);
assert.equal(q16.workSupplySubatoms, (300n * factor).toString());
assert.equal(q16.historicalHolders.length, 0);
assert.equal(bridge({
  ...q16Table,
  sales: q8PhysicalTable.sales,
}, q16Historical, WORK_SUBATOM_PROJECTION_MODEL), null);
assert.equal(bridge({
  ...q16Table,
  sales: [],
}, q16Historical, WORK_SUBATOM_PROJECTION_MODEL), null);
assert.equal(bridge({
  ...q16Table,
  sales: [...q16Table.sales, {
    ...q16Table.sales[0],
    txid: "2".repeat(64),
  }],
}, q16Historical, WORK_SUBATOM_PROJECTION_MODEL), null);
assert.equal(bridge({
  ...q16Table,
  listings: table.listings,
}, q16Historical, WORK_SUBATOM_PROJECTION_MODEL), null);
assert.equal(bridge({
  ...q16Table,
  listings: [...q16Table.listings, {
    ...v8TableListing,
    listingId: "3".repeat(64),
    txid: "3".repeat(64),
  }],
}, q16Historical, WORK_SUBATOM_PROJECTION_MODEL), null);
assert.equal(bridge({
  ...q16Table,
  listings: [q16Table.listings[0], {
    ...v8TableListing,
    amountSubatoms: (21n * factor).toString(),
  }],
}, q16Historical, WORK_SUBATOM_PROJECTION_MODEL), null);
assert.equal(bridge({
  ...q16Table,
  listings: [q16Table.listings[0], {
    ...v8TableListing,
    blockIndex: 999,
  }],
}, q16Historical, WORK_SUBATOM_PROJECTION_MODEL), null);
assert.equal(bridge({
  ...q16Table,
  sales: [{
    ...q16Table.sales[0],
    amountSubatoms: (11n * factor).toString(),
  }],
}, q16Historical, WORK_SUBATOM_PROJECTION_MODEL), null);
const q16ClosedHistorical = {
  ...q16Historical,
  closedListings: [...q16Historical.closedListings, {
    ...v8Original,
    closedBlockHash: hash,
    closedBlockHeight: activationHeight + 1,
    closedBlockIndex: 8,
    closedConfirmed: true,
    closedTxid: v8CloseTxid,
  }],
};
const q16ClosedTable = {
  ...q16Table,
  closedListings: [...q16Table.closedListings, {
    ...v8TableListing,
    closedBlockHash: hash,
    closedBlockHeight: activationHeight + 1,
    closedBlockIndex: 8,
    closedByCanonicalOutpointSpend: true,
    closedConfirmed: true,
    closedTxid: v8CloseTxid,
    closedVin: 0,
    status: "closed",
  }],
  listings: table.listings,
};
assert.ok(bridge(
  q16ClosedTable,
  q16ClosedHistorical,
  WORK_SUBATOM_PROJECTION_MODEL,
));
assert.equal(bridge({
  ...q16ClosedTable,
  closedListings: [q16ClosedTable.closedListings[0]],
}, q16ClosedHistorical, WORK_SUBATOM_PROJECTION_MODEL), null);
assert.equal(bridge({
  ...q16ClosedTable,
  listings: q16Table.listings,
}, q16ClosedHistorical, WORK_SUBATOM_PROJECTION_MODEL), null);
assert.equal(bridge({
  ...q16ClosedTable,
  closedListings: [q16ClosedTable.closedListings[0], {
    ...q16ClosedTable.closedListings[1],
    closedTxid: "4".repeat(64),
  }],
}, q16ClosedHistorical, WORK_SUBATOM_PROJECTION_MODEL), null);
assert.equal(bridge({
  ...q16ClosedTable,
  closedListings: [q16ClosedTable.closedListings[0], {
    ...q16ClosedTable.closedListings[1],
    status: "active",
  }],
}, q16ClosedHistorical, WORK_SUBATOM_PROJECTION_MODEL), null);

const futureV8Table = {
  ...q16Table,
  closedListings: [...q16Table.closedListings, {
    ...v8TableListing,
    closedBlockHash: "b".repeat(64),
    closedBlockHeight: activationHeight + 2,
    closedBlockIndex: 9,
    closedByCanonicalOutpointSpend: true,
    closedConfirmed: true,
    closedTxid: "5".repeat(64),
    closedVin: 2,
    status: "closed",
  }],
  listings: table.listings,
};
const futureV8Bridge = bridge(
  futureV8Table,
  q16Historical,
  WORK_SUBATOM_PROJECTION_MODEL,
);
assert.ok(futureV8Bridge);
assert.ok(futureV8Bridge.historicalListings.some(
  (item) => item.listingId === v8ListingId,
));
assert.equal(futureV8Bridge.historicalClosedListings.length, 1);
const futureV8AtCheckpoint = futureV8Bridge.historicalListings.find(
  (item) => item.listingId === v8ListingId,
);
assert.equal(futureV8AtCheckpoint.status, "active");
assert.equal(futureV8AtCheckpoint.closedTxid, undefined);

const sealFields = (txid, blockHeight) => ({
  sealAt: "2026-09-24T00:00:00.000Z",
  sealBlockHash: "9".repeat(64),
  sealBlockHeight: blockHeight,
  sealBlockIndex: 5,
  sealConfirmed: true,
  sealDataBytes: 128,
  sealMinerFeeSats: 111,
  sealProtocolVout: 1,
  sealRecordOrdinal: 0,
  sealTransactionBlockHeight: blockHeight,
  sealTxid: txid,
});
const futureSealTxid = "0".repeat(64);
const q8FutureSealedListing = {
  ...table.listings[0],
  ...sealFields(futureSealTxid, checkpoint + 1),
  futureOnlyTerms: "must not reach checkpoint",
  saleAuthorization: {
    ...activeOriginal.saleAuthorization,
    futureOnlySignature: "after H",
  },
  status: "sealing",
};
const q8FutureSealBridge = bridge({
  ...table,
  listings: [q8FutureSealedListing],
}, historical, WORK_ATOMIC_PROJECTION_MODEL);
assert.ok(q8FutureSealBridge);
assert.equal(q8FutureSealBridge.historicalListings[0].sealTxid, undefined);
assert.equal(q8FutureSealBridge.historicalListings[0].sealConfirmed, undefined);
assert.equal(q8FutureSealBridge.historicalListings[0].futureOnlyTerms, undefined);
assert.equal(q8FutureSealBridge.historicalListings[0].status, "active");
assert.deepEqual(
  q8FutureSealBridge.historicalListings[0].saleAuthorization,
  activeOriginal.saleAuthorization,
);
for (const mutation of [
  { sealBlockHash: "" },
  { sealBlockIndex: undefined },
  { sealConfirmed: false },
  { sealProtocolVout: undefined },
  { sealRecordOrdinal: undefined },
  { sealTransactionBlockHeight: checkpoint + 2 },
  { sealBlockHeight: checkpoint },
  { status: "unknown" },
]) {
  assert.equal(bridge({
    ...table,
    listings: [{ ...q8FutureSealedListing, ...mutation }],
  }, historical, WORK_ATOMIC_PROJECTION_MODEL), null);
}
const q8PendingSeal = {
  ...table.listings[0],
  sealConfirmed: false,
  sealTxid: futureSealTxid,
  saleAuthorization: {
    ...activeOriginal.saleAuthorization,
    futureOnlySignature: "pending",
  },
  status: "sealing",
};
const q8PendingBridge = bridge({
  ...table,
  listings: [q8PendingSeal],
}, historical, WORK_ATOMIC_PROJECTION_MODEL);
assert.ok(q8PendingBridge);
assert.equal(q8PendingBridge.historicalListings[0].sealTxid, undefined);
assert.equal(q8PendingBridge.historicalListings[0].status, "active");
assert.equal(bridge({
  ...table,
  listings: [{ ...q8PendingSeal, sealBlockHeight: checkpoint + 1 }],
}, historical, WORK_ATOMIC_PROJECTION_MODEL), null);

const preHSealTxid = "2".repeat(64);
const q8HistoricalSealed = {
  ...historical,
  listings: [historical.listings[0], {
    ...activeOriginal,
    ...sealFields(preHSealTxid, checkpoint),
    sealTransactionBlockHeight: undefined,
    saleAuthorization: {
      ...activeOriginal.saleAuthorization,
      boundedSignature: "at H",
    },
  }],
};
const q8PhysicalSealed = {
  ...table.listings[0],
  ...sealFields(preHSealTxid, checkpoint),
  saleAuthorization: {
    ...activeOriginal.saleAuthorization,
    boundedSignature: "at H",
  },
  status: "sealing",
};
const q8PreHSealBridge = bridge({
  ...table,
  listings: [q8PhysicalSealed],
}, q8HistoricalSealed, WORK_ATOMIC_PROJECTION_MODEL);
assert.ok(q8PreHSealBridge);
assert.equal(q8PreHSealBridge.historicalListings[0].sealTxid, preHSealTxid);
assert.equal(
  q8PreHSealBridge.historicalListings[0].sealTransactionBlockHeight,
  checkpoint,
);
for (const mutation of [
  { sealTxid: "3".repeat(64) },
  { sealBlockHash: "8".repeat(64) },
  { sealBlockIndex: 6 },
  { sealProtocolVout: 2 },
  { sealRecordOrdinal: 1 },
]) {
  assert.equal(bridge({
    ...table,
    listings: [{ ...q8PhysicalSealed, ...mutation }],
  }, q8HistoricalSealed, WORK_ATOMIC_PROJECTION_MODEL), null);
}
assert.equal(bridge(table, q8HistoricalSealed,
  WORK_ATOMIC_PROJECTION_MODEL), null);
const q8PendingResealBridge = bridge({
  ...table,
  listings: [q8PendingSeal],
}, q8HistoricalSealed, WORK_ATOMIC_PROJECTION_MODEL);
assert.ok(q8PendingResealBridge);
assert.equal(
  q8PendingResealBridge.historicalListings[0].sealTxid,
  preHSealTxid,
);
assert.deepEqual(
  q8PendingResealBridge.historicalListings[0].saleAuthorization,
  q8HistoricalSealed.listings[1].saleAuthorization,
);

const q16FutureSealListing = {
  ...v8TableListing,
  ...sealFields("4".repeat(64), q16Historical.indexedThroughBlock + 1),
  saleAuthorization: {
    ...v8Original.saleAuthorization,
    futureOnlySignature: "after H",
  },
  status: "sealing",
};
const q16FutureSealBridge = bridge({
  ...q16Table,
  listings: [q16Table.listings[0], q16FutureSealListing],
}, q16Historical, WORK_SUBATOM_PROJECTION_MODEL);
assert.ok(q16FutureSealBridge);
const q16Projected = q16FutureSealBridge.historicalListings.find(
  (item) => item.listingId === v8ListingId,
);
assert.equal(q16Projected.sealTxid, undefined);
assert.equal(q16Projected.status, "active");
assert.equal(q16Projected.saleAuthorization.futureOnlySignature, undefined);
assert.equal(q16Projected.amountSubatoms, v8Original.amountSubatoms);
assert.equal(bridge({
  ...q16Table,
  listings: [q16Table.listings[0], {
    ...q16FutureSealListing,
    sealTransactionBlockHeight: q16Historical.indexedThroughBlock + 2,
  }],
}, q16Historical, WORK_SUBATOM_PROJECTION_MODEL), null);

console.log("Replay token-table bridge checks passed.");
