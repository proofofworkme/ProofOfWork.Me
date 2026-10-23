import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { readFileSync } from "node:fs";
import { Worker } from "node:worker_threads";
import test from "node:test";
const source = readFileSync(new URL("../server/proof-api.mjs", import.meta.url), "utf8");
const laneSource = source.slice(source.indexOf("function createPendingBaseValidationLane("), source.indexOf("const pendingBaseValidationLane ="));
const stageError = (code, message, details) => Object.assign(new Error(message), { statusCode: 503, details: { code, ...details } });
const createLane = new Function("pendingWorkVerifierStageError", `${laneSource}; return createPendingBaseValidationLane;`)(stageError);
const workerSource = source.slice(source.indexOf("function startPendingBaseValidationWorker("), source.indexOf("function pendingWorkVerifierStageConfirmedBase(\n"));
const turn = () => new Promise(resolve => setImmediate(resolve));
class FakeWorker extends EventEmitter {
  sent = [];
  terminated = 0;
  postMessage(value) { this.sent.push(value); }
  ref() {}
  unref() {}
  async terminate() { this.terminated += 1; }
  reply(value) { this.emit("message", { id: this.sent.at(-1).id, type: "result", value }); }
}

test("one active validation and one queued validation; excess work fails closed", async () => {
  const worker = new FakeWorker(); const lane = createLane({ createWorker: () => worker });
  try {
    const one = lane.run(1, 2, 3), two = lane.run(4, 5, 6);
    await assert.rejects(lane.run(7, 8, 9), e => e.statusCode === 503 && e.details.reason === "queue-full");
    assert.equal(worker.sent.length, 1); worker.reply("first");
    assert.equal(await one, "first"); assert.equal(worker.sent.length, 2);
    worker.reply("second"); assert.equal(await two, "second");
  } finally { await lane.close(); }
});

test("validation errors preserve exact fail-closed status and evidence", async () => {
  const worker = new FakeWorker(); const lane = createLane({ createWorker: () => worker });
  try {
    const result = lane.run({}, {}, {});
    worker.emit("message", { id: worker.sent[0].id, type: "error", error: {
      name: "Error", message: "Conservation failed", statusCode: 503,
      details: { code: "PENDING_WORK_STAGE_BASE_CONSERVATION_INVALID", field: "supply" },
    } });
    await assert.rejects(result, e => e.statusCode === 503 && e.message === "Conservation failed" && e.details.field === "supply");
  } finally { await lane.close(); }
});

test("a timed-out worker is terminated before another can start", async () => {
  let release; const worker = new FakeWorker(); const next = new FakeWorker(); let created = 0;
  worker.terminate = () => new Promise(resolve => { release = resolve; });
  const lane = createLane({ createWorker: () => ++created === 1 ? worker : next, timeoutMs: 20 });
  const expired = assert.rejects(lane.run(1, 2, 3), e => e.statusCode === 503 && e.details.reason === "execution-deadline");
  await new Promise(resolve => setTimeout(resolve, 30));
  const queued = lane.run(4, 5, 6); assert.equal(created, 1); release();
  await expired; await turn(); assert.equal(created, 2); next.reply("recovered");
  assert.equal(await queued, "recovered"); await lane.close();
});

test("worker exit and invalid correlation fail closed without synchronous fallback", async () => {
  for (const fault of ["exit", "message"]) {
    const worker = new FakeWorker(); const lane = createLane({ createWorker: () => worker });
    const result = lane.run({}, {}, {});
    worker.emit(fault, fault === "exit" ? 1 : { id: 999, type: "result", value: "wrong" });
    await assert.rejects(result, e => e.statusCode === 503 && e.details.code === "PENDING_WORK_STAGE_CPU_UNAVAILABLE");
    assert.equal(worker.terminated, 1); await lane.close();
  }
});

test("CPU work runs off the caller event loop and returns the unchanged value", async () => {
  const lane = createLane({ createWorker: () => new Worker(`
    const { parentPort } = require('node:worker_threads');
    ${workerSource}
    startPendingBaseValidationWorker(parentPort, (payload, tip, commitment) => {
      const until = Date.now() + 150; while (Date.now() < until) {}
      if (payload.invalid) throw Object.assign(new Error('invalid'), { statusCode:503, details:{code:'BASE_INVALID'} });
      return { state: payload, tip, commitment };
    });`, { eval: true }) });
  let ticks = 0; const timer = setInterval(() => { ticks += 1; }, 10);
  try {
    const payload = { nested: [1, "proof", { amount: "2100000000000000000000" }] };
    assert.deepEqual(await lane.run(payload, { height: 972783 }, { sha256: "a".repeat(64) }), {
      state: payload, tip: { height: 972783 }, commitment: { sha256: "a".repeat(64) },
    });
    assert.ok(ticks >= 5, `caller was not responsive: ${ticks} ticks`);
    await assert.rejects(lane.run({ invalid: true }, {}, {}), e => e.statusCode === 503 && e.details.code === "BASE_INVALID");
  } finally { clearInterval(timer); await lane.close(); }
});


test("unverified termination closes admission and cannot spawn a replacement", async () => {
  const worker = new FakeWorker(); let created = 0;
  worker.terminate = async () => { throw new Error("termination failed"); };
  const lane = createLane({ createWorker: () => { created += 1; return worker; } });
  const active = assert.rejects(lane.run(1, 2, 3), e => e.statusCode === 503);
  const queued = assert.rejects(lane.run(4, 5, 6), e => e.details.reason === "termination-unverified");
  worker.emit("error", new Error("worker failed"));
  await Promise.all([active, queued]);
  await assert.rejects(lane.run(7, 8, 9), e => e.details.reason === "closed");
  assert.equal(created, 1); await lane.close();
});
