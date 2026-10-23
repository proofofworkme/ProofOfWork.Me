import test from "node:test";
import assert from "node:assert/strict";
import { notificationProjectionCache } from "./notification-cache.mjs";

test("same-source concurrent address reads share authority and expiry triggers a new complete read", async () => {
  let now = 0, calls = 0, release;
  const cache = notificationProjectionCache({ now: () => now, ttlMs: 10 });
  const load = () => { calls++; return new Promise(resolve => { release = resolve; }); };
  const first = cache("checkpoint:fence",load), second = cache("checkpoint:fence",load);
  await Promise.resolve(); assert.equal(calls,1);
  const result = { owners: new Map([["txid", "owner"]]) }; release(result);
  assert.equal(await first,result); assert.equal(await second,result);
  assert.equal(await cache("checkpoint:fence",() => { throw new Error("unneeded"); }),result);
  now = 11; assert.deepEqual(await cache("checkpoint:fence",() => ({ refreshed: true })),{ refreshed: true });
});

test("different source fences invalidate authority; failures and bounded pressure never become empty success", async () => {
  const cache = notificationProjectionCache({ maxEntries: 1, maxBytes: 100 });
  let release;
  const pending = cache("first",() => new Promise(resolve => { release = resolve; }));
  await Promise.resolve();
  await assert.rejects(cache("second",() => ({})),error => error.statusCode === 503);
  release({ first: true }); await pending;
  assert.deepEqual(await cache("second",() => ({ second: true })),{ second: true });
  await assert.rejects(cache("large",() => ({ data: "x".repeat(101) })),error => error.statusCode === 503);
  await assert.rejects(cache("failure",() => { throw new Error("unavailable"); }),/unavailable/u);
  assert.deepEqual(await cache("failure",() => ({ recovered: true })),{ recovered: true });
});
