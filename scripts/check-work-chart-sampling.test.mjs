import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
const app = fs.readFileSync(new URL('../src/App.tsx', import.meta.url), 'utf8');
const source = app.slice(app.indexOf('function WorkFloorChart('), app.indexOf('\nconst INFINITY_BOND_CHART_OPTIONS'));
const compiled = ts.transpileModule(source, { compilerOptions: { jsx: ts.JsxEmit.React, target: ts.ScriptTarget.ES2022 } }).outputText;
const chart = vm.runInNewContext(compiled + ';WorkFloorChart', {
  React: { createElement: (type, props) => ({ type, props }) }, LedgerChart: 'LedgerChart', ChartUnitControl: 'ChartUnitControl',
  chartProofDecimal: (value, q8) => q8 ? String(Number(q8) / 1e8) : String(value),
  exactDecimalText: String, formatExactDecimal: String, satsToUsd: (value, rate) => value * rate / 1e8,
  workFloorPointTimeMs: point => point.time, formatDate: value => value,
});
const points = [
  { label: 'WORK deploy', floorSats: 1, time: 1 },
  { label: 'Historical event', floorSats: 2, time: 2 },
  { label: 'Real now', floorSats: 8, floorQ8: '800000000', time: 3 },
];
const quote = { stats: { confirmedComputerActions: 32898 }, indexedAt: '2026-11-12T14:08:57.449Z', indexedThroughBlock: 975561 };
const render = (overrides = {}) => chart({ btcUsd: 70000, unit: 'proofs', onUnitChange() {}, points, quote, ...overrides }).props;
test('action total, chart samples and exact snapshot freshness are distinct', () => {
 const props = render(); assert.match(props.coverage, /32,898 confirmed actions/); assert.match(props.coverage, /3 chart samples. Sampling is capped/); assert.match(props.coverage, /975,561/); assert.match(props.coverage, /2026-11-12T14:08:57.449Z/);
});
test('historical estimate line never connects to canonical current marker', () => {
 const props = render(); assert.equal(props.series.length, 2); assert.equal(props.series[0].label, 'Historical estimate'); assert.equal(props.series[0].points.length, 2); assert.equal(props.series[1].style, 'points'); assert.equal(props.series[1].label, 'Verified current value'); assert.equal(props.series[1].points.length, 1); assert.equal(props.primarySeriesId, props.series[1].id); assert.equal(props.series[1].points[0].value, '8'); assert.equal(props.series[1].points[0].approximate, false); assert.match(props.quoteNote, /not a continuous price history/);
});
test('missing metadata remains unavailable rather than fabricated zero or fresh', () => {
 const props = render({ quote: { stats: {}, indexedAt: 'bad' } }); assert.match(props.coverage, /Confirmed action total unavailable/); assert.match(props.coverage, /Snapshot block unavailable/); assert.match(props.coverage, /Snapshot updated: unavailable/);
 assert.match(render({ quote: { stats: { confirmedComputerActions: 0 } } }).coverage, /0 confirmed actions/);
});
test('no USD quote stays unavailable, exact-only series and single sample keep ordinary behavior', () => {
 assert.equal(render({unit: 'usd', btcUsd: 0}).series.length, 0);
 const props = render({points: points.slice(-1)}); assert.equal(props.series.length, 1); assert.equal(props.primarySeriesId, 'floor');
 assert.equal(render({unit: 'usd'}).series[1].points[0].approximate, true);
});
test('bounded historical sampling incorporates newest event without increasing count', () => {
 const api = fs.readFileSync(new URL('../server/proof-api.mjs', import.meta.url), 'utf8'); const start = api.indexOf('function compactGrowthEventTimes('); const end = api.indexOf('\nfunction ', start + 10);
 const fn = vm.runInNewContext('const MAX_GROWTH_ACTUAL_CHART_EVENTS=240;' + api.slice(start, end) + ';compactGrowthEventTimes');
 const events = Array.from({length: 32895}, (_, i) => ({createdMs: i, label: `event${i}`})); const before = fn(events); const after = fn([...events, {createdMs: 32895, label: 'new event'}]);
 assert.equal(before.length, 240); assert.equal(after.length, 240); assert.equal(after.at(-1).label, 'new event'); assert.equal(after[0].label, 'event0');
});
test('shared chart primary override preserves legacy fallback', () => {
 const shared = fs.readFileSync(new URL('../src/shared/charts/LedgerChart.tsx', import.meta.url), 'utf8');
 assert.match(shared, /item.id === primarySeriesId && item.points.length\) \|\| series.find\(\(item\) => item.style === 'line'/);
});
