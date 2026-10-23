import test from "node:test";
import assert from "node:assert/strict";
import { validateNotificationsResponse } from "./notificationsResponse.mjs";
const txid = "1".repeat(64), otherTxid = "2".repeat(64);
const query = { network: "livenet", address: "1AbCdEf" };
function action(patch = {}) {
  return { id: `livenet:${txid}:pwm1:1:0`, txid, app: "Mail", label: "Message received", detail: "", kind: "message",
    direction: "incoming", status: "pending", protocolVout: 1, recordOrdinal: 0, createdAt: "2026-10-23T00:00:00Z",
    actorAddress: "1Sender", recipientAddresses: [query.address], relatedTxids: [],
    evidence: { protocol: "pwm1", valid: true, chainStatus: "pending", sourceEventId: 1 },
    target: { workspace: "inbox", txid }, ...patch };
}
function fixture() {
  const row = { ...action(), id: `livenet:${txid}`, firstSeenAt: "2026-10-23T00:00:00Z", maxEventId: 2, actions: [action()] };
  return { model: "proof-computer-notifications-v1", ...query, items: [row], nextCursor: "", hasMore: false, totalCount: 1,
    snapshotId: "snapshot", indexedThroughBlock: 100, indexedThroughBlockHash: otherTxid,
    coverage: { complete: true, qualification: [], scope: "indexed-computer-actions", pending: "best-effort" },
    readBoundary: { maxFirstSeenAt: row.firstSeenAt, maxEventId: 2 } };
}
test("pending-to-confirmed uses one unchanged transaction identity with exact compound evidence", () => {
  const response = fixture();
  const exact = "123456789012345678901234";
  response.items[0].actions.push(action({ app: "Wallet", kind: "token-transfer", protocolVout: 2,
    evidence: { protocol: "pwt1", valid: false, applied: false, chainStatus: "confirmed", qualification: { ready: false, reason: "Historical replay required" }, amounts: { amountSubatoms: exact } } }));
  const pending = validateNotificationsResponse(response, query);
  assert.equal(pending.items[0].actions[1].evidence.amounts.amountSubatoms, exact);
  response.items[0].status = "confirmed"; response.items[0].evidence.chainStatus = "confirmed";
  const confirmed = validateNotificationsResponse(response, query);
  assert.equal(confirmed.items[0].id, pending.items[0].id);
  assert.deepEqual(confirmed.items[0].actions[1].evidence.qualification, { ready: false, reason: "Historical replay required" });
});
test("wrong network, address case, malformed cursor and missing coverage fail without inventing empty state", () => {
  for (const mutate of [
    value => { value.network = "testnet4"; }, value => { value.address = query.address.toLowerCase(); },
    value => { value.coverage = null; }, value => { value.coverage.complete = undefined; },
    value => { value.coverage.qualification = [{}]; }, value => { value.coverage.localActions = {}; },
    value => { value.totalCount = 0; }, value => { value.totalCount = NaN; }, value => { value.hasMore = true; value.nextCursor = ""; },
    value => { value.nextCursor = {}; }, value => { value.snapshotId = ""; },
  ]) { const response = fixture(); mutate(response); assert.throws(() => validateNotificationsResponse(response, query), /coverage/); }
});
test("malformed or cross-transaction constituent actions cannot crash or misattribute the timeline", () => {
  for (const mutate of [
    value => { value.items[0].actions = {}; }, value => { value.items[0].actions = []; },
    value => { value.items[0].actions[0].evidence = null; }, value => { value.items[0].actions[0].evidence.qualification = []; },
    value => { value.items[0].actions[0].evidence.valid = "true"; }, value => { value.items[0].actions[0].txid = otherTxid; },
    value => { value.items[0].actions[0].label = {}; }, value => { value.items[0].actions[0].status = "success"; },
    value => { value.items[0].actions[0].recipientAddresses = [{}]; }, value => { value.items[0].actions[0].relatedTxids = ["bad"]; },
    value => { value.items[0].target.txid = "bad"; }, value => { value.items[0].id += ":another"; },
    value => { value.items[0].protocolVout = -1; }, value => { value.items[0].maxEventId = "2"; },
    value => { value.items[0].firstSeenAt = "bad"; }, value => { value.readBoundary.maxEventId = -1; },
  ]) { const response = fixture(); mutate(response); assert.throws(() => validateNotificationsResponse(response, query), /incomplete/); }
});
test("duplicate groups fail while nullable qualification and absent optional display fields remain readable", () => {
  const response = fixture();
  response.items.push(structuredClone(response.items[0])); response.totalCount = 2;
  assert.throws(() => validateNotificationsResponse(response, query), /incomplete/);
  response.items.pop(); response.totalCount = 1;
  response.items[0].evidence.qualification = null; response.items[0].evidence.reason = null;
  delete response.items[0].actions;
  assert.equal(validateNotificationsResponse(response, query), response);
});

test("ID responses bind canonical name to a registration root without accepting current-wallet substitution", () => {
  const idQuery = { network: "livenet", id: "alice" };
  const response = { ...fixture(), address: null, scope: { type: "id", id: "alice", registrationTxid: otherTxid }, scopeKey: `id:${otherTxid}` };
  assert.equal(validateNotificationsResponse(response, idQuery), response);
  for (const patch of [
    { address: query.address }, { scopeKey: `id:${txid}` }, { scope: undefined },
    { scope: { ...response.scope, id: "bob" } }, { scope: { ...response.scope, registrationTxid: "invalid" } },
    { scope: { type: "address", address: query.address } },
  ]) assert.throws(() => validateNotificationsResponse({ ...response, ...patch }, idQuery), /coverage/);
  assert.throws(() => validateNotificationsResponse(response, query), /coverage/);
  const scopedAddress = { ...fixture(), scope: { type: "address", address: query.address }, scopeKey: `address:${query.address}` };
  assert.equal(validateNotificationsResponse(scopedAddress, query), scopedAddress);
  assert.throws(() => validateNotificationsResponse({ ...scopedAddress, scopeKey: `address:${query.address.toLowerCase()}` }, query), /coverage/);
});
test("raw transfers retain exact multiple input/output evidence and nullable event fences", () => {
  const response = fixture();
  const row = response.items[0];
  Object.assign(row, { app: "computer", kind: "transfer", protocolVout: null, recordOrdinal: null, firstSeenAt: null, maxEventId: null,
    senderAddresses: ["1Sender", "1Other"], actorAddress: null,
    evidence: { protocol: "transaction", valid: null, sourceEventId: null, chainStatus: "pending", inputs: [{ address: "1Sender", valueProofs: "12345678901234567890" }, { address: "1Other", valueProofs: "12" }], outputs: [{ address: query.address, valueProofs: "12345678901234567900" }] } });
  delete row.actions;
  response.readBoundary = { maxFirstSeenAt: null, maxEventId: 0, explicitIds: [row.id] };
  assert.equal(validateNotificationsResponse(response, query).items[0].evidence.inputs[0].valueProofs, "12345678901234567890");
  for (const explicitIds of [[`testnet4:${txid}`], ["livenet:bad"], {}, [null]]) {
    assert.throws(() => validateNotificationsResponse({ ...response, readBoundary: { ...response.readBoundary, explicitIds } }, query), /incomplete/);
  }
  row.senderAddresses = [{}];
  assert.throws(() => validateNotificationsResponse(response, query), /incomplete/);
});
