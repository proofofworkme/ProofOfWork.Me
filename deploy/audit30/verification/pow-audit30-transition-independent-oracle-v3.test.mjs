import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import * as O from './pow-audit30-transition-independent-oracle-v3.mjs';
import * as V5 from '/home/sixer/ProofOfWork.Me/server/work-amo-v5.mjs';
import * as V6 from '/home/sixer/ProofOfWork.Me/server/work-amo-v6.mjs';
import * as V8 from '/home/sixer/ProofOfWork.Me/server/work-amo-v8.mjs';
import {scaleWorkPrecisionV2TokenState,workPrecisionV2RowsCommitment} from '/home/sixer/ProofOfWork.Me/scripts/migrate-work-precision-v2.mjs';
const original=JSON.parse(fs.readFileSync('/home/sixer/ProofOfWork.Me/scripts/fixtures/incb-replay-cutover-963781.json')).context;
const aliases={block_height:'blockHeight',block_hash:'blockHash',previous_block_hash:'previousBlockHash',state_commitment_model:'stateCommitmentModel',work_token_state_model:'workTokenStateModel',opening_network_value_q8:'openingNetworkValueQ8',closing_network_value_q8:'closingNetworkValueQ8',opening_state_sha256:'openingStateSha256',closing_state_sha256:'closingStateSha256',opening_state_payload_bytes:'openingStatePayloadBytes',closing_state_payload_bytes:'closingStatePayloadBytes',block_atomic:'blockAtomic',fee_once:'feeOnce',invalid_zero:'invalidZero'};
function row(t){const r=Object.fromEntries(O.columns.map(c=>[c.name,t[aliases[c.name]??c.name]]));Object.assign(r,{protocol_record_count:0,raw_protocol_candidate_count:0,transaction_count:0,event_count:0,event_set_model:V5.WORK_AMO_V5_EVENT_SET_COMMITMENT_MODEL,event_set_sha256:'1'.repeat(64),event_set_payload_bytes:2,created_at:'810000000000001'});return r;}
function recommit(t,phase){const c=V5.workAmoV5CanonicalStateCommitment(t.payload[phase+'SufficientState']);t[phase+'StateSha256']=c.sha256;t[phase+'StatePayloadBytes']=c.payloadBytes;t[phase+'NetworkValueQ8']=t.payload[phase+'SufficientState'].networkValueQ8;t.payload[phase+'StateCommitment']=c;}
function fixture(){
 const pins=structuredClone(original.pins),marker=structuredClone(original.marker),base=O.fixture();
 const legacy=V6.workAmoV6CanonicalTokenStatePreimage({confirmedSupplyAtoms:'2100000000000000',holders:[{address:'z-holder',balanceAtoms:'1'},{address:'a-holder',balanceAtoms:'2099999999999999'}],listings:[]});
 const scaled=scaleWorkPrecisionV2TokenState(legacy),state={...structuredClone(base.payload.closingSufficientState),tokenStateCommitment:scaled.legacyCommitment,throughBlockHeight:960600,throughBlockHash:pins.declarationBlockHash,networkValueQ8:'9007199254740993',creditFixedQ8:'9007199254740993'};
 const d={...structuredClone(base),blockHeight:960600,blockHash:pins.declarationBlockHash,previousBlockHash:'3'.repeat(64),model:V6.WORK_AMO_V6_BLOCK_SEQUENCER_MODEL,workTokenStateModel:V5.WORK_AMO_V5_TOKEN_STATE_PREIMAGE_MODEL};
 Object.assign(d.payload,{model:d.model,blockHeight:d.blockHeight,blockHash:d.blockHash,previousBlockHash:d.previousBlockHash,openingSufficientState:{...structuredClone(state),throughBlockHeight:960599,throughBlockHash:d.previousBlockHash},closingSufficientState:state,closingTokenState:legacy});recommit(d,'opening');recommit(d,'closing');
 const a={...structuredClone(base),blockHeight:960601,blockHash:'4'.repeat(64),previousBlockHash:d.blockHash};
 const opening={...structuredClone(state),tokenStateCommitment:scaled.subatomCommitment};Object.assign(a.payload,{blockHeight:a.blockHeight,blockHash:a.blockHash,previousBlockHash:a.previousBlockHash,openingSufficientState:opening,closingSufficientState:{...structuredClone(opening),throughBlockHeight:a.blockHeight,throughBlockHash:a.blockHash},closingTokenState:scaled.subatomState,precisionOpeningTokenStateCommitment:scaled.subatomCommitment,precisionMigrationMarkerKey:'workPrecisionV2Migration:livenet',activationHeight:960601});recommit(a,'opening');recommit(a,'closing');
 marker.activationOpening={declarationClosingStatePayloadBytes:d.closingStatePayloadBytes,declarationClosingStateSha256:d.closingStateSha256,declarationTransitionModel:d.model,legacyTokenStateCommitment:scaled.legacyCommitment,subatomTokenStateCommitment:scaled.subatomCommitment};marker.relicCutover=structuredClone(scaled.relicCutover);
 const balances=legacy.holders.map(h=>({address:h.address,confirmed_balance:h.balanceAtoms}));marker.before.balances=workPrecisionV2RowsCommitment(balances,{keyField:'address',amountField:'confirmed_balance'});marker.after.balances=workPrecisionV2RowsCommitment(balances.map(x=>({...x,confirmed_balance:(BigInt(x.confirmed_balance)*100000000n).toString()})),{keyField:'address',amountField:'confirmed_balance'});marker.before.listings=workPrecisionV2RowsCommitment([],{keyField:'listing_id',amountField:'amount'});marker.after.listings=structuredClone(marker.before.listings);
 return {d,a,marker:structuredClone(marker),pins,scaled};
}
function run(f){return O.historical([row(f.d),row(f.a)],f.marker,f.pins);}
test('complete sampled source-format V6-to-V8 positive; full opening differs only token commitment',()=>{const f=fixture(),r=run(f);assert.equal(r.fullOpeningStateRebind.soleTokenCommitmentRebind,true);assert.equal(r.fullOpeningStateRebind.fullOpeningStateExact,true);assert.equal(f.scaled.subatomState.confirmedSupplySubatoms,'210000000000000000000000');assert.equal(f.a.openingNetworkValueQ8,'9007199254740993');assert.notEqual(f.a.openingStateSha256,f.d.closingStateSha256);});
for(const [name,change] of [
 ['generic commitment',f=>{f.a.payload.openingSufficientState.genericTokenStateCommitment.sha256='9'.repeat(64);recommit(f.a,'opening')}],
 ['ID commitment',f=>{f.a.payload.openingSufficientState.idStateCommitment.sha256='9'.repeat(64);recommit(f.a,'opening')}],
 ['base and compensating credit, unchanged network value',f=>{f.a.payload.openingSufficientState.baseState.mailFlowSats='1';f.a.payload.openingSufficientState.creditFixedQ8=(9007199254740993n-5n*100000000n).toString();recommit(f.a,'opening')}],
 ['unknown state field',f=>{f.a.payload.openingSufficientState.unreviewed='mutation';recommit(f.a,'opening')}],
 ['token commitment',f=>{f.a.payload.openingSufficientState.tokenStateCommitment.sha256='9'.repeat(64);recommit(f.a,'opening')}],
 ['through hash',f=>{f.a.payload.openingSufficientState.throughBlockHash='9'.repeat(64);recommit(f.a,'opening')}],
 ['through height',f=>{f.a.payload.openingSufficientState.throughBlockHeight=960599;recommit(f.a,'opening')}],
 ['legacy closing marker model',f=>{f.marker.activationOpening.declarationTransitionModel='canonical-work-amo-full-position-block-sequencer-v3'}],
 ['legacy closing marker bytes',f=>{f.marker.activationOpening.declarationClosingStatePayloadBytes++}],
 ['legacy closing marker hash',f=>{f.marker.activationOpening.declarationClosingStateSha256='9'.repeat(64)}],
 ['legacy declared model',f=>{f.d.model='canonical-work-amo-full-position-block-sequencer-v3'}],
 ['activation model',f=>{f.a.model='canonical-work-amo-full-position-block-sequencer-v3'}],
 ['activation height',f=>{f.a.blockHeight=960602}],
 ['declared marker conversion factor',f=>{f.marker.conversionFactor='100000001'}],
 ['relic commitment',f=>{f.marker.relicCutover.sha256='9'.repeat(64)}],
 ['marker before balances',f=>{f.marker.before.balances.sha256='9'.repeat(64)}],
 ['marker after balances',f=>{f.marker.after.balances.sha256='9'.repeat(64)}],
 ['precision payload key',f=>{f.a.payload.precisionMigrationMarkerKey='different'}],
 ['precision payload height',f=>{f.a.payload.activationHeight=960602}],
 ['declaration anchor',f=>{f.d.blockHash='9'.repeat(64)}],
])test('rehashed or direct historical mutation refused: '+name,()=>{const f=fixture();change(f);assert.throws(()=>run(f));});
test('independent full rebind helper specifically rejects compensating base drift after valid canonical rehash',()=>{const f=fixture();f.a.payload.openingSufficientState.baseState.mailFlowSats='1';f.a.payload.openingSufficientState.creditFixedQ8=(9007199254740993n-5n*100000000n).toString();recommit(f.a,'opening');assert.equal(V5.validateWorkAmoV5SufficientState(f.a.payload.openingSufficientState).valid,true);assert.throws(()=>O.validatePrecisionOpeningRebind(f.d,f.a,f.marker,f.pins,f.scaled),/sole token commitment rebind/);});
test('full preimage byte/hash scalar changes cannot pass marker closing binding',()=>{const f=fixture();f.d.closingStatePayloadBytes++;assert.throws(()=>run(f));});
test('nonactivation adjacent opening receives no exception',()=>{const f=fixture(),t=structuredClone(f.a);Object.assign(t,{blockHeight:960602,blockHash:'5'.repeat(64),previousBlockHash:f.a.blockHash});Object.assign(t.payload,{blockHeight:t.blockHeight,blockHash:t.blockHash,previousBlockHash:t.previousBlockHash,openingSufficientState:structuredClone(f.a.payload.closingSufficientState),closingSufficientState:{...structuredClone(f.a.payload.closingSufficientState),throughBlockHeight:t.blockHeight,throughBlockHash:t.blockHash}});recommit(t,'opening');recommit(t,'closing');assert.equal(O.historical([row(f.d),row(f.a),row(t)],f.marker,f.pins).rows,3);t.payload.openingSufficientState.genericTokenStateCommitment.sha256='9'.repeat(64);recommit(t,'opening');assert.throws(()=>O.historical([row(f.d),row(f.a),row(t)],f.marker,f.pins));});
test('binary COPY independent26-column decoder exactly preserves Q8/Q16 strings and row ordering',()=>{const f=fixture(),rows=[row(f.d),row(f.a)],raw=O.encode(rows),decoded=O.decode(raw,O.columns);assert.deepEqual(decoded,rows);assert.equal(O.historical(decoded,f.marker,f.pins).rows,2);});
test('alternate precision heights cannot reuse the sole scoped activation waiver',()=>{const f=fixture();f.pins.declarationHeight=960601;f.pins.activationHeight=960602;assert.throws(()=>O.validatePrecisionOpeningRebind(f.d,f.a,f.marker,f.pins,f.scaled));});
test('source-body review: actual cutover spreads full opening and assigns only tokenStateCommitment at exact activation',async()=>{
 const {default:ts}=await import('/home/sixer/ProofOfWork.Me/node_modules/typescript/lib/typescript.js');
 const code=fs.readFileSync('/home/sixer/ProofOfWork.Me/server/proof-api.mjs','utf8'),ast=ts.createSourceFile('proof-api.mjs',code,ts.ScriptTarget.Latest,true);
 const fn=ast.statements.find(n=>ts.isFunctionDeclaration(n)&&n.name?.text==='completeWorkAmoV5BlockProjection');assert.ok(fn);
 const gates=[];function visit(n){if(ts.isIfStatement(n)&&n.expression.getText(ast).replace(/\s+/g,'')==='v7ReplayInputs.workAmoV8&&requiredBlockHeight===v7ActivationHeight')gates.push(n);ts.forEachChild(n,visit)}visit(fn);assert.equal(gates.length,1);
 const bindings=[];function variable(n){if(ts.isVariableDeclaration(n)&&n.name.getText(ast)==='q16OpeningValidation')bindings.push(n);ts.forEachChild(n,variable)}variable(gates[0]);assert.equal(bindings.length,1);
 const call=bindings[0].initializer;assert.equal(call.expression.getText(ast),'validateWorkAmoV5SufficientState');assert.equal(call.arguments.length,1);
 const obj=call.arguments[0];assert.equal(obj.properties.length,2);assert.equal(obj.properties[0].expression.getText(ast),'opening.state');assert.equal(obj.properties[1].name.getText(ast),'tokenStateCommitment');assert.equal(obj.properties[1].initializer.getText(ast),'q16TokenStateCommitment');
 const assigns=[];function assignment(n){if(ts.isBinaryExpression(n)&&n.operatorToken.kind===ts.SyntaxKind.EqualsToken&&n.left.getText(ast)==='opening')assigns.push(n);ts.forEachChild(n,assignment)}assignment(gates[0]);assert.equal(assigns.length,1);
 const after=assigns[0].right;assert.equal(after.properties.length,3);assert.equal(after.properties[0].expression.getText(ast),'opening');assert.deepEqual(after.properties.slice(1).map(p=>[p.name.getText(ast),p.initializer.getText(ast)]),[['state','q16OpeningValidation.state'],['workState','q16OpeningWorkState']]);
 const scale=ast.statements.find(n=>ts.isFunctionDeclaration(n)&&n.name?.text==='workAmoV8OpeningStateFromLegacy');assert.ok(scale);const body=scale.getText(ast);assert.match(body,/workAmoV6CanonicalTokenStatePreimage\(legacyState\)/);assert.match(body,/BigInt\(preimage\.confirmedSupplyAtoms\)\s*\*\s*WORK_SUBATOM_CONVERSION_FACTOR/);assert.match(body,/BigInt\(holder\.balanceAtoms\)\s*\*\s*WORK_SUBATOM_CONVERSION_FACTOR/);assert.match(body,/listings:\s*\[\]/);
 assert.equal(O.pins['server/proof-api.mjs'],O.sha(code));
});
function fenceFixture(){const sampleRows=[{hash:'a'.repeat(64),height:960600},{hash:'b'.repeat(64),height:960601},{hash:'c'.repeat(64),height:969648}],checkpoint={network:'livenet',height:969650,hash:'d'.repeat(64),sourceFenceSha256:'e'.repeat(64),sampleRowKeysSha256:O.sha(JSON.stringify(sampleRows))},sourceSnapshot={height:checkpoint.height,hash:checkpoint.hash,transitionHeight:969648,transitionHash:'c'.repeat(64)},rows=sampleRows.map(r=>({block_height:r.height,block_hash:r.hash})),layout=structuredClone(O.historicalColumns),plan={schema:'pow-audit30-transition-sampled-historical-oracle-plan-v3',layoutAdmission:structuredClone(O.historicalLayoutAdmission),checkpoint:structuredClone(checkpoint),sourceSnapshot,sourceFenceSha256:checkpoint.sourceFenceSha256,sampleRows};return {plan,layout,checkpoint,rows};}
test('root-reviewed captured checkpoint/layout and exact key commitment accepted',()=>{const f=fenceFixture();assert.equal(O.validateHistoricalInputFence(f.plan,f.layout,f.checkpoint,f.rows).completeColumnLayout,true)});
for(const [name,change] of [
 ['checkpoint tip',f=>{f.plan.checkpoint.height++}],
 ['source fence',f=>{f.plan.sourceFenceSha256='f'.repeat(64)}],
 ['transition hash',f=>{f.plan.sourceSnapshot.transitionHash='f'.repeat(64)}],
 ['transition exceeds saved tip',f=>{f.plan.sourceSnapshot.transitionHeight=969651}],
 ['sample row order',f=>{f.rows.reverse()}],
 ['sample declaration height',f=>{f.rows[0].block_height=960599}],
 ['column OID',f=>{f.layout[0].typeOid=3802}],
 ['column name/order',f=>{[f.layout[0],f.layout[1]]=[f.layout[1],f.layout[0]]}],
 ['column type',f=>{f.layout[2].typeName='bigint'}],
 ['unknown schema',f=>{f.plan.schema='unknown'}],
 ['missing latest full sample',f=>{f.plan.sampleRows.pop();f.rows.pop();f.checkpoint.sampleRowKeysSha256=O.sha(JSON.stringify(f.plan.sampleRows));f.plan.checkpoint=structuredClone(f.checkpoint)}],
])test('saved input fence refuses '+name,()=>{const f=fenceFixture();change(f);assert.throws(()=>O.validateHistoricalInputFence(f.plan,f.layout,f.checkpoint,f.rows))});

test('exact native historical ALTER ADD physical-order binary26-column roundtrip and full arithmetic',()=>{const f=fixture(),rows=[row(f.d),row(f.a)],raw=O.encode(rows,O.historicalColumns),decoded=O.decode(raw,O.historicalColumns);assert.deepEqual(decoded,rows);assert.equal(O.historical(decoded,f.marker,f.pins).fullOpeningStateRebind.fullOpeningStateExact,true);assert.equal(O.historicalColumns[23].name,'payload');assert.equal(O.historicalColumns[24].name,'created_at');assert.equal(O.historicalColumns[25].name,'work_token_state_model');});
test('native measured capture source proof and exact ALTER ADD statement hash bound',()=>{const raw=fs.readFileSync('/tmp/pow-audit30-inspector-id-capture-meta-v1.json');assert.equal(O.sha(raw),O.historicalLayoutAdmission.nativeCaptureSha256);const measured=JSON.parse(JSON.parse(raw)['phase5-prototype-plan.json'].text).columns.map(c=>({...c,typeOid:Number(c.typeOid)}));assert.deepEqual(O.historicalColumns,measured);assert.equal(O.sha(JSON.stringify(measured.map(c=>({name:c.name,typeName:c.typeName,typeOid:c.typeOid})))),O.historicalLayoutAdmission.columnsSha256);const sql=fs.readFileSync('/home/sixer/ProofOfWork.Me/server/sql/proof-indexer-v1.sql','utf8');assert.equal(O.sha(sql),O.historicalLayoutAdmission.schemaSqlSha256);assert.equal(sql.split(O.migrationStatement).length,2);assert.equal(O.sha(O.migrationStatement),O.historicalLayoutAdmission.migrationStatementSha256);});
for(const [name,change] of [
 ['fresh CREATE order',f=>{f.layout=structuredClone(O.columns)}],
 ['append another column',f=>{f.layout.push({name:'unreviewed',typeOid:25,typeName:'text'})}],
 ['move only work-token column',f=>{[f.layout[24],f.layout[25]]=[f.layout[25],f.layout[24]]}],
 ['string OIDs',f=>{f.layout.forEach(c=>c.typeOid=String(c.typeOid))}],
 ['timestamp alias',f=>{f.layout[24].typeName='timestamptz'}],
 ['missing explicit admission',f=>{delete f.plan.layoutAdmission}],
 ['forged native capture hash',f=>{f.plan.layoutAdmission.nativeCaptureSha256='0'.repeat(64)}],
 ['forged migration statement',f=>{f.plan.layoutAdmission.migrationStatementSha256='0'.repeat(64)}],
 ['forged schema SQL',f=>{f.plan.layoutAdmission.schemaSqlSha256='0'.repeat(64)}],
 ['rehashed arbitrary layout',f=>{f.layout.reverse();f.plan.layoutAdmission.columnsSha256=O.sha(JSON.stringify(f.layout))}],
])test('measured historical layout refuses '+name,()=>{const f=fenceFixture();change(f);assert.throws(()=>O.validateHistoricalInputFence(f.plan,f.layout,f.checkpoint,f.rows));});
