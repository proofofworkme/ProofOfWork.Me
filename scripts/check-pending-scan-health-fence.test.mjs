import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import test from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';

// Execute the committed caller and publication safety guards. Database/Core
// dependencies are controlled fixtures; later projection SQL is outside this test.
const proposed = readFileSync(new URL('./backfill-proof-indexer.mjs', import.meta.url), 'utf8');
const fixedCondition = 'stagePlan.requiresAttemptFence || !scanComplete || !reusableScanHealthMatches';
assert.equal(proposed.split(fixedCondition).length, 2);
const actual = proposed.replace(fixedCondition, 'stagePlan.requiresAttemptFence || !scanComplete');
const digest = value => createHash('sha256').update(value).digest('hex');
const A = 'a'.repeat(64), B = 'b'.repeat(64), H = 'c'.repeat(64);
const oldStage = 'a4f0ca5a5acd3015c95ed6683b9d531a93899d9cb51d24f6b6dd7ca0e095454a';
const newStage = '5fd70df9eab01d2b7d67cf627be19baf1956e909d30a9b6eb16f02c4a0699653';
const generatedAt = '2026-10-11T00:30:18.011Z';
const epoch = {version: 'unchanged-fixture-epoch'};

function extracted(source) {
  const ast = ts.createSourceFile('backfill-proof-indexer.mjs', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
  const find = name => {
    const matches = ast.statements.filter(node => ts.isFunctionDeclaration(node) && node.name?.text === name);
    assert.equal(matches.length, 1, name);
    return matches[0];
  };
  const helpers = ['buildWorkQ16PendingStagePlan',
    'workQ16PendingScanComplete', 'workQ16PendingReusableScanHealthMatches',
    'workQ16PendingRunningAttempt', 'storeWorkQ16PendingRunningAttempt'];
  const caller = find('backfillMempoolScanSource');
  const declaration = caller.body.statements.find(node => ts.isVariableStatement(node) &&
    node.declarationList.declarations.some(entry => entry.name.getText(ast) === 'pendingWitness'));
  const branch = caller.body.statements.find(node => ts.isIfStatement(node) && node.expression.getText(ast) === 'q16PendingActive');
  assert.ok(declaration && branch);
  const publication = find('persistExactWorkQ16PendingWitness');
  const transaction = publication.body.statements.find(node => ts.isTryStatement(node));
  const stop = transaction.tryBlock.statements.findIndex(node => ts.isIfStatement(node) &&
    node.getText(ast).includes('WORK Q16 parent witness changed before staged publication.'));
  assert.ok(stop > 0);
  // Execute actual persistence through its Core, epoch, locked-attempt and parent
  // guards. Later SQL projection/publication is explicitly outside this fixture.
  const header = source.slice(publication.getStart(ast), publication.body.getStart(ast) + 1);
  const beforeTry = [...publication.body.statements].slice(0, [...publication.body.statements].indexOf(transaction));
  const persistencePrefix = `${header}\n${beforeTry.map(node => node.getText(ast)).join('\n')}\ntry {\n` +
    [...transaction.tryBlock.statements].slice(0, stop + 1).map(node => node.getText(ast)).join('\n') +
    '\nreturn { safetyPrefixPassed: true, ready: true, stagedIndexed: 0, scan: { globalUnresolved, q16PendingUnresolved, stopReason } };\n' +
    '} catch (error) { await client.query("ROLLBACK"); throw error; }\n}';
  return {
    code: helpers.map(name => find(name).getText(ast)).join('\n') + '\n' + persistencePrefix +
      '\nasync function exerciseCaller() {\n' + declaration.getText(ast) + '\n' + branch.getText(ast) +
      '\nreturn { pendingWitness, unresolved, q16PendingUnresolved, indexed };\n}\n({exerciseCaller,buildWorkQ16PendingStagePlan})',
    persistencePrefix,
    callerBranch: branch.getText(ast),
  };
}
const actualParts = extracted(actual), proposedParts = extracted(proposed);
assert.equal(actualParts.persistencePrefix, proposedParts.persistencePrefix, 'All persistence safety guards must remain byte-identical');

function fixture({fixed = true, priorGlobal = 1, currentGlobal = 0, q16 = 0, stopReason = '',
                  discovered = [], concurrentAttempt = false, parentDriftAtStore = false,
                  parentDriftAfterStage = false, epochDrift = false} = {}) {
  const published = {status: 'published', stageSha256: oldStage, witnessGeneratedAt: generatedAt,
                     publicationReadinessEpochCheckpoint: epoch};
  const witness = {ready: true, generatedAt, scan: {complete: true, globalUnresolved: priorGlobal,
    q16PendingUnresolved: 0, stopReason: ''}, membershipSnapshot: {txids: [A]},
    verifierStage: {codeVersion: 'fixture-v5', stageSha256: oldStage,
      confirmedBaseCommitment: {tokenStateCommitment: {sha256: A}}, canonicalTip: {height: 970851, hash: H}}};
  const state = {running: null, published, verifierCalls: 0, writes: [], queries: [], errors: [], stageStored: 0, afterStage: false};
  const client = {query: async (sql, params = []) => {
    state.queries.push({sql, params});
    if (/INSERT INTO proof_indexer.meta/u.test(sql)) {
      state.writes.push(params[0]);
      assert.equal(params[0], 'running-attempt', 'Existing published attempt is never overwritten by running fence');
      state.running = JSON.parse(params[1]);
    }
    if (/SELECT value/u.test(sql)) {
      const value = params[0] === 'running-attempt' ? state.running :
        params[0] === 'published-attempt' ? state.published : witness;
      return {rowCount: value ? 1 : 0, rows: value ? [{value}] : []};
    }
    if (/pg_current_xact_id/u.test(sql)) return {rowCount: 1, rows: [{transaction_id: '123'}]};
    return {rowCount: 1, rows: []};
  }};
  const globals = {
    NETWORK: 'livenet', WORK_Q16_PENDING_REUSE_MAX_AGE_MS: 600000,
    process: {env: {POW_INDEX_WORKER_INTERVAL_MS: '30000'}},
    Date: class extends Date {static now() {return Date.parse(generatedAt) + 1000;}},
    WORK_Q16_PENDING_STAGE_REQUEST_MODEL: 'request', WORK_Q16_PENDING_STAGE_CODE_VERSION: 'fixture-v5',
    WORK_Q16_PENDING_ATTEMPT_MODEL: 'attempt', WORK_Q16_PENDING_STAGE_MODEL: 'stage',
    WORK_Q16_PENDING_REBUILD_META_KEY: 'published-witness',
    WORK_Q16_PENDING_RUNNING_ATTEMPT_META_KEY: 'running-attempt', WORK_Q16_PENDING_ATTEMPT_META_KEY: 'published-attempt',
    WORK_AMO_V8_DECLARATION_PINS_CONFIGURED: true, WORK_PROJECTION_STATE_Q16: 'q16',
    WORK_AMO_V8_CONFIGURED_ACTIVATION_HEIGHT: 960601,
    workQ16PendingStageContext: async () => ({parent: {witness, membershipTxids: [A], sha256: A},
      storedStage: {}, priorObservations: [], attempt: published,
      currentConfirmedBase: {tokenStateCommitment: {sha256: A}, canonicalTip: {height: 970851, hash: H}}}),
    readWorkQ16ReadinessEpochCheckpointSnapshot: async () => epoch,
    canonicalWorkQ16PendingTxids: ids => ids.sort(),
    workQ16PendingAbsencePlan: async () => ({confirmedTxids: [], removalTxids: [], reappearedTxids: [], absenceEvidence: {observations: []}}),
    canonicalJsonText: JSON.stringify, objectValue: value => value ?? {}, workQ16ReadinessEpochCheckpointCovers: () => true,
    canonicalWorkQ16PendingAttempt: value => value,
    workAmoV5CanonicalPayloadCommitment: value => ({sha256: digest(JSON.stringify(value))}),
    lockedWorkQ16PendingParent: async () => ({sha256: parentDriftAtStore || (parentDriftAfterStage && state.afterStage) ? B : A,
      witness, membershipTxids: [A]}),
    lockWorkQ16PendingBootstrapAuditTables: async () => {throw new Error('Unexpected bootstrap');},
    currentWorkProjectionState: async () => 'q16', preparedWorkQ16PendingStageDecisions: async () => [],
    normalizedLowerText: value => String(value).toLowerCase(), isHexTxid: value => /^[a-f0-9]{64}$/u.test(value),
    readWorkQ16ReadinessEpochCheckpoint: async () => epochDrift ? {version: 'changed'} : epoch,
    workQ16PostPublicationReadinessEpochCheckpoint: () => epoch,
    bitcoinRpc: async method => {
      if (method === 'getrawmempool') return [A, B];
      if (method === 'getblockcount') return 970851;
      if (method === 'getbestblockhash') return H;
      throw new Error('Unexpected RPC fixture call: ' + method);
    },
    canonicalMempoolTxidSnapshot: txids => ({txids, count: txids.length, model: 'mempool', sha256: digest(JSON.stringify(txids))}),
    measurePrivatePhase: async (_, callback) => callback(),
    requestWorkQ16PendingStage: async request => {
      state.verifierCalls++; state.afterStage = true;
      if (concurrentAttempt && state.running) state.running = {...state.running, attemptId: B};
      return {model: 'stage', stage: {stageSha256: newStage, canonicalTip: {height: 970851, hash: H},
        replayTxids: request.replayTxids, removalTxids: [], confirmedRemovalTxids: [],
        readinessEpochCheckpoint: epoch, parentWitnessSha256: request.parentWitnessSha256,
        priorMembershipTxids: request.priorMembershipTxids}};
    },
    storeCurrentWorkQ16PendingStage: async () => {state.stageStored++;},
    console: {error: text => state.errors.push(JSON.parse(text))},
    client, q16PendingActive: true, q16PendingUnresolved: q16, stopReason,
    unresolved: currentGlobal, stagedWorkTxids: new Set(discovered), processed: new Set(), indexed: 0,
    canonicalDeferred: 0, protocolTxids: 5, scanned: 500,
  };
  const api = new vm.Script((fixed ? proposedParts : actualParts).code).runInContext(vm.createContext(globals));
  return {api, state, witness, run: () => api.exerciseCaller(),
          plan: () => api.buildWorkQ16PendingStagePlan(client, {discoveredTxids: discovered,
            initialMempoolSnapshot: {txids: [A, B]}})};
}

test('planner regards the prior red witness as structurally reusable', async () => {
  const f = fixture(); const plan = await f.plan();
  assert.equal(plan.requiresAttemptFence, false);
  assert.equal(plan.reusableWitness, f.witness);
  assert.equal(plan.reusableWitness.scan.globalUnresolved, 1);
});
test('original condition fails health-only 1→0 against its old published-stage fence', async () => {
  const f = fixture({fixed: false}); const result = await f.run();
  assert.equal(result.pendingWitness, null);
  assert.equal(result.unresolved, 1); assert.equal(result.q16PendingUnresolved, 1);
  assert.equal(f.state.running, null); assert.equal(f.state.verifierCalls, 1);
  assert.match(f.state.errors[0].error, /publication attempt fence changed/u);
  assert.equal(f.state.published.stageSha256, oldStage);
});
test('health-only 1→0 creates a running fence and passes unchanged persistence guards', async () => {
  const f = fixture(); const result = await f.run();
  assert.equal(result.pendingWitness.safetyPrefixPassed, true);
  assert.equal(result.pendingWitness.scan.globalUnresolved, 0);
  assert.equal(result.q16PendingUnresolved, 0); assert.equal(f.state.errors.length, 0);
  assert.deepEqual(f.state.writes, ['running-attempt']);
  assert.equal(f.state.running.status, 'running');
  assert.equal(f.state.published.stageSha256, oldStage);
  assert.ok(f.state.queries.some(entry => entry.sql === 'BEGIN ISOLATION LEVEL SERIALIZABLE'));
});
test('health-only 0→1 records red scan health honestly and same-health 0→0 still reuses', async () => {
  const red = fixture({priorGlobal: 0, currentGlobal: 1}); const result = await red.run();
  assert.equal(result.pendingWitness.scan.globalUnresolved, 1);
  assert.deepEqual(red.state.writes, ['running-attempt']);
  const unchanged = fixture({priorGlobal: 0, currentGlobal: 0});
  assert.equal((await unchanged.run()).pendingWitness.scan.globalUnresolved, 0);
  assert.equal(unchanged.state.verifierCalls, 0); assert.equal(unchanged.state.writes.length, 0);
});
test('incomplete Q16 or bounded scan never enters persistence despite a new running fence', async () => {
  for (const options of [{q16: 1}, {stopReason: 'budget'}]) {
    const f = fixture(options); const result = await f.run();
    assert.equal(result.pendingWitness, null); assert.equal(f.state.stageStored, 1);
    assert.deepEqual(f.state.writes, ['running-attempt']);
    assert.equal(f.state.queries.some(entry => entry.sql === 'BEGIN ISOLATION LEVEL SERIALIZABLE'), false);
  }
});
test('parent, epoch and concurrent-attempt drift remain fail-closed', async () => {
  for (const [options, error] of [[{parentDriftAtStore: true}, /parent witness changed before the attempt fence/u],
    [{parentDriftAfterStage: true}, /parent witness changed before staged publication/u],
    [{epochDrift: true}, /readiness epoch changed/u], [{concurrentAttempt: true}, /publication attempt fence changed/u]]) {
    const f = fixture(options); const result = await f.run();
    assert.equal(result.pendingWitness, null); assert.equal(result.q16PendingUnresolved, 1);
    assert.match(f.state.errors[0].error, error);
  }
});
test('membership changes retain their existing running-attempt path', async () => {
  const f = fixture({priorGlobal: 0, currentGlobal: 0, discovered: [B]});
  assert.equal((await f.plan()).requiresAttemptFence, true);
  assert.equal((await f.run()).pendingWitness.safetyPrefixPassed, true);
  assert.deepEqual(f.state.writes, ['running-attempt']);
});
