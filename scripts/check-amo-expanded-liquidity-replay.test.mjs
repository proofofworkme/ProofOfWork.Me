import assert from "node:assert/strict";
import test from "node:test";
import { Block, payments } from "bitcoinjs-lib";
import { DECLARATION_PINS as D, qualifyExpandedLiquidityReplay, verifyReplayDeclaration, verifyWorkProjection } from "../deploy/amo-expanded-liquidity-replay/qualify.mjs";
import { workAmoV5CanonicalPayloadCommitment, workAmoV5CanonicalStateCommitment } from "../server/work-amo-v5.mjs";
import { projectWorkAmoV5RawEvents } from "../server/work-amo-v5-raw.mjs";
import { buildWorkBatchPayload, parseWorkBatchPayload } from "../src/shared/protocol/workBatch.mjs";
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
  const {options,rows,hashes,blocks,parents}=scenario();
  const at=options.tip.height;
  const prior=hashes.get(at-1);
  const {block,parents:[parent]}=nextBlock(prior,at,"boost-file");
  parents.set(parent.getId(),parent.toHex());
  const bh=block.getId();
  const p=rows.get(at).decoded;
  p.blockHash=bh;p.closingSufficientState.throughBlockHash=bh;
  p.closingStateCommitment=workAmoV5CanonicalStateCommitment(p.closingSufficientState);
  options.tip.hash=bh;hashes.set(at,bh);rows.set(at,nativeRow(p));blocks.set(bh,block.toHex());
  await assert.rejects(qualifyExpandedLiquidityReplay(options),/governed record counts differ from Core/);
});

test("changed witness data in an otherwise identical block fails BIP141",async()=>{
  const {options,blocks}=scenario();
  const block=Block.fromHex(blocks.get(options.tip.hash));
  block.transactions[1].setWitness(0,[Buffer.from([4,5,6])]);
  assert.equal(block.getId(),options.tip.hash);
  blocks.set(options.tip.hash,block.toHex());
  await assert.rejects(qualifyExpandedLiquidityReplay(options),/witness-commitment-mismatch/);
});

test("an occupied suffix replays a Boost post and its two-part file in order and accounts for the fee once", async () => {
  const { rows, relations, options } = scenario({occupied:true});
  const qualification = await qualifyExpandedLiquidityReplay(options);
  assert.deepEqual(qualification.blocks.map(block => block.height), [977230, 977231]);
  for (const block of qualification.blocks) {
    const { decoded:before } = rows.get(block.height);
    const after = {...before, ...block.replacementFields};
    assert.equal(block.newNativeSha256, nativeDigest(after).sha256);
    assert.equal(before.rawProtocolCandidateCount, 3);
    assert.equal(before.protocolRecordCount, 2);
    assert.equal(before.eventCount, 2);
    assert.equal(before.transactionCount, 1);
    assert.deepEqual(after.replayRecords.map(record => [record.position.blockTransactionIndex, record.position.protocolVout,
      record.position.recordOrdinal, record.protocol, record.outcome.semanticKind, record.outcome.valid]),
    [[1,1,0,"pwb1","boost-event",true], [1,2,0,"pwm1","file",true]]);
    assert.deepEqual(after.replayRecords[1].rawWitness.rawRecordParts.map(part => part.protocolVout), [2,3]);
    assert.deepEqual(after.traces.map(trace => trace.kind), ["protocol-record","protocol-record","transaction-fee"]);
    assert.equal(after.traces[2].transactionMinerFeeSats, "200");
    assert.equal(after.closingSufficientState.baseState.driveFlowSats, block.height === 977230 ? "546" : "1092");
    assert.deepEqual(after.eventSetCommitment, before.eventSetCommitment);
    assert.notDeepEqual(after.replayDescriptorCommitment, before.replayDescriptorCommitment);
    assert.deepEqual(after.replayDescriptorCommitment, workAmoV5CanonicalPayloadCommitment(after.replayRecords));
    for (const field of ["openingSufficientState","closingSufficientState","closingWorkProjection","closingTokenState",
      "closingGenericTokenState","closingIdState","closingStateCommitment"]) {
      assert.deepEqual(after[field], before[field], field);
    }
    assert.deepEqual(block.relationalBindings, relations.get(block.height).bindings);
  }
});

test("multiple transactions follow block position even when txid and relational retrieval order differ", async () => {
  const {options, relations, rows} = scenario({occupied:true,paired:true});
  for (const observed of relations.values()) {
    observed.events.reverse();
    observed.records.reverse();
  }
  const qualification = await qualifyExpandedLiquidityReplay(options);
  for (const block of qualification.blocks) {
    const after = {...rows.get(block.height).decoded,...block.replacementFields};
    const {replayRecords, traces} = after;
    assert.deepEqual(replayRecords.map(record => [record.position.blockTransactionIndex,record.position.protocolVout]),
      [[1,1],[1,2],[2,1],[2,2]]);
    assert.ok(replayRecords[0].txid > replayRecords[2].txid);
    assert.deepEqual(traces.filter(trace => trace.kind === "transaction-fee").map(trace => [trace.txid,trace.transactionMinerFeeSats]),
      [[replayRecords[0].txid,"200"],[replayRecords[2].txid,"200"]]);
    assert.equal(block.relationalBindings.recordCount, 6);
    assert.equal(block.relationalBindings.eventCount, 4);
  }
});

test("occupied evidence must match the parent output, every carrier, each event, the sealed native frame and the canonical suffix", async t => {
  const cases = [
    ["missing funding transaction", /governed parent bytes unavailable/, ({parents}) => parents.clear()],
    ["incorrect funding transaction bytes", /governed parent txid mismatch/, ({parents}) => {
      const [first, second] = [...parents.keys()];
      parents.set(first, parents.get(second));
    }],
    ["dropped PWM continuation", /relational rows differ in records count/, ({relations}) => relations.get(977230).records.pop()],
    ["second PWM part attributed to the first vout", /relational rows differ in records/, ({relations}) => { relations.get(977230).records[2].vout = 2; }],
    ["changed raw payload bytes with equal length", /relational rows differ in records/, ({relations}) => {
      const row = relations.get(977230).records[2];
      row.payloadHex = row.payloadHex.slice(0, -2) + "00";
    }],
    ["missing file event", /relational rows differ in events count/, ({relations}) => relations.get(977230).events.pop()],
    ["wrong block index", /relational rows differ in events/, ({relations}) => { relations.get(977230).events[0].blockIndex = 0; }],
    ["wrong event ordinal", /relational rows differ in events/, ({relations}) => { relations.get(977230).events[1].ordinal = 1; }],
    ["event moved to another transaction", /relational rows differ in events/, ({relations}) => { relations.get(977230).events[0].txid = hashOf(25); }],
    ["changed fee in the event relation", /relational rows differ in events/, ({relations}) => { relations.get(977230).events[1].feeSats = "201"; }],
    ["changed transfer value in the event relation", /relational rows differ in events/, ({relations}) => { relations.get(977230).events[1].amountSats = "547"; }],
    ["extra byte credited to a PWM aggregate", /relational rows differ in events/, ({relations}) => { relations.get(977230).events[1].dataBytes++; }],
    ["wrong event type", /relational rows differ in events/, ({relations}) => { relations.get(977230).events[1].kind = "mail"; }],
    ["wrong replayed economic output", /relational rows differ in events/, ({relations}) => { relations.get(977230).events[1].replayOutput = null; }],
    ["altered event witness", /relational rows differ in events/, ({relations}) => { relations.get(977230).events[1].rawWitness.rawRecordParts.pop(); }],
    ["unbound event witness", /relational rows differ in events/, ({relations}) => { relations.get(977230).events[1].bound = false; }],
    ["reversed native record order with a matching descriptor seal", /baseline differs from stored replayRecords/, ({rows}) => {
      const payload = rows.get(977230).decoded;
      payload.replayRecords.reverse();
      payload.replayDescriptorCommitment = workAmoV5CanonicalPayloadCommitment(payload.replayRecords);
      rows.set(977230, nativeRow(payload));
    }],
    ["incorrect native fee trace with a matching frame seal", /baseline differs from stored traces/, ({rows}) => {
      const payload = rows.get(977230).decoded;
      payload.traces.at(-1).transactionMinerFeeSats = "201";
      rows.set(977230, nativeRow(payload));
    }],
    ["reorg after the occupied block was verified", /canonical range changed during replay/, ({options}) => {
      const read = options.readCanonicalHash;
      let seen = false;
      options.readCanonicalHash = async height => {
        if (height === 977230) {
          if (seen) return hashOf(26);
          seen = true;
        }
        return read(height);
      };
    }],
  ];
  for (const [label, reason, mutate] of cases) {
    await t.test(label, async () => {
      const fixture = scenario({occupied:true});
      mutate(fixture);
      await assert.rejects(qualifyExpandedLiquidityReplay(fixture.options), reason);
    });
  }
});

test("a two-recipient bond preserves both mint projections and relinks each child to its original parent position", async () => {
  const { options, rows, relations } = scenario({occupied:"two-recipient-bond"});
  const qualification = await qualifyExpandedLiquidityReplay(options);
  for (const block of qualification.blocks) {
    const before = rows.get(block.height).decoded;
    const after = {...before,...block.replacementFields};
    const [parent,first,second] = after.replayRecords;
    assert.deepEqual(after.replayRecords.map(record => [record.position.protocolVout,record.position.recordOrdinal,
      record.outcome.semanticKind]), [[2,0,"infinity-bond"],[2,1,"token-mint"],[2,2,"token-mint"]]);
    assert.deepEqual(relations.get(block.height).events.map(event => event.rawCandidate), [true,false,false]);
    assert.deepEqual([first,second].map(record => record.output.projection.amount), ["546","345"]);
    for (const child of [first,second]) {
      assert.equal(child.chargesTransactionFee, false);
      assert.deepEqual(child.parentPosition, parent.position);
      assert.deepEqual(child.parentTransitionChainCommitmentAfter, parent.transitionChainCommitmentAfter);
      assert.deepEqual(child.rawWitness.descriptor.parentTransitionChainCommitmentAfter, parent.transitionChainCommitmentAfter);
      assert.deepEqual(child.output.projection.parentTransitionChainCommitmentAfter, parent.transitionChainCommitmentAfter);
    }
    assert.equal(after.traces.filter(trace => trace.kind === "transaction-fee").length, 1);
    assert.equal(after.closingGenericTokenState.tokens[0].confirmedSupplyAtoms, block.height === 977230 ? "891" : "1782");
    assert.deepEqual(before.closingGenericTokenState, after.closingGenericTokenState);
    assert.notDeepEqual(block.newEventSetCommitment, block.oldEventSetCommitment);
    assert.equal(nativeDigest(after).sha256, block.newNativeSha256);
  }
});

test("derived children cannot be dropped, renumbered, reparented or charged again", async t => {
  const cases = [
    ["missing indexed child", /relational rows differ in events count/, ({relations}) => relations.get(977230).events.pop()],
    ["duplicate indexed child", /relational rows differ in events/, ({relations}) => { relations.get(977230).events[2].ordinal = 1; }],
    ["sibling identity substituted", /relational rows differ in events/, ({relations}) => {
      const events = relations.get(977230).events;
      events[2].derivedId = events[1].derivedId;
    }],
    ["fee charged on a derived row", /baseline differs from stored replayRecords/, ({rows}) => {
      const before = rows.get(977230).decoded;
      before.replayRecords[1].chargesTransactionFee = true;
      before.replayDescriptorCommitment = workAmoV5CanonicalPayloadCommitment(before.replayRecords);
      rows.set(977230, nativeRow(before));
    }],
    ["child points at a different native parent chain", /baseline differs from stored replayRecords/, ({rows}) => {
      const before = rows.get(977230).decoded;
      before.replayRecords[1].parentTransitionChainCommitmentAfter.sha256 = hashOf(42);
      before.replayDescriptorCommitment = workAmoV5CanonicalPayloadCommitment(before.replayRecords);
      rows.set(977230, nativeRow(before));
    }],
    ["candidate changes the amount in a deterministic mint outcome", /record and outcome differ/, ({options}) => {
      const original = options.sources.candidateRaw;
      options.sources.candidateRaw = {...original,replayWorkAmoV5RawBlock(input) {
        const replay = original.replayWorkAmoV5RawBlock(input);
        replay.events[0].derived[0].amount = "547";
        return replay;
      }};
    }],
  ];
  for (const [label, reason, mutate] of cases) {
    await t.test(label, async () => {
      const fixture = scenario({occupied:"two-recipient-bond"});
      mutate(fixture);
      await assert.rejects(qualifyExpandedLiquidityReplay(fixture.options), reason);
    });
  }
});

test("WORK batch projections retain their verified parent and child origins through an empty block", () => {
  // Exercise the projection boundary using a modeled accepted event, with no signing.
  const snapshot = scenario().rows.get(977230).decoded;
  const work = snapshot.closingTokenState;
  const senderAddress = payments.p2wpkh({hash:Buffer.alloc(20,1)}).address;
  const recipients = [2,3].map(i => ({
    amountSubatoms:String(i),recipientAddress:payments.p2wpkh({hash:Buffer.alloc(20,i)}).address,
  }));
  const payload = buildWorkBatchPayload(recipients);
  const parsed = parseWorkBatchPayload(payload);
  const batchPayloadCommitment = workAmoV5CanonicalPayloadCommitment({payload});
  const position = {blockHash:snapshot.blockHash,blockHeight:977230,blockTransactionIndex:1,protocolVout:1,recordOrdinal:0};
  const txid = hashOf(776);
  function releaseEvent(sha256) {
    const chain = {model:"canonical-work-amo-raw-transition-chain-sha256-v1",sha256,payloadBytes:300};
    return {txid,protocol:"pwt1",valid:true,parsed,position,transitionChainCommitmentAfter:chain,
      output:{projection:{batchPayloadCommitment,movementAmountSubatoms:"5",senderAddress}},
      derived:recipients.map((recipient,index) => ({
        ...recipient,batchRecipientIndex:index,batchRecipientCount:2,batchTotalAmountSubatoms:"5",
        kind:"token-transfer",transferVersion:"batch1",containerPosition:position,senderAddress,
        derivedId:[txid,977230,1,1,index+1].join(":"),projectionPosition:{...position,recordOrdinal:index+1},
        parentTransitionChainCommitmentAfter:chain,
      }))};
  }
  const oldEvents = {events:[releaseEvent(hashOf(501))]};
  const newEvents = {events:[releaseEvent(hashOf(502))]};
  const before = projectWorkAmoV5RawEvents({},oldEvents.events,work);
  const after = projectWorkAmoV5RawEvents({},newEvents.events,work);
  const bindings = new Map();
  verifyWorkProjection(before,after,oldEvents,newEvents,bindings);
  assert.equal(bindings.size, 3);
  const carriedBefore = projectWorkAmoV5RawEvents(before,[],work);
  const carriedAfter = projectWorkAmoV5RawEvents(after,[],work);
  const empty = {events:[]};
  verifyWorkProjection(carriedBefore,carriedAfter,empty,empty,bindings);
  assert.deepEqual(carriedAfter.transferBatches.map(row => row.totalAmountSubatoms), ["5"]);
  assert.deepEqual(carriedAfter.transfers.map(row => [row.recordOrdinal,row.amountSubatoms]), [[1,"2"],[2,"3"]]);
  assert.throws(() => verifyWorkProjection(carriedBefore,carriedAfter,empty,empty,new Map()), /provenance differs/);
  assert.throws(() => verifyWorkProjection(carriedBefore,carriedBefore,empty,empty,bindings), /provenance differs/);
  for (const origin of ["blockHash","txid","recordOrdinal","parentTransitionChainCommitmentAfter"]) {
    const detached = structuredClone(carriedAfter);
    const child = detached.transfers[1];
    if (origin === "recordOrdinal") child.recordOrdinal = 9;
    else if (origin === "parentTransitionChainCommitmentAfter") child.parentTransitionChainCommitmentAfter.sha256 = hashOf(503);
    else child[origin] = hashOf(504);
    assert.throws(() => verifyWorkProjection(carriedBefore,detached,empty,empty,bindings), /provenance differs/);
  }
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
