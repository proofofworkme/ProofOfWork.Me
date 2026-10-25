import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const ts = require('typescript');
function compile(file, dependencies = {}) {
  const source = readFileSync(new URL(file, import.meta.url), 'utf8');
  const output = ts.transpileModule(source, { compilerOptions: {
    module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022,
  } }).outputText;
  const module = { exports: {} };
  new Function('require', 'exports', 'module', output)((id) => {
    if (!(id in dependencies)) throw new Error(`Unexpected dependency ${id}`);
    return dependencies[id];
  }, module.exports, module);
  return module.exports;
}
const projection = compile('../../shared/api/surfaceReadState.ts');
let lastRequest;
let response;
const api = compile('./marketplaceBrowse.ts', {
  react: {},
  '../../shared/api/proofApiClient': { fetchProofApiJson: async (...args) => { lastRequest = args; return response; } },
  '../../shared/api/surfaceReadState': projection,
  '../../shared/api/useVisibleReadLoop': {},
});
const hash = (digit) => digit.repeat(64);
const asset = hash('a');
const id = hash('b');
const version = hash('c');
const blockHash = hash('d');
const query = { asset, status: 'all', sort: 'arb-desc', q: '' };
function fixture() {
  return {
    contract: 'proof-amo-browse-v1', network: 'livenet', displayOnly: true,
    version, observedAt: '2026-10-25T14:00:00Z', checkpoint: { height: 100, blockHash },
    state: 'last-verified', refreshing: false,
    source: { membershipSha256: hash('e'), fullSourceSha256: hash('f') },
    provenance: { displayOnly: true, authoritative: false, completeAtObservation: true, signingRequiresFreshPreflight: true },
    book: {
      items: [{ network: 'livenet', confirmed: true, listingId: id, tokenId: asset,
        amountSubatoms: '123456789012345678901234567890',
        displayEvidence: { model: 'proof-token-listing-display-v2', fullRecordSha256: hash('1'), omittedFields: ['payload'],
          fullDetailPath: `/api/v1/token-history?kind=listings&projection=full&q=${id}&listingId=${id}` } }],
      totalCount: 26, counts: { all: 26, sealed: 20, unsealed: 6 },
      assetCounts: { [asset]: { all: 26, sealed: 20, unsealed: 6 } },
      hasMore: true, nextCursor: 'opaque-next', limit: 1, start: 0, end: 1,
      asset, status: 'all', sort: 'arb-desc', query: '',
    },
  };
}
const expected = { query, checkpoint: { height: 100, blockHash }, start: 0, limit: 1 };

test('a current page remains display-only and preserves exact amounts and full-server counts', () => {
  const value = fixture();
  assert.equal(api.assertMarketplaceBrowseResponse(value, version, expected), value);
  assert.equal(value.book.items.length, 1);
  assert.equal(value.book.totalCount, 26);
  assert.equal(value.book.items[0].amountSubatoms, '123456789012345678901234567890');
});

test('valid empty results require explicit complete snapshot evidence', () => {
  const value = fixture();
  Object.assign(value.book, { items: [], totalCount: 0, end: 0, hasMore: false, nextCursor: '' });
  assert.equal(api.assertMarketplaceBrowseResponse(value, version, expected).book.totalCount, 0);
  value.provenance.completeAtObservation = false;
  assert.throws(() => api.assertMarketplaceBrowseResponse(value, version, expected));
});

test('rejects mismatched version, checkpoint, scope, query, ordering and page ranges', () => {
  const mutations = [
    (v) => { v.version = hash('0'); },
    (v) => { v.checkpoint.height += 1; },
    (v) => { v.checkpoint.blockHash = hash('0'); },
    (v) => { v.book.asset = 'credits'; },
    (v) => { v.book.status = 'sealed'; },
    (v) => { v.book.sort = 'price-asc'; },
    (v) => { v.book.query = 'different'; },
    (v) => { v.book.start = 1; v.book.end = 2; },
    (v) => { v.book.end = 0; },
    (v) => { v.book.limit = 25; },
    (v) => { v.book.hasMore = false; },
  ];
  for (const mutate of mutations) {
    const value = fixture(); mutate(value);
    assert.throws(() => api.assertMarketplaceBrowseResponse(value, version, expected));
  }
});

test('rejects truncated pages even when their end and continuation agree', () => {
  for (const change of [
    (v) => { v.book.limit = 25; },
    (v) => { v.book.items = []; v.book.end = 0; },
    (v) => { v.book.limit = 25; v.book.totalCount = 2; v.book.hasMore = true; },
    (v) => { v.book.limit = 25; v.book.end = 25; },
  ]) {
    const value = fixture(); change(value);
    assert.throws(() => api.assertMarketplaceBrowseResponse(value, version));
  }
  const lastPage = fixture();
  Object.assign(lastPage.book, { limit: 25, start: 25, end: 26, hasMore: false, nextCursor: '' });
  assert.equal(api.assertMarketplaceBrowseResponse(lastPage, version).book.items.length, 1);
});

test('rejects unqualified or malformed full-book totals without publishing a false zero', () => {
  for (const change of [
    (v) => { v.displayOnly = false; },
    (v) => { v.provenance.authoritative = true; },
    (v) => { v.book.counts.all = 0; },
    (v) => { v.book.totalCount = -1; },
    (v) => { v.book.assetCounts[asset].sealed += 1; },
    (v) => { v.observedAt = ''; },
    (v) => { v.source.fullSourceSha256 = ''; },
  ]) {
    const value = fixture(); change(value);
    assert.throws(() => api.assertMarketplaceBrowseResponse(value, version, expected));
  }
});

test('rejects wrong asset, pending records, repeated IDs and damaged full-detail evidence', () => {
  for (const change of [
    (v) => { v.book.items[0].tokenId = hash('0'); },
    (v) => { v.book.items[0].confirmed = false; },
    (v) => { v.book.items[0].displayEvidence.fullRecordSha256 = ''; },
    (v) => { v.book.items[0].displayEvidence.fullDetailPath += `&listingId=${hash('0')}`; v.book.items[0].listingId = hash('0'); },
    (v) => { v.book.items[0].displayEvidence.omittedFields.push('amountSubatoms'); },
    (v) => { v.book.items.push(v.book.items[0]); v.book.end = 2; v.book.limit = 2; },
  ]) {
    const value = fixture(); change(value);
    assert.throws(() => api.assertMarketplaceBrowseResponse(value, version));
  }
});

test('rejects a page limit above the route maximum even when its final-page size is valid', () => {
  const value = fixture();
  Object.assign(value.book, { limit: 101, totalCount: 1, hasMore: false, nextCursor: '' });
  assert.throws(() => api.assertMarketplaceBrowseResponse(value, version));
  value.book.limit = 100;
  assert.equal(api.assertMarketplaceBrowseResponse(value, version).book.items.length, 1);
});

test('query keys normalize harmless case and whitespace while preserving scope and sort', () => {
  assert.equal(api.browseQueryKey({ ...query, q: ' Hello ' }), api.browseQueryKey({ ...query, q: 'hello' }));
  assert.notEqual(api.browseQueryKey(query), api.browseQueryKey({ ...query, asset: 'credits' }));
  assert.notEqual(api.browseQueryKey(query), api.browseQueryKey({ ...query, sort: 'price-desc' }));
});

test('page transport pins the version, uses one bounded request, and forwards cancellation', async () => {
  const controller = new AbortController();
  response = fixture();
  const result = await api.fetchMarketplaceBrowse({ query, version, includeSummary: false, limit: 1, signal: controller.signal });
  const [path, network, options] = lastRequest;
  const url = new URL(path, 'https://proof.invalid');
  assert.equal(url.pathname, '/api/v1/marketplace-browse');
  assert.equal(url.searchParams.get('version'), version);
  assert.equal(url.searchParams.get('includeSummary'), '0');
  assert.equal(url.searchParams.get('limit'), '1');
  assert.equal(url.searchParams.has('fresh'), false);
  assert.equal(url.searchParams.has('refresh'), false);
  assert.equal(network, 'livenet');
  assert.equal(options.signal, controller.signal);
  assert.equal(result.book.totalCount, 26);
});
