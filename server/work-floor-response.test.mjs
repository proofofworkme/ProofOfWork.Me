import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
const source=readFileSync(new URL('./proof-api.mjs',import.meta.url),'utf8');
function extract(start,end){const a=source.indexOf(start),b=source.indexOf(end,a);assert.ok(a>0&&b>a);return source.slice(a,b);}
function runtime(reader){const calls=[];const context=vm.createContext({cachedWorkFloorPayload:reader,
 summaryPayloadWithCanonicalProvenance:async(payload,network,fresh,route)=>{calls.push({stage:'canonical',network,fresh,route});return {...payload,canonical:true};},
 withWorkMarketplaceV4Metadata:async(payload,network)=>{calls.push({stage:'market',network});return {...payload,market:true};},
});vm.runInContext('const IN_FLIGHT_SUMMARY_READS = new Map();\n'+extract('async function deduplicatedSummaryRead(', '\nserver.headersTimeout')+'\n'+extract('async function workFloorResponsePayload(', '\nasync function fastLivenetWorkSummaryPayload')+'\nthis.read=workFloorResponsePayload;',context);return {read:context.read,calls};}
test('concurrent WORK floor reads share the full canonical response, with no settled cache',async()=>{
 let finish,count=0;const blocked=new Promise(resolve=>{finish=resolve;});
 const api=runtime(async()=>{count++;await blocked;return {floorQ8:'123456789012345678901234567890',snapshotId:String(count)};});
 const pending=Array.from({length:8},()=>api.read('livenet',false));await Promise.resolve();assert.equal(count,1);finish();
 const values=await Promise.all(pending);assert.ok(values.every(v=>v===values[0]));assert.equal(values[0].floorQ8,'123456789012345678901234567890');assert.equal(values[0].canonical,true);assert.equal(values[0].market,true);assert.equal(api.calls.length,2);
 const next=await api.read('livenet',false);assert.equal(count,2);assert.equal(next.snapshotId,'2');assert.equal(api.calls.length,4);
});
test('fresh and current WORK reads and networks never share an in-flight result',async()=>{
 let finish;const blocked=new Promise(resolve=>{finish=resolve;});const calls=[];const api=runtime(async(network,fresh)=>{calls.push([network,fresh]);await blocked;return {network,fresh};});
 const pending=[api.read('livenet',false),api.read('livenet',true),api.read('testnet',false)];await Promise.resolve();assert.deepEqual(calls,[['livenet',false],['livenet',true],['testnet',false]]);finish();
 const values=await Promise.all(pending);assert.equal(values[1].fresh,true);assert.equal(values[2].network,'testnet');assert.ok(api.calls.filter(c=>c.stage==='canonical').every(c=>c.route==='work-floor'));
});
test('failed WORK reads preserve the error and a subsequent request retries all checks',async()=>{
 let attempts=0;const failure=Object.assign(new Error('canonical checkpoint changed'),{statusCode:503});const api=runtime(async()=>{if(++attempts===1)throw failure;return {floorQ8:'1'};});
 const results=await Promise.allSettled([api.read('livenet'),api.read('livenet')]);assert.equal(attempts,1);assert.ok(results.every(r=>r.status==='rejected'&&r.reason===failure));assert.equal(api.calls.length,0);
 assert.equal((await api.read('livenet')).floorQ8,'1');assert.equal(attempts,2);assert.equal(api.calls.length,2);
});
