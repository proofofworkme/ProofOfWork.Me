import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import vm from 'node:vm';
const source=readFileSync(new URL('./proof-api.mjs',import.meta.url),'utf8');
function extract(name){const start=source.indexOf(`async function ${name}(`);assert(start>=0);const end=source.indexOf('\n}',start)+2;return source.slice(start,end);}
function fixture(read){const context=vm.createContext({structuredClone,IN_FLIGHT_SUMMARY_READS:new Map(),TOKEN_LISTING_LIFECYCLE_MATERIALIZATION_LIMIT:5000,proofIndexCreditListingsPayload:read});return vm.runInContext(`${extract('deduplicatedSummaryRead')}\n${extract('completeTokenListingRelationalRead')}\ncompleteTokenListingRelationalRead`,context);}
test('overlapping identical AMO reads materialize once, isolate mutations, and never reuse settled results',async()=>{
 let release,calls=0;const gate=new Promise(r=>release=r);let generation=0;
 const read=fixture(async(n,s,o)=>{calls++;assert.equal(o.requireComplete,true);assert.equal(o.limit,5000);await gate;return{items:[{amount:'900719925474099312345',priceSats:'546',terms:{nonce:'original'}}],generation:++generation};});
 const requests=Array.from({length:8},()=>read('livenet','work',''));await Promise.resolve();await Promise.resolve();assert.equal(calls,1);release();
 const results=await Promise.all(requests);assert.equal(calls,1);assert(results.every(p=>p.generation===1));results[0].items[0].terms.nonce='changed';assert.equal(results[1].items[0].terms.nonce,'original');assert.equal(results[1].items[0].amount,'900719925474099312345');
 assert.equal((await read('livenet','work','')).generation,2);assert.equal(calls,2);
});
test('network, asset and exact listing scopes remain separate',async()=>{
 let calls=0;const read=fixture(async()=>({call:++calls}));await Promise.all([read('livenet','work',''),read('testnet','work',''),read('livenet','powb',''),read('livenet','work','a'.repeat(64))]);assert.equal(calls,4);
});
test('shared failure is removed so subsequent reads can recover',async()=>{
 let calls=0;const read=fixture(async()=>{if(++calls===1)throw Error('index unavailable');return{ok:true};});const a=await Promise.allSettled([read('livenet','',''),read('livenet','','')]);assert(a.every(x=>x.status==='rejected'));assert.equal(calls,1);assert.equal((await read('livenet','','')).ok,true);assert.equal(calls,2);
});
