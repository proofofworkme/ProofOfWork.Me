import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { readFileSync } from "node:fs";
import { performance } from "node:perf_hooks";
import { setImmediate as yieldToIo } from "node:timers/promises";
const source = readFileSync(new URL("../server/proof-api.mjs", import.meta.url), "utf8");
const block = source.slice(source.indexOf("// Match checkpointCursorCanonicalJson"), source.indexOf("function encodedCheckpointCursor("));
const { checkpointCanonicalSha256, checkpointBoundedCanonicalRecord, checkpointListingDigestContext } = new Function("createHash", "performance", "yieldToIo", "compareCanonicalUtf8", `${block};return { checkpointCanonicalSha256, checkpointBoundedCanonicalRecord, checkpointListingDigestContext };`)(createHash, performance, yieldToIo, compareCanonicalUtf8);
import { compareCanonicalUtf8 } from "../server/canonical-order.mjs";

// The existing cursor encoding is the byte-level compatibility contract.
function legacy(value) {
  if (value === null) return "null";
  if (typeof value === "bigint") return JSON.stringify(value.toString());
  if (["boolean", "number", "string"].includes(typeof value)) return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(legacy).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.keys(value).sort(compareCanonicalUtf8).map(key => `${JSON.stringify(key)}:${legacy(value[key])}`).join(",")}}`;
  return "null";
}
const expected = value => createHash("sha256").update(legacy(value), "utf8").digest("hex");

test("streamed evidence retains existing cursor bytes across value types", async () => {
  const sparse = new Array(4); sparse[2] = undefined;
  const values = [null, undefined, true, false, NaN, Infinity, -0, 1e30, 9007199254740993n,
    { z: [1, "é", null], a: undefined, "😀": "\ud800", "\ue000": "\u0000\n\\\"" },
    sparse, new Date(0), { toJSON: () => "not used", value: 1 }];
  for (const value of values) assert.equal(await checkpointCanonicalSha256(value), expected(value));
});

test("UTF-8 hash chunks preserve astral characters and escaped surrogates", async () => {
  for (const length of [16381, 16382, 16383, 32766]) {
    const value = "a".repeat(length) + "😀é\ud800" + "z".repeat(33000);
    assert.equal(await checkpointCanonicalSha256(value), expected(value));
  }
});

test("bounded records preserve legacy Unicode, BigInt, undefined and sparse semantics", async () => {
  const sparse = new Array(4); sparse[2] = undefined;
  const value = {
    "😀": "astral key", "\ue000": "BMP key", "é": "accent", "\ud800": "lone surrogate",
    a: undefined, amount: 9007199254740993n, nested: [NaN, Infinity, -0, sparse],
  };
  assert.equal(checkpointBoundedCanonicalRecord(value), legacy(value));
  const context = checkpointListingDigestContext();
  await context.prepare([value]);
  assert.equal(context.stats().entries, 0, "sparse descendants must remain on the streaming path");
  assert.equal(await context.hash(value), expected(value));
  const fixture = { listingId: "a", amount: 9007199254740993n, terms: { z: undefined, a: [true, null, "😀"] } };
  const fixtureHash = "958f8dcce9a58d209bf7ffb53f26fa017efbc0839d43ede275d2c894aaf46577";
  const fixtureContext = checkpointListingDigestContext();
  await fixtureContext.prepare([fixture]);
  assert.equal(await fixtureContext.hash(fixture), fixtureHash);
  assert.equal(await fixtureContext.recordSha256(fixture), fixtureHash);
});

test("three book digests and page records reuse one bounded serialization per immutable record", async () => {
  const records = Array.from({ length: 32 }, (_, i) => ({
    listingId: String(i), terms: { value: BigInt(i), missing: undefined, names: ["😀", "\ue000"] },
  }));
  const context = checkpointListingDigestContext();
  await context.prepare(records);
  await context.prepare(records);
  assert.equal(context.stats().serializations, records.length);
  for (let pass = 0; pass < 3; pass += 1) {
    const entries = records.map((item, i) => ({ item, key: [String(i), 972357, i, 0, 0] }));
    assert.equal(await context.hash(entries), expected(entries));
  }
  for (const record of records) assert.equal(await context.recordSha256(record), expected(record));
  const stats = context.stats();
  assert.equal(stats.serializations, records.length, "digest and page passes must not serialize cached records again");
  assert.equal(stats.entries, records.length);
  assert.equal(stats.hits, 4 * records.length);
  assert.ok(stats.bytes <= 64 * 1024 ** 2);
});

test("request caches freeze admitted records and cannot retain mutable or later-request authority", async () => {
  const first = { listingId: "same", terms: { amount: "1", flags: [true] } };
  const later = structuredClone(first);
  const firstContext = checkpointListingDigestContext();
  const laterContext = checkpointListingDigestContext();
  await firstContext.prepare([first]);
  assert.ok(Object.isFrozen(first));
  assert.ok(Object.isFrozen(first.terms));
  assert.ok(Object.isFrozen(first.terms.flags));
  assert.throws(() => { first.terms.amount = "2"; }, TypeError);
  assert.throws(() => { first.terms.flags.push(false); }, TypeError);
  assert.equal(laterContext.stats().entries, 0);
  assert.equal(await laterContext.hash(later), expected(first));
  later.terms.amount = "2";
  assert.notEqual(await laterContext.hash(later), await firstContext.hash(first));
  assert.equal(laterContext.stats().entries, 0, "hashing alone must not cache mutable objects");
  await laterContext.prepare([later]);
  assert.equal(laterContext.stats().serializations, 1);
  assert.equal(await firstContext.recordSha256(first), expected(first));
  assert.equal(await laterContext.recordSha256(later), expected(later));
});

test("entry, memory and per-record work caps fall back without changing hashes or freezing rejected records", async () => {
  const records = Array.from({ length: 3 }, (_, i) => ({ listingId: String(i), terms: "a".repeat(50) }));
  const entryLimited = checkpointListingDigestContext({ maxEntries: 1 });
  await entryLimited.prepare(records);
  assert.equal(entryLimited.stats().entries, 1);
  assert.equal(await entryLimited.hash(records), expected(records));
  assert.equal(Object.isFrozen(records[1]), false);
  const memoryRecords = structuredClone(records);
  const memoryLimited = checkpointListingDigestContext({ maxBytes: 512 });
  await memoryLimited.prepare(memoryRecords);
  assert.equal(memoryLimited.stats().entries, 1);
  assert.ok(memoryLimited.stats().bytes <= 512);
  assert.equal(await memoryLimited.hash(memoryRecords), expected(memoryRecords));
  assert.equal(Object.isFrozen(memoryRecords[1]), false);
  const oversized = [{ terms: "x".repeat(140000) }, Object.fromEntries(Array.from({ length: 4100 }, (_, i) => [String(i), i]))];
  const uncached = checkpointListingDigestContext();
  await uncached.prepare(oversized);
  assert.equal(uncached.stats().entries, 0);
  assert.equal(uncached.stats().serializations, 1, "wide trees must be rejected before traversal or serialization");
  assert.equal(await uncached.hash(oversized), expected(oversized));
  assert.ok(oversized.every(value => !Object.isFrozen(value)));
});

test("preparation never evaluates getters or changes legacy fallback reads", async () => {
  let reads = 0;
  const value = { get amount() { return ++reads; } };
  const custom = Object.assign(Object.create({ inherited: true }), { amount: "2" });
  const context = checkpointListingDigestContext();
  await context.prepare([value, custom]);
  assert.equal(reads, 0);
  assert.equal(context.stats().entries, 0);
  assert.equal(context.stats().serializations, 0);
  assert.equal(await context.hash(value), expected({ amount: 1 }));
  assert.equal(await context.recordSha256(value), expected({ amount: 2 }));
  assert.equal(reads, 2);
  assert.equal(await context.hash(custom), expected(custom));
  assert.equal(Object.isFrozen(custom), false);
});

test("cached book preparation and hashing continue to yield to I/O", async () => {
  const records = Array.from({ length: 512 }, (_, i) => ({ listingId: String(i), terms: "proof".repeat(3300) }));
  const context = checkpointListingDigestContext();
  let prepareTurns = 0;
  let hashTurns = 0;
  let phase = "prepare";
  const tick = () => {
    if (phase === "prepare") prepareTurns += 1;
    if (phase === "hash") hashTurns += 1;
    if (phase) setImmediate(tick);
  };
  setImmediate(tick);
  try {
    await context.prepare(records);
    assert.equal(context.stats().entries, records.length);
    assert.ok(prepareTurns > 0, "preparation must let pending I/O run");
    phase = "hash";
    assert.equal(await context.hash(records), expected(records));
    assert.ok(hashTurns > 0, "cached canonical strings must still use the yielding hash stream");
  } finally { phase = ""; }
});

test("overlapping complete evidence digests yield to I/O and preserve hashes", async () => {
  const value = Array.from({ length: 12000 }, (_, i) => ({
    key: [String(i), 972357, i, 0, 0],
    item: { listingId: String(i).padStart(64, "0"), terms: "proof".repeat(40), amount: `${i}00000000` },
  }));
  const hash = expected(value);
  let turns = 0;
  let active = true;
  const tick = () => { turns += 1; if (active) setImmediate(tick); };
  setImmediate(tick);
  try {
    assert.deepEqual(await Promise.all([checkpointCanonicalSha256(value), checkpointCanonicalSha256(value)]), [hash, hash]);
    assert.ok(turns > 2, `expected multiple I/O turns, received ${turns}`);
  } finally { active = false; }
});
