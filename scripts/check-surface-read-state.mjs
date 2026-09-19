import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import ts from "typescript";
const transpile = (source) => ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } }).outputText;
const source = await readFile("src/shared/api/surfaceReadState.ts", "utf8");
const { completeRegistryCounts, assertCompleteTokenDirectory, assertCompleteIdReservations, walletReservationsReady, listingDisplayProjectionFingerprint } = await import(`data:text/javascript;base64,${Buffer.from(transpile(source)).toString("base64")}`);
const counts = { registryCounts: { model: "proof-registry-counts-v1", complete: true, confirmedCount: 505, pendingCount: 2, totalCount: 507 } };
assert.deepEqual(completeRegistryCounts(counts), { confirmedCount: 505, pendingCount: 2, totalCount: 507 });
for (const patch of [{ complete: false }, { pendingCount: -1 }, { totalCount: 508 }, { confirmedCount: "505" }, { model: "preview" }]) assert.throws(() => completeRegistryCounts({ registryCounts: { ...counts.registryCounts, ...patch } }));
assert.deepEqual(completeRegistryCounts({ registryCounts: { ...counts.registryCounts, confirmedCount: 0, pendingCount: 0, totalCount: 0 } }), { confirmedCount: 0, pendingCount: 0, totalCount: 0 });
const directory = { directory: { model: "proof-token-directory-v1", complete: true, totalCount: 2 }, tokens: [{ tokenId: "a" }, { tokenId: "b" }] };
assert.doesNotThrow(() => assertCompleteTokenDirectory(directory));
assert.throws(() => assertCompleteTokenDirectory({ ...directory, tokens: directory.tokens.slice(0, 1) }));
assert.throws(() => assertCompleteTokenDirectory({ ...directory, directory: { ...directory.directory, complete: false } }));
assert.throws(() => assertCompleteTokenDirectory({ tokens: [] }));
assert.doesNotThrow(() => assertCompleteIdReservations({ listings: [] }));
assert.doesNotThrow(() => assertCompleteIdReservations({ listings: [{}], totalCounts: { listings: 1 } }));
for (const payload of [{}, { listings: [], summaryOnly: true }, { listings: [], collectionHasMore: { listings: true } }, { listings: [], totalCounts: { listings: 1 } }]) assert.throws(() => assertCompleteIdReservations(payload));
const ready = { loaded: true, loading: false, error: "" };
const lanes = Object.fromEntries(["all", "work", "powb", "incb"].map((lane) => [lane, { ...ready }]));
const reservations = { ...ready, scope: "livenet:wallet-a" };
assert.equal(walletReservationsReady(reservations.scope, reservations, lanes), true);
assert.equal(walletReservationsReady("livenet:wallet-b", reservations, lanes), false);
assert.equal(walletReservationsReady("livenet:Wallet-a", reservations, lanes), false);
for (const patch of [{ loaded: false }, { loading: true }, { error: "unavailable" }]) {
  assert.equal(walletReservationsReady(reservations.scope, { ...reservations, ...patch }, lanes), false);
  for (const lane of Object.keys(lanes)) assert.equal(walletReservationsReady(reservations.scope, reservations, { ...lanes, [lane]: { ...ready, ...patch } }), false);
}
assert.equal(walletReservationsReady(reservations.scope, reservations, {}), false);
const item = { listingId: "a".repeat(64), displayEvidence: { model: "proof-token-listing-display-v1", fullRecordSha256: "b".repeat(64), omittedFields: ["workAmoV5ReplayOutput"], fullDetailPath: `/api/v1/token-history?kind=listings&projection=full&q=${"a".repeat(64)}&listingId=${"a".repeat(64)}` } };
const projection = { itemProjection: { model: item.displayEvidence.model, fullMembershipSha256: "c".repeat(64), fullSourceSha256: "d".repeat(64) }, items: [item] };
const fingerprint = listingDisplayProjectionFingerprint(projection);
assert.equal(fingerprint, listingDisplayProjectionFingerprint({ ...projection, items: [] }));
assert.notEqual(fingerprint, listingDisplayProjectionFingerprint({ ...projection, itemProjection: { ...projection.itemProjection, fullSourceSha256: "e".repeat(64) } }));
for (const patch of [
  { omittedFields: ["amountSubatoms"] },
  { fullRecordSha256: "" },
  { fullDetailPath: item.displayEvidence.fullDetailPath.replace("q=a", "q=b") },
  { fullDetailPath: item.displayEvidence.fullDetailPath.replace("listingId=a", "listingId=b") },
  { fullDetailPath: item.displayEvidence.fullDetailPath.replace(/&listingId=[a-f0-9]+/u, "") },
  { fullDetailPath: "https://untrusted.invalid" },
]) assert.throws(() => listingDisplayProjectionFingerprint({ ...projection, items: [{ ...item, displayEvidence: { ...item.displayEvidence, ...patch } }] }));
// Execute the actual nested refresh function with controlled network promises.
// The summary must be applied while BOTH the full book and supplemental registry
// are unresolved. No math or canonical transition implementation is substituted.
const appSource = await readFile("src/App.tsx", "utf8");
const ast = ts.createSourceFile("App.tsx", appSource, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
let declaration;
function visit(node) { if (ts.isFunctionDeclaration(node) && node.name?.text === "refreshInfinity") declaration = node; ts.forEachChild(node, visit); }
visit(ast);
assert.ok(declaration);
const deferred = () => { let resolve; const promise = new Promise((done) => { resolve = done; }); return { promise, resolve }; };
const book = deferred(); const registry = deferred(); const applied = [];
const config = { tokenId: "a".repeat(64), ticker: "POWB", displayName: "Infinity Bond" };
const snapshot = { tokenId: config.tokenId, stats: { confirmedSupply: "9007199254740993", confirmedBondActions: 1 }, token: { listingBookComplete: false }, actualValue: { floorQ8: "1234567890123456789012345" } };
const env = {
  activeBondConfig: config, activeWorkspaceStatusKeyRef: { current: "infinity" }, network: "livenet",
  infinityRefreshInFlightRef: { current: null }, infinityRefreshTokenIdRef: { current: "" }, infinityRefreshInFlightFreshRef: { current: false },
  setBusyForWorkspace() {}, setStatusForWorkspace() {}, nextProofApiReadAttempt: () => 1,
  fetchBondSummary: async () => snapshot, fetchIdRegistryState: () => registry.promise, fetchBtcUsdPrice: async () => undefined,
  applyInfinitySummary: (value) => { applied.push(value); return value; }, applyTokenState: (value) => value,
  tokenStateScopeKey: () => "livenet:global:POWB", tokenStateWithCurrentCompleteBondListings: () => book.promise,
  marketplaceWorkspaceIsCurrent: () => false, applyRegistryState() {}, setTokenSelectedId() {}, setTokenDetailTarget() {}, setTokenBtcUsd() {},
  clearLastGoodReadWarning() {}, acceptedBondSummariesRef: { current: new Map() }, isTransientProofApiReadError: () => false, showLastGoodReadWarning() {},
  errorMessage: (error) => String(error), formatExactInteger: String,
};
const refresh = new Function(...Object.keys(env), `${transpile(declaration.getText(ast))};return refreshInfinity`)(...Object.values(env));
const pending = refresh(true, false, config);
await new Promise((resolve) => setImmediate(resolve));
assert.equal(applied.length, 1);
assert.equal(applied[0].stats.confirmedSupply, "9007199254740993");
assert.equal(applied[0].actualValue.floorQ8, "1234567890123456789012345");
assert.equal(applied[0].token.listingBookComplete, false);
book.resolve({ ...snapshot.token, listingBookComplete: true }); registry.resolve(undefined);
const settled = await pending;
assert.equal(settled.token.listingBookComplete, true);
assert.equal(settled.actualValue.floorQ8, snapshot.actualValue.floorQ8);
console.log(JSON.stringify({ ok: true, coverage: ["qualified-counts", "complete-directory", "wallet-reservation-readiness", "listing-full-evidence-binding", "bond-summary-before-book"] }));

// H6-15: a background request from an older render must use the live query,
// and a late response must not replace a newer search or page.
let logDeclaration;
function visitLog(node) {
  if (ts.isFunctionDeclaration(node) && node.name?.text === "loadLogHistoryPage") logDeclaration = node;
  ts.forEachChild(node, visitLog);
}
visitLog(ast);
assert.ok(logDeclaration);
const logRequests = []; const logAccepted = [];
const logEnv = {
  activityProfileRef: { current: undefined }, activityQueryRef: { current: "tx-current" },
  activityHistoryGenerationRef: { current: 0 }, activitySearchGenerationRef: { current: 0 },
  activeWorkspaceStatusKeyRef: { current: "log" }, network: "livenet", ACTIVITY_FEED_PAGE_SIZE: 50,
  nextProofApiReadAttempt: () => 1, activityHistoryCacheKey: JSON.stringify,
  fetchGlobalActivityHistoryPage: (_network, params) => { const d = deferred(); logRequests.push({ ...d, params }); return d.promise; },
  clearLastGoodReadWarning() {}, acceptActivityHistoryPage: (_key, page) => { logAccepted.push(page); return page; },
  activityHistoryPagesRef: { current: new Map() }, isTransientProofApiReadError: () => false,
  showLastGoodReadWarning: () => false, setActivityHistoryPage() {}, setStatusForWorkspace() {},
  setActivityLoading() {}, errorMessage: String,
};
const logLoad = new Function(...Object.keys(logEnv), `${transpile(logDeclaration.getText(ast))};return loadLogHistoryPage`)(...Object.values(logEnv));
const oldPage = logLoad(0);
assert.equal(logRequests[0].params.query, "tx-current");
const newPage = logLoad(1);
logRequests[1].resolve({ page: 1 }); await newPage;
logRequests[0].resolve({ page: 0 }); await oldPage;
assert.deepEqual(logAccepted, [{ page: 1 }]);
const beforeSearch = logLoad(0);
logEnv.activitySearchGenerationRef.current++;
logRequests[2].resolve({ page: 0, obsolete: true }); await beforeSearch;
assert.equal(logAccepted.length, 1);
logEnv.activityQueryRef.current = "new-query";
const newQuery = logLoad(0);
assert.equal(logRequests[3].params.query, "new-query");
logEnv.activeWorkspaceStatusKeyRef.current = "wallet";
logRequests[3].resolve({ page: 0, wrongWorkspace: true }); await newQuery;
assert.equal(logAccepted.length, 1);
console.log(JSON.stringify({ ok: true, coverage: ["log-live-query", "log-latest-page-wins", "log-search-fence", "log-workspace-fence"] }));
