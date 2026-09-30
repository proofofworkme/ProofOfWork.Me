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
// The compact summary must be applied while supplemental registry data is still
// pending, without requesting full listing history. No canonical transition
// implementation is substituted.
const appSource = await readFile("src/App.tsx", "utf8");
const ast = ts.createSourceFile("App.tsx", appSource, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
let declaration;
function visit(node) { if (ts.isFunctionDeclaration(node) && node.name?.text === "refreshInfinity") declaration = node; ts.forEachChild(node, visit); }
visit(ast);
assert.ok(declaration);
const deferred = () => { let resolve; const promise = new Promise((done) => { resolve = done; }); return { promise, resolve }; };
const registry = deferred(); const applied = []; let completeBookRequested = false;
const config = { tokenId: "a".repeat(64), ticker: "POWB", displayName: "Infinity Bond" };
const snapshot = { tokenId: config.tokenId, stats: { confirmedSupply: "9007199254740993", confirmedBondActions: 1 }, token: { listingBookComplete: false }, actualValue: { floorQ8: "1234567890123456789012345" } };
const env = {
  activeBondConfig: config, activeWorkspaceStatusKeyRef: { current: "infinity" }, network: "livenet",
  infinityRefreshInFlightRef: { current: null }, infinityRefreshTokenIdRef: { current: "" }, infinityRefreshInFlightFreshRef: { current: false },
  setBusyForWorkspace() {}, setStatusForWorkspace() {}, nextProofApiReadAttempt: () => 1,
  fetchBondSummary: async () => snapshot, fetchIdRegistryState: () => registry.promise, fetchBtcUsdPrice: async () => undefined,
  applyInfinitySummary: (value) => { applied.push(value); return value; }, applyTokenState: (value) => value,
  tokenStateScopeKey: () => "livenet:global:POWB",
  completeMarketplaceListingHistoryRef: { current: null },
  completeTokenListingHistoryMatchesState: () => false,
  tokenStateWithCompleteTokenBondListings: (state) => state,
  tokenStateWithCurrentCompleteBondListings: () => { completeBookRequested = true; return Promise.resolve({ listingBookComplete: true }); },
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
assert.equal(completeBookRequested, false);
registry.resolve(undefined);
const settled = await pending;
assert.equal(settled.token.listingBookComplete, false);
assert.equal(settled.actualValue.floorQ8, snapshot.actualValue.floorQ8);
console.log(JSON.stringify({ ok: true, coverage: ["qualified-counts", "complete-directory", "wallet-reservation-readiness", "listing-full-evidence-binding", "bond-summary-does-not-fetch-full-book"] }));

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

// AMO must not accept the compact preview; retry the whole snapshot after a
// checkpoint transition and reject permanently incomplete reads.
let amoDeclaration;
function visitAmo(node) {
  if (ts.isFunctionDeclaration(node) && node.name?.text === "fetchCompleteMarketplaceSnapshot") amoDeclaration = node;
  ts.forEachChild(node, visitAmo);
}
visitAmo(ast);
assert.ok(amoDeclaration);
let attempt = 0;
const reads = [];
const listingReads = [];
const complete = { listingBookComplete: true, listings: [{ tokenId: "WORK" }, { tokenId: "POWB" }, { tokenId: "INCB" }] };
const amoEnv = {
  activeWorkspaceStatusKeyRef: { current: "marketplace" },
  marketplaceReadContextRef: { current: "livenet:" },
  network: "livenet",
  fetchMarketplaceSummary: async (fresh) => { reads.push(fresh); return { indexedAt: String(++attempt), token: { listingBookComplete: false } }; },
  tokenStateWithCurrentCompleteMarketplaceListings: async (_token, fresh) => { listingReads.push(fresh); if (attempt === 1) throw new Error("checkpoint changed"); return complete; },
};
const actualAmoRead = (env) => new Function(...Object.keys(env),
  `${transpile(amoDeclaration.getText(ast))};return fetchCompleteMarketplaceSnapshot`)(...Object.values(env));
const loadAmo = actualAmoRead(amoEnv);
const amo = await loadAmo(false);
assert.equal(amo.indexedAt, "2");
assert.equal(amo.token, complete);
assert.deepEqual(reads, [false, true]);
assert.deepEqual(listingReads, [false, true]);
let rejectedReads = 0;
const rejectAmo = actualAmoRead({
  ...amoEnv,
  fetchMarketplaceSummary: async () => { rejectedReads += 1; return { token: {} }; },
  tokenStateWithCurrentCompleteMarketplaceListings: async () => { throw new Error("incomplete inventory"); },
});
await assert.rejects(rejectAmo(false), /incomplete inventory/);
assert.equal(rejectedReads, 2);
console.log(JSON.stringify({ ok: true, coverage: ["amo-complete-book-before-ready", "amo-checkpoint-restart", "amo-bounded-failure"] }));

// Reproduce the production mismatch: independent summary and relational clocks
// at one canonical block. Exercise the actual complete-book reader, including
// its cross-page guards, rather than replacing it with a successful stub.
function appFunction(name, bindings = {}) {
  let found;
  function find(node) {
    if (ts.isFunctionDeclaration(node) && node.name?.text === name) found = node;
    ts.forEachChild(node, find);
  }
  find(ast);
  assert.ok(found, name);
  return new Function(...Object.keys(bindings), `${transpile(found.getText(ast))};return ${name}`)(...Object.values(bindings));
}
const checkpointMatches = appFunction("completeTokenListingHistoryMatchesCheckpoint");
const stateMatches = appFunction("completeTokenListingHistoryMatchesState", {
  completeTokenListingHistoryMatchesCheckpoint: checkpointMatches,
});
const bookTime = "2026-09-28T22:43:45.778Z";
const summaryState = { indexedAt: "2026-09-28T22:48:41.000Z", indexedThroughBlock: 969059, indexedThroughBlockHash: "a".repeat(64) };
const bookState = { ...summaryState, indexedAt: bookTime };
assert.equal(stateMatches(bookState, summaryState), true);
for (const patch of [
  { indexedThroughBlock: 969060 }, { indexedThroughBlockHash: "b".repeat(64) },
  { indexedThroughBlock: 0 }, { indexedThroughBlockHash: "" }, { indexedAt: "invalid" },
]) assert.equal(stateMatches(bookState, { ...summaryState, ...patch }), false);
assert.equal(stateMatches({ ...bookState, indexedAt: "invalid" }, summaryState), false);

const rows = Array.from({ length: 201 }, (_, index) => {
  const listingId = (index + 1).toString(16).padStart(64, "0");
  return { listingId, confirmed: true, network: "livenet", displayEvidence: {
    model: "proof-token-listing-display-v2", fullRecordSha256: "b".repeat(64),
    omittedFields: ["parsed", "listing", "payload"],
    fullDetailPath: `/api/v1/token-history?kind=listings&projection=full&q=${listingId}&listingId=${listingId}`,
  } };
});
const bookPage = (page) => ({
  ...bookState, snapshotId: "c".repeat(64), network: "livenet", kind: "listings",
  source: "proof-indexer-complete-core-reconciled-token-listings",
  items: rows.slice(page * 200, (page + 1) * 200), totalCount: rows.length,
  cursor: page ? "opaque-next" : "", nextCursor: page ? "" : "opaque-next",
  start: page * 200, end: page ? 201 : 200, limit: 200, page, pageCount: 2,
  hasMore: page === 0,
  listingAuthority: { model: "proof-token-market-core-gettxout-v1", includeMempool: true,
    checkpoint: { height: bookState.indexedThroughBlock, blockHash: bookState.indexedThroughBlockHash },
    checkedOutpointsSha256: "d".repeat(64), checkedListingCount: 201, inputListingCount: 201,
    outputListingCount: 201, spentListingCount: 0, unspentListingCount: 201 },
  listingProjection: { model: "proof-token-market-cutover-after-core-v1", activeListingCount: 201,
    coreUnspentListingCount: 201, excludedByProtocolCount: 0, membershipSha256: "e".repeat(64) },
  itemProjection: { model: "proof-token-listing-display-v2", fullMembershipSha256: "f".repeat(64), fullSourceSha256: "1".repeat(64) },
});
let pageCalls = 0;
let mutatePage = (value) => value;
const readBook = appFunction("fetchCompleteTokenListings", {
  TOKEN_HISTORY_PAGE_SIZE: 200, MAX_TOKEN_HISTORY_PAGES: 10,
  listingDisplayProjectionFingerprint,
  fetchTokenHistoryPage: async (_network, kind, options) => {
    assert.equal(kind, "listings");
    assert.equal(options.projection, "display-v2");
    pageCalls++;
    return mutatePage(bookPage(options.cursor ? 1 : 0));
  },
});
const verifiedBook = await readBook("livenet");
assert.equal(pageCalls, 2);
assert.equal(verifiedBook.items.length, 201);
assert.equal(stateMatches(verifiedBook, summaryState), true);
for (const patch of [
  { indexedAt: summaryState.indexedAt }, { indexedThroughBlockHash: "b".repeat(64) },
  { snapshotId: "2".repeat(64) }, { totalCount: 202 }, { items: [rows[0]] },
  { itemProjection: { ...bookPage(1).itemProjection, fullSourceSha256: "3".repeat(64) } },
  { listingAuthority: { ...bookPage(1).listingAuthority, checkedOutpointsSha256: "4".repeat(64) } },
]) {
  mutatePage = (value) => value.page === 1 ? { ...value, ...patch } : value;
  await assert.rejects(readBook("livenet"), /checkpoint|repeated|returned/);
}
const v2Projection = { itemProjection: bookPage(0).itemProjection, items: [rows[0]] };
assert.doesNotThrow(() => listingDisplayProjectionFingerprint(v2Projection));
for (const omitted of ["saleAuthorization", "listingAuthorization", "workAmoFrozenTerms", "amountSubatoms"]) {
  assert.throws(() => listingDisplayProjectionFingerprint({ ...v2Projection,
    items: [{ ...rows[0], displayEvidence: { ...rows[0].displayEvidence, omittedFields: [omitted] } }] }));
}
assert.throws(() => listingDisplayProjectionFingerprint({
  ...projection, items: [{ ...item, displayEvidence: { ...item.displayEvidence, omittedFields: ["payload"] } }],
}), /retrievable full evidence/);

let currentBookReads = 0;
const currentBook = appFunction("currentCompleteGlobalTokenListings", {
  completeMarketplaceListingHistoryRef: { current: verifiedBook },
  completeMarketplaceListingHistoryInFlightRef: { current: null },
  completeTokenListingHistoryMatchesState: stateMatches,
  fetchCompleteTokenListings: async () => { currentBookReads++; return verifiedBook; },
});
await currentBook(summaryState, false);
assert.equal(currentBookReads, 1, "different observation clocks cannot reuse old pending-spend evidence");
await currentBook(bookState, false);
assert.equal(currentBookReads, 1, "identical observation can reuse its verified book");
await currentBook(bookState, true);
assert.equal(currentBookReads, 2, "explicit refresh always rechecks ticket spends");
console.log(JSON.stringify({ ok: true, coverage: ["amo-independent-clocks", "amo-two-page-v2-book", "amo-page-mutation-rejection", "amo-v2-evidence-retained", "amo-cache-observation-fence"] }));

// Public AMO inventory survives account connection, but not network or workspace changes.
for (const transition of ["account", "network", "workspace"]) {
  const summary = deferred();
  const env = {
    ...amoEnv,
    activeWorkspaceStatusKeyRef: { current: "marketplace" },
    marketplaceReadContextRef: { current: "livenet:" },
    fetchMarketplaceSummary: () => summary.promise,
    tokenStateWithCurrentCompleteMarketplaceListings: async () => complete,
  };
  const pendingRead = actualAmoRead(env)(false);
  if (transition === "workspace") env.activeWorkspaceStatusKeyRef.current = "computer:inbox";
  else env.marketplaceReadContextRef.current = transition === "account" ? "livenet:wallet-a" : "testnet4:wallet-a";
  summary.resolve({ token: { listingBookComplete: false } });
  if (transition === "account") assert.equal((await pendingRead).token, complete);
  else await assert.rejects(pendingRead, { name: "AbortError" });
}
console.log(JSON.stringify({ ok: true, coverage: ["public-amo-account-transition", "obsolete-amo-network-and-workspace-cancellation"] }));
