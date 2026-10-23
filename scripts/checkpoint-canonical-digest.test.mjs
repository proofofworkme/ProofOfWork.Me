import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { readFileSync } from "node:fs";
import { performance } from "node:perf_hooks";
import { setImmediate as yieldToIo } from "node:timers/promises";
const source = readFileSync(new URL("../server/proof-api.mjs", import.meta.url), "utf8");
const block = source.slice(source.indexOf("// Match checkpointCursorCanonicalJson"), source.indexOf("function encodedCheckpointCursor("));
const checkpointCanonicalSha256 = new Function("createHash", "performance", "yieldToIo", "compareCanonicalUtf8", `${block};return checkpointCanonicalSha256;`)(createHash, performance, yieldToIo, compareCanonicalUtf8);
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
