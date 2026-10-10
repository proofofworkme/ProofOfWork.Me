import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { performance } from "node:perf_hooks";
import test from "node:test";
import vm from "node:vm";
import { MarketplaceRegressionHttpError } from "./marketplace-canonical-convergence.mjs";

const surfaceUrl = new URL("./audit-production-surfaces.mjs", import.meta.url);
const surfaceSource = readFileSync(surfaceUrl, "utf8");
const ledgerSource = readFileSync(new URL("./audit-ledger-consistency.mjs", import.meta.url), "utf8");
// Execute the complete actual validator group: none of its helpers are stubbed.
const validators = vm.runInNewContext(`${surfaceSource.slice(
  surfaceSource.indexOf("function assertCondition("),
  surfaceSource.indexOf("async function fetchText("),
)}; ({ firstNonNegativeInteger, validateIndexedJson, validateRegistrySummary,
  validateDnsRegistrySummary, validateTokenSummary, validateMarketplaceSummary,
  validateWorkToken, validateWorkSummary, validateBondSummary,
  validateGrowthSummary, validateHealth, validateConsistency })`);

function summary() {
  return {
    indexedThroughBlock: 100,
    stats: { records: 1, total: 0, tokens: 1 },
    records: [],
    coverage: { complete: true },
    checkpointHash: "a".repeat(64),
    token: { stats: { confirmedTokens: 1, openListings: 0 } },
    listingAuthority: { model: "proof-token-market-core-gettxout-v1" },
    work: {}, floor: {}, networkValueSats: "1", ok: true, ready: true, failedChecks: [],
  };
}

const productValidators = vm.runInNewContext(`${surfaceSource.slice(
  surfaceSource.indexOf("function assertCondition("),
  surfaceSource.indexOf("async function fetchText("),
)}; ({ validateJobs, validateSearch, validateCode, validatePermission })`);

function productSummary(kind) {
  const hash = "a".repeat(64);
  const base = { network: "livenet", complete: true, indexedThroughBlock: 970546,
    indexedThroughBlockHash: hash, snapshot: { id: "surface-fixture", checkpointHeight: 970546, checkpointHash: hash } };
  if (kind === "jobs") return { ...base, source: "proof-indexer-exact-canonical-jobs-replay",
    activationHeight: 970404, activationPreviousBlockHash: "00000000000000000000cf98017be585521a2a84e4030e20021565479c6218fe",
    jobs: [], stats: { jobs: 0, acceptedPayments: 0, paid: 0, paidProofs: "0" } };
  if (kind === "code") return { ...base, source: "proof-indexer-exact-canonical-code-replay", repositories: [] };
  if (kind === "permission") return { ...base, source: "proof-indexer-exact-canonical-permission-replay", permissions: [],
    coverage: { complete: true, indexedThroughBlock: base.indexedThroughBlock, checkpointHash: hash } };
  if (kind === "search") return { network: "livenet", results: [], coverage: { ready: true, checkpointHeight: base.indexedThroughBlock, checkpointHash: hash } };
  throw new Error(`Unknown product fixture: ${kind}`);
}

for (const [kind, name] of [["jobs", "validateJobs"], ["code", "validateCode"], ["permission", "validatePermission"], ["search", "validateSearch"]]) {
  test(`${kind} surface audit requires qualified canonical coverage`, () => {
    const validate = productValidators[name];
    const valid = productSummary(kind);
    validate(valid);
    assert.throws(() => validate({ ...valid, network: "testnet4" }));
    assert.throws(() => validate({ ...valid, error: "Read unavailable" }));
    if (kind === "search") {
      assert.throws(() => validate({ ...valid, coverage: { ...valid.coverage, ready: false } }));
      assert.throws(() => validate({ ...valid, coverage: { ...valid.coverage, checkpointHash: "bad" } }));
      assert.throws(() => validate({ ...valid, results: null }));
    } else {
      assert.throws(() => validate({ ...valid, complete: false }));
      assert.throws(() => validate({ ...valid, source: "unverified-preview" }));
      if (kind === "permission") {
        assert.throws(() => validate({ ...valid, coverage: { ...valid.coverage, complete: false } }));
        assert.throws(() => validate({ ...valid, coverage: { ...valid.coverage, checkpointHash: "bad" } }));
        assert.throws(() => validate({ ...valid, permissions: null }));
      } else {
        assert.throws(() => validate({ ...valid, snapshot: { ...valid.snapshot, checkpointHash: "b".repeat(64) } }));
        assert.throws(() => validate({ ...valid, indexedThroughBlockHash: "bad" }));
      }
    }
  });
}

const malformedIntegers = [null, false, true, "", " ", [], [0], {}, undefined,
  -1, 1.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1, "9007199254740992",
  "00", " 1", "1 ", "+1", "1e3", "0x10", "1.0", "-1", 0n];

test("all actual surface validators reject malformed checkpoint values", () => {
  for (const [name, validate] of Object.entries(validators)) {
    if (name === "firstNonNegativeInteger") continue;
    validate(summary());
    for (const value of malformedIntegers) {
      assert.throws(() => validate({ ...summary(), indexedThroughBlock: value }),
        /missing indexed block checkpoint/u, `${name} accepted ${String(value)}`);
    }
  }
});

test("actual count validators reject coercion and preserve exact supported alternatives", () => {
  for (const value of malformedIntegers) {
    assert.throws(() => validators.validateRegistrySummary({ indexedThroughBlock: 100, stats: { records: value } }));
    assert.throws(() => validators.validateTokenSummary({ indexedThroughBlock: 100, stats: { tokens: value } }));
    assert.throws(() => validators.validateDnsRegistrySummary({ ...summary(), stats: { total: value } }));
    assert.throws(() => validators.validateMarketplaceSummary({ ...summary(), token: {
      stats: { confirmedTokens: value, openListings: 0 },
    } }));
    assert.throws(() => validators.validateMarketplaceSummary({ ...summary(), token: {
      stats: { confirmedTokens: 1, openListings: value },
    } }));
  }
  for (const value of [0, "0", 42, "42", Number.MAX_SAFE_INTEGER, String(Number.MAX_SAFE_INTEGER)]) {
    validators.validateRegistrySummary({ indexedThroughBlock: value, stats: { records: value } });
  }
  assert.equal(validators.firstNonNegativeInteger({ a: null, b: "7" }, ["a", "b"]), 7);
  validators.validateRegistrySummary({ summarySnapshot: { indexedThroughBlock: "100" }, totalCount: "0" });
  validators.validateTokenSummary({ tipHeight: 100, tokens: [] });
  validators.validateMarketplaceSummary({ indexedThroughBlock: 100, listingAuthority: summary().listingAuthority,
    token: { tokens: [], listings: [] } });
  assert.throws(() => validators.validateDnsRegistrySummary({ ...summary(), stats: { total: 1 } }), /disagrees/u);
  assert.throws(() => validators.validateDnsRegistrySummary({ ...summary(), coverage: { complete: false } }), /incomplete/u);
});

function ledgerRequest(fetch) {
  const timers = new Map();
  let timerId = 0;
  const source = ledgerSource.slice(ledgerSource.indexOf("async function requestJson("),
    ledgerSource.indexOf("async function readJson("));
  const request = vm.runInNewContext(`${source}; requestJson`, {
    fetch, AbortController, MarketplaceRegressionHttpError,
    endpoint: (path) => `https://example.invalid${path}?network=livenet`,
    AUDIT_REQUEST_TIMEOUT_MS: 25,
    setTimeout: (callback) => { timers.set(++timerId, callback); return timerId; },
    clearTimeout: (id) => timers.delete(id),
  });
  return { request, timers, expire() {
    assert.equal(timers.size, 1, "deadline must remain armed through body consumption");
    const [id, callback] = [...timers][0];
    timers.delete(id);
    callback();
  } };
}

for (const ok of [true, false]) {
  test(`ledger deadline aborts stalled ${ok ? "success" : "error"} body after headers`, async () => {
    let enteredBody;
    let aborted = false;
    const entered = new Promise((resolve) => { enteredBody = resolve; });
    const harness = ledgerRequest(async (_url, { signal }) => ({ ok, status: ok ? 200 : 503,
      json: () => new Promise((_resolve, reject) => {
        signal.addEventListener("abort", () => {
          aborted = true;
          reject(new DOMException("body cancelled", "AbortError"));
        }, { once: true });
        enteredBody();
      }),
    }));
    const pending = harness.request("/stall");
    await entered;
    harness.expire();
    await assert.rejects(pending, /\/stall timed out after 25ms/u);
    assert.equal(aborted, true);
    assert.equal(harness.timers.size, 0);
  });
}

test("ledger deadline also covers stalled headers and fetch rejection cleans up", async () => {
  const stalled = ledgerRequest((_url, { signal }) => new Promise((_resolve, reject) => {
    signal.addEventListener("abort", () => reject(new DOMException("headers cancelled", "AbortError")), { once: true });
  }));
  const pending = stalled.request("/headers");
  stalled.expire();
  await assert.rejects(pending, /timed out after 25ms/u);
  const failed = ledgerRequest(async () => { throw new Error("connection lost"); });
  await assert.rejects(failed.request("/failed"), /connection lost/u);
  assert.equal(failed.timers.size, 0);
});

test("ledger normal and malformed bodies preserve semantics and clean up deadlines", async () => {
  const payload = { exact: "9007199254740993" };
  let signal;
  const good = ledgerRequest(async (_url, options) => {
    signal = options.signal;
    return { ok: true, json: async () => payload };
  });
  assert.deepEqual(await good.request("/ok"), payload);
  assert.equal(good.timers.size, 0);
  assert.equal(signal.aborted, false);
  const malformed = ledgerRequest(async () => ({ ok: true,
    json: async () => { throw new SyntaxError("invalid JSON"); },
  }));
  await assert.rejects(malformed.request("/malformed"), SyntaxError);
  assert.equal(malformed.timers.size, 0);
  for (const body of [async () => ({ error: "unavailable" }), async () => { throw new SyntaxError("not JSON"); }]) {
    const failure = ledgerRequest(async () => ({ ok: false, status: 503, json: body }));
    await assert.rejects(failure.request("/error"), (error) => error instanceof MarketplaceRegressionHttpError && error.statusCode === 503);
    assert.equal(failure.timers.size, 0);
  }
});

const executableSurfaceSource = surfaceSource.replace(/^#![^\n]*\n/u, "")
  .replace(/^import .*;\n/gmu, "")
  .replaceAll("import.meta.url", JSON.stringify(surfaceUrl.href));

async function surfaceRun({ receipt, args = [], now = Date.now(), stopAfterCheckpoint = 0, failHome = false,
  redirectApi = "", redirectHome = "" } = {}) {
  const resumePath = "memory-only-receipt";
  const files = new Map(receipt === undefined ? [] : [[resumePath,
    typeof receipt === "string" ? receipt : JSON.stringify(receipt)]]);
  const requests = [], writes = [], logs = [];
  let checkpoints = 0, payload;
  class AuditDate extends Date {
    constructor(...values) { super(...(values.length ? values : [now])); }
  }
  const process = { argv: ["node", surfaceUrl.pathname, "--json", `--resume-file=${resumePath}`, ...args], env: {}, exitCode: 0 };
  const context = vm.createContext({
    createHash, randomUUID, Date: AuditDate, performance, URL, AbortController, setTimeout, clearTimeout, process,
    fs: {
      readFileSync: (path) => {
        if (String(path) === surfaceUrl.href) return Buffer.from(surfaceSource);
        if (!files.has(path)) throw Object.assign(new Error("not found"), { code: "ENOENT" });
        return files.get(path);
      },
      writeFileSync: (path, value) => { files.set(path, value); writes.push(path); },
      renameSync: (from, to) => {
        files.set(to, files.get(from)); files.delete(from);
        if (++checkpoints === stopAfterCheckpoint) throw new Error("simulated interruption after atomic checkpoint");
      },
    },
    console: { log: (value) => { payload = JSON.parse(value); }, error: (value) => logs.push(value) },
    fetch: async (url) => {
      requests.push(String(url));
      if (failHome && String(url) === "https://proofofwork.me/") throw new Error("temporary shell failure");
      const parsed = new URL(url);
      const asset = parsed.pathname === "/assets/app.js";
      const api = parsed.pathname.startsWith("/api/") || parsed.pathname === "/health";
      const observedUrl = api && redirectApi
        ? new URL(redirectApi, parsed).href
        : String(url) === "https://proofofwork.me/" && redirectHome ? redirectHome : String(url);
      return { status: 200, url: observedUrl, headers: { get: () => asset ? "application/javascript" : api ? "application/json" : "text/html" },
        text: async () => asset ? "export {};" : api ? JSON.stringify(
          parsed.pathname === "/api/v1/jobs" ? productSummary("jobs") :
          parsed.pathname === "/api/v1/code-repositories" ? productSummary("code") :
          parsed.pathname === "/api/v1/permissions" ? productSummary("permission") :
          parsed.pathname === "/api/v1/search" ? productSummary("search") : summary()) :
          '<title>ProofOfWork</title><div id="root"></div><script type="module" src="/assets/app.js"></script>',
      };
    },
  });
  let error;
  try { await new vm.Script(`(async () => {${executableSurfaceSource}\n})()`).runInContext(context); }
  catch (caught) { error = caught; }
  let savedReceipt = files.get(resumePath);
  try { savedReceipt = JSON.parse(savedReceipt); } catch { /* Preserve malformed input for rejection assertions. */ }
  return { payload, error, requests, writes, logs, exitCode: process.exitCode,
    receipt: savedReceipt };
}

test("matching interrupted audit reuses only original successes with explicit provenance", async () => {
  const now = Date.now();
  const interrupted = await surfaceRun({ now, stopAfterCheckpoint: 1 });
  assert.match(interrupted.error.message, /simulated interruption/u);
  assert.equal(interrupted.receipt.results.length, 1);
  assert.equal(interrupted.receipt.complete, false);
  const resumed = await surfaceRun({ receipt: interrupted.receipt, now: now + 1_000 });
  assert.equal(resumed.error, undefined);
  assert.equal(resumed.payload.complete, true);
  assert.equal(resumed.payload.currentRunComplete, false);
  assert.equal(resumed.payload.ok, true);
  assert.equal(resumed.payload.auditId, interrupted.receipt.auditId);
  assert.equal(resumed.payload.startedAt, interrupted.receipt.startedAt);
  assert.equal(resumed.payload.runStartedAt, new Date(now + 1_000).toISOString());
  assert.deepEqual(resumed.payload.observations, { currentRun: resumed.payload.surfacePlan.length - 1, reused: 1 });
  assert.equal(resumed.payload.results[0].evidence, "reused");
  assert.equal(resumed.payload.results[0].finishedAt, interrupted.receipt.results[0].finishedAt);
  assert.equal(resumed.requests.includes("https://proofofwork.me/"), false);
  const completeResume = await surfaceRun({ receipt: resumed.receipt, now: now + 2_000 });
  assert.equal(completeResume.error, undefined);
  assert.equal(completeResume.requests.length, 0);
  assert.equal(completeResume.payload.observations.reused, completeResume.payload.surfacePlan.length);
  assert.equal(completeResume.payload.currentRunComplete, false);
  assert.equal(completeResume.payload.startedAt, interrupted.receipt.startedAt);
});

test("matching failed surfaces retry and retain the original failure receipt", async () => {
  const now = Date.now();
  const failed = await surfaceRun({ now, failHome: true, stopAfterCheckpoint: 1 });
  assert.equal(failed.receipt.results[0].ok, false);
  const resumed = await surfaceRun({ receipt: failed.receipt, now: now + 1_000 });
  assert.equal(resumed.error, undefined);
  assert.equal(resumed.payload.ok, true);
  assert.equal(resumed.requests.includes("https://proofofwork.me/"), true);
  assert.equal(resumed.payload.results[0].previousAttempts[0].error, "temporary shell failure");
  assert.equal(resumed.payload.results[0].previousAttempts[0].finishedAt, failed.receipt.results[0].finishedAt);
  const retryReceipt = await surfaceRun({ receipt: resumed.receipt, now: now + 2_000 });
  assert.equal(retryReceipt.error, undefined);
  assert.equal(retryReceipt.requests.length, 0);
});

test("wrong origin, mode, source, stale and incompatible resumes fail before network or writes", async () => {
  const now = Date.now();
  const base = (await surfaceRun({ now, stopAfterCheckpoint: 1 })).receipt;
  const changes = [
    (p) => { p.apiBase = "https://unrelated.invalid"; },
    (p) => { p.pageOnly = true; },
    (p) => { p.fresh = false; },
    (p) => { p.sourceSha256 = "0".repeat(64); },
    (p) => { p.schemaVersion = 0; },
    (p) => { p.timeoutMs += 1; },
    (p) => { p.surfacePlan.reverse(); },
    (p) => { p.results[0].probes = []; },
    (p) => { p.results[0].probes[0].url = "https://unrelated.invalid/"; },
    (p) => { p.results[0].probes[0].requestedUrl = "https://unrelated.invalid/"; },
    (p) => { p.results[0].html.assets.modules = 0; },
    (p) => { p.results.push(p.results[0]); },
    (p) => { p.startedAt = new Date(now - 3_600_001).toISOString(); },
    (p) => { p.finishedAt = new Date(now + 1).toISOString(); },
    (p) => { p.ok = true; },
  ];
  for (const change of changes) {
    const prior = structuredClone(base);
    change(prior);
    const rejected = await surfaceRun({ receipt: prior, now });
    assert.match(rejected.error?.message ?? "", /Invalid resume evidence/u);
    assert.equal(rejected.requests.length, 0);
    assert.equal(rejected.writes.length, 0);
    assert.deepEqual(rejected.receipt, prior);
  }
  const wrongScope = await surfaceRun({ receipt: base, now, args: ["--surface=home"] });
  assert.match(wrongScope.error.message, /ordered surface plan differs/u);
  const oldFormat = await surfaceRun({ receipt: { results: base.surfacePlan.map(({ key }) => ({ key, ok: true })) }, now });
  assert.match(oldFormat.error.message, /unsupported resume receipt schema/u);
  const invalidJson = await surfaceRun({ receipt: "not JSON", now });
  assert.match(invalidJson.error.message, /Invalid resume evidence/u);
});

test("page-only resumes stay page-only and cannot be upgraded to full evidence", async () => {
  const now = Date.now();
  const original = await surfaceRun({ now, args: ["--page-only", "--surface=home"] });
  assert.equal(original.payload.ok, true);
  assert.equal(original.payload.currentRunComplete, true);
  assert.equal(original.payload.results[0].probes.length, 0);
  const same = await surfaceRun({ receipt: original.receipt, now: now + 1_000, args: ["--page-only", "--surface=home"] });
  assert.equal(same.payload.ok, true);
  assert.equal(same.requests.length, 0);
  assert.equal(same.payload.pageOnly, true);
  const upgrade = await surfaceRun({ receipt: original.receipt, now: now + 1_000, args: ["--surface=home"] });
  assert.match(upgrade.error.message, /audit settings differ/u);
  assert.equal(upgrade.requests.length, 0);
});

test("same-origin API redirects and the canonical Home www redirect remain resumable", async () => {
  const now = Date.now();
  const original = await surfaceRun({ now, args: ["--surface=home"],
    redirectApi: "/api/v1/registry-summary?network=livenet&fresh=1&redirected=1",
    redirectHome: "https://www.proofofwork.me/",
  });
  assert.equal(original.payload.ok, true);
  const result = original.payload.results[0];
  assert.equal(result.html.requestedUrl, "https://proofofwork.me/");
  assert.equal(result.html.url, "https://www.proofofwork.me/");
  assert.match(result.probes[0].requestedUrl, /fresh=1$/u);
  assert.match(result.probes[0].url, /redirected=1$/u);
  const resumed = await surfaceRun({ receipt: original.receipt, now: now + 1_000, args: ["--surface=home"] });
  assert.equal(resumed.error, undefined);
  assert.equal(resumed.payload.ok, true);
  assert.equal(resumed.requests.length, 0);
  assert.equal(resumed.payload.currentRunComplete, false);
  for (const options of [{ redirectApi: "https://unrelated.invalid/api" },
    { redirectHome: "https://unrelated.invalid/" }]) {
    const foreign = await surfaceRun({ now, args: ["--surface=home"], ...options });
    assert.equal(foreign.payload.ok, false);
    assert.match(foreign.payload.results[0].error, /unexpected .* response origin/u);
  }
});
