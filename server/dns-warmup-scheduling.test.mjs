import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { createDnsSubdomainDiscovery } from './dns-subdomain-discovery.mjs';
import { workAmoV5CanonicalPayloadCommitment as commit } from './work-amo-v5.mjs';

const body = await readFile(process.env.DNS_SCHEDULER_SOURCE ?? new URL('./proof-api.mjs', import.meta.url), 'utf8');
const start = body.indexOf('let dnsCoverageWarmInFlight = false;');
const end = body.indexOf('\nfunction prewarmExpensiveReadCaches()', start);
assert.ok(start >= 0 && end > start);
const source = body.slice(start, end);
function deferred() { let resolve, reject; const promise = new Promise((yes,no) => {resolve=yes;reject=no;}); return {promise,resolve,reject}; }
function harness({ activations=[10,20,30], callbacks=[], rpc, enabled=true }={}) {
  const calls=[],timers=[],logs=[];let tips=0;
  const discoveries=activations.map((_,index)=>Object.assign(async (...args)=> {
    calls.push({index,args});return callbacks[index]?.(...args);
  },{progress:()=>({verifiedThroughBlock:100+index})}));
  const context=vm.createContext({BITCOIN_RPC_URL:enabled?'configured':'',
    bitcoinRpc:async(method,args)=>{assert.equal(method,'getblockchaininfo');assert.equal(args.length,0);tips++;return rpc?rpc(tips):{height:100+tips,blockHash:String(tips).padStart(64,'0')};},
    exactCoreTipFromBlockchainInfo:v=>v,
    discoverDnsSubdomains:discoveries[0],discoverDnsPageLinks:discoveries[1],discoverDnsSubdomainPageLinks:discoveries[2],
    DNS_SUBDOMAIN_ACTIVATION_HEIGHT:activations[0],DNS_PAGE_LINK_ACTIVATION_HEIGHT:activations[1],DNS_SUBDOMAIN_PAGE_LINK_ACTIVATION_HEIGHT:activations[2],
    errorSummary:e=>e.message,
    console:{log:value=>logs.push(JSON.parse(value))},
    setTimeout(fn,delay){const timer={fn,delay,unrefed:false,unref(){this.unrefed=true;}};timers.push(timer);return timer;},
  });
  vm.runInContext(source,context);
  return {calls,timers,logs,discoveries,run:()=>context.warmDnsVerifiedCoverage(),tips:()=>tips};
}
const catchup=()=>{const e=new Error('budget exhausted');e.code='DNS_DISCOVERY_CATCH_UP';throw e;};
test('cold catch-up executes one lane and reserves a full quiet minute after it settles', async()=>{
  const gate=deferred();const h=harness({callbacks:[async()=>{await gate.promise;catchup();},catchup,catchup]});
  const running=h.run();await new Promise(setImmediate);assert.equal(h.calls.length,1);assert.equal(h.timers.length,0);
  gate.resolve();await running;assert.equal(h.calls.length,1);assert.equal(h.timers.length,1);assert.equal(h.timers[0].delay,60000);assert.equal(h.timers[0].unrefed,true);
  assert.equal(h.logs[0].complete,false);assert.equal(h.logs[0].lane,'subdomains');
});
test('round-robin resumes every eligible lane and binds each turn to a fresh Core checkpoint',async()=>{
  const h=harness({callbacks:[catchup,catchup,catchup]});
  for(let i=0;i<6;i++)await h.run();
  assert.deepEqual(h.calls.map(c=>c.index),[0,1,2,0,1,2]);assert.deepEqual(h.calls.map(c=>c.args[1].height),[101,102,103,104,105,106]);
  assert.ok(h.timers.every(t=>t.delay===60000));
});
test('completed lanes obey the same quiet interval',async()=>{const h=harness();await h.run();assert.equal(h.calls.length,1);assert.equal(h.timers[0].delay,60000);assert.equal(h.logs.length,0);});
test('ineligible lanes are skipped without suppressing eligible progress',async()=>{const h=harness({activations:[0,20,999999]});await h.run();await h.run();assert.deepEqual(h.calls.map(c=>c.index),[1,1]);});
test('no eligible lanes creates no discovery authority and remains scheduled',async()=>{const h=harness({activations:[0,999999,999999]});await h.run();assert.equal(h.calls.length,0);assert.equal(h.timers[0].delay,60000);});
test('concurrent warm triggers cannot duplicate work or scheduled successors',async()=>{const gate=deferred();const h=harness({callbacks:[()=>gate.promise]});const a=h.run();await new Promise(setImmediate);await h.run();assert.equal(h.calls.length,1);assert.equal(h.tips(),1);gate.resolve();await a;assert.equal(h.timers.length,1);});
test('failed lane is recorded and does not starve another lane',async()=>{const h=harness({callbacks:[()=>{throw new Error('invalid witness');}]});await h.run();await h.run();assert.deepEqual(h.calls.map(c=>c.index),[0,1]);assert.equal(h.logs[0].complete,false);assert.equal(h.logs[0].reason,'invalid witness');assert.ok(h.timers.every(t=>t.delay===60000));});
test('Core failure cannot run discovery, and retries retain the quiet interval',async()=>{const h=harness({rpc:()=>{throw new Error('Core unavailable');}});await h.run();assert.equal(h.calls.length,0);assert.equal(h.logs[0].complete,false);assert.equal(h.timers[0].delay,60000);});
test('absent Core configuration schedules no unverified work',async()=>{const h=harness({enabled:false});await h.run();assert.equal(h.calls.length,0);assert.equal(h.tips(),0);assert.equal(h.timers.length,0);});

function emptyRows() {
  return [10,11].map(height=>{const descriptor=commit({height,exactCoreBlock:true});return {height,block_hash:String(height).padStart(64,'0'),previous_block_hash:String(height-1).padStart(64,'0'),protocol_record_count:0,raw_protocol_candidate_count:0,payload:{replayRecords:[],replayDescriptorCommitment:commit([]),blockDescriptorCommitment:descriptor,rawProtocolCandidateCount:0}};});
}
function realDiscovery() {
  let time=0,coreReads=0,indexReads=0,hold=null,forge=false;const rows=emptyRows();
  const discover=createDnsSubdomainDiscovery({now:()=>time,readBudgetMs:25000,
    async readCoreHash(height){return String(height).padStart(64,'0');},
    async readCoreBlock(row){coreReads++;if(hold)await hold.promise;time+=26000;return {descriptor:row.payload.blockDescriptorCommitment,rawProtocolCandidateCount:0,rawRecords:[],childEvents:[]};},
    async readIndex(network,options){indexReads++;for(const row of rows.filter(r=>r.height>=(options.fromHeight??10))) {const copy=structuredClone(row);if(forge)copy.payload.replayDescriptorCommitment=commit(['forged']);await options.onBlock(copy);}
      let witness=createHash('sha256').update(JSON.stringify(['dns-subdomain-block-witness-chain-v1','livenet',10])).digest('hex');
      for(const row of rows)witness=createHash('sha256').update(JSON.stringify([witness,row.height,row.block_hash,row.payload.blockDescriptorCommitment,row.payload.replayDescriptorCommitment])).digest('hex');
      return {complete:true,indexedThroughBlock:11,checkpointHash:rows[1].block_hash,activationHeight:10,blockCount:2,witnessSha256:witness,pendingTxids:[]};},hydratePending:async()=>[],
  });
  return {discover,checkpoint:{height:11,blockHash:rows[1].block_hash},coreReads:()=>coreReads,indexReads:()=>indexReads,setHold:v=>{hold=v;},forge:()=>{forge=true;}};
}
test('scheduled slices retain real verified prefix but cannot return partial authority; a foreground retry completes',async()=>{
  const d=realDiscovery();const h=harness({activations:[10,0,0],rpc:()=>d.checkpoint,callbacks:[d.discover]});h.discoveries[0].progress=d.discover.progress;
  await h.run();assert.equal(d.discover.progress('livenet',10).verifiedThroughBlock,10);assert.equal(h.logs[0].complete,false);
  await h.run();assert.equal(d.discover.progress('livenet',10).verifiedThroughBlock,11);assert.equal(h.logs[1].complete,false);
  const result=await d.discover('livenet',d.checkpoint,10);assert.equal(result.coverage.complete,true);assert.equal(result.coverage.indexedThroughBlock,11);assert.equal(d.coreReads(),2);
});
test('foreground and warm-up still join the real exact-checkpoint flight',async()=>{
  const d=realDiscovery(),gate=deferred();d.setHold(gate);const h=harness({activations:[10,0,0],rpc:()=>d.checkpoint,callbacks:[d.discover]});h.discoveries[0].progress=d.discover.progress;
  const background=h.run();await new Promise(setImmediate);const foreground=d.discover('livenet',d.checkpoint,10);const checked=assert.rejects(foreground,/budget/);await new Promise(setImmediate);assert.equal(d.indexReads(),1);assert.equal(d.coreReads(),1);gate.resolve();await Promise.all([background,checked]);assert.equal(d.indexReads(),1);assert.equal(h.logs[0].complete,false);
});
test('forged raw coverage is rejected without publishing prefix through scheduled warm-up',async()=>{
  const d=realDiscovery();d.forge();const h=harness({activations:[10,0,0],rpc:()=>d.checkpoint,callbacks:[d.discover]});h.discoveries[0].progress=d.discover.progress;await h.run();assert.equal(d.discover.progress('livenet',10).verifiedThroughBlock,9);assert.equal(h.logs[0].complete,false);assert.match(h.logs[0].reason,/descriptor/);assert.equal(h.timers[0].delay,60000);
});
