import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import ts from 'typescript';
const transpile = source => ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } }).outputText;
const state = await readFile('src/shared/api/proofApiReadState.ts', 'utf8');
const { ProofApiRequestError } = await import(`data:text/javascript;base64,${Buffer.from(transpile(state)).toString('base64')}`);
const source = await readFile('src/App.tsx', 'utf8');
const ast = ts.createSourceFile('App.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
function declaration(name) {
  let found;
  function visit(node) { if (ts.isFunctionDeclaration(node) && node.name?.text === name) found = node; ts.forEachChild(node, visit); }
  visit(ast); assert.ok(found, name); return transpile(found.getText(ast));
}
const names = ['fetchGlobalActivityPayload', 'fetchGlobalActivityHistoryPage', 'fetchGlobalActivityHistoryRead', 'isLogHistoryIntegrityError', 'loadActivityTarget'];
const expiry = () => new ProofApiRequestError('expired', { status: 503, code: 'CANONICAL_LOG_HISTORY_STABLE_SNAPSHOT_MISMATCH' });
const address = 'bc1qscopedfixture';
const cases = [
  { name: 'TXID', input: 'A'.repeat(64), request: 'a'.repeat(64), cache: 'a'.repeat(64) },
  { name: 'address', input: address, request: address, cache: address },
  { name: 'ID', input: 'Hamza@proofofwork.me', request: address, cache: 'hamza@proofofwork.me', isId: true },
];
function harness(scope, variant = 'success') {
  const requests = [], accepts = [], recovered = [], statuses = [], rows = [], profiles = [];
  const searchGeneration = { current: 0 };
  const head = { network: 'livenet', snapshotId: 'new', consistency: { ok: true }, activity: [] };
  const page = { network: 'livenet', snapshotId: 'new', page: 0, items: [{ txid: 'new-item' }], totalCount: 1 };
  let registryReads = 0;
  const deps = {
    ProofApiRequestError, network: 'livenet', ACTIVITY_FEED_PAGE_SIZE: 30, activityQuery: scope.input,
    activityLoadingOwnerRef: { current: undefined }, activitySearchReadControllerRef: { current: undefined },
    activityHistoryReadControllerRef: { current: undefined }, activeWorkspaceStatusKeyRef: { current: 'log' },
    activityHistoryGenerationRef: { current: 0 }, activitySearchGenerationRef: searchGeneration,
    activityHistoryPagesRef: { current: new Map() }, nextProofApiReadAttempt: () => 1,
    activityHistoryCacheKey: JSON.stringify, idRegistry: [], registryAddress: 'registry',
    resolveRecipientInput: () => ({ isId: !!scope.isId, paymentAddress: address, displayRecipient: scope.input, id: scope.isId ? 'hamza' : undefined }),
    fetchIdRegistryState: async () => { registryReads++; return { records: [], listings: [], pendingEvents: [], sales: [] }; },
    normalizePowId: value => value.split('@')[0].toLowerCase(), shortAddress: value => value,
    fetchProofApiJson: async (path, network, options) => {
      requests.push({ path, network, signal: options.signal });
      if (requests.length === 1) throw expiry();
      if (requests.length === 2) { if (variant === 'supersede-head') searchGeneration.current++; return head; }
      assert.equal(requests.length, 3, 'no retry loop');
      if (variant === 'second-expiry') throw expiry();
      if (variant === 'transient-old-cache') throw new Error('transient');
      if (variant === 'supersede-page') searchGeneration.current++;
      return variant === 'mismatched-snapshot' ? { ...page, snapshotId: 'other' } : page;
    },
    applyRecoveredActivityHead: value => recovered.push(value), setIdActivity: value => rows.push(value),
    acceptActivityHistoryPage: (key, value) => accepts.push({ key: JSON.parse(key), value }),
    setActivityProfile: value => profiles.push(value), setStatusForWorkspace: (_key, value) => statuses.push(value),
    isTransientProofApiReadError: () => variant === 'transient-old-cache', errorMessage: error => error.message,
  };
  for (const name of ['setActivityHistoryReadError','setActivityHistoryReading','setActivityLoading','setActivityQuery','setActivityMail','setIdRegistry','setIdListings','setIdPendingEvents','setIdSales','clearLastGoodReadWarning','setActivityHistoryPage','showLastGoodReadWarning']) deps[name] = () => {};
  if(variant === 'transient-old-cache') {
    deps.activityHistoryPagesRef.current.set(JSON.stringify({kind:'search',pageIndex:0,pageSize:30,query:scope.cache,snapshotId:'old'}), {snapshotId:'old',page:0,items:[{txid:'old'}]});
    deps.showLastGoodReadWarning = () => true;
  }
  const run = new Function(...Object.keys(deps), names.map(declaration).join('\n') + '; return loadActivityTarget;')(...Object.values(deps));
  return { run, requests, accepts, recovered, statuses, rows, profiles, head, page, registryReads: () => registryReads };
}
for (const scope of cases) {
  test(`${scope.name} actual scoped caller recovers once and replaces exact snapshot`, async () => {
    const h = harness(scope); await h.run(scope.input, undefined, { snapshotId: 'old' });
    assert.equal(h.requests.length, 3);
    assert.equal(h.requests[1].path, '/api/v1/log-summary');
    const old = new URL(h.requests[0].path, 'https://fixture.invalid'), next = new URL(h.requests[2].path, 'https://fixture.invalid');
    assert.equal(old.searchParams.get('q'), scope.request); assert.equal(next.searchParams.get('q'), scope.request);
    assert.equal(next.searchParams.get('snapshot'), 'new'); assert.equal(next.searchParams.get('page'), '0');
    assert.ok(h.requests.every(row => row.network === 'livenet' && row.signal === h.requests[0].signal));
    assert.deepEqual(h.recovered, [h.head]); assert.deepEqual(h.rows, [h.page.items]);
    assert.equal(h.accepts.length, 1); assert.equal(h.accepts[0].key.snapshotId, 'new');
    assert.equal(h.accepts[0].key.query, scope.cache); assert.equal(h.accepts[0].key.kind, 'search');
    assert.equal(h.registryReads(), scope.isId ? 1 : 0);
    assert.equal(h.statuses.at(-1).tone, 'good');
  });
  for (const variant of ['supersede-head', 'supersede-page', 'second-expiry', 'mismatched-snapshot', 'transient-old-cache']) {
    test(`${scope.name} actual scoped caller rejects ${variant} without accepting replacement`, async () => {
      const h = harness(scope, variant); await h.run(scope.input, undefined, { snapshotId: 'old' });
      assert.equal(h.requests.length, variant === 'supersede-head' ? 2 : 3);
      assert.deepEqual(h.accepts, []); assert.deepEqual(h.recovered, []); assert.deepEqual(h.rows, []);
      assert.equal(h.statuses.some(row => row.tone === 'good'), false);
      if (!variant.startsWith('supersede')) assert.equal(h.statuses.at(-1).tone, 'bad');
    });
  }
}
