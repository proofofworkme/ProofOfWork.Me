import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import ts from "typescript";
const transpile = (source) => ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } }).outputText;
const load = async (path) => import(`data:text/javascript;base64,${Buffer.from(transpile(await readFile(path, "utf8"))).toString("base64")}`);
const authority = await load("src/shared/api/canonicalReadAuthority.ts");
const exact = await load("src/exactAmount.ts");
const source = await readFile("src/App.tsx", "utf8");
const ast = ts.createSourceFile("App.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const functions = new Map();
function visit(node) { if (ts.isFunctionDeclaration(node) && node.name) functions.set(node.name.text, node.getText(ast)); ts.forEachChild(node, visit); }
visit(ast);
const compile = (names, env) => new Function(...Object.keys(env), `${transpile(names.map((name) => functions.get(name)).join("\n"))};return {${names.join(",")}}`)(...Object.values(env));
const hash = "a".repeat(64), snapshotId = "b".repeat(24);
const evidence = (surface, seq = 2) => ({
  network: "livenet", indexedThroughBlock: 966125, indexedThroughBlockHash: hash, snapshotId, readSequence: seq, freshRead: true,
  totalCounts: { records: 1 }, collectionHasMore: { records: false },
  provenance: { contract: surface === "registry" ? "proof-of-work-canonical-registry-v1" : "proof-of-work-canonical-summary-v1", network: "livenet", surface,
    ready: true, coherent: true, served: "exact-tip", indexedThroughBlock: 966125, indexedThroughBlockHash: hash, tipHeight: 966125, tipHash: hash, snapshotId,
    completeCollections: { records: true }, componentSnapshotIds: Object.fromEntries((surface === "growth-summary" ? ["root", "token", "registry", "activity", "workFloor"] : ["root", "token"]).map((name) => [name, snapshotId])) },
});
let negativeChecks = 0;
for (const surface of ["registry", "infinity-summary", "inception-summary", "growth-summary"]) {
  const good = evidence(surface); assert.equal(authority.hasCanonicalReadAuthority(good, surface, 1), true);
  const reject = (bad) => { assert.equal(authority.hasCanonicalReadAuthority(bad, surface, 1), false); negativeChecks++; };
  for (const patch of [{ freshRead: false }, { network: "testnet" }, { indexedThroughBlock: 966126 }, { indexedThroughBlockHash: "c".repeat(64) }, { snapshotId: "d".repeat(24) }, { provenance: undefined }]) reject({ ...good, ...patch });
  for (const patch of [{ network: "testnet" }, { ready: false }, { coherent: false }, { served: "last-good" }, { surface: "wrong-surface" }, { tipHeight: 966126 }, { tipHash: "e".repeat(64) }, { snapshotId: "f".repeat(24) }]) reject({ ...good, provenance: { ...good.provenance, ...patch } });
  if (surface === "registry") {
    reject({ ...good, totalCounts: { records: 2 } }); reject({ ...good, collectionHasMore: { records: true } }); reject({ ...good, provenance: { ...good.provenance, completeCollections: {} } });
  } else {
    reject({ ...good, provenance: { ...good.provenance, componentSnapshotIds: { root: snapshotId } } });
    reject({ ...good, provenance: { ...good.provenance, componentSnapshotIds: { ...good.provenance.componentSnapshotIds, token: "f".repeat(24) } } });
  }
}
assert.equal(authority.canonicalReadIsOlder({ readSequence: 1 }, { readSequence: 2 }), true);
assert.equal(authority.canonicalReadIsOlder({ readSequence: 2 }, { readSequence: 1 }), false);

const oldRegistry = { records: [{ id: "one" }, { id: "dropped-pending", confirmed: false }], activity: [], listings: [], pendingEvents: [], sales: [], canonicalRead: evidence("registry", 1) };
const newRegistry = { ...oldRegistry, records: [{ id: "one", ownerAddress: "new-owner" }], canonicalRead: evidence("registry", 2) };
let renderedRegistry;
const registryEnv = { ...authority, acceptedRegistryStateRef: { current: oldRegistry }, setRegistryReadState() {}, setIdRegistry: (value) => renderedRegistry = value, setIdListings() {}, setIdPendingEvents() {}, setIdSales() {}, setIdActivity() {} };
const registry = compile(["registryStateRegresses", "applyRegistryState"], registryEnv);
assert.throws(() => registry.applyRegistryState({ ...newRegistry, canonicalRead: undefined }), /complete current canonical read/);
assert.equal(registryEnv.acceptedRegistryStateRef.current, oldRegistry);
assert.equal(registry.applyRegistryState(newRegistry).records[0].ownerAddress, "new-owner"); assert.equal(renderedRegistry.length, 1);
assert.equal(registry.applyRegistryState(oldRegistry), registryEnv.acceptedRegistryStateRef.current); assert.equal(renderedRegistry.length, 1);

// Exercise the actual exact-Q8/supply comparison and acceptance together. Token
// preview-history comparison is isolated because authority here covers aggregates.
const oldBond = { tokenId: "POWB", networkValueQ8: "20000000000", networkValueSats: "200", stats: { confirmedSupply: "200", confirmedBondActions: 2 }, token: {}, canonicalRead: evidence("infinity-summary", 1) };
const newBond = { ...oldBond, networkValueQ8: "10000000000", networkValueSats: "100", stats: { confirmedSupply: "100", confirmedBondActions: 1 }, canonicalRead: evidence("infinity-summary", 2) };
let renderedBond;
const bondEnv = { ...authority, ...exact, INCB_TOKEN_ID: "INCB", tokenStateRegresses: () => false, acceptedBondSummariesRef: { current: new Map([["POWB", oldBond]]) }, setInfinitySummary: (value) => renderedBond = value };
const bond = compile(["bondDecimalQ8", "infinitySummaryRegresses", "applyInfinitySummary"], bondEnv);
assert.equal(bond.infinitySummaryRegresses(newBond, oldBond), true);
assert.throws(() => bond.applyInfinitySummary({ ...newBond, canonicalRead: { ...newBond.canonicalRead, freshRead: false } }), /current branch authority/);
assert.equal(bond.applyInfinitySummary(newBond), newBond); assert.equal(renderedBond.networkValueQ8, "10000000000");
assert.equal(bond.applyInfinitySummary(oldBond), newBond); assert.equal(renderedBond.stats.confirmedSupply, "100");

const oldGrowth = { actualValue: { totalQ8: "20000000000" }, counts: { confirmedComputerActions: 2 }, canonicalRead: evidence("growth-summary", 1) };
const newGrowth = { actualValue: { totalQ8: "10000000000" }, counts: { confirmedComputerActions: 1 }, canonicalRead: evidence("growth-summary", 2) };
let renderedGrowth;
const growthEnv = { ...authority, ...exact, acceptedGrowthSummaryRef: { current: oldGrowth }, setGrowthSummary: (value) => renderedGrowth = value };
const growth = compile(["finiteNonNegativeNumber", "highestExactWorkQ8", "workFloorQuoteLiveValue", "workFloorQuoteLiveValueQ8", "growthSummaryNetworkValue", "growthSummaryNetworkValueQ8", "growthSummaryRegresses", "applyGrowthSummary"], growthEnv);
assert.equal(growth.growthSummaryRegresses(newGrowth, oldGrowth), true);
assert.throws(() => growth.applyGrowthSummary({ ...newGrowth, canonicalRead: undefined }), /current branch authority/);
assert.equal(growth.applyGrowthSummary(newGrowth), newGrowth); assert.equal(renderedGrowth.actualValue.totalQ8, "10000000000");
assert.equal(growth.applyGrowthSummary(oldGrowth), newGrowth);

{
  const read = evidence("work-floor", 3);
  read.provenance.componentSnapshotIds = { root: snapshotId };
  assert.equal(authority.hasCanonicalWorkFloorAuthority(read), true);
  const current = { networkValueQ8: "20000000000", chartPoints: [], canonicalRead: evidence("work-floor", 1) };
  const incoming = { networkValueQ8: "10000000000", chartPoints: [], canonicalRead: read };
  const env = { ...authority, ...exact, workV8DeclarationBoundaryObserved: () => false, failClosedWorkAmoV8Status: () => ({ reasonCode: "fixture-paused" }) };
  const names = ["finiteNonNegativeNumber", "highestExactWorkQ8", "workFloorQuoteLiveValue", "workFloorQuoteLiveValueQ8", "workFloorQuoteFrozenValue", "workFloorQuoteFrozenValueQ8", "workFloorQuoteRegresses", "planWorkFloorQuoteTransition"];
  const { planWorkFloorQuoteTransition } = compile(names, env);
  assert.equal(planWorkFloorQuoteTransition({ ...incoming, canonicalRead: undefined }, current, false).valueRegressed, true);
  const accepted = planWorkFloorQuoteTransition(incoming, current, true);
  assert.equal(accepted.valueRegressed, false);
  assert.equal(accepted.boundaryEvidenceRegressed, true);
  assert.equal(accepted.safetyBoundQuote.workAmoV8.reasonCode, "fixture-paused");
  assert.equal(accepted.safetyBoundQuote.networkValueQ8, "10000000000");
}


{
  const env = { canonicalReadSequence: 0, registryAddressForNetwork: () => "registry", fetchProofApiJson: async () => ({ network: "testnet", records: [] }), normalizeRegistryApiState: (value) => value };
  const { fetchIdRegistryState } = compile(["fetchIdRegistryState"], env);
  await assert.rejects(fetchIdRegistryState("livenet", true, false), /different network/);
  const missing = compile(["fetchIdRegistryState"], { ...env, fetchProofApiJson: async () => ({ records: [] }) });
  const unqualified = await missing.fetchIdRegistryState("livenet", true, false);
  assert.equal(unqualified.network, undefined);
  const wrappers = compile(["normalizeWorkFloorQuote", "normalizeGrowthSummary", "normalizeInfinitySummary"], {});
  assert.throws(() => wrappers.normalizeWorkFloorQuote({ network: "testnet" }, "livenet"), /different network/);
  assert.throws(() => wrappers.normalizeGrowthSummary({ network: "testnet" }), /different network/);
  assert.throws(() => wrappers.normalizeInfinitySummary({ network: "testnet" }, {}), /different network/);
}

{
  let published, status, historyCalls = 0;
  const current = { ...oldRegistry, canonicalRead: evidence("registry", 1) };
  const partial = { ...newRegistry, records: [], canonicalRead: undefined };
  const env = { ...authority, acceptedRegistryStateRef: { current }, activeWorkspaceStatusKeyRef: { current: "log" }, activitySearchGenerationRef: { current: 0 }, activityRequestControllerRef: {}, walletReadScopeRef: { current: { network: "livenet" } }, network: "livenet", activityQuery: "one", idRegistry: current.records, registryAddress: "registry", nextProofApiReadAttempt: () => 1,
    fetchIdRegistryState: async () => partial, resolveRecipientInput: () => ({ isId: true }), fetchGlobalActivityHistoryPage: async () => { historyCalls++; throw Error("must not query using unverified registry"); },
    setIdRegistry: (records) => published = records, setRegistryReadState() {}, setIdListings() {}, setIdPendingEvents() {}, setIdSales() {}, setIdActivity() {}, setActivityLoading() {}, setActivityProfile() {}, setActivityMail() {}, setActivityHistoryPage() {},
    setStatusForWorkspace: (_, value) => status = value, errorMessage: (error) => error.message,
  };
  const { loadActivityTarget } = compile(["registryStateRegresses", "applyRegistryState", "loadActivityTarget"], env);
  await loadActivityTarget("one");
  assert.equal(published, undefined); assert.equal(historyCalls, 0); assert.equal(env.acceptedRegistryStateRef.current, current);
  assert.equal(status.tone, "bad"); assert.match(status.text, /complete current canonical read/);
}

{
  const read = evidence("marketplace-summary", 4);
  read.freshRead = false;
  read.provenance.componentSnapshotIds = Object.fromEntries(["root", "registry", "token", "workFloor"].map((name) => [name, snapshotId]));
  assert.equal(authority.hasCanonicalSummaryCheckpoint(read, "marketplace-summary"), true);
  assert.equal(authority.hasCanonicalReadAuthority(read, "marketplace-summary"), false, "summary display must not grant fresh replacement authority");
  let rejectBook, state = { status: "loading", message: "checking" }, promoted = 0;
  const book = new Promise((_, reject) => rejectBook = reject);
  const snapshot = { indexedAt: "2026-09-08T23:00:00Z", registry: { records: [] }, token: { totalCounts: { tokens: 238 }, listingBookComplete: false }, workFloor: { floorQ8: "39940839236354661100", networkValueQ8: "838757623963447883106635908", canonicalRead: read } };
  const env = { ...authority, ...exact, network: "livenet", activeWorkspaceStatusKeyRef: { current: "marketplace" }, marketplaceSummaryRefreshInFlightRef: { current: null }, marketplaceSummaryRefreshInFlightFreshRef: { current: false }, acceptedMarketplaceSnapshotRef: { current: undefined }, acceptedWorkFloorQuoteRef: { current: undefined },
    nextProofApiReadAttempt: () => 1, setMarketplaceDataLoading() {}, setMarketplaceSummaryReadState: (value) => state = typeof value === "function" ? value(state) : value,
    fetchMarketplaceSummary: async () => snapshot, fetchBtcUsdPrice: async () => undefined, tokenStateWithCurrentCompleteMarketplaceListings: () => book,
    applyTokenState: () => promoted++, applyRegistryState: () => promoted++, applyWorkFloorQuote: () => promoted++, errorMessage: (error) => error.message,
  };
  const { refreshMarketplaceSummary, marketplaceSummaryPreview } = compile(["finiteNonNegativeNumber", "highestExactWorkQ8", "workFloorQuoteLiveValueQ8", "marketplaceSummaryHasVerifiedData", "marketplaceSummaryPreview", "refreshMarketplaceSummary"], env);
  const pending = refreshMarketplaceSummary(true, false);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(state.status, "loading"); assert.equal(state.summaryMetrics.floorQ8, "39940839236354661100");
  assert.equal(state.summaryMetrics.networkValueQ8, "838757623963447883106635908"); assert.equal(state.summaryMetrics.creditDefinitions, 238); assert.equal(promoted, 0);
  rejectBook(Error("complete book deadline")); assert.equal(await pending, undefined);
  assert.equal(state.status, "unavailable"); assert.equal(state.summaryMetrics.floorQ8, "39940839236354661100"); assert.equal(promoted, 0);
  assert.equal(marketplaceSummaryPreview({ ...snapshot, workFloor: { ...snapshot.workFloor, canonicalRead: { ...read, provenance: { ...read.provenance, coherent: false } } } }), undefined);
}

console.log(JSON.stringify({ ok: true, negativeChecks, coverage: ["complete registry contraction accepts fresh fenced canonical replacement", "partial/mismatched/missing/stale authority refused", "new canonical bond/Growth decreases accepted exactly", "older read cannot restore prior branch", "timestamps are not used as authority", "WORK branch replacement preserves declaration fail-closed boundary", "response network is never manufactured from the request", "Log ID resolution cannot bypass full-registry contraction authority", "AMO exact summary appears before a deferred complete book; book failure never promotes action/reservation state"] }, null, 2));
