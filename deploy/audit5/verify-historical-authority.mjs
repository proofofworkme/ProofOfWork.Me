// Offline validation of retained authority for exactly two historical summary IDs.
// Reads files and pure candidate math modules only; no API, DB, Core, or writes.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync, realpathSync, statSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import vm from 'node:vm';
const APP='/opt/proofofwork-api-stage-2ddefac163d5-20260905T180603Z';
const PINS={
 'server/db/proof-index-reader.mjs':'9408ff8d2c62cf1ab98835e87512a3c2ce19737d70f134271db66a8d4e47d048',
 'server/work-amo-v5-seed-evidence.mjs':'bc74df76c1ba87215083e64bb957642bcbf99677ef0d4292973aafdd6c5d70b3',
 'server/work-amo-v5-bip141.mjs':'9805104d912930aa54f43665b793949bccc20572fcbba01a0eb50a5b259c7d98',
 'server/work-amo-v5.mjs':'98ced8aac4822788f04f924dbd929c9c40a02b14dc1fc1318a2f00dfe9b9e00d',
 'server/work-amo-v5-raw.mjs':'982480d43555dcea0aa7fd045931ce1252187e746d3ed32e20beea1802e3b50c',
};
const SEED='cb13bc6edd20d72f6ae3919e',CLOSING='ae8f28b922cecee2580a97e5';
const HASH=/^[0-9a-f]{64}$/u;
const sha=b=>createHash('sha256').update(b).digest('hex');
const plain=v=>JSON.parse(JSON.stringify(v));
function same(a,b,label){assert.deepEqual(plain(a),plain(b),label);}
export function verifyAuthority(v,core,ctx){
 assert.equal(v.format,'audit5-historical-summary-authority-v1');assert.equal(v.database,'proof_indexer');
 assert.equal(core.format,'audit5-historical-summary-core-v1');same(core.before,core.after,'Core checkpoint moved');
 assert.equal(v.seedRows.length,1);assert.equal(v.transitions.length,2);assert.equal(v.blocks.length,3);assert.equal(core.blocks.length,3);
 for(const height of [959620,959621,959804]){
  const db=v.blocks.filter(b=>b.height===height),node=core.blocks.filter(b=>b.height===height);assert.equal(db.length,1);assert.equal(node.length,1);
  assert.equal(db[0].canonical,true);assert.equal(db[0].hash,node[0].hash);assert.equal(db[0].previousHash,node[0].previousHash);assert.match(db[0].hash,HASH);
 }
 const migration=v.migration.value,certificate=migration.bootstrapCertificate,replay=migration.replayEvidence;
 assert.match(v.migration.rowSha256,HASH);assert.equal(migration.network,'livenet');assert.equal(migration.model,'canonical-work-amo-v5-migration-v2');assert.equal(migration.status,'complete');
 assert.equal(migration.declarationTxid,ctx.declarationTxid);assert.equal(migration.activationHeight,959621);assert.equal(migration.replayFromHeight,959621);
 assert.equal(replay.relationalTokenState?.complete,true,'Completed relational token state is mandatory.');
 for(const object of [replay,replay.transitionReplay])for(const key of ['complete','blockAtomic','endTipParity'])assert.equal(object[key],true);
 const first=v.transitions.find(t=>t.blockHeight===959621),last=v.transitions.find(t=>t.blockHeight===959804);
 for(const t of [first,last]){
  assert.equal(t.network,'livenet');assert.equal(t.model,'canonical-work-amo-full-position-block-sequencer-v2');assert.equal(t.stateCommitmentModel,'canonical-work-amo-sufficient-state-sha256-v1');
  for(const key of ['blockCanonical','complete','blockAtomic','feeOnce','invalidZero'])assert.equal(t[key],true);
  const b=v.blocks.find(b=>b.height===t.blockHeight);assert.equal(t.blockHash,b.hash);assert.equal(t.previousBlockHash,b.previousHash);assert.equal(t.canonicalPreviousHash,b.previousHash);assert.match(t.rowSha256,HASH);
 }
 const row=v.seedRows[0],seedSet={rowCount:1,rows:[{snapshotId:row.snapshot_id,indexedThroughBlock:row.indexed_through_block,sourceHashes:row.source_hashes,metrics:row.metrics,consistency:row.consistency,payload:row.payload}]};
 assert.equal(row.network,'livenet');
 const retained=ctx.seedReadiness(seedSet,true,replay.seed,{activationTransition:{blockHeight:first.blockHeight,blockHash:first.blockHash,previousBlockHash:first.previousBlockHash,openingNetworkValueQ8:first.openingNetworkValueQ8,openingStateModel:first.stateCommitmentModel,openingStatePayloadBytes:first.openingStatePayloadBytes,openingStateSha256:first.openingStateSha256},bootstrapSeedCommitment:certificate.seedCommitment,firstOpeningCommitment:replay.transitionReplay.firstOpeningCommitment,independentSeed:replay.independentSeed});
 assert.equal(retained?.ready,true,'Retained seed failed canonical closed-preimage and marker/activation validation');assert.equal(retained.seed.snapshotId,SEED);
 assert.equal(retained.seed.blockHash,v.blocks.find(b=>b.height===959620).hash);assert.equal(first.previousBlockHash,retained.seed.blockHash);
 assert.equal(certificate.throughHeight,959804);assert.equal(certificate.throughBlockHash,last.blockHash);assert.equal(replay.throughHeight,959804);assert.equal(replay.throughBlockHash,last.blockHash);
 assert.equal(replay.closing.blockHeight,959804);assert.equal(replay.closing.blockHash,last.blockHash);assert.equal(replay.closing.networkValueQ8,last.closingNetworkValueQ8);assert.equal(replay.closing.summaryHash,'e1dae9670d9ba06aa67d84a1d7bd6b7e607e53197f9cae59d8c93354e129b2fc','Pin the reviewed historical provenance digest; its absent payload is not rehashed.');
 same(replay.closing.snapshotIds,[CLOSING]);assert.equal(replay.closing.snapshotCount,1);same(replay.seed.snapshotIds,[SEED]);assert.equal(replay.seed.snapshotCount,1);
 assert.match(last.closingStateSha256,HASH);assert.ok(Number.isSafeInteger(last.closingStatePayloadBytes)&&last.closingStatePayloadBytes>0);
 const closingCommitment={model:last.stateCommitmentModel,payloadBytes:last.closingStatePayloadBytes,sha256:last.closingStateSha256};
 same(certificate.finalTipCommitment,closingCommitment,'Bootstrap closing state commitment');same(replay.transitionReplay.finalTipCommitment,closingCommitment,'Replay closing state commitment');
 for(const [certificateKey,payloadKey,model] of [['finalBlockDescriptorCommitment','blockDescriptorCommitment','canonical-work-amo-payload-sha256-v1'],['finalTransitionChainCommitment','transitionChainCommitment','canonical-work-amo-raw-transition-chain-sha256-v1']]){
  const commitment=certificate[certificateKey];assert.equal(commitment.model,model);assert.match(commitment.sha256,HASH);assert.ok(Number.isSafeInteger(commitment.payloadBytes)&&commitment.payloadBytes>0);same(last.payload[payloadKey],commitment);same(replay.transitionReplay[certificateKey],commitment);
 }
 assert.equal(last.payload.transitionChainModel,'canonical-work-amo-raw-transition-chain-sha256-v1');
 for(const object of [certificate,replay.transitionReplay]){
  assert.equal(object.blockDescriptorModel,'canonical-work-amo-raw-full-block-descriptor-v1');assert.equal(object.transitionChainModel,'canonical-work-amo-raw-transition-chain-sha256-v1');
  assert.equal(object.finalBlockTransactionCount,last.payload.blockTransactionCount);
  assert.ok(ctx.normalizeBip141(object.finalBip141Witness,object.finalBlockTransactionCount));
  assert.ok(ctx.equalBip141(object.finalBip141Witness,last.payload.bip141Witness,last.payload.blockTransactionCount));
 }
 assert.ok(ctx.normalizeBip141(last.payload.bip141Witness,last.payload.blockTransactionCount));
 const refs=v.references;assert.equal(new Set(refs.map(r=>r.id)).size,refs.length);const absent=refs.filter(r=>!r.resolved);same(absent.map(r=>r.id).sort(),[CLOSING,SEED].sort());
 for(const r of refs){
  assert.ok(Array.isArray(r.origins)&&r.origins.length>0);assert.equal(new Set(r.origins).size,r.origins.length);
  for(const origin of r.origins)assert.ok(['issuance','witness','seed-evidence','seed-summary-provenance','migration-seed-provenance','migration-closing-provenance'].includes(origin));
  if(r.resolved)assert.match(r.row_sha256,HASH);else{
   assert.equal(r.row_sha256,null);same(r.origins,r.id===SEED?['migration-seed-provenance','seed-summary-provenance']:['migration-closing-provenance']);
  }
 }
 const authority=refs.find(r=>r.id===row.snapshot_id);assert.ok(authority?.resolved);assert.ok(authority.origins.includes('seed-evidence'));
 return {ok:true,classification:'validated-historical-summary-provenance-absence',resolvedProtectedRows:refs.filter(r=>r.resolved).length,absentProvenanceIds:absent.map(r=>r.id).sort(),seedAuthority:{snapshotId:row.snapshot_id,rowSha256:authority.row_sha256,evidenceCommitment:row.payload.evidenceCommitment,summary:retained.seed},migrationRowSha256:v.migration.rowSha256,transitionRows:[first,last].map(t=>({height:t.blockHeight,hash:t.blockHash,rowSha256:t.rowSha256})),references:refs,coreCheckpoint:core.after,qualification:'Protect every existing referenced row byte-for-byte and preserve the two exact absent provenance bindings. This validates retained seed/bootstrap authority; it neither restores nor recreates the missing historical summary payloads, and it is not a fresh replay of all transitions.'};
}
export async function candidateContext(candidate){
 for(const [path,pin] of Object.entries(PINS))assert.equal(sha(readFileSync(`${candidate}/${path}`)),pin,`Candidate source pin ${path}`);
 const [seed,amo,bip]=await Promise.all(['work-amo-v5-seed-evidence.mjs','work-amo-v5.mjs','work-amo-v5-bip141.mjs'].map(file=>import(pathToFileURL(`${candidate}/server/${file}`).href)));
 const reader=readFileSync(`${candidate}/server/db/proof-index-reader.mjs`,'utf8');const start=reader.indexOf('function proofIndexWorkAmoSeedEvidenceReadiness('),end=reader.indexOf('\nexport async function proofIndexWorkAmoReplayReadiness(',start);assert.ok(start>=0&&end>start);
 const seedReadiness=vm.runInNewContext(`(${reader.slice(start,end).trim()})`,{validatedWorkAmoV5HMinusOneSeedEvidence:seed.validatedWorkAmoV5HMinusOneSeedEvidence,WORK_AMO_V5_ACTIVATION_HEIGHT:amo.WORK_AMO_V5_ACTIVATION_HEIGHT,WORK_AMO_V5_H_MINUS_ONE_CANONICAL_SUMMARY_SNAPSHOT_ID:SEED,WORK_AMO_V5_H_MINUS_ONE_SEED_EVIDENCE_STATUS:seed.WORK_AMO_V5_H_MINUS_ONE_SEED_EVIDENCE_STATUS});
 return {seedReadiness,declarationTxid:amo.WORK_AMO_V5_DECLARATION_TXID,normalizeBip141:bip.normalizedWorkAmoV5Bip141Witness,equalBip141:bip.workAmoV5Bip141WitnessesEqual};
}
async function main(){
 assert.equal(process.version,'v24.18.0');const args=process.argv.slice(2);assert.equal(args.length,6);assert.equal(args[0],'--candidate');assert.equal(args[1],APP);assert.equal(realpathSync(APP),APP);assert.equal(args[2],'--evidence');assert.equal(args[4],'--core');
 const load=p=>{assert.ok(statSync(p).size<=32*1024*1024);return JSON.parse(readFileSync(p,'utf8'));};
 const result=verifyAuthority(load(args[3]),load(args[5]),await candidateContext(APP));process.stdout.write(JSON.stringify(result,null,2)+'\n');
}
if(process.argv[1]&&pathToFileURL(realpathSync(process.argv[1])).href===import.meta.url)main().catch(()=>{process.stderr.write('HISTORICAL_SUMMARY_AUTHORITY_REFUSED\n');process.exitCode=1;});
