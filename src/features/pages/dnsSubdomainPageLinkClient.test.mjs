import test from "node:test";
import assert from "node:assert/strict";
import { readDnsSubdomainPageLinkSnapshot, assertDnsSubdomainPageLinkAction } from "./dnsSubdomainPageLinkClient.mjs";

const OWNER = "1F1p9UEHuH5KTFR7Zsx93Khdrqhj6t5nFv";
const OTHER = "1F1zepCJ8VPcPoeMt6G4BPKuE3CYAxCKNY";
const RECEIVER = "bc1qfwytlzyr3ym3enz2eutwtjsf9kkf6uqkjydk3e";
const hash = number => number.toString(16).padStart(64, "0");
const epoch = { txid: hash(1), protocolVout: 1, recordOrdinal: 0 };
const childLifecycle = { txid: hash(2), protocolVout: 1, recordOrdinal: 0 };
const options = { network: "livenet", validateAddress: address => [OWNER, OTHER, RECEIVER].includes(address) };
function fixture(active = false, nested = true) {
  const link = active ? { name: "app.alice.pow", parent: "alice", label: "app", network: "livenet", confirmed: true,
    status: "active", active: true, valid: true, ownerAddress: OWNER, epoch, child: childLifecycle,
    txid: hash(3), protocolVout: 2, recordOrdinal: 0, blockHeight: 12, pageTxid: hash(500) } : null;
  const root = { id: "alice", network: "livenet", confirmed: true, ownerAddress: OWNER,
    receiveAddress: RECEIVER, ownershipEpoch: epoch, ownershipEpochBlockHeight: 10 };
  const child = { name: "app.alice.pow", parent: "alice", label: "app", network: "livenet", confirmed: true,
    active: true, status: "active", ownerAddress: OWNER, receiveAddress: RECEIVER, resolver: null, epoch,
    childLifecycle, createdAtBlock: 11, createdTxid: hash(2), txid: hash(6), updatedTxid: hash(6),
    ...(nested ? { subdomainPageLink: link } : {}) };
  return JSON.parse(JSON.stringify({ network: "livenet", id: "app.alice", name: "app.alice.pow",
    parentRecord: root, record: child, records: [child], subdomains: [child],
    routable: true, status: "confirmed", coverage: { complete: true }, indexedThroughBlock: 20, checkpointHash: hash(8),
    subdomainCoverage: { complete: true, model: "dns-subdomain-core-raw-block-coverage-v1", network: "livenet",
      indexedThroughBlock: 20, checkpointHash: hash(8), witnessSha256: hash(9), childSha256: hash(10),
      activationHeight: 11, blockCount: 10 },
    subdomainAdmission: { ready: true },
    subdomainEvents: [{ ...childLifecycle, blockHeight: 11, txIndex: 2, valid: true, confirmed: true,
      record: { action: "create", parent: "alice", label: "app", epoch, resolver: null } }],
    subdomainPageLink: link, pageLink: link, subdomainPageLinkEvents: [], subdomainPageLinkPendingEvents: [],
    subdomainPageLinkCoverage: { complete: true, model: "dns-subdomain-page-link-core-raw-block-coverage-v1", network: "livenet",
      indexedThroughBlock: 20, checkpointHash: hash(8), witnessSha256: hash(11), subdomainPageLinkSha256: hash(12),
      activationHeight: 12, blockCount: 9 },
    subdomainPageLinkAdmission: { ready: true, network: "livenet", indexedThroughBlock: 20, checkpointHash: hash(8),
      activationHeight: 12, minSelfPaymentSats: 546, protocolPrefix: "pwdns1:subpage1:" } }));
}
const read = value => readDnsSubdomainPageLinkSnapshot(value, " APP.ALICE.POW ", options);

test("current child and confirmed root with complete matching coverage accept empty/active links", () => {
  for (const active of [false, true]) for (const nested of [false, true]) {
    const snapshot = read(fixture(active, nested));
    assert.equal(snapshot.name, "app.alice.pow");
    assert.deepEqual(snapshot.child.childLifecycle, childLifecycle);
    assert.equal(snapshot.pageLink?.pageTxid ?? null, active ? hash(500) : null);
  }
  assert.throws(() => readDnsSubdomainPageLinkSnapshot(fixture(), "alice.pow", options), /child/iu);
});

test("root owner/epoch and child CREATE lifecycle must agree across HTTP representations", () => {
  for (const mutate of [
    value => { value.parentRecord.ownerAddress = OTHER; },
    value => { value.parentRecord.ownershipEpoch.txid = hash(40); },
    value => { value.parentRecord.ownershipEpochBlockHeight = 11; },
    value => { value.parentRecord.confirmed = false; },
    value => { value.parentRecord.network = "testnet4"; },
    value => { value.record.childLifecycle.txid = hash(6); },
    value => { value.record.childLifecycle.protocolVout = 2; },
    value => { value.record.childLifecycle.recordOrdinal = 1; },
    value => { value.record.createdAtBlock = 9; },
    value => { value.record.ownerAddress = OTHER; },
    value => { value.record.resolver = OTHER; },
    value => { value.record.receiveAddress = OTHER; },
    value => { value.record.confirmed = false; },
    value => { value.record.status = "revoked"; },
    value => { value.records[0].txid = hash(60); },
    value => { value.records[0].updatedTxid = hash(60); },
    value => { value.subdomains[0].childLifecycle.txid = hash(60); },
    value => { value.records = []; },
    value => { value.records.push(value.records[0]); },
    value => { value.subdomains = []; },
    value => { value.subdomainEvents = []; },
    value => { value.subdomainEvents[0].record.action = "update"; },
    value => { value.subdomainEvents[0].blockHeight = 12; },
    value => { value.subdomainEvents[0].valid = false; },
    value => { value.subdomainEvents.push(value.subdomainEvents[0]); },
  ]) { const value = fixture(); mutate(value); assert.throws(() => read(value)); }
});

test("both child and page discovery must bind the same current complete checkpoint", () => {
  for (const mutate of [
    value => { value.subdomainCoverage.complete = false; },
    value => { value.subdomainCoverage.checkpointHash = hash(50); },
    value => { value.subdomainCoverage.indexedThroughBlock = 19; },
    value => { value.subdomainCoverage.childSha256 = "invalid"; },
    value => { value.subdomainCoverage.blockCount = 9; },
    value => { value.subdomainAdmission.ready = false; },
    value => { value.subdomainPageLinkCoverage.complete = false; },
    value => { value.subdomainPageLinkCoverage.network = "testnet4"; },
    value => { value.subdomainPageLinkCoverage.checkpointHash = hash(50); },
    value => { value.subdomainPageLinkCoverage.indexedThroughBlock = 19; },
    value => { value.subdomainPageLinkCoverage.activationHeight = 0; },
    value => { value.subdomainPageLinkCoverage.blockCount = 8; },
    value => { value.subdomainPageLinkCoverage.subdomainPageLinkSha256 = "invalid"; },
    value => { value.subdomainPageLinkAdmission.indexedThroughBlock = 19; },
    value => { value.subdomainPageLinkAdmission.minSelfPaymentSats = 0; },
    value => { value.subdomainPageLinkAdmission.protocolPrefix = "pwdns1:page1:"; },
    value => { value.subdomainPageLinkAdmission.ready = false; },
    value => { delete value.subdomainPageLink; },
    value => { delete value.subdomainPageLinkEvents; },
    value => { delete value.subdomainPageLinkPendingEvents; },
  ]) { const value = fixture(); mutate(value); assert.throws(() => read(value)); }
  const unavailable = fixture(); unavailable.subdomainPageLinkAdmission = { ready: false, reason: "Verified child catch-up is paused." };
  assert.throws(() => read(unavailable), /Verified child catch-up is paused/iu);
});

test("active link binds original CREATE rather than latest update; nested aliases cannot disagree", () => {
  for (const mutate of [
    value => { value.subdomainPageLink.child.txid = hash(6); },
    value => { value.subdomainPageLink.child.protocolVout = 2; },
    value => { value.subdomainPageLink.epoch.txid = hash(6); },
    value => { value.subdomainPageLink.ownerAddress = OTHER; },
    value => { value.subdomainPageLink.blockHeight = 11; },
    value => { value.subdomainPageLink.blockHeight = 21; },
    value => { value.subdomainPageLink.confirmed = false; },
    value => { value.subdomainPageLink.status = "invalidated"; },
    value => { value.subdomainPageLink.pageTxid = "bad"; },
    value => { value.record.subdomainPageLink = null; },
    value => { value.record.subdomainPageLink.child.txid = hash(6); },
    value => { value.record.subdomainPageLink.pageTxid = hash(501); },
    value => { value.pageLink = null; },
    value => { value.pageLink.child.txid = hash(6); },
    value => { value.pageLink.pageTxid = hash(501); },
  ]) { const value = fixture(true); mutate(value); assert.throws(() => read(value)); }
});

test("signing preflight fences owner, root epoch, child lifecycle, target and clear state", () => {
  const snapshot = read(fixture(true)), request = { name: "app.alice.pow", pageTxid: hash(501) };
  assert.deepEqual(assertDnsSubdomainPageLinkAction(snapshot, request, OWNER, epoch, childLifecycle), { root: snapshot.root, child: snapshot.child });
  assert.doesNotThrow(() => assertDnsSubdomainPageLinkAction(snapshot, { ...request, pageTxid: null }, OWNER));
  assert.throws(() => assertDnsSubdomainPageLinkAction(snapshot, request, OTHER), /owner/iu);
  assert.throws(() => assertDnsSubdomainPageLinkAction(snapshot, { ...request, name: "other.alice.pow" }, OWNER), /owner/iu);
  assert.throws(() => assertDnsSubdomainPageLinkAction(snapshot, request, OWNER, { ...epoch, txid: hash(4) }), /period/iu);
  assert.throws(() => assertDnsSubdomainPageLinkAction(snapshot, request, OWNER, epoch, { ...childLifecycle, txid: hash(4) }), /recreated/iu);
  assert.throws(() => assertDnsSubdomainPageLinkAction(snapshot, { ...request, pageTxid: "bad" }, OWNER), /transaction/iu);
  assert.throws(() => assertDnsSubdomainPageLinkAction(read(fixture()), { ...request, pageTxid: null }, OWNER), /active/iu);
});

test("pending evidence never changes routing; only current valid lifecycle blocks repeated action", () => {
  const pending = { name: "app.alice.pow", valid: true, record: { parent: "alice", label: "app", epoch, child: childLifecycle } };
  const value = fixture(true); value.subdomainPageLinkPendingEvents = [pending];
  assert.equal(read(value).pageLink.pageTxid, hash(500));
  assert.throws(() => assertDnsSubdomainPageLinkAction(read(value), { name: "app.alice.pow", pageTxid: hash(501) }, OWNER), /pending/iu);
  for (const update of [
    { ...pending, valid: false },
    { ...pending, record: { ...pending.record, child: { ...childLifecycle, txid: hash(6) } } },
    { ...pending, record: { ...pending.record, epoch: { ...epoch, txid: hash(6) } } },
    { ...pending, name: "other.alice.pow", record: { ...pending.record, label: "other" } },
  ]) {
    const stale = fixture(); stale.subdomainPageLinkPendingEvents = [update];
    const snapshot = read(stale); assert.equal(snapshot.pageLink, null);
    assert.doesNotThrow(() => assertDnsSubdomainPageLinkAction(snapshot, { name: "app.alice.pow", pageTxid: hash(501) }, OWNER));
  }
});
