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
// AUD27-01: exercise the actual status partition independently of Outbox membership.
const lifecycleBindings = {};
for (const name of ["normalizeBroadcastStatus", "sentDeliveryStatus", "mailHeaderLifecycleCounts"]) {
  let actual;
  function findLifecycle(node) {
    if (ts.isFunctionDeclaration(node) && node.name?.text === name) actual = node;
    ts.forEachChild(node, findLifecycle);
  }
  findLifecycle(ast);
  assert.ok(actual, name);
  lifecycleBindings[name] = new Function(...Object.keys(lifecycleBindings),
    `${transpile(actual.getText(ast))}; return ${name}`)(...Object.values(lifecycleBindings));
}
const countMailLifecycle = lifecycleBindings.mailHeaderLifecycleCounts;
assert.deepEqual(countMailLifecycle([], [{ status: "dropped" }]), { pending: 0, dropped: 1, checking: 0 });
assert.deepEqual(countMailLifecycle([], [{ status: "pending" }]), { pending: 1, dropped: 0, checking: 0 });
assert.deepEqual(countMailLifecycle([], [{ status: "confirmed" }]), { pending: 0, dropped: 0, checking: 0 });
assert.deepEqual(countMailLifecycle([], [{ status: "unknown" }]), { pending: 0, dropped: 0, checking: 1 });
assert.deepEqual(countMailLifecycle([{ confirmed: false }, { confirmed: true }, {}],
  [{ status: "pending" }, { status: "dropped" }, {}]), { pending: 2, dropped: 1, checking: 2 });
assert.match(appSource, /const pendingMailEvents = mailLifecycle\.pending;/u);
assert.match(appSource, /label: "dropped mail"/u);
assert.match(appSource, /label: "checking mail"/u);
console.log(JSON.stringify({ ok: true, coverage: ["mail-pending-dropped-checking-partition"] }));
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

// H6-06, H6-12 and mailbox response integrity: execute the actual client
// loaders, cancellation effects and envelope reader with reversed promises.
// The transport intentionally ignores abort so acceptance guards are tested.
const readDeferred = () => {
  let resolve, reject;
  const promise = new Promise((done, fail) => { resolve = done; reject = fail; });
  return { promise, resolve, reject };
};
function appCallback(owner, name, bindings) {
  let component, callback;
  function findComponent(node) {
    if (ts.isFunctionDeclaration(node) && node.name?.text === owner) component = node;
    ts.forEachChild(node, findComponent);
  }
  findComponent(ast);
  function findCallback(node) {
    if (ts.isVariableDeclaration(node) && node.name.getText(ast) === name &&
      node.initializer && ts.isCallExpression(node.initializer)) callback = node.initializer.arguments[0];
    ts.forEachChild(node, findCallback);
  }
  findCallback(component);
  assert.ok(callback, `${owner}.${name}`);
  return new Function(...Object.keys(bindings),
    `${transpile(`const actualCallback = ${callback.getText(ast)}`)};return actualCallback`)(...Object.values(bindings));
}
function appEffect(marker, bindings) {
  const callbacks = [];
  function find(node) {
    if (ts.isCallExpression(node) && node.expression.getText(ast) === "useEffect" &&
      node.arguments[0]?.getText(ast).includes(marker)) callbacks.push(node.arguments[0]);
    ts.forEachChild(node, find);
  }
  find(ast);
  assert.equal(callbacks.length, 1, `Expected exactly one effect matching ${marker}`);
  const [callback] = callbacks;
  return new Function(...Object.keys(bindings),
    `${transpile(`const actualEffect = ${callback.getText(ast)}`)};return actualEffect`)(...Object.values(bindings));
}
function desktopReadHarness() {
  const requests = [], accepted = [], statuses = [], loading = [];
  const bindings = {
    desktopQuery: "", network: "livenet", idRegistry: [], registryAddress: "registry",
    activeWorkspaceStatusKeyRef: { current: "desktop" }, desktopNetworkRef: { current: "livenet" },
    desktopReadGenerationRef: { current: 0 }, desktopReadControllerRef: { current: undefined },
    desktopReadTargetRef: { current: "" }, AbortController,
    resolveRecipientInput: (query) => ({ paymentAddress: query }),
    fetchAddressMail: (address, network, fresh, signal) => {
      const request = { ...readDeferred(), address, network, fresh, signal };
      requests.push(request); return request.promise;
    },
    fetchDesktopWelcomeReference: async () => undefined,
    publicDesktopMail: (incoming, sent) => [...incoming, ...sent],
    fileSurfaceMessages: (messages) => messages, desktopFileSurfaceMessages: (messages) => messages,
    hasAttachment: (message) => Boolean(message.attachment), shortAddress: (address) => address,
    desktopFileIdentityKey: (message) => message.txid,
    setDesktopProfile: (profile) => accepted.push(profile), setDesktopMail() {},
    setDesktopLoading: (value) => loading.push(value),
    setStatusForWorkspace: (workspace, status) => statuses.push({ workspace, ...status }),
    setDesktopQuery() {}, setDesktopSelectedKey() {}, setActiveFolder() {},
    setComposeOpen() {}, setSelectedKey() {}, setStatus: (status) => statuses.push(status),
    errorMessage: (error) => error.message,
  };
  return { bindings, requests, accepted, statuses, loading,
    load: () => appFunction("loadDesktopTarget", bindings),
    clear: () => appFunction("clearDesktop", bindings),
  };
}
const emptyMail = { inboxMessages: [], sentMessages: [] };
{
  const h = desktopReadHarness(), load = h.load();
  const first = load("address-a"), latest = load("address-b");
  assert.equal(h.requests[0].signal.aborted, true);
  assert.equal(h.requests[1].fresh, true);
  h.requests[0].resolve(emptyMail); await first;
  assert.deepEqual(h.loading, [true, true], "older finally cannot clear latest loading");
  assert.equal(h.accepted.length, 0);
  h.requests[1].resolve(emptyMail); await latest;
  assert.deepEqual(h.accepted.map((profile) => profile.query), ["address-b"]);
  assert.deepEqual(h.loading, [true, true, false]);
}
{
  const h = desktopReadHarness(), load = h.load();
  const first = load("address-a"), latest = load("address-b");
  h.requests[1].resolve(emptyMail); await latest;
  const statusCount = h.statuses.length, loadingCount = h.loading.length;
  h.requests[0].reject(new Error("obsolete failure")); await first;
  assert.deepEqual(h.accepted.map((profile) => profile.query), ["address-b"]);
  assert.equal(h.statuses.length, statusCount, "obsolete error cannot replace latest status");
  assert.equal(h.loading.length, loadingCount);
}
for (const fence of ["network", "workspace", "clear", "empty-target", "cleanup"]) {
  const h = desktopReadHarness(), pending = h.load()("address-a");
  if (fence === "network") h.bindings.desktopNetworkRef.current = "testnet4";
  if (fence === "workspace") h.bindings.activeWorkspaceStatusKeyRef.current = "mail";
  if (fence === "clear") h.clear()();
  if (fence === "empty-target") await h.load()("");
  if (fence === "cleanup") {
    const cleanup = appEffect("desktopReadTargetRef.current = \"\"", h.bindings)();
    cleanup();
    h.bindings.activeWorkspaceStatusKeyRef.current = "desktop";
    assert.equal(h.requests[0].signal.aborted, true);
  }
  const statusesBefore = h.statuses.length, loadingBefore = h.loading.length;
  h.requests[0].resolve(emptyMail); await pending;
  assert.equal(h.accepted.filter(Boolean).length, 0, fence);
  assert.equal(h.statuses.length, statusesBefore, `${fence} late status`);
  assert.equal(h.loading.length, loadingBefore, `${fence} late finally`);
}
{
  const h = desktopReadHarness(), idRead = readDeferred();
  h.bindings.resolveRecipientInput = (query, _network, records) => records.length
    ? { paymentAddress: "resolved-address" } : { isId: true };
  h.bindings.fetchIdRecordState = (_network, _query, signal) => {
    h.idSignal = signal; return idRead.promise;
  };
  const pending = h.load()("name@proofofwork.me");
  h.clear()(); idRead.resolve({ records: [{}] }); await pending;
  assert.equal(h.idSignal.aborted, true);
  assert.equal(h.requests.length, 0, "cancelled ID resolution cannot start mail read");
}
const mailboxEnvelope = { address: "address-a", network: "livenet", ...emptyMail };
const readMailPayload = (payload) => appFunction("fetchAddressMail", {
  fetchProofApiJson: async () => payload,
})("address-a", "livenet", true);
assert.deepEqual(await readMailPayload(mailboxEnvelope), { ...emptyMail, readWarning: undefined });
for (const payload of [
  {}, { ...mailboxEnvelope, inboxMessages: undefined }, { ...mailboxEnvelope, sentMessages: {} },
  { ...mailboxEnvelope, address: undefined }, { ...mailboxEnvelope, network: undefined },
  { ...mailboxEnvelope, address: "Address-a" }, { ...mailboxEnvelope, network: "testnet4" },
  { ...mailboxEnvelope, error: "unavailable" }, { ...mailboxEnvelope, error: { reason: "unavailable" } },
  { ...mailboxEnvelope, historyCoverage: { complete: false } },
  { ...mailboxEnvelope, historyCoverage: null },
  { ...mailboxEnvelope, stats: { scanFailed: true } },
  { ...mailboxEnvelope, stats: { partialScan: true } },
  { ...mailboxEnvelope, scanError: "node scan failed" },
]) await assert.rejects(readMailPayload(payload), /could not be verified|scan failed or was incomplete/);
{
  // Successful node/testnet producers carry scope and arrays, without a DB witness.
  let requestedSignal;
  const signal = new AbortController().signal;
  const read = appFunction("fetchAddressMail", { fetchProofApiJson: async (_path, _network, options) => {
    requestedSignal = options.signal;
    return { ...mailboxEnvelope, network: "testnet4", source: "node-mail-scan", stats: { scanFailed: false, partialScan: false } };
  } });
  assert.deepEqual(await read("address-a", "testnet4", true, signal), { ...emptyMail, readWarning: undefined });
  assert.equal(requestedSignal, signal);
}
{
  const confirmed = { txid: "c".repeat(64), confirmed: true };
  const payload = { ...mailboxEnvelope, inboxMessages: [confirmed],
    historyCoverage: { model: "proof-index-address-mail-complete-v1", complete: true },
    scanError: "optional enrichment failed", stats: { scanFailed: true, partialScan: true } };
  const retained = await readMailPayload(payload);
  assert.deepEqual(retained.inboxMessages, [confirmed]);
  assert.match(retained.readWarning, /Complete indexed mail remains available/);
  const h = desktopReadHarness(); h.bindings.fetchAddressMail = () => readMailPayload(payload);
  await h.load()("address-a");
  assert.equal(h.accepted[0].readWarning, retained.readWarning);
  assert.equal(h.statuses.at(-1).tone, "idle");
  assert.match(h.statuses.at(-1).text, /supplemental scan failed/);
}
{
  const h = desktopReadHarness();
  const previous = { address: "last-verified", query: "last-verified" };
  h.accepted.push(previous);
  h.bindings.fetchAddressMail = () => readMailPayload({ ...mailboxEnvelope, stats: { scanFailed: true } });
  await h.load()("address-a");
  assert.deepEqual(h.accepted, [previous], "failed scan cannot replace a verified desktop with zero files");
  assert.equal(h.statuses.at(-1).tone, "bad");
  assert.doesNotMatch(h.statuses.at(-1).text, /desktop loaded/);
}
function browserReadHarness(owner = "BrowserApp") {
  const requests = [], routes = [], statuses = [], loading = [];
  const previous = { txid: "p".repeat(64), network: "livenet", confirmed: true };
  const state = { page: previous, network: "livenet", query: previous.txid };
  const bindings = {
    network: "livenet", activeNetwork: "livenet", query: previous.txid,
    loadGenerationRef: { current: 0 }, loadControllerRef: { current: undefined }, AbortController,
    initialLoadRef: { current: false },
    normalizeBrowserTarget: appFunction("normalizeBrowserTarget"),
    fetchBrowserTargetPage: (txid, network, signal) => {
      const request = { ...readDeferred(), txid, network, signal };
      requests.push(request); return request.promise;
    },
    setPage: (page) => { state.page = page; }, setQuery: (query) => { state.query = query; },
    setNetwork: (network) => { state.network = network; },
    setStatus: (status) => statuses.push(status), setLoading: (value) => loading.push(value),
    syncBrowserRoute: (...args) => routes.push(args), networkLabel: (network) => network,
    errorMessage: (error) => error.message,
  };
  return { requests, routes, statuses, loading, previous, state, bindings,
    load: () => appCallback(owner, "loadPage", bindings),
    change: () => appFunction(owner === "BrowserWorkspace" ? "changeBrowserWorkspaceNetwork" : "changeBrowserNetwork", bindings),
  };
}
{
  const normalize = appFunction("normalizeBrowserTarget");
  assert.equal(normalize(" ALICE.POW "), "alice.pow");
  for (const invalid of ["alice", "abc.alice.pow", "https://alice.pow", "-alice.pow", "alice.pow/", "a".repeat(64) + ".pow"]) {
    assert.equal(normalize(invalid), "", invalid);
  }
  const location = { search: "?browser=1&name=ALICE.POW", pathname: "/" };
  const fromLocation = appFunction("txidFromBrowserLocation", { window: { location }, normalizeBrowserTarget: normalize });
  assert.equal(fromLocation(), "alice.pow");
  location.search = ""; location.pathname = "/name/alice.pow";
  assert.equal(fromLocation(), "alice.pow");
  location.pathname = "/tx/" + "a".repeat(64);
  assert.equal(fromLocation(), "a".repeat(64));
  const route = appFunction("browserRoutePath", { normalizeBrowserTarget: normalize, isLocalPreviewHost: () => false });
  assert.equal(route("alice.pow", "livenet"), "/name/alice.pow");
  assert.equal(route("a".repeat(64), "testnet4"), "/tx/" + "a".repeat(64) + "?network=testnet4");
}
{
  const { readDnsPageLinkSnapshot } = await import("../src/features/pages/dnsPageLinkClient.mjs");
  const epoch = { txid: "a".repeat(64), protocolVout: 1, recordOrdinal: 0 };
  const root = { id: "alice", network: "livenet", confirmed: true, ownerAddress: "owner", receiveAddress: "receiver", ownershipEpoch: epoch, ownershipEpochBlockHeight: 8 };
  const snapshot = { network: "livenet", id: "alice", name: "alice.pow", routable: true, status: "confirmed",
    indexedThroughBlock: 11, checkpointHash: epoch.txid, coverage: { complete: true }, record: root, records: [root],
    pageLink: { name: "alice.pow", network: "livenet", pageTxid: "b".repeat(64), txid: "c".repeat(64), ownerAddress: "owner",
      epoch, ownershipEpoch: epoch, confirmed: true, active: true, valid: true, status: "active", blockHeight: 10, protocolVout: 1, recordOrdinal: 0 },
    pageLinkCoverage: { network: "livenet", complete: true, activationHeight: 9, indexedThroughBlock: 11, checkpointHash: epoch.txid,
      witnessSha256: epoch.txid, pageLinkSha256: epoch.txid, blockCount: 3, model: "dns-page-link-core-raw-block-coverage-v1" },
    pageLinkAdmission: { network: "livenet", ready: true, activationHeight: 9, indexedThroughBlock: 11,
      checkpointHash: epoch.txid, minSelfPaymentSats: 546, protocolPrefix: "pwdns1:page1:" },
    pageLinkEvents: [], pageLinkPendingEvents: [] };
  for (const stage of ["dns", "page"]) {
    const dns = readDeferred(), page = readDeferred(), controller = new AbortController(), requests = [];
    const load = appFunction("fetchBrowserTargetPage", {
      normalizeBrowserTarget: appFunction("normalizeBrowserTarget"), readDnsPageLinkSnapshot,
      isValidBitcoinAddress: () => true,
      fetchProofApiJson: (path, network, options) => { requests.push({ path, network, signal: options.signal }); return dns.promise; },
      fetchBrowserPage: (txid, network, signal) => { requests.push({ txid, network, signal }); return page.promise; },
    });
    const pending = load("alice.pow", "livenet", controller.signal);
    if (stage === "page") { dns.resolve(snapshot); await new Promise(resolve => setImmediate(resolve)); }
    controller.abort();
    if (stage === "dns") dns.resolve(snapshot);
    else page.resolve({ txid: snapshot.pageLink.pageTxid, confirmed: true });
    await assert.rejects(pending, { name: "AbortError" });
    assert.equal(requests.length, stage === "dns" ? 1 : 2);
    assert.equal(requests.every(request => request.signal === controller.signal), true);
  }
}
for (const outcome of ["success", "failure"]) {
  const h = browserReadHarness();
  const pending = h.load()("a".repeat(64), "livenet");
  h.change()("testnet4");
  assert.equal(h.requests[0].signal.aborted, true);
  const statusCount = h.statuses.length, loadingCount = h.loading.length;
  if (outcome === "success") h.requests[0].resolve({ txid: "a".repeat(64), network: "livenet", confirmed: true });
  else h.requests[0].reject(new Error("obsolete Browser failure"));
  await pending;
  assert.equal(h.state.network, "testnet4");
  assert.equal(h.state.page, h.previous, "manual selection preserves actual displayed page proof");
  assert.equal(h.state.query, h.previous.txid);
  assert.deepEqual(h.routes, [], "obsolete load cannot replace URL");
  assert.equal(h.statuses.length, statusCount);
  assert.equal(h.loading.length, loadingCount);
}
{
  const h = browserReadHarness(), load = h.load();
  const obsolete = load("a".repeat(64), "livenet");
  h.change()("testnet4"); h.bindings.network = "testnet4";
  const current = h.load()("b".repeat(64));
  const verifiedPage = { txid: "b".repeat(64), network: "testnet4", confirmed: true };
  h.requests[1].resolve(verifiedPage); await current;
  h.requests[0].resolve({ txid: "a".repeat(64), network: "livenet", confirmed: true }); await obsolete;
  assert.equal(h.state.page, verifiedPage);
  assert.equal(h.state.network, "testnet4");
  assert.deepEqual(h.routes, [[verifiedPage.txid, "testnet4"]]);
  assert.equal(h.statuses.at(-1).tone, "good");
}
{
  const h = browserReadHarness(), pending = h.load()("a".repeat(64));
  appEffect("initialLoadRef.current = false", h.bindings)()();
  assert.equal(h.requests[0].signal.aborted, true);
  h.requests[0].resolve({ txid: "a".repeat(64), network: "livenet", confirmed: true }); await pending;
  assert.equal(h.state.page, h.previous);
  assert.deepEqual(h.routes, []);
}
{
  // React StrictMode replays effect setup after cleanup; the URL must reload.
  const h = browserReadHarness();
  Object.assign(h.bindings, { loadPage: h.load(),
    txidFromBrowserLocation: () => "a".repeat(64), networkFromBrowserLocation: () => "livenet" });
  const initial = appEffect("initialLoadRef.current = true", h.bindings);
  initial();
  appEffect("initialLoadRef.current = false", h.bindings)()();
  initial();
  assert.equal(h.requests.length, 2);
  assert.equal(h.requests[0].signal.aborted, true);
  const page = { txid: "a".repeat(64), network: "livenet", confirmed: true };
  for (const request of h.requests) request.resolve(page);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(h.state.page, page);
  assert.deepEqual(h.routes, [], "initial URL load does not push a duplicate history entry");
}
for (const outcome of ["success", "failure"]) {
  const h = browserReadHarness("BrowserWorkspace");
  const pending = h.load()("a".repeat(64));
  h.change()("testnet4");
  assert.equal(h.requests[0].signal.aborted, true);
  const statusCount = h.statuses.length, loadingCount = h.loading.length;
  if (outcome === "success") h.requests[0].resolve({ txid: "a".repeat(64), network: "livenet", confirmed: true });
  else h.requests[0].reject(new Error("obsolete Computer Browser failure"));
  await pending;
  assert.equal(h.state.network, "testnet4");
  assert.equal(h.state.page, h.previous, "Computer keeps the displayed page's actual network proof");
  assert.equal(h.state.query, h.previous.txid);
  assert.equal(h.statuses.length, statusCount);
  assert.equal(h.loading.length, loadingCount);
  assert.deepEqual(h.routes, [], "Computer Browser does not alter the standalone URL");
}
{
  const h = browserReadHarness("BrowserWorkspace"), load = h.load();
  const first = load("a".repeat(64)), latest = load("b".repeat(64));
  assert.equal(h.requests[0].signal.aborted, true);
  h.requests[0].resolve({ txid: "a".repeat(64), network: "livenet", confirmed: true }); await first;
  assert.deepEqual(h.loading, [true, true], "Computer's obsolete finally cannot clear newer loading");
  const page = { txid: "b".repeat(64), network: "livenet", confirmed: true };
  h.requests[1].resolve(page); await latest;
  assert.equal(h.state.page, page);
  h.change()("testnet4"); h.bindings.network = "testnet4";
  const next = h.load()("c".repeat(64));
  const selectedPage = { txid: "c".repeat(64), network: "testnet4", confirmed: false };
  assert.equal(h.requests[2].network, "testnet4");
  h.requests[2].resolve(selectedPage); await next;
  assert.equal(h.state.page, selectedPage);
  assert.equal(h.statuses.at(-1).tone, "idle");
  assert.match(h.statuses.at(-1).text, /Verified pending HTML page/);
  assert.deepEqual(h.routes, []);
}
{
  const h = browserReadHarness("BrowserWorkspace");
  const pending = h.load()("a".repeat(64));
  h.bindings.activeNetwork = "testnet4";
  appEffect("setNetwork(activeNetwork)", h.bindings)();
  assert.equal(h.requests[0].signal.aborted, true);
  const statusCount = h.statuses.length, loadingCount = h.loading.length;
  h.requests[0].resolve({ txid: "a".repeat(64), network: "livenet", confirmed: true }); await pending;
  assert.equal(h.state.network, "testnet4");
  assert.equal(h.state.page, undefined);
  assert.equal(h.statuses.length, statusCount);
  assert.equal(h.loading.length, loadingCount);
}
{
  const h = browserReadHarness("BrowserWorkspace");
  const setup = appEffect("setNetwork(activeNetwork)", h.bindings);
  const cleanup = setup();
  cleanup(); setup(); // StrictMode effect replay has no automatic page request.
  const pending = h.load()("a".repeat(64));
  const page = { txid: "a".repeat(64), network: "livenet", confirmed: true };
  h.requests[0].resolve(page); await pending;
  assert.equal(h.state.page, page);
  const obsolete = h.load()("b".repeat(64));
  cleanup();
  assert.equal(h.requests[1].signal.aborted, true);
  const statusCount = h.statuses.length, loadingCount = h.loading.length;
  h.requests[1].reject(new Error("unmounted Computer Browser")); await obsolete;
  assert.equal(h.state.page, page);
  assert.equal(h.statuses.length, statusCount);
  assert.equal(h.loading.length, loadingCount);
}
console.log(JSON.stringify({ ok: true, coverage: ["desktop-latest-target-status-loading", "desktop-network-workspace-clear-cleanup-fences", "desktop-id-cancellation", "mail-scoped-envelope-failure", "mail-node-testnet-compatibility", "mail-complete-indexed-enrichment-warning", "browser-manual-network-cancellation", "browser-proof-url-preservation", "browser-unmount-fence", "computer-browser-manual-global-network-cancellation", "computer-browser-latest-request-and-unmount-fences", "computer-browser-strictmode-replay"] }));

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

// H6-08: run the actual holder/mint hooks, page validator, local-preview
// fallback and render functions. Network faults replace transport only.
const historyExactSource = await readFile("src/exactAmount.ts", "utf8");
const historyExact = await import(`data:text/javascript;base64,${Buffer.from(transpile(historyExactSource)).toString("base64")}`);
const historyWorkSource = await readFile("src/workAmount.ts", "utf8");
const historyWork = await import(`data:text/javascript;base64,${Buffer.from(transpile(historyWorkSource)).toString("base64")}`);
const historyWorkRecord = appFunction("workRecordAtoms", historyWork);
const historyWorkTokenId = "d4e5ebf11d104d6a63fb74e42094364b25a5f7199a09e5c0e71408972466a8b8";
const historyIsWork = appFunction("isWorkToken", { WORK_TOKEN_ID: historyWorkTokenId,
  WORK_TOKEN_TICKER: "WORK", normalizeTokenTicker: appFunction("normalizeTokenTicker") });
const historyValidator = appFunction("assertTokenHolderMintHistoryPage", {
  DATA_PAGE_SIZE: 25, isWorkToken: historyIsWork,
  workRecordAtoms: historyWorkRecord, exactIntegerBigInt: historyExact.exactIntegerBigInt,
});
const historyStatus = appFunction("tokenHistoryDisplayStatus");
let historyComponent;
function findHistoryComponent(node) {
  if (ts.isFunctionDeclaration(node) && node.name?.text === "TokenWorkspace") historyComponent = node;
  ts.forEachChild(node, findHistoryComponent);
}
findHistoryComponent(ast);
assert.ok(historyComponent);
const historyStatements = historyComponent.body.statements;
const historyPrefixEnd = historyStatements.findIndex((node) => node.getText(ast).startsWith("const confirmedTokenCount"));
assert.ok(historyPrefixEnd > 0);
const historyPrefix = historyStatements.slice(0, historyPrefixEnd).map((node) => node.getText(ast)).join("\n");
function historyInitializer(name) {
  let found;
  function find(node) {
    if (ts.isVariableDeclaration(node) && node.name.getText(ast) === name) found = node.initializer;
    ts.forEachChild(node, find);
  }
  find(historyComponent); assert.ok(found, name); return found.getText(ast);
}
const historyCountText = new Function(`${transpile(`const fn = ${historyInitializer("visibleCountText")};`)}return fn;`)();
const historyText = (node) => typeof node === "string" ? node : Array.isArray(node)
  ? node.map(historyText).join(" ") : node?.children ? historyText(node.children) : "";
const historyReact = { createElement: (type, props, ...children) => ({ type, props, children }) };
function historyRender(kind, snapshot, items = []) {
  const bindings = { React: historyReact,
    holderHistoryStatus: snapshot.holderHistoryStatus, mintHistoryStatus: snapshot.mintHistoryStatus,
    holderHistoryError: snapshot.holderHistoryError, mintHistoryError: snapshot.mintHistoryError,
    holderQuery: snapshot.holderQuery, mintQuery: snapshot.mintQuery,
    tokenAmountDisplay: (_token, amount) => String(amount), shortAddress: String,
    explorerAddressUrl: () => "", explorerTxUrl: () => "", formatDate: String, ArrowUpRight: "icon",
  };
  const name = kind === "holders" ? "renderHolderList" : "renderMintList";
  const render = new Function(...Object.keys(bindings),
    `${ts.transpileModule(`const fn = ${historyInitializer(name)};`, { compilerOptions: {
      target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext, jsx: ts.JsxEmit.React,
    } }).outputText}return fn;`)(...Object.values(bindings));
  return historyText(kind === "holders" ? render({ ticker: "DRAIN" }, items) : render(items));
}
const historyToken = { tokenId: "a".repeat(64), ticker: "DRAIN", holderCount: 387, confirmedMints: 21000, pendingMints: 0 };
function historyFixture() {
  const states = [], effects = [], pendingEffects = [], requests = [];
  let stateIndex, effectIndex;
  const props = { network: "livenet", workTokenOnly: false, tokenDetailTarget: "", address: "",
    selectedToken: historyToken, detailToken: undefined, walletBalances: [], tokens: [historyToken],
    holders: [{ tokenId: historyToken.tokenId, address: "preview-only", balance: 1 }], detailHolders: [], mints: [], detailMints: [],
    historySummary: { indexedAt: "2026-10-01T10:00:00Z", indexedThroughBlock: 969421,
      indexedThroughBlockHash: "b".repeat(64), snapshotId: "snapshot-one" },
  };
  const env = { ...props, useState(initial) {
    const index = stateIndex++;
    if (!(index in states)) states[index] = typeof initial === "function" ? initial() : initial;
    return [states[index], (value) => { states[index] = typeof value === "function" ? value(states[index]) : value; }];
  }, useEffect(fn, deps) {
    const index = effectIndex++, prior = effects[index];
    if (!prior || deps.some((value, i) => !Object.is(value, prior.deps[i]))) pendingEffects.push(() => {
      prior?.cleanup?.(); effects[index] = { deps, cleanup: fn() };
    });
  }, TOKEN_LIST_PREVIEW_COUNT: 25, DATA_PAGE_SIZE: 25,
    tokenHolderTotalCount: appFunction("tokenHolderTotalCount"), tokenHistoryDisplayStatus: historyStatus,
    isWorkToken: historyIsWork, tokenHolderMatchesDefinition: () => true,
    tokenHolderMatchesSearch: (row, query) => row.address.includes(query),
    tokenMintMatchesSearch: (row, query) => row.txid?.includes(query),
    pagedItems: appFunction("pagedItems", { DATA_PAGE_SIZE: 25 }),
    historyPageToPagedItems: appFunction("historyPageToPagedItems", { DATA_PAGE_SIZE: 25 }),
    errorMessage: (error) => error.message,
  };
  env.fetchTokenHistoryPage = appFunction("fetchTokenHistoryPage", {
    DATA_PAGE_SIZE: 25, assertTokenHolderMintHistoryPage: historyValidator,
    normalizeTokenHolderRecord: (row) => row, normalizeTokenAmountRecord: (row) => row,
    fetchProofApiJson: (path, _network, options) => {
      let resolve, reject;
      const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
      requests.push({ params: new URL(path, "http://fixture").searchParams, signal: options.signal, resolve, reject });
      return promise;
    },
  });
  const returns = ["holderHistoryStatus", "mintHistoryStatus", "holderHistoryError", "mintHistoryError",
    "holderQuery", "mintQuery", "historySourceKey", "remoteHolderPage", "remoteMintPage",
    "selectedVisibleHolders", "selectedVisibleMints", "holderHistoryKey", "mintHistoryKey",
    "setHolderSearch", "setMintSearch", "setHolderPageIndex", "setMintPageIndex",
    "setHolderHistoryRetryNonce", "setMintHistoryRetryNonce"].join(",");
  const run = new Function(...Object.keys(env), `${transpile(`function render(){${historyPrefix}\nreturn {${returns}};} `)}return render();`);
  const render = () => {
    stateIndex = 0; effectIndex = 0;
    Object.assign(env, props);
    const result = run(...Object.values(env));
    pendingEffects.splice(0).forEach((fn) => fn());
    return result;
  };
  return { render, props, requests, stop: () => effects.forEach((entry) => entry.cleanup?.()) };
}
function historyResponse(request, items = [], total = items.length) {
  const limit = Number(request.params.get("limit"));
  const start = Math.min(Number(request.params.get("page")) * limit, total);
  const end = Math.min(total, start + limit);
  return { kind: request.params.get("kind"), network: "livenet", query: request.params.get("q") ?? "",
    indexedAt: "2026-10-01T10:00:00Z", items, totalCount: total, start, end, limit, pageSize: limit,
    page: Math.floor(start / limit), pageCount: Math.max(1, Math.ceil(total / limit)), nextCursor: end < total ? "next" : "" };
}
const historyFlush = () => new Promise((resolve) => setImmediate(resolve));
for (const fault of ["HTTP 503", "request timed out", "malformed 200", "refusal error", "partial history",
  "preview page", "incomplete coverage"]) {
  const fixture = historyFixture(); let view = fixture.render();
  assert.equal(view.holderHistoryStatus, "loading"); assert.equal(view.mintHistoryStatus, "loading");
  assert.deepEqual(view.selectedVisibleHolders, [], "a partial preview cannot establish requested results");
  for (const request of fixture.requests) {
    if (fault === "malformed 200") request.resolve({});
    else if (fault === "refusal error") request.resolve({ ...historyResponse(request), error: { message: "failed" } });
    else if (fault === "partial history") request.resolve({ ...historyResponse(request), complete: false });
    else if (fault === "preview page") request.resolve({ ...historyResponse(request), preview: true });
    else if (fault === "incomplete coverage") request.resolve({ ...historyResponse(request), historyCoverage: { complete: false } });
    else request.reject(new Error(fault));
  }
  await historyFlush(); view = fixture.render();
  for (const kind of ["holders", "mints"]) {
    const status = kind === "holders" ? view.holderHistoryStatus : view.mintHistoryStatus;
    assert.equal(status, "unavailable");
    assert.match(historyRender(kind, view), /history unavailable/);
    assert.doesNotMatch(historyRender(kind, view), /No .*matches|No .*yet/);
    assert.doesNotMatch(historyCountText(0, 0, 0, kind, "search", status), /0 of 0/);
  }
  fixture.stop();
}
const emptyQueryHistory = historyFixture(); let emptyQueryView = emptyQueryHistory.render();
emptyQueryView.setHolderSearch("missing-holder"); emptyQueryView.setMintSearch("missing-mint");
let emptyQueryBefore = emptyQueryHistory.requests.length;
emptyQueryView = emptyQueryHistory.render();
for (const request of emptyQueryHistory.requests.slice(emptyQueryBefore)) request.resolve(historyResponse(request));
await historyFlush(); emptyQueryView = emptyQueryHistory.render();
for (const kind of ["holders", "mints"]) {
  assert.equal(kind === "holders" ? emptyQueryView.holderHistoryStatus : emptyQueryView.mintHistoryStatus, "verified");
  assert.match(historyRender(kind, emptyQueryView), /No .*matches/);
  assert.match(historyCountText(0, 0, 0, kind, "missing", "verified"), /0 of 0 matching/);
}
emptyQueryHistory.stop();
const retainedHistory = historyFixture(); let retainedView = retainedHistory.render();
for (const request of retainedHistory.requests) request.resolve(historyResponse(request));
await historyFlush(); retainedView = retainedHistory.render();
assert.equal(retainedView.holderHistoryStatus, "verified"); assert.equal(retainedView.mintHistoryStatus, "verified");
assert.match(historyRender("holders", retainedView), /No holders yet/);
assert.match(historyRender("mints", retainedView), /No mints yet/);
for (const patch of [
  { indexedThroughBlock: 969422, indexedThroughBlockHash: "c".repeat(64) },
  { indexedAt: "2026-10-01T10:01:00Z" }, { snapshotId: "snapshot-two" },
]) {
  const before = retainedHistory.requests.length;
  Object.assign(retainedHistory.props.historySummary, patch);
  retainedView = retainedHistory.render();
  assert.equal(retainedHistory.requests.length, before + 2, "same counts refetch after source evidence changes");
  assert.equal(retainedView.holderHistoryStatus, "last-verified");
  for (const request of retainedHistory.requests.slice(before)) request.reject(new Error("HTTP 503"));
  await historyFlush(); retainedView = retainedHistory.render();
  for (const kind of ["holders", "mints"]) {
    assert.match(historyRender(kind, retainedView), /last verified/i);
    assert.doesNotMatch(historyRender(kind, retainedView), /No .*yet/);
  }
}
retainedView.setHolderSearch("new-holder"); retainedView.setMintSearch("new-mint");
let beforeHistory = retainedHistory.requests.length; retainedView = retainedHistory.render();
assert.equal(retainedView.holderHistoryStatus, "loading"); assert.equal(retainedView.mintHistoryStatus, "loading");
assert.equal(retainedView.remoteHolderPage.key === retainedView.holderHistoryKey, false);
assert.equal(retainedView.remoteMintPage.key === retainedView.mintHistoryKey, false);
const obsoleteHistoryRequests = retainedHistory.requests.slice(beforeHistory);
retainedHistory.props.selectedToken = { ...historyToken, tokenId: "d".repeat(64) };
retainedView = retainedHistory.render();
for (const request of obsoleteHistoryRequests) {
  assert.equal(request.signal.aborted, true); request.resolve(historyResponse(request));
}
await historyFlush(); retainedView = retainedHistory.render();
assert.equal(retainedView.holderHistoryStatus, "loading"); assert.equal(retainedView.mintHistoryStatus, "loading");
retainedView.setHolderPageIndex(1); retainedView.setMintPageIndex(1);
const previousHistoryRequests = retainedHistory.requests.slice(-2);
retainedView = retainedHistory.render();
for (const request of previousHistoryRequests) { assert.equal(request.signal.aborted, true); request.resolve(historyResponse(request)); }
await historyFlush(); retainedView = retainedHistory.render();
assert.equal(retainedView.holderHistoryStatus, "loading"); assert.equal(retainedView.mintHistoryStatus, "loading");
retainedHistory.stop();
const nonemptyHistory = historyFixture();
let nonemptyView = nonemptyHistory.render();
const verifiedHolder = { tokenId: historyToken.tokenId, address: "verified-holder", balance: 3 };
const verifiedMint = { tokenId: historyToken.tokenId, ticker: "DRAIN", txid: "f".repeat(64), amount: 7,
  network: "livenet", confirmed: true, createdAt: "2026-10-01T09:00:00Z", paidSats: 1,
  minterAddress: "verified-minter", registryAddress: "verified-registry" };
for (const request of nonemptyHistory.requests) request.resolve(historyResponse(request,
  [request.params.get("kind") === "holders" ? verifiedHolder : verifiedMint]));
await historyFlush(); nonemptyView = nonemptyHistory.render();
assert.deepEqual(nonemptyView.selectedVisibleHolders, [verifiedHolder]);
assert.deepEqual(nonemptyView.selectedVisibleMints, [verifiedMint]);
nonemptyView.setHolderHistoryRetryNonce((value) => value + 1);
nonemptyView.setMintHistoryRetryNonce((value) => value + 1);
let nonemptyBefore = nonemptyHistory.requests.length;
nonemptyView = nonemptyHistory.render();
assert.equal(nonemptyHistory.requests.length, nonemptyBefore + 2);
nonemptyView = nonemptyHistory.render();
assert.equal(nonemptyView.holderHistoryStatus, "last-verified");
for (const request of nonemptyHistory.requests.slice(nonemptyBefore)) request.reject(new Error("request timed out"));
await historyFlush(); nonemptyView = nonemptyHistory.render();
assert.deepEqual(nonemptyView.selectedVisibleHolders, [verifiedHolder]);
assert.deepEqual(nonemptyView.selectedVisibleMints, [verifiedMint]);
assert.match(historyRender("holders", nonemptyView, nonemptyView.selectedVisibleHolders), /last verified/i);
assert.match(historyRender("mints", nonemptyView, nonemptyView.selectedVisibleMints), /last verified/i);
const completeLocalHolder = { ...verifiedHolder, address: "complete-local-holder" };
const completeLocalMint = { ...verifiedMint, txid: "e".repeat(64) };
nonemptyHistory.props.selectedToken = { ...historyToken, holderCount: 1, confirmedMints: 1 };
nonemptyHistory.props.holders = [completeLocalHolder]; nonemptyHistory.props.mints = [completeLocalMint];
nonemptyView = nonemptyHistory.render();
assert.equal(nonemptyView.holderHistoryStatus, "local"); assert.equal(nonemptyView.mintHistoryStatus, "local");
assert.deepEqual(nonemptyView.selectedVisibleHolders, [completeLocalHolder]);
assert.deepEqual(nonemptyView.selectedVisibleMints, [completeLocalMint]);
nonemptyHistory.stop();
for (const network of ["livenet", "testnet4"]) {
  const localHistory = historyFixture();
  localHistory.props.network = network;
  localHistory.props.selectedToken = { ...historyToken, holderCount: 1, confirmedMints: 1 };
  localHistory.props.mints = [{ ...verifiedMint, network }];
  const localView = localHistory.render();
  assert.equal(localHistory.requests.length, 0); assert.equal(localView.holderHistoryStatus, "local");
  assert.equal(localView.mintHistoryStatus, "local"); assert.equal(localView.selectedVisibleHolders.length, 1);
  assert.equal(localView.selectedVisibleMints.length, 1); localHistory.stop();
}
for (const kind of ["holders", "mints"]) {
  const request = { params: new URLSearchParams({ kind, page: "0", limit: "25", q: "" }) };
  const valid = historyResponse(request);
  assert.doesNotThrow(() => historyValidator(valid, "livenet", kind, { pageSize: 25 }));
  for (const patch of [{}, { items: null }, { totalCount: "0" }, { network: "testnet4" },
    { query: "other" }, { end: 1 }, { pageCount: 0 }, { indexedAt: "invalid" }, { nextCursor: "unexpected" }]) {
    assert.throws(() => historyValidator(Object.keys(patch).length ? { ...valid, ...patch } : {},
      "livenet", kind, { pageSize: 25 }), /could not be verified/);
  }
  const row = kind === "holders" ? verifiedHolder : verifiedMint;
  const populated = historyResponse(request, [row]);
  const options = { pageSize: 25, tokenScope: historyToken.tokenId };
  assert.doesNotThrow(() => historyValidator(populated, "livenet", kind, options));
  for (const envelope of [valid, populated]) {
    for (const refusal of [{ error: "canonical read unavailable" }, { error: { message: "failed" } },
      { complete: false }, { preview: true }, { authoritative: false }, { historyCoverage: { complete: false } }]) {
      assert.throws(() => historyValidator({ ...envelope, ...refusal }, "livenet", kind, options), /could not be verified/);
    }
  }
  const amountField = kind === "holders" ? "balance" : "amount";
  for (const rowPatch of [{ tokenId: "b".repeat(64) }, { [amountField]: "invalid" }, { [amountField]: -1 },
    ...(kind === "holders" ? [{ address: "" }] : [{ txid: "invalid" }, { network: "testnet4" },
      { confirmed: undefined }, { createdAt: "invalid" }, { amount: 0 }, { ticker: "" },
      { minterAddress: undefined }, { paidSats: undefined }, { paidSats: -1 }])]) {
    assert.throws(() => historyValidator({ ...populated, items: [{ ...row, ...rowPatch }] },
      "livenet", kind, options), /could not be verified/);
  }
  if (kind === "holders") assert.doesNotThrow(() => historyValidator({ ...populated,
    items: [{ ...row, balance: 0 }] }, "livenet", kind, options), "holder recovery may return confirmed zero");
  const workRow = { ...row, tokenId: historyWorkTokenId, ticker: "WORK", [amountField]: "0.0000000000000001",
    [kind === "holders" ? "balanceSubatoms" : "amountSubatoms"]: "1" };
  assert.doesNotThrow(() => historyValidator({ ...populated, items: [workRow] }, "livenet", kind,
    { ...options, tokenScope: historyWorkTokenId }), "one WORK Q16 subatom is valid history");
}
console.log(JSON.stringify({ ok: true, coverage: ["history-503-timeout-malformed-unavailable", "history-authoritative-empty",
  "history-retains-labeled-prior-page", "history-same-count-checkpoint-observation-refetch",
  "history-query-token-page-cancellation", "history-explicit-retry-retains-nonempty-page",
  "history-complete-livenet-and-legacy-local-history", "history-envelope-and-row-schema", "history-work-q16-smallest-unit",
  "history-explicit-refusal-never-authoritative-empty"] }));
