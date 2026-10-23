import test from "node:test";
import assert from "node:assert/strict";
import { addressTransactionNotification, createAddressNotificationReader, exactNotificationAddressHistory } from "./notification-address-history.mjs";

const hash = c => c.repeat(64), address = "1ExactCaseAddress", other = "1OtherAddress";
const output = (address, value) => ({ scriptpubkey_address: address, scriptpubkey: "00", value });
function transaction(txid, outputs, inputs = [output(other, 1000)]) {
  return { txid, status: { confirmed: true, block_hash: hash("f"), block_time: 100 },
    vin: inputs.map((prevout, vout) => ({ txid: hash("e"), vout, prevout })), vout: outputs };
}
test("plain transfers retain exact input/output evidence without inferring preparation intent", () => {
  const incoming = addressTransactionNotification(transaction(hash("a"), [output(address, 900)]), { txid: hash("a"), height: 10 }, address, "livenet", hash("f"), "2026-10-23T00:00:00Z");
  assert.equal(incoming.direction, "incoming"); assert.equal(incoming.evidence.amounts.netSatsExact, "900");
  assert.equal(incoming.evidence.amounts.feeSatsExact, "100"); assert.equal(incoming.maxEventId, null);
  const change = addressTransactionNotification(transaction(hash("b"), [output(other, 500), output(address, 400)], [output(address, 1000)]), { txid: hash("b"), height: 10 }, address, "livenet", hash("f"), "2026-10-23T00:00:00Z");
  assert.equal(change.direction, "outgoing", "Change is not a self-send."); assert.equal(change.evidence.amounts.netSatsExact, "-600");
  const self = addressTransactionNotification(transaction(hash("b"), [output(address, 400), output(address, 500)], [output(address, 1000)]), { txid: hash("b"), height: 10 }, address, "livenet", hash("f"), "2026-10-23T00:00:00Z");
  assert.equal(self.direction, "self"); assert.equal(self.label, "Self-transfer");
  const mixed = addressTransactionNotification(transaction(hash("b"), [output(address, 1900)], [output(address, 1000), output(other, 1000)]), { txid: hash("b"), height: 10 }, address, "livenet", hash("f"), "2026-10-23T00:00:00Z");
  assert.deepEqual(mixed.senderAddresses, [address, other]); assert.equal(mixed.actorAddress, null);
  assert.equal(mixed.direction, "related"); assert.equal(mixed.label, "Shared-input transaction");
  assert.throws(() => addressTransactionNotification(transaction(hash("a"), [output(address, 1001)]), { txid: hash("a"), height: 10 }, address, "livenet", hash("f"), ""), /does not balance/u);
});

test("address evidence fails closed for gaps, case changes and reorganized blocks", () => {
  assert.throws(() => exactNotificationAddressHistory([{ tx_hash: hash("a"), height: 3 }, { tx_hash: hash("a"), height: 3 }]), /ambiguous/u);
  assert.throws(() => exactNotificationAddressHistory([{ tx_hash: hash("a"), height: -2 }]), /ambiguous/u);
  const tx = transaction(hash("a"), [output(address, 900)]);
  assert.throws(() => addressTransactionNotification(tx, { txid: hash("a"), height: 10 }, address.toLowerCase(), "livenet", hash("f"), ""), /unrelated/u);
  assert.throws(() => addressTransactionNotification(tx, { txid: hash("a"), height: 10 }, address, "livenet", hash("d"), ""), error => error.statusCode === 409);
  delete tx.vin[0].prevout;
  assert.throws(() => addressTransactionNotification(tx, { txid: hash("a"), height: 10 }, address, "livenet", hash("f"), ""), /input evidence/u);
});

test("complete union paginates protocol and carrierless transactions once and preserves exact all-read IDs", async () => {
  const protocol = { id: `livenet:${hash("b")}`, txid: hash("b"), status: "confirmed", direction: "incoming", evidence: { blockHeight: 20 }, recipientAddresses: [address], actions: [{ txid: hash("b"), kind: "mail" }] };
  const initial = { model: "proof-computer-notifications-v1", network: "livenet", address, snapshotId: "ledger", maxEventId: 42, maxUpdatedAt: "stable",
    indexedThroughBlock: 30, indexedThroughBlockHash: hash("f"), items: [protocol], totalCount: 1, hasMore: false, nextCursor: "",
    readBoundary: { maxFirstSeenAt: "2026-10-23T00:00:00Z", maxEventId: 42 }, coverage: { complete: true, qualification: [] } };
  let history = [{ tx_hash: hash("a"), height: 10 }, { tx_hash: hash("b"), height: 20 }, { tx_hash: hash("c"), height: 30 }];
  const hydrated = [];
  const read = createAddressNotificationReader({ readProtocolPage: async () => initial, readAddressHistory: async () => history,
    verifyCheckpoint: async () => {}, canonicalHash: async () => hash("f"), now: () => 1_000,
    hydrateTransaction: async txid => { hydrated.push(txid); return transaction(txid, [output(address, 900)]); } });
  const first = await read("livenet", address, new URLSearchParams({ limit: "2" }));
  assert.equal(first.totalCount, 3); assert.equal(first.coverage.transactionOnlyCount, 2);
  assert.equal(first.limit, 2); assert.equal(first.pageSize, 2); assert.equal(first.start, 0); assert.equal(first.end, 2); assert.equal(first.pageCount, 2);
  assert.deepEqual(first.items.map(item => item.txid), [hash("c"), hash("b")]);
  assert.equal(first.items[1].actions.length, 2, "One card keeps its protocol action and monetary evidence.");
  assert.deepEqual(first.readBoundary.explicitIds.sort(), [`livenet:${hash("a")}`, `livenet:${hash("c")}`]);
  const second = await read("livenet", address, new URLSearchParams({ limit: "2", cursor: first.nextCursor }));
  assert.equal(second.hasMore, false); assert.deepEqual(second.items.map(item => item.txid), [hash("a")]);
  assert.equal(second.start, 2); assert.equal(second.end, 3); assert.equal(second.page, 1);
  assert.equal(new Set([...first.items, ...second.items].map(item => item.id)).size, 3);
  assert.ok(hydrated.includes(hash("a")), "A transaction absent from protocol/index rows is hydrated from Core.");
  history = [...history, { tx_hash: hash("d"), height: 5 }];
  await assert.rejects(read("livenet", address, new URLSearchParams({ cursor: first.nextCursor })), error => error.statusCode === 409);
  const refreshed = await read("livenet", address, new URLSearchParams());
  assert.ok(refreshed.readBoundary.explicitIds.includes(`livenet:${hash("d")}`), "A late-discovered historical transaction gets a new explicit read identity.");
});
