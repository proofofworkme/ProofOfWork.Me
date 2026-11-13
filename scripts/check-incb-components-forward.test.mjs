import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {canonicalIncbReplayComponents, bindCanonicalIncbMintPosition} from '../server/incb-replay-components.mjs';
import {WORK_AMO_V5_MAX_SUPPLY} from '../server/work-amo-v5.mjs';
import {WORK_SUBATOM_UNIT_SCALE} from '../server/work-units.mjs';
const legacy = () => JSON.parse(readFileSync(new URL('./fixtures/incb-replay-components-963782.json', import.meta.url)));
function fixture() {
  const f = JSON.parse(JSON.stringify(legacy()).replaceAll('963782', '975611').replaceAll('963781', '975610'));
  const mint=f.mint, records=f.transition.replayRecords;
  const oracle={model:'canonical-incb-h-minus-one-summary-witness-v1',status:'green',network:'livenet',
    blockHeight:975610,blockHash:mint.issuanceValueSnapshotBlockHash,snapshotId:mint.issuanceValueSnapshotId,
    canonicalSummaryHash:mint.issuanceValueSnapshotCanonicalSummaryHash,
    networkValueQ8:(WORK_AMO_V5_MAX_SUPPLY*WORK_SUBATOM_UNIT_SCALE*60000000n).toString()};
  mint.issuanceValueSnapshotWorkNetworkValueQ8=oracle.networkValueQ8;
  const parent=records[2], child=records[3];
  parent.output.projection.amountSubatoms='1';
  Object.assign(child.output.projection,{amount:'0',attachedWorkIssuanceUnits:'0',attachedWorkAmountSubatoms:'1',attachedWorkLiveValueAtSendQ8:'60000000'});
  child.rawWitness.descriptor=Object.fromEntries(Object.keys(child.rawWitness.descriptor).map(k=>[k,child.output.projection[k]]));
  const secondParent=JSON.parse(JSON.stringify(parent).replaceAll('"protocolVout":3','"protocolVout":4'));
  const secondChild=JSON.parse(JSON.stringify(child).replaceAll('"protocolVout":3','"protocolVout":4').replaceAll(':3:1',':4:1'));
  secondChild.output.projection.amount='1'; secondChild.output.projection.attachedWorkIssuanceUnits='1';
  secondChild.rawWitness.descriptor=Object.fromEntries(Object.keys(secondChild.rawWitness.descriptor).map(k=>[k,secondChild.output.projection[k]]));
  records.push(secondParent,secondChild);
  Object.assign(mint,{amount:'547',confirmedIssuanceUnits:'547',attachedWorkIssuanceUnits:'1',
    attachedWorkLiveValueAtSendQ8:'120000000',attachedWorkAmountSubatoms:'2',issuanceNetworkValueQ8:'54720000000'});
  return {mint,records,oracle};
}
test('legacy fan-in unchanged and pre-boundary witness injection refused',()=>{
 const f=legacy(); assert.equal(canonicalIncbReplayComponents(f.mint,f.transition.replayRecords).attachments.length,1);
 assert.throws(()=>canonicalIncbReplayComponents(f.mint,f.transition.replayRecords,fixture().oracle));
});
test('forward cumulative recipient carry accepts one unit across two fractional attachments',()=>{
 const f=fixture(),before=JSON.stringify(f.records);
 assert.equal(canonicalIncbReplayComponents(f.mint,f.records,f.oracle).attachments.length,2);
 assert.equal(JSON.stringify(f.records),before);
 assert.equal(canonicalIncbReplayComponents(f.mint,[...f.records].reverse(),f.oracle).attachments.length,2);
});
test('forward binding fixes split PWM body position only after complete component proof',()=>{
 const f=fixture(); f.mint.protocolVout=2;
 assert.throws(()=>canonicalIncbReplayComponents(f.mint,f.records,f.oracle));
 const bound=bindCanonicalIncbMintPosition(f.mint,f.records,f.oracle);
 assert.equal(bound.protocolVout,1); assert.equal(bound.recordOrdinal,1); assert.equal(f.mint.protocolVout,2);
 assert.deepEqual({...bound,protocolVout:2},f.mint);
 for(const change of [m=>m.blockHash='a'.repeat(64),m=>m.blockIndex++,m=>m.bondRecipientVout++,m=>m.validationMode='',m=>m.directProofIssuanceUnits='1']) {
  const bad=structuredClone(f); change(bad.mint); assert.throws(()=>bindCanonicalIncbMintPosition(bad.mint,bad.records,bad.oracle));
 }
});
test('forward witness omission, stale identity and arithmetic tampering fail closed',()=>{
 for(const change of [f=>f.oracle=null,f=>f.oracle.networkValueQ8='1',f=>f.oracle.blockHeight--,
  f=>f.oracle.snapshotId='0'.repeat(24),f=>f.oracle.canonicalSummaryHash='0'.repeat(64),
  f=>f.records.push(structuredClone(f.records[1])), f=>f.mint.attachedWorkIssuanceUnits='0',
  f=>{const r=f.records.at(-1);r.output.projection.amount='0';r.rawWitness.descriptor.amount='0';},
  f=>{const r=f.records.at(-1);r.output.projection.attachedWorkLiveValueAtSendQ8='60000001';r.rawWitness.descriptor.attachedWorkLiveValueAtSendQ8='60000001';}]) {
   const f=fixture();change(f);assert.throws(()=>canonicalIncbReplayComponents(f.mint,f.records,f.oracle));
 }
});
