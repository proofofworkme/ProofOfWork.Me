import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFileSync,writeFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import ts from '/home/sixer/ProofOfWork.Me/node_modules/typescript/lib/typescript.js';
import * as V5 from '/home/sixer/ProofOfWork.Me/server/work-amo-v5.mjs';
import * as V8 from '/home/sixer/ProofOfWork.Me/server/work-amo-v8.mjs';
import * as V6 from '/home/sixer/ProofOfWork.Me/server/work-amo-v6.mjs';
import * as V7 from '/home/sixer/ProofOfWork.Me/server/work-amo-v7.mjs';
import * as Units from '/home/sixer/ProofOfWork.Me/server/work-units.mjs';
import {workPrecisionV2MarkerReady} from '/home/sixer/ProofOfWork.Me/server/work-precision-v2-marker.mjs';
import {scaleWorkPrecisionV2TokenState,workPrecisionV2RowsCommitment} from '/home/sixer/ProofOfWork.Me/scripts/migrate-work-precision-v2.mjs';
import {canonicalWorkWalletCapacitiesFromTransition} from '/home/sixer/ProofOfWork.Me/server/work-wallet-capacity.mjs';
const ROOT='/home/sixer/ProofOfWork.Me',sha=x=>createHash('sha256').update(x).digest('hex');
const pins=Object.fromEntries(['server/work-wallet-capacity.test.mjs','server/work-wallet-capacity.mjs','server/work-amo-v5.mjs','server/work-amo-v6.mjs','server/work-amo-v7.mjs','server/work-amo-v8.mjs','server/work-units.mjs','server/work-precision-v2-marker.mjs','scripts/migrate-work-precision-v2.mjs','server/sql/proof-indexer-v1.sql','server/proof-api.mjs','server/canonical-order.mjs','server/work-amo-v5-raw.mjs'].map(p=>[p,sha(readFileSync(`${ROOT}/${p}`))]));
const MAGIC=Buffer.from('5047434f50590aff0d0a00','hex');
const source=readFileSync(`${ROOT}/server/sql/proof-indexer-v1.sql`,'utf8');
const declaration=source.split('CREATE TABLE IF NOT EXISTS proof_indexer.work_amo_block_transitions (')[1].split('PRIMARY KEY')[0];
const oid={text:25,integer:23,numeric:1700,boolean:16,jsonb:3802,timestamptz:1184};
const columns=[...declaration.matchAll(/^  ([a-z_0-9]+) (text|integer|numeric|boolean|jsonb|timestamptz)\b/gmu)].map(m=>({name:m[1],typeOid:oid[m[2]],typeName:m[2]}));
assert.equal(columns.length,26);assert.equal(columns[24].name,'payload');
// Native pre-existing table retained its original physical attnum order. The
// source-reviewed ALTER ADD appends exactly this one column; fresh CREATE order
// remains separate and is still used by the synthetic source-format fixture.
const historicalLayoutWitnessSha256='69cf431cbede11d4867a85c8611ad932bc125d1c9da1560120ca6a20c4dfabac';
const historicalColumns=[{"name":"network","typeOid":25,"typeName":"text"},{"name":"block_height","typeOid":23,"typeName":"integer"},{"name":"block_hash","typeOid":25,"typeName":"text"},{"name":"previous_block_hash","typeOid":25,"typeName":"text"},{"name":"model","typeOid":25,"typeName":"text"},{"name":"state_commitment_model","typeOid":25,"typeName":"text"},{"name":"opening_network_value_q8","typeOid":1700,"typeName":"numeric"},{"name":"closing_network_value_q8","typeOid":1700,"typeName":"numeric"},{"name":"opening_state_sha256","typeOid":25,"typeName":"text"},{"name":"closing_state_sha256","typeOid":25,"typeName":"text"},{"name":"opening_state_payload_bytes","typeOid":23,"typeName":"integer"},{"name":"closing_state_payload_bytes","typeOid":23,"typeName":"integer"},{"name":"protocol_record_count","typeOid":23,"typeName":"integer"},{"name":"raw_protocol_candidate_count","typeOid":23,"typeName":"integer"},{"name":"transaction_count","typeOid":23,"typeName":"integer"},{"name":"event_count","typeOid":23,"typeName":"integer"},{"name":"event_set_model","typeOid":25,"typeName":"text"},{"name":"event_set_sha256","typeOid":25,"typeName":"text"},{"name":"event_set_payload_bytes","typeOid":23,"typeName":"integer"},{"name":"block_atomic","typeOid":16,"typeName":"boolean"},{"name":"fee_once","typeOid":16,"typeName":"boolean"},{"name":"invalid_zero","typeOid":16,"typeName":"boolean"},{"name":"complete","typeOid":16,"typeName":"boolean"},{"name":"payload","typeOid":3802,"typeName":"jsonb"},{"name":"created_at","typeOid":1184,"typeName":"timestamp with time zone"},{"name":"work_token_state_model","typeOid":25,"typeName":"text"}];
const migrationStatement='ALTER TABLE proof_indexer.work_amo_block_transitions\n  ADD COLUMN IF NOT EXISTS work_token_state_model text;';
assert.equal(source.split(migrationStatement).length,2,'Exact single source ALTER ADD evidence');
const sourceAlterAppendColumns=[...columns.filter(c=>c.name!=='work_token_state_model'),columns.find(c=>c.name==='work_token_state_model')].map(c=>({...c,typeName:c.typeName==='timestamptz'?'timestamp with time zone':c.typeName}));
assert.deepEqual(historicalColumns,sourceAlterAppendColumns,'Measured table layout must be exactly source-reviewed one-column ALTER append');
const historicalLayoutAdmission={model:'pow-audit30-measured-transition-alter-add-layout-v1',columnsSha256:sha(JSON.stringify(historicalColumns.map(c=>({name:c.name,typeName:c.typeName,typeOid:c.typeOid})))),nativeCaptureSha256:historicalLayoutWitnessSha256,schemaSqlSha256:pins['server/sql/proof-indexer-v1.sql'],migrationStatementSha256:sha(migrationStatement)};

function numeric(raw){
  assert.ok(raw.length>=8);const n=raw.readInt16BE(0),weight=raw.readInt16BE(2),sign=raw.readUInt16BE(4),scale=raw.readUInt16BE(6);
  assert.ok(n>=0&&sign===0&&scale===0&&raw.length===8+n*2&&weight>=-1);let value=0n;
  for(let i=0;i<n;i++){const digit=raw.readUInt16BE(8+i*2);assert.ok(digit<10000);value=value*10000n+BigInt(digit);}
  const zeros=weight+1-n;assert.ok(zeros>=0);return (value*10000n**BigInt(zeros)).toString();
}
function numericEncode(text){
  assert.match(text,/^(0|[1-9][0-9]*)$/u);const groups=[];for(let end=text.length;end>0;end-=4)groups.unshift(Number(text.slice(Math.max(0,end-4),end)));
  let weight=groups.length-1;while(groups.at(-1)===0)groups.pop();const b=Buffer.alloc(8+groups.length*2);b.writeInt16BE(groups.length);b.writeInt16BE(groups.length?weight:0,2);for(let i=0;i<groups.length;i++)b.writeUInt16BE(groups[i],8+i*2);assert.equal(numeric(b),text);return b;
}
function decode(raw,layout){
  assert.ok(raw.subarray(0,11).equals(MAGIC));assert.equal(raw.readUInt32BE(11),0);const ext=raw.readUInt32BE(15);assert.ok(ext<=1024);let pos=19+ext;const rows=[];
  while(true){assert.ok(pos+2<=raw.length);const count=raw.readInt16BE(pos);pos+=2;if(count===-1)break;assert.equal(count,layout.length);const row={};
    for(const col of layout){assert.ok(pos+4<=raw.length);const n=raw.readInt32BE(pos);pos+=4;if(n===-1){row[col.name]=null;continue;}assert.ok(n>=0&&pos+n<=raw.length);const value=raw.subarray(pos,pos+n);pos+=n;
      if(col.typeName==='text')row[col.name]=new TextDecoder('utf8',{fatal:true}).decode(value);
      else if(col.typeName==='integer'){assert.equal(n,4);row[col.name]=value.readInt32BE();}
      else if(col.typeName==='numeric')row[col.name]=numeric(value);
      else if(col.typeName==='boolean'){assert.equal(n,1);assert.ok(value[0]<=1);row[col.name]=Boolean(value[0]);}
      else if(col.typeName==='jsonb'){assert.equal(value[0],1);row[col.name]=JSON.parse(new TextDecoder('utf8',{fatal:true}).decode(value.subarray(1)));}
      else if(col.typeName==='timestamptz'||col.typeName==='timestamp with time zone'){assert.equal(n,8);row[col.name]=value.readBigInt64BE().toString();}
      else assert.fail('Unreviewed source type');
    }rows.push(row);
  }assert.equal(pos,raw.length);assert.ok(rows.length>0&&rows.length<=128);return rows;
}
const aliases={block_height:'blockHeight',block_hash:'blockHash',previous_block_hash:'previousBlockHash',state_commitment_model:'stateCommitmentModel',work_token_state_model:'workTokenStateModel',opening_network_value_q8:'openingNetworkValueQ8',closing_network_value_q8:'closingNetworkValueQ8',opening_state_sha256:'openingStateSha256',closing_state_sha256:'closingStateSha256',opening_state_payload_bytes:'openingStatePayloadBytes',closing_state_payload_bytes:'closingStatePayloadBytes',block_atomic:'blockAtomic',fee_once:'feeOnce',invalid_zero:'invalidZero'};
function validatePrecisionOpeningRebind(d,a,marker,precisionPins,scaled){
  assert.equal(precisionPins.declarationHeight,960600,'Scoped retained declaration height');
  assert.equal(precisionPins.activationHeight,960601,'Scoped retained activation height');
  assert.equal(d.blockHeight,precisionPins.declarationHeight);assert.equal(a.blockHeight,precisionPins.activationHeight);
  assert.equal(d.blockHash,precisionPins.declarationBlockHash);assert.equal(a.previousBlockHash,d.blockHash);
  assert.equal(d.model,V6.WORK_AMO_V6_BLOCK_SEQUENCER_MODEL,'Only source-reviewed V6 declaration model');
  assert.equal(a.model,V8.WORK_AMO_V8_BLOCK_SEQUENCER_MODEL);assert.equal(marker.activationOpening.declarationTransitionModel,d.model);
  assert.equal(marker.activationOpening.declarationClosingStateSha256,d.closingStateSha256);
  assert.equal(marker.activationOpening.declarationClosingStatePayloadBytes,d.closingStatePayloadBytes);
  const closing=d.payload.closingSufficientState,validation=V5.validateWorkAmoV5SufficientState(closing);
  assert.equal(validation.valid,true);assert.deepEqual(closing,validation.state,'Declaration state must already be canonical');
  assert.equal(closing.throughBlockHeight,d.blockHeight);assert.equal(closing.throughBlockHash,d.blockHash);
  assert.deepEqual(closing.tokenStateCommitment,scaled.legacyCommitment);
  const expected={...structuredClone(closing),tokenStateCommitment:structuredClone(scaled.subatomCommitment)};
  const rebound=V5.validateWorkAmoV5SufficientState(expected);assert.equal(rebound.valid,true);assert.deepEqual(rebound.state,expected);
  assert.deepEqual(a.payload.openingSufficientState,expected,'Full activation opening differs beyond the sole token commitment rebind');
  const commitment=V5.workAmoV5CanonicalStateCommitment(expected);
  assert.equal(a.openingStateSha256,commitment.sha256);assert.equal(a.openingStatePayloadBytes,commitment.payloadBytes);
  assert.deepEqual(a.payload.openingStateCommitment,commitment);
  assert.equal(a.openingNetworkValueQ8,d.closingNetworkValueQ8);assert.equal(expected.networkValueQ8,d.closingNetworkValueQ8);
  return {fullOpeningStateExact:true,soleTokenCommitmentRebind:true,sourceReviewedDeclarationModel:d.model,openingCommitment:commitment};
}
function historical(rows,marker,precisionPins){
  assert.equal(workPrecisionV2MarkerReady(marker,precisionPins,{network:'livenet'}),true,'Full marker contract');
  const models=new Map([[V5.WORK_AMO_V5_BLOCK_SEQUENCER_MODEL,V5.workAmoV5CanonicalTokenStateCommitment],[V6.WORK_AMO_V6_BLOCK_SEQUENCER_MODEL,V6.workAmoV6CanonicalTokenStateCommitment],[V7.WORK_AMO_V7_BLOCK_SEQUENCER_MODEL,V7.workAmoV7CanonicalTokenStateCommitment],[V8.WORK_AMO_V8_BLOCK_SEQUENCER_MODEL,V8.workAmoV8CanonicalTokenStateCommitment]]);
  const ts=rows.map(row=>Object.fromEntries(Object.entries(row).map(([k,v])=>[aliases[k]??k,v])));let prev=null;
  for(const t of ts){assert.equal(t.network,'livenet');assert.ok(models.has(t.model),'Reviewed historical model required');for(const k of ['complete','blockAtomic','feeOnce','invalidZero'])assert.equal(t[k],true);
    assert.equal(t.payload.network,t.network);assert.equal(t.payload.model,t.model);assert.equal(t.payload.blockHeight,t.blockHeight);assert.equal(t.payload.blockHash,t.blockHash);assert.equal(t.payload.previousBlockHash,t.previousBlockHash);for(const k of ['complete','blockAtomic','feeOnce','invalidZero'])assert.equal(t.payload[k],true);
    for(const phase of ['opening','closing']){const rawState=t.payload[phase+'SufficientState'],valid=V5.validateWorkAmoV5SufficientState(rawState);assert.equal(valid.valid,true);assert.deepEqual(rawState,valid.state);assert.equal(rawState.throughBlockHeight,t.blockHeight-(phase==='opening'?1:0));assert.equal(rawState.throughBlockHash,phase==='opening'?t.previousBlockHash:t.blockHash);const c=V5.workAmoV5CanonicalStateCommitment(t.payload[phase+'SufficientState']);assert.equal(c.sha256,t[phase+'StateSha256']);assert.equal(c.payloadBytes,t[phase+'StatePayloadBytes']);assert.equal(t.payload[phase+'SufficientState'].networkValueQ8,t[phase+'NetworkValueQ8']);}
    const token=models.get(t.model)(t.payload.closingTokenState);assert.deepEqual(token,t.payload.closingSufficientState.tokenStateCommitment);
    const isQ16=t.model===V7.WORK_AMO_V7_BLOCK_SEQUENCER_MODEL||t.model===V8.WORK_AMO_V8_BLOCK_SEQUENCER_MODEL,field=isQ16?'balanceSubatoms':'balanceAtoms',supply=isQ16?'confirmedSupplySubatoms':'confirmedSupplyAtoms';
    assert.equal(t.payload.closingTokenState.holders.reduce((n,x)=>n+BigInt(x[field]),0n).toString(),t.payload.closingTokenState[supply]);
    if(t.model===V8.WORK_AMO_V8_BLOCK_SEQUENCER_MODEL)assert.equal(V8.validateWorkAmoV8BoundaryTransitionPayload(t).valid,true);
    if(prev){assert.ok(t.blockHeight>prev.blockHeight);if(t.blockHeight===prev.blockHeight+1){assert.equal(t.previousBlockHash,prev.blockHash);assert.equal(t.openingNetworkValueQ8,prev.closingNetworkValueQ8);if(t.blockHeight!==precisionPins.activationHeight)assert.equal(t.openingStateSha256,prev.closingStateSha256);}}
    prev=t;
  }
  const declaration=ts.filter(t=>t.blockHeight===precisionPins.declarationHeight),activation=ts.filter(t=>t.blockHeight===precisionPins.activationHeight);assert.equal(declaration.length,1);assert.equal(activation.length,1);const d=declaration[0],a=activation[0];
  assert.equal(d.blockHash,precisionPins.declarationBlockHash);assert.equal(d.model,V6.WORK_AMO_V6_BLOCK_SEQUENCER_MODEL);assert.equal(a.previousBlockHash,d.blockHash);assert.equal(a.model,V8.WORK_AMO_V8_BLOCK_SEQUENCER_MODEL);
  assert.equal(marker.activationOpening.declarationClosingStateSha256,d.closingStateSha256);assert.equal(marker.activationOpening.declarationClosingStatePayloadBytes,d.closingStatePayloadBytes);
  const scaled=scaleWorkPrecisionV2TokenState(d.payload.closingTokenState);const rebind=validatePrecisionOpeningRebind(d,a,marker,precisionPins,scaled);assert.deepEqual(scaled.legacyCommitment,marker.activationOpening.legacyTokenStateCommitment);assert.deepEqual(scaled.subatomCommitment,marker.activationOpening.subatomTokenStateCommitment);assert.deepEqual(scaled.relicCutover,marker.relicCutover);
  assert.deepEqual(a.payload.precisionOpeningTokenStateCommitment,scaled.subatomCommitment);assert.deepEqual(a.payload.openingSufficientState.tokenStateCommitment,scaled.subatomCommitment);assert.equal(a.payload.precisionMigrationMarkerKey,Units.WORK_PRECISION_V2_MIGRATION_META_KEY);assert.equal(a.payload.activationHeight,precisionPins.activationHeight);
  const legacy=d.payload.closingTokenState.holders, converted=scaled.subatomState.holders;assert.equal(converted.length,legacy.length);
  const byAddress=new Map(converted.map(x=>[x.address,x]));for(const x of legacy)assert.equal(byAddress.get(x.address).balanceSubatoms,(BigInt(x.balanceAtoms)*100000000n).toString());
  const beforeBalances=legacy.map(x=>({address:x.address,confirmed_balance:x.balanceAtoms})),afterBalances=legacy.map(x=>({address:x.address,confirmed_balance:(BigInt(x.balanceAtoms)*100000000n).toString()})),beforeListings=d.payload.closingTokenState.listings.map(x=>({listing_id:x.listingId,amount:x.amountAtoms}));
  assert.deepEqual(marker.before.balances,workPrecisionV2RowsCommitment(beforeBalances,{keyField:'address',amountField:'confirmed_balance'}));assert.deepEqual(marker.after.balances,workPrecisionV2RowsCommitment(afterBalances,{keyField:'address',amountField:'confirmed_balance'}));assert.deepEqual(marker.before.listings,workPrecisionV2RowsCommitment(beforeListings,{keyField:'listing_id',amountField:'amount'}));assert.deepEqual(marker.after.listings,workPrecisionV2RowsCommitment([],{keyField:'listing_id',amountField:'amount'}));
  return {rows:ts.length,models:[...new Set(ts.map(t=>t.model))],markerReady:true,storedDeclarationEvidenceContractBound:true,declarationAndActivationExact:true,fullOpeningStateRebind:rebind,legacySubatomConversionBigIntExact:true,markerBeforeAfterAndRelicCommitmentsExact:true,qualification:'Exact sampled saved-snapshot rows and stored immutable marker/declaration evidence; no live Core revalidation, no skipped-interval or full raw-event replay claim.'};
}
function validateHistoricalInputFence(plan,layout,checkpoint,rows){
  assert.equal(plan.schema,'pow-audit30-transition-sampled-historical-oracle-plan-v3');
  assert.deepEqual(plan.layoutAdmission,historicalLayoutAdmission,'Exact measured historic layout admission and ALTER ADD source witness required');
  assert.deepEqual(plan.checkpoint,checkpoint);
  assert.deepEqual(Object.keys(checkpoint).sort(),['network','height','hash','sourceFenceSha256','sampleRowKeysSha256'].sort());
  assert.equal(checkpoint.network,'livenet');assert.ok(Number.isSafeInteger(checkpoint.height)&&checkpoint.height>=960601);
  for(const key of ['hash','sourceFenceSha256','sampleRowKeysSha256'])assert.match(checkpoint[key],/^[0-9a-f]{64}$/u);
  assert.equal(plan.sourceFenceSha256,checkpoint.sourceFenceSha256);
  const saved=plan.sourceSnapshot;assert.deepEqual(Object.keys(saved).sort(),['height','hash','transitionHeight','transitionHash'].sort());
  assert.equal(saved.height,checkpoint.height);assert.equal(saved.hash,checkpoint.hash);
  assert.ok(Number.isSafeInteger(saved.transitionHeight)&&saved.transitionHeight>=960601&&saved.transitionHeight<=saved.height);assert.match(saved.transitionHash,/^[0-9a-f]{64}$/u);
  assert.ok(Array.isArray(plan.sampleRows)&&plan.sampleRows.length>=3&&plan.sampleRows.length<=16);
  assert.equal(checkpoint.sampleRowKeysSha256,sha(JSON.stringify(plan.sampleRows)),'Exact capture ordered-key encoding');
  assert.deepEqual(plan.sampleRows.at(-1),{height:saved.transitionHeight,hash:saved.transitionHash});
  assert.deepEqual(rows.map(x=>({height:x.block_height,hash:x.block_hash})),plan.sampleRows);
  assert.equal(rows[0].block_height,960600);assert.equal(rows[1].block_height,960601);
  assert.equal(layout.length,historicalColumns.length);
  for(let i=0;i<layout.length;i++){assert.deepEqual(Object.keys(layout[i]).sort(),['name','typeOid','typeName'].sort());assert.deepEqual(layout[i],historicalColumns[i],'Only exact measured historical physical column order/types are admitted');}
  return {sourceSnapshot:saved,sourceFenceSha256:checkpoint.sourceFenceSha256,completeColumnLayout:true,layoutAdmission:historicalLayoutAdmission};
}
function semantic(rows){
  let prior=null;return rows.map(row=>{
    const t=Object.fromEntries(Object.entries(row).map(([k,v])=>[aliases[k]??k,v]));
    assert.equal(t.network,'livenet');const v=V8.validateWorkAmoV8BoundaryTransitionPayload(t);assert.equal(v.valid,true,JSON.stringify(v));
    const opening=V5.workAmoV5CanonicalStateCommitment(t.payload.openingSufficientState),closing=V5.workAmoV5CanonicalStateCommitment(t.payload.closingSufficientState);
    assert.equal(opening.sha256,t.openingStateSha256);assert.equal(closing.sha256,t.closingStateSha256);
    assert.equal(opening.payloadBytes,t.openingStatePayloadBytes);assert.equal(closing.payloadBytes,t.closingStatePayloadBytes);
    const token=V8.workAmoV8CanonicalTokenStateCommitment(t.payload.closingTokenState);assert.deepEqual(token,t.payload.closingSufficientState.tokenStateCommitment);
    const holders=t.payload.closingTokenState.holders, supply=holders.reduce((n,h)=>n+BigInt(h.balanceSubatoms),0n);assert.equal(supply.toString(),t.payload.closingTokenState.confirmedSupplySubatoms);
    assert.ok(BigInt(t.closingNetworkValueQ8)>=BigInt(t.openingNetworkValueQ8));
    const capacities=canonicalWorkWalletCapacitiesFromTransition(t,{network:t.network,blockHeight:t.blockHeight,blockHash:t.blockHash,addresses:holders.map(h=>h.address)});assert.ok(capacities);
    for(const c of capacities){const reserved=c.reservations.reduce((n,l)=>n+BigInt(l.amountSubatoms),0n);assert.equal(reserved.toString(),c.reservedBalanceSubatoms);assert.equal((BigInt(c.confirmedBalanceSubatoms)-reserved).toString(),c.transferableBalanceSubatoms);}
    if(prior){assert.equal(t.blockHeight,prior.blockHeight+1);assert.equal(t.previousBlockHash,prior.blockHash);assert.equal(t.openingStateSha256,prior.closingStateSha256);assert.equal(t.openingNetworkValueQ8,prior.closingNetworkValueQ8);}
    prior=t;return {height:t.blockHeight,hash:t.blockHash,opening,closing,token,payload:V5.workAmoV5CanonicalPayloadCommitment(t.payload),q8:t.closingNetworkValueQ8,q16Supply:supply.toString(),capacities};
  });
}
function fixture(){
  const code=readFileSync(`${ROOT}/server/work-wallet-capacity.test.mjs`,'utf8'),ast=ts.createSourceFile('test',code,ts.ScriptTarget.Latest,true);const found=ast.statements.filter(n=>ts.isFunctionDeclaration(n)&&n.name?.text==='fixture');assert.equal(found.length,1);
  const seller='bc1p0uxp0axptr8rg9dndgtlwxn00j4hq8m88kg80tqd0t6045putwhq5ca7ed',base58='18xvbj6mpPpYYjWibcqsXdV7SCwBQNrqMW';
  const env={...V5,...V8,...Units,assert,structuredClone,seller,base58,scope:{network:'livenet',blockHeight:1200001,blockHash:'44'.repeat(32)}};
  return Function(...Object.keys(env),`${found[0].getText(ast)}\nreturn fixture();`)(...Object.values(env));
}
function encode(rows,layout=columns){const pieces=[MAGIC,Buffer.alloc(8)];for(const row of rows){const count=Buffer.alloc(2);count.writeInt16BE(layout.length);pieces.push(count);for(const col of layout){let value=row[col.name],b;
  if(value===null)b=null;else if(col.typeName==='text')b=Buffer.from(value);else if(col.typeName==='numeric')b=numericEncode(value);else if(col.typeName==='integer'){b=Buffer.alloc(4);b.writeInt32BE(value);}else if(col.typeName==='boolean')b=Buffer.from([+value]);else if(col.typeName==='jsonb')b=Buffer.concat([Buffer.from([1]),Buffer.from(JSON.stringify(value))]);else if((col.typeName==='timestamptz'||col.typeName==='timestamp with time zone')){b=Buffer.alloc(8);b.writeBigInt64BE(BigInt(value));}const len=Buffer.alloc(4);len.writeInt32BE(b===null?-1:b.length);pieces.push(len);if(b)pieces.push(b);
  }}pieces.push(Buffer.from('ffff','hex'));return Buffer.concat(pieces);}
function main(){
const [mode,prefix,other]=process.argv.slice(2);assert.match(prefix,/^\/tmp\/pow-audit30-[A-Za-z0-9.-]+$/u);
if(mode==='prepare'){
  const base=fixture(),token=structuredClone(base.payload.closingTokenState);token.holders[0].balanceSubatoms='200000000000000000012345';token.confirmedSupplySubatoms=(BigInt(token.holders[0].balanceSubatoms)+42n).toString();
  token.listings=Array.from({length:64},(_,i)=>({...structuredClone(token.listings[0]),listingId:sha(`synthetic-prototype-listing-${i}`)}));
  const tc=V8.workAmoV8CanonicalTokenStateCommitment(token);let previous=null;const rows=[];
  for(let i=0;i<16;i++){
    const t=structuredClone(base),height=1200001+i,hash=sha(`synthetic-prototype-block-${i}`),previousHash=previous?.blockHash??'33'.repeat(32);
    const opening=previous?structuredClone(previous.payload.closingSufficientState):{...structuredClone(t.payload.openingSufficientState),tokenStateCommitment:tc,networkValueQ8:'9007199254740993',creditFixedQ8:'9007199254740993'};
    const next=(BigInt(opening.networkValueQ8)+73n).toString();const closing={...structuredClone(opening),throughBlockHeight:height,throughBlockHash:hash,networkValueQ8:next,creditFixedQ8:next};
    const oc=V5.workAmoV5CanonicalStateCommitment(opening),cc=V5.workAmoV5CanonicalStateCommitment(closing);
    Object.assign(t,{blockHeight:height,blockHash:hash,previousBlockHash:previousHash,openingNetworkValueQ8:opening.networkValueQ8,closingNetworkValueQ8:closing.networkValueQ8,openingStateSha256:oc.sha256,closingStateSha256:cc.sha256,openingStatePayloadBytes:oc.payloadBytes,closingStatePayloadBytes:cc.payloadBytes});
    Object.assign(t.payload,{blockHeight:height,blockHash:hash,previousBlockHash:previousHash,openingSufficientState:opening,closingSufficientState:closing,openingStateCommitment:oc,closingStateCommitment:cc,closingTokenState:token});
    const events=V5.workAmoV5EventSetCommitment([]);const row={};for(const c of columns){const k=aliases[c.name]??c.name;row[c.name]=t[k];}
    Object.assign(row,{protocol_record_count:0,raw_protocol_candidate_count:0,transaction_count:0,event_count:0,event_set_model:events.model,event_set_sha256:events.sha256,event_set_payload_bytes:events.payloadBytes,created_at:(810000000000000n+BigInt(i)).toString()});rows.push(row);previous=t;
  }
  const data=encode(rows),decoded=decode(data,columns),proof=semantic(decoded),keys=rows.map(r=>[r.network,r.block_height,r.block_hash]);
  const pin={network:'livenet',height:rows.at(-1).block_height,hash:rows.at(-1).block_hash,sourceFenceSha256:sha(JSON.stringify({fixtureOnly:true,pins})),sampleRowKeysSha256:sha(JSON.stringify(keys))};
  for(const [suffix,body] of [['.copy',data],['.columns.json',JSON.stringify(columns)],['.checkpoint.json',JSON.stringify(pin)],['.expected.json',JSON.stringify({fixtureOnly:true,pins,proof})]])writeFileSync(prefix+suffix,body,{flag:'wx',mode:0o600});
  console.log(JSON.stringify({status:'synthetic-source-format-prepared',sourceBytes:data.length,rows:rows.length,columns:columns.length,payloadIndex:24,sourceSha256:sha(data),qualification:'Actual source fixture/model/commitment/capacity functions; synthetic boundaries and allocation fixture, no PoW/raw-block history or production row claim.'}));
}else if(mode==='verify'){
  const layout=JSON.parse(readFileSync(prefix+'.columns.json')),a=readFileSync(prefix+'.copy'),b=readFileSync(other);assert.ok(a.equals(b));
  const original=decode(a,layout),restored=decode(b,layout);assert.deepEqual(original,restored);const one=semantic(original),two=semantic(restored);assert.deepEqual(one,two);
  const expected=JSON.parse(readFileSync(prefix+'.expected.json'));assert.deepEqual(one,expected.proof);assert.deepEqual(pins,expected.pins);
  console.log(JSON.stringify({status:'independent-binary-and-semantic-equivalence-pass',rows:original.length,rawSourceSha256:sha(a),rawReconstructedSha256:sha(b),numericQ8AboveSafeNumber:true,q16Exact:true,allColumnNullAndTimestampBytesExact:true,canonicalPayloadStateTokenCommitmentsExact:true,holderSupplyAndReservationBigIntExact:true,orderedBoundaryContinuationExact:true,sourcePins:pins,qualification:'Synthetic source-format sample, not full raw-event replay, real saved DB sample, native PG allocation or production migration acceptance.'}));
}else if(mode==='historical'){
  // Root creates/hash-binds this plan only after separate private-clone capture.
  const plan=JSON.parse(readFileSync(prefix+'.historical-plan.json'));assert.deepEqual(plan.sourcePins,pins);const inputs=['.copy','.columns.json','.checkpoint.json','.marker.copy','.marker-value.json'];
  for(const suffix of inputs)assert.equal(sha(readFileSync(prefix+suffix)),plan.inputSha256[suffix]);const a=readFileSync(prefix+'.copy'),b=readFileSync(other);assert.ok(a.equals(b));const layout=JSON.parse(readFileSync(prefix+'.columns.json'));const one=decode(a,layout),two=decode(b,layout);assert.deepEqual(one,two);
  const sourceFence=validateHistoricalInputFence(plan,layout,JSON.parse(readFileSync(prefix+'.checkpoint.json')),one);const markerCopy=readFileSync(prefix+'.marker.copy'),markerRows=decode(markerCopy,[{name:'key',typeName:'text'},{name:'value',typeName:'jsonb'},{name:'updated_at',typeName:'timestamptz'}]);assert.equal(markerRows.length,1);assert.equal(markerRows[0].key,Units.WORK_PRECISION_V2_MIGRATION_META_KEY);const marker=JSON.parse(readFileSync(prefix+'.marker-value.json'));assert.deepEqual(marker,markerRows[0].value);
  let pos=19+markerCopy.readUInt32BE(15)+2;const keySize=markerCopy.readInt32BE(pos);pos+=4+keySize;const valueSize=markerCopy.readInt32BE(pos);pos+=4;assert.ok(valueSize>0);assert.equal(sha(markerCopy.subarray(pos,pos+valueSize)),plan.markerJsonbSendSha256);
  const observed=historical(one,marker,plan.precisionPins);assert.deepEqual(observed,historical(two,marker,plan.precisionPins));console.log(JSON.stringify({status:'sampled-historical-byte-and-marker-oracle-pass',sourceSha256:sha(a),reconstructedSha256:sha(b),savedSnapshotFence:sourceFence,...observed}));
}else throw Error('prepare, verify or historical required');

}
export {sha,pins,columns,historicalColumns,historicalLayoutAdmission,migrationStatement,decode,encode,fixture,historical,validatePrecisionOpeningRebind,validateHistoricalInputFence};
if(process.argv[1]===fileURLToPath(import.meta.url))main();
