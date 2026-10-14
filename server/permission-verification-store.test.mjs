import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createPermissionVerificationStore } from './permission-verification-store.mjs';
import { createPermissionDiscovery } from './permission-discovery.mjs';
import { createPermissionIndexDiscovery } from './db/permission-reader.mjs';
import { workAmoV5CanonicalPayloadCommitment as commit, WORK_AMO_V5_BLOCK_SEQUENCER_MODEL } from './work-amo-v5.mjs';
const opening=970492, hex=n=>n.toString(16).padStart(64,'0');
async function fixture(t, storeOptions={}) {
 const directory=await fs.mkdtemp(path.join(os.tmpdir(),'permission-journal-'));
 t.after(()=>fs.rm(directory,{recursive:true,force:true}));
 const rows=[opening,opening+1,opening+2].map(height=>({height,block_hash:hex(height),previous_block_hash:hex(height-1),canonical_height_count:1,
  complete:true,block_atomic:true,fee_once:true,invalid_zero:true,model:WORK_AMO_V5_BLOCK_SEQUENCER_MODEL,protocol_record_count:0,raw_protocol_candidate_count:0,
  storage_commitment:{version:1,sha256:hex(height)},payload:{replayRecords:[],rawProtocolCandidateCount:0,replayDescriptorCommitment:commit([]),blockDescriptorCommitment:commit({height})}}));
 let clock=0,advance=0,coreReads=0,prefixReads=0,alterIndex=false,tip=rows.at(-1),feeParent=hex(opening-1),pending=[];
 const coreHash=async h=>h===opening-1?feeParent:rows.find(r=>r.height===h)?.block_hash;
 const client={async query(sql,params){
  if(sql.includes('permission_verified_prefix_anchor'))return{rows:[{block_hash:await coreHash(params[1])}]};
  if(sql.includes('permission_verified_prefix_coverage')){prefixReads++;const values=structuredClone(rows.filter(r=>r.height>=params[1]&&r.height<=params[2]));if(alterIndex)values[0].storage_commitment.sha256=hex(99);return{rows:values};}
  if(sql.includes('permission_raw_block_coverage'))return{rows:structuredClone(rows.filter(r=>r.height>=params[1]&&r.height<=params[2]))};
  if(sql.includes('permission_pending_candidates'))return{rows:pending.map(txid=>({txid}))};
  return{rows:[]};},release(){}};
 const readIndex=createPermissionIndexDiscovery({pool:{connect:async()=>client},readScan:async()=>({payload:{complete:true,tipHeight:tip.height,indexedThroughBlockHash:tip.block_hash},indexed_through_block:tip.height,consistency:{ok:true,status:'block-scan-current'}})});
 const make=(extra={})=>createPermissionDiscovery({store:createPermissionVerificationStore({directory,...storeOptions}),readIndex,readCoreHash:coreHash,
  feeRateActivationHeight:opening,feeRateActivationPreviousBlockHash:hex(opening-1),now:()=>clock,readBudgetMs:10,
  async readCoreBlock(row){coreReads++;clock+=advance;return{descriptor:row.payload.blockDescriptorCommitment,rawProtocolCandidateCount:0,rawRecords:[],transactions:[]};},
  hydratePending:async txid=>[{txid,status:{confirmed:false}}],...extra});
 return{directory,rows,make,run:d=>d('livenet',{height:tip.height,blockHash:tip.block_hash},opening,hex(opening-1)),
  advance:v=>{advance=v;},setTip:i=>{tip=rows[i];},fork:()=>{rows[1].block_hash=hex(800);rows[2].previous_block_hash=hex(800);rows[2].block_hash=hex(801);},
  corruptIndex:()=>{alterIndex=true;},wrongParent:()=>{feeParent=hex(999);},pending:v=>{pending=v;},coreReads:()=>coreReads,prefixReads:()=>prefixReads,
  file:path.join(directory,`permission-livenet-${opening}.json`)};
}
test('partial progress survives restart; every restored prefix is reauthenticated by index and Core before authority',async t=>{
 const f=await fixture(t);f.advance(6);const first=f.make();await assert.rejects(f.run(first),/read budget/);
 assert.equal(first.progress('livenet',opening,hex(opening-1)).durableVerifiedThroughBlock,opening);
 f.advance(0);const before=f.coreReads(),result=await f.run(f.make());assert.equal(result.coverage.complete,true);assert.equal(f.coreReads()-before,2);assert.ok(f.prefixReads()>0);
 const checked=f.coreReads();await f.run(f.make());assert.equal(f.coreReads(),checked);
});
test('restored receipts cannot bypass native storage commitment or live prefix witness mutation',async t=>{
 const f=await fixture(t);await f.run(f.make());f.corruptIndex();await assert.rejects(f.run(f.make()),/prefix witness changed/);
});
test('a changed activation/fee parent refuses authenticated old receipts',async t=>{
 const f=await fixture(t);await f.run(f.make());f.wrongParent();await assert.rejects(f.run(f.make()),/canonical/);
});
test('reorg retains only the common Core prefix and reconstructs replacement blocks',async t=>{
 const f=await fixture(t);await f.run(f.make());const before=f.coreReads();f.fork();const result=await f.run(f.make());assert.equal(result.coverage.complete,true);assert.equal(f.coreReads()-before,2);
});
test('older queued targets cannot truncate newer durable history',async t=>{
 const f=await fixture(t);await f.run(f.make());const bytes=await fs.readFile(f.file);f.setTip(0);await f.run(f.make());assert.deepEqual(await fs.readFile(f.file),bytes);f.setTip(2);const before=f.coreReads();await f.run(f.make());assert.equal(f.coreReads(),before);
});
test('pending data is never persisted and is freshly hydrated after restart',async t=>{
 const f=await fixture(t);f.pending([hex(500)]);assert.equal((await f.run(f.make())).transactions.length,1);assert.equal((await fs.readFile(f.file,'utf8')).includes(hex(500)),false);f.pending([]);assert.deepEqual((await f.run(f.make())).transactions,[]);
});
test('mutated envelope fails authentication',async t=>{
 const f=await fixture(t);await f.run(f.make());const e=JSON.parse(await fs.readFile(f.file));e.payload=e.payload.replace('permission-verified','forged-verified');await fs.writeFile(f.file,JSON.stringify(e));await assert.rejects(f.run(f.make()),/authentication failed/);
});
test('missing authentication key beside existing receipts fails closed',async t=>{
 const f=await fixture(t);await f.run(f.make());await fs.unlink(path.join(f.directory,'authentication.key'));await assert.rejects(f.run(f.make()),/key is missing/);
});
test('wrong verifier or fee-version identity cannot reuse old authority',async t=>{
 const f=await fixture(t);await f.run(f.make());const wrong=createPermissionVerificationStore({directory:f.directory,verifierVersion:2});await assert.rejects(f.run(f.make({store:wrong})),/identity\/version/);
 const feeChanged=createPermissionVerificationStore({directory:f.directory});await assert.rejects(feeChanged.restore({network:'livenet',activationHeight:opening,activationPreviousBlockHash:hex(opening-1),feeRateActivationHeight:opening+1,feeRateActivationPreviousBlockHash:hex(opening)},{height:opening+2},async h=>hex(h)),/identity\/version/);
});
test('failed atomic publication leaves the previous journal recoverable and does not advertise new progress',async t=>{
 let fail=false;const f=await fixture(t,{beforeRename:async()=>{if(fail)throw new Error('interrupted publication');}});f.setTip(0);await f.run(f.make());fail=true;f.setTip(2);await assert.rejects(f.run(f.make()),/interrupted publication/);fail=false;const before=f.coreReads();await f.run(f.make());assert.equal(f.coreReads()-before,2);
});
test('unsafe journal permissions, hardlinks and symlinks are refused',async t=>{
 const f=await fixture(t);await f.run(f.make());await fs.chmod(f.file,0o644);await assert.rejects(f.run(f.make()),/unsafe checkpoint/);await fs.chmod(f.file,0o600);
 const other=path.join(f.directory,'linked');await fs.link(f.file,other);await assert.rejects(f.run(f.make()),/unsafe checkpoint/);await fs.unlink(other);
 await fs.rename(f.file,other);await fs.symlink(other,f.file);await assert.rejects(f.run(f.make()),/ELOOP/);
});
test('journal and projection budgets fail closed without changing configured read limits',async t=>{
 const f=await fixture(t,{maxBytes:20});await assert.rejects(f.run(f.make()),/byte budget/);
 const g=await fixture(t,{maxProjectionBytes:1});await assert.rejects(g.run(g.make()),/projection byte budget/);
});

test('exact large integer transaction strings survive restart and restored objects cannot mutate receipts',async t=>{
 const f=await fixture(t);const {permissionBlockWitnessSeed,permissionBlockWitnessNext,permissionIndexWitnessSeed,permissionIndexWitnessNext}=await import('./db/permission-reader.mjs');
 const scope={network:'livenet',activationHeight:opening,activationPreviousBlockHash:hex(opening-1),feeRateActivationHeight:opening,feeRateActivationPreviousBlockHash:hex(opening-1)};
 const row=f.rows[0],transactions=[{txid:hex(345),amountSubatoms:'900719925474099312345678901234567890',feeRateProofsQ8:'12345678901234567890',nested:{value:'0.0000000000000001'}}];
 const store=createPermissionVerificationStore({directory:f.directory});await store.append(scope,row,transactions,permissionBlockWitnessNext(permissionBlockWitnessSeed('livenet',opening,hex(opening-1)),row),permissionIndexWitnessNext(permissionIndexWitnessSeed('livenet',opening,hex(opening-1)),row));
 const restored=createPermissionVerificationStore({directory:f.directory});const a=await restored.restore(scope,{height:opening},async h=>hex(h));assert.deepEqual(a.transactions,transactions);a.transactions[0].nested.value='altered';
 assert.deepEqual((await restored.restore(scope,{height:opening},async h=>hex(h))).transactions,transactions);
});
test('authenticated but inconsistent witness-chain contents are refused',async t=>{
 const f=await fixture(t);await f.run(f.make());const {createHmac}=await import('node:crypto');
 const envelope=JSON.parse(await fs.readFile(f.file));const state=JSON.parse(envelope.payload);state.blocks[0].indexWitnessSha256=hex(77);envelope.payload=JSON.stringify(state);envelope.mac=createHmac('sha256',await fs.readFile(path.join(f.directory,'authentication.key'))).update(envelope.payload).digest('hex');await fs.writeFile(f.file,JSON.stringify(envelope));
 await assert.rejects(f.run(f.make()),/witness chain differs/);
});

test('an older target cannot downgrade a newer in-memory verified prefix',async t=>{
 const f=await fixture(t);const discovery=f.make();await f.run(discovery);f.setTip(0);await f.run(discovery);
 assert.equal(discovery.progress('livenet',opening,hex(opening-1)).verifiedThroughBlock,opening+2);
 f.setTip(2);const before=f.coreReads();await f.run(discovery);assert.equal(f.coreReads(),before);
});
