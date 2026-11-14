import test from 'node:test';
import assert from 'node:assert/strict';
import { verifyGate, runGateProbe } from './write-gate-probe.mjs';
const blockHash='a'.repeat(64), parent='00000000000000000002104a6f2c1984df28fd344cc34453d91da639f03cbd13';
const tip={chain:'main',initialblockdownload:false,blocks:975856,bestblockhash:blockHash};
function fixture(enabled=false) {
  const value={network:'livenet',complete:true,source:'proof-indexer-exact-canonical-pay-replay',
    indexedThroughBlock:975856,indexedThroughBlockHash:blockHash,
    snapshot:{checkpointHeight:975856,checkpointHash:blockHash,id:'snapshot'},
    activation:{height:975856,previousBlockHash:parent,ready:true},
    admission:{ready:true,writesEnabled:enabled},pendingComplete:false,invoices:[]};
  return {value,core:async(method,params)=>method==='getblockchaininfo'?tip:params[0]===975855?parent:blockHash,
    read:async()=>value,expectedWriteEnabled:enabled,checkpoint:{height:975856,blockHash}};
}
test('empty exact-tip readers qualify closed and enabled gates without a payment claim',async()=>{
  for(const enabled of [false,true]) {
    const result=await verifyGate(fixture(enabled));assert.equal(result.readerQualified,true);
    assert.equal(result.writesEnabled,enabled);assert.equal(result.signingExercised,false);
    assert.equal(Object.hasOwn(result,'liveSettlementVerified'),false);
  }
});
test('incomplete, stale, wrong-network, wrong-gate or activation evidence refuses',async()=>{
  const changes=[v=>v.complete=false,v=>v.network='testnet',v=>v.indexedThroughBlock--,
    v=>v.snapshot.checkpointHash='b'.repeat(64),v=>v.activation.ready=false,
    v=>v.admission.ready=false,v=>v.admission.writesEnabled=true,v=>v.pendingComplete=true];
  for(const change of changes){const f=fixture();change(f.value);await assert.rejects(verifyGate(f));}
  const f=fixture();f.checkpoint.height++;await assert.rejects(verifyGate(f),/checkpoint-stale/u);
});
test('parent reorg or tip drift after fresh reader qualification refuses',async()=>{
  for(const parentChange of [false,true]) {
    const f=fixture();let reads=0;
    f.core=async(method,params)=>method==='getblockchaininfo'?
      (++reads===2?{...tip,blocks:975857}:tip):params[0]===975855?(parentChange?'b'.repeat(64):parent):blockHash;
    await assert.rejects(verifyGate(f),/parent-changed|tip-changed/u);
  }
});
test('API does not need NETWORK env; credentials go only to configured Core read transport',async()=>{
  const f=fixture(),calls=[];
  const fetchImpl=async(url,options)=>{
    calls.push({url:String(url),options});
    if(String(url).startsWith('http://127.0.0.1:8332')) {
      const {method,params}=JSON.parse(options.body);
      assert.ok(['getblockchaininfo','getblockhash'].includes(method));
      return new Response(JSON.stringify({result:await f.core(method,params),error:null}));
    }
    assert.equal(options.headers,undefined);
    assert.equal(String(url),'http://127.0.0.1:8081/api/v1/pay-invoices?network=livenet&fresh=1&limit=1');
    return new Response(JSON.stringify(f.value));
  };
  const result=await runGateProbe({checkpoint:f.checkpoint,expectedWriteEnabled:false},
    {env:{BITCOIN_RPC_URL:'http://127.0.0.1:8332',BITCOIN_RPC_USER:'fixture',BITCOIN_RPC_PASSWORD:'private'},fetchImpl});
  assert.equal(result.readerQualified,true);assert.equal(calls.length,5);
  assert.ok(!JSON.stringify(result).includes('private'));
});
