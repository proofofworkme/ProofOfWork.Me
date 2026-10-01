import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";

const source = await readFile("src/App.tsx", "utf8");
const ast = ts.createSourceFile("App.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const transpile = (text) => ts.transpileModule(text, { compilerOptions: {
  target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext,
} }).outputText;
async function moduleAt(path) {
  return import(`data:text/javascript;base64,${Buffer.from(transpile(await readFile(path, "utf8"))).toString("base64")}`);
}
const work = await moduleAt("src/workAmount.ts");
const exact = await moduleAt("src/exactAmount.ts");
const constants = {
  WORK_TOKEN_ID: "d4e5ebf11d104d6a63fb74e42094364b25a5f7199a09e5c0e71408972466a8b8",
  WORK_TOKEN_TICKER: "WORK",
  POWB_TOKEN_ID: "a3d0bc8528f91dfc52400a885bed7e49235396aa82aa9f95db41be629f1d5562",
  POWB_TOKEN_TICKER: "POWB",
  INCB_TOKEN_ID: "3cb25745f937f2b4e5508e5400189fe8fe679cd8e84bfa1e9176d70c9761f15d",
  INCB_TOKEN_TICKER: "INCB",
};
const bindings = { ...work, ...exact, ...constants };
function actualFunction(name) {
  let declaration;
  function visit(node) {
    if (ts.isFunctionDeclaration(node) && node.name?.text === name) declaration = node;
    ts.forEachChild(node, visit);
  }
  visit(ast);
  assert.ok(declaration, name);
  return new Function(...Object.keys(bindings), `${transpile(declaration.getText(ast))}; return ${name}`)(...Object.values(bindings));
}
for (const name of ["normalizeTokenTicker", "exactTokenTickerScope", "tokenScopeMatchesToken", "isWorkToken",
  "workRecordAtoms", "formatWorkAmountForTokenAtoms", "tokenAmountDisplay", "tokenWalletBalanceDisplay",
  "tokenAmountValueFromUnits", "tokenAmountDisplayFromUnits", "tokenStateScopeKey", "accountTokenLaneForDefinition",
  "accountTokenLaneHasCleanAuthority", "accountTokenLaneErrorForDefinition", "emptyAccountTokenLaneStatuses"])
  bindings[name] = actualFunction(name);
const balanceNote = actualFunction("tokenMarketplaceConfirmedWalletBalance");
const address = "18hkqE81wQuq75UEBKhB4JjAuQg47jN7Aa";
const token = { network: "livenet", tokenId: constants.WORK_TOKEN_ID, ticker: "WORK" };
const freshStatuses = () => bindings.emptyAccountTokenLaneStatuses();
const scope = (network = "livenet", wallet = address) => bindings.tokenStateScopeKey({ network, walletScoped: true, address: wallet });
const evidence = (statuses = freshStatuses(), balances = []) => ({ scope: scope(), statuses, balances });
const balance = { token, confirmedBalance: 0.9999997003878536, confirmedBalanceSubatoms: "9999997003878536",
  pendingOutgoingSubatoms: "26915978817", pendingIncomingSubatoms: "0" };

test("compact global history never establishes an account zero before a clean scoped read", () => {
  assert.equal(balanceNote(token, address, "livenet", evidence()), "Your confirmed balance Loading WORK");
  const statuses = freshStatuses(); statuses.work.loading = true;
  assert.equal(balanceNote(token, address, "livenet", evidence(statuses)), "Your confirmed balance Loading WORK");
  statuses.work = { loaded: false, loading: false, error: "read unavailable" };
  assert.equal(balanceNote(token, address, "livenet", evidence(statuses)), "Your confirmed balance Unavailable WORK");
});

test("accepted confirmed WORK keeps all 16 decimals and does not display spendable as confirmed", () => {
  const statuses = freshStatuses(); statuses.work.loaded = true;
  assert.equal(balanceNote(token, address, "livenet", evidence(statuses, [balance])),
    "Your confirmed balance 0.9999997003878536 WORK");
  assert.equal(balanceNote(token, address, "livenet", evidence(statuses)), "Your confirmed balance 0.0000000000000000 WORK");
  const unknown = { ...balance, confirmedBalance: "unknown", confirmedBalanceSubatoms: undefined };
  assert.equal(balanceNote(token, address, "livenet", evidence(statuses, [unknown])), "Your confirmed balance Unavailable WORK");
});

test("account, case-sensitive address, network and token scope cannot reuse another balance", () => {
  const statuses = freshStatuses(); statuses.work.loaded = true;
  const accepted = evidence(statuses, [balance]);
  for (const wallet of ["new-account", address.toLowerCase(), ""])
    assert.equal(balanceNote(token, wallet, "livenet", accepted), "Your confirmed balance Loading WORK");
  assert.equal(balanceNote({ ...token, network: "testnet" }, address, "testnet", accepted), "Your confirmed balance Loading WORK");
  assert.equal(balanceNote(token, address, "livenet", { ...accepted, scope: "" }), "Your confirmed balance Loading WORK");
  assert.equal(balanceNote(token, address, "livenet", evidence(statuses, [{ ...balance, token: { ...token, tokenId: "different-token" } }])),
    "Your confirmed balance 0.0000000000000000 WORK");
});

test("retained accepted balances are explicitly last verified while refreshing or after a scoped error", () => {
  const statuses = freshStatuses(); statuses.work = { loaded: true, loading: true, error: "" };
  assert.equal(balanceNote(token, address, "livenet", evidence(statuses, [balance])),
    "Your last verified confirmed balance 0.9999997003878536 WORK");
  statuses.work = { loaded: true, loading: false, error: "fresh read unavailable" };
  assert.equal(balanceNote(token, address, "livenet", evidence(statuses, [balance])), "Your confirmed balance Unavailable WORK");
  statuses.all.loaded = true;
  assert.equal(balanceNote(token, address, "livenet", evidence(statuses, [balance])),
    "Your confirmed balance 0.9999997003878536 WORK");
  statuses.all.loading = true;
  assert.equal(balanceNote(token, address, "livenet", evidence(statuses, [balance])),
    "Your last verified confirmed balance 0.9999997003878536 WORK");
  statuses.work = { loaded: false, loading: false, error: "" };
  assert.equal(balanceNote(token, address, "livenet", evidence(statuses, [balance])),
    "Your last verified confirmed balance 0.9999997003878536 WORK");
  statuses.work = { loaded: true, loading: false, error: "" };
  assert.equal(balanceNote(token, address, "livenet", evidence(statuses, [balance])),
    "Your confirmed balance 0.9999997003878536 WORK");
});

const deferred = () => { let resolve; let reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
const flush = () => new Promise((resolve) => setImmediate(resolve));
function accountHydrationFixture(wallet = address, network = "livenet") {
  let effect;
  function visit(node) {
    if (ts.isCallExpression(node) && node.expression.getText(ast) === "useEffect" &&
      node.arguments[0]?.getText(ast).includes("const loadAccountTokenBalances =")) effect = node.arguments[0];
    ts.forEachChild(node, visit);
  }
  visit(ast); assert.ok(effect);
  const requests = []; const accepted = []; const listeners = new Map(); let statuses = freshStatuses(); let acceptedScope;
  const env = { ...constants, address: wallet, network, tokenIndexAddress: "registry",
    tokenStateScopeKey: bindings.tokenStateScopeKey, emptyAccountTokenLaneStatuses: freshStatuses,
    emptyTokenState: () => ({ empty: true }), AbortController,
    setAccountTokenBalanceScope: (value) => { acceptedScope = value; },
    setAccountTokenLaneStatuses: (value) => { statuses = typeof value === "function" ? value(statuses) : value; },
    errorMessage: (error) => error.message,
    window: { setInterval: (handler) => { listeners.set("interval", handler); return 1; }, clearInterval() {},
      addEventListener: (event, handler) => listeners.set(event, handler), removeEventListener: (event) => listeners.delete(event) },
    fetchTokenState: (...args) => { const gate = deferred(); requests.push({ ...gate, args }); return gate.promise; },
  };
  for (const name of ["setAccountTokenState", "setAccountWorkTokenState", "setAccountPowbTokenState", "setAccountIncbTokenState"])
    env[name] = (state) => { if (!state.empty) accepted.push({ name, state }); };
  const start = new Function(...Object.keys(env), `${transpile(`const effect = ${effect.getText(ast)};`)};return effect`)(...Object.values(env));
  const stop = start();
  return { requests, accepted, listeners, stop, scope: () => acceptedScope, statuses: () => statuses };
}

test("wallet hydration coalesces in-flight focus reads and publishes independent lanes before fresh WORK", async () => {
  const fixture = accountHydrationFixture();
  assert.equal(fixture.scope(), scope()); assert.equal(fixture.requests.length, 4);
  fixture.listeners.get("focus")(); fixture.listeners.get("interval")();
  assert.equal(fixture.requests.length, 4);
  for (const request of fixture.requests) {
    assert.equal(request.args[5], true); assert.deepEqual(request.args[4], [address]);
    assert.ok(request.args[7] instanceof AbortSignal);
  }
  fixture.requests[1].resolve({ verified: "cached-work" }); await flush();
  assert.equal(fixture.requests.length, 5); assert.equal(fixture.statuses().work.loaded, true);
  assert.equal(fixture.statuses().work.loading, true); assert.equal(fixture.accepted.length, 1);
  fixture.listeners.get("focus")(); assert.equal(fixture.requests.length, 5);
  for (const index of [0, 2, 3, 4]) fixture.requests[index].resolve({ verified: index });
  await flush(); assert.equal(fixture.statuses().work.loading, false);
  fixture.listeners.get("focus")(); assert.equal(fixture.requests.length, 9);
  fixture.stop(); for (const request of fixture.requests.slice(5)) request.resolve({ obsolete: true }); await flush();
  assert.equal(fixture.accepted.length, 5);
});

test("account/network change aborts obsolete requests and late responses never commit", async () => {
  const old = accountHydrationFixture(); old.stop();
  for (const request of old.requests) { assert.equal(request.args[7].aborted, true); request.resolve({ obsolete: true }); }
  await flush(); assert.deepEqual(old.accepted, []); assert.equal(old.requests.length, 4);
  const next = accountHydrationFixture("new-account", "testnet");
  assert.equal(next.scope(), scope("testnet", "new-account"));
  assert.ok(next.requests.every(({ args }) => args[0] === "testnet" && args[4][0] === "new-account"));
  next.stop(); for (const request of next.requests) request.reject(new Error("aborted")); await flush();
  assert.deepEqual(next.accepted, []);
});
