import assert from 'node:assert/strict';
import {test} from 'node:test';
import {linkedPublishSearchCandidate,linkedSearchCapacity,linkedSearchParserState,
 pruneUnreferencedLinkedSearch,LINKED_SEARCH_MAX_RETAINED_BYTES,LINKED_SEARCH_MAX_PHYSICAL_BYTES,
 LINKED_SEARCH_MIN_FREE_BYTES,LINKED_SEARCH_SCRATCH_RESERVE_BYTES} from './search-linked-publish.mjs';
const free=bytes=>async()=>({bavail:BigInt(bytes),bsize:1n});
const capacity=(bodies=0,postings=0,physical=0)=>({query:async()=>({rows:[{bodies:String(bodies),postings:String(postings),physical:String(physical)}]})});
test('only a valid canonical confirmed linked article event requests body indexing',()=>{
 const s={sourceClass:'event',protocol:'pwb1',kind:'boost-post',valid:true,canonical:true,status:'confirmed',payload:{article:{v:2}}};
 assert.equal(linkedPublishSearchCandidate(s),true);
 for(const patch of [{sourceClass:'carrier'},{valid:false},{canonical:false},{status:'pending'},{kind:'boost-reply'},{payload:{article:{v:1}}}])
  assert.equal(linkedPublishSearchCandidate({...s,...patch}),false);
});
test('capacity reserves the whole prospective materialization and never assumes compression',async()=>{
 const result=await linkedSearchCapacity(capacity(100,200,400),{reserveBytes:500,probe:free(2**40)});
 assert.equal(result.retainedBytes,300);assert.equal(result.physicalBytes,400);
 await assert.rejects(()=>linkedSearchCapacity(capacity(LINKED_SEARCH_MAX_RETAINED_BYTES-10,0,0),{reserveBytes:11,probe:free(2**40)}),
  e=>e.details.code==='SEARCH_LINKED_CAPACITY');
});
test('dead physical space cannot be mislabeled reclaimed after logical deletion',async()=>{
 await assert.rejects(()=>linkedSearchCapacity(capacity(0,0,LINKED_SEARCH_MAX_PHYSICAL_BYTES+1),{probe:free(2**40)}),
  e=>e.details.code==='SEARCH_LINKED_PHYSICAL_CAPACITY'&&e.message.includes('compaction'));
 const result=await linkedSearchCapacity(capacity(0,0,1024),{probe:free(2**40)});
 assert.equal(result.physicalBytes,1024);assert.equal(result.retainedBytes,0);
});
test('filesystem reserve failure is an operational unavailable error, not invalid content',async()=>{
 await assert.rejects(()=>linkedSearchCapacity(capacity(),{probe:free(LINKED_SEARCH_MIN_FREE_BYTES+LINKED_SEARCH_SCRATCH_RESERVE_BYTES-1)}),
  e=>e.statusCode===503&&e.details.code==='SEARCH_LINKED_CAPACITY');
});
test('unsupported parser closes readiness rather than approximating token semantics',async()=>{
 await assert.rejects(()=>linkedSearchParserState({query:async()=>({rows:[{identity:'a'.repeat(64),supported:false}]})}));
 assert.equal(await linkedSearchParserState({query:async()=>({rows:[{identity:'a'.repeat(64),supported:true}]})}),'a'.repeat(64));
});
test('GC yields to an active materializer without deleting any derived rows',async()=>{
 const calls=[];const client={query:async sql=>{calls.push(sql);return {rows:[{locked:false}]};}};
 assert.deepEqual(await pruneUnreferencedLinkedSearch(client,'livenet'),{busy:true});
 assert.deepEqual(calls.filter(x=>x==='BEGIN'||x==='ROLLBACK'),['BEGIN','ROLLBACK']);
 assert.equal(calls.some(x=>x.startsWith('DELETE')),false);
});
test('GC removes only unreferenced postings then bodies in one transaction',async()=>{
 const calls=[];const client={query:async sql=>{calls.push(sql);return {rows:[{locked:true}],rowCount:1};}};
 assert.deepEqual(await pruneUnreferencedLinkedSearch(client,'livenet'),{postings:1,bodies:1});
 assert.equal(calls.at(-1),'COMMIT');
 const deletes=calls.filter(x=>x.startsWith('DELETE'));assert.equal(deletes.length,2);
 assert.ok(deletes[0].includes('NOT EXISTS')&&deletes[0].includes('search_linked_refs'));
 assert.ok(deletes[1].includes('NOT EXISTS')&&deletes[1].includes('search_linked_postings'));
 assert.equal(calls.some(x=>/DELETE.*(transactions|events|ledger)/u.test(x)),false);
});
test('GC failure rolls back and does not continue into body retirement',async()=>{
 const calls=[];const client={query:async sql=>{calls.push(sql);if(sql.startsWith('DELETE'))throw new Error('injected');return {rows:[{locked:true}]};}};
 await assert.rejects(()=>pruneUnreferencedLinkedSearch(client,'livenet'),/injected/);
 assert.equal(calls.at(-1),'ROLLBACK');assert.equal(calls.filter(x=>x.startsWith('DELETE')).length,1);
});
