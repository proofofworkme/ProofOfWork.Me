import test from "node:test";
import assert from "node:assert/strict";
import { DNS_PAGE_LINK_ACTIVATION_HEIGHT, DNS_PAGE_LINK_PREFIX,
  buildDnsPageLinkPayload, parseDnsPageLinkPayload, replayDnsPageLinks } from "../src/shared/protocol/dnsPages.mjs";

const txid = n => n.toString(16).padStart(64, "0");
const validAddress = address => ["alice", "bob", "resolver", "other"].includes(address);
const epoch = { txid: txid(1), protocolVout: 1, recordOrdinal: 0 };
function root(action = "register", height = 10, owner = "alice", n = 1) {
  return { action, name: "alice", ownerAddress: owner, resolverAddress: "resolver",
    txid: txid(n), blockHeight: height, txIndex: 0, protocolVout: 1, recordOrdinal: 0 };
}
function link({ action = "set", n = 2, height = 11, owner = "alice", boundEpoch = epoch, target = txid(500), ...overrides } = {}) {
  return { txid: txid(n), payload: buildDnsPageLinkPayload({ action, name: "alice", epoch: boundEpoch,
    ...(action === "set" ? { pageTxid: target } : {}) }), blockHeight: height, txIndex: 1,
    protocolVout: 1, recordOrdinal: 0, pageLinkCarrierCount: 1,
    inputAddresses: [owner], outputs: [{ vout: 0, address: owner, valueSats: 546 }], ...overrides };
}
const replay = (pageLinkEvents, rootEvents = [root()], options = {}) => replayDnsPageLinks({ rootEvents,
  pageLinkEvents, activationHeight: 11, validateAddress: validAddress, ...options });

test("strict page1 encoding is root-only, bounded, canonical UTF-8/base64url JSON", () => {
  const input = { action: "set", name: " Alice.POW ", epoch, pageTxid: txid(500) };
  const payload = buildDnsPageLinkPayload(input);
  assert.deepEqual(parseDnsPageLinkPayload(payload), { ...input, name: "alice" });
  const clear = buildDnsPageLinkPayload({ action: "clear", name: "alice", epoch });
  assert.deepEqual(parseDnsPageLinkPayload(clear), { action: "clear", name: "alice", epoch });
  const encode = text => DNS_PAGE_LINK_PREFIX + Buffer.from(text).toString("base64url");
  const canonical = JSON.stringify({ action: "set", name: "alice", epoch, pageTxid: txid(500) });
  for (const text of [canonical + " ", canonical.replace('"alice"', '"Alice"'),
    canonical.replace('"name":"alice"', '"name":"alice","name":"alice"'),
    canonical.replace('"protocolVout":1', '"protocolVout":1.0'),
    canonical.replace('"action":"set","name":"alice"', '"name":"alice","action":"set"'),
    canonical.replace('"alice"', '"abc.alice"'), canonical.replace('"alice"', '"\\u0061lice"'),
    canonical.replace('"pageTxid"', '"unknown"')]) assert.equal(parseDnsPageLinkPayload(encode(text)), null);
  for (const malformed of [payload + "=", DNS_PAGE_LINK_PREFIX + "A", DNS_PAGE_LINK_PREFIX + "x".repeat(2050),
    DNS_PAGE_LINK_PREFIX + Buffer.from([0xff]).toString("base64url")]) assert.equal(parseDnsPageLinkPayload(malformed), null);
  assert.throws(() => buildDnsPageLinkPayload({ action: "clear", name: "alice", epoch, pageTxid: txid(5) }), /Invalid/u);
  assert.throws(() => buildDnsPageLinkPayload({ ...input, pageTxid: "AB".repeat(32) }), /Invalid/u);
});

test("set/replacement/clear retain inspectable history and leave root resolver unchanged", () => {
  const events = [link(), link({ n: 3, height: 12, target: txid(501) }), link({ action: "clear", n: 4, height: 13 })];
  const result = replay(events);
  assert.equal(result.records.length, 0); assert.equal(result.history.length, 3);
  assert.equal(result.historicalRecords[0].status, "replaced");
  assert.equal(result.historicalRecords[1].status, "cleared");
  assert.equal(result.historicalRecords[1].txid, events[1].txid, "clear retains the original link transaction");
  assert.equal(result.historicalRecords[1].blockHeight, events[1].blockHeight);
  assert.equal(result.historicalRecords[1].clearedByTxid, events[2].txid);
  assert.equal(result.history[2].txid, events[2].txid, "clear action keeps its own event position");
  assert.equal(result.roots[0].resolverAddress, "resolver");
  assert.equal(replay(events.slice(0, 2)).records[0].pageTxid, txid(501));
});

test("only the current root owner with complete inputs and pre-carrier integer self-payment may link", () => {
  for (const [mutation, reason] of [
    [{ owner: "bob" }, "unauthorized-owner"],
    [{ inputAddresses: ["alice", "bob"] }, "mixed-input-authors"],
    [{ inputAddresses: ["alice", null] }, "unknown-or-coinbase-input"],
    [{ hasCoinbaseInput: true }, "unknown-or-coinbase-input"],
    [{ outputs: [{ vout: 2, address: "alice", valueSats: 546 }] }, "missing-self-payment"],
    [{ outputs: [{ vout: 0, address: "resolver", valueSats: 546 }] }, "missing-self-payment"],
    [{ outputs: [{ vout: 0, address: "alice", valueSats: 545 }] }, "missing-self-payment"],
    [{ outputs: [{ vout: 0, address: "alice", valueSats: 546.1 }] }, "invalid-self-payment"],
    [{ outputs: [{ vout: 0, address: "alice", valueSats: "0546" }] }, "invalid-self-payment"],
    [{ pageLinkCarrierCount: 2 }, "multiple-page-link-carriers"],
  ]) {
    const result = replay([link(mutation)]);
    assert.equal(result.records.length, 0); assert.equal(result.history[0].reason, reason);
  }
  for (const amount of [546n, "546", 1000]) assert.equal(replay([link({ outputs: [{ vout: 0, address: "alice", valueSats: amount }] })]).records.length, 1);
});

test("malformed companion carriers count and cannot share a self-payment", () => {
  const first = link(); const malformed = { ...first, payload: DNS_PAGE_LINK_PREFIX + "bad", protocolVout: 2 };
  const result = replay([first, malformed]);
  assert.equal(result.records.length, 0); assert.equal(result.history.length, 2);
  assert.equal(result.history[0].reason, "multiple-page-link-carriers");
  assert.equal(result.history[1].reason, "invalid-payload");
  assert.equal(result.history[1].payload, malformed.payload);
});

test("transfers and buys open new epochs, including a transfer back to the same wallet", () => {
  const transfer = root("transfer", 12, "bob", 3);
  const back = root("buy", 14, "alice", 4);
  const result = replay([link(), link({ n: 5, height: 15 })], [root(), transfer, back]);
  assert.equal(result.records.length, 0); assert.equal(result.historicalRecords[0].status, "invalidated");
  assert.equal(result.history[1].reason, "stale-ownership-epoch");
  const currentEpoch = { txid: back.txid, protocolVout: 1, recordOrdinal: 0 };
  assert.equal(replay([link(), link({ n: 6, height: 15, boundEpoch: currentEpoch })], [root(), transfer, back]).records[0].txid, txid(6));
  assert.equal(replay([link()], [root(), root("transfer", 12, "alice", 3)]).records.length, 0);
});

test("resolver updates preserve links and epoch, same-block ownership cannot authorize a link", () => {
  const update = { ...root("update", 12, "alice", 3), resolverAddress: "other" };
  const result = replay([link()], [root(), update]);
  assert.equal(result.records.length, 1); assert.deepEqual(result.records[0].epoch, epoch);
  assert.equal(result.roots[0].resolverAddress, "other");
  assert.equal(replay([link({ height: 10 })], [root()], { activationHeight: 10 }).history[0].reason, "root-epoch-not-previously-confirmed");
});

test("pending links never route or authorize a later clear and reorg replay restores surviving state", () => {
  const result = replay([link({ height: null }), link({ action: "clear", n: 3, height: null })]);
  assert.equal(result.records.length, 0); assert.equal(result.pendingEvents[0].valid, true);
  assert.equal(result.pendingEvents[1].reason, "page-link-not-active");
  assert.equal(replay([link(), link({ action: "clear", n: 3, height: 12 })]).records.length, 0);
  assert.equal(replay([link()]).records.length, 1, "removed clear restores surviving confirmed link");
});

test("pinned opening, explicit disablement, and ambiguous canonical evidence fail closed", () => {
  assert.equal(DNS_PAGE_LINK_ACTIVATION_HEIGHT, 970426);
  const openingRoot = root("register", DNS_PAGE_LINK_ACTIVATION_HEIGHT - 1);
  const atOpening = event => replayDnsPageLinks({ rootEvents: [openingRoot],
    pageLinkEvents: [event], validateAddress: validAddress });
  assert.equal(atOpening(link({ height: DNS_PAGE_LINK_ACTIVATION_HEIGHT - 1 })).history[0].reason, "not-active");
  assert.equal(atOpening(link({ height: DNS_PAGE_LINK_ACTIVATION_HEIGHT })).records.length, 1);
  assert.equal(replay([link()], [root()], { activationHeight: 0 }).history[0].reason, "not-active");
  assert.equal(replay([link({ height: 10 })], [root()], { activationHeight: 11 }).history[0].reason, "not-active");
  assert.throws(() => replay([], [{ ...root(), txIndex: undefined }]), /Incomplete/u);
  assert.throws(() => replay([link({ txIndex: 0, height: 10 })]), /Ambiguous/u);
  const first = link(); const conflict = { ...first, payload: link({ target: txid(501) }).payload };
  assert.equal(replay([first, conflict]).history[0].reason, "conflicting-duplicate-record");
  assert.equal(replay([first, structuredClone(first)]).history.length, 1);
});
