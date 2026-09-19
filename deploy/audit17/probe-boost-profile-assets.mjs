// Bounded read-only check for the acquired-assets projection; no signing or writes
// except a new local evidence directory. Prior full-book checks remain separate.
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdir, writeFile } from 'node:fs/promises';
import { gzipSync } from 'node:zlib';
import { createHash } from 'node:crypto';
const [port,output]=process.argv.slice(2);
assert.ok(['8081','18081'].includes(port));
assert.match(output??'',/^\/home\/powadmin\/audit17-[a-z0-9-]+$/);
await mkdir(output,{mode:0o700});
const started=Date.now(), deadline=started+180000, receipts=[];
const hash=b=>createHash('sha256').update(b).digest('hex');
const run=promisify(execFile);
let requests=0,bytes=0;
const remaining=()=>{assert.ok(Date.now()<deadline);return Math.min(60000,deadline-Date.now());};
async function save(kind,request,data){const raw=Buffer.from(JSON.stringify(data));bytes+=raw.length;assert.ok(bytes<=32*1024*1024);const file=String(receipts.length).padStart(3,'0')+'-'+kind+'.json.gz';await writeFile(output+'/'+file,gzipSync(raw),{flag:'wx',mode:0o600});receipts.push({kind,request,file,sha256:hash(raw)});return data;}
async function core(method,args=[]){assert.ok(++requests<=50);const {stdout}=await run('sudo',['-n','-u','bitcoin','/usr/local/bin/bitcoin-cli','-conf=/etc/bitcoin/bitcoin.conf',method,...args.map(String)],{timeout:remaining(),maxBuffer:8*1024*1024});return save('core',[method,...args],JSON.parse(stdout));}
async function get(path){assert.ok(++requests<=50);const res=await fetch('http://127.0.0.1:'+port+path,{redirect:'error',signal:AbortSignal.timeout(remaining())});assert.equal(res.status,200);let size=0;const parts=[];for await(const chunk of res.body){size+=chunk.length;assert.ok(size<=8*1024*1024);parts.push(chunk);}return save('http',path,JSON.parse(Buffer.concat(parts)));}
const report={format:'audit17-boost-profile-assets-v1',startedAt:new Date(started).toISOString(),port,receipts};
try {
 const before=await core('getblockchaininfo');assert.equal(before.initialblockdownload,false);
 const health=await get('/health');assert.equal(health.ready,true);assert.equal(health.lagBlocks,0);
 const registry=await get('/api/v1/registry?network=livenet');assert.equal(registry.stats.total,registry.records.length);assert.notEqual(registry.collectionHasMore?.records,true);
 const events=await get('/api/v1/events?network=livenet&protocol=pwb1&status=confirmed&limit=200');assert.equal(events.totalCount,events.items.length);assert.equal(events.hasMore,false);assert.equal(events.items.length,10);
 assert.ok(events.items.every(e=>e.confirmed===true&&!['boost-transfer','boost-buy'].includes(e.kind)),'Live fixture changed; review newly observed ownership history.');
 for(const p of [registry,events]){assert.equal(p.indexedThroughBlock,before.blocks);assert.equal(p.indexedThroughBlockHash,before.bestblockhash);}
 const blocks=new Map();
 for(const e of events.items){const tx=await core('getrawtransaction',[e.txid,true]);assert.ok(tx.confirmations>0);assert.equal(tx.txid,e.txid);assert.equal(tx.blockhash,e.blockHash);if(!blocks.has(e.blockHash))blocks.set(e.blockHash,await core('getblock',[e.blockHash,1]));const block=blocks.get(e.blockHash);assert.equal(block.height,e.blockHeight);assert.equal(block.tx[e.blockIndex],e.txid);}
 const owners=registry.records.filter(r=>r.confirmed===true).map(r=>[r.id.trim().toLowerCase().replace(/^@/u,'').replace(/@proofofwork\.me$/u,'').trim(),r.ownerAddress]).sort(([a],[b])=>Buffer.compare(Buffer.from(a),Buffer.from(b)));
 const ownerMap=new Map(owners);assert.equal(ownerMap.size,owners.length);
 report.profiles=[];
 for(const id of ['carbonz','armyofyouth']){
  const p=await get('/api/v1/boost?network=livenet&profile='+id+'&profileTab=purchased');
  assert.equal(p.indexedThroughBlock,before.blocks);assert.equal(p.indexedThroughBlockHash,before.bestblockhash);assert.equal(p.complete,true);assert.equal(p.profileSubject.address,ownerMap.get(id));assert.equal(p.provenance.identityRegistry.ownersSha256,hash(JSON.stringify(owners)));assert.equal(p.profileSubject.purchasedCount,0);assert.equal(p.profileTabs.purchased,0);assert.equal(p.items.length,0);assert.equal(p.hasMore,false);report.profiles.push({id,address:p.profileSubject.address,purchasedCount:p.profileSubject.purchasedCount});
 }
 const after=await core('getblockchaininfo');assert.equal(after.blocks,before.blocks);assert.equal(after.bestblockhash,before.bestblockhash);report.checkpoint={height:after.blocks,hash:after.bestblockhash};report.confirmedBoostEvents=events.items.length;report.ownersSha256=hash(JSON.stringify(owners));report.ok=true;
} catch(error){report.ok=false;report.failure=String(error.message).slice(0,1200);process.exitCode=1;}
report.finishedAt=new Date().toISOString();report.qualification='Complete current Boost fixture, Core-confirmed event positions and profile projection; no new full-market, historical protocol replay or signing claim.';
await writeFile(output+'/receipt.json',JSON.stringify(report,null,2)+'\n',{flag:'wx',mode:0o600});
console.log(JSON.stringify({ok:report.ok,output,failure:report.failure??null}));
