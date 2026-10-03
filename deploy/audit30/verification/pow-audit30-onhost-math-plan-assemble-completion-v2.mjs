// Local-only deterministic assembly. Reads public code/metadata, never native
// COPY, marker value, mail preimage, SQL/Core, or a remote host.
import fs from 'node:fs';
import path from 'node:path';
import {pathToFileURL,fileURLToPath} from 'node:url';
import crypto from 'node:crypto';
const OPERATOR='/tmp/pow-audit30-transition-onhost-math-completion-v2.mjs';
const OPERATOR_SHA='9faae94cebbedad8f02db55f2545e80dc2f7e0d937aa6cea149532577a7abee6';
const INVENTORY='/tmp/pow-audit30-onhost-math-source-inventory-native-full-v1.json';
const INVENTORY_SHA='aae198d18b0f5b347f25022f4c141b546aebf5f62d32e21cd72443ede5edd642';
const ORIGINAL='/tmp/pow-audit30-transition-independent-oracle-v3.mjs';
const COMPLETION_SHA='dc9e158445be2a176ef683ae7b3b5df40a44480f77ef9a57def85826d0225ff1';
const MANIFEST_SHA='e904b0379dd6c80f68eebbb556b5bd5caa8619aa79df89f03ed16ebbeb6db977';
const CORE='/tmp/pow-audit30-transition-sample-core-witness-native-v1.stdout';
const CORE_SHA='86ae268a2fe863d43e139964410584140d2ebecbe87af7075d0ecaeb36aca560';
const TS_SHA='3ae902c92cc44dace175c0e69e13a4b0899f6983c6121d76b9ab8dd5795e7675';
const UTILITY='/tmp/pow-audit30-onhost-math-source-copy-v3.py';
const UTILITY_SHA='379b387e33d08b421e126edd261f63b801d8326bdf24477e6a1a8c012c0e1988';
const TOOL_REQUEST='/tmp/pow-audit30-onhost-math-source-finalize-request-v2.json';
const TOOL_REQUEST_SHA='ce8ea8d18e19361919360a433882f680fd9c6fa3e41aaa9e9f2636645d6f5fb9';
const OUTPUT_PROBE_SHA='a38d26740997f039cf44063f27acba75491fc99ff03f87a522e541eb6e1a59bd';
const SOURCE_FENCE='d9c08752be9e8e7c8d9ce4409b20496783901f116becbb26e205904dc676564b';
const HEX=/^[a-f0-9]{64}$/;
const need=(p,c)=>{if(!p)throw new Error(c);};
const sha=b=>crypto.createHash('sha256').update(b).digest('hex');
const read=(p,h,cap)=>{need(fs.statSync(p).size<=cap,'ASSEMBLY_STATIC_BOUND');const b=fs.readFileSync(p);need(b.length<=cap&&sha(b)===h,'ASSEMBLY_STATIC_RAW_PIN');return b;};
read(OPERATOR,OPERATOR_SHA,128*1024);
const O=await import(pathToFileURL(OPERATOR));
const equal=(a,b)=>O.canonical(a)===O.canonical(b);
const keys=v=>Object.keys(v).sort();
export function authorities(){
 const inv=JSON.parse(read(INVENTORY,INVENTORY_SHA,8*1024**2));need(inv.candidateRoot===O.CANDIDATE_ROOT&&inv.candidateAttestationSHA256==='0ca029e59d44b6be5444d26d6d9af60d432f034f58c617647f2792f5d86c47a6'&&inv.entryCount===6141&&inv.regularBytes===164382510&&inv.entries.length===6141,'ASSEMBLY_INVENTORY_SCOPE');
 const entries=new Map(inv.entries.map(e=>[e.path,e]));need(entries.size===6141,'ASSEMBLY_INVENTORY_DUPLICATE');
 const pins=Object.fromEntries(O.SOURCE_KEYS.map(p=>{const e=entries.get(p);need(e?.kind==='file'&&HEX.test(e.sha256),'ASSEMBLY_SOURCE_MISSING');return[p,e.sha256];}));
 const ref=JSON.parse(read('/home/sixer/ProofOfWork.Me/'+O.REFERENCE,O.REFERENCE_SHA,1024**2));
 const original=read(ORIGINAL,O.ORIGINAL_ORACLE_SHA,128*1024);const source=original.toString();
 const captures=[...source.matchAll(/^const historicalColumns=(\[.+\]);$/gm)];need(captures.length===1,'ASSEMBLY_EXACT_LAYOUT_LITERAL');const columns=JSON.parse(captures[0][1]);
 const migration='ALTER TABLE proof_indexer.work_amo_block_transitions\n  ADD COLUMN IF NOT EXISTS work_token_state_model text;';
 const layoutAdmission={model:'pow-audit30-measured-transition-alter-add-layout-v1',columnsSha256:sha(JSON.stringify(columns.map(c=>({name:c.name,typeName:c.typeName,typeOid:c.typeOid})))),nativeCaptureSha256:'69cf431cbede11d4867a85c8611ad932bc125d1c9da1560120ca6a20c4dfabac',schemaSqlSha256:pins['server/sql/proof-indexer-v1.sql'],migrationStatementSha256:sha(migration)};
 const tools=JSON.parse(read(TOOL_REQUEST,TOOL_REQUEST_SHA,65536));
 return {pins,columns,layoutAdmission,precisionPins:ref.context.pins,relocatedOracleSHA:sha(O.relocateOracle(original)),core:JSON.parse(read(CORE,CORE_SHA,65536)),utility:read(UTILITY,UTILITY_SHA,100000),tools:Object.fromEntries(['nodeMetadata','attestorMetadata','publisherMetadata'].map(k=>[k,tools[k]]))};
}
export function assemble(c,a=authorities()){
 const expected=['schema','context','columns','checkpoint','inputs','sourceCopyCompletionSha256','sourceCopyManifestSha256','streamCompletedSha256','streamIntentSha256','nodeMetadata','attestorMetadata','publisherMetadata','liveFive'].sort();
 need(c&&equal(keys(c),expected)&&c.schema==='pow-audit30-onhost-math-safe-input-census-completion-v2','ASSEMBLY_CENSUS_SHAPE');
 need(c.sourceCopyCompletionSha256===COMPLETION_SHA&&c.sourceCopyManifestSha256===MANIFEST_SHA&&HEX.test(c.streamCompletedSha256)&&HEX.test(c.streamIntentSha256),'ASSEMBLY_ACTUAL_CUSTODY_PINS');
 need(equal(c.columns,a.columns),'ASSEMBLY_EXACT_HISTORICAL_LAYOUT');
 const context=c.context,rows=context.sampleRows?.map(r=>({height:r.height,hash:r.hash}));need(rows?.length===3&&equal(rows.map(r=>r.height),[960600,960601,969526]),'ASSEMBLY_EXACT_ROWS');
 const h={schema:'pow-audit30-transition-sampled-historical-oracle-plan-v3',sourcePins:a.pins,inputSha256:Object.fromEntries(['.copy','.columns.json','.checkpoint.json','.marker.copy','.marker-value.json'].map(s=>[s,c.inputs[s]?.sha256])),layoutAdmission:a.layoutAdmission,checkpoint:c.checkpoint,sourceFenceSha256:context.sourceFenceSha256,sourceSnapshot:context.sourceSnapshot,sampleRows:rows,precisionPins:a.precisionPins,markerJsonbSendSha256:context.markerJsonbSendSha256};
 const plan={schema:'pow-audit30-saved-transition-onhost-math-plan-v2',originalOracleSHA256:O.ORIGINAL_ORACLE_SHA,relocatedOracleSHA256:a.relocatedOracleSHA,typescriptSHA256:TS_SHA,operatorSHA256:OPERATOR_SHA,candidateRoot:O.CANDIDATE_ROOT,candidateAttestationSHA256:'0ca029e59d44b6be5444d26d6d9af60d432f034f58c617647f2792f5d86c47a6',canonicalSampleWitnessSHA256:CORE_SHA,sourceCopyManifestSHA256:MANIFEST_SHA,privateJob:O.JOB,evidenceDirectory:O.EVIDENCE,sourcePins:a.pins,referenceSHA256:O.REFERENCE_SHA,inputs:c.inputs,historicalPlan:h};
 O.validatePlan(plan);O.validateContext(context,plan,c.columns,c.checkpoint);O.validateCoreWitness(a.core,plan);
 need(context.sourceFenceSha256===SOURCE_FENCE&&equal(Object.keys(c.checkpoint).sort(),['network','height','hash','sourceFenceSha256','sampleRowKeysSha256'].sort())&&c.checkpoint.network==='livenet'&&c.checkpoint.height===969526&&c.checkpoint.hash===rows[2].hash&&c.checkpoint.sourceFenceSha256===SOURCE_FENCE&&c.checkpoint.sampleRowKeysSha256===sha(JSON.stringify(rows)),'ASSEMBLY_CHECKPOINT_KEY_ENCODING');
 for(const k of ['nodeMetadata','attestorMetadata','publisherMetadata'])need(equal(c[k],a.tools[k]),'ASSEMBLY_EXACT_NATIVE_TOOL_METADATA');
 const names=['bitcoind.service','electrs.service','postgresql@16-main.service','proofofwork-api.service','proofofwork-indexer-worker.service'];need(equal(keys(c.liveFive),names.sort()),'ASSEMBLY_LIVE_SCOPE');
 for(const row of Object.values(c.liveFive))need(equal(keys(row),['InvocationID','MainPID'])&&typeof row.MainPID==='string'&&/^[1-9][0-9]*$/.test(row.MainPID)&&/^[a-f0-9]{32}$/.test(row.InvocationID),'ASSEMBLY_LIVE_IDENTITY');
 const planRaw=Buffer.from(O.canonical(plan));need(planRaw.length<=128*1024,'ASSEMBLY_PLAN_BOUND');
 const request={schema:'pow-audit30-onhost-math-managed-request-completion-v2',utilityBase64:a.utility.toString('base64'),sourceCopyCompletionSha256:COMPLETION_SHA,sourceCopyManifestSha256:MANIFEST_SHA,streamCompletedSha256:c.streamCompletedSha256,streamIntentSha256:c.streamIntentSha256,outputPropertyProbeSha256:OUTPUT_PROBE_SHA,mathPlanBase64:planRaw.toString('base64'),mathPlanSha256:sha(planRaw),nodeMetadata:c.nodeMetadata,attestorMetadata:c.attestorMetadata,publisherMetadata:c.publisherMetadata,liveFive:c.liveFive};
 const requestRaw=Buffer.from(O.canonical(request));need(requestRaw.length<=1024**2,'ASSEMBLY_REQUEST_BOUND');return {plan,request,planRaw,requestRaw};
}
function exclusive(p,raw){const fd=fs.openSync(p,'wx',0o600);try{fs.writeFileSync(fd,raw);fs.fsyncSync(fd);}finally{fs.closeSync(fd);}const parent=fs.openSync(path.dirname(p),'r');try{fs.fsyncSync(parent);}finally{fs.closeSync(parent);}}
export function parseInput(raw,h){need(raw.length>0&&raw.length<=2*1024**2&&sha(raw)===h,'ASSEMBLY_INPUT_RAW_PIN');const c=JSON.parse(raw);need(O.canonical(c)===raw.toString('utf8'),'ASSEMBLY_INPUT_CANONICAL_NO_DUPLICATES');return c;}
function boundedStdin(){const parts=[];let n=0;while(true){const b=Buffer.alloc(32768),count=fs.readSync(0,b,0,b.length,null);if(!count)break;n+=count;need(n<=2*1024**2,'ASSEMBLY_STDIN_BOUND');parts.push(b.subarray(0,count));}return Buffer.concat(parts,n);}
function main(){
 need(process.argv.length===3&&HEX.test(process.argv[2]),'ASSEMBLY_LOCAL_FIXED_ARGV');const raw=boundedStdin();const out=assemble(parseInput(raw,process.argv[2]));
 const p='/tmp/pow-audit30-onhost-math-native-plan-completion-v2.json',r='/tmp/pow-audit30-onhost-math-managed-request-completion-v2.json';need(!fs.existsSync(p)&&!fs.existsSync(r),'ASSEMBLY_OUTPUT_COLLISION');exclusive(p,out.planRaw);exclusive(r,out.requestRaw);
 process.stdout.write(JSON.stringify({schema:'pow-audit30-local-onhost-math-plan-assembly-completion-v2',inputSha256:sha(raw),plan:{path:p,bytes:out.planRaw.length,sha256:sha(out.planRaw)},request:{path:r,bytes:out.requestRaw.length,sha256:sha(out.requestRaw)},mathAccepted:false,nativeExecuted:false,privatePayloadReadOrExported:false})+'\n');
}
if(process.argv[1]&&fileURLToPath(import.meta.url)===path.resolve(process.argv[1]))try{main();}catch(e){process.stderr.write(JSON.stringify({status:'refused',code:/^ASSEMBLY_|^MATH_/.test(e.message)?e.message:'ASSEMBLY_REFUSED',nativeExecuted:false})+'\n');process.exitCode=1;}
