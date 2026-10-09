import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import ts from "typescript";

async function importTypeScriptModule(relativePath) {
  const url = new URL(relativePath, pathToFileURL(`${process.cwd()}/`));
  const source = await readFile(url, "utf8");
  const transpiled = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.ESNext,
      target: ts.ScriptTarget.ES2022,
    },
    fileName: url.pathname,
  }).outputText;
  return import(
    `data:text/javascript;base64,${Buffer.from(transpiled).toString("base64")}`
  );
}

const { activityHistoryCacheKey } = await importTypeScriptModule(
  "src/shared/activity/logHistoryCache.ts",
);
const {
  clearProofApiReadWarning,
  currentProofApiReadWarning,
  isTransientProofApiReadError,
  ProofApiRequestError,
  proofApiLastGoodReadStatus,
  setProofApiReadWarning,
} = await importTypeScriptModule("src/shared/api/proofApiReadState.ts");
const {
  compareExactIntegers,
  exactIntegerBigInt,
  formatExactDecimal,
  formatExactInteger,
  formatExactQ8,
} = await importTypeScriptModule("src/exactAmount.ts");

const catchingUp = new ProofApiRequestError("catching up", {
  code: "CANONICAL_INDEX_CATCHING_UP",
  details: {
    indexedThroughBlock: 958_431,
    lagBlocks: 59,
    summarySnapshot: {
      indexedThroughBlock: 958_420,
      snapshotId: "ff4bf2984490c79d326866e3",
    },
    tipHeight: 958_490,
  },
  status: 503,
});
const catchingUpText = proofApiLastGoodReadStatus(catchingUp, {
  label: "WORK",
});
assert.match(catchingUpText, /is catching up/iu);
assert.match(catchingUpText, /59 blocks behind the full-node tip at 958,490/iu);
assert.match(catchingUpText, /summary block 958,420/iu);
assert.match(catchingUpText, /scan checkpoint is block 958,431/iu);
assert.match(catchingUpText, /snapshot ff4bf2984490c79d326866e3/iu);
assert.match(catchingUpText, /This view is not current/iu);

const summaryPublicationUnavailable = new ProofApiRequestError("catching up", {
  code: "CANONICAL_INDEX_CATCHING_UP",
  details: {
    indexedThroughBlock: 958_490,
    lagBlocks: 0,
    summarySnapshot: {
      indexedThroughBlock: 958_420,
      snapshotId: "last-good-summary",
    },
    tipHeight: 958_490,
  },
  status: 503,
});
const summaryPublicationText = proofApiLastGoodReadStatus(
  summaryPublicationUnavailable,
  { label: "WORK" },
);
assert.match(
  summaryPublicationText,
  /exact-tip summary publication is temporarily unavailable/iu,
);
assert.doesNotMatch(summaryPublicationText, /is catching up/iu);
assert.match(summaryPublicationText, /summary block 958,420/iu);
assert.match(
  summaryPublicationText,
  /scan checkpoint is block 958,490 at the full-node tip 958,490/iu,
);
assert.match(
  summaryPublicationText,
  /Canonical scan is at the full-node tip; actions recheck live admission before signing/iu,
);
assert.doesNotMatch(summaryPublicationText, /This view is not current/iu);

const generic503 = new ProofApiRequestError("temporarily unavailable", {
  status: 503,
});
const generic503Text = proofApiLastGoodReadStatus(generic503);
assert.match(generic503Text, /is temporarily unavailable/iu);
assert.doesNotMatch(generic503Text, /is catching up/iu);

const unavailableWithLag = new ProofApiRequestError("unavailable", {
  code: "CANONICAL_INDEX_UNAVAILABLE",
  details: { lagBlocks: 10 },
  status: 503,
});
assert.match(
  proofApiLastGoodReadStatus(unavailableWithLag),
  /is temporarily unavailable/iu,
);
assert.doesNotMatch(
  proofApiLastGoodReadStatus(unavailableWithLag),
  /is catching up/iu,
);

const walletUnavailable = new ProofApiRequestError("wallet proof unavailable", {
  code: "CANONICAL_WALLET_INDEX_UNAVAILABLE",
  details: {
    indexedThroughBlock: 958_490,
    tipHeight: 958_490,
  },
  status: 503,
});
assert.equal(isTransientProofApiReadError(walletUnavailable), true);
const walletUnavailableText = proofApiLastGoodReadStatus(walletUnavailable, {
  label: "Wallet",
});
assert.match(
  walletUnavailableText,
  /exact-tip wallet balance proof is temporarily unavailable/iu,
);
assert.match(
  walletUnavailableText,
  /Wallet actions remain unavailable until the wallet proof catches up/iu,
);
assert.doesNotMatch(walletUnavailableText, /is catching up/iu);

const warnings = new Map();
assert.equal(
  setProofApiReadWarning(warnings, "work", {
    attempt: 2,
    source: "token",
    text: "token warning",
  }),
  true,
);
assert.equal(
  setProofApiReadWarning(warnings, "work", {
    attempt: 1,
    source: "token",
    text: "stale token warning",
  }),
  false,
);
assert.equal(currentProofApiReadWarning(warnings, "work")?.text, "token warning");
assert.equal(
  setProofApiReadWarning(warnings, "work", {
    attempt: 3,
    source: "work-floor",
    text: "floor warning",
  }),
  true,
);
assert.equal(currentProofApiReadWarning(warnings, "work")?.text, "floor warning");
assert.equal(clearProofApiReadWarning(warnings, "work", "token", 4), true);
assert.equal(currentProofApiReadWarning(warnings, "work")?.text, "floor warning");
assert.equal(
  setProofApiReadWarning(warnings, "work", {
    attempt: 5,
    source: "token",
    text: "new token warning",
  }),
  true,
);
assert.equal(clearProofApiReadWarning(warnings, "work", "token", 4), false);
assert.equal(
  currentProofApiReadWarning(warnings, "work")?.text,
  "new token warning",
);
assert.equal(clearProofApiReadWarning(warnings, "work", "token", 5), true);
assert.equal(currentProofApiReadWarning(warnings, "work")?.text, "floor warning");

const baseHistoryIdentity = {
  kind: "history",
  pageIndex: 0,
  pageSize: 50,
  query: "ABCDEF0123456789ABCDEF0123456789ABCDEF0123456789ABCDEF0123456789",
  snapshotId: "snapshot-a",
};
const baseHistoryKey = activityHistoryCacheKey(baseHistoryIdentity);
assert.equal(
  baseHistoryKey,
  activityHistoryCacheKey({
    ...baseHistoryIdentity,
    query: baseHistoryIdentity.query.toLowerCase(),
  }),
);
for (const changedIdentity of [
  { ...baseHistoryIdentity, kind: "search" },
  { ...baseHistoryIdentity, pageIndex: 1 },
  { ...baseHistoryIdentity, cursor: "cursor-a" },
  { ...baseHistoryIdentity, snapshotId: "snapshot-b" },
  { ...baseHistoryIdentity, query: "different-query" },
]) {
  assert.notEqual(baseHistoryKey, activityHistoryCacheKey(changedIdentity));
}
assert.notEqual(
  activityHistoryCacheKey({ ...baseHistoryIdentity, query: "1Base58Address" }),
  activityHistoryCacheKey({ ...baseHistoryIdentity, query: "1base58address" }),
);
assert.equal(
  activityHistoryCacheKey({
    ...baseHistoryIdentity,
    query: "CarbonZ@ProofOfWork.Me",
  }),
  activityHistoryCacheKey({
    ...baseHistoryIdentity,
    query: "carbonz@proofofwork.me",
  }),
);

const aboveSafeInteger = "12692190658411191";
const adjacentAboveSafeInteger = "12692190658411192";
assert.equal(exactIntegerBigInt(aboveSafeInteger), 12_692_190_658_411_191n);
assert.equal(formatExactInteger(aboveSafeInteger), "12,692,190,658,411,191");
assert.equal(
  compareExactIntegers(adjacentAboveSafeInteger, aboveSafeInteger),
  1,
);
assert.equal(Number(adjacentAboveSafeInteger), Number(aboveSafeInteger));
assert.equal(
  formatExactDecimal("188495944821384.822", {
    maximumFractionDigits: 8,
  }),
  "188,495,944,821,384.822",
);
assert.equal(
  formatExactQ8("18849594482138482200000"),
  "188,495,944,821,384.822",
);
assert.equal(
  formatExactDecimal(1e25),
  "10,000,000,000,000,000,000,000,000",
);

console.log(
  JSON.stringify({
    checks: 43,
    logCacheDimensions: ["query", "kind", "page", "cursor", "snapshot"],
    ok: true,
  }),
);

// Execute the actual scheduler with deterministic event/timer ownership.
const loopSource = await readFile("src/shared/api/useVisibleReadLoop.ts", "utf8");
const loopJs = ts.transpileModule(loopSource, { compilerOptions: {
  module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022,
} }).outputText;
const { runInNewContext } = await import("node:vm");
const documentEvents = new EventTarget(); documentEvents.visibilityState = "visible";
const windowEvents = new EventTarget();
let clock = 0; let timerId = 0;
const scheduled = new Map();
const loopExports = {};
runInNewContext(loopJs, {
  exports: loopExports, document: documentEvents, window: windowEvents,
  AbortController, DOMException, Promise, Date: { now: () => clock },
  setTimeout: (fn, ms) => { const id = ++timerId; scheduled.set(id, { fn, at: clock + ms }); return id; },
  clearTimeout: (id) => scheduled.delete(id),
});
const loopFlush = async () => { for (let i = 0; i < 8; i++) await Promise.resolve(); };
const loopReads = [];
const stopLoop = loopExports.createVisibleReadLoop((signal) => {
  let finish;
  const promise = new Promise((resolve) => { finish = resolve; });
  loopReads.push({ signal, finish });
  return promise;
}, 60_000);
await loopFlush(); assert.equal(loopReads.length, 1);
clock = 2_000; windowEvents.dispatchEvent(new Event("focus"));
assert.equal(loopReads.length, 1, "automatic reads never overlap");
documentEvents.visibilityState = "hidden"; documentEvents.dispatchEvent(new Event("visibilitychange"));
assert.equal(loopReads[0].signal.aborted, true);
assert.equal(scheduled.size, 0);
clock += 180_000; windowEvents.dispatchEvent(new Event("focus"));
assert.equal(loopReads.length, 1, "hidden focus schedules no read");
documentEvents.visibilityState = "visible"; documentEvents.dispatchEvent(new Event("visibilitychange"));
windowEvents.dispatchEvent(new Event("focus"));
await loopFlush(); assert.equal(loopReads.length, 1, "resume waits for outstanding read to settle");
loopReads[0].finish(); await loopFlush(); assert.equal(loopReads.length, 2, "one catch-up after visibility resume");
loopReads[1].finish(); await loopFlush(); assert.equal(scheduled.size, 1);
stopLoop(); assert.equal(scheduled.size, 0);
clock += 60_000; windowEvents.dispatchEvent(new Event("focus"));
documentEvents.dispatchEvent(new Event("visibilitychange")); await loopFlush();
assert.equal(loopReads.length, 2, "stopped listeners cannot launch new reads");
documentEvents.visibilityState = "hidden";
const stopHidden = loopExports.createVisibleReadLoop(() => { throw new Error("hidden read started"); }, 1);
await loopFlush(); assert.equal(scheduled.size, 0); stopHidden();
documentEvents.visibilityState = "visible";
let oneShotReads = 0;
const stopOneShot = loopExports.createVisibleReadLoop(async () => { oneShotReads++; });
await loopFlush(); assert.equal(oneShotReads, 1); assert.equal(scheduled.size, 0, "one-shot display adds no interval polling");
documentEvents.visibilityState = "hidden"; documentEvents.dispatchEvent(new Event("visibilitychange"));
documentEvents.visibilityState = "visible"; documentEvents.dispatchEvent(new Event("visibilitychange"));
await loopFlush(); assert.equal(oneShotReads, 2); stopOneShot();
let failedCycleSignal;
const stopFailedCycle = loopExports.createVisibleReadLoop(async (signal) => {
  failedCycleSignal = signal;
  throw new Error("one member of a read group failed early");
});
await loopFlush(); assert.equal(failedCycleSignal.aborted, true, "settled cycle cancels outstanding siblings and retry waits");
stopFailedCycle();
const delayedAbort = new AbortController();
const delayed = loopExports.waitForDisplayRead(1_000, delayedAbort.signal);
delayedAbort.abort(); await assert.rejects(delayed); assert.equal(scheduled.size, 0);
let providerFinish;
const provider = new Promise((resolve) => { providerFinish = resolve; });
const providerAbort = new AbortController();
const consumed = loopExports.consumeDisplayRead(provider, providerAbort.signal);
providerAbort.abort(); await assert.rejects(consumed);
providerFinish("late provider evidence"); await loopFlush();

// Compile the actual App transport declarations; no replacement deadline logic.
const appText = await readFile("src/App.tsx", "utf8");
const transportAst = ts.createSourceFile("App.tsx", appText, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const declarations = new Map();
function collectTransport(node) {
  if (ts.isFunctionDeclaration(node) && node.name) declarations.set(node.name.text, node.getText(transportAst));
  ts.forEachChild(node, collectTransport);
}
collectTransport(transportAst);
const compileTransport = (name, env) => new Function(...Object.keys(env), ts.transpileModule(
  declarations.get(name) + `\nreturn ${name};`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } },
).outputText)(...Object.values(env));
const { createInFlightRequestPool } = await importTypeScriptModule("src/shared/api/inFlightRequestPool.ts");
const transportRequests = [];
const pool = createInFlightRequestPool();
const addressEnv = {
  addressUtxoReadPool: pool, AbortController, DOMException, globalThis,
  WALLET_UTXO_FETCH_RETRY_DELAYS_MS: [0, 10], WALLET_UTXO_FETCH_TIMEOUT_MS: 1_000,
  waitForDisplayRead: loopExports.waitForDisplayRead,
  proofApiUrl: (path, network) => path + "?network=" + network,
  errorMessage: (error, fallback) => error?.message || fallback,
  normalizeWalletUtxos: (rows, source) => rows.map((row) => ({ ...row, source })),
  fetch: (url, options) => new Promise((resolve, reject) => {
    const request = { url, signal: options.signal, resolve, reject };
    transportRequests.push(request);
    options.signal.addEventListener("abort", () => reject(options.signal.reason), { once: true });
  }),
};
addressEnv.loadAddressApiUtxos = compileTransport("loadAddressApiUtxos", addressEnv);
const loadAddress = compileTransport("fetchAddressApiUtxos", addressEnv);
const consumerA = new AbortController(); const consumerB = new AbortController();
const readA = loadAddress("CaseSensitive", "livenet", consumerA.signal);
const readB = loadAddress("CaseSensitive", "livenet", consumerB.signal);
await loopFlush(); assert.equal(transportRequests.length, 1);
consumerA.abort(); await assert.rejects(readA);
assert.equal(transportRequests[0].signal.aborted, false, "another consumer retains shared HTTP evidence");
transportRequests[0].resolve({ ok: true, json: async () => [{ txid: "verified", value: 546 }] });
assert.equal((await readB)[0].source, "api");
// An authority/pre-broadcast read cannot join an earlier display request.
const earlierDisplay = new AbortController();
const displayRead = loadAddress("signer", "livenet", earlierDisplay.signal);
const independentPreflight = loadAddress("signer", "livenet");
await loopFlush(); assert.equal(transportRequests.length, 3, "preflight starts independent fresh HTTP evidence");
for (const request of transportRequests.slice(1)) request.resolve({ ok: true, json: async () => [] });
await Promise.all([displayRead, independentPreflight]);
const allGone = new AbortController(); const abandoned = loadAddress("other", "livenet", allGone.signal);
await loopFlush(); allGone.abort(); await assert.rejects(abandoned); await loopFlush();
assert.equal(transportRequests[3].signal.aborted, true);
assert.equal(transportRequests.length, 4, "last-consumer cancellation cannot retry");
const separate = [loadAddress("CaseSensitive", "testnet4"), loadAddress("casesensitive", "livenet")];
await loopFlush(); assert.equal(transportRequests.length, 6, "network and case-sensitive account keys remain separate");
for (const request of transportRequests.slice(4)) request.resolve({ ok: true, json: async () => [] });
await Promise.all(separate);
const bodyAbort = new AbortController();
const bodyRead = loadAddress("body", "livenet", bodyAbort.signal); await loopFlush();
const bodyRequest = transportRequests.at(-1);
bodyRequest.resolve({ ok: true, json: () => new Promise((resolve, reject) => {
  bodyRequest.signal.addEventListener("abort", () => reject(bodyRequest.signal.reason), { once: true });
}) });
await loopFlush(); bodyAbort.abort(); await assert.rejects(bodyRead); await loopFlush();
assert.equal(bodyRequest.signal.aborted, true);
for (const stage of ["headers", "body"]) {
  let observedSignal;
  const outspend = compileTransport("fetchTransactionOutspend", {
    proofApiUrl: (path) => path, AbortController, DOMException, globalThis,
    TX_OUTSPEND_FETCH_TIMEOUT_MS: 10,
    fetch: (_url, { signal }) => {
      observedSignal = signal;
      const pending = () => new Promise((resolve, reject) => signal.addEventListener("abort", () => reject(signal.reason), { once: true }));
      return stage === "headers" ? pending() : Promise.resolve({ ok: true, json: pending });
    },
  });
  await assert.rejects(outspend("tx", 0, "livenet"), /sale-ticket spend state before timeout/);
  assert.equal(observedSignal.aborted, true, `${stage} remains within deadline`);
}
for (const [response, expected] of [[{ ok: false }, null], [{ ok: true, json: async () => ({ spent: false }) }, { spent: false }]]) {
  const outspend = compileTransport("fetchTransactionOutspend", {
    proofApiUrl: (path) => path, AbortController, DOMException, globalThis,
    TX_OUTSPEND_FETCH_TIMEOUT_MS: 10, fetch: async () => response,
  });
  assert.deepEqual(await outspend("tx", 0, "livenet"), expected);
}
console.log(JSON.stringify({ ok: true, coverage: ["visible-loop-no-overlap", "hidden-no-idle", "resume-one-catchup", "scope-owned-delay",
  "obsolete-provider-read", "actual-utxo-shared-read", "independent-consumer-abort", "utxo-abort-no-retry", "utxo-body-cancel",
  "network-account-key-separation", "actual-outspend-header-body-deadline", "outspend-nonOK-stays-null"] }));

// Automatic funding readiness owns retries; signing callers without a signal
// still perform independent fresh reservation verification.
let anchorCalls = 0;
const anchorRetryAbort = new AbortController();
let releaseRetry;
const retryStarted = new Promise((resolve) => { releaseRetry = resolve; });
const anchorRetry = compileTransport("fetchFreshWalletTokenListingsForAnchors", {
  TOKEN_SPENDABLE_RECHECK_DELAYS_MS: [0, 2_000],
  delay: async () => {},
  waitForDisplayRead: (_ms, signal) => new Promise((resolve, reject) => {
    releaseRetry(); signal.addEventListener("abort", () => reject(signal.reason), { once: true });
  }),
  URLSearchParams,
  fetchProofApiJson: async (_path, _network, { signal }) => {
    signal?.throwIfAborted(); anchorCalls++;
    throw new Error("canonical read unavailable");
  },
  normalizeTokenListingRecords: (rows) => rows,
  isTransientProofApiReadError: () => true,
});
const abortableAnchorRead = anchorRetry("owner", "work", { signal: anchorRetryAbort.signal });
await retryStarted; anchorRetryAbort.abort(); await assert.rejects(abortableAnchorRead);
assert.equal(anchorCalls, 1, "hidden funding readiness cancels scheduled retries");
await assert.rejects(anchorRetry("owner", "work"), /canonical read unavailable/);
assert.equal(anchorCalls, 3, "fresh signing retries remain independent without a display signal");
