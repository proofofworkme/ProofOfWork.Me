import assert from 'node:assert/strict';
import {test} from 'node:test';
import {runSearchBackfill,searchCoreVerifier,copyConfirmedSearchBatch} from './backfill-proof-search.mjs';

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
test('confirmed generation copies resume by their own durable cursor after a failed statement',async()=>{
  const source=['event:1','event:10','event:2','event:20','transaction:'+HASH];
  let durable={ids:[],copyCursor:'',sourceCursor:'source-progress',projectedCount:7},pending,fail=false;
  const client={query:async(sql,args)=>{
    if(sql==='BEGIN'){pending=structuredClone(durable);return {rows:[]};}
    if(sql==='ROLLBACK'){pending=undefined;return {rows:[]};}
    if(sql==='COMMIT'){durable=pending;pending=undefined;return {rows:[]};}
    if(sql.includes('WITH copied AS')){
      if(fail){fail=false;const error=new Error('bounded copy canceled');error.code='57014';throw error;}
      const selected=source.filter(id=>id>args[3]).slice(0,args[4]);pending.ids.push(...selected);
      return {rows:[{count:selected.length,cursor:selected.at(-1)??null}]};
    }
    if(sql.includes('copy_cursor=$2')){pending.copyCursor=args[1];pending.complete=args[2];return {rows:[]};}
    throw new Error('unexpected copy operation');
  }};
  const options={network:'livenet',runId:'building',fromRunId:'ready',batchSize:2};
  const first=await copyConfirmedSearchBatch(client,options);
  assert.deepEqual(first,{count:2,cursor:'event:10',complete:false});
  fail=true;
  await assert.rejects(()=>copyConfirmedSearchBatch(client,{...options,after:durable.copyCursor}),error=>error.code==='57014');
  assert.deepEqual(durable.ids,['event:1','event:10']);
  assert.equal(durable.copyCursor,'event:10');
  const second=await copyConfirmedSearchBatch(client,{...options,after:durable.copyCursor});
  assert.equal(second.cursor,'event:20');
  const third=await copyConfirmedSearchBatch(client,{...options,after:durable.copyCursor});
  assert.equal(third.complete,true);
  assert.deepEqual(durable.ids,source);
  assert.equal(new Set(durable.ids).size,source.length);
  assert.equal(durable.sourceCursor,'source-progress');
  assert.equal(durable.projectedCount,7);
  assert.deepEqual(source,['event:1','event:10','event:2','event:20','transaction:'+HASH]);
});
test('an exact-size final copy batch finishes only after a bounded empty read',async()=>{
  const queries=[];
  const client={query:async(sql,args)=>{
    queries.push({sql,args});
    return {rows:sql.includes('WITH copied AS')?[{count:0,cursor:null}]:[]};
  }};
  const result=await copyConfirmedSearchBatch(client,{network:'livenet',runId:'building',fromRunId:'ready',after:'event:200',batchSize:200});
  assert.deepEqual(result,{count:0,cursor:'event:200',complete:true});
  assert.deepEqual(queries.find(row=>row.sql.includes('copy_cursor=$2')).args,['building','event:200',true]);
});
