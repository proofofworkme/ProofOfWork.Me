import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import ts from "typescript";

// Execute current production functions, with deferred I/O and React setters.
// Historical audit reproductions remain immutable counterexamples.
const source = await readFile("src/App.tsx", "utf8");
const ast = ts.createSourceFile("App.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const declarations = new Map();
function visit(node) {
  if (ts.isFunctionDeclaration(node) && node.name) declarations.set(node.name.text, node.getText(ast));
  ts.forEachChild(node, visit);
}
visit(ast);
const transpile = (text) => ts.transpileModule(text, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None, jsx: ts.JsxEmit.React } }).outputText;
const compile = (names, env) => new Function(...Object.keys(env), `${transpile(names.map((name) => { assert.ok(declarations.has(name), name); return declarations.get(name); }).join("\n"))};return {${names.join(",")}}`)(...Object.values(env));
const slice = (start, end) => { const a = source.indexOf(start); const b = source.indexOf(end, a + start.length); assert.ok(a >= 0 && b > a); return source.slice(a, b); };
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
const flush = () => new Promise((resolve) => setImmediate(resolve));
const noop = () => {};
const coverage = [];

for (const order of ["old-first", "new-first"]) {
  const state = { query: "", loading: false, profile: null, status: null }; const requests = [];
  const env = {
    desktopQuery: "", activeWorkspaceStatusKeyRef: { current: "desktop" }, desktopRequestGenerationRef: { current: 0 }, desktopRequestControllerRef: {}, walletReadScopeRef: { current: { network: "livenet" } },
    network: "livenet", idRegistry: [], registryAddress: "registry", setStatusForWorkspace: (_, status) => state.status = status, setDesktopLoading: (value) => state.loading = value,
    resolveRecipientInput: (query) => ({ paymentAddress: query }), fetchIdRecordState: async () => assert.fail("unexpected ID read"),
    fetchAddressMail: (address, network, fresh, signal) => { const wait = deferred(); requests.push({ address, signal, ...wait }); return wait.promise; },
    fileSurfaceMessages: (rows) => rows, publicDesktopMail: (a, b) => [...a, ...b], hasAttachment: () => true, shortAddress: (value) => value,
    setDesktopQuery: (value) => state.query = value, setDesktopProfile: (value) => state.profile = value, setDesktopMail: noop, setDesktopSelectedKey: noop, mailKey: (row) => row.txid,
    setActiveFolder: noop, setComposeOpen: noop, setSelectedKey: noop, errorMessage: (error) => error.message,
  };
  const { loadDesktopTarget } = compile(["loadDesktopTarget"], env);
  const a = loadDesktopTarget("A"), b = loadDesktopTarget("B");
  assert.equal(requests[0].signal.aborted, true);
  const payload = { inboxMessages: [], sentMessages: [] };
  if (order === "old-first") { requests[0].resolve(payload); await a; assert.equal(state.loading, true); assert.equal(state.profile, null); requests[1].resolve(payload); await b; }
  else { requests[1].resolve(payload); await b; requests[0].reject(Error("obsolete failure")); await a; }
  assert.equal(state.query, "B"); assert.equal(state.profile.address, "B"); assert.equal(state.loading, false); assert.equal(state.status.tone, "good");
}
coverage.push("Desktop latest target owns success/error/loading; superseded read aborted");

{
  const requests = []; let selected, loading = false;
  const env = {
    activeWorkspaceStatusKeyRef: { current: "log" }, activitySearchGenerationRef: { current: 0 }, activityRequestControllerRef: {}, activityQueryRef: { current: "current-search" }, walletReadScopeRef: { current: { network: "livenet" } },
    ACTIVITY_FEED_PAGE_SIZE: 50, network: "livenet", nextProofApiReadAttempt: () => 1, activityHistoryCacheKey: JSON.stringify, setActivityLoading: (value) => loading = value,
    fetchGlobalActivityHistoryPage: (_, options) => { const wait = deferred(); requests.push({ options, ...wait }); return wait.promise; }, clearLastGoodReadWarning: noop,
    acceptActivityHistoryPage: (_, page) => selected = page, activityHistoryPagesRef: { current: new Map() }, setActivityHistoryPage: (page) => selected = page,
    isTransientProofApiReadError: () => false, showLastGoodReadWarning: () => false, setStatusForWorkspace: noop, errorMessage: (error) => error.message,
  };
  const { loadLogHistoryPage } = compile(["loadLogHistoryPage"], env);
  const a = loadLogHistoryPage(0, false), b = loadLogHistoryPage(2, false);
  assert.equal(requests[0].options.signal.aborted, true); assert.equal(requests[1].options.query, "current-search");
  requests[0].resolve({ page: 0 }); await a; assert.equal(loading, true); assert.equal(selected, undefined);
  requests[1].resolve({ page: 2 }); await b; assert.equal(loading, false); assert.equal(selected.page, 2);
  env.activityQueryRef.current = "new-query";
  const c = loadLogHistoryPage(1, true); assert.equal(requests[2].options.query, "new-query"); requests[2].resolve({ page: 1, query: "new-query" }); await c;
}
coverage.push("Log current-query reference and unified page request ownership");

{
  let interval, clean; const pageCalls = []; const query = { current: "a".repeat(64) }; const page = { current: { page: 3, query: query.current } };
  const env = {
    activityMode: true, activeFolder: "log", network: "livenet", setNetwork: noop, document: { visibilityState: "visible" },
    activityQueryRef: query, activityHistoryPageRef: page, activityProfileRef: { current: undefined },
    loadLogHead: async () => {}, loadLogHistoryPage: async (...args) => pageCalls.push(args), refreshLogSurface: async () => {},
    BACKGROUND_FRESH_REFRESH_DELAY_MS: 10, LOG_LIVE_REFRESH_MS: 15_000,
    window: { setTimeout: () => 1, clearTimeout: noop, setInterval: (fn) => { interval = fn; return 2; }, clearInterval: noop, addEventListener: noop, removeEventListener: noop },
    useEffect: (fn) => clean = fn(),
  };
  new Function(...Object.keys(env), transpile(slice('  useEffect(() => {\n    if (!(activityMode || activeFolder === "log"))', '\n  useEffect(() => {')))(...Object.values(env));
  interval(); await flush(); assert.equal(pageCalls[0][0], 3); assert.equal(pageCalls[0][2], query.current);
  query.current = "unsubmitted"; interval(); await flush(); assert.equal(pageCalls.length, 1); clean();
}
coverage.push("Log 15-second effect keeps verified tx query and does not submit edited text");

{
  const { activityKey, activityItemsForView } = compile(["activityKey", "activityItemsForView"], { activityMatchesSearch: () => true, compareActivityItems: () => 0 });
  const row = { eventId: 1, network: "livenet", kind: "token-transfer", protocol: "pwt1", txid: "a".repeat(64), protocolVout: 1, recordOrdinal: 0 };
  const other = { ...row, eventId: 2, protocolVout: 2 };
  assert.notEqual(activityKey(row), activityKey(other)); assert.equal(activityItemsForView([row, other], [], "").length, 2);
  assert.equal(activityKey(row), activityKey({ ...row, confirmed: true, eventId: 100000, blockHeight: 966125 }));
}
coverage.push("Log distinct protocol records survive; pending rematerialization keeps stable key");

{
  let focus, clean; const waits = []; const chainWaits = []; let utxos = [], chain = [], error = "";
  const env = {
    address: "A", network: "livenet", setAccountUtxos: (value) => utxos = value, setAccountUtxosLoaded: noop, setAccountUtxosError: (value) => error = value,
    setAccountChainUtxos: (value) => chain = value, setAccountChainUtxosLoaded: noop, setAccountChainUtxosError: noop,
    fetchUtxos: () => { const wait = deferred(); waits.push(wait); return wait.promise; }, fetchAddressApiUtxos: () => { const wait = deferred(); chainWaits.push(wait); return wait.promise; },
    errorMessage: (e) => e.message, useEffect: (fn) => clean = fn(), window: { setInterval: () => 1, clearInterval: noop, addEventListener: (_, fn) => focus = fn, removeEventListener: noop },
  };
  new Function(...Object.keys(env), transpile(slice('  useEffect(() => {\n    if (!address) {\n      setAccountUtxos', '\n  useEffect(() => {')))(...Object.values(env));
  focus(); waits[1].resolve([]); chainWaits[1].resolve([]); await flush(); waits[0].resolve([{ txid: "obsolete" }]); chainWaits[0].resolve([{ txid: "obsolete" }]); await flush();
  assert.deepEqual(utxos, []); assert.deepEqual(chain, []); assert.equal(error, ""); clean();
}
coverage.push("Wallet old UTXO results cannot restore spent outputs in either read lane");

for (const change of ["account", "network", "workspace", "generation"]) {
  const wait = deferred(); let inbox = [], folder = "ids", status;
  const env = {
    activeFolder: "inbox", address: "A", network: "livenet", mailRefreshGenerationRef: { current: 0 }, walletSyncGenerationRef: { current: 1 }, walletReadScopeRef: { current: { address: "A", network: "livenet" } }, activeWorkspaceStatusKeyRef: { current: "inbox" },
    setBusy: noop, setBusyForWorkspace: noop, setRefreshing: noop, setCheckingBroadcasts: noop, setStatus: (value) => status = value, fetchAddressMail: () => wait.promise,
    allSentRef: { current: [] }, broadcastTargetsFor: () => [], checkBroadcastTargets: async () => {}, applyBroadcastCheckResults: (value) => value,
    setInbox: (value) => inbox = value, setChainSent: noop, setAllSent: noop, setActiveFolder: (value) => folder = value, setComposeOpen: noop, setSelectedKey: noop,
    selectedInboundKey: () => "", mailboxSummary: () => "mail", broadcastCheckSummaryText: () => "", errorMessage: (error) => error.message,
  };
  const { refreshMail } = compile(["refreshMail"], env); const pending = refreshMail();
  if (change === "account") env.walletReadScopeRef.current.address = "B";
  if (change === "network") env.walletReadScopeRef.current.network = "testnet";
  if (change === "workspace") env.activeWorkspaceStatusKeyRef.current = "ids";
  if (change === "generation") env.walletSyncGenerationRef.current += 1;
  wait.resolve({ inboxMessages: [{ to: "A" }], sentMessages: [] }); await pending;
  assert.deepEqual(inbox, []); assert.equal(folder, "ids"); assert.notEqual(status?.tone, "good");
}
coverage.push("Mail rejects prior account/network/workspace/wallet generation after await");

{
  let calls = 0; const env = {
    activeWorkspaceStatusKeyRef: { current: "marketplace" }, completeMarketplaceListingHistoryRef: { current: { old: true } }, completeMarketplaceListingHistoryInFlightRef: { current: null }, completeMarketplaceListingHistoryFreshRef: { current: false }, completeMarketplaceListingHistoryControllerRef: {},
    fetchCompleteTokenListings: async (_, options) => { calls++; return { fresh: options.fresh, changed: calls }; }, completeTokenListingHistoryMatchesCheckpoint: () => true,
  };
  const { currentCompleteGlobalTokenListings } = compile(["currentCompleteGlobalTokenListings"], env);
  const a = await currentCompleteGlobalTokenListings({}, false), b = await currentCompleteGlobalTokenListings({}, true);
  assert.equal(calls, 2); assert.equal(a.changed, 1); assert.equal(b.changed, 2); assert.equal(b.fresh, true);
}
coverage.push("Same-block book and explicit fresh read recheck volatile outpoint authority");

{
  const effect = slice('  useEffect(() => {\n    const needsRemotePage =', '\n  useEffect(() => {');
  const run = (revision) => {
    let error, loading, dependencies; const retained = { verified: true }; let page = retained;
    const env = {
      holderQuery: "", holderHistoryTotalHint: 2, holderHistoryLocalCount: 0, holderPageIndex: 0, holderHistoryToken: { tokenId: "a".repeat(64) }, network: "livenet", holderHistoryKey: "same-query", TOKEN_LIST_PREVIEW_COUNT: 25,
      historyRevision: revision, historyRetry: 0, setRemoteHolderPage: (value) => page = value, setRemoteHolderPageLoading: (value) => loading = value, setRemoteHolderError: (value) => error = value,
      fetchTokenHistoryPage: async () => { throw Error("simulated503"); }, errorMessage: (error) => error.message,
      useEffect: (fn, deps) => { dependencies = deps; fn(); },
    };
    new Function(...Object.keys(env), transpile(effect))(...Object.values(env));
    return { read: () => ({ error, page, retained, loading }), dependencies };
  };
  const a = run(1); await flush(); assert.equal(a.read().error.message, "simulated503"); assert.equal(a.read().page, a.read().retained); assert.equal(a.read().loading, false);
  const b = run(2); assert.notDeepEqual(a.dependencies, b.dependencies); await flush();
}
coverage.push("Credit failed history remains unavailable/last verified; same-count revision reloads");


for (const cause of ["deadline", "external", "complete-empty"]) {
  let timer, timerCleared = false, calls = 0; const caller = new AbortController();
  const hash = "a".repeat(64);
  const payload = { indexedAt: "2026-09-08T23:00:00.000Z", indexedThroughBlock: 966125, indexedThroughBlockHash: hash, snapshotId: hash,
    totalCount: 0, items: [], kind: "listings", network: "livenet", source: "proof-indexer-complete-core-reconciled-token-listings", cursor: "", start: 0, end: 0, limit: 200, page: 0, pageCount: 1, hasMore: false,
    listingAuthority: { model: "proof-token-market-core-gettxout-v1", includeMempool: true, checkpoint: { height: 966125, blockHash: hash }, checkedOutpointsSha256: hash, checkedListingCount: 0, inputListingCount: 0, outputListingCount: 0, spentListingCount: 0, unspentListingCount: 0 },
    listingProjection: { model: "proof-token-market-cutover-after-core-v1", membershipSha256: hash, activeListingCount: 0, coreUnspentListingCount: 0, excludedByProtocolCount: 0 } };
  const env = { TOKEN_LISTING_BOOK_DEADLINE_MS: 90_000, MAX_TOKEN_HISTORY_PAGES: 100, TOKEN_HISTORY_PAGE_SIZE: 200,
    globalThis: { setTimeout: (callback, ms) => { assert.equal(ms, 90_000); timer = callback; return 7; }, clearTimeout: (id) => { assert.equal(id, 7); timerCleared = true; } },
    listingDisplayProjectionFingerprint: () => "already-tested-projection",
    fetchTokenHistoryPage: (_, __, options) => { calls++; if (cause === "complete-empty") return Promise.resolve(payload); return new Promise((_, reject) => options.signal.addEventListener("abort", () => reject(options.signal.reason), { once: true })); },
  };
  const { fetchCompleteTokenListings } = compile(["fetchCompleteTokenListings"], env);
  const result = fetchCompleteTokenListings("livenet", { fresh: true, signal: caller.signal });
  if (cause === "deadline") timer();
  if (cause === "external") caller.abort(Error("workspace left"));
  if (cause === "complete-empty") { const book = await result; assert.equal(book.totalCount, 0); assert.deepEqual(book.items, []); }
  else await assert.rejects(result, cause === "deadline" ? /90-second deadline/ : /workspace left/);
  assert.equal(calls, 1); assert.equal(timerCleared, true);
}
coverage.push("Complete book aggregate deadline and caller cancellation release timer and never accept a partial book");

console.log(JSON.stringify({ ok: true, coverage }, null, 2));
