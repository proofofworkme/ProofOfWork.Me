import test from "node:test";
import assert from "node:assert/strict";
import { readDnsPageLinkSnapshot, assertDnsPageLinkAction } from "./dnsPageLinkClient.mjs";

const OWNER = "1F1p9UEHuH5KTFR7Zsx93Khdrqhj6t5nFv";
const OTHER = "1F1zepCJ8VPcPoeMt6G4BPKuE3CYAxCKNY";
const RECEIVER = "bc1qfwytlzyr3ym3enz2eutwtjsf9kkf6uqkjydk3e";
const hash = number => number.toString(16).padStart(64, "0");
const epoch = { txid: hash(1), protocolVout: 1, recordOrdinal: 0 };
const options = { network: "livenet", validateAddress: address => [OWNER, OTHER, RECEIVER].includes(address) };
function fixture(active = false, nested = true) {
  const link = active ? { name: "alice.pow", network: "livenet", confirmed: true, status: "active", active: true,
    valid: true, ownerAddress: OWNER, epoch, ownershipEpoch: epoch, txid: hash(100),
    protocolVout: 2, recordOrdinal: 0, blockHeight: 12, pageTxid: hash(500) } : null;
  const root = { id: "alice", network: "livenet", confirmed: true, ownerAddress: OWNER,
    receiveAddress: RECEIVER, ownershipEpoch: epoch, ownershipEpochBlockHeight: 10,
    ...(nested ? { pageLink: link } : {}) };
  // Each serialized representation is independent, as it is over HTTP. A
  // mutation in one must not silently change the other test evidence.
  return JSON.parse(JSON.stringify({ network: "livenet", id: "alice", name: "alice.pow",
    coverage: { complete: true }, indexedThroughBlock: 20, checkpointHash: hash(2),
    record: root, records: [root], routable: true, status: "confirmed", pageLink: link,
    pageLinkEvents: active ? [{ name: "alice.pow", txid: link.txid, confirmed: true, valid: true,
      record: { action: "set", name: "alice", epoch, pageTxid: link.pageTxid } }] : [],
    pageLinkPendingEvents: [],
    pageLinkCoverage: { complete: true, model: "dns-page-link-core-raw-block-coverage-v1", network: "livenet",
      indexedThroughBlock: 20, checkpointHash: hash(2), witnessSha256: hash(3), pageLinkSha256: hash(4),
      activationHeight: 11, blockCount: 10 },
    pageLinkAdmission: { ready: true, network: "livenet", indexedThroughBlock: 20, checkpointHash: hash(2),
      activationHeight: 11, minSelfPaymentSats: 546, protocolPrefix: "pwdns1:page1:" } }));
}
const read = value => readDnsPageLinkSnapshot(value, " Alice.POW ", options);

test("coherent current roots accept null and active links with optional nested link representations", () => {
  for (const active of [false, true]) for (const nested of [false, true]) {
    const snapshot = read(fixture(active, nested));
    assert.equal(snapshot.root.ownerAddress, OWNER);
    assert.equal(snapshot.name, "alice.pow");
    assert.equal(snapshot.pageLink?.pageTxid ?? null, active ? hash(500) : null);
    assert.equal(snapshot.indexedThroughBlock, 20);
  }
});

test("single-record and collection authority must agree for owner, receiver, epoch, and epoch height", () => {
  for (const mutate of [
    value => { value.records[0].ownerAddress = OTHER; },
    value => { value.records[0].receiveAddress = OTHER; },
    value => { value.records[0].ownershipEpoch.txid = hash(9); },
    value => { value.records[0].ownershipEpoch.protocolVout = 2; },
    value => { value.records[0].ownershipEpoch.recordOrdinal = 1; },
    value => { value.records[0].ownershipEpochBlockHeight = 9; },
    value => { value.records[0].network = "testnet4"; },
    value => { value.record.ownerAddress = OTHER; },
    value => { value.record.receiveAddress = OTHER; },
    value => { value.record.ownershipEpoch.txid = hash(9); },
    value => { value.record.ownershipEpochBlockHeight = 9; },
  ]) {
    const value = fixture(); mutate(value);
    assert.throws(() => read(value), /confirmed|ownership|record|authority|match|snapshot/iu);
  }
  for (const mutate of [
    value => { value.records = []; },
    value => { value.records.push({ ...value.records[0] }); },
    value => { value.record.confirmed = false; },
    value => { value.record.id = "bob"; },
  ]) { const value = fixture(); mutate(value); assert.throws(() => read(value)); }
});

test("optional nested page-link evidence cannot contradict the top-level active or null link", () => {
  for (const mutate of [
    value => { value.record.pageLink = null; },
    value => { value.record.pageLink.pageTxid = hash(501); },
    value => { value.record.pageLink.txid = hash(101); },
    value => { value.record.pageLink.ownerAddress = OTHER; },
    value => { value.record.pageLink.epoch.txid = hash(9); },
    value => { value.record.pageLink.protocolVout = 3; },
    value => { value.record.pageLink.recordOrdinal = 1; },
    value => { value.record.pageLink.blockHeight = 13; },
    value => { value.record.pageLink.network = "testnet4"; },
    value => { value.record.pageLink.confirmed = false; },
    value => { value.record.pageLink.status = "invalidated"; },
  ]) {
    const value = fixture(true); mutate(value);
    assert.throws(() => read(value), /link|match|snapshot|record|authority/iu);
  }
  const absent = fixture(false);
  absent.record.pageLink = fixture(true).pageLink;
  assert.throws(() => read(absent));
});

test("active links must bind the confirmed root and the exact complete checkpoint", () => {
  for (const mutate of [
    value => { value.pageLink.ownerAddress = OTHER; delete value.record.pageLink; },
    value => { value.pageLink.epoch.txid = hash(9); delete value.record.pageLink; },
    value => { value.pageLink.blockHeight = 10; delete value.record.pageLink; },
    value => { value.pageLink.blockHeight = 21; delete value.record.pageLink; },
    value => { value.pageLink.confirmed = false; delete value.record.pageLink; },
    value => { value.pageLink.status = "invalidated"; delete value.record.pageLink; },
    value => { value.pageLinkCoverage.complete = false; },
    value => { value.pageLinkCoverage.checkpointHash = hash(8); },
    value => { value.pageLinkAdmission.indexedThroughBlock = 19; },
    value => { value.pageLinkCoverage.activationHeight = 0; },
    value => { value.pageLinkCoverage.blockCount = 9; },
  ]) { const value = fixture(true); mutate(value); assert.throws(() => read(value)); }
});

test("link actions require the current owner, current epoch, and valid target; clear needs an active link", () => {
  const snapshot = read(fixture(true));
  const request = { name: "alice.pow", pageTxid: hash(501) };
  assert.equal(assertDnsPageLinkAction(snapshot, request, OWNER, epoch), snapshot.root);
  assert.equal(assertDnsPageLinkAction(snapshot, { ...request, pageTxid: null }, OWNER, epoch), snapshot.root);
  assert.throws(() => assertDnsPageLinkAction(snapshot, request, OTHER), /owner/iu);
  assert.throws(() => assertDnsPageLinkAction(snapshot, { ...request, name: "bob.pow" }, OWNER), /owner/iu);
  assert.throws(() => assertDnsPageLinkAction(snapshot, request, OWNER, { ...epoch, txid: hash(9) }), /period|epoch/iu);
  assert.throws(() => assertDnsPageLinkAction(snapshot, { ...request, pageTxid: "bad" }, OWNER), /transaction/iu);
  assert.throws(() => assertDnsPageLinkAction(read(fixture()), { ...request, pageTxid: null }, OWNER), /active/iu);
});

test("valid pending actions for this root block repeat signing without changing canonical routing", () => {
  for (const pending of [{ valid: true, name: "alice.pow" }, { valid: true, record: { name: "alice" } }]) {
    const value = fixture(true); value.pageLinkPendingEvents = [pending];
    const snapshot = read(value);
    assert.equal(snapshot.pageLink.pageTxid, hash(500));
    assert.throws(() => assertDnsPageLinkAction(snapshot, { name: "alice", pageTxid: hash(501) }, OWNER), /pending/iu);
  }
  for (const pending of [{ valid: false, name: "alice.pow" }, { valid: true, name: "bob.pow", record: { name: "bob" } }]) {
    const value = fixture(true); value.pageLinkPendingEvents = [pending];
    assert.equal(assertDnsPageLinkAction(read(value), { name: "alice", pageTxid: hash(501) }, OWNER).ownerAddress, OWNER);
  }
});
