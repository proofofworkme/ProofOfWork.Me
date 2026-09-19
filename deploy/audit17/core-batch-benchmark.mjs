// Read-only, bounded transport comparison using the exact staged API function.
import fs from 'node:fs';
import vm from 'node:vm';
import {gunzipSync} from 'node:zlib';
import {createHash} from 'node:crypto';
import {readCoreOutpointBatches} from '/opt/proofofwork-api-stage-005a4e582f58-20260919T165018Z/server/core-outpoint-batches.mjs';
const root='/opt/proofofwork-api-stage-005a4e582f58-20260919T165018Z';
const source=fs.readFileSync(root+'/server/proof-api.mjs','utf8');
const start=source.indexOf('async function bitcoinRpcGetTxOutBatch('),end=source.indexOf('\nasync function bitcoinRpcOutspendPayload',start);
if(start<0||end<start)throw new Error('Missing batch function');
const url=new URL(process.env.BITCOIN_RPC_URL);
if(!['127.0.0.1','localhost'].includes(url.hostname))throw new Error('Nonloopback RPC');
const batch=vm.runInNewContext('('+source.slice(start,end)+')',{Buffer,fetch,AbortSignal,readCoreOutpointBatches,BITCOIN_RPC_URL:url.href,BITCOIN_RPC_USER:process.env.BITCOIN_RPC_USER,BITCOIN_RPC_PASSWORD:process.env.BITCOIN_RPC_PASSWORD});
const evidence='/home/powadmin/audit17-production-core-6eb4a1e-attempt2';
const receipt=JSON.parse(fs.readFileSync(evidence+'/receipt.json','utf8'));
if(receipt.ok!==true)throw new Error('Unverified evidence');
const page=receipt.receipts.find(row=>row.kind==='http'&&row.request.includes('kind=listings&projection=full'));
const bytes=gunzipSync(fs.readFileSync(evidence+'/'+page.file));
if(createHash('sha256').update(bytes).digest('hex')!==page.sha256)throw new Error('Evidence hash');
const items=JSON.parse(bytes).items;
const points=items.slice(0,200).map(row=>({txid:row.listingId,vout:row.saleAuthorization.anchorVout}));
if(points.length!==200)throw new Error('Inventory bound');
async function rpc(method,params){
 const response=await fetch(url,{method:'POST',headers:{Authorization:'Basic '+Buffer.from(process.env.BITCOIN_RPC_USER+':'+process.env.BITCOIN_RPC_PASSWORD).toString('base64'),'Content-Type':'application/json'},body:JSON.stringify({jsonrpc:'1.0',id:'benchmark',method,params}),signal:AbortSignal.timeout(10000)});
 const data=await response.json();if(!response.ok||data.error||!Object.hasOwn(data,'result'))throw new Error('Core response');return {ok:true,result:data.result};
}
async function single(){const results=Array(points.length);let next=0;await Promise.all(Array.from({length:4},async()=>{while(next<points.length){const i=next++;results[i]=await rpc('gettxout',[points[i].txid,points[i].vout,true]);}}));return results;}
const before=(await rpc('getblockchaininfo',[])).result;
const results=[];let reference;
for(const mode of ['single','batch','batch','single']){
 const t=performance.now();const output=mode==='batch'?await batch(points):await single();
 if(output.length!==points.length||output.some(row=>!row.ok||row.result?.bestblock!==before.bestblockhash))throw new Error('Checkpoint/output mismatch');
 const sha=createHash('sha256').update(JSON.stringify(output)).digest('hex');reference??=sha;if(sha!==reference)throw new Error('Changed outputs');
 results.push({mode,requests:mode==='batch'?Math.ceil(points.length/32):points.length,elapsedMs:Math.round(performance.now()-t),outputSha256:sha});
}
const after=(await rpc('getblockchaininfo',[])).result;if(before.bestblockhash!==after.bestblockhash)throw new Error('Tip changed');
console.log(JSON.stringify({ok:true,outputs:points.length,coreHeight:after.blocks,coreHash:after.bestblockhash,results,qualification:'Transport-only measurement; no claim about SQL, rendering, atomic mempool state or full endpoint latency.'}));
