import assert from "node:assert/strict";
import test from "node:test";
import { performance } from "node:perf_hooks";
import { RESOURCE_LIMITS } from "../deploy/work-batch-replay/preflight.mjs";
import { Block, payments } from "bitcoinjs-lib";
import { DECLARATION_PINS as D, MAX_CATCH_UP_MILLISECONDS, MAX_TIP_REFRESHES, qualifyExpandedLiquidityReplay, verifyReplayDeclaration, verifyWorkProjection } from "../deploy/amo-expanded-liquidity-replay/qualify.mjs";
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

function checkpoint(fixture, offset) {
  const height = D.blockHeight + offset;
  return { height, hash: fixture.hashes.get(height) };
}

function catchingUp(fixture, start, refresh) {
  let latest = checkpoint(fixture, start);
  const options = { ...fixture.options, tip: { ...latest }, readTip: async () => {
    if (latest instanceof Error) throw latest;
    return { ...latest };
  } };
  const prefixes = [];
  options.refreshTip = async (prefix, observe, checkDeadline) => {
    prefixes.push(prefix.tip.height);
    return refresh(prefix, observe, value => { latest = value; }, checkDeadline);
  };
  return { options, prefixes };
}

test("a five-block catch-up replays only the tail and matches the full dual-engine receipt", async t => {
  for (const occupied of [true, false]) await t.test(occupied ? "Boost and attached file" : "empty blocks", async t => {
    const fixture = scenario({ occupied, blockCount: 7 });
    const all = await qualifyExpandedLiquidityReplay(fixture.options);
    const terminal = checkpoint(fixture, 7);
    let tailStarted, tailFinished;
    const { options, prefixes } = catchingUp(fixture, 2, (prefix, observe, setLive) => {
      const now = performance.now();
      if (prefix.tip.height === terminal.height) tailFinished = now;
      else tailStarted = now;
      assert.deepEqual(Object.keys(prefix).sort(), ["anchor","blocks","declaration","sourceBinding","tip"]);
      assert.deepEqual(Object.keys(prefix.blocks[0]).sort(),
        ["currentMainRowSha256","hash","height","oldNativeBytes","oldNativeSha256","relationalBindings"]);
      assert.equal(prefix.anchor.oldNativeBytes, fixture.rows.get(D.blockHeight).native_bytes);
      assert.equal(prefix.blocks[0].oldNativeBytes, fixture.rows.get(D.blockHeight + 1).native_bytes);
      // The storage adapter receives detached evidence. It cannot mutate the private carry or the receipt.
      prefix.blocks[0].oldNativeSha256 = hashOf(0);
      prefix.blocks[0].relationalBindings.eventCount = -1;
      prefix.tip.hash = hashOf(0);
      prefix.anchor.hash = hashOf(0);
      prefix.sourceBinding.sourceCommit = "0".repeat(40);
      observe(terminal);
      setLive(terminal);
      return terminal;
    });
    const raw = [], rows = [], relations = [], baseline = [], candidate = [];
    for (const [reader, calls] of [["readRawBlock", raw], ["readTransition", rows], ["readRelations", relations]]) {
      options[reader] = async (...args) => { calls.push(args[0]); return fixture.options[reader](...args); };
    }
    options.sources = { ...options.sources };
    for (const [engine, calls] of [["baselineRaw", baseline], ["candidateRaw", candidate]]) {
      const original = options.sources[engine];
      options.sources[engine] = { ...original, replayWorkAmoV5RawBlock(input) {
        calls.push(input.expectedBlockHeight);
        return original.replayWorkAmoV5RawBlock(input);
      } };
    }
    const q = await qualifyExpandedLiquidityReplay(options);
    assert.deepEqual(q, all);
    const heights = all.blocks.map(row => row.height);
    assert.deepEqual(raw, all.blocks.map(row => row.hash));
    assert.deepEqual(rows, [D.blockHeight, ...heights]);
    assert.deepEqual(relations, heights);
    assert.deepEqual(baseline, heights);
    assert.deepEqual(candidate, heights.flatMap(height => [height,height]));
    assert.deepEqual(prefixes, [D.blockHeight + 2, terminal.height]);
    if (occupied) {
      const tail = q.blocks.slice(2);
      assert.equal(tail.reduce((n,row) => n + row.protocolCounts.eventCount, 0), 10);
      assert.equal(tail.reduce((n,row) => n + row.relationalBindings.recordCount, 0), 15);
      t.diagnostic(`five synthetic occupied blocks, ten events, fifteen carrier rows, ${(tailFinished - tailStarted).toFixed(1)} ms`);
    }
  });
});

test("a snapshot overtaken during validation is consumed up to its visible end", async () => {
  const fixture = scenario({ occupied: true, blockCount: 4 });
  const h = n => checkpoint(fixture, n);
  let round = 0;
  const raw = [];
  const { options, prefixes } = catchingUp(fixture, 1, (_, observe, setLive) => {
    round++;
    if (round === 1) {
      observe(h(2));
      setLive(h(2));
      return h(1); // The new head is still invisible. Rotate without rereading the first block.
    }
    if (round === 2) {
      observe(h(3));
      setLive(h(4));
      return h(2); // Read the newly visible second block. The fourth requires a later snapshot.
    }
    return h(4);
  });
  options.readRawBlock = async hash => { raw.push(hash); return fixture.blocks.get(hash); };
  const result = await qualifyExpandedLiquidityReplay(options);
  assert.deepEqual(prefixes, [h(1).height,h(1).height,h(2).height,h(4).height]);
  assert.deepEqual(raw, result.blocks.map(row => row.hash));
  assert.deepEqual(result, await qualifyExpandedLiquidityReplay(fixture.options));
});

test("a refresh refuses changed canonical, declared, native, indexed or source evidence", async t => {
  const refuse = [
    ["reorg inside completed prefix", /canonical range changed/, ({ fixture }) => { fixture.hashes.set(D.blockHeight + 1, hashOf(77)); }],
    ["different hash for a prior observation", /previously observed checkpoint changed/, ({ observe, h }) => {
      observe(h(3)); observe({ ...h(3), hash: hashOf(77) });
    }],
    ["live head regressed", /Core\/index tip moved backwards/, ({ observe, h, setLive }) => { observe(h(3)); setLive(h(2)); }],
    ["new SQL snapshot behind prior live head", /fresh snapshot moved backwards/, ({ h, round }) => round === 2 ? h(2) : h(1)],
    ["fresh Core and index disagree", /Core and index differ/, ({ setLive }) => { setLive(Error("Core and index differ")); }],
    ["previously observed intermediate no longer canonical", /observed checkpoint is no longer canonical/, ({ fixture, h, observe }) => {
      observe(h(2)); fixture.hashes.set(h(2).height, hashOf(77));
    }],
    ["canonical declaration unavailable", /declaration bytes unavailable/, ({ fixture }) => { fixture.options.readDeclarationEvidence = async () => null; }],
    ["source drift", /final declaration, source or tip changed/, ({ fixture }) => { fixture.options.sources.binding.candidateSourceSha256 = hashOf(77); }],
    ["missing event on the extension", /relational rows differ in events count/, ({ fixture, h }) => { fixture.relations.get(h(2).height).events.pop(); }],
    ["modified native row on the extension", /native|seal/, ({ fixture, h }) => { fixture.rows.get(h(2).height).native_sha256 = hashOf(77); }],
  ];
  for (const [name, error, change] of refuse) await t.test(name, async () => {
    const fixture = scenario({ occupied: true, blockCount: 3 });
    const h = n => checkpoint(fixture, n);
    let round = 0;
    const { options } = catchingUp(fixture, 1, (_, observe, setLive) => {
      round++;
      const intended = h(3);
      setLive(intended);
      return change({ fixture, h, round, observe, setLive }) ?? intended;
    });
    options.readDeclarationEvidence = () => fixture.options.readDeclarationEvidence();
    await assert.rejects(qualifyExpandedLiquidityReplay(options), error);
  });
});

test("a previously observed head must match when later read as an interior replay block", async () => {
  const fixture = scenario({ blockCount: 4 });
  const h = n => checkpoint(fixture, n);
  let round = 0, interiorReads = 0;
  const { options } = catchingUp(fixture, 1, (_, observe, setLive) => {
    round++;
    if (round === 1) observe(h(3));
    setLive(h(4));
    return round === 1 ? h(2) : h(4);
  });
  options.readCanonicalHash = async height => {
    if (height === h(3).height && ++interiorReads === 3) return hashOf(81);
    return fixture.hashes.get(height);
  };
  await assert.rejects(qualifyExpandedLiquidityReplay(options), /previously observed checkpoint changed/);
  assert.equal(interiorReads, 3);
});

test("only an in-process prefix can advance, and an interrupted rotation cannot produce a receipt", async () => {
  const fixture = scenario({ occupied: true });
  let partial, oldObserve;
  const { options } = catchingUp(fixture, 1, (prefix, observe) => {
    partial = structuredClone(prefix);
    oldObserve = observe;
    throw Error("interrupted fresh snapshot");
  });
  await assert.rejects(qualifyExpandedLiquidityReplay(options), /interrupted fresh snapshot/);
  assert.ok(partial.blocks.length === 1 && !("qualified" in partial));
  assert.throws(() => oldObserve(fixture.options.tip), /observation is closed/);
  const renewed = { ...fixture.options, ...partial, tip: fixture.options.tip,
    readTransition: async height => { assert.equal(height, D.blockHeight); throw Error("anchor unavailable on cold start"); } };
  await assert.rejects(qualifyExpandedLiquidityReplay(renewed), /anchor unavailable on cold start/);
});

test("the terminal fence, total time and native byte budget all remain bounded across rotations", async t => {
  for (const count of [MAX_TIP_REFRESHES, MAX_TIP_REFRESHES + 1]) await t.test(`${count} total snapshots`, async () => {
    const fixture = scenario({ blockCount: count });
    const { options, prefixes } = catchingUp(fixture, 1, (prefix, _, setLive) => {
      const next = checkpoint(fixture, Math.min(count, prefix.tip.height - D.blockHeight + 1));
      setLive(next);
      return next;
    });
    if (count === MAX_TIP_REFRESHES) assert.deepEqual((await qualifyExpandedLiquidityReplay(options)).tip, fixture.options.tip);
    else await assert.rejects(qualifyExpandedLiquidityReplay(options), /snapshot refresh budget exceeded/);
    assert.equal(prefixes.length, MAX_TIP_REFRESHES);
  });
  await t.test("elapsed time includes final tip read", async t => {
    const fixture = scenario();
    let now = 0, reads = 0;
    t.mock.method(performance, "now", () => now);
    const { options } = catchingUp(fixture, 2, prefix => prefix.tip);
    options.readTip = async () => {
      if (++reads === 2) now = MAX_CATCH_UP_MILLISECONDS + 1;
      return fixture.options.tip;
    };
    await assert.rejects(qualifyExpandedLiquidityReplay(options), /qualification time budget exceeded/);
  });
  await t.test("individually admissible slices exceed the total corrected byte limit", async () => {
    const frames = RESOURCE_LIMITS.maxNativePayloadBytes / RESOURCE_LIMITS.maxNativePayloadBytesPerBlock;
    const fixture = scenario({ blockCount: frames + 1 });
    const terminal = fixture.options.tip;
    const { options, prefixes } = catchingUp(fixture, frames, (_, __, setLive) => { setLive(terminal); return terminal; });
    options.nativeDigest = value => {
      const digest = nativeDigest(value);
      return value.expandedLiquidity ? { ...digest, bytes: RESOURCE_LIMITS.maxNativePayloadBytesPerBlock } : digest;
    };
    await assert.rejects(qualifyExpandedLiquidityReplay(options), /corrected native frame or suffix budget invalid/);
    assert.deepEqual(prefixes, [D.blockHeight + frames]);
  });
});
