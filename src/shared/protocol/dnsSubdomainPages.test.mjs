import test from "node:test";
import assert from "node:assert/strict";
import {
  DNS_SUBDOMAIN_PAGE_LINK_PREFIX, DNS_SUBDOMAIN_PAGE_LINK_ACTIVATION_HEIGHT,
  DNS_SUBDOMAIN_PAGE_LINK_PREDECESSOR_HASH, buildDnsSubdomainPageLinkPayload,
  parseDnsSubdomainPageLinkPayload, dnsSubdomainPageLinkSelfSendAuthor,
  replayDnsSubdomainPageLinks, normalizeDnsSubdomainPageLinkName,
} from "./dnsSubdomainPages.mjs";

const OWNER = "1F1p9UEHuH5KTFR7Zsx93Khdrqhj6t5nFv";
const OTHER = "1F1zepCJ8VPcPoeMt6G4BPKuE3CYAxCKNY";
const RECEIVER = "bc1qfwytlzyr3ym3enz2eutwtjsf9kkf6uqkjydk3e";
const hash = number => number.toString(16).padStart(64, "0");
const identity = event => ({ txid: event.txid, protocolVout: event.protocolVout, recordOrdinal: event.recordOrdinal });
const validateAddress = value => [OWNER, OTHER, RECEIVER].includes(value);
const root = (number = 1, blockHeight = 10, action = "register", ownerAddress = OWNER) => ({
  action, name: "alice", ownerAddress, resolverAddress: OWNER,
  txid: hash(number), blockHeight, txIndex: number, protocolVout: 1, recordOrdinal: 0,
});
const initialRoot = root(), epoch = identity(initialRoot);
const child = (number = 2, blockHeight = 11, action = "create", boundEpoch = epoch) => ({
  action, parent: "alice", label: "app", epoch: boundEpoch,
  ...(action === "revoke" ? {} : { resolver: null }),
  txid: hash(number), blockHeight, txIndex: number, protocolVout: 1, recordOrdinal: 0,
});
const initialChild = child(), childEpoch = identity(initialChild);
const record = (action = "set", child = childEpoch, boundEpoch = epoch) => ({
  action, parent: "alice", label: "app", epoch: boundEpoch, child,
  ...(action === "set" ? { pageTxid: hash(500) } : {}),
});
const link = (number = 3, blockHeight = 12, action = "set", child = childEpoch, boundEpoch = epoch) => ({
  payload: buildDnsSubdomainPageLinkPayload(record(action, child, boundEpoch)),
  txid: hash(number), blockHeight, txIndex: number, protocolVout: 1, recordOrdinal: 0,
  subdomainPageLinkCarrierCount: 1, inputAddresses: [OWNER],
  outputs: [{ vout: 0, address: OWNER, valueSats: 546 }],
});
const replay = options => replayDnsSubdomainPageLinks({ rootEvents: [initialRoot], subdomainEvents: [initialChild],
  activationHeight: 12, validateAddress, ...options });
const wire = text => DNS_SUBDOMAIN_PAGE_LINK_PREFIX + Buffer.from(text).toString("base64url");

test("subpage1 builders normalize child labels; wire parsing requires exact JSON and base64url", () => {
  const normalized = record(); normalized.parent = " ALICE "; normalized.label = " APP ";
  assert.deepEqual(parseDnsSubdomainPageLinkPayload(buildDnsSubdomainPageLinkPayload(normalized)), record());
  assert.equal(normalizeDnsSubdomainPageLinkName(" App.Alice.POW "), "app.alice.pow");
  for (const name of ["alice.pow", "a.b.alice.pow", "-app.alice.pow", "app..pow"]) assert.equal(normalizeDnsSubdomainPageLinkName(name), "");
  const json = JSON.stringify(record()), canonical = wire(json);
  for (const payload of [
    canonical + "=", wire(json + " "), wire(json.replace('"action":"set"', '"action":"set","action":"set"')),
    wire(json.replace('"action":"set","parent":"alice"', '"parent":"alice","action":"set"')),
    wire(json.replace('"label":"app"', '"label":"APP"')), wire(json.replace('"label":"app"', '"label":"\\u0061pp"')),
    wire(json.replace('"protocolVout":1', '"protocolVout":1.0')), wire(json.replace('"pageTxid"', '"extra":0,"pageTxid"')),
    DNS_SUBDOMAIN_PAGE_LINK_PREFIX + Buffer.from([0xff]).toString("base64url"),
    wire(JSON.stringify({ ...record(), child: { ...childEpoch, extra: 0 } })),
    wire(JSON.stringify({ ...record(), epoch: { ...epoch, protocolVout: 0x100000000 } })),
    wire(JSON.stringify({ ...record(), pageTxid: "ABC".repeat(21) + "D" })),
    wire(JSON.stringify({ ...record("clear"), pageTxid: hash(500) })),
    DNS_SUBDOMAIN_PAGE_LINK_PREFIX + "x".repeat(2100),
  ]) assert.equal(parseDnsSubdomainPageLinkPayload(payload), null, payload);
  const last = canonical.at(-1), alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
  if (canonical.length % 4 === 2 || canonical.length % 4 === 3) {
    const alternateBits = alphabet[alphabet.indexOf(last) | 1];
    if (alternateBits !== last) assert.equal(parseDnsSubdomainPageLinkPayload(canonical.slice(0, -1) + alternateBits), null);
  }
  assert.equal(DNS_SUBDOMAIN_PAGE_LINK_ACTIVATION_HEIGHT, 970499);
  assert.match(DNS_SUBDOMAIN_PAGE_LINK_PREDECESSOR_HASH, /^[0-9a-f]{64}$/u);
});

test("one owner self-payment is exact, individual, and before the protocol output", () => {
  for (const valueSats of [546, "546", 546n, "9007199254740992", 9007199254740992n]) {
    assert.equal(dnsSubdomainPageLinkSelfSendAuthor({ ...link(), outputs: [{ vout: 0, address: OWNER, valueSats }] }, { validateAddress }), OWNER);
  }
  for (const valueSats of [545, -1, 546.1, 9007199254740992, "0546", "546.0", "5.46e2", "-546", " 546", true]) {
    assert.equal(dnsSubdomainPageLinkSelfSendAuthor({ ...link(), outputs: [{ vout: 0, address: OWNER, valueSats }] }, { validateAddress }), null);
  }
  for (const outputs of [
    [{ vout: 2, address: OWNER, valueSats: 546 }],
    [{ vout: 0, address: OTHER, valueSats: 546 }],
    [{ vout: 0, address: OWNER, valueSats: 300 }, { vout: 1, address: OWNER, valueSats: 300 }],
    [{ vout: 0, address: OWNER, valueSats: 546 }, { vout: 0, address: OWNER, valueSats: 546 }],
    [{ vout: -1, address: OWNER, valueSats: 546 }],
  ]) assert.equal(dnsSubdomainPageLinkSelfSendAuthor({ ...link(), protocolVout: 2, outputs }, { validateAddress }), null);
});

test("authorized confirmed set, replacement and clear preserve inspectable history", () => {
  const first = link(), replacement = link(4, 13); replacement.payload = buildDnsSubdomainPageLinkPayload({ ...record(), pageTxid: hash(501) });
  const result = replay({ pageLinkEvents: [replacement, first] });
  assert.equal(result.records[0].name, "app.alice.pow");
  assert.equal(result.records[0].pageTxid, hash(501));
  assert.equal(result.historicalRecords[0].status, "replaced");
  assert.deepEqual(result.history.map(item => item.valid), [true, true]);
  const cleared = replay({ pageLinkEvents: [link(5, 14, "clear"), replacement, first] });
  assert.equal(cleared.records.length, 0);
  assert.deepEqual(cleared.historicalRecords.map(item => item.status), ["replaced", "cleared"]);
  assert.equal(replay({ pageLinkEvents: [link(5, 14, "clear")] }).history[0].reason, "page-link-not-active");
});

test("zero and pre-activation records fail closed without rewriting child authority", () => {
  assert.equal(replay({ activationHeight: 0, pageLinkEvents: [link()] }).history[0].reason, "not-active");
  assert.equal(replay({ activationHeight: 13, pageLinkEvents: [link()] }).history[0].reason, "not-active");
  assert.equal(replay({ activationHeight: 0, pageLinkEvents: [link()] }).children.length, 1);
});

test("every input must prove the current root owner; mixed/unknown/coinbase cannot authorize", () => {
  for (const [overrides, reason] of [
    [{ inputAddresses: [OWNER, OTHER] }, "mixed-input-authors"],
    [{ inputAddresses: [OTHER], outputs: [{ vout: 0, address: OTHER, valueSats: 546 }] }, "unauthorized-owner"],
    [{ inputAddresses: [null] }, "unknown-or-coinbase-input"],
    [{ inputAddresses: [] }, "unknown-or-coinbase-input"],
    [{ inputAddresses: ["unknown"] }, "unknown-or-coinbase-input"],
    [{ hasCoinbaseInput: true }, "unknown-or-coinbase-input"],
    [{ outputs: [{ vout: 0, address: OWNER, valueSats: 545 }] }, "missing-self-payment"],
  ]) assert.equal(replay({ pageLinkEvents: [{ ...link(), ...overrides }] }).history[0].reason, reason);
});

test("malformed matching carriers count; duplicate evidence cannot authorize an action", () => {
  const first = link(), malformed = { ...link(), protocolVout: 2, payload: DNS_SUBDOMAIN_PAGE_LINK_PREFIX + "!" };
  const result = replay({ pageLinkEvents: [first, malformed] });
  assert.equal(result.records.length, 0);
  assert.equal(result.history[0].reason, "multiple-subdomain-page-link-carriers");
  assert.equal(result.history[1].reason, "invalid-payload");
  assert.equal(replay({ pageLinkEvents: [{ ...first, subdomainPageLinkCarrierCount: 2 }] }).history[0].reason, "multiple-subdomain-page-link-carriers");
  assert.equal(replay({ pageLinkEvents: [first, { ...first }] }).records.length, 1);
  assert.equal(replay({ pageLinkEvents: [first, { ...first, rawPayloadHex: "ff" }] }).history[0].reason, "conflicting-duplicate-record");
});

test("absent children, stale CREATE identity and same-block creation do not route", () => {
  assert.equal(replay({ subdomainEvents: [], pageLinkEvents: [link()] }).history[0].reason, "subdomain-not-active");
  assert.equal(replay({ pageLinkEvents: [link(3, 12, "set", { ...childEpoch, recordOrdinal: 1 })] }).history[0].reason, "stale-subdomain-lifecycle");
  assert.equal(replay({ activationHeight: 11, pageLinkEvents: [link(3, 11)] }).history[0].reason, "subdomain-not-previously-confirmed");
});

test("resolver updates retain original CREATE identity and a confirmed content link", () => {
  const childUpdate = { ...child(4, 13, "update"), resolver: RECEIVER };
  const parentUpdate = { ...root(5, 13, "update"), resolverAddress: OTHER };
  const result = replay({ rootEvents: [parentUpdate, initialRoot], subdomainEvents: [childUpdate, initialChild],
    pageLinkEvents: [link(6, 13), link()] });
  assert.equal(result.records.length, 1);
  assert.deepEqual(result.children[0].childLifecycle, childEpoch);
  assert.equal(result.children[0].resolverAddress, RECEIVER);
  assert.deepEqual(result.records[0].child, childEpoch);
  assert.equal(result.history[1].valid, true);
  const latestUpdateBound = replay({ subdomainEvents: [initialChild, childUpdate],
    pageLinkEvents: [link(6, 14, "set", identity(childUpdate))] });
  assert.equal(latestUpdateBound.history[0].reason, "stale-subdomain-lifecycle");
});

test("revoke/recreate invalidates former links; reorg replay restores surviving lifecycle", () => {
  const revoke = child(4, 13, "revoke"), recreate = child(5, 14), fresh = link(7, 16, "set", identity(recreate));
  const result = replay({ subdomainEvents: [initialChild, revoke, recreate], pageLinkEvents: [link(), link(6, 15), fresh] });
  assert.equal(result.records[0].txid, hash(7));
  assert.equal(result.history[1].reason, "stale-subdomain-lifecycle");
  assert.equal(result.historicalRecords[0].invalidationReason, "subdomain-revoked");
  assert.deepEqual(result.children[0].childLifecycle, identity(recreate));
  assert.equal(replay({ pageLinkEvents: [link()] }).records[0].txid, hash(3));
  assert.equal(replay({ subdomainEvents: [initialChild, revoke], pageLinkEvents: [link()] }).records.length, 0);
});

test("direct transfers and purchases reset root epoch including same-owner cycles", () => {
  for (const action of ["transfer", "buy"]) {
    const transfer = root(4, 13, action), recreated = child(5, 14, "create", identity(transfer));
    const result = replay({ rootEvents: [initialRoot, transfer], subdomainEvents: [initialChild, recreated],
      pageLinkEvents: [link(), link(6, 15), link(7, 16, "set", identity(recreated), identity(transfer))] });
    assert.equal(result.history[1].reason, "stale-ownership-epoch");
    assert.equal(result.historicalRecords[0].invalidationReason, "root-ownership-change");
    assert.equal(result.records[0].txid, hash(7));
  }
  const toBob = root(4, 13, "transfer", OTHER), toAlice = root(5, 14, "transfer", OWNER);
  assert.equal(replay({ rootEvents: [initialRoot, toBob, toAlice], pageLinkEvents: [link(), link(6, 15)] }).history[1].reason, "stale-ownership-epoch");
});

test("pending set/clear is visibility only and cannot bootstrap pending state", () => {
  const pendingSet = { ...link(4, null), txIndex: null }, pendingClear = { ...link(5, null, "clear"), txIndex: null };
  const empty = replay({ pageLinkEvents: [pendingSet, pendingClear] });
  assert.equal(empty.records.length, 0);
  assert.equal(empty.pendingEvents[0].valid, true);
  assert.equal(empty.pendingEvents[1].reason, "page-link-not-active");
  const existing = replay({ pageLinkEvents: [link(), pendingClear] });
  assert.equal(existing.records[0].txid, hash(3));
  assert.equal(existing.pendingEvents[0].valid, true);
  const stale = replay({ subdomainEvents: [initialChild, child(6, 13, "revoke"), child(7, 14)], pageLinkEvents: [pendingSet] });
  assert.equal(stale.pendingEvents[0].reason, "stale-subdomain-lifecycle");
  const transferred = replay({ rootEvents: [initialRoot, root(6, 13, "transfer")], pageLinkEvents: [pendingSet] });
  assert.equal(transferred.pendingEvents[0].reason, "stale-ownership-epoch");
  const duplicatePending = replay({ pageLinkEvents: [link(), { ...link(), blockHeight: null, txIndex: null }] });
  assert.equal(duplicatePending.pendingEvents[0].reason, "confirmed-transaction-is-pending");
});

test("incomplete or ambiguous accepted canonical positions fail the entire projection", () => {
  for (const rootEvent of [{ ...initialRoot, txIndex: null }, { ...initialRoot, protocolVout: -1 },
    { ...initialRoot, recordOrdinal: 0.5 }]) assert.throws(() => replay({ rootEvents: [rootEvent] }), /accepted DNS root/iu);
  assert.throws(() => replay({ subdomainEvents: [{ ...initialChild, txIndex: undefined }] }), /accepted DNS child/iu);
  assert.throws(() => replay({ subdomainEvents: [{ ...initialChild, action: "update" }] }), /child lifecycle/iu);
  assert.throws(() => replay({ rootEvents: [initialRoot, { ...root(4, 13, "update"), ownerAddress: OTHER }] }), /changed.*owner/iu);
  assert.throws(() => replay({ subdomainEvents: [initialChild], pageLinkEvents: [{ ...link(), blockHeight: 11, txIndex: 2 }] }), /transaction position/iu);
  assert.throws(() => replay({ pageLinkEvents: [{ ...link(), blockHeight: 10, txIndex: 1, txid: initialRoot.txid }] }), /record position/iu);
  assert.throws(() => replay({ activationHeight: 1.2 }), /activation height/iu);
  assert.equal(replay({ pageLinkEvents: [{ ...link(), txIndex: undefined }] }).history[0].reason, "invalid-canonical-position");
});
