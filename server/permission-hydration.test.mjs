import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import vm from 'node:vm';
import * as bitcoin from 'bitcoinjs-lib';
import { canonicalRawProtocolRecordSetFromTransaction } from './canonical-op-return.mjs';
import { permissionCandidates, permissionCoreBlockWitness } from './permission-discovery.mjs';
import { workAmoV5RawBlockDiscoveryEnvelope } from './work-amo-v5-raw.mjs';
const source = readFileSync(new URL('./proof-api.mjs', import.meta.url), 'utf8');
const start = source.indexOf('async function canonicalVerifierCurrentBlock(');
const end = source.indexOf('\nasync function ', start + 1);
function fixture(texts) {
  const txs = [null, ...texts].map((text, index) => {
    const tx = new bitcoin.Transaction();
    if (index === 0) tx.addInput(Buffer.alloc(32), 0xffffffff, 0xffffffff, Buffer.from("0401020304", "hex"));
    else tx.addInput(Buffer.alloc(32, index + 1), 0);
    tx.addOutput(Buffer.from('51', 'hex'), 546n);
    if (text) tx.addOutput(bitcoin.script.compile([bitcoin.opcodes.OP_RETURN, Buffer.from(text)]), 0n);
    return tx;
  });
  const header = new bitcoin.Block(); header.version = 1;
  header.prevHash = Buffer.alloc(32, 7); header.merkleRoot = bitcoin.Block.calculateMerkleRoot(txs);
  header.timestamp = 1700000000; header.bits = 0x1d00ffff; header.nonce = 0;
  const hash = header.getId(), parent = Buffer.from(header.prevHash).reverse().toString('hex');
  const raw = txs.map(tx => ({ txid: tx.getId(), hex: tx.toHex(),
    vin: tx.ins.map(i => i.index === 0xffffffff ? { coinbase: Buffer.from(i.script).toString("hex") } : ({ txid: Buffer.from(i.hash).reverse().toString('hex'), vout: i.index, prevout: { scriptpubkey: "51", value: 1000 } })),
    vout: tx.outs.map(o => ({ scriptpubkey: Buffer.from(o.script).toString('hex'), value: Number(o.value) })) }));
  return { hash, parent, header: header.toHex(true), raw, height: 970492 };
}
function reader(f, { failUnrelated = false, wrongHash = false, unsupported = false } = {}) {
  const hydrated = [], rpc = [];
  const fn = vm.runInNewContext(`(${source.slice(start, end)})`, {
    permissionCandidates, canonicalRawProtocolRecordSetFromTransaction, TX_FETCH_CONCURRENCY: 4,
    mapWithConcurrency: async (items, limit, map) => { const out=[]; for (const i of items) out.push(await map(i)); return out; },
    bitcoinRpc: async (method, params) => { rpc.push(method); if (unsupported && method === 'getblock' && params[1] === 3) return {ok:false,error:{code:-8}}; return {ok:true,result:method==='getblockhash' ? (wrongHash ? 'f'.repeat(64) : f.hash) : method==='getblockheader' ? f.header : {height:f.height,hash:f.hash,previousblockhash:f.parent,nTx:f.raw.length,tx:f.raw,time:1700000000}}; },
    fetchTransactionFromBitcoinRpc: async (id, network, options) => {
      assert.equal(options.requireCanonicalPrevouts, true); hydrated.push(id);
      const tx = f.raw.find(t => t.txid === id);
      if (failUnrelated && !permissionCandidates(canonicalRawProtocolRecordSetFromTransaction(tx).records).length) throw Error('unrelated prevout unavailable');
      return {...tx,vin:tx.vin.map(i=>i.coinbase?i:{...i,prevout:i.prevout??{scriptpubkey:'51',value:1000}}),_powCanonicalRpcHydration:true,status:{confirmed:true,block_hash:f.hash,block_height:f.height}};
    },
    transactionConfirmed: t => t.status.confirmed, transactionTxid:t=>t.txid, transactionBlockHash:t=>t.status.block_hash,
  });
  return { hydrated,rpc,run: options=>fn('livenet',f.height,f.parent,f.hash,false,options) };
}
function envelope(f, result) { return workAmoV5RawBlockDiscoveryEnvelope({blockTransactions:result.blockTransactions,blockHeaderHex:result.blockHeaderHex,blockHash:f.hash,blockHeight:f.height,previousBlockHash:f.parent}); }
test('Permission-only hydration retains exact complete raw-block commitments and malformed Permission candidates', async () => {
  const f=fixture(['pwt1:malformed','pwm1:m:pwperm1:malformed','pwm1:m:ordinary',null]);
  const full=reader(f), scoped=reader(f); const a=await full.run(),b=await scoped.run({permissionOnly:true});
  assert.equal(full.hydrated.length,3);assert.equal(scoped.hydrated.length,1);
  assert.equal(b.blockTransactions.length,5);
  const all=envelope(f,a), selected=envelope(f,b);
  assert.deepEqual(selected,all);
  const witness=permissionCoreBlockWitness(selected,b.transactions.map(t=>({...t,blockTransactionIndex:t._powBlockIndex})),{blockHeight:f.height,blockHash:f.hash});
  assert.equal(witness.transactions.length,1); assert.equal(witness.rawRecords.length,3);
});
test('unrelated hydration failure cannot stall Permission, but default full replay still refuses',async()=>{
  const f=fixture(['pwt1:malformed','pwm1:m:pwperm1:malformed']);
  await assert.rejects(reader(f,{failUnrelated:true}).run(),/unrelated/);
  assert.equal((await reader(f,{failUnrelated:true}).run({permissionOnly:true})).transactions.length,1);
});
test('no Permission carriers needs no prevout hydration without dropping other raw records',async()=>{
  const f=fixture(['pwt1:malformed','pwid1:malformed']); const r=reader(f);
  const b=await r.run({permissionOnly:true});assert.equal(r.hydrated.length,0); assert.equal(envelope(f,b).records.length,2);
});
test('replacement hash refuses before any block hydration in both modes',async()=>{
  const f=fixture(['pwm1:m:pwperm1:malformed']);
  for(const options of [undefined,{permissionOnly:true}]) {const r=reader(f,{wrongHash:true});await assert.rejects(r.run(options),/canonical hash/);assert.equal(r.hydrated.length,0);assert.deepEqual(r.rpc,['getblockhash']);}
});
test('missing undo prevouts falls back to canonical hydration; malformed supplied evidence fails closed',async()=>{
  const f=fixture(['pwt1:malformed','pwm1:m:pwperm1:malformed']);
  delete f.raw[1].vin[0].prevout;
  const r=reader(f);await r.run({permissionOnly:true});assert.equal(r.hydrated.length,2);
  const bad=fixture(['pwt1:malformed']);bad.raw[1].vin[0].prevout.value='not-a-number';
  assert.throws(()=>envelope(bad,{blockTransactions:bad.raw,blockHeaderHex:bad.header}),/witness-invalid/);
});
test('public Core block replay retains exact all-protocol commitment while reducing hydration', {skip:!process.env.PERMISSION_CORE_FIXTURE},async()=>{
  const captured=JSON.parse(readFileSync(process.env.PERMISSION_CORE_FIXTURE,'utf8'),(key,value)=>key==='value' && typeof value==='string' ? Number(value) : value).blocks[0];
  const f={hash:captured.hash,parent:captured.block.previousblockhash,header:captured.header,height:captured.height,raw:captured.block.tx};
  const a=reader(f),b=reader(f);const before=performance.now();const full=await a.run();const afterFull=performance.now();const scoped=await b.run({permissionOnly:true});const afterScoped=performance.now();
  assert.deepEqual(envelope(f,scoped),envelope(f,full));
  console.log(JSON.stringify({height:f.height,transactions:f.raw.length,fullHydrations:a.hydrated.length,permissionHydrations:b.hydrated.length,fullFixtureMs:afterFull-before,scopedFixtureMs:afterScoped-afterFull,rawCommitmentParity:true}));
});

test('Core without verbosity 3 falls back to full canonical hydration and identical block evidence',async()=>{
 const f=fixture(['pwt1:malformed','pwm1:m:pwperm1:malformed']);
 const expected=envelope(f,await reader(f).run());
 for(const tx of f.raw)for(const input of tx.vin)if(!input.coinbase)delete input.prevout;
 const r=reader(f,{unsupported:true});const result=await r.run({permissionOnly:true});
 assert.equal(r.hydrated.length,2);assert.equal(r.rpc.filter(x=>x==='getblock').length,2);
 assert.deepEqual(envelope(f,result),expected);
});
