import test from 'node:test';
import assert from 'node:assert/strict';
import {pinServing,assertHeld,LEGACY_VERSION} from './pin-serving.mjs';
const run={run_id:'run-1',index_version:LEGACY_VERSION,state:'ready',checkpoint_height:123,checkpoint_hash:'a'.repeat(64)};
function fixture({existing,locked=true,selected=run,holdFailure=0}={}) {
 const calls=[];let holds=0;
 return {calls, args:{runId:'run-1',releaseId:'release-1',assertHold:async()=>{if(++holds===holdFailure)throw Error('hold changed');},
 client:{query:async(sql,args)=>{calls.push([sql,args]);
 if(sql.includes('pg_try_advisory'))return {rows:[{locked}]};
 if(sql.includes('FROM proof_indexer.search_runs'))return {rows:selected?[selected]:[]};
 if(sql.includes('FROM proof_indexer.search_serving_pins'))return {rows:existing?[existing]:[]};
 return {rows:[]};}}}};
}
test('pin exact latest legacy generation only after hold and builder exclusion',async()=>{
 const f=fixture();const result=await pinServing(f.args);assert.equal(result.writerEnabled,false);
 assert.equal(f.calls.filter(([s])=>s.startsWith('INSERT')).length,1);assert.equal(f.calls.at(-1)[0],'COMMIT');
});
test('same release retry is idempotent',async()=>{
 const f=fixture({existing:{run_id:'run-1',reason:'linked-publish-prebuild:release-1'}});
 assert.equal((await pinServing(f.args)).alreadyPinned,true);assert.ok(!f.calls.some(([s])=>s.startsWith('INSERT')));
});
for(const [name,options] of Object.entries({foreignPin:{existing:{run_id:'other',reason:'foreign'}},activeBuilder:{locked:false},
 staleRun:{selected:{...run,run_id:'new'}},noRun:{selected:null},holdChanged:{holdFailure:2}})) {
 test(name+' fails closed and rolls back',async()=>{const f=fixture(options);await assert.rejects(pinServing(f.args));assert.equal(f.calls.at(-1)[0],'ROLLBACK');});
}
test('bad identity and absent hold do not begin transaction',async()=>{
 for(const override of [{network:'testnet'},{runId:'../bad'},{releaseId:''}]){const f=fixture();await assert.rejects(pinServing({...f.args,...override}));assert.equal(f.calls.length,0);}
 const f=fixture({holdFailure:1});await assert.rejects(pinServing(f.args));assert.equal(f.calls.length,0);
});
test('timer waiting, builder running, unknown or incomplete states are not held',()=>{
 const good={'proofofwork-search-index.service':{ActiveState:'inactive',SubState:'dead',MainPID:'0'},'proofofwork-search-index.timer':{ActiveState:'inactive',SubState:'dead',MainPID:'0'}};
 assert.doesNotThrow(()=>assertHeld(good));
 for(const field of ['ActiveState','SubState','MainPID']){const bad=structuredClone(good);bad['proofofwork-search-index.service'][field]='other';assert.throws(()=>assertHeld(bad));}
 assert.throws(()=>assertHeld({}));
});
