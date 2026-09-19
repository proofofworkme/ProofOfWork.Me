// Three concurrent GETs plus one subsequent GET; fixed loopback targets only.
import assert from 'node:assert/strict';
import { mkdir,writeFile } from 'node:fs/promises';
import { gzipSync } from 'node:zlib';
import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
const [port,out]=process.argv.slice(2);assert.ok(['8081','18081'].includes(port));assert.match(out??'',/^\/home\/powadmin\/audit17-[a-z0-9-]+$/);await mkdir(out,{mode:0o700});
const run=promisify(execFile),receipts=[],start=Date.now();
const report={format:'audit17-work-floor-burst-v1',port,startedAt:new Date(start).toISOString(),receipts};
async function core(){const {stdout}=await run('sudo',['-n','-u','bitcoin','/usr/local/bin/bitcoin-cli','-conf=/etc/bitcoin/bitcoin.conf','getblockchaininfo'],{timeout:15000,maxBuffer:1048576});return JSON.parse(stdout);}
async function get(index){const began=performance.now();assert.ok(Date.now()-start<180000);const r=await fetch('http://127.0.0.1:'+port+'/api/v1/work-floor?network=livenet',{redirect:'error',signal:AbortSignal.timeout(60000)});const parts=[];let bytes=0;for await(const b of r.body){bytes+=b.length;assert.ok(bytes<=2*1024*1024);parts.push(b);}const body=Buffer.concat(parts),file=String(index)+'.json.gz';await writeFile(out+'/'+file,gzipSync(body),{flag:'wx',mode:0o600});receipts[index]={file,status:r.status,milliseconds:Math.round(performance.now()-began),bytes,sha256:createHash('sha256').update(body).digest('hex')};assert.equal(r.status,200);return JSON.parse(body);}
try{const before=await core();assert.equal(before.initialblockdownload,false);const burst=await Promise.all([get(0),get(1),get(2)]);const next=await get(3);const after=await core();assert.equal(before.bestblockhash,after.bestblockhash);assert.equal(before.blocks,after.blocks);const fields=['floorQ8','liveFloorQ8','frozenFloorQ8','networkValueQ8','liveNetworkValueQ8','frozenNetworkValueQ8'];
 for(const p of [...burst,next]){assert.equal(p.indexedThroughBlock,after.blocks);assert.equal(p.indexedThroughBlockHash,after.bestblockhash);for(const k of fields){assert.match(p[k],/^\d+$/);assert.equal(p[k],burst[0][k]);}assert.equal(BigInt(p.liveFloorQ8),BigInt(p.liveNetworkValueQ8)/21000000n);}
 report.exact=Object.fromEntries(fields.map(k=>[k,burst[0][k]]));report.checkpoint={height:after.blocks,hash:after.bestblockhash};report.snapshotIds=[...new Set([...burst,next].map(p=>p.snapshotId))];report.ok=true;
}catch(e){report.ok=false;report.failure=String(e.message).slice(0,1000);process.exitCode=1;}
report.finishedAt=new Date().toISOString();report.qualification='Bounded burst timing and unchanged exact current floor values at one Core checkpoint; not universal latency or historical math proof.';await writeFile(out+'/receipt.json',JSON.stringify(report,null,2)+'\n',{flag:'wx',mode:0o600});console.log(JSON.stringify({ok:report.ok,out,failure:report.failure??null}));
