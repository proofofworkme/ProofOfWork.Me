import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import ts from "typescript";

const source = await readFile("src/shared/api/inFlightRequestPool.ts", "utf8");
const runtime = ts.transpileModule(source, {
  compilerOptions: {
    module: ts.ModuleKind.ES2022,
    target: ts.ScriptTarget.ES2022,
  },
}).outputText;
const { createInFlightRequestPool } = await import(
  `data:text/javascript;base64,${Buffer.from(runtime).toString("base64")}`
);
const deferred = () => {
  let resolve;
  let reject;
  const promise = new Promise((done, fail) => { resolve = done; reject = fail; });
  return { promise, resolve, reject };
};

const pool = createInFlightRequestPool();
const response = deferred();
const firstController = new AbortController();
const secondController = new AbortController();
let loads = 0;
let underlyingSignal;
const load = (signal) => {
  loads += 1;
  underlyingSignal = signal;
  return response.promise;
};
const first = pool.request("livenet:tx-a", firstController.signal, load);
const second = pool.request("livenet:tx-a", secondController.signal, load);
await Promise.resolve();
assert.equal(loads, 1, "overlapping same-key requests share one loader");
firstController.abort();
await assert.rejects(first, { name: "AbortError" });
assert.equal(underlyingSignal.aborted, false, "one consumer cannot cancel another");
response.resolve({ attachment: { sha256: "fixture" } });
assert.deepEqual(await second, { attachment: { sha256: "fixture" } });

const lastConsumerResponse = deferred();
const consumers = [new AbortController(), new AbortController()];
let sharedSignal;
const pending = consumers.map((controller) =>
  pool.request("livenet:tx-b", controller.signal, (signal) => {
    sharedSignal = signal;
    return lastConsumerResponse.promise;
  }),
);
await Promise.resolve();
consumers[0].abort();
assert.equal(sharedSignal.aborted, false);
consumers[1].abort();
await Promise.all(pending.map((request) => assert.rejects(request, { name: "AbortError" })));
assert.equal(sharedSignal.aborted, true, "last consumer cancellation stops the shared loader");

let recoveredLoads = 0;
assert.equal(
  await pool.request("livenet:tx-b", new AbortController().signal, async () => {
    recoveredLoads += 1;
    return "retried";
  }),
  "retried",
);
assert.equal(recoveredLoads, 1, "an aborted in-flight entry is not retained as a cache entry");
console.log("In-flight request coalescing, consumer cancellation, last-consumer abort, and retry passed.");
