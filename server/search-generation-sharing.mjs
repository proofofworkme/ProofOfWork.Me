import {SEARCH_INDEX_VERSION,sameCanonicalSearchWitness,searchError} from './search-projection.mjs';
export const SHARED_CONFIRMED_CURSOR='@shared-confirmed-v1';
export function sharesConfirmed(run){return run?.copy_cursor===SHARED_CONFIRMED_CURSOR;}
export async function confirmedBase(client,network,run){
  if(!sharesConfirmed(run))return run;
  if(run.volatile_only!==true||run.copy_complete!==true||!run.copy_from_run_id||run.copy_from_run_id===run.run_id)throw searchError('Invalid shared confirmed generation.');
  const {rows}=await client.query(`SELECT * FROM proof_indexer.search_runs WHERE network=$1 AND run_id=$2 AND index_version=$3 AND state='ready'`,[network,run.copy_from_run_id,SEARCH_INDEX_VERSION]);
  const base=rows[0];
  if(!base||sharesConfirmed(base)||base.copy_complete!==true||Number(base.checkpoint_height)>Number(run.checkpoint_height)||!sameCanonicalSearchWitness(base.source_witness,run.source_witness))throw searchError('Shared confirmed evidence is unavailable or inconsistent.');
  return base;
}
export function effectiveDocuments(runParameter,baseParameter=null){
  if(![2,3].includes(runParameter))throw new Error('Unbound generation parameter');
  if(baseParameter!==null&&(!Number.isSafeInteger(baseParameter)||baseParameter<4||baseParameter>10))throw new Error('Unbound confirmed anchor parameter');
  const key=`$${runParameter}`;
  if(baseParameter!==null){
    // This binding is private to readers after confirmedBase and independent
    // Core/witness checks in their repeatable-read snapshot. Worker callers
    // keep the original relational guard below. No client chooses an anchor.
    const base=`$${baseParameter}::text`;
    return `WITH search_effective_documents AS NOT MATERIALIZED (
      SELECT d.network,${key}::text AS run_id,d.id,d.source_hash,d.protocol,d.kind,d.status,d.valid,d.canonical,d.block_height,d.block_index,d.vout,d.ordinal,d.amount_proofs,d.record,d.payload,d.raw_payload,d.evidence,d.search_text,d.search_vector
      FROM proof_indexer.search_documents d WHERE d.network=$1
        AND (d.run_id=${key} OR (d.run_id=${base} AND d.status='confirmed' AND ${base}<>${key}::text))
    )`;
  }
  return `WITH search_effective_documents AS NOT MATERIALIZED (
    SELECT d.* FROM proof_indexer.search_documents d WHERE d.network=$1 AND d.run_id=${key}
    UNION ALL
    SELECT d.network,${key}::text AS run_id,d.id,d.source_hash,d.protocol,d.kind,d.status,d.valid,d.canonical,d.block_height,d.block_index,d.vout,d.ordinal,d.amount_proofs,d.record,d.payload,d.raw_payload,d.evidence,d.search_text,d.search_vector FROM proof_indexer.search_documents d
    JOIN proof_indexer.search_runs r ON r.network=d.network AND r.copy_from_run_id=d.run_id
    WHERE r.network=$1 AND r.run_id=${key} AND r.copy_cursor='@shared-confirmed-v1' AND d.status='confirmed'
  )`;
}
