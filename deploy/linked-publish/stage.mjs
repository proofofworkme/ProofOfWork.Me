#!/usr/bin/env node
import {execFileSync} from 'node:child_process';
import {createProofIndexPool} from '../../server/db/postgres.mjs';
import {applySearchSchema,runSearchBackfill,searchCoreVerifier} from '../../scripts/backfill-proof-search.mjs';
import {readSearchCheckpoint,SEARCH_INDEX_VERSION} from '../../server/search-projection.mjs';
import {searchPayload,linkedArticleSearchWriterReadiness} from '../../server/db/search-reader.mjs';
import {censusRawLinkedHistory} from './census.mjs';
import {pinServing,assertHeld,LEGACY_VERSION} from './pin-serving.mjs';
const [mode,releaseId,runId]=process.argv.slice(2);
if(!['schema','pin','build','check','unpin','census'].includes(mode) || !/^[a-zA-Z0-9-]{1,80}$/.test(releaseId??''))throw Error('Invalid stage mode/release');
const assertHold=async()=>{
 const states={};
 for(const unit of ['proofofwork-search-index.service','proofofwork-search-index.timer']){
  const text=execFileSync('/usr/bin/systemctl',['show',unit,'--property=ActiveState','--property=SubState','--property=MainPID'],{encoding:'utf8',timeout:5000,maxBuffer:8192});
  states[unit]=Object.fromEntries(text.trim().split('\n').map(line=>line.split('=')));
 }
 assertHeld(states);
};
const pool=createProofIndexPool({env:{...process.env,POW_INDEX_DB_POOL_MAX:'1',POW_INDEX_DB_STATEMENT_TIMEOUT_MS:'15000',POW_INDEX_DB_APP_NAME:'linked-publish-stage'}});
try {
 await assertHold();let result;
 if(mode==='census')result=await censusRawLinkedHistory(pool,searchCoreVerifier());
 if(mode==='schema')result=await applySearchSchema(pool);
 if(mode==='pin'){
  const client=await pool.connect();try{
   const row=(await client.query("SELECT run_id FROM proof_indexer.search_runs WHERE network='livenet' AND index_version=$1 AND state='ready' ORDER BY completed_at DESC LIMIT 1",[LEGACY_VERSION])).rows[0];
   if(!row)throw Error('No legacy serving generation');
   result=await pinServing({client,runId:row.run_id,releaseId,assertHold});
  }finally{client.release();}
 }
 if(mode==='build')result=await runSearchBackfill({pool,network:'livenet',batchSize:200,maxBatches:20,budgetMs:30000,verifyCheckpoint:searchCoreVerifier()});
 if(mode==='check'){
  const client=await pool.connect();let checkpoint;
  try{checkpoint=await readSearchCheckpoint(client,'livenet');}finally{client.release();}
  const options={pool,verifyCheckpoint:searchCoreVerifier()};
  const response=await searchPayload('livenet',new URLSearchParams({limit:'1'}),options);
  const search=await linkedArticleSearchWriterReadiness('livenet',checkpoint,options);
  if(response.coverage?.ready!==true || search.ready!==true || search.indexVersion!==SEARCH_INDEX_VERSION)throw Error('Staged Search is incomplete');
  result={ok:true,ready:true,indexVersion:SEARCH_INDEX_VERSION,coverage:response.coverage,search};
 }
 if(mode==='unpin'){
  if(runId!==undefined && !/^[a-zA-Z0-9-]{1,80}$/.test(runId))throw Error('Invalid prebuild pin');
  const client=await pool.connect();try{
   await client.query('BEGIN');
   await client.query("SET LOCAL lock_timeout='1s'");
   const locked=await client.query("SELECT pg_try_advisory_xact_lock(hashtext('proof-search-v1'),hashtext('livenet')) AS locked");
   if(locked.rows[0]?.locked!==true)throw Error('Builder active during pin recovery');
   const row=(await client.query("SELECT run_id,reason FROM proof_indexer.search_serving_pins WHERE network='livenet' FOR UPDATE")).rows[0];
   if(row && ((runId && row.run_id!==runId) || row.reason!=='linked-publish-prebuild:'+releaseId))throw Error('Pin ownership changed');
   await assertHold();
   if(row){
    const removed=await client.query("DELETE FROM proof_indexer.search_serving_pins WHERE network='livenet' AND run_id=$1 AND reason=$2 RETURNING run_id",[row.run_id,row.reason]);
    if(removed.rowCount!==1)throw Error('Pin recovery uncertain');
   }
   await client.query('COMMIT');result={ok:true,removedRunId:row?.run_id??null,reason:row?.reason??null,recoverable:true};
  }catch(error){await client.query('ROLLBACK').catch(()=>{});throw error;}finally{client.release();}
 }
 await assertHold();console.log(JSON.stringify(result));
}catch(error){
 console.log(JSON.stringify({ok:false,code:error.details?.code??'LINKED_STAGE_FAILED',errorClass:error.name}));
 process.exitCode=1;
}finally{await pool.end();}
