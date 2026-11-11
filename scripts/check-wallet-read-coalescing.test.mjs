import { AsyncLocalStorage } from "node:async_hooks";
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync, realpathSync, statSync } from 'node:fs';
import { userInfo } from 'node:os';
import { createHash } from 'node:crypto';
import vm from 'node:vm';
import ts from 'typescript';
import pg from 'pg';
import { createWalletReadCoalescer, walletReadIdentity, measurePrivatePhase, withPrivatePhaseTimings, privateReadContext } from '../server/wallet-read-observation.mjs';
import { withReadOnlySnapshot, isReadOnlySnapshotBudgetError } from '../server/db/read-only-snapshot.mjs';

function source(path, name) {
  const ast = ts.createSourceFile(path, readFileSync(path, 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
  const nodes = ast.statements.filter(n => ts.isFunctionDeclaration(n) && n.name?.text === name);
  assert.equal(nodes.length, 1, name);
  return nodes[0].getText(ast).replace(/^export\s+/u, '');
}
const walletSource = source('server/proof-api.mjs', 'proofIndexWalletScopedTokenPayloadForRead');
const queueSource = source('server/db/proof-index-reader.mjs', 'workPrecisionV2MigrationFullAuditWithBound');
const queueFactory = new vm.Script(`${source('server/db/proof-index-reader.mjs', 'createAbortableReadinessAuditQueue')}\ncreateAbortableReadinessAuditQueue`).runInNewContext({ WalletRequestAsyncLocalStorage: AsyncLocalStorage });
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const key = (scope = 'work', addresses = ['account'], options = {}) => walletReadIdentity('livenet', scope, addresses, options);

test('the accepted full-audit body and all its SQL argument lists remain byte-identical', () => {
  const full = source('server/db/proof-index-reader.mjs', 'proofIndexWorkPrecisionV2MigrationReadinessFullAudit');
  // Exact canonical and captured November 11 live bodies, neither changed here.
  assert.ok(new Set(['0e0626ec16d1e522fe720ac9fcbc17b716552d59292dd9bce5da81af72cfa2e5','6612cee6ea94622ec2a5cb374c16e2cd4dab4c998e8a4b95e22c7123751a8600']).has(createHash('sha256').update(full).digest('hex')));
});

function entry({ snapshot = async load => load(), preflight = async () => true, overlay, share = true, clock = () => Date.now(), mempool, gate, membership, observer = () => {} } = {}) {
  const counts = { preflights: 0, snapshots: 0, audits: 0, mempool: 0, membership: 0, core: 0, budgets: [] };
  const receipts = [];
  const payload = () => ({ tokens: [{ tokenId: 'work', amountStorageModel: 'q16' }],
    indexedThroughBlock: 1, indexedThroughBlockHash: 'a'.repeat(64), nested: { amount: '10' } });
  const context = vm.createContext({
    walletReadinessPreflightScope: { getStore: () => null },
    walletReadSnapshot: { getStore: () => null },
    proofIndexPrepareWalletReadiness: async () => { counts.preflights++; return preflight(); },
    proofIndexWalletReadinessUnavailableError: () => Object.assign(new Error("Fresh wallet credit state is temporarily unavailable."), { statusCode: 503 }),
    console: { warn() {}, error() {} }, Date: class extends Date { static now() { return clock(); } },
    coalesceWalletRead: share ? createWalletReadCoalescer() : async (_identity, load) => load(), walletReadIdentity,
    measurePrivatePhase, withPrivatePhaseTimings: run => withPrivatePhaseTimings(run, observer),
    workPrecisionV2MigrationFullAuditQueue: queueFactory(),
    normalizeTokenScope: value => String(value).trim().toLowerCase(), isWorkTokenId: id => id === 'work',
    proofIndexReadFeatureEnabled: () => true, WORK_SUBATOM_PROJECTION_MODEL: 'q16', WALLET_SCOPED_INDEX_WAIT_MS: 15000,
    proofIndexWithWalletReadSnapshot: async (load, options) => { counts.snapshots++; counts.budgets.push(options.timeoutMs); return snapshot(load); },
    isReadOnlySnapshotBudgetError, privateReadContext,
    proofIndexWalletReadSnapshotPendingProof: () => ({ tipHeight: 1, tipHash: 'a'.repeat(64), pendingValidThrough: new Date(clock() + 60000).toISOString(), membershipSnapshot: {} }),
    bitcoinRpc: async () => { counts.mempool++; return mempool ? mempool(counts.mempool) : { ok: true, result: [] }; },
    workQ16PendingMembershipSnapshotReady: () => { counts.membership++; return membership ? membership(counts.membership) : true; },
    proofIndexWalletTokenOverlayPayload: async () => context.workPrecisionV2MigrationFullAuditWithBound({
      inFlight: new Map(), requestKey: 'local-proof', load: async () => { counts.audits++; await pause(15); return overlay ? overlay() : payload(); } }),
    walletTokenOverlayHasExactCheckpoint: () => true,
    canonicalPublicReadGate: async () => { counts.core++; return gate ? gate(counts.core) : {}; },
    walletTokenOverlayMatchesCanonicalFreshGate: (_payload, result) => result !== null,
    walletOverlayWithCanonicalWorkSupply: async p => p, walletScopedTokenPayloadFromOverlay: p => p,
    walletTokenPayloadMissingDefinitions: () => [], walletPayloadWithCanonicalWorkCapacities: async p => p,
    errorSummary: () => 'private-existing-error',
  });
  const functions = new vm.Script(`${queueSource}\n${walletSource}\n({workPrecisionV2MigrationFullAuditWithBound,proofIndexWalletScopedTokenPayloadForRead})`).runInContext(context);
  context.workPrecisionV2MigrationFullAuditWithBound = functions.workPrecisionV2MigrationFullAuditWithBound;
  return { counts, receipts, call: async (scope = 'work', addresses = ['account'], options = { requireCurrent: true }, network = 'livenet') => {
    const result = await functions.proofIndexWalletScopedTokenPayloadForRead(network, scope, addresses, 'local-test', options);
    receipts.push(result); return result;
  } };
}

test('actual wallet entry shares one owned receipt and full audit but independently closes every caller', async () => {
  const r = entry();
  const values = await Promise.all([r.call(), r.call(), r.call()]);
  assert.ok(values.every(Boolean)); assert.equal(r.counts.snapshots, 1); assert.equal(r.counts.audits, 1);
  assert.equal(r.counts.core, 4); // One assembly gate plus three closing gates.
  assert.equal(r.counts.mempool, 3); assert.equal(r.counts.membership, 3);
  assert.equal(r.counts.budgets.length,1); assert.ok(r.counts.budgets[0] > 14900 && r.counts.budgets[0] <= 15000);
  values[0].nested.amount = 'mutated'; assert.equal(values[1].nested.amount, '10');
  await r.call(); assert.equal(r.counts.snapshots, 2); assert.equal(r.counts.audits, 2);
});

test('negative control detects duplicate full audits when receipt sharing is disabled', async () => {
  const r = entry({ share: false }); await Promise.all([r.call(), r.call()]);
  assert.equal(r.counts.snapshots, 2); assert.equal(r.counts.audits, 2);
  assert.throws(() => assert.equal(r.counts.audits, 1));
});

test('a caller whose Core or mempool changes cannot borrow another caller authority', async () => {
  for (const overrides of [
    { gate: n => n === 3 ? null : {} },
    { mempool: n => ({ ok: n !== 2, result: [] }) },
    { membership: n => n !== 2 },
  ]) {
    const r = entry(overrides); const values = await Promise.all([r.call(), r.call()]);
    assert.ok(values[0]); assert.equal(values[1], null); assert.equal(r.counts.audits, 1);
  }
});

test('late join cannot extend witness expiry and a failed caller cannot cancel another', async () => {
  let now = Date.now(); const r = entry({ clock: () => now, mempool: async n => { if (n === 2) { await pause(5); now += 60001; } return { ok: true, result: [] }; } });
  const values = await Promise.all([r.call(), r.call()]); assert.ok(values[0]); assert.equal(values[1], null);
  const c = createWalletReadCoalescer(); let resolve;
  const work = () => new Promise(r => { resolve = r; });
  let abort;
  const abandoned = Promise.race([c(key(), work), new Promise((_resolve,reject) => { abort=reject; })]);
  const disconnected = assert.rejects(abandoned, /disconnected/);
  const surviving = c(key(), work); await pause(0); abort(Error('caller disconnected')); await disconnected;
  resolve({ ok: true }); assert.deepEqual(await surviving, { ok: true });
});

test('scope, ordered addresses and every policy separate flights; non-WORK/networks retain original paths', async () => {
  const r = entry();
  await Promise.all([
    r.call('work', ['a','b']), r.call('work', ['b','a']),
    r.call('work', ['a','b'], { requireCurrent: true, allowLastGood: true }),
    r.call('work', ['a','b'], { requireCurrent: false }),
    r.call('all', ['a','b']),
  ]);
  assert.equal(r.counts.snapshots, 5); assert.equal(r.counts.audits, 5);
  const nonWork = entry(); await Promise.all([nonWork.call('powb'), nonWork.call('powb')]);
  assert.equal(nonWork.counts.snapshots, 0); assert.equal(nonWork.counts.audits, 2);
  assert.equal(await nonWork.call('work', ['a'], {}, 'testnet'), null);
  assert.equal(key('work', ['a'], { x: 1, y: true }), key('work', ['a'], { y: true, x: 1 }));
  assert.notEqual(key('work', ['a'], { force: true }), key('work', ['a'], { force: false }));
});

test('invalid identities and unsupported policy forms never share', async () => {
  const cyclic = {}; cyclic.self = cyclic;
  const accessor = { get requireCurrent() { throw Error('must not evaluate'); } };
  for (const identity of [walletReadIdentity('testnet','work',['a'],{}), key('work',[]), key('work',[' a']), key('work',['']),
    key('work',['a'],{ unknown: undefined }), key('work',['a'],cyclic), key('work',['a'],accessor), key('work',['a'],{ secret: () => {} }),
    key('work',['a'],{ negativeZero: -0 }), key('work',['a'],{ sparse: Array(1) })]) {
    assert.equal(identity, null); let reads = 0; const c = createWalletReadCoalescer();
    await Promise.all([c(identity, async () => ++reads), c(identity, async () => ++reads)]); assert.equal(reads, 2);
  }
  assert.equal(key('work',['a'],null),null);
  for (const identity of ['invalid', {}, 1]) {
    let reads=0; const c=createWalletReadCoalescer();
    await Promise.all([c(identity,async()=>++reads),c(identity,async()=>++reads)]); assert.equal(reads,2);
  }
});

test('four distinct bookkeeping slots saturate into original unshared work and recover', async () => {
  const c = createWalletReadCoalescer(); const releases = []; let reads = 0;
  const load = () => { reads++; return new Promise(r => releases.push(r)); };
  const jobs = ['a','b','c','d','e','e'].map(a => c(key('work',[a]),load));
  await pause(0); assert.equal(reads, 6);
  const join = c(key('work',['a']),load); assert.equal(reads, 6);
  releases.forEach(r => r({ ok: true })); await Promise.all([...jobs,join]);
  await c(key('work',['e']),async () => ++reads); assert.equal(reads, 7);
});

test('nulls, rejections and actual snapshot deadlines clear all flight state for a fresh retry', async () => {
  for (const fail of [async () => null, async () => { throw Error('scheduled'); }]) {
    const c = createWalletReadCoalescer(); let count = 0;
    const load = async () => { count++; await pause(5); return fail(); };
    await Promise.allSettled([c(key(),load),c(key(),load)]); assert.equal(count,1);
    assert.deepEqual(await c(key(),async () => ({ fresh: true })),{ fresh: true });
  }
  let calls = 0; const pool = { async connect() { calls++; return { async query() { return { rows: [] }; }, release() {} }; } };
  const c = createWalletReadCoalescer(); const load = () => withReadOnlySnapshot(pool, async () => { await pause(40); return { late: true }; }, { timeoutMs: 15 });
  const first = c(key(),load); await pause(7); const joined = c(key(),load);
  const results = await Promise.allSettled([first,joined]); assert.equal(calls,1);
  assert.ok(results.every(r => r.status === 'rejected' && isReadOnlySnapshotBudgetError(r.reason)));
  assert.deepEqual(await c(key(),async () => ({ fresh: true })),{ fresh: true });
  const r = entry({ snapshot: () => load() }); assert.equal(await r.call(),null);
});

test('private fixed-name clocks bound aggregates, reject sensitive names and tolerate observers', async () => {
  const output = [];
  const result = await withPrivatePhaseTimings(async () => {
    await measurePrivatePhase('full-audit-queue-wait', () => pause(12));
    await measurePrivatePhase('snapshot-sql-wait', () => pause(8));
    await measurePrivatePhase('full-audit-execution', async () => { const end = performance.now()+5; while(performance.now()<end) {} });
    await measurePrivatePhase('SELECT private_address txid balance secret', async () => 'private');
    return 'unchanged';
  }, x => output.push(x));
  assert.equal(result,'unchanged'); assert.equal(output.length,1);
  for (const name of ['full-audit-queue-wait','snapshot-sql-wait','full-audit-execution']) assert.ok(output[0].phases[name].elapsedMs >= 4);
  assert.doesNotMatch(JSON.stringify(output),/SELECT|address|txid|balance|secret/u);
  for (const observer of [() => { throw Error('observer'); }, () => Promise.reject(Error('observer'))]) {
    assert.equal(await withPrivatePhaseTimings(() => measurePrivatePhase('wallet-supply',async () => 42),observer),42);
    await assert.rejects(withPrivatePhaseTimings(async () => { throw Error('original failure'); },observer),/original failure/);
  }
});

test('actual wallet responses and proof counts survive a failing private observer', async () => {
  const observations = [];
  const normal = entry({ observer: receipt => observations.push(receipt) });
  const failed = entry({ observer: () => { throw Error('observer'); } });
  assert.deepEqual(await failed.call(), await normal.call());
  assert.deepEqual(failed.counts, normal.counts);
  assert.equal(observations.length, 2);
  const closing = observations.find(receipt => receipt.work !== 'owned-flight');
  const owned = observations.find(receipt => receipt.work === 'owned-flight');
  assert.ok(owned && closing);
  assert.equal(closing.phases['closing-core'].count, 1);
  assert.equal(closing.phases['closing-mempool'].count, 1);
  assert.ok(!owned.phases['closing-core']);
  assert.ok(!('phases' in normal.receipts[0]));
  assert.doesNotMatch(JSON.stringify(observations), /account|amount|tipHeight|tipHash|requireCurrent/u);
});

test('actual full-audit wrapper retains global serialization across distinct owned maps', async () => {
  const context = vm.createContext({
    walletReadinessPreflightScope: { getStore: () => null },
    walletReadSnapshot: { getStore: () => null },
    proofIndexPrepareWalletReadiness: async () => true,
    proofIndexWalletReadinessUnavailableError: () => Object.assign(new Error("Fresh wallet credit state is temporarily unavailable."), { statusCode: 503 }), measurePrivatePhase, workPrecisionV2MigrationFullAuditQueue: queueFactory() });
  const run = new vm.Script(`${queueSource}\nworkPrecisionV2MigrationFullAuditWithBound`).runInContext(context);
  const order = [], output = [];
  await Promise.all([1,2].map(id => withPrivatePhaseTimings(() => run({ inFlight: new Map(), requestKey:'same', load: async () => {
    order.push(`start${id}`); await pause(10); order.push(`end${id}`); return id;
  } }), r => output.push(r))));
  assert.deepEqual(order,['start1','end1','start2','end2']);
  assert.ok(output[1].phases['full-audit-queue-wait'].elapsedMs >= 8);
});

test('worker/backfill timing wrappers preserve confirmed-before-pending and publication ordering', async () => {
  const worker = source('scripts/run-proof-indexer-worker.mjs','runCycle');
  const start = worker.indexOf('await runCanonicalBeforePending(');
  const end = worker.indexOf('\n  } else {',start);
  assert.ok(start>0 && end>start); const order = [], output = [];
  const context = vm.createContext({
    walletReadinessPreflightScope: { getStore: () => null },
    walletReadSnapshot: { getStore: () => null },
    proofIndexPrepareWalletReadiness: async () => true,
    proofIndexWalletReadinessUnavailableError: () => Object.assign(new Error("Fresh wallet credit state is temporarily unavailable."), { statusCode: 503 }), measurePrivatePhase,
    runCanonicalBeforePending: new vm.Script(`${source('scripts/run-proof-indexer-worker.mjs','runCanonicalBeforePending')}\nrunCanonicalBeforePending`).runInNewContext(),
    backfillPhases: [{kind:'confirmed'},{kind:'pending'}], canonicalProgress: {},
    runBackfillPhase: async p => order.push(p.kind), publishCanonicalSummaryAtConfirmedCheckpoint: async () => order.push('summary'),
    assertWorkerPendingCheckpointCoversCoreTip: async () => order.push('barrier'), refreshPendingStatusesSafely: async () => order.push('status'),
  });
  await withPrivatePhaseTimings(() => new vm.Script(`(async()=>{${worker.slice(start,end)}})()`).runInContext(context), r => output.push(r));
  assert.deepEqual(order,['confirmed','summary','barrier','status','pending']);
  assert.deepEqual(Object.keys(output[0].phases),['confirmed-scan','confirmed-summary','confirmed-barrier','pending-status','pending-scan']);
  const backfill = readFileSync('scripts/backfill-proof-indexer.mjs','utf8');
  const verifierStart = backfill.indexOf('const stageResponse = await measurePrivatePhase("pending-verifier"');
  const persistenceEnd = backfill.indexOf('\n      if (!pendingWitness)',verifierStart);
  const publishOrder = [];
  await withPrivatePhaseTimings(() => new vm.Script(`(async()=>{let pendingWitness;${backfill.slice(verifierStart,persistenceEnd)}return pendingWitness;})()`).runInNewContext({
    measurePrivatePhase, stagePlan:{request:{},publishEligible:true},scanComplete:true,client:{},
    canonicalDeferred:0,unresolved:0,protocolTxids:[],q16PendingUnresolved:0,scanned:0,publicationAttempt:{},stopReason:null,
    requestWorkQ16PendingStage:async()=>{publishOrder.push('verifier');return {};},
    persistExactWorkQ16PendingWitness:async()=>{publishOrder.push('atomic-persistence');return {};},
  }),()=>{});
  assert.deepEqual(publishOrder,['verifier','atomic-persistence']);
});

test('actual wallet entry coalesces one real PostgreSQL transaction; separate identities keep separate MVCC frames', { skip: !process.env.POW_SNAPSHOT_TEST_SOCKET }, async () => {
  const socket = process.env.POW_SNAPSHOT_TEST_SOCKET;
  assert.ok(socket.startsWith('/tmp/') && realpathSync(socket) === socket);
  const stat = statSync(socket); assert.equal(stat.uid,process.getuid()); assert.equal(stat.mode & 0o777,0o700);
  const pool = new pg.Pool({host:socket,port:55431,user:userInfo().username,database:'postgres',max:4});
  const writer = new pg.Pool({host:socket,port:55431,user:userInfo().username,database:'postgres',max:1});
  try {
    await writer.query('CREATE TABLE IF NOT EXISTS public.audit31_coalescing_frame (id integer PRIMARY KEY, value integer)');
    await writer.query('INSERT INTO public.audit31_coalescing_frame VALUES (1,1) ON CONFLICT(id) DO UPDATE SET value=1');
    let owned, transactions = [];
    const r = entry({ snapshot: load => withReadOnlySnapshot(pool,async p => {
      owned = p; transactions.push((await p.query('SELECT txid_current_snapshot()::text AS snapshot, pg_backend_pid() AS pid')).rows[0]);
      return load();
    }), overlay: async () => {
      const first = (await owned.query('SELECT value FROM public.audit31_coalescing_frame WHERE id=1')).rows[0].value;
      await writer.query('UPDATE public.audit31_coalescing_frame SET value=value+1 WHERE id=1');
      assert.equal((await owned.query('SELECT value FROM public.audit31_coalescing_frame WHERE id=1')).rows[0].value,first);
      return {tokens:[],indexedThroughBlock:1,indexedThroughBlockHash:'a'.repeat(64)};
    } });
    await Promise.all([r.call(),r.call()]); assert.equal(transactions.length,1); assert.equal(r.counts.audits,1);
    let releaseFirst, enteredFirst;
    const entered = new Promise(resolve => { enteredFirst=resolve; });
    const c = createWalletReadCoalescer();
    const first = c(key('work',['a']),()=>withReadOnlySnapshot(pool,async p=>{
      const frame=(await p.query('SELECT value FROM public.audit31_coalescing_frame')).rows[0].value;
      await writer.query('UPDATE public.audit31_coalescing_frame SET value=value+1'); enteredFirst();
      await new Promise(resolve=>{releaseFirst=resolve;});
      assert.equal((await p.query('SELECT value FROM public.audit31_coalescing_frame')).rows[0].value,frame); return frame;
    }));
    await entered;
    const second = await c(key('work',['b']),()=>withReadOnlySnapshot(pool,async p=>(await p.query('SELECT value FROM public.audit31_coalescing_frame')).rows[0].value));
    releaseFirst(); assert.equal(second,await first+1);
  } finally { await pool.end(); await writer.end(); }
});


test('merged wallet path spends the original 15s budget across preflight and snapshot', async () => {
  let now=Date.now();const r=entry({clock:()=>now,preflight:async()=>{now+=3700;return true;}});
  assert.ok(await r.call());assert.deepEqual(r.counts.budgets,[11300]);
  const expired=entry({clock:()=>now,preflight:async()=>{now+=15000;return true;}});
  await assert.rejects(expired.call(),error=>error.statusCode===503);assert.equal(expired.counts.snapshots,0);
  const refusal=Object.assign(Error('canonical proof unavailable'),{statusCode:503});
  const failed=entry({preflight:async()=>{throw refusal;}});
  await assert.rejects(failed.call(),error=>error===refusal);assert.equal(failed.counts.snapshots,0);
  const other=entry({preflight:async()=>assert.fail('non-WORK preflight')});await other.call('powb');assert.equal(other.counts.preflights,0);
});
