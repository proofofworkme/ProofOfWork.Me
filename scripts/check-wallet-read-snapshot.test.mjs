import assert from 'node:assert/strict';
import test from 'node:test';
import { AsyncLocalStorage } from 'node:async_hooks';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
import { withReadOnlySnapshot } from '../server/db/read-only-snapshot.mjs';

// Scheduled MVCC model exercises the actual session/borrow lifecycle; it is
// not a replacement for PostgreSQL integration or live acceptance.
function database() {
  let current = 1;
  const calls = [], clients = [];
  return {
    calls, clients, publish: () => ++current,
    pool: { async connect() {
      const client = { released: false, snapshot: null, async query(text) {
        text = typeof text === 'string' ? text : text.text;
        calls.push(text);
        if (text.startsWith('BEGIN')) client.snapshot = current;
        if (text === 'SELECT frame') return { rows: [{ frame: client.snapshot }] };
        if (text === 'SELECT error') throw Error('scheduled SQL failure');
        return { rows: [], rowCount: 0 };
      }, release(error) { client.released = true; client.discardError = error; } };
      clients.push(client); return client;
    } },
  };
}
test('account, summary and capacity keep one frame across a publication', async () => {
  const db = database();
  const result = await withReadOnlySnapshot(db.pool, async (pool) => {
    const account = (await pool.query('SELECT frame')).rows[0].frame;
    db.publish();
    const summary = (await pool.query('SELECT frame')).rows[0].frame;
    const capacity = (await pool.query('SELECT frame')).rows[0].frame;
    return [account, summary, capacity];
  });
  assert.deepEqual(result, [1, 1, 1]);
  assert.equal(db.clients.length, 1); assert.equal(db.clients[0].released, true);
  assert.equal(db.calls.filter(x => x === 'COMMIT').length, 1);
});
test('nested audits cannot commit or release the owning session', async () => {
  const db = database();
  await withReadOnlySnapshot(db.pool, async pool => {
    const audit = await pool.connect();
    await audit.query('BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY');
    await audit.query('SET LOCAL search_path = pg_catalog, pg_temp');
    await audit.query('SELECT frame'); await audit.query('COMMIT'); audit.release();
    assert.equal(db.clients[0].released, false);
    assert.equal(db.calls.includes('COMMIT'), false);
    await pool.query('SELECT frame');
  });
  assert.equal(db.calls.filter(x => x.startsWith('BEGIN')).length, 1);
});
test('a swallowed nested audit failure still aborts the complete receipt', async () => {
  const db = database();
  await assert.rejects(withReadOnlySnapshot(db.pool, async pool => {
    const audit = await pool.connect();
    await audit.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
    await audit.query('SELECT error').catch(() => {});
    await audit.query('ROLLBACK').catch(() => {}); audit.release(); return 'unsafe';
  }));
  assert.equal(db.calls.includes('COMMIT'), false); assert.ok(db.calls.includes('ROLLBACK'));
});
test('unreleased leases, open leases and unexpected transaction controls fail closed', async () => {
  for (const load of [async p => { await p.connect(); }, async p => {
    const c = await p.connect(); await c.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY'); c.release();
  }, async p => { await p.query('COMMIT'); }, async p => { await p.query('BEGIN'); }]) {
    const db = database(); await assert.rejects(withReadOnlySnapshot(db.pool, load));
    assert.equal(db.calls.includes('COMMIT'), false); assert.equal(db.clients[0].released, true);
  }
});
test('a timed-out callback cannot query a released connection later', async () => {
  const db = database(); let latePool;
  await assert.rejects(withReadOnlySnapshot(db.pool, async p => {
    latePool = p; await new Promise(r => setTimeout(r, 30)); return 'late';
  }, { timeoutMs: 5 }));
  await assert.rejects(latePool.query('SELECT frame'));
  assert.equal(db.clients[0].released, true); assert.equal(db.calls.includes('COMMIT'), false);
});
test('timed-out in-flight work loses its exclusively owned connection before further SQL', async () => {
  const db = database(); const connect = db.pool.connect;
  db.pool.connect = async () => { const c = await connect(); const query = c.query;
    c.query = async t => { if(t === 'SELECT slow') {
      await new Promise(r => setTimeout(r, 20)); if (c.released) throw Error("owned connection closed");
    } return query(t); }; return c; };
  await assert.rejects(withReadOnlySnapshot(db.pool, p => p.query('SELECT slow'), { timeoutMs: 5 }));
  assert.equal(db.clients[0].released, true);
  assert.ok(db.clients[0].discardError); assert.equal(db.calls.includes('COMMIT'),false);
});
test('parallel sessions have distinct frames and no client leakage', async () => {
  const db = database(); let publish;
  const first = withReadOnlySnapshot(db.pool, async p => {
    await p.query('SELECT frame'); db.publish(); publish();
    await new Promise(r => setTimeout(r, 10)); return (await p.query('SELECT frame')).rows[0].frame;
  });
  await new Promise(r => { publish = r; });
  const second = withReadOnlySnapshot(db.pool, async p => (await p.query('SELECT frame')).rows[0].frame);
  assert.deepEqual(await Promise.all([first, second]), [1, 2]);
  assert.ok(db.clients.every(c => c.released));
});
test('invalid budgets allocate no client', async () => {
  for (const timeoutMs of [0, -1, Infinity, NaN, 1.1, 120001]) {
    const db = database(); await assert.rejects(withReadOnlySnapshot(db.pool, () => null, { timeoutMs }));
    assert.equal(db.clients.length, 0);
  }
});
const ast = ts.createSourceFile('reader.mjs', readFileSync('server/db/proof-index-reader.mjs','utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
function fn(name) { return ast.statements.find(n => ts.isFunctionDeclaration(n) && n.name?.text === name).getText(ast).replace(/^export\s+/u, ''); }
test('actual reader context isolates requests and readiness caches', async () => {
  const db = database(); const walletReadSnapshot = new AsyncLocalStorage();
  const ctx = vm.createContext({
    walletReadinessPreflightScope: { getStore: () => null },
    walletRequestReadinessCommittedSnapshot: read => read(() => {}),
    proofIndexPrepareWalletReadiness: async () => true,
    proofIndexWalletReadinessUnavailableError: () => Object.assign(new Error("Fresh wallet credit state is temporarily unavailable."), { statusCode: 503 }), walletReadSnapshot, withReadOnlySnapshot, proofIndexPool: () => walletReadSnapshot.getStore()?.pool ?? db.pool });
  const { run, map } = new vm.Script(`${fn('proofIndexWithWalletReadSnapshot')}\n${fn('walletSnapshotReadinessMap')}\n({run:proofIndexWithWalletReadSnapshot,map:walletSnapshotReadinessMap})`).runInContext(ctx);
  const shared = new Map([['outside', 1]]);
  await run(async () => {
    const local = map('proof',shared); local.set('inside', 2);
    assert.equal(local.has('outside'), false);
    assert.equal(map('proof',shared), local);
    await assert.rejects(run(async () => null));
  });
  assert.equal(map('proof',shared), shared); assert.equal(shared.has('inside'), false);
});

test('settled cache copies cannot mutate shared positives or borrow shared work', () => {
  const walletReadSnapshot = new AsyncLocalStorage();
  const ctx = vm.createContext({
    walletReadinessPreflightScope: { getStore: () => null },
    walletRequestReadinessCommittedSnapshot: read => read(() => {}),
    proofIndexPrepareWalletReadiness: async () => true,
    proofIndexWalletReadinessUnavailableError: () => Object.assign(new Error("Fresh wallet credit state is temporarily unavailable."), { statusCode: 503 }), walletReadSnapshot });
  const map = new vm.Script(`${fn('walletSnapshotReadinessMap')}\nwalletSnapshotReadinessMap`).runInContext(ctx);
  const shared = new Map([['epoch-A', Object.freeze({ ready: true })]]);
  walletReadSnapshot.run({ maps: new Map() }, () => {
    const positives = map('testReadyCache',shared);
    assert.equal(positives.get('epoch-A'), shared.get('epoch-A'));
    positives.delete('epoch-A'); assert.equal(shared.size, 1);
    assert.equal(map('testInFlight',shared).size, 0);
  });
});

test('rollback transport failure discards the uncertain connection', async () => {
  const db = database(); const connect = db.pool.connect; let discard;
  db.pool.connect = async () => { const c = await connect(); const query = c.query;
    c.query = async t => { if(t === 'ROLLBACK') throw Error('connection lost'); return query(t); };
    c.release = error => { c.released = true; discard = error; }; return c; };
  await assert.rejects(withReadOnlySnapshot(db.pool, () => { throw Error('read failed'); }));
  assert.equal(discard.message, 'connection lost');
});

test('raw queries and borrowed helpers resolve to the actual scoped pool', async () => {
  const db = database(); const walletReadSnapshot = new AsyncLocalStorage();
  const ctx = vm.createContext({
    walletReadinessPreflightScope: { getStore: () => null },
    walletRequestReadinessCommittedSnapshot: read => read(() => {}),
    proofIndexPrepareWalletReadiness: async () => true,
    proofIndexWalletReadinessUnavailableError: () => Object.assign(new Error("Fresh wallet credit state is temporarily unavailable."), { statusCode: 503 }),walletReadSnapshot, withReadOnlySnapshot,
    proofIndexReadPool: db.pool, proofIndexDatabaseConfigured: () => true});
  const helpers = new vm.Script(`${fn('proofIndexPool')}\n${fn('proofIndexWithWalletReadSnapshot')}\n({pool:proofIndexPool,run:proofIndexWithWalletReadSnapshot})`).runInContext(ctx);
  assert.equal(helpers.pool(),db.pool);
  await helpers.run(async () => {
    const scoped = helpers.pool(); assert.notEqual(scoped,db.pool);
    assert.equal((await scoped.query('SELECT frame')).rows[0].frame,1);
    db.publish();
    const c = await scoped.connect();
    await c.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
    assert.equal((await c.query('SELECT frame')).rows[0].frame,1);
    await c.query('COMMIT');c.release();
  });
  assert.equal(helpers.pool(),db.pool);
});

test('query cancellation produces bounded private diagnostics without SQL or messages', async () => {
  const { ReadOnlySnapshotBudgetError } = await import('../server/db/read-only-snapshot.mjs');
  const calls = [];
  const pool = { async connect() { return {
    async query(sql) { calls.push(sql); if (sql === 'SELECT secret_address')
      throw Object.assign(Error('secret parameter and SQL'), { code: '57014' });
      return { rows: [] }; }, release() { calls.push('release'); },
  }; } };
  await assert.rejects(withReadOnlySnapshot(pool, p => p.query('SELECT secret_address')), error => {
    assert.ok(error instanceof ReadOnlySnapshotBudgetError);
    assert.equal(error.diagnostic.cause, 'query-cancelled');
    assert.equal(error.diagnostic.sqlState, '57014');
    assert.equal(error.diagnostic.queryId, 1);
    assert.ok(error.diagnostic.remainingMs <= 10000);
    assert.ok(!JSON.stringify(error).includes('secret'));
    return true;
  });
  assert.equal(calls.includes('COMMIT'), false);
  assert.deepEqual(calls.slice(-2), ['ROLLBACK', 'release']);
});

test('callback deadline is typed and destroys the borrowed query owning connection', async () => {
  const { isReadOnlySnapshotBudgetError } = await import('../server/db/read-only-snapshot.mjs');
  const calls = [];
  const pool = { async connect() { return {
    async query(sql) { calls.push(sql); if (sql === 'SELECT slow') await new Promise(r => setTimeout(r, 35));
      return { rows: [] }; }, release(error) { calls.push(error ? 'destroy' : 'release'); },
  }; } };
  await assert.rejects(withReadOnlySnapshot(pool, async p => {
    const lease = await p.connect();
    try { await lease.query('SELECT slow'); } finally { lease.release(); }
  }, { timeoutMs: 10 }), error => {
    assert.ok(isReadOnlySnapshotBudgetError(error));
    assert.equal(error.diagnostic.cause, 'deadline'); return true;
  });
  assert.equal(calls.includes('COMMIT'), false);
  assert.equal(calls.at(-1),'destroy');
});

test('swallowing a query-budget error cannot commit or erase its typed cause', async () => {
  const { isReadOnlySnapshotBudgetError } = await import('../server/db/read-only-snapshot.mjs');
  const pool = { async connect() { return {
    async query(sql) { if (sql === 'SELECT cancelled') throw Object.assign(Error('private'), {code:'57014'}); return {rows:[]}; }, release() {},
  }; } };
  await assert.rejects(withReadOnlySnapshot(pool, async p => { await p.query('SELECT cancelled').catch(() => null); return 'bad'; }),
    e => isReadOnlySnapshotBudgetError(e) && e.diagnostic.cause === 'query-cancelled');
});

test('concurrent cancellation identifies its own query ordinal', async () => {
  const pool = { async connect() { return { async query(sql) {
    if (sql === 'SELECT first') { await new Promise(r=>setTimeout(r,5)); throw Object.assign(Error('private'),{code:'57014'}); }
    return {rows:[]}; }, release() {} }; } };
  await assert.rejects(withReadOnlySnapshot(pool, p => Promise.all([p.query('SELECT first'),p.query('SELECT second')])),
    e=>e.diagnostic.queryId===1 && e.diagnostic.sqlState==='57014');
});
