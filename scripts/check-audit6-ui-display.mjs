import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import ts from "typescript";
const source = await readFile("src/App.tsx", "utf8");
const ast = ts.createSourceFile("App.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const fns = new Map();
function collect(node) { if (ts.isFunctionDeclaration(node) && node.name) fns.set(node.name.text, node); ts.forEachChild(node, collect); }
collect(ast);
const transpile = (text) => ts.transpileModule(text, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext, jsx: ts.JsxEmit.React } }).outputText;
const load = async (path) => import(`data:text/javascript;base64,${Buffer.from(transpile(await readFile(path, "utf8"))).toString("base64")}`);
const exact = await load("src/exactAmount.ts");
const { tokenSatsPerUnit } = await load("src/functions/formatting/tokenSatsPerUnit.ts");
const compile = (names, env) => new Function(...Object.keys(env), `${transpile(names.map((name) => fns.get(name).getText(ast)).join("\n"))};return {${names.join(",")}}`)(...Object.values(env));
const React = { createElement: (tag, props, ...children) => ({ tag, props: props ?? {}, children: children.flat(Infinity) }) };
const descendants = (node) => node && typeof node === "object" ? [node, ...(node.children ?? []).flatMap(descendants)] : [];
const coverage = [];

for (const name of ["BrowserApp", "BrowserWorkspace"]) {
  let loadDeclaration, selection;
  function visit(node) {
    if (ts.isVariableDeclaration(node) && node.name.getText(ast) === "loadPage") loadDeclaration = node;
    if (ts.isJsxSelfClosingElement(node) && node.tagName.getText(ast) === "BrowserNetworkTabs") {
      const attr = node.attributes.properties.find((a) => ts.isJsxAttribute(a) && a.name.getText(ast) === "onChange");
      selection = attr.initializer.expression;
    }
    ts.forEachChild(node, visit);
  }
  visit(fns.get(name)); assert.ok(loadDeclaration && selection);
  let resolve, selectedNetwork = "livenet", loadedPage, loading, status;
  const env = { query: "a".repeat(64), network: "livenet", loadGenerationRef: { current: 0 }, useCallback: (fn) => fn,
    fetchBrowserPage: () => new Promise((done) => resolve = done), setLoading: (value) => loading = value, setPage: (value) => loadedPage = value,
    setStatus: (value) => status = value, setQuery() {}, setNetwork: (value) => selectedNetwork = value, syncBrowserRoute() {}, errorMessage: (error) => error.message,
  };
  const { loadPage, select } = new Function(...Object.keys(env), `${transpile(`const ${loadDeclaration.getText(ast)};const select = ${selection.getText(ast)};`)};return {loadPage,select}`)(...Object.values(env));
  const pending = loadPage(); assert.equal(loading, true); select("testnet4"); resolve({ confirmed: true, network: "livenet" }); await pending;
  assert.equal(selectedNetwork, "testnet4"); assert.equal(loadedPage, undefined); assert.equal(loading, false); assert.equal(status.tone, "idle");
}
coverage.push("Standalone and embedded Browser network changes invalidate old page completion");

{
  const env = { ...exact, React, tokenSatsPerUnit, POWB_TOKEN_TICKER: "POWB", shortAddress: (value) => value };
  const names = ["growthCompactNumber", "bondDecimalNumber", "infinityBondPointTimeMs", "infinityBondTimeLabel", "infinityBondChartNumericValue", "bondDecimalQ8", "infinityBondPointQ8", "infinityBondPointPriceLabel", "infinityBondAxisLabel", "compactExactBondSupply", "exactBondChartRatio", "exactBondChartPadding", "exactBondChartFallbackRange", "infinityBondSupplyAxisLabel", "infinityBondMetricTitle", "InfinityBondChart"];
  const { InfinityBondChart } = compile(names, env);
  for (const metric of ["floor", "supply", "value"]) {
    const chart = InfinityBondChart({ bondConfig: { ticker: "INCB", displayName: "Inception Bond" }, metric, points: [
      { txid: "a".repeat(64), createdAt: "2026-09-08T00:00:00Z", bondActions: 1, confirmedSupply: "224847713398447926", floorQ8: "100000779", floorSats: "1.00000779", networkValueQ8: "22484771339844794793582060", networkValueSats: "224847713398447947.9358206" },
      { txid: "b".repeat(64), createdAt: "2026-09-08T00:01:00Z", bondActions: 2, confirmedSupply: "224847713398447927", floorQ8: "100000780", floorSats: "1.0000078", networkValueQ8: "22484771339844794893582060", networkValueSats: "224847713398447948.9358206" },
    ] });
    const labels = descendants(chart).filter((node) => node.tag === "g" && String(node.props.key).startsWith("infinity-y-")).flatMap((group) => group.children.filter((node) => node.tag === "text"));
    assert.ok(labels.length >= 2);
    for (const label of labels) assert.ok(Number(label.props.x) - String(label.children.join("")).length * 8 >= 0, `${metric}: ${label.children.join("")} escapes SVG gutter`);
    assert.match(chart.props["aria-label"], /Confirmed Inception Bond/);
  }
}
coverage.push("Bond floor and very large supply/backing labels fit reserved SVG gutter");

{
  const env = { ...exact };
  const { bondProofAmountDisplay, workFloorQuoteLiveValue, workFloorQuoteLiveValueQ8 } = compile(["bondProofAmountDisplay", "finiteNonNegativeNumber", "highestExactWorkQ8", "workFloorQuoteLiveValue", "workFloorQuoteLiveValueQ8"], env);
  const value = { networkValueSats: 8387576239634479000, networkValueQ8: "838757623963447883106635908" };
  assert.equal(bondProofAmountDisplay(workFloorQuoteLiveValue(value), workFloorQuoteLiveValueQ8(value)), "8,387,576,239,634,478,831.06635908");
}
coverage.push("AMO network value status formatter retains every Q8 digit");

{
  let formats = 0;
  const { tokenConfirmedBalanceNote } = compile(["tokenConfirmedBalanceNote"], { POWB_TOKEN_ID: "POWB", INCB_TOKEN_ID: "INCB", isWorkToken: (token) => token.tokenId === "WORK", tokenAmountDisplay: (_, balance) => { formats++; return String(balance); } });
  for (const [tokenId, lane] of [["AUD", "all"], ["WORK", "work"], ["POWB", "powb"], ["INCB", "incb"]]) {
    const token = { tokenId, ticker: tokenId };
    assert.match(tokenConfirmedBalanceNote("", token, 0, undefined, undefined), /Connect your wallet/);
    assert.match(tokenConfirmedBalanceNote("A", token, 0, undefined, undefined), /Verifying/);
    assert.match(tokenConfirmedBalanceNote("A", token, 0, undefined, { [lane]: { loaded: true, loading: false, error: "offline" } }), /unavailable/);
    assert.match(tokenConfirmedBalanceNote("A", token, 0, undefined, { [lane]: { loaded: true, loading: true, error: "" } }), /Verifying/);
    assert.equal(formats, 0);
  }
  assert.equal(tokenConfirmedBalanceNote("A", { tokenId: "AUD", ticker: "AUD" }, 0, undefined, { all: { loaded: true, loading: false, error: "" } }), "Your confirmed balance is 0 AUD.");
  assert.equal(formats, 1);
}
coverage.push("Credit/WORK/bond balance notes distinguish disconnected, pending read, unavailable, and verified zero");


{
  const { ActivityFeed } = compile(["activityKey", "activityKindDisplay", "ActivityFeed"], { React, Clock: () => null, ArrowUpRight: () => null, formatDate: (value) => value, shortAddress: (value) => value, explorerTxUrl: () => "/tx", proofApiUrl: (path) => path });
  const row = { kind: "boost-transfer", network: "livenet", txid: "a".repeat(64), createdAt: "2026-09-08T00:00:00Z", tags: ["Valid", "Confirmed"], validationScope: "wire-shape-only", stateTransitionVerified: false, authorityEndpoint: "/api/v1/boost" };
  const tree = ActivityFeed({ items: [row], totalCount: 1 }); const text = JSON.stringify(tree);
  assert.match(text, /Wire format check only/); assert.match(text, /have not been evaluated/); assert.match(text, /Wire format valid/);
  assert.equal(descendants(tree).filter((node) => node.tag === "a" && node.props.href === "/api/v1/boost").length, 1);
  const verified = JSON.stringify(ActivityFeed({ items: [{ ...row, validationScope: "canonical-state-transition", stateTransitionVerified: true }], totalCount: 1 }));
  assert.doesNotMatch(verified, /have not been evaluated/);
  const invalid = JSON.stringify(ActivityFeed({ items: [{ ...row, tags: ["Invalid", "Confirmed"] }], totalCount: 1 }));
  assert.match(invalid, /Invalid/); assert.doesNotMatch(invalid, /Wire format valid|Wire format verified/);
}
coverage.push("Raw Boost Log wire validation is distinct from verified state transition");

{
  const env = { ...exact, React, tokenSatsPerUnit, tokenUsd: (value) => `$${value.toFixed(2)}`, satsToUsd: (value, quote) => value * quote / 100_000_000, GROWTH_MODEL_START_MS: Date.parse("2026-05-01T00:00:00Z"), MS_PER_MODEL_YEAR: 365.25 * 86400000, WORK_FLOOR_LOG_SCALE_RATIO: 100 };
  const names = ["workFloorChartExtrema", "workFloorPriceLabel", "compactWorkFloorChartPoints", "workFloorChartValue", "workFloorPointTimeMs", "workFloorTimeLabel", "workFloorChartScale", "workFloorChartAxisPriceLabel", "workFloorAxisPriceLabel", "growthCompactNumber", "WorkFloorChart"];
  const { workFloorChartExtrema, workFloorPriceLabel, compactWorkFloorChartPoints, WorkFloorChart } = compile(names, env);
  const lower = { label: "lower", years: 0, floorQ8: "39940839236354661099", floorSats: 399408392363.54663 };
  const higher = { label: "higher", years: 1, floorQ8: "39940839236354661100", floorSats: 399408392363.54663 };
  const historical = { label: "historical", years: -1, floorSats: 1.25 };
  const extrema = workFloorChartExtrema([higher, lower]);
  assert.equal(extrema.minimum, lower); assert.equal(extrema.maximum, higher);
  assert.equal(workFloorPriceLabel(higher, 50_000, "sats"), "399,408,392,363.546611 proofs / WORK");
  assert.match(workFloorPriceLabel(historical, 50_000, "sats"), /≈ .*approximate historical value/);
  assert.match(workFloorPriceLabel(higher, 50_000, "usd"), /^≈ /);
  assert.equal(compactWorkFloorChartPoints([lower, { ...higher, years: lower.years }]).length, 2, "sub-float Q8 difference must survive chart compaction");
  const tree = WorkFloorChart({ btcUsd: 50_000, points: [historical, lower, higher], unit: "sats" });
  const titles = descendants(tree).filter((node) => node.tag === "title").map((node) => node.children.join(""));
  assert.ok(titles.some((title) => title.includes("399,408,392,363.546611 proofs")));
  assert.ok(titles.some((title) => title.includes("approximate historical value")));
  assert.ok(!titles.some((title) => title.includes("399,408,392,363.54663")), "float geometry must not leak into exact monetary label");
}
coverage.push("WORK chart extrema and point labels retain Q8 digits below floating-point resolution; historical-only and USD labels qualify approximation");

{
  const env = { ...exact, tokenSatsPerUnit };
  const { infinityBondPriceExtrema, infinityBondPointPriceLabel } = compile(["bondDecimalNumber", "bondDecimalQ8", "infinityBondPointQ8", "infinityBondChartNumericValue", "infinityBondPriceExtrema", "infinityBondPointPriceLabel", "infinityBondAxisLabel", "growthCompactNumber"], env);
  for (const metric of ["floor", "value"]) {
    const key = metric === "floor" ? "floorQ8" : "networkValueQ8", numeric = metric === "floor" ? "floorSats" : "networkValueSats";
    const low = { [key]: "39940839236354661099", [numeric]: 399408392363.54663 }, high = { [key]: "39940839236354661100", [numeric]: 399408392363.54663 };
    const extrema = infinityBondPriceExtrema([high, low], metric);
    assert.equal(extrema.minimum, low); assert.equal(extrema.maximum, high);
    assert.equal(infinityBondPointPriceLabel(high, metric), "399,408,392,363.546611 proofs");
    assert.match(infinityBondPointPriceLabel({ [numeric]: 1.25 }, metric), /approximate historical value/);
  }
}
coverage.push("Bond Floor/Backing extrema and point labels retain Q8 differences without formatting float geometry as exact history");

{
  const env = { React, useState: (value) => [value, () => {}], pagedItems: (items) => ({ items }), DATA_PAGE_SIZE: 25 };
  const { registryEmptyState, IdRecordList } = compile(["registryEmptyState", "IdRecordList"], env);
  for (const scope of ["owned", "registry", "pending"]) {
    for (const state of [{ loaded: false, loading: true, error: "" }, { loaded: false, loading: false, error: "offline" }, { loaded: true, loading: true, error: "" }, { loaded: true, loading: false, error: "offline" }]) {
      const message = registryEmptyState(state, "A", scope);
      const tree = IdRecordList({ records: [], empty: message });
      assert.doesNotMatch(JSON.stringify(tree), /No IDs for this wallet|No registry records found|No in-flight ID transfers/);
    }
  }
  assert.match(registryEmptyState({ loaded: true, loading: false, error: "" }, "", "owned"), /Connect a wallet/);
  assert.match(registryEmptyState({ loaded: true, loading: false, error: "" }, "", "pending"), /Connect a wallet/);
  assert.equal(registryEmptyState({ loaded: true, loading: false, error: "" }, "A", "owned"), "No IDs for this wallet yet.");
  assert.equal(registryEmptyState({ loaded: true, loading: false, error: "" }, "A", "registry"), "No registry records found yet.");
}
coverage.push("ID empty-state rendering requires a settled verified registry and owned/pending emptiness requires a connected account");

console.log(JSON.stringify({ ok: true, coverage }, null, 2));
