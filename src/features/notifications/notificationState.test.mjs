import test from "node:test";
import assert from "node:assert/strict";
import { appendNotificationPage, emptyNotificationReadState, mergeNotificationReadStates, notificationIsRead, notificationStorageKey, parseNotificationReadState, setNotificationsRead } from "./notificationState.mjs";

const pending = { id: "livenet:transaction", status: "pending" };
test("read identity survives confirmation, reorg, and constituent action expansion", () => {
  const state = setNotificationsRead(emptyNotificationReadState(), [pending.id], true, 12);
  for (const status of ["confirmed", "orphaned", "dropped"]) assert.equal(notificationIsRead(state, { ...pending, status, actions: [{ kind: "mail" }, { kind: "send3" }] }), true);
  assert.equal(notificationIsRead(state, { id: "livenet:other" }), false);
});
test("network and exact address scopes never share read state", () => {
  const main = notificationStorageKey("livenet", "1AbC");
  assert.notEqual(main, notificationStorageKey("testnet4", "1AbC"));
  assert.notEqual(main, notificationStorageKey("livenet", "1abc"));
  assert.notEqual(notificationStorageKey("a:b", "c"), notificationStorageKey("a", "b:c"));
});
test("explicit unread survives unrelated reads and cross-tab merge", () => {
  const one = setNotificationsRead(emptyNotificationReadState(), ["one", "two"], true, 10);
  const unread = setNotificationsRead(one, ["one"], false, 11);
  const otherTab = setNotificationsRead(one, ["three"], true, 12);
  const merged = mergeNotificationReadStates(unread, otherTab);
  assert.equal(notificationIsRead(merged, { id: "one" }), false);
  assert.equal(notificationIsRead(merged, { id: "two" }), true);
  assert.equal(notificationIsRead(merged, { id: "three" }), true);
  assert.deepEqual(merged, mergeNotificationReadStates(otherTab, unread));
});
test("same millisecond actions remain ordered and unread wins exact cross-tab ties", () => {
  let state = setNotificationsRead(emptyNotificationReadState(), ["one"], true, 10);
  state = setNotificationsRead(state, ["one"], false, 10);
  assert.equal(state.entries.one.at, 11);
  const left = setNotificationsRead(emptyNotificationReadState(), ["one"], true, 10);
  const right = setNotificationsRead(emptyNotificationReadState(), ["one"], false, 10);
  assert.equal(notificationIsRead(mergeNotificationReadStates(left, right), { id: "one" }), false);
  assert.equal(notificationIsRead(mergeNotificationReadStates(right, left), { id: "one" }), false);
});
test("malformed storage fails visibly instead of overwriting history with zero state", () => {
  assert.deepEqual(parseNotificationReadState(null), emptyNotificationReadState());
  for (const raw of ["broken", "{}", '{"version":2,"entries":{}}', '{"version":1,"entries":[]}', '{"version":1,"entries":{"a":{"read":"true","at":4}}}']) assert.throws(() => parseNotificationReadState(raw));
  const parsed = parseNotificationReadState('{"version":1,"entries":{"__proto__":{"read":true,"at":4}}}');
  assert.equal(Object.hasOwn(parsed.entries, "__proto__"), true);
  assert.equal(Object.getPrototypeOf(parsed.entries), Object.prototype);
});
const page = (patch = {}) => ({ network: "livenet", address: "1AbC", snapshotId: "snapshot-one", items: [{ id: "new" }], nextCursor: "cursor-one", hasMore: true, ...patch });
test("pagination deduplicates transaction groups and preserves next-page metadata", () => {
  const merged = appendNotificationPage(page(), page({ items: [{ id: "new", status: "confirmed" }, { id: "old" }], nextCursor: null, hasMore: false }), "cursor-one");
  assert.deepEqual(merged.items.map(item => item.id), ["new", "old"]);
  assert.equal(merged.items[0].status, "confirmed");
  assert.equal(merged.hasMore, false);
});
test("changed scope/snapshot and cursor loops cannot masquerade as complete history", () => {
  for (const next of [page({ network: "testnet4" }), page({ address: "1abc" }), page({ snapshotId: "snapshot-two" }), page({ nextCursor: "cursor-one" }), page({ nextCursor: null })]) {
    assert.throws(() => appendNotificationPage(page(), next, "cursor-one"), /changed|advance/);
  }
  assert.throws(() => appendNotificationPage(page(), page({ nextCursor: "cursor-two" }), "other-cursor"));
});

test("mark all uses immutable observation time, covers older pages, and leaves new activity unread", async () => {
  const { setAllNotificationsRead } = await import("./notificationState.mjs");
  const seen = "2026-10-23T12:00:00.000Z";
  const old = { id: "old", maxEventId: 1, firstSeenAt: "2026-10-22T12:00:00.000Z" };
  const loaded = { id: "loaded", maxEventId: 2, firstSeenAt: seen };
  const fresh = { id: "fresh", maxEventId: 3, firstSeenAt: "2026-10-23T12:00:00.001Z" };
  let state = setAllNotificationsRead(emptyNotificationReadState(), [loaded], seen, 100, 10);
  assert.equal(notificationIsRead(state, old), true);
  assert.equal(notificationIsRead(state, loaded), true);
  assert.equal(notificationIsRead(state, fresh), false);
  assert.equal(notificationIsRead(state, { ...loaded, status: "confirmed", maxEventId: 9_999 }), true);
  state = setNotificationsRead(state, [old.id], false, 10);
  assert.equal(notificationIsRead(state, old), false);
  state = setAllNotificationsRead(state, [loaded], seen, 100, 10);
  assert.equal(notificationIsRead(state, old), true);
  assert.equal(notificationIsRead(parseNotificationReadState(JSON.stringify(state)), old), true);
});
test("mark-all never invents a read boundary and missing first-seen stays conservative", async () => {
  const { setAllNotificationsRead } = await import("./notificationState.mjs");
  assert.throws(() => setAllNotificationsRead(emptyNotificationReadState(), [], "bad", 100), /boundary/);
  const state = setAllNotificationsRead(emptyNotificationReadState(), [], "2026-10-23T12:00:00.000Z", 100, 10);
  assert.equal(notificationIsRead(state, { id: "unknown", firstSeenAt: null }), false);
  assert.throws(() => parseNotificationReadState('{"version":1,"entries":{},"readThrough":{"firstSeenAt":"bad","at":1}}'));
});

test("validated Bech32 scopes normalize consistently without folding Base58 identity", async () => {
  const { notificationAddressScope } = await import("./notificationState.mjs");
  assert.equal(notificationAddressScope("BC1QHELLO"), "bc1qhello");
  assert.equal(notificationAddressScope("TB1QHELLO"), "tb1qhello");
  assert.equal(notificationAddressScope("1AbCdEf"), "1AbCdEf");
});

test("concurrent mark-all snapshots preserve coverage without clearing later unrelated unread", async () => {
  const { setAllNotificationsRead } = await import("./notificationState.mjs");
  const early = "2026-10-22T00:00:00Z", later = "2026-10-23T00:00:00Z";
  const old = { id: "old", maxEventId: 1, firstSeenAt: early }, between = { id: "between", maxEventId: 2, firstSeenAt: "2026-10-22T12:00:00Z" };
  let broad = setAllNotificationsRead(emptyNotificationReadState(), [], later, 100, 10);
  broad = setNotificationsRead(broad, [old.id, between.id], false, 15);
  const stale = setAllNotificationsRead(emptyNotificationReadState(), [], early, 90, 20);
  const merged = mergeNotificationReadStates(broad, stale);
  assert.equal(merged.readThrough.firstSeenAt, later);
  assert.equal(notificationIsRead(merged, old), true);
  assert.equal(notificationIsRead(merged, between), false);
  assert.equal(notificationIsRead(merged, { id: "never-loaded", maxEventId: 2, firstSeenAt: between.firstSeenAt }), true);
  assert.deepEqual(merged, mergeNotificationReadStates(stale, broad));
  assert.deepEqual(parseNotificationReadState(JSON.stringify(merged)), merged);
});

test("new historical relationships stay unread beyond the indexed event fence", async () => {
  const { setAllNotificationsRead } = await import("./notificationState.mjs");
  const firstSeenAt = "2026-10-23T00:00:00Z";
  const loaded = { id: "loaded", firstSeenAt, maxEventId: 2 };
  const state = setAllNotificationsRead(emptyNotificationReadState(), [loaded], firstSeenAt, 100, 10);
  assert.equal(notificationIsRead(state, { id: "old-unloaded", firstSeenAt, maxEventId: 50 }), true);
  assert.equal(notificationIsRead(state, { id: "newly-related", firstSeenAt, maxEventId: 101 }), false);
  assert.equal(notificationIsRead(state, { ...loaded, maxEventId: 101, status: "confirmed" }), true);
  assert.equal(notificationIsRead(state, { id: "missing-fence", firstSeenAt }), false);
});

test("simultaneous browser writes converge to a durable union without storage-event ping-pong", async () => {
  const { reconcileNotificationReadStorage, serializeNotificationReadState } = await import("./notificationState.mjs");
  const firstTab = setNotificationsRead(emptyNotificationReadState(), ["one"], true, 10);
  const secondTab = setNotificationsRead(emptyNotificationReadState(), ["two"], true, 10);
  let disk = serializeNotificationReadState(secondTab), writes = 0;
  const storage = { getItem: () => disk, setItem: (_key, value) => { disk = value; writes++; } };
  const first = reconcileNotificationReadStorage(storage, "scope", firstTab);
  assert.equal(writes, 1);
  const second = reconcileNotificationReadStorage(storage, "scope", secondTab);
  for (let index = 0; index < 5; index++) {
    reconcileNotificationReadStorage(storage, "scope", first.state);
    reconcileNotificationReadStorage(storage, "scope", second.state);
  }
  assert.equal(writes, 1);
  const restored = parseNotificationReadState(disk);
  assert.equal(notificationIsRead(restored, { id: "one" }), true);
  assert.equal(notificationIsRead(restored, { id: "two" }), true);
  assert.equal(serializeNotificationReadState(mergeNotificationReadStates(firstTab, secondTab)), serializeNotificationReadState(mergeNotificationReadStates(secondTab, firstTab)));
});

test("storage reconciliation preserves malformed data and usable memory on read/write failures", async () => {
  const { reconcileNotificationReadStorage } = await import("./notificationState.mjs");
  const memory = emptyNotificationReadState();
  const change = state => setNotificationsRead(state, ["one"], true, 10);
  let writes = 0;
  for (const getItem of [() => "malformed", () => { throw new Error("storage denied"); }]) {
    const result = reconcileNotificationReadStorage({ getItem, setItem: () => { writes++; } }, "scope", memory, change);
    assert.match(result.warning, /preserved/);
    assert.equal(notificationIsRead(result.state, { id: "one" }), true);
  }
  assert.equal(writes, 0);
  const result = reconcileNotificationReadStorage({ getItem: () => null, setItem: () => { throw new Error("quota"); } }, "scope", memory, change);
  assert.match(result.warning, /could not be updated/);
  assert.equal(notificationIsRead(result.state, { id: "one" }), true);
});

test("raw-only snapshot mark-all uses explicit IDs, includes unloaded rows, and leaves newly discovered transfers unread", async () => {
  const { notificationSnapshotReadIds, notificationHasUnloadedUnread } = await import("./notificationState.mjs");
  const response = { items: [{ id: "raw-newest", firstSeenAt: null, maxEventId: null }], totalCount: 2, hasMore: true,
    readBoundary: { maxFirstSeenAt: null, maxEventId: 0, explicitIds: ["raw-newest", "raw-older"] } };
  assert.deepEqual(notificationSnapshotReadIds(response), ["raw-newest", "raw-older"]);
  assert.equal(notificationHasUnloadedUnread(emptyNotificationReadState(), response), true);
  const state = setNotificationsRead(emptyNotificationReadState(), notificationSnapshotReadIds(response), true, 10);
  assert.equal(notificationHasUnloadedUnread(state, response), false);
  assert.equal(notificationIsRead(state, { id: "raw-older", maxEventId: null }), true);
  assert.equal(notificationIsRead(state, { id: "discovered-later", maxEventId: null }), false);
  assert.equal(notificationHasUnloadedUnread(state, { ...response, totalCount: 3 }), true);
  const unread = setNotificationsRead(state, ["raw-older"], false, 11);
  assert.equal(notificationHasUnloadedUnread(unread, response), true);
});
test("mixed raw and event snapshot mark-all must cover both explicit IDs and stable event boundaries", async () => {
  const { notificationHasUnloadedUnread, notificationSnapshotReadIds, setAllNotificationsRead } = await import("./notificationState.mjs");
  const response = { items: [{ id: "event", firstSeenAt: "2026-10-23T00:00:00Z", maxEventId: 5 }], totalCount: 3, hasMore: true,
    readBoundary: { maxFirstSeenAt: "2026-10-23T00:00:00Z", maxEventId: 10, explicitIds: ["raw"] } };
  const partial = setAllNotificationsRead(emptyNotificationReadState(), response.items, response.readBoundary.maxFirstSeenAt, 10, 10);
  assert.equal(notificationHasUnloadedUnread(partial, response), true);
  const complete = setAllNotificationsRead(emptyNotificationReadState(), notificationSnapshotReadIds(response).map(id => ({ id })), response.readBoundary.maxFirstSeenAt, 10, 10);
  assert.equal(notificationHasUnloadedUnread(complete, response), false);
  assert.equal(notificationIsRead(complete, { id: "older-event", firstSeenAt: "2026-10-22T00:00:00Z", maxEventId: 9 }), true);
  assert.equal(notificationHasUnloadedUnread(complete, { ...response, readBoundary: { ...response.readBoundary, maxEventId: 11 } }), true);
});
