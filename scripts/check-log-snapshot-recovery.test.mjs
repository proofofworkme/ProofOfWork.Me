import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";

const transpile = (source) => ts.transpileModule(source, { compilerOptions: {
  target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext,
} }).outputText;
const state = await readFile("src/shared/api/proofApiReadState.ts", "utf8");
const { ProofApiRequestError } = await import(`data:text/javascript;base64,${Buffer.from(transpile(state)).toString("base64")}`);
const source = await readFile("src/App.tsx", "utf8");
const ast = ts.createSourceFile("App.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
function declaration(name) {
  let found;
  function visit(node) {
    if (ts.isFunctionDeclaration(node) && node.name?.text === name) found = node;
    ts.forEachChild(node, visit);
  }
  visit(ast);
  assert.ok(found, name);
  return transpile(found.getText(ast));
}
const names = ["fetchGlobalActivityPayload", "fetchGlobalActivityHistoryPage", "fetchGlobalActivityHistoryRead"];
function client(fetchProofApiJson) {
  return new Function("fetchProofApiJson", "ProofApiRequestError",
    `${names.map(declaration).join("\n")}; return fetchGlobalActivityHistoryRead;`)(fetchProofApiJson, ProofApiRequestError);
}
const code = "CANONICAL_LOG_HISTORY_STABLE_SNAPSHOT_MISMATCH";
const expiry = () => new ProofApiRequestError("expired", { status: 503, code });
const options = { snapshotId: "old", pageIndex: 8, pageSize: 30, query: "ExactQuery" };
const head = { network: "livenet", snapshotId: "new", consistency: { ok: true }, activity: [] };
const page = { network: "livenet", snapshotId: "new", page: 0, items: [{ txid: "new-item" }] };
function queue(responses) {
  const calls = [];
  const read = client(async (path, network, options) => {
    calls.push({ path, network, options });
    assert.ok(responses.length, "unexpected extra network call");
    const next = responses.shift();
    if (next instanceof Error) throw next;
    return typeof next === "function" ? next() : next;
  });
  return { calls, read };
}

test("normal success makes one request and preserves requested page", async () => {
  const expected = { ...page, snapshotId: "old", page: 8 };
  const q = queue([expected]);
  assert.deepEqual(await q.read("livenet", options, () => true), { page: expected });
  assert.equal(q.calls.length, 1);
  assert.match(q.calls[0].path, /page=8/u);
});

test("typed expiry refreshes stable head then replaces with page zero on its exact snapshot", async () => {
  const signal = new AbortController().signal;
  const q = queue([expiry(), head, page]);
  assert.deepEqual(await q.read("livenet", { ...options, signal }, () => true), { page, recoveredHead: head });
  assert.deepEqual(q.calls.map(c => c.path), [
    "/api/v1/log-history?limit=30&page=8&q=ExactQuery&snapshot=old",
    "/api/v1/log-summary",
    "/api/v1/log-history?limit=30&page=0&q=ExactQuery&snapshot=new",
  ]);
  assert.ok(q.calls.every(c => c.network === "livenet" && c.options.signal === signal));
});

for (const [label, error, request] of [
  ["count mismatch", new ProofApiRequestError("count", { status: 503, code: "CANONICAL_LOG_HISTORY_STABLE_MISMATCH" }), options],
  ["untyped same message", new Error(code), options],
  ["incorrect HTTP status", new ProofApiRequestError("expired", { status: 400, code }), options],
  ["unpinned request", expiry(), { ...options, snapshotId: undefined }],
  ["fresh request", expiry(), { ...options, fresh: true }],
]) test(`${label} does not retry or suppress error`, async () => {
  const q = queue([error]);
  await assert.rejects(q.read("livenet", request, () => true), e => e === error);
  assert.equal(q.calls.length, 1);
});

test("second expiry fails without a retry loop", async () => {
  const second = expiry();
  const q = queue([expiry(), head, second]);
  await assert.rejects(q.read("livenet", options, () => true), e => e === second);
  assert.equal(q.calls.length, 3);
});

for (const invalid of [{ ...head, snapshotId: "" }, { ...head, consistency: { ok: false } }, { ...head, network: "testnet4" }]) {
  test(`invalid recovered head is not used: ${JSON.stringify(invalid)}`, async () => {
    const q = queue([expiry(), invalid]);
    await assert.rejects(q.read("livenet", options, () => true), /verified matching summary/u);
    assert.equal(q.calls.length, 2);
  });
}

test("changed snapshot in recovery page remains an error", async () => {
  const q = queue([expiry(), head, { ...page, snapshotId: "third" }]);
  await assert.rejects(q.read("livenet", options, () => true), /requested snapshot/u);
});

test("superseded request before retry makes no further reads", async () => {
  const error = expiry(); const q = queue([error]);
  await assert.rejects(q.read("livenet", options, () => false), e => e === error);
  assert.equal(q.calls.length, 1);
});

test("new query/navigation during head or page read prevents accepting recovered pair", async () => {
  for (const phase of ["head", "page"]) {
    let active = true;
    const q = queue([expiry(), () => { if (phase === "head") active = false; return head; },
      () => { active = false; return page; }]);
    await assert.rejects(q.read("livenet", options, () => active), { name: "AbortError" });
    assert.equal(q.calls.length, phase === "head" ? 2 : 3);
  }
});

test("all three accepting callers guard scope, replace old rows, and rekey recovered snapshot", () => {
  for (const name of ["loadLogHistoryPage", "loadActivityTarget"]) {
    const body = declaration(name);
    assert.match(body, /fetchGlobalActivityHistoryRead/u);
    assert.match(body, /if \(!requestIsActive\(\)\)/u);
    assert.match(body, /if \(recoveredHead\) \{[\s\S]*applyRecoveredActivityHead\(recoveredHead\);[\s\S]*setIdActivity\(page.items \?\? \[\]\);[\s\S]*snapshotId: page.snapshotId/u);
  }
  assert.equal((declaration("loadActivityTarget").match(/if \(recoveredHead\)/gu) ?? []).length, 2);
});

for (const invalid of [{ ...page, network: "testnet4" }, { ...page, network: undefined }, { ...page, page: 8 }, { ...page, page: undefined }]) {
  test("recovery rejects mismatched page scope: " + JSON.stringify(invalid), async () => {
    const q = queue([expiry(), head, invalid]);
    await assert.rejects(q.read("livenet", options, () => true), /wrong network or page/u);
  });
}

test("recovered summary rejection performs no state writes, success replaces snapshot", () => {
  const events = [];
  const ref = { current: { total: 5, confirmed: 5, snapshotId: "old" } };
  const apply = new Function("normalizeActivityStats", "publicLogActivityStats", "activityStatsRegress",
    "acceptedActivityStatsRef", "setActivityStats", "setIdActivity", "idActivity", "mergeActivityItems",
    declaration("applyActivityPayload") + "; return applyActivityPayload;")(
      x => x, x => x.stats, (next, current) => next.total === 0 && current.total > 0,
      ref, x => events.push(["stats", x]), x => events.push(["rows", x]),
      [{ txid: "old-item" }], (a,b) => [...a,...b]);
  assert.throws(() => apply({ ...head, stats: { total: 0, confirmed: 0 } }, true), /regressed/u);
  assert.deepEqual(events, []);
  assert.equal(ref.current.snapshotId, "old");
  apply({ ...head, stats: { total: 6, confirmed: 6 } }, true);
  assert.equal(ref.current.snapshotId, "new");
  assert.equal(events[0][0], "stats");
});

test("count and membership failures never use cached-success fallback", () => {
  const check = new Function("ProofApiRequestError", declaration("isLogHistoryIntegrityError") +
    "; return isLogHistoryIntegrityError;")(ProofApiRequestError);
  for (const code of ["CANONICAL_LOG_HISTORY_STABLE_MISMATCH", "CANONICAL_LOG_EXACT_QUERY_OUTSIDE_SNAPSHOT", "CANONICAL_LOG_EXACT_QUERY_NOT_IN_SNAPSHOT"]) {
    assert.equal(check(new ProofApiRequestError("integrity", { status: 503, code })), true);
  }
  assert.equal(check(expiry()), false);
  for (const name of ["loadLogHistoryPage", "loadActivityTarget"]) {
    assert.match(declaration(name), /Boolean\(cachedPage\) &&\s*!recoveryStarted &&\s*!isLogHistoryIntegrityError\(error\)/u);
  }
});

test("actual recovery caller cancels an earlier head so late response cannot mix snapshots", async () => {
  const events = [];
  const summary = { current: { total: 100, confirmed: 100, snapshotId: "old" } };
  const rows = { current: [{ txid: "old-item" }] };
  let resolveHead;
  const slowHead = new Promise(resolve => { resolveHead = resolve; });
  const refs = {
    activityHeadBusyOwnerRef: { current: undefined }, activityHeadReadControllerRef: { current: undefined },
    activeWorkspaceStatusKeyRef: { current: "log" }, verifiedActivityReadRef: { current: true },
    activityLoadingOwnerRef: { current: undefined }, activityHistoryReadControllerRef: { current: undefined },
    activityHistoryGenerationRef: { current: 0 }, activitySearchGenerationRef: { current: 0 },
    activityQueryRef: { current: "" }, activityProfileRef: { current: undefined },
    activityHistoryPagesRef: { current: new Map() }, acceptedActivityStatsRef: summary,
  };
  const deps = {
    ...refs, network: "livenet", ACTIVITY_FEED_PAGE_SIZE: 30,
    nextProofApiReadAttempt: () => 1, fetchGlobalActivityPayload: () => slowHead,
    fetchGlobalActivityHistoryRead: async () => ({
      page: { ...page }, recoveredHead: { ...head, stats: { total: 102, confirmed: 102 } },
    }),
    normalizeActivityStats: x => x, publicLogActivityStats: x => x.stats,
    finiteNonNegativeNumber: x => Math.max(0, Number(x) || 0),
    setActivityStats: x => events.push(["summary", x.snapshotId]),
    setIdActivity: x => { rows.current = typeof x === "function" ? x(rows.current) : x; },
    idActivity: rows.current, mergeActivityItems: (a,b) => [...a,...b],
    activityHistoryCacheKey: x => JSON.stringify(x),
    acceptActivityHistoryPage: (key, value) => { refs.activityHistoryPagesRef.current.set(key,value); return value; },
    setBusyForWorkspace: () => {}, setStatusForWorkspace: () => {},
    setActivityHistoryReading: () => {}, setActivityLoading: () => {},
    clearLastGoodReadWarning: () => {}, setActivityHistoryReadError: () => {},
    isTransientProofApiReadError: () => false, isLogHistoryIntegrityError: () => false,
    showLastGoodReadWarning: () => false, errorMessage: e => e.message,
  };
  const fn = new Function(...Object.keys(deps), [
    declaration("activityStatsRegress"), declaration("applyActivityPayload"),
    declaration("applyRecoveredActivityHead"), declaration("loadLogHead"), declaration("loadLogHistoryPage"),
    "return {loadLogHead,loadLogHistoryPage};",
  ].join("\n"))(...Object.values(deps));
  const pendingHead = fn.loadLogHead(true);
  const headController = refs.activityHeadReadControllerRef.current;
  await fn.loadLogHistoryPage(8, true, "", { snapshotId: "old" });
  assert.equal(headController.signal.aborted, true);
  assert.equal(summary.current.snapshotId, "new");
  assert.deepEqual(rows.current, page.items);
  resolveHead({ ...head, snapshotId: "old", stats: { total: 100, confirmed: 100 } });
  await pendingHead;
  assert.equal(summary.current.snapshotId, "new");
  assert.deepEqual(rows.current, page.items);
  assert.deepEqual(events, [["summary", "new"]]);
});
