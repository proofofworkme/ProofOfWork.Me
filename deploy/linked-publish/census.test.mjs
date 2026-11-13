import {Transaction} from 'bitcoinjs-lib';
import test from 'node:test';
import assert from 'node:assert/strict';
import {rawLinkedPostCandidate,censusRawLinkedHistory} from './census.mjs';
function output(post){
 const payload=Buffer.from('pwb1:post:'+Buffer.from(JSON.stringify(post)).toString('base64url'));
 const length=Buffer.alloc(2);length.writeUInt16LE(payload.length);
 return {n:0,scriptPubKey:{hex:Buffer.concat([Buffer.from([0x6a,0x4d]),length,payload]).toString('hex')}};
}
test('raw scanner finds v2 even if malformed metadata old indexer rejected',()=>{
 assert.equal(rawLinkedPostCandidate(output({article:{v:2}})),true);
 assert.equal(rawLinkedPostCandidate(output({article:{source:'linked-powcat1'}})),true);
 assert.equal(rawLinkedPostCandidate(output({article:{v:1,source:'same-tx-pwm1-message'}})),false);
 assert.equal(rawLinkedPostCandidate({scriptPubKey:{hex:'6a01ff'}}),false);
});
function fixture({v2=false,missing=false,mismatch=false,misleadingCache=false}={}){
 const queries=[],hash='a'.repeat(64);
 const tx=new Transaction();tx.addInput(Buffer.alloc(32,1),0);tx.addOutput(Buffer.from(output({article:{v:v2?2:1}}).scriptPubKey.hex,'hex'),0n);
 const txid=mismatch?'b'.repeat(64):tx.getId();
 const client={release(){},query:async sql=>{
  queries.push(sql);
  if(sql.includes('ledger_snapshots'))return {rows:[{height:100,hash}]};
  if(sql.includes('SELECT 1 FROM proof_indexer.blocks'))return {rows:[{}],rowCount:1};
  if(sql.includes('FROM proof_indexer.transactions'))return {rows:[{txid,block_height:99,block_hash:'c'.repeat(64),raw_hex:missing?null:tx.toHex(),raw_tx:misleadingCache?{txid,vout:[]}:undefined}]};
  return {rows:[],rowCount:0};
 }};
 return {pool:{connect:async()=>client},queries,hash};
}
test('census is read-only, checkpoint-fenced and records preexisting v2',async()=>{
 const f=fixture({v2:true});let calls=0;
 const r=await censusRawLinkedHistory(f.pool,async()=>{calls++;return f.hash});
 assert.equal(r.requiresReplayReview,true);assert.equal(r.preexistingV2Candidates.length,1);
 assert.equal(r.transactions,1);assert.equal(calls,2);assert.match(f.queries[0],/READ ONLY/);
 assert.equal(f.queries.at(-1),'COMMIT');assert.match(r.sha256,/^[a-f0-9]{64}$/);
});
test('no v2 produces explicit zero at verified checkpoint',async()=>{
 const f=fixture();const r=await censusRawLinkedHistory(f.pool,async()=>f.hash);
 assert.equal(r.requiresReplayReview,false);assert.deepEqual(r.preexistingV2Candidates,[]);
});
test('missing raw fails rather than certifying zero',async()=>{
 const f=fixture({missing:true});await assert.rejects(censusRawLinkedHistory(f.pool,async()=>f.hash),/raw transaction missing/);
 assert.equal(f.queries.at(-1),'ROLLBACK');
});
test('reorg after scan fails and rolls back',async()=>{
 const f=fixture();let calls=0;
 await assert.rejects(censusRawLinkedHistory(f.pool,async()=>++calls===1?f.hash:'d'.repeat(64)),/changed/);
 assert.equal(f.queries.at(-1),'ROLLBACK');
});

test('TXID mismatch fails even if cached JSON agrees',async()=>{
 const f=fixture({mismatch:true,misleadingCache:true});await assert.rejects(censusRawLinkedHistory(f.pool,async()=>f.hash),/ID mismatch/);
});
test('empty cached vout cannot hide v2 found in exact raw bytes',async()=>{
 const f=fixture({v2:true,misleadingCache:true});const r=await censusRawLinkedHistory(f.pool,async()=>f.hash);
 assert.equal(r.requiresReplayReview,true);assert.equal(r.preexistingV2Candidates.length,1);
});
