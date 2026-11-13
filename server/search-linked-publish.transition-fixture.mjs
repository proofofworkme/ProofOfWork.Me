// Synthetic indexed-source transition test. Real SQL witnesses; no production data or RPC.
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import pg from 'pg';
import {Transaction,script,opcodes} from 'bitcoinjs-lib';
import {encodePowcatPart,encodePowcatManifest,powcatScript,powcatSha256,parsePowcatOutputScript} from '../src/shared/protocol/powcat1.mjs';
import {buildPowcatMailAttachment} from '../src/shared/protocol/powcatMail.mjs';
import {createPowcatReader} from './powcat-reader.mjs';
import {searchPayload,linkedArticleSearchWriterReadiness} from './db/search-reader.mjs';
import {verifyLinkedArticle} from './publish-linked.mjs';
import {searchSourceWitness} from './search-projection.mjs';
import {runSearchBackfill} from '../scripts/backfill-proof-search.mjs';
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
const client=await pool.connect();let checks=0;const timings=[];
const measure=async(name,fn)=>{const start=performance.now();try{return await fn();}finally{timings.push({name,elapsedMs:Math.round(performance.now()-start)});}};
const check=()=>checks++;
const capacityOptions={probe:async()=>({bavail:1024n**4n,bsize:1n})};
let tipHeight=6;
const readerOptions={pool,verifyCheckpoint:async h=>H(h),capacityOptions};
const build=async()=>measure('complete-backfill-invocation',()=>runSearchBackfill({pool,verifyCheckpoint:async h=>H(h),batchSize:4,maxBatches:100,budgetMs:20000}));
const query=(q,status='confirmed')=>measure('complete-search-read',()=>searchPayload('livenet',new URLSearchParams({q,status,protocol:'pwb1',kind:'boost-post'}),readerOptions));
const readiness=()=>measure('complete-search-writer-readiness',()=>linkedArticleSearchWriterReadiness('livenet',{height:tipHeight,hash:H(tipHeight)},readerOptions));
try {
 const actual=(await client.query("SELECT current_setting('data_directory') AS data,inet_server_addr() AS tcp")).rows[0];
 assert.equal(actual.data,base+'/cluster');assert.equal(actual.tcp,null);
 await client.query(`CREATE SCHEMA proof_indexer;
 CREATE TABLE proof_indexer.blocks(network text,height integer,block_hash text,canonical boolean,PRIMARY KEY(network,height));
 CREATE TABLE proof_indexer.transactions(network text,txid text,status text,block_height integer,block_hash text,block_index integer,block_time timestamptz,first_seen_at timestamptz,raw_hex text,raw_tx jsonb,PRIMARY KEY(network,txid));
 CREATE TABLE proof_indexer.events(event_id bigint PRIMARY KEY,network text,txid text,protocol text,kind text,status text,valid boolean,validation_errors jsonb,amount_sats bigint,data_bytes bigint,block_height integer,block_index integer,block_time timestamptz,event_time timestamptz,op_return_vout integer,record_ordinal integer,payload jsonb,raw_payload text);
 CREATE TABLE proof_indexer.event_participants(event_id bigint,address text,role text,powid text);
 CREATE TABLE proof_indexer.event_refs(event_id bigint,ref_type text,ref_value text);
 CREATE TABLE proof_indexer.op_returns(network text,txid text,vout integer,output_index integer,protocol text,data_bytes bigint,payload_text text,payload_hex text);
 CREATE TABLE proof_indexer.tx_outputs(network text,txid text,vout integer,value_sats bigint,scriptpubkey text);
 CREATE TABLE proof_indexer.file_attachments(network text,txid text,attachment_index integer,status text,name text,mime_type text,size_bytes bigint,sha256 text,metadata jsonb,content_bytes bytea);
 CREATE TABLE proof_indexer.meta(key text PRIMARY KEY,value jsonb);
 CREATE TABLE proof_indexer.ledger_snapshots(network text,indexed_through_block integer,payload jsonb,source_hashes jsonb,generated_at timestamptz);`);
 await client.query(await readFile(new URL('./sql/proof-search-v1.sql',import.meta.url),'utf8'));
 await client.query(await readFile(new URL('./sql/proof-search-linked-publish-v1.sql',import.meta.url),'utf8'));
 const maximum=process.env.SEARCH_TRANSITION_MAX_BODY==='1';
 const articleBody=maximum?('needlebody '+Array.from({length:499999},(_,i)=>'w'+(i+1).toString(16).padStart(6,'0')+' ').join('')).slice(0,4000000):'  Café e\u0301 東京\r\nneedlebody alpha beta gamma.  ';
 if(maximum)assert.equal(Buffer.byteLength(articleBody),4000000);
 const f=fixture(articleBody);
 const verified=await verifyLinkedArticle(f.tx,f.position,f.options);
 const time='2026-11-12T00:00:00Z';
 let eventId=1;
 for(const row of f.records.values()) {
  await client.query("INSERT INTO proof_indexer.blocks VALUES('livenet',$1,$2,true) ON CONFLICT DO NOTHING",[row.height,row.blockhash]);
  const tx=Transaction.fromHex(row.hex);
  const raw={txid:row.txid,vin:[{txid:H(1),vout:0}],vout:tx.outs.map((out,n)=>({n,value:'0',scriptpubkey:Buffer.from(out.script).toString('hex')}))};
  const pending=row.txid===f.tx.txid;
  await client.query("INSERT INTO proof_indexer.transactions VALUES('livenet',$1,$2,$3,$4,$5,$6,$7,$8,$9)",[row.txid,pending?'pending':'confirmed',pending?null:row.height,pending?null:row.blockhash,pending?null:0,pending?null:time,time,row.hex,raw]);
  for(const out of raw.vout)await client.query("INSERT INTO proof_indexer.tx_outputs VALUES('livenet',$1,$2,0,$3)",[row.txid,out.n,out.scriptpubkey]);
  if(!pending){
   const parsed=parsePowcatOutputScript(tx.outs[0].script);
   const powcat=parsed.kind==='part'?{fileHash:parsed.fileHash,partHash:parsed.partHash,index:parsed.index,count:parsed.count,size:parsed.bytes.length}:{fileHash:parsed.fileHash,name:parsed.name,mime:parsed.mime,size:parsed.size,partTxids:parsed.partTxids};
   await client.query("INSERT INTO proof_indexer.events VALUES($1,'livenet',$2,'powcat1',$3,'confirmed',true,'[]',0,$4,$5,0,$6,$6,0,0,$7,'powcat1')",[eventId++,row.txid,parsed.kind==='part'?'powcat-part':'powcat-linker',row.hex.length/2,row.height,time,{powcat}]);
  }
 }
 const articleId=eventId;
 await client.query("INSERT INTO proof_indexer.events VALUES($1,'livenet',$2,'pwb1','boost-post','pending',true,'[]',546,0,null,null,null,$3,0,0,$4,'pwb1:post')",[articleId,f.tx.txid,time,{article:f.article,articleDependencies:verified.evidence}]);
 const marker={network:'livenet',model:'powcat1-discovery-v1',fromHeight:973975,anchorHash:'0000000000000000000197a8d7eeab4e20eae8693e7bb933edd89a75031933e3',complete:true,confirmedParts:f.parts.length,confirmedLinkers:1,indexedThroughBlock:6,indexedThroughBlockHash:H(6)};
 await client.query("INSERT INTO proof_indexer.meta VALUES('livenet:powcat1:discovery:v1',$1)",[marker]);
 await client.query("INSERT INTO proof_indexer.ledger_snapshots VALUES('livenet',6,$1,$2,now())",[{indexedThroughBlockHash:H(6)},{blockScan:H(6)}]);
 assert.equal((await build()).ready,true);check();
 assert.equal((await query('needlebody')).pagination.total,0);
 assert.equal((await query('Linked article','pending')).pagination.total,1);
 assert.equal((await client.query('SELECT count(*)::integer n FROM proof_indexer.search_linked_refs')).rows[0].n,0);check();
 await client.query("UPDATE proof_indexer.transactions SET status='confirmed',block_height=6,block_hash=$2,block_index=0,block_time=$3 WHERE txid=$1",[f.tx.txid,H(6),time]);
 await client.query("UPDATE proof_indexer.events SET status='confirmed',block_height=6,block_index=0,block_time=$2 WHERE event_id=$1",[articleId,time]);
 await assert.rejects(()=>query('needlebody'),e=>e.details?.code==='SEARCH_COVERAGE_CHANGED');check();
 assert.equal((await build()).ready,true);check();
 const confirmed=await query('needlebody');
 assert.equal(confirmed.pagination.total,1);assert.equal(confirmed.results[0].id,'event:'+articleId);assert.equal(confirmed.results[0].amountSats,'546');
 assert.equal(confirmed.coverage.linkedArticles.articles,1);
 assert.equal(confirmed.coverage.linkedFiles.ready,true);check();
 const witness=await measure('full-source-witness',()=>searchSourceWitness(client,'livenet',tipHeight));assert.equal(witness.missingRawTransactions,0);assert.equal(witness.missingRawCarriers,0);
 assert.equal((await readiness()).ready,true);check();
 assert.equal((await verifyLinkedArticle(f.tx,f.position,f.options)).body,f.body);check();
 const before=(await client.query("SELECT count(*)::integer n,sum(amount_sats)::text amount FROM proof_indexer.events WHERE protocol='pwb1'")).rows[0];
 assert.deepEqual(before,{n:1,amount:'546'});
 assert.equal((await build()).unchanged,true);assert.equal((await query('needlebody')).pagination.total,1);check();
 const oldReady=(await client.query("SELECT * FROM proof_indexer.search_runs WHERE state='ready' ORDER BY completed_at DESC LIMIT 1")).rows[0];
 const extra=new Transaction();extra.addInput(Buffer.alloc(32,3),0);
 const extraId=extra.getId();
 await client.query("INSERT INTO proof_indexer.transactions VALUES('livenet',$1,'pending',null,null,null,null,$2,$3,$4)",[extraId,time,extra.toHex(),{vin:[{txid:H(3),vout:0}],vout:[]}]);
 const volatile=await build();assert.equal(volatile.ready,true);
 const shared=(await client.query("SELECT * FROM proof_indexer.search_runs WHERE run_id=$1",[volatile.runId])).rows[0];
 assert.equal(shared.volatile_only,true);assert.equal(shared.copy_cursor,'@shared-confirmed-v1');assert.equal(shared.copy_from_run_id,oldReady.run_id);
 assert.equal((await query('needlebody')).pagination.total,1);
 assert.equal((await readiness()).ready,true);check();
 await client.query("INSERT INTO proof_indexer.search_serving_pins(network,run_id,reason) VALUES('livenet',$1,'synthetic shared reader retention proof')",[shared.run_id]);
 tipHeight=7;
 await client.query("INSERT INTO proof_indexer.blocks VALUES('livenet',7,$1,true)",[H(7)]);
 await client.query("UPDATE proof_indexer.transactions SET status='confirmed',block_height=7,block_hash=$2,block_index=0,block_time=$3 WHERE txid=$1",[extraId,H(7),time]);
 await client.query("UPDATE proof_indexer.ledger_snapshots SET indexed_through_block=7,payload=$1,source_hashes=$2,generated_at=now()",[{indexedThroughBlockHash:H(7)},{blockScan:H(7)}]);
 await client.query("UPDATE proof_indexer.meta SET value=$1 WHERE key='livenet:powcat1:discovery:v1'",[{...marker,indexedThroughBlock:7,indexedThroughBlockHash:H(7)}]);
 assert.equal((await build()).ready,true);
 const advanced=(await client.query("SELECT * FROM proof_indexer.search_runs WHERE state='ready' ORDER BY completed_at DESC LIMIT 1")).rows[0];
 assert.equal(advanced.copy_from_run_id,oldReady.run_id);assert.equal(advanced.volatile_only,false);
 assert.equal((await query('needlebody')).pagination.total,1);check();
 assert.equal((await client.query("SELECT count(*)::int n FROM proof_indexer.search_runs WHERE run_id=ANY($1)",[[shared.run_id,oldReady.run_id]])).rows[0].n,2);check();

 await client.query('UPDATE proof_indexer.blocks SET canonical=false WHERE height=4');
 await assert.rejects(()=>query('needlebody'),e=>e.details?.code==='SEARCH_COVERAGE_CHANGED');
 await assert.rejects(()=>readiness());check();
 await assert.rejects(()=>build(),/canonical|evidence/i);check();
 const orphanRpc=async(method,args)=>method==='getblockhash'&&args[0]===4?H(400):f.rpc(method,args);
 await assert.rejects(()=>verifyLinkedArticle(f.tx,f.position,{...f.options,readFile:createPowcatReader({chain:'main',rpc:orphanRpc})}));check();
 await client.query('UPDATE proof_indexer.blocks SET canonical=true WHERE height=4');
 assert.equal((await build()).ready,true);check();
 assert.equal((await query('needlebody')).pagination.total,1);
 assert.equal((await verifyLinkedArticle(f.tx,f.position,f.options)).body,f.body);check();
 const after=(await client.query("SELECT count(*)::integer n,sum(amount_sats)::text amount FROM proof_indexer.events WHERE protocol='pwb1'")).rows[0];
 assert.deepEqual(after,before);check();
 console.log(JSON.stringify({passed:true,checks,bodyBytes:Buffer.byteLength(articleBody),timings,sourceWitnessStubbed:false,sharedConfirmedGenerationVerified:true,syntheticCore:true,indexedSourceFixture:true,productionMutation:false,protocolReplayCertified:false,scope:'real source SQL/witness, pending to confirmed, dependency orphan rejection, canonical restoration and rebuild; exact body; one article event and unchanged source payment attribution'}));
} finally {client.release();await pool.end();}
