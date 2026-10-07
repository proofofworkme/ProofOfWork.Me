import { createHash } from 'node:crypto';
import { TextDecoder } from 'node:util';
import { decodeCanonicalOpReturnOutput, CANONICAL_PROTOCOL_PREFIXES } from './canonical-op-return.mjs';
import { CODE_EMPTY_SHA256 } from '../src/shared/protocol/codeRepository.mjs';

export const SEARCH_INDEX_VERSION = 'proof-search-v2-code';
export const SEARCH_MAX_DETAIL_BYTES = 2_000_000;
export const SEARCH_PROTOCOLS = Object.freeze([...CANONICAL_PROTOCOL_PREFIXES.map(prefix=>prefix.slice(0,-1)),'unknown','transaction']);
const decoder = new TextDecoder('utf-8', { fatal: true });
export function searchError(message, statusCode = 503, code = 'SEARCH_UNAVAILABLE') {
  const error = new Error(message);
  error.statusCode = statusCode;
  error.details = { code };
  return error;
}
export function searchSha256(value) { return createHash('sha256').update(value).digest('hex'); }
export function exactProofs(value) {
  if (typeof value==='number' && !Number.isSafeInteger(value)) throw searchError('Search source contains an inexact proof quantity.');
  const text = typeof value === 'bigint' ? value.toString() : String(value ?? '0');
  if (!/^(?:0|[1-9]\d*)$/u.test(text)) throw searchError('Search source contains an inexact proof quantity.');
  return text;
}
function string(value) { return typeof value === 'string' ? value : ''; }
function numeric(value) { return Number.isSafeInteger(Number(value)) && value !== null ? Number(value) : null; }
function jsonText(value) { return JSON.stringify(value ?? {}); }
function readableText(value) {
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) return value.map(readableText).join('\n');
  if (value && typeof value === 'object') return Object.entries(value).map(([key, item]) => `${key}: ${readableText(item)}`).join('\n');
  return value == null ? '' : String(value);
}
export function decodeSearchBase64(value) {
  if (typeof value !== 'string' || !/^[A-Za-z0-9_-]*$/u.test(value)) return null;
  const bytes = Buffer.from(value, 'base64url');
  return bytes.toString('base64url') === value ? bytes : null;
}
function decodeField(value) {
  const bytes = decodeSearchBase64(value);
  if (!bytes) return null;
  try { return decoder.decode(bytes); } catch { return null; }
}
export function verifiedSearchAttachment(attachment, content = null) {
  if (!attachment || typeof attachment !== 'object') return null;
  const size = numeric(attachment.size ?? attachment.size_bytes);
  const sha256 = string(attachment.sha256).toLowerCase();
  const bytes = content ?? decodeSearchBase64(attachment.data);
  if (size === null || size < 0 || size > SEARCH_MAX_DETAIL_BYTES || !/^[0-9a-f]{64}$/u.test(sha256) ||
      !bytes || bytes.length !== size || searchSha256(bytes) !== sha256) return null;
  return { bytes, file: { name: string(attachment.name), mimeType: string(attachment.mime ?? attachment.mimeType ?? attachment.mime_type), size, sha256 } };
}
export function searchAttachmentFromCarriers(carriers) {
  const chunks = Array.isArray(carriers) ? carriers.filter(value => typeof value === 'string' && value.startsWith('pwm1:a:')) : [];
  if (!chunks.length) return null;
  let metadata, total;
  const parts = new Map();
  for (const chunk of chunks) {
    const match = /^pwm1:a:([^:]*):([^:]*):(0|[1-9]\d*):([0-9a-f]{64}):(0|[1-9]\d*)\/([1-9]\d*):([A-Za-z0-9_-]*)$/u.exec(chunk);
    if (!match) return null;
    const name = decodeField(match[2]), mime = decodeField(match[1]);
    const index = Number(match[5]), count = Number(match[6]), size = Number(match[3]);
    const current = jsonText({ name, mime, size, sha256: match[4] });
    if (name === null || mime === null || !Number.isSafeInteger(index) || !Number.isSafeInteger(count) || count > 1000 || index >= count ||
        (metadata !== undefined && (metadata !== current || total !== count)) || parts.has(index)) return null;
    metadata = current; total = count; parts.set(index, match[7]);
  }
  if (parts.size !== total) return null;
  return verifiedSearchAttachment({ ...JSON.parse(metadata), data: Array.from({ length: total }, (_, index) => parts.get(index)).join('') });
}
export function verifiedSearchFileText(verified) {
  if (!verified) return '';
  const { bytes, file } = verified;
  const textMime = /^(?:text\/|application\/(?:json|ld\+json|xml|xhtml\+xml|javascript|typescript|yaml|x-yaml|toml))/iu.test(file.mimeType);
  const textName = /\.(?:txt|md|markdown|html?|xhtml|json|jsonl|csv|tsv|xml|css|js|mjs|cjs|jsx|ts|tsx|py|rb|rs|go|java|c|h|cpp|hpp|sh|sql|yaml|yml|toml|ini|log)$/iu.test(file.name);
  if (!textMime && !textName) return '';
  try { const text = decoder.decode(bytes); return text.includes('\u0000') ? '' : text; } catch { return ''; }
}
function rawCarriers(source) {
  if (Array.isArray(source.attachmentCarriers)) return source.attachmentCarriers;
  const outputs = source.payload?.vout;
  return Array.isArray(outputs) ? outputs.map(output => decodeCanonicalOpReturnOutput(output)).filter(item => item.decodeValid).map(item => item.text) : [];
}
export function buildSearchDocument(source, sourceHash) {
  if (!source || typeof source !== 'object' || !string(source.id) || !/^[0-9a-f]{64}$/u.test(string(source.txid))) throw searchError('Search source has no exact identity.');
  const payload = source.payload && typeof source.payload === 'object' ? source.payload : {};
  const contentBytes = typeof source.contentBase64 === 'string' ? Buffer.from(source.contentBase64, 'base64') : null;
  const declaredAttachment = payload.attachment ?? (source.protocol === 'pwc1' ? payload.source : null) ?? source.file;
  const carrierAttachment=searchAttachmentFromCarriers(rawCarriers(source));
  const declaredCarrierMatch=!declaredAttachment || (carrierAttachment &&
    String(declaredAttachment.sha256).toLowerCase()===carrierAttachment.file.sha256 &&
    numeric(declaredAttachment.size??declaredAttachment.size_bytes)===carrierAttachment.file.size &&
    string(declaredAttachment.name)===carrierAttachment.file.name &&
    string(declaredAttachment.mime??declaredAttachment.mimeType??declaredAttachment.mime_type)===carrierAttachment.file.mimeType);
  const verified = source.protocol === 'pwc1'
    ? (declaredAttachment?.size === 0 && declaredAttachment.sha256 === CODE_EMPTY_SHA256 &&
        payload.metadata?.size === 0 && payload.metadata.sha256 === CODE_EMPTY_SHA256 && !carrierAttachment
      ? verifiedSearchAttachment(declaredAttachment, Buffer.alloc(0)) : declaredCarrierMatch ? carrierAttachment : null)
    : verifiedSearchAttachment(declaredAttachment, contentBytes) ?? (declaredCarrierMatch?carrierAttachment:null);
  const file = verified?.file ?? (source.file ? { name: string(source.file.name), mimeType: string(source.file.mimeType ?? source.file.mime_type), size: numeric(source.file.size), sha256: string(source.file.sha256) } : undefined);
  const fileText = verifiedSearchFileText(verified);
  const attachmentInvalid = Boolean(declaredAttachment && !verified);
  const record = {
    id: source.id, txid: source.txid, protocol: string(source.protocol) || 'unknown', kind: string(source.kind) || 'raw-carrier',
    status: string(source.status), valid: attachmentInvalid ? false : typeof source.valid === 'boolean' ? source.valid : null,
    validationErrors: [...(Array.isArray(source.validationErrors) ? source.validationErrors : []), ...(attachmentInvalid ? ['search-attachment-bytes-unverified'] : [])],
    title: string(payload.article?.title) || string(payload.title) || string(payload.subject) || string(payload.metadata?.name) || string(payload.path) || string(file?.name) || `${source.protocol || 'Raw'} ${source.kind || 'carrier'}`,
    amountSats: exactProofs(source.amountSats), dataBytes: numeric(source.dataBytes) ?? 0,
    blockHeight: numeric(source.blockHeight), blockHash: string(source.blockHash), blockIndex: numeric(source.blockIndex),
    timestamp: Number.isFinite(Date.parse(source.timestamp)) ? new Date(source.timestamp).toISOString() : '', canonical: source.canonical === true,
    participants: Array.isArray(source.participants) ? source.participants : [], refs: Array.isArray(source.refs) ? source.refs : [],
    source: { vout: numeric(source.vout), ordinal: numeric(source.ordinal), type: string(source.sourceClass) },
    ...(source.protocol === 'pwc1' ? { codeAuthority: { model: 'exact-code-transaction-observation', applied: null,
      requiresRepositoryReplay: true } } : {}),
    ...(file ? { file: { ...file, verified: Boolean(verified), textIndexed: Boolean(fileText) } } : {}),
  };
  const rawPayload = string(source.rawPayload);
  const searchablePayload = source.protocol === 'pwc1' && payload.source
    ? { ...payload, source: { name: payload.source.name, mime: payload.source.mime, size: payload.source.size, sha256: payload.source.sha256 } } : payload;
  const searchText = [record.title, readableText(record), readableText(searchablePayload), rawPayload, string(source.rawHex), readableText(file), fileText].join('\n');
  return { record, payload, rawPayload, searchText, sourceHash,
    evidence: { sourceHash, rawHex: string(source.rawHex), ...(source.scriptHex ? { scriptHex: source.scriptHex } : {}),
      ...(verified ? { fileSha256: verified.file.sha256, fileSize: verified.file.size, fileVerified: true } : {}),
      indexVersion: SEARCH_INDEX_VERSION },
  };
}

// One closed source envelope is used by backfill, corpus witnesses and read-time
// validation. Source bytes/semantic results remain in their original tables.
export const SEARCH_SOURCES_SQL = `
WITH tx AS NOT MATERIALIZED (
  SELECT t.*, (t.status = 'confirmed' AND t.block_height > 0 AND t.block_height <= $2
    AND t.block_index IS NOT NULL AND b.canonical = true AND b.height = t.block_height) AS is_canonical
  FROM proof_indexer.transactions t LEFT JOIN proof_indexer.blocks b
    ON b.network = t.network AND b.block_hash = t.block_hash WHERE t.network = $1
      AND (t.status <> 'confirmed' OR t.block_height IS NULL OR t.block_height <= $2)
), base AS NOT MATERIALIZED (
  SELECT 'event:' || e.event_id::text AS id, 'event' AS source_class,
    jsonb_build_object('id','event:' || e.event_id::text,'sourceClass','event','txid',e.txid,
      'protocol',e.protocol,'kind',e.kind,'status',t.status,'eventStatus',e.status,'valid',e.valid,
      'validationErrors',e.validation_errors,'amountSats',e.amount_sats::text,'dataBytes',e.data_bytes,
      'blockHeight',t.block_height,'blockHash',t.block_hash,'blockIndex',t.block_index,
      'timestamp',COALESCE(t.block_time,e.event_time)::text,'vout',e.op_return_vout,'ordinal',e.record_ordinal,
      'canonical',COALESCE(t.is_canonical AND e.status = 'confirmed' AND e.block_height = t.block_height
        AND e.block_index = t.block_index AND e.block_time IS NOT DISTINCT FROM t.block_time,false),'payload',e.payload,'rawPayload',e.raw_payload,
      'participants',COALESCE((SELECT jsonb_agg(jsonb_build_object('address',p.address,'role',p.role,'powid',p.powid) ORDER BY p.address,p.role)
        FROM proof_indexer.event_participants p WHERE p.event_id=e.event_id),'[]'::jsonb),
      'refs',COALESCE((SELECT jsonb_agg(jsonb_build_object('type',r.ref_type,'value',r.ref_value) ORDER BY r.ref_type,r.ref_value)
        FROM proof_indexer.event_refs r WHERE r.event_id=e.event_id),'[]'::jsonb),
      'attachmentCarriers',CASE WHEN e.kind='file' OR e.payload ? 'attachment' OR e.protocol='pwc1' THEN
        COALESCE((SELECT jsonb_agg(o.payload_text ORDER BY o.vout,o.output_index) FROM proof_indexer.op_returns o
          WHERE o.network=e.network AND o.txid=e.txid AND o.payload_text LIKE 'pwm1:a:%'),'[]'::jsonb) ELSE '[]'::jsonb END) AS source
  FROM proof_indexer.events e JOIN tx t ON t.txid=e.txid WHERE e.network=$1
  UNION ALL
  SELECT 'carrier:' || o.txid || ':' || o.vout || ':' || o.output_index,'carrier',
    jsonb_build_object('id','carrier:' || o.txid || ':' || o.vout || ':' || o.output_index,'sourceClass','carrier',
      'txid',o.txid,'protocol',COALESCE(o.protocol,'unknown'),'kind','raw-carrier','status',t.status,'valid',NULL,
      'canonical',COALESCE(t.is_canonical,false),'amountSats',out.value_sats::text,'dataBytes',o.data_bytes,
      'blockHeight',t.block_height,'blockHash',t.block_hash,'blockIndex',t.block_index,'timestamp',t.block_time::text,
      'vout',o.vout,'ordinal',o.output_index,'payload',jsonb_build_object('text',o.payload_text,'hex',o.payload_hex),
      'rawPayload',o.payload_text,'rawHex',o.payload_hex,'scriptHex',out.scriptpubkey,'participants','[]'::jsonb,'refs','[]'::jsonb)
  FROM proof_indexer.op_returns o JOIN tx t ON t.txid=o.txid JOIN proof_indexer.tx_outputs out
    ON out.network=o.network AND out.txid=o.txid AND out.vout=o.vout WHERE o.network=$1
  UNION ALL
  SELECT 'script:' || o.txid || ':' || o.vout,'script',
    jsonb_build_object('id','script:' || o.txid || ':' || o.vout,'sourceClass','script','txid',o.txid,
      'protocol','unknown','kind','raw-script','status',t.status,'valid',NULL,'canonical',COALESCE(t.is_canonical,false),
      'amountSats',o.value_sats::text,'dataBytes',length(o.scriptpubkey)/2,'blockHeight',t.block_height,
      'blockHash',t.block_hash,'blockIndex',t.block_index,'timestamp',t.block_time::text,'vout',o.vout,'ordinal',0,
      'payload',jsonb_build_object('scriptHex',o.scriptpubkey),'rawHex',o.scriptpubkey,'scriptHex',o.scriptpubkey,
      'participants','[]'::jsonb,'refs','[]'::jsonb)
  FROM proof_indexer.tx_outputs o JOIN tx t ON t.txid=o.txid WHERE o.network=$1 AND left(o.scriptpubkey,2)='6a'
    AND NOT EXISTS (SELECT 1 FROM proof_indexer.op_returns p WHERE p.network=o.network AND p.txid=o.txid AND p.vout=o.vout)
  UNION ALL
  SELECT 'file:' || f.txid || ':' || f.attachment_index,'file',
    jsonb_build_object('id','file:' || f.txid || ':' || f.attachment_index,'sourceClass','file','txid',f.txid,
      'protocol','pwm1','kind','file','status',t.status,'valid',CASE WHEN EXISTS
        (SELECT 1 FROM proof_indexer.events e WHERE e.network=f.network AND e.txid=f.txid AND e.valid AND e.protocol='pwm1'
          AND e.status=t.status AND e.block_height IS NOT DISTINCT FROM t.block_height
          AND e.block_index IS NOT DISTINCT FROM t.block_index AND e.block_time IS NOT DISTINCT FROM t.block_time
          AND e.payload->'attachment'->>'sha256'=f.sha256
          AND (e.payload->'attachment'->>'size')=f.size_bytes::text) THEN true ELSE NULL END,
      'canonical',COALESCE(t.is_canonical AND f.status='confirmed',false),'amountSats','0','dataBytes',f.size_bytes,
      'blockHeight',t.block_height,'blockHash',t.block_hash,'blockIndex',t.block_index,'timestamp',t.block_time::text,
      'vout',NULL,'ordinal',f.attachment_index,'payload',f.metadata,
      'file',jsonb_build_object('name',f.name,'mimeType',f.mime_type,'size',f.size_bytes,'sha256',f.sha256),
      'contentBase64',encode(f.content_bytes,'base64'),'participants','[]'::jsonb,'refs','[]'::jsonb,
      'attachmentCarriers',COALESCE((SELECT jsonb_agg(o.payload_text ORDER BY o.vout,o.output_index)
        FROM proof_indexer.op_returns o WHERE o.network=f.network AND o.txid=f.txid AND o.payload_text LIKE 'pwm1:a:%'),'[]'::jsonb))
  FROM proof_indexer.file_attachments f JOIN tx t ON t.txid=f.txid WHERE f.network=$1
  UNION ALL
  SELECT 'transaction:' || t.txid,'transaction',
    jsonb_build_object('id','transaction:' || t.txid,'sourceClass','transaction','txid',t.txid,'protocol','transaction',
      'kind','transaction','status',t.status,'valid',NULL,'canonical',COALESCE(t.is_canonical,false),'amountSats','0',
      'dataBytes',0,'blockHeight',t.block_height,'blockHash',t.block_hash,'blockIndex',t.block_index,
      'timestamp',COALESCE(t.block_time,t.first_seen_at)::text,'vout',NULL,'ordinal',0,
      'payload',COALESCE(t.raw_tx,'{}'::jsonb),'rawHex',t.raw_hex,'participants','[]'::jsonb,'refs','[]'::jsonb)
  FROM tx t
), sources AS NOT MATERIALIZED (
  SELECT id,source_class,source,encode(sha256(convert_to(source::text,'UTF8')),'hex') AS source_hash
  FROM base
)
`;
export const SEARCH_SOURCE_KEYS_SQL = `WITH tx AS NOT MATERIALIZED (
  SELECT txid,status,block_height FROM proof_indexer.transactions WHERE network=$1
    AND (status <> 'confirmed' OR block_height IS NULL OR block_height <= $2)
), keys AS (
  SELECT 'event:' || e.event_id::text AS id,t.status,t.block_height FROM proof_indexer.events e JOIN tx t ON t.txid=e.txid WHERE e.network=$1
  UNION ALL SELECT 'carrier:' || o.txid || ':' || o.vout || ':' || o.output_index,t.status,t.block_height FROM proof_indexer.op_returns o JOIN tx t ON t.txid=o.txid WHERE o.network=$1
  UNION ALL SELECT 'script:' || o.txid || ':' || o.vout,t.status,t.block_height FROM proof_indexer.tx_outputs o JOIN tx t ON t.txid=o.txid WHERE o.network=$1 AND left(o.scriptpubkey,2)='6a'
    AND NOT EXISTS (SELECT 1 FROM proof_indexer.op_returns p WHERE p.network=o.network AND p.txid=o.txid AND p.vout=o.vout)
  UNION ALL SELECT 'file:' || f.txid || ':' || f.attachment_index,t.status,t.block_height FROM proof_indexer.file_attachments f JOIN tx t ON t.txid=f.txid WHERE f.network=$1
  UNION ALL SELECT 'transaction:' || t.txid,t.status,t.block_height FROM tx t
)`;
export async function readSearchSources(client, network, height, after = '', limit = 200, volatileOnly = false, floorHeight = 0) {
  const keys = await client.query(`${SEARCH_SOURCE_KEYS_SQL} SELECT id FROM keys WHERE id COLLATE "C" > $3 COLLATE "C"
    AND (status<>'confirmed' OR (NOT $5::boolean AND (block_height IS NULL OR block_height>$6)))
    ORDER BY id COLLATE "C" LIMIT $4`, [network,height,after,limit,volatileOnly,floorHeight]);
  if (!keys.rowCount) return [];
  const result = await client.query(`${SEARCH_SOURCES_SQL} SELECT * FROM sources WHERE id=ANY($3::text[]) ORDER BY id COLLATE "C"`, [network,height,keys.rows.map(row=>row.id)]);
  return result.rows;
}
export async function searchSourceWitness(client, network, height) {
  const result = await client.query(`${SEARCH_SOURCES_SQL}, hashes AS MATERIALIZED (
    SELECT id,source_class,source->>'status' AS status,(source->>'canonical')::boolean AS canonical,source_hash,
      (source_class='transaction' AND (jsonb_typeof(source->'payload'->'vin') IS DISTINCT FROM 'array'
        OR jsonb_typeof(source->'payload'->'vout') IS DISTINCT FROM 'array')) AS raw_missing
    FROM sources
  )
    SELECT count(*)::integer AS total,
      count(*) FILTER (WHERE status='confirmed')::integer AS confirmed_records,
      count(*) FILTER (WHERE status='confirmed' AND canonical)::integer AS confirmed,
      encode(sha256(convert_to(COALESCE(string_agg(id || ':' || source_hash, E'\\n' ORDER BY id COLLATE "C")
        FILTER (WHERE status='confirmed'),'') ,'UTF8')),'hex') AS canonical_hash,
      COALESCE(jsonb_object_agg(id,source_hash) FILTER (WHERE status<>'confirmed'),'{}'::jsonb) AS volatile_hashes,
      count(*) FILTER (WHERE status='confirmed' AND raw_missing)::integer AS missing_raw_transactions
    FROM hashes`, [network,height]);
  const row = result.rows[0];
  // A transaction envelope alone does not prove decoded carrier completeness.
  // Every confirmed raw nulldata script must have the exact normalized output
  // that either supplies carrier rows or the raw-script fallback above.
  const rawCoverage=await client.query(`WITH raw_outputs AS (
    SELECT t.txid,COALESCE(NULLIF(o.item->>'n','')::integer,o.position::integer-1) AS vout,
      lower(COALESCE(o.item->>'scriptpubkey',o.item->'scriptPubKey'->>'hex',o.item->>'scriptPubKeyHex','')) AS script
    FROM proof_indexer.transactions t CROSS JOIN LATERAL jsonb_array_elements(
      CASE WHEN jsonb_typeof(t.raw_tx->'vout')='array' THEN t.raw_tx->'vout' ELSE '[]'::jsonb END
    ) WITH ORDINALITY o(item,position)
    WHERE t.network=$1 AND t.status='confirmed' AND (t.block_height IS NULL OR t.block_height<=$2)
  ) SELECT count(*)::integer AS missing FROM raw_outputs r WHERE left(r.script,2)='6a'
    AND NOT EXISTS(SELECT 1 FROM proof_indexer.tx_outputs p WHERE p.network=$1 AND p.txid=r.txid
      AND p.vout=r.vout AND lower(p.scriptpubkey)=r.script)`,[network,height]);
  return { total:Number(row.total), confirmed:Number(row.confirmed), confirmedRecords:Number(row.confirmed_records), canonicalHash:row.canonical_hash,
    volatileHashes:row.volatile_hashes, missingRawTransactions:Number(row.missing_raw_transactions),missingRawCarriers:Number(rawCoverage.rows[0].missing) };
}
export function sameCanonicalSearchWitness(left, right) {
  return left?.canonicalHash === right?.canonicalHash && left?.confirmed === right?.confirmed &&
    left?.confirmedRecords === right?.confirmedRecords && left?.missingRawTransactions === right?.missingRawTransactions &&
    left?.missingRawCarriers === right?.missingRawCarriers;
}
export async function readSearchCheckpoint(client, network) {
  const result = await client.query(`SELECT indexed_through_block AS height,
    COALESCE(payload->>'indexedThroughBlockHash',source_hashes->>'blockScan') AS hash
    FROM proof_indexer.ledger_snapshots WHERE network=$1 AND source_hashes ? 'blockScan'
      AND NOT (source_hashes ? 'canonicalSummary')
    ORDER BY indexed_through_block DESC,generated_at DESC LIMIT 1`, [network]);
  const row = result.rows[0];
  if (!row || !Number.isSafeInteger(Number(row.height)) || Number(row.height) < 1 || !/^[0-9a-f]{64}$/u.test(row.hash)) throw searchError('A hash-bound protocol scan checkpoint is unavailable.');
  const block = await client.query('SELECT 1 FROM proof_indexer.blocks WHERE network=$1 AND height=$2 AND block_hash=$3 AND canonical=true', [network,row.height,row.hash]);
  if (block.rowCount !== 1) throw searchError('Search checkpoint is not a unique canonical block.');
  return { height:Number(row.height), hash:row.hash };
}
export async function verifySearchCheckpoint(verifyCheckpoint, network, height, hash) {
  if (typeof verifyCheckpoint !== 'function') throw searchError('Full-node Search checkpoint verification is unavailable.');
  const result = await verifyCheckpoint(height,network,hash);
  const proved = result === true || result === hash || result?.hash === hash || result?.blockHash === hash;
  if (!proved) throw searchError('Search checkpoint no longer matches the full node.',503,'SEARCH_CHECKPOINT_CHANGED');
}
