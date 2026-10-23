import test from "node:test";
import assert from "node:assert/strict";
import { notificationQueryKey, notificationQueryParams, notificationReadScope } from "./notificationScope.mjs";
import { notificationStorageKey, appendNotificationPage, emptyNotificationReadState, setNotificationsRead, notificationIsRead } from "./notificationState.mjs";
const registrationTxid = "a".repeat(64);
const idQuery = { network: "livenet", id: "alice" };
const idResponse = () => ({ network: "livenet", address: null, scope: { type: "id", id: "alice", registrationTxid }, scopeKey: `id:${registrationTxid}`, items: [{ id: "livenet:one" }], snapshotId: "snapshot", nextCursor: "older", hasMore: true });
test("ID requests are mutually exclusive with address requests and keep the confirmed canonical ID", () => {
  const id = new URLSearchParams(notificationQueryParams(idQuery, "opaque+cursor"));
  assert.equal(id.get("id"), "alice"); assert.equal(id.has("address"), false); assert.equal(id.get("cursor"), "opaque+cursor");
  const address = new URLSearchParams(notificationQueryParams({ network: "livenet", address: "1AbC" }));
  assert.equal(address.get("address"), "1AbC"); assert.equal(address.has("id"), false);
  assert.throws(() => notificationQueryParams({ network: "livenet", id: "alice", address: "1AbC" }));
  assert.notEqual(notificationQueryKey(idQuery), notificationQueryKey({ network: "livenet", address: "alice" }));
  assert.notEqual(notificationQueryKey(idQuery), notificationQueryKey({ network: "testnet4", id: "alice" }));
});
test("ID read state waits for a verified registration and follows it through owner or receiver changes", () => {
  assert.equal(notificationReadScope(idQuery, null), null);
  const response = idResponse();
  const scope = notificationReadScope(idQuery, response);
  assert.equal(scope, `id:${registrationTxid}`);
  const preferences = new Map([[notificationStorageKey("livenet", scope), setNotificationsRead(emptyNotificationReadState(), ["tx"], true, 10)]]);
  const afterTransfer = { ...response, ownerAddress: "new-owner", receiveAddress: "new-receiver" };
  assert.equal(notificationIsRead(preferences.get(notificationStorageKey("livenet", notificationReadScope(idQuery, afterTransfer))), { id: "tx" }), true);
  assert.equal(preferences.has(notificationStorageKey("livenet", "new-owner")), false);
  assert.equal(notificationReadScope(idQuery, { ...response, scopeKey: "id:wrong" }), null);
  assert.equal(notificationReadScope(idQuery, { ...response, network: "testnet4" }), null);
  assert.equal(notificationReadScope(idQuery, { ...response, scope: { ...response.scope, id: "bob" } }), null);
  assert.equal(notificationStorageKey("livenet", notificationReadScope({ network: "livenet", address: "1AbC" }, null)), "pow:notifications:v1:livenet:1AbC");
});
test("null-address ID pages cannot combine different registrations, IDs, or scope kinds", () => {
  const first = idResponse();
  const next = { ...idResponse(), nextCursor: null, hasMore: false, items: [{ id: "livenet:two" }] };
  assert.equal(appendNotificationPage(first, next, "older").items.length, 2);
  for (const patch of [
    { scopeKey: `id:${"b".repeat(64)}` }, { scope: { ...next.scope, id: "bob" } },
    { scope: { ...next.scope, registrationTxid: "b".repeat(64) } },
    { scope: { type: "address", address: "alice" } }, { scope: undefined, scopeKey: undefined },
  ]) assert.throws(() => appendNotificationPage(first, { ...next, ...patch }, "older"), /changed/);
});
