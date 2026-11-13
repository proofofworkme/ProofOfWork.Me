import {Transaction} from 'bitcoinjs-lib';
import {createHash} from 'node:crypto';
import {decodeCanonicalOpReturnOutput} from '../../server/canonical-op-return.mjs';
import {readSearchCheckpoint} from '../../server/search-projection.mjs';
export function rawLinkedPostCandidate(output){
 const record=decodeCanonicalOpReturnOutput(output);
 if(!record?.text?.startsWith('pwb1:post:'))return false;
 try{
  const encoded=record.text.slice(10),bytes=Buffer.from(encoded,'base64url');
  if(bytes.toString('base64url')!==encoded)return false;
  const post=JSON.parse(new TextDecoder('utf8',{fatal:true}).decode(bytes));
  return post?.article?.v===2 || post?.article?.source==='linked-powcat1';
 }catch{return false;}
}
export async function censusRawLinkedHistory(pool,verifyCheckpoint){
 const client=await pool.connect(),started=Date.now();let count=0,bytes=0,cursor='',postCandidates=[];
 const digest=createHash('sha256');
 try{
  await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
  await client.query("SET LOCAL statement_timeout='15s'");
  const checkpoint=await readSearchCheckpoint(client,'livenet');
  if(await verifyCheckpoint(checkpoint.height)!==checkpoint.hash)throw Error('Census checkpoint not canonical');
  while(true){
   if(Date.now()-started>240000 || count>200000 || bytes>512*1024**2)throw Error('Census resource bound exceeded');
   const {rows}=await client.query(`SELECT txid,block_height,block_hash,COALESCE(NULLIF(raw_hex,''),raw_tx->>'hex') AS raw_hex
    FROM proof_indexer.transactions WHERE network='livenet' AND status='confirmed'
    AND block_height<=$1 AND txid COLLATE "C">$2 COLLATE "C" ORDER BY txid COLLATE "C" LIMIT 50`,[checkpoint.height,cursor]);
   for(const row of rows){
    if(typeof row.raw_hex!=='string' || !/^(?:[0-9a-fA-F]{2})+$/.test(row.raw_hex) || row.raw_hex.length>8*1024**2)throw Error('Census raw transaction missing');
    const tx=Transaction.fromHex(row.raw_hex);
    if(tx.getId()!==row.txid)throw Error('Census raw transaction ID mismatch');
    const raw=Buffer.from(row.raw_hex,'hex');bytes+=raw.length;count++;
    digest.update(row.txid+':'+row.block_height+':'+row.block_hash+':'+createHash('sha256').update(raw).digest('hex')+'\n');
    for(const [n,item] of tx.outs.entries()){
     const output={n,scriptPubKey:{hex:Buffer.from(item.script).toString('hex')}};
     if(rawLinkedPostCandidate(output)){
     if(postCandidates.length>=1000)throw Error('Too many preexisting linked posts for bounded review');
     postCandidates.push({txid:row.txid,height:Number(row.block_height),vout:output.n??null});
     }
    }
   }
   if(rows.length<50)break;cursor=rows.at(-1).txid;
  }
  if(await verifyCheckpoint(checkpoint.height)!==checkpoint.hash)throw Error('Census checkpoint changed');
  await client.query('COMMIT');
  return {ok:true,scope:'retained confirmed raw transaction population at drained index checkpoint; not genesis discovery assurance',
   checkpoint,transactions:count,rawBytes:bytes,sha256:digest.digest('hex'),preexistingV2Candidates:postCandidates,
   requiresReplayReview:postCandidates.length>0,elapsedMs:Date.now()-started};
 }catch(error){await client.query('ROLLBACK').catch(()=>{});throw error;}finally{client.release();}
}
