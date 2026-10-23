import test from "node:test";
import assert from "node:assert/strict";
import { notificationDnsHistoryRelations, notificationIdHistoryRelations } from "./notification-dns-history.mjs";
import { buildDnsSubdomainPayload, replayDnsSubdomains } from "../src/shared/protocol/dnsSubdomains.mjs";
import { buildDnsPageLinkPayload, replayDnsPageLinks } from "../src/shared/protocol/dnsPages.mjs";
import { buildDnsSubdomainPageLinkPayload, replayDnsSubdomainPageLinks } from "../src/shared/protocol/dnsSubdomainPages.mjs";
import { createOwnerOutputCommitmentFixture } from "../tests/fixtures/ownerOutputCommitment.mjs";

const OWNER = createOwnerOutputCommitmentFixture().ownerAddress;
const FIRST = "1F1zepCJ8VPcPoeMt6G4BPKuE3CYAxCKNY";
const SECOND = "bc1qfwytlzyr3ym3enz2eutwtjsf9kkf6uqkjydk3e";
const EXPLICIT = "1BoatSLRHtKNngkdXEeobR76b53LETtpyT";
const NEXT_OWNER = "1638Vn6KtmK8p5r4oGvAXq9nmZb1emU1DV";
const hash = number => number.toString(16).padStart(64, "0");
const validateAddress = value => [OWNER, FIRST, SECOND, EXPLICIT, NEXT_OWNER].includes(value);
const identity = event => ({ txid: event.txid, protocolVout: event.protocolVout, recordOrdinal: event.recordOrdinal });
const envelope = number => ({ txid: hash(number), blockHeight: number + 10, txIndex: 0, protocolVout: 1, recordOrdinal: 0 });
const root = (number = 1, action = "register", resolverAddress = FIRST, ownerAddress = OWNER) => ({
  ...envelope(number), name: "alice", action, ownerAddress, resolverAddress,
});
const firstRoot = root(), firstEpoch = identity(firstRoot);
const child = (number, action = "create", resolver = null, epoch = firstEpoch) => ({
  ...envelope(number), payload: buildDnsSubdomainPayload({ action, parent: "alice", label: "app", epoch,
    ...(action === "revoke" ? {} : { resolver }) }, { validateAddress }),
  subdomainCarrierCount: 1, inputAddresses: [OWNER], outputs: [{ vout: 0, address: OWNER, valueSats: 546 }],
});
const page = (number, action = "set", pageTxid = hash(500), epoch = firstEpoch) => ({
  ...envelope(number), payload: buildDnsPageLinkPayload({ action, name: "alice", epoch,
    ...(action === "set" ? { pageTxid } : {}) }), pageLinkCarrierCount: 1,
  inputAddresses: [OWNER], outputs: [{ vout: 0, address: OWNER, valueSats: 546 }],
});
const childPage = (number, childEvent, action = "set", pageTxid = hash(600), epoch = firstEpoch) => {
  const payload = buildDnsSubdomainPageLinkPayload({ action, parent: "alice", label: "app", epoch,
    child: identity(childEvent), ...(action === "set" ? { pageTxid } : {}) });
  return { ...envelope(number), ...createOwnerOutputCommitmentFixture({ payload, number }), payload, subdomainPageLinkCarrierCount: 1 };
};
const activity = event => ({ ...event, kind: `dns-${event.action}`, id: event.name,
  confirmed: true, blockIndex: event.txIndex, receiveAddress: event.resolverAddress });

function replay({ roots = [firstRoot], children = [], pages = [], childPages = [] } = {}) {
  const common = { rootEvents: roots, activationHeight: 1, validateAddress };
  const childState = replayDnsSubdomains({ ...common, subdomainEvents: children });
  const rootPages = replayDnsPageLinks({ ...common, pageLinkEvents: pages });
  const childLinks = replayDnsSubdomainPageLinks({ ...common,
    subdomainEvents: childState.history.filter(event => event.valid).map(event => ({ ...event, ...event.record })),
    pageLinkEvents: childPages });
  return {
    activity: roots.map(activity), subdomainEvents: childState.history,
    subdomainPendingEvents: childState.pendingEvents,
    subdomainHistoricalRecords: childState.historicalRecords, subdomains: childState.records,
    pageLinkEvents: rootPages.history, pageLinkPendingEvents: rootPages.pendingEvents,
    pageLinks: rootPages.records, pageLinkHistoricalRecords: rootPages.historicalRecords,
    subdomainPageLinkEvents: childLinks.history, subdomainPageLinks: childLinks.records,
    subdomainPageLinkHistoricalRecords: childLinks.historicalRecords, subdomainPageLinkPendingEvents: childLinks.pendingEvents,
  };
}

const contains = (result, event) => result.txids.includes(event.txid);
const ref = (result, event, source) => result.references.some(row => row.txid === event.txid && row.sourceTxid === source);

test("ID receiver changes and ownership transfers retain only event-time participants", () => {
  const registration = { ...activity(firstRoot), kind: "id-register" };
  const update = { ...activity(root(2, "update", SECOND)), kind: "id-update" };
  const transfer = { ...activity(root(3, "transfer", EXPLICIT, NEXT_OWNER)), kind: "id-transfer" };
  const later = { ...activity(root(4, "update", NEXT_OWNER, NEXT_OWNER)), kind: "id-update" };
  const history = [later, transfer, update, registration];
  assert.deepEqual(notificationIdHistoryRelations(history, FIRST).txids, [registration.txid, update.txid]);
  assert.deepEqual(notificationIdHistoryRelations(history, SECOND.toUpperCase()).txids, [update.txid, transfer.txid]);
  assert.deepEqual(notificationIdHistoryRelations(history, OWNER).txids, [registration.txid, update.txid, transfer.txid]);
  assert.deepEqual(notificationIdHistoryRelations(history, NEXT_OWNER).txids, [transfer.txid, later.txid]);
  assert.deepEqual(notificationIdHistoryRelations(history, FIRST.toLowerCase()).txids, []);
});

test("legacy and current marketplace purchases use accepted prior receivers without migrating old history", () => {
  for (const transferVersion of ["buy2", "buy3", "buy4", "buy5"]) {
    const sale = { ...activity(root(2, "buy", SECOND, NEXT_OWNER)), kind: "id-buy", transferVersion };
    const later = { ...activity(root(3, "update", EXPLICIT, NEXT_OWNER)), kind: "id-update" };
    const history = [{ ...activity(firstRoot), kind: "id-register" }, sale, later];
    assert.deepEqual(notificationIdHistoryRelations(history, FIRST).txids, [firstRoot.txid, sale.txid]);
    assert.deepEqual(notificationIdHistoryRelations(history, NEXT_OWNER).txids, [sale.txid, later.txid]);
  }
});

test("pending or rejected claims cannot mutate accepted routing state", () => {
  const pending = { ...activity(root(2, "update", EXPLICIT)), confirmed: false, status: "pending" };
  const rejected = { ...activity(root(3, "update", EXPLICIT)), valid: false, status: "rejected" };
  const update = activity(root(4, "update", SECOND));
  assert.deepEqual(notificationIdHistoryRelations([pending, update, activity(firstRoot), rejected], FIRST).txids,
    [firstRoot.txid, update.txid]);
  assert.deepEqual(notificationIdHistoryRelations([pending, update, activity(firstRoot), rejected], EXPLICIT).txids, [pending.txid]);
  assert.deepEqual(notificationIdHistoryRelations([pending, update, activity(firstRoot), rejected], SECOND).txids, [update.txid, pending.txid],
    "A still-pending update observes the final confirmed receiver without changing later accepted history.");
});

test("compound registry transactions use canonical output order and deduplicate transaction notifications", () => {
  const first = { ...activity(firstRoot), blockIndex: 0 };
  const second = { ...activity(root(2, "update", SECOND)), txid: first.txid, blockHeight: first.blockHeight, protocolVout: 2 };
  const third = { ...activity(root(3, "update", EXPLICIT)), txid: first.txid, blockHeight: first.blockHeight, protocolVout: 3 };
  const result = notificationIdHistoryRelations([third, first, second], SECOND);
  assert.deepEqual(result.txids, [first.txid]);
  assert.deepEqual(result.participants.map(row => [row.protocolVout, row.role]), [[2, "receiver"], [3, "previous-receiver"]],
    "Relationship evidence remains attached to its carrier within a compound transaction.");
});

test("missing canonical ordering or lifecycle coverage fails closed", () => {
  assert.throws(() => notificationIdHistoryRelations([{ ...activity(firstRoot), protocolVout: undefined }], FIRST), /canonical position/u);
  assert.throws(() => notificationIdHistoryRelations([{ ...activity(firstRoot), blockHeight: undefined }], FIRST), /canonical position/u);
  assert.throws(() => notificationIdHistoryRelations([activity(root(2, "update", SECOND))], FIRST), /incomplete ownership/u);
  assert.throws(() => notificationIdHistoryRelations([activity(firstRoot), activity(firstRoot)], FIRST), /ambiguous canonical/u);
  assert.throws(() => notificationIdHistoryRelations(new Array(100001), FIRST), /completeness bound/u);
});

test("DNS inherited receivers track the root at the child mutation time", () => {
  const create = child(2), changeRoot = root(3, "update", SECOND), update = child(4, "update", EXPLICIT), revoke = child(5, "revoke");
  const dns = replay({ roots: [firstRoot, changeRoot], children: [revoke, update, create] });
  const prior = notificationDnsHistoryRelations(dns, FIRST), inherited = notificationDnsHistoryRelations(dns, SECOND);
  assert.ok(contains(prior, create)); assert.ok(contains(prior, changeRoot)); assert.equal(contains(prior, update), false);
  assert.ok(contains(inherited, update), "An old child snapshot must use the resolver active immediately before its update.");
  assert.equal(contains(inherited, revoke), false);
  const explicit = notificationDnsHistoryRelations(dns, EXPLICIT);
  assert.ok(contains(explicit, update)); assert.ok(contains(explicit, revoke));
});

test("child page changes notify the historical inherited resolver without consulting current root fields", () => {
  const create = child(2), firstPage = childPage(3, create), changeRoot = root(4, "update", SECOND);
  const clear = childPage(5, create, "clear");
  const dns = replay({ roots: [firstRoot, changeRoot], children: [create], childPages: [firstPage, clear] });
  dns.subdomainPageLinkEvents = dns.subdomainPageLinkEvents.map(event => ({ ...event, currentOwnerAddress: NEXT_OWNER }));
  dns.records = [{ id: "alice", ownerAddress: NEXT_OWNER, receiveAddress: EXPLICIT }];
  assert.ok(contains(notificationDnsHistoryRelations(dns, FIRST), firstPage));
  assert.equal(contains(notificationDnsHistoryRelations(dns, FIRST), clear), false);
  assert.ok(contains(notificationDnsHistoryRelations(dns, SECOND), clear));
  assert.deepEqual(notificationDnsHistoryRelations(dns, NEXT_OWNER).txids, []);
  assert.ok(ref(notificationDnsHistoryRelations(dns, SECOND), clear, hash(600)), "A clear retains the previous source Page.");
});

test("root page replacement and clear preserve both old and new source references", () => {
  const firstPage = page(2), replacement = page(3, "set", hash(501)), clear = page(4, "clear");
  const result = notificationDnsHistoryRelations(replay({ pages: [clear, firstPage, replacement] }), FIRST);
  assert.ok(ref(result, firstPage, hash(500)));
  assert.ok(ref(result, replacement, hash(500))); assert.ok(ref(result, replacement, hash(501)));
  assert.ok(ref(result, clear, hash(501))); assert.equal(ref(result, clear, hash(500)), false);
  assert.equal(result.references.length, 4, "Repeated replay records must not duplicate references.");
});

test("separate set-clear cycles never reuse a previously cleared Page", () => {
  const first = page(2), firstClear = page(3, "clear"), second = page(4, "set", hash(501)), secondClear = page(5, "clear");
  const result = notificationDnsHistoryRelations(replay({ pages: [secondClear, firstClear, second, first] }), FIRST);
  assert.ok(ref(result, firstClear, hash(500))); assert.equal(ref(result, firstClear, hash(501)), false);
  assert.ok(ref(result, secondClear, hash(501))); assert.equal(ref(result, secondClear, hash(500)), false);
  assert.equal(result.references.length, 4);
});

test("revocation invalidates child Pages and recreation starts a separate relationship lifecycle", () => {
  const create = child(2, "create", EXPLICIT), oldPage = childPage(3, create), revoke = child(4, "revoke");
  const recreate = child(5, "create", SECOND), newPage = childPage(6, recreate, "set", hash(601));
  const dns = replay({ children: [create, revoke, recreate], childPages: [oldPage, newPage] });
  const old = notificationDnsHistoryRelations(dns, EXPLICIT);
  assert.ok(contains(old, revoke)); assert.equal(contains(old, recreate), false); assert.equal(contains(old, newPage), false);
  assert.ok(ref(old, revoke, hash(600))); assert.equal(ref(old, recreate, hash(600)), false);
  assert.ok(contains(notificationDnsHistoryRelations(dns, SECOND), newPage));
});

test("same-owner root transfers invalidate explicit child receivers and both Page lanes", () => {
  const create = child(2, "create", EXPLICIT), childLink = childPage(3, create), rootLink = page(4);
  const transfer = root(5, "transfer", FIRST, OWNER), newEpoch = identity(transfer);
  const recreate = child(6, "create", SECOND, newEpoch), newLink = childPage(7, recreate, "set", hash(601), newEpoch);
  const dns = replay({ roots: [firstRoot, transfer], children: [create, recreate], pages: [rootLink], childPages: [childLink, newLink] });
  const result = notificationDnsHistoryRelations(dns, EXPLICIT);
  assert.ok(contains(result, transfer)); assert.equal(contains(result, recreate), false); assert.equal(contains(result, newLink), false);
  assert.ok(ref(result, transfer, hash(500))); assert.ok(ref(result, transfer, hash(600)));
  assert.equal(ref(result, newLink, hash(600)), false);
});

test("transferring away and back does not resurrect prior child receivers or Page links", () => {
  const create = child(2, "create", EXPLICIT), oldPage = childPage(3, create), away = root(4, "transfer", SECOND, NEXT_OWNER);
  const back = root(5, "transfer", FIRST, OWNER), recreated = child(6, "create", SECOND, identity(back));
  const dns = replay({ roots: [firstRoot, away, back], children: [create, recreated], childPages: [oldPage] });
  const prior = notificationDnsHistoryRelations(dns, EXPLICIT);
  assert.ok(contains(prior, away)); assert.equal(contains(prior, back), false); assert.equal(contains(prior, recreated), false);
  assert.ok(ref(prior, away, hash(600))); assert.equal(ref(prior, back, hash(600)), false);
});

test("rejected child/page claims retain no authority or inherited receiver attribution", () => {
  const create = child(2), unauthorized = { ...child(3, "update", EXPLICIT), inputAddresses: [NEXT_OWNER] };
  const rejectedPage = { ...page(4), inputAddresses: [NEXT_OWNER] };
  const dns = replay({ children: [create, unauthorized], pages: [rejectedPage] });
  assert.equal(dns.subdomainEvents.find(event => event.txid === unauthorized.txid).valid, false);
  assert.equal(dns.pageLinkEvents[0].valid, false);
  const result = notificationDnsHistoryRelations(dns, EXPLICIT);
  assert.equal(contains(result, unauthorized), false); assert.equal(contains(result, rejectedPage), false);
  assert.equal(ref(result, rejectedPage, hash(500)), false);
});

test("pending DNS actions reference confirmed relationships independently without authorizing a pending chain", () => {
  const create = child(2), currentPage = childPage(3, create), currentRootPage = page(4);
  const pendingEvent = event => ({ ...event, blockHeight: null, txIndex: null });
  const update = pendingEvent(child(5, "update", EXPLICIT)), revoke = pendingEvent(child(6, "revoke"));
  const replacement = pendingEvent(childPage(7, create, "set", hash(601))), clear = pendingEvent(childPage(8, create, "clear"));
  const rootClear = pendingEvent(page(9, "clear"));
  const dns = replay({ children: [create, update, revoke], pages: [currentRootPage, rootClear], childPages: [currentPage, replacement, clear] });
  const pendingRootUpdate = { ...activity(root(10, "update", SECOND)), confirmed: false, status: "pending", blockHeight: null, txIndex: null };
  dns.activity.push(pendingRootUpdate);
  assert.equal(dns.subdomainPendingEvents.every(event => event.valid), true);
  assert.equal(dns.subdomainPageLinkPendingEvents.every(event => event.valid), true);
  const inherited = notificationDnsHistoryRelations(dns, FIRST), proposed = notificationDnsHistoryRelations(dns, EXPLICIT);
  for (const event of [update, revoke, replacement, clear, rootClear, pendingRootUpdate]) assert.ok(contains(inherited, event));
  assert.ok(contains(proposed, update));
  for (const event of [revoke, replacement, clear]) assert.equal(contains(proposed, event), false);
  assert.equal(contains(notificationDnsHistoryRelations(dns, SECOND), clear), false,
    "A pending root update must not change the resolver for another pending operation.");
  for (const event of [revoke, replacement, clear]) assert.ok(ref(inherited, event, hash(600)));
  assert.ok(ref(inherited, replacement, hash(601))); assert.equal(ref(inherited, clear, hash(601)), false);
  assert.ok(ref(inherited, rootClear, hash(500)));
});

test("pending root transfers expose affected confirmed child and Page relationships without invalidating them", () => {
  const create = child(2, "create", EXPLICIT), childLink = childPage(3, create), rootLink = page(4);
  const pendingTransfer = { ...activity(root(5, "transfer", SECOND, NEXT_OWNER)), confirmed: false, status: "pending", blockHeight: null };
  const pendingClear = { ...childPage(6, create, "clear"), blockHeight: null, txIndex: null };
  const dns = replay({ children: [create], pages: [rootLink], childPages: [childLink, pendingClear] });
  dns.activity.push(pendingTransfer);
  const result = notificationDnsHistoryRelations(dns, EXPLICIT);
  assert.ok(contains(result, pendingTransfer)); assert.ok(contains(result, pendingClear));
  assert.ok(ref(result, pendingTransfer, hash(500))); assert.ok(ref(result, pendingTransfer, hash(600)));
  assert.ok(ref(result, pendingClear, hash(600)), "The proposed transfer did not invalidate the confirmed child Page.");
});
