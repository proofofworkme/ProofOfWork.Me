import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { Readable, Writable } from "node:stream";
import test from "node:test";
import { canonicalSummaryPayloadHash, readCanonicalSummaryStream, writeCanonicalSummaryStream } from "./canonical-summary-stream.mjs";
import { prepareWorkTransferProjection } from "./db/work-transfer-projection-store.mjs";

const limit = 64 * 1024 * 1024;
function bundle(items = []) {
  return {
    network: "livenet", snapshotId: "1234567890abcdef12345678",
    indexedThroughBlock: 974919, indexedThroughBlockHash: "a".repeat(64),
    summaryPayloads: {
      logSummary: { pending: 0 },
      workSummary: { floor: { frozen: "100" }, workTransferValueProjection: {
        amountStorageModel: "work-subatoms-v2", items, model: "canonical-work-transfer-value-projection-v1",
        batchModel: "canonical-work-batch-transfer-value-projection-v1", transferBatches: [],
      } },
    },
  };
}
async function wire(value, max = limit) {
  const chunks = [];
  const response = new Writable({ write(chunk, _, next) { chunks.push(chunk); next(); } });
  response.writeHead = code => assert.equal(code, 200);
  await writeCanonicalSummaryStream(response, value, max);
  return Buffer.concat(chunks);
}
test("WORK projection bytes can exceed the header budget, span pages, and arrive in arbitrary TCP fragments", async () => {
  const value = bundle(Array.from({ length: 1100 }, (_, i) => ({ index: i, value: "ø".repeat(128) })));
  const bytes = await wire(value, 4096);
  assert.ok(bytes.length > 262144);
  const pieces = function* () {
    for (let pos = 0; pos < bytes.length; pos += 129) yield bytes.subarray(pos, pos + 129);
  };
  assert.deepEqual(await readCanonicalSummaryStream(Readable.from(pieces()), 4096), value);
  assert.equal(canonicalSummaryPayloadHash(value.summaryPayloads),
    createHash("sha256").update(JSON.stringify(value.summaryPayloads)).digest("hex"));
});
test("stream refuses crossed snapshot bindings, modified pages, truncation, oversize headers and trailing bytes", async () => {
  const value = bundle([{ value: "original" }]);
  const bytes = await wire(value);
  const ref = prepareWorkTransferProjection(value.summaryPayloads.workSummary.workTransferValueProjection, value).reference;
  const header = bytes.subarray(4, 4 + bytes.readUInt32BE()).toString();
  const changed = Buffer.from(bytes);
  changed[changed.length - 3] ^= 1;
  const crossed = Buffer.from(bytes);
  const position = header.indexOf(ref.snapshotId);
  crossed[4 + position] = 0x66;
  for (const invalid of [bytes.subarray(0, -1), changed, crossed, Buffer.concat([bytes, Buffer.of(0)])]) {
    await assert.rejects(readCanonicalSummaryStream(Readable.from([invalid]), limit));
  }
  await assert.rejects(readCanonicalSummaryStream(Readable.from([bytes]), 4), /header length/);
});
