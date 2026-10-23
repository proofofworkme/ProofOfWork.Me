import test from "node:test";
import assert from "node:assert/strict";
import { qualifyNotificationDns } from "./notification-dns-authority.mjs";
import { notificationAction, notificationPayload } from "./notifications.mjs";
import { qualifyDnsPageLinkLogPayload } from "./dns-page-link-discovery.mjs";

const TXID = "01a4e0ee4a500a81424f17853b3221bad07774cb5a2129b790e156cc00ea4503";
const OWNER = "1KNkUBREnfno2BeV7QsBf8XCWZN6YFfxPH";
const HASH = "0000000000000000000084508a11e0d116ad44aa453ea1d624cab4cba9c200fb";
const BLOCK = "00000000000000000001c96938404a2d973d69172f079909d3e050daf3c83c02";
const PAGE = "8c2fd17b10a6550896035b9f725054d3c6e10c314911808d8f7aaa2955c3015b";
const EPOCH = { txid: "b29491911b58bd586ad156d94174b9ab93cedce5f21bf7106cb01c7ed3d4c2ef",
  protocolVout: 1, recordOrdinal: 0 };
const RAW_REASON = "work-amo-v5-raw-pwdns-invalid";

// Public Core-verified DNS snapshot at 972803: this exact carrier was accepted,
// while the earlier generic economic decoder stored it as an invalid alias.
function fixture(lane = "pageLink", action = "set") {
  const child = lane === "subdomain", childPage = lane === "subdomainPageLink";
  const prefix = child ? "pwdns1:sub1:" : childPage ? "pwdns1:subpage1:" : "pwdns1:page1:";
  const record = { action, ...(child || childPage ? { parent: "armyofyouth", label: "app" } : { name: "armyofyouth" }),
    epoch: EPOCH, ...(childPage ? { child: { ...EPOCH, txid: "22".repeat(32) } } : {}),
    ...(child ? { resolver: null } : action === "set" ? { pageTxid: PAGE } : {}) };
  const payload = prefix + Buffer.from(JSON.stringify(record)).toString("base64url");
  const name = `${child || childPage ? "app." : ""}armyofyouth.pow`;
  const state = { name, txid: TXID, createdTxid: TXID, status: "active" };
  const event = { txid: TXID, blockHeight: 970549, txIndex: 3028, protocolVout: 2, recordOrdinal: 0,
    network: "livenet", confirmed: true, valid: true, status: "accepted", reason: null,
    payload, rawPayloadHex: Buffer.from(payload).toString("hex"), decodeValid: true, record, state };
  const item = { eventId: 4751691, txid: TXID, network: "livenet", protocol: "pwdns1",
    blockHeight: event.blockHeight, blockHash: BLOCK, blockIndex: event.txIndex,
    protocolVout: 2, recordOrdinal: 0, confirmed: true, confirmationStatus: "confirmed", status: "confirmed",
    valid: false, applied: false, kind: "protocol-event-invalid", payload, reason: RAW_REASON,
    reasonCode: RAW_REASON, detail: "Protocol Event Invalid confirmed", senderAddress: OWNER,
    amountSats: 0, minerFeeSats: 0, stateDelta: { economicOutputs: [] } };
  const checkpoint = { network: "livenet", indexedThroughBlock: 972803, checkpointHash: HASH };
  const dns = { ...checkpoint,
    [`${lane}Coverage`]: { ...checkpoint, complete: true },
    [`${lane}Admission`]: { ...checkpoint, ready: true, ...(childPage ? { authorityModel: "owner-signed-all-outputs-v1" } : {}) },
    [`${lane}Events`]: [event], [`${lane}PendingEvents`]: [], [`${lane}HistoricalRecords`]: [],
    [child ? "subdomains" : `${lane}s`]: [state] };
  const history = { ...checkpoint, indexedThroughBlockHash: HASH, totalCount: 1, offset: 0,
    maxEventId: item.eventId, hasMore: false, items: [item] };
  return { item, event, dns, history, lane };
}
function result(f) {
  return qualifyNotificationDns(f.history, f.dns).items[0];
}

test("exact live DNS Page carrier uses accepted replay while retaining its legacy decoder and economics", () => {
  const f = fixture();
  const original = structuredClone(f);
  const mail = { ...f.item, eventId: 4751690, protocolVout: 1, protocol: "pwm1", kind: "mail",
    payload: "pwm1:m:hello", reason: undefined, valid: true, applied: true };
  f.history.items.unshift(mail);
  const qualified = qualifyNotificationDns(f.history, f.dns);
  assert.equal(qualified.items[0], mail);
  const row = qualified.items[1];
  assert.equal(row.kind, "dns-page-link-set");
  assert.equal(row.valid, true); assert.equal(row.applied, true); assert.equal(row.reason, null);
  assert.equal(row.decodedKind, "protocol-event-invalid");
  assert.equal(row.decodedValid, false); assert.equal(row.decodedReason, RAW_REASON);
  assert.equal(row.amountSats, 0); assert.equal(row.minerFeeSats, 0);
  assert.deepEqual(row.stateDelta, original.item.stateDelta);
  assert.deepEqual(f.item, original.item, "source rows remain immutable");
  const notifications = notificationPayload(qualified, OWNER);
  assert.equal(notifications.totalCount, 1); assert.equal(notifications.items.length, 1);
  assert.equal(notifications.items[0].actions.length, 2);
  assert.equal(notifications.items[0].app, "DNS");
  assert.equal(notifications.items[0].status, "confirmed");
  assert.equal(notifications.items[0].kind, "dns-page-link-set");
  assert.equal(notifications.items[0].label, "DNS page link");
  assert.equal(notifications.items[0].evidence.reason, null);
  assert.equal(notifications.items[0].evidence.qualification.valid, true);
  assert.equal(notifications.items[0].evidence.qualification.status, "active");
  assert.equal(notifications.items[0].evidence.decodedReason, RAW_REASON);
  assert.deepEqual(notifications.items[0].relatedTxids.includes(PAGE), true);
  const log = qualifyDnsPageLinkLogPayload(original.history, original.dns).items[0];
  assert.equal(log.kind, "protocol-event-invalid"); assert.equal(log.valid, false);
  assert.equal(log.reason, RAW_REASON, "shared Log economic audit behavior remains intact");
});

test("cleared, replaced, invalidated links remain accepted history and clear remains an unlink", () => {
  for (const status of ["cleared", "replaced", "invalidated"]) {
    const f = fixture(); f.dns.pageLinks = [];
    f.dns.pageLinkHistoricalRecords = [{ ...f.event.state, status,
      invalidatedByTxid: "11".repeat(32), invalidatedAtBlock: 970600 }];
    const row = result(f), action = notificationAction(row, OWNER);
    assert.equal(action.status, "confirmed"); assert.equal(action.evidence.applied, true);
    assert.equal(action.evidence.qualification.status, status);
    assert.equal(row.invalidatedByTxid, "11".repeat(32));
  }
  const clear = fixture("pageLink", "clear"); clear.dns.pageLinks = [];
  assert.equal(notificationAction(result(clear), OWNER).label, "DNS page unlink");
  assert.equal(result(clear).dnsAuthority.status, "cleared");
});

test("rejected attempts stay invalid and pending has no confirmed applied claim", () => {
  const rejected = fixture();
  rejected.event.valid = false; rejected.event.status = "rejected"; rejected.event.reason = "unauthorized-owner";
  const invalid = notificationAction(result(rejected), OWNER);
  assert.equal(invalid.status, "invalid"); assert.equal(invalid.evidence.applied, false);
  assert.equal(invalid.evidence.reason, "unauthorized-owner"); assert.equal(invalid.evidence.decodedReason, RAW_REASON);
  const pending = fixture();
  Object.assign(pending.event, { confirmed: false, blockHeight: null, txIndex: null, status: "pending", state: null });
  pending.dns.pageLinkPendingEvents = [pending.event]; pending.dns.pageLinkEvents = []; pending.dns.pageLinks = [];
  Object.assign(pending.item, { confirmed: false, blockHeight: null, blockIndex: null, blockHash: null,
    status: "pending", confirmationStatus: "pending" });
  const action = notificationAction(result(pending), OWNER);
  assert.equal(action.status, "pending"); assert.equal(action.evidence.applied, undefined);
  assert.equal(action.evidence.qualification.status, "pending");
  for (const status of ["dropped", "orphaned"]) {
    pending.item.confirmationStatus = status;
    assert.equal(notificationAction(result(pending), OWNER).status, status);
  }
  for (const status of ["dropped", "orphaned"]) {
    const removed = fixture();
    removed.item.confirmationStatus = status;
    removed.dns.pageLinkEvents = [];
    const absent = result(removed);
    assert.equal(absent.kind, "protocol-event-invalid");
    assert.equal(absent.reason, RAW_REASON);
    assert.equal(absent.applied, undefined); assert.equal(absent.protocolValid, undefined);
    assert.equal(absent.dnsAuthority.ready, false);
    assert.equal(notificationAction(absent, OWNER).status, status);
    assert.equal(qualifyNotificationDns(removed.history, null).items[0].dnsAuthority.ready, false,
      "removed-only history does not require a current replay entry or snapshot");
    removed.history.items.push(fixture().item);
    assert.throws(() => result(removed), error => error.statusCode === 503,
      "a missing confirmed carrier still fails closed in mixed history");
  }
});

test("child lifecycle and child Page carriers qualify independently without prefix collision", () => {
  for (const [lane, action, kind] of [
    ["subdomain", "create", "dns-subdomain-create"], ["subdomain", "update", "dns-subdomain-update"],
    ["subdomain", "revoke", "dns-subdomain-revoke"], ["subdomainPageLink", "set", "dns-subdomain-page-link-set"],
    ["subdomainPageLink", "clear", "dns-subdomain-page-link-clear"],
  ]) {
    const f = fixture(lane, action), row = result(f);
    assert.equal(row.kind, kind); assert.equal(notificationAction(row, OWNER).status, "confirmed");
    assert.equal(row.name, "app.armyofyouth.pow");
    f.item.kind = kind;
    assert.equal(result(f).kind, kind, "canonical child Page kind is not sent through child resolver replay");
    f.item.payload += "changed";
    assert.throws(() => result(f), error => error.statusCode === 503 && /bytes/u.test(error.message));
    f.item.kind = "protocol-event-invalid";
    f.item.payload = { rawRecordParts: [{ payloadHex: f.event.rawPayloadHex }] };
    assert.equal(result(f).dnsAuthority.valid, true, "raw hex-only child carriers require full family replay");
    f.dns[`${lane}Coverage`].complete = false;
    assert.throws(() => result(f), error => error.statusCode === 503,
      "raw hex-only child records must not bypass the shared Log readiness guard");
  }
});

test("only exact network, checkpoint, position, bytes and ready complete replay can override a decoder", () => {
  const mutations = [
    f => { f.dns.network = "testnet"; }, f => { delete f.item.network; },
    f => { f.dns.checkpointHash = BLOCK; }, f => { f.dns.pageLinkCoverage.complete = false; },
    f => { f.dns.pageLinkAdmission.ready = false; }, f => { f.dns.pageLinkCoverage.checkpointHash = BLOCK; },
    f => { f.dns.pageLinkAdmission.indexedThroughBlock--; }, f => { f.dns.pageLinkEvents = []; },
    f => { f.dns.pageLinkEvents.push({ ...f.event }); }, f => { f.event.network = "testnet"; },
    f => { f.event.blockHash = HASH; }, f => { f.item.protocolVout++; }, f => { f.item.recordOrdinal++; },
    f => { f.item.blockIndex++; }, f => { f.item.blockHeight++; }, f => { delete f.item.blockHash; },
    f => { f.item.payload += "changed"; }, f => { f.item.rawPayloadHex = f.event.rawPayloadHex + "00"; },
    f => { f.item.confirmed = false; },
  ];
  for (const mutate of mutations) {
    const f = fixture(); mutate(f);
    assert.throws(() => result(f), error => error.statusCode === 503, String(mutate));
  }
  const nested = fixture(); nested.item.payload = { rawRecordParts: [{ payloadHex: nested.event.rawPayloadHex }] };
  assert.equal(result(nested).valid, true);
  nested.item.payload.rawRecordParts[0].payloadHex += "00";
  assert.throws(() => result(nested), /bytes/u);
  const unrelated = { items: [{ protocol: "pwm1", kind: "mail", memo: "hello" }] };
  assert.equal(qualifyNotificationDns(unrelated, null), unrelated);
  const failedAuthority = { ...result(fixture()), dnsAuthority: { ready: false, valid: true, reason: "unavailable" } };
  assert.equal(notificationAction(failedAuthority, OWNER).status, "unavailable");
  failedAuthority.dnsAuthority = { ready: true, valid: false, reason: "rejected" };
  assert.equal(notificationAction(failedAuthority, OWNER).status, "invalid");
});
