import assert from "node:assert/strict";
import test from "node:test";
import {
  DNS_SUBDOMAIN_ACTIVATION_HEIGHT,
  DNS_SUBDOMAIN_PREFIX,
  buildDnsSubdomainPayload,
  dnsOwnershipEpoch,
  dnsSubdomainAddressIdentity,
  dnsSubdomainLabelError,
  dnsSubdomainSelfSendAuthor,
  normalizeDnsSubdomainLabel,
  parseDnsSubdomainName,
  parseDnsSubdomainPayload,
  replayDnsSubdomains,
} from "../src/shared/protocol/dnsSubdomains.mjs";

const ALICE = "1F1zepCJ8VPcPoeMt6G4BPKuE3CYAxCKNY";
const BOB = "1F1p9UEHuH5KTFR7Zsx93Khdrqhj6t5nFv";
const RESOLVER = "bc1qfwytlzyr3ym3enz2eutwtjsf9kkf6uqkjydk3e";
const validateAddress = (value) => [ALICE, BOB, RESOLVER, RESOLVER.toUpperCase()].includes(value);
const options = { validateAddress };
const txid = (value) => value.toString(16).padStart(64, "0");
const root = (overrides = {}) => ({
  action: "register", name: "alice", ownerAddress: ALICE, resolverAddress: RESOLVER,
  txid: txid(1), blockHeight: 1, txIndex: 0, protocolVout: 1, recordOrdinal: 0,
  ...overrides,
});
const parent = root();
const epoch = dnsOwnershipEpoch(parent);
const record = (overrides = {}) => ({ action: "create", parent: "alice", label: "abc", epoch, resolver: null, ...overrides });
const child = (overrides = {}, recordOverrides = {}) => ({
  payload: buildDnsSubdomainPayload(record(recordOverrides), options),
  txid: txid(2), blockHeight: 2, txIndex: 0, protocolVout: 1, recordOrdinal: 0,
  inputAddresses: [ALICE], hasCoinbaseInput: false,
  outputs: [{ vout: 0, address: ALICE, valueSats: 546 }],
  ...overrides,
});
const replay = (subdomainEvents, rootEvents = [parent], overrides = {}) => replayDnsSubdomains({
  rootEvents, subdomainEvents, activationHeight: 1, validateAddress, ...overrides,
});
const wire = (text) => DNS_SUBDOMAIN_PREFIX + Buffer.from(text).toString("base64url");

test("one child level and normalized user labels have explicit bounds", () => {
  assert.equal(normalizeDnsSubdomainLabel(" ABC-1 "), "abc-1");
  assert.equal(dnsSubdomainLabelError("a"), "");
  assert.equal(dnsSubdomainLabelError("a".repeat(63)), "");
  for (const label of ["", "-abc", "abc-", "a_b", "a.b", "é", "a".repeat(64)]) assert.notEqual(dnsSubdomainLabelError(label), "");
  assert.deepEqual(parseDnsSubdomainName(" ABC.ALICE.POW "), { parent: "alice", label: "abc", name: "abc.alice.pow" });
  for (const name of ["alice.pow", "abc.alice", "a.b.alice.pow", "abc..pow", "abc.alice.pow."]) assert.equal(parseDnsSubdomainName(name), null);
});

test("canonical builder normalizes labels and Bech32 identity without changing Base58 identity", () => {
  const payload = buildDnsSubdomainPayload(record({ parent: " ALICE ", label: " ABC ", resolver: RESOLVER.toUpperCase() }), options);
  assert.deepEqual(parseDnsSubdomainPayload(payload, options), record({ resolver: RESOLVER }));
  assert.equal(dnsSubdomainAddressIdentity(RESOLVER.toUpperCase()), RESOLVER);
  assert.equal(dnsSubdomainAddressIdentity(ALICE), ALICE);
  assert.notEqual(dnsSubdomainAddressIdentity(ALICE.toLowerCase()), ALICE);
  assert.throws(() => buildDnsSubdomainPayload(record({ resolver: "not-an-address" }), options));
});

test("wire rejects alternate JSON, keys, casing, number encodings, invalid UTF-8 and noncanonical base64url", () => {
  const canonical = JSON.stringify(record());
  const badJson = [
    canonical.replace('"action":"create"', '"action":"create","action":"create"'),
    canonical.replace('"action":"create"', '"action":"create","unknown":1'),
    JSON.stringify({ parent: "alice", action: "create", label: "abc", epoch, resolver: null }),
    canonical.replace('"parent":"alice"', '"parent":"ALICE"'),
    canonical.replace('"recordOrdinal":0', '"recordOrdinal":-0'),
    canonical.replace('"protocolVout":1', '"protocolVout":1.0'),
    ` ${canonical}`,
    JSON.stringify(record({ resolver: RESOLVER.toUpperCase() })),
    JSON.stringify(record({ epoch: { ...epoch, extra: true } })),
    JSON.stringify(record({ epoch: { ...epoch, txid: epoch.txid.toUpperCase().replace(/0/u, "A") } })),
  ];
  for (const text of badJson) assert.equal(parseDnsSubdomainPayload(wire(text), options), null, text);
  const payload = wire(canonical);
  for (const bad of [payload + "=", payload + ":extra", DNS_SUBDOMAIN_PREFIX + "A", DNS_SUBDOMAIN_PREFIX + "_x", "pwdns1:sub2:" + payload.slice(DNS_SUBDOMAIN_PREFIX.length)]) assert.equal(parseDnsSubdomainPayload(bad, options), null);
  assert.equal(parseDnsSubdomainPayload(DNS_SUBDOMAIN_PREFIX + Buffer.from([0xc3, 0x28]).toString("base64url"), options), null);
  assert.equal(parseDnsSubdomainPayload(DNS_SUBDOMAIN_PREFIX + Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from(canonical)]).toString("base64url"), options), null, "UTF-8 BOM is not canonical JSON bytes.");
  assert.throws(() => buildDnsSubdomainPayload({ ...record(), unexpected: true }, options));
  assert.equal(parseDnsSubdomainPayload(wire(JSON.stringify(record({ resolver: BOB })))), null, "An absent address validator fails closed for explicit resolvers.");
});

test("revoke records omit resolver and retain the exact ownership epoch", () => {
  const revoked = { action: "revoke", parent: "alice", label: "abc", epoch };
  assert.deepEqual(parseDnsSubdomainPayload(buildDnsSubdomainPayload(revoked, options), options), revoked);
  assert.throws(() => buildDnsSubdomainPayload({ ...revoked, resolver: null }, options));
  assert.throws(() => buildDnsSubdomainPayload(record({ epoch: { ...epoch, protocolVout: -1 } }), options));
  assert.throws(() => buildDnsSubdomainPayload(record({ epoch: { ...epoch, recordOrdinal: Number.MAX_SAFE_INTEGER + 1 } }), options));
});

test("zero disables activation and a positive boundary excludes older records", () => {
  assert.equal(Number.isSafeInteger(DNS_SUBDOMAIN_ACTIVATION_HEIGHT) && DNS_SUBDOMAIN_ACTIVATION_HEIGHT >= 0, true);
  assert.equal(replay([child()], [parent], { activationHeight: 0 }).history[0].reason, "not-active");
  assert.equal(replay([child()], [parent], { activationHeight: 3 }).records.length, 0);
  assert.equal(replay([child({ blockHeight: 3 })], [parent], { activationHeight: 3 }).records.length, 1);
});

test("confirmed parent-owner self message registers the child and inherited resolution", () => {
  const result = replay([child()]);
  assert.equal(result.records.length, 1);
  assert.equal(result.records[0].name, "abc.alice.pow");
  assert.equal(result.records[0].ownerAddress, ALICE);
  assert.equal(result.records[0].resolverAddress, RESOLVER);
  assert.equal(result.records[0].inherited, true);
  assert.deepEqual(result.roots[0].ownershipEpoch, epoch);
  assert.equal(result.roots[0].ownershipEpochBlockHeight, 1);
  assert.equal(result.history[0].valid, true);
});

test("recipient and resolver cannot authorize a child and every input must prove the owner", () => {
  for (const event of [
    child({ inputAddresses: [BOB] }),
    child({ inputAddresses: [RESOLVER] }),
    child({ inputAddresses: [ALICE, BOB] }),
    child({ inputAddresses: [ALICE, null] }),
    child({ inputAddresses: [ALICE, "unknown"] }),
    child({ inputAddresses: [] }),
    child({ hasCoinbaseInput: true }),
  ]) {
    const result = replay([event]);
    assert.equal(result.records.length, 0);
    assert.equal(result.history[0].valid, false);
  }
  assert.equal(replay([child({ inputAddresses: [ALICE, ALICE] })]).records.length, 1);
});

test("self payment is exact, owner-directed, at least 546 and earlier than its own carrier", () => {
  const invalidOutputs = [
    [{ vout: 0, address: ALICE, valueSats: 545 }],
    [{ vout: 1, address: ALICE, valueSats: 546 }],
    [{ vout: 2, address: ALICE, valueSats: 546 }],
    [{ vout: 0, address: BOB, valueSats: 546 }],
    [{ vout: 0, address: ALICE, valueSats: 546.1 }],
    [{ vout: 0, address: ALICE, valueSats: Number.MAX_SAFE_INTEGER + 1 }],
    [{ vout: 0, address: ALICE, valueSats: "5.46e2" }],
    [{ vout: 0, address: ALICE, valueSats: "0546" }],
    [{ vout: 0, address: ALICE, valueSats: -1n }],
    [{ vout: 0, address: ALICE, valueSats: 273 }, { vout: 1, address: ALICE, valueSats: 273 }],
    [{ vout: 0, address: ALICE, valueSats: 546 }, { vout: 0, address: BOB, valueSats: 546 }],
  ];
  for (const outputs of invalidOutputs) assert.equal(replay([child({ outputs })]).records.length, 0);
  for (const valueSats of [546, 546n, "546", "9007199254740992"]) assert.equal(replay([child({ outputs: [{ vout: 0, address: ALICE, valueSats }] })]).records.length, 1);
});

test("valid uppercase Bech32 owner inputs and lowercased self outputs identify the same owner", () => {
  const bechParent = root({ ownerAddress: RESOLVER.toUpperCase() });
  const event = child({ inputAddresses: [RESOLVER.toUpperCase(), RESOLVER], outputs: [{ vout: 0, address: RESOLVER, valueSats: 546 }] });
  assert.equal(replay([event], [bechParent]).records[0].ownerAddress, RESOLVER);
  assert.equal(replay([child({ inputAddresses: [ALICE.toLowerCase()] })]).records.length, 0);
});

test("registration or a new ownership epoch must be confirmed in a previous block", () => {
  assert.equal(replay([child({ blockHeight: 1, txIndex: 1 })]).history[0].reason, "parent-epoch-not-previously-confirmed");
  assert.equal(replay([child()], []).history[0].reason, "parent-not-confirmed");
  const transfer = root({ action: "transfer", ownerAddress: BOB, resolverAddress: BOB, txid: txid(3), blockHeight: 2 });
  const event = child({ txid: txid(4), blockHeight: 2, txIndex: 1, inputAddresses: [BOB], outputs: [{ vout: 0, address: BOB, valueSats: 546 }] }, { epoch: dnsOwnershipEpoch(transfer) });
  assert.equal(replay([event], [parent, transfer]).history[0].reason, "parent-epoch-not-previously-confirmed");
});

test("confirmed resolver updates preserve the epoch and inherited children follow the new resolver", () => {
  const update = root({ action: "update", resolverAddress: BOB, txid: txid(3), blockHeight: 2, txIndex: 0 });
  const result = replay([child({ txid: txid(4), txIndex: 1 })], [update, parent]);
  assert.equal(result.records[0].resolverAddress, BOB);
  assert.equal(result.records[0].inherited, true);
  assert.deepEqual(result.records[0].epoch, epoch);
  assert.equal(result.roots[0].ownershipEpochBlockHeight, 1);
  const override = replay([child({}, { resolver: ALICE })], [parent, root({ ...update, blockHeight: 3 })]);
  assert.equal(override.records[0].resolverAddress, ALICE);
  assert.equal(override.records[0].inherited, false);
});

test("duplicate create, update, revoke and recreation have deterministic lifecycle rules", () => {
  const create = child();
  const duplicate = child({ txid: txid(3), blockHeight: 3 });
  const update = child({ txid: txid(4), blockHeight: 4, protocolVout: 3, recordOrdinal: 1 }, { action: "update", resolver: BOB });
  const revoke = child({ txid: txid(5), blockHeight: 5, payload: buildDnsSubdomainPayload({ action: "revoke", parent: "alice", label: "abc", epoch }, options) });
  const absentUpdate = child({ txid: txid(6), blockHeight: 6 }, { action: "update" });
  const recreate = child({ txid: txid(7), blockHeight: 7 });
  const result = replay([recreate, absentUpdate, revoke, update, duplicate, create]);
  assert.deepEqual(result.history.map((item) => item.reason), [null, "subdomain-already-active", null, null, "subdomain-not-active", null]);
  assert.equal(result.records[0].txid, recreate.txid);
  assert.equal(result.records[0].resolverAddress, RESOLVER);
  assert.equal(result.historicalRecords[0].status, "revoked");
  assert.equal(result.historicalRecords[0].resolverAddress, BOB);
  assert.equal(result.historicalRecords[0].txid, revoke.txid);
  assert.equal(result.historicalRecords[0].createdTxid, create.txid);
  assert.equal(result.history[2].state.txid, update.txid);
  assert.equal(result.history[2].state.createdTxid, create.txid);
  assert.equal(result.history[2].state.protocolVout, 3);
  assert.equal(result.history[2].state.recordOrdinal, 1);
  assert.equal(replay([update]).history[0].reason, "subdomain-not-active");
  assert.equal(replay([revoke]).history[0].reason, "subdomain-not-active");
});

test("transfer, sale and same-address transfer invalidate children without resurrecting old epochs", () => {
  const transfer = root({ action: "transfer", ownerAddress: BOB, resolverAddress: BOB, txid: txid(3), blockHeight: 3 });
  const returnToAlice = root({ action: "buy", txid: txid(4), blockHeight: 4 });
  const stale = child({ txid: txid(5), blockHeight: 5 });
  const fresh = child({ txid: txid(6), blockHeight: 6 }, { epoch: dnsOwnershipEpoch(returnToAlice) });
  const result = replay([child(), stale, fresh], [returnToAlice, parent, transfer]);
  assert.equal(result.history[1].reason, "stale-ownership-epoch");
  assert.equal(result.records.length, 1);
  assert.equal(result.records[0].txid, fresh.txid);
  assert.equal(result.historicalRecords[0].status, "invalidated");
  assert.equal(result.historicalRecords[0].invalidatedByTxid, transfer.txid);
  const sameAddress = root({ action: "transfer", txid: txid(7), blockHeight: 3 });
  assert.equal(replay([child()], [parent, sameAddress]).records.length, 0);
  assert.equal(replay([stale], [parent, sameAddress]).history[0].reason, "stale-ownership-epoch");
});

test("old-owner race is valid before a transfer and invalid afterward in exact canonical order", () => {
  const transfer = root({ action: "transfer", ownerAddress: BOB, resolverAddress: BOB, txid: txid(3), blockHeight: 2, txIndex: 1 });
  const before = replay([child()], [transfer, parent]);
  assert.equal(before.history[0].valid, true);
  assert.equal(before.records.length, 0);
  assert.equal(before.historicalRecords[0].status, "invalidated");
  const after = replay([child({ txIndex: 2 })], [transfer, parent]);
  assert.equal(after.records.length, 0);
  assert.equal(after.history[0].valid, false);
});

test("a single transaction cannot reuse one self payment for several child actions", () => {
  const first = child({ protocolVout: 1, recordOrdinal: 0 });
  const update = child({ protocolVout: 1, recordOrdinal: 1 }, { action: "update", resolver: BOB });
  const repeated = child({ protocolVout: 2, recordOrdinal: 0 });
  const result = replay([repeated, update, first]);
  assert.deepEqual(result.history.map((entry) => entry.reason), ["multiple-subdomain-carriers", "multiple-subdomain-carriers", "multiple-subdomain-carriers"]);
  assert.equal(result.records.length, 0);
  assert.equal(replay([first, first]).history.length, 1);
  const bigint = child({ outputs: [{ vout: 0, address: ALICE, valueSats: 546n }] });
  assert.equal(replay([bigint, bigint]).history.length, 1);
  const conflicting = { ...first, payload: child({}, { resolver: BOB }).payload };
  assert.equal(replay([first, conflicting]).history[0].reason, "conflicting-duplicate-record");
  const malformed = { ...update, payload: DNS_SUBDOMAIN_PREFIX + "invalid" };
  assert.equal(replay([first, malformed]).records.length, 0, "Malformed prefix carriers still count.");
});

test("raw self-send author helper requires complete carrier-count evidence and proves no parent authority", () => {
  assert.equal(dnsSubdomainSelfSendAuthor(null, options), null);
  assert.equal(dnsSubdomainSelfSendAuthor({ ...child(), subdomainCarrierCount: 1 }, options), ALICE);
  for (const subdomainCarrierCount of [undefined, 0, 2]) assert.equal(dnsSubdomainSelfSendAuthor({ ...child(), subdomainCarrierCount }, options), null);
  assert.equal(dnsSubdomainSelfSendAuthor({ ...child({ inputAddresses: [BOB], outputs: [{ vout: 0, address: BOB, valueSats: 546 }] }), subdomainCarrierCount: 1 }, options), BOB);
  assert.equal(replay([child({ inputAddresses: [BOB], outputs: [{ vout: 0, address: BOB, valueSats: 546 }] })]).records.length, 0);
});

test("public child and root projections sort by ASCII bytes, independent of locale", () => {
  const events = [child({ txid: txid(3), txIndex: 1 }, { label: "a0" }), child({}, { label: "a-a" })];
  const roots = [root({ name: "a0", txid: txid(5), txIndex: 2 }), root({ name: "a-a", txid: txid(4), txIndex: 1 }), parent];
  const result = replay(events, roots);
  assert.deepEqual(result.records.map((item) => item.label), ["a-a", "a0"]);
  assert.deepEqual(result.roots.map((item) => item.parent), ["a-a", "a0", "alice"]);
});

test("pending preview never mutates canonical records or authorizes subsequent pending actions", () => {
  const pendingCreate = child({ blockHeight: null, txIndex: null });
  const pendingUpdate = child({ txid: txid(3), blockHeight: null, txIndex: null }, { action: "update", resolver: BOB });
  const result = replay([pendingCreate, pendingUpdate]);
  assert.equal(result.records.length, 0);
  assert.equal(result.history.length, 0);
  assert.equal(result.pendingEvents[0].valid, true);
  assert.equal(result.pendingEvents[1].reason, "subdomain-not-active");
  const active = replay([child(), child({ txid: txid(3), blockHeight: null, txIndex: null }, { action: "update", resolver: BOB })]);
  assert.equal(active.records[0].resolverAddress, RESOLVER);
  assert.equal(active.pendingEvents[0].valid, true);
});

test("reorg replay restores pre-transfer children and rejects orphaned-epoch children", () => {
  const transfer = root({ action: "transfer", ownerAddress: BOB, resolverAddress: BOB, txid: txid(3), blockHeight: 3 });
  const bobChild = child({ txid: txid(4), blockHeight: 4, inputAddresses: [BOB], outputs: [{ vout: 0, address: BOB, valueSats: 546 }] }, { epoch: dnsOwnershipEpoch(transfer), label: "bob" });
  const chain = replay([child(), bobChild], [parent, transfer]);
  assert.deepEqual(chain.records.map((item) => item.name), ["bob.alice.pow"]);
  const reorg = replay([child(), bobChild], [parent]);
  assert.deepEqual(reorg.records.map((item) => item.name), ["abc.alice.pow"]);
  assert.equal(reorg.history[1].reason, "stale-ownership-epoch");
});

test("ambiguous/missing accepted root positions fail closed and invalid child positions stay rejected", () => {
  assert.throws(() => replay([], [root({ txIndex: null })]), /Incomplete accepted/u);
  assert.throws(() => replay([child({ blockHeight: 1 })]), /Ambiguous canonical DNS transaction/u);
  assert.throws(() => replay([], [parent, root({ action: "update", txid: txid(3) })]), /Ambiguous canonical DNS transaction/u);
  assert.throws(() => replay([child(), child({ blockHeight: 3 })]), /conflicting canonical positions/u);
  assert.equal(replay([child({ txIndex: null })]).history[0].reason, "invalid-canonical-position");
  assert.equal(replay([child({ blockHeight: null, protocolVout: -1 })]).pendingEvents[0].reason, "invalid-canonical-position");
});
