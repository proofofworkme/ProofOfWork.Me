import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { AsyncLocalStorage } from 'node:async_hooks';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
import { withReadOnlySnapshot, acquireReadOnlySnapshotClient, isReadOnlySnapshotBudgetError } from '../server/db/read-only-snapshot.mjs';

const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const text = readFileSync(new URL('../server/db/proof-index-reader.mjs', import.meta.url), 'utf8');
const ast = ts.createSourceFile('reader.mjs', text, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
function source(name) {
  const nodes = ast.statements.filter(n => ts.isFunctionDeclaration(n) && n.name?.text === name);
  assert.equal(nodes.length, 1, name);
  return nodes[0].getText(ast).replace(/^export\s+/u, '');
}
const queueSource = source('createAbortableReadinessAuditQueue');
const makeQueue = new vm.Script(`${queueSource}\ncreateAbortableReadinessAuditQueue`).runInNewContext({ Promise, Error, WalletRequestAsyncLocalStorage: AsyncLocalStorage });

test('cancelled queued audits never run; running cleanup keeps exclusive slot', async () => {
  const q = makeQueue(); let release; const started=[];
  const first = q(async () => { started.push(1); await new Promise(r=>release=r); });
  const controller = new AbortController();
  const cancelled = q(async () => started.push(2), controller.signal);
  const rejected = assert.rejects(cancelled, /admission unavailable/);
  const third = q(async () => started.push(3));
  await pause(1); controller.abort(); await rejected;
  assert.deepEqual(started,[1]); release(); await Promise.all([first,third]);
  assert.deepEqual(started,[1,3]);
});

test('queue admission is bounded and failures release the real runner', async () => {
  const q=makeQueue({maxQueued:1});let release;
  const first=q(()=>new Promise(r=>release=r));
  const second=q(()=>{throw Error('expected');}); const rejected=assert.rejects(second,/expected/);
  await assert.rejects(q(()=>assert.fail('overflow started')),/admission unavailable/);
  await pause(1);release();await first;await rejected;
  assert.equal(await q(()=>7),7);
});

test('abandoned pool acquisition releases late client exactly once', async () => {
  let resolve,releases=0; const controller=new AbortController();
  const pending=acquireReadOnlySnapshotClient({connect:()=>new Promise(r=>resolve=r)},
    {deadline:Date.now()+1000,timeoutMs:1000,signal:controller.signal});
  await pause(1);controller.abort();await assert.rejects(pending,isReadOnlySnapshotBudgetError);
  resolve({release(){releases++;}});await pause(1);assert.equal(releases,1);
});

test('absolute snapshot deadline includes pool wait and cancellation blocks new SQL', async () => {
  let released=0,queries=[];const controller=new AbortController();
  const pool={async connect(){await pause(12);return {async query(sql){queries.push(sql);return {rows:[]};},release(){released++;}};}};
  const deadlineAt=Date.now()+35;
  const result=withReadOnlySnapshot(pool,async db=>{controller.abort();await pause(1);await db.query('SELECT forbidden');},
    {timeoutMs:35,deadlineAt,signal:controller.signal});
  await assert.rejects(result,isReadOnlySnapshotBudgetError);assert.equal(released,1);
  assert.ok(!queries.includes('SELECT forbidden'));assert.ok(!queries.includes('COMMIT'));
});

function harness({ failCommit=false, negative=false, delay=8, reached=true, configured=true, now=()=>Date.now() }={}) {
  const scope=new AsyncLocalStorage(); const request=new AsyncLocalStorage();const wallet=new AsyncLocalStorage();const shared=new Map();
  const counts={audits:0,clients:0,commits:0,rolledBack:0};let key='a'.repeat(64);
  const pool={async connect(){counts.clients++;return {async query(sql){if(sql==='COMMIT'){counts.commits++;if(failCommit)throw Error('commit refused');}if(sql==='ROLLBACK')counts.rolledBack++;return {rows:[]};},release(){}};}};
  const queue=makeQueue();
  const context=vm.createContext({Promise,Error,Map,Object,Number,Date,AbortController,setTimeout,clearTimeout,
    walletReadinessPreflightScope:scope,walletReadSnapshot:wallet,walletRequestReadiness:request,walletReadinessPreflights:new Map(),
    walletProofReadinessFailures:new WeakSet(),isProofIndexWalletReadinessUnavailable:error=>error?.details?.code==='CANONICAL_WALLET_INDEX_UNAVAILABLE',
    workPrecisionV2MigrationReadinessReadyCache:shared,WORK_PRECISION_V2_READINESS_CACHE_MAX_ENTRIES:4,
    proofIndexPool:()=>pool,withReadOnlySnapshot,configuredWorkPrecisionV2ReaderPins:()=>configured?({configured:true}):null,
    proofIndexWorkAmoV8ActivationLatch:async()=>({reached}),
    workPrecisionV2MigrationReadinessResultIsReusablePositive:(r,n)=>r?.ready===true&&Date.parse(r.pendingValidThrough)>n,
    proofIndexWorkPrecisionV2MigrationReadiness:async()=>queue(async()=>{
      counts.audits++;await pause(delay);const s=scope.getStore();
      await s.pool.query('SELECT readiness');
      const result=Object.freeze({ready:!negative,auditedReadinessFingerprintKey:key,pendingValidThrough:new Date(now()+1000).toISOString()});
      s.maps.set('workPrecisionV2MigrationReadinessReadyCache',new Map([[key,{result,expiresAt:now()+500}]]));return result;
    },scope.getStore().signal),
  });
  const functions=new vm.Script([source('proofIndexWalletReadinessUnavailableError'),source('walletPreflightReadinessMap'),source('promoteWalletPreflightReadiness'),source('proofIndexPrepareWalletReadiness'),
    '({run:proofIndexPrepareWalletReadiness,promote:promoteWalletPreflightReadiness})'].join('\n')).runInContext(context);
  return {...functions,counts,shared,queue,walletScope:wallet,preflightScope:scope,setKey:k=>key=k};
}

test('different wallet callers share one account-independent snapshot; proof appears only after commit', async () => {
  const h=harness({delay:15});const a=h.run('livenet',{timeoutMs:100});const b=h.run('livenet',{timeoutMs:100});
  await pause(3);assert.equal(h.shared.size,0);
  assert.deepEqual(await Promise.all([a,b]),[true,true]);
  assert.equal(h.counts.audits,1);assert.equal(h.counts.clients,1);assert.equal(h.counts.commits,1);assert.equal(h.shared.size,1);
  await h.run('livenet',{timeoutMs:100});assert.equal(h.counts.audits,2); // no settled flight caching
});

test('one cancelling subscriber cannot cancel another; last subscriber cancels queued audit', async () => {
  const h=harness({delay:15});const c=new AbortController();
  const a=h.run('livenet',{timeoutMs:100,signal:c.signal});const b=h.run('livenet',{timeoutMs:100});
  c.abort();await assert.rejects(a,/unavailable/);assert.equal(await b,true);assert.equal(h.counts.audits,1);
  const q=harness();let release;const block=q.queue(()=>new Promise(r=>release=r));await pause(1);
  const only=new AbortController();const pending=q.run('livenet',{timeoutMs:100,signal:only.signal});
  await pause(2);only.abort();await assert.rejects(pending,/unavailable/);await pause(2);
  release();await block;await pause(2);assert.equal(q.counts.audits,0);assert.equal(q.shared.size,0);
});

test('deadline, negative proof and failed COMMIT never publish and leave retry available', async () => {
  for(const options of [{negative:true},{failCommit:true},{delay:35}]) {
    const h=harness(options);const outcome=await Promise.allSettled([h.run('livenet',{timeoutMs:options.delay?10:100})]);
    assert.equal(outcome[0].status,'rejected');assert.equal(outcome[0].reason.details.code,'CANONICAL_WALLET_INDEX_UNAVAILABLE');
    await pause(40);assert.equal(h.shared.size,0);
    if(options.delay){const next=h.run('livenet',{timeoutMs:100});assert.equal(await next,true);}
  }
});

test('promotion rejects expired, mutable, wrong-fingerprint and foreign result evidence', () => {
  const h=harness();const key='b'.repeat(64);const result=Object.freeze({ready:true,auditedReadinessFingerprintKey:key,pendingValidThrough:new Date(Date.now()+1000).toISOString()});
  const map=entry=>({maps:new Map([['workPrecisionV2MigrationReadinessReadyCache',new Map([[key,entry]])]])});
  assert.equal(h.promote(map({result,expiresAt:Date.now()-1}),result),false);
  assert.equal(h.promote(map({result,expiresAt:Date.now()+100}),{...result}),false);
  assert.equal(h.promote(map({result,expiresAt:Date.now()+100}),Object.freeze({...result,auditedReadinessFingerprintKey:'c'.repeat(64)})),false);
  assert.equal(h.shared.size,0);
});


test('queued audits retain each enqueueing async scope, including after cancellation', async () => {
  const context = new AsyncLocalStorage(); const q=makeQueue(); const seen=[];let release;
  const a=context.run('first',()=>q(async()=>{seen.push(context.getStore());await new Promise(r=>release=r);}));
  const abort=new AbortController();
  const skipped=context.run('cancelled',()=>q(async()=>seen.push(context.getStore()),abort.signal));
  const rejected=assert.rejects(skipped,/unavailable/);
  const b=context.run('second',()=>q(async()=>seen.push(context.getStore())));
  await pause(1);abort.abort();await rejected;release();await Promise.all([a,b]);
  assert.deepEqual(seen,['first','second']);
});


test('abort and deadline fence BEGIN, setup, COMMIT and ROLLBACK even when pg never settles', async () => {
  for (const stuck of ['BEGIN','SET LOCAL','COMMIT','ROLLBACK']) {
    let released=0;let destroyed=false;const controller=new AbortController();
    const pool={async connect(){return {query(sql){if(sql.startsWith(stuck))return new Promise(()=>{});return Promise.resolve({rows:[]});},release(error){released++;destroyed=Boolean(error);}};}};
    const started=Date.now();
    const job=withReadOnlySnapshot(pool,async()=>{if(stuck==='ROLLBACK')throw Error('callback failed');return 1;}, {timeoutMs:20,signal:controller.signal});
    await assert.rejects(job);assert.ok(Date.now()-started<150);assert.equal(released,1);assert.equal(destroyed,true);
  }
});

test('real PostgreSQL cancellation destroys only the owned session and leaves no idle transaction', {skip:process.env.POW_PREFLIGHT_READONLY_PG_TEST !== '1'}, async () => {
  const {default:pg}=await import('pg');
  const connectionString=process.env.POW_INDEX_DATABASE_URL??process.env.PROOF_INDEX_DATABASE_URL??process.env.DATABASE_URL;
  assert.ok(connectionString,'explicit database URL required');
  const pool=new pg.Pool({connectionString,max:2,application_name:'pow-health-preflight-readonly-test',options:'-c default_transaction_read_only=on',connectionTimeoutMillis:1000});
  const inspector=new pg.Pool({connectionString,max:1,application_name:'pow-health-preflight-readonly-inspect',options:'-c default_transaction_read_only=on',connectionTimeoutMillis:1000});
  try {
    for(const mode of ['abort','deadline']) {
      let pid;const controller=new AbortController();const started=Date.now();
      const result=withReadOnlySnapshot(pool,async db=>{
        pid=(await db.query('SELECT pg_backend_pid() AS pid')).rows[0].pid;
        if(mode==='abort')setTimeout(()=>controller.abort(),25);
        await db.query('SELECT pg_sleep(5)');
      },{timeoutMs:150,signal:controller.signal});
      await assert.rejects(result,isReadOnlySnapshotBudgetError);assert.ok(Date.now()-started<600);
      assert.ok(pid);await pause(200);
      const survivors=await inspector.query('SELECT count(*)::int AS n FROM pg_stat_activity WHERE pid=$1',[pid]);
      assert.equal(survivors.rows[0].n,0,`${mode} left an owned backend running`);
    }
  } finally {await Promise.all([pool.end(),inspector.end()]);}
});


test('pre-activation and missing pins skip preflight without granting cached authority', async () => {
  for(const options of [{reached:false},{configured:false}]) {
    const h=harness(options);assert.equal(await h.run('livenet',{timeoutMs:100}),true);
    assert.equal(h.counts.audits,0);assert.equal(h.shared.size,0);
  }
});


test('nested wallet/preflight scopes cannot borrow a transaction or publish global proof', async () => {
  for(const kind of ['walletScope','preflightScope']) {
    const h=harness();await h[kind].run({pool:{},maps:new Map()},async()=>{
      await assert.rejects(h.run('livenet',{timeoutMs:100}),error=>error.details.code==='CANONICAL_WALLET_INDEX_UNAVAILABLE');
    });
    assert.equal(h.counts.clients,0);assert.equal(h.counts.audits,0);assert.equal(h.shared.size,0);
  }
});
