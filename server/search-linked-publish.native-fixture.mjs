// Synthetic-only native PostgreSQL fixture. Never point this at production.
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import pg from 'pg';
import {Transaction,script,opcodes} from 'bitcoinjs-lib';
import {encodePowcatPart,encodePowcatManifest,powcatScript,powcatSha256} from '../src/shared/protocol/powcat1.mjs';
import {buildPowcatMailAttachment} from '../src/shared/protocol/powcatMail.mjs';
import {createPowcatReader} from './powcat-reader.mjs';
import {searchPayload} from './db/search-reader.mjs';
import {SEARCH_INDEX_VERSION} from './search-projection.mjs';
import {verifyLinkedArticle} from './publish-linked.mjs';
import {storeLinkedPublishSearchReference,linkedPublishSearchCoverage,pruneUnreferencedLinkedSearch,compactLinkedSearchStorage} from './search-linked-publish.mjs';
import {copyConfirmedSearchBatch,pruneSearchGenerations} from '../scripts/backfill-proof-search.mjs';
const H=n=>n.toString(16).padStart(64,'0');
function fixture(body = "  Café 東京\r\nExact article.  ") {
  const bytes = Buffer.from(body), fileHash = powcatSha256(bytes), records = new Map();
  function publish(payload, height) {
    const tx = new Transaction(); tx.addInput(Buffer.alloc(32, 1), 0); tx.addOutput(powcatScript(payload), 0n);
    const header = Buffer.alloc(80, height), first = createHash("sha256").update(header).digest();
    const blockhash = createHash("sha256").update(first).digest().reverse().toString("hex");
    records.set(tx.getId(), { txid: tx.getId(), hex: tx.toHex(), blockhash, height, proof: header.toString("hex")+tx.getId() });
    return tx.getId();
  }
  const count = Math.ceil(bytes.length/96000), parts = [];
  for (let index=0; index<count; index++) parts.push(publish(encodePowcatPart({
    fileHash, index, count, bytes: bytes.subarray(index*96000,(index+1)*96000) }),4));
  const root = publish(encodePowcatManifest({fileHash,size:bytes.length,mime:"text/plain",name:"article.txt",partTxids:parts}),5);
  const article = {v:2,title:"Linked article",source:"linked-powcat1",size:bytes.length,sha256:fileHash,linkerTxid:root};
  const attachment = buildPowcatMailAttachment({txid:root,fileHash,name:"article.txt"});
  const enc = text => Buffer.from(text).toString("base64url");
  const outputs = ["pwb1:post:"+enc(JSON.stringify({v:1,text:article.title,article})),
    "pwm1:a:"+enc(attachment.mime)+":"+enc(attachment.name)+":139:"+attachment.sha256+":0/1:"+attachment.data];
  const tx = {txid:H(99),height:6,_powBlockHash:H(6),vout:outputs.map(text=>({
    scriptpubkey:Buffer.from(script.compile([opcodes.OP_RETURN,Buffer.from(text)])).toString("hex"),value:0
  }))};
  async function rpc(method, [value, verbose]) {
    const rows = [...records.values()];
    if (method==="getblockchaininfo") return {chain:"main",blocks:6,bestblockhash:H(6),initialblockdownload:false};
    if (method==="getindexinfo") return {txindex:{synced:true,best_block_height:6}};
    if (method==="gettxoutproof") return records.get(value[0]).proof;
    if (method==="verifytxoutproof") return [rows.find(row=>row.proof===value).txid];
    if (method==="getblockheader") return {hash:value,height:rows.find(row=>row.blockhash===value).height,confirmations:2};
    if (method==="getrawtransaction") return verbose ? {...records.get(value),confirmations:2} : records.get(value).hex;
    if (method==="getblockhash") return value===6?H(6):rows.find(row=>row.height===value)?.blockhash;
    throw new Error("Unexpected RPC "+method);
  }
  const signed=new Transaction();signed.addInput(Buffer.alloc(32,2),0);
  for(const output of tx.vout)signed.addOutput(Buffer.from(output.scriptpubkey,"hex"),0n);
  tx.txid=signed.getId();
  records.set(tx.txid,{txid:tx.txid,hex:signed.toHex(),height:6,blockhash:H(6)});
  const readFile=createPowcatReader({chain:"main",rpc});
  const position={txid:tx.txid,blockHeight:6,blockHash:H(6),protocolVout:0};
  const options={readFile,network:"livenet",blockHashAtHeight:h=>rpc("getblockhash",[h])};
  return {body,tx,article,attachment,root,records,rpc,readFile,position,options,parts};
}

const base=process.env.SEARCH_FIXTURE_ROOT;
assert.match(base??'',/^\/data\/proofofwork-search-native-fixture-[A-Za-z0-9TZ-]+$/);
assert.equal(process.env.PGHOST,base+'/socket');
const pool=new pg.Pool({host:process.env.PGHOST,port:6543,database:'fixture',user:'postgres',max:2,options:'-c statement_timeout=15000 -c lock_timeout=1000'});
const client=await pool.connect();
const capacityOptions={probe:async()=>({bavail:1024n**4n,bsize:1n})};
let checks=0;
try {
 const actual=(await client.query("SELECT current_setting('data_directory') AS data,inet_server_addr() AS tcp")).rows[0];
 assert.equal(actual.data,base+'/cluster');assert.equal(actual.tcp,null);
 await client.query("CREATE SCHEMA proof_indexer; CREATE TABLE proof_indexer.blocks(network text,height integer,block_hash text,canonical boolean,PRIMARY KEY(network,height)); CREATE TABLE proof_indexer.transactions(network text,txid text,status text,block_height integer,block_hash text,raw_hex text,raw_tx jsonb,PRIMARY KEY(network,txid));");
 await client.query(await readFile(new URL('./sql/proof-search-v1.sql',import.meta.url),'utf8'));
 await client.query(await readFile(new URL('./sql/proof-search-linked-publish-v1.sql',import.meta.url),'utf8'));
 const f=fixture('  Café e\u0301 東京\r\nalpha beta gamma. '+String.fromCharCode(0xfeff)+'literal %_\\ slash  ');
 const verified=await verifyLinkedArticle(f.tx,f.position,f.options);
 for(const row of f.records.values()) {
   await client.query("INSERT INTO proof_indexer.blocks VALUES('livenet',$1,$2,true) ON CONFLICT DO NOTHING",[row.height,row.blockhash]);
   await client.query("INSERT INTO proof_indexer.transactions VALUES('livenet',$1,'confirmed',$2,$3,$4,'{}')",[row.txid,row.height,row.blockhash,row.hex]);
 }
 for(const [i,state] of [[1,'ready'],[2,'ready'],[3,'building']])await client.query("INSERT INTO proof_indexer.search_runs(run_id,network,index_version,state,checkpoint_height,checkpoint_hash,source_witness,completed_at) VALUES($1,'livenet','fixture',$2,6,$3,'{}',now()+($4||' seconds')::interval)",['run'+i,state,H(6),i]);
 const prefix='Title alpha';
 const source={id:'event:1',sourceClass:'event',protocol:'pwb1',kind:'boost-post',valid:true,canonical:true,status:'confirmed',txid:f.tx.txid,blockHeight:6,blockHash:H(6),vout:0,payload:{article:f.article,articleDependencies:verified.evidence}};
 await client.query("INSERT INTO proof_indexer.search_documents(network,run_id,id,source_hash,protocol,kind,status,valid,canonical,amount_proofs,record,payload,raw_payload,evidence,search_text) VALUES('livenet','run1','event:1',$1,'pwb1','boost-post','confirmed',true,true,0,'{}',$2,'','{}',$3)",[H(1),source.payload,prefix]);
 await client.query('BEGIN');
 assert.equal(await storeLinkedPublishSearchReference(client,{network:'livenet',runId:'run1',source,sourceHash:H(1),prefix,capacityOptions}),true);
 await client.query('COMMIT');
 assert.equal((await linkedPublishSearchCoverage(client,'livenet','run1')).ready,true);checks++;
 const body=(await client.query('SELECT body FROM proof_indexer.search_linked_contents')).rows[0].body;
 assert.equal(body,f.body);checks++;

 // This block tests actual native reader SQL and cursor behavior. Only the
 // synthetic source census is stubbed; canonical-byte admission was tested above.
 const parser=(await client.query('SELECT proof_indexer.search_simple_parser_identity() AS p')).rows[0].p;
 const witness={linkedParserIdentity:parser,canonicalHash:H(9),confirmed:2,confirmedRecords:2,missingRawTransactions:0,missingRawCarriers:0,volatileHashes:{},powcatGroups:{}};
 await client.query("UPDATE proof_indexer.search_runs SET index_version=$1,source_witness=$2 WHERE run_id='run1'",[SEARCH_INDEX_VERSION,witness]);
 await client.query("UPDATE proof_indexer.search_documents SET record=$1 WHERE run_id='run1'",[{id:'event:1',source:{type:'event'}}]);
 await client.query("INSERT INTO proof_indexer.search_documents(network,run_id,id,source_hash,protocol,kind,status,valid,canonical,amount_proofs,record,payload,raw_payload,evidence,search_text) VALUES('livenet','run1','event:2',$1,'pwb1','boost-post','confirmed',true,true,0,$2,'{}','','{}','alpha beta inline')",[H(2),{id:'event:2',source:{type:'event'}}]);
 const readClient={release(){},query:async(sql,args)=>{
   if(sql.includes('hashes AS MATERIALIZED'))return {rows:[{canonical_hash:H(9),confirmed:2,confirmed_records:2,total:2,missing_raw_transactions:0,volatile_hashes:{},powcat_groups:{}}]};
   if(sql.includes('WITH raw_outputs AS'))return {rows:[{missing:0}]};
   if(sql.includes('FROM proof_indexer.meta'))return {rows:[]};
   return client.query(sql,args);
 }};
 const readOptions={pool:{connect:async()=>readClient},verifyCheckpoint:async()=>H(6)};
 const first=await searchPayload('livenet',new URLSearchParams({q:'alpha',limit:'1'}),readOptions);
 assert.equal(first.pagination.total,2);assert.equal(first.pagination.hasMore,true);
 const second=await searchPayload('livenet',new URLSearchParams({q:'alpha',limit:'1',cursor:first.pagination.nextCursor}),readOptions);
 assert.equal(second.pagination.hasMore,false);assert.notEqual(first.results[0].id,second.results[0].id);checks++;
 const exact=await searchPayload('livenet',new URLSearchParams({q:'%_'}),readOptions);
 assert.deepEqual(exact.results.map(r=>r.id),['event:1']);checks++;
 const negated=await searchPayload('livenet',new URLSearchParams({q:'alpha -gamma'}),readOptions);
 assert.deepEqual(negated.results.map(r=>r.id),['event:2']);checks++;
 await assert.rejects(()=>searchPayload('livenet',new URLSearchParams({q:'beta',limit:'1',cursor:first.pagination.nextCursor}),readOptions),e=>e.details?.code==='SEARCH_CURSOR_CHANGED');checks++;
 await copyConfirmedSearchBatch(client,{network:'livenet',runId:'run2',fromRunId:'run1'});
 assert.equal((await linkedPublishSearchCoverage(client,'livenet','run2')).ready,true);checks++;
 const interrupted={query:async(sql,args)=>{
   if(sql.includes('UPDATE proof_indexer.search_runs SET copy_cursor'))throw Object.assign(new Error('synthetic interrupted copy'),{code:'57014'});
   return client.query(sql,args);
 }};
 await assert.rejects(()=>copyConfirmedSearchBatch(interrupted,{network:'livenet',runId:'run3',fromRunId:'run1'}),e=>e.code==='57014');
 assert.equal((await client.query("SELECT count(*)::int n FROM proof_indexer.search_linked_refs WHERE run_id='run3'")).rows[0].n,0);
 assert.equal((await client.query("SELECT count(*)::int n FROM proof_indexer.search_documents WHERE run_id='run3'")).rows[0].n,0);checks++;
 await copyConfirmedSearchBatch(client,{network:'livenet',runId:'run3',fromRunId:'run1'});
 assert.equal((await linkedPublishSearchCoverage(client,'livenet','run3')).ready,true);checks++;
 const other=await pool.connect();
 try {
   await other.query("SELECT pg_advisory_lock_shared(hashtext('proof-search-linked-maintenance-v1'))");
   await assert.rejects(()=>compactLinkedSearchStorage(client,capacityOptions),/busy/);checks++;
 } finally {await other.query("SELECT pg_advisory_unlock_shared(hashtext('proof-search-linked-maintenance-v1'))");other.release();}

 await client.query("UPDATE proof_indexer.blocks SET canonical=false WHERE height=4");
 await client.query('BEGIN');
 await assert.rejects(()=>storeLinkedPublishSearchReference(client,{network:'livenet',runId:'run1',source,sourceHash:H(1),prefix,capacityOptions}));
 await client.query('ROLLBACK');
 await client.query("UPDATE proof_indexer.blocks SET canonical=true WHERE height=4");checks++;

 // Repeated prebuilds must not retire the currently serving version.
 await client.query("INSERT INTO proof_indexer.search_serving_pins(network,run_id,reason) VALUES('livenet','run1','synthetic prebuild')");
 for(const i of [4,5])await client.query("INSERT INTO proof_indexer.search_runs(run_id,network,index_version,state,checkpoint_height,checkpoint_hash,source_witness,completed_at) VALUES($1,'livenet','next-fixture','ready',6,$2,'{}',now()+($3||' seconds')::interval)",['run'+i,H(6),i]);
 await pruneSearchGenerations(client,'livenet');
 assert.equal((await client.query("SELECT count(*)::int n FROM proof_indexer.search_runs WHERE run_id='run1'")).rows[0].n,1);checks++;
 assert.deepEqual(await pruneUnreferencedLinkedSearch(client,'livenet'),{postings:0,bodies:0});checks++;
 await client.query("DELETE FROM proof_indexer.search_serving_pins WHERE network='livenet' AND run_id='run1'");
 await client.query("DELETE FROM proof_indexer.search_runs WHERE run_id='run1'");
 assert.deepEqual(await pruneUnreferencedLinkedSearch(client,'livenet'),{postings:0,bodies:0});checks++;
 await client.query("DELETE FROM proof_indexer.search_runs WHERE run_id='run2'");
 assert.deepEqual(await pruneUnreferencedLinkedSearch(client,'livenet'),{postings:0,bodies:0});checks++;
 await client.query("DELETE FROM proof_indexer.search_runs WHERE run_id='run3'");

 assert.deepEqual(await pruneUnreferencedLinkedSearch(client,'livenet'),{postings:1,bodies:1});checks++;
 const compact=await compactLinkedSearchStorage(client,capacityOptions);
 assert.equal(compact.after.bodies,'0');assert.equal(compact.after.references,'0');checks++;
 console.log(JSON.stringify({passed:true,syntheticOnly:true,checks,compact}));
} finally {client.release();await pool.end();}
