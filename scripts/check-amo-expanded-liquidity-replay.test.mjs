import assert from "node:assert/strict";
import test from "node:test";
import { Block } from "bitcoinjs-lib";
import { DECLARATION_PINS as D, qualifyExpandedLiquidityReplay, verifyReplayDeclaration } from "../deploy/amo-expanded-liquidity-replay/qualify.mjs";
import { workAmoV5CanonicalStateCommitment } from "../server/work-amo-v5.mjs";
import { declarationEvidence, hashOf, nativeDigest, nativeRow, nextBlock, scenario, txFixture } from "../deploy/amo-expanded-liquidity-replay/fixtures/replay.mjs";

test("real declaration and funding bytes reconstruct the approved carrier and authority",()=>{
  const verified=verifyReplayDeclaration(declarationEvidence);
  assert.equal(verified.txid,D.txid);assert.equal(verified.registryPaymentVout,null);
  assert.throws(()=>verifyReplayDeclaration({...declarationEvidence,prevoutTransactionHex:txFixture.transactionHex}),/outpoint/);
  assert.throws(()=>verifyReplayDeclaration({...declarationEvidence,indexedPosition:{...declarationEvidence.indexedPosition,blockIndex:1}}),/indexed/);
});

test("baseline and repeated candidate replay bind the complete suffix and preserve existing economic state",async()=>{
  const {rows,options}=scenario();
  const r=await qualifyExpandedLiquidityReplay(options);
  assert.equal(r.qualified,true);assert.equal(r.anchor.hash,D.blockHash);assert.equal(r.blocks.length,2);
  for(const b of r.blocks) {
    assert.deepEqual(Object.keys(b.replacementFields).sort(),["expandedLiquidity","transitionChainCommitment"]);
    assert.deepEqual(b.oldTransitionChainCommitment,rows.get(b.height).decoded.transitionChainCommitment);
    assert.equal(rows.get(b.height).decoded.bip141Witness.required,true);
    assert.ok(b.rawBlockBytes>80);
    assert.notEqual(b.oldNativeSha256,b.newNativeSha256);
    assert.notEqual(b.oldTransitionChainCommitment.sha256,b.newTransitionChainCommitment.sha256);
    assert.equal(b.newNativeSha256,nativeDigest({...rows.get(b.height).decoded,...b.replacementFields}).sha256);
  }
});

test("full raw scan detects a governed output despite an empty database report",async()=>{
  const {options,rows,hashes,blocks}=scenario();
  const at=options.tip.height;
  const prior=hashes.get(at-1);
  const {block}=nextBlock(prior,at,true);
  const bh=block.getId();
  const p=rows.get(at).decoded;
  p.blockHash=bh;p.closingSufficientState.throughBlockHash=bh;
  p.closingStateCommitment=workAmoV5CanonicalStateCommitment(p.closingSufficientState);
  options.tip.hash=bh;hashes.set(at,bh);rows.set(at,nativeRow(p));blocks.set(bh,block.toHex());
  await assert.rejects(qualifyExpandedLiquidityReplay(options),/governed record/);
});

test("changed witness data in an otherwise identical block fails BIP141",async()=>{
  const {options,blocks}=scenario();
  const block=Block.fromHex(blocks.get(options.tip.hash));
  block.transactions[1].setWitness(0,[Buffer.from([4,5,6])]);
  assert.equal(block.getId(),options.tip.hash);
  blocks.set(options.tip.hash,block.toHex());
  await assert.rejects(qualifyExpandedLiquidityReplay(options),/witness-commitment-mismatch/);
});

test("changed source, malformed native rows, projection drift, raw bytes and reorgs refuse qualification",async()=>{
  for(const mutate of [
    ({options})=>{options.sources.readBinding=async()=>({...options.sources.binding,dependencySha256:hashOf(6)});},
    ({options})=>{options.tip={...options.tip,height:977228};},
    ({rows})=>{rows.get(977230).native_sha256=hashOf(7);},
    ({rows})=>{rows.get(977230).event_count=1;},
    ({rows})=>{const p=rows.get(977230).decoded;p.closingWorkProjection.extra="drift";rows.set(977230,nativeRow(p));},
    ({rows})=>{const p=rows.get(977231).decoded;p.previousBlockHash=hashOf(8);rows.set(977231,nativeRow(p));},
    ({options})=>{options.readRawBlock=async()=>"00";},
    ({options})=>{options.readRelations=async()=>({recordCount:1,eventCount:0});},
    ({options})=>{let i=0;const read=options.readCanonicalHash;options.readCanonicalHash=async h=>h===977230&&++i>1?hashOf(9):read(h);},
    ({options})=>{let i=0;options.readTip=async()=>++i===1?options.tip:{...options.tip,height:977232};},
    ({options})=>{const original=options.sources.candidateRaw;options.sources.candidateRaw={...original,
      replayWorkAmoV5RawBlock(input){const result=original.replayWorkAmoV5RawBlock(input);result.feeTransitions=[{feeSats:100}];return result;}};},
  ]) {const s=scenario();mutate(s);await assert.rejects(qualifyExpandedLiquidityReplay(s.options));}
});
