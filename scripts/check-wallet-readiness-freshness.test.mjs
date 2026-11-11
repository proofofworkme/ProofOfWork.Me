import { createWalletReadCoalescer, walletReadIdentity, measurePrivatePhase, withPrivatePhaseTimings } from "../server/wallet-read-observation.mjs";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";

// Execute the actual pure reader/API functions with scheduled publications.
// Import no module that starts a service or connects to a production database.
const reader = ts.createSourceFile("reader.mjs", readFileSync("server/db/proof-index-reader.mjs", "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
const api = ts.createSourceFile("api.mjs", readFileSync("server/proof-api.mjs", "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
function source(ast, name) {
  const found = ast.statements.filter((n) => ts.isFunctionDeclaration(n) && n.name?.text === name);
  assert.equal(found.length, 1, name);
  return found[0].getText(ast).replace(/^export\s+/u, "");
}
function functions(ast, names, globals = {}) {
  const context = vm.createContext({
    walletReadinessPreflightScope: { getStore: () => null },
    walletRequestReadinessMap: (_name, shared) => shared,
    proofIndexPrepareWalletReadiness: async () => true,
    proofIndexWalletReadinessUnavailableError: () => Object.assign(new Error("Fresh wallet credit state is temporarily unavailable."), { statusCode:503 }),
    ...globals,
  });
  return new vm.Script(`${names.map((n) => source(ast, n)).join("\n")}\n({${names.join(",")}})`).runInContext(context);
}
const A = "a".repeat(64), B = "b".repeat(64), C = "c".repeat(64);
const baseNow = Date.parse("2026-10-04T16:00:00.000Z");
const storageModel = "work-subatom-projection-v1";
const normalizedLowerText = (s) => String(s ?? "").trim().toLowerCase();
const fingerprint = (key, restart = false) => ({ key, positiveEligible: true, postmasterStartedAt: restart ? "2026-10-04T15:59:00.000Z" : "2026-10-04T00:00:00.000Z" });
const ready = (key = A, overrides = {}) => ({
  active: true, canonical: true, confirmed: true, evidenceComplete: true,
  exactTipReady: true, parityReady: true, pendingReady: true, replayReady: true,
  ready: true, tipHeight: 969867, tipHash: C, snapshotHash: C,
  pendingValidThrough: new Date(baseNow + 60_000).toISOString(),
  auditedReadinessFingerprintKey: key, ...overrides,
});
const helpers = functions(reader, [
  "exactCheckpointSingleFlight", "deepFreezeReadinessSnapshot",
  "reusableWorkPrecisionV2MigrationReadiness", "rememberWorkPrecisionV2MigrationReadiness",
  "workPrecisionV2MigrationReadinessResultIsReusablePositive",
  "workPrecisionV2MigrationReadinessWithCompactCheckpoint",
], { normalizedLowerText, WORK_PRECISION_V2_READINESS_CACHE_MAX_ENTRIES: 4, WORK_PRECISION_V2_READINESS_CACHE_TTL_MS: 30_000 });
function request(overrides = {}) {
  return {
    inFlight: new Map(), readyCache: new Map(), bootstrapReadyCache: new Map(),
    requestKey: "pinned-declaration", now: () => baseNow,
    loadCompact: async () => fingerprint(A), loadCatalogAttestation: async () => true,
    loadFull: async () => ready(), ...overrides,
  };
}
const check = helpers.workPrecisionV2MigrationReadinessWithCompactCheckpoint;

test("queued publication binds the audited newer epoch without a second full audit", async () => {
  let compact = 0, full = 0;
  const r = request({ allowAuditedEpochRebinding: true,
    loadCompact: async () => fingerprint(compact++ === 0 ? A : B),
    loadFull: async () => { full += 1; return ready(B); },
  });
  const result = await check(r);
  assert.equal(result.auditedReadinessFingerprintKey, B);
  assert.equal(full, 1); assert.equal(compact, 2);
  assert.equal(r.readyCache.has(A), false); assert.equal(r.readyCache.has(B), true);
  assert.equal(Object.isFrozen(result), true);
  assert.equal(await check(r), result); assert.equal(full, 1);
  assert.equal(r.readyCache.get(B).expiresAt, baseNow + 30_000);
});

test("strict callers retain the scheduling epoch fence", async () => {
  let compact = 0; const diagnostics = [];
  const r = request({ loadCompact: async () => fingerprint(compact++ === 0 ? A : B),
    loadFull: async () => ready(B), onUnavailable: (d) => diagnostics.push(d) });
  assert.equal(await check(r), null); assert.equal(r.readyCache.size, 0);
  assert.equal(diagnostics[0].code, "initial-epoch-changed");
});

test("changed epoch after the actual full audit never admits or caches its positive", async () => {
  for (const audited of [A, C, null, "not-a-sha256"]) {
    const r = request({ allowAuditedEpochRebinding: true,
      loadCompact: async () => fingerprint(B), loadFull: async () => ready(audited) });
    assert.equal(await check(r), null); assert.equal(r.readyCache.size, 0);
  }
});

test("an unbound result cannot authorize a newer epoch", async () => {
  let reads = 0; const result = ready(); delete result.auditedReadinessFingerprintKey;
  const r = request({ allowAuditedEpochRebinding: true,
    loadCompact: async () => fingerprint(reads++ === 0 ? A : B), loadFull: async () => result });
  assert.equal(await check(r), null); assert.equal(r.readyCache.size, 0);
});

test("a database restart cannot reuse the earlier catalog attestation", async () => {
  let reads = 0; const diagnostics = [];
  const r = request({ allowAuditedEpochRebinding: true,
    loadCompact: async () => reads++ === 0 ? fingerprint(A) : fingerprint(B, true),
    loadFull: async () => ready(B), onUnavailable: (d) => diagnostics.push(d) });
  assert.equal(await check(r), null); assert.equal(r.readyCache.size, 0);
  assert.equal(diagnostics[0].code, "database-instance-changed");
});

test("no incomplete full proof or summary bootstrap becomes wallet authority", async () => {
  for (const field of ["ready", "active", "canonical", "confirmed", "evidenceComplete", "exactTipReady", "parityReady", "pendingReady", "replayReady"]) {
    const r = request({ allowAuditedEpochRebinding: true,
      loadFull: async () => ready(A, { [field]: false, canonicalSummaryBootstrapReady: true }) });
    const result = await check(r);
    assert.notEqual(result?.ready === true && result?.[field] === true, true);
    assert.equal(r.readyCache.size, 0); assert.equal(r.bootstrapReadyCache.size, 0);
  }
});

test("expiry during the audit cannot extend pending validity", async () => {
  const diagnostics = [];
  const r = request({ now: () => baseNow + 60_000, onUnavailable: (d) => diagnostics.push(d) });
  assert.equal(await check(r), null); assert.equal(r.readyCache.size, 0);
  assert.equal(diagnostics[0].code, "pending-witness-expired");
});

test("single-flight shares work but delivers sanitized refusal to every caller", async () => {
  let loads = 0; const diagnostics = [];
  const secret = "password=must-never-be-logged";
  const r = request({ loadFull: async () => { loads += 1; throw new Error(secret); } });
  const results = await Promise.allSettled(Array.from({ length: 24 }, () => check({
    ...r, onUnavailable: (d) => diagnostics.push(d),
  })));
  assert.equal(loads, 1); assert.equal(diagnostics.length, 24);
  assert.ok(results.every((x) => x.status === "rejected" && x.reason.message === secret));
  assert.ok(diagnostics.every((x) => x.stage === "full-audit" && x.code === "read-exception"));
  assert.equal(JSON.stringify(diagnostics).includes(secret), false);
  assert.equal(r.inFlight.size, 0); assert.equal(r.readyCache.size, 0);
  assert.deepEqual(Object.keys(diagnostics[0]).sort(), ["auditedFingerprintSha256", "code", "initialFingerprintSha256", "model", "settledFingerprintSha256", "stage"].sort());
  assert.equal(await check({ ...r, loadFull: async () => ready() }).then((x) => x.ready), true);
});

test("compact, catalog and final sample refusals identify their stage without a new audit", async () => {
  for (const [override, expectedStage, expectedCode, expectedAudits] of [
    [{ loadCompact: async () => null }, "initial-compact", "compact-contract-unavailable", 0],
    [{ loadCatalogAttestation: async () => false }, "catalog-attestation", "catalog-contract-unavailable", 0],
    [{ loadCatalogAttestation: async () => { throw Error("private SQL"); } }, "catalog-attestation", "read-exception", 0],
    [{ loadCompact: (() => { let count = 0; return async () => ++count === 1 ? fingerprint(A) : null; })() }, "settled-compact", "settled-compact-contract-unavailable", 1],
  ]) {
    let audits = 0; const diagnostics = [];
    const r = request({ loadFull: async () => { audits += 1; return ready(); }, onUnavailable: (d) => diagnostics.push(d), ...override });
    try { assert.equal(await check(r), null); } catch (e) { assert.equal(expectedCode, "read-exception"); }
    assert.equal(audits, expectedAudits); assert.equal(diagnostics[0].stage, expectedStage); assert.equal(diagnostics[0].code, expectedCode);
  }
});

test("observer errors cannot alter acceptance and strict/rebind work never mixes", async () => {
  const r = request({ loadCompact: async () => null, onUnavailable: () => { throw Error("observer"); } });
  assert.equal(await check(r), null);
  const shared = new Map(); let loads = 0;
  const make = (rebind) => { let samples = 0; return request({
    inFlight: shared, allowAuditedEpochRebinding: rebind,
    loadCompact: async () => fingerprint(samples++ === 0 ? A : B),
    loadFull: async () => { loads += 1; return ready(B); },
  }); };
  const [strict, fenced] = await Promise.all([check(make(false)), check(make(true))]);
  assert.equal(strict, null); assert.equal(fenced.ready, true); assert.equal(loads, 2);
});

function apiRead({ epochs = [A, A], read, clock = () => baseNow, scopeGate = () => true, normalizeScope = normalizedLowerText, supply = async (p) => p, capacities = async (p) => p, pendingProof = { tipHeight: 969867, tipHash: C, pendingValidThrough: new Date(baseNow + 60000).toISOString(), membershipSnapshot: {} }, mempoolOk = true, membershipOk = true, snapshotError = null } = {}) {
  let sample = 0; const warnings = []; const options = [];
  class Clock extends Date { static now() { return clock(); } }
  const fn = functions(api, ["proofIndexWalletScopedTokenPayloadForRead"], {
    coalesceWalletRead: createWalletReadCoalescer(), walletReadIdentity, measurePrivatePhase,
    withPrivatePhaseTimings: run => withPrivatePhaseTimings(run, () => {}),
    Date: Clock, console: { error() {}, warn: (s) => warnings.push(JSON.parse(s)) },
    WORK_SUBATOM_PROJECTION_MODEL: storageModel, WALLET_SCOPED_INDEX_WAIT_MS: 15_000,
    normalizeTokenScope: normalizeScope, isWorkTokenId: (id) => id === "work",
    proofIndexReadFeatureEnabled: () => true,
    proofIndexWithWalletReadSnapshot: async (load) => { if (snapshotError) throw snapshotError; return load(); },
    privateReadContext: () => ({}),
    isReadOnlySnapshotBudgetError: error => error === snapshotError && error?.name === "ReadOnlySnapshotBudgetError",
    proofIndexWalletReadSnapshotPendingProof: () => pendingProof,
    bitcoinRpc: async () => ({ ok: mempoolOk, result: [] }),
    workQ16PendingMembershipSnapshotReady: () => membershipOk,
    proofIndexReadinessEpochCheckpoint: async () => ({ sha256: epochs[Math.min(sample++, epochs.length - 1)] }),
    proofIndexWalletTokenOverlayPayload: async (_n, _s, _a, o) => { options.push(o); return read ? read(options.length, o) : wallet("stable"); },
    walletTokenOverlayHasExactCheckpoint: () => true,
    canonicalPublicReadGate: async () => ({}), walletTokenOverlayMatchesCanonicalFreshGate: scopeGate,
    walletOverlayWithCanonicalWorkSupply: supply, walletScopedTokenPayloadFromOverlay: (p) => p,
    walletTokenPayloadMissingDefinitions: () => [], walletPayloadWithCanonicalWorkCapacities: capacities,
    errorSummary: () => "sanitized-existing-error",
  }).proofIndexWalletScopedTokenPayloadForRead;
  return { call: (scope = "work", o = {}) => fn("livenet", scope, ["account"], "test", o), warnings, options, samples: () => sample };
}
function wallet(frame) { return { frame, tokens: [{ tokenId: "work", amountStorageModel: storageModel }], indexedThroughBlock: 969867, indexedThroughBlockHash: C }; }

test("wallet uses one complete snapshot rather than retrying global epoch churn", async () => {
  const read = apiRead({ epochs: [A, B, B, C],
    supply: async (p) => ({ ...p, supplyFrame: p.frame }),
    capacities: async (p) => ({ ...p, capacityFrame: p.frame }) });
  const result = await read.call();
  assert.equal(result.frame, "stable");
  assert.equal(result.supplyFrame, result.frame);
  assert.equal(result.capacityFrame, result.frame);
  assert.equal(read.options.length, 1);
  assert.equal(read.options[0].allowAuditedEpochRebinding, false);
  assert.equal(read.samples(), 0);
});

test("a negative snapshot and closing Core mismatch remain unavailable", async () => {
  const negative = apiRead({ read: async () => null });
  assert.equal(await negative.call(), null);
  let gates = 0;
  const moved = apiRead({ scopeGate: () => ++gates === 1 });
  assert.equal(await moved.call("work", { requireCurrent: true }), null);
  assert.equal(gates, 2);
});

test("non-WORK and historical Q8 retain their precision policy", async () => {
  const nonWork = apiRead({ read: async () => ({ tokens: [{ tokenId: "powb" }] }) });
  assert.equal((await nonWork.call("powb")).tokens[0].tokenId, "powb");
  assert.equal(nonWork.options[0].allowAuditedEpochRebinding, false);
  const q8 = apiRead({ read: async () => ({ tokens: [{ tokenId: "work", amountStorageModel: "historical-q8" }] }) });
  assert.equal((await q8.call()).tokens[0].amountStorageModel, "historical-q8");
});

test("full audit binding comes from its existing repeatable-read checkpoint, not scheduling input", () => {
  const full = source(reader, "proofIndexWorkPrecisionV2MigrationReadinessFullAudit");
  assert.match(full, /readinessEpochCheckpoint\s*=\s*await readWorkPrecisionV2ReadinessEpochCheckpoint\(client, network\)/u);
  assert.match(full, /auditedReadinessFingerprintKey\s*=\s*workPrecisionV2ReadinessCompactFingerprintFromRows\(\[\{/u);
  for (const name of ["maxPreparedTransactions", "postmasterStartedAt", "readinessEpochs", "queueCount", "searchPath"]) assert.ok(full.includes(`readinessEpochCheckpoint?.${name}`));
  assert.match(full, /return \{[\s\S]*auditedReadinessFingerprintKey,/u);
  const queries = (ast) => {
    const out = []; const node = ast.statements.find((n) => ts.isFunctionDeclaration(n) && n.name?.text === "proofIndexWorkPrecisionV2MigrationReadinessFullAudit");
    function visit(n) { if (ts.isCallExpression(n) && n.expression.getText(ast) === "client.query") out.push(n.arguments.map((a) => a.getText(ast)).join("\n")); ts.forEachChild(n, visit); }
    visit(node); return out;
  };
  // Frozen from the approved preparation baseline at HEAD 46c43d8194a9.
  // This independent oracle covers all 21 query argument lists in order.
  assert.equal(queries(reader).length, 21);
  // Both canonical source and the captured November 11 accepted runtime are
  // pinned. This health fix changes neither scan or query argument list.
  assert.ok(new Set([
    "7c0cfee97e5eef05480ee682cce4def62014a50198d315c6a09c9e6c7b496591",
    "312c9df6240106d55ee26cbf453d57f8ef0b28e13a6fd34d6da97d34de8fc237",
  ]).has(createHash("sha256").update(JSON.stringify(queries(reader))).digest("hex")),
    "no extra query or altered full-audit scan");
});


test("an unconfigured reader reports a bounded stage and stays unavailable", async () => {
  const diagnostics = [];
  const read = functions(reader, ["proofIndexWorkPrecisionV2MigrationReadiness"], {
    proofIndexPool: () => null,
    normalizedWorkAmoV6ExpectedPins: (p) => p,
    workPrecisionV2ReadinessRequestKey: () => "valid-request",
  }).proofIndexWorkPrecisionV2MigrationReadiness;
  assert.equal(await read("livenet", {}, { onUnavailable: (d) => diagnostics.push(d) }), null);
  assert.equal(diagnostics[0].stage, "reader-configuration");
  assert.equal(diagnostics[0].code, "reader-not-configured");
  assert.equal(Object.isFrozen(diagnostics[0]), true);
  assert.equal(await read("livenet", {}, { onUnavailable: () => { throw Error("observer"); } }), null);
});

// Production scope normalization uppercases an unrecognized ticker, including ALL.
test("uppercase ALL scope retains the coherent wallet path", async () => {
  const r = apiRead({ normalizeScope: (value) => String(value).toUpperCase(), epochs: [A, B, B, B] });
  assert.equal((await r.call("all")).frame, "stable");
  assert.equal(r.options.length, 1);
  assert.equal(r.samples(), 0);
});

 test("snapshot cannot return Q16 authority without live unexpired bound pending evidence", async () => {
  for (const overrides of [
    { pendingProof: null }, { mempoolOk: false }, { membershipOk: false },
    { pendingProof: { tipHeight: 969867, tipHash: C, pendingValidThrough: new Date(baseNow).toISOString() } },
    { pendingProof: { tipHeight: 969868, tipHash: C, pendingValidThrough: new Date(baseNow + 60000).toISOString() } },
    { pendingProof: { tipHeight: 969867, tipHash: A, pendingValidThrough: new Date(baseNow + 60000).toISOString() } },
  ]) assert.equal(await apiRead(overrides).call("work", { requireCurrent: true }), null);
});


test("known old-tip witness skips catalog and full proof; matching tip still requires full proof", async () => {
  let full = 0, catalog = 0; const reasons = [];
  const r = request({ loadCompact: async () => ({ ...fingerprint(A), knownOldTipWitness: true }),
    loadCatalogAttestation: async () => { catalog++; return true; },
    loadFull: async () => { full++; return ready(A); },
    onUnavailable: diagnostic => reasons.push(diagnostic) });
  assert.equal(await check(r), null); assert.equal(full, 0); assert.equal(catalog, 0);
  assert.ok(JSON.stringify(reasons).includes("pending-witness-old-tip"));
  r.loadCompact = async () => ({ ...fingerprint(A), knownOldTipWitness: false });
  assert.equal((await check(r)).ready, true); assert.equal(full, 1); assert.equal(catalog, 1);
});

test("wallet snapshot budget failure returns controlled unavailable and logs only typed diagnostic", async () => {
  const error = Object.assign(Error("private SQL secret"), { name: "ReadOnlySnapshotBudgetError",
    diagnostic: { stage: "snapshot-query", queryId: 3, cause: "deadline", sqlState: null,
      elapsedMs: 15000, remainingMs: 0, budgetMs: 15000 } });
  const read = apiRead({ snapshotError: error });
  assert.equal(await read.call(), null);
  assert.equal(read.warnings[0].event, "wallet-snapshot-budget-unavailable");
  assert.ok(!JSON.stringify(read.warnings).includes("secret"));
  const unknown = apiRead({ snapshotError: Error("programming failure") });
  await assert.rejects(unknown.call(), /programming failure/);
});


test("typed timeout reaches the existing fresh-wallet HTTP 503 contract", async () => {
  const read = apiRead({ snapshotError: Object.assign(Error("private"), {
    name: "ReadOnlySnapshotBudgetError", diagnostic: { cause: "deadline" } }) });
  const outer = functions(api, ["freshDataUnavailableError", "walletScopedTokenPayload"], {
    normalizeTokenScope: normalizedLowerText,
    walletScopedTokenCacheKey: () => "local-test",
    cachedWalletScopedTokenPayload: () => null,
    walletScopedTokenSingleFlight: async (_key, load) => load(),
    proofIndexWalletScopedTokenPayloadForRead: () => read.call(),
  });
  await assert.rejects(outer.walletScopedTokenPayload("livenet", "work", ["local"], {requireCurrent:true}),
    error => error.statusCode === 503 && error.details.code === "CANONICAL_WALLET_INDEX_UNAVAILABLE" && !JSON.stringify(error).includes("private"));
});

// Execute the exported entrypoint and its actual negative SQL reader together.
// A synthesized fingerprint flag alone cannot satisfy these wiring assertions.
function activeReadiness({ current = {height:969867,hash:C}, pending = {height:969866,hash:C}, owned = true, positive = true } = {}) {
  let full = 0, catalog = 0, negatives = 0; const diagnostics = [];
  const pool = { async query(sql, args) {
    assert.match(sql, /FROM proof_indexer\.blocks/u);
    assert.match(sql, /FROM proof_indexer\.meta/u);
    assert.deepEqual(Array.from(args), ['livenet','workQ16PendingRebuild:livenet']);
    negatives++; return {rows:[{canonical_tip:current,pending_tip:pending}]};
  } };
  const globals = {
    objectRecord: value => value && typeof value === 'object' && !Array.isArray(value) ? value : {},
    normalizedLowerText, WORK_Q16_PENDING_REBUILD_META_KEY:'workQ16PendingRebuild:livenet',
    normalizedWorkAmoV6ExpectedPins: value => value,
    proofIndexPool: () => pool, workPrecisionV2ReadinessRequestKey: () => 'entrypoint',
    walletReadSnapshot: {getStore:()=>owned?{pool}:null}, walletSnapshotReadinessMap:(_name,map)=>map,
    proofIndexWorkPrecisionV2ReadinessCompactFingerprint: async()=>fingerprint(A),
    workPrecisionV2MigrationReadinessWithCompactCheckpoint: args => check({...args,now:()=>baseNow}),
    workPrecisionV2ReadinessEpochContractAttestationWithCache: async()=>{catalog++;return true;},
    workPrecisionV2MigrationFullAuditWithBound: async ({load})=>load(),
    proofIndexWorkPrecisionV2MigrationReadinessFullAudit: async()=>{full++;return positive?ready(A):ready(A,{ready:false});},
  };
  for (const name of ['workPrecisionV2CanonicalBootstrapReadinessReadyCache','workPrecisionV2MigrationReadinessRequestInFlight','workPrecisionV2ReadinessEpochContractInFlight','workPrecisionV2ReadinessEpochContractReadyCache','workPrecisionV2MigrationFullAuditInFlight','workPrecisionV2MigrationReadinessReadyCache']) globals[name]=new Map();
  const entry = functions(reader,['proofIndexWalletPendingWitnessHasOldTip','proofIndexWorkPrecisionV2MigrationReadiness'],globals);
  return {call:(options={})=>entry.proofIndexWorkPrecisionV2MigrationReadiness('livenet',{}, {onUnavailable:d=>diagnostics.push(d),...options}), counts:()=>({full,catalog,negatives}),diagnostics};
}

test('actual owned entrypoint refuses lower height and same-height alternate hash before catalogue/full audit', async()=>{
  for (const pending of [{height:969866,hash:C},{height:969867,hash:B}]) {
    const r=activeReadiness({pending}); assert.equal(await r.call(),null);
    assert.deepEqual(r.counts(),{full:0,catalog:0,negatives:1});
    assert.ok(JSON.stringify(r.diagnostics).includes('pending-witness-old-tip'));
  }
});
test('actual matching and malformed negative samples never grant positive authority', async()=>{
  for (const pending of [{height:969867,hash:C},{height:'969866',hash:C},{height:969866,hash:'bad'},null,{height:969868,hash:C}]) {
    const r=activeReadiness({pending,positive:false}); assert.equal((await r.call())?.ready,false);
    assert.equal(r.counts().full,1);assert.equal(r.counts().catalog,1);
  }
});
test('actual owned entrypoint recovers without caching its old-tip refusal', async()=>{
  const pending={height:969866,hash:C};const r=activeReadiness({pending});assert.equal(await r.call(),null);
  pending.height=969867;assert.equal((await r.call()).ready,true);assert.equal(r.counts().full,1);
});
test('non-wallet readiness keeps its original path without a negative sample', async()=>{
  const r=activeReadiness({owned:false});assert.equal((await r.call()).ready,true);
  assert.equal(r.counts().negatives,0);assert.equal(r.counts().full,1);
});


test('actual old-tip sample precedes cached positives and bootstrap reuse',async()=>{
  const pending={height:969867,hash:C};const r=activeReadiness({pending});
  assert.equal((await r.call()).ready,true);pending.height=969866;
  assert.equal(await r.call({allowCanonicalSummaryBootstrap:true}),null);
  assert.equal(r.counts().full,1);assert.equal(r.counts().catalog,1);
});
