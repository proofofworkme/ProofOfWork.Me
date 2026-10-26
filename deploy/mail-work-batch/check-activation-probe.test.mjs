import test from "node:test";
import assert from "node:assert/strict";
import { Transaction } from "bitcoinjs-lib";
import { parseRequest, exactTip, requireV8, hydrateRawTransaction, verifyEvidence, verifyUnactivated, canonicalCandidateIsCoinbase } from "./activation-probe.mjs";
import { normalizeWorkMailBatchDeclarationPins, validateWorkMailBatchActivationMarker,
  workMailBatchActivationMarkerFromTransition } from "../../server/work-mail-batch-declaration.mjs";

const h = x => x.repeat(64);
const pins = normalizeWorkMailBatchDeclarationPins({ txid:h("a"),blockHash:h("b"),blockHeight:973283,
  activationHeight:973284,blockTransactionIndex:1,protocolVout:1,recordOrdinal:0,registryPaymentVout:0 });
const tip = { height:973285,blockHash:h("d") };
const commitment = { model:"canonical-work-mail-batch-v1-authority-commitment-v1",sha256:h("e"),payloadBytes:100 };
const chain = { model:"canonical-work-amo-raw-transition-chain-sha256-v1",sha256:h("f"),payloadBytes:100 };
const rawDeclaration = Object.fromEntries(["txid","blockHash","blockHeight","blockTransactionIndex",
  "protocolVout","recordOrdinal","registryPaymentVout"].map(key=>[key,pins[key]]));
const transition = cp => ({ blockHeight:cp.height,blockHash:cp.blockHash,payload:{
  network:"livenet",blockHeight:cp.height,blockHash:cp.blockHash,previousBlockHash:pins.blockHash,
  complete:true,blockAtomic:true,feeOnce:true,invalidZero:true,transitionChainCommitment:chain,
  workMailBatchV1:{activationHeight:pins.activationHeight,declaration:rawDeclaration,evidenceCommitment:commitment} } });
const marker = workMailBatchActivationMarkerFromTransition(transition({height:pins.activationHeight,blockHash:h("c")}));
const fixture = () => ({
  core:async (method) => method==="getblockchaininfo" ?
    {chain:"main",blocks:tip.height,bestblockhash:tip.blockHash,initialblockdownload:false}:h("c"),
  validateMarker:validateWorkMailBatchActivationMarker,normalizePins:normalizeWorkMailBatchDeclarationPins,
  markerFromTransition:workMailBatchActivationMarkerFromTransition,
  readMarker:async()=>structuredClone(marker),
  readTransition:async cp=>transition(cp),
  verifySelection:async()=>true,
  loadActivation:async()=>({active:true,canonical:true,confirmed:true,evidenceComplete:true,
    declaration:pins,activationHeight:pins.activationHeight,evidenceCommitment:commitment}),
  readV8:async()=>({writeAdmission:true,protocolReady:true,evidenceComplete:true,indexReady:true,
    activation:{tipVerified:true},tipHeight:tip.height,tipHash:tip.blockHash}),
  readLegacy:async()=>({protocol:"work-batch-v1",network:"livenet",active:true,writeEnabled:true,ready:true,
    checkedTipHeight:tip.height,checkedTipHash:tip.blockHash,registryFeeProofs:546,
    limits:{minRecipients:2,maxRecipients:256,maxPayloadBytes:65536}}),
  expectedWriteEnabled:false,
  readBatch:async()=>({protocol:"work-mail-batch-v1",network:"livenet",active:true,writeEnabled:false,ready:false,
    declarationTxid:pins.txid,activationHeight:pins.activationHeight,checkedTipHeight:tip.height,
    checkedTipHash:tip.blockHash,registryFeeProofs:546,
    limits:{minRecipients:1,maxRecipients:256,maxPayloadBytes:65536}}),
});

test("accepts independent marker, raw seven pins, D+1/current transition and exact admission",async()=>{
  const result=await verifyEvidence(fixture());
  assert.deepEqual(result.pins,pins);
  assert.equal(result.v8WriteAdmission,true);
  assert.equal(result.markerSha256.length,64);
  assert.equal(JSON.stringify(result).includes("PASSWORD"),false);
});
test("JSONB key ordering does not change exact evidence equality",async()=>{
  const d=fixture(); d.readMarker=async()=>Object.fromEntries(Object.entries(marker).reverse());
  assert.equal((await verifyEvidence(d)).pins.txid,pins.txid);
});
for (const [name,replace] of Object.entries({
  "existing batch disabled":{readLegacy:async()=>({...await fixture().readLegacy(),writeEnabled:false})},
  "missing marker":{readMarker:async()=>null},
  "conflicting requested pins":{expectedPins:{...pins,txid:h("1")}},
  "earlier declaration":{verifySelection:async()=>{throw new Error("earlier");}},
  "missing Core input":{loadActivation:async()=>{throw new Error("missing");}},
  "Core evidence conflict":{loadActivation:async()=>({...await fixture().loadActivation(),evidenceCommitment:{...commitment,sha256:h("1")}})},
  "D+1 reorg":{core:async method=>method==="getblockchaininfo"?{chain:"main",blocks:tip.height,bestblockhash:tip.blockHash,initialblockdownload:false}:h("1")},
  "missing transition":{readTransition:async()=>null},
  "fee-once false":{readTransition:async cp=>{const t=transition(cp);t.payload.feeOnce=false;return t;}},
  "raw declaration conflict":{readTransition:async cp=>{const t=structuredClone(transition(cp));t.payload.workMailBatchV1.declaration.txid=h("1");return t;}},
  "V8 paused":{readV8:async()=>({...await fixture().readV8(),writeAdmission:false})},
  "V8 stale tip":{readV8:async()=>({...await fixture().readV8(),tipHash:h("1")})},
  "API unexpectedly enabled":{readBatch:async()=>({...await fixture().readBatch(),writeEnabled:true})},
  "API wrong fee":{readBatch:async()=>({...await fixture().readBatch(),registryFeeProofs:1092})},
})) test("fails closed: "+name,async()=>assert.rejects(verifyEvidence({...fixture(),...replace})));
test("changed final Core tip fails",async()=>{
  const d=fixture();let count=0;
  d.core=async method=>method==="getblockchaininfo"?
    {chain:"main",blocks:tip.height,bestblockhash:++count===1?tip.blockHash:h("1"),initialblockdownload:false}:h("c");
  await assert.rejects(verifyEvidence(d),/core-tip-changed/u);
});
test("marker changed during reads fails",async()=>{
  const d=fixture();let count=0;
  d.readMarker=async()=>++count===1?marker:{...marker,evidenceCommitment:{...commitment,sha256:h("1")}};
  await assert.rejects(verifyEvidence(d),/batch-marker-changed/u);
});
test("enabled status must be ready at the independently verified tip",async()=>{
  const d=fixture();d.expectedWriteEnabled=true;
  d.readBatch=async()=>({...await fixture().readBatch(),writeEnabled:true,ready:true});
  assert.equal((await verifyEvidence(d)).v8WriteAdmission,true);
  d.readBatch=async()=>({...await fixture().readBatch(),writeEnabled:true,ready:false});
  await assert.rejects(verifyEvidence(d),/batch-api-parity/u);
});
test("Core must be main chain and fully synchronized",()=>{
  for(const bad of [{chain:"test"},{initialblockdownload:true},{blocks:-1},{bestblockhash:""}])
    assert.throws(()=>exactTip({chain:"main",initialblockdownload:false,blocks:tip.height,bestblockhash:tip.blockHash,...bad}));
});
test("raw transaction hydration binds exact bytes and integer values",()=>{
  const tx=new Transaction();tx.addInput(Buffer.alloc(32,1),0);tx.addOutput(Buffer.from("51","hex"),546n);
  const raw={txid:tx.getId(),hex:tx.toHex(),confirmations:1,blockhash:h("b")};
  const result=hydrateRawTransaction(raw,raw.txid,Transaction);
  assert.equal(result.vout[0].value,546);assert.equal(result.vout[0].scriptpubkey,"51");
  assert.throws(()=>hydrateRawTransaction(raw,h("a"),Transaction),/core-transaction/u);
  assert.throws(()=>hydrateRawTransaction({...raw,hex:"00"},raw.txid,Transaction));
});

test("coinbase exclusion requires actual canonical block membership",()=>{
  const candidate={txid:h("a"),blockHash:h("b"),blockHeight:973283,blockTransactionIndex:0};
  const decoded={txid:h("a"),status:{confirmed:true,block_hash:h("b")}};
  const block={hash:h("b"),height:973283,tx:[h("a"),h("c")]};
  assert.equal(canonicalCandidateIsCoinbase(candidate,decoded,block,h("b")),true);
  assert.throws(()=>canonicalCandidateIsCoinbase(candidate,decoded,{...block,tx:[h("c"),h("a")]},h("b")));
  assert.throws(()=>canonicalCandidateIsCoinbase(candidate,decoded,block,h("d")));
  assert.throws(()=>canonicalCandidateIsCoinbase(candidate,{...decoded,status:{confirmed:false}},block,h("b")));
});
test("raw public candidates and prevouts do not acquire a nonprotocol 256-input cap",()=>{
  const tx=new Transaction();
  for(let i=0;i<257;i++)tx.addInput(Buffer.alloc(32,1),i);
  tx.addOutput(Buffer.from("51","hex"),546n);
  assert.equal(hydrateRawTransaction({txid:tx.getId(),hex:tx.toHex()},tx.getId(),Transaction).vin.length,257);
});

test("probe request rejects oversized and malformed inputs",()=>{
  assert.deepEqual(parseRequest('{"expectedWriteEnabled":false}'),{expectedWriteEnabled:false});
  assert.throws(()=>parseRequest(" ".repeat(65537)),/probe-request-oversized/u);
  assert.throws(()=>parseRequest("{"),SyntaxError);
});

const absentFixture=()=>({core:async()=>({chain:"main",blocks:973285,bestblockhash:h("a"),initialblockdownload:false}),
  readCheckpoint:async()=>({complete:true,blockHeight:973285,blockHash:h("a")}),readMarker:async()=>null,discover:async()=>null});
test("deployment proves complete current prefix and absent declaration/marker",async()=>{
  assert.equal((await verifyUnactivated(absentFixture())).qualified,true);
});
for(const [name,change] of Object.entries({
  "incomplete prefix":{readCheckpoint:async()=>({complete:false,blockHeight:973285,blockHash:h("a")})},
  "lagging prefix":{readCheckpoint:async()=>({complete:true,blockHeight:973284,blockHash:h("a")})},
  "already confirmed declaration":{discover:async()=>pins},
  "existing marker":{readMarker:async()=>marker},
  "missing marker with sealed context":{readMarker:async()=>{throw new Error("missing marker");}},
}))test("deployment refuses "+name,async()=>assert.rejects(verifyUnactivated({...absentFixture(),...change})));
test("deployment refuses Core movement between complete scans",async()=>{
  let n=0;const d=absentFixture();d.core=async()=>({chain:"main",blocks:973285,bestblockhash:h(++n===1?"a":"b"),initialblockdownload:false});
  await assert.rejects(verifyUnactivated(d),/core-tip-changed/u);
});
