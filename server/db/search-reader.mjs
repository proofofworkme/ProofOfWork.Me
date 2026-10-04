import { createProofIndexPool } from './postgres.mjs';
import {
  SEARCH_INDEX_VERSION, SEARCH_MAX_DETAIL_BYTES, SEARCH_SOURCES_SQL, SEARCH_PROTOCOLS,
  searchError, searchSha256, searchSourceWitness, sameCanonicalSearchWitness, verifySearchCheckpoint,
} from '../search-projection.mjs';

let sharedPool;
function readerPool(options) {
  if (options.pool) return options.pool;
  sharedPool ??= createProofIndexPool({ env: { ...process.env, POW_INDEX_DB_APP_NAME:'proof-search-reader', POW_INDEX_DB_POOL_MAX:'2', POW_INDEX_DB_STATEMENT_TIMEOUT_MS:'15000' } });
  return sharedPool;
}
export async function closeSearchReadPool() { const pool=sharedPool; sharedPool=undefined; if (pool) await pool.end(); }
function value(params,key,fallback='') { return String(params?.get?.(key) ?? fallback).trim(); }
export function normalizeSearchRequest(network,params) {
  if (!['livenet','testnet','testnet3','testnet4'].includes(network)) throw searchError('Unknown Search network.',400,'SEARCH_QUERY_INVALID');
  const q=value(params,'q');
  if (q.length>2048 || q.includes('\u0000')) throw searchError('Search query exceeds the text limit.',400,'SEARCH_QUERY_INVALID');
  const status=value(params,'status','confirmed'), validity=value(params,'valid','valid'), sort=value(params,'sort','relevance');
  if (!['confirmed','all','pending','dropped','orphaned'].includes(status) || !['valid','all','invalid'].includes(validity) ||
      !['relevance','newest','oldest','proofs'].includes(sort)) throw searchError('Unsupported Search filter.',400,'SEARCH_QUERY_INVALID');
  const protocol=value(params,'protocol').replace(/:$/u,''),kind=value(params,'kind');
  if (protocol.length>64 || kind.length>128 || /[\u0000-\u001f]/u.test(protocol+kind)) throw searchError('Invalid Search filter.',400,'SEARCH_QUERY_INVALID');
  const limitText=value(params,'limit','20');
  if (!/^[1-9]\d*$/u.test(limitText) || Number(limitText)>50) throw searchError('Search limit must be from 1 to 50.',400,'SEARCH_QUERY_INVALID');
  return { network,q,protocol,kind,status,validity,sort,limit:Number(limitText),cursor:value(params,'cursor') };
}
export function searchQueryFingerprint(request) {
  const { cursor, ...query }=request;
  return searchSha256(JSON.stringify(query));
}
export function encodeSearchCursor(value) { return `search-v1.${Buffer.from(JSON.stringify(value)).toString('base64url')}`; }
export function decodeSearchCursor(raw) {
  if (!raw) return null;
  try {
    if (!raw.startsWith('search-v1.') || raw.length>2000) throw new Error();
    const encoded=raw.slice(10), json=Buffer.from(encoded,'base64url').toString('utf8'),parsed=JSON.parse(json);
    if (encodeSearchCursor(parsed)!==raw || !Number.isSafeInteger(parsed.offset) || parsed.offset<1 || parsed.offset>1_000_000 ||
        typeof parsed.runId!=='string' || !/^[0-9a-f]{64}$/u.test(parsed.queryHash??'') || !/^[0-9a-f]{64}$/u.test(parsed.sourceHash??'')) throw new Error();
    return parsed;
  } catch { throw searchError('Invalid Search cursor. Start again from the first page.',400,'SEARCH_CURSOR_INVALID'); }
}
export function searchExcerpt(text,q,max=360) {
  const source=String(text??'');
  const match=q ? source.toLowerCase().indexOf(q.toLowerCase()) : -1;
  const start=match<0 ? 0 : Math.max(0,match-100), end=Math.min(source.length,start+max);
  return `${start?'…':''}${source.slice(start,end)}${end<source.length?'…':''}`;
}
function likeLiteral(q) { return `%${q.toLowerCase().replace(/[\\%_]/gu,'\\$&')}%`; }
async function readyRun(client,network,options,requestedRunId='') {
  const result=await client.query(`SELECT * FROM proof_indexer.search_runs WHERE network=$1 AND index_version=$2 AND state='ready'
    AND ($3='' OR run_id=$3) ORDER BY completed_at DESC LIMIT 1`,[network,SEARCH_INDEX_VERSION,requestedRunId]);
  const run=result.rows[0];
  if (!run) throw requestedRunId ? searchError('Search cursor has expired. Start again from the first page.',409,'SEARCH_CURSOR_EXPIRED') : searchError('Search is building its verified historical index. Retry after indexing completes.');
  await verifySearchCheckpoint(options.verifyCheckpoint,network,run.checkpoint_height,run.checkpoint_hash);
  const block=await client.query(`SELECT 1 FROM proof_indexer.blocks WHERE network=$1 AND height=$2 AND block_hash=$3 AND canonical=true`,[network,run.checkpoint_height,run.checkpoint_hash]);
  if (block.rowCount!==1) throw searchError('Search indexed block is no longer canonical.');
  const witness=await searchSourceWitness(client,network,run.checkpoint_height);
  if (witness.missingRawTransactions || witness.missingRawCarriers || !sameCanonicalSearchWitness(witness,run.source_witness)) throw searchError('Search coverage changed or raw transaction evidence is incomplete. Refresh after reindexing.',503,'SEARCH_COVERAGE_CHANGED');
  return { run,witness };
}
async function coverageForRun(client,network,run,witness) {
  const result=await client.query(`SELECT protocol,kind,status,valid,record->'source'->>'type' AS type,count(*)::integer AS count
    FROM proof_indexer.search_documents WHERE network=$1 AND run_id=$2
      AND (status='confirmed' OR source_hash=$3::jsonb->>id)
    GROUP BY protocol,kind,status,valid,record->'source'->>'type'`,[network,run.run_id,JSON.stringify(witness.volatileHashes)]);
  const byProtocol=Object.fromEntries(SEARCH_PROTOCOLS.map(protocol=>[protocol,{total:0,confirmed:0,valid:0,invalid:0}])),sourceCounts={ events:0,carriers:0,files:0,transactions:0,scripts:0,confirmed:0,pending:0,dropped:0,orphaned:0 },kinds=new Set();
  for (const row of result.rows) {
    const stats=byProtocol[row.protocol]??={ total:0,confirmed:0,valid:0,invalid:0 };
    const count=Number(row.count); stats.total+=count;
    if (row.status==='confirmed') stats.confirmed+=count;
    if (row.valid===true) stats.valid+=count;
    if (row.valid===false) stats.invalid+=count;
    if (Object.hasOwn(sourceCounts,row.status)) sourceCounts[row.status]+=count;
    const classKey={ event:'events',carrier:'carriers',file:'files',transaction:'transactions',script:'scripts' }[row.type];
    if (classKey) sourceCounts[classKey]+=count;
    kinds.add(row.kind);
  }
  return { ready:true,checkpointHeight:Number(run.checkpoint_height),checkpointHash:run.checkpoint_hash,indexVersion:SEARCH_INDEX_VERSION,
    lastIndexedAt:new Date(run.completed_at).toISOString(),sourceCounts,byProtocol,kinds:[...kinds].sort(),
    witnessSha256:witness.canonicalHash,missingRawTransactions:0,missingRawCarriers:0,
    pendingVisibility:'best-effort',volatileObservationAt:new Date(run.completed_at).toISOString(),
    scope:'complete-at-checkpoint' };
}
async function readTransaction(options,callback) {
  let client;
  try {client=await readerPool(options).connect();}
  catch {throw searchError('Search database evidence is temporarily unavailable.');}
  try {
    await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
    await client.query("SET LOCAL TIME ZONE 'UTC'");
    await client.query('SET LOCAL jit=off');
    await client.query("SET LOCAL statement_timeout='15000ms'");
    const result=await callback(client);
    await client.query('COMMIT'); return result;
  } catch(error) {
    await client.query('ROLLBACK').catch(()=>{});
    if (error.statusCode) throw error;
    throw searchError('Search database evidence is temporarily unavailable.');
  } finally { client.release(); }
}
export async function searchPayload(network,params,options={}) {
  const request=normalizeSearchRequest(network,params),cursor=decodeSearchCursor(request.cursor),queryHash=searchQueryFingerprint(request);
  return readTransaction(options,async client=>{
    const {run,witness}=await readyRun(client,network,options,cursor?.runId??'');
    const paginationHash=request.status==='confirmed'?witness.canonicalHash:searchSha256(witness.canonicalHash+JSON.stringify(witness.volatileHashes));
    if (cursor && (cursor.queryHash!==queryHash || cursor.sourceHash!==paginationHash || cursor.checkpointHash!==run.checkpoint_hash)) throw searchError('Search query or checkpoint changed. Start from the first page.',409,'SEARCH_CURSOR_CHANGED');
    const values=[network,run.run_id,request.q,likeLiteral(request.q),JSON.stringify(witness.volatileHashes)];
    // The canonical witness is checked in this same repeatable-read snapshot.
    // Volatile rows must still match their current observed source hash.
    const filters=['d.network=$1','d.run_id=$2',"(d.status='confirmed' OR d.source_hash=$5::jsonb->>d.id)"];
    const add=value=>{ values.push(value); return `$${values.length}`; };
    if (request.status!=='all') {
      filters.push(`d.status=${add(request.status)}`);
      if (request.status==='confirmed') filters.push('d.canonical=true');
    }
    if (request.validity!=='all') filters.push(`d.valid=${request.validity==='valid'?'true':'false'}`);
    if (request.protocol) filters.push(`d.protocol=${add(request.protocol)}`);
    if (request.kind) filters.push(`d.kind=${add(request.kind)}`);
    filters.push("($3::text='' OR d.search_vector @@ websearch_to_tsquery('simple'::regconfig,$3) OR lower(d.search_text) LIKE $4 ESCAPE E'\\\\')");
    const where=filters.join(' AND '),rank="ts_rank_cd(d.search_vector,websearch_to_tsquery('simple'::regconfig,$3))";
    const position='d.block_height DESC NULLS LAST,d.block_index DESC NULLS LAST,d.vout DESC NULLS LAST,d.ordinal DESC NULLS LAST,d.id COLLATE "C"';
    const ordering=request.sort==='proofs'?`d.amount_proofs DESC,${position}`:request.sort==='oldest'?'d.block_height ASC NULLS LAST,d.block_index ASC NULLS LAST,d.vout ASC NULLS LAST,d.ordinal ASC NULLS LAST,d.id COLLATE "C"':request.sort==='relevance'&&request.q?`${rank} DESC,${position}`:position;
    const totalResult=await client.query(`SELECT count(*)::integer AS total FROM proof_indexer.search_documents d WHERE ${where}`,values);
    const total=Number(totalResult.rows[0].total),offset=cursor?.offset??0;
    if (cursor && offset>=total) throw searchError('Search cursor is outside its result inventory.',409,'SEARCH_CURSOR_CHANGED');
    const limitParam=add(request.limit),offsetParam=add(offset);
    const result=await client.query(`SELECT d.record,d.search_text FROM proof_indexer.search_documents d
      WHERE ${where} ORDER BY ${ordering} LIMIT ${limitParam} OFFSET ${offsetParam}`,values);
    const results=result.rows.map(row=>({...row.record,excerpt:searchExcerpt(row.search_text,request.q)}));
    const end=offset+results.length,hasMore=end<total;
    const coverage=await coverageForRun(client,network,run,witness);
    await verifySearchCheckpoint(options.verifyCheckpoint,network,run.checkpoint_height,run.checkpoint_hash);
    return {network,q:request.q,results,pagination:{limit:request.limit,returned:results.length,total,hasMore,
      nextCursor:hasMore?encodeSearchCursor({runId:run.run_id,queryHash,sourceHash:paginationHash,checkpointHash:run.checkpoint_hash,offset:end}):''},coverage};
  });
}
export async function searchDetailPayload(network,id,params,options={}) {
  if (typeof id!=='string' || id.length>200 || !/^(?:event:[1-9]\d*|(?:carrier|script|file):[0-9a-f]{64}:[0-9]+(?::[0-9]+)?|transaction:[0-9a-f]{64})$/u.test(id)) throw searchError('Invalid Search record identity.',400,'SEARCH_QUERY_INVALID');
  return readTransaction(options,async client=>{
    const {run,witness}=await readyRun(client,network,options);
    const result=await client.query(`${SEARCH_SOURCES_SQL} SELECT d.record,d.payload,d.raw_payload,d.evidence,d.search_text,s.source
      FROM proof_indexer.search_documents d JOIN sources s ON s.id=d.id AND s.source_hash=d.source_hash
      WHERE d.network=$1 AND d.run_id=$3 AND d.id=$4`,[network,run.checkpoint_height,run.run_id,id]);
    if (result.rowCount!==1) throw searchError('Search record is unavailable at the verified checkpoint.',404,'SEARCH_RECORD_UNAVAILABLE');
    const row=result.rows[0],coverage=await coverageForRun(client,network,run,witness);
    await verifySearchCheckpoint(options.verifyCheckpoint,network,run.checkpoint_height,run.checkpoint_hash);
    const output={ network,record:{...row.record,excerpt:searchExcerpt(row.search_text,'')},payload:row.payload,rawPayload:row.raw_payload,
      evidence:{...row.evidence,checkpointHeight:coverage.checkpointHeight,checkpointHash:coverage.checkpointHash,source:row.source},coverage };
    if (Buffer.byteLength(JSON.stringify(output),'utf8')>SEARCH_MAX_DETAIL_BYTES) throw searchError('This evidence exceeds the bounded Search detail envelope. Inspect its source transaction.',413,'SEARCH_DETAIL_TOO_LARGE');
    return output;
  });
}
