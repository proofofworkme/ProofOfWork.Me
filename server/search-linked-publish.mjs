import { createHash } from 'node:crypto';
import { statfs } from 'node:fs/promises';
import { Transaction } from 'bitcoinjs-lib';
import { resolvePowcatFile } from '../src/shared/protocol/powcat1.mjs';
import { normalizePublishArticleMetadata } from '../src/shared/protocol/publishArticle.mjs';
import { linkedArticleEvidenceMatches, linkedArticleCanonicalProjectionMatches, verifyLinkedArticle } from './publish-linked.mjs';

export const LINKED_PUBLISH_SEARCH_MODEL = 'linked-publish-content-search-v1';
export const LINKED_SEARCH_MAX_POSTINGS_BYTES = 256 * 1024 ** 2;
export const LINKED_SEARCH_MAX_RETAINED_BYTES = 8 * 1024 ** 3;
export const LINKED_SEARCH_MAX_PHYSICAL_BYTES = 12 * 1024 ** 3;
export const LINKED_SEARCH_MIN_FREE_BYTES = 100 * 1024 ** 3;
export const LINKED_SEARCH_SCRATCH_RESERVE_BYTES = 512 * 1024 ** 2;
const MAX_RAW_HEX_BYTES = 64 * 1024 ** 2;
const sha = value => createHash('sha256').update(value).digest('hex');
const fail = (message, code='SEARCH_LINKED_UNAVAILABLE') => {
  throw Object.assign(new Error(message), {statusCode:503,details:{code}});
};
export function linkedPublishSearchCandidate(source) {
  return source?.sourceClass === 'event' && source.protocol === 'pwb1' &&
    source.kind === 'boost-post' && source.valid === true && source.canonical === true &&
    source.status === 'confirmed' && source.payload?.article?.v === 2;
}
export async function linkedSearchParserState(client) {
  const result=await client.query('SELECT proof_indexer.search_simple_parser_identity() AS identity, proof_indexer.search_simple_parser_supported() AS supported');
  const state=result.rows[0];
  if (!state?.supported || !/^[0-9a-f]{64}$/u.test(state.identity??'')) fail('Linked article Search requires its qualified PostgreSQL parser.');
  return state.identity;
}
export async function linkedSearchCapacity(client,{reserveBytes=0,probe=statfs,dataPath='/data'}={}) {
  const result=await client.query('SELECT COALESCE((SELECT sum(body_bytes) FROM proof_indexer.search_linked_contents),0)::text AS bodies, COALESCE((SELECT sum(postings_bytes) FROM proof_indexer.search_linked_postings),0)::text AS postings, (pg_total_relation_size(\'proof_indexer.search_linked_contents\')+pg_total_relation_size(\'proof_indexer.search_linked_postings\')+pg_total_relation_size(\'proof_indexer.search_linked_refs\'))::text AS physical');
  const bodies=Number(result.rows[0].bodies),postings=Number(result.rows[0].postings),physical=Number(result.rows[0].physical);
  if (![bodies,postings,physical,reserveBytes].every(n=>Number.isSafeInteger(n)&&n>=0)) fail('Linked Search storage accounting is unavailable.');
  const storage=await probe(dataPath,{bigint:true});
  const available=BigInt(storage.bavail)*BigInt(storage.bsize);
  if(physical+reserveBytes*2>LINKED_SEARCH_MAX_PHYSICAL_BYTES)
    fail('Linked Search physical storage quota reached. Retain referenced content; run reviewed garbage collection and compaction.','SEARCH_LINKED_PHYSICAL_CAPACITY');
  if (bodies+postings+reserveBytes>LINKED_SEARCH_MAX_RETAINED_BYTES ||
      available<BigInt(LINKED_SEARCH_MIN_FREE_BYTES+LINKED_SEARCH_SCRATCH_RESERVE_BYTES+reserveBytes))
    fail('Linked article Search capacity is exhausted; existing canonical content is unchanged.','SEARCH_LINKED_CAPACITY');
  return {model:LINKED_PUBLISH_SEARCH_MODEL,bodyBytes:bodies,postingsBytes:postings,
    retainedBytes:bodies+postings,maxRetainedBytes:LINKED_SEARCH_MAX_RETAINED_BYTES,
    physicalBytes:physical,maxPhysicalBytes:LINKED_SEARCH_MAX_PHYSICAL_BYTES,
    freeBytes:available.toString(),minFreeBytes:LINKED_SEARCH_MIN_FREE_BYTES};
}
export async function resolveSearchLinkedArticle(client,network,source) {
  const article=normalizePublishArticleMetadata(source.payload?.article);
  const evidence=source.payload?.articleDependencies;
  const position={txid:source.txid,blockHeight:source.blockHeight,blockHash:source.blockHash,protocolVout:source.vout};
  if (!linkedPublishSearchCandidate(source) || !linkedArticleEvidenceMatches(article,position,evidence))
    fail('Linked article Search source is not canonically qualified.');
  const ids=[source.txid,...evidence.dependencies.map(d=>d.txid)];
  const selection=`FROM proof_indexer.transactions t JOIN proof_indexer.blocks b
    ON b.network=t.network AND b.height=t.block_height AND b.block_hash=t.block_hash AND b.canonical=true
    WHERE t.network=$1 AND t.txid=ANY($2::text[]) AND t.status='confirmed'`;
  const raw="COALESCE(NULLIF(t.raw_hex,''),t.raw_tx->>'hex','')";
  const admission=await client.query(`SELECT count(*)::integer AS count,COALESCE(sum(length(${raw})),0)::text AS bytes ${selection}`,[network,ids]);
  if (admission.rows[0].count!==ids.length || BigInt(admission.rows[0].bytes)>BigInt(MAX_RAW_HEX_BYTES))
    fail('Linked article Search transaction evidence exceeds its bounded admission.');
  const result=await client.query(`SELECT t.txid,t.block_height,t.block_hash,${raw} AS hex ${selection}`,[network,ids]);
  const rows=new Map(result.rows.map(row=>[row.txid,{hex:row.hex,blockHeight:Number(row.block_height),blockHash:row.block_hash}]));
  if (rows.size!==ids.length || [...rows.values()].some(row=>!row.hex || row.hex.length>8_000_000)) fail('Linked article Search transaction bytes are missing.');
  for (const dependency of [{txid:source.txid,blockHeight:source.blockHeight,blockHash:source.blockHash},...evidence.dependencies]) {
    const actual=rows.get(dependency.txid);
    if (actual.blockHeight!==dependency.blockHeight || actual.blockHash!==dependency.blockHash) fail('Linked article Search dependency changed canonical position.');
  }
  if (!linkedArticleCanonicalProjectionMatches(article,position,evidence,rows.get(article.linkerTxid).hex,true))
    fail('Linked article Search linker differs from its certificate.');
  let signed;
  try { signed=Transaction.fromHex(rows.get(source.txid).hex); } catch { fail('Linked article Search post bytes cannot be decoded.'); }
  if (signed.getId()!==source.txid) fail('Linked article Search post TXID differs.');
  const tx={txid:source.txid,vout:signed.outs.map((out,n)=>({n,scriptPubKey:{hex:Buffer.from(out.script).toString('hex')}}))};
  const verified=await verifyLinkedArticle(tx,position,{network,
    readFile:async root=>{
      const file=await resolvePowcatFile(root,async id=>{
        const row=rows.get(id);if(!row)fail('Unadmitted linked article dependency.');return row;
      });
      return {...file,dependencies:[root,...file.partTxids].map(txid=>({txid,blockHeight:rows.get(txid).blockHeight,blockHash:rows.get(txid).blockHash}))};
    },
    blockHashAtHeight:async height=>{
      const block=await client.query('SELECT block_hash FROM proof_indexer.blocks WHERE network=$1 AND height=$2 AND canonical=true',[network,height]);
      return block.rows.length===1?block.rows[0].block_hash:null;
    }});
  if (!verified || JSON.stringify(verified.article)!==JSON.stringify(article) ||
      Buffer.byteLength(verified.body)!==article.size || sha(Buffer.from(verified.body))!==article.sha256)
    fail('Linked article Search body disagrees with canonical bytes.');
  return verified;
}
export async function storeLinkedPublishSearchReference(client,{network,runId,source,sourceHash,prefix,capacityOptions}){
  if(!linkedPublishSearchCandidate(source))return false;
  const locked=await client.query("SELECT pg_try_advisory_xact_lock(hashtext('proof-search-linked-content-v1')) AS locked");
  if(!locked.rows[0]?.locked)fail('Linked article Search materialization is busy.');
  const parser=await linkedSearchParserState(client);
  await linkedSearchCapacity(client,{...capacityOptions,reserveBytes:4096});
  const verified=await resolveSearchLinkedArticle(client,network,source);
  const hash=verified.article.sha256;
  const existing=await client.query('SELECT p.postings_bytes,c.body_bytes,encode(sha256(convert_to(c.body,\'UTF8\')),\'hex\') AS hash FROM proof_indexer.search_linked_postings p JOIN proof_indexer.search_linked_contents c USING(network,content_hash) WHERE p.network=$1 AND p.content_hash=$2 AND p.parser_identity=$3',[network,hash,parser]);
  if(existing.rowCount!==1){
    // Reserve the worst permitted materialization, not optimistic compression.
    await linkedSearchCapacity(client,{...capacityOptions,reserveBytes:LINKED_SEARCH_MAX_POSTINGS_BYTES+verified.article.size});
    await client.query(`INSERT INTO proof_indexer.search_linked_contents(network,content_hash,body,body_bytes)
      VALUES($1,$2,$3,$4) ON CONFLICT(network,content_hash) DO NOTHING`,[network,hash,verified.body,verified.article.size]);
    const postings=await client.query(`WITH built AS MATERIALIZED (
      SELECT COALESCE(jsonb_object_agg(lexeme,to_jsonb(positions) ORDER BY lexeme COLLATE "C"),'{}'::jsonb) AS value
      FROM proof_indexer.search_simple_positions($4)
    ) INSERT INTO proof_indexer.search_linked_postings(network,content_hash,parser_identity,postings,postings_bytes)
      SELECT $1,$2,$3,value,octet_length(value::text) FROM built WHERE octet_length(value::text)<=$5
      ON CONFLICT(network,content_hash,parser_identity) DO NOTHING RETURNING postings_bytes`,
      [network,hash,parser,verified.body,LINKED_SEARCH_MAX_POSTINGS_BYTES]);
    if(postings.rowCount!==1)fail('Linked article Search postings exceeded their materialization bound.','SEARCH_LINKED_CAPACITY');
  } else if(Number(existing.rows[0].body_bytes)!==verified.article.size || existing.rows[0].hash!==hash)
    fail('Retained linked Search content differs from its commitment.');
  await client.query(`INSERT INTO proof_indexer.search_linked_refs(network,run_id,id,content_hash,parser_identity,source_hash,dependency_hash,prefix_tokens)
    VALUES($1,$2,$3,$4,$5,$6,encode(sha256(convert_to($7::jsonb::text,'UTF8')),'hex'),proof_indexer.search_simple_token_count($8))
    ON CONFLICT(network,run_id,id) DO UPDATE SET content_hash=EXCLUDED.content_hash,parser_identity=EXCLUDED.parser_identity,
      source_hash=EXCLUDED.source_hash,dependency_hash=EXCLUDED.dependency_hash,prefix_tokens=EXCLUDED.prefix_tokens`,
    [network,runId,source.id,hash,parser,sourceHash,JSON.stringify(verified.evidence),prefix]);
  return true;
}
export async function linkedPublishSearchCoverage(client,network,runId){
  const parser=await linkedSearchParserState(client);
  const result=await client.query(`WITH expected AS (
    SELECT id,source_hash,payload,search_text FROM proof_indexer.search_documents
    WHERE network=$1 AND run_id=$2 AND protocol='pwb1' AND kind='boost-post' AND valid=true AND canonical=true
      AND status='confirmed' AND payload->'article'->>'v'='2'
  ), qualified AS (
    SELECT e.id FROM expected e JOIN proof_indexer.search_linked_refs r
      ON r.network=$1 AND r.run_id=$2 AND r.id=e.id AND r.source_hash=e.source_hash
      AND r.content_hash=e.payload->'article'->>'sha256' AND r.parser_identity=$3
      AND r.dependency_hash=encode(sha256(convert_to((e.payload->'articleDependencies')::text,'UTF8')),'hex')
    JOIN proof_indexer.search_linked_postings p USING(network,content_hash,parser_identity)
    JOIN proof_indexer.search_linked_contents c USING(network,content_hash)
    WHERE c.body_bytes=(e.payload->'article'->>'size')::integer
      AND r.prefix_tokens=proof_indexer.search_simple_token_count(e.search_text)
  ) SELECT (SELECT count(*) FROM expected)::integer AS expected,
    (SELECT count(*) FROM qualified)::integer AS qualified,
    (SELECT count(*) FROM proof_indexer.search_linked_refs WHERE network=$1 AND run_id=$2)::integer AS references`,[network,runId,parser]);
  const row=result.rows[0];
  return {model:LINKED_PUBLISH_SEARCH_MODEL,parserIdentity:parser,ready:row.expected===row.qualified&&row.expected===row.references,
    articles:row.expected,qualified:row.qualified,fullBodySearch:true};
}
export async function pruneUnreferencedLinkedSearch(client,network){
  await client.query('BEGIN');
  try {
    const locked=await client.query("SELECT pg_try_advisory_xact_lock(hashtext('proof-search-linked-content-v1')) AS locked");
    if(!locked.rows[0]?.locked){await client.query('ROLLBACK');return {busy:true};}
    const postings=await client.query(`DELETE FROM proof_indexer.search_linked_postings p WHERE network=$1
      AND NOT EXISTS(SELECT 1 FROM proof_indexer.search_linked_refs r WHERE r.network=p.network AND r.content_hash=p.content_hash AND r.parser_identity=p.parser_identity)`,[network]);
    const bodies=await client.query(`DELETE FROM proof_indexer.search_linked_contents c WHERE network=$1
      AND NOT EXISTS(SELECT 1 FROM proof_indexer.search_linked_postings p WHERE p.network=c.network AND p.content_hash=c.content_hash)`,[network]);
    await client.query('COMMIT');
    return {postings:postings.rowCount,bodies:bodies.rowCount};
  } catch(error){await client.query('ROLLBACK').catch(()=>{});throw error;}
}

export async function compactLinkedSearchStorage(client,{probe=statfs,dataPath='/data'}={}) {
  // Explicit operator maintenance, never called by a reader or automatic build.
  // It rewrites only these reproducible derived relations; no canonical table.
  const tables=['search_linked_refs','search_linked_postings','search_linked_contents'];
  const settings=await client.query("SELECT current_setting('lock_timeout') AS lock, current_setting('statement_timeout') AS statement");
  const original=settings.rows[0];
  const maintenance=await client.query("SELECT pg_try_advisory_lock(hashtext('proof-search-linked-maintenance-v1')) AS locked");
  if(!maintenance.rows[0]?.locked)fail('Linked Search maintenance is busy.');
  let contentLocked=false;
  try {
    const locked=await client.query("SELECT pg_try_advisory_lock(hashtext('proof-search-linked-content-v1')) AS locked");
    if(!locked.rows[0]?.locked)fail('Linked Search materialization is busy.');
    contentLocked=true;
    const space=await probe(dataPath,{bigint:true});
    if(BigInt(space.bavail)*BigInt(space.bsize)<BigInt(LINKED_SEARCH_MIN_FREE_BYTES+LINKED_SEARCH_MAX_PHYSICAL_BYTES))
      fail('Linked Search compaction requires its full temporary-copy reserve.','SEARCH_LINKED_CAPACITY');
    const accounting=async()=> (await client.query(`SELECT
      (SELECT count(*) FROM proof_indexer.search_linked_contents)::text AS bodies,
      (SELECT count(*) FROM proof_indexer.search_linked_postings)::text AS postings,
      (SELECT count(*) FROM proof_indexer.search_linked_refs)::text AS references,
      (SELECT COALESCE(sum(body_bytes),0) FROM proof_indexer.search_linked_contents)::text AS body_bytes,
      (SELECT COALESCE(sum(postings_bytes),0) FROM proof_indexer.search_linked_postings)::text AS postings_bytes,
      (pg_total_relation_size('proof_indexer.search_linked_contents')+pg_total_relation_size('proof_indexer.search_linked_postings')+pg_total_relation_size('proof_indexer.search_linked_refs'))::text AS physical`)).rows[0];
    const before=await accounting();
    await client.query("SELECT set_config('lock_timeout','1000ms',false),set_config('statement_timeout','120000ms',false)");
    for(const table of tables)await client.query(`VACUUM (FULL, ANALYZE) proof_indexer.${table}`);
    const after=await accounting();
    for(const key of ['bodies','postings','references','body_bytes','postings_bytes'])
      if(before[key]!==after[key])fail('Linked Search maintenance accounting changed unexpectedly.');
    return {model:LINKED_PUBLISH_SEARCH_MODEL,before,after,reclaimedBytes:Math.max(0,Number(before.physical)-Number(after.physical))};
  } finally {
    await client.query("SELECT set_config('lock_timeout',$1,false),set_config('statement_timeout',$2,false)",[original.lock,original.statement]).catch(()=>{});
    if(contentLocked)await client.query("SELECT pg_advisory_unlock(hashtext('proof-search-linked-content-v1'))").catch(()=>{});
    await client.query("SELECT pg_advisory_unlock(hashtext('proof-search-linked-maintenance-v1'))").catch(()=>{});
  }
}
