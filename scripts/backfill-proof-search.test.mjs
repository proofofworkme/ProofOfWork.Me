import assert from 'node:assert/strict';
import {test} from 'node:test';
import {runSearchBackfill,searchCoreVerifier} from './backfill-proof-search.mjs';

const HASH='a'.repeat(64);
function poolFor(query) {
  const calls=[],client={query:async(sql,args)=>{calls.push({sql,args});return query(sql,args);},release(){calls.push({released:true});}};
  return {pool:{connect:async()=>client},calls};
}
test('a simultaneous non-gating job yields the lock without reading or changing protocol state',async()=>{
  const {pool,calls}=poolFor(async sql=>({rows:sql.includes('pg_try_advisory_lock')?[{locked:false}]:[]}));
  const result=await runSearchBackfill({pool,verifyCheckpoint:async()=>{throw new Error('must not call Core');}});
  assert.equal(result.busy,true);
  assert.equal(calls.some(({sql})=>sql?.includes('INSERT')||sql?.includes('UPDATE')),false);
  assert.equal(calls.at(-1).released,true);
});
test('a mismatched checkpoint fails before creating a derived generation',async()=>{
  const {pool,calls}=poolFor(async sql=>{
    if(sql.includes('pg_try_advisory_lock'))return {rows:[{locked:true}]};
    if(sql.includes('ledger_snapshots'))return {rows:[{height:969829,hash:HASH}]};
    if(sql.includes('FROM proof_indexer.blocks'))return {rowCount:1,rows:[{}]};
    return {rows:[]};
  });
  await assert.rejects(()=>runSearchBackfill({pool,verifyCheckpoint:async()=> 'b'.repeat(64)}),error=>error.details?.code==='SEARCH_CHECKPOINT_CHANGED');
  assert.equal(calls.some(({sql})=>sql?.includes('INSERT')||sql?.includes('UPDATE')),false);
  assert.ok(calls.some(({sql})=>sql?.includes('pg_advisory_unlock')));
});
test('an unchanged confirmed and volatile corpus keeps its existing ready generation',async()=>{
  const witness={total:1,confirmed:1,confirmedRecords:1,canonicalHash:HASH,volatileHashes:{},missingRawTransactions:0,missingRawCarriers:0};
  const {pool,calls}=poolFor(async sql=>{
    if(sql.includes('pg_try_advisory_lock'))return {rows:[{locked:true}]};
    if(sql.includes('ledger_snapshots'))return {rows:[{height:969829,hash:HASH}]};
    if(sql.includes('FROM proof_indexer.blocks'))return {rowCount:1,rows:[{}]};
    if(sql.includes('hashes AS MATERIALIZED'))return {rows:[{total:1,confirmed:1,confirmed_records:1,canonical_hash:HASH,volatile_hashes:{},missing_raw_transactions:0}]};
    if(sql.includes('raw_outputs AS'))return {rows:[{missing:0}]};
    if(sql.includes("state='ready' ORDER BY completed_at"))return {rows:[{run_id:'ready',checkpoint_height:969829,checkpoint_hash:HASH,source_witness:witness}]};
    return {rows:[]};
  });
  const result=await runSearchBackfill({pool,verifyCheckpoint:async()=>HASH});
  assert.equal(result.unchanged,true);
  assert.equal(result.ready,true);
  assert.equal(calls.some(({sql})=>sql?.includes('INSERT INTO')),false);
  assert.ok(calls.find(({sql})=>sql?.startsWith('DELETE FROM proof_indexer.search_runs')));
});
test('Core verification rejects missing configuration without disclosing credentials',async()=>{
  await assert.rejects(()=>searchCoreVerifier({BITCOIN_RPC_USER:'never-output',BITCOIN_RPC_PASSWORD:'never-output'})(969829),error=>!error.message.includes('never-output'));
});
