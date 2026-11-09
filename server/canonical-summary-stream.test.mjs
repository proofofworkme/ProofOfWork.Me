import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { once } from "node:events";
import { createServer, get } from "node:http";
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
  let length;
  response.setHeader = (name, value) => { assert.equal(name, "Content-Length"); length = value; };
  response.writeHead = code => { assert.equal(code, 200); assert.ok(Number.isSafeInteger(length)); };
  await writeCanonicalSummaryStream(response, value, max);
  const bytes = Buffer.concat(chunks);
  assert.equal(length, bytes.length);
  return bytes;
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
test("HTTP Content-Length equals framed bytes and remains available to the response timing recorder", async t => {
  const value = bundle(Array.from({ length: 1100 }, (_, index) => ({ index, value: "ø".repeat(128) })));
  const expected = await wire(value, 4096);
  let recordedBytes;
  const server = createServer((_, response) => {
    response.once("finish", () => { recordedBytes = Number(response.getHeader("content-length")); });
    writeCanonicalSummaryStream(response, value, 4096).catch(error => response.destroy(error));
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  t.after(() => new Promise(resolve => server.close(resolve)));
  const request = get({ hostname: "127.0.0.1", port: server.address().port, agent: false });
  const [incoming] = await once(request, "response");
  assert.equal(incoming.statusCode, 200);
  assert.equal(incoming.headers["content-length"], String(expected.length));
  assert.equal(incoming.headers["transfer-encoding"], undefined);
  const chunks = [];
  for await (const chunk of incoming) chunks.push(chunk);
  const received = Buffer.concat(chunks);
  assert.equal(incoming.complete, true);
  assert.deepEqual(received, expected);
  assert.equal(recordedBytes, received.length);
  t.diagnostic(JSON.stringify({ status: incoming.statusCode, payloadBytes: recordedBytes, receivedBytes: received.length }));
  assert.deepEqual(await readCanonicalSummaryStream(Readable.from([received]), 4096), value);
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
