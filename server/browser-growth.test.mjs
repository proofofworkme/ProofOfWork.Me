import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import * as amo from './work-amo-v5.mjs';
import { integerBigInt } from './bond-units.mjs';
import { q8ToNumber } from './work-units.mjs';

// Exercise the real API classification, contribution mapping, and strict
// reconciliation without starting the API or accessing a wallet/database.
const source = readFileSync(new URL('./proof-api.mjs', import.meta.url), 'utf8');
function functionSource(name) {
  const match = new RegExp(`^(?:export )?(?:async )?function ${name}\\(`, 'm').exec(source);
  assert.ok(match, `Missing actual API function ${name}`);
  const tail = source.slice(match.index);
  const next = /\n(?:export )?(?:async )?function |\n(?:export )?const |\n(?:export )?class /m.exec(tail.slice(1));
  return tail.slice(0, next ? next.index + 1 : tail.length).replace(/^export /, '').trim();
}

const infinity={kind:'infinity-bond',memo:'powb',tokenId:'fixture-powb'};
const inception={kind:'inception-bond',memo:'incb',tokenId:'fixture-incb'};
const constantDeps={...Object.fromEntries(Object.entries(amo).filter(([name])=>name.startsWith('WORK_AMO_V5_LEGACY_BOOTSTRAP_CARRY_'))),
 WORK_AMO_V5_BASE_STATE_FIELDS:amo.WORK_AMO_V5_BASE_STATE_FIELDS,
 WORK_AMO_V5_ACTIVATION_HEIGHT:amo.WORK_AMO_V5_ACTIVATION_HEIGHT,
 BOND_TOKEN_CONFIGS:[infinity,inception],INFINITY_BOND_CONFIG:infinity,INCEPTION_BOND_CONFIG:inception,
 BOND_TOKEN_IDS:new Set([infinity.tokenId,inception.tokenId]),
 BOOST_EVENT_KINDS:new Set(),DNS_REGISTRY_ACTIVITY_KINDS:new Set(),DNS_MARKETPLACE_MUTATION_KINDS:new Set(),
 ID_MARKETPLACE_MUTATION_KINDS:new Set(),TOKEN_MARKETPLACE_MUTATION_KINDS:new Set(),MARKETPLACE_MUTATION_KINDS:new Set(),
 GROWTH_ID_DENSITY_NUMERATOR:26868933906745133n,GROWTH_ID_DENSITY_DENOMINATOR:100000000000000n,
 GROWTH_VALUE_MULTIPLE:5n,VALUE_Q8_SCALE:100000000n,integerBigInt,q8ToNumber,
 uniqueMarketplaceMutationActivity:()=>[],marketplaceMutationPaymentSatsBigInt:()=>0n,
};
const reconciliation='workAmoV5LegacyBootstrapReconciliation';
const names=['isBrowserHtmlMessageBody','isBrowserActivityItem','normalizedBondMemo','bondConfigForMemo','bondConfigForKind','bondActivityConfig',
 'isBondActivityItem','isInceptionBondActivityItem','isInfinityBondActivityItem','activityKindHasDedicatedGrowthBucket',
 'activityAmountSatsBigInt','proofFlowBigInt','publicMarketplaceSales','growthActualBaseNetworkValueEvents','growthActualBaseStateTotalQ8',
 'canonicalNonNegativeIntegerText','workAmoV5ExactInteger','workAmoV5LegacyBootstrapEvidenceMatches','workAmoV5DnsGrowthOverlayFromActualValue',reconciliation];
function build(){
 const context=vm.createContext({...constantDeps});
 const code=names.map(functionSource).join('\n');
 vm.runInContext(code+'\nthis.helpers={isBrowserActivityItem,growthActualBaseNetworkValueEvents,growthActualBaseStateTotalQ8,workAmoV5LegacyBootstrapReconciliation};',context);
 return context.helpers;
}
const helpers=build();
// Block 970498's confirmed HTML Mail carrier had memo and subject, with no
// rendered detail or HTML tag. Keep that canonical event shape in the fixture.
const html='<!doctype html>\n<html lang="en"><head><title>My ProofOfWork App</title></head><body>App</body></html>';
const cases=[
 {name:'actual canonical HTML mail with absent detail',item:{kind:'mail',memo:html},raw:[`pwm1:m:${html}`],expected:'browserFlowSats'},
 {name:'canonical HTML reply with subject-only detail',item:{kind:'reply',memo:html,detail:'Subject: My ProofOfWork App'},raw:[`pwm1:r:${'a'.repeat(64)}`,`pwm1:m:${html}`],expected:'browserFlowSats'},
 {name:'HTML whitespace and mixed case',item:{kind:'mail',memo:' \n\t<!DOCTYPE HTML>\n<html><body>x</body></html>'},raw:['pwm1:m: \n\t<!DOCTYPE HTML>\n<html><body>x</body></html>'],expected:'browserFlowSats'},
 {name:'ordinary canonical mail',item:{kind:'mail',memo:'hello world'},raw:['pwm1:m:hello world'],expected:'mailFlowSats'},
 {name:'ordinary reply with subject-only detail',item:{kind:'reply',memo:'hello world',detail:'Subject: hello'},raw:[`pwm1:r:${'a'.repeat(64)}`,'pwm1:m:hello world'],expected:'mailFlowSats'},
 {name:'POWB canonical bond memo',item:{kind:'mail',memo:'PoWb'},raw:['pwm1:m:PoWb'],expected:'infinityBondFlowSats'},
 {name:'INCB canonical bond memo',item:{kind:'mail',memo:'incb'},raw:['pwm1:m:incb'],expected:'inceptionBondFlowSats'},
 {name:'existing HTML body detail',item:{kind:'mail',detail:'<main>x</main>'},expected:'browserFlowSats'},
 {name:'existing HTML body tag',item:{kind:'reply',detail:'Subject: demo',tags:['HTML body']},expected:'browserFlowSats'},
 {name:'existing HTML attachment MIME detail',item:{kind:'file',detail:'app.html · 100 B · text/html'},expected:'browserFlowSats'},
 {name:'existing XHTML attachment MIME tag',item:{kind:'file',tags:['application/xhtml+xml']},expected:'browserFlowSats'},
 {name:'ordinary image file',item:{kind:'file',detail:'image.png · image/png'},expected:'driveFlowSats'},
 {name:'HTML-looking file memo does not reclassify ordinary file',item:{kind:'file',memo:html,detail:'image.png · image/png'},expected:'driveFlowSats'},
];
function contribution(helper,item){
 const events=helper.growthActualBaseNetworkValueEvents([],[{...item,txid:'b'.repeat(64),confirmed:true,valid:true,amountSats:'546',createdAt:'2026-10-08T13:55:10.000Z',blockHeight:970498,blockIndex:2789,protocolVout:1,recordOrdinal:0}],[],[],[],[],[]);
 assert.equal(events.length,1);
 return {field:events[0].contribution.field,value:events[0].contribution.value.toString()};
}
for (const fixture of cases) {
  test(fixture.name, () => {
    const actual = contribution(helpers, fixture.item);
    assert.equal(actual.field, fixture.expected);
    assert.equal(actual.value, '546');
    if (fixture.raw) {
      assert.equal(amo.parseWorkAmoV5PwmMessages(fixture.raw).contributionField, fixture.expected);
    }
  });
}

const mutation=amo.WORK_AMO_V5_LEGACY_BOOTSTRAP_CARRY_MUTATION_SATS;
const miner=amo.WORK_AMO_V5_LEGACY_BOOTSTRAP_CARRY_MINER_FEE_SATS;
const evidence={activeListingCount:0,blockHash:amo.WORK_AMO_V5_LEGACY_BOOTSTRAP_CARRY_BLOCK_HASH,blockHeight:amo.WORK_AMO_V5_LEGACY_BOOTSTRAP_CARRY_BLOCK_HEIGHT,
 blockIndex:amo.WORK_AMO_V5_LEGACY_BOOTSTRAP_CARRY_BLOCK_INDEX,complete:true,creditFixedQ8:String(BigInt(mutation+miner)*constantDeps.VALUE_Q8_SCALE),
 creditFixedSats:mutation+miner,eventId:3121341,growthValueQ8:String(BigInt(mutation)*constantDeps.GROWTH_VALUE_MULTIPLE*constantDeps.VALUE_Q8_SCALE),
 growthValueSats:mutation*5,listingCount:1,marketplaceMutationFeeSats:mutation,minerFeeSats:miner,model:amo.WORK_AMO_V5_LEGACY_BOOTSTRAP_CARRY_MODEL,
 protocolVout:amo.WORK_AMO_V5_LEGACY_BOOTSTRAP_CARRY_PROTOCOL_VOUT,reasonCode:amo.WORK_AMO_V5_LEGACY_BOOTSTRAP_CARRY_REASON_CODE,
 recordOrdinal:amo.WORK_AMO_V5_LEGACY_BOOTSTRAP_CARRY_RECORD_ORDINAL,txid:amo.WORK_AMO_V5_LEGACY_BOOTSTRAP_CARRY_TXID};
const valid=Object.fromEntries(amo.WORK_AMO_V5_BASE_STATE_FIELDS.map(field=>[field,'0']));valid.browserFlowSats='546';
const committedBase={...valid,tokenMarketplaceFeeSats:String(mutation)};
const state={baseState:committedBase,creditFixedQ8:evidence.creditFixedQ8};
const value={baseNetworkValueQ8:String(helpers.growthActualBaseStateTotalQ8(committedBase))};
const actualValue={...valid,baseNetworkValueQ8:String(helpers.growthActualBaseStateTotalQ8(valid)),creditFixedQ8:'0',
 creditProofPaymentFlowSats:'0',creditRegistryMutationFlowSats:'0',creditMarketplaceMutationFlowSats:'0',creditSalePaymentFlowSats:'0',creditMinerFeeFlowSats:'0'};
test('correct HTML contribution reconciles with the committed AMO state', () => {
  assert.equal(helpers.workAmoV5LegacyBootstrapReconciliation(state,value,{actualValue},evidence).valid,true);
});
test('strict reconciliation still refuses the old HTML misclassification', () => {
  const wrong={...actualValue,browserFlowSats:'0',mailFlowSats:'546'};
  const result=helpers.workAmoV5LegacyBootstrapReconciliation(state,value,{actualValue:wrong},evidence);
  assert.equal(result.valid,false);
  assert.equal(result.reason,'legacy-bootstrap-base-field-diverged:browserFlowSats');
});
test('strict reconciliation still refuses an altered browser proof count', () => {
  const result=helpers.workAmoV5LegacyBootstrapReconciliation(state,value,{actualValue:{...actualValue,browserFlowSats:'547'}},evidence);
  assert.equal(result.valid,false);
  assert.equal(result.reason,'legacy-bootstrap-base-field-diverged:browserFlowSats');
});
test('strict reconciliation still refuses forged bootstrap evidence', () => {
  const result=helpers.workAmoV5LegacyBootstrapReconciliation(state,value,{actualValue},{...evidence,txid:'c'.repeat(64)});
  assert.equal(result.valid,false);
  assert.equal(result.reason,'legacy-bootstrap-evidence-mismatch');
});
