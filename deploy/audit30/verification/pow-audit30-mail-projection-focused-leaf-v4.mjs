import {createHash} from 'node:crypto';
import {createProofIndexPool} from '/usr/local/lib/proofofwork-audit30-mail-projection-focused-v4/server/db/postgres.mjs';
import {PROOF_INDEX_RENDERED_MAIL_KINDS,PROOF_INDEX_MAIL_PROJECTION_PARITY_MODEL,proofIndexCanonicalMailProjectionParity} from '/usr/local/lib/proofofwork-audit30-mail-projection-focused-v4/server/proof-index-mail-projection.mjs';
const hash=v=>createHash('sha256').update(v).digest('hex');
const fields=new Set(['amount_sats','body_text','data_bytes','event_time','message','network','parent_txid','sender_address','status','subject','txid']);
export function summarize(parity,known) {
 if(parity.model!==PROOF_INDEX_MAIL_PROJECTION_PARITY_MODEL||typeof parity.ready!=='boolean'||!Array.isArray(known)||known.length!==16||new Set(known).size!==16||known.some(t=>! /^[0-9a-f]{64}$/u.test(t)))throw Error('SUMMARY_SHAPE');
 const out={model:parity.model,ready:parity.ready};
 for(const [k,v]of Object.entries(parity))if(k.endsWith('Count')){if(!Number.isSafeInteger(v)||v<0||v>10000)throw Error('COUNT');out[k]=v;}else if(k.endsWith('Sha256')){if(!/^[0-9a-f]{64}$/u.test(v))throw Error('HASH');out[k]=v;}
 const sample=parity.mismatchedSample;if(!Array.isArray(sample)||sample.length>20||sample.length>parity.mismatchedCount)throw Error('SAMPLE');
 const histogram={};for(const row of sample){if(row.network!=='livenet'||! /^[0-9a-f]{64}$/u.test(row.txid)||!Array.isArray(row.fields)||!row.fields.length||new Set(row.fields).size!==row.fields.length||row.fields.some(f=>!fields.has(f)))throw Error('MISMATCH_SHAPE');for(const f of row.fields)histogram[f]=(histogram[f]??0)+1;}
 const complete=sample.length===parity.mismatchedCount,ids=sample.map(r=>r.txid).sort();
 if(new Set(ids).size!==ids.length)throw Error('DUPLICATE_SAMPLE');
 out.mismatchSampleComplete=complete;out.fieldHistogram=histogram;out.mismatchedTxidSHA256=sample.map(r=>({txidSHA256:hash(r.txid),fields:r.fields}));out.mismatchedTxidSetSHA256=hash(JSON.stringify(ids));out.knownSixteenTxidSetSHA256=hash(JSON.stringify([...known].sort()));
 out.allMismatchesBodyOnly=complete&&sample.every(r=>r.fields.length===1&&r.fields[0]==='body_text');out.allMismatchTxidsInKnownSixteen=complete&&ids.every(t=>known.includes(t));out.exactKnownSixteen=complete&&ids.length===16&&JSON.stringify(ids)===JSON.stringify([...known].sort());return out;
}
export async function readMailOnly(client) {
 await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
 try {
 await client.query("SET LOCAL statement_timeout='20s'; SET LOCAL lock_timeout='3s'; SET LOCAL idle_in_transaction_session_timeout='10s'; SET LOCAL work_mem='8MB'; SET LOCAL temp_file_limit='32MB'");
 const fence=(await client.query("SELECT current_setting('transaction_read_only') AS read_only,pg_current_snapshot()::text AS snapshot")).rows[0];if(fence.read_only!=='on')throw Error('NOT_READONLY');
 const event=(await client.query(`SELECT event.event_id::text AS event_id,event.network,event.txid,event.protocol,event.kind,event.valid,event.amount_sats::text,event.data_bytes,event.event_time,event.payload,event.status FROM proof_indexer.events event WHERE event.network=$1 AND event.status IN ('pending','confirmed','dropped','orphaned') AND event.protocol='pwm1' AND event.valid=true AND event.kind=ANY($2::text[]) ORDER BY event.event_id ASC`,['livenet',PROOF_INDEX_RENDERED_MAIL_KINDS])).rows;
 const mail=(await client.query(`SELECT mail.network,mail.txid,mail.status,mail.sender_address,mail.subject,mail.parent_txid,mail.body_text,mail.amount_sats::text,mail.data_bytes,mail.message,mail.event_time FROM proof_indexer.mail_items mail WHERE mail.network=$1 ORDER BY mail.txid ASC`,['livenet'])).rows;
 const tx=(await client.query(`SELECT transaction_row.network,transaction_row.txid,transaction_row.status,transaction_row.raw_tx FROM proof_indexer.transactions transaction_row WHERE transaction_row.network=$1 AND (EXISTS (SELECT 1 FROM proof_indexer.events event WHERE event.network=transaction_row.network AND event.txid=transaction_row.txid AND event.protocol='pwm1' AND event.kind=ANY($2::text[]) AND event.status IN ('pending','confirmed','dropped','orphaned') AND event.valid=true) OR (jsonb_typeof(transaction_row.raw_tx->'item')='object' AND lower(btrim(COALESCE(transaction_row.raw_tx->'item'->>'kind','')))=ANY($2::text[]))) ORDER BY transaction_row.txid ASC`,['livenet',PROOF_INDEX_RENDERED_MAIL_KINDS])).rows;
 for(const rows of[event,mail,tx])if(rows.length>10000||Buffer.byteLength(JSON.stringify(rows))>32*1024**2||rows.some(r=>Buffer.byteLength(JSON.stringify(r))>2*1024**2))throw Error('ROW_BOUND');
 const p=proofIndexCanonicalMailProjectionParity({eventRows:event,mailRows:mail,transactionRows:tx});
 await client.query('ROLLBACK');return {parity:p,readOnly:true,snapshotSHA256:hash(fence.snapshot),population:{eventRows:event.length,mailRows:mail.length,transactionRows:tx.length}};
 }catch(e){await client.query('ROLLBACK').catch(()=>{});throw e;}
}
export async function run(known){if(process.getuid()!==108||process.getgid()!==112)throw Error('NATIVE_PG_IDENTITY');const pool=createProofIndexPool();let client;try{client=await pool.connect();const result=await readMailOnly(client);return {...result,parity:summarize(result.parity,known),nativeUid:process.getuid(),nativeGid:process.getgid(),moduleGraphReadableBeforeDatabase:true};}finally{client?.release();await pool.end();}}
