import { readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createProofIndexPool } from '../server/db/postgres.mjs';
import {
  SEARCH_INDEX_VERSION, buildSearchDocument, readSearchSources, readSearchCheckpoint,
  searchSourceWitness, sameCanonicalSearchWitness, verifySearchCheckpoint, searchError,
} from '../server/search-projection.mjs';

export async function applySearchSchema(pool) {
  const path=new URL('../server/sql/proof-search-v1.sql',import.meta.url);
  await pool.query(await readFile(path,'utf8'));
  return {ok:true,indexVersion:SEARCH_INDEX_VERSION,schemaPath:fileURLToPath(path)};
}
export function searchCoreVerifier(env=process.env) {
  return async height=>{
    const url=String(env.BITCOIN_RPC_URL??'').trim();
    if (!url) throw searchError('Search needs the existing first-party Bitcoin Core RPC configuration.');
    const headers={'Content-Type':'application/json'};
    if (env.BITCOIN_RPC_USER || env.BITCOIN_RPC_PASSWORD) headers.Authorization=`Basic ${Buffer.from(`${env.BITCOIN_RPC_USER??''}:${env.BITCOIN_RPC_PASSWORD??''}`).toString('base64')}`;
    const response=await fetch(url,{method:'POST',headers,body:JSON.stringify({jsonrpc:'2.0',id:'search-checkpoint',method:'getblockhash',params:[height]}),signal:AbortSignal.timeout(5000)});
    if (!response.ok) throw searchError('Full-node Search checkpoint request failed.');
    const body=await response.json();
    if (body.error || !/^[0-9a-f]{64}$/u.test(body.result??'')) throw searchError('Full node could not verify the Search checkpoint.');
    return body.result;
  };
}
async function storeDocuments(client,network,runId,rows) {
  if (!rows.length) return;
  const params=[],tuples=[];
  for (const row of rows) {
    const doc=buildSearchDocument(row.source,row.source_hash),record=doc.record;
    const values=[network,runId,record.id,row.source_hash,record.protocol,record.kind,record.status,record.valid,record.canonical,
      record.blockHeight,record.blockIndex,record.source.vout,record.source.ordinal,record.amountSats,
      JSON.stringify(record),JSON.stringify(doc.payload),doc.rawPayload,JSON.stringify(doc.evidence),doc.searchText];
    const start=params.length; params.push(...values);
    tuples.push(`(${values.map((_,index)=>`$${start+index+1}`).join(',')})`);
  }
  await client.query(`INSERT INTO proof_indexer.search_documents
    (network,run_id,id,source_hash,protocol,kind,status,valid,canonical,block_height,block_index,vout,ordinal,amount_proofs,record,payload,raw_payload,evidence,search_text)
    VALUES ${tuples.join(',')} ON CONFLICT (network,run_id,id) DO UPDATE SET source_hash=EXCLUDED.source_hash,
      protocol=EXCLUDED.protocol,kind=EXCLUDED.kind,status=EXCLUDED.status,valid=EXCLUDED.valid,canonical=EXCLUDED.canonical,
      block_height=EXCLUDED.block_height,block_index=EXCLUDED.block_index,vout=EXCLUDED.vout,ordinal=EXCLUDED.ordinal,
      amount_proofs=EXCLUDED.amount_proofs,record=EXCLUDED.record,payload=EXCLUDED.payload,
      raw_payload=EXCLUDED.raw_payload,evidence=EXCLUDED.evidence,search_text=EXCLUDED.search_text`,params);
}
export async function copyConfirmedSearchBatch(client,{network,runId,fromRunId,after='',batchSize=200}) {
  // Copy only a bounded keyset. Cursor and rows commit together so a timeout or
  // process stop cannot skip evidence or repeat a partially committed copy.
  await client.query('BEGIN');
  try {
    const result=await client.query(`WITH copied AS (
      INSERT INTO proof_indexer.search_documents(network,run_id,id,source_hash,protocol,kind,status,valid,canonical,block_height,block_index,vout,ordinal,amount_proofs,record,payload,raw_payload,evidence,search_text)
      SELECT network,$2,id,source_hash,protocol,kind,status,valid,canonical,block_height,block_index,vout,ordinal,amount_proofs,record,payload,raw_payload,evidence,search_text
      FROM proof_indexer.search_documents WHERE network=$1 AND run_id=$3 AND status='confirmed'
        AND id COLLATE "C" > $4 COLLATE "C" ORDER BY id COLLATE "C" LIMIT $5
      RETURNING id
    ) SELECT count(*)::integer AS count,max(id COLLATE "C") AS cursor FROM copied`,[network,runId,fromRunId,after,batchSize]);
    const count=Number(result.rows[0].count),cursor=result.rows[0].cursor??after,complete=count<batchSize;
    await client.query(`UPDATE proof_indexer.search_runs SET copy_cursor=$2,copy_complete=$3,updated_at=now() WHERE run_id=$1`,[runId,cursor,complete]);
    await client.query('COMMIT');
    return {count,cursor,complete};
  } catch(error) {await client.query('ROLLBACK').catch(()=>{});throw error;}
}
export async function pruneSearchGenerations(client,network) {
  // These tables contain only reproducible Search copies. All canonical source
  // rows, protocol history, evidence, snapshots and economic state are retained.
  return client.query(`DELETE FROM proof_indexer.search_runs WHERE network=$1 AND run_id NOT IN (
    SELECT run_id FROM proof_indexer.search_runs WHERE network=$1 AND state='ready' ORDER BY completed_at DESC LIMIT 2
  ) AND run_id NOT IN (
    SELECT run_id FROM proof_indexer.search_runs WHERE network=$1 AND state='building' ORDER BY created_at DESC LIMIT 1
  )`,[network]);
}
export async function runSearchBackfill({pool,network='livenet',batchSize=200,maxBatches=20,budgetMs=30000,verifyCheckpoint=searchCoreVerifier()}={}) {
  if (!pool) throw new Error('Search backfill requires its own database pool.');
  const started=Date.now(),client=await pool.connect();
  let lock=false;
  try {
    await client.query("SET TIME ZONE 'UTC'");
    await client.query('SET jit=off');
    const locked=await client.query("SELECT pg_try_advisory_lock(hashtext('proof-search-v1'),hashtext($1)) AS locked",[network]);
    lock=locked.rows[0].locked;
    if (!lock) return {ok:true,busy:true,indexVersion:SEARCH_INDEX_VERSION};
    const checkpoint=await readSearchCheckpoint(client,network);
    await verifySearchCheckpoint(verifyCheckpoint,network,checkpoint.height,checkpoint.hash);
    let found=await client.query(`SELECT * FROM proof_indexer.search_runs WHERE network=$1 AND index_version=$2 AND state='building' ORDER BY created_at DESC LIMIT 1`,[network,SEARCH_INDEX_VERSION]);
    let run=found.rows[0];
    if (run) {
      let stable=true;
      try {await verifySearchCheckpoint(verifyCheckpoint,network,run.checkpoint_height,run.checkpoint_hash);}
      catch(error) {if(error.details?.code!=='SEARCH_CHECKPOINT_CHANGED')throw error;stable=false;}
      const current=stable?await searchSourceWitness(client,network,run.checkpoint_height):null;
      if (!stable || !sameCanonicalSearchWitness(run.source_witness,current)) {
        await client.query("UPDATE proof_indexer.search_runs SET state='superseded',updated_at=now() WHERE run_id=$1",[run.run_id]);
        run=null;
      }
    }
    if (!run) {
      const witness=await searchSourceWitness(client,network,checkpoint.height);
      const previous=await client.query(`SELECT * FROM proof_indexer.search_runs WHERE network=$1 AND index_version=$2 AND state='ready' ORDER BY completed_at DESC LIMIT 1`,[network,SEARCH_INDEX_VERSION]);
      const ready=previous.rows[0];
      const sameCheckpoint=ready && Number(ready.checkpoint_height)===checkpoint.height && ready.checkpoint_hash===checkpoint.hash && sameCanonicalSearchWitness(ready.source_witness,witness);
      if (sameCheckpoint && JSON.stringify(ready.source_witness.volatileHashes)===JSON.stringify(witness.volatileHashes)) {
        await pruneSearchGenerations(client,network);
        return {ok:true,ready:true,unchanged:true,checkpointHeight:checkpoint.height,checkpointHash:checkpoint.hash,indexVersion:SEARCH_INDEX_VERSION,elapsedMs:Date.now()-started};
      }
      let copyConfirmed=Boolean(sameCheckpoint);
      if (ready && !sameCheckpoint && Number(ready.checkpoint_height)<checkpoint.height) {
        try {
          await verifySearchCheckpoint(verifyCheckpoint,network,ready.checkpoint_height,ready.checkpoint_hash);
          copyConfirmed=sameCanonicalSearchWitness(ready.source_witness,await searchSourceWitness(client,network,ready.checkpoint_height));
        } catch(error) {if(error.details?.code!=='SEARCH_CHECKPOINT_CHANGED')throw error;}
      }
      const runId=randomUUID();
      await client.query('BEGIN');
      try {
        await client.query(`INSERT INTO proof_indexer.search_runs(run_id,network,index_version,state,checkpoint_height,checkpoint_hash,source_witness,volatile_only,source_floor_height,copy_from_run_id,copy_complete)
          VALUES($1,$2,$3,'building',$4,$5,$6::jsonb,$7,$8,$9,$10)`,[runId,network,SEARCH_INDEX_VERSION,checkpoint.height,checkpoint.hash,JSON.stringify(witness),Boolean(sameCheckpoint),copyConfirmed?Number(ready.checkpoint_height):0,copyConfirmed?ready.run_id:null,!copyConfirmed]);
        await client.query('COMMIT');
      } catch(error) { await client.query('ROLLBACK'); throw error; }
      run=(await client.query('SELECT * FROM proof_indexer.search_runs WHERE run_id=$1',[runId])).rows[0];
    }
    let copyCursor=run.copy_cursor??'',copyComplete=run.copy_complete!==false,copied=0,copyBatches=0;
    // The historical source-batch cap remains separate. Derived-copy progress
    // uses the same overall time budget, with at most 1,000 bounded statements.
    while (!copyComplete && copyBatches<1000 && Date.now()-started<budgetMs) {
      const batch=await copyConfirmedSearchBatch(client,{network,runId:run.run_id,fromRunId:run.copy_from_run_id,after:copyCursor,batchSize});
      copyCursor=batch.cursor;copyComplete=batch.complete;copied+=batch.count;copyBatches+=1;
    }
    let cursor=run.source_cursor,batches=0,processed=0,exhausted=false;
    while (copyComplete && batches<maxBatches && Date.now()-started<budgetMs) {
      const rows=await readSearchSources(client,network,Number(run.checkpoint_height),cursor,batchSize,run.volatile_only,Number(run.source_floor_height??0));
      if (!rows.length) {exhausted=true;break;}
      await client.query('BEGIN');
      try {
        await storeDocuments(client,network,run.run_id,rows);
        cursor=rows.at(-1).id; processed+=rows.length;
        await client.query(`UPDATE proof_indexer.search_runs SET source_cursor=$2,projected_count=projected_count+$3,updated_at=now() WHERE run_id=$1`,[run.run_id,cursor,rows.length]);
        await client.query('COMMIT');
      } catch(error) { await client.query('ROLLBACK'); throw error; }
      batches+=1;
      if (rows.length<batchSize) {exhausted=true;break;}
    }
    let ready=false,witness=run.source_witness;
    if (exhausted) {
      await verifySearchCheckpoint(verifyCheckpoint,network,run.checkpoint_height,run.checkpoint_hash);
      witness=await searchSourceWitness(client,network,run.checkpoint_height);
      const counts=await client.query(`SELECT count(*) FILTER(WHERE status='confirmed')::integer AS confirmed,count(*)::integer AS total
        FROM proof_indexer.search_documents WHERE network=$1 AND run_id=$2`,[network,run.run_id]);
      ready=sameCanonicalSearchWitness(run.source_witness,witness) && Number(counts.rows[0].confirmed)===witness.confirmedRecords && witness.missingRawTransactions===0 && witness.missingRawCarriers===0;
      if (ready) await client.query(`UPDATE proof_indexer.search_runs SET state='ready',source_witness=$2::jsonb,completed_at=now(),updated_at=now() WHERE run_id=$1`,[run.run_id,JSON.stringify(witness)]);
      else if (!sameCanonicalSearchWitness(run.source_witness,witness) || Number(counts.rows[0].confirmed)!==witness.confirmedRecords) await client.query("UPDATE proof_indexer.search_runs SET state='superseded',updated_at=now() WHERE run_id=$1",[run.run_id]);
    }
    await pruneSearchGenerations(client,network);
    return {ok:true,ready,building:!ready,runId:run.run_id,indexVersion:SEARCH_INDEX_VERSION,checkpointHeight:Number(run.checkpoint_height),checkpointHash:run.checkpoint_hash,
      batches,processed,sourceCursor:cursor,copied,copyBatches,copyCursor,copyComplete,sourceCounts:{total:witness.total,confirmed:witness.confirmedRecords},missingRawTransactions:witness.missingRawTransactions,
      missingRawCarriers:witness.missingRawCarriers,elapsedMs:Date.now()-started};
  } finally {
    if (lock) await client.query("SELECT pg_advisory_unlock(hashtext('proof-search-v1'),hashtext($1))",[network]).catch(()=>{});
    client.release();
  }
}
function argument(name,fallback) {
  const found=process.argv.slice(2).find(value=>value.startsWith(`--${name}=`));
  const parsed=Number(found?.slice(name.length+3)??fallback);
  if (!Number.isSafeInteger(parsed)||parsed<1) throw new Error(`Invalid --${name}.`);
  return parsed;
}
async function main() {
  const pool=createProofIndexPool({env:{...process.env,POW_INDEX_DB_APP_NAME:'proof-search-backfill',POW_INDEX_DB_POOL_MAX:'1',POW_INDEX_DB_STATEMENT_TIMEOUT_MS:'15000'}});
  try {
    const result=process.argv.includes('--schema') ? await applySearchSchema(pool) : await runSearchBackfill({pool,network:process.env.NETWORK??'livenet',
      batchSize:Math.min(500,argument('batch-size',200)),maxBatches:Math.min(100,argument('max-batches',20)),budgetMs:Math.min(120000,argument('budget-ms',30000))});
    process.stdout.write(`${JSON.stringify(result)}\n`);
  } finally {await pool.end();}
}
if (process.argv[1] && import.meta.url===pathToFileURL(process.argv[1]).href) main().catch(error=>{
  process.stderr.write(`${JSON.stringify({ok:false,code:error.details?.code??'SEARCH_JOB_FAILED',message:error.statusCode?error.message:'Search projection job failed; inspect protected operator diagnostics.'})}\n`);process.exitCode=1;
});
