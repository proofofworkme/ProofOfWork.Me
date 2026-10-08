import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import vm from "node:vm";
import { DNS_SUBDOMAIN_PAGE_LINK_PREFIX, DNS_SUBDOMAIN_PAGE_LINK_ACTIVATION_HEIGHT,
  DNS_SUBDOMAIN_PAGE_LINK_PREDECESSOR_HASH } from "../src/shared/protocol/dnsSubdomainPages.mjs";

// Execute the actual reader and scheduling functions with only SQL, Core and
// timers replaced. No server listener, database or production service is used.
const readerSource = await readFile(new URL("./db/proof-index-reader.mjs", import.meta.url), "utf8");
const readerStart = readerSource.indexOf("export async function proofIndexDnsPageLinkDiscovery(");
const readerEnd = readerSource.indexOf("export async function proofIndexDnsSubdomainDiscovery(", readerStart);
assert.ok(readerStart >= 0 && readerEnd > readerStart, "actual DNS page-link reader is available");
const readerFunction = readerSource.slice(readerStart, readerEnd).replace("export async function", "async function");
const apiSource = await readFile(new URL("./proof-api.mjs", import.meta.url), "utf8");
const warmStart = apiSource.indexOf("let dnsCoverageWarmInFlight = false;");
const warmEnd = apiSource.indexOf("function prewarmExpensiveReadCaches(", warmStart);
assert.ok(warmStart >= 0 && warmEnd > warmStart, "actual DNS coverage warmer is available");
const warmFunction = apiSource.slice(warmStart, warmEnd);

const activationHeight = DNS_SUBDOMAIN_PAGE_LINK_ACTIVATION_HEIGHT;
const blockHash = n => n.toString(16).padStart(64, "0");
const commitment = value => ({ model: "test-commitment", sha256: createHash("sha256").update(value).digest("hex"), payloadBytes: value.length });
function rows(count = 2) {
  return Array.from({ length: count }, (_, index) => ({
    height: activationHeight + index, block_hash: blockHash(100 + index),
    previous_block_hash: index ? blockHash(99 + index) : DNS_SUBDOMAIN_PAGE_LINK_PREDECESSOR_HASH,
    canonical_height_count: 1, complete: true, block_atomic: true, fee_once: true, invalid_zero: true,
    model: "v8", protocol_record_count: 0, raw_protocol_candidate_count: 0,
    payload: { replayRecords: [], rawProtocolCandidateCount: 0,
      blockDescriptorCommitment: commitment("block-" + index), replayDescriptorCommitment: commitment("replay-" + index) },
  }));
}
function rollingWitness(blocks) {
  let witness = createHash("sha256").update(JSON.stringify(["dns-page-link-block-witness-chain-v1", "livenet", activationHeight])).digest("hex");
  for (const row of blocks) witness = createHash("sha256").update(JSON.stringify([witness, row.height,
    row.block_hash, row.payload.blockDescriptorCommitment, row.payload.replayDescriptorCommitment])).digest("hex");
  return witness;
}
function readerRuntime({ blocks = rows(), anchors = [{ block_hash: blocks[0]?.block_hash }], pending = [] } = {}) {
  const queries = [];
  let connections = 0, releases = 0;
  const last = blocks.at(-1);
  const scan = { indexed_through_block: last.height,
    payload: { complete: true, tipHeight: last.height, indexedThroughBlockHash: last.block_hash },
    consistency: { ok: true, status: "block-scan-current" } };
  const client = {
    async query(sql, values = []) {
      queries.push({ sql, values });
      if (sql.includes("dns_page_link_verified_prefix_anchor")) return { rows: anchors };
      if (sql.includes("dns_page_link_raw_block_coverage")) return { rows: blocks.filter(row => row.height >= values[1] && row.height <= values[2]).slice(0, 8) };
      if (sql.includes("dns_page_link_pending_candidates")) {
        assert.match(sql, /left\(carrier\.payload_text, length\(\$2::text\)\) = \$2::text/u);
        return { rows: pending.filter(row => row.payload.startsWith(values[1])).map(({ txid }) => ({ txid })) };
      }
      if (/^(?:BEGIN |SET LOCAL |COMMIT$|ROLLBACK$)/u.test(sql)) return { rows: [] };
      throw new Error("Unexpected SQL in DNS integration test");
    },
    release() { releases += 1; },
  };
  const context = vm.createContext({ createHash,
    proofIndexPool: () => ({ connect: async () => { connections += 1; return client; } }),
    latestProofIndexScanMetadata: async () => scan,
    normalizedLowerText: value => String(value ?? "").toLowerCase(),
    WORK_AMO_V5_ACTIVATION_HEIGHT: 959621,
    WORK_AMO_V5_BLOCK_SEQUENCER_MODEL: "v5", WORK_AMO_V8_BLOCK_SEQUENCER_MODEL: "v8",
  });
  vm.runInContext(readerFunction, context);
  const admitted = [];
  const options = { activationHeight, expectedHeight: last.height, expectedHash: last.block_hash,
    protocolPrefix: DNS_SUBDOMAIN_PAGE_LINK_PREFIX, activationPreviousBlockHash: DNS_SUBDOMAIN_PAGE_LINK_PREDECESSOR_HASH,
    onBlock: async row => { admitted.push(row); } };
  return { context, queries, options, admitted, connections: () => connections, releases: () => releases };
}

test("actual reader isolates pending child-page prefix while preserving complete raw block coverage", async () => {
  const blocks = rows(), childTxid = blockHash(500);
  const runtime = readerRuntime({ blocks, pending: [
    { txid: childTxid, payload: DNS_SUBDOMAIN_PAGE_LINK_PREFIX + "child" },
    { txid: blockHash(501), payload: "pwdns1:page1:root" },
    { txid: blockHash(502), payload: "pwdns1:sub1:child" },
  ] });
  const result = await runtime.context.proofIndexDnsPageLinkDiscovery("livenet", runtime.options);
  assert.equal(result.complete, true);
  assert.equal(result.blockCount, 2);
  assert.equal(result.witnessSha256, rollingWitness(blocks));
  assert.deepEqual(Array.from(result.pendingTxids), [childTxid]);
  assert.deepEqual(runtime.admitted, blocks, "prefix narrows pending discovery, never confirmed raw block membership");
  const pending = runtime.queries.find(query => query.sql.includes("dns_page_link_pending_candidates"));
  assert.deepEqual(Array.from(pending.values), ["livenet", DNS_SUBDOMAIN_PAGE_LINK_PREFIX]);
  assert.equal(runtime.releases(), 1);
  assert.ok(runtime.queries.some(query => query.sql === "COMMIT"));
});

test("child reader rejects absent or malformed predecessor and unknown lane before connecting", async () => {
  for (const predecessor of [undefined, "", "malformed", "AB".repeat(32)]) {
    const runtime = readerRuntime();
    await assert.rejects(runtime.context.proofIndexDnsPageLinkDiscovery("livenet", {
      ...runtime.options, activationPreviousBlockHash: predecessor,
    }), /exact canonical coverage/u);
    assert.equal(runtime.connections(), 0);
  }
  const runtime = readerRuntime();
  await assert.rejects(runtime.context.proofIndexDnsPageLinkDiscovery("livenet", {
    ...runtime.options, protocolPrefix: "pwdns1:unreviewed:",
  }), /exact canonical coverage/u);
  assert.equal(runtime.connections(), 0);
});

test("child reader rejects a different activation predecessor before any carrier admission", async () => {
  for (const alter of ["row", "pin"]) {
    const blocks = rows();
    if (alter === "row") blocks[0].previous_block_hash = blockHash(999);
    const runtime = readerRuntime({ blocks });
    const options = { ...runtime.options,
      ...(alter === "pin" ? { activationPreviousBlockHash: blockHash(999) } : {}) };
    await assert.rejects(runtime.context.proofIndexDnsPageLinkDiscovery("livenet", options), /noncontiguous/u);
    assert.equal(runtime.admitted.length, 0);
    assert.equal(runtime.releases(), 1);
    assert.ok(runtime.queries.some(query => query.sql === "ROLLBACK"));
    assert.ok(!runtime.queries.some(query => query.sql.includes("dns_page_link_pending_candidates")));
  }
});

test("child reader resumes only a unique unchanged index anchor and exact rolling prefix", async () => {
  const blocks = rows();
  for (const anchors of [[{ block_hash: blocks[0].block_hash }], [],
    [{ block_hash: blocks[0].block_hash }, { block_hash: blocks[0].block_hash }], [{ block_hash: blockHash(999) }]]) {
    const runtime = readerRuntime({ blocks, anchors });
    const options = { ...runtime.options, fromHeight: activationHeight + 1,
      verifiedPrefix: { height: activationHeight, blockHash: blocks[0].block_hash, witnessSha256: rollingWitness([blocks[0]]) } };
    const result = runtime.context.proofIndexDnsPageLinkDiscovery("livenet", options);
    if (anchors.length === 1 && anchors[0].block_hash === blocks[0].block_hash) {
      const coverage = await result;
      assert.equal(coverage.witnessSha256, rollingWitness(blocks));
      assert.deepEqual(runtime.admitted, [blocks[1]]);
    } else {
      await assert.rejects(result, /prefix is no longer canonical/u);
      assert.equal(runtime.admitted.length, 0);
      assert.ok(runtime.queries.some(query => query.sql === "ROLLBACK"));
    }
    assert.equal(runtime.releases(), 1);
  }
});

test("default root-page reader retains its own pending prefix without a new predecessor requirement", async () => {
  const runtime = readerRuntime({ pending: [{ txid: blockHash(500), payload: "pwdns1:page1:root" },
    { txid: blockHash(501), payload: DNS_SUBDOMAIN_PAGE_LINK_PREFIX + "child" }] });
  const { protocolPrefix, activationPreviousBlockHash, ...options } = runtime.options;
  const result = await runtime.context.proofIndexDnsPageLinkDiscovery("livenet", options);
  assert.deepEqual(Array.from(result.pendingTxids), [blockHash(500)]);
});

function deferred() {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return { promise, resolve };
}
function warmRuntime({ checkpoints = [{ height: 100, blockHash: blockHash(100) }],
  openings = [10, 20, 30], enabled = true, lane = async () => {} } = {}) {
  const calls = [], timers = [], logs = [];
  let coreReads = 0, active = 0, maxActive = 0;
  function discovery(name) {
    const discover = async (network, checkpoint, opening) => {
      active += 1; maxActive = Math.max(maxActive, active);
      calls.push({ lane: name, network, checkpoint, opening });
      try { return await lane(name, checkpoint); }
      finally { active -= 1; }
    };
    discover.progress = (network, opening) => ({ verifiedThroughBlock: opening, targetHeight: 100, network });
    return discover;
  }
  const context = vm.createContext({ BITCOIN_RPC_URL: enabled ? "configured" : "",
    DNS_SUBDOMAIN_ACTIVATION_HEIGHT: openings[0], DNS_PAGE_LINK_ACTIVATION_HEIGHT: openings[1],
    DNS_SUBDOMAIN_PAGE_LINK_ACTIVATION_HEIGHT: openings[2],
    discoverDnsSubdomains: discovery("subdomains"), discoverDnsPageLinks: discovery("root-pages"),
    discoverDnsSubdomainPageLinks: discovery("child-pages"),
    bitcoinRpc: async (method, args) => {
      assert.equal(method, "getblockchaininfo"); assert.deepEqual(Array.from(args), []);
      const checkpoint = checkpoints[Math.min(coreReads, checkpoints.length - 1)];
      coreReads += 1; return checkpoint;
    },
    exactCoreTipFromBlockchainInfo: value => value,
    errorSummary: error => error.message,
    console: { log: raw => logs.push(JSON.parse(raw)) },
    setTimeout: (callback, delay) => {
      const timer = { callback, delay, unreferenced: false };
      timers.push(timer); return { unref: () => { timer.unreferenced = true; } };
    },
  });
  vm.runInContext(warmFunction, context);
  return { context, calls, timers, logs, coreReads: () => coreReads, maxActive: () => maxActive };
}
async function finishScheduledTurn(runtime, timerIndex = 0) {
  runtime.timers[timerIndex].callback();
  for (let turn = 0; turn < 10 && runtime.timers.length <= timerIndex + 1; turn += 1) {
    await new Promise(resolve => setImmediate(resolve));
  }
  assert.equal(runtime.timers.length, timerIndex + 2, "one completed retry schedules exactly one successor");
}

test("actual DNS warmer permits one run and one sequential lane at a time", async () => {
  const gate = deferred();
  const runtime = warmRuntime({ lane: async name => { if (name === "subdomains") await gate.promise; } });
  const running = runtime.context.warmDnsVerifiedCoverage();
  await new Promise(resolve => setImmediate(resolve));
  await runtime.context.warmDnsVerifiedCoverage();
  await runtime.context.warmDnsVerifiedCoverage();
  assert.equal(runtime.coreReads(), 1);
  assert.deepEqual(runtime.calls.map(call => call.lane), ["subdomains"]);
  assert.equal(runtime.timers.length, 0, "overlapping calls do not schedule extra timers");
  gate.resolve(); await running;
  assert.deepEqual(runtime.calls.map(call => call.lane), ["subdomains", "root-pages", "child-pages"]);
  assert.equal(runtime.maxActive(), 1);
  assert.equal(runtime.timers.length, 1);
  assert.equal(runtime.timers[0].delay, 60_000);
  assert.equal(runtime.timers[0].unreferenced, true);
});

test("catch-up errors continue other lanes, retry at two seconds, and acquire a fresh Core checkpoint", async () => {
  const first = { height: 100, blockHash: blockHash(100) }, second = { height: 101, blockHash: blockHash(101) };
  const runtime = warmRuntime({ checkpoints: [first, second], lane: async (name, checkpoint) => {
    if (checkpoint === first && name === "subdomains") throw Object.assign(new Error("verified prefix catch-up"), { code: "DNS_DISCOVERY_CATCH_UP" });
    if (checkpoint === first && name === "root-pages") throw new Error("index temporarily unavailable");
  } });
  await runtime.context.warmDnsVerifiedCoverage();
  assert.deepEqual(runtime.calls.map(call => call.lane), ["subdomains", "root-pages", "child-pages"]);
  assert.equal(runtime.timers[0].delay, 2_000, "catch-up chooses the shortest bounded retry");
  assert.equal(runtime.logs.length, 2);
  assert.equal(runtime.logs[0].complete, false);
  assert.equal(runtime.logs[0].lane, "subdomains");
  assert.equal(runtime.logs[0].progress.verifiedThroughBlock, 10);
  assert.equal(runtime.logs[1].lane, "root-pages");
  await finishScheduledTurn(runtime);
  assert.equal(runtime.coreReads(), 2);
  assert.deepEqual(runtime.calls.slice(3).map(call => call.checkpoint), [second, second, second]);
  assert.equal(runtime.timers[1].delay, 60_000);
  assert.ok(runtime.timers.every(timer => timer.unreferenced));
});

test("ordinary DNS lane and Core failures retry without retaining the in-flight flag", async () => {
  const lane = warmRuntime({ lane: async name => { if (name === "child-pages") throw new Error("raw block unavailable"); } });
  await lane.context.warmDnsVerifiedCoverage();
  assert.equal(lane.timers[0].delay, 15_000);
  await finishScheduledTurn(lane);
  assert.equal(lane.calls.length, 6);
  assert.equal(lane.maxActive(), 1);
  const core = warmRuntime({ checkpoints: [null, { height: 100, blockHash: blockHash(100) }] });
  await core.context.warmDnsVerifiedCoverage();
  assert.equal(core.timers[0].delay, 15_000);
  assert.equal(core.calls.length, 0);
  assert.match(core.logs[0].reason, /Core checkpoint/u);
  await finishScheduledTurn(core);
  assert.equal(core.calls.length, 3);
  assert.equal(core.timers[1].delay, 60_000);
});

test("DNS warmer skips unopened lanes and performs no work without configured Core", async () => {
  const inactive = warmRuntime({ openings: [0, 101, 100] });
  await inactive.context.warmDnsVerifiedCoverage();
  assert.deepEqual(inactive.calls.map(call => call.lane), ["child-pages"]);
  assert.equal(inactive.timers.length, 1);
  const disabled = warmRuntime({ enabled: false });
  await disabled.context.warmDnsVerifiedCoverage();
  assert.equal(disabled.coreReads(), 0);
  assert.equal(disabled.calls.length, 0);
  assert.equal(disabled.timers.length, 0);
});
