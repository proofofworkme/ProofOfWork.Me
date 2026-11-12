import test from 'node:test';import assert from 'node:assert/strict';import vm from 'node:vm';import {readFileSync} from 'node:fs';import {createHash} from 'node:crypto';import {EventEmitter} from 'node:events';import ts from 'typescript';
import {withPrivateRequestContext,privateReadContext,privateRegistryObservationId,withPrivateRegistryObservation,measurePrivateRegistryPhase,measurePrivateRegistryPhaseSync,observePrivateHttpRequest} from '../server/wallet-read-observation.mjs';
const source=readFileSync(process.env.POW_REGISTRY_TIMING_CANDIDATE_API_FILE || new URL('../server/proof-api.mjs',import.meta.url),'utf8');const ast=ts.createSourceFile('api.mjs',source,ts.ScriptTarget.Latest,true,ts.ScriptKind.JS);const fn=name=>ast.statements.find(n=>ts.isFunctionDeclaration(n)&&n.name.text===name);const pause=ms=>new Promise(r=>setTimeout(r,ms));
const hashes={buildInternalRegistryParityPayload:'6b8d68014c7c622b119efe2c962169e02d56aa67641458cc71be5b39e6ce7501',hydrateExactConfirmedRegistryHistory:'ce1ed455eff131861559fa74031dde2dde8b638e22489588927cea5793f97778'};
test('removing timing wrappers restores exact baseline AST, including all fresh-proof fences and concurrency',()=>{for(const[name,hash]of Object.entries(hashes)){const transform=ts.transform(fn(name),[context=>root=>{function visit(n){if(ts.isCallExpression(n)&&['measurePrivateRegistryPhase','measurePrivateRegistryPhaseSync'].includes(n.expression.getText(ast))){assert.equal(n.arguments.length,2);assert.ok(ts.isArrowFunction(n.arguments[1]));return ts.visitNode(n.arguments[1].body,visit);}return ts.visitEachChild(n,visit,context);}return ts.visitNode(root,visit);}]);const printed=ts.createPrinter().printNode(ts.EmitHint.Unspecified,transform.transformed[0],ast);assert.equal(createHash('sha256').update(printed).digest('hex'),hash,name);transform.dispose();}});
test('sync replay stays synchronous and errors retain object identity',async()=>{let observed;const marker=new Error('private detail must not leak');await withPrivateRegistryObservation(()=>{assert.equal(measurePrivateRegistryPhaseSync('registry-replay',()=>17),17);assert.throws(()=>measurePrivateRegistryPhaseSync('registry-replay',()=>{throw marker}),e=>e===marker);return 2;},{flightId:'a'.repeat(32),role:'owner',observer:r=>observed=r});assert.equal(observed.phases['registry-replay'].count,2);assert.doesNotMatch(JSON.stringify(observed),/private detail/);});
test('nonregistry calls remain uninstrumented and synchronous',()=>{const v={};assert.equal(measurePrivateRegistryPhase('registry-block-rpc',()=>v),v);assert.equal(measurePrivateRegistryPhaseSync('registry-replay',()=>v),v);});
test('owner and joiner keep distinct request identity, share one unchanged build and clear settled flights',async()=>{let builds=0,release;const receipts=[];const map=new Map();const observe=(run,options)=>withPrivateRegistryObservation(run,{...options,observer:r=>receipts.push(r)});const context=vm.createContext({REGISTRY_PARITY_INFLIGHT:map,privateRegistryObservationId,withPrivateRegistryObservation:observe,measurePrivateRegistryPhase,buildInternalRegistryParityPayload:async()=>{builds++;await new Promise(r=>release=r);return{proof:'unchanged'};}});const run=new vm.Script(fn('internalRegistryParityPayload').getText(ast)+'\ninternalRegistryParityPayload').runInContext(context);const a=withPrivateRequestContext(()=>run('livenet'));const b=withPrivateRequestContext(()=>run('livenet'));assert.equal(builds,1);release();const [x,y]=await Promise.all([a,b]);assert.equal(x,y);assert.equal(map.size,0);assert.equal(receipts.length,2);const owner=receipts.find(r=>r.registryRole==='owner'),joiner=receipts.find(r=>r.registryRole==='joiner');assert.equal(owner.registryFlightId,joiner.registryFlightId);assert.notEqual(owner.requestId,joiner.requestId);assert.equal(owner.phases['registry-build'].count,1);assert.equal(joiner.phases['registry-join-wait'].count,1);assert.equal(privateReadContext().registryRole,undefined);});
test('failures propagate unchanged, do not cache refusals, and diagnostic failures cannot change result',async()=>{const marker=new Error('unchanged');const map=new Map();const context=vm.createContext({REGISTRY_PARITY_INFLIGHT:map,privateRegistryObservationId,withPrivateRegistryObservation:(r,o)=>withPrivateRegistryObservation(r,{...o,observer:()=>{throw Error('observer');}}),measurePrivateRegistryPhase,buildInternalRegistryParityPayload:async()=>{throw marker;}});const run=new vm.Script(fn('internalRegistryParityPayload').getText(ast)+'\ninternalRegistryParityPayload').runInContext(context);await assert.rejects(run('livenet'),e=>e===marker&&e.statusCode===503);assert.equal(map.size,0);for(const observer of [()=>{throw Error('observer');},()=>Promise.reject(Error('observer'))])assert.equal(await withPrivateRegistryObservation(()=>19,{observer}),19);});
test('parallel hydration aggregates bounded numeric counts without logging identifiers',async()=>{let out;await withPrivateRegistryObservation(()=>Promise.all([1,2,3].map(()=>measurePrivateRegistryPhase('registry-transaction-rpc',()=>pause(5)))),{flightId:'b'.repeat(32),role:'owner',observer:r=>out=r});assert.equal(out.phases['registry-transaction-rpc'].count,3);assert.ok(out.phases['registry-transaction-rpc'].elapsedMs>=10);assert.doesNotMatch(JSON.stringify(out),/address|txid|SELECT|password/);});
test('registry summary routes are explicit while queries remain private, including disconnects',()=>{for(const route of ['/api/v1/registry-summary','/api/v1/ids-summary']){const response=new EventEmitter();Object.assign(response,{statusCode:200,headersSent:false,writableFinished:false,getHeader:()=>0});const rows=[];observePrivateHttpRequest({method:'GET',url:route+'?address=SECRET'},response,()=>response.emit('close'),{observer:r=>rows.push(r)});assert.equal(rows[0].route,route);assert.equal(rows[0].outcome,'transport-close-before-finish');assert.doesNotMatch(JSON.stringify(rows),/SECRET|address/);}});


test('owner or joiner transport abort does not cancel shared proof work or change later outcomes', async () => {
  for (const disconnected of ['owner', 'joiner']) {
    for (const failure of [false, true]) {
      const receipts = [], http = [], map = new Map();
      const payload = { privatePayload: 'never-log-transaction-or-address' };
      const error = Object.assign(new Error('never-log-private-error'), { statusCode: 409 });
      let release, builds = 0;
      const context = vm.createContext({
        REGISTRY_PARITY_INFLIGHT: map, privateRegistryObservationId, measurePrivateRegistryPhase,
        withPrivateRegistryObservation: (run, options) => withPrivateRegistryObservation(run, {
          ...options, observer: row => receipts.push(row),
        }),
        buildInternalRegistryParityPayload: async () => {
          builds++;
          await new Promise(resolve => { release = resolve; });
          if (failure) throw error;
          return payload;
        },
      });
      const run = new vm.Script(fn('internalRegistryParityPayload').getText(ast) + '\ninternalRegistryParityPayload').runInContext(context);
      const callers = {};
      for (const role of ['owner', 'joiner']) {
        const response = new EventEmitter();
        Object.assign(response, { statusCode: 200, headersSent: false, writableFinished: false, getHeader: () => 0 });
        const controller = new AbortController();
        const request = { method: 'GET', url: '/api/v1/registry-summary?fresh=1&address=never-log-query', signal: controller.signal };
        const promise = observePrivateHttpRequest(request, response, () => run('livenet'), { observer: row => http.push(row) });
        callers[role] = { response, controller, promise };
      }
      const settled = Promise.allSettled(Object.values(callers).map(caller => caller.promise));
      callers[disconnected].controller.abort();
      callers[disconnected].response.emit('close');
      await Promise.resolve();
      assert.equal(builds, 1);
      assert.equal(map.size, 1);
      assert.equal(receipts.length, 0);
      assert.equal(http.length, 1);
      assert.equal(http[0].outcome, 'transport-close-before-finish');
      release();
      for (const result of await settled) {
        assert.equal(result.status, failure ? 'rejected' : 'fulfilled');
        assert.equal(failure ? result.reason : result.value, failure ? error : payload);
      }
      assert.equal(error.statusCode, 409);
      assert.equal(map.size, 0);
      assert.equal(receipts.length, 2);
      assert.equal(new Set(receipts.map(row => row.registryFlightId)).size, 1);
      assert.equal(new Set(receipts.map(row => row.requestId)).size, 2);
      assert.doesNotMatch(JSON.stringify([...receipts, ...http]), /never-log|privatePayload|address=/u);
    }
  }
});

test('numeric phase aggregates and phase names remain bounded without payload capture', async () => {
  const observationSource = readFileSync(new URL('../server/wallet-read-observation.mjs', import.meta.url), 'utf8');
  const observationAst = ts.createSourceFile('observation.mjs', observationSource, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
  const observedFunction = name => observationAst.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === name).getText(observationAst).replace(/^export\s+/u, '');
  const scope = { totals: new Map([
    ['registry-transaction-rpc', { count: 1_000_000, elapsedMs: 86_400_000 }],
    ['registry-replay', { count: 1_000_000, elapsedMs: 86_400_000 }],
  ]) };
  let clock = 0;
  const context = vm.createContext({
    timingScope: { getStore: () => scope },
    privateReadContext: () => ({ registryRole: 'owner' }),
    phases: new Set(['registry-transaction-rpc', 'registry-replay']),
    performance: { now: () => (clock += 1e12) },
  });
  const helpers = new vm.Script([
    observedFunction('measurePrivatePhase'),
    observedFunction('measurePrivateRegistryPhase'),
    observedFunction('measurePrivateRegistryPhaseSync'),
    '({ measurePrivateRegistryPhase, measurePrivateRegistryPhaseSync })',
  ].join('\n')).runInContext(context);
  const marker = {};
  assert.equal(await helpers.measurePrivateRegistryPhase('registry-transaction-rpc', () => marker), marker);
  assert.equal(helpers.measurePrivateRegistryPhaseSync('registry-replay', () => marker), marker);
  assert.equal(await helpers.measurePrivateRegistryPhase('never-log-unknown-phase', () => marker), marker);
  assert.equal(helpers.measurePrivateRegistryPhaseSync('never-log-unknown-phase', () => marker), marker);
  assert.equal(scope.totals.size, 2);
  for (const aggregate of scope.totals.values()) {
    assert.equal(aggregate.count, 1_000_000);
    assert.equal(aggregate.elapsedMs, 86_400_000);
    assert.deepEqual(Object.keys(aggregate), ['count', 'elapsedMs']);
  }
});

test('invalid observation identity is omitted and role never copies untrusted text', async () => {
  let result;
  await withPrivateRegistryObservation(() => measurePrivateRegistryPhase('registry-build', () => 11), {
    flightId: 'never-log-private-identity', role: 'never-log-private-role', observer: row => { result = row; },
  });
  assert.equal(result.registryRole, 'owner');
  assert.equal(result.work, 'registry-owner');
  assert.equal(Object.hasOwn(result, 'registryFlightId'), false);
  assert.doesNotMatch(JSON.stringify(result), /never-log/u);
});

test('optional live API comparison preserves current proof build and hydration ASTs', {
  skip: !process.env.POW_REGISTRY_TIMING_LIVE_API_FILE,
}, () => {
  const live = ts.createSourceFile('live-api.mjs', readFileSync(process.env.POW_REGISTRY_TIMING_LIVE_API_FILE, 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
  for (const [name, expected] of Object.entries(hashes)) {
    const node = live.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === name);
    assert.ok(node, name);
    const printed = ts.createPrinter().printNode(ts.EmitHint.Unspecified, node, live);
    assert.equal(createHash('sha256').update(printed).digest('hex'), expected, name);
  }
});
