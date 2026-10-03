#!/usr/bin/env node
// Local source extraction only. No API/SQL/Core/network, writes or main imports.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import ts from '/home/sixer/ProofOfWork.Me/node_modules/typescript/lib/typescript.js';
const ROOT='/home/sixer/ProofOfWork.Me/';
const pinned={
 'server/proof-api.mjs':'9ab92c0fe3cb358fcaacccd62915eabc4c9ee75e42d29c6c989259b1305436f4',
 'server/db/proof-index-reader.mjs':'9278b81473c23a2c9d06c6b1306268c360539f833cdd7967b73fd99a35275b87',
 'scripts/backfill-proof-indexer.mjs':'fab9f9540d2e59cb76fba915ed7ac8ef962df6a38c3b2a5d24773cd4e4b08c15',
 'scripts/audit-id-registry.mjs':'d7bbe914e3db45fcebac174dc182146f988547fb8d94ffa65f8286cebd50a825',
 'server/address-chain-pagination.mjs':'eaac31f241867b13cdfef527604f3cfd2ee6de690892cd4fafdb04b0adcb76e8',
 'server/id-registry-audit-contract.mjs':'2cffffe1fe259de29fb18aa615c905936ccd18e6f2a4a30439d18dde38a04469',
};
const parsed={};
for(const [name,sha] of Object.entries(pinned)){
 const raw=readFileSync(ROOT+name);assert.equal(createHash('sha256').update(raw).digest('hex'),sha,name);
 parsed[name]=ts.createSourceFile(name,raw.toString(),ts.ScriptTarget.Latest,true,ts.ScriptKind.JS);
}
function load(file,name,bindings={}){
 const tree=parsed[file],node=tree.statements.find(n=>ts.isFunctionDeclaration(n)&&n.name?.text===name);
 assert.ok(node,name);return new Function(...Object.keys(bindings),`return (${node.getText(tree).replace(/^export /u,'')});`)(...Object.values(bindings));
}
const names=[];async function check(name,fn){await fn();names.push(name);}
const api='server/proof-api.mjs',reader='server/db/proof-index-reader.mjs',backfill='scripts/backfill-proof-indexer.mjs',cli='scripts/audit-id-registry.mjs';
const cmp=(a,b)=>Buffer.compare(Buffer.from(String(a??'')),Buffer.from(String(b??'')));
const canonical=load(api,'registryAuditCanonicalJson',{compareCanonicalUtf8:cmp});
const hash=load(api,'registryAuditProjectionSha256',{createHash,registryAuditCanonicalJson:canonical});
const registryAuditTxid=load(api,'registryAuditTxid');
const registryAuditInteger=load(api,'registryAuditInteger');
const txidSetSha256=load(api,'txidSetSha256',{createHash,compareCanonicalUtf8:cmp});
const fence=load(api,'registryAuditReadFence',{registryAuditTxid,registryAuditInteger,txidSetSha256,registryAuditProjectionSha256:hash});
const cliCanonical=load(cli,'canonicalAuditJson',{compareCanonicalUtf8:cmp});
const cliHash=load(cli,'projectionSha256',{createHash,canonicalAuditJson:cliCanonical});
const exactProjectionString=load(cli,'exactProjectionString');
const exactProjectionTxid=load(cli,'exactProjectionTxid',{exactProjectionString});
const exactNonnegativeInteger=load(cli,'exactNonnegativeInteger');
const normalize=load(cli,'normalizedRegistryAuditReadFence',{exactProjectionString,exactProjectionTxid,exactNonnegativeInteger,projectionSha256:cliHash,PWID_RAW_REPLAY_ACTIVATION_HEIGHT:959621});
const H=969672,A='a'.repeat(64),B='b'.repeat(64),C='c'.repeat(64);
const input={checkpoint:{blockHash:A,height:H},coverage:{confirmedTxids:[B],pendingTxids:[],snapshotSha256:C},electrumCheckpoint:{blockHash:A,height:H,headerSha256:B},indexAuditFence:{indexScanSnapshotId:'stable-index-snapshot',indexScanStatus:'block-scan-current',transitions:{transitionCount:H-959621+1,transitionSha256:C}},pendingMempoolTimeSha256:hash([]),registryProjectionSha256:B,relationalRowsSha256:C};
await check('API and CLI canonical fence preimages agree',()=>assert.deepEqual(normalize(fence(input)),fence(input)));
await check('property insertion order has no fence influence',()=>{
 const value=fence(input);assert.equal(hash(value),hash(Object.fromEntries(Object.entries(value).reverse())));
});
await check('generatedAt/indexedAt/metrics/worker epochs are outside normalized fence',()=>{
 const copy=structuredClone(input);copy.coverage.generatedAt='future';copy.indexAuditFence.generatedAt='future';copy.indexAuditFence.metrics={retries:100};copy.indexAuditFence.worker={updatedAt:'future',readinessEpoch:101};assert.deepEqual(fence(copy),fence(input));
});
await check('valid canonical extension changes fence without proving corruption',()=>{
 const copy=structuredClone(input);copy.checkpoint={height:H+1,blockHash:B};copy.electrumCheckpoint={height:H+1,blockHash:B,headerSha256:A};copy.indexAuditFence.transitions.transitionCount++;copy.indexAuditFence.transitions.transitionSha256=A;copy.indexAuditFence.indexScanSnapshotId='next-index-snapshot';assert.notEqual(normalize(fence(copy)).fenceSha256,normalize(fence(input)).fenceSha256);
});
await check('legitimate pending membership and time changes change fenced evidence',()=>{
 const copy=structuredClone(input);copy.coverage.pendingTxids=[A];copy.coverage.snapshotSha256=A;copy.pendingMempoolTimeSha256=hash([{txid:A,mempoolTime:1791000000}]);assert.notEqual(fence(copy).fenceSha256,fence(input).fenceSha256);
});
const store=load(backfill,'storeBlockScanSnapshot',{createHash,NETWORK:'livenet',numberOrNull:v=>v==null?null:Number(v)});
const payload={complete:true,indexed:0,indexedThroughBlock:H,indexedThroughBlockHash:A,protocolTxids:0,scannedBlocks:0,skipped:0,tipHeight:H};
const queries=[];const mockWriter={query:async(sql,params)=>{queries.push({sql,params});}};
await check('snapshot ID ignores complete/status/tip/counters and generated time',async()=>{
 const first=await store(mockWriter,payload);const second=await store(mockWriter,{...payload,complete:false,tipHeight:H+1,indexed:3,scannedBlocks:9,generatedAt:'different'});assert.equal(first,second);
 assert.equal(first,createHash('sha256').update(JSON.stringify({indexedThroughBlock:H,indexedThroughBlockHash:A,network:'livenet',source:'block-scan'})).digest('hex').slice(0,24));
 assert.equal(JSON.parse(queries[0].params[6]).status,'block-scan-current');assert.equal(JSON.parse(queries[1].params[6]).status,'block-scan-partial');
});
await check('snapshot ID changes for different canonical height or hash',async()=>{
 assert.notEqual(await store(mockWriter,payload),await store(mockWriter,{...payload,indexedThroughBlock:H+1}));assert.notEqual(await store(mockWriter,payload),await store(mockWriter,{...payload,indexedThroughBlockHash:B}));
});
await check('ordinary hashed idle block scan does not rewrite its checkpoint',async()=>{
 let stores=0;const calls=[];
 const fn=load(backfill,'backfillBlockScanSource',{BITCOIN_RPC_URL:'fixture',CANONICAL_REBUILD:false,NETWORK:'livenet',CANONICAL_REBUILD_META_KEY:'rebuild',CANONICAL_FAULT_META_KEY:'fault',proofIndexerMetaValue:async()=>null,assertCanonicalPwtRangeReplayState:()=>null,activatePwtRangeReplayVerifierBinding:()=>{},latestBlockScanCheckpoint:async()=>({height:H,blockHash:A}),bitcoinRpc:async(method)=>{calls.push(method);if(method==='getblockcount')return H;if(method==='getblockhash')return A;throw Error('unexpected RPC')},storeBlockScanSnapshot:async()=>{stores++;}});
 const result=await fn({query:async()=>{throw Error('unexpected SQL')}},{label:'block-scan'});assert.equal(stores,0);assert.equal(result.blocks,0);assert.deepEqual(calls,['getblockcount','getblockhash']);
});
const exactInteger=load(reader,'idRegistryAuditExactInteger');
const baseScan={snapshot_id:'stable-index-snapshot',indexed_through_block:H,payload:{complete:true,tipHeight:H,indexedThroughBlockHash:A},consistency:{ok:true,status:'block-scan-current'},source_hashes:{blockScan:A}};
const guard=load(reader,'idRegistryAuditSnapshotPass',{latestProofIndexScanMetadata:async(client)=>client.scan,objectRecord:v=>v&&typeof v==='object'&&!Array.isArray(v)?v:{},idRegistryAuditExactInteger:exactInteger,normalizedLowerText:v=>String(v??'').trim().toLowerCase()});
async function inspectGuard(scan,canonicalRows=[{block_hash:A}]){
 let marker=false,released=false;const commands=[];
 const client={scan,query:async(sql)=>{commands.push(sql);if(sql.includes('SELECT block_hash'))return{rowCount:canonicalRows.length,rows:canonicalRows};if(sql.includes('outside_count')){marker=true;throw Error('AFTER_PIN_GUARD')}return{rows:[]}},release:()=>{released=true}};
 try{await guard({connect:async()=>client},'livenet',{expectedHash:A,expectedHeight:H});throw Error('fixture unexpectedly finished')}catch(e){assert.ok(released);assert.ok(commands.includes('ROLLBACK'));return{marker,message:e.message}}
}
await check('same-tip heartbeat fields do not trip exact guard',async()=>{
 const scan=structuredClone(baseScan);scan.generated_at='later';scan.worker={epoch:99};scan.worker_updated_at='later';scan.metrics={count:2};const r=await inspectGuard(scan);assert.equal(r.marker,true);assert.equal(r.message,'AFTER_PIN_GUARD');
});
const cases=[
 ['complete false',s=>s.payload.complete=false],['snapshot ID missing',s=>s.snapshot_id=''],['tip differs',s=>s.payload.tipHeight=H+1],['consistency false',s=>s.consistency.ok=false],['status partial',s=>s.consistency.status='block-scan-partial'],['scan height advanced',s=>s.indexed_through_block=H+1],['scan hash changed',s=>s.payload.indexedThroughBlockHash=B],
];
for(const[name,mutate]of cases)await check('exact pin refuses '+name,async()=>{const s=structuredClone(baseScan);mutate(s);const r=await inspectGuard(s);assert.equal(r.marker,false);assert.equal(r.message,'The ID audit index scan is not pinned to the exact current checkpoint.');});
for(const[name,rows]of[['canonical row absent',[]],['canonical row duplicate',[{block_hash:A},{block_hash:A}]],['canonical hash differs',[{block_hash:B}]]])await check('exact pin refuses '+name,async()=>{const r=await inspectGuard(baseScan,rows);assert.equal(r.marker,false);assert.equal(r.message,'The ID audit index scan is not pinned to the exact current checkpoint.');});
await check('latest scan selector is highest hashed scan, not audit expected height',async()=>{
 let sql='';const select=load(reader,'latestProofIndexScanMetadata');const pool={query:async(q,params)=>{sql=q;assert.deepEqual(params,['livenet']);return{rows:[baseScan]}}};assert.equal(await select(pool,'livenet'),baseScan);assert.match(sql,/NOT \(source_hashes \? 'canonicalSummary'\)/u);assert.match(sql,/indexed_through_block DESC NULLS LAST,\s*generated_at DESC/u);assert.doesNotMatch(sql,/indexed_through_block\s*=\s*\$2/u);
});
console.log(JSON.stringify({schema:'pow-audit30-id-fence-local-source-invariants-v1',passed:names.length,cases:names,sourcePins:pinned,nativeCalls:0,sourceEdits:false,qualifications:['Source-extracted functions use fake clients; no SQL/RPC is executed.','No actual failed conjunct or future stable interval is proved.','No blanket corruption or natural-extension cause is inferred from prior503.']}));
