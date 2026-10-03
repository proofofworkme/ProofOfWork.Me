#!/usr/bin/env node
// Private-clone-only body repair rehearsal. No live apply command exists.
import fs from 'node:fs';
import crypto from 'node:crypto';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
export const MODEL='pow-audit30-mail-body-private-rehearsal-plan-v1';
export const MAX_ROWS=10000, MAX_TARGETS=128;
const HEX=/^[a-f0-9]{64}$/;
const need=(x,c)=>{if(!x)throw new Error(c);};
export const hash=b=>crypto.createHash('sha256').update(b).digest('hex');
const quote=s=>JSON.stringify(s).replace(/[\u0080-\uffff]/g,c=>'\\u'+c.charCodeAt(0).toString(16).padStart(4,'0'));
export function encoded(v){if(Array.isArray(v))return `[${v.map(encoded).join(',')}]`;if(v&&typeof v==='object')return `{${Object.keys(v).sort().map(k=>`${quote(k)}:${encoded(v[k])}`).join(',')}}`;return typeof v==='string'?quote(v):JSON.stringify(v);}
const equal=(a,b)=>encoded(a)===encoded(b);
const b64=s=>{need(typeof s==='string'&&/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(s),'BASE64_SHAPE');return Buffer.from(s,'base64');};
const bodyDigest=v=>{need(v===null||typeof v==='string','BODY_TYPE');const b=Buffer.from(v??'','utf8');return {isNull:v===null,bytes:b.length,sha256:hash(b)};};
function decodedPush(hex){need(typeof hex==='string'&&/^(?:[0-9a-f]{2})+$/.test(hex),'SCRIPT_HEX');const b=Buffer.from(hex,'hex');need(b[0]===106,'NOT_OP_RETURN');let at=1,parts=[];while(at<b.length){let n=b[at++];if(n>=76&&n<=78){let w=2**(n-76);need(at+w<=b.length,'PUSH_TRUNCATED');n=b.readUIntLE(at,w);at+=w;}else need(n<=75,'OP_RETURN_NON_PUSH');need(at+n<=b.length,'PUSH_TRUNCATED');parts.push(b.subarray(at,at+n));at+=n;}return Buffer.concat(parts);}
export function rawBody(ops){need(Array.isArray(ops),'OP_RETURN_ROWS');const groups=new Map();for(const r of ops){need(Number.isSafeInteger(r.vout)&&r.vout>=0&&Number.isSafeInteger(r.output_index)&&r.output_index>=0,'OP_RETURN_POSITION');if(!groups.has(r.vout))groups.set(r.vout,[]);groups.get(r.vout).push(r);}
 let chunks=[],carriers=[];
 for(const [vout,rows] of [...groups].sort((a,b)=>a[0]-b[0])){rows.sort((a,b)=>a.output_index-b.output_index);need(new Set(rows.map(x=>x.output_index)).size===rows.length,'DUPLICATE_ORDINAL');const script=rows[0].scriptpubkey;need(rows.every(r=>r.scriptpubkey===script),'SCRIPT_ROW_DISAGREEMENT');const raw=decodedPush(script);need(rows.every(r=>typeof r.payload_hex==='string'&&/^(?:[0-9a-f]{2})*$/.test(r.payload_hex)),'PAYLOAD_HEX');const stored=Buffer.concat(rows.map(r=>Buffer.from(r.payload_hex,'hex')));need(raw.equals(stored),'SCRIPT_PAYLOAD_BYTES');for(const r of rows){const b=Buffer.from(r.payload_hex,'hex');need(b.length===r.data_bytes&&Buffer.from(r.payload_text,'utf8').equals(b),'OP_RETURN_UTF8_SIZE');}
 if(raw.subarray(0,5).equals(Buffer.from('pwm1:'))){carriers.push(vout);if(raw.subarray(0,7).equals(Buffer.from('pwm1:m:')))chunks.push(raw.subarray(7));}}
 if(carriers.length)for(const [vout,rows] of groups){if(vout>carriers[0]&&vout<carriers.at(-1)){const r=decodedPush(rows[0].scriptpubkey).toString('utf8');need(!['pwa1:','pwid1:','pwdns1:','pwb1:','pwt1:'].some(p=>r.startsWith(p)),'NONCONTIGUOUS_ENVELOPE');}}
 const b=Buffer.concat(chunks),text=b.toString('utf8');need(Buffer.from(text,'utf8').equals(b)&&!text.includes('\0'),'BODY_ENCODING');return text;
}
export function validatePlan(plan,engineSHA){
 need(plan?.schema===MODEL&&equal(Object.keys(plan).sort(),['manifest','manifestSHA256','schema','snapshotRawBase64','sourceRows','targets'].sort()),'PLAN_SHAPE');const m=plan.manifest;
 need(m?.schema==='pow-audit30-mail-body-proposed-exact-manifest-v1'&&m.productionApplyApproved===false&&m.network==='livenet'&&m.transactionEngineSHA256===engineSHA&&HEX.test(engineSHA),'PLAN_AUTHORITY');need(hash(encoded(m))===plan.manifestSHA256,'MANIFEST_DIGEST');
 need(Array.isArray(plan.sourceRows)&&plan.sourceRows.length<=MAX_ROWS&&plan.sourceRows.length===m.populationRows&&Array.isArray(plan.targets)&&plan.targets.length<=MAX_TARGETS&&plan.targets.length===m.targetCount&&Array.isArray(m.targets)&&m.targets.length===plan.targets.length,'POPULATION_COUNT');
 const snapshot=JSON.parse(b64(plan.snapshotRawBase64).toString('utf8'));need(snapshot.phase==='snapshot'&&snapshot.transactionReadOnly==='on'&&snapshot.mailRows===plan.sourceRows.length,'SNAPSHOT_BINDING');
 const rows=new Map();let last='';for(const r of plan.sourceRows){need(HEX.test(r.txid)&&r.txid>last,'SOURCE_ORDER');last=r.txid;const raw=b64(r.recordBase64);need(raw.length<=8*1024**2&&hash(raw)===r.recordSHA256,'SOURCE_RAW_HASH');const parsed=JSON.parse(raw.toString('utf8'));need(parsed.phase==='row'&&parsed.network==='livenet'&&parsed.txid===r.txid&&parsed.mail&&parsed.mail.txid===r.txid,'SOURCE_IDENTITY');rows.set(r.txid,{raw:raw.toString('utf8'),row:parsed,sha:r.recordSHA256});}
 last='';for(let i=0;i<plan.targets.length;i++){const t=plan.targets[i],r=rows.get(t.txid),pub=m.targets[i];need(t.txid>last&&t.network==='livenet'&&r&&t.rawSourceRecordSHA256===r.sha,'TARGET_SOURCE_BINDING');last=t.txid;
 const x=r.row,e=x.events?.[0];need(x.events?.length===1&&e.valid===true&&e.status==='confirmed'&&e.protocol==='pwm1'&&x.mail.status==='confirmed'&&x.transaction.status==='confirmed'&&x.canonicalBlock===true,'TARGET_CONFIRMED_EVENT');need(x.mail.body_text===t.oldBody&&rawBody(x.opReturns)===t.newBody&&(e.payload.body??e.payload.message??e.payload.memo??'')===t.newBody,'TARGET_RAW_BODY');need(typeof t.newBody==='string'&&t.newBody.length>0&&t.oldBody!==t.newBody&&(t.oldBody??'')===t.newBody.trim(),'TARGET_TRIM_ONLY');
 const proof=t.publicProof,core=proof?.canonicalCore;need(proof?.bodyOnlyRepairCandidate===true&&proof.network==='livenet'&&proof.txid===t.txid&&proof.status==='confirmed'&&equal(proof.storedBody,bodyDigest(t.oldBody))&&equal(proof.rawBody,bodyDigest(t.newBody)),'TARGET_PUBLIC_PROOF');need(core?.coreScriptsBound===true&&core.blockHash===x.transaction.blockHash&&core.blockHeight===x.transaction.blockHeight&&core.blockIndex===x.transaction.blockIndex&&e.block_height===core.blockHeight&&e.block_index===core.blockIndex,'TARGET_CORE_POSITION');need(equal(pub,{network:t.network,txid:t.txid,sourceRecordSHA256:t.rawSourceRecordSHA256,proof}),'TARGET_MANIFEST_BINDING');}
 return rows;
}
export const SQL={
 begin:'BEGIN TRANSACTION ISOLATION LEVEL SERIALIZABLE READ WRITE',
 settings:"SET LOCAL statement_timeout='30s'; SET LOCAL lock_timeout='3s'; SET LOCAL idle_in_transaction_session_timeout='30s'; SET LOCAL temp_file_limit='64MB'; SET LOCAL timezone='UTC'; SET LOCAL log_parameter_max_length=0; SET LOCAL log_parameter_max_length_on_error=0",
 locks:'LOCK TABLE proof_indexer.blocks,proof_indexer.transactions,proof_indexer.tx_outputs,proof_indexer.op_returns,proof_indexer.events,proof_indexer.meta IN SHARE MODE; LOCK TABLE proof_indexer.mail_items IN SHARE ROW EXCLUSIVE MODE',
 identity:"SELECT jsonb_build_object('dataDirectory',current_setting('data_directory'),'socket',current_setting('unix_socket_directories'),'listenAddresses',current_setting('listen_addresses'),'port',current_setting('port'),'readOnly',current_setting('default_transaction_read_only'),'checksums',current_setting('data_checksums'),'user',current_user,'database',current_database(),'serverAddress',inet_server_addr()) AS value",
 trigger:"SELECT count(*)::int AS count FROM pg_trigger WHERE tgrelid='proof_indexer.mail_items'::regclass AND NOT tgisinternal AND tgenabled<>'D'",
 baseline:'CREATE TEMP TABLE audit30_mail_before ON COMMIT DROP AS SELECT network,txid,to_jsonb(m) AS value FROM proof_indexer.mail_items m',
 source:`SELECT to_jsonb(m)=$1::jsonb->'mail' AS mail_match,
 jsonb_build_object('status',t.status,'blockHash',t.block_hash,'blockHeight',t.block_height,'blockIndex',t.block_index)=$1::jsonb->'transaction' AS transaction_match,
 (b.canonical IS TRUE)=($1::jsonb->>'canonicalBlock')::boolean AS block_match,
 (SELECT coalesce(jsonb_agg(to_jsonb(e) ORDER BY e.op_return_vout,e.record_ordinal,e.event_id),'[]'::jsonb) FROM proof_indexer.events e WHERE e.network=m.network AND e.txid=m.txid AND e.protocol='pwm1' AND e.valid AND e.kind=ANY(ARRAY['attachment','browser','file','inception-bond','infinity-bond','mail','reply']::text[]))=$1::jsonb->'events' AS events_match,
 (SELECT coalesce(jsonb_agg(jsonb_build_object('vout',o.vout,'output_index',o.output_index,'payload_hex',o.payload_hex,'payload_text',o.payload_text,'data_bytes',o.data_bytes,'scriptpubkey',x.scriptpubkey) ORDER BY o.vout,o.output_index),'[]'::jsonb) FROM proof_indexer.op_returns o JOIN proof_indexer.tx_outputs x USING(network,txid,vout) WHERE o.network=m.network AND o.txid=m.txid)=$1::jsonb->'opReturns' AS carriers_match
 FROM proof_indexer.mail_items m LEFT JOIN proof_indexer.transactions t USING(network,txid) LEFT JOIN proof_indexer.blocks b ON b.network=t.network AND b.block_hash=t.block_hash AND b.height=t.block_height WHERE m.network='livenet' AND m.txid=$2`,
 update:`UPDATE proof_indexer.mail_items AS m SET body_text=$1 WHERE m.network='livenet' AND m.txid=$2 AND m.status='confirmed' AND m.body_text IS NOT DISTINCT FROM $3 AND to_jsonb(m)=($4::jsonb->'mail') RETURNING m.txid`,
 invariance:`SELECT (SELECT count(*) FROM proof_indexer.mail_items)::int=(SELECT count(*) FROM audit30_mail_before)::int AS same_count,
 NOT EXISTS(SELECT 1 FROM proof_indexer.mail_items m FULL JOIN audit30_mail_before p USING(network,txid) WHERE m.txid IS NULL OR p.txid IS NULL OR (to_jsonb(m)-'body_text')<>(p.value-'body_text')) AS all_nonbody_same,
 NOT EXISTS(SELECT 1 FROM proof_indexer.mail_items m JOIN audit30_mail_before p USING(network,txid) WHERE NOT (m.network='livenet' AND m.txid=ANY($1::text[])) AND to_jsonb(m)<>p.value) AS nontarget_same,
 NOT EXISTS(SELECT 1 FROM proof_indexer.mail_items m JOIN audit30_mail_before p USING(network,txid) WHERE m.network<>'livenet' AND to_jsonb(m)<>p.value) AS other_network_same`,
 fullFingerprint: `SELECT count(*)::int AS count, coalesce(sum(octet_length(to_jsonb(m)::text)),0)::text AS logical_bytes, encode(sha256(convert_to(coalesce(string_agg(encode(sha256(convert_to(to_jsonb(m)::text,'UTF8')),'hex'),'' ORDER BY network,txid),''),'UTF8')),'hex') AS sha256 FROM proof_indexer.mail_items m`,
 inverseUpdate: `UPDATE proof_indexer.mail_items AS m SET body_text=$1 WHERE m.network='livenet' AND m.txid=$2 AND m.status='confirmed' AND m.body_text IS NOT DISTINCT FROM $3 AND to_jsonb(m)=jsonb_set(($4::jsonb->'mail'),'{body_text}',to_jsonb($3::text),false) RETURNING m.txid`,
 exactTargets:"SELECT txid,body_text FROM proof_indexer.mail_items WHERE network='livenet' AND txid=ANY($1::text[]) ORDER BY txid",
 rollback:'ROLLBACK',
};
export async function rehearse(client,plan,options){
 const {engineSHA,privateJob,durable,fence,cloneSubset=false}=options;const rows=validatePlan(plan,engineSHA);
 need(/^\/data\/proofofwork-audit30-inspect-\d{8}T\d{6}Z$/.test(privateJob),'NEW_PRIVATE_JOB_ONLY');need(typeof durable==='function'&&typeof fence==='function','CUSTODY_AND_FENCE_REQUIRED');const started=Date.now();let phase='admission',begun=false,rolledBack=false,selected=[],missing=[],baselineFingerprint=null;
 const guard=()=>{need(Date.now()-started<=45000,'WHOLE_TRANSACTION_45S_BOUND');if(options.signal?.aborted)throw new Error('REHEARSAL_INTERRUPTED');};
 const query=async(text,values)=>{guard();const r=await client.query({text,values,query_timeout:Math.max(1,45000-(Date.now()-started))});guard();return r;};
 const exactTrue=r=>r?.rows?.length===1&&Object.values(r.rows[0]).every(v=>v===true);
 try{
  await fence('before-transaction');guard();await durable('intent',{schema:'pow-audit30-private-mail-rehearsal-intent-v1',manifestSHA256:plan.manifestSHA256,privateJob,rollbackOnly:true,productionMutation:false});
  await query(SQL.begin);begun=true;phase='settings';await query(SQL.settings);phase='fixed-source-locks';await query(SQL.locks);
  // No source snapshot or catalog read is issued before the fixed locks.
  phase='private-identity';const identity=(await query(SQL.identity)).rows?.[0]?.value;need(equal(identity,{dataDirectory:privateJob+'/cluster',socket:privateJob+'/socket',listenAddresses:'',port:'55432',readOnly:'on',checksums:'on',user:'postgres',database:'proof_indexer',serverAddress:null}),'PRIVATE_IDENTITY');need((await query(SQL.trigger)).rows?.[0]?.count===0,'MAIL_WRITE_TRIGGER_REFUSED');
  phase='full-mail-baseline';baselineFingerprint=(await query(SQL.fullFingerprint)).rows?.[0];need(Number.isSafeInteger(baselineFingerprint?.count)&&baselineFingerprint.count<=20000&&/^[0-9]+$/.test(baselineFingerprint.logical_bytes)&&BigInt(baselineFingerprint.logical_bytes)<=256n*1024n*1024n&&HEX.test(baselineFingerprint.sha256),'FULL_MAIL_BASELINE_BOUND');await query(SQL.baseline);
  phase='exact-source-preimages';for(const t of plan.targets){const r=await query(SQL.source,[rows.get(t.txid).raw,t.txid]);if(cloneSubset&&r.rows.length===0){missing.push(t.txid);continue;}need(exactTrue(r),'TARGET_SOURCE_PREIMAGE_DRIFT');selected.push(t);}
  if(!cloneSubset){for(const r of rows.values()){need(exactTrue(await query(SQL.source,[r.raw,r.row.txid])),'FULL_MAIL_SOURCE_PREIMAGE_DRIFT');}}
  phase='pre-update-fence';await fence('before-update');guard();await durable('selected-preimages',{manifestSHA256:plan.manifestSHA256,targets:selected.map(t=>({txid:t.txid,oldBody:t.oldBody,newBody:t.newBody,rawSourceRecord:rows.get(t.txid).raw})),private:true});
  phase='body-only-update';for(const t of selected){const r=await query(SQL.update,[t.newBody,t.txid,t.oldBody,rows.get(t.txid).raw]);need(r.rowCount===1&&r.rows?.length===1&&r.rows[0].txid===t.txid,'EXACT_ONE_BODY_UPDATE');}
  phase='full-invariance';const ids=selected.map(t=>t.txid);need(exactTrue(await query(SQL.invariance,[ids])),'ALL_MAIL_INVARIANCE');const changed=(await query(SQL.exactTargets,[ids])).rows;need(equal(changed,selected.map(t=>({txid:t.txid,body_text:t.newBody}))),'EXACT_TARGET_POSTIMAGES');await fence('before-inverse');guard();
  phase='private-inverse-sql-proof';for(const t of selected){const r=await query(SQL.inverseUpdate,[t.oldBody,t.txid,t.newBody,rows.get(t.txid).raw]);need(r.rowCount===1&&r.rows?.length===1&&r.rows[0].txid===t.txid,'EXACT_ONE_INVERSE_BODY_UPDATE');}need(equal((await query(SQL.fullFingerprint)).rows?.[0],baselineFingerprint),'INVERSE_FULL_MAIL_NOT_RESTORED');await fence('before-rollback');guard();
  phase='explicit-rollback';await query(SQL.rollback);begun=false;rolledBack=true;phase='rollback-verification';for(const t of selected)need(exactTrue(await query(SQL.source,[rows.get(t.txid).raw,t.txid])),'ROLLBACK_TARGET_NOT_RESTORED');
  need(equal((await query(SQL.fullFingerprint)).rows?.[0],baselineFingerprint),'ROLLBACK_FULL_MAIL_NOT_RESTORED');await fence('after-rollback');guard();const receipt={schema:'pow-audit30-private-mail-body-rehearsal-completed-v1',status:'passed',manifestSHA256:plan.manifestSHA256,manifestTargetCount:plan.targets.length,selectedCloneTargetCount:selected.length,selectedTxids:selected.map(t=>t.txid),missingCloneCandidateCount:missing.length,missingCloneCandidateTxids:missing,baselineNativeMailFingerprint:baselineFingerprint,exactInverseBodySqlExercised:true,rollbackAcknowledged:true,privateOriginalRowsRestored:true,allCloneNonbodyAndNontargetRowsUnchanged:true,productionMutation:false,cloneSubsetQualified:cloneSubset,sourceCoreProofConsumedFromCapture:true,newCoreReplayClaimed:false,wholeMilliseconds:Date.now()-started};await durable('completed',receipt);return receipt;
 }catch(e){if(begun){try{await client.query({text:SQL.rollback,query_timeout:5000});rolledBack=true;}catch{rolledBack=false;}}
  await durable('failed',{schema:'pow-audit30-private-mail-body-rehearsal-failed-v1',status:'failed',manifestSHA256:plan.manifestSHA256,phase,errorCode:/^[A-Z0-9_]+$/.test(e.message)?e.message:'DETAIL_REDACTED',rollbackAcknowledged:rolledBack,productionMutation:false,automaticRetry:false,privateEvidenceRetained:true});throw e;
 }
}
// The native adapter is deliberately private/rollback-only. The inspector owns
// namespace, managed credentials, dependency closure and outside-live fences.
export async function nativeMain(argv){
 need(argv.length===6,'FIXED_NATIVE_ARGV');const [planPath,planSHA,privateJob,pgPath,pgSHA,receiptPrefix]=argv;
 need(/^\/data\/proofofwork-audit30-inspect-\d{8}T\d{6}Z$/.test(privateJob),'NEW_PRIVATE_JOB_ONLY');
 need(HEX.test(planSHA)&&HEX.test(pgSHA)&&/^phase4-body-rehearsal-[a-z0-9-]+$/.test(receiptPrefix),'NATIVE_PINS');const file=fileURLToPath(import.meta.url),engineSHA=hash(fs.readFileSync(file));
 const read=(p,limit)=>{need(path.isAbsolute(p)&&fs.realpathSync(p)===p,'NATIVE_CANONICAL_PATH');const s=fs.lstatSync(p);need(s.isFile()&&!s.isSymbolicLink()&&s.nlink===1&&s.size<=limit&&(s.mode&0o022)===0,'NATIVE_FILE_MODE');return fs.readFileSync(p);};
 need(path.dirname(planPath)===path.dirname(file)&&path.basename(planPath)==='phase4-private-plan.json','PLAN_FIXED_PACKAGE');const raw=read(planPath,360*1024**2);need(hash(raw)===planSHA,'PRIVATE_PLAN_HASH');const plan=JSON.parse(raw);validatePlan(plan,engineSHA);
 need(pgPath===path.join(path.dirname(file),'pg-dependencies','pg','lib','index.js'),'PG_FIXED_CLOSURE');need(hash(read(pgPath,1024**2))===pgSHA,'PG_ENTRY_HASH');const require=createRequire(import.meta.url),{Client}=require(pgPath);
 const dir=fs.lstatSync(privateJob);need(dir.isDirectory()&&!dir.isSymbolicLink()&&(dir.mode&0o777)===0o700&&dir.uid===process.getuid(),'PRIVATE_JOB_MODE');const client=new Client({host:privateJob+'/socket',port:55432,user:'postgres',database:'proof_indexer',password:undefined,application_name:'audit30_private_body_rehearsal',connectionTimeoutMillis:3000,query_timeout:30000});
 const durable=async(name,value)=>{const p=path.join(privateJob,receiptPrefix+'-'+name+'.json');const fd=fs.openSync(p,fs.constants.O_WRONLY|fs.constants.O_CREAT|fs.constants.O_EXCL|fs.constants.O_NOFOLLOW,0o600);try{fs.writeFileSync(fd,encoded(value));fs.fsyncSync(fd);}finally{fs.closeSync(fd);}const d=fs.openSync(privateJob,fs.constants.O_RDONLY|fs.constants.O_DIRECTORY|fs.constants.O_NOFOLLOW);try{fs.fsyncSync(d);}finally{fs.closeSync(d);}};
 const ctrl=new AbortController();const handler=()=>ctrl.abort();process.on('SIGTERM',handler);process.on('SIGINT',handler);process.on('SIGHUP',handler);
 try{await client.connect();await rehearse(client,plan,{engineSHA,privateJob,durable,fence:async()=>{},cloneSubset:true,signal:ctrl.signal});}
 finally{await client.end();process.removeListener('SIGTERM',handler);process.removeListener('SIGINT',handler);process.removeListener('SIGHUP',handler);}
}
if(process.argv[1]&&fileURLToPath(import.meta.url)===path.resolve(process.argv[1]))nativeMain(process.argv.slice(2)).catch(e=>{process.stderr.write(JSON.stringify({status:'refused',errorClass:e.name,code:/^[A-Z0-9_]+$/.test(e.message)?e.message:'DETAIL_REDACTED',productionMutation:false})+'\n');process.exitCode=1;});
