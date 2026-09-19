import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import { readCoreOutpointBatches } from "./core-outpoint-batches.mjs";

const points = Array.from({ length: 65 }, (_, index) => ({ txid: (index + 1).toString(16).padStart(64, "0"), vout: 2 }));
test("Core batches preserve identities and order, including spent outputs", async () => {
  const sizes = [];
  const outputs = await readCoreOutpointBatches(points, async requests => {
    sizes.push(requests.length);
    for (const row of requests) assert.deepEqual([row.method, row.params[2]], ["gettxout", true]);
    return requests.map(row => ({ id: row.id, error: null, result: row.id === "pow-outpoint-1" ? null : { identity: row.params[0] } })).reverse();
  });
  assert.deepEqual(sizes, [32, 32, 1]);
  assert.equal(outputs.length, 65);
  assert.equal(outputs[1].result, null);
  assert.equal(outputs[64].result.identity, points[64].txid);
});
test("Core batch failures never become spent or empty evidence", async () => {
  for (const response of [null, {}, [], [{ id: "wrong", result: null }],
    [{ id: "pow-outpoint-0", result: null, error: { code: -1 } }],
    [{ id: "pow-outpoint-0", error: null }], [{ id: "pow-outpoint-0", result: [] }]]) {
    await assert.rejects(readCoreOutpointBatches(points.slice(0, 1), async () => response));
  }
  await assert.rejects(readCoreOutpointBatches(points.slice(0, 2), async () => [
    { id: "pow-outpoint-0", result: null }, { id: "pow-outpoint-0", result: null },
  ]));
  await assert.rejects(readCoreOutpointBatches(points.slice(0, 1), async () => { throw new Error("offline"); }), /offline/u);
});
test("Core batch bounds and duplicate inputs fail before a request", async () => {
  for (const inputs of [[points[0], points[0]], [{ ...points[0], vout: -1 }], [{ ...points[0], txid: "x" }], Array(10001).fill(points[0])]) {
    await assert.rejects(readCoreOutpointBatches(inputs, async () => assert.fail("Unexpected RPC")));
  }
  assert.deepEqual(await readCoreOutpointBatches([], async () => assert.fail("Unexpected RPC")), []);
});

test("actual API batch transport binds requests and bounds malformed responses", async () => {
  const source = readFileSync(new URL('./proof-api.mjs', import.meta.url), 'utf8');
  const start = source.indexOf('async function bitcoinRpcGetTxOutBatch(');
  const end = source.indexOf('\nasync function bitcoinRpcOutspendPayload', start);
  assert.ok(start > 0 && end > start);
  let mode = 'ok';
  const fetch = async (url, options) => {
    assert.equal(url, 'http://127.0.0.1:8332');
    const requests = JSON.parse(options.body);
    assert.equal(options.method, 'POST');
    assert.equal(requests[0].method, 'gettxout');
    assert.equal(requests[0].params[2], true);
    const body = mode === 'large' ? Buffer.alloc(1024 * 1024 + 1) : Buffer.from(mode === 'json' ? '{' : JSON.stringify(requests.map(row => ({ id: row.id, error: null, result: null }))));
    return { ok: mode !== 'http', body: (async function* () { yield body; })() };
  };
  const run = vm.runInNewContext(`(${source.slice(start, end)})`, {
    BITCOIN_RPC_URL: 'http://127.0.0.1:8332', BITCOIN_RPC_USER: 'fixture', BITCOIN_RPC_PASSWORD: 'fixture',
    readCoreOutpointBatches, Buffer, fetch, AbortSignal,
  });
  assert.equal((await run(points.slice(0, 1)))[0].result, null);
  for (mode of ['large', 'json', 'http']) await assert.rejects(run(points.slice(0, 1)));
});
