import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { readFileSync } from 'node:fs';
import { canonicalSummaryReadClass, observePrivateHttpRequest, withPrivateRegistryObservation, measurePrivateRegistryPhase, withPrivatePhaseTimings, measurePrivatePhase } from '../server/wallet-read-observation.mjs';

test('summary class distinguishes effective modes without leaking request details', () => {
  const url = new URL('http://localhost/api/v1/internal/canonical-summary?storedExact=1&workProjectionTransport=v1&checkpointHash=secret&replayBindingId=private');
  assert.deepEqual(canonicalSummaryReadClass(url), { mode: 'stored-exact', transport: 'json', checkpointRequested: true });
  url.searchParams.delete('storedExact');
  assert.deepEqual(canonicalSummaryReadClass(url), { mode: 'live-build', transport: 'projection-v1', checkpointRequested: true });
  url.search = '?unexpected=secret';
  assert.deepEqual(canonicalSummaryReadClass(url), { mode: 'live-build', transport: 'json', checkpointRequested: false });
  url.pathname = '/api/v1/registry';
  assert.equal(canonicalSummaryReadClass(url), undefined);
});

test('HTTP receipt emits safe mode and leaves handler return value unchanged', () => {
  const response = new EventEmitter();
  response.statusCode = 200;
  response.getHeader = () => '12';
  let receipt;
  const value = {};
  assert.equal(observePrivateHttpRequest({method:'GET',url:'/api/v1/internal/canonical-summary?workProjectionTransport=v1&secret=hidden'},response,()=>{response.emit('finish');return value;},{observer:r=>{receipt=r;}}), value);
  assert.equal(receipt.summaryClass.transport, 'projection-v1');
  assert.equal(JSON.stringify(receipt).includes('hidden'), false);
});

test('new registry phases preserve results and failures; outside registry no diagnostics', async () => {
  const receipts=[];
  const failure=new Error('exact failure');
  const value={canonical:true};
  assert.equal(await measurePrivateRegistryPhase('registry-raw-transaction',()=>value),value);
  await withPrivateRegistryObservation(async()=>{
    assert.equal(await measurePrivateRegistryPhase('registry-hydration-admission',()=>value),value);
    await assert.rejects(measurePrivateRegistryPhase('registry-raw-transaction',()=>Promise.reject(failure)), e=>e===failure);
    assert.equal(await measurePrivateRegistryPhase('registry-prevouts',()=>value),value);
  },{observer:r=>receipts.push(r)});
  for(const name of ['registry-hydration-admission','registry-raw-transaction','registry-prevouts']) assert.equal(receipts[0].phases[name].count,1);
});

test('canonical build phases are grouped and observer errors never replace build failure', async()=>{
  const failure = new Error('checkpoint changed');
  let receipt;
  await assert.rejects(withPrivatePhaseTimings(()=>measurePrivatePhase('canonical-summary-build',async()=>{
    await measurePrivatePhase('canonical-summary-checkpoint-before',()=>1);
    await measurePrivatePhase('canonical-summary-ledger',()=>2);
    return measurePrivatePhase('canonical-summary-checkpoint-after',()=>Promise.reject(failure));
  }),r=>{receipt=r;throw new Error('observer');}),e=>e===failure);
  assert.equal(Object.keys(receipt.phases).length,4);
});

test('source retains proof freshness and instruments both checkpoint fences',()=>{
 const source=readFileSync(new URL('../server/proof-api.mjs',import.meta.url),'utf8');
 const section=source.slice(source.indexOf('async function internalCanonicalSummaryPayload('),source.indexOf('async function buildCanonicalLedgerPayload('));
 for(const phase of ['canonical-summary-build','canonical-summary-checkpoint-before','canonical-summary-ledger','canonical-summary-checkpoint-after']) assert.ok(section.includes('"'+phase+'"'));
 assert.ok(section.includes('after.tipHash !== before.tipHash'));
 const registry=source.slice(source.indexOf('async function buildInternalRegistryParityPayload('),source.indexOf('async function buildInternalRegistryParityPayload(')+4500);
 assert.match(registry,/bypassCache: true/);
 assert.match(registry,/cacheResult: false/);
});
