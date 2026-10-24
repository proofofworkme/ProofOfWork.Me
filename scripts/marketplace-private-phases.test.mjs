import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import { measurePrivatePhase, withPrivatePhaseTimings } from '../server/wallet-read-observation.mjs';

const source = readFileSync(new URL('../server/proof-api.mjs', import.meta.url), 'utf8');
const overlayStart = source.indexOf('async function marketplaceSummaryPayloadWithIndexedMarketOverlay(');
const overlayEnd = source.indexOf('\nfunction marketplaceSummaryHasIndexedMarketOverlay(', overlayStart);
function overlayFixture(failure) {
  const calls = [], receipts = [], error = new Error('fixture authority refusal');
  const token = { secretFixtureMarker: 'never-log-payload' };
  const context = {
    measureMarketplaceReadPhase: measurePrivatePhase,
    canonicalWorkMarketV2TokenSummary: value => value,
    payloadSnapshotId: value => value.snapshotId,
    indexedTokenMarketSummaryOverlay: async () => { calls.push('overlay'); if (failure === 'overlay') throw error; return { indexedAt: 'new' }; },
    tokenSummaryListingIdsMissingFromMarketLifecycle: () => [],
    tokenStateWithIndexedMarketSummaryOverlay: value => { calls.push('merge'); return value; },
    tokenPayloadWithSpendableActiveListings: async value => { calls.push('core'); if (failure === 'core') throw error; return value; },
    tokenPayloadWithCurrentWorkActiveListingPolicy: value => { calls.push('policy'); return value; },
    tokenStateWithCanonicalWorkListingBookForMarketplaceSummary: async value => { calls.push('work-book'); if (failure === 'work-book') throw error; return value; },
    compactTokenSummaryPayload: value => { calls.push('compact'); return value; },
    workFloorWithIndexedMarketSummaryOverlay: value => value,
    newerIso: (_, next) => next,
    marketplaceSummaryWithCurrentBtcUsd: async value => { calls.push('price'); return value; },
    summaryWithDerivedSnapshot: value => ({ ...value, derived: true }),
  };
  const run = vm.runInNewContext(source.slice(overlayStart, overlayEnd) + '\nmarketplaceSummaryPayloadWithIndexedMarketOverlay', context);
  return { calls, receipts, error, token, run: () => withPrivatePhaseTimings(
    () => run({ token, snapshotId: 'source', indexedAt: 'old' }, 'livenet', { fast: true }), receipt => receipts.push(receipt),
  ) };
}
test('private overlay phases preserve operation order, output and payload privacy', async () => {
  const fixture = overlayFixture();
  const result = await fixture.run();
  assert.equal(result.token, fixture.token);
  assert.equal(result.indexedAt, 'new');
  assert.equal(result.derived, true);
  assert.deepEqual(fixture.calls, ['overlay', 'merge', 'core', 'policy', 'work-book', 'compact', 'price']);
  assert.equal(fixture.receipts.length, 1);
  assert.deepEqual(Object.keys(fixture.receipts[0].phases), ['ledger-source-market-overlay', 'closing-core', 'confirmed-summary']);
  assert.doesNotMatch(JSON.stringify(fixture.receipts), /never-log-payload|secretFixtureMarker/u);
});
for (const [failure, expected] of [
  ['overlay', ['overlay']], ['core', ['overlay', 'merge', 'core']],
  ['work-book', ['overlay', 'merge', 'core', 'policy', 'work-book']],
]) test(`private ${failure} timing preserves exact rejection and stops subsequent work`, async () => {
  const fixture = overlayFixture(failure);
  await assert.rejects(fixture.run(), error => error === fixture.error);
  assert.deepEqual(fixture.calls, expected);
  assert.equal(fixture.receipts.length, 1);
});

test('marketplace route still awaits the independent authority gate before publishing', async () => {
  const start = source.indexOf('      const marketplaceSummaryResponsePayload =');
  const end = source.indexOf('\n      if (!freshRead)', start);
  const calls = [], receipts = [];
  let completeGate;
  const gate = new Promise(resolve => { completeGate = resolve; });
  const payload = { snapshotId: 'source', privateFixture: 'never-log-payload' };
  const context = {
    withMarketplaceReadPhases: run => withPrivatePhaseTimings(run, receipt => receipts.push(receipt)),
    measureMarketplaceReadPhase: measurePrivatePhase,
    network: 'livenet', freshRead: true, compactRead: false,
    deduplicatedSummaryRead: async (key, run) => { assert.equal(key, 'marketplace-summary:livenet:fresh'); return run(); },
    marketplaceSummaryPayload: async () => { calls.push('assembly'); return payload; },
    summaryPayloadWithCanonicalProvenance: async (value, network, fresh, surface) => {
      assert.equal(value, payload); assert.equal(network, 'livenet'); assert.equal(fresh, true);
      assert.equal(surface, 'marketplace-summary'); calls.push('gate'); await gate; return value;
    },
    withWorkMarketplaceV4Metadata: value => { calls.push('publish'); return value; },
  };
  const run = vm.runInNewContext(source.slice(start, end) + '\nmarketplaceSummaryResponsePayload', context);
  const pending = run();
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(calls, ['assembly', 'gate']);
  assert.equal(receipts.length, 0);
  completeGate();
  assert.equal(await pending, payload);
  assert.deepEqual(calls, ['assembly', 'gate', 'publish']);
  assert.deepEqual(Object.keys(receipts[0].phases), ['snapshot-assembly', 'confirmed-barrier']);
  assert.doesNotMatch(JSON.stringify(receipts), /never-log-payload|privateFixture/u);
});
