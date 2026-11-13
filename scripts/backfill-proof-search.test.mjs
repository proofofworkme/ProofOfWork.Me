import {confirmedBase,effectiveDocuments,SHARED_CONFIRMED_CURSOR} from '../server/search-generation-sharing.mjs';
import {searchPayload} from '../server/db/search-reader.mjs';
import {SEARCH_INDEX_VERSION} from '../server/search-projection.mjs';
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {runSearchBackfill,searchCoreVerifier,copyConfirmedSearchBatch,boundedSearchSourceBatch,storeSearchSourceBatch,pruneSearchGenerations} from './backfill-proof-search.mjs';

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
  const witness={linkedParserIdentity:HASH,total:1,confirmed:1,confirmedRecords:1,canonicalHash:HASH,volatileHashes:{},missingRawTransactions:0,missingRawCarriers:0};
  const {pool,calls}=poolFor(async sql=>{
    if(sql.includes('pg_try_advisory_lock'))return {rows:[{locked:true}]};
    if(sql.includes('ledger_snapshots'))return {rows:[{height:969829,hash:HASH}]};
    if(sql.includes('FROM proof_indexer.blocks'))return {rowCount:1,rows:[{}]};
    if(sql.includes('hashes AS MATERIALIZED'))return {rows:[{total:1,confirmed:1,confirmed_records:1,canonical_hash:HASH,volatile_hashes:{},missing_raw_transactions:0}]};
    if(sql.includes('raw_outputs AS'))return {rows:[{missing:0}]};
    if(sql.includes('search_simple_parser_identity'))return {rows:[{identity:HASH,supported:true}]};
    if(sql.includes('WITH expected AS'))return {rows:[{expected:0,qualified:0,references:0}]};
    if(sql.includes("state='ready' ORDER BY completed_at"))return {rows:[{run_id:'ready',checkpoint_height:969829,checkpoint_hash:HASH,source_witness:witness}]};
    return {rows:[]};
  });
  const result=await runSearchBackfill({pool,verifyCheckpoint:async()=>HASH});
  assert.equal(result.unchanged,true);
  assert.equal(result.ready,true);
  assert.equal(calls.some(({sql})=>sql?.includes('INSERT INTO')),false);
  assert.ok(calls.find(({sql})=>sql?.includes('DELETE FROM proof_indexer.search_runs')));
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
    if(sql.includes('SELECT count(*)::integer AS count FROM ('))return {rows:[{count:0}]};
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

test('incomplete linked references force a full rebuild rather than unchanged or copied history',async()=>{
  const witness={linkedParserIdentity:HASH,total:1,confirmed:1,confirmedRecords:1,canonicalHash:HASH,volatileHashes:{},missingRawTransactions:0,missingRawCarriers:0};
  let inserted;
  const {pool}=poolFor(async(sql,args)=>{
    if(sql.includes('pg_try_advisory_lock'))return {rows:[{locked:true}]};
    if(sql.includes('ledger_snapshots'))return {rows:[{height:969829,hash:HASH}]};
    if(sql.includes('FROM proof_indexer.blocks'))return {rowCount:1,rows:[{}]};
    if(sql.includes('hashes AS MATERIALIZED'))return {rows:[{total:1,confirmed:1,confirmed_records:1,canonical_hash:HASH,volatile_hashes:{},missing_raw_transactions:0}]};
    if(sql.includes('raw_outputs AS'))return {rows:[{missing:0}]};
    if(sql.includes('search_simple_parser_identity'))return {rows:[{identity:HASH,supported:true}]};
    if(sql.includes('WITH expected AS'))return {rows:[{expected:1,qualified:0,references:0}]};
    if(sql.includes("state='ready' ORDER BY completed_at"))return {rows:[{run_id:'ready',checkpoint_height:969829,checkpoint_hash:HASH,source_witness:witness}]};
    if(sql.includes('INSERT INTO proof_indexer.search_runs')){inserted=args;throw new Error('fixture stopped after rebuild decision');}
    return {rows:[]};
  });
  await assert.rejects(()=>runSearchBackfill({pool,verifyCheckpoint:async()=>HASH}),/fixture stopped/);
  assert.equal(inserted[6],false);
  assert.equal(inserted[7],0);
  assert.equal(inserted[8],null);
  assert.equal(inserted[9],true);
});

test('changed parser identity forces a full rebuild even when there are no linked rows',async()=>{
  const witness={linkedParserIdentity:HASH,total:1,confirmed:1,confirmedRecords:1,canonicalHash:HASH,volatileHashes:{},missingRawTransactions:0,missingRawCarriers:0};
  let inserted;
  const {pool}=poolFor(async(sql,args)=>{
    if(sql.includes('pg_try_advisory_lock'))return {rows:[{locked:true}]};
    if(sql.includes('ledger_snapshots'))return {rows:[{height:969829,hash:HASH}]};
    if(sql.includes('FROM proof_indexer.blocks'))return {rowCount:1,rows:[{}]};
    if(sql.includes('hashes AS MATERIALIZED'))return {rows:[{total:1,confirmed:1,confirmed_records:1,canonical_hash:HASH,volatile_hashes:{},missing_raw_transactions:0}]};
    if(sql.includes('raw_outputs AS'))return {rows:[{missing:0}]};
    if(sql.includes('search_simple_parser_identity'))return {rows:[{identity:HASH,supported:true}]};
    if(sql.includes('WITH expected AS'))return {rows:[{expected:0,qualified:0,references:0}]};
    if(sql.includes("state='ready' ORDER BY completed_at"))return {rows:[{run_id:'ready',checkpoint_height:969829,checkpoint_hash:HASH,source_witness:{...witness,linkedParserIdentity:'b'.repeat(64)}}]};
    if(sql.includes('INSERT INTO proof_indexer.search_runs')){inserted=args;throw new Error('fixture stopped after rebuild decision');}
    return {rows:[]};
  });
  await assert.rejects(()=>runSearchBackfill({pool,verifyCheckpoint:async()=>HASH}),/fixture stopped/);
  assert.equal(inserted[6],false);
  assert.equal(inserted[7],0);
  assert.equal(inserted[8],null);
  assert.equal(inserted[9],true);
});


const linkedSourceRow=id=>({id,source_hash:HASH,source:{id,txid:HASH,sourceClass:'event',
  protocol:'pwb1',kind:'boost-post',valid:true,canonical:true,status:'confirmed',payload:{article:{v:2}}}});
const ordinarySourceRow=id=>({id,source_hash:HASH,source:{id,txid:HASH,sourceClass:'event',
  protocol:'pwm1',kind:'mail',valid:true,canonical:true,status:'confirmed',payload:{text:'ordinary'}}});
test('source batches stop after one linked article and never exhaust an unread tail',()=>{
  const a=ordinarySourceRow('event:1'),b=linkedSourceRow('event:2'),c=linkedSourceRow('event:3'),d=ordinarySourceRow('event:4');
  assert.deepEqual(boundedSearchSourceBatch([a,b,c,d],200),{rows:[a,b],exhausted:false});
  assert.deepEqual(boundedSearchSourceBatch([c,d],200),{rows:[c],exhausted:false});
  assert.deepEqual(boundedSearchSourceBatch([d],200),{rows:[d],exhausted:true});
  assert.deepEqual(boundedSearchSourceBatch([a,b],200),{rows:[a,b],exhausted:true});
  assert.deepEqual(boundedSearchSourceBatch([a,b],2),{rows:[a,b],exhausted:false});
  assert.deepEqual(boundedSearchSourceBatch([],200),{rows:[],exhausted:true});
});
test('repeated bounded source pages preserve keyset order and make progress across many linked bodies',()=>{
  const source=Array.from({length:30},(_,i)=>i%3===0?ordinarySourceRow('event:'+String(i).padStart(3,'0')):linkedSourceRow('event:'+String(i).padStart(3,'0')));
  let cursor='',complete=false;
  const committed=[];
  for(let invocation=0;!complete&&invocation<100;invocation++){
    const page=source.filter(row=>row.id>cursor).slice(0,200);
    const selected=boundedSearchSourceBatch(page,200);
    assert.ok(selected.rows.filter(row=>row.source.protocol==='pwb1').length<=1);
    committed.push(...selected.rows.map(row=>row.id));
    if(selected.rows.length)cursor=selected.rows.at(-1).id;
    complete=selected.exhausted;
  }
  assert.equal(complete,true);
  assert.deepEqual(committed,source.map(row=>row.id));
  assert.equal(new Set(committed).size,source.length);
});
test('interrupted source progress rolls back documents and resumes without skipping or duplicating rows',async()=>{
  let durable={ids:[],cursor:'',projected:0},pending,failAt='';
  const client={query:async(sql,args)=>{
    if(sql==='BEGIN'){assert.equal(pending,undefined);pending=structuredClone(durable);return {rows:[]};}
    if(sql==='ROLLBACK'){pending=undefined;return {rows:[]};}
    if(sql==='COMMIT'){durable=pending;pending=undefined;return {rows:[]};}
    if(sql.startsWith('INSERT INTO proof_indexer.search_documents')){
      for(let offset=0;offset<args.length;offset+=19)pending.ids.push(args[offset+2]);
      if(failAt==='documents')throw Object.assign(new Error('synthetic interruption'),{code:'57014'});
      return {rows:[]};
    }
    if(sql.startsWith('UPDATE proof_indexer.search_runs SET source_cursor')){
      pending.cursor=args[1];pending.projected+=args[2];
      if(failAt==='cursor')throw Object.assign(new Error('synthetic interruption'),{code:'57014'});
      return {rows:[]};
    }
    throw new Error('Unexpected source operation: '+sql);
  }};
  const options={network:'livenet',runId:'building'};
  const rows=[ordinarySourceRow('event:1'),ordinarySourceRow('event:2')];
  for(const stage of ['documents','cursor']){
    failAt=stage;
    await assert.rejects(()=>storeSearchSourceBatch(client,{...options,rows}),error=>error.code==='57014');
    assert.deepEqual(durable,{ids:[],cursor:'',projected:0});
  }
  failAt='';
  assert.deepEqual(await storeSearchSourceBatch(client,{...options,rows}),{cursor:'event:2',count:2});
  assert.deepEqual(durable,{ids:['event:1','event:2'],cursor:'event:2',projected:2});
  await storeSearchSourceBatch(client,{...options,rows:[ordinarySourceRow('event:3')]});
  assert.deepEqual(durable,{ids:['event:1','event:2','event:3'],cursor:'event:3',projected:3});
  await assert.rejects(()=>storeSearchSourceBatch(client,{...options,rows:[]}),/empty/);
});


function sharedFixture() {
 const witness={linkedParserIdentity:HASH,total:1,confirmed:1,confirmedRecords:1,canonicalHash:HASH,
   volatileHashes:{},missingRawTransactions:0,missingRawCarriers:0};
 const base={run_id:'base',checkpoint_height:10,checkpoint_hash:HASH,source_witness:witness,copy_complete:true,completed_at:'2026-11-12T00:00:00Z'};
 const shared={...base,run_id:'shared',checkpoint_height:11,copy_from_run_id:'base',copy_cursor:SHARED_CONFIRMED_CURSOR,volatile_only:true};
 return {witness,base,shared};
}
test('shared confirmed anchors require a complete nonshared canonical base of the current version',async()=>{
 const {base,shared}=sharedFixture(),calls=[];
 const client={query:async(sql,args)=>{calls.push({sql,args});return {rows:[base]};}};
 assert.equal(await confirmedBase(client,'livenet',base),base);
 assert.equal(calls.length,0);
 assert.equal(await confirmedBase(client,'livenet',shared),base);
 assert.deepEqual(calls[0].args,['livenet','base',SEARCH_INDEX_VERSION]);
 assert.ok(calls[0].sql.includes("state='ready'"));
 for(const patch of [{copy_complete:false},{run_id:'shared',copy_cursor:SHARED_CONFIRMED_CURSOR},
   {checkpoint_height:12},{source_witness:{...base.source_witness,canonicalHash:'b'.repeat(64)}}]) {
  await assert.rejects(()=>confirmedBase({query:async()=>({rows:[{...base,...patch}]})},'livenet',shared));
 }
 await assert.rejects(()=>confirmedBase(client,'livenet',{...shared,copy_from_run_id:'shared'}));
 assert.ok(effectiveDocuments(2,6).includes('d.run_id=$6::text'));
 assert.throws(()=>effectiveDocuments(2,3),/Unbound/);
});
test('version-scoped retention recursively protects serving-pin and interrupted-copy ancestors',async()=>{
 let observed;
 await pruneSearchGenerations({query:async(sql,args)=>{observed={sql,args};return {rows:[]};}},'livenet');
 assert.deepEqual(observed.args,['livenet',SEARCH_INDEX_VERSION]);
 assert.ok(observed.sql.startsWith('WITH RECURSIVE retained'));
 assert.ok(observed.sql.includes('UNION SELECT run_id FROM proof_indexer.search_serving_pins WHERE network=$1'));
 assert.ok(observed.sql.includes("NOT r.copy_complete OR r.copy_cursor='@shared-confirmed-v1'"));
 assert.ok(observed.sql.includes('DELETE FROM proof_indexer.search_runs WHERE network=$1 AND index_version=$2'));
 assert.ok(observed.sql.includes('SELECT r.copy_from_run_id'));
});
test('shared readers bind linked coverage and full-body matches to the verified confirmed base',async()=>{
 const {witness,base,shared}=sharedFixture(),queries=[];
 const client={release(){},query:async(sql,args)=>{
  queries.push({sql,args});
  if(sql.includes("AND ($3='' OR run_id=$3)"))return {rows:[shared]};
  if(sql.includes("AND run_id=$2 AND index_version=$3"))return {rows:[base]};
  if(sql.includes('hashes AS MATERIALIZED'))return {rows:[{total:1,confirmed:1,confirmed_records:1,canonical_hash:HASH,volatile_hashes:{},missing_raw_transactions:0}]};
  if(sql.includes('WITH raw_outputs AS'))return {rows:[{missing:0}]};
  if(sql.includes('FROM proof_indexer.meta'))return {rows:[]};
  if(sql.includes('search_simple_parser_identity'))return {rows:[{identity:HASH,supported:true}]};
  if(sql.includes('WITH expected AS')){
   assert.equal(args[1],'base');
   return {rows:[{expected:1,qualified:1,references:1}]};
  }
  if(sql.includes('SELECT 1 FROM proof_indexer.blocks'))return {rowCount:1,rows:[{}]};
  if(sql.includes('SELECT count(*)::integer AS total FROM')){
   assert.equal(args[1],'shared');assert.equal(args[5],'base');
   assert.ok(sql.includes('FROM search_effective_documents d'));
   assert.ok(sql.includes('lr.run_id=$6::text'));
   return {rows:[{total:1}]};
  }
  if(sql.includes('SELECT d.record,'))return {rows:[{record:{id:'event:1'},linked_excerpt:'full body match'}]};
  if(sql.includes('GROUP BY protocol,kind,status')){
   assert.equal(args[3],'base');return {rows:[]};
  }
  return {rows:[]};
 }};
 const result=await searchPayload('livenet',new URLSearchParams({q:'body'}),{
   pool:{connect:async()=>client},verifyCheckpoint:async()=>HASH
 });
 assert.equal(result.results[0].excerpt,'full body match');
 assert.equal(result.coverage.linkedArticles.articles,1);
 assert.equal(result.pagination.total,1);
 assert.ok(queries.some(({sql})=>sql.includes('search_linked_query_vector')));
 assert.equal(witness.canonicalHash,base.source_witness.canonicalHash);
});
